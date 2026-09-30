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


async function fetchText(url, ms = 8000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, {headers:{
      "Accept":"text/html,application/xhtml+xml",
      "User-Agent":"Mozilla/5.0 (compatible; BTC-ALT-REGIME-TRADER/8.4.4)"
    },signal:c.signal});
    return {ok:r.ok,status:r.status,body:r.ok?await r.text():""};
  } catch(e) { return {ok:false,status:0,error:String(e?.message||e),body:""}; }
  finally { clearTimeout(t); }
}

function parseFredCsv(txt){
  const out=[];
  if(!txt) return out;
  const lines=txt.trim().split(/\r?\n/);
  for(const line of lines.slice(1)){
    const p=line.split(',');
    if(p.length<2) continue;
    const d=p[0]?.trim(), v=Number(p[1]);
    if(d && Number.isFinite(v)) out.push({d,v});
  }
  return out;
}
function lastFinite(a){return a?.length?a[a.length-1]?.v:null}
function valueNear(a,dateMs){
  if(!a?.length) return null;
  let best=null;
  for(const x of a){
    const t=Date.parse(x.d);
    if(Number.isFinite(t)&&t<=dateMs) best=x.v;
  }
  return best;
}
function pctChange(a,n){
  if(!a?.length) return null;
  const last=a[a.length-1]; if(!last||!Number.isFinite(last.v)) return null;
  const target=Date.parse(last.d)-(n>=300?365.25*86400000:n>=60?90*86400000:n*30.4375*86400000);
  const prev=valueNear(a,target);
  return Number.isFinite(prev)&&prev!==0?(last.v/prev-1)*100:null;
}
async function fetchFredCsv(series,start="2011-01-01"){
  return fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series)}&cosd=${start}`,9000);
}

function parseCoinGeckoDominancePage(html) {
  if(!html) return null;
  const text=html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
  const row=text.match(/\bBTC\s+(\d{1,2}(?:\.\d+)?)%\s+(\d{1,2}(?:\.\d+)?)%\s+(\d{1,2}(?:\.\d+)?)%\s+(\d{1,2}(?:\.\d+)?)%\s+(\d{1,2}(?:\.\d+)?)%/i);
  if(row){
    const v=row.slice(1,6).map(Number);
    if(v.every(x=>x>20&&x<90)) return {today:v[0],d7:v[1],m1:v[2],m3:v[3],y1:v[4]};
  }
  const sentence=text.match(/Bitcoin dominance of\s+(\d{1,2}(?:\.\d+)?)%/i);
  if(sentence){const x=Number(sentence[1]); if(x>20&&x<90)return {today:x};}
  return null;
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

      // BTC.D is CoinGecko-only. Do NOT substitute a different provider's methodology.
      const [cgApiR,cgPageR,fngR]=await Promise.all([
        fetchJson("https://api.coingecko.com/api/v3/global",9000),
        fetchText("https://www.coingecko.com/en/charts/bitcoin-dominance",9000),
        fetchJson("https://api.alternative.me/fng/?limit=30&format=json",9000)
      ]);
      const cgApiDom=n(cgApiR.body?.data?.market_cap_percentage?.btc);
      const cgPage=parseCoinGeckoDominancePage(cgPageR.body);
      const pageDom=n(cgPage?.today);
      let btcDominance=null, btcDominanceSource="CoinGecko unavailable";
      if(cgApiDom!==null && cgApiDom>20 && cgApiDom<90){
        btcDominance=cgApiDom; btcDominanceSource="CoinGecko API";
      } else if(pageDom!==null && pageDom>20 && pageDom<90){
        btcDominance=pageDom; btcDominanceSource="CoinGecko";
      }
      const btcDominanceSnapshots=cgPage?{
        today:n(cgPage.today),d7:n(cgPage.d7),m1:n(cgPage.m1),m3:n(cgPage.m3),y1:n(cgPage.y1)
      }:null;
      const crossCheck={coingeckoApi:cgApiDom,coingeckoPage:pageDom,apiStatus:cgApiR.status,pageStatus:cgPageR.status};
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


      // v8.5.1: Global M2 is built from primary-source public series.
      // Method: US M2 + Euro Area M2 + Japan M2 + UK M4, all converted to USD.
      // This is a transparent global-M2 index, not an official IMF "global M2" series.
      // FRED: fetch all required series in ONE CSV request. This avoids partial failures
      // caused by firing 8 separate upstream requests from a Cloudflare Worker.
      const fredIds={m2:"M2SL",fed:"EFFR",dollar:"DTWEXBGS",oil:"WTISPLC",sp:"SP500",eurusd:"DEXUSEU",jpyusd:"DEXJPUS",gbpusd:"EXUSUK"};
      function parseFredWide(txt, ids){
        const out=Object.fromEntries(Object.keys(ids).map(k=>[k,[]]));
        if(!txt) return out;
        const lines=txt.trim().split(/\r?\n/);
        if(!lines.length) return out;
        const h=lines[0].split(',').map(x=>x.trim().replace(/^"|"$/g,''));
        const idx={};
        for(const [k,id] of Object.entries(ids)){ const i=h.findIndex(v=>v===id); if(i>=0)idx[k]=i; }
        for(const line of lines.slice(1)){
          const p=line.split(',').map(x=>x.trim().replace(/^"|"$/g,''));
          const d=p[0]; if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
          for(const [k,i] of Object.entries(idx)){
            const v=Number(p[i]);
            if(Number.isFinite(v)) out[k].push({d,v});
          }
        }
        return out;
      }
      const fredCombined=await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${Object.values(fredIds).join(',')}&cosd=2011-01-01`,12000);
      const fred=parseFredWide(fredCombined.body,fredIds);

      async function fetchRawText(url,ms=12000){ return fetchText(url,ms); }
      function parseLooseCsv(txt){
        const out=[]; if(!txt)return out;
        for(const line of txt.trim().split(/\r?\n/)){
          const p=line.split(',').map(x=>x.trim().replace(/^"|"$/g,''));
          if(p.length<2)continue;
          const d=p[0], nums=p.slice(1).map(Number).filter(Number.isFinite);
          if(/^\d{4}[-/]\d{2}/.test(d)&&nums.length) out.push({d:d.replace(/\//g,'-').slice(0,7)+'-01',v:nums[nums.length-1]});
        }
        return out;
      }
      function parseEcbCsv(txt){
        if(!txt)return [];
        const lines=txt.trim().split(/\r?\n/).map(x=>x.split(',').map(v=>v.replace(/^"|"$/g,'')));
        const h=lines.findIndex(r=>r.includes('TIME_PERIOD')&&r.includes('OBS_VALUE'));
        if(h<0)return [];
        const hi=lines[h].indexOf('TIME_PERIOD'), vi=lines[h].indexOf('OBS_VALUE'), out=[];
        for(const r of lines.slice(h+1)){const v=Number(r[vi]);if(r[hi]&&Number.isFinite(v))out.push({d:r[hi].slice(0,7)+'-01',v});}
        return out;
      }
      function parseBoeCsv(txt,code){
        if(!txt)return [];
        const lines=txt.trim().split(/\r?\n/).map(x=>x.split(',').map(v=>v.trim().replace(/^"|"$/g,'')));
        const h=lines.findIndex(r=>r.some(v=>v===code)||r.some(v=>v.includes(code)));
        const out=[];
        for(const r of lines.slice(h+1)){if(!r[0])continue;const dt=new Date(r[0]);const v=Number(r[1]);if(Number.isFinite(dt.getTime())&&Number.isFinite(v))out.push({d:`${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-01`,v});}
        return out;
      }
      function parseBojCsv(txt){
        if(!txt)return [];
        const out=[];
        for(const line of txt.trim().split(/\r?\n/)){
          const p=line.split(',').map(v=>v.trim().replace(/^"|"$/g,''));
          if(p.length<2)continue;
          const m=p[0].match(/(\d{4})[\/-](\d{2})/); const v=Number(p[p.length-1]);
          if(m&&Number.isFinite(v))out.push({d:`${m[1]}-${m[2]}-01`,v});
        }
        return out;
      }
      function mergeMonthly(arrs,fn){
        const keys=new Set(arrs.flat().map(x=>x.d.slice(0,7)));
        const out=[]; for(const k of [...keys].sort()){
          const vals=arrs.map(a=>{const x=a.find(z=>z.d.slice(0,7)===k);return x?.v});
          const v=fn(vals); if(Number.isFinite(v))out.push({d:k+'-01',v});
        } return out;
      }
      async function fetchEcbM2(){
        const url='https://data-api.ecb.europa.eu/service/data/BSI/M.U2.Y.V.M20.X.1.U2.2300.Z01.E?startPeriod=2011-01&format=csvdata';
        const r=await fetchRawText(url); if(!r.ok)return [];
        return parseEcbCsv(r.body).map(x=>({d:x.d,v:x.v/1000000}));
      }
      async function fetchBojM2(){
        // BOJ v1 API: db=MD02, code is WITHOUT the MD02' prefix.
        // M2 unit is 100 million yen; convert to trillion yen by /10,000.
        try{
          const url='https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=json&lang=en&db=MD02&startDate=201101&endDate=202609&code=MAM1NAM2M2MO';
          const r=await fetchRawText(url); if(!r.ok||!r.body)return [];
          const j=JSON.parse(r.body);
          const rs=Array.isArray(j?.RESULTSET)?j.RESULTSET[0]:null;
          const ds=rs?.VALUES?.SURVEY_DATES||[], vs=rs?.VALUES?.VALUES||[], out=[];
          for(let i=0;i<Math.min(ds.length,vs.length);i++){const d=String(ds[i]);const v=Number(vs[i]);if(/^\d{6}$/.test(d)&&Number.isFinite(v))out.push({d:`${d.slice(0,4)}-${d.slice(4,6)}-01`,v:v/10000});}
          return out;
        }catch{return []}
      }
      async function fetchBoeM4(){
        const url='https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/2011&Dateto=30/Sep/2026&SeriesCodes=LPMAUYN&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N';
        const r=await fetchRawText(url); if(!r.ok)return [];
        return parseBoeCsv(r.body,'LPMAUYN').map(x=>({d:x.d,v:x.v/1000000}));
      }
      const [eaM2,jpM2,ukM4]=await Promise.all([fetchEcbM2(),fetchBojM2(),fetchBoeM4()]);
      // Rebuild with date-matched FX rather than array-position assumptions.
      const globalRows=[];
      const keys=new Set([fred.m2,eaM2,jpM2,ukM4].flat().map(x=>x.d.slice(0,7)));
      const monthVal=(a,k)=>{
        if(!a?.length)return null;
        const exact=a.find(x=>x.d.slice(0,7)===k); if(exact)return exact.v;
        const t=Date.parse(k+'-01'); let best=null,bestDt=Infinity;
        for(const x of a){const tx=Date.parse(x.d);if(!Number.isFinite(tx))continue;const dt=Math.abs(tx-t);if(dt<bestDt){bestDt=dt;best=x.v}}
        return bestDt<=45*86400000?best:null;
      };
      for(const k of [...keys].sort()){
        const us0=monthVal(fred.m2,k),eu=monthVal(eaM2,k),jp=monthVal(jpM2,k),uk=monthVal(ukM4,k);
        const us=Number.isFinite(us0)?us0/1000:null;
        const fxEu=monthVal(fred.eurusd,k),fxJp=monthVal(fred.jpyusd,k),fxUk=monthVal(fred.gbpusd,k);
        if(![us,eu,jp,uk,fxEu,fxJp,fxUk].every(Number.isFinite)||fxJp===0||fxUk===0)continue;
        globalRows.push({d:k+'-01',v:us+eu*fxEu+jp/fxJp+uk*fxUk});
      }
      const globalM2YoY=pctChange(globalRows,12), globalM2History=globalRows.filter(x=>x.d>="2011-01-01");
      const m2YoY=globalM2YoY;
      const fed12=pctChange(fred.fed,12), dollar3m=pctChange(fred.dollar,63), oil3m=pctChange(fred.oil,3), sp3m=pctChange(fred.sp,63);
      const btcUpbit=await fetchJson("https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=120",9000);
      const btcRows=Array.isArray(btcUpbit.body)?btcUpbit.body.slice().sort((a,b)=>a.timestamp-b.timestamp):[];
      const btcNow=n(btcRows.at(-1)?.trade_price), btc90=n(btcRows.at(-91)?.trade_price);
      const btc90ret=Number.isFinite(btcNow)&&Number.isFinite(btc90)&&btc90!==0?(btcNow/btc90-1)*100:null;
      const spNow=lastFinite(fred.sp), sp63=fred.sp.length>63?fred.sp[fred.sp.length-64].v:null;
      const sp90ret=Number.isFinite(spNow)&&Number.isFinite(sp63)&&sp63!==0?(spNow/sp63-1)*100:null;
      const btcVsSp=Number.isFinite(btc90ret)&&Number.isFinite(sp90ret)?btc90ret-sp90ret:null;
      const dom30=Number.isFinite(btcDominance)&&Number.isFinite(btcDominanceSnapshots?.m1)?btcDominance-btcDominanceSnapshots.m1:null;

      // v8.5.6: EARLY ALTSEASON RADAR
      // 목적: "알트시즌이 이미 왔는가"를 확인하는 지표가 아니라,
      // BTC 주도 상승 -> ETH/BTC 회복 -> BTC.D 하락 -> 알트 breadth 확산으로 이어지는
      // 초기 순환매가 여러 신호에서 동시에 나타나는지를 점수화한다.
      // 점수 구간은 고정 60/75가 아니라 과거 분포에서 동적으로 보정한다.
      function clamp01(x){return Math.max(0,Math.min(1,x));}
      function lin(v,a,b){return !Number.isFinite(v)?null:clamp01((v-a)/(b-a));}
      function weightedAvg(parts){let s=0,w=0;for(const [v,ww] of parts){if(Number.isFinite(v)){s+=v*ww;w+=ww}}return w?s/w:null;}
      function seriesChange(a,days){
        if(!a?.length)return null;
        const last=a.at(-1); if(!last||!Number.isFinite(last.v))return null;
        const t=Date.parse(last.d), prev=valueNear(a,t-days*86400000);
        return Number.isFinite(prev)&&prev!==0?(last.v/prev-1)*100:null;
      }

      // Live macro / market inputs.
      const m2_3m=seriesChange(globalRows,90), m2_6m=seriesChange(globalRows,183);
      const dollar3mLive=seriesChange(fred.dollar,90), oil3mLive=seriesChange(fred.oil,90);
      const fed12Live=seriesChange(fred.fed,365);
      const btc30=n(btcRows.at(-31)?.trade_price), btc7=n(btcRows.at(-8)?.trade_price);
      const btc30ret=Number.isFinite(btcNow)&&Number.isFinite(btc30)&&btc30!==0?(btcNow/btc30-1)*100:null;
      const btc7ret=Number.isFinite(btcNow)&&Number.isFinite(btc7)&&btc7!==0?(btcNow/btc7-1)*100:null;

      // ETH/BTC momentum: 7d / 30d / 90d. Using Upbit KRW for both assets keeps the ratio KRW-neutral.
      const eth7=n(ethRows.at(-8)?.trade_price), eth90=n(ethRows.at(-91)?.trade_price);
      const ethBtc7=Number.isFinite(eth7)&&Number.isFinite(btc7)&&btc7!==0?eth7/btc7:null;
      const ethBtc90=Number.isFinite(eth90)&&Number.isFinite(btc90)&&btc90!==0?eth90/btc90:null;
      const ethBtc7d=Number.isFinite(ethBtcNow)&&Number.isFinite(ethBtc7)&&ethBtc7!==0?(ethBtcNow/ethBtc7-1)*100:null;
      const ethBtc90d=Number.isFinite(ethBtcNow)&&Number.isFinite(ethBtc90)&&ethBtc90!==0?(ethBtcNow/ethBtc90-1)*100:null;

      // Real breadth: top-50 alts vs BTC over 7/30/90d.
      // If CoinGecko is temporarily rate-limited, the independent public 90d index remains a useful cross-check.
      let breadth={n:0,b7:null,b30:null,b90:null,source:'unavailable'};
      try{
        const mr=await fetchJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&price_change_percentage=7d,30d,90d',10000);
        const rows=Array.isArray(mr.body)?mr.body:[];
        const stable=/^(usdt|usdc|dai|usde|fdusd|tusd|usdd|usds|pyusd|usdp|gusd|frax|crvusd|usdy|usd0)$/i;
        const wrapped=/^(wbtc|weth|steth|weeth|cbeth|cbbtc|wrapped|tbtc|reth|wsteth)$/i;
        const eligible=rows.filter(x=>x?.symbol&&!/^btc$/i.test(x.symbol)&&!stable.test(x.symbol)&&!wrapped.test(x.symbol));
        const btcM=eligible.length?null:null;
        const btcMarket=await fetchJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin&price_change_percentage=7d,30d,90d',8000);
        const br=btcMarket.body?.[0];
        const keys=[['b7','price_change_percentage_7d_in_currency'],['b30','price_change_percentage_30d_in_currency'],['b90','price_change_percentage_90d_in_currency']];
        const vals={};
        for(const [k,key] of keys){const base=Number(br?.[key]); if(!Number.isFinite(base))continue; const cnt=eligible.filter(x=>Number(x?.[key])>base).length; vals[k]=eligible.length?cnt/eligible.length*100:null;}
        if(Number.isFinite(vals.b7)||Number.isFinite(vals.b30)||Number.isFinite(vals.b90)) breadth={n:eligible.length,b7:vals.b7??null,b30:vals.b30??null,b90:vals.b90??null,source:'CoinGecko Top 50'};
      }catch{}
      if(!Number.isFinite(breadth.b90)){
        try{
          const ar=await fetchText('https://www.blockchaincenter.net/altcoin-season-index/',9000);
          const mt=String(ar.body||'').match(/Altcoin Season Snapshot[\s\S]{0,300}?([0-9]{1,3})%/i);
          const v=mt?Number(mt[1]):null;
          if(Number.isFinite(v)) breadth={...breadth,b90:v,source:'BlockchainCenter 90d cross-check'};
        }catch{}
      }

      // Current component scores are deliberately asymmetric: early rotation earns points
      // before full altseason. Breadth acceleration (7d/30d) is worth more than the final 90d flag.
      const liquidity=weightedAvg([[lin(m2_3m,-1,4)*20,.55],[lin(m2_6m,-2,8)*20,.45]])??null;
      const macroScore=weightedAvg([
        [lin(-dollar3mLive,-3,4)*8,.45],
        [lin(-fed12Live,-2,2)*4,.30],
        [lin(-oil3mLive,-10,5)*3,.25]
      ])??null;
      const btcScore=weightedAvg([[lin(btc30ret,-5,20)*6,.45],[lin(btc90ret,-10,60)*4,.55]])??null;
      const domDrop30=Number.isFinite(btcDominance)&&Number.isFinite(btcDominanceSnapshots?.m1)?btcDominance-btcDominanceSnapshots.m1:null;
      const domDrop90=Number.isFinite(btcDominance)&&Number.isFinite(btcDominanceSnapshots?.m3)?btcDominance-btcDominanceSnapshots.m3:null;
      const domScore=weightedAvg([
        [lin(60-(btcDominance??60),-5,12)*8,.35],
        [Number.isFinite(domDrop30)?lin(-domDrop30,-1,5)*7:null,.40],
        [Number.isFinite(domDrop90)?lin(-domDrop90,-2,8)*5:null,.25]
      ])??null;
      const ethScore=weightedAvg([[lin(ethBtc7d,-3,5)*5,.25],[lin(ethBtcChange,-5,12)*6,.45],[lin(ethBtc90d,-8,18)*4,.30]])??null;
      const breadthScore=weightedAvg([
        [Number.isFinite(breadth.b7)?lin(breadth.b7,35,80)*7:null,.25],
        [Number.isFinite(breadth.b30)?lin(breadth.b30,35,80)*6:null,.35],
        [Number.isFinite(breadth.b90)?lin(breadth.b90,35,80)*7:null,.40]
      ])??null;
      const partsNow=[[liquidity,20],[macroScore,15],[btcScore,10],[domScore,20],[ethScore,15],[breadthScore,20]];
      let nowRaw=0,nowW=0; for(const [v,w] of partsNow){if(Number.isFinite(v)){nowRaw+=v;nowW+=w}}
      const total=nowW>=50?Math.round(nowRaw/nowW*100):null;
      const dataComplete=nowW>=85;
      const stage=total==null?'데이터 부족':total<35?'BTC 중심':total<50?'순환매 감지':total<65?'초기 알트 확산':total<80?'알트 확산 진행':'광범위 알트 강세';

      const liquidityPts=Number.isFinite(liquidity)?Math.round(liquidity):null;
      const ratesPts=Number.isFinite(macroScore)?Math.round(macroScore):null;
      const btcPts=Number.isFinite(btcScore)?Math.round(btcScore):null;
      const domPts=Number.isFinite(domScore)?Math.round(domScore):null;
      const altPts=Number.isFinite(ethScore)&&Number.isFinite(breadthScore)?Math.round(ethScore+breadthScore):Number.isFinite(ethScore)?Math.round(ethScore):Number.isFinite(breadthScore)?Math.round(breadthScore):null;

      // Historical monthly ALTSEASON SCORE reconstruction.
      // v8.5.6: fixed 60/75 lines are removed. Each monthly component is converted
      // to a historical percentile, then weighted. This makes the score comparable
      // across regimes instead of assuming that a raw macro value means the same thing
      // in 2014 and 2026. Historical alt-season windows are used only as validation anchors.
      async function cachedPage(url,key,ttl=21600){
        try{
          const c=typeof caches!=="undefined"?caches.default:null, ck=new Request("https://macro-cache.local/"+key);
          if(c){const hit=await c.match(ck);if(hit)return await hit.text()}
          const r=await fetchRawText(url); if(!r.ok)return "";
          if(c) await c.put(ck,new Response(r.body,{headers:{"Cache-Control":`public,max-age=${ttl}`}}));
          return r.body||"";
        }catch{return ""}
      }
      function stripHtml(t){return (t||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim()}
      function monthKey(mon,y){const mm={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12}[mon];return mm?`${y}-${String(mm).padStart(2,'0')}`:null}
      function parseMonthlyBtcReturns(txt){const s=stripHtml(txt),out={};const re=/(20\d{2})\s+((?:[+\-]?\d+(?:\.\d+)?%|—)(?:\s+(?:[+\-]?\d+(?:\.\d+)?%|—)){11})/g;let m;while((m=re.exec(s))){const vals=m[2].trim().split(/\s+/);for(let i=0;i<12;i++){const v=Number(vals[i]?.replace('%',''));if(Number.isFinite(v))out[`${m[1]}-${String(i+1).padStart(2,'0')}`]=v}}return out}
      function parseMonthlyBtcDom(txt){const s=stripHtml(txt),out={},re=/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(20\d{2})\s+(\d+(?:\.\d+)?)%/g;let m;while((m=re.exec(s))){const k=monthKey(m[1],m[2]);if(k)out[k]=Number(m[3])}return out}
      function parseMonthlyEthBtc(txt){const s=stripHtml(txt),out={},re=/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})\s+(0?\.\d+)/g;let m;while((m=re.exec(s))){const k=monthKey(m[1],m[2]);if(k)out[k]=Number(m[3])}return out}
      const [btcRetPage,btcDomPage,ethBtcPage]=await Promise.all([
        cachedPage('https://www.coinboss.com/today','btc-monthly-returns'),
        cachedPage('https://coinledger.io/research/how-many-cryptocurrencies-are-there','btcdom-monthly'),
        cachedPage('https://www.visualcapitalist.com/ethereum-to-bitcoin-ratio-over-time/','ethbtc-monthly')
      ]);
      const monthlyBtcRet=parseMonthlyBtcReturns(btcRetPage), monthlyBtcDom=parseMonthlyBtcDom(btcDomPage), monthlyEthBtc=parseMonthlyEthBtc(ethBtcPage);
      const btcDomAnnualRef={2013:93.3,2014:88.5,2015:86.3,2016:82.6,2017:58.5,2018:44.6,2019:60.2,2020:62.7,2021:47.6,2022:39.3,2023:45.6,2024:51.9,2025:59.3};
      const ethBtcAnnualRef={2015:0.003,2016:0.017,2017:0.055,2018:0.059,2019:0.026,2020:0.027,2021:0.058,2022:0.070,2023:0.063,2024:0.047,2025:0.027,2026:0.030};
      function monthlyFredValue(a,k){return a.find(z=>z.d.slice(0,7)===k)?.v??null}
      function priorYearFred(a,k){return valueNear(a,Date.parse(k+'-01')-365.25*86400000)}
      function priorMonthFred(a,k,n){return valueNear(a,Date.parse(k+'-01')-n*30.4375*86400000)}
      function monthReturn3(k){const y=Number(k.slice(0,4)),m=Number(k.slice(5));let prod=1,c=0;for(let i=2;i>=0;i--){let yy=y,mm=m-i;while(mm<=0){mm+=12;yy--}const r=monthlyBtcRet[`${yy}-${String(mm).padStart(2,'0')}`];if(Number.isFinite(r)){prod*=1+r/100;c++}}return c===3?(prod-1)*100:null}
      function monthChange(a,k,n=3){const t=Date.parse(k+'-01'),v=monthlyFredValue(a,k),p=valueNear(a,t-n*30.4375*86400000);return Number.isFinite(v)&&Number.isFinite(p)&&p!==0?(v/p-1)*100:null}
      function pctRank(arr,v){if(!Number.isFinite(v))return null;const a=arr.filter(Number.isFinite).sort((x,y)=>x-y);if(a.length<8)return null;let lo=0,hi=a.length;while(lo<hi){const mid=(lo+hi)>>1;if(a[mid]<=v)lo=mid+1;else hi=mid}return 100*(lo-0.5)/a.length}
      const startYM='2013-04',endYM=new Date().toISOString().slice(0,7),months=[];
      {let [yy,mm]=startYM.split('-').map(Number),[ey,em]=endYM.split('-').map(Number);while(yy<ey||(yy===ey&&mm<=em)){months.push(`${yy}-${String(mm).padStart(2,'0')}`);mm++;if(mm>12){mm=1;yy++}}}
      const rawHist=[];
      for(const k of months){
        const g=monthlyM2YoY(k),g3=monthChange(globalRows,k,3);
        const fv=monthlyFredValue(fred.fed,k),fp=priorYearFred(fred.fed,k),fedCh=Number.isFinite(fv)&&Number.isFinite(fp)?fv-fp:null;
        const dollarCh=monthChange(fred.dollar,k,3),oilCh=monthChange(fred.oil,k,3),br=monthReturn3(k);
        const dom=monthlyBtcDom[k]??btcDomAnnualRef[Number(k.slice(0,4))]??null;
        const prevDom=monthlyBtcDom[months[Math.max(0,months.indexOf(k)-1)]]??null;
        const domCh=Number.isFinite(dom)&&Number.isFinite(prevDom)?dom-prevDom:null;
        const eb=monthlyEthBtc[k]??ethBtcAnnualRef[Number(k.slice(0,4))]??null;
        const prevEb=monthlyEthBtc[months[Math.max(0,months.indexOf(k)-3)]]??null;
        const ebCh=Number.isFinite(eb)&&Number.isFinite(prevEb)&&prevEb!==0?(eb/prevEb-1)*100:null;
        // Rotation proxy for history: BTC.D improvement + ETH/BTC improvement.
        // It is explicitly NOT called historical breadth because a clean top-50 breadth
        // history is not available from the same methodology back to 2013.
        const rotationProxy=weightedAvg([
          [Number.isFinite(domCh)?-domCh:null,.55],
          [Number.isFinite(ebCh)?ebCh:null,.45]
        ]);
        rawHist.push({month:k,m2:g,m23:g3,fed:fedCh,dollar:dollarCh,oil:oilCh,btc:br,domLevel:dom,domTrend:domCh,eth:ebCh,rotation:rotationProxy});
      }
      const arrs={m2:rawHist.map(x=>weightedAvg([[x.m2,.6],[x.m23,.4]])),macro:rawHist.map(x=>weightedAvg([[-x.dollar,.55],[-x.fed,.25],[-x.oil,.20]])),btc:rawHist.map(x=>x.btc),dom:rawHist.map(x=>weightedAvg([[60-x.domLevel,.45],[-x.domTrend,.55]])),eth:rawHist.map(x=>x.eth),rot:rawHist.map(x=>x.rotation)};
      const historicalMonthlyScores=rawHist.map((x,i)=>{
        const c=[pctRank(arrs.m2,arrs.m2[i]),pctRank(arrs.macro,arrs.macro[i]),pctRank(arrs.btc,arrs.btc[i]),pctRank(arrs.dom,arrs.dom[i]),pctRank(arrs.eth,arrs.eth[i]),pctRank(arrs.rot,arrs.rot[i])];
        const ws=[20,15,10,20,15,20];let raw=0,w=0;for(let j=0;j<c.length;j++){if(Number.isFinite(c[j])){raw+=c[j]*ws[j];w+=ws[j]}}
        return {month:x.month,score:w>=70?Math.round(raw/w):null,globalM2YoY:x.m2,btcD:x.domLevel,ethBtc:x.month,btcReturn3m:x.btc,rotationProxy:x.rotation,confidence:Math.round(w/100*100)};
      });
      // Fix display-only ETH/BTC field: the raw monthly ETH/BTC level is available from the source.
      historicalMonthlyScores.forEach((r,i)=>{r.ethBtc=rawHist[i].month;const e=monthlyEthBtc[r.month]??ethBtcAnnualRef[Number(r.month.slice(0,4))]??null;r.ethBtc=e});
      const validScores=historicalMonthlyScores.map(x=>x.score).filter(Number.isFinite);
      function quantile(a,q){const v=a.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!v.length)return null;const p=(v.length-1)*q,i=Math.floor(p),f=p-i;return v[i]+(v[i+1]!=null?(v[i+1]-v[i])*f:0)}
      // Empirical zones. We also require that the historical score clears its own
      // distribution for two months before calling the transition "established".
      const q55=Math.round(quantile(validScores,.55)||55), q70=Math.round(quantile(validScores,.70)||70), q85=Math.round(quantile(validScores,.85)||85);
      const anchorWindows=[['2017-05','2018-01'],['2020-07','2021-11']];
      const anchorScores=historicalMonthlyScores.filter(r=>anchorWindows.some(([a,b])=>r.month>=a&&r.month<=b)).map(r=>r.score).filter(Number.isFinite);
      const anchorMedian=Math.round(quantile(anchorScores,.5)||q70);
      const calibrated={watch:Math.min(q55,Math.max(45,anchorMedian-15)),expansion:Math.max(q70,Math.min(85,anchorMedian)),broad:Math.max(q85,Math.min(95,Math.round(anchorMedian+10)))};
      function firstThreshold(th){return historicalMonthlyScores.find(x=>Number.isFinite(x.score)&&x.score>=th)||null}
      function firstPersistentThreshold(th,n){for(let i=0;i<=historicalMonthlyScores.length-n;i++){let ok=true;for(let j=0;j<n;j++){const s=historicalMonthlyScores[i+j]?.score;if(!Number.isFinite(s)||s<th){ok=false;break}}if(ok)return historicalMonthlyScores[i]}return null}
      const thresholdWatch=firstThreshold(calibrated.watch),thresholdExpansion=firstThreshold(calibrated.expansion),thresholdBroad=firstThreshold(calibrated.broad),thresholdExpansionP=firstPersistentThreshold(calibrated.expansion,2);
      const histAnnual=[];
      for(let y=2013;y<=Number(endYM.slice(0,4));y++){const a=historicalMonthlyScores.filter(x=>x.month.startsWith(String(y)));const valid=a.filter(x=>Number.isFinite(x.score));const top=valid.sort((p,q)=>q.score-p.score)[0];histAnnual.push({year:y,score:top?.score??null,peakMonth:top?.month??null,globalM2YoY:top?.globalM2YoY??null,btcD:top?.btcD??null,ethBtc:top?.ethBtc??null,btcReturn:top?.btcReturn3m??null})}
      const macroHistory=globalM2History.slice(-190).map(x=>({d:x.d,v:x.v}));

      // No mixed-provider history. Real CoinGecko checkpoints are returned immediately.
      let domHist=[];
      let domHistoryStatus=btcDominanceSnapshots?"coingecko-checkpoints":"coingecko-unavailable";

      return json({
        ok:true,
        btcDominance,
        btcDominanceSource,
        btcDominanceCrossCheck:crossCheck,
        btcDominanceSnapshots,
        btcDominanceHistory:domHist,
        btcDominanceHistoryLabel:btcDominanceSnapshots?"CoinGecko 체크포인트":"실측 누적",
        dominanceHistoryStatus:domHistoryStatus,
        mayerMultiple:n(mayerPayload?.current),
        mayerHistory:Array.isArray(mayerPayload?.history)?mayerPayload.history:[],
        mayerReference:{deepDiscount:0.8,trend:1.0,historicalOverheat:2.4},
        fearGreed,fearGreedClass,fearGreedHistory,
        macroRegime:{
          score:total,stage,liquidity:liquidityPts,rates:ratesPts,btcScore:btcPts,domScore:domPts,ethScore:Number.isFinite(ethScore)?Math.round(ethScore):null,breadthScore:Number.isFinite(breadthScore)?Math.round(breadthScore):null,altScore:altPts,dataComplete,breadth,ethBtcNow,ethBtcChange,ethBtc7d,ethBtc90d,m2_3m,m2_6m,domDrop30,domDrop90,
          m2:{value:lastFinite(globalRows),yoy:m2YoY,history:macroHistory},
          historicalScores:histAnnual,historicalMonthlyScores,
          thresholds:{watch:calibrated.watch,expansion:calibrated.expansion,broad:calibrated.broad,firstWatch:thresholdWatch?{month:thresholdWatch.month,score:thresholdWatch.score}:null,firstExpansion:thresholdExpansion?{month:thresholdExpansion.month,score:thresholdExpansion.score}:null,firstExpansionPersist2:thresholdExpansionP?{month:thresholdExpansionP.month,score:thresholdExpansionP.score}:null,firstBroad:thresholdBroad?{month:thresholdBroad.month,score:thresholdBroad.score}:null,anchorMedian,anchorWindows},
          fed:{value:lastFinite(fred.fed),change12m:fed12},
          dollar:{value:lastFinite(fred.dollar),change3m:dollar3m},
          oil:{value:lastFinite(fred.oil),change3m:oil3m},
          sp:{value:spNow,change3m:sp3m},
          btc:{value:btcNow,return90d:btc90ret,relativeToSP:btcVsSp,ethBtc:ethBtcNow,ethBtc30dChange:ethBtcChange},
          globalM2:"Global M2 index · US + Euro Area + Japan + UK (USD) · China excluded",
          globalM2Quality:{rows:globalRows.length,us:fred.m2.length,euro:eaM2.length,japan:jpM2.length,uk:ukM4.length,fxEu:fred.eurusd.length,fxJp:fred.jpyusd.length,fxUk:fred.gbpusd.length}
        },
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
