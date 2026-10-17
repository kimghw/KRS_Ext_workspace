// R&D 탭의 YAML 손질 — 사업계획서에서 뽑은 스냅샷(rnd.extract)과 변경사항으로 고친 스냅샷(rnd.revise)의 답을 검사하고, 판(rev)·머리 주석을
// 코드가 적어 마무리하고(LLM 이 아니라 — 계약 §1-11), 기준과 고친 것의 구조 차이와 장부에 넣으면 생길 변경이력을 미리 보이고,
// 저장된 원문이 없을 때 장부로 기준 YAML 을 짓는다. 파일 이름(KR_<과제>.yaml · KR_<과제>_rN.yaml)도 여기서 정한다.
//
// 순수 모듈이다(DOM·chrome 없음). YAML 풀이·쓰기는 vendor/yaml(npm yaml 2.9.1 브라우저 빌드)을 **쓸 때** import() 한다 — 그래서 그것을 쓰는 함수는 async 다.
// 본문 주석은 Document API(parseDocument → setIn/set → commentBefore → toString)로 살린다. 장부에 넣는 규칙은 src/rndyaml.js 가 정본이고 여기서는 부르기만 한다.
//
// 머리 주석(첫 키 앞의 `# …` 줄들)은 src/rndyaml.js headerOf 가 되읽는다 — 첫 줄의 `[태그]` 와 `변경분: …` 줄. 고친 판의 변경분은 장부의 변경이력 사유가 된다.

import { kindOf, readSnapshot, revNo, applyYaml, sameItem, UNIT } from '../src/rndyaml.js';
import { yearNo, yearLabel, thousand, comma, amountOf, yearsOf, projectOf, fileLog, parseSections, parseRoster } from '../src/rnd.js';

let lib = null;
/** vendor/yaml — 처음 쓸 때 한 번 가져온다(이 모듈을 import 하는 것만으로는 가져오지 않는다). 실패하면 다음에 다시 해 본다. */
const yamlLib = () => (lib ||= import('../vendor/yaml/index.js').catch((e) => { lib = null; throw e; }));
/** 쓰기 꼴 — 긴 글을 접지 않고(lineWidth 0), 한 줄 묶음은 원래 파일처럼 `{a: 1}`. */
const OUT = Object.freeze({ lineWidth: 0, flowCollectionPadding: false });

const str = (v) => (v == null ? '' : String(v)).trim();
const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const firstLine = (e) => String(e?.message ?? e).split('\n')[0].trim();
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** LLM 답이 글 전체를 코드 펜스(```yaml … ```)로 감쌌으면 벗긴다. BOM 도 뗀다. 펜스가 글의 일부면 그대로(풀다가 오류가 난다). */
function clean(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const fence = s.match(/^\s*```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```\s*$/);
  return fence ? fence[1] : s;
}

/* ------------------------------------------------------------ 풀기·검사 */

/** YAML 글 → 객체. 못 풀면 ok:false 와 첫 줄 까닭. 주석뿐인 글도 못 푼 것으로 본다. */
export async function parseYaml(text) {
  const src = clean(text);
  if (!src.trim()) return { ok: false, obj: null, error: 'YAML 글이 비어 있습니다' };
  const { parseDocument } = await yamlLib();
  try {
    const doc = parseDocument(src);
    if (doc.errors.length) return { ok: false, obj: null, error: firstLine(doc.errors[0]) };
    const obj = doc.toJS();
    if (obj == null) return { ok: false, obj: null, error: 'YAML 에 내용이 없습니다(주석뿐)' };
    return { ok: true, obj, error: '' };
  } catch (e) {
    return { ok: false, obj: null, error: firstLine(e) };
  }
}

/**
 * LLM 이 돌려준 뽑기 답(yaml 글)을 검사한다 — 풀리는가, kindOf === 'snapshot'(meta.과제명)인가, 차년도를 아는가(meta.차년도 또는 stage),
 * stage 를 줬으면 meta.차년도 가 그것인가(다르면 problem 이 아니라 warnings — 차년도는 finalizeExtracted 가 고쳐 쓴다), 예산.비목별 에 그 차년도 행이 있는가,
 * 그 행의 비목 합이 총액과 맞는가, 다른 차년도 행이 섞였는가(모두 warnings).
 * meta.차년도 도 stage 도 없으면 problem — 몇 차년도에 넣을지 모른다(readSnapshot 은 1차년도로 떨어뜨린다). 패널은 stage 에 `고른 n || data.stage` 를 준다.
 * snap 은 stage 를 meta.차년도 로 친 readSnapshot(finalizeExtracted 뒤에 넣힐 모습). 스냅샷이 아니면 null.
 * @returns {Promise<{ ok: boolean, obj: any, snap: ReturnType<readSnapshot>|null, problems: string[], warnings: string[] }>}  problems 가 있으면 ok:false
 */
