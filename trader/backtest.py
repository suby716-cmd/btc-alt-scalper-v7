from __future__ import annotations

from dataclasses import dataclass, asdict
import math
from pathlib import Path
from typing import Any
import numpy as np
import pandas as pd

from .config import AppConfig
from .indicators import enrich, feature_row
from .models import BacktestMetrics, MarketMode, Position, SignalSide, TradeRecord
from .regime import classify_market_mode
from .risk import RiskManager
from .strategy import DualTrackStrategy


@dataclass
class BacktestReport:
    metrics: BacktestMetrics
    trades: pd.DataFrame
    per_market: pd.DataFrame
    universe_contribution: pd.DataFrame


def _daily_from_5m(df: pd.DataFrame) -> pd.DataFrame:
    k = df.copy()
    idx = pd.to_datetime(k.index, utc=True).tz_convert("Asia/Seoul")
    k["session"] = idx.date
    out = k.groupby("session").agg(open=("open", "first"), high=("high", "max"), low=("low", "min"), close=("close", "last"), volume=("volume", "sum"))
    out.index = pd.to_datetime(out.index).tz_localize("Asia/Seoul").tz_convert("UTC")
    return out


def _btc_daily_state_at(daily: pd.DataFrame, ts: pd.Timestamp) -> tuple[str, float]:
    # 백테스트 핵심은 현재 5분봉 이전에 완전히 끝난 일봉만 사용한다는 점입니다.
    kst = ts.tz_convert("Asia/Seoul")
    day_start = kst.normalize().tz_convert("UTC")
    hist = daily[daily.index < day_start]
    if len(hist) < 60:
        return "RANGE", 0.0
    from .regime import btc_long_regime
    state, score, _ = btc_long_regime(hist)
    return state, score


