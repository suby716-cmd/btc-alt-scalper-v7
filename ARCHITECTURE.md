# Architecture

```text
Upbit WebSocket (5m candle + orderbook)
             │
             ▼
      Async Market Data
             │
     ┌───────┴─────────┐
     │                 │
BTC Absolute      ALT Features
Trend Engine       / Breadth
     │                 │
     └───────┬─────────┘
             ▼
       Market Mode
 CO_BULL / ROTATION / BTC_ONLY / RANGE / BEAR
             │
     ┌───────┼──────────┐
     │       │          │
 BTC-Only  ALT Abs    ALT Relative
     │       │          │
     └───────┴──────────┘
             ▼
      Anti-Chase Gate
             ▼
       Risk Manager
 SL / TP1 / TP2 / Trailing / Size / Daily loss / Spread
             ▼
 PAPER (default) or LIVE double-lock
```