export async function checkExtracted(text, { stage = null } = {}) {
  const problems = [];
  const warnings = [];
  const parsed = await parseYaml(text);
  if (!parsed.ok) return { ok: false, obj: null, snap: null, problems: [`YAML 로 풀리지 않습니다 — ${parsed.error}`], warnings };
  const obj = parsed.obj;
  if (kindOf(obj) !== 'snapshot') {
    problems.push(isObj(obj) ? 'meta.과제명 이 없습니다 — 스냅샷(meta · 연구개발내용 · 예산) 꼴이 아닙니다' : '맨 위가 「키: 값」 꼴이 아닙니다');
    return { ok: false, obj, snap: null, problems, warnings };
  }
  const want = yearNo(stage);
  const written = yearNo(obj.meta.차년도);
  if (!want && !written) problems.push('meta.차년도 가 없습니다 — 몇 차년도 스냅샷인지 모릅니다(차년도를 골라 다시 뽑거나 meta.차년도 를 적으세요)');
  else if (want && !written) warnings.push(`meta.차년도 가 없어 ${yearLabel(want)}로 적습니다`);
  else if (want && written !== want) warnings.push(`meta.차년도(${yearLabel(written)})가 고른 ${yearLabel(want)}와 다릅니다 — ${yearLabel(want)}로 고쳐 적습니다`);
  const n = want || written || 1;
  const snap = readSnapshot(want ? { ...obj, meta: { ...obj.meta, 차년도: yearLabel(n) } } : obj);

  const budget = obj.예산;
  if (!isObj(budget)) {
    warnings.push(`예산 블록이 없습니다 — ${yearLabel(n)} 예산이 들어가지 않습니다`);
  } else {
    const unit = str(budget.단위);
    if (!unit) warnings.push('예산.단위 가 없어 천원으로 봅니다');
    else if (!Object.hasOwn(UNIT, unit)) warnings.push(`예산.단위(${unit})를 모릅니다 — 천원으로 봅니다`);
    const mul = UNIT[unit] ?? 1000;
    const rows = Array.isArray(budget.비목별) ? budget.비목별 : [];
    const row = rows.find((r) => yearNo(r?.연차) === n);
    if (!row) warnings.push(`예산.비목별 에 ${yearLabel(n)} 행이 없습니다 — 이 차년도 예산이 들어가지 않습니다`);
    else if (!snap.budget.length) warnings.push(`예산.비목별[${yearLabel(n)}] 에 금액이 없습니다`);
    else {
      const total = amountOf(row.총액);
      const sum = snap.budget.reduce((s, b) => s + b.plan, 0);
      if (total != null && Math.round(total * mul) !== sum) warnings.push(`예산.비목별[${yearLabel(n)}] 비목 합 ${comma(sum / mul)} ≠ 총액 ${comma(total)} (${unit || '천원'})`);
    }
    const others = [...new Set(rows.map((r) => yearNo(r?.연차)).filter((k) => k && k !== n))].sort((a, b) => a - b);
    if (others.length) warnings.push(`예산.비목별 에 다른 차년도 행(${others.map(yearLabel).join('·')})도 있습니다 — 그 행은 넣지 않습니다`);
  }
  return { ok: !problems.length, obj, snap, problems, warnings };
}

/**
 * 스냅샷이 말하는 과제의 차년도 수 — "모든 차년도" 뽑기가 몇 번 물을지(rndgen/panel.js). 이 차례로 처음 읽히는 것:
 * meta.연차범위(목록 [1차년도, …] 또는 "1~4차년도" 꼴 글 — 가장 큰 차년도) → meta.연차별기간 의 키 → readSnapshot 의 연구기간(시작·종료가 다 있을 때 yearsOf).
 * 못 읽으면 0. 스냅샷이 아니어도(meta 만 있어도) 읽는다.
 * @returns {number}  0 또는 1~20
 */
export function stageCount(obj) {
  const m = isObj(obj?.meta) ? obj.meta : null;
  if (!m) return 0;
  const top = (ns) => Math.max(0, ...ns.filter((n) => n >= 1 && n <= 20));
  const range = m.연차범위;
  const fromRange = Array.isArray(range) ? top(range.map(yearNo))
    : range != null ? top((String(range).match(/(?<!\d)\d{1,2}(?!\d)/g) || []).map(Number)) : 0;
  if (fromRange) return fromRange;
  const fromRanges = isObj(m.연차별기간) ? top(Object.keys(m.연차별기간).map(yearNo)) : 0;
  if (fromRanges) return fromRanges;
  const p = readSnapshot(obj).project;
  return p.start && p.end ? yearsOf(p).length : 0;
}

/* ------------------------------------------------------------ 마무리(판·머리 주석) */

