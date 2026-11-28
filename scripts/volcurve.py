"""장중 예상 거래량 환산 정확도 측정
- 최근 60일 5분봉(yfinance)으로 '이 시각까지 하루 거래량의 몇 %가 쌓이는지' 곡선을 앞 2/3 기간으로 만들고
  뒤 1/3 기간에서 예상 거래량 = 누적 거래량 ÷ 곡선 값의 오차를 잰다 (표본 밖 검증)
- 비교: 단순 비례(누적 × 전체 시간 ÷ 경과 시간)
- 결과: volcurve.json (시장별 곡선 + 시간대별 오차 + 1.2배 판정 일치율)
"""
import json, statistics as st, datetime as dt
import yfinance as yf

US = ["TSLA", "NVDA", "AMD", "PLTR", "MU", "AVGO", "ANET", "CRWD", "NET", "SHOP", "APP", "AXON", "VST", "HOOD", "COIN", "UBER",
      "SMCI", "ENPH", "CELH", "SNOW", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NFLX"]
KR = ["005930.KS", "000660.KS", "035420.KS", "035720.KS", "042700.KS", "012450.KS", "267260.KS", "196170.KQ", "003230.KS", "247540.KQ", "086520.KQ"]
SESSION = {"us": 390, "kr": 390}  # 미국 09:30~16:00, 한국 09:00~15:30 (분)
CHECK = [15, 30, 60, 90, 120, 180, 240, 300, 360]


def col(df, c):
    s = df[c]
    return s.iloc[:, 0] if hasattr(s, "columns") else s


def load(t):
    d = yf.download(t, period="8mo", interval="1d", progress=False, auto_adjust=False)
    m = yf.download(t, period="60d", interval="5m", progress=False, auto_adjust=False, prepost=False)
    if d is None or d.empty or m is None or m.empty:
        return None
    dv = col(d, "Volume"); daily = {i.strftime("%Y-%m-%d"): float(v) for i, v in dv.items() if v == v}
    mv = col(m, "Volume"); days = {}
    for ts, v in mv.items():
        if v != v:
            continue
        days.setdefault(ts.strftime("%Y-%m-%d"), []).append((ts.hour * 60 + ts.minute, float(v)))
    return daily, days


def profile(bars, total):
    """분(장 시작 후) → 누적 거래량 / 하루 거래량"""
    bars.sort(); open_m = bars[0][0]; cum, out = 0.0, {}
    for m, v in bars:
        cum += v; out[m - open_m + 5] = cum  # 그 5분봉이 끝난 시점
    return {k: v / total for k, v in out.items()}, out


def main():
    res = {"updated": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "markets": {}}
    for mk, syms in (("us", US), ("kr", KR)):
        rows = []  # (day, sym, prof, cum, total, avg20)
        for t in syms:
            x = load(t)
            if not x:
                print("skip", t); continue
            daily, days = x
            dk = sorted(daily)
            for day, bars in days.items():
                if day not in daily or len(bars) < 70 or daily[day] <= 0:
                    continue  # 반장·결측일 제외
                i = dk.index(day)
                if i < 20:
                    continue
                avg20 = sum(daily[k] for k in dk[i - 20:i]) / 20
                prof, cum = profile(bars, daily[day])
                rows.append((day, t, prof, cum, daily[day], avg20))
        alldays = sorted({r[0] for r in rows})
        cut = alldays[int(len(alldays) * 2 / 3)]
        train = [r for r in rows if r[0] < cut]; test = [r for r in rows if r[0] >= cut]
        curve = {}
        for m in range(5, SESSION[mk] + 5, 5):
            v = [r[2][m] for r in train if m in r[2]]
            if v:
                curve[m] = round(st.median(v), 4)
        acc = []
        for m in CHECK:
            e_curve, e_lin, agree, agree_lin, n_near = [], [], 0, 0, 0
            cnt = 0
            for day, t, prof, cum, total, avg20 in test:
                if m not in cum or m not in curve:
                    continue
                est = cum[m] / curve[m]; lin = cum[m] * SESSION[mk] / m
                e_curve.append(abs(est / total - 1)); e_lin.append(abs(lin / total - 1))
                real_ok = total >= 1.2 * avg20
                agree += (est >= 1.2 * avg20) == real_ok; agree_lin += (lin >= 1.2 * avg20) == real_ok; cnt += 1
            if not cnt:
                continue
            q = lambda a, p: round(sorted(a)[int(len(a) * p) - 1] * 100, 1)
            acc.append({"min": m, "n": cnt,
                        "median_err_pct": round(st.median(e_curve) * 100, 1), "p80_err_pct": q(e_curve, 0.8),
                        "within20_pct": round(sum(1 for e in e_curve if e <= 0.2) / cnt * 100, 1),
                        "judge_agree_pct": round(agree / cnt * 100, 1),
                        "linear_median_err_pct": round(st.median(e_lin) * 100, 1), "linear_judge_agree_pct": round(agree_lin / cnt * 100, 1)})
        res["markets"][mk] = {"symbols": len({r[1] for r in rows}), "days": len(alldays), "train_until": cut,
                              "test_rows": len(test), "curve": curve, "accuracy": acc}
        print(mk, "days", len(alldays), "test", len(test))
        for a in acc:
            print(" ", a)
    with open("volcurve.json", "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
