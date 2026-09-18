# BTC-ALT Scalper v10.1 — Liquidity Radar Final

포함:
- 기존 v10 Fibonacci / Regime / Dual Engine / 보유장부 / Telegram 구조 유지
- 새 `🌊 유동성 레이더` 추가
- Global Liquidity: XPOWERFLOW GMLCI/URLI 공개 데이터
- Stablecoin: DefiLlama
- BTC Dominance: CoinGecko
- ETH/BTC: Binance public ticker
- Alt Volume: Upbit KRW 12종 바스켓
- 5분 캐시 + Cloudflare KV 이전 스냅샷으로 변화율 계산
- 레이더는 시장확산 보조지표로 표시하며 BUY 점수에는 자동 강제 반영하지 않음
- `index.html`과 `docs/index.html` 둘 다 제공
- 실시간 시장판: Upbit KRW 현재가/24시간 + Binance 환산가 + USD/KRW 김프 20종

## 배포
1. GitHub Pages가 root를 사용하면 `index.html` 교체
2. Pages가 `/docs`를 사용하면 `docs/index.html` 교체
3. Cloudflare Worker에는 `worker.js` 배포
4. 기존 `SCALPER_KV`, `SCALPER_PIN`, Telegram 환경변수는 그대로 유지
5. 브라우저에서 Worker URL/PIN 저장 후 `연결 점검` → `유동성 새로고침`

## 김프 / 시장판
김프를 기존 내부 연결에 의존하지 않고 `/market` 공개 endpoint로 분리했습니다.
- Upbit: KRW 현재가 + 전일 종가 기준 24시간 등락률
- Binance: USDT 가격
- USD/KRW: 공개 환율
- 김프 = Upbit KRW / (Binance USDT × USD/KRW) - 1
- 시장판은 PIN/Telegram 설정이 없어도 표시되며, 20초마다 갱신합니다.



## v10.1.1 변경
- 시장판의 코인 현재가/24시간 등락률/24시간 거래대금은 **Upbit KRW API만 사용**
- Binance 코인 가격 호출 제거
- Binance 연결 실패가 Upbit 현재가 표시를 방해하지 않음
- 김프는 글로벌 비교가격이 필요한 기능이므로 Upbit-only 모드에서는 비워서 잘못된 수치를 표시하지 않음
