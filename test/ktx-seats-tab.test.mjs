// 옆 탭에서 좌석 읽기(2026-11-10 사용자 지정: "사이드 패널 옆에 열린 탭중에 하나로 하면 안될까?") — 탭 고르기·조회 흐름·줄 꼴·줄 누르기.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { KORAIL_SEARCH, KORAIL_LIST, WATCH_LIMIT_MS, ktxSeats, ktxSeatsTab, ktxOpen, ktxWatch, ktxWatchStop, openSeat } from '../src/ktx.js';
import { korailFillPage } from '../src/korailfill.js';
import { korailSeatsPage, shapeSeatRows } from '../src/korailseats.js';
const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

const INPUT = { from: '부산', to: '서울', date: '2026-11-13', hour: 9, adults: 1 };
const noWait = async () => {};
// 2026-11-10 실제 결과 화면에서 읽은 줄 꼴.
const RAW = [
  { text: 'KTX-산천 022 부산 → 서울(09:05 ~ 11:49) 소요시간: 2시간 44분 입석 + 좌석 매진', origin: '부산', dest: '서울', gen: { cls: 'price_box fl-l  yms ', text: '입석 + 좌석' }, spec: { cls: 'price_box fl-l  sold_out ', text: '매진' } },
  { text: 'KTX 024 서대구정차 부산 → 서울(09:26 ~ 11:53) 소요시간: 2시간 27분 59,800원 매진임박 83,700원', origin: '부산', dest: '서울', gen: { cls: 'price_box gen sold_out_soon', text: '59,800원 매진임박' }, spec: { cls: 'price_box', text: '83,700원' } },
  { text: 'KTX 020 부산 → 서울(08:40 ~ 11:20) 소요시간: 2시간 40분 59,800원', origin: '부산', dest: '서울', gen: { cls: 'price_box gen', text: '59,800원' }, spec: null },
  { text: 'SRT 330 부산 → 수서(09:30 ~ 12:01) 소요시간: 2시간 31분 52,000원', origin: '부산', dest: '수서', gen: { cls: 'price_box gen', text: '52,000원' }, spec: null },
  { text: '무궁화 1210 부산 → 서울(09:40 ~ 15:10) 소요시간: 5시간 30분 28,600원', origin: '부산', dest: '서울', gen: { cls: 'price_box gen', text: '28,600원' }, spec: null },
];
const COND = { from: '부산', to: '서울', date: '2026-11-13(금) 09:00', people: '총 1명' };
const page = (extra = {}) => ({ url: KORAIL_LIST, state: 'rows', clicked: false, guard: null, rows: RAW, cond: COND, ...extra });
const GUARD = { code: '-8002', message: '안내 메시지 매크로 … CODE : -8002' };
const FILLED = { form: true, missing: [], shown: { date: COND.date, people: COND.people } };

/** 창의 탭 흉내 — 조회를 누르면 결과 목록으로 넘어가고, read 의 답은 차례로 꺼낸다. */
function tabsApi({ open = [], reads = [page()], filled = FILLED, submit = { clicked: true, guard: null }, requery = { clicked: false }, bridge } = {}) {
  const calls = [], tabs = new Map(open.map((tab) => [tab.id, { status: 'complete', ...tab }]));
  let next = 500, read = 0;
  const api = {
    tabs: {
      query: async (q) => { calls.push(['query', q]); return [...tabs.values()].filter((tab) => tab.url.startsWith('https://www.korail.com/ticket/search/')); },
      create: async (o) => { calls.push(['create', o]); const tab = { id: next++, url: o.url, status: 'complete' }; tabs.set(tab.id, tab); return tab; },
      get: async (id) => { if (!tabs.has(id)) throw new Error(`No tab with id: ${id}.`); return tabs.get(id); },
      update: async (id, o) => { calls.push(['update', id, o]); if (o.url) tabs.get(id).url = o.url; return tabs.get(id); },
      reload: async (id) => { calls.push(['reload', id]); },
    },
    windows: { update: async (id, o) => { calls.push(['window', id, o]); } },
    scripting: { executeScript: async ({ target, func, args }) => {
      const step = func === korailFillPage ? 'fill' : args[0];
      calls.push(['script', target.tabId, step]);
      if (step === 'fill') return [{ result: filled }];
      if (step === 'submit') { if (submit.clicked) tabs.get(target.tabId).url = KORAIL_LIST; return [{ result: submit }]; }
      if (step === 'requery') return [{ result: requery }];
      const answer = reads[Math.min(read++, reads.length - 1)];
      if (answer instanceof Error) throw answer;
      return [{ result: answer }];
    } },
    ...(bridge ? { runtime: { sendNativeMessage: async (host, message) => { calls.push(['bridge', message.task]); return bridge; } } } : {}),
  };
  return { api, calls, tabs, kinds: () => calls.map((c) => (c[0] === 'script' ? c[2] : c[0])) };
}

