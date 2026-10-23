// 사업계획서·연구계획서 한 벌 → LLM 에 줄 재료(Material)(2026-10-16) — R&D 탭의 ＋(과제 더하기)와 변경 및 이력 관리 카드가 쓴다(rndgen/panel.js).
// 국가 R&D 사업계획서는 100~300쪽이다. 처음(2026-10-16)에는 쪽마다 점수를 매겨 KR 블록이 든 24쪽·9만 자만 골라 한 번에 보냈고 원본 20MB·스캔본 8MB 를 넘으면
// 거절했지만, 2026-10-23 사용자 지정("사업계획서 첨부할때.. 크기 제한없이 분할해서 처리 하도록 해줘")으로 **크기로 거르지도 자르지도 않는다** — 문서 전체를
// 문서 차례대로 부분(Part)으로 나눠 차례로 보내고(부분마다 글자 ≤ partChars, 붙이는 PDF ≤ attachBytesMax), 패널이 앞 부분까지 뽑은 YAML 을 다음 부분에
// 이어 준다(rndgen/panel.js askOne · rndgen/llm.js extractInput 의 prior).
//
//   pdf    : 글자 층(pdf.js, doctext/browser.js pdfAllText — 모든 쪽) → splitPages 로 글자 한도 안의 이어진 쪽 묶음 → 묶음마다 그 쪽만 담은 작은 PDF(pdf-lib) — attach 'slice'.
//            작은 PDF 가 attachBytesMax 를 넘으면 쪽을 반으로 갈라 다시 만든다(한 쪽이 혼자 넘으면 그 부분은 글자만 — attach 'none'). pdfSlice 가 던지면(암호 등) 글자만.
//            글자 층이 없으면(스캔본) 쪽 수만으로 같은 식으로 가른다 — 원본이 한도 안이면 통째 한 부분(attach 'original'), 아니면 쪽 묶음(attach 'slice').
//            쪽 수도 모르면(깨짐) 원본을 한 부분으로(한도 안일 때만).
//   office : hwpx·docx·xlsx·pptx 의 글자(src/officetext.js — 글자 한도 없이) → splitChunks(빈 줄 단위 구역을 partChars 안으로 묶음) — 글자만.
//   text   : txt·md 는 그대로 글 → splitChunks — 글자만.
//   yaml·hwp·모름 : 던진다(YAML 은 재료가 아니라 그대로 넣는 파일이고, 옛 한글은 뽑지 못한다).
//
// 엔진(pdf.js·pdf-lib·officetext)은 주입한다 — 나누기·글 잇기·data URL 은 엔진 없이 검사된다. 가져오기만으로는 chrome·DOM·fetch 를 만지지 않는다
// (test/wiring.test.mjs 가 jsdom 에서 sidepanel.js 를 통째로 가져온다). 진짜 엔진은 defaultEngines() 가 쓸 때 import() 한다.

import { officeKind } from '../src/officetext.js';

/** 한도 — 부분 하나의 크기일 뿐, 문서 전체(쪽 수·글자·MB)의 한도는 없다(2026-10-23). readDocument 의 limits 로 일부만 바꿔 끼울 수 있다(검사). */
export const LIMITS = Object.freeze({
  partChars: 80_000,                 // 부분 하나의 재료 글(쪽 표시·빈 줄 포함) — 다리의 입력 한도 15만 자 안에 머리말·스킬 문서(약 3만 자)·앞 부분까지의 YAML 이 함께 든다(rndgen/llm.js)
  partPages: 100,                    // 부분 하나에 붙이는 PDF 의 쪽 수 상한 — Claude API 가 문서 하나에 받는 쪽 수(글자 층 없는 스캔본은 글자 한도가 없어 이것과 바이트로만 가른다)
  attachBytesMax: 8 * 1024 * 1024,   // 부분 하나에 붙이는 PDF 의 상한 — 넘으면 쪽을 더 잘게 가른다
  chunkChars: 3_000,                 // office/text 를 구역으로 나누는 크기 — 부분은 구역 경계에서 끊는다
});

const PDF_TYPE = 'application/pdf';

/* ------------------------------------------------------------ 갈래 */

/** 끝의 확장자(소문자) — "2026.10.15 보고" 처럼 점 뒤가 확장자 꼴이 아니면 ''. */
function extOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

