// 빈자리가 나면 예약까지(2026-11-10 사용자 지정: "좌석이 생기면 결재는 아니고 좌석 예약까지 할 수 있도록 구현해 줄래?" · "이미 로그인이 되었다고 가정하고").
// 탭 안 — 그 열차 한 줄의 살 수 있는 가격을 누르고 예매를 누른다 · 예매 뒤 화면 다루기. 실행부 — 조건 확인·결제 직전 화면 확인·로그인·차단. 대기 — 자리가 나면 예약을 기다리고 다른 대기를 멈춘다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { KORAIL_LIST, RESERVE_GUARD_PASSES, RESERVE_PACE_MS, ktxReserve, ktxWatch, ktxWatchStop } from '../src/ktx.js';
import { korailSeatsPage } from '../src/korailseats.js';
import { korailReservePage, korailPopupPage } from '../src/korailreserve.js';
import { createDispatcher } from '../actions/dispatch.js';
import { registerKtx } from '../actions/runners/ktx.js';
import { ACTIONS } from '../actions/spec.js';
const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

const INPUT = { from: '부산', to: '서울', date: '2026-11-13', hour: 9, adults: 1 };
const TARGET = { ...INPUT, train: '024', dep: '09:26', seat: 'any' };
const PAGE_TARGET = { no: '024', dep: '09:26', from: '부산', to: '서울', seat: 'gen' };
const COND = { from: '부산', to: '서울', date: '2026-11-13(금) 09:00', people: '총 1명' };
const noWait = async () => {};

// 2026-05-14 binjari 실측 꼴 — 가격 <a> 로 줄을 고르고 하단 button.reservbtn 으로 예매.
const row = (no, dep, gen, spec = '<div class="price_box"><a href="#none">특실 83,700원</a></div>', [from, to] = ['부산', '서울']) =>
  `<li class="tckList"><div class="data_box"><h3><span>${from}</span><span>${to}</span></h3></div>KTX ${no} ${from} → ${to}(${dep} ~ 11:53) 소요시간: 2시간 27분${gen}${spec}</li>`;
function listPage(body, { url = KORAIL_LIST, book = true, select = true } = {}) {
  const dom = new JSDOM(`<body><ul>${body}</ul>${book ? '<button class="reservbtn">예매</button>' : ''}</body>`, { url, pretendToBeVisual: true });
  dom.window.Element.prototype.getClientRects = function () { return this.isConnected ? [{}] : []; };
  const clicks = [];
  dom.window.document.addEventListener('click', (e) => clicks.push(e.target.textContent.trim()), true);
  // 실제 코레일의 객실 선택 표식과 토글 동작. 거절되는 클릭은 테스트에서 preventDefault로 표현한다.
  if (select) dom.window.document.addEventListener('click', (e) => {
    const box = e.target.closest('.price_box a')?.closest('.price_box');
    if (box && !e.defaultPrevented) box.classList.toggle('active');
  });
  return { dom, clicks };
}
async function inPage(dom, func, args) {
  const saved = Object.fromEntries(['document', 'location', 'getComputedStyle'].map((k) => [k, globalThis[k]]));
  Object.assign(globalThis, { document: dom.window.document, location: dom.window.location, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) });
  try { return await func(...args); } finally { Object.assign(globalThis, saved); }
}

