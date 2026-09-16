# MASTER MARKET COMPASS V4

기존 BTC-ALT Scalper의 Cloudflare Worker + KV + Telegram 인프라를 재사용한 장기투자 연구 시스템입니다.

## V4 핵심
- Quality: 매출/이익/ROE/마진/FCF/부채
- Structural Growth: 구조적 성장산업과 실적 가속
- Future Industry: AI, 우주, 바이오, 방산, 전력, 스테이블코인 등
- Thesis Survival: 가격 하락보다 투자논리의 생존 여부 확인
- Good Company Crash: 좋은 기업 급락 후보 분리
- Discovery: 미래산업+구조적 성장 점수가 높은 유니버스 자동 탐색
- Masters Room: Buffett, Lynch, Druckenmiller, Graham, 파돌부부 렌즈
- KR / US / Crypto 동시 추적
- Telegram: Thesis BROKEN / 급락 / 미래산업 watch 알림

## 중요
이 시스템은 주문을 실행하지 않습니다. 모든 점수는 탐색용 프록시이며 투자수익을 보장하지 않습니다. Yahoo Finance 또는 Upbit 데이터가 지연/누락될 수 있습니다.

## 배포
1. 기존 저장소의 `docs/index.html` 교체
2. `worker/worker.js` 교체
3. `worker/wrangler.toml` 교체
4. 기존 Cloudflare Worker에 배포
5. 기존 SCALPER_PIN / Telegram Secrets / SCALPER_KV 재사용
6. GitHub Pages에서 Worker URL과 PIN 입력