/** 머리 주석 줄 가리기 — `[태그]` 줄 · `변경분:` 줄 · 뽑기가 적은 줄. */
const TAG_LINE = /^\[[^\]]+\]/;
const CHANGED_LINE = /^변경분\s*[:：]/;
const EXTRACTED_LINE = /^KRS WORKSPACE 가 사업계획서에서 뽑음/;
/** meta 의 키 차례(structured_output.md) — 없는 키를 넣을 때 이 차례에서 뒤에 오는 키 앞에 넣는다. */
const META_ORDER = ['과제명', '과제명_영문', '수행기관', '기관유형', '단계', '차년도', '협약일', '연차범위', '기간', '연차별기간', '연구개발과제번호', 'source', 'rev', '표지'];
const nodeKey = (k) => (k !== null && typeof k === 'object' ? k.value : k);

/** 스냅샷 YAML 글 → Document. 풀리지 않거나 스냅샷(meta.과제명)이 아니면 던진다. */
async function openSnapshot(text) {
  const { parseDocument, isMap } = await yamlLib();
  const doc = parseDocument(clean(text));
  if (doc.errors.length) throw new Error(`YAML 로 풀리지 않습니다 — ${firstLine(doc.errors[0])}`);
  if (!isMap(doc.contents)) throw new Error('맨 위가 「키: 값」 꼴이 아닙니다');
  if (kindOf(doc.toJS()) !== 'snapshot' || !isMap(doc.get('meta', true))) throw new Error('meta.과제명 이 없습니다 — 스냅샷 꼴이 아닙니다');
  return doc;
}

/** meta 에 값을 둔다 — 있으면 값만 바꾸고(그 줄의 주석은 산다), 없으면 META_ORDER 차례 자리에 넣는다. */
function putMeta(doc, key, value) {
  const meta = doc.get('meta', true);
  if (meta.has(key)) {
    meta.set(key, value);
    return;
  }
  const later = META_ORDER.slice(META_ORDER.indexOf(key) + 1);
  const at = meta.items.findIndex((p) => later.includes(nodeKey(p.key)));
  const pair = doc.createPair(key, value);
  if (at < 0) meta.items.push(pair);
  else meta.items.splice(at, 0, pair);
}

/**
 * 지금 머리 주석 줄들을 걷어 낸다('#' 뗀 글, 빈 줄 없음). 머리는 빈 줄이 뒤따르면 doc.commentBefore, `---` 뒤면 contents.commentBefore,
 * 첫 키에 붙어 있으면 그 키의 commentBefore 에 든다 — headerOf 에게는 모두 첫 키 앞의 주석이므로 셋 다 머리로 본다.
 */
function takeHeader(doc) {
  const parts = [doc.commentBefore];
  doc.commentBefore = null;
  const c = doc.contents;
  parts.push(c.commentBefore);
  c.commentBefore = null;
  const k = c.items[0]?.key;
  if (k !== null && typeof k === 'object') {
    parts.push(k.commentBefore);
    k.commentBefore = null;
  }
  return parts.filter(Boolean).join('\n').split('\n').map((l) => l.trim()).filter(Boolean);
}
/** 머리 주석을 줄들로 — 줄마다 "# " 로 시작하게(라이브러리가 '#' 을 붙인다). */
const setHeader = (doc, lines) => { doc.commentBefore = lines.map((l) => ` ${l}`).join('\n'); };
const finish = (doc) => ({ text: doc.toString(OUT), obj: doc.toJS() });

/**
 * 뽑은 YAML 마무리(§1-11) — meta.차년도 = `${stage}차년도`, meta.rev 없으면 rev(기본 r0), meta.source 없으면 source,
 * 머리 주석 첫 줄 `# [N차년도 최초]`, 둘째 줄 `# KRS WORKSPACE 가 사업계획서에서 뽑음 YYYY-MM-DD · 원본: <파일>`, 그 뒤에 원래 머리 주석 가운데
 * `[…]` 태그 줄·`변경분:` 줄·예전 뽑음 줄을 뺀 나머지. 본문 주석은 Document API 로 살린다. 스냅샷이 아니면 던진다.
 * @param {string} text
 * @param {{ stage: number, today: string, source: string, rev?: string }} opts
 * @returns {Promise<{ text: string, obj: any }>}
 */
export async function finalizeExtracted(text, { stage, today = '', source = '', rev = 'r0' } = {}) {
  const doc = await openSnapshot(text);
  const n = yearNo(stage) || yearNo(doc.getIn(['meta', '차년도'])) || 1;
  const file = oneLine(source);
  putMeta(doc, '차년도', yearLabel(n));
  if (!str(doc.getIn(['meta', 'rev']))) putMeta(doc, 'rev', str(rev) || 'r0');
  if (file && !str(doc.getIn(['meta', 'source']))) putMeta(doc, 'source', file);
  const rest = takeHeader(doc).filter((l) => !TAG_LINE.test(l) && !CHANGED_LINE.test(l) && !EXTRACTED_LINE.test(l));
  setHeader(doc, [`[${yearLabel(n)} 최초]`, `KRS WORKSPACE 가 사업계획서에서 뽑음 ${oneLine(today)}${file ? ` · 원본: ${file}` : ''}`, ...rest]);
  return finish(doc);
}

