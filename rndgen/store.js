// R&D 탭의 연구개발계획서 YAML 원문 저장소 — 장부(rndBook)는 스냅샷을 풀어 넣은 결과만 갖고 원문은 버리므로, 변경사항 카드가 LLM 에 줄
// **기준 YAML** 을 따로 둔다(chrome.storage.local 'rndYamlText' — 과제·차년도마다 지금 판 하나와 지난 판 다섯, 계약 §2.3).
// 저장은 rndgen/index.js 의 onIntake 훅 한 곳에서만 한다(끌어 놓기·붙여 넣기·뽑기·고치기 모두 rnd.intake 를 지나므로). 과제를 지우면 그 과제 것을 지운다.
//
//   import { createYamlStore } from './store.js';
//   const store = createYamlStore();                        // 저장소는 처음 쓸 때 본다
//   await store.load();  store.get(projectId, 2)            // 읽어 외운 뒤 get·history 는 동기
//   await store.put(projectId, 2, { text, rev: 'r3', file: 'KR_….yaml', source: 'revise', summary })
//
// chrome 은 처음 쓸 때 본다 — import·생성만으로는 건드리지 않는다(test/wiring.test.mjs 가 jsdom 에서 sidepanel.js 를 통째로 import 한다).

import { MAX_YEARS } from '../src/rnd.js';

export const YAML_KEY = 'rndYamlText';
/** 과제·차년도마다 남기는 지난 판 수. */
export const HISTORY_MAX = 5;
/** 원문이 어디서 왔나 — 파일 넣기 · 붙여 넣기 · 사업계획서에서 뽑기 · 변경사항으로 고치기. 모르는 것은 'file'. */
const SOURCES = Object.freeze(['file', 'paste', 'extract', 'revise']);

const line = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** 차년도 → 저장 키 글("2"). 1~MAX_YEARS 가 아니면 ''. */
const yearKey = (n) => { const k = Number(n); return Number.isInteger(k) && k >= 1 && k <= MAX_YEARS ? String(k) : ''; };

/** 판 하나를 꼴 맞춘다. 글이 비었으면 null(버린다). */
function normalizeEntry(raw) {
  if (!isObj(raw) || typeof raw.text !== 'string' || !raw.text.trim()) return null;
  return {
    text: raw.text, rev: line(raw.rev, 20), at: line(raw.at, 40), file: line(raw.file, 300),
    source: SOURCES.includes(raw.source) ? raw.source : 'file', summary: line(raw.summary, 1000),
  };
}

/** 저장소에서 읽은 것 → 꼴 맞추기(§2.3). 모르는 것은 { v: 1, projects: {} }. 지금 판이 없는 차년도·차년도가 없는 과제는 버리고, 지난 판은 HISTORY_MAX 까지. */
export function normalizeYamlStore(raw) {
  const out = { v: 1, projects: {} };
  const projects = isObj(raw) && isObj(raw.projects) ? raw.projects : {};
  for (const [id, years] of Object.entries(projects)) {
    if (!id.trim() || !isObj(years)) continue;
    const slots = {};
    for (const [n, slot] of Object.entries(years)) {
      const k = yearKey(n);
      const current = k && isObj(slot) ? normalizeEntry(slot.current) : null;
      if (!current) continue;
      slots[k] = { current, history: (Array.isArray(slot.history) ? slot.history : []).map(normalizeEntry).filter(Boolean).slice(0, HISTORY_MAX) };
    }
    if (Object.keys(slots).length) out.projects[id] = slots;
  }
  return out;
}

/**
 * 저장소 하나. storage 를 주면 그것을 쓴다(검사는 가짜를 준다) — 함수면 처음 쓸 때 부른다. 기본은 처음 쓸 때 본 chrome.storage.local(없으면 던진다).
 * put·remove 는 줄을 서서 하나씩 돈다(둘이 겹쳐도 앞의 것을 지우지 않는다). 쓰기가 실패하면 외운 것도 되돌린다.
 * @param {{ storage?: {get:(keys)=>Promise<object>, set:(obj)=>Promise<void>} | (() => {get,set}), now?: () => number }} deps  now 는 entry.at 이 없을 때의 시각
 * @returns {{
 *   load(): Promise<object>,                                   // 읽어 외운다(한 번) — 그 뒤 get/history 는 동기
 *   get(projectId: string, n: number): Entry|null,             // current (사본)
 *   history(projectId: string, n: number): Entry[],            // 지난 판(최신이 앞, 사본)
 *   put(projectId: string, n: number, entry: Entry): Promise<Entry>,   // current 를 history 앞으로 밀고(HISTORY_MAX 로 자름) entry 를 current 로, 저장
 *   remove(projectId: string): Promise<void>,                  // 과제 통째
 *   all(): object                                              // 외운 것 그대로(읽기용)
 * }}
 */
