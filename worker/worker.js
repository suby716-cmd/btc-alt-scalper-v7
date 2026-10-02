// worker/worker.js — BTC ALT REGIME TRADER v10.8.1-minimal+pin+altseason-v3 (routes normalized, JSON 404, deploy check in /health)
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

let ENV_REF = null; // 요청마다 갱신 (FRED_API_KEY 선택 사용)

async function fetchJson(url, ms = 5000, hdr = null) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: hdr || { Accept: "application/json", "User-Agent": "BTC-ALT-REGIME-TRADER/10.4.0-minimal" },
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


async function fetchText(url, ms = 8000, hdr = null) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers: hdr || {
      "Accept":"text/html,application/xhtml+xml",
      "User-Agent":"Mozilla/5.0 (compatible; BTC-ALT-REGIME-TRADER/8.4.4)"
    }, signal:c.signal });
    const tx = await r.text().catch(() => "");
    return { ok: r.ok, status: r.status, body: r.ok ? tx : "", snip: r.ok ? "" : tx.slice(0, 120) };
  } catch(e) { return { ok:false, status:0, error:String(e?.message||e), body:"" }; }
  finally { clearTimeout(t); }
}
// CSV/데이터 API용 헤더 (ECB 등은 Accept: text/html 이면 406을 돌려준다)
const CSV_HDR = {
  "Accept": "text/csv,text/plain,application/json;q=0.9,*/*;q=0.8",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
};

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
  const last=a[a.length-1]?.v;
  const prev=a[Math.max(0,a.length-1-n)]?.v;
  return Number.isFinite(last)&&Number.isFinite(prev)&&prev!==0?(last/prev-1)*100:null;
}
async function fetchFredCsv(series,start="2011-01-01"){
  const [base, query=''] = String(start).split('__EXTRA__');
  return fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series)}&cosd=${base}${query}`,12000,CSV_HDR);
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


// =====================================================================
// ALTSEASON ENGINE v2  (worker v10.6.0)
//  - /altseason  : 월별 역사 재구성 + 현재 점수 + 알트 확산도 + 유사시기 + 보정표
//  - 모든 월별 입력은 "같은 공식"으로 과거/현재를 함께 계산한다 (과거표와 현재점수의 규칙 불일치 제거)
//  - 웹페이지 스크래핑(HTML 정규식) 제거 → FRED / ECB / BoJ / BoE / blockchain.info / DefiLlama / (CMC 옵션)
// =====================================================================
const DAY = 86400000;
const MEMCACHE = new Map();

const mkey = t => { const d = new Date(t); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 7) : null; };
function addM(k, n) { const [y, m] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); }
function monthEnd(k) { const [y, m] = k.split("-").map(Number); return Date.UTC(y, m, 1) - 1; }
function monthsBetween(a, b) { const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number); return (yb - ya) * 12 + (mb - ma); }
const fin = x => typeof x === "number" && Number.isFinite(x);
const r3 = (x, d = 3) => fin(x) ? Math.round(x * 10 ** d) / 10 ** d : null;
const pctOf = (a, b) => fin(a) && fin(b) && b !== 0 ? (a / b - 1) * 100 : null;
function bsearchLE(arr, t) { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
function valAt(arr, t, maxAge = Infinity) { if (!arr || !arr.length) return null; const i = bsearchLE(arr, t); if (i < 0) return null; if (t - arr[i].t > maxAge) return null; return arr[i].v; }
function monthMap(series) { const s = new Map(), c = new Map(); for (const x of (series || [])) { const k = mkey(x?.t), v = Number(x?.v); if (!k || !Number.isFinite(v)) continue; s.set(k, (s.get(k) || 0) + v); c.set(k, (c.get(k) || 0) + 1); } const o = new Map(); for (const [k, v] of s) o.set(k, v / c.get(k)); return o; }
function monthLast(series) { const o = new Map(); for (const x of (series || []).slice().sort((a,b)=>a.t-b.t)) { const k=mkey(x?.t), v=Number(x?.v); if(k && Number.isFinite(v)) o.set(k,v); } return o; }
function lookback(map, k, n) { for (let i = 0; i <= n; i++) { const v = map.get(addM(k, -i)); if (v != null) return v; } return null; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// KV(있으면) + 메모리 캐시. 실패 결과는 캐시하지 않고, 갱신 실패 시 오래된 캐시를 대신 돌려준다.
async function cached(env, key, ttlSec, producer, isGood, force = false) {
  const now = Date.now();
  let stale = MEMCACHE.get(key) || null;
  if (!force && stale && stale.exp > now) return { ...stale.val, cache: "memory" };
  if (env && env.SCALPER_KV) {
    try {
      const s = await env.SCALPER_KV.get(key, "json");
      if (s && s.val) {
        if (!force && s.exp > now) { MEMCACHE.set(key, s); return { ...s.val, cache: "kv" }; }
        if (!stale || s.exp > stale.exp) stale = s;
      }
    } catch {}
  }
  let val = null;
  try { val = await producer(); } catch (e) { val = { ok: false, error: String(e?.message || e) }; }
  if (val && isGood(val)) {
    const rec = { exp: now + ttlSec * 1000, val };
    MEMCACHE.set(key, rec);
    if (env && env.SCALPER_KV) { try { await env.SCALPER_KV.put(key, JSON.stringify(rec), { expirationTtl: Math.max(60, ttlSec * 8) }); } catch {} }
    return { ...val, cache: "fresh" };
  }
  if (stale && stale.val) return { ...stale.val, cache: "stale", staleReason: val?.error || "refresh failed" };
  return val || { ok: false, error: "UNAVAILABLE" };
}

// ---------- parsers (CPU 절약형) ----------
function parseFredFast(txt) {
  const out = []; if (!txt) return out;
  let i = txt.indexOf("\n"); if (i < 0) return out; i++;
  const n = txt.length;
  while (i < n) {
    let j = txt.indexOf("\n", i); if (j < 0) j = n;
    const c = txt.indexOf(",", i);
    if (c - i === 10 && c < j && txt.charCodeAt(i + 4) === 45) {
      const v = parseFloat(txt.slice(c + 1, j));
      if (v === v) out.push({ t: Date.UTC(+txt.slice(i, i + 4), +txt.slice(i + 5, i + 7) - 1, +txt.slice(i + 8, i + 10)), v });
    }
    i = j + 1;
  }
  return out;
}
async function fredApiSeries(id, start, monthly, aggregation) {
  const key = ENV_REF && ENV_REF.FRED_API_KEY;
  if (!key) return null;
  const extra = monthly ? `&frequency=m&aggregation_method=${encodeURIComponent(aggregation)}` : "";
  const r = await fetchJson(`https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(id)}&api_key=${encodeURIComponent(key)}&file_type=json&observation_start=${start}${extra}`, 12000);
  const obs = Array.isArray(r.body?.observations) ? r.body.observations : [];
  const series = [];
  for (const o of obs) { const v = parseFloat(o.value); const t = Date.parse(o.date); if (v === v && t === t) series.push({ t, v }); }
  return { ok: series.length > 0, status: r.status, series, via: "api" };
}
async function fredSeries(id, start, monthly=false, aggregation='avg') {
  // 1) (선택) FRED_API_KEY가 있으면 공식 API 먼저
  const api = await fredApiSeries(id, start, monthly, aggregation);
  if (api && api.ok) return api;
  // 2) 공개 CSV: 월평균 변환 → 실패 시 원본 → 한 번 더 대기 후 재시도
  const extra = monthly ? `&fq=Monthly&fam=${encodeURIComponent(aggregation)}` : '';
  let r = await fetchFredCsv(id, `${start}__EXTRA__${extra}`);
  const blocked = x => !x.ok && (x.status === 403 || x.status === 429 || x.status >= 500);
  if ((!r.ok || !r.body) && !blocked(r)) { await sleep(500); r = await fetchFredCsv(id, start); }
  if ((!r.ok || !r.body) && !blocked(r) && r.status !== 404) { await sleep(1200); r = await fetchFredCsv(id, start); }
  const series = parseFredFast(r.body);
  return { ok: series.length > 0, status: r.status, series, via: "csv", snip: r.snip, error: r.error };
}
const splitCsv = line => line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
async function fetchEcbM2() {
  const url = "https://data-api.ecb.europa.eu/service/data/BSI/M.U2.Y.V.M20.X.1.U2.2300.Z01.E?startPeriod=2011-01&format=csvdata";
  const r = await fetchText(url, 12000, CSV_HDR); const map = new Map();
  if (r.ok) {
    const lines = r.body.trim().split(/\r?\n/).map(splitCsv);
    const h = lines.findIndex(x => x.includes("TIME_PERIOD") && x.includes("OBS_VALUE"));
    if (h >= 0) { const hi = lines[h].indexOf("TIME_PERIOD"), vi = lines[h].indexOf("OBS_VALUE"); for (const x of lines.slice(h + 1)) { const v = Number(x[vi]); if (x[hi] && fin(v)) map.set(x[hi].slice(0, 7), v / 1000); } } // 백만 EUR → 십억 EUR
  }
  return { ok: map.size > 0, status: r.status, map };
}
async function fetchBojM2(nowMs) {
  const end = mkey(nowMs).replace("-", "");
  const urls = [
    `https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=MD02&startDate=201101&endDate=${end}&code=MAM1NAM2M2MO`,
    `https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=MD&startDate=201101&endDate=${end}&code=${encodeURIComponent("MD02'MAM1NAM2M2MO")}`
  ];
  let status = 0;
  for (const url of urls) {
    const r = await fetchText(url, 12000, CSV_HDR); status = r.status; const map = new Map();
    if (r.ok) {
      const rows = r.body.trim().split(/\r?\n/).map(splitCsv);
      for (const p of rows) {           // 행 형식: ..., 202501, 1234.5
        for (let i = 0; i < p.length - 1; i++) { const m = p[i].match(/^(\d{4})[\/-]?(\d{2})$/); const v = Number(p[i + 1]); if (m && +m[2] >= 1 && +m[2] <= 12 && fin(v) && p[i + 1] !== "") map.set(`${m[1]}-${m[2]}`, v * 0.1); }
      }
      if (!map.size) {                  // 열 형식: 날짜 행 + 값 행
        for (let i = 0; i < rows.length - 1; i++) { const d = rows[i].filter(x => /^\d{6}$/.test(x)); if (d.length > 10) { const vals = rows[i + 1].filter(x => x !== "" && fin(Number(x))).slice(-d.length); if (vals.length === d.length) d.forEach((x, k) => map.set(`${x.slice(0, 4)}-${x.slice(4)}`, Number(vals[k]) * 0.1)); } }
      }
    }
    if (map.size) return { ok: true, status, map };
  }
  return { ok: false, status, map: new Map() };
}
async function fetchBoeM4(nowMs) {
  const d = new Date(nowMs), mon = Object.keys(MON)[d.getUTCMonth()];
  const url = `https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/2011&Dateto=28/${mon}/${d.getUTCFullYear()}&SeriesCodes=LPMAUYN&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`;
  const r = await fetchText(url, 12000, CSV_HDR); const map = new Map();
  if (r.ok) {
    const lines = r.body.trim().split(/\r?\n/).map(splitCsv);
    const h = lines.findIndex(x => x.some(v => v.includes("LPMAUYN")));
    for (const x of lines.slice(h + 1)) {
      const m = (x[0] || "").match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/); const v = Number(x[1]);
      if (m && MON[m[2]] && fin(v)) map.set(`${m[3]}-${String(MON[m[2]]).padStart(2, "0")}`, v / 1000); // 백만 GBP → 십억 GBP
    }
  }
  return { ok: map.size > 0, status: r.status, map };
}
async function fetchBtcPrice() {
  const r = await fetchJson("https://api.blockchain.info/charts/market-price?timespan=all&sampled=true&metadata=false&cors=true&format=json", 15000);
  const vals = Array.isArray(r.body?.values) ? r.body.values : [];
  const series = vals.map(x => ({ t: x.x * 1000, v: Number(x.y) })).filter(x => fin(x.t) && x.v > 0).sort((a, b) => a.t - b.t);
  return { ok: series.length > 100, status: r.status, series };
}
async function fetchStable() {
  const r = await fetchJson("https://stablecoins.llama.fi/stablecoincharts/all", 15000);
  const a = Array.isArray(r.body) ? r.body : [];
  const series = a.map(x => ({ t: Number(x.date) * 1000, v: Number(x.totalCirculatingUSD?.peggedUSD ?? x.totalCirculating?.peggedUSD) / 1e9 }))
    .filter(x => fin(x.t) && x.v > 0).sort((p, q) => p.t - q.t);
  return { ok: series.length > 100, status: r.status, series };
}
// 선택 소스: 월별 BTC.D 실측(CoinMarketCap 공개 차트 데이터). 실패하면 연평균 앵커 보간(근사)로 대체된다.
async function fetchCmcDominance(nowMs) {
  const url = `https://api.coinmarketcap.com/data-api/v3/global-metrics/quotes/historical?format=chart&interval=7d&timeStart=${Math.floor(Date.UTC(2013, 3, 28) / 1000)}&timeEnd=${Math.floor(nowMs / 1000)}`;
  const r = await fetchJson(url, 15000);
  const q = Array.isArray(r.body?.data?.quotes) ? r.body.data.quotes : [];
  const series = [];
  for (const x of q) {
    const t = Date.parse(x.timestamp || x.quote?.[0]?.timestamp); const v = Number(x.btcDominance ?? x.quote?.[0]?.btcDominance);
    if (fin(t) && v > 20 && v < 100) series.push({ t, v });
  }
  series.sort((a, b) => a.t - b.t);
  // 주간 이하로 다운샘플
  const out = []; let last = -1; for (const s of series) { if (s.t - last >= 6 * DAY) { out.push([s.t, r3(s.v, 2)]); last = s.t; } }
  return { ok: out.length > 100, status: r.status, series: out };
}

