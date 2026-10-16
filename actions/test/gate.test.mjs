// 관문(actions/gate.js) — 초안/실행 모드의 차이 · tags/file/object · when · 사전설정 검사 · partial.
//
// 생성물(actions/spec.js)에 기대지 않는다 — 작은 명세 객체를 직접 만들어 spec 인자로 준다.
import assert from 'node:assert/strict';

import { ActionError, specOf, presetSpec, check } from '../gate.js';
import { InputError } from '../../src/input.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const SPEC = {
  version: 1,
  domains: {
    attend: { domain: 'attend', title: '근태', log: 'attend', kinds: ['trip'], preset: {}, llm: { task: 'attend', mode: 'merged', partial: true } },
    room: { domain: 'room', title: '회의실', log: 'reserve', kinds: ['search'], preset: {}, llm: { task: 'search', mode: 'per-kind', partial: false } },
  },
  actions: {
    'attend.trip': {
      id: 'attend.trip', domain: 'attend', kind: 'trip', title: '출장 신청', status: 'live', confirm: true, effect: 'write',
      summary: '출장 {dateFrom}~{dateTo} {place} · {purpose}',
      preset: {
        today: { from: 'today', desc: '오늘' },
        me: { from: 'me', desc: '내 이름', required: true },
        workplace: { from: 'storage:attendWorkplace', desc: '근무지' },
        hrMe: { from: 'ctx:hrMe', type: 'object', desc: 'HR 의 나(사번·이름)' },
        project: { from: 'ctx:project', type: 'object', desc: '고른 과제', log: false },
        start: { value: '07:00', type: 'time', desc: '출발 시각 기본값' },
        transport: { value: ['train'], type: 'tags', desc: '교통편 기본값' },
      },
      fields: {
        dateFrom: { type: 'date', required: true, label: '출발일', desc: '출발일', read: '출발일' },
        dateTo: { type: 'date', desc: '도착일', read: '도착일' },
        days: { type: 'integer', min: 1, max: 31, desc: '며칠간', read: '며칠간' },
        start: { type: 'time', desc: '출발 시각', read: '출발' },
        place: { type: 'string', required: true, max: 10, desc: '출장지', read: '출장지' },
        purpose: { type: 'string', max: 200, desc: '목적', read: '목적' },
        settle: { type: 'boolean', desc: '사전정산', read: '사전정산', llm: false, default: false },
        workplace: { type: 'string', desc: '근무지', read: '근무지', llm: false, when: 'settle' },
        transport: { type: 'tags', values: ['train', 'plane', 'bus'], desc: '교통편', read: '교통편', llm: false, when: 'settle' },
        op: { type: 'enum', values: ['save', 'request'], required: true, desc: '올리는 길', read: '올리는 길', llm: false },
        memo: { type: 'string', desc: '메모', read: '메모', when: 'op!=save' },
        reason: { type: 'string', desc: '사유', read: '사유', when: 'op=save' },
        file: { type: 'file', desc: '증빙', read: '증빙', llm: false },
        setting: { type: 'object', desc: '문서설정', read: '문서설정', llm: false, fields: {
          tag: { type: 'string', max: 5, desc: '검색 키워드', read: '키워드' },
          emergency: { type: 'boolean', desc: '긴급', read: '긴급' },
          attach: { type: 'list', max: 2, desc: '첨부', read: '첨부', item: { name: { type: 'string', required: true, desc: '파일 이름', read: '이름' }, kind: { type: 'string', desc: '무엇', read: '무엇' } } },
        } },
      },
      checks: [{ left: 'dateFrom', op: '<=', right: 'dateTo', drop: 'dateTo', message: '종료일이 시작일보다 앞서 종료일은 뺐습니다' }],
      runner: 'attend.apply',
    },
    'room.search': {
      id: 'room.search', domain: 'room', kind: 'search', title: '회의실 찾기', status: 'live', confirm: false, effect: 'none', preset: {},
      fields: { dateFrom: { type: 'date', required: true, desc: '조회 시작일' }, minSeats: { type: 'integer', min: 1, desc: '최소 좌석 수' } },
      variants: { search: { clear: { minSeats: '차량은 좌석 수를 알 수 없어 인원 조건은 뺐습니다' } } },
      runner: 'booking.search',
    },
  },
  tasks: {},
};

