// kr_ext_rerp `lib/prjdoc.js` 를 그대로 옮긴 것 — IIFE 머리와 꼬리의 `g.KRX_PRJDOC = api` 를 export 로만 바꿨다(원본이 전역 g.KRX_PLAN_SYNC · KRX_RESEARCH_SYNC · KRX_STAFF_SYNC · KRX_STAFF 로 읽던 것은 아래 shim). 출처·갱신 규칙은 rerp/README.md.
/* 확장 Plus — 과제 공유 문서 v2(과제 폴더의 연차 파일 <n>차년도.json · 예상 비용 파일 예상비용.json). 순수 함수 · 백그라운드(background.js shareSync → lib/prjdoc-sync.js) + Node 테스트 겸용.
 * 2026-10-18 사용자 지정: "onedrive 에 업무/shared 안에 과제별로 .. 약칭으로 없으면 jobid 없으면 임시번호. 이렇게 하고 여기에 넣자. 년차별로 1개 파일이고 1개 파일에서 변경사항이랑 다 관리했으면 좋겠어. 과제 정보랑 등등." ·
 *   "예상지출도 다 들어 가겠지? 이건 별도 파일에서 해도 되긴하는데 알아서 해줘." → 예상 비용은 연차에 걸치는 항목이 두 파일에 갈라지지 않게 과제 폴더의 별도 파일 하나(예상비용.json)에 둔다.
 *   (앞선 결정: 원노트·MCP·Graph 는 쓰지 않고 브라우저 로그인 쿠키만 — 파일 읽기·쓰기는 lib/sp-store.js(KRX_SP), 폴더·파일 차례는 lib/prjdoc-sync.js(KRX_PRJDOC_SYNC). 임시번호 = rERP 과제번호.
 *    v1(<과제번호>.json 한 장, 2026-10-18 낮)은 지웠다 — v1 파일은 parse 가 null 을 주어 그 파일만 건너뛴다.)
 *
 * 연차 파일(kind 'year') = { v:2, kind:'year',
 *   project: { prjNo, prjNm, rspr(과제책임자), alias(약칭), aliasAt(ms), jobId(전자결재 Job Id — WORKSPACE 몫), io(회계 I/O 코드 — WORKSPACE 몫), start, end(과제 **전체** 연구기간 'YYYY-MM-DD' — WORKSPACE 몫; rERP 의 과제 목록이 주는 RCH_ST_DT/RCH_END_DT 는 현재 **연차** 기간이라 여기에 넣지 않고 year.start/end 의 바탕(yearSpan)으로만 쓴다), note, …(모르는 칸 보존) },   — 연차 파일마다 같은 내용
 *   year: { n(연차 1·2·3…), start, end('YYYY-MM' — 그 연차 계획 기간, 사업비 계획의 from/to) },
 *   budget: [ { name(비목), plan(계획 원 | null), at(ms), by } … ],   — 사업비 관리의 예산 줄(lib/staff.js normalizeBudget 모양 + at·by). 사업비 계획(staff.plans[].budget)에도 같은 줄이 비친다(아래 병합)
 *   staff: { plans: [ 그 연차의 계획 — lib/staff.js normalizePlanEntry 모양, 보통 1개 ], del: { ["과제번호@연차"]: 지운 시각 } },
 *   research: [ 그 차년도의 연구내용 기록 — lib/research.js rec 에서 받는 쪽 연결 칸(prjNo·prjNm·linkBy·src)을 뺀 것 ],
 *   changes: [ { id, date('YYYY-MM-DD'), kind('예산'|'연구내용'|'연구기간'|'연구진'|'기타' — kr_ext_workspace src/rnd.js CHANGE_KINDS 와 같은 이름), item, before, after, reason, by, at(ms), auto, …(key 등 모르는 칸 보존) } … ],
 *   updatedAt(ISO), updatedBy, …(모르는 최상위 칸 보존 — KRS WORKSPACE 가 더 넣을 수 있음) }
 * 예상 비용 파일(kind 'plan') = { v:2, kind:'plan', project: { prjNo, prjNm, …보존 }, plan: { items: [ 평면 항목 — lib/plan-sync.js flatten 모양 { id, prj, key, name, qty, unit, amt, sub?, ts, by? } ], del: { [항목 id]: 지운 시각 } }, updatedAt, updatedBy, …보존 }
 *
 * 병합(같은 파일을 여러 사람·두 확장이 쓰므로):
 *   - project: rERP 가 아는 칸(prjNo·prjNm·rspr)은 **R&D ERP 값(로컬)이 늘 이김**(비어 있으면 파일 것). alias 는 aliasAt 큰 쪽(같으면 파일 — 로컬에 시각이 없으면 지금). jobId·io·start·end·note·모르는 칸은 WORKSPACE 몫 —
 *     파일의 updatedAt 이 로컬이 그 칸을 받은 시각(opts.localAt — loadLocal 의 projects[prjNo].at)보다 뒤면 파일 것, 아니면 로컬 것(연차 파일 여럿에 같은 내용을 퍼뜨리고 되치기를 막는 규칙).
 *     start·end 를 ERP 칸에서 뺀 까닭(2026-10-18 검토): rerp 가 아는 날짜(projectList 의 stDt/endDt)는 현재 연차 기간이어서 연차가 바뀔 때마다 모든 연차 파일의 '연구기간' 을 덮고, 두 rerp 사용자의 캐시 연차가 다르면 서로 번갈아 고쳤다.
 *   - budget: 줄 전체를 한 덩이로 — 내용(name·plan)이 다르면 at 가 큰 쪽(같으면 로컬), 빈 쪽은 이기지 못함(rerp 로컬의 budget 이 null 이면 기본값 상태라 파일 것을 받는다). 이긴 줄은 사업비 계획(staff.plans[].budget)에도 비치고(mirror)
 *     그 계획의 budgetPay(참여인력 카드의 인건비 예산 — lib/staff-ui.js budgetOf 가 예산 줄보다 먼저 봄)도 KRX_STAFF.budgetPayOf 로 같이 맞춘다 — 그래서 두 곳이 어긋나도 다음 동기화에 맞춰진다.
 *     로컬 쪽 줄의 at·by 는 그 연차 사업비 계획의 at·by 다(사업비 관리가 예산 줄을 고치면 plan.at 를 올리므로).
 *   - staff: KRX_STAFF_SYNC.merge(연차별 at 큰 쪽·묘비) — 이 파일에는 year.n 연차만. research: KRX_RESEARCH_SYNC.merge(판 → 넣은 시각 → 로컬) — 이 파일에는 n 이 year.n 인 기록만.
 *   - changes: **덧붙이기만** — id 로 합집합(같은 id 가 둘이면 파일 것), (date, at, id) 차례, 500 개를 넘으면 오래된 것부터 버림.
 *   - want 로 끈 칸(설정의 동기화 항목 체크)은 받지도 올리지도 않고 파일에 있던 그대로 둔다. remote 가 없으면(파일 없음) 로컬로 문서를 만든다.
 * 로컬 ↔ 문서: fromLocalYear(과제, 연차, loadLocal 결과, meta) · fromLocalPlan(과제, loadLocal 결과, meta) 가 그 몫을 떼어 내고, toLocalYear · toLocalPlan 이 병합 결과를 로컬 전체 구조에 되돌려 넣는다 — KRX_PRJDOC_SYNC.run 의 saveLocal(part, prj, data) 의 data.
 *   loadLocal() = { plan:{ plans(맵), del }, research(맵), staff:{ plans(맵), del }, aliases, aliasesAt, changes(맵 '과제번호@연차' → [ … ]), projects:{ [prjNo]: { prjNm, rspr, anl, stDt, endDt(ERP 현재 연차 기간 YYYYMMDD — yearSpan 용, 문서로는 안 감), start?, end?, jobId?, io?, note?, at?(WORKSPACE 몫을 받은 시각) } } }.
 *   같은 연구내용 기록(같은 id)이 두 과제 파일에 들어 있을 수 있다 — otherRecs → merge 의 opts.others 로 견주고, toLocal 은 다른 과제에 이어 둔 기록은 글만 받고 연결은 그대로 둔다(v1 과 같음) — 그런 기록은 research.others 로 따로 돌려 배선이 그 과제 몫과 함께 저장한다(안 저장하면 매 동기화마다 다시 받은 것으로 센다).
 * 폴더 이름(folderNameFor): 약칭(projectAliases) → 없으면 Job Id → 없으면 rERP 과제번호. 파일 이름에 못 쓰는 글자를 걷고 60자. 이름은 표시용 — 과제 식별은 파일 안의 project.prjNo(없으면 jobId)로 한다(prjdoc-sync).
 * 필요한 전역: KRX_PLAN_SYNC(flatten·unflatten·merge·tombTs·tombPrj) · KRX_RESEARCH_SYNC(merge) + KRX_RESEARCH(revNo) · KRX_STAFF_SYNC(merge·plansOf) + KRX_STAFF(planKey·normalizePlanEntry·yearSpan) */
