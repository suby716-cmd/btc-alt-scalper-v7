var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var UPBIT = "https://api.upbit.com";
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-scalper-pin"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
__name(json, "json");
function requirePin(req, env) {
  const pin = req.headers.get("x-scalper-pin") || "";
  return !!env.PIN && pin === env.PIN;
}
__name(requirePin, "requirePin");
var ENV_REF = null;
async function fetchJson(url, ms = 5e3, hdr = null) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: hdr || { Accept: "application/json", "User-Agent": "BTC-ALT-REGIME-TRADER/10.4.0-minimal" },
      signal: c.signal
    });
    let body = null;
    try {
      body = await r.json();
    } catch {
    }
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}
__name(fetchJson, "fetchJson");
async function fetchText(url, ms = 8e3, hdr = null) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers: hdr || {
      "Accept": "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (compatible; BTC-ALT-REGIME-TRADER/8.4.4)"
    }, signal: c.signal });
    const tx = await r.text().catch(() => "");
    return { ok: r.ok, status: r.status, body: r.ok ? tx : "", snip: r.ok ? "" : tx.slice(0, 120) };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e), body: "" };
  } finally {
    clearTimeout(t);
  }
}
__name(fetchText, "fetchText");
var CSV_HDR = {
  "Accept": "text/csv,text/plain,application/json;q=0.9,*/*;q=0.8",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
};
async function fetchFredCsv(series, start = "2011-01-01") {
  const [base, query = ""] = String(start).split("__EXTRA__");
  return fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series)}&cosd=${base}${query}`, 12e3, CSV_HDR);
}
__name(fetchFredCsv, "fetchFredCsv");
function parseCoinGeckoDominancePage(html) {
  if (!html) return null;
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const row = text.match(/\bBTC\s+(\d{1,2}(?:\.\d+)?)%\s+(\d{1,2}(?:\.\d+)?)%\s+(\d{1,2}(?:\.\d+)?)%\s+(\d{1,2}(?:\.\d+)?)%\s+(\d{1,2}(?:\.\d+)?)%/i);
  if (row) {
    const v = row.slice(1, 6).map(Number);
    if (v.every((x) => x > 20 && x < 90)) return { today: v[0], d7: v[1], m1: v[2], m3: v[3], y1: v[4] };
  }
  const sentence = text.match(/Bitcoin dominance of\s+(\d{1,2}(?:\.\d+)?)%/i);
  if (sentence) {
    const x = Number(sentence[1]);
    if (x > 20 && x < 90) return { today: x };
  }
  return null;
}
__name(parseCoinGeckoDominancePage, "parseCoinGeckoDominancePage");
var DAY = 864e5;
var MEMCACHE = /* @__PURE__ */ new Map();
var mkey = /* @__PURE__ */ __name((t) => {
  const d = new Date(t);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 7) : null;
}, "mkey");
function addM(k, n) {
  const [y, m] = k.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
__name(addM, "addM");
function monthEnd(k) {
  const [y, m] = k.split("-").map(Number);
  return Date.UTC(y, m, 1) - 1;
}
__name(monthEnd, "monthEnd");
function monthsBetween(a, b) {
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
__name(monthsBetween, "monthsBetween");
var fin = /* @__PURE__ */ __name((x) => typeof x === "number" && Number.isFinite(x), "fin");
var r3 = /* @__PURE__ */ __name((x, d = 3) => fin(x) ? Math.round(x * 10 ** d) / 10 ** d : null, "r3");
var pctOf = /* @__PURE__ */ __name((a, b) => fin(a) && fin(b) && b !== 0 ? (a / b - 1) * 100 : null, "pctOf");
function bsearchLE(arr, t) {
  let lo = 0, hi = arr.length - 1, r = -1;
  while (lo <= hi) {
    const m = lo + hi >> 1;
    if (arr[m].t <= t) {
      r = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return r;
}
__name(bsearchLE, "bsearchLE");
function valAt(arr, t, maxAge = Infinity) {
  if (!arr || !arr.length) return null;
  const i = bsearchLE(arr, t);
  if (i < 0) return null;
  if (t - arr[i].t > maxAge) return null;
  return arr[i].v;
}
__name(valAt, "valAt");
function monthMap(series) {
  const s = /* @__PURE__ */ new Map(), c = /* @__PURE__ */ new Map();
  for (const x of series || []) {
    const k = mkey(x?.t), v = Number(x?.v);
    if (!k || !Number.isFinite(v)) continue;
    s.set(k, (s.get(k) || 0) + v);
    c.set(k, (c.get(k) || 0) + 1);
  }
  const o = /* @__PURE__ */ new Map();
  for (const [k, v] of s) o.set(k, v / c.get(k));
  return o;
}
__name(monthMap, "monthMap");
function monthLast(series) {
  const o = /* @__PURE__ */ new Map();
  for (const x of (series || []).slice().sort((a, b) => a.t - b.t)) {
    const k = mkey(x?.t), v = Number(x?.v);
    if (k && Number.isFinite(v)) o.set(k, v);
  }
  return o;
}
__name(monthLast, "monthLast");
function lookback(map, k, n) {
  for (let i = 0; i <= n; i++) {
    const v = map.get(addM(k, -i));
    if (v != null) return v;
  }
  return null;
}
__name(lookback, "lookback");
var sleep = /* @__PURE__ */ __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep");
async function cached(env, key, ttlSec, producer, isGood, force = false) {
  const now = Date.now();
  let stale = MEMCACHE.get(key) || null;
  if (!force && stale && stale.exp > now) return { ...stale.val, cache: "memory" };
  if (env && env.SCALPER_KV) {
    try {
      const s = await env.SCALPER_KV.get(key, "json");
      if (s && s.val) {
        if (!force && s.exp > now) {
          MEMCACHE.set(key, s);
          return { ...s.val, cache: "kv" };
        }
        if (!stale || s.exp > stale.exp) stale = s;
      }
    } catch {
    }
  }
  let val = null;
  try {
    val = await producer();
  } catch (e) {
    val = { ok: false, error: String(e?.message || e) };
  }
  if (val && isGood(val)) {
    const rec = { exp: now + ttlSec * 1e3, val };
    MEMCACHE.set(key, rec);
    if (env && env.SCALPER_KV) {
      try {
        await env.SCALPER_KV.put(key, JSON.stringify(rec), { expirationTtl: Math.max(60, ttlSec * 8) });
      } catch {
      }
    }
    return { ...val, cache: "fresh" };
  }
  if (stale && stale.val) return { ...stale.val, cache: "stale", staleReason: val?.error || "refresh failed" };
  return val || { ok: false, error: "UNAVAILABLE" };
}
__name(cached, "cached");
function parseFredFast(txt) {
  const out = [];
  if (!txt) return out;
  let i = txt.indexOf("\n");
  if (i < 0) return out;
  i++;
  const n = txt.length;
  while (i < n) {
    let j = txt.indexOf("\n", i);
    if (j < 0) j = n;
    const c = txt.indexOf(",", i);
    if (c - i === 10 && c < j && txt.charCodeAt(i + 4) === 45) {
      const v = parseFloat(txt.slice(c + 1, j));
      if (v === v) out.push({ t: Date.UTC(+txt.slice(i, i + 4), +txt.slice(i + 5, i + 7) - 1, +txt.slice(i + 8, i + 10)), v });
    }
    i = j + 1;
  }
  return out;
}
__name(parseFredFast, "parseFredFast");
async function fredApiSeries(id, start, monthly, aggregation) {
  const key = ENV_REF && ENV_REF.FRED_API_KEY;
  if (!key) return null;
  const extra = monthly ? `&frequency=m&aggregation_method=${encodeURIComponent(aggregation)}` : "";
  const r = await fetchJson(`https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(id)}&api_key=${encodeURIComponent(key)}&file_type=json&observation_start=${start}${extra}`, 12e3);
  const obs = Array.isArray(r.body?.observations) ? r.body.observations : [];
  const series = [];
  for (const o of obs) {
    const v = parseFloat(o.value);
    const t = Date.parse(o.date);
    if (v === v && t === t) series.push({ t, v });
  }
  return { ok: series.length > 0, status: r.status, series, via: "api" };
}
__name(fredApiSeries, "fredApiSeries");
async function fredSeries(id, start, monthly = false, aggregation = "avg") {
  const api = await fredApiSeries(id, start, monthly, aggregation);
  if (api && api.ok) return api;
  const extra = monthly ? `&fq=Monthly&fam=${encodeURIComponent(aggregation)}` : "";
  let r = await fetchFredCsv(id, `${start}__EXTRA__${extra}`);
  const blocked = /* @__PURE__ */ __name((x) => !x.ok && (x.status === 403 || x.status === 429 || x.status >= 500), "blocked");
  if ((!r.ok || !r.body) && !blocked(r)) {
    await sleep(500);
    r = await fetchFredCsv(id, start);
  }
  if ((!r.ok || !r.body) && !blocked(r) && r.status !== 404) {
    await sleep(1200);
    r = await fetchFredCsv(id, start);
  }
  const series = parseFredFast(r.body);
  return { ok: series.length > 0, status: r.status, series, via: "csv", snip: r.snip, error: r.error };
}
__name(fredSeries, "fredSeries");
var splitCsv = /* @__PURE__ */ __name((line) => line.split(",").map((v) => v.trim().replace(/^"|"$/g, "")), "splitCsv");
async function fetchEcbM2() {
  const url = "https://data-api.ecb.europa.eu/service/data/BSI/M.U2.Y.V.M20.X.1.U2.2300.Z01.E?startPeriod=2011-01&format=csvdata";
  const r = await fetchText(url, 12e3, CSV_HDR);
  const map = /* @__PURE__ */ new Map();
  if (r.ok) {
    const lines = r.body.trim().split(/\r?\n/).map(splitCsv);
    const h = lines.findIndex((x) => x.includes("TIME_PERIOD") && x.includes("OBS_VALUE"));
    if (h >= 0) {
      const hi = lines[h].indexOf("TIME_PERIOD"), vi = lines[h].indexOf("OBS_VALUE");
      for (const x of lines.slice(h + 1)) {
        const v = Number(x[vi]);
        if (x[hi] && fin(v)) map.set(x[hi].slice(0, 7), v / 1e3);
      }
    }
  }
  return { ok: map.size > 0, status: r.status, map };
}
__name(fetchEcbM2, "fetchEcbM2");
async function fetchBojM2(nowMs) {
  const end = mkey(nowMs).replace("-", "");
  const urls = [
    `https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=MD02&startDate=201101&endDate=${end}&code=MAM1NAM2M2MO`,
    `https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=MD&startDate=201101&endDate=${end}&code=${encodeURIComponent("MD02'MAM1NAM2M2MO")}`
  ];
  let status = 0;
  for (const url of urls) {
    const r = await fetchText(url, 12e3, CSV_HDR);
    status = r.status;
    const map = /* @__PURE__ */ new Map();
    if (r.ok) {
      const rows = r.body.trim().split(/\r?\n/).map(splitCsv);
      for (const p of rows) {
        for (let i = 0; i < p.length - 1; i++) {
          const m = p[i].match(/^(\d{4})[\/-]?(\d{2})$/);
          const v = Number(p[i + 1]);
          if (m && +m[2] >= 1 && +m[2] <= 12 && fin(v) && p[i + 1] !== "") map.set(`${m[1]}-${m[2]}`, v * 0.1);
        }
      }
      if (!map.size) {
        for (let i = 0; i < rows.length - 1; i++) {
          const d = rows[i].filter((x) => /^\d{6}$/.test(x));
          if (d.length > 10) {
            const vals = rows[i + 1].filter((x) => x !== "" && fin(Number(x))).slice(-d.length);
            if (vals.length === d.length) d.forEach((x, k) => map.set(`${x.slice(0, 4)}-${x.slice(4)}`, Number(vals[k]) * 0.1));
          }
        }
      }
    }
    if (map.size) return { ok: true, status, map };
  }
  return { ok: false, status, map: /* @__PURE__ */ new Map() };
}
__name(fetchBojM2, "fetchBojM2");
async function fetchBtcLivePrice() {
  const sources = [
    { name: "blockchain-ticker", url: "https://blockchain.info/ticker", pick: /* @__PURE__ */ __name((b) => Number(b?.USD?.last ?? b?.USD?.["15m"]), "pick") },
    { name: "coinbase-spot", url: "https://api.coinbase.com/v2/prices/BTC-USD/spot", pick: /* @__PURE__ */ __name((b) => Number(b?.data?.amount), "pick") },
    { name: "kraken-ticker", url: "https://api.kraken.com/0/public/Ticker?pair=XBTUSD", pick: /* @__PURE__ */ __name((b) => Number(b?.result?.XXBTZUSD?.c?.[0] ?? b?.result?.XBTUSD?.c?.[0]), "pick") }
  ];
  for (const s of sources) {
    const r = await fetchJson(s.url, 5e3);
    const v = s.pick(r.body);
    if (r.ok && Number.isFinite(v) && v > 1e3) return { ok: true, v, source: s.name, status: r.status };
  }
  return { ok: false, v: null, source: null, status: 0 };
}
__name(fetchBtcLivePrice, "fetchBtcLivePrice");
function mergeBtcSeries(primary, secondary) {
  const map = /* @__PURE__ */ new Map();
  for (const p of primary || []) if (fin(p.t) && p.v > 0) map.set(Math.floor(p.t / 864e5), p);
  for (const p of secondary || []) {
    if (!fin(p.t) || !(p.v > 0)) continue;
    const day = Math.floor(p.t / 864e5);
    const existing = map.get(day);
    if (!existing || p.t >= existing.t) map.set(day, p);
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}
__name(mergeBtcSeries, "mergeBtcSeries");
async function fetchBtcFromBlockchainCharts() {
  const r = await fetchJson("https://api.blockchain.info/charts/market-price?timespan=all&sampled=true&metadata=false&cors=true&format=json", 15e3);
  const vals = Array.isArray(r.body?.values) ? r.body.values : [];
  const series = vals.map((x) => ({ t: x.x * 1e3, v: Number(x.y) })).filter((x) => fin(x.t) && x.v > 0).sort((a, b) => a.t - b.t);
  return { ok: series.length > 200, status: r.status, series, source: "blockchain.info/charts" };
}
__name(fetchBtcFromBlockchainCharts, "fetchBtcFromBlockchainCharts");
async function fetchBtcFromBinanceDaily(maxPages = 2) {
  const endpoints = [
    "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000",
    "https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000"
  ];
  for (const url of endpoints) {
    let all = [];
    let endTime = null;
    for (let page = 0; page < maxPages; page++) {
      const u = endTime ? `${url}&endTime=${endTime}` : url;
      const r = await fetchJson(u, 1e4);
      if (!r.ok || !Array.isArray(r.body) || !r.body.length) break;
      const chunk = r.body.map((x) => ({ t: Number(x[0]), v: Number(x[4]) })).filter((x) => fin(x.t) && x.v > 0);
      if (!chunk.length) break;
      all = all.concat(chunk);
      endTime = chunk[0].t - 1;
      if (chunk.length < 500) break;
    }
    if (all.length > 200) {
      const map = /* @__PURE__ */ new Map();
      for (const p of all) map.set(Math.floor(p.t / 864e5), p);
      const series = [...map.values()].sort((a, b) => a.t - b.t);
      return { ok: true, status: 200, series, source: url.includes("binance.us") ? "binance.us/1d" : "binance.vision/1d" };
    }
  }
  return { ok: false, status: 0, series: [], source: "binance-daily" };
}
__name(fetchBtcFromBinanceDaily, "fetchBtcFromBinanceDaily");
async function fetchBtcFromCoinbaseDaily() {
  const base = "https://api.exchange.coinbase.com/products/BTC-USD/candles";
  let all = [];
  let end = (/* @__PURE__ */ new Date()).toISOString();
  for (let page = 0; page < 4; page++) {
    const url = `${base}?granularity=86400&end=${encodeURIComponent(end)}`;
    const r = await fetchJson(url, 8e3);
    if (!r.ok || !Array.isArray(r.body) || !r.body.length) break;
    const chunk = r.body.map((x) => ({ t: Number(x[0]) * 1e3, v: Number(x[4]) })).filter((x) => fin(x.t) && x.v > 0);
    if (!chunk.length) break;
    all = all.concat(chunk);
    const oldest = Math.min(...chunk.map((p) => p.t));
    end = new Date(oldest - 864e5).toISOString();
    if (chunk.length < 100) break;
  }
  if (all.length < 100) return { ok: false, status: 0, series: [], source: "coinbase/1d" };
  const map = /* @__PURE__ */ new Map();
  for (const p of all) map.set(Math.floor(p.t / 864e5), p);
  const series = [...map.values()].sort((a, b) => a.t - b.t);
  return { ok: true, status: 200, series, source: "coinbase/1d" };
}
__name(fetchBtcFromCoinbaseDaily, "fetchBtcFromCoinbaseDaily");
function patchSeriesWithLive(series, liveV) {
  if (!series.length || !Number.isFinite(liveV) || liveV <= 0) return series;
  const last = series[series.length - 1];
  const today = Date.UTC((/* @__PURE__ */ new Date()).getUTCFullYear(), (/* @__PURE__ */ new Date()).getUTCMonth(), (/* @__PURE__ */ new Date()).getUTCDate());
  if (Math.abs(last.t - today) < 864e5) {
    series[series.length - 1] = { t: today, v: liveV };
  } else {
    series.push({ t: today, v: liveV });
  }
  return series;
}
__name(patchSeriesWithLive, "patchSeriesWithLive");
async function fetchBtcPrice() {
  const sourcesTried = [];
  let series = [];
  let primaryStatus = 0;
  let primarySource = null;
  const bc = await fetchBtcFromBlockchainCharts();
  sourcesTried.push({ source: bc.source, ok: bc.ok, status: bc.status, n: bc.series?.length || 0 });
  if (bc.ok && bc.series.length > 300) {
    series = bc.series.slice();
    primaryStatus = bc.status;
    primarySource = bc.source;
    const ageDays = (Date.now() - series.at(-1).t) / 864e5;
    if (ageDays > 0.8) {
      const live = await fetchBtcLivePrice();
      sourcesTried.push({ source: live.source || "live-ticker", ok: live.ok, status: live.status, n: live.ok ? 1 : 0 });
      if (live.ok) series = patchSeriesWithLive(series, live.v);
    }
    return { ok: true, status: primaryStatus, series, source: primarySource, sourcesTried };
  }
  const bn = await fetchBtcFromBinanceDaily(2);
  sourcesTried.push({ source: bn.source, ok: bn.ok, status: bn.status, n: bn.series?.length || 0 });
  if (bn.ok) {
    series = series.length > 100 ? mergeBtcSeries(series, bn.series) : bn.series;
    primaryStatus = bn.status;
    primarySource = bn.source;
  }
  if (series.length < 300) {
    const cb = await fetchBtcFromCoinbaseDaily();
    sourcesTried.push({ source: cb.source, ok: cb.ok, status: cb.status, n: cb.series?.length || 0 });
    if (cb.ok) {
      series = series.length > 100 ? mergeBtcSeries(series, cb.series) : cb.series;
      if (!primarySource) {
        primaryStatus = cb.status;
        primarySource = cb.source;
      }
    }
  }
  if (series.length > 50) {
    const ageDays = (Date.now() - series.at(-1).t) / 864e5;
    if (ageDays > 0.8) {
      const live = await fetchBtcLivePrice();
      sourcesTried.push({ source: live.source || "live-ticker", ok: live.ok, status: live.status, n: live.ok ? 1 : 0 });
      if (live.ok) series = patchSeriesWithLive(series, live.v);
    }
  }
  return {
    ok: series.length > 100,
    status: primaryStatus,
    series,
    source: primarySource || "none",
    sourcesTried
  };
}
__name(fetchBtcPrice, "fetchBtcPrice");
async function fetchStable() {
  const r = await fetchJson("https://stablecoins.llama.fi/stablecoincharts/all", 15e3);
  const a = Array.isArray(r.body) ? r.body : [];
  const series = a.map((x) => ({ t: Number(x.date) * 1e3, v: Number(x.totalCirculatingUSD?.peggedUSD ?? x.totalCirculating?.peggedUSD) / 1e9 })).filter((x) => fin(x.t) && x.v > 0).sort((p, q) => p.t - q.t);
  return { ok: series.length > 100, status: r.status, series };
}
__name(fetchStable, "fetchStable");
async function fetchCmcDominance(nowMs) {
  const url = `https://api.coinmarketcap.com/data-api/v3/global-metrics/quotes/historical?format=chart&interval=7d&timeStart=${Math.floor(Date.UTC(2013, 3, 28) / 1e3)}&timeEnd=${Math.floor(nowMs / 1e3)}`;
  const r = await fetchJson(url, 15e3);
  const q = Array.isArray(r.body?.data?.quotes) ? r.body.data.quotes : [];
  const series = [];
  for (const x of q) {
    const t = Date.parse(x.timestamp || x.quote?.[0]?.timestamp);
    const v = Number(x.btcDominance ?? x.quote?.[0]?.btcDominance);
    if (fin(t) && v > 20 && v < 100) series.push({ t, v });
  }
  series.sort((a, b) => a.t - b.t);
  const out = [];
  let last = -1;
  for (const s of series) {
    if (s.t - last >= 6 * DAY) {
      out.push([s.t, r3(s.v, 2)]);
      last = s.t;
    }
  }
  return { ok: out.length > 100, status: r.status, series: out };
}
__name(fetchCmcDominance, "fetchCmcDominance");
function buildGlobalM2(f, ea, jp, curK) {
  const fx = {
    eu: monthMap(f.eurusd?.series || []),
    jp: monthMap(f.jpyusd?.series || [])
  };
  const keys = [];
  for (let k = "2010-06"; k <= curK; k = addM(k, 1)) keys.push(k);
  const defs = [
    { name: "US", map: f.m2?.ok ? monthMap(f.m2.series) : null, fx: null, conv: /* @__PURE__ */ __name((v) => v, "conv") },
    { name: "EA", map: ea?.ok ? ea.map : null, fx: fx.eu, conv: /* @__PURE__ */ __name((v, r) => v * r, "conv") },
    { name: "JP", map: jp?.ok ? jp.map : null, fx: fx.jp, conv: /* @__PURE__ */ __name((v, r) => v / r, "conv") }
  ];
  const used = defs.filter((d) => d.map?.size).map((d) => d.name);
  const rejected = defs.filter((d) => !d.map?.size).map((d) => ({ name: d.name, why: "\uB370\uC774\uD130 \uC5C6\uC74C" }));
  const global = /* @__PURE__ */ new Map();
  for (const k of keys) {
    let sum = 0, count = 0;
    for (const d of defs) {
      if (!d.map?.size) continue;
      const raw = lookback(d.map, k, 3), rate = d.fx ? lookback(d.fx, k, 2) : 1;
      if (raw == null || rate == null || rate === 0 || !Number.isFinite(raw) || !Number.isFinite(rate)) continue;
      const v = d.conv(raw, rate);
      if (Number.isFinite(v) && v > 0) {
        sum += v;
        count++;
      }
    }
    if (count >= 2 && Number.isFinite(sum)) global.set(k, sum);
  }
  const yoy = /* @__PURE__ */ new Map();
  for (const [k, v] of global) {
    const p = global.get(addM(k, -12));
    if (Number.isFinite(p) && p > 0) yoy.set(k, (v / p - 1) * 100);
  }
  return { global, yoy, used, rejected, lastK: [...global.keys()].pop() || null };
}
__name(buildGlobalM2, "buildGlobalM2");
function featureRow(k, t, live, c) {
  const lag = addM(k, -1);
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
    k,
    t,
    live,
    m2yoy: r3(y, 2),
    m2accel: fin(y) && fin(y6) ? r3(y - y6, 2) : null,
    fed12: fin(fedNow) && fin(fedPrev) ? r3(fedNow - fedPrev, 2) : null,
    fedLvl: r3(fedNow, 2),
    dollar3m: r3(pctOf(dolNow, dolPrev), 2),
    oil3m: r3(pctOf(oilNow, oilPrev), 2),
    sp90: r3(pctOf(spNow, spPrev), 2),
    us10y: r3(y10Now, 2),
    us10y3m: r3(pctOf(y10Now, y10Prev), 2),
    btc: r3(btcNow, 0),
    btc90: r3(pctOf(btcNow, btcPrev), 2),
    ethbtc: r3(eb, 5),
    eth90: r3(pctOf(eb, eb0), 2),
    stable90: r3(pctOf(st, st0), 2)
  };
}
__name(featureRow, "featureRow");
var YH = { "Accept": "application/json,text/plain,*/*", "User-Agent": CSV_HDR["User-Agent"] };
var SINCE = Date.UTC(2010, 5, 1);
async function yahooMonthly(sym) {
  const r = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=1275350400&period2=${Math.floor(Date.now() / 1e3)}&interval=1mo`, 12e3, YH);
  const res = r.body?.chart?.result?.[0];
  const ts = res?.timestamp || [], cl = res?.indicators?.quote?.[0]?.close || [];
  const series = [];
  for (let i = 0; i < ts.length; i++) {
    const v = Number(cl[i]), t = ts[i] * 1e3;
    if (fin(v) && v > 0 && t >= SINCE) series.push({ t: t + 3 * DAY, v });
  }
  return { ok: series.length > 100, status: r.status, series, via: "yahoo:" + sym };
}
__name(yahooMonthly, "yahooMonthly");
async function stooqMonthly(sym) {
  const r = await fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=m`, 12e3, CSV_HDR);
  const series = [];
  if (r.ok) for (const line of r.body.trim().split(/\r?\n/).slice(1)) {
    const p = line.split(",");
    const t = Date.parse(p[0]), v = Number(p[4]);
    if (fin(t) && fin(v) && v > 0 && t >= SINCE) series.push({ t, v });
  }
  return { ok: series.length > 100, status: r.status, series, via: "stooq:" + sym };
}
__name(stooqMonthly, "stooqMonthly");
async function nyFedEffr() {
  const end = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const r = await fetchJson(`https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate=2010-06-01&endDate=${end}&type=rate`, 15e3, YH);
  const a = Array.isArray(r.body?.refRates) ? r.body.refRates : [];
  const series = a.map((x) => ({ t: Date.parse(x.effectiveDate), v: Number(x.percentRate) })).filter((x) => fin(x.t) && fin(x.v)).sort((p, q) => p.t - q.t);
  return { ok: series.length > 100, status: r.status, series, via: "nyfed" };
}
__name(nyFedEffr, "nyFedEffr");
async function ecbFxDaily(cur) {
  const r = await fetchText(`https://data-api.ecb.europa.eu/service/data/EXR/D.${cur}.EUR.SP00.A?startPeriod=2010-06-01&format=csvdata`, 15e3, CSV_HDR);
  const m = /* @__PURE__ */ new Map();
  if (r.ok) {
    const lines = r.body.trim().split(/\r?\n/).map(splitCsv);
    const h = lines.findIndex((x) => x.includes("TIME_PERIOD") && x.includes("OBS_VALUE"));
    if (h >= 0) {
      const hi = lines[h].indexOf("TIME_PERIOD"), vi = lines[h].indexOf("OBS_VALUE");
      for (const x of lines.slice(h + 1)) {
        const v = Number(x[vi]);
        if (x[hi] && fin(v) && v > 0) m.set(x[hi], v);
      }
    }
  }
  return { ok: m.size > 100, status: r.status, map: m };
}
__name(ecbFxDaily, "ecbFxDaily");
async function ecbFx() {
  const currencies = ["USD", "JPY", "GBP"];
  const got = await Promise.all(currencies.map(ecbFxDaily));
  const maps = Object.fromEntries(currencies.map((c, i) => [c, got[i].map]));
  const usd = maps.USD;
  const make = /* @__PURE__ */ __name((cur) => [...usd.keys()].sort().map((d) => {
    const eurUsd = usd.get(d), eurCur = maps[cur]?.get(d);
    if (!fin(eurUsd) || !fin(eurCur) || eurCur === 0) return null;
    return { t: Date.parse(d), v: eurUsd / eurCur };
  }).filter(Boolean), "make");
  return {
    eurusd: { ok: got[0].ok, status: got[0].status, via: "ecb", series: [...usd.keys()].sort().map((d) => {
      const a = usd.get(d), t = Date.parse(d);
      return fin(a) && Number.isFinite(t) ? { t, v: a } : null;
    }).filter(Boolean) },
    jpyusd: { ok: got[0].ok && got[1].ok, status: got[1].status, via: "ecb", series: [...usd.keys()].sort().map((d) => {
      const a = usd.get(d), b = maps.JPY?.get(d), t = Date.parse(d);
      return fin(a) && fin(b) && b && Number.isFinite(t) ? { t, v: b / a } : null;
    }).filter(Boolean) },
    gbpusd: { ok: got[0].ok && got[2].ok, status: got[2].status, via: "ecb", series: make("GBP") }
  };
}
__name(ecbFx, "ecbFx");
async function ethBtcAlt() {
  let r = await yahooMonthly("ETH-BTC");
  if (r.ok) return r;
  const a = await fetchJson("https://min-api.cryptocompare.com/data/v2/histoday?fsym=ETH&tsym=BTC&limit=2000", 15e3, YH);
  const arr = a.body?.Data?.Data || [];
  const series = arr.map((x) => ({ t: x.time * 1e3, v: Number(x.close) })).filter((x) => fin(x.v) && x.v > 0);
  return { ok: series.length > 100, status: a.status, series, via: "cryptocompare" };
}
__name(ethBtcAlt, "ethBtcAlt");
async function altSeries(name, fx) {
  const both = /* @__PURE__ */ __name(async (y, st) => {
    const r = await yahooMonthly(y);
    return r.ok ? r : await stooqMonthly(st);
  }, "both");
  if (name === "sp") return both("^GSPC", "^spx");
  if (name === "dollar") return both("DX-Y.NYB", "dx.f");
  if (name === "oil") return both("CL=F", "cl.f");
  if (name === "y10") {
    const r = await both("^TNX", "10usy.b");
    if (r.ok && r.series.length && r.series[r.series.length - 1].v > 25) r.series = r.series.map((x) => ({ t: x.t, v: x.v / 10 }));
    return r;
  }
  if (name === "fed") {
    const r = await nyFedEffr();
    return r.ok ? r : yahooMonthly("^IRX");
  }
  if (fx && fx[name]) return fx[name];
  return { ok: false, status: 0, series: [], via: null };
}
__name(altSeries, "altSeries");
var FED_H6_M2_URL = "https://www.federalreserve.gov/datadownload/Output.aspx?filetype=csv&from=&label=include&lastobs=&layout=seriescolumn&rel=H6&series=798e2796917702a5f8423426ba7e6b42&to=&type=package";
function parseFedH6M2Csv(txt) {
  const parseLine = /* @__PURE__ */ __name((line) => {
    const out2 = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === "," && !q) {
        out2.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out2.push(cur.trim());
    return out2;
  }, "parseLine");
  const rows = String(txt || "").split(/\r?\n/).filter(Boolean).map(parseLine);
  if (!rows.length) return [];
  const norm = /* @__PURE__ */ __name((v) => String(v ?? "").trim().replace(/^"|"$/g, "").trim(), "norm");
  const isDate = /* @__PURE__ */ __name((v) => /^(?:19|20)\d{2}[-\/]\d{2}(?:[-\/]\d{2})?$/.test(norm(v)), "isDate");
  const toMonth = /* @__PURE__ */ __name((v) => {
    const m2 = norm(v).match(/^(\d{4})[-\/]?(\d{2})/);
    return m2 ? `${m2[1]}-${m2[2]}-01` : null;
  }, "toMonth");
  const toNum = /* @__PURE__ */ __name((v) => {
    const z = norm(v).replace(/,/g, "");
    if (!z || z === "." || /^ND$/i.test(z)) return null;
    const n = Number(z);
    return Number.isFinite(n) ? n : null;
  }, "toNum");
  const out = [];
  for (let hi = 0; hi < Math.min(rows.length, 20); hi++) {
    const h = rows[hi].map(norm);
    const ti = h.findIndex((x) => /^(?:time period|observation date|date)$/i.test(x));
    const vi = h.findIndex((x) => /(?:H6\/H6[_\/]M2[_\/]M2\.M|\bM2\.M\b)/i.test(x));
    if (ti >= 0 && vi >= 0) {
      for (const r of rows.slice(hi + 1)) {
        const d = toMonth(r[ti]);
        const v = toNum(r[vi]);
        if (d && v != null && v > 0) out.push({ d, v });
      }
      if (out.length) break;
    }
  }
  if (!out.length) {
    for (let hi = 0; hi < Math.min(rows.length, 20); hi++) {
      const h = rows[hi].map(norm);
      const dateCols = h.map((x, i) => isDate(x) ? i : -1).filter((i) => i >= 0);
      if (dateCols.length < 12) continue;
      const ri = rows.findIndex((r2, idx) => idx > hi && r2.some((x) => /(?:H6\/H6[_\/]M2[_\/]M2\.M|\bM2\.M\b|M2;\s*Seasonally adjusted)/i.test(norm(x))));
      if (ri < 0) continue;
      const r = rows[ri];
      for (const i of dateCols) {
        const d = toMonth(h[i]), v = toNum(r[i]);
        if (d && v != null && v > 0) out.push({ d, v });
      }
      if (out.length) break;
    }
  }
  if (!out.length) {
    for (let hi = 0; hi < Math.min(rows.length, 30); hi++) {
      const h = rows[hi].map(norm);
      const ti = h.findIndex((x) => /^(?:time period|observation date|date)$/i.test(x));
      const vi = h.findIndex((x) => /(?:M2\.M|M2;\s*Seasonally adjusted)/i.test(x));
      if (ti < 0 || vi < 0) continue;
      for (const r of rows.slice(hi + 1)) {
        const d = toMonth(r[ti]), v = toNum(r[vi]);
        if (d && v != null && v > 0) out.push({ d, v });
      }
      if (out.length) break;
    }
  }
  const m = /* @__PURE__ */ new Map();
  for (const x of out) m.set(x.d.slice(0, 7), x.v);
  return [...m].map(([k, v]) => ({ t: Date.parse(`${k}-01T00:00:00Z`), v })).filter((x) => Number.isFinite(x.t) && Number.isFinite(x.v)).sort((a, b) => a.t - b.t);
}
__name(parseFedH6M2Csv, "parseFedH6M2Csv");
async function fetchFedH6M2() {
  try {
    const r = await fetchText(FED_H6_M2_URL, 15e3, CSV_HDR);
    const series = parseFedH6M2Csv(r.body);
    return { ok: series.length > 24, status: r.status, series, via: "federal-reserve-h6", source: "Federal Reserve Board H.6 M2.M" };
  } catch (e) {
    return { ok: false, status: 0, series: [], via: "federal-reserve-h6", error: String(e?.message || e) };
  }
}
__name(fetchFedH6M2, "fetchFedH6M2");
async function fredLimited(names, ids) {
  const hasKey = !!(ENV_REF && ENV_REF.FRED_API_KEY);
  const out = new Array(names.length);
  const m2i = names.indexOf("m2");
  if (m2i >= 0) {
    out[m2i] = await fetchFedH6M2();
    if (!out[m2i].ok) out[m2i] = await fredSeries(ids.m2, "2010-06-01", true, "avg");
  }
  const todo = names.map((n, i) => i).filter((i) => i !== m2i && (hasKey || false));
  names.forEach((n, i) => {
    if (i !== m2i && !todo.includes(i)) out[i] = { ok: false, status: 0, series: [], via: "skipped" };
  });
  let next = 0;
  const worker = /* @__PURE__ */ __name(async () => {
    while (next < todo.length) {
      const i = todo[next++], n = names[i];
      out[i] = await fredSeries(ids[n], "2010-06-01", !["cbbtc", "cbeth"].includes(n), "avg");
    }
  }, "worker");
  await Promise.all([worker(), worker(), worker()]);
  return out;
}
__name(fredLimited, "fredLimited");
async function fillAlt(names, arr) {
  const need = names.filter((n, i) => !arr[i].ok && !["m2", "cbbtc", "cbeth"].includes(n));
  if (!need.length) return arr;
  const fx = need.some((n) => ["eurusd", "jpyusd", "gbpusd"].includes(n)) ? await ecbFx() : null;
  const res = await Promise.all(need.map((n) => altSeries(n, fx)));
  need.forEach((n, k) => {
    arr[names.indexOf(n)] = { ...res[k], via: res[k].via || "alt" };
  });
  return arr;
}
__name(fillAlt, "fillAlt");
async function buildHistory() {
  const t0 = Date.now(), now = t0, curK = mkey(now);
  const ids = { m2: "M2SL", fed: "EFFR", dollar: "DTWEXBGS", oil: "WTISPLC", sp: "SP500", y10: "DGS10", eurusd: "DEXUSEU", jpyusd: "DEXJPUS", gbpusd: "EXUSUK", cbbtc: "CBBTCUSD", cbeth: "CBETHUSD" };
  const names = Object.keys(ids);
  const [fredArr0, ea, jp, bc, sc, cmc, ethAlt] = await Promise.all([
    fredLimited(names, ids),
    fetchEcbM2(),
    fetchBojM2(now),
    fetchBtcPrice(),
    fetchStable(),
    fetchCmcDominance(now),
    ethBtcAlt()
  ]);
  const fredArr = await fillAlt(names, fredArr0);
  const f = {};
  names.forEach((n, i) => f[n] = fredArr[i]);
  const fxAll = await ecbFx();
  f.eurusd = fxAll.eurusd;
  f.jpyusd = fxAll.jpyusd;
  f.gbpusd = fxAll.gbpusd;
  const g = buildGlobalM2(f, ea, jp, curK);
  const btc = bc.ok ? bc.series : f.cbbtc.ok ? f.cbbtc.series : [];
  const c = {
    yoy: g.yoy,
    fedM: monthMap(f.fed.series),
    dolM: monthMap(f.dollar.series),
    oilM: monthMap(f.oil.series),
    spM: monthMap(f.sp.series),
    y10M: monthMap(f.y10.series),
    btcM: monthLast(btc),
    cbbtc: f.cbbtc.series,
    cbeth: f.cbeth.series,
    ethBtcM: ethAlt.ok ? monthLast(ethAlt.series) : monthLast(f.cbeth.series.map((x, i) => ({ t: x.t, v: x.v / (valAt(f.cbbtc.series, x.t, 7 * DAY) || NaN) })).filter((x) => fin(x.v))),
    stableM: monthLast(sc.series)
  };
  const rows = [];
  for (let k = "2012-01"; k <= curK; k = addM(k, 1)) rows.push(featureRow(k, k === curK ? now : monthEnd(k), k === curK, c));
  const last = /* @__PURE__ */ __name((a) => a.length ? a[a.length - 1].v : null, "last");
  const lvl = {
    fed: last(f.fed.series),
    dollar: last(f.dollar.series),
    oil: last(f.oil.series),
    sp: last(f.sp.series),
    y10: last(f.y10.series),
    m2: g.lastK ? g.global.get(g.lastK) : null,
    m2Key: g.lastK,
    stable: last(sc.series)
  };
  const sources = {
    fred: { ok: fredArr.filter((x) => x.ok).length, total: names.length, failed: names.filter((n, i) => !fredArr[i].ok), via: fredArr.find((x) => x.ok && x.via === "csv" || x.via === "api")?.via || null, alt: Object.fromEntries(names.map((n, i) => [n, fredArr[i].via || null])), ethbtc: { ok: ethAlt.ok, via: ethAlt.via, status: ethAlt.status }, status: Object.fromEntries(names.map((n, i) => [n, fredArr[i].status])), hint: fredArr.find((x) => !x.ok)?.snip || fredArr.find((x) => !x.ok)?.error || void 0 },
    ecb: { ok: ea.ok, status: ea.status },
    boj: { ok: jp.ok, status: jp.status },
    globalM2: { profile: "US+EU+JP", used: g.used, rejected: g.rejected },
    usM2: { ok: !!f.m2?.ok, status: f.m2?.status ?? 0, via: f.m2?.via || null, series: f.m2?.series?.length || 0 },
    btcPrice: { ok: bc.ok, status: bc.status, fallback: !bc.ok && f.cbbtc.ok },
    stablecoin: { ok: sc.ok, status: sc.status },
    cmcDominance: { ok: cmc.ok, status: cmc.status }
  };
  const ok = rows.some((r) => fin(r.m2yoy)) && btc.length > 0;
  return { ok, built: now, ms: Date.now() - t0, rows, levels: { ...lvl, m2Extended: lvl.m2, m2ExtendedKey: lvl.m2Key }, m2: { used: g.used, rejected: g.rejected, lastKey: g.lastK, extended: { used: g.used, rejected: g.rejected, lastKey: g.lastK, yoy: g.lastK ? g.yoy.get(g.lastK) ?? null : null, value: g.lastK ? g.global.get(g.lastK) : null } }, cmcDom: cmc.ok ? cmc.series : null, sources, error: ok ? void 0 : "HISTORY_INPUTS_MISSING" };
}
__name(buildHistory, "buildHistory");
var COIN_GROUPS = [
  { key: "eth", label: "ETH", coins: ["ETH"] },
  { key: "large", label: "\uB300\uD615 \uC54C\uD2B8", coins: ["XRP", "SOL", "ADA", "DOGE", "LINK", "AVAX"] },
  { key: "mid", label: "\uC911\uD615 \uC54C\uD2B8", coins: ["SUI", "HBAR", "XLM", "UNI", "AAVE", "NEAR", "APT", "ARB", "INJ"] },
  { key: "small", label: "\uC18C\uD615\xB7\uACE0\uBCA0\uD0C0", coins: ["ONDO", "TAO", "SEI"] }
];
async function upbitDays(sym, count = 100) {
  let r = await fetchJson(`${UPBIT}/v1/candles/days?market=KRW-${sym}&count=${count}`, 7e3);
  for (let k = 0; k < 3 && !(Array.isArray(r.body) && r.body.length) && (r.status === 429 || r.status >= 500 || r.status === 0); k++) {
    await sleep(600 + k * 500);
    r = await fetchJson(`${UPBIT}/v1/candles/days?market=KRW-${sym}&count=${count}`, 7e3);
  }
  const a = Array.isArray(r.body) ? r.body : [];
  const rows = a.map((x) => ({ t: Date.parse(x.candle_date_time_utc + "Z"), c: Number(x.trade_price), v: Number(x.candle_acc_trade_price) })).filter((x) => fin(x.c) && x.c > 0).sort((p, q) => p.t - q.t);
  return { ok: rows.length >= 40, status: r.status, rows };
}
__name(upbitDays, "upbitDays");
var retN = /* @__PURE__ */ __name((rows, n) => rows.length > n ? pctOf(rows[rows.length - 1].c, rows[rows.length - 1 - n].c) : null, "retN");
function vol7over30(rows) {
  if (rows.length < 38) return null;
  const n = rows.length, s7 = rows.slice(n - 7).reduce((s, x) => s + x.v, 0) / 7, s30 = rows.slice(n - 37, n - 7).reduce((s, x) => s + x.v, 0) / 30;
  return s30 > 0 ? s7 / s30 : null;
}
__name(vol7over30, "vol7over30");
async function buildLive() {
  const t0 = Date.now();
  const num = /* @__PURE__ */ __name((v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }, "num");
  const [cgApiR, cgPageR] = await Promise.all([fetchJson("https://api.coingecko.com/api/v3/global", 9e3), fetchText("https://www.coingecko.com/en/charts/bitcoin-dominance", 9e3)]);
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
      const d = await upbitDays(sym);
      if (!d.ok) continue;
      const r7 = retN(d.rows, 7), r30 = retN(d.rows, 30), r90 = retN(d.rows, 90);
      coins.push({ sym, group: g.key, ret7: r3(r7, 1), ret30: r3(r30, 1), ret90: r3(r90, 1), rel7: fin(r7) && fin(b7) ? r3(r7 - b7, 1) : null, rel30: fin(r30) && fin(b30) ? r3(r30 - b30, 1) : null, rel90: fin(r90) && fin(b90) ? r3(r90 - b90, 1) : null, vol: r3(vol7over30(d.rows), 2), _rows: d.rows });
    }
  }
  let ethbtc = null;
  const eth = coins.find((c) => c.sym === "ETH");
  if (eth && btc.ok) {
    const bm = new Map(btc.rows.map((x) => [x.t, x.c]));
    const ser = eth._rows.filter((x) => bm.has(x.t)).map((x) => ({ t: x.t, v: x.c / bm.get(x.t) }));
    if (ser.length > 91) ethbtc = { now: r3(ser.at(-1).v, 5), ch7: r3(pctOf(ser.at(-1).v, ser.at(-8).v), 2), ch30: r3(pctOf(ser.at(-1).v, ser.at(-31).v), 2), ch90: r3(pctOf(ser.at(-1).v, ser.at(-91).v), 2) };
  }
  let s7 = 0, s30 = 0, nv = 0;
  for (const c of coins) {
    const n = c._rows.length;
    if (n < 38) continue;
    s7 += c._rows.slice(n - 7).reduce((s, x) => s + x.v, 0) / 7;
    s30 += c._rows.slice(n - 37, n - 7).reduce((s, x) => s + x.v, 0) / 30;
    nv++;
  }
  const volRatio = nv && s30 > 0 ? r3(s7 / s30, 2) : null;
  coins.forEach((c) => delete c._rows);
  const valid7 = coins.filter((c) => fin(c.rel7)), valid90 = coins.filter((c) => fin(c.rel90)), valid30 = coins.filter((c) => fin(c.rel30));
  const pctBeat7 = valid7.length ? r3(valid7.filter((c) => c.rel7 > 0).length / valid7.length * 100, 0) : null;
  const pctBeat90 = valid90.length ? r3(valid90.filter((c) => c.rel90 > 0).length / valid90.length * 100, 0) : null;
  const pctBeat30 = valid30.length ? r3(valid30.filter((c) => c.rel30 > 0).length / valid30.length * 100, 0) : null;
  const breadthBlend = [pctBeat7, pctBeat30, pctBeat90].filter(fin).length ? r3((pctBeat7 ?? pctBeat30 ?? pctBeat90) * 0.2 + (pctBeat30 ?? pctBeat90 ?? pctBeat7) * 0.3 + (pctBeat90 ?? pctBeat30 ?? pctBeat7) * 0.5, 0) : null;
  const groups = COIN_GROUPS.map((g) => {
    const m = coins.filter((c) => c.group === g.key && fin(c.rel30));
    const avg = m.length ? m.reduce((s, c) => s + c.rel30, 0) / m.length : null;
    return { key: g.key, label: g.label, n: m.length, rel30: r3(avg, 1), beat: fin(avg) ? avg > 0 : null };
  });
  let reach = 0;
  for (const g of groups) {
    if (g.beat === true) reach++;
    else break;
  }
  const ok = btc.ok && coins.length >= 6;
  return {
    ok,
    built: Date.now(),
    ms: Date.now() - t0,
    dom,
    btcKrw: btc.ok ? { ret7: r3(retN(btc.rows, 7), 1), ret30: r3(retN(btc.rows, 30), 1), ret90: r3(retN(btc.rows, 90), 1) } : null,
    ethbtc,
    coins,
    breadth: { n: coins.length, pctBeat7, pctBeat30, pctBeat90, breadthBlend, volRatio },
    groups,
    reach,
    sources: { coingecko: { ok: !!dom, api: cgApiR.status, page: cgPageR.status }, upbit: { ok: btc.ok, coins: coins.length, missing: COIN_GROUPS.flatMap((g) => g.coins).filter((x) => !coins.some((c) => c.sym === x)), total: COIN_GROUPS.reduce((s, g) => s + g.coins.length, 0) } },
    error: ok ? void 0 : "LIVE_INPUTS_MISSING"
  };
}
__name(buildLive, "buildLive");
var MAXPTS = { m2: 15, accel: 10, dollar: 10, fed: 10, btc: 10, dom: 20, eth: 10, alt: 15 };
var SCORE_KEYS = Object.keys(MAXPTS);
var SCORE_LOOKBACK = 60;
var clamp01 = /* @__PURE__ */ __name((x) => Math.max(0, Math.min(1, x)), "clamp01");
function percentileRank(v, arr, higherBetter = true) {
  const a = arr.filter(fin).sort((x, y) => x - y);
  if (!fin(v) || !a.length) return null;
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const m = lo + hi >> 1;
    if (a[m] < v) lo = m + 1;
    else hi = m;
  }
  let first = lo, last = lo;
  while (first > 0 && a[first - 1] === v) first--;
  while (last < a.length - 1 && a[last + 1] === v) last++;
  const rank = (first + last) / 2 / (a.length - 1 || 1);
  return higherBetter ? rank : 1 - rank;
}
__name(percentileRank, "percentileRank");
function trailingValues(rows, idx, field, min = 12) {
  const from = Math.max(0, idx - SCORE_LOOKBACK), a = [];
  for (let i = from; i < idx; i++) {
    const v = rows[i]?.[field];
    if (fin(v)) a.push(v);
  }
  return a.length >= min ? a : [];
}
__name(trailingValues, "trailingValues");
function altProxyPct(row, rows, idx) {
  const a = [];
  const dom = percentileRank(row.dom90, trailingValues(rows, idx, "dom90"), false);
  const eth = percentileRank(row.eth90, trailingValues(rows, idx, "eth90"), true);
  const st = percentileRank(row.stable90, trailingValues(rows, idx, "stable90"), true);
  if (fin(dom)) a.push(dom);
  if (fin(eth)) a.push(eth);
  if (fin(st)) a.push(st);
  return a.length >= 2 ? a.reduce((s, x) => s + x, 0) / a.length : null;
}
__name(altProxyPct, "altProxyPct");
function dynamicScore(row, rows, idx, altPts = null) {
  const p = {};
  const specs = {
    m2: ["m2yoy", true],
    accel: ["m2accel", true],
    dollar: ["dollar3m", false],
    fed: ["fed12", false],
    btc: ["btc90", true],
    dom: ["dom90", false],
    eth: ["eth90", true]
  };
  for (const [k, [field, hi]] of Object.entries(specs)) {
    const v = percentileRank(row[field], trailingValues(rows, idx, field), hi);
    p[k] = fin(v) ? Math.round(v * MAXPTS[k]) : null;
  }
  if (fin(p.dom) && fin(row.btc90) && row.btc90 < 0) p.dom = Math.round(p.dom * clamp01((row.btc90 + 15) / 15));
  if (fin(altPts)) p.alt = Math.round(clamp01(altPts / 100) * MAXPTS.alt);
  else {
    const ap = altProxyPct(row, rows, idx);
    p.alt = fin(ap) ? Math.round(ap * MAXPTS.alt) : null;
  }
  return p;
}
__name(dynamicScore, "dynamicScore");
function totalOf(p, keys = SCORE_KEYS, needAll = false) {
  let s = 0, m = 0;
  for (const k of keys) {
    if (p[k] == null) {
      if (needAll) return null;
      continue;
    }
    s += p[k];
    m += MAXPTS[k];
  }
  return m ? { score: Math.round(s / m * 100), cover: m } : null;
}
__name(totalOf, "totalOf");
function quantile(a, q) {
  const v = a.filter(fin).sort((x, y) => x - y);
  if (!v.length) return null;
  const p = (v.length - 1) * q, i = Math.floor(p), f = p - i;
  return i + 1 < v.length ? v[i] + (v[i + 1] - v[i]) * f : v[i];
}
__name(quantile, "quantile");
function calibrateBands(rows) {
  const scores = rows.filter((r) => !r.live && fin(r.s)).map((r) => r.s);
  return { watch: Math.round(quantile(scores, 0.6) || 40), expansion: Math.round(quantile(scores, 0.78) || 55), broad: Math.round(quantile(scores, 0.9) || 70), distribution: { p50: Math.round(quantile(scores, 0.5) || 50), p75: Math.round(quantile(scores, 0.75) || 60), p90: Math.round(quantile(scores, 0.9) || 70), n: scores.length } };
}
__name(calibrateBands, "calibrateBands");
function stageOf(s, b) {
  if (!fin(s) || !b) return null;
  if (s >= b.broad) return { key: "broad", label: "\uAD11\uBC94\uC704 \uC54C\uD2B8 \uAC15\uC138 \uC601\uC5ED", emoji: "\u{1F534}" };
  if (s >= b.expansion) return { key: "expansion", label: "\uCD08\uAE30 \uC54C\uD2B8 \uD655\uC0B0 \uC601\uC5ED", emoji: "\u{1F7E0}" };
  if (s >= b.watch) return { key: "watch", label: "\uC54C\uD2B8 \uC21C\uD658\uB9E4 \uAC10\uC9C0 \uC601\uC5ED", emoji: "\u{1F7E1}" };
  return { key: "btc", label: "BTC \uC911\uC2EC \uC601\uC5ED", emoji: "\u{1F7E2}" };
}
__name(stageOf, "stageOf");
var ALT_WINDOWS = [
  { id: "2017", label: "2017 ICO \uC54C\uD2B8\uC7A5", from: "2017-03", to: "2018-01" },
  { id: "2021", label: "2020~21 \uC54C\uD2B8\uC2DC\uC98C", from: "2020-10", to: "2021-05" },
  { id: "2024", label: "2024 \uC21C\uD658\uB9E4(\uC57D)", from: "2024-11", to: "2025-01" }
];
var BTCD_ANCHORS = [[2013, 93.3], [2014, 88.5], [2015, 86.3], [2016, 82.6], [2017, 58.5], [2018, 44.6], [2019, 60.2], [2020, 62.7], [2021, 47.6], [2022, 39.3], [2023, 45.6], [2024, 51.9], [2025, 59.3]].map(([y, v]) => ({ t: Date.UTC(y, 6, 1), v }));
var inWindow = /* @__PURE__ */ __name((k) => ALT_WINDOWS.find((w) => k >= w.from && k <= w.to) || null, "inWindow");
function compose(hist, live) {
  const src = { ...hist?.sources || {}, ...live?.sources || {} };
  if (!hist || !hist.ok) return { ok: false, error: hist?.error || "HISTORY_UNAVAILABLE", sources: src };
  const rows = hist.rows.map((r) => ({ ...r })), cur = rows[rows.length - 1];
  const liveDom = live?.dom?.value;
  const cmc = hist.cmcDom ? hist.cmcDom.map(([t, v]) => ({ t, v })) : null;
  const anchors = BTCD_ANCHORS.slice();
  if (fin(liveDom)) anchors.push({ t: cur.t, v: liveDom });
  const anchorAt = /* @__PURE__ */ __name((t) => {
    if (t < anchors[0].t) return null;
    if (t >= anchors[anchors.length - 1].t) return anchors[anchors.length - 1].v;
    const i = bsearchLE(anchors, t), a = anchors[i], b = anchors[i + 1];
    return a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
  }, "anchorAt");
  const domAt = /* @__PURE__ */ __name((t) => {
    if (cmc && t >= cmc[0].t - 7 * DAY) {
      const v2 = valAt(cmc, t, 14 * DAY);
      if (fin(v2)) return { v: v2, src: "cmc" };
    }
    const v = anchorAt(t);
    return fin(v) ? { v, src: "anchor" } : { v: null, src: null };
  }, "domAt");
  for (const r of rows) {
    const a = domAt(r.t), b = domAt(r.t - 90 * DAY);
    r.dom = a.v;
    r.domSrc = a.src;
    r.dom90 = fin(a.v) && fin(b.v) ? r3(a.v - b.v, 2) : null;
    if (r.live) {
      if (fin(liveDom)) {
        r.dom = liveDom;
        r.domSrc = "coingecko";
        if (fin(live?.dom?.m3)) r.dom90 = r3(liveDom - live.dom.m3, 2);
      }
      if (fin(live?.ethbtc?.ch90)) {
        r.eth90 = live.ethbtc.ch90;
        r.ethbtc = live.ethbtc.now ?? r.ethbtc;
      }
    }
    const p = dynamicScore(r, rows, rows.indexOf(r));
    const full = totalOf(p, SCORE_KEYS, true);
    const macro = totalOf(p, ["m2", "accel", "dollar", "fed", "btc"], true);
    r.s = full ? full.score : null;
    r.mo = macro ? macro.score : null;
    r._p = p;
  }
  const br = live?.breadth || {};
  const altBreadthScore = fin(br.breadthBlend) ? clamp01(br.breadthBlend / 100) * 100 : null;
  const altVolumeScore = fin(br.volRatio) ? clamp01((Math.log(Math.max(br.volRatio, 0.01)) + 0.35) / (Math.log(1.75) + 0.35)) * 100 : null;
  const altScore = fin(altBreadthScore) && fin(altVolumeScore) ? altBreadthScore * 0.75 + altVolumeScore * 0.25 : altBreadthScore;
  const pNow = dynamicScore({ ...cur }, rows, rows.length - 1, altScore);
  const tot = totalOf(pNow, SCORE_KEYS, false), comparable = cur.s;
  const total = tot ? tot.score : null;
  const bands = calibrateBands(rows);
  const stage = total != null ? stageOf(total, bands) : null;
  const LABEL = { m2: "Global M2 \uC99D\uAC00", accel: "\uC720\uB3D9\uC131 \uAC00\uC18D", dollar: "\uB2EC\uB7EC \uC57D\uC138", fed: "Fed \uC644\uD654", btc: "BTC \uC0C1\uC2B9 \uCD94\uC138", dom: "BTC.D \uD558\uB77D(\uD488\uC9C8\uBCF4\uC815)", eth: "ETH/BTC \uC0C1\uC2B9", alt: "\uC2E4\uC81C \uC54C\uD2B8 \uD655\uC0B0" };
  const fm = /* @__PURE__ */ __name((v, u = "%", d = 1) => fin(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(d)}${u}` : "\u2014", "fm");
  const DETAIL = { m2: `YoY ${fm(cur.m2yoy)}`, accel: `6\uAC1C\uC6D4 \uC804 \uB300\uBE44 ${fm(cur.m2accel, "%p")}`, dollar: `3\uAC1C\uC6D4 ${fm(cur.dollar3m)}`, fed: `12\uAC1C\uC6D4 ${fm(cur.fed12, "%p", 2)} \xB7 \uD604\uC7AC ${fin(cur.fedLvl) ? cur.fedLvl.toFixed(2) + "%" : "\u2014"}`, btc: `90\uC77C ${fm(cur.btc90)}`, dom: `90\uC77C ${fm(cur.dom90, "%p")}${cur.btc90 < 0 && fin(cur.dom90) && cur.dom90 < 0 ? " \xB7 BTC \uD558\uB77D \uB3D9\uBC18\u2192\uAC10\uC561" : ""}`, eth: `90\uC77C ${fm(cur.eth90)}`, alt: fin(br.breadthBlend) ? `7/30/90\uC77C \uD63C\uD569 ${br.breadthBlend}% \xB7 90\uC77C ${fin(br.pctBeat90) ? br.pctBeat90 : "\u2014"}% \xB7 \uAC70\uB798\uB300\uAE08 x${fin(br.volRatio) ? br.volRatio : "\u2014"}` : "\uB370\uC774\uD130 \uC5C6\uC74C" };
  const comps = SCORE_KEYS.map((k) => ({ key: k, label: LABEL[k], pts: pNow[k], max: MAXPTS[k], detail: DETAIL[k] }));
  const drivers = { up: comps.filter((c) => c.pts != null && c.pts / c.max >= 0.7).map((c) => c.label), down: comps.filter((c) => c.pts != null && c.pts / c.max <= 0.3).map((c) => c.label) };
  const seq = rows.filter((r) => r.s != null).map((r) => ({ k: r.k, s: r.s }));
  const path = seq.slice(-6);
  const streak = /* @__PURE__ */ __name((th) => {
    let n = 0;
    for (let i = seq.length - 1; i >= 0 && seq[i].s >= th; i--) n++;
    return n;
  }, "streak");
  const ago = /* @__PURE__ */ __name((n) => seq.length > n ? seq[seq.length - 1 - n].s : null, "ago");
  const done = rows.filter((r) => !r.live && r.s != null);
  const outside = done.filter((r) => !ALT_WINDOWS.some((w) => k2(r.k, w)));
  function k2(k, w) {
    return monthsBetween(w.from, k) >= -2 && monthsBetween(k, w.to) >= -2;
  }
  __name(k2, "k2");
  const inRows = done.filter((r) => inWindow(r.k));
  const calibration = [bands.watch, bands.expansion, bands.broad].map((T) => {
    const hit = inRows.length ? inRows.filter((r) => r.s >= T).length / inRows.length * 100 : null;
    const fa = outside.length ? outside.filter((r) => r.s >= T).length / outside.length * 100 : null;
    const leads = ALT_WINDOWS.map((w) => {
      const c = done.find((r) => monthsBetween(w.from, r.k) >= -8 && monthsBetween(r.k, w.to) >= 0 && r.s >= T);
      return { id: w.id, firstCross: c ? c.k : null, leadMonths: c ? monthsBetween(c.k, w.from) : null };
    });
    return { threshold: T, hitRate: r3(hit, 0), falseAlarmRate: r3(fa, 0), leads };
  });
  const windows = ALT_WINDOWS.map((w) => {
    const a = done.filter((r) => r.k >= w.from && r.k <= w.to);
    const pk = a.reduce((m, r) => !m || r.s > m.s ? r : m, null);
    const st = done.find((r) => r.k === w.from);
    return { ...w, startScore: st?.s ?? null, peakScore: pk?.s ?? null, peakMonth: pk?.k ?? null, months: a.length };
  });
  const KEYS = ["m2yoy", "fed12", "dollar3m", "btc90", "eth90", "dom90"];
  const cand = rows.slice(0, -5).filter((r) => KEYS.every((k) => fin(r[k])));
  let analogs = [];
  if (KEYS.every((k) => fin(cur[k])) && cand.length > 24) {
    const mu = {}, sd = {};
    for (const k of KEYS) {
      const v = cand.map((r) => r[k]);
      mu[k] = v.reduce((s, x) => s + x, 0) / v.length;
      sd[k] = Math.sqrt(v.reduce((s, x) => s + (x - mu[k]) ** 2, 0) / v.length) || 1;
    }
    const dist = /* @__PURE__ */ __name((r) => Math.sqrt(KEYS.reduce((s, k) => s + ((r[k] - cur[k]) / sd[k]) ** 2, 0)), "dist");
    const sorted = cand.map((r) => ({ r, d: dist(r) })).sort((a, b) => a.d - b.d), pick = [];
    for (const x of sorted) {
      if (pick.every((p) => Math.abs(monthsBetween(p.r.k, x.r.k)) >= 4)) pick.push(x);
      if (pick.length >= 3) break;
    }
    const dmax = sorted[sorted.length - 1].d || 1, idx = new Map(rows.map((r, i) => [r.k, i]));
    analogs = pick.map(({ r, d }) => {
      const f = rows[idx.get(r.k) + 6];
      const w = inWindow(r.k);
      return { month: r.k, similarity: Math.round(100 * (1 - d / dmax)), score: r.s, phase: w ? w.label : "\uC54C\uD2B8 \uAC15\uC138 \uAD6C\uAC04 \uBC16", fwdEthBtc6m: f && fin(f.ethbtc) && fin(r.ethbtc) ? r3(pctOf(f.ethbtc, r.ethbtc), 1) : null, fwdBtc6m: f && fin(f.btc) && fin(r.btc) ? r3(pctOf(f.btc, r.btc), 1) : null };
    });
  }
  let rotation = null;
  const rel = fin(cur.btc90) && fin(cur.sp90) ? cur.btc90 - cur.sp90 : null;
  if (rel != null || fin(cur.stable90) || fin(br.volRatio)) {
    const a = rel == null ? 0 : rel > 20 ? 35 : rel > 0 ? 25 : rel > -10 ? 10 : 0, b = !fin(cur.stable90) ? 0 : cur.stable90 >= 8 ? 35 : cur.stable90 >= 4 ? 25 : cur.stable90 >= 1 ? 15 : cur.stable90 > 0 ? 8 : 0, c = !fin(br.volRatio) ? 0 : br.volRatio >= 1.5 ? 30 : br.volRatio >= 1.15 ? 20 : br.volRatio >= 0.9 ? 10 : 0;
    rotation = { score: a + b + c, parts: { btcVsSp: r3(rel, 1), stable90: cur.stable90, altVolume: br.volRatio ?? null } };
  }
  const L = hist.levels || {};
  return {
    ok: true,
    version: "altseason-v5-us-eu-jp-uk",
    updatedAt: Date.now(),
    cache: { hist: hist.cache, live: live?.cache },
    staleReason: hist.staleReason || live?.staleReason,
    score: { total, comparable, stage, coverage: tot ? tot.cover : null, components: comps, drivers, path, momentum: { m1: ago(1) != null && comparable != null ? comparable - ago(1) : null, m3: ago(3) != null && comparable != null ? comparable - ago(3) : null }, streak: { overWatch: streak(bands.watch), overExpansion: streak(bands.expansion), overBroad: streak(bands.broad) }, bands, methodology: "rolling-60m-percentile" },
    inputs: { m2: { value: L.m2, key: L.m2Key, yoy: cur.m2yoy, accel: cur.m2accel, used: hist.m2.used, rejected: hist.m2.rejected, extended: { value: L.m2Extended, key: L.m2ExtendedKey, yoy: hist.m2.extended?.yoy ?? null, used: hist.m2.extended?.used || [], rejected: hist.m2.extended?.rejected || [] } }, fed: { value: L.fed, chg12: cur.fed12 }, dollar: { value: L.dollar, chg3m: cur.dollar3m }, oil: { value: L.oil, chg3m: cur.oil3m }, us10y: { value: cur.us10y, chg3m: cur.us10y3m }, sp: { value: L.sp, chg3m: cur.sp90 }, btc: { usd: cur.btc, ret90: cur.btc90, vsSp: r3(rel, 1) }, dom: { value: fin(liveDom) ? liveDom : cur.dom, src: fin(liveDom) ? "coingecko" : cur.domSrc, d7: live?.dom?.d7 != null && fin(liveDom) ? r3(liveDom - live.dom.d7, 2) : null, d30: live?.dom?.m1 != null && fin(liveDom) ? r3(liveDom - live.dom.m1, 2) : null, d90: cur.dom90 }, ethbtc: { value: cur.ethbtc, ch30: live?.ethbtc?.ch30 ?? null, ch90: cur.eth90 }, stable: { value: L.stable, g90: cur.stable90 } },
    breadth: live ? { ...live.breadth, coins: live.coins, groups: live.groups, reach: live.reach } : null,
    rotation,
    analogs,
    confirmation: {
      score: total,
      bands,
      breadth90: br.pctBeat90 ?? null,
      breadthBlend: br.breadthBlend ?? null,
      eth90: cur.eth90 ?? null,
      dom90: cur.dom90 ?? null,
      volumeRatio: br.volRatio ?? null,
      broadScore: total != null && total >= bands.broad,
      breadthConfirmed: fin(br.pctBeat90) && br.pctBeat90 >= 75,
      rotationConfirmed: fin(cur.eth90) && cur.eth90 > 0 && fin(cur.dom90) && cur.dom90 < 0,
      broadConfirmed: total != null && total >= bands.broad && fin(br.pctBeat90) && br.pctBeat90 >= 75 && fin(cur.eth90) && cur.eth90 > 0 && fin(cur.dom90) && cur.dom90 < 0
    },
    history: { months: rows.map((r) => ({ k: r.k, s: r.s, mo: r.mo, m2: r.m2yoy, d: fin(r.dom) ? r3(r.dom, 1) : null, ds: r.domSrc, e: r.ethbtc, b: r.btc90 })), windows: ALT_WINDOWS, windowStats: windows, calibration },
    sources: src,
    notes: { globalM2Profiles: "GLOBAL M2=US Federal Reserve H.6 + Euro Area + Japan. \uC601\uAD6D\xB7\uC911\uAD6D\xB7\uD55C\uAD6D\xB7\uCE90\uB098\uB2E4\xB7\uC2A4\uC704\uC2A4\uB294 \uC0AC\uC6A9\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.", domApprox: !hist.cmcDom, m2Lag: "M2\uB294 \uBC1C\uD45C \uC9C0\uC5F0\uC744 \uBC18\uC601\uD574 1\uAC1C\uC6D4 \uC804 \uACF5\uAC1C\uBD84\uC744 \uC0AC\uC6A9", scoring: "\uAC01 \uC810\uC218\uB294 \uC9C1\uC804 60\uAC1C\uC6D4 \uBD84\uD3EC\uC758 percentile\uB85C \uC0B0\uCD9C\uD558\uBA70, \uD604\uC7AC breadth\uB294 7/30/90\uC77C \uD63C\uD569\uC744 \uC0AC\uC6A9", historicalAltProxy: "\uACFC\uAC70 \uC54C\uD2B8\uD655\uC0B0 15\uC810\uC740 BTC.D\xB7ETH/BTC\xB7\uC2A4\uD14C\uC774\uBE14\uCF54\uC778 \uC99D\uAC00\uC728\uC758 \uD68C\uC804 proxy\uB85C \uB300\uCCB4" }
  };
}
__name(compose, "compose");
var CP_DAY = 864e5;
var CP_GENESIS = Date.UTC(2009, 0, 3);
var CP_HALVINGS = [Date.UTC(2012, 10, 28), Date.UTC(2016, 6, 9), Date.UTC(2020, 4, 11), Date.UTC(2024, 3, 20)];
function cpQuantileFit(points, q) {
  const n = points.length, buf = new Float64Array(n), srt = new Float64Array(n);
  const evalB = /* @__PURE__ */ __name((b) => {
    for (let i = 0; i < n; i++) {
      const v = points[i].y - b * points[i].x;
      buf[i] = v;
      srt[i] = v;
    }
    srt.sort();
    const p = (n - 1) * q, lo = Math.floor(p), hi = Math.ceil(p), a = srt[lo] + (srt[hi] - srt[lo]) * (p - lo);
    let loss = 0;
    for (let i = 0; i < n; i++) {
      const e = buf[i] - a;
      loss += e >= 0 ? q * e : (q - 1) * e;
    }
    return { b, a, loss };
  }, "evalB");
  let best = null;
  for (let k = 0; k <= 80; k++) {
    const r = evalB(3.5 + k * 0.05);
    if (!best || r.loss < best.loss) best = r;
  }
  const c = best.b;
  for (let b = Math.max(3.5, c - 0.05); b <= Math.min(7.5, c + 0.0501); b += 5e-3) {
    const r = evalB(b);
    if (r.loss < best.loss) best = r;
  }
  return { slope: best.b, intercept: best.a };
}
__name(cpQuantileFit, "cpQuantileFit");
function cpTimeAvg(series, windowDays, minPts) {
  const end = series.at(-1).t, start = end - windowDays * CP_DAY;
  const sub = series.filter((p) => p.t >= start);
  if (sub.length < minPts || series[0].t > start + 20 * CP_DAY) return null;
  for (let i = 1; i < sub.length; i++) if (sub[i].t - sub[i - 1].t > 10 * CP_DAY) return null;
  if (end - sub.at(-1).t > 10 * CP_DAY) return null;
  let sw = 0, sv = 0;
  for (let i = 0; i < sub.length; i++) {
    const t0 = i === 0 ? Math.max(start, sub[0].t) : sub[i - 1].t, t1 = sub[i].t, w = Math.max(1, (t1 - t0) / CP_DAY);
    sw += w;
    sv += w * sub[i].v;
  }
  return sv / sw;
}
__name(cpTimeAvg, "cpTimeAvg");
function cpMonthly(daily, nowMs) {
  const m = /* @__PURE__ */ new Map();
  for (const p of daily) {
    const d = new Date(p.t), k = d.getUTCFullYear() * 12 + d.getUTCMonth();
    m.set(k, p);
  }
  const nowK = new Date(nowMs).getUTCFullYear() * 12 + new Date(nowMs).getUTCMonth();
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, p]) => ({ k, t: p.t, close: p.v, partial: k >= nowK }));
}
__name(cpMonthly, "cpMonthly");
function cpClamp01(x) {
  return Math.max(0, Math.min(1, x));
}
__name(cpClamp01, "cpClamp01");
function cpAtOrBefore(series, targetMs, maxAgeDays = 14) {
  let lo = 0, hi = series.length - 1, found = -1;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    if (series[mid].t <= targetMs) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0 || targetMs - series[found].t > maxAgeDays * CP_DAY) return null;
  return series[found];
}
__name(cpAtOrBefore, "cpAtOrBefore");
function buildCompassModel(daily, meta = {}) {
  const nowMs = meta.asOf ?? Date.now();
  const all = (daily || []).filter((p) => Number.isFinite(p.t) && p.v > 0).sort((a, b) => a.t - b.t);
  const s = all.filter((p) => p.t >= Date.UTC(2011, 0, 1));
  const months = cpMonthly(s, nowMs);
  const completedMonths = months.filter((m) => !m.partial);
  if (completedMonths.length < 60) return { ok: false, error: "INSUFFICIENT_HISTORY", count: completedMonths.length };
  const live = s.at(-1);
  const latestAgeDays = Math.max(0, (nowMs - live.t) / CP_DAY);
  if (latestAgeDays > 14) return { ok: false, error: "STALE_BTC_DATA", latestAgeDays: +latestAgeDays.toFixed(1), count: completedMonths.length };
  const points = completedMonths.map((m) => ({ x: Math.log10(Math.max(1, (m.t - CP_GENESIS) / CP_DAY)), y: Math.log10(m.close) }));
  const f05 = cpQuantileFit(points, 0.05), f50 = cpQuantileFit(points, 0.5), f95 = cpQuantileFit(points, 0.95);
  const xNow = Math.log10(Math.max(1, (live.t - CP_GENESIS) / CP_DAY)), yNow = Math.log10(live.v);
  const at = /* @__PURE__ */ __name((f, x) => Math.pow(10, f.intercept + f.slope * x), "at");
  const sup = at(f05, xNow), mid = at(f50, xNow), top = at(f95, xNow), price = live.v;
  const bandPos = cpClamp01((yNow - (f05.intercept + f05.slope * xNow)) / (f95.intercept + f95.slope * xNow - (f05.intercept + f05.slope * xNow))) * 100;
  const medPos = yNow - (f50.intercept + f50.slope * xNow);
  const resid = points.map((p) => p.y - (f50.intercept + f50.slope * p.x)), rTail = resid.slice(-36);
  const rAvg = rTail.reduce((a, b) => a + b, 0) / rTail.length, rSd = Math.sqrt(rTail.reduce((a, b) => a + (b - rAvg) ** 2, 0) / Math.max(1, rTail.length - 1));
  const volAdj = rSd > 0 ? medPos / rSd : null;
  const lr = [];
  for (let i = 1; i < months.length; i++) lr.push(Math.log(months[i].close / months[i - 1].close));
  const sdv = /* @__PURE__ */ __name((a) => {
    if (a.length < 6) return null;
    const m = a.reduce((x, y) => x + y, 0) / a.length;
    return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) * Math.sqrt(12) * 100;
  }, "sdv");
  const volNow = sdv(lr.slice(-24)), volAll = sdv(lr), volEarly = sdv(lr.slice(0, 48));
  const dSup = Math.pow(10, (yNow - f05.intercept) / f05.slope), yrsAhead = (dSup - Math.pow(10, xNow)) / 365.25;
  const C = completedMonths;
  const zBase = C.slice(-48).map((m) => Math.log(m.close));
  const avg = zBase.length === 48 ? zBase.reduce((a, b) => a + b, 0) / zBase.length : null;
  const sd = avg == null ? null : Math.sqrt(zBase.reduce((a, b) => a + (b - avg) ** 2, 0) / (zBase.length - 1));
  const z = sd > 0 ? (Math.log(price) - avg) / sd : null;
  const recentSamples = s.slice(-180);
  const dailySeries = recentSamples.length >= 30 && recentSamples.slice(1).every((p, i) => p.t - recentSamples[i].t <= 10 * CP_DAY);
  const p4y = dailySeries ? cpAtOrBefore(s, live.t - 1461 * CP_DAY, 14) : null;
  const p90 = dailySeries ? cpAtOrBefore(s, live.t - 90 * CP_DAY, 14) : null;
  const cagrBase = p4y?.v ?? (C.length >= 48 ? C[C.length - 48].close : null);
  const ret3Base = p90?.v ?? (C.length >= 3 ? C[C.length - 3].close : null);
  const cagr = cagrBase > 0 ? (Math.pow(price / cagrBase, 365.25 / 1461) - 1) * 100 : null;
  const cagrMethod = p4y ? "daily-nearest-1461d" : cagrBase ? "monthly-approx-48m" : null;
  const ret3 = ret3Base > 0 ? (price / ret3Base - 1) * 100 : null;
  const ret3Method = p90 ? "daily-nearest-90d" : ret3Base ? "monthly-approx-3m" : null;
  const ma10 = C.length >= 10 ? C.slice(-10).reduce((a, m) => a + m.close, 0) / 10 : null;
  const ma10Old = C.length >= 13 ? C.slice(-13, -3).reduce((a, m) => a + m.close, 0) / 10 : null;
  const uptrend = ma10 != null && ma10Old != null && price > ma10 && ma10 > ma10Old && ret3 != null && ret3 > 0;
  const ma200d = cpTimeAvg(s, 200, 20), ma200w = cpTimeAvg(s, 1400, 120);
  const mayer = ma200d ? price / ma200d : null, wmaMult = ma200w ? price / ma200w : null;
  let ath = s[0];
  for (const p of s) if (p.v > ath.v) ath = p;
  const drawdown = (price / ath.v - 1) * 100;
  const cycles = [];
  if (!meta.lite) CP_HALVINGS.forEach((h, i) => {
    const endT = Math.min(CP_HALVINGS[i + 1] ?? nowMs, h + 600 * CP_DAY), win = s.filter((p) => p.t >= h && p.t < endT);
    if (win.length < 30) return;
    let pk = win[0];
    for (const p of win) if (p.v > pk.v) pk = p;
    const after = s.filter((p) => p.t >= pk.t && p.t <= pk.t + 560 * CP_DAY);
    let bt = after[0];
    for (const p of after) if (p.v < bt.v) bt = p;
    const done = i < CP_HALVINGS.length - 1;
    cycles.push({
      halving: new Date(h).toISOString().slice(0, 10),
      peakDate: new Date(pk.t).toISOString().slice(0, 10),
      peak: Math.round(pk.v),
      daysToPeak: Math.round((pk.t - h) / CP_DAY),
      troughDate: done ? new Date(bt.t).toISOString().slice(0, 10) : null,
      daysPeakToTrough: done ? Math.round((bt.t - pk.t) / CP_DAY) : null,
      peakToTroughPct: done ? +((bt.v / pk.v - 1) * 100).toFixed(1) : null,
      current: !done,
      daysSincePeak: !done ? Math.round((live.t - pk.t) / CP_DAY) : null,
      drawdownFromPeakPct: !done ? +((price / pk.v - 1) * 100).toFixed(1) : null
    });
  });
  const lastH = CP_HALVINGS.filter((h) => h <= nowMs).at(-1), daysSinceHalving = Math.round((nowMs - lastH) / CP_DAY);
  const comps = [
    { key: "band", label: "\uC7A5\uAE30 \uBC34\uB4DC \uC704\uCE58", v: bandPos, w: 0.25 },
    { key: "z", label: "4\uB144 Z-score", v: z == null ? null : cpClamp01((z + 1) / 3.5) * 100, w: 0.2 },
    { key: "mayer", label: "Mayer Multiple", v: mayer == null ? null : cpClamp01((mayer - 0.8) / 1.6) * 100, w: 0.2 },
    { key: "wma", label: "200\uC8FC\uC120 \uBC30\uC218", v: wmaMult == null ? null : cpClamp01((wmaMult - 0.7) / 2.3) * 100, w: 0.15 },
    { key: "vol", label: "\uBCC0\uB3D9\uC131 \uBCF4\uC815 \uC9C0\uC218", v: volAdj == null ? null : cpClamp01((volAdj + 1.5) / 4) * 100, w: 0.2 }
  ];
  const ok = comps.filter((c) => Number.isFinite(c.v));
  const heatCoverage = ok.length;
  const heatScore = heatCoverage >= 4 ? ok.reduce((a, c) => a + c.v * c.w, 0) / ok.reduce((a, c) => a + c.w, 0) : null;
  const recentGapSeries = s.filter((p) => p.t >= live.t - 1830 * CP_DAY), gaps = [];
  for (let i = 1; i < recentGapSeries.length; i++) gaps.push((recentGapSeries[i].t - recentGapSeries[i - 1].t) / CP_DAY);
  const maxGapDays = gaps.length ? gaps.reduce((m, x) => Math.max(m, x), 0) : null;
  const fitBoundary = [f05, f50, f95].some((f) => f.slope <= 3.502 || f.slope >= 7.498);
  const signalEligible = latestAgeDays <= 3 && points.length >= 60 && heatCoverage >= 4 && maxGapDays != null && maxGapDays <= 10 && !fitBoundary;
  const quality = {
    status: signalEligible ? "good" : latestAgeDays > 3 ? "stale" : heatCoverage < 4 ? "limited-indicators" : fitBoundary ? "fit-boundary" : "limited-history-spacing",
    signalEligible,
    latestAgeDays: +latestAgeDays.toFixed(1),
    completeMonths: completedMonths.length,
    sampleCount: s.length,
    maxGapDays: maxGapDays == null ? null : +maxGapDays.toFixed(1),
    sampling: dailySeries ? "daily-like" : "sparse/monthly",
    heatCoverage,
    heatRequired: 4,
    fitBoundary,
    cagrMethod,
    return3mMethod: ret3Method
  };
  let valuation = "\uC911\uB9BD \uAD6C\uAC04", valuationKey = "neutral";
  if (price <= sup) {
    valuation = "\uC11C\uD3EC\uD2B8 \uC774\uD0C8\xB7\uADF9\uB2E8 \uC800\uD3C9\uAC00";
    valuationKey = "discount";
  } else if (bandPos <= 20) {
    valuation = "\uC7A5\uAE30 \uC800\uD3C9\uAC00 \uAD6C\uAC04";
    valuationKey = "discount";
  } else if (bandPos >= 90) {
    valuation = "\uC7A5\uAE30 \uACE0\uD3C9\uAC00 \uAD6C\uAC04";
    valuationKey = "overvalued";
  } else if (medPos < 0) {
    valuation = "\uC911\uC559\uC120 \uC544\uB798(\uC0C1\uB300\uC801 \uC800\uD3C9\uAC00)";
    valuationKey = "below";
  } else {
    valuation = "\uC911\uC559\uC120 \uC704(\uC0C1\uB300\uC801 \uACE0\uD3C9\uAC00)";
    valuationKey = "above";
  }
  let trend = "\uC0C1\uC2B9\uC7A5 \uC804\uD658 \uBBF8\uD655\uC778", trendKey = "unconfirmed";
  if (uptrend) {
    trend = "\uC0C1\uC2B9 \uCD94\uC138 \uD655\uC778";
    trendKey = "confirmed";
  } else if (ma10 && price > ma10) {
    trend = "\uCD08\uAE30 \uD68C\uBCF5 \uC2DC\uB3C4";
    trendKey = "recovering";
  }
  let heat = "\uACFC\uC5F4 \uC2E0\uD638 \uC81C\uD55C\uC801", heatKey = "calm";
  if (heatScore != null && heatScore >= 60) {
    heat = "\uACFC\uC5F4 \uACBD\uACC4";
    heatKey = "caution";
  }
  if (heatScore != null && heatScore >= 80) {
    heat = "\uAC15\uD55C \uACFC\uC5F4 \uAD6C\uAC04";
    heatKey = "hot";
  }
  const step = Math.max(1, Math.floor(months.length / 140));
  const history = meta.lite ? [] : months.filter((m, i) => i % step === 0 || i === months.length - 1).map((m) => {
    const x = Math.log10(Math.max(1, (m.t - CP_GENESIS) / CP_DAY));
    return { t: m.t, price: m.close, model: at(f50, x), lower: at(f05, x), upper: at(f95, x) };
  });
  return {
    ok: true,
    version: "10.13.1",
    source: meta.source || "blockchain.info BTC/USD",
    count: months.length,
    firstMonth: new Date(completedMonths[0].t).toISOString().slice(0, 7),
    lastMonth: new Date(live.t).toISOString().slice(0, 7),
    lastPointAt: live.t,
    updatedAt: nowMs,
    quality,
    current: {
      price,
      model: mid,
      lower: sup,
      median: mid,
      upper: top,
      residualPct: (Math.pow(10, medPos) - 1) * 100,
      bandPosition: bandPos,
      zScore: z,
      cagr4y: cagr,
      cagrMethod,
      return3m: ret3,
      return3mMethod: ret3Method,
      yearsAheadOfSupport: yrsAhead,
      mayer,
      ma200w,
      wmaMultiple: wmaMult,
      athPrice: Math.round(ath.v),
      athDate: new Date(ath.t).toISOString().slice(0, 10),
      drawdownPct: drawdown,
      volAdjIndex: volAdj,
      volAnnualPct: volNow,
      volAnnualPctAll: volAll,
      volAnnualPctEarly: volEarly,
      heatScore,
      heatParts: comps.map((c) => ({ key: c.key, label: c.label, score: Number.isFinite(c.v) ? Math.round(c.v) : null }))
    },
    cycle: { daysSinceHalving, lastHalving: new Date(lastH).toISOString().slice(0, 10), cycles },
    valuation: { label: valuation, key: valuationKey },
    trend: { label: trend, key: trendKey },
    heat: { label: heat, key: heatKey },
    fit: {
      support: { slope: f05.slope, intercept: f05.intercept },
      median: { slope: f50.slope, intercept: f50.intercept },
      upper: { slope: f95.slope, intercept: f95.intercept },
      method: "quantile regression: log10(price)=a+b\xB7log10(days since 2009-01-03), q=5/50/95%, \uC644\uB8CC\uB41C \uC6D4\uB9D0 \uC885\uAC00\uB9CC \uC801\uD569; \uC9C4\uD589 \uC911\uC778 \uB2EC\uC740 \uD3C9\uAC00\uC5D0\uB9CC \uC0AC\uC6A9",
      slopeBoundary: fitBoundary
    },
    history
  };
}
__name(buildCompassModel, "buildCompassModel");
function cpFromBinanceMonthly(rows) {
  const now = Date.now();
  return (rows || []).map((x) => {
    const open = Number(x[0]), d = new Date(open);
    if (!Number.isFinite(open)) return null;
    const sameMonth = d.getUTCFullYear() === new Date(now).getUTCFullYear() && d.getUTCMonth() === new Date(now).getUTCMonth();
    const t = sameMonth ? now : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999);
    return { t, v: Number(x[4]) };
  }).filter((p) => p && Number.isFinite(p.t) && p.v > 0).sort((a, b) => a.t - b.t);
}
__name(cpFromBinanceMonthly, "cpFromBinanceMonthly");
var CP_BUCKETS = [
  { key: "cold", label: "0~30 (\uB0AE\uC74C)", lo: -Infinity, hi: 30 },
  { key: "mild", label: "30~45", lo: 30, hi: 45 },
  { key: "mid", label: "45~60", lo: 45, hi: 60 },
  { key: "warm", label: "60~80 (\uACBD\uACC4)", lo: 60, hi: 80 },
  { key: "hot", label: "80+ (\uACFC\uC5F4)", lo: 80, hi: Infinity }
];
function cpBucketKey(h) {
  if (h == null || !Number.isFinite(h)) return null;
  for (const b of CP_BUCKETS) if (h >= b.lo && h < b.hi) return b.key;
  return "hot";
}
__name(cpBucketKey, "cpBucketKey");
function cpRanks(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const rk = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = rk;
    i = j + 1;
  }
  return r;
}
__name(cpRanks, "cpRanks");
function cpSpearman(x, y) {
  const n = x.length;
  if (n < 12) return null;
  const rx = cpRanks(x), ry = cpRanks(y), mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
__name(cpSpearman, "cpSpearman");
function cpMedian(a) {
  if (!a.length) return null;
  const b = a.slice().sort((x, y) => x - y), m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
__name(cpMedian, "cpMedian");
function cpFwd(s, i0, T, h, lastT) {
  if (T + h * CP_DAY > lastT) return null;
  const end = cpAtOrBefore(s, T + h * CP_DAY, 14);
  if (!end) return null;
  const entry = s[i0].v;
  let minV = entry;
  for (let i = i0 + 1; i < s.length && s[i].t <= T + h * CP_DAY; i++) if (s[i].v < minV) minV = s[i].v;
  return { ret: (end.v / entry - 1) * 100, mdd: (minV / entry - 1) * 100 };
}
__name(cpFwd, "cpFwd");
function cpRunBacktest(daily) {
  const t0 = Date.now();
  const s = (daily || []).filter((p) => Number.isFinite(p.t) && p.v > 0).sort((a, b) => a.t - b.t).filter((p) => p.t >= Date.UTC(2011, 0, 1));
  if (s.length < 400) return { ok: false, error: "INSUFFICIENT_HISTORY" };
  const lastT = s.at(-1).t, first = new Date(s[0].t);
  const rows = [];
  const H = [90, 180, 365];
  let y = first.getUTCFullYear(), m = first.getUTCMonth() + 1;
  for (; ; ) {
    const T = Date.UTC(y, m + 1, 0, 23, 59, 59, 999);
    if (T > lastT - 1 * CP_DAY) break;
    let lo = 0, hi = s.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      if (s[mid].t <= T) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (idx > 100 && T - s[idx].t <= 7 * CP_DAY) {
      const model = buildCompassModel(s.slice(0, idx + 1), { asOf: T, lite: true });
      if (model.ok && model.current.heatScore != null) {
        const rec = { t: T, price: s[idx].v, heat: model.current.heatScore, trend: model.trend.key, f: {} };
        for (const h of H) rec.f[h] = cpFwd(s, idx, T, h, lastT);
        rows.push(rec);
      }
    }
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
    if (Date.UTC(y, m, 1) > lastT) break;
    if (Date.now() - t0 > 2e4) break;
  }
  if (rows.length < 24) return { ok: false, error: "NOT_ENOUGH_SIGNAL_DATES", dates: rows.length };
  const agg = /* @__PURE__ */ __name((list, h) => {
    const f = list.map((r) => r.f[h]).filter(Boolean);
    if (!f.length) return { n: 0 };
    const rets = f.map((x) => x.ret), mdds = f.map((x) => x.mdd);
    return {
      n: f.length,
      avgRet: +(rets.reduce((a, b) => a + b, 0) / f.length).toFixed(1),
      medRet: +cpMedian(rets).toFixed(1),
      winRate: +(rets.filter((x) => x > 0).length / f.length * 100).toFixed(0),
      avgMdd: +(mdds.reduce((a, b) => a + b, 0) / f.length).toFixed(1),
      worstMdd: +Math.min(...mdds).toFixed(1)
    };
  }, "agg");
  const buckets = CP_BUCKETS.map((b) => {
    const list = rows.filter((r) => r.heat >= b.lo && r.heat < b.hi);
    const o = { key: b.key, label: b.label, dates: list.length };
    for (const h of H) o["h" + h] = agg(list, h);
    return o;
  });
  const all = { key: "all", label: "\uC804\uCCB4 \uD3C9\uADE0(\uAE30\uC900\uC120)", dates: rows.length };
  for (const h of H) all["h" + h] = agg(rows, h);
  const corr = {};
  for (const h of H) {
    const pr = rows.filter((r) => r.f[h]);
    corr["h" + h] = { n: pr.length, spearman: (() => {
      const v = cpSpearman(pr.map((r) => r.heat), pr.map((r) => r.f[h].ret));
      return v == null ? null : +v.toFixed(2);
    })() };
  }
  const lowConf = rows.filter((r) => r.heat < 45 && r.trend === "confirmed"), lowUn = rows.filter((r) => r.heat < 45 && r.trend !== "confirmed");
  const trendSplit = { lowConfirmed: { dates: lowConf.length, h180: agg(lowConf, 180), h365: agg(lowConf, 365) }, lowUnconfirmed: { dates: lowUn.length, h180: agg(lowUn, 180), h365: agg(lowUn, 365) } };
  const bh = {};
  for (const h of H) {
    const f = rows.map((r) => r.f[h]).filter(Boolean);
    bh["h" + h] = f.length;
  }
  return {
    ok: true,
    version: "10.13.1",
    updatedAt: Date.now(),
    ms: Date.now() - t0,
    range: { first: new Date(rows[0].t).toISOString().slice(0, 7), last: new Date(rows.at(-1).t).toISOString().slice(0, 7), dates: rows.length },
    buckets,
    baseline: all,
    correlation: corr,
    trendSplit,
    scoreSeries: rows.filter((r, i) => i % 2 === 0 || i === rows.length - 1).map((r) => ({ t: r.t, price: Math.round(r.price), heat: +r.heat.toFixed(1) })),
    notes: [
      "\uB9E4\uC6D4 \uB9D0 \uC2DC\uC810\uC5D0 \uADF8 \uC2DC\uC810\uAE4C\uC9C0\uC758 \uB370\uC774\uD130\uB9CC\uC73C\uB85C \uBD84\uC704\uD68C\uADC0\uC640 \uC810\uC218\uB97C \uC7AC\uACC4\uC0B0\uD588\uC2B5\uB2C8\uB2E4(\uBBF8\uB798 \uC815\uBCF4 \uBBF8\uC0AC\uC6A9).",
      "\uC6D4\uB9D0 \uD45C\uBCF8\uC758 \uC774\uD6C4 90/180/365\uC77C \uCC3D\uC740 \uC11C\uB85C \uD06C\uAC8C \uACB9\uCCD0 \uB3C5\uB9BD \uD45C\uBCF8\uC774 \uC544\uB2D9\uB2C8\uB2E4. \uC2E4\uD6A8 \uD45C\uBCF8 \uC218\uB294 n\uBCF4\uB2E4 \uD6E8\uC52C \uC801\uC2B5\uB2C8\uB2E4.",
      "BTC\uB294 4\uBC88\uC758 \uC0AC\uC774\uD074\uB9CC \uACAA\uC5C8\uACE0 \uC810\uC218 \uAD6C\uAC04 \uACBD\uACC4(30/45/60/80)\uC640 \uC9C0\uD45C \uB9E4\uD551\uC740 \uC0AC\uB78C\uC774 \uC815\uD55C \uAC12\uC774\uB77C, \uC774 \uACB0\uACFC\uB294 \uBBF8\uB798 \uC131\uACFC\uB97C \uBCF4\uC7A5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
      "\uC218\uC218\uB8CC\xB7\uC138\uAE08\xB7\uC2AC\uB9AC\uD53C\uC9C0\uB294 \uBC18\uC601\uD558\uC9C0 \uC54A\uC558\uACE0, \uB9E4\uC218 \uC2DC\uC810 \uAC00\uACA9 = \uD574\uB2F9 \uC6D4 \uB9D0 \uAC00\uACA9\uC73C\uB85C \uAC00\uC815\uD588\uC2B5\uB2C8\uB2E4."
    ]
  };
}
__name(cpRunBacktest, "cpRunBacktest");
async function cpUpdateSignal(env, rawKey, eligible) {
  const need = 3, key = "btc:compass:signal-state:v1", today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (!env || !env.SCALPER_KV) return { persistent: false, raw: rawKey, confirmed: rawKey, required: need, note: "KV \uBBF8\uC5F0\uACB0: \uD655\uC815 \uB300\uAE30 \uC5C6\uC774 \uC6D0\uC2DC \uAD6C\uAC04\uC744 \uC0AC\uC6A9" };
  let st = null;
  try {
    st = await env.SCALPER_KV.get(key, "json");
  } catch {
  }
  if (!eligible || !rawKey) return { persistent: true, raw: rawKey, confirmed: st?.confirmed ?? null, pending: st?.pending ?? null, required: need, note: "\uB370\uC774\uD130 \uD488\uC9C8 \uBBF8\uB2EC: \uC0C1\uD0DC\uB97C \uAC31\uC2E0\uD558\uC9C0 \uC54A\uC74C" };
  if (!st || !st.confirmed) st = { confirmed: rawKey, pending: null, lastDate: today, since: today };
  else if (st.lastDate !== today) {
    st.lastDate = today;
    if (rawKey === st.confirmed) st.pending = null;
    else if (st.pending && st.pending.key === rawKey) {
      st.pending.count += 1;
      if (st.pending.count >= need) {
        st.confirmed = rawKey;
        st.pending = null;
        st.since = today;
      }
    } else st.pending = { key: rawKey, count: 1 };
  } else if (rawKey === st.confirmed) st.pending = null;
  try {
    await env.SCALPER_KV.put(key, JSON.stringify(st));
  } catch {
  }
  return { persistent: true, raw: rawKey, confirmed: st.confirmed, pending: st.pending, since: st.since, required: need };
}
__name(cpUpdateSignal, "cpUpdateSignal");
async function yahooDaily(symbol, range = "6mo") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&events=div%2Csplits`;
  const r = await fetchJson(url, 1e4, {
    "Accept": "application/json,text/plain,*/*",
    "User-Agent": "Mozilla/5.0 (compatible; MarketCompass/1.0)"
  });
  const q = r.body?.chart?.result?.[0], ts = q?.timestamp || [], close = q?.indicators?.quote?.[0]?.close || [];
  const rows = ts.map((t, i) => ({ t: t * 1e3, v: Number(close[i]) })).filter((x) => Number.isFinite(x.v) && x.v > 0);
  return { ok: r.ok && rows.length >= 25, symbol, rows, status: r.status || 0, error: r.error || q?.meta?.error?.description || null };
}
__name(yahooDaily, "yahooDaily");
function seriesReturn(rows, days) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const last = rows.at(-1), target = last.t - days * DAY;
  let prev = null;
  for (const x of rows) {
    if (x.t <= target) prev = x;
    else break;
  }
  if (!prev || !prev.v) return null;
  return r3((last.v / prev.v - 1) * 100, 2);
}
__name(seriesReturn, "seriesReturn");
function averageFinite(xs) {
  const a = xs.filter(fin);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}
