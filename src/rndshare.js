// R&D 장부 ↔ SharePoint(OneDrive) 공유 폴더의 연차 파일 변환 — 순수 로직. 화면(켜기·공유 폴더·지금 맞추기)과 언제 맞출지, 파일을 읽고 쓰는 차례는
// rndpanel.js 가 kr_ext_rerp 에서 옮긴 rerp/sharesync.js(createShareSync → rerp/prjdocsync.js run · rerp/spstore.js)로 돌린다. 여기는 장부(src/rnd.js)와 파일 모양 사이만 맡는다.
//
// 2026-10-18 사용자 지정(kr_ext_rerp 에서 먼저 바뀌고 "거기도 이렇게 진행하도록 해줘" · "workspace 에도 경로주면 알아서 동기화"):
//   "원노트 공유는 mcp 없어도 되긴하지? … 글치 mcp 없이 할 수 있게 해줘" · "아니 mcp 없이 grph api 하지 않고 브라우저 토큰으로 하라고" →
//   원노트·MCP·Graph 는 걷어 내고 브라우저의 Microsoft 로그인 쿠키만으로 SharePoint(OneDrive) 공유 폴더를 쓴다(이 PC 의 KR_MS365_mcp 서버가 필요 없다).
//   "onedrive 에 업무/shared 안에 과제별로 .. 약칭으로 없으면 jobid 없으면 임시번호 … 년차별로 1개 파일이고 1개 파일에서 변경사항이랑 다 관리 … 과제 정보랑 등등" →
//   밑폴더(비우면 내 OneDrive 의 문서/업무/shared) 아래 과제 폴더(이름 = 약칭 → Job Id → rERP 과제번호)마다 연차 파일 <n>차년도.json 하나에 과제 정보·예산 계획·변경이력·연구내용을 둔다.
//   "예상지출도 … 별도 파일에서 해도 되긴하는데" → 예상 비용은 그 폴더의 예상비용.json(kr_ext_rerp 가 적고 여기서는 받아 보기만 — 2026-10-11 "여기서는 모니터링만").
//   "참여연구원들에게 공유할 수 있게 설정까지" → 폴더를 만들 때의 참여연구원 자동 공유는 kr_ext_rerp 가 하고, 받는 쪽은 "나와 공유"에서 과제 폴더를 저절로 찾거나 주소를 넣는다.
//
// 파일 모양·병합 규칙은 **kr_ext_rerp 의 lib/prjdoc.js(v2)가 정본**이고 여기서 바꾸지 않는다(rerp/prjdoc.js 로 옮겨 온다):
//   연차 파일 = { v:2, kind:'year', project:{ prjNo, prjNm, rspr, alias, aliasAt, jobId, io, start, end, note, …모르는 칸 보존 }, year:{ n, start, end('YYYY-MM') },
//                budget:[{ name, plan, at, by }], staff:{ plans, del }, research:[기록], changes:[{ id, date, kind, item, before, after, reason, by, at, auto, …key 보존 }], updatedAt, updatedBy }
//   병합 — project 의 ERP 칸(prjNo·prjNm·rspr)은 rERP 값, alias 는 aliasAt 큰 쪽, jobId·io·start·end·note·모르는 칸은 파일 updatedAt 이 받은 시각(at)보다 뒤면 파일 것; budget 은 줄 전체를 한 덩이로 at 큰 쪽(빈 쪽은 못 이김);
//   changes 는 id 합집합(500); research 는 판 → 넣은 시각. 그 밖은 rerp/prjdoc.js 머리 주석.
//
// 이 장부(src/rnd.js)와 파일의 대응:
//   project 칸  ← 과제: prjNo·prjNm 은 이어 둔 rERP(years[n].erp — 그 연차에 없으면 이어 둔 어느 연차)의 것, 없으면 prjNm 은 과제명 · rspr ← lead · alias/aliasAt · jobId ← job · io · start/end · note,
//                 그리고 이 장부만 아는 칸을 **모르는 칸**으로 실어 보존한다 — wsId(장부 id: 다른 기기가 같은 id 를 쓰게), code(과제번호 — 국가과제번호일 수 있음), calendar(차년도를 1월 1일에 끊는가).
//                 과제 정보의 다른 기기 맞춤은 이제 이 칸이 맡는다(옛 src/rndnote.js 의 「[R&D 과제 정보] KRS WORKSPACE」 페이지는 없다 — 별도 파일 없음).
//   budget      ← 그 차년도 비목 줄의 **계획**만(item → name, plan). 집행(used)·erpKey 는 rERP/이 브라우저 몫이라 올리지도 받지도 않는다. 줄의 at·by 는 배선이 준다(아래 memo).
//   changes     ← 그 차년도 변경이력 그대로(by·at 가 없으면 배선이 준 이름·0). 받을 때도 그대로(합집합) — 받은 변경으로 변경이력을 **다시 만들지 않는다**(만든 기기가 이미 남겼다).
//   research    ← rerp/research.js 기록(storage researchPlans — YAML 을 넣을 때 남긴 것) 가운데 이 과제(과제명·과제번호가 같은 것)·그 차년도의 것. 진행 기록(logs)은 파일에 칸이 없어 이 브라우저에만 남는다.
//   참여연구원 지급계획(staff)은 올리지도 받지도 않는다(2026-10-18 저녁: WORKSPACE 는 rERP 에서 직접 읽어 보이기만).
// 배선(rndpanel.js)이 쓰는 법:
//   열쇠 = shareKeyOf(과제) — rERP 에 이어졌으면 과제번호, 아니면 Job Id, 그것도 없으면 장부 id. loadLocal().projects[열쇠] = localProjectOf(과제), staff.plans[`열쇠@n`] = localPlanOf(과제, n, 열쇠, { at, by })(예산 줄을 실어 가는 최소 계획 —
//   want.staff 를 끄면 파일의 staff 로는 가지 않고 budget 줄과 year.start/end 로만 쓰인다), changes[`열쇠@n`] = yearOf(…).changes, research = researchOf(기록 맵, 과제, 열쇠).
//   예산 줄의 at: 장부에는 고친 시각이 없으니 st.share.memo[`열쇠@n`] = { h: budgetHash(차년도), at } 로 — 지문이 같으면 그때의 at, 다르면 지금(이 기기에서 고침), 지문이 없으면(처음) 0(파일 쪽이 기준). 받은 뒤에는 { h: 새 지문, at: 파일의 at }.
//   saveLocal('budget'|'changes') → applyYear(과제, n, part, data) · saveLocal('project'|'alias') → applyProject(장부, 열쇠, data, memo) — data.at 는 memo[열쇠].at 로 남아 다음 loadLocal 의 projects[열쇠].at(mergeProject 의 localAt).
//   받은 연구내용은 saveLocal('research').map 을 rerp/research.js save 로(기록의 prjNo 가 열쇠로 채워져 있다 — 이 저장소는 그 칸을 rERP 잇기에 쓰지 않는다).
//   지운 과제: 배선이 그 과제의 파일 project 칸에 deletedAt(ms)을 적어 퍼뜨리면 applyProject 가 받아 장부에서 지운다(모르는 칸이라 파일 updatedAt 규칙으로 퍼진다).