test('탭 안 — 그 열차 한 줄의 일반실 가격을 누르고 예매를 누른다(매진임박은 산다)', async () => {
  const { dom, clicks } = listPage(row('020', '08:40', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>')
    + row('024', '09:26', '<div class="price_box gen sold_out_soon"><a href="#none">일반실 59,800원 매진임박</a></div>'));
  const r = await inPage(dom, korailReservePage, ['pick', { no: '24', dep: '09:26', from: '부산', to: '서울' }]);
  assert.deepEqual([r.picked, r.booked, r.seat, r.price], [true, true, '일반실', '59,800원']);
  assert.deepEqual(clicks, ['일반실 59,800원 매진임박', '예매']);
});

test('탭 안 — 일반실이 매진이면 특실, 둘 다 없거나 줄이 하나가 아니면 누르지 않는다', async () => {
  const sold = '<div class="price_box gen sold_out"><a href="#none">일반실 59,800원 매진</a></div>';
  let p = listPage(row('024', '09:26', sold));
  let r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26', from: '부산', to: '서울' }]);
  assert.deepEqual([r.seat, r.price, p.clicks], ['특실', '83,700원', ['특실 83,700원', '예매']]);
  p = listPage(row('024', '09:26', sold));
  r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26', seat: 'gen' }]);
  assert.deepEqual([r.why, p.clicks], ['no-seat', []], '일반실만 고르면 특실로 대신하지 않는다');
  p = listPage(row('024', '09:26', sold, '<div class="price_box sold_out"><a href="#none">특실 매진</a></div>'));
  r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26' }]);
  assert.deepEqual([r.why, p.clicks], ['no-seat', []]);
  p = listPage(row('024', '09:26', '<div class="price_box gen"><a href="#none">입석 + 좌석 예약대기</a></div>', ''));
  r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26' }]);
  assert.equal(r.why, 'no-seat', '입석·예약대기는 자리가 아니다');
  p = listPage(row('024', '09:40', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>'));
  r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26' }]);
  assert.deepEqual([r.why, p.clicks], ['no-row', []], '출발 시각이 다르면 다른 열차다');
  p = listPage(row('024', '09:26', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>', '', ['부산', '광명']));
  r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26', from: '부산', to: '서울' }]);
  assert.equal(r.why, 'no-row', '구간이 다르면 고르지 않는다');
  const twice = row('024', '09:26', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>');
  p = listPage(twice + twice);
  r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26' }]);
  assert.deepEqual([r.why, p.clicks], ['many-rows', []]);
});

const GUARD_BOX = '<div class="ReactModal__Content" id="guard">안내 메시지 매크로 CODE : -8002 <button>확인</button></div>';
/** 확인을 누르면 닫히는 차단 안내로 만든다. */
const closable = (dom) => dom.window.document.querySelector('#guard button').addEventListener('click', (e) => e.target.parentNode.remove());

test('탭 안 — 차단 안내는 확인으로 닫고 이어서 고르며(2026-11-11), 닫히지 않으면 좌석을 누르지 않는다. 결과 화면이 아니면 아무것도 누르지 않는다', async () => {
  let p = listPage(row('024', '09:26', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>') + GUARD_BOX);
  closable(p.dom);
  let r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26' }]);
  assert.deepEqual([r.booked, r.guard, r.passed.map((g) => g.code), p.clicks], [true, null, ['-8002'], ['확인', '일반실 59,800원', '예매']]);
  p = listPage(row('024', '09:26', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>') + GUARD_BOX);
  r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26' }]);
  assert.deepEqual([r.why, r.guard.code, r.passed, p.clicks], ['guard', '-8002', [], ['확인']], '확인을 눌러도 남아 있으면 멈춘다');
  p = listPage(row('024', '09:26', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>'), { url: 'https://www.korail.com/ticket/search/general' });
  r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26' }]);
  assert.deepEqual([r.why, p.clicks], ['not-list', []]);
});

test('탭 안 — 예매 뒤: 진행 확인은 네, 안내는 확인을 누르고 글을 돌려주며, 결제 직전 화면·로그인 화면을 가린다(결제하기는 누르지 않는다)', async () => {
  let p = listPage('<div class="ReactModal__Content">정차역 수가 적어 가격이 최대 0.6% 높습니다. 계속 진행하시겠습니까? <button>아니오</button><button>네</button></div>');
  let r = await inPage(p.dom, korailReservePage, ['settle']);
  assert.deepEqual([r.done, p.clicks], [false, ['네']]);
  assert.match(r.said[0], /계속 진행/);
  p = listPage('<div class="ReactModal__Content">잔여석이 없습니다. <button>확인</button></div>');
  r = await inPage(p.dom, korailReservePage, ['settle']);
  assert.deepEqual([r.done, p.clicks, r.said], [false, ['확인'], ['잔여석이 없습니다. 확인']]);
  p = listPage('<p>결제 기한 2026.11.13 09:36 까지</p><button>결제하기</button>', { url: 'https://www.korail.com/ticket/reservation/detail' });
  r = await inPage(p.dom, korailReservePage, ['settle']);
  assert.deepEqual([r.done, r.deadline, p.clicks], [true, '2026.11.13 09:36', []]);
  p = listPage('<input id="id">', { url: 'https://www.korail.com/ticket/login' });
  r = await inPage(p.dom, korailReservePage, ['settle']);
  assert.equal(r.login, true);
});

test('탭 안 — 따로 뜬 안내 창은 안내 글이 있을 때만 확인을 누른다', async () => {
  let p = listPage('<p>이용안내 — 선택하신 열차를 확인하시고</p><button>확인</button>', { book: false });
  assert.equal((await inPage(p.dom, korailPopupPage, [])).clicked, true);
  p = listPage('<p>광고</p><button>확인</button>', { book: false });
  assert.equal((await inPage(p.dom, korailPopupPage, [])).clicked, false);
});

test('탭 안 — 예약내역·결제 안내 글·상세 화면 로딩은 예약 완료가 아니며 실제 결제 단추가 있는 상세 화면만 완료다', async () => {
  const cases = [
    ['https://www.korail.com/ticket/reservation/list', '<p>예약내역이 없습니다.</p>', false],
    [KORAIL_LIST, '<p>예매 후 결제하기를 눌러 주세요.</p>', false],
    ['https://www.korail.com/ticket/reservation/detail', '<p>불러오는 중</p>', false],
    ['https://www.korail.com/ticket/reservation/detail', '<button>결제하기</button>', true],
  ];
  for (const [url, body, done] of cases) {
    const p = listPage(body, { url, book: false });
    const r = await inPage(p.dom, korailReservePage, ['settle']);
    assert.equal(r.done, done, `${url}: ${body}`);
    assert.deepEqual(p.clicks, [], '화면 판정만 하고 결제는 누르지 않는다');
  }
});

/** 결과 탭 흉내 — 자동 진행(settles)과 수동 진행 관찰(statuses)의 응답을 따로 둔다. */
function reserveApi({ cond = COND, pick = { picked: true, booked: true, seat: '일반실', price: '59,800원', said: [] }, settles = [{ done: true, deadline: '09:36', said: [] }], url = KORAIL_LIST, popups = [],
  rebook = { booked: true }, statuses = [{ done: false, list: true }], reads = [{}], ready = [{ ready: true, key: 'same-selection' }] } = {}) {
  const calls = [];
  const popupTabs = [...popups];
  let settle = 0, read = 0, status = 0, readiness = 0;
  const tab = { id: 7, windowId: 3, url, status: 'complete' };
  const api = {
    tabs: {
      get: async (id) => { if (id !== 7) throw new Error('No tab'); return tab; },
      query: async () => [...popupTabs],
      update: async (id, o) => { Object.assign(tab, o); calls.push(['update', id, o]); return tab; },
      reload: async (id) => { calls.push(['reload', id]); },
    },
    windows: { getCurrent: async () => ({ id: 3 }), update: async (id, o) => { calls.push(['window', id, o]); } },
    runtime: { sendNativeMessage: async (host, message) => { calls.push(['press', host, message]); return { ok: true, pressed: true }; } },
    scripting: { executeScript: async ({ target, func, args }) => {
      if (func === korailPopupPage) {
        if (args[0]?.observeOnly) return [{ result: { words: '이용안내', clicked: false, actionable: true } }];
        calls.push(['popup', target.tabId]);
        const index = popupTabs.findIndex((popup) => popup.id === target.tabId);
        if (index >= 0) popupTabs.splice(index, 1);
        return [{ result: { words: '이용안내', clicked: true, actionable: true } }];
      }
      const step = func === korailSeatsPage ? `seats:${args[0]}` : args[0];
      const { token, expiresAt, ...condition } = args[1] || {};
      calls.push([step, target.tabId, step === 'arm' ? condition : args[1]]);
      if (step === 'disarm') return [{ result: { disarmed: true } }];
      if (step === 'seats:read') return [{ result: { url: tab.url, state: 'rows', guard: null, rows: [], cond, ...reads[Math.min(read++, reads.length - 1)] } }];
      if (step === 'pick') return [{ result: { url: tab.url, guard: null, passed: [], ...pick } }];
      if (step === 'ready') {
        const result = ready[Math.min(readiness++, ready.length - 1)];
        if (result instanceof Error) throw result;
        if (result === null) return [];
        return [{ result: { url: tab.url, guard: null, passed: [], said: [], ...result } }];
      }
      if (step === 'arm') {
        if (rebook instanceof Error) throw rebook;
        if (rebook === null) return [];
        return [{ result: { url: tab.url, guard: null, passed: [], said: [], ...rebook, armed: rebook.booked === true, label: `KRS-${args[1].token}`, expiresAt: args[1].expiresAt } }];
      }
      const answer = step === 'status'
        ? statuses[Math.min(status++, statuses.length - 1)]
        : settles[Math.min(settle++, settles.length - 1)];
      if (answer instanceof Error) throw answer;
      if (answer === null) return [];
      return [{ result: { url: tab.url, guard: null, said: [], ...answer } }];
    } },
  };
  return { api, calls, steps: () => calls.map((c) => c[0]) };
}

test('실행부 — 같은 조건의 결과 탭에서 그 열차를 고르고, 결제 직전 화면이 서면 그 탭을 앞으로 가져온다(결제는 하지 않는다)', async () => {
  const f = reserveApi({ settles: [new Error('Frame with ID 0 was removed'), { done: false, said: ['정차역 수가 적어 … 계속 진행하시겠습니까?'] }, { done: true, deadline: '2026.11.13 09:36' }], popups: [{ id: 9, openerTabId: 7, url: 'https://www.korail.com/popup/notice' }, { id: 10, openerTabId: 1, url: 'https://www.korail.com/x' }] });
  const stages = [];
  const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, onStage: (s) => stages.push(s) });
  assert.deepEqual([r.ok, r.reserved, r.seat, r.price, r.deadline, r.tabId], [true, true, '일반실', '59,800원', '2026.11.13 09:36', 7]);
  assert.match(r.note, /좌석을 잡았습니다.*결제 기한 2026\.11\.13 09:36.*결제는 코레일 탭에서 직접/);
  assert.deepEqual(f.calls.find((c) => c[0] === 'pick')[2], { no: '024', dep: '09:26', from: '부산', to: '서울', seat: 'any', hold: true });
  assert.deepEqual(f.calls.filter((c) => c[0] === 'update' || c[0] === 'window'), [['update', 7, { active: true }], ['window', 3, { focused: true }]]);
  assert.deepEqual(f.calls.filter((c) => c[0] === 'popup').map((c) => c[1]), [9], '그 탭이 연 코레일 창만 다루며 닫힌 창은 다시 누르지 않는다');
  assert.ok(!f.steps().includes('reload'), '예약 중에는 새로고침하지 않는다');
  assert.match(stages.join('|'), /좌석을 고르는 중.*일반실 59,800원/);
});

test('실행부 — 조건이 다르거나 탭이 없거나 자리가 없어졌으면 누르지 않고, 로그인·차단·확인 못 함은 까닭을 알린다', async () => {
  let f = reserveApi({ cond: { ...COND, people: '총 2명' } });
  let r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait });
  assert.deepEqual([r.code, f.steps().includes('pick')], ['CONDITION_MISMATCH', false]);
  f = reserveApi({ url: 'https://www.korail.com/ticket/reservation/detail' });
  assert.equal((await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait })).code, 'RESERVE_NO_TAB');
  assert.equal((await ktxReserve(TARGET, { api: f.api, tabId: null, wait: noWait })).code, 'RESERVE_NO_TAB');
  f = reserveApi({ pick: { why: 'no-seat', said: [] } });
  r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait });
  assert.deepEqual([r.code, r.error], ['RESERVE_NOT_PICKED', '그 사이 자리가 없어졌습니다.']);
  f = reserveApi({ settles: [{ login: true }] });
  assert.equal((await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait })).code, 'RESERVE_LOGIN');
  f = reserveApi({ settles: [{ guard: { code: '-8002', message: '매크로' } }] });
  assert.equal((await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait })).code, 'GUARD_BLOCKED');
  f = reserveApi({ settles: [{ done: false, said: ['잔여석이 없습니다.'] }] });
  r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, tries: 3 });
  assert.equal(r.code, 'RESERVE_UNCONFIRMED');
  assert.match(r.error, /코레일: 잔여석이 없습니다\./);
  for (const bad of [{ train: 'x' }, { dep: '9:26' }, { dep: undefined }]) {
    assert.equal((await ktxReserve({ ...TARGET, ...bad }, { api: f.api, tabId: 7, wait: noWait })).code, 'INPUT_INVALID');
  }
});

