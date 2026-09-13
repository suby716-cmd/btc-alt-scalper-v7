## v8.3.1 history pagination hotfix

- 백테스트/워크포워드 과거 5분봉 수집이 마지막 1봉에서 멈출 수 있던 pagination cursor 중복 문제 수정
- 다음 페이지 cursor를 마지막(가장 오래된) 봉보다 1ms 이전으로 이동해 동일 봉 재수집 방지
- 실제 요청 개수(requestCount) 기준으로 마지막 페이지 종료 조건을 판단하도록 수정
- BTC 일봉 Regime 데이터 수집에도 동일한 안전장치 적용
- 매매 전략/Score/Regime/TP·SL 로직은 변경하지 않음

# Changelog

## v8.3.1 Regime Quality Filter

- 90일 Regime별 결과에서 RANGE `PF 0.54 / 기대값 -0.335%`가 확인되어 RANGE 신규 BUY 차단
- Score 75~79가 상위 Score 구간보다 좋았던 결과를 반영해 단순 Score 상향 대신 Anti-Chase 도입
- EMA20 대비 ATR 이격, 단기 급등폭, 거래량 폭증으로 과열 추격 진입을 WAIT 처리
- 알트 15분 RSI-BTC 상대강도와 중기 EMA 품질 필터 추가
- BTC 단기 약세를 Hard Crash와 Soft Risk로 분리해 STRONG_BULL/BULL의 과민 SELL 완화
- 백테스트에 v8.3.1 / v8.3.0 직접 비교 모드 추가
- Score 기본값 75 유지
- 자동 주문 없음, Telegram 수동매매 검토 전용 유지

## v8.3.0 Regime-Adaptive Manual Trader

- BTC 완료 일봉 기반 `STRONG_BULL / BULL / RANGE / BEAR / CRASH` Market Regime Engine 추가
- 20/50/200 EMA, 30/90일 수익률, 90일 drawdown, 일봉 RSI를 Regime Score(-100~+100)로 수치화
- `BEAR/CRASH` 신규 BUY Telegram 차단, `RANGE` 진입기준 강화
- 고정 TP1/TP2/SL 대신 코인 5분 ATR + Regime 기반 동적 SL/TP/Trail/보유시간/부분익절 비율 계산
- `STRONG_BULL/BULL`에서 단기 BTC Risk-Off 하나만으로 SELL하지 않고 복수 추세 훼손 조건 요구
- 동적 SL/CRASH/외부 severe risk는 긴급 SELL 검토로 분류하고 5분 재확인 허용
- 신규 보유 등록 시 당시 Regime과 동적 Risk Plan을 KV에 저장
- 수동 보유 포지션의 완료 5분봉 종가 Peak 추적, TP1/TP2 1회성 `PROFIT REVIEW` 알림, TP1 이후 Runner Trail SELL 검토 추가
- TP1 부분매도는 자동 실행하지 않으며 장부에서 실제 매도수량을 기록하면 남은 수량을 계속 관리
- 장부 실현·미실현 손익에 편도 `TRADING_FEE_PERCENT` 수수료 추정 반영
- 백테스트에 `v8.3 Regime+Adaptive Exit`와 `Regime ON/OFF` 비교 추가
- BTC 일봉 백테스트 프록시 추가
- Upbit 일봉 완료 기준을 UTC 자정이 아닌 **00:00 KST**로 수정하여 진행 중인 일봉이 Regime에 섞이지 않도록 보강
- 주문 자동 실행 없음: Telegram 수동매매 검토 방식 유지

# CHANGELOG

## v8.2.0 Pattern Confirmation
- 신규 BUY에 패턴 확인 gate 추가: 기존 기술조건을 통과해도 상승 패턴 확정이 없으면 BUY 대신 WATCH/IDLE
- Pattern Score `-8~+8`, 기본 BUY 확인 `>= +2`, 하락 SELL 경고 `<= -4`
- 5분 OHLCV 기반 거래범위 돌파/하향이탈, breakout retest, Wyckoff Spring/Upthrust, VCP-inspired contraction, Bull/Bear Flag, Triangle, Rectangle, Double Top/Bottom 추가
- 5분봉을 15분봉으로 집계해 Market Structure 방향을 보조 확인
- 가짜 돌파/Upthrust와 하락 패턴을 Risk/SELL REVIEW에 반영
- Telegram BUY/SELL 메시지에 Pattern 점수·대표 패턴·15분 구조·패턴 근거 추가
- 대시보드에 Pattern 열 및 패턴 상세 tooltip 추가
- 백테스트에서 `Pattern ON/OFF` 비교 가능
- 기존 Macro/Context/KV/Telegram/장부/12개 코인 기능 유지
- 특정 인플루언서의 독점 신호는 복제하지 않고 공개된 VCP/Wyckoff/CMT/고전 패턴 원리만 정량화

