from __future__ import annotations

from dataclasses import asdict, replace
import pandas as pd

from .backtest import PortfolioBacktester
from .config import AppConfig


def slice_days(raw: dict[str, pd.DataFrame], days: int) -> dict[str, pd.DataFrame]:
    out = {}
    for m, df in raw.items():
        if df.empty:
            out[m] = df
            continue
        end = df.index.max()
        start = end - pd.Timedelta(days=days)
        # warmup 확보를 위해 2일을 추가합니다.
        out[m] = df[df.index >= start - pd.Timedelta(days=2)].copy()
    return out


def validate_windows(cfg: AppConfig, raw: dict[str, pd.DataFrame], windows=(30, 60, 90)) -> pd.DataFrame:
    rows = []
    for d in windows:
        rep = PortfolioBacktester(cfg).run(slice_days(raw, d))
        r = asdict(rep.metrics)
        r["days"] = d
        r["scenario"] = "base"
        rows.append(r)
    # 거래비용 스트레스: fee/slippage 1.5x, 2x
    for mult in (1.5, 2.0):
        rc = replace(cfg.risk, fee_pct_per_side=cfg.risk.fee_pct_per_side * mult, slippage_pct_per_side=cfg.risk.slippage_pct_per_side * mult)
        scfg = replace(cfg, risk=rc)
        rep = PortfolioBacktester(scfg).run(slice_days(raw, max(windows)))
        r = asdict(rep.metrics)
        r["days"] = max(windows)
        r["scenario"] = f"cost_x{mult}"
        rows.append(r)
    return pd.DataFrame(rows)


def compare_12_vs_14(cfg: AppConfig, raw: dict[str, pd.DataFrame]) -> pd.DataFrame:
    alts14 = cfg.universe.alts
    alts12 = tuple(m for m in alts14 if m not in {"KRW-ADA", "KRW-NEAR"})
    rows = []
    for label, alts in (("base12", alts12), ("extended14", alts14)):
        u = replace(cfg.universe, alts=alts)
        c = replace(cfg, universe=u)
        rep = PortfolioBacktester(c).run(raw)
        r = asdict(rep.metrics)
        r["universe"] = label
        rows.append(r)
    return pd.DataFrame(rows)
