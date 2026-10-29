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
function boxWith({ saved = { myName: '홍길동', rndBook: BOOK }, api = {}, today = '2026-10-27', fillStaff, extra = {} } = {}) {
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
    ...(fillStaff ? { fillStaff: () => fillStaff(store) } : {}),
    ...extra,
  });
  return { doc, box, store, tabs, asked, tick: (ms) => { clock += ms; } };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const text = (doc, id) => doc.getElementById(id).textContent;
/** 업무 비율 줄 — [이름, 참여율, 실제, 목표(입력칸의 값), 붉음(5%p 넘게 벌어짐)]. */
const shares = (doc) => [...doc.querySelectorAll('#dwrTop li[data-key]')].map((li) => {
  const goal = li.querySelector('input[data-rate], input[data-goal]').value;
  return [li.querySelector('.dwr-top-name').textContent, li.querySelector('.dwr-need').textContent, li.querySelector('.dwr-real').textContent, goal ? `${goal}%` : '', li.classList.contains('dwr-off')];
});
const change = (doc, el, value) => {
  el.focus();
  el.value = value;
  el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
};
const key = (doc, el, k) => el.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true }));

test('카드 — 현황에서만 서고, 받으면 머리 줄(기간) · 마지막 작성일 · 업무 비율(내 과제 참여율 — 올해는 열두 달 평균 · 실제 · 내가 넣는 목표)을 그린다. 네 칸·진행현황·활동성·최근 업무는 없다', async () => {
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
  // 참여율은 열두 달 평균 — A 3~9월 30% → 30 × 7 / 12 = 17.5, B 8~9월 20% → 20 × 2 / 12 = 3.3(2026-10-28 "4월 과제라도 12개월로 나눠야"). 실제는 기간 2430분 가운데.
  assert.deepEqual([...doc.querySelectorAll('#dwrTop li.dwr-cols > span')].map((x) => x.textContent), ['업무 비율', '', '참여율', '실제', '목표'], '첫 줄은 칸 이름');
  // 참여율은 과제 줄에만, 목표는 넣기 전엔 비었다(붉음은 참여율과 견준다).
  assert.deepEqual(shares(doc), [['SSCB', '18%', '48%', '', true], [B, '3%', '40%', '', true], ['기타', '', '12%', '', false]]);
  const first = doc.querySelector('#dwrTop li[data-key]');
  assert.equal(first.title.split('\n')[0], A, '풍선말 첫 줄은 과제 이름');
  assert.match(first.title, /실제 19\.5시간 \(48%\) · 참여율 18%\(열두 달 평균\)/);
  assert.match(first.title, /3월 100% \/ 30% {2}8월 0% \/ 30% {2}9월 48% \/ 30%/, '달마다의 실제 / 그 달 참여율');
  assert.ok(first.querySelector('.dwr-bar b:not(.dwr-goal)'), '참여율은 막대의 회색 금');
  assert.equal(first.querySelector('.dwr-bar b.dwr-goal'), null, '목표를 넣기 전엔 노란 금이 없다');
  assert.equal(doc.querySelector('#dwrTop li.dwr-k-etc .dwr-bar b'), null, '기타는 참여율이 없다');
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
  // 9/27~10/27: 실제는 9월의 A 480 · B 480, 참여율은 걸친 9·10월의 평균 — A (30 + 0) / 2 · B (20 + 0) / 2.
  assert.deepEqual(shares(doc), [['SSCB', '15%', '50%', '', true], [B, '10%', '50%', '', true]]);
  doc.querySelector('#dwrRanges [data-range="week"]').click();
  assert.equal(text(doc, 'dwrState'), '7일');
  assert.equal(doc.querySelector('#dwrTop li.dwr-none').textContent, '이 기간에 적은 업무가 없습니다');
  assert.equal(asked.dash, 1);
});

