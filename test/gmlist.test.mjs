// 공문 이력 — 전자결재 기안함 읽기의 순수 로직(src/gmlist.js). 목록 화면 읽기, 검색·쪽 넘김 포스트백(가짜 fetch), 외부강의등 신고서 본문, 갈래·상태,
// 사례비 누계. 화면 쪽(카드·누계 줄·전체·새로고침)은 test/wiring.test.mjs 의 "공문 탭 — 공문 이력" 이 본다. 네트워크는 없다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { listPage, reportPage } from './fixtures/gmlist-fixture.mjs';
import {
  HIST_KEY, OUTSIDE_FORM, RESEARCH_FORM, PAGE_SIZE, BOXES, BOX_ORDER, INBOX_ORDER, boxGroup, SPANS, SPAN_LABEL, DEFAULT_SPAN, spanFrom, boxUrl, hiddenFields, parseDocList, searchFields, listBox, listBoxes, listMine,
  viewUrl, bodyUrl, parseOutsideReport, readOutsideReport, kindOf, stateOf, outsideSummary, outsideHistory, normalizeHist, normalizeRows,
} from '../src/gmlist.js';
import { AuthError } from '../src/net.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
globalThis.DOMParser = new JSDOM('').window.DOMParser;

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const R1 = { id: 'HER-2026-000266', form: OUTSIDE_FORM, formName: '외부강의등 신고서', title: '외부강의등 신고서', name: '김거화', dept: '수소전기추진연구팀', date: '2026-08-13', done: '2026-08-13', status: '발송', flow: '7' };
const R2 = { id: 'HER-2026-000128', form: RESEARCH_FORM, formName: '연구업무품의서', title: '차단기 과제 수행을 위한 시험 장비 구매 품의', name: '김거화', dept: '수소전기추진연구팀', date: '2026-07-16', done: '2026-07-16', status: '발송', flow: '7' };
const R3 = { id: 'HER-2026-000700', form: RESEARCH_FORM, formName: '연구업무품의서', title: '부산대학교 강의 외부활동 허가 신청', name: '김거화', dept: '수소전기추진연구팀', date: '2026-10-10', status: '결재처리중', flow: '3' };

