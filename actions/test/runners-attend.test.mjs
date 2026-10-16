// 근태 어댑터(actions/runners/attend.js) — 기록을 src/attend.js 의 일감으로 되돌리는 변환이 맞는가.
// buildJob 이 받는 폼이 패널이 주던 폼(settle 한 것, 첨부 바이트까지)과 같다 · op·doc 이 buildJob 의 action·doc 이 된다 · half 의 null/full ↔ '' ·
// ctx.files 에 없는 첨부는 ActionError · attend.doc 의 delete 는 { ok, deleted } · attend.cancel 은 buildCancelJob · ctx.item 이 기록의 문서가 아니면 ActionError.
// HR 은 가짜다 — 실제 사이트에는 아무것도 가지 않는다.
import assert from 'node:assert/strict';

import { createDispatcher } from '../dispatch.js';
import { ACTIONS } from '../spec.js';
import { ActionError } from '../gate.js';
import { registerAttend, formOf } from '../runners/attend.js';
import { blankForm, settle, buildJob, buildDocJob, buildCancelJob, describe } from '../../src/attend.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const TODAY = '2026-10-16';
/** 그 행위의 사전설정 — 명세의 키를 모두 채운다(실행 모드는 키가 없으면 막는다 — 값은 null 이어도 된다). */
const presetFor = (id) => Object.fromEntries(Object.keys(ACTIONS.actions[id].preset).map((k) => [k, k === 'today' ? TODAY : k === 'me' ? '김기현' : null]));
const HR_OK = { ok: true, stage: 'done', docNo: 'D-1', errors: [], dialogs: [], read: { days: '1' } };

/** 패널이 폼에서 기록의 입력을 짓는 것과 같은 길 — 명세의 칸만, 첨부는 참조({ name, type })만. */
function inputOf(form, op, doc = null) {
  const entry = ACTIONS.actions[`attend.${form.kind}`];
  const input = {};
  for (const key of Object.keys(entry.fields)) {
    if (key === 'op' || key === 'doc') continue;
    const v = form[key];
    input[key] = key === 'file' && v ? { name: v.name, type: v.type } : v;
  }
  return { ...input, op, doc };
}

/** 가짜 HR 과 기록하는 가짜 변환 함수를 단 디스패처. */
function make({ hr = async () => HR_OK } = {}) {
  const calls = [];
  const log = [];
  const d = createDispatcher({ spec: ACTIONS, log: (e) => log.push(e), now: () => 1760600000000 });
  registerAttend(d, {
    buildJob: (form, opts) => { calls.push(['buildJob', form, opts]); return buildJob(form, opts); },
    buildDocJob: (item, action) => { calls.push(['buildDocJob', item, action]); return buildDocJob(item, action); },
    buildCancelJob: (item, reason) => { calls.push(['buildCancelJob', item, reason]); return buildCancelJob(item, reason); },
    hrRunJob: async (job, opts) => { calls.push(['hrRunJob', job, opts]); return hr(job); },
    hrDeleteDoc: async (item, opts) => { calls.push(['hrDeleteDoc', item, opts]); return 1; },
  });
  return { d, calls, log };
}
const build = (d, form, op, { doc = null, preset = presetFor(`attend.${form.kind}`) } = {}) => d.build(`attend.${form.kind}`, { input: inputOf(form, op, doc), preset }).record;
const rejects = async (p, re) => {
  try { await p; } catch (err) { assert.ok(err instanceof ActionError, `ActionError 여야 한다: ${err}`); assert.match(err.message, re); return err; }
  return assert.fail('던져야 한다');
};