test('카드 — 늘 있는 더하기 줄로 업무(이름 · 목표 %)를 더하면 저장소에 남는다(과제 참여율은 그대로). 목표 칸을 고치면 바뀌고 × 로 뺀다', async () => {
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
  assert.deepEqual(store[SHARE_KEY], { items: [{ name: 'AIP', rate: 5 }], goals: {} });
  assert.deepEqual([doc.getElementById('dwrNewName').value, doc.getElementById('dwrNewRate').value], ['', ''], '더하면 더하기 줄은 비운다');
  // 더한 업무는 과제 참여율을 바꾸지 않는다(2026-10-28 — 남은 몫을 나누던 셈의 철회). 더한 업무는 과제가 아니라 참여율 칸이 비었다.
  assert.deepEqual(shares(doc), [['SSCB', '18%', '48%', '', true], [B, '3%', '40%', '', true], ['AIP', '', '0%', '5%', true], ['기타', '', '12%', '', false]]);

  change(doc, doc.querySelector('#dwrTop input[data-rate="AIP"]'), '10');
  assert.deepEqual(store[SHARE_KEY], { items: [{ name: 'AIP', rate: 10 }], goals: {} });
  assert.deepEqual(shares(doc)[2], ['AIP', '', '0%', '10%', true]);
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
  assert.deepEqual(store[SHARE_KEY], { items: [{ name: 'AIP', rate: 10 }, { name: '교육', rate: 3 }], goals: {} });
  doc.getElementById('dwrNewName').value = '연수';
  key(doc, doc.getElementById('dwrNewName'), 'Escape');
  assert.equal(doc.getElementById('dwrNewName').value, '', 'Esc 는 비우기만');
  assert.equal(store[SHARE_KEY].items.length, 2);

  doc.querySelector('#dwrTop [data-del="AIP"]').click();
  assert.deepEqual(store[SHARE_KEY], { items: [{ name: '교육', rate: 3 }], goals: {} });
  assert.deepEqual(shares(doc).map((r) => r[0]), ['SSCB', B, '교육']);
});

test('카드 — 과제·기타 줄에도 목표 % 를 넣는다(2026-10-28). 저장소에 남고 노란 금으로 서며, 붉음은 목표와 견준다. 참여율 칸은 바뀌지 않는다. 비우면 지운다', async () => {
  const { doc, box, store } = boxWith();
  await box.wire();
  await box.show();
  await settle();
  change(doc, doc.querySelector('#dwrTop input[data-goal="prj:a"]'), '50');
  assert.deepEqual(store[SHARE_KEY], { items: [], goals: { 'prj:a': 50 } });
  assert.deepEqual(shares(doc)[0], ['SSCB', '18%', '48%', '50%', false], '실제 48% 는 목표 50% 와 2%p — 붉지 않다(참여율 18% 와는 견주지 않는다)');
  assert.ok(doc.querySelector('#dwrTop li[data-key="prj:a"] .dwr-bar b.dwr-goal'));
  assert.equal(doc.activeElement?.dataset.goal, 'prj:a', '커서는 그 칸에 남는다');
  change(doc, doc.querySelector('#dwrTop input[data-goal="etc"]'), '20');
  assert.deepEqual(shares(doc), [['SSCB', '18%', '48%', '50%', false], [B, '3%', '40%', '', true], ['기타', '', '12%', '20%', true]], '기타의 목표는 견주기만 — 과제들의 참여율은 그대로');
  change(doc, doc.querySelector('#dwrTop input[data-goal="prj:a"]'), '');
  assert.deepEqual(store[SHARE_KEY].goals, { etc: 20 });
  assert.deepEqual(shares(doc)[0], ['SSCB', '18%', '48%', '', true], '비우면 다시 참여율과 견준다');
});

test('카드 — R&D 탭에서 열지 않아 참여인력이 없던 과제를 그 탭이 받아 오면(fillStaff) 참여율을 다시 그린다(2026-10-28 "rerp 에 보면 참여율 정보가 있잖아 그게 반영이 안된듯 한데")', async () => {
  const noB = { projects: [BOOK.projects[0], { id: 'b', name: B, alias: '', years: { 1: {} } }] };
  let filled = 0;
  const { doc, box } = boxWith({ saved: { myName: '홍길동', rndBook: noB }, fillStaff: async (store) => { filled++; store.rndBook = BOOK; return 1; } });
  await box.wire();
  await box.show();
  await settle();
  assert.equal(filled, 1, '받을 때 한 번 부른다');
  assert.deepEqual(shares(doc)[1], [B, '3%', '40%', '', true], 'B 의 참여인력이 들어와 참여율이 선다');
});

