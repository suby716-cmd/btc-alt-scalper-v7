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
      if (req.method !== "POST" && req.method !== "GET") return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
      const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};

      // Current BTC dominance and 30-day Fear & Greed are public/no-key sources.
      const [altR,fngR]=await Promise.all([
        fetchJson("https://api.alternative.me/v2/global/",9000),
        fetchJson("https://api.alternative.me/fng/?limit=30&format=json",9000)
      ]);
      const btcDominance=n(altR.body?.data?.bitcoin_percentage_of_market_cap);
      const fgRows=Array.isArray(fngR.body?.data)?fngR.body.data:[];
      const fg=fgRows[0]||null;
      const fearGreed=n(fg?.value);
      const fearGreedClass=fg?.value_classification||null;
      const fearGreedHistory=fgRows.slice().reverse().map(x=>n(x?.value)).filter(x=>x!==null);

      // Mayer: no third-party Mayer endpoint. Pull BTC daily closes and compute Price/SMA200.
      // ~10 years = 19 Upbit pages of <=200 candles. Cache API avoids repeating this on every page load.
      const cache=typeof caches!=="undefined"?caches.default:null;
      const cacheKey=new Request("https://macro-cache.local/mayer-10y");
      let mayerPayload=null;
      if(cache){
        const hit=await cache.match(cacheKey);
        if(hit){try{mayerPayload=await hit.json()}catch{}}
      }
      if(!mayerPayload){
        let rows=[],to=null;
        for(let page=0;page<20;page++){
          const url=`https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=200${to?`&to=${encodeURIComponent(to)}`:""}`;
          const r=await fetchJson(url,10000);
          const a=Array.isArray(r.body)?r.body:[];
          if(!a.length) break;
          rows.push(...a);
          const oldest=a[a.length-1];
          const t=new Date(oldest.candle_date_time_utc+"Z");
          t.setSeconds(t.getSeconds()-1);
          to=t.toISOString();
          if(a.length<200) break;
        }
        const byTime=[...new Map(rows.map(x=>[x.timestamp,x])).values()].sort((a,b)=>a.timestamp-b.timestamp);
        const closes=byTime.map(x=>n(x.trade_price)).filter(x=>x!==null);
        const points=[];
        for(let i=199;i<closes.length;i++){
          let sum=0; for(let j=i-199;j<=i;j++) sum+=closes[j];
          const mm=closes[i]/(sum/200);
          if(Number.isFinite(mm)) points.push(mm);
        }
        // Downsample for browser: preserve shape, ~weekly points over 10y.
        const step=Math.max(1,Math.floor(points.length/520));
        const sampled=points.filter((_,i)=>i%step===0);
        if(points.length && sampled.at(-1)!==points.at(-1)) sampled.push(points.at(-1));
        mayerPayload={current:points.at(-1)||null,history:sampled.slice(-560)};
        if(cache && mayerPayload.current){
          const resp=new Response(JSON.stringify(mayerPayload),{headers:{"Content-Type":"application/json","Cache-Control":"public,max-age=21600"}});
          await cache.put(cacheKey,resp);
        }
      }

      // BTC.D history: use CMC historical API only when the owner configures CMC_API_KEY.
      // This avoids fabricating history or scraping unstable HTML. One year is enough to see current capital rotation.
      let domHist=[];
      let domHistoryStatus="not-configured";
      if(env.CMC_API_KEY){
        const end=new Date(),start=new Date(end.getTime()-366*86400000);
        const url=`https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/historical?time_start=${encodeURIComponent(start.toISOString())}&time_end=${encodeURIComponent(end.toISOString())}&interval=1d&count=367`;
        const rr=await fetch(url,{headers:{"X-CMC_PRO_API_KEY":env.CMC_API_KEY,"Accept":"application/json"}});
        domHistoryStatus=String(rr.status);
        if(rr.ok){
          const jb=await rr.json();
          const data=Array.isArray(jb?.data?.quotes)?jb.data.quotes:Array.isArray(jb?.data)?jb.data:[];
          domHist=data.map(x=>n(x?.btc_dominance ?? x?.quote?.USD?.btc_dominance ?? x?.btcDominance)).filter(x=>x!==null);
        }
      }

      return json({
        ok:true,
        btcDominance,
        btcDominanceHistory:domHist,
        dominanceHistoryStatus:domHistoryStatus,
        mayerMultiple:n(mayerPayload?.current),
        mayerHistory:Array.isArray(mayerPayload?.history)?mayerPayload.history:[],
        mayerReference:{deepDiscount:0.8,trend:1.0,historicalOverheat:2.4},
        fearGreed,fearGreedClass,fearGreedHistory,
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
