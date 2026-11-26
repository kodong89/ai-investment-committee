"""지수·거시 데이터를 받아 이동평균선·국면·상승/하락 근거를 계산해 market.json으로 저장 (GitHub Actions에서 실행)
모든 숫자는 Yahoo Finance 일봉 종가로 코드가 직접 계산한다. AI는 쓰지 않는다."""
import json, datetime as dt
import yfinance as yf

INDICES = [("나스닥", "^IXIC", "us"), ("S&P500", "^GSPC", "us"), ("코스피", "^KS11", "kr"), ("코스닥", "^KQ11", "kr")]
EXTRA = {"vix": "^VIX", "usdkrw": "KRW=X", "us10y": "^TNX", "dxy": "DX-Y.NYB"}
RATIO = {"breadth": ("RSP", "SPY"), "credit": ("HYG", "IEF"), "semis": ("SOXX", "SPY")}
_cache = {}


def closes(ticker, period="2y"):
    if ticker in _cache:
        return _cache[ticker]
    try:
        df = yf.download(ticker, period=period, interval="1d", progress=False, auto_adjust=False)
    except Exception as e:  # 한 종목 실패가 전체를 멈추지 않게
        print("download fail", ticker, e)
        df = None
    if df is None or df.empty:
        _cache[ticker] = []
        return []
    s = df["Close"]
    if hasattr(s, "columns"):
        s = s.iloc[:, 0]
    s = s.dropna()
    _cache[ticker] = [(d.strftime("%Y-%m-%d"), float(v)) for d, v in s.items()]
    return _cache[ticker]


def vals(ticker):
    return [v for _, v in closes(ticker)]


def sma(v, n, end=None):
    v = v[:end] if end else v
    return sum(v[-n:]) / n if len(v) >= n else None


def rsi(v, n=14):
    if len(v) < n + 1:
        return None
    gains, losses = [], []
    for a, b in zip(v[-(n * 5):-1], v[-(n * 5) + 1:]):
        d = b - a
        gains.append(max(d, 0)); losses.append(max(-d, 0))
    ag = sum(gains[:n]) / n; al = sum(losses[:n]) / n
    for g, l in zip(gains[n:], losses[n:]):  # Wilder 평활
        ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n
    return 100.0 if al == 0 else 100 - 100 / (1 + ag / al)


def chg(v, days):
    return (v[-1] / v[-1 - days] - 1) * 100 if len(v) > days else None


def index_row(name, ticker):
    c = closes(ticker)
    if len(c) < 230:
        return {"name": name, "ticker": ticker, "error": f"데이터 부족({len(c)}일)"}
    v = [x for _, x in c]
    close, ma50, ma200 = v[-1], sma(v, 50), sma(v, 200)
    hi = max(v[-252:])
    return {
        "name": name, "ticker": ticker, "date": c[-1][0],
        "close": round(close, 2), "ma50": round(ma50, 2), "ma200": round(ma200, 2),
        "above50": close > ma50, "above200": close > ma200,
        "gap50": round((close / ma50 - 1) * 100, 2), "gap200": round((close / ma200 - 1) * 100, 2),
        "ma200_rising": ma200 > sma(v, 200, -20), "ma50_over_200": ma50 > ma200,
        "rsi14": round(rsi(v), 1), "dd52": round((close / hi - 1) * 100, 1),
        "chg_1w_pct": round(chg(v, 5), 2), "chg_1d_pct": round(chg(v, 1), 2),
    }


def regime(rows):
    ok = [r for r in rows if "error" not in r]
    if not ok:
        return None
    up = sum(r["above50"] and r["above200"] for r in ok)
    dn = sum((not r["above50"]) and (not r["above200"]) for r in ok)
    return "상승장" if up == len(ok) else "하락장" if dn == len(ok) else "횡보장"


def ratio_chg(a, b, days=20):
    va, vb = closes(a), closes(b)
    if not va or not vb:
        return None
    m = dict(vb)
    r = [x / m[d] for d, x in va if d in m and m[d]]
    return chg(r, days)


