// 빈 곳으로 가는 단추(src/jump.js) — 관문의 missing 을 패널의 표와 맞춰 단추로, 누르면 그 자리로.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { missingOf, labelOf, jumpsOf, paintJumps, flashFocus } from '../src/jump.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const ENTRY = {
  id: 'gongmun.purchase',
  preset: { me: { from: 'me', desc: '기안자(내 이름 — 결재선의 기안)' }, setup: { from: 'storage:gongmunPreset', desc: '공문 설정(부서·부서장) — 실명' } },
  fields: {
    title: { type: 'string', label: '제목', desc: '공문 제목' },
    rank: { type: 'enum', desc: '전결권자 직책 — 비면 규정대로' },
    draft: { type: 'object', desc: '초안', fields: { total: { type: 'number', label: '합계 (VAT 포함, 원)', desc: '합계' }, items: { type: 'list', desc: '품목', item: { name: { type: 'string', label: '품목명', desc: '품목명' } } } } },
  },
};
const err = (missing) => Object.assign(new Error('x'), { name: 'ActionError', action: 'gongmun.purchase', problems: missing.map((m) => m.key), missing });

console.log('이름');
t('칸의 label, 없으면 desc 의 첫 마디, 안쪽 칸·목록 줄의 칸도 찾는다', () => {
  assert.equal(labelOf(ENTRY, 'input', 'title'), '제목');
  assert.equal(labelOf(ENTRY, 'input', 'rank'), '전결권자 직책');
  assert.equal(labelOf(ENTRY, 'input', 'draft.total'), '합계 (VAT 포함, 원)');
  assert.equal(labelOf(ENTRY, 'input', 'draft.items[2].name'), '품목명');
  assert.equal(labelOf(ENTRY, 'input', 'nowhere'), 'nowhere');
  assert.equal(labelOf(ENTRY, 'preset', 'me'), '기안자');
  assert.equal(labelOf(ENTRY, 'preset', 'setup'), '공문 설정');
  assert.equal(labelOf(null, 'preset', 'me'), 'me');
});

console.log('단추 목록');
t('관문 오류가 아니면 빈 목록이고, 갈 곳을 모르는 칸은 뺀다', () => {
  assert.deepEqual(missingOf(new Error('x')), []);
  assert.deepEqual(jumpsOf(new Error('x'), ENTRY, { input: { title: () => {} } }), []);
  assert.deepEqual(jumpsOf(err([{ where: 'input', key: 'nowhere', why: 'missing' }]), ENTRY, { input: { title: () => {} } }), []);
});
t('같은 자리는 한 번만(차례는 오류의 차례), 안쪽 칸은 뿌리로 찾고, 그래도 없으면 field 에 맡긴다', () => {
  const seen = [];
  const table = {
    input: { title: () => seen.push('title'), draft: () => seen.push('draft-root') },
    preset: { me: { label: '내 이름', go: () => seen.push('me') }, setup: null },
    field: (root, key) => (root === 'draft' ? () => seen.push(`field:${key}`) : null),
  };
  const jumps = jumpsOf(err([
    { where: 'preset', key: 'me', why: 'missing' },
    { where: 'input', key: 'draft.total', why: 'missing' },
    { where: 'input', key: 'title', why: 'invalid' },
    { where: 'input', key: 'draft.items[0].name', why: 'missing' },
    { where: 'preset', key: 'me', why: 'unfilled' },
    { where: 'preset', key: 'setup', why: 'missing' },
  ]), ENTRY, table);
  assert.deepEqual(jumps.map((j) => [j.where, j.key, j.why, j.label]), [
    ['preset', 'me', 'missing', '내 이름'], ['input', 'draft', 'missing', '초안'], ['input', 'title', 'invalid', '제목'],
  ]);
  for (const j of jumps) j.go();
  assert.deepEqual(seen, ['me', 'draft-root', 'title'], 'input 의 뿌리 칸이 field 보다 먼저다');
  // input 에 뿌리가 없으면 field(뿌리, 전체 키)가 갈 곳을 준다.
  const only = jumpsOf(err([{ where: 'input', key: 'draft.total', why: 'missing' }]), ENTRY, { field: table.field });
  only[0].go();
  assert.equal(seen.at(-1), 'field:draft.total');
});

console.log('상태줄의 단추');
const dom = new JSDOM('<body><div id="status" class="status">까닭</div><details id="box"><summary>설정</summary><div id="group"><label>이름 <input id="name"></label></div></details></body>');
const doc = dom.window.document;
t('글 뒤에 단추를 세우고, 누르면 go 가 돌고, 다시 그리면 앞의 것은 걷는다', () => {
  const status = doc.getElementById('status');
  const seen = [];
  paintJumps(status, [{ where: 'preset', key: 'me', why: 'missing', label: '내 이름', go: () => seen.push('me') }, { where: 'input', key: 'title', why: 'invalid', label: '제목', go: () => seen.push('title') }]);
  const buttons = [...status.querySelectorAll('button.jump')];
  assert.deepEqual(buttons.map((b) => [b.dataset.jump, b.textContent, b.type]), [['preset:me', '내 이름 채우기 →', 'button'], ['input:title', '제목 고치기 →', 'button']]);
  assert.ok(status.textContent.startsWith('까닭'), '글은 그대로 앞에 있다');
  buttons[0].click();
  buttons[1].click();
  assert.deepEqual(seen, ['me', 'title']);
  paintJumps(status, [{ where: 'preset', key: 'setup', why: 'missing', label: '공문 설정', go: () => {} }]);
  assert.deepEqual([...status.querySelectorAll('button.jump')].map((b) => b.dataset.jump), ['preset:setup'], '앞의 단추는 걷혔다');
  paintJumps(status, []);
  assert.equal(status.querySelector('.jumps'), null);
  paintJumps(null, [{ go: () => {} }]);   // 상태줄이 없어도 던지지 않는다
});
await ta('그 자리로 간다 — 접힌 상자를 펴고, 안의 첫 입력 칸에 초점을 두며, 윤곽선을 잠깐 켠다', async () => {
  const group = doc.getElementById('group');
  const box = doc.getElementById('box');
  assert.equal(box.open, false);
  assert.equal(flashFocus(group, { ms: 5 }), true);
  assert.equal(box.open, true, 'details 를 편다');
  assert.equal(doc.activeElement, doc.getElementById('name'), '안의 입력 칸에 초점');
  assert.ok(group.classList.contains('jump-flash'));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!group.classList.contains('jump-flash'), '윤곽선은 잠깐이다');
  assert.equal(flashFocus(null), false);
  // 입력 칸 자체를 주면 그 칸에 초점.
  const name = doc.getElementById('name');
  doc.getElementById('status').focus?.();
  flashFocus(name, { ms: 5 });
  assert.equal(doc.activeElement, name);
});

console.log(`\n통과 ${pass}건`);