/**
 * 고친 YAML 마무리(§1-11) — meta.rev = rev, 첫 줄 `# [재생성 rN] KRS WORKSPACE 변경사항 반영 YYYY-MM-DD`, 둘째 줄 `# 변경분: <summary>`(한 줄로 펴서),
 * 그 뒤에 이전 머리의 `[…]` 태그 줄·`변경분:` 줄을 뺀 나머지. headerOf(결과).tag === `재생성 ${rev}`, .changed === summary — src/rndyaml.js 가
 * 그 변경분을 변경이력의 사유로 쓴다. summary 가 비면 변경분 줄을 두지 않는다(사유는 "rN 스냅샷 반영"이 된다). 스냅샷이 아니면 던진다.
 * @param {string} text
 * @param {{ rev: string, today: string, summary: string }} opts
 * @returns {Promise<{ text: string, obj: any }>}
 */
export async function finalizeRevised(text, { rev, today = '', summary = '' } = {}) {
  const k = revNo(rev);
  if (k < 0) throw new Error(`판 번호가 아닙니다 — ${str(rev) || '(비어 있음)'}`);
  const r = `r${k}`;
  const doc = await openSnapshot(text);
  putMeta(doc, 'rev', r);
  const line = oneLine(summary);
  const rest = takeHeader(doc).filter((l) => !TAG_LINE.test(l) && !CHANGED_LINE.test(l));
  setHeader(doc, [`[재생성 ${r}] KRS WORKSPACE 변경사항 반영 ${oneLine(today)}`, ...(line ? [`변경분: ${line}`] : []), ...rest]);
  return finish(doc);
}

/** 다음 판 — 받은 것들(글 'r2'·수 2·''·null) 가운데 가장 큰 판 + 1, 최소 'r1'. */
export function nextRev(...revs) {
  let top = -1;
  for (const r of revs) {
    const k = typeof r === 'number' ? (Number.isInteger(r) && r >= 0 ? r : -1) : /^\s*\d+\s*$/.test(String(r ?? '')) ? Number(r) : revNo(r);
    if (k > top) top = k;
  }
  return `r${Math.max(top + 1, 1)}`;
}

/* ------------------------------------------------------------ 미리보기 */

/**
 * 미리보기 요약 — readSnapshot 위에 화면용 값. budget 의 thousand 는 천원 글("12,000"), totalThousand 는 비목 합의 천원 글(비목이 없으면 ''),
 * people 은 참여연구자 줄 수, goals 는 그 차년도의 개발목표.
 * @returns {{ name, code, lead, start, end, n, rev, budget: Array<{item: string, thousand: string}>, totalThousand: string, people: number, goals: string[] }}
 */
export function summarizeSnapshot(obj) {
  const s = readSnapshot(obj);
  const sum = s.budget.reduce((a, b) => a + b.plan, 0);
  return {
    name: s.project.name, code: s.project.code, lead: s.project.lead, start: s.project.start, end: s.project.end, n: s.n, rev: s.rev,
    budget: s.budget.map((b) => ({ item: b.item, thousand: thousand(b.plan) })),
    totalThousand: s.budget.length ? thousand(sum) : '',
    people: s.roster ? s.roster.text.split('\n').filter((l) => l.trim()).length : 0,
    goals: s.plan?.goals || [],
  };
}

/** 목록 줄의 짝짓기 열쇠 — 이 차례로, 모든 줄에 글·수로 있고 목록 안에서 겹치지 않는 첫 키. 없으면 ''(자리로 짝짓는다). */
const LIST_KEYS = Object.freeze(['연차', '성명', '평가항목', '지표', '명칭', '용역명', '세부항목']);
const keyText = (v) => String(v).trim();
const isLeaf = (v) => v === null || typeof v !== 'object' || (Array.isArray(v) ? !v.length : !Object.keys(v).length);
const join = (path, k) => (path ? `${path}.${k}` : String(k));

function listKey(...lists) {
  const all = lists.flat();
  if (!all.length || !all.every(isObj)) return '';
  return LIST_KEYS.find((k) => lists.every((list) => {
    const vals = list.map((x) => x[k]);
    if (vals.some((v) => v == null || typeof v === 'object' || !keyText(v))) return false;
    return new Set(vals.map(keyText)).size === vals.length;
  })) || '';
}
const seg = (x, key, i) => `[${key ? keyText(x[key]) : i + 1}]`;

