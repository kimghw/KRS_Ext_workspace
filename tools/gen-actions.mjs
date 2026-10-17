// actions/spec/<갈래>/<종류>.yaml → actions/spec.js
//
// 행위 명세(UI 클릭과 LLM 요청을 같은 기록으로 바꿔 실행기를 부르는 층 — docs/actions-design.md)의 정본은 YAML 이고, 확장은 번들러 없는 순수 ES 모듈이라
// YAML 을 읽지 못한다. 그래서 여기서 JS 모듈 하나로 옮긴다(입력 명세 tools/gen-input.mjs·공문 레시피 tools/gen-gongmun.mjs 와 같은 방식).
// YAML 을 고친 뒤 `node tools/gen-actions.mjs` 를 돌린다. `--check` 는 쓰지 않고 어긋났는지만 본다(종료 코드 1). 틀린 명세는 무엇이 틀렸는지만 말하고 끝낸다.
//
//   --prompt <작업>     생성한 LLM 작업(attend · search.room · search.car …)의 지시문 전문(src/input.js 의 promptOf — 확장이 쓰는 함수 그대로)
//   --show <행위 ID>    갈래 사전설정·기본값이 합쳐진 행위 하나를 JSON 으로
//   --example <행위 ID> example·default 로 채운 보기 기록(record)을 YAML 글로(작은 emitter — 런타임의 actions/record.js toYaml 과는 별개다)
//
// 폴더: actions/spec/<갈래>/_domain.yaml(갈래 공통 — 종류 차례·사전설정·LLM 작업 모드) + <종류>.yaml(행위 하나). 폴더가 있는 갈래는 모두 읽는다(다른 유닛이 아직 쓰는 중인
// 빈 폴더는 넘어가고, 없는 갈래를 가리키는 then 은 묻지 않는다). 생성물의 꼴은 docs/actions-design.md §4 — domains(갈래)·actions(행위 — 갈래 preset 이 앞에 합쳐진 것)·
// tasks(LLM 작업 — src/input.js 의 TASKS 에 합쳐진다. references/input.yaml 의 작업과 같은 꼴이라 tools/gen-input.mjs 의 checkSpec 을 지난다).
//
// LLM 작업을 만드는 네 가지 모드(갈래 llm.mode):
//   merged    갈래에 작업 하나(llm.task) — kind(종류 enum) + 모든 종류의 llm: true 칸의 합집합(종류 차례, 같은 키는 type·min·max 가 같아야 하고 enum 은 values 합집합,
//             read 가 다르면 "종류별 — trip: …; leave: …") + 갈래 llm.fields. rules = 갈래 rules + 종류 rules("종류가 trip(출장)일 때: …"). partial 이면 required 는 없다
//   per-kind  llm 을 켠 종류마다 작업 하나 — 이름은 종류 파일이 적는다(llm: { task: search.room }). drop 칸은 작업에 들어가고 variants.<갈래>.clear 로 비운다
//   recipe    만들지 않는다 — 종류 파일의 llm: { tasks: [{ task, fills }] } 가 공문 레시피(src/gmrecipe.js RECIPE.tasks)의 작업을 가리킨다
//   none      만들지 않는다(UI 만). 그래도 칸마다 read 는 둔다(2단계 통합 명령창)
// 작업의 칸 설명(desc)에는 YAML 의 read 를 넣는다(example 이 있으면 " (예: …)" 를 뒤에) — src/input.js 의 promptOf 는 desc 만 읽으므로 이렇게 해야 인라인 프롬프트가 LLM 에 간다.
//
// 칸의 from(생성기가 펼친다): object 칸의 `from: <행위 ID>` 는 그 행위의 칸을 그대로(room.modify 의 back·next = room.reserve 의 칸), gongmun 종류의 `from: recipe` 는 레시피
// purpose.yaml 의 fields ∪ reads ∪ { currency, attach }(§14.2), list 칸의 item 에 적은 `from: task:<이름>` 은 input.yaml 작업의 칸(trip/after.yaml 의 records = receipt).
// 종류 파일의 `칸: { from: domain }` 은 갈래 공통 칸(_domain.yaml 의 fields — 공문 네 종류가 같은 글로 베껴 적던 form·title·body·rank·lead·refs·setting·attach, 2026-10-17)을
// 그 자리에 그대로 가져온다(차례는 종류 파일의 자리, 다르게 쓰려면 칸을 통째로 적는다). 갈래 공통 preset 과 달리 저절로 합쳐지지 않는다 — 종류마다 있고 없는 칸이 달라서(외부활동에는 lead·refs 가 없다).
// recipe 모드의 갈래(공문)는 kinds 가 레시피의 목적 차례(RECIPE.order)와 같아야 하고 종류의 llm.tasks 는 그 종류의 작업(이름이 `.<종류>` 로 끝남)이어야 한다 — 레시피에 목적을 더하고
// 종류 YAML 을 빠뜨리면 패널에 갈래 단추는 서는데 공문 작성이 "없는 행위" 로 막히던 것을 여기서 잡는다(2026-10-17 Codex 검토).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { checkSpec } from './gen-input.mjs';
import { INPUT_SPEC } from '../src/inputspec.js';
import { RECIPE } from '../src/gmrecipe.js';

const ROOT = fileURLToPath(new URL('../actions/spec/', import.meta.url));
const REPO = fileURLToPath(new URL('../', import.meta.url));
const TARGET = new URL('../actions/spec.js', import.meta.url);

/** 디스패처에 등록되는 실행기 이름(docs/actions-design.md §6.6). live 행위의 runner 는 이 가운데 하나여야 한다 — LLM 도 YAML 도 새 실행기를 만들지 못한다. */
export const RUNNERS = [
  'booking.search', 'booking.reserve', 'booking.cancel', 'booking.modify',
  'attend.apply', 'attend.doc', 'attend.cancel',
  'trip.create', 'trip.presave', 'trip.preconfirm', 'trip.postconfirm', 'trip.delete', 'trip.after', 'trip.send', 'trip.lodge',
  'gongmun.write', 'gongmun.prior',
];
/** 칸의 형 — input.yaml 의 형에 tags(값의 목록)·file(이름·형식 참조)·object(한 겹)를 더한 것(§3.3). */
const TYPES = new Set(['date', 'time', 'integer', 'number', 'string', 'enum', 'boolean', 'list', 'tags', 'file', 'object']);
/** 작업에 들어갈 수 있는 형 — input.yaml 의 형뿐이다(1단계: tags·file·object 칸은 llm: false). */
const TASK_TYPES = new Set(['date', 'time', 'integer', 'number', 'string', 'enum', 'boolean', 'list']);
const MODES = new Set(['merged', 'per-kind', 'recipe', 'none']);
const STATUSES = new Set(['live', 'planned']);
const EFFECTS = new Set(['none', 'draft', 'write']);
const OPS = new Set(['<', '<=']);
const DOMAIN_KEYS = ['domain', 'title', 'log', 'kinds', 'preset', 'fields', 'llm'];
const LLM_KEYS = ['task', 'mode', 'partial', 'input', 'title', 'consumer', 'next', 'role', 'rules', 'fields'];
const KIND_KEYS = ['id', 'title', 'hint', 'status', 'confirm', 'effect', 'log', 'summary', 'preset', 'fields', 'ignore', 'checks', 'rules', 'llm', 'runner', 'uses', 'then', 'next'];
const FIELD_KEYS = ['type', 'required', 'label', 'desc', 'read', 'llm', 'ui', 'when', 'default', 'drop', 'example', 'min', 'max', 'values', 'item', 'fields', 'from', 'omit', 'hint'];
const PRESET_KEYS = ['from', 'value', 'type', 'desc', 'log', 'required', 'fields'];
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
/** 행위 ID — <갈래>.<종류>. 종류 이름에 점이 들어갈 수 있다(2단계의 rnd.erp.link 처럼 — 파일 이름이 erp.link.yaml). */
const ID_RE = /^[a-z][a-z0-9]*\.[a-z][a-z0-9.]*$/;
/** 칸이 사는 조건(when)의 문법 — key · !key · key=value · key!=value(§14.1). */
const WHEN_RE = /^(!?)([A-Za-z][A-Za-z0-9_]*)(?:(!?=)(.*))?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 레시피의 형 → 칸의 형(§3.5). gen-gongmun 의 SPEC_TYPE 과 달리 time 은 time 이다(관문이 HH:MM 으로 맞춘다). */
const RECIPE_TYPE = { text: 'string', money: 'number', date: 'date', choice: 'enum', time: 'time', number: 'number', list: 'list' };

