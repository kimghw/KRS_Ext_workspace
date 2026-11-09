// Synthetic HTML and Chrome fixtures exercise fail-closed behavior. These are NOT
// captures of airline pages and do not verify the current live DOM or deep links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { validateFlightInput, flightBookingUrl, flightSearch, flightOpen, injected } from '../src/flights.js';
import { createDispatcher } from '../actions/dispatch.js';
import { registerFlight } from '../actions/runners/flight.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
const INPUT = { airline: 'KE', from: 'PUS', to: 'GMP', date: '2026-11-12', hour: 8, adults: 2 };
const SUMMARY = '<header class="summary">편도 PUS → GMP 2026.11.12 성인 2명</header>';
const form = (over = {}) => {
  const values = { departure: 'PUS', arrival: 'GMP', departureDate: '2026-11-12', adults: '2', tripType: 'OW', ...over };
  return `<form>${Object.entries(values).map(([name, value]) => `<input name="${name}" value="${value}">`).join('')}</form>`;
};
const row = (no, text, attrs = '') => `<article ${attrs}><span>${no}</span> <span>09:10</span> <span>10:10</span> ${text}</article>`;

function read(body, { airline = 'KE', input = INPUT, url = 'https://www.koreanair.com/booking/select-flight/departure' } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { url, runScripts: 'outside-only' });
  try {
    // A fresh browser realm catches accidental dependencies on module variables.
    return JSON.parse(JSON.stringify(dom.window.eval(`(${injected.pageRead.toString()})(${JSON.stringify({ airline, input })})`)));
  } finally { dom.window.close(); }
}

function submitPage(body, submit) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, {
    url: flightBookingUrl('KE', INPUT), runScripts: 'outside-only',
  });
  const clicked = [];
  for (const button of dom.window.document.querySelectorAll('button')) button.addEventListener('click', (event) => {
    event.preventDefault();
    clicked.push(button.textContent.trim());
  });
  try {
    const data = JSON.parse(JSON.stringify(dom.window.eval(`(${injected.pageRead.toString()})(${JSON.stringify({ airline: 'KE', input: INPUT, submit })})`)));
    return { data, clicked };
  } finally { dom.window.close(); }
}

test('flight validation rejects invalid calendar dates, old dates, invalid routes and passenger counts', () => {
  assert.equal(validateFlightInput(INPUT, '2026-11-05'), '');
  assert.equal(validateFlightInput({ ...INPUT, date: '2028-02-29' }, '2026-11-05'), '');
  for (const over of [
    { airline: 'XX' }, { from: 'pus' }, { to: 'PUS' }, { from: 'PUS/../../' },
    { date: '2026-02-29' }, { date: '2026-11-31' }, { date: '2026-11-04' },
    { hour: -1 }, { hour: 24 }, { hour: 8.5 }, { adults: 0 }, { adults: 10 }, { adults: '2' },
  ]) assert.notEqual(validateFlightInput({ ...INPUT, ...over }, '2026-11-05'), '', JSON.stringify(over));
});

test('booking URL construction preserves requested itinerary and rejects unsupported providers', () => {
  const ke = new URL(flightBookingUrl('KE', INPUT));
  assert.equal(ke.origin, 'https://www.koreanair.com');
  assert.equal(ke.pathname, '/booking/search');
  assert.deepEqual(Object.fromEntries(['bookingType', 'tripType', 'departure', 'arrival', 'departureDate', 'adults', 'children', 'infants', 'cabinClass'].map((key) => [key, ke.searchParams.get(key)])), {
    bookingType: 'R', tripType: 'OW', departure: 'PUS', arrival: 'GMP', departureDate: '2026-11-12', adults: '2', children: '0', infants: '0', cabinClass: 'Y',
  });
  const bx = new URL(flightBookingUrl('BX', INPUT));
  assert.equal(bx.origin, 'https://www.airbusan.com');
  assert.match(bx.pathname, /\/OW\/PUS\/GMP\/20261112\/GMP\/PUS\/20261112\/0\/2\/0\/0\/N$/);
  assert.throws(() => flightBookingUrl('XX', INPUT));
  assert.throws(() => flightBookingUrl('all', INPUT), 'all is a search choice, not a booking destination');
});

