from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math

from .config import RiskConfig
from .models import MarketMode, Position, RiskPlan


@dataclass(slots=True)
class ExitEvent:
    action: str
    quantity: float
    reference_price: float
    reason: str


class RiskManager:
    def __init__(self, cfg: RiskConfig):
        self.cfg = cfg
        self.daily_realized_pnl = 0.0
        self.daily_anchor = datetime.now(timezone.utc).date()

    def reset_daily_if_needed(self) -> None:
        d = datetime.now(timezone.utc).date()
        if d != self.daily_anchor:
            self.daily_anchor = d
            self.daily_realized_pnl = 0.0

    def daily_loss_blocked(self, equity: float) -> bool:
        self.reset_daily_if_needed()
        limit = equity * self.cfg.max_daily_loss_pct / 100.0
        return self.daily_realized_pnl <= -limit

    def plan(self, atr_pct: float, mode: MarketMode) -> RiskPlan:
        a = max(0.15, min(float(atr_pct or 0.3), 4.0))
        if mode == MarketMode.CO_BULL:
            sl = max(0.9, a * self.cfg.stop_atr_mult * 1.10)
            tp1 = max(1.4, a * self.cfg.tp1_atr_mult)
            tp2 = max(2.8, a * self.cfg.tp2_atr_mult)
            trail = max(0.7, a * self.cfg.trail_atr_mult * 1.15)
        elif mode in {MarketMode.ROTATION, MarketMode.BTC_ONLY}:
            sl = max(0.8, a * self.cfg.stop_atr_mult)
            tp1 = max(1.2, a * self.cfg.tp1_atr_mult)
            tp2 = max(2.2, a * self.cfg.tp2_atr_mult)
            trail = max(0.6, a * self.cfg.trail_atr_mult)
        else:
            sl = max(0.7, a * 1.3)
            tp1 = max(1.0, a * 2.0)
            tp2 = max(1.8, a * 3.4)
            trail = max(0.5, a * 1.0)
        return RiskPlan(sl, tp1, tp2, trail, self.cfg.tp1_fraction, self.cfg.tp2_fraction_of_remaining)

    def position_size(self, equity: float, entry: float, plan: RiskPlan) -> float:
        if entry <= 0 or plan.stop_pct <= 0:
            return 0.0
        risk_krw = equity * self.cfg.risk_per_trade_pct / 100.0
        stop_krw_per_coin = entry * plan.stop_pct / 100.0
        by_risk = risk_krw / stop_krw_per_coin
        by_alloc = equity * self.cfg.max_position_pct / 100.0 / entry
        return max(0.0, min(by_risk, by_alloc))

    def spread_ok(self, bid: float, ask: float) -> bool:
        if bid <= 0 or ask <= 0 or ask < bid:
            return False
        mid = (bid + ask) / 2.0
        spread_bps = (ask - bid) / mid * 10_000
        return spread_bps <= self.cfg.max_spread_bps

    def check_position(self, pos: Position, high: float, low: float, close: float) -> list[ExitEvent]:
        events: list[ExitEvent] = []
        if pos.remaining_qty <= 0:
            return events
        pos.peak = max(pos.peak, high)
        stop = pos.entry * (1 - pos.plan.stop_pct / 100)
        trail = pos.peak * (1 - pos.plan.trail_pct / 100)
        tp1 = pos.entry * (1 + pos.plan.tp1_pct / 100)
        tp2 = pos.entry * (1 + pos.plan.tp2_pct / 100)

        # 한 봉에서 stop과 target이 모두 닿으면 보수적으로 stop 우선 처리합니다.
        if low <= stop:
            events.append(ExitEvent("CLOSE_ALL", pos.remaining_qty, stop, "STOP_LOSS"))
            return events

        if not pos.tp1_done and high >= tp1:
            qty = min(pos.remaining_qty, pos.quantity * pos.plan.tp1_fraction)
            if qty > 0:
                events.append(ExitEvent("PARTIAL", qty, tp1, "TAKE_PROFIT_1"))
                pos.tp1_done = True
                pos.remaining_qty -= qty

        if pos.remaining_qty > 0 and not pos.tp2_done and high >= tp2:
            qty = pos.remaining_qty * pos.plan.tp2_fraction_of_remaining
            if qty > 0:
                events.append(ExitEvent("PARTIAL", qty, tp2, "TAKE_PROFIT_2"))
                pos.tp2_done = True
                pos.remaining_qty -= qty

        if pos.remaining_qty > 0 and pos.tp1_done and low <= trail:
            events.append(ExitEvent("CLOSE_ALL", pos.remaining_qty, trail, "TRAILING_STOP"))
        return events
