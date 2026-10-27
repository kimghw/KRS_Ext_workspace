// 일일 업무 — e-Class 일일업무통계 대시보드의 답 읽기와 셈(src/dwr.js), 현황 탭의 일일 업무 카드(dwrbox.js)(2026-10-27 사용자 지정:
// "현황에 eclass 에서 내일일 업무 보고 대쉬보드를 갖어와서 보는 기능 추가해줘"). 어디에도 보내지 않는다 — 답은 2026-10-27 실측의 꼴을 흉내 낸 것이다.
// 카드는 업무 비율 하나다(2026-10-27 사용자 지정: "연구개발 참여율을 월간으로 계산했을 때 해야 되는 업무 시간을 업무별 업무량이랑 같이 보이게 해줘 시간 비율로" —
// 셈은 test/workshare.test.mjs 가 본다). 여기는 그리기 · 업무 더하기/고치기/빼기 · 장부를 다시 읽는지.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { AuthError } from '../src/net.js';
import {
  rangeOf, dayOf, rowsOf, hoursText, fetchUserId, fetchDashboard, allowReferer,
  DWR_BASE, DWR_HOME, DWR_WRITE, USER_KEY, RANGE_KEY, OPEN_KEY, LOGIN_MESSAGE, REFUSED_MESSAGE, REFERER_RULE_ID,
} from '../src/dwr.js';
import { SHARE_KEY } from '../src/workshare.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

const A = '반도체 차단기 개발';
const B = '고압 드라이브 시제품 개발';
const C = '연구기획>연구기획 기타';
const D = '부서 회의';
// workdetails 한 줄 — 날짜 내림차순, 날짜 없는 칸은 {} 로 온다.
const W = (date, title, min, more = {}) => ({
  WorkDate: `${date}T00:00:00`, workContent: `${title} 작업`, wMinTotal: min, wTitle: title, WorkCategory: '국가 R&D 과제', OverMin: 0, isAlways: false, cDate: {}, sDate: '2026-01-01T00:00:00', isCpl: false, ...more,
});
const RAW = {
  vacation: { remaininG_ANNUAL_LEAVE: 5.5, remaininG_HEALTH_LEAVE: 0, totaL_REMAINING_LEAVE: 5.5 },
  workStats: {
    workloadbyWork: [{ WorkDate: '2026년 1월 8일', WorkTitle: A, WTIME: 480 }],
    workloadbyWorkCategory: [],
    workdetails: [
      W('2026-09-30', B, 480),
      W('2026-09-29', A, 480),
      W('2026-09-25', C, 240, { isAlways: true, WorkCategory: '연구기획 기타' }),
      W('2026-09-25', A, 240),
      W('2026-09-24', D, 60, { isCpl: true, WorkCategory: '사내 행사' }),
      W('2026-08-10', B, 480, { cDate: '2026-08-31T00:00:00' }),
      W('2026-03-02', A, 450, { OverMin: 30 }),
      W('2025-12-30', B, 480, { OverMin: 90 }),
      { WorkDate: {}, wTitle: 'x', wMinTotal: 10 },
    ],
  },
  yearlyActivity: [{ year: 2025, workHours: 1625, standardHours: 1920, activity: 84.6 }, { year: 2024, workHours: 1320, standardHours: 1920, activity: 68.8 }],
  surveyorYearlyStats: null, surveyorPeriodStats: null, isSurveyor: false,
};

test('기간 단추 — 대시보드와 같은 셈: 올해 1월 1일 · 지난달 같은 날 · 7일 전부터 오늘까지', () => {
  assert.deepEqual(rangeOf('year', '2026-10-27'), { from: '2026-01-01', to: '2026-10-27' });
  assert.deepEqual(rangeOf('month', '2026-10-27'), { from: '2026-09-27', to: '2026-10-27' });
  assert.deepEqual(rangeOf('week', '2026-10-27'), { from: '2026-10-20', to: '2026-10-27' });
  assert.deepEqual(rangeOf('month', '2026-01-15'), { from: '2025-12-15', to: '2026-01-15' }, '해를 넘는다');
  assert.deepEqual(rangeOf('week', '2026-03-03'), { from: '2026-02-24', to: '2026-03-03' });
});

