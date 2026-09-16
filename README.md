# MASTER MARKET COMPASS V5 · FUTURE MOAT INVESTOR

## 목적

이 버전은 일반적인 "많이 오른 종목" 스크리너가 아니라, 장기투자를 위해 다음 순서로 연구하는 시스템입니다.

**미래 변화 → 미래산업 → 산업 병목 → 경제적 해자 → 성장/재무 → 밸류에이션 → Thesis Survival**

### 핵심 미래축
- AI 컴퓨트·반도체
- AI 전력·데이터센터
- 피지컬 AI·휴머노이드
- 자율주행·무인 모빌리티
- 무인물류·드론
- AI 바이오·신약개발
- 디지털화폐·Stablecoin
- 우주·위성·Direct-to-Device
- AI 국방·사이버보안
- 차세대 에너지·원전·그리드

## 투자철학 모듈

각 관점은 하나의 종합등급으로 합치지 않습니다.

- **Buffett**: 장기 경쟁우위, 자본수익률, 현금흐름, 사업의 질
- **Lynch**: 성장의 이유, 사업 이해 가능성, 성장 대비 가격
- **Druckenmiller**: 산업/시장 추세와 실제 자금 흐름의 방향
- **Graham**: 가치와 안전마진
- **파돌부부**: 산업 트렌드, 성장주, 경제적 해자, 장기 보유 논리, 투자 Thesis 점검

## V5 주요 기능

1. Future Research Engine
2. Future Industry Map
3. Bottleneck Engine
4. Economic Moat Engine
5. Future Moat Discovery
6. Emerging / 아직 실적 검증이 부족한 미래기업 분리
7. Thesis Survival Engine
8. 투자논리(Thesis Ledger) 저장
9. 좋은 기업 급락 후보
10. 투자고수 회의실
11. Telegram 알림
12. 데이터 품질/오류 표시
13. 기존 Cloudflare Worker + KV + Telegram 인프라 재사용

## 중요한 설계 원칙

- 미래산업 점수가 높다고 매수 추천이 아닙니다.
- 작은 기업은 미래성은 높아도 상용화·현금흐름·자금조달 위험이 큽니다.
- 주가 하락만으로 SELL 하지 않습니다.
- 투자논리가 깨지는 조건을 미리 적고, 이후 데이터로 점검합니다.
- 종합점수 하나로 모든 산업을 줄 세우지 않고 미래성·병목·해자·성장·재무·가치·시장상태를 분리합니다.

## 기존 인프라

기존 Worker를 유지합니다.

- Worker: `btc-alt-scalper-v7`
- KV Binding: `SCALPER_KV`
- Secrets: `SCALPER_PIN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- Cron: `0 * * * *`

V5는 V4 KV 데이터를 읽을 수 있도록 legacy fallback을 두었지만, 새 데이터는 `MMC_*_V5` 키에 저장합니다.

## 데이터

- 미국/한국 주식: Yahoo Finance chart/quoteSummary/timeseries
- 암호자산: Upbit KRW 일봉
- Yahoo chart는 query1 → query2 fallback

데이터가 없는 종목은 오류로 별도 표시합니다. 데이터 오류가 많을 때는 해당 종목의 투자 판단을 보류해야 합니다.

## 배경 연구

V5의 미래산업 축은 2026년 공개된 Stanford Emerging Technology Review, IEEE 2026 technology predictions, World Economic Forum Top 10 Emerging Technologies 2026, CB Insights Tech Trends 2026 등의 기술 흐름을 참고해 구성했습니다.

## 주의

이 시스템은 자동매매가 아닙니다. 투자 권유나 수익 보장 시스템도 아닙니다. 특히 초기 미래기업은 기술·규제·상용화·자금조달 위험이 높으므로 기업 공시와 원문 자료를 직접 확인해야 합니다.