/** 같은 값인가 — 글·수는 글로 견준다(12000 과 "12000" 은 같다), null 은 null 끼리만, 빈 목록·빈 묶음은 같은 꼴끼리. */
function same(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a === 'object' || typeof b === 'object') return Array.isArray(a) === Array.isArray(b) && isLeaf(a) && isLeaf(b) && typeof a === typeof b;
  return String(a) === String(b);
}

/** 들어오거나 빠진 덩어리를 끝값(scalar·빈 목록/묶음)마다 한 줄로. */
function leaves(v, path, op, out) {
  if (isLeaf(v)) {
    out.push({ path, before: op === 'removed' ? v : null, after: op === 'added' ? v : null, op });
    return;
  }
  if (Array.isArray(v)) {
    const k = listKey(v);
    v.forEach((x, i) => leaves(x, path + seg(x, k, i), op, out));
    return;
  }
  for (const [k, x] of Object.entries(v)) leaves(x, join(path, k), op, out);
}

function walkList(a, b, path, out) {
  const k = listKey(a, b);
  if (!k) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const p = `${path}[${i + 1}]`;
      if (i >= b.length) leaves(a[i], p, 'removed', out);
      else if (i >= a.length) leaves(b[i], p, 'added', out);
      else walk(a[i], b[i], p, out);
    }
    return;
  }
  const am = new Map(a.map((x) => [keyText(x[k]), x]));
  const bm = new Map(b.map((x) => [keyText(x[k]), x]));
  for (const [key, x] of am) {
    const p = `${path}[${key}]`;
    if (bm.has(key)) walk(x, bm.get(key), p, out);
    else leaves(x, p, 'removed', out);
  }
  for (const [key, y] of bm) if (!am.has(key)) leaves(y, `${path}[${key}]`, 'added', out);
}

function walk(a, b, path, out) {
  if (isLeaf(a) && isLeaf(b)) {
    if (!same(a, b)) out.push({ path, before: a, after: b, op: 'changed' });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    walkList(a, b, path, out);
    return;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) {
      if (Object.hasOwn(b, k)) walk(a[k], b[k], join(path, k), out);
      else leaves(a[k], join(path, k), 'removed', out);
    }
    for (const k of Object.keys(b)) if (!Object.hasOwn(a, k)) leaves(b[k], join(path, k), 'added', out);
    return;
  }
  // 꼴이 바뀌었다(글 → 목록 따위) — 앞의 것을 빼고 뒤의 것을 넣은 것으로 본다. 빈 값(null)은 줄로 남기지 않는다.
  if (a !== null) leaves(a, path, 'removed', out);
  if (b !== null) leaves(b, path, 'added', out);
}

async function asObj(v, label) {
  if (typeof v !== 'string') return v ?? null;
  const r = await parseYaml(v);
  if (!r.ok) throw new Error(`${label} YAML 을 풀지 못했습니다 — ${r.error}`);
  return r.obj;
}

/**
 * 풀어서 견준 구조 차이. 객체는 키마다, 목록은 줄의 열쇠(연차 → 성명 → 평가항목 → 지표 → 명칭 → 용역명 → 세부항목 차례로, 모든 줄에 있고 겹치지 않는 첫 키)로
 * 짝짓고 없으면 자리(1부터 센 "[2]")로. path 는 "예산.비목별[2차년도].직접비.연구재료비" · "예산.참여연구자인건비[2차년도].참여자[홍길동].계상률" 꼴.
 * 값은 scalar 만 견준다(목록/객체는 안으로 들어간다) — 들어오거나 빠진 덩어리도 끝값마다 한 줄(op 'added'·'removed', 없는 쪽은 null).
 * @param {any} before  객체(또는 글 — 글이면 풀고, 못 풀면 던진다)
 * @param {any} after
 * @returns {Promise<Array<{ path: string, before: any, after: any, op: 'changed'|'added'|'removed' }>>}
 */
export async function diffYaml(before, after) {
  const a = await asObj(before, '기준');
  const b = await asObj(after, '고친');
  const out = [];
  walk(a, b, '', out);
  return out;
}

/** 값 한 개를 사람이 읽을 글로 — 수는 ko-KR 쉼표(연도 칸은 그대로), null 은 "(비어 있음)", 여러 줄 글은 " / " 로 잇는다. */
function shown(v, key) {
  if (v == null) return '(비어 있음)';
  if (typeof v === 'number') return /연도$/.test(key) ? String(v) : v.toLocaleString('ko-KR', { maximumFractionDigits: 20 });
  if (Array.isArray(v)) return v.length ? v.map((x) => shown(x, key)).join(', ') : '[]';
  if (typeof v === 'object') return '{}';
  const s = String(v);
  return s === '' ? '""' : s.replace(/\s*\r?\n\s*/g, ' / ');
}
const lastKey = (path) => String(path).replace(/\[[^\]]*\]$/, '').split('.').pop();

