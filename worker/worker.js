// AI 투자위원회 · 차트 지표 계산 서버 (Cloudflare Worker, 무료)
// 일봉 데이터를 받아 트레이딩뷰와 같은 공식으로 EMA·CCI·ATR·ADX·지지/저항·매물대를 계산해 JSON으로 돌려준다.
// 사용: https://<worker 주소>/?s=TSLA            (미국)
//       https://<worker 주소>/?s=005930&m=kr     (한국 종목·ETF 코드)

const VERSION = "4";
const ALLOW_ORIGIN = "*"; // 필요하면 "https://kodong89.github.io" 로 제한
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    const url = new URL(req.url);
    const sym = (url.searchParams.get("s") || "").trim();
    let mkt = (url.searchParams.get("m") || "").toLowerCase();
    if (!sym) return json({ error: "s(종목 코드)가 필요해요. 예: ?s=TSLA 또는 ?s=005930&m=kr" }, 400);
    if (!mkt) mkt = /^\d{4}[0-9A-Z]{2}$/i.test(sym) ? "kr" : "us";

    const cache = caches.default, key = new Request(`https://cache.local/v${VERSION}/${mkt}/${sym.toUpperCase()}`);
    const hit = await cache.match(key);
    if (hit) return cors(hit);

    try {
      const bars = await loadBars(sym, mkt);
      if (!bars || bars.length < 60) return json({ error: `일봉 데이터를 찾지 못했어요 (${sym})` }, 404);
      const idx = await loadBars(mkt === "kr" ? "^KS11" : "SPY", mkt === "kr" ? "kr-index" : "us").catch(() => null);
      const out = compute(bars, idx);
      out.symbol = sym.toUpperCase(); out.market = mkt; out.source = bars.source; out.version = VERSION; out.checked = bars.checked || null;
      const res = json(out, 200, 600);
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  },
};

// ── 데이터 받기: 미국 Yahoo → Stooq, 한국 Naver → Yahoo ──────────
async function loadBars(sym, mkt) {
  const tries = [];
  if (mkt === "kr") tries.push(() => naver(sym), () => yahoo(`${sym}.KS`), () => yahoo(`${sym}.KQ`));
  else if (mkt === "kr-index") tries.push(() => yahoo(sym));
  else {
    const day = b => b && b.length ? new Date(b[b.length - 1].t).toISOString().slice(0, 10) : "";
    const [y, s] = await Promise.all([yahoo(sym).catch(() => null), stooq(sym).catch(() => null)]);
    const ok = [y, s].filter(b => b && b.length >= 60).sort((a, b) => day(b).localeCompare(day(a)));
    if (ok.length) { ok[0].checked = { yahoo: day(y) || "실패", stooq: day(s) || "실패" }; return ok[0]; }
    return null;
  }
  for (const t of tries) {
    try { const b = await t(); if (b && b.length >= 60) return b; } catch (e) {}
  }
  return null;
}
async function yahoo(s) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=2y&interval=1d&includePrePost=false`, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("yahoo " + r.status);
  const j = await r.json(), res = j.chart?.result?.[0], q = res?.indicators?.quote?.[0];
  if (!res || !q) throw new Error("yahoo empty");
  const b = [];
  res.timestamp.forEach((t, i) => { if (q.close[i] != null && q.high[i] != null && q.low[i] != null) b.push({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 }); });
  // 가장 최근 거래일 봉이 목록에 없거나 덜 채워진 경우 meta(현재가 정보)로 보완
  const m = res.meta || {};
  if (m.regularMarketPrice && m.regularMarketTime) {
    const t = m.regularMarketTime * 1000, day = d => new Date(d + (m.gmtoffset || 0) * 1000).toISOString().slice(0, 10);
    const last = b[b.length - 1];
    const bar = { t, o: m.regularMarketOpen ?? last?.c, h: m.regularMarketDayHigh ?? m.regularMarketPrice, l: m.regularMarketDayLow ?? m.regularMarketPrice, c: m.regularMarketPrice, v: m.regularMarketVolume || 0 };
    if (!last || day(t) > day(last.t)) b.push(bar);
    else if (day(t) === day(last.t)) b[b.length - 1] = { ...last, c: bar.c, h: Math.max(last.h, bar.h), l: Math.min(last.l, bar.l), v: Math.max(last.v, bar.v) };
  }
  b.source = "Yahoo Finance"; b.name = m.shortName || m.symbol; b.currency = m.currency;
  return b;
}
async function stooq(s) {
  const r = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(s.toLowerCase())}.us&i=d`, { headers: { "User-Agent": UA } });
  const txt = await r.text(), lines = txt.trim().split("\n").slice(1);
  const b = lines.map(l => l.split(",")).filter(x => x.length >= 6 && x[4] !== "").map(x => ({ t: Date.parse(x[0]), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] || 0 })).slice(-520);
  b.source = "Stooq"; b.currency = "USD";
  return b;
}
async function naver(code) {
  const r = await fetch(`https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(code)}&timeframe=day&count=520&requestType=0`, { headers: { "User-Agent": UA } });
  const txt = await r.text();
  const b = [...txt.matchAll(/data="([^"]+)"/g)].map(m => m[1].split("|")).filter(x => x.length >= 6).map(x => ({
    t: Date.UTC(+x[0].slice(0, 4), +x[0].slice(4, 6) - 1, +x[0].slice(6, 8)), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] || 0 }));
  const nm = txt.match(/name="([^"]+)"/);
  b.source = "네이버 금융"; b.name = nm ? nm[1] : code; b.currency = "KRW";
  return b;
}

