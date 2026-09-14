from __future__ import annotations

import asyncio
from pathlib import Path
import pandas as pd

from .upbit import AsyncUpbitClient


def candles_to_frame(rows: list[dict]) -> pd.DataFrame:
    data = []
    for c in rows:
        data.append({
            "time": pd.Timestamp(c["candle_date_time_utc"], tz="UTC"),
            "open": float(c["opening_price"]),
            "high": float(c["high_price"]),
            "low": float(c["low_price"]),
            "close": float(c["trade_price"]),
            "volume": float(c["candle_acc_trade_volume"]),
        })
    if not data:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    return pd.DataFrame(data).drop_duplicates("time").set_index("time").sort_index()


async def load_or_download_market(client: AsyncUpbitClient, market: str, days: int, cache_dir: str = "data") -> pd.DataFrame:
    path = Path(cache_dir)
    path.mkdir(parents=True, exist_ok=True)
    file = path / f"{market.replace('-', '_')}_5m_{days}d.csv"
    if file.exists():
        df = pd.read_csv(file, parse_dates=["time"]).set_index("time")
        df.index = pd.to_datetime(df.index, utc=True)
        return df
    bars = int(days * 24 * 12 + 260)
    rows = await client.fetch_ohlcv_history(market, 5, bars)
    df = candles_to_frame(rows)
    df.reset_index().to_csv(file, index=False)
    return df


async def load_universe(client: AsyncUpbitClient, markets: list[str], days: int, cache_dir: str, concurrency: int = 5) -> dict[str, pd.DataFrame]:
    sem = asyncio.Semaphore(concurrency)
    async def one(m: str):
        async with sem:
            return m, await load_or_download_market(client, m, days, cache_dir)
    pairs = await asyncio.gather(*(one(m) for m in markets))
    return dict(pairs)
