// 워드 양식 병합 — 내가 보낸 양식(docx)에 회신들의 본문을 한 파일로 모은다
// (2026-10-15 사용자 지정: "docx 파일이나 excel 양식으로 작성을 요청한 경우 받아서 병합까지 할 수 있는 기능").
//
//   stack(기본) — 양식의 본문을 [출처 문단(굵게, 다음 문단과 붙임) + 회신 i 의 본문 블록] × n 으로 바꾸고, 회신 사이에 쪽 나눔,
//                 양식의 구역 설정(body 끝의 sectPr)은 맨 끝에 한 번. 머리글·바닥글·스타일·번호는 양식 것을 쓴다.
//   rows        — 양식의 i번째 최상위 표마다 머리 행(w:tblHeader 가 붙은 앞쪽 행 수, 없으면 1) 아래에, 회신마다 출처 행(표 너비만큼
//                 gridSpan) + 그 회신의 같은 표에서 머리 뒤의 행들(빈 행·양식 그대로인 행은 뺀다)을 붙인다. 표 밖 문단은 양식 그대로.
//
// 회신의 본문은 회신 파일의 관계(rels)를 가리키는 것이 있어 그대로 옮기면 끊긴 참조가 된다 — 그래서 정리한다:
//   그림·개체(w:drawing·w:pict·w:object, 그것을 품은 mc:AlternateContent) → "[그림 생략]" 글(글상자면 그 안의 글을 "[글상자] 글" 로), 하이퍼링크는 안의 글만,
//   각주·미주·메모 참조와 책갈피·구역 설정(문단 안 sectPr 포함)·altChunk 는 지우고, 내용 컨트롤(w:sdt)은 sdtContent 안만 남긴다.
//   w14:paraId 같은 문단 번호는 회신마다 겹치니 뺀다. 회신의 뿌리에만 있는 xmlns 는 결과 뿌리에 더한다(접두어가 끊기지 않게).
// 회신은 양식의 사본이라 스타일·번호 id 가 같다고 본다 — 다르면 Word 가 기본 스타일로 보인다(README 의 한계).

import { unzip, replyProblem } from './zipread.js';
import { esc, unesc, attrAny, dropAttr, children, findAll, findFirst, rootOf, transform, textOf, sourceText, getXml, setXml, mainPartOf, packParts } from './xml.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const W_NS = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const PICTURE = '[그림 생략]';

/** 회신 본문에서 지우는 요소 — 다른 파트(메모·각주·머리글)를 가리키거나 id 가 겹치는 것. */
const DROP = new Set([
  'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'commentReference', 'footnoteReference', 'endnoteReference',
  'sectPr', 'sdtPr', 'sdtEndPr', 'altChunk', 'subDoc', 'control', 'permStart', 'permEnd',
]);
/** 이 안에서는 그림 자리를 문단으로 채운다(블록 자리). */
const BLOCK = new Set(['body', 'tc', 'txbxContent', 'hdr', 'ftr', 'footnote', 'endnote', 'comment', 'docPartBody']);
const PICTURE_RE = /<(?:[\w.-]+:)?(?:drawing|pict|object)\b/;

/* ------------------------------------------------------------ 이름공간 */