test('날짜 칸 — ISO · 한글 꼴 · {}(없음)', () => {
  assert.deepEqual(['2026-09-30T00:00:00', '2026년 1월 8일', '2012년 10월 15일', {}, null, ''].map(dayOf), ['2026-09-30', '2026-01-08', '2012-10-15', '', '', '']);
});

test('업무 내역 — 한 꼴로, 날짜 없는 줄은 빼고 날짜 내림차순(같은 날은 받은 차례), 완료 예정일은 날짜만', () => {
  const rows = rowsOf(RAW);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[0], { date: '2026-09-30', title: B, category: '국가 R&D 과제', content: `${B} 작업`, minutes: 480, overMin: 0, always: false, done: false, due: '' });
  assert.deepEqual(rows.slice(2, 4).map((r) => [r.title, r.always]), [[C, true], [A, false]]);
  assert.equal(rows[5].due, '2026-08-31');
  assert.deepEqual(rowsOf({ workStats: { workdetails: [W('2026-01-02', A, 60), W('2026-05-01', B, 60)] } }).map((r) => r.date), ['2026-05-01', '2026-01-02'], '받은 차례가 섞여도');
  assert.deepEqual(rowsOf(null), []);
  assert.deepEqual(rowsOf({ workStats: {} }), []);
});

test('시간을 글로 — 천 단위 쉼표, 소수는 한 자리', () => {
  assert.deepEqual([1229, 0, 4.5, 16.25, 1234.56].map(hoursText), ['1,229', '0', '4.5', '16.3', '1,234.6']);
});

/** 대시보드 흉내 — 주소마다 답(글)을 준다. directFetch 처럼 { html } 을 돌려주고, 리다이렉트는 status 0 오류로 던진다. */
function fakeSite(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init]);
    for (const [pre, body] of routes) {
      if (!url.startsWith(pre)) continue;
      if (body instanceof Error) throw body;
      return { html: typeof body === 'string' ? body : JSON.stringify(body), finalUrl: url };
    }
    throw new Error(`없는 주소: ${url}`);
  };
  return { fetchImpl, calls };
}
const redirect = () => Object.assign(new Error('HTTP 0'), { status: 0 });

test('대시보드 받기 — 사용자 ID 로 GetAllDashboardData 한 번, 리다이렉트를 따라가지 않는다. 리다이렉트·HTML(로그인 화면)이면 AuthError', async () => {
  const { fetchImpl, calls } = fakeSite([[`${DWR_BASE}/Home/GetAllDashboardData`, RAW]]);
  const got = await fetchDashboard('hong', { fetchImpl });
  assert.equal(calls[0][0], `${DWR_BASE}/Home/GetAllDashboardData?userId=hong`);
  assert.deepEqual(calls[0][1], { redirect: 'manual' });
  assert.deepEqual(Object.keys(got), ['rows'], '업무 내역만 — 휴가·활동성은 카드에서 뺐다');
  assert.equal(got.rows.length, 8);

  // 리다이렉트는 로그인이 풀렸거나(포털도 풀림) Referer 가 없어 막힌 것(포털은 살아 있음 — "잘못된 접근")이다. 둘을 가려 말한다.
  await assert.rejects(fetchDashboard('hong', { ...fakeSite([[DWR_BASE, redirect()]]), portal: async () => 'expired' }),
    (e) => e instanceof AuthError && e.message === LOGIN_MESSAGE && e.portal === 'expired');
  await assert.rejects(fetchDashboard('hong', { ...fakeSite([[DWR_BASE, redirect()]]), portal: async () => 'alive' }),
    (e) => !(e instanceof AuthError) && e.message === REFUSED_MESSAGE);
  await assert.rejects(fetchDashboard('hong', { ...fakeSite([[DWR_BASE, redirect()]]), portal: async () => { throw new Error('x'); } }), AuthError);
  await assert.rejects(fetchDashboard('hong', fakeSite([[DWR_BASE, '<html><form id="loginForm"></form></html>']])), AuthError);
  await assert.rejects(fetchDashboard('hong', fakeSite([[DWR_BASE, { message: 'No data found' }]])), /업무 내역을 주지 않았습니다/);
  await assert.rejects(fetchDashboard('hong', fakeSite([[DWR_BASE, Object.assign(new Error('HTTP 500'), { status: 500 })]])), /HTTP 500/, '로그인이 아닌 오류는 그대로');
});