__name(averageFinite, "averageFinite");
async function fetchTftcBtcFlows() {
  const r = await fetchJson("https://www.tftc.io/bitcoin-etf-flows/data.json", 1e4, { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; MarketCompass/1.0)" });
  if (!r.ok || !r.body) return { ok: false, status: r.status || 0, rows: [] };
  const root = r.body;
  let candidates = [];
  const walk = /* @__PURE__ */ __name((x, depth = 0) => {
    if (depth > 5 || x == null) return;
    if (Array.isArray(x)) {
      if (x.length && typeof x[0] === "object") candidates.push(x);
      return;
    }
    if (typeof x === "object") for (const v of Object.values(x)) walk(v, depth + 1);
  }, "walk");
  walk(root);
  let arr = candidates.sort((a, b) => b.length - a.length)[0] || [];
  const rows = arr.map((x) => {
    const date = x.date || x.day || x.session || x.tradeDate || x.asOf;
    const raw = x.netFlowUsd ?? x.totalNetFlowUsd ?? x.total ?? x.flow ?? x.net_flow_usd;
    const n = Number(raw);
    return { date: String(date || "").slice(0, 10), flowUsd: Number.isFinite(n) ? n : null };
  }).filter((x) => /^20\d\d-\d\d-\d\d$/.test(x.date) && x.flowUsd !== null).sort((a, b) => a.date.localeCompare(b.date));
  return { ok: rows.length > 0, status: r.status || 200, rows: rows.slice(-180), source: "TFTC / The Commoner \xB7 SoSoValue + Farside" };
}
__name(fetchTftcBtcFlows, "fetchTftcBtcFlows");
async function buildRotation() {
  const symbols = ["SOXX", "SMH", "NVDA", "TLT", "SHY", "SGOV", "BTC-USD", "ETH-USD", "SOL-USD", "LINK-USD", "UNI-USD", "AAVE-USD", "NEAR-USD", "TAO-USD", "ONDO-USD"];
  const got = await Promise.all(symbols.map(async (s) => [s, await yahooDaily(s)]));
  const data = Object.fromEntries(got.map(([s, r]) => [s, r]));
  const perf = /* @__PURE__ */ __name((s) => {
    const r = data[s];
    return r?.ok ? { symbol: s, last: r.rows.at(-1).v, asOf: r.rows.at(-1).t, d7: seriesReturn(r.rows, 7), d30: seriesReturn(r.rows, 30), d90: seriesReturn(r.rows, 90), ok: true } : { symbol: s, ok: false, status: r?.status || 0, error: r?.error || "NO_DATA" };
  }, "perf");
  const ai = ["SOXX", "SMH", "NVDA"].map(perf), defensive = ["TLT", "SHY", "SGOV"].map(perf);
  const crypto = ["BTC-USD", "ETH-USD", "SOL-USD", "LINK-USD", "UNI-USD", "AAVE-USD", "NEAR-USD", "TAO-USD", "ONDO-USD"].map(perf);
  const alt = crypto.filter((x) => x.symbol !== "BTC-USD");
  const btc = crypto.find((x) => x.symbol === "BTC-USD"), eth = crypto.find((x) => x.symbol === "ETH-USD");
  const flows = await fetchTftcBtcFlows();
  const frows = flows.rows || [];
  const sumFlow = /* @__PURE__ */ __name((n) => {
    const a = frows.slice(-n);
    return a.length ? r3(a.reduce((s, x) => s + x.flowUsd, 0) / 1e6, 1) : null;
  }, "sumFlow");
  const ai30 = averageFinite(ai.map((x) => x.d30)), def30 = averageFinite(defensive.map((x) => x.d30)), alt30 = averageFinite(alt.map((x) => x.d30));
  const altVsBtc = fin(alt30) && fin(btc?.d30) ? r3(alt30 - btc.d30, 2) : null;
  const btcFlow5 = sumFlow(5), btcFlow20 = sumFlow(20);
  const aiWeak = fin(ai30) && ai30 < 0, defensiveStrong = fin(def30) && fin(ai30) && def30 > ai30, btcInflow = fin(btcFlow5) && btcFlow5 > 0 && fin(btcFlow20) && btcFlow20 > 0, altBreadth = alt.filter((x) => fin(x.d30) && fin(btc?.d30) && x.d30 > btc.d30).length;
  const phases = [
    { key: "ai", label: "AI \xB7 \uBC18\uB3C4\uCCB4", detail: "SOXX \xB7 SMH \xB7 NVDA", ret: ai30, signal: aiWeak ? "\uC57D\uC138 \uBAA8\uBA58\uD140" : "\uAC15\uC138/\uC911\uB9BD", proxy: "\uAC00\uACA9 \uBAA8\uBA58\uD140 proxy" },
    { key: "defensive", label: "\uCC44\uAD8C \xB7 \uD604\uAE08", detail: "TLT \xB7 SHY \xB7 SGOV", ret: def30, signal: defensiveStrong ? "\uC0C1\uB300\uAC15\uC138" : "\uC0C1\uB300\uAC15\uC138 \uBBF8\uD655\uC778", proxy: "\uAC00\uACA9 \uBAA8\uBA58\uD140 proxy" },
    { key: "btc", label: "BTC \xB7 ETH", detail: "\uD604\uBB3C \uAC00\uACA9 + BTC ETF \uC21C\uC720\uC785", ret: btc?.d30 ?? null, signal: btcInflow ? "ETF \uC21C\uC720\uC785 \uB3D9\uBC18" : "ETF \uC21C\uC720\uC785 \uBBF8\uD655\uC778", flow5: btcFlow5, flow20: btcFlow20, proxy: "\uAC00\uACA9 + BTC \uD604\uBB3C ETF \uC9C1\uC811 \uD50C\uB85C\uC6B0" },
    { key: "alt", label: "\uC54C\uD2B8\uCF54\uC778", detail: "ETH \uC81C\uC678 7\uC885 \uB3D9\uC77C\uAC00\uC911 \uBC14\uC2A4\uCF13", ret: alt30, signal: fin(altVsBtc) && altVsBtc > 0 ? "BTC \uB300\uBE44 \uCD08\uACFC\uC218\uC775" : "BTC \uB300\uBE44 \uCD08\uACFC\uC218\uC775 \uBBF8\uD655\uC778", breadth: altBreadth, total: alt.length, proxy: "\uAC00\uACA9 \uC0C1\uB300\uAC15\uB3C4 proxy" }
  ];
  const valid = Object.values(data).filter((x) => x.ok).length;
  return {
    ok: valid >= 8,
    version: "rotation-v1",
    updatedAt: Date.now(),
    cacheTtlSec: 900,
    summary: {
      ai30,
      defensive30: def30,
      btc30: btc?.d30 ?? null,
      eth30: eth?.d30 ?? null,
      alt30,
      altVsBtc,
      btcFlow5m: btcFlow5,
      btcFlow20m: btcFlow20,
      altBreadth,
      altTotal: alt.length,
      sequenceConfirmed: !!(aiWeak && defensiveStrong && btcInflow && fin(altVsBtc) && altVsBtc > 0),
      btcAccumulationEvidence: !!btcInflow,
      altExpansionEvidence: !!(fin(altVsBtc) && altVsBtc > 0 && altBreadth >= Math.ceil(alt.length * 0.5))
    },
    phases,
    assets: { ai, defensive, crypto },
    flows: { ok: flows.ok, source: flows.source || null, status: flows.status || 0, latest: frows.at(-1) || null, rows: frows.slice(-30), note: "BTC \uBBF8\uAD6D \uD604\uBB3C ETF \uC77C\uBCC4 \uC21C\uC720\uC785. \uCD5C\uC2E0 \uBBF8\uD655\uC815 \uC138\uC158\uC740 \uACF5\uAE09\uC790\uAC00 \uC81C\uC678\uD560 \uC218 \uC788\uC74C." },
    sources: { prices: "Yahoo Finance chart API (ETF\xB7\uC790\uC0B0 \uAC00\uACA9)", btcEtfFlows: flows.source || "TFTC data.json unavailable" },
    quality: { available: valid, total: symbols.length, flowRows: frows.length, flowDirect: flows.ok, priceDataAreFlows: false },
    notes: ["ETF \uAC00\uACA9 \uC218\uC775\uB960\uC740 \uC2E4\uC81C \uC790\uAE08 \uC720\uCD9C\uC785\uC774 \uC544\uB2C8\uB77C \uC2DC\uC7A5\uAC00\uACA9 proxy\uC785\uB2C8\uB2E4.", "\uCC44\uAD8C\xB7\uD604\uAE08 ETF\uC758 \uC124\uC815/\uD658\uB9E4 \uB370\uC774\uD130\uB294 \uC544\uC9C1 \uC9C1\uC811 \uC218\uC9D1\uD558\uC9C0 \uC54A\uC73C\uBBC0\uB85C \uC790\uAE08 \uC720\uC785 \uD655\uC815\uC73C\uB85C \uD574\uC11D\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.", "BTC ETF \uC21C\uC720\uC785\uB9CC \uBCC4\uB3C4 \uCD9C\uCC98\uC758 \uC77C\uBCC4 \uC21C\uC720\uC785\uC73C\uB85C \uC9C1\uC811 \uD655\uC778\uD569\uB2C8\uB2E4.", "ETH ETF \uBC0F AI\xB7\uBC18\uB3C4\uCCB4 \uD380\uB4DC\uC758 \uC9C1\uC811 \uC21C\uC720\uC785 \uB370\uC774\uD130\uB294 \uC774 \uBC84\uC804\uC5D0\uC11C \uC218\uC9D1\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."]
  };
}
__name(buildRotation, "buildRotation");
// MMC QUANTUM RESEARCH LAB: research-only, no order execution.
function mmcSMA(a, n) {
  return a.length >= n ? a.slice(-n).reduce((s, x) => s + x, 0) / n : null;
}

// Simple RSI (average of gains/losses). Not Wilder-smoothed RSI.
function mmcRSI(a, n = 14) {
  if (a.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = a.length - n; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    gain += Math.max(0, d);
    loss += Math.max(0, -d);
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

function mmcCorr(a, b) {
  const n = a.length;
  if (n < 12) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let va = 0, vb = 0, cv = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    va += x * x;
    vb += y * y;
    cv += x * y;
  }
  return va > 0 && vb > 0 ? cv / Math.sqrt(va * vb) : null;
}

function mmcReturns(series) {
  return new Map(series.map((p) => [new Date(p.t).toISOString().slice(0, 10), p.v]));
}

function mmcJoinReturns(a, b, window) {
  const A = mmcReturns(a);
  const B = mmcReturns(b);
  const days = [...A.keys()].filter((k) => B.has(k)).sort();
  const x = [];
  const y = [];
  for (let i = 1; i < days.length; i++) {
    const p = days[i - 1];
    const k = days[i];
    const da = A.get(k) / A.get(p) - 1;
    const db = B.get(k) / B.get(p) - 1;
    if (Number.isFinite(da) && Number.isFinite(db) && Math.abs(da) < 1 && Math.abs(db) < 1) {
      x.push(da);
      y.push(db);
    }
  }
  return { n: Math.min(window, x.length), corr: mmcCorr(x.slice(-window), y.slice(-window)) };
}

async function mmcFred(id) {
  const r = await fredSeries(id, "2015-01-01", false);
  return { ok: r.ok, source: r.via, series: r.series || [], status: r.status };
}

async function mmcYahoo(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=1420070400&period2=${Math.floor(Date.now() / 1000)}&interval=1d`;
  const r = await fetchJson(url, 12000, YH);
  const o = r.body?.chart?.result?.[0];
  const ts = o?.timestamp || [];
  const q = o?.indicators?.quote?.[0]?.close || [];
  const series = ts
    .map((t, i) => ({ t: t * 1000, v: Number(q[i]) }))
    .filter((p) => fin(p.v) && p.v > 0);
  return { ok: series.length > 90, series, source: "yahoo:" + sym, status: r.status };
}

async function mmcSource(fredId, yahooSym) {
  const f = await mmcFred(fredId);
  if (f.ok && f.series.length > 90) return f;
  const y = await mmcYahoo(yahooSym);
  return y.ok ? y : f;
}

function mmcMonthLast(a) {
  const m = new Map();
  for (const p of a || []) {
    if (fin(p.v)) m.set(new Date(p.t).toISOString().slice(0, 7), p.v);
  }
  return m;
}

function mmcRatios(btc, other) {
  const b = mmcMonthLast(btc);
  const o = mmcMonthLast(other);
  const keys = [...b.keys()].filter((k) => o.has(k) && b.get(k) > 0).sort();
  const rows = keys.map((k) => ({ month: k, ratio: o.get(k) / b.get(k) }));
  const base = rows[0]?.ratio;
  return rows.slice(-96).map((r) => ({
    ...r,
    indexed: base > 0 ? (100 * r.ratio) / base : null
  }));
}

function mmcQuality(d) {
  return {
    ok: d.ok,
    points: d.series?.length || 0,
    source: d.source || null,
    last: d.series?.length ? new Date(d.series.at(-1).t).toISOString().slice(0, 10) : null
  };
}

// US Treasury official public CSV, no account or API key required.
function mmcTreasuryCsv(csv){
 const lines=String(csv||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
 if(lines.length<2)return [];
 const parse=line=>{let a=[],v='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){v+='"';i++}else q=!q}else if(c===','&&!q){a.push(v.trim());v=''}else v+=c}a.push(v.trim());return a};
 const head=parse(lines[0]).map(x=>x.toLowerCase().replace(/\s+/g,' '));
 const find=(rx)=>head.findIndex(x=>rx.test(x));
 const di=find(/^date$/),i10=find(/^(10 yr|10-year|10 year)$/),i2=find(/^(2 yr|2-year|2 year)$/),i3=find(/^(3 mo|3-month|3 month)$/);
 if([di,i10,i2,i3].some(x=>x<0))return [];
 const out=[];for(const line of lines.slice(1)){const a=parse(line),date=a[di]||'',m=date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);const t=m?Date.UTC(+m[3],+m[1]-1,+m[2]):Date.parse(date);const y10=Number(a[i10]),y2=Number(a[i2]),y3=Number(a[i3]);if(Number.isFinite(t)&&[y10,y2,y3].every(Number.isFinite)&&[a[i10],a[i2],a[i3]].every(x=>x!==''&&x!=='N/A'))out.push({t,y10,y2,y3})}return out;
}
async function mmcTreasuryYields(){
 const now=new Date(),years=[now.getUTCFullYear(),now.getUTCFullYear()-1,now.getUTCFullYear()-2];
 const res=await Promise.all(years.map(async year=>{
 const url=`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/all/${year}?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page=&_format=csv`;
 const r=await fetchText(url,13000,CSV_HDR);return {year,status:r.status,rows:r.ok?mmcTreasuryCsv(r.body):[]}}));
 const m=new Map();for(const r of res)for(const x of r.rows)m.set(x.t,x);
 const a=[...m.values()].sort((a,b)=>a.t-b.t);const mk=k=>a.map(x=>({t:x.t,v:x[k]}));
 return {ok:a.length>10,source:'미국 재무부 공식 국채 수익률 CSV (API 키 불필요)',status:res.map(x=>`${x.year}:${x.status}/${x.rows.length}`).join(' '),points:a.length,ten:mk('y10'),two:mk('y2'),three:mk('y3')};
}

async function mmcQuantumBuild(){
 const t0=Date.now();const [btc,gold,copper,silver,wti,brent,treasury,usd,sp] = await Promise.all([
 fetchBtcPrice(),mmcSource('GOLDAMGBD228NLBM','GC=F'),mmcSource('PCOPPUSDM','HG=F'),mmcSource('SLVPRUSD','SI=F'),mmcSource('DCOILWTICO','CL=F'),mmcSource('DCOILBRENTEU','BZ=F'),mmcTreasuryYields(),mmcFred('DTWEXBGS'),mmcFred('SP500')]);
 const y10={ok:treasury.ok,source:treasury.source,series:treasury.ten,status:treasury.status},y2={ok:treasury.ok,source:treasury.source,series:treasury.two,status:treasury.status},m3={ok:treasury.ok,source:treasury.source,series:treasury.three,status:treasury.status};
 const bs=btc.series||[],prices=bs.map(x=>x.v),p=prices.at(-1),peak=prices.length?Math.max(...prices):null,sma200=mmcSMA(prices,200),sma1400=mmcSMA(prices,1400),rsi=mmcRSI(prices),dd=peak&&p?(p/peak-1)*100:null;
 const quality={btc:mmcQuality({...btc,source:btc.source}),gold:mmcQuality(gold),copper:mmcQuality(copper),silver:mmcQuality(silver),wti:mmcQuality(wti),brent:mmcQuality(brent),us10y:mmcQuality(y10),us2y:mmcQuality(y2),us3m:mmcQuality(m3),usd:mmcQuality(usd),sp500:mmcQuality(sp)};
 const fresh=(k,days=10)=>quality[k].last&&(Date.now()-Date.parse(quality[k].last))/864e5<=days;
 const valid=btc.ok&&prices.length>=200&&fresh('btc',3);
 const spread=(a,b)=>{const A=mmcMonthLast(a.series),B=mmcMonthLast(b.series);return [...A.keys()].filter(k=>B.has(k)).sort().slice(-72).map(k=>({month:k,value:+(A.get(k)-B.get(k)).toFixed(3)}))};
 const curve2=spread(y10,y2),curve3=spread(y10,m3);
 const reasons=[];let score=0,available=0;
 if(fin(dd)){available++;if(dd<=-60){score+=2;reasons.push('고점 대비 -60% 이하: 장기 낙폭 깊음')}else if(dd<=-35){score++;reasons.push('고점 대비 -35% 이하: 분할 관찰')}else reasons.push('장기 낙폭 기준의 깊은 할인 미확인')}
 if(fin(rsi)){available++;if(rsi<35){score+=2;reasons.push('일봉 RSI 과매도')}else if(rsi<45){score++;reasons.push('일봉 RSI 약세')}else reasons.push('RSI 과매도 미확인')}
 if(fin(sma200)&&fin(p)){available++;if(p<sma200*.8){score+=2;reasons.push('200일선 대비 20% 이상 하회')}else if(p<sma200){score++;reasons.push('200일선 아래')}else reasons.push('200일선 위: 추세 확인 필요')}
 const status=!valid?'DATA_UNAVAILABLE':score>=5?'DEEP_ACCUMULATION_WATCH':score>=3?'ACCUMULATION_WATCH':'NO_DISCOUNT_CONFIRMATION';
 const ratioPack=(s)=>({series:mmcRatios(bs,s.series),correlations:Object.fromEntries([30,90,365].map(n=>[n,mmcJoinReturns(bs,s.series,n)])),priceSource:s.source||null});
 return {ok:valid,built:new Date().toISOString(),elapsedMs:Date.now()-t0,mode:'RESEARCH_ONLY',advice:'NOT_FINANCIAL_ADVICE',btc:{monthlyPrices:[...mmcMonthLast(bs)].slice(-96).map(([month,value])=>({month,value})),price:p,drawdownPct:dd,sma200,sma1400,rsi14:rsi,points:prices.length,accumulation:{status,score,maxScore:available*2,reasons}},ratios:{goldBtc:ratioPack(gold),copperBtc:ratioPack(copper),silverBtc:ratioPack(silver)},commodities:Object.fromEntries([['gold',gold],['copper',copper],['silver',silver],['wti',wti],['brent',brent]].map(([k,v])=>[k,{latest:v.series?.at(-1)?.v||null,source:v.source,history:mmcMonthLast(v.series)?[...mmcMonthLast(v.series)].slice(-48).map(([month,value])=>({month,value})):[]}])),yieldCurve:{tenMinusTwo:curve2,tenMinusThreeMonth:curve3,source:treasury.source,diagnostics:treasury.status,observations:treasury.points},quality,limitations:['Gold/Copper ratios are USD price-unit ratios; indexed-to-100 series are for comparison.','Rolling correlations use matched daily returns; sparse monthly data yields null.','Yahoo commodity futures may contain contract rollover effects.','US Treasury yield curve uses official public CSV without FRED API key; if unavailable, yields are shown as missing.','Missing, stale, or partial data must not be interpreted as a trade signal.','MVRV, on-chain realized price, token unlocks, and verified ETF flows are NOT included in this research endpoint.']};
}



// MMC Research 30 · honest coverage registry, reproducible BTC-only historical test.
// Foundation-1: status registry is transparent; missing feeds never become neutral scores.
const MMC_RESEARCH_ITEMS = [
  { id: "01", name: "미국 순유동성", status: "부분 구현", note: "Fed/TGA/RRP/준비금 동시 확보 필요" },
  { id: "02", name: "글로벌 M2 시차", status: "부분 구현", note: "공통 시점 월간 자료와 표본외 검증 필요" },
  { id: "03", name: "AI→코인 자금 이동", status: "미구현", note: "실제 ETF 설정환매 흐름 미연결" },
  { id: "04", name: "국채·신용 위험", status: "부분 구현", note: "미국 재무부 금리 연결, 신용스프레드 추가 필요" },
  { id: "05", name: "원자재/BTC 상대강도", status: "부분 구현", note: "Quantum 원자재 데이터 품질에 의존" },
  { id: "06", name: "달러·엔캐리", status: "부분 구현", note: "환율·금리차 시계열 검증 필요" },
  { id: "07", name: "MVRV Z·실현가격", status: "데이터 미확보", note: "검증된 온체인 시계열 공급자 연결 필요" },
  { id: "08", name: "STH/LTH 손익", status: "데이터 미확보", note: "보유기간별 실현손익 공급자 필요" },
  { id: "09", name: "채굴자 항복", status: "데이터 미확보", note: "Puell·해시레이트 원자료 필요" },
  { id: "10", name: "200주선·가치밴드", status: "부분 구현", note: "장기 일봉 데이터 길이 확인 필요" },
  { id: "11", name: "RSI 다이버전스", status: "부분 구현", note: "확정 피벗과 표본외 평가 필요" },
  { id: "12", name: "와이코프 국면", status: "연구 필요", note: "정성 국면 자동화의 오탐 검증 필요" },
  { id: "13", name: "알트 BTC 상대강도", status: "기존 기능", note: "기존 레이더 참조" },
  { id: "14", name: "언락·희석", status: "데이터 미확보", note: "언락 일정·유통량 공급자 필요" },
  { id: "15", name: "프로토콜 수익", status: "데이터 미확보", note: "수수료와 토큰 가치귀속 구분 필요" },
  { id: "16", name: "온체인 이용 품질", status: "데이터 미확보", note: "체인별 활성주소 정의 통일 필요" },
  { id: "17", name: "호가 깊이", status: "부분 구현", note: "Upbit 호가 시점별 스냅샷 필요" },
  { id: "18", name: "섹터 순환 히트맵", status: "부분 구현", note: "섹터 분류와 시계열 구성 필요" },
  { id: "19", name: "BTC·ETH ETF 순유입", status: "데이터 미확보", note: "발행사 공시/검증된 집계의 일별 순유입 연결 필요" },
  { id: "20", name: "스테이블코인 품질", status: "부분 구현", note: "공급량 외 발행상환·준비금 검증 필요" },
  { id: "21", name: "펀딩·OI·롱숏", status: "데이터 미확보", note: "거래소 파생 데이터 통합 필요" },
  { id: "22", name: "청산 밀집 위험", status: "데이터 미확보", note: "유료 히트맵과 추정치 구분 필요" },
  { id: "23", name: "거래소 보유량·고래", status: "데이터 미확보", note: "주소 태깅 시점 편향 검증 필요" },
  { id: "24", name: "공포·과열 복합", status: "부분 구현", note: "중복 신호 가중치 조정 필요" },
  { id: "25", name: "분할매수 자금배분", status: "연구 도구 추가", note: "BTC 가격 기반 보수적 예시, 실거래 아님" },
  { id: "26", name: "분할매도 최적화", status: "연구 도구 추가", note: "미래 정보 없는 규칙 검증 필요" },
  { id: "27", name: "장기 백테스트", status: "연구 도구 추가", note: "실제 확보된 BTC 구간에 한정" },
  { id: "28", name: "워크포워드 검증", status: "연구 도구 추가", note: "과최적화 방지용 고정 규칙" },
  { id: "29", name: "가상 포트폴리오", status: "미구현", note: "로컬/개인 데이터 저장 설계 필요" },
  { id: "30", name: "데이터 신뢰성", status: "연구 도구 추가", note: "API 결측·원자료 출처 표시" }
];

function mmcFinite(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function mmcResearchStats(equity) {
  if (!equity.length) return null;
  let peak = equity[0];
  let mdd = 0;
  for (const v of equity) {
    peak = Math.max(peak, v);
    if (peak > 0) mdd = Math.min(mdd, (v / peak - 1) * 100);
  }
  return {
    end: equity.at(-1),
    totalReturnPct: (equity.at(-1) / equity[0] - 1) * 100,
    maxDrawdownPct: mdd
  };
}

/**
 * BTC-only historical test.
 * - Signals at prior close; execution at next observed close (conservative daily approximation).
 * - Strategies: Buy&Hold, 200-day trend (no fitted params), equal-daily DCA for reference only.
 * - DCA is cash-flow adjusted and NOT comparable to lump-sum returns / CAGR.
 */
function mmcBacktestBTC(raw, feePct = 0.1) {
  const a = (raw || [])
    .filter((x) => mmcFinite(x.v) && x.v > 0 && mmcFinite(x.t))
    .sort((x, y) => x.t - y.t);
  if (a.length < 450) {
    return { ok: false, error: "INSUFFICIENT_REAL_BTC_HISTORY", points: a.length, minimum: 450 };
  }

  const prices = a.map((x) => x.v);
  const n = a.length;
  const fee = feePct / 100;
  const mean = (i, days) => prices.slice(i - days + 1, i + 1).reduce((s, x) => s + x, 0) / days;

  const dca = [];
  const hold = [];
  const trend = [];
  const entries = [];

  let dcaCash = 1;
  let dcaBtc = 0;
  let trCash = 1;
  let trBtc = 0;
  let prevTarget = false;
  const hUnits = (1 - fee) / prices[0];

  for (let i = 0; i < n; i++) {
    // Equal-daily deposit simulation (normalized total contributions ≈ 2).
    // This is NOT monthly DCA; cash-flow adjusted returns must not be compared as CAGR.
    if (i > 0) dcaCash += 1 / n;
    const deposit = 1 / n;
    const buy = Math.min(deposit, dcaCash);
    if (buy > 0) {
      dcaBtc += (buy * (1 - fee)) / prices[i];
      dcaCash -= buy;
    }
    dca.push(dcaCash + dcaBtc * prices[i]);
    hold.push(hUnits * prices[i]);

    if (i >= 200) {
      const target = prices[i - 1] > mean(i - 1, 200);
      if (target !== prevTarget) {
        if (target) {
          trBtc = (trCash * (1 - fee)) / prices[i];
          trCash = 0;
        } else {
          trCash = trBtc * prices[i] * (1 - fee);
          trBtc = 0;
        }
        entries.push({
          date: new Date(a[i].t).toISOString().slice(0, 10),
          side: target ? "BUY" : "SELL"
        });
        prevTarget = target;
      }
    }
    trend.push(trCash + trBtc * prices[i]);
  }

  const cut = Math.floor(n * 0.7);
  const sub = (arr, start, end) => mmcResearchStats(arr.slice(start, end));

  return {
    ok: true,
    source: "실제 BTC 일별 종가",
    start: new Date(a[0].t).toISOString().slice(0, 10),
    end: new Date(a.at(-1).t).toISOString().slice(0, 10),
    observations: n,
    feePct,
    assumptions: [
      "종가 기반 체결 근사; 슬리피지·세금·시장충격 미포함",
      "200일 추세: 전일 신호, 다음 관측 종가 체결",
      "DCA는 일별 균등 납입 시뮬레이션이며 추가 납입이 있어 총수익률/CAGR 비교 대상에서 제외",
      "70/30 시간순 분할, 파라미터 학습·최적화 없음",
      "거래소/공급자 데이터 길이에 따라 시작 연도가 달라짐"
    ],
    buyHold: mmcResearchStats(hold),
    trend200: mmcResearchStats(trend),
    dca: {
      endPortfolioValue: dca.at(-1),
      totalContributions: 1 + (n - 1) / n,
      notComparableToLumpSum: true
    },
    outOfSample: {
      start: new Date(a[cut].t).toISOString().slice(0, 10),
      buyHold: sub(hold, cut, n),
      trend200: sub(trend, cut, n)
    },
    trades: entries.length,
    lastTrades: entries.slice(-12)
  };
}

async function mmcResearch30(env) {
  const now = new Date().toISOString();
  // No proxy / fake ETF / MVRV numbers. A missing feed must never silently become a neutral score.
  const btc = await fetchBtcPrice();
  const prices = btc.series || [];
  const result = mmcBacktestBTC(prices);
  const last = prices.at(-1);
  const ageDays = last ? +((Date.now() - last.t) / 86400000).toFixed(1) : null;
  const fresh = ageDays !== null && ageDays >= 0 && ageDays <= 3;

  return {
    ok: true,
    version: "v10.15.1-research-30-foundation",
    asOf: now,
    disclaimer: "연구용. 30개 기능 구현 완료가 아니며 수익률 보장/매매 지시가 아닙니다.",
    coverage: MMC_RESEARCH_ITEMS,
    quality: {
      btc: {
        source: btc.source || "unknown",
        points: prices.length,
        lastDate: last ? new Date(last.t).toISOString().slice(0, 10) : null,
        ageDays,
        fresh
      },
      mvrv: { available: false },
      etfNetFlows: { available: false },
      tokenUnlocks: { available: false }
    },
    historicalTest: fresh
      ? result
      : {
          ok: false,
          error: "BTC_DATA_STALE_OR_MISSING",
          detail: result.ok ? "과거 데이터는 있으나 최신 시세가 오래됨" : result.error
        },
    decision: {
      state: "RESEARCH_ONLY",
      eligibleForBuySignal: false,
      reasons: [
        "MVRV 실데이터 미연결",
        "ETF 실제 순유입 미연결",
        "토큰 언락 미연결",
        "다중 엔진 검증 전에는 통합 매매 신호 비활성"
      ]
    }
  };
}

var worker_default = {
  async fetch(req, env) {
    ENV_REF = env;
    const u = new URL(req.url);
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (u.pathname === "/research-30") {
      if (req.method !== "GET") return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
      try {
        const d=await cached(env,"mmc:research30:foundation1",1800,()=>mmcResearch30(env),x=>x&&x.ok,u.searchParams.get("force")==="1");
        return json(d,200);
      } catch(e){return json({ok:false,error:"RESEARCH_DATA_FAILED",detail:String(e?.message||e)},503)}
    }
    if (u.pathname === "/quantum-lab") {
      if (req.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      try {
        const v = await cached(env, "mmc:quantum:v2", 1800, mmcQuantumBuild, x => x && x.ok, u.searchParams.get("force") === "1");
        return json(v, v?.ok ? 200 : 503);
      } catch (e) {
        return json({ ok: false, error: "QUANTUM_BUILD_FAILED", detail: String(e?.message || e) }, 503);
      }
    }
    if (u.pathname === "/health") {
      return json({
        ok: true,
        version: "v10.15.1-research-30-foundation",
        routes: ["/health", "/research-30", "/quantum-lab", "/macro", "/altseason", "/rotation", "/capital-rotation", "/btc-compass", "/btc-compass-backtest", "/candles", "/upbit", "/market"],
        altseason: true,
        service: "BTC ALT REGIME TRADER · MASTER MARKET COMPASS",
        market: "Upbit KRW",
        research30: "foundation-1",
        pinConfigured: !!env.PIN,
        kvBound: !!env.SCALPER_KV
      });
    }
    if (u.pathname === "/rotation" || u.pathname === "/capital-rotation") {
      if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      const force = u.searchParams.get("force") === "1";
      try {
        const data = await cached(env, "rotation:v1", 15 * 60, buildRotation, (v) => v && v.ok, force);
        return json(data || { ok: false, error: "ROTATION_DATA_UNAVAILABLE" }, data?.ok ? 200 : 503);
      } catch (e) {
        return json({ ok: false, error: "ROTATION_BUILD_FAILED", detail: String(e?.message || e) }, 503);
      }
    }
    if (u.pathname === "/pin-check") {
      if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      if (!env.PIN) return json({ ok: false, error: "PIN_NOT_CONFIGURED", valid: false }, 200);
      const valid = requirePin(req, env);
      return json({ ok: true, valid });
    }
    if (u.pathname === "/macro") {
      if (req.method !== "POST" && req.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      const n = /* @__PURE__ */ __name((v) => {
        const x = Number(v);
        return Number.isFinite(x) ? x : null;
      }, "n");
      const [cgApiR, cgPageR, fngR] = await Promise.all([
        fetchJson("https://api.coingecko.com/api/v3/global", 9e3),
        fetchText("https://www.coingecko.com/en/charts/bitcoin-dominance", 9e3),
        fetchJson("https://api.alternative.me/fng/?limit=30&format=json", 9e3)
      ]);
      const cgApiDom = n(cgApiR.body?.data?.market_cap_percentage?.btc);
      const cgPage = parseCoinGeckoDominancePage(cgPageR.body);
      const pageDom = n(cgPage?.today);
      let btcDominance = null, btcDominanceSource = "CoinGecko unavailable";
      if (cgApiDom !== null && cgApiDom > 20 && cgApiDom < 90) {
        btcDominance = cgApiDom;
        btcDominanceSource = "CoinGecko API";
      } else if (pageDom !== null && pageDom > 20 && pageDom < 90) {
        btcDominance = pageDom;
        btcDominanceSource = "CoinGecko";
      }
      const btcDominanceSnapshots = cgPage ? { today: n(cgPage.today), d7: n(cgPage.d7), m1: n(cgPage.m1), m3: n(cgPage.m3), y1: n(cgPage.y1) } : null;
      const crossCheck = { coingeckoApi: cgApiDom, coingeckoPage: pageDom, apiStatus: cgApiR.status, pageStatus: cgPageR.status };
      const fgRows = Array.isArray(fngR.body?.data) ? fngR.body.data : [];
      const fg = fgRows[0] || null;
      const fearGreed = n(fg?.value);
      const fearGreedClass = fg?.value_classification || null;
      const fearGreedHistory = fgRows.slice().reverse().map((x) => n(x?.value)).filter((x) => x !== null);
      const mayerPayload = await cached(env, "macro:mayer:v2", 6 * 3600, async () => {
        let rows = [], to = null;
        for (let page = 0; page < 3; page++) {
          const url = `https://api.upbit.com/v1/candles/days?market=KRW-BTC&count=200${to ? `&to=${encodeURIComponent(to)}` : ""}`;
          const r = await fetchJson(url, 1e4);
          const a = Array.isArray(r.body) ? r.body : [];
          if (!a.length) break;
          rows.push(...a);
          const t = /* @__PURE__ */ new Date(a[a.length - 1].candle_date_time_utc + "Z");
          t.setSeconds(t.getSeconds() - 1);
          to = t.toISOString();
          if (a.length < 200) break;
          await sleep(110);
        }
        const byTime = [...new Map(rows.map((x) => [x.timestamp, x])).values()].sort((a, b) => a.timestamp - b.timestamp);
        const closes = byTime.map((x) => n(x.trade_price)).filter((x) => x !== null);
        const points = [];
        let sum = 0;
        for (let i = 0; i < closes.length; i++) {
          sum += closes[i];
          if (i >= 200) sum -= closes[i - 200];
          if (i >= 199) points.push(closes[i] / (sum / 200));
        }
        const step = Math.max(1, Math.floor(points.length / 520));
        const sampled = points.filter((_, i) => i % step === 0);
        if (points.length && sampled.at(-1) !== points.at(-1)) sampled.push(points.at(-1));
        return { ok: !!points.length, current: points.at(-1) || null, history: sampled.slice(-560) };
      }, (v) => v && v.ok);
      return json({
        ok: true,
        btcDominance,
        btcDominanceSource,
        btcDominanceCrossCheck: crossCheck,
        btcDominanceSnapshots,
        btcDominanceHistory: [],
        btcDominanceHistoryLabel: btcDominanceSnapshots ? "CoinGecko \uCCB4\uD06C\uD3EC\uC778\uD2B8" : "\uC2E4\uCE21 \uB204\uC801",
        dominanceHistoryStatus: btcDominanceSnapshots ? "coingecko-checkpoints" : "coingecko-unavailable",
        mayerMultiple: n(mayerPayload?.current),
        mayerHistory: Array.isArray(mayerPayload?.history) ? mayerPayload.history : [],
        mayerReference: { deepDiscount: 0.8, trend: 1, historicalOverheat: 2.4 },
        fearGreed,
        fearGreedClass,
        fearGreedHistory,
        updatedAt: Date.now()
      });
    }
    if (u.pathname === "/altseason") {
      if (req.method !== "POST" && req.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      const force = u.searchParams.get("force") === "1", part = u.searchParams.get("part");
      if (part === "diag") {
        const t = /* @__PURE__ */ __name(async (name, p) => {
          const t0 = Date.now();
          const r = await p;
          return [name, { ok: r.ok, status: r.status, ms: Date.now() - t0, head: (r.body || r.snip || r.error || "").slice(0, 100) }];
        }, "t");
        const fredUrl = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=M2SL&cosd=2024-01-01";
        const res = await Promise.all([
          t("fred_csv", fetchText(fredUrl, 12e3, CSV_HDR)),
          t("fred_csv_html_accept", fetchText(fredUrl, 12e3)),
          t("fred_api", env.FRED_API_KEY ? fetchText(`https://api.stlouisfed.org/fred/series/observations?series_id=M2SL&api_key=${encodeURIComponent(env.FRED_API_KEY)}&file_type=json&observation_start=2026-01-01`, 12e3, CSV_HDR) : Promise.resolve({ ok: false, status: 0, error: "FRED_API_KEY \uC5C6\uC74C" })),
          t("ecb", fetchText("https://data-api.ecb.europa.eu/service/data/BSI/M.U2.Y.V.M20.X.1.U2.2300.Z01.E?startPeriod=2025-01&format=csvdata", 12e3, CSV_HDR)),
          t("boj", fetchText("https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=MD02&startDate=202501&endDate=202608&code=MAM1NAM2M2MO", 12e3, CSV_HDR)),
          t("boe", fetchText("https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/2025&Dateto=28/Aug/2026&SeriesCodes=LPMAUYN&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N", 12e3, CSV_HDR))
        ]);
        const fxd = await ecbFx();
        const summ = /* @__PURE__ */ __name(async (name, p) => {
          const t0 = Date.now();
          let r;
          try {
            r = await p;
          } catch (e) {
            r = { ok: false, error: String(e?.message || e) };
          }
          const a = r.series || [];
          return [name, { ok: !!r.ok, status: r.status, via: r.via, n: a.length || (r.map ? r.map.size : 0), last: a.length ? a[a.length - 1].v : null, ms: Date.now() - t0 }];
        }, "summ");
        const alt = await Promise.all([
          summ("sp", altSeries("sp")),
          summ("dollar", altSeries("dollar")),
          summ("oil", altSeries("oil")),
          summ("y10", altSeries("y10")),
          summ("fed", altSeries("fed")),
          summ("eurusd", Promise.resolve(fxd.eurusd)),
          summ("jpyusd", Promise.resolve(fxd.jpyusd)),
          summ("gbpusd", Promise.resolve(fxd.gbpusd)),
          summ("ethbtc", ethBtcAlt()),
          summ("boj_m2", fetchBojM2(Date.now())),
          summ("ecb_m2", fetchEcbM2())
        ]);
        return json({ ok: true, part: "diag", fredApiKey: !!env.FRED_API_KEY, results: Object.fromEntries(res), alt: Object.fromEntries(alt) });
      }
      if (part === "live") {
        const live2 = await cached(env, "as:live:v3", 600, buildLive, (v) => v && v.ok, force);
        return json({ ok: !!live2?.ok, part: "live", cache: live2?.cache, ...live2 });
      }
      const hist = await cached(env, "as:hist:v6-us-eu-jp", 12 * 3600, buildHistory, (v) => v && v.ok, force);
      if (part === "hist") return json({ ok: !!hist.ok, part: "hist", cache: hist.cache, ms: hist.ms, sources: hist.sources, error: hist.error, history: hist.rows, levels: hist.levels, m2: hist.m2, cmcDom: hist.cmcDom });
      const live = await cached(env, "as:live:v3", 600, buildLive, (v) => v && v.ok, force);
      return json(compose(hist, live));
    }
    if (u.pathname === "/btc-compass") {
      if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      const force = u.searchParams.get("force") === "1";
      const data = await cached(env, "btc:compass:v4", 6 * 3600, async () => {
        const bp = await fetchBtcPrice();
        const srcLabel = bp.source || "multi-source";
        if (bp.ok && bp.series.length > 300) {
          const model = buildCompassModel(bp.series.map((p) => ({ t: p.t, v: p.v })), { source: `BTC/USD \xB7 ${srcLabel}` });
          if (model.ok) {
            return { ...model, dataStatus: bp.status, sourcesTried: bp.sourcesTried, fetchSource: bp.source };
          }
          return {
            ok: false,
            error: model.error || "MODEL_FAILED",
            latestAgeDays: model.latestAgeDays,
            count: model.count,
            status: bp.status,
            sourcesTried: bp.sourcesTried,
            fetchSource: bp.source
          };
        }
        const monthlyUrls = [
          "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1M&limit=1000",
          "https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=1M&limit=1000"
        ];
        for (const murl of monthlyUrls) {
          const r = await fetchJson(murl, 14e3);
          if (!r.ok || !Array.isArray(r.body) || !r.body.length) continue;
          const model = buildCompassModel(cpFromBinanceMonthly(r.body), { source: "Binance BTCUSDT 1M (\uD3F4\uBC31)" });
          if (model.ok) {
            return { ...model, dataStatus: r.status, sourcesTried: bp.sourcesTried, fetchSource: "binance-1M-fallback" };
          }
        }
        return {
          ok: false,
          error: "BTC_MONTHLY_DATA_UNAVAILABLE",
          status: bp.status,
          seriesLen: bp.series?.length || 0,
          sourcesTried: bp.sourcesTried,
          fetchSource: bp.source
        };
      }, (v) => v && v.ok, force);
      if (!data || !data.ok) return json(data);
      const rawKey = cpBucketKey(data.current?.heatScore);
      const eligible = data.quality?.signalEligible === true && data.cache !== "stale";
      const signal = await cpUpdateSignal(env, rawKey, eligible);
      return json({ ...data, signal });
    }
    if (u.pathname === "/btc-compass-backtest") {
      if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      const force = u.searchParams.get("force") === "1";
      const data = await cached(env, "btc:compass:bt:v2", 24 * 3600, async () => {
        const bp = await fetchBtcPrice();
        if (!bp.ok || bp.series.length < 400) {
          return { ok: false, error: "DAILY_BTC_DATA_UNAVAILABLE", status: bp.status, sourcesTried: bp.sourcesTried };
        }
        const r = cpRunBacktest(bp.series.map((p) => ({ t: p.t, v: p.v })));
        return { ...r, source: `BTC/USD \xB7 ${bp.source || "multi"}`, sourcesTried: bp.sourcesTried };
      }, (v) => v && v.ok, force);
      return json(data);
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
          text: "BTC ALT REGIME TRADER v8.3.6 \xB7 Telegram \uC5F0\uACB0 \uD14C\uC2A4\uD2B8 \uC131\uACF5"
        })
      });
      let tb = null;
      try {
        tb = await tr.json();
      } catch {
      }
      if (!tr.ok || !tb?.ok) return json({ ok: false, error: "TELEGRAM_SEND_FAILED", status: tr.status }, 502);
      return json({ ok: true });
    }
    if (u.pathname === "/candles") {
      if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      let body = {};
      try {
        body = await req.json();
      } catch {
      }
      const symbol = String(body.symbol || "BTC").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const frame = String(body.frame || "5m").toLowerCase();
      const count = Math.max(1, Math.min(200, Number(body.count) || 200));
      const rawTo = body.to;
      const parsedTo = Number(rawTo);
      const to = rawTo !== null && rawTo !== void 0 && rawTo !== "" && Number.isFinite(parsedTo) && parsedTo > 9466848e5 ? parsedTo : NaN;
      const path = frame === "month" ? `/v1/candles/months?market=KRW-${symbol}&count=${count}${Number.isFinite(to) ? `&to=${encodeURIComponent(new Date(to).toISOString())}` : ""}` : frame === "day" ? `/v1/candles/days?market=KRW-${symbol}&count=${count}${Number.isFinite(to) ? `&to=${encodeURIComponent(new Date(to).toISOString())}` : ""}` : `/v1/candles/minutes/5?market=KRW-${symbol}&count=${count}${Number.isFinite(to) ? `&to=${encodeURIComponent(new Date(to).toISOString())}` : ""}`;
      let r = await fetchJson(UPBIT + path, 7e3);
      for (let k = 0; k < 3 && (!r.ok || !Array.isArray(r.body) || !r.body.length) && (r.status === 429 || r.status >= 500 || r.status === 0); k++) {
        await new Promise((res) => setTimeout(res, 350 + k * 250 + Math.floor(Math.random() * 150)));
        r = await fetchJson(UPBIT + path, 7e3);
      }
      let source = "upbit";
      const needFallback = !r.ok || !Array.isArray(r.body) || r.body.length === 0;
      if (needFallback) {
        const interval = frame === "month" ? "1M" : frame === "day" ? "1d" : "5m";
        const endPart = Number.isFinite(to) ? `&endTime=${encodeURIComponent(to)}` : "";
        const bnUrls = [
          `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${count}${endPart}`,
          `https://api.binance.us/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${count}${endPart}`
        ];
        for (const bnUrl of bnUrls) {
          const br = await fetchJson(bnUrl, 8e3);
          if (br.ok && Array.isArray(br.body) && br.body.length) {
            const candles2 = br.body.map((x) => [
              Number(x[0]),
              Number(x[1]),
              Number(x[2]),
              Number(x[3]),
              Number(x[4]),
              Number(x[5])
            ]);
            return json({
              ok: true,
              symbol,
              frame,
              source: bnUrl.includes("binance.us") ? "binance.us-fallback" : "binance.vision-fallback",
              candles: candles2,
              upbitStatus: r.status
            });
          }
        }
      }
      if (!r.ok || !Array.isArray(r.body) || r.body.length === 0) {
        return json({ ok: false, error: "CANDLES_FAILED", status: r.status, fallbackTried: true }, 502);
      }
      const candles = r.body.slice().reverse().map((x) => [
        Date.parse(x.candle_date_time_utc + "Z"),
        Number(x.opening_price),
        Number(x.high_price),
        Number(x.low_price),
        Number(x.trade_price),
        Number(x.candle_acc_trade_volume)
      ]);
      return json({ ok: true, symbol, frame, source, candles });
    }
    if (u.pathname === "/upbit") {
      const path = u.searchParams.get("path");
      // Whitelist common read-only Upbit public endpoints used by the dashboard.
      const allowed = /^\/v1\/(ticker|candles\/(minutes|days|weeks|months)|orderbook|trades\/ticks|market\/all|crix\/candles)/;
      if (!path || !path.startsWith("/v1/") || !allowed.test(path.split("?")[0])) {
        return json({ ok: false, error: "invalid or disallowed path" }, 400);
      }
      let lastStatus = 0, lastText = "";
      for (let k = 0; k < 3; k++) {
        try {
          const r = await fetch(UPBIT + path, {
            headers: { Accept: "application/json", "User-Agent": "BTC-ALT-REGIME-TRADER/10.13.1" }
          });
          lastStatus = r.status;
          lastText = await r.text();
          if ((r.status === 429 || r.status >= 500) && k < 2) {
            await new Promise((res) => setTimeout(res, 300 + k * 200 + Math.floor(Math.random() * 120)));
            continue;
          }
          return new Response(lastText, {
            status: lastStatus,
            headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" }
          });
        } catch (e) {
          lastText = JSON.stringify({ error: String(e?.message || e) });
          lastStatus = 502;
          if (k < 2) await new Promise((res) => setTimeout(res, 300 + k * 200));
        }
      }
      return new Response(lastText || JSON.stringify({ error: "UPBIT_PROXY_FAILED" }), {
        status: lastStatus || 502,
        headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }
    if (u.pathname === "/market") {
      const symbols = (u.searchParams.get("symbols") || "BTC,ETH,SOL,XRP,XLM,HBAR,ONDO,LINK,AVAX,DOGE,SUI,TAO,UNI,AAVE,ADA,NEAR").toUpperCase().split(",").map((x) => x.trim()).filter(Boolean);
      const uniq = [...new Set(symbols)].slice(0, 30);
      const upMarkets = [.../* @__PURE__ */ new Set([...uniq.map((s) => "KRW-" + s), "KRW-USDT"])];
      const ur = await fetchJson(UPBIT + "/v1/ticker?markets=" + encodeURIComponent(upMarkets.join(",")), 5e3);
      if (!ur.ok || !Array.isArray(ur.body)) {
        return json({ ok: false, version: "v10.5.0-minimal+pin", error: "UPBIT_FAILED", status: ur.status, detail: ur.error || null }, 502);
      }
      const up = ur.body;
      const um = new Map(up.map((x) => [x.market, x]));
      const usdtKrw = Number(um.get("KRW-USDT")?.trade_price) || 0;
      let refMap = /* @__PURE__ */ new Map();
      let referenceSource = null;
      let referenceStatus = null;
      const cr = await fetchJson(
        "https://min-api.cryptocompare.com/data/pricemulti?fsyms=" + encodeURIComponent(uniq.join(",")) + "&tsyms=USD",
        5e3
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
        reference: (referenceSource || "NONE") + " \xD7 Upbit USDT/KRW",
        referenceSource,
        referenceStatus,
        coinbaseStatus,
        usdtKrw: usdtKrw || null,
        kimchiSourceOk: priced > 0,
        kimchiPairs: priced,
        rows,
        updatedAt: Date.now()
      });
    }
    if (u.pathname === "/") return new Response("BTC ALT REGIME TRADER (minimal)", { headers: CORS });
    return json({ ok: false, error: "NOT_FOUND", path: u.pathname }, 404);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
