// 입력 명세(input.yaml)와 그것을 쓰는 것들이 어긋나지 않았는지 본다.
//
//   input.yaml  ──(tools/gen-input.mjs)──▶  src/inputspec.js  ──▶  지시문·스키마·관문(src/input.js)
//
// 명세는 손으로 고치는 파일이고 생성물은 커밋돼 있다. 한쪽만 고치면 LLM 이 받는 지시문과
// 관문이 받는 값이 조용히 갈린다 — 여기서 잡는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { render, checkSpec } from '../tools/gen-input.mjs';
import { TASKS, systemPrompt, jsonSchema, structure, structureOf, schemaOf, promptOf, InputError } from '../src/input.js';
import { INPUT_SPEC } from '../src/inputspec.js';
import { RECIPE } from '../src/gmrecipe.js';
import { ACTIONS } from '../actions/spec.js';
import { KINDS, SUBS, FLEX_TIMES, FLEX_MODES, FLEX_DAYS, MAX_TRIP_DAYS, flexTimesFor, normalizePatch } from '../src/attend.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');

console.log('명세와 생성물');
t('src/inputspec.js 는 input.yaml 로 만든 그대로다 (어긋났으면 node tools/gen-input.mjs)', () => {
  assert.equal(read('src/inputspec.js'), render(read('references/input.yaml')));
});
t('명세의 모양이 틀리면 생성기가 거부한다', () => {
  assert.deepEqual(checkSpec({ tasks: TASKS }), []);
  const broken = structuredClone({ tasks: TASKS });
  broken.tasks['search.room'].fields.region.type = 'place';
  broken.tasks['search.room'].checks.push({ left: 'dateFrom', op: '>', right: 'nowhere', message: 'x' });
  broken.tasks['search.car'].variants.car.clear.summary = '필수 칸을 비운다';
  Object.assign(broken.tasks.attend.fields.days, { min: 31, max: 1 });
  const errors = checkSpec(broken).join('\n');
  assert.match(errors, /days: min\(31\)이 max\(1\)보다 큽니다/);
  assert.match(errors, /region: 모르는 형 place/);
  assert.match(errors, /없는 칸\(dateFrom, nowhere\)/);
  assert.match(errors, /모르는 비교 >/);
  assert.match(errors, /필수 칸\(summary\)은 비울 수 없습니다/);
});
t('작업마다 구조를 받는 코드(consumer)가 실제로 있다', () => {
  for (const [name, task] of Object.entries(TASKS)) {
    const src = read(task.consumer.module);
    assert.match(src, new RegExp(`export (async )?function ${task.consumer.export}\\b`), `${name}: ${task.consumer.module} 에 ${task.consumer.export} 가 없다`);
  }
});

console.log('근태 명세는 폼 규칙(src/attend.js)과 같은 값을 말한다');
{
  const f = TASKS.attend.fields;
  const starts = FLEX_TIMES.map((x) => x.start);
  t('종류·갈래·유연근무 방식', () => {
    assert.deepEqual(f.kind.values.slice().sort(), Object.keys(KINDS).sort());
    assert.deepEqual(f.sub.values.slice().sort(), Object.values(SUBS).flat().map((s) => s.value).sort());
    assert.deepEqual(f.flexMode.values, FLEX_MODES.map((m) => m.value));
  });
  t('출근시간 — 요일마다 고를 수 있는 값이 다르다', () => {
    assert.deepEqual(f.flexStart.values, starts);
    for (const d of FLEX_DAYS) assert.deepEqual(f[d.key].values, flexTimesFor(d.wide).map((x) => x.start), d.key);
  });
  t('며칠간의 한도', () => assert.equal(f.days.max, MAX_TRIP_DAYS));
  t('관문을 지난 조각은 폼 쪽 정규화(normalizePatch)가 하나도 버리지 않는다', () => {
    const raw = { kind: 'flex', sub: 'OD', half: 'pm', dateFrom: '2026-10-05', dateTo: '2026-10-06', days: 2, start: '9:00', end: '18:00',
      place: ' 부산 ', purpose: '회의', flexStart: '09:30', flexMode: 'week', flexMon: '07:00', flexTue: '08:00', flexWed: '10:00',
      flexThu: '09:00', flexFri: '11:00', allDay: false, reply: '채웠습니다' };
    const { data, notes } = structure('attend', raw);
    assert.deepEqual(notes, []);
    const { reply, ...patch } = data;
    assert.equal(reply, '채웠습니다');
    assert.deepEqual(normalizePatch(patch), patch);
  });
}