test('Referer 규칙 — 이 확장이 /dwrdashboard 로 보내는 XHR 에만 e-Class Referer 를 채우는 세션 규칙 하나(대시보드는 Referer 가 e-Class 가 아니면 막는다). declarativeNetRequest 가 없으면 걸지 않는다', async () => {
  const got = [];
  const dnr = { updateSessionRules: async (o) => { got.push(o); } };
  assert.equal(await allowReferer(dnr, 'abcdef'), true);
  assert.equal(await allowReferer(dnr, 'abcdef'), true);
  assert.deepEqual(got[0], {
    removeRuleIds: [REFERER_RULE_ID],
    addRules: [{
      id: REFERER_RULE_ID, priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://eclass.krs.co.kr/' }] },
      condition: { urlFilter: '|https://eclass.krs.co.kr/dwrdashboard/', initiatorDomains: ['abcdef'], resourceTypes: ['xmlhttprequest'] },
    }],
  });
  assert.deepEqual(got[1], got[0], '다시 걸어도 같은 번호를 지우고 하나만');
  assert.equal(await allowReferer(undefined, 'abcdef'), false);
  assert.equal(await allowReferer(dnr, ''), false);
});

test('사용자 ID — e-Class 홈 머리글(src/whoami.js portalUserId), 리다이렉트를 따라가지 않는다. 로그인 폼·리다이렉트면 AuthError', async () => {
  const parse = (html) => new JSDOM(html).window.document;
  const HOME = '<html><body><nav><img id="id-navbar-user-image" src="/intra/intranet/member/pic/hong.gif" alt="hong"></nav></body></html>';
  const { fetchImpl, calls } = fakeSite([['https://eclass.krs.co.kr/eClassVer4/Home/Index', HOME]]);
  assert.equal(await fetchUserId({ fetchImpl, parse }), 'hong');
  assert.deepEqual(calls[0][1], { redirect: 'manual' });
  assert.equal(await fetchUserId({ fetchImpl: fakeSite([['https://eclass', '<html><body>x</body></html>']]).fetchImpl, parse }), '');
  await assert.rejects(fetchUserId({ fetchImpl: fakeSite([['https://eclass', redirect()]]).fetchImpl, parse }), AuthError);
  await assert.rejects(fetchUserId({ fetchImpl: fakeSite([['https://eclass', '<input id="tbUserId">']]).fetchImpl, parse }), AuthError);
});

/* ------------------------------------------------------------ 카드(dwrbox.js) */

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { createDwrBox } = await import('../dwrbox.js');

/** R&D 장부(rndBook)의 한 차년도 — 나(홍길동)만 있는 rERP 참여인력. 월급여 1000 에 달마다 지급(amt)이면 참여율은 amt / 10 %. */
const staffOf = (from, to, amt) => ({
  erp: { staff: { people: [{ name: '홍길동', erp: { monthly: 1000, others: [] }, plan: Array.from({ length: to - from + 1 }, (_, i) => ({ ym: `2026-${String(from + i).padStart(2, '0')}`, amt })) }] } },
});
// A(별칭 SSCB)는 3~9월 30%, B 는 8~9월 20%.
const BOOK = { projects: [{ id: 'a', name: A, alias: 'SSCB', years: { 1: staffOf(3, 9, 300) } }, { id: 'b', name: B, alias: '', years: { 1: staffOf(8, 9, 200) } }] };

