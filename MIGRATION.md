# v8.3.1 → v8.4.0 Python Engine 구조 정리

## 살린 핵심

- BTC 장기 Regime: 하락장/횡보장에서 무조건 거래 횟수를 늘리지 않는 철학.
- ATR 기반 동적 Stop/TP/Trail.
- BTC 대비 알트 상대강도: 제거하지 않고 **ROTATION 전용 트랙**으로 축소.
- Anti-Chase: 과열 급등 뒤 높은 점수를 무조건 좋은 신호로 보지 않음.
- 수수료/슬리피지 포함 백테스트와 다음 봉 진입(no look-ahead).
- 거래별/코인별 성과와 Universe Contribution.

## 핵심에서 뺀 것

- 거시경제/뉴스를 5분 진입점수에 직접 섞는 방식: 느린 데이터이므로 코어 스캘퍼 신호에서 분리. 기존 웹 Context는 위험 오버레이/수동 참고로 유지 권장.
- 패턴 이름을 많이 붙여 점수를 누적하는 방식: 핵심 Python 엔진은 변동성 돌파·BB squeeze·VWAP·StochRSI·MACD 중심으로 단순화.
- `Score가 높을수록 무조건 좋다`는 가정: 현재 연구에서 75~79가 더 나았던 점을 반영해 과열 방지.
- 상대강도를 모든 ALT BUY의 hard gate로 쓰는 구조: 이것이 동반상승장 누락의 근본 원인이므로 제거.

## 새 구조

### 1) CO_BULL
BTC 절대 추세가 강하고 ALT breadth가 높음. ALT는 BTC 대비 상대강도가 0에 가까워도 `Absolute Momentum Track`으로 BUY 후보가 될 수 있음.

### 2) ROTATION
ALT breadth가 있고 특정 ALT가 BTC를 이김. 기존 Relative Strength Track을 주력으로 사용.

### 3) BTC_ONLY
BTC는 강하지만 ALT breadth가 약함. BTC-Only 스캘핑만 허용하고 ALT 신규 BUY는 차단.

### 4) RANGE / BEAR
신규 롱을 줄이거나 차단.

## 4개 보조지표 역할

- Bollinger Bandwidth: 변동성 압축 → 확산/돌파.
- Anchored Daily VWAP(KST): 당일 매수/매도 우위 기준.
- StochRSI: 이미 정해진 방향 안에서 진입 타이밍.
- MACD Histogram: 추세 가속 여부.

이 4개는 각각 역할이 달라 중복 점수를 최소화합니다.