class PortfolioBacktester:
    def __init__(self, cfg: AppConfig):
        self.cfg = cfg
        self.strategy = DualTrackStrategy(cfg.strategy)
        self.risk = RiskManager(cfg.risk)

    def run(self, raw: dict[str, pd.DataFrame]) -> BacktestReport:
        features = {m: enrich(df, self.cfg.strategy.williams_k) for m, df in raw.items() if not df.empty}
        btc_m = self.cfg.universe.btc
        if btc_m not in features:
            raise ValueError("BTC 데이터가 필요합니다.")
        btc = features[btc_m]
        daily = _daily_from_5m(raw[btc_m])
        timeline = btc.index
        positions: dict[str, Position] = {}
        pending: dict[str, tuple] = {}
        trades: list[TradeRecord] = []
        closed_returns: list[float] = []
        equity = self.cfg.risk.initial_equity_krw
        equity_curve = [equity]
        last_exit_idx: dict[str, int] = {}
        fee_rate = self.cfg.risk.fee_pct_per_side / 100
        slip = self.cfg.risk.slippage_pct_per_side / 100
        warm = self.cfg.backtest.warmup_bars
        alt_markets = [m for m in self.cfg.universe.alts if m in features]

        for i in range(warm, len(timeline) - 1):
            ts = timeline[i]
            # 다음 봉 시가에 진입: 현재 완료봉 신호가 미래를 보지 않게 합니다.
            for market, info in list(pending.items()):
                if info[0] != i:
                    continue
                sig = info[1]
                nxt = features[market].reindex([timeline[i]]).dropna()
                if nxt.empty:
                    del pending[market]; continue
                entry = float(nxt.iloc[0]["open"]) * (1 + slip)
                atr_pct = float(features[market].iloc[i - 1].get("atr_pct", 0.3))
                plan = self.risk.plan(atr_pct, sig.mode)
                qty = self.risk.position_size(equity, entry, plan)
                if qty <= 0:
                    del pending[market]; continue
                fee = entry * qty * fee_rate
                equity -= fee
                positions[market] = Position(market, entry, qty, int(ts.timestamp()*1000), plan, sig.track, sig.mode, entry, qty, entry_fee_krw=fee)
                trades.append(TradeRecord(market, "BUY", qty, entry, int(ts.timestamp()*1000), sig.track.value, fee_krw=fee))
                del pending[market]

            # 보유 청산 처리
            for market, pos in list(positions.items()):
                df = features[market]
                if ts not in df.index:
                    continue
                bar = df.loc[ts]
                events = self.risk.check_position(pos, float(bar.high), float(bar.low), float(bar.close))
                for ev in events:
                    exit_px = ev.reference_price * (1 - slip)
                    qty = min(pos.remaining_qty if ev.action == "CLOSE_ALL" else ev.quantity, ev.quantity)
                    if qty <= 0:
                        continue
                    gross = (exit_px - pos.entry) * qty
                    fee = exit_px * qty * fee_rate
                    pnl = gross - fee
                    equity += pnl
                    pos.realized_pnl_krw += pnl
                    if ev.action == "CLOSE_ALL":
                        pos.remaining_qty = 0
                    trades.append(TradeRecord(market, "SELL", qty, exit_px, int(ts.timestamp()*1000), ev.reason, fee_krw=fee))
                if pos.remaining_qty <= 1e-15:
                    base = max(pos.entry * pos.quantity, 1e-9)
                    closed_returns.append(pos.realized_pnl_krw / base * 100)
                    last_exit_idx[market] = i
                    del positions[market]

            if len(positions) >= self.cfg.risk.max_concurrent_positions:
                equity_curve.append(equity); continue

            btc_row = btc.iloc[i]
            btc_feat = feature_row(btc.iloc[: i + 1])
            alt_feats = {}
            for m in alt_markets:
                df = features[m]
                if ts in df.index:
                    j = df.index.get_loc(ts)
                    if isinstance(j, (int, np.integer)) and j >= warm:
                        alt_feats[m] = feature_row(df.iloc[: j + 1])
            dstate, dscore = _btc_daily_state_at(daily, ts)
            reg = classify_market_mode(btc_feat, alt_feats, dstate, dscore, self.cfg.strategy.co_bull_breadth, self.cfg.strategy.rotation_breadth, self.cfg.strategy.btc_only_breadth_ceiling)

            candidates = [self.strategy.btc_signal(btc_feat, reg.mode)]
            candidates += [self.strategy.alt_signal(m, f, btc_feat, reg.mode) for m, f in alt_feats.items()]
            buys = sorted([s for s in candidates if s.side == SignalSide.BUY], key=lambda x: x.score, reverse=True)
            room = self.cfg.risk.max_concurrent_positions - len(positions)
            for sig in buys[:room]:
                if sig.market in positions or sig.market in pending:
                    continue
                if i - last_exit_idx.get(sig.market, -10_000) < max(1, self.cfg.risk.cooldown_minutes // 5):
                    continue
                pending[sig.market] = (i + 1, sig)
            equity_curve.append(equity)

        # 마지막 봉 종가로 잔여 포지션 정리(백테스트 보고용)
        last_ts = timeline[-1]
        for market, pos in list(positions.items()):
            if last_ts not in features[market].index:
                continue
            px = float(features[market].loc[last_ts, "close"]) * (1 - slip)
            fee = px * pos.remaining_qty * fee_rate
            pnl = (px - pos.entry) * pos.remaining_qty - fee
            equity += pnl
            pos.realized_pnl_krw += pnl
            trades.append(TradeRecord(market, "SELL", pos.remaining_qty, px, int(last_ts.timestamp()*1000), "EOD_BACKTEST_CLOSE", fee_krw=fee))
            closed_returns.append(pos.realized_pnl_krw / max(pos.entry * pos.quantity, 1e-9) * 100)

        metrics = self._metrics(closed_returns, equity_curve, equity)
        tdf = pd.DataFrame([asdict(t) for t in trades])
        market_stats = self._per_market(tdf)
        contribution = market_stats[["market", "net_pnl_krw", "closed_sells"]].copy() if not market_stats.empty else market_stats
        if not contribution.empty:
            total = contribution["net_pnl_krw"].sum()
            contribution["contribution_pct"] = np.where(total != 0, contribution["net_pnl_krw"] / abs(total) * 100, 0)
        return BacktestReport(metrics, tdf, market_stats, contribution)

    def _metrics(self, rets: list[float], curve: list[float], equity: float) -> BacktestMetrics:
        wins = [x for x in rets if x > 0]
        losses = [x for x in rets if x <= 0]
        gp, gl = sum(wins), abs(sum(losses))
        pf = gp / gl if gl > 0 else math.inf if gp > 0 else 0.0
        arr = np.asarray(curve, dtype=float)
        peaks = np.maximum.accumulate(arr) if len(arr) else np.array([1.0])
        dd = (arr / np.where(peaks == 0, 1, peaks) - 1) * 100 if len(arr) else np.array([0.0])
        max_dd = abs(float(np.nanmin(dd))) if len(dd) else 0.0
        cons = mx = 0
        for x in rets:
            if x <= 0: cons += 1; mx = max(mx, cons)
            else: cons = 0
        net = (equity / self.cfg.risk.initial_equity_krw - 1) * 100
        return BacktestMetrics(len(rets), len(wins), len(losses), len(wins)/len(rets)*100 if rets else 0.0, net, float(np.mean(rets)) if rets else 0.0, pf, max_dd, mx)

    def _per_market(self, tdf: pd.DataFrame) -> pd.DataFrame:
        if tdf.empty:
            return pd.DataFrame(columns=["market", "net_pnl_krw", "closed_sells"])
        rows = []
        for m, g in tdf.groupby("market"):
            buys = g[g.side == "BUY"]
            sells = g[g.side == "SELL"]
            # FIFO 정밀매칭 대신 총 현금흐름 기여를 표시합니다.
            cash = -(buys.quantity * buys.price).sum() - buys.fee_krw.sum() + (sells.quantity * sells.price).sum() - sells.fee_krw.sum()
            rows.append({"market": m, "net_pnl_krw": float(cash), "closed_sells": int(len(sells))})
        return pd.DataFrame(rows).sort_values("net_pnl_krw", ascending=False)