test('줄 꼴 — 요청한 구간의 KTX 이고 출발 시 이후인 것만, 값·매진·매진임박·코레일의 말을 가른다', () => {
  assert.deepEqual(shapeSeatRows(RAW, INPUT), [
    { train: 'KTX-산천', no: '022', dep: '09:05', arr: '11:49', took: '2시간 44분', gen: { price: '', soldOut: false, soon: false, note: '입석 + 좌석' }, spec: { price: '', soldOut: true, soon: false, note: '' } },
    { train: 'KTX', no: '024', dep: '09:26', arr: '11:53', took: '2시간 27분', gen: { price: '59,800원', soldOut: false, soon: true, note: '' }, spec: { price: '83,700원', soldOut: false, soon: false, note: '' } },
  ]);
  assert.deepEqual(shapeSeatRows(null, INPUT), []);
});

test('코레일 탭이 없으면 뒤쪽에 탭을 하나 열어 채우고 조회해 읽는다 — 보던 탭은 그대로', async () => {
  const f = tabsApi({ open: [{ id: 1, url: 'https://eclass.krs.co.kr/', active: true }] });
  const stages = [];
  const r = await ktxSeatsTab(INPUT, { api: f.api, wait: noWait, onStage: (s) => stages.push(s) });
  assert.deepEqual([r.ok, r.rows.length, r.tabId], [true, 2, 500]);
  assert.deepEqual(f.calls[1], ['create', { url: KORAIL_SEARCH, active: false }]);
  assert.deepEqual(f.kinds(), ['query', 'create', 'fill', 'submit', 'read']);
  assert.equal(f.tabs.get(1).url, 'https://eclass.krs.co.kr/');
  assert.equal(stages.length, 2);
  // 다음 조회는 그 탭(결과 목록)을 예매 화면으로 돌려 다시 쓴다 — 새 탭을 또 열지 않는다.
  f.calls.length = 0;
  assert.equal((await ktxSeatsTab(INPUT, { api: f.api, wait: noWait })).tabId, 500);
  assert.deepEqual(f.kinds(), ['update', 'fill', 'submit', 'read']);
  assert.deepEqual(f.calls[0], ['update', 500, { url: KORAIL_SEARCH }]);
});

test('창에 열린 코레일 승차권 조회 탭을 쓰고, 예매·결제 중일 수 있는 다른 코레일 탭은 건드리지 않는다', async () => {
  const f = tabsApi({ open: [{ id: 3, url: 'https://www.korail.com/ticket/search/reservation/pay' }, { id: 4, url: KORAIL_SEARCH }] });
  // 앞 시험이 쓴 탭(500)은 이 창에 없다 — 기억한 탭이 닫혔으면 창에서 다시 찾는다.
  const r = await ktxSeatsTab(INPUT, { api: f.api, wait: noWait });
  assert.deepEqual([r.ok, r.tabId], [true, 4]);
  assert.deepEqual(f.kinds(), ['query', 'fill', 'submit', 'read'], '이미 예매 화면이면 다시 불러오지 않는다');
  assert.equal(f.tabs.get(3).url, 'https://www.korail.com/ticket/search/reservation/pay');
});

