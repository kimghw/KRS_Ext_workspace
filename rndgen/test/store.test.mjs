// R&D 탭의 YAML 원문 저장소(rndgen/store.js) — chrome.storage.local 'rndYamlText' 의 꼴 맞추기, 만들기만으로는 저장소를 보지 않음(함수로 받은 저장소는
// 처음 쓸 때 부름 · chrome 이 없으면 load 가 던지고 다음에 다시 해 봄), 읽어 외운 뒤 get·history 는 동기, put(지금 판을 지난 판 앞으로 · 다섯 개까지 ·
// 같은 글이면 밀지 않음 · 되돌아간 판은 겹치지 않음), remove(과제 통째), 줄 세우기(겹친 put 이 서로 지우지 않음), 쓰기 실패 때 되돌림. 저장소는 가짜다.
import assert from 'node:assert/strict';

import { YAML_KEY, HISTORY_MAX, normalizeYamlStore, createYamlStore } from '../store.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

/** chrome.storage.local 과 같은 약속(get(key) → { [key]: 값 } · set({ key: 값 }))의 가짜. 넣고 꺼낼 때 베낀다. */
function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  const s = {
    data, gets: 0, sets: 0, fail: 0,
    async get(key) { s.gets++; return Object.hasOwn(data, key) ? { [key]: structuredClone(data[key]) } : {}; },
    async set(obj) {
      if (s.fail > 0) { s.fail--; throw new Error('저장 실패(가짜)'); }
      s.sets++;
      Object.assign(data, structuredClone(obj));
    },
  };
  return s;
}
const AT = Date.UTC(2026, 9, 16, 1, 2, 3);
const ISO = '2026-10-16T01:02:03.000Z';
const E = (text, more = {}) => ({ text, rev: '', file: '', source: 'file', summary: '', ...more });

console.log('꼴 맞추기');
t('모르는 것은 { v: 1, projects: {} }', () => {
  for (const raw of [undefined, null, 'x', [], {}, { projects: [] }, { projects: 'x' }]) assert.deepEqual(normalizeYamlStore(raw), { v: 1, projects: {} });
  assert.equal(YAML_KEY, 'rndYamlText');
  assert.equal(HISTORY_MAX, 5);
});
t('판의 꼴 · 모르는 source 는 file · 지금 판이 없는 차년도와 차년도가 없는 과제는 버림 · 지난 판은 다섯까지 · 차년도 키는 1~20', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ text: `h${i}` }));
  const got = normalizeYamlStore({
    v: 9,
    projects: {
      p1: {
        2: { current: { text: 'a: 1', rev: ' r2 ', at: ISO, file: 'KR_x_r2.yaml', source: 'revise', summary: '바꿈', extra: 1 }, history: [{ text: 'a: 0', source: '???' }, { text: '' }, null] },
        4: { current: { text: 'b' }, history: many },
        0: { current: { text: 'zero' } },
        21: { current: { text: 'too far' } },
        차: { current: { text: 'not a year' } },
        3: { current: { text: '   ' }, history: [{ text: 'orphan' }] },
      },
      p2: { 1: { history: [{ text: 'x' }] } },
      p3: 'x',
      '': { 1: { current: { text: 'no id' } } },
    },
  });
  assert.deepEqual(Object.keys(got.projects), ['p1']);
  assert.deepEqual(Object.keys(got.projects.p1), ['2', '4']);
  assert.deepEqual(got.projects.p1['2'], {
    current: { text: 'a: 1', rev: 'r2', at: ISO, file: 'KR_x_r2.yaml', source: 'revise', summary: '바꿈' },
    history: [{ text: 'a: 0', rev: '', at: '', file: '', source: 'file', summary: '' }],
  });
  assert.deepEqual(got.projects.p1['4'].history.map((e) => e.text), ['h0', 'h1', 'h2', 'h3', 'h4']);
});