test('카드 — 10분 안이면 다시 받지 않고 장부·내 이름만 다시 읽는다. ↻(force)나 10분 뒤에는 받는다. 저장해 둔 ID·기간·접힘·더한 업무를 쓴다', async () => {
  const { doc, box, store, asked, tick } = boxWith({ saved: { [USER_KEY]: 'hong', [RANGE_KEY]: 'week', [OPEN_KEY]: false, [SHARE_KEY]: { items: [{ name: 'AIP', rate: 5 }] } } });
  box.wire();
  await box.show();
  await settle();
  assert.equal(asked.user, 0, '저장해 둔 ID');
  assert.equal(doc.getElementById('dwrBox').open, false);
  assert.equal(text(doc, 'dwrState'), '7일');
  assert.deepEqual(shares(doc), [['AIP', '', '0%', '5%', false]], '기간에 적은 게 없어도 더한 업무 줄은 선다');
  assert.match(text(doc, 'dwrHint'), /^설정 › 일반의 내 이름이 있어야/);
  Object.assign(store, { myName: '김철수', rndBook: BOOK });
  await box.show();
  assert.match(text(doc, 'dwrHint'), /김철수 님의 참여율을 찾지 못했습니다/, '열 때마다 장부·내 이름을 다시 읽는다');
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
  assert.equal(doc.querySelector('#dwrTop li.dwr-none').textContent, '이 기간에 적은 업무가 없습니다');
  assert.equal(text(doc, 'dwrMsg'), '');
});

/* ------------------------------------------------------------ 일일 업무 짜기(2026-10-29) */
// "여기 목표에 맞도록 일일 업무보고를 신청할 수 있도록 해줘. 꼭 딱 맞출 필요는 없고 목표 총 합을 100%로 변경해서 목표와 실제 값이 비슷하게 달성할 수 있도록 해줘.
// 다만, 근태 내역을 보고 출장/외근의 경우 과제에 맞도록 없거나 모모하면 나두고". 짜는 셈은 test/dwrplan.test.mjs, 쓰기는 test/dwrwrite.test.mjs 가 본다 — 여기는 카드.

const { createDispatcher } = await import('../actions/dispatch.js');
const { registerDwr } = await import('../actions/runners/dwr.js');
const { DAYS_KEY, DONE_KEY } = await import('../dwrbox.js');

/** HR 근태현황의 줄(krs-web-agents 러너가 읽던 꼴). */
const HRROW = (date, more = {}) => ({ workDate: date.replace(/-/g, ''), sWorkHour: '8', sStartTime: '0830', planWorkHour: '8', workCodeKindName: '통상근무', workRsn: '', workStatus: '', ...more });
const HRROWS = [
  HRROW('2026-10-01'),
  HRROW('2026-10-02', { sWorkHour: '', workCodeKindName: '외근', workRsn: '고압 드라이브 시제품 회의', workStatus: '외근(13:00~17:00)' }),
  HRROW('2026-10-03', { sWorkHour: '', sStartTime: '', workCodeKindName: '' }),
  HRROW('2026-10-05', { sWorkHour: '', workCodeKindName: '국내출장', workRsn: 'K-Battery Show 참석', workStatus: '국내출장(07:00~23:59)' }),
];

