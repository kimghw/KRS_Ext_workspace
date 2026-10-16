// 사전설정 채우기(actions/preset.js) — from 문법 · storage 모아 읽기 · recipe · ctx · value 깊은 복사 · 모르는 from 은 throw.
import assert from 'node:assert/strict';

import { parseFrom, resolvePreset } from '../preset.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

console.log('from 문법');
t('다섯 출처를 푼다 — 점 경로는 안쪽', () => {
  assert.deepEqual(parseFrom('today'), { source: 'today', key: '', path: [] });
  assert.deepEqual(parseFrom(' me '), { source: 'me', key: '', path: [] });
  assert.deepEqual(parseFrom('storage:attendWorkplace'), { source: 'storage', key: 'attendWorkplace', path: [] });
  assert.deepEqual(parseFrom('storage:gongmunPreset.people.head'), { source: 'storage', key: 'gongmunPreset', path: ['people', 'head'] });
  assert.deepEqual(parseFrom('recipe:settings.profiles.연구품의'), { source: 'recipe', key: 'settings', path: ['profiles', '연구품의'] });
  assert.deepEqual(parseFrom('ctx:project'), { source: 'ctx', key: 'project', path: [] });
  assert.deepEqual(parseFrom('ctx:project.lead'), { source: 'ctx', key: 'project', path: ['lead'] });
});
t('틀린 글은 throw — 모르는 출처·빈 키·끊긴 경로·글이 아닌 것', () => {
  for (const bad of ['nope', 'storage:', 'storage:a..b', 'today:x', 'me:x', 'env:HOME', '', null, 42, undefined]) {
    assert.throws(() => parseFrom(bad), /모르는 사전설정 출처/, String(bad));
  }
});

console.log('채우기');
const PRESET = {
  today: { from: 'today', desc: '오늘' },
  me: { from: 'me', desc: '나' },
  workplace: { from: 'storage:attendWorkplace', desc: '근무지' },
  dept: { from: 'storage:gongmunPreset.dept', desc: '부서' },
  head: { from: 'storage:gongmunPreset.people.head', desc: '부서장' },
  missing: { from: 'storage:nothing.here', desc: '없음' },
  profile: { from: 'recipe:settings.profiles.출장품의', type: 'object', desc: '프로파일' },
  project: { from: 'ctx:project', type: 'object', desc: '과제' },
  lead: { from: 'ctx:project.lead', desc: '책임자' },
  gone: { from: 'ctx:nothing', desc: '없는 ctx' },
  start: { value: '07:00', type: 'time', desc: '출발' },
  transport: { value: ['train'], type: 'tags', desc: '교통편' },
  setting: { value: { retention: '36', tags: ['a'] }, type: 'object', desc: '설정' },
};
const RECIPE = { settings: { profiles: { 출장품의: { tag: '출장' }, 연구품의: {} } } };
const STORE = { attendWorkplace: '부산', gongmunPreset: { dept: '연구본부', people: { head: '박기도' } } };

await ta('storage 는 키를 모아 한 번만 읽고(중복 없이), 점 경로로 안쪽을 집으며, 레시피·ctx·value 도 채운다. 없으면 null', async () => {
  const calls = [];
  const storage = async (keys) => { calls.push(keys); return STORE; };
  const ctx = { project: { name: '과제', lead: '박기도' } };
  const out = await resolvePreset(PRESET, { storage, me: '김기현', today: '2026-10-16', recipe: RECIPE, ctx });
  assert.deepEqual(calls, [['attendWorkplace', 'gongmunPreset', 'nothing']]);
  assert.deepEqual(out, {
    today: '2026-10-16', me: '김기현', workplace: '부산', dept: '연구본부', head: '박기도', missing: null,
    profile: { tag: '출장' }, project: { name: '과제', lead: '박기도' }, lead: '박기도', gone: null,
    start: '07:00', transport: ['train'], setting: { retention: '36', tags: ['a'] },
  });
  assert.deepEqual(Object.keys(out), Object.keys(PRESET), '맵의 키만, 그 차례로');
});
await ta('값은 깊은 복사다 — 결과를 고쳐도 명세·레시피·ctx·저장소가 바뀌지 않는다', async () => {
  const store = structuredClone(STORE);
  const recipe = structuredClone(RECIPE);
  const ctx = { project: { name: '과제', lead: '박기도' } };
  const out = await resolvePreset(PRESET, { storage: async () => store, me: '김기현', today: '2026-10-16', recipe, ctx });
  out.transport.push('plane');
  out.setting.tags.push('b');
  out.profile.tag = 'z';
  out.project.name = 'q';
  assert.deepEqual(PRESET.transport.value, ['train']);
  assert.deepEqual(PRESET.setting.value, { retention: '36', tags: ['a'] });
  assert.deepEqual(recipe, RECIPE);
  assert.equal(ctx.project.name, '과제');
  store.gongmunPreset.dept = '바뀜';
  assert.equal(out.dept, '연구본부', '저장소에서 받은 것도 복사본이다');
});
await ta('today·me 가 비어 있으면 null', async () => {
  assert.deepEqual(await resolvePreset({ today: { from: 'today', desc: '오늘' }, me: { from: 'me', desc: '나' } }, {}), { today: null, me: null });
});
await ta('storage 를 쓰는 명세인데 저장소가 없으면 throw, 레시피가 없으면 throw — 안 쓰는 명세는 괜찮다', async () => {
  await assert.rejects(resolvePreset({ w: { from: 'storage:x', desc: 'x' } }, { me: '나' }), /저장소\(storage\)가 없어/);
  await assert.rejects(resolvePreset({ p: { from: 'recipe:settings', desc: 'p' } }, { storage: async () => ({}) }), /레시피\(recipe\)가 없어/);
  let called = 0;
  assert.deepEqual(await resolvePreset({ me: { from: 'me', desc: '나' }, n: { value: 1, desc: 'n' } }, { me: '나', storage: async () => { called++; return {}; } }), { me: '나', n: 1 });
  assert.equal(called, 0, '저장소 키가 없으면 읽지 않는다');
});
await ta('모르는 출처·from 과 value 를 같이 적은 것·꼴이 틀린 항목은 throw', async () => {
  await assert.rejects(resolvePreset({ x: { from: 'env:HOME', desc: 'x' } }, {}), /사전설정 x: 모르는 사전설정 출처/);
  await assert.rejects(resolvePreset({ x: { from: 'me', value: 1, desc: 'x' } }, {}), /from 과 value 가운데 하나만/);
  await assert.rejects(resolvePreset({ x: { desc: 'x' } }, {}), /from 과 value 가운데 하나만/);
  await assert.rejects(resolvePreset({ x: 'me' }, {}), /꼴이 틀렸습니다/);
});
await ta('행위 명세 자체(id·preset)를 줘도 그 preset 을 쓰고, 빈 맵은 빈 결과', async () => {
  assert.deepEqual(await resolvePreset({ id: 'a.b', preset: { me: { from: 'me', desc: '나' } } }, { me: '김기현' }), { me: '김기현' });
  assert.deepEqual(await resolvePreset({}, {}), {});
  assert.deepEqual(await resolvePreset(undefined, {}), {});
});

console.log(`\n통과 ${pass}건`);
