# MASTER MARKET COMPASS V5 배포

## 1. Cloudflare Worker

기존 Worker `btc-alt-scalper-v7`를 그대로 사용합니다.

Cloudflare → Workers & Pages → `btc-alt-scalper-v7` → Edit code

기존 `worker.js` 전체를 이 폴더의 `worker/worker.js` 내용으로 교체하고 Deploy 합니다.

### 변경하면 안 되는 것
- Worker 이름
- KV Binding 이름 `SCALPER_KV`
- 기존 KV namespace
- `SCALPER_PIN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

새 KV를 만들 필요가 없습니다.

## 2. GitHub Pages

기존 저장소의 `docs/index.html`을 V5 폴더의 `docs/index.html`로 교체합니다.

GitHub Pages가 `docs` 폴더를 배포하도록 기존 설정을 유지합니다.

## 3. 확인

페이지에서 Worker URL을 다음처럼 유지합니다.

`https://btc-alt-scalper-v7.suby716.workers.dev`

PIN 입력 후:

1. 연결 점검
2. 전체 재스캔
3. Telegram 테스트

순서로 확인합니다.

연결 점검에서 `version`이 `MASTER MARKET COMPASS V5.0 · FUTURE MOAT INVESTOR`로 표시되어야 합니다.

## 4. V5에서 처음 볼 것

첫 화면의 "FUTURE MOAT DISCOVERY"에서 다음을 확인합니다.

- Future
- Bottleneck
- Moat
- Structural Growth
- Quality
- Value
- Thesis Breaker

`EMERGING` 영역은 미래성은 높지만 아직 실적/상용화 검증이 부족한 기업을 분리해서 보여줍니다.
