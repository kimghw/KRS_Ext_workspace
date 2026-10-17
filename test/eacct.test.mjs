// 회계(e-accounting) 조회 — 받은 XML 읽기, I/O 후보 고르기, 계정 줄, 과제의 회계 스냅샷, 구매요청서 예산 내역 값(src/eacct.js — 2026-10-17 사용자 지정:
// "계정과목코드 계정과목명, 예산부서코드 또는 I/O 입력 예산금액도 같이 조회"). 어디에도 보내지 않는다 — 답은 2026-10-17 실측의 꼴을 흉내 낸 것이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEa, ioOptions, budgetRows, ioSimilarity, rankIo, ioLine, isIoCode, amount, normalizeAcct, acctFresh, acctRowFor, orderBudgetOf, acctSummaryLines,
  callsOf, eaBody, eaCall, fetchIoList, fetchIoBudget, fetchAcct, fetchMyDept, LIST_COLS, EA_PAGE, EA_ORIGIN, LOGIN_MESSAGE, IO_MIN,
} from '../src/eacct.js';

const NAME = '대용량 모듈러 멀티레벨 컨버터 기반 고압 드라이브 시제품 개발';
// 과제 콤보(getOrder) — 코드-이름, 긴 이름은 45자쯤에서 잘린다.
const COMBO = "<ROOT><RTNDATA ERR='S' ERRDESC='' ><RTNCBO CBODATA='2083LR9123' CBOTEXT='2083LR9123-AIP 용역' />"
  + "<RTNCBO CBODATA='2134NR0124' CBOTEXT='2134NR0124-R-친환경 선박용 암모니아 수소추출기 통합형 100kW급 PEMFC 시스' />"
  + "<RTNCBO CBODATA='2145NR0124' CBOTEXT='2145NR0124-R-대용량 모듈러 멀티레벨 컨버터 기반 고압 드라이브 시제품 개발' />"
  + "<RTNCBO CBODATA='2176NR0126' CBOTEXT='2176NR0126-R-MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발' /></RTNDATA></ROOT>";
// 부서 예산 요약 세부(getlist1) — 과제 범위로 받은 한 과제의 네 줄(앞 공백·쉼표 그대로).
const row = (code, name, gicho, sil, gayong, junyong = '0') => `<ROWS SEQ='00001' CTEXT='' HKONT='' T_TEXT='' RCMMTITEM1='603010000' BEZEI1='연구비' RCMMTITEM2='603010300' BEZEI2='수탁과제(국가)' `
  + `RCMMTITEM3='${code}' BEZEI3='${name}' DDTEXT='' FISTL='2145NR0124' BEZEICH='R-대용량 모듈러 멀티레벨 컨버터 기' KOSTL='' KTEXT='' GICHO='                   ${gicho}' JUNYONG='                            ${junyong}' SIL='                   ${sil}' YAK='                            0' GAYONG='                   ${gayong}'  />`;
const LIST = `<ROOT><RTNDATA ERR='S' ERRDESC='' >${row('603010302', '수탁과제(국가)_인건비', '70,270,000', '26,755,270', '43,514,730')}${row('603010304', '수탁과제(국가)_연구활동비', '51,500,000', '29,066,990', '22,433,010')}`
  + `${row('603010306', '수탁과제(국가)_연구수당', '14,000,000', '6,302,400', '7,697,600')}${row('603010311', '수탁과제(국가)_연구재료비', '31,376,000', '0', '31,376,000', '-1,000,000')}</RTNDATA></ROOT>`;
const PAGE = "<html><script>\n    CallsUrl = 'CO10021_0000038729'; \n</script></html>";