// ---------- Global M2 (USD) ----------
// v8.8 Global M2 upgrade:
// CORE     = US + Euro Area + Japan + UK
// EXTENDED = CORE + China + Canada + Korea + Switzerland
// All components are converted to USD and are kept separate so a temporary
// failure in an EXTENDED country never breaks CORE.
// CORE is used by the existing ALTSEASON score; EXTENDED is an additional
// liquidity breadth indicator returned by /altseason.
const M2_RANGE = {
  US: [5000, 40000], EA: [5000, 40000], JP: [2000, 30000], UK: [1000, 10000],
  CN: [10000, 50000], CA: [500, 5000], KR: [500, 10000], CH: [200, 3000]
};

function parseFlexibleMonthlyJson(body) {
  const out = [];
  const walk = (x) => {
    if (!x) return;
    if (Array.isArray(x)) { for (const v of x) walk(v); return; }
    if (typeof x !== 'object') return;
    const date = x.period ?? x.date ?? x.TIME_PERIOD ?? x.time ?? x.d ?? x.Date;
    const val = x.value ?? x.v ?? x.VALUE ?? x.OBS_VALUE ?? x.Value ?? x.amount;
    if (date != null && val != null) {
      const ds = String(date).replace(/\//g, '-');
      const m = ds.match(/(20\d{2})[-]?(\d{2})/);
      const v = Number(String(val).replace(/,/g, ''));
      if (m && Number.isFinite(v)) out.push({ d: `${m[1]}-${m[2]}-01`, v });
    }
    for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v);
  };
  walk(body);
  const m = new Map(); for (const x of out) m.set(x.d.slice(0,7), x.v);
  return [...m].map(([k,v])=>({d:k+'-01',v})).sort((a,b)=>a.d.localeCompare(b.d));
}

function parseGenericMonthlyCsv(txt) {
  const out = []; if (!txt) return out;
  const rows = txt.trim().split(/\r?\n/).map(splitCsv);
  if (!rows.length) return out;
  const header = rows[0].map(x => String(x || '').trim().toLowerCase());
  const dateIdx = header.findIndex(x => /date|period|time/.test(x));
  let valueIdx = header.findIndex(x => /value|obs_value|gm2|m2/.test(x));
  if (valueIdx < 0) valueIdx = dateIdx >= 0 ? rows[0].length - 1 : 1;
  for (const r of rows.slice(1)) {
    const rawDate = r[dateIdx >= 0 ? dateIdx : 0];
    const rawVal = r[valueIdx];
    const m = String(rawDate || '').match(/(20\d{2})[-/.]?(\d{2})/);
    const v = Number(String(rawVal || '').replace(/,/g,''));
    if (m && Number.isFinite(v)) out.push({d:`${m[1]}-${m[2]}-01`,v});
  }
  const map = new Map(); for (const x of out) map.set(x.d.slice(0,7),x.v);
  return [...map].map(([k,v])=>({d:k+'-01',v})).sort((a,b)=>a.d.localeCompare(b.d));
}

async function fetchChinaM2() {
  // Free public dataset sourced from People's Bank of China (PBoC).
  // This is used only for EXTENDED; failure never affects CORE.
  try {
    const r = await fetchJson('https://chinadata.live/api/v2/data/china-m2-money-supply', 12000);
    const series = parseFlexibleMonthlyJson(r.body).map(x => ({ d:x.d, v:x.v / 10000 }));
    // Source unit: 100 million CNY -> trillion CNY -> billion CNY / 1000.
    // x.v/10000 = trillion CNY; convert below to billion CNY.
    const fixed = series.map(x=>({d:x.d,v:x.v*1000}));
    return {ok:fixed.length>24,status:r.status,series:fixed,via:'chinadata-pbc'};
  } catch(e) { return {ok:false,status:0,series:[],via:'chinadata-pbc',error:String(e?.message||e)}; }
}

async function fetchCanadaM2() {
  // Bank of Canada Valet: no API key required. V41552796 = M2 gross, SA, CAD millions.
  try {
    const url='https://www.bankofcanada.ca/valet/observations/series/V41552796/json?start_date=2010-06-01';
    const r=await fetchJson(url,12000);
    const obs=Array.isArray(r.body?.observations)?r.body.observations:[];
    const series=obs.map(x=>({d:String(x.d).slice(0,7)+'-01',v:Number(x.V41552796)/1000}))
      .filter(x=>Number.isFinite(x.v)&&x.v>0).sort((a,b)=>a.d.localeCompare(b.d));
    return {ok:series.length>24,status:r.status,series,via:'bankofcanada-valet'};
  } catch(e){return {ok:false,status:0,series:[],via:'bankofcanada-valet',error:String(e?.message||e)};}
}

