[README.md](https://github.com/user-attachments/files/32216527/README.md)
# BTC ALT REGIME TRADER (Cloudflare Worker + GitHub Pages)

Upbit KRW 시세를 기준으로 BTC 대비 알트코인의 상대강도·절대모멘텀·패턴·시장국면을 종합해 **수동매매 검토용 Telegram 알림**을 보내는 시스템입니다. 자동 주문은 실행하지 않습니다.

## 구조

- `worker/worker.js` — Cloudflare Worker. Upbit 데이터 수집, 신호 계산(BUY/WATCH/IDLE, SELL/CAUTION), Telegram 알림, KV 기반 보유 포지션 추적을 담당합니다. Cloudflare Cron으로 5분마다 자동 실행됩니다 (브라우저를 안 열어둬도 동작).
- `docs/index.html` — GitHub Pages로 배포되는 대시보드 화면. 실시간 신호 조회, 코인별 보유 체크, 백테스트/최적조건탐색/워크포워드 검증 도구를 포함합니다.
- `worker/wrangler.toml` — Worker 설정(변수 등). 배포는 Cloudflare Workers Builds의 GitHub 연동 자동배포를 사용합니다 (Root directory: `worker`).

## 핵심 기능

- **대세 Regime**: BTC 일봉 기준 STRONG_BULL/BULL/RANGE/BEAR/CRASH 자동 판정.
- **알트 국면(로테이션 vs 동반강세)**: 10개 알트의 RSI 상대강도 편차로 "알트가 BTC를 이기는 로테이션장"인지 "다 같이 오르는 동반강세장"인지 자동 분류. 동반강세장에서는 상대강도 대신 알트 자체의 절대모멘텀으로도 BUY 승격 가능(🚀 절대모멘텀형 / ⚖️ 상대강도형 구분 표시).
- **보조지표 4종**: 볼린저밴드(변동성 압축/스퀴즈-돌파), VWAP(당일 거래량가중평균가 상회 여부), StochRSI(진입 타이밍), MACD 히스토그램(추세 가속도) — confidence/합산 점수를 보강합니다.
- **패턴 분석**: 15분봉 기준 확정 패턴(더블바텀 등) 탐지.
- **보유 코인 추적**: 화면에서 실제 매수한 코인만 체크(매수가 직접 입력 가능) → 그 코인에 한해 TP1(+5%, 50% 익절 제안)/TP2(+10%)/SELL(-5% 하락)/하락반전 경계 4종 알림을 각각 1회씩 발송.
- **연구 도구**: 조건 최적 탐색, 워크포워드 검증, 비용 스트레스 테스트 (실전에 자동 반영되지 않으며, 값을 바꾸려면 `wrangler.toml`/Worker 코드를 수정 후 재배포해야 합니다).

## 문서

- [`DEPLOY.md`](./DEPLOY.md) — 배포 체크리스트 (Secrets, KV, Cron 설정 등)
- [`CHANGELOG.md`](./CHANGELOG.md) — 버전별 변경 이력
- [`RESEARCH.md`](./RESEARCH.md) — 백테스트/전략 연구 메모

## 주의

과거 성과는 미래 수익을 보장하지 않습니다. 이 시스템은 주문을 자동 실행하지 않고 Telegram 알림만 제공합니다. Worker Secrets(SCALPER_PIN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)는 절대 저장소에 커밋하지 마세요.
