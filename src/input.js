// LLM 입력 명세(input.yaml → inputspec.js)와 행위 명세(actions/spec.js)의 칸을 지나는 관문.
//
//   systemPrompt(task)              LLM 에게 주는 지시문. 로컬 CLI 다리와 API 가 같은 것을 쓴다
//   jsonSchema(task)                API 의 구조화 출력 스키마
//   structure(task, raw, ctx)       돌아온 답을 실행자에 넘기기 전에 지나는 관문 — 검증하고 정규화한다
//   structureOf(spec, raw, ctx)     명세 객체를 직접 받는 같은 관문 — 행위 명세의 칸·사전설정(actions/gate.js)이 쓴다
//   schemaOf(spec) · promptOf(spec) 명세 객체로 바로 스키마·지시문을 만든다
//
// LLM 이 정하는 것은 명세에 적힌 칸의 값뿐이다. 어느 종류(회의실·차량·근태)인지, 어느 함수·주소로
// 갈지는 화면이 정하고 여기서는 받지 않는다. 명세에 없는 키는 두 모드 모두 조용히 버린다.
//
// 관문에는 두 모드가 있다.
//   draft(기본)  LLM 이 준 조각 — 필수가 아닌 칸의 틀린 값은 비우고 notes 에 적는다. 긴 글은 한도에서 자른다
//   execute      UI 가 보낸 기록 — 초안 모드에서 알림으로 끝나던 보정(틀린 값 비우기·목록 줄 빼기·목록 길이 넘침·
//                글 자르기·checks 의 drop·variants 의 clear·tags 의 값 빼기)이 모두 problem 이라 InputError 다.
//                사람이 본 것과 보내는 것이 달라지면 안 된다.
//
// 칸의 when(key · !key · key=value · key!=value)은 두 모드에서 본다 — 거짓이면 그 칸은 통째로 건너뛴다(결과에 키도 없다).
// 파일(file)은 참조다 — { name, type, size? } 만 남고 바이트(dataUrl)는 기록에 들어오지 않는다(run 의 ctx.files 로 간다).
//
// 확장(브라우저)과 네이티브 다리(Node)가 같이 읽는다. DOM 도 Node API 도 쓰지 않는다.
//
// 작업은 input.yaml 의 것에, 공문 문서 읽기(gongmun.<갈래> — recipes/gongmun 의 칸마다 적힌 읽는 법으로 만든다,
// tools/gen-gongmun.mjs → src/gmrecipe.js 의 tasks)와 행위 명세에서 만든 작업(actions/spec 의 YAML →
// tools/gen-actions.mjs → actions/spec.js 의 tasks)을 더한다. 같은 이름이면 뒤의 것이 이긴다.

import { INPUT_SPEC } from './inputspec.js';
import { RECIPE } from './gmrecipe.js';
import { ACTIONS } from '../actions/spec.js';

export const TASKS = { ...INPUT_SPEC.tasks, ...RECIPE.tasks, ...ACTIONS.tasks };

/**
 * 답이 명세와 달라 실행자에 넘길 수 없다. problems 는 무엇이 어긋났는지(사람이 읽는 글)다.
 * details 는 같은 것을 구조로 — [{ key, why }] (key 는 칸 이름, 안쪽 칸은 draft.total · items[2].name 꼴; why 는 missing · empty · invalid · check · variant).
 * 행위 층의 관문(actions/gate.js)이 이것으로 "빈 곳으로 가는 단추"(src/jump.js)의 자리를 안다.
 */
export class InputError extends Error {
  constructor(task, problems, details = []) {
    super(`답이 입력 명세와 다릅니다 — ${problems.join(', ')}`);
    this.name = 'InputError';
    this.task = task;
    this.problems = problems;
    this.details = Array.isArray(details) ? details : [];
  }
}

const specOf = (task) => {
  // 이름이 명세에 있는 것만 받는다. 'constructor' 같은 이름이 객체의 내장 속성에 걸리면 안 된다.
  if (typeof task !== 'string' || !Object.hasOwn(TASKS, task)) throw new InputError(task, [`모르는 작업 ${task}`]);
  return TASKS[task];
};