async function fetchKoreaM2() {
  // Bank of Korea ECOS: full history with a free personal key; without one,
  // use the public demo key for the most recent <=10 observations so the
  // current EXTENDED snapshot still contains Korea. The demo is row-limited.
  const personal = ENV_REF?.BOK_ECOS_API_KEY || '';
  const key = personal || 'sample';
  const end = mkey(Date.now());
  const start = personal ? '201006' : addM(end, -9);
  try {
    const url=`https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(key)}/json/en/1/${personal?500:10}/101Y004/M/${start}/${end}/BBHA00`;
    const r=await fetchJson(url,15000);
    const rows=Array.isArray(r.body?.StatisticSearch?.row)?r.body.StatisticSearch.row:[];
    // ECOS M2 is in billion KRW.
    const series=rows.map(x=>({d:String(x.TIME).slice(0,7)+'-01',v:Number(String(x.DATA_VALUE||'').replace(/,/g,''))}))
      .filter(x=>/^20\d{2}-\d{2}-01$/.test(x.d)&&Number.isFinite(x.v)&&x.v>0)
      .sort((a,b)=>a.d.localeCompare(b.d));
    return {ok:personal?series.length>24:series.length>0,status:r.status,series,via:personal?'bok-ecos':'bok-ecos-sample',error:personal?undefined:'demo key: recent 10 rows only'};
  } catch(e){return {ok:false,status:0,series:[],via:personal?'bok-ecos':'bok-ecos-sample',error:String(e?.message||e)};}
}

async function fetchSwissM2() {
  // SNB data portal cube: D0(B) = end-of-month, D1(GM2) = M2.
  try {
    const url='https://data.snb.ch/api/cube/snbmonagg/data/csv/en?dimSel=D0(B),D1(GM2)&fromDate=2010-06&toDate=2026-12';
    const r=await fetchText(url,15000,CSV_HDR);
    const series=parseGenericMonthlyCsv(r.body).map(x=>({d:x.d,v:x.v/1000}));
    // SNB source is CHF millions -> CHF billions.
    return {ok:series.length>24,status:r.status,series,via:'snb'};
  } catch(e){return {ok:false,status:0,series:[],via:'snb',error:String(e?.message||e)};}
}

function monthMapM2Series(series) {
  // M2 country feeds use {d:'YYYY-MM-01', v} while FX/FRED feeds use {t:ms, v}.
  // Normalize both shapes before month aggregation so an EXTENDED feed can never
  // pass an undefined timestamp into new Date().
  const normalized = [];
  for (const x of (series || [])) {
    const raw = x?.t != null ? x.t : x?.d;
    let t = Number(raw);
    if (!Number.isFinite(t)) t = Date.parse(String(raw || ''));
    if (!Number.isFinite(t)) continue;
    const v = Number(x?.v);
    if (Number.isFinite(v)) normalized.push({ t, v });
  }
  return monthMap(normalized);
}

function buildGlobalM2(f, ea, jp, uk, curK) {
  const fx = {
    eu: monthMap(f.eurusd?.series || []),
    jp: monthMap(f.jpyusd?.series || []),
    uk: monthMap(f.gbpusd?.series || [])
  };
  const keys = []; for (let k = "2010-06"; k <= curK; k = addM(k, 1)) keys.push(k);
  const defs = [
    { name:"US", map:f.m2.ok?monthMap(f.m2.series):null, fx:null, conv:v=>v },
    { name:"EA", map:ea.ok?ea.map:null, fx:fx.eu, conv:(v,r)=>v*r },
    { name:"JP", map:jp.ok?jp.map:null, fx:fx.jp, conv:(v,r)=>v/r },
    { name:"UK", map:uk.ok?uk.map:null, fx:fx.uk, conv:(v,r)=>v*r }
  ];
  const used=[], rejected=[], usd=[];
  for (const d of defs) {
    if (!d.map || !d.map.size) { rejected.push({name:d.name,why:'데이터 없음'}); continue; }
    const out=new Map();
    for (const k of keys) {
      const raw=lookback(d.map,k,3), rate=d.fx?lookback(d.fx,k,2):1;
      if(raw==null || rate==null || rate===0 || !Number.isFinite(raw) || !Number.isFinite(rate)) continue;
      const v=d.conv(raw,rate); if(Number.isFinite(v)) out.set(k,v);
    }
    const vals=[...out.values()].filter(Number.isFinite).sort((a,b)=>a-b), med=vals.length?vals[vals.length>>1]:null;
    const ranges={US:[5000,40000],EA:[5000,40000],JP:[2000,30000],UK:[1000,10000]};
    const [lo,hi]=ranges[d.name];
    if(!vals.length || !(med>=lo&&med<=hi)) { rejected.push({name:d.name,why:`단위/범위 이상 (중앙값 ${r3(med,0)}B USD)`}); continue; }
    used.push(d.name); usd.push(out);
  }
  const global=new Map();
  if(usd.length===4) for(const k of keys){let sum=0,ok=true;for(const m of usd){const v=m.get(k);if(v==null){ok=false;break;}sum+=v;}if(ok&&Number.isFinite(sum))global.set(k,sum);}
  const yoy=new Map(); for(const [k,v] of global){const p=global.get(addM(k,-12));if(Number.isFinite(p)&&p!==0)yoy.set(k,(v/p-1)*100);}
  return {global,yoy,used,rejected,lastK:[...global.keys()].pop()||null};
}
// ---------- 월별 특징 ----------
function featureRow(k, t, live, c) {
  const lag = addM(k, -1); // 발표지연/룩어헤드 방지: M2는 한 달 전 공개분을 사용
  const y = c.yoy.get(lag) ?? null, y6 = c.yoy.get(addM(lag, -6)) ?? null;
  const fedNow = lookback(c.fedM, lag, 1), fedPrev = c.fedM.get(addM(lag, -12)) ?? null;
  const dolNow = lookback(c.dolM, lag, 1), dolPrev = c.dolM.get(addM(lag, -3)) ?? null;
  const oilNow = lookback(c.oilM, lag, 1), oilPrev = c.oilM.get(addM(lag, -3)) ?? null;
  const spNow = lookback(c.spM, lag, 1), spPrev = c.spM.get(addM(lag, -3)) ?? null;
  const y10Now = lookback(c.y10M, lag, 1), y10Prev = c.y10M.get(addM(lag, -3)) ?? null;
  const btcNow = lookback(c.btcM, k, 1), btcPrev = c.btcM.get(addM(k, -3)) ?? null;
  const eb = lookback(c.ethBtcM, k, 1), eb0 = c.ethBtcM.get(addM(k, -3)) ?? null;
  const st = lookback(c.stableM, k, 2), st0 = c.stableM.get(addM(k, -3)) ?? null;
  return {
    k, t, live,
    m2yoy: r3(y, 2), m2accel: fin(y) && fin(y6) ? r3(y - y6, 2) : null,
    fed12: fin(fedNow) && fin(fedPrev) ? r3(fedNow - fedPrev, 2) : null, fedLvl: r3(fedNow, 2),
    dollar3m: r3(pctOf(dolNow, dolPrev), 2), oil3m: r3(pctOf(oilNow, oilPrev), 2), sp90: r3(pctOf(spNow, spPrev), 2),
    us10y: r3(y10Now, 2), us10y3m: r3(pctOf(y10Now, y10Prev), 2),
    btc: r3(btcNow, 0), btc90: r3(pctOf(btcNow, btcPrev), 2),
    ethbtc: r3(eb, 5), eth90: r3(pctOf(eb, eb0), 2), stable90: r3(pctOf(st, st0), 2)
  };
}

