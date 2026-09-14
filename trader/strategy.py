from __future__ import annotations

import math
import numpy as np

from .config import StrategyConfig
from .models import MarketMode, Signal, SignalSide, SignalTrack


def _finite(x) -> bool:
    return isinstance(x, (int, float, np.floating)) and math.isfinite(float(x))


def anti_chase(feat: dict, cfg: StrategyConfig) -> tuple[bool, list[str]]:
    reasons = []
    dist = feat.get("ema20_dist_atr", 0)
    rsi = feat.get("rsi", 50)
    vr = feat.get("volume_ratio", 1)
    if _finite(dist) and dist > cfg.max_chase_atr:
        reasons.append(f"EMA20 이격 {dist:.2f}ATR")
    if _finite(rsi) and rsi > 80:
        reasons.append(f"RSI 과열 {rsi:.1f}")
    if _finite(vr) and vr > 4.0 and feat.get("ret_5m", 0) > 1.5:
        reasons.append(f"급등+거래량 폭증 {vr:.1f}x")
    return bool(reasons), reasons


def absolute_score(feat: dict, cfg: StrategyConfig) -> tuple[float, list[str]]:
    score = 0.0
    r: list[str] = []
    close = feat.get("close", 0)
    if close > feat.get("ema20", np.inf) and feat.get("ema20", 0) > feat.get("ema50", np.inf):
        score += 15; r.append("EMA20>EMA50 + 가격 상단")
    if close > feat.get("vwap", np.inf):
        score += 12; r.append("VWAP 상단")
    if feat.get("vwap_reclaim", False):
        score += 8; r.append("VWAP reclaim")
    if feat.get("bb_breakout", False):
        score += 15; r.append("Bollinger squeeze breakout")
    if feat.get("williams_breakout", False):
        score += 15; r.append("Williams 변동성 돌파")
    if feat.get("macd_accel", False):
        score += 12; r.append("MACD 가속")
    if feat.get("stoch_cross_up", False) and feat.get("stoch_k", 100) < 85:
        score += 8; r.append("StochRSI 골든크로스")
    rv = feat.get("rsi", 50)
    if cfg.rsi_min <= rv <= cfg.rsi_max:
        score += 8; r.append(f"RSI 적정 {rv:.1f}")
    elif rv > 80:
        score -= 12; r.append(f"RSI 과열 {rv:.1f}")
    vr = feat.get("volume_ratio", 1)
    if _finite(vr) and vr >= cfg.min_volume_ratio:
        score += min(7, (vr - 1) * 10); r.append(f"Vol {vr:.2f}x")
    if feat.get("ret_1h", 0) > 0:
        score += 5
    chase, cr = anti_chase(feat, cfg)
    if chase:
        score -= 25
        r += ["Anti-Chase: " + x for x in cr]
    return float(np.clip(score, 0, 100)), r


def relative_score(alt: dict, btc: dict) -> tuple[float, list[str]]:
    score = 50.0
    r: list[str] = []
    rel_rsi = alt.get("rsi", 50) - btc.get("rsi", 50)
    rel15 = alt.get("ret_15m", 0) - btc.get("ret_15m", 0)
    rel1h = alt.get("ret_1h", 0) - btc.get("ret_1h", 0)
    if rel_rsi >= 5: score += 15; r.append(f"RSI-BTC +{rel_rsi:.1f}")
    elif rel_rsi <= -5: score -= 15; r.append(f"RSI-BTC {rel_rsi:.1f}")
    if rel15 > 0.15: score += 15; r.append(f"15m 상대 +{rel15:.2f}%")
    elif rel15 < -0.15: score -= 15; r.append(f"15m 상대 {rel15:.2f}%")
    if rel1h > 0.30: score += 12; r.append(f"1h 상대 +{rel1h:.2f}%")
    elif rel1h < -0.30: score -= 12; r.append(f"1h 상대 {rel1h:.2f}%")
    if alt.get("ema9", 0) > alt.get("ema20", np.inf): score += 8
    if alt.get("volume_ratio", 0) > 1.2: score += 5
    return float(np.clip(score, 0, 100)), r


