import test from 'node:test';
import assert from 'node:assert/strict';
import { FLIGHT_REPAIR_TASK, FLIGHT_REPAIR_TIMEOUT_MS, flightSnapshotKey, repairFlightRead, requestFlightReadRepair } from '../src/flightrepair.js';
import { repair as nativeRepair } from '../native/flightread.mjs';

const INPUT = { airline: 'KE', from: 'PUS', to: 'GMP', date: '2026-11-13', hour: 8, adults: 1 };
const makeSnapshot = () => ({
  version: 1, airline: 'KE', url: 'https://www.koreanair.com/booking/search', at: 1794384280504.1,
  blocked: false, hidden: false, busy: false,
  conditions: {
    routes: [{ from: 'PUS', to: 'GMP' }], passengers: [{ adults: '1', children: '0', infants: '0' }], trips: ['OW'],
    dates: [{ id: 'calendar-instance-v2-20261113', date: '', datetime: '', label: '', text: '13일, 금요일, 가는 날 선택됨' }],
    dateLabels: ['11월 13일 (금)'], activeDay: '',
  },
});
const snapshot = (mutate = () => {}) => { const value = makeSnapshot(); mutate(value); return value; };
const fakeApi = (call) => ({ runtime: { sendNativeMessage: call } });
const answer = (_, message) => nativeRepair(message.snapshot, message.input);

test('bounded repair proves exact conditions from selected calendar evidence without mutating inputs', () => {
  const source = makeSnapshot(), before = JSON.stringify(source), query = { ...INPUT };
  const result = repairFlightRead(source, query);
  assert.deepEqual(result, { ok: true, proof: { version: 1, airline: 'KE', at: source.at, url: source.url, snapshotKey: flightSnapshotKey(source),
    condition: { from: 'PUS', to: 'GMP', date: '2026-11-13', adults: 1, trip: 'OW', children: 0, infants: 0 } } });
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(query, INPUT);
  assert.deepEqual(nativeRepair(source, query), result);
});

test('snapshot identity survives reordered object keys while preserving evidence array order', async () => {
  const reverse = (value) => Array.isArray(value) ? value.map(reverse)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverse(value[key])])) : value;
  const source = makeSnapshot(), reordered = reverse(source);
  assert.notEqual(JSON.stringify(source), JSON.stringify(reordered));
  assert.equal(flightSnapshotKey(source), flightSnapshotKey(reordered));
  assert.deepEqual(repairFlightRead(source, INPUT), repairFlightRead(reordered, INPUT));
  const result = await requestFlightReadRepair(reordered, INPUT, { api: fakeApi((_, message) => nativeRepair(reverse(message.snapshot), message.input)) });
  assert.equal(result.ok, true);
  const two = snapshot((s) => { s.conditions.dateLabels.push('2026.11.13'); });
  const flipped = structuredClone(two); flipped.conditions.dateLabels.reverse();
  assert.notEqual(flightSnapshotKey(two), flightSnapshotKey(flipped));
});

test('repair recognizes full dates in bounded IDs, semantic attributes and selected-day labels', () => {
  const cases = [
    ['id', '20261113'], ['id', 'ecb2b60a8b40da34a52a317c197bf60d20261113'],
    ['id', 'selected-date-v3-20261113'], ['date', '2026-11-13'], ['date', '2026.11.13'],
    ['datetime', '2026-11-13T00:00:00+09:00'], ['label', '2026년 11월 13일, 가는 날 선택됨'],
    ['text', '2026년 11월 13일 금요일'],
  ];
  for (const [field, value] of cases) {
    const source = snapshot((s) => { s.conditions.dates[0].id = 'opaque-calendar-cell'; s.conditions.dates[0][field] = value; });
    assert.equal(repairFlightRead(source, INPUT).ok, true, `${field}: ${value}`);
  }
});