const YAML_MIME = /^(text|application)\/(x-)?yaml$/;
const TEXT_MIME = /^text\/(plain|markdown|x-markdown)$/;
const HWP_MIME = /^application\/(x-hwp|haansofthwp|vnd\.hancom\.hwp)$/;

/** 파일의 갈래 — 'yaml' | 'pdf' | 'office'(hwpx·docx·xlsx·pptx) | 'text'(txt·md) | 'hwp'(옛 한글 — 못 뽑음) | ''(모름). 이름의 확장자 먼저, 없으면 MIME. */
export function docKind(name, type = '') {
  const ext = extOf(name);
  if (ext) {
    if (ext === 'yaml' || ext === 'yml') return 'yaml';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'txt' || ext === 'md' || ext === 'markdown') return 'text';
    if (ext === 'hwp') return 'hwp';
    return officeKind(name) ? 'office' : '';
  }
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  if (!t) return '';
  if (t === PDF_TYPE) return 'pdf';
  if (YAML_MIME.test(t)) return 'yaml';
  if (TEXT_MIME.test(t)) return 'text';
  if (HWP_MIME.test(t)) return 'hwp';
  return officeKind('', t) ? 'office' : '';
}

/** 받을 수 없는 문서의 안내 — 'hwp' 면 옛 한글 안내, '' 면 넣을 수 있는 것의 목록, 받는 것이면 ''. */
export function unsupportedDocNote(name, type = '') {
  const kind = docKind(name, type);
  if (kind === 'hwp') return '옛 한글(.hwp)은 뽑지 못합니다 — 한글에서 PDF 로 저장해 넣으세요(.hwpx 는 그대로 됩니다)';
  if (kind) return '';
  const ext = extOf(name);
  return `${ext ? `.${ext} ` : '이 '}파일은 넣을 수 없습니다 — 넣을 수 있는 것: YAML(.yaml/.yml) · PDF · HWPX · DOCX · XLSX · TXT/MD`;
}

/* ------------------------------------------------------------ 글 */

/** 울타리(<<< >>>) 깨짐 막기 — 재료 글 안의 ">>>" 는 "> > >" 로. */
const fence = (text) => String(text || '').replace(/>{3,}/g, (m) => [...m].join(' '));
const pageMark = (n) => `— ${n}쪽 —`;