/** 짜기를 켠 카드 — HR(workPlan)·디스패처(dwr.write 등록)·작성기를 흉내 낸다. 목표는 SSCB 30 · B 20(합 50 → 60 · 40). */
function planBox({ hr = async () => HRROWS, writeDay, saved = {} } = {}) {
  const asked = { hr: [], writes: [], closed: 0, logs: [] };
  const actions = createDispatcher({ log: (e) => asked.logs.push(e) });
  registerDwr(actions);
  const createWriter = () => ({
    writeDay: async (day, opts) => {
      asked.writes.push(day);
      opts?.onStage?.('저장 중…');
      return writeDay ? writeDay(day) : { ok: true, status: day.op === 'submit' ? 'submitted' : 'saved', row: '8', rowName: day.title, note: '' };
    },
    close: async () => { asked.closed++; },
  });
  const t = boxWith({
    saved: { myName: '홍길동', rndBook: BOOK, [SHARE_KEY]: { items: [], goals: { 'prj:a': 30, 'prj:b': 20 } }, ...saved },
    extra: { workPlan: async (range) => { asked.hr.push(range); return hr(range); }, actions, createWriter },
  });
  return { ...t, asked };
}
const ready = async (box) => { await box.wire(); await box.show(); for (let i = 0; i < 5; i++) await settle(); };
/** 짠 날 줄 — [날짜, 고른 업무(두기면 ''), 시간, 상태, 내용 또는 까닭]. */
const planDaysOf = (doc) => [...doc.querySelectorAll('#dwrPlan .dwr-day')].map((li) => {
  const sel = li.querySelector('select');
  return [li.querySelector('.dwr-day-date').textContent, sel.selectedOptions[0].textContent === '두기' ? '' : sel.selectedOptions[0].textContent,
    li.querySelector('[data-day-hours]').value, li.querySelector('.dwr-day-state').textContent,
    li.querySelector('.dwr-day-text')?.value ?? li.querySelector('.dwr-day-why').textContent];
});
const goalRows = (doc) => [...doc.querySelectorAll('#dwrPlan .dwr-goals li')].map((li) => [...li.children].map((x) => x.textContent));

test('짜기 — 마지막으로 적은 날 다음날부터 오늘까지 HR 근태현황을 읽어(하루 한 번 담아 둔다) 날마다 업무를 짜고, 목표를 합 100% 로 늘인 표와 날마다 한 줄을 그린다', async () => {
  const { doc, box, store, asked } = planBox();
  await ready(box);
  assert.deepEqual(asked.hr, [{ from: '2026-10-01', to: '2026-10-27' }], '9/30 까지 적었다');
  assert.equal(store[DAYS_KEY].day, '2026-10-27');
  assert.equal(doc.querySelector('#dwrPlan .dwr-plan-title').textContent, '일일 업무 짜기');
  assert.equal(doc.querySelector('#dwrPlan .dwr-plan-span').textContent, '10/1~10/27 · 2일 (둘 1일)');
  assert.deepEqual([...doc.querySelectorAll('#dwrPlan [data-plan]')].map((b) => b.dataset.plan), ['reload', 'save', 'submit'], '머리의 아이콘 — 근태 다시 읽기·저장·제출');
  // 올해 적은 2430분(SSCB 1170 · B 960) + 짠 960분 — 쓴 뒤 SSCB 1650 / 3390 · B 1440 / 3390(기타 300분은 그대로라 딱 맞지는 않는다).
  assert.deepEqual(goalRows(doc), [['목표 50% → 100%', '목표', '지금', '쓴 뒤'], ['SSCB', '60%', '48%', '49%'], [B, '40%', '40%', '42%']]);
  // 외근은 사유(고압 드라이브 시제품)의 과제, 출장(K-Battery Show)은 맞는 과제가 없어 둔다, 10/3 은 근무가 없다. 10/1 은 목표에 가장 못 미친 SSCB.
  assert.deepEqual(planDaysOf(doc), [
    ['10/1 목', 'SSCB', '8', '', `${A} 작업`],
    ['10/2 금', B, '8', '외근', '고압 드라이브 시제품 회의'],
    ['10/5 월', '', '8', '국내출장', '사유에 맞는 업무가 없습니다 — K-Battery Show 참석'],
  ]);
  assert.equal(doc.querySelector('#dwrPlan .dwr-day[data-date="2026-10-01"] select').title, A, '업무명은 풍선말에');
  // 10분 안에 다시 보면 근태도 다시 읽지 않는다. 근태 다시 읽기 아이콘은 읽는다.
  await box.show();
  await settle();
  assert.equal(asked.hr.length, 1);
  doc.querySelector('#dwrPlan [data-plan="reload"]').click();
  await settle();
  assert.equal(asked.hr.length, 2);
});

