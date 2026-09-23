// worker.js — BTC ALT REGIME TRADER v10.3.0
// 변경사항 (v10.2.4.4 → v10.3.0):
//  1) CORS Allow-Headers에 x-scalper-pin 추가 (프론트의 PIN 헤더가 프리플라이트에서 차단되던 문제 해결)
//  2) /positions, /ledger, /context 엔드포인트 신규 구현
//  3) TP1(+1.2%)/TP2(+2.2%)/손절(-0.8%)/하락반전(4조건 중 3개) 알림 로직 (v7.2와 동일 기준)
//  4) scheduled() 핸들러 추가 — Cloudflare Cron이 브라우저 없이도 포지션을 자동 감시
//  5) 기존 /market의 CryptoCompare/Coinbase 김프(프리미엄) 계산 로직은 그대로 유지

const UPBIT = "https://api.upbit.com";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-scalper-pin",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function requirePin(req, env) {
  const pin = req.headers.get("x-scalper-pin");
  return !!env.PIN && pin === env.PIN;
}

async function kvGetJson(env, key, fallback) {
  const raw = await env.SCALPER_KV.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function kvPutJson(env, key, value) {
  await env.SCALPER_KV.put(key, JSON.stringify(value));
}

async function fetchJson(url, ms = 5000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "BTC-ALT-REGIME-TRADER/10.3.0" },
      signal: c.signal,
    });
    let body = null;
    try {
      body = await r.json();
    } catch {}
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// --- 가벼운 시세 스냅샷: Upbit ticker만 조회 (Regime/포지션 감시용, 외부 김프 조회 없음) ---
async function getMarketSnapshot(symbolsParam) {
  const symbols = (
    symbolsParam || "BTC,ETH,SOL,XRP,XLM,HBAR,ONDO,LINK,AVAX,DOGE,SUI,TAO,UNI,AAVE,ADA,NEAR"
  )
    .toUpperCase()
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const uniq = [...new Set(symbols)].slice(0, 30);
  const upMarkets = [...new Set([...uniq.map((s) => "KRW-" + s), "KRW-USDT"])];
  const ur = await fetchJson(UPBIT + "/v1/ticker?markets=" + encodeURIComponent(upMarkets.join(",")), 5000);
  if (!ur.ok || !Array.isArray(ur.body)) return { ok: false, error: "UPBIT_FAILED", status: ur.status };
  const up = ur.body;
  const um = new Map(up.map((x) => [x.market, x]));
  const rows = uniq.map((symbol) => {
    const x = um.get("KRW-" + symbol);
    const price = Number(x?.trade_price) || null;
    const change24h = Number.isFinite(Number(x?.signed_change_rate)) ? Number(x.signed_change_rate) * 100 : null;
    return { symbol, price, change24h, updatedAt: x?.timestamp || null };
  });
  return { ok: true, rows };
}

function classifyRegime(avgChange) {
  if (avgChange == null) return "UNKNOWN";
  if (avgChange >= 2) return "STRONG_BULL";
  if (avgChange >= 0.5) return "BULL";
  if (avgChange <= -2) return "STRONG_BEAR";
  if (avgChange <= -0.5) return "BEAR";
  return "NEUTRAL";
}

function buildContext(rows) {
  const btc = rows.find((r) => r.symbol === "BTC");
  const alts = rows.filter((r) => r.symbol !== "BTC" && Number.isFinite(r.change24h));
  const btcChange = btc?.change24h ?? null;
  const altAvg = alts.length ? alts.reduce((s, r) => s + r.change24h, 0) / alts.length : null;
  const btcRegime = classifyRegime(btcChange);
  const altRegime = classifyRegime(altAvg);
  const positives = alts.filter((r) => r.change24h > 0).length;
  const sentimentScore = alts.length ? Math.round((positives / alts.length) * 100) : null;
  const sentiment =
    sentimentScore == null ? "UNKNOWN" : sentimentScore >= 65 ? "RISK_ON" : sentimentScore <= 35 ? "RISK_OFF" : "NEUTRAL";
  const top3 = [...alts]
    .sort((a, b) => b.change24h - a.change24h)
    .slice(0, 3)
    .map((r) => ({ symbol: r.symbol, change24h: r.change24h }));
  const confidenceScore = altAvg == null ? null : Math.max(0, Math.min(100, Math.round(50 + altAvg * 10)));
  return {
    btcRegime,
    btcChange,
    altRegime,
    altAvg,
    sentiment,
    sentimentScore,
    topScore: top3,
    confidenceScore,
    updatedAt: Date.now(),
  };
}

