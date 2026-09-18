const VERSION = 'v10.1.0';
const STRATEGY_VERSION = 'krw-5m-v10.1.0-fibonacci-liquidity-manual';
const COINS = ['ETH','SOL','XRP','HBAR','ONDO','LINK','AVAX','DOGE','SUI','TAO','UNI','AAVE'];
const UPBIT_CANDLE_BASE = 'https://api.upbit.com/v1/candles/minutes';
const UPBIT_DAY_BASE = 'https://api.upbit.com/v1/candles/days';
const POS_KEY = 'positions';
const TRADE_HISTORY_KEY = 'trade-history:v1';
const MAX_TRADE_HISTORY = 300;
const LAST_RESULT_KEY = 'runtime:last-result';
const LAST_ERROR_KEY = 'runtime:last-error';
const REGIME_KEY = 'market-regime:v1';
const CONTEXT_CACHE_KEY = 'context:auto:v1';
const MANUAL_EVENTS_KEY = 'context:manual-events:v1';
const PREDICTION_CONFIG_KEY = 'context:prediction-config:v1';
const CONTEXT_CACHE_MS = 15 * 60 * 1000;
const CONTEXT_HISTORY_TTL = 120 * 24 * 60 * 60;
const MACRO_PROVIDER_CACHE_KEY = 'macro:public-provider-cache:v1';
const MACRO_PROVIDER_CACHE_TTL = 60 * 24 * 60 * 60;
const MACRO_FETCH_TIMEOUT_MS = 10000;
const MACRO_METRICS = {
  US10Y: { label:'미10Y', provider:'U.S. Treasury' },
  US2Y: { label:'미2Y', provider:'U.S. Treasury' },
  VIX: { label:'VIX', provider:'Cboe' },
  BROAD_USD: { label:'광의달러', provider:'Federal Reserve Board' },
  WTI: { label:'WTI', provider:'EIA' },
  USDJPY: { label:'USD/JPY', provider:'Federal Reserve Board' },
  OVX: { label:'OVX', provider:'Cboe' },
  CPI: { label:'CPI', provider:'BLS' },
  UNRATE: { label:'실업률', provider:'BLS' }
};
const MACRO_METRIC_IDS = Object.keys(MACRO_METRICS);
const MACRO_PROVIDER_STALE_MS = {
  treasury: 5 * 24 * 60 * 60 * 1000,
  federalreserve: 14 * 24 * 60 * 60 * 1000,
  cboe: 5 * 24 * 60 * 60 * 1000,
  bls: 45 * 24 * 60 * 60 * 1000,
  eia: 7 * 24 * 60 * 60 * 1000
};
const MACRO_PROVIDER_MIN_REFRESH_MS = {
  // BLS CPI/실업률은 월간 데이터입니다. 5분 Cron마다 호출하지 않고 하루 최대 2회만 갱신합니다.
  bls: 12 * 60 * 60 * 1000
};
const FIVE_MIN = 5 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;

export default {
  async fetch(req, env) {
    try {
      const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors() });


    if (req.method === 'GET' && u.pathname === '/market') {
      return json(await getMarketRadar(env));
    }

    if (req.method === 'GET' && u.pathname === '/liquidity') {
      return json(await getLiquidityRadar(env));
    }

    if (req.method === 'GET' && u.pathname === '/health') {
      return json({
        ok: true,
        version: VERSION,
        strategyVersion: STRATEGY_VERSION,
        market: 'UPBIT_KRW',
        timeframe: '5m',
        cron: '*/5 * * * *',
        kv: !!env.SCALPER_KV,
        telegramConfigured: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
        pinConfigured: !!env.SCALPER_PIN,
        strategy: strategyConfig(env),
        coins: COINS,
        externalContext: { liquidityRadar: true, fibonacciEngine: true, publicMacro: true, macroProviders: ['U.S. Treasury','Federal Reserve Board','Cboe','BLS','EIA'], polymarket: true, cryptoPanicConfigured: !!env.CRYPTOPANIC_AUTH_TOKEN, manualEvents: true, regimeEngine: true, regimeQualityFilter: true, rangeBuyBlocked: true, antiChase: true, altRelativeStrength: true, hardSoftBtcCrash: true, adaptiveProfitReviews: true, manualOnly: true, autoTrading: false },
        note: '수동매매 전용입니다. Telegram은 BUY/SELL 검토 알림만 보내며 주문은 자동 실행하지 않습니다. /scan은 조회 전용입니다.'
      });
    }

    if (!auth(req, env)) return json({ ok: false, error: 'unauthorized' }, 401);

    if (req.method === 'POST' && u.pathname === '/test') {
      requireTelegram(env);
      await sendTelegram(env, `🧪 BTC ALT REGIME TRADER ${VERSION}\nTelegram 연결 테스트 성공\n수동매매 알림 전용 · Cloudflare Cron 5분`);
      return json({ ok: true });
    }

    if (req.method === 'POST' && u.pathname === '/position') {
      requireKV(env);
      const body = await readJson(req);
      const symbol = normalizeSymbol(body.symbol);
      if (!COINS.includes(symbol)) return json({ ok: false, error: '지원하지 않는 코인입니다.' }, 400);
      const action = body.action === 'remove' ? 'remove' : 'add';
      const positions = await getPositions(env);
      if (action === 'add') {
        const entry = Number(body.entry);
        if (!Number.isFinite(entry) || entry <= 0) return json({ ok: false, error: '실제 매수가(KRW)를 입력하세요.' }, 400);
        const old = positions[symbol] || {};
        const quantityRaw = body.quantity == null || body.quantity === '' ? old.quantity : Number(body.quantity);
        const quantity = Number.isFinite(Number(quantityRaw)) && Number(quantityRaw) > 0 ? Number(quantityRaw) : null;
        if (body.quantity != null && body.quantity !== '' && quantity == null) return json({ ok: false, error: '올바른 보유 수량을 입력하세요.' }, 400);
        const rp = body.riskPlan && typeof body.riskPlan === 'object' ? body.riskPlan : old.riskPlan;
        const riskPlan = rp ? {
          slPct: clamp(Number(rp.slPct)||0, .3, 8),
          tp1Pct: clamp(Number(rp.tp1Pct)||0, .3, 15),
          tp2Pct: clamp(Number(rp.tp2Pct)||0, .5, 25),
          trailPct: clamp(Number(rp.trailPct)||0, .2, 8),
          partialPct: clamp(Number(rp.partialPct)||.5, .1, .9),
          horizonHours: clampInt(Number(rp.horizonHours)||24, 4, 168),
          state: String(rp.state || body.marketRegime || old.marketRegimeAtEntry || 'RANGE')
        } : null;
        const addedAt = Number(old.addedAt) || Number(body.boughtAt) || Date.now();
        positions[symbol] = {
          entry,
          quantity,
          riskPlan,
          marketRegimeAtEntry: String(body.marketRegime || old.marketRegimeAtEntry || riskPlan?.state || 'UNKNOWN'),
          addedAt,
          updatedAt: Date.now(),
          // 수동매매 관리 상태. 전량 매도 후 포지션이 삭제되면 다음 신규 등록 때 초기화됩니다.
          peakPrice: Math.max(entry, Number(old.peakPrice) || entry),
          tp1AlertedAt: Number(old.tp1AlertedAt) || null,
          tp2AlertedAt: Number(old.tp2AlertedAt) || null,
          lastTrailStop: Number(old.lastTrailStop) || null
        };
      } else {
        delete positions[symbol];
      }
      await env.SCALPER_KV.put(POS_KEY, JSON.stringify(positions));
      return json({ ok: true, held: Object.keys(positions), positions });
    }

    if (req.method === 'POST' && u.pathname === '/trade') {
      requireKV(env);
      const body = await readJson(req);
      const action = String(body.action || '').toLowerCase();
      const symbol = normalizeSymbol(body.symbol);
      if (!COINS.includes(symbol)) return json({ ok: false, error: '지원하지 않는 코인입니다.' }, 400);
      const history = await getTradeHistory(env);

      if (action === 'manual') {
        const entry = positiveNumber(body.entry);
        const exit = positiveNumber(body.exit);
        const quantity = positiveNumber(body.quantity);
        if (!entry || !exit || !quantity) return json({ ok: false, error: '매수가, 매도가, 수량을 모두 올바르게 입력하세요.' }, 400);
        const trade = makeClosedTrade({ symbol, entry, exit, quantity, boughtAt: Number(body.boughtAt) || null, soldAt: Number(body.soldAt) || Date.now(), source: 'manual', feePct: strategyConfig(env).tradingFeePct });
        history.unshift(trade);
        await saveTradeHistory(env, history);
        return json({ ok: true, trade, ...(await buildLedger(env)) });
      }

      if (action === 'sell') {
        const positions = await getPositions(env);
        const pos = positions[symbol];
        if (!pos) return json({ ok: false, error: `${symbol}/KRW가 보유 상태로 등록되어 있지 않습니다.` }, 400);
        const exit = positiveNumber(body.exit);
        const quantity = positiveNumber(body.quantity);
        if (!exit || !quantity) return json({ ok: false, error: '실제 매도가와 매도 수량을 입력하세요.' }, 400);
        const heldQty = positiveNumber(pos.quantity);
        if (heldQty && quantity > heldQty + 1e-12) return json({ ok: false, error: `매도 수량이 보유 수량(${heldQty})보다 큽니다.` }, 400);
        const trade = makeClosedTrade({ symbol, entry: Number(pos.entry), exit, quantity, boughtAt: Number(pos.addedAt) || null, soldAt: Number(body.soldAt) || Date.now(), source: 'position', feePct: strategyConfig(env).tradingFeePct });
        history.unshift(trade);
        if (heldQty && quantity < heldQty - 1e-12) {
          positions[symbol] = { ...pos, quantity: heldQty - quantity, updatedAt: Date.now() };
        } else {
          delete positions[symbol];
        }
        await Promise.all([
          env.SCALPER_KV.put(POS_KEY, JSON.stringify(positions)),
          saveTradeHistory(env, history)
        ]);
        return json({ ok: true, trade, ...(await buildLedger(env)) });
      }

      return json({ ok: false, error: '지원하지 않는 거래 작업입니다.' }, 400);
    }

    if (req.method === 'POST' && u.pathname === '/context') {
      requireKV(env);
      const body = await readJson(req);
      const action = String(body.action || 'get').toLowerCase();
      if (action === 'add-event') {
        const scope = normalizeContextScope(body.scope);
        const score = clamp(Number(body.score) || 0, -10, 10);
        const label = String(body.label || '').trim().slice(0, 140);
        if (!label || score === 0) return json({ ok: false, error: '이벤트 이름과 0이 아닌 점수를 입력하세요.' }, 400);
        const hours = clamp(Number(body.hours) || 24, 1, 24 * 90);
        const events = await getManualEvents(env, false);
        events.unshift({ id: crypto.randomUUID(), scope, score: rnd(score, 2), label, source: String(body.source || '').trim().slice(0, 300), createdAt: Date.now(), expiresAt: Date.now() + hours * 3600000 });
        await env.SCALPER_KV.put(MANUAL_EVENTS_KEY, JSON.stringify(events.slice(0, 100)));
        await env.SCALPER_KV.delete(CONTEXT_CACHE_KEY);
        return json({ ok: true, ...(await getContextDashboard(env, { force: true })) });
      }
      if (action === 'delete-event') {
        const events = (await getManualEvents(env, false)).filter(x => x.id !== body.id);
        await env.SCALPER_KV.put(MANUAL_EVENTS_KEY, JSON.stringify(events));
        await env.SCALPER_KV.delete(CONTEXT_CACHE_KEY);
        return json({ ok: true, ...(await getContextDashboard(env, { force: true })) });
      }
      if (action === 'add-prediction') {
        const marketId = String(body.marketId || '').trim();
        const scope = normalizeContextScope(body.scope);
        const favorableOutcome = String(body.favorableOutcome || 'Yes').trim().slice(0, 40);
        const weight = clamp(Number(body.weight) || 4, 0.5, 10);
        const label = String(body.label || `Polymarket ${marketId}`).trim().slice(0, 140);
        if (!/^\d+$/.test(marketId)) return json({ ok: false, error: 'Polymarket market ID는 숫자 형식이어야 합니다.' }, 400);
        const rows = await getPredictionConfig(env);
        rows.unshift({ id: crypto.randomUUID(), marketId, scope, favorableOutcome, weight: rnd(weight, 2), label, createdAt: Date.now() });
        await env.SCALPER_KV.put(PREDICTION_CONFIG_KEY, JSON.stringify(rows.slice(0, 20)));
        await env.SCALPER_KV.delete(CONTEXT_CACHE_KEY);
        return json({ ok: true, ...(await getContextDashboard(env, { force: true })) });
      }
      if (action === 'delete-prediction') {
        const rows = (await getPredictionConfig(env)).filter(x => x.id !== body.id);
        await env.SCALPER_KV.put(PREDICTION_CONFIG_KEY, JSON.stringify(rows));
        await env.SCALPER_KV.delete(CONTEXT_CACHE_KEY);
        return json({ ok: true, ...(await getContextDashboard(env, { force: true })) });
      }
      return json({ ok: true, ...(await getContextDashboard(env, { force: action === 'refresh' })) });
    }

    if (req.method === 'POST' && u.pathname === '/positions') {
      requireKV(env);
      const positions = await getPositions(env);
      return json({ ok: true, held: Object.keys(positions), positions });
    }

    if (req.method === 'POST' && u.pathname === '/ledger') {
      requireKV(env);
      return json({ ok: true, ...(await buildLedger(env)) });
    }

    if (req.method === 'POST' && u.pathname === '/status') {
      requireKV(env);
      const [raw, errRaw, positions] = await Promise.all([
        env.SCALPER_KV.get(LAST_RESULT_KEY),
        env.SCALPER_KV.get(LAST_ERROR_KEY),
        getPositions(env)
      ]);
      let lastError = null;
      try { lastError = errRaw ? JSON.parse(errRaw) : null; } catch {}
      if (!raw) return json({ ok: true, ready: false, lastError, held: Object.keys(positions), positions, message: '아직 Cron 스캔 결과가 저장되지 않았습니다.' });
      try {
        const saved = JSON.parse(raw);
        return json({ ok: true, ready: true, ...applyLivePositions(saved, positions, strategyConfig(env)), lastError });
      }
      catch { return json({ ok: false, error: '저장된 상태 데이터를 읽지 못했습니다.' }, 500); }
    }

    // 수동 조회: Telegram을 절대 발송하지 않습니다.
    if (req.method === 'POST' && u.pathname === '/scan') {
      const result = await scanAll(env, { notify: false, source: 'manual', asOf: Date.now() });
      return json(result);
    }

    // 백테스트용 Upbit 프록시. 5분봉과 BTC 일봉을 같은 Worker에서 중계합니다.
    if (req.method === 'POST' && u.pathname === '/candles') {
      const body = await readJson(req);
      const symbol = normalizeSymbol(body.symbol);
      if (symbol !== 'BTC' && !COINS.includes(symbol)) return json({ ok: false, error: '지원하지 않는 코인입니다.' }, 400);
      const count = clampInt(Number(body.count) || 200, 1, 200);
      const to = body.to == null ? null : Number(body.to);
      if (to != null && !Number.isFinite(to)) return json({ ok: false, error: '잘못된 to 값입니다.' }, 400);
      const frame = String(body.frame || '5m').toLowerCase();
      const candles = frame === 'day'
        ? await fetchDayCandlesPage(symbol, count, to)
        : await fetchCandlesPage(symbol, 5, count, to);
      return json({ ok: true, symbol, frame, candles });
    }

      return json({ ok: false, error: 'not found' }, 404);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('request failed', error);
      return json({ ok: false, error }, 500);
    }
  },

  async scheduled(controller, env) {
    // Cron 실패가 Cloudflare Past Events에 남도록 await/throw 합니다.
    requireKV(env);
    requireTelegram(env);
    const asOf = Number(controller?.scheduledTime) || Date.now();
    const delayMs = Math.max(0, numEnv(env.CRON_DELAY_SECONDS, 12)) * 1000;
    try {
      if (delayMs) await sleep(delayMs); // 거래소가 막 닫힌 5분봉을 확정할 시간을 줍니다.
      const result = await scanAll(env, { notify: true, source: 'cron', asOf });
      await env.SCALPER_KV.put(LAST_RESULT_KEY, JSON.stringify({ ...result, savedAt: Date.now() }));
      await env.SCALPER_KV.delete(LAST_ERROR_KEY);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      try { await env.SCALPER_KV.put(LAST_ERROR_KEY, JSON.stringify({ at: Date.now(), error })); } catch {}
      console.error('scheduled scan failed', error);
      throw err;
    }
  }
};

function cors() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-scalper-pin',
    'cache-control': 'no-store'
  };
}

function auth(req, env) {
  return !!env.SCALPER_PIN && req.headers.get('x-scalper-pin') === env.SCALPER_PIN;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors() }
  });
}

async function readJson(req) {
  try { return await req.json(); } catch { return {}; }
}

function requireKV(env) {
  if (!env.SCALPER_KV) throw new Error('SCALPER_KV 바인딩이 없습니다. 24시간 자동알림에는 KV가 필수입니다.');
}

function requireTelegram(env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error('Telegram Secret 설정이 없습니다.');
}