test('짜기 — 사람이 고른·두기·고친 날은 그대로 두고 나머지를 다시 짠다. 목표를 바꾸면 다시 짠다', async () => {
  const { doc, box } = planBox();
  await ready(box);
  const pick = (date, value) => change(doc, doc.querySelector(`#dwrPlan [data-day-key="${date}"]`), value);
  pick('2026-10-05', 'prj:a');
  assert.deepEqual(planDaysOf(doc)[2], ['10/5 월', 'SSCB', '8', '국내출장', 'K-Battery Show 참석'], '둔 출장 날도 고르면 그 업무 — 내용은 출장 사유(원본 러너와 같다)');
  pick('2026-10-01', '');
  assert.deepEqual(planDaysOf(doc)[0], ['10/1 목', '', '8', '', '두기']);
  change(doc, doc.querySelector('#dwrPlan [data-day-content="2026-10-02"]'), '드라이브 시제품 착수 회의');
  change(doc, doc.querySelector('#dwrPlan [data-day-hours="2026-10-02"]'), '4');
  assert.deepEqual(planDaysOf(doc)[1], ['10/2 금', B, '4', '외근', '드라이브 시제품 착수 회의']);
  change(doc, doc.querySelector('#dwrPlan [data-day-hours="2026-10-02"]'), '0');
  assert.equal(planDaysOf(doc)[1][2], '4', '0 시간은 받지 않는다');
  // 목표 칸을 바꾸면 표가 따라온다(정한 날은 그대로).
  change(doc, doc.querySelector('#dwrTop input[data-goal="prj:b"]'), '30');
  assert.deepEqual(goalRows(doc)[0][0], '목표 60% → 100%');
  assert.deepEqual(planDaysOf(doc).map((d) => d[1]), ['', B, 'SSCB']);
  // 근태 다시 읽기는 정한 것을 지운다.
  doc.querySelector('#dwrPlan [data-plan="reload"]').click();
  for (let i = 0; i < 3; i++) await settle();
  assert.deepEqual(planDaysOf(doc).map((d) => d[1]), ['SSCB', B, '']);
});

test('저장·제출 — 짠 날마다 dwr.write 기록 하나를 디스패처로(작성기 하나로 쓰고 닫는다). 저장한 날은 적어 두고 그대로 다시 서며, 제출은 두 번 눌러 그 날들을 제출한다', async () => {
  const { doc, box, store, asked } = planBox();
  await ready(box);
  doc.querySelector('#dwrPlan [data-plan="save"]').click();
  for (let i = 0; i < 6; i++) await settle();
  assert.deepEqual(asked.writes.map((d) => [d.date, d.title, d.hours, d.trip, d.op, d.content]), [
    ['2026-10-01', A, 8, false, 'save', `${A} 작업`],
    ['2026-10-02', B, 8, true, 'save', '고압 드라이브 시제품 회의'],
  ], '둔 날(10/5)은 쓰지 않는다');
  assert.equal(asked.closed, 1);
  assert.deepEqual(asked.logs.map((e) => [e.kind, e.ok, e.text]), [['dwr', true, '일일 업무 10/1 SSCB 8시간 저장'], ['dwr', true, `일일 업무 10/2 ${B} 8시간 저장`]]);
  assert.equal(asked.logs[0].data.record.action, 'dwr.write');
  assert.deepEqual(Object.keys(store[DONE_KEY]), ['2026-10-01', '2026-10-02']);
  assert.equal(store[DONE_KEY]['2026-10-01'].status, 'saved');
  // 대시보드를 다시 받는다 — 저장만 한 날은 대시보드에 없어도 저장함으로 서고 고칠 수 없다.
  assert.deepEqual(planDaysOf(doc).map((d) => [d[0], d[1], d[3]]), [['10/1 목', 'SSCB', '저장함'], ['10/2 금', B, '저장함'], ['10/5 월', '', '국내출장']]);
  assert.ok(doc.querySelector('#dwrPlan [data-day-key="2026-10-01"]').disabled);
  assert.equal(doc.querySelector('#dwrPlan .dwr-plan-note').textContent, '저장함 2일');

  const send = () => doc.querySelector('#dwrPlan [data-plan="submit"]');
  send().click();
  assert.ok(send().classList.contains('armed'), '첫 누름은 준비만');
  assert.equal(send().title, '한 번 더 누르면 제출합니다');
  assert.equal(asked.writes.length, 2);
  send().click();
  for (let i = 0; i < 6; i++) await settle();
  assert.deepEqual(asked.writes.slice(2).map((d) => [d.date, d.op, d.content]), [['2026-10-01', 'submit', `${A} 작업`], ['2026-10-02', 'submit', '고압 드라이브 시제품 회의']], '저장해 둔 그 내용 그대로');
  assert.equal(store[DONE_KEY]['2026-10-02'].status, 'submitted');
  assert.deepEqual(planDaysOf(doc).map((d) => d[0]), ['10/5 월'], '제출한 날은 빠진다');
  assert.equal(doc.querySelector('#dwrPlan [data-plan="save"]'), null, '쓸 날이 없으면 저장·제출 아이콘이 없다');
});