test('result-page evidence accepts consistent duplicate components and selected active day', () => {
  const source = snapshot((s) => {
    s.url = 'https://www.koreanair.com/booking/select-flight/departure';
    s.conditions.routes.push({ from: 'PUS', to: 'GMP' });
    s.conditions.passengers.push({ adults: '1', children: '0', infants: '0' });
    s.conditions.trips.push('편도'); s.conditions.dateLabels.push('2026.11.13'); s.conditions.activeDay = '13(금)';
  });
  assert.equal(repairFlightRead(source, INPUT).ok, true);
});

test('missing full year is never copied from the requested date', () => {
  const source = snapshot((s) => { s.conditions.dates[0].id = 'calendar-day-13'; s.conditions.dates[0].text = '11월 13일'; });
  assert.equal(repairFlightRead(source, INPUT).code, 'FLIGHT_REPAIR_DATE_UNVERIFIED');
});

test('contradictory full dates, displayed dates and active-day state are refused', () => {
  const changes = [
    (s) => { s.conditions.dates[0].id = 'opaque-20271113'; },
    (s) => { s.conditions.dates[0].id = 'opaque-20261114'; },
    (s) => { s.conditions.dates[0].date = '2027-11-13'; },
    (s) => { s.conditions.dates[0].datetime = '2026-11-14T00:00:00'; },
    (s) => { s.conditions.dates[0].label = '2026년 11월 13일 또는 2026년 11월 14일'; },
    (s) => { s.conditions.dates[0].label = '11월 14일'; },
    (s) => { s.conditions.dates[0].text = '14일, 토요일, 가는 날 선택됨'; },
    (s) => { s.conditions.dates[0].text = '14'; },
    (s) => { s.conditions.dates[0].date = '2026-02-30'; },
    (s) => { s.conditions.dateLabels = ['11월 14일']; },
    (s) => { s.conditions.dateLabels = ['2027년 11월 13일']; },
    (s) => { s.conditions.dateLabels = ['11월 13일', '11월 14일']; },
    (s) => { s.conditions.activeDay = '14(토)'; },
    (s) => { s.conditions.activeDay = '12 / 13'; },
  ];
  for (const change of changes) assert.equal(repairFlightRead(snapshot(change), INPUT).ok, false, change.toString());
});

test('all observed routes, passengers and trip types must agree exactly', () => {
  const changes = [
    (s) => { s.conditions.routes.push({ from: 'GMP', to: 'PUS' }); },
    (s) => { s.conditions.passengers[0].adults = '2'; },
    (s) => { s.conditions.passengers[0].children = '1'; },
    (s) => { s.conditions.passengers[0].infants = ''; },
    (s) => { s.conditions.trips.push('RT'); },
  ];
  for (const change of changes) assert.equal(repairFlightRead(snapshot(change), INPUT).code, 'FLIGHT_REPAIR_CONDITION_MISMATCH');
});

test('blocked, hidden and loading pages cannot be repaired', () => {
  for (const key of ['blocked', 'hidden', 'busy']) {
    assert.equal(repairFlightRead(snapshot((s) => { s[key] = true; }), INPUT).code, 'FLIGHT_REPAIR_BLOCKED');
  }
});

test('schema bounds reject untrusted fields, ambiguous selection, oversized values and wrong documents', () => {
  const changes = [
    (s) => { s.account = 'not allowed'; },
    (s) => { s.conditions.html = '<body>not allowed</body>'; },
    (s) => { s.conditions.routes[0].cookie = 'not allowed'; },
    (s) => { s.conditions.dates = []; },
    (s) => { s.conditions.dates.push({ ...s.conditions.dates[0] }); },
    (s) => { s.conditions.routes = Array(5).fill(s.conditions.routes[0]); },
    (s) => { s.conditions.dateLabels = []; },
    (s) => { s.conditions.dates[0].text = 'x'.repeat(513); },
    (s) => { s.url += '?other=document'; },
    (s) => { s.url = 'https://www.koreanair.com.evil.example/booking/search'; },
    (s) => { s.url = 'https://www.koreanair.com/booking/payment'; },
    (s) => { s.at = NaN; }, (s) => { s.at = 0; }, (s) => { s.version = 2; },
  ];
  for (const change of changes) assert.equal(repairFlightRead(snapshot(change), INPUT).code, 'FLIGHT_REPAIR_INVALID', change.toString());
  for (const query of [{ ...INPUT, airline: 'BX' }, { ...INPUT, adults: 0 }, { ...INPUT, date: '2026-02-30' }, { ...INPUT, secret: 'not allowed' }]) {
    assert.equal(repairFlightRead(makeSnapshot(), query).code, 'FLIGHT_REPAIR_INVALID');
  }
});