function normalizeSymbol(value) {
  return String(value || '').toUpperCase().replace('KRW-', '').replace('/KRW', '').replace('USDT', '').trim();
}

function marketOf(symbol) { return `KRW-${normalizeSymbol(symbol)}`; }
function candleStartMs(c) { return Date.parse(`${c.candle_date_time_utc}Z`); }

async function fetchCandlesPage(symbol, unit = 5, count = 200, toMs = null) {
  const q = new URLSearchParams({ market: marketOf(symbol), count: String(count) });
  if (toMs != null) q.set('to', new Date(toMs).toISOString());
  const r = await fetch(`${UPBIT_CANDLE_BASE}/${unit}?${q.toString()}`, { headers: { accept: 'application/json' } });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Upbit ${r.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
  }
  const data = await r.json();
  if (!Array.isArray(data)) throw new Error('Upbit candle 응답 형식이 올바르지 않습니다.');
  return data.reverse().map(c => [
    candleStartMs(c),
    Number(c.opening_price),
    Number(c.high_price),
    Number(c.low_price),
    Number(c.trade_price),
    Number(c.candle_acc_trade_volume)
  ]).filter(x => Number.isFinite(x[0]));
}

async function recentClosed5m(symbol, asOf, limit = 288) {
  const cutoff = Math.floor(asOf / FIVE_MIN) * FIVE_MIN;
  let out = [];
  let to = null;
  while (out.length < limit) {
    const page = await fetchCandlesPage(symbol, 5, Math.min(200, limit - out.length + 1), to);
    if (!page.length) break;
    out = page.concat(out);
    if (page.length < 200) break;
    to = page[0][0];
  }
  const uniq = new Map(out.filter(x => x[0] < cutoff).map(x => [x[0], x]));
  return [...uniq.values()].sort((a,b) => a[0]-b[0]).slice(-limit);
}

async function fetchDayCandlesPage(symbol, count = 200, toMs = null) {
  const q = new URLSearchParams({ market: marketOf(symbol), count: String(Math.min(200, Math.max(1, count))) });
  if (toMs != null) q.set('to', new Date(toMs).toISOString());
  const r = await fetch(`${UPBIT_DAY_BASE}?${q.toString()}`, { headers: { accept: 'application/json' } });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Upbit day ${r.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
  }
  const data = await r.json();
  if (!Array.isArray(data)) throw new Error('Upbit day candle 응답 형식이 올바르지 않습니다.');
  return data.reverse().map(c => [
    candleStartMs(c),
    Number(c.opening_price),
    Number(c.high_price),
    Number(c.low_price),
    Number(c.trade_price),
    Number(c.candle_acc_trade_volume)
  ]).filter(x => Number.isFinite(x[0]));
}

async function recentClosedDays(symbol, asOf, limit = 200) {
  const raw = await fetchDayCandlesPage(symbol, Math.min(200, limit + 1), null);
  // Upbit 일봉은 00:00 KST에 새 봉이 시작합니다. UTC 자정이 아니라 KST 자정을 기준으로
  // 현재 진행 중인 일봉을 제외해야 Regime이 미래/미완료 데이터를 보지 않습니다.
  const KST = 9 * 60 * 60 * 1000;
  const kd = new Date(Number(asOf) + KST);
  const cutoff = Date.UTC(kd.getUTCFullYear(), kd.getUTCMonth(), kd.getUTCDate()) - KST;
  return raw.filter(x => x[0] < cutoff).slice(-limit);
}

const closes = k => k.map(x => Number(x[4]));
const volumes = k => k.map(x => Number(x[5]));
const pct = (a, b) => b ? (a / b - 1) * 100 : 0;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const clampInt = (x, a, b) => Math.max(a, Math.min(b, Math.trunc(x)));
const rnd = (x, n = 2) => Number(Number(x).toFixed(n));
const numEnv = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;

function EMA(a, n) {
  if (!a.length) return 0;
  let e = a[0], m = 2 / (n + 1);
  for (let i = 1; i < a.length; i++) e = a[i] * m + e * (1 - m);
  return e;
}