import { normalizeProject, normalizeSupport, newId, yearsOf, currentYear, aliasOwner, isYmd, yearBook, blankYear, MAX_PROJECTS, MAX_YEARS, CHANGE_KINDS } from './rnd.js';
import { linkOf } from './rnderp.js';
import RS from '../rerp/research.js';

export const SHARE_KEY = 'rndShare';
/** 공유 폴더 칸을 비웠을 때의 밑폴더 — 내 OneDrive 문서 라이브러리 아래(kr_ext_rerp 설정의 기본과 같은 자리). */
export const DEFAULT_BASE = '업무/shared';
/** 연차 파일 project 칸에서 이 장부만 아는 칸(정본의 모르는 칸으로 보존된다). */
export const WS_EXTRA = Object.freeze(['wsId', 'code', 'calendar']);
/** 연구내용 기록에서 받는 쪽 연결 칸 — 파일에는 싣지 않는다(rerp/prjdoc.js LOCAL_REC 과 같다). */
const LOCAL_REC = ['prjNo', 'prjNm', 'linkBy', 'src'];

const str = (v, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\r\n?/g, '\n').trim().slice(0, max) : '');
const num = (v) => (Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== '' && v !== null && typeof v !== 'boolean' ? Number(v) : 0);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const keyOf = (s) => String(s ?? '').replace(/\s/g, '').toLowerCase();
/** 비목 이름 견주기 — 직접비/·간접비/ 머리와 공백·가운뎃점·빗금을 뗀다(src/rndyaml.js sameItem 과 같은 눈). */
const itemKey = (s) => String(s ?? '').replace(/^(직접비|간접비)\//, '').replace(/[\s·/]/g, '').toLowerCase();
const money = (v) => { if (typeof v === 'string') v = v.replace(/[,\s원₩]/g, ''); if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };
const ym = (s) => (isYmd(s) ? s.slice(0, 7) : '');
const d8 = (s) => (isYmd(s) ? s.replace(/-/g, '') : '');

/** 저장해 두는 공유 형편(chrome.storage 의 rndShare). folder 는 공유 폴더 주소(비면 rERP 확장의 설정, 그것도 없으면 내 OneDrive 의 DEFAULT_BASE), folderCache 는 푼 밑폴더(배선이 둔다), memo 는 열쇠마다 받은 시각·지문, del 은 묘비.
 *  peer 는 마지막으로 물어 둔 rERP 확장(kr_ext_rerp)의 공유 폴더 설정({ id, folder, driveHost, enabled, path, url, version, at } — 2026-10-19 "이 링크 공통으로 맞춰봐", 안 닿으면 {}), effective 는 마지막으로 쓴 밑폴더의 열쇠(배선이 바뀜을 알아채 캐시를 버리는 데 — 기본은 ''). */
export function normalizeShare(raw) {
  const o = obj(raw) || {};
  const s = (v, max = 600) => (typeof v === 'string' ? v.slice(0, max) : '');
  const map = (v) => obj(v) || {};
  // shareWith: 과제 폴더를 새로 만들 때 참여연구원에게 자동 공유(편집) — 'participants'(기본, rerp 설정과 같음) | 'none' (2026-10-19 — 카드의 체크)
  return { on: o.on === true, folder: s(o.folder, 2000).trim(), folderCache: map(o.folderCache), at: Number.isFinite(o.at) ? o.at : 0, memo: map(o.memo), del: map(o.del), last: s(o.last), error: s(o.error), shareWith: o.shareWith === 'none' ? 'none' : 'participants', peer: map(o.peer), effective: s(o.effective, 4100) };
}

/* ------------------------------------------------------------ 열쇠 */

/** 이어 둔 rERP — years[n].erp, 그 연차에 없으면 이어 둔 가장 낮은 연차의 것. 없으면 null. */
function erpOf(p, n = 0) {
  const years = obj(p?.years) || {};
  const hit = years[n]?.erp;
  if (hit?.prjNo) return hit;
  for (const k of Object.keys(years).map(Number).filter((x) => Number.isInteger(x) && x >= 1).sort((a, b) => a - b)) if (years[k]?.erp?.prjNo) return years[k].erp;
  return null;
}
/** 과제의 rERP 과제번호(이어 둔 것). 없으면 ''. */
export const erpNoOf = (p, n = 0) => str(erpOf(p, n)?.prjNo, 40);
/** 과제가 이어 둔 모든 rERP 과제번호(연차마다 다를 수 있다). */
const erpNosOf = (p) => [...new Set(Object.values(obj(p?.years) || {}).map((y) => str(y?.erp?.prjNo, 40)).filter(Boolean))];
/** 공유 열쇠 — 파일 project.prjNo 자리에 가는 값: rERP 과제번호 → Job Id → 장부 id. 폴더 이름(약칭 → Job Id → 열쇠)은 정본 folderNameFor 가 정한다. */
export const shareKeyOf = (p, n = 0) => erpNoOf(p, n) || str(p?.job, 40) || str(p?.id, 40);

/* ------------------------------------------------------------ 과제 → 파일 */

/** 장부 과제 → 연차 파일의 project 칸(정본 PROJECT_ORDER 차례 뒤에 이 장부의 칸 wsId·code·calendar). n 은 rERP 를 고를 연차. */
export function projectOf(p, n = 0) {
  const erp = erpOf(p, n);
  return {
    prjNo: str(erp?.prjNo, 40), prjNm: str(erp?.prjNm) || str(p?.name), rspr: str(p?.lead), alias: str(p?.alias), aliasAt: num(p?.aliasAt),
    jobId: str(p?.job), io: str(p?.io), start: isYmd(p?.start) ? p.start : '', end: isYmd(p?.end) ? p.end : '', note: str(p?.note, 1000),
    support: normalizeSupport(p?.support), supportAt: num(p?.supportAt),   // 행정지원 — 양쪽이 고치는 칸(정본 BOTH_FIELDS, supportAt 큰 쪽) — 2026-10-19
    wsId: str(p?.id, 40), code: str(p?.code), calendar: p?.calendar === true,
  };
}

/** loadLocal().projects[열쇠] — project 칸 + 이 기기만의 칸(anl 현재 차년도 · stDt/endDt 그 차년도 기간 YYYYMMDD — 정본 yearSpan 의 바탕 · at 받은 시각). */
export function localProjectOf(p, n = 0, { at = 0, today } = {}) {
  const ys = yearsOf(p);
  const cur = currentYear(p, today);
  const y = ys.find((x) => x.n === cur) || ys[0];
  return { ...projectOf(p, n), anl: cur, stDt: d8(y.start), endDt: d8(y.end), at: num(at) };
}

/** 그 차년도 비목 줄 가운데 계획이 적힌 줄 → 파일 budget 줄 [{ name, plan, at, by }]. */
const budgetRowsOf = (y, at = 0, by = '') => (Array.isArray(y?.budget) ? y.budget : []).filter((r) => str(r?.item, 60) && r.plan != null).map((r) => ({ name: str(r.item, 60), plan: r.plan, at: num(at), by: str(by, 40) }));
/** 예산 계획의 지문 — 지난번에 맞춘 뒤로 이 기기에서 고쳤는지 본다(배선의 memo). */
export const budgetHash = (y) => JSON.stringify(budgetRowsOf(y).map((r) => [r.name, r.plan]));

/** 그 차년도 변경이력 → 파일 changes(by 가 없으면 by, at 가 없으면 0 — 모르는 칸 key 는 그대로). */
const changesOf = (y, by = '') => (Array.isArray(y?.changes) ? y.changes : []).filter((c) => obj(c) && c.id).map((c) => {
  const out = { id: str(c.id, 40), date: isYmd(c.date) ? c.date : '', kind: CHANGE_KINDS.includes(c.kind) ? c.kind : '기타', item: str(c.item, 100), before: str(c.before, 300), after: str(c.after, 300), reason: str(c.reason, 1000), by: str(c.by, 40) || str(by, 40), at: num(c.at), auto: c.auto === true };
  if (c.key) out.key = c.key;
  return out;
});

/**
 * 이 과제의 연구내용 기록(rerp/research.js 의 researchPlans 맵 또는 목록) — 과제명(띄어쓰기·기호 무시)이나 과제번호가 같은 기록. n 을 주면 그 차년도만.
 * loadLocal().research 모양으로 { [id]: { …기록, prjNo: 열쇠, prjNm: 과제명 } } — 정본 fromLocalYear 가 prjNo 로 이 과제 것을 고른다.
 */
export function researchOf(recs, p, key = '', n = 0) {
  const list = Array.isArray(recs) ? recs : Object.values(obj(recs) || {});
  const nm = RS.normName(p?.name), code = keyOf(p?.code);
  const out = {};
  if (!nm && !code) return out;
  for (const r of list) {
    if (!obj(r) || !r.id || !r.name || !(Number(r.n) > 0)) continue;
    if (n && Number(r.n) !== n) continue;
    if (!((nm && RS.normName(r.name) === nm) || (code && keyOf(r.code) === code))) continue;
    out[r.id] = { ...r, prjNo: str(key, 40) || str(r.prjNo, 40), prjNm: str(p?.name) };
  }
  return out;
}
/** 기록에서 받는 쪽 연결 칸을 뺀 사본 — 파일에 싣는 모양. */
export const cleanRec = (rec) => { const o = { ...rec }; for (const k of LOCAL_REC) delete o[k]; return o; };

/**
 * 장부 과제의 한 차년도 → 연차 파일 몫 { year:{ n, start, end('YYYY-MM') }, budget, changes, research }.
 * opts: key(공유 열쇠 — research 의 prjNo), research(기록 맵), budgetAt·by(예산 줄의 at·by — 머리 주석의 memo 규칙), by(변경이력의 빈 by).
 */
export function yearOf(p, n, { key = '', research = null, budgetAt = 0, by = '' } = {}) {
  const span = yearsOf(p).find((y) => y.n === n) || { start: '', end: '' };
  const y = obj(p?.years)?.[n] || null;
  return {
    year: { n, start: ym(span.start), end: ym(span.end) },
    budget: budgetRowsOf(y, budgetAt, by),
    changes: changesOf(y, by),
    research: Object.values(researchOf(research, p, key || shareKeyOf(p, n), n)).map(cleanRec),
  };
}

/**
 * loadLocal().staff.plans[`열쇠@n`] — 예산 줄을 실어 가는 **최소 사업비 계획**(정본 normalizePlanEntry 모양: 사람 없음). 정본 fromLocalYear 가 이 계획의 budget·at·by 로 파일 budget 줄을, from/to 로 year.start/end 를 만든다.
 * 계획이 적힌 줄이 없으면 null(그 연차는 예산을 올리지 않는다 — 파일 것을 받기만). want.staff 를 끄므로 파일의 staff 칸으로는 가지 않는다.
 */
export function localPlanOf(p, n, key, { at = 0, by = '' } = {}) {
  const rows = budgetRowsOf(obj(p?.years)?.[n]);
  if (!rows.length) return null;
  const span = yearsOf(p).find((y) => y.n === n) || { start: '', end: '' };
  return { prjNo: str(key, 40) || shareKeyOf(p, n), year: n, prjNm: str(p?.name), from: ym(span.start), to: ym(span.end), budgetPay: null, budget: rows.map((r) => ({ name: r.name, plan: r.plan })), basis: 'rerp', src: 'erp', people: [], at: num(at), by: str(by, 40), note: '' };
}

/* ------------------------------------------------------------ 파일 → 과제 */

/**
 * 파일(또는 그 project 칸)이 장부의 어느 과제인가 — wsId(장부 id) → prjNo(이어 둔 rERP 과제번호; 이어지지 않은 과제의 파일은 열쇠가 Job Id·장부 id 라 그것도 본다) → code(과제번호) → 과제명 차례. 없으면 null.
 */
export function matchProject(book, doc) {
  const src = obj(doc?.project) || obj(doc) || {};
  const ps = Array.isArray(book?.projects) ? book.projects : [];
  const wsId = str(src.wsId, 40);
  if (wsId) { const p = ps.find((q) => q.id === wsId); if (p) return p; }
  const prjNo = str(src.prjNo, 40);
  if (prjNo) {
    const p = ps.find((q) => erpNosOf(q).includes(prjNo)) || ps.find((q) => q.id === prjNo) || ps.find((q) => q.job && q.job === prjNo);
    if (p) return p;
  }
  const code = keyOf(src.code);
  if (code) { const p = ps.find((q) => keyOf(q.code) === code); if (p) return p; }
  const name = keyOf(src.prjNm);
  if (name) { const p = ps.find((q) => keyOf(q.name) === name); if (p) return p; }
  return null;
}

/** 별칭·행정지원 칸(정본 toLocalYear 의 alias · support)에만 있는 칸 — 이것뿐인 payload 로는 과제를 만들지 않는다(applyProject). */
const ALIAS_ONLY = new Set(['alias', 'aliasAt', 'support', 'supportAt', 'at']);

/** 열쇠로 과제 찾기 — 장부 id → Job Id → 이어 둔 rERP 과제번호 → memo 에 적어 둔 id. */
function byKey(book, key, memo) {
  const ps = book.projects;
  if (!key) return null;
  const hit = ps.find((q) => q.id === key) || ps.find((q) => q.job && q.job === key) || ps.find((q) => erpNosOf(q).includes(key));
  if (hit) return hit;
  const id = str(obj(memo?.[key])?.id, 40);
  return (id && ps.find((q) => q.id === id)) || null;
}

/** 별칭을 과제끼리 겹치지 않게 — 다른 과제가 쓰는 별칭이면 '-2' · '-3' … 을 붙인다(aliasOwner 규칙). 고쳤으면 aliasAt 은 지금(이 기기가 늦게 고친 것으로 퍼진다). */
function settleAlias(book, p, alias, aliasAt, now) {
  const a = str(alias, 60);
  if (!a) return { alias: '', aliasAt: num(aliasAt), fixed: false };
  if (!aliasOwner(book, a, p.id)) return { alias: a, aliasAt: a === p.alias ? Math.max(num(aliasAt), num(p.aliasAt)) : num(aliasAt) || now, fixed: false };
  let fixed = a;
  for (let i = 2; i < 100; i++) {
    const cand = `${a}-${i}`.slice(0, 60);
    if (!aliasOwner(book, cand, p.id)) { fixed = cand; break; }
  }
  return { alias: fixed, aliasAt: now, fixed: true };
}

/**
 * 파일의 project 칸(병합 결과 — 정본 toLocalYear 의 project·alias 처럼 **일부 칸만** 올 수도 있다: undefined 인 칸은 건드리지 않는다)을 장부에 들인다.
 * @param {object} book 장부(바꾸지 않는다 — 새 장부를 돌려준다)
 * @param {string} key 공유 열쇠(rERP 과제번호 · Job Id · 장부 id) — 칸으로 못 찾을 때의 열쇠
 * @param {object} project { prjNo?, prjNm?, rspr?, alias?, aliasAt?, jobId?, io?, start?, end?, note?, support?, supportAt?, wsId?, code?, calendar?, deletedAt?, at? }
 * @param {object} memo st.share.memo — 열쇠마다 { at(받은 시각), id(장부 id) }
 * @param {{ now?: number, n?: number }} opts n 은 파일의 연차(새 과제를 만들 때 prjNo 가 있으면 그 연차에 rERP 를 잇는다 — 다음 맞춤의 열쇠가 같게)
 * @returns {{ book, memo, id, created, removed, skipped, renamed: [string,string]|null, changed: string[], alias, aliasFixed }}
 *   created — 장부에 없던 과제를 만듦(이름 → 별칭 → 열쇠 차례로 과제명, 열 개가 차면 skipped). removed — deletedAt(묘비)으로 지움. renamed — 파일의 wsId 로 장부 id 를 바꿈(다른 기기와 같은 id).
 *   **별칭만 온 payload**(정본 toLocalYear 의 alias 칸 — alias·aliasAt 뿐)로는 과제를 만들지 않는다(id 는 ''): 지운 과제의 열쇠(묘비·남은 기록)로 별칭이 되돌아올 때 빈 과제가 되살아나던 것(2026-10-19 검토).
 *   새 과제는 project 칸(jobId·io·… 가 있는 payload)에서만 — 배선은 먼저 온 별칭을 받아 두었다가 project 칸이 오면 함께 넣는다.
 *   받은 책임자·연구기간 변경으로 변경이력을 만들지 않는다(고친 기기가 이미 남겨 changes 로 온다).
 */
export function applyProject(book, key, project, memo = {}, { now = Date.now(), n = 0 } = {}) {
  const src = obj(project) || {};
  const k = str(key, 60);
  const projects = (Array.isArray(book?.projects) ? book.projects : []).map((p) => ({ ...p }));
  const current = { project: str(book?.current?.project, 40), year: { ...(obj(book?.current?.year) || {}) } };
  const nextMemo = { ...(obj(memo) || {}) };
  const res = { book: { projects, current }, memo: nextMemo, id: '', created: false, removed: false, skipped: false, renamed: null, changed: [], alias: '', aliasFixed: false };
  const like = { projects };
  let p = matchProject(like, { project: src }) || byKey(like, k, nextMemo);
  // 묘비 — 다른 기기에서 지운 과제
  if (num(src.deletedAt) > 0) {
    if (p) {
      projects.splice(projects.indexOf(p), 1);
      delete current.year[p.id];
      if (current.project === p.id) current.project = projects[0]?.id || '';
      res.removed = true;
      res.id = p.id;
    }
    delete nextMemo[k];
    return res;
  }
  const has = (f) => src[f] !== undefined;
  if (!p) {
    if (Object.keys(src).every((f) => ALIAS_ONLY.has(f))) return res;   // 별칭만으로는 만들지 않는다 — 어느 과제인지 모른다(지운 과제의 열쇠일 수 있다)
    if (projects.length >= MAX_PROJECTS) { res.skipped = true; return res; }
    const name = str(src.prjNm) || str(src.alias, 60) || k;
    p = normalizeProject({ id: str(src.wsId, 40), name, code: src.code, job: src.jobId, io: src.io, lead: src.rspr, start: src.start, end: src.end, note: src.note, calendar: src.calendar === true });
    if (projects.some((q) => q.id === p.id)) p.id = newId();
    p.aliasAt = 0;
    const prjNo = str(src.prjNo, 40);
    const yn = Number.isInteger(n) && n >= 1 && n <= MAX_YEARS ? n : 0;
    if (prjNo && yn) yearBook(p, yn).erp = linkOf({ prjNo, prjNm: str(src.prjNm), rspr: str(src.rspr, 40) }, { auto: false, now });
    projects.push(p);
    res.created = true;
    res.changed.push('created');
  } else {
    const idx = projects.indexOf(p);
    p = { ...p };
    projects[idx] = p;
    const set = (f, v) => { if (p[f] !== v) { p[f] = v; res.changed.push(f); } };
    // ERP 칸 — 이어진 과제의 과제명은 rERP 것(years[n].erp.prjNm)이 따로 있으니 장부 과제명은 두고, 이어지지 않은 과제만 받는다. 책임자는 받는다.
    if (has('prjNm') && str(src.prjNm) && !erpNoOf(p)) set('name', str(src.prjNm));
    if (has('rspr') && typeof src.rspr === 'string') set('lead', str(src.rspr, 40));
    if (has('jobId')) set('job', str(src.jobId, 20).replace(/\s+/g, ''));
    if (has('io')) set('io', str(src.io, 20).replace(/\s+/g, '').toUpperCase());
    if (has('code')) set('code', str(src.code, 40));
    if (has('note')) set('note', str(src.note, 1000));
    if (has('calendar') && typeof src.calendar === 'boolean') set('calendar', src.calendar);
    if (has('start') || has('end')) {
      const start = has('start') ? (isYmd(src.start) ? src.start : '') : p.start;
      let end = has('end') ? (isYmd(src.end) ? src.end : '') : p.end;
      if (!start || (end && end < start)) end = '';
      set('start', start);
      set('end', end);
    }
    // 다른 기기가 따로 만든 같은 과제 — 파일의 id 로 맞춰 둔다(옛 원노트 맞추기의 renames 와 같은 뜻)
    const wsId = str(src.wsId, 40);
    if (wsId && wsId !== p.id && !projects.some((q) => q.id === wsId)) {
      res.renamed = [p.id, wsId];
      if (current.project === p.id) current.project = wsId;
      if (p.id in current.year) { current.year[wsId] = current.year[p.id]; delete current.year[p.id]; }
      p.id = wsId;
      res.changed.push('id');
    }
  }
  if (has('alias')) {
    const a = settleAlias(like, p, src.alias, src.aliasAt, now);
    if (a.alias !== p.alias) res.changed.push('alias');
    p.alias = a.alias;
    p.aliasAt = a.aliasAt;
    res.aliasFixed = a.fixed;
  } else if (has('aliasAt') && num(src.aliasAt) > num(p.aliasAt)) p.aliasAt = num(src.aliasAt);
  // 행정지원(양쪽이 고침 — supportAt 큰 쪽은 정본 mergeProject 가 이미 골랐다, 2026-10-19): 온 그대로 두되 이름 없는 줄·겹친 이름은 걷고, 시각은 큰 쪽만
  if (has('support')) {
    const sup = normalizeSupport(src.support), at = num(src.supportAt);
    if (JSON.stringify(sup) !== JSON.stringify(normalizeSupport(p.support))) res.changed.push('support');
    p.support = sup;
    if (at > num(p.supportAt)) { p.supportAt = at; if (!res.changed.includes('support')) res.changed.push('supportAt'); }
  } else if (has('supportAt') && num(src.supportAt) > num(p.supportAt)) { p.supportAt = num(src.supportAt); res.changed.push('supportAt'); }
  const prev = obj(nextMemo[k]) || {};
  nextMemo[k] = { ...prev, id: p.id, at: Math.max(num(src.at), num(prev.at)) };
  res.id = p.id;
  res.alias = p.alias;
  return res;
}

/**
 * saveLocal 의 한 칸을 과제의 그 차년도에 되돌려 넣는다(과제를 바꾸지 않고 새 과제를 돌려준다).
 *   part 'budget' — data = { budget:[{ name, plan, at, by }], at, by }(정본 toLocalYear 의 budget): 이름(비목 눈으로 견줌)이 같은 줄의 **계획**만 맞추고, 없는 비목은 줄을 더하며, 파일에 없는 비목의 계획은 비운다(집행·erpKey·줄 id 는 그대로).
 *   part 'changes' — data = { list }(또는 목록): 그 차년도 변경이력을 합집합(이미 이 기기 것을 품은 것)으로 갈아 넣는다.
 * @returns {{ project: object, changed: boolean }}
 */
export function applyYear(p, n, part, data) {
  const years = { ...(obj(p?.years) || {}) };
  const cur = years[n] ? { ...years[n] } : blankYear();
  let changed = false;
  if (part === 'budget') {
    const rows = Array.isArray(data?.budget) ? data.budget : Array.isArray(data) ? data : [];
    const budget = (Array.isArray(cur.budget) ? cur.budget : []).map((r) => ({ ...r }));
    const seen = new Set();
    for (const f of rows) {
      const name = str(f?.name, 60), plan = money(f?.plan);
      if (!name) continue;
      let row = budget.find((r) => !seen.has(r.id) && itemKey(r.item) === itemKey(name));
      if (!row) {
        if (plan == null) continue;
        row = { id: newId(), item: name, plan: null, used: null };
        budget.push(row);
        changed = true;
      }
      seen.add(row.id);
      if (row.plan !== plan) { row.plan = plan; changed = true; }
    }
    for (const r of budget) if (!seen.has(r.id) && r.plan != null) { r.plan = null; changed = true; }
    cur.budget = budget;
  } else if (part === 'changes') {
    const list = (Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : []).filter((c) => obj(c) && c.id).map((c) => {
      const out = { id: str(c.id, 40), date: isYmd(c.date) ? c.date : '', kind: CHANGE_KINDS.includes(c.kind) ? c.kind : '기타', item: str(c.item, 100), before: str(c.before, 300), after: str(c.after, 300), reason: str(c.reason, 1000), auto: c.auto === true };
      if (str(c.by, 40)) out.by = str(c.by, 40);
      if (num(c.at)) out.at = num(c.at);
      if (c.key) out.key = c.key;
      return out;
    });
    changed = JSON.stringify(list) !== JSON.stringify(Array.isArray(cur.changes) ? cur.changes : []);
    cur.changes = list;
  } else return { project: p, changed: false };
  if (!changed) return { project: p, changed: false };
  years[n] = cur;
  return { project: { ...p, years }, changed: true };
}

/* ------------------------------------------------------------ 참여인력 공유 권한(2026-10-19 사용자 지정: "sharepoint 링크 읽기, 쓰기 권한 설정 … 아이콘에 공유아이콘 … 체크하면 반영") */

/** 이름 → 찾은 사람의 캐시(chrome.storage 의 rndSharePeople — rerp/spstore.js findPeople 의 found 를 이름마다): { [이름]: { email, title, login, at } }. 이메일이 없는 것·모르는 것은 버린다. */
export const PEOPLE_KEY = 'rndSharePeople';
export function normalizePeople(raw) {
  const out = {};
  for (const [name, v] of Object.entries(obj(raw) || {})) {
    const n = str(name, 60).trim(), email = str(v?.email, 200).trim().toLowerCase();
    if (!n || !email.includes('@')) continue;
    out[n] = { email, title: str(v?.title, 200), login: str(v?.login, 300), at: num(v?.at) };
  }
  return out;
}

/**
 * 권한 표의 줄 — names(참여연구자·행정지원 차례, 나는 뺀다)와 폴더 권한(perms — rerp/spstore.js permissions: people[{ id, name, email, role, me }])을 **이메일**로 맞춘다(사이트 사용자 정보의 표시 이름은 영문이라 한글 이름으로는 못 맞춘다 — 실측 2026-10-19).
 * people 은 이름 → { email, title } 캐시(normalizePeople)에 이 세션의 찾기 결과({ ambiguous:[후보] } | { notFound:true })를 덮은 것. 폴더에만 있는 사람(이름 목록 밖 — 나·링크 그룹은 빼고)은 뒤에 extra:true 로 — 거둘 수 있게.
 * → [{ name, email, title(표시 이름), id(PrincipalId — 0 이면 폴더에 없음), role('owner'|'edit'|'read'|'other'|''), state(''|'lookup'(아직 못 찾음)|'ambiguous'|'notFound'), candidates, extra }]
 */
export function permRows(names, perms, people, { me = '' } = {}) {
  const map = obj(people) || {};
  const list = Array.isArray(perms?.people) ? perms.people : [];
  const meMail = str(perms?.me?.email, 200).trim().toLowerCase();
  const byMail = new Map();
  for (const q of list) { const em = str(q?.email, 200).trim().toLowerCase(); if (em && !byMail.has(em)) byMail.set(em, q); }
  const same = (a, b) => !!a && !!b && String(a).replace(/\s/g, '') === String(b).replace(/\s/g, '');
  const rows = [], used = new Set(), seen = new Set();
  for (const raw of Array.isArray(names) ? names : []) {
    const name = str(raw, 60).trim();
    if (!name || seen.has(name) || same(name, me)) continue;
    seen.add(name);
    const c = obj(map[name]);
    const email = str(c?.email, 200).trim().toLowerCase();
    const q = email ? byMail.get(email) : null;
    if (q) used.add(email);
    rows.push({ name, email, title: str(c?.title, 200) || str(q?.name, 200), id: q ? num(q.id) : 0, role: q ? str(q.role, 10) : '', state: email ? '' : Array.isArray(c?.ambiguous) ? 'ambiguous' : c?.notFound ? 'notFound' : 'lookup', candidates: Array.isArray(c?.ambiguous) ? c.ambiguous.map((x) => str(x, 200)) : [], extra: false });
  }
  for (const q of list) {
    const em = str(q?.email, 200).trim().toLowerCase();
    if (!em || used.has(em) || q?.me === true || (meMail && em === meMail) || same(q?.name, me)) continue;
    used.add(em);
    rows.push({ name: str(q.name, 200) || em, email: em, title: str(q.name, 200), id: num(q.id), role: str(q.role, 10), state: '', candidates: [], extra: true });
  }
  return rows;
}