test('차단 안내는 같은 조건으로 두 번까지 다시 조회하고(단추가 없으면 새로고침) 끝내 막히면 코드와 글을 알린다', async () => {
  const ok = tabsApi({ open: [{ id: 4, url: KORAIL_SEARCH }], reads: [page({ state: 'guard', guard: GUARD, rows: [] }), page({ state: 'guard', guard: GUARD, rows: [] }), page()] });
  assert.equal((await ktxSeatsTab(INPUT, { api: ok.api, wait: noWait })).ok, true);
  // 앞 시험에서 쓴 탭(4)을 기억하고 있어 창을 다시 뒤지지 않는다.
  assert.deepEqual(ok.kinds(), ['fill', 'submit', 'read', 'requery', 'reload', 'read', 'requery', 'reload', 'read']);
  const button = tabsApi({ open: [{ id: 4, url: KORAIL_SEARCH }], requery: { clicked: true }, reads: [page({ state: 'guard', guard: GUARD, rows: [] }), page()] });
  await ktxSeatsTab(INPUT, { api: button.api, wait: noWait });
  assert.equal(button.kinds().includes('reload'), false, '결과 화면의 조회 단추를 눌렀으면 새로고침하지 않는다');
  const stuck = tabsApi({ open: [{ id: 4, url: KORAIL_SEARCH }], reads: [page({ state: 'guard', guard: GUARD, rows: [] })] });
  const r = await ktxSeatsTab(INPUT, { api: stuck.api, wait: noWait });
  assert.deepEqual([r.ok, r.code], [false, 'GUARD_BLOCKED']);
  assert.match(r.error, /-8002.*매크로/);
  assert.equal(stuck.kinds().filter((k) => k === 'read').length, 3);
});

test('열차 없음은 빈 목록이고, 빈 화면은 한 번만 새로고침하며, 조건이 다르면 싣지 않는다', async () => {
  const tab = () => ({ open: [{ id: 4, url: KORAIL_SEARCH }] });
  const empty = await ktxSeatsTab(INPUT, { api: tabsApi({ ...tab(), reads: [page({ state: 'empty', rows: [] })] }).api, wait: noWait });
  assert.deepEqual([empty.ok, empty.rows], [true, []]);
  const blank = tabsApi({ ...tab(), reads: [page({ state: 'none', rows: [] })] });
  assert.equal((await ktxSeatsTab(INPUT, { api: blank.api, wait: noWait })).code, 'RESULT_UNAVAILABLE');
  assert.equal(blank.kinds().filter((k) => k === 'reload').length, 1);
  const other = await ktxSeatsTab(INPUT, { api: tabsApi({ ...tab(), reads: [page({ cond: { ...COND, date: '2026-11-14(토) 09:00' } })] }).api, wait: noWait });
  assert.equal(other.code, 'CONDITION_MISMATCH');
  const moving = tabsApi({ ...tab(), reads: [new Error('Frame with ID 0 was removed.'), page()] });
  assert.equal((await ktxSeatsTab(INPUT, { api: moving.api, wait: noWait })).ok, true, '문서가 바뀌는 중에 끊기면 한 번 더 읽는다');
});

test('못 채운 칸·조회 단추 없음·권한 없음은 조회하지 않고 까닭을 알린다', async () => {
  const tab = () => ({ open: [{ id: 4, url: KORAIL_SEARCH }] });
  const partial = tabsApi({ ...tab(), filled: { ...FILLED, missing: ['출발일'] } });
  const r = await ktxSeatsTab(INPUT, { api: partial.api, wait: noWait });
  assert.deepEqual([r.code, /출발일/.test(r.error)], ['FILL_PARTIAL', true]);
  assert.equal(partial.kinds().includes('submit'), false, '조건이 다 들어가지 않았으면 조회를 누르지 않는다');
  assert.equal((await ktxSeatsTab(INPUT, { api: tabsApi({ ...tab(), filled: { ...FILLED, guard: '-8002 비정상적인 접속' } }).api, wait: noWait })).code, 'GUARD_BLOCKED');
  assert.equal((await ktxSeatsTab(INPUT, { api: tabsApi({ ...tab(), submit: { clicked: false, guard: null } }).api, wait: noWait })).code, 'FORM_NOT_FOUND');
  assert.equal((await ktxSeatsTab(INPUT, { api: tabsApi({ ...tab(), reads: [new Error('Cannot access contents of the page')] }).api, wait: noWait })).code, 'NO_PERMISSION');
  assert.equal((await ktxSeatsTab(INPUT, { api: {} })).code, 'TAB_UNAVAILABLE');
});