function RSI(a, n = 14) {
  if (a.length < n + 1) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = a[i] - a[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  let ag = g / n, al = l / n;
  for (let i = n + 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    ag = (ag * (n - 1) + (d > 0 ? d : 0)) / n;
    al = (al * (n - 1) + (d < 0 ? -d : 0)) / n;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function ATR(k, n = 14) {
  if (k.length < n + 1) return 0;
  const tr = [];
  for (let i = 1; i < k.length; i++) {
    const h = Number(k[i][2]), lo = Number(k[i][3]), pc = Number(k[i - 1][4]);
    tr.push(Math.max(h - lo, Math.abs(h - pc), Math.abs(lo - pc)));
  }
  return tr.slice(-n).reduce((a, b) => a + b, 0) / n;
}

function closed15mCloses(k5, asOf) {
  const cutoff = Math.floor(asOf / FIFTEEN_MIN) * FIFTEEN_MIN;
  const byBucket = new Map();
  for (const row of k5) {
    if (row[0] >= cutoff) continue;
    const bucket = Math.floor(row[0] / FIFTEEN_MIN) * FIFTEEN_MIN;
    byBucket.set(bucket, Number(row[4]));
  }
  return [...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(x => x[1]);
}

// v8.2 Pattern Engine
// 사람의 눈으로 모양을 맞추는 대신 OHLCV 구조를 수치화합니다.
// 공개적으로 알려진 VCP/와이코프/고전 패턴의 핵심 개념만 사용하며 특정 유료 신호를 복제하지 않습니다.
function aggregateClosedCandles(k5, intervalMs, asOf) {
  const cutoff = Math.floor(asOf / intervalMs) * intervalMs;
  const m = new Map();
  for (const r of k5) {
    if (r[0] >= cutoff) continue;
    const b = Math.floor(r[0] / intervalMs) * intervalMs;
    let z = m.get(b);
    if (!z) z = [b, Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[5])];
    else { z[2] = Math.max(z[2], Number(r[2])); z[3] = Math.min(z[3], Number(r[3])); z[4] = Number(r[4]); z[5] += Number(r[5]); }
    m.set(b, z);
  }
  return [...m.values()].sort((a,b)=>a[0]-b[0]);
}

const avg = a => a.length ? a.reduce((x,y)=>x+Number(y),0)/a.length : 0;
function candleRangePct(r) { const c = Number(r?.[4]) || 0; return c ? (Number(r[2])-Number(r[3]))/c*100 : 0; }
function closeLocation(r) { const h=Number(r?.[2]), l=Number(r?.[3]), c=Number(r?.[4]); return h>l ? (c-l)/(h-l) : .5; }
function bodyPct(r) { const o=Number(r?.[1]), c=Number(r?.[4]); return c ? Math.abs(c-o)/c*100 : 0; }
function pivotPoints(k, side='low', width=2) {
  const out=[];
  for(let i=width;i<k.length-width;i++){
    const v=Number(k[i][side==='low'?3:2]); let ok=true;
    for(let j=i-width;j<=i+width;j++) if(j!==i){ const q=Number(k[j][side==='low'?3:2]); if(side==='low' ? q<=v : q>=v){ok=false;break;} }
    if(ok) out.push({i,v,time:k[i][0]});
  }
  return out;
}
function near(a,b,tol=.005){ return Number.isFinite(a)&&Number.isFinite(b)&&b!==0&&Math.abs(a/b-1)<=tol; }

function fibonacciFrame(candles, lookback=96, nearPct=.45) {
  const k = (candles || []).slice(-lookback);
  if (k.length < 20) return {ok:false, score:0, trend:'UNKNOWN', reason:'Fib 데이터 부족'};
  const price = Number(k.at(-1)?.[4]) || 0;
  const highs = k.map(x=>Number(x[2]));
  const lows = k.map(x=>Number(x[3]));
  const hi = Math.max(...highs), lo = Math.min(...lows), range = hi-lo;
  if (!(price>0 && range>0)) return {ok:false, score:0, trend:'UNKNOWN', reason:'Fib 범위 부족'};
  const hiIdx = highs.lastIndexOf(hi), loIdx = lows.lastIndexOf(lo);
  const e20 = EMA(closes(k),20), e50 = EMA(closes(k),50);
  const up = (e20 >= e50 && price >= e20) || hiIdx > loIdx;
  const ratios=[.382,.5,.618,.786];
  const retr = Object.fromEntries(ratios.map(r=>[String(r), up ? hi-range*r : lo+range*r]));
  let nearest = null;
  for (const r of ratios) { const level=retr[String(r)], dist=Math.abs(price/level-1)*100; if(!nearest||dist<nearest.dist) nearest={ratio:r,level,dist}; }
  const atrPct = price ? ATR(k)/price*100 : 0;
  const tolerance = Math.max(nearPct, atrPct*.22);
  const nearRetr = nearest && nearest.dist <= tolerance;
  const supportZone = up && nearRetr && nearest.ratio>=.5 && nearest.ratio<=.786;
  const extRatios=[1,1.272,1.618,2.0];
  const extensions = Object.fromEntries(extRatios.map(r=>[String(r), up ? hi+range*(r-1) : lo-range*(r-1)]));
  let extHit=null;
  if(up && price>=hi){ for(const r of extRatios.slice(1)) { if(price>=extensions[String(r)]) extHit=r; } }
  const extensionLevel = up && price>=hi ? (price>=extensions['1.618']?'1.618':price>=extensions['1.272']?'1.272':'1.000') : null;
  const overextended = !!extensionLevel && (extensionLevel==='1.618' || (extensionLevel==='1.272' && atrPct>0 && nearest?.dist>tolerance));
  let score=0;
  if (supportZone) score += nearest.ratio===.618 ? 8 : nearest.ratio===.5 ? 7 : 5;
  else if (nearRetr && nearest.ratio===.382) score += 3;
  if (up && price>e20 && e20>=e50) score += 2;
  if (up && price<retr['0.786'] && price>lo) score -= 4;
  if (overextended) score -= 7;
  if (!up && price<e20) score -= 3;
  return {ok:true,trend:up?'UP':'DOWN',high:hi,low:lo,range,highIndex:hiIdx,lowIndex:loIdx,retracement:retr,nearestRatio:nearest?.ratio??null,nearestLevel:nearest?.level??null,nearestDistPct:nearest?.dist??null,tolerancePct:tolerance,nearRetracement:!!nearRetr,supportZone:!!supportZone,extensions,extensionLevel,overextended,score:clamp(score,-10,10),atrPct};
}

function analyzeFibonacci(k5, asOf, cfg={}) {
  if (cfg.fibonacciEngine === false) return {enabled:false,score:0,trend:'OFF',cluster:null,reason:'Fibonacci OFF'};
  const lookback=cfg.fibonacciLookback||96, nearPct=cfg.fibonacciNearPct||.45;
  const f5=fibonacciFrame(k5,lookback,nearPct);
  const k15=aggregateClosedCandles(k5,FIFTEEN_MIN,asOf);
  const k60=aggregateClosedCandles(k5,60*60*1000,asOf);
  const f15=fibonacciFrame(k15,Math.max(20,Math.floor(lookback/3)),nearPct*.9);
  const f60=fibonacciFrame(k60,Math.max(16,Math.floor(lookback/12)),nearPct*1.15);
  const frames=[f5,f15,f60].filter(x=>x?.ok);
  const clusterFrames=frames.filter(x=>x.nearRetracement&&x.nearestRatio>=.5&&x.nearestRatio<=.786);
  const cluster=clusterFrames.length>=2;
  const clusterRatios=clusterFrames.map(x=>x.nearestRatio);
  const avgRatio=clusterRatios.length?clusterRatios.reduce((a,b)=>a+b,0)/clusterRatios.length:null;
  let score=f5.score+(cluster?3:0);
  if(f5.overextended) score-=2;
  return {enabled:true,score:clamp(score,-10,10),trend:f5.trend,lookback,nearPct,frames:{m5:f5,m15:f15,h1:f60},cluster,clusterCount:clusterFrames.length,clusterRatio:avgRatio,reason:cluster?`Fib Cluster ${clusterFrames.length}개 TF`:f5.nearRetracement?`Fib ${f5.nearestRatio} 지지/저항 근접`:f5.extensionLevel?`Fib Extension ${f5.extensionLevel}`:'Fib 기준점 대기'};
}

function analyzePatterns(k5, asOf) {
  const k = k5.slice(-90);
  if (k.length < 40) return { score:0, bullishConfirmed:false, bearishConfirmed:false, label:'데이터 부족', reasons:[], trend15:'FLAT', setups:[] };
  const cur=k.at(-1), prev=k.slice(0,-1), p=closes(k), v=volumes(k);
  const price=Number(cur[4]), vr=avg(v.slice(-21,-1)) ? Number(cur[5])/avg(v.slice(-21,-1)) : 1;
  const atrPct=price?ATR(k)/price*100:0;
  const k15=aggregateClosedCandles(k5,FIFTEEN_MIN,asOf), p15=closes(k15);
  const trend15 = p15.length>=12 ? (EMA(p15,5)>EMA(p15,12)&&p15.at(-1)>p15.at(-4)?'UP':EMA(p15,5)<EMA(p15,12)&&p15.at(-1)<p15.at(-4)?'DOWN':'FLAT') : 'FLAT';
  const adds=[];
  const add=(name,score,reason,confirmed=true)=>adds.push({name,score,reason,confirmed});

  const base20=prev.slice(-20), highs20=base20.map(x=>Number(x[2])), lows20=base20.map(x=>Number(x[3]));
  const resistance=Math.max(...highs20), support=Math.min(...lows20);
  const breakout = price > resistance*1.0005 && closeLocation(cur)>=.62 && vr>=1.12;
  const breakdown = price < support*.9995 && closeLocation(cur)<=.38 && vr>=1.12;
  if(breakout) add('거래범위 돌파',3,`20봉 저항 돌파·Vol ${rnd(vr)}x`);
  if(breakdown) add('거래범위 하향이탈',-3,`20봉 지지 이탈·Vol ${rnd(vr)}x`);

  // 돌파 후 되돌림(retest/throwback): 과거 저항을 지지로 재확인한 경우.
  const older=prev.slice(-30,-6), recent=prev.slice(-6);
  if(older.length>=16){
    const lvl=Math.max(...older.map(x=>Number(x[2])));
    const hadBreak=recent.some(x=>Number(x[4])>lvl*1.0005);
    if(hadBreak && Number(cur[3])<=lvl*1.0035 && price>=lvl*.9995 && closeLocation(cur)>.55) add('돌파 리테스트',4,'이전 저항을 지지로 재확인');
  }

  // Wyckoff spring / upthrust: 지지·저항을 잠시 넘었다가 범위 안으로 복귀.
  const lowerWick=Math.min(Number(cur[1]),price)-Number(cur[3]);
  const upperWick=Number(cur[2])-Math.max(Number(cur[1]),price);
  const body=Math.abs(price-Number(cur[1])) || price*.0001;
  if(Number(cur[3])<support*.998 && price>support && lowerWick>body*1.2 && vr>=1.05) add('Wyckoff Spring',3,'지지 하회 후 범위 복귀·매수 반전');
  if(Number(cur[2])>resistance*1.002 && price<resistance && upperWick>body*1.2 && vr>=1.05) add('Failed Breakout / Upthrust',-5,'저항 상회 후 종가 재진입·불트랩');

  // Triangle / rectangle: 상단·하단의 평탄도와 저점/고점 진행 방향을 수치화.
  const tri=prev.slice(-24);
  if(tri.length>=20){
    const hs=tri.map(x=>Number(x[2])), ls=tri.map(x=>Number(x[3]));
    const top4=[...hs].sort((a,b)=>b-a).slice(0,4), bot4=[...ls].sort((a,b)=>a-b).slice(0,4);
    const top=avg(top4), bot=avg(bot4);
    const flatTop=(Math.max(...top4)-Math.min(...top4))/top<=.0045;
    const flatBot=(Math.max(...bot4)-Math.min(...bot4))/bot<=.0045;
    const half=Math.floor(ls.length/2), lowRise=Math.min(...ls.slice(half))/Math.min(...ls.slice(0,half))-1;
    const highFall=Math.max(...hs.slice(half))/Math.max(...hs.slice(0,half))-1;
    if(flatTop && lowRise>.002 && price>top*1.0005 && vr>=1.10) add('상승 삼각형',3,'평탄 저항+Higher Low+거래량 돌파');
    if(flatBot && highFall<-.002 && price<bot*.9995 && vr>=1.10) add('하락 삼각형',-4,'평탄 지지+Lower High+거래량 이탈');
    const boxWidth=(top/bot-1)*100;
    if(flatTop&&flatBot&&boxWidth>=.5&&boxWidth<=3.5){
      if(price>top*1.0005&&vr>=1.10)add('Flat Base / Rectangle',3,'박스 상단 종가 돌파');
      if(price<bot*.9995&&vr>=1.10)add('Rectangle Breakdown',-3,'박스 하단 종가 이탈');
    }
  }

  // Double bottom / top + neckline confirmation.
  const pivL=pivotPoints(prev.slice(-40),'low',2), pivH=pivotPoints(prev.slice(-40),'high',2);
  if(pivL.length>=2){
    const a=pivL.at(-2), b=pivL.at(-1);
    if(b.i-a.i>=5 && near(a.v,b.v,.007)){
      const seg=prev.slice(-40+a.i,-40+b.i+1); const neck=seg.length?Math.max(...seg.map(x=>Number(x[2]))):NaN;
      if(Number.isFinite(neck)&&price>neck*1.0005&&vr>=1.08)add('Double Bottom',3,'W바닥 neckline 종가 돌파');
    }
  }
  if(pivH.length>=2){
    const a=pivH.at(-2), b=pivH.at(-1);
    if(b.i-a.i>=5 && near(a.v,b.v,.007)){
      const seg=prev.slice(-40+a.i,-40+b.i+1); const neck=seg.length?Math.min(...seg.map(x=>Number(x[3]))):NaN;
      if(Number.isFinite(neck)&&price<neck*.9995&&vr>=1.08)add('Double Top',-4,'M천장 neckline 종가 이탈');
    }
  }

  // VCP-inspired contraction: 3구간 변동폭/거래량 수축 뒤 피벗 돌파.
  const vcp=prev.slice(-30);
  if(vcp.length===30){
    const segs=[vcp.slice(0,10),vcp.slice(10,20),vcp.slice(20,30)];
    const rg=segs.map(z=>avg(z.map(candleRangePct))), vv=segs.map(z=>avg(z.map(x=>Number(x[5]))));
    const contraction=rg[0]>rg[1]*1.08&&rg[1]>rg[2]*1.05;
    const volDry=vv[0]>vv[1]*1.04&&vv[1]>vv[2]*1.01;
    const pivot=Math.max(...vcp.slice(-10).map(x=>Number(x[2])));
    if(contraction&&volDry&&price>pivot*1.0005&&vr>=1.12)add('VCP 돌파',4,`변동폭·거래량 수축 후 피벗 돌파`);
  }

  // Flag continuation: 강한 impulse 후 얕은 반대방향 정리와 재돌파.
  const flag=prev.slice(-16);
  if(flag.length===16){
    const impulseStart=Number(flag[0][4]), impulseEnd=Number(flag[7][4]), impulsePct=pct(impulseEnd,impulseStart);
    const cons=flag.slice(8), consHigh=Math.max(...cons.map(x=>Number(x[2]))), consLow=Math.min(...cons.map(x=>Number(x[3])));
    const consVol=avg(cons.map(x=>Number(x[5]))), impulseVol=avg(flag.slice(0,8).map(x=>Number(x[5])));
    if(impulsePct>Math.max(.8,atrPct*2.5) && (consHigh/consLow-1)<.018 && consVol<impulseVol*.9 && price>consHigh*1.0005 && vr>=1.08)add('Bull Flag',3,'강한 상승→저거래량 조정→재돌파');
    if(impulsePct<-Math.max(.8,atrPct*2.5) && (consHigh/consLow-1)<.018 && consVol<impulseVol*.9 && price<consLow*.9995 && vr>=1.08)add('Bear Flag',-4,'강한 하락→저거래량 반등→재이탈');
  }

  // 15분 구조는 독립 확인 필터. 5분 패턴의 잡음을 줄이기 위해 점수는 작게 둡니다.
  if(trend15==='UP') add('15m Market Structure',1,'15분 EMA/종가 구조 상승',false);
  if(trend15==='DOWN') add('15m Market Structure',-2,'15분 EMA/종가 구조 하락',false);

  const raw=adds.reduce((a,x)=>a+x.score,0), score=clamp(raw,-8,8);
  const bullish=adds.filter(x=>x.confirmed&&x.score>0), bearish=adds.filter(x=>x.confirmed&&x.score<0);
  const strongest=[...adds].sort((a,b)=>Math.abs(b.score)-Math.abs(a.score))[0];
  return {
    score:rnd(score), rawScore:rnd(raw), bullishConfirmed:bullish.length>0, bearishConfirmed:bearish.length>0,
    trend15, label:strongest?.name||'확정 패턴 없음', reasons:adds.sort((a,b)=>Math.abs(b.score)-Math.abs(a.score)).slice(0,4).map(x=>`${x.name} ${x.score>0?'+':''}${x.score}: ${x.reason}`),
    setups:adds.map(x=>({name:x.name,score:x.score,confirmed:x.confirmed})), resistance:rnd(resistance,8), support:rnd(support,8), volRatio:rnd(vr), atrPct:rnd(atrPct,3)
  };
}

function analyzeMarketRegime(daily) {
  const d = (daily || []).slice(-200);
  if (d.length < 60) return { state:'RANGE', score:0, confidence:20, reasons:['장기 일봉 데이터 부족'], dataPoints:d.length, ret30:null, ret90:null, drawdown90:null, rsiDaily:null };
  const p = closes(d), price = p.at(-1);
  const e20 = EMA(p,20), e50 = EMA(p,50), e200 = d.length >= 180 ? EMA(p, Math.min(200,p.length)) : null;
  const rsi = RSI(p,14);
  const ret30 = p.length > 30 ? pct(price,p.at(-31)) : null;
  const ret90 = p.length > 90 ? pct(price,p.at(-91)) : null;
  const high90 = Math.max(...p.slice(-Math.min(90,p.length)));
  const drawdown90 = high90 ? (price/high90-1)*100 : 0;
  const atrDailyPct = price ? ATR(d,14)/price*100 : 0;
  const e20Prev = p.length > 10 ? EMA(p.slice(0,-10),20) : e20;
  const e50Prev = p.length > 10 ? EMA(p.slice(0,-10),50) : e50;
  let score=0; const reasons=[];

  if (e200) {
    if (price > e200) { score += 18; reasons.push('BTC 일봉 가격 > 200EMA'); }
    else { score -= 18; reasons.push('BTC 일봉 가격 < 200EMA'); }
    if (e50 > e200) { score += 14; reasons.push('50EMA > 200EMA'); }
    else { score -= 14; reasons.push('50EMA < 200EMA'); }
  }
  if (price > e50) { score += 10; reasons.push('가격 > 50EMA'); } else { score -= 10; reasons.push('가격 < 50EMA'); }
  if (e20 > e50) { score += 8; reasons.push('20EMA > 50EMA'); } else { score -= 8; reasons.push('20EMA < 50EMA'); }
  if (e20 > e20Prev) score += 5; else score -= 5;
  if (e50 > e50Prev) score += 4; else score -= 4;

  if (ret30 != null) {
    if (ret30 >= 12) { score += 10; reasons.push(`30일 +${rnd(ret30,1)}%`); }
    else if (ret30 >= 4) score += 5;
    else if (ret30 <= -12) { score -= 10; reasons.push(`30일 ${rnd(ret30,1)}%`); }
    else if (ret30 <= -4) score -= 5;
  }
  if (ret90 != null) {
    if (ret90 >= 25) { score += 10; reasons.push(`90일 +${rnd(ret90,1)}%`); }
    else if (ret90 >= 8) score += 5;
    else if (ret90 <= -25) { score -= 10; reasons.push(`90일 ${rnd(ret90,1)}%`); }
    else if (ret90 <= -8) score -= 5;
  }
  if (drawdown90 >= -8) score += 6;
  else if (drawdown90 <= -25) { score -= 12; reasons.push(`90일 고점 대비 ${rnd(drawdown90,1)}%`); }
  else if (drawdown90 <= -15) { score -= 7; reasons.push(`90일 고점 대비 ${rnd(drawdown90,1)}%`); }
  if (rsi >= 55 && rsi <= 72) score += 5;
  else if (rsi < 42) { score -= 6; reasons.push(`일봉 RSI ${rnd(rsi,1)}`); }
  else if (rsi > 80) score -= 3;

  score = clamp(score,-100,100);
  // EMA가 단순히 위에 있다는 이유만으로 횡보장을 강한 상승장으로 오인하지 않도록
  // 실제 30/90일 방향성과 drawdown을 Regime 확정 조건에 함께 사용합니다.
  const quiet30 = ret30 != null && Math.abs(ret30) < 2;
  const quiet90 = ret90 != null && Math.abs(ret90) < 5;
  if (quiet30 && quiet90) score = clamp(score,-15,15);
  const bullMomentum = (ret30 >= 2.5 || ret90 >= 6) && price > e50 && (!e200 || price > e200);
  const strongBullMomentum = (ret30 >= 8 || ret90 >= 20) && e20 > e50 && (!e200 || e50 > e200);
  const bearMomentum = (ret30 <= -2.5 || ret90 <= -6 || drawdown90 <= -15) && price < e50;
  const crashMomentum = (ret30 <= -12 || ret90 <= -25 || drawdown90 <= -25) && price < e50 && (!e200 || price < e200);
  let state = 'RANGE';
  if (score >= 50 && strongBullMomentum) state='STRONG_BULL';
  else if (score >= 18 && bullMomentum) state='BULL';
  else if (score <= -50 && crashMomentum) state='CRASH';
  else if (score <= -18 && bearMomentum) state='BEAR';
  const confidence = clamp(Math.abs(score)*0.75 + Math.min(25,d.length/8),20,100);
  return {
    state, score:rnd(score), confidence:rnd(confidence), dataPoints:d.length,
    price:rnd(price,8), ema20:rnd(e20,8), ema50:rnd(e50,8), ema200:e200?rnd(e200,8):null,
    ret30:ret30==null?null:rnd(ret30,2), ret90:ret90==null?null:rnd(ret90,2), drawdown90:rnd(drawdown90,2),
    rsiDaily:rnd(rsi,1), atrDailyPct:rnd(atrDailyPct,2), reasons:reasons.slice(0,7)
  };
}

function tradePlanFor(regimeState, atrPct, cfg) {
  const a = clamp(Number(atrPct)||0.25,0.18,2.5);
  const state = regimeState || 'RANGE';
  let slPct,tp1Pct,tp2Pct,trailPct,partialPct,horizonHours;
  if (state === 'STRONG_BULL') {
    slPct=clamp(Math.max(cfg.stopLossPct*1.45,a*2.2),1.05,3.2);
    tp1Pct=clamp(Math.max(cfg.tp1Pct*1.65,a*3.4),1.8,5.2);
    tp2Pct=clamp(Math.max(cfg.tp2Pct*1.9,a*6.5),3.6,10);
    trailPct=clamp(Math.max(.95,a*2.1),.9,3.0); partialPct=.30; horizonHours=72;
  } else if (state === 'BULL') {
    slPct=clamp(Math.max(cfg.stopLossPct*1.25,a*1.9),.9,2.8);
    tp1Pct=clamp(Math.max(cfg.tp1Pct*1.35,a*2.8),1.5,4.2);
    tp2Pct=clamp(Math.max(cfg.tp2Pct*1.5,a*5.0),2.8,8.0);
    trailPct=clamp(Math.max(.75,a*1.7),.7,2.5); partialPct=.40; horizonHours=48;
  } else if (state === 'BEAR' || state === 'CRASH') {
    slPct=clamp(Math.max(.70,a*1.25),.7,1.8);
    tp1Pct=clamp(Math.max(1.0,a*1.8),1.0,2.8);
    tp2Pct=clamp(Math.max(1.8,a*3.0),1.8,4.5);
    trailPct=clamp(Math.max(.45,a*1.0),.45,1.5); partialPct=.60; horizonHours=12;
  } else {
    slPct=clamp(Math.max(cfg.stopLossPct,a*1.5),.8,2.2);
    tp1Pct=clamp(Math.max(cfg.tp1Pct,a*2.2),1.2,3.2);
    tp2Pct=clamp(Math.max(cfg.tp2Pct,a*3.8),2.2,5.5);
    trailPct=clamp(Math.max(.60,a*1.35),.6,1.9); partialPct=.50; horizonHours=24;
  }
  return { state, slPct:rnd(slPct,2), tp1Pct:rnd(tp1Pct,2), tp2Pct:rnd(tp2Pct,2), trailPct:rnd(trailPct,2), partialPct:rnd(partialPct,2), horizonHours };
}

function regimeBuyPolicy(state,cfg) {
  if (!cfg.regimeEngine) return {allowed:true,minScore:cfg.minScore,minPattern:cfg.patternBuyMinScore,require15Up:false,label:'REGIME_OFF'};
  if (state==='STRONG_BULL') return {allowed:true,minScore:cfg.minScore,minPattern:cfg.patternBuyMinScore,require15Up:false,label:'강한 상승장'};
  if (state==='BULL') return {allowed:true,minScore:cfg.minScore,minPattern:Math.max(cfg.patternBuyMinScore,2),require15Up:false,label:'상승장'};
  // v8.3.1: 90일 검증에서 RANGE PF 0.54 / 기대값 -0.335%가 확인되어 신규 BUY를 차단합니다.
  // 분석/WATCH는 계속 표시하지만 Telegram BUY는 보내지 않습니다.
  if (state==='RANGE') return {allowed:false,minScore:100,minPattern:99,require15Up:true,label:'횡보장·신규 BUY 차단'};
  return {allowed:false,minScore:100,minPattern:99,require15Up:true,label:state==='CRASH'?'급락장·신규 BUY 차단':'하락장·신규 BUY 차단'};
}

function strategyConfig(env) {
  return {
    minScore: numEnv(env.MIN_SCORE, 75),
    tp1Pct: numEnv(env.TP1_PERCENT, 1.2),
    tp2Pct: numEnv(env.TP2_PERCENT, 2.2),
    stopLossPct: numEnv(env.STOP_LOSS_PERCENT, 0.8),
    buyCooldownMin: numEnv(env.BUY_COOLDOWN_MINUTES ?? env.COOLDOWN_MINUTES, 20),
    sellCooldownMin: numEnv(env.SELL_COOLDOWN_MINUTES, 60),
    maxBuyAlerts: clampInt(numEnv(env.MAX_BUY_ALERTS, 2), 1, 10),
    contextBlockThreshold: numEnv(env.CONTEXT_BLOCK_THRESHOLD, -8),
    contextSellThreshold: numEnv(env.CONTEXT_SELL_THRESHOLD, -12),
    patternConfirmation: String(env.PATTERN_CONFIRMATION ?? 'true').toLowerCase() !== 'false',
    patternBuyMinScore: numEnv(env.PATTERN_BUY_MIN_SCORE, 2),
    patternSellScore: numEnv(env.PATTERN_SELL_SCORE, -4),
    regimeEngine: String(env.REGIME_ENGINE ?? 'true').toLowerCase() !== 'false',
    fibonacciEngine: String(env.FIBONACCI_ENGINE ?? 'true').toLowerCase() !== 'false',
    fibonacciLookback: clampInt(numEnv(env.FIBONACCI_LOOKBACK, 96), 40, 160),
    fibonacciNearPct: clamp(numEnv(env.FIBONACCI_NEAR_PCT, 0.45), 0.15, 1.2),
    tradingFeePct: numEnv(env.TRADING_FEE_PERCENT, 0.05)
  };
}

function evaluateSignal(symbol, k5, b5, asOf, cfg, external = null, marketRegime = null) {
  if (k5.length < 60 || b5.length < 60) throw new Error('5분봉 데이터가 부족합니다.');
  const expectedStart = Math.floor(asOf / FIVE_MIN) * FIVE_MIN - FIVE_MIN;
  const altLast = k5.at(-1)?.[0];
  const btcLast = b5.at(-1)?.[0];
  if (altLast !== expectedStart) return { symbol, signal: 'STALE', stale: true, error: '최신 완료 5분봉이 없어 신호를 건너뜁니다.', candleStart: altLast ?? null };
  if (btcLast !== expectedStart) throw new Error('BTC 최신 완료 5분봉이 없습니다.');

  const p = closes(k5), v = volumes(k5), bp = closes(b5);
  const p15 = closed15mCloses(k5, asOf), bp15 = closed15mCloses(b5, asOf);
  const price = p.at(-1), e9 = EMA(p, 9), e20 = EMA(p, 20), e50 = EMA(p, 50);
  const be20 = EMA(bp, 20);
  const e20Prev = EMA(p.slice(0, -5), 20), be20Prev = EMA(bp.slice(0, -5), 20);
  const r = RSI(p), br = RSI(bp), r15 = RSI(p15), br15 = RSI(bp15);
  const relR = r - br, ret = pct(price, p.at(-2)), bret = pct(bp.at(-1), bp.at(-2)), relRet = ret - bret;
  const av = v.slice(-21, -1).reduce((a, x) => a + x, 0) / 20;
  const vr = av ? v.at(-1) / av : 1;
  const recentHigh = Math.max(...k5.slice(-21, -1).map(x => Number(x[2])));
  const breakout = price >= recentHigh * 0.9995;
  const atrPct = price ? ATR(k5) / price * 100 : 0;
  const slope5 = pct(e20, e20Prev), btcSlope = pct(be20, be20Prev);
  const pattern = analyzePatterns(k5, asOf);
  const fibonacci = analyzeFibonacci(k5, asOf, cfg);
  const relR15 = r15 - br15;
  const extensionPct = e20 ? pct(price, e20) : 0;
  const extensionAtr = atrPct > 0 ? Math.max(0, extensionPct) / atrPct : 0;
  const impulseRet2 = p.length > 2 ? pct(price, p.at(-3)) : ret;
  // v8.3.1 Anti-Chase: 이미 크게 뻗은 봉/EMA 이격에서는 좋은 점수여도 재돌파·리테스트를 기다립니다.
  const antiChase = (extensionAtr >= 2.6 && r >= 64)
    || (ret >= Math.max(.75, atrPct * 2.0) && vr >= 1.8)
    || (impulseRet2 >= Math.max(1.4, atrPct * 3.5) && r >= 68);
  // BTC보다 15분 상대강도가 뒤처지거나 중기 EMA가 크게 역배열인 알트는 상승장이어도 추격하지 않습니다.
  const altQualityGate = relR15 >= 0 && e20 >= e50 * .995;

  let score = 0;
  const reasons = [];
  score += clamp((relR - 2) * 2.2, 0, 22); if (relR >= 5) reasons.push(`RSI 상대강도 +${rnd(relR)}p`);
  if (e9 > e20) { score += 12; reasons.push('단기 추세 상승'); }
  if (e20 > e50) { score += 8; reasons.push('중기 추세 상승'); }
  if (r15 > br15) { score += 10; reasons.push('15m 상대강도 우위'); }
  score += clamp(relRet * 3, 0, 16); if (relRet > 0.35) reasons.push(`5m 상대모멘텀 +${rnd(relRet)}%`);
  score += clamp((vr - 1) * 25, 0, 14); if (vr >= 1.15) reasons.push(`거래량 ${rnd(vr)}x`);
  if (breakout) { score += 10; reasons.push('최근 20봉 고가 돌파'); }
  if (r >= 52 && r <= 72) score += 8; else if (r > 76) { score -= 10; reasons.push('RSI 과열'); }
  if (atrPct < 0.25) { score -= 6; reasons.push('변동성 부족'); }
  if (slope5 > 0) score += 2;
  if (btcSlope > 0) score += 2;
  score = clamp(score, 0, 100);

  // v8.3.1: 단기 약세와 진짜 급락을 분리합니다. 상승장에서 단순 Risk-Off 한 번으로 긴급 SELL하지 않습니다.
  const legacyCrash = bret <= -0.9 || br < 40 || bp.at(-1) < be20 * 0.995;
  const hardCrash = bret <= -1.35 || (br < 30 && bret <= -0.6) || bp.at(-1) < be20 * 0.985;
  const softBtcRisk = legacyCrash && !hardCrash;
  const shortRegime = br >= 48 && br <= 68 && bp.at(-1) > be20 ? 'RISK_ON' : 'RISK_OFF';
  const mr = marketRegime || { state:'RANGE', score:0, confidence:0, reasons:[] };
  const policy = regimeBuyPolicy(mr.state,cfg);
  const techScore = score;
  const patternScore = Number(pattern.score) || 0;
  const contextScore = clamp(Number(external?.total) || 0, -20, 20);
  const regimeContribution = clamp((Number(mr.score)||0) / 10, -8, 8);
  const fibScore = Number(fibonacci.score) || 0;
  const adjustedScore = clamp(techScore + patternScore + contextScore + regimeContribution + fibScore, 0, 100);
  const contextBlocked = contextScore <= cfg.contextBlockThreshold || !!external?.severeRisk;
  const patternGate = !cfg.patternConfirmation || (pattern.bullishConfirmed && patternScore >= policy.minPattern && pattern.trend15 !== 'DOWN' && !pattern.bearishConfirmed);
  const regimeGate = policy.allowed && (!policy.require15Up || pattern.trend15 === 'UP');
  const fibGate = !fibonacci.enabled || (!fibonacci.overextended && fibScore >= -2);
  // v10 Fibonacci Confluence Gate: Fib는 단독 BUY가 아니라 추격/과열 필터와 보조 점수로만 사용합니다.
  // v8.3.1 Quality Gate: RANGE 차단 + 알트 상대강도 + 추격진입 방지.
  const qualityGate = altQualityGate && !antiChase;
  const hardTech = techScore >= policy.minScore && shortRegime === 'RISK_ON' && r >= 52 && r <= 72 && relR >= 5 && e9 > e20 && vr >= 1.15 && relRet > 0 && !hardCrash;
  const hard = hardTech && patternGate && regimeGate && qualityGate && fibGate && !contextBlocked;
  const signal = hard ? 'BUY' : (adjustedScore >= Math.max(60, cfg.minScore - 15) && !hardCrash ? 'WATCH' : 'IDLE');
  if (antiChase) reasons.push(`추격진입 대기 · EMA20 이격 ${rnd(extensionPct,2)}% / ${rnd(extensionAtr,1)} ATR`);
  if (fibonacci.reason) reasons.push(`Fibonacci · ${fibonacci.reason}${fibonacci.score>=0?' +':''}${rnd(fibonacci.score,1)}`);
  if (fibonacci.overextended) reasons.push('Fibonacci 과확장 · 추격 BUY 억제');
  if (!altQualityGate) reasons.push(`알트 상대강도 부족 · 15m RSI-BTC ${rnd(relR15)}p`);
  if (!policy.allowed) reasons.push(policy.label);
  const contextDataPenalty = clamp(Number(external?.confidencePenalty)||0, 0, 15);
  const regimeConfidenceAdj = mr.state==='STRONG_BULL'?10:mr.state==='BULL'?6:mr.state==='RANGE'?0:mr.state==='BEAR'?-10:-18;
  const confidence = clamp(techScore * 0.60 + patternScore * 2.6 + contextScore * 1.0 + regimeContribution * 2 + regimeConfidenceAdj + (shortRegime === 'RISK_ON' ? 6 : -5) + (r15 > br15 ? 4 : 0) + (pattern.trend15 === 'UP' ? 4 : pattern.trend15 === 'DOWN' ? -6 : 0) - contextDataPenalty, 0, 100);
  const risk = hardCrash || softBtcRisk || mr.state==='CRASH' || mr.state==='BEAR' || r > 76 || contextScore <= -8 || external?.severeRisk || pattern.bearishConfirmed || patternScore <= cfg.patternSellScore ? 'HIGH' : confidence >= 82 ? 'LOW' : 'MEDIUM';
  const tradePlan = tradePlanFor(mr.state, atrPct, cfg);

  return {
    symbol,
    market: marketOf(symbol),
    quote: 'KRW',
    candleStart: expectedStart,
    price,
    btcPrice: bp.at(-1),
    score: rnd(techScore),
    adjustedScore: rnd(adjustedScore),
    patternScore: rnd(patternScore),
    patternLabel: pattern.label,
    patternTrend15: pattern.trend15,
    patternBullish: pattern.bullishConfirmed,
    patternBearish: pattern.bearishConfirmed,
    patternReasons: pattern.reasons,
    pattern,
    fibonacci,
    fibonacciScore: rnd(fibScore,1),
    fibonacciCluster: !!fibonacci.cluster,
    fibonacciNearestRatio: fibonacci.frames?.m5?.nearestRatio ?? null,
    fibonacciNearestLevel: fibonacci.frames?.m5?.nearestLevel ?? null,
    fibonacciExtension: fibonacci.frames?.m5?.extensionLevel ?? null,
    fibonacciOverextended: !!fibonacci.overextended,
    fibonacciTp1272: fibonacci.frames?.m5?.extensions?.['1.272'] ?? null,
    fibonacciTp1618: fibonacci.frames?.m5?.extensions?.['1.618'] ?? null,
    contextScore: rnd(contextScore),
    context: external || null,
    contextBlocked,
    contextDataPenalty: rnd(contextDataPenalty,1),
    regimeContribution:rnd(regimeContribution,1),
    marketRegime: mr.state,
    marketRegimeScore: rnd(Number(mr.score)||0),
    marketRegimeConfidence: rnd(Number(mr.confidence)||0),
    marketRegimeReasons: mr.reasons || [],
    regimePolicy: policy,
    confidence: rnd(confidence),
    risk,
    signal,
    rsi: rnd(r),
    btcRsi: rnd(br),
    rsiRel: rnd(relR),
    rsi15: rnd(r15),
    btcRsi15: rnd(br15),
    ret5: rnd(ret),
    btcRet5: rnd(bret),
    relRet5: rnd(relRet),
    ema9: rnd(e9),
    ema20: rnd(e20),
    ema50: rnd(e50),
    ema20Slope5: rnd(slope5, 3),
    btcEma20Slope5: rnd(btcSlope, 3),
    volRatio: rnd(vr),
    breakout,
    atrPct: rnd(atrPct, 3),
    regime: shortRegime,
    btcCrash: hardCrash,
    btcSoftRisk: softBtcRisk,
    btcLegacyCrash: legacyCrash,
    antiChase,
    fibGate,
    altQualityGate,
    rsi15Rel: rnd(relR15),
    ema20ExtensionPct: rnd(extensionPct,3),
    extensionAtr: rnd(extensionAtr,2),
    tradePlan,
    tp1: price * (1 + tradePlan.tp1Pct / 100),
    tp2: price * (1 + tradePlan.tp2Pct / 100),
    sl: price * (1 - tradePlan.slPct / 100),
    reasons: reasons.slice(0, 6)
  };
}

function sellCheck(s, pos, cfg) {
  const entry = Number(pos?.entry) || 0;
  const gain = entry ? ((s.price / entry) - 1) * 100 : 0;
  const plan = pos?.riskPlan || s.tradePlan || tradePlanFor(s.marketRegime, s.atrPct, cfg);
  const state = s.marketRegime || 'RANGE';
  const entryState = String(pos?.marketRegimeAtEntry || plan?.state || 'UNKNOWN');
  const reasons = [];
  let severity = 'NORMAL';

  // 수동 포지션은 5분 완료봉 종가 기준으로 고점을 추적합니다.
  // intrabar 고가를 쓰지 않아 봉 안의 고가/저가 순서를 알 수 없는 문제를 피합니다.
  const priorPeak = Math.max(entry, Number(pos?.peakPrice) || entry);
  const peakPrice = Math.max(priorPeak, Number(s.price) || 0);
  const tp1Price = entry ? entry * (1 + Number(plan.tp1Pct || cfg.tp1Pct) / 100) : null;
  const tp2Price = entry ? entry * (1 + Number(plan.tp2Pct || cfg.tp2Pct) / 100) : null;
  const tp1Reached = !!pos?.tp1AlertedAt || (!!tp1Price && peakPrice >= tp1Price);
  const tp2Reached = !!pos?.tp2AlertedAt || (!!tp2Price && peakPrice >= tp2Price);
  const trailStop = tp1Reached && peakPrice
    ? Math.max(entry * (1 + (cfg.tradingFeePct * 2 + 0.03) / 100), peakPrice * (1 - Number(plan.trailPct || 0.8) / 100))
    : null;
  const ageHours = Number(pos?.addedAt) ? Math.max(0, (Date.now() - Number(pos.addedAt)) / 3600000) : 0;

  const hardStop = entry && s.price <= entry * (1 - Number(plan.slPct || cfg.stopLossPct) / 100);
  if (hardStop) { reasons.push(`변동성 손절선 -${plan.slPct}% 도달`); severity='EMERGENCY'; }
  if (s.btcCrash) { reasons.push('BTC 5분 급락/약세'); severity='EMERGENCY'; }
  if (state === 'CRASH') { reasons.push(`대세 국면 CRASH (${s.marketRegimeScore})`); severity='EMERGENCY'; }
  if (s.context?.severeRisk) { reasons.push('외부 이벤트 고위험 경보'); severity='EMERGENCY'; }

  // TP1 이후 Runner는 고점 대비 동적 Trail을 실제 SELL 검토에 사용합니다.
  if (!reasons.length && tp1Reached && trailStop && s.price <= trailStop) {
    reasons.push(`TP1 이후 Runner Trail 이탈 · 고점 ₩${fmt(peakPrice)} → 기준 ₩${fmt(trailStop)}`);
    severity='PROTECT';
  }

  const weakTrend = s.ema9 < s.ema20 && s.relRet5 < 0;
  const weakScore = s.score < 48 && s.ema9 < s.ema20;
  const bearPattern = s.patternBearish && Number(s.patternScore) <= cfg.patternSellScore;
  const down15 = s.patternTrend15 === 'DOWN';
  const shortRiskOff = s.regime === 'RISK_OFF';
  const reachedTp1 = tp1Reached || (entry && gain >= Number(plan.tp1Pct||cfg.tp1Pct));
  const weaknessCount = [weakTrend,weakScore,bearPattern,down15,shortRiskOff].filter(Boolean).length;

  if (!reasons.length) {
    if (state === 'STRONG_BULL') {
      // 강한 상승장에서는 작은 Risk-Off/눌림만으로 팔지 않습니다.
      if (bearPattern && down15 && weakTrend) reasons.push(`강한 상승장 추세 훼손: ${s.patternLabel}`);
      else if (reachedTp1 && weaknessCount >= 2) reasons.push(`수익 보호: TP1 이후 약화 ${weaknessCount}개 확인`);
    } else if (state === 'BULL') {
      if ((bearPattern && (down15 || weakTrend)) || (reachedTp1 && weaknessCount >= 2)) reasons.push('상승장 추세 약화 2중 확인');
      else if (weaknessCount >= 3) reasons.push('상승장 단기 약화 3중 확인');
    } else if (state === 'RANGE') {
      if (bearPattern) reasons.push(`하락 패턴 확인: ${s.patternLabel} (${s.patternScore})`);
      if (shortRiskOff && weakTrend) reasons.push('횡보장 BTC Risk-Off + 단기 추세 약화');
      if (weakScore) reasons.push('횡보장 Score/EMA 동시 약화');
      if (reachedTp1 && weaknessCount >= 1) reasons.push('횡보장 수익 보호');
    } else { // BEAR
      if (shortRiskOff || weakTrend || bearPattern || down15) reasons.push('하락장 보유 위험 확대');
      if (Number(s.contextScore) <= cfg.contextSellThreshold) reasons.push(`외부 컨텍스트 악화 ${s.contextScore}점`);
    }
  }

  // 진입 당시 상승장이 현재 하락장으로 전환됐으면 단기 신호가 잠시 버텨도 수동 재검토합니다.
  if (!reasons.length && ['STRONG_BULL','BULL'].includes(entryState) && ['BEAR','CRASH'].includes(state)) {
    reasons.push(`진입 국면 ${entryState} → 현재 ${state} 전환`);
    severity = state === 'CRASH' ? 'EMERGENCY' : 'STRONG';
  }

  // 최대 관찰시간은 강제 매도가 아니라 약화가 동반될 때만 SELL 검토 사유로 사용합니다.
  if (!reasons.length && ageHours >= Number(plan.horizonHours || 24)) {
    if (state === 'RANGE' && (gain <= 0 || weaknessCount >= 1)) reasons.push(`관찰 ${Math.round(ageHours)}h 경과 + 횡보/약화`);
    else if (state === 'BEAR') reasons.push(`관찰 ${Math.round(ageHours)}h 경과 + 하락장`);
    else if (['BULL','STRONG_BULL'].includes(state) && weaknessCount >= 2) reasons.push(`관찰 ${Math.round(ageHours)}h 경과 + 상승 탄력 약화`);
  }

  if (reasons.length && severity==='NORMAL') severity = reachedTp1 ? 'PROTECT' : (weaknessCount>=3 || state==='BEAR' ? 'STRONG' : 'NORMAL');

  // TP1/TP2는 전량 SELL 신호가 아니라 수동 부분익절/Runner 관리 알림입니다.
  // 같은 포지션에서 각 단계는 한 번만 알리도록 Cron이 KV 상태를 기록합니다.
  let milestone = null;
  if (!reasons.length) {
    if (tp2Reached && !pos?.tp2AlertedAt) milestone = 'TP2';
    else if (tp1Reached && !pos?.tp1AlertedAt) milestone = 'TP1';
  }

  return {
    sell: reasons.length > 0,
    gain: rnd(gain), reasons, severity, tradePlan:plan,
    peakPrice:rnd(peakPrice,8), trailStop:trailStop?rnd(trailStop,8):null,
    tp1Reached, tp2Reached, milestone, ageHours:rnd(ageHours,1), entryState
  };
}

async function getPositions(env) {
  if (!env.SCALPER_KV) return {};
  const raw = await env.SCALPER_KV.get(POS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) || {};
    const normalized = {};
    for (const [key, value] of Object.entries(parsed)) {
      const symbol = normalizeSymbol(key);
      if (COINS.includes(symbol)) normalized[symbol] = value;
    }
    return normalized;
  } catch { return {}; }
}

async function persistPositionLifecycle(env, updates) {
  if (!env.SCALPER_KV || !updates || !Object.keys(updates).length) return null;
  const latest = await getPositions(env);
  let changed = false;
  for (const [symbol, patch] of Object.entries(updates)) {
    const cur = latest[symbol];
    if (!cur) continue;
    // 사용자가 스캔 도중 포지션을 전량 매도/재등록한 경우 오래된 상태를 덮어쓰지 않습니다.
    if (patch.addedAt && Number(cur.addedAt) && Number(patch.addedAt) !== Number(cur.addedAt)) continue;
    const next = { ...cur };
    if (Number.isFinite(Number(patch.peakPrice)) && Number(patch.peakPrice) > Number(next.peakPrice || next.entry || 0)) next.peakPrice = Number(patch.peakPrice);
    if (patch.tp1AlertedAt && !next.tp1AlertedAt) next.tp1AlertedAt = Number(patch.tp1AlertedAt);
    if (patch.tp2AlertedAt && !next.tp2AlertedAt) next.tp2AlertedAt = Number(patch.tp2AlertedAt);
    if (Number.isFinite(Number(patch.lastTrailStop))) next.lastTrailStop = Number(patch.lastTrailStop);
    next.updatedAt = Date.now();
    latest[symbol] = next;
    changed = true;
  }
  if (changed) await env.SCALPER_KV.put(POS_KEY, JSON.stringify(latest));
  return changed ? latest : null;
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getTradeHistory(env) {
  if (!env.SCALPER_KV) return [];
  const raw = await env.SCALPER_KV.get(TRADE_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_TRADE_HISTORY) : [];
  } catch { return []; }
}

async function saveTradeHistory(env, history) {
  await env.SCALPER_KV.put(TRADE_HISTORY_KEY, JSON.stringify((history || []).slice(0, MAX_TRADE_HISTORY)));
}

function makeClosedTrade({ symbol, entry, exit, quantity, boughtAt = null, soldAt = Date.now(), source = 'manual', feePct = 0.05 }) {
  const buyAmount = entry * quantity;
  const sellAmount = exit * quantity;
  const buyFee = buyAmount * feePct / 100;
  const sellFee = sellAmount * feePct / 100;
  const grossPnl = sellAmount - buyAmount;
  const pnl = sellAmount - sellFee - buyAmount - buyFee;
  const pnlPct = (buyAmount + buyFee) ? pnl / (buyAmount + buyFee) * 100 : 0;
  return {
    id: `${soldAt}-${symbol}-${Math.random().toString(36).slice(2, 9)}`,
    symbol,
    entry: rnd(entry, 8),
    exit: rnd(exit, 8),
    quantity: rnd(quantity, 12),
    buyAmount: rnd(buyAmount, 4),
    sellAmount: rnd(sellAmount, 4),
    buyFee: rnd(buyFee, 4),
    sellFee: rnd(sellFee, 4),
    feePct: rnd(feePct, 4),
    grossPnl: rnd(grossPnl, 4),
    pnl: rnd(pnl, 4),
    pnlPct: rnd(pnlPct),
    boughtAt,
    soldAt,
    source
  };
}

function applyLivePositions(snapshot, positions, cfg) {
  const results = (snapshot?.results || []).map(row => {
    const s = { ...row };
    const pos = positions[s.symbol];
    if (!Number.isFinite(Number(s.score))) {
      s.held = !!pos;
      if (pos) { s.entry = pos.entry; s.quantity = pos.quantity ?? null; }
      return s;
    }
    if (pos) {
      const q = sellCheck(s, pos, cfg);
      s.held = true;
      s.entry = pos.entry;
      s.quantity = pos.quantity ?? null;
      s.gain = q.gain;
      s.sell = q.sell;
      s.sellReasons = q.reasons;
      s.sellSeverity = q.severity;
      s.activeTradePlan = q.tradePlan;
      s.peakPrice = q.peakPrice;
      s.trailStop = q.trailStop;
      s.tp1Reached = q.tp1Reached;
      s.tp2Reached = q.tp2Reached;
      s.positionAgeHours = q.ageHours;
    } else {
      s.held = false;
      s.entry = null;
      s.quantity = null;
      s.gain = null;
      s.sell = false;
      s.sellReasons = [];
    }
    return s;
  });
  return {
    ...snapshot,
    held: Object.keys(positions),
    positions,
    sellSignals: results.filter(x => x.sell).map(x => x.symbol),
    results
  };
}

async function buildLedger(env) {
  const feePct = strategyConfig(env).tradingFeePct;
  const [positions, history, raw] = await Promise.all([
    getPositions(env),
    getTradeHistory(env),
    env.SCALPER_KV.get(LAST_RESULT_KEY)
  ]);
  let latest = null;
  try { latest = raw ? JSON.parse(raw) : null; } catch {}
  const latestPrices = {};
  for (const row of latest?.results || []) {
    if (row?.symbol && Number.isFinite(Number(row.price))) latestPrices[row.symbol] = Number(row.price);
  }

  let openCost = 0, openValue = 0, unrealizedPnl = 0, knownOpen = 0, unknownQty = 0;
  const open = Object.entries(positions).map(([symbol, pos]) => {
    const entry = Number(pos.entry);
    const quantity = positiveNumber(pos.quantity);
    const current = positiveNumber(latestPrices[symbol]);
    const grossCost = quantity ? entry * quantity : null;
    const buyFee = grossCost != null ? grossCost * feePct / 100 : null;
    const cost = grossCost != null ? grossCost + buyFee : null;
    const grossValue = quantity && current ? current * quantity : null;
    const estimatedSellFee = grossValue != null ? grossValue * feePct / 100 : null;
    const value = grossValue != null ? grossValue - estimatedSellFee : null;
    const pnl = cost != null && value != null ? value - cost : null;
    const pnlPct = cost && pnl != null ? pnl / cost * 100 : null;
    if (cost != null && value != null) {
      openCost += cost; openValue += value; unrealizedPnl += pnl; knownOpen++;
    } else if (!quantity) unknownQty++;
    return {
      symbol,
      entry,
      quantity: quantity ?? null,
      addedAt: Number(pos.addedAt) || null,
      current: current ?? null,
      cost: cost == null ? null : rnd(cost, 4),
      value: value == null ? null : rnd(value, 4),
      buyFee: buyFee == null ? null : rnd(buyFee,4),
      estimatedSellFee: estimatedSellFee == null ? null : rnd(estimatedSellFee,4),
      pnl: pnl == null ? null : rnd(pnl, 4),
      pnlPct: pnlPct == null ? null : rnd(pnlPct),
      riskPlan: pos.riskPlan || null,
      marketRegimeAtEntry: pos.marketRegimeAtEntry || null,
      peakPrice: positiveNumber(pos.peakPrice) ?? entry,
      lastTrailStop: positiveNumber(pos.lastTrailStop) ?? null,
      tp1AlertedAt: Number(pos.tp1AlertedAt) || null,
      tp2AlertedAt: Number(pos.tp2AlertedAt) || null,
      positionAgeHours: Number(pos.addedAt) ? rnd(Math.max(0,(Date.now()-Number(pos.addedAt))/3600000),1) : null
    };
  });

  const realizedPnl = history.reduce((a, x) => a + (Number(x.pnl) || 0), 0);
  const realizedBuy = history.reduce((a, x) => a + (Number(x.buyAmount) || 0), 0);
  const realizedSell = history.reduce((a, x) => a + (Number(x.sellAmount) || 0), 0);
  const wins = history.filter(x => Number(x.pnl) > 0).length;
  return {
    positions,
    held: Object.keys(positions),
    open,
    history,
    latestPrices,
    summary: {
      openCount: open.length,
      knownOpen,
      unknownQty,
      openCost: rnd(openCost, 4),
      openValue: rnd(openValue, 4),
      unrealizedPnl: rnd(unrealizedPnl, 4),
      unrealizedPct: openCost ? rnd(unrealizedPnl / openCost * 100) : 0,
      realizedPnl: rnd(realizedPnl, 4),
      realizedBuy: rnd(realizedBuy, 4),
      realizedSell: rnd(realizedSell, 4),
      closedTrades: history.length,
      wins,
      winRate: history.length ? rnd(wins / history.length * 100) : 0
    },
    note: `장부 손익은 편도 수수료 ${feePct}%를 매수·매도 양쪽에 추정 반영합니다. 실제 체결 수수료와 차이가 날 수 있습니다.`
  };
}


function normalizeContextScope(value) {
  const s = normalizeSymbol(value || 'GLOBAL');
  return COINS.includes(s) ? s : 'GLOBAL';
}

async function getManualEvents(env, clean = true) {
  if (!env.SCALPER_KV) return [];
  let rows = [];
  try { rows = JSON.parse((await env.SCALPER_KV.get(MANUAL_EVENTS_KEY)) || '[]'); } catch {}
  if (!Array.isArray(rows)) rows = [];
  if (!clean) return rows;
  const now = Date.now();
  const live = rows.filter(x => !Number(x.expiresAt) || Number(x.expiresAt) > now).slice(0, 100);
  if (live.length !== rows.length) await env.SCALPER_KV.put(MANUAL_EVENTS_KEY, JSON.stringify(live));
  return live;
}

async function getPredictionConfig(env) {
  if (!env.SCALPER_KV) return [];
  try {
    const rows = JSON.parse((await env.SCALPER_KV.get(PREDICTION_CONFIG_KEY)) || '[]');
    return Array.isArray(rows) ? rows.slice(0, 20) : [];
  } catch { return []; }
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0,10);
}


const LIQUIDITY_CACHE_KEY = 'liquidity-radar:v1';
const LIQUIDITY_HISTORY_KEY = 'liquidity-radar-history:v1';
const LIQUIDITY_CACHE_TTL = 5 * 60;

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

async function fetchJsonPublic(url, timeoutMs = 8000) {
  const r = await fetchWithTimeout(url, {
    headers: { 'accept': 'application/json', 'user-agent': 'BTC-ALT-Scalper-Liquidity-Radar/1.0' }
  }, timeoutMs);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return await r.json();
}

function parseStablecoinTotal(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) {
    const x = payload.at(-1);
    return safeNum(x?.totalCirculatingUSD ?? x?.totalCirculatingUSD?.peggedUSD ?? x?.totalCirculatingUSD);
  }
  const c = payload.totalCirculatingUSD;
  if (typeof c === 'number') return c;
  if (c && typeof c === 'object') {
    const vals = Object.values(c).map(Number).filter(Number.isFinite);
    return vals.length ? vals.reduce((a,b)=>a+b,0) : null;
  }
  return safeNum(payload.totalCirculating);
}