// ---------- FRED 없이 쓰는 대체 소스 (가입/키 불필요) ----------
//  S&P500·달러지수·WTI·미 10년물: Yahoo Finance 월봉 → 실패 시 Stooq 월봉
//  연방기금금리: 뉴욕연은 EFFR API → 실패 시 Yahoo ^IRX(13주 T-bill) 근사
//  환율(EUR/JPY/GBP→USD): ECB 환율 CSV (M2 USD 환산용)
//  ETH/BTC: Yahoo ETH-BTC 월봉 → 실패 시 CryptoCompare 일봉
const YH = { "Accept": "application/json,text/plain,*/*", "User-Agent": CSV_HDR["User-Agent"] };
const SINCE = Date.UTC(2010, 5, 1);
async function yahooMonthly(sym) {
  const r = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=1275350400&period2=${Math.floor(Date.now() / 1000)}&interval=1mo`, 12000, YH);
  const res = r.body?.chart?.result?.[0]; const ts = res?.timestamp || [], cl = res?.indicators?.quote?.[0]?.close || [];
  const series = []; for (let i = 0; i < ts.length; i++) { const v = Number(cl[i]), t = ts[i] * 1000; if (fin(v) && v > 0 && t >= SINCE) series.push({ t: t + 3 * DAY, v }); }
  return { ok: series.length > 100, status: r.status, series, via: "yahoo:" + sym };
}
async function stooqMonthly(sym) {
  const r = await fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=m`, 12000, CSV_HDR);
  const series = [];
  if (r.ok) for (const line of r.body.trim().split(/\r?\n/).slice(1)) { const p = line.split(","); const t = Date.parse(p[0]), v = Number(p[4]); if (fin(t) && fin(v) && v > 0 && t >= SINCE) series.push({ t, v }); }
  return { ok: series.length > 100, status: r.status, series, via: "stooq:" + sym };
}
async function nyFedEffr() {
  const end = new Date().toISOString().slice(0, 10);
  const r = await fetchJson(`https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate=2010-06-01&endDate=${end}&type=rate`, 15000, YH);
  const a = Array.isArray(r.body?.refRates) ? r.body.refRates : [];
  const series = a.map(x => ({ t: Date.parse(x.effectiveDate), v: Number(x.percentRate) })).filter(x => fin(x.t) && fin(x.v)).sort((p, q) => p.t - q.t);
  return { ok: series.length > 100, status: r.status, series, via: "nyfed" };
}
async function ecbFxDaily(cur) {
  const r = await fetchText(`https://data-api.ecb.europa.eu/service/data/EXR/D.${cur}.EUR.SP00.A?startPeriod=2010-06-01&format=csvdata`, 15000, CSV_HDR);
  const m = new Map();
  if (r.ok) { const lines = r.body.trim().split(/\r?\n/).map(splitCsv); const h = lines.findIndex(x => x.includes("TIME_PERIOD") && x.includes("OBS_VALUE")); if (h >= 0) { const hi = lines[h].indexOf("TIME_PERIOD"), vi = lines[h].indexOf("OBS_VALUE"); for (const x of lines.slice(h + 1)) { const v = Number(x[vi]); if (x[hi] && fin(v) && v > 0) m.set(x[hi], v); } } }
  return { ok: m.size > 100, status: r.status, map: m };
}
async function ecbFx() {
  const currencies = ["USD","JPY","GBP"];
  const got = await Promise.all(currencies.map(ecbFxDaily));
  const maps = Object.fromEntries(currencies.map((c,i)=>[c,got[i].map]));
  const usd = maps.USD;
  const make = (cur) => [...usd.keys()].sort().map(d=>{
    const eurUsd=usd.get(d), eurCur=maps[cur]?.get(d); if(!fin(eurUsd)||!fin(eurCur)||eurCur===0)return null;
    return {t:Date.parse(d),v:eurUsd/eurCur};
  }).filter(Boolean);
  return {
    eurusd:{ok:got[0].ok,status:got[0].status,via:"ecb",series:[...usd.keys()].sort().map(d=>{const a=usd.get(d),t=Date.parse(d);return fin(a)&&Number.isFinite(t)?{t,v:a}:null}).filter(Boolean)},
    jpyusd:{ok:got[0].ok&&got[1].ok,status:got[1].status,via:"ecb",series:[...usd.keys()].sort().map(d=>{const a=usd.get(d),b=maps.JPY?.get(d),t=Date.parse(d);return fin(a)&&fin(b)&&b&&Number.isFinite(t)?{t,v:b/a}:null}).filter(Boolean)},
    gbpusd:{ok:got[0].ok&&got[2].ok,status:got[2].status,via:"ecb",series:make("GBP")}
  };
}
async function ethBtcAlt() {
  let r = await yahooMonthly("ETH-BTC"); if (r.ok) return r;
  const a = await fetchJson("https://min-api.cryptocompare.com/data/v2/histoday?fsym=ETH&tsym=BTC&limit=2000", 15000, YH);
  const arr = a.body?.Data?.Data || [];
  const series = arr.map(x => ({ t: x.time * 1000, v: Number(x.close) })).filter(x => fin(x.v) && x.v > 0);
  return { ok: series.length > 100, status: a.status, series, via: "cryptocompare" };
}
async function altSeries(name, fx) {
  const both = async (y, st) => { const r = await yahooMonthly(y); return r.ok ? r : (await stooqMonthly(st)); };
  if (name === "sp") return both("^GSPC", "^spx");
  if (name === "dollar") return both("DX-Y.NYB", "dx.f");
  if (name === "oil") return both("CL=F", "cl.f");
  if (name === "y10") { const r = await both("^TNX", "10usy.b"); if (r.ok && r.series.length && r.series[r.series.length - 1].v > 25) r.series = r.series.map(x => ({ t: x.t, v: x.v / 10 })); return r; }
  if (name === "fed") { const r = await nyFedEffr(); return r.ok ? r : yahooMonthly("^IRX"); }
  if (fx && fx[name]) return fx[name];
  return { ok: false, status: 0, series: [], via: null };
}

// FRED는 동시 요청이 많으면 거절하는 경우가 있어 3개씩 끊어서 받는다.
// FRED_API_KEY가 없으면 FRED 공개 CSV(Workers IP를 520으로 거절하는 경우가 많음)는 M2 한 개만 1회 시도한다.
async function fredLimited(names, ids) {
  const hasKey = !!(ENV_REF && ENV_REF.FRED_API_KEY);
  const out = new Array(names.length);
  const todo = names.map((n, i) => i).filter(i => hasKey || names[i] === "m2");
  names.forEach((n, i) => { if (!todo.includes(i)) out[i] = { ok: false, status: 0, series: [], via: "skipped" }; });
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const i = todo[next++], n = names[i];
      out[i] = await fredSeries(ids[n], "2010-06-01", !["cbbtc","cbeth"].includes(n), "avg");
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}
// FRED에서 못 받은 항목을 대체 소스로 채운다.
async function fillAlt(names, arr) {
  const need = names.filter((n, i) => !arr[i].ok && !["m2", "cbbtc", "cbeth"].includes(n));
  if (!need.length) return arr;
  const fx = need.some(n => ["eurusd", "jpyusd", "gbpusd"].includes(n)) ? await ecbFx() : null;
  const res = await Promise.all(need.map(n => altSeries(n, fx)));
  need.forEach((n, k) => { arr[names.indexOf(n)] = { ...res[k], via: res[k].via || "alt" }; });
  return arr;
}

async function buildHistory() {
  const t0 = Date.now(), now = t0, curK = mkey(now);
  const ids = { m2: "M2SL", fed: "EFFR", dollar: "DTWEXBGS", oil: "WTISPLC", sp: "SP500", y10: "DGS10", eurusd: "DEXUSEU", jpyusd: "DEXJPUS", gbpusd: "EXUSUK", cbbtc: "CBBTCUSD", cbeth: "CBETHUSD" };
  const names = Object.keys(ids);
  const [fredArr0, ea, jp, uk, bc, sc, cmc, ethAlt] = await Promise.all([
    fredLimited(names, ids),
    fetchEcbM2(), fetchBojM2(now), fetchBoeM4(now),
    fetchBtcPrice(), fetchStable(), fetchCmcDominance(now), ethBtcAlt()
  ]);
  const fredArr = await fillAlt(names, fredArr0);
  const f = {}; names.forEach((n, i) => f[n] = fredArr[i]);
  const fxAll = await ecbFx();
  f.eurusd = fxAll.eurusd; f.jpyusd = fxAll.jpyusd; f.gbpusd = fxAll.gbpusd;
  const g = buildGlobalM2(f, ea, jp, uk, curK);
  const btc = bc.ok ? bc.series : (f.cbbtc.ok ? f.cbbtc.series : []);
  const c = {
    yoy: g.yoy, fedM: monthMap(f.fed.series), dolM: monthMap(f.dollar.series), oilM: monthMap(f.oil.series), spM: monthMap(f.sp.series), y10M: monthMap(f.y10.series),
    btcM: monthLast(btc), cbbtc: f.cbbtc.series, cbeth: f.cbeth.series, ethBtcM: ethAlt.ok ? monthLast(ethAlt.series) : monthLast(f.cbeth.series.map((x,i)=>({t:x.t,v:(x.v/(valAt(f.cbbtc.series,x.t,7*DAY)||NaN))})).filter(x=>fin(x.v))), stableM: monthLast(sc.series)
  };
  const rows = [];
  for (let k = "2012-01"; k <= curK; k = addM(k, 1)) rows.push(featureRow(k, k === curK ? now : monthEnd(k), k === curK, c));
  const last = (a) => a.length ? a[a.length - 1].v : null;
  const lvl = {
    fed: last(f.fed.series), dollar: last(f.dollar.series), oil: last(f.oil.series), sp: last(f.sp.series), y10: last(f.y10.series),
    m2: g.lastK ? g.global.get(g.lastK) : null, m2Key: g.lastK, stable: last(sc.series)
  };
  const sources = {
    fred: { ok: fredArr.filter(x => x.ok).length, total: names.length, failed: names.filter((n, i) => !fredArr[i].ok), via: fredArr.find(x => x.ok && x.via === "csv" || x.via === "api")?.via || null, alt: Object.fromEntries(names.map((n, i) => [n, fredArr[i].via || null])), ethbtc: { ok: ethAlt.ok, via: ethAlt.via, status: ethAlt.status }, status: Object.fromEntries(names.map((n, i) => [n, fredArr[i].status])), hint: fredArr.find(x => !x.ok)?.snip || fredArr.find(x => !x.ok)?.error || undefined },
    ecb: { ok: ea.ok, status: ea.status }, boj: { ok: jp.ok, status: jp.status }, boe: { ok: uk.ok, status: uk.status }, globalM2: { profile: "US+EU+JP+UK", used: g.used, rejected: g.rejected },
    btcPrice: { ok: bc.ok, status: bc.status, fallback: !bc.ok && f.cbbtc.ok }, stablecoin: { ok: sc.ok, status: sc.status },
    cmcDominance: { ok: cmc.ok, status: cmc.status }
  };
  const ok = rows.some(r => fin(r.m2yoy)) && btc.length > 0;
  return { ok, built: now, ms: Date.now() - t0, rows, levels: { ...lvl, m2Extended: lvl.m2, m2ExtendedKey: lvl.m2Key }, m2: { used: g.used, rejected: g.rejected, lastKey: g.lastK, extended: { used: g.used, rejected: g.rejected, lastKey: g.lastK, yoy: g.lastK ? (g.yoy.get(g.lastK) ?? null) : null, value: g.lastK ? g.global.get(g.lastK) : null } }, cmcDom: cmc.ok ? cmc.series : null, sources, error: ok ? undefined : "HISTORY_INPUTS_MISSING" };
}

