// 설정 → 일반의 행위 명세(src/specview.js): 갈래 차례, 갈래마다 공통(_domain.yaml)이 먼저, 목록과 actions/spec 폴더의 YAML 이 하나도 빠짐없이 맞는지.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { specGroups, yamlLines, DOMAIN_ORDER, SPEC_DIR } from '../src/specview.js';
import { ACTIONS } from '../actions/spec.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const root = new URL('../', import.meta.url);
const groups = specGroups(ACTIONS);

console.log('갈래');
t('머리의 탭 줄 차례 — 근태 · 여비계산서 · 공문 · R&D · 메일 · 회의실 · 차량 · 홈 카드 · 회람', () =>
  assert.deepEqual(groups.map((g) => g.title), ['근태', '여비계산서', '공문', 'R&D', '메일', '회의실', '차량', '홈 카드', '회람']));
t('DOMAIN_ORDER 에 없는 갈래는 맨 끝, 이름 차례', () => {
  const spec = { domains: { zz: { kinds: [] }, aa: { kinds: [] }, attend: { title: '근태', kinds: [] } }, actions: {} };
  assert.deepEqual(specGroups(spec).map((g) => g.domain), ['attend', 'aa', 'zz']);
});
t('DOMAIN_ORDER 가 생성물의 갈래를 모두 안다(새 갈래 폴더를 만들면 자리를 준다)', () => {
  for (const d of Object.keys(ACTIONS.domains)) assert.ok(DOMAIN_ORDER.includes(d), d);
});
t('빈 명세에도 넘어지지 않는다', () => {
  assert.deepEqual(specGroups(undefined), []);
  assert.deepEqual(specGroups({}), []);
});

console.log('파일');
t('갈래마다 공통(_domain.yaml)이 맨 앞, 나머지는 _domain.yaml 의 kinds 차례', () => {
  for (const g of groups) {
    assert.deepEqual(g.files[0], { key: '_domain', label: '공통', path: `${SPEC_DIR}/${g.domain}/_domain.yaml`, status: '' });
    assert.deepEqual(g.files.slice(1).map((f) => f.key), ACTIONS.domains[g.domain].kinds, g.domain);
  }
});
t('종류의 이름은 명세의 title, 상태는 live|planned', () => {
  const gm = groups.find((g) => g.domain === 'gongmun');
  assert.equal(gm.files.find((f) => f.key === 'purchase').label, ACTIONS.actions['gongmun.purchase'].title);
  for (const g of groups) for (const f of g.files.slice(1)) assert.ok(['live', 'planned'].includes(f.status), `${g.domain}.${f.key}`);
  const rnd = groups.find((g) => g.domain === 'rnd');
  assert.equal(rnd.files.find((f) => f.key === 'erp.fetch').path, 'actions/spec/rnd/erp.fetch.yaml');
});
t('목록의 경로는 모두 있는 파일이고, actions/spec 의 YAML 은 모두 목록에 있다', () => {
  const listed = new Set(groups.flatMap((g) => g.files.map((f) => f.path)));
  for (const p of listed) assert.ok(fs.existsSync(new URL(p, root)), `없는 파일: ${p}`);
  const onDisk = [];
  for (const d of fs.readdirSync(new URL(`${SPEC_DIR}/`, root), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of fs.readdirSync(new URL(`${SPEC_DIR}/${d.name}/`, root))) if (f.endsWith('.yaml')) onDisk.push(`${SPEC_DIR}/${d.name}/${f}`);
  }
  assert.deepEqual(onDisk.filter((p) => !listed.has(p)), [], '목록에 없는 YAML');
  assert.equal(listed.size, onDisk.length);
});

