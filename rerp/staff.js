// kr_ext_rerp `lib/staff.js` 를 그대로 옮긴 것 — IIFE 머리와 꼬리의 `g.KRX_STAFF = …` 를 export 로만 바꿨다(load/save 의 chrome.storage 는 그대로 — 여기서는 쓰지 않는다). 출처·갱신 규칙은 rerp/README.md.
/* 참여연구원 참여율·지급액 계산 (사업비 › 사업비 변경 메뉴의 머리 — 0.8.7, 2026-10-18). eClass 콘텐츠스크립트 / 팝업 / 테스트 공용, 순수 함수(DOM·chrome 없음 — load/save 만 storage).
 * 계획은 **과제마다 연차별로** 하나(2026-10-18 사용자 지정 "우선 각 과제별로 년차별로 수정할 수 있게") — 키 "과제번호@연차", 연차의 달 범위는 R&D ERP 가 주는 현재 연차 기간에서 셈한다(yearSpan).
 * KRS WORKSPACE(kr_ext_workspace)의 R&D 탭 참여인력 칸에서 하던 계산을 이쪽으로 옮긴 것이다(2026-10-18 사용자 지정: "참여연구원 계산하는거 관련해서는 kr_ext_rerp 로 넘기고 …
 * 참여연구원 참여율 및 지급액 월별 나누고 최대/전체 산정하는 기능들을 이관"). WORKSPACE 는 이 파일을 rerp/staff.js 로 그대로 옮겨(IIFE → export) rERP 에 등록된 값을 보이기만 한다.
 *
 * 규칙(rERP 인건비지급계획 팝업 실측 — kr_ext_workspace rerp/reference.md):
 *  - 관리 대상은 **월별 지급금액**(plan — 달마다 원)이다. 참여율은 100% 가 찼는지 보는 확인값: 연간 = Σ월별 ÷ (월급여 × 참여개월), 월 = 그 달 지급 ÷ 월급여.
 *    둘 다 rERP 가 보이는 올림(퍼센트 넷째 자리 반올림 뒤 셋째 자리 올림 — rtask_0013_12.js PAY_LIMT_AMT_change)으로 적는다. 월 최대 참여율은 연간과 같아도 늘 보인다.
 *  - 월급여 = rERP 참여인력의 지급한도액(PAY_LIMT_AMT). 직접 적은 값(manual)이 있으면 그것이 앞선다. 계획서 급여총액(salary)이 있으면 ÷12 천원 절삭이 대신이다(WORKSPACE 가 넣는 값).
 *  - 변경은 **적용월부터**(종료월까지) — 그 앞 달의 지급은 그대로. 0%(제외)·참여율·월 지급금액 가운데 하나로. 사람 더하기도 같은 길.
 *  - 같은 사람의 과제 참여율 합이 100% 를 넘으면 **알림만**(막지 않는다). rERP 의 다른 과제 월별 합(rtask_0013_12_r003 ETC_PART_RT)을 쓴다.
 *  - 참여자가 없는 기간은 **이전 기간 참여연구원의 지급 비율**로 인건비 예산을 나눠 초기화한다(합이 정확히 예산). 합이 예산을 넘는 편집은 막는다(overBudget — 줄이는 쪽은 둔다).
 *  - 균등 분할은 앞달 ceil천원(총 ÷ N)·마지막 달 잔액 — rERP 자료생성이 저장하는 행(1,165,000×8 + 1,159,000)과 같다.
 *
 * 저장(storage.local.staffPlans) = { ["과제번호@연차"]: plan }  plan = { prjNo, year(연차 1~), prjNm, from, to('YYYY-MM' — 계획 기간), budgetPay(인건비 예산 원 | null), basis('rerp'|'plan'), src('erp'|'init'|'manual'),
 *   (연차를 두기 전(0.8.7 처음) 저장분은 키가 과제번호뿐이고 year 가 없다 — lib/staff-ui.js adopt 가 그 과제의 현재 연차 계획으로 옮긴다)
 *   people[{ id, name, role, salary, pay, rate, months, manual, erp: { monthly, prjNo, at, req, seq, others[{ ym, rate, amt }] } | null, plan[{ ym, amt }] }], at(마지막 수정 시각), by(누가), note }
 *   지운 연차 계획은 staffPlansDeleted 묘비(remove). 공유 (Plus) 가 켜져 있으면 백그라운드(background.js shareSync)가 과제 폴더의 연차 파일(<n>차년도.json 의 staff·budget 칸, SharePoint 폴더)과 연차별로 맞춘다(lib/staff-sync.js merge — at 이 큰 쪽이 이김)
 * 단위: 저장은 원, 화면·글은 천원. 달은 'YYYY-MM'. 렌더러(lib/staff-ui.js)가 이 API 로 표와 폼을 그린다 */
const KEY = 'staffPlans';
const DKEY = 'staffPlansDeleted';   // 지운 연차 계획의 묘비 { ["과제번호@연차"]: 지운 시각 } — 공유 (Plus) 의 병합(lib/staff-sync.js merge)이 삭제를 전파하는 데 씀. 90일 지나면 버림
const TOMB_TTL = 90 * 24 * 3600 * 1000;
const STAFF_MAX = 30;
const BASES = Object.freeze(['plan', 'rerp']);
const BASIS_LABEL = Object.freeze({ plan: '계획서 연봉', rerp: 'rERP 연봉' });
const SOURCES = Object.freeze(['erp', 'init', 'manual', 'yaml', 'roster']);
const MODES = Object.freeze(['rate', 'amt', 'exclude']);
const PLAN_MAX = 240;
const YEAR_MAX = 60;   // 연차 번호 상한
const BUDGET_ITEMS = Object.freeze(['인건비', '연구시설·장비비', '연구재료비', '연구활동비', '연구수당', '간접비']);   // 예산 칸의 기본 비목 (연구개발계획서의 여섯 비목 — kr_ext_workspace src/rnd.js BUDGET_ITEMS 와 같음)
const BUDGET_MAX = 30;