function pctChange(now, prev) {
  return Number.isFinite(now) && Number.isFinite(prev) && prev !== 0 ? (now / prev - 1) * 100 : null;
}

function signalState(v) {
  if (v > 0.55) return 'UP';
  if (v < 0.45) return 'DOWN';
  return 'NEUTRAL';
}

function scoreLiquidity(parts) {
  // Each component is -1 / 0 / +1. Display score is 0~100.
  const vals = parts.map(x => Number(x.score) || 0);
  const raw = vals.reduce((a,b)=>a+b,0);
  return Math.round(50 + (raw / Math.max(1, vals.length)) * 50);
}


const MARKET_RADAR_COINS = [
  ['BTC','비트코인','KRW-BTC','BTCUSDT'],['ETH','이더리움','KRW-ETH','ETHUSDT'],['SOL','솔라나','KRW-SOL','SOLUSDT'],
  ['XRP','엑스알피','KRW-XRP','XRPUSDT'],['HBAR','헤데라','KRW-HBAR','HBARUSDT'],['ONDO','온도파이낸스','KRW-ONDO','ONDOUSDT'],
  ['LINK','체인링크','KRW-LINK','LINKUSDT'],['AVAX','아발란체','KRW-AVAX','AVAXUSDT'],['DOGE','도지코인','KRW-DOGE','DOGEUSDT'],
  ['SUI','수이','KRW-SUI','SUIUSDT'],['TAO','비트텐서','KRW-TAOUSDT','TAOUSDT'],['UNI','유니스왑','KRW-UNI','UNIUSDT'],
  ['AAVE','에이브','KRW-AAVE','AAVEUSDT'],['NEAR','니어프로토콜','KRW-NEAR','NEARUSDT'],['ALGO','알고랜드','KRW-ALGO','ALGOUSDT'],
  ['APT','앱토스','KRW-APT','APTUSDT'],['ICP','인터넷컴퓨터','KRW-ICP','ICPUSDT'],['XLM','스텔라루멘','KRW-XLM','XLMUSDT'],
  ['ADA','에이다','KRW-ADA','ADAUSDT'],['GRT','그래프','KRW-GRT','GRTUSDT']
];

