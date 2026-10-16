// 사전설정 채우기 — 사용자가 그때그때 적지 않는 값(오늘·내 이름·저장소·레시피·패널의 ctx)을 명세의 from 대로 모아 기록에 담는다.
//
//   parseFrom(from)                'storage:gongmunPreset.dept' → { source: 'storage', key: 'gongmunPreset', path: ['dept'] }. 틀리면 throw
//   resolvePreset(presetMap, deps) → { 키: 값 }   from 이 못 찾으면 null. storage 는 한 번에 모아 읽는다(키 중복 제거)
//
// 순수하다 — chrome.storage 는 deps.storage 로 받는다(패널이 (keys) => chrome.storage.local.get(keys) 를 준다). 레시피도 인자다.

const SOURCES = new Set(['today', 'me', 'storage', 'recipe', 'ctx']);

/**
 * from 글을 푼다.
 *   today · me                       패널이 주는 값
 *   storage:<키>[.<경로>]            chrome.storage.local 의 키(점 경로로 안쪽)
 *   recipe:<레지스트리>.<경로>       RECIPE 의 값
 *   ctx:<이름>[.<경로>]              패널이 build 때 주는 ctx
 * @returns {{source: 'today'|'me'|'storage'|'recipe'|'ctx', key: string, path: string[]}}
 */
export function parseFrom(from) {
  const bad = () => new Error(`모르는 사전설정 출처 ${JSON.stringify(from)}`);
  if (typeof from !== 'string') throw bad();
  const s = from.trim();
  if (s === 'today' || s === 'me') return { source: s, key: '', path: [] };
  const m = s.match(/^([a-z]+):(.+)$/);
  if (!m || !SOURCES.has(m[1]) || m[1] === 'today' || m[1] === 'me') throw bad();
  const parts = m[2].split('.').map((p) => p.trim());
  if (parts.some((p) => !p)) throw bad();
  return { source: m[1], key: parts[0], path: parts.slice(1) };
}

/** 깊은 복사 — 기록이 명세·저장소·레시피·패널의 산 객체를 가리키지 않게. 함수가 섞여 있으면 JSON 으로(빠진다). */
export function clone(v) {
  if (v === null || v === undefined || typeof v !== 'object') return v;
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
}

/** 점 경로로 안쪽을 집는다. 길이 끊기면 undefined. */
function walk(obj, path) {
  let cur = obj;
  for (const p of path) {
    if (cur == null || typeof cur !== 'object' || !Object.hasOwn(cur, p)) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * 명세의 사전설정을 채운다. 돌려주는 것은 맵의 키뿐이다(그 밖의 것은 없다).
 *
 * @param {object} presetMap 행위 명세의 preset(키마다 { from | value, type?, desc, log?, required? }). 행위 명세 자체(id·preset 이 있는 것)를 줘도 그 preset 을 쓴다
 * @param {{ storage?: (keys: string[]) => Promise<object>|object, me?: string, today?: string, recipe?: object|null, ctx?: object }} deps
 * @returns {Promise<Record<string, unknown>>}
 */
export async function resolvePreset(presetMap, { storage, me = '', today = '', recipe = null, ctx = {} } = {}) {
  const map = presetMap && typeof presetMap.id === 'string' && presetMap.preset && typeof presetMap.preset === 'object' ? presetMap.preset : presetMap || {};
  const plan = [];
  const keys = new Set();
  for (const [key, p] of Object.entries(map)) {
    if (!p || typeof p !== 'object') throw new Error(`사전설정 ${key}: 꼴이 틀렸습니다`);
    const hasValue = Object.hasOwn(p, 'value');
    const hasFrom = Object.hasOwn(p, 'from');
    if (hasValue === hasFrom) throw new Error(`사전설정 ${key}: from 과 value 가운데 하나만 적습니다`);
    if (hasValue) { plan.push({ key, value: p.value }); continue; }
    let from;
    try { from = parseFrom(p.from); } catch (err) { throw new Error(`사전설정 ${key}: ${err.message}`); }
    if (from.source === 'storage') {
      if (typeof storage !== 'function') throw new Error(`사전설정 ${key}: 저장소(storage)가 없어 ${p.from} 을 채울 수 없습니다`);
      keys.add(from.key);
    }
    if (from.source === 'recipe' && (!recipe || typeof recipe !== 'object')) throw new Error(`사전설정 ${key}: 레시피(recipe)가 없어 ${p.from} 을 채울 수 없습니다`);
    plan.push({ key, from });
  }
  // 저장소는 한 번만 읽는다 — 키를 모아 한 번의 get 으로.
  const got = keys.size ? (await storage([...keys])) || {} : {};
  const out = {};
  for (const item of plan) {
    if (!item.from) { out[item.key] = clone(item.value); continue; }
    const { source, key, path } = item.from;
    let v;
    if (source === 'today') v = today || undefined;
    else if (source === 'me') v = me || undefined;
    else if (source === 'storage') v = walk(got, [key, ...path]);
    else if (source === 'recipe') v = walk(recipe, [key, ...path]);
    else v = walk(ctx || {}, [key, ...path]);
    out[item.key] = v === undefined ? null : clone(v);
  }
  return out;
}