const text = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v) => { if (v === '' || v == null) return null; const n = Number(typeof v === 'string' ? v.replace(/[,\s%]/g, '') : v); return Number.isFinite(n) ? n : null; };
/* 원 — 0 이상의 정수. 글이면 쉼표·원을 걷는다. 못 읽으면 null */
const money = (v) => { if (typeof v === 'string') v = v.replace(/[,\s원₩]/g, ''); if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };
const int = (v, lo, hi) => { const n = num(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const pad2 = (n) => String(n).padStart(2, '0');
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nameKeyOf = (s) => String(s == null ? '' : s).replace(/\s/g, '');
const sameName = (a, b) => !!nameKeyOf(a) && nameKeyOf(a) === nameKeyOf(b);
const comma = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : '');
/* 원 → 천원 글 "10,479" */
const thousand = (n) => (Number.isFinite(n) ? comma(Math.round(n / 1000)) : '');
/* 천원 칸의 글 → 원(숫자만 적으면 천원). 못 읽으면 null */
const thousandOf = (v) => { const n = money(v); return n == null ? null : n * 1000; };

/* ---------- 달 ---------- */
const isYm = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
/* 'YYYY-MM-DD' / yyyyMMdd / yyyyMM → 'YYYY-MM'. 아니면 '' */
const ymOf = (s) => { const d = String(s == null ? '' : s).replace(/\D/g, ''); return d.length >= 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}` : ''; };
function addMonths(ym, k) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`;
}
/* from 부터 to 까지의 달(둘 다 포함). 거꾸로면 빈 목록. 240달 한도 */
function ymRange(from, to) {
  if (!isYm(from) || !isYm(to) || to < from) return [];
  const out = [];
  for (let ym = from; ym <= to && out.length < PLAN_MAX; ym = addMonths(ym, 1)) out.push(ym);
  return out;
}
/* 기간({ start|from, end|to } — 날짜나 달)의 달들. 없으면 빈 목록 */
const spanMonths = (span) => ymRange(ymOf(span && (span.from || span.start)), ymOf(span && (span.to || span.end)));
/* '2026-04'~'2026-12' → "4~12월", 해가 다르면 "'26.4~'27.3월", 한 달이면 "12월" */
function ymText(from, to) {
  if (!isYm(from)) return '';
  const m = (ym) => String(Number(ym.slice(5)));
  const yy = (ym) => `'${ym.slice(2, 4)}.`;
  if (!isYm(to) || to === from) return `${m(from)}월`;
  return from.slice(0, 4) === to.slice(0, 4) ? `${m(from)}~${m(to)}월` : `${yy(from)}${m(from)}~${yy(to)}${m(to)}월`;
}
/* 달 이름 — "4월". 앞 달과 해가 다르면 "'27 1월" */
const monthLabel = (ym, prev = '') => `${prev && prev.slice(0, 4) !== ym.slice(0, 4) ? `'${ym.slice(2, 4)} ` : ''}${Number(ym.slice(5))}월`;

/* ---------- 예산 칸 (연차마다 비목별 계획 — 0.8.7 사업비 변경 화면, kr_ext_workspace R&D 탭의 예산 칸과 같은 꼴) ---------- */
/* 비목 이름 맞추기 — 띄어쓰기·가운뎃점·마침표 무시 */
const itemKeyOf = (s) => String(s == null ? '' : s).replace(/[\s·.]/g, '').toLowerCase();
const isPayItem = (s) => /인건비/.test(String(s || '')) && !/수당/.test(String(s || ''));
/* 저장된 예산 줄 [{ name(비목), plan(계획 원 | null) }] — 배열이 아니면 null(= 아직 안 적음, 기본값을 쓴다). 이름도 금액도 없는 줄은 뺀다 */
function normalizeBudget(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const r of raw) {
    if (out.length >= BUDGET_MAX) break;
    const name = text(r && r.name, 40), plan = money(r && r.plan);
    if (!name && plan == null) continue;
    out.push({ name, plan });
  }
  return out;
}
/* 예산 줄들의 인건비(수당 아님) 계획 합 — 없으면 null */
const budgetPayOf = (budget) => { const hit = (Array.isArray(budget) ? budget : []).filter((r) => isPayItem(r.name) && r.plan != null); return hit.length ? hit.reduce((s, r) => s + r.plan, 0) : null; };
/* 예산 줄 요약 글(천원) — "인건비 35,900 · 연구활동비 66,300 · 합 136,000" */
function budgetText(budget) {
  const rows = (Array.isArray(budget) ? budget : []).filter((r) => r.plan != null);
  if (!rows.length) return '';
  return rows.map((r) => `${r.name || '비목'} ${thousand(r.plan)}`).concat([`합 ${thousand(rows.reduce((s, r) => s + r.plan, 0))}`]).join(' · ');
}