test('빈자리 대기 — onFound 를 주면 예약이 끝날 때까지 탭을 다시 읽지 않고 그 답을 싣고, 예약하면 다른 대기를 멈춘다', async () => {
  const empty = { price: '', soldOut: true, soon: false, note: '' };
  const open = { price: '59,800원', soldOut: false, soon: false, note: '' };
  const raw = (gen) => [
    { text: 'KTX 024 부산 → 서울(09:26 ~ 11:53) 소요시간: 2시간 27분', origin: '부산', dest: '서울', gen: { cls: gen ? 'price_box gen' : 'price_box sold_out', text: gen ? '59,800원' : '매진' }, spec: null },
    { text: 'KTX 026 부산 → 서울(09:40 ~ 12:10) 소요시간: 2시간 30분', origin: '부산', dest: '서울', gen: { cls: 'price_box sold_out', text: '매진' }, spec: null },
  ];
  const reads = [raw(false), raw(true)];
  let read = 0, reloads = 0;
  const calls = [];
  const api = {
    tabs: { get: async () => ({ id: 7, url: KORAIL_LIST, status: 'complete', active: false }), reload: async () => { reloads++; } },
    scripting: { executeScript: async () => [{ result: { url: KORAIL_LIST, state: 'rows', guard: null, rows: reads[Math.min(read++, 1)], cond: COND } }] },
  };
  const other = ktxWatch({ ...INPUT, train: '026' }, { api, tabId: 7, wait: noWait });
  const mine = ktxWatch({ ...INPUT, train: '024' }, { api, tabId: 7, wait: noWait, onFound: async ({ row, tabId }) => {
    calls.push(['found', row.no, tabId, reloads]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    calls.push(['after', reloads]);
    return { ok: true, reserved: true, seat: '일반실', price: '59,800원', note: '좌석을 잡았습니다.' };
  } });
  const [a, b] = await Promise.all([mine, other]);
  assert.deepEqual([a.found, a.reserve.reserved, a.row.gen, a.row.no], [true, true, open, '024']);
  assert.equal(calls[0][3], calls[1][1], '예약하는 동안 새로고침하지 않는다');
  assert.deepEqual([b.found, b.stopped, b.note], [false, true, '다른 열차를 예약해 빈자리 대기를 멈췄습니다.']);
  assert.ok(empty);
  await ktxWatchStop();
});

test('빈자리 대기 — 예약을 못 하면 그 답을 싣고 다른 대기는 계속 돈다', async () => {
  const raw = [
    { text: 'KTX 024 부산 → 서울(09:26 ~ 11:53) 소요시간: 2시간 27분', origin: '부산', dest: '서울', gen: { cls: 'price_box gen', text: '59,800원' }, spec: null },
    { text: 'KTX 026 부산 → 서울(09:40 ~ 12:10) 소요시간: 2시간 30분', origin: '부산', dest: '서울', gen: { cls: 'price_box sold_out', text: '매진' }, spec: null },
  ];
  const api = {
    tabs: { get: async () => ({ id: 7, url: KORAIL_LIST, status: 'complete', active: false }), reload: async () => {} },
    scripting: { executeScript: async () => [{ result: { url: KORAIL_LIST, state: 'rows', guard: null, rows: raw, cond: COND } }] },
  };
  const ctrl = new AbortController();
  let ticks = 0;
  const other = ktxWatch({ ...INPUT, train: '026' }, { api, tabId: 7, wait: noWait, signal: ctrl.signal, onTick: () => { if (++ticks >= 2) ctrl.abort(); } });
  const mine = await ktxWatch({ ...INPUT, train: '024' }, { api, tabId: 7, wait: noWait, onFound: async () => ({ ok: false, error: '그 사이 자리가 없어졌습니다.', code: 'RESERVE_NOT_PICKED' }) });
  assert.deepEqual([mine.found, mine.reserve.code], [true, 'RESERVE_NOT_PICKED']);
  const rest = await other;
  assert.equal(rest.stopped, true);
  assert.ok(ticks >= 2, '예약을 못 한 뒤에도 다른 열차는 다시 읽는다');
});

test('빈자리 대기 — 수동 예매 관찰 중 조회를 멈추고 수동 확인 상태로 끝나도 다른 열차를 자동 예약하지 않는다', async () => {
  const raw = ['024', '026'].map((no) => ({
    text: `KTX ${no} 부산 → 서울(09:26 ~ 11:53) 소요시간: 2시간 27분`, origin: '부산', dest: '서울',
    gen: { cls: 'price_box gen', text: '59,800원' }, spec: null,
  }));
  let reads = 0, reloads = 0, otherBookings = 0;
  const api = {
    tabs: { get: async () => ({ id: 7, url: KORAIL_LIST, status: 'complete', active: false }), reload: async () => { reloads++; } },
    scripting: { executeScript: async () => { reads++; return [{ result: { url: KORAIL_LIST, state: 'rows', guard: null, rows: raw, cond: COND } }]; } },
  };
  let started, finish;
  const observing = new Promise((resolve) => { started = resolve; });
  const manualResult = new Promise((resolve) => { finish = resolve; });
  const mine = ktxWatch({ ...INPUT, train: '024' }, { api, tabId: 7, wait: noWait, onFound: async () => { started(); return manualResult; } });
  const other = ktxWatch({ ...INPUT, train: '026' }, { api, tabId: 7, wait: noWait, onFound: async () => { otherBookings++; return { ok: true, reserved: true }; } });
  await observing;
  const before = [reads, reloads];
  await new Promise((resolve) => setImmediate(resolve));
  const whileWaiting = [reads, reloads, otherBookings];
  finish({ ok: false, manual: true, code: 'RESERVE_MANUAL_REQUIRED', error: '직접 예매한 결과를 확인해 주세요.' });
  const [a, b] = await Promise.all([mine, other]);
  await ktxWatchStop();
  assert.deepEqual(whileWaiting, [...before, 0], '사용자 클릭을 기다리는 동안 조회·새로고침·다른 예약이 모두 멈춘다');
  assert.deepEqual([a.found, a.reserve.manual, a.reserve.code], [true, true, 'RESERVE_MANUAL_REQUIRED']);
  assert.deepEqual([b.found, b.stopped, otherBookings], [false, true, 0], '수동 인계 후에는 다른 열차로 대신 예약하지 않는다');
});

test('빈자리 대기 — 다른 대기의 중단을 먼저 알리고 예약 완료·수동 확인 결과를 마지막에 알린다', async () => {
  for (const reserve of [
    { ok: true, reserved: true, note: '좌석을 잡았습니다.' },
    { ok: false, manual: true, code: 'RESERVE_MANUAL_REQUIRED', error: '직접 예매한 결과를 확인해 주세요.' },
    { ok: true, reserved: true, manual: true, note: '코레일 예약 화면에서 예약을 확인했습니다.' },
  ]) {
    const raw = ['024', '026', '028'].map((no) => ({
      text: `KTX ${no} 부산 → 서울(09:26 ~ 11:53) 소요시간: 2시간 27분`, origin: '부산', dest: '서울',
      gen: { cls: 'price_box gen', text: '59,800원' }, spec: null,
    }));
    const api = {
      tabs: { get: async () => ({ id: 7, url: KORAIL_LIST, status: 'complete', active: false }), reload: async () => {} },
      scripting: { executeScript: async () => [{ result: { url: KORAIL_LIST, state: 'rows', guard: null, rows: raw, cond: COND } }] },
    };
    const rendered = [];
    const mine = ktxWatch({ ...INPUT, train: '024' }, { api, tabId: 7, wait: noWait, onFound: async () => reserve })
      .then((result) => { rendered.push({ kind: 'target', text: result.reserve?.note || result.reserve?.error }); return result; });
    const others = ['026', '028'].map((train) => ktxWatch({ ...INPUT, train }, { api, tabId: 7, wait: noWait })
      .then((result) => { rendered.push({ kind: result.stopped ? 'stopped' : 'other', text: result.note }); return result; }));
    const [result, ...stopped] = await Promise.all([mine, ...others]);
    await ktxWatchStop();
    assert.equal(result.reserve, reserve);
    assert.ok(stopped.every((r) => r.stopped && !r.found));
    assert.deepEqual(rendered.map((r) => r.kind), ['stopped', 'stopped', 'target']);
    assert.equal(rendered.at(-1).text, reserve.note || reserve.error, '공유 상태 문구가 다른 열차의 대기 중단 안내로 덮이지 않는다');
  }
});

test('행위 명세 ktx.reserve — 확인이 있는 쓰기이고 말로 채우지 않으며, 확인 없이는 돌지 않는다', async () => {
  const spec = ACTIONS.actions['ktx.reserve'];
  assert.deepEqual([spec.confirm, spec.effect, spec.llm ?? false], [true, 'write', false]);
  assert.deepEqual(Object.keys(spec.fields), ['from', 'to', 'date', 'hour', 'adults', 'train', 'dep', 'seat']);
  assert.ok(ACTIONS.domains.ktx.kinds.includes('reserve'));
  const d = createDispatcher({ log: () => {} });
  const runs = [];
  registerKtx(d, { ktxReserve: async (input, options) => { runs.push([input, options.tabId]); return { ok: true, reserved: true }; } });
  const { record } = d.build('ktx.reserve', { input: TARGET, by: 'ui' });
  await assert.rejects(d.run(record, { tabId: 7 }), /확인 없이/);
  await d.run(record, { confirmed: record.hash, tabId: 7 });
  assert.deepEqual(runs, [[TARGET, 7]]);
  assert.doesNotMatch(JSON.stringify(record), /tabId/, '탭 손잡이는 기록에 넣지 않는다');
});

console.log('예약 중의 차단 안내는 확인으로 닫고 이어 간다(2026-11-11 사용자 지정: "이거 그냥 확인 누르면 되는데.. 예약할때 이 메시지가 나옴")');

const G = { code: '-8002', message: '안내 메시지 매크로 CODE : -8002' };

test('탭 안 — 안내를 닫은 뒤에도 같은 열차·객실이 선택돼 있어야 예매만 누른다', async () => {
  let p = listPage(row('024', '09:26', '<div class="price_box gen active"><a href="#none">일반실 59,800원</a></div>') + GUARD_BOX);
  closable(p.dom);
  let r = await inPage(p.dom, korailReservePage, ['settle']);
  assert.deepEqual([r.done, r.list, r.guard, r.passed.map((g) => g.code), p.clicks], [false, true, null, ['-8002'], ['확인']]);
  r = await inPage(p.dom, korailReservePage, ['rebook', PAGE_TARGET]);
  assert.deepEqual([r.booked, p.clicks], [true, ['확인', '예매']]);
  p = listPage(row('024', '09:26', '<div class="price_box gen active"><a href="#none">일반실 59,800원</a></div>'));
  p.dom.window.document.querySelector('.reservbtn').disabled = true;
  r = await inPage(p.dom, korailReservePage, ['rebook', PAGE_TARGET]);
  assert.deepEqual([r.booked, r.why, p.clicks], [undefined, 'book-disabled', []], '예매가 눌리지 않는 상태면 누르지 않는다');
  p = listPage(GUARD_BOX);
  r = await inPage(p.dom, korailReservePage, ['settle']);
  assert.deepEqual([r.why, r.guard.code], ['guard', '-8002'], '닫히지 않는 안내는 그대로 알린다');
});

const READY = { picked: true, ready: true, seat: '일반실', price: '59,800원', said: [] };
const CLOSED_GUARD = { done: false, list: true, passed: [G] };
const LIST_STILL = { done: false, list: true };

test('실행부 — 가격 선택이 별도 안내창을 기다리면 같은 결과 탭의 코레일 안내부터 닫고 예매한다', async () => {
  const f = reserveApi({ pick: READY, settles: [LIST_STILL], popups: [
    { id: 9, openerTabId: 7, url: 'https://www.korail.com/popup/notice' },
    { id: 10, openerTabId: 7, url: 'https://evilkorail.com/popup/notice' },
    { id: 11, openerTabId: 7, url: 'https://www.korail.com.evil.test/popup/notice' },
    { id: 12, openerTabId: 8, url: 'https://www.korail.com/popup/notice' },
    { id: 13, openerTabId: 7, url: 'http://www.korail.com/popup/notice' },
  ] });
  let release;
  const selected = new Promise((resolve) => { release = resolve; });
  const execute = f.api.scripting.executeScript;
  f.api.scripting.executeScript = async (request) => {
    if (request.func === korailReservePage && request.args[0] === 'pick') {
      f.calls.push(['picking']);
      await selected;
    }
    const result = await execute(request);
    if (request.func === korailPopupPage && result[0]?.result.clicked) release();
    return result;
  };
  const result = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, tries: 1 });
  assert.equal(result.code, 'RESERVE_UNCONFIRMED');
  assert.match(result.error, /이용안내/, '가격 선택 중 닫은 별도 안내도 마지막 결과에 남긴다');
  assert.deepEqual(f.calls.filter((call) => call[0] === 'popup').map((call) => call[1]), [9]);
  assert.ok(f.steps().indexOf('picking') < f.steps().indexOf('popup'));
  assert.ok(f.steps().indexOf('popup') < f.steps().indexOf('arm'), '별도 안내 확인 후 예매를 누른다');
});

