"""장중 예상 거래량 정확도 측정 (최근 60일 5분봉)
- 시간대별 '하루 거래량 중 지금까지 쌓인 비율' 분포를 만들고, 그 분포로 마감 거래량을 예측해 실제와 비교
- 공정한 측정을 위해 예측하는 날은 분포 계산에서 뺌 (leave-one-day-out)
- 1.2배(20일 평균 대비) 판정이 마감 후 판정과 얼마나 일치하는지도 확인
결과: volcurve.json
"""
import json, statistics as st, datetime as dt
import yfinance as yf

US = ["TSLA", "NVDA", "AMD", "PLTR", "MU", "AVGO", "ANET", "CRWD", "NET", "SHOP", "APP", "AXON", "VST", "HOOD", "COIN", "UBER",
      "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NFLX"]
KR = ["005930.KS", "000660.KS", "042700.KS", "012450.KS", "267260.KS", "196170.KQ", "003230.KS", "035420.KS"]
OPEN = {"us": (9, 30), "kr": (9, 0)}
SESSION = 390  # 미국 6.5시간, 한국 09:00~15:30 6.5시간
CHECK = [15, 30, 60, 90, 120, 180, 240, 300, 360]


def days_of(t, mkt):
    df = yf.download(t, period="60d", interval="5m", progress=False, auto_adjust=False, prepost=False)
    if df is None or df.empty:
        return {}
    v = df["Volume"]; v = v.iloc[:, 0] if hasattr(v, "columns") else v
    oh, om = OPEN[mkt]; out = {}
    for ts, vol in v.items():
        m = (ts.hour * 60 + ts.minute) - (oh * 60 + om) + 5  # 봉이 끝난 시각 기준 경과 분
        if m <= 0 or m > SESSION + 5:
            continue
        d = ts.date().isoformat()
        out.setdefault(d, [0.0] * (SESSION // 5 + 2))
        out[d][min(m // 5, SESSION // 5 + 1)] += float(vol or 0)
    return {d: b for d, b in out.items() if sum(b) > 0 and sum(1 for x in b if x > 0) > 60}  # 반쪽 장·결측 제외


def cumfrac(b):
    tot = sum(b); c, s = [], 0.0
    for x in b:
        s += x; c.append(s / tot)
    return c


def frac_at(c, m):
    return c[min(m // 5, len(c) - 1)]


def main():
    res = {"updated": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "markets": {}}
    for mkt, syms in (("us", US), ("kr", KR)):
        data = {}
        for t in syms:
            d = days_of(t, mkt)
            if len(d) >= 30:
                data[t] = d
            else:
                print("skip", t, len(d))
        pooled = {}  # 시장 공통 분포: 모든 종목·날짜 평균
        for t, D in data.items():
            for d, b in D.items():
                pooled.setdefault(d, []).append(cumfrac(b))
        errs = {k: {m: [] for m in CHECK} for k in ("naive", "market", "own")}
        hit = {m: [0, 0, 0] for m in CHECK}  # 일치, 전체, 경계(1.0~1.4) 제외 후 일치율용
        hit_ex = {m: [0, 0] for m in CHECK}
        for t, D in data.items():
            ds = sorted(D)
            tot = {d: sum(D[d]) for d in ds}
            cf = {d: cumfrac(D[d]) for d in ds}
            for i, d in enumerate(ds):
                others = [cf[x] for x in ds if x != d]
                mk = [c for x in ds if x != d for c in pooled.get(x, [])]
                for m in CHECK:
                    cum = frac_at(cf[d], m) * tot[d]
                    if cum <= 0:
                        continue
                    own_f = st.mean(frac_at(c, m) for c in others)
                    mk_f = st.mean(frac_at(c, m) for c in mk) if mk else own_f
                    for k, f in (("naive", m / SESSION), ("market", mk_f), ("own", own_f)):
                        errs[k][m].append(cum / f / tot[d] - 1)
                    if i >= 20:  # 20일 평균 대비 1.2배 판정 일치율
                        v20 = st.mean(tot[x] for x in ds[i - 20:i])
                        pred, act = cum / own_f / v20, tot[d] / v20
                        same = (pred >= 1.2) == (act >= 1.2)
                        hit[m][0] += same; hit[m][1] += 1
                        if not (1.0 <= pred < 1.4):
                            hit_ex[m][0] += same; hit_ex[m][1] += 1
        def summ(a):
            a = sorted(abs(x) for x in a)
            if not a:
                return None
            return {"median_abs_pct": round(a[len(a) // 2] * 100, 1), "p80_abs_pct": round(a[int(len(a) * 0.8)] * 100, 1), "n": len(a)}
        prof = {}
        allc = [c for L in pooled.values() for c in L]
        for m in range(5, SESSION + 1, 5):
            prof[m] = round(st.mean(frac_at(c, m) for c in allc), 4)
        res["markets"][mkt] = {
            "symbols": list(data), "days": max(len(D) for D in data.values()),
            "error": {k: {m: summ(errs[k][m]) for m in CHECK} for k in errs},
            "call_1_2x": {m: {"agree_pct": round(hit[m][0] / hit[m][1] * 100, 1) if hit[m][1] else None, "n": hit[m][1],
                              "agree_pct_outside_1_0_1_4": round(hit_ex[m][0] / hit_ex[m][1] * 100, 1) if hit_ex[m][1] else None,
                              "outside_share_pct": round(hit_ex[m][1] / hit[m][1] * 100, 1) if hit[m][1] else None} for m in CHECK},
            "profile_cum_frac": prof}
    with open("volcurve.json", "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    for mkt, R in res["markets"].items():
        print("==", mkt, len(R["symbols"]), "종목", R["days"], "일")
        for m in CHECK:
            e = R["error"]; c = R["call_1_2x"][m]
            print(f"{m:>3}분 단순 {e['naive'][m]} | 시장분포 {e['market'][m]} | 종목분포 {e['own'][m]} | 1.2배 일치 {c}")


if __name__ == "__main__":
    main()