import KRX_PLAN_SYNC from './plansync.js';
import KRX_RESEARCH_SYNC from './researchsync.js';
import KRX_STAFF_SYNC from './staffsync.js';
import KRX_STAFF from './staff.js';
const g = { KRX_PLAN_SYNC, KRX_RESEARCH_SYNC, KRX_STAFF_SYNC, KRX_STAFF };   // [workspace] 원본은 전역 g.KRX_* 를 읽는다
const VERSION = 2;
const KINDS = Object.freeze(['year', 'plan']);
const PLAN_NAME = '예상비용.json';
const YEAR_ORDER = ['v', 'kind', 'project', 'year', 'budget', 'staff', 'research', 'changes', 'updatedAt', 'updatedBy'];
const PLAN_ORDER = ['v', 'kind', 'project', 'plan', 'updatedAt', 'updatedBy'];
const PROJECT_ORDER = ['prjNo', 'prjNm', 'rspr', 'alias', 'aliasAt', 'jobId', 'io', 'start', 'end', 'note'];
const ERP_FIELDS = ['prjNo', 'prjNm', 'rspr'];                    // R&D ERP 값(로컬)이 늘 이김
const WS_FIELDS = ['jobId', 'io', 'start', 'end', 'note'];        // WORKSPACE 몫 — rerp 는 보존·표시만(시각 규칙으로 받음). start·end 는 과제 전체 연구기간(rerp 가 아는 날짜는 현재 연차 기간이라 여기에 넣지 않음)
const CHANGE_KINDS = Object.freeze(['예산', '연구내용', '연구기간', '연구진', '기타']);   // kr_ext_workspace src/rnd.js CHANGE_KINDS 와 같은 이름
const CHANGE_ORDER = ['id', 'date', 'kind', 'item', 'before', 'after', 'reason', 'by', 'at', 'auto'];
const CHANGES_MAX = 500;
const BUDGET_MAX = 30;
const FOLDER_NAME_MAX = 60;
const LOCAL_REC = ['prjNo', 'prjNm', 'linkBy', 'src'];   // 연구내용 기록에서 받는 쪽에만 뜻이 있는 칸 — 문서에는 싣지 않는다
const YEAR_KNOWN = new Set(YEAR_ORDER), PLAN_KNOWN = new Set(PLAN_ORDER), PROJECT_KNOWN = new Set(PROJECT_ORDER), CHANGE_KNOWN = new Set(CHANGE_ORDER);
const LOCAL_PROJECT = new Set(['anl', 'at', 'stDt', 'endDt']);   // loadLocal 의 projects[prjNo] 에만 있는 칸 — 문서의 project 로 가지 않는다(stDt·endDt 는 ERP 현재 연차 기간 — yearSpan 에만)
const api = { VERSION, KINDS, PLAN_NAME, YEAR_ORDER, PLAN_ORDER, PROJECT_ORDER, ERP_FIELDS, WS_FIELDS, CHANGE_KINDS, CHANGES_MAX, FOLDER_NAME_MAX };
const PS = () => g.KRX_PLAN_SYNC, RS = () => g.KRX_RESEARCH_SYNC, SS = () => g.KRX_STAFF_SYNC, ST = () => g.KRX_STAFF;
const str = (v) => (v == null ? '' : String(v));
const text = (v, max) => str(v).replace(/\r\n?/g, '\n').trim().slice(0, max || 200);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const int = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 ? n : 0; };
const money = (v) => { if (typeof v === 'string') v = v.replace(/[,\s원₩]/g, ''); if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(str(s));
const canonJ = (v) => JSON.stringify(v);

/* ---------- 파일 이름 ---------- */
api.yearName = (n) => `${int(n)}차년도.json`;
/* 예상 비용 파일 이름 — 함수(yearName 과 같은 꼴). 글이 필요하면 KRX_PRJDOC.PLAN_NAME */
api.planName = () => PLAN_NAME;
/* 연차 파일 이름이면 연차 번호(1 이상), 아니면 0 */
api.isYearName = (name) => { const m = /^(\d{1,3})차년도\.json$/i.exec(str(name).trim()); return m ? int(m[1]) : 0; };
api.yearOfName = api.isYearName;
api.isPlanName = (name) => str(name).trim().toLowerCase() === PLAN_NAME.toLowerCase();
/* 과제 폴더 이름 — 약칭 → Job Id → rERP 과제번호. 파일 이름에 못 쓰는 글자(\ / < > " | ? * : 제어문자)를 걷고 앞뒤 공백·끝의 점을 떼어 60자. 다 비면 '과제' */
api.folderNameFor = function (o) {
  o = o || {};
  // eslint-disable-next-line no-control-regex
  const clean = (s) => str(s).replace(/[\\/<>"|?*:\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_MAX).replace(/[. ]+$/, '').trim();
  return clean(o.alias) || clean(o.jobId) || clean(o.prjNo) || '과제';
};

/* ---------- 모양 ---------- */
const validRec = (r) => !!(r && typeof r === 'object' && !Array.isArray(r) && r.id && r.name && Number(r.n) > 0);
/* 연구내용 기록 — 받는 쪽 연결 칸을 뺀 사본 */
api.cleanRec = (rec) => { const o = Object.assign({}, rec); for (const k of LOCAL_REC) delete o[k]; return o; };
/* project 칸 — 정해진 칸 차례 뒤에 모르는 칸 */
function normalizeProject(o) {
  o = obj(o) || {};
  const p = {};
  for (const k of PROJECT_ORDER) p[k] = k === 'aliasAt' ? num(o.aliasAt) : text(o[k], k === 'note' ? 1000 : 200);
  for (const k of Object.keys(o)) if (!PROJECT_KNOWN.has(k)) p[k] = o[k];
  return p;
}
api.normalizeProject = normalizeProject;
/* 예상 비용 파일의 project — prjNo·prjNm 만(그 밖은 모르는 칸으로 보존) */
function planProject(o) {
  o = obj(o) || {};
  const p = { prjNo: text(o.prjNo), prjNm: text(o.prjNm) };
  for (const k of Object.keys(o)) if (k !== 'prjNo' && k !== 'prjNm') p[k] = o[k];
  return p;
}
/* 예산 줄 — [{ name, plan, at, by }], 이름도 금액도 없는 줄은 뺀다 */
function budgetRows(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (out.length >= BUDGET_MAX) break;
    if (!obj(r)) continue;
    const name = text(r.name, 40), plan = money(r.plan);
    if (!name && plan == null) continue;
    out.push({ name, plan, at: num(r.at), by: text(r.by, 40) });
  }
  return out;
}
api.budgetRows = budgetRows;
/* 변경이력 한 줄 — id 가 없거나 내용(item·before·after·reason)이 모두 비면 null. kind 는 CHANGE_KINDS 밖이면 '기타'. 모르는 칸(WORKSPACE 의 key 등) 보존 */
function normalizeChange(c) {
  if (!obj(c)) return null;
  const id = text(c.id, 40);
  if (!id) return null;
  const out = { id, date: isYmd(c.date) ? c.date : '', kind: CHANGE_KINDS.includes(c.kind) ? c.kind : '기타', item: text(c.item, 100), before: text(c.before, 300), after: text(c.after, 300), reason: text(c.reason, 1000), by: text(c.by, 40), at: num(c.at), auto: c.auto === true };
  if (!(out.item || out.before || out.after || out.reason)) return null;
  for (const k of Object.keys(c)) if (!CHANGE_KNOWN.has(k)) out[k] = c[k];
  return out;
}
api.normalizeChange = normalizeChange;
const changeCmp = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at !== b.at ? a.at - b.at : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/* 변경이력 목록 — 정리·id 중복 제거(뒤에 온 것)·차례·500 개 상한(오래된 것부터 버림) */
function changesList(raw) {
  const map = new Map();
  for (const c of Array.isArray(raw) ? raw : []) { const n = normalizeChange(c); if (n) map.set(n.id, n); }
  const list = Array.from(map.values()).sort(changeCmp);
  return list.length > CHANGES_MAX ? list.slice(list.length - CHANGES_MAX) : list;
}
api.changesList = changesList;
/* 연차 파일의 사업비 계획 — year.n 연차·이 과제 것만(연차·과제번호가 비면 파일 것으로 채움) */
function yearPlan(p, prjNo, n) {
  const e = ST().normalizePlanEntry(p);
  if (!e) return null;
  if (!e.prjNo) e.prjNo = prjNo;
  if (!e.year) e.year = n;
  if (!e.prjNo || (n && e.year !== n) || (prjNo && e.prjNo !== prjNo)) return null;
  return e;
}
const staffDelSlice = (del, prjNo, n) => { const out = {}; const key = prjNo && n ? ST().planKey(prjNo, n) : ''; for (const [k, v] of Object.entries(obj(del) || {})) if (!key || k === key) out[k] = num(v); return out; };
/* 아무 객체 → 연차 문서 모양(없는 칸은 빈 값, 모르는 최상위 칸은 그대로). nHint = 파일 이름의 연차(year.n 이 없을 때) */
function normalizeYear(o, nHint) {
  o = obj(o) || {};
  const d = { v: VERSION, kind: 'year' };
  d.project = normalizeProject(o.project);
  const y = obj(o.year) || {};
  const n = int(y.n) || int(nHint) || 0;
  d.year = { n, start: text(y.start, 20), end: text(y.end, 20) };
  d.budget = budgetRows(o.budget);
  const st = obj(o.staff) || {};
  const rawPlans = Array.isArray(st.plans) ? st.plans : Object.values(obj(st.plans) || {});
  d.staff = { plans: rawPlans.map((p) => (obj(p) ? yearPlan(p, d.project.prjNo, n) : null)).filter(Boolean), del: staffDelSlice(st.del, d.project.prjNo, n) };
  d.research = (Array.isArray(o.research) ? o.research : []).filter((r) => validRec(r) && (!n || Number(r.n) === n));
  d.changes = changesList(o.changes);
  d.updatedAt = str(o.updatedAt); d.updatedBy = str(o.updatedBy);
  for (const k of Object.keys(o)) if (!YEAR_KNOWN.has(k)) d[k] = o[k];
  return d;
}
api.normalizeYear = normalizeYear;
/* 아무 객체 → 예상 비용 문서 모양. items 는 평면 항목(id 있는 객체)만, prj 가 비면 project.prjNo */
function normalizePlanDoc(o) {
  o = obj(o) || {};
  const d = { v: VERSION, kind: 'plan' };
  d.project = planProject(o.project);
  const pl = obj(o.plan) || {};
  const items = (Array.isArray(pl.items) ? pl.items : []).filter((e) => obj(e) && e.id).map((e) => PS().normEntry(Object.assign({}, e, { prj: e.prj || d.project.prjNo })));
  d.plan = { items, del: obj(pl.del) || {} };
  d.updatedAt = str(o.updatedAt); d.updatedBy = str(o.updatedBy);
  for (const k of Object.keys(o)) if (!PLAN_KNOWN.has(k)) d[k] = o[k];
  return d;
}
api.normalizePlanDoc = normalizePlanDoc;
/* 빈 연차 문서. meta = { prjNo, prjNm, rspr, alias, aliasAt, jobId, io, start, end, note, who, yearStart?, yearEnd? } */
api.emptyYear = (meta, n) => { const m = meta || {}; const p = {}; for (const k of PROJECT_ORDER) if (m[k] !== undefined) p[k] = m[k]; return normalizeYear({ project: p, year: { n, start: m.yearStart, end: m.yearEnd }, updatedBy: m.who }); };
/* 빈 예상 비용 문서. meta = { prjNo, prjNm, who } */
api.emptyPlan = (meta) => { const m = meta || {}; return normalizePlanDoc({ project: { prjNo: m.prjNo, prjNm: m.prjNm }, updatedBy: m.who }); };
/* 글 → { kind:'year'|'plan', doc } | null(JSON 아님 · 객체 아님 · v 가 2 가 아님 · 종류를 모름). hint = { year }(파일 이름의 연차). 다른 판(v1 등)은 null 로 알려 덮어쓰지 않게 한다(부르는 쪽이 kind 'parse' 로 건너뜀) */
api.parse = function (textIn, hint) {
  let o;
  try { o = JSON.parse(String(textIn == null ? '' : textIn)); } catch (e) { return null; }
  if (!obj(o) || Number(o.v) !== VERSION) return null;
  const kind = o.kind === 'plan' || o.kind === 'year' ? o.kind : obj(o.year) ? 'year' : obj(o.plan) ? 'plan' : '';
  if (!kind) return null;
  return { kind, doc: kind === 'year' ? normalizeYear(o, hint && hint.year) : normalizePlanDoc(o) };
};
/* 문서 → 2칸 들여쓰기 JSON, 키 차례 고정(YEAR_ORDER · PLAN_ORDER, 그 뒤 모르는 칸). kind 가 없으면 plan 칸이 있으면 'plan', 아니면 'year' */
api.serialize = function (doc) {
  const o = obj(doc) || {};
  const kind = o.kind === 'plan' || (o.kind !== 'year' && obj(o.plan) && !obj(o.year)) ? 'plan' : 'year';
  return JSON.stringify(kind === 'plan' ? normalizePlanDoc(o) : normalizeYear(o), null, 2) + '\n';
};

/* ---------- 로컬 ↔ 문서 ---------- */
const planDelSlice = (del, prj) => { const out = {}; for (const [id, v] of Object.entries(del || {})) { const p = PS().tombPrj(v); if (!p || p === prj) out[id] = PS().tombTs(v); } return out; };
const changeKey = (prj, n) => `${prj}@${int(n)}`;
api.changeKey = changeKey;
/* loadLocal 의 projects[prjNo] — ERP 칸(prjNm·rspr·anl·stDt·endDt)과 받아 둔 WORKSPACE 칸(jobId·io·start·end·note)·받은 시각 at */
const projectOf = (local, prj) => obj(obj((local || {}).projects) && local.projects[prj]) || {};
/* 로컬 project 칸의 WORKSPACE 몫을 받은 시각(ms) — mergeYear 의 opts.localAt */
api.localProjectAt = (local, prj) => num(projectOf(local, prj).at);
/**
 * loadLocal 결과에서 과제 하나·연차 하나 몫을 연차 문서로. meta = { prjNm?, rspr?, stDt?, endDt?, who? }(R&D ERP 값 — 없으면 local.projects[prj] 의 것; meta.start/end 는 받지 않는다 — 과제 전체 기간은 WORKSPACE 몫이라 local.projects 에 받아 둔 것만).
 * year.start/end 는 그 연차 사업비 계획의 from/to, 없으면 KRX_STAFF.yearSpan(ERP 현재 연차 기간 stDt/endDt 에서 12달씩 — 모르면 빈 값). budget 줄은 그 계획의 budget 에 계획의 at·by 를 붙인 것.
 * 연구내용 기록은 연결 칸을 그대로 둔다(toLocalYear 가 로컬 것을 그대로 쓰기 위해 — 문서로 낼 때 merge 가 뺀다)
 */
api.fromLocalYear = function (prjNo, n, local, meta) {
  const l = local || {}, m = meta || {}, prj = str(prjNo).trim(); n = int(n);
  const pr = projectOf(l, prj);
  const staff = l.staff || {};
  const key = ST().planKey(prj, n);
  const plan = SS().plansOf(staff.plans || {}, prj).find((p) => p.year === n) || null;
  const span = plan && plan.from && plan.to ? { from: plan.from, to: plan.to } : ST().yearSpan({ stDt: str(m.stDt || pr.stDt), endDt: str(m.endDt || pr.endDt), anl: pr.anl }, n);
  const project = { prjNo: prj, prjNm: m.prjNm || pr.prjNm, rspr: m.rspr || pr.rspr, start: pr.start, end: pr.end, alias: (l.aliases || {})[prj] || '', aliasAt: (l.aliasesAt || {})[prj] || 0, jobId: pr.jobId, io: pr.io, note: pr.note };
  for (const k of Object.keys(pr)) if (!PROJECT_KNOWN.has(k) && !LOCAL_PROJECT.has(k)) project[k] = pr[k];   // 받아 둔 모르는 project 칸(toLocalYear 가 projects 에 넣은 것)도 되돌려 — 매번 '받았다' 고 하지 않게
  const d = normalizeYear({
    project,
    year: { n, start: span.from, end: span.to },
    budget: plan && Array.isArray(plan.budget) ? plan.budget.map((r) => ({ name: r.name, plan: r.plan, at: plan.at, by: plan.by })) : [],
    staff: { plans: plan ? [clone(plan)] : [], del: staffDelSlice(staff.del, prj, n) },
    changes: (obj(l.changes) || {})[key] || [],
    updatedBy: m.who,
  });
  d.research = Object.values(obj(l.research) || {}).filter((r) => validRec(r) && r.prjNo === prj && Number(r.n) === n).sort((a, b) => a.n - b.n);
  return d;
};
/* loadLocal 결과에서 과제 하나의 예상 비용 몫을 예상 비용 문서로. meta = { prjNm?, who? } */
api.fromLocalPlan = function (prjNo, local, meta) {
  const l = local || {}, m = meta || {}, prj = str(prjNo).trim();
  const plan = l.plan || {};
  return normalizePlanDoc({ project: { prjNo: prj, prjNm: m.prjNm || projectOf(l, prj).prjNm }, plan: { items: PS().flatten({ [prj]: (plan.plans || {})[prj] || {} }, prj), del: planDelSlice(plan.del, prj) }, updatedBy: m.who });
};
/* 로컬에서 **다른** 과제에 이어 둔 연구내용 기록 { id: rec } → merge 의 opts.others(v1 과 같음 — 같은 기록이 두 과제 파일에 있을 때 되치기 방지) */
api.otherRecs = function (prjNo, local) {
  const prj = str(prjNo).trim(), out = {};
  for (const r of Object.values(obj((local || {}).research) || {})) if (validRec(r) && r.prjNo && r.prjNo !== prj) out[r.id] = r;
  return out;
};

/* ---------- 병합 ---------- */
/* project 칸 병합. opts = { localAt(로컬이 WORKSPACE 칸을 받은 시각 ms), remoteAt(파일 updatedAt ms), alias(별칭도 맞추나 — want.alias), now }
 *   → { project, localChanged:{ alias, project }, remoteChanged, at(= max(localAt, remoteAt) — 로컬 project 에 적어 둘 시각) } */
function mergeProject(Lp, Rp, now, opts) {
  const L = normalizeProject(Lp), R = Rp ? normalizeProject(Rp) : null;
  const o = opts || {}, localAt = num(o.localAt), remoteAt = num(o.remoteAt);
  const out = {};
  let remoteChanged = !R, projectChanged = false;
  for (const k of ERP_FIELDS) out[k] = L[k] || (R ? R[k] : '');   // R&D ERP 값이 늘 이김(비어 있으면 파일 것)
  // 별칭 — aliasAt 큰 쪽(같으면 파일). 로컬 별칭이 다른데 시각이 없으면 지금으로
  let aliasChanged = false;
  if (o.alias === false) { out.alias = R ? R.alias : ''; out.aliasAt = R ? R.aliasAt : 0; }
  else {
    const lA = L.alias, lT = L.aliasAt, rA = R ? R.alias : '', rT = R ? R.aliasAt : 0;
    let a, t;
    if (lA === rA) { a = lA; t = Math.max(lT, rT); }
    else { const lt = lA && !lT ? now : lT; if (lt > rT) { a = lA; t = lt; } else { a = rA; t = rT; } }
    out.alias = a; out.aliasAt = t;
    aliasChanged = a !== lA || t !== lT;
  }
  // WORKSPACE 몫·모르는 칸 — 파일이 로컬이 받은 시각보다 뒤면 파일 것(빈 값이라도), 아니면 로컬 것
  const wsKeys = WS_FIELDS.concat(Object.keys(L).filter((k) => !PROJECT_KNOWN.has(k)), R ? Object.keys(R).filter((k) => !PROJECT_KNOWN.has(k)) : []);
  for (const k of new Set(wsKeys)) {
    const lv = L[k], rv = R ? R[k] : undefined;
    let v;
    if (!R || rv === undefined) v = lv;
    else if (lv === undefined) v = rv;
    else if (canonJ(lv) === canonJ(rv)) v = lv;
    else v = remoteAt > localAt ? rv : lv;
    if (v !== undefined) out[k] = v;
    if (canonJ(v) !== canonJ(lv)) projectChanged = true;
  }
  const project = normalizeProject(out);
  if (R) for (const k of new Set(Object.keys(project).concat(Object.keys(R)))) if (canonJ(project[k]) !== canonJ(R[k])) remoteChanged = true;
  return { project, localChanged: { alias: aliasChanged, project: projectChanged }, remoteChanged, at: Math.max(localAt, remoteAt) };
}
api.mergeProject = mergeProject;
/* 예산 줄 병합 — 내용(name·plan)이 같으면 at 가 큰 쪽의 at·by, 다르면 at 가 큰 쪽(같으면 로컬), 빈 쪽은 이기지 못함 → { rows, localChanged(내용), remoteChanged(내용·at·by) } */
const canonB = (rows) => canonJ((rows || []).map((r) => [r.name, r.plan]));
const maxAt = (rows) => (rows || []).reduce((m, r) => Math.max(m, num(r.at)), 0);
function mergeBudget(lb, rb, hasR) {
  let rows;
  if (!hasR || !rb.length) rows = lb;
  else if (!lb.length) rows = rb;
  else if (canonB(lb) === canonB(rb)) rows = maxAt(rb) > maxAt(lb) ? rb : lb;
  else rows = maxAt(rb) > maxAt(lb) ? rb : lb;
  return { rows, localChanged: canonB(rows) !== canonB(lb), remoteChanged: !hasR || canonJ(rows) !== canonJ(rb) };
}
api.mergeBudget = mergeBudget;
/* 변경이력 병합 — id 합집합(둘 다 있으면 파일 것), 차례·상한은 changesList → { list, localChanged, remoteChanged } */
function mergeChanges(lc, rc) {
  const list = changesList((lc || []).concat(rc || []));
  return { list, localChanged: canonJ(list) !== canonJ(changesList(lc)), remoteChanged: rc == null || canonJ(list) !== canonJ(changesList(rc)) };
}
api.mergeChanges = mergeChanges;
const planBudget = (rows) => rows.map((r) => ({ name: r.name, plan: r.plan }));

/**
 * 연차 문서 병합. local · remote 는 연차 문서 모양(remote 는 null = 파일 없음). opts = { want:{ budget, staff, research, changes, alias }, others?:{ id: rec }, localAt?(ms) }
 * → { doc, year(n), localChanged:{ budget, staff, research, changes, alias, project }, remoteChanged,
 *      parts: { budget:{ rows, at, by } | null, staff:{ plans, del } | null, research:{ recs, fromRemote } | null, changes:[…] | null, project:{ …project, at } } }
 *   parts 는 toLocalYear 가 로컬에 되돌려 넣을 때 쓴다. updatedAt/updatedBy 는 remoteChanged 일 때 now/who, 아니면 remote 것
 */
api.mergeYear = function (local, remote, now, who, opts) {
  now = now || Date.now(); opts = opts || {};
  const L = normalizeYear(local), R = remote ? normalizeYear(remote, L.year.n) : null;
  who = str(who || L.updatedBy);
  const want = Object.assign({ budget: true, staff: true, research: true, changes: true, alias: true }, opts.want || {});
  const n = L.year.n || (R && R.year.n) || 0;
  const localChanged = { budget: false, staff: false, research: false, changes: false, alias: false, project: false };
  const parts = { budget: null, staff: null, research: null, changes: null, project: null };
  const doc = { v: VERSION, kind: 'year' };
  let remoteChanged = !R;
  // project
  const pm = mergeProject(L.project, R && R.project, now, { localAt: num(opts.localAt), remoteAt: R ? Date.parse(R.updatedAt) || 0 : 0, alias: want.alias });
  doc.project = pm.project;
  localChanged.alias = pm.localChanged.alias; localChanged.project = pm.localChanged.project;
  if (pm.remoteChanged) remoteChanged = true;
  parts.project = Object.assign({}, pm.project, { at: pm.at });
  doc.year = { n, start: '', end: '' };
  // 사업비 — 연차별 at
  let plans, del;
  if (want.staff) {
    const m = SS().merge({ plans: L.staff.plans, del: L.staff.del }, R ? { plans: R.staff.plans, del: R.staff.del } : null, now);
    plans = m.plans.map((p) => clone(p)); del = m.del;
    if (m.remoteChanged) remoteChanged = true;
  } else { plans = (R ? R.staff.plans : []).map((p) => clone(p)); del = R ? R.staff.del : {}; }
  // 예산 줄 — 한 덩이로 at. 이긴 줄을 사업비 계획의 budget 에도 비춘다
  if (want.budget) {
    const bm = mergeBudget(L.budget, R ? R.budget : [], !!R);
    doc.budget = bm.rows;
    localChanged.budget = bm.localChanged; if (bm.remoteChanged) remoteChanged = true;
    const at = maxAt(bm.rows), byRow = bm.rows.find((r) => num(r.at) === at);
    parts.budget = { year: n, rows: bm.rows, at, by: byRow ? byRow.by : '' };
    if (want.staff && bm.rows.length) for (const p of plans) if (canonB(p.budget || []) !== canonB(bm.rows)) { p.budget = planBudget(bm.rows); p.budgetPay = ST().budgetPayOf(p.budget); }   // 비친 줄에 맞춰 인건비 예산도(lib/staff-ui.js syncPay 와 같은 식) — 아니면 참여인력 카드의 예산·초과 검사가 옛 값으로 남는다
  } else doc.budget = R ? R.budget : [];
  doc.staff = { plans, del };
  if (want.staff) {
    const canonS = (xs) => canonJ(SS().plansOf(xs));
    const canonD = (d) => canonJ(Object.entries(d || {}).map(([k, v]) => [k, num(v)]).sort());
    localChanged.staff = canonS(plans) !== canonS(L.staff.plans) || canonD(del) !== canonD(L.staff.del);
    if (R && (canonS(plans) !== canonS(R.staff.plans) || canonD(del) !== canonD(R.staff.del))) remoteChanged = true;
    parts.staff = { plans, del };
  }
  // 연차 기간 — 그 연차 계획의 from/to, 없으면 파일 것, 없으면 로컬 것
  const yp = plans.find((p) => p.year === n);
  doc.year.start = (yp && yp.from) || (R && R.year.start) || L.year.start;
  doc.year.end = (yp && yp.to) || (R && R.year.end) || L.year.end;
  if (R && (doc.year.start !== R.year.start || doc.year.end !== R.year.end || n !== R.year.n)) remoteChanged = true;
  // 연구내용 — 판 → 넣은 시각 → 로컬. 다른 과제에 이어 둔 로컬 기록(others)이 파일에도 있으면 로컬 쪽에 넣어 견준다
  if (want.research) {
    const others = obj(opts.others) || {};
    const lRecs = L.research.slice(), have = new Set(lRecs.map((x) => x.id)), rIds = new Set((R ? R.research : []).map((x) => x.id));
    for (const [id, rec] of Object.entries(others)) if (rIds.has(id) && !have.has(id) && validRec(rec)) lRecs.push(rec);
    const m = RS().merge(lRecs, R ? R.research : null);
    doc.research = m.recs.map(api.cleanRec);
    localChanged.research = m.localChanged; if (m.remoteChanged) remoteChanged = true;
    parts.research = { recs: m.recs, fromRemote: m.fromRemote };
  } else doc.research = R ? R.research : [];
  // 변경이력 — 덧붙이기만
  if (want.changes) {
    const cm = mergeChanges(L.changes, R ? R.changes : null);
    doc.changes = cm.list;
    localChanged.changes = cm.localChanged; if (cm.remoteChanged) remoteChanged = true;
    parts.changes = cm.list;
  } else doc.changes = R ? R.changes : [];
  // 모르는 최상위 칸 — 파일 것이 앞선다
  for (const k of Object.keys(L)) if (!YEAR_KNOWN.has(k)) doc[k] = L[k];
  if (R) for (const k of Object.keys(R)) if (!YEAR_KNOWN.has(k)) doc[k] = R[k];
  if (remoteChanged) { doc.updatedAt = new Date(now).toISOString(); doc.updatedBy = who; }
  else { doc.updatedAt = R.updatedAt; doc.updatedBy = R.updatedBy; }
  return { doc: normalizeYear(doc), year: n, localChanged, remoteChanged, parts };
};

/**
 * 예상 비용 문서 병합 — KRX_PLAN_SYNC.merge 그대로(항목 id 별 ts 큰 쪽·묘비). opts = { want:{ plan } }
 * → { doc, localChanged:{ plan }, remoteChanged, parts:{ plan:{ items(평면), del } | null } }
 */
api.mergePlan = function (local, remote, now, who, opts) {
  now = now || Date.now(); opts = opts || {};
  const L = normalizePlanDoc(local), R = remote ? normalizePlanDoc(remote) : null;
  who = str(who || L.updatedBy);
  const want = Object.assign({ plan: true }, opts.want || {});
  const doc = { v: VERSION, kind: 'plan' };
  const project = {};
  for (const k of Object.keys(L.project)) project[k] = L.project[k];
  if (R) for (const k of Object.keys(R.project)) if (k !== 'prjNo' && k !== 'prjNm') project[k] = R.project[k];
  project.prjNo = L.project.prjNo || (R ? R.project.prjNo : '');
  project.prjNm = L.project.prjNm || (R ? R.project.prjNm : '');
  doc.project = planProject(project);
  const P = doc.project.prjNo;
  const localChanged = { plan: false }, parts = { plan: null };
  let remoteChanged = !R || canonJ(doc.project) !== canonJ(R.project);
  const withPrj = (items) => items.map((e) => Object.assign({}, e, { prj: e.prj || P }));
  if (want.plan) {
    const m = PS().merge({ items: withPrj(L.plan.items), del: L.plan.del }, R ? { items: withPrj(R.plan.items), del: R.plan.del } : null, now);
    doc.plan = { items: m.items, del: m.del };
    localChanged.plan = m.localChanged; if (m.remoteChanged) remoteChanged = true;
    parts.plan = { items: m.items, del: m.del };
  } else doc.plan = R ? R.plan : { items: [], del: {} };
  for (const k of Object.keys(L)) if (!PLAN_KNOWN.has(k)) doc[k] = L[k];
  if (R) for (const k of Object.keys(R)) if (!PLAN_KNOWN.has(k)) doc[k] = R[k];
  if (remoteChanged) { doc.updatedAt = new Date(now).toISOString(); doc.updatedBy = who; }
  else { doc.updatedAt = R.updatedAt; doc.updatedBy = R.updatedBy; }
  return { doc: normalizePlanDoc(doc), localChanged, remoteChanged, parts };
};

/**
 * 연차 병합 결과를 로컬 전체 구조에 되돌려 넣는다(다른 과제·다른 연차 몫은 그대로) — saveLocal(part, prj, data) 의 data. opts = { src?(받은 연구내용 기록의 src — 기본 연차 파일 이름) }
 * → { budget: { year, budget:[{ name, plan, at, by }], at, by } | null                                                  ⇒ staffPlans[과제@연차].budget(계획이 없으면 빈 계획을 만들어 담음)
 *      staff:  { plans(전체 맵, 키 "과제번호@연차" — 이 연차 키만 바뀜, budget 은 병합이 비춰 둔 것), del(전체 숫자 묘비 맵) }   ⇒ staffPlans · staffPlansDeleted
 *      research: { map(전체 맵 — 이 과제·연차 기록만 바뀜), recs(이 과제 기록 **전부** — 연결 칸 포함, 차년도 차례), ids, year, yearRecs(이 연차 것),
 *                  others({ id: rec } — 로컬에서 **다른 과제**에 이어 둔 기록인데 이 파일에서 새 글을 받은 것: 연결은 그대로, 글만 새것) }   ⇒ KRX_RESEARCH.save(map) (recs 로 과제 몫을 갈아 넣을 때는 others 도 같이 — 아니면 그 기록은 매 동기화마다 다시 "받은 것" 이 된다)
 *      changes: { key("과제번호@연차"), year, list, all(전체 맵 — 이 키만 바뀜) }                                          ⇒ shareChanges[key] (list 는 이미 합집합)
 *      alias:   { alias, aliasAt, aliases(전체), aliasesAt(전체) }                                                        ⇒ projectAliases[prj] · projectAliasesAt[prj]
 *      project: { jobId, io, start, end, note, …(모르는 project 칸), at(ms — 받은 시각) }   ⇒ 로컬 projects[prj](shareProjects) 에 겹침. ERP 칸(prjNo·prjNm·rspr)·별칭은 넣지 않는다 }
 *   받은 연구내용 기록(fromRemote)은 이 과제에 잇는다(prjNo·prjNm, linkBy 'auto' — 같은 과제에 손으로 이어 둔 것이면 'user' 유지, src). 로컬에서 **다른 과제**에 이어 둔 기록이면 글만 받고 연결은 그대로(v1 과 같음). 끈 칸(parts.* 가 null)은 로컬 그대로
 */
api.toLocalYear = function (prjNo, n, local, merged, opts) {
  const l = local || {}, prj = str(prjNo).trim(), parts = (merged && merged.parts) || {}, doc = (merged && merged.doc) || {}; n = int(n);
  const key = ST().planKey(prj, n), src = str((opts && opts.src) || api.yearName(n));
  const out = {};
  const isMine = (k, v) => k === key || !!(v && v.prjNo === prj && Number(v.year) === n);
  // 사업비
  {
    const cur = l.staff || {};
    let plans = Object.assign({}, cur.plans), del = {};
    for (const [k, v] of Object.entries(cur.del || {})) del[k] = num(v);
    if (parts.staff) {
      plans = {};
      for (const [k, v] of Object.entries(cur.plans || {})) if (!isMine(k, v)) plans[k] = v;
      for (const p of parts.staff.plans) plans[ST().planKey(p.prjNo, p.year)] = p;
      del = {};
      for (const [k, v] of Object.entries(cur.del || {})) if (k !== key) del[k] = num(v);
      for (const [k, ts] of Object.entries(parts.staff.del)) del[k] = ts;
    }
    out.staff = { plans, del };
  }
  // 예산 줄 — 그 연차의 줄만(배선이 staffPlans[과제@연차].budget 에 넣는다 — 계획이 없으면 빈 계획을 만들어 담음). 병합이 이미 staff.plans 의 budget 에 비춰 두었으므로 여기서는 줄만 준다
  out.budget = parts.budget ? { year: n, budget: clone(parts.budget.rows), at: parts.budget.at, by: parts.budget.by } : null;
  // 연구내용
  {
    const map = Object.assign({}, obj(l.research) || {});
    const yearRecs = [], others = {};
    if (parts.research) {
      for (const rec of parts.research.recs) {
        if (parts.research.fromRemote[rec.id]) {
          const prev = map[rec.id];
          const elsewhere = !!(prev && prev.prjNo && prev.prjNo !== prj);   // 다른 과제에 이어 둔 기록 — 글만 받고 연결은 그대로
          const keepUser = prev && prev.linkBy === 'user' && prev.prjNo === prj;
          const keepLink = {};
          if (elsewhere) for (const k of LOCAL_REC) if (prev[k] !== undefined) keepLink[k] = prev[k];
          map[rec.id] = elsewhere
            ? Object.assign(api.cleanRec(rec), keepLink)
            : Object.assign(api.cleanRec(rec), { prjNo: prj, prjNm: (doc.project && doc.project.prjNm) || (prev && prev.prjNm) || '', linkBy: keepUser ? 'user' : 'auto', src });
          if (elsewhere) others[rec.id] = map[rec.id];
        } else if (!map[rec.id]) map[rec.id] = rec;
        yearRecs.push(map[rec.id]);
      }
    } else for (const r of Object.values(map)) if (validRec(r) && r.prjNo === prj && Number(r.n) === n) yearRecs.push(r);
    const recs = Object.values(map).filter((r) => validRec(r) && r.prjNo === prj).sort((a, b) => a.n - b.n);
    out.research = { map, recs, ids: recs.map((r) => r.id), year: n, yearRecs: yearRecs.sort((a, b) => a.n - b.n), others };
  }
  // 변경이력
  {
    const all = Object.assign({}, obj(l.changes) || {});
    const list = parts.changes ? clone(parts.changes) : changesList(all[key]);
    if (parts.changes) all[key] = list;
    out.changes = { key, year: n, list, all };
  }
  // 별칭
  {
    const aliases = Object.assign({}, l.aliases), aliasesAt = Object.assign({}, l.aliasesAt);
    const alias = str(doc.project && doc.project.alias), aliasAt = num(doc.project && doc.project.aliasAt);
    if (alias) aliases[prj] = alias; else delete aliases[prj];
    if (aliasAt) aliasesAt[prj] = aliasAt; else delete aliasesAt[prj];
    out.alias = { alias, aliasAt, aliases, aliasesAt };
  }
  // project — WORKSPACE 몫(jobId·io·note·모르는 칸)과 받은 시각만(ERP 칸·별칭은 각자의 자리에 — 배선이 이 객체를 그대로 로컬 projects[prj] 에 겹친다)
  {
    const p = parts.project || Object.assign({}, normalizeProject(doc.project), { at: 0 });
    const o = {};
    for (const k of Object.keys(p)) if (!ERP_FIELDS.includes(k) && k !== 'alias' && k !== 'aliasAt') o[k] = p[k];
    out.project = o;
  }
  return out;
};
/* 예상 비용 병합 결과를 로컬 전체 구조에 — { plan: { plans(전체 맵 — 이 과제 칸만 바뀜), del(전체 묘비 맵 { id: { ts, prj } }) } } ⇒ KRX_PLAN.save(plans, del, prj). 끈 칸이면 로컬 그대로 */
api.toLocalPlan = function (prjNo, local, merged) {
  const l = local || {}, prj = str(prjNo).trim(), parts = (merged && merged.parts) || {};
  const cur = l.plan || {};
  const plans = Object.assign({}, cur.plans);
  const del = Object.assign({}, cur.del);
  if (parts.plan) {
    delete plans[prj];
    Object.assign(plans, PS().unflatten(parts.plan.items.map((e) => Object.assign({}, e, { prj: e.prj || prj }))));
    for (const [id, v] of Object.entries(del)) { const p = PS().tombPrj(v); if ((!p || p === prj) && parts.plan.del[id] == null) delete del[id]; }
    for (const [id, ts] of Object.entries(parts.plan.del)) del[id] = { ts, prj };
  }
  return { plan: { plans, del } };
};

/* ---------- 대상 고르기·셈 ---------- */
/* loadLocal 결과에 자료가 있는 과제번호들(예상 비용 항목·기록·연차 계획·별칭·변경이력 가운데 하나라도) */
api.localPrjNos = function (local) {
  const l = local || {}, out = new Set();
  for (const [prj, byKey] of Object.entries((l.plan && l.plan.plans) || {})) if (Object.values(obj(byKey) || {}).some((xs) => Array.isArray(xs) && xs.some((e) => e && e.id))) out.add(prj);
  for (const r of Object.values(obj(l.research) || {})) if (validRec(r) && r.prjNo) out.add(String(r.prjNo));
  for (const p of SS().plansOf((l.staff && l.staff.plans) || {})) out.add(p.prjNo);
  for (const [prj, a] of Object.entries(l.aliases || {})) if (a) out.add(prj);
  for (const [k, list] of Object.entries(obj(l.changes) || {})) if (Array.isArray(list) && list.length && k.includes('@')) out.add(k.split('@')[0]);
  return Array.from(out).filter(Boolean);
};
/* 로컬 자료가 있는 그 과제의 연차들(사업비 계획·연구내용 기록의 n·변경이력 키) — 오름차순 */
api.localYears = function (prjNo, local) {
  const l = local || {}, prj = str(prjNo).trim(), out = new Set();
  for (const p of SS().plansOf((l.staff && l.staff.plans) || {}, prj)) out.add(p.year);
  for (const r of Object.values(obj(l.research) || {})) if (validRec(r) && r.prjNo === prj && int(r.n)) out.add(int(r.n));
  for (const [k, list] of Object.entries(obj(l.changes) || {})) { const [p, y] = k.split('@'); if (p === prj && int(y) && Array.isArray(list) && list.length) out.add(int(y)); }
  return Array.from(out).sort((a, b) => a - b);
};
/* 연차 문서의 셈 — { budget(줄), staff(연차 계획), research(기록), changes(줄) } */
api.countOfYear = (doc) => { const d = normalizeYear(doc); return { budget: d.budget.length, staff: d.staff.plans.length, research: d.research.length, changes: d.changes.length }; };
/* 예상 비용 문서의 셈 — { plan(항목) } */
api.countOfPlan = (doc) => ({ plan: normalizePlanDoc(doc).plan.items.length });

export default api;
