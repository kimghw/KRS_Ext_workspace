// 엑셀 양식 병합 — 내가 보낸 양식(xlsx)에 회신들이 채운 행을 머리 아래로 차례로 쌓아 한 파일로 만든다
// (2026-10-15 사용자 지정: "docx 파일이나 excel 양식으로 작성을 요청한 경우 받아서 병합까지 할 수 있는 기능").
//
//   시트마다: 머리 행 수(H)를 정하고 → 회신마다 같은 이름의 시트(없으면 같은 차례)에서 H 뒤의 행 중 사람이 쓴 값(수식 아닌 칸)이
//   하나라도 있는 행을 차례로 쌓는다. 양식의 같은 자리 행과 똑같은 행(손대지 않은 안내·예시·합계)은 건너뛴다.
//   회신 칸은 글을 풀어 inlineStr 로(공유 문자열 번호는 회신 것이라 양식에서 뜻이 없다), 숫자는 <v> 그대로, 수식은 버리고 캐시 값만,
//   서식 번호(s)는 회신의 cellXfs 수가 양식과 같을 때만 남긴다. 마지막 머리 행 오른쪽에 '출처' 열 — 행마다 "org · name <address> · date".
//   <dimension> 은 새로, <mergeCells> 는 머리 안에 든 것 + 옮길 수 있는 회신의 병합만, 표(tableParts·xl/tables/*)와 calcChain 은 뺀다.
//   숨긴 시트·합칠 행이 없는 시트는 양식 그대로 둔다. 옛 .xls·깨진 파일은 report.skipped 에 까닭과 함께.
//
// 머리 자동(H): headerRowsOf(양식만 보고 첫 비지 않은 행부터 이어진 행) 뒤로, 모든 회신이 양식과 똑같이 둔 행을 더 머리로 친다
// — "제목 · 빈 줄 · 열 이름" 같은 양식에서 열 이름 행이 회신마다 되풀이되지 않게. 숫자를 주면 그대로 쓴다.
// 손대지 않은 파트는 바이트 그대로 다시 묶는다(xml.js packParts — [Content_Types].xml 이 맨 앞).

import { unzip, replyProblem } from './zipread.js';
import {
  esc, unesc, attr, relIdOf, dropAttr, children, rootOf, textOf, colLetter, parseRef, parseRange, rangeText, sourceText,
  getXml, setXml, readRels, mainPartOf, removeParts, packParts, partName,
} from './xml.js';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 회신 행에서 옮겨 적는 행 속성 — 서식 번호(s·customFormat)는 서식이 맞을 때만 따로 붙인다. 접두어 붙은 속성(x14ac:…)은 뺀다. */
const ROW_ATTRS = ['ht', 'customHeight', 'hidden', 'outlineLevel', 'collapsed', 'thickTop', 'thickBot'];
/** CT_Worksheet 에서 mergeCells 뒤에 오는 요소들 — 새 mergeCells 는 이들 중 처음 것 앞에 넣는다. */
const AFTER_MERGE = new Set([
  'phoneticPr', 'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter',
  'rowBreaks', 'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF',
  'picture', 'oleObjects', 'controls', 'webPublishItems', 'extLst',
]);
/** 출처 열의 너비(글자 수) — 양식에 그 열의 너비가 없을 때만. */
const SOURCE_WIDTH = 40;

/* ------------------------------------------------------------ 읽기 */

/** 칸의 글 — 공유 문자열은 그 책의 목록으로 풀고, inlineStr 은 <is> 의 글, 그 밖은 <v>. */
function cellTextOf(t, v, is, sst) {
  if (t === 's') {
    const i = Number(v);
    return Number.isInteger(i) && i >= 0 && i < sst.length ? sst[i] : '';
  }
  if (t === 'inlineStr') return is ?? v ?? '';
  return v ?? '';
}