test('실행부 — 별도 안내를 읽은 뒤 1초 기다리고 같은 문구와 주소를 넘겨 확인한다', async () => {
  const popup = { id: 9, openerTabId: 7, url: 'https://www.korail.com/popup/notice' };
  const f = reserveApi({ pick: READY, popups: [popup] });
  const events = [];
  const execute = f.api.scripting.executeScript;
  f.api.scripting.executeScript = async (request) => {
    if (request.func === korailPopupPage) events.push([
      request.args[0]?.observeOnly ? 'observe' : 'confirm', request.target.tabId, request.args[0],
    ]);
    return execute(request);
  };
  const result = await ktxReserve(TARGET, {
    api: f.api, tabId: 7, wait: async (ms) => { events.push(['wait', ms]); },
  });
  assert.equal(result.reserved, true);
  const observed = events.findIndex(([step]) => step === 'observe');
  const confirmed = events.findIndex(([step]) => step === 'confirm');
  assert.ok(observed >= 0 && confirmed > observed);
  assert.deepEqual(events.slice(observed, confirmed + 1), [
    ['observe', 9, { observeOnly: true }],
    ['wait', 1000],
    ['confirm', 9, { expectedWords: '이용안내', expectedUrl: popup.url }],
  ]);
  assert.equal(f.steps().filter((step) => step === 'popup').length, 1);
});

test('실행부 — 별도 안내의 확인 전 1초 대기 중 취소하면 확인과 예매를 누르지 않는다', async () => {
  const ctrl = new AbortController();
  const f = reserveApi({ pick: READY, popups: [{ id: 9, openerTabId: 7, url: 'https://www.korail.com/popup/notice' }] });
  let observed = false, abortedDuringDelay = false;
  const execute = f.api.scripting.executeScript;
  f.api.scripting.executeScript = async (request) => {
    if (request.func === korailPopupPage && request.args[0]?.observeOnly) observed = true;
    return execute(request);
  };
  const result = await ktxReserve(TARGET, {
    api: f.api, tabId: 7, signal: ctrl.signal, wait: async (ms) => {
      if (observed && ms === 1000) { abortedDuringDelay = true; ctrl.abort(); }
    },
  });
  assert.equal(abortedDuringDelay, true);
  assert.equal(result.code, 'RESERVE_CANCELLED');
  assert.deepEqual(f.steps().filter((step) => ['popup', 'arm', 'press', 'settle'].includes(step)), []);
});

test('실행부 — 확인해도 남은 별도 안내는 재클릭하지 않고 예매 전에 닫힘을 기다린다', async () => {
  const popup = { id: 9, openerTabId: 7, url: 'https://www.korail.com/popup/notice' };
  const f = reserveApi({ pick: READY, popups: [popup] });
  f.api.tabs.query = async () => [popup]; // 클릭해도 같은 문구의 창이 남는다.
  const result = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, readyTries: 3 });
  assert.equal(result.code, 'RESERVE_NOT_READY');
  assert.match(result.error, /안내창이 남아/);
  assert.equal(f.steps().filter((step) => step === 'popup').length, 1);
  assert.equal(f.steps().includes('arm'), false);
});

