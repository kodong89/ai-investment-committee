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
  { id: "druck", n: "스탠리 드러켄밀러", role: "시장 방향", w: 25, color: "#b08a22",
    q: "좋은 기업인지를 떠나, 지금 돈이 이 종목으로 들어오고 있는가?",
    p: "유동성·금리·달러가 시장을 움직인다고 보고, 18~24개월 앞의 변곡점과 지금의 자금 흐름을 본다. 추세를 존중하고 비대칭 베팅을 한다.",
    checks: [
      { id: "regime", t: "시장 국면이 우호적(상승장)", pts: 20, rule: (F, T, M) => M?.regime ? M.regime === "상승장" : null },
      { id: "sector", t: "섹터가 시장 주도 업종", pts: 20 },
      { id: "rs", t: "3개월 수익률이 지수보다 강함", pts: 20, rule: (F, T) => gt(num(T.return_3m_pct), num(T.index_return_3m_pct)) },
      { id: "flow", t: "기관·외국인 수급 또는 거래대금 증가", pts: 15 },
      { id: "catalyst", t: "1~3개월 내 상승 촉매", pts: 15 },
      { id: "rates", t: "금리·달러 환경이 우호적", pts: 10 } ] },
  { id: "minervini", n: "마크 미너비니", role: "매수 타점", w: 20, color: "#2a2f3a",
    q: "지금이 손실 위험은 작고 상승 여력은 큰 매수 타점인가?",
    p: "트렌드 템플릿(주가>50일>150일>200일선, 200일선 상승), 변동성 축소 패턴(VCP), 거래량 마른 뒤 돌파, 초기 눌림목을 본다. 이격이 큰 추격 매수는 피한다.",
    checks: [
      { id: "trend", t: "추세 정렬: 주가>50일>150일>200일선", pts: 25, rule: (F, T) => { const p = num(F.price), a = num(T.ma50), b = num(T.ma150), c = num(T.ma200); return (p && a && b && c) ? (p > a && a > b && b > c) : null; } },
      { id: "range", t: "52주 저점 +30% 이상, 고점 -25% 이내", pts: 15, rule: (F, T) => { const p = num(F.price), h = num(T.high_52w), l = num(T.low_52w); return (p && h && l) ? (p >= l * 1.3 && p >= h * 0.75) : null; } },
      { id: "vcp", t: "변동성 축소(가격 폭이 점점 좁아짐)", pts: 15 },
      { id: "volume", t: "거래량 감소 후 돌파 시 증가", pts: 15 },
      { id: "spot", t: "돌파 직후 또는 초기 눌림목 (과열 이격 아님)", pts: 20, rule: (F, T) => { const p = num(F.price), a = num(T.ma50); return (p && a) ? (p / a - 1 <= 0.15 && p >= a * 0.97) : null; } },
      { id: "pivot", t: "가까운 곳에 명확한 손절 기준(지지선)", pts: 10, rule: (F, T, M, P) => P?.riskPct != null ? P.riskPct <= 0.08 : null } ] },
  { id: "lynch", n: "피터 린치", role: "성장성", w: 15, color: "#2f8a4e",
    q: "앞으로 실적이 시장의 기대보다 빠르게 성장할 수 있는가?",
    p: "기업을 저성장·우량·고성장·경기순환·턴어라운드·자산주로 분류하고 범주에 맞게 판단한다. PEG를 중시하고 2분 안에 설명되는 스토리를 좋아한다.",
    checks: [
      { id: "rev", t: "매출 성장률 10% 이상", pts: 20, rule: F => num(F.revenue_growth_pct) == null ? null : num(F.revenue_growth_pct) >= 10 },
      { id: "eps", t: "EPS 성장률 15% 이상 또는 가속", pts: 25, rule: F => num(F.eps_growth_pct) == null ? null : num(F.eps_growth_pct) >= 15 },
      { id: "peg", t: "PEG 1.5 이하", pts: 20, rule: F => num(F.peg) == null ? null : num(F.peg) > 0 && num(F.peg) <= 1.5 },
      { id: "guide", t: "실적 전망·가이던스 상향", pts: 20 },
      { id: "industry", t: "산업 자체가 성장 중", pts: 15 } ] },
  { id: "buffett", n: "워런 버핏", role: "기업 경쟁력", w: 10, color: "#c0634a",
    q: "지금 매수해서 5년을 보유해도 괜찮은 기업인가?",
    p: "이해 가능한 사업, 지속 가능한 경제적 해자, 높은 자본수익률, 꾸준한 잉여현금흐름, 경영진의 합리적 자본 배분을 본다.",
    checks: [
      { id: "moat", t: "경제적 해자(브랜드·네트워크·전환비용·원가우위)", pts: 25 },
      { id: "roic", t: "ROIC 또는 ROE 15% 이상", pts: 20, rule: F => { const v = num(F.roic_pct) ?? num(F.roe_pct); return v == null ? null : v >= 15; } },
      { id: "fcf", t: "잉여현금흐름 흑자·증가", pts: 20 },
      { id: "stable", t: "이익의 지속성(최근 수년 적자 없음)", pts: 15 },
      { id: "debt", t: "부채 관리 양호", pts: 10, rule: F => num(F.debt_to_equity_pct) == null ? null : num(F.debt_to_equity_pct) <= 100 },
      { id: "alloc", t: "자본 배분(자사주·배당·M&A) 합리적", pts: 10 } ] },
  { id: "munger", n: "찰리 멍거", role: "실패 가능성", w: 10, color: "#6a4fd8",
    q: "이 종목에 투자하면 어떤 이유로 큰돈을 잃을 수 있는가?",
    p: "뒤집어 생각한다. 망하는 길부터 찾고, 인센티브와 경영진 신뢰를 따지며, 과도한 기대·레버리지·복잡함을 피한다. 각 항목은 '그 위험이 없으면 통과'다.",
    checks: [
      { id: "thesis", t: "투자 논리가 하나의 가정에만 의존하지 않음", pts: 20 },
      { id: "lever", t: "과도한 부채 없음", pts: 20, rule: F => num(F.debt_to_equity_pct) == null ? null : num(F.debt_to_equity_pct) <= 150 },
      { id: "mgmt", t: "경영진 신뢰 문제(회계·소송·내부자 대량매도) 없음", pts: 20 },
      { id: "hype", t: "시장 기대가 과열되지 않음", pts: 20 },
      { id: "simple", t: "사업 구조가 단순하고 이해 가능", pts: 20 } ] },
  { id: "graham", n: "벤저민 그레이엄", role: "안전마진", w: 10, color: "#3459b8",
    q: "현재 가격은 기업 가치 대비 충분히 매력적인가?",
    p: "내재가치 대비 할인(안전마진), PER·PBR의 절대·역사적 수준, 순부채, 유동비율을 본다. 성장 스토리에 값을 치르지 않는다.",
    checks: [
      { id: "per", t: "PER이 자기 역사·업종 평균 이하", pts: 25 },
      { id: "pbr", t: "PBR 3배 이하 또는 업종 대비 낮음", pts: 15, rule: F => num(F.pbr) == null ? null : num(F.pbr) <= 3 },
      { id: "netdebt", t: "순부채가 낮거나 순현금", pts: 20 },
      { id: "current", t: "유동비율 1.5 이상", pts: 15, rule: F => num(F.current_ratio) == null ? null : num(F.current_ratio) >= 1.5 },
      { id: "intrinsic", t: "그레이엄 넘버·내재가치 대비 할인", pts: 25, rule: F => { const e = num(F.eps), b = num(F.bps), p = num(F.price); return (e > 0 && b > 0 && p) ? p <= Math.sqrt(22.5 * e * b) : null; } } ] },
  { id: "ptj", n: "폴 튜더 존스", role: "리스크 관리 · 거부권", w: 10, color: "#1f3a5f",
    q: "판단이 틀렸을 때 감당해야 할 손실은 얼마인가?",
    p: "손익비, 변동성, 갭 하락, 시장 급락, 실적 발표 위험을 먼저 본다. 원금 보존이 최우선이며 중대한 위험이 있으면 거부권을 행사한다.",
    checks: [
      { id: "rr", t: "손익비 2:1 이상", pts: 25, rule: (F, T, M, P) => P?.rr == null ? null : P.rr >= 2 },
      { id: "earn", t: "실적 발표가 5거래일 이내가 아님", pts: 20, rule: F => { const d = daysTo(F.next_earnings_date); return d == null ? null : !(d >= 0 && d <= 7); } },
      { id: "vol", t: "변동성 적정(ATR 5% 이하)", pts: 15, rule: (F, T, M, P) => P?.atrPct == null ? null : P.atrPct <= 0.05 },
      { id: "crash", t: "시장 급락 위험 낮음(VIX 25 미만)", pts: 20, rule: (F, T, M) => num(M?.vix) == null ? null : num(M.vix) < 25 },
      { id: "event", t: "증자·소송·규제 등 갭 하락 이벤트 위험 낮음", pts: 20 } ] }
];
const AGI = Object.fromEntries(AG.map(a => [a.id, a]));
function daysTo(s) { if (!s) return null; const d = new Date(s); if (isNaN(d)) return null; return Math.round((d - new Date()) / 864e5); }