/** 시트 XML 을 훑는다 — 맨 위 요소들(top), 행·칸, 병합, dimension. */
function parseSheet(xml, sst) {
  const root = rootOf(xml);
  const top = root ? children(xml, root.openEnd) : [];
  const sd = top.find((e) => e.local === 'sheetData') || null;
  const rows = [];
  if (sd && !sd.self) {
    let prevR = 0;
    for (const re of children(xml, sd.innerStart, sd.innerEnd)) {
      if (re.local !== 'row') continue;
      const r = Number(attr(re.attrs, 'r')) || prevR + 1;   // r 을 빼먹은 도구도 있다 — 그러면 앞 행 + 1
      prevR = r;
      const cells = [];
      const extra = [];
      let prevC = 0;
      if (!re.self) {
        for (const c of children(xml, re.innerStart, re.innerEnd)) {
          if (c.local !== 'c') {
            extra.push(c.raw);
            continue;
          }
          const ref = attr(c.attrs, 'r');
          const p = parseRef(ref);
          const col = p ? p.col : prevC + 1;
          prevC = col;
          const t = attr(c.attrs, 't');
          let v = null;
          let f = null;
          let is = null;
          if (!c.self) {
            for (const k of children(xml, c.innerStart, c.innerEnd)) {
              if (k.local === 'v') v = unesc(k.inner);
              else if (k.local === 'f') f = unesc(k.inner);   // 공유 수식의 딸린 칸은 '' — 그래도 수식 칸이다
              else if (k.local === 'is') is = textOf(k.inner);
            }
          }
          cells.push({ ref: ref || `${colLetter(col)}${r}`, col, t, s: attr(c.attrs, 's'), v, is, f, text: cellTextOf(t, v, is, sst), raw: c.raw });
        }
      }
      rows.push({ r, name: re.name, attrs: re.attrs, cells, extra: extra.join(''), raw: re.raw });
    }
  }
  const mc = top.find((e) => e.local === 'mergeCells');
  const mergeCells = mc ? children(xml, mc.innerStart, mc.innerEnd).filter((e) => e.local === 'mergeCell').map((e) => attr(e.attrs, 'ref')).filter(Boolean) : [];
  const dim = top.find((e) => e.local === 'dimension');
  return { root, top, sheetData: sd, rows, mergeCells, dimension: dim ? attr(dim.attrs, 'ref') : '' };
}

/**
 * xlsx 를 읽는다 — 시트 차례·이름·숨김, 행과 칸(공유 문자열을 푼 글 text 까지), 병합, 서식 수, 그리고 다시 묶을 파트들.
 * @returns {Promise<{ sheets: Array<{ name, path, xml, index, worksheet, hidden, state, rows, mergeCells, dimension }>, sharedStrings: string[], cellXfsCount: number, parts: Map<string, Uint8Array>, workbook: string }>}
 */
export async function readXlsx(bytes) {
  const parts = await unzip(bytes);
  const wbPath = mainPartOf(parts, 'xl/workbook.xml');
  const wbXml = wbPath ? getXml(parts, wbPath) : null;
  if (!wbXml || !/<(?:[\w.-]+:)?workbook\b/.test(wbXml)) throw new Error('엑셀(xlsx) 파일이 아닙니다 — 통합 문서(workbook.xml)가 없습니다.');
  const rels = readRels(parts, wbPath);
  const relOf = (re) => rels.find((r) => !r.external && re.test(r.type));
  const sstRel = relOf(/\/sharedStrings$/);
  const sstXml = sstRel ? getXml(parts, sstRel.target) : null;
  const sharedStrings = [];
  if (sstXml) {
    const root = rootOf(sstXml);
    for (const si of root ? children(sstXml, root.openEnd) : []) if (si.local === 'si') sharedStrings.push(textOf(si.inner));
  }
  const stRel = relOf(/\/styles$/);
  const stXml = stRel ? getXml(parts, stRel.target) : null;
  let cellXfsCount = 0;
  if (stXml) {
    const root = rootOf(stXml);
    const xfs = (root ? children(stXml, root.openEnd) : []).find((e) => e.local === 'cellXfs');
    if (xfs) cellXfsCount = children(stXml, xfs.innerStart, xfs.innerEnd).filter((e) => e.local === 'xf').length;
  }
  const wbRoot = rootOf(wbXml);
  const sheetsEl = (wbRoot ? children(wbXml, wbRoot.openEnd) : []).find((e) => e.local === 'sheets');
  const relById = new Map(rels.map((r) => [r.id, r]));
  const sheets = [];
  for (const s of sheetsEl ? children(wbXml, sheetsEl.innerStart, sheetsEl.innerEnd) : []) {
    if (s.local !== 'sheet') continue;
    const rel = relById.get(relIdOf(s.attrs));
    const state = attr(s.attrs, 'state');
    const path = rel && !rel.external ? partName(parts, rel.target) : '';
    const worksheet = !!(path && /\/worksheet$/.test(rel.type));
    const xml = worksheet ? getXml(parts, path) : null;
    const parsed = xml ? parseSheet(xml, sharedStrings) : { rows: [], mergeCells: [], dimension: '', top: [], sheetData: null, root: null };
    sheets.push({
      name: attr(s.attrs, 'name'), path, xml, index: sheets.length, worksheet: worksheet && xml != null,
      hidden: /^(hidden|veryHidden)$/i.test(state), state, ...parsed,
    });
  }
  return { sheets, sharedStrings, cellXfsCount, parts, workbook: wbPath, rels };
}