console.log('지시문과 스키마');
t('지시문에는 명세의 칸과 규칙이 모두 들어간다', () => {
  for (const [name, task] of Object.entries(TASKS)) {
    const text = systemPrompt(name);
    for (const key of Object.keys(task.fields)) assert.ok(text.includes(`- ${key} (`), `${name}.${key}`);
    for (const rule of task.rules) assert.ok(text.includes(rule), `${name}: ${rule}`);
    assert.ok(!text.includes('JSON 객체 하나만'), '구조화 출력이 있는 길에는 붙이지 않는다');
    assert.ok(systemPrompt(name, { jsonOnly: true }).includes('JSON 객체 하나만 출력합니다'));
  }
});
t('스키마는 구조화 출력이 받는 말만 쓴다 — 수 범위·글 길이는 넣지 않는다', () => {
  // items 는 목록(list) 칸의 줄 모양이다 — 구조화 출력이 받는다.
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'description', 'enum', 'anyOf', 'items']);
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    for (const [k, v] of Object.entries(node)) {
      if (k !== 'properties') assert.ok(allowed.has(k), `받지 않는 키: ${k}`);
      else for (const p of Object.values(v)) walk(p);
      if (k === 'anyOf' || k === 'items') walk(v);
    }
  };
  for (const name of Object.keys(TASKS)) {
    const schema = jsonSchema(name);
    walk(schema);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, Object.keys(TASKS[name].fields), '모든 키를 받는다(없는 값은 null)');
  }
  // 설명은 칸의 desc(행위 명세에서 만든 작업은 read 가 desc 가 된다) 뒤에 형 이름을 붙인 것이다 — 글은 명세가 정하고 여기서는 꼴만 본다.
  const sf = TASKS['search.room'].fields;
  assert.deepEqual(jsonSchema('search.room').properties.hourFrom, { type: 'integer', description: `${sf.hourFrom.desc} (정수 0~23)` });
  assert.deepEqual(jsonSchema('search.room').properties.region, { anyOf: [{ type: 'string', enum: ['부산', '서울'] }, { type: 'null' }], description: sf.region.desc });
});

