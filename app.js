// AI 투자위원회 — Gemini API를 브라우저에서 직접 호출 (키는 localStorage에만 저장)
{
const API = "https://generativelanguage.googleapis.com/v1beta";
const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clamp = (n, a, b) => Math.max(a, Math.min(b, Number(n) || 0));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

// ── 위원 (투자 철학) ─────────────────────────────────────────
const AG = [
  { id: "buffett", n: "워런 버핏", s: "경제적 해자", c: "#c0634a", m: "버",
    p: `워런 버핏의 투자 철학:
- 이해할 수 있는 사업(능력의 범위)만 산다.
- 지속 가능한 경제적 해자: 브랜드, 네트워크 효과, 전환비용, 원가우위.
- 높은 ROE(15% 이상 꾸준히), 낮은 부채, 안정적이고 예측 가능한 이익과 잉여현금흐름.
- 정직하고 주주친화적인 경영진, 합리적인 자본배분.
- 내재가치(미래 현금흐름의 현재가치)보다 충분히 싸야 한다. 훌륭한 기업을 적정 가격에.
- 10년 동안 시장이 문을 닫아도 마음 편히 들고 갈 수 있는가.` },
  { id: "munger", n: "찰리 멍거", s: "좋은 기업, 합리적 가격", c: "#6a4fd8", m: "멍",
    p: `찰리 멍거의 투자 철학:
- 뒤집어 생각하라: 이 회사를 망하게 할 요인은 무엇인가부터 본다.
- 사업의 질이 최우선. 높은 자본수익률, 가격 결정력, 재투자 기회.
- 여러 학문의 정신 모델(심리학, 경제학, 인센티브)로 본다. 경영진 인센티브를 확인한다.
- 어리석음을 피하는 것이 똑똑해지려는 것보다 낫다. 과도한 레버리지, 유행, 복잡함을 싫어한다.
- 매우 까다로워서 대부분은 패스한다. 확실한 기회에만 크게 집중 투자한다.` },
  { id: "graham", n: "벤 그레이엄", s: "안전마진", c: "#3459b8", m: "그",
    p: `벤저민 그레이엄의 투자 철학:
- 안전마진: 내재가치보다 크게 싸게 사야 한다.
- 정량 기준: PER 15 이하, PBR 1.5 이하(또는 PER×PBR 22.5 이하), 유동비율 2 이상, 부채가 순유동자산보다 적을 것.
- 최근 10년 적자 없음, 꾸준한 배당, 이익 성장.
- 그레이엄 넘버 = √(22.5 × EPS × BPS)와 현재가를 비교한다.
- 미래 성장 스토리나 시장의 흥분에 돈을 지불하지 않는다. "미스터 마켓"의 감정을 이용한다.` },
  { id: "lynch", n: "피터 린치", s: "PEG · 성장 범주", c: "#2f8a4e", m: "린",
    p: `피터 린치의 투자 철학:
- 먼저 기업을 6개 범주로 분류한다: 저성장주, 대형우량주(스탈워트), 고성장주, 경기순환주, 턴어라운드주, 자산주. 범주마다 판단 기준이 다르다.
- PEG(PER ÷ 이익성장률)가 1 이하면 매력적, 2 이상이면 비싸다.
- 2분 안에 설명할 수 있는 단순한 스토리. 일상에서 보이는 제품.
- 재고, 부채, 현금, 내부자 매수, 자사주 매입을 확인한다.
- 텐배거(10배) 가능성이 있는가. 너무 유명하고 모두가 아는 종목은 경계한다.` },
  { id: "druck", n: "스탠리 드러켄밀러", s: "매크로 · 비대칭", c: "#b08a22", m: "드",
    p: `스탠리 드러켄밀러의 투자 철학:
- 유동성이 시장을 움직인다: 연준 정책, 금리 방향, 달러, 신용 환경을 먼저 본다.
- 현재가 아니라 18~24개월 뒤를 본다. 이익 추정치의 변곡점을 찾는다.
- 가격 추세와 모멘텀을 존중한다. 차트가 펀더멘털과 어긋나면 이유를 따진다.
- 비대칭 베팅: 손실은 작게 자르고, 확신이 클 때는 크게 건다.
- 틀렸다고 판단되면 즉시 생각을 바꾼다. 원금 보존이 먼저다.` }
];
const SIG = { bullish: ["사자", "p-buy"], bearish: ["팔자", "p-sell"], neutral: ["중립", "p-neu"] };

// ── 설정 ───────────────────────────────────────────────────
let cfg = store.get("aic-cfg", { key: "", model: "gemini-flash-latest", search: true });
function showSetup(force) { $("setup").style.display = (force || !cfg.key) ? "block" : "none"; }
$("key").value = cfg.key; $("useSearch").checked = cfg.search !== false;
showSetup();
$("openSet").addEventListener("click", () => { const s = $("setup"); s.style.display = s.style.display === "block" ? "none" : "block"; if (cfg.key) loadModels(); });
$("saveKey").addEventListener("click", async () => {
  cfg.key = $("key").value.trim(); store.set("aic-cfg", cfg);
  if (cfg.key) { await loadModels(); setStatus("키 저장 완료. 종목을 검색해 보세요."); $("setup").style.display = "none"; }
});
$("model").addEventListener("change", () => { cfg.model = $("model").value; store.set("aic-cfg", cfg); });
$("useSearch").addEventListener("change", () => { cfg.search = $("useSearch").checked; store.set("aic-cfg", cfg); });

async function loadModels() {
  try {
    const r = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": cfg.key } });
    if (!r.ok) return;
    const j = await r.json();
    const ids = (j.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => m.name.replace(/^models\//, ""))
      .filter(n => /^gemini/.test(n) && !/(image|tts|live|audio|embedding|robotics|translate)/.test(n));
    const list = ["gemini-flash-latest", ...ids.filter(n => n !== "gemini-flash-latest")];
    $("model").innerHTML = list.map(n => `<option value="${esc(n)}">${esc(n)}${n === "gemini-flash-latest" ? " (기본)" : ""}</option>`).join("");
    if (!list.includes(cfg.model)) cfg.model = list[0];
    $("model").value = cfg.model;
    return list;
  } catch (e) { /* 무시 */ }
}

// ── Gemini 호출 ────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
function setStatus(t) { $("status").textContent = t || ""; }
function showErr(m) { const e = $("err"); e.textContent = m || ""; e.style.display = m ? "block" : "none"; }

function parseJSON(t) {
  if (!t) throw new Error("빈 응답");
  t = t.replace(/```json|```/g, "").trim();
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("JSON 해석 실패");
}

async function gemini(prompt, { search = false, json = true, label = "" } = {}) {
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4 }
  };
  if (search) body.tools = [{ google_search: {} }];
  else if (json) body.generationConfig.responseMimeType = "application/json";

  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${API}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.key },
      body: JSON.stringify(body)
    });
    if (r.status === 429 || r.status === 503) {
      let wait = 20;
      try { const j = await r.json(); const d = JSON.stringify(j).match(/"retryDelay":"(\d+)/); if (d) wait = Math.min(60, +d[1] + 2); } catch (e) {}
      for (let s = wait; s > 0; s--) { setStatus(`${label} · 무료 한도 대기 중 ${s}초…`); await sleep(1000); }
      continue;
    }
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const j = await r.json(); msg = j.error?.message || msg; } catch (e) {}
      const err = new Error(msg); err.status = r.status; throw err;
    }
    const j = await r.json();
    const cand = j.candidates?.[0];
    const text = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
    const sources = (cand?.groundingMetadata?.groundingChunks || []).map(c => c.web).filter(w => w && /^https:\/\//.test(w.uri));
    return { data: json ? parseJSON(text) : text, sources };
  }
  const e = new Error("무료 한도를 계속 초과했어요. 1~2분 뒤 다시 시도해 주세요."); e.status = 429; throw e;
}