const MARKET_CACHE_KEY = 'market-radar:v1';
const MARKET_CACHE_TTL = 15;

async function getMarketRadar(env) {
  const now = Date.now();
  if (env.SCALPER_KV) {
    try {
      const c = await env.SCALPER_KV.get(MARKET_CACHE_KEY, 'json');
      if (c?.generatedAt && now - Number(c.generatedAt) < MARKET_CACHE_TTL * 1000) return { ...c, cached:true };
    } catch {}
  }

  const upbitMarkets = MARKET_RADAR_COINS.map(x=>x[2]).join(',');
  const binanceSymbols = MARKET_RADAR_COINS.map(x=>x[3]);
  const binanceUrl = 'https://api.binance.com/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(binanceSymbols));
  const errors = [];
  let upbit = [], binance = [], fx = null;

  await Promise.allSettled([
    fetchJsonPublic(`https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(upbitMarkets)}`)
      .then(x=>{upbit=x}).catch(e=>errors.push('Upbit: '+e.message)),
    fetchJsonPublic(binanceUrl)
      .then(x=>{binance=x}).catch(e=>errors.push('Binance: '+e.message)),
    fetchJsonPublic('https://open.er-api.com/v6/latest/USD')
      .then(x=>{fx=safeNum(x?.rates?.KRW)}).catch(e=>errors.push('USD/KRW: '+e.message))
  ]);

  const uMap = new Map((upbit||[]).map(x=>[x.market,x]));
  const bMap = new Map((binance||[]).map(x=>[x.symbol,x]));
  const usdkrw = fx;
  const rows = MARKET_RADAR_COINS.map(([symbol,name,upbitMarket,binanceSymbol])=>{
    const u=uMap.get(upbitMarket), b=bMap.get(binanceSymbol);
    const krw=safeNum(u?.trade_price);
    const usdt=safeNum(b?.lastPrice);
    const change24=safeNum(u?.signed_change_rate);
    const globalKrw=Number.isFinite(usdt)&&Number.isFinite(usdkrw)?usdt*usdkrw:null;
    const premium=Number.isFinite(krw)&&Number.isFinite(globalKrw)&&globalKrw>0?(krw/globalKrw-1)*100:null;
    return {
      symbol,name,market:upbitMarket,binance:binanceSymbol,
      priceKrw:krw,priceUsdt:usdt,usdkrw,
      change24h:change24==null?null:change24*100,
      kimchiPremium:premium,
      upbitTimestamp:safeNum(u?.timestamp),
      volume24hKrw:safeNum(u?.acc_trade_price_24h)
    };
  });

  const result={ok:true,generatedAt:now,usdkrw,rows,errors};
  if(env.SCALPER_KV) {
    try { await env.SCALPER_KV.put(MARKET_CACHE_KEY,JSON.stringify(result),{expirationTtl:60}); } catch {}
  }
  return result;
}

