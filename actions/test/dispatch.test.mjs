// 디스패처(actions/dispatch.js) — confirm 없이는 안 돈다 · hash 가 다르면 안 돈다 · planned 는 안 돈다 · 모르는 runner · 던지면 기록하고 다시 던짐 ·
// 로그 한 줄의 모양 · 같은 입력을 UI/LLM 로 넣으면 정규화 결과(지문)가 같다 · 실행 직전의 재검사(§14.1) · outcome.
import assert from 'node:assert/strict';

import { createDispatcher } from '../dispatch.js';
import { ActionError } from '../gate.js';
import { hashOf } from '../record.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const SPEC = {
  version: 1,
  domains: {
    attend: { domain: 'attend', title: '근태', log: 'attend', kinds: ['trip'], preset: {}, llm: { task: 'attend', mode: 'merged', partial: true } },
    room: { domain: 'room', title: '회의실', log: 'reserve', kinds: ['search', 'reserve', 'ghost'], preset: {}, llm: { task: 'search', mode: 'per-kind', partial: false } },
    rnd: { domain: 'rnd', title: 'R&D', kinds: ['project'], preset: {}, llm: { mode: 'none' } },
  },
  actions: {
    'attend.trip': {
      id: 'attend.trip', domain: 'attend', kind: 'trip', title: '출장 신청', status: 'live', confirm: true, effect: 'write',
      summary: '출장 {dateFrom}~{dateTo} {place} · {purpose}',
      preset: { today: { from: 'today', desc: '오늘' }, me: { from: 'me', desc: '내 이름' }, project: { from: 'ctx:project', type: 'object', desc: '과제', log: false } },
      fields: {
        dateFrom: { type: 'date', required: true, desc: '출발일' }, dateTo: { type: 'date', desc: '도착일' }, days: { type: 'integer', min: 1, max: 31, desc: '며칠간' },
        start: { type: 'time', desc: '출발' }, place: { type: 'string', required: true, max: 200, desc: '출장지' }, purpose: { type: 'string', max: 200, desc: '목적' },
        transport: { type: 'tags', values: ['train', 'plane', 'bus'], desc: '교통편' },
      },
      checks: [{ left: 'dateFrom', op: '<=', right: 'dateTo', drop: 'dateTo', message: '종료일이 시작일보다 앞서 종료일은 뺐습니다' }],
      runner: 'attend.apply',
    },
    'room.search': {
      id: 'room.search', domain: 'room', kind: 'search', title: '회의실 찾기', status: 'live', confirm: false, effect: 'none', summary: '{dateFrom} {hourFrom}~{hourTo}시', preset: {},
      fields: { dateFrom: { type: 'date', required: true, desc: '시작일' }, hourFrom: { type: 'integer', required: true, min: 0, max: 23, desc: '시작 시' }, hourTo: { type: 'integer', required: true, min: 1, max: 24, desc: '끝 시' } },
      runner: 'booking.search',
    },
    'room.reserve': {
      id: 'room.reserve', domain: 'room', kind: 'reserve', title: '회의실 예약', status: 'live', confirm: true, effect: 'write', log: 'reserve', summary: '{room} {date} {start}~{end} · {title}',
      preset: { me: { from: 'me', desc: '예약자' } },
      fields: { room: { type: 'string', required: true, desc: '회의실' }, date: { type: 'date', required: true, desc: '예약일' }, start: { type: 'time', required: true, desc: '시작' }, end: { type: 'time', required: true, desc: '종료' }, title: { type: 'string', required: true, max: 100, desc: '회의주제' } },
      runner: 'booking.reserve',
    },
    'rnd.project': { id: 'rnd.project', domain: 'rnd', kind: 'project', title: '과제', status: 'planned', confirm: true, preset: {}, fields: { name: { type: 'string', required: true, desc: '이름' } }, runner: 'rnd.project' },
    'room.ghost': { id: 'room.ghost', domain: 'room', kind: 'ghost', title: '유령', status: 'live', confirm: false, preset: {}, fields: {}, runner: 'booking.ghost' },
  },
  tasks: {},
};
const NOW = 1760600000000;
const INPUT = { dateFrom: '2026-10-20', dateTo: '2026-10-21', days: 2, start: '07:00', place: '대전', purpose: '회의', transport: ['train'] };
const PRESET = { today: '2026-10-16', me: '김기현', project: { name: '과제', content: '긴 내용' } };
const make = () => {
  const log = [];
  const d = createDispatcher({ spec: SPEC, log: (e) => log.push(e), now: () => NOW });
  return { d, log };
};
const rejects = async (p, re) => {
  try { await p; } catch (err) {
    assert.ok(err instanceof ActionError, `ActionError 여야 한다: ${err}`);
    assert.match(err.message, re);
    return err;
  }
  return assert.fail('던져야 한다');
};