// ── 사용자 상황 ────────────────────────────────────────────
function userCtx() {
  const f = [["현재 보유 비중(%)", $("hold").value], ["현금 비중(%)", $("cash").value], ["평균 매수가", $("avg").value], ["투자 기간", $("horizon").value], ["메모", $("memo").value]]
    .filter(x => String(x[1]).trim()).map(x => `- ${x[0]}: ${String(x[1]).trim()}`).join("\n");
  return f ? `사용자 상황:\n${f}` : "사용자 상황: 별도 입력 없음";
}

// ── 1단계: 데이터 수집 ──────────────────────────────────────
const FACT_SCHEMA = `{"name":"회사명","ticker":"티커","market":"거래소","currency":"USD|KRW 등","price":숫자,"change_pct":숫자,"as_of":"가격 기준 시각","market_cap":"시가총액(단위 포함)","per":숫자|null,"fwd_per":숫자|null,"pbr":숫자|null,"roe_pct":숫자|null,"op_margin_pct":숫자|null,"debt_to_equity_pct":숫자|null,"current_ratio":숫자|null,"revenue_growth_pct":숫자|null,"eps_growth_pct":숫자|null,"eps":숫자|null,"bps":숫자|null,"dividend_yield_pct":숫자|null,"high_52w":숫자|null,"low_52w":숫자|null,"trend":"최근 3~6개월 주가 흐름 한 줄","business":"무엇으로 돈을 버는지 한 줄","news":["최근 뉴스/실적 1","2","3"],"macro":["이 종목에 영향 주는 금리·유동성·업황 1","2"]}`;

