// 회의실·차량 실행기 어댑터(actions/runners/booking.js) — 기록 → 인자 변환이 RUNNERS.payload 와 같다 · ctx 가 그대로 실행기에 간다 ·
// ok 판정(§14.3) · 수정의 콜백 차례(취소 → 새 예약 → 되살리기)와 되돌리기 뜻이 sidepanel 의 runModify·extendBooking 과 같다.
// 실행기(reserve·cancel)와 findSlots 는 가짜, 수정 규칙(src/modify.js)은 진짜를 쓴다. 명세는 생성물(actions/spec.js) 그대로다.
import assert from 'node:assert/strict';

import { createDispatcher } from '../dispatch.js';
import { ActionError } from '../gate.js';
import { RUNNERS } from '../../src/runners.js';
import { registerBooking, payloadOf, toPayload, inputOf, cancelInputOf, handleSpan, kindOf, LIVE_RECORD_GONE } from '../runners/booking.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const rejects = async (p, re) => {
  try { await p; } catch (err) {
    assert.ok(err instanceof ActionError, `ActionError 여야 한다: ${err}`);
    assert.match(err.message, re);
    return err;
  }
  return assert.fail('던져야 한다');
};

/* 재조회까지 끝난 성공 응답(site.js 가 주는 모양)과 그 밖의 결과 */
const done = (extra = {}) => ({ ok: true, submitted: true, verified: true, message: '', ...extra });
const notSent = (message) => ({ ok: false, submitted: false, message });
const unsure = (message) => ({ ok: false, submitted: true, verified: false, message });

/** 부른 차례를 적는 가짜 실행자 둘. impl 의 reserve·cancel 은 (payload|record, day, n) 으로 결과를 정한다. */
function fakeRunners(impl = {}) {
  const calls = [];
  const mk = (kind) => ({
    kind,
    staleHandle: kind === 'room',
    reserve: async (payload, day) => { calls.push(['reserve', kind, payload, day]); return (impl.reserve || (() => done()))(payload, day, calls.length); },
    cancel: async (record, day) => { calls.push(['cancel', kind, record, day]); return (impl.cancel || (() => done()))(record, day, calls.length); },
  });
  return { runners: { room: mk('room'), car: mk('car') }, calls };
}

/** 가짜 실행자·가짜 findSlots 를 꽂은 디스패처. 로그는 모아 둔다. */
function make(impl = {}) {
  const log = [];
  const d = createDispatcher({ log: (e) => log.push(e), now: () => 1760600000000 });
  const { runners, calls } = fakeRunners(impl);
  const searches = [];
  registerBooking(d, { runners, findSlots: async (filter, onProgress, loadDay) => { searches.push([filter, onProgress, loadDay]); return impl.found || { results: [], skipped: [], dates: [filter.dateFrom] }; } });
  return { d, log, runners, calls, searches };
}

const ROOM_PICK = { row: { name: '제4회의실', value: 'R4' }, date: '2026-10-05', region: '부산', start: '09:00', end: '10:00', title: '주간회의', place: '거제', passenger: '홍길동' };
const CAR_ROW = { name: '아반테 (181허4309)', value: '37' };
const CAR_PICK = { ...ROOM_PICK, row: CAR_ROW };
const PRESET = { room: { me: '김기현', region: '부산' }, car: { me: '김기현' } };