console.log('관문');
const FILTER = { dateFrom: '2026-10-05', dateTo: '2026-10-06', hourFrom: 9, hourTo: 18, minSeats: 8, minHours: 2, region: '부산', summary: '10/5~6 부산 8명' };
const problemsOf = (task, raw, ctx) => {
  try { structure(task, raw, ctx); } catch (err) { assert.ok(err instanceof InputError); return err.problems; }
  return assert.fail('던져야 한다');
};
t('맞는 답은 그대로 지난다', () => assert.deepEqual(structure('search.room', FILTER, { kind: 'room' }), { data: FILTER, notes: [] }));
t('객체가 아니면 받지 않는다', () => {
  for (const raw of [null, 'x', 3, [FILTER]]) assert.deepEqual(problemsOf('search.room', raw), ['JSON 객체가 아닙니다']);
});
t('모르는 작업은 받지 않는다', () => assert.deepEqual(problemsOf('reserve', FILTER), ['모르는 작업 reserve']));
t('필수 칸이 없거나 틀리면 통째로 버린다', () => {
  assert.deepEqual(problemsOf('search.room', { ...FILTER, dateTo: undefined }), ['dateTo 가 없습니다']);
  assert.deepEqual(problemsOf('search.room', { ...FILTER, hourFrom: 24 }), ['hourFrom 값(24)이 틀렸습니다']);
  assert.deepEqual(problemsOf('search.room', { ...FILTER, hourTo: 9.5 }), ['hourTo 값(9.5)이 틀렸습니다']);
  assert.deepEqual(problemsOf('search.room', { ...FILTER, summary: '   ' }), ['summary 가 없습니다']);
});
t('달력에 없는 날은 날짜가 아니다', () => {
  assert.deepEqual(problemsOf('search.room', { ...FILTER, dateFrom: '2026-02-30' }), ['dateFrom 값(2026-02-30)이 틀렸습니다']);
  assert.deepEqual(problemsOf('search.room', { ...FILTER, dateFrom: '2026-13-01' }), ['dateFrom 값(2026-13-01)이 틀렸습니다']);
  assert.equal(structure('search.room', { ...FILTER, dateFrom: '2028-02-29', dateTo: '2028-02-29' }).data.dateFrom, '2028-02-29');
});
t('칸 사이의 관계가 어긋나면 통째로 버린다', () => {
  assert.deepEqual(problemsOf('search.room', { ...FILTER, dateTo: '2026-10-04' }), ['종료일이 시작일보다 앞섭니다']);
  assert.deepEqual(problemsOf('search.room', { ...FILTER, hourTo: 9 }), ['종료 시가 시작 시보다 늦어야 합니다']);
  assert.equal(structure('search.room', { ...FILTER, dateTo: FILTER.dateFrom }).data.dateTo, FILTER.dateFrom, '하루짜리는 된다');
});
t('근태의 종료일이 시작일보다 앞서면 종료일만 비우고 알린다', () => {
  const { data, notes } = structure('attend', { kind: 'trip', dateFrom: '2026-10-05', dateTo: '2026-10-01' });
  assert.deepEqual(data, { kind: 'trip', dateFrom: '2026-10-05' });
  assert.deepEqual(notes, ['종료일이 시작일보다 앞서 종료일은 뺐습니다']);
});
t('진단은 정해 둔 판정만 받는다', () => {
  assert.deepEqual(problemsOf('diagnose', { verdict: 'saved', cause: '됐습니다' }), ['verdict 값(saved)이 틀렸습니다']);
  assert.deepEqual(structure('diagnose', { verdict: 'unknown', cause: '근거가 없습니다', siteMessage: '', fix: null }).data,
    { verdict: 'unknown', siteMessage: null, cause: '근거가 없습니다', fix: null });
});
t('긴 글은 한도에서 자른다', () => {
  assert.equal(structure('attend', { purpose: '가'.repeat(500) }).data.purpose.length, 200);
});