/** 차이 한 줄씩 — "예산.비목별[2차년도].직접비.연구재료비: 12,000 → 15,000" · "… : (없음) → 홍길동" · "… : 15,000 → (뺌)". 수는 ko-KR 쉼표. */
export function diffLines(diff) {
  return (diff || []).map((d) => {
    const key = lastKey(d.path);
    const before = d.op === 'added' ? '(없음)' : shown(d.before, key);
    const after = d.op === 'removed' ? '(뺌)' : shown(d.after, key);
    return `${d.path || '(전체)'}: ${before} → ${after}`;
  });
}

/**
 * 장부 사본에 미리 넣어 본다 — structuredClone(book) 에 applyYaml 을 돌려 그 결과와 **그 차년도에 새로 생길 변경이력 줄**을 돌려준다(장부 원본은 손대지 않는다).
 * opts.current(보고 있는 과제 — 장부 원본의 객체일 수 있다)는 사본에서 같은 id 의 과제로 바꿔 넘긴다. 새로 생길 줄은 넣기 전 사본에 없던 id 의 줄.
 * created 면 projectId 는 사본에서 지은 id 다(진짜로 넣으면 다른 id 가 된다).
 * @param {object} book  rndBook
 * @param {any} obj      풀어 둔 YAML 객체
 * @param {{ text: string, file?: string, today: string, current?: object|null, n?: number }} opts  applyYaml 의 것
 * @returns {{ ok: boolean, error: string, result: {kind,label,summary,project}|null, projectId: string, n: number, changes: Array<{date,kind,item,before,after,reason}>, older: string, created: boolean }}
 *   older 는 "더 오래된 판이라 넣지 않음" 일 때 이미 든 판(summary 에서 /이미 (r\d+) 가 들어 있어/ 로 읽는다), 아니면 ''
 */
export function previewApply(book, obj, { text = '', file = '', today, current = null, n = 0 } = {}) {
  const fail = (error) => ({ ok: false, error, result: null, projectId: '', n: 0, changes: [], older: '', created: false });
  let copy;
  try {
    copy = structuredClone(book);
  } catch (e) {
    return fail(`장부를 베끼지 못했습니다 — ${firstLine(e)}`);
  }
  const projects = Array.isArray(copy?.projects) ? copy.projects : [];
  const seen = new Set();
  for (const p of projects) for (const y of Object.values(p.years || {})) for (const c of y?.changes || []) seen.add(c.id);
  const cur = current?.id ? projects.find((p) => p.id === current.id) || null : null;
  let result;
  try {
    result = applyYaml(copy, obj, { text, file, today, current: cur, n });
  } catch (e) {
    return fail(e?.message || String(e));
  }
  const p = result.project;
  const yearN = p ? copy.current?.year?.[p.id] || 0 : 0;
  const changes = (p?.years?.[yearN]?.changes || []).filter((c) => !seen.has(c.id))
    .map(({ date, kind, item, before, after, reason }) => ({ date, kind, item, before, after, reason }));
  const older = String(result.summary ?? '').match(/이미 (r\d+) 가 들어 있어/)?.[1] || '';
  const created = !!p && !(Array.isArray(book?.projects) ? book.projects : []).some((q) => q.id === p.id);
  return { ok: true, error: '', result, projectId: p?.id || '', n: yearN, changes, older, created };
}

/* ------------------------------------------------------------ 장부 → 기준 YAML */

/** 장부의 비목 이름 → 파일의 비목 이름(src/rndyaml.js ITEM_ALIAS 의 거꾸로). */
const FILE_ITEM = { '연구시설·장비비': '연구시설장비비' };
const TOTAL_ITEMS = new Set(['직접비', '소계', '총액', '합계', '연구개발비총액']);

/** 성능목표 줄("- 평가항목: 값 단위 (평가방법)" — src/rndyaml.js readPlan 의 꼴)을 되읽는다. */
function perfOf(text, label) {
  const m = text.match(/^(.*):(?: (.*?))?(?: \(([^()]*)\))?$/);
  if (!m) return { 평가항목: text, 목표치: { [label]: null } };
  const vm = (m[2] || '').match(/^(\S*)(?: (.+))?$/) || [];
  const raw = vm[1] || '';
  const num = Number(raw);
  const value = !raw ? null : String(num) === raw ? num : raw;
  return { 평가항목: m[1], ...(vm[2] ? { 단위: vm[2] } : {}), 목표치: { [label]: value }, ...(m[3] ? { 평가방법: m[3] } : {}) };
}
/** 수행일정 줄("- 개발내용 32주")을 되읽는다. */
const schedOf = (text) => { const m = text.match(/^(.*) (\d+)주$/); return m ? { 개발내용: m[1], 기간주: Number(m[2]) } : { 개발내용: text }; };