test('page reader distinguishes priced seats, sold-out seats and unknown availability', () => {
  const r = read(SUMMARY
    + row('KE1402', '<button>일반석 79,000원</button> 잔여 4석')
    + row('KE1404', '<button disabled>일반석 79,000원 매진</button>')
    + row('KE1406', '<button>상세 보기</button>'));
  assert.equal(r.matched, true);
  assert.deepEqual(r.rows.map(({ no, availability, seats, price }) => ({ no, availability, seats, price })), [
    { no: 'KE1402', availability: 'available', seats: 4, price: '79,000원' },
    { no: 'KE1404', availability: 'soldout', seats: null, price: '' },
    { no: 'KE1406', availability: 'unknown', seats: null, price: '' },
  ]);
});

test('Air Busan count of 9 is a lower bound and fewer remaining seats are not enough for the group', () => {
  const r = read(SUMMARY + row('BX8801', '잔여 9석') + row('BX8803', '잔여 1석'), {
    airline: 'BX', url: flightBookingUrl('BX', INPUT),
  });
  assert.deepEqual(r.rows.map(({ no, availability, seats, seatsAtLeast }) => ({ no, availability, seats, seatsAtLeast })), [
    { no: 'BX8801', availability: 'available', seats: 9, seatsAtLeast: true },
    { no: 'BX8803', availability: 'unknown', seats: 1, seatsAtLeast: false },
  ]);
});

test('URL parameters alone never prove that the airline accepted the requested query', () => {
  const r = read(row('KE1402', '<button>79,000원</button>'), { url: flightBookingUrl('KE', INPUT) });
  assert.equal(r.matched, false);
  assert.deepEqual(r.rows, []);
});

test('query verification rejects wrong direction, date, adults, round trip and incomplete conditions', () => {
  const flight = row('KE1402', '<button>79,000원</button>');
  assert.equal(read(form() + flight).rows.length, 1);
  for (const over of [
    { departure: 'GMP', arrival: 'PUS' }, { departureDate: '2026-11-13' },
    { adults: '1' }, { tripType: 'RT' }, { departureDate: '' },
  ]) {
    const result = read(form(over) + flight, { url: flightBookingUrl('KE', INPUT) });
    assert.equal(result.matched, false, JSON.stringify(over));
    assert.deepEqual(result.rows, []);
  }
  assert.equal(read('<header class="summary">편도 GMP → PUS 2026.11.12 성인 2명</header>' + flight).matched, false);
});

test('query verification reads the selected trip radio, not the first radio in the form', () => {
  const flight = row('KE1402', '<button>79,000원</button>');
  const radios = '<input type="radio" name="tripType" value="RT"><input type="radio" name="tripType" value="OW" checked>';
  assert.equal(read(form().replace('<input name="tripType" value="OW">', radios) + flight).matched, true);
  const roundTrip = '<input type="radio" name="tripType" value="OW"><input type="radio" name="tripType" value="RT" checked>';
  assert.equal(read(form().replace('<input name="tripType" value="OW">', roundTrip) + flight).matched, false);
});

test('disabled prices and insufficient explicit seat counts do not promise availability', () => {
  const r = read(SUMMARY
    + row('KE1402', '<button disabled>79,000원</button>')
    + row('KE1404', '<button aria-disabled="true">49,000원</button>')
    + row('KE1406', '<button>79,000원</button> 잔여 1석'));
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows.every((r) => r.availability === 'unknown'), true);
});

test('hidden rows, script data and informational notices do not become flight results', () => {
  const r = read(SUMMARY
    + row('KE1402', '<button>79,000원</button>')
    + row('KE1404', '<button>49,000원</button>', 'hidden')
    + `<div style="display:none">${row('KE1406', '<button>29,000원</button>')}</div>`
    + `<div aria-hidden="true">${row('KE1408', '<button>19,000원</button>')}</div>`
    + '<script>const cachedFlight = "KE1410 09:10 10:10 9,000원";</script>'
    + '<aside role="note">예시: KE1412 09:10 10:10 예약 가능 여부는 다음 화면에서 확인하세요.</aside>');
  assert.deepEqual(r.rows.map((r) => r.no), ['KE1402']);
});

