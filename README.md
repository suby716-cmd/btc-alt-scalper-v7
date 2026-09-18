[README.txt](https://github.com/user-attachments/files/32397970/README.txt)
BTC ALT REGIME TRADER v10.2.4.3
- Fixes Kimchi source failure when Binance returns HTTP 451 from Cloudflare egress.
- Keeps Binance as preferred source.
- Falls back to CoinGecko public USD prices when Binance is unavailable.
- /market now reports referenceSource and fallbackStatus for diagnostics.
- Existing Upbit KRW/USDT conversion and other Worker routes are preserved.
- worker.js passed `node --check` before packaging.

Deploy worker.js to Cloudflare, then test:
/health
/market?symbols=BTC,ETH,SOL
