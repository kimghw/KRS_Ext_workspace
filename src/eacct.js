// 회계(e-accounting.krs.co.kr) 조회 — R&D 과제의 회계 I/O 코드(과제코드)와 계정과목(보조세목)별 예산을 읽는다(2026-10-17 사용자 지정: "R&D 에서 과제 등록 할때 jobid 갖어
// 오는데 … 계정과목코드 계정과목명, 예산부서코드 또는 I/O 입력 예산금액도 같이 조회 해야 하거든 … 부서 예산요약 가보면 해당연도 부서/과제 코드랑 부서/과제명. 과제코드 계정명,
// 과제명 이런거 e-accounting.krs.co.kr 에 조회할 수 있도록"). 구매요청서(구매의뢰)의 예산 내역 표(계정과목코드·계정과목명·I/O 코드·I/O 명·예산금액)가 여기서 채워진다.
//
// 실측(2026-10-17 CDP, 읽기 전용 — 레포트 > 예산 레포트 > 부서 예산 요약(CO10021)·과제 예산/실적(CO10023)):
//   화면은 /App_Run/App_Style/PageStyle050.aspx?RunMode=RUN&PageID=<PageID>&PageGrpID=CO10020 — 안에 `CallsUrl = '<PageID>_<번호>'` 가 박혀 있고(컴파일된 처리기 이름 —
//   번호가 바뀔 수 있어 페이지에서 읽는다, 없으면 아래 상수), 조회는 모두 POST /App_Run/App_Compile/<CallsUrl>.aspx 에
//   `chk=<jsUsr.js 의 xmlRequestKey>&mode=<함수>&ColName=<열 이름>&snddata=<ROOT><IMPORT …='…' /></ROOT>` (application/x-www-form-urlencoded) 다. 답은 XML 한 줄 —
//   <ROOT><RTNDATA ERR='S' ERRDESC=''><ROWS …/>…</RTNDATA></ROOT> (목록) 또는 <RTNCBO CBODATA='코드' CBOTEXT='글'/> (콤보). chk 는 서버가 보지 않았다(틀려도 답이 온다).
//   부서 예산 요약 getlist1 (GJAHR 회계연도 · GUB A 부서/C 과제 · GUB3 S 요약/D 세부 · DEPTFR·DEPTTO 부서나 과제 범위 · GUB2 C 지출 · PRINT 3 보조세목 · HKONT '' 전체 계정)
//     → 줄마다 FISTL 부서/과제 코드(과제는 2145NR0124 꼴 I/O) · BEZEICH 부서/과제명(20자쯤에서 잘린다) · RCMMTITEM3 보조세목 코드(603010304) · BEZEI3 계정명(수탁과제(국가)_연구활동비)
//       · GICHO 기초 예산 · JUNYONG 전용 예산(+/-) · SIL 실적 금액 · YAK 임시전표금액 · GAYONG 가용 예산 (금액은 천 단위 쉼표와 앞 공백).
//   과제 콤보 getOrder (snddata <ROOT><IMPORT FYEAR='2026' /></ROOT>) → 내 부서의 과제(I/O) 목록 — CBOTEXT 는 '2145NR0124-R-대용량 모듈러 … 개발'(코드-이름, 45자쯤에서 잘린다).
//   Load_Basic_Data (<ROOT><IMPORT /></ROOT>) → '1000{D}HER' (회사{D}내 부서 코드).
//   로그인은 e-accounting 자체 세션(eclass 와 따로) — 풀리면 답이 XML 이 아니다(로그인 화면·리다이렉트).
//
// 순수한 것(parse*·rankIo·budgetRows·normalizeAcct·orderBudgetOf — DOM·fetch 없음)과 조회(fetch*·eaCall — 확장에서 바로, host_permissions 로 쿠키가 실린다)가 같이 있다.
// 과제 이름 맞추기는 Job Id 찾기(src/jobid.js)와 같은 Dice 유사도에 앞머리 포함(잘린 이름)을 더한 것이다.