test('hidden fare and hidden empty-state notices cannot affect visible results', () => {
  const r = read(SUMMARY + row('KE1402', '<button disabled>일반석 매진</button><span hidden>예약 가능 잔여 9석</span>')
    + '<div hidden>조회된 항공편이 없습니다</div>');
  assert.equal(r.rows[0].availability, 'soldout');
  assert.equal(r.rows[0].seats, null);
  assert.equal(r.empty, false);
});

test('mixed business/economy inventory and multiple-flight itineraries are not guessed', () => {
  const r = read(SUMMARY
    + row('KE1402', '<div>일반석 <button disabled>79,000원 매진</button></div><div>프레스티지 <button>159,000원</button> 잔여 9석</div>')
    + '<article>KE1404 09:10 KE1410 10:10 <button>100,000원</button></article>');
  assert.deepEqual(r.rows.map((r) => r.no), ['KE1402']);
  assert.notEqual(r.rows[0].availability, 'available');
  assert.equal(r.rows[0].seats, null);
});

test('blocked sites, wrong origins and loading state cannot produce successful rows', () => {
  for (const body of ['<h1>Access Denied</h1>', '<p>비정상적인 접속</p>']) {
    assert.match(read(body + SUMMARY + row('KE1402', '<button>79,000원</button>')).error, /접근 제한/);
  }
  // 확인 화면은 지나가는 것이라 실패가 아니라 기다림이다 — 그 화면의 줄도 결과가 아니다.
  for (const body of ['<p>Verify you are human</p>', '<title>Just a moment...</title>', '<p>잠시만 기다려 주세요. 사람인지 확인하는 중입니다.</p>']) {
    const waiting = read(body + SUMMARY + row('KE1402', '<button>79,000원</button>'));
    assert.deepEqual([waiting.error, waiting.matched, waiting.challenge, waiting.rows], [undefined, false, true, []], body);
  }
  // 대한항공 검색 화면의 진행 표시도 "잠시만 기다려" 를 쓴다 — 그 말만으로는 확인 화면이 아니다(2026-11-05 실측).
  const loader = read('<div class="loading">진행중 잠시만 기다려 주세요.</div>' + SUMMARY + row('KE1402', '<button>79,000원</button>'));
  assert.deepEqual([loader.challenge, loader.matched, loader.rows.length], [undefined, true, 1]);
  assert.ok(read(SUMMARY, { url: 'https://www.koreanair.com.evil.test/booking/search' }).error);
  assert.ok(read(SUMMARY, { url: 'http://www.koreanair.com/booking/search' }).error);
  const busy = read(SUMMARY + '<div role="progressbar">조회 중</div>' + row('KE1402', '<button>79,000원</button>'));
  assert.equal(busy.loading, true);
  assert.deepEqual(busy.rows, []);
});

test('query submission is explicit and limited to one exact search button in a verified query form', () => {
  const search = form().replace('</form>', '<button type="button">조회</button></form>');
  assert.deepEqual(submitPage(search).clicked, [], 'ordinary reading has no side effects');
  assert.deepEqual(submitPage(search, false).clicked, []);
  const submitted = submitPage(search, true);
  assert.equal(submitted.data.submitted, true);
  assert.deepEqual(submitted.clicked, ['조회']);
  assert.deepEqual(submitPage(form({ adults: '1' }).replace('</form>', '<button>조회</button></form>'), true).clicked, []);
  assert.deepEqual(submitPage(search + row('KE1402', '<button>79,000원</button>'), true).clicked, [], 'existing results must not be submitted again');
});

test('query submission never clicks reservation, payment, disabled or ambiguous controls', () => {
  for (const buttons of [
    '<button>예매</button>', '<button>결제</button>', '<button>예약 조회</button>',
    '<button>조회 후 예매</button>', '<button disabled>조회</button>',
    '<button aria-disabled="true">검색</button>', '<button>조회</button><button>검색</button>',
  ]) assert.deepEqual(submitPage(form().replace('</form>', buttons + '</form>'), true).clicked, [], buttons);
  assert.deepEqual(submitPage(form() + '<button>조회</button>', true).clicked, [], 'outside the query form');
  assert.deepEqual(submitPage(form().replace('</form>', '<button hidden>조회</button></form>'), true).clicked, []);
});