async function gatherFacts(tk) {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `오늘은 ${today}이다. 종목 "${tk}"에 대해 구글 검색으로 가장 최신 데이터를 찾아라.
한국 종목이면 한국거래소 기준 원화로, 미국 종목이면 달러로. 모르는 값은 null. 추측한 숫자를 넣지 마라.
설명 없이 아래 JSON 하나만 출력:
${FACT_SCHEMA}`;
  if (cfg.search !== false) {
    try { return { ...(await gemini(prompt, { search: true, label: "데이터 수집" })), live: true }; }
    catch (e) { if (e.status === 401 || e.status === 403) throw e; /* 검색 실패 → 검색 없이 진행 */ }
  }
  const r = await gemini(prompt.replace("구글 검색으로 가장 최신 데이터를 찾아라", "알고 있는 가장 최근 데이터를 정리하라(as_of에 기준 시점 명시)"), { label: "데이터 수집" });
  return { ...r, live: false };
}

const fmt = (v, suf = "") => (v === null || v === undefined || v === "") ? "—" : (typeof v === "number" ? v.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : v) + suf;

function renderFacts(F, sources, live) {
  const up = Number(F.change_pct) >= 0;
  const items = [["시가총액", F.market_cap], ["PER", fmt(F.per, "배")], ["선행 PER", fmt(F.fwd_per, "배")], ["PBR", fmt(F.pbr, "배")], ["ROE", fmt(F.roe_pct, "%")], ["영업이익률", fmt(F.op_margin_pct, "%")],
    ["부채비율", fmt(F.debt_to_equity_pct, "%")], ["매출 성장", fmt(F.revenue_growth_pct, "%")], ["EPS 성장", fmt(F.eps_growth_pct, "%")], ["배당수익률", fmt(F.dividend_yield_pct, "%")], ["52주 고가", fmt(F.high_52w)], ["52주 저가", fmt(F.low_52w)]];
  $("facts").style.display = "block";
  $("facts").innerHTML = `
    <div class="fh"><b>${esc(F.name)} <span style="font-size:15px;opacity:.7">${esc(F.ticker)} · ${esc(F.market)}</span></b>
      <span><span class="px">${esc(fmt(F.price))} ${esc(F.currency)}</span> <span class="chg ${up ? "up" : "dn"}">${F.change_pct == null ? "" : (up ? "+" : "") + esc(fmt(F.change_pct, "%"))}</span></span></div>
    <div style="font-size:13px;color:var(--lime);opacity:.8">${live ? "구글 검색 기준" : "검색 미사용 · AI가 아는 과거 데이터"} · ${esc(F.as_of || "")}</div>
    <div class="fg">${items.map(([k, v]) => `<div>${k}<span>${esc(v ?? "—")}</span></div>`).join("")}</div>
    <div style="font-size:14px">${esc(F.business || "")}${F.trend ? " · " + esc(F.trend) : ""}</div>
    <ul>${(F.news || []).slice(0, 3).map(n => `<li>${esc(n)}</li>`).join("")}</ul>
    ${sources?.length ? `<div class="src">출처 ${sources.slice(0, 6).map(s => `<a href="${esc(s.uri)}" target="_blank" rel="noopener">${esc(s.title || "링크")}</a>`).join("")}</div>` : ""}`;
}