/* ------------------------------------------------------------ 지시문·스키마 */

const range = (f) => (f.min != null && f.max != null ? ` ${f.min}~${f.max}` : f.min != null ? ` ${f.min} 이상` : f.max != null ? ` ${f.max} 이하` : '');
const quoted = (values) => values.map((v) => `"${v}"`).join(' | ');

/** 사람이 읽는 형 이름. 지시문과 스키마 설명에 같이 쓴다. */
function typeLabel(f) {
  switch (f.type) {
    case 'date': return '날짜 YYYY-MM-DD';
    case 'time': return '시각 HH:MM';
    case 'integer': return `정수${range(f)}`;
    case 'number': return `수${range(f)}`;
    case 'enum': return quoted(f.values);
    case 'boolean': return 'true | false';
    case 'list': return `목록(${f.max ?? 50}줄까지) — 줄마다 아래 키의 객체`;
    case 'tags': return f.values ? `${quoted(f.values)} 가운데 해당하는 것 모두의 목록` : '글의 목록';
    case 'file': return '파일(이름·형식)';
    case 'object': return '객체 — 아래 키';
    default: return '글';
  }
}

/** 안에 칸을 가진 형 — 목록은 줄의 칸(item), 객체는 안의 칸(fields). */
const childrenOf = (f) => (f.type === 'list' ? f.item : f.type === 'object' ? f.fields : null) || null;

/** 칸 한 줄의 설명. 목록·객체면 그 아래에 안의 키를 들여 적는다. */
function keyLines(key, f, indent = '') {
  const head = `${indent}- ${key} (${typeLabel(f)}${f.required ? ', 필수' : ' 또는 null'}): ${f.desc}`;
  const kids = childrenOf(f);
  if (!kids) return [head];
  return [head, ...Object.entries(kids).flatMap(([k, sf]) => keyLines(k, sf, `${indent}    `))];
}

/**
 * LLM 에게 주는 지시문. 명세의 역할·칸·규칙을 그대로 옮긴다.
 * jsonOnly 는 구조화 출력이 없는 길(로컬 CLI)에서 JSON 만 내라는 말을 덧붙인다.
 */
export function systemPrompt(task, { jsonOnly = false } = {}) {
  return promptOf(specOf(task), { jsonOnly });
}

/** 작업 명세 하나의 지시문 — systemPrompt 와 같은 글(생성기가 레시피에서 바로 만든 작업을 보일 때도 쓴다). */
export function promptOf(spec, { jsonOnly = false } = {}) {
  const keys = Object.entries(spec.fields).flatMap(([key, f]) => keyLines(key, f));
  return [
    spec.role,
    '',
    '출력 키:',
    ...keys,
    '',
    '규칙:',
    ...spec.rules.map((r) => `- ${r}`),
    `- 필수가 아닌 키는 ${spec.partial ? '사용자가 말하지 않았으면' : '해당하는 값이 없으면'} null 입니다.`,
    ...(jsonOnly ? ['', 'JSON 객체 하나만 출력합니다. 설명·마크다운·코드 펜스를 붙이지 않습니다. 위의 키를 모두 넣습니다.'] : []),
  ].join('\n');
}

const JSON_TYPE = { date: 'string', time: 'string', string: 'string', enum: 'string', integer: 'integer', number: 'number', boolean: 'boolean', list: 'array', tags: 'array', file: 'object', object: 'object' };
/** 설명에 형 이름을 덧붙이지 않는 형 — 스키마 자체가 모양을 말한다. */
const PLAIN = new Set(['enum', 'boolean', 'string', 'list', 'tags', 'object']);
/** 파일 칸의 스키마 — 이름·형식만. 바이트는 LLM 이 내는 것이 아니다. */
const FILE_SCHEMA = { properties: { name: { type: 'string' }, type: { type: 'string' } }, required: ['name', 'type'], additionalProperties: false };