// ── 설정 ───────────────────────────────────────────────────
let cfg = Object.assign({ key: "", model: "gemini-flash-latest", mode: "eco" }, store.get("aic-cfg", {}));
if ((cfg.v || 0) < 2) { cfg.riskPct = 1.5; cfg.maxPos = 30; cfg.v = 2; store.set("aic-cfg", cfg); }
$("key").value = cfg.key; $("mode").value = cfg.mode;
const saveCfg = () => store.set("aic-cfg", cfg);
$("setup").style.display = cfg.key ? "none" : "block";
$("openSet").addEventListener("click", () => { const s = $("setup"); s.style.display = s.style.display === "block" ? "none" : "block"; if (cfg.key) loadModels(); });
$("saveKey").addEventListener("click", async () => { cfg.key = $("key").value.trim(); saveCfg(); if (cfg.key) { await loadModels(); setStatus("키 저장 완료. 종목을 검색해 보세요."); $("setup").style.display = "none"; } });
$("model").addEventListener("change", () => { cfg.model = $("model").value; saveCfg(); });
$("mode").addEventListener("change", () => { cfg.mode = $("mode").value; saveCfg(); });
$("riskPct").value = cfg.riskPct ?? 1.5; $("riskPct").addEventListener("change", () => { cfg.riskPct = $("riskPct").value; saveCfg(); });
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
async function gemini(prompt, { search = false, label = "" } = {}) {
  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3 } };
  if (search) body.tools = [{ google_search: {} }]; else body.generationConfig.responseMimeType = "application/json";
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${API}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.key }, body: JSON.stringify(body) });
    if (r.status === 429 || r.status === 503) {
      let wait = 20, daily = false;
      try { const s = JSON.stringify(await r.json()); const d = s.match(/"retryDelay":"(\d+)/); if (d) wait = Math.min(60, +d[1] + 2); daily = /PerDay/i.test(s); } catch (e) {}
      if (daily) { const e = new Error("오늘 무료 호출 한도를 다 썼어요. 한도는 한국시간 오후 4~5시쯤 초기화돼요. 설정에서 다른 모델을 고르면 별도 한도로 계속 쓸 수 있어요."); e.status = 429; throw e; }
      for (let s = wait; s > 0; s--) { setStatus(`${label} · 무료 한도 대기 ${s}초`); await sleep(1000); }
      continue;
    }
    if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).error?.message || m; } catch (e) {} const e = new Error(m); e.status = r.status; throw e; }
    const j = await r.json(), c = j.candidates?.[0];
    const text = (c?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
    const sources = (c?.groundingMetadata?.groundingChunks || []).map(x => x.web).filter(w => w && /^https:\/\//.test(w.uri));
    return { data: parseJSON(text), sources };
  }
  const e = new Error("무료 한도 초과가 계속돼요. 1~2분 뒤 다시 시도해 주세요."); e.status = 429; throw e;
}
const today = () => new Date().toISOString().slice(0, 10);

