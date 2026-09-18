# BTC ALT REGIME TRADER v10.2.2

- Upbit KRW 가격/24시간 변동률 실시간 WebSocket
- Binance USDT 가격과 Upbit USDT/KRW를 비교한 실시간 김치프리미엄
- 최근 5분 BTC/ALT 상대강도 LIVE 차트
- 차트의 3개 선을 직접 선택하고 각 선 끝에 `코인명 (심볼)` 표시
- BTC/ETH/SOL 기본 선택, 원하는 3개 코인으로 변경 가능
- ADA / NEAR 기본 포함
- `★ 코인 목록 편집`으로 Upbit KRW 지원 코인을 자유롭게 선택
- 보유 종목 장부는 브라우저 localStorage 사용
- 자동매매 OFF, Telegram은 테스트/수동 알림 용도

## 배포
1. GitHub Pages에 `docs/index.html` 교체
2. Cloudflare Worker에 `worker.js` 교체
3. Worker URL을 화면에 저장

## 김프 계산
`김프 = (Upbit KRW 현재가 / (Binance USDT 현재가 × Upbit USDT/KRW) - 1) × 100`

※ 이 버전의 환산 기준은 공개시장에서 바로 얻을 수 있는 Upbit USDT/KRW를 사용합니다. Binance USDT 가격과 Upbit KRW 가격은 실시간으로 비교하고, 김프 데이터는 화면에서 15초 주기로 갱신합니다.