/** 패널 HTML 의 카드를 두고 저장소·탭·조회를 흉내 낸다. 저장소에는 처음부터 내 이름과 장부가 있다(saved 로 바꾼다). */
function boxWith({ saved = { myName: '홍길동', rndBook: BOOK }, api = {}, today = '2026-10-27' } = {}) {
  const doc = new JSDOM(html).window.document;
  const store = { ...saved };
  const tabs = [];
  const asked = { user: 0, dash: 0 };
  let clock = 1_000_000;
  const box = createDwrBox({
    doc,
    storage: { get: async () => ({ ...store }), set: async (o) => { Object.assign(store, o); } },
    openTab: (url) => tabs.push(url),
    today: () => today,
    now: () => clock,
    api: {
      fetchUserId: async () => { asked.user++; return 'hong'; },
      fetchDashboard: async (id) => { asked.dash++; assert.equal(id, 'hong'); return { rows: rowsOf(RAW) }; },
      ...api,
    },
  });
  return { doc, box, store, tabs, asked, tick: (ms) => { clock += ms; } };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const text = (doc, id) => doc.getElementById(id).textContent;
/** 업무 비율 줄 — [이름, 실제, 목표(더한 업무는 입력칸의 값), 붉음(5%p 넘게 벌어짐)]. */
const shares = (doc) => [...doc.querySelectorAll('#dwrTop li:not(.dwr-none):not(.dwr-adding)')].map((li) => {
  const num = li.querySelector('.dwr-num');
  const rate = li.querySelector('input[data-rate]');
  return [li.querySelector('.dwr-top-name').textContent, num.querySelector('strong').textContent, rate ? `${rate.value}%` : (num.textContent.split('/')[1] || '').trim(), li.classList.contains('dwr-off')];
});
const key = (doc, el, k) => el.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true }));

test('카드 — 현황에서만 서고, 받으면 머리 줄(기간) · 마지막 작성일 · 업무 비율(실제 / 참여율로 달마다 셈한 목표)을 그린다. 네 칸·진행현황·활동성·최근 업무는 없다', async () => {
  const { doc, box, store, asked } = boxWith();
  const card = doc.getElementById('dwrBox');
  assert.ok(card.classList.contains('hidden'), '처음엔 숨어 있다(현황 탭이 세운다)');
  box.toggle(true);
  assert.ok(!card.classList.contains('hidden'));
  await box.wire();
  await box.show();
  await settle();
  assert.equal(store[USER_KEY], 'hong');
  assert.equal(text(doc, 'dwrState'), '올해');
  assert.equal(text(doc, 'dwrLast'), '9/30까지 작성');
  // 3월 A 450 → A 450. 8월 B 480 → A 30 : B 20 → 288 · 192. 9월 1500 가운데 기타 300(C·D) → 남은 1200 을 720 · 480. 기간 2430분.
  assert.deepEqual(shares(doc), [['SSCB', '48%', '60%', true], [B, '40%', '28%', true], ['기타', '12%', '', false]]);
  const first = doc.querySelector('#dwrTop li');
  assert.equal(first.title.split('\n')[0], A, '풍선말 첫 줄은 과제 이름');
  assert.match(first.title, /실제 19\.5시간 \(48%\) · 목표 24\.3시간 \(60%\)/);
  assert.match(first.title, /3월 100% \/ 100% {2}8월 0% \/ 60% {2}9월 48% \/ 48%/, '달마다의 실제 / 목표');
  assert.ok(first.querySelector('.dwr-bar b'), '목표는 막대의 세로 금');
  assert.equal(doc.querySelector('#dwrTop li.dwr-k-etc .dwr-bar b'), null, '기타는 목표가 없다');
  for (const id of ['dwrTotal', 'dwrOver', 'dwrLeave', 'dwrWeek', 'dwrProg', 'dwrYears', 'dwrRecent']) assert.equal(doc.getElementById(id), null, id);
  assert.equal(text(doc, 'dwrHint'), '');
  assert.equal(text(doc, 'dwrMsg'), '');
  assert.deepEqual([asked.user, asked.dash], [1, 1]);
});