// ---------- 실시간(업비트/CoinGecko) ----------
const COIN_GROUPS = [
  { key: "eth", label: "ETH", coins: ["ETH"] },
  { key: "large", label: "대형 알트", coins: ["XRP", "SOL", "ADA", "DOGE", "LINK", "AVAX"] },
  { key: "mid", label: "중형 알트", coins: ["SUI", "HBAR", "XLM", "UNI", "AAVE", "NEAR", "APT", "ARB", "INJ"] },
  { key: "small", label: "소형·고베타", coins: ["ONDO", "TAO", "SEI"] }
];
async function upbitDays(sym, count = 100) {
  let r = await fetchJson(`${UPBIT}/v1/candles/days?market=KRW-${sym}&count=${count}`, 7000);
  for (let k = 0; k < 3 && !(Array.isArray(r.body) && r.body.length) && (r.status === 429 || r.status >= 500 || r.status === 0); k++) {
    await sleep(600 + k * 500);
    r = await fetchJson(`${UPBIT}/v1/candles/days?market=KRW-${sym}&count=${count}`, 7000);
  }
  const a = Array.isArray(r.body) ? r.body : [];
  const rows = a.map(x => ({ t: Date.parse(x.candle_date_time_utc + "Z"), c: Number(x.trade_price), v: Number(x.candle_acc_trade_price) })).filter(x => fin(x.c) && x.c > 0).sort((p, q) => p.t - q.t);
  return { ok: rows.length >= 40, status: r.status, rows };
}
const retN = (rows, n) => rows.length > n ? pctOf(rows[rows.length - 1].c, rows[rows.length - 1 - n].c) : null;
function vol7over30(rows) {
  if (rows.length < 38) return null;
  const n = rows.length, s7 = rows.slice(n - 7).reduce((s, x) => s + x.v, 0) / 7, s30 = rows.slice(n - 37, n - 7).reduce((s, x) => s + x.v, 0) / 30;
  return s30 > 0 ? s7 / s30 : null;
}
async function buildLive() {
  const t0 = Date.now(); const num = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
  const [cgApiR, cgPageR] = await Promise.all([fetchJson("https://api.coingecko.com/api/v3/global", 9000), fetchText("https://www.coingecko.com/en/charts/bitcoin-dominance", 9000)]);
  const apiDom = num(cgApiR.body?.data?.market_cap_percentage?.btc), page = parseCoinGeckoDominancePage(cgPageR.body);
  let dom = null;
  if (apiDom > 20 && apiDom < 90) dom = { value: apiDom, source: "CoinGecko API" };
  else if (fin(page?.today) && page.today > 20 && page.today < 90) dom = { value: page.today, source: "CoinGecko" };
  if (dom) Object.assign(dom, { d7: num(page?.d7), m1: num(page?.m1), m3: num(page?.m3), y1: num(page?.y1) });
  const btc = await upbitDays("BTC");
  const coins = [];
  if (btc.ok) {
    const b7 = retN(btc.rows, 7), b30 = retN(btc.rows, 30), b90 = retN(btc.rows, 90);
    for (const g of COIN_GROUPS) for (const sym of g.coins) {
      await sleep(200);
      const d = await upbitDays(sym); if (!d.ok) continue;
      const r7 = retN(d.rows, 7), r30 = retN(d.rows, 30), r90 = retN(d.rows, 90);
      coins.push({ sym, group: g.key, ret7: r3(r7, 1), ret30: r3(r30, 1), ret90: r3(r90, 1), rel7: fin(r7) && fin(b7) ? r3(r7 - b7, 1) : null, rel30: fin(r30) && fin(b30) ? r3(r30 - b30, 1) : null, rel90: fin(r90) && fin(b90) ? r3(r90 - b90, 1) : null, vol: r3(vol7over30(d.rows), 2), _rows: d.rows });
    }
  }
  // ETH/BTC (원화 비율 → 환율 상쇄)
  let ethbtc = null;
  const eth = coins.find(c => c.sym === "ETH");
  if (eth && btc.ok) {
    const bm = new Map(btc.rows.map(x => [x.t, x.c])); const ser = eth._rows.filter(x => bm.has(x.t)).map(x => ({ t: x.t, v: x.c / bm.get(x.t) }));
    if (ser.length > 91) ethbtc = { now: r3(ser.at(-1).v, 5), ch7: r3(pctOf(ser.at(-1).v, ser.at(-8).v), 2), ch30: r3(pctOf(ser.at(-1).v, ser.at(-31).v), 2), ch90: r3(pctOf(ser.at(-1).v, ser.at(-91).v), 2) };
  }
  // 알트 거래대금 (7일 평균 / 이전 30일 평균)
  let s7 = 0, s30 = 0, nv = 0;
  for (const c of coins) { const n = c._rows.length; if (n < 38) continue; s7 += c._rows.slice(n - 7).reduce((s, x) => s + x.v, 0) / 7; s30 += c._rows.slice(n - 37, n - 7).reduce((s, x) => s + x.v, 0) / 30; nv++; }
  const volRatio = nv && s30 > 0 ? r3(s7 / s30, 2) : null;
  coins.forEach(c => delete c._rows);
  const valid7 = coins.filter(c => fin(c.rel7)), valid90 = coins.filter(c => fin(c.rel90)), valid30 = coins.filter(c => fin(c.rel30));
  const pctBeat7 = valid7.length ? r3(valid7.filter(c => c.rel7 > 0).length / valid7.length * 100, 0) : null;
  const pctBeat90 = valid90.length ? r3(valid90.filter(c => c.rel90 > 0).length / valid90.length * 100, 0) : null;
  const pctBeat30 = valid30.length ? r3(valid30.filter(c => c.rel30 > 0).length / valid30.length * 100, 0) : null;
  const breadthBlend = [pctBeat7,pctBeat30,pctBeat90].filter(fin).length ? r3((pctBeat7??pctBeat30??pctBeat90)*0.2+(pctBeat30??pctBeat90??pctBeat7)*0.3+(pctBeat90??pctBeat30??pctBeat7)*0.5,0) : null;
  const groups = COIN_GROUPS.map(g => { const m = coins.filter(c => c.group === g.key && fin(c.rel30)); const avg = m.length ? m.reduce((s, c) => s + c.rel30, 0) / m.length : null; return { key: g.key, label: g.label, n: m.length, rel30: r3(avg, 1), beat: fin(avg) ? avg > 0 : null }; });
  let reach = 0; for (const g of groups) { if (g.beat === true) reach++; else break; }
  const ok = btc.ok && coins.length >= 6;
  return { ok, built: Date.now(), ms: Date.now() - t0, dom, btcKrw: btc.ok ? { ret7: r3(retN(btc.rows, 7), 1), ret30: r3(retN(btc.rows, 30), 1), ret90: r3(retN(btc.rows, 90), 1) } : null, ethbtc, coins, breadth: { n: coins.length, pctBeat7, pctBeat30, pctBeat90, breadthBlend, volRatio }, groups, reach,
    sources: { coingecko: { ok: !!dom, api: cgApiR.status, page: cgPageR.status }, upbit: { ok: btc.ok, coins: coins.length, missing: COIN_GROUPS.flatMap(g => g.coins).filter(x => !coins.some(c => c.sym === x)), total: COIN_GROUPS.reduce((s, g) => s + g.coins.length, 0) } }, error: ok ? undefined : "LIVE_INPUTS_MISSING" };
}