test('받은 XML 읽기 — ROWS·RTNCBO 의 속성이 줄이 되고, 금액은 앞 공백·쉼표를 뗀 수, XML 이 아니면(로그인 화면) 로그인 안내, ERR 이 S 가 아니면 ERRDESC', () => {
  const got = parseEa(LIST);
  assert.ok(got.ok);
  assert.equal(got.rows.length, 4);
  assert.deepEqual(got.rows[1].RCMMTITEM3, '603010304');
  assert.equal(got.rows[0].GICHO, '70,270,000', '값은 앞뒤 공백만 뗀다');
  assert.deepEqual(parseEa('<html>login</html>'), { ok: false, err: LOGIN_MESSAGE, rows: [] });
  assert.deepEqual(parseEa(''), { ok: false, err: LOGIN_MESSAGE, rows: [] });
  assert.deepEqual(parseEa("<ROOT><RTNDATA ERR='E' ERRDESC='권한이 없습니다' /></ROOT>"), { ok: false, err: '권한이 없습니다', rows: [] });
  assert.deepEqual(parseEa("<ROOT><RTNDATA ERR='S' ERRDESC='' /></ROOT>"), { ok: true, err: '', rows: [] }, '빈 답');
  assert.equal(parseEa("<ROOT><RTNDATA ERR='S' ERRDESC='' ><ROWS A='a &amp; b' /></RTNDATA></ROOT>").rows[0].A, 'a & b');
  assert.deepEqual(['', '0', '                   26,187,500', '-1,000,000', 'abc'].map(amount), [0, 0, 26187500, -1000000, 0]);
});

test('과제(I/O) 콤보 — 코드와 이름(코드 접두·R- 를 뗀 것)으로, 꼴은 isIoCode', () => {
  const opts = ioOptions(COMBO);
  assert.deepEqual(opts.map((o) => [o.code, o.name]), [
    ['2083LR9123', 'AIP 용역'], ['2134NR0124', '친환경 선박용 암모니아 수소추출기 통합형 100kW급 PEMFC 시스'], ['2145NR0124', NAME], ['2176NR0126', 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발'],
  ]);
  assert.equal(opts[2].text, `2145NR0124-R-${NAME}`);
  assert.deepEqual(['2145NR0124', ' 2083lr9123 ', 'HER', 'RND00202026', ''].map(isIoCode), [true, true, false, false, false]);
  assert.deepEqual(ioOptions('<html>'), []);
});

test('계정 줄 — 보조세목 코드·계정명·기초·전용·배정(기초+전용)·실적·임시·가용, 과제 코드·이름(R- 뗌). 요약의 관·항·목 줄(보조세목 없음)은 버린다', () => {
  const rows = budgetRows(LIST);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[3], {
    io: '2145NR0124', ioName: '대용량 모듈러 멀티레벨 컨버터 기', dept: '', deptName: '', code: '603010311', name: '수탁과제(국가)_연구재료비',
    base: 31376000, transfer: -1000000, budget: 30376000, actual: 0, pending: 0, available: 31376000,
  });
  const summary = "<ROOT><RTNDATA ERR='S' ERRDESC='' ><ROWS SEQ='00001' CTEXT='관' HKONT='600000000' T_TEXT='비용' RCMMTITEM3='' BEZEI3='' FISTL='' GICHO='1' /></RTNDATA></ROOT>";
  assert.deepEqual(budgetRows(summary), []);
  assert.deepEqual(budgetRows('<html>'), []);
  assert.equal(budgetRows(parseEa(LIST).rows).length, 4, '이미 읽은 줄도 받는다');
});