class DualTrackStrategy:
    def __init__(self, cfg: StrategyConfig):
        self.cfg = cfg

    def btc_signal(self, feat: dict, mode: MarketMode) -> Signal:
        score, reasons = absolute_score(feat, self.cfg)
        breakout_or_pullback = bool(feat.get("williams_breakout") or feat.get("bb_breakout") or feat.get("vwap_reclaim"))
        rsi_ok = self.cfg.rsi_min <= feat.get("rsi", 50) <= self.cfg.rsi_max
        chase, cr = anti_chase(feat, self.cfg)
        allowed = mode in {MarketMode.CO_BULL, MarketMode.BTC_ONLY, MarketMode.ROTATION}
        buy = allowed and score >= self.cfg.btc_buy_score and breakout_or_pullback and rsi_ok and not chase
        if not allowed: reasons.append(f"Mode {mode.value}: BTC 신규롱 제한")
        if chase: reasons += cr
        return Signal(
            market="KRW-BTC",
            side=SignalSide.BUY if buy else SignalSide.WATCH if score >= 55 else SignalSide.NONE,
            track=SignalTrack.BTC_ABSOLUTE,
            score=score,
            mode=mode,
            price=float(feat.get("close", 0)),
            reasons=reasons[:8],
            metadata={"absolute_score": score},
        )

    def alt_signal(self, market: str, alt: dict, btc: dict, mode: MarketMode) -> Signal:
        abs_score, ar = absolute_score(alt, self.cfg)
        rel_score, rr = relative_score(alt, btc)
        chase, cr = anti_chase(alt, self.cfg)
        rsi_ok = self.cfg.rsi_min <= alt.get("rsi", 50) <= self.cfg.rsi_max
        trigger = bool(alt.get("williams_breakout") or alt.get("bb_breakout") or alt.get("vwap_reclaim"))
        side = SignalSide.NONE
        track = SignalTrack.ALT_HYBRID
        score = 0.0
        reasons: list[str] = []

        if mode == MarketMode.CO_BULL:
            # 상대강도가 0이어도 전체 동반상승이면 절대 모멘텀 트랙으로 진입 가능.
            score = abs_score * 0.80 + rel_score * 0.20
            track = SignalTrack.ALT_ABSOLUTE if rel_score < 60 else SignalTrack.ALT_HYBRID
            buy = abs_score >= self.cfg.alt_absolute_buy_score and trigger and rsi_ok and not chase
            reasons = ["동반강세: 절대모멘텀 우선"] + ar + rr[:2]
            side = SignalSide.BUY if buy else SignalSide.WATCH if abs_score >= 55 else SignalSide.NONE
        elif mode == MarketMode.ROTATION:
            score = abs_score * 0.45 + rel_score * 0.55
            track = SignalTrack.ALT_RELATIVE if rel_score >= abs_score else SignalTrack.ALT_HYBRID
            buy = rel_score >= self.cfg.alt_relative_buy_score and abs_score >= 55 and trigger and rsi_ok and not chase
            reasons = ["로테이션: BTC 대비 상대강도 우선"] + rr + ar[:3]
            side = SignalSide.BUY if buy else SignalSide.WATCH if rel_score >= 55 else SignalSide.NONE
        elif mode == MarketMode.BTC_ONLY:
            score = abs_score * 0.4 + rel_score * 0.6
            reasons = ["BTC_ONLY: 알트 신규 BUY 차단"] + rr[:3]
            side = SignalSide.WATCH if rel_score >= 70 and abs_score >= 60 else SignalSide.NONE
        else:
            score = abs_score * 0.5 + rel_score * 0.5
            reasons = [f"{mode.value}: 신규 BUY 차단"]
            side = SignalSide.NONE

        if chase:
            reasons += ["Anti-Chase: " + x for x in cr]
            if side == SignalSide.BUY:
                side = SignalSide.WATCH
        return Signal(
            market=market,
            side=side,
            track=track,
            score=float(score),
            mode=mode,
            price=float(alt.get("close", 0)),
            reasons=reasons[:10],
            metadata={"absolute_score": abs_score, "relative_score": rel_score},
        )