/** 연구내역 key 'plan' 글(■ 절 — readPlan 의 꼴)을 연구개발내용 블록으로 되읽는다. 그 꼴이 아니면 빈 목표. */
function planBlocks(log, label) {
  const secs = log?.text ? parseSections(log.text) : null;
  const goal = { 연차: label };
  const out = {};
  for (const s of secs || []) {
    if (s.title === '개발목표') goal.개발목표 = s.items.map((i) => i.text);
    else if (s.title === '개발내용') goal.개발내용 = s.items.map((i) => ({ 항목: i.text, ...(i.subs.length ? { 세부: i.subs } : {}) }));
    else if (s.title === '성능목표') out.성능목표 = s.items.map((i) => perfOf(i.text, label));
    else if (s.title === '수행일정') {
      const months = parseInt(s.note, 10);
      out.수행일정 = [{ 연차: label, ...(months ? { 기간개월: months } : {}), 항목: s.items.map((i) => schedOf(i.text)) }];
    } else if (s.title === '주요결과물') out.주요결과물 = [{ 연차: label, 결과물: s.items.map((i) => i.text) }];
  }
  // structured_output.md 의 차례 — 목표 · 성능목표 · 수행일정 · 주요결과물
  const blocks = { 목표: goal.개발목표 || goal.개발내용 ? [goal] : [] };
  for (const k of ['성능목표', '수행일정', '주요결과물']) if (out[k]) blocks[k] = out[k];
  return blocks;
}

/** 연구내역 key 'roster' 글("이름 — 직위 · 15% · 9개월 · 인건비 11,250,000원" 줄들)을 참여자로 되읽는다. pay 는 원. 그 꼴이 아니면 이름만. */
function rosterOf(log) {
  if (!log?.text) return [];
  const people = parseRoster(log.text);
  if (!people) return log.text.split('\n').map((l) => l.trim().match(/^(\S+)/)?.[1]).filter(Boolean).map((성명) => ({ 성명, pay: null }));
  return people.map((x) => {
    const months = parseInt(x.months, 10);
    const rate = parseFloat(x.rate);
    return { 성명: x.name, ...(x.role ? { 직위: x.role } : {}), ...(months ? { 참여기간_개월: months } : {}), ...(Number.isFinite(rate) ? { 계상률: rate } : {}), pay: amountOf(x.pay) };
  });
}

/**
 * 장부 → 스냅샷 꼴 YAML(저장된 원문이 없을 때의 기준 — 손실 있음). meta(과제명·수행기관·차년도·연차범위·연차별기간·기간·연구개발과제번호·rev = y.snapshot.rev||'r0'·
 * 표지.KR.책임자), 예산.단위 천원, 예산.비목별[{연차, 직접비:{인건비·연구시설장비비·연구재료비·연구활동비·연구수당·소계}, 간접비, 총액}](plan 원 → 천원, 0·빈 것은 뺌),
 * 연구개발내용(y.logs 의 key 'plan' 글을 ■ 절로 되읽어 목표·성능목표·수행일정·주요결과물), 예산.참여연구자인건비(key 'roster' 글을 되읽음 — 없으면 명시적 빈 블록),
 * 과제에 공문 참조자가 있으면 공문.참조자. 이것을 다시 넣으면(readSnapshot) 장부의 비목·계획·참여연구자 글이 그대로 나오게 짓는다 — 변경이력이 헛돌지 않게.
 * 원 단위 끝자리가 있는 금액(천원으로 나눠지지 않음)이 하나라도 있으면 예산.단위 를 원으로 둔다(천원으로 반올림하면 금액이 바뀐다).
 * 첫 줄 주석 `# [장부에서 지음] KRS WORKSPACE — 저장된 YAML 원문이 없어 장부로 지은 기준(손실 있음) YYYY-MM-DD`.
 * @param {object} book
 * @param {object|string} project  과제(또는 그 id)
 * @param {number} n
 * @param {{ today: string }} opts
 * @returns {Promise<{ text: string, obj: any, lossy: true }>}
 */
