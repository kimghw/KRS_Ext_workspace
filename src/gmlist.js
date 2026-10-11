// 전자결재(RealEANet) 문서함 읽기 — 공문 탭의 **공문 이력**(2026-10-11 사용자 지정: "출장·근태 이력처럼 공문 이력을 넣어 주고, 지금까지 이력은
// 시스템이 공문을 검색해서 읽어 와야지"). 기안함(완료함·상신함·반려함·임시보관함)을 기간으로 검색해 내가 기안한 문서를 모으고, 외부강의등 신고서
// (양식 KR_Outside_Lecture_Report)는 본문 틀까지 읽어 사례금·당해 연도 누적 합계를 꺼낸다. 조회만 한다 — 문서를 열거나 바꾸는 포스트백은 없다.
// 에이전트 갈래의 **공문 검색**(2026-10-12, src/gmsearch.js)도 같은 읽기다 — 받은 공문은 결재함(미결함·진행중·완료함·참조함·반려함), 보낸 공문은 기안함을
// 제목 키워드로 검색한다(제목 검색은 이어진 한 토막만 맞춘다 — "구매 품의" 는 되고 "품의 구매" 는 0건, 같은 날 실측). 왼쪽 메뉴에는 전체검색
// (DocListFullSearch.aspx — 같은 틀, 내가 낀 문서 전부)과 외부발송목록(DocListOutgoingTotal.aspx — 다른 틀)도 있지만 쓰지 않는다 — 받은·보낸을 함으로 가른다.
//
// 실측(2026-10-11 CDP, 읽기 전용):
//   문서함: /RealEANet/AppBoard/DocList<함>.aspx?…MID… — ASP.NET WebForms. 처음 GET 은 최근 3개월, 검색은 검색 단추 포스트백
//   (__EVENTTARGET=ctl00$ContentPlaceHolder1$SearchBar$btnSearch — 기간은 Telerik RadDatePicker 의 숨은 칸·ClientState, 제목 키워드 txtSearchKeyWord,
//   양식은 숨은 칸 hfFormId). 한 쪽 10줄, 쪽 넘김은 pagerDocList 포스트백(인자는 0부터), "문서건수 N건". 줄은 <tr documentID formID flowStatus writerID Params>
//   에 lbl_FORM_NAME·lnk_DOCUMENT_NAME·lbl_EMP_NAME·lbl_DEPT_NAME·lbl_REPORT_DATE·lbl_COMPLETE_DATE·lbl_FLOW_STATUS_NAME 칸. flowStatus 7 발송(완료), 3 결재처리중.
//   본문 틀: /RealEANET/Forms/Drafts/<FORMID>.aspx?<Params>&SYSTYPE=0 (DocumentView 의 onMoveDocument 가 여는 주소) — 완료된 문서는 읽기 꼴이라 값이
//   <span id="ctl00_ContentPlaceHolder_Content_…"> 에 있다. 외부강의등 신고서: lblInstituteName(기관명)·lblLectureTopic(주제)·lblPlace·lblStartDate·lblEndDate·
//   lblStartTime·lblEndTime·lblLectureTextHour·CumulativeCountlbl(당월 누적)·"사례금 총액 : N 원"·CumulativeAmountlbl(당해 연도 사례금 누적 합계)·Etclbl(교통비 등).
import { ORIGIN } from './config.js';
import { AuthError, siteFetch } from './net.js';

/** 읽어 둔 공문 이력(저장소) — { at, from, to, span, rows, reports: { [문서번호]: 신고서 칸 }, notes }. */
export const HIST_KEY = 'gongmunHist';
/**
 * 보는 기간(2026-10-12 사용자 지정: "기본 과거 3개월부터 예정인 것까지만 기본적으로 보여주고, 올해·1y·2y 이 정도 과거 히스토리") —
 * 3m 은 석 달 전부터 오늘까지(기안일 기준이라 진행 중·예정인 것도 기안했으면 든다), y0 은 올해 1월 1일부터, y1·y2 는 그만큼 앞 해의 1월 1일부터.
 */