const isStr = (v) => typeof v === 'string' && !!v.trim();
/** 모르는 키의 메시지 — 키에 빈칸·쉼표·괄호가 있으면 { … } 안의 글에 쉼표가 있어 YAML 이 키로 읽은 것이다(흔한 실수라 바로 짚어 준다). */
const unknownKey = (k, allowed) => (/[\s,()]/.test(k) ? `모르는 키 "${k}" — { … } 안의 글에 쉼표가 있어 키로 읽혔습니다. 그 글을 따옴표로 감싸세요` : `모르는 키 ${k} — ${allowed.join('·')}`);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const dirs = (p) => (fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.')).map((d) => d.name).sort() : []);

/* ------------------------------------------------------------ 읽기 */

/**
 * actions/spec 을 읽어 { domains: { <갈래>: { domain, kinds: { <종류>: 데이터 } } }, errors } 로. 파일을 읽지 못하면 errors 에 적는다(검사는 checkActions).
 * 빈 폴더는 넘어간다 — 다른 유닛이 아직 쓰는 중인 갈래다.
 */
export function readActions(root = ROOT) {
  const errors = [];
  const domains = {};
  if (!fs.existsSync(root)) return { domains, errors: [`${path.relative(REPO, root).replaceAll('\\', '/')} 폴더가 없습니다`] };
  const rel = (file) => path.relative(root, file).replaceAll('\\', '/');
  const load = (file) => {
    try {
      const data = parse(fs.readFileSync(file, 'utf8'));
      if (!isObj(data)) { errors.push(`${rel(file)}: 맨 위는 이름: 값 꼴이어야 합니다`); return null; }
      return data;
    } catch (err) { errors.push(`${rel(file)}: ${err.message.split('\n')[0]}`); return null; }
  };
  for (const name of dirs(root)) {
    const dir = path.join(root, name);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();
    if (!files.length) continue;
    if (!files.includes('_domain.yaml')) { errors.push(`${name}/_domain.yaml 이 없습니다`); continue; }
    const kinds = {};
    for (const f of files) if (!f.startsWith('_')) kinds[f.slice(0, -5)] = load(path.join(dir, f));
    domains[name] = { domain: load(path.join(dir, '_domain.yaml')), kinds };
  }
  return { domains, errors };
}

/* ------------------------------------------------------------ 검사 */

/** 사전설정의 from 문법 — today · me · storage:<키>(.<경로>)* · recipe:<레지스트리>.<경로> · ctx:<이름>. 틀리면 던진다. */
export function parseFrom(from) {
  const s = String(from ?? '').trim();
  if (s === 'today' || s === 'me') return { source: s, key: '', path: [] };
  const m = s.match(/^(storage|recipe|ctx):([^.\s:]+)((?:\.[^.\s:]+)*)$/);
  if (!m) throw new Error(`from(${from})은 today · me · storage:<키> · recipe:<레지스트리>.<경로> · ctx:<이름> 가운데 하나여야 합니다`);
  return { source: m[1], key: m[2], path: m[3].split('.').filter(Boolean) };
}

/** RECIPE 안의 값(recipe:settings.profiles.연구품의). 없으면 undefined. */
const recipeGet = (recipe, key, pathParts) => pathParts.reduce((v, k) => (isObj(v) ? v[k] : undefined), recipe?.[key]);

/** 값이 그 형의 모양인가 — 틀리면 무엇이 틀렸는지. example·default·preset 의 value 에 쓴다. */
function valueProblem(f, v, what) {
  const bad = (why) => `${what}(${JSON.stringify(v)})${why}`;
  switch (f.type ?? 'string') {
    case 'date': {
      const m = typeof v === 'string' && v.match(DATE_RE);
      const d = m && new Date(+m[1], +m[2] - 1, +m[3]);
      return d && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? '' : bad('은 YYYY-MM-DD 날짜여야 합니다');
    }
    case 'time': return typeof v === 'string' && TIME_RE.test(v) ? '' : bad('은 24시간 HH:MM 글이어야 합니다');
    case 'integer': return Number.isInteger(v) && (f.min == null || v >= f.min) && (f.max == null || v <= f.max) ? '' : bad('은 범위 안의 정수여야 합니다');
    case 'number': return Number.isFinite(v) && (f.min == null || v >= f.min) && (f.max == null || v <= f.max) ? '' : bad('은 범위 안의 수여야 합니다');
    case 'enum': return list(f.values).includes(v) ? '' : bad('이 values 에 없습니다');
    case 'boolean': return typeof v === 'boolean' ? '' : bad('은 true·false 여야 합니다');
    // tags 는 values 가 있으면 그 값의 목록, 없으면 자유 글의 목록이다(공문 첨부 줄의 파일 이름들처럼).
    case 'tags': return Array.isArray(v) && v.every((x) => (Array.isArray(f.values) ? f.values.includes(x) : isStr(x))) ? '' : bad(Array.isArray(f.values) ? '은 values 의 값으로 된 목록이어야 합니다' : '은 글의 목록이어야 합니다');
    case 'string': return typeof v === 'string' ? '' : bad('은 글이어야 합니다');
    default: return bad(`은 ${f.type} 칸에 둘 수 없습니다`);
  }
}

/** when 하나 — 같은 fields 의 칸만 가리킨다(자기 자신은 안 된다). value 는 그 칸의 형에 맞아야 한다(boolean 은 true·false, enum 은 values). */
function whenProblem(when, key, siblings) {
  if (!isStr(when)) return 'when 은 key · !key · key=value · key!=value 꼴의 글이어야 합니다';
  const m = String(when).trim().match(WHEN_RE);
  if (!m) return `when(${when})은 key · !key · key=value · key!=value 꼴이어야 합니다`;
  const [, not, name, op, value] = m;
  if (not && op) return `when(${when})에서 !키 와 =값 을 같이 쓸 수 없습니다`;
  if (name === key) return `when(${when})이 자기 자신을 가리킵니다`;
  const target = siblings?.[name];
  if (!target) return `when(${when})의 ${name} 은 같은 fields 에 없는 칸입니다`;
  if (op) {
    if (!String(value ?? '').length) return `when(${when})의 값이 비어 있습니다`;
    if (target.type === 'boolean' && !['true', 'false'].includes(value)) return `when(${when}): ${name} 은 true·false 칸입니다`;
    if (target.type === 'enum' && !list(target.values).includes(value)) return `when(${when}): ${value} 는 ${name} 의 values 에 없습니다`;
  }
  return '';
}

/**
 * 칸 하나의 모양. nested 는 어디 안의 칸인지('' 맨 위 · 'list' 목록의 줄 · 'object' 객체 안 · 'object.list' 객체 안 목록의 줄) — 목록은 한 겹, 객체도 한 겹이고
 * 객체 안에 목록은 되지만 목록·객체 안에 객체는 안 된다(§3.3). siblings 는 when 이 가리킬 수 있는 같은 자리의 칸들. inTask 면 LLM 작업에 들어가는 칸이라 input.yaml 의 형만 된다.
 */
function checkField(at, where, key, f, { nested = '', siblings = null, inTask = false, tasks = INPUT_SPEC.tasks } = {}) {
  if (!KEY_RE.test(key)) return at(where, `칸 이름(${key})은 영문으로 시작하는 영문·숫자·_ 이어야 합니다`);
  if (!isObj(f)) return at(where, `${key}: { type, desc, read … } 꼴이어야 합니다`);
  const w = `${where} ${key}`;
  for (const k of Object.keys(f)) if (!FIELD_KEYS.includes(k)) at(w, unknownKey(k, FIELD_KEYS));
  if (!TYPES.has(f.type)) return at(w, `모르는 형 ${f.type} — ${[...TYPES].join('·')}`);
  // 모든 칸에 desc 와 read 를 둔다(2026-10-16 사용자 지정 — 사용자가 입력하는 칸도 나중에 LLM 을 넣을 수 있게).
  if (!isStr(f.desc)) at(w, 'desc(짧은 설명)가 비어 있습니다');
  if (!isStr(f.read)) at(w, 'read(LLM 에게 가는 인라인 프롬프트)가 비어 있습니다 — llm: false 인 칸에도 둡니다');
  for (const k of ['label', 'hint']) if (k in f && !isStr(f[k])) at(w, `${k} 는 글이어야 합니다`);
  for (const k of ['required', 'llm', 'ui']) if (k in f && typeof f[k] !== 'boolean') at(w, `${k} 는 true·false 여야 합니다`);
  if ('drop' in f) {
    if (nested) at(w, 'drop 은 맨 위의 칸에만 씁니다');
    else if (!isStr(f.drop)) at(w, 'drop 은 그 칸을 뺐다고 알리는 글이어야 합니다');
    if (f.required) at(w, '필수 칸은 drop 할 수 없습니다');
  }
  if ('when' in f) {
    const bad = whenProblem(f.when, key, siblings);
    if (bad) at(w, bad);
  }
  for (const lim of ['min', 'max']) if (lim in f && typeof f[lim] !== 'number') at(w, `${lim} 은 수여야 합니다`);
  if (typeof f.min === 'number' && typeof f.max === 'number' && f.min > f.max) at(w, `min(${f.min})이 max(${f.max})보다 큽니다`);
  if (('min' in f || 'max' in f) && !['integer', 'number', 'string', 'list'].includes(f.type)) at(w, `${f.type} 칸에는 min·max 를 두지 않습니다`);
  // enum 은 values 가 꼭 있다. tags 는 선택이다 — 있으면 그 값만 받는 목록, 없으면 자유 글의 목록(src/input.js 가 그렇게 받는다).
  if (f.type === 'enum' || (f.type === 'tags' && 'values' in f)) {
    if (!Array.isArray(f.values) || !f.values.length || f.values.some((v) => !isStr(v))) at(w, `${f.type} 은 글로 된 values 가 있어야 합니다`);
    else if (new Set(f.values).size !== f.values.length) at(w, 'values 가 겹칩니다');
  } else if ('values' in f) at(w, 'values 는 enum·tags 칸에만 씁니다');
  for (const k of ['example', 'default']) {
    if (!(k in f)) continue;
    if (['list', 'object', 'file'].includes(f.type)) { at(w, `${k} 은 ${f.type} 칸에 둘 수 없습니다 — 줄·안의 칸마다 둡니다`); continue; }
    const bad = valueProblem(f, f[k], k);
    if (bad) at(w, bad);
  }
  if (inTask && !TASK_TYPES.has(f.type)) at(w, `${f.type} 칸은 1단계에서 LLM 작업에 넣지 않습니다 — llm: false 로 둡니다`);
  if (f.type === 'list') {
    if (nested.endsWith('list')) return at(w, '목록 안에 목록을 둘 수 없습니다');
    if (!isObj(f.item)) return at(w, '목록은 줄의 칸(item)이 있어야 합니다');
    const { from, ...rest } = f.item;
    if (from !== undefined) {
      const m = isStr(from) && String(from).match(/^task:([A-Za-z][\w.]*)$/);
      if (!m) at(w, `item 의 from(${from})은 task:<input.yaml 의 작업 이름> 꼴이어야 합니다`);
      else if (!Object.hasOwn(tasks, m[1])) at(w, `item 의 from 이 가리키는 작업 ${m[1]} 이 input.yaml 에 없습니다`);
      else if (Object.values(tasks[m[1]].fields).some((x) => x.type === 'list')) at(w, `작업 ${m[1]} 에 목록 칸이 있어 줄에 펼칠 수 없습니다(목록은 한 겹)`);
    }
    if (!Object.keys(rest).length && from === undefined) at(w, '목록은 줄의 칸(item)이 있어야 합니다');
    for (const [k, sf] of Object.entries(rest)) checkField(at, `${w}.item`, k, sf, { nested: nested ? `${nested}.list` : 'list', siblings: rest, inTask, tasks });
    return undefined;
  }
  if (f.type === 'object') {
    if (nested) return at(w, `${nested === 'list' ? '목록의 줄' : '객체'} 안에 객체를 둘 수 없습니다(한 겹)`);
    // from(펼칠 것)과 fields(안의 칸) 가운데 하나 — 칸의 객체는 안이 보여야 한다(§14.1. fields 없는 불투명 객체는 사전설정에만 있다).
    if (('from' in f) === ('fields' in f)) return at(w, '객체 칸은 from(펼칠 것) 과 fields(안의 칸) 가운데 하나를 둡니다');
    if ('from' in f) {
      if (!isStr(f.from) || !(f.from === 'recipe' || ID_RE.test(f.from))) at(w, `from(${f.from})은 recipe 또는 행위 ID(<갈래>.<종류>)여야 합니다`);
      if ('omit' in f && !(Array.isArray(f.omit) && f.omit.length && f.omit.every((k) => KEY_RE.test(k)))) at(w, 'omit 은 펼치지 않을 칸 이름의 목록이어야 합니다');
      return undefined;
    }
    if ('omit' in f) at(w, 'omit 은 from 이 있는 객체 칸에만 씁니다');
    if (!isObj(f.fields) || !Object.keys(f.fields).length) return at(w, '객체 칸의 fields 가 비어 있습니다');
    for (const [k, sf] of Object.entries(f.fields)) checkField(at, `${w}.fields`, k, sf, { nested: 'object', siblings: f.fields, inTask, tasks });
    return undefined;
  }
  if ('from' in f) at(w, 'from 은 object 칸(과 list 의 item)에만 씁니다');
  if ('omit' in f) at(w, 'omit 은 from 이 있는 객체 칸에만 씁니다');
  if ('item' in f) at(w, 'item 은 list 칸에만 씁니다');
  if ('fields' in f) at(w, 'fields 는 object 칸에만 씁니다');
  return undefined;
}

/** 사전설정 항목 하나 — from 과 value 가운데 하나, desc 는 필수. type 은 칸의 형(없으면 string). object 는 fields(한 겹)를 둘 수 있고 없으면 불투명 객체다(§14.1). */
function checkPreset(at, where, key, p, { recipe, tasks }) {
  if (!KEY_RE.test(key)) return at(where, `사전설정 이름(${key})은 영문으로 시작하는 영문·숫자·_ 이어야 합니다`);
  if (!isObj(p)) return at(where, `${key}: { from | value, type?, desc } 꼴이어야 합니다`);
  const w = `${where} ${key}`;
  for (const k of Object.keys(p)) if (!PRESET_KEYS.includes(k)) at(w, unknownKey(k, PRESET_KEYS));
  if (('from' in p) === ('value' in p)) at(w, 'from 과 value 가운데 하나만 둡니다');
  if (!isStr(p.desc)) at(w, 'desc 가 비어 있습니다');
  if ('type' in p && !TYPES.has(p.type)) at(w, `모르는 형 ${p.type}`);
  for (const k of ['log', 'required']) if (k in p && typeof p[k] !== 'boolean') at(w, `${k} 는 true·false 여야 합니다`);
  if ('fields' in p) {
    if (p.type !== 'object') at(w, 'fields 는 type: object 인 사전설정에만 둡니다');
    else if (!isObj(p.fields) || !Object.keys(p.fields).length) at(w, 'fields 가 비어 있습니다');
    else for (const [k, sf] of Object.entries(p.fields)) checkField(at, `${w}.fields`, k, sf, { nested: 'object', siblings: p.fields, tasks });
  }
  if ('from' in p) {
    try {
      const { source, key: reg, path: rest } = parseFrom(p.from);
      if (source === 'recipe' && recipeGet(recipe, reg, rest) === undefined) at(w, `from(${p.from})이 가리키는 값이 레시피(src/gmrecipe.js RECIPE)에 없습니다`);
    } catch (err) { at(w, err.message); }
  }
  if ('value' in p) {
    // 사전설정에는 values 가 없으므로 enum·tags 는 글(의 목록)인지만 본다.
    const type = p.type ?? 'string';
    if (type === 'object') { if (!isObj(p.value)) at(w, 'value 는 이름: 값 꼴이어야 합니다'); } else if (type === 'list') { if (!Array.isArray(p.value)) at(w, 'value 는 목록이어야 합니다'); } else if (type === 'enum') { if (!isStr(p.value)) at(w, 'value 는 글이어야 합니다'); } else if (type === 'tags') {
      if (!(Array.isArray(p.value) && p.value.every(isStr))) at(w, 'value 는 글의 목록이어야 합니다');
    } else if (type !== 'file') {
      const bad = valueProblem({ type }, p.value, 'value');
      if (bad) at(w, bad);
    }
  }
  return undefined;
}

/** 틀의 {칸}·{preset.키} 이름. */
const tokensOf = (s) => [...String(s).matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]);

