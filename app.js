// AI 투자위원회 v2 — 투자 대가 7인 스윙 투자 심사
// 원칙: AI는 각 채점 항목을 판정(pass/fail/unknown)만 하고, 점수·가중합·거부권·손절·손익비는 코드가 계산한다.
{
const API = "https://generativelanguage.googleapis.com/v1beta";
const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => { if (v === null || v === undefined || v === "") return null; const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

// ── 판정 기준표 ────────────────────────────────────────────
// 점수 = 충족 항목 배점 합 ÷ 판정 가능 항목 배점 합 × 100, 자료가 부족하면 50점 쪽으로 당김
// rule(F,T,M,P)가 true/false를 돌려주면 AI 판정 대신 코드 판정 사용 (null이면 AI 판정)
const gt = (a, b) => (a == null || b == null) ? null : a > b;
const AG = [
  { id: "mine", n: "내 매매법", role: "추세 · 진입 신호", w: 25, color: "#00463c", gate: "trend",
    q: "내 차트 기준(EMA 리본·CCI·거래량·매물대)으로 지금 들어갈 자리인가?",
    p: "EMA 10·20·50·200 리본으로 추세 방향을 보고(게이트), CCI(20)가 -100 아래에서 올라오는 반등 또는 0선·+100 상향 돌파를 진입 신호로 쓴다. 거래량이 20일 평균보다 늘어야 신호를 믿고, 위쪽 매물대(PVP)까지 여유가 있어야 한다. 손절은 ATR, 추세가 꺾이면(EMA20 종가 이탈) 청산한다. 하락 추세에서 나온 CCI 반등은 역추세라 신뢰하지 않는다.",
    checks: [
      { id: "ribbon", t: "추세 게이트: 주가 > EMA20 > EMA50, EMA10 > EMA20", pts: 25, rule: (F, T) => { const p = num(F.price), e10 = num(T.ema10), e20 = num(T.ema20), e50 = num(T.ema50); return (p && e10 && e20 && e50) ? (p > e20 && e20 > e50 && e10 > e20) : null; } },
      { id: "e200", t: "주가가 EMA200 위", pts: 10, rule: (F, T) => gt(num(F.price), num(T.ema200)) },
      { id: "cci", t: "CCI(20) 신호: -100 상향 반등 또는 0·+100 상향 돌파", pts: 25, rule: (F, T) => { const c = num(T.cci20), p = num(T.cci20_prev); if (c == null || p == null) return null; return (p < -100 && c >= -100) || (p < 0 && c >= 0) || (p < 100 && c >= 100) || (c > p && c > -100 && c < 100 && p < c - 30); } },
      { id: "vol", t: "거래량이 20일 평균의 1.2배 이상", pts: 15, rule: (F, T) => { const v = num(T.volume_recent), a = num(T.avg_volume_20); return (v && a) ? v >= a * 1.2 : null; } },
      { id: "pvp", t: "위쪽 매물대(PVP)까지 손절폭 2배 이상 여유", pts: 15, rule: (F, T, M, P) => { const poc = num(T.overhead_poc), e = P?.entry, r = P ? P.entry - P.stop : null; if (!e || !r) return null; if (!poc || poc <= e) return true; return (poc - e) >= 2 * r; } },
      { id: "liq", t: "거래대금 충분 (미국 2천만$·한국 100억원 이상)", pts: 10, rule: (F, T) => { const v = num(T.avg_volume_20), p = num(F.price); if (!v || !p) return null; return /KRW|원/.test(F.currency || "") ? v * p >= 1e10 : v * p >= 2e7; } } ] },
  { id: "druck", n: "스탠리 드러켄밀러", role: "시장 방향", w: 20, color: "#b08a22",
    q: "좋은 기업인지를 떠나, 지금 돈이 이 종목으로 들어오고 있는가?",
    p: "유동성·금리·달러가 시장을 움직인다고 보고, 18~24개월 앞의 변곡점과 지금의 자금 흐름을 본다. 추세를 존중하고 비대칭 베팅을 한다.",
    checks: [
      { id: "regime", t: "시장 국면이 우호적(상승장)", pts: 20, rule: (F, T, M) => { const g = regimeFor(F, M); return g ? g === "상승장" : null; } },
      { id: "sector", t: "섹터가 시장 주도 업종", pts: 20 },
      { id: "rs", t: "3개월 수익률이 지수보다 강함", pts: 20, rule: (F, T) => gt(num(T.return_3m_pct), num(T.index_return_3m_pct)) },
      { id: "flow", t: "기관·외국인 수급 또는 거래대금 증가", pts: 15 },
      { id: "catalyst", t: "1~3개월 내 상승 촉매", pts: 15 },
      { id: "rates", t: "금리·달러 환경이 우호적", pts: 10 } ] },
  { id: "raschke", n: "린다 라쉬키", role: "눌림목 타이밍", w: 15, color: "#8a6d3b",
    q: "강한 추세 속에서 지금 쉬어가는 눌림 자리인가?",
    p: "ADX로 추세 강도를 확인하고, 강한 추세에서 20 EMA 부근까지 눌렸다가 다시 고개를 드는 자리(Holy Grail)를 노린다. 며칠~몇 주 보유하며 모멘텀이 꺾이면 빠르게 정리한다. 과열 구간 추격은 피한다.",
    checks: [
      { id: "adx", t: "ADX(14) 25 이상 · 추세가 강함", pts: 25, rule: (F, T) => num(T.adx14) == null ? null : num(T.adx14) >= 25 },
      { id: "pull", t: "주가가 20 EMA 부근(-2%~+4%)으로 눌림", pts: 25, rule: (F, T) => { const p = num(F.price), e = num(T.ema20); return (p && e) ? (p >= e * 0.98 && p <= e * 1.04) : null; } },
      { id: "mom", t: "최근 1개월 상승 탄력 유지", pts: 15, rule: (F, T) => num(T.return_1m_pct) == null ? null : num(T.return_1m_pct) > 0 },
      { id: "bar", t: "눌림 후 반등 캔들 · 전일 고가 돌파", pts: 20 },
      { id: "hot", t: "단기 과열 아님 (CCI 200 미만)", pts: 15, rule: (F, T) => num(T.cci20) == null ? null : num(T.cci20) < 200 } ] },
  { id: "kullamagi", n: "크리스티안 쿨라매기", role: "돌파 · 청산 규칙", w: 15, color: "#7a2e2e",
    q: "시장 주도주가 박스권을 거래량과 함께 돌파하는가?",
    p: "1~3개월 가장 강한 주도주만 본다. 2주~2개월 횡보하며 수렴한 박스를 거래량과 함께 돌파할 때(또는 실적 갭 상승 EP) 진입하고, 당일 저점에 손절. 3~5일 안에 1/3~1/2 익절, 나머지는 10·20 EMA 종가 이탈 때 청산한다.",
    checks: [
      { id: "leader", t: "주도주: 3개월 +30% 이상 또는 지수보다 크게 강함", pts: 25, rule: (F, T) => { const r = num(T.return_3m_pct), i = num(T.index_return_3m_pct); if (r == null) return null; return r >= 30 || (i != null && r - i >= 20); } },
      { id: "base", t: "2주~2개월 박스권 횡보·수렴", pts: 20 },
      { id: "brk", t: "박스 상단을 거래량과 함께 돌파 (또는 실적 갭 상승)", pts: 25 },
      { id: "ema", t: "주가 > 10 EMA > 20 EMA", pts: 15, rule: (F, T) => { const p = num(F.price), a = num(T.ema10), b = num(T.ema20); return (p && a && b) ? (p > a && a > b) : null; } },
      { id: "cat", t: "강한 재료(실적·신제품·산업 테마)", pts: 15 } ] },
  { id: "ptj", n: "폴 튜더 존스", role: "리스크 관리 · 거부권", w: 15, color: "#1f3a5f",
    q: "판단이 틀렸을 때 감당해야 할 손실은 얼마인가?",
    p: "손익비, 변동성, 갭 하락, 시장 급락, 실적 발표 위험을 먼저 본다. 원금 보존이 최우선이며 중대한 위험이 있으면 거부권을 행사한다.",
    checks: [
      { id: "rr", t: "손익비 2:1 이상", pts: 25, rule: (F, T, M, P) => P?.rr == null ? null : P.rr >= 2 },
      { id: "earn", t: "실적 발표가 5거래일 이내가 아님", pts: 20, rule: F => { const d = daysTo(F.next_earnings_date); return d == null ? null : !(d >= 0 && d <= 7); } },
      { id: "vol", t: "변동성 적정(ATR 5% 이하)", pts: 15, rule: (F, T, M, P) => P?.atrPct == null ? null : P.atrPct <= 0.05 },
      { id: "crash", t: "시장 급락 위험 낮음(VIX 25 미만)", pts: 20, rule: (F, T, M) => num(M?.vix) == null ? null : num(M.vix) < 25 },
      { id: "event", t: "증자·소송·규제 등 갭 하락 이벤트 위험 낮음", pts: 20 } ] },
  { id: "lynch", n: "피터 린치", role: "성장성", w: 10, color: "#2f8a4e",
    q: "앞으로 실적이 시장의 기대보다 빠르게 성장할 수 있는가?",
    p: "기업을 저성장·우량·고성장·경기순환·턴어라운드·자산주로 분류하고 범주에 맞게 판단한다. PEG를 중시하고 2분 안에 설명되는 스토리를 좋아한다.",
    checks: [
      { id: "rev", t: "매출 성장률 10% 이상", pts: 20, rule: F => num(F.revenue_growth_pct) == null ? null : num(F.revenue_growth_pct) >= 10 },
      { id: "eps", t: "EPS 성장률 15% 이상 또는 가속", pts: 25, rule: F => num(F.eps_growth_pct) == null ? null : num(F.eps_growth_pct) >= 15 },
      { id: "peg", t: "PEG 1.5 이하", pts: 20, rule: F => num(F.peg) == null ? null : num(F.peg) > 0 && num(F.peg) <= 1.5 },
      { id: "guide", t: "실적 전망·가이던스 상향", pts: 20 },
      { id: "industry", t: "산업 자체가 성장 중", pts: 15 } ] },
  { id: "munger", n: "찰리 멍거", role: "큰 실패 위험 · 경고", w: 0, warnOnly: true, color: "#6a4fd8",
    q: "이 종목에 투자하면 어떤 이유로 큰돈을 잃을 수 있는가?",
    p: "뒤집어 생각한다. 망하는 길부터 찾고, 인센티브와 경영진 신뢰를 따지며, 과도한 기대·레버리지·복잡함을 피한다. 각 항목은 '그 위험이 없으면 통과'다.",
    checks: [
      { id: "thesis", t: "투자 논리가 하나의 가정에만 의존하지 않음", pts: 20 },
      { id: "lever", t: "과도한 부채 없음", pts: 20, rule: F => num(F.debt_to_equity_pct) == null ? null : num(F.debt_to_equity_pct) <= 150 },
      { id: "mgmt", t: "경영진 신뢰 문제(회계·소송·내부자 대량매도) 없음", pts: 20 },
      { id: "hype", t: "시장 기대가 과열되지 않음", pts: 20 },
      { id: "simple", t: "사업 구조가 단순하고 이해 가능", pts: 20 } ] }
];
const AGI = Object.fromEntries(AG.map(a => [a.id, a]));
function daysTo(s) { if (!s) return null; const d = new Date(s); if (isNaN(d)) return null; return Math.round((d - new Date()) / 864e5); }

// ── 설정 ───────────────────────────────────────────────────
const DEFAULT_WORKER = "https://aic-chart.sukko89.workers.dev";
let cfg = Object.assign({ key: "", model: "gemini-flash-latest", mode: "eco", worker: DEFAULT_WORKER }, store.get("aic-cfg", {}));
if (!cfg.worker) cfg.worker = DEFAULT_WORKER;
if ((cfg.v || 0) < 3) { cfg.riskPct = 1; cfg.maxPos = 30; cfg.v = 3; store.set("aic-cfg", cfg); }
$("key").value = cfg.key; $("mode").value = cfg.mode;
const saveCfg = () => store.set("aic-cfg", cfg);
$("setup").style.display = cfg.key ? "none" : "block";
$("openSet").addEventListener("click", () => { const s = $("setup"); s.style.display = s.style.display === "block" ? "none" : "block"; if (cfg.key) loadModels(); });
$("saveKey").addEventListener("click", async () => { cfg.key = $("key").value.trim(); saveCfg(); if (cfg.key) { await loadModels(); setStatus("키 저장 완료. 종목을 검색해 보세요."); $("setup").style.display = "none"; } });
$("model").addEventListener("change", () => { cfg.model = $("model").value; saveCfg(); });
$("mode").addEventListener("change", () => { cfg.mode = $("mode").value; saveCfg(); });
$("workerUrl").value = cfg.worker || ""; $("workerUrl").addEventListener("change", () => { cfg.worker = $("workerUrl").value.trim(); saveCfg(); });
$("riskPct").value = cfg.riskPct ?? 1; $("riskPct").addEventListener("change", () => { cfg.riskPct = $("riskPct").value; saveCfg(); });
$("maxPos").value = cfg.maxPos ?? 30; $("maxPos").addEventListener("change", () => { cfg.maxPos = $("maxPos").value; saveCfg(); });

async function loadModels() {
  try {
    const r = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": cfg.key } });
    if (!r.ok) return;
    const ids = ((await r.json()).models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => m.name.replace(/^models\//, "")).filter(n => /^gemini/.test(n) && !/(image|tts|live|audio|embedding|robotics|translate)/.test(n));
    const list = ["gemini-flash-latest", ...ids.filter(n => n !== "gemini-flash-latest")];
    $("model").innerHTML = list.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
    if (!list.includes(cfg.model)) cfg.model = list[0];
    $("model").value = cfg.model; return list;
  } catch (e) {}
}

// ── Gemini ────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const setStatus = t => { $("status").textContent = t || ""; };
const showErr = m => { const e = $("err"); e.textContent = m || ""; e.style.display = m ? "block" : "none"; };
function parseJSON(t) {
  t = String(t || "").replace(/```json|```/g, "").trim();
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("AI 응답을 해석하지 못했어요");
}
async function gemini(prompt, { search = false, urls = false, label = "", raw = null } = {}) {
  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3 } };
  if (search || urls) { body.tools = []; if (search) body.tools.push({ google_search: {} }); if (urls) body.tools.push({ url_context: {} }); } else body.generationConfig.responseMimeType = "application/json";
  for (let i = 0; i < 4; i++) {
    let r;
    try {
      r = await fetch(`${API}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.key }, body: JSON.stringify(body) });
    } catch (netErr) {
      // 네트워크 끊김(Safari "Load failed", Chrome "Failed to fetch"): 잠시 후 재시도
      if (i >= 3) { const e = new Error(`${label}: 인터넷 연결이 끊겼어요. 분석 중에는 화면을 켜 둔 채 이 페이지에 머물러 주세요.`); e.status = 0; throw e; }
      for (let s = 3 * (i + 1); s > 0; s--) { setStatus(`${label} · 연결이 끊겨 다시 시도 ${s}초`); await sleep(1000); }
      continue;
    }
    if (r.status === 429 || r.status === 503) {
      let wait = 20, daily = false;
      try { const s = JSON.stringify(await r.json()); const d = s.match(/"retryDelay":"(\d+)/); if (d) wait = Math.min(60, +d[1] + 2); daily = /PerDay/i.test(s); } catch (e) {}
      if (daily) { const e = new Error("오늘 무료 호출 한도를 다 썼어요. 한도는 한국시간 오후 4~5시쯤 초기화돼요. 설정에서 다른 모델을 고르면 별도 한도로 계속 쓸 수 있어요."); e.status = 429; throw e; }
      for (let s = wait; s > 0; s--) { setStatus(`${label} · 무료 한도 대기 ${s}초`); await sleep(1000); }
      continue;
    }
    if (!r.ok) {
      let m = `HTTP ${r.status}`; try { m = (await r.json()).error?.message || m; } catch (e) {}
      // 검색 도구를 이 모델/키에서 못 쓰면 검색 없이 다시
      if (r.status === 400 && body.tools && /search|grounding|tool/i.test(m)) { delete body.tools; body.generationConfig.responseMimeType = "application/json"; body.contents[0].parts[0].text += "\n(검색을 쓸 수 없으면 알고 있는 가장 최근 값으로 답하라)"; continue; }
      const e = new Error(m); e.status = r.status; throw e;
    }
    const j = await r.json(), c = j.candidates?.[0];
    const text = (c?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
    const sources = (c?.groundingMetadata?.groundingChunks || []).map(x => x.web).filter(w => w && /^https:\/\//.test(w.uri));
    if (raw) raw.text = text;
    try { return { data: parseJSON(text), sources }; }
    catch (e) {
      if (i >= 2) { const er = new Error(`${label}: AI 응답 형식 오류${c?.finishReason && c.finishReason !== "STOP" ? " (" + c.finishReason + ")" : ""}`); er.status = 0; throw er; }
      setStatus(`${label} · 응답 형식 오류, 다시 요청 중…`);
      if (!/반드시 유효한 JSON/.test(body.contents[0].parts[0].text)) body.contents[0].parts[0].text += "\n\n반드시 유효한 JSON 하나만 출력하라. 앞뒤 설명, 코드블록 금지.";
      continue;
    }
  }
  const e = new Error(`${label}: 무료 한도 초과 또는 응답 오류가 계속돼요. 1~2분 뒤 다시 시도해 주세요.`); e.status = 429; throw e;
}
const today = () => new Date().toISOString().slice(0, 10);

// ── 1. 시장 위험 판단 (6시간 캐시) ─────────────────────────
// 장 흐름 숫자: GitHub Actions가 Yahoo 일봉으로 직접 계산한 market.json을 우선 사용
let MJ = null;
async function loadMarketJson() {
  try { const r = await fetch("market.json?t=" + Math.floor(Date.now() / 6e5)); if (!r.ok) return null; const j = await r.json();
    return (j.indices || []).some(x => x.close != null) ? j : null; } catch (e) { return null; }
}
function newsTally(T, key) {
  const N = (T?.news || []).filter(n => n.market === key);
  const w = n => (Math.max(1, Math.min(3, Number(n.impact) || 1))) * (n.priced === "이미 반영" ? 0.5 : 1) * (n.kind === "전망" ? 0.7 : 1) * (/정책|수급/.test(n.type || "") ? 1.3 : 1);
  const up = N.filter(n => n.side === "up").reduce((a, n) => a + w(n), 0), down = N.filter(n => n.side === "down").reduce((a, n) => a + w(n), 0);
  return { n: N.length, up: Math.round(up * 10) / 10, down: Math.round(down * 10) / 10, lean: N.length ? (up - down >= 1.5 ? "상승 우세" : down - up >= 1.5 ? "하락 우세" : "혼조") : null };
}
function overall(ind, news) {
  const d = x => !x ? 0 : x.includes("상승") ? 1 : x.includes("하락") ? -1 : 0;
  const a = d(ind), b = d(news), t = a + b;
  if (!news) return ind || "—";
  return t >= 2 ? "상승 우세" : t <= -2 ? "하락 우세" : t === 1 ? "약한 상승 우세" : t === -1 ? "약한 하락 우세" : (a !== 0 ? "혼조 · 지표와 뉴스가 엇갈림" : "혼조");
}
function mergeMarket(J, T) {
  const ok = (J.indices || []).filter(x => !x.error);
  return { ...(T || {}), indices: J.indices, regime_us: J.regime_us, regime_kr: J.regime_kr, regime: J.regime_us || J.regime_kr,
    vix: J.vix, dxy: J.dxy, us10y: J.us10y, usdkrw: J.usdkrw, evidence: J.evidence, tally: J.tally, turn: J.turn, short: J.short, tally_short: J.tally_short, futures: J.futures, ntally: { us: newsTally(T, "us"), kr: newsTally(T, "kr") }, as_of: ok.map(x => x.date).sort().pop() || "", updated: J.updated, computed: true };
}
async function getMarket() {
  MJ = await loadMarketJson() || MJ;
  if (!MJ) return getMarketAI(); // 계산 데이터가 없을 때만 AI 검색 숫자 사용
  let T = store.get("aic-mtext2", null);
  // 한국 장 시작 전(08:30)·마감 후(15:40)·미국 개장 전(22:40, 한국시간)을 지나면 뉴스를 새로 분석
  const lastBoundary = () => { const now = Date.now(), k = new Date(now + 9 * 3600e3), day = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600e3;
    const b = [-1, 0].flatMap(d => [[8, 30], [15, 40], [22, 40]].map(([h, m]) => day + d * 864e5 + (h * 60 + m) * 6e4)).filter(x => x <= now); return Math.max(...b); };
  if (!T || Date.now() - T.t > 6 * 3600e3 || T.t < lastBoundary() || window.__forceNews) {
    window.__forceNews = false;
    try {
      const nums = (MJ.indices || []).filter(x => !x.error).map(x => `${x.name} ${x.close} (50일선 ${x.above50 ? "위" : "아래"}, 200일선 ${x.above200 ? "위" : "아래"}, 1주 ${x.chg_1w_pct}%)`).join(" / ");
      const r = await gemini(`오늘은 ${today()}. 너는 시장 전략가다. 구글 검색으로 최근 7일 이내 뉴스·공시·정책·실적 발표를 확인해서, 앞으로 1~4주 미국·한국 증시를 움직일 재료를 상승 요인과 하락 요인으로 나눠라.
아래 지수 숫자는 코드로 계산한 정확한 값이니 바꾸지 마라: ${nums} · VIX ${MJ.vix} · 미 10년물 ${MJ.us10y}% · 원달러 ${MJ.usdkrw}
규칙:
- 실제 날짜가 있는 소식만. 확인된 사실과 전망·추측을 구분하라. 루머나 출처 불명은 넣지 마라.
- 시장마다 상승 요인 2~4개, 하락 요인 2~4개. 이미 주가에 반영된 재료인지도 표시하라.
- impact: 지수에 미칠 영향 1(작음)~3(큼). 정부 증시 안정책(증안펀드 등)·외국인 수급 전환·지수선물 급변은 단기 영향이 크니 놓치지 마라.
- 오늘 아침 소식(장 시작 전 뉴스)을 우선 확인하라.
설명 없이 JSON 하나만:
{"leading_us":["섹터1","섹터2"],"leading_kr":["섹터1","섹터2"],"summary":"장 흐름 한 줄 요약(30자)",
 "news":[{"market":"us|kr","side":"up|down","title":"소식 요약(25자)","why":"왜 상승·하락 요인인지(35자)","date":"MM-DD","impact":1|2|3,"type":"정책|수급|실적|거시|기업|지정학","kind":"확인된 사실|전망","priced":"미반영|일부 반영|이미 반영","source":"매체명"}],
 "outlook":{"us":{"view":"상승 우세|하락 우세|혼조","reason":"뉴스 관점 한 줄(40자)","watch":"앞으로 볼 일정·변수(30자)"},"kr":{"view":"...","reason":"...","watch":"..."}}}`, { search: true, label: "장 흐름·뉴스 분석" });
      T = { t: Date.now(), v: { ...r.data, news_sources: (r.sources || []).slice(0, 10) } }; store.set("aic-mtext2", T);
    } catch (e) { if (/한도를 다 썼/.test(e.message)) throw e; }
  }
  return mergeMarket(MJ, T?.v);
}
async function getMarketAI() {
  const c = store.get("aic-market3", null);
  if (c && Date.now() - c.t < 6 * 3600e3) return c.v;
  const r = await gemini(`오늘은 ${today()}. 구글 검색으로 현재 주식시장 흐름을 정리하라.
각 지수의 최근 종가, 50일·200일 단순이동평균(SMA) 값, 최근 1주일 등락률을 숫자로 찾아라.
investing.com 기술분석·이동평균 페이지, 증권사 리포트, 네이버 금융, stockcharts 등에서 실제 숫자를 확인하고, 위/아래를 추측하지 마라. VIX, 달러인덱스 추세, 미국 10년물 금리, 원달러 환율, 최근 1개월 미국·한국 주도 섹터.
설명 없이 JSON 하나만:
{"as_of":"날짜","indices":[{"name":"나스닥","close":숫자,"ma50":숫자,"ma200":숫자,"chg_1w_pct":숫자},{"name":"S&P500",...},{"name":"코스피",...},{"name":"코스닥",...}],"vix":숫자,"dxy":"상승|횡보|하락","us10y":숫자,"usdkrw":숫자,"leading_us":["섹터1","섹터2"],"leading_kr":["섹터1","섹터2"],"summary":"장 흐름 한 줄 요약(30자)"}`, { search: true, label: "장 흐름 확인" });
  const v = { ...r.data, sources: r.sources };
  // 위/아래는 숫자로 코드가 판정 (숫자가 없으면 판정 보류)
  for (const x of v.indices || []) {
    const c = num(x.close), a = num(x.ma50), b = num(x.ma200);
    x.above50 = c && a ? c > a : null; x.above200 = c && b ? c > b : null;
    x.gap200 = c && b ? (c / b - 1) * 100 : null;
  }
  // 국면은 코드로 판정: 50일·200일선 모두 위 = 상승장, 모두 아래 = 하락장, 그 외 횡보장
  const reg = names => { const xs = (v.indices || []).filter(x => names.includes(x.name) && x.above50 != null && x.above200 != null); if (!xs.length) return null;
    const up = xs.filter(x => x.above50 === true && x.above200 === true).length, dn = xs.filter(x => x.above50 === false && x.above200 === false).length;
    return up === xs.length ? "상승장" : dn === xs.length ? "하락장" : "횡보장"; };
  v.regime_us = reg(["나스닥", "S&P500"]); v.regime_kr = reg(["코스피", "코스닥"]);
  v.regime = v.regime_us || v.regime_kr;
  store.set("aic-market3", { t: Date.now(), v });
  return v;
}
const isKR = F => /KRW|원/.test(F?.currency || "") || /KRX|KOSPI|KOSDAQ|코스피|코스닥/i.test(F?.market || "");
const regimeFor = (F, M) => M ? (isKR(F) ? (M.regime_kr || M.regime) : (M.regime_us || M.regime)) : null;
const STRAT = { "상승장": ["정상 매매", "최대 4종목 · 돌파와 눌림목 모두"], "횡보장": ["비중 절반", "최대 2종목 · 눌림목 위주, 돌파 추격 자제"], "하락장": ["신규 매수 중지", "현금 확보 · 보유 종목은 손절 기준 엄수"] };
const vixTag = v => v == null ? "—" : v < 20 ? "안정" : v < 25 ? "주의" : v < 30 ? "경계" : "공포";

// ── 이번 주 주요 일정 (하루 1회 검색, 캐시) ─────────────────
function kstNow() { return new Date(Date.now() + 9 * 3600e3); } // UTC 기준 필드로 KST 날짜를 다룸
const ymd = d => d.toISOString().slice(0, 10);
function weekRange() {
  const n = kstNow(), dow = n.getUTCDay();             // 0=일
  const mon = new Date(n); mon.setUTCDate(n.getUTCDate() - ((dow + 6) % 7) + (dow === 6 || dow === 0 ? 7 : 0)); // 주말이면 다음 주
  const days = [...Array(5)].map((_, i) => { const d = new Date(mon); d.setUTCDate(mon.getUTCDate() + i); return ymd(d); });
  return { from: days[0], to: days[4], days };
}
async function getWeekly() {
  const wr = weekRange(), c = store.get("aic-week2", null);
  if (c && c.from === wr.from && Date.now() - c.t < 24 * 3600e3) return c.v;
  const r = await gemini(`${wr.from}(월)부터 ${wr.to}(금)까지 한 주의 주식시장 주요 일정을 구글 검색(인베스팅닷컴 경제 캘린더, 연준·한국은행 일정, 실적 발표 캘린더 등)으로 찾아라.
포함: 미국 FOMC·연준 의장 발언·CPI·PCE·고용보고서·GDP·소매판매·ISM, 한국 금통위·수출입·옵션만기, 중국·일본 중앙은행 등 시장에 큰 영향을 주는 것, 그리고 시가총액 상위 주요 기업 실적 발표(미국·한국).
시간은 한국시간(KST) 기준 HH:MM, 모르면 빈 문자열. 하루 최대 8개. 휴장일이면 그것도 적어라.
stars는 주식시장 영향력 1~3:
 3 = FOMC 금리 결정·연준 의장 기자회견, 미국 CPI, 미국 고용보고서(비농업), 한국 금통위 금리 결정, 엔비디아·애플급 초대형 실적, 미국 증시 휴장
 2 = PCE, GDP, ISM, 소매판매, PPI, FOMC 의사록, 연준 위원 발언, 주요 대형주 실적, 옵션만기, BOJ·ECB 결정
 1 = 그 외 참고할 지표·실적
설명 없이 JSON 하나만:
{"days":[{"date":"YYYY-MM-DD","events":[{"time":"HH:MM","country":"미국|한국|중국|일본|유럽","title":"일정 이름(20자 이내)","stars":1|2|3,"note":"예상치나 의미(20자 이내)"}]}]}`, { search: true, label: "이번 주 일정" });
  const v = { ...wr, days: r.data.days || [], sources: r.sources };
  store.set("aic-week2", { from: wr.from, t: Date.now(), v });
  return v;
}
function renderWeek() {
  const W = R.W || store.get("aic-week2", null)?.v;
  const el = $("week");
  if (!W || !W.days) { el.style.display = "none"; return; }
  const today = ymd(kstNow()), dn = ["일", "월", "화", "수", "목", "금", "토"];
  const ed = R.S?.F?.next_earnings_date, myName = R.S?.F?.name;
  const byDate = Object.fromEntries((W.days || []).map(d => [d.date, d.events || []]));
  el.style.display = "block";
  el.innerHTML = `<div class="wh2">이번 주 일정 <span>${W.from.slice(5).replace("-", ".")}~${W.to.slice(5).replace("-", ".")} · 한국시간</span></div>
    ${weekDays(W).map(date => {
      const d = new Date(date + "T00:00:00Z"), ev = [...(byDate[date] || [])].map(e => ({ ...e, st: clamp(Math.round(num(e.stars) ?? (e.imp === "상" ? 3 : e.imp === "중" ? 2 : 1)), 1, 3) }))
        .sort((a, b) => b.st - a.st || (a.time || "99").localeCompare(b.time || "99"));
      if (ed === date && myName) ev.unshift({ time: "", country: "", title: `${myName} 실적 발표`, st: 3, mine: true, note: "검색한 종목" });
      const cls = date === today ? "today" : date < today ? "past" : "";
      return `<div class="wd ${cls}"><div class="wdl">${d.getUTCMonth() + 1}/${d.getUTCDate()}<small>${dn[d.getUTCDay()]}${date === today ? " · 오늘" : ""}</small></div>
        <div class="wev">${ev.length ? ev.map(e => `<div class="we s${e.st} ${e.mine ? "mine" : ""}"><span class="stars">${"★".repeat(e.st)}<i>${"★".repeat(3 - e.st)}</i></span><span class="wt">${esc(e.time || "")}</span><span><b>${esc(e.title)}</b>${e.country ? ` <small>${esc(e.country)}</small>` : ""}${e.note ? `<br><small>${esc(e.note)}</small>` : ""}</span></div>`).join("") : `<div class="we none">주요 일정 없음</div>`}</div></div>`;
    }).join("")}
    <div class="wfoot">★ 시장 영향력 (최대 3개) · 영향 큰 순 · 노랑: 내 종목 실적</div>`;
}
function weekDays(W) { return W.from ? [...Array(5)].map((_, i) => { const d = new Date(W.from + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + i); return ymd(d); }) : []; }

// ── 2. 종목 데이터 수집 ───────────────────────────────────
const FUND = `{"name":"회사명","ticker":"티커","market":"거래소","currency":"USD|KRW","sector":"섹터","price":숫자,"change_pct":숫자,"as_of":"가격 기준일","market_cap":"시총(단위 포함)","per":숫자,"fwd_per":숫자,"per_hist_avg":숫자,"pbr":숫자,"roe_pct":숫자,"roic_pct":숫자,"op_margin_pct":숫자,"debt_to_equity_pct":숫자,"net_debt":"순부채(음수면 순현금, 단위 포함)","current_ratio":숫자,"fcf":"최근 연간 FCF(단위 포함)","fcf_trend":"증가|감소|흑자 유지|적자","revenue_growth_pct":숫자,"eps_growth_pct":숫자,"eps_growth_next_pct":숫자,"peg":숫자,"eps":숫자,"bps":숫자,"guidance":"최근 가이던스·컨센서스 변화 한 줄","next_earnings_date":"YYYY-MM-DD","business":"사업 한 줄","news":["최근 뉴스1","2","3"],"corporate_actions":"증자·M&A·소송·상폐 위험 한 줄(없으면 '특이사항 없음')","is_leveraged_etf":true|false}`;
const TECH = `{"ema10":숫자,"ema20":숫자,"ema50":숫자,"ema200":숫자,"adx14":숫자,"cci20":숫자,"cci20_prev":"3거래일 전 CCI(20) 숫자","volume_recent":"최근 거래일 거래량 숫자(주)","avg_volume_20":"20일 평균 거래량 숫자(주)","overhead_poc":"현재가 위쪽에서 가장 거래가 많이 쌓인 매물대 가격(최근 6개월, 없으면 null)","ma50":숫자,"high_52w":숫자,"low_52w":숫자,"rsi14":숫자,"atr14":숫자,"support":숫자,"resistance":숫자,"swing_low":숫자,"volume_trend":"최근 거래량 흐름 한 줄","return_1m_pct":숫자,"return_3m_pct":숫자,"index_return_3m_pct":숫자,"sector_strength":"섹터 상대강도 한 줄","flow":"기관·외국인·정치인 공시·옵션 등 수급 한 줄","pattern":"돌파|눌림목|박스권|추세 이탈|과열 중 하나와 설명"}`;
const KEYF = ["price", "per", "pbr", "roe_pct", "revenue_growth_pct", "eps_growth_pct", "peg", "eps", "bps", "next_earnings_date"];
const KEYT = ["ema10", "ema20", "ema50", "ema200", "cci20", "cci20_prev", "adx14", "atr14", "support", "avg_volume_20", "return_3m_pct", "return_1m_pct"];
const isEmpty = v => v === null || v === undefined || v === "" || v === "null";

async function getComputedTech(F) {
  const base = String(cfg.worker || "").trim().replace(/\/+$/, ""); if (!base || !F?.ticker) return null;
  const code = String(F.ticker).replace(/^(KRX|KOSDAQ|KOSPI|NASDAQ|NYSE|AMEX):/i, "").replace(/\.(KS|KQ)$/i, "").trim();
  const kr = isKR(F) || /^\d{4}[0-9A-Z]{2}$/i.test(code);
  try {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(`${base}/?s=${encodeURIComponent(code)}${kr ? "&m=kr" : ""}`, { signal: ctl.signal }); clearTimeout(to);
    const j = await r.json(); return j && j.computed ? j : null;
  } catch (e) { return null; }
}
async function getStock(tk) {
  const src = `한국 종목은 네이버 금융·FnGuide·한국거래소, 미국 종목은 Yahoo Finance·stockanalysis.com·finviz·회사 IR 참고.`;
  const f = await gemini(`오늘은 ${today()}. 종목 "${tk}"의 최신 펀더멘털을 구글 검색으로 찾아라. ${src}
가격은 최근 종가, 재무는 최근 4분기(TTM) 기준. 퍼센트는 숫자만. 찾은 값만 넣고 못 찾으면 null.
설명 없이 JSON 하나만:
${FUND}`, { search: true, label: "펀더멘털 수집" });
  setStatus("2/5 · 차트 지표 계산 중…");
  let t = { data: {}, sources: [] };
  const CT = await getComputedTech(f.data);
  if (CT) {
    t = { data: { ...CT, pattern: null }, sources: [], computed: true };
    // 가격도 계산 서버의 최근 종가로 맞춤 (AI 검색 가격보다 정확)
    f.data.price = CT.price; f.data.change_pct = CT.change_pct; f.data.as_of = CT.date + " 종가";
  } else try {
  t = await gemini(`오늘은 ${today()}. 종목 "${f.data.name || tk}"(${f.data.ticker || ""})의 기술적 지표를 구글 검색으로 찾아라. ${src}
이동평균은 일봉 종가 기준 EMA(지수이동평균), CCI는 20일, ATR은 14일, 지지·저항은 최근 3개월 일봉 기준 가장 가까운 가격대, index_return_3m_pct는 해당 시장 대표 지수(미국 S&P500, 한국 코스피)의 3개월 수익률.
찾은 값만 넣고 못 찾으면 null. 설명 없이 JSON 하나만:
${TECH}`, { search: true, label: "기술적 지표 수집" });
  } catch (e) { if (/한도를 다 썼/.test(e.message) || e.status === 401 || e.status === 403) throw e; }
  const F = f.data, T = t.data, sources = [...f.sources, ...t.sources];
  T._src = t.computed ? `일봉으로 직접 계산 · ${CT.source} · ${CT.date}` : (cfg.worker ? "계산 서버 연결 실패 → AI 검색값(부정확할 수 있음)" : "AI 검색값(부정확할 수 있음)");
  const miss = [...KEYF.filter(k => isEmpty(F[k])), ...KEYT.filter(k => isEmpty(T[k]))];
  if (miss.length >= 4) {
    setStatus(`2/5 · 빠진 지표 ${miss.length}개 추가 검색 중…`);
    try {
      const r = await gemini(`종목 "${F.name || tk}"(${F.ticker || ""})의 다음 값만 구글 검색으로 찾아라: ${miss.join(", ")}.
다른 값으로 계산 가능하면 계산해서 채워라(PER=주가/EPS, PBR=주가/BPS, PEG=PER/EPS성장률). 퍼센트는 숫자만. 설명 없이 {"키":값} JSON 하나만, 못 찾으면 null.`, { search: true, label: "추가 검색" });
      for (const k of miss) if (!isEmpty(r.data[k])) (KEYF.includes(k) ? F : T)[k] = r.data[k];
      sources.push(...r.sources);
    } catch (e) {}
  }
  // 코드 보완 계산
  if (isEmpty(F.peg) && num(F.per) && num(F.eps_growth_pct) > 0) F.peg = +(num(F.per) / num(F.eps_growth_pct)).toFixed(2);
  return { F, T, sources };
}

// ── 3. 매매 계획 (코드 계산) ───────────────────────────────
function makePlan(F, T) {
  const entry = num(F.price);
  if (!entry) return null;
  let atr = num(T.atr14), atrEst = false;
  if (!atr) { const h = num(T.high_52w), l = num(T.low_52w); atr = (h && l) ? (h - l) / 16 : entry * 0.03; atrEst = true; }
  const atrStop = entry - 2 * atr;
  const base = [num(T.support), num(T.swing_low)].filter(v => v && v < entry).sort((a, b) => b - a)[0];
  const supStop = base ? base - 0.5 * atr : null;
  // 지지선 손절이 ATR 손절보다 가깝고(손실 작고) 진입가 아래면 지지선 방식 채택, 아니면 2ATR
  const useSup = supStop != null && supStop > atrStop && supStop < entry;
  const lev = F.is_leveraged_etf === true || /3x|2x|레버리지|leveraged|ultra|bull|bear/i.test(String(F.name || ""));
  const stop = lev ? entry * 0.93 : (useSup ? supStop : atrStop);
  const risk = entry - stop;
  const poc = num(T.overhead_poc);
  const levels = [num(T.resistance), poc, num(T.high_52w)].filter(v => v && v > entry).sort((a, b) => a - b);
  // 현재가에서 ATR 1개 이내의 저항은 목표가 아니라 '돌파해야 할 벽' → 그 위 다음 저항(없으면 2R)을 목표로
  const near = levels.filter(v => v - entry < atr);
  const breakout = near.length ? Math.max(...near) : null;
  const res = levels.find(v => v - entry >= atr && (!breakout || v > breakout + 0.5 * atr)) ?? null;
  const target = res;
  const rr = target ? (target - entry) / risk : null;
  const target2R = entry + 2 * risk;
  const riskPct = risk / entry;
  const acct = clamp(num($("riskPct").value) ?? num(cfg.riskPct) ?? 1, 0.1, 5);
  const cap = clamp(num($("maxPos").value) ?? num(cfg.maxPos) ?? 30, 5, 100);
  const size = clamp(acct / 100 / riskPct * 100, 0, cap);
  return { entry, atr, atrEst, atrPct: atr / entry, atrStop, supStop, useSup, stop, riskPct, target, rr, target2R, size, acct, cap, base, lev, breakout, exitEma: num(T.ema20) };
}

// ── 4. 위원 분석 ──────────────────────────────────────────
function userCtx() {
  return "";
}
const checkSpec = a => a.checks.map(c => `  - ${c.id}: ${c.t}`).join("\n");
const AGENT_OUT = a => `{"checks":{${a.checks.map(c => `"${c.id}":{"r":"pass|fail|unknown","n":"근거 15자 이내"}`).join(",")}},"headline":"결론 한 문장 30자 이내","pros":["찬성 근거 25자 이내","찬성2"],"cons":["반대 근거 25자 이내","반대2"]${a.id === "ptj" ? ',"veto":true|false,"veto_reason":"거부 사유 한 줄 또는 빈 문자열"' : ""}}`;
const RULES = `규칙:
- 각 항목을 데이터에 대입해 pass(충족)/fail(미충족)/unknown(자료 부족)으로 판정. 추측으로 pass 주지 말 것.
- 스윙 투자(수일~수개월) 관점의 위원회임을 감안하되, 자기 철학의 기준은 엄격히 지킬 것.
- 찬성·반대 근거는 각 2개, 짧은 구절, 수치 포함. "자료 없음"은 근거에 쓰지 말 것.
- 결론이 반대여도 찬성 근거를, 찬성이어도 반대 근거를 반드시 쓸 것.`;
function ctxBlock(tk, S, M, P) {
  return `종목: ${tk}
펀더멘털: ${JSON.stringify(S.F)}
기술적 지표: ${JSON.stringify(S.T)}
시장 국면: ${JSON.stringify({ ...M, sources: undefined })}
코드가 계산한 매매 계획: ${P ? JSON.stringify({ 진입: r2(P.entry), 손절: r2(P.stop), 손절폭_pct: r2(P.riskPct * 100), 목표_저항선: r2(P.target), 손익비: r2(P.rr), ATR_pct: r2(P.atrPct * 100), 돌파_대기_저항: r2(P.breakout) }) : "계산 불가"}
${userCtx()}`;
}
const r2 = v => v == null ? null : Math.round(v * 100) / 100;

async function analyzeFull(tk, S, M, P, onEach) {
  const out = {};
  for (let i = 0; i < AG.length; i++) {
    const a = AG[i]; onEach(a.id, "run", i);
    try {
      out[a.id] = (await gemini(`너는 AI 투자위원회 위원이며 "${a.n}"의 공개된 투자 철학을 따르는 분석 역할이다(실제 인물 아님). 한국어.
역할: ${a.role}. 핵심 질문: ${a.q}
철학: ${a.p}
${ctxBlock(tk, S, M, P)}

채점 항목:
${checkSpec(a)}
${RULES}
JSON 하나만 출력:
${AGENT_OUT(a)}`, { label: a.n })).data;
      onEach(a.id, "done", i, out[a.id]);
    } catch (e) { onEach(a.id, "fail", i); if (e.status === 401 || e.status === 403 || /한도를 다 썼/.test(e.message)) throw e; }
  }
  return out;
}
async function analyzeEco(tk, S, M, P, onEach) {
  AG.forEach((a, i) => onEach(a.id, "run", i));
  const spec = AG.map(a => `## ${a.id} — ${a.n} (${a.role})
핵심 질문: ${a.q}
철학: ${a.p}
채점 항목:
${checkSpec(a)}
출력 형식: ${AGENT_OUT(a)}`).join("\n\n");
  const r = (await gemini(`너는 AI 투자위원회의 7명 위원 역할을 각각 독립적으로 수행한다. 각 위원은 공개된 투자 철학을 따르는 분석 역할이며 실제 인물이 아니다. 한국어.
위원끼리 의견을 맞추지 말고, 각자 자기 기준으로만 판단하라. 서로 결론이 갈려도 된다.
${ctxBlock(tk, S, M, P)}

${spec}

${RULES}
JSON 하나만 출력: {"agents":{${AG.map(a => `"${a.id}":{...}`).join(",")}}}`, { label: "7인 위원 분석" })).data;
  const out = r.agents || r;
  AG.forEach((a, i) => onEach(a.id, out[a.id] ? "done" : "fail", i, out[a.id]));
  return out;
}

// ── 점수 계산 (코드) ───────────────────────────────────────
function scoreAgent(a, res, S, M, P) {
  let got = 0, known = 0, total = 0;
  const items = a.checks.map(c => {
    total += c.pts;
    let r = res?.checks?.[c.id]?.r || "unknown", n = res?.checks?.[c.id]?.n || "", by = "AI";
    if (c.rule) { const v = c.rule(S.F, S.T, M, P); if (v === true || v === false) { r = v ? "pass" : "fail"; by = "코드"; } }
    if (r !== "unknown") known += c.pts;
    if (r === "pass") got += c.pts;
    return { ...c, r, n, by };
  });
  const raw = known ? got / known * 100 : 50, cov = known / total;
  let score = Math.round(50 + (raw - 50) * cov); // 자료가 적을수록 50점으로 수렴
  const gateFail = a.gate && items[0].r === "fail";
  if (gateFail) score = Math.min(score, 40); // 추세 게이트 탈락이면 최대 40점
  const sig = score >= 65 ? "bullish" : score < 45 ? "bearish" : "neutral";
  return { score, cov, items, sig, gateFail };
}
function finalVerdict(scores, S, M, P, ptjRes) {
  let total = 0; for (const a of AG) total += (scores[a.id]?.score ?? 50) * a.w / 100;
  total = Math.round(total);
  const veto = [];
  if (P?.rr != null && P.rr < 1.5) veto.push(`손익비 ${P.rr.toFixed(2)}:1로 1.5 미만`);
  const d = daysTo(S.F.next_earnings_date); if (d != null && d >= 0 && d <= 3) veto.push(`실적 발표 ${d}일 전 · 갭 위험`);
  const bear = regimeFor(S.F, M) === "하락장"; // 하락장은 상한 79점(관심까지만): 매수 검토는 막고 강한 종목은 관심으로 남김
  if (num(M?.vix) > 30) veto.push(`VIX ${num(M.vix)} · 시장 급락 위험`);
  if (ptjRes?.veto && ptjRes.veto_reason) veto.push(ptjRes.veto_reason);
  let capped = veto.length ? Math.min(total, 64) : total;
  if (bear) capped = Math.min(capped, 79);
  const market = bear ? `${isKR(S.F) ? "한국" : "미국"} 시장 하락장 · 신규 매수 중지` : null;
  const warn = [];
  for (const a of AG) if (a.warnOnly && scores[a.id] && scores[a.id].score < 45) warn.push(`${a.n.split(" ").pop()} 경고 · ${R.agents?.[a.id]?.cons?.[0] || "큰 손실 위험 요인 있음"}`);
  const band = capped >= 80 ? ["매수 검토", "buy"] : capped >= 65 ? [bear ? "관심 · 시장 회복 대기" : "관심 종목", "watch"] : ["매수 제외", "out"];
  return { raw: total, score: capped, veto, band, warn, market };
}

// ── 렌더링: 결론 카드 → 위원 7줄 → 접힌 상세 ───────────────
const SIG = { bullish: ["찬성", "p-buy"], bearish: ["반대", "p-sell"], neutral: ["유보", "p-neu"] };
const fmt = (v, s = "") => v === null || v === undefined || v === "" ? "—" : (typeof v === "number" ? v.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : v) + s;
const pct = v => (v * 100).toFixed(1) + "%";
let R = {};

function renderHero() {
  const S = R.S, P = R.P, V = R.verdict, M = R.M, D = R.D;
  if (!S) { $("hero").style.display = "none"; return; }
  const F = S.F, up = num(F.change_pct) >= 0;
  const col = !V ? "#a9b8b2" : V.band[1] === "buy" ? "#1d9a64" : V.band[1] === "watch" ? "#d99a00" : "#d9472f";
  $("hero").style.display = "block";
  $("hero").innerHTML = `<div class="hh"><b>${esc(F.name || R.tk)} <span style="font-size:13px;color:#5b6b66">${esc(F.ticker || "")}</span></b>
      <span class="px">${esc(fmt(num(F.price)))} ${esc(F.currency || "")} <span style="color:${up ? "#1d9a64" : "#d9472f"};font-size:15px">${F.change_pct == null ? "" : (up ? "+" : "") + esc(fmt(num(F.change_pct), "%"))}</span></span></div>
    <div class="hs" style="--c:${col};--v:${V ? V.score : 0}">
      <div class="ring"><span>${V ? V.score : "…"}</span></div>
      <div><div class="band2">${V ? V.band[0] : "심사 중"}</div>
        <div class="vd">${D ? esc(D.verdict) : V ? "80점 이상 매수 검토 · 65~79 관심 · 65 미만 제외" : "위원들이 채점하고 있어요"}</div>
        ${V?.veto.length ? `<div class="veto">리스크 거부권 · ${esc(V.veto.join(" / "))}</div>` : ""}
        ${P?.breakout ? `<div class="veto" style="background:#fff4d6;color:#7a5200">돌파 대기 · 바로 위 저항 ${fmt(r2(P.breakout))}(+${pct((P.breakout - P.entry) / P.entry)})을 종가로 넘으면 재검토</div>` : ""}
        ${V?.market ? `<div class="veto" style="background:#eef2f0;color:#33433e">${esc(V.market)} · 최대 79점(관심)까지${V.raw !== V.score ? ` · 시장 반영 전 ${V.raw}점` : ""}</div>` : ""}
        ${V?.warn?.length ? `<div class="veto" style="background:#fff4d6;color:#7a5200">${esc(V.warn.join(" / "))}</div>` : ""}</div></div>
    ${P ? `<div class="pg"><div>진입<span>${fmt(r2(P.entry))}</span></div><div>손절<span>${fmt(r2(P.stop))}</span><em style="font-style:normal;font-size:12px;color:#d9472f">-${pct(P.riskPct)}</em></div>
      <div>목표${P.target ? "" : " (2R)"}<span>${fmt(r2(P.target ?? P.target2R))}</span><em style="font-style:normal;font-size:12px;color:#1d9a64">+${pct(((P.target ?? P.target2R) - P.entry) / P.entry)}</em></div>
      <div>손익비<span style="color:${P.rr == null ? "inherit" : P.rr >= 2 ? "#1d9a64" : "#d9472f"}">${P.rr == null ? "2.0R" : P.rr.toFixed(1) + " : 1"}</span></div>
      <div>권장 비중<span>${P.size.toFixed(1)}%</span></div></div>` : ""}
    ${P ? `<div class="mline" style="color:#0f1a17"><b>청산 규칙</b> · ${P.lev ? `레버리지 ETF: -7% 손절, 최대 2주 보유` : `${fmt(r2(P.target2R))}(2R)에서 절반 익절 · 나머지는 EMA20${P.exitEma ? "(" + fmt(r2(P.exitEma)) + ")" : ""} 종가 이탈 시 청산`}</div>` : ""}
    ${F.next_earnings_date ? `<div class="mline">다음 실적 발표 ${esc(F.next_earnings_date)}</div>` : ""}`;
}

function agentRow(a) {
  const res = R.agents?.[a.id], sc = R.scores?.[a.id], st = R.state?.[a.id];
  const s = sc ? SIG[sc.sig] : null;
  const marks = { pass: ["p", "○"], fail: ["f", "×"], unknown: ["u", "?"] };
  const line = res?.headline ? esc(res.headline) : st === "run" ? '<span class="dots"></span>' : st === "fail" ? "분석 실패 · 50점 처리" : `<span style="opacity:.6">${a.q}</span>`;
  return `<details class="ag"><summary>
      <div class="av"><img src="img/${a.id}.png" alt="${a.n}" width="52" height="52" loading="lazy"></div>
      <div><div class="an">${a.n}<small>${a.role}${a.warnOnly ? "" : " " + a.w + "%"}</small></div><div class="al">${line}</div>${res?.pros?.[0] ? `<div class="ln p"><i>찬</i>${esc(res.pros[0])}</div>` : ""}${res?.cons?.[0] ? `<div class="ln c"><i>반</i>${esc(res.cons[0])}</div>` : ""}</div>
      <div class="ar">${sc && res ? `<span class="pill ${s[1]}">${s[0]}</span><b>${sc.score}</b>` : ""}</div>
    </summary>
    ${res && sc ? `<div class="ab">
      ${res.pros?.[1] ? `<div class="ln p"><i>찬</i>${esc(res.pros[1])}</div>` : ""}${res.cons?.[1] ? `<div class="ln c"><i>반</i>${esc(res.cons[1])}</div>` : ""}
      <div class="more" style="margin-top:8px"><div style="font-weight:700;margin-bottom:2px">채점표 · 자료 충족 ${Math.round(sc.cov * 100)}%</div>
        ${sc.items.map(c => `<div class="ck"><span class="m ${marks[c.r][0]}">${marks[c.r][1]}</span><span>${esc(c.t)}${c.n ? ` · <span style="opacity:.75">${esc(c.n)}</span>` : ""}</span><em>${c.pts}점·${c.by}</em></div>`).join("")}
      </div></div>` : ""}
  </details>`;
}
const paint = () => {
  if (!R.state || !Object.keys(R.state).length) { $("board").style.display = "none"; return; }
  $("board").style.display = "block";
  const open = [...document.querySelectorAll("details.ag")].map(d => d.open);
  $("rows").innerHTML = AG.map(agentRow).join("");
  document.querySelectorAll("details.ag").forEach((d, i) => { if (open[i]) d.open = true; });
};

function renderExtra() {
  const S = R.S, P = R.P, D = R.D, M = R.M, V = R.verdict;
  if (!S) { $("extra").innerHTML = ""; return; }
  const F = S.F, T = S.T, f = v => v == null ? "—" : v.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  const sec = [];
  if (D) sec.push(["찬반 토론", `<div class="case pro"><h4>상승 논리의 약점</h4>${esc(D.bull_rebuttal)}</div><div class="case con"><h4>하락 시나리오</h4>${esc(D.bear_scenario)}</div>
    <dl class="kv"><dt>매수 실행 조건</dt><dd>${esc(D.entry_trigger)}</dd><dt>계획 폐기 조건</dt><dd>${esc(D.invalidation)}</dd><dt>확인할 일정</dt><dd>${esc(D.watch)}</dd></dl>`]);
  if (V) sec.push(["점수 계산", `<table><tbody>${AG.map(a => { const sc = R.scores[a.id]?.score ?? 50; return a.warnOnly ? `<tr><td>${a.n}</td><td class="r">${sc}점 · 경고 전용</td><td class="r">—</td></tr>` : `<tr><td>${a.n}</td><td class="r">${sc}점 × ${a.w}%</td><td class="r">${(sc * a.w / 100).toFixed(1)}</td></tr>`; }).join("")}
    <tr class="pick"><td>합계</td><td></td><td class="r">${V.raw}${V.raw !== V.score ? ` → ${V.score} (${V.veto.length ? "거부권" : "하락장 상한"})` : ""}</td></tr></tbody></table>`]);
  if (P) sec.push(["손절 방식 비교", `<table><tbody>
    <tr class="${P.useSup ? "" : "pick"}"><td>2 ATR${P.atrEst ? " (추정)" : ""}</td><td class="r">${f(P.atrStop)}</td><td class="r">-${pct((P.entry - P.atrStop) / P.entry)}</td></tr>
    <tr class="${P.useSup ? "pick" : ""}"><td>지지선${P.base ? " " + f(P.base) : ""} − 0.5 ATR</td><td class="r">${f(P.supStop)}</td><td class="r">${P.supStop ? "-" + pct((P.entry - P.supStop) / P.entry) : "—"}</td></tr></tbody></table>
    <p class="tag">더 가까운 쪽(손실이 작은 쪽)을 씁니다. 권장 비중 = 허용 손실 ${P.acct}% ÷ 손절폭, 종목당 최대 ${P.cap ?? 25}%. 집중 투자는 갭 하락 시 손절가보다 더 잃을 수 있어요. 저항선이 없으면 목표는 손절폭의 2배(2R)입니다. 현재가에서 ATR 1개 이내의 저항은 목표가 아니라 돌파해야 할 벽으로 보고, 그 위 다음 저항을 목표로 씁니다.</p>`]);
  const items = [["PER", fmt(num(F.per), "배")], ["PEG", fmt(num(F.peg))], ["ROE", fmt(num(F.roe_pct), "%")], ["매출 성장", fmt(num(F.revenue_growth_pct), "%")], ["EPS 성장", fmt(num(F.eps_growth_pct), "%")],
    ["EMA 10/20", `${fmt(num(T.ema10))} / ${fmt(num(T.ema20))}`], ["EMA 50/200", `${fmt(num(T.ema50))} / ${fmt(num(T.ema200))}`], ["CCI(20)", fmt(num(T.cci20))], ["ADX(14)", fmt(num(T.adx14))], ["거래량/20일 평균", (num(T.volume_recent) && num(T.avg_volume_20)) ? (num(T.volume_recent) / num(T.avg_volume_20)).toFixed(2) + "배" : "—"], ["위쪽 매물대", fmt(num(T.overhead_poc))], ["ATR", fmt(num(T.atr14))], ["3개월 수익률", fmt(num(T.return_3m_pct), "%")], ["지수 3개월", fmt(num(T.index_return_3m_pct), "%")]];
  sec.push(["종목 데이터 · 출처", `<p class="tag" style="margin:0 0 6px">차트 지표: ${esc(T._src || "AI 검색값")}</p><dl class="kv">${items.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    <ul class="w">${(F.news || []).slice(0, 3).map(n => `<li>${esc(n)}</li>`).join("")}</ul>
    
    ${S.sources?.length ? `<p class="tag" style="overflow-wrap:anywhere">${S.sources.slice(0, 8).map(x => `<a href="${esc(x.uri)}" target="_blank" rel="noopener">${esc(x.title || "링크")}</a>`).join(" · ")}</p>` : ""}`]);
  $("extra").innerHTML = `<div class="xs">${sec.map(([t, b]) => `<details class="x"><summary>${t}</summary><div class="in">${b}</div></details>`).join("")}</div>`;
}

document.addEventListener("click", async e => {
  if (e.target.id !== "newsRefresh" || busy) return;
  if (!cfg.key) { showErr("먼저 설정에서 Gemini API 키를 저장해 주세요."); return; }
  busy = true; e.target.disabled = true; e.target.textContent = "분석 중…";
  try { window.__forceNews = true; R.M = await getMarket(); renderMarketCard(); } catch (er) { showErr("뉴스 분석 오류: " + er.message); }
  finally { busy = false; }
});
function renderMarketCard() {
  const M = R.M || store.get("aic-market3", null)?.v, el = $("mkt");
  if (!M || !M.indices) { el.style.display = "none"; return; }
  const F = R.S?.F, focus = F ? (isKR(F) ? "kr" : "us") : null;
  const badge = g => `<span class="rg ${g === "상승장" ? "up" : g === "하락장" ? "dn" : "side"}">${esc(g || "—")}</span>`;
  const o = v => v === true ? '<span class="ok">위</span>' : v === false ? '<span class="no">아래</span>' : '<span style="opacity:.6">확인 불가</span>';
  const mk = (key, label, g, names) => { const st = STRAT[g] || ["—", ""];
    return `<div class="mcol ${focus === key ? "focus" : ""}"><div class="mt">${label} ${badge(g)}${focus === key ? '<small>내 종목 시장</small>' : ""}</div>
      <div class="ms"><b>${st[0]}</b> · ${st[1]}</div>
      <table class="mi"><tbody>${(M.indices || []).filter(x => names.includes(x.name)).map(x => `<tr><td>${esc(x.name)}${x.close != null ? `<br><small style="opacity:.75">${esc(fmt(num(x.close)))}</small>` : ""}</td><td>50일선 ${o(x.above50)}</td><td>200일선 ${o(x.above200)}${x.gap200 != null ? `<br><small style="opacity:.75">${x.gap200 >= 0 ? "+" : ""}${x.gap200.toFixed(1)}%</small>` : ""}</td><td class="r ${num(x.chg_1w_pct) >= 0 ? "ok" : "no"}">${x.chg_1w_pct == null ? "—" : (num(x.chg_1w_pct) >= 0 ? "+" : "") + num(x.chg_1w_pct).toFixed(1) + "%"}</td></tr>`).join("")}</tbody></table>
      <div class="sec">주도 ${esc(((key === "us" ? M.leading_us : M.leading_kr) || []).slice(0, 3).join(" · ") || "—")}</div>${sumLine(key)}${evBlock(key, true)}${newsBlock(key)}${evBlock(key)}</div>`; };
  function sumLine(key) {
    const it = M.tally?.[key]?.lean, st = M.tally_short?.[key]?.lean, nt = M.ntally?.[key]?.lean; if (!it && !st) return "";
    const c = o => o.includes("상승") ? "ok" : o.includes("하락") ? "no" : "";
    const tr = it ? (it.includes("상승") ? "상승 추세" : it.includes("하락") ? "하락 추세" : "방향 탐색") : "—";
    const sh = overall(st, nt), shTxt = sh.includes("상승") ? sh.replace("상승 우세", "반등·상승 우세") : sh;
    return `<div class="ovl two"><span>1~3개월</span><b class="${c(tr)}">${esc(tr)}</b><small>추세 지표 ${esc(it || "—")}</small>
      <span>1~2주</span><b class="${c(sh)}">${esc(shTxt)}</b><small>단기 지표 ${esc(st || "—")} · 뉴스 ${esc(nt || "아직 없음")}</small></div>`;
  }
  function newsBlock(key) {
    const N = (M.news || []).filter(n => n.market === key), O = M.outlook?.[key];
    if (!N.length) return "";
    const row = n => `<div class="evr"><span class="${n.side === "up" ? "ok" : "no"}">${n.side === "up" ? "▲" : "▼"}</span><span>${esc(n.title)} <small class="imp">${"●".repeat(Math.max(1, Math.min(3, Number(n.impact) || 1)))}</small><small>${esc(n.why)}</small><small>${esc(n.date || "")} · ${esc(n.source || "")} · ${esc(n.kind || "")}${n.priced ? " · " + esc(n.priced) : ""}</small></span></div>`;
    const ups = N.filter(n => n.side === "up").sort((a, b) => b.impact - a.impact), dns = N.filter(n => n.side === "down").sort((a, b) => b.impact - a.impact);
    return `<div class="evb"><div class="evt"><b class="${M.ntally?.[key]?.lean?.includes("상승") ? "ok" : M.ntally?.[key]?.lean?.includes("하락") ? "no" : ""}">뉴스 · ${esc(M.ntally?.[key]?.lean || "혼조")}</b><span></span><small>${O ? esc(O.reason) : ""}</small></div>
      ${dns.slice(0, 2).map(row).join("")}${ups.slice(0, 2).map(row).join("")}
      ${N.length > 4 ? `<details class="evd"><summary>뉴스 ${N.length}건 전부 보기</summary>${[...dns.slice(2), ...ups.slice(2)].map(row).join("")}</details>` : ""}
      ${O?.watch ? `<div class="turn"><b>앞으로 볼 것</b><div>· ${esc(O.watch)}</div></div>` : ""}</div>`;
  }
  const ic = { up: ["▲", "ok"], down: ["▼", "no"], flat: ["–", "nf"] };
  const evRow = e => `<div class="evr"><span class="${ic[e.signal]?.[1] || "nf"}">${ic[e.signal]?.[0] || "–"}</span><span>${esc(e.label)} <b>${esc(e.value)}</b><small>${esc(e.note)}</small></span></div>`;
  function evBlock(key, short) {
    const E = (short ? M.short : M.evidence)?.[key], T = (short ? M.tally_short : M.tally)?.[key]; if (!E?.length || !T) return "";
    const lead = T.lean.includes("하락") ? "down" : T.lean.includes("상승") ? "up" : null;
    let key3 = lead ? E.filter(e => e.signal === lead) : E.filter(e => e.signal !== "flat");
    if (!key3.length) key3 = E; key3 = key3.slice(0, 3);
    return `<div class="evb"><div class="evt"><b class="${lead === "up" ? "ok" : lead === "down" ? "no" : ""}">${short ? "단기 1~2주" : "추세 1~3개월"} · ${esc(T.lean)}</b>
        <span class="evbar"><i class="u" style="flex:${T.up}"></i><i class="f" style="flex:${T.flat}"></i><i class="d" style="flex:${T.down}"></i></span>
        <small>상승 ${T.up} · 중립 ${T.flat} · 하락 ${T.down}</small></div>
      ${key3.map(evRow).join("")}
      <details class="evd"><summary>근거 ${E.length}개 전부 보기</summary>${E.map(evRow).join("")}</details>
      ${!short && M.turn?.[key]?.length ? `<div class="turn"><b>${lead === "up" ? "꺾이는 신호" : "돌아서는 신호"}</b>${M.turn[key].slice(0, 3).map(t => `<div>· ${esc(t)}</div>`).join("")}</div>` : ""}</div>`;
  }
  el.style.display = "block";
  el.innerHTML = `<div class="wh2">장 흐름 <span>${esc(M.as_of || "")} 종가 · ${M.computed ? "일봉으로 직접 계산한 이동평균선" : "AI 검색 추정(부정확할 수 있음)"}</span></div>
    <div class="msum">${esc(M.summary || "")}</div>
    <div class="mgrid">${mk("us", "미국", M.regime_us, ["나스닥", "S&P500"])}${mk("kr", "한국", M.regime_kr, ["코스피", "코스닥"])}</div>
    ${M.evidence ? `<div style="font-size:12px;color:var(--lime);opacity:.65;margin-top:8px">지표 근거는 일봉 데이터로 코드가 계산했고, 뉴스 근거는 AI가 최근 7일 뉴스를 검색해 정리했어요(● 영향 크기). 종합은 둘을 합친 방향일 뿐 확정 예측이 아니에요.</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">${(M.news_sources || []).length ? `<details class="evd" style="flex:1"><summary>뉴스 출처 ${M.news_sources.length}개</summary>${M.news_sources.map(x => `<div><a href="${esc(x.uri)}" target="_blank" rel="noopener">${esc(x.title || "링크")}</a></div>`).join("")}</details>` : ""}<button type="button" id="newsRefresh" class="mini">뉴스 새로 분석</button></div>` : ""}
    <div class="mmac">VIX <b>${esc(fmt(num(M.vix)))}</b> ${vixTag(num(M.vix))} · 달러 <b>${esc(M.dxy || "—")}</b> · 미 10년물 <b>${esc(fmt(num(M.us10y), "%"))}</b> · 원달러 <b>${esc(fmt(num(M.usdkrw)))}</b></div>`;
}
const renderAll = () => { renderHero(); renderMarketCard(); renderWeek(); paint(); renderExtra(); document.dispatchEvent(new Event("aic:render")); };

// ── 5. 찬반 토론 ──────────────────────────────────────────
async function runDebate(tk, S, M, P) {
  const lines = AG.map(a => { const r = R.agents?.[a.id] || {}, s = R.scores[a.id]; return `- ${a.n}(${a.role}, 가중치 ${a.w}%): ${s.score}점 ${SIG[s.sig][0]} / ${r.headline || ""} / 찬성: ${(r.pros || []).join("; ")} / 반대: ${(r.cons || []).join("; ")}`; }).join("\n");
  return (await gemini(`너는 AI 투자위원회 의장이다. 스윙 투자(수일~수개월) 관점의 최종 심사. 한국어.
${ctxBlock(tk, S, M, P)}
위원 점수와 의견:
${lines}
코드가 계산한 최종 점수: ${R.verdict.score}점 (${R.verdict.band[0]})${R.verdict.veto.length ? `, 거부권: ${R.verdict.veto.join(", ")}` : ""}
지시: 점수와 판정은 바꾸지 말고, 가장 강한 상승 논리를 반박하고, 구체적인 하락 시나리오를 제시하라. 모두 짧게.
JSON 하나만:
{"verdict":"최종 결론 한 문장(50자 이내)","bull_rebuttal":"상승 논리의 약점 한 줄(40자)","bear_scenario":"하락 시나리오 한 줄(40자)","entry_trigger":"매수 실행 조건(20자)","invalidation":"계획 폐기 조건(20자)","watch":"확인할 일정·지표(20자)"}`, { label: "찬반 토론" })).data;
}

// ── 전체 흐름 ────────────────────────────────────────────
let busy = false;
function resetUI() { renderAll(); }
async function convene(tk, force) {
  if (busy) return;
  if (!force) { const x = findToday(tk); if (x) { showSaved(x, "오늘 이미 분석한 결과예요"); return; } }
  if (!cfg.key) { $("setup").style.display = "block"; showErr("먼저 Gemini API 키를 저장해 주세요."); return; }
  busy = true; $("go").disabled = true; showErr("");
  let lock = null; try { lock = await navigator.wakeLock?.request("screen"); } catch (e) {} resetUI();
  R = { tk, at: new Date().toISOString(), agents: {}, scores: {}, state: {} }; renderAll();
  try {
    setStatus("1/5 · 장 흐름 확인 중…");
    let M = null; try { M = await getMarket(); } catch (e) { if (e.status === 404) throw e; if (/한도를 다 썼/.test(e.message)) throw e; }
    R.M = M; renderMarketCard();
    try { setStatus("1/5 · 이번 주 일정 확인 중…"); R.W = await getWeekly(); renderWeek(); } catch (e) { if (/한도를 다 썼/.test(e.message)) throw e; }

    setStatus("2/5 · 펀더멘털 수집 중…");
    let S;
    try { S = await getStock(tk); }
    catch (e) {
      if (e.status !== 404) throw e;
      const list = await loadModels(); if (!list?.length) throw e;
      cfg.model = list.find(n => /flash/.test(n) && !/lite/.test(n)) || list[0]; saveCfg(); S = await getStock(tk);
    }
    if (!S.F || (!S.F.name && !num(S.F.price))) throw new Error(`"${tk}" 종목 데이터를 찾지 못했어요. 정확한 티커(예: IREN)나 회사명으로 다시 검색해 보세요.`);
    R.S = S;
    const P = makePlan(S.F, S.T); R.P = P; renderAll();

    setStatus(cfg.mode === "full" ? "3/5 · 위원별 독립 분석 중…" : "3/5 · 7인 위원 독립 분석 중…");
    const onEach = (id, st, i, res) => {
      R.state[id] = st;
      if (res) { R.agents[id] = res; R.scores[id] = scoreAgent(AGI[id], res, S, M, P); }
      if (cfg.mode === "full" && st === "run") setStatus(`3/5 · ${AGI[id].n} 분석 중 (${i + 1}/7)`);
      paint();
    };
    if (cfg.mode === "full") await analyzeFull(tk, S, M, P, onEach);
    else {
      try { await analyzeEco(tk, S, M, P, onEach); }
      catch (e) { if (/한도를 다 썼/.test(e.message) || e.status === 401 || e.status === 403) throw e; setStatus("3/5 · 한 번에 분석 실패 → 위원별로 다시 분석 중…"); await analyzeFull(tk, S, M, P, onEach); }
    }
    for (const a of AG) if (!R.scores[a.id]) R.scores[a.id] = scoreAgent(a, null, S, M, P);
    paint();

    setStatus("4/5 · 가중 점수 · 거부권 계산 중…");
    R.verdict = finalVerdict(R.scores, S, M, P, R.agents.ptj); renderAll();

    setStatus("5/5 · 찬반 토론 · 최종 심사 중…");
    try { R.D = await runDebate(tk, S, M, P); } catch (e) {}
    renderAll();
    setStatus(`완료 · ${new Date().toLocaleString("ko-KR")}`);
    saveHistory();
  } catch (e) {
    setStatus("");
    showErr(e.status === 400 && /API key/i.test(e.message) ? "API 키가 올바르지 않아요. 설정에서 다시 확인해 주세요." :
      e.status === 403 ? "이 키로는 해당 모델을 쓸 수 없어요. 설정에서 다른 모델을 골라 주세요." : `오류: ${e.message}`);
  } finally { busy = false; $("go").disabled = false; try { lock?.release(); } catch (e) {} }
}

// ── 지난 분석 (설정 안에서만 보기 · 다시 볼 때 API 호출 없음) ──
try { localStorage.removeItem("aic-hist"); localStorage.removeItem("aic-hist2"); } catch (e) {}
const HKEY = "aic-hist3";
const kstDay = iso => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const keyOf = t => String(t || "").trim().toLowerCase();
function saveHistory() {
  const k = keyOf(R.tk), tick = keyOf(R.S?.F?.ticker);
  const h = store.get(HKEY, []).filter(x => !(keyOf(x.tk) === k || (tick && keyOf(x.S?.F?.ticker) === tick)));
  h.unshift(R); store.set(HKEY, h.slice(0, 20)); drawHist();
}
function findToday(tk) {
  const k = keyOf(tk), d = kstDay(new Date().toISOString());
  return store.get(HKEY, []).find(x => kstDay(x.at) === d && [x.tk, x.S?.F?.ticker, x.S?.F?.name].some(v => keyOf(v) === k));
}
function showSaved(x, note) {
  R = x; $("tk").value = x.tk; showErr(""); renderAll();
  $("status").innerHTML = `${esc(note)} · ${esc(new Date(x.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }))} <button type="button" id="redo" class="mini">새로 분석</button>`;
  $("redo").addEventListener("click", () => convene(x.tk, true));
}
function drawHist() {
  const h = store.get(HKEY, []);
  $("hist").innerHTML = h.length ? h.map((x, i) => {
    const v = x.verdict; const c = !v ? "" : v.band[1] === "buy" ? "#2fbf7f" : v.band[1] === "watch" ? "#f5b21b" : "#ff6f59";
    return `<button type="button" class="hrow" data-i="${i}"><span><b>${esc(x.S?.F?.name || x.tk)}</b> <small>${esc(x.S?.F?.ticker || "")}</small></span>
      <span style="color:${c};font-weight:700">${v ? v.score + "점 " + v.band[0] : "—"}</span><small>${esc(new Date(x.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }))}</small></button>`;
  }).join("") + `<button type="button" id="clearHist" class="mini" style="margin-top:8px">기록 모두 지우기</button>` : `<p style="margin:0;font-size:14px;opacity:.7">아직 분석한 종목이 없어요.</p>`;
  $("clearHist")?.addEventListener("click", () => { store.set(HKEY, []); drawHist(); });
}
$("hist").addEventListener("click", e => {
  const b = e.target.closest(".hrow"); if (!b || busy) return;
  const x = store.get(HKEY, [])[+b.dataset.i]; if (!x) return;
  $("setup").style.display = "none"; showSaved(x, "저장된 분석"); window.scrollTo({ top: 0, behavior: "smooth" });
});
drawHist();
renderMarketCard();
loadMarketJson().then(j => { if (j) { MJ = j; const T = store.get("aic-mtext2", null); if (!R.M) { R.M = mergeMarket(j, T?.v); renderMarketCard(); } } });
$("f").addEventListener("submit", e => { e.preventDefault(); const t = $("tk").value.trim(); if (t) convene(t); });
paint();
if (cfg.key) loadModels();

// ── 추가 기능(features.js)에 필요한 것만 공개 ──
window.AIC = { gemini, store, esc, num, clamp, fmt, getMarket, regimeFor, isKR, STRAT, setStatus, showErr, cfg, today,
  get R() { return R; }, get busy() { return busy; }, set busy(v) { busy = v; },
  convene: t => { $("tk").value = t; return convene(t); }, hist: () => store.get(HKEY, []) };
}
