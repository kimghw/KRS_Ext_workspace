// 기록(actions/record.js) — 지문이 키 차례와 무관 · clip(바이트 없음·log:false 제외·자르기) · describe · toYaml(yaml 로 다시 읽어 같다) · freezeDeep.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { fnv1a, hashOf, stableJson, makeRecord, clipRecord, clipResult, clipString, describe, toYaml, freezeDeep } from '../record.js';

const { parse } = createRequire(import.meta.url)('yaml');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

console.log('지문');
t('FNV-1a 32비트 — 알려진 값과 같다(UTF-8 바이트 위)', () => {
  assert.equal(fnv1a(''), '811c9dc5');
  assert.equal(fnv1a('a'), 'e40c292c');
  assert.equal(fnv1a('foobar'), 'bf9cf968');
  assert.match(fnv1a('한글·emoji 😀'), /^[0-9a-f]{8}$/);
  assert.equal(fnv1a('한글'), fnv1a('한글'));
  assert.notEqual(fnv1a('한글'), fnv1a('한굴'));
});
t('hashOf — 키 차례와 무관하고, 배열의 차례는 지키며, undefined·null 인 키는 없는 것과 같다', () => {
  const a = { action: 'attend.trip', input: { place: '대전', days: 2, transport: ['train', 'plane'] }, preset: { me: '김기현' } };
  const b = { preset: { me: '김기현' }, input: { transport: ['train', 'plane'], days: 2, place: '대전' }, action: 'attend.trip' };
  assert.equal(hashOf(a), hashOf(b));
  assert.match(hashOf(a), /^[0-9a-f]{8}$/);
  assert.notEqual(hashOf(a), hashOf({ ...a, input: { ...a.input, transport: ['plane', 'train'] } }));
  assert.equal(hashOf({ a: 1, b: null, c: undefined, d: () => 1 }), hashOf({ a: 1 }));
  assert.equal(stableJson({ b: [1, { z: 1, y: null }], a: '2' }), '{"a":"2","b":[1,{"z":1}]}');
  assert.notEqual(hashOf({ days: 2 }), hashOf({ days: '2' }), '수와 글은 다르다');
});

console.log('짓기');
t('makeRecord — 꼴과 지문. 입력은 복사된다', () => {
  const input = { place: '대전', transport: ['train'] };
  const preset = { me: '김기현', project: { name: '과제' } };
  const r = makeRecord('attend.trip', { input, preset, by: 'llm', via: 'cli', at: 1760600000000 });
  assert.deepEqual(r, { v: 1, action: 'attend.trip', at: 1760600000000, by: 'llm', via: 'cli', preset, input, hash: hashOf({ action: 'attend.trip', preset, input }) });
  input.place = '부산';
  preset.project.name = '다른';
  assert.equal(r.input.place, '대전');
  assert.equal(r.preset.project.name, '과제');
  const bare = makeRecord('room.search', {});
  assert.deepEqual([bare.by, bare.via, bare.at, bare.input, bare.preset], ['ui', null, null, {}, {}]);
  assert.throws(() => makeRecord('', {}), /행위 ID/);
  assert.throws(() => makeRecord('a.b', { by: 'bot' }), /모르는 by/);
  assert.throws(() => makeRecord('a.b', { via: 'ws' }), /모르는 via/);
});
t('freezeDeep — 안까지 얼린다', () => {
  const r = freezeDeep({ a: { b: [1, { c: 2 }] } });
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.a) && Object.isFrozen(r.a.b) && Object.isFrozen(r.a.b[1]));
  assert.throws(() => { 'use strict'; r.a.b[1].c = 3; }, TypeError);
});