/** module 에 export 가 있는가 — 파일을 읽어 `export function|const|class 이름` 또는 `export { … 이름 … }` 을 찾는다. 돌려주는 글은 문제(없으면 빈 글). */
const srcCache = new Map();
function exportProblem(repo, use) {
  if (!isObj(use) || !isStr(use.module) || !isStr(use.export)) return 'uses 의 줄은 { module, export } 여야 합니다';
  const file = path.join(repo, use.module);
  if (!fs.existsSync(file)) return `${use.module} 파일이 없습니다`;
  if (!srcCache.has(file)) srcCache.set(file, fs.readFileSync(file, 'utf8'));
  const re = use.export === 'default' ? /^export\s+default\b/m
    : new RegExp(`^export\\s+(?:async\\s+)?(?:function\\*?|const|let|var|class)\\s+${use.export}\\b|^export\\s*\\{[^}]*\\b${use.export}\\b[^}]*\\}`, 'm');
  return re.test(srcCache.get(file)) ? '' : `${use.module} 에 ${use.export} 가 없습니다`;
}

/**
 * 종류의 칸 — `칸: { from: domain }` 은 갈래 공통 칸(_domain.yaml fields)의 같은 이름 칸으로 바뀐다(차례는 종류 파일의 자리). 다른 키가 섞여 있거나 공통 칸이 없으면
 * at 에 적고 그 칸은 뺀다. 검사(checkActions)와 만들기(buildActions)가 같은 것을 본다 — 펼친 뒤의 칸만 보므로 그 뒤의 검사는 from: domain 을 모른다.
 */