import { directFetch } from './net.js';
import { similarity } from './jobid.js';

export const EA_ORIGIN = 'https://e-accounting.krs.co.kr';
/** 사람이 로그인하러 여는 곳(로그아웃 상태면 로그인 폼으로 보낸다). */
export const EA_HOME = `${EA_ORIGIN}/App_Usr/UsrStart.aspx`;
/** 부서 예산 요약(레포트 > 예산 레포트) — 과제(I/O)·보조세목별 기초·전용·실적·가용 예산. calls 는 2026-10-17 실측의 처리기 이름(페이지에서 읽은 것이 이긴다). */
export const EA_PAGE = Object.freeze({ id: 'CO10021', grp: 'CO10020', calls: 'CO10021_0000038729' });
/** jsUsr.js 의 xmlRequestKey(2026-10-17) — 서버가 보지 않지만 페이지와 같은 꼴로 보낸다. */
export const EA_KEY = '8geZzZKIEn6caZQINaBa1757D1/Xv/yxvwXaiButV5';
/** 이 유사도 아래는 I/O 후보로 두지 않는다(Job Id 와 같다). */
export const IO_MIN = 0.5;
export const IO_LIMIT = 5;
/** 조회한 지 이만큼 지났으면 다시 받는다(rERP 와 같은 10분). */
export const ACCT_TTL_MS = 10 * 60 * 1000;
export const LOGIN_MESSAGE = '로그인이 필요합니다. e-accounting 에 로그인한 뒤 다시 조회하세요.';

/** 회계 I/O 코드 꼴인가 — 2145NR0124 · 2083LR9123 (네 자리 숫자 + 영문 둘 + 네 자리). 부서 코드(HER)는 아니다. */
export const isIoCode = (s) => /^\d{4}[A-Z]{2}\d{4}$/i.test(String(s ?? '').trim());

