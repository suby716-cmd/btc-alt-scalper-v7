from trader.config import StrategyConfig
from trader.models import MarketMode, SignalSide
from trader.strategy import DualTrackStrategy


def strong():
    return {"close":110,"ema9":108,"ema20":105,"ema50":100,"rsi":62,"atr":1,"atr_pct":.9,"vwap":104,"ret_5m":.2,"ret_15m":.6,"ret_1h":1.2,"volume_ratio":1.5,"ema20_dist_atr":1.0,"bb_breakout":True,"vwap_reclaim":False,"stoch_cross_up":True,"stoch_k":55,"stoch_d":45,"macd_hist":1.0,"macd_accel":True,"williams_breakout":True}


def test_cobull_allows_absolute_alt_when_relative_flat():
    cfg=StrategyConfig()
    s=DualTrackStrategy(cfg)
    btc=strong(); alt=strong(); alt["ret_15m"]=btc["ret_15m"]; alt["ret_1h"]=btc["ret_1h"]; alt["rsi"]=btc["rsi"]
    sig=s.alt_signal("KRW-ETH",alt,btc,MarketMode.CO_BULL)
    assert sig.side == SignalSide.BUY
    assert sig.metadata["relative_score"] <= 65


def test_btc_only_blocks_alt_buy():
    cfg=StrategyConfig(); s=DualTrackStrategy(cfg)
    sig=s.alt_signal("KRW-ETH",strong(),strong(),MarketMode.BTC_ONLY)
    assert sig.side != SignalSide.BUY