## v8.1.4 안정화판
- Macro 품질 경계값 수정: 9개 중 6개(정확히 2/3) 확보 시 `partial`로 정상 사용
- BLS CPI/실업률은 12시간 최소 갱신 간격을 두어 5분 Cron 반복 호출과 429를 방지
- Cboe OVX CSV 파서를 유연화하여 `DATE,OVX`/`VALUE`/`CLOSE` 등 공개 형식 변경에 대응
- Macro 데이터가 일부만 있을 때 점수는 품질 가중, 신뢰도는 보수적으로 감점하는 기존 원칙 유지
- 7일 관찰 기간 권장: 기능 추가/파라미터 튜닝은 동결하고 장애·오류만 핫픽스

## v8.1.3
- FRED Macro 의존 제거
- U.S. Treasury 공식 XML에서 2Y·10Y 수익률 직접 수집
- Federal Reserve Board H.10에서 Broad Dollar·USD/JPY 직접 수집
- Cboe 공식 CSV에서 VIX·OVX 직접 수집
- BLS Public Data API v1에서 CPI·실업률 수집
- EIA 공개 WTI 현물가격 페이지에서 WTI 수집
- 공급자별 독립 fallback/cache로 단일 공급자 장애 격리
- 9개 Macro metric의 LIVE/CACHE/실패·품질가중·confidence penalty 표시
- Macro API Key 불필요

## v8.1.2
- FRED 공식 API(FRED_API_KEY 선택) → CSV → KV 최근 정상 캐시 fallback 추가
- Macro 데이터 품질 `normal / partial / unavailable` 분류
- 데이터 부족 시 Macro 점수 품질 가중 및 실시간 confidence 감점
- Macro `N/A`/부분 데이터/오류 상세/series별 source 표시
- FRED series 최근 정상값 KV cache(최대 96시간 사용) 추가
- FOMC 이벤트 패널티는 공급 장애와 독립적으로 유지

# v8.1.1

- FIX: v8.1.0 웹 대시보드에서 누락된 보유/장부 동기화 함수 5개 복구.
- FIX: 초기 로딩 `syncPositions is not defined`로 상단이 `연결 확인 필요`가 되던 문제 수정.
- FIX: Cron 상태/장부 버튼의 연쇄 ReferenceError 수정.
- KEEP: v8.1 Context/Macro/Prediction/Manual event, 12개 코인, SCALPER_KV 고정 binding 유지.

# Changelog

## v8.1.0

- 12개 코인(ETH/SOL/XRP/HBAR/ONDO/LINK/AVAX/DOGE/SUI/TAO/UNI/AAVE) 유지
- Macro / Prediction / News / Manual Event를 합친 외부 Context Score 추가
- FRED 공개 데이터 기반 미10Y·2Y, VIX, 달러, WTI, USD/JPY 프록시
- FOMC 발표 전후 방향 중립적 이벤트 위험 패널티
- Polymarket market ID 기반 확률 가중치 지원
- CryptoPanic optional Secret 기반 코인 뉴스 휴리스틱 지원
- 수동 호재/악재 이벤트(+10~-10, 만료시간, GLOBAL/코인별) UI 추가
- 외부 호재만으로 BUY가 생성되지 않도록 기술적 hard gate 유지
- 강한 외부 악재는 BUY 차단/SELL REVIEW 근거에 포함
- Context API 실패 시 전체 Cron이 멈추지 않는 fail-open 처리
- Context 결과 KV 캐시와 시간별 history snapshot 저장
- Telegram BUY/SELL 메시지에 Tech/Context/합산 점수 추가
- 백테스트 Score 구간 소수점 누락 버그 수정: 85~89.999 점수 등이 빠지던 문제 해결
- 기존 KV namespace ID를 wrangler.toml에 고정해 자동배포 시 binding 유지

## v8.0.3

- 7/14/30/60/90일 백테스트
- 실전 SELL 동기형, ATR+SELL+Trail 연구 모드
- 워크포워드/스트레스 테스트