console.log('등록과 짓기');
t('register — 같은 이름을 두 번 등록하면 throw, 함수가 아니면 throw, 이어 부를 수 있다', () => {
  const { d } = make();
  assert.equal(d.register('attend.apply', async () => ({ ok: true })), d);
  assert.throws(() => d.register('attend.apply', async () => ({})), /이미 등록/);
  assert.throws(() => d.register('x', 'nope'), /함수가 아닙니다/);
  assert.throws(() => d.register('', () => {}), /이름이 없습니다/);
});
t('build — 관문을 지나 기록을 짓는다(at 은 now, hash 는 action+preset+input 의 지문). 틀리면 ActionError', () => {
  const { d } = make();
  const { record, notes } = d.build('attend.trip', { input: INPUT, preset: PRESET });
  assert.deepEqual(notes, []);
  assert.deepEqual(record, { v: 1, action: 'attend.trip', at: NOW, by: 'ui', via: null, preset: PRESET, input: INPUT, hash: hashOf({ action: 'attend.trip', preset: PRESET, input: INPUT }) });
  assert.match(record.hash, /^[0-9a-f]{8}$/);
  const err = (() => { try { d.build('attend.trip', { input: { ...INPUT, days: 99 }, preset: PRESET }); } catch (e) { return e; } return null; })();
  assert.ok(err instanceof ActionError);
  assert.deepEqual(err.problems, ['days 값(99)이 틀렸습니다']);
  assert.deepEqual(d.build('attend.trip', { input: INPUT, preset: PRESET, by: 'llm', via: 'api' }).record.by, 'llm');
});
t('has · ids · entry', () => {
  const { d } = make();
  assert.ok(d.has('attend.trip') && !d.has('x.y') && !d.has('constructor'));
  assert.deepEqual(d.ids(), Object.keys(SPEC.actions));
  assert.equal(d.entry('room.search'), SPEC.actions['room.search']);
  assert.throws(() => d.entry('x.y'), ActionError);
});

