BTC ALT REGIME TRADER v10.2.4.4
Kimchi premium reliability fix

- Removes Binance and CoinGecko from the Kimchi-price path (observed 451 / 429).
- Primary overseas reference: CryptoCompare USD, one multi-symbol request.
- Secondary fallback: Coinbase public USD spot, sequentially only for missing symbols.
- Upbit KRW and KRW-USDT remain the domestic/FX reference.
- /market diagnostics: version, referenceSource, referenceStatus, coinbaseStatus, kimchiPairs.
- Frontend version bumped and a null-premium formatter is included.
- worker.js passed node --check.

Expected /market success:
version: v10.2.4.4
kimchiSourceOk: true
kimchiPairs: > 0
premium: numeric for supported pairs
