# BTC ALT REGIME TRADER v10.1.0 배포

1. Cloudflare Worker에 `worker.js` 전체를 교체하고 Deploy 합니다.
2. Worker 환경변수/Secret: `SCALPER_PIN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
3. KV Namespace `SCALPER_KV`를 Worker Binding에 연결합니다.
4. Cron은 `*/5 * * * *`로 설정합니다.
5. GitHub Pages 저장소의 `docs/index.html`을 교체합니다.
6. 사이트에서 Worker URL/PIN을 입력하고 `설정 저장` → `연결 점검`을 누릅니다.
7. Worker URL/health에서 `version: v10.1.0` 및 `/market`이 확인되면 새 화면을 사용합니다.

## 김프 계산
김프는 `Upbit KRW 현재가 / (Binance USDT 현재가 × Upbit USDT/KRW) - 1` 방식입니다. 거래소 간 가격 차이와 환산 기준 때문에 다른 사이트와 소폭 다를 수 있습니다.

## 수동매매
주문은 자동 실행하지 않습니다. Telegram은 BUY/SELL 검토 알림 전용입니다.