console.log('attend.apply — buildJob 이 받는 폼은 패널이 주던 폼과 같다');
await ta('출장(사전정산 켬·교통편 둘·특실): 기록 → settle 한 폼 그대로, op 가 action, doc 은 null. hrRunJob 에 onStage 가 간다', async () => {
  const form = settle({ ...blankForm('trip', TODAY), dateFrom: '2026-10-20', days: 2, place: '대전', venue: '한국기계연구원', purpose: '착수회의 참석',
    workplace: '부산', settle: true, transport: ['train', 'plane'], trainGrade: 'first' });
  const { d, calls, log } = make();
  const record = build(d, form, 'request');
  assert.deepEqual([record.input.op, record.input.doc, record.input.dateTo, record.input.transport, record.input.expense], ['request', null, '2026-10-21', ['train', 'plane'], 'Y']);
  const onStage = () => {};
  const r = await d.run(record, { confirmed: record.hash, onStage });
  assert.deepEqual(r, HR_OK);
  assert.deepEqual(calls.map((c) => c[0]), ['buildJob', 'hrRunJob']);
  assert.deepEqual(calls[0][1], form, '폼이 같다');
  assert.deepEqual(calls[0][2], { action: 'request', doc: null });
  assert.deepEqual([calls[1][1].fn, calls[1][1].summary, calls[1][2].onStage], ['apprRequest', describe(form), onStage]);
  assert.deepEqual([log.length, log[0].kind, log[0].ok, log[0].data.result.docNo], [1, 'attend', true, 'D-1']);
});
await ta('외근(교육·임시저장 문서 고치기): 사전정산 칸이 빠진 기록도 빈 폼의 값으로 돌아오고, doc 이 buildJob 의 doc(열 문서)이 된다', async () => {
  const form = settle({ ...blankForm('out', TODAY), sub: 'TR', dateFrom: '2026-10-20', start: '14:00', span: 120, purpose: '교육 참석' });
  const { d, calls } = make();
  const record = build(d, form, 'save', { doc: { docNo: '202610-11115-0002', statusCode: '1' } });
  assert.deepEqual([record.input.end, record.input.place, record.input.carPlace, record.input.expense], ['16:00', null, undefined, 'N'], 'end 는 settle 된 값, place 는 비어 null, 차량 칸은 when 으로 빠졌다');
  await d.run(record, { confirmed: record.hash });
  assert.deepEqual(calls[0][1], form);
  assert.deepEqual(calls[0][2], { action: 'save', doc: { docNo: '202610-11115-0002', statusCode: '1' } });
  assert.deepEqual([calls[1][1].open, calls[1][1].fn], [{ docNo: '202610-11115-0002', statusCode: '1' }, 'saveTrav100'], '임시저장은 그 신청서의 save 함수다');
});
await ta('휴가: 전일은 기록에 half 가 없고(null) 폼에는 빈 값으로, 오전 반차는 am 그대로, LLM 의 full 도 빈 값이다', async () => {
  const full = settle({ ...blankForm('leave', TODAY), sub: 'LY', dateFrom: '2026-10-20', days: 2 });
  const am = settle({ ...blankForm('leave', TODAY), sub: 'LY', dateFrom: '2026-10-20', days: 1, half: 'am' });
  const { d, calls } = make();
  const r1 = build(d, full, 'request');
  const r2 = build(d, am, 'request');
  assert.deepEqual([r1.input.half, r1.input.wfa, r2.input.half], [null, false, 'am']);
  await d.run(r1, { confirmed: r1.hash });
  await d.run(r2, { confirmed: r2.hash });
  assert.deepEqual([calls[0][1], calls[2][1]], [full, am]);
  const llm = d.build('attend.leave', { input: { ...inputOf(am, 'request'), half: 'full' }, preset: presetFor('attend.leave') }).record;
  assert.equal(formOf(llm).half, '');
});
await ta('건강검진의 첨부: 기록에는 이름·형식만 남고, 바이트는 ctx.files 에서 이름으로 이어 buildJob 의 file op 에 들어간다 — 없으면 ActionError 이고 로그는 실패 줄이다', async () => {
  const file = { name: '검진확인서.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' };
  const form = settle({ ...blankForm('health', TODAY), dateFrom: '2026-10-20', allDay: false, start: '09:00', span: 180, purpose: '건강검진', file });
  const { d, calls, log } = make();
  const record = build(d, form, 'request');
  assert.deepEqual(record.input.file, { name: '검진확인서.png', type: 'image/png' });
  assert.equal(JSON.stringify(record).includes('base64'), false, '기록에 바이트가 없다');
  await d.run(record, { confirmed: record.hash, files: [file] });
  assert.deepEqual(calls[0][1], form, '첨부 바이트까지 같은 폼');
  assert.deepEqual(calls[1][1].ops.find((o) => o.op === 'file'), { op: 'file', name: '검진확인서.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA', label: '첨부파일' });
  const again = build(d, form, 'request');
  await rejects(d.run(again, { confirmed: again.hash, files: [{ name: '다른.png', type: 'image/png', dataUrl: 'data:,' }] }), /검진확인서\.png 의 바이트가 ctx\.files 에 없습니다/);
  assert.deepEqual([log.at(-1).ok, log.at(-1).data.result.error.includes('ctx.files')], [false, true]);
  assert.equal(calls.filter((c) => c[0] === 'hrRunJob').length, 1, '잇지 못하면 HR 로 가지 않는다');
});
await ta('유연근무(주간): 요일 칸만 기록에 있고 당일 칸(날짜·출근시간·사유)은 빠진다 — 폼은 빈 값으로 돌아온다', async () => {
  const form = settle({ ...blankForm('flex', TODAY), flexMode: 'week', flexMon: '08:00', flexTue: '09:00', flexWed: '09:30', flexThu: '10:00', flexFri: '08:30' });
  const { d, calls } = make();
  const record = build(d, form, 'request');
  assert.deepEqual([record.input.flexMode, record.input.flexMon, 'dateFrom' in record.input, 'flexStart' in record.input, 'purpose' in record.input], ['week', '08:00', false, false, false]);
  await d.run(record, { confirmed: record.hash });
  assert.deepEqual(calls[0][1], form);
});
await ta('HR 이 완료했다고 답하지 않으면(ok false) 결과는 그대로 돌아오고 로그의 ok 는 false 다 — 던지지 않는다', async () => {
  const form = settle({ ...blankForm('leaveout', TODAY), dateFrom: '2026-10-20', start: '14:00', span: 60, purpose: '병원' });
  const { d, log } = make({ hr: async () => ({ ok: false, stage: 'fill', errors: ['값이 안 들어감'], dialogs: [], read: {} }) });
  const record = build(d, form, 'request');
  const r = await d.run(record, { confirmed: record.hash });
  assert.deepEqual([r.ok, log[0].ok, log[0].data.result.stage], [false, false, 'fill']);
});
t('관문: 필수 칸(목적)이 비면 기록을 짓지 못한다 — buildJob 보다 먼저 막힌다', () => {
  const form = settle({ ...blankForm('trip', TODAY), dateFrom: '2026-10-20', place: '대전' });
  const { d, calls } = make();
  assert.throws(() => build(d, form, 'request'), (err) => err instanceof ActionError && /purpose 가 없습니다/.test(err.message));
  assert.deepEqual(calls, []);
});