/* ---------- 연차 (과제마다 연차별 계획) ---------- */
/* 계획 키 — "과제번호@연차". 연차가 없으면(연차를 두기 전 저장분) 과제번호만 */
const planKey = (prjNo, year) => { const y = int(year, 1, YEAR_MAX); return y ? `${prjNo}@${y}` : String(prjNo == null ? '' : prjNo); };
const yearLabel = (n) => `${n}차년도`;
/* 과제의 현재 연차 번호(R&D ERP 과제 목록의 ANL) — 모르면 1 */
const anlOf = (p) => int(p && p.anl, 1, YEAR_MAX) || 1;
/* n차년도의 달 범위 — R&D ERP 가 주는 현재 연차 기간(RCH_ST_DT~RCH_END_DT)에서 셈한다: 현재 연차는 그대로, 다음 연차는 현재 연차 종료 다음 달부터 12달씩,
 * 앞 연차는 현재 연차 시작 전 달까지 12달씩(첫 연차가 짧았으면 기간 칸에서 고친다). 기간을 모르면 { from: '', to: '' } */
function yearSpan(p, n) {
  const cur = { from: ymOf(p && p.stDt), to: ymOf(p && p.endDt) };
  if (!isYm(cur.from) || !isYm(cur.to) || cur.to < cur.from) return { from: '', to: '' };
  const a = anlOf(p), k = int(n, 1, YEAR_MAX) || a;
  if (k === a) return cur;
  if (k > a) { const from = addMonths(cur.to, 1 + 12 * (k - a - 1)); return { from, to: addMonths(from, 11) }; }
  const to = addMonths(cur.from, -1 - 12 * (a - k - 1));
  return { from: addMonths(to, -11), to };
}
/* 한 과제의 연차별 계획 — { [연차]: plan }. 연차 없는 옛 계획(키가 과제번호만)은 뺀다 */
function plansOfProject(plans, prjNo) {
  const out = {};
  for (const e of Object.values(plans && typeof plans === 'object' ? plans : {})) if (e && e.prjNo === prjNo && e.year >= 1) out[e.year] = e;
  return out;
}

/* ---------- rERP 식 ---------- */
/* 월급여 — 급여총액(원) ÷ 12 를 천원 자리에서 절삭 */
const monthlyOfSalary = (salary) => (Number.isFinite(salary) && salary > 0 ? Math.floor(salary / 12000) * 1000 : null);
/* rERP 가 보이는 계상률 — 지급금액 ÷ 한도(%)를 넷째 자리에서 반올림한 뒤 셋째 자리에서 올림. 한도가 없으면 null */
function rerpRate(amt, limit) {
  if (!(limit > 0) || !(amt >= 0)) return null;
  return Math.ceil(Number(((amt / limit) * 10000).toFixed(1))) / 100;
}
/* 그 참여율의 월 지급금액 — round천원(월급여 × %) */
const amountOfRate = (monthly, rate) => (monthly > 0 && rate >= 0 ? Math.round((monthly * rate) / 100 / 1000) * 1000 : 0);
/* 총액을 개월에 — 앞달은 ceil천원(총 ÷ N), 마지막 달은 잔액. 합은 총액과 정확히 같다 */
function splitEven(total, n) {
  if (!(n >= 1) || !(total >= 0)) return [];
  if (n === 1) return [Math.round(total)];
  let head = Math.ceil(total / n / 1000) * 1000;
  if (head * (n - 1) > total) head = Math.floor(total / n / 1000) * 1000;
  return [...Array(n - 1).fill(head), Math.round(total - head * (n - 1))];
}

/* ---------- 모양 ---------- */
function normalizePlan(raw) {
  const map = new Map();
  for (const x of Array.isArray(raw) ? raw : []) {
    const ym = text(x && x.ym, 7);
    const amt = money(x && x.amt);
    if (isYm(ym) && amt != null) map.set(ym, amt);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, PLAN_MAX).map(([ym, amt]) => ({ ym, amt }));
}
function normalizeErp(raw) {
  const monthly = money(raw && raw.monthly);
  if (!raw || typeof raw !== 'object' || !(monthly > 0)) return null;
  const others = (Array.isArray(raw.others) ? raw.others : []).map((o) => ({ ym: text(o && o.ym, 7), rate: num(o && o.rate) ?? 0, amt: money(o && o.amt) ?? 0 })).filter((o) => isYm(o.ym)).slice(0, PLAN_MAX);
  return { monthly, prjNo: text(raw.prjNo, 40), at: num(raw.at) ?? 0, req: text(raw.req, 10), seq: text(raw.seq, 10), others };
}
/* 참여연구원 한 사람 — name·role, 계획서 값(salary 급여총액·pay 계상인건비·rate 계상률·months 참여개월 — 참고), manual(직접 적은 월급여, 기준보다 앞선다),
 * erp(rERP 에서 받은 월급여·신청 번호·다른 과제 월별 참여율), plan(월별 지급금액 — 관리 대상). 모두 원 */