console.log('목록 화면');
t('문서함 주소 — 왼쪽 메뉴의 AppBoard/DocList<함>.aspx 그대로, 네 함', () => {
  assert.equal(HIST_KEY, 'gongmunHist');
  assert.deepEqual(BOX_ORDER, ['finished', 'requested', 'rejected', 'temp']);
  assert.deepEqual(BOX_ORDER.map((b) => BOXES[b].label), ['완료함', '상신함', '반려함', '임시보관함']);
  assert.match(boxUrl('finished'), /^https:\/\/eclass\.krs\.co\.kr\/RealEANet\/AppBoard\/DocListFinished\.aspx\?SCH_ST=-1&SAFE_DEGREE=8&&MID=M00000006/);
  assert.match(boxUrl('temp'), /DocListTemp\.aspx\?&MID=M00000005/);
  assert.equal(PAGE_SIZE, 10);
});
t('결재함 — 미결함·진행중·완료함·참조함·반려함(받은 공문, 2026-10-12 실측), 주소는 왼쪽 메뉴 그대로, 기안함의 완료함·반려함과 다른 이름', () => {
  assert.deepEqual(INBOX_ORDER, ['undecided', 'progress', 'decided', 'reference', 'returned']);
  assert.deepEqual(INBOX_ORDER.map((b) => BOXES[b].label), ['미결함', '진행중', '결재 완료함', '참조함', '결재 반려함']);
  assert.match(boxUrl('undecided'), /^https:\/\/eclass\.krs\.co\.kr\/RealEANet\/AppBoard\/DocListUndecided\.aspx\?&MID=M00000010&/);
  assert.match(boxUrl('progress'), /DocListProgress\.aspx\?&MID=M00000011&/);
  assert.match(boxUrl('decided'), /DocListDecided\.aspx\?SCH_ST=-1&SAFE_DEGREE=1&&MID=M00000012&/);
  assert.match(boxUrl('reference'), /DocListReference\.aspx\?&MID=M00000014&/);
  assert.match(boxUrl('returned'), /DocListDecidedRejected\.aspx\?SCH_ST=-1&SAFE_DEGREE=1&&MID=M00000015&/);
  assert.deepEqual([boxGroup('reference'), boxGroup('finished'), boxGroup('nope')], ['결재함', '기안함', '기안함']);
  assert.ok(!BOX_ORDER.some((b) => INBOX_ORDER.includes(b)), '기안함과 결재함은 겹치지 않는다');
});
t('줄 — tr 의 속성(문서번호·양식·상태 코드·기안자 id·Params)과 칸(양식명·제목·기안자·부서·기안일·완료일·상태), 문서건수, 쪽 넘김 인자, 숨은 칸', () => {
  const p = parseDocList(listPage({ rows: [R1, R2], count: 22, pages: [1, 2], current: 0 }));
  assert.equal(p.rows.length, 2);
  assert.deepEqual(p.rows[0], { id: 'HER-2026-000266', form: OUTSIDE_FORM, flow: '7', writer: 'kimghw', params: 'FORMID=KR_Outside_Lecture_Report&DOCID=HER-2026-000266&GROUPID=0&MDTID=0&DID=0&ISMODIFY=0&OLDDOC=&ATTYN=0&ALERTMAIL=0&DOCCNT=22&EXEMTD=RETMTD&ACTYPE=-1',
    formName: '외부강의등 신고서', title: '외부강의등 신고서', name: '김거화', dept: '수소전기추진연구팀', date: '2026-08-13', done: '2026-08-13', status: '발송' });
  assert.equal(p.rows[1].title, '차단기 과제 수행을 위한 시험 장비 구매 품의', '제목은 링크의 글이다(풍선말이 아니다)');
  assert.equal(p.count, 22);
  assert.deepEqual(p.pages, [1, 2]);
  assert.equal(p.current, 0);
  assert.equal(p.hidden.__REAL_StatePersister, 'persist-1');
  assert.equal(p.hidden['ctl00$ContentPlaceHolder1$SearchBar$hfFormId'], '');
  assert.ok(!('ctl00$ContentPlaceHolder1$SearchBar$txtSearchKeyWord' in p.hidden), '글 칸은 숨은 칸이 아니다');
  const p2 = parseDocList(listPage({ rows: [], count: 0 }));
  assert.deepEqual([p2.rows, p2.count, p2.pages, p2.current], [[], 0, [], 0]);
  assert.equal(parseDocList('<html><body>뭔가 다른 화면</body></html>').count, 0);
});
t('임시보관함은 기안자·완료일 칸이 없고 작성일이 기안일 자리에 선다', () => {
  const p = parseDocList(listPage({ rows: [{ ...R3, name: undefined, done: undefined, status: '임시저장', flow: '0' }], dateType: '작성일' }));
  assert.deepEqual([p.rows[0].date, p.rows[0].done, p.rows[0].name, p.rows[0].status], ['2026-10-10', '', '', '임시저장']);
});
t('검색 포스트백 칸 — 기간(RadDatePicker 숨은 칸·ClientState 둘씩), 제목 키워드, 양식 ID. 잠긴 날짜 종류 칸은 보내지 않는다', () => {
  const f = searchFields({ from: '2024-01-01', to: '2026-10-11', keyword: '외부활동', formId: OUTSIDE_FORM });
  assert.equal(f['ctl00$ContentPlaceHolder1$SearchBar$dtpBeginningDate'], '2024-01-01');
  assert.equal(f['ctl00$ContentPlaceHolder1$SearchBar$dtpBeginningDate$dateInput'], '2024-01-01');
  assert.deepEqual(JSON.parse(f.ctl00_ContentPlaceHolder1_SearchBar_dtpBeginningDate_dateInput_ClientState).valueAsString, '2024-01-01-00-00-00');
  assert.equal(f['ctl00$ContentPlaceHolder1$SearchBar$dtpClosingDate$dateInput'], '2026-10-11');
  assert.deepEqual(JSON.parse(f.ctl00_ContentPlaceHolder1_SearchBar_dtpClosingDate_ClientState), { minDateStr: '1900-01-01-00-00-00', maxDateStr: '2099-12-30-00-00-00' });
  assert.equal(f['ctl00$ContentPlaceHolder1$SearchBar$chkDocumentSubject'], 'on');
  assert.equal(f['ctl00$ContentPlaceHolder1$SearchBar$txtSearchKeyWord'], '외부활동');
  assert.equal(f['ctl00$ContentPlaceHolder1$SearchBar$hfFormId'], OUTSIDE_FORM);
  assert.ok(!('ctl00$ContentPlaceHolder1$SearchBar$rcbSearchDateType' in f));
});