console.log('만들기·읽기');
await ta('만들기만으로는 저장소를 보지 않는다 — 함수로 받은 저장소는 처음 쓸 때 한 번 부르고, 읽기 전 get/history 는 비어 있음', async () => {
  const fake = fakeStorage({ [YAML_KEY]: { v: 1, projects: { p: { 1: { current: { text: 'a: 1', rev: 'r0' } } } } } });
  let called = 0;
  const store = createYamlStore({ storage: () => { called++; return fake; } });
  assert.equal(called, 0);
  assert.equal(store.get('p', 1), null);
  assert.deepEqual(store.history('p', 1), []);
  assert.deepEqual(store.all(), { v: 1, projects: {} });
  const all = await store.load();
  await store.load();
  assert.deepEqual([called, fake.gets], [1, 1], '한 번만 읽는다');
  assert.equal(all, store.all());
  assert.deepEqual(store.get('p', 1), { text: 'a: 1', rev: 'r0', at: '', file: '', source: 'file', summary: '' });
  assert.deepEqual(store.get('p', '1'), store.get('p', 1), '차년도는 글이어도');
  const got = store.get('p', 1);
  got.text = '고침';
  assert.equal(store.get('p', 1).text, 'a: 1', '돌려준 것은 사본');
  assert.equal(store.get('없음', 1), null);
  assert.equal(store.get('p', 0), null);
});
await ta('chrome 이 없으면 load 가 던지고, 생기면 다시 해 본다(기본 저장소는 처음 쓸 때 본 chrome.storage.local)', async () => {
  const saved = globalThis.chrome;
  delete globalThis.chrome;
  try {
    const store = createYamlStore();
    await assert.rejects(store.load(), /chrome\.storage\.local/);
    const fake = fakeStorage();
    globalThis.chrome = { storage: { local: fake } };
    assert.deepEqual(await store.load(), { v: 1, projects: {} });
    await store.put('p', 1, E('a: 1'));
    assert.equal(fake.data[YAML_KEY].projects.p['1'].current.text, 'a: 1');
  } finally {
    if (saved === undefined) delete globalThis.chrome;
    else globalThis.chrome = saved;
  }
});