// ── 지표 계산 (트레이딩뷰 공식) ─────────────────────────────────
function ema(src, n) { // ta.ema: 첫 n개 SMA로 시작
  const out = Array(src.length).fill(null), a = 2 / (n + 1);
  if (src.length < n) return out;
  let e = src.slice(0, n).reduce((x, y) => x + y, 0) / n; out[n - 1] = e;
  for (let i = n; i < src.length; i++) { e = a * src[i] + (1 - a) * e; out[i] = e; }
  return out;
}
function rma(src, n) { // ta.rma (Wilder)
  const out = Array(src.length).fill(null);
  if (src.length < n) return out;
  let r = src.slice(0, n).reduce((x, y) => x + y, 0) / n; out[n - 1] = r;
  for (let i = n; i < src.length; i++) { r = (r * (n - 1) + src[i]) / n; out[i] = r; }
  return out;
}
const sma = (src, n, i = src.length - 1) => i + 1 < n ? null : src.slice(i - n + 1, i + 1).reduce((x, y) => x + y, 0) / n;
function cci(b, n = 20, i = b.length - 1) { // ta.cci(hlc3, 20)
  const tp = b.map(x => (x.h + x.l + x.c) / 3), w = tp.slice(i - n + 1, i + 1), m = w.reduce((x, y) => x + y, 0) / n;
  const dev = w.reduce((x, y) => x + Math.abs(y - m), 0) / n;
  return dev ? (tp[i] - m) / (0.015 * dev) : 0;
}
function atrAdx(b, n = 14) {
  const tr = [], pdm = [], ndm = [];
  for (let i = 0; i < b.length; i++) {
    if (!i) { tr.push(b[i].h - b[i].l); pdm.push(0); ndm.push(0); continue; }
    const up = b[i].h - b[i - 1].h, dn = b[i - 1].l - b[i].l;
    tr.push(Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)));
    pdm.push(up > dn && up > 0 ? up : 0); ndm.push(dn > up && dn > 0 ? dn : 0);
  }
  const atr = rma(tr, n), sp = rma(pdm, n), sn = rma(ndm, n);
  const dx = atr.map((a, i) => { if (!a || sp[i] == null) return null; const p = 100 * sp[i] / a, m = 100 * sn[i] / a; return p + m ? 100 * Math.abs(p - m) / (p + m) : 0; });
  const first = dx.findIndex(x => x != null), adx = rma(dx.slice(first), n);
  return { atr: atr[atr.length - 1], adx: adx[adx.length - 1], pdi: 100 * sp[sp.length - 1] / atr[atr.length - 1], mdi: 100 * sn[sn.length - 1] / atr[atr.length - 1] };
}
function pivots(b, look = 120, k = 3) { // 좌우 k봉보다 높은/낮은 봉
  const s = b.slice(-look), hi = [], lo = [];
  for (let i = k; i < s.length - k; i++) {
    const w = s.slice(i - k, i + k + 1);
    if (s[i].h === Math.max(...w.map(x => x.h))) hi.push(s[i].h);
    if (s[i].l === Math.min(...w.map(x => x.l))) lo.push(s[i].l);
  }
  return { hi, lo };
}
function volumeProfile(b, price, look = 120, bins = 40) {
  const s = b.slice(-look), top = Math.max(...s.map(x => x.h)), bot = Math.min(...s.map(x => x.l)), w = (top - bot) / bins || 1;
  const vol = Array(bins).fill(0);
  for (const x of s) { // 봉 거래량을 고가~저가 구간에 고르게 나눔
    const a = Math.max(0, Math.floor((x.l - bot) / w)), z = Math.min(bins - 1, Math.floor((x.h - bot) / w));
    for (let j = a; j <= z; j++) vol[j] += x.v / (z - a + 1);
  }
  const mid = j => bot + (j + 0.5) * w;
  let poc = null, best = 0, pocAll = 0, bestAll = 0;
  vol.forEach((v, j) => { if (v > bestAll) { bestAll = v; pocAll = mid(j); } if (mid(j) > price && v > best) { best = v; poc = mid(j); } });
  return { overhead: poc, poc: pocAll };
}
const r2 = v => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
const pc = (a, b) => a && b ? r2((a / b - 1) * 100) : null;