function normalizePerson(raw) {
  raw = raw || {};
  const manual = money(raw.manual);
  const rate = num(raw.rate);
  return {
    id: text(raw.id, 40) || newId(), name: text(raw.name, 40), role: text(raw.role, 40),
    salary: money(raw.salary), pay: money(raw.pay), rate: rate != null && rate >= 0 && rate <= 100 ? rate : null, months: int(raw.months, 1, PLAN_MAX),
    manual: manual > 0 ? manual : null, erp: normalizeErp(raw.erp), plan: normalizePlan(raw.plan),
  };
}
/* 사람들 묶음 — { basis, src, people }. 이름 없는 사람은 버린다. 없거나 비었으면 null */
function normalizeStaff(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const seen = new Set();
  const people = [];
  for (const p of Array.isArray(raw.people) ? raw.people : []) {
    if (people.length >= STAFF_MAX) break;
    const q = normalizePerson(p);
    const k = nameKeyOf(q.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    people.push(q);
  }
  if (!people.length) return null;
  return { basis: BASES.includes(raw.basis) ? raw.basis : 'rerp', src: SOURCES.includes(raw.src) ? raw.src : 'erp', people };
}

/* ---------- 월급여·형편 ---------- */
/* 계획서 기준 월급여 — 급여총액이 있으면 ÷12 절삭, 없으면 계상인건비 ÷ 개월 ÷ 계상률로 되짚은 값(천원 반올림). 없으면 null */
function planMonthly(person) {
  const m = monthlyOfSalary(person.salary);
  if (m) return m;
  if (person.pay > 0 && person.months > 0 && person.rate > 0) return Math.round(person.pay / person.months / (person.rate / 100) / 1000) * 1000;
  return null;
}
/* 이 사람의 월급여와 어디서 왔는지 — manual > (기준이 rerp 면) rERP > 계획서 > (계획서 값이 없으면) rERP. { amt, src: 'manual'|'rerp'|'plan'|'none', fallback } */
function monthlyPay(person, basis) {
  if (person.manual > 0) return { amt: person.manual, src: 'manual', fallback: false };
  if (basis === 'rerp' && person.erp && person.erp.monthly > 0) return { amt: person.erp.monthly, src: 'rerp', fallback: false };
  const plan = planMonthly(person);
  if (plan) return { amt: plan, src: 'plan', fallback: basis === 'rerp' };
  if (person.erp && person.erp.monthly > 0) return { amt: person.erp.monthly, src: 'rerp', fallback: false };
  return { amt: null, src: 'none', fallback: false };
}
/* 한 사람의 형편 — total(Σ월별, 월별이 없으면 계획서 계상인건비) · months(지급이 있는 달 수) · from·to · rate(연간) · maxRate·maxYm(월 최대) · limit(월급여)·src · rates(달마다) · planned */
function personStats(person, basis) {
  const limit = monthlyPay(person, basis);
  const planned = person.plan.length > 0;
  const active = person.plan.filter((x) => x.amt > 0);
  const total = planned ? person.plan.reduce((s, x) => s + x.amt, 0) : (person.pay == null ? 0 : person.pay);
  const months = planned ? active.length : (person.months == null ? 0 : person.months);
  const cap = limit.amt > 0 && months > 0 ? limit.amt * months : 0;
  const rates = planned ? person.plan.map((x) => ({ ym: x.ym, amt: x.amt, rate: limit.amt > 0 ? rerpRate(x.amt, limit.amt) : null })) : [];
  let maxRate = null, maxYm = '';
  for (const r of rates) if (r.rate != null && (maxRate == null || r.rate > maxRate)) { maxRate = r.rate; maxYm = r.ym; }
  const last = active[active.length - 1];
  return { total, months, from: active[0] ? active[0].ym : '', to: last ? last.ym : '', rate: cap > 0 ? rerpRate(total, cap) : null, maxRate, maxYm, limit: limit.amt, src: limit.src, fallback: limit.fallback, rates, planned };
}
const staffTotal = (staff, basis) => ((staff && staff.people) || []).reduce((s, p) => s + personStats(p, basis).total, 0);
/* 인건비 예산(원)과 견준다 — 예산을 모르면 over 는 false */
function overBudget(staff, basis, budgetPay) {
  const total = staffTotal(staff, basis);
  return { total, budget: budgetPay == null ? null : budgetPay, over: budgetPay != null && total > budgetPay, left: budgetPay != null ? budgetPay - total : null };
}
const rateText = (r) => (r == null ? '' : `${r.toFixed(2)}%`);
/* 형편 한 줄(변경이력의 전·후): "20.00% · 10,479천원 · 4~12월". 없으면 "(없음)" */
function statsText(s) {
  if (!s || (!s.total && !s.months)) return '(없음)';
  return [rateText(s.rate) || '참여율 —', `${thousand(s.total)}천원`, s.from ? ymText(s.from, s.to) : s.months ? `${s.months}개월` : ''].filter(Boolean).join(' · ');
}
/* 월별 지급을 짧게 — 같은 금액이 이어지는 달을 묶어 "4~11월 1,165 · 12월 1,159"(천원). 0원 달은 "제외" */
function monthlyText(plan) {
  const runs = [];
  for (const x of plan) {
    const last = runs[runs.length - 1];
    if (last && last.amt === x.amt && addMonths(last.to, 1) === x.ym) last.to = x.ym;
    else runs.push({ from: x.ym, to: x.ym, amt: x.amt });
  }
  return runs.map((r) => `${ymText(r.from, r.to)} ${r.amt > 0 ? thousand(r.amt) : '제외'}`).join(' · ');
}

/* ---------- rERP 참여인력 행 → 사람 ---------- */
/* 참여인력 조회(rtask_0008_t03_01_r001)의 INFO_REC 한 행 → { name, role, limit(지급한도액 원), amt(월 지급), rate(계상률 표시값), from, to('YYYY-MM' 지급기간), count(달 수), req, seq, excluded, term }.
 * 주민번호·계좌·연락처 같은 칸은 읽지 않는다. 이름 없는 행은 뺀다 */
function rowsOfErp(rec) {
  const yn = (v) => /^(y|1|true|예|제외)/i.test(String(v == null ? '' : v).trim());
  return (Array.isArray(rec) ? rec : []).map((r) => (r && typeof r === 'object' ? {
    name: text(r.EMP_NM, 40), role: text(r.ROLE_NM, 40), limit: num(r.PAY_LIMT_AMT), amt: num(r.PAY_AMT), rate: num(r.PART_RT),
    from: ymOf(r.PLAN_YM_FROM), to: ymOf(r.PLAN_YM_TO), count: num(r.NCNT), req: text(r.REQ_CNT, 10), seq: text(r.SEQ_NO, 10),
    excluded: yn(r.PARTRATE_YN), term: text(r.PART_TRM_DT_DTL || r.PART_TRM_DT, 40),
  } : null)).filter((r) => r && r.name);
}
/* 행들을 사람마다 하나로 — 월급여(monthly)는 지급한도액이 있는 행 가운데 시작월이 늦은 것, total 은 Σ 월 지급 × 달 수, 신청 번호(req·seq)는 그 행의 것, ranges 는 지급기간들 */
function byName(rows) {
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = nameKeyOf(r.name);
    if (!k) continue;
    const hit = (out[k] = out[k] || { name: r.name, role: r.role || '', monthly: null, total: 0, req: '', seq: '', from: '', to: '', pick: '', ranges: [] });
    hit.ranges.push(r);
    hit.total += (r.amt || 0) * (r.count || 0);
    if (!hit.role && r.role) hit.role = r.role;
    if (!hit.from || (r.from && r.from < hit.from)) hit.from = r.from;
    if (r.to > hit.to) hit.to = r.to;
    if (r.limit > 0 && (!hit.monthly || r.from >= hit.pick)) { hit.monthly = r.limit; hit.pick = r.from; hit.req = r.req; hit.seq = r.seq; }
  }
  for (const h of Object.values(out)) delete h.pick;
  return out;
}
/* rERP 행들 → 사람들(지급기간을 달마다 펼친 월별 지급·월급여) — { basis: 'rerp', src: 'erp', people }. months 를 주면 그 달들만(계획 기간). 행이 없으면 null */
function peopleOfErp(rows, { prjNo = '', now = Date.now(), months = null } = {}) {
  const people = [];
  for (const h of Object.values(byName(rows))) {
    const map = new Map();
    for (const r of h.ranges) {
      for (const ym of ymRange(r.from, r.to || r.from)) if (!months || months.includes(ym)) map.set(ym, (map.get(ym) || 0) + (r.amt || 0));
    }
    const plan = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ym, amt]) => ({ ym, amt }));
    if (months && !plan.length) continue;
    people.push(normalizePerson({ name: h.name, role: h.role, erp: h.monthly > 0 ? { monthly: h.monthly, prjNo, at: now, req: h.req, seq: h.seq, others: [] } : null, plan }));
  }
  return people.length ? { basis: 'rerp', src: 'erp', people } : null;
}
/* 다른 과제 월별 참여율 조회(rtask_0013_12_r003)의 응답 → { std, rows[{ ym, rate, amt }] }. 주민번호 칸은 버린다 */
function othersOfErp(data) {
  const rows = (Array.isArray(data && data.REC) ? data.REC : []).map((r) => ({ ym: ymOf(r && r.PLAN_YM), rate: num(r && r.ETC_PART_RT) || 0, amt: num(r && r.ETC_PAY_AMT) || 0 })).filter((r) => r.ym);
  return { std: num(data && data.STD_AMT) || null, rows };
}
/* 초기화 재료 — rERP 행들에서 사람마다 지급 합·월급여(months 를 주면 그 달들의 지급만) */
function sharesOfErp(rows, { prjNo = '', now = Date.now(), months = null } = {}) {
  const staff = peopleOfErp(rows, { prjNo, now, months });
  return staff ? sharesOfStaff(staff) : [];
}