test('실행부 — 같은 별도 창의 안내 문구가 바뀌면 새 안내만 한 번 더 확인한다', async () => {
  const popup = { id: 9, openerTabId: 7, url: 'https://www.korail.com/popup/notice' };
  const f = reserveApi({ pick: READY });
  let words = '이용안내 A';
  const clicked = [];
  f.api.tabs.query = async () => words ? [popup] : [];
  const execute = f.api.scripting.executeScript;
  f.api.scripting.executeScript = async (request) => {
    if (request.func !== korailPopupPage) return execute(request);
    const current = words;
    if (request.args[0]?.observeOnly) return [{ result: { words: current, clicked: false, actionable: true } }];
    clicked.push(current);
    words = current === '이용안내 A' ? '이용안내 B' : '';
    return [{ result: { words: current, clicked: true, actionable: true } }];
  };
  const result = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait });
  assert.equal(result.reserved, true);
  assert.deepEqual(clicked, ['이용안내 A', '이용안내 B']);
  assert.equal(f.steps().filter((step) => step === 'arm').length, 1);
});

test('실행부 — 이미 확인한 별도 안내의 버튼이 비활성화됐다 돌아와도 같은 안내를 다시 누르지 않는다', async () => {
  const popup = { id: 9, openerTabId: 7, url: 'https://www.korail.com/popup/notice' };
  const f = reserveApi({ pick: READY, popups: [popup] });
  f.api.tabs.query = async () => [popup];
  let reads = 0;
  const execute = f.api.scripting.executeScript;
  f.api.scripting.executeScript = async (request) => {
    if (request.func === korailPopupPage && request.args[0]?.observeOnly) {
      return [{ result: { words: '이용안내', clicked: false, actionable: ++reads !== 2 } }];
    }
    return execute(request);
  };
  const result = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, readyTries: 4 });
  assert.equal(result.code, 'RESERVE_NOT_READY');
  assert.equal(f.steps().filter((step) => step === 'popup').length, 1);
  assert.equal(f.steps().includes('arm'), false);
});

test('실행부 — 별도 안내를 읽는 동안 취소되면 확인과 예매를 새로 누르지 않는다', async () => {
  const ctrl = new AbortController();
  const f = reserveApi({ pick: READY, popups: [{ id: 9, openerTabId: 7, url: 'https://www.korail.com/popup/notice' }] });
  let release;
  const selected = new Promise((resolve) => { release = resolve; });
  const execute = f.api.scripting.executeScript;
  f.api.scripting.executeScript = async (request) => {
    if (request.func === korailReservePage && request.args[0] === 'pick') await selected;
    if (request.func === korailPopupPage && request.args[0]?.observeOnly) { ctrl.abort(); release(); }
    return execute(request);
  };
  const result = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, signal: ctrl.signal });
  assert.equal(result.code, 'RESERVE_CANCELLED');
  assert.deepEqual(f.steps().filter((step) => ['popup', 'arm', 'settle'].includes(step)), []);
});

test('실행부 — 별도 안내 조회가 진행 중일 때 가격 선택이 거절돼도 미처리 rejection 없이 실패를 반환한다', async () => {
  const f = reserveApi({ pick: READY });
  let rejectPick;
  const selected = new Promise((_, reject) => { rejectPick = reject; });
  const execute = f.api.scripting.executeScript;
  f.api.scripting.executeScript = async (request) => {
    if (request.func === korailReservePage && request.args[0] === 'pick') return selected;
    return execute(request);
  };
  f.api.tabs.query = async () => {
    rejectPick(new Error('선택 중 화면이 닫혔습니다'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    return [];
  };
  const result = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait });
  assert.equal(result.code, 'RESERVE_FAILED');
  assert.match(result.error, /선택 중 화면이 닫혔습니다/);
  assert.equal(f.steps().includes('arm'), false);
});

test('실행부 — 첫 예매의 -8002 뒤에는 직접 예매를 안내하고 같은 요청의 수동 완료를 관찰한다', async () => {
  const f = reserveApi({ pick: READY, settles: [CLOSED_GUARD], statuses: [LIST_STILL, { done: true, deadline: '09:36' }] });
  const stages = [];
  const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, manualTries: 3, onStage: (s) => stages.push(s) });
  assert.deepEqual([r.ok, r.reserved, r.manual, r.deadline], [true, true, true, '09:36']);
  assert.deepEqual(f.steps().filter((k) => ['pick', 'arm', 'settle', 'status'].includes(k)), ['pick', 'arm', 'settle', 'status', 'status']);
  const target = { ...PAGE_TARGET, date: INPUT.date, adults: INPUT.adults };
  assert.deepEqual(f.calls.filter((c) => c[0] === 'arm').map((c) => c[2]), [target], '자동 예매는 처음 한 번뿐이다');
  assert.deepEqual(f.calls.filter((c) => c[0] === 'status').map((c) => c[2]), [target, target], '관찰에도 같은 열차·구간·객실·날짜·인원을 넘긴다');
  assert.match(stages.join('|'), /직접.*예매|예매.*직접/);
  assert.equal(f.steps().includes('reload'), false, '수동 예매 중 조회 화면을 새로고침하지 않는다');
  const beforeStatus = f.calls.slice(0, f.steps().indexOf('status'));
  assert.ok(beforeStatus.some((c) => c[0] === 'update' && c[1] === 7 && c[2].active), '수동 클릭을 기다리기 전에 결과 탭을 앞으로 가져온다');
  assert.ok(beforeStatus.some((c) => c[0] === 'window' && c[1] === 3 && c[2].focused));
});

test('실행부 — 이용 제한 안내를 닫은 뒤 결제 직전 화면이면 예약 완료로 처리하고 다시 예매를 권하지 않는다', async () => {
  const f = reserveApi({ settles: [{ done: true, deadline: '09:36', passed: [G] }] });
  const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait });
  assert.deepEqual([r.ok, r.reserved, r.deadline], [true, true, '09:36']);
  assert.equal(r.error, undefined);
  assert.deepEqual(f.steps().filter((k) => ['pick', 'arm', 'settle'].includes(k)), ['pick', 'settle']);
  assert.equal(f.steps().includes('status'), false, '이미 완료면 직접 예매를 기다릴 필요가 없다');
  assert.deepEqual(f.calls.filter((c) => c[0] === 'update' || c[0] === 'window'), [['update', 7, { active: true }], ['window', 3, { focused: true }]]);
});

test('실행부 — 이용 제한 안내를 닫은 뒤 로그인 화면이면 현재 로그인 상태를 안내한다', async () => {
  const f = reserveApi({ settles: [{ login: true, passed: [G] }] });
  const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait });
  assert.deepEqual([r.ok, r.code], [false, 'RESERVE_LOGIN']);
  assert.match(r.error, /코레일 로그인 화면/);
  assert.deepEqual(f.steps().filter((k) => ['pick', 'arm', 'settle'].includes(k)), ['pick', 'settle']);
  assert.equal(f.steps().includes('status'), false);
});

test('실행부 — 직접 예매를 기다리는 동안 완료·로그인 화면으로 넘어가면 현재 상태를 돌려준다', async () => {
  for (const next of [{ done: true }, { login: true }]) {
    const f = reserveApi({ pick: READY, settles: [CLOSED_GUARD], statuses: [next] });
    const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, manualTries: 2 });
    assert.equal(next.done ? r.reserved : r.code, next.done ? true : 'RESERVE_LOGIN');
    assert.equal(r.manual, true);
    assert.deepEqual(f.steps().filter((s) => ['pick', 'arm', 'settle', 'status'].includes(s)), ['pick', 'arm', 'settle', 'status']);
  }
});

test('실행부 — 수동 관찰 중 안내가 다시 떠도 확인·예매·별도 팝업을 자동으로 누르지 않는다', async () => {
  const f = reserveApi({ pick: READY, settles: [CLOSED_GUARD],
    statuses: [{ ...LIST_STILL, guard: G }, { ...LIST_STILL, said: ['계속 진행하시겠습니까?'] }, { done: true }],
    popups: [{ id: 9, openerTabId: 7, url: 'https://www.korail.com/popup/notice' }] });
  const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, manualTries: 3 });
  assert.equal(r.reserved, true);
  const manualSteps = f.steps().slice(f.steps().indexOf('status'));
  assert.equal(f.steps().filter((s) => s === 'status').length, 3);
  assert.deepEqual(manualSteps.filter((s) => ['pick', 'arm', 'settle', 'popup', 'reload'].includes(s)), [], '사용자에게 넘긴 뒤에는 읽기 전용 status만 호출한다');
  assert.equal(f.steps().filter((s) => s === 'popup').length, 1, '별도 창 확인도 수동 전환 전에만 한다');
});