console.log('새 형(tags·file·object)·when·실행 모드 — 행위 명세(actions/)의 칸이 지나는 같은 관문(structureOf)');
const SPEC = {
  fields: {
    dateFrom: { type: 'date', required: true, desc: '출발일' },
    dateTo: { type: 'date', desc: '도착일' },
    days: { type: 'integer', min: 1, max: 31, desc: '며칠간' },
    place: { type: 'string', required: true, max: 10, desc: '출장지' },
    settle: { type: 'boolean', desc: '사전정산' },
    transport: { type: 'tags', values: ['train', 'plane', 'bus'], desc: '교통편', when: 'settle' },
    op: { type: 'enum', values: ['save', 'request'], desc: '올리는 길' },
    memo: { type: 'string', desc: '메모', when: 'op!=save' },
    reason: { type: 'string', desc: '사유', when: 'op=save' },
    note: { type: 'string', desc: '비고', when: '!settle' },
    file: { type: 'file', desc: '증빙' },
    setting: { type: 'object', desc: '문서설정', fields: {
      tag: { type: 'string', max: 5, desc: '검색 키워드' },
      emergency: { type: 'boolean', desc: '긴급' },
      attach: { type: 'list', max: 2, desc: '첨부', item: { name: { type: 'string', required: true, desc: '파일 이름' }, kind: { type: 'string', desc: '무엇' } } },
    } },
  },
  checks: [{ left: 'dateFrom', op: '<=', right: 'dateTo', drop: 'dateTo', message: '종료일이 시작일보다 앞서 종료일은 뺐습니다' }],
};
const OK = {
  dateFrom: '2026-10-20', dateTo: '2026-10-21', days: '2', place: ' 대전 ', settle: true, transport: ['plane', 'train'], op: 'request', memo: '메모', reason: '안 씀', note: '안 씀',
  file: { name: 'a.png', type: 'image/png', size: 1234, dataUrl: 'data:image/png;base64,AAAA' }, setting: { tag: '출장', emergency: false, attach: [{ name: 'a.png', kind: '견적서' }] }, extra: 'x',
};
const NORM = {
  dateFrom: '2026-10-20', dateTo: '2026-10-21', days: 2, place: '대전', settle: true, transport: ['train', 'plane'], op: 'request', memo: '메모',
  file: { name: 'a.png', type: 'image/png', size: 1234 }, setting: { tag: '출장', emergency: false, attach: [{ name: 'a.png', kind: '견적서' }] },
};
const strict = (raw, opts) => structureOf(SPEC, raw, { mode: 'execute', ...opts });
const strictProblems = (raw, opts) => {
  try { strict(raw, opts); } catch (err) { assert.ok(err instanceof InputError); return err.problems; }
  return assert.fail('던져야 한다');
};
t('맞는 기록은 두 모드에서 같은 값으로 정규화된다 — 수·시각·공백·tags 차례, 파일은 이름·형식·크기만, 명세에 없는 키와 when 이 거짓인 칸은 빠진다', () => {
  assert.deepEqual(strict(OK), { data: NORM, notes: [] });
  assert.deepEqual(structureOf(SPEC, OK), { data: NORM, notes: [] });
});
t('when — key · !key · key=value · key!=value. 거짓이면 required 도 안 보고 결과에서 뺀다(null 도 안 넣는다). "참" 은 채워졌다는 뜻', () => {
  const { data } = strict({ ...OK, settle: false, op: 'save' });
  assert.deepEqual(Object.keys(data).filter((k) => ['transport', 'note', 'memo', 'reason'].includes(k)), ['reason', 'note']);
  assert.deepEqual([data.note, data.reason], ['안 씀', '안 씀']);
  assert.ok(!('transport' in strict({ ...OK, settle: null }).data) && !('transport' in strict({ ...OK, settle: '' }).data));
  const w = { fields: { a: { type: 'string', required: true, desc: 'a', when: 'b' }, b: { type: 'string', desc: 'b' }, c: { type: 'string', desc: 'c', when: 'n=0' }, n: { type: 'integer', desc: 'n' } } };
  assert.deepEqual(structureOf(w, { b: '' }, { mode: 'execute' }).data, { b: null, n: null }, '조건이 거짓이면 필수도 안 본다');
  assert.throws(() => structureOf(w, { b: 'x' }, { mode: 'execute' }), /a 가 없습니다/);
  assert.deepEqual(structureOf(w, { n: 0, c: 'y' }).data, { b: null, c: 'y', n: 0 }, '0 도 값이고 수 리터럴과 견준다');
  assert.throws(() => structureOf({ fields: { a: { type: 'string', desc: 'a', when: '=x' } } }, { a: '1' }), /when 문법이 틀렸습니다/);
});
t('초안 모드는 비우고 알리고, 실행 모드는 막는다 — 필수 아닌 칸의 틀린 값', () => {
  const { data, notes } = structureOf(SPEC, { ...OK, days: 40 });
  assert.equal(data.days, null);
  assert.deepEqual(notes, ['며칠간 값(40)은 받을 수 없어 뺐습니다']);
  assert.deepEqual(strictProblems({ ...OK, days: 40 }), ['days 값(40)이 틀렸습니다']);
});
t('… checks 의 drop', () => {
  const { data, notes } = structureOf(SPEC, { ...OK, dateTo: '2026-10-01' });
  assert.equal(data.dateTo, null);
  assert.deepEqual(notes, ['종료일이 시작일보다 앞서 종료일은 뺐습니다']);
  assert.deepEqual(strictProblems({ ...OK, dateTo: '2026-10-01' }), ['종료일이 시작일보다 앞서 종료일은 뺐습니다']);
});
t('… 글자 수 한도 — 초안은 자르고 실행은 자르지 않고 막는다', () => {
  assert.equal(structureOf(SPEC, { ...OK, place: '가'.repeat(12) }).data.place, '가'.repeat(10));
  assert.deepEqual(strictProblems({ ...OK, place: '가'.repeat(12) }), ['place 가 10자를 넘습니다(12자)']);
});
t('… tags 의 모르는 값(글이 아닌 것도) — 차례는 values 대로, 겹친 값은 하나로', () => {
  const { data, notes } = structureOf(SPEC, { ...OK, transport: ['ship', 'train', 'train', 7, null] });
  assert.deepEqual(data.transport, ['train']);
  assert.deepEqual(notes, ['교통편 중 받을 수 없는 값(ship, 7)은 뺐습니다']);
  assert.deepEqual(strictProblems({ ...OK, transport: ['ship', 'train'] }), ['transport 에 받을 수 없는 값(ship)이 있습니다']);
  assert.deepEqual(strictProblems({ ...OK, transport: 'train' }), ['transport 값(train)이 틀렸습니다'], '글 하나는 목록이 아니다');
  const req = { fields: { t: { type: 'tags', required: true, desc: 't', values: ['a'] } } };
  assert.throws(() => structureOf(req, { t: ['b'] }), /t 가 비어 있습니다/, '필수 목록이 다 빠져 비면 없는 것과 같다');
  assert.throws(() => structureOf(req, { t: [] }), /t 가 비어 있습니다/);
  assert.deepEqual(structureOf(req, { t: ['b', 'a'] }), { data: { t: ['a'] }, notes: ['t 중 받을 수 없는 값(b)은 뺐습니다'] });
});
t('… variants 의 clear', () => {
  const v = { fields: { minSeats: { type: 'integer', desc: '좌석' } }, variants: { car: { clear: { minSeats: '차량은 좌석 수를 알 수 없어 인원 조건은 뺐습니다' } } } };
  assert.deepEqual(structureOf(v, { minSeats: 8 }, { kind: 'car' }), { data: { minSeats: null }, notes: ['차량은 좌석 수를 알 수 없어 인원 조건은 뺐습니다'] });
  assert.throws(() => structureOf(v, { minSeats: 8 }, { kind: 'car', mode: 'execute' }), /차량은 좌석 수를 알 수 없어/);
  assert.deepEqual(structureOf(v, { minSeats: 8 }, { kind: 'room', mode: 'execute' }).data, { minSeats: 8 });
});
t('file — 이름·형식(·크기)의 참조만 받는다. dataUrl 같은 다른 키는 알림 없이 버리고, 꼴이 아니면 틀린 값이다', () => {
  assert.deepEqual(strict({ ...OK, file: { name: ' b.pdf ', type: 'application/pdf' } }).data.file, { name: 'b.pdf', type: 'application/pdf' });
  for (const bad of ['a.png', { name: 'a.png' }, { name: '', type: 'image/png' }, { name: 'a.png', type: 'image/png', size: 1.5 }, { name: 'a.png', type: 'image/png', size: -1 }, { name: 'a.png', type: 'image/png', size: '3' }]) {
    assert.match(strictProblems({ ...OK, file: bad }).join(), /^file 값\(/);
    const { data, notes } = structureOf(SPEC, { ...OK, file: bad });
    assert.equal(data.file, null);
    assert.equal(notes.length, 1);
  }
});
t('object — 안의 칸은 바깥.안쪽 이름으로 알린다. 안의 목록은 되고, 목록 줄의 틀린 값·줄 수 넘침은 실행 모드에서 problem 이다', () => {
  const bad = { ...OK, setting: { tag: '너무긴키워드', emergency: 'y', attach: [{ kind: '견적서' }, { name: 'b.png', kind: 3 }] } };
  assert.deepEqual(strictProblems(bad), [
    'setting.tag 가 5자를 넘습니다(6자)',
    'setting.emergency 값(y)이 틀렸습니다',
    'setting.attach[0].name 가 없습니다',
    'setting.attach[1].kind 값(3)이 틀렸습니다',
  ]);
  const { data, notes } = structureOf(SPEC, bad);
  assert.deepEqual(data.setting, { tag: '너무긴키워', emergency: null, attach: [{ name: 'b.png', kind: null }] });
  assert.deepEqual(notes, ['긴급 값(y)은 받을 수 없어 뺐습니다', '첨부 중 1줄은 받을 수 없어 뺐습니다']);
  const three = { ...OK, setting: { attach: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } };
  assert.deepEqual(strictProblems(three), ['setting.attach 가 2줄을 넘습니다(3줄)']);
  assert.equal(structureOf(SPEC, three).data.setting.attach.length, 2, '초안 모드는 한도까지만 받는다');
  assert.deepEqual(strictProblems({ ...OK, setting: 'x' }), ['setting 값(x)이 틀렸습니다']);
  assert.deepEqual(strictProblems({ ...OK, setting: { attach: ['x'] } }), ['setting.attach[0] 이 객체가 아닙니다']);
  assert.deepEqual(structureOf({ fields: { o: { type: 'object', desc: 'o' } } }, { o: { any: [1, { deep: true }] } }).data, { o: { any: [1, { deep: true }] } }, 'fields 가 없는 object 는 불투명 객체');
});
t('partial — 비어 있는 칸은 객체 안에서도 뺀다', () => {
  const p = { ...SPEC, partial: true };
  assert.deepEqual(structureOf(p, { dateFrom: '2026-10-20', place: '대전', setting: { tag: 'x' } }).data, { dateFrom: '2026-10-20', place: '대전', setting: { tag: 'x' } });
});
t('structure 의 기본은 초안 모드 — 실행 모드는 옵션으로 켜고, 모르는 모드는 받지 않는다', () => {
  assert.equal(structure('attend', { purpose: '가'.repeat(500) }).data.purpose.length, 200);
  assert.deepEqual(problemsOf('attend', { purpose: '가'.repeat(500) }, { mode: 'execute' }), ['purpose 가 200자를 넘습니다(500자)']);
  assert.deepEqual(problemsOf('search.room', FILTER, { mode: 'strict' }), ['모르는 모드 strict']);
  assert.throws(() => structureOf({ title: '없음' }, {}), /명세에 fields 가 없습니다/);
});
t('스키마 — tags 는 값의 enum 배열, file 은 이름·형식, object 는 안의 칸(모두 구조화 출력이 받는 말만)', () => {
  const schema = schemaOf(SPEC);
  assert.deepEqual(schema.properties.transport, { anyOf: [{ type: 'array', items: { type: 'string', enum: ['train', 'plane', 'bus'] } }, { type: 'null' }], description: '교통편' });
  assert.deepEqual(schema.properties.file, { anyOf: [{ type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' } }, required: ['name', 'type'], additionalProperties: false }, { type: 'null' }], description: '증빙 (파일(이름·형식))' });
  assert.deepEqual(schema.properties.setting.anyOf[0].properties.attach.anyOf[0].items.required, ['name', 'kind']);
  assert.deepEqual(schema.required, Object.keys(SPEC.fields));
  assert.deepEqual(jsonSchema('search.room'), schemaOf(TASKS['search.room']));
});
t('지시문 — 새 형의 설명과 객체 안의 칸이 들여 적힌다', () => {
  const text = promptOf({ ...SPEC, role: 'r', rules: [] });
  assert.match(text, /- transport \("train" \| "plane" \| "bus" 가운데 해당하는 것 모두의 목록 또는 null\): 교통편/);
  assert.match(text, /- file \(파일\(이름·형식\) 또는 null\): 증빙/);
  assert.match(text, /- setting \(객체 — 아래 키 또는 null\): 문서설정\n {4}- tag \(글 또는 null\): 검색 키워드\n {4}- emergency[^\n]*\n {4}- attach \(목록\(2줄까지\)[^\n]*\n {8}- name \(글, 필수\): 파일 이름/);
  assert.equal(promptOf(TASKS['search.room']), systemPrompt('search.room'));
});
t('생성기(checkSpec)는 tags(values)·file·object(한 겹)·when 을 받고, 객체 안의 객체·목록 줄 안의 객체·values 없는 tags·칸 없는 object·틀린 when 은 거부한다', () => {
  const task = (fields) => ({ tasks: { x: { title: 't', role: 'r', next: 'n', kinds: ['x'], consumer: { module: 'm', export: 'e' }, rules: [], fields } } });
  assert.deepEqual(checkSpec(task({
    settle: { type: 'boolean', desc: '사전정산' },
    transport: { type: 'tags', values: ['train'], desc: '교통편', when: 'settle' },
    file: { type: 'file', desc: '증빙' },
    setting: { type: 'object', desc: '설정', fields: { tag: { type: 'string', desc: 't' }, attach: { type: 'list', desc: 'a', item: { name: { type: 'string', desc: 'n', when: '!kind' }, kind: { type: 'string', desc: 'k' } } } } },
  })), []);
  const errors = checkSpec(task({
    a: { type: 'tags', desc: 'a' },
    b: { type: 'object', desc: 'b' },
    c: { type: 'object', desc: 'c', fields: { d: { type: 'object', desc: 'd', fields: { e: { type: 'string', desc: 'e' } } } } },
    f: { type: 'list', desc: 'f', item: { g: { type: 'object', desc: 'g', fields: { h: { type: 'string', desc: 'h' } } } } },
    i: { type: 'string', desc: 'i', when: 'nope' },
    j: { type: 'string', desc: 'j', when: '=x' },
    k: { type: 'object', desc: 'k', fields: { l: { type: 'string', desc: 'l', when: 'i' } } },
  })).join('\n');
  assert.match(errors, /a: tags 는 글로 된 values 가 있어야 합니다/);
  assert.match(errors, /b: 객체는 안의 칸\(fields\)이 있어야 합니다/);
  assert.match(errors, /c\.d: 객체 안에 객체를 둘 수 없습니다/);
  assert.match(errors, /f\.g: 목록의 줄 안에 객체를 둘 수 없습니다/);
  assert.match(errors, /i: when 의 칸\(nope\)이 없습니다/);
  assert.match(errors, /j: when 문법이 틀렸습니다/);
  assert.match(errors, /k\.l: when 의 칸\(i\)이 없습니다/, 'when 의 상대는 같은 자리의 칸이어야 한다');
});
t('TASKS 는 input.yaml·레시피·행위 명세의 작업을 합친 것이다 — 같은 이름이면 행위 명세의 것이 이긴다', () => {
  for (const name of [...Object.keys(INPUT_SPEC.tasks), ...Object.keys(RECIPE.tasks), ...Object.keys(ACTIONS.tasks || {})]) assert.ok(name in TASKS, name);
  for (const [name, task] of Object.entries(ACTIONS.tasks || {})) assert.equal(TASKS[name], task, name);
});

t('무엇이 왜 막혔는지 구조로도 돌려준다(InputError.details) — 행위 층의 빈 곳으로 가는 단추가 쓴다', () => {
  const spec = {
    fields: {
      a: { type: 'string', required: true, desc: 'a' },
      b: { type: 'integer', max: 3, desc: 'b' },
      c: { type: 'list', desc: 'c', item: { n: { type: 'string', required: true, desc: 'n' } } },
      d: { type: 'date', desc: 'd' },
      e: { type: 'date', desc: 'e' },
    },
    checks: [{ left: 'd', op: '<=', right: 'e', message: 'e 가 d 보다 앞섭니다' }],
  };
  let err;
  try { structureOf(spec, { b: 9, c: [{ n: '' }], d: '2026-10-05', e: '2026-10-01' }, { mode: 'execute' }); } catch (e) { err = e; }
  assert.ok(err instanceof InputError);
  assert.deepEqual(err.details, [
    { key: 'a', why: 'missing' }, { key: 'b', why: 'invalid' }, { key: 'c[0].n', why: 'missing' }, { key: 'd', why: 'check', also: 'e' },
  ]);
  assert.equal(err.details.length, err.problems.length);
  // 초안 모드에서 note 로 끝나는 것은 details 에 없다 — 막은 것만 적는다.
  const out = structureOf(spec, { a: 'x', b: 9 }, { mode: 'draft' });
  assert.equal(out.data.b, null);
  assert.equal(out.notes.length, 1);
});

console.log(`\n통과 ${pass}건`);