test('이름 유사도 — 회계의 잘린 과제명(앞머리)은 1, Dice 는 Job Id 와 같다, R- 접두와 기호는 뗀다', () => {
  assert.equal(ioSimilarity(NAME, 'R-대용량 모듈러 멀티레벨 컨버터 기'), 1, '20자에서 잘린 이름');
  assert.equal(ioSimilarity(NAME, `R-${NAME}`), 1);
  assert.ok(ioSimilarity(NAME, 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발') < IO_MIN);
  assert.equal(ioSimilarity('', NAME), 0);
  assert.ok(ioSimilarity('대용량 모듈러', NAME) < 1, '여덟 글자 미만의 앞머리는 그냥 Dice');
});

test('I/O 후보 — 적어 둔 코드가 목록에 있으면 그것 하나(by io), 아니면 과제명 유사도 0.5 이상을 높은 차례로(by name), 없으면 none', () => {
  const opts = ioOptions(COMBO);
  const byIo = rankIo(opts, { io: '2176nr0126', name: NAME });
  assert.equal(byIo.by, 'io');
  assert.deepEqual(byIo.list.map((r) => [r.code, r.name]), [['2176NR0126', 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발']]);
  assert.ok(byIo.list[0].score < IO_MIN, '코드로 찾았어도 유사도는 과제명과 견준 그대로 — 엉뚱한 코드를 알아보게');
  const byName = rankIo(opts, { io: '9999XX9999', name: NAME });
  assert.equal(byName.by, 'name');
  assert.deepEqual(byName.list.map((r) => [r.code, r.score]), [['2145NR0124', 1]]);
  assert.deepEqual(rankIo(opts, { name: '전혀 다른 과제' }), { by: 'none', list: [] });
  assert.equal(ioLine(byName.list[0]), `2145NR0124 ${NAME} · 유사도 1.00`);
  assert.deepEqual(rankIo(null, { name: NAME }), { by: 'none', list: [] });
});

test('회계 스냅샷 — 모양 맞추기(코드 없는 줄은 버림)·신선도(이 해·10분)·계정 이름으로 줄 고르기(끝이 같은 것 먼저)·요약 줄', () => {
  const rows = budgetRows(LIST);
  const acct = normalizeAcct({ year: 2026, at: '2026-10-17T10:00:00.000Z', io: '2145NR0124', ioName: NAME, dept: 'HER', deptName: '수소전기추진연구팀', rows: [...rows, { code: '', name: 'x' }] });
  assert.equal(acct.year, '2026');
  assert.equal(acct.rows.length, 4);
  assert.deepEqual(acct.rows[1], { code: '603010304', name: '수탁과제(국가)_연구활동비', base: 51500000, transfer: 0, budget: 51500000, actual: 29066990, pending: 0, available: 22433010 });
  assert.equal(normalizeAcct({ year: 2026, rows }), null, 'I/O 가 없으면 스냅샷이 아니다');
  assert.equal(normalizeAcct(null), null);
  const now = Date.parse('2026-10-17T10:05:00.000Z');
  assert.ok(acctFresh(acct, { today: '2026-10-17', now }));
  assert.ok(!acctFresh(acct, { today: '2026-10-17', now: now + 11 * 60 * 1000 }), '10분이 지나면 다시');
  assert.ok(!acctFresh(acct, { today: '2027-01-02', now }), '해가 바뀌면 다시');
  assert.ok(!acctFresh(null, { today: '2026-10-17', now }));
  assert.equal(acctRowFor(acct, '연구재료비')?.code, '603010311');
  assert.equal(acctRowFor(acct, '연구 활동비')?.code, '603010304', '띄어쓰기는 보지 않는다');
  assert.equal(acctRowFor(acct, '수탁과제(국가)_인건비')?.code, '603010302', '회계 이름 그대로도');
  assert.equal(acctRowFor(acct, '장비비'), null);
  assert.equal(acctRowFor(acct, ''), null, '계정이 비면 고르지 않는다');
  assert.deepEqual(acctSummaryLines(acct).slice(0, 3), ['', `■ 회계 예산 (2026년 · I/O 2145NR0124 ${NAME} · 조회 2026-10-17 10:00)`, '- 603010302 수탁과제(국가)_인건비: 예산 70,270,000원 · 실적 26,755,270원 · 가용 43,514,730원']);
  assert.deepEqual(acctSummaryLines(null), []);
});

test('구매요청서 예산 내역 값 — 과제의 계정에 맞는 줄이 있으면 계정과목코드·계정과목명·예산금액(기초+전용)까지, 없으면 I/O 코드·I/O 명만, I/O 가 없으면 null', () => {
  const acct = normalizeAcct({ year: 2026, at: '2026-10-17T10:00:00.000Z', io: '2145NR0124', ioName: NAME, rows: budgetRows(LIST) });
  assert.deepEqual(orderBudgetOf({ io: '2145NR0124', acct, account: '연구재료비' }), { ioCode: '2145NR0124', ioName: NAME, subjectCode: '603010311', subjectName: '수탁과제(국가)_연구재료비', budgetAmount: 30376000 });
  assert.deepEqual(orderBudgetOf({ io: '2145NR0124', acct, account: '' }), { ioCode: '2145NR0124', ioName: NAME, subjectCode: '', subjectName: '', budgetAmount: null });
  assert.deepEqual(orderBudgetOf({ io: '2176NR0126', acct, account: '연구재료비' }), { ioCode: '2176NR0126', ioName: '', subjectCode: '', subjectName: '', budgetAmount: null }, '스냅샷이 다른 과제의 것이면 쓰지 않는다');
  assert.equal(orderBudgetOf({ account: '연구재료비' }), null);
  assert.equal(orderBudgetOf(null), null);
});

test('조회 — 화면에서 처리기 이름을 읽어 POST 하고(몸은 페이지와 같은 chk·mode·ColName·snddata), 404 면 화면을 다시 읽으며, XML 이 아니면 로그인 안내(err.login)', async () => {
  assert.equal(callsOf(PAGE), 'CO10021_0000038729');
  assert.equal(callsOf('<html></html>'), '');
  const body = eaBody({ mode: 'getlist1', snddata: "<ROOT><IMPORT GJAHR='2026' /></ROOT>", colName: 'A{D}B' });
  assert.match(body, /^chk=[^&]+&mode=getlist1&ColName=A%7BD%7DB&snddata=%3CROOT%3E/);
  const calls = [];
  let pageCalls = 'CO10021_0000038729';
  let answer = () => COMBO;
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init?.body || '' });
    if (url.includes('PageStyle050.aspx')) return { html: `<script>CallsUrl = '${pageCalls}';</script>` };
    if (!url.includes(`/${pageCalls}.aspx`)) { const e = new Error('HTTP 404'); e.status = 404; throw e; }
    return { html: answer(init) };
  };
  // 과제 목록 — 화면 GET 한 번 뒤 POST. 두 번째는 화면을 다시 읽지 않는다.
  const list = await fetchIoList('2026', { fetchImpl });
  assert.equal(list.length, 4);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${EA_ORIGIN}/App_Run/App_Style/PageStyle050.aspx?RunMode=RUN&PageID=${EA_PAGE.id}&PageGrpID=${EA_PAGE.grp}&PageVer=&PageVerUp=&subPG=&GotoData=`);
  assert.equal(calls[1].url, `${EA_ORIGIN}/App_Run/App_Compile/CO10021_0000038729.aspx`);
  assert.match(decodeURIComponent(calls[1].body), /&mode=getOrder&snddata=<ROOT><IMPORT FYEAR='2026' \/><\/ROOT>$/);
  answer = () => LIST;
  const rows = await fetchIoBudget('2026', '2145NR0124', { fetchImpl });
  assert.equal(rows.length, 4);
  assert.equal(calls.length, 3, '처리기 이름은 세션에 둔다');
  assert.match(decodeURIComponent(calls[2].body), new RegExp(`&ColName=${LIST_COLS.replace(/[{}]/g, '\\$&')}&snddata=<ROOT><IMPORT GJAHR='2026' GUB='C' GUB3='D' DEPTFR='2145NR0124' DEPTTO='2145NR0124' GUB2='C' PRINT='3' HKONT='' /></ROOT>$`));
  // 처리기 번호가 바뀌면(404) 화면을 다시 읽어 한 번 더.
  pageCalls = 'CO10021_0000040000';
  const again = await fetchIoBudget('2026', '2145NR0124', { fetchImpl });
  assert.equal(again.length, 4);
  assert.deepEqual(calls.slice(3).map((c) => c.url.split('/').pop()), ['CO10021_0000038729.aspx', 'PageStyle050.aspx?RunMode=RUN&PageID=CO10021&PageGrpID=CO10020&PageVer=&PageVerUp=&subPG=&GotoData=', 'CO10021_0000040000.aspx']);
  // 스냅샷 — 계정 줄 + 목록의 긴 이름. 목록을 이미 받았으면 주면 다시 받지 않는다.
  answer = (init) => (/mode=getOrder/.test(init.body) ? COMBO : LIST);
  const acct = await fetchAcct('2026', '2145NR0124', { fetchImpl, now: () => new Date('2026-10-17T10:00:00.000Z') });
  assert.equal(acct.ioName, NAME, '목록의 긴 이름이 잘린 이름을 이긴다');
  assert.equal(acct.at, '2026-10-17T10:00:00.000Z');
  assert.equal(acct.rows.length, 4);
  const n = calls.length;
  const acct2 = await fetchAcct('2026', '2145NR0124', { fetchImpl, options: list });
  assert.equal(calls.length, n + 1);
  assert.equal(acct2.ioName, NAME);
  // 내 부서.
  answer = () => '1000{D}HER';
  assert.equal(await fetchMyDept({ fetchImpl }), 'HER');
  // 로그인이 풀리면 답이 XML 이 아니다.
  answer = () => '<html><body>login</body></html>';
  await assert.rejects(eaCall({ mode: 'getOrder', fetchImpl }), (e) => e.login === true && e.message === LOGIN_MESSAGE);
  await assert.rejects(fetchMyDept({ fetchImpl }), (e) => e.login === true);
});