console.log('attend.doc · attend.cancel — 신청 내역의 줄(ctx.item)은 기록의 문서여야 한다');
const ITEM = { docNo: '202610-11115-0002', formId: 'TRO', status: '1', statusName: '임시저장', summary: '외근 10/20 14:00~16:00 · 교육', from: '2026-10-20' };
await ta('상신(request)·회수(recall)는 buildDocJob(item, action) → hrRunJob, 삭제는 hrDeleteDoc 을 { ok: true, deleted: n } 로 감싼다', async () => {
  const { d, calls, log } = make();
  const req = d.build('attend.doc', { input: { docNo: ITEM.docNo, formId: 'TRO', action: 'request' }, preset: presetFor('attend.doc') }).record;
  assert.deepEqual(await d.run(req, { confirmed: req.hash, item: ITEM, onStage: () => {} }), HR_OK);
  assert.deepEqual([calls[0][0], calls[0][1], calls[0][2], calls[1][1].fn, calls[1][1].open], ['buildDocJob', ITEM, 'request', 'apprRequest', { docNo: ITEM.docNo, statusCode: '1' }]);
  const del = d.build('attend.doc', { input: { docNo: ITEM.docNo, formId: 'TRO', action: 'delete' }, preset: presetFor('attend.doc') }).record;
  assert.deepEqual(await d.run(del, { confirmed: del.hash, item: ITEM }), { ok: true, deleted: 1 });
  assert.deepEqual([calls.at(-1)[0], calls.at(-1)[1], log.at(-1).ok, log.at(-1).data.result.deleted], ['hrDeleteDoc', ITEM, true, 1]);
});
await ta('취소신청은 buildCancelJob(item, reason) → hrRunJob — 사유가 일감에 들어간다', async () => {
  const { d, calls } = make();
  const item = { ...ITEM, formId: 'TR', status: '5', statusName: '결재완료' };
  const rec = d.build('attend.cancel', { input: { docNo: item.docNo, formId: 'TR', reason: '일정 변경' }, preset: presetFor('attend.cancel') }).record;
  await d.run(rec, { confirmed: rec.hash, item });
  assert.deepEqual([calls[0][0], calls[0][2], calls[1][1].ops[0].op, calls[1][1].ops[0].reason, calls[1][1].ops[0].docNo], ['buildCancelJob', '일정 변경', 'cancelRow', '일정 변경', item.docNo]);
});
await ta('ctx.item 의 문서번호가 기록과 다르면 ActionError — HR 로 가지 않는다', async () => {
  const { d, calls } = make();
  const rec = d.build('attend.doc', { input: { docNo: ITEM.docNo, formId: 'TRO', action: 'request' }, preset: presetFor('attend.doc') }).record;
  await rejects(d.run(rec, { confirmed: rec.hash, item: { ...ITEM, docNo: '다른 문서' } }), /문서번호\(다른 문서\)가 기록의 202610-11115-0002 와 다릅니다/);
  await rejects(d.run(rec, { confirmed: rec.hash }), /문서번호\(없음\)/);
  assert.deepEqual(calls, []);
});

console.log(`\n통과 ${pass}건`);