export function createYamlStore({ storage, now = () => Date.now() } = {}) {
  let backend = null;
  const local = () => {
    if (backend) return backend;
    const s = typeof storage === 'function' ? storage() : storage || globalThis.chrome?.storage?.local;
    if (!s) throw new Error('이 환경에는 확장 저장소(chrome.storage.local)가 없습니다.');
    return (backend = s);
  };

  let cache = null;
  let loading = null;
  const load = () => (loading ||= (async () => {
    const got = await local().get(YAML_KEY);
    cache = normalizeYamlStore(got?.[YAML_KEY]);
    return cache;
  })().catch((e) => {
    loading = null;
    throw e;
  }));

  // 줄: 고치는 일(put·remove)은 앞의 것이 끝난 뒤에 돈다. 앞의 것이 실패해도 줄은 이어진다.
  let tail = Promise.resolve();
  const enqueue = (job) => {
    const run = tail.then(job);
    tail = run.catch(() => {});
    return run;
  };
  /** 외운 것을 고쳐 쓴다 — fn 이 고치고, 쓰기가 실패하면 고치기 전으로 되돌린다. */
  const change = async (fn) => {
    await load();
    const before = structuredClone(cache);
    const out = fn(cache);
    if (out === false) return;
    try {
      await local().set({ [YAML_KEY]: structuredClone(cache) });
    } catch (e) {
      cache = before;
      throw e;
    }
  };
  const slotOf = (id, n) => cache?.projects?.[String(id ?? '')]?.[yearKey(n)] || null;
  const copy = (e) => (e ? { ...e } : null);

  return {
    load,
    get: (projectId, n) => copy(slotOf(projectId, n)?.current),
    history: (projectId, n) => (slotOf(projectId, n)?.history || []).map(copy),
    /**
     * 지금 판을 지난 판 앞으로 밀고 entry 를 지금 판으로 둔다(지난 판에 같은 글이 있으면 그것은 뺀다 — 되돌아간 판이 두 번 남지 않게).
     * 글이 지금 판과 같으면 밀지 않고 지금 판의 at·source 만 고친다. entry.at 이 없으면 now() 의 ISO 시각. 넣은 판(사본)을 돌려준다.
     * load() 가 아직이면 먼저 한다. 과제 id·차년도·글이 없으면 던진다.
     */
    put(projectId, n, entry) {
      return enqueue(async () => {
        const id = String(projectId ?? '').trim();
        const k = yearKey(n);
        if (!id) throw new Error('저장할 과제가 없습니다');
        if (!k) throw new Error(`저장할 차년도가 없습니다 — ${n}`);
        const e = normalizeEntry({ ...entry, at: entry?.at || new Date(now()).toISOString() });
        if (!e) throw new Error('저장할 YAML 글이 없습니다');
        let saved = null;
        await change((c) => {
          const years = (c.projects[id] ||= {});
          const prev = years[k];
          if (prev && prev.current.text === e.text) Object.assign(prev.current, { at: e.at, source: e.source });
          else years[k] = { current: e, history: prev ? [prev.current, ...prev.history.filter((h) => h.text !== e.text)].slice(0, HISTORY_MAX) : [] };
          saved = years[k].current;
        });
        return copy(saved);
      });
    },
    /** 과제 하나의 원문을 모두 지운다. 없던 과제면 쓰지 않는다. */
    remove(projectId) {
      return enqueue(() => change((c) => {
        const id = String(projectId ?? '');
        if (!Object.hasOwn(c.projects, id)) return false;
        delete c.projects[id];
        return true;
      }));
    },
    all: () => cache || normalizeYamlStore(null),
  };
}
