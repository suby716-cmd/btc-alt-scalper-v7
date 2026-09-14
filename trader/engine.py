from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import defaultdict
from pathlib import Path
import pandas as pd

from .config import AppConfig
from .data import candles_to_frame
from .indicators import enrich, feature_row
from .models import MarketMode, Position, SignalSide
from .regime import btc_long_regime, classify_market_mode
from .risk import RiskManager
from .state import StateStore
from .strategy import DualTrackStrategy
from .upbit import AsyncUpbitClient, public_stream


log = logging.getLogger(__name__)


class LiveEngine:
    """Production-oriented skeleton. 기본은 PAPER이며 LIVE는 이중 잠금으로 막습니다."""
    def __init__(self, cfg: AppConfig):
        self.cfg = cfg
        self.strategy = DualTrackStrategy(cfg.strategy)
        self.risk = RiskManager(cfg.risk)
        self.store = StateStore()
        self.frames: dict[str, pd.DataFrame] = {}
        self.orderbook: dict[str, tuple[float, float]] = {}
        self.positions: dict[str, Position] = {}
        self.current_candle_ts: dict[str, str] = {}
        self._lock = asyncio.Lock()

    async def bootstrap(self, client: AsyncUpbitClient):
        await self.store.init()
        self.positions = await self.store.load_positions()
        markets = [self.cfg.universe.btc, *self.cfg.universe.alts]
        sem = asyncio.Semaphore(self.cfg.execution.public_rest_concurrency)
        async def one(m: str):
            async with sem:
                rows = await client.fetch_ohlcv_history(m, 5, max(self.cfg.strategy.min_history_bars, 320))
                self.frames[m] = candles_to_frame(rows)
        await asyncio.gather(*(one(m) for m in markets))
        log.info("Bootstrap complete: %d markets", len(self.frames))

    def _upsert_candle(self, msg: dict) -> tuple[str, bool]:
        market = msg["code"]
        ts = msg["candle_date_time_utc"]
        stamp = pd.Timestamp(ts, tz="UTC")
        row = pd.DataFrame([{
            "open": float(msg["opening_price"]), "high": float(msg["high_price"]), "low": float(msg["low_price"]),
            "close": float(msg["trade_price"]), "volume": float(msg["candle_acc_trade_volume"]),
        }], index=[stamp])
        previous = self.current_candle_ts.get(market)
        closed_new_bar = previous is not None and previous != ts
        df = pd.concat([self.frames.get(market, pd.DataFrame()), row])
        df = df[~df.index.duplicated(keep="last")].sort_index().iloc[-600:]
        self.frames[market] = df
        self.current_candle_ts[market] = ts
        return market, closed_new_bar

    def _update_orderbook(self, msg: dict):
        units = msg.get("orderbook_units") or []
        if units:
            self.orderbook[msg["code"]] = (float(units[0]["bid_price"]), float(units[0]["ask_price"]))

    async def run(self):
        access = os.getenv("UPBIT_ACCESS_KEY", "")
        secret = os.getenv("UPBIT_SECRET_KEY", "")
        async with AsyncUpbitClient(access, secret, self.cfg.execution.request_timeout_seconds, self.cfg.execution.max_retries) as client:
            await self.bootstrap(client)
            markets = [self.cfg.universe.btc, *self.cfg.universe.alts]
            async for msg in public_stream(markets, self.cfg.execution.websocket_reconnect_max_seconds):
                try:
                    ty = msg.get("type", "")
                    if ty == "orderbook":
                        self._update_orderbook(msg)
                    elif str(ty).startswith("candle."):
                        market, closed = self._upsert_candle(msg)
                        if closed:
                            await self.on_closed_candle(client, market)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    log.exception("Message processing failed")

    async def _current_mode(self) -> tuple[MarketMode, dict, dict[str, dict]]:
        btc_m = self.cfg.universe.btc
        btc_df = enrich(self.frames[btc_m], self.cfg.strategy.williams_k)
        btc_feat = feature_row(btc_df)
        alts = {}
        for m in self.cfg.universe.alts:
            if m in self.frames and len(self.frames[m]) >= self.cfg.strategy.min_history_bars:
                alts[m] = feature_row(enrich(self.frames[m], self.cfg.strategy.williams_k))
        # 실시간에서는 최근 5분 데이터로 만든 KST 일봉을 사용하되, 완료된 일봉만 사용합니다.
        k = self.frames[btc_m].copy()
        idx = k.index.tz_convert("Asia/Seoul")
        k["session"] = idx.date
        daily = k.groupby("session").agg(open=("open","first"), high=("high","max"), low=("low","min"), close=("close","last"), volume=("volume","sum"))
        if len(daily) > 1:
            daily = daily.iloc[:-1]
        dstate, dscore, _ = btc_long_regime(daily)
        reg = classify_market_mode(btc_feat, alts, dstate, dscore, self.cfg.strategy.co_bull_breadth, self.cfg.strategy.rotation_breadth, self.cfg.strategy.btc_only_breadth_ceiling)
        return reg.mode, btc_feat, alts

    async def on_closed_candle(self, client: AsyncUpbitClient, market: str):
        async with self._lock:
            mode, btc_feat, alts = await self._current_mode()
            # 포지션 리스크는 해당 종목 봉이 닫힐 때마다 확인
            if market in self.positions:
                f = enrich(self.frames[market], self.cfg.strategy.williams_k).iloc[-2]  # 새 봉이 시작되었으므로 -2가 완료봉
                pos = self.positions[market]
                for ev in self.risk.check_position(pos, float(f.high), float(f.low), float(f.close)):
                    await self._execute_sell(client, pos, ev.quantity, ev.reason)
                    if ev.action == "CLOSE_ALL":
                        pos.remaining_qty = 0.0
                if pos.remaining_qty <= 1e-15:
                    await self.store.delete_position(market)
                    self.positions.pop(market, None)
                else:
                    await self.store.save_position(pos)

            # BTC 완료봉에서만 전체 유니버스 신규신호를 평가해 중복 주문을 막습니다.
            if market != self.cfg.universe.btc:
                return
            signals = [self.strategy.btc_signal(btc_feat, mode)]
            signals += [self.strategy.alt_signal(m, f, btc_feat, mode) for m, f in alts.items()]
            buys = sorted([s for s in signals if s.side == SignalSide.BUY], key=lambda s: s.score, reverse=True)
            log.info("Mode=%s buys=%s", mode.value, [(s.market, round(s.score,1), s.track.value) for s in buys[:5]])
            for sig in buys:
                if len(self.positions) >= self.cfg.risk.max_concurrent_positions:
                    break
                if sig.market in self.positions:
                    continue
                bid, ask = self.orderbook.get(sig.market, (0, 0))
                if not self.risk.spread_ok(bid, ask):
                    log.info("Skip %s: spread unavailable/wide", sig.market); continue
                await self._execute_buy(client, sig, ask)

    async def _execute_buy(self, client: AsyncUpbitClient, sig, ask: float):
        equity = self.cfg.risk.initial_equity_krw
        if self.cfg.trading_mode == "LIVE":
            self._assert_live_unlocked()
            accts = await client.accounts()
            krw = next((a for a in accts if a.get("currency") == "KRW"), None)
            if not krw:
                raise RuntimeError("KRW 잔고를 확인할 수 없습니다.")
            equity = float(krw.get("balance", 0))
            if equity <= 0:
                raise RuntimeError("KRW 주문 가능 잔고가 없습니다.")
        feat = feature_row(enrich(self.frames[sig.market], self.cfg.strategy.williams_k))
        plan = self.risk.plan(feat.get("atr_pct", 0.3), sig.mode)
        qty = self.risk.position_size(equity, ask, plan)
        if qty <= 0:
            return
        krw = qty * ask
        now = int(time.time() * 1000)
        if self.cfg.trading_mode == "PAPER":
            pos = Position(sig.market, ask, qty, now, plan, sig.track, sig.mode, ask, qty)
            self.positions[sig.market] = pos
            await self.store.save_position(pos)
            await self.store.event(now, "PAPER_BUY", {"market": sig.market, "price": ask, "qty": qty, "score": sig.score, "track": sig.track.value})
            log.info("PAPER BUY %s %.8f @ %.0f", sig.market, qty, ask)
            return
        if self.cfg.execution.order_test_before_live:
            await client.best_ioc_buy(sig.market, krw, test=True)
        order = await client.best_ioc_buy(sig.market, krw, test=False)
        filled = await self._resolve_fill(client, order)
        exec_qty = float(filled.get("executed_volume") or 0)
        avg_price = float(filled.get("avg_price") or filled.get("price") or ask)
        if exec_qty <= 0:
            log.warning("LIVE BUY no fill %s state=%s", sig.market, filled.get("state")); return
        pos = Position(sig.market, avg_price, exec_qty, now, plan, sig.track, sig.mode, avg_price, exec_qty)
        self.positions[sig.market] = pos
        await self.store.save_position(pos)
        await self.store.event(now, "LIVE_BUY", {"market": sig.market, "price": avg_price, "qty": exec_qty, "uuid": filled.get("uuid")})
        log.warning("LIVE BUY filled %s %.8f @ %.0f", sig.market, exec_qty, avg_price)

    async def _execute_sell(self, client: AsyncUpbitClient, pos: Position, qty: float, reason: str):
        now = int(time.time() * 1000)
        if qty <= 0:
            return
        if self.cfg.trading_mode == "PAPER":
            await self.store.event(now, "PAPER_SELL", {"market": pos.market, "qty": qty, "reason": reason})
            log.info("PAPER SELL %s %.8f %s", pos.market, qty, reason)
            return
        self._assert_live_unlocked()
        if self.cfg.execution.order_test_before_live:
            await client.best_ioc_sell(pos.market, qty, test=True)
        order = await client.best_ioc_sell(pos.market, qty, test=False)
        filled = await self._resolve_fill(client, order)
        exec_qty = float(filled.get("executed_volume") or 0)
        if exec_qty <= 0:
            raise RuntimeError(f"SELL 주문이 체결되지 않았습니다: {filled}")
        await self.store.event(now, "LIVE_SELL", {"market": pos.market, "qty": exec_qty, "reason": reason, "uuid": filled.get("uuid")})
        log.warning("LIVE SELL filled %s %.8f reason=%s", pos.market, exec_qty, reason)

    async def _resolve_fill(self, client: AsyncUpbitClient, order: dict) -> dict:
        uid = order.get("uuid")
        if not uid:
            return order
        last = order
        for _ in range(8):
            if last.get("state") in {"done", "cancel"} or float(last.get("executed_volume") or 0) > 0:
                return last
            await asyncio.sleep(0.25)
            last = await client.get_order(uid)
        return last

    def _assert_live_unlocked(self):
        if not self.cfg.live_enabled or os.getenv("LIVE_CONFIRMATION") != "I_UNDERSTAND_REAL_ORDERS":
            raise RuntimeError("LIVE 주문 잠금 상태입니다. LIVE_TRADING=true와 LIVE_CONFIRMATION을 모두 설정해야 합니다.")