// ---------- 점수 ----------
// ===== DATA-DRIVEN SCORE ENGINE =====
// 점수의 임계값을 "몇 %면 10점"처럼 고정하지 않는다.
// 각 월의 값이 직전 60개월 분포에서 어느 위치인지(percentile)로 환산한다.
// 따라서 2017/2021 같은 과거 강세장과 2026 현재를 같은 눈금에서 비교할 수 있다.
const MAXPTS = { m2: 15, accel: 10, dollar: 10, fed: 10, btc: 10, dom: 20, eth: 10, alt: 15 };
const SCORE_KEYS = Object.keys(MAXPTS);
const SCORE_LOOKBACK = 60;
const clamp01 = x => Math.max(0, Math.min(1, x));
function percentileRank(v, arr, higherBetter=true) {
  const a = arr.filter(fin).sort((x,y)=>x-y); if (!fin(v) || !a.length) return null;
  let lo=0, hi=a.length;
  while(lo<hi){const m=(lo+hi)>>1;if(a[m] < v)lo=m+1;else hi=m;}
  let first=lo,last=lo; while(first>0 && a[first-1]===v)first--; while(last<a.length-1 && a[last+1]===v)last++;
  const rank=((first+last)/2)/(a.length-1||1); return higherBetter?rank:1-rank;
}
function trailingValues(rows, idx, field, min=12) {
  const from=Math.max(0,idx-SCORE_LOOKBACK), a=[]; for(let i=from;i<idx;i++){const v=rows[i]?.[field];if(fin(v))a.push(v);} return a.length>=min?a:[];
}
function altProxyPct(row, rows, idx){
  const a=[];
  const dom=percentileRank(row.dom90,trailingValues(rows,idx,'dom90'),false);
  const eth=percentileRank(row.eth90,trailingValues(rows,idx,'eth90'),true);
  const st=percentileRank(row.stable90,trailingValues(rows,idx,'stable90'),true);
  if(fin(dom))a.push(dom); if(fin(eth))a.push(eth); if(fin(st))a.push(st);
  return a.length>=2?a.reduce((s,x)=>s+x,0)/a.length:null;
}
function dynamicScore(row, rows, idx, altPts=null){
  const p={};
  const specs={
    m2:['m2yoy',true], accel:['m2accel',true], dollar:['dollar3m',false],
    fed:['fed12',false], btc:['btc90',true], dom:['dom90',false], eth:['eth90',true]
  };
  for(const [k,[field,hi]] of Object.entries(specs)){
    const v=percentileRank(row[field],trailingValues(rows,idx,field),hi); p[k]=fin(v)?Math.round(v*MAXPTS[k]):null;
  }
  if(fin(p.dom) && fin(row.btc90) && row.btc90<0) p.dom=Math.round(p.dom*clamp01((row.btc90+15)/15));
  if(fin(altPts)) p.alt=Math.round(clamp01(altPts/100)*MAXPTS.alt);
  else {const ap=altProxyPct(row,rows,idx);p.alt=fin(ap)?Math.round(ap*MAXPTS.alt):null;}
  return p;
}
function totalOf(p, keys=SCORE_KEYS, needAll=false){
  let s=0,m=0; for(const k of keys){if(p[k]==null){if(needAll)return null;continue;}s+=p[k];m+=MAXPTS[k];}
  return m?{score:Math.round(s/m*100),cover:m}:null;
}
function quantile(a,q){const v=a.filter(fin).sort((x,y)=>x-y);if(!v.length)return null;const p=(v.length-1)*q,i=Math.floor(p),f=p-i;return i+1<v.length?v[i]+(v[i+1]-v[i])*f:v[i];}
function calibrateBands(rows){
  const scores=rows.filter(r=>!r.live&&fin(r.s)).map(r=>r.s);
  return {watch:Math.round(quantile(scores,.60)||40), expansion:Math.round(quantile(scores,.78)||55), broad:Math.round(quantile(scores,.90)||70), distribution:{p50:Math.round(quantile(scores,.5)||50),p75:Math.round(quantile(scores,.75)||60),p90:Math.round(quantile(scores,.9)||70),n:scores.length}};
}
function stageOf(s,b){
  if(!fin(s)||!b)return null;
  if(s>=b.broad)return {key:'broad',label:'광범위 알트 강세 영역',emoji:'🔴'};
  if(s>=b.expansion)return {key:'expansion',label:'초기 알트 확산 영역',emoji:'🟠'};
  if(s>=b.watch)return {key:'watch',label:'알트 순환매 감지 영역',emoji:'🟡'};
  return {key:'btc',label:'BTC 중심 영역',emoji:'🟢'};
}

// 과거 실제 알트 강세 구간(사후 정의 · 화면 음영/보정표에 사용). 점수 계산에는 쓰이지 않는다.
const ALT_WINDOWS = [
  { id: "2017", label: "2017 ICO 알트장", from: "2017-03", to: "2018-01" },
  { id: "2021", label: "2020~21 알트시즌", from: "2020-10", to: "2021-05" },
  { id: "2024", label: "2024 순환매(약)", from: "2024-11", to: "2025-01" }
];
const BTCD_ANCHORS = [[2013, 93.3], [2014, 88.5], [2015, 86.3], [2016, 82.6], [2017, 58.5], [2018, 44.6], [2019, 60.2], [2020, 62.7], [2021, 47.6], [2022, 39.3], [2023, 45.6], [2024, 51.9], [2025, 59.3]].map(([y, v]) => ({ t: Date.UTC(y, 6, 1), v }));
const inWindow = k => ALT_WINDOWS.find(w => k >= w.from && k <= w.to) || null;