function kindFields(domain, data, at, kw) {
  const common = isObj(domain?.fields) ? domain.fields : {};
  const out = {};
  for (const [key, f] of Object.entries(isObj(data?.fields) ? data.fields : {})) {
    if (!(isObj(f) && f.from === 'domain')) { out[key] = f; continue; }
    const extra = Object.keys(f).filter((k) => k !== 'from');
    if (extra.length) at(`${kw} fields ${key}`, `from: domain 칸에는 다른 키(${extra.join('·')})를 두지 않습니다 — 다르게 쓰려면 칸을 통째로 적습니다`);
    if (!isObj(common[key])) { at(`${kw} fields ${key}`, `from: domain 이 가리키는 공통 칸이 _domain.yaml 의 fields 에 없습니다`); continue; }
    out[key] = clone(common[key]);
  }
  return out;
}

/**
 * 명세 전체의 모양과 서로 가리키는 것(id 와 파일 자리 · 갈래 kinds 와 파일 · 칸의 형·desc·read · from 의 대상 · checks·summary 의 칸 · preset 의 from 문법 ·
 * runner(live 면 §6.6 의 이름) · uses 의 module·export · then 의 행위 · recipe 모드의 작업)을 본다. 만든 작업의 검사(checkSpec)와 merged 의 키 충돌은 buildActions 가 본다.
 */