console.log('YAML 칠하기(yamlLines)');
const marks = (s) => yamlLines(s).map((l) => [l.ind, l.parts.filter((p) => p.c).map((p) => `${p.c}:${p.t}`)]);
t('actions/spec 의 YAML 은 모두 조각을 이으면 원본과 한 글자도 다르지 않다', () => {
  for (const g of groups) for (const f of g.files) {
    const text = fs.readFileSync(new URL(f.path, root), 'utf8');
    const back = yamlLines(text).map((l) => l.parts.map((p) => p.t).join('')).join('\n');
    assert.equal(back, text.replace(/\r\n?/g, '\n').replace(/\n$/, ''), f.path);
  }
});
t('키 · 수 · true/false/null · 따옴표 글 · 따옴표 없는 값', () => {
  assert.deepEqual(marks("max: 20\nok: true\nnone: null\nexample: '145580'\ntitle: 사전정산 다시 저장"), [
    [0, ['key:max', 'punct::', 'num:20']],
    [0, ['key:ok', 'punct::', 'bool:true']],
    [0, ['key:none', 'punct::', 'bool:null']],
    [0, ['key:example', 'punct::', "str:'145580'"]],
    [0, ['key:title', 'punct::', 'val:사전정산 다시 저장']],
  ]);
});
t('주석 — 줄 전체, 값 뒤의 ` #`. 따옴표 안의 # 와 한글 글 속의 따옴표는 주석을 가르지 않는다', () => {
  assert.deepEqual(marks("# 머리 주석\nhint: 출장   # 짧은 이름\nsummary: '{seq} #1'\nnext: 저장한 뒤 '사전정산' 을 # 끝"), [
    [0, ['cmt:# 머리 주석']],
    [0, ['key:hint', 'punct::', 'val:출장', 'cmt:# 짧은 이름']],
    [0, ['key:summary', 'punct::', "str:'{seq} #1'"]],
    [0, ['key:next', 'punct::', "val:저장한 뒤 '사전정산' 을", 'cmt:# 끝']],
  ]);
});
t('흐름 꼴 — 괄호·쉼표는 기호, 안의 `키:` 는 키, 따옴표 안의 쉼표는 글', () => {
  assert.deepEqual(marks("  tripMe:    { from: ctx:tripMe, desc: 'a, b' }"), [
    [2, ['key:tripMe', 'punct::', 'punct:{', 'key:from', 'punct::', 'val:ctx:tripMe', 'punct:,', 'key:desc', 'punct::', "str:'a, b'", 'punct:}']],
  ]);
});
t('목록 기호 뒤는 그 자리부터 들여쓴다(접힌 줄이 맞출 자리)', () => {
  assert.deepEqual(marks('uses:\n  - { module: src/travel.js, export: prePlan }\n  - 그냥 글'), [
    [0, ['key:uses', 'punct::']],
    [4, ['punct:- ', 'punct:{', 'key:module', 'punct::', 'val:src/travel.js', 'punct:,', 'key:export', 'punct::', 'val:prePlan', 'punct:}']],
    [4, ['punct:- ', 'val:그냥 글']],
  ]);
});
t('블록 글(| · >-) 아래의 더 깊은 줄과 빈 줄은 글 그대로 — 안의 `키:` · `#` 도 글', () => {
  assert.deepEqual(marks('role: >-\n  당신은: 도우미 # 아님\n\n  둘째 줄\nnext: 끝'), [
    [0, ['key:role', 'punct::', 'punct:>-']],
    [2, ['str:당신은: 도우미 # 아님']],
    [0, []],
    [2, ['str:둘째 줄']],
    [0, ['key:next', 'punct::', 'val:끝']],
  ]);
});
t('CRLF·끝 줄바꿈·빈 글', () => {
  assert.deepEqual(marks('a: 1\r\nb: 2\r\n'), [[0, ['key:a', 'punct::', 'num:1']], [0, ['key:b', 'punct::', 'num:2']]]);
  assert.deepEqual(yamlLines(''), [{ ind: 0, parts: [] }]);
  assert.deepEqual(yamlLines(undefined), [{ ind: 0, parts: [] }]);
});

console.log(`\n${pass} passed`);