// ── 1. 시장 위험 판단 (6시간 캐시) ─────────────────────────
async function getMarket() {
  const c = store.get("aic-market", null);
  if (c && Date.now() - c.t < 6 * 3600e3) return c.v;
  const r = await gemini(`오늘은 ${today()}. 구글 검색으로 현재 주식시장 국면을 판단하라.
나스닥·S&P500·코스피가 50일·200일 이동평균 위/아래인지, VIX, 달러인덱스 추세, 미국 10년물 금리, 최근 1개월 주도 섹터.
regime은 지수가 200일선 위·50일선 위면 "상승장", 200일선 아래·50일선 아래면 "하락장", 그 외 "횡보장".
설명 없이 JSON 하나만:
{"as_of":"날짜","regime":"상승장|횡보장|하락장","nasdaq":"50일선 위/아래, 200일선 위/아래 한 줄","sp500":"한 줄","kospi":"한 줄","vix":숫자,"dxy":"상승|횡보|하락","us10y":숫자,"leading_sectors":["섹터1","섹터2","섹터3"],"summary":"시장 한 줄 요약(30자)"}`, { search: true, label: "시장 위험 판단" });
  const v = { ...r.data, sources: r.sources };
  store.set("aic-market", { t: Date.now(), v });
  return v;
}


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
  const wr = weekRange(), c = store.get("aic-week", null);
  if (c && c.from === wr.from && Date.now() - c.t < 24 * 3600e3) return c.v;
  const r = await gemini(`${wr.from}(월)부터 ${wr.to}(금)까지 한 주의 주식시장 주요 일정을 구글 검색(인베스팅닷컴 경제 캘린더, 연준·한국은행 일정, 실적 발표 캘린더 등)으로 찾아라.
포함: 미국 FOMC·연준 의장 발언·CPI·PCE·고용보고서·GDP·소매판매·ISM, 한국 금통위·수출입·옵션만기, 중국·일본 중앙은행 등 시장에 큰 영향을 주는 것, 그리고 시가총액 상위 주요 기업 실적 발표(미국·한국).
시간은 한국시간(KST) 기준 HH:MM, 모르면 빈 문자열. 중요도는 "상" 또는 "중"만, "하"는 빼라. 하루 최대 6개. 휴장일이면 그것도 적어라.
설명 없이 JSON 하나만:
{"days":[{"date":"YYYY-MM-DD","events":[{"time":"HH:MM","country":"미국|한국|중국|일본|유럽","title":"일정 이름(20자 이내)","imp":"상|중","note":"예상치나 의미(20자 이내)"}]}]}`, { search: true, label: "이번 주 일정" });
  const v = { ...wr, days: r.data.days || [], sources: r.sources };
  store.set("aic-week", { from: wr.from, t: Date.now(), v });
  return v;
}
function renderWeek() {
  const W = R.W || store.get("aic-week", null)?.v;
  const el = $("week");
  if (!W || !W.days) { el.style.display = "none"; return; }
  const today = ymd(kstNow()), dn = ["일", "월", "화", "수", "목", "금", "토"];
  const ed = R.S?.F?.next_earnings_date, myName = R.S?.F?.name;
  const byDate = Object.fromEntries((W.days || []).map(d => [d.date, d.events || []]));
  const wasOpen = el.dataset.init ? el.open : window.innerWidth >= 900; el.dataset.init = 1;
  el.style.display = "block"; el.open = wasOpen;
  el.innerHTML = `<summary>이번 주 일정 <span>${W.from.slice(5).replace("-", ".")}~${W.to.slice(5).replace("-", ".")} · 한국시간</span></summary>
    ${weekDays(W).map(date => {
      const d = new Date(date + "T00:00:00Z"), ev = [...(byDate[date] || [])].sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
      if (ed === date && myName) ev.unshift({ time: "", country: "", title: `${myName} 실적 발표`, imp: "내 종목", note: "검색한 종목" });
      const cls = date === today ? "today" : date < today ? "past" : "";
      return `<div class="wd ${cls}"><div class="wdl">${d.getUTCMonth() + 1}/${d.getUTCDate()}<small>${dn[d.getUTCDay()]}${date === today ? " · 오늘" : ""}</small></div>
        <div class="wev">${ev.length ? ev.map(e => `<div class="we ${e.imp === "상" ? "hi" : e.imp === "내 종목" ? "mine" : ""}"><span class="wt">${esc(e.time || "")}</span><span><b>${esc(e.title)}</b>${e.country ? ` <small>${esc(e.country)}</small>` : ""}${e.note ? `<br><small>${esc(e.note)}</small>` : ""}</span></div>`).join("") : `<div class="we none">주요 일정 없음</div>`}</div></div>`;
    }).join("")}
    <div class="wfoot">굵게: 중요 · 노랑: 내 종목 실적</div>`;
}
function weekDays(W) { return W.from ? [...Array(5)].map((_, i) => { const d = new Date(W.from + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + i); return ymd(d); }) : []; }

