# MASTER MARKET COMPASS V3 — btc-alt-scalper-v7 Overlay

기존 `btc-alt-scalper-v7` 저장소의 GitHub Pages / Cloudflare Worker / KV / Telegram 인프라를 그대로 재사용하면서, 스캘퍼 화면과 단기 매매 엔진을 장기투자 의사결정 시스템으로 교체하는 버전입니다.

## 교체 파일

```text
docs/index.html
worker/worker.js
worker/wrangler.toml
README.md
```

기존 저장소에 업로드할 때는 위 파일을 같은 경로에 교체하면 됩니다.

## 핵심 엔진

- 한국주식 / 미국주식 / KRW 암호자산 통합 스캔
- Quality / Growth / Base Valuation
- 산업별 상대 밸류에이션
- 경제적 해자 정량 Proxy
- 최근 분기 실적 가속 / 둔화
- `좋은 기업의 급락` 탐지
- 투자논리(Thesis) Ledger
- Thesis가 유지되는 동안 가격 하락만으로 SELL하지 않음
- Buffett / Lynch / Druckenmiller / Graham / 파돌부부 렌즈
- Cloudflare KV 보유종목·투자논리 저장
- Telegram 알림
- 자동 주문 없음

## 기존 V7 인프라 재사용

기존 `SCALPER_KV`, `SCALPER_PIN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`를 그대로 사용합니다. 따라서 새 KV와 새 Telegram Bot을 만들 필요가 없습니다.

### 주의

기존 V7의 KV에는 스캘퍼용 `positions` 데이터가 남아 있을 수 있습니다. V3는 `MMC_*_V3` 키를 사용하므로 기존 데이터와 충돌하지 않습니다.

## 배포

1. 기존 GitHub 저장소의 `docs/index.html`을 교체
2. `worker/worker.js` 교체
3. `worker/wrangler.toml` 교체
4. Cloudflare Worker에 배포
5. 기존 Secret이 다음 이름인지 확인
   - `SCALPER_PIN`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
6. GitHub Pages 접속 후 Worker URL과 PIN 입력
7. `연결 점검` → `Telegram 테스트` → `전체 재스캔` 순서로 확인

## 데이터 주의

주식 데이터는 Yahoo Finance 공개 엔드포인트를 사용합니다. 일부 펀더멘털 필드가 누락되면 `DATA LIMITED`로 표시합니다. 암호자산에는 기업 재무제표가 없으므로 시장구조 Proxy만 사용합니다.

이 시스템의 점수는 확률이나 수익률 보장이 아니며, 투자 결정을 대신하지 않습니다.