/** 칸 하나의 스키마. 목록은 줄마다 같은 모양의 객체다(줄 안의 칸도 모두 받고, 없는 값은 null). */
function propOf(f) {
  const description = PLAIN.has(f.type) ? f.desc : `${f.desc} (${typeLabel(f)})`;
  const base = { type: JSON_TYPE[f.type] };
  if (f.type === 'enum') base.enum = f.values;
  else if (f.type === 'list') base.items = objectOf(f.item);
  else if (f.type === 'tags') base.items = f.values ? { type: 'string', enum: f.values } : { type: 'string' };
  else if (f.type === 'file') Object.assign(base, FILE_SCHEMA);
  else if (f.type === 'object' && f.fields) Object.assign(base, objectOf(f.fields));
  return f.required ? { ...base, description } : { anyOf: [base, { type: 'null' }], description };
}

function objectOf(fields) {
  const properties = {};
  for (const [key, f] of Object.entries(fields)) properties[key] = propOf(f);
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

/**
 * API 구조화 출력(output_config.format)에 넘길 스키마.
 * 구조화 출력은 수 범위(minimum·maximum)와 글 길이를 받지 않는다 — 설명에 적고, 지키는지는 관문이 본다.
 */
export function jsonSchema(task) {
  return schemaOf(specOf(task));
}

/** 명세 객체 하나의 스키마 — jsonSchema 와 같은 것. */
export function schemaOf(spec) {
  return objectOf(spec.fields);
}

/* ------------------------------------------------------------------ 관문 */

const pad = (n) => String(n).padStart(2, '0');

/** 순수 데이터 객체인가(배열 아님). */
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** 값이 없는 것 — null·undefined·빈 글. */
const isAbsent = (v) => v == null || (typeof v === 'string' && !v.trim());

function asDate(v) {
  const m = typeof v === 'string' ? v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return undefined;
  // 모양만 맞고 달력에 없는 날(2월 30일)은 받지 않는다.
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? m[0] : undefined;
}

function asTime(v) {
  const m = typeof v === 'string' ? v.trim().match(/^(\d{1,2}):(\d{2})$/) : null;
  return m && +m[1] < 24 && +m[2] < 60 ? `${pad(+m[1])}:${m[2]}` : undefined;
}

function asNumber(v, f) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isFinite(n) || (f.type === 'integer' && !Number.isInteger(n))) return undefined;
  return (f.min != null && n < f.min) || (f.max != null && n > f.max) ? undefined : n;
}

/** 글. 한도를 넘으면 초안 모드는 자르고, 실행 모드는 받지 않는다(사람이 본 글과 보내는 글이 달라지면 안 된다). */
function asString(f, v, s) {
  if (typeof v !== 'string') return { value: undefined };
  const t = v.trim();
  const max = f.max ?? 2000;
  if (t.length <= max) return { value: t };
  return s.strict ? { value: undefined, reason: `가 ${max}자를 넘습니다(${t.length}자)` } : { value: t.slice(0, max) };
}

/**
 * 파일의 참조 — { name, type, size? }. 이름은 비면 안 되고 size 는 0 이상의 정수다.
 * 다른 키(dataUrl·bytes)는 두 모드 모두 알림 없이 버린다 — 바이트는 기록이 아니라 run 의 ctx.files 로 간다.
 */
function asFile(v) {
  if (!isPlain(v) || typeof v.name !== 'string' || !v.name.trim() || typeof v.type !== 'string') return undefined;
  const out = { name: v.name.trim(), type: v.type.trim() };
  if (v.size != null) {
    if (!Number.isInteger(v.size) || v.size < 0) return undefined;
    out.size = v.size;
  }
  return out;
}

/** 안의 칸(fields)이 없는 객체 — 사전설정의 과제·HR 의 나처럼 꼴만 받는 것. JSON 으로 깊게 복사한다(함수·순환은 못 받는다). */
function asOpaque(v) {
  if (!isPlain(v)) return undefined;
  try { return JSON.parse(JSON.stringify(v)); } catch { return undefined; }
}

const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return String(s).length > 30 ? `${String(s).slice(0, 30)}…` : String(s);
};

/**
 * 칸을 사람에게 부를 이름 — label 이 있으면 그것, 없으면 설명의 첫 마디. name 이 바깥.안쪽 꼴이면 안쪽만.
 * 행위 명세에서 만든 작업은 desc 자리에 read 가 들어가고, 종류마다 read 가 다르면 "종류별 — trip·out: …; leave: …" 로 합쳐진다
 * (tools/gen-actions.mjs) — 그 머리는 이름이 아니라 떼고 첫 종류의 첫 마디를 쓴다.
 */