test('저장·제출 — 이미 적은 날·실패는 그 날 줄에 적고 다음 날로 간다. 로그인이 풀리면 멈춘다. 내용이 빈 날은 건너뛴다', async () => {
  let n = 0;
  const { doc, box, store, asked } = planBox({
    hr: async () => [HRROW('2026-10-01'), HRROW('2026-10-02'), HRROW('2026-10-06'), HRROW('2026-10-07')],
    writeDay: async () => {
      n += 1;
      if (n === 1) return { ok: false, status: 'exists', row: '8', rowName: A, note: '그 날 이미 적은 업무가 있어 쓰지 않았습니다(부서소통회)' };
      if (n === 2) throw new Error('작성 화면의 업무 목록에 "x" 이 없습니다');
      throw new AuthError(LOGIN_MESSAGE);
    },
  });
  await ready(box);
  change(doc, doc.querySelector('#dwrPlan [data-day-content="2026-10-07"]'), '');
  doc.querySelector('#dwrPlan [data-plan="save"]').click();
  for (let i = 0; i < 6; i++) await settle();
  assert.equal(asked.writes.length, 3, '로그인이 풀린 뒤로는 쓰지 않는다');
  const st = [...doc.querySelectorAll('#dwrPlan .dwr-day-state')].map((x) => [x.textContent, x.title]);
  assert.deepEqual(st.slice(0, 3), [
    ['이미 있음', '그 날 이미 적은 업무가 있어 쓰지 않았습니다(부서소통회)'],
    ['안 됨', '작성 화면의 업무 목록에 "x" 이 없습니다'],
    ['안 됨', LOGIN_MESSAGE],
  ]);
  assert.equal(store[DONE_KEY], undefined, '쓴 날이 없다');
  assert.match(text(doc, 'dwrMsg'), /로그인이 필요합니다/);
  assert.deepEqual(asked.logs.map((e) => e.ok), [false, false, false]);
});