export async function bookToSnapshot(book, project, n, { today = '' } = {}) {
  const p = typeof project === 'string' ? projectOf(book, project) : project;
  if (!p?.name) throw new Error('장부에 그 과제가 없습니다');
  const yn = yearNo(n) || 1;
  const label = yearLabel(yn);
  // 차년도 장부가 없어도 만들지 않는다(yearBook 은 과제에 빈 차년도를 단다 — 장부를 바꾸지 않는다).
  const y = p.years?.[yn] || { budget: [], logs: [] };
  const rows = (y.budget || []).filter((r) => str(r.item) && r.plan > 0 && !TOTAL_ITEMS.has(str(r.item)));
  const people = rosterOf(fileLog(y, 'roster'));
  const exact = [...rows.map((r) => r.plan), ...people.map((x) => x.pay ?? 0)].every((w) => w % 1000 === 0);
  const mul = exact ? 1000 : 1;

  const meta = { 과제명: p.name, 수행기관: '한국선급(KR)', 차년도: label };
  if (p.start) {
    const years = yearsOf(p);
    meta.연차범위 = years.map((x) => yearLabel(x.n));
    meta.기간 = p.end ? `${p.start} ~ ${p.end}` : p.start;
    if (p.end) meta.연차별기간 = Object.fromEntries(years.map((x) => [yearLabel(x.n), `${x.start} ~ ${x.end}`]));
  }
  if (p.code) meta.연구개발과제번호 = p.code;
  meta.rev = y.snapshot?.rev || 'r0';
  if (p.lead) meta.표지 = { KR: { 책임자: p.lead } };

  const direct = {};
  let indirect = null;
  for (const r of rows) {
    const v = r.plan / mul;
    if (sameItem(r.item, '간접비')) indirect = (indirect || 0) + v;
    else {
      const k = FILE_ITEM[str(r.item)] || str(r.item);
      direct[k] = (direct[k] || 0) + v;
    }
  }
  const sub = Object.values(direct).reduce((s, v) => s + v, 0);
  const row = { 연차: label, 직접비: Object.keys(direct).length ? { ...direct, 소계: sub } : {} };
  if (indirect != null) row.간접비 = indirect;
  row.총액 = rows.length ? sub + (indirect || 0) : null;

  const pays = people.filter((x) => x.pay != null);
  const roster = {
    연차: label,
    참여자: people.map(({ pay, ...x }) => ({ ...x, ...(pay != null ? { 계상인건비: pay / mul } : {}) })),
    소계: pays.length ? pays.reduce((s, x) => s + x.pay, 0) / mul : null,
  };

  const obj = {
    meta,
    연구개발내용: planBlocks(fileLog(y, 'plan'), label),
    예산: { 단위: exact ? '천원' : '원', 비목별: [row], 참여연구자인건비: [roster] },
    ...(Object.keys(p.refs || {}).length ? { 공문: { 참조자: structuredClone(p.refs) } } : {}),
  };
  // 연차별기간이 있으면 readSnapshot 은 2차년도가 1월 1일에 시작하는지로 차년도 끊는 기준을 가린다 — 1월 1일에 시작하는 과제처럼 그것이
  // 장부와 어긋나면 빼 둔다(넣을 때 "차년도 끊는 기준" 변경이력이 헛돌지 않게).
  if (meta.연차별기간 && readSnapshot(obj).project.calendar !== !!p.calendar) delete meta.연차별기간;

  const { Document } = await yamlLib();
  const doc = new Document(obj);
  // 모양은 실물 스냅샷처럼 — 맨 위 블록 사이에 빈 줄, 짧은 줄(연차범위·목표치·참여자·일정 항목)은 한 줄 묶음.
  for (const pair of doc.contents.items.slice(1)) pair.key.spaceBefore = true;
  const flow = (node) => { if (node && typeof node === 'object') node.flow = true; };
  flow(doc.getIn(['meta', '연차범위'], true));
  for (const perf of doc.getIn(['연구개발내용', '성능목표'], true)?.items || []) flow(perf.get('목표치', true));
  for (const it of doc.getIn(['연구개발내용', '수행일정', 0, '항목'], true)?.items || []) flow(it);
  for (const person of doc.getIn(['예산', '참여연구자인건비', 0, '참여자'], true)?.items || []) flow(person);
  setHeader(doc, [
    `[장부에서 지음] KRS WORKSPACE — 저장된 YAML 원문이 없어 장부로 지은 기준(손실 있음) ${oneLine(today)}`,
    '장부에 없는 칸(지원부담 · 외주용역 · 세부사용계획 · 간접비세부 · 참여자의 구분·급여총액 · 표지의 나머지)은 빠졌습니다 — 원문 YAML 을 넣어 두면 정확합니다',
  ]);
  return { text: doc.toString(OUT), obj: doc.toJS(), lossy: true };
}

/* ------------------------------------------------------------ 파일 이름 */

/** 파일 이름(§1-12) — `KR_<과제명 정규화>.yaml` · rev 가 r1 이상이면 `KR_<…>_rN.yaml`. 과제명의 공백·`\/:*?"<>|` 는 `_`(이어진 것은 하나로). */
export function fileName(project, { rev = '' } = {}) {
  const raw = typeof project === 'string' ? project : project?.name;
  const name = str(raw).replace(/[\s\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^_+|_+$/g, '') || '과제';
  const k = revNo(rev);
  return `KR_${name}${k >= 1 ? `_r${k}` : ''}.yaml`;
}