// ── 2단계: 위원 분석 ────────────────────────────────────────
let results = {}, state = {};
function agentRow(a) {
  const r = results[a.id], st = state[a.id];
  const s = r ? (SIG[r.signal] || SIG.neutral) : null, cf = r ? clamp(r.confidence, 0, 100) : 0;
  const sigBox = r ? `<span class="pill ${s[1]}">${s[0]}</span><div class="cf">확신 ${cf}%</div>` : `<span class="pill p-wait">—</span>`;
  return `<div class="row">
    <div class="av" style="background:${a.c}">${a.m}</div>
    <div><div class="nm">${a.n}<small>${a.s}</small></div>
      ${r ? `<div class="sigm">${sigBox}</div>
        <div class="hd">${esc(r.headline)}</div>
        <div class="why">${esc(r.verdict_reason)}</div>
        <div class="pc"><div class="pro"><h4>찬성 근거 · 사야 하는 이유</h4><ul>${(r.pros || []).slice(0, 4).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
          <div class="con"><h4>반대 근거 · 망설이는 이유</h4><ul>${(r.cons || []).slice(0, 4).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div></div>
        ${r.change_mind ? `<div class="chg2">의견이 바뀌는 조건 · ${esc(r.change_mind)}</div>` : ""}`
      : `<div class="hd" style="opacity:.6">${st === "run" ? '<span class="dots"></span>' : st === "fail" ? "분석 실패" : "대기"}</div>`}
    </div>
    <div class="sig">${sigBox}${r ? `<div class="mtr"><i style="width:${cf}%"></i></div>` : ""}</div>
  </div>`;
}
function paint() {
  $("rows").innerHTML = AG.map(agentRow).join("");
  const v = Object.values(results), cnt = k => v.filter(r => r.signal === k).length;
  $("tally").innerHTML = v.length ? `<span><b>${cnt("bullish")}</b>사자</span><span><b>${cnt("neutral")}</b>중립</span><span><b>${cnt("bearish")}</b>팔자</span>` : "";
}
paint();

async function runAgent(a, tk, facts) {
  const prompt = `너는 AI 투자위원회의 위원이며, 아래 투자 철학을 그대로 따르는 분석가다. 실제 인물을 사칭하지 말고 그 관점으로만 판단한다. 한국어.

${a.p}

분석 종목: ${tk}
수집된 데이터(JSON):
${JSON.stringify(facts)}
${userCtx()}

지시:
- 반드시 위 철학의 기준을 데이터 수치에 하나하나 대입해 판단하라. 근거에는 가능한 한 실제 수치를 넣어라.
- 찬성 근거(사야 하는 이유)와 반대 근거(사지 말아야 하는 이유)를 둘 다 정직하게 써라. 결론이 팔자여도 찬성 근거를, 사자여도 반대 근거를 반드시 써라.
- 데이터가 없는 항목은 '자료 없음'이라고 밝히고 그만큼 확신도를 낮춰라.

아래 JSON 하나만 출력:
{"signal":"bullish|bearish|neutral","confidence":0~100 정수,"headline":"이 관점의 결론 한 문장(40자 이내, 구어체)","verdict_reason":"왜 이 결론인지 2문장","pros":["찬성 근거1","2","3"],"cons":["반대 근거1","2","3"],"change_mind":"어떤 조건이면 의견을 바꿀지 한 줄"}`;
  return (await gemini(prompt, { label: a.n })).data;
}

// ── 3단계: 리스크 · 최종 ────────────────────────────────────
function summaryText() {
  return AG.filter(a => results[a.id]).map(a => {
    const r = results[a.id];
    return `- ${a.n}(${a.s}): ${r.signal}, 확신 ${r.confidence}% / 결론: ${r.headline} / 찬성: ${(r.pros || []).join("; ")} / 반대: ${(r.cons || []).join("; ")}`;
  }).join("\n");
}

async function runRisk(tk, facts) {
  return (await gemini(`너는 헤지펀드 리스크 매니저다. 종목 ${tk}의 위험 한도를 정한다. 한국어.
데이터: ${JSON.stringify(facts)}
${userCtx()}
위원 의견:
${summaryText()}
기준: 52주 고저 범위와 업종으로 연변동성 추정, 위원 의견이 갈릴수록 한도 축소, 단일 종목 최대 25%, 사용자의 기존 보유·현금 비중 고려.
JSON 하나만 출력:
{"risk_level":"낮음|보통|높음|매우 높음","volatility":"추정 연변동성 예: 약 45%","max_position_pct":0~25 숫자,"consensus":"의견 일치도 한 줄","warnings":["경고1","경고2","경고3"]}`, { label: "리스크 매니저" })).data;
}

async function runPM(tk, facts, risk) {
  return (await gemini(`너는 포트폴리오 매니저로 최종 결정을 내린다. 종목 ${tk}. 한국어.
데이터: ${JSON.stringify(facts)}
${userCtx()}
위원 의견:
${summaryText()}
리스크 매니저: ${risk ? JSON.stringify(risk) : "평가 없음 — 한도 10% 가정"}
규칙: 목표 비중은 max_position_pct 이하. 위원 확신도를 가중해 판단. 사용자 보유 비중·평균 매수가가 있으면 그 대비 행동을 제시.
JSON 하나만 출력:
{"action":"매수|분할 매수|보유|비중 축소|매도|관망","target_weight_pct":숫자,"conviction":0~100,"summary":"최종 결정 이유 2~3문장","bull_case":"위원들의 찬성 논리를 종합한 2문장","bear_case":"위원들의 반대 논리를 종합한 2문장","plan":{"진입":"가격대·방식","손절":"조건","재검토":"다시 볼 이벤트·지표"}}`, { label: "포트폴리오 매니저" })).data;
}

function renderRisk(r) {
  $("risk").innerHTML = `<div class="tag">2단계 · 리스크 매니저</div><h2>위험 한도</h2>
    <div class="big">${esc(clamp(r.max_position_pct, 0, 25))}%</div><div class="tag">이 종목 최대 비중</div>
    <dl class="kv"><dt>위험 수준</dt><dd>${esc(r.risk_level)}</dd><dt>추정 변동성</dt><dd>${esc(r.volatility)}</dd><dt>의견 일치도</dt><dd>${esc(r.consensus)}</dd></dl>
    <ul class="w">${(r.warnings || []).slice(0, 4).map(w => `<li>${esc(w)}</li>`).join("")}</ul>`;
}
function renderPM(p, risk) {
  const a = String(p.action || ""), cls = /매수/.test(a) ? "buy" : /매도|축소/.test(a) ? "sell" : "hold";
  const hold = $("hold").value.trim(), plan = p.plan || {};
  $("pm").innerHTML = `<div class="tag">3단계 · 포트폴리오 매니저</div><h2>최종 결정</h2>
    <div class="big ${cls}">${esc(a)}</div>
    <dl class="kv"><dt>목표 비중</dt><dd>${esc(p.target_weight_pct)}%${hold ? ` (현재 ${esc(hold)}%)` : ""}</dd><dt>확신도</dt><dd>${esc(clamp(p.conviction, 0, 100))}%</dd>${risk ? `<dt>리스크 한도</dt><dd>${esc(risk.max_position_pct)}%</dd>` : ""}</dl>
    <p style="margin:8px 0 0">${esc(p.summary)}</p>
    <div class="cases"><div class="case pro"><h4>왜 찬성하나</h4>${esc(p.bull_case)}</div><div class="case con"><h4>왜 반대하나</h4>${esc(p.bear_case)}</div></div>
    <div class="steps">${["진입", "손절", "재검토"].filter(k => plan[k]).map(k => `<div class="step"><b>${k}</b><span>${esc(plan[k])}</span></div>`).join("")}</div>`;
}
function resetLower() {
  $("risk").innerHTML = `<div class="tag">2단계 · 리스크 매니저</div><h2>위험 한도</h2><p class="empty">위원 의견을 기다리는 중…</p>`;
  $("pm").innerHTML = `<div class="tag">3단계 · 포트폴리오 매니저</div><h2>최종 결정</h2><p class="empty">대기 중…</p>`;
}

// ── 전체 흐름 ──────────────────────────────────────────────
let busy = false;
async function convene(tk) {
  if (busy) return;
  if (!cfg.key) { showSetup(true); showErr("먼저 Gemini API 키를 저장해 주세요."); return; }
  busy = true; $("go").disabled = true; showErr(""); results = {}; state = {};
  $("facts").style.display = "none"; resetLower(); paint();
  const rec = { tk, at: new Date().toISOString() };
  try {
    setStatus("1/4 · 최신 시세·재무·뉴스 수집 중…");
    let fr;
    try { fr = await gatherFacts(tk); }
    catch (e) {
      if (e.status === 404) { const list = await loadModels(); if (list?.length) { cfg.model = list.find(n => /flash/.test(n) && !/lite/.test(n)) || list[0]; store.set("aic-cfg", cfg); fr = await gatherFacts(tk); } else throw e; }
      else throw e;
    }
    rec.facts = fr.data; rec.sources = fr.sources; rec.live = fr.live;
    renderFacts(fr.data, fr.sources, fr.live);

    for (let i = 0; i < AG.length; i++) {
      const a = AG[i]; state[a.id] = "run"; paint();
      setStatus(`2/4 · ${a.n} 관점 분석 중 (${i + 1}/5)`);
      try { results[a.id] = await runAgent(a, tk, fr.data); state[a.id] = "done"; }
      catch (e) { state[a.id] = "fail"; if (e.status === 401 || e.status === 403) throw e; }
      paint();
    }
    $("bt").textContent = `${fr.data.name || tk} · 위원 의견 ${Object.keys(results).length}/5`;
    if (!Object.keys(results).length) throw new Error("위원 분석을 받지 못했어요.");
    rec.results = results;

    setStatus("3/4 · 리스크 매니저 검토 중…");
    let risk = null;
    try { risk = await runRisk(tk, fr.data); renderRisk(risk); rec.risk = risk; } catch (e) {}
    setStatus("4/4 · 포트폴리오 매니저 최종 결정 중…");
    const pm = await runPM(tk, fr.data, risk); renderPM(pm, risk); rec.pm = pm;
    setStatus(`완료 · ${new Date().toLocaleString("ko-KR")}`);
    saveHistory(rec);
  } catch (e) {
    setStatus("");
    showErr(e.status === 400 && /API key/i.test(e.message) ? "API 키가 올바르지 않아요. 설정에서 다시 확인해 주세요." :
      e.status === 403 ? "이 키로는 해당 모델을 쓸 수 없어요. 설정에서 다른 모델을 골라 주세요." : `오류: ${e.message}`);
  } finally { busy = false; $("go").disabled = false; }
}

// ── 기록 (이 기기에만 저장, 다시 볼 때 API 호출 안 함) ─────────
function saveHistory(rec) { const h = store.get("aic-hist", []).filter(x => x.tk !== rec.tk); h.unshift(rec); store.set("aic-hist", h.slice(0, 12)); drawRecent(); }
function drawRecent() {
  const h = store.get("aic-hist", []);
  $("recent").innerHTML = h.map((x, i) => `<button type="button" class="chip" data-i="${i}">${esc(x.tk)} · ${esc(new Date(x.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }))}</button>`).join("");
}
$("recent").addEventListener("click", e => {
  const b = e.target.closest(".chip"); if (!b || busy) return;
  const x = store.get("aic-hist", [])[+b.dataset.i]; if (!x) return;
  $("tk").value = x.tk; showErr("");
  results = x.results || {}; state = {}; paint();
  if (x.facts) renderFacts(x.facts, x.sources, x.live);
  $("bt").textContent = `${x.facts?.name || x.tk} · 저장된 분석`;
  x.risk ? renderRisk(x.risk) : resetLower();
  if (x.pm) renderPM(x.pm, x.risk);
  setStatus(`저장된 분석 · ${new Date(x.at).toLocaleString("ko-KR")} (새로 분석하려면 위원회 소집)`);
});
$("f").addEventListener("submit", e => { e.preventDefault(); const t = $("tk").value.trim(); if (t) convene(t); });
drawRecent();
if (cfg.key) loadModels();
}