function compute(b, idx) {
  const c = b.map(x => x.c), n = b.length, last = b[n - 1], prev = b[n - 2];
  const e10 = ema(c, 10), e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
  const { atr, adx, pdi, mdi } = atrAdx(b, 14);
  const { hi, lo } = pivots(b);
  const price = last.c;
  const support = lo.filter(v => v < price).sort((x, y) => y - x)[0] ?? null;
  const resistance = hi.filter(v => v > price).sort((x, y) => x - y)[0] ?? null;
  const vp = volumeProfile(b, price);
  const y = b.slice(-252), vols = b.map(x => x.v);
  const ic = idx ? idx.map(x => x.c) : null;
  return {
    date: new Date(last.t).toISOString().slice(0, 10), name: b.name || null, currency: b.currency || null,
    price: r2(price), change_pct: pc(price, prev.c), open: r2(last.o), high: r2(last.h), low: r2(last.l),
    ema10: r2(e10[n - 1]), ema20: r2(e20[n - 1]), ema50: r2(e50[n - 1]), ema200: r2(e200[n - 1]),
    ema200_rising: e200[n - 1] != null && e200[n - 21] != null ? e200[n - 1] > e200[n - 21] : null,
    cci20: r2(cci(b, 20)), cci20_prev: r2(cci(b, 20, n - 4)), // 3거래일 전
    adx14: r2(adx), plus_di: r2(pdi), minus_di: r2(mdi), atr14: r2(atr),
    rsi14: r2(rsiCalc(c, 14)),
    volume_recent: last.v, avg_volume_20: Math.round(sma(vols, 20) || 0),
    support: r2(support), resistance: r2(resistance), swing_low: r2(Math.min(...b.slice(-10).map(x => x.l))),
    overhead_poc: r2(vp.overhead), poc_120d: r2(vp.poc),
    high_52w: r2(Math.max(...y.map(x => x.h))), low_52w: r2(Math.min(...y.map(x => x.l))),
    return_1m_pct: pc(price, c[n - 22]), return_3m_pct: pc(price, c[n - 64]),
    index_return_3m_pct: ic && ic.length > 64 ? pc(ic[ic.length - 1], ic[ic.length - 64]) : null,
    bars: n, computed: true,
  };
}
function rsiCalc(c, n) {
  const g = [], l = [];
  for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g.push(Math.max(d, 0)); l.push(Math.max(-d, 0)); }
  const ag = rma(g, n), al = rma(l, n), a = ag[ag.length - 1], z = al[al.length - 1];
  return z === 0 ? 100 : 100 - 100 / (1 + a / z);
}

function cors(res) {
  const r = new Response(res.body, res);
  r.headers.set("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  r.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  return r;
}
function json(o, status = 200, maxAge = 0) {
  return cors(new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${maxAge}` } }));
}