const PRESET = { today: '2026-10-16', me: '김기현', workplace: '부산', hrMe: { emplNo: '1', name: '김기현' }, project: { name: '과제', content: '내용' }, start: '07:00', transport: ['train'] };
// UI 가 보내는 꼴 — 수는 글로, 시각은 한 자리로, 공백이 붙고, 명세에 없는 키(ghost)도 섞여 있다.
const INPUT = {
  dateFrom: '2026-10-20', dateTo: '2026-10-21', days: '2', start: '7:00', place: ' 대전 ', purpose: '회의', settle: true, workplace: '부산',
  transport: ['plane', 'train'], op: 'request', memo: '메모', reason: '안 씀',
  file: { name: 'a.png', type: 'image/png', size: 10, dataUrl: 'data:image/png;base64,AAAA' },
  setting: { tag: '출장', emergency: false, attach: [{ name: 'a.png', kind: '견적서' }] }, ghost: 'x',
};
const NORMAL = {
  dateFrom: '2026-10-20', dateTo: '2026-10-21', days: 2, start: '07:00', place: '대전', purpose: '회의', settle: true, workplace: '부산',
  transport: ['train', 'plane'], op: 'request', memo: '메모',
  file: { name: 'a.png', type: 'image/png', size: 10 }, setting: { tag: '출장', emergency: false, attach: [{ name: 'a.png', kind: '견적서' }] },
};

const fails = (fn) => {
  try { fn(); } catch (err) {
    assert.ok(err instanceof ActionError, `ActionError 여야 한다: ${err}`);
    assert.ok(!(err instanceof InputError), 'InputError 는 ActionError 로 바꿔 던진다');
    return err;
  }
  return assert.fail('던져야 한다');
};
const problemsOf = (...args) => fails(() => check(...args)).problems;
const strict = (input, preset = PRESET) => check('attend.trip', { input, preset }, { spec: SPEC });
const strictProblems = (input, preset = PRESET) => problemsOf('attend.trip', { input, preset }, { spec: SPEC });

console.log('명세 찾기와 오류');
t('모르는 행위는 ActionError — name·action·problems·message', () => {
  const err = fails(() => specOf('x.y', SPEC));
  assert.equal(err.name, 'ActionError');
  assert.equal(err.action, 'x.y');
  assert.deepEqual(err.problems, ['모르는 행위 x.y']);
  assert.equal(err.message, '행위 x.y — 모르는 행위 x.y');
  assert.equal(specOf('attend.trip', SPEC), SPEC.actions['attend.trip']);
  fails(() => specOf('constructor', SPEC));
  fails(() => specOf('attend.trip', { actions: {} }));
});
t('ActionError 는 problems 하나(글)도 받는다', () => {
  const e = new ActionError('a.b', '틀림');
  assert.deepEqual(e.problems, ['틀림']);
  assert.equal(e.message, '행위 a.b — 틀림');
});

console.log('사전설정의 칸 꼴');
t('presetSpec — type 기본 string, values·fields·item·min·max 는 그대로, required 는 실행 모드에서만', () => {
  const { fields } = presetSpec(SPEC.actions['attend.trip']);
  assert.deepEqual(fields.today, { type: 'string', desc: '오늘' });
  assert.deepEqual(fields.me, { type: 'string', desc: '내 이름', required: true });
  assert.deepEqual(fields.hrMe, { type: 'object', desc: 'HR 의 나(사번·이름)' });
  assert.deepEqual(fields.transport, { type: 'tags', desc: '교통편 기본값' });
  assert.deepEqual(presetSpec(SPEC.actions['attend.trip'], { mode: 'draft' }).fields.me, { type: 'string', desc: '내 이름' });
  assert.deepEqual(presetSpec({ preset: { n: { value: 1, type: 'integer', min: 1, max: 5 }, e: { from: 'ctx:e', type: 'enum', values: ['a'] } } }).fields,
    { n: { type: 'integer', desc: 'n', min: 1, max: 5 }, e: { type: 'enum', desc: 'e', values: ['a'] } });
  assert.deepEqual(presetSpec({}), { fields: {} });
});