test('카드 — 기간 단추를 누르면 그 자리에서 다시 셈한다(다시 받지 않는다). 고른 기간은 저장소에', async () => {
  const { doc, box, store, asked } = boxWith();
  await box.wire();
  await box.show();
  await settle();
  doc.querySelector('#dwrRanges [data-range="month"]').click();
  assert.equal(store[RANGE_KEY], 'month');
  assert.equal(doc.querySelector('#dwrRanges [data-range="month"]').getAttribute('aria-pressed'), 'true');
  assert.equal(text(doc, 'dwrState'), '한 달');
  // 9/27~10/27: 9월의 A 480 · B 480 → 960 을 30 : 20.
  assert.deepEqual(shares(doc), [['SSCB', '50%', '60%', true], [B, '50%', '40%', true]]);
  doc.querySelector('#dwrRanges [data-range="week"]').click();
  assert.equal(text(doc, 'dwrState'), '7일');
  assert.equal(doc.querySelector('#dwrTop li').textContent, '이 기간에 적은 업무가 없습니다');
  assert.equal(asked.dash, 1);
});

test('카드 — 늘 있는 더하기 줄로 업무(이름 · 목표 %)를 더하면 저장소에 남고 달마다 그만큼 먼저 뗀다. 목표 칸을 고치면 바뀌고 × 로 뺀다', async () => {
  const { doc, box, store } = boxWith();
  await box.wire();
  await box.show();
  await settle();
  const adding = doc.querySelector('#dwrTop li.dwr-adding');
  assert.ok(adding, '누르지 않아도 더하기 줄이 있다');
  assert.equal(adding.nextElementSibling.querySelector('.dwr-top-name').textContent, '기타', '더하기 줄은 기타 위');
  doc.getElementById('dwrNewName').value = 'AIP';
  doc.getElementById('dwrNewRate').value = '5';
  doc.querySelector('#dwrTop [data-save]').click();
  assert.deepEqual(store[SHARE_KEY], { items: [{ name: 'AIP', rate: 5 }] });
  assert.deepEqual([doc.getElementById('dwrNewName').value, doc.getElementById('dwrNewRate').value], ['', ''], '더하면 더하기 줄은 비운다');
  // 달마다 5% 를 먼저 떼고 남은 몫을 나눈다 — SSCB 1376.1분(57%) · B 632.4분(26%) · AIP 121.5분(5%, 적은 것은 없다).
  assert.deepEqual(shares(doc), [['SSCB', '48%', '57%', true], [B, '40%', '26%', true], ['AIP', '0%', '5%', true], ['기타', '12%', '', false]]);

  const rate = doc.querySelector('#dwrTop input[data-rate="AIP"]');
  rate.focus();
  rate.value = '10';
  rate.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert.deepEqual(store[SHARE_KEY], { items: [{ name: 'AIP', rate: 10 }] });
  assert.deepEqual(shares(doc)[2], ['AIP', '0%', '10%', true]);
  assert.equal(doc.activeElement?.dataset.rate, 'AIP', '고친 목표 칸에 커서가 남는다(이어서 고친다)');

  doc.querySelector('#dwrTop [data-save]').click();
  assert.equal(store[SHARE_KEY].items.length, 1, '이름이 없으면 더하지 않는다');
  doc.getElementById('dwrNewName').value = '교육';
  doc.getElementById('dwrNewName').focus();
  doc.querySelector('#dwrRanges [data-range="month"]').click();
  assert.equal(doc.getElementById('dwrNewName').value, '교육', '다시 그려도 쓰던 글은 그대로');
  assert.equal(doc.activeElement, doc.getElementById('dwrNewName'), '커서도');
  doc.getElementById('dwrNewRate').value = '3';
  key(doc, doc.getElementById('dwrNewRate'), 'Enter');
  assert.deepEqual(store[SHARE_KEY], { items: [{ name: 'AIP', rate: 10 }, { name: '교육', rate: 3 }] });
  doc.getElementById('dwrNewName').value = '연수';
  key(doc, doc.getElementById('dwrNewName'), 'Escape');
  assert.equal(doc.getElementById('dwrNewName').value, '', 'Esc 는 비우기만');
  assert.equal(store[SHARE_KEY].items.length, 2);

  doc.querySelector('#dwrTop [data-del="AIP"]').click();
  assert.deepEqual(store[SHARE_KEY], { items: [{ name: '교육', rate: 3 }] });
  assert.deepEqual(shares(doc).map((r) => r[0]), ['SSCB', B, '교육']);
});