const text = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').slice(0, max).trim() : '');
const nameKey = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
/** 회계의 과제명은 'R-' 로 시작하고 잘린다 — 견줄 때 접두를 뗀다. */
const plainName = (s) => String(s ?? '').replace(/^\s*R\s*-\s*/i, '').trim();
/** '2145NR0124-R-대용량 …' → { code, name } — 콤보 글의 코드 접두를 뗀다. */
const splitCombo = (code, label) => {
  const m = String(label ?? '').match(/^\s*([0-9A-Z]{6,12})\s*-\s*(.*)$/i);
  return { code: text(code, 20) || (m ? m[1] : ''), name: plainName(m && nameKey(m[1]) === nameKey(code || m[1]) ? m[2] : label) };
};
/** '                   26,187,500' → 26187500. 비었거나 못 읽으면 0. */
export const amount = (v) => {
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : 0;
};
const unescapeXml = (s) => String(s).replace(/&(amp|lt|gt|quot|apos|#(\d+));/g, (_, k, d) => (d ? String.fromCodePoint(+d) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[k]));

/* ------------------------------------------------------------ 받은 글 읽기(순수) */

/**
 * 회계의 XML 답 → { ok, err, rows }. rows 는 <ROWS …/>·<RTNCBO …/> 의 속성을 객체로(값은 앞뒤 공백을 뗀 글). XML 이 아니면 ok false, err 는 로그인 안내.
 * ERR 이 S 가 아니면 ok false 에 ERRDESC. 정규식으로 읽는다 — 서버가 & 를 걷어 보내고(Svr_GetXmlData) 속성은 작은따옴표 하나뿐이라 DOMParser 가 없는 곳(service worker·검사)에서도 같다.
 */
export function parseEa(xml) {
  const s = String(xml ?? '').trim();
  if (!s.startsWith('<ROOT>')) return { ok: false, err: LOGIN_MESSAGE, rows: [] };
  const head = s.match(/<RTNDATA\s+([^>]*?)\/?>/i);
  const attrs = (body) => Object.fromEntries([...String(body).matchAll(/([A-Za-z_][\w]*)\s*=\s*'([^']*)'/g)].map((m) => [m[1], unescapeXml(m[2]).trim()]));
  const h = head ? attrs(head[1]) : {};
  if (!head || !/^S/i.test(h.ERR || '')) return { ok: false, err: h.ERRDESC || '회계가 답을 주지 않았습니다.', rows: [] };
  const rows = [...s.matchAll(/<(ROWS|RTNCBO)\s+([^>]*?)\/>/gi)].map((m) => attrs(m[2]));
  return { ok: true, err: '', rows };
}

/** 콤보 답 → [{ code, name, text }] — getOrder 의 과제 목록이면 name 은 코드·'R-' 접두를 뗀 과제명, text 는 받은 글 그대로. */
export function ioOptions(xml) {
  const got = parseEa(xml);
  if (!got.ok) return [];
  return got.rows.filter((r) => 'CBODATA' in r).map((r) => ({ ...splitCombo(r.CBODATA, r.CBOTEXT), text: r.CBOTEXT || '' })).filter((o) => o.code);
}

/**
 * 부서 예산 요약(getlist1 세부·보조세목)의 줄 → 계정 줄. 보조세목 코드가 없는 줄(요약의 관·항·목 줄)은 버린다.
 * @returns {{ io, ioName, dept, deptName, code, name, base, transfer, budget, actual, pending, available }[]}
 *   budget 은 기초 + 전용(당해 연도 배정액 — 구매요청서의 예산금액), available 은 회계의 가용 예산.
 */
export function budgetRows(xml) {
  const got = typeof xml === 'string' ? parseEa(xml) : { ok: true, rows: Array.isArray(xml) ? xml : [] };
  if (!got.ok) return [];
  return got.rows.filter((r) => text(r.RCMMTITEM3, 20)).map((r) => {
    const base = amount(r.GICHO);
    const transfer = amount(r.JUNYONG);
    return {
      io: text(r.FISTL, 20), ioName: plainName(text(r.BEZEICH, 120)), dept: text(r.KOSTL || r.KOSTV, 20), deptName: text(r.KTEXT || r.KOTXT, 60),
      code: text(r.RCMMTITEM3, 20), name: text(r.BEZEI3, 80), base, transfer, budget: base + transfer,
      actual: amount(r.SIL), pending: amount(r.YAK), available: amount(r.GAYONG),
    };
  });
}

/** 이름 유사도 — Dice(src/jobid.js)에, 잘린 이름이 긴 이름의 앞머리면 1. 회계의 과제명은 20~45자에서 잘려 온다. */
export function ioSimilarity(want, got) {
  const a = nameKey(plainName(want));
  const b = nameKey(plainName(got));
  if (!a || !b) return 0;
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 8 && long.startsWith(short)) return 1;
  return similarity(a, b);
}

/**
 * 과제 목록에서 이 과제의 I/O 후보를 고른다. list[0] 이 가장 높은 것이다.
 * @param {{code,name}[]} options ioOptions 의 목록
 * @param {{io?:string, name?:string}} want 적어 둔 I/O 코드(있고 목록에 있으면 그것 하나) · 과제명
 * @returns {{by:'io'|'name'|'none', list:{code,name,score}[]}}
 */
export function rankIo(options, { io = '', name = '' } = {}, { min = IO_MIN, limit = IO_LIMIT } = {}) {
  const all = (Array.isArray(options) ? options : []).filter((o) => o && o.code);
  const key = nameKey(io);
  const mark = (o, score) => ({ code: o.code, name: o.name, score: Math.round(score * 100) / 100 });
  if (key) {
    const hit = all.find((o) => nameKey(o.code) === key);
    if (hit) return { by: 'io', list: [mark(hit, ioSimilarity(name, hit.name) || 1)] };
  }
  const list = all.map((o) => mark(o, ioSimilarity(name, o.name))).filter((o) => o.score >= min)
    .sort((a, b) => (b.score - a.score) || a.code.localeCompare(b.code)).slice(0, limit);
  return { by: list.length ? 'name' : 'none', list };
}

/** 후보 한 줄의 글 — "2145NR0124 대용량 모듈러 … · 유사도 0.92". */
export const ioLine = (r) => [`${r.code} ${r.name}`, `유사도 ${Number(r.score).toFixed(2)}`].filter(Boolean).join(' · ');

/* ------------------------------------------------------------ 장부에 남는 것 */

/** 오늘(YYYY-MM-DD)의 회계연도 — 회계연도는 달력 해다. */
export const fiscalYearOf = (today) => String(today || '').slice(0, 4) || String(new Date().getFullYear());

/**
 * 과제에 남는 회계 스냅샷 — { year, at, io, ioName, dept, deptName, rows }. rows 는 budgetRows 의 줄(그 과제의 것만). 모양이 아니면 null.
 * at 은 조회 시각(ISO). 지난 해의 스냅샷도 그대로 둔다 — 보는 쪽이 year 로 가린다.
 */
export function normalizeAcct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const io = text(raw.io, 20);
  const year = String(raw.year ?? '').replace(/\D/g, '').slice(0, 4);
  if (!io || !year) return null;
  const rows = (Array.isArray(raw.rows) ? raw.rows : []).map((r) => ({
    code: text(r?.code, 20), name: text(r?.name, 80), base: amount(r?.base), transfer: amount(r?.transfer), budget: amount(r?.budget),
    actual: amount(r?.actual), pending: amount(r?.pending), available: amount(r?.available),
  })).filter((r) => r.code).slice(0, 60);
  return { year, at: text(raw.at, 40), io, ioName: text(raw.ioName, 120), dept: text(raw.dept, 20), deptName: text(raw.deptName, 60), rows };
}

/** 스냅샷이 이 해의 것이고 조회한 지 ttl 안인가. */
export function acctFresh(acct, { today = '', now = Date.now(), ttl = ACCT_TTL_MS } = {}) {
  if (!acct?.year || acct.year !== fiscalYearOf(today)) return false;
  const t = Date.parse(acct.at || '');
  return Number.isFinite(t) && now - t < ttl;
}

/**
 * 스냅샷에서 계정 이름(과제의 계정 — '연구활동비'·'연구재료비')에 맞는 줄 — 회계의 계정명은 '수탁과제(국가)_연구활동비' 꼴이라 끝이 같은 것, 없으면 품은 것. 없으면 null.
 * 계정이 비면 null(고르지 않는다).
 */
export function acctRowFor(acct, account) {
  const rows = acct?.rows || [];
  const k = nameKey(account);
  if (!k) return null;
  const tail = (r) => nameKey(String(r.name).split('_').pop());
  return rows.find((r) => tail(r) === k) || rows.find((r) => nameKey(r.name).endsWith(k)) || rows.find((r) => nameKey(r.name).includes(k)) || null;
}

/**
 * 구매요청서 예산 내역 표의 한 행에 넣을 값 — 과제의 회계 스냅샷에서. 계정에 맞는 줄이 있으면 계정과목코드·계정과목명·예산금액(기초+전용)까지, 없으면 I/O 코드·I/O 명만.
 * @param {{io?:string, acct?:object|null, account?:string}} project 공문의 과제(src/gongmun.js rndProjects — io·acct 는 R&D 탭의 것)
 * @returns {{ioCode:string, ioName:string, subjectCode:string, subjectName:string, budgetAmount:number|null}|null} 회계 I/O 가 없으면 null
 */
export function orderBudgetOf(project) {
  const io = text(project?.io, 20) || text(project?.acct?.io, 20);
  if (!io) return null;
  const acct = project?.acct && project.acct.io === io ? project.acct : null;
  const row = acctRowFor(acct, project?.account);
  return {
    ioCode: io, ioName: acct?.ioName || '',
    subjectCode: row?.code || '', subjectName: row?.name || '', budgetAmount: row ? row.budget : null,
  };
}

const wonText = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
/** 요약 글(src/rnd.js summaryText)에 붙는 회계 줄 — 스냅샷이 없으면 빈 배열. */
export function acctSummaryLines(acct) {
  const a = normalizeAcct(acct);
  if (!a) return [];
  const when = a.at ? ` · 조회 ${a.at.slice(0, 16).replace('T', ' ')}` : '';
  const lines = ['', `■ 회계 예산 (${a.year}년 · I/O ${a.io}${a.ioName ? ` ${a.ioName}` : ''}${when})`];
  if (!a.rows.length) lines.push('- 계정 줄 없음');
  for (const r of a.rows) lines.push(`- ${r.code} ${r.name}: 예산 ${wonText(r.budget)} · 실적 ${wonText(r.actual)} · 가용 ${wonText(r.available)}`);
  return lines;
}

/* ------------------------------------------------------------ 조회 */

const pageUrl = (p) => `${EA_ORIGIN}/App_Run/App_Style/PageStyle050.aspx?RunMode=RUN&PageID=${p.id}&PageGrpID=${p.grp}&PageVer=&PageVerUp=&subPG=&GotoData=`;
/** 화면 원문에서 처리기 이름(`CallsUrl = 'CO10021_0000038729'`). 없으면 ''. */
export const callsOf = (html) => (String(html ?? '').match(/CallsUrl\s*=\s*'([A-Z0-9_]+)'/i) || [])[1] || '';
/** 조회 하나의 몸(페이지의 Svr_GetListData 와 같은 꼴 — snddata 는 URL 인코딩해 보낸다. 페이지는 날것으로 보내지만 둘 다 받는다, 2026-10-17 실측). */
export function eaBody({ mode, snddata = '', colName = null, key = EA_KEY }) {
  return `chk=${encodeURIComponent(key)}&mode=${encodeURIComponent(mode)}${colName != null ? `&ColName=${encodeURIComponent(colName)}` : ''}&snddata=${encodeURIComponent(snddata)}`;
}
const imp = (attrs) => `<ROOT><IMPORT ${Object.entries(attrs).map(([k, v]) => `${k}='${String(v ?? '').replace(/[&'<>]/g, '')}'`).join(' ')} /></ROOT>`;
export const LIST_COLS = 'SEQ{D}CTEXT{D}HKONT{D}T_TEXT{D}RCMMTITEM1{D}BEZEI1{D}RCMMTITEM2{D}BEZEI2{D}RCMMTITEM3{D}BEZEI3{D}DDTEXT{D}FISTL{D}BEZEICH{D}KOSTL{D}KTEXT{D}GICHO{D}JUNYONG{D}SIL{D}YAK{D}GAYONG';