test('native request sends exactly one bounded task and validates its proof', async () => {
  const source = makeSnapshot(), calls = [];
  const result = await requestFlightReadRepair(source, INPUT, { api: fakeApi((host, message) => { calls.push({ host, message }); return answer(host, message); }) });
  assert.equal(result.ok, true);
  assert.equal(FLIGHT_REPAIR_TASK, 'flightReadRepair');
  assert.equal(FLIGHT_REPAIR_TIMEOUT_MS, 5000);
  assert.deepEqual(calls, [{ host: 'com.krs.meetingroom', message: { task: 'flightReadRepair', snapshot: source, input: INPUT } }]);
});

test('native responses cannot substitute another document, conditions or unsupported output fields', async () => {
  const changes = [
    (r) => { r.proof.at++; }, (r) => { r.proof.url += '?changed'; },
    (r) => { r.proof.snapshotKey += ' '; }, (r) => { r.proof.condition.date = '2026-11-14'; },
    (r) => { r.proof.condition.adults = 2; }, (r) => { r.command = 'click'; },
    (r) => { r.proof.condition.extra = true; }, (r) => { delete r.proof.snapshotKey; },
  ];
  for (const change of changes) {
    let calls = 0;
    const result = await requestFlightReadRepair(makeSnapshot(), INPUT, { api: fakeApi((host, message) => {
      calls++; const response = answer(host, message); change(response); return response;
    }) });
    assert.equal(result.code, 'FLIGHT_REPAIR_RESPONSE', change.toString()); assert.equal(calls, 1);
  }
});

test('request snapshots are detached from later caller mutations', async () => {
  const source = makeSnapshot(), original = flightSnapshotKey(source);
  let release, received;
  const pending = requestFlightReadRepair(source, INPUT, { api: fakeApi((_, message) => { received = message; return new Promise((resolve) => { release = resolve; }); }) });
  await new Promise(setImmediate);
  source.conditions.dates[0].id = 'other-20261114';
  release(nativeRepair(received.snapshot, received.input));
  assert.equal((await pending).proof.snapshotKey, original);
});

test('invalid inputs do not call native and unavailable or failed native calls do not retry', async () => {
  let calls = 0;
  const api = fakeApi(() => { calls++; throw new Error('native host unavailable'); });
  assert.equal((await requestFlightReadRepair(snapshot((s) => { s.busy = true; }), INPUT, { api })).code, 'FLIGHT_REPAIR_BLOCKED');
  assert.equal(calls, 0);
  assert.equal((await requestFlightReadRepair(makeSnapshot(), INPUT, { api })).code, 'FLIGHT_REPAIR_UNAVAILABLE');
  assert.equal(calls, 1);
  assert.equal((await requestFlightReadRepair(makeSnapshot(), INPUT, { api: {} })).code, 'FLIGHT_REPAIR_UNAVAILABLE');
});

test('bounded native timeout returns once and never retries when a late proof arrives', async () => {
  let calls = 0, release;
  const source = makeSnapshot();
  const result = await requestFlightReadRepair(source, INPUT, { timeoutMs: 5, api: fakeApi(() => { calls++; return new Promise((resolve) => { release = resolve; }); }) });
  assert.equal(result.code, 'FLIGHT_REPAIR_TIMEOUT'); assert.equal(calls, 1);
  release(nativeRepair(source, INPUT));
  await new Promise(setImmediate);
  assert.equal(calls, 1); assert.equal(result.code, 'FLIGHT_REPAIR_TIMEOUT');
});