async function getLiquidityRadar(env) {
  const now = Date.now();
  if (env.SCALPER_KV) {
    try {
      const cached = await env.SCALPER_KV.get(LIQUIDITY_CACHE_KEY, 'json');
      if (cached?.generatedAt && now - Number(cached.generatedAt) < LIQUIDITY_CACHE_TTL * 1000) {
        return { ...cached, cached: true };
      }
    } catch {}
  }

  const previous = env.SCALPER_KV ? await env.SCALPER_KV.get(LIQUIDITY_HISTORY_KEY, 'json').catch(()=>null) : null;
  const errors = [];

  let xpower = null, cg = null, stable = null, ethbtc = null, upbit = null;
  await Promise.allSettled([
    fetchJsonPublic('https://www.xpowerflow.com/api/liquidity/latest.json').then(x=>{xpower=x}).catch(e=>errors.push('Global M2/Net Liquidity: '+e.message)),
    fetchJsonPublic('https://api.coingecko.com/api/v3/global').then(x=>{cg=x?.data||x}).catch(e=>errors.push('BTC Dominance: '+e.message)),
    fetchJsonPublic('https://stablecoins.llama.fi/stablecoincharts/all').then(x=>{stable=x}).catch(e=>errors.push('Stablecoin: '+e.message)),
    fetchJsonPublic('https://api.binance.com/api/v3/ticker/price?symbol=ETHBTC').then(x=>{ethbtc=x}).catch(e=>errors.push('ETH/BTC: '+e.message)),
    fetchJsonPublic('https://api.upbit.com/v1/ticker/all?quote_currencies=KRW').then(x=>{upbit=x}).catch(e=>errors.push('Upbit Alt Volume: '+e.message))
  ]);

  const globalM2 = safeNum(xpower?.signal?.gmlci);
  const urli = safeNum(xpower?.signal?.urli);
  const btcDom = safeNum(cg?.market_cap_percentage?.btc);
  const stableTotal = parseStablecoinTotal(stable);
  const ethBtc = safeNum(ethbtc?.price);

  const altSymbols = new Set(COINS.map(s=>`KRW-${s}`));
  let altVolKrw = null;
  if (Array.isArray(upbit)) {
    altVolKrw = upbit
      .filter(x => altSymbols.has(x.market))
      .map(x => safeNum(x.acc_trade_price_24h))
      .filter(Number.isFinite)
      .reduce((a,b)=>a+b,0);
  }

  const prevM2 = safeNum(previous?.globalM2);
  const prevStable = safeNum(previous?.stableTotal);
  const prevEthBtc = safeNum(previous?.ethBtc);
  const prevAltVol = safeNum(previous?.altVolKrw);
  const prevBtcDom = safeNum(previous?.btcDom);

  const m2Delta = pctChange(globalM2, prevM2);
  const stableDelta = pctChange(stableTotal, prevStable);
  const ethBtcDelta = pctChange(ethBtc, prevEthBtc);
  const altVolDelta = pctChange(altVolKrw, prevAltVol);
  const btcDomDelta = Number.isFinite(btcDom) && Number.isFinite(prevBtcDom) ? btcDom - prevBtcDom : null;

  // Global M2: XPOWER GMLCI is a public global-liquidity composite, not raw M2.
  // It is intentionally labeled as a liquidity index in the UI.
  const m2Score = globalM2 == null ? 0 : (globalM2 > 10 ? 1 : globalM2 < -10 ? -1 : 0);
  const stableScore = stableDelta == null ? 0 : (stableDelta > 0.35 ? 1 : stableDelta < -0.35 ? -1 : 0);
  const btcScore = 0; // populated below from the 24h market snapshot if available
  const domScore = btcDomDelta == null ? 0 : (btcDomDelta < -0.15 ? 1 : btcDomDelta > 0.15 ? -1 : 0);
  const ethScore = ethBtcDelta == null ? 0 : (ethBtcDelta > 0.25 ? 1 : ethBtcDelta < -0.25 ? -1 : 0);
  const altScore = altVolDelta == null ? 0 : (altVolDelta > 8 ? 1 : altVolDelta < -8 ? -1 : 0);

  let btc24h = null, totalCryptoCap = null;
  if (cg) {
    btc24h = safeNum(cg?.market_cap_change_percentage_24h_usd);
    totalCryptoCap = safeNum(cg?.total_market_cap?.usd);
  }
  const btcSignalScore = btc24h == null ? 0 : (btc24h > 0.4 ? 1 : btc24h < -0.4 ? -1 : 0);

  const parts = [
    { id:'m2', label:'Global Liquidity', value:globalM2, unit:'GMLCI', score:m2Score, state:m2Score>0?'UP':m2Score<0?'DOWN':'NEUTRAL', change:m2Delta },
    { id:'stable', label:'Stablecoin', value:stableTotal, unit:'USD', score:stableScore, state:stableScore>0?'UP':stableScore<0?'DOWN':'NEUTRAL', change:stableDelta },
    { id:'btc', label:'BTC', value:btc24h, unit:'24h %', score:btcSignalScore, state:btcSignalScore>0?'UP':btcSignalScore<0?'DOWN':'NEUTRAL', change:btc24h },
    { id:'dom', label:'BTC Dominance', value:btcDom, unit:'%', score:domScore, state:domScore>0?'DOWN':'UP', change:btcDomDelta },
    { id:'ethbtc', label:'ETH/BTC', value:ethBtc, unit:'BTC', score:ethScore, state:ethScore>0?'UP':ethScore<0?'DOWN':'NEUTRAL', change:ethBtcDelta },
    { id:'altvol', label:'Alt Volume', value:altVolKrw, unit:'KRW 24h', score:altScore, state:altScore>0?'UP':altScore<0?'DOWN':'NEUTRAL', change:altVolDelta }
  ];

  const score = scoreLiquidity(parts);
  const positive = parts.filter(x=>x.score>0).length;
  const negative = parts.filter(x=>x.score<0).length;
  const regime = positive >= 4 ? 'ALT_EXPANSION' : positive >= 3 && negative <= 1 ? 'RISK_ON_BUILD' : negative >= 4 ? 'RISK_OFF' : 'MIXED';

  const result = {
    ok: true,
    generatedAt: now,
    cached: false,
    score,
    regime,
    positive,
    negative,
    components: parts,
    source: {
      globalLiquidity: 'XPOWERFLOW GMLCI / URLI',
      stablecoin: 'DefiLlama',
      btcDominance: 'CoinGecko',
      ethBtc: 'Binance public ticker',
      altVolume: 'Upbit KRW 12-coin basket'
    },
    market: { totalCryptoCap, urli },
    errors
  };

  if (env.SCALPER_KV) {
    try {
      await env.SCALPER_KV.put(LIQUIDITY_HISTORY_KEY, JSON.stringify({
        generatedAt: now, globalM2, stableTotal, btcDom, ethBtc, altVolKrw, btc24h, totalCryptoCap
      }), { expirationTtl: 60 * 24 * 60 * 60 });
      await env.SCALPER_KV.put(LIQUIDITY_CACHE_KEY, JSON.stringify(result), { expirationTtl: LIQUIDITY_CACHE_TTL });
    } catch {}
  }

  return result;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = MACRO_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function cleanHtmlCell(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&minus;|&#8722;/gi, '-')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTreasuryYieldXml(xml) {
  const y2 = [], y10 = [];
  const entries = String(xml || '').match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const entry of entries) {
    const date = entry.match(/<d:NEW_DATE[^>]*>([^<]+)<\/d:NEW_DATE>/i)?.[1]?.slice(0,10);
    const a = Number(entry.match(/<d:BC_2YEAR[^>]*>([^<]+)<\/d:BC_2YEAR>/i)?.[1]);
    const b = Number(entry.match(/<d:BC_10YEAR[^>]*>([^<]+)<\/d:BC_10YEAR>/i)?.[1]);
    if (date && Number.isFinite(a)) y2.push({ date, value:a });
    if (date && Number.isFinite(b)) y10.push({ date, value:b });
  }
  if (y2.length < 2 || y10.length < 2) throw new Error('Treasury XML 2Y/10Y 데이터 부족');
  return { US2Y:y2.slice(-45), US10Y:y10.slice(-45) };
}

async function fetchTreasuryProvider(asOf = Date.now()) {
  const year = new Date(asOf).getUTCFullYear();
  const q = new URLSearchParams({ data:'daily_treasury_yield_curve', field_tdr_date_value:String(year) });
  const r = await fetchWithTimeout(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?${q.toString()}`, { headers:{ accept:'application/xml,text/xml;q=0.9,*/*;q=0.8', 'user-agent':'BTC-ALT-SCALPER/8.1.4' } });
  if (!r.ok) throw new Error(`Treasury ${r.status}`);
  return parseTreasuryYieldXml(await r.text());
}

function parseFedHistoricalRateHtml(html) {
  const plain = cleanHtmlCell(html).toUpperCase();
  const out = [];
  const re = /(\d{1,2}-[A-Z]{3}-\d{2,4})\s+(ND|[-+]?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(plain))) {
    const v = Number(m[2]);
    if (Number.isFinite(v)) out.push({ date:m[1], value:v });
  }
  if (out.length < 5) throw new Error('Federal Reserve H.10 데이터 부족');
  return out.slice(-45);
}

async function fetchFederalReserveSeries(id, url) {
  const r = await fetchWithTimeout(url, { headers:{ accept:'text/html,*/*;q=0.8', 'user-agent':'BTC-ALT-SCALPER/8.1.4' } });
  if (!r.ok) throw new Error(`${id} ${r.status}`);
  return { [id]:parseFedHistoricalRateHtml(await r.text()) };
}

function parseCboeCsv(text, id = '') {
  const lines = String(text || '').replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 3) throw new Error('Cboe CSV 데이터 부족');
  const split = line => line.split(',').map(x => x.trim().replace(/^"|"$/g,''));
  const head = split(lines[0]).map(x => x.toUpperCase().replace(/[\s.-]+/g,'_'));
  let dateIdx = head.findIndex(x => x === 'DATE' || x === 'TRADE_DATE' || x.endsWith('_DATE'));
  if (dateIdx < 0) dateIdx = 0;

  const sym = String(id || '').toUpperCase();
  const preferred = ['CLOSE', `${sym}_CLOSE`, sym, 'VALUE', 'LAST', 'LAST_PRICE', 'INDEX_VALUE'];
  let valueIdx = preferred.map(x => head.indexOf(x)).find(i => i >= 0 && i !== dateIdx);

  // OVX처럼 DATE,OVX 두 열 또는 형식이 바뀐 공개 CSV도 수용합니다.
  if (valueIdx == null || valueIdx < 0) {
    const sampleRows = lines.slice(1, Math.min(lines.length, 8)).map(split);
    let best = -1, bestHits = -1;
    for (let i = 0; i < head.length; i++) {
      if (i === dateIdx) continue;
      const hits = sampleRows.reduce((n,row) => n + (Number.isFinite(Number(String(row[i] ?? '').replace(/,/g,''))) ? 1 : 0), 0);
      if (hits > bestHits) { bestHits = hits; best = i; }
    }
    valueIdx = best;
  }
  if (valueIdx == null || valueIdx < 0) throw new Error(`Cboe CSV 형식 변경 (${sym || 'INDEX'})`);

  const out = [];
  for (const line of lines.slice(1)) {
    const parts = split(line);
    const raw = String(parts[valueIdx] ?? '').replace(/,/g,'');
    const v = Number(raw);
    const date = parts[dateIdx];
    if (date && Number.isFinite(v)) out.push({ date, value:v });
  }
  if (out.length < 5) throw new Error(`Cboe CSV 유효 데이터 부족 (${sym || 'INDEX'})`);
  return out.slice(-45);
}
async function fetchCboeSeries(id, url) {
  const r = await fetchWithTimeout(url, { headers:{ accept:'text/csv,*/*;q=0.8', 'user-agent':'BTC-ALT-SCALPER/8.1.4' } });
  if (!r.ok) throw new Error(`${id} ${r.status}`);
  return { [id]:parseCboeCsv(await r.text(), id) };
}

function parseBlsSeries(data) {
  const out = {};
  for (const s of (data?.Results?.series || [])) {
    const rows = [];
    for (const x of (s.data || [])) {
      if (!/^M(0[1-9]|1[0-2])$/.test(String(x.period || ''))) continue;
      const v = Number(x.value);
      if (!Number.isFinite(v)) continue;
      rows.push({ date:`${x.year}-${String(x.period).slice(1)}`, value:v, year:Number(x.year), month:Number(String(x.period).slice(1)) });
    }
    rows.sort((a,b) => (a.year*12+a.month) - (b.year*12+b.month));
    out[s.seriesID] = rows;
  }
  return out;
}

async function fetchBlsProvider(asOf = Date.now()) {
  const year = new Date(asOf).getUTCFullYear();
  const body = { seriesid:['CUSR0000SA0','LNS14000000'], startyear:String(year-2), endyear:String(year) };
  const r = await fetchWithTimeout('https://api.bls.gov/publicAPI/v1/timeseries/data/', {
    method:'POST', headers:{ 'content-type':'application/json', accept:'application/json', 'user-agent':'BTC-ALT-SCALPER/8.1.4' }, body:JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`BLS ${r.status}`);
  const d = await r.json();
  if (d?.status && d.status !== 'REQUEST_SUCCEEDED') throw new Error(`BLS ${d.status}`);
  const p = parseBlsSeries(d);
  const cpi = p.CUSR0000SA0 || [], un = p.LNS14000000 || [];
  if (cpi.length < 13 || un.length < 4) throw new Error('BLS CPI/실업률 데이터 부족');
  return { CPI:cpi.slice(-30), UNRATE:un.slice(-30) };
}

function parseEiaWtiHtml(html) {
  const out = [];
  const tr = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m, seq = 0;
  while ((m = tr.exec(String(html || '')))) {
    const cells = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x => cleanHtmlCell(x[1]));
    if (cells.length < 2 || !/\b(?:19|20)\d{2}\b.*\bto\b/i.test(cells[0])) continue;
    for (const c of cells.slice(1)) {
      const v = Number(String(c).replace(/[$,]/g,'').trim());
      if (Number.isFinite(v) && v > 0) out.push({ date:`EIA-${++seq}`, value:v });
    }
  }
  if (out.length < 5) throw new Error('EIA WTI 데이터 부족');
  return out.slice(-45);
}

async function fetchEiaProvider() {
  const r = await fetchWithTimeout('https://www.eia.gov/dnav/pet/hist/RWTCD.htm', { headers:{ accept:'text/html,*/*;q=0.8', 'user-agent':'BTC-ALT-SCALPER/8.1.4' } });
  if (!r.ok) throw new Error(`EIA WTI ${r.status}`);
  return { WTI:parseEiaWtiHtml(await r.text()) };
}

async function readMacroProviderCache(env) {
  if (!env.SCALPER_KV) return {};
  try {
    const raw = await env.SCALPER_KV.get(MACRO_PROVIDER_CACHE_KEY);
    const x = raw ? JSON.parse(raw) : {};
    return x && typeof x === 'object' ? x : {};
  } catch { return {}; }
}

async function writeMacroProviderCache(env, map) {
  if (!env.SCALPER_KV) return;
  try { await env.SCALPER_KV.put(MACRO_PROVIDER_CACHE_KEY, JSON.stringify(map), { expirationTtl: MACRO_PROVIDER_CACHE_TTL }); }
  catch {}
}

function usableProviderCache(entry, maxStaleMs) {
  if (!entry || !entry.metrics || typeof entry.metrics !== 'object') return null;
  const ageMs = Date.now() - Number(entry.fetchedAt || 0);
  if (!Number.isFinite(ageMs) || ageMs > maxStaleMs) return null;
  return { metrics:entry.metrics, fetchedAt:Number(entry.fetchedAt), ageMs };
}

async function loadMacroProvider(name, label, fetcher, maxStaleMs, cacheEntry, asOf, minRefreshMs = 0) {
  const errors = [];
  const preCached = usableProviderCache(cacheEntry, maxStaleMs);
  if (preCached && minRefreshMs > 0 && preCached.ageMs < minRefreshMs) {
    return { name, label, metrics:preCached.metrics, source:'cache', fresh:false, cacheAgeMs:preCached.ageMs, errors, throttled:true };
  }
  try {
    const metrics = await fetcher(asOf);
    if (!metrics || !Object.keys(metrics).length) throw new Error('빈 데이터');
    return { name, label, metrics, source:'live', fresh:true, errors, cacheUpdate:{ fetchedAt:Date.now(), metrics } };
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  const cached = preCached || usableProviderCache(cacheEntry, maxStaleMs);
  if (cached) return { name, label, metrics:cached.metrics, source:'cache', fresh:false, cacheAgeMs:cached.ageMs, errors };
  return { name, label, metrics:{}, source:'missing', fresh:false, errors };
}

function seriesChangePct(rows, lookback = 5) {
  if (!rows?.length) return null;
  const last = rows.at(-1)?.value, prev = rows.at(-1 - Math.min(lookback, rows.length - 1))?.value;
  return Number.isFinite(last) && Number.isFinite(prev) && prev !== 0 ? (last / prev - 1) * 100 : null;
}
function seriesChangeAbs(rows, lookback = 5) {
  if (!rows?.length) return null;
  const last = rows.at(-1)?.value, prev = rows.at(-1 - Math.min(lookback, rows.length - 1))?.value;
  return Number.isFinite(last) && Number.isFinite(prev) ? last - prev : null;
}
function seriesYoY(rows) {
  if (!Array.isArray(rows) || rows.length < 13) return null;
  const last = rows.at(-1)?.value, prev = rows.at(-13)?.value;
  return Number.isFinite(last) && Number.isFinite(prev) && prev !== 0 ? (last / prev - 1) * 100 : null;
}

async function buildMacroContext(env, asOf = Date.now()) {
  const cacheMap = await readMacroProviderCache(env);
  const providers = [
    ['treasury','U.S. Treasury',fetchTreasuryProvider,MACRO_PROVIDER_STALE_MS.treasury],
    ['frb_broad','Federal Reserve Board · Broad USD',() => fetchFederalReserveSeries('BROAD_USD','https://www.federalreserve.gov/releases/h10/summary/jrxwtfb_nb.htm'),MACRO_PROVIDER_STALE_MS.federalreserve],
    ['frb_jpy','Federal Reserve Board · USD/JPY',() => fetchFederalReserveSeries('USDJPY','https://www.federalreserve.gov/releases/h10/hist/dat00_ja.htm'),MACRO_PROVIDER_STALE_MS.federalreserve],
    ['cboe_vix','Cboe · VIX',() => fetchCboeSeries('VIX','https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv'),MACRO_PROVIDER_STALE_MS.cboe],
    ['cboe_ovx','Cboe · OVX',() => fetchCboeSeries('OVX','https://cdn.cboe.com/api/global/us_indices/daily_prices/OVX_History.csv'),MACRO_PROVIDER_STALE_MS.cboe],
    ['bls','BLS · CPI/실업률',fetchBlsProvider,MACRO_PROVIDER_STALE_MS.bls,MACRO_PROVIDER_MIN_REFRESH_MS.bls],
    ['eia','EIA · WTI',fetchEiaProvider,MACRO_PROVIDER_STALE_MS.eia]
  ];
  const settled = await Promise.all(providers.map(([name,label,fn,maxStale,minRefresh=0]) => loadMacroProvider(name,label,fn,maxStale,cacheMap[name],asOf,minRefresh)));
  const data = {}, sources = {}, errors = [];
  let freshCount = 0, cachedCount = 0, missingCount = 0;

  for (const p of settled) {
    if (p.cacheUpdate) cacheMap[p.name] = p.cacheUpdate;
    if (p.errors?.length) errors.push(`${p.label}: ${p.errors.join(' → ')}`);
    for (const id of Object.keys(MACRO_METRICS)) {
      if (!p.metrics?.[id]) continue;
      data[id] = p.metrics[id];
      const source = p.source;
      sources[id] = {
        label:MACRO_METRICS[id].label, provider:MACRO_METRICS[id].provider, source,
        latestDate:p.metrics[id]?.at(-1)?.date || null,
        cacheAgeHours:source === 'cache' ? rnd((Number(p.cacheAgeMs)||0)/3600000,1) : null
      };
    }
  }
  if (settled.some(x => x.cacheUpdate)) await writeMacroProviderCache(env, cacheMap);

  for (const id of MACRO_METRIC_IDS) {
    const src = sources[id];
    if (!src) { missingCount++; sources[id] = { label:MACRO_METRICS[id].label, provider:MACRO_METRICS[id].provider, source:'missing', latestDate:null, cacheAgeHours:null }; }
    else if (src.source === 'live') freshCount++;
    else if (src.source === 'cache') cachedCount++;
    else missingCount++;
  }

  const total = MACRO_METRIC_IDS.length;
  const coverage = (freshCount + cachedCount) / total;
  const observedQualityWeight = clamp((freshCount + cachedCount * 0.60) / total, 0, 1);
  const usableCount = freshCount + cachedCount;
  const partialMinCount = Math.ceil(total * 2 / 3); // 9개 중 6개 이상이면 부분 데이터로 안전하게 사용
  const status = missingCount === 0 && cachedCount === 0 ? 'normal' : usableCount >= partialMinCount ? 'partial' : 'unavailable';
  const qualityWeight = status === 'unavailable' ? 0 : observedQualityWeight;
  const confidencePenalty = status === 'normal' ? 0 : status === 'partial' ? clamp(2 + missingCount * 1.2 + cachedCount * 0.5, 2, 8) : 10;

  let marketScore = 0, eventScore = 0; const reasons = [];
  const d10 = seriesChangeAbs(data.US10Y, 5);
  if (d10 != null) { if (d10 <= -0.10) { marketScore += 2; reasons.push(`미10Y 5일 ${rnd(d10,2)}%p`); } else if (d10 >= 0.10) { marketScore -= 2; reasons.push(`미10Y 5일 +${rnd(d10,2)}%p`); } }
  const d2 = seriesChangeAbs(data.US2Y, 5);
  if (d2 != null) { if (d2 <= -0.10) marketScore += 1; else if (d2 >= 0.10) marketScore -= 1; }

  const vixRows = data.VIX || [], vix = vixRows.at(-1)?.value, vixCh = seriesChangePct(vixRows, 5);
  if (Number.isFinite(vix)) { if (vix >= 30) { marketScore -= 4; reasons.push(`VIX ${rnd(vix,1)} 고위험`); } else if (vix >= 24) marketScore -= 2; else if (vix <= 17) marketScore += 2; }
  if (vixCh != null) { if (vixCh >= 15) marketScore -= 2; else if (vixCh <= -15) marketScore += 1; }

  const usd = seriesChangePct(data.BROAD_USD, 5);
  if (usd != null) { if (usd >= 0.8) { marketScore -= 2; reasons.push(`광의달러 5일 +${rnd(usd,2)}%`); } else if (usd <= -0.8) { marketScore += 2; reasons.push(`광의달러 5일 ${rnd(usd,2)}%`); } }

  const oil = seriesChangePct(data.WTI, 5);
  if (oil != null) { if (oil >= 7) { marketScore -= 3; reasons.push(`WTI 5일 +${rnd(oil,1)}%`); } else if (oil >= 3) marketScore -= 1; else if (oil <= -7) marketScore += 1; }

  const jpy = seriesChangePct(data.USDJPY, 5);
  if (jpy != null && jpy <= -1.5) { marketScore -= 2; reasons.push(`엔화 강세 5일 ${rnd(jpy,1)}%`); }

  const ovxRows = data.OVX || [], ovx = ovxRows.at(-1)?.value, ovxCh = seriesChangePct(ovxRows, 5);
  if (Number.isFinite(ovx)) { if (ovx >= 50) { marketScore -= 2; reasons.push(`OVX ${rnd(ovx,1)} 원유변동성 고위험`); } else if (ovx >= 40) marketScore -= 1; }
  if (ovxCh != null && ovxCh >= 20) marketScore -= 1;

  const cpiYoy = seriesYoY(data.CPI);
  if (cpiYoy != null) {
    if (cpiYoy >= 3.5) { marketScore -= 1.5; reasons.push(`CPI YoY ${rnd(cpiYoy,2)}%`); }
    else if (cpiYoy >= 3.0) marketScore -= 0.5;
    else if (cpiYoy <= 2.3) marketScore += 0.5;
  }

  const un3 = seriesChangeAbs(data.UNRATE, 3);
  if (un3 != null) {
    if (un3 >= 0.3) { marketScore -= 1; reasons.push(`실업률 3개월 +${rnd(un3,1)}%p`); }
    else if (un3 <= -0.3) marketScore += 0.5;
  }

  // FOMC 일정은 외부 데이터 공급 장애와 무관한 이벤트 리스크이므로 품질 가중치로 희석하지 않습니다.
  const fomcUtc = ['2026-09-16T18:00:00Z','2026-10-28T18:00:00Z','2026-12-09T19:00:00Z'].map(Date.parse);
  for (const t of fomcUtc) if (asOf >= t - 12*3600000 && asOf <= t + 2*3600000) { eventScore -= 3; reasons.push('FOMC 결정 ± 이벤트 위험'); break; }

  const weightedMarketScore = marketScore * qualityWeight;
  const score = clamp(weightedMarketScore + eventScore, -10, 10);
  if (status === 'partial') reasons.push(`공개 거시데이터 부분 사용 ${freshCount+cachedCount}/${total}`);
  if (status === 'unavailable') reasons.push(`공개 거시데이터 부족 ${freshCount+cachedCount}/${total}`);

  return {
    score:rnd(score,2), rawScore:rnd(marketScore + eventScore,2), marketScore:rnd(marketScore,2), eventScore:rnd(eventScore,2),
    reasons, latestDates:Object.fromEntries(Object.entries(data).map(([k,v]) => [k, v.at(-1)?.date || null])), errors,
    quality:{ status, total, freshCount, cachedCount, missingCount, usableCount, partialMinCount, coverage:rnd(coverage*100,1), observedWeight:rnd(observedQualityWeight,2), weight:rnd(qualityWeight,2), confidencePenalty:rnd(confidencePenalty,1), sources },
    raw:{ d10, d2, vix, vixCh, usd, oil, jpy, ovx, ovxCh, cpiYoy, un3 }
  };
}

async function buildPredictionContext(env) {
  const config = await getPredictionConfig(env);
  const global = { score: 0, reasons: [] }, coins = Object.fromEntries(COINS.map(c => [c, { score: 0, reasons: [] }]));
  const errors = [], details = [];
  for (const row of config) {
    try {
      const r = await fetch(`https://gamma-api.polymarket.com/markets/${encodeURIComponent(row.marketId)}`, { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const m = await r.json();
      const outcomes = Array.isArray(m.outcomes) ? m.outcomes : JSON.parse(m.outcomes || '[]');
      const prices = Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices || '[]');
      const idx = outcomes.findIndex(x => String(x).toLowerCase() === String(row.favorableOutcome || 'Yes').toLowerCase());
      const p = idx >= 0 ? Number(prices[idx]) : NaN;
      if (!Number.isFinite(p)) throw new Error('outcome price 없음');
      const contribution = clamp((p - 0.5) * 2 * Number(row.weight || 4), -10, 10);
      const target = row.scope === 'GLOBAL' ? global : coins[normalizeContextScope(row.scope)];
      target.score += contribution;
      target.reasons.push(`${row.label}: ${row.favorableOutcome} ${(p*100).toFixed(0)}%`);
      details.push({ ...row, probability: rnd(p*100, 1), contribution: rnd(contribution, 2), question: m.question || row.label });
    } catch (e) { errors.push(`${row.label || row.marketId}: ${e.message}`); }
  }
  global.score = rnd(clamp(global.score, -8, 8), 2);
  for (const c of COINS) coins[c].score = rnd(clamp(coins[c].score, -8, 8), 2);
  return { config, global, coins, details, errors };
}