test('ktxSeats 는 옆 탭에서 읽으면 브릿지를 부르지 않고, 못 읽으면 전용 창에서 읽으며, 둘 다 안 되면 옆 탭의 까닭을 알린다', async () => {
  const session = 'a'.repeat(32);
  const near = tabsApi({ open: [{ id: 4, url: KORAIL_SEARCH }], bridge: { ok: true, rows: [], session } });
  const r = await ktxSeats(INPUT, { api: near.api, wait: noWait });
  assert.deepEqual([r.ok, r.tabId, r.session], [true, 4, undefined]);
  assert.equal(near.kinds().includes('bridge'), false);
  const blocked = [page({ state: 'guard', guard: GUARD, rows: [] })];
  const far = tabsApi({ open: [{ id: 4, url: KORAIL_SEARCH }], reads: blocked, bridge: { ok: true, rows: [], session } });
  const stages = [];
  const viaBridge = await ktxSeats(INPUT, { api: far.api, wait: noWait, onStage: (s) => stages.push(s) });
  assert.deepEqual([viaBridge.ok, viaBridge.session, viaBridge.tabId], [true, session, undefined]);
  assert.match(stages.at(-1), /전용 창/);
  const both = tabsApi({ open: [{ id: 4, url: KORAIL_SEARCH }], reads: blocked, bridge: { ok: false, code: 'RUNTIME_MISSING', error: 'x' } });
  assert.equal((await ktxSeats(INPUT, { api: both.api, wait: noWait })).code, 'GUARD_BLOCKED');
});

test('줄을 누르면 좌석을 읽은 결과 탭으로 넘어가고, 그 탭이 닫혔거나 다른 화면이면 현재 탭에 조건을 채운다', async () => {
  const f = tabsApi({ open: [{ id: 1, url: 'https://eclass.krs.co.kr/', active: true }, { id: 4, url: KORAIL_LIST, windowId: 9 }] });
  const r = await ktxOpen(INPUT, { api: f.api, wait: noWait, tabId: 4 });
  assert.deepEqual([r.ok, r.shown, r.filled], [true, true, false]);
  assert.match(r.note, /코레일 탭으로 넘어갔습니다/);
  assert.deepEqual(f.calls, [['update', 4, { active: true }], ['window', 9, { focused: true }]]);
  for (const tabId of [77, 1]) {
    const gone = tabsApi({ open: [{ id: 1, url: KORAIL_SEARCH, active: true }] });
    const filled = await ktxOpen(INPUT, { api: gone.api, wait: noWait, tabId });
    assert.deepEqual([filled.ok, filled.filled], [true, true]);
    assert.deepEqual(gone.kinds(), ['query', 'fill']);
  }
});

/** 코레일 화면 흉내 — jsdom 은 배치를 하지 않으므로 붙어 있는 것을 보이는 것으로 친다. */
async function inPage(t, body, step, opts) {
  const dom = new JSDOM(`<body>${body}</body>`, { url: KORAIL_LIST, pretendToBeVisual: true });
  dom.window.Element.prototype.getClientRects = function () { return this.isConnected ? [{}] : []; };
  const saved = { document: globalThis.document, location: globalThis.location, getComputedStyle: globalThis.getComputedStyle };
  Object.assign(globalThis, { document: dom.window.document, location: dom.window.location, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) });
  t.after(() => Object.assign(globalThis, saved));
  return { doc: dom.window.document, run: () => korailSeatsPage(step, opts) };
}
const FORM = `<div class="selectAreaWrap"><input name="txtGoStart" value="부산"><input name="txtGoEnd" value="서울"></div><input id="startDate" value="2026-11-13(금) 09:00"><input id="labelple" value="총 1명">`;
const LIST = `<ul><li class="tckList"><div class="data_box"><h3><span>부산</span><span>서울</span></h3></div> KTX 024 (09:26 ~ 11:53) 소요시간: 2시간 27분
  <div class="price_box gen sold_out_soon">59,800원 매진임박</div><div class="price_box sold_out">매진</div></li></ul>`;