console.log('payload 동형 — 기록을 지나도 RUNNERS.<갈래>.payload(pick) 과 같은 한 건이 나온다');
{
  const { d } = make();
  t('회의실: 키·값·차례까지 같다', () => {
    const want = RUNNERS.room.payload(ROOM_PICK);
    const { record } = d.build('room.reserve', { input: inputOf(want), preset: PRESET.room });
    assert.deepEqual(payloadOf(record), want);
    assert.deepEqual(Object.keys(payloadOf(record)), Object.keys(want));
    assert.deepEqual(record.input, { room: '제4회의실', roomValue: 'R4', region: '부산', date: '2026-10-05', start: '09:00', end: '10:00', title: '주간회의' });
  });
  t('차량: room 별칭·행선지·동승자가 같고, 빈 사용목적·동승자는 관문이 null 로 두어도 실행기에는 예전처럼 빈 글로 간다', () => {
    const want = RUNNERS.car.payload({ ...CAR_PICK, title: '', passenger: '' });
    const { record } = d.build('car.reserve', { input: inputOf(want), preset: PRESET.car });
    assert.equal(record.input.title, null);
    assert.equal(record.input.passenger, null);
    assert.equal('room' in record.input, false, '별칭은 기록의 칸이 아니다');
    assert.deepEqual(payloadOf(record), want);
    assert.deepEqual(Object.keys(payloadOf(record)), Object.keys(want));
  });
  t('차량: 끝이 다른 날이면 endDate 가 같이 가고, 같은 날이면 가지 않는다', () => {
    for (const endDate of ['2026-10-06', '2026-10-05', undefined]) {
      const want = RUNNERS.car.payload({ ...CAR_PICK, endDate });
      const { record } = d.build('car.reserve', { input: inputOf(want), preset: PRESET.car });
      assert.deepEqual(payloadOf(record), want, String(endDate));
    }
  });
  t('차량: 사이트가 막는 차량의 까닭(blocked)은 기록이 아니라 ctx 에서 붙는다', () => {
    const want = RUNNERS.car.payload({ ...CAR_PICK, row: { ...CAR_ROW, blocked: '차량 이용 시 지원팀에 문의 바랍니다.' } });
    const { record } = d.build('car.reserve', { input: inputOf(want), preset: PRESET.car });
    assert.equal('blocked' in record.input, false);
    assert.deepEqual(payloadOf(record, { blocked: want.blocked }), want);
    assert.equal('blocked' in payloadOf(record), false);
  });
  t('inputOf 는 kind·blocked 와 차량의 room 별칭만 뗀다 — 회의실의 room 은 회의실 이름이라 남는다', () => {
    assert.deepEqual(inputOf({ kind: 'room', room: 'A', roomValue: '1', blocked: 'x' }), { room: 'A', roomValue: '1' });
    assert.deepEqual(inputOf({ kind: 'car', car: 'B', carValue: '2', room: 'B' }), { car: 'B', carValue: '2' });
    assert.deepEqual(inputOf(undefined), {});
  });
  t('kindOf 는 행위 ID 의 갈래, toPayload 는 모르는 갈래면 ActionError', () => {
    assert.equal(kindOf({ action: 'car.modify' }), 'car');
    assert.equal(kindOf({}), '');
    assert.throws(() => toPayload('attend', {}), /모르는 갈래 attend/);
  });
  t('관문이 막는 것 — 회의주제가 비면 room.reserve 를, 행선지가 비면 car.reserve 를 짓지 못한다', () => {
    assert.throws(() => d.build('room.reserve', { input: inputOf(RUNNERS.room.payload({ ...ROOM_PICK, title: '' })), preset: PRESET.room }), (err) => err instanceof ActionError && /title 가 없습니다/.test(err.message));
    assert.throws(() => d.build('car.reserve', { input: inputOf(RUNNERS.car.payload({ ...CAR_PICK, place: '' })), preset: PRESET.car }), (err) => err instanceof ActionError && /place 가 없습니다/.test(err.message));
  });
}

