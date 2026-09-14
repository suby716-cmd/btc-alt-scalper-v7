from trader.config import RiskConfig
from trader.models import MarketMode, Position, SignalTrack
from trader.risk import RiskManager


def test_stop_loss_event():
    rm = RiskManager(RiskConfig())
    plan = rm.plan(1.0, MarketMode.ROTATION)
    p = Position("KRW-ETH", 100, 10, 0, plan, SignalTrack.ALT_HYBRID, MarketMode.ROTATION, 100, 10)
    ev = rm.check_position(p, high=101, low=98, close=99)
    assert ev and ev[0].reason == "STOP_LOSS"
