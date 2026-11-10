// 빈자리가 나면 예약까지(2026-11-10 사용자 지정: "좌석이 생기면 결재는 아니고 좌석 예약까지 할 수 있도록 구현해 줄래?" · "이미 로그인이 되었다고 가정하고").
// 탭 안 — 그 열차 한 줄의 살 수 있는 가격을 누르고 예매를 누른다 · 예매 뒤 화면 다루기. 실행부 — 조건 확인·결제 직전 화면 확인·로그인·차단. 대기 — 자리가 나면 예약을 기다리고 다른 대기를 멈춘다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { KORAIL_LIST, ktxReserve, ktxWatch, ktxWatchStop } from '../src/ktx.js';
import { korailSeatsPage } from '../src/korailseats.js';
import { korailReservePage, korailPopupPage } from '../src/korailreserve.js';
import { createDispatcher } from '../actions/dispatch.js';
import { registerKtx } from '../actions/runners/ktx.js';
import { ACTIONS } from '../actions/spec.js';
const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

const INPUT = { from: '부산', to: '서울', date: '2026-11-13', hour: 9, adults: 1 };
const TARGET = { ...INPUT, train: '024', dep: '09:26', seat: 'any' };
const COND = { from: '부산', to: '서울', date: '2026-11-13(금) 09:00', people: '총 1명' };
const noWait = async () => {};

// 2026-05-14 binjari 실측 꼴 — 가격 <a> 로 줄을 고르고 하단 button.reservbtn 으로 예매.
const row = (no, dep, gen, spec = '<div class="price_box"><a href="#none">특실 83,700원</a></div>', [from, to] = ['부산', '서울']) =>
  `<li class="tckList"><div class="data_box"><h3><span>${from}</span><span>${to}</span></h3></div>KTX ${no} ${from} → ${to}(${dep} ~ 11:53) 소요시간: 2시간 27분${gen}${spec}</li>`;
function listPage(body, { url = KORAIL_LIST, book = true } = {}) {
  const dom = new JSDOM(`<body><ul>${body}</ul>${book ? '<button class="reservbtn">예매</button>' : ''}</body>`, { url, pretendToBeVisual: true });
  dom.window.Element.prototype.getClientRects = function () { return this.isConnected ? [{}] : []; };
  const clicks = [];
  dom.window.document.addEventListener('click', (e) => clicks.push(e.target.textContent.trim()), true);
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

test('탭 안 — 차단 안내가 떠 있거나 결과 화면이 아니면 아무것도 누르지 않는다', async () => {
  let p = listPage(row('024', '09:26', '<div class="price_box gen"><a href="#none">일반실 59,800원</a></div>')
    + '<div class="ReactModal__Content">안내 메시지 매크로 CODE : -8002 <button>확인</button></div>');
  let r = await inPage(p.dom, korailReservePage, ['pick', { no: '024', dep: '09:26' }]);
  assert.deepEqual([r.why, r.guard.code, p.clicks], ['guard', '-8002', []]);
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

/** 결과 탭 흉내 — read 는 결과 화면, pick 은 답을 돌려주고, settle 은 차례로. */
function reserveApi({ cond = COND, pick = { picked: true, booked: true, seat: '일반실', price: '59,800원', said: [] }, settles = [{ done: true, deadline: '09:36', said: [] }], url = KORAIL_LIST, popups = [] } = {}) {
  const calls = [];
  let settle = 0;
  const tab = { id: 7, windowId: 3, url, status: 'complete' };
  const api = {
    tabs: {
      get: async (id) => { if (id !== 7) throw new Error('No tab'); return tab; },
      query: async () => popups,
      update: async (id, o) => { calls.push(['update', id, o]); },
      reload: async (id) => { calls.push(['reload', id]); },
    },
    windows: { update: async (id, o) => { calls.push(['window', id, o]); } },
    scripting: { executeScript: async ({ target, func, args }) => {
      if (func === korailPopupPage) { calls.push(['popup', target.tabId]); return [{ result: { words: '이용안내', clicked: true } }]; }
      const step = func === korailSeatsPage ? `seats:${args[0]}` : args[0];
      calls.push([step, target.tabId, args[1]]);
      if (step === 'seats:read') return [{ result: { url: tab.url, state: 'rows', guard: null, rows: [], cond } }];
      if (step === 'pick') return [{ result: { url: tab.url, guard: null, ...pick } }];
      const answer = settles[Math.min(settle++, settles.length - 1)];
      if (answer instanceof Error) throw answer;
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
  assert.deepEqual(f.calls.find((c) => c[0] === 'pick')[2], { no: '024', dep: '09:26', from: '부산', to: '서울', seat: 'any' });
  assert.deepEqual(f.calls.filter((c) => c[0] === 'update' || c[0] === 'window'), [['update', 7, { active: true }], ['window', 3, { focused: true }]]);
  assert.deepEqual(f.calls.filter((c) => c[0] === 'popup').map((c) => c[1]), [9, 9, 9], '그 탭이 연 코레일 창만 다룬다');
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