const nameOf = (f, name) => {
  const key = String(name).split('.').pop();
  if (typeof f.label === 'string' && f.label.trim()) return f.label.trim();
  const desc = String(f.desc || '').replace(/^종류별 — [^:]*: /, '');
  return desc.split(/[.,(:]/)[0].trim() || key;
};

/* 칸의 when — key · !key · key=value · key!=value. value 는 글·수·true·false 리터럴(따옴표는 떼어 준다). */
const WHEN = /^(!?)([A-Za-z_$][\w$]*)(?:\s*(!=|=)\s*(.+))?$/;

/** when 글을 푼다. 틀리면 null. */
export function parseWhen(when) {
  const m = String(when).trim().match(WHEN);
  if (!m || (m[1] && m[3])) return null;
  if (!m[3]) return { key: m[2], not: !!m[1] };
  return { key: m[2], not: m[3] === '!=', value: m[4].trim().replace(/^(['"])(.*)\1$/, '$2') };
}

/** "참" 은 채워졌다는 뜻 — 빈 글·null·false·빈 목록은 거짓. 0 은 값이다. */
const filled = (v) => !(v == null || v === false || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length));
const sameAs = (v, lit) => (typeof v === 'string' ? v.trim() : String(v)) === lit;

/** 칸이 사는 조건을 raw(관문 전의 값) 기준으로 본다. */
function whenOk(f, raw, name, s) {
  if (f.when == null) return true;
  const w = parseWhen(f.when);
  if (!w) throw new InputError(s.task, [`${name}: when 문법이 틀렸습니다(${f.when})`]);
  const hit = w.value === undefined ? filled(raw[w.key]) : sameAs(raw[w.key], w.value);
  return w.not ? !hit : hit;
}

/**
 * 값의 목록(tags). values 밖의 값은 뺀다 — 초안 모드는 알리고, 실행 모드는 받지 않는다.
 * 차례는 values 의 차례로 맞춘다(같은 값의 집합이면 어느 길로 왔든 같은 기록이 된다). values 가 없으면(사전설정) 글의 목록이면 된다.
 */
function asTags(f, v, name, s) {
  if (!Array.isArray(v)) return { value: undefined };
  const seen = new Set();
  const lost = [];
  for (const x of v) {
    const t = typeof x === 'string' ? x.trim() : '';
    if (!t) { if (x != null) lost.push(show(x)); continue; }
    if (f.values && !f.values.includes(t)) { lost.push(t); continue; }
    seen.add(t);
  }
  if (lost.length) {
    const list = [...new Set(lost)].join(', ');
    if (s.strict) { s.problems.push(`${name} 에 받을 수 없는 값(${list})이 있습니다`); s.where.push({ key: name, why: 'invalid' }); }
    else s.notes.push(`${nameOf(f, name)} 중 받을 수 없는 값(${list})은 뺐습니다`);
  }
  return { value: f.values ? f.values.filter((x) => seen.has(x)) : [...seen] };
}

/**
 * 목록. 줄마다 줄의 칸(item)을 같은 규칙으로 본다 — 줄의 필수 칸이 없거나 틀리면 그 줄을 빼고, 나머지 칸은 틀리면 비운다.
 * 초안 모드는 뺀 줄 수를 알리고 한도까지만 받는다. 실행 모드는 줄을 빼지 않는다 — 어느 줄의 어느 칸이 틀렸는지, 줄 수가 넘쳤는지가 problem 이다.
 * 배열이 아니면 받지 않는다(undefined).
 */
function asList(f, v, name, s) {
  if (!Array.isArray(v)) return { value: undefined };
  const max = f.max ?? 50;
  if (s.strict && v.length > max) return { value: undefined, reason: `가 ${max}줄을 넘습니다(${v.length}줄)` };
  const rows = [];
  let dropped = 0;
  v.slice(0, max).forEach((x, i) => {
    const at = `${name}[${i}]`;
    if (!isPlain(x)) {
      dropped++;
      if (s.strict) { s.problems.push(`${at} 이 객체가 아닙니다`); s.where.push({ key: at, why: 'invalid' }); }
      return;
    }
    const row = {};
    let ok = true;
    for (const [k, sf] of Object.entries(f.item)) {
      if (!whenOk(sf, x, `${at}.${k}`, s)) continue;
      const sv = x[k];
      const absent = isAbsent(sv);
      const r = absent ? { value: undefined } : convert(sf, sv, `${at}.${k}`, s);
      row[k] = r.value ?? null;
      if (r.value !== undefined) continue;
      if (sf.required) ok = false;
      if (s.strict && (sf.required || !absent)) {
        s.problems.push(absent ? `${at}.${k} 가 없습니다` : r.reason ? `${at}.${k} ${r.reason}` : `${at}.${k} 값(${show(sv)})이 틀렸습니다`);
        s.where.push({ key: `${at}.${k}`, why: absent ? 'missing' : 'invalid' });
      }
    }
    if (ok) rows.push(row);
    else dropped++;
  });
  if (dropped && !s.strict) s.notes.push(`${nameOf(f, name)} 중 ${dropped}줄은 받을 수 없어 뺐습니다`);
  return { value: rows };
}

/** 한 겹의 객체(fields). 안의 칸을 같은 규칙으로 본다 — 알림의 칸 이름은 바깥.안쪽. */
function asObject(f, v, name, s) {
  if (!isPlain(v)) return { value: undefined };
  const value = fill(f.fields, v, `${name}.`, s);
  if (s.partial) prune(value);
  return { value };
}

/**
 * 값을 그 칸의 형으로 바꾼다. value 가 undefined 면 받을 수 없는 값이다(reason 이 있으면 그 까닭).
 * 목록·tags·객체처럼 일부만 뺄 수 있는 형은 뺀 사실을 s(notes·problems)에 바로 적는다. name 은 알림에 쓰는 칸 이름.
 */
function convert(f, v, name, s) {
  switch (f.type) {
    case 'date': return { value: asDate(v) };
    case 'time': return { value: asTime(v) };
    case 'integer':
    case 'number': return { value: asNumber(v, f) };
    case 'enum': return { value: typeof v === 'string' && f.values.includes(v.trim()) ? v.trim() : undefined };
    case 'boolean': return { value: typeof v === 'boolean' ? v : undefined };
    case 'string': return asString(f, v, s);
    case 'list': return asList(f, v, name, s);
    case 'tags': return asTags(f, v, name, s);
    case 'file': return { value: asFile(v) };
    case 'object': return f.fields ? asObject(f, v, name, s) : { value: asOpaque(v) };
    default: return { value: undefined };
  }
}

/** 부분 수정 — 비어 있는 칸은 아예 뺀다(null 은 "지우기"가 아니다). */
function prune(data) {
  for (const key of Object.keys(data)) if (data[key] == null) delete data[key];
  return data;
}

/**
 * 칸들을 차례로 본다. 받을 수 없는 값은 problem(필수 칸, 또는 실행 모드의 모든 칸)이거나
 * note(초안 모드의 필수 아닌 칸 — 비우고 알린다)다. when 이 거짓인 칸은 통째로 건너뛴다. 명세에 없는 키는 버린다.
 */
function fill(fields, raw, prefix, s) {
  const data = {};
  for (const [key, f] of Object.entries(fields)) {
    const name = prefix + key;
    if (!whenOk(f, raw, name, s)) continue;
    const v = raw[key];
    if (isAbsent(v)) {
      data[key] = null;
      if (f.required) { s.problems.push(`${name} 가 없습니다`); s.where.push({ key: name, why: 'missing' }); }
      continue;
    }
    const r = convert(f, v, name, s);
    data[key] = r.value ?? null;
    if (r.value !== undefined) {
      // 목록·tags 는 받되 다 빠져 비었으면 없는 것과 같다.
      if (Array.isArray(r.value) && !r.value.length && f.required) { s.problems.push(`${name} 가 비어 있습니다`); s.where.push({ key: name, why: 'empty' }); }
      continue;
    }
    if (f.required || s.strict) { s.problems.push(r.reason ? `${name} ${r.reason}` : `${name} 값(${show(v)})이 틀렸습니다`); s.where.push({ key: name, why: 'invalid' }); }
    else s.notes.push(`${nameOf(f, name)} 값(${show(v)})은 받을 수 없어 뺐습니다`);
  }
  return data;
}

/**
 * 명세 객체로 답을 검증·정규화한다. **어느 길로 온 답이든**(로컬 CLI·API·규칙 해석·UI 의 기록) 실행자에 넘기기 전에 여기를 지난다.
 *
 * - 필수 칸이 없거나 틀리면, 또는 칸 사이의 관계(checks)가 어긋나면 InputError 를 던진다. 부르는 쪽은 다음 길로 내려간다.
 * - 초안 모드(draft): 필수가 아닌 칸이 틀리면 그 칸만 비우고 notes 에 적는다. 말없이 버리면 사용자는 반영된 줄 안다.
 *   ctx.kind 가 받지 않는 조건(variants)도 비우고 notes 에 적는다.
 * - 실행 모드(execute): 그런 보정이 생기면 모두 problem 이다 — 사람이 본 것과 보내는 것이 달라지면 안 된다.
 * - 부분 수정(partial)이면 비어 있는 칸은 아예 빼고 돌려준다 — null 은 "지우기"가 아니다.
 *
 * @param {{fields: object, checks?: object[], variants?: object, partial?: boolean}} spec 명세(작업 또는 행위의 칸)
 * @param {unknown} raw LLM·규칙 해석·UI 가 준 것
 * @param {{kind?: string, mode?: 'draft'|'execute', name?: string}} [ctx] 화면이 정한 종류·모드. name 은 InputError 에 적을 이름
 * @returns {{data: object, notes: string[]}}
 */
export function structureOf(spec, raw, { kind, mode = 'draft', name } = {}) {
  const task = name ?? spec?.title ?? spec?.id ?? '(명세)';
  if (!spec || typeof spec !== 'object' || !isPlain(spec.fields)) throw new InputError(task, ['명세에 fields 가 없습니다']);
  if (mode !== 'draft' && mode !== 'execute') throw new InputError(task, [`모르는 모드 ${mode}`]);
  if (!isPlain(raw)) throw new InputError(task, ['JSON 객체가 아닙니다']);

  // where 는 problems 와 나란히 쌓이는 구조 — 어느 칸이 왜 막혔는지(InputError.details).
  const s = { task, strict: mode === 'execute', partial: !!spec.partial, problems: [], notes: [], where: [] };
  const data = fill(spec.fields, raw, '', s);

  for (const c of spec.checks || []) {
    const a = data[c.left];
    const b = data[c.right];
    if (a == null || b == null || (c.op === '<' ? a < b : a <= b)) continue;
    if (c.drop && !s.strict) {
      data[c.drop] = null;
      s.notes.push(c.message);
    } else {
      s.problems.push(c.message);
      s.where.push({ key: c.left, why: 'check', also: c.right });
    }
  }
  if (s.problems.length) throw new InputError(task, s.problems, s.where);

  for (const [key, message] of Object.entries(spec.variants?.[kind]?.clear || {})) {
    if (data[key] == null) continue;
    if (s.strict) { s.problems.push(message); s.where.push({ key, why: 'variant' }); continue; }
    data[key] = null;
    s.notes.push(message);
  }
  if (s.problems.length) throw new InputError(task, s.problems, s.where);

  if (s.partial) prune(data);
  return { data, notes: s.notes };
}

/**
 * 작업 이름으로 structureOf 를 부른다 — input.yaml·레시피·행위 명세의 작업(TASKS).
 *
 * @param {string} task 작업 이름
 * @param {unknown} raw LLM 또는 규칙 해석이 준 것
 * @param {{kind?: string, mode?: 'draft'|'execute'}} [ctx] 화면이 정한 종류. 모드의 기본은 초안(draft)
 * @returns {{data: object, notes: string[]}}
 */
export function structure(task, raw, { kind, mode = 'draft' } = {}) {
  return structureOf(specOf(task), raw, { kind, mode, name: task });
}