function fakeChrome(answers, probe = null) {
  const calls = [];
  const session = {};
  const tabs = new Map();
  const cookie = [];
  let serial = 10;
  let time = Date.UTC(2026, 10, 5);
  const makeTab = (options, windowId) => {
    const tab = { id: ++serial, windowId, url: options.url, status: 'complete' };
    tabs.set(tab.id, tab);
    return tab;
  };
  const api = {
    storage: { session: {
      get: async (key) => ({ [key]: session[key] }),
      set: async (value) => Object.assign(session, value),
      remove: async (key) => { calls.push(['remove', key]); delete session[key]; },
    } },
    windows: {
      create: async (options) => { calls.push(['window', options]); return { id: serial + 50, tabs: [makeTab(options, serial + 50)] }; },
      getCurrent: async () => ({ id: 1 }),
      update: async (...args) => { calls.push(['focus', ...args]); },
    },
    tabs: {
      get: async (id) => { if (!tabs.has(id)) throw new Error('Closed'); return { ...tabs.get(id) }; },
      create: async (options) => { calls.push(['create', options]); return makeTab(options, 1); },
      update: async (id, options) => { calls.push(['update', id, options]); Object.assign(tabs.get(id), options); return { ...tabs.get(id) }; },
      move: async (id, options) => { calls.push(['move', id, options]); tabs.get(id).windowId = options.windowId; },
      reload: async (id) => { calls.push(['reload', id]); },
    },
    scripting: { executeScript: async ({ target, func, args, world }) => {
      calls.push(['script', func.name, target.tabId, world]);
      if (func.name === 'pageHighlight') return [{ result: true }];
      if (func.name === 'pageEpoch') return [{ result: 1 }];
      if (func.name === 'pageProbe') { if (!probe) throw new Error('no probe'); return [{ result: probe }]; }
      if (func.name === 'pageCookie') return [{ result: { pressed: cookie.length ? cookie.shift() : false } }];
      const sequence = answers[args[0].airline];
      const answer = sequence.length > 1 ? sequence.shift() : sequence[0];
      if (answer instanceof Error) throw answer;
      return [{ result: answer }];
    } },
  };
  return { api, calls, session, tabs, cookie, options: { api, today: '2026-11-05', waitMs: 6000, pause: async () => { time += 600; }, now: () => time } };
}
const result = (rows = [], over = {}) => ({ at: 2, matched: true, rows, empty: false, ready: true, ...over });
const FLIGHT = { no: 'KE1402', dep: '09:10', arr: '10:10', availability: 'available', seats: 4, price: '79,000원' };

console.log('대한항공 쿠키 안내(2026-11-09 사용자 지정: "자동으로 눌러 줄 수 있으면 눌러줘") — 필수 쿠키만 허용');

const windowCalls = (f) => f.calls.filter(([kind]) => kind === 'focus').map(([, , options]) => options);
const hiddenPage = (over = {}) => result([], { loading: true, hidden: true, ...over });

test('쿠키 안내가 뜨면 필수 쿠키만 허용을 누르고 시간을 새로 재어 조회를 잇는다', async () => {
  const f = fakeChrome({ KE: [result([FLIGHT])] });
  f.cookie.push(true);
  const stages = [];
  const r = await flightSearch(INPUT, { ...f.options, onStage: (s) => stages.push(s) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results[0].rows, [FLIGHT]);
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'script').map(([, name]) => name), ['pageCookie', 'pageCookie', 'pageRead'], '안내창이 닫히면 조회를 잇는다');
  assert.ok(stages.some((s) => /필수 쿠키만 허용/.test(s)), '누른 것을 알린다');
  assert.deepEqual(windowCalls(f), [], '이미 안내창이 보이면 창을 건드리지 않는다');
  const bx = fakeChrome({ BX: [result([{ ...FLIGHT, no: 'BX8801' }])] });
  await flightSearch({ ...INPUT, airline: 'BX' }, bx.options);
  assert.equal(bx.calls.some(([, name]) => name === 'pageCookie'), false, '에어부산에는 쓰지 않는다');
});