export const SPANS = ['3m', 'y0', 'y1', 'y2'];
export const DEFAULT_SPAN = '3m';
export const SPAN_LABEL = { '3m': '3개월', y0: '올해', y1: '1y', y2: '2y' };
/** 기간의 첫날 — ymd(오늘)에서. 석 달 전은 같은 날짜(달이 짧으면 다음 달로 넘어간다). */
export function spanFrom(span, ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (span === '3m') {
    const x = new Date(y, m - 4, d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }
  return `${y - (+span.slice(1) || 0)}-01-01`;
}
/** 외부강의등 신고서 — 외부활동(강의·자문·심사…)을 하기 전에 올리는 회사 양식. 사례금과 당해 연도 누적 합계가 여기 있다. */
export const OUTSIDE_FORM = 'KR_Outside_Lecture_Report';
/** 연구업무추진품의 — 구매·교육·출장 품의와 이 패널의 외부활동 허가 신청서. */
export const RESEARCH_FORM = 'KR_EA_Research_Task';
/** 한 쪽의 줄 수(실측). */
export const PAGE_SIZE = 10;
const LOGIN = '로그인이 필요합니다. eclass 에 로그인한 뒤 다시 시도하세요.';
const looksLogin = (html) => /id="tbUserId"|Account\/Log(in|out)|You must sign in|loginbyname\.aspx/i.test(html || '');
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const BASE = `${ORIGIN}/RealEANet/AppBoard`;

/**
 * 문서함들 — 왼쪽 메뉴(MainLeft.aspx)의 주소 그대로(MID·TMID 는 메뉴 표시용이지만 그대로 둔다).
 * 기안함(완료함·상신함·반려함·임시보관함)은 내가 기안한 것 — 공문 이력과 에이전트 갈래의 **보낸 공문**. 결재함(미결함·진행중·완료함·참조함·반려함)은
 * 내게 결재·참조로 온 것 — 에이전트 갈래의 **받은 공문**(2026-10-12 CDP 실측: 화면은 기안함과 같은 틀이라 같은 검색 포스트백·줄 읽기로 읽는다.
 * 결재함의 완료함·반려함은 화면 제목이 기결함·반송함이다 — 기안함의 것과 헷갈리지 않게 '결재 완료함'·'결재 반려함' 으로 부른다).
 */
export const BOXES = {
  finished: { label: '완료함', page: 'DocListFinished.aspx', query: 'SCH_ST=-1&SAFE_DEGREE=8&&MID=M00000006&MNAME=%ec%99%84%eb%a3%8c%ed%95%a8&MPATH=%ea%b8%b0%ec%95%88%ed%95%a8+%3e+%ec%99%84%eb%a3%8c%ed%95%a8&TMID=M00000030' },
  requested: { label: '상신함', page: 'DocListRequested.aspx', query: '&MID=M00000008&MNAME=%ec%83%81%ec%8b%a0%ed%95%a8&MPATH=%ea%b8%b0%ec%95%88%ed%95%a8+%3e+%ec%83%81%ec%8b%a0%ed%95%a8&TMID=M00000041' },
  rejected: { label: '반려함', page: 'DocListRejected.aspx', query: 'SCH_ST=-1&SAFE_DEGREE=1&&MID=M00000007&MNAME=%eb%b0%98%eb%a0%a4%ed%95%a8&MPATH=%ea%b8%b0%ec%95%88%ed%95%a8+%3e+%eb%b0%98%eb%a0%a4%ed%95%a8&TMID=M00000031' },
  temp: { label: '임시보관함', page: 'DocListTemp.aspx', query: '&MID=M00000005&MNAME=%ec%9e%84%ec%8b%9c%eb%b3%b4%ea%b4%80%ed%95%a8&MPATH=%ea%b8%b0%ec%95%88%ed%95%a8+%3e+%ec%9e%84%ec%8b%9c%eb%b3%b4%ea%b4%80%ed%95%a8&TMID=M00000028' },
  undecided: { label: '미결함', page: 'DocListUndecided.aspx', query: '&MID=M00000010&MNAME=%eb%af%b8%ea%b2%b0%ed%95%a8&MPATH=%ea%b2%b0%ec%9e%ac%ed%95%a8+%3e+%eb%af%b8%ea%b2%b0%ed%95%a8&TMID=M00000033' },
  progress: { label: '진행중', page: 'DocListProgress.aspx', query: '&MID=M00000011&MNAME=%ec%a7%84%ed%96%89%ec%a4%91&MPATH=%ea%b2%b0%ec%9e%ac%ed%95%a8+%3e+%ec%a7%84%ed%96%89%ec%a4%91&TMID=M00000034' },
  decided: { label: '결재 완료함', page: 'DocListDecided.aspx', query: 'SCH_ST=-1&SAFE_DEGREE=1&&MID=M00000012&MNAME=%ec%99%84%eb%a3%8c%ed%95%a8&MPATH=%ea%b2%b0%ec%9e%ac%ed%95%a8+%3e+%ec%99%84%eb%a3%8c%ed%95%a8&TMID=M00000035' },
  reference: { label: '참조함', page: 'DocListReference.aspx', query: '&MID=M00000014&MNAME=%ec%b0%b8%ec%a1%b0%ed%95%a8&MPATH=%ea%b2%b0%ec%9e%ac%ed%95%a8+%3e+%ec%b0%b8%ec%a1%b0%ed%95%a8&TMID=M00000037' },
  returned: { label: '결재 반려함', page: 'DocListDecidedRejected.aspx', query: 'SCH_ST=-1&SAFE_DEGREE=1&&MID=M00000015&MNAME=%eb%b0%98%eb%a0%a4%ed%95%a8&MPATH=%ea%b2%b0%ec%9e%ac%ed%95%a8+%3e+%eb%b0%98%eb%a0%a4%ed%95%a8&TMID=M00000038' },
};
/** 기안함의 읽는 차례(공문 이력·보낸 공문). */
export const BOX_ORDER = ['finished', 'requested', 'rejected', 'temp'];
/** 결재함의 읽는 차례(받은 공문). */
export const INBOX_ORDER = ['undecided', 'progress', 'decided', 'reference', 'returned'];
/** 문서함이 든 묶음의 이름 — 오류 말("기안함을 읽지 못했습니다")에 쓴다. */
export const boxGroup = (box) => (INBOX_ORDER.includes(box) ? '결재함' : '기안함');
export const boxUrl = (box) => `${BASE}/${BOXES[box].page}?${BOXES[box].query}`;

const toDoc = (html) => new DOMParser().parseFromString(html, 'text/html');
const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
const num = (s) => { const m = String(s ?? '').replace(/,/g, '').match(/\d+/); return m ? +m[0] : null; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** 화면의 숨은 칸(이름 → 값) — 포스트백에 그대로 돌려보낸다(__VIEWSTATE·__REAL_StatePersister·달력 ClientState …). */
export function hiddenFields(doc) {
  return Object.fromEntries([...doc.querySelectorAll('input[type="hidden"]')].map((i) => [i.getAttribute('name') || i.id, i.value ?? i.getAttribute('value') ?? '']).filter(([n]) => n));
}

/**
 * 문서함 화면 한 쪽을 읽는다.
 * @returns {{rows: object[], count: number, pages: number[], current: number, hidden: Record<string,string>}}
 *   rows 는 { id(문서번호), form(양식 ID), flow(결재 상태 코드), writer, params(DocumentView 의 쿼리), formName, title, name, dept, date(기안일·작성일), done(완료일), status }
 *   pages 는 쪽 넘김 링크의 인자(0부터), count 는 "문서건수 N건"
 */
export function parseDocList(html) {
  const doc = toDoc(html);
  const rows = [...doc.querySelectorAll('tr[documentID]')].map((tr) => {
    const cell = (suffix) => text(tr.querySelector(`[id$="_${suffix}"]`));
    const date = [...tr.querySelectorAll('[id*="_DATE"]')].map(text).find((s) => DATE_RE.test(s)) || '';
    return {
      id: tr.getAttribute('documentID') || '', form: tr.getAttribute('formID') || '', flow: tr.getAttribute('flowStatus') || '', writer: tr.getAttribute('writerID') || '',
      params: (tr.getAttribute('Params') || '').replace(/&amp;/g, '&'),
      formName: cell('lbl_FORM_NAME'), title: cell('lnk_DOCUMENT_NAME'), name: cell('lbl_EMP_NAME'), dept: cell('lbl_DEPT_NAME'),
      date: date.slice(0, 10), done: cell('lbl_COMPLETE_DATE').slice(0, 10), status: cell('lbl_FLOW_STATUS_NAME'),
    };
  }).filter((r) => r.id);
  const count = num((text(doc.body).match(/문서건수\s*([\d,]+)\s*건/) || [])[1]);
  const pages = [...new Set([...doc.querySelectorAll('a[href*="pagerDocList"]')]
    .map((a) => +((a.getAttribute('href') || '').match(/pagerDocList[^,]*,\s*['"]?(\d+)/) || [])[1]).filter(Number.isFinite))];
  const current = Math.max((num(text(doc.querySelector('.table_pagenum_on'))) || 1) - 1, 0);
  return { rows, count: count ?? rows.length, pages, current, hidden: hiddenFields(doc) };
}

const SB = 'ctl00$ContentPlaceHolder1$SearchBar$';
const SB_ = 'ctl00_ContentPlaceHolder1_SearchBar_';
const RANGE_CS = '{"minDateStr":"1900-01-01-00-00-00","maxDateStr":"2099-12-30-00-00-00"}';
const dateCs = (d) => JSON.stringify({ enabled: true, emptyMessage: '', validationText: `${d}-00-00-00`, valueAsString: `${d}-00-00-00`, minDateStr: '1900-01-01-00-00-00', maxDateStr: '2099-12-30-00-00-00', lastSetTextBoxValue: d });

/** 검색 단추 포스트백에 보내는 검색 칸 — 기간(RadDatePicker 둘), 제목 키워드, 양식 ID. */
export function searchFields({ from, to, keyword = '', formId = '' }) {
  return {
    [`${SB}txtSystemType`]: '', [`${SB}txtFormID`]: '',
    [`${SB}dtpBeginningDate`]: from, [`${SB}dtpBeginningDate$dateInput`]: from, [`${SB_}dtpBeginningDate_dateInput_ClientState`]: dateCs(from), [`${SB_}dtpBeginningDate_ClientState`]: RANGE_CS,
    [`${SB}dtpClosingDate`]: to, [`${SB}dtpClosingDate$dateInput`]: to, [`${SB_}dtpClosingDate_dateInput_ClientState`]: dateCs(to), [`${SB_}dtpClosingDate_ClientState`]: RANGE_CS,
    [`${SB}chkDocumentSubject`]: 'on', [`${SB}txtSearchKeyWord`]: keyword, [`${SB}hfFormId`]: formId, [`${SB}hfFormName`]: '',
  };
}

const postback = (url, hidden, fields, target, arg, fetch) => fetch(url, {
  method: 'POST', headers: FORM, body: new URLSearchParams({ ...hidden, ...fields, __EVENTTARGET: target, __EVENTARGUMENT: arg }).toString(),
});

/**
 * 문서함 하나를 기간으로 검색해 모든 쪽을 읽는다. 처음 GET 으로 숨은 칸을 받고, 검색 포스트백 뒤 쪽마다 pagerDocList 포스트백이다.
 * @param {{box?: string, from: string, to: string, keyword?: string, formId?: string, maxPages?: number, fetch?: Function}} o
 * @returns {Promise<{box: string, rows: object[], count: number, via: string}>}
 */
export async function listBox({ box = 'finished', from, to, keyword = '', formId = '', maxPages = 30, fetch = siteFetch } = {}) {
  if (!BOXES[box]) throw new Error(`모르는 문서함입니다: ${box}`);
  const url = boxUrl(box);
  const first = await fetch(url);
  if (looksLogin(first.html)) throw new AuthError(LOGIN);
  let page = parseDocList(first.html);
  if (!('__REAL_StatePersister' in page.hidden) && !('__VIEWSTATE' in page.hidden)) throw new Error(`${BOXES[box].label} 화면의 모양이 다릅니다.`);
  const fields = searchFields({ from, to, keyword, formId });
  const r = await postback(url, page.hidden, fields, `${SB}btnSearch`, '', fetch);
  if (looksLogin(r.html)) throw new AuthError(LOGIN);
  page = parseDocList(r.html);
  const rows = page.rows.map((x) => ({ ...x, box }));
  const seen = new Set(rows.map((x) => x.id));
  const total = Math.min(Math.ceil(page.count / PAGE_SIZE), maxPages);
  for (let i = 1; i < total; i++) {
    const pr = await postback(url, page.hidden, fields, 'ctl00$ContentPlaceHolder1$pagerDocList', String(i), fetch);
    page = parseDocList(pr.html);
    if (!page.rows.length) break;
    for (const x of page.rows) if (!seen.has(x.id)) { seen.add(x.id); rows.push({ ...x, box }); }
  }
  return { box, rows, count: page.count, via: r.via || first.via || '' };
}

/**
 * 여러 문서함을 차례로 읽어 한 목록으로(기안일 새 것이 위, 같은 문서번호는 앞 함의 것). 한 함이 막히면(로그인 말고) 그 함만 빼고 notes 에 적는다.
 * 기안함(BOX_ORDER)이 공문 이력·보낸 공문, 결재함(INBOX_ORDER)이 받은 공문이다(에이전트 갈래 — src/gmsearch.js).
 * @returns {Promise<{rows: object[], notes: string[], via: string}>}
 */
export async function listBoxes({ boxes = BOX_ORDER, from, to, keyword = '', fetch = siteFetch, onBox = () => {} } = {}) {
  const rows = [];
  const seen = new Set();
  const notes = [];
  let via = '';
  let okBoxes = 0;
  let firstErr = null;
  for (const box of boxes) {
    onBox(box);
    try {
      const got = await listBox({ box, from, to, keyword, fetch });
      via = got.via || via;
      okBoxes += 1;
      for (const x of got.rows) if (!seen.has(x.id)) { seen.add(x.id); rows.push(x); }
    } catch (err) {
      if (err instanceof AuthError) throw err;
      firstErr = firstErr || err;
      notes.push(`${BOXES[box].label}을 읽지 못했습니다 — ${err.message}`);
    }
  }
  // 한 함도 못 읽었으면 "0건" 이 아니라 못 읽은 것이다(네트워크가 막힘 등).
  if (!okBoxes && firstErr) throw new Error(`${boxes.length && boxes.every((b) => boxGroup(b) === '결재함') ? '결재함' : '기안함'}을 읽지 못했습니다 — ${firstErr.message}`);
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
  return { rows, notes, via };
}

/** 내가 기안한 문서 — 기안함 네 함(완료함·상신함·반려함·임시보관함). 공문 이력이 쓴다. */
export const listMine = (o = {}) => listBoxes({ ...o, boxes: o.boxes || BOX_ORDER });

/**
 * 문서 보기 창 주소 — 목록의 더블클릭이 여는 DocumentView. 전자결재는 로그인된 세션이라도 DocumentView 를 바로 열면 튕길 수 있어
 * 새 공문 창처럼 loginbyname 을 거친다(src/gongmun.js 의 draftUrl 과 같은 길).
 */
export const viewUrl = (row) => {
  const params = row.params || `FORMID=${row.form}&DOCID=${row.id}&GROUPID=0&MDTID=0&DID=0&ISMODIFY=0&OLDDOC=&ATTYN=0&ACTYPE=-1`;
  return `${ORIGIN}/RealEANET/loginbyname.aspx?ReturnUrl=${encodeURIComponent(`/RealEANET/Main/DocumentView.aspx?${params}`)}`;
};
/** 본문 틀 주소 — DocumentView 의 onMoveDocument 가 frameDocument 에 넣는 것(Forms/Drafts/<FORMID>.aspx?<Params>&SYSTYPE=0). */
export const bodyUrl = (row) => {
  const params = row.params || `FORMID=${row.form}&DOCID=${row.id}&GROUPID=0&MDTID=0&DID=0&ISMODIFY=0&OLDDOC=&ATTYN=0&ALERTMAIL=0&EXEMTD=RETMTD&ACTYPE=-1`;
  return `${ORIGIN}/RealEANET/Forms/Drafts/${row.form}.aspx?${params}${/SYSTYPE=/.test(params) ? '' : '&SYSTYPE=0'}`;
};

/**
 * 외부강의등 신고서의 본문 틀(읽기 꼴)에서 칸을 읽는다. 금액은 칸 id 가 먼저고, 없으면 글("사례금 총액 : N 원")에서 찾는다.
 * @returns {{org, representative, contact, subject, place, from, to, start, end, hours, mins, batch, monthCount, fee, avgFee, yearTotal, expenses, note}}
 */
export function parseOutsideReport(html) {
  const doc = toDoc(html);
  const v = (id) => text(doc.getElementById(`ctl00_ContentPlaceHolder_Content_${id}`));
  const body = text(doc.body);
  const after = (label) => num((body.match(new RegExp(`${label}\\s*:?\\s*([\\d,]+)\\s*원`)) || [])[1]);
  return {
    org: v('lblInstituteName'), representative: v('lblRepresentative'), contact: v('lblDepartment'), subject: v('lblLectureTopic'), place: v('lblPlace'),
    from: v('lblStartDate').slice(0, 10), to: v('lblEndDate').slice(0, 10), start: v('lblStartTime'), end: v('lblEndTime'),
    hours: num(v('lblLectureTextHour')), mins: num(v('lblLectureTextMin')), batch: num(v('AverageCountlbl')), monthCount: num(v('CumulativeCountlbl')),
    fee: num(v('lblTotalHonorarium')) ?? after('사례금\\s*총액'), avgFee: num(v('AverageHonorariumlbl')),
    yearTotal: num(v('CumulativeAmountlbl')) ?? after('누적\\s*합계'), expenses: num(v('Etclbl')), note: v('lblNote'),
  };
}

/** 외부강의등 신고서 한 건을 읽는다(GET). */
export async function readOutsideReport(row, { fetch = siteFetch } = {}) {
  const r = await fetch(bodyUrl({ ...row, form: OUTSIDE_FORM }));
  if (looksLogin(r.html)) throw new AuthError(LOGIN);
  const got = parseOutsideReport(r.html);
  if (!got.org && !got.subject && got.fee == null && got.yearTotal == null) throw new Error('외부강의등 신고서 화면의 모양이 다릅니다.');
  return got;
}

/** 갈래 — 양식과 제목으로 가른다. 외부강의등 신고서는 외부활동. 연구업무추진품의는 제목의 말로(출장 → 교육 → 구매 차례). 모르면 ''. */
const KIND_RE = { outside: /외부활동|외부강의/, trip: /출장|여비/, edu: /교육|수강|세미나|워크숍|학회|연수|강좌/, purchase: /구매|구입|구독|대여|임차|회의비|사용 품의|사용료/ };
export function kindOf(row) {
  if (row?.form === OUTSIDE_FORM) return 'outside';
  const t = row?.title || '';
  for (const k of ['outside', 'trip', 'edu', 'purchase']) if (KIND_RE[k].test(t)) return k;
  return '';
}

/** 결재 상태 — 목록의 상태 글과 flowStatus 로 화면의 딱지 종류를 정한다. done 완료(발송) · going 결재 중 · back 반려 · kept 임시보관 · '' 그 밖. */
export function stateOf(row) {
  const s = String(row?.status || '');
  if (row?.box === 'temp' || /임시/.test(s)) return 'kept';
  if (row?.box === 'rejected' || row?.box === 'returned' || /반려|반송/.test(s)) return 'back';
  if (/발송|완료/.test(s) || row?.flow === '7') return 'done';
  if (/처리중|진행|상신|대기|미결/.test(s) || ['requested', 'undecided', 'progress'].includes(row?.box) || row?.flow === '3') return 'going';
  return '';
}

/**
 * 외부활동 초안의 사례비 누계 — 올해 외부강의등 신고서 가운데 가장 늦은 것의 "당해 연도 사례금 누적 합계" 가 지금까지 받은 금액이다
 * (그 신고 건까지 든 값). 거기에 이번 사례비(초안)를 더한 것이 합계 — 다음 신고서의 누적 합계에 적을 값이다. 올해 신고서가 없으면 0 부터.
 * @param {object[]} reports [{ id, date(기안일), ...parseOutsideReport }]
 * @returns {{sofar: number, fee: number|null, total: number, basis: object|null, year: string, count: number}}
 */
export function outsideSummary(reports, { fee = null, today = '' } = {}) {
  const year = String(today).slice(0, 4);
  const dateOf = (r) => r.date || r.from || '';
  const mine = (reports || []).filter((r) => r && r.yearTotal != null && dateOf(r).slice(0, 4) === year).sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || String(b.id).localeCompare(String(a.id)));
  const basis = mine[0] || null;
  const sofar = basis ? basis.yearTotal : 0;
  const mine2 = Number.isFinite(fee) ? fee : null;
  return { sofar, fee: mine2, total: sofar + (mine2 || 0), basis, year, count: mine.length };
}

/** 저장소의 목록 줄들을 이 꼴로 — 문서번호 없는 것·줄이 아닌 것은 버린다(공문 이력·에이전트 검색이 같이 쓴다). */
export function normalizeRows(list) {
  return (Array.isArray(list) ? list : []).filter((x) => x && typeof x === 'object' && x.id).map((x) => ({
    id: String(x.id), form: String(x.form || ''), flow: String(x.flow || ''), writer: String(x.writer || ''), params: String(x.params || ''), box: String(x.box || ''),
    formName: String(x.formName || ''), title: String(x.title || ''), name: String(x.name || ''), dept: String(x.dept || ''), date: String(x.date || ''), done: String(x.done || ''), status: String(x.status || ''),
  }));
}

/** 읽어 둔 이력(저장소)을 이 꼴로 — 모르는 것은 버린다. */
export function normalizeHist(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const rows = normalizeRows(r.rows);
  const reports = r.reports && typeof r.reports === 'object' ? Object.fromEntries(Object.entries(r.reports).filter(([, v]) => v && typeof v === 'object')) : {};
  const span = SPANS.includes(r.span) ? r.span : DEFAULT_SPAN;
  return { at: Number.isFinite(r.at) ? r.at : 0, from: String(r.from || ''), to: String(r.to || ''), span, rows, reports, notes: Array.isArray(r.notes) ? r.notes.map(String) : [] };
}
