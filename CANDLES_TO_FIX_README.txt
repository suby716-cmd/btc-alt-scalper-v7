원인 확정:
프론트 최초 호출은 to=null입니다.
기존 Worker는 Number(null) -> 0으로 변환한 뒤 Number.isFinite(0) == true라서
Upbit URL에 to=1970-01-01T00:00:00.000Z를 붙였습니다.
그래서 최신 BTC 5분봉을 받지 못해 'BTC 5분봉 데이터 부족'이 발생했습니다.

수정:
to가 null/undefined/빈 문자열이면 NaN 처리하여 Upbit 요청에 to를 붙이지 않습니다.
실제 pagination timestamp가 들어올 때만 to를 사용합니다.

배포:
이번에는 Cloudflare Worker만 ZIP의 worker.js로 교체하고 배포하세요.
GitHub HTML은 현재 진단 v2 그대로 두면 됩니다.
