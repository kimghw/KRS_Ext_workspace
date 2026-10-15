// 병합의 입구 — 양식의 종류(xlsx·docx)를 가리고, 결과 파일 이름을 짓고, xlsx.js·docx.js 로 보낸다.
// sync.js 가 이 파일만 부른다: mergeOffice({ kind, template, replies, options }) → { bytes, mime, report }.
// (2026-10-15 사용자 지정: "docx 파일이나 excel 양식으로 작성을 요청한 경우 받아서 병합까지 할 수 있는 기능")
// 결과는 store ZIP 이다(src/zip.js buildZip) — Word·Excel 은 압축 안 한 묶음도 그대로 연다. import 할 때는 아무것도 하지 않는다.

import { mergeXlsx, XLSX_MIME } from './xlsx.js';
import { mergeDocx, DOCX_MIME } from './docx.js';
import { asBytes, unzip } from './zipread.js';

export const MIME = Object.freeze({ xlsx: XLSX_MIME, docx: DOCX_MIME });

/**
 * 병합할 수 있는 양식의 종류 — 이름의 확장자만 본다(.xlsx·.docx). 매크로·서식 파일(.xlsm·.dotx …)은 속의 파트 형식이 달라
 * 결과를 .xlsx·.docx 로 저장하면 Office 가 열지 않으므로 받지 않는다. 옛 .xls·.doc 도 null.
 * @returns {'xlsx'|'docx'|null}
 */
export function mergeKind(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || '').trim());
  const ext = m ? m[1].toLowerCase() : '';
  return ext === 'xlsx' || ext === 'docx' ? ext : null;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** 파일 이름에 쓸 수 있게 — 윈도 금지 글자·제어 문자를 빼고, 공백을 접고, 끝의 점·공백을 떼고, 너무 길면 자른다. */
function safeName(s, max = 80) {
  let t = String(s ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if ([...t].length > max) t = [...t].slice(0, max).join('').trim();
  t = t.replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(t)) t = `_${t}`;
  return t;
}

/**
 * 결과 파일 이름 — "제목_병합_20261015.xlsx". 제목은 파일 이름에 쓸 수 있게 다듬고, 비면 '병합'만.
 * 날짜는 그 PC 의 날짜(내려받는 날).
 */
export function mergedName(subject, kind, date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const ymd = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  const ext = kind === 'docx' ? 'docx' : 'xlsx';
  const head = safeName(subject);
  return `${head ? `${head}_` : ''}병합_${ymd}.${ext}`;
}

/** kind 가 없으면 양식의 속을 보고 가린다(xl/workbook.xml · word/document.xml). */
async function sniff(template) {
  try {
    const names = [...(await unzip(template, { want: (n) => /^(xl\/workbook\.xml|word\/document\.xml)$/i.test(n) })).keys()].map((n) => n.toLowerCase());
    if (names.includes('xl/workbook.xml')) return 'xlsx';
    if (names.includes('word/document.xml')) return 'docx';
  } catch { /* 아래에서 던진다 */ }
  return null;
}

/**
 * 양식 + 회신 첨부들 → 한 파일.
 * @param {{ kind?: 'xlsx'|'docx', template: Uint8Array|ArrayBuffer, replies: Array<{ bytes, source: { org, name, address, date }, name?: string }>,
 *           options?: { headerRows?: 'auto'|number, sourceHeader?: string, mode?: 'stack'|'rows', sourceLabel?: string } }} args
 * @returns {Promise<{ bytes: Uint8Array, mime: string, report: { merged: number, rows?: number, skipped: Array<{ source, label, reason }>, warnings: string[] } }>}
 */
export async function mergeOffice({ kind, template, replies = [], options = {} } = {}) {
  let tpl;
  try {
    tpl = asBytes(template);
  } catch {
    throw new Error('양식 파일이 없습니다 — 보낸 메일의 양식 첨부를 먼저 받아 두어야 합니다.');
  }
  const k = kind === 'xlsx' || kind === 'docx' ? kind : await sniff(tpl);
  if (!k) throw new Error('병합할 수 있는 양식이 아닙니다 — xlsx·docx 만 합칩니다.');
  const opts = options || {};
  const { bytes, report } = k === 'xlsx'
    ? await mergeXlsx(tpl, replies, { headerRows: opts.headerRows ?? 'auto', sourceHeader: opts.sourceHeader || '출처' })
    : await mergeDocx(tpl, replies, { mode: opts.mode || 'stack', headerRows: opts.headerRows ?? 'auto', sourceLabel: opts.sourceLabel || '출처' });
  return { bytes, mime: MIME[k], report };
}
