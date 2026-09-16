# V3 교체 배포 순서

## A. GitHub

기존 `btc-alt-scalper-v7` 저장소에서 먼저 현재 브랜치를 백업하거나 새 브랜치를 만듭니다.

그 다음 다음 4개 파일을 교체합니다.

```text
docs/index.html
worker/worker.js
worker/wrangler.toml
README.md
```

## B. Cloudflare

기존 Worker를 그대로 사용하고 코드를 `worker/worker.js` 내용으로 교체합니다.

기존 KV binding은 반드시 다음과 같이 유지합니다.

```text
SCALPER_KV
```

기존 Secret도 유지합니다.

```text
SCALPER_PIN
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

새 Telegram Bot이나 새 KV를 만들 필요가 없습니다.

## C. Cron

V3는 장기투자 시스템이므로 기본 Cron을 1시간으로 설정합니다.

```text
0 * * * *
```

## D. 브라우저 점검

GitHub Pages에서:

1. Worker URL 입력
2. 기존 PIN 입력
3. `연결 점검`
4. `Telegram 테스트`
5. `전체 재스캔`

순서로 확인합니다.

## E. 정상 동작 기준

상태 화면에서 다음이 모두 정상이어야 합니다.

- KV 연결됨
- Telegram 설정됨
- PIN 설정됨
- 한국/미국/암호자산 스캔 결과 표시

데이터가 없는 항목은 임의의 0점으로 채우지 않고 제한 상태로 표시하는 것을 원칙으로 합니다.