console.log('로그용 자르기');
const ENTRY = {
  title: '보기',
  preset: {
    me: { from: 'me', desc: '나' },
    project: { from: 'ctx:project', type: 'object', desc: '과제', log: false },
    logo: { from: 'ctx:logo', type: 'file', desc: '그림' },
  },
  fields: {
    place: { type: 'string', desc: '출장지' },
    file: { type: 'file', desc: '증빙' },
    body: { type: 'string', max: 20000, desc: '본문' },
    attach: { type: 'list', desc: '첨부', item: { file: { type: 'file', desc: '파일' }, note: { type: 'string', desc: '메모' } } },
    setting: { type: 'object', desc: '설정', fields: { tag: { type: 'string', desc: '키워드' } } },
  },
};
const RECORD = {
  v: 1, action: 'x.y', at: 1, by: 'ui', via: null, hash: 'deadbeef',
  preset: { me: '김기현', project: { name: '과제', content: '긴'.repeat(300) }, logo: { name: 'l.png', type: 'image/png', size: 9 } },
  input: {
    place: '대전', file: { name: 'a.png', type: 'image/png', size: 10, dataUrl: 'data:image/png;base64,AAAA' }, body: '가'.repeat(250),
    attach: [{ file: { name: 'b.pdf', type: 'application/pdf' }, note: 'data:text/plain;base64,QUJD' }], setting: { tag: 'data:x', extra: 'e' }, n: 3, flag: false,
  },
};
t('clipRecord — log:false 사전설정은 빼고, 파일은 이름·형식만, 긴 글은 200자에서 자르고, data: 글은 어디 있든 바이트 수만. 입력은 그대로', () => {
  const before = JSON.stringify(RECORD);
  assert.deepEqual(clipRecord(RECORD, ENTRY), {
    v: 1, action: 'x.y', at: 1, by: 'ui', via: null, hash: 'deadbeef',
    preset: { me: '김기현', logo: { name: 'l.png', type: 'image/png' } },
    input: {
      place: '대전', file: { name: 'a.png', type: 'image/png' }, body: `${'가'.repeat(200)}…(250자)`,
      attach: [{ file: { name: 'b.pdf', type: 'application/pdf' }, note: '[data 27바이트]' }], setting: { tag: '[data 6바이트]', extra: 'e' }, n: 3, flag: false,
    },
  });
  assert.equal(JSON.stringify(RECORD), before);
  assert.ok(!JSON.stringify(clipRecord(RECORD, ENTRY)).includes('AAAA'));
  assert.equal(clipRecord(RECORD, ENTRY, { max: 50 }).input.body, `${'가'.repeat(50)}…(250자)`);
  assert.deepEqual(clipRecord({ v: 1, input: { s: 'x'.repeat(201) }, preset: { p: 1 } }, undefined).input.s, `${'x'.repeat(200)}…(201자)`, '명세가 없어도 자른다');
  assert.equal(clipString('data:'), '[data 5바이트]');
});
t('clipResult — 정해 둔 키와 그 밖의 스칼라만. 객체·배열·함수는 빼고, error 가 Error 면 message, 긴 글은 300자', () => {
  const out = clipResult({ ok: true, verified: true, docNo: 'D-1', seq: 3, message: 'm'.repeat(400), error: new Error('boom'), row: { a: 1 }, list: [1], fn: () => {}, note: 'n', count: 0, flag: false, nothing: null, big: 'data:abc' });
  assert.deepEqual(out, { ok: true, verified: true, docNo: 'D-1', seq: 3, message: `${'m'.repeat(300)}…(400자)`, error: 'boom', note: 'n', count: 0, flag: false, nothing: null, big: '[data 8바이트]' });
  assert.deepEqual(Object.keys(out).slice(0, 6), ['ok', 'verified', 'docNo', 'seq', 'message', 'error']);
  for (const x of [undefined, null, 'x', 3, [1], () => {}]) assert.deepEqual(clipResult(x), {});
});

console.log('한 줄 요약');
t('describe — {칸} 은 input, {preset.키} 는 사전설정. 배열은 · 로, 빈 값은 빈 글, 겹친 공백과 끝의 구분 기호는 정리', () => {
  const entry = { title: '출장 신청', summary: '출장 {dateFrom}~{dateTo} {place} · {purpose} {transport} {preset.me} {preset.project}' };
  const rec = { input: { dateFrom: '2026-10-20', dateTo: null, place: '대전', purpose: '', transport: ['train', 'plane'] }, preset: { me: '김기현', project: { name: '차단기 과제' } } };
  assert.equal(describe(rec, entry), '출장 2026-10-20~ 대전 · train·plane 김기현 차단기 과제');
  assert.equal(describe({ input: { room: 'A', title: '' } }, { title: '회의실 예약', summary: '{room} · {title}' }), 'A');
  assert.equal(describe({ input: {} }, { title: '회의실 예약', summary: '{room} · {title}' }), '회의실 예약', '다 비면 title');
  assert.equal(describe({ action: 'a.b', input: { x: 1 } }, { title: '제목' }), '제목', '틀이 없으면 title');
  assert.equal(describe({ action: 'a.b' }, {}), 'a.b');
  assert.equal(describe({ input: { n: 0, f: false }, preset: { setup: { dept: '연구본부' } } }, { summary: '{n} {f} {preset.setup.dept} {input.n}' }), '0 false 연구본부 0', '0·false 는 값이고 점 경로도 된다');
});

