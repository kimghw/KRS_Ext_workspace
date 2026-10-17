// 행위 명세(actions/spec)와 그것으로 만든 것들이 어긋나지 않았는지 본다.
//
//   actions/spec/**.yaml  ──(tools/gen-actions.mjs)──▶  actions/spec.js  ──▶  관문·디스패처(actions/*.js) · LLM 작업(src/input.js 의 TASKS)
//
// 명세는 손으로 고치는 파일이고 생성물은 커밋돼 있다. 한쪽만 고치면 기록의 꼴과 LLM 이 받는 지시문이 조용히 갈린다 — 여기서 잡는다.
// 1단계 호환(docs/actions-design.md §3.4): 생성된 attend 작업은 references/input.yaml 의 attend 작업과, search.room 은 parse 와 같은 칸이어야 한다 —
// 그 작업들을 통합자가 input.yaml 에서 지우므로 지금 모습을 fixtures/tasks-before.json 에 박아 두고 그것과 맞춘다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { readActions, checkActions, buildActions, build, render, RUNNERS, toYaml, exampleRecord, parseFrom, recipeDraftFields } from '../../tools/gen-actions.mjs';
import { ACTIONS } from '../spec.js';
import { promptOf, schemaOf } from '../../src/input.js';
import { KINDS, SUBS, FLEX_TIMES, FLEX_DAYS, flexTimesFor, MAX_TRIP_DAYS, DEFAULT_START, blankForm, fieldsFor, FORMS, CANCEL_FORMS } from '../../src/attend.js';
import { TRANSPORTS, DEFAULT_TRANSPORT, TRAIN_GRADES, DEFAULT_GRADE } from '../../src/travel.js';
import { REASONS, RELATIONS, CASH_KINDS } from '../../src/welfare.js';
import { RECIPE } from '../../src/gmrecipe.js';
import { settingPatch } from '../../src/gongmun.js';
import { KIND_LABEL } from '../../src/logbook.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const root = new URL('../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const cwd = fileURLToPath(root);
const cli = (...args) => spawnSync(process.execPath, ['tools/gen-actions.mjs', ...args], { cwd, encoding: 'utf8' });
const before = JSON.parse(read('actions/test/fixtures/tasks-before.json'));
const MINE = ['room', 'car', 'attend'];
const TODAY = '2026-10-16';
const actionsOf = (domain) => Object.values(ACTIONS.actions).filter((a) => a.domain === domain);

console.log('명세와 생성물');
t('actions/spec.js 는 actions/spec 으로 만든 그대로다 (어긋났으면 node tools/gen-actions.mjs)', () => {
  assert.equal(read('actions/spec.js'), render());
});
t('node tools/gen-actions.mjs --check 가 0 으로 끝난다', () => {
  const r = cli('--check');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /같습니다/);
});
t('생성물의 꼴 — 갈래마다 kinds 차례대로 행위가 있고 id 는 <갈래>.<종류> 다', () => {
  assert.equal(ACTIONS.version, 1);
  for (const d of MINE) assert.ok(ACTIONS.domains[d], d);
  for (const [name, dom] of Object.entries(ACTIONS.domains)) {
    assert.equal(dom.domain, name);
    assert.deepEqual(actionsOf(name).map((a) => a.kind), dom.kinds, `${name} 의 행위 차례`);
    for (const a of actionsOf(name)) {
      assert.equal(a.id, `${name}.${a.kind}`);
      for (const k of ['title', 'status', 'confirm', 'effect', 'log', 'preset', 'fields', 'checks', 'rules', 'llm', 'uses', 'then']) assert.ok(k in a, `${a.id}.${k}`);
      assert.ok(Object.keys(a.fields).length, `${a.id} 의 칸`);
    }
  }
});
t('모든 칸(중첩 포함)에 desc 와 read 가 있다 — 사용자 지정: 사람이 적는 칸도 나중에 LLM 을 넣을 수 있게', () => {
  const walk = (where, fields) => {
    for (const [key, f] of Object.entries(fields)) {
      assert.ok(typeof f.desc === 'string' && f.desc.trim(), `${where}.${key} desc`);
      assert.ok(typeof f.read === 'string' && f.read.trim(), `${where}.${key} read`);
      if (f.item) walk(`${where}.${key}.item`, f.item);
      if (f.fields) walk(`${where}.${key}.fields`, f.fields);
    }
  };
  for (const a of Object.values(ACTIONS.actions)) {
    walk(a.id, a.fields);
    for (const [key, f] of Object.entries(a.fields)) { assert.equal(typeof f.llm, 'boolean', `${a.id}.${key}.llm`); assert.equal(typeof f.ui, 'boolean', `${a.id}.${key}.ui`); }
  }
});