test('누르는 함수는 보이는 필수 쿠키만 허용 단추만 누르고 대한항공 밖에서는 아무것도 하지 않는다', (t) => {
  const page = (visible = true, url = 'https://www.koreanair.com/booking/search') => {
    const dom = new JSDOM('<kc-global-cookie-banner></kc-global-cookie-banner>', { url });
    const doc = dom.window.document;
    const root = doc.querySelector('kc-global-cookie-banner').attachShadow({ mode: 'open' });
    root.innerHTML = '<button>모든 쿠키 허용</button><button><span> 필수 쿠키만 허용 </span></button><button>쿠키 설정</button>';
    const clicks = [];
    for (const b of root.querySelectorAll('button')) {
      b.addEventListener('click', () => clicks.push(b.textContent.trim()));
      b.getClientRects = () => (visible ? [{}] : []);
    }
    const saved = { document: globalThis.document, location: globalThis.location, getComputedStyle: globalThis.getComputedStyle };
    t.after(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete globalThis[k]; else Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); });
    for (const [k, v] of Object.entries({ document: doc, location: dom.window.location, getComputedStyle: dom.window.getComputedStyle })) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    return { clicks, answer: injected.pageCookie() };
  };
  const shown = page();
  assert.deepEqual([shown.answer, shown.clicks], [{ pressed: true }, ['필수 쿠키만 허용']]);
  const unseen = page(false);
  assert.deepEqual([unseen.answer, unseen.clicks], [{ pressed: false }, []], '뜨기 전에는 누르지 않는다');
  const other = page(true, 'https://example.com/');
  assert.deepEqual([other.answer, other.clicks], [{ pressed: false }, []]);
});

test('본문이 숨어 있으면 최소화 창을 보이게 해 안내창을 띄우고 누른 뒤 다시 최소화한다', async () => {
  // 5초(바퀴당 0.6초)가 지나야 보이게 한다 — 그 전에는 창을 건드리지 않는다.
  const answers = Array.from({ length: 12 }, () => hiddenPage());
  const f = fakeChrome({ KE: [...answers, result([FLIGHT])] });
  const cookie = f.cookie;
  const original = f.api.windows.update;
  f.api.windows.update = async (...args) => { await original(...args); if (args[1].state === 'normal') cookie.push(true); };
  const r = await flightSearch(INPUT, { ...f.options, waitMs: 20000 });
  assert.equal(r.ok, true);
  const windowId = f.calls.find(([kind]) => kind === 'focus')[1];
  assert.ok(Number.isInteger(windowId));
  assert.deepEqual(windowCalls(f), [{ state: 'normal', focused: false }, { state: 'minimized' }]);
});

test('포커스 없이 보여도 안 뜨면 앞으로 가져오고, 끝내 안 뜨면 창을 다시 내리고 까닭을 알린다', async () => {
  const f = fakeChrome({ KE: [hiddenPage()] });
  const r = await flightSearch(INPUT, { ...f.options, waitMs: 12000 });
  assert.equal(r.ok, false);
  assert.match(r.results[0].error, /쿠키 안내가 뜨기까지/);
  assert.deepEqual(windowCalls(f), [{ state: 'normal', focused: false }, { state: 'normal', focused: true }, { state: 'minimized' }]);
  assert.equal(f.calls.filter(([kind]) => kind === 'reload').length, 0);
});

test('사람이 보던 탭을 빌린 조회에서는 숨은 본문이어도 창을 건드리지 않는다', async () => {
  const f = fakeChrome({ KE: [hiddenPage()] });
  f.tabs.set(999, { id: 999, windowId: 1, status: 'complete', url: 'https://www.koreanair.com/booking/search' });
  f.api.tabs.query = async () => [f.tabs.get(999)];
  await flightSearch(INPUT, { ...f.options, waitMs: 12000 });
  assert.deepEqual(windowCalls(f), []);
});

test('쿠키 단추를 눌러도 안 닫히면 그만 누르고 안내창 까닭으로 끝낸다', async () => {
  const f = fakeChrome({ KE: [result([]), result([], { blocked: true })] });
  f.cookie.push(true, true, true, true);
  const r = await flightSearch(INPUT, f.options);
  assert.equal(r.ok, false);
  assert.match(r.results[0].error, /안내창/);
  assert.equal(f.cookie.length, 2, '두 번까지만 누른다');
});