export function checkActions({ domains, errors: readErrors = [] }, { repo = REPO, recipe = RECIPE, tasks = INPUT_SPEC.tasks } = {}) {
  const errors = [...readErrors];
  if (readErrors.length) return errors;
  const at = (where, msg) => errors.push(`${where}: ${msg}`);
  const ids = new Set();
  const fieldsOf = {};   // 행위 ID → 맨 위 칸(from 을 펼치기 전)
  const thens = [];
  const froms = [];
  for (const [name, { domain, kinds }] of Object.entries(domains)) {
    const dw = `${name}/_domain.yaml`;
    if (!isObj(domain)) { at(dw, '읽지 못했습니다'); continue; }
    for (const k of Object.keys(domain)) if (!DOMAIN_KEYS.includes(k)) at(dw, unknownKey(k, DOMAIN_KEYS));
    if (domain.domain !== name) at(dw, `domain(${domain.domain})이 폴더 이름(${name})과 다릅니다`);
    if (!isStr(domain.title)) at(dw, 'title 이 비어 있습니다');
    if (!isStr(domain.log)) at(dw, 'log(활동 로그 kind)가 비어 있습니다');
    const kindList = list(domain.kinds);
    if (!kindList.length || kindList.some((k) => !isStr(k))) at(dw, 'kinds 는 종류 파일 이름의 목록이어야 합니다');
    if (new Set(kindList).size !== kindList.length) at(dw, 'kinds 가 겹칩니다');
    for (const k of kindList) if (!(k in kinds)) at(dw, `kinds 의 ${k} 파일(${name}/${k}.yaml)이 없습니다`);
    for (const k of Object.keys(kinds)) if (!kindList.includes(k)) at(dw, `${name}/${k}.yaml 이 kinds 에 없습니다`);
    for (const [key, p] of Object.entries(isObj(domain.preset) ? domain.preset : {})) checkPreset(at, `${dw} preset`, key, p, { recipe, tasks });
    if ('preset' in domain && !isObj(domain.preset)) at(dw, 'preset 은 이름: { from | value, desc } 꼴이어야 합니다');
    // 갈래 공통 칸 — 종류 파일이 { from: domain } 으로 가져온다. 칸의 꼴은 종류의 칸과 같다(from: domain 은 여기 둘 수 없다 — 자기 자신).
    if ('fields' in domain && !(isObj(domain.fields) && Object.keys(domain.fields).length)) at(dw, 'fields 는 이름: 칸 꼴이어야 합니다(갈래 공통 칸 — 종류 파일이 { from: domain } 으로 가져온다)');
    for (const [key, f] of Object.entries(isObj(domain.fields) ? domain.fields : {})) {
      if (isObj(f) && f.from === 'domain') { at(`${dw} fields ${key}`, 'from: domain 은 종류 파일의 칸에만 씁니다'); continue; }
      checkField(at, `${dw} fields`, key, f, { siblings: domain.fields, tasks });
    }
    // 갈래의 LLM 작업
    const llm = isObj(domain.llm) ? domain.llm : {};
    if ('llm' in domain && !isObj(domain.llm)) at(dw, 'llm 은 { mode, … } 꼴이어야 합니다');
    for (const k of Object.keys(llm)) if (!LLM_KEYS.includes(k)) at(`${dw} llm`, unknownKey(k, LLM_KEYS));
    const mode = llm.mode ?? 'none';
    if (!MODES.has(mode)) at(`${dw} llm`, `모르는 mode ${mode} — ${[...MODES].join('·')}`);
    const makes = mode === 'merged' || mode === 'per-kind';
    // recipe 모드(공문)의 종류 가운데 레시피의 목적인 것은 레시피의 목적 차례와 같다 — 레시피에 목적을 더하면 종류 YAML 도 더한다(패널의 갈래 단추는 RECIPE.order 로 서므로 빠지면 공문 작성이 "없는 행위" 로 막힌다).
    // 목적이 아닌 종류(선행 품의 읽기 prior — 2026-10-17 "이것도 명세서를 만든 다음에 러너로")는 그 뒤에 둘 수 있고, 레시피가 작업을 만들지 않으니 llm: false 여야 한다.
    if (mode === 'recipe') {
      const purposes = kindList.filter((k) => Object.hasOwn(recipe?.purposes || {}, k));
      if (JSON.stringify(purposes) !== JSON.stringify(list(recipe?.order))) {
        at(dw, `recipe 모드의 kinds 가운데 레시피의 목적(${purposes.join(' · ')})은 레시피의 목적 차례(RECIPE.order — ${list(recipe?.order).join(' · ')})와 같아야 합니다. 종류 YAML 을 더하거나 뺀 뒤 kinds 를 맞추세요`);
      }
      const extras = kindList.filter((k) => !Object.hasOwn(recipe?.purposes || {}, k));
      if (extras.length && kindList.indexOf(extras[0]) < purposes.length) at(dw, `레시피의 목적이 아닌 종류(${extras.join(' · ')})는 kinds 에서 목적들 뒤에 둡니다`);
      for (const k of extras) if (isObj(kinds[k]) && kinds[k].llm !== false) at(`${name}/${k}.yaml`, '레시피의 목적이 아닌 종류는 llm: false 여야 합니다(레시피가 이 종류의 작업을 만들지 않습니다)');
    }
    if (makes) {
      for (const k of ['task', 'title', 'next', 'role', 'input']) if (!isStr(llm[k])) at(`${dw} llm`, `${k} 가 비어 있습니다(${mode} 모드)`);
      if (isStr(llm.task) && !/^[A-Za-z][\w.]*$/.test(llm.task)) at(`${dw} llm`, `task(${llm.task})는 영문·숫자·점 이름이어야 합니다`);
      if (!isObj(llm.consumer)) at(`${dw} llm`, 'consumer 는 { module, export } 여야 합니다');
      else { const bad = exportProblem(repo, llm.consumer); if (bad) at(`${dw} llm consumer`, bad); }
      if ('partial' in llm && typeof llm.partial !== 'boolean') at(`${dw} llm`, 'partial 은 true·false 여야 합니다');
      if ('rules' in llm && !(Array.isArray(llm.rules) && llm.rules.every(isStr))) at(`${dw} llm`, 'rules 는 글의 목록이어야 합니다');
      if ('fields' in llm && !isObj(llm.fields)) at(`${dw} llm`, 'fields 는 이름: 칸 꼴이어야 합니다');
      for (const [key, f] of Object.entries(isObj(llm.fields) ? llm.fields : {})) checkField(at, `${dw} llm.fields`, key, f, { siblings: llm.fields, inTask: true, tasks });
    } else if (['title', 'consumer', 'next', 'role', 'rules', 'fields', 'input', 'partial'].some((k) => k in llm)) {
      at(`${dw} llm`, `${mode} 모드는 작업을 만들지 않습니다 — title·consumer·next·role·rules·fields·input·partial 을 두지 않습니다`);
    }
    // 종류 파일
    for (const [kind, data] of Object.entries(kinds)) {
      const kw = `${name}/${kind}.yaml`;
      if (!isObj(data)) { at(kw, '읽지 못했습니다'); continue; }
      for (const k of Object.keys(data)) if (!KIND_KEYS.includes(k)) at(kw, unknownKey(k, KIND_KEYS));
      if (data.id !== `${name}.${kind}`) at(kw, `id(${data.id})는 ${name}.${kind} 여야 합니다`);
      if (ids.has(data.id)) at(kw, `행위 ID ${data.id} 가 두 번 나옵니다`);
      ids.add(data.id);
      if (!isStr(data.title)) at(kw, 'title 이 비어 있습니다');
      if ('hint' in data && !isStr(data.hint)) at(kw, 'hint 는 글이어야 합니다');
      const status = data.status ?? 'live';
      if (!STATUSES.has(status)) at(kw, `모르는 status ${status} — live·planned`);
      if ('confirm' in data && typeof data.confirm !== 'boolean') at(kw, 'confirm 은 true·false 여야 합니다');
      if ('effect' in data && !EFFECTS.has(data.effect)) at(kw, `모르는 effect ${data.effect} — none·draft·write`);
      if ('log' in data && !isStr(data.log)) at(kw, 'log 는 글이어야 합니다');
      if ('next' in data && !isStr(data.next)) at(kw, 'next 는 글이어야 합니다');
      for (const [key, p] of Object.entries(isObj(data.preset) ? data.preset : {})) checkPreset(at, `${kw} preset`, key, p, { recipe, tasks });
      if ('preset' in data && !isObj(data.preset)) at(kw, 'preset 은 이름: { from | value, desc } 꼴이어야 합니다');
      // 종류의 llm — 모드마다 받는 꼴이 다르다.
      const kl = data.llm;
      const llmOn = kl === undefined ? makes : kl !== false;
      if (mode === 'merged') {
        if (kl !== undefined && typeof kl !== 'boolean') at(kw, 'merged 모드에서는 llm 이 true·false 입니다');
      } else if (mode === 'per-kind') {
        if (kl === true || kl === undefined) at(kw, 'per-kind 모드에서 LLM 을 켠 종류는 llm: { task: <작업 이름> } 로 이름을 적어야 합니다(§14.2)');
        else if (kl !== false && !(isObj(kl) && isStr(kl.task) && Object.keys(kl).every((k) => k === 'task'))) at(kw, 'llm 은 false 또는 { task: <작업 이름> } 여야 합니다');
        else if (isObj(kl) && !/^[A-Za-z][\w.]*$/.test(kl.task)) at(kw, `llm.task(${kl.task})는 영문·숫자·점 이름이어야 합니다`);
      } else if (mode === 'recipe') {
        if (kl !== undefined && kl !== false && !(isObj(kl) && Array.isArray(kl.tasks) && Object.keys(kl).every((k) => k === 'tasks'))) at(kw, 'recipe 모드에서는 llm 이 false 또는 { tasks: [{ task, fills }] } 입니다');
        for (const t of isObj(kl) ? list(kl.tasks) : []) {
          if (!isObj(t) || !isStr(t.task) || !isStr(t.fills)) { at(kw, 'llm.tasks 의 줄은 { task, fills } 여야 합니다'); continue; }
          if (!Object.hasOwn(recipe.tasks, t.task)) at(kw, `llm.tasks 의 ${t.task} 가 레시피의 작업(RECIPE.tasks)에 없습니다`);
          // 레시피의 작업은 목적마다 만들어지고 이름이 `.<목적>` 으로 끝난다 — 다른 종류의 작업(있는 이름)을 잘못 가리키는 것을 잡는다.
          else if (!t.task.endsWith(`.${kind}`)) at(kw, `llm.tasks 의 ${t.task} 는 이 종류(${kind})의 작업이 아닙니다 — 레시피의 작업 이름은 .${kind} 로 끝나야 합니다`);
          if (!isObj(data.fields) || !(t.fills in data.fields)) at(kw, `llm.tasks 의 fills(${t.fills})가 fields 에 없습니다`);
        }
      } else if (kl !== undefined && kl !== false) at(kw, `갈래의 llm.mode 가 ${mode} 라 llm 은 false 뿐입니다`);
      // 칸 — { from: domain } 은 갈래 공통 칸으로 바꾼 뒤 본다.
      const fields = kindFields(domain, data, at, kw);
      if (!isObj(data.fields) || !Object.keys(data.fields).length) at(kw, 'fields 가 비어 있습니다');
      for (const [key, f] of Object.entries(fields)) {
        checkField(at, `${kw} fields`, key, f, { siblings: fields, inTask: makes && llmOn && f?.llm !== false, tasks });
        if (isObj(f) && f.type === 'object' && isStr(f.from) && f.from !== 'recipe') froms.push({ kw, key, from: f.from, omit: list(f.omit) });
        if (isObj(f) && f.type === 'object' && f.from === 'recipe' && !Object.hasOwn(recipe.purposes, kind)) at(`${kw} fields ${key}`, `from: recipe 는 레시피에 있는 목적(${Object.keys(recipe.purposes).join('·')})의 종류에서만 됩니다`);
        if (isObj(f) && f.drop && !(mode === 'per-kind' && llmOn)) at(`${kw} fields ${key}`, 'drop 은 per-kind 모드에서 LLM 을 켠 종류의 칸에만 씁니다(작업에는 들어가고 기록에서는 빠진다)');
      }
      fieldsOf[data.id] = fields;
      if ('ignore' in data && !(Array.isArray(data.ignore) ? data.ignore.every(isStr) : isObj(data.ignore) && Object.values(data.ignore).every((v) => typeof v === 'string'))) {
        at(kw, 'ignore 는 화면 전용 키의 목록이거나 키: 까닭 꼴이어야 합니다');
      }
      for (const k of Array.isArray(data.ignore) ? data.ignore : Object.keys(isObj(data.ignore) ? data.ignore : {})) if (k in fields) at(kw, `ignore 의 ${k} 가 fields 에도 있습니다`);
      // checks
      for (const c of list(data.checks)) {
        if (!isObj(c)) { at(kw, 'checks 의 줄은 { left, op, right, message } 여야 합니다'); continue; }
        if (!(c.left in fields) || !(c.right in fields)) at(kw, `checks: 없는 칸(${c.left}, ${c.right})`);
        if (!OPS.has(c.op)) at(kw, `checks: 모르는 비교 ${c.op}`);
        // drop 이 필수 칸이어도 된다 — 실행 모드에서는 drop 자체가 problem 이고(§14.1), 작업(partial)에서는 required 가 없다(checkSpec 이 작업을 따로 본다).
        if (c.drop && !(c.drop in fields)) at(kw, `checks: drop 이 없는 칸(${c.drop})`);
        if (!isStr(c.message)) at(kw, 'checks: message 가 비어 있습니다');
      }
      if ('checks' in data && !Array.isArray(data.checks)) at(kw, 'checks 는 목록이어야 합니다');
      if ('rules' in data && !(Array.isArray(data.rules) && data.rules.every(isStr))) at(kw, 'rules 는 글의 목록이어야 합니다');
      // summary 의 자리
      if ('summary' in data) {
        if (!isStr(data.summary)) at(kw, 'summary 는 글이어야 합니다');
        const presetKeys = { ...(isObj(domain.preset) ? domain.preset : {}), ...(isObj(data.preset) ? data.preset : {}) };
        for (const t of tokensOf(data.summary || '')) {
          if (t.startsWith('preset.')) { if (!(t.slice(7) in presetKeys)) at(kw, `summary 의 {${t}} 가 사전설정에 없습니다`); } else if (!(t in fields) || fields[t]?.drop) at(kw, `summary 의 {${t}} 가 fields 에 없습니다`);
        }
      }
      // 실행기·실행 경로·뒤따르는 행위
      if (status === 'live') {
        if (!isStr(data.runner)) at(kw, 'live 행위는 runner(실행기 이름)가 있어야 합니다');
        else if (!RUNNERS.includes(data.runner)) at(kw, `runner ${data.runner} 는 등록되는 실행기가 아닙니다 — ${RUNNERS.join(' · ')}`);
      } else if ('runner' in data && !isStr(data.runner)) at(kw, 'runner 는 글이어야 합니다');
      if (!list(data.uses).length) at(kw, 'uses(실행 경로 — { module, export } 의 목록)가 비어 있습니다');
      for (const u of list(data.uses)) { const bad = exportProblem(repo, u); if (bad) at(`${kw} uses`, bad); }
      for (const t of list(data.then)) {
        if (!isObj(t) || !isStr(t.action)) { at(kw, 'then 의 줄은 { action, when? } 여야 합니다'); continue; }
        if (!ID_RE.test(t.action)) at(kw, `then 의 action(${t.action})은 <갈래>.<종류> 여야 합니다`);
        if ('when' in t) { const bad = whenProblem(t.when, '', fields); if (bad) at(`${kw} then ${t.action}`, bad); }
        thens.push({ kw, action: t.action });
      }
      if ('then' in data && !Array.isArray(data.then)) at(kw, 'then 은 목록이어야 합니다');
    }
  }
  // 서로 가리키는 것 — then 의 행위(갈래 폴더가 아직 없으면 묻지 않는다)와 object 칸의 from(한 겹 — 대상의 칸에 object·from 이 있으면 안 된다).
  for (const { kw, action } of thens) {
    const [dom] = action.split('.');
    if (dom in domains && !ids.has(action)) at(kw, `then 의 ${action} 은 없는 행위입니다`);
  }
  for (const { kw, key, from, omit } of froms) {
    if (!ids.has(from)) { at(`${kw} fields ${key}`, `from 이 가리키는 행위 ${from} 이 없습니다`); continue; }
    for (const k of omit) if (!(k in (fieldsOf[from] || {}))) at(`${kw} fields ${key}`, `omit 의 ${k} 는 ${from} 에 없는 칸입니다`);
    for (const [k, f] of Object.entries(fieldsOf[from] || {})) {
      if (!omit.includes(k) && isObj(f) && (f.type === 'object' || 'from' in f)) at(`${kw} fields ${key}`, `from 의 대상 ${from} 의 ${k} 칸이 객체(또는 from)라 한 겹에 펼칠 수 없습니다 — omit 으로 뺄 수 있습니다`);
    }
  }
  return errors;
}

