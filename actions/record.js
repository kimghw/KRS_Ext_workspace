// 기록(record) — 관문을 지난 한 건을 짓고, 지문을 세고, 활동 로그용으로 자르고, YAML 글로 보이고, 한 줄로 요약한다.
//
//   hashOf(value)                         FNV-1a 32비트(키를 정렬한 JSON 위) — 8자리 소문자 16진. Node 와 브라우저에서 같다(Buffer·crypto 없음)
//   makeRecord(id, { input, preset, by, via, at })   { v, action, at, by, via, preset, input, hash } — 관문은 지나지 않는다(디스패처 build 가 지난 뒤 부른다)
//   clipRecord(record, entry, { max })    활동 로그용 복사본 — log:false 사전설정은 빼고, 긴 글은 자르고, 파일은 이름·형식만, data: 글은 안 남긴다
//   clipResult(result, { max })           실행 결과의 스칼라만
//   describe(record, entry)               summary 틀을 채운 한 줄(틀이 없으면 title)
//   toYaml(value, { indent })             사람이 보고 복사하는 YAML 글(작은 emitter — 문자열은 필요할 때만 따옴표)
//   freezeDeep(value)                     실행기에 주는 기록을 깊게 얼린다
//
// 기록은 순수 데이터다 — 바이트·세션·ViewState·삭제 손잡이·DOM 을 넣지 않는다.
// 순수하다 — 시계·저장소·DOM 을 만지지 않고, 받은 객체를 고치지 않는다(복사본을 돌려준다).

/** 순수 데이터 객체인가(배열 아님). */
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** JSON 으로 깊게 복사한다 — 함수·undefined 는 빠지고 Date 는 글이 된다. */
function plain(v) {
  const s = JSON.stringify(v);
  return s === undefined ? undefined : JSON.parse(s);
}

/* ------------------------------------------------------------------ 지문 */

/**
 * 키를 정렬하고 undefined·null·함수를 뺀 꼴. 같은 값이면 키 차례와 무관하게 같고, "null 인 칸" 과 "없는 칸" 도 같다 —
 * 초안 모드(partial — 빈 칸을 뺀다)로 지은 기록과 실행 모드로 다시 정규화한 기록이 같은 지문이 되도록. 배열은 차례를 지킨다.
 */
function stable(v) {
  if (v === null || typeof v !== 'object') return v;
  if (typeof v.toJSON === 'function') return stable(v.toJSON());
  if (Array.isArray(v)) return v.map((x) => (x === undefined || typeof x === 'function' ? null : stable(x)));
  const out = {};
  for (const k of Object.keys(v).sort()) {
    const x = v[k];
    if (x == null || typeof x === 'function') continue;
    out[k] = stable(x);
  }
  return out;
}

/** 지문을 세는 글 — 키를 정렬한 JSON. */
export function stableJson(value) {
  return JSON.stringify(stable(value)) ?? 'null';
}

/** FNV-1a 32비트. 글을 UTF-8 바이트로 돌며 센다(TextEncoder 없이 — 어느 환경에서든 같다). 8자리 소문자 16진. */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    const bytes = cp < 0x80 ? [cp]
      : cp < 0x800 ? [0xc0 | (cp >> 6), 0x80 | (cp & 63)]
        : cp < 0x10000 ? [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)]
          : [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
    for (const b of bytes) {
      h ^= b;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

/** 값의 지문 — 확인 증거(ctx.confirmed)와 기록을 묶는다. */
export function hashOf(value) {
  return fnv1a(stableJson(value));
}

/* ------------------------------------------------------------------ 짓기 */

const BY = new Set(['ui', 'llm', 'auto']);
const VIA = new Set(['cli', 'api', 'local']);

/**
 * 기록을 짓는다. input·preset 은 관문을 지난 것이어야 한다(여기서는 복사만 한다).
 * @param {string} id 행위 ID
 * @param {{input?: object, preset?: object, by?: 'ui'|'llm'|'auto', via?: 'cli'|'api'|'local'|null, at?: number|null}} parts at 은 지은 때(ms) — 패널이 now 를 준다
 */
export function makeRecord(id, { input = {}, preset = {}, by = 'ui', via = null, at = null } = {}) {
  if (typeof id !== 'string' || !id) throw new Error('행위 ID 가 없습니다');
  if (!BY.has(by)) throw new Error(`모르는 by ${by}`);
  if (via !== null && !VIA.has(via)) throw new Error(`모르는 via ${via}`);
  const record = { v: 1, action: id, at: Number.isFinite(at) ? at : null, by, via, preset: plain(preset) ?? {}, input: plain(input) ?? {} };
  record.hash = hashOf({ action: id, preset: record.preset, input: record.input });
  return record;
}

/** 깊게 얼린다 — 실행기가 기록을 고치지 못하게. 순환은 한 번만 본다. */
export function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const x of Object.values(value)) freezeDeep(x, seen);
  return value;
}