console.log('명세 검사 — 틀린 것을 잡는다');
/** 작은 명세 한 벌 — 실제 파일과 상관없이 검사를 시험한다. 갈래 x 는 merged 모드의 종류 둘(one·two). */
const mini = () => ({
  errors: [],
  domains: {
    x: {
      domain: {
        domain: 'x', title: '엑스', log: 'reserve', kinds: ['one', 'two'],
        preset: { me: { from: 'me', desc: '나' } },
        llm: {
          task: 'x', mode: 'merged', partial: true, input: 'attend', title: '엑스 조각', consumer: { module: 'src/attend.js', export: 'applyPatch' },
          next: '다음', role: '당신은 엑스입니다.', rules: ['갈래의 규칙'], fields: { reply: { type: 'string', max: 300, desc: '답', read: '답 한 줄', ui: false } },
        },
      },
      kinds: {
        one: {
          id: 'x.one', title: '하나', hint: '일', summary: '{when} {preset.me}',
          fields: {
            when: { type: 'date', required: true, desc: '날', read: '날짜', example: '2026-10-20' },
            note: { type: 'string', max: 10, desc: '메모', read: '메모 글', llm: false },
            flag: { type: 'boolean', desc: '깃발', read: '깃발', llm: false },
          },
          checks: [{ left: 'when', op: '<=', right: 'when', message: '같은 날' }],
          rules: ['하나의 규칙'], runner: 'booking.search', uses: [{ module: 'src/runners.js', export: 'RUNNERS' }], then: [{ action: 'x.two', when: 'flag' }],
        },
        two: {
          id: 'x.two', title: '둘', hint: '이',
          fields: { when: { type: 'date', desc: '날', read: '둘의 날짜' }, count: { type: 'integer', min: 1, max: 5, desc: '수', read: '몇 개', example: 3 } },
          runner: 'booking.reserve', uses: [{ module: 'src/runners.js', export: 'RUNNERS' }],
        },
      },
    },
  },
});
const errorsOf = (mutate) => { const raw = mini(); mutate(raw.domains.x); return checkActions(raw).join('\n'); };
t('맞는 명세는 검사와 만들기를 지난다 — merged 작업은 kind + 합집합 + 갈래 칸, 규칙은 갈래 먼저', () => {
  const raw = mini();
  assert.deepEqual(checkActions(raw), []);
  const { spec, errors } = buildActions(raw);
  assert.deepEqual(errors, []);
  const task = spec.tasks.x;
  assert.deepEqual(Object.keys(task.fields), ['kind', 'when', 'note', 'flag', 'count', 'reply'].filter((k) => !['note', 'flag'].includes(k)));
  assert.deepEqual(task.fields.kind, { type: 'enum', label: '엑스 종류', desc: '엑스 종류. one(일)·two(이)', values: ['one', 'two'] });
  assert.deepEqual([task.fields.when.label, task.fields.count.label, task.fields.reply.label], ['날', '수', '답']);
  assert.equal(task.fields.when.desc, '종류별 — one: 날짜 (예: 2026-10-20); two: 둘의 날짜');
  assert.equal(task.fields.when.required, undefined, 'partial 이면 required 가 없다');
  assert.equal(task.fields.count.desc, '몇 개 (예: 3)');
  assert.deepEqual(task.rules, ['갈래의 규칙', '종류가 one(일)일 때: 하나의 규칙']);
  assert.deepEqual(task.kinds, ['x']);
  assert.equal(task.partial, true);
  assert.deepEqual(spec.actions['x.one'].preset, { me: { from: 'me', desc: '나' } });
  assert.equal(spec.actions['x.one'].task, 'x');
  assert.equal(spec.actions['x.one'].fields.note.llm, false);
});
t('id 와 파일 자리 · 모르는 형 · read 없음 · runner 없음 · 등록되지 않은 runner', () => {
  assert.match(errorsOf((x) => { x.kinds.one.id = 'x.uno'; }), /x\/one\.yaml: id\(x\.uno\)는 x\.one 여야 합니다/);
  assert.match(errorsOf((x) => { x.kinds.two.fields.count.type = 'place'; }), /two\.yaml fields count: 모르는 형 place/);
  assert.match(errorsOf((x) => { delete x.kinds.one.fields.note.read; }), /fields note: read\(LLM 에게 가는 인라인 프롬프트\)가 비어 있습니다/);
  assert.match(errorsOf((x) => { delete x.kinds.one.fields.note.desc; }), /fields note: desc/);
  assert.match(errorsOf((x) => { delete x.kinds.one.runner; }), /live 행위는 runner/);
  assert.match(errorsOf((x) => { x.kinds.one.runner = 'booking.fly'; }), /runner booking\.fly 는 등록되는 실행기가 아닙니다/);
  assert.doesNotMatch(errorsOf((x) => { delete x.kinds.one.runner; x.kinds.one.status = 'planned'; }), /runner/, 'planned 는 runner 가 없어도 된다');
});
t('uses 의 없는 export · then 의 없는 행위(갈래 폴더가 없으면 묻지 않는다) · summary 의 없는 칸', () => {
  assert.match(errorsOf((x) => { x.kinds.one.uses = [{ module: 'src/runners.js', export: 'nothing' }]; }), /src\/runners\.js 에 nothing 가 없습니다/);
  assert.match(errorsOf((x) => { x.kinds.one.uses = [{ module: 'src/nowhere.js', export: 'RUNNERS' }]; }), /src\/nowhere\.js 파일이 없습니다/);
  assert.match(errorsOf((x) => { x.kinds.one.uses = []; }), /uses\(실행 경로/);
  assert.match(errorsOf((x) => { x.kinds.one.then = [{ action: 'x.three' }]; }), /then 의 x\.three 은 없는 행위입니다/);
  assert.equal(errorsOf((x) => { x.kinds.one.then = [{ action: 'zz.later' }]; }), '', '아직 없는 갈래의 행위는 넘어간다');
  assert.match(errorsOf((x) => { x.kinds.one.then = [{ action: 'x.two', when: 'nope' }]; }), /then x\.two: when\(nope\)의 nope 은 같은 fields 에 없는 칸/);
  assert.match(errorsOf((x) => { x.kinds.one.summary = '{nope} {preset.you}'; }), /summary 의 \{nope\} 가 fields 에 없습니다/);
  assert.match(errorsOf((x) => { x.kinds.one.summary = '{nope} {preset.you}'; }), /summary 의 \{preset\.you\} 가 사전설정에 없습니다/);
});
t('사전설정 — from 과 value 가운데 하나 · from 문법 · 레시피 경로 · object 의 fields', () => {
  assert.match(errorsOf((x) => { x.domain.preset.me = { from: 'me', value: '나', desc: '나' }; }), /preset me: from 과 value 가운데 하나만/);
  assert.match(errorsOf((x) => { x.domain.preset.me = { from: 'db:x', desc: '나' }; }), /from\(db:x\)은 today · me · storage:<키>/);
  assert.match(errorsOf((x) => { x.domain.preset.p = { from: 'recipe:settings.profiles.없음', desc: '없음' }; }), /레시피\(src\/gmrecipe\.js RECIPE\)에 없습니다/);
  assert.equal(errorsOf((x) => { x.domain.preset.p = { from: 'recipe:settings.profiles.연구품의', type: 'object', desc: '프로파일' }; }), '');
  assert.match(errorsOf((x) => { x.domain.preset.s = { from: 'storage:gongmunPreset', desc: '설정', fields: { dept: { type: 'string', desc: '부서', read: '부서' } } }; }), /fields 는 type: object 인 사전설정에만/);
  assert.equal(errorsOf((x) => { x.domain.preset.s = { from: 'storage:gongmunPreset', type: 'object', required: true, desc: '설정', fields: { dept: { type: 'string', desc: '부서', read: '부서' } } }; }), '');
  assert.deepEqual(parseFrom('storage:gongmunPreset.head'), { source: 'storage', key: 'gongmunPreset', path: ['head'] });
  assert.deepEqual(parseFrom('ctx:hrMe'), { source: 'ctx', key: 'hrMe', path: [] });
  assert.throws(() => parseFrom('me:x'), /from\(me:x\)/);
});
t('칸 — when 문법 · 한 겹(목록 안의 목록·객체 안의 객체) · tags/file/object 는 작업에 못 들어간다 · drop · ignore', () => {
  assert.match(errorsOf((x) => { x.kinds.one.fields.note.when = 'nope'; }), /when\(nope\)의 nope 은 같은 fields 에 없는 칸/);
  assert.match(errorsOf((x) => { x.kinds.one.fields.note.when = 'flag=maybe'; }), /flag 은 true·false 칸입니다/);
  assert.match(errorsOf((x) => { x.kinds.one.fields.note.when = 'note'; }), /자기 자신을 가리킵니다/);
  assert.equal(errorsOf((x) => { x.kinds.one.fields.note.when = '!flag'; x.kinds.one.fields.when.when = 'flag=true'; }), '');
  assert.match(errorsOf((x) => { x.kinds.one.fields.rows = { type: 'list', desc: '줄', read: '줄', llm: false, item: { more: { type: 'list', desc: '안', read: '안', item: { a: { type: 'string', desc: 'a', read: 'a' } } } } }; }), /목록 안에 목록을 둘 수 없습니다/);
  assert.match(errorsOf((x) => { x.kinds.one.fields.rows = { type: 'list', desc: '줄', read: '줄', llm: false, item: { more: { type: 'object', desc: '안', read: '안', fields: { a: { type: 'string', desc: 'a', read: 'a' } } } } }; }), /목록의 줄 안에 객체를 둘 수 없습니다/);
  assert.match(errorsOf((x) => { x.kinds.one.fields.tags = { type: 'tags', values: ['a'], desc: '태그', read: '태그' }; }), /tags 칸은 1단계에서 LLM 작업에 넣지 않습니다/);
  assert.equal(errorsOf((x) => { x.kinds.one.fields.tags = { type: 'tags', values: ['a'], desc: '태그', read: '태그', llm: false, default: ['a'] }; }), '');
  assert.match(errorsOf((x) => { x.kinds.one.fields.tags = { type: 'tags', values: ['a'], desc: '태그', read: '태그', llm: false, default: ['b'] }; }), /default\(\["b"\]\)은 values 의 값으로 된 목록/);
  // values 없는 tags 는 자유 글의 목록이다(공문 첨부 줄의 파일 이름들).
  assert.equal(errorsOf((x) => { x.kinds.one.fields.names = { type: 'tags', desc: '이름들', read: '이름들', llm: false, default: ['a.pdf', 'b.png'] }; }), '');
  assert.match(errorsOf((x) => { x.kinds.one.fields.names = { type: 'tags', desc: '이름들', read: '이름들', llm: false, default: [1] }; }), /default\(\[1\]\)은 글의 목록이어야 합니다/);
  assert.match(errorsOf((x) => { x.kinds.one.fields.opaque = { type: 'object', desc: '안', read: '안', llm: false }; }), /객체 칸은 from\(펼칠 것\) 과 fields\(안의 칸\) 가운데 하나를 둡니다/);
  assert.match(errorsOf((x) => { x.kinds.one.fields.when.example = '2026-02-30'; }), /example\("2026-02-30"\)은 YYYY-MM-DD 날짜/);
  assert.match(errorsOf((x) => { x.kinds.two.fields.count.drop = '뺐습니다'; }), /drop 은 per-kind 모드에서/);
  assert.match(errorsOf((x) => { x.kinds.one.ignore = { note: '화면 전용' }; }), /ignore 의 note 가 fields 에도 있습니다/);
  assert.match(errorsOf((x) => { x.kinds.one.fields['bad key'] = { type: 'string', desc: 'x', read: 'x' }; }), /칸 이름\(bad key\)/);
  assert.match(errorsOf((x) => { x.kinds.one.fields.when['sHour. 첫날'] = null; }), /쉼표가 있어 키로 읽혔습니다/);
});
t('갈래의 llm — 모드별 종류 llm 의 꼴 · per-kind 는 종류가 작업 이름을 적는다 · recipe 모드는 레시피 작업과 fills 를 본다', () => {
  const perKind = (x) => { x.domain.llm.mode = 'per-kind'; delete x.domain.llm.partial; x.kinds.two.llm = false; };
  assert.match(errorsOf((x) => { perKind(x); }), /per-kind 모드에서 LLM 을 켠 종류는 llm: \{ task: <작업 이름> \}/);
  assert.equal(errorsOf((x) => { perKind(x); x.kinds.one.llm = { task: 'x.one' }; }), '');
  assert.equal(errorsOf((x) => { x.domain.llm = { mode: 'none' }; }), '', 'none 모드의 종류는 llm 을 안 적으면 꺼진 것이다');
  assert.match(errorsOf((x) => { x.domain.llm = { mode: 'none' }; x.kinds.one.llm = true; }), /갈래의 llm\.mode 가 none 라 llm 은 false 뿐/);
  assert.match(errorsOf((x) => { x.domain.llm = { mode: 'recipe' }; x.kinds.one.llm = false; x.kinds.two.llm = { tasks: [{ task: 'gongmun.none', fills: 'draft' }] }; }), /gongmun\.none 가 레시피의 작업\(RECIPE\.tasks\)에 없습니다/);
  assert.match(errorsOf((x) => { x.domain.llm = { mode: 'recipe' }; x.kinds.one.llm = false; x.kinds.two.llm = { tasks: [{ task: 'gongmun.purchase', fills: 'draft' }] }; }), /fills\(draft\)가 fields 에 없습니다/);
  assert.match(errorsOf((x) => { x.domain.llm.mode = 'magic'; }), /모르는 mode magic/);
  assert.match(errorsOf((x) => { x.domain.kinds = ['one']; }), /x\/two\.yaml 이 kinds 에 없습니다/);
  assert.match(errorsOf((x) => { x.domain.kinds = ['one', 'two', 'three']; }), /kinds 의 three 파일/);
});
t('merged 에서 같은 키는 type·min·max 가 같아야 한다(enum 은 values 합집합) — 만들기가 잡는다', () => {
  const raw = mini();
  raw.domains.x.kinds.two.fields.when.type = 'string';
  assert.match(buildActions(raw).errors.join('\n'), /two\.yaml fields when: 같은 키의 형이 다릅니다\(one: date, two: string\)/);
  const raw2 = mini();
  raw2.domains.x.kinds.one.fields.count = { type: 'integer', min: 1, max: 9, desc: '수', read: '수' };
  assert.match(buildActions(raw2).errors.join('\n'), /같은 키의 max 이 다릅니다\(one: 9, two: 5\)/);
  const raw3 = mini();
  raw3.domains.x.kinds.one.fields.pick = { type: 'enum', values: ['a', 'b'], desc: '고름', read: '고름' };
  raw3.domains.x.kinds.two.fields.pick = { type: 'enum', values: ['b', 'c'], desc: '고름', read: '고름' };
  assert.deepEqual(buildActions(raw3).spec.tasks.x.fields.pick.values, ['a', 'b', 'c']);
});

console.log('실행기와 활동 로그');
t('live 행위의 runner 는 §6.6 의 등록 목록에 있다', () => {
  for (const a of Object.values(ACTIONS.actions)) {
    if (a.status !== 'live') continue;
    assert.ok(RUNNERS.includes(a.runner), `${a.id}: ${a.runner}`);
  }
});
t('회의실·차량·근태 행위의 활동 로그 kind 는 src/logbook.js KIND_LABEL 에 있다', () => {
  for (const d of MINE) for (const a of actionsOf(d)) assert.ok(a.log in KIND_LABEL, `${a.id}: ${a.log}`);
});
t('조회(search)만 확인 없이 돌고 effect 가 none 이다 — 쓰기 행위는 confirm 이다', () => {
  for (const d of ['room', 'car']) {
    assert.deepEqual([ACTIONS.actions[`${d}.search`].confirm, ACTIONS.actions[`${d}.search`].effect, ACTIONS.actions[`${d}.search`].runner], [false, 'none', 'booking.search']);
    for (const k of ['reserve', 'cancel', 'modify']) assert.deepEqual([ACTIONS.actions[`${d}.${k}`].confirm, ACTIONS.actions[`${d}.${k}`].effect, ACTIONS.actions[`${d}.${k}`].runner], [true, 'write', `booking.${k}`], `${d}.${k}`);
  }
  for (const k of ['trip', 'out', 'flex', 'leaveout', 'leave', 'health']) assert.equal(ACTIONS.actions[`attend.${k}`].runner, 'attend.apply');
  assert.equal(ACTIONS.actions['attend.cancel'].runner, 'attend.cancel');
  assert.equal(ACTIONS.actions['attend.doc'].runner, 'attend.doc');
  assert.equal(ACTIONS.actions['attend.welfare'].status, 'planned');
});

console.log('1단계 호환 — 생성된 작업은 input.yaml 의 작업과 같은 칸이다(fixtures/tasks-before.json)');
const same = (a, b, where, { requiredToo = true } = {}) => {
  assert.equal(a.type, b.type, `${where} type`);
  if (a.type === 'enum') assert.deepEqual(a.values, b.values, `${where} values`);
  assert.equal(a.min, b.min, `${where} min`);
  assert.equal(a.max, b.max, `${where} max`);
  if (requiredToo) assert.equal(!!a.required, !!b.required, `${where} required`);
};
t('attend = input.yaml 의 attend (키·형·values·min·max 같음, required 는 모두 없음, partial)', () => {
  const task = ACTIONS.tasks.attend;
  const was = before.attend;
  assert.deepEqual(Object.keys(task.fields).sort(), Object.keys(was.fields).sort());
  for (const key of Object.keys(was.fields)) {
    const [a, b] = [task.fields[key], was.fields[key]];
    if (key === 'kind') { assert.equal(a.type, 'enum'); assert.deepEqual([...a.values].sort(), [...b.values].sort()); continue; }   // 종류 차례는 화면 차례(KIND_ORDER)다
    same(a, b, key, { requiredToo: false });
    assert.equal(a.required, undefined, `${key} 는 partial 이라 required 가 없다`);
  }
  assert.deepEqual(task.checks, was.checks);
  assert.equal(task.partial, true);
  assert.deepEqual(task.kinds, ['attend']);
  assert.deepEqual(task.consumer, { module: 'src/attend.js', export: 'applyPatch' });
  assert.equal(task.variants, undefined);
});
t('search.room = input.yaml 의 parse (같은 칸·같은 차례·같은 checks)', () => {
  const task = ACTIONS.tasks['search.room'];
  const was = before.parse;
  assert.deepEqual(Object.keys(task.fields), Object.keys(was.fields));
  for (const key of Object.keys(was.fields)) same(task.fields[key], was.fields[key], key);
  assert.deepEqual(task.checks, was.checks);
  assert.deepEqual(task.kinds, ['room']);
  assert.equal(task.variants, undefined);
  assert.equal(task.partial, undefined);
  assert.deepEqual(task.consumer, { module: 'src/search.js', export: 'findSlots' });
});
t('search.car = parse 와 같은 칸 + variants.car(minSeats·region 을 비우고 알림 — 지금 차량 동작 그대로)', () => {
  const task = ACTIONS.tasks['search.car'];
  const was = before.parse;
  assert.deepEqual(Object.keys(task.fields), Object.keys(was.fields));
  for (const key of Object.keys(was.fields)) same(task.fields[key], was.fields[key], key);
  assert.deepEqual(task.checks, was.checks);
  assert.deepEqual(task.kinds, ['car']);
  assert.deepEqual(task.variants, { car: was.variants.car });
  // 행위의 기록 칸에서는 두 칸이 빠진다 — 차량은 좌석 수·지역이 없다.
  assert.deepEqual(Object.keys(ACTIONS.actions['car.search'].fields), Object.keys(was.fields).filter((k) => !['minSeats', 'region'].includes(k)));
  assert.deepEqual(ACTIONS.actions['car.search'].drops, was.variants.car.clear);
  assert.deepEqual(Object.keys(ACTIONS.actions['room.search'].fields), Object.keys(was.fields));
});
t('작업의 칸 설명은 YAML 의 read(+ 예)다 — promptOf 가 그것을 LLM 에게 보낸다', () => {
  assert.equal(ACTIONS.tasks['search.room'].fields.minSeats.desc, ACTIONS.actions['room.search'].fields.minSeats.read + ' (예: 10)');
  assert.equal(ACTIONS.tasks.attend.fields.reply.desc, ACTIONS.domains.attend.llm.fields.reply.read);
  assert.equal(ACTIONS.tasks['search.car'].fields.minSeats.desc, '차량에는 좌석 정보가 없으므로 항상 null');
});
t('작업의 칸마다 label(행위 칸의 label, 없으면 desc 의 첫 마디)이 있다 — 관문의 알림이 긴 read 대신 그 이름을 부른다', () => {
  for (const [name, task] of Object.entries(ACTIONS.tasks)) {
    for (const [key, f] of Object.entries(task.fields)) assert.ok(typeof f.label === 'string' && f.label.trim(), `${name}.${key}`);
  }
  const a = ACTIONS.tasks.attend.fields;
  assert.deepEqual([a.kind.label, a.sub.label, a.dateFrom.label, a.place.label, a.wfa.label, a.reply.label], ['근태 종류', '종류', '출발일·날짜·시작일', '출장지·장소', '기념일 지원', '답 한 줄']);
  assert.deepEqual([ACTIONS.tasks['search.room'].fields.region.label, ACTIONS.tasks['search.car'].fields.minSeats.label], ['지역', '최소 좌석 수']);
});

console.log('근태 명세는 폼 규칙(src/attend.js)과 같은 값을 말한다');
const APPLY = ['trip', 'out', 'flex', 'leaveout', 'leave', 'health'];
const forms = {
  trip: [blankForm('trip', TODAY), { ...blankForm('trip', TODAY), settle: true }, { ...blankForm('trip', TODAY), car: true }, { ...blankForm('trip', TODAY), settle: true, car: true }],
  out: [blankForm('out', TODAY), { ...blankForm('out', TODAY), sub: 'TR' }, { ...blankForm('out', TODAY), sub: 'MEET' }, { ...blankForm('out', TODAY), car: true }],
  flex: [blankForm('flex', TODAY), { ...blankForm('flex', TODAY), flexMode: 'week' }, { ...blankForm('flex', TODAY), flexMode: 'all' }],
  leaveout: [blankForm('leaveout', TODAY)],
  leave: [blankForm('leave', TODAY), { ...blankForm('leave', TODAY), sub: 'LH' }, { ...blankForm('leave', TODAY), wfa: true }],
  health: [blankForm('health', TODAY), { ...blankForm('health', TODAY), allDay: false }],
};
t('종류마다 fieldsFor 가 내는 칸 ⊆ YAML 의 칸이고 이름(label)이 같다 — 사전정산·차량·주간/전체·기념일·시간 검진까지', () => {
  for (const kind of APPLY) {
    const { fields } = ACTIONS.actions[`attend.${kind}`];
    for (const form of forms[kind]) {
      for (const f of fieldsFor(form)) {
        assert.ok(f.key in fields, `${kind}: ${f.key} 칸이 YAML 에 없다`);
        assert.equal(fields[f.key].label, f.label, `${kind}.${f.key} 의 이름`);
      }
    }
  }
});
t('종류마다 blankForm 의 키 ⊆ fields ∪ ignore 이고, ignore 는 blankForm 에 있는 키만 든다', () => {
  for (const kind of APPLY) {
    const a = ACTIONS.actions[`attend.${kind}`];
    const keys = Object.keys(blankForm(kind, TODAY));
    for (const key of keys) assert.ok(key in a.fields || key in (a.ignore || {}), `${kind}: ${key} 가 fields 에도 ignore 에도 없다`);
    for (const key of Object.keys(a.ignore || {})) assert.ok(keys.includes(key), `${kind}: ignore 의 ${key} 는 blankForm 에 없는 키다`);
    for (const key of Object.keys(a.fields)) assert.ok(keys.includes(key) || ['op', 'doc'].includes(key), `${kind}: ${key} 는 폼에 없는 칸이다`);
  }
});
t('신청 종류마다 op(save·request)와 doc(고쳐 올리는 문서) 칸이 있다 — 임시저장과 결재요청은 다른 기록이다', () => {
  for (const kind of APPLY) {
    const { fields } = ACTIONS.actions[`attend.${kind}`];
    assert.deepEqual([fields.op.type, fields.op.values, fields.op.required, fields.op.llm], ['enum', ['save', 'request'], true, false], kind);
    assert.deepEqual([fields.doc.type, Object.keys(fields.doc.fields), fields.doc.llm], ['object', ['docNo', 'statusCode'], false], kind);
  }
});
t('기본값(default)은 blankForm·SUBS 가 까는 값과 같다 — 출장 07:00~20:00·경비 Y·기차, 외근/외출/검진 09:00, 소통 13:00 60분 부서소통회', () => {
  const f = (kind) => ACTIONS.actions[`attend.${kind}`].fields;
  const trip = blankForm('trip', TODAY);
  assert.deepEqual([f('trip').start.default, f('trip').end.default, f('trip').expense.default, f('trip').transport.default, f('trip').trainGrade.default, f('trip').days.default],
    [trip.start, trip.end, trip.expense, trip.transport, trip.trainGrade, trip.days]);
  assert.deepEqual([trip.start, trip.end, trip.expense, trip.transport, trip.trainGrade], ['07:00', '20:00', 'Y', [DEFAULT_TRANSPORT], DEFAULT_GRADE]);
  for (const kind of ['out', 'leaveout', 'health']) assert.equal(f(kind).start.default, DEFAULT_START, kind);
  assert.equal(f('out').expense.default, blankForm('out', TODAY).expense);
  assert.equal(f('out').sub.default, SUBS.out[0].value);
  assert.equal(f('leave').sub.default, SUBS.leave[0].value);
  assert.equal(f('flex').flexMode.default, blankForm('flex', TODAY).flexMode);
  assert.equal(f('health').allDay.default, blankForm('health', TODAY).allDay);
  // 소통(MEET)이 까는 값은 sub 의 설명과 종류 규칙에 적혀 있다(칸의 default 는 갈래마다 다를 수 없다).
  const meet = SUBS.out.find((s) => s.value === 'MEET').preset;
  const endOf = `${String(+meet.start.slice(0, 2) + meet.span / 60).padStart(2, '0')}:00`;
  const said = [f('out').sub.desc, ...ACTIONS.actions['attend.out'].rules].join('\n');
  assert.ok(said.includes(`${meet.start}~${endOf}`) && said.includes(meet.purpose), '소통의 13:00~14:00·부서소통회');
});
t('enum 의 값은 src/attend.js·travel.js·welfare.js 의 상수와 같다', () => {
  const task = ACTIONS.tasks.attend.fields;
  const f = (kind) => ACTIONS.actions[`attend.${kind}`].fields;
  assert.deepEqual([...task.kind.values].sort(), Object.keys(KINDS).sort());
  assert.deepEqual([...task.sub.values].sort(), Object.values(SUBS).flat().map((s) => s.value).sort());
  assert.deepEqual(f('out').sub.values, SUBS.out.map((s) => s.value));
  assert.deepEqual(f('leave').sub.values, SUBS.leave.map((s) => s.value));
  assert.deepEqual(task.flexStart.values, FLEX_TIMES.map((x) => x.start));
  for (const d of FLEX_DAYS) assert.deepEqual(f('flex')[d.key].values, flexTimesFor(d.wide).map((x) => x.start), d.key);
  assert.equal(f('trip').days.max, MAX_TRIP_DAYS);
  assert.equal(f('leave').days.max, MAX_TRIP_DAYS);
  assert.deepEqual(f('leave').half.values, ['am', 'pm', 'full'], 'LLM 값 — UI 의 전일은 빈 값');
  assert.deepEqual(f('trip').transport.values, TRANSPORTS.map((x) => x.value));
  assert.deepEqual(f('trip').trainGrade.values, TRAIN_GRADES.map((x) => x.value));
  assert.deepEqual(f('leave').wfaReason.values, REASONS);
  assert.deepEqual(f('leave').wfaRelation.values, RELATIONS);
  assert.deepEqual(f('leave').wfaCash.values, CASH_KINDS.map((x) => x.value));
  assert.deepEqual([...ACTIONS.actions['attend.doc'].fields.formId.values].sort(), Object.values(FORMS).map((x) => x.formId).sort());
  assert.deepEqual([...ACTIONS.actions['attend.cancel'].fields.formId.values].sort(), Object.keys(CANCEL_FORMS).sort());
  assert.deepEqual(ACTIONS.actions['attend.doc'].fields.action.values, ['request', 'recall', 'delete']);
});
t('기념일 지원 — wfa 는 LLM 칸, 나머지 기념일 칸은 화면 칸(when: wfa)이고 welfare 행위는 연차 폼을 그대로 받는다', () => {
  const leave = ACTIONS.actions['attend.leave'].fields;
  assert.equal(leave.wfa.llm, true);
  for (const key of Object.keys(leave).filter((k) => k.startsWith('wfa') && k !== 'wfa')) assert.deepEqual([leave[key].llm, leave[key].when], [false, 'wfa'], key);
  const welfare = ACTIONS.actions['attend.welfare'];
  assert.deepEqual(Object.keys(welfare.fields.form.fields), Object.keys(leave).filter((k) => !['op', 'doc'].includes(k)));
  assert.deepEqual(ACTIONS.actions['attend.leave'].then, [{ action: 'attend.welfare', when: 'wfa' }]);
});

console.log('지시문');
t('merged 지시문(--prompt attend)은 역할 → kind → 칸(종류별 read) → 규칙(갈래 먼저, 종류별은 "종류가 …일 때:") 차례로 읽힌다', () => {
  const text = promptOf(ACTIONS.tasks.attend);
  assert.ok(text.startsWith(ACTIONS.domains.attend.llm.role));
  const lines = text.split('\n');
  assert.equal(lines[lines.indexOf('출력 키:') + 1].slice(0, 8), '- kind (');
  assert.match(text, /- kind \("trip" \| "out" \| "flex" \| "leaveout" \| "leave" \| "health" 또는 null\): 근태 종류\. trip\(출장\)·out\(외근·교육·부서소통회\)/);
  assert.match(text, /- dateFrom \(날짜 YYYY-MM-DD 또는 null\): 종류별 — trip: 출발일/);
  assert.match(text, /- reply \(글 또는 null\): 무엇을 채웠는지 한국어 한 문장/);
  const firstKind = text.indexOf('- 종류가 ');
  assert.ok(firstKind > 0);
  for (const rule of ACTIONS.domains.attend.llm.rules) assert.ok(text.indexOf(`- ${rule}`) < firstKind, `갈래 규칙이 종류 규칙보다 앞: ${rule.slice(0, 20)}`);
  assert.match(text, /- 종류가 trip\(출장\)일 때: 출장\(trip\)은 출장지\(place/);
  assert.match(text, /- 종류가 flex\(유연근무\)일 때: flex 는 유연근무/);
  assert.equal(cli('--prompt', 'attend').stdout, `${text}\n`);
});
t('input.yaml 의 attend 규칙은 하나도 잃지 않았다(출장지·장소 규칙만 출장 규칙과 갈래 규칙으로 나뉘었다)', () => {
  const text = promptOf(ACTIONS.tasks.attend);
  for (const rule of before.attend.rules) {
    if (rule.startsWith('출장(trip)은 출장지')) {
      const cut = rule.indexOf(' 출장이 아니면');
      assert.ok(text.includes(rule.slice(0, cut)), '출장 규칙');
      assert.ok(text.includes(rule.slice(cut + 1)), '갈래 규칙(출장이 아니면 venue 는 null)');
      continue;
    }
    assert.ok(text.includes(rule), rule);
  }
  for (const rule of before.parse.rules) {
    if (/차량/.test(rule)) continue;   // 차량 문장은 search.car 의 규칙으로 갈라졌다
    assert.ok(promptOf(ACTIONS.tasks['search.room']).includes(rule), `search.room: ${rule}`);
  }
  assert.match(promptOf(ACTIONS.tasks['search.car']), /minSeats 는 항상 null/);
});

console.log('from 펼치기');
t('room·car 의 modify 는 back·next 가 reserve 의 칸 그대로다(object from: <행위 ID>)', () => {
  for (const d of ['room', 'car']) {
    const reserve = ACTIONS.actions[`${d}.reserve`].fields;
    for (const key of ['back', 'next']) {
      const f = ACTIONS.actions[`${d}.modify`].fields[key];
      assert.deepEqual([f.type, f.from, f.required], ['object', `${d}.reserve`, true]);
      assert.deepEqual(Object.keys(f.fields), Object.keys(reserve));
      for (const [k, sf] of Object.entries(f.fields)) {
        assert.ok(!('llm' in sf) && !('ui' in sf), `${d}.modify.${key}.${k} 안에는 llm·ui 가 없다`);
        assert.deepEqual(sf.type, reserve[k].type);
      }
    }
  }
});
t('list 의 item from: task:<이름> 과 object from: recipe(fields ∪ reads ∪ currency·attach)를 펼친다', () => {
  const raw = {
    errors: [],
    domains: {
      gongmun: {
        domain: { domain: 'gongmun', title: '공문', log: 'gongmun', kinds: ['purchase'], llm: { mode: 'recipe' } },
        kinds: {
          purchase: {
            id: 'gongmun.purchase', title: '구매품의',
            fields: {
              title: { type: 'string', required: true, max: 99, desc: '제목', read: '제목' },
              draft: { type: 'object', from: 'recipe', desc: '초안', read: '초안', llm: false },
              records: { type: 'list', max: 5, desc: '증빙', read: '증빙', llm: false, item: { from: 'task:receipt', file: { type: 'file', desc: '파일', read: '파일' } } },
            },
            llm: { tasks: [{ task: 'gongmun.purchase', fills: 'draft' }, { task: 'gongmunReason.purchase', fills: 'draft' }] },
            runner: 'gongmun.write', uses: [{ module: 'src/gongmun.js', export: 'writePlan' }],
          },
        },
      },
    },
  };
  // recipe 모드의 kinds 는 레시피의 목적 차례와 같아야 한다 — 이 작은 명세는 purchase 하나라 레시피의 order 도 그만큼만 준다.
  const one = { recipe: { ...RECIPE, order: ['purchase'] } };
  assert.deepEqual(checkActions(raw, one), []);
  const { spec, errors } = buildActions(raw, one);
  assert.deepEqual(errors, []);
  const entry = spec.actions['gongmun.purchase'];
  assert.deepEqual(entry.llm, { tasks: [{ task: 'gongmun.purchase', fills: 'draft' }, { task: 'gongmunReason.purchase', fills: 'draft' }] });
  assert.deepEqual(spec.tasks, {}, 'recipe 모드는 작업을 만들지 않는다');
  const p = RECIPE.purposes.purchase;
  const draft = entry.fields.draft.fields;
  assert.deepEqual(Object.keys(draft), [...p.fields.map((f) => f.key), ...p.reads.map((k) => k.key), 'currency', 'attach']);
  assert.deepEqual(draft, recipeDraftFields(p));
  assert.deepEqual([draft.total.type, draft.total.min, draft.vendor.type, draft.vendor.max, draft.quoteDate.type], ['number', 0, 'string', 200, 'date']);
  assert.equal(draft.items.type, 'list');
  assert.deepEqual(Object.keys(draft.items.item), p.reads.find((k) => k.key === 'items').item.map((x) => x.key));
  assert.equal(draft.items.item.qty.type, 'number');
  for (const [key, f] of Object.entries(draft)) {
    assert.equal(f.required, undefined, `draft.${key} 에는 required 가 없다`);
    assert.ok(f.desc && f.read, key);
  }
  const written = p.fields.find((f) => f.from === 'write');
  assert.equal(draft[written.key].read, `${written.label} 칸`, '읽지 않는 칸의 read 는 "<label> 칸"');
  assert.deepEqual(draft.currency.values, ['KRW', 'USD', 'EUR', 'JPY', 'CNY', 'GBP']);
  // 첨부 줄은 패널의 draft.attach(src/gongmun.js attachList) 그대로 { label, files } — files 는 values 없는 tags(자유 글의 목록).
  assert.deepEqual([draft.attach.type, Object.keys(draft.attach.item), draft.attach.item.label.required, draft.attach.item.files.type, 'values' in draft.attach.item.files], ['list', ['label', 'files'], true, 'tags', false]);
  // list 의 줄 — receipt 의 칸이 앞, 더 적은 file 이 뒤. 복사한 칸의 read 는 desc 다.
  const item = entry.fields.records.item;
  assert.deepEqual(Object.keys(item), [...Object.keys(before.attend.fields).length ? [] : [], ...Object.keys(spec.actions['gongmun.purchase'].fields.records.item)]);
  const receipt = JSON.parse(read('src/inputspec.js').replace(/^.*?export const INPUT_SPEC = /s, '').replace(/;\s*$/, '')).tasks.receipt;
  assert.deepEqual(Object.keys(item), [...Object.keys(receipt.fields), 'file']);
  assert.deepEqual([item.docType.type, item.docType.values, item.docType.required, item.docType.read], ['enum', receipt.fields.docType.values, true, receipt.fields.docType.desc]);
  assert.equal(item.file.type, 'file');
});
t('from 의 대상에 객체 칸이 있으면 못 펼친다 — omit 으로 뺀다', () => {
  const raw = mini();
  raw.domains.x.kinds.two.fields.inner = { type: 'object', desc: '안', read: '안', llm: false, fields: { a: { type: 'string', desc: 'a', read: 'a' } } };
  raw.domains.x.kinds.one.fields.copy = { type: 'object', from: 'x.two', desc: '복사', read: '복사', llm: false };
  assert.match(checkActions(raw).join('\n'), /x\.two 의 inner 칸이 객체\(또는 from\)라 한 겹에 펼칠 수 없습니다 — omit 으로 뺄 수 있습니다/);
  raw.domains.x.kinds.one.fields.copy.omit = ['inner'];
  assert.deepEqual(checkActions(raw), []);
  const { spec, errors } = buildActions(raw);
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(spec.actions['x.one'].fields.copy.fields), ['when', 'count']);
  raw.domains.x.kinds.one.fields.copy.omit = ['nope'];
  assert.match(checkActions(raw).join('\n'), /omit 의 nope 는 x\.two 에 없는 칸/);
});

console.log('공문 명세는 레시피(recipes/gongmun → src/gmrecipe.js)와 같은 값을 말한다 — 2026-10-17 Codex 검토: 손으로 베낀 값이 어긋나면 여기서 빨갛다');
t('gongmun 갈래의 kinds 가운데 레시피의 목적은 레시피의 목적 차례(RECIPE.order)와 같고(목적이 아닌 선행 품의 읽기 prior 는 그 뒤, llm 없음 — 2026-10-17), 종류마다 그 종류의 읽기·사유 작업만 가리킨다', () => {
  assert.deepEqual(ACTIONS.domains.gongmun.kinds, [...RECIPE.order, 'prior']);
  assert.deepEqual([ACTIONS.actions['gongmun.prior'].llm, ACTIONS.actions['gongmun.prior'].runner, ACTIONS.actions['gongmun.prior'].confirm], [false, 'gongmun.prior', false]);
  for (const k of RECIPE.order) {
    const a = ACTIONS.actions[`gongmun.${k}`];
    assert.ok(a, `gongmun.${k}`);
    assert.deepEqual(a.llm.tasks.map((t) => t.task), [`gongmun.${k}`, ...(RECIPE.tasks[`gongmunReason.${k}`] ? [`gongmunReason.${k}`] : [])], `${k} 의 작업`);
    assert.ok(a.llm.tasks.every((t) => t.fills === 'draft'));
    assert.equal(a.runner, 'gongmun.write');
    assert.equal(a.log, 'gongmun');
    assert.ok(a.log in KIND_LABEL);
  }
});
t('종류마다 양식 기본값·전결권자 직책·문서설정 선택지·갈래 이름·과제 칸은 레시피의 것이다', () => {
  const setting = settingPatch({ retention: '36', docNo: '8100', receiver: 'KRE', scope: '기안부서', emergency: true, approvingOpen: true, drm: true, tag: 'x' });
  for (const k of RECIPE.order) {
    const a = ACTIONS.actions[`gongmun.${k}`];
    const p = RECIPE.purposes[k];
    assert.deepEqual([a.fields.form.type, a.fields.form.default], ['string', p.form], `${k} form — 닫힌 enum 이 아니다(양식 ID 직접 적기), 기본값은 레시피의 폼`);
    assert.deepEqual(a.fields.rank.values, RECIPE.delegation.ranks, `${k} rank.values`);
    const s = a.fields.setting.fields;
    assert.deepEqual(Object.keys(s), Object.keys(setting), `${k} setting 의 키는 settingPatch 가 받는 키 전부`);
    assert.deepEqual(s.retention.values, Object.keys(RECIPE.settings.options.retention), `${k} retention`);
    assert.deepEqual(s.scope.values, Object.keys(RECIPE.settings.options.scope), `${k} scope`);
    assert.deepEqual(s.receiver.values, RECIPE.settings.options.receiver, `${k} receiver`);
    assert.equal(a.preset.kindTitle.from, `recipe:purposes.${k}.title`, `${k} kindTitle 은 레시피의 title 을 가리킨다`);
    assert.deepEqual([a.preset.setup.from, a.preset.setup.type, a.preset.setup.required], ['storage:gongmunPreset', 'object', true], `${k} setup(갈래 공통)`);
    const project = p.project !== false;
    assert.equal('project' in a.preset, project, `${k} project 사전설정은 과제를 고르는 갈래에만`);
    assert.equal('lead' in a.fields && 'refs' in a.fields, project, `${k} lead·refs 는 과제를 고르는 갈래에만`);
    assert.deepEqual(Object.keys(a.fields.draft.fields), [...p.fields.map((f) => f.key), ...p.reads.map((x) => x.key), 'currency', 'attach'], `${k} draft`);
    assert.ok(a.fields.title.required && a.fields.title.max === 99 && a.fields.body.max === 20000 && a.fields.attach.max === 5, `${k} title·body·attach 한도`);
  }
  // 공통 칸은 _domain.yaml 에서 온 것이라 글자까지 같다(종류가 통째로 적은 칸만 다르다 — 외부활동·구매의뢰의 form·body).
  const [first, ...rest] = RECIPE.order;
  for (const k of rest) for (const key of ['title', 'rank', 'setting', 'attach']) assert.deepEqual(ACTIONS.actions[`gongmun.${k}`].fields[key], ACTIONS.actions[`gongmun.${first}`].fields[key], `${k}.${key}`);
  assert.equal(ACTIONS.actions['gongmun.outside'].fields.body.when, 'form!=KR_Outside_Lecture_Report', '신고서에는 본문 칸이 없다 — 편집기 양식으로 바꿨을 때만');
  assert.equal(ACTIONS.actions['gongmun.order'].fields.body.when, 'form!=KR_Purchase_Order', '구매요청서(칸이 정해진 폼 — 표 두 개)에도 본문 칸이 없다 — 편집기 양식으로 바꿨을 때만(2026-10-17)');
  assert.deepEqual(RECIPE.forms.KR_Purchase_Order.only, ['order'], '구매요청서는 구매의뢰에서만 고른다(어댑터 formProblem 이 본다)');
});
t('갈래 공통 칸(_domain.yaml fields)과 { from: domain } — 같은 자리에 그대로, 다른 키가 섞이거나 공통 칸이 없으면 틀린 것, recipe 모드의 kinds·작업 이름 검사', () => {
  const recipe = { ...RECIPE, order: ['purchase'] };
  const common = { note: { type: 'string', max: 10, desc: '메모', read: '메모 글', llm: false } };
  const gm = (fields, mutate = () => {}) => {
    const raw = {
      errors: [],
      domains: {
        gongmun: {
          domain: { domain: 'gongmun', title: '공문', log: 'gongmun', kinds: ['purchase'], fields: common, llm: { mode: 'recipe' } },
          kinds: {
            purchase: {
              id: 'gongmun.purchase', title: '구매품의',
              fields: { title: { type: 'string', required: true, desc: '제목', read: '제목' }, ...fields, draft: { type: 'object', from: 'recipe', desc: '초안', read: '초안', llm: false } },
              llm: { tasks: [{ task: 'gongmun.purchase', fills: 'draft' }] }, runner: 'gongmun.write', uses: [{ module: 'src/gongmun.js', export: 'writePlan' }],
            },
          },
        },
      },
    };
    mutate(raw.domains.gongmun);
    return raw;
  };
  const ok = gm({ note: { from: 'domain' } });
  assert.deepEqual(checkActions(ok, { recipe }), []);
  const { spec, errors } = buildActions(ok, { recipe });
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(spec.actions['gongmun.purchase'].fields), ['title', 'note', 'draft'], '차례는 종류 파일의 자리');
  assert.deepEqual(spec.actions['gongmun.purchase'].fields.note, { type: 'string', desc: '메모', read: '메모 글', llm: false, ui: true, max: 10 });
  const errs = (raw) => checkActions(raw, { recipe }).join('\n');
  assert.match(errs(gm({ note: { from: 'domain', max: 5 } })), /fields note: from: domain 칸에는 다른 키\(max\)를 두지 않습니다/);
  assert.match(errs(gm({ other: { from: 'domain' } })), /fields other: from: domain 이 가리키는 공통 칸이 _domain\.yaml 의 fields 에 없습니다/);
  assert.match(errs(gm({}, (d) => { d.domain.fields = { bad: { from: 'domain' } }; })), /_domain\.yaml fields bad: from: domain 은 종류 파일의 칸에만/);
  assert.match(errs(gm({}, (d) => { d.domain.fields = { bad: { type: 'string', desc: '설명' } }; })), /_domain\.yaml fields bad: read/);
  assert.match(errs(gm({}, (d) => { d.domain.fields = {}; })), /fields 는 이름: 칸 꼴이어야 합니다\(갈래 공통 칸/);
  // 레시피의 목적이 아닌 종류(이 작은 레시피에는 edu 가 없다)는 llm 을 켤 수 없고 목적들 뒤에 서야 한다. 목적인 종류의 차례가 다르면 RECIPE.order 와 맞추라고 한다(2026-10-17 prior 로 검사를 나눴다).
  assert.match(errs(gm({}, (d) => { d.domain.kinds = ['purchase', 'edu']; d.kinds.edu = { ...d.kinds.purchase, id: 'gongmun.edu', llm: { tasks: [{ task: 'gongmun.edu', fills: 'draft' }] } }; })),
    /recipe 모드의 kinds 가운데 레시피의 목적\(purchase · edu\)은 레시피의 목적 차례\(RECIPE\.order — purchase\)와 같아야 합니다/);
  const reader = { id: 'gongmun.prior', title: '읽기', llm: false, runner: 'gongmun.prior', uses: [{ module: 'src/gmprior.js', export: 'readPrior' }], fields: { id: { type: 'string', desc: '번호', read: '번호' } } };
  assert.match(errs(gm({}, (d) => { d.domain.kinds = ['purchase', 'prior']; d.kinds.prior = { ...reader, llm: { tasks: [{ task: 'gongmun.purchase', fills: 'draft' }] } }; })),
    /gongmun\/prior\.yaml: 레시피의 목적이 아닌 종류는 llm: false 여야 합니다/);
  assert.match(errs(gm({}, (d) => { d.domain.kinds = ['prior', 'purchase']; d.kinds.prior = reader; })), /레시피의 목적이 아닌 종류\(prior\)는 kinds 에서 목적들 뒤에 둡니다/);
  assert.equal(errs(gm({}, (d) => { d.domain.kinds = ['purchase', 'prior']; d.kinds.prior = reader; })), '', '목적 뒤의 읽기 종류는 된다');
  assert.match(errs(gm({}, (d) => { d.domain.kinds = ['prior']; d.kinds.prior = { id: 'gongmun.prior', title: '읽기', llm: false, runner: 'gongmun.prior', fields: { id: { type: 'string', desc: '번호', read: '번호' } } }; delete d.kinds.purchase; })),
    /recipe 모드의 kinds 가운데 레시피의 목적\(\)은 레시피의 목적 차례\(RECIPE\.order — purchase\)와 같아야 합니다/);
  assert.match(errs(gm({}, (d) => { d.kinds.purchase.llm = { tasks: [{ task: 'gongmun.edu', fills: 'draft' }] }; })), /gongmun\.edu 는 이 종류\(purchase\)의 작업이 아닙니다/);
  assert.equal(checkActions(gm({}, (d) => { delete d.domain.fields; }), { recipe }).join('\n'), '', '공통 칸이 없어도 된다');
});

console.log('보기 기록과 YAML 글');
t('toYaml 은 node 의 yaml 로 다시 읽으면 같은 값이다 — 따옴표가 필요한 글(시각·날짜·빈 글·쉼표·기호)까지', () => {
  const value = {
    v: 1, action: 'attend.trip', by: 'ui', via: null, ok: true,
    preset: { today: '2026-10-16', start: '07:00', me: '김기현', empty: '', colon: 'a: b', hash: '#x', bool: 'true', num: '12', comma: '형제,자매', tags: ['train', 'plane'], nested: { deep: [{ a: 1, b: 'x' }, { a: 2, b: null }] } },
    input: { dateFrom: '2026-10-20', days: 2, place: '대전 (본원)', purpose: '착수회의 참석 — 1차', none: [], blank: {}, list: [1, 'two', false] },
  };
  assert.deepEqual(parse(toYaml(value)), value);
  assert.equal(toYaml({ a: '07:00', b: 'x' }), 'a: "07:00"\nb: x');
});
t('--example 은 example·default 로 채운 기록을 YAML 로, --show 는 합쳐진 행위를 JSON 으로 보인다', () => {
  const rec = exampleRecord(ACTIONS.actions['attend.trip']);
  assert.deepEqual([rec.v, rec.action, rec.by, rec.preset.today, rec.preset.workplace], [1, 'attend.trip', 'ui', '<today>', '<storage:attendWorkplace>']);
  assert.deepEqual([rec.input.dateFrom, rec.input.days, rec.input.settle, rec.input.transport, rec.input.op, rec.input.doc], ['2026-10-20', 2, false, ['train'], null, { docNo: null, statusCode: null }]);
  const ex = cli('--example', 'attend.trip');
  assert.equal(ex.status, 0, ex.stderr);
  assert.deepEqual(parse(ex.stdout), rec);
  const show = cli('--show', 'room.reserve');
  assert.equal(show.status, 0, show.stderr);
  assert.deepEqual(JSON.parse(show.stdout), ACTIONS.actions['room.reserve']);
  assert.equal(cli('--show', 'room.nothing').status, 1);
  assert.equal(cli('--prompt', 'nothing').status, 1);
});
t('회의실·차량 예약 기록의 칸은 실행자의 payload 가 내는 모양이다(kind·room 별칭·blocked 만 빼고)', () => {
  assert.deepEqual(Object.keys(ACTIONS.actions['room.reserve'].fields), ['room', 'roomValue', 'region', 'date', 'start', 'end', 'title']);
  assert.deepEqual(Object.keys(ACTIONS.actions['car.reserve'].fields), ['car', 'carValue', 'date', 'start', 'end', 'endDate', 'title', 'place', 'passenger']);
  assert.ok(ACTIONS.actions['car.reserve'].fields.place.required && !ACTIONS.actions['car.reserve'].fields.title.required, '차량은 행선지가 필수, 사용목적은 아니다');
  assert.ok(ACTIONS.actions['room.reserve'].fields.title.required, '회의실은 회의주제가 필수');
});

console.log('R&D 의 LLM 작업 — rnd.extract(사업계획서 → 스냅샷 YAML)·rnd.revise(변경사항 → YAML 전문). per-kind, 패널(rndgen/llm.js)이 askClaude 를 바로 부른다');
t('갈래 rnd 는 per-kind 이고 extract·revise 두 종류만 LLM 을 켠다 — 나머지 종류는 llm: false(작업 없음)', () => {
  const dom = ACTIONS.domains.rnd;
  assert.deepEqual([dom.llm.mode, dom.llm.partial, dom.llm.input, dom.llm.consumer], ['per-kind', false, 'rnd', { module: 'rndgen/llm.js', export: 'askRndTask' }]);
  assert.deepEqual(dom.kinds.slice(-2), ['extract', 'revise']);
  assert.deepEqual(actionsOf('rnd').filter((a) => a.llm).map((a) => [a.id, a.task]), [['rnd.extract', 'rnd.extract'], ['rnd.revise', 'rnd.revise']]);
  assert.deepEqual(Object.keys(ACTIONS.tasks).filter((k) => k.startsWith('rnd')).sort(), ['rnd.extract', 'rnd.revise']);
  for (const id of ['rnd.extract', 'rnd.revise']) {
    const a = ACTIONS.actions[id];
    assert.deepEqual([a.status, a.confirm, a.effect, a.log, a.runner], ['planned', true, 'draft', 'rnd', id], id);
    assert.deepEqual(a.uses.slice(0, 1), [{ module: 'rndgen/llm.js', export: 'askRndTask' }], id);
  }
});
t('답 칸(계약서 §2.1) — 이름·차례·형·필수·한도가 고정이고 화면 칸은 llm: false 다', () => {
  const shape = (fields) => Object.entries(fields).map(([k, f]) => [k, f.type, !!f.required, f.min ?? null, f.max ?? null]);
  const ex = ACTIONS.tasks['rnd.extract'];
  const rv = ACTIONS.tasks['rnd.revise'];
  assert.deepEqual(shape(ex.fields), [['yaml', 'string', true, null, 120000], ['alias', 'string', false, null, 60], ['stage', 'integer', false, 1, 20], ['warnings', 'string', false, null, 3000]]);
  assert.deepEqual(shape(rv.fields), [['yaml', 'string', true, null, 120000], ['summary', 'string', true, null, 300], ['changes', 'list', false, null, 50], ['warnings', 'string', false, null, 3000]]);
  assert.deepEqual(shape(rv.fields.changes.item), [['path', 'string', true, null, 200], ['before', 'string', false, null, 500], ['after', 'string', false, null, 500]]);
  // 관문 초안 모드는 max 를 넘는 글을 말없이 자른다(기본 2000) — YAML 전문 칸은 한도를 꼭 둔다.
  for (const task of [ex, rv]) assert.ok(task.fields.yaml.max >= 120000);
  const ui = (id) => Object.entries(ACTIONS.actions[id].fields).filter(([, f]) => !f.llm).map(([k, f]) => [k, f.type]);
  assert.deepEqual(ui('rnd.extract'), [['file', 'file'], ['stageWanted', 'integer'], ['projectId', 'string']]);
  assert.deepEqual(ui('rnd.revise'), [['projectId', 'string'], ['n', 'integer'], ['text', 'string'], ['files', 'list']]);
  // 구조화 출력 스키마는 모든 칸을 required 로 둔다(없는 값은 null) — 목록의 줄도.
  for (const task of [ex, rv]) assert.deepEqual(schemaOf(task).required, Object.keys(task.fields));
  assert.deepEqual(schemaOf(rv).properties.changes.anyOf[0].items.required, ['path', 'before', 'after']);
});
t('작업의 제목·역할은 종류 title 로 채우고 consumer 는 rndgen/llm.js 의 askRndTask(함수 선언)다', () => {
  for (const [name, kind] of [['rnd.extract', 'extract'], ['rnd.revise', 'revise']]) {
    const task = ACTIONS.tasks[name];
    const title = ACTIONS.actions[`rnd.${kind}`].title;
    assert.equal(task.title, `R&D ${title}`);
    assert.ok(task.role.includes(`이번 일: ${title}.`), task.role);
    assert.deepEqual([task.kinds, task.consumer, task.partial, task.variants], [['rnd'], { module: 'rndgen/llm.js', export: 'askRndTask' }, undefined, undefined]);
  }
  assert.match(read('rndgen/llm.js'), /^export async function askRndTask\b/m);
});
t('지시문 — 뽑기는 KR·당해 차년도·합계를 새로 더하지 않음·stage·절차 무시, 고치기는 말한 곳만·합계 다시 맞춤·meta.rev 는 코드', () => {
  const ex = promptOf(ACTIONS.tasks['rnd.extract']);
  for (const s of ['한국선급(KR) 행·블록만', '당해 차년도 행만', '새로 더하지 않습니다', 'stage(수 N)', '스킬 문서의 절차', '— N쪽 —', 'warnings 는']) assert.ok(ex.includes(s), s);
  const rv = promptOf(ACTIONS.tasks['rnd.revise']);
  for (const s of ['말한 곳만 고친 YAML 전문', '다시 더해 맞춥니다', 'meta.rev 와 파일 머리 주석', '예산.참여연구자인건비', 'summary 는', 'changes 는']) assert.ok(rv.includes(s), s);
  assert.equal(cli('--prompt', 'rnd.extract').stdout, `${ex}\n`);
});

console.log(`\n통과 ${pass}건`);