test('탭 안 — 조회는 예매 화면의 열차 조회만 누르고, 차단 안내가 떠 있으면 누르지 않는다', async (t) => {
  const f = await inPage(t, `${FORM}<button class="btn_lookup">열차 조회</button><div class="ReactModalPortal"><button id="n">창닫기</button></div>`, 'submit');
  let lookups = 0, closed = 0;
  f.doc.querySelector('.btn_lookup').addEventListener('click', () => { lookups++; });
  f.doc.querySelector('#n').addEventListener('click', () => { closed++; });
  const sent = await f.run();
  assert.deepEqual([sent.clicked, lookups, closed, sent.cond.from], [true, 1, 1, '부산']);
  const g = await inPage(t, `${FORM}<button class="btn_lookup">열차 조회</button><div role="dialog">CODE : -8002 <button>확인</button></div>`, 'submit');
  g.doc.querySelector('.btn_lookup').addEventListener('click', () => { lookups++; });
  g.doc.querySelector('[role=dialog] button').addEventListener('click', (e) => e.target.parentNode.remove());
  const held = await g.run();
  assert.deepEqual([held.clicked, held.guard.code, lookups], [false, '-8002', 1]);
});

test('탭 안 — 결과의 줄·칸·조건을 읽고, 차단 안내는 확인으로 닫아 코드와 글을 돌려준다', async (t) => {
  const f = await inPage(t, FORM + LIST, 'read', { waitMs: 300 });
  const read = await f.run();
  assert.deepEqual([read.state, read.rows.length, read.cond], ['rows', 1, { from: '부산', to: '서울', date: '2026-11-13(금) 09:00', people: '총 1명' }]);
  assert.deepEqual(shapeSeatRows(read.rows, INPUT), [{ train: 'KTX', no: '024', dep: '09:26', arr: '11:53', took: '2시간 27분',
    gen: { price: '59,800원', soldOut: false, soon: true, note: '' }, spec: { price: '', soldOut: true, soon: false, note: '' } }]);
  const g = await inPage(t, `${FORM}<div class="ReactModal__Content">매크로 등 미허가 도구 CODE : -8002 <button>확인</button></div>`, 'read', { waitMs: 300 });
  g.doc.querySelector('.ReactModal__Content button').addEventListener('click', (e) => e.target.parentNode.remove());
  const guarded = await g.run();
  assert.deepEqual([guarded.state, guarded.guard.code, guarded.rows], ['guard', '-8002', []]);
  assert.equal(g.doc.querySelector('.ReactModal__Content'), null, '안내를 닫는다');
  const none = await (await inPage(t, `${FORM}<div class="tck_confirm_no-data">해당 스케줄에 운행하는 열차가 없습니다</div>`, 'read', { waitMs: 300 })).run();
  assert.equal(none.state, 'empty');
  assert.doesNotMatch(korailSeatsPage.toString(), /예매|결제|btn_rsv|reserv/i, '좌석 선택·예매는 건드리지 않는다');
});

console.log('빈자리 대기(2026-11-10 사용자 지정: "한번에 3개 까지. 예약대기가 안되는 경우만 … 간격은 5초, 1시간 지나면 정지 … 알림만. 패널이 열린경우만")');