/* ---------- 만들기 ---------- */
function initialPlan(q, months) {
  const n = q.months > 0 && q.months <= months.length ? q.months : months.length;
  if (!n || q.pay == null || !(q.pay >= 0)) return [];
  const amts = splitEven(q.pay, n);
  return months.slice(0, n).map((ym, i) => ({ ym, amt: amts[i] }));
}
/* 계획서의 참여연구자(name·role·salary·pay·rate·months, 원)로 — 첫 달부터 참여개월만큼 균등. prev 가 있으면 같은 이름의 id·manual·erp 를 잇고 계획서 값이 그대로면 월별도 그대로 */
function buildStaff(persons, span, prev = null, src = 'yaml') {
  const months = spanMonths(span);
  const seen = new Set();
  const people = [];
  for (const q of Array.isArray(persons) ? persons : []) {
    const name = text(q && q.name, 40);
    const k = nameKeyOf(name);
    if (!k || seen.has(k) || people.length >= STAFF_MAX) continue;
    seen.add(k);
    const old = prev ? prev.people.find((x) => sameName(x.name, name)) || null : null;
    const salary = money(q.salary), pay = money(q.pay), monthsN = int(q.months, 1, PLAN_MAX), rate = num(q.rate);
    const same = !!old && old.salary === salary && old.pay === pay && old.months === monthsN && old.plan.length > 0;
    people.push(normalizePerson({
      id: old ? old.id : undefined, name, role: text(q.role, 40), salary, pay, rate: rate != null && rate >= 0 && rate <= 100 ? rate : null, months: monthsN,
      manual: old ? old.manual : null, erp: old ? old.erp : null, plan: same ? old.plan : initialPlan({ pay, months: monthsN }, months),
    }));
  }
  if (!people.length) return null;
  return { basis: prev ? prev.basis : 'plan', src: SOURCES.includes(src) ? src : 'yaml', people };
}
/* 사람들이 없는 기간을 **이전 사람들의 지급 비율**로 — 인건비 예산(budgetPay, 원)을 total 비율대로(천원 반올림, 잔차는 지급이 가장 큰 사람에게) 나눠 모든 달에 균등.
 * sources: [{ name, role, total, salary?, manual?, erp? }]. rERP 값이 있는 사람이 하나라도 있으면 기준은 rerp. 예산이나 사람이 없으면 null */
