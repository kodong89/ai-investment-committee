"""지수 데이터를 받아 이동평균선·국면을 계산해 market.json으로 저장 (GitHub Actions에서 실행)"""
import json, datetime as dt
import yfinance as yf

INDICES = [("나스닥", "^IXIC", "us"), ("S&P500", "^GSPC", "us"), ("코스피", "^KS11", "kr"), ("코스닥", "^KQ11", "kr")]
EXTRA = {"vix": "^VIX", "usdkrw": "KRW=X", "us10y": "^TNX", "dxy": "DX-Y.NYB"}


def closes(ticker, period="2y"):
    df = yf.download(ticker, period=period, interval="1d", progress=False, auto_adjust=False)
    if df is None or df.empty:
        return []
    s = df["Close"]
    if hasattr(s, "columns"):  # 다중 컬럼 대비
        s = s.iloc[:, 0]
    s = s.dropna()
    return [(d.strftime("%Y-%m-%d"), float(v)) for d, v in s.items()]


def sma(vals, n):
    return sum(vals[-n:]) / n if len(vals) >= n else None


def index_row(name, ticker):
    c = closes(ticker)
    if len(c) < 210:
        return {"name": name, "ticker": ticker, "error": f"데이터 부족({len(c)}일)"}
    vals = [v for _, v in c]
    close, ma50, ma200 = vals[-1], sma(vals, 50), sma(vals, 200)
    ma200_prev = sum(vals[-220:-20]) / 200  # 20거래일 전 200일선 → 기울기
    return {
        "name": name, "ticker": ticker, "date": c[-1][0],
        "close": round(close, 2), "ma50": round(ma50, 2), "ma200": round(ma200, 2),
        "above50": close > ma50, "above200": close > ma200,
        "gap50": round((close / ma50 - 1) * 100, 2), "gap200": round((close / ma200 - 1) * 100, 2),
        "ma200_rising": ma200 > ma200_prev,
        "chg_1w_pct": round((close / vals[-6] - 1) * 100, 2),
        "chg_1d_pct": round((close / vals[-2] - 1) * 100, 2),
    }


def regime(rows):
    ok = [r for r in rows if "error" not in r]
    if not ok:
        return None
    up = sum(r["above50"] and r["above200"] for r in ok)
    dn = sum((not r["above50"]) and (not r["above200"]) for r in ok)
    return "상승장" if up == len(ok) else "하락장" if dn == len(ok) else "횡보장"


def last(ticker):
    c = closes(ticker, "3mo")
    return c if c else None


def main():
    rows = [index_row(n, t) for n, t, _ in INDICES]
    out = {"updated": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "Yahoo Finance 일봉 종가 · 단순이동평균(SMA) 직접 계산", "indices": rows}
    out["regime_us"] = regime([r for r, (_, _, m) in zip(rows, INDICES) if m == "us"])
    out["regime_kr"] = regime([r for r, (_, _, m) in zip(rows, INDICES) if m == "kr"])
    for k, t in EXTRA.items():
        c = last(t)
        if not c:
            continue
        v = c[-1][1]
        if k == "dxy":
            prev = c[-21][1] if len(c) > 21 else c[0][1]
            out["dxy"] = "상승" if v > prev * 1.005 else "하락" if v < prev * 0.995 else "횡보"
            out["dxy_value"] = round(v, 2)
        else:
            out[k] = round(v, 2)
    with open("market.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(json.dumps(out, ensure_ascii=False)[:800])


if __name__ == "__main__":
    main()
