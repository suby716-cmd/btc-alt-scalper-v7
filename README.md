# BTC ALT REGIME TRADER v8.4.0 — Dual-Track Python Engine

현재 v8.3.1의 가장 큰 구조적 한계였던 **"ALT가 BTC보다 강해야만 BUY가 쉬운 구조"**를 제거하고, 시장 상태에 따라 상대강도와 절대모멘텀을 자동 전환하는 Python 엔진입니다.

> 중요: 이 코드는 수익을 보장하지 않습니다. v8.3.1의 기존 백테스트 성과(PF 1.07 등)는 새 v8.4 전략의 성과가 아닙니다. 새 전략은 반드시 동일 수수료/슬리피지, 워크포워드, out-of-sample로 다시 검증해야 합니다.

## 핵심 설계

- **BTC-Only 트랙**: Williams 변동성 돌파 + Bollinger squeeze/breakout + KST 일간 VWAP + StochRSI + MACD.
- **ALT Absolute Track**: BTC와 ALT가 함께 오르는 `CO_BULL`에서 상대강도 0이어도 절대추세가 강하면 진입 후보.
- **ALT Relative Track**: `ROTATION`에서 기존 BTC 대비 상대강도 우위를 활용.
- **Market Mode**: `CO_BULL / ROTATION / BTC_ONLY / RANGE / BEAR` 자동 판정.
- **리스크**: ATR 동적 SL/TP1/TP2/Trailing, 포지션 사이징, 일손실 한도, 동시 보유 제한, spread gate.
- **실행**: asyncio + Upbit REST/WebSocket, retry/backoff, 주문 생성 테스트, best+IOC 지원.
- **안전**: PAPER가 기본. LIVE는 환경변수 2개를 동시에 풀어야 주문 코드가 실행됩니다.

## 설치

```bash
python -m venv .venv
# Windows
.venv\\Scripts\\activate
pip install -r requirements.txt
copy config.example.yaml config.yaml
copy .env.example .env
```

## 90일 백테스트

```bash
python run.py backtest --days 90
```

처음에는 Upbit REST에서 과거 봉을 받고 `data/*.csv`에 캐시합니다. 이후 같은 기간은 캐시를 재사용합니다.

검증 순서는 다음을 권장합니다.

1. 기존 12개만 테스트
2. ADA/NEAR 포함 14개 테스트
3. `Universe Contribution`으로 ADA/NEAR가 PF와 기대값을 실제로 개선했는지 확인
4. 30/60/90/180일 분리
5. 워크포워드/out-of-sample
6. 비용을 1.5~2배로 올린 스트레스 테스트
7. 그 뒤 PAPER

## 검증 스위트

```bash
python run.py validate --days 90
```

이 명령은 30/60/90일과 비용 1.5배·2배 스트레스, 그리고 **기존 12개 vs ADA/NEAR 포함 14개**를 같은 엔진에서 비교합니다. 단순히 거래 횟수가 늘었다고 채택하지 않고 PF·기대값·MDD가 함께 개선되는지 확인합니다.

## PAPER 실행

```bash
python run.py paper
```

실제 주문 없이 WebSocket 5분봉/호가를 받고 동일 전략으로 PAPER 포지션을 `data/state.db`에 저장합니다.

## LIVE 잠금

`.env`에 API Key를 넣더라도 기본값으로는 실주문이 되지 않습니다.

```env
TRADING_MODE=LIVE
LIVE_TRADING=true
LIVE_CONFIRMATION=I_UNDERSTAND_REAL_ORDERS
```

세 값이 모두 맞아야 주문 경로가 열립니다. 주문 전 `/v1/orders/test`를 통과하게 설정되어 있습니다. API Key에는 출금 권한을 주지 않는 것을 권장합니다.

## 동반상승장 문제를 어떻게 해결했나

기존 상대강도 방식은 `ALT RSI - BTC RSI`, `ALT return - BTC return`이 0에 가까우면 좋은 동반상승을 놓칠 수 있습니다.

v8.4는 ALT breadth와 BTC 절대추세를 먼저 봅니다.

- BTC 강함 + ALT 다수 강함 → `CO_BULL` → **절대모멘텀 트랙 허용**
- ALT 일부가 BTC를 확실히 이김 → `ROTATION` → **상대강도 트랙 우선**
- BTC만 강함 → `BTC_ONLY` → BTC만 거래, ALT 신규진입 차단

따라서 상대강도는 폐기하지 않고 **제 역할을 하는 시장에서만 사용**합니다.

## 주의

- GitHub Pages는 Python을 실행하지 않습니다. 이 Python 엔진은 PC/VPS에서 돌리고, 기존 Pages/Cloudflare UI는 대시보드/Telegram 계층으로 유지하는 구성이 적합합니다.
- 현재 `LiveEngine`의 LIVE 주문 경로는 의도적으로 강하게 잠겨 있습니다. 실제 자금을 넣기 전에 PAPER에서 충분한 로그와 재시작 복구를 검증하세요.
- Naver 블로그 링크는 자동 접근이 차단되어 본 패키지에서는 해당 글의 내용을 직접 인용하지 않았습니다. 사용자가 대화에서 명시한 지표 역할과 현재 저장소의 연구 원칙을 기준으로 구현했습니다.
