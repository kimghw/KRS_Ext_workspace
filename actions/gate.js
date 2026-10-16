// 관문 — 어느 길로 왔든(UI 클릭·LLM 조각·규칙 해석) 실행기에 가기 전에 기록(input·preset)을 행위 명세로 검증·정규화한다.
//
//   specOf(id, spec)                        행위 명세 한 벌(없으면 ActionError)
//   presetSpec(entry, { mode })             사전설정을 structureOf 가 받는 { fields } 꼴로(type 기본 string, required 는 실행 모드에서만)
//   check(id, { input, preset }, { mode, spec })   → { input, preset, notes }   틀리면 ActionError(problems)
//
// 검증·정규화 자체는 src/input.js 의 structureOf 가 한다(LLM 작업과 같은 관문). 여기서는 행위 명세를 그 꼴로 바꾸고,
// 모드에 따라 무엇을 보는지를 정한다.
//   draft    LLM 이 지은 조각 — 행위 명세의 required 는 "실행 모드에서 꼭 있어야 하는가" 라 여기서는 보지 않고(§3.3),
//            갈래의 llm.partial 이면 비어 있는 칸은 뺀다
//   execute  UI 가 보낸 기록 — 잃는 보정이 생기면 막는다. 사전설정은 from 으로 채워져야 할 키가 다 있어야 한다(값이 null 이어도 키는 있어야 한다)
//
// 순수하다 — chrome·DOM·fetch·시계를 만지지 않는다. 명세는 인자로 받는다(기본값은 생성물 actions/spec.js).

import { ACTIONS } from './spec.js';
import { structureOf, InputError } from '../src/input.js';

/**
 * 기록이 행위 명세와 달라 실행할 수 없다. action 은 행위 ID, problems 는 무엇이 어긋났는지(사람이 읽는 글)다.
 * missing 은 같은 것을 구조로 — [{ where: 'input' | 'preset', key, why }] (why: missing · empty · invalid · check · variant · unfilled).
 * 패널이 "빈 곳으로 가는 단추"(src/jump.js)를 세울 때 쓴다(2026-10-16 사용자 지정).
 */
export class ActionError extends Error {
  constructor(action, problems, missing = []) {
    const list = (Array.isArray(problems) ? problems : [problems]).map(String);
    super(`행위 ${action} — ${list.join(', ')}`);
    this.name = 'ActionError';
    this.action = action;
    this.problems = list;
    this.missing = Array.isArray(missing) ? missing : [];
  }
}

/** 행위 ID 로 명세를 찾는다. 이름이 명세에 있는 것만 받는다('constructor' 같은 이름이 내장 속성에 걸리면 안 된다). */
export function specOf(id, spec = ACTIONS) {
  const actions = spec?.actions;
  if (typeof id !== 'string' || !actions || !Object.hasOwn(actions, id)) throw new ActionError(id, [`모르는 행위 ${id}`]);
  return actions[id];
}

/** 사전설정 항목에서 칸으로 그대로 넘기는 속성 — enum·tags 의 values, object 의 fields, list 의 item, 수의 범위. */
const PASS = ['values', 'fields', 'item', 'min', 'max'];

/**
 * 사전설정을 칸 꼴로. type 이 없으면 글이고, required 는 실행 모드에서만 본다.
 * type 이 object 인데 fields 가 없으면 불투명 객체(plain object 또는 null 만 — 깊게 복사해 그대로 둔다).
 */
export function presetSpec(entry, { mode = 'execute' } = {}) {
  const fields = {};
  for (const [key, p] of Object.entries(entry?.preset || {})) {
    const f = { type: p?.type || 'string', desc: p?.desc || key };
    for (const k of PASS) if (p?.[k] !== undefined) f[k] = p[k];
    if (mode === 'execute' && p?.required === true) f.required = true;
    fields[key] = f;
  }
  return { fields };
}

/** 초안 모드의 칸 — required 를 뗀다(객체 안의 칸도). 목록 줄의 칸은 줄의 뜻을 정하므로 그대로 둔다. */
function lenient(fields) {
  const out = {};
  for (const [key, f] of Object.entries(fields)) {
    const { required, ...rest } = f;
    out[key] = f.type === 'object' && f.fields ? { ...rest, fields: lenient(f.fields) } : rest;
  }
  return out;
}

/**
 * 기록을 명세로 검증·정규화한다.
 *
 * @param {string} id 행위 ID
 * @param {{input?: object, preset?: object}} record 관문 전의 입력과 사전설정
 * @param {{mode?: 'draft'|'execute', spec?: object}} [opts]
 * @returns {{input: object, preset: object, notes: string[]}}
 */
export function check(id, { input = {}, preset = {} } = {}, { mode = 'execute', spec = ACTIONS } = {}) {
  const entry = specOf(id, spec);
  const draft = mode === 'draft';
  const partial = draft && !!spec.domains?.[entry.domain]?.llm?.partial;
  const fields = entry.fields || {};
  const problems = [];
  const missing = [];
  const notes = [];
  const pass = (s, raw, where) => {
    try {
      const out = structureOf(s, raw, { mode, kind: entry.kind, name: id });
      notes.push(...out.notes);
      return out.data;
    } catch (err) {
      if (!(err instanceof InputError)) throw err;
      problems.push(...err.problems);
      // 어느 칸이 왜 막혔는지(src/input.js 의 details)는 패널이 빈 곳으로 가는 단추를 세우는 데 쓴다.
      missing.push(...(err.details || []).map((d) => ({ where, key: d.key, why: d.why })));
      return null;
    }
  };
  const data = pass({ fields: draft ? lenient(fields) : fields, checks: entry.checks || [], partial, variants: entry.variants }, input ?? {}, 'input');
  const pre = pass(presetSpec(entry, { mode }), preset ?? {}, 'preset');
  if (!draft) {
    // 실행 모드에서는 from 으로 채워져야 할 키가 다 있어야 한다 — 채우기를 건너뛴 것(키 없음)과 못 찾은 것(null)을 가른다.
    for (const key of Object.keys(entry.preset || {})) {
      if (!preset || !Object.hasOwn(preset, key)) {
        problems.push(`사전설정 ${key} 가 채워지지 않았습니다`);
        missing.push({ where: 'preset', key, why: 'unfilled' });
      }
    }
  }
  if (problems.length) throw new ActionError(id, [...new Set(problems)], missing);
  return { input: data, preset: pre, notes };
}