console.log('돌리기 — 확인과 지문');
await ta('confirm 행위는 ctx.confirmed 가 record.hash 여야 돈다 — 없거나 다르면 ActionError 이고 로그도 실행기도 없다', async () => {
  const { d, log } = make();
  let ran = 0;
  d.register('attend.apply', async () => { ran++; return { ok: true }; });
  const { record } = d.build('attend.trip', { input: INPUT, preset: PRESET });
  await rejects(d.run(record), /확인 없이 실행할 수 없습니다/);
  await rejects(d.run(record, { confirmed: 'deadbeef' }), /확인 없이 실행할 수 없습니다/);
  await rejects(d.run(record, { confirmed: true }), /확인 없이 실행할 수 없습니다/);
  assert.equal(ran, 0);
  assert.deepEqual(log, []);
  assert.deepEqual(await d.run(record, { confirmed: record.hash }), { ok: true });
  assert.equal(ran, 1);
});
await ta('build 뒤에 input 을 고치면 옛 hash 로는 안 돈다 — 실행 직전에 관문을 다시 지나 지문을 다시 센다', async () => {
  const { d, log } = make();
  d.register('attend.apply', async () => ({ ok: true }));
  const { record } = d.build('attend.trip', { input: INPUT, preset: PRESET });
  record.input.place = '부산';
  await rejects(d.run(record, { confirmed: record.hash }), /기록이 지은 뒤에 바뀌었습니다/);
  const r2 = d.build('attend.trip', { input: INPUT, preset: PRESET }).record;
  r2.preset.me = '다른 사람';
  await rejects(d.run(r2, { confirmed: r2.hash }), /기록이 지은 뒤에 바뀌었습니다/);
  assert.deepEqual(log, []);
});
await ta('초안 모드로 지은 기록은 run 에서 실행 모드 검사를 받는다 — 필수가 비면 막히고, 다 있으면 같은 지문으로 돈다(빠진 칸과 null 칸은 같은 지문)', async () => {
  const { d } = make();
  const seen = [];
  d.register('attend.apply', async (rec) => { seen.push(rec); return { ok: true }; });
  const draft = d.build('attend.trip', { input: { dateFrom: '2026-10-20' }, preset: PRESET, by: 'llm', via: 'cli', mode: 'draft' }).record;
  assert.deepEqual(draft.input, { dateFrom: '2026-10-20' }, 'partial 갈래라 빈 칸은 빠져 있다');
  const err = await rejects(d.run(draft, { confirmed: draft.hash }), /place 가 없습니다/);
  assert.deepEqual(err.problems, ['place 가 없습니다']);
  const full = d.build('attend.trip', { input: { dateFrom: '2026-10-20', place: '대전', transport: ['plane', 'train'] }, preset: PRESET, by: 'llm', via: 'api', mode: 'draft' }).record;
  const exec = d.build('attend.trip', { input: { dateFrom: '2026-10-20', place: '대전', transport: ['train', 'plane'] }, preset: PRESET }).record;
  assert.equal(full.hash, exec.hash);
  assert.deepEqual(full.input, { dateFrom: '2026-10-20', place: '대전', transport: ['train', 'plane'] });
  assert.deepEqual(exec.input, { dateFrom: '2026-10-20', dateTo: null, days: null, start: null, place: '대전', purpose: null, transport: ['train', 'plane'] });
  await d.run(full, { confirmed: full.hash });
  assert.deepEqual(seen[0].input, exec.input, '실행기는 실행 모드로 다시 정규화한 기록을 받는다');
  assert.equal(seen[0].by, 'llm');
});
await ta('build 를 거치지 않은 객체도 관문을 지난다 — 정규화된 값에 맞는 지문이면 돌고, 아니면(글 "2" 같은 것) 막힌다', async () => {
  const { d } = make();
  d.register('attend.apply', async () => ({ ok: true }));
  const hand = { v: 1, action: 'attend.trip', at: 0, by: 'ui', via: null, preset: PRESET, input: INPUT, hash: hashOf({ action: 'attend.trip', preset: PRESET, input: INPUT }) };
  assert.deepEqual(await d.run(hand, { confirmed: hand.hash }), { ok: true });
  const rawish = { ...hand, input: { ...INPUT, days: '2' } };
  rawish.hash = hashOf({ action: 'attend.trip', preset: PRESET, input: rawish.input });
  await rejects(d.run(rawish, { confirmed: rawish.hash }), /기록이 지은 뒤에 바뀌었습니다/);
  await rejects(d.run({ ...hand, input: { ...INPUT, days: 99 } }, { confirmed: hand.hash }), /days 값\(99\)이 틀렸습니다/);
  await rejects(d.run('x'), /기록이 아닙니다/);
  await rejects(d.run({ action: 'x.y' }), /모르는 행위 x\.y/);
});
await ta('실행기는 깊게 얼린 기록을 받는다 — 원본 기록은 그대로, ctx 는 그대로 넘어간다', async () => {
  const { d } = make();
  let got;
  d.register('attend.apply', async (rec, ctx) => { got = { rec, ctx }; return { ok: true }; });
  const { record } = d.build('attend.trip', { input: INPUT, preset: PRESET });
  const ctx = { confirmed: record.hash, files: [{ name: 'a.png' }], op: 'request' };
  await d.run(record, ctx);
  assert.ok(Object.isFrozen(got.rec) && Object.isFrozen(got.rec.input) && Object.isFrozen(got.rec.input.transport) && Object.isFrozen(got.rec.preset.project));
  assert.ok(!Object.isFrozen(record) && !Object.isFrozen(record.input));
  assert.deepEqual(got.rec, record);
  assert.equal(got.ctx, ctx);
});
await ta('confirm: false 인 행위(조회)는 확인 없이 돈다 — 그래도 지문은 맞아야 한다', async () => {
  const { d, log } = make();
  d.register('booking.search', async () => ({ results: [1, 2], skipped: 0 }), { ok: () => true });
  const { record } = d.build('room.search', { input: { dateFrom: '2026-10-20', hourFrom: 9, hourTo: 18 }, by: 'llm', via: 'cli' });
  assert.deepEqual(await d.run(record), { results: [1, 2], skipped: 0 });
  assert.deepEqual(log.map((e) => [e.kind, e.ok, e.text, e.data.result]), [['reserve', true, '2026-10-20 9~18시', { skipped: 0 }]]);
  await rejects(d.run({ ...record, hash: 'deadbeef' }), /기록이 지은 뒤에 바뀌었습니다/);
});