console.log('취소 기록의 input — 내 예약 목록의 줄과 격자의 손잡이');
{
  const { d } = make();
  t('회의실: 줄의 구간·제목·지역이 칸이 된다', () => {
    const input = cancelInputOf('room', { name: '제4회의실', from: { date: '2026-10-05', minutes: 540 }, to: { date: '2026-10-05', minutes: 600 }, title: '주간회의', region: '부산' });
    assert.deepEqual(input, { room: '제4회의실', date: '2026-10-05', start: '09:00', end: '10:00', title: '주간회의', region: '부산' });
    assert.deepEqual(d.build('room.cancel', { input, preset: PRESET.room }).record.input, input);
  });
  t('차량: 여러 날에 걸치면 endDate, 하루면 null. 행선지는 목록에 없어 null', () => {
    const multi = cancelInputOf('car', { name: CAR_ROW.name, from: { date: '2026-10-05', minutes: 420 }, to: { date: '2026-10-06', minutes: 1200 }, title: '출장' });
    assert.deepEqual(multi, { car: CAR_ROW.name, date: '2026-10-05', start: '07:00', end: '20:00', title: '출장', endDate: '2026-10-06', place: null });
    assert.equal(cancelInputOf('car', { name: 'x', from: { date: '2026-10-05', minutes: 420 }, to: { date: '2026-10-05', minutes: 600 } }).endDate, null);
    assert.deepEqual(d.build('car.cancel', { input: multi, preset: PRESET.car }).record.input, multi);
  });
  t('기록용 글(회의주제)은 명세의 한도에서 잘라 사이트의 긴 제목이 취소를 막지 않는다', () => {
    const long = '가'.repeat(150);
    const input = cancelInputOf('room', { name: 'A', from: { date: '2026-10-05', minutes: 540 }, to: { date: '2026-10-05', minutes: 600 }, title: long });
    assert.equal(input.title.length, 100);
    assert.equal(input.region, null);
    d.build('room.cancel', { input, preset: PRESET.room });
  });
  t('handleSpan — 차량 손잡이는 자르기 전의 원래 구간(0·1440 으로 잘린 그날 값이 아니다), 회의실 손잡이는 그날의 분', () => {
    const day = { date: '2026-10-06', region: '부산' };
    const car = { room: CAR_ROW.name, name: CAR_ROW.name, start: 0, end: 1200, spanStart: { date: '2026-10-05', minutes: 420 }, spanEnd: { date: '2026-10-06', minutes: 1200 }, title: '출장' };
    assert.deepEqual(handleSpan(car, day), { name: CAR_ROW.name, from: car.spanStart, to: car.spanEnd, title: '출장', region: '부산' });
    assert.deepEqual(cancelInputOf('car', handleSpan(car, day)), { car: CAR_ROW.name, date: '2026-10-05', start: '07:00', end: '20:00', title: '출장', endDate: '2026-10-06', place: null });
    const room = { room: '제4회의실', start: 540, end: 600, title: '주간회의', del: { idx: '1' } };
    assert.deepEqual(cancelInputOf('room', handleSpan(room, day)), { room: '제4회의실', date: '2026-10-06', start: '09:00', end: '10:00', title: '주간회의', region: '부산' });
    assert.deepEqual(handleSpan(null, day).from, { date: '2026-10-06', minutes: undefined });
    assert.equal(cancelInputOf('room', handleSpan(null, day)).start, null);
  });
}