test('카드 — 10분 안이면 다시 받지 않고 장부·내 이름만 다시 읽는다. ↻(force)나 10분 뒤에는 받는다. 저장해 둔 ID·기간·접힘·더한 업무를 쓴다', async () => {
  const { doc, box, store, asked, tick } = boxWith({ saved: { [USER_KEY]: 'hong', [RANGE_KEY]: 'week', [OPEN_KEY]: false, [SHARE_KEY]: { items: [{ name: 'AIP', rate: 5 }] } } });
  box.wire();
  await box.show();
  await settle();
  assert.equal(asked.user, 0, '저장해 둔 ID');
  assert.equal(doc.getElementById('dwrBox').open, false);
  assert.equal(text(doc, 'dwrState'), '7일');
  assert.deepEqual(shares(doc), [['AIP', '0%', '5%', false]], '기간에 적은 게 없어도 더한 업무 줄은 선다');
  assert.match(text(doc, 'dwrHint'), /^설정 › 일반의 내 이름이 있어야/);
  Object.assign(store, { myName: '김철수', rndBook: BOOK });
  await box.show();
  assert.match(text(doc, 'dwrHint'), /김철수 님의 참여율을 찾지 못해/, '열 때마다 장부·내 이름을 다시 읽는다');
  store.myName = '홍길동';
  tick(9 * 60 * 1000);
  await box.show();
  assert.equal(text(doc, 'dwrHint'), '');
  assert.equal(asked.dash, 1);
  await box.show({ force: true });
  tick(11 * 60 * 1000);
  await box.show();
  assert.equal(asked.dash, 3);
});

test('카드 — 로그인이 풀렸으면 까닭과 eclass 열기, 다시 보면 다시 받는다. 머리의 두 아이콘은 작성 화면과 대시보드를 새 탭으로', async () => {
  let fail = true;
  const { doc, box, tabs } = boxWith({ api: { fetchDashboard: async () => { if (fail) throw new AuthError(LOGIN_MESSAGE); return { rows: [] }; } } });
  await box.wire();
  await box.show();
  assert.equal(text(doc, 'dwrState'), '읽지 못함');
  assert.match(text(doc, 'dwrMsg'), /^로그인이 필요합니다.*eclass 열기$/);
  assert.ok(doc.getElementById('dwrMsg').classList.contains('error'));
  assert.equal(doc.getElementById('dwrNewName'), null, '받기 전에는 더하기 줄이 없다');
  doc.querySelector('#dwrMsg [data-login]').click();
  doc.getElementById('dwrWrite').click();
  doc.getElementById('dwrOpen').click();
  assert.deepEqual(tabs, ['https://eclass.krs.co.kr/eClassVer4/Home/Index', DWR_WRITE, DWR_HOME]);
  assert.equal(doc.getElementById('dwrBox').open, true, '머리 줄의 아이콘을 눌러도 접히지 않는다');
  fail = false;
  await box.show();
  await settle();
  assert.equal(text(doc, 'dwrState'), '올해');
  assert.equal(text(doc, 'dwrLast'), '작성한 날 없음');
  assert.equal(doc.querySelector('#dwrTop li').textContent, '이 기간에 적은 업무가 없습니다');
  assert.equal(text(doc, 'dwrMsg'), '');
});