// --- 포지션 알림 로직: TP1 +1.2% / TP2 +2.2% / 손절 -0.8% / 하락반전(4조건 중 3개) ---
const TP1_PCT = 1.2;
const TP2_PCT = 2.2;
const STOP_PCT = -0.8;

async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    });
  } catch {}
}

async function checkPositionAlerts(env, rows, ctx) {
  const positions = await kvGetJson(env, "positions", {});
  const rowMap = new Map(rows.map((r) => [r.symbol, r]));
  let changed = false;

  for (const [symbol, pos] of Object.entries(positions)) {
    const row = rowMap.get(symbol);
    if (!row || !Number.isFinite(row.price) || !Number.isFinite(pos.buyPrice) || pos.buyPrice <= 0) continue;
    const pnlPct = (row.price / pos.buyPrice - 1) * 100;

    if (!pos.tp1Hit && pnlPct >= TP1_PCT) {
      await sendTelegram(env, `🎯 [TP1] ${symbol} +${pnlPct.toFixed(2)}% 도달 (매수가 ${pos.buyPrice} → 현재 ${row.price})`);
      pos.tp1Hit = true;
      changed = true;
    }
    if (!pos.tp2Hit && pnlPct >= TP2_PCT) {
      await sendTelegram(env, `🚀 [TP2] ${symbol} +${pnlPct.toFixed(2)}% 도달 (매수가 ${pos.buyPrice} → 현재 ${row.price})`);
      pos.tp2Hit = true;
      changed = true;
    }
    if (!pos.stopHit && pnlPct <= STOP_PCT) {
      await sendTelegram(env, `⛔ [손절] ${symbol} ${pnlPct.toFixed(2)}% (매수가 ${pos.buyPrice} → 현재 ${row.price})`);
      pos.stopHit = true;
      changed = true;
    }
    if (!pos.reversalHit) {
      const conditions = [
        ctx.sentiment === "RISK_OFF",
        row.change24h != null && row.change24h < 0,
        ctx.altAvg != null && ctx.altAvg < 0,
        ctx.confidenceScore != null && ctx.confidenceScore < 40,
      ];
      const hitCount = conditions.filter(Boolean).length;
      if (hitCount >= 3) {
        await sendTelegram(env, `⚠️ [하락반전] ${symbol} 감시 필요 (${hitCount}/4 조건 충족)`);
        pos.reversalHit = true;
        changed = true;
      }
    }
  }
  if (changed) await kvPutJson(env, "positions", positions);
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (u.pathname === "/health") {
      return json({
        ok: true,
        version: "v10.3.0",
        service: "BTC ALT REGIME TRADER v10.3.0",
        market: "Upbit KRW",
        kv: !!env.SCALPER_KV,
        telegramConfigured: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
        pinConfigured: !!env.PIN,
        externalContext: { publicMacro: true },
      });
    }

    if (u.pathname === "/upbit") {
      const path = u.searchParams.get("path");
      if (!path || !path.startsWith("/v1/")) {
        return new Response(JSON.stringify({ error: "invalid path" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      const r = await fetch(UPBIT + path, {
        headers: { Accept: "application/json", "User-Agent": "BTC-ALT-REGIME-TRADER/10.3.0" },
      });
      return new Response(await r.text(), {
        status: r.status,
        headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    // --- 기존 /market: Upbit + CryptoCompare/Coinbase 기반 김프(프리미엄) 계산 (원본 로직 그대로 유지) ---
    if (u.pathname === "/market") {
      const symbols = (u.searchParams.get("symbols") || "BTC,ETH,SOL,XRP,XLM,HBAR,ONDO,LINK,AVAX,DOGE,SUI,TAO,UNI,AAVE,ADA,NEAR")
        .toUpperCase()
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      const uniq = [...new Set(symbols)].slice(0, 30);
      const upMarkets = [...new Set([...uniq.map((s) => "KRW-" + s), "KRW-USDT"])];

      const ur = await fetchJson(UPBIT + "/v1/ticker?markets=" + encodeURIComponent(upMarkets.join(",")), 5000);
      if (!ur.ok || !Array.isArray(ur.body)) {
        return json({ ok: false, version: "v10.3.0", error: "UPBIT_FAILED", status: ur.status, detail: ur.error || null }, 502);
      }
      const up = ur.body;
      const um = new Map(up.map((x) => [x.market, x]));
      const usdtKrw = Number(um.get("KRW-USDT")?.trade_price) || 0;

      // 해외 기준가: CryptoCompare 멀티심볼 엔드포인트 (1회 호출로 전체 USD가 조회, 요청량 완화)
      let refMap = new Map();
      let referenceSource = null;
      let referenceStatus = null;
      const cr = await fetchJson(
        "https://min-api.cryptocompare.com/data/pricemulti?fsyms=" + encodeURIComponent(uniq.join(",")) + "&tsyms=USD",
        5000
      );
      referenceStatus = cr.status;
      if (cr.ok && cr.body && typeof cr.body === "object") {
        for (const s of uniq) {
          const p = Number(cr.body?.[s]?.USD);
          if (Number.isFinite(p) && p > 0) refMap.set(s, p);
        }
        if (refMap.size) referenceSource = "CryptoCompare USD";
      }

      // 2차 폴백: Coinbase 공개 spot 엔드포인트 (1차에서 못 찾은 심볼만 순차 호출)
      let coinbaseStatus = null;
      if (refMap.size < uniq.length) {
        for (const s of uniq) {
          if (refMap.has(s)) continue;
          const cb = await fetchJson("https://api.coinbase.com/v2/prices/" + encodeURIComponent(s) + "-USD/spot", 3500);
          coinbaseStatus = cb.status;
          const p = Number(cb.body?.data?.amount);
          if (cb.ok && Number.isFinite(p) && p > 0) refMap.set(s, p);
        }
        if (refMap.size && !referenceSource) referenceSource = "Coinbase USD";
        else if (refMap.size) referenceSource += " + Coinbase fallback";
      }

      const rows = uniq.map((symbol) => {
        const x = um.get("KRW-" + symbol);
        const price = Number(x?.trade_price) || null;
        const change24h = Number.isFinite(Number(x?.signed_change_rate)) ? Number(x.signed_change_rate) * 100 : null;
        const overseasUsd = refMap.get(symbol) || null;
        const fairKrw = overseasUsd && usdtKrw ? overseasUsd * usdtKrw : null;
        const premium = price && fairKrw ? (price / fairKrw - 1) * 100 : null;
        return { symbol, price, change24h, premium, overseasUsd, fairKrw, updatedAt: x?.timestamp || null };
      });
      const priced = rows.filter((r) => Number.isFinite(r.premium)).length;
      return json({
        ok: true,
        version: "v10.3.0",
        market: "UPBIT_KRW",
        reference: (referenceSource || "NONE") + " × Upbit USDT/KRW",
        referenceSource,
        referenceStatus,
        coinbaseStatus,
        usdtKrw: usdtKrw || null,
        kimchiSourceOk: priced > 0,
        kimchiPairs: priced,
        rows,
        updatedAt: Date.now(),
      });
    }

    // --- 신규: 시황 요약 (BTC/ALT Regime, 시장 센티먼트, Score) + 보유 포지션 알림 체크 ---
    if (u.pathname === "/context") {
      const snap = await getMarketSnapshot(u.searchParams.get("symbols"));
      if (!snap.ok) return json({ ok: false, error: snap.error }, 502);
      const ctx = buildContext(snap.rows);
      // /context 조회 시 보유 포지션 알림도 함께 체크 (엣지트리거, 중복발송 방지)
      await checkPositionAlerts(env, snap.rows, ctx);
      return json({ ok: true, version: "v10.3.0", ...ctx });
    }

    // --- 신규: 포지션(보유 코인) 관리 ---
    if (u.pathname === "/positions") {
      if (req.method === "GET") {
        const positions = await kvGetJson(env, "positions", {});
        return json({ ok: true, positions });
      }
      if (req.method === "POST") {
        if (!requirePin(req, env)) return json({ ok: false, error: "INVALID_PIN" }, 401);
        const body = await req.json().catch(() => null);
        if (!body || !body.symbol || !body.action) return json({ ok: false, error: "BAD_REQUEST" }, 400);
        const symbol = String(body.symbol).toUpperCase();
        const positions = await kvGetJson(env, "positions", {});
        const ledger = await kvGetJson(env, "ledger", []);

        if (body.action === "buy") {
          let buyPrice = Number(body.price);
          if (!Number.isFinite(buyPrice) || buyPrice <= 0) {
            const snap = await getMarketSnapshot(symbol);
            const row = snap.ok ? snap.rows.find((r) => r.symbol === symbol) : null;
            buyPrice = row?.price ?? null;
          }
          positions[symbol] = { buyPrice, buyTime: Date.now(), tp1Hit: false, tp2Hit: false, stopHit: false, reversalHit: false };
          await kvPutJson(env, "positions", positions);
          ledger.unshift({ symbol, action: "BUY", price: buyPrice, timestamp: Date.now() });
          await kvPutJson(env, "ledger", ledger.slice(0, 200));
          return json({ ok: true, positions });
        }

        if (body.action === "sell") {
          const closed = positions[symbol];
          delete positions[symbol];
          await kvPutJson(env, "positions", positions);
          ledger.unshift({
            symbol,
            action: "SELL",
            price: Number(body.price) || null,
            buyPrice: closed?.buyPrice ?? null,
            timestamp: Date.now(),
          });
          await kvPutJson(env, "ledger", ledger.slice(0, 200));
          return json({ ok: true, positions });
        }

        return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
      }
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    // --- 신규: 매매 기록(원장) ---
    if (u.pathname === "/ledger") {
      if (req.method === "GET") {
        const ledger = await kvGetJson(env, "ledger", []);
        return json({ ok: true, ledger });
      }
      if (req.method === "POST") {
        if (!requirePin(req, env)) return json({ ok: false, error: "INVALID_PIN" }, 401);
        const body = await req.json().catch(() => null);
        if (!body) return json({ ok: false, error: "BAD_REQUEST" }, 400);
        const ledger = await kvGetJson(env, "ledger", []);
        ledger.unshift({ ...body, timestamp: Date.now() });
        await kvPutJson(env, "ledger", ledger.slice(0, 200));
        return json({ ok: true, ledger });
      }
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    if (u.pathname === "/telegram-test") {
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        return new Response(
          JSON.stringify({ ok: false, message: "Worker Secret에 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID를 설정하세요." }),
          { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
        );
      }
      const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: "⚡ BTC ALT REGIME TRADER v10.3.0\nTelegram 연결 테스트 정상입니다.\n매매는 수동으로 진행합니다.",
        }),
      });
      const x = await r.json();
      return new Response(
        JSON.stringify({ ok: !!x.ok, message: x.ok ? "Telegram 테스트 메시지를 요청했습니다." : "Telegram 전송 실패" }),
        { status: x.ok ? 200 : 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    return new Response("BTC ALT REGIME TRADER v10.3.0", { headers: CORS });
  },

  // Cloudflare Cron이 주기적으로 실행 — 브라우저를 안 열어도 보유 포지션을 자동 감시
  async scheduled(event, env) {
    const snap = await getMarketSnapshot();
    if (!snap.ok) return;
    const ctx = buildContext(snap.rows);
    await checkPositionAlerts(env, snap.rows, ctx);
  },
};