def ev(key, label, value, signal, note):
    """signal: up(상승 근거) / down(하락 근거) / flat(중립)"""
    return {"k": key, "label": label, "value": value, "signal": signal, "note": note}


def trend_evidence(r, prefix):
    out = []
    if "error" in r:
        return out
    s = "up" if r["above50"] and r["above200"] else "down" if not r["above50"] and not r["above200"] else "flat"
    out.append(ev(prefix + "trend", f"{r['name']} 이동평균선", f"50일선 {r['gap50']:+.1f}% · 200일선 {r['gap200']:+.1f}%", s,
                  "두 선 위 = 추세 상승, 두 선 아래 = 추세 하락"))
    out.append(ev(prefix + "slope", f"{r['name']} 200일선 방향", "오르는 중" if r["ma200_rising"] else "내리는 중",
                  "up" if r["ma200_rising"] else "down", "장기 추세의 기울기"))
    out.append(ev(prefix + "cross", f"{r['name']} 50일선 vs 200일선", "골든크로스 구간" if r["ma50_over_200"] else "데드크로스 구간",
                  "up" if r["ma50_over_200"] else "down", "50일선이 200일선 위면 중기 상승 구조"))
    rv = r["rsi14"]
    out.append(ev(prefix + "rsi", f"{r['name']} RSI(14)", f"{rv:.0f}",
                  "up" if rv < 30 else "down" if rv > 70 else "flat",
                  "30 아래 과매도 = 기술적 반등 근거, 70 위 과열 = 조정 근거"))
    dd = r["dd52"]
    out.append(ev(prefix + "dd", f"{r['name']} 52주 고점 대비", f"{dd:+.1f}%",
                  "down" if dd <= -20 else "flat" if dd <= -10 else "up", "-10% 조정, -20% 이하 약세장 기준"))
    return out