/* ------------------------------------------------------------ 만들기 */

/** 칸의 read 에 example 을 붙인 글 — 작업의 desc 가 된다(§14.2: promptOf 는 desc 만 읽는다). */
const exampleText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const readText = (f) => `${oneLine(f.read)}${'example' in f ? ` (예: ${exampleText(f.example)})` : ''}`;

/** YAML 의 칸 → 생성물의 칸(키 차례를 고정한다 — 생성물이 결정적이어야 한다). top 이면 llm·ui 의 기본값(true)을 적는다. */
function normField(f, { top = false } = {}) {
  const out = { type: f.type };
  if (f.required === true) out.required = true;
  if ('label' in f) out.label = f.label;
  out.desc = oneLine(f.desc);
  out.read = oneLine(f.read);
  if (top) { out.llm = f.llm !== false; out.ui = f.ui !== false; } else { if ('llm' in f) out.llm = f.llm; if ('ui' in f) out.ui = f.ui; }
  for (const k of ['when', 'default', 'drop', 'example', 'min', 'max', 'values', 'hint', 'from', 'omit']) if (k in f) out[k] = clone(f[k]);
  if (f.type === 'list') {
    // 줄의 칸 — item 의 from(task:<이름>)이 가리키는 input.yaml 작업의 칸이 앞, YAML 에 더 적은 칸이 뒤.
    const { from, ...rest } = f.item;
    out.item = {
      ...(isStr(from) ? Object.fromEntries(Object.entries(INPUT_SPEC.tasks[from.slice(5)].fields).map(([k, sf]) => [k, taskFieldAsField(sf)])) : {}),
      ...Object.fromEntries(Object.entries(rest).map(([k, sf]) => [k, normField(sf)])),
    };
  }
  if (f.type === 'object' && isObj(f.fields)) out.fields = Object.fromEntries(Object.entries(f.fields).map(([k, sf]) => [k, normField(sf)]));
  return out;
}

/** input.yaml 작업의 칸 → 행위의 칸(from: task:<이름> 으로 펼칠 때). read 는 desc 와 같다. */
function taskFieldAsField(sf) {
  const out = { type: sf.type };
  if (sf.required) out.required = true;
  out.desc = sf.desc;
  out.read = sf.desc;
  for (const k of ['min', 'max', 'values']) if (k in sf) out[k] = clone(sf[k]);
  return out;
}

/** 레시피의 읽는 키·초안 칸 하나 → 행위의 칸(§3.5·§14.2). draft 안의 칸에는 required 를 두지 않고(nested 가 아닐 때), 목록 줄의 required 는 그대로다. */
function recipeField(k, { nested = false } = {}) {
  const type = k.type ?? 'text';
  const out = { type: RECIPE_TYPE[type] };
  if (nested && k.required) out.required = true;
  if (isStr(k.label)) out.label = k.label;
  out.desc = isStr(k.label) ? k.label : oneLine(k.read);
  out.read = isStr(k.read) ? oneLine(k.read) : `${k.label} 칸`;
  if ('example' in k) out.example = clone(k.example);
  if (type === 'choice') out.values = [...k.options];
  if (type === 'money' || type === 'number') { out.min = 0; if (k.max != null) out.max = k.max; }
  if (type === 'text') out.max = k.max ?? (k.area ? 1000 : 200);
  if (type === 'list') {
    out.max = k.max ?? 30;
    out.item = Object.fromEntries(list(k.item).map((x) => [x.key, recipeField(x, { nested: true })]));
  }
  return out;
}

/** gongmun 종류의 draft 칸 — 레시피 purpose.yaml 의 fields ∪ reads ∪ { currency, attach }(§14.2). */
export function recipeDraftFields(purpose) {
  return {
    ...Object.fromEntries(list(purpose.fields).map((f) => [f.key, recipeField(f)])),
    ...Object.fromEntries(list(purpose.reads).map((k) => [k.key, recipeField(k)])),
    currency: {
      type: 'enum', label: '화폐', desc: '합계의 화폐 — 원화가 아니면 합계를 원화로 고쳐 적는다(src/gongmun.js fromRecord 의 알림)',
      read: '문서의 화폐(ISO 세 글자 코드). 원화 문서면 KRW', default: 'KRW', values: ['KRW', 'USD', 'EUR', 'JPY', 'CNY', 'GBP'],
    },
    // 패널의 draft.attach 줄 그대로(src/gongmun.js attachList — { label, files }). 실행 모드 관문이 줄을 빼면 problem 이라 모양이 같아야 공문 작성이 막히지 않는다.
    attach: {
      type: 'list', label: '첨부', desc: '첨부 목록 — 문서 이름마다 그 문서로 묶는 파일 이름들(src/gongmun.js attachList — 레시피 attach_rules.yaml 의 parts)',
      read: '첨부 문서마다 이름과 그 문서로 묶는 파일 이름들', max: 20,
      item: {
        label: { type: 'string', required: true, desc: '첨부 목록의 문서 이름(견적서·교육 안내 …)', read: '첨부 목록에 적는 문서 이름', max: 100 },
        files: { type: 'tags', desc: '그 문서로 묶는 파일 이름들(자유 글의 목록 — values 없음)', read: '그 문서로 묶는 파일 이름들. 모르면 빈 목록' },
      },
    },
  };
}

/** 사전설정의 꼴을 고정한다(from | value, type, desc, log, required). */
function normPresets(presets) {
  const out = {};
  for (const [key, p] of Object.entries(isObj(presets) ? presets : {})) {
    const q = {};
    if ('from' in p) q.from = p.from; else q.value = clone(p.value);
    if ('type' in p) q.type = p.type;
    q.desc = oneLine(p.desc);
    if (p.log === false) q.log = false;
    if (p.required === true) q.required = true;
    if (isObj(p.fields)) q.fields = Object.fromEntries(Object.entries(p.fields).map(([k, sf]) => [k, normField(sf)]));
    out[key] = q;
  }
  return out;
}