console.log('booking.reserve — ctx 의 day·blocked 가 실행기에 그대로 가고, ok 는 확인(verified)까지 본다');
{
  const DAY = { date: '2026-10-05', doc: {} };
  await ta('회의실: reserve(payload, day) 한 번. 로그 kind 는 reserve, data.record.action 은 room.reserve', async () => {
    const { d, log, calls } = make();
    const want = RUNNERS.room.payload(ROOM_PICK);
    const { record } = d.build('room.reserve', { input: inputOf(want), preset: PRESET.room });
    const r = await d.run(record, { confirmed: record.hash, day: DAY, text: '제4회의실 예약' });
    assert.deepEqual(calls, [['reserve', 'room', want, DAY]]);
    assert.equal(r.ok, true);
    assert.equal(log.length, 1);
    assert.equal(log[0].kind, 'reserve');
    assert.equal(log[0].ok, true);
    assert.equal(log[0].text, '제4회의실 예약');
    assert.equal(log[0].data.record.action, 'room.reserve');
    assert.equal(log[0].data.result.verified, true);
  });
  await ta('차량: blocked 가 ctx 에서 payload 로 붙는다. 사람이 누르지 않았으면(confirmed 없음) 보내지 않는다', async () => {
    const { d, calls } = make();
    const want = RUNNERS.car.payload({ ...CAR_PICK, row: { ...CAR_ROW, blocked: '문의 바랍니다.' } });
    const { record } = d.build('car.reserve', { input: inputOf(want), preset: PRESET.car });
    await rejects(d.run(record, { day: DAY, blocked: want.blocked }), /확인 없이/);
    assert.equal(calls.length, 0);
    await d.run(record, { confirmed: record.hash, day: DAY, blocked: want.blocked });
    assert.deepEqual(calls, [['reserve', 'car', want, DAY]]);
  });
  await ta('ok 판정: ok 인데 verified:false 면 실패, verified 가 없으면 성공. 던지면 로그에 남기고 다시 던진다', async () => {
    const results = [done({ verified: false }), { ok: true, submitted: true, message: '' }];
    const { d, log } = make({ reserve: () => results.shift() });
    const { record } = d.build('room.reserve', { input: inputOf(RUNNERS.room.payload(ROOM_PICK)), preset: PRESET.room });
    await d.run(record, { confirmed: record.hash });
    await d.run(record, { confirmed: record.hash });
    assert.deepEqual(log.map((e) => e.ok), [false, true]);
    const { d: d2, log: log2 } = make({ reserve: () => { throw new Error('끊김'); } });
    const r2 = d2.build('room.reserve', { input: inputOf(RUNNERS.room.payload(ROOM_PICK)), preset: PRESET.room }).record;
    await assert.rejects(d2.run(r2, { confirmed: r2.hash }), /끊김/);
    assert.deepEqual(log2.map((e) => [e.ok, e.data.result.error]), [[false, '끊김']]);
  });
  await ta('outcome 이 최종 문구·data 를 정한다(제출했지만 확인 못 함)', async () => {
    const { d, log } = make({ reserve: () => unsure('다시 조회했지만 보이지 않습니다') });
    const { record } = d.build('room.reserve', { input: inputOf(RUNNERS.room.payload(ROOM_PICK)), preset: PRESET.room });
    await d.run(record, {
      confirmed: record.hash, text: '제4회의실',
      outcome: async (r) => ({ ok: false, text: `제4회의실 — ${r.submitted ? '제출했지만 확인 못 함' : '실패'}: ${r.message}`, data: { submitted: !!r.submitted, verified: r.verified } }),
    });
    assert.equal(log[0].text, '제4회의실 — 제출했지만 확인 못 함: 다시 조회했지만 보이지 않습니다');
    assert.deepEqual([log[0].ok, log[0].data.submitted, log[0].data.verified], [false, true, false]);
  });
}

console.log('booking.cancel — 사이트에서 읽은 산 손잡이(ctx.record)로 취소한다');
{
  const DAY = { date: '2026-10-05', region: '부산', doc: {} };
  const handle = { room: '제4회의실', start: 540, end: 600, title: '주간회의', del: { idx: '7', group: '1' } };
  const input = cancelInputOf('room', handleSpan(handle, DAY));
  await ta('cancel(record, day) 한 번. 로그 kind 는 cancel 이고 손잡이(del)는 기록에 없다', async () => {
    const { d, log, calls } = make();
    const { record } = d.build('room.cancel', { input, preset: PRESET.room });
    await d.run(record, { confirmed: record.hash, day: DAY, record: handle });
    assert.deepEqual(calls, [['cancel', 'room', handle, DAY]]);
    assert.equal(log[0].kind, 'cancel');
    assert.equal(log[0].data.record.action, 'room.cancel');
    assert.equal(JSON.stringify(log[0].data).includes('"del"'), false);
  });
  await ta('손잡이가 없거나 다른 건이면 ActionError — 아무것도 보내지 않는다', async () => {
    const { d, calls } = make();
    const { record } = d.build('room.cancel', { input, preset: PRESET.room });
    await rejects(d.run(record, { confirmed: record.hash, day: DAY }), /손잡이/);
    await rejects(d.run(record, { confirmed: record.hash, day: DAY, record: { ...handle, room: '제5회의실' } }), /제5회의실.*제4회의실.*다릅니다/);
    assert.equal(calls.length, 0);
  });
  await ta('ok 판정은 r.ok 만 본다(취소는 verified 를 늘 주지 않는다)', async () => {
    const results = [{ ok: true, submitted: true, message: '' }, { ok: false, submitted: true, message: '그대로 남아 있습니다' }];
    const { d, log } = make({ cancel: () => results.shift() });
    const { record } = d.build('room.cancel', { input, preset: PRESET.room });
    await d.run(record, { confirmed: record.hash, day: DAY, record: handle });
    await d.run(record, { confirmed: record.hash, day: DAY, record: handle });
    assert.deepEqual(log.map((e) => e.ok), [true, false]);
  });
}