/* ------------------------------------------------------------ 로그용 자르기 */

/** 긴 글은 max 에서 자르고 몇 자였는지 적는다. data: 로 시작하는 글(data URL)은 어디에 있든 바이트 수만 남긴다. */
export function clipString(s, max = 200) {
  if (s.startsWith('data:')) return `[data ${s.length}바이트]`;
  return s.length > max ? `${s.slice(0, max)}…(${s.length}자)` : s;
}

/** 값 하나를 칸 명세(f)대로 자른다 — 파일은 이름·형식만, 목록은 줄마다 item 명세로, 객체는 fields 명세로. */
function clipValue(v, f, max) {
  if (typeof v === 'string') return clipString(v, max);
  if (Array.isArray(v)) {
    const sub = f?.type === 'list' ? { type: 'object', fields: f.item } : null;
    return v.map((x) => clipValue(x, sub, max));
  }
  if (v && typeof v === 'object') {
    if (f?.type === 'file') return { name: clipString(String(v.name ?? ''), max), type: String(v.type ?? '') };
    const fields = f?.type === 'object' ? f.fields : null;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined || typeof x === 'function') continue;
      out[k] = clipValue(x, fields?.[k], max);
    }
    return out;
  }
  return typeof v === 'function' ? undefined : v;
}

/**
 * 활동 로그에 남길 복사본. 입력은 고치지 않는다.
 * - log: false 인 사전설정은 뺀다(과제 내용 3000자 같은 것)
 * - 글은 max 자에서 자른다 — `…(N자)`
 * - file 형 칸(안의 목록·객체 속도)은 { name, type } 만
 * - data: 로 시작하는 글은 어디에 있든 `[data N바이트]`
 */
export function clipRecord(record, entry, { max = 200 } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(record || {})) {
    if (k === 'preset' && isPlain(v)) {
      out.preset = {};
      for (const [pk, pv] of Object.entries(v)) {
        if (entry?.preset?.[pk]?.log === false) continue;
        out.preset[pk] = clipValue(pv, entry?.preset?.[pk], max);
      }
    } else if (k === 'input' && isPlain(v)) {
      out.input = {};
      for (const [ik, iv] of Object.entries(v)) out.input[ik] = clipValue(iv, entry?.fields?.[ik], max);
    } else {
      out[k] = clipValue(v, null, max);
    }
  }
  return out;
}

const RESULT_KEYS = ['ok', 'verified', 'submitted', 'uncertain', 'stage', 'docNo', 'seq', 'docId', 'message', 'error'];

/** 실행 결과에서 스칼라만 — 정해 둔 키를 앞에, 나머지 스칼라를 뒤에. 객체·배열·함수는 뺀다(error 가 Error 면 message 만). */
export function clipResult(result, { max = 300 } = {}) {
  if (!isPlain(result)) return {};
  const out = {};
  const take = (k, v) => {
    if (k === 'error' && v && typeof v === 'object' && typeof v.message === 'string') v = v.message;
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = clipString(v, max);
  };
  for (const k of RESULT_KEYS) if (Object.hasOwn(result, k)) take(k, result[k]);
  for (const [k, v] of Object.entries(result)) if (!RESULT_KEYS.includes(k)) take(k, v);
  return out;
}

/* ------------------------------------------------------------ 한 줄 요약 */

/** 점 경로로 안쪽을 집는다. */
function walk(obj, path) {
  let cur = obj;
  for (const p of path) {
    if (cur == null || typeof cur !== 'object' || !Object.hasOwn(cur, p)) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** 자리에 넣을 글 — 배열은 · 로 잇고, 객체는 이름(name·title·label)만, 빈 값은 빈 글. */
function textOf(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join('·');
  if (typeof v === 'object') return textOf(v.name ?? v.title ?? v.label ?? null);
  return String(v);
}

/**
 * summary 틀을 채운 한 줄. `{칸}` 은 input, `{preset.키}` 는 사전설정(점 경로도 된다). 빈 값은 빈 글이 되고
 * 겹친 공백과 끝에 남은 구분 기호(· ~)는 정리한다. 틀이 없거나 다 비면 행위의 title.
 */
export function describe(record, entry) {
  const tpl = typeof entry?.summary === 'string' ? entry.summary : '';
  const text = tpl
    .replace(/\{([^{}]+)\}/g, (_, ref) => {
      const parts = ref.trim().split('.');
      let root = record?.input;
      if (parts.length > 1 && (parts[0] === 'preset' || parts[0] === 'input')) root = record?.[parts.shift()];
      return textOf(walk(root, parts));
    })
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s·~]+|[\s·~]+$/g, '');
  return text || String(entry?.title || record?.action || '');
}