function initFromShares(sources, { budgetPay, span }) {
  const months = spanMonths(span);
  const list = [];
  const seen = new Set();
  for (const s of Array.isArray(sources) ? sources : []) {
    const name = text(s && s.name, 40);
    const k = nameKeyOf(name);
    if (!k || seen.has(k) || !(s.total > 0) || list.length >= STAFF_MAX) continue;
    seen.add(k);
    list.push(Object.assign({}, s, { name }));
  }
  const sum = list.reduce((a, s) => a + s.total, 0);
  if (!list.length || !(sum > 0) || !(budgetPay > 0)) return null;
  const pays = list.map((s) => Math.round((budgetPay * s.total) / sum / 1000) * 1000);
  const diff = budgetPay - pays.reduce((a, b) => a + b, 0);
  if (diff) pays[list.reduce((best, s, i) => (s.total > list[best].total ? i : best), 0)] += diff;
  const people = list.map((s, i) => {
    const amts = splitEven(pays[i], months.length);
    return normalizePerson({ name: s.name, role: s.role, salary: s.salary == null ? null : s.salary, pay: pays[i], rate: null, months: months.length || null, manual: s.manual == null ? null : s.manual, erp: s.erp || null,
      plan: months.map((ym, j) => ({ ym, amt: amts[j] })) });
  });
  return { basis: people.some((p) => p.erp) ? 'rerp' : 'plan', src: 'init', people };
}
const sharesOfStaff = (staff) => ((staff && staff.people) || []).map((p) => ({ name: p.name, role: p.role, total: personStats(p, staff.basis).total, salary: p.salary, manual: p.manual, erp: p.erp }));

/* ---------- 바꾸기 (원본은 안 건드리고 새 사람을 돌려준다) ---------- */
/* 적용월부터(종료월까지, 비우면 끝까지) — rate: round천원(월급여 × %) · amt: value(원) · exclude: 0원. 범위에 없던 달은 새로 생긴다. months 는 계획 기간의 달들(없으면 그 사람의 달들) */
function applyChange(person, basis, { from, to = '', mode, value }, months = []) {
  if (!isYm(from)) throw new Error('적용월을 고르세요.');
  const all = months.length ? months : person.plan.map((x) => x.ym);
  if (!all.length) throw new Error('계획 기간이 없어 달을 정할 수 없습니다 — 기간을 먼저 정하세요.');
  const end = isYm(to) && to >= from ? to : all[all.length - 1];
  const range = all.filter((ym) => ym >= from && ym <= end);
  if (!range.length) throw new Error('적용월이 계획 기간 밖입니다.');
  let amt;
  if (mode === 'exclude') amt = 0;
  else if (mode === 'rate') {
    const r = num(value);
    if (r == null || r < 0 || r > 100) throw new Error('참여율은 0~100 사이의 수입니다.');
    const limit = monthlyPay(person, basis);
    if (!(limit.amt > 0)) throw new Error('월급여가 없어 참여율로 금액을 셈할 수 없습니다 — 월급여를 적으세요.');
    amt = amountOfRate(limit.amt, r);
  } else if (mode === 'amt') {
    amt = money(value);
    if (amt == null) throw new Error('월 지급금액은 0 이상의 금액입니다.');
  } else throw new Error('모르는 변경 구분입니다.');
  const map = new Map(person.plan.map((x) => [x.ym, x.amt]));
  for (const ym of range) map.set(ym, amt);
  return Object.assign({}, person, { plan: normalizePlan([...map.entries()].map(([ym, a]) => ({ ym, amt: a }))) });
}
/* 계상인건비 총액 — 지급이 있는 달(없으면 모든 달)에 균등 */
function setTotal(person, total, months = []) {
  const t = money(total);
  if (t == null) throw new Error('계상인건비는 0 이상의 금액입니다.');
  const active = person.plan.filter((x) => x.amt > 0).map((x) => x.ym);
  const ms = active.length ? active : person.plan.length ? person.plan.map((x) => x.ym) : months;
  if (!ms.length) throw new Error('계획 기간이 없어 달을 정할 수 없습니다 — 기간을 먼저 정하세요.');
  const amts = splitEven(t, ms.length);
  const map = new Map(person.plan.map((x) => [x.ym, x.amt]));
  ms.forEach((ym, i) => map.set(ym, amts[i]));
  return Object.assign({}, person, { plan: normalizePlan([...map.entries()].map(([ym, a]) => ({ ym, amt: a }))) });
}
/* 참여율 통째로 — 지급이 있는 달(없으면 기간 전체)에 round천원(월급여 × %) */
function setRate(person, basis, rate, months = []) {
  const active = person.plan.filter((x) => x.amt > 0);
  const from = (active[0] && active[0].ym) || (person.plan[0] && person.plan[0].ym) || months[0];
  const last = active[active.length - 1] || person.plan[person.plan.length - 1];
  const to = (last && last.ym) || months[months.length - 1] || '';
  return applyChange(person, basis, { from, to, mode: 'rate', value: rate }, months);
}
/* 월급여를 손으로 — 비우거나 기준값과 같으면 손으로 적은 것을 지운다 */
function setManual(person, basis, value) {
  const v = value == null || value === '' ? null : thousandOf(value);
  if (value != null && value !== '' && v == null) throw new Error('월급여는 천원 단위의 수입니다.');
  const base = monthlyPay(Object.assign({}, person, { manual: null }), basis);
  return Object.assign({}, person, { manual: v && v !== base.amt ? v : null });
}

