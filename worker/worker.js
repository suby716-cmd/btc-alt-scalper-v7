// worker/worker.js — BTC ALT REGIME TRADER v10.5.0-minimal+pin
//
// 단계별 복구 진행 중: /health, /upbit, /market (완료) → PIN 인증 (이번 단계) → KV 포지션 → Telegram → Cron
// KV(포지션/장부), Telegram 알림, Cron 자동감시는 다음 단계에서 하나씩 다시 붙일 예정입니다.
//
// 이 파일이 실제로 배포되는 원본입니다 (worker/wrangler.toml의 main="worker.js" 기준).
// 저장소 루트의 worker.js는 사용되지 않는 파일이니 참고만 하세요.

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

// PIN은 Cloudflare Secret "PIN"과 비교합니다.
// (참고: SCALPER_PIN이라는 예전 Secret도 남아있는데, 이번 최소 구조에서는 PIN만 사용합니다.)
function requirePin(req, env) {
  const pin = req.headers.get("x-scalper-pin") || "";
  return !!env.PIN && pin === env.PIN;
}

async function fetchJson(url, ms = 5000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "BTC-ALT-REGIME-TRADER/10.4.0-minimal" },
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

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (u.pathname === "/health") {
      return json({
        ok: true,
        version: "v10.5.0-minimal+pin",
        service: "BTC ALT REGIME TRADER (minimal)",
        market: "Upbit KRW",
        pinConfigured: !!env.PIN,
      });
    }

    // PIN 검증 전용: 화면에 입력한 PIN이 Cloudflare Secret과 일치하는지만 확인.
    // 아직 포지션/장부 등 실제로 PIN이 지켜야 할 쓰기 작업은 없고, 다음 단계에서 이 함수(requirePin)를 재사용합니다.
    if (u.pathname === "/pin-check") {
      if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      if (!env.PIN) return json({ ok: false, error: "PIN_NOT_CONFIGURED", valid: false }, 200);
      const valid = requirePin(req, env);
      return json({ ok: true, valid });
    }


    // v8.3.5 Regime Engine candle bridge.
    // Returns the legacy compact format: [timestamp, open, high, low, close, volume]
    if (u.pathname === "/macro") {
      if (req.method !== "POST" && req.method !== "GET") return json({ ok:false, error:"METHOD_NOT_ALLOWED" },405);

      const [domR, altR, fngR, mayerR] = await Promise.all([
        fetchJson("https://charts.bitcoin.com/api/v1/bitcoin-dominance", 10000),
        fetchJson("https://api.alternative.me/v2/global/", 10000),
        fetchJson("https://api.alternative.me/fng/?limit=30&format=json", 10000),
        fetchJson("https://charts.bitcoin.com/api/v1/charts/mayer-multiple?interval=daily&timespan=30d&limit=30", 12000)
      ]);

      const n=v=>{ const x=Number(v); return Number.isFinite(x)?x:null; };
      const series=(arr, preferred=[])=>{
        if(!Array.isArray(arr)) return [];
        return arr.map(row=>{
          if(Array.isArray(row)){
            // [timestamp,value] and similar arrays: last numeric item is the value.
            for(let i=row.length-1;i>=0;i--){ const x=n(row[i]); if(x!==null) return x; }
            return null;
          }
          if(row && typeof row==="object"){
            for(const k of [...preferred,"value","y","multiple","dominance","btcDominance","percentage","price"]){
              const x=n(row[k]); if(x!==null) return x;
            }
            return null;
          }
          return n(row);
        }).filter(x=>x!==null);
      };

      // Current BTC dominance + any historical series returned by Bitcoin.com.
      const db=domR.body||{};
      let domHist=[];
      for(const a of [
        db.data?.history,db.history,db.data?.dominanceHistory,db.data?.btcDominanceHistory,
        db.data?.dominance,db.data?.btcDominance
      ]){
        const v=series(a,["btcDominance","dominance","percentage"]);
        if(v.length>1){ domHist=v; break; }
      }
      let btcDominance=n(
        db.current?.btcDominance ?? db.current?.dominance ?? db.btcDominance ??
        db.bitcoinDominance ?? db.dominance ?? db.data?.current?.btcDominance ??
        db.data?.current?.dominance
      );
      if(btcDominance===null && domHist.length) btcDominance=domHist.at(-1);
      if(btcDominance===null) btcDominance=n(altR.body?.data?.bitcoin_percentage_of_market_cap);

      // Fear & Greed: response is newest first, chart should be oldest -> newest.
      const fgRows=Array.isArray(fngR.body?.data)?fngR.body.data:[];
      const fg=fgRows[0]||null;
      const fearGreed=n(fg?.value);
      const fearGreedClass=fg?.value_classification||null;
      const fearGreedHistory=fgRows.slice().reverse().map(x=>n(x?.value)).filter(x=>x!==null);

      // Mayer: official response fields data.multiple / data.price / data.ma200.
      const mb=mayerR.body||{};
      let mayerHist=series(mb.data?.multiple,["multiple","mayerMultiple"]);
      const priceHist=series(mb.data?.price,["price"]);
      const maHist=series(mb.data?.ma200,["ma200","value"]);
      // Fallback: compute price/MA200 point-by-point when multiple isn't directly usable.
      if(!mayerHist.length && priceHist.length && maHist.length){
        const len=Math.min(priceHist.length,maHist.length);
        mayerHist=priceHist.slice(-len).map((px,i)=>{
          const ma=maHist.slice(-len)[i];
          return ma>0?px/ma:null;
        }).filter(x=>x!==null);
      }
      // Never treat 0 as a valid Mayer Multiple.
      mayerHist=mayerHist.filter(x=>x>0.05 && x<20);
      let mayerMultiple=mayerHist.length?mayerHist.at(-1):n(
        mb.current?.multiple ?? mb.current?.mayerMultiple ?? mb.mayerMultiple ?? mb.latest?.multiple
      );
      if(!(mayerMultiple>0.05 && mayerMultiple<20)) mayerMultiple=null;

      // If dominance upstream has no history, keep the current value but return [].
      // Frontend deliberately does not invent a fake historical line.
      return json({
        ok:true,
        btcDominance,
        btcDominanceHistory:domHist.slice(-30),
        mayerMultiple,
        mayerHistory:mayerHist.slice(-30),
        fearGreed,
        fearGreedClass,
        fearGreedHistory:fearGreedHistory.slice(-30),
        errors:{
          dominance:btcDominance===null?`Bitcoin.com ${domR.status} / Alternative.me ${altR.status}`:null,
          dominanceHistory:domHist.length<2?"upstream-history-unavailable":null,
          mayer:mayerMultiple===null?`Bitcoin.com ${mayerR.status}`:null,
          fearGreed:fearGreed===null?`Alternative.me ${fngR.status}`:null
        },
        upstream:{dominance:domR.status,dominanceFallback:altR.status,fearGreed:fngR.status,mayer:mayerR.status},
        updatedAt:Date.now()
      });
    }

    if (u.pathname === "/test") {
      if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      if (env.PIN && !requirePin(req, env)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        return json({ ok: false, error: "TELEGRAM_NOT_CONFIGURED" }, 503);
      }
      const tr = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: "BTC ALT REGIME TRADER v8.3.6 · Telegram 연결 테스트 성공"
        })
      });
      let tb = null;
      try { tb = await tr.json(); } catch {}
      if (!tr.ok || !tb?.ok) return json({ ok: false, error: "TELEGRAM_SEND_FAILED", status: tr.status }, 502);
      return json({ ok: true });
    }

    if (u.pathname === "/candles") {
      if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      if (env.PIN && !requirePin(req, env)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
      let body = {};
      try { body = await req.json(); } catch {}
      const symbol = String(body.symbol || "BTC").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const frame = String(body.frame || "5m").toLowerCase();
      const count = Math.max(1, Math.min(200, Number(body.count) || 200));
      // null -> Number(null) === 0(1970-01-01) 버그 방지
      const rawTo = body.to;
      const parsedTo = Number(rawTo);
      // pagination은 실제 timestamp(2000년 이후)일 때만 허용
      const to = rawTo !== null && rawTo !== undefined && rawTo !== "" &&
        Number.isFinite(parsedTo) && parsedTo > 946684800000 ? parsedTo : NaN;
      const path = frame === "day"
        ? `/v1/candles/days?market=KRW-${symbol}&count=${count}${Number.isFinite(to) ? `&to=${encodeURIComponent(new Date(to).toISOString())}` : ""}`
        : `/v1/candles/minutes/5?market=KRW-${symbol}&count=${count}${Number.isFinite(to) ? `&to=${encodeURIComponent(new Date(to).toISOString())}` : ""}`;
      const r = await fetchJson(UPBIT + path, 7000);
      if (!r.ok || !Array.isArray(r.body)) return json({ ok:false, error:"CANDLES_FAILED", status:r.status }, 502);
      const candles = r.body.slice().reverse().map(x => [
        Date.parse(x.candle_date_time_utc + "Z"),
        Number(x.opening_price), Number(x.high_price), Number(x.low_price),
        Number(x.trade_price), Number(x.candle_acc_trade_volume)
      ]);
      return json({ ok:true, symbol, frame, candles });
    }

    // Upbit 프록시 (브라우저 직접 호출은 CORS로 막히므로 반드시 이 경로를 거쳐야 함)
    if (u.pathname === "/upbit") {
      const path = u.searchParams.get("path");
      if (!path || !path.startsWith("/v1/")) return json({ error: "invalid path" }, 400);
      const r = await fetch(UPBIT + path, {
        headers: { Accept: "application/json", "User-Agent": "BTC-ALT-REGIME-TRADER/10.4.0-minimal" },
      });
      return new Response(await r.text(), {
        status: r.status,
        headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    // Upbit KRW 시세 + CryptoCompare/Coinbase 기준 김프 계산 (기존 로직 그대로 유지)
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
        return json({ ok: false, version: "v10.5.0-minimal+pin", error: "UPBIT_FAILED", status: ur.status, detail: ur.error || null }, 502);
      }
      const up = ur.body;
      const um = new Map(up.map((x) => [x.market, x]));
      const usdtKrw = Number(um.get("KRW-USDT")?.trade_price) || 0;

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
        version: "v10.5.0-minimal+pin",
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

    return new Response("BTC ALT REGIME TRADER (minimal)", { headers: CORS });
  },
};