/** 이 세션에 읽어 둔 처리기 이름(페이지마다). 틀리면(404) 다시 읽는다. */
const callsCache = new Map();

/** 처리기 이름 — 화면을 한 번 GET 해 읽고 둔다. 못 읽으면 실측 상수. */
async function callsFor(page, fetchImpl, fresh = false) {
  if (!fresh && callsCache.has(page.id)) return callsCache.get(page.id);
  let calls = '';
  try {
    const { html } = await fetchImpl(pageUrl(page));
    calls = callsOf(html);
  } catch {
    calls = '';
  }
  calls = calls || page.calls;
  callsCache.set(page.id, calls);
  return calls;
}

/**
 * 회계에 조회 하나 — POST /App_Run/App_Compile/<CallsUrl>.aspx. 답(XML 글)을 돌려준다. 로그인이 풀렸으면(답이 XML 이 아님) Error(LOGIN_MESSAGE) — err.login 이 true.
 * 처리기 번호가 바뀌어 404 면 화면에서 다시 읽어 한 번 더. raw 는 XML 이 아닌 글을 돌려주는 함수(Load_Basic_Data 의 '1000{D}HER') — 그때는 태그가 아닌 글이면 받는다.
 * @param {{page?:object, mode:string, snddata?:string, colName?:string|null, raw?:boolean, fetchImpl?:Function}} q fetchImpl 은 검사용(기본 src/net.js directFetch)
 */
