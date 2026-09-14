import numpy as np
import pandas as pd
from trader.indicators import enrich


def sample(n=400):
    idx = pd.date_range("2026-01-01", periods=n, freq="5min", tz="UTC")
    base = np.linspace(100, 130, n) + np.sin(np.arange(n)/9)
    return pd.DataFrame({"open":base-.2,"high":base+.5,"low":base-.5,"close":base,"volume":np.linspace(10,20,n)}, index=idx)


def test_enrich_has_core_indicators():
    x = enrich(sample())
    for c in ["rsi","atr","bb_width","vwap","stoch_k","macd_hist","williams_target"]:
        assert c in x.columns
    assert x["vwap"].notna().sum() > 0