console.log('넣기');
await ta('put — load 전이면 먼저 읽고(다른 과제 것은 둔다), 지금 판을 지난 판 앞으로 밀며, at 이 없으면 now()', async () => {
  const fake = fakeStorage({ [YAML_KEY]: { v: 1, projects: { other: { 1: { current: { text: 'o' } } } } } });
  const store = createYamlStore({ storage: fake, now: () => AT });
  const first = await store.put('p', 2, { text: 'r0 글', rev: 'r0', file: 'KR_가.yaml', source: 'extract' });
  assert.deepEqual(first, { text: 'r0 글', rev: 'r0', at: ISO, file: 'KR_가.yaml', source: 'extract', summary: '' });
  assert.deepEqual(store.history('p', 2), []);
  await store.put('p', 2, { text: 'r1 글', rev: 'r1', at: '2026-10-17T00:00:00.000Z', file: 'KR_가_r1.yaml', source: 'revise', summary: '연구재료비 늘림' });
  assert.deepEqual([store.get('p', 2).rev, store.get('p', 2).at, store.get('p', 2).summary], ['r1', '2026-10-17T00:00:00.000Z', '연구재료비 늘림']);
  assert.deepEqual(store.history('p', 2).map((e) => e.rev), ['r0']);
  assert.deepEqual(fake.data[YAML_KEY], store.all(), '외운 것을 통째로 쓴다');
  assert.equal(fake.data[YAML_KEY].projects.other['1'].current.text, 'o', '다른 과제 것은 그대로');
  assert.equal(fake.data[YAML_KEY].v, 1);
});
await ta('지난 판은 다섯까지(최신이 앞) · 같은 글이면 밀지 않고 at·source 만 · 되돌아간 판은 지난 판에서 빠진다', async () => {
  const fake = fakeStorage();
  let clock = AT;
  const store = createYamlStore({ storage: fake, now: () => clock });
  for (let i = 0; i < 8; i++) await store.put('p', 1, E(`판 ${i}`, { rev: `r${i}` }));
  assert.equal(store.get('p', 1).text, '판 7');
  assert.deepEqual(store.history('p', 1).map((e) => e.text), ['판 6', '판 5', '판 4', '판 3', '판 2']);
  const sets = fake.sets;
  clock = AT + 60_000;
  const same = await store.put('p', 1, { text: '판 7', rev: 'r99', source: 'paste' });
  assert.deepEqual([same.rev, same.source, same.at], ['r7', 'paste', '2026-10-16T01:03:03.000Z'], '같은 글 — rev 는 그대로');
  assert.equal(store.history('p', 1).length, 5);
  assert.equal(fake.sets, sets + 1, '그래도 쓴다(at·source)');
  await store.put('p', 1, E('판 5'));
  assert.deepEqual(store.history('p', 1).map((e) => e.text), ['판 7', '판 6', '판 4', '판 3', '판 2'], '판 5 가 지난 판에 둘이 되지 않는다');
});
await ta('과제 id·차년도·글이 없으면 던지고, 줄은 이어진다 · 겹친 put 은 서로 지우지 않는다', async () => {
  const fake = fakeStorage();
  const store = createYamlStore({ storage: fake, now: () => AT });
  await assert.rejects(store.put('', 1, E('a')), /저장할 과제가 없습니다/);
  await assert.rejects(store.put('p', 0, E('a')), /저장할 차년도가 없습니다/);
  await assert.rejects(store.put('p', 21, E('a')), /저장할 차년도가 없습니다/);
  await assert.rejects(store.put('p', 1, E('  \n')), /저장할 YAML 글이 없습니다/);
  await assert.rejects(store.put('p', 1, null), /저장할 YAML 글이 없습니다/);
  assert.equal(fake.sets, 0);
  await Promise.all([store.put('p', 1, E('a')), store.put('p', 2, E('b')), store.put('q', 1, E('c')), store.put('p', 1, E('a2'))]);
  const d = fake.data[YAML_KEY].projects;
  assert.deepEqual([d.p['1'].current.text, d.p['1'].history.map((e) => e.text), d.p['2'].current.text, d.q['1'].current.text], ['a2', ['a'], 'b', 'c']);
});
await ta('쓰기가 실패하면 외운 것도 되돌리고 던진다 — 다음 put 은 된다', async () => {
  const fake = fakeStorage();
  const store = createYamlStore({ storage: fake, now: () => AT });
  await store.put('p', 1, E('처음'));
  fake.fail = 1;
  await assert.rejects(store.put('p', 1, E('실패할 것')), /저장 실패/);
  assert.equal(store.get('p', 1).text, '처음');
  assert.deepEqual(store.history('p', 1), []);
  await store.put('p', 1, E('다음'));
  assert.deepEqual([store.get('p', 1).text, store.history('p', 1).map((e) => e.text)], ['다음', ['처음']]);
  assert.deepEqual(fake.data[YAML_KEY], store.all());
});

console.log('지우기');
await ta('remove — 과제 통째로 지우고 쓴다 · 없던 과제면 쓰지 않는다 · load 전이어도 된다', async () => {
  const fake = fakeStorage({ [YAML_KEY]: { v: 1, projects: { p: { 1: { current: { text: 'a' } }, 2: { current: { text: 'b' } } }, q: { 1: { current: { text: 'c' } } } } } });
  const store = createYamlStore({ storage: fake });
  await store.remove('p');
  assert.deepEqual(Object.keys(fake.data[YAML_KEY].projects), ['q']);
  assert.equal(store.get('p', 1), null);
  const sets = fake.sets;
  await store.remove('없는 과제');
  await store.remove(undefined);
  assert.equal(fake.sets, sets);
  assert.equal(store.get('q', 1).text, 'c');
});

console.log(`\n${pass} passed`);