/* ---------- 검사 ---------- */
/* 다른 과제의 월별 참여율 — 밖에서 준 것(book: 이름 키 → [{ ym, rate, label }])과 사람마다의 erp.others 를 합친다. 같은 달에 rERP 값이 있으면 그 달은 rERP 값만 */
function mergeOthers(book, staff) {
  const out = {};
  for (const [k, list] of Object.entries(book || {})) out[k] = list.slice();
  for (const p of (staff && staff.people) || []) {
    const rows = (p.erp && p.erp.others) || [];
    if (!rows.length) continue;
    const k = nameKeyOf(p.name);
    const erpYms = new Set(rows.map((o) => o.ym));
    out[k] = (out[k] || []).filter((o) => !erpYms.has(o.ym)).concat(rows.filter((o) => o.rate > 0).map((o) => ({ ym: o.ym, rate: o.rate, label: 'rERP 다른 과제' })));
  }
  return out;
}
/* 알림 — over(어느 달의 참여율 합 > 100, 막지 않는다) · salary(월급여 없음) · fallback(기준은 rERP 인데 없어 계획서 값) · budget(예산 초과) · left(남음). [{ kind, level, text, name? }] */
function checks(staff, basis, { others = {}, budgetPay = null } = {}) {
  const out = [];
  if (!staff) return out;
  for (const p of staff.people) {
    const s = personStats(p, basis);
    const mine = others[nameKeyOf(p.name)] || [];
    const hits = [];
    for (const r of s.rates) {
      if (!(r.amt > 0) || r.rate == null) continue;
      const theirs = mine.filter((o) => o.ym === r.ym);
      const sum = Math.round((r.rate + theirs.reduce((a, o) => a + o.rate, 0)) * 100) / 100;
      if (sum > 100) hits.push({ ym: r.ym, sum, mine: r.rate, theirs });
    }
    if (hits.length) {
      const h = hits[0];
      const parts = [`이 과제 ${rateText(h.mine)}`].concat(h.theirs.map((o) => `${o.label} ${rateText(o.rate)}`)).join(' · ');
      out.push({ kind: 'over', level: 'warn', name: p.name, text: `${p.name} — ${monthLabel(h.ym)} 참여율 합 ${rateText(h.sum)} (${parts})${hits.length > 1 ? ` 외 ${hits.length - 1}달` : ''}` });
    }
  }
  const noLimit = staff.people.filter((p) => !(monthlyPay(p, basis).amt > 0)).map((p) => p.name);
  if (noLimit.length) out.push({ kind: 'salary', level: 'warn', text: `월급여 없음: ${noLimit.join(', ')} — 참여율을 셈할 수 없습니다. 월급여를 적으세요.` });
  const fb = staff.people.filter((p) => monthlyPay(p, basis).fallback).map((p) => p.name);
  if (fb.length) out.push({ kind: 'fallback', level: 'info', text: `rERP 월급여 없음: ${fb.join(', ')} — 계획서 값으로 셈합니다.` });
  const ob = overBudget(staff, basis, budgetPay);
  if (ob.budget != null && ob.over) out.push({ kind: 'budget', level: 'error', text: `인건비 합 ${thousand(ob.total)}천원이 예산 ${thousand(ob.budget)}천원을 넘습니다 (+${thousand(ob.total - ob.budget)}천원).` });
  else if (ob.budget != null && ob.left > 0) out.push({ kind: 'left', level: 'info', text: `인건비 합 ${thousand(ob.total)}천원 · 예산 ${thousand(ob.budget)}천원 (남음 ${thousand(ob.left)}천원).` });
  return out;
}

/* ---------- 글 ---------- */
const srcLabel = { manual: '직접', rerp: 'rERP', plan: '계획서', none: '' };
/* 요약 줄들 — 머리 줄(기준·합·예산)과 사람마다 한 줄. 월 최대는 연간과 같아도 적는다 */
function staffLines(staff, basis, { budgetPay = null } = {}) {
  if (!staff) return [];
  const b = basis || staff.basis;
  const ob = overBudget(staff, b, budgetPay);
  const head = [`월급여 기준: ${BASIS_LABEL[b]}`, `인건비 합 ${thousand(ob.total)}천원${ob.budget != null ? ` (예산 ${thousand(ob.budget)}천원${ob.over ? ' 초과' : ''})` : ''}`].join(' · ');
  const lines = [`■ 참여연구자 (${staff.people.length}명) — ${head}`];
  for (const p of staff.people) {
    const s = personStats(p, b);
    const bits = [p.role, s.limit ? `월급여 ${thousand(s.limit)}천원(${srcLabel[s.src]})` : '월급여 없음',
      s.from ? `${ymText(s.from, s.to)} (${s.months}개월)` : s.months ? `${s.months}개월` : '', `계상인건비 ${thousand(s.total)}천원`,
      s.rate != null ? `참여율 ${rateText(s.rate)}${s.maxRate != null ? ` (월 최대 ${rateText(s.maxRate)})` : ''}` : '',
      s.planned ? `월별 ${monthlyText(p.plan)}` : ''].filter(Boolean);
    lines.push(`- ${p.name} — ${bits.join(' · ')}`);
  }
  return lines;
}
/* 탭으로 나눈 표(천원) — 엑셀·한글에 붙인다 */
function staffTsv(staff, basis) {
  if (!staff) return '';
  const b = basis || staff.basis;
  const rows = [['성명', '직위', '월급여(천원)', '참여기간', '개월', '계상인건비(천원)', '참여율', '월 최대', '월별 지급(천원)']];
  for (const p of staff.people) {
    const s = personStats(p, b);
    rows.push([p.name, p.role, thousand(s.limit), s.from ? ymText(s.from, s.to) : '', String(s.months || ''), thousand(s.total), rateText(s.rate), rateText(s.maxRate), s.planned ? monthlyText(p.plan) : '']);
  }
  return rows.map((r) => r.join('\t')).join('\n');
}

