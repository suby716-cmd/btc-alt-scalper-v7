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

      let liquidity=0;
      if(Number.isFinite(m2YoY)) liquidity=m2YoY<=0?0:m2YoY<3?8:m2YoY<6?14:20;
      let rates=0;
      if(Number.isFinite(fed12)) rates += fed12<=-1?10:fed12<0?6:0;
      if(Number.isFinite(dollar3m)) rates += dollar3m<=-2?10:dollar3m<0?6:0;
      let btcScore=Number.isFinite(btc90ret)?(btc90ret<=0?0:btc90ret<10?4:btc90ret<25?7:10):0;
      let domScore=Number.isFinite(dom30)?(dom30<=-3?20:dom30<=-1.5?15:dom30<0?8:dom30<1?3:0):0;
      // Current alt-rotation score uses the actual ETH/BTC ratio when available.
      const ethUpbit=await fetchJson("https://api.upbit.com/v1/candles/days?market=KRW-ETH&count=120",9000);
      const ethRows=Array.isArray(ethUpbit.body)?ethUpbit.body.slice().sort((a,b)=>a.timestamp-b.timestamp):[];
      const ethNow=n(ethRows.at(-1)?.trade_price), eth30=n(ethRows.at(-31)?.trade_price);
      const ethBtcNow=Number.isFinite(ethNow)&&Number.isFinite(btcNow)&&btcNow!==0?ethNow/btcNow:null;
      const ethBtc30=Number.isFinite(eth30)&&Number.isFinite(btc90)&&btc90!==0?eth30/btc90:null;
      const ethBtcChange=Number.isFinite(ethBtcNow)&&Number.isFinite(ethBtc30)&&ethBtc30!==0?(ethBtcNow/ethBtc30-1)*100:null;
      let altScore=Number.isFinite(ethBtcChange)?(ethBtcChange>8?10:ethBtcChange>3?7:ethBtcChange>0?4:0):(Number.isFinite(btcVsSp)?(btcVsSp>20?5:btcVsSp>0?2:0):0);
      const rawTotal=liquidity+rates+btcScore+domScore+altScore; const total=Math.max(0,Math.min(100,Math.round(rawTotal/80*100)));
      const stage=total>=75?"광범위한 알트 강세 환경":total>=60?"알트 확산":total>=40?"순환매 준비":"BTC 중심 장세";

      // Historical monthly ALTSEASON SCORE reconstruction (2013~2026).
      // Monthly macro data is measured directly. Crypto breadth inputs use public monthly
      // BTC returns, BTC.D, and ETH/BTC datasets where available; missing early/current
      // observations fall back to the published annual reference values.
      async function cachedPage(url,key,ttl=21600){
        try{
          const c=typeof caches!=="undefined"?caches.default:null, ck=new Request("https://macro-cache.local/"+key);
          if(c){const hit=await c.match(ck);if(hit){return await hit.text()}}
          const r=await fetchRawText(url); if(!r.ok)return "";
          if(c) await c.put(ck,new Response(r.body,{headers:{"Cache-Control":`public,max-age=${ttl}`}}));
          return r.body||"";
        }catch{return ""}
      }
      function stripHtml(t){return (t||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim()}
      function monthKey(mon,y){const mm={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12}[mon];return mm?`${y}-${String(mm).padStart(2,'0')}`:null}
      function parseMonthlyBtcReturns(txt){
        const s=stripHtml(txt), out={};
        const re=/(20\d{2})\s+((?:[+\-]?\d+(?:\.\d+)?%|—)(?:\s+(?:[+\-]?\d+(?:\.\d+)?%|—)){11})/g; let m;
        while((m=re.exec(s))){const vals=m[2].trim().split(/\s+/); for(let i=0;i<12;i++){const v=Number(vals[i]?.replace('%','')); if(Number.isFinite(v))out[`${m[1]}-${String(i+1).padStart(2,'0')}`]=v;}}
        return out;
      }
      function parseMonthlyBtcDom(txt){
        const s=stripHtml(txt),out={},re=/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(20\d{2})\s+(\d+(?:\.\d+)?)%/g; let m;
        while((m=re.exec(s))){const k=monthKey(m[1],m[2]);if(k)out[k]=Number(m[3]);} return out;
      }
      function parseMonthlyEthBtc(txt){
        const s=stripHtml(txt),out={},re=/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})\s+(0?\.\d+)/g; let m;
        while((m=re.exec(s))){const k=monthKey(m[1],m[2]);if(k)out[k]=Number(m[3]);} return out;
      }
      const [btcRetPage,btcDomPage,ethBtcPage]=await Promise.all([
        cachedPage('https://www.coinboss.com/today','btc-monthly-returns'),
        cachedPage('https://coinledger.io/research/how-many-cryptocurrencies-are-there','btcdom-monthly'),
        cachedPage('https://www.visualcapitalist.com/ethereum-to-bitcoin-ratio-over-time/','ethbtc-monthly')
      ]);
      const monthlyBtcRet=parseMonthlyBtcReturns(btcRetPage);
      const monthlyBtcDom=parseMonthlyBtcDom(btcDomPage);
      const monthlyEthBtc=parseMonthlyEthBtc(ethBtcPage);
      // Fill 2025~2026 ETH/BTC with current published annual references when a monthly
      // public table is not available. The chart labels this as reconstructed data.
      const ethBtcAnnualRef={2015:0.003,2016:0.017,2017:0.055,2018:0.059,2019:0.026,2020:0.027,2021:0.058,2022:0.070,2023:0.063,2024:0.047,2025:0.027,2026:0.030};
      const btcDomAnnualRef={2013:93.3,2014:88.5,2015:86.3,2016:82.6,2017:58.5,2018:44.6,2019:60.2,2020:62.7,2021:47.6,2022:39.3,2023:45.6,2024:51.9,2025:59.3};
      const btcAnnualRef={2013:457,2014:-58,2015:34,2016:124,2017:1414,2018:-75,2019:94,2020:308,2021:57,2022:-64,2023:154,2024:142,2025:-7,2026:-4};
      function nearestMonthValue(a,k){
        const y=Number(k.slice(0,4)); if(a[k]!=null)return a[k];
        const vals=Object.entries(a).filter(([q])=>q.slice(0,4)==String(y)).map(([,v])=>v);
        return vals.length?vals.reduce((p,v)=>p+v,0)/vals.length:null;
      }
      function monthlyM2YoY(k){const x=globalRows.find(z=>z.d.slice(0,7)===k); if(!x)return null; const p=globalRows.find(z=>z.d.slice(0,7)===`${Number(k.slice(0,4))-1}-${k.slice(5)}`); return p?.v?((x.v/p.v)-1)*100:null;}
      function monthlyFredValue(a,k){return a.find(z=>z.d.slice(0,7)===k)?.v??null}
      function priorYearFred(a,k){const t=Date.parse(k+'-01');return valueNear(a,t-365.25*86400000)}
      function priorMonthFred(a,k,n){const t=Date.parse(k+'-01');return valueNear(a,t-n*30.4375*86400000)}
      function monthReturn3(k){const y=Number(k.slice(0,4)),m=Number(k.slice(5)); let prod=1,c=0; for(let i=2;i>=0;i--){let yy=y,mm=m-i;while(mm<=0){mm+=12;yy--} const r=monthlyBtcRet[`${yy}-${String(mm).padStart(2,'0')}`]; if(Number.isFinite(r)){prod*=1+r/100;c++}} return c===3?(prod-1)*100:null}
      const historicalMonthlyScores=[];
      const startYM='2013-04', endYM=new Date().toISOString().slice(0,7);
      const months=[]; {let [yy,mm]=startYM.split('-').map(Number), [ey,em]=endYM.split('-').map(Number); while(yy<ey||(yy===ey&&mm<=em)){months.push(`${yy}-${String(mm).padStart(2,'0')}`);mm++;if(mm>12){mm=1;yy++;}}}
      for(const k of months){
        const g=monthlyM2YoY(k), l=Number.isFinite(g)?(g<=0?0:g<3?8:g<6?14:20):null;
        const fv=monthlyFredValue(fred.fed,k), fp=priorYearFred(fred.fed,k); let rs=0,rw=0;
        if(Number.isFinite(fv)&&Number.isFinite(fp)){const ch=fv-fp;rs+=(ch<=-1?10:ch<0?6:0);rw+=10;}
        const dv=monthlyFredValue(fred.dollar,k), dp=priorMonthFred(fred.dollar,k,3); if(Number.isFinite(dv)&&Number.isFinite(dp)&&dp!==0){const ch=(dv/dp-1)*100;rs+=(ch<=-2?10:ch<0?6:0);rw+=10;}
        const br=monthReturn3(k), bs=Number.isFinite(br)?(br<=0?0:br<10?4:br<25?7:10):null;
        let dom=monthlyBtcDom[k]??btcDomAnnualRef[Number(k.slice(0,4))]??null; let domPrev=monthlyBtcDom[months[Math.max(0,months.indexOf(k)-1)]]??null;
        let ds=Number.isFinite(dom)&&Number.isFinite(domPrev)?(dom-domPrev<=-3?20:dom-domPrev<=-1.5?15:dom-domPrev<0?8:dom-domPrev<1?3:0):null;
        if(ds===null&&Number.isFinite(dom)) ds=dom<=40?20:dom<=48?15:dom<=60?8:dom<=70?3:0;
        const eb=monthlyEthBtc[k]??ethBtcAnnualRef[Number(k.slice(0,4))]??null;
        const ebPrev=monthlyEthBtc[months[Math.max(0,months.indexOf(k)-3)]]??null;
        let as=Number.isFinite(eb)&&Number.isFinite(ebPrev)&&ebPrev!==0?((eb/ebPrev-1)*100>8?10:(eb/ebPrev-1)*100>3?7:(eb/ebPrev-1)*100>0?4:0):null;
        if(as===null&&Number.isFinite(eb)) as=eb>=0.06?10:eb>=0.045?7:eb>=0.03?4:0;
        const weights={l:20,r:20,b:10,d:20,a:10}; let raw=0,weight=0; for(const [v,w] of [[l,20],[rs,20],[bs,10],[ds,20],[as,10]]){if(Number.isFinite(v)){raw+=v;weight+=w}}
        const score=weight>=50?Math.max(0,Math.min(100,Math.round(raw/weight*100))):null;
        historicalMonthlyScores.push({month:k,score,globalM2YoY:g,btcD:dom,ethBtc:eb,btcReturn3m:br});
      }
      const histMax=[...historicalMonthlyScores].filter(x=>Number.isFinite(x.score)).sort((a,b)=>b.score-a.score).slice(0,12);
      function firstThreshold(th){return historicalMonthlyScores.find(x=>Number.isFinite(x.score)&&x.score>=th)||null;}
      function firstPersistentThreshold(th,n){for(let i=0;i<=historicalMonthlyScores.length-n;i++){let ok=true;for(let j=0;j<n;j++){const s=historicalMonthlyScores[i+j]?.score;if(!Number.isFinite(s)||s<th){ok=false;break}}if(ok)return historicalMonthlyScores[i];}return null;}
      const threshold60=firstThreshold(60), threshold75=firstThreshold(75), threshold60p=firstPersistentThreshold(60,2);
      const histAnnual=[];
      for(let y=2013;y<=Number(endYM.slice(0,4));y++){const a=historicalMonthlyScores.filter(x=>x.month.startsWith(String(y)));const valid=a.filter(x=>Number.isFinite(x.score));const top=valid.sort((p,q)=>q.score-p.score)[0];histAnnual.push({year:y,score:top?.score??null,peakMonth:top?.month??null,globalM2YoY:a.filter(x=>Number.isFinite(x.globalM2YoY)).at(-1)?.globalM2YoY??null,btcD:top?.btcD??btcDomAnnualRef[y]??null,ethBtc:top?.ethBtc??ethBtcAnnualRef[y]??null,btcReturn:top?.btcReturn3m??null});}
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
          score:total,stage,liquidity,rates,btcScore,domScore,altScore,
          m2:{value:lastFinite(globalRows),yoy:m2YoY,history:macroHistory},
          historicalScores:histAnnual,historicalMonthlyScores,
          thresholds:{
            first60:threshold60?{month:threshold60.month,score:threshold60.score}:null,
            first60Persist2:threshold60p?{month:threshold60p.month,score:threshold60p.score}:null,
            first75:threshold75?{month:threshold75.month,score:threshold75.score}:null
          },
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
