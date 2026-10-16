// R&D 사업계획서 → KR 스냅샷 YAML 뽑기(rnd.extract)와 변경사항 → YAML 고치기(rnd.revise)의 LLM 입력 글을 짓고 Claude 에게 묻는다.
//
// 작업(지시문·답 칸)은 행위 명세가 만든다 — actions/spec/rnd/extract.yaml·revise.yaml → tools/gen-actions.mjs → actions/spec.js 의 tasks → src/input.js 의 TASKS.
// 여기서 하는 것은 **입력 글**(머리말 · 스킬 문서 두 벌 · 재료 글)을 짓는 것과 askClaude(로컬 CLI → API 키, 답은 관문 structure 를 지난 것)를 바로 부르는 것뿐이다.
// src/llm.js 의 fillAction·INPUTS 는 이 갈래를 쓰지 않는다(_domain.yaml 의 llm.input: rnd 는 이름만).
// 재료(Material — 사업계획서에서 고른 쪽의 글자와 작은 PDF)는 rndgen/source.js 가 만들고, 답의 검사·마무리(판·머리 주석)는 rndgen/yaml.js 가 한다.
// 한도(effort medium · max_tokens 32000 · 입력 15만 자 · 10분)는 src/tasktune.js — 다리(native/host.mjs)가 입력을 그 한도에서 자르므로 여기서 미리 맞춘다.
//
// import 만으로는 아무것도 부르지 않는다 — 스킬 문서는 loadSkillDocs(readAsset) 를 부를 때, chrome 은 askClaude 를 부를 때 처음 본다.

import { askClaude } from '../src/llm.js';
import { tuneOf } from '../src/tasktune.js';

/** 스킬 문서(LLM 입력에 그대로 싣는다) — 확장 안의 파일. */
export const SKILL_DOCS = Object.freeze({
  fields: 'rnd/skills/rnd-kr-extract/references/extract_fields.yaml',
  output: 'rnd/skills/rnd-kr-extract/references/structured_output.md',
});
/** 입력 글 한도(글자) — 머리말·스킬 문서를 뺀 재료 글에 쓴다. tasktune inputMax(150,000) 안에 들게. */
export const INPUT_BUDGET = Object.freeze({ extractMaterial: 100_000, reviseBase: 90_000, reviseText: 20_000, reviseMaterial: 40_000 });

const TASKS = ['rnd.extract', 'rnd.revise'];
/** 다리가 입력을 자르는 한도(두 작업이 같다) — 재료 예산을 이 안으로 줄인다(머리말·울타리·잘림 표시의 몫을 남기고). */
const INPUT_MAX = tuneOf('rnd.extract').inputMax;
const SLACK = 200;
const NO_CLAUDE = 'Claude 연결(로컬 CLI 또는 API 키)이 필요합니다 — 설정 → LLM';

const str = (v) => (v == null ? '' : String(v).trim());
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
/** 울타리(<<< >>>) 안에 넣을 글 — 글 안의 >>> 는 > > > 로 바꿔 울타리가 깨지지 않게 한다(src/llm.js 와 같은 울타리). */
const fenceSafe = (text) => String(text ?? '').replace(/>{3,}/g, (m) => [...m].join(' '));
const fenced = (label, body) => `[${label}]\n<<<\n${body}\n>>>`;
/** 한도를 넘는 글은 뒤를 자르고 몇 자가 더 있었는지 적는다. */
const clip = (text, max) => (text.length > max ? `${text.slice(0, Math.max(0, max))}\n…(${num(text.length - Math.max(0, max))}자 더 있음 — 잘림)` : text);
const stageOk = (n) => Number.isInteger(n) && n >= 1 && n <= 20;

/* ------------------------------------------------------------ 스킬 문서 */

let skillDocs = null;   // Promise<{fields, output}> — 한 번 읽으면 외운다(실패는 외우지 않는다)

/**
 * 스킬 문서 둘을 읽는다(모듈 안에 한 번 외운다 — resetSkillDocs() 로 잊음).
 * @param {(path:string, as?:'text'|'bytes') => Promise<string|Uint8Array>} readAsset
 * @returns {Promise<{fields: string, output: string}>}  못 읽으면 Error('스킬 문서를 읽지 못했습니다 — <path> (<까닭>)')
 */