/* ---------- 저장 (storage.local.staffPlans — 과제 연차마다 계획 하나, 키 "과제번호@연차") ---------- */
/* key 를 주면 과제번호·연차가 빠진 항목은 키("과제번호@연차")에서 읽는다 */
function normalizePlanEntry(raw, key = '') {
  if (!raw || typeof raw !== 'object') return null;
  const staff = normalizeStaff(raw);
  const from = text(raw.from, 7), to = text(raw.to, 7);
  const k = String(key || '').split('@');
  return {
    prjNo: text(raw.prjNo, 40) || text(k[0] || '', 40), year: int(raw.year, 1, YEAR_MAX) || int(k[1] || '', 1, YEAR_MAX),
    prjNm: text(raw.prjNm, 200), from: isYm(from) ? from : '', to: isYm(to) ? to : '', budgetPay: money(raw.budgetPay), budget: normalizeBudget(raw.budget),
    basis: staff ? staff.basis : (BASES.includes(raw.basis) ? raw.basis : 'rerp'), src: staff ? staff.src : 'erp', people: staff ? staff.people : [],
    at: num(raw.at) || 0, by: text(raw.by, 40), note: text(raw.note, 300),
  };
}
function normalizePlans(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) { const e = normalizePlanEntry(v, k); if (e && e.prjNo) out[planKey(e.prjNo, e.year)] = e; }
  return out;
}
/* 묘비 — 90일 지난 것은 버린다 */
function gcTomb(del, now) {
  const out = {}; const t0 = (now || Date.now()) - TOMB_TTL;
  for (const [k, v] of Object.entries(del && typeof del === 'object' ? del : {})) { const ts = num(v); if (ts > t0) out[k] = ts; }
  return out;
}
async function load() { try { const r = await chrome.storage.local.get(KEY); return normalizePlans(r[KEY]); } catch (e) { return {}; } }
async function loadDeleted() { try { const r = await chrome.storage.local.get(DKEY); return gcTomb(r[DKEY]); } catch (e) { return {}; } }
async function save(plans) { await chrome.storage.local.set({ [KEY]: plans }); }
/* 연차 계획 하나를 지우고 묘비를 남긴다(공유 (Plus) 가 다른 사람의 사본도 지우도록). plans 는 호출한 쪽의 목록(거기서도 뺀다) */
async function remove(plans, key, now) {
  if (plans && typeof plans === 'object') delete plans[key];
  const del = await loadDeleted();
  del[key] = now || Date.now();
  await chrome.storage.local.set({ [KEY]: plans || {}, [DKEY]: del });
  return del;
}

const api = {
  KEY, DKEY, STAFF_MAX, BASES, BASIS_LABEL, MODES, YEAR_MAX, BUDGET_ITEMS, gcTomb, loadDeleted, remove,
  money, thousand, thousandOf, nameKeyOf, sameName, comma,
  isYm, ymOf, addMonths, ymRange, spanMonths, ymText, monthLabel,
  itemKeyOf, isPayItem, normalizeBudget, budgetPayOf, budgetText,
  planKey, yearLabel, anlOf, yearSpan, plansOfProject,
  monthlyOfSalary, rerpRate, amountOfRate, splitEven,
  normalizePerson, normalizeStaff, normalizePlanEntry, normalizePlans, planMonthly, monthlyPay, personStats, staffTotal, overBudget, rateText, statsText, monthlyText,
  rowsOfErp, byName, peopleOfErp, othersOfErp, sharesOfErp, buildStaff, initFromShares, sharesOfStaff,
  applyChange, setTotal, setRate, setManual, mergeOthers, checks, staffLines, staffTsv, load, save,
};
export default api;
export {
  KEY, DKEY, STAFF_MAX, BASES, BASIS_LABEL, MODES, YEAR_MAX, BUDGET_ITEMS, gcTomb, loadDeleted, remove,
  money, thousand, thousandOf, nameKeyOf, sameName, comma,
  isYm, ymOf, addMonths, ymRange, spanMonths, ymText, monthLabel,
  itemKeyOf, isPayItem, normalizeBudget, budgetPayOf, budgetText,
  planKey, yearLabel, anlOf, yearSpan, plansOfProject,
  monthlyOfSalary, rerpRate, amountOfRate, splitEven,
  normalizePerson, normalizeStaff, normalizePlanEntry, normalizePlans, planMonthly, monthlyPay, personStats, staffTotal, overBudget, rateText, statsText, monthlyText,
  rowsOfErp, byName, peopleOfErp, othersOfErp, sharesOfErp, buildStaff, initFromShares, sharesOfStaff,
  applyChange, setTotal, setRate, setManual, mergeOthers, checks, staffLines, staffTsv, load, save,
};