test('실행부 — 다른 제한 코드는 수동 관찰이나 재예매로 넘기지 않고 이용 제한을 알린다', async () => {
  for (const code of ['-8003', '-8202']) {
    const f = reserveApi({ pick: READY, settles: [{ ...CLOSED_GUARD, passed: [{ code, message: '이용 제한' }] }] });
    const result = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait });
    assert.equal(result.code, 'RESERVE_REFUSED');
    assert.match(result.error, new RegExp(code));
    assert.equal(f.steps().filter((s) => s === 'arm').length, 1, '관측하지 않은 제한은 다시 예매하지 않는다');
    assert.equal(f.steps().includes('status'), false);
  }
});

test('실행부 — 안내 없이 완료를 확인하지 못하면 수동 재예매를 권하지 않고 결과 미확인을 알린다', async () => {
  for (const seen of [LIST_STILL, { done: false, list: false }, null, new Error('Frame with ID 0 was removed')]) {
    const f = reserveApi({ pick: READY, settles: [seen] });
    const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, tries: 4 });
    assert.equal(r.code, 'RESERVE_UNCONFIRMED');
    assert.equal(f.steps().filter((s) => s === 'arm').length, 1);
    assert.equal(f.steps().includes('status'), false, '응답이 없다는 이유로 수동 재예매 대기에 진입하지 않는다');
  }
});

test('실행부 — 수동 예매 화면 전환 중 읽기 응답이 유실되어도 자동 예매 없이 완료를 기다린다', async () => {
  for (const reply of [null, new Error('Frame with ID 0 was removed'), { done: false, list: false }]) {
    const f = reserveApi({ pick: READY, settles: [CLOSED_GUARD], statuses: [reply, { done: true }] });
    const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, manualTries: 3 });
    assert.equal(r.reserved, true);
    assert.equal(r.manual, true);
    assert.equal(f.steps().filter((s) => s === 'arm').length, 1, '응답 유실이 추가 예매를 만들지 않는다');
    assert.equal(f.steps().filter((s) => s === 'pick').length, 1);
    assert.equal(f.steps().filter((s) => s === 'settle').length, 1);
  }
});

test('실행부 — 수동 예매 결과나 조회 조건이 요청과 다르면 예약 성공으로 표시하지 않는다', async () => {
  for (const why of ['reservation-mismatch', 'condition-mismatch']) {
    const f = reserveApi({ pick: READY, settles: [CLOSED_GUARD], statuses: [{ done: false, why }] });
    const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, manualTries: 2 });
    assert.deepEqual([r.ok, r.code, r.manual], [false, 'RESERVE_MISMATCH', true], why);
    assert.equal(f.steps().filter((s) => s === 'arm').length, 1);
    assert.equal(f.steps().filter((s) => s === 'pick').length, 1, '선택이 바뀌면 가격을 다시 누르지 않는다');
  }
});

test('실행부 — 수동 진행을 일정 시간 관찰한 뒤에는 실패 확정 대신 직접 확인할 상태를 돌려준다', async () => {
  for (const pending of [LIST_STILL, { ...LIST_STILL, guard: G }, null]) {
    const f = reserveApi({ pick: READY, settles: [CLOSED_GUARD], statuses: [pending] });
    const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, manualTries: 3 });
    assert.deepEqual([r.ok, r.code, r.manual], [false, 'RESERVE_MANUAL_REQUIRED', true]);
    assert.equal(f.steps().filter((s) => s === 'status').length, 3, '정해진 횟수까지만 수동 진행을 관찰한다');
    assert.equal(f.steps().filter((s) => s === 'arm').length, 1);
    assert.equal(f.steps().filter((s) => s === 'settle').length, 1);
    assert.equal(f.steps().includes('reload'), false);
  }
});

test('실행부 — 예매 전·예매 간격·수동 관찰 중 취소하면 뒤늦은 자동 클릭이나 관찰을 하지 않는다', async () => {
  const before = new AbortController();
  before.abort();
  const idle = reserveApi({ pick: READY });
  const stopped = await ktxReserve(TARGET, { api: idle.api, tabId: 7, signal: before.signal, wait: noWait });
  assert.equal(stopped.code, 'RESERVE_CANCELLED');
  assert.deepEqual(idle.steps().filter((s) => ['pick', 'arm', 'settle', 'status'].includes(s)), []);

  const between = new AbortController();
  const selected = reserveApi({ pick: READY });
  const cancelled = await ktxReserve(TARGET, { api: selected.api, tabId: 7, signal: between.signal, wait: async () => between.abort() });
  assert.equal(cancelled.code, 'RESERVE_CANCELLED');
  assert.deepEqual(selected.steps().filter((s) => ['pick', 'arm', 'settle', 'status'].includes(s)), ['pick']);

  const manual = new AbortController();
  const watching = reserveApi({ pick: READY, settles: [CLOSED_GUARD] });
  const end = await ktxReserve(TARGET, { api: watching.api, tabId: 7, signal: manual.signal, manualTries: 4,
    wait: async () => { if (watching.steps().includes('status')) manual.abort(); } });
  assert.deepEqual([end.code, end.manual], ['RESERVE_CANCELLED', true]);
  assert.deepEqual(watching.steps().filter((s) => ['pick', 'arm', 'settle', 'status'].includes(s)), ['pick', 'arm', 'settle', 'status']);
});

test('실행부 — 예매 전과 예매 뒤 확인을 같은 안내 한도에 합산하고 초과하면 수동 대기 전에 멈춘다', async () => {
  const after = reserveApi({ pick: { ...READY, passed: Array(RESERVE_GUARD_PASSES).fill(G) }, settles: [CLOSED_GUARD, LIST_STILL] });
  let r = await ktxReserve(TARGET, { api: after.api, tabId: 7, wait: noWait });
  assert.equal(r.code, 'GUARD_BLOCKED');
  assert.equal(after.steps().filter((s) => s === 'arm').length, 1);
  assert.equal(after.steps().includes('status'), false);
  const during = reserveApi({ pick: { ...READY, passed: Array(RESERVE_GUARD_PASSES).fill(G) }, rebook: { booked: true, passed: [G] } });
  r = await ktxReserve(TARGET, { api: during.api, tabId: 7, wait: noWait });
  assert.equal(r.code, 'GUARD_BLOCKED');
  assert.equal(during.steps().filter((s) => s === 'arm').length, 1);
  assert.equal(during.steps().includes('status'), false);
});

test('실행부 — 읽을 때·고를 때의 차단 안내도 닫고 이어 가며, 세 번을 넘게 뜨거나 닫히지 않으면 코드와 글을 알리고 멈춘다', async () => {
  const early = reserveApi({ reads: [{ guard: G }, {}], pick: { picked: true, booked: true, seat: '일반실', price: '59,800원', said: [], passed: [G] } });
  assert.equal((await ktxReserve(TARGET, { api: early.api, tabId: 7, wait: noWait })).reserved, true);
  assert.deepEqual(early.steps().slice(0, 3), ['seats:read', 'seats:read', 'pick']);
  const twice = reserveApi({ reads: [{ guard: G }] });
  assert.equal((await ktxReserve(TARGET, { api: twice.api, tabId: 7, wait: noWait })).code, 'GUARD_BLOCKED');
  assert.equal(twice.steps().includes('pick'), false);
  const many = reserveApi({ pick: { picked: true, ready: true, seat: '일반실', price: '59,800원', said: [], passed: Array(RESERVE_GUARD_PASSES + 1).fill(G) } });
  const r = await ktxReserve(TARGET, { api: many.api, tabId: 7, wait: noWait });
  assert.deepEqual([r.ok, r.code], [false, 'GUARD_BLOCKED']);
  assert.match(r.error, /-8002/);
  assert.equal(many.steps().includes('settle'), false, '한도를 넘으면 더 나아가지 않는다');
  assert.equal(many.steps().includes('arm'), false, '가격 선택 단계에서 안내 한도를 넘었으면 예매를 누르기 전에 멈춘다');
});

