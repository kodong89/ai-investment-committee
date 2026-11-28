"""스윙 매매 기법 5종 백테스트 (빅테크 위주, 최근 3년 일봉)
- 모든 기법은 같은 조건: 신호 다음 날 시가 진입, 같은 손절(2 ATR, 최대 -8%), 같은 청산(2R 절반 익절 + EMA20 종가 이탈), 최대 60거래일
- 결과는 R 배수(손절폭 대비 손익)로 비교. 거래비용 왕복 0.1%.
- 실행: GitHub Actions (yfinance). 결과: backtest.json
"""
import json, math, datetime as dt
import yfinance as yf

US = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "AMD", "NFLX", "PLTR"]
KR = [("005930.KS", "삼성전자"), ("000660.KS", "SK하이닉스"), ("035420.KS", "NAVER"), ("035720.KS", "카카오")]
YEARS = 3
COST = 0.001  # 왕복 수수료·슬리피지


# ── 데이터 ─────────────────────────────────────────────
def load(t):
    df = yf.download(t, period=f"{YEARS + 2}y", interval="1d", progress=False, auto_adjust=True)
    if df is None or df.empty:
        return None
    def col(c):
        s = df[c]
        return s.iloc[:, 0] if hasattr(s, "columns") else s
    o, h, l, c, v = (col(x) for x in ("Open", "High", "Low", "Close", "Volume"))
    rows = [(d.strftime("%Y-%m-%d"), float(o[d]), float(h[d]), float(l[d]), float(c[d]), float(v[d] or 0)) for d in c.dropna().index]
    return rows


# ── 지표 (트레이딩뷰 공식) ───────────────────────────────
def ema(x, n):
    out = [None] * len(x)
    if len(x) < n:
        return out
    e = sum(x[:n]) / n; out[n - 1] = e; a = 2 / (n + 1)
    for i in range(n, len(x)):
        e = a * x[i] + (1 - a) * e; out[i] = e
    return out


def sma(x, n):
    out = [None] * len(x); s = 0
    for i, v in enumerate(x):
        s += v
        if i >= n:
            s -= x[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def rma(x, n):
    out = [None] * len(x)
    vals = [v for v in x if v is not None]
    start = next((i for i, v in enumerate(x) if v is not None), None)
    if start is None or len(vals) < n:
        return out
    r = sum(x[start:start + n]) / n; out[start + n - 1] = r
    for i in range(start + n, len(x)):
        r = (r * (n - 1) + x[i]) / n; out[i] = r
    return out


def indicators(b):
    o = [x[1] for x in b]; h = [x[2] for x in b]; l = [x[3] for x in b]; c = [x[4] for x in b]; v = [x[5] for x in b]
    n = len(b)
    I = {"o": o, "h": h, "l": l, "c": c, "v": v,
         "e10": ema(c, 10), "e20": ema(c, 20), "e50": ema(c, 50), "e200": ema(c, 200),
         "s50": sma(c, 50), "s150": sma(c, 150), "s200": sma(c, 200), "v20": sma(v, 20), "v50": sma(v, 50)}
    tp = [(h[i] + l[i] + c[i]) / 3 for i in range(n)]
    cci = [None] * n
    for i in range(19, n):
        w = tp[i - 19:i + 1]; m = sum(w) / 20; d = sum(abs(x - m) for x in w) / 20
        cci[i] = (tp[i] - m) / (0.015 * d) if d else 0
    I["cci"] = cci
    tr = [h[0] - l[0]] + [max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])) for i in range(1, n)]
    pdm = [0] + [(h[i] - h[i - 1]) if (h[i] - h[i - 1]) > (l[i - 1] - l[i]) and (h[i] - h[i - 1]) > 0 else 0 for i in range(1, n)]
    ndm = [0] + [(l[i - 1] - l[i]) if (l[i - 1] - l[i]) > (h[i] - h[i - 1]) and (l[i - 1] - l[i]) > 0 else 0 for i in range(1, n)]
    atr, sp, sn = rma(tr, 14), rma(pdm, 14), rma(ndm, 14)
    pdi = [100 * sp[i] / atr[i] if atr[i] else None for i in range(n)]
    mdi = [100 * sn[i] / atr[i] if atr[i] else None for i in range(n)]
    dx = [100 * abs(pdi[i] - mdi[i]) / (pdi[i] + mdi[i]) if pdi[i] is not None and (pdi[i] + mdi[i]) else None for i in range(n)]
    I.update({"atr": atr, "pdi": pdi, "mdi": mdi, "adx": rma(dx, 14)})
    return I


def ok(*xs):
    return all(x is not None for x in xs)


# ── 진입 신호 (i일 종가 기준, 다음 날 진입) ─────────────────
def sig_mine(I, i):
    """내 매매법: EMA 리본 게이트 + CCI 반등/돌파 + 거래량 1.2배"""
    c, e10, e20, e50, cci, v, v20 = I["c"], I["e10"], I["e20"], I["e50"], I["cci"], I["v"], I["v20"]
    if not ok(e10[i], e20[i], e50[i], cci[i], cci[i - 1], v20[i]):
        return False
    gate = c[i] > e20[i] > e50[i] and e10[i] > e20[i]
    trig = any(cci[i - 1] < lv <= cci[i] for lv in (-100, 0, 100))
    return gate and trig and v[i] >= 1.2 * v20[i]