function newsKeywordScore(title) {
  const t = String(title || '').toLowerCase();
  let score = 0, severe = false;
  const negSevere = ['hack','hacked','exploit','exploited','breach','drained','drain attack','51% attack'];
  const neg = ['lawsuit','delist','outage','insolvency','bankruptcy','investigation','security incident'];
  const pos = ['etf approval','etf approved','partnership','partners with','integration','integrates','mainnet launch','upgrade successful','institutional adoption','listing'];
  if (negSevere.some(k => t.includes(k))) { score -= 4; severe = true; }
  if (neg.some(k => t.includes(k))) score -= 1.5;
  if (pos.some(k => t.includes(k))) score += 1.5;
  return { score, severe };
}

async function buildNewsContext(env) {
  const coins = Object.fromEntries(COINS.map(c => [c, { score: 0, reasons: [], severeRisk: false, items: [] }]));
  if (!env.CRYPTOPANIC_AUTH_TOKEN) return { configured: false, coins, errors: [] };
  const base = String(env.CRYPTOPANIC_API_BASE || 'https://cryptopanic.com/api/v1/posts/');
  try {
    const q = new URLSearchParams({ auth_token: env.CRYPTOPANIC_AUTH_TOKEN, currencies: COINS.join(','), kind: 'news', public: 'true' });
    const r = await fetch(`${base}?${q.toString()}`, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`CryptoPanic ${r.status}`);
    const d = await r.json();
    const now = Date.now();
    for (const post of (d.results || []).slice(0, 80)) {
      const at = Date.parse(post.published_at || post.created_at || '');
      const ageH = Number.isFinite(at) ? Math.max(0, (now-at)/3600000) : 24;
      if (ageH > 24) continue;
      const decay = ageH <= 3 ? 1 : ageH <= 12 ? .6 : .3;
      const kw = newsKeywordScore(post.title);
      const votes = post.votes || {};
      const voteScore = clamp(((Number(votes.positive)||0) - (Number(votes.negative)||0)) * .12 + (Number(votes.important)||0) * .04, -2, 2);
      const contribution = (kw.score + voteScore) * decay;
      const codes = (post.currencies || post.instruments || []).map(x => normalizeSymbol(x.code || x.symbol || x)).filter(x => COINS.includes(x));
      for (const c of codes) {
        coins[c].score += contribution;
        if (kw.severe && ageH <= 12) coins[c].severeRisk = true;
        if (Math.abs(contribution) >= .5) coins[c].reasons.push(`${post.title}`.slice(0,120));
        coins[c].items.push({ title: String(post.title || '').slice(0,160), at: Number.isFinite(at)?at:null, contribution:rnd(contribution,2) });
      }
    }
    for (const c of COINS) coins[c].score = rnd(clamp(coins[c].score, -6, 6), 2);
    return { configured: true, coins, errors: [] };
  } catch (e) { return { configured: true, coins, errors: [e.message] }; }
}

function manualContext(events) {
  const global = { score: 0, reasons: [], severeRisk: false }, coins = Object.fromEntries(COINS.map(c => [c, { score: 0, reasons: [], severeRisk: false }]));
  for (const e of events) {
    const target = e.scope === 'GLOBAL' ? global : coins[normalizeContextScope(e.scope)];
    target.score += Number(e.score) || 0;
    target.reasons.push(`${e.label} ${Number(e.score)>0?'+':''}${e.score}`);
    if (Number(e.score) <= -8) target.severeRisk = true;
  }
  global.score = rnd(clamp(global.score, -10, 10),2);
  for (const c of COINS) coins[c].score = rnd(clamp(coins[c].score, -10, 10),2);
  return { global, coins };
}

async function archiveContext(env, context) {
  if (!env.SCALPER_KV) return;
  const d = new Date(context.generatedAt || Date.now());
  const key = `context-history:${d.toISOString().slice(0,13)}`;
  try {
    if (!(await env.SCALPER_KV.get(key))) {
      const compact = { generatedAt: context.generatedAt, global: context.global, coins: Object.fromEntries(COINS.map(c => [c, { total: context.coins[c]?.total, news: context.coins[c]?.news, prediction: context.coins[c]?.prediction, manual: context.coins[c]?.manual }])) };
      await env.SCALPER_KV.put(key, JSON.stringify(compact), { expirationTtl: CONTEXT_HISTORY_TTL });
    }
  } catch {}
}

async function getExternalContext(env, { force = false, asOf = Date.now() } = {}) {
  if (!env.SCALPER_KV) return emptyExternalContext('KV 미연결');
  if (!force) {
    try {
      const raw = await env.SCALPER_KV.get(CONTEXT_CACHE_KEY);
      if (raw) { const x = JSON.parse(raw); if (Date.now() - Number(x.generatedAt || 0) < CONTEXT_CACHE_MS) return x; }
    } catch {}
  }
  const errors = [];
  const events = await getManualEvents(env);
  const [macroR, predR, newsR] = await Promise.allSettled([buildMacroContext(env, asOf), buildPredictionContext(env), buildNewsContext(env)]);
  const macro = macroR.status === 'fulfilled' ? macroR.value : { score: 0, reasons: [], errors: [macroR.reason?.message || 'macro failed'] };
  const pred = predR.status === 'fulfilled' ? predR.value : { config: [], global: {score:0,reasons:[]}, coins:Object.fromEntries(COINS.map(c=>[c,{score:0,reasons:[]}])) , details:[], errors:[predR.reason?.message || 'prediction failed'] };
  const news = newsR.status === 'fulfilled' ? newsR.value : { configured:false, coins:Object.fromEntries(COINS.map(c=>[c,{score:0,reasons:[],severeRisk:false,items:[]}])) , errors:[newsR.reason?.message || 'news failed'] };
  errors.push(...(macro.errors||[]), ...(pred.errors||[]), ...(news.errors||[]));
  const manual = manualContext(events);
  const globalPrediction = Number(pred.global?.score)||0;
  const globalManual = Number(manual.global?.score)||0;
  const globalScore = clamp((Number(macro.score)||0) + globalPrediction + globalManual, -15, 15);
  const coins = {};
  for (const c of COINS) {
    const newsScore = Number(news.coins?.[c]?.score)||0, prediction = Number(pred.coins?.[c]?.score)||0, man = Number(manual.coins?.[c]?.score)||0;
    const total = clamp(globalScore + newsScore + prediction + man, -20, 20);
    coins[c] = {
      total: rnd(total,2), macro: rnd(Number(macro.score)||0,2), globalPrediction: rnd(globalPrediction,2), globalManual: rnd(globalManual,2),
      news: rnd(newsScore,2), prediction: rnd(prediction,2), manual: rnd(man,2),
      macroQuality: macro.quality || null, confidencePenalty: Number(macro.quality?.confidencePenalty)||0,
      severeRisk: !!(manual.global?.severeRisk || manual.coins?.[c]?.severeRisk || news.coins?.[c]?.severeRisk),
      reasons: [...(macro.reasons||[]), ...(pred.global?.reasons||[]), ...(manual.global?.reasons||[]), ...(pred.coins?.[c]?.reasons||[]), ...(manual.coins?.[c]?.reasons||[]), ...(news.coins?.[c]?.reasons||[])].slice(0,8)
    };
  }
  const context = {
    generatedAt: Date.now(),
    global: { total: rnd(globalScore,2), macro: rnd(Number(macro.score)||0,2), prediction: rnd(globalPrediction,2), manual: rnd(globalManual,2), macroQuality: macro.quality || null, reasons:[...(macro.reasons||[]), ...(pred.global?.reasons||[]), ...(manual.global?.reasons||[])].slice(0,8) },
    coins, macro, prediction: { configured: pred.config||[], details: pred.details||[] }, news: { configured: !!news.configured }, manualEvents: events, errors
  };
  await env.SCALPER_KV.put(CONTEXT_CACHE_KEY, JSON.stringify(context), { expirationTtl: 3600 });
  await archiveContext(env, context);
  return context;
}

function emptyExternalContext(error = null) {
  return { generatedAt: Date.now(), global:{total:0,macro:0,prediction:0,manual:0,reasons:[]}, coins:Object.fromEntries(COINS.map(c=>[c,{total:0,macro:0,globalPrediction:0,globalManual:0,news:0,prediction:0,manual:0,confidencePenalty:10,severeRisk:false,reasons:[]}])) , macro:{score:0,reasons:[],quality:{status:'unavailable',total:MACRO_METRIC_IDS.length,freshCount:0,cachedCount:0,missingCount:MACRO_METRIC_IDS.length,coverage:0,weight:0,confidencePenalty:10,sources:{}}}, prediction:{configured:[],details:[]}, news:{configured:false}, manualEvents:[], errors:error?[error]:[] };
}

function contextForSymbol(context, symbol) {
  return context?.coins?.[symbol] || { total: 0, severeRisk: false, reasons: [] };
}

async function getContextDashboard(env, { force = false } = {}) {
  const context = await getExternalContext(env, { force });
  return { context, coins: COINS, cryptoPanicConfigured: !!env.CRYPTOPANIC_AUTH_TOKEN, note: '외부 호재만으로 BUY를 만들지 않으며, 기술적 진입 조건은 항상 필수입니다.' };
}

async function shouldNotify(env, type, symbol, candleStart, cooldownMs) {
  const key = `last:${type}:${symbol}`;
  // v7의 ETHUSDT 형태 cooldown key도 한 번 읽어 업그레이드 직후 중복 알림을 줄입니다.
  let raw = await env.SCALPER_KV.get(key);
  if (!raw) raw = await env.SCALPER_KV.get(`last:${type}:${symbol}USDT`);
  if (!raw) return { yes: true, key };
  let last = null;
  try { last = JSON.parse(raw); } catch { last = { sentAt: Number(raw), candleStart: null }; }
  if (Number(last?.candleStart) === Number(candleStart)) return { yes: false, key, reason: 'same-candle' };
  if (Number(last?.sentAt) && Date.now() - Number(last.sentAt) < cooldownMs) return { yes: false, key, reason: 'cooldown' };
  return { yes: true, key };
}

async function markNotified(env, key, candleStart, cooldownMs) {
  const sentAt = Date.now();
  await env.SCALPER_KV.put(key, JSON.stringify({ candleStart, sentAt }), {
    expirationTtl: Math.max(3600, Math.ceil(cooldownMs / 1000) + 600)
  });
}