test('현재 항공사 탭의 조건이 맞으면 별도 창·탭 없이 그 결과를 조회한다', async () => {
  const f = fakeChrome({ KE: [result([FLIGHT])] });
  f.tabs.set(999, { id: 999, windowId: 1, status: 'complete', url: 'https://www.koreanair.com/booking/select-flight/departure' });
  f.api.tabs.query = async () => [f.tabs.get(999)];
  const r = await flightSearch(INPUT, f.options);
  assert.equal(r.ok, true);
  assert.equal(r.results[0].tabId, 999);
  assert.deepEqual(r.results[0].rows, [FLIGHT]);
  assert.equal(f.calls.some(([kind]) => ['window', 'create', 'reload'].includes(kind)), false);
  assert.equal(f.calls.some(([kind, , options]) => kind === 'update' && options?.url), false);
  const opened = await flightOpen({ airline: 'KE', tabId: 999, input: INPUT, row: FLIGHT }, { api: f.api });
  assert.equal(opened.ok, true);
  assert.equal(f.calls.some(([kind]) => ['move', 'window', 'create'].includes(kind)), false);
});

test('현재 항공사 탭의 조건이 다르면 그 페이지를 바꾸지 않는다', async () => {
  const f = fakeChrome({ KE: [result([], { matched: false }), result([FLIGHT])] });
  f.tabs.set(999, { id: 999, windowId: 1, status: 'complete', url: 'https://www.koreanair.com/booking/search' });
  f.api.tabs.query = async () => [f.tabs.get(999)];
  assert.equal((await flightSearch(INPUT, f.options)).ok, true);
  assert.equal(f.calls.some(([kind, id]) => kind === 'update' && id === 999), false);
});

test('재사용한 현재 항공사 탭은 결과 대기 중에도 자동 새로고침하지 않는다', async () => {
  const f = fakeChrome({ BX: [result([])] });
  f.tabs.set(999, { id: 999, windowId: 1, status: 'complete', url: flightBookingUrl('BX', INPUT) });
  f.api.tabs.query = async () => [f.tabs.get(999)];
  const r = await flightSearch({ ...INPUT, airline: 'BX' }, { ...f.options, waitMs: 12000 });
  assert.equal(r.ok, false);
  assert.equal(r.results[0].tabId, 999);
  assert.equal(f.calls.some(([kind]) => ['window', 'create', 'reload'].includes(kind)), false);
});

test('one provider failure preserves the other result, filtered and sorted by departure time', async () => {
  const f = fakeChrome({ KE: [result([{ ...FLIGHT, no: 'KE1404', dep: '12:00' }, { ...FLIGHT, dep: '07:30' }, FLIGHT])], BX: [{ error: 'Access Denied' }] });
  const r = await flightSearch({ ...INPUT, airline: 'all' }, f.options);
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.map(({ airline, ok }) => ({ airline, ok })), [{ airline: 'KE', ok: true }, { airline: 'BX', ok: false }]);
  assert.deepEqual(r.results[0].rows.map((row) => row.dep), ['09:10', '12:00']);
  assert.equal(r.results[1].checkedAt, null);
  assert.deepEqual(r.results[1].rows, []);
  assert.equal(f.calls.filter(([kind]) => kind === 'window').every(([, options]) => options.state === 'minimized'), true);
});

