v8.3.5 REGIME DIAGNOSTIC FIX
- Regime 실패 시 상단에 실제 /candles HTTP 상태와 Worker 오류를 표시합니다.
- 예: /candles HTTP 401 · UNAUTHORIZED
- 예: /candles HTTP 502 · CANDLES_FAILED · upstream 429
- 연결 점검(/health) 성공과 Regime(/candles) 성공을 구분해서 표시합니다.
- 혼동 방지를 위해 루트 worker.js와 worker/worker.js를 동일하게 맞췄습니다.

배포:
1) GitHub Pages: index.html, docs/index.html 교체
2) Cloudflare Worker: worker/worker.js 사용 (루트 worker.js도 같은 코드)
3) Ctrl+F5
4) 우측 상단의 'Regime 실패 · ...' 문구를 확인
