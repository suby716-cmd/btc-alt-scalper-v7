# BTC ALT REGIME TRADER v10.2
Upbit KRW만 사용하는 화이트/블루 통합 대시보드.
- index.html / docs/index.html
- worker.js: Upbit 공개 API 프록시와 Telegram 테스트
- 가격, 24시간 등락률: Upbit KRW
- 보유종목: 브라우저 localStorage
- 자동매매: OFF
- Telegram Secret은 Worker에만 저장


## 코인 목록 편집
화면의 `★ 코인 목록 편집` 버튼에서 보고 싶은 Upbit KRW 심볼을 쉼표로 입력할 수 있습니다.
예: `BTC,ETH,ADA,NEAR,ARB,APT,ICP`
Upbit KRW 거래쌍이 실제로 존재하는 종목만 저장하며, 목록은 브라우저 localStorage에 저장됩니다.
