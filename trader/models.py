from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class MarketMode(str, Enum):
    CO_BULL = "CO_BULL"       # BTC와 알트가 함께 강한 동반상승장
    ROTATION = "ROTATION"     # BTC 대비 특정 알트가 더 강한 로테이션장
    BTC_ONLY = "BTC_ONLY"     # BTC만 강하고 알트 breadth가 약한 장
    RANGE = "RANGE"
    BEAR = "BEAR"


class SignalSide(str, Enum):
    BUY = "BUY"
    WATCH = "WATCH"
    SELL = "SELL"
    NONE = "NONE"


class SignalTrack(str, Enum):
    BTC_ABSOLUTE = "BTC_ABSOLUTE"
    ALT_ABSOLUTE = "ALT_ABSOLUTE"
    ALT_RELATIVE = "ALT_RELATIVE"
    ALT_HYBRID = "ALT_HYBRID"
    RISK = "RISK"


@dataclass(slots=True)
class Signal:
    market: str
    side: SignalSide
    track: SignalTrack
    score: float
    mode: MarketMode
    price: float
    reasons: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RiskPlan:
    stop_pct: float
    tp1_pct: float
    tp2_pct: float
    trail_pct: float
    tp1_fraction: float
    tp2_fraction_of_remaining: float


@dataclass(slots=True)
class Position:
    market: str
    entry: float
    quantity: float
    opened_at_ms: int
    plan: RiskPlan
    track: SignalTrack
    mode_at_entry: MarketMode
    peak: float
    remaining_qty: float
    tp1_done: bool = False
    tp2_done: bool = False
    realized_pnl_krw: float = 0.0
    entry_fee_krw: float = 0.0


@dataclass(slots=True)
class TradeRecord:
    market: str
    side: str
    quantity: float
    price: float
    timestamp_ms: int
    reason: str
    fee_krw: float = 0.0
    slippage_krw: float = 0.0


@dataclass(slots=True)
class BacktestMetrics:
    trades: int
    wins: int
    losses: int
    win_rate_pct: float
    net_return_pct: float
    expectancy_pct: float
    profit_factor: float
    max_drawdown_pct: float
    max_consecutive_losses: int