def main():
    rows = [index_row(n, t) for n, t, _ in INDICES]
    by = {r["name"]: r for r in rows}
    out = {"updated": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "Yahoo Finance 일봉 종가로 코드가 직접 계산", "indices": rows}
    out["regime_us"] = regime([r for r, (_, _, m) in zip(rows, INDICES) if m == "us"])
    out["regime_kr"] = regime([r for r, (_, _, m) in zip(rows, INDICES) if m == "kr"])

    vix, tnx, dxy, krw = vals("^VIX"), vals("^TNX"), vals("DX-Y.NYB"), vals("KRW=X")
    if vix:
        out["vix"] = round(vix[-1], 2)
    if tnx:
        out["us10y"] = round(tnx[-1], 2)
    if krw:
        out["usdkrw"] = round(krw[-1], 2)
    if dxy:
        d20 = chg(dxy, 20)
        out["dxy"] = "상승" if d20 and d20 > 0.5 else "하락" if d20 and d20 < -0.5 else "횡보"
        out["dxy_value"] = round(dxy[-1], 2)

    common = []
    if vix:
        v, avg = vix[-1], sma(vix, 20)
        common.append(ev("vix", "VIX 공포지수", f"{v:.1f} (20일 평균 {avg:.1f})" if avg else f"{v:.1f}",
                         "up" if v < 18 else "down" if v > 25 else "flat", "18 아래 안정, 25 위 공포 확대"))
    if tnx and len(tnx) > 21:
        d = tnx[-1] - tnx[-21]
        common.append(ev("rate", "미 10년물 금리 (20일)", f"{tnx[-1]:.2f}% ({d:+.2f}%p)",
                         "down" if d > 0.2 else "up" if d < -0.2 else "flat", "금리 급등은 주식에 부담"))
    br = ratio_chg(*RATIO["breadth"])
    cr = ratio_chg(*RATIO["credit"])
    se = ratio_chg(*RATIO["semis"])

    us = []
    for n in ("나스닥", "S&P500"):
        us += trend_evidence(by.get(n, {"error": 1}), "us_" + ("ndx_" if n == "나스닥" else "spx_"))
    # S&P500은 추세·200일선 방향만 남겨 중복을 줄임
    us = [e for e in us if not (e["k"].startswith("us_spx_") and e["k"][7:] in ("cross", "rsi", "dd"))]
    us += common
    if br is not None:
        us.append(ev("breadth", "시장 폭 (동일가중 vs 시총가중, 20일)", f"{br:+.1f}%",
                     "up" if br > 0.5 else "down" if br < -1 else "flat", "+면 많은 종목이 함께 오름, -면 소수 대형주만 버팀"))
    if cr is not None:
        us.append(ev("credit", "신용 위험 선호 (하이일드 vs 국채, 20일)", f"{cr:+.1f}%",
                     "up" if cr > 0.3 else "down" if cr < -0.5 else "flat", "-면 채권시장이 위험을 피하는 중"))
    if dxy and len(dxy) > 21:
        d = chg(dxy, 20)
        us.append(ev("dxy", "달러 인덱스 (20일)", f"{d:+.1f}%", "down" if d > 1.5 else "up" if d < -1.5 else "flat", "달러 급등은 위험자산에 부담"))

    kr = []
    for n in ("코스피", "코스닥"):
        kr += trend_evidence(by.get(n, {"error": 1}), "kr_" + ("ks_" if n == "코스피" else "kq_"))
    kr = [e for e in kr if not (e["k"].startswith("kr_kq_") and e["k"][6:] in ("cross", "rsi", "dd"))]
    if krw and len(krw) > 21:
        d = chg(krw, 20)
        kr.append(ev("krw", "원달러 환율 (20일)", f"{krw[-1]:,.0f}원 ({d:+.1f}%)",
                     "down" if d > 2 else "up" if d < -2 else "flat", "원화 급약세는 외국인 매도 압력"))
    usr = out["regime_us"]
    kr.append(ev("us_lead", "미국 시장 영향", usr or "확인 불가", "up" if usr == "상승장" else "down" if usr == "하락장" else "flat",
                 "한국 증시는 미국 흐름을 따라가는 경향"))
    if se is not None:
        kr.append(ev("semis", "반도체 업종 강도 (SOXX vs S&P, 20일)", f"{se:+.1f}%",
                     "up" if se > 1 else "down" if se < -1 else "flat", "코스피는 반도체 비중이 커서 영향이 큼"))
    kr += [e for e in common if e["k"] == "vix"]

    def tally(lst):
        u = sum(e["signal"] == "up" for e in lst); d = sum(e["signal"] == "down" for e in lst); f = len(lst) - u - d
        lean = "상승 근거 우세" if u - d >= 2 else "하락 근거 우세" if d - u >= 2 else "근거 팽팽"
        return {"up": u, "down": d, "flat": f, "lean": lean}

    def turn(names, extra):
        t = []
        for n in names:
            r = by.get(n)
            if r and "error" not in r:
                if not r["above50"]:
                    t.append(f"{n} 50일선 {r['ma50']:,.0f} 회복 (현재 {r['gap50']:+.1f}%)")
                if not r["above200"]:
                    t.append(f"{n} 200일선 {r['ma200']:,.0f} 회복 (현재 {r['gap200']:+.1f}%)")
                if r["above50"] and r["above200"]:
                    t.append(f"{n} 50일선 {r['ma50']:,.0f} 이탈 시 경계")
        return t + extra

    out["evidence"] = {"us": us, "kr": kr}
    out["tally"] = {"us": tally(us), "kr": tally(kr)}
    vix_turn = ["VIX 20 아래로 안정"] if vix and vix[-1] >= 20 else ["VIX 25 위로 급등 시 경계"]
    out["turn"] = {"us": turn(["나스닥", "S&P500"], vix_turn), "kr": turn(["코스피"], ["원달러 환율 안정", "미국 시장 상승 전환"])}

    with open("market.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: out[k] for k in ("regime_us", "regime_kr", "tally", "turn")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
