from __future__ import annotations

import argparse
from dataclasses import asdict, replace
import asyncio
import logging
import os
from pathlib import Path
from dotenv import load_dotenv

from .backtest import PortfolioBacktester
from .config import load_config
from .data import load_universe
from .engine import LiveEngine
from .upbit import AsyncUpbitClient
from .validation import validate_windows, compare_12_vs_14


def setup_logging():
    Path("logs").mkdir(exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.StreamHandler(), logging.FileHandler("logs/trader.log", encoding="utf-8")],
    )


async def run_backtest(args):
    cfg = load_config(args.config)
    markets = [cfg.universe.btc, *cfg.universe.alts]
    async with AsyncUpbitClient(timeout=cfg.execution.request_timeout_seconds, max_retries=cfg.execution.max_retries) as client:
        raw = await load_universe(client, markets, args.days, cfg.backtest.cache_dir, cfg.execution.public_rest_concurrency)
    report = PortfolioBacktester(cfg).run(raw)
    print("\n=== v8.4 Dual-Track Backtest ===")
    for k, v in asdict(report.metrics).items():
        print(f"{k}: {v}")
    print("\n=== Universe Contribution ===")
    print(report.universe_contribution.to_string(index=False) if not report.universe_contribution.empty else "no trades")
    if cfg.backtest.export_trades_csv:
        out = Path(cfg.backtest.cache_dir) / f"trades_{args.days}d.csv"
        report.trades.to_csv(out, index=False)
        print(f"trades csv: {out}")


async def run_validate(args):
    cfg = load_config(args.config)
    markets = [cfg.universe.btc, *cfg.universe.alts]
    days = max(90, args.days)
    async with AsyncUpbitClient(timeout=cfg.execution.request_timeout_seconds, max_retries=cfg.execution.max_retries) as client:
        raw = await load_universe(client, markets, days, cfg.backtest.cache_dir, cfg.execution.public_rest_concurrency)
    print("\n=== 30/60/90 + 비용 스트레스 ===")
    print(validate_windows(cfg, raw).to_string(index=False))
    print("\n=== 기존 12개 vs ADA/NEAR 포함 14개 ===")
    print(compare_12_vs_14(cfg, raw).to_string(index=False))


async def run_engine(args):
    cfg = load_config(args.config)
    engine = LiveEngine(cfg)
    await engine.run()


def main():
    load_dotenv()
    setup_logging()
    p = argparse.ArgumentParser(description="BTC ALT REGIME TRADER v8.4 dual-track Python engine")
    p.add_argument("command", choices=["backtest", "validate", "paper", "live"])
    p.add_argument("--config", default="config.yaml")
    p.add_argument("--days", type=int, default=90)
    args = p.parse_args()
    if args.command == "backtest":
        asyncio.run(run_backtest(args))
    elif args.command == "validate":
        asyncio.run(run_validate(args))
    else:
        if args.command == "paper":
            os.environ["TRADING_MODE"] = "PAPER"
        elif args.command == "live":
            os.environ["TRADING_MODE"] = "LIVE"
        asyncio.run(run_engine(args))


if __name__ == "__main__":
    main()