export async function eaCall({ page = EA_PAGE, mode, snddata = '', colName = null, raw = false, fetchImpl = directFetch }) {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: eaBody({ mode, snddata, colName }) };
  let calls = await callsFor(page, fetchImpl);
  let res;
  try {
    res = await fetchImpl(`${EA_ORIGIN}/App_Run/App_Compile/${calls}.aspx`, init);
  } catch (err) {
    if (err?.status !== 404) throw err;
    calls = await callsFor(page, fetchImpl, true);
    res = await fetchImpl(`${EA_ORIGIN}/App_Run/App_Compile/${calls}.aspx`, init);
  }
  const xml = String(res?.html ?? '').trim();
  if (!xml.startsWith('<ROOT>') && !(raw && !xml.startsWith('<'))) {
    const err = new Error(LOGIN_MESSAGE);
    err.login = true;
    throw err;
  }
  return xml;
}

/** 내 부서 코드(Load_Basic_Data → '1000{D}HER'). 없으면 ''. */
export async function fetchMyDept(opts = {}) {
  const got = await eaCall({ ...opts, mode: 'Load_Basic_Data', snddata: '<ROOT><IMPORT /></ROOT>', raw: true }).catch((err) => { if (err.login) throw err; return ''; });
  return text(String(got).split('{D}')[1] || '', 20);
}