console.log('실행 모드 — UI 가 보낸 기록');
t('맞는 기록은 정규화돼 지난다 — 수·시각·공백, tags 는 values 차례, 파일은 이름·형식·크기만, 명세에 없는 키와 when 이 거짓인 칸은 빠진다', () => {
  const out = strict(INPUT);
  assert.deepEqual(out, { input: NORMAL, preset: PRESET, notes: [] });
  assert.ok(!('reason' in out.input) && !('ghost' in out.input));
  assert.notEqual(out.preset.hrMe, PRESET.hrMe, '사전설정의 객체는 복사된다');
});
t('mode 의 기본은 execute', () => {
  assert.deepEqual(fails(() => check('attend.trip', { input: { ...INPUT, days: 40 }, preset: PRESET }, { spec: SPEC })).problems, ['days 값(40)이 틀렸습니다']);
});
t('잃는 보정은 모두 problem — 틀린 값·checks 의 drop·글 자르기·tags 의 모르는 값·목록 줄·줄 수 넘침·variants 의 clear', () => {
  const p = (patch) => strictProblems({ ...INPUT, ...patch });
  assert.deepEqual(p({ dateTo: '2026-10-01' }), ['종료일이 시작일보다 앞서 종료일은 뺐습니다']);
  assert.deepEqual(p({ place: '가'.repeat(12) }), ['place 가 10자를 넘습니다(12자)']);
  assert.deepEqual(p({ transport: ['ship', 'train'] }), ['transport 에 받을 수 없는 값(ship)이 있습니다']);
  assert.deepEqual(p({ setting: { attach: [{ kind: 'x' }, { name: 'b', kind: 3 }] } }), ['setting.attach[0].name 가 없습니다', 'setting.attach[1].kind 값(3)이 틀렸습니다']);
  assert.deepEqual(p({ setting: { attach: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } }), ['setting.attach 가 2줄을 넘습니다(3줄)']);
  assert.deepEqual(p({ dateFrom: '', op: null }), ['dateFrom 가 없습니다', 'op 가 없습니다']);
  assert.deepEqual(problemsOf('room.search', { input: { dateFrom: '2026-10-20', minSeats: 8 } }, { spec: SPEC }), ['차량은 좌석 수를 알 수 없어 인원 조건은 뺐습니다']);
  // 여럿이면 다 모아 한 번에 말한다
  assert.deepEqual(p({ days: 0, purpose: 7 }), ['days 값(0)이 틀렸습니다', 'purpose 값(7)이 틀렸습니다']);
});
t('file — 참조 { name, type, size? } 만. dataUrl 같은 다른 키는 알림 없이 버리고, 꼴이 아니면 틀린 값', () => {
  assert.deepEqual(strict({ ...INPUT, file: { name: 'b.pdf', type: 'application/pdf', bytes: 'xx' } }).input.file, { name: 'b.pdf', type: 'application/pdf' });
  for (const bad of ['a.png', { name: 'a.png' }, { name: '', type: 'image/png' }, { name: 'a.png', type: 'image/png', size: 1.5 }, { name: 'a.png', type: 'image/png', size: -1 }]) {
    assert.match(strictProblems({ ...INPUT, file: bad })[0], /^file 값\(/);
  }
});
t('object 안의 칸은 바깥.안쪽 이름으로 — 안의 목록도 된다. fields 가 없는 object(사전설정)는 불투명 객체(plain object 또는 null)를 깊게 복사한다', () => {
  assert.deepEqual(strictProblems({ ...INPUT, setting: { tag: '너무긴키워드', emergency: 'y' } }), ['setting.tag 가 5자를 넘습니다(6자)', 'setting.emergency 값(y)이 틀렸습니다']);
  assert.deepEqual(strictProblems({ ...INPUT, setting: 'x' }), ['setting 값(x)이 틀렸습니다']);
  const hrMe = { emplNo: '1', deep: { a: [1] } };
  const out = strict(INPUT, { ...PRESET, hrMe });
  assert.deepEqual(out.preset.hrMe, hrMe);
  assert.notEqual(out.preset.hrMe.deep, hrMe.deep);
  assert.equal(strict(INPUT, { ...PRESET, hrMe: null }).preset.hrMe, null);
  assert.deepEqual(strictProblems(INPUT, { ...PRESET, hrMe: ['x'] }), ['hrMe 값(["x"])이 틀렸습니다']);
});
t('when — key · !key · key=value · key!=value. 거짓이면 required 도 안 보고 결과에서 뺀다(null 도 안 넣는다)', () => {
  const out = strict({ ...INPUT, settle: false, op: 'save' }).input;
  assert.ok(!('workplace' in out) && !('transport' in out) && !('memo' in out));
  assert.equal(out.reason, '안 씀');
  const w = { ...SPEC, actions: { 'x.y': { id: 'x.y', domain: 'room', kind: 'y', title: 'y', preset: {}, fields: { a: { type: 'string', required: true, desc: 'a', when: '!b' }, b: { type: 'boolean', desc: 'b' } }, runner: 'r' } } };
  assert.deepEqual(check('x.y', { input: { b: true } }, { spec: w }).input, { b: true });
  assert.deepEqual(problemsOf('x.y', { input: { b: false } }, { spec: w }), ['a 가 없습니다']);
});
t('사전설정 — from 으로 채워져야 할 키가 없으면 problem, null 은 되고, required 면 null 도 problem, 틀린 값도 problem', () => {
  const { today, ...rest } = PRESET;
  assert.deepEqual(strictProblems(INPUT, rest), ['사전설정 today 가 채워지지 않았습니다']);
  assert.equal(strict(INPUT, { ...PRESET, workplace: null }).preset.workplace, null);
  assert.deepEqual(strictProblems(INPUT, { ...PRESET, me: null }), ['me 가 없습니다']);
  assert.deepEqual(strictProblems(INPUT, { ...PRESET, start: '7시' }), ['start 값(7시)이 틀렸습니다']);
  assert.deepEqual(problemsOf('attend.trip', { input: INPUT }, { spec: SPEC }),
    ['me 가 없습니다', ...Object.keys(SPEC.actions['attend.trip'].preset).map((k) => `사전설정 ${k} 가 채워지지 않았습니다`)]);
});
t('같은 뜻의 기록은 어느 꼴로 와도 같은 값으로 정규화된다(UI 의 글 ↔ LLM 의 값)', () => {
  const ui = strict(INPUT);
  const llm = strict({ ...NORMAL, transport: ['plane', 'train'], reason: null });
  assert.deepEqual(ui.input, llm.input);
});

console.log('초안 모드 — LLM 이 지은 조각');
t('초안 모드는 비우고 알린다. 행위 명세의 required 는 보지 않고(실행 모드의 것), partial 갈래는 빈 칸을 뺀다', () => {
  const out = check('attend.trip', { input: { dateFrom: '2026-10-20', days: 40, place: '가'.repeat(12), transport: ['ship', 'train'], settle: true, op: 'request' }, preset: {} }, { mode: 'draft', spec: SPEC });
  assert.deepEqual(out.input, { dateFrom: '2026-10-20', place: '가'.repeat(10), settle: true, transport: ['train'], op: 'request' });
  assert.deepEqual(out.notes, ['며칠간 값(40)은 받을 수 없어 뺐습니다', '교통편 중 받을 수 없는 값(ship)은 뺐습니다']);
  assert.deepEqual(out.preset, { today: null, me: null, workplace: null, hrMe: null, project: null, start: null, transport: null }, '초안에서는 사전설정이 비어 있어도 된다');
});
t('초안 모드의 checks drop 은 알림이고, partial 이 아닌 갈래는 null 을 남긴다', () => {
  assert.deepEqual(check('room.search', { input: { dateFrom: '2026-10-20' } }, { mode: 'draft', spec: SPEC }), { input: { dateFrom: '2026-10-20', minSeats: null }, preset: {}, notes: [] });
  const a = check('attend.trip', { input: { dateFrom: '2026-10-20', dateTo: '2026-10-01', op: 'save' } }, { mode: 'draft', spec: SPEC });
  assert.deepEqual(a.input, { dateFrom: '2026-10-20', op: 'save' });
  assert.deepEqual(a.notes, ['종료일이 시작일보다 앞서 종료일은 뺐습니다']);
});
t('초안 모드도 틀린 모양은 막는다 — 객체가 아닌 입력·모르는 모드', () => {
  assert.deepEqual(problemsOf('attend.trip', { input: 'x' }, { mode: 'draft', spec: SPEC }), ['JSON 객체가 아닙니다']);
  assert.deepEqual(problemsOf('attend.trip', { input: INPUT, preset: PRESET }, { mode: 'strict', spec: SPEC }), ['모르는 모드 strict']);
});

console.log('무엇이 비었는지 구조로도 돌려준다(missing) — 빈 곳으로 가는 단추(src/jump.js)가 쓴다');
t('칸은 where input, 사전설정은 where preset, 채우기를 건너뛴 사전설정은 unfilled — 차례는 오류의 차례', () => {
  const MINI = {
    version: 1,
    domains: { x: { domain: 'x', title: 'x', log: 'x', kinds: ['y'], preset: {}, llm: { mode: 'none' } } },
    actions: {
      'x.y': {
        id: 'x.y', domain: 'x', kind: 'y', title: 'y', status: 'live', confirm: true, effect: 'write',
        preset: { me: { from: 'me', desc: '내 이름', required: true }, hrMe: { from: 'ctx:hrMe', type: 'object', desc: 'HR 의 나' } },
        fields: {
          place: { type: 'string', required: true, desc: '출장지' },
          days: { type: 'integer', min: 1, max: 31, desc: '며칠' },
          draft: { type: 'object', desc: '초안', fields: { total: { type: 'number', required: true, desc: '합계' } } },
        },
        checks: [],
      },
    },
  };
  let err;
  try { check('x.y', { input: { place: '', days: 99, draft: {} }, preset: { me: null } }, { spec: MINI }); } catch (e) { err = e; }
  assert.ok(err instanceof ActionError);
  assert.deepEqual(err.missing, [
    { where: 'input', key: 'place', why: 'missing' },
    { where: 'input', key: 'days', why: 'invalid' },
    { where: 'input', key: 'draft.total', why: 'missing' },
    { where: 'preset', key: 'me', why: 'missing' },
    { where: 'preset', key: 'hrMe', why: 'unfilled' },
  ]);
  assert.equal(err.problems.length, 5, '글 목록과 구조 목록이 하나씩 짝이다');
  // 지나가면 missing 이 없고, 모르는 행위의 오류도 빈 목록이다.
  assert.deepEqual(check('x.y', { input: { place: '대전', days: 2, draft: { total: 1 } }, preset: { me: '나', hrMe: null } }, { spec: MINI }).notes, []);
  let unknown;
  try { specOf('x.z', MINI); } catch (e) { unknown = e; }
  assert.deepEqual(unknown.missing, []);
});

console.log(`\n통과 ${pass}건`);