console.log('booking.search — 말로 찾기. 확인 없이 돌고(confirm false) findSlots(input, onProgress, loadDay) 를 부른다');
{
  const filter = { dateFrom: '2026-10-20', dateTo: '2026-10-21', hourFrom: 9, hourTo: 18, minSeats: null, minHours: 2, region: '부산', summary: '10/20~21 부산 2시간' };
  await ta('회의실: LLM 이 지은 조각을 초안 모드로 지어도 run 이 실행 모드로 다시 지나며, 결과는 늘 ok 다', async () => {
    const found = { results: [{ date: '2026-10-20' }], skipped: [], dates: ['2026-10-20', '2026-10-21'] };
    const { d, log, searches } = make({ found });
    const { record } = d.build('room.search', { input: filter, preset: { me: '김기현', today: '2026-10-16' }, by: 'llm', via: 'cli', mode: 'draft' });
    const onProgress = () => {};
    const loadDay = async () => ({});
    const r = await d.run(record, { onProgress, loadDay, text: '"내일 부산" → 회의실 조회' });
    assert.equal(r, found);
    assert.equal(searches.length, 1);
    assert.deepEqual(searches[0][0], { ...filter });
    assert.equal(searches[0][1], onProgress);
    assert.equal(searches[0][2], loadDay);
    assert.deepEqual([log[0].kind, log[0].ok, log[0].data.record.by, log[0].data.record.via, log[0].data.record.action], ['ask', true, 'llm', 'cli', 'room.search']);
  });
  await ta('차량: 좌석 수·지역은 기록의 칸이 아니라 빠진 채 findSlots 에 간다', async () => {
    const { d, searches } = make();
    const { record } = d.build('car.search', { input: filter, preset: { me: '김기현', today: '2026-10-16' }, by: 'llm', via: 'local', mode: 'draft' });
    await d.run(record, {});
    assert.deepEqual(Object.keys(searches[0][0]).sort(), ['dateFrom', 'dateTo', 'hourFrom', 'hourTo', 'minHours', 'summary']);
  });
  await ta('빈 결과도 ok — 못 찾은 것은 실패가 아니다', async () => {
    const { d, log } = make({ found: { results: [], skipped: [{ date: '2026-10-20', reason: 'x' }], dates: ['2026-10-20'] } });
    const { record } = d.build('room.search', { input: filter, preset: { me: '김기현', today: '2026-10-16' }, by: 'llm', via: 'api' });
    await d.run(record, {});
    assert.equal(log[0].ok, true);
  });
}