console.log('한 함 읽기(가짜 fetch)');
/** 가짜 siteFetch — 부른 차례를 적고, 검색 뒤 쪽마다 다른 줄을 준다. 25건 → 세 쪽. */
function fakeBox({ rowsByPage, count, login = false, broken = false }) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const body = init.method === 'POST' ? new URLSearchParams(init.body) : null;
    calls.push({ url, method: init.method || 'GET', target: body?.get('__EVENTTARGET') ?? null, arg: body?.get('__EVENTARGUMENT') ?? null, body });
    if (login) return { html: '<html><body><script>alert("You must sign in.");</script></body></html>', via: 'direct' };
    if (broken) return { html: '<html><body>다른 화면</body></html>', via: 'direct' };
    if (!body) return { html: listPage({ rows: [], count: 0, hidden: { __REAL_StatePersister: 'first' } }), via: 'direct' };
    const page = body.get('__EVENTTARGET') === 'ctl00$ContentPlaceHolder1$pagerDocList' ? +body.get('__EVENTARGUMENT') : 0;
    const rows = rowsByPage[page] || [];
    const pages = rowsByPage.map((_, i) => i).filter((i) => i !== page);
    return { html: listPage({ rows, count, pages, current: page, hidden: { __REAL_StatePersister: `after-${page}` } }), via: 'tab' };
  };
  return { fetch, calls };
}
const many = (n, from) => Array.from({ length: n }, (_, i) => ({ ...R2, id: `HER-2026-${String(from + i).padStart(6, '0')}`, title: `구매 ${from + i}` }));
await ta('GET 으로 숨은 칸을 받고 검색 단추 포스트백, 그 뒤 쪽마다 pagerDocList 포스트백(0부터) — 세 쪽 25건을 한 목록으로, 검색 상태는 앞 응답의 숨은 칸으로 잇는다', async () => {
  const { fetch, calls } = fakeBox({ rowsByPage: [many(10, 1), many(10, 11), many(5, 21)], count: 25 });
  const got = await listBox({ box: 'finished', from: '2024-01-01', to: '2026-10-11', keyword: '구매', fetch });
  assert.equal(got.rows.length, 25);
  assert.equal(got.count, 25);
  assert.equal(got.via, 'tab');
  assert.ok(got.rows.every((r) => r.box === 'finished'));
  assert.deepEqual(calls.map((c) => [c.method, c.target, c.arg]), [['GET', null, null], ['POST', 'ctl00$ContentPlaceHolder1$SearchBar$btnSearch', ''],
    ['POST', 'ctl00$ContentPlaceHolder1$pagerDocList', '1'], ['POST', 'ctl00$ContentPlaceHolder1$pagerDocList', '2']]);
  assert.equal(calls[1].url, boxUrl('finished'));
  assert.equal(calls[1].body.get('__REAL_StatePersister'), 'first', '검색은 GET 화면의 숨은 칸으로');
  assert.equal(calls[1].body.get('ctl00$ContentPlaceHolder1$SearchBar$txtSearchKeyWord'), '구매');
  assert.equal(calls[1].body.get('ctl00$ContentPlaceHolder1$SearchBar$dtpBeginningDate'), '2024-01-01');
  assert.equal(calls[2].body.get('__REAL_StatePersister'), 'after-0', '쪽 넘김은 검색 응답의 숨은 칸으로');
  assert.equal(calls[3].body.get('__REAL_StatePersister'), 'after-1');
  assert.equal(calls[3].body.get('ctl00$ContentPlaceHolder1$SearchBar$txtSearchKeyWord'), '구매', '검색 칸도 함께 보낸다');
});
await ta('같은 문서번호는 한 줄, 빈 쪽이 오면 멈춘다, maxPages 로 자른다', async () => {
  const dup = many(10, 1);
  const { fetch, calls } = fakeBox({ rowsByPage: [dup, dup, []], count: 30 });
  const got = await listBox({ box: 'requested', from: '2024-01-01', to: '2026-10-11', fetch });
  assert.equal(got.rows.length, 10);
  assert.equal(calls.length, 4, 'GET·검색·1쪽·2쪽(빈 쪽)');
  const capped = await listBox({ box: 'requested', from: '2024-01-01', to: '2026-10-11', fetch: fakeBox({ rowsByPage: [many(10, 1), many(10, 11), many(10, 21)], count: 30 }).fetch, maxPages: 2 });
  assert.equal(capped.rows.length, 20);
});
await ta('로그인이 풀렸으면 AuthError, 화면이 다르면(숨은 칸 없음) 그 함 이름으로 말한다', async () => {
  await assert.rejects(listBox({ box: 'finished', from: '2024-01-01', to: '2026-10-11', fetch: fakeBox({ rowsByPage: [], count: 0, login: true }).fetch }), AuthError);
  await assert.rejects(listBox({ box: 'rejected', from: '2024-01-01', to: '2026-10-11', fetch: fakeBox({ rowsByPage: [], count: 0, broken: true }).fetch }), /반려함 화면의 모양이 다릅니다/);
  await assert.rejects(listBox({ box: 'nope', fetch: async () => ({ html: '' }) }), /모르는 문서함/);
});
await ta('내가 기안한 문서 — 네 함을 차례로 읽어 기안일 새 것이 위로 한 목록, 같은 문서번호는 앞 함의 것, 막힌 함은 빼고 notes 에', async () => {
  const seen = [];
  const fetch = async (url, init = {}) => {
    const box = (url.match(/DocList(\w+)\.aspx/) || [])[1];
    if (!init.method) return { html: listPage({ rows: [], count: 0 }), via: 'direct' };
    seen.push(box);
    if (box === 'Rejected') throw new Error('500');
    const rows = { Finished: [R2, R1], Requested: [R3, { ...R1, status: '결재처리중', flow: '3' }], Temp: [] }[box] || [];
    return { html: listPage({ rows, count: rows.length }), via: 'direct' };
  };
  const got = await listMine({ from: '2024-01-01', to: '2026-10-11', fetch, onBox: (b) => seen.push(`on:${b}`) });
  assert.deepEqual(got.rows.map((r) => [r.id, r.box, r.status]), [['HER-2026-000700', 'requested', '결재처리중'], ['HER-2026-000266', 'finished', '발송'], ['HER-2026-000128', 'finished', '발송']]);
  assert.deepEqual(got.notes, ['반려함을 읽지 못했습니다 — 500']);
  assert.deepEqual(seen.filter((s) => s.startsWith('on:')), ['on:finished', 'on:requested', 'on:rejected', 'on:temp']);
  await assert.rejects(listMine({ from: '2024-01-01', to: '2026-10-11', fetch: fakeBox({ rowsByPage: [], count: 0, login: true }).fetch }), AuthError, '로그인 풀림은 그대로 올린다');
  await assert.rejects(listMine({ from: '2024-01-01', to: '2026-10-11', fetch: async () => { throw new Error('offline'); } }), /기안함을 읽지 못했습니다 — offline/, '한 함도 못 읽으면 0건이 아니라 오류');
});
await ta('받은 공문 — 결재함 다섯 함을 차례로(listBoxes), 키워드를 검색 칸에, 같은 문서번호는 앞 함의 것, 한 함도 못 읽으면 "결재함을 읽지 못했습니다"', async () => {
  const seen = [];
  const keywords = [];
  const OTHER = { id: 'HER-2026-000510', form: RESEARCH_FORM, formName: '연구업무품의서', title: '전력변환 시험 장비 구매 품의', name: '홍길동', dept: '친환경선박연구팀', date: '2026-09-03', done: '2026-09-04', status: '발송', flow: '7', writer: 'hong' };
  const fetch = async (url, init = {}) => {
    const box = (url.match(/DocList(\w+)\.aspx/) || [])[1];
    if (!init.method) return { html: listPage({ rows: [], count: 0 }), via: 'direct' };
    seen.push(box);
    keywords.push(new URLSearchParams(init.body).get('ctl00$ContentPlaceHolder1$SearchBar$txtSearchKeyWord'));
    const rows = { Decided: [OTHER], Reference: [{ ...OTHER, status: '참조' }, { ...R2, name: '이몽룡', writer: 'lee' }] }[box] || [];
    return { html: listPage({ rows, count: rows.length }), via: 'direct' };
  };
  const got = await listBoxes({ boxes: INBOX_ORDER, from: '2026-07-12', to: '2026-10-12', keyword: '구매', fetch });
  assert.deepEqual(seen, ['Undecided', 'Progress', 'Decided', 'Reference', 'DecidedRejected']);
  assert.ok(keywords.every((k) => k === '구매'));
  assert.deepEqual(got.rows.map((r) => [r.id, r.box, r.name, r.writer, r.status]), [['HER-2026-000510', 'decided', '홍길동', 'hong', '발송'], ['HER-2026-000128', 'reference', '이몽룡', 'lee', '발송']]);
  assert.deepEqual(got.notes, []);
  await assert.rejects(listBoxes({ boxes: INBOX_ORDER, from: '2026-07-12', to: '2026-10-12', fetch: async () => { throw new Error('offline'); } }), /결재함을 읽지 못했습니다 — offline/);
  await assert.rejects(listBoxes({ boxes: ['finished', 'reference'], from: '2026-07-12', to: '2026-10-12', fetch: async () => { throw new Error('offline'); } }), /기안함을 읽지 못했습니다/, '섞였으면 기안함');
});

