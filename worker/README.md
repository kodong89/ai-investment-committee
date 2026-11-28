# 차트 계산 서버 (Cloudflare Worker)

종목 일봉을 받아 **트레이딩뷰와 같은 공식**으로 EMA 10/20/50/200, CCI(20), ATR(14), ADX(14), RSI(14), 지지·저항(스윙 고저점), 위쪽 매물대(120일 거래량 분포)를 계산해 JSON으로 돌려줍니다. 무료 플랜으로 충분합니다(하루 10만 요청).

- 데이터: 미국 Yahoo Finance(실패 시 Stooq), 한국 네이버 금융(실패 시 Yahoo)
- 같은 종목은 10분간 캐시

## 배포 (5분)
1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Create Worker** → 이름 `aic-chart` → **Deploy**
2. **Edit code** → 기존 코드를 전부 지우고 [`worker.js`](worker.js) 내용을 붙여넣기 → **Deploy**
3. 주소 확인: `https://aic-chart.<내 서브도메인>.workers.dev/?s=TSLA` 를 열어 `ema20` 값이 보이면 성공
4. 사이트 **설정 → 차트 계산 서버 주소**에 `https://aic-chart.<내 서브도메인>.workers.dev` 붙여넣기

## 사용 예
- 미국: `/?s=TSLA`
- 한국 종목·ETF: `/?s=005930&m=kr`, `/?s=0195R0&m=kr`