// ── 2. 종목 데이터 수집 ───────────────────────────────────
const FUND = `{"name":"회사명","ticker":"티커","market":"거래소","currency":"USD|KRW","sector":"섹터","price":숫자,"change_pct":숫자,"as_of":"가격 기준일","market_cap":"시총(단위 포함)","per":숫자,"fwd_per":숫자,"per_hist_avg":숫자,"pbr":숫자,"roe_pct":숫자,"roic_pct":숫자,"op_margin_pct":숫자,"debt_to_equity_pct":숫자,"net_debt":"순부채(음수면 순현금, 단위 포함)","current_ratio":숫자,"fcf":"최근 연간 FCF(단위 포함)","fcf_trend":"증가|감소|흑자 유지|적자","revenue_growth_pct":숫자,"eps_growth_pct":숫자,"eps_growth_next_pct":숫자,"peg":숫자,"eps":숫자,"bps":숫자,"guidance":"최근 가이던스·컨센서스 변화 한 줄","next_earnings_date":"YYYY-MM-DD","business":"사업 한 줄","news":["최근 뉴스1","2","3"],"corporate_actions":"증자·M&A·소송·상폐 위험 한 줄(없으면 '특이사항 없음')"}`;
const TECH = `{"ma20":숫자,"ma50":숫자,"ma150":숫자,"ma200":숫자,"ma200_rising":true|false,"high_52w":숫자,"low_52w":숫자,"rsi14":숫자,"atr14":숫자,"support":숫자,"resistance":숫자,"swing_low":숫자,"volume_trend":"최근 거래량 흐름 한 줄","return_1m_pct":숫자,"return_3m_pct":숫자,"index_return_3m_pct":숫자,"sector_strength":"섹터 상대강도 한 줄","flow":"기관·외국인·정치인 공시·옵션 등 수급 한 줄","pattern":"돌파|눌림목|박스권|추세 이탈|과열 중 하나와 설명"}`;
const KEYF = ["price", "per", "pbr", "roe_pct", "revenue_growth_pct", "eps_growth_pct", "peg", "eps", "bps", "next_earnings_date"];
const KEYT = ["ma50", "ma150", "ma200", "high_52w", "low_52w", "atr14", "support", "resistance", "return_3m_pct", "index_return_3m_pct"];
const isEmpty = v => v === null || v === undefined || v === "" || v === "null";