test('탭 안 — 차단 안내가 가격 누름을 삼켜 예매 단추가 서지 않으면 안내를 닫고 가격을 다시 누른다(2026-11-11 "좌석은 골랐지만 코레일의 예매 단추를 찾지 못했습니다")', async () => {
  const p = listPage(row('024', '09:26', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>'), { book: false });
  const doc = p.dom.window.document;
  let presses = 0;
  doc.querySelector('.price_box.gen a').addEventListener('click', (e) => {
    if (++presses === 1) {   // 첫 누름은 안내가 삼킨다 — 줄이 골라지지 않는다
      e.preventDefault();
      doc.body.insertAdjacentHTML('beforeend', GUARD_BOX);
      closable(p.dom);
    } else doc.body.insertAdjacentHTML('beforeend', '<button class="reservbtn">예매</button>');
  });
  const r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26' }]);
  assert.deepEqual([r.booked, r.passed.map((g) => g.code), p.clicks], [true, ['-8002'], ['일반실 59,800원', '확인', '일반실 59,800원', '예매']]);
  // 선택은 됐는데 단추가 없으면 진단을 돌려준다. 선택된 가격을 다시 눌러 풀지 않는다.
  const q = listPage(row('024', '09:26', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>'), { book: false });
  const none = await inPage(q.dom, korailReservePage, ['pick', { no: '024', dep: '09:26' }]);
  assert.deepEqual([none.booked, none.why, q.clicks.length], [undefined, 'no-book-button', 1]);
  assert.match(none.hint, /예매 단추 0개.*다시 누름 0번/);
  const f = reserveApi({ pick: { picked: true, why: 'no-book-button', hint: none.hint, said: [] } });
  assert.match((await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait })).error, /예매 단추를 찾지 못했습니다\. \(예매 단추 0개/);
});

console.log('가격 누르기와 예매 누르기는 따로 호출한다(2026-11-11 사용자 지정: "연속 호출하지 말고 따로 따로 호출해봐,")');

test('탭 안 — hold 로 부르면 가격만 누르고 예매 단추가 선 것을 알릴 뿐 예매는 누르지 않는다', async () => {
  const p = listPage(row('024', '09:26', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>'));
  let r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26', hold: true }]);
  assert.deepEqual([r.picked, r.ready, r.booked, r.seat, r.price, p.clicks], [true, true, undefined, '일반실', '59,800원', ['일반실 59,800원']]);
  r = await inPage(p.dom, korailReservePage, ['rebook', PAGE_TARGET]);
  assert.deepEqual([r.booked, p.clicks], [true, ['일반실 59,800원', '예매']]);
});

test('실행부 — 가격 선택 뒤 간격을 두고 같은 준비 상태를 두 번 읽은 다음 예매를 누른다', async () => {
  const waits = [];
  const f = reserveApi({ pick: { picked: true, ready: true, seat: '일반실', price: '59,800원', said: [] } });
  const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: async (ms) => { waits.push([ms, f.steps().at(-1)]); } });
  assert.deepEqual([r.reserved, r.seat, r.price], [true, '일반실', '59,800원']);
  assert.deepEqual(f.steps().filter((k) => ['pick', 'ready', 'arm', 'settle'].includes(k)), ['pick', 'ready', 'ready', 'arm', 'settle']);
  assert.deepEqual(waits.find(([ms]) => ms === RESERVE_PACE_MS), [RESERVE_PACE_MS, 'pick'], '가격을 누른 뒤 사이를 두고 예매를 누른다');
  assert.ok(waits.some(([ms, step]) => ms === 500 && step === 'ready'), '준비 확인 두 번 사이에도 화면이 바뀔 시간을 둔다');
  assert.deepEqual(f.calls.filter((c) => c[0] === 'ready').map((c) => c[2]), Array(2).fill({ ...PAGE_TARGET, date: INPUT.date, adults: INPUT.adults }));
  assert.deepEqual(f.calls.find((c) => c[0] === 'arm')[2], { ...PAGE_TARGET, date: INPUT.date, adults: INPUT.adults }, '예매 직전에 목표와 날짜·인원까지 다시 확인한다');
  // 예매가 눌리지 않는 상태면 누르지 않고 까닭을 알린다.
  const stuck = reserveApi({ pick: { picked: true, ready: true, seat: '일반실', price: '59,800원', said: [] }, rebook: { why: 'book-disabled' } });
  const failed = await ktxReserve(TARGET, { api: stuck.api, tabId: 7, wait: noWait });
  assert.deepEqual([failed.code, /예매 단추가 눌리지 않는 상태/.test(failed.error)], ['RESERVE_NOT_PICKED', true]);
});

test('실행부 — 초기 차단으로 멈추면 어느 단계의 안내였는지 경과를 까닭에 붙인다', async () => {
  const early = reserveApi({ reads: [{ guard: G }] });
  assert.match((await ktxReserve(TARGET, { api: early.api, tabId: 7, wait: noWait })).error, /\[경과: 결과 화면을 읽을 때 안내 — 닫음\]/);
});

test('실행부 — 로딩·안내가 끼거나 선택 상태가 바뀌면 안정 확인을 처음부터 세어 예매는 한 번만 누른다', async () => {
  const f = reserveApi({ pick: READY, ready: [
    { ready: false, why: 'page-busy' },
    { ready: true, key: 'first' },
    { ready: false, why: 'modal-open' },
    { ready: true, key: 'first' },
    { ready: true, key: 'second' },
    { ready: true, key: 'second' },
  ] });
  const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, readyTries: 6 });
  assert.equal(r.reserved, true);
  assert.deepEqual(f.steps().filter((s) => ['pick', 'ready', 'arm', 'settle'].includes(s)),
    ['pick', ...Array(6).fill('ready'), 'arm', 'settle']);
  assert.equal(f.steps().filter((s) => s === 'arm').length, 1);
});

test('실행부 — 준비 상태가 안정되지 않거나 시간 초과·불일치·차단이면 예매하지 않는다', async () => {
  for (const ready of [
    [{ ready: false, why: 'page-busy' }],
    [{ ready: false, why: 'modal-open' }],
    [{ ready: false, why: 'book-disabled' }],
    [{ ready: true, key: 'a' }, { ready: true, key: 'b' }, { ready: true, key: 'c' }],
  ]) {
    const f = reserveApi({ pick: READY, ready });
    const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, readyTries: 3 });
    assert.equal(r.code, 'RESERVE_NOT_READY', JSON.stringify(ready));
    assert.equal(f.steps().includes('arm'), false);
    assert.equal(f.steps().includes('settle'), false);
  }
  for (const answer of [
    { ready: false, why: 'condition-mismatch' },
    { ready: false, why: 'selection-mismatch' },
    { ready: false, why: 'guard', guard: G },
  ]) {
    const f = reserveApi({ pick: READY, ready: [answer] });
    const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait, readyTries: 3 });
    assert.equal(r.ok, false);
    assert.equal(f.steps().includes('arm'), false, JSON.stringify(answer));
  }
});

test('실행부 — 준비 상태 확인 사이에 취소하면 예매를 누르지 않는다', async () => {
  const ctrl = new AbortController();
  const f = reserveApi({ pick: READY });
  const r = await ktxReserve(TARGET, { api: f.api, tabId: 7, signal: ctrl.signal,
    wait: async () => { if (f.steps().includes('ready')) ctrl.abort(); } });
  assert.equal(r.code, 'RESERVE_CANCELLED');
  assert.equal(f.steps().filter((s) => s === 'ready').length, 1);
  assert.equal(f.steps().includes('arm'), false);
});

