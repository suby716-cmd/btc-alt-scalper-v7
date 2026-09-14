from __future__ import annotations

import numpy as np
import pandas as pd


def ema(s: pd.Series, span: int) -> pd.Series:
    return s.ewm(span=span, adjust=False, min_periods=span).mean()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    up = delta.clip(lower=0)
    down = (-delta).clip(lower=0)
    avg_up = up.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_down = down.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_up / avg_down.replace(0, np.nan)
    out = 100 - (100 / (1 + rs))
    return out.fillna(50.0)


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def bollinger(close: pd.Series, period: int = 20, std_mult: float = 2.0) -> pd.DataFrame:
    mid = close.rolling(period, min_periods=period).mean()
    std = close.rolling(period, min_periods=period).std(ddof=0)
    upper = mid + std_mult * std
    lower = mid - std_mult * std
    bandwidth = (upper - lower) / mid.replace(0, np.nan)
    return pd.DataFrame({"bb_mid": mid, "bb_upper": upper, "bb_lower": lower, "bb_width": bandwidth})


def stoch_rsi(close: pd.Series, rsi_period: int = 14, stoch_period: int = 14, smooth_k: int = 3, smooth_d: int = 3) -> pd.DataFrame:
    rv = rsi(close, rsi_period)
    lo = rv.rolling(stoch_period, min_periods=stoch_period).min()
    hi = rv.rolling(stoch_period, min_periods=stoch_period).max()
    raw = ((rv - lo) / (hi - lo).replace(0, np.nan) * 100).clip(0, 100)
    k = raw.rolling(smooth_k, min_periods=smooth_k).mean()
    d = k.rolling(smooth_d, min_periods=smooth_d).mean()
    return pd.DataFrame({"stoch_k": k, "stoch_d": d})


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    line = ema(close, fast) - ema(close, slow)
    sig = line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    hist = line - sig
    return pd.DataFrame({"macd": line, "macd_signal": sig, "macd_hist": hist})


def add_session_vwap(df: pd.DataFrame, tz: str = "Asia/Seoul") -> pd.Series:
    idx = pd.to_datetime(df.index, utc=True).tz_convert(tz)
    session = pd.Series(idx.date, index=df.index)
    typical = (df["high"] + df["low"] + df["close"]) / 3.0
    pv = typical * df["volume"]
    cum_pv = pv.groupby(session).cumsum()
    cum_v = df["volume"].groupby(session).cumsum().replace(0, np.nan)
    return cum_pv / cum_v


def add_williams_target(df: pd.DataFrame, k: float = 0.5, tz: str = "Asia/Seoul") -> pd.Series:
    idx = pd.to_datetime(df.index, utc=True).tz_convert(tz)
    session = pd.Series(idx.date, index=df.index, name="session")
    temp = df.assign(_session=session.values)
    daily = temp.groupby("_session").agg(open=("open", "first"), high=("high", "max"), low=("low", "min"))
    daily["prev_range"] = (daily["high"] - daily["low"]).shift(1)
    daily["target"] = daily["open"] + k * daily["prev_range"]
    return session.map(daily["target"]).astype(float)


def enrich(df: pd.DataFrame, williams_k: float = 0.5) -> pd.DataFrame:
    out = df.copy().sort_index()
    out["ema9"] = ema(out["close"], 9)
    out["ema20"] = ema(out["close"], 20)
    out["ema50"] = ema(out["close"], 50)
    out["rsi"] = rsi(out["close"], 14)
    out["atr"] = atr(out, 14)
    out["atr_pct"] = out["atr"] / out["close"].replace(0, np.nan) * 100
    out = out.join(bollinger(out["close"], 20, 2.0))
    out = out.join(stoch_rsi(out["close"]))
    out = out.join(macd(out["close"]))
    out["vwap"] = add_session_vwap(out)
    out["williams_target"] = add_williams_target(out, williams_k)
    out["ret_5m"] = out["close"].pct_change() * 100
    out["ret_15m"] = out["close"].pct_change(3) * 100
    out["ret_1h"] = out["close"].pct_change(12) * 100
    out["volume_ma20"] = out["volume"].rolling(20, min_periods=20).mean()
    out["volume_ratio"] = out["volume"] / out["volume_ma20"].replace(0, np.nan)
    out["ema20_dist_atr"] = (out["close"] - out["ema20"]) / out["atr"].replace(0, np.nan)
    # 최근 120봉 내 밴드폭 20% 이하를 squeeze로 보고, 이후 상단 돌파를 breakout으로 사용합니다.
    rank = out["bb_width"].rolling(120, min_periods=60).apply(lambda x: pd.Series(x).rank(pct=True).iloc[-1], raw=False)
    out["bb_squeeze"] = rank <= 0.20
    out["bb_breakout"] = out["bb_squeeze"].shift(1).rolling(6, min_periods=1).max().fillna(False).astype(bool) & (out["close"] > out["bb_upper"])
    out["vwap_reclaim"] = (out["close"] > out["vwap"]) & (out["close"].shift(1) <= out["vwap"].shift(1))
    out["stoch_cross_up"] = (out["stoch_k"] > out["stoch_d"]) & (out["stoch_k"].shift(1) <= out["stoch_d"].shift(1))
    out["stoch_cross_down"] = (out["stoch_k"] < out["stoch_d"]) & (out["stoch_k"].shift(1) >= out["stoch_d"].shift(1))
    out["macd_accel"] = (out["macd_hist"] > 0) & (out["macd_hist"] > out["macd_hist"].shift(1))
    out["williams_breakout"] = out["close"] > out["williams_target"]
    return out


def feature_row(df: pd.DataFrame) -> dict[str, float | bool]:
    r = df.iloc[-1]
    keys = [
        "open", "high", "low", "close", "volume", "ema9", "ema20", "ema50", "rsi", "atr", "atr_pct",
        "bb_mid", "bb_upper", "bb_lower", "bb_width", "stoch_k", "stoch_d", "macd", "macd_signal", "macd_hist",
        "vwap", "williams_target", "ret_5m", "ret_15m", "ret_1h", "volume_ratio", "ema20_dist_atr",
        "bb_squeeze", "bb_breakout", "vwap_reclaim", "stoch_cross_up", "stoch_cross_down", "macd_accel", "williams_breakout",
    ]
    return {k: (bool(r[k]) if isinstance(r[k], (bool, np.bool_)) else float(r[k]) if pd.notna(r[k]) else np.nan) for k in keys}