/** PDF 쪽 글 다듬기 — 빈칸 묶음은 하나로, 줄 앞뒤 빈칸과 세 줄 넘는 빈 줄은 뗀다(글자 예산을 빈칸에 쓰지 않게). */
function tidyPage(text) {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 쪽 글들을 "— N쪽 —" 표시로 잇는다(고른 쪽만). picked 는 1부터 센 쪽 번호. */
export function pagesText(pages, picked) {
  const list = Array.isArray(pages) ? pages : [];
  return (picked || []).filter((n) => n >= 1 && n <= list.length)
    .map((n) => `${pageMark(n)}\n${fence(list[n - 1] ?? '').trim()}`.trim()).join('\n\n');
}

/** 긴 문단을 size 안의 조각으로 — 줄에서 끊고, 한 줄이 그래도 길면 그 자리에서 자른다. */
function splitLong(para, size) {
  const out = [];
  let cur = '';
  for (const line of para.split('\n')) {
    for (let at = 0; at < Math.max(1, line.length); at += size) {
      const piece = line.slice(at, at + size);
      if (cur && cur.length + 1 + piece.length > size) {
        out.push(cur);
        cur = piece;
      } else {
        cur = cur ? `${cur}\n${piece}` : piece;
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 글을 빈 줄로 나눠 chunk 글자 안의 구역으로 묶는다(문서 차례). */
function chunksOf(text, size) {
  const out = [];
  let cur = '';
  for (const para of text.split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean)) {
    for (const piece of para.length > size ? splitLong(para, size) : [para]) {
      if (cur && cur.length + 2 + piece.length > size) {
        out.push(cur);
        cur = piece;
      } else {
        cur = cur ? `${cur}\n\n${piece}` : piece;
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* ------------------------------------------------------------ 나누기 */

/**
 * 쪽을 문서 차례대로 글자 한도 안의 이어진 묶음으로 가른다 — [from, to](1부터 센 쪽 번호, 둘 다 포함). 글자는 pagesText 가 이을 꼴 그대로 센다(쪽 표시·빈 줄 포함).
 * 한 쪽이 혼자 한도를 넘으면 그 쪽만의 묶음이 된다(rndgen/llm.js 가 뒤를 자르고 몇 자 더 있었는지 적는다). 쪽이 없으면 빈 목록.
 * @param {string[]} pages
 * @returns {[number, number][]}
 */
export function splitPages(pages, { partChars = LIMITS.partChars } = {}) {
  const list = Array.isArray(pages) ? pages.map((p) => String(p ?? '')) : [];
  const cost = (i) => pageMark(i + 1).length + 1 + list[i].length + 2;
  const out = [];
  let from = 0;
  let used = 0;
  for (let i = 0; i < list.length; i++) {
    if (i > from && used + cost(i) > partChars) {
      out.push([from + 1, i]);
      from = i;
      used = 0;
    }
    used += cost(i);
  }
  if (list.length) out.push([from + 1, list.length]);
  return out;
}

/**
 * 긴 글(office/text)을 빈 줄 단위 구역(chunk 글자)으로 나눠 문서 차례대로 partChars 안의 부분으로 묶는다 — 구역 경계에서만 끊고, 글은 빠짐없이 다 든다.
 * @returns {{ total: number, parts: { from: number, to: number, text: string }[] }}  total 은 구역 수, from·to 는 1부터 센 구역 번호(둘 다 포함)
 */
export function splitChunks(text, { partChars = LIMITS.partChars, chunk = LIMITS.chunkChars } = {}) {
  const body = String(text || '').replace(/\r\n?/g, '\n').trim();
  const chunks = chunksOf(body, Math.max(1, Math.min(chunk, partChars)));
  const parts = [];
  let cur = [];
  let from = 1;
  let used = 0;
  chunks.forEach((c, i) => {
    if (cur.length && used + 2 + c.length > partChars) {
      parts.push({ from, to: i, text: fence(cur.join('\n\n')) });
      cur = [];
      from = i + 1;
      used = 0;
    }
    used += (cur.length ? 2 : 0) + c.length;
    cur.push(c);
  });
  if (cur.length) parts.push({ from, to: chunks.length, text: fence(cur.join('\n\n')) });
  return { total: chunks.length, parts };
}

/* ------------------------------------------------------------ 바이트 */

/** 바이트 → data URL(큰 바이트도 — 덩어리로 btoa). 덩어리는 3의 배수라 이어 붙인 base64 가 한 번에 만든 것과 같다. */
export function toDataUrl(bytes, type) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const STEP = 3 * 0x2000;
  const parts = [];
  for (let i = 0; i < u8.length; i += STEP) parts.push(btoa(String.fromCharCode.apply(null, u8.subarray(i, i + STEP))));
  return `data:${type || 'application/octet-stream'};base64,${parts.join('')}`;
}

/** data URL 의 바이트 수(base64 길이로 셈). base64 가 아니면 풀어 낸 글자 수. */
export function dataUrlBytes(dataUrl) {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  if (comma < 0) return 0;
  const head = s.slice(0, comma);
  const body = s.slice(comma + 1);
  if (!/;base64$/i.test(head)) {
    try {
      return new TextEncoder().encode(decodeURIComponent(body)).length;
    } catch {
      return body.length;
    }
  }
  const b64 = body.replace(/\s/g, '');
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

const toBytes = (b) => (b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : null);
const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.ceil(n / 1024))}KB`);
/** 한도 글 — 딱 떨어지는 MB 면 "8MB", 아니면 sizeText(검사가 작은 한도를 끼울 때). */
const mbText = (n) => (n > 0 && n % 1048576 === 0 ? `${n / 1048576}MB` : sizeText(n));
const num = (n) => Number(n).toLocaleString('ko-KR');
const why = (err) => String(err?.message || err).slice(0, 120);
const stemOf = (name) => String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '') || '문서';
const span = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
/** 이어진 쪽 번호 → "71-106", 하나면 "71"(이어지지 않으면 쉼표로). */
const pageSpan = (nos) => {
  const out = [];
  for (let i = 0; i < nos.length; i++) {
    let j = i;
    while (j + 1 < nos.length && nos[j + 1] === nos[j] + 1) j++;
    out.push(i === j ? `${nos[i]}` : `${nos[i]}-${nos[j]}`);
    i = j;
  }
  return out.join(', ');
};
/** 쓸 만한 글자가 든 쪽 — 공백 빼고 40자 넘고, 글꼴 표가 없어 깨진 글자(사설 영역·제어 문자)가 10% 아래. doctext/core.js usable 과 같은 셈. */
function readable(text) {
  const d = String(text || '').replace(/\s/g, '');
  if (d.length <= 40) return false;
  return (d.match(/[\p{Co}\p{Cc}\p{Cn}\u{FFFD}]/gu) || []).length / d.length < 0.1;
}

/* ------------------------------------------------------------ 문서 → 재료 */

/**
 * 문서 하나 → 재료(Material). 엔진은 주입(순수 부분과 가른다). 크기로 거절하지 않는다 — 부분(parts)으로 나눈다(2026-10-23).
 *   Material = { name, kind, total, parts: Part[], text(모든 부분의 글을 이은 것 — 과제 짚기·검사용), chars, picked(pdf — 글로 실은 쪽 번호들, 아니면 null),
 *                file·attach(부분이 하나면 그 부분의 것, 여럿이면 null·'parts'), read(사람에게 보일 한 줄), warnings }
 *   Part     = { name, kind, total, no, count, pages([from, to] — pdf 에서 그 부분이 담은 쪽 범위)|null, picked(pdf — 그 가운데 글로 실은 쪽 번호들)|null,
 *                chunks([from, to] — office/text 의 구역 번호)|null, text, chars, file({ name, type, dataUrl })|null, attach: 'slice'|'original'|'none', read("k/N부분 — …") }
 *   pdf    : engines.pdfText(bytes) → { pages, total }. 글자 층이 쓸 만하면(40자 넘는 쪽이 전체의 30% 이상) splitPages 로 묶고 engines.pdfSlice(bytes, pageNos) 로 묶음마다 작은 PDF.
 *            작은 PDF 가 attachBytesMax 를 넘으면 반으로 갈라 다시(한 쪽이 넘으면 글자만). pdfSlice 가 던지면 글자만(attach 'none', warnings 에 까닭).
 *            글자 층이 없으면 쪽 수로 묶는다 — 원본이 한도 안이면 통째 한 부분(attach 'original'), 아니면 묶음마다 작은 PDF. 쪽 수를 모르면(engines.pdfCount 도 없거나 던짐) 원본을 한 부분으로(한도 안일 때만).
 *   office : engines.officeText(bytes, name, { max: Infinity, type }) → splitChunks. file 은 null, attach 'none'.
 *   text   : TextDecoder('utf-8') → splitChunks.
 *   yaml·hwp·'' : 던진다 — Error(unsupportedDocNote(...)) ('yaml' 은 'YAML 은 재료가 아니라 그대로 넣는 파일입니다'). 글자가 하나도 없는 office/text 도 던진다.
 * @param {{ name: string, type?: string, bytes: Uint8Array }} file
 * @param {{ engines?: Engines, limits?: typeof LIMITS }} [opts]  engines·limits 는 일부만 줘도 된다(나머지는 기본)
 * @returns {Promise<Material>}
 */
export async function readDocument(file, { engines, limits } = {}) {
  const lim = { ...LIMITS, ...(limits || {}) };
  const eng = { ...defaultEngines(), ...(engines || {}) };
  const name = String(file?.name || '').trim() || '문서';
  const type = String(file?.type || '');
  const kind = docKind(name, type);
  if (kind === 'yaml') throw new Error('YAML 은 재료가 아니라 그대로 넣는 파일입니다');
  if (kind !== 'pdf' && kind !== 'office' && kind !== 'text') throw new Error(unsupportedDocNote(name, type));
  const bytes = toBytes(file?.bytes);
  if (!bytes) throw new Error(`${name}: 파일 바이트가 없습니다`);
  if (kind === 'pdf') return readPdf(name, bytes, eng, lim);
  if (kind === 'office') {
    const got = await eng.officeText(bytes, name, { max: Infinity, type });
    return textMaterial(name, 'office', got?.text, lim, got?.cut ? ['글자를 끝까지 읽지 못했습니다(officeText 가 잘랐습니다)'] : []);
  }
  return textMaterial(name, 'text', new TextDecoder('utf-8').decode(bytes), lim, []);
}

/** 부분들 → 재료. text 는 모든 부분의 글을 이은 것. */
function assemble(base, parts, warnings, read) {
  const text = parts.map((p) => p.text).filter(Boolean).join('\n\n');
  const one = parts.length === 1 ? parts[0] : null;
  return { ...base, parts, text, chars: text.length, file: one ? one.file : null, attach: one ? one.attach : 'parts', read, warnings };
}

/** office·text 의 재료 — 구역을 부분으로 묶어 글자만. */
function textMaterial(name, kind, raw, lim, warnings) {
  const body = String(raw || '').trim();
  if (!body) throw new Error(`${name}: 글자가 없습니다 — 뽑을 것이 없습니다`);
  const got = splitChunks(body, { partChars: lim.partChars, chunk: lim.chunkChars });
  const count = got.parts.length;
  const parts = got.parts.map((p, i) => ({
    name, kind, total: got.total, no: i + 1, count, pages: null, picked: null, chunks: [p.from, p.to], text: p.text, chars: p.text.length, file: null, attach: 'none',
    read: `${i + 1}/${count}부분 — 구역 ${p.from === p.to ? num(p.from) : `${num(p.from)}-${num(p.to)}`} · 글자 ${num(p.text.length)}자 · 글자만`,
  }));
  const chars = parts.reduce((a, p) => a + p.chars, 0) + Math.max(0, count - 1) * 2;
  const how = count > 1 ? `${num(count)}부분으로 나눠 차례로 보냄(글자만)` : '한 번에 보냄 · 글자만 실음';
  return assemble({ name, kind, total: got.total, picked: null }, parts, warnings, `${name}: 구역 ${num(got.total)}개 · 글자 ${num(chars)}자 · ${how}`);
}

/** [from, to] 묶음들을 쪽 수 상한 안의 묶음으로 더 가른다(문서 차례). */
function capRanges(ranges, pagesMax) {
  const out = [];
  for (const [from, to] of ranges) for (let a = from; a <= to; a += pagesMax) out.push([a, Math.min(to, a + pagesMax - 1)]);
  return out;
}

/**
 * 쪽 묶음들 → 조각들({ pageNos, text, file(바이트)|null, attach, size }). 묶음마다 그 쪽만 담은 작은 PDF 를 만들고, attachBytesMax 를 넘으면 반으로 갈라 다시 만든다
 * (한 쪽이 혼자 넘으면 그 부분은 글자만). pdfSlice 가 던지면(암호 등) 그 뒤로는 자르지 않고 글자만(까닭은 한 번만 warnings 에). 글은 withText 가 참인 쪽만 싣는다.
 */
async function pdfPieces(bytes, pages, ranges, eng, lim, warnings, withText) {
  const out = [];
  let sliceFail = '';
  const work = ranges.map(([from, to]) => [from, to]);
  while (work.length) {
    const [from, to] = work.shift();
    const pageNos = span(from, to);
    const textNos = pageNos.filter((n) => withText(n));
    const text = pagesText(pages, textNos);
    if (sliceFail) { out.push({ pageNos, textNos, text, file: null, attach: 'none', size: 0 }); continue; }
    let slice = null;
    try {
      slice = toBytes(await eng.pdfSlice(bytes, pageNos));
      if (!slice?.length) throw new Error('빈 PDF');
    } catch (err) {
      sliceFail = why(err);
      warnings.push(`쪽을 담은 작은 PDF 를 만들지 못해(${sliceFail}) 글자만 실었습니다`);
      out.push({ pageNos, textNos, text, file: null, attach: 'none', size: 0 });
      continue;
    }
    if (slice.length > lim.attachBytesMax) {
      if (to > from) {
        const mid = Math.floor((from + to) / 2);
        work.unshift([from, mid], [mid + 1, to]);   // 반으로 — 차례는 그대로
        continue;
      }
      warnings.push(`${num(from)}쪽은 그 한 쪽의 PDF 가 커서(${sizeText(slice.length)}) 붙이지 않고 글자만 실었습니다 — ${mbText(lim.attachBytesMax)} 까지`);
      out.push({ pageNos, textNos, text, file: null, attach: 'none', size: 0 });
      continue;
    }
    out.push({ pageNos, textNos, text, file: slice, attach: 'slice', size: slice.length });
  }
  return out;
}

/** PDF 조각들 → 재료. head 는 스캔본·뽑지 못함의 머리말(글자 층이 있으면 ''). textPages 는 글로도 실은 쪽 수. */
function pdfMaterial(name, total, pieces, { head = '', warnings = [], textPages = 0 } = {}) {
  const count = pieces.length;
  const stem = stemOf(name);
  const parts = pieces.map((p, i) => {
    const no = i + 1;
    const file = p.file ? { name: p.attach === 'original' ? name : `${stem}_발췌${count > 1 ? `_${no}` : ''}.pdf`, type: PDF_TYPE, dataUrl: toDataUrl(p.file, PDF_TYPE) } : null;
    const how = p.attach === 'slice' ? `작은 PDF ${sizeText(p.size)}` : p.attach === 'original' ? `원본 PDF ${sizeText(p.size)}` : '글자만';
    return {
      name, kind: 'pdf', total, no, count, pages: p.pageNos.length ? [p.pageNos[0], p.pageNos.at(-1)] : null, picked: p.textNos, chunks: null,
      text: p.text, chars: p.text.length, file, attach: p.attach,
      read: [`${no}/${count}부분`, p.pageNos.length ? `${pageSpan(p.pageNos)}쪽` : '', `글자 ${num(p.text.length)}자`, how].filter(Boolean).join(' · ').replace('부분 · ', '부분 — '),
    };
  });
  const picked = pieces.flatMap((p) => p.textNos);
  const chars = parts.reduce((a, p) => a + p.chars, 0) + Math.max(0, parts.filter((p) => p.chars).length - 1) * 2;
  const attached = parts.filter((p) => p.file);
  const one = count === 1 ? parts[0] : null;
  const how = one
    ? (one.attach === 'original' ? `원본 PDF 를 붙임(${sizeText(pieces[0].size)})` : one.attach === 'slice' ? `그 쪽들을 작은 PDF 로 붙임(${sizeText(pieces[0].size)})`
      : head ? '붙일 PDF 없음' : '글자만 실음(작은 PDF 를 만들지 못함)')
    : `${num(count)}부분으로 나눠 차례로 보냄(${attached.length === count ? '부분마다 그 쪽만 담은 PDF' : attached.length ? `${num(attached.length)}부분은 그 쪽만 담은 PDF, 나머지는 글자만` : '글자만'})`;
  const bits = [
    total ? `${num(total)}쪽` : '',
    head,
    head ? '' : `글자 ${num(chars)}자`,
    one && !head ? '한 번에 보냄' : '',
    how,
    head && textPages ? `글자가 든 ${num(textPages)}쪽은 글로도 실음` : '',
  ].filter(Boolean);
  return assemble({ name, kind: 'pdf', total, picked }, parts, warnings, `${name}: ${bits.join(' · ')}`);
}

/** PDF 의 재료 — 글자 층으로 쪽을 묶고 묶음마다 작은 PDF. 스캔본은 쪽 수로 묶는다. 크기로 거절하지 않는다. */
async function readPdf(name, bytes, eng, lim) {
  const warnings = [];
  let pages = [];
  let total = 0;
  let failed = '';
  try {
    const got = await eng.pdfText(bytes);
    pages = (got?.pages || []).map(tidyPage);
    total = Number(got?.total) || pages.length;
    if (pages.length < total) warnings.push(`앞 ${num(pages.length)}쪽만 읽었습니다(전체 ${num(total)}쪽)`);
  } catch (err) {
    failed = why(err);
  }
  const good = pages.filter(readable).length;
  const usable = !failed && pages.length > 0 && good / pages.length >= 0.3;
  // 묶음의 쪽 수 상한 — partPages 안에서, 원본 크기로 쪽당 바이트를 어림해 작은 PDF 가 대개 한 번에 한도 안에 들게(넘으면 pdfPieces 가 반으로 가른다).
  const pagesMax = (count) => Math.max(1, Math.min(lim.partPages, Math.floor((lim.attachBytesMax * 0.8) / Math.max(1, bytes.length / Math.max(1, count)))));

  if (usable) {
    const ranges = capRanges(splitPages(pages, { partChars: lim.partChars }), pagesMax(total || pages.length));
    const pieces = await pdfPieces(bytes, pages, ranges, eng, lim, warnings, (n) => !!pages[n - 1]);
    return pdfMaterial(name, total, pieces, { warnings });
  }

  // 글자 층이 없다(스캔본) 또는 뽑지 못했다 — 쪽 수로 가른다. 글자가 든 쪽이 조금이라도 있으면 그 부분의 글로도 싣는다.
  const what = failed ? `글자를 뽑지 못했습니다(${failed})` : '글자 층이 없는 PDF(스캔본)입니다';
  const head = failed ? '글자를 뽑지 못함' : '글자 층 없음(스캔본)';
  const slow = 'Claude 가 그림으로 읽어 느리고 표의 값을 틀릴 수 있습니다';
  let count = total || pages.length;
  if (!count) {
    try { count = Math.max(0, Math.floor(Number(await eng.pdfCount?.(bytes)) || 0)); } catch { count = 0; }
  }
  const withText = (n) => readable(pages[n - 1]);
  const textPages = span(1, Math.min(count, pages.length)).filter(withText).length;
  if (bytes.length <= lim.attachBytesMax) {
    // 원본이 한 부분에 든다 — 통째로 붙인다(쪽 번호가 원본 그대로라 LLM 이 보기 쉽다).
    warnings.push(`${what} — 원본 PDF 를 그대로 붙였습니다(${slow})`);
    const pageNos = span(1, count);
    const textNos = pageNos.filter(withText);
    const piece = { pageNos, textNos, text: pagesText(pages, textNos), file: bytes, attach: 'original', size: bytes.length };
    return pdfMaterial(name, count, [piece], { head, warnings, textPages });
  }
  if (!count) {
    warnings.push(`${what} — 쪽 수를 알 수 없어 나누지 못했고, 원본이 커서(${sizeText(bytes.length)}) 붙이지도 못했습니다(${mbText(lim.attachBytesMax)} 까지). 글자 층이 있는 PDF 로 다시 저장해 넣으세요`);
    return pdfMaterial(name, 0, [{ pageNos: [], textNos: [], text: '', file: null, attach: 'none', size: 0 }], { head, warnings });
  }
  warnings.push(`${what} — 원본이 커서(${sizeText(bytes.length)}) 쪽을 나눠 부분마다 그 쪽만 담은 PDF 를 붙였습니다(${slow})`);
  const all = pages.length >= count ? pages : [...pages, ...Array(count - pages.length).fill('')];
  const pieces = await pdfPieces(bytes, all, capRanges([[1, count]], pagesMax(count)), eng, lim, warnings, withText);
  if (!pieces.some((p) => p.file)) warnings.push('붙일 PDF 를 하나도 만들지 못했습니다 — 글자 층이 있는 PDF 로 다시 저장해 넣으세요');
  return pdfMaterial(name, count, pieces, { head, warnings, textPages });
}

/* ------------------------------------------------------------ 진짜 엔진 */

/** 고른 쪽(1부터)만 담은 새 PDF — pdf-lib. 암호가 걸린 PDF 는 load 가 던진다(ignoreEncryption:false). */
async function slicePdf(bytes, pageNos) {
  const { PDFDocument } = await import('../vendor/pdf-lib.esm.min.js');
  const src = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const count = src.getPageCount();
  const want = [...new Set(pageNos || [])].filter((n) => Number.isInteger(n) && n >= 1 && n <= count).sort((a, b) => a - b);
  if (!want.length) throw new Error('고른 쪽이 없습니다');
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(src, want.map((n) => n - 1))) out.addPage(page);
  return out.save();
}

/** 쪽 수 — pdf-lib(글자 층을 뽑지 못한 PDF 를 쪽 수로 나눌 때). */
async function countPdf(bytes) {
  const { PDFDocument } = await import('../vendor/pdf-lib.esm.min.js');
  return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
}

/**
 * 확장의 진짜 엔진 — 쓸 때 import() 한다(가져오기만으로는 아무것도 안 한다).
 *   pdfText(bytes)             → (await import('../doctext/browser.js')).pdfAllText(bytes, { maxPages: Infinity })  — 모든 쪽
 *   pdfSlice(bytes, pageNos)   → pdf-lib: PDFDocument.load(bytes, { ignoreEncryption: false }) → create() → copyPages → save() (Uint8Array)
 *   pdfCount(bytes)            → pdf-lib: getPageCount()
 *   officeText(bytes, name, o) → (await import('../src/officetext.js')).officeText(bytes, name, o)
 * pdf.js 는 사이드 패널(확장 페이지)에서 돈다 — 서비스 워커에서는 Worker 가 없어 돌지 않는다.
 * @returns {Engines}  Engines = { pdfText, pdfSlice, pdfCount, officeText }
 */
export function defaultEngines() {
  return {
    pdfText: async (bytes) => (await import('../doctext/browser.js')).pdfAllText(bytes, { maxPages: Infinity }),
    pdfSlice: (bytes, pageNos) => slicePdf(bytes, pageNos),
    pdfCount: (bytes) => countPdf(bytes),
    officeText: async (bytes, name, o) => (await import('../src/officetext.js')).officeText(bytes, name, o),
  };
}
