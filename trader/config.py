from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import os
import yaml


@dataclass(frozen=True)
class UniverseConfig:
    btc: str
    alts: tuple[str, ...]


@dataclass(frozen=True)
class StrategyConfig:
    timeframe_minutes: int = 5
    min_history_bars: int = 240
    williams_k: float = 0.50
    btc_buy_score: float = 70
    alt_absolute_buy_score: float = 68
    alt_relative_buy_score: float = 62
    alt_hybrid_buy_score: float = 64
    rsi_min: float = 48
    rsi_max: float = 76
    max_chase_atr: float = 2.2
    min_volume_ratio: float = 1.10
    co_bull_breadth: float = 0.60
    rotation_breadth: float = 0.35
    btc_only_breadth_ceiling: float = 0.40


@dataclass(frozen=True)
class RiskConfig:
    initial_equity_krw: float = 1_000_000
    risk_per_trade_pct: float = 0.50
    max_position_pct: float = 20.0
    max_concurrent_positions: int = 3
    max_daily_loss_pct: float = 2.0
    max_spread_bps: float = 18
    cooldown_minutes: int = 20
    fee_pct_per_side: float = 0.05
    slippage_pct_per_side: float = 0.03
    stop_atr_mult: float = 1.6
    tp1_atr_mult: float = 2.5
    tp2_atr_mult: float = 4.5
    trail_atr_mult: float = 1.2
    tp1_fraction: float = 0.40
    tp2_fraction_of_remaining: float = 0.50


@dataclass(frozen=True)
class ExecutionConfig:
    style: str = "best_ioc"
    order_test_before_live: bool = True
    request_timeout_seconds: int = 10
    max_retries: int = 4
    public_rest_concurrency: int = 5
    websocket_reconnect_max_seconds: int = 30


@dataclass(frozen=True)
class BacktestConfig:
    default_days: int = 90
    warmup_bars: int = 240
    cache_dir: str = "data"
    export_trades_csv: bool = True


@dataclass(frozen=True)
class AppConfig:
    version: str
    universe: UniverseConfig
    strategy: StrategyConfig
    risk: RiskConfig
    execution: ExecutionConfig
    backtest: BacktestConfig
    trading_mode: str
    live_enabled: bool


def _build(cls, raw: dict[str, Any]):
    fields = cls.__dataclass_fields__
    return cls(**{k: v for k, v in raw.items() if k in fields})


def load_config(path: str | Path = "config.yaml") -> AppConfig:
    p = Path(path)
    if not p.exists():
        p = Path("config.example.yaml")
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    universe_raw = raw.get("universe", {})
    universe = UniverseConfig(
        btc=str(universe_raw.get("btc", "KRW-BTC")),
        alts=tuple(universe_raw.get("alts", [])),
    )
    trading_mode = os.getenv("TRADING_MODE", "PAPER").upper().strip()
    live_enabled = os.getenv("LIVE_TRADING", "false").lower() == "true"
    return AppConfig(
        version=str(raw.get("version", "v8.4.0-dual-track-python")),
        universe=universe,
        strategy=_build(StrategyConfig, raw.get("strategy", {})),
        risk=_build(RiskConfig, raw.get("risk", {})),
        execution=_build(ExecutionConfig, raw.get("execution", {})),
        backtest=_build(BacktestConfig, raw.get("backtest", {})),
        trading_mode=trading_mode,
        live_enabled=live_enabled,
    )