function compose(hist, live) {
  const src = { ...(hist?.sources || {}), ...(live?.sources || {}) };
  if (!hist || !hist.ok) return { ok: false, error: hist?.error || "HISTORY_UNAVAILABLE", sources: src };
  const rows = hist.rows.map(r => ({ ...r })), cur = rows[rows.length - 1];
  const liveDom = live?.dom?.value;
  // BTC.D: 실측(CMC) 우선, 없으면 연평균 앵커 보간(근사)
  const cmc = hist.cmcDom ? hist.cmcDom.map(([t, v]) => ({ t, v })) : null;
  const anchors = BTCD_ANCHORS.slice(); if (fin(liveDom)) anchors.push({ t: cur.t, v: liveDom });
  const anchorAt = t => { if (t < anchors[0].t) return null; if (t >= anchors[anchors.length - 1].t) return anchors[anchors.length - 1].v; const i = bsearchLE(anchors, t), a = anchors[i], b = anchors[i + 1]; return a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t); };
  const domAt = t => { if (cmc && t >= cmc[0].t - 7 * DAY) { const v = valAt(cmc, t, 14 * DAY); if (fin(v)) return { v, src: "cmc" }; } const v = anchorAt(t); return fin(v) ? { v, src: "anchor" } : { v: null, src: null }; };
  for (const r of rows) {
    const a = domAt(r.t), b = domAt(r.t - 90 * DAY);
    r.dom = a.v; r.domSrc = a.src; r.dom90 = fin(a.v) && fin(b.v) ? r3(a.v - b.v, 2) : null;
    if (r.live) {
      if (fin(liveDom)) { r.dom = liveDom; r.domSrc = "coingecko"; if (fin(live?.dom?.m3)) r.dom90 = r3(liveDom - live.dom.m3, 2); }
      if (fin(live?.ethbtc?.ch90)) { r.eth90 = live.ethbtc.ch90; r.ethbtc = live.ethbtc.now ?? r.ethbtc; }
    }
    const p = dynamicScore(r, rows, rows.indexOf(r));
    const full = totalOf(p, SCORE_KEYS, true);
    const macro = totalOf(p, ['m2','accel','dollar','fed','btc'], true);
    r.s = full ? full.score : null; r.mo = macro ? macro.score : null; r._p = p;
  }
  // 현재 점수: 역사분포 기반 7개 축 + 실제 알트 breadth/거래대금 확인.
  const br = live?.breadth || {};
  const altBreadthScore = fin(br.breadthBlend) ? clamp01(br.breadthBlend/100)*100 : null;
  const altVolumeScore = fin(br.volRatio) ? clamp01((Math.log(Math.max(br.volRatio,0.01))+0.35)/(Math.log(1.75)+0.35))*100 : null;
  const altScore = fin(altBreadthScore)&&fin(altVolumeScore) ? altBreadthScore*0.75+altVolumeScore*0.25 : altBreadthScore;
  const pNow = dynamicScore({ ...cur }, rows, rows.length-1, altScore);
  const tot = totalOf(pNow, SCORE_KEYS, false), comparable = cur.s;
  const total = tot ? tot.score : null;
  const bands = calibrateBands(rows);
  const stage = total != null ? stageOf(total,bands) : null;
  const LABEL = { m2: "Global M2 증가", accel: "유동성 가속", dollar: "달러 약세", fed: "Fed 완화", btc: "BTC 상승 추세", dom: "BTC.D 하락(품질보정)", eth: "ETH/BTC 상승", alt: "실제 알트 확산" };
  const fm = (v, u = "%", d = 1) => fin(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(d)}${u}` : "—";
  const DETAIL = { m2: `YoY ${fm(cur.m2yoy)}`, accel: `6개월 전 대비 ${fm(cur.m2accel, "%p")}`, dollar: `3개월 ${fm(cur.dollar3m)}`, fed: `12개월 ${fm(cur.fed12, "%p", 2)} · 현재 ${fin(cur.fedLvl) ? cur.fedLvl.toFixed(2) + "%" : "—"}`, btc: `90일 ${fm(cur.btc90)}`, dom: `90일 ${fm(cur.dom90, "%p")}${cur.btc90 < 0 && fin(cur.dom90) && cur.dom90 < 0 ? " · BTC 하락 동반→감액" : ""}`, eth: `90일 ${fm(cur.eth90)}`, alt: fin(br.breadthBlend) ? `7/30/90일 혼합 ${br.breadthBlend}% · 90일 ${fin(br.pctBeat90)?br.pctBeat90:'—'}% · 거래대금 x${fin(br.volRatio) ? br.volRatio : "—"}` : "데이터 없음" };
  const comps = SCORE_KEYS.map(k => ({ key: k, label: LABEL[k], pts: pNow[k], max: MAXPTS[k], detail: DETAIL[k] }));
  const drivers = { up: comps.filter(c => c.pts != null && c.pts / c.max >= 0.7).map(c => c.label), down: comps.filter(c => c.pts != null && c.pts / c.max <= 0.3).map(c => c.label) };
  // 추세/지속성 (과거와 동일 기준인 comparable 사용)
  const seq = rows.filter(r => r.s != null).map(r => ({ k: r.k, s: r.s }));
  const path = seq.slice(-6);
  const streak = th => { let n = 0; for (let i = seq.length - 1; i >= 0 && seq[i].s >= th; i--) n++; return n; };
  const ago = n => seq.length > n ? seq[seq.length - 1 - n].s : null;
  // 보정표
  const done = rows.filter(r => !r.live && r.s != null);
  const outside = done.filter(r => !ALT_WINDOWS.some(w => k2(r.k, w)));
  function k2(k, w) { return monthsBetween(w.from, k) >= -2 && monthsBetween(k, w.to) >= -2; }
  const inRows = done.filter(r => inWindow(r.k));
  const calibration = [bands.watch, bands.expansion, bands.broad].map(T => {
    const hit = inRows.length ? inRows.filter(r => r.s >= T).length / inRows.length * 100 : null;
    const fa = outside.length ? outside.filter(r => r.s >= T).length / outside.length * 100 : null;
    const leads = ALT_WINDOWS.map(w => { const c = done.find(r => monthsBetween(w.from, r.k) >= -8 && monthsBetween(r.k, w.to) >= 0 && r.s >= T); return { id: w.id, firstCross: c ? c.k : null, leadMonths: c ? monthsBetween(c.k, w.from) : null }; });
    return { threshold: T, hitRate: r3(hit, 0), falseAlarmRate: r3(fa, 0), leads };
  });
  const windows = ALT_WINDOWS.map(w => { const a = done.filter(r => r.k >= w.from && r.k <= w.to); const pk = a.reduce((m, r) => (!m || r.s > m.s) ? r : m, null); const st = done.find(r => r.k === w.from); return { ...w, startScore: st?.s ?? null, peakScore: pk?.s ?? null, peakMonth: pk?.k ?? null, months: a.length }; });
  // 유사 시기
  const KEYS = ["m2yoy", "fed12", "dollar3m", "btc90", "eth90", "dom90"];
  const cand = rows.slice(0, -5).filter(r => KEYS.every(k => fin(r[k])));
  let analogs = [];
  if (KEYS.every(k => fin(cur[k])) && cand.length > 24) {
    const mu = {}, sd = {}; for (const k of KEYS) { const v = cand.map(r => r[k]); mu[k] = v.reduce((s, x) => s + x, 0) / v.length; sd[k] = Math.sqrt(v.reduce((s, x) => s + (x - mu[k]) ** 2, 0) / v.length) || 1; }
    const dist = r => Math.sqrt(KEYS.reduce((s, k) => s + ((r[k] - cur[k]) / sd[k]) ** 2, 0));
    const sorted = cand.map(r => ({ r, d: dist(r) })).sort((a, b) => a.d - b.d), pick = [];
    for (const x of sorted) { if (pick.every(p => Math.abs(monthsBetween(p.r.k, x.r.k)) >= 4)) pick.push(x); if (pick.length >= 3) break; }
    const dmax = sorted[sorted.length - 1].d || 1, idx = new Map(rows.map((r, i) => [r.k, i]));
    analogs = pick.map(({ r, d }) => { const f = rows[idx.get(r.k) + 6]; const w = inWindow(r.k); return { month: r.k, similarity: Math.round(100 * (1 - d / dmax)), score: r.s, phase: w ? w.label : "알트 강세 구간 밖", fwdEthBtc6m: f && fin(f.ethbtc) && fin(r.ethbtc) ? r3(pctOf(f.ethbtc, r.ethbtc), 1) : null, fwdBtc6m: f && fin(f.btc) && fin(r.btc) ? r3(pctOf(f.btc, r.btc), 1) : null }; });
  }
  // 위험자본 순환 점수 (별도 참고 지표)
  let rotation = null;
  const rel = fin(cur.btc90) && fin(cur.sp90) ? cur.btc90 - cur.sp90 : null;
  if (rel != null || fin(cur.stable90) || fin(br.volRatio)) {
    const a = rel == null ? 0 : rel > 20 ? 35 : rel > 0 ? 25 : rel > -10 ? 10 : 0, b = !fin(cur.stable90) ? 0 : cur.stable90 >= 8 ? 35 : cur.stable90 >= 4 ? 25 : cur.stable90 >= 1 ? 15 : cur.stable90 > 0 ? 8 : 0, c = !fin(br.volRatio) ? 0 : br.volRatio >= 1.5 ? 30 : br.volRatio >= 1.15 ? 20 : br.volRatio >= 0.9 ? 10 : 0;
    rotation = { score: a + b + c, parts: { btcVsSp: r3(rel, 1), stable90: cur.stable90, altVolume: br.volRatio ?? null } };
  }
  const L = hist.levels || {};
  return {
    ok: true, version: "altseason-v5-us-eu-jp-uk", updatedAt: Date.now(), cache: { hist: hist.cache, live: live?.cache }, staleReason: hist.staleReason || live?.staleReason,
    score: { total, comparable, stage, coverage: tot ? tot.cover : null, components: comps, drivers, path, momentum: { m1: ago(1) != null && comparable != null ? comparable - ago(1) : null, m3: ago(3) != null && comparable != null ? comparable - ago(3) : null }, streak: { overWatch: streak(bands.watch), overExpansion: streak(bands.expansion), overBroad: streak(bands.broad) }, bands, methodology: 'rolling-60m-percentile' },
    inputs: { m2: { value: L.m2, key: L.m2Key, yoy: cur.m2yoy, accel: cur.m2accel, used: hist.m2.used, rejected: hist.m2.rejected, extended: { value: L.m2Extended, key: L.m2ExtendedKey, yoy: hist.m2.extended?.yoy ?? null, used: hist.m2.extended?.used || [], rejected: hist.m2.extended?.rejected || [] } }, fed: { value: L.fed, chg12: cur.fed12 }, dollar: { value: L.dollar, chg3m: cur.dollar3m }, oil: { value: L.oil, chg3m: cur.oil3m }, us10y: { value: cur.us10y, chg3m: cur.us10y3m }, sp: { value: L.sp, chg3m: cur.sp90 }, btc: { usd: cur.btc, ret90: cur.btc90, vsSp: r3(rel, 1) }, dom: { value: fin(liveDom) ? liveDom : cur.dom, src: fin(liveDom) ? "coingecko" : cur.domSrc, d7: live?.dom?.d7 != null && fin(liveDom) ? r3(liveDom - live.dom.d7, 2) : null, d30: live?.dom?.m1 != null && fin(liveDom) ? r3(liveDom - live.dom.m1, 2) : null, d90: cur.dom90 }, ethbtc: { value: cur.ethbtc, ch30: live?.ethbtc?.ch30 ?? null, ch90: cur.eth90 }, stable: { value: L.stable, g90: cur.stable90 } },
    breadth: live ? { ...live.breadth, coins: live.coins, groups: live.groups, reach: live.reach } : null, rotation, analogs,
    confirmation: { score: total, bands, breadth90: br.pctBeat90 ?? null, breadthBlend: br.breadthBlend ?? null, eth90: cur.eth90 ?? null, dom90: cur.dom90 ?? null, volumeRatio: br.volRatio ?? null,
      broadScore: total != null && total >= bands.broad, breadthConfirmed: fin(br.pctBeat90) && br.pctBeat90 >= 75, rotationConfirmed: fin(cur.eth90)&&cur.eth90>0&&fin(cur.dom90)&&cur.dom90<0,
      broadConfirmed: total != null && total >= bands.broad && fin(br.pctBeat90) && br.pctBeat90 >= 75 && fin(cur.eth90) && cur.eth90 > 0 && fin(cur.dom90) && cur.dom90 < 0 },
    history: { months: rows.map(r => ({ k: r.k, s: r.s, mo: r.mo, m2: r.m2yoy, d: fin(r.dom) ? r3(r.dom, 1) : null, ds: r.domSrc, e: r.ethbtc, b: r.btc90 })), windows: ALT_WINDOWS, windowStats: windows, calibration },
    sources: src, notes: { globalM2Profiles: "GLOBAL M2=US+Euro Area+Japan+UK. 중국·한국·캐나다·스위스는 사용하지 않습니다.", domApprox: !hist.cmcDom, m2Lag: "M2는 발표 지연을 반영해 1개월 전 공개분을 사용", scoring: "각 점수는 직전 60개월 분포의 percentile로 산출하며, 현재 breadth는 7/30/90일 혼합을 사용", historicalAltProxy: "과거 알트확산 15점은 BTC.D·ETH/BTC·스테이블코인 증가율의 회전 proxy로 대체" }
  };
}

export default {
  async fetch(req, env) {
    ENV_REF = env;
    const u = new URL(req.url);
    // 끝의 슬래시(/altseason/)나 중복 슬래시를 정리해 라우트가 어긋나지 않게 한다.
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (u.pathname === "/health") {
      return json({
        ok: true,
        version: "v10.8.1-minimal+pin+altseason-v3",
        routes: ["/health","/macro","/altseason","/candles","/upbit","/market"],
        altseason: true,
        service: "BTC ALT REGIME TRADER (minimal)",
        market: "Upbit KRW",
        pinConfigured: !!env.PIN,
        kvBound: !!env.SCALPER_KV,
      });
    }

    if (u.pathname === "/pin-check") {
      if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      if (!env.PIN) return json({ ok: false, error: "PIN_NOT_CONFIGURED", valid: false }, 200);
      const valid = requirePin(req, env);
      return json({ ok: true, valid });
    }

    // v10.6: 가벼운 시장 지표 (BTC.D · Fear&Greed · Mayer). 거시/알트시즌 계산은 /altseason 으로 분리했다.
    // (한 요청에 서브리퀘스트 40여 개를 몰아넣던 구조 → Worker 무료 한도(50) 초과·타임아웃 위험 제거)
    if (u.pathname === "/macro") {
      if (req.method !== "POST" && req.method !== "GET") return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
      const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
      const [cgApiR,cgPageR,fngR]=await Promise.all([
        fetchJson("https://api.coingecko.com/api/v3/global",9000),
        fetchText("https://www.coingecko.com/en/charts/bitcoin-dominance",9000),
        fetchJson("https://api.alternative.me/fng/?limit=30&format=json",9000)
      ]);
      const cgApiDom=n(cgApiR.body?.data?.market_cap_percentage?.btc);
      const cgPage=parseCoinGeckoDominancePage(cgPageR.body);
      const pageDom=n(cgPage?.today);
      let btcDominance=null, btcDominanceSource="CoinGecko unavailable";
      if(cgApiDom!==null && cgApiDom>20 && cgApiDom<90){ btcDominance=cgApiDom; btcDominanceSource="CoinGecko API"; }
      else if(pageDom!==null && pageDom>20 && pageDom<90){ btcDominance=pageDom; btcDominanceSource="CoinGecko"; }
      const btcDominanceSnapshots=cgPage?{today:n(cgPage.today),d7:n(cgPage.d7),m1:n(cgPage.m1),m3:n(cgPage.m3),y1:n(cgPage.y1)}:null;
      const crossCheck={coingeckoApi:cgApiDom,coingeckoPage:pageDom,apiStatus:cgApiR.status,pageStatus:cgPageR.status};
      const fgRows=Array.isArray(fngR.body?.data)?fngR.body.data:[];
      const fg=fgRows[0]||null;
      const fearGreed=n(fg?.value);
      const fearGreedClass=fg?.value_classification||null;
      const fearGreedHistory=fgRows.slice().reverse().map(x=>n(x?.value)).filter(x=>x!==null);

      // Mayer Multiple = 가격 / 200일 이동평균. workers.dev 에서는 Cache API 가 동작하지 않으므로 KV/메모리 캐시(6시간)를 쓴다.
      const mayerPayload = await cached(env, "macro:mayer:v2", 6*3600, async () => {
        let rows=[],to=null;
        for(let page=0;page<3;page++){
          const url=`https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=200${to?`&to=${encodeURIComponent(to)}`:""}`;
          const r=await fetchJson(url,10000);
          const a=Array.isArray(r.body)?r.body:[];
          if(!a.length) break;
          rows.push(...a);
          const t=new Date(a[a.length-1].candle_date_time_utc+"Z"); t.setSeconds(t.getSeconds()-1); to=t.toISOString();
          if(a.length<200) break;
          await sleep(110);
        }
        const byTime=[...new Map(rows.map(x=>[x.timestamp,x])).values()].sort((a,b)=>a.timestamp-b.timestamp);
        const closes=byTime.map(x=>n(x.trade_price)).filter(x=>x!==null);
        const points=[]; let sum=0;
        for(let i=0;i<closes.length;i++){ sum+=closes[i]; if(i>=200) sum-=closes[i-200]; if(i>=199) points.push(closes[i]/(sum/200)); }
        const step=Math.max(1,Math.floor(points.length/520));
        const sampled=points.filter((_,i)=>i%step===0);
        if(points.length && sampled.at(-1)!==points.at(-1)) sampled.push(points.at(-1));
        return {ok:!!points.length,current:points.at(-1)||null,history:sampled.slice(-560)};
      }, v=>v&&v.ok);

      return json({
        ok:true,
        btcDominance,btcDominanceSource,btcDominanceCrossCheck:crossCheck,btcDominanceSnapshots,
        btcDominanceHistory:[],
        btcDominanceHistoryLabel:btcDominanceSnapshots?"CoinGecko 체크포인트":"실측 누적",
        dominanceHistoryStatus:btcDominanceSnapshots?"coingecko-checkpoints":"coingecko-unavailable",
        mayerMultiple:n(mayerPayload?.current),
        mayerHistory:Array.isArray(mayerPayload?.history)?mayerPayload.history:[],
        mayerReference:{deepDiscount:0.8,trend:1.0,historicalOverheat:2.4},
        fearGreed,fearGreedClass,fearGreedHistory,
        updatedAt:Date.now()
      });
    }

    // v10.6: ALTSEASON RADAR v2. 무거운 월별 역사 재구성은 6시간, 실시간 알트 확산도는 10분 캐시.
    //   /altseason              → 전체 계산 (캐시 없으면 즉시 생성)
    //   /altseason?part=hist    → 역사 데이터만 미리 데우기 (CPU 한도가 낮은 무료 플랜용, 화면이 자동 폴백)
    //   /altseason?force=1      → 캐시 무시하고 재계산
    if (u.pathname === "/altseason") {
      if (req.method !== "POST" && req.method !== "GET") return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
      const force = u.searchParams.get("force") === "1", part = u.searchParams.get("part");
      if (part === "diag") {
        // 데이터 소스별 접속 상태만 빠르게 점검 (계산 없음)
        const t = async (name, p) => { const t0 = Date.now(); const r = await p; return [name, { ok: r.ok, status: r.status, ms: Date.now() - t0, head: (r.body || r.snip || r.error || "").slice(0, 100) }]; };
        const fredUrl = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=M2SL&cosd=2024-01-01";
        const res = await Promise.all([
          t("fred_csv", fetchText(fredUrl, 12000, CSV_HDR)),
          t("fred_csv_html_accept", fetchText(fredUrl, 12000)),
          t("fred_api", env.FRED_API_KEY ? fetchText(`https://api.stlouisfed.org/fred/series/observations?series_id=M2SL&api_key=${encodeURIComponent(env.FRED_API_KEY)}&file_type=json&observation_start=2026-01-01`, 12000, CSV_HDR) : Promise.resolve({ ok: false, status: 0, error: "FRED_API_KEY 없음" })),
          t("ecb", fetchText("https://data-api.ecb.europa.eu/service/data/BSI/M.U2.Y.V.M20.X.1.U2.2300.Z01.E?startPeriod=2025-01&format=csvdata", 12000, CSV_HDR)),
          t("boj", fetchText("https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=MD02&startDate=202501&endDate=202608&code=MAM1NAM2M2MO", 12000, CSV_HDR)),
          t("boe", fetchText("https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/2025&Dateto=28/Aug/2026&SeriesCodes=LPMAUYN&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N", 12000, CSV_HDR))
        ]);
        const fxd = await ecbFx();
        const summ = async (name, p) => { const t0 = Date.now(); let r; try { r = await p; } catch (e) { r = { ok: false, error: String(e?.message || e) }; } const a = r.series || []; return [name, { ok: !!r.ok, status: r.status, via: r.via, n: a.length || (r.map ? r.map.size : 0), last: a.length ? a[a.length - 1].v : null, ms: Date.now() - t0 }]; };
        const alt = await Promise.all([
          summ("sp", altSeries("sp")), summ("dollar", altSeries("dollar")), summ("oil", altSeries("oil")), summ("y10", altSeries("y10")), summ("fed", altSeries("fed")),
          summ("eurusd", Promise.resolve(fxd.eurusd)), summ("jpyusd", Promise.resolve(fxd.jpyusd)), summ("gbpusd", Promise.resolve(fxd.gbpusd)), summ("ethbtc", ethBtcAlt()), summ("boj_m2", fetchBojM2(Date.now())), summ("ecb_m2", fetchEcbM2())
        ]);
        return json({ ok: true, part: "diag", fredApiKey: !!env.FRED_API_KEY, results: Object.fromEntries(res), alt: Object.fromEntries(alt) });
      }
      if (part === "live") {
        const live = await cached(env, "as:live:v3", 600, buildLive, v=>v&&v.ok, force);
        return json({ ok:!!live?.ok, part:"live", cache:live?.cache, ...live });
      }
      const hist = await cached(env, "as:hist:v5-us-eu-jp-uk", 12*3600, buildHistory, v=>v&&v.ok, force);
      if (part === "hist") return json({ ok: !!hist.ok, part: "hist", cache: hist.cache, ms: hist.ms, sources: hist.sources, error: hist.error, history: hist.rows, levels: hist.levels, m2: hist.m2, cmcDom: hist.cmcDom });
      const live = await cached(env, "as:live:v3", 600, buildLive, v=>v&&v.ok, force);
      return json(compose(hist, live));
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

    if (u.pathname === "/") return new Response("BTC ALT REGIME TRADER (minimal)", { headers: CORS });
    // API 경로에서는 절대 텍스트/HTML을 주지 않는다 → 화면이 원인을 바로 알 수 있다.
    return json({ ok: false, error: "NOT_FOUND", path: u.pathname }, 404);
  },
};