/** 칸을 사람에게 부를 이름 — label, 없으면 desc 의 첫 마디(src/input.js nameOf 와 같은 자름), 그것도 없으면 키. */
const labelOf = (f, key = '') => (isStr(f.label) ? f.label.trim() : oneLine(f.desc || '').split(/[.,(:]/)[0].trim() || key);

/**
 * 작업에 들어가는 칸 — input.yaml 의 칸 꼴(type·required·desc·values·min·max·item)에 label 을 더한 것. desc 는 read(+ 예)이고 label 은 관문이 알림에서
 * 칸을 부르는 이름이다(src/input.js nameOf 가 label 을 먼저 쓴다 — "지역 값(대전)은 받을 수 없어 뺐습니다". 긴 read 가 알림에 끼지 않게 늘 낸다).
 * partial 이면 required 가 없다.
 */
function taskField(f, { partial = false, key = '' } = {}) {
  const out = { type: f.type };
  if (!partial && f.required) out.required = true;
  out.label = labelOf(f, key);
  out.desc = readText(f);
  for (const k of ['values', 'min', 'max']) if (k in f) out[k] = clone(f[k]);
  if (f.type === 'list') out.item = Object.fromEntries(Object.entries(f.item).map(([k, sf]) => [k, taskField(sf, { key: k })]));
  return out;
}

/** 같은 키의 read 가 종류마다 다르면 "종류별 — a·b: …; c: …" 로 합친다(같은 글은 묶는다). */
function mergeReads(reads) {
  const groups = [];
  for (const { kind, text } of reads) {
    const g = groups.find((x) => x.text === text);
    if (g) g.kinds.push(kind); else groups.push({ text, kinds: [kind] });
  }
  return groups.length === 1 ? groups[0].text : `종류별 — ${groups.map((g) => `${g.kinds.join('·')}: ${g.text}`).join('; ')}`;
}

const checkKey = (c) => JSON.stringify([c.left, c.op, c.right, c.drop ?? null]);
const uniqueChecks = (checks) => { const seen = new Set(); return checks.filter((c) => !seen.has(checkKey(c)) && seen.add(checkKey(c))); };
const taskChecks = (checks, fields) => uniqueChecks(checks.filter((c) => c.left in fields && c.right in fields && (!c.drop || c.drop in fields)).map((c) => clone(c)));

/**
 * 읽은 명세를 생성물(ACTIONS)로. 검사(checkActions)를 지난 것을 받는다 — 여기서 잡는 것은 from 을 펼친 뒤에야 보이는 것(한 겹 규칙), merged 의 같은 키 충돌,
 * 작업 이름 겹침, 만든 작업의 checkSpec 뿐이다.
 * @returns {{spec: object, errors: string[]}}
 */
export function buildActions({ domains }, { recipe = RECIPE } = {}) {
  const errors = [];
  const at = (where, msg) => errors.push(`${where}: ${msg}`);
  const spec = { version: 1, domains: {}, actions: {}, tasks: {} };
  const all = {};   // 행위 ID → drop 칸까지 든 칸(작업용)
  // 1) 갈래와 행위(from 은 아직) — 갈래는 이름 차례, 행위는 갈래 kinds 차례.
  for (const name of Object.keys(domains).sort()) {
    const { domain, kinds } = domains[name];
    const llm = isObj(domain.llm) ? domain.llm : {};
    const mode = llm.mode ?? 'none';
    const makes = mode === 'merged' || mode === 'per-kind';
    spec.domains[name] = {
      domain: name, title: domain.title, log: domain.log, kinds: [...domain.kinds], preset: normPresets(domain.preset),
      llm: makes ? {
        task: llm.task, mode, partial: llm.partial === true, input: llm.input, title: llm.title, consumer: clone(llm.consumer), next: oneLine(llm.next),
        role: oneLine(llm.role), rules: list(llm.rules).map(oneLine),
        fields: Object.fromEntries(Object.entries(isObj(llm.fields) ? llm.fields : {}).map(([k, f]) => [k, normField(f, { top: true })])),
      } : { ...(isStr(llm.task) ? { task: llm.task } : {}), mode },
    };
    for (const kind of domain.kinds) {
      const data = kinds[kind];
      const kw = `${name}/${kind}.yaml`;
      const fields = {};
      const drops = {};
      for (const [key, f] of Object.entries(kindFields(domain, data, at, kw))) {
        const nf = normField(f, { top: true });
        // gongmun 종류의 draft — 레시피의 초안 칸·읽는 키를 펼친다(§3.5·§14.2).
        if (f.type === 'object' && f.from === 'recipe') nf.fields = recipeDraftFields(recipe.purposes[kind]);
        if (nf.drop) drops[key] = nf.drop;
        fields[key] = nf;
      }
      const kl = data.llm;
      const llmOn = kl === undefined ? makes : kl !== false;
      const entry = {
        id: data.id, domain: name, kind, title: data.title,
        ...(isStr(data.hint) ? { hint: data.hint } : {}),
        status: data.status ?? 'live', confirm: data.confirm ?? true, effect: data.effect ?? 'write', log: data.log ?? domain.log,
        ...(isStr(data.summary) ? { summary: data.summary } : {}),
        preset: { ...normPresets(domain.preset), ...normPresets(data.preset) },
        fields: Object.fromEntries(Object.entries(fields).filter(([key]) => !(key in drops))),
        ...(Object.keys(drops).length ? { drops } : {}),
        ...('ignore' in data ? { ignore: Array.isArray(data.ignore) ? Object.fromEntries(data.ignore.map((k) => [k, ''])) : { ...data.ignore } } : {}),
        checks: list(data.checks).map((c) => clone(c)), rules: list(data.rules).map(oneLine),
        llm: mode === 'recipe' ? (isObj(kl) ? { tasks: clone(kl.tasks) } : false) : llmOn,
        ...(makes && llmOn ? { task: mode === 'merged' ? llm.task : kl.task } : {}),
        runner: isStr(data.runner) ? data.runner : null, uses: list(data.uses).map((u) => clone(u)), then: list(data.then).map((t) => clone(t)),
        ...(isStr(data.next) ? { next: oneLine(data.next) } : {}),
      };
      if (spec.actions[data.id]) at(kw, `행위 ID ${data.id} 가 두 번 나옵니다`);
      spec.actions[data.id] = entry;
      all[data.id] = fields;
    }
  }
  // 2) object 칸의 from: <행위 ID> 를 펼친다(한 겹 — 대상의 칸은 from 을 펼치기 전의 것이고 object 가 아니어야 한다).
  const before = Object.fromEntries(Object.entries(spec.actions).map(([id, e]) => [id, clone(e.fields)]));
  for (const [id, entry] of Object.entries(spec.actions)) {
    for (const [key, f] of Object.entries(entry.fields)) {
      if (f.type !== 'object' || !isStr(f.from) || f.from === 'recipe') continue;
      const target = before[f.from];
      if (!target) { at(`${entry.domain}/${entry.kind}.yaml fields ${key}`, `from 이 가리키는 행위 ${f.from} 이 없습니다`); continue; }
      const copied = {};
      for (const [k, sf] of Object.entries(target)) {
        if (list(f.omit).includes(k)) continue;
        if (sf.type === 'object' || 'from' in sf) { at(`${entry.domain}/${entry.kind}.yaml fields ${key}`, `${f.from} 의 ${k} 칸은 객체라 한 겹에 펼칠 수 없습니다`); continue; }
        const { llm: _l, ui: _u, ...rest } = sf;
        copied[k] = rest;
      }
      f.fields = copied;
    }
  }
  // 3) LLM 작업
  for (const [name, dom] of Object.entries(spec.domains)) {
    const { llm } = dom;
    const entries = Object.fromEntries(dom.kinds.map((k) => [k, spec.actions[`${name}.${k}`]]));
    const hintOf = (k) => entries[k].hint || entries[k].title;
    const put = (taskName, task, where) => {
      if (spec.tasks[taskName]) at(where, `작업 이름 ${taskName} 이 겹칩니다`);
      spec.tasks[taskName] = task;
    };
    if (llm.mode === 'merged') {
      const kinds = dom.kinds.filter((k) => entries[k].llm === true);
      const fields = { kind: { type: 'enum', label: `${dom.title} 종류`, desc: `${dom.title} 종류. ${kinds.map((k) => `${k}(${hintOf(k)})`).join('·')}`, values: [...kinds] } };
      const reads = {};
      const labels = {};   // 키마다 종류별 이름 — 다르면 "출발일·날짜·시작일" 로 잇는다(알림이 어느 칸인지 알 수 있게)
      const seen = {};
      for (const k of kinds) {
        for (const [key, f] of Object.entries(all[`${name}.${k}`])) {
          if (f.llm === false) continue;
          const w = `${name}/${k}.yaml fields ${key}`;
          if (!TASK_TYPES.has(f.type)) { at(w, `${f.type} 칸은 작업에 넣을 수 없습니다 — llm: false 로 둡니다`); continue; }
          if (!fields[key]) { fields[key] = taskField(f, { partial: llm.partial, key }); reads[key] = []; labels[key] = []; seen[key] = k; } else {
            const have = fields[key];
            if (have.type !== f.type) { at(w, `같은 키의 형이 다릅니다(${seen[key]}: ${have.type}, ${k}: ${f.type})`); continue; }
            for (const lim of ['min', 'max']) if ((have[lim] ?? null) !== (f[lim] ?? null)) at(w, `같은 키의 ${lim} 이 다릅니다(${seen[key]}: ${have[lim] ?? '없음'}, ${k}: ${f[lim] ?? '없음'})`);
            if (f.type === 'enum') for (const v of f.values) if (!have.values.includes(v)) have.values.push(v);
            if (f.type === 'list' && JSON.stringify(have.item) !== JSON.stringify(taskField(f).item)) at(w, `같은 키의 목록 줄(item)이 다릅니다(${seen[key]} 와)`);
            if (!llm.partial && have.required && !f.required) delete have.required;
          }
          reads[key].push({ kind: k, text: readText(f) });
          if (!labels[key].includes(labelOf(f, key))) labels[key].push(labelOf(f, key));
        }
      }
      for (const key of Object.keys(labels)) fields[key].label = labels[key].join('·');
      if (!llm.partial) for (const key of Object.keys(fields)) if (key !== 'kind' && fields[key].required && !kinds.every((k) => key in all[`${name}.${k}`] && all[`${name}.${k}`][key].llm !== false)) delete fields[key].required;
      for (const key of Object.keys(reads)) fields[key].desc = mergeReads(reads[key]);
      for (const [key, f] of Object.entries(llm.fields)) {
        if (fields[key]) at(`${name}/_domain.yaml llm.fields ${key}`, '종류의 칸과 이름이 겹칩니다');
        fields[key] = taskField(f, { partial: llm.partial, key });
      }
      const checks = taskChecks(kinds.flatMap((k) => entries[k].checks), fields);
      put(llm.task, {
        title: llm.title, kinds: [name], ...(llm.partial ? { partial: true } : {}), consumer: clone(llm.consumer), next: llm.next, role: llm.role, fields,
        ...(checks.length ? { checks } : {}),
        rules: [...llm.rules, ...kinds.flatMap((k) => entries[k].rules.map((r) => `종류가 ${k}(${hintOf(k)})일 때: ${r}`))],
      }, `${name}/_domain.yaml llm`);
    } else if (llm.mode === 'per-kind') {
      for (const k of dom.kinds) {
        const entry = entries[k];
        if (entry.llm !== true) continue;
        const sub = (s) => String(s).replaceAll('{종류}', entry.title);
        const fields = {};
        const clear = {};
        for (const [key, f] of Object.entries(all[`${name}.${k}`])) {
          if (f.llm === false) continue;
          fields[key] = taskField(f, { partial: llm.partial, key });
          if (f.drop) clear[key] = f.drop;
        }
        const checks = taskChecks(entry.checks, fields);
        put(entry.task, {
          title: sub(llm.title), kinds: [name], ...(llm.partial ? { partial: true } : {}), consumer: clone(llm.consumer), next: llm.next,
          ...(Object.keys(clear).length ? { variants: { [name]: { clear } } } : {}),
          role: sub(llm.role), fields, ...(checks.length ? { checks } : {}), rules: [...llm.rules, ...entry.rules],
        }, `${name}/${k}.yaml`);
      }
    }
  }
  for (const bad of checkSpec({ tasks: spec.tasks })) errors.push(`생성한 작업: ${bad}`);
  return { spec, errors };
}

/** 명세 폴더를 읽고 검사해 생성물(ACTIONS)로. 틀린 명세는 무엇이 틀렸는지 적어 던진다. */
export function build(root = ROOT, opts = {}) {
  const raw = readActions(root);
  const errors = checkActions(raw, opts);
  if (errors.length) throw new Error(`행위 명세(actions/spec)가 틀렸습니다:\n- ${errors.join('\n- ')}`);
  const { spec, errors: buildErrors } = buildActions(raw, opts);
  if (buildErrors.length) throw new Error(`행위 명세(actions/spec)가 틀렸습니다:\n- ${buildErrors.join('\n- ')}`);
  return spec;
}

/** 생성물의 글 — 같은 명세면 바이트까지 같다. */
export const textOf = (spec) => '// 생성물 — 고치지 않는다. actions/spec 을 고치고 `node tools/gen-actions.mjs` 를 돌린다.\n'
  + `export const ACTIONS = ${JSON.stringify(spec, null, 2)};\n`;

/** 명세 폴더를 읽어 actions/spec.js 의 글을 만든다. */
export function render(root = ROOT, opts = {}) {
  return textOf(build(root, opts));
}

/* ------------------------------------------------------------ 보기 기록(--example) */

/** 행위 하나의 보기 기록 — 칸은 example(없으면 default, 그것도 없으면 null)로, 사전설정은 value 또는 <from> 표시로. */
export function exampleRecord(entry) {
  const valueOf = (f) => {
    if ('example' in f) return clone(f.example);
    if ('default' in f) return clone(f.default);
    if (f.type === 'object') return fromFields(f.fields);
    if (f.type === 'list') return [fromFields(f.item)];
    return null;
  };
  const fromFields = (fields) => Object.fromEntries(Object.entries(fields || {}).map(([k, f]) => [k, valueOf(f)]));
  return {
    v: 1, action: entry.id, by: 'ui', via: null,
    preset: Object.fromEntries(Object.entries(entry.preset).map(([k, p]) => [k, 'value' in p ? clone(p.value) : `<${p.from}>`])),
    input: fromFields(entry.fields),
  };
}

const RESERVED = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~', 'y', 'n']);
/** 따옴표 없이 둘 수 있는 글인가 — 영문·한글로 시작하고 YAML 이 다른 뜻으로 읽을 글자(: # [ ] { } , 따옴표 줄바꿈)가 없는 것. 수·날짜 모양의 글은 따옴표를 친다. */
const bare = (s) => /^[A-Za-z가-힣][A-Za-z0-9가-힣 _·().\/~\-]*$/.test(s) && !/\s$/.test(s) && !RESERVED.has(s.toLowerCase());
const scalar = (v) => (v === null || v === undefined ? 'null' : typeof v === 'string' ? (bare(v) ? v : JSON.stringify(v)) : String(v));
const isScalar = (v) => v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v);