test('더한 업무의 e-Class 업무명(2026-10-29 "AIP 업무는 이걸로 하게 해줘") — 줄의 고리 아이콘이 그 아래 업무명 칸을 열고, Enter 로 정하면 남고 짜기·쓰기가 그 업무명을 쓴다. 비우면 지운다', async () => {
  const AIP = '시험/인증업무>AIP 기술검토 및 관리';
  const { doc, box, store, asked } = planBox({ saved: { [SHARE_KEY]: { items: [{ name: 'AIP', rate: 6 }], goals: { 'prj:a': 30, 'prj:b': 20 } } } });
  await ready(box);
  const icon = () => doc.querySelector('#dwrTop [data-titling="AIP"]');
  assert.ok(icon(), '더한 업무 줄에만 고리 아이콘');
  assert.equal(doc.querySelectorAll('#dwrTop [data-titling]').length, 1);
  assert.ok(!icon().classList.contains('on'));
  icon().click();
  const input = doc.getElementById('dwrItemTitle');
  assert.ok(input.closest('li').classList.contains('dwr-titling'));
  assert.equal(input.closest('li').previousElementSibling.dataset.key, 'item:AIP', '그 줄 바로 아래');
  assert.equal(doc.activeElement, input);
  input.value = ` ${AIP} `;
  key(doc, input, 'Enter');
  assert.deepEqual(store[SHARE_KEY].items, [{ name: 'AIP', rate: 6, title: AIP }]);
  assert.equal(doc.getElementById('dwrItemTitle'), null, '정하면 칸이 닫힌다');
  assert.ok(icon().classList.contains('on'));
  assert.equal(icon().title, `e-Class 업무명 「${AIP}」`);
  assert.match(doc.querySelector('#dwrTop li[data-key="item:AIP"]').title, /e-Class 업무명 「시험\/인증업무>AIP 기술검토 및 관리」/);
  // 목표를 고쳐도 업무명은 그대로. 같은 이름을 다시 더해도.
  change(doc, doc.querySelector('#dwrTop input[data-rate="AIP"]'), '8');
  doc.getElementById('dwrNewName').value = 'aip';
  doc.getElementById('dwrNewRate').value = '7';
  doc.querySelector('#dwrTop [data-save]').click();
  assert.deepEqual(store[SHARE_KEY].items, [{ name: 'aip', rate: 7, title: AIP }]);
  // 짜기 — 그 날을 AIP 로 고르면 업무명 풍선말과 쓰는 기록이 그 업무명이다.
  change(doc, doc.querySelector('#dwrPlan [data-day-key="2026-10-01"]'), 'item:aip');
  change(doc, doc.querySelector('#dwrPlan [data-day-content="2026-10-01"]'), 'AIP 개념승인 검토');
  assert.equal(doc.querySelector('#dwrPlan [data-day-key="2026-10-01"]').title, AIP);
  doc.querySelector('#dwrPlan [data-plan="save"]').click();
  for (let i = 0; i < 6; i++) await settle();
  assert.deepEqual([asked.writes[0].date, asked.writes[0].title, asked.writes[0].content], ['2026-10-01', AIP, 'AIP 개념승인 검토']);
  // 비우고 ✓ 면 지운다. Esc 는 닫기만.
  doc.querySelector('#dwrTop [data-titling="aip"]').click();
  key(doc, doc.getElementById('dwrItemTitle'), 'Escape');
  assert.equal(doc.getElementById('dwrItemTitle'), null);
  doc.querySelector('#dwrTop [data-titling="aip"]').click();
  doc.getElementById('dwrItemTitle').value = '';
  doc.querySelector('#dwrTop [data-title-save="aip"]').click();
  assert.deepEqual(store[SHARE_KEY].items, [{ name: 'aip', rate: 7 }]);
});

test('짜기 — 근태를 못 읽으면 까닭(로그인이면 eclass 열기). 목표가 없으면 그렇다고 적고, 다 적었으면·HR 이 없으면 칸이 서지 않는다', async () => {
  const { doc, box, tabs } = planBox({ hr: async () => { throw new AuthError(LOGIN_MESSAGE); } });
  await ready(box);
  assert.match(doc.querySelector('#dwrPlan .dwr-msg.error').textContent, /^근태현황을 읽지 못했습니다 — 로그인이 필요합니다.*eclass 열기$/);
  doc.querySelector('#dwrPlan [data-login]').click();
  assert.deepEqual(tabs, ['https://eclass.krs.co.kr/eClassVer4/Home/Index']);

  const none = planBox({ saved: { [SHARE_KEY]: { items: [], goals: {} } } });
  await ready(none.box);
  assert.equal(none.doc.querySelector('#dwrPlan .dwr-plan-none').textContent, '업무 비율의 목표 칸에 % 를 넣으면 그 비율에 맞춰 짭니다');
  assert.deepEqual(planDaysOf(none.doc).map((d) => [d[1], d[4]]), [['', '목표 % 를 넣은 업무가 없습니다'], [B, '고압 드라이브 시제품 회의'], ['', '사유에 맞는 업무가 없습니다 — K-Battery Show 참석']]);

  const late = boxWith({ today: '2026-09-30', extra: { workPlan: async () => HRROWS, actions: createDispatcher(), createWriter: () => ({}) } });
  await ready(late.box);
  assert.equal(late.doc.getElementById('dwrPlan').innerHTML, '', '오늘까지 다 적었다');
  const off = boxWith();
  await ready(off.box);
  assert.equal(off.doc.getElementById('dwrPlan').innerHTML, '', 'HR·디스패처를 주지 않으면 서지 않는다');
});
