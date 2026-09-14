from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
import aiosqlite

from .models import Position, RiskPlan, MarketMode, SignalTrack


class StateStore:
    def __init__(self, path: str = "data/state.db"):
        self.path = path

    async def init(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(self.path) as db:
            await db.execute("""CREATE TABLE IF NOT EXISTS positions (market TEXT PRIMARY KEY, payload TEXT NOT NULL)""")
            await db.execute("""CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, kind TEXT, payload TEXT)""")
            await db.commit()

    async def save_position(self, p: Position):
        payload = json.dumps({
            "market": p.market, "entry": p.entry, "quantity": p.quantity, "opened_at_ms": p.opened_at_ms,
            "plan": asdict(p.plan), "track": p.track.value, "mode_at_entry": p.mode_at_entry.value,
            "peak": p.peak, "remaining_qty": p.remaining_qty, "tp1_done": p.tp1_done, "tp2_done": p.tp2_done,
            "realized_pnl_krw": p.realized_pnl_krw, "entry_fee_krw": p.entry_fee_krw,
        }, ensure_ascii=False)
        async with aiosqlite.connect(self.path) as db:
            await db.execute("INSERT INTO positions(market,payload) VALUES(?,?) ON CONFLICT(market) DO UPDATE SET payload=excluded.payload", (p.market, payload))
            await db.commit()

    async def delete_position(self, market: str):
        async with aiosqlite.connect(self.path) as db:
            await db.execute("DELETE FROM positions WHERE market=?", (market,))
            await db.commit()

    async def load_positions(self) -> dict[str, Position]:
        out = {}
        async with aiosqlite.connect(self.path) as db:
            async with db.execute("SELECT market,payload FROM positions") as cur:
                async for market, payload in cur:
                    x = json.loads(payload)
                    plan = RiskPlan(**x["plan"])
                    out[market] = Position(
                        market=market, entry=x["entry"], quantity=x["quantity"], opened_at_ms=x["opened_at_ms"], plan=plan,
                        track=SignalTrack(x["track"]), mode_at_entry=MarketMode(x["mode_at_entry"]), peak=x["peak"], remaining_qty=x["remaining_qty"],
                        tp1_done=x.get("tp1_done", False), tp2_done=x.get("tp2_done", False), realized_pnl_krw=x.get("realized_pnl_krw", 0), entry_fee_krw=x.get("entry_fee_krw", 0),
                    )
        return out

    async def event(self, ts: int, kind: str, payload: dict):
        async with aiosqlite.connect(self.path) as db:
            await db.execute("INSERT INTO events(ts,kind,payload) VALUES(?,?,?)", (ts, kind, json.dumps(payload, ensure_ascii=False)))
            await db.commit()
