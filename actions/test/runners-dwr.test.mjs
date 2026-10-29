// 일일 업무 어댑터(actions/runners/dwr.js) — 기록(dwr.write) → 작성기(src/dwrwrite.js)의 writeDay 인자 · 카드가 넘긴 작성기(ctx.writer)를 쓰고 닫지 않는다 ·
// 없으면 여기서 열고 그 한 날 뒤에 닫는다 · ok 판정(결과의 ok — 이미 적은 날은 ok false) · 확인 없이는 돌지 않는다 · 관문이 칸을 막는다(2026-10-29).
//
// 명세는 생성물(actions/spec.js)의 진짜 dwr.write 를 쓴다 — 칸 이름이 어긋나면 여기서 드러난다.
import assert from 'node:assert/strict';

import { ACTIONS } from '../spec.js';
import { createDispatcher } from '../dispatch.js';
import { ActionError } from '../gate.js';
import { registerDwr } from '../runners/dwr.js';

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const NOW = 1761700000000;
const PRESET = { today: '2026-10-29', me: '김기현' };
const INPUT = { date: '2026-10-01', title: 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발', label: 'SSCB', hours: 8, content: 'MVDC 시험기준 분석', trip: false, op: 'save' };

/** 가짜 작성기 — writeDay 의 인자와 close 를 적는다. */
const fakeWriter = (result = { ok: true, status: 'saved', row: '8', rowName: INPUT.title, note: '' }) => {
  const w = { calls: [], closed: 0 };
  w.writeDay = async (day, opts) => { w.calls.push([day, opts]); if (result instanceof Error) throw result; return result; };
  w.close = async () => { w.closed++; };
  return w;
};

await ta('명세 — 일일 업무 갈래의 쓰기 하나, 확인이 있어야 돌고 실행기는 dwr.write. 활동 로그 kind 는 dwr', async () => {
  const e = ACTIONS.actions['dwr.write'];
  assert.equal(e.confirm, true);
  assert.equal(e.runner, 'dwr.write');
  assert.equal(e.status || 'live', 'live');
  assert.equal(ACTIONS.domains.dwr.log, 'dwr');
  assert.deepEqual(Object.keys(e.fields), ['date', 'title', 'label', 'hours', 'content', 'trip', 'op']);
});

await ta('카드가 넘긴 작성기로 그 날을 쓴다 — 칸 그대로(label 은 기록·로그에만), 작성기는 닫지 않는다(카드가 다 쓰고 닫는다). 결과는 그대로, 로그 한 줄', async () => {
  const log = [];
  const d = createDispatcher({ spec: ACTIONS, log: (e) => log.push(e), now: () => NOW });
  registerDwr(d, { createDwrWriter: () => assert.fail('카드의 작성기가 있으면 새로 열지 않는다') });
  const w = fakeWriter();
  const { record } = d.build('dwr.write', { input: INPUT, preset: PRESET });
  const stages = [];
  const r = await d.run(record, { confirmed: record.hash, writer: w, onStage: (s) => stages.push(s), text: '일일 업무 10/1 SSCB 8시간 저장' });
  assert.deepEqual(r, { ok: true, status: 'saved', row: '8', rowName: INPUT.title, note: '' });
  const { label, ...day } = INPUT;
  assert.deepEqual(w.calls[0][0], day);
  assert.equal(w.calls[0][1].dry, false);
  w.calls[0][1].onStage('저장 중…');
  assert.deepEqual(stages, ['저장 중…']);
  assert.equal(w.closed, 0);
  assert.deepEqual([log.length, log[0].kind, log[0].ok, log[0].text, log[0].data.record.action], [1, 'dwr', true, '일일 업무 10/1 SSCB 8시간 저장', 'dwr.write']);
});

await ta('작성기가 없으면 어댑터가 하나 열고 그 한 날 뒤에 닫는다(던져도). 이미 적은 날은 ok false 로 남고 던지지 않는다', async () => {
  const log = [];
  const d = createDispatcher({ spec: ACTIONS, log: (e) => log.push(e), now: () => NOW });
  const made = [];
  let next = fakeWriter({ ok: false, status: 'exists', row: '8', rowName: INPUT.title, note: '그 날 이미 적은 업무가 있어 쓰지 않았습니다' });
  registerDwr(d, { createDwrWriter: () => { made.push(next); return next; } });
  const { record } = d.build('dwr.write', { input: { ...INPUT, op: 'submit' }, preset: PRESET });
  const r = await d.run(record, { confirmed: record.hash });
  assert.equal(r.status, 'exists');
  assert.deepEqual([made.length, made[0].closed, made[0].calls[0][0].op], [1, 1, 'submit']);
  assert.equal(log.at(-1).ok, false);
  next = fakeWriter(new Error('작성 화면의 업무 목록에 "x" 이 없습니다'));
  await assert.rejects(d.run(record, { confirmed: record.hash }), /업무 목록/);
  assert.deepEqual([made.length, made[1].closed], [2, 1]);
  assert.equal(log.at(-1).ok, false);
  assert.match(log.at(-1).data.result.error, /업무 목록/);
});

await ta('확인 없이는 돌지 않는다 · 관문 — 날짜·업무명·내용·시간이 없거나 시간이 24 를 넘거나 op 가 모르는 것이면 막는다', async () => {
  const d = createDispatcher({ spec: ACTIONS, now: () => NOW });
  registerDwr(d, { createDwrWriter: () => fakeWriter() });
  const { record } = d.build('dwr.write', { input: INPUT, preset: PRESET });
  await assert.rejects(d.run(record, {}), (err) => err instanceof ActionError && /확인 없이/.test(err.message));
  for (const bad of [{ date: '' }, { title: '' }, { content: '' }, { hours: 30 }, { op: 'delete' }]) {
    assert.throws(() => d.build('dwr.write', { input: { ...INPUT, ...bad }, preset: PRESET }), ActionError, JSON.stringify(bad));
  }
});

console.log(`\n통과 ${pass}건`);