def sig_minervini(I, i):
    """미너비니: 추세 템플릿 + 변동성 축소 후 20일 고점 돌파(거래량 1.4배)"""
    c, h, l, s50, s150, s200, v, v50 = I["c"], I["h"], I["l"], I["s50"], I["s150"], I["s200"], I["v"], I["v50"]
    if i < 260 or not ok(s50[i], s150[i], s200[i], s200[i - 21], v50[i]):
        return False
    hi52, lo52 = max(h[i - 251:i + 1]), min(l[i - 251:i + 1])
    tt = c[i] > s50[i] > s150[i] > s200[i] and s200[i] > s200[i - 21] and c[i] >= 1.3 * lo52 and c[i] >= 0.75 * hi52
    rng10 = (max(h[i - 10:i]) - min(l[i - 10:i])) / c[i - 1]
    brk = c[i] > max(h[i - 20:i])
    return tt and rng10 < 0.10 and brk and v[i] >= 1.4 * v50[i]


def sig_qulla(I, i):
    """쿨라매기: 3개월 +30% 주도주, 15일 박스(폭 15% 이내) 상단 돌파 + 거래량 1.5배"""
    c, h, l, e10, e20, v, v20 = I["c"], I["h"], I["l"], I["e10"], I["e20"], I["v"], I["v20"]
    if i < 80 or not ok(e10[i], e20[i], e20[i - 5], v20[i]):
        return False
    lead = c[i - 15] / c[i - 78] - 1 >= 0.30
    box = (max(h[i - 15:i]) - min(l[i - 15:i])) / c[i - 1] <= 0.15
    trend = c[i] > e10[i] > e20[i] and e20[i] > e20[i - 5]
    return lead and box and trend and c[i] > max(h[i - 15:i]) and v[i] >= 1.5 * v20[i]


def sig_raschke(I, i):
    """라쉬키 Holy Grail: ADX>30·+DI>-DI 강한 추세에서 20 EMA 터치 (다음 날 전일 고가 돌파 시 진입)"""
    adx, pdi, mdi, l, e20 = I["adx"], I["pdi"], I["mdi"], I["l"], I["e20"]
    if not ok(adx[i], pdi[i], mdi[i], e20[i]):
        return False
    return adx[i] > 30 and pdi[i] > mdi[i] and l[i] <= e20[i] * 1.005 and I["c"][i] > e20[i] * 0.98


def sig_oneil(I, i):
    """오닐(차트): 52주 고가 5% 이내, 6주 베이스(폭 20% 이내) 상단 돌파 + 거래량 1.4배"""
    c, h, l, v, v50, s50 = I["c"], I["h"], I["l"], I["v"], I["v50"], I["s50"]
    if i < 260 or not ok(v50[i], s50[i]):
        return False
    hi52 = max(h[i - 251:i])
    base_hi, base_lo = max(h[i - 30:i]), min(l[i - 30:i])
    return c[i] >= 0.95 * hi52 and (base_hi - base_lo) / base_hi <= 0.20 and c[i] > base_hi and v[i] >= 1.4 * v50[i] and c[i] > s50[i]


STRATS = [("mine", "내 매매법", "EMA 리본 + CCI 반등·돌파 + 거래량", sig_mine),
          ("minervini", "미너비니", "추세 템플릿 + 변동성 축소 돌파", sig_minervini),
          ("qulla", "쿨라매기", "주도주 박스권 돌파", sig_qulla),
          ("raschke", "라쉬키 Holy Grail", "강한 추세 20 EMA 눌림목", sig_raschke),
          ("oneil", "오닐 (차트)", "신고가 근처 베이스 돌파", sig_oneil)]


# ── 공통 진입·청산 시뮬레이션 ──────────────────────────────
def simulate(sym, b, I, sig, key, start_idx):
    trades, i, n = [], start_idx, len(b)
    o, h, l, c, e20, atr = I["o"], I["h"], I["l"], I["c"], I["e20"], I["atr"]
    while i < n - 2:
        if not sig(I, i) or not ok(atr[i]):
            i += 1; continue
        j = i + 1
        if key == "raschke":  # 다음 날 신호 봉 고가를 넘어야 진입 (buy stop)
            if h[j] <= h[i]:
                i += 1; continue
            entry = max(o[j], h[i])
        else:
            entry = o[j]
        stop = max(entry - 2 * atr[i], entry * 0.92)
        risk = entry - stop
        if risk <= 0:
            i += 1; continue
        half, r_total, k = False, 0.0, j
        exit_day, reason = None, None
        while k < n and k - j < 60:
            if l[k] <= stop:  # 손절 (갭 하락이면 시가)
                px = min(o[k], stop) if k > j else stop
                r_total += (0.5 if half else 1.0) * (px - entry) / risk; exit_day, reason = k, "손절"; break
            if not half and h[k] >= entry + 2 * risk:  # 2R 절반 익절, 손절은 본전으로
                r_total += 0.5 * 2.0; half = True; stop = max(stop, entry)
            if ok(e20[k]) and c[k] < e20[k] and k > j:  # EMA20 종가 이탈 청산
                r_total += (0.5 if half else 1.0) * (c[k] - entry) / risk; exit_day, reason = k, "EMA20 이탈"; break
            k += 1
        if exit_day is None:
            reason = "보유 중(평가)" if k >= n else "60일 만료"
            k = min(k, n - 1)
            r_total += (0.5 if half else 1.0) * (c[k] - entry) / risk; exit_day = k
        r_total -= COST * entry / risk
        trades.append({"sym": sym, "in": b[j][0], "out": b[exit_day][0], "r": round(r_total, 3), "days": exit_day - j + 1, "why": reason,
                       "ret": round((r_total * risk) / entry * 100, 2)})
        i = exit_day + 1
    return trades


