// 전자결재 과제(Job Id) 찾기 — 공문 창의 과제 찾기 팝업이 받는 R&D PMS 과제 목록(ListJSON_Ver2.ashx)에서 우리 과제의 줄을 규칙으로 고른다.
// 2026-10-16 사용자 지정: "검색할 때 과제 책임자로 우선 검색하고 유사도가 높은 0.5 이상인 걸 찾으면 … 과제 번호 칸을 따로 두되 일단 규칙식으로 검색해서
// 가장 높은 걸 가져오고 선택할 수 있도록".
//
//   ① Job Id(RND00202026 · RND-20-2026 꼴)가 있고 목록에 그 줄이 있으면 그 줄 하나.
//   ② 아니면 과제명 유사도(빈칸·기호·대소문자를 뗀 뒤 두 글자씩 묶은 Dice 계수 — 같으면 1)가 0.5 이상인 줄을
//      책임자(PMS 의 User_Name)가 같은 것 먼저, 그 안에서 유사도 높은 차례(같으면 진행 → 협약 중 → 그 밖, 그다음 최근 해)로 늘어놓는다.
//      책임자가 다른 줄도 뒤에 둔다 — 책임자가 바뀐 과제도 고를 수 있게.
// 순수하다 — 목록 받기는 부르는 쪽이 한다(R&D 탭 폼은 src/net.js 의 siteFetch, 공문 작성은 새 공문 창 안의 pageJob — src/gmwrite.js).

export const JOB_LIST_PATH = '/RnDPMS/View/PMS/ListJSON_Ver2.ashx';
/** 팝업(Get_PMSJobID.aspx)이 처음 뜰 때 부르는 것과 같은 조건 — 모든 과제(진행·완료·미선정 …)가 온다. */
export const JOB_QUERY = 'SYSTEMID=RD&SEARCHTYPE_P=true&SEARCHTYPE_N=true&SEARCHTYPE_J=0&SEARCHTYPE_C=0&SEARCHTEXT=&DEPTID=&FROMDATE=&TODATE=&PROJECT_CLASS=&CONTRACTOR=&IS_PROCESSING=true';
/** 이 유사도 아래는 후보로 두지 않는다. */
export const JOB_MIN = 0.5;
export const JOB_LIMIT = 5;

/** 전자결재 과제 번호 꼴인가 — RND00202026 · RND-20-2026. 국가과제 번호(RS-…)는 아니다(PMS 목록에 없다). */
export const isJobCode = (s) => /^rnd-?\d/i.test(String(s ?? '').trim());

const codeKey = (s) => String(s ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();
const nameKey = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');

/** 받은 글(JSON — 문자열로 한 번 더 싸여 올 때도 있다) → 줄 배열. 못 읽으면 []. */
export function parseJobRows(text) {
  try {
    let data = typeof text === 'string' ? JSON.parse(text) : text;
    if (typeof data === 'string') data = JSON.parse(data);
    return Array.isArray(data) ? data : (data && Array.isArray(data.Table) ? data.Table : []);
  } catch {
    return [];
  }
}

/** PMS 한 줄 → 쓰는 칸만. 이미 줄인 줄(id 가 있는 것)은 그대로. */
export function slimJob(r) {
  if (!r || typeof r !== 'object') return null;
  if ('id' in r && !('Project_ID' in r)) return r;
  const s = (v) => (v == null ? '' : String(v));
  return {
    id: s(r.Project_ID), dash: s(r.Project_ID_DASH), name: s(r.Project_Name), lead: s(r.User_Name), leadId: s(r.User_ID),
    dept: s(r.DeptName), deptCode: s(r.DEPT_CODE), proc: s(r.Process), year: s(r.YEAR), turn: s(r.TURN),
    from: s(r.FromDate_Contract), to: s(r.ToDate_Contract), kind: s(r.Classification),
  };
}

/** 과제명 유사도 0~1 — 두 글자씩 묶은 Dice 계수(겹치는 묶음은 개수만큼). 뗀 뒤 같으면 1, 한쪽이 한 글자 이하면 같을 때만 1. */
export function similarity(a, b) {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let both = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g) || 0;
    if (n) {
      both++;
      grams.set(g, n - 1);
    }
  }
  return (2 * both) / (x.length - 1 + y.length - 1);
}

const PROC_RANK = { 진행: 0, '협약 중': 1 };
const procRank = (p) => PROC_RANK[p] ?? 2;

/**
 * 과제 목록에서 이 과제의 후보를 고른다(규칙은 머리말). list[0] 이 가장 높은 것이다.
 * @param {object[]} rows PMS 줄(그대로든 slimJob 을 지난 것이든)
 * @param {{job?:string, name?:string, lead?:string}} want Job Id · 과제명 · 과제책임자
 * @returns {{by:'job'|'lead'|'name'|'none', list:(ReturnType<typeof slimJob> & {score:number, sameLead:boolean})[]}}
 *   by — job: Job Id 로 찾음, lead: 맨 위가 책임자가 같은 줄, name: 책임자가 같은 줄은 없고 과제명만, none: 0.5 이상이 없음
 */
export function rankJobs(rows, { job = '', name = '', lead = '' } = {}, { min = JOB_MIN, limit = JOB_LIMIT } = {}) {
  const all = (Array.isArray(rows) ? rows : []).map(slimJob).filter((r) => r && r.id);
  const who = nameKey(lead);
  const mark = (r, score) => ({ ...r, score: Math.round(score * 100) / 100, sameLead: !!who && nameKey(r.lead) === who });
  if (isJobCode(job)) {
    const key = codeKey(job);
    const hit = all.find((r) => codeKey(r.id) === key || codeKey(r.dash) === key);
    if (hit) return { by: 'job', list: [mark(hit, similarity(name, hit.name) || 1)] };
  }
  const list = all.map((r) => mark(r, similarity(name, r.name)))
    .filter((r) => r.score >= min)
    .sort((a, b) => (b.sameLead - a.sameLead) || (b.score - a.score) || (procRank(a.proc) - procRank(b.proc)) || (Number(b.year) || 0) - (Number(a.year) || 0))
    .slice(0, limit);
  return { by: !list.length ? 'none' : list[0].sameLead ? 'lead' : 'name', list };
}

/** 후보 한 줄의 글 — "RND-20-2026 과제명 · 책임자 · 진행 · 유사도 0.92". */
export const jobLine = (r) => [`${r.dash || r.id} ${r.name}`, r.lead, r.proc, `유사도 ${Number(r.score).toFixed(2)}`].filter(Boolean).join(' · ');