/* ------------------------------------------------------------------ YAML */

/* 따옴표가 필요한 글 — 비었거나, 앞뒤 공백, 특수 문자로 시작, ": " 나 " #" 를 품음, ":" 로 끝남, 수·참거짓·null·날짜·시각처럼 보임, 문서 표시(--- ...) */
const LEAD = /^[-?:,[\]{}#&*!|>'"%@`]/;
const SPECIAL = /^(?:true|false|yes|no|on|off|null|~|y|n|[-+]?\.(?:inf|nan)|[-+]?(?:0x[0-9a-f_]+|0o[0-7_]+|0b[01_]+|(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)|\d{4}-\d{1,2}-\d{1,2}(?:[ t].*)?|\d{1,2}:\d{2}(?::\d{2})?|---|\.\.\.)$/i;
/* 줄바꿈이 아닌 제어 문자 — 큰따옴표(JSON 이스케이프)로만 적을 수 있다 */
const CONTROL = /[\x00-\x09\x0b-\x1f\x7f]/;

const needsQuote = (s) => s === '' || LEAD.test(s) || /^\s|\s$/.test(s) || /: |\s#|:$/.test(s) || SPECIAL.test(s);
const single = (s) => `'${s.replace(/'/g, "''")}'`;
const keyOf = (k) => (CONTROL.test(k) || k.includes('\n') ? JSON.stringify(k) : needsQuote(k) ? single(k) : k);

/** 한 줄 스칼라. 여러 줄 글은 block 이 맡는다. */
function inline(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v !== 'string') return JSON.stringify(String(v));
  if (CONTROL.test(v)) return JSON.stringify(v);
  return needsQuote(v) ? single(v) : v;
}

/**
 * 여러 줄 글 — 블록 스칼라(|). 끝의 줄바꿈 수에 따라 |- · | · |+ 로 적어 그대로 돌아오게 한다.
 * 제어 문자가 섞였거나 어느 줄이 공백으로 시작하면 블록으로 못 적는다 — 큰따옴표 한 줄로.
 */
function block(s) {
  if (CONTROL.test(s) || /(^|\n)[ \t]/.test(s) || !s.replace(/\n/g, '')) return { inline: JSON.stringify(s) };
  const trailing = s.length - s.replace(/\n+$/, '').length;
  const chomp = trailing === 0 ? '-' : trailing === 1 ? '' : '+';
  return { head: `|${chomp}`, body: s.replace(/\n$/, '').split('\n') };
}

const indented = (lines) => lines.map((l) => (l ? `  ${l}` : ''));

/** 값 하나 — { inline } (한 줄) 또는 { head, body } (head 가 비면 안쪽 줄들이 곧 내용). */
function node(v) {
  if (Array.isArray(v)) return v.length ? { head: '', body: seq(v) } : { inline: '[]' };
  if (isPlain(v)) {
    const body = map(v);
    return body.length ? { head: '', body } : { inline: '{}' };
  }
  if (typeof v === 'string' && v.includes('\n')) return block(v);
  return { inline: inline(v) };
}

function seq(arr) {
  return arr.flatMap((x) => {
    const n = node(x);
    if (n.inline !== undefined) return [`- ${n.inline}`];
    if (n.head) return [`- ${n.head}`, ...indented(n.body)];
    return [`- ${n.body[0]}`, ...indented(n.body.slice(1))];
  });
}

function map(obj) {
  const out = [];
  for (const [k, x] of Object.entries(obj)) {
    const key = keyOf(k);
    const n = node(x);
    if (n.inline !== undefined) out.push(`${key}: ${n.inline}`);
    else if (n.head) out.push(`${key}: ${n.head}`, ...indented(n.body));
    else out.push(`${key}:`, ...indented(n.body));
  }
  return out;
}

/**
 * 사람이 보고 복사하는 YAML 글. 맵은 `키: 값`, 안쪽 맵·목록은 2칸 들여쓰기, 목록은 `- 줄`, null 은 null,
 * 글은 필요할 때만 작은따옴표(안의 ' 는 ''), 여러 줄 글은 블록(|). 값은 먼저 JSON 으로 복사한다(함수·undefined 는 빠진다).
 * @param {unknown} value
 * @param {{indent?: number}} [opts] 모든 줄 앞에 둘 칸 수
 */
export function toYaml(value, { indent = 0 } = {}) {
  const n = node(plain(value));
  const lines = n.inline !== undefined ? [n.inline] : n.head ? [n.head, ...indented(n.body)] : n.body;
  const pad = ' '.repeat(indent);
  return `${lines.map((l) => (l ? pad + l : l)).join('\n')}\n`;
}