export async function loadSkillDocs(readAsset) {
  if (!skillDocs) {
    const readOne = async (path) => {
      let got;
      try {
        got = await readAsset(path, 'text');
      } catch (err) {
        throw new Error(`스킬 문서를 읽지 못했습니다 — ${path} (${err?.message || err})`);
      }
      const text = got instanceof Uint8Array ? new TextDecoder('utf-8').decode(got) : typeof got === 'string' ? got : '';
      if (!text.trim()) throw new Error(`스킬 문서를 읽지 못했습니다 — ${path} (빈 파일)`);
      return text;
    };
    skillDocs = Promise.all([readOne(SKILL_DOCS.fields), readOne(SKILL_DOCS.output)]).then(([fields, output]) => ({ fields, output }));
    skillDocs.catch(() => { skillDocs = null; });
  }
  return skillDocs;
}

export function resetSkillDocs() {
  skillDocs = null;
}

/* ------------------------------------------------------------ 뽑기 입력 */

/** 쪽 번호 목록 → "1-3, 45-52, 118" (오름차순 가정, 겹침은 하나로). */
export function pageRanges(pages) {
  const ns = [...new Set((pages || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(i === j ? `${ns[i]}` : `${ns[i]}-${ns[j]}`);
    i = j;
  }
  return out.join(', ');
}

/** 머리말의 "원본 문서:" 한 문장 — 무엇을 글자로 실었고 무엇을 PDF 로 붙였는지(material.read 를 LLM 에게 풀어 쓴 것). */
function sourceSentence(m) {
  const name = str(m?.name) || '(이름 없는 문서)';
  if (m?.kind !== 'pdf') {
    return `${name} — 글자만 실었습니다(${num(m?.chars ?? String(m?.text || '').length)}자 · 구역 ${num(m?.total)}개에서 고름 — 건너뛴 곳은 "(… 생략 …)").`;
  }
  const picked = Array.isArray(m.picked) ? m.picked : [];
  const pages = `${num(m.total)}쪽 가운데 ${num(picked.length)}쪽(${pageRanges(picked)})`;
  if (m.attach === 'slice') {
    return `${name} — ${pages}을 골라 글자로 실었고, 같은 쪽을 그 차례대로 담은 작은 PDF 를 붙였습니다(PDF 의 k번째 쪽이 고른 k번째 쪽입니다).`;
  }
  if (m.attach === 'original') {
    return picked.length
      ? `${name} — ${pages}의 글자를 실었고, 원본 PDF 를 통째로 붙였습니다(PDF 의 쪽 번호가 원본 쪽 번호입니다 — 글자 층이 없는 쪽은 PDF 에서 봅니다).`
      : `${name} — ${num(m.total)}쪽, 글자 층이 없어 원본 PDF 를 통째로 붙였습니다(PDF 의 쪽 번호가 원본 쪽 번호입니다).`;
  }
  return picked.length ? `${name} — ${pages}을 골라 글자만 실었습니다.` : `${name} — ${num(m.total)}쪽, 글자를 뽑지 못해 실은 글자가 없습니다.`;
}

/**
 * rnd.extract 입력 글. 머리말(오늘 · 뽑을 차년도 · 장부의 과제 · 원본 파일과 고른 쪽) → 스킬 문서 두 벌 → 재료 글(쪽 표시 그대로).
 * material.text 가 INPUT_BUDGET.extractMaterial 을 넘으면 뒤를 잘라 "…(N자 더 있음 — 잘림)" 을 적는다.
 * @param {object} material  (U2 source.js readDocument 의 결과 — Material)
 * @param {{ today: string, stage: number|null, project: {name:string, code:string, alias:string, start:string, end:string, calendar:boolean}|null,
 *           currentStage: number|null, docs: {fields:string, output:string} }} ctx   currentStage 는 장부 기준 오늘이 든 차년도(과제를 알 때)
 * @returns {string}
 */
export function extractInput(material, ctx = {}) {
  const { today = '', stage = null, project = null, currentStage = null, docs } = ctx;
  if (!docs || typeof docs.fields !== 'string' || typeof docs.output !== 'string') throw new Error('스킬 문서가 없습니다 — loadSkillDocs 를 먼저 부르세요');
  const head = [
    `오늘은 ${str(today)} 입니다.`,
    stageOk(stage) ? `뽑을 차년도: ${stage}차년도` : '뽑을 차년도: 오늘이 든 차년도(표지의 연차별 연구개발기간 표로 셈)',
    ...(stageOk(currentStage) ? [`장부 기준 오늘이 든 차년도: ${currentStage}차년도`] : []),
    ...(project ? [`장부의 과제: ${[
      str(project.name) || '(과제명 없음)',
      str(project.code) && `과제번호 ${str(project.code)}`,
      str(project.alias) && `별칭 ${str(project.alias)}`,
      (str(project.start) || str(project.end)) && `연구기간 ${str(project.start)} ~ ${str(project.end)}`,
    ].filter(Boolean).join(' · ')}`] : []),
    `원본 문서: ${sourceSentence(material)}`,
  ].join('\n');
  const rules = [
    fenced('스킬 규칙 1 — rnd-kr-extract/references/extract_fields.yaml — 무엇을 넣고 빼는가', fenceSafe(docs.fields)),
    fenced('스킬 규칙 2 — rnd-kr-extract/references/structured_output.md — 값의 모양', fenceSafe(docs.output)),
    '위 두 문서의 폴더·스크립트·에이전트·이력(init)·JSON 사본 절차는 무시합니다 — 여기서는 YAML 글 하나만 냅니다.',
  ].join('\n');
  const before = `${head}\n\n${rules}\n\n`;
  const budget = Math.min(INPUT_BUDGET.extractMaterial, INPUT_MAX - before.length - SLACK);
  const body = clip(fenceSafe(str(material?.text)), budget);
  return `${before}${fenced('문서 글자', body)}`;
}

/* ------------------------------------------------------------ 고치기 입력 */

/** 여러 재료에 글자 예산을 고르게 나눈다 — 짧은 것은 다 싣고 남은 몫을 긴 것들이 나눈다. */
function shareBudget(lengths, budget) {
  const out = lengths.map(() => 0);
  let left = Math.max(0, budget);
  lengths.map((len, i) => [len, i]).sort((a, b) => a[0] - b[0]).forEach(([len, i], k, all) => {
    out[i] = Math.min(len, Math.floor(left / (all.length - k)));
    left -= out[i];
  });
  return out;
}

/**
 * rnd.revise 입력 글. 머리말(오늘 · 과제 · 차년도 · 지금 판 rK — "다음 판 번호와 머리 주석은 코드가 적는다") → [기준 YAML] <<< >>> → [변경사항] <<< >>> → [붙인 문서 글자] 마다 <<< >>>.
 * 각 조각은 INPUT_BUDGET 의 한도에서 자르고 잘렸음을 적는다. 기준 YAML 은 자르지 않는다(넘으면 던진다 — '기준 YAML 이 너무 깁니다(N자)').
 * @param {{ baseYaml: string, text: string, materials?: object[], today: string, project: {name,code,alias}|null, n: number, rev: string }} args
 * @returns {string}
 */
export function reviseInput({ baseYaml = '', text = '', materials = [], today = '', project = null, n = 0, rev = '' } = {}) {
  const base = fenceSafe(String(baseYaml ?? '').trim());
  if (!base) throw new Error('기준 YAML 이 비어 있습니다');
  if (base.length > INPUT_BUDGET.reviseBase) throw new Error(`기준 YAML 이 너무 깁니다(${num(base.length)}자)`);
  const who = [
    project ? str(project.name) || '(과제명 없음)' : '(장부에 없는 과제)',
    project && str(project.code) && `과제번호 ${str(project.code)}`,
    project && str(project.alias) && `별칭 ${str(project.alias)}`,
    stageOk(Number(n)) ? `${Number(n)}차년도` : '',
    `지금 판 ${str(rev) || '(판 없음)'}`,
  ].filter(Boolean).join(' · ');
  const said = str(text);
  const parts = [
    `오늘은 ${str(today)} 입니다.`,
    `과제: ${who} (다음 판 번호와 파일 머리 주석은 코드가 적습니다 — 바꾸지 마세요)`,
    '',
    fenced('기준 YAML', base),
    fenced('변경사항', said ? clip(fenceSafe(said), INPUT_BUDGET.reviseText) : '(글 없음 — 아래 붙인 문서의 글자를 보세요)'),
  ];
  const docs = (Array.isArray(materials) ? materials : []).filter(Boolean).map((m) => ({ name: str(m.name) || '(이름 없는 문서)', text: fenceSafe(str(m.text)) }));
  if (docs.length) {
    const fixed = parts.join('\n').length + docs.reduce((a, d) => a + `\n[붙인 문서 글자 — ${d.name}]\n<<<\n\n>>>`.length + 40, 0);
    const budgets = shareBudget(docs.map((d) => d.text.length), Math.min(INPUT_BUDGET.reviseMaterial, INPUT_MAX - fixed - SLACK));
    docs.forEach((d, i) => parts.push(fenced(`붙인 문서 글자 — ${d.name}`, d.text ? clip(d.text, budgets[i]) : '(글자 없음)')));
  }
  return parts.join('\n');
}

/* ------------------------------------------------------------ 묻기 */

/**
 * 공용 consumer(생성기 consumer: { module: rndgen/llm.js, export: askRndTask }). askClaude(로컬 CLI → API 키)를 부르고 **답이 없으면 던진다**.
 * @param {'rnd.extract'|'rnd.revise'} task
 * @param {string} input
 * @param {{ ai: {apiKey?:string, cli?:boolean}, files?: {name,type,dataUrl}[], ask?: typeof askClaude }} opts   ask 는 검사가 끼운다
 * @returns {Promise<{ data: object, via: 'cli'|'api', costUsd?: number, note: string }>}  note 는 fails·notes 를 ', ' 로
 *   던짐: Error('Claude 연결(로컬 CLI 또는 API 키)이 필요합니다 — 설정 → LLM')  (apiKey 도 cli 도 없을 때)
 *         Error('답을 받지 못했습니다 — <fails 를 ", " 로>')
 */
export async function askRndTask(task, input, { ai = {}, files = [], ask = askClaude } = {}) {
  if (!TASKS.includes(task)) throw new Error(`모르는 R&D 작업 ${task} — ${TASKS.join(' · ')}`);
  if (!str(ai?.apiKey) && !ai?.cli) throw new Error(NO_CLAUDE);
  const got = await ask(task, input, { apiKey: ai.apiKey, useNative: !!ai.cli, files });
  const fails = Array.isArray(got?.fails) ? got.fails : [];
  if (!got?.data) throw new Error(`답을 받지 못했습니다 — ${fails.join(', ') || '까닭을 모릅니다'}`);
  const notes = Array.isArray(got.notes) ? got.notes : [];
  return { data: got.data, via: got.via, ...(got.costUsd != null ? { costUsd: got.costUsd } : {}), note: [...fails, ...notes].filter(Boolean).join(', ') };
}

/** 편의 — extractInput 을 짓고 askRndTask('rnd.extract', …, { files: material.file ? [material.file] : [] }). 돌려주는 것은 askRndTask 의 결과 + { input }. */
export async function askExtract(material, ctx, opts = {}) {
  const input = extractInput(material, ctx);
  const got = await askRndTask('rnd.extract', input, { ...opts, files: material?.file ? [material.file] : [] });
  return { ...got, input };
}

/** 편의 — reviseInput 을 짓고 askRndTask('rnd.revise', …)(첨부 없음 — 문서는 글자로만). 돌려주는 것은 askRndTask 의 결과 + { input }. */
export async function askRevise(args, opts = {}) {
  const input = reviseInput(args);
  const got = await askRndTask('rnd.revise', input, { ...opts, files: [] });
  return { ...got, input };
}
