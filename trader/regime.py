from __future__ import annotations

from dataclasses import dataclass
import numpy as np
import pandas as pd

from .models import MarketMode
from .indicators import ema, rsi


@dataclass(slots=True)
class RegimeState:
    mode: MarketMode
    btc_score: float
    breadth: float
    median_relative_15m: float
    reasons: list[str]


def btc_long_regime(daily: pd.DataFrame) -> tuple[str, float, list[str]]:
    if len(daily) < 60:
        return "RANGE", 0.0, ["BTC 일봉 데이터 부족"]
    d = daily.sort_index().copy().iloc[-220:]
    c = d["close"]
    e20, e50 = ema(c, 20), ema(c, 50)
    e200 = ema(c, 200) if len(c) >= 200 else pd.Series(np.nan, index=c.index)
    last = float(c.iloc[-1])
    score = 0.0
    reasons: list[str] = []
    if last > float(e50.iloc[-1]): score += 18
    else: score -= 18
    if float(e20.iloc[-1]) > float(e50.iloc[-1]): score += 14
    else: score -= 14
    if pd.notna(e200.iloc[-1]):
        if last > float(e200.iloc[-1]): score += 18
        else: score -= 18
        if float(e50.iloc[-1]) > float(e200.iloc[-1]): score += 10
        else: score -= 10
    ret30 = (last / float(c.iloc[-31]) - 1) * 100 if len(c) > 30 else 0
    ret90 = (last / float(c.iloc[-91]) - 1) * 100 if len(c) > 90 else 0
    hi90 = float(c.iloc[-min(90, len(c)):].max())
    dd = (last / hi90 - 1) * 100
    rd = float(rsi(c, 14).iloc[-1])
    if ret30 >= 4: score += 8
    elif ret30 <= -4: score -= 8
    if ret90 >= 8: score += 8
    elif ret90 <= -8: score -= 8
    if dd <= -15: score -= 10
    if 52 <= rd <= 72: score += 5
    elif rd < 42: score -= 5
    score = float(np.clip(score, -100, 100))
    if score >= 45 and (ret30 >= 2.5 or ret90 >= 6): state = "BULL"
    elif score <= -25 and (ret30 <= -2.5 or ret90 <= -6 or dd <= -15): state = "BEAR"
    else: state = "RANGE"
    reasons += [f"30D {ret30:.1f}%", f"90D {ret90:.1f}%", f"DD90 {dd:.1f}%", f"RSI-D {rd:.1f}"]
    return state, score, reasons


def classify_market_mode(
    btc_feat: dict,
    alt_feats: dict[str, dict],
    btc_daily_state: str,
    btc_daily_score: float,
    co_bull_breadth: float = 0.60,
    rotation_breadth: float = 0.35,
    btc_only_breadth_ceiling: float = 0.40,
) -> RegimeState:
    if btc_daily_state == "BEAR":
        return RegimeState(MarketMode.BEAR, btc_daily_score, 0.0, 0.0, ["BTC 장기 BEAR"])

    btc_abs = 0.0
    if btc_feat.get("close", 0) > btc_feat.get("ema20", np.inf): btc_abs += 20
    if btc_feat.get("ema20", 0) > btc_feat.get("ema50", np.inf): btc_abs += 20
    if btc_feat.get("close", 0) > btc_feat.get("vwap", np.inf): btc_abs += 15
    if btc_feat.get("macd_hist", -1) > 0: btc_abs += 15
    if btc_feat.get("ret_1h", -99) > 0: btc_abs += 10
    if 50 <= btc_feat.get("rsi", 0) <= 75: btc_abs += 10
    if btc_feat.get("williams_breakout", False): btc_abs += 10

    strong_flags: list[bool] = []
    rels: list[float] = []
    for f in alt_feats.values():
        strong_flags.append(
            f.get("close", 0) > f.get("ema20", np.inf)
            and f.get("close", 0) > f.get("vwap", np.inf)
            and f.get("macd_hist", -1) > 0
        )
        if np.isfinite(f.get("ret_15m", np.nan)) and np.isfinite(btc_feat.get("ret_15m", np.nan)):
            rels.append(float(f["ret_15m"] - btc_feat["ret_15m"]))
    breadth = float(np.mean(strong_flags)) if strong_flags else 0.0
    med_rel = float(np.median(rels)) if rels else 0.0
    reasons = [f"BTC abs {btc_abs:.0f}", f"ALT breadth {breadth:.0%}", f"ALT-BTC 15m median {med_rel:+.2f}%"]

    if btc_abs >= 65 and breadth >= co_bull_breadth:
        mode = MarketMode.CO_BULL
    elif breadth >= rotation_breadth and med_rel > 0.05:
        mode = MarketMode.ROTATION
    elif btc_abs >= 65 and breadth <= btc_only_breadth_ceiling:
        mode = MarketMode.BTC_ONLY
    else:
        mode = MarketMode.RANGE
    return RegimeState(mode, btc_daily_score, breadth, med_rel, reasons)