console.log('외부강의등 신고서');
const REPORT = { rank: '책임연구원', org: '더브릿지전략컨설팅', representative: '정민의', contact: '혁신전략본부(강원선)', contactTel: '02-123-4567', subject: '「대형선박 전동화 비전 및 중장기 로드맵 수립」 과제의 5분과 회의', place: '중소조선연구원(본원) 4층 회의실',
  from: '2026-08-04', to: '2026-08-04', start: '오후 03:00', end: '오후 05:00', hours: 2, mins: '', batch: 0, avgTime: 0, monthCount: 1, fee: 200000, avgFee: 0, yearTotal: 200000, expenses: 0, note: '' };
t('본문 틀의 칸 — 직급·기관·대표자·담당·연락처(숫자만)·주제·장소·일시·시간·총 시간·일괄신고·당월 누적·사례금 총액·1회 평균·당해 연도 누적·교통비 등·비고', () => {
  const r = parseOutsideReport(reportPage(REPORT));
  assert.deepEqual(r, { rank: '책임연구원', contactTel: '021234567', org: REPORT.org, representative: '정민의', contact: '혁신전략본부(강원선)', subject: REPORT.subject, place: REPORT.place, from: '2026-08-04', to: '2026-08-04',
    start: '오후 03:00', end: '오후 05:00', hours: 2, mins: null, batch: 0, monthCount: 1, fee: 200000, avgFee: 0, yearTotal: 200000, expenses: 0, note: '' });
});
t('사례금 총액 칸이 없으면 글("사례금 총액 : N 원")에서 찾고, 누적 합계도 마찬가지', () => {
  const html = reportPage({ ...REPORT, fee: undefined, yearTotal: '' }).replace('당해 연도 사례금 누적 합계 : </span>', '당해 연도 사례금 누적 합계 : </span>350000')
    .replace('<span id="ctl00_ContentPlaceHolder_Content_TotalAmount">총액</span> &nbsp;:&nbsp; ', '사례금 총액 : 150,000 원 ');
  const r = parseOutsideReport(html);
  assert.deepEqual([r.fee, r.yearTotal], [150000, 350000]);
});
await ta('본문 읽기 — 본문 틀 주소(Forms/Drafts/<양식>.aspx?<Params>&SYSTYPE=0)로 GET, 로그인 풀림·다른 화면은 오류', async () => {
  const urls = [];
  const row = { id: 'HER-2026-000266', form: OUTSIDE_FORM, params: 'FORMID=KR_Outside_Lecture_Report&DOCID=HER-2026-000266&GROUPID=0&ACTYPE=-1' };
  const got = await readOutsideReport(row, { fetch: async (url) => { urls.push(url); return { html: reportPage(REPORT) }; } });
  assert.equal(got.fee, 200000);
  assert.deepEqual(urls, ['https://eclass.krs.co.kr/RealEANET/Forms/Drafts/KR_Outside_Lecture_Report.aspx?FORMID=KR_Outside_Lecture_Report&DOCID=HER-2026-000266&GROUPID=0&ACTYPE=-1&SYSTYPE=0']);
  assert.equal(bodyUrl({ id: 'X-1', form: RESEARCH_FORM }), 'https://eclass.krs.co.kr/RealEANET/Forms/Drafts/KR_EA_Research_Task.aspx?FORMID=KR_EA_Research_Task&DOCID=X-1&GROUPID=0&MDTID=0&DID=0&ISMODIFY=0&OLDDOC=&ATTYN=0&ALERTMAIL=0&EXEMTD=RETMTD&ACTYPE=-1&SYSTYPE=0', 'Params 가 없으면 만든다');
  await assert.rejects(readOutsideReport(row, { fetch: async () => ({ html: '<html>You must sign in.</html>' }) }), AuthError);
  await assert.rejects(readOutsideReport(row, { fetch: async () => ({ html: '<html><body>다른 화면</body></html>' }) }), /모양이 다릅니다/);
});
t('문서 보기 주소 — loginbyname 을 거쳐 DocumentView 로(새 공문 창과 같은 길)', () => {
  const u = viewUrl({ id: 'HER-2026-000266', form: OUTSIDE_FORM, params: 'FORMID=KR_Outside_Lecture_Report&DOCID=HER-2026-000266&ACTYPE=-1' });
  assert.match(u, /^https:\/\/eclass\.krs\.co\.kr\/RealEANET\/loginbyname\.aspx\?ReturnUrl=/);
  assert.equal(decodeURIComponent(u.split('ReturnUrl=')[1]), '/RealEANET/Main/DocumentView.aspx?FORMID=KR_Outside_Lecture_Report&DOCID=HER-2026-000266&ACTYPE=-1');
});