async function getStock(tk) {
  const src = `한국 종목은 네이버 금융·FnGuide·한국거래소, 미국 종목은 Yahoo Finance·stockanalysis.com·finviz·회사 IR 참고.`;
  const f = await gemini(`오늘은 ${today()}. 종목 "${tk}"의 최신 펀더멘털을 구글 검색으로 찾아라. ${src}
가격은 최근 종가, 재무는 최근 4분기(TTM) 기준. 퍼센트는 숫자만. 찾은 값만 넣고 못 찾으면 null.
설명 없이 JSON 하나만:
${FUND}`, { search: true, label: "펀더멘털 수집" });
  setStatus("2/5 · 차트·수급 지표 수집 중…");
  const t = await gemini(`오늘은 ${today()}. 종목 "${f.data.name || tk}"(${f.data.ticker || ""})의 기술적 지표를 구글 검색으로 찾아라. ${src}
이동평균은 일봉 종가 기준, ATR은 14일, 지지·저항은 최근 3개월 일봉 기준 가장 가까운 가격대, index_return_3m_pct는 해당 시장 대표 지수(미국 S&P500, 한국 코스피)의 3개월 수익률.
찾은 값만 넣고 못 찾으면 null. 설명 없이 JSON 하나만:
${TECH}`, { search: true, label: "기술적 지표 수집" });
  const F = f.data, T = t.data, sources = [...f.sources, ...t.sources];
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
  const stop = useSup ? supStop : atrStop;
  const risk = entry - stop;
  const res = num(T.resistance);
  const target = (res && res > entry) ? res : null;
  const rr = target ? (target - entry) / risk : null;
  const target2R = entry + 2 * risk;
  const riskPct = risk / entry;
  const acct = clamp(num($("riskPct").value) ?? num(cfg.riskPct) ?? 1.5, 0.1, 5);
  const cap = clamp(num($("maxPos").value) ?? num(cfg.maxPos) ?? 30, 5, 100);
  const size = clamp(acct / 100 / riskPct * 100, 0, cap);
  return { entry, atr, atrEst, atrPct: atr / entry, atrStop, supStop, useSup, stop, riskPct, target, rr, target2R, size, acct, cap, base };
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
코드가 계산한 매매 계획: ${P ? JSON.stringify({ 진입: r2(P.entry), 손절: r2(P.stop), 손절폭_pct: r2(P.riskPct * 100), 목표_저항선: r2(P.target), 손익비: r2(P.rr), ATR_pct: r2(P.atrPct * 100) }) : "계산 불가"}
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
  const score = Math.round(50 + (raw - 50) * cov); // 자료가 적을수록 50점으로 수렴
  const sig = score >= 65 ? "bullish" : score < 45 ? "bearish" : "neutral";
  return { score, cov, items, sig };
}
function finalVerdict(scores, S, M, P, ptjRes) {
  let total = 0; for (const a of AG) total += (scores[a.id]?.score ?? 50) * a.w / 100;
  total = Math.round(total);
  const veto = [];
  if (P?.rr != null && P.rr < 1.5) veto.push(`손익비 ${P.rr.toFixed(2)}:1로 1.5 미만`);
  const d = daysTo(S.F.next_earnings_date); if (d != null && d >= 0 && d <= 3) veto.push(`실적 발표 ${d}일 전 · 갭 위험`);
  if (M?.regime === "하락장") veto.push("시장이 하락장");
  if (num(M?.vix) > 30) veto.push(`VIX ${num(M.vix)} · 시장 급락 위험`);
  if (ptjRes?.veto && ptjRes.veto_reason) veto.push(ptjRes.veto_reason);
  const capped = veto.length ? Math.min(total, 64) : total;
  const band = capped >= 80 ? ["매수 검토", "buy"] : capped >= 65 ? ["관심 종목", "watch"] : ["매수 제외", "out"];
  return { raw: total, score: capped, veto, band };
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
        ${V?.veto.length ? `<div class="veto">리스크 거부권 · ${esc(V.veto.join(" / "))}</div>` : ""}</div></div>
    ${P ? `<div class="pg"><div>진입<span>${fmt(r2(P.entry))}</span></div><div>손절<span>${fmt(r2(P.stop))}</span><em style="font-style:normal;font-size:12px;color:#d9472f">-${pct(P.riskPct)}</em></div>
      <div>목표<span>${fmt(r2(P.target ?? P.target2R))}</span><em style="font-style:normal;font-size:12px;color:#1d9a64">+${pct(((P.target ?? P.target2R) - P.entry) / P.entry)}</em></div>
      <div>손익비<span style="color:${P.rr == null ? "inherit" : P.rr >= 2 ? "#1d9a64" : "#d9472f"}">${P.rr == null ? "2.0R" : P.rr.toFixed(1) + " : 1"}</span></div>
      <div>권장 비중<span>${P.size.toFixed(1)}%</span></div></div>` : ""}
    ${M ? `<div class="mline">시장 ${esc(M.regime || "—")} · VIX ${esc(fmt(num(M.vix)))} · 주도 ${esc((M.leading_sectors || []).slice(0, 2).join(", "))}${F.next_earnings_date ? ` · 다음 실적 ${esc(F.next_earnings_date)}` : ""}</div>` : ""}`;
}

function agentRow(a) {
  const res = R.agents?.[a.id], sc = R.scores?.[a.id], st = R.state?.[a.id];
  const s = sc ? SIG[sc.sig] : null;
  const marks = { pass: ["p", "○"], fail: ["f", "×"], unknown: ["u", "?"] };
  const line = res?.headline ? esc(res.headline) : st === "run" ? '<span class="dots"></span>' : st === "fail" ? "분석 실패 · 50점 처리" : `<span style="opacity:.6">${a.q}</span>`;
  return `<details class="ag"><summary>
      <div class="av"><img src="img/${a.id}.png" alt="${a.n}" width="52" height="52" loading="lazy"></div>
      <div><div class="an">${a.n}<small>${a.role} ${a.w}%</small></div><div class="al">${line}</div>${res?.pros?.[0] ? `<div class="ln p"><i>찬</i>${esc(res.pros[0])}</div>` : ""}${res?.cons?.[0] ? `<div class="ln c"><i>반</i>${esc(res.cons[0])}</div>` : ""}</div>
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
  if (V) sec.push(["점수 계산", `<table><tbody>${AG.map(a => { const sc = R.scores[a.id]?.score ?? 50; return `<tr><td>${a.n}</td><td class="r">${sc}점 × ${a.w}%</td><td class="r">${(sc * a.w / 100).toFixed(1)}</td></tr>`; }).join("")}
    <tr class="pick"><td>합계</td><td></td><td class="r">${V.raw}${V.veto.length ? ` → ${V.score} (거부권)` : ""}</td></tr></tbody></table>`]);
  if (P) sec.push(["손절 방식 비교", `<table><tbody>
    <tr class="${P.useSup ? "" : "pick"}"><td>2 ATR${P.atrEst ? " (추정)" : ""}</td><td class="r">${f(P.atrStop)}</td><td class="r">-${pct((P.entry - P.atrStop) / P.entry)}</td></tr>
    <tr class="${P.useSup ? "pick" : ""}"><td>지지선${P.base ? " " + f(P.base) : ""} − 0.5 ATR</td><td class="r">${f(P.supStop)}</td><td class="r">${P.supStop ? "-" + pct((P.entry - P.supStop) / P.entry) : "—"}</td></tr></tbody></table>
    <p class="tag">더 가까운 쪽(손실이 작은 쪽)을 씁니다. 권장 비중 = 허용 손실 ${P.acct}% ÷ 손절폭, 종목당 최대 ${P.cap ?? 25}%. 집중 투자는 갭 하락 시 손절가보다 더 잃을 수 있어요. 저항선이 없으면 목표는 손절폭의 2배(2R)입니다.</p>`]);
  const items = [["PER", fmt(num(F.per), "배")], ["PEG", fmt(num(F.peg))], ["ROE", fmt(num(F.roe_pct), "%")], ["매출 성장", fmt(num(F.revenue_growth_pct), "%")], ["EPS 성장", fmt(num(F.eps_growth_pct), "%")],
    ["50일선", fmt(num(T.ma50))], ["200일선", fmt(num(T.ma200))], ["ATR", fmt(num(T.atr14))], ["3개월 수익률", fmt(num(T.return_3m_pct), "%")], ["지수 3개월", fmt(num(T.index_return_3m_pct), "%")]];
  sec.push(["종목 데이터 · 출처", `<dl class="kv">${items.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    <ul class="w">${(F.news || []).slice(0, 3).map(n => `<li>${esc(n)}</li>`).join("")}</ul>
    ${M ? `<p class="tag">시장: ${esc(M.summary || "")} (${esc(M.as_of || "")}, 6시간마다 갱신)</p>` : ""}
    ${S.sources?.length ? `<p class="tag" style="overflow-wrap:anywhere">${S.sources.slice(0, 8).map(x => `<a href="${esc(x.uri)}" target="_blank" rel="noopener">${esc(x.title || "링크")}</a>`).join(" · ")}</p>` : ""}`]);
  $("extra").innerHTML = `<div class="xs">${sec.map(([t, b]) => `<details class="x"><summary>${t}</summary><div class="in">${b}</div></details>`).join("")}</div>`;
}
const renderAll = () => { renderHero(); renderWeek(); paint(); renderExtra(); };

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
async function convene(tk) {
  if (busy) return;
  if (!cfg.key) { $("setup").style.display = "block"; showErr("먼저 Gemini API 키를 저장해 주세요."); return; }
  busy = true; $("go").disabled = true; showErr(""); resetUI();
  R = { tk, at: new Date().toISOString(), agents: {}, scores: {}, state: {} }; renderAll();
  try {
    setStatus("1/5 · 시장 위험 판단 중…");
    let M = null; try { M = await getMarket(); } catch (e) { if (e.status === 404) throw e; if (/한도를 다 썼/.test(e.message)) throw e; }
    R.M = M;
    try { setStatus("1/5 · 이번 주 일정 확인 중…"); R.W = await getWeekly(); renderWeek(); } catch (e) { if (/한도를 다 썼/.test(e.message)) throw e; }

    setStatus("2/5 · 펀더멘털 수집 중…");
    let S;
    try { S = await getStock(tk); }
    catch (e) {
      if (e.status !== 404) throw e;
      const list = await loadModels(); if (!list?.length) throw e;
      cfg.model = list.find(n => /flash/.test(n) && !/lite/.test(n)) || list[0]; saveCfg(); S = await getStock(tk);
    }
    R.S = S;
    const P = makePlan(S.F, S.T); R.P = P; renderAll();

    setStatus(cfg.mode === "full" ? "3/5 · 위원별 독립 분석 중…" : "3/5 · 7인 위원 독립 분석 중…");
    const onEach = (id, st, i, res) => {
      R.state[id] = st;
      if (res) { R.agents[id] = res; R.scores[id] = scoreAgent(AGI[id], res, S, M, P); }
      if (cfg.mode === "full" && st === "run") setStatus(`3/5 · ${AGI[id].n} 분석 중 (${i + 1}/7)`);
      paint();
    };
    await (cfg.mode === "full" ? analyzeFull : analyzeEco)(tk, S, M, P, onEach);
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
  } finally { busy = false; $("go").disabled = false; }
}

// ── 기록 (이 기기 저장 · 다시 볼 때 API 호출 없음) ─────────
function saveHistory() { const h = store.get("aic-hist2", []).filter(x => x.tk !== R.tk); h.unshift(R); store.set("aic-hist2", h.slice(0, 15)); drawRecent(); }
function drawRecent() {
  $("recent").innerHTML = store.get("aic-hist2", []).map((x, i) => `<button type="button" class="chip" data-i="${i}">${esc(x.S?.F?.name || x.tk)} ${x.verdict ? x.verdict.score + "점" : ""} · ${esc(new Date(x.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }))}</button>`).join("");
}
$("recent").addEventListener("click", e => {
  const b = e.target.closest(".chip"); if (!b || busy) return;
  const x = store.get("aic-hist2", [])[+b.dataset.i]; if (!x) return;
  R = x; $("tk").value = x.tk; showErr(""); renderAll();
  setStatus(`저장된 분석 · ${new Date(x.at).toLocaleString("ko-KR")} (새로 분석하려면 위원회 소집)`);
});
$("f").addEventListener("submit", e => { e.preventDefault(); const t = $("tk").value.trim(); if (t) convene(t); });
paint(); drawRecent();
if (cfg.key) loadModels();
}