def stats(tr):
    if not tr:
        return {"trades": 0}
    rs = [t["r"] for t in tr]; wins = [r for r in rs if r > 0]; loss = [r for r in rs if r <= 0]
    eq, peak, mdd = 1.0, 1.0, 0.0
    for t in sorted(tr, key=lambda x: x["out"]):  # 1회 1% 위험 기준 자산 곡선
        eq *= 1 + 0.01 * t["r"]; peak = max(peak, eq); mdd = min(mdd, eq / peak - 1)
    return {"trades": len(rs), "win_rate": round(len(wins) / len(rs) * 100, 1),
            "avg_win_r": round(sum(wins) / len(wins), 2) if wins else 0, "avg_loss_r": round(sum(loss) / len(loss), 2) if loss else 0,
            "expectancy_r": round(sum(rs) / len(rs), 3),
            "profit_factor": round(sum(wins) / -sum(loss), 2) if loss and sum(loss) < 0 else None,
            "avg_days": round(sum(t["days"] for t in tr) / len(tr), 1),
            "total_r": round(sum(rs), 1), "equity_ret_pct": round((eq - 1) * 100, 1), "mdd_pct": round(mdd * 100, 1),
            "best_r": round(max(rs), 2), "worst_r": round(min(rs), 2)}


def main():
    universe = [(t, t, "us") for t in US] + [(t, nm, "kr") for t, nm in KR]
    data, bh = {}, {}
    for t, nm, m in universe:
        b = load(t)
        if not b or len(b) < 300:
            print("skip", t); continue
        data[t] = (nm, m, b, indicators(b))
    first_day = (dt.date.today() - dt.timedelta(days=365 * YEARS)).isoformat()
    out = {"updated": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "period": None, "rules": {
        "진입": "신호가 난 다음 날 시가 (라쉬키는 신호 봉 고가 돌파 시)",
        "손절": "진입가 − 2 ATR, 단 최대 -8%",
        "청산": "2R 도달 시 절반 익절(나머지 손절은 본전으로), 나머지는 EMA20 종가 이탈 시, 최대 60거래일",
        "비용": "왕복 0.1%", "자산 곡선": "거래마다 계좌의 1% 위험(1R=1%)"},
        "universe": [{"sym": t, "name": nm, "market": m} for t, (nm, m, _, _) in data.items()], "strategies": [], "buyhold": []}
    all_days = []
    for key, name, desc, sig in STRATS:
        tr_all = []
        for t, (nm, m, b, I) in data.items():
            st = next((i for i, x in enumerate(b) if x[0] >= first_day), len(b))
            st = max(st, 260)
            tr = simulate(nm, b, I, sig, key, st)
            for x in tr:
                x["market"] = m
            tr_all += tr
            all_days.append(b[st][0]); all_days.append(b[-1][0])
        s = stats(tr_all)
        s.update({"key": key, "name": name, "desc": desc,
                  "us": stats([x for x in tr_all if x["market"] == "us"]), "kr": stats([x for x in tr_all if x["market"] == "kr"]),
                  "by_symbol": {nm: stats([x for x in tr_all if x["sym"] == nm]) for nm in sorted({x["sym"] for x in tr_all})},
                  "recent": sorted(tr_all, key=lambda x: x["out"], reverse=True)[:8]})
        out["strategies"].append(s)
    for t, (nm, m, b, I) in data.items():
        st = next((i for i, x in enumerate(b) if x[0] >= first_day), 0)
        out["buyhold"].append({"name": nm, "market": m, "ret_pct": round((b[-1][4] / b[st][4] - 1) * 100, 1)})
    out["period"] = f"{min(all_days)} ~ {max(all_days)}" if all_days else None
    out["strategies"].sort(key=lambda s: s.get("expectancy_r", -9), reverse=True)
    with open("backtest.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    for s in out["strategies"]:
        print(s["name"], {k: s.get(k) for k in ("trades", "win_rate", "avg_win_r", "avg_loss_r", "expectancy_r", "profit_factor", "equity_ret_pct", "mdd_pct")})


if __name__ == "__main__":
    main()