/* ------------------------------------------------------------ 행 가리기 */

/** 사람이 쓴 값(수식 아닌 칸의 글)이 하나라도 있는 행 — 수식만 있는 행(금액 = 수량 × 단가 같은 틀)은 빈 행으로 본다. */
function hasLiteral(row) {
  return !!row && row.cells.some((c) => c.f === null && String(c.text).trim() !== '');
}

/** 행을 견주는 열쇠 — 칸마다 "열:값", 수식 칸은 "열:=수식"(캐시 값이 달라도 같은 수식이면 같다). */
function rowKey(row) {
  if (!row) return '';
  const out = [];
  for (const c of row.cells) {
    const x = c.f !== null ? `=${c.f}` : String(c.text).trim();
    if (x !== '' && x !== '=') out.push(`${c.col}:${x}`);
  }
  return out.join('\u0001');
}

/**
 * 양식 시트의 머리 행 수 — 첫 비지 않은 행부터 이어서 비지 않은 행의 끝 행 번호(최소 1). 비지 않음 = 수식 아닌 칸에 글이 있음.
 * 1행부터 차 있으면 "1행부터 연속해서 비어 있지 않은 행 수" 와 같다. 앞의 빈 행(B2 에서 시작하는 표)은 머리에 넣는다.
 */
export function headerRowsOf(sheet) {
  const lit = new Set((sheet?.rows || []).filter(hasLiteral).map((r) => r.r));
  if (!lit.size) return 1;
  let r = Math.min(...lit);
  while (lit.has(r + 1)) r++;
  return Math.max(1, r);
}

const normName = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** 회신에서 양식 시트에 맞는 시트 — 같은 이름(대소문자·공백 무시까지), 없으면 같은 차례(그 자리 시트가 다른 양식 시트의 이름이 아니면). */
function matchSheet(book, ts, templateNames) {
  const ws = book.sheets.filter((s) => s.worksheet);
  const byName = ws.find((s) => s.name === ts.name) || ws.find((s) => normName(s.name) === normName(ts.name));
  if (byName) return { sheet: byName, byIndex: false };
  const at = book.sheets[ts.index];
  if (at && at.worksheet && !templateNames.has(normName(at.name))) return { sheet: at, byIndex: true };
  return null;
}

/** headerRows 옵션 — 'auto'·빈 값은 null(자동), 1 이상의 정수만 숫자로. */
function fixedHeader(h) {
  if (h == null || h === '' || h === 'auto') return null;
  const n = Math.floor(Number(h));
  return n >= 1 ? n : null;
}

/* ------------------------------------------------------------ 쓰기 */

const inlineCell = (P, ref, sAttr, text) => `<${P}c r="${ref}"${sAttr} t="inlineStr"><${P}is><${P}t xml:space="preserve">${esc(text)}</${P}t></${P}is></${P}c>`;

