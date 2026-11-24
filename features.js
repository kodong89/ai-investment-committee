// 추가 기능: 매수 근거 검증 · 보유 종목 점검 · 뉴스 수혜주 · 내 포트폴리오
{
const A = window.AIC; if (!A) throw new Error("app.js가 먼저 필요해요");
const $ = id => document.getElementById(id);
const { esc, num, clamp, store } = A;
const f2 = v => v == null ? "—" : Number(v).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
const RULES = () => `사용자 매매규칙: 수일~수개월 스윙, 최대 4종목, 1회 손실은 계좌의 ${A.cfg.riskPct ?? 1}% 이내, 종목당 최대 ${A.cfg.maxPos ?? 30}%, 손절은 기계적으로, 근거 없는 물타기 금지, 2R에서 절반 익절 후 EMA20 종가 이탈 시 청산.`;
const lock = async (btn, fn) => {
  if (A.busy) return; if (!A.cfg.key) { alertBox("먼저 설정에서 Gemini API 키를 저장해 주세요."); return; }
  A.busy = true; btn.disabled = true;
  try { await fn(); } finally { A.busy = false; btn.disabled = false; }
};
function alertBox(m) { const e = $("err"); e.textContent = m; e.style.display = "block"; }
const errHTML = e => `<div class="rc"><div class="alert" style="margin:0">${esc(/한도를 다 썼/.test(e.message) ? e.message : "오류: " + e.message)}</div></div>`;
const tagCls = d => /매수|사자|보유|미반영/.test(d) ? "g" : /매도|손절|팔자|이미/.test(d) ? "r" : "y";
function ctx(R) {
  const F = R.S?.F || {}, T = R.S?.T || {}, V = R.verdict, P = R.P;
  return `종목: ${F.name || R.tk} (${F.ticker || ""}) · 현재가 ${F.price} ${F.currency || ""}
펀더멘털: ${JSON.stringify({ per: F.per, peg: F.peg, roe: F.roe_pct, 매출성장: F.revenue_growth_pct, eps성장: F.eps_growth_pct, 다음실적: F.next_earnings_date, 뉴스: F.news, 기업행동: F.corporate_actions })}
차트: ${JSON.stringify({ ema10: T.ema10, ema20: T.ema20, ema50: T.ema50, ema200: T.ema200, cci20: T.cci20, adx14: T.adx14, atr14: T.atr14, 지지: T.support, 저항: T.resistance, 매물대: T.overhead_poc, 수익률1m: T.return_1m_pct, 수익률3m: T.return_3m_pct, 패턴: T.pattern })}
시장 국면: ${A.regimeFor(F, R.M) || "알 수 없음"}
위원회: ${V ? `${V.score}점 ${V.band[0]}${V.veto.length ? " · 거부권: " + V.veto.join(", ") : ""}` : "없음"} / 위원 요약: ${Object.entries(R.agents || {}).map(([k, a]) => `${k}:${R.scores?.[k]?.score ?? "-"}점 ${a.headline || ""}`).join(" | ")}
매매 계획: ${P ? `진입 ${f2(P.entry)}, 손절 ${f2(P.stop)}, 목표 ${f2(P.target ?? P.target2R)}, 손익비 ${P.rr == null ? "-" : P.rr.toFixed(2)}` : "없음"}`;
}

// ── 탭 ─────────────────────────────────────────────────
function tab(t) {
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.t === t);
  for (const k of ["ana", "news", "pf"]) $("tab-" + k).hidden = k !== t;
  if (t === "pf") renderPF();
}
$("tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) tab(b.dataset.t); });

// 분석 결과가 있을 때만 추가 점검 카드 보이기
document.addEventListener("aic:render", () => {
  const R = A.R; $("tools").style.display = R?.S && R.verdict ? "grid" : "none";
  if (R?.tk !== $("tools").dataset.tk) { $("vOut").innerHTML = ""; $("hOut").innerHTML = ""; $("tools").dataset.tk = R?.tk || ""; }
});

// ── 1. 내 매수 근거 검증 ─────────────────────────────────
$("vGo").addEventListener("click", () => lock($("vGo"), async () => {
  const R = A.R, why = $("vText").value.trim();
  if (!why) { $("vOut").innerHTML = `<div class="rc">매수하려는 이유를 먼저 적어 주세요.</div>`; return; }
  $("vOut").innerHTML = `<div class="rc"><span class="dots"></span></div>`;
  try {
    const d = (await A.gemini(`너는 냉철하고 객관적인 월스트리트 리스크 분석가다. 사용자가 매수하려는 종목과 근거를 비판적으로 검증하라.
무조건 동의하지 말고, 근거에 문제가 있으면 돌려 말하지 말고 명확하게 지적하라. 감정이나 낙관론이 아닌 아래 데이터로만 판단하라. 한국어, 짧게.
${RULES()}
${ctx(R)}
사용자의 매수 근거: "${why.replace(/"/g, "'")}"
JSON 하나만:
{"logic":"타당|부분 타당|부실","logic_note":"근거가 맞는 부분과 틀린 부분 2문장","positives":["실제 투자 매력 1(25자)","2"],"missed_risks":["놓친 위험·악재 1(25자)","2","3"],"expectation_gap":"시장 기대와 실제 가치의 괴리 한 줄","biases":[{"name":"확증편향","detected":true|false,"why":"20자"},{"name":"군중심리·FOMO","detected":true|false,"why":"20자"},{"name":"본전 심리·손실 회피","detected":true|false,"why":"20자"}],"decision":"매수|관망|매도","blunt":"직설적인 한 마디(40자)"}`, { label: "매수 근거 검증" })).data;
    $("vOut").innerHTML = `<div class="rc">
      <div class="dec"><b>${esc(d.decision)}</b><span class="tag2 ${d.logic === "타당" ? "g" : d.logic === "부실" ? "r" : "y"}">근거 ${esc(d.logic)}</span></div>
      <div>${esc(d.logic_note)}</div>
      <h4>놓친 위험</h4><ul>${(d.missed_risks || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <h4>그래도 매력적인 점</h4><ul>${(d.positives || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <h4>기대와 가치의 괴리</h4><div>${esc(d.expectation_gap)}</div>
      <h4>심리 점검</h4><div>${(d.biases || []).map(b => `<div><span class="tag2 ${b.detected ? "r" : "g"}">${esc(b.name)} ${b.detected ? "의심" : "없음"}</span> <small style="color:#5b6b66">${esc(b.why)}</small></div>`).join("")}</div>
      <div class="blunt">${esc(d.blunt)}</div></div>`;
  } catch (e) { $("vOut").innerHTML = errHTML(e); }
}));

// ── 2. 보유 종목 점검 (하락 대응) ─────────────────────────
$("hGo").addEventListener("click", () => lock($("hGo"), async () => {
  const R = A.R, F = R.S.F, P = R.P, price = num(F.price), avg = num($("hAvg").value), w = num($("hW").value);
  if (!avg || !price) { $("hOut").innerHTML = `<div class="rc">평균 매수가를 입력해 주세요.</div>`; return; }
  const pnl = price / avg - 1, acct = w ? w / 100 * pnl * 100 : null, risk = num(A.cfg.riskPct) ?? 1;
  const ruleHit = (acct != null && acct <= -risk) || (P && price < P.stop);
  const gateOk = R.scores?.mine ? !R.scores.mine.gateFail : null;
  $("hOut").innerHTML = `<div class="rc"><span class="dots"></span></div>`;
  try {
    const d = (await A.gemini(`너는 글로벌 IB의 리스크 관리 애널리스트이자 투자 전략가다. 사용자가 보유 중인 종목의 하락 원인과 펀더멘털을 분석하고 가장 합리적인 대응을 제시하라.
근거 없는 낙관론이나 무조건적인 물타기를 권하지 마라. 추가 매수는 추세 게이트를 통과하고 새 손절선을 정할 수 있을 때만 허용. 사용자의 매매규칙을 최우선으로 지켜라. 한국어, 짧게.
${RULES()}
${ctx(R)}
보유 상황: 평균 매수가 ${avg}, 현재 손익 ${(pnl * 100).toFixed(1)}%, 계좌 내 비중 ${w ?? "미입력"}%, 계좌 기준 손익 ${acct == null ? "미상" : acct.toFixed(2) + "%"}, 규칙상 손절 조건 ${ruleHit ? "충족(손절 대상)" : "미충족"}, 내 매매법 추세 게이트 ${gateOk == null ? "미상" : gateOk ? "통과" : "탈락"}.
JSON 하나만:
{"cause":"최근 하락(또는 부진)의 주요 원인 한 줄","type":"일시 조정|펀더멘털 훼손|판단 보류","type_note":"그렇게 본 근거 한 줄","more_downside":"추가 하락 위험과 가격대 한 줄","options":[{"name":"추가 매수","pros":"20자","cons":"20자"},{"name":"보유","pros":"20자","cons":"20자"},{"name":"손절","pros":"20자","cons":"20자"}],"decision":"보유|추가 매수|일부 매도|전량 손절","plan":"구체 대응: 손절가·분할 기준 등 50자"}`, { label: "보유 종목 점검" })).data;
    let warn = "";
    if (ruleHit && !/손절|매도/.test(d.decision || "")) warn = `<div class="alert">매매규칙상 손절 대상이에요 (${acct != null && acct <= -risk ? `계좌 손실 ${acct.toFixed(2)}% · 허용 ${risk}% 초과` : `현재가가 손절가 ${f2(P.stop)} 아래`}). AI 의견보다 규칙이 우선이에요.</div>`;
    if (/추가/.test(d.decision || "") && gateOk === false) warn += `<div class="alert">추세 게이트 탈락 상태의 추가 매수는 물타기예요. 규칙상 하지 않아요.</div>`;
    $("hOut").innerHTML = `<div class="rc">${warn}
      <div class="dec"><b>${esc(d.decision)}</b><span class="tag2 ${d.type === "일시 조정" ? "g" : d.type === "펀더멘털 훼손" ? "r" : "y"}">${esc(d.type)}</span><span class="tag2">손익 ${(pnl * 100).toFixed(1)}%${acct != null ? ` · 계좌 ${acct.toFixed(2)}%` : ""}</span></div>
      <div>${esc(d.plan)}</div>
      <h4>하락 원인</h4><div>${esc(d.cause)} <small style="color:#5b6b66">· ${esc(d.type_note)}</small></div>
      <h4>추가 하락 위험</h4><div>${esc(d.more_downside)}</div>
      <h4>선택지 비교</h4><div class="opts">${(d.options || []).map(o => `<div class="opt ${(d.decision || "").includes(o.name) || (o.name === "손절" && /손절|매도/.test(d.decision || "")) ? "pick" : ""}"><b>${esc(o.name)}</b> · <span style="color:#1d9a64">${esc(o.pros)}</span> / <span style="color:#d9472f">${esc(o.cons)}</span></div>`).join("")}</div></div>`;
  } catch (e) { $("hOut").innerHTML = errHTML(e); }
}));

// ── 3. 뉴스 수혜주 ───────────────────────────────────────
function renderNews(d) {
  if (!d) { $("nOut").innerHTML = ""; return; }
  $("nOut").innerHTML = `<div class="rc"><h4>이슈 핵심</h4><div>${esc(d.summary)}</div>
      <h4>시장 영향</h4><div>${esc(d.impact)}</div>
      <h4>수혜 분야</h4><div>${(d.sectors || []).map(x => `<span class="tag2" style="margin:2px 4px 2px 0">${esc(x)}</span>`).join("")}</div></div>
    ${(d.picks || []).slice(0, 5).map((p, i) => `<button type="button" class="np" data-t="${esc(p.ticker || p.name)}">
      <span class="rk">${i + 1}</span>
      <span><b>${esc(p.name)}</b> <small>${esc(p.ticker || "")} · ${esc(p.market || "")}</small><br><small>${esc(p.reason)}</small><br>
        <span class="tag2 ${tagCls(p.priced_in || "")}">${esc(p.priced_in)}</span> <span class="tag2">수혜 ${esc(p.size)}</span> <span class="tag2">${esc(p.fact_or_view)}</span></span>
      <span class="st">${"★".repeat(clamp(num(p.stars) || 1, 1, 3))}<br><small>분석 ›</small></span></button>`).join("")}
    <p style="font-size:12px;color:var(--lime);opacity:.7;margin-top:10px">종목을 누르면 위원회 분석으로 넘어가요. 관련 있다는 이유만으로 사지 말고, 이미 반영 여부를 꼭 확인하세요.</p>`;
}
$("nf").addEventListener("submit", e => { e.preventDefault(); lock($("nGo"), async () => {
  const q = $("nText").value.trim(); if (!q) return;
  $("nStatus").textContent = "최신 뉴스와 공시를 검색해 수혜주를 찾는 중…"; $("nOut").innerHTML = "";
  try {
    const d = (await A.gemini(`오늘은 ${A.today()}. 너는 글로벌 IB의 주식 애널리스트이자 산업 분석 전문가다.
다음 뉴스·이슈를 구글 검색으로 최신 뉴스와 기업 공시를 확인해 분석하고, 수혜 가능성이 높은 국내외 종목 TOP 5를 매력도 순으로 골라라.
관련 있다는 이유만으로 추천하지 말고 실제 매출·이익 개선 가능성 중심으로. 확인된 사실과 전망을 구분하라. 이미 주가에 반영됐는지 판단하라(최근 1~3개월 주가 흐름 참고). 스윙(수일~수개월) 관점. 한국어.
이슈: "${q.replace(/"/g, "'")}"
설명 없이 JSON 하나만:
{"summary":"뉴스 핵심 2문장","impact":"시장 영향 한 줄","sectors":["수혜 분야1","2","3"],"picks":[{"name":"회사명","ticker":"티커(한국은 6자리 코드)","market":"미국|한국","reason":"수혜 근거(40자)","size":"크다|중간|작다","priced_in":"미반영|일부 반영|이미 반영","stars":1|2|3,"fact_or_view":"확인된 사실|전망"}]}`, { search: true, label: "수혜주 찾기" })).data;
    store.set("aic-news", { q, d, at: Date.now() }); renderNews(d);
    $("nStatus").textContent = `완료 · ${new Date().toLocaleString("ko-KR")}`;
  } catch (e) { $("nStatus").textContent = ""; $("nOut").innerHTML = errHTML(e); }
}); });
$("nOut").addEventListener("click", e => { const b = e.target.closest(".np"); if (!b || A.busy) return; tab("ana"); window.scrollTo({ top: 0, behavior: "smooth" }); A.convene(b.dataset.t); });
{ const n = store.get("aic-news", null); if (n) { $("nText").value = n.q; renderNews(n.d); $("nStatus").textContent = `지난 검색 · ${new Date(n.at).toLocaleString("ko-KR")}`; } }

// ── 4. 내 포트폴리오 ────────────────────────────────────
const COLORS = ["#e25b4b", "#f0a033", "#6a4fd8", "#3a6fd1"], CASH = "#f5d35b";
let pf = store.get("aic-pf", [{ t: "", w: "" }]), pfView = "now";
const opt = () => store.get("aic-pfopt", null);
function pfRowsHTML() {
  $("pfRows").innerHTML = pf.map((h, i) => `<div class="pr"><input data-i="${i}" data-k="t" value="${esc(h.t)}" placeholder="종목 ${i + 1} (예: TSLA)"><input data-i="${i}" data-k="w" value="${esc(h.w)}" inputmode="decimal" placeholder="비중 %"><button type="button" class="x" data-del="${i}">×</button></div>`).join("");
  $("pfAdd").style.display = pf.length >= 4 ? "none" : "";
}
$("pfRows").addEventListener("input", e => { const t = e.target; if (t.dataset.i != null) pf[+t.dataset.i][t.dataset.k] = t.value; });
$("pfRows").addEventListener("click", e => { const d = e.target.dataset.del; if (d != null) { pf.splice(+d, 1); if (!pf.length) pf.push({ t: "", w: "" }); pfRowsHTML(); } });
$("pfAdd").addEventListener("click", () => { if (pf.length < 4) { pf.push({ t: "", w: "" }); pfRowsHTML(); } });
$("pfSave").addEventListener("click", () => {
  pf = pf.filter(h => h.t.trim()).map(h => ({ t: h.t.trim(), w: clamp(num(h.w) || 0, 0, 100) }));
  const sum = pf.reduce((a, h) => a + h.w, 0);
  if (sum > 100) { $("pfStatus").textContent = `비중 합계가 ${sum}%예요. 100% 이하로 맞춰 주세요.`; return; }
  if (!pf.length) pf = [{ t: "", w: "" }];
  store.set("aic-pf", pf); store.set("aic-pfopt", null); pfView = "now"; $("pfEdit").open = false; $("pfStatus").textContent = "저장했어요."; renderPF();
});
const holdings = () => pf.filter(h => String(h.t).trim() && num(h.w) > 0);

function signalOf(t, o) {
  const k = String(t).toLowerCase(), x = A.hist().find(h => [h.tk, h.S?.F?.ticker, h.S?.F?.name].some(v => String(v || "").toLowerCase() === k));
  if (x?.verdict) return x.verdict.band[1] === "buy" ? ["사자", "b"] : x.verdict.band[1] === "out" ? ["팔자", "s"] : ["중립", ""];
  const s = o?.holdings?.find(h => String(h.ticker || "").toLowerCase() === k || String(h.input || "").toLowerCase() === k)?.signal;
  return s ? [s, s === "사자" ? "b" : s === "팔자" ? "s" : ""] : null;
}
function renderPF() {
  pfRowsHTML();
  const H = holdings(), o = opt(), sum = H.reduce((a, h) => a + num(h.w), 0), cash = Math.max(0, 100 - sum);
  const sugg = t => { const k = String(t).toLowerCase(); const x = o?.holdings?.find(h => String(h.input || h.ticker || "").toLowerCase() === k); return x ? num(x.suggest_pct) : null; };
  const showSug = pfView === "sug" && o;
  const items = H.map((h, i) => ({ name: o?.holdings?.find(x => String(x.input || "").toLowerCase() === h.t.toLowerCase())?.name || h.t, t: h.t, now: num(h.w), sug: sugg(h.t), c: COLORS[i % 4] }));
  const cashSug = o ? num(o.cash_suggest_pct) : null;
  const seg = [...items.map(x => ({ v: showSug ? (x.sug ?? x.now) : x.now, c: x.c })), { v: showSug ? (cashSug ?? cash) : cash, c: CASH }];
  let acc = 0; const C = 2 * Math.PI * 42;
  const arcs = seg.filter(s => s.v > 0).map(s => { const len = s.v / 100 * C, el = `<circle r="42" cx="50" cy="50" fill="none" stroke="${s.c}" stroke-width="14" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}"/>`; acc += len; return el; }).join("");
  const delta = (sug, now) => sug == null ? "" : `<span class="d" style="color:${sug - now > 0 ? "#2fbf7f" : sug - now < 0 ? "#ff6f59" : "#9aa4b2"}">${sug - now > 0 ? "+" : ""}${(sug - now).toFixed(0)}%p</span>`;
  const row = (x, isCash) => { const sig = isCash ? null : signalOf(x.t, o); const v = showSug ? (x.sug ?? x.now) : x.now;
    return `<div class="pi ${isCash ? "cash" : ""}"><span class="lg" style="background:${isCash ? CASH : x.c};color:${isCash ? "#1a1400" : "#fff"}">${isCash ? "₩" : esc(String(x.name).slice(0, 1).toUpperCase())}</span>
      <div><div class="nm2">${esc(x.name)}${sig ? `<span class="sg ${sig[1]}">${esc(sig[0])}</span>` : ""}</div><div class="pb"><i style="width:${clamp(v, 0, 100)}%;background:${isCash ? CASH : x.c}"></i></div></div>
      <span class="w">${f2(v)}%</span>${o ? delta(isCash ? cashSug : x.sug, x.now) : "<span></span>"}</div>`; };
  $("pfCard").innerHTML = H.length ? `<div class="pfh"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>&nbsp;내 포트폴리오
      ${o ? `<span class="sw"><button type="button" data-v="now" class="${pfView === "now" ? "on" : ""}">현재</button><button type="button" data-v="sug" class="${pfView === "sug" ? "on" : ""}">제안</button></span>` : ""}</div>
    <div class="pfb2"><div class="donut"><svg viewBox="0 0 100 100"><circle r="42" cx="50" cy="50" fill="none" stroke="#1d232c" stroke-width="14"/>${arcs}</svg>
      <div class="c"><div><small>현금</small><b>${f2(showSug ? (cashSug ?? cash) : cash)}%</b></div></div></div>
      <div class="pl">${items.map(x => row(x)).join("")}${row({ name: "현금", now: cash, sug: cashSug }, true)}</div></div>`
    : `<div class="pfh"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>&nbsp;내 포트폴리오</div><div style="padding:28px 18px;color:#9aa4b2">아래 "보유 종목 편집"에서 종목과 비중을 넣어 주세요. 최대 4종목, 나머지는 현금으로 계산돼요.</div>`;
  if (!H.length) $("pfEdit").open = true;
  $("pfGo").style.display = H.length ? "" : "none";
  renderPFOut(o);
}
$("pfCard").addEventListener("click", e => { const b = e.target.closest(".sw button"); if (b) { pfView = b.dataset.v; renderPF(); } });
function renderPFOut(o) {
  if (!o) { $("pfOut").innerHTML = ""; return; }
  $("pfOut").innerHTML = `<div class="rc" style="margin-top:14px">
    <h4>리밸런싱 전략</h4><div>${esc(o.strategy)}</div>
    <h4>종목별 판단</h4><div class="opts">${(o.holdings || []).map(h => `<div class="opt"><b>${esc(h.name || h.ticker)}</b> <span class="tag2 ${tagCls(h.signal || "")}">${esc(h.signal)}</span> ${f2(num(h.current_pct))}% → <b>${f2(num(h.suggest_pct))}%</b><br><small style="color:#5b6b66">${esc(h.sector || "")} · ${esc(h.reason)}</small></div>`).join("")}</div>
    <h4>업종 쏠림</h4><div>${esc(o.concentration)}</div>
    <h4>종목 간 상관관계</h4><div>${esc(o.correlation)}</div>
    <h4>주요 위험</h4><ul>${(o.risks || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>
    <h4>예상 변동성</h4><div>${esc(o.volatility)}</div>
    <p style="font-size:12px;color:#5b6b66;margin:10px 0 0">${esc(new Date(o.at).toLocaleString("ko-KR"))} 기준 · 종목 배지는 위원회 분석 결과가 있으면 그걸, 없으면 이 점검 결과를 써요.</p></div>`;
}
$("pfGo").addEventListener("click", () => lock($("pfGo"), async () => {
  const H = holdings(); if (!H.length) return;
  const sum = H.reduce((a, h) => a + num(h.w), 0), cap = num(A.cfg.maxPos) ?? 30;
  $("pfStatus").textContent = "장 흐름과 보유 종목 최신 데이터를 확인하는 중…";
  try {
    let M = null; try { M = await A.getMarket(); } catch (e) {}
    const past = H.map(h => { const k = h.t.toLowerCase(), x = A.hist().find(y => [y.tk, y.S?.F?.ticker, y.S?.F?.name].some(v => String(v || "").toLowerCase() === k)); return x?.verdict ? `${h.t}: 위원회 ${x.verdict.score}점 ${x.verdict.band[0]}` : null; }).filter(Boolean);
    $("pfStatus").textContent = "포트폴리오 점검 중…";
    const d = (await A.gemini(`오늘은 ${A.today()}. 너는 글로벌 자산운용사의 포트폴리오 매니저이자 투자 전략가다. 사용자의 주식 포트폴리오를 수익성과 위험을 함께 고려해 점검하고 최적 비중을 제안하라.
구글 검색으로 각 종목의 최신 주가 흐름·실적·뉴스를 확인하라. 수익률뿐 아니라 손실 위험과 분산 효과를 함께 고려하라. 한국어, 짧게.
${RULES()}
장 흐름: 미국 ${M?.regime_us || "미상"}, 한국 ${M?.regime_kr || "미상"} (상승장: 정상 매매 최대 4종목 / 횡보장: 주식 합계 50% 이하·최대 2종목 / 하락장: 신규 매수 중지·현금 확대). VIX ${M?.vix ?? "미상"}.
현재 보유: ${H.map(h => `${h.t} ${num(h.w)}%`).join(", ")}, 현금 ${100 - sum}%
${past.length ? "위원회 최근 분석: " + past.join(" / ") : ""}
규칙: 제안 비중은 종목당 ${cap}% 이하, 주식+현금 합계 100%. 매수 근거가 약하거나 추세가 꺾인 종목은 줄이고, 업종이 겹치면 한쪽을 줄여라.
설명 없이 JSON 하나만:
{"holdings":[{"input":"사용자가 입력한 그대로","ticker":"티커","name":"회사명(짧게)","sector":"업종","signal":"사자|중립|팔자","current_pct":숫자,"suggest_pct":숫자,"reason":"비중 조정 이유(30자)"}],"cash_suggest_pct":숫자,"concentration":"업종 쏠림 평가 한 줄","correlation":"종목 간 상관관계·분산 수준 한 줄","risks":["주요 위험1(30자)","2"],"volatility":"예상 변동성 한 줄","strategy":"개선된 포트폴리오와 리밸런싱 순서 2문장"}`, { search: true, label: "포트폴리오 점검" })).data;
    // 코드로 규칙 보정: 종목당 상한, 합계 100%
    let tot = 0;
    for (const h of d.holdings || []) { h.suggest_pct = clamp(Math.round(num(h.suggest_pct) ?? num(h.current_pct) ?? 0), 0, cap); tot += h.suggest_pct; }
    if (tot > 100) { const k = 100 / tot; tot = 0; for (const h of d.holdings) { h.suggest_pct = Math.floor(h.suggest_pct * k); tot += h.suggest_pct; } }
    d.cash_suggest_pct = 100 - tot; d.at = Date.now();
    for (const h of d.holdings || []) if (!h.input) h.input = h.ticker;
    store.set("aic-pfopt", d); pfView = "sug"; renderPF();
    $("pfStatus").textContent = "완료 · 차트 위 [현재]/[제안]으로 바꿔 볼 수 있어요.";
  } catch (e) { $("pfStatus").textContent = ""; $("pfOut").innerHTML = errHTML(e); }
}));
renderPF();
}