console.log('booking.modify — 취소 → 새 예약 → 되살리기. 순서와 되돌리기는 src/modify.js(진짜)가 쥔다');
{
  const back = { room: '제4회의실', roomValue: 'R4', region: '부산', date: '2026-10-05', start: '09:00', end: '10:00', title: '주간회의' };
  const next = { ...back, room: '제2회의실', roomValue: 'R2', date: '2026-10-07', start: '14:00', end: '16:00' };
  const DAY0 = { date: '2026-10-05', doc: 'd0' };
  const days = (names = []) => { const seen = []; return { seen, reloadFor: async (date) => { seen.push(date); return { date, doc: names.shift() || 'dx' }; } }; };
  const handle = { room: '제4회의실', start: 540, end: 600, del: { idx: '7' } };
  const build = (d, kind = 'room', input = { back, next }) => d.build(`${kind}.modify`, { input, preset: PRESET[kind] }).record;

  await ta('수정(live): 원래 날짜를 다시 읽고 산 손잡이로 취소 → 새 날짜를 다시 읽고 새 예약. 되면 되살리지 않는다', async () => {
    const { d, log, calls } = make();
    const record = build(d);
    const { seen, reloadFor } = days(['d1', 'd2']);
    const stages = [];
    const lived = [];
    const r = await d.run(record, {
      confirmed: record.hash, day: DAY0, reloadFor, onStage: (s) => stages.push(s),
      live: (day) => { lived.push(day); return handle; },
      text: '제4회의실 → 제2회의실', data: { kind: 'room' },
      outcome: async (res) => ({ data: { kind: 'room', outcome: { stage: res.stage, restored: res.restored } } }),
    });
    assert.deepEqual(r, { ok: true, stage: 'done', restored: false, lost: false, uncertain: false, message: '수정했습니다.', record: undefined });
    assert.deepEqual(seen, ['2026-10-05', '2026-10-07']);
    assert.deepEqual(lived, [{ date: '2026-10-05', doc: 'd1' }]);
    assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['cancel', 'room'], ['reserve', 'room']]);
    assert.deepEqual(calls[0].slice(2), [handle, { date: '2026-10-05', doc: 'd1' }]);
    assert.deepEqual(calls[1].slice(2), [toPayload('room', next), { date: '2026-10-07', doc: 'd2' }]);
    assert.deepEqual(calls[1][2], { kind: 'room', room: '제2회의실', roomValue: 'R2', region: '부산', date: '2026-10-07', start: '14:00', end: '16:00', title: '주간회의' });
    assert.deepEqual(stages, ['cancel', 'reserve']);
    assert.deepEqual([log[0].kind, log[0].ok, log[0].text, log[0].data.outcome, log[0].data.record.input.next.room], ['modify', true, '제4회의실 → 제2회의실', { stage: 'done', restored: false }, '제2회의실']);
  });
  await ta('수정(live): 다시 읽은 화면에 그 예약이 없으면 취소를 보내지 않고 그대로 둔다(LIVE_RECORD_GONE)', async () => {
    const { d, log, calls } = make();
    const record = build(d);
    const { reloadFor } = days(['d1']);
    const r = await d.run(record, { confirmed: record.hash, day: DAY0, reloadFor, live: () => null });
    assert.deepEqual([r.ok, r.stage, r.restored, r.lost], [false, 'cancel', true, false]);
    assert.match(r.message, /그대로 두었습니다/);
    assert.ok(r.message.includes(LIVE_RECORD_GONE));
    assert.equal(calls.length, 0, '취소도 새 예약도 보내지 않았다');
    assert.equal(log[0].ok, false);
  });
  await ta('새 예약이 제출조차 안 되면 원래 날짜를 다시 읽어 원래 조건으로 되살린다(restore 는 원래 예약의 payload)', async () => {
    const { d, calls } = make({ reserve: (payload) => (payload.room === '제2회의실' ? notSent('겹칩니다') : done()) });
    const record = build(d);
    const { seen, reloadFor } = days(['d1', 'd2', 'd3']);
    const r = await d.run(record, { confirmed: record.hash, day: DAY0, reloadFor, live: () => handle });
    assert.deepEqual([r.ok, r.stage, r.restored, r.lost, r.uncertain], [false, 'reserve', true, false, false]);
    assert.deepEqual(seen, ['2026-10-05', '2026-10-07', '2026-10-05']);
    assert.deepEqual(calls.map((c) => [c[0], c[2].room, c[3].doc]), [['cancel', '제4회의실', 'd1'], ['reserve', '제2회의실', 'd2'], ['reserve', '제4회의실', 'd3']]);
    assert.deepEqual(calls[2][2], toPayload('room', back));
  });
  await ta('새 예약을 제출했지만 확인 못 하면 되살리지 않는다(이중 예약 방지) — uncertain', async () => {
    const { d, calls } = make({ reserve: () => unsure('저장됐는지 모름') });
    const record = build(d);
    const { reloadFor } = days();
    const r = await d.run(record, { confirmed: record.hash, day: DAY0, reloadFor, live: () => handle });
    assert.deepEqual([r.ok, r.stage, r.restored, r.uncertain], [false, 'reserve', false, true]);
    assert.deepEqual(calls.map((c) => c[0]), ['cancel', 'reserve']);
  });
  await ta('이어붙이기(target): 보고 있던 화면(day)의 손잡이로 바로 취소하고(다시 읽지 않음), 새 예약 전에만 다시 읽는다', async () => {
    const { d, calls } = make();
    const merged = { ...back, start: '09:00', end: '11:00' };
    const record = build(d, 'room', { back, next: merged });
    const { seen, reloadFor } = days(['d1']);
    const r = await d.run(record, { confirmed: record.hash, day: DAY0, target: handle, reloadFor });
    assert.equal(r.ok, true);
    assert.deepEqual(seen, ['2026-10-05']);
    assert.deepEqual(calls.map((c) => [c[0], c[3].doc]), [['cancel', 'd0'], ['reserve', 'd1']]);
    assert.equal(calls[0][2], handle);
    assert.deepEqual(calls[1][2], toPayload('room', merged));
  });
  await ta('이어붙이기: 손잡이가 원래 예약과 다른 건이거나 없으면, 다시 읽을 방법이 없으면 ActionError — 아무것도 보내지 않는다', async () => {
    const { d, calls } = make();
    const record = build(d);
    const { reloadFor } = days();
    await rejects(d.run(record, { confirmed: record.hash, day: DAY0, target: { ...handle, room: '제9회의실' }, reloadFor }), /제9회의실.*제4회의실.*다릅니다/);
    await rejects(d.run(record, { confirmed: record.hash, day: DAY0, reloadFor }), /손잡이/);
    await rejects(d.run(record, { confirmed: record.hash, day: DAY0, target: handle }), /reloadFor/);
    assert.equal(calls.length, 0);
  });
  await ta('차량: blocked 는 새 차량(next)에만 붙고 되살리는 원래 건에는 붙지 않는다. room 별칭·endDate 규칙은 payload 와 같다', async () => {
    const carBack = { car: '아반테 (181허4309)', carValue: '37', date: '2026-10-05', start: '09:00', end: '18:00', endDate: null, title: '출장', place: '거제', passenger: null };
    const carNext = { ...carBack, car: '그랜저 (189오9673)', carValue: '38', endDate: '2026-10-06' };
    const { d, calls } = make({ reserve: (payload) => (payload.blocked ? notSent(payload.blocked) : done()) });
    const record = build(d, 'car', { back: carBack, next: carNext });
    const { reloadFor } = days();
    const r = await d.run(record, { confirmed: record.hash, day: DAY0, target: { room: carBack.car, name: carBack.car }, reloadFor, blocked: '문의 바랍니다.' });
    assert.deepEqual([r.ok, r.stage, r.restored], [false, 'reserve', true]);
    const sent = calls.filter((c) => c[0] === 'reserve').map((c) => c[2]);
    assert.deepEqual(sent[0], { kind: 'car', car: '그랜저 (189오9673)', carValue: '38', room: '그랜저 (189오9673)', date: '2026-10-05', start: '09:00', end: '18:00', endDate: '2026-10-06', title: '출장', place: '거제', passenger: '', blocked: '문의 바랍니다.' });
    assert.deepEqual(sent[1], { kind: 'car', car: '아반테 (181허4309)', carValue: '37', room: '아반테 (181허4309)', date: '2026-10-05', start: '09:00', end: '18:00', title: '출장', place: '거제', passenger: '' });
    assert.deepEqual(sent[1], RUNNERS.car.payload({ row: { name: carBack.car, value: '37' }, date: '2026-10-05', start: '09:00', end: '18:00', endDate: undefined, title: '출장', place: '거제', passenger: '' }));
  });
  await ta('ok 판정: 수정 결과의 ok 그대로(verified 가 없다). 되살린 실패는 ok:false 로 남는다', async () => {
    const { d, log } = make({ reserve: (payload) => (payload.room === '제2회의실' ? notSent('안 됨') : done()) });
    const record = build(d);
    const { reloadFor } = days();
    await d.run(record, { confirmed: record.hash, day: DAY0, target: handle, reloadFor });
    assert.deepEqual([log[0].kind, log[0].ok, log[0].data.result.stage, log[0].data.result.restored], ['modify', false, 'reserve', true]);
    const { d: d2, log: log2 } = make({ reserve: () => notSent('안 됨') });
    const r2 = build(d2);
    await d2.run(r2, { confirmed: r2.hash, day: DAY0, target: handle, reloadFor: days().reloadFor });
    assert.deepEqual([log2[0].ok, log2[0].data.result.stage, log2[0].data.result.lost], [false, 'restore', true], '되살리기도 안 되면 lost');
  });
  t('기록의 back·next 는 그 갈래 reserve 의 칸이다 — 원래 예약의 회의주제가 비면 짓지 못한다', () => {
    const { d } = make();
    assert.throws(() => build(d, 'room', { back: { ...back, title: '' }, next }), (err) => err instanceof ActionError && /back\.title 가 없습니다/.test(err.message));
  });
}

console.log(`\n${pass} passed`);