const SOLD = { cls: 'price_box fl-l  sold_out ', text: '매진' };
const raw = (no, dep, gen = SOLD, spec = SOLD) => ({ text: `KTX ${no} 부산 → 서울(${dep} ~ 12:00) 소요시간: 2시간 40분`, origin: '부산', dest: '서울', gen, spec });
const FREE = { cls: 'price_box gen', text: '59,800원' };
const soldPage = (extra = {}) => page({ rows: [raw('182', '09:59'), raw('032', '10:54')], ...extra });
const watching = (options) => tabsApi({ open: [{ id: 1, url: 'https://eclass.krs.co.kr/', active: true }, { id: 4, url: KORAIL_LIST }], ...options });
const W = { ...INPUT, train: '182' };

test('빈자리 대기 — 결과 탭을 다시 읽다가 살 수 있는 자리가 나오면 그 줄과 함께 끝난다(좌석은 고르지 않는다)', async () => {
  const f = watching({ reads: [soldPage(), soldPage(), page({ rows: [raw('182', '09:59', SOLD, FREE), raw('032', '10:54')] })] });
  const ticks = [];
  const r = await ktxWatch(W, { api: f.api, tabId: 4, wait: noWait, onTick: (t) => ticks.push(t.count) });
  assert.deepEqual([r.ok, r.found, r.row.no, r.row.spec.price, r.tabId, r.count], [true, true, '182', '59,800원', 4, 3]);
  assert.deepEqual(ticks, [1, 2]);
  assert.deepEqual(f.kinds(), ['reload', 'read', 'reload', 'read', 'reload', 'read'], '조건을 다시 채우거나 조회를 누르지 않고 새로고침으로만 읽는다');
  assert.deepEqual(f.calls.find((c) => c[2] === 'read').slice(0, 2), ['script', 4]);
  assert.equal(f.tabs.get(1).url, 'https://eclass.krs.co.kr/');
});

test('빈자리 대기 — 열차마다 1시간이 지나면 멈추고, 멈춤 신호로 그 열차만 끝난다', async () => {
  let clock = 0;
  const f = watching({ reads: [soldPage()] });
  const expired = await ktxWatch(W, { api: f.api, tabId: 4, wait: async () => { clock += 5000; }, now: () => clock });
  assert.deepEqual([expired.ok, expired.found, expired.expired], [true, false, true]);
  assert.match(expired.note, /1시간/);
  assert.ok(clock >= WATCH_LIMIT_MS && clock < WATCH_LIMIT_MS + 2 * 6500, '한 시간에서 멈춘다');
  const ctrl = new AbortController();
  let polls = 0;
  const g = watching({ reads: [soldPage()] });
  const both = [ktxWatch(W, { api: g.api, tabId: 4, signal: ctrl.signal, wait: noWait }),
    ktxWatch({ ...W, train: '032' }, { api: g.api, tabId: 4, wait: noWait, now: () => (++polls > 60 ? WATCH_LIMIT_MS * 3 : 0) })];
  ctrl.abort();
  const [stopped, other] = await Promise.all(both);
  assert.deepEqual([stopped.stopped, other.expired], [true, true], '하나를 멈춰도 나머지는 계속 돈다');
});

test('빈자리 대기 — 차단 안내는 확인 뒤 새로고침 한 번, 그래도 뜨면 대기를 모두 끝낸다', async () => {
  const guard = page({ state: 'guard', guard: GUARD, rows: [] });
  const once = watching({ reads: [guard, page({ rows: [raw('182', '09:59', FREE)] })] });
  assert.equal((await ktxWatch(W, { api: once.api, tabId: 4, wait: noWait })).found, true);
  assert.deepEqual(once.kinds(), ['reload', 'read', 'reload', 'read']);
  const twice = watching({ reads: [soldPage(), guard, guard] });
  const all = await Promise.all([ktxWatch(W, { api: twice.api, tabId: 4, wait: noWait }), ktxWatch({ ...W, train: '032' }, { api: twice.api, tabId: 4, wait: noWait })]);
  assert.deepEqual(all.map((r) => [r.ok, r.code]), [[false, 'GUARD_BLOCKED'], [false, 'GUARD_BLOCKED']]);
  assert.match(all[0].error, /-8002/);
  assert.equal(twice.kinds().filter((k) => k === 'reload').length, 3, '막힌 뒤에는 더 읽지 않는다');
});

