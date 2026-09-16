# V4 배포 순서

## GitHub
- `docs/index.html`을 기존 파일과 교체합니다.

## Cloudflare Worker
- `worker/worker.js`와 `worker/wrangler.toml`을 교체합니다.
- 기존 Worker 이름은 `btc-alt-scalper-v7`이므로 새 Worker를 만들 필요가 없습니다.
- 기존 `SCALPER_KV`, `SCALPER_PIN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`를 그대로 사용합니다.

## 확인
1. GitHub Pages 접속
2. Worker URL 입력
3. 기존 PIN 입력
4. `연결 점검` → `kv:true`, `telegramConfigured:true`, `pinConfigured:true` 확인
5. `전체 재스캔` 실행

## V4에서 추가된 핵심
- IREN / ABCL / CRCL / BAH / SPCX 포함
- 구조적 성장/미래산업 분류
- Discovery
- Thesis Survival
- 미래산업/구조적 성장 Telegram watch