console.log('돌리기 — 명세');
await ta('planned 행위는 돌지 않는다', async () => {
  const { d } = make();
  d.register('rnd.project', async () => ({ ok: true }));
  const { record } = d.build('rnd.project', { input: { name: '과제' } });
  await rejects(d.run(record, { confirmed: record.hash }), /planned 상태/);
});
await ta('등록되지 않은 실행기는 ActionError', async () => {
  const { d } = make();
  const { record } = d.build('room.ghost', {});
  await rejects(d.run(record), /등록되지 않은 실행기 booking\.ghost/);
});

console.log('돌리기 — 로그');
await ta('로그 한 줄의 모양 — kind·ok·text(summary)·data{ record(잘라 낸 것 — log:false 사전설정 없음), ctx.data, result(스칼라만) }', async () => {
  const { d, log } = make();
  d.register('attend.apply', async () => ({ ok: true, docNo: 'D1', stage: 'done', raw: { html: '<p>' } }));
  const { record } = d.build('attend.trip', { input: INPUT, preset: PRESET });
  await d.run(record, { confirmed: record.hash, data: { op: 'request' }, files: [] });
  assert.deepEqual(log, [{
    kind: 'attend', ok: true, text: '출장 2026-10-20~2026-10-21 대전 · 회의',
    data: { record: { v: 1, action: 'attend.trip', at: NOW, by: 'ui', via: null, preset: { today: '2026-10-16', me: '김기현' }, input: INPUT, hash: record.hash }, op: 'request', result: { ok: true, docNo: 'D1', stage: 'done' } },
  }]);
});
await ta('kind 는 행위의 log → 갈래의 log → 갈래 이름 차례. ctx.text 가 있으면 그 글, ok 는 register 의 ok 로', async () => {
  const { d, log } = make();
  d.register('booking.reserve', async () => ({ ok: true, verified: false }), { ok: (r) => r.ok === true && r.verified !== false });
  d.register('booking.search', async () => ({ results: [] }), { ok: () => true });
  d.register('rnd.project', async () => ({ ok: true }));
  const r = d.build('room.reserve', { input: { room: 'A', date: '2026-10-20', start: '09:00', end: '10:00', title: '회의' }, preset: { me: '김기현' } }).record;
  await d.run(r, { confirmed: r.hash, text: '예약 A' });
  const s = d.build('room.search', { input: { dateFrom: '2026-10-20', hourFrom: 9, hourTo: 18 } }).record;
  await d.run(s);
  assert.deepEqual(log.map((e) => [e.kind, e.ok, e.text]), [['reserve', false, '예약 A'], ['reserve', true, '2026-10-20 9~18시']]);
  const spec = { ...SPEC, actions: { ...SPEC.actions, 'rnd.project': { ...SPEC.actions['rnd.project'], status: 'live' } } };
  const log2 = [];
  const d2 = createDispatcher({ spec, log: (e) => log2.push(e), now: () => NOW }).register('rnd.project', async () => ({ ok: true }));
  const p = d2.build('rnd.project', { input: { name: '과제' } }).record;
  await d2.run(p, { confirmed: p.hash });
  assert.deepEqual(log2.map((e) => [e.kind, e.text]), [['rnd', '과제']], '갈래에 log 가 없으면 갈래 이름, summary 가 없으면 title');
});
await ta('실행기가 던지면 { ok: false, error } 로 기록하고 그대로 다시 던진다', async () => {
  const { d, log } = make();
  const boom = new Error('사이트가 거부했습니다');
  d.register('attend.apply', async () => { throw boom; });
  const { record } = d.build('attend.trip', { input: INPUT, preset: PRESET });
  await assert.rejects(d.run(record, { confirmed: record.hash }), (err) => err === boom);
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].kind, log[0].ok, log[0].data.result], ['attend', false, { ok: false, error: '사이트가 거부했습니다' }]);
  assert.equal(log[0].data.record.hash, record.hash);
});
await ta('로그 함수가 던지거나 거부해도 run 은 결과를 돌려준다', async () => {
  const d = createDispatcher({ spec: SPEC, log: () => { throw new Error('저장소 없음'); }, now: () => NOW }).register('booking.search', async () => ({ results: [] }), { ok: () => true });
  const { record } = d.build('room.search', { input: { dateFrom: '2026-10-20', hourFrom: 9, hourTo: 18 } });
  assert.deepEqual(await d.run(record), { results: [] });
  const d2 = createDispatcher({ spec: SPEC, log: async () => { throw new Error('늦게 실패'); }, now: () => NOW }).register('booking.search', async () => ({ results: [] }), { ok: () => true });
  assert.deepEqual(await d2.run(record), { results: [] });
});
await ta('ctx.outcome — 실행기 뒤, 로그 전에 기다려 돌려준 ok·text·data 로 로그를 쓴다. 던지면 ok:false 로 기록하고 다시 던진다. 로그는 run 마다 한 줄', async () => {
  const { d, log } = make();
  d.register('attend.apply', async () => ({ ok: true, docNo: 'D1' }));
  const { record } = d.build('attend.trip', { input: INPUT, preset: PRESET });
  const order = [];
  const result = await d.run(record, {
    confirmed: record.hash, data: { op: 'request' },
    outcome: async (r) => { order.push(['outcome', r.docNo, log.length]); return { ok: false, text: '목록에서 못 찾음', data: { seq: 3 } }; },
  });
  assert.deepEqual(result, { ok: true, docNo: 'D1' }, 'result 는 실행기가 돌려준 그대로');
  assert.deepEqual(order, [['outcome', 'D1', 0]], '로그 전에 불린다');
  assert.deepEqual(log.map((e) => [e.ok, e.text, e.data.seq, e.data.op, e.data.result]), [[false, '목록에서 못 찾음', 3, undefined, { ok: true, docNo: 'D1' }]]);
  // 아무것도 안 돌려주면 그대로
  await d.run(record, { confirmed: record.hash, outcome: async () => {} });
  assert.deepEqual([log[1].ok, log[1].text], [true, '출장 2026-10-20~2026-10-21 대전 · 회의']);
  // 던지면
  await assert.rejects(d.run(record, { confirmed: record.hash, outcome: async () => { throw new Error('확인 실패'); } }), /확인 실패/);
  assert.equal(log.length, 3);
  assert.deepEqual([log[2].ok, log[2].data.result], [false, { ok: false, docNo: 'D1', error: '확인 실패' }]);
});

console.log('같은 입력, 두 길');
t('같은 입력을 UI 로 넣든 LLM 으로 넣든 정규화된 기록과 지문이 같다', () => {
  const { d } = make();
  const ui = d.build('attend.trip', { input: { ...INPUT, days: '2', start: '7:00', place: ' 대전 ', transport: ['plane', 'train'], ghost: 1 }, preset: PRESET, by: 'ui' }).record;
  const llm = d.build('attend.trip', { input: { ...INPUT, transport: ['train', 'plane'] }, preset: PRESET, by: 'llm', via: 'cli' }).record;
  assert.equal(ui.hash, llm.hash);
  assert.deepEqual(ui.input, llm.input);
  assert.deepEqual(ui.input, { ...INPUT, transport: ['train', 'plane'] });
  assert.notEqual(ui.hash, d.build('attend.trip', { input: { ...INPUT, days: 3 }, preset: PRESET }).record.hash);
  assert.notEqual(ui.hash, d.build('attend.trip', { input: INPUT, preset: { ...PRESET, me: '다른 사람' } }).record.hash, '사전설정도 지문에 든다');
});

console.log(`\n통과 ${pass}건`);