test('빈자리 대기 — 한 번에 3편까지·같은 조건만, 탭이 다른 화면으로 가면 멈추고 보고 있는 동안은 새로고침하지 않는다', async () => {
  const f = watching({ reads: [soldPage()] });
  const ctrl = new AbortController();
  const runs = ['182', '032', '034'].map((train) => ktxWatch({ ...W, train }, { api: f.api, tabId: 4, signal: ctrl.signal, wait: () => new Promise((r) => setImmediate(r)) }));
  assert.equal((await ktxWatch({ ...W, train: '036' }, { api: f.api, tabId: 4 })).code, 'WATCH_FULL');
  assert.equal((await ktxWatch({ ...W, train: '0182' }, { api: f.api, tabId: 4 })).code, 'WATCH_DUPLICATE');
  assert.equal((await ktxWatch({ ...W, adults: 2 }, { api: f.api, tabId: 4 })).code, 'WATCH_OTHER');
  assert.equal((await ktxWatch({ ...W, train: 'x' }, { api: f.api, tabId: 4 })).code, 'INPUT_INVALID');
  await ktxWatchStop();
  assert.deepEqual((await Promise.all(runs)).map((r) => r.stopped), [true, true, true]);

  const gone = watching({ reads: [soldPage()] });
  let n = 0;
  const left = await ktxWatch(W, { api: gone.api, tabId: 4, wait: async () => { if (++n === 4) gone.tabs.get(4).url = 'https://www.korail.com/ticket/reservation'; } });
  assert.equal(left.code, 'WATCH_TAB_GONE');

  const front = watching({ reads: [soldPage()] });
  front.tabs.get(4).active = true;
  const paused = [];
  let turns = 0;
  const viewed = await ktxWatch(W, { api: front.api, tabId: 4, wait: async () => { turns++; }, now: () => (turns > 3 ? WATCH_LIMIT_MS * 2 : 0), onTick: (t) => paused.push(t.paused) });
  assert.equal(viewed.expired, true);
  assert.deepEqual([paused.every(Boolean), paused.length > 0, front.kinds()], [true, true, []], '보고 있는 탭은 건드리지 않는다');
});

test('빈자리 대기 — 결과 탭이 없으면 옆 탭에서 한 번 조회해 세우고, 새 좌석 조회는 돌던 대기를 끝낸 뒤에 간다', async () => {
  const f = tabsApi({ open: [{ id: 4, url: KORAIL_SEARCH }], reads: [soldPage(), page({ rows: [raw('182', '09:59', FREE)] })] });
  const r = await ktxWatch(W, { api: f.api, tabId: null, wait: noWait });
  assert.deepEqual([r.found, r.tabId], [true, 4]);
  assert.deepEqual(f.kinds().slice(-5), ['fill', 'submit', 'read', 'reload', 'read']);
  const g = watching({ reads: [soldPage()] });
  const run = ktxWatch(W, { api: g.api, tabId: 4, wait: () => new Promise((res) => setImmediate(res)) });
  const seats = await ktxSeatsTab(INPUT, { api: g.api, wait: noWait });
  assert.equal((await run).stopped, true);
  assert.equal(seats.ok, true);
});

test('줄 꼴 — 예약대기를 걸 수 있는 칸은 wait 로 가린다', () => {
  const rows = shapeSeatRows([raw('024', '09:26', { cls: 'price_box fl-l  yms_wait ', text: '입석 + 좌석 예약대기' }, { cls: 'price_box fl-l  sold_out_wait ', text: '매진' }), raw('182', '09:59')], INPUT);
  assert.deepEqual([rows[0].gen.wait, rows[0].spec.wait, rows[0].spec.soldOut, rows[1].gen.wait, openSeat(rows[1].gen)], [true, true, true, undefined, false]);
  assert.equal(openSeat({ price: '59,800원', soldOut: false, soon: true, note: '' }), true);
});