/** 작은 YAML emitter — 사람이 보고 복사하는 용도(중첩은 2칸 들여쓰기, 문자열은 필요할 때만 따옴표). 런타임의 actions/record.js toYaml 과는 별개다. */
export function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (isScalar(value)) return `${pad}${scalar(value)}`;
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]`;
    return value.map((x) => (isScalar(x) ? `${pad}- ${scalar(x)}` : `${pad}-\n${toYaml(x, indent + 2)}`)).join('\n');
  }
  const keys = Object.keys(value);
  if (!keys.length) return `${pad}{}`;
  return keys.map((k) => {
    const x = value[k];
    if (isScalar(x)) return `${pad}${k}: ${scalar(x)}`;
    if ((Array.isArray(x) && !x.length) || (!Array.isArray(x) && !Object.keys(x).length)) return `${pad}${k}: ${Array.isArray(x) ? '[]' : '{}'}`;
    return `${pad}${k}:\n${toYaml(x, indent + 2)}`;
  }).join('\n');
}

/* ------------------------------------------------------------ CLI */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const after = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] ?? '' : null);
  let spec;
  // 틀린 명세는 무엇이 틀렸는지만 말하고 끝낸다 — 고치는 사람이 볼 것은 그 줄들이지 스택이 아니다.
  try { spec = build(); } catch (err) { console.error(err.message); process.exit(1); }
  const prompt = after('--prompt');
  const show = after('--show');
  const example = after('--example');
  if (prompt !== null) {
    const task = Object.hasOwn(spec.tasks, prompt) ? spec.tasks[prompt] : null;
    if (!task) { console.error(`작업을 적어 주세요 — ${Object.keys(spec.tasks).join(' · ')}`); process.exit(1); }
    // 지시문 전문 — 확장이 쓰는 함수(src/input.js 의 promptOf)로 만든다.
    const { promptOf } = await import('../src/input.js');
    console.log(promptOf(task));
  } else if (show !== null || example !== null) {
    const id = show ?? example;
    const entry = Object.hasOwn(spec.actions, id) ? spec.actions[id] : null;
    if (!entry) { console.error(`행위 ID 를 적어 주세요 — ${Object.keys(spec.actions).join(' · ')}`); process.exit(1); }
    console.log(show !== null ? JSON.stringify(entry, null, 2) : toYaml(exampleRecord(entry)));
  } else {
    const next = textOf(spec);
    const now = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
    if (argv.includes('--check')) {
      if (now !== next) {
        console.error('actions/spec.js 가 actions/spec 과 어긋났습니다. `node tools/gen-actions.mjs` 를 돌리세요.');
        process.exit(1);
      }
      console.log('actions/spec.js 는 actions/spec 과 같습니다.');
    } else if (now === next) {
      console.log('actions/spec.js — 바뀐 것 없음');
    } else {
      fs.writeFileSync(TARGET, next);
      console.log('actions/spec.js 를 다시 만들었습니다.');
    }
  }
}