test('실행부 — 같은 탭의 예약은 겹쳐 실행하지 않고 종료 뒤에만 다시 시작할 수 있다', async () => {
  const f = reserveApi({ pick: READY });
  let release;
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const first = ktxReserve(TARGET, { api: f.api, tabId: 7, wait: async () => {
    if (release) return;
    await new Promise((resolve) => { release = resolve; started(); });
  } });
  await entered;
  const before = [...f.steps()];
  const duplicate = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait });
  assert.equal(duplicate.code, 'RESERVE_BUSY');
  assert.deepEqual(f.steps(), before, '다른 실행이 진행 중이면 읽기·좌석·예매 호출을 추가하지 않는다');
  release();
  assert.equal((await first).reserved, true);
  assert.equal((await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait })).reserved, true, '성공 뒤 잠금을 해제한다');

  const failed = reserveApi({ pick: READY, rebook: new Error('injection failed') });
  const a = await ktxReserve(TARGET, { api: failed.api, tabId: 7, wait: noWait });
  const b = await ktxReserve(TARGET, { api: failed.api, tabId: 7, wait: noWait });
  assert.equal(a.code, 'RESERVE_INPUT_FAILED');
  assert.equal(b.code, 'RESERVE_INPUT_FAILED', '예외로 끝나도 잠금을 해제한다');
});

test('탭 안 — 예매 단추의 클래스가 달라도 글이 꼭 "예매" 인 단추를 누른다', async () => {
  const p = listPage(row('024', '09:26', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>') + '<button>좌석선택</button><button class="btn_book">예매</button>', { book: false });
  const r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26' }]);
  assert.deepEqual([r.booked, p.clicks], [true, ['일반실 59,800원', '예매']]);
});

test('탭 안 — 이미 선택된 같은 객실은 가격을 다시 눌러 해제하지 않는다', async () => {
  const p = listPage(row('024', '09:26', '<div class="price_box gen active"><a href="#none" title="선택">일반실 59,800원</a></div>'));
  const chosen = await inPage(p.dom, korailReservePage, ['pick', { ...PAGE_TARGET, hold: true }]);
  assert.equal(chosen.ready, true);
  assert.deepEqual(p.clicks, [], '선택된 가격은 누르지 않는다');
  const pressed = await inPage(p.dom, korailReservePage, ['rebook', PAGE_TARGET]);
  assert.equal(pressed.booked, true);
  assert.deepEqual(p.clicks, ['예매']);
});

test('탭 안 — 안내 뒤 React가 행을 교체해도 현재 DOM에서 같은 객실을 다시 찾는다', async () => {
  const markup = row('024', '09:26', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>');
  const p = listPage(markup, { book: false });
  const doc = p.dom.window.document;
  doc.querySelector('.gen a').addEventListener('click', (e) => {
    e.preventDefault();
    doc.querySelector('li.tckList').outerHTML = markup;
    doc.body.insertAdjacentHTML('beforeend', GUARD_BOX);
    closable(p.dom);
    doc.querySelector('.gen a').addEventListener('click', () => doc.body.insertAdjacentHTML('beforeend', '<button class="reservbtn">예매</button>'));
  });
  const r = await inPage(p.dom, korailReservePage, ['pick', { ...PAGE_TARGET, hold: true }]);
  assert.equal(r.ready, true);
  assert.deepEqual(p.clicks, ['일반실 59,800원', '확인', '일반실 59,800원']);
  assert.equal(doc.querySelector('.gen').classList.contains('active'), true);
});

test('탭 안 — 다른 열차·객실 선택이 남아 있거나 가격 클릭이 선택되지 않으면 예매하지 않는다', async () => {
  const mine = row('024', '09:26', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>');
  let p = listPage(row('020', '08:40', '<div class="price_box gen active"><a href="#none">일반실 59,800원</a></div>') + mine);
  let r = await inPage(p.dom, korailReservePage, ['pick', { ...PAGE_TARGET, hold: true }]);
  assert.deepEqual([r.why, p.clicks], ['selection-mismatch', []]);
  p = listPage(mine, { select: false });
  r = await inPage(p.dom, korailReservePage, ['pick', { ...PAGE_TARGET, hold: true }]);
  assert.equal(r.why, 'selection-mismatch');
  assert.equal(r.ready, undefined, '기존 예매 단추만으로 준비됐다고 하지 않는다');
  assert.deepEqual(p.clicks, Array(3).fill('일반실 59,800원'), '가격 재시도는 두 번까지이고 예매는 누르지 않는다');
});

test('탭 안 — 예매 직전에 목표 누락·객실 변경·날짜·인원 변경을 다시 가린다', async () => {
  const p = listPage(row('024', '09:26', '<div class="price_box gen active"><a href="#none">일반실 59,800원</a></div>')
    + '<input id="startDate" value="2026-11-13(금) 09:00"><input id="labelple" value="총 1명">');
  const doc = p.dom.window.document;
  let r = await inPage(p.dom, korailReservePage, ['rebook']);
  assert.equal(r.why, 'bad-target');
  r = await inPage(p.dom, korailReservePage, ['rebook', { ...PAGE_TARGET, date: '2026-11-14', adults: 1 }]);
  assert.equal(r.why, 'condition-mismatch');
  r = await inPage(p.dom, korailReservePage, ['rebook', { ...PAGE_TARGET, date: INPUT.date, adults: 2 }]);
  assert.equal(r.why, 'condition-mismatch');
  doc.querySelector('.gen').classList.remove('active');
  doc.querySelector('.price_box:not(.gen)').classList.add('active');
  r = await inPage(p.dom, korailReservePage, ['rebook', PAGE_TARGET]);
  assert.equal(r.why, 'selection-mismatch');
  doc.querySelector('.gen').classList.add('active');
  r = await inPage(p.dom, korailReservePage, ['rebook', PAGE_TARGET]);
  assert.equal(r.why, 'selection-mismatch', '목표 객실 외에 다른 선택이 함께 있어도 멈춘다');
  assert.deepEqual(p.clicks, []);
});

test('탭 안 — 같은 reservbtn 클래스의 예약대기 단추가 먼저 있어도 예매만 누른다', async () => {
  const p = listPage(row('024', '09:26', '<div class="price_box gen active"><a href="#none">일반실 59,800원</a></div>')
    + '<button class="reservbtn">예약대기</button><button class="reservbtn">예매</button>', { book: false });
  const r = await inPage(p.dom, korailReservePage, ['rebook', PAGE_TARGET]);
  assert.equal(r.booked, true);
  assert.deepEqual(p.clicks, ['예매']);
});

test('탭 안 — 예매 직전에 새 제한 안내가 생기면 닫거나 예매하지 않고 호출자에게 돌려준다', async () => {
  const p = listPage(row('024', '09:26', '<div class="price_box gen active"><a href="#none">일반실 59,800원</a></div>') + GUARD_BOX);
  closable(p.dom);
  const r = await inPage(p.dom, korailReservePage, ['rebook', PAGE_TARGET]);
  assert.deepEqual([r.why, r.guard?.code, r.booked, r.passed, p.clicks], ['guard', '-8002', undefined, [], []]);
  assert.ok(p.dom.window.document.querySelector('#guard'), '새 안내를 닫고 같은 호출에서 예약하지 않는다');
});

test('실행부 — 검증된 예매 버튼을 native 접근성 입력으로 한 번 누르고 표식을 정리한다', async () => {
  const f = reserveApi({ pick: READY });
  const result = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait });
  assert.equal(result.reserved, true);
  const presses = f.calls.filter(([step]) => step === 'press');
  assert.equal(presses.length, 1);
  assert.equal(presses[0][1], 'com.krs.meetingroom');
  assert.equal(presses[0][2].task, 'ktxReservePress');
  assert.deepEqual(Object.keys(presses[0][2].input).sort(), ['expiresAt', 'token']);
  assert.match(presses[0][2].input.token, /^[0-9a-f-]{36}$/);
  assert.ok(f.steps().indexOf('arm') < f.steps().indexOf('press'));
  assert.ok(f.steps().indexOf('press') < f.steps().indexOf('disarm'));
  assert.ok(f.steps().indexOf('disarm') < f.steps().indexOf('settle'));
  assert.deepEqual(f.calls.find(([step]) => step === 'settle')[2], { ...PAGE_TARGET, date: INPUT.date, adults: INPUT.adults });
});

test('실행부 — 자동 예매 뒤에도 다른 예약 상세를 성공으로 처리하지 않는다', async () => {
  const f = reserveApi({ pick: READY, settles: [{ done: false, why: 'reservation-mismatch' }] });
  const result = await ktxReserve(TARGET, { api: f.api, tabId: 7, wait: noWait });
  assert.equal(result.code, 'RESERVE_MISMATCH');
  assert.equal(result.reserved, undefined);
  assert.equal(f.calls.filter(([step]) => step === 'press').length, 1);
});