/** 회신 칸 하나를 새 행 번호로 — 글은 inlineStr, 숫자·참거짓·오류·날짜는 <v> 그대로, 수식은 버리고 캐시 값만. 빈 칸은 서식이 남을 때만. */
function cellXml(c, newR, keepStyle, P) {
  const ref = `${colLetter(c.col)}${newR}`;
  const sAttr = keepStyle && c.s !== '' ? ` s="${esc(c.s)}"` : '';
  const empty = sAttr ? `<${P}c r="${ref}"${sAttr}/>` : '';
  if (c.t === 's' || c.t === 'inlineStr' || c.t === 'str') return c.text === '' ? empty : inlineCell(P, ref, sAttr, c.text);
  if (c.v == null || c.v === '') return empty;
  const tAttr = c.t === 'b' || c.t === 'e' || c.t === 'd' ? ` t="${c.t}"` : '';
  return `<${P}c r="${ref}"${sAttr}${tAttr}><${P}v>${esc(c.v)}</${P}v></${P}c>`;
}

/** 편집(자리 바꾸기)들을 뒤에서부터 적용 — 자리가 서로 겹치지 않게 만든 것들이다. */
function applyEdits(xml, edits) {
  let out = xml;
  for (const e of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/**
 * 양식 시트 하나에 쌓은 행들을 넣어 새 시트 XML 을 만든다. 표 파트 경로들은 tables 에 담아 돌려준다(호출한 쪽이 묶음에서 뺀다).
 */
function buildSheet(ts, H, stacked, merges, srcCol, sourceHeader, parts) {
  const xml = ts.xml;
  const sd = ts.sheetData;
  const P = sd.prefix ? `${sd.prefix}:` : '';
  const srcL = colLetter(srcCol);
  const edits = [];

  // 머리 행들 — 양식 그대로, 마지막 머리 행(H)에만 출처 칸을 끼운다(spans 는 맞지 않게 되니 뺀다).
  const out = [];
  let maxCol = srcCol;
  let haveH = false;
  for (const row of ts.rows) {
    if (row.r > H) continue;
    for (const c of row.cells) maxCol = Math.max(maxCol, c.col);
    if (row.r !== H) {
      out.push({ r: row.r, xml: row.raw });
      continue;
    }
    haveH = true;
    const at = row.cells.find((c) => c.col === srcCol);
    const left = row.cells.find((c) => c.col === srcCol - 1);
    const s = at?.s || left?.s || '';
    const cell = inlineCell(P, `${srcL}${H}`, s ? ` s="${esc(s)}"` : '', sourceHeader);
    const cells = [
      ...row.cells.filter((c) => c.col < srcCol).map((c) => c.raw),
      cell,
      ...row.cells.filter((c) => c.col > srcCol).map((c) => c.raw),
    ].join('');
    out.push({ r: row.r, xml: `<${row.name}${dropAttr(row.attrs, 'spans')}>${cells}${row.extra}</${row.name}>` });
  }
  if (!haveH) out.push({ r: H, xml: `<${P}row r="${H}">${inlineCell(P, `${srcL}${H}`, '', sourceHeader)}</${P}row>` });
  out.sort((a, b) => a.r - b.r);

  // 쌓은 행들 — H+1 부터 차례로 번호를 다시 매긴다.
  let newR = H;
  for (const { m, row } of stacked) {
    newR++;
    const keep = m.rep.keepStyle;
    let attrs = ` r="${newR}"`;
    for (const a of ROW_ATTRS) {
      const v = attr(row.attrs, a);
      if (v !== '') attrs += ` ${a}="${esc(v)}"`;
    }
    if (keep) {
      for (const a of ['s', 'customFormat']) {
        const v = attr(row.attrs, a);
        if (v !== '') attrs += ` ${a}="${esc(v)}"`;
      }
    }
    const cells = row.cells.filter((c) => c.col < srcCol).map((c) => cellXml(c, newR, keep, P)).join('');
    const left = keep ? row.cells.find((c) => c.col === srcCol - 1) : null;
    const src = inlineCell(P, `${srcL}${newR}`, left?.s ? ` s="${esc(left.s)}"` : '', m.rep.label);
    out.push({ r: newR, xml: `<${P}row${attrs}>${cells}${src}</${P}row>` });
  }
  const lastRow = newR;
  const sheetDataXml = `${sd.open}${out.map((x) => x.xml).join('')}</${sd.name}>`;

  // 출처 열 너비 — 양식의 <cols> 가 그 열을 덮지 않을 때만 더한다(없으면 <cols> 를 새로 sheetData 앞에).
  const cols = ts.top.find((e) => e.local === 'cols');
  const colTag = (p) => `<${p}col min="${srcCol}" max="${srcCol}" width="${SOURCE_WIDTH}" customWidth="1"/>`;
  let colsBefore = '';
  if (cols && !cols.self) {
    const list = children(xml, cols.innerStart, cols.innerEnd).filter((e) => e.local === 'col');
    const covered = list.some((c) => Number(attr(c.attrs, 'min')) <= srcCol && srcCol <= Number(attr(c.attrs, 'max')));
    if (!covered) {
      const cp = cols.prefix ? `${cols.prefix}:` : '';
      const next = list.find((c) => Number(attr(c.attrs, 'min')) > srcCol);
      const at = next ? next.start : cols.innerEnd;
      edits.push({ start: at, end: at, text: colTag(cp) });
    }
  } else if (!cols) {
    colsBefore = `<${P}cols>${colTag(P)}</${P}cols>`;
  }
  edits.push({ start: sd.start, end: sd.end, text: colsBefore + sheetDataXml });

  // dimension — 쓴 범위 전체.
  const dim = ts.top.find((e) => e.local === 'dimension');
  if (dim) {
    const ref = rangeText({ c1: 1, r1: 1, c2: maxCol, r2: Math.max(lastRow, 1) });
    edits.push({ start: dim.start, end: dim.end, text: `<${dim.name}${dropAttr(dim.attrs, 'ref')} ref="${ref}"/>` });
  }

  // mergeCells — 머리 안에 완전히 든 양식 것 + 옮길 수 있는 회신 것. 하나도 없으면 요소째 뺀다(빈 mergeCells 는 스키마에 어긋난다).
  const keepMerges = ts.mergeCells.filter((ref) => {
    const g = parseRange(ref);
    return g && g.r2 <= H;
  });
  const allMerges = [...keepMerges, ...merges];
  const mc = ts.top.find((e) => e.local === 'mergeCells');
  const mp = mc?.prefix ? `${mc.prefix}:` : P;
  const mcXml = allMerges.length ? `<${mp}mergeCells count="${allMerges.length}">${allMerges.map((r) => `<${mp}mergeCell ref="${esc(r)}"/>`).join('')}</${mp}mergeCells>` : '';
  if (mc) edits.push({ start: mc.start, end: mc.end, text: mcXml });
  else if (mcXml) {
    const after = ts.top.find((e) => e.start > sd.start && AFTER_MERGE.has(e.local));
    const at = after ? after.start : xml.lastIndexOf(`</${ts.root.name}`);
    edits.push({ start: at, end: at, text: mcXml });
  }

  // 표(tableParts) — 범위가 맞지 않게 되므로 뺀다. 표 파트 경로는 돌려줘서 묶음에서 지운다(관계·Override 까지).
  const tables = [];
  const tp = ts.top.find((e) => e.local === 'tableParts');
  if (tp) {
    const rels = readRels(parts, ts.path);
    for (const t of children(xml, tp.innerStart, tp.innerEnd)) {
      if (t.local !== 'tablePart') continue;
      const rel = rels.find((r) => r.id === relIdOf(t.attrs));
      if (rel && !rel.external) tables.push(rel.target);
    }
    edits.push({ start: tp.start, end: tp.end, text: '' });
  }
  return { xml: applyEdits(xml, edits), tables, lastRow };
}

/**
 * 엑셀 양식 병합.
 * @param {Uint8Array|ArrayBuffer} template 내가 보낸 양식
 * @param {Array<{ bytes: Uint8Array|ArrayBuffer, source: { org, name, address, date }, name?: string }>} replies 회신 첨부들(차례대로 쌓는다). name 은 파일 이름(있으면 .xls 를 이름으로도 가린다)
 * @param {{ headerRows?: 'auto'|number, sourceHeader?: string }} [opts]
 * @returns {Promise<{ bytes: Uint8Array, report: { merged: number, rows: number, skipped: Array<{ source, label, reason }>, warnings: string[], sheets: Array<{ name, headerRows, rows, sourceCol }> } }>}
 */
export async function mergeXlsx(template, replies = [], { headerRows = 'auto', sourceHeader = '출처' } = {}) {
  const report = { merged: 0, rows: 0, skipped: [], warnings: [], sheets: [] };
  let T;
  try {
    T = await readXlsx(template);
  } catch (e) {
    throw new Error(`양식 파일(xlsx)을 읽지 못했습니다 — ${e.message}`);
  }
  const fixedH = fixedHeader(headerRows);
  const reps = [];
  for (const rep of replies || []) {
    const source = rep?.source || {};
    const label = sourceText(source) || '(보낸 사람 모름)';
    const why = replyProblem(rep, 'xlsx');
    if (why) {
      report.skipped.push({ source, label, reason: why });
      continue;
    }
    try {
      const book = await readXlsx(rep.bytes);
      reps.push({ book, source, label, keepStyle: book.cellXfsCount === T.cellXfsCount });
    } catch (e) {
      report.skipped.push({ source, label, reason: e.message });
    }
  }
  report.merged = reps.length;
  for (const r of reps) if (!r.keepStyle) report.warnings.push(`${r.label}: 서식 목록이 양식과 달라 칸 서식을 뺐습니다(날짜가 숫자로 보일 수 있습니다).`);

  const parts = T.parts;
  const templateNames = new Set(T.sheets.map((s) => normName(s.name)));
  const dropTables = [];
  let changed = false;
  for (const ts of T.sheets) {
    if (!ts.worksheet || ts.hidden || !ts.sheetData) continue;   // 숨긴 시트(목록 등)·차트 시트는 그대로
    const matched = [];
    for (const rep of reps) {
      const hit = matchSheet(rep.book, ts, templateNames);
      if (!hit) {
        report.warnings.push(`${rep.label}: '${ts.name}' 시트에 맞는 시트가 없습니다.`);
        continue;
      }
      if (hit.byIndex) report.warnings.push(`${rep.label}: '${ts.name}' 시트가 없어 ${ts.index + 1}번째 시트 '${hit.sheet.name}' 를 합쳤습니다.`);
      hit.sheet.byR = new Map(hit.sheet.rows.map((r) => [r.r, r]));
      matched.push({ rep, sheet: hit.sheet });
    }
    const tByR = new Map(ts.rows.map((r) => [r.r, r]));
    const litRows = ts.rows.filter(hasLiteral).map((r) => r.r);
    if (!litRows.length) {
      if (matched.some((m) => m.sheet.rows.some(hasLiteral))) report.warnings.push(`'${ts.name}' 시트: 양식이 비어 있어 합치지 않았습니다(양식 그대로 둡니다).`);
      continue;
    }

    // 머리 행 수 — 숫자면 그대로, 자동이면 headerRowsOf 뒤로 모든 회신이 양식과 똑같이 둔 행까지.
    let H = fixedH;
    if (!H) {
      H = headerRowsOf(ts);
      const lastLit = Math.max(...litRows);
      for (let r = H + 1; matched.length && r <= lastLit; r++) {
        const tk = rowKey(tByR.get(r));
        if (!matched.every((m) => rowKey(m.sheet.byR.get(r)) === tk)) break;
        if (hasLiteral(tByR.get(r))) H = r;
      }
      const touched = matched.filter((m) => {
        for (let r = 1; r <= H; r++) if (rowKey(m.sheet.byR.get(r)) !== rowKey(tByR.get(r))) return true;
        return false;
      });
      if (touched.length) {
        const who = touched.slice(0, 3).map((m) => m.rep.label).join(', ') + (touched.length > 3 ? ` 외 ${touched.length - 3}` : '');
        report.warnings.push(`'${ts.name}' 시트: 머리(1~${H}행) 안을 고친 회신이 있어 그 부분은 양식 것을 썼습니다(${who}) — 머리 행 수를 숫자로 정하면 바꿀 수 있습니다.`);
      }
    }

    // 쌓을 행 — 머리 뒤, 사람이 쓴 값이 있고, 양식의 같은 자리 행과 똑같지 않은 것.
    const stacked = [];
    for (const m of matched) {
      let n = 0;
      for (const row of m.sheet.rows) {
        if (row.r <= H || !hasLiteral(row)) continue;
        const tr = tByR.get(row.r);
        if (hasLiteral(tr) && rowKey(tr) === rowKey(row)) continue;   // 손대지 않은 안내·예시·합계 행
        stacked.push({ m, row });
        n++;
      }
      if (!n) report.warnings.push(`${m.rep.label}: '${ts.name}' 시트에 채운 행이 없습니다.`);
    }
    if (!stacked.length) {
      report.sheets.push({ name: ts.name, headerRows: H, rows: 0, sourceCol: '' });
      continue;
    }
    const below = litRows.filter((r) => r > H).length;
    if (below) report.warnings.push(`'${ts.name}' 시트: 양식의 머리 아래 ${below}개 행(예시·안내·합계 등)은 결과에 넣지 않았습니다.`);

    // 회신의 병합 칸 — 그 행들이 모두 이어서 쌓였으면 새 번호로 옮긴다.
    const newROf = new Map();
    stacked.forEach(({ m, row }, i) => {
      if (!newROf.has(m)) newROf.set(m, new Map());
      newROf.get(m).set(row.r, H + 1 + i);
    });
    let maxCol = 0;
    for (const row of ts.rows) {
      if (row.r > H) continue;
      for (const c of row.cells) if (String(c.text).trim() !== '' || c.f !== null) maxCol = Math.max(maxCol, c.col);
    }
    for (const { row } of stacked) for (const c of row.cells) if (String(c.text).trim() !== '') maxCol = Math.max(maxCol, c.col);
    const moved = [];
    for (const m of matched) {
      const map = newROf.get(m);
      if (!map) continue;
      for (const ref of m.sheet.mergeCells) {
        const g = parseRange(ref);
        if (!g || g.r1 <= H) continue;
        const a = map.get(g.r1);
        const b = map.get(g.r2);
        if (a == null || b == null || b - a !== g.r2 - g.r1) continue;
        let ok = true;
        for (let r = g.r1; r <= g.r2; r++) if (map.get(r) !== a + (r - g.r1)) ok = false;
        if (!ok) continue;
        moved.push({ c1: g.c1, r1: a, c2: g.c2, r2: b });
        maxCol = Math.max(maxCol, g.c2);
      }
    }
    const srcCol = maxCol + 1;
    const built = buildSheet(ts, H, stacked, moved.map(rangeText), srcCol, sourceHeader, parts);
    setXml(parts, ts.path, built.xml);
    dropTables.push(...built.tables);
    if (built.tables.length) report.warnings.push(`'${ts.name}' 시트: 엑셀 표(표 서식) ${built.tables.length}개를 뺐습니다 — 칸 값과 서식은 그대로입니다.`);
    report.rows += stacked.length;
    report.sheets.push({ name: ts.name, headerRows: H, rows: stacked.length, sourceCol: colLetter(srcCol) });
    changed = true;
  }

  if (changed) {
    // 수식을 값으로 바꾸고 행을 옮겼으니 계산 차례(calcChain)는 맞지 않는다 — 빼면 Excel 이 다시 만든다.
    const calc = readRels(parts, T.workbook).filter((r) => !r.external && /\/calcChain$/.test(r.type)).map((r) => r.target);
    removeParts(parts, [...calc, ...dropTables]);
  }
  return { bytes: packParts(parts), report };
}