/** 그 해 내 부서의 과제(I/O) 목록 — [{ code, name, text }]. */
export async function fetchIoList(year, opts = {}) {
  const xml = await eaCall({ ...opts, mode: 'getOrder', snddata: imp({ FYEAR: year }) });
  return ioOptions(xml);
}

/**
 * 그 해 과제(I/O) 하나의 계정(보조세목)별 예산 — budgetRows 의 줄(지출 · 세부 · 전체 계정). 과제 범위(GUB C)로 그 과제만 받는다.
 */
export async function fetchIoBudget(year, io, opts = {}) {
  const snddata = imp({ GJAHR: year, GUB: 'C', GUB3: 'D', DEPTFR: io, DEPTTO: io, GUB2: 'C', PRINT: '3', HKONT: '' });
  const xml = await eaCall({ ...opts, mode: 'getlist1', snddata, colName: LIST_COLS });
  return budgetRows(xml).filter((r) => !r.io || nameKey(r.io) === nameKey(io));
}

/** 그 해 부서 전체(과제마다 · 계정마다)의 예산 — 부서 예산 요약 화면의 세부 표 그대로. */
export async function fetchDeptBudget(year, dept, opts = {}) {
  const snddata = imp({ GJAHR: year, GUB: 'A', GUB3: 'D', DEPTFR: dept, DEPTTO: '', GUB2: 'C', PRINT: '3', HKONT: '' });
  const xml = await eaCall({ ...opts, mode: 'getlist1', snddata, colName: LIST_COLS });
  return budgetRows(xml);
}

/**
 * 과제의 회계 스냅샷을 받는다 — I/O 목록에서 이름을 찾고(ioName), 그 과제의 계정 줄을 받아 normalizeAcct 꼴로. 목록을 이미 받았으면 options 로 준다.
 * @returns {Promise<ReturnType<typeof normalizeAcct>>}
 */
export async function fetchAcct(year, io, { options = null, now = () => new Date(), ...opts } = {}) {
  const rows = await fetchIoBudget(year, io, opts);
  const list = options || (await fetchIoList(year, opts).catch(() => []));
  const hit = list.find((o) => nameKey(o.code) === nameKey(io));
  const first = rows[0];
  return normalizeAcct({
    year, at: now().toISOString(), io, ioName: hit?.name || first?.ioName || '', dept: first?.dept || '', deptName: first?.deptName || '',
    rows: rows.map(({ code, name, base, transfer, budget, actual, pending, available }) => ({ code, name, base, transfer, budget, actual, pending, available })),
  });
}