test('timeout or transient empty screens are failure, while a stable explicit empty result is success', async () => {
  const pending = fakeChrome({ KE: [result([], { matched: false })] });
  const timeout = await flightSearch(INPUT, pending.options);
  assert.equal(timeout.ok, false);
  assert.match(timeout.results[0].error, /반영/);
  assert.deepEqual(pending.calls.filter(([kind]) => kind === 'reload'), [], 'six seconds is too early to reload');
  const stale = fakeChrome({ BX: [result([], { matched: false })] });
  await flightSearch({ ...INPUT, airline: 'BX' }, { ...stale.options, waitMs: 12000 });
  assert.equal(stale.calls.filter(([kind]) => kind === 'reload').length, 1, 'unfilled conditions reload the tab exactly once');
  // 조건은 실렸는데 조회가 시작되지 않은 채(대기열 스크립트가 막힘) 8초 — 한 번 새로고침하고, 끝내 안 되면 그 까닭을 말한다.
  const idle = fakeChrome({ BX: [result([])] });
  const stuck = await flightSearch({ ...INPUT, airline: 'BX' }, { ...idle.options, waitMs: 12000 });
  assert.equal(idle.calls.filter(([kind]) => kind === 'reload').length, 1, 'an idle filled page reloads exactly once');
  assert.match(stuck.results[0].error, /조회를 시작하지 않았습니다.*stclab/);
  // 닫기 전에 페이지 세계에서 까닭을 잰다(binjari 가 차단 안내를 기록하듯): 대기열 스크립트가 안 실렸는지, 실렸는데 조회가 안 나갔는지.
  const unloaded = fakeChrome({ BX: [result([])] }, { agentTag: true, nfStart: 'undefined', action: 'function' });
  const noAgent = await flightSearch({ ...INPUT, airline: 'BX' }, { ...unloaded.options, waitMs: 12000 });
  assert.match(noAgent.results[0].error, /조회를 시작하지 않았습니다. 대기열 스크립트\(agent-lib.stclab.com\)가 끝내 실리지 않았습니다 — 광고 차단/);
  assert.deepEqual(unloaded.calls.filter(([, name]) => name === 'pageProbe').map(([, , , world]) => world), ['MAIN'], 'the probe runs once, in the page world');
  const silent = fakeChrome({ BX: [result([])] }, { agentTag: true, nfStart: 'function', action: 'function' });
  assert.match((await flightSearch({ ...INPUT, airline: 'BX' }, { ...silent.options, waitMs: 12000 })).results[0].error, /실렸는데 조회 요청이 나가지 않았습니다/);
  assert.equal(idle.calls.filter(([, name]) => name === 'pageProbe').length, 1, 'a failed probe falls back to the generic reason');
  const queue = fakeChrome({ BX: [result([], { loading: true, queued: true })] });
  const queued = await flightSearch({ ...INPUT, airline: 'BX' }, { ...queue.options, waitMs: 12000 });
  assert.deepEqual([queued.results[0].error, queue.calls.filter(([kind]) => kind === 'reload').length], ['에어부산 접속 대기열이 끝나지 않았습니다. 예약 페이지에서 확인해 주세요.', 0]);
  const unseen = fakeChrome({ KE: [result([], { loading: true, hidden: true })] });
  const invisible = await flightSearch(INPUT, { ...unseen.options, waitMs: 12000 });
  assert.match(invisible.results[0].error, /쿠키 안내가 뜨기까지/);
  assert.equal(unseen.calls.filter(([kind]) => kind === 'reload').length, 0, 'a page that is still drawing is not reloaded');
  const searching = fakeChrome({ KE: [result([]), result([], { submitted: true }), result([])] });
  const slow = await flightSearch(INPUT, { ...searching.options, waitMs: 12000 });
  assert.deepEqual([slow.results[0].error, searching.calls.filter(([kind]) => kind === 'reload').length], ['항공편 시간표와 좌석을 읽지 못했습니다. 예약 페이지에서 확인해 주세요.', 0], 'a pressed search is never reloaded');
  const consent = fakeChrome({ KE: [result([]), result([], { blocked: true }), result([FLIGHT])] });
  const blocked = await flightSearch(INPUT, consent.options);
  assert.equal(blocked.ok, false);
  assert.match(blocked.results[0].error, /안내창/);
  // 조건이 실린 바퀴에 바로 누른다. 단추가 아직 없어 눌리지 않은 시도는 누른 셈 치지 않는다 — 다음 바퀴에 다시 누르고, 눌리면 그만.
  const late = fakeChrome({ KE: [result([]), result([]), result([]), result([]), result([]), result([], { submitted: true }), result([]), result([]), result([FLIGHT])] });
  const pressed = await flightSearch(INPUT, late.options);
  assert.deepEqual(pressed.results[0].rows.map((row) => row.no), ['KE1402']);
  assert.equal(late.calls.filter(([kind, name]) => kind === 'script' && name === 'pageRead').length, 9, 'no press after the one that landed');
  const transient = fakeChrome({ KE: [result([], { empty: true }), result([], { loading: true }), result([], { empty: true }), result([FLIGHT])] });
  assert.equal((await flightSearch(INPUT, transient.options)).results[0].rows.length, 1);
  const empty = fakeChrome({ KE: [result([], { empty: true })] });
  const settled = await flightSearch(INPUT, empty.options);
  assert.equal(settled.ok, true);
  assert.deepEqual(settled.results[0].rows, []);
  assert.equal(empty.calls.filter(([kind, name]) => kind === 'script' && name === 'pageRead').length, 3);
});