/** 뿌리 속성의 xmlns 선언 — 접두어('' 는 기본 이름공간) → URI. */
function nsMap(attrs) {
  const m = new Map();
  for (const x of String(attrs || '').matchAll(/(?:^|\s)xmlns(?::([\w.-]+))?\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) m.set(x[1] || '', unesc(x[2] ?? x[3]));
  return m;
}

/** WordprocessingML 에 묶인 접두어(빈 접두어 말고). 없으면 null — 그때는 'w' 를 새로 묶는다(속성에는 접두어가 있어야 해서). */
function wPrefixOf(attrs) {
  for (const [p, uri] of nsMap(attrs)) if (p && W_NS.has(uri)) return p;
  return null;
}

/** mc:Ignorable 속성(접두어는 MC 이름공간에 묶인 것) — { name, value } 또는 null. */
function ignorableOf(attrs) {
  const ns = nsMap(attrs);
  for (const [p, uri] of ns) {
    if (!p || uri !== MC_NS) continue;
    const m = new RegExp(`(?:^|\\s)${p}:Ignorable\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
    if (m) return { name: `${p}:Ignorable`, value: unesc(m[1] ?? m[2]) };
  }
  return null;
}

/**
 * 결과 뿌리의 여는 태그 — 양식 뿌리에 회신 뿌리들에만 있는 xmlns 를 더하고, mc:Ignorable 의 접두어도 합친다.
 * 같은 접두어가 다른 URI 에 묶여 있으면 양식 것을 두고 경고한다.
 */
function unionRoot(tRoot, replyRoots, extra, warnings) {
  const have = nsMap(tRoot.attrs);
  let attrs = tRoot.attrs;
  let add = '';
  const bind = (p, uri) => {
    have.set(p, uri);
    add += p ? ` xmlns:${p}="${esc(uri)}"` : ` xmlns="${esc(uri)}"`;
  };
  for (const [p, uri] of extra) if (!have.has(p)) bind(p, uri);
  let clash = false;
  for (const rr of replyRoots) {
    for (const [p, uri] of nsMap(rr.attrs)) {
      if (!have.has(p)) bind(p, uri);
      else if (have.get(p) !== uri) clash = true;
    }
  }
  if (clash) warnings.push('회신과 양식의 XML 접두어가 서로 달라 일부 회신 내용이 Word 에서 열리지 않을 수 있습니다.');
  const ign = ignorableOf(tRoot.attrs);
  const more = new Set();
  for (const rr of replyRoots) {
    const ri = ignorableOf(rr.attrs);
    if (ri) for (const p of ri.value.split(/\s+/)) if (p && have.has(p)) more.add(p);
  }
  if (ign) {
    const list = ign.value.split(/\s+/).filter(Boolean);
    const next = [...list, ...[...more].filter((p) => !list.includes(p))];
    if (next.length !== list.length) {
      attrs = attrs.replace(new RegExp(`(\\s${ign.name}\\s*=\\s*)(?:"[^"]*"|'[^']*')`), (all, head) => `${head}"${esc(next.join(' '))}"`);
    }
  } else if (more.size) {
    const mcp = [...have].find(([p, uri]) => p && uri === MC_NS)?.[0];
    if (mcp) add += ` ${mcp}:Ignorable="${esc([...more].join(' '))}"`;
  }
  return `<${tRoot.name}${attrs}${add}>`;
}

/* ------------------------------------------------------------ 읽기 */

/**
 * docx 를 읽는다 — 본문(document.xml)과 그 body 의 블록들(문단·표·그 밖), 맨 끝 구역 설정(sectPr), 다시 묶을 파트들.
 * @returns {Promise<{ xml: string, path: string, root, body, blocks: Array<{ kind: 'p'|'tbl'|'other', local: string, raw: string }>, sectPr: string, parts: Map<string, Uint8Array> }>}
 */
export async function readDocx(bytes) {
  const parts = await unzip(bytes);
  const path = mainPartOf(parts, 'word/document.xml');
  const xml = path ? getXml(parts, path) : null;
  const root = xml ? rootOf(xml) : null;
  if (!root || root.local !== 'document') throw new Error('워드(docx) 파일이 아닙니다 — 본문(document.xml)이 없습니다.');
  const body = children(xml, root.openEnd).find((e) => e.local === 'body');
  if (!body) throw new Error('워드 본문(w:body)이 없습니다 — 깨진 파일입니다.');
  const blocks = [];
  let sectPr = '';
  for (const k of body.self ? [] : children(xml, body.innerStart, body.innerEnd)) {
    if (k.local === 'sectPr') {
      sectPr = k.raw;   // body 바로 아래의 sectPr 은 마지막 구역의 설정(머리글·용지) — 끝에 한 번만 쓴다
      continue;
    }
    blocks.push({ kind: k.local === 'p' ? 'p' : k.local === 'tbl' ? 'tbl' : 'other', local: k.local, raw: k.raw });
  }
  return { xml, path, root, body, blocks, sectPr, parts };
}

/* ------------------------------------------------------------ 정리 */

/**
 * 그림·도형 안 글상자(txbxContent)의 글 — 양식의 글상자에 쓴 답을 잃지 않으려고. mc:AlternateContent 는 Choice 와 Fallback 에
 * 같은 글상자가 두 번 들어 있으니 앞의 것(Choice) 하나만 본다. 문단은 ' / ' 로 잇는다.
 */
function boxText(raw) {
  const scope = findFirst(raw, 'Choice') || { raw };
  return findAll(scope.raw, 'txbxContent')
    .flatMap((b) => findAll(b.inner, 'p').map((p) => textOf(p.inner).replace(/\s+/g, ' ').trim()))
    .filter(Boolean)
    .join(' / ');
}

/** 그림 자리에 넣을 글 — 런 안이면 w:t, 블록 자리면 문단, 그 밖(문단 안)이면 런. 글상자에 글이 있으면 "[글상자] 글". */
function picture(W, ctx, box = '') {
  const t = `<${W}t xml:space="preserve">${box ? `[글상자] ${esc(box)}` : PICTURE}</${W}t>`;
  if (ctx === 'r') return t;
  if (ctx == null || BLOCK.has(ctx)) return `<${W}p><${W}r>${t}</${W}r></${W}p>`;
  return `<${W}r>${t}</${W}r>`;
}

/**
 * 회신의 본문 조각을 정리한다(위 머리 주석의 규칙). stat 에 바꾼 그림 수·지운 각주/메모 참조 수를 센다.
 * @param {string} xml 조각(블록들, 또는 표의 행들)
 * @param {string} W 결과에서 쓰는 w 접두어('w:')
 * @param {string} context 조각이 놓이는 자리의 로컬 이름(body·tbl)
 */
export function cleanBlocks(xml, W, context = 'body', stat = { pictures: 0, boxes: 0, notes: 0, comments: 0 }) {
  const bump = (k) => { stat[k] = (stat[k] || 0) + 1; };
  return transform(xml, (e) => {
    const l = e.local;
    if (DROP.has(l)) {
      if (l === 'footnoteReference' || l === 'endnoteReference') bump('notes');
      else if (l === 'commentReference') bump('comments');
      return 'drop';
    }
    if (l === 'hyperlink' || l === 'sdt' || l === 'sdtContent') return 'unwrap';
    if (l === 'drawing' || l === 'pict' || l === 'object' || l === 'AlternateContent') {
      const el = findFirst(e.xml, l, e.start);
      if (!el || (l === 'AlternateContent' && !PICTURE_RE.test(el.raw))) return null;   // 그림 없는 AlternateContent(글자 효과 등)는 그대로
      const box = boxText(el.raw);
      bump(box ? 'boxes' : 'pictures');
      return { replace: picture(W, e.context, box) };
    }
    if ((l === 'p' || l === 'tr') && /\s[\w.-]+:(?:paraId|textId)\s*=/.test(e.attrs)) {
      return { tag: `<${e.name}${dropAttr(dropAttr(e.attrs, 'paraId', true), 'textId', true)}${e.self ? '/' : ''}>` };
    }
    return null;
  }, { context });
}

/* ------------------------------------------------------------ 표 */

/** 표 하나를 나눈다 — 여는 태그, 행 앞의 것(tblPr·tblGrid), 행들, 행 뒤의 것, 격자 열 수. */
function splitTable(raw) {
  const root = rootOf(raw);
  const kids = children(raw, root.openEnd);
  const firstTr = kids.findIndex((k) => k.local === 'tr');
  const rows = kids.filter((k) => k.local === 'tr');
  const lastTr = kids.length - 1 - [...kids].reverse().findIndex((k) => k.local === 'tr');
  const before = (firstTr < 0 ? kids : kids.slice(0, firstTr)).map((k) => k.raw).join('');
  const after = firstTr < 0 ? '' : kids.slice(lastTr + 1).filter((k) => k.local !== 'tr').map((k) => k.raw).join('');
  const grid = kids.find((k) => k.local === 'tblGrid');
  let gridCols = grid ? children(raw, grid.innerStart, grid.innerEnd).filter((k) => k.local === 'gridCol').length : 0;
  if (!gridCols) {
    for (const tr of rows) {
      let n = 0;
      for (const tc of children(raw, tr.innerStart, tr.innerEnd)) {
        if (tc.local !== 'tc') continue;
        const tcPr = children(raw, tc.innerStart, tc.innerEnd).find((k) => k.local === 'tcPr');
        const span = tcPr ? children(raw, tcPr.innerStart, tcPr.innerEnd).find((k) => k.local === 'gridSpan') : null;
        n += Math.max(1, Number(span ? attrAny(span.attrs, 'val') : 1) || 1);
      }
      gridCols = Math.max(gridCols, n);
    }
  }
  return { open: raw.slice(root.start, root.openEnd), name: root.name, before, rows, after, gridCols: Math.max(1, gridCols) };
}

/** 머리 행인지 — trPr 에 w:tblHeader(값이 0·false·off 가 아닌 것). */
function isHeaderRow(raw) {
  const tr = rootOf(raw);
  const trPr = children(raw, tr.openEnd).find((k) => k.local === 'trPr');
  if (!trPr) return false;
  const h = children(raw, trPr.innerStart, trPr.innerEnd).find((k) => k.local === 'tblHeader');
  return !!h && !/^(0|false|off)$/i.test(attrAny(h.attrs, 'val'));
}

/** 표의 머리 행 수 — 앞에서부터 tblHeader 가 이어진 행 수, 없으면 1. 숫자를 주면 그것(행 수를 넘지 않게). */
export function tableHeaderRows(rows, fixed = null) {
  if (fixed) return Math.min(fixed, rows.length);
  let n = 0;
  while (n < rows.length && isHeaderRow(rows[n].raw)) n++;
  return Math.min(Math.max(n, 1), rows.length);
}

/** 행의 글 — 칸마다 글을 이어 탭으로. 견주기·빈 행 가리기에 쓴다. */
function rowText(raw) {
  const tr = rootOf(raw);
  return children(raw, tr.openEnd).filter((k) => k.local === 'tc').map((tc) => textOf(tc.inner).replace(/\s+/g, ' ').trim()).join('\t');
}

/* ------------------------------------------------------------ 병합 */

/** headerRows 옵션 — 'auto'·빈 값은 null(자동), 1 이상의 정수만 숫자로. */
function fixedHeader(h) {
  if (h == null || h === '' || h === 'auto') return null;
  const n = Math.floor(Number(h));
  return n >= 1 ? n : null;
}

const sourceRun = (W, text) => `<${W}r><${W}rPr><${W}b/></${W}rPr><${W}t xml:space="preserve">${esc(text)}</${W}t></${W}r>`;
const sourcePara = (W, text) => `<${W}p><${W}pPr><${W}keepNext/></${W}pPr>${sourceRun(W, text)}</${W}p>`;
const pageBreak = (W) => `<${W}p><${W}r><${W}br ${W}type="page"/></${W}r></${W}p>`;
const sourceRow = (W, n, text) => `<${W}tr><${W}tc><${W}tcPr><${W}tcW ${W}w="0" ${W}type="auto"/>${n > 1 ? `<${W}gridSpan ${W}val="${n}"/>` : ''}`
  + `<${W}shd ${W}val="clear" ${W}color="auto" ${W}fill="F2F2F2"/></${W}tcPr>${sourcePara(W, text)}</${W}tc></${W}tr>`;

/**
 * 워드 양식 병합.
 * @param {Uint8Array|ArrayBuffer} template 내가 보낸 양식
 * @param {Array<{ bytes, source: { org, name, address, date }, name?: string }>} replies 회신 첨부들(차례대로)
 * @param {{ mode?: 'stack'|'rows', headerRows?: 'auto'|number, sourceLabel?: string }} [opts]
 * @returns {Promise<{ bytes: Uint8Array, report: { merged: number, rows?: number, mode: string, skipped: Array<{ source, label, reason }>, warnings: string[] } }>}
 */
export async function mergeDocx(template, replies = [], { mode = 'stack', headerRows = 'auto', sourceLabel = '출처' } = {}) {
  const report = { merged: 0, mode: mode === 'rows' ? 'rows' : 'stack', skipped: [], warnings: [] };
  let T;
  try {
    T = await readDocx(template);
  } catch (e) {
    throw new Error(`양식 파일(docx)을 읽지 못했습니다 — ${e.message}`);
  }
  const reps = [];
  for (const rep of replies || []) {
    const source = rep?.source || {};
    const label = sourceText(source) || '(보낸 사람 모름)';
    const why = replyProblem(rep, 'docx');
    if (why) {
      report.skipped.push({ source, label, reason: why });
      continue;
    }
    try {
      reps.push({ doc: await readDocx(rep.bytes), source, label, stat: { pictures: 0, boxes: 0, notes: 0, comments: 0 } });
    } catch (e) {
      report.skipped.push({ source, label, reason: e.message });
    }
  }
  report.merged = reps.length;
  if (!reps.length) {
    report.warnings.push('합칠 회신이 없어 양식을 그대로 돌려줍니다.');
    return { bytes: packParts(T.parts), report };
  }

  // 결과에서 새로 쓰는 요소의 w 접두어 — 양식이 기본 이름공간만 쓰면 'w' 를 새로 묶는다.
  let wp = wPrefixOf(T.root.attrs);
  const extra = new Map();
  if (!wp) {
    wp = nsMap(T.root.attrs).has('w') ? 'w0' : 'w';
    extra.set(wp, 'http://schemas.openxmlformats.org/wordprocessingml/2006/main');
  }
  const W = `${wp}:`;

  const tTables = T.blocks.filter((b) => b.kind === 'tbl');
  let inner;
  if (report.mode === 'rows' && !tTables.length) {
    report.warnings.push('양식에 표가 없어 쌓기(stack)로 합쳤습니다.');
    report.mode = 'stack';
  }
  if (report.mode === 'stack') {
    const chunks = [];
    reps.forEach((rep, i) => {
      if (i) chunks.push(pageBreak(W));
      chunks.push(sourcePara(W, `${sourceLabel}: ${rep.label}`));
      const body = cleanBlocks(rep.doc.blocks.map((b) => b.raw).join(''), W, 'body', rep.stat);
      if (!rep.doc.blocks.length) report.warnings.push(`${rep.label}: 본문이 비어 있습니다.`);
      chunks.push(body);
    });
    // 본문이 표로 끝나면 Word 가 끝 문단을 바란다 — 빈 문단 하나.
    const last = reps[reps.length - 1].doc.blocks.at(-1);
    if (last && last.kind === 'tbl') chunks.push(`<${W}p/>`);
    inner = chunks.join('');
  } else {
    const fixed = fixedHeader(headerRows);
    let rowsAdded = 0;
    const tParts = tTables.map((b) => splitTable(b.raw));
    const rParts = reps.map((rep) => rep.doc.blocks.filter((b) => b.kind === 'tbl').map((b) => splitTable(b.raw)));
    const merged = tParts.map((tp, ti) => {
      const hdr = tableHeaderRows(tp.rows, fixed);
      const tText = tp.rows.map((r) => rowText(cleanBlocks(r.raw, W, 'tbl')));
      const out = [tp.open, tp.before, ...tp.rows.slice(0, hdr).map((r) => r.raw)];
      reps.forEach((rep, ri) => {
        const rt = rParts[ri][ti];
        if (!rt) {
          report.warnings.push(`${rep.label}: ${ti + 1}번째 표가 없습니다.`);
          return;
        }
        const add = [];
        rt.rows.forEach((r, j) => {
          if (j < hdr) return;
          const clean = cleanBlocks(r.raw, W, 'tbl', rep.stat);
          const text = rowText(clean);
          if (!text.replace(/\t/g, '').trim()) return;                       // 빈 행
          if (tText[j] && tText[j].replace(/\t/g, '').trim() && tText[j] === text) return;   // 양식 그대로인 행(예시·합계)
          add.push(clean);
        });
        if (!add.length) {
          report.warnings.push(`${rep.label}: ${ti + 1}번째 표에 채운 행이 없습니다.`);
          return;
        }
        out.push(sourceRow(W, tp.gridCols, `${sourceLabel}: ${rep.label}`), ...add);
        rowsAdded += add.length;
      });
      out.push(tp.after, `</${tp.name}>`);
      return out.join('');
    });
    let k = 0;
    inner = T.blocks.map((b) => (b.kind === 'tbl' ? merged[k++] : b.raw)).join('');
    report.rows = rowsAdded;
  }
  for (const rep of reps) {
    const s = rep.stat;
    if (s.pictures) report.warnings.push(`${rep.label}: 그림·개체 ${s.pictures}개는 '${PICTURE}' 로 바꿨습니다.`);
    if (s.boxes) report.warnings.push(`${rep.label}: 글상자 ${s.boxes}개는 글만 '[글상자] …' 로 남겼습니다.`);
    if (s.notes) report.warnings.push(`${rep.label}: 각주·미주 ${s.notes}개는 뺐습니다.`);
    if (s.comments) report.warnings.push(`${rep.label}: 메모 ${s.comments}개는 뺐습니다.`);
  }

  const { xml, root, body } = T;
  const rootOpen = unionRoot(root, reps.map((r) => r.doc.root), extra, report.warnings);
  const bodyOpen = `<${body.name}${body.attrs}>`;
  const out = xml.slice(0, root.start) + rootOpen + xml.slice(root.openEnd, body.start) + bodyOpen + inner + T.sectPr + `</${body.name}>` + xml.slice(body.end);
  setXml(T.parts, T.path, out);
  return { bytes: packParts(T.parts), report };
}