console.log('YAML 글');
t('toYaml — 맵은 키: 값, 안쪽은 2칸, 목록은 - 줄, 글은 필요할 때만 작은따옴표, 여러 줄 글은 블록', () => {
  assert.equal(toYaml({ action: 'attend.trip', input: { place: '대전', start: '07:00', transport: ['train', 'plane'], note: null, memo: '첫 줄\n둘째 줄' }, rows: [{ a: 1, b: 'x' }], flag: true }),
    [
      'action: attend.trip',
      'input:',
      '  place: 대전',
      "  start: '07:00'",
      '  transport:',
      '    - train',
      '    - plane',
      '  note: null',
      '  memo: |-',
      '    첫 줄',
      '    둘째 줄',
      'rows:',
      '  - a: 1',
      '    b: x',
      'flag: true',
      '',
    ].join('\n'));
  assert.equal(toYaml({ a: 1, b: [] }, { indent: 2 }), '  a: 1\n  b: []\n');
  assert.equal(toYaml('x'), 'x\n');
  assert.equal(toYaml(null), 'null\n');
  assert.equal(toYaml({}), '{}\n');
  assert.equal(toYaml([{ k: 'v' }, [1, 2], 'z']), '- k: v\n- - 1\n  - 2\n- z\n');
});
t('toYaml 의 둥근 왕복 — yaml 로 다시 읽으면 같은 값이다(따옴표가 필요한 글·날짜·시각·수처럼 보이는 글·블록·빈 것·특수 키)', () => {
  const value = {
    v: 1, action: 'attend.trip', at: 1760600000000, by: 'ui', via: null,
    preset: { today: '2026-10-16', me: '김기현', start: '07:00', expense: 'Y', transport: ['train'], setup: { dept: '연구본부 수소전기추진연구팀', head: null }, project: { name: 'MW급 10kV 과제: 차단기', about: '# 개요 - 시작' } },
    input: {
      dateFrom: '2026-10-20', days: 2, place: ' 대전', venue: '', purpose: "it's: fine", settle: true, car: false, rate: 1.5, neg: -3, big: 1e21, zero: 0,
      body: '첫 줄\n둘째 줄\n\n넷째 줄', trail: '끝에 줄바꿈\n', many: '둘\n\n\n', tab: 'a\tb', crlf: 'a\r\nb', lead: '\n앞이 빈 줄', spaced: ' 앞 공백\n뒤', inner: '줄\n  들여쓴 줄',
      texts: ['true', 'no', 'Yes', 'NULL', '~', '2026-10-20', '2026-10-20 09:00', '12:30', '0x1f', '1_000', '.5', '1e3', '+7', '-', '- x', '? q', '[a]', '{b}', '#c', 'd #e', 'f: g', 'h:', '@i', '`j', '%k', '&l', '*m', '!n', '|o', '>p', "'q", '"r', '', '  ', '---', '...', 'a, b', 'a:b', 'c,d', 'e]f', '한글 — 특수 문자 · 점', 'é', "it's", 'x "y" z', '끝 '],
      rows: [{ name: 'a.png', kind: null }, { name: 'b.png', kind: '견적서' }],
      nested: [[1, 2], [], {}, [{ x: 'y', z: [3] }], 'z', null, true, ['a\nb']],
      empty: {}, none: [],
      2026: 'year key', 'a: b': 'colon key', '': 'empty key', '# c': 'hash key', 'multi\nline': 'nl key', ' lead': 'space key', 'true': 'bool key', '-': 'dash key',
    },
  };
  const text = toYaml(value);
  assert.deepEqual(parse(text), value);
  assert.deepEqual(parse(toYaml(value, { indent: 4 })), value, 'indent 를 줘도 같은 값');
  for (const s of ['', ' ', 'a\n', '\n', '\n\n', 'a\n\n', 'a\nb\n\n\n', ' \n ', '\t', 'x\ty\n z']) assert.deepEqual(parse(toYaml({ s })), { s }, JSON.stringify(s));
});

console.log(`\n통과 ${pass}건`);
