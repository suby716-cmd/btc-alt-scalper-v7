from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncIterator
from urllib.parse import urlencode, unquote

import aiohttp
import jwt
import websockets


log = logging.getLogger(__name__)
REST = "https://api.upbit.com"
WS_PUBLIC = "wss://api.upbit.com/websocket/v1"


class UpbitAPIError(RuntimeError):
    pass


class AsyncUpbitClient:
    def __init__(self, access_key: str = "", secret_key: str = "", timeout: int = 10, max_retries: int = 4):
        self.access_key = access_key
        self.secret_key = secret_key
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.max_retries = max_retries
        self._session: aiohttp.ClientSession | None = None

    async def __aenter__(self):
        self._session = aiohttp.ClientSession(timeout=self.timeout)
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self.close()

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    @staticmethod
    def _query_string(data: dict[str, Any]) -> str:
        return unquote(urlencode(data, doseq=True))

    def _auth_headers(self, data: dict[str, Any] | None = None) -> dict[str, str]:
        if not self.access_key or not self.secret_key:
            raise UpbitAPIError("UPBIT_ACCESS_KEY/UPBIT_SECRET_KEY가 없습니다.")
        payload: dict[str, Any] = {"access_key": self.access_key, "nonce": str(uuid.uuid4())}
        if data:
            qs = self._query_string(data)
            payload["query_hash"] = hashlib.sha512(qs.encode()).hexdigest()
            payload["query_hash_alg"] = "SHA512"
        token = jwt.encode(payload, self.secret_key, algorithm="HS512")
        return {"Authorization": f"Bearer {token}"}

    async def request(self, method: str, path: str, *, params: dict | None = None, json_body: dict | None = None, auth: bool = False) -> Any:
        if self._session is None:
            self._session = aiohttp.ClientSession(timeout=self.timeout)
        data_for_auth = params if params else json_body
        headers = self._auth_headers(data_for_auth) if auth else {}
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        last_err: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                async with self._session.request(method, REST + path, params=params, json=json_body, headers=headers) as resp:
                    text = await resp.text()
                    if resp.status in (429, 418):
                        wait = min(8.0, (2 ** attempt) + random.random())
                        log.warning("Upbit rate limit %s; %.1fs backoff", resp.status, wait)
                        await asyncio.sleep(wait)
                        continue
                    if resp.status >= 400:
                        raise UpbitAPIError(f"{method} {path} -> {resp.status}: {text[:500]}")
                    return json.loads(text) if text else {}
            except (aiohttp.ClientError, asyncio.TimeoutError, UpbitAPIError) as e:
                last_err = e
                if isinstance(e, UpbitAPIError) and "400:" in str(e):
                    raise
                if attempt + 1 >= self.max_retries:
                    break
                await asyncio.sleep(min(8.0, 0.5 * (2 ** attempt) + random.random() * 0.2))
        raise UpbitAPIError(f"API request failed after retries: {last_err}")

    async def candles(self, market: str, unit: int = 5, count: int = 200, to: str | None = None) -> list[dict]:
        p = {"market": market, "count": min(200, max(1, count))}
        if to: p["to"] = to
        return await self.request("GET", f"/v1/candles/minutes/{unit}", params=p)

    async def day_candles(self, market: str, count: int = 200, to: str | None = None) -> list[dict]:
        p = {"market": market, "count": min(200, max(1, count))}
        if to: p["to"] = to
        return await self.request("GET", "/v1/candles/days", params=p)

    async def fetch_ohlcv_history(self, market: str, unit: int, bars: int) -> list[dict]:
        """고정 200봉 페이지 + oldest-1ms cursor. 마지막 partial-page 정체를 피합니다."""
        out: dict[str, dict] = {}
        to: str | None = None
        while len(out) < bars:
            page = await self.candles(market, unit=unit, count=200, to=to)
            if not page:
                break
            for c in page:
                out[c["candle_date_time_utc"]] = c
            oldest = min(page, key=lambda x: x["candle_date_time_utc"])
            dt = datetime.fromisoformat(oldest["candle_date_time_utc"]).replace(tzinfo=timezone.utc)
            to = datetime.fromtimestamp(dt.timestamp() - 0.001, tz=timezone.utc).isoformat().replace("+00:00", "Z")
            if len(page) < 200:
                break
            await asyncio.sleep(0.12)
        rows = sorted(out.values(), key=lambda x: x["candle_date_time_utc"])
        return rows[-bars:]

    async def accounts(self) -> list[dict]:
        return await self.request("GET", "/v1/accounts", auth=True)

    async def order_test(self, order: dict) -> dict:
        return await self.request("POST", "/v1/orders/test", json_body=order, auth=True)

    async def create_order(self, order: dict) -> dict:
        return await self.request("POST", "/v1/orders", json_body=order, auth=True)

    async def get_order(self, uuid_value: str) -> dict:
        return await self.request("GET", "/v1/order", params={"uuid": uuid_value}, auth=True)

    async def best_ioc_buy(self, market: str, krw_amount: float, test: bool = False) -> dict:
        order = {"market": market, "side": "bid", "ord_type": "best", "price": str(int(krw_amount)), "time_in_force": "ioc", "identifier": str(uuid.uuid4())}
        return await (self.order_test(order) if test else self.create_order(order))

    async def best_ioc_sell(self, market: str, volume: float, test: bool = False) -> dict:
        order = {"market": market, "side": "ask", "ord_type": "best", "volume": f"{volume:.12f}".rstrip("0").rstrip("."), "time_in_force": "ioc", "identifier": str(uuid.uuid4())}
        return await (self.order_test(order) if test else self.create_order(order))


async def public_stream(markets: list[str], reconnect_cap: int = 30) -> AsyncIterator[dict]:
    """5분 캔들 + 호가를 한 연결에서 수신. 끊기면 지수 backoff로 재접속합니다."""
    backoff = 1
    while True:
        try:
            async with websockets.connect(WS_PUBLIC, ping_interval=20, ping_timeout=20, close_timeout=5, max_size=2**22) as ws:
                req = [
                    {"ticket": str(uuid.uuid4())},
                    {"type": "candle.5m", "codes": markets, "is_only_realtime": True},
                    {"type": "orderbook", "codes": markets, "is_only_realtime": True},
                    {"format": "DEFAULT"},
                ]
                await ws.send(json.dumps(req))
                backoff = 1
                async for raw in ws:
                    if isinstance(raw, bytes):
                        raw = raw.decode("utf-8")
                    try:
                        yield json.loads(raw)
                    except json.JSONDecodeError:
                        log.warning("Invalid WS payload ignored")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.exception("WebSocket disconnected: %s", e)
            await asyncio.sleep(backoff)
            backoff = min(reconnect_cap, backoff * 2)