test('handoff releases ownership, focuses the result without booking, and future searches use a new tab', async () => {
  const f = fakeChrome({ KE: [result([FLIGHT])] });
  const first = (await flightSearch(INPUT, f.options)).results[0];
  const handoff = await flightOpen({ airline: 'KE', tabId: first.tabId, input: INPUT, row: FLIGHT }, { api: f.api });
  assert.deepEqual(handoff, { ok: true, highlighted: true });
  assert.equal(f.session['flightTabs.KE'], undefined);
  const removeIndex = f.calls.findIndex(([kind]) => kind === 'remove');
  assert.ok(removeIndex < f.calls.findIndex(([kind]) => kind === 'move'));
  assert.deepEqual(f.calls.filter(([kind, name]) => kind === 'script' && name !== 'pageCookie').map(([, name]) => name), ['pageRead', 'pageHighlight']);
  const next = (await flightSearch(INPUT, f.options)).results[0];
  assert.notEqual(next.tabId, first.tabId);
  assert.equal(f.calls.some(([kind, id, options]) => kind === 'update' && id === first.tabId && options.url), false);
});

test('reusing an owned tab ignores old-document results until navigation finishes', async () => {
  const answers = { KE: [result([FLIGHT], { at: 1 })] };
  const f = fakeChrome(answers);
  const first = (await flightSearch(INPUT, f.options)).results[0];
  answers.KE = [result([{ ...FLIGHT, no: 'KE1404', dep: '12:00' }], { at: 1 }), result([{ ...FLIGHT, no: 'KE1406', dep: '13:00' }], { at: 2 })];
  const next = (await flightSearch(INPUT, f.options)).results[0];
  assert.equal(next.tabId, first.tabId);
  assert.deepEqual(next.rows.map((r) => r.no), ['KE1406']);
  assert.equal(f.calls.filter(([kind]) => kind === 'window').length, 1);
  assert.equal(f.calls.filter(([kind, name]) => kind === 'script' && name === 'pageEpoch').length, 1);
});

test('closed, unrelated or already-handed-off tabs open a new booking tab', async () => {
  const f = fakeChrome({ KE: [result([FLIGHT])] });
  const first = (await flightSearch(INPUT, f.options)).results[0];
  f.tabs.get(first.tabId).url = 'https://example.com/';
  const opened = await flightOpen({ airline: 'KE', tabId: first.tabId, input: INPUT, row: FLIGHT }, { api: f.api });
  assert.equal(opened.reopened, true);
  assert.equal(opened.highlighted, false);
  assert.equal(f.calls.some(([kind, id]) => kind === 'move' && id === first.tabId), false);
});

test('invalid input performs no network or browser work', async () => {
  const f = fakeChrome({});
  const r = await flightSearch({ ...INPUT, adults: 0 }, f.options);
  assert.equal(r.ok, false);
  assert.deepEqual(r.results, []);
  assert.deepEqual(f.calls, []);
});

test('flight action passes validated input, Korean date and progress callback without confirmation', async () => {
  const calls = [];
  const entries = [];
  const dispatcher = createDispatcher({ log: (entry) => entries.push(entry) });
  const onStage = () => {};
  registerFlight(dispatcher, { flightSearch: async (input, options) => {
    calls.push({ input, options });
    return { ok: true, results: [{ airline: 'KE', ok: true, rows: [FLIGHT] }, { airline: 'BX', ok: false, error: 'blocked' }] };
  } });
  const input = { ...INPUT, airline: 'all' };
  const { record } = dispatcher.build('flight.search', { input, preset: { today: '2026-11-05' } });
  const answer = await dispatcher.run(record, { onStage });
  assert.equal(answer.ok, true);
  assert.deepEqual(calls, [{ input, options: { today: '2026-11-05', onStage } }]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'flight');
  assert.throws(() => dispatcher.build('flight.search', { input: { ...INPUT, adults: 10 } }), /인원|adults/);
});