console.log('갈래·상태·누계');
t('갈래 — 외부강의등 신고서와 "외부활동" 은 외부활동, 구매요청서와 "구매 요청·구매 의뢰" 는 구매의뢰(2026-10-17), 출장 → 교육 → 구매 차례로 제목의 말, 모르면 빈 것', () => {
  assert.equal(kindOf(R1), 'outside');
  assert.equal(kindOf(R3), 'outside');
  assert.equal(kindOf(R2), 'purchase');
  assert.equal(kindOf({ form: 'KR_Purchase_Order', title: '고전압 프로브 외 1건 구매 요청' }), 'order', '구매요청서는 폼으로 바로(only 가 하나)');
  assert.equal(kindOf({ form: RESEARCH_FORM, title: '모니터 구매 요청' }), 'order', '구매의 말보다 먼저 본다');
  assert.equal(kindOf({ form: RESEARCH_FORM, title: '시험 장비 구매의뢰' }), 'order');
  assert.equal(kindOf({ form: RESEARCH_FORM, title: '모니터 구매 품의' }), 'purchase', '"구매 요청·의뢰" 가 아니면 구매');
  assert.equal(kindOf({ form: RESEARCH_FORM, title: '인천항내 이동을 위한 자가용 대여 품의' }), 'purchase');
  assert.equal(kindOf({ form: RESEARCH_FORM, title: '회의비 사용 품의 (스마트항만)' }), 'purchase');
  assert.equal(kindOf({ form: RESEARCH_FORM, title: '[SSCB] 수행을 위한 대전 출장 품의' }), 'trip');
  assert.equal(kindOf({ form: RESEARCH_FORM, title: '[SSCB] 수행을 위한 MVDC 세미나 교육 품의' }), 'edu');
  assert.equal(kindOf({ form: 'KR_EA_Form2', title: '개념승인(AIP) 기술검토 요청' }), '');
  assert.equal(kindOf(null), '');
});
t('상태 딱지 — 발송·완료는 done, 결재처리중·상신함은 going, 반려는 back, 임시보관함은 kept', () => {
  assert.equal(stateOf(R1), 'done');
  assert.equal(stateOf(R3), 'going');
  assert.equal(stateOf({ box: 'requested', status: '', flow: '' }), 'going');
  assert.equal(stateOf({ box: 'rejected', status: '반려' }), 'back');
  assert.equal(stateOf({ box: 'temp', status: '임시저장' }), 'kept');
  assert.equal(stateOf({ status: '뭔가', flow: '9' }), '');
  assert.equal(stateOf({ box: 'returned', status: '반송' }), 'back', '결재함의 반려함');
  assert.equal(stateOf({ box: 'undecided', status: '' }), 'going', '미결함은 결재 중');
  assert.equal(stateOf({ box: 'progress', status: '' }), 'going');
  assert.equal(stateOf({ box: 'reference', status: '발송', flow: '7' }), 'done');
});
t('저장소의 줄들 — 문서번호 없는 것·줄이 아닌 것은 버리고 칸은 글로', () => {
  const rows = normalizeRows([{ id: 7, title: 'x', box: 'reference', name: '홍길동' }, { title: 'no id' }, null, 'str']);
  assert.deepEqual(rows, [{ id: '7', form: '', flow: '', writer: '', params: '', box: 'reference', formName: '', title: 'x', name: '홍길동', dept: '', date: '', done: '', status: '' }]);
  assert.deepEqual(normalizeRows(null), []);
});
t('사례비 누계 — 올해 신고서 가운데 가장 늦은 것의 당해 연도 누적이 지금까지, 거기에 이번을 더한 것이 합계. 올해 것이 없으면 0 부터', () => {
  const reports = [
    { id: 'a', date: '2026-08-13', yearTotal: 200000, fee: 200000 }, { id: 'b', date: '2026-05-02', yearTotal: 100000, fee: 100000 }, { id: 'c', date: '2025-11-13', yearTotal: 900000, fee: 300000 },
  ];
  const s = outsideSummary(reports, { fee: 300000, today: '2026-10-11' });
  assert.deepEqual([s.sofar, s.fee, s.total, s.basis.id, s.year, s.count], [200000, 300000, 500000, 'a', '2026', 2]);
  assert.deepEqual(outsideSummary(reports, { fee: null, today: '2026-10-11' }).total, 200000, '이번이 없으면 지금까지가 합계');
  const next = outsideSummary(reports, { fee: 50000, today: '2027-01-05' });
  assert.deepEqual([next.sofar, next.total, next.basis, next.count], [0, 50000, null, 0], '해가 바뀌면 0 부터');
  assert.equal(outsideSummary([{ id: 'x', date: '2026-09-01', yearTotal: null }], { fee: 1, today: '2026-10-11' }).sofar, 0, '누적을 못 읽은 신고서는 세지 않는다');
  assert.equal(outsideSummary([{ id: 'y', from: '2026-09-01', yearTotal: 7 }], { today: '2026-10-11' }).sofar, 7, '기안일이 없으면 활동일로');
});
t('새 신고서의 셈하는 칸(2026-10-15) — 당해 연도 누적은 누계의 합계, 당월 누적은 그 달에 활동한 신고서 + 1, 직급은 가장 늦은 것, 요청인은 같은 기관의 가장 늦은 것', () => {
  const reports = [
    { id: 'a', date: '2026-08-13', from: '2026-08-04', yearTotal: 200000, rank: '책임연구원', org: '더브릿지전략컨설팅', representative: '정민의', contact: '혁신전략본부(강원선)', contactTel: '021234567' },
    { id: 'b', date: '2026-10-02', from: '2026-10-01', yearTotal: 450000, rank: '', org: '부산대학교', representative: '홍길동', contact: '조선해양공학과(김철수)', contactTel: '051-510-1234' },
    { id: 'c', date: '2025-10-20', from: '2025-10-18', yearTotal: 900000, rank: '선임연구원', org: '부산 대학교', representative: '예전총장', contact: '예전(담당)', contactTel: '0510000000' },
  ];
  const h = outsideHistory(reports, { org: '부산대학교 ', from: '2026-10-28', fee: 300000, today: '2026-10-15' });
  assert.deepEqual([h.yearTotal, h.sofar, h.basis.id, h.monthCount, h.rank], [750000, 450000, 'b', 2, '책임연구원'], '직급이 빈 신고서는 건너뛴다');
  assert.deepEqual([h.representative, h.contact, h.contactTel], ['홍길동', '조선해양공학과(김철수)', '0515101234'], '같은 기관(빈칸 무시) 가운데 가장 늦은 것, 연락처는 숫자만');
  const none = outsideHistory(reports, { org: '한국생산성본부', from: '2026-11-05', fee: null, today: '2026-10-15' });
  assert.deepEqual([none.yearTotal, none.monthCount, none.representative, none.contact], [450000, 1, '', ''], '처음 가는 기관 — 요청인은 비고, 그 달 첫 건이면 1');
  assert.equal(outsideHistory([], { today: '2026-10-15' }).monthCount, 1, '시작일이 없으면 오늘의 달');
});
t('저장소의 이력 — 모르는 것은 버리고 창의 표(by)는 떨어진다', () => {
  const h = normalizeHist({ at: 5, from: '2024-01-01', to: '2026-10-11', by: 'me', rows: [R1, null, { id: 'z' }], reports: { 'HER-2026-000266': { fee: 1 }, bad: null }, notes: ['n'] });
  assert.deepEqual([h.at, h.from, h.to, h.notes], [5, '2024-01-01', '2026-10-11', ['n']]);
  assert.deepEqual(h.rows.map((r) => r.id), ['HER-2026-000266', 'z']);
  assert.deepEqual(Object.keys(h.reports), ['HER-2026-000266']);
  assert.ok(!('by' in h));
  assert.equal(h.span, '3m', '기간은 기본이 최근 3개월');
  assert.deepEqual(normalizeHist(null), { at: 0, from: '', to: '', span: '3m', rows: [], reports: {}, notes: [] });
  assert.deepEqual([normalizeHist({ span: 'y2' }).span, normalizeHist({ span: 'y3' }).span, normalizeHist({ span: 2 }).span], ['y2', '3m', '3m'], '기간은 3m·y0·y1·y2 만');
});
t('기간의 첫날 — 3개월은 석 달 전 같은 날(짧은 달은 넘어감), 올해·1y·2y 는 1월 1일', () => {
  assert.deepEqual(SPANS, ['3m', 'y0', 'y1', 'y2']);
  assert.deepEqual(SPANS.map((s) => SPAN_LABEL[s]), ['3개월', '올해', '1y', '2y']);
  assert.equal(DEFAULT_SPAN, '3m');
  assert.equal(spanFrom('3m', '2026-10-12'), '2026-07-12');
  assert.equal(spanFrom('3m', '2026-02-10'), '2025-11-10', '해를 넘어간다');
  assert.equal(spanFrom('3m', '2026-05-31'), '2026-03-03', '2월 31일은 없어 3월로');
  assert.deepEqual(['y0', 'y1', 'y2'].map((s) => spanFrom(s, '2026-10-12')), ['2026-01-01', '2025-01-01', '2024-01-01']);
});

console.log(`\n통과 ${pass}건`);