// v8.4: 대세 국면 자동 분류 (로테이션장 vs 동반강세장)
// 10개 알트의 RSI 상대강도(relR) 편차가 작고 BTC 자체가 강하게 오르면,
// "알트가 BTC를 이기고 있는가"만 보는 상대강도 로직이 구조적으로 신호를 못 내는
// 동반강세장으로 판정합니다.
function classifyAltRegime(results, marketRegime) {
  const valid = results.filter(r => Number.isFinite(r.rsiRel) && Number.isFinite(r.btcRet5));
  if (valid.length < 5) return { state: 'UNKNOWN', spread: 0, mean: 0, btcUptrend: false };
  const vals = valid.map(r => r.rsiRel);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const spread = Math.sqrt(variance);
  const btcRet5 = valid[0].btcRet5;
  const btcUptrend = (marketRegime?.state === 'STRONG_BULL' || marketRegime?.state === 'BULL') && btcRet5 > 0;
  const state = (btcUptrend && spread < 6) ? 'BROAD_RALLY' : 'ROTATION';
  return { state, spread: rnd(spread, 2), mean: rnd(mean, 2), btcUptrend };
}

// 동반강세장(BROAD_RALLY)에서, 상대강도(relR>=5)만 못 채웠을 뿐 알트 자체의
// 추세·거래량·패턴은 충분히 강한 코인을 "절대모멘텀형 BUY"로 별도 승격합니다.
// 로테이션장(ROTATION)에서는 절대 작동하지 않아 기존 상대강도 로직을 그대로 보존합니다.
function momentumUpgrade(r, altRegime, cfg) {
  if (altRegime.state !== 'BROAD_RALLY') return null;
  if (!Number.isFinite(r.score) || r.signal === 'BUY') return null;
  const minScore = Math.max(60, (cfg?.minScore || 75) - 10);
  const qualifies = r.ema9 > r.ema20 && r.ema20 > r.ema50
    && r.breakout && r.volRatio >= 1.15
    && r.rsi >= 52 && r.rsi <= 74
    && r.ret5 > 0.35
    && !r.btcCrash && !r.contextBlocked
    && r.altQualityGate && !r.antiChase
    && !r.fibonacciOverextended && Number(r.fibonacciScore ?? 0) >= -2
    && r.regimePolicy?.allowed !== false
    && (r.patternBullish || r.patternTrend15 === 'UP')
    && r.score >= minScore;
  if (!qualifies) return null;
  return { reasons: [...(r.reasons || []), '동반강세장 절대모멘텀 신호(상대강도 미충족, 알트 자체 추세로 승격)'] };
}

async function scanAll(env, { notify = false, source = 'manual', asOf = Date.now() } = {}) {
  const cfg = strategyConfig(env);
  const startedAt = Date.now();
  const [b5, bDaily] = await Promise.all([recentClosed5m('BTC', asOf, 288), recentClosedDays('BTC', asOf, 200)]);
  const marketRegime = analyzeMarketRegime(bDaily);
  const expectedStart = Math.floor(asOf / FIVE_MIN) * FIVE_MIN - FIVE_MIN;
  const context = await getExternalContext(env, { force: false, asOf });
  if (b5.at(-1)?.[0] !== expectedStart) throw new Error('BTC 최신 완료 5분봉을 가져오지 못했습니다.');

  const results = [];
  for (const symbol of COINS) {
    try {
      const k5 = await recentClosed5m(symbol, asOf, 288);
      results.push(evaluateSignal(symbol, k5, b5, asOf, cfg, contextForSymbol(context, symbol), marketRegime));
    } catch (e) {
      results.push({ symbol, market: marketOf(symbol), signal: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    }
    await sleep(130); // Upbit candle 그룹 제한을 여유 있게 지킵니다.
  }

  const altRegime = classifyAltRegime(results, marketRegime);
  for (const r of results) {
    if (!Number.isFinite(r.score)) continue;
    r.signalType = r.signal === 'BUY' ? 'RELATIVE' : null;
    if (r.signal !== 'BUY') {
      const upgrade = momentumUpgrade(r, altRegime, cfg);
      if (upgrade) {
        r.signal = 'BUY';
        r.signalType = 'MOMENTUM';
        r.reasons = upgrade.reasons.slice(0, 7);
      }
    }
  }

  const positions = env.SCALPER_KV ? await getPositions(env) : {};
  const held = Object.keys(positions);
  const sellSignals = [];
  const profitSignals = [];
  const lifecycleUpdates = {};
  for (const s of results) {
    if (!Number.isFinite(s.score)) { s.held = !!positions[s.symbol]; continue; }
    if (positions[s.symbol]) {
      const pos = positions[s.symbol];
      const q = sellCheck(s, pos, cfg);
      s.held = true;
      s.entry = pos.entry;
      s.quantity = pos.quantity ?? null;
      s.gain = q.gain;
      s.sell = q.sell;
      s.sellReasons = q.reasons;
      s.sellSeverity = q.severity;
      s.activeTradePlan = q.tradePlan;
      s.peakPrice = q.peakPrice;
      s.trailStop = q.trailStop;
      s.tp1Reached = q.tp1Reached;
      s.tp2Reached = q.tp2Reached;
      s.positionAgeHours = q.ageHours;
      s.profitMilestone = q.milestone;

      if (notify) {
        const patch = { addedAt: Number(pos.addedAt) || null };
        if (Number(q.peakPrice) > Number(pos.peakPrice || pos.entry || 0)) patch.peakPrice = q.peakPrice;
        if (q.trailStop && Math.abs(Number(q.trailStop)-Number(pos.lastTrailStop||0)) > Math.max(1e-8, Number(q.trailStop)*1e-6)) patch.lastTrailStop = q.trailStop;
        if (Object.keys(patch).length > 1) lifecycleUpdates[s.symbol] = { ...(lifecycleUpdates[s.symbol]||{}), ...patch };
      }
      if (q.sell) sellSignals.push(s);
      else if (q.milestone) profitSignals.push(s);
    } else {
      s.held = false;
      s.sell = false;
      s.sellReasons = [];
      s.profitMilestone = null;
    }
  }

  const sent = [], sold = [], profitReviewed = [], skipped = [];
  if (notify) {
    requireKV(env);
    requireTelegram(env);
    const buyCooldownMs = cfg.buyCooldownMin * 60000;
    const sellCooldownMs = cfg.sellCooldownMin * 60000;
    const buys = results
      .filter(x => x.signal === 'BUY' && !x.held && Number.isFinite(x.score))
      .sort((a, b) => b.confidence - a.confidence || b.score - a.score)
      .slice(0, cfg.maxBuyAlerts);

    for (const s of buys) {
      const gate = await shouldNotify(env, 'buy', s.symbol, s.candleStart, buyCooldownMs);
      if (!gate.yes) { skipped.push(`${s.symbol}:BUY:${gate.reason}`); continue; }
      await sendTelegram(env, formatBuy(s, cfg));
      await markNotified(env, gate.key, s.candleStart, buyCooldownMs);
      sent.push(s.symbol);
    }

    // TP1/TP2는 전량 SELL이 아니라 수동 부분익절/Runner 관리용 1회성 리뷰 알림입니다.
    for (const s of profitSignals) {
      const type = String(s.profitMilestone || '').toLowerCase();
      const cooldownMs = 30 * 24 * 60 * 60 * 1000;
      const positionKey = Number(positions[s.symbol]?.addedAt)||0;
      const gate = await shouldNotify(env, `${type || 'profit'}-${positionKey}`, s.symbol, s.candleStart, cooldownMs);
      if (!gate.yes) { skipped.push(`${s.symbol}:${type.toUpperCase()}:${gate.reason}`); continue; }
      await sendTelegram(env, formatProfitReview(s));
      await markNotified(env, gate.key, s.candleStart, cooldownMs);
      const now = Date.now();
      const patch = { ...(lifecycleUpdates[s.symbol]||{}), addedAt:Number(positions[s.symbol]?.addedAt)||null };
      if (s.profitMilestone === 'TP2') { patch.tp1AlertedAt = Number(positions[s.symbol]?.tp1AlertedAt)||now; patch.tp2AlertedAt = now; }
      else patch.tp1AlertedAt = now;
      lifecycleUpdates[s.symbol] = patch;
      profitReviewed.push(`${s.symbol}:${s.profitMilestone}`);
    }

    for (const s of sellSignals) {
      // 긴급 손절/CRASH는 5분 단위로 재확인할 수 있게 하고, 일반 SELL 검토는 기존 쿨다운을 유지합니다.
      const thisCooldownMs = s.sellSeverity === 'EMERGENCY' ? FIVE_MIN : sellCooldownMs;
      const gate = await shouldNotify(env, 'sell', s.symbol, s.candleStart, thisCooldownMs);
      if (!gate.yes) { skipped.push(`${s.symbol}:SELL:${gate.reason}`); continue; }
      await sendTelegram(env, formatSell(s));
      await markNotified(env, gate.key, s.candleStart, thisCooldownMs);
      sold.push(s.symbol);
    }

    if (Object.keys(lifecycleUpdates).length) {
      const merged = await persistPositionLifecycle(env, lifecycleUpdates);
      if (merged) {
        for (const [symbol,pos] of Object.entries(merged)) positions[symbol] = pos;
      }
    }
  }

  const bp = closes(b5);
  return {
    ok: true,
    version: VERSION,
    strategyVersion: STRATEGY_VERSION,
    source,
    notificationsEnabled: notify,
    scannedAt: Date.now(),
    asOf,
    candleStart: expectedStart,
    durationMs: Date.now() - startedAt,
    market: 'UPBIT_KRW',
    btcPrice: bp.at(-1) || null,
    btcRsi: rnd(RSI(bp)),
    btcRet5: rnd(pct(bp.at(-1), bp.at(-2))),
    marketRegime,
    altRegime,
    held,
    positions,
    sent,
    sold,
    profitReviewed,
    skipped,
    sellSignals: sellSignals.map(x => x.symbol),
    profitSignals: profitSignals.map(x => `${x.symbol}:${x.profitMilestone}`),
    top: results.filter(x => Number.isFinite(x.score)).sort((a, b) => b.confidence - a.confidence || b.score - a.score).slice(0, 5),
    results,
    strategy: cfg,
    context
  };
}

function kstTime(ms) {
  if (!Number.isFinite(Number(ms))) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(ms));
}

function formatBuy(s, cfg) {
  const plan=s.tradePlan||tradePlanFor(s.marketRegime,s.atrPct,cfg);
  const typeLabel = s.signalType==='MOMENTUM' ? '🚀 절대모멘텀형 (동반강세장)' : '⚖️ 상대강도형';
  return `🟢 BUY REVIEW ${VERSION}\n${typeLabel}\n\n${s.symbol}/KRW\n완료봉: ${kstTime(s.candleStart)} KST\n가격: ₩${fmt(s.price)}\n대세 Regime: ${s.marketRegime} ${s.marketRegimeScore>=0?'+':''}${s.marketRegimeScore} · 단기 BTC ${s.regime}\nTech Score: ${s.score}/100 (기준 ${s.regimePolicy?.minScore??cfg.minScore})\nPattern: ${s.patternScore >= 0 ? '+' : ''}${s.patternScore} · ${s.patternLabel} · 15m ${s.patternTrend15}\n외부 Context: ${s.contextScore >= 0 ? '+' : ''}${s.contextScore} · Regime 보정 ${s.regimeContribution>=0?'+':''}${s.regimeContribution} · 합산 ${s.adjustedScore}/100\n신뢰도: ${s.confidence}/100 · 위험: ${s.risk}\nBTC RSI: ${s.btcRsi} · ALT RSI: ${s.rsi}\nRSI 상대강도: ${s.rsiRel >= 0 ? '+' : ''}${s.rsiRel}p\n5m 상대모멘텀: ${s.relRet5 >= 0 ? '+' : ''}${s.relRet5}%\n거래량: ${s.volRatio}x · 5m ATR: ${s.atrPct}%\nEMA9/20/50: ${fmt(s.ema9)} / ${fmt(s.ema20)} / ${fmt(s.ema50)}\n\n📐 Regime 적응형 수동 매매 계획\n🎯 TP1 +${plan.tp1Pct}%: ₩${fmt(s.tp1)} · 1차 익절 참고 ${(plan.partialPct*100).toFixed(0)}%\n🎯 TP2 +${plan.tp2Pct}%: ₩${fmt(s.tp2)}\n🛑 변동성 SL -${plan.slPct}%: ₩${fmt(s.sl)}\n📎 Trail ${plan.trailPct}% · 최대 관찰 ${plan.horizonHours}h\n\n기술 근거: ${s.reasons.join(' · ')}\n패턴: ${(s.patternReasons||[]).join(' · ') || '확정 패턴 없음'}\n대세 근거: ${(s.marketRegimeReasons||[]).slice(0,4).join(' · ') || '—'}\n⚠️ 수동매매 검토 알림입니다. 실제 주문은 자동 실행하지 않습니다.`;
}

function formatProfitReview(s) {
  const plan=s.activeTradePlan||s.tradePlan||{};
  const type=s.profitMilestone||'TP1';
  const isTp2=type==='TP2';
  const partialPct=Math.round((Number(plan.partialPct)||0.5)*100);
  const peak=s.peakPrice||s.price;
  const trail=s.trailStop||null;
  const headline=isTp2?'🟠 TP2 / RUNNER REVIEW':'🟡 TP1 PARTIAL REVIEW';
  const action=isTp2
    ? `TP2 도달 구간입니다. 남은 물량은 전량매도 신호가 아니라 Runner 유지 여부와 Trail 보호를 수동 검토하세요.`
    : `시스템 계획상 보유수량의 약 ${partialPct}% 부분익절을 검토하고, 나머지는 Runner로 유지하는 구간입니다.`;
  return `${headline} ${VERSION}\n\n${s.symbol}/KRW\n완료봉: ${kstTime(s.candleStart)} KST\n현재가: ₩${fmt(s.price)}\n진입가(기록): ₩${fmt(s.entry)}\n현재 손익: ${s.gain>=0?'+':''}${s.gain}%\n대세 Regime: ${s.marketRegime} ${s.marketRegimeScore>=0?'+':''}${s.marketRegimeScore}\nPattern: ${s.patternScore>=0?'+':''}${s.patternScore} · ${s.patternLabel} · 15m ${s.patternTrend15}\n\n🎯 TP1 +${plan.tp1Pct??'—'}% · TP2 +${plan.tp2Pct??'—'}%\n🛑 SL -${plan.slPct??'—'}% · Trail ${plan.trailPct??'—'}%\n📈 완료봉 기준 추적 고점: ₩${fmt(peak)}${trail?`\n📎 현재 Runner Trail 기준: ₩${fmt(trail)}`:''}\n\n${action}\n장부에서 실제 부분매도를 했다면 매도가/수량을 기록하면 남은 수량은 계속 보유로 관리됩니다.\n⚠️ 주문은 자동 실행하지 않습니다. 실제 매매는 사용자가 직접 판단합니다.`;
}

function formatSell(s) {
  const plan=s.activeTradePlan||s.tradePlan||{};
  const icon=s.sellSeverity==='EMERGENCY'?'🚨':'🔴';
  return `${icon} SELL REVIEW ${VERSION}\n\n${s.symbol}/KRW\n완료봉: ${kstTime(s.candleStart)} KST\n현재가: ₩${fmt(s.price)}\n진입가(기록): ₩${fmt(s.entry)}\n${s.quantity ? `보유수량(기록): ${s.quantity} ${s.symbol}\n` : ''}현재 손익: ${s.gain >= 0 ? '+' : ''}${s.gain}%\n대세 Regime: ${s.marketRegime} ${s.marketRegimeScore>=0?'+':''}${s.marketRegimeScore} · 단기 BTC ${s.regime}\nTech ${s.score}/100 · Pattern ${s.patternScore >= 0 ? '+' : ''}${s.patternScore} (${s.patternLabel}) · Context ${s.contextScore >= 0 ? '+' : ''}${s.contextScore}\n위험: ${s.risk} · 경보등급: ${s.sellSeverity||'NORMAL'}\n동적 기준: SL -${plan.slPct??'—'}% · TP1 +${plan.tp1Pct??'—'}% · TP2 +${plan.tp2Pct??'—'}% · Trail ${plan.trailPct??'—'}%\n추적 고점: ₩${fmt(s.peakPrice)}${s.trailStop?` · Runner Trail ₩${fmt(s.trailStop)}`:''}\nEMA9/20/50: ${fmt(s.ema9)} / ${fmt(s.ema20)} / ${fmt(s.ema50)}\n\n🚨 매도 검토 사유\n${s.sellReasons.map(x => `• ${x}`).join('\n')}\n\n상승장에서는 작은 눌림/Risk-Off만으로 SELL을 내지 않고 복수 약화 신호를 요구합니다.\n⚠️ 실제 주문은 자동 실행하지 않습니다.`;
}

function fmt(x) {
  x = Number(x);
  if (!Number.isFinite(x)) return '—';
  return x >= 1000 ? x.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : x >= 1 ? x.toLocaleString('ko-KR', { maximumFractionDigits: 4 }) : x.toFixed(6);
}

async function sendTelegram(env, text) {
  requireTelegram(env);
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text })
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Telegram ${r.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
