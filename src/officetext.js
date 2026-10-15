// 메일 첨부(Word·PowerPoint·Excel·한글 파일)의 글자를 브라우저 안에서 뽑는다 — 공문 탭이 메일 내용과 첨부 파일을 통째로 가져올 때 쓴다
// (2026-10-15 사용자 지정: "메일의 경우 메일 내용과 첨부파일을 통채로 갖어 올 수 있게 해줘, 그 파일은 추후 첨부파일로 사용할 수 있음을 인지해줘").
// AI 읽기는 그림·PDF 와 글자만 받는다. 그래서 docx·pptx·xlsx·hwpx 는 글자를 뽑아 붙여 넣은 글처럼 보내고,
// 원본 파일은 손대지 않는다 — 그 파일은 나중에 공문 첨부로 그대로 올린다.
//
//   docx → 본문(word/document.xml)의 문단(w:p)을 한 줄씩. 표는 행마다 칸을 " | " 로 잇는다. 머리말·꼬리말은 끝의 "(머리말·꼬리말)" 아래.
//   pptx → 슬라이드 차례(presentation.xml 의 목록, 없으면 slideN 의 **번호** 차례 — 글자 차례면 slide10 이 slide2 앞에 온다)대로
//          "[슬라이드 N]" 아래 문단(a:p)을 한 줄씩. 발표자 메모(notesSlides)는 그 아래 "(메모)" 밑에.
//   xlsx → 시트 차례대로 "[시트 이름]" 아래 행을 탭으로 잇는다. 빈 행은 건너뛰고, 날짜 서식의 칸은 2026-10-15 처럼 바꾼다. 숨긴 시트는 뺀다.
//   hwpx → Contents/section*.xml 을 번호 차례로, 문단(hp:p)마다 한 줄.
//   옛 형식(doc·xls·ppt·hwp)은 속이 ZIP 이 아니라 뽑지 못한다 — officeKind 가 null 이고, 보여 줄 말은 unsupportedNote 가 준다.
//
// ZIP 은 라이브러리 없이 중앙 목록을 따라 읽고(store·deflate), 압축은 웹 표준 DecompressionStream('deflate-raw')으로 푼다(크롬·Node 18+).
// XML 은 DOMParser 없이 정규식으로 훑는다 — 사이드 패널과 Node 검사에서 똑같이 돈다.
// 압축 폭탄은 푼 크기의 합(INFLATE_MAX)과 항목 수(ENTRIES_MAX)로 막고, 글자는 max(기본 TEXT_MAX)에서 자른다.

import { crc32 } from './zip.js';

/** 뽑은 글자의 기본 한도(글자 수) — 넘으면 자르고 cut 에 표시한다. */
export const TEXT_MAX = 12000;
/** 한 파일에서 압축을 풀어 낼 바이트의 합 — 넘으면 압축 폭탄으로 보고 멈춘다. */
export const INFLATE_MAX = 40 * 1024 * 1024;
/** ZIP 항목 수의 한도 — Office 파일은 많아야 수백 개다. */
export const ENTRIES_MAX = 5000;
/** xlsx 시트마다 넣을 행의 한도(빈 행은 세지 않는다). */
export const ROWS_MAX = 200;
/** xlsx 에서 읽을 열의 한도(A 열부터 센다) — 넘는 칸은 버리고 cut 에 표시한다. */
const COLS_MAX = 100;
const CUT_MARK = '…(너무 길어 여기서 잘랐습니다)';

/* ------------------------------------------------------------ 종류 */

/** 글자를 뽑는 확장자 — 매크로·서식 파일도 속은 같다. */
const KIND_OF_EXT = {
  docx: 'docx', docm: 'docx', dotx: 'docx', dotm: 'docx',
  pptx: 'pptx', pptm: 'pptx', ppsx: 'pptx', ppsm: 'pptx', potx: 'pptx', potm: 'pptx',
  xlsx: 'xlsx', xlsm: 'xlsx', xltx: 'xlsx', xltm: 'xlsx',
  hwpx: 'hwpx',
};
/** 옛 형식(이진) — 글자를 뽑지 못한다. 값은 보여 줄 이름. */
const LEGACY = {
  doc: 'doc(워드 옛 형식)', dot: 'dot(워드 옛 서식)',
  xls: 'xls(엑셀 옛 형식)', xlt: 'xlt(엑셀 옛 서식)', xlsb: 'xlsb(엑셀 이진 형식)',
  ppt: 'ppt(파워포인트 옛 형식)', pps: 'pps(파워포인트 옛 형식)', pot: 'pot(파워포인트 옛 서식)',
  hwp: 'hwp(한글 옛 형식)',
};
/** 읽기(AI)가 그대로 읽는 것 — 글자를 따로 뽑을 일이 없다. */
const READABLE = new Set(['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp']);

/** 끝의 확장자(소문자) — "2026.10.15 보고" 처럼 점 뒤가 확장자 꼴이 아니면 ''. */
function extOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * 글자를 뽑을 수 있는 종류 — 이름의 확장자(대소문자 무시)를 먼저 보고, 확장자로 못 가리면 MIME 형식을 본다.
 * 옛 형식(.doc·.xls·.ppt·.hwp)은 MIME 이 무엇이든 null 이다.
 * @returns {'docx'|'pptx'|'xlsx'|'hwpx'|null}
 */
export function officeKind(name, type = '') {
  const ext = extOf(name);
  if (KIND_OF_EXT[ext]) return KIND_OF_EXT[ext];
  if (LEGACY[ext]) return null;
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  if (/\.wordprocessingml\.(document|template)$|ms-word\.(document|template)\.macroenabled/.test(t)) return 'docx';
  if (/\.presentationml\.(presentation|slideshow|template)$|ms-powerpoint\.(presentation|slideshow|template)\.macroenabled/.test(t)) return 'pptx';
  if (/\.spreadsheetml\.(sheet|template)$|ms-excel\.(sheet|template)\.macroenabled/.test(t)) return 'xlsx';
  if (/hwp\+zip|hwpx/.test(t)) return 'hwpx';
  return null;
}

/**
 * 글자를 뽑지 못하는 파일에 보여 줄 짧은 말 — "hwp(한글 옛 형식) 파일은 글자를 뽑지 못해 첨부로만 넣습니다".
 * 뽑을 수 있는 것(officeKind)과 읽기가 그대로 읽는 PDF·그림은 ''.
 */
export function unsupportedNote(name, type = '') {
  if (officeKind(name, type)) return '';
  const ext = extOf(name);
  if (LEGACY[ext]) return `${LEGACY[ext]} 파일은 글자를 뽑지 못해 첨부로만 넣습니다`;
  if (READABLE.has(ext) || (!ext && /^image\/|\/pdf$/i.test(String(type || '')))) return '';
  return `${ext ? `${ext} ` : '이 '}파일은 글자를 뽑지 못해 첨부로만 넣습니다`;
}

/* ------------------------------------------------------------ ZIP */

const utf8 = new TextDecoder();

function asBytes(b) {
  if (b instanceof Uint8Array) return b;
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  throw new Error('파일 바이트가 없습니다.');
}

const sizeText = (n) => (n >= 1048576 ? `${Math.round(n / 1048576)}MB` : `${Math.ceil(n / 1024)}KB`);
const NOT_ZIP = 'ZIP 형식이 아닙니다 — 깨졌거나 보안(DRM)·암호가 걸린 파일일 수 있습니다.';
const BROKEN_CD = 'ZIP 중앙 목록이 깨졌습니다.';

/**
 * ZIP 의 중앙 목록 — 항목마다 이름·방식·크기·자리. 크기와 CRC 는 중앙 목록의 것을 믿는다(파일 머리는 데이터 설명자를 쓰면 0 이다).
 * 이름은 UTF-8 로 읽는다. ZIP64·여러 조각 묶음·항목이 너무 많은 것은 던진다.
 */
function listZip(bytes, dv, maxEntries) {
  const len = bytes.length;
  let eocd = -1;
  for (let i = len - 22, stop = Math.max(0, len - 22 - 0xffff); i >= stop; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(NOT_ZIP);
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff || (eocd >= 20 && dv.getUint32(eocd - 20, true) === 0x07064b50)) {
    throw new Error('ZIP64 형식(4GB 넘는 묶음용)은 읽지 않습니다.');
  }
  if (dv.getUint16(eocd + 4, true) !== 0 || dv.getUint16(eocd + 6, true) !== 0) throw new Error('여러 조각으로 나눈 ZIP 은 읽지 않습니다.');
  if (count > maxEntries) throw new Error(`묶음 안 항목이 너무 많습니다(${maxEntries}개 넘음) — 압축 폭탄일 수 있어 풀지 않습니다.`);
  if (cdOffset + cdSize > eocd) throw new Error(BROKEN_CD);
  const out = [];
  let at = cdOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > eocd || dv.getUint32(at, true) !== 0x02014b50) throw new Error(BROKEN_CD);
    const nlen = dv.getUint16(at + 28, true);
    if (at + 46 + nlen > eocd) throw new Error(BROKEN_CD);
    const csize = dv.getUint32(at + 20, true);
    const usize = dv.getUint32(at + 24, true);
    const offset = dv.getUint32(at + 42, true);
    out.push({
      name: utf8.decode(bytes.subarray(at + 46, at + 46 + nlen)).replace(/\\/g, '/').replace(/^\/+/, ''),
      flags: dv.getUint16(at + 8, true),
      method: dv.getUint16(at + 10, true),
      crc: dv.getUint32(at + 16, true),
      csize,
      usize,
      offset,
      zip64: csize === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff,
    });
    at += 46 + nlen + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true);
  }
  return out;
}

/**
 * deflate(raw) 를 푼다 — 목록에 적힌 크기(size)를 넘으면 그 자리에서 멈춘다(크기를 속인 압축 폭탄).
 * 깨진 데이터는 스트림이 던지고, 모자라게 풀리면 여기서 던진다.
 */
async function inflateRaw(raw, size, name) {
  if (typeof DecompressionStream !== 'function') throw new Error('이 환경에서는 압축을 풀지 못합니다(DecompressionStream 없음).');
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(raw).catch(() => {});   // 깨진 데이터면 쓰기 쪽도 거절된다 — 까닭은 읽기 쪽에서 받는다
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const out = new Uint8Array(size);
  let at = 0;
  let over = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (at + value.length > size) {
        over = true;
        break;
      }
      out.set(value, at);
      at += value.length;
    }
  } catch {
    throw new Error(`${name}: 압축을 풀지 못했습니다 — 깨진 항목입니다.`);
  }
  if (over) {
    reader.cancel().catch(() => {});
    throw new Error(`${name}: 풀린 크기가 목록에 적힌 것보다 큽니다 — 깨졌거나 압축 폭탄일 수 있어 멈췄습니다.`);
  }
  if (at !== size) throw new Error(`${name}: 풀린 크기가 목록과 다릅니다 — 깨진 항목입니다.`);
  return out;
}

/** 항목 하나의 바이트. 압축을 푼 크기는 budget 에서 깎는다(한 파일의 합이 한도를 넘으면 던진다). CRC 가 맞아야 돌려준다. */
async function readEntry(bytes, dv, e, budget) {
  if (e.flags & 1 || e.method === 99) throw new Error(`${e.name}: 암호가 걸린 항목이라 풀지 못합니다.`);
  if (e.zip64) throw new Error(`${e.name}: ZIP64 항목(4GB 넘는 묶음용)은 읽지 않습니다.`);
  if (e.method !== 0 && e.method !== 8) throw new Error(`${e.name}: 이 압축 방식(${e.method})은 풀지 못합니다 — store·deflate 만 풉니다.`);
  if (e.offset + 30 > bytes.length || dv.getUint32(e.offset, true) !== 0x04034b50) throw new Error(`${e.name}: 파일 머리가 깨졌습니다.`);
  // 파일 머리의 이름·덧붙임 길이는 중앙 목록과 다를 수 있다 — 데이터의 자리는 파일 머리의 것으로 센다.
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  if (start + e.csize > bytes.length) throw new Error(`${e.name}: 묶음이 중간에 잘렸습니다.`);
  const raw = bytes.subarray(start, start + e.csize);
  let data = raw;
  if (e.method === 8) {
    if (e.usize > budget.left) throw new Error(`압축을 푼 크기가 너무 큽니다(${sizeText(budget.max)} 넘음) — 압축 폭탄일 수 있어 풀지 않습니다.`);
    budget.left -= e.usize;
    data = await inflateRaw(raw, e.usize, e.name);
  } else if (e.csize !== e.usize) {
    throw new Error(`${e.name}: 크기가 맞지 않습니다 — 깨진 항목입니다.`);
  }
  if (crc32(data) !== e.crc) throw new Error(`${e.name}: CRC 가 맞지 않습니다 — 깨진 파일입니다.`);
  return data;
}

const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);

/** ZIP 을 열어 이름으로 꺼내는 손잡이 — 이름 찾기는 대소문자를 가리지 않는다(OPC 의 부분 이름 규칙). */
function openZip(bytes, { maxBytes = INFLATE_MAX, maxEntries = ENTRIES_MAX } = {}) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const list = listZip(bytes, dv, maxEntries);
  const byKey = new Map();
  for (const e of list) {
    const key = e.name.toLowerCase();
    if (!e.name.endsWith('/') && !byKey.has(key)) byKey.set(key, e);
  }
  const budget = { left: maxBytes, max: maxBytes };
  const relsOf = new Map();
  const read = (e) => readEntry(bytes, dv, e, budget);
  const zip = {
    list,
    names: [...byKey.keys()],
    has: (path) => byKey.has(String(path || '').toLowerCase()),
    read,
    async text(path) {
      const e = byKey.get(String(path || '').toLowerCase());
      return e ? xmlText(await read(e)) : null;
    },
    /** 그 부분의 관계(_rels/이름.rels) — Id → { type, target(묶음 안 경로) }. part 가 '' 이면 묶음 전체의 _rels/.rels. */
    async rels(part) {
      if (!relsOf.has(part)) relsOf.set(part, parseRels(await zip.text(`${dirOf(part)}_rels/${baseOf(part)}.rels`), dirOf(part)));
      return relsOf.get(part);
    },
  };
  return zip;
}

/** want(고를 항목)를 거르개로 — 함수·정규식·이름 목록(대소문자 무시)·이름 하나. 없으면 전부. */
function wantOf(want) {
  if (want == null) return () => true;
  if (typeof want === 'function') return want;
  if (want instanceof RegExp) {
    const re = new RegExp(want.source, want.flags.replace(/[gy]/g, ''));
    return (n) => re.test(n);
  }
  const names = new Set((typeof want === 'string' ? [want] : [...want]).map((n) => String(n).toLowerCase()));
  return (n) => names.has(n.toLowerCase());
}

/**
 * ZIP 의 중앙 목록을 읽어 고른 항목의 바이트를 돌려준다 — store(0)·deflate(8) 만 푼다. 폴더 항목은 빼고, 같은 이름은 처음 것만.
 * 데이터 설명자(파일 머리의 크기가 0)도 중앙 목록의 크기로 읽는다. 암호·ZIP64·그 밖의 압축 방식은 한국어 까닭으로 던진다.
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {{ want?: ((name: string) => boolean)|RegExp|string[]|string, maxBytes?: number, maxEntries?: number }} [opts]
 *   maxBytes 는 풀어 낼 바이트의 합(기본 INFLATE_MAX), maxEntries 는 항목 수(기본 ENTRIES_MAX)
 * @returns {Promise<Map<string, Uint8Array>>} 묶음 안 이름 → 바이트(store 항목은 원본 바이트를 가리키는 조각)
 */
export async function unzipEntries(bytes, { want, maxBytes = INFLATE_MAX, maxEntries = ENTRIES_MAX } = {}) {
  const zip = openZip(asBytes(bytes), { maxBytes, maxEntries });
  const pick = wantOf(want);
  const out = new Map();
  for (const e of zip.list) {
    if (e.name.endsWith('/') || out.has(e.name) || !pick(e.name)) continue;
    out.set(e.name, await zip.read(e));
  }
  return out;
}

/* ------------------------------------------------------------ XML */

/** XML 바이트를 글로 — UTF-16(BOM)도 받는다. 앞의 BOM 은 떼어진다. */
function xmlText(b) {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  return utf8.decode(b);
}

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML 개체(&amp; &lt; &gt; &quot; &apos; &#NN; &#xNN;)를 한 번에 푼다 — "&amp;lt;" 는 "&lt;" 로 남는다. */
function unescapeXml(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#(\d{1,7})|(amp|lt|gt|quot|apos));/g, (all, hex, num, name) => {
    if (name) return ENTITY[name];
    const cp = hex ? parseInt(hex, 16) : parseInt(num, 10);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
  });
}

/** 태그의 속성 자리 — 따옴표 안의 '>'·'/' 는 건너뛴다(서식 "[>=100]" 같은 것). */
const ATTRS = String.raw`((?:[^>"'/]|\/(?!>)|"[^"]*"|'[^']*')*)`;
/** 요소 하나(스스로 닫든 속이 있든) — 묶음 1 은 속성, 2 는 속(스스로 닫으면 undefined). 접두어는 무엇이든. */
const el = (name, flags = 'g') => new RegExp(String.raw`<(?:[\w.-]+:)?${name}\b${ATTRS}(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?${name}>)`, flags);
/** 여는(또는 스스로 닫는) 태그 하나 — 묶음 1 은 속성. */
const tag = (name, flags = 'g') => new RegExp(String.raw`<(?:[\w.-]+:)?${name}\b${ATTRS}\/?>`, flags);

const ATTR_RE = new Map();
/** 태그 안의 속성 값(개체를 푼 것). name 은 정규식 조각이다 — 접두어가 붙은 r:id 는 NS_ID 로 찾는다. 없으면 ''. */
function attr(attrs, name) {
  let re = ATTR_RE.get(name);
  if (!re) ATTR_RE.set(name, (re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)));
  const m = re.exec(attrs || '');
  return m ? unescapeXml(m[1] ?? m[2]) : '';
}
/** 관계를 가리키는 r:id(접두어는 파일마다 다를 수 있다). */
const NS_ID = '[\\w.-]+:id';
const RELATIONSHIP_RE = tag('Relationship');

/** 관계 파일(.rels)을 읽는다 — 밖을 가리키는 것(TargetMode="External")은 뺀다. 경로는 dir 을 기준으로 푼다. */
function parseRels(xml, dir) {
  const out = new Map();
  for (const [, a] of String(xml || '').matchAll(RELATIONSHIP_RE)) {
    if (/^external$/i.test(attr(a, 'TargetMode'))) continue;
    out.set(attr(a, 'Id'), { type: attr(a, 'Type'), target: resolvePath(dir, attr(a, 'Target')) });
  }
  return out;
}

/** 관계의 Target 을 묶음 안 경로로 — "/xl/a.xml" 은 맨 위부터, "../b.xml" 은 한 칸 위로. */
function resolvePath(dir, target) {
  let t = String(target || '').split('#')[0];
  try {
    t = decodeURIComponent(t);
  } catch { /* 그대로 */ }
  const out = [];
  for (const p of (t.startsWith('/') ? t : dir + t).split('/')) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

/** 이름 목록에서 re 에 맞는 것을 붙은 번호 차례로(slide2 → slide10). re 의 첫 묶음이 번호다. */
function numbered(names, re) {
  return names.map((n) => [n, re.exec(n)]).filter(([, m]) => m).sort((a, b) => Number(a[1][1]) - Number(b[1][1])).map(([n]) => n);
}

/** 주석 · CDATA(1) · 선언 · 태그(닫음 2, 이름 3, 속성 4, 스스로 닫음 5) · 글(6). 속성 값 안의 '>' 도 견딘다. */
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
const localName = (n) => n.slice(n.indexOf(':') + 1);
/** 글을 읽지 않는 요소 — 문단 속성(탭 위치 w:tab 이 든다)·지운 글(변경 내용 추적)·갈음 내용(mc:Fallback — 글상자 글이 한 번 더 든다). */
const SKIP = new Set(['pPr', 'tabs', 'tabLst', 'del', 'moveFrom', 'Fallback']);

/**
 * 문서 XML 을 줄로 — docx(w:)·pptx(a:)·hwpx(hp:)가 같은 뼈대라 접두어를 떼고 본다.
 *   문단(p) 하나가 한 줄, 글(t) 안의 글자만 모은다. tab → 탭, br·cr·lineBreak → 줄바꿈.
 *   표(tbl/tr/tc)는 행마다 칸을 " | " 로 잇고, 칸 안의 여러 문단은 빈칸 하나로 붙인다. 글이 빈 행은 뺀다.
 *   문단 안에 문단이 또 열리면(글상자·한글의 표) 앞의 글을 먼저 한 줄로 내보내 차례를 지킨다.
 * @param {{ skip?: (local: string, attrs: string) => boolean, stopAt?: number }} [opts]
 *   skip 은 통째로 건너뛸 요소, stopAt 은 모은 글자(빈칸 뺀 것)가 넘으면 그만 읽는 한도(뒤는 어차피 잘린다)
 * @returns {string[]}
 */
function flow(xml, { skip = () => false, stopAt = Infinity } = {}) {
  const root = [];
  const boxes = [root];   // 줄을 모으는 곳 — 문서, 또는 표의 칸
  const paras = [];       // 열린 문단의 글(겹칠 수 있다)
  const tables = [];
  let inT = 0;
  let skipName = '';
  let skipDepth = 0;
  let chars = 0;
  const box = () => boxes[boxes.length - 1];
  const put = (b, line) => {
    b.push(line);
    if (b === root) chars += line.replace(/\s+/g, '').length;
  };
  const add = (s) => {
    if (paras.length) paras[paras.length - 1] += s;
  };
  const flush = () => {
    const i = paras.length - 1;
    if (i >= 0 && paras[i]) {
      put(box(), paras[i]);
      paras[i] = '';
    }
  };
  for (const [, cdata, close, name, attrs, self, text] of String(xml || '').matchAll(TOKEN)) {
    if (chars > stopAt) break;
    if (skipDepth) {
      if (name && !self && localName(name) === skipName) skipDepth += close ? -1 : 1;
      continue;
    }
    if (text !== undefined || cdata !== undefined) {
      if (inT) add(text !== undefined ? unescapeXml(text) : cdata);
      continue;
    }
    if (!name) continue;
    const n = localName(name);
    if (!close && (SKIP.has(n) || skip(n, attrs))) {
      if (!self) {
        skipName = n;
        skipDepth = 1;
      }
      continue;
    }
    const tb = tables[tables.length - 1];
    switch (n) {
      case 'p':
        if (close) {
          if (paras.length) put(box(), paras.pop());
        } else {
          flush();
          if (self) put(box(), '');
          else paras.push('');
        }
        break;
      case 't':
        if (!self) inT = Math.max(0, inT + (close ? -1 : 1));
        break;
      case 'tab':
        if (!close) add('\t');
        break;
      case 'br': case 'cr': case 'lineBreak':
        if (!close) add('\n');
        break;
      case 'nbSpace': case 'fwSpace':
        if (!close) add(' ');
        break;
      case 'noBreakHyphen': case 'hyphen':
        if (!close) add('-');
        break;
      case 'tbl':
        if (close) {
          const done = tables.pop();
          if (done) {
            while (boxes.length > done.depth) boxes.pop();
            for (const row of done.rows) put(box(), row);
          }
        } else if (!self) {
          flush();
          tables.push({ rows: [], cells: null, depth: boxes.length });
        }
        break;
      case 'tr':
        if (!tb) break;
        if (close) {
          if (tb.cells?.some(Boolean)) tb.rows.push(tb.cells.join(' | '));
          tb.cells = null;
        } else if (!self) {
          tb.cells = [];
        }
        break;
      case 'tc':
        if (!tb) break;
        tb.cells ||= [];
        if (close) {
          if (boxes.length > tb.depth) tb.cells.push(boxes.pop().join(' ').replace(/\s+/g, ' ').trim());
        } else if (self) {
          tb.cells.push('');
        } else {
          boxes.push([]);
        }
        break;
      default:
    }
  }
  for (const p of paras) if (p) root.push(p);   // 닫히지 않은 문단(깨졌거나 중간에 그만 읽은 것)
  return root;
}

/**
 * 줄들을 다듬어 글 하나로 — 빈칸(전각 빈칸·nbsp 포함)은 하나로, 줄 앞뒤 빈칸은 떼고, 빈 줄은 하나만, 앞뒤 빈 줄은 없앤다.
 * keepTabs 면 줄 앞의 탭을 남긴다 — xlsx 행의 첫 칸이 빈 것이다.
 */
function tidy(lines, keepTabs = false) {
  const out = [];
  for (const raw of lines) {
    for (let l of String(raw).replace(/\r\n?/g, '\n').split('\n')) {
      l = l.replace(/[​-‍﻿]/g, '').replace(/[^\S\t\n]+/g, ' ').replace(/ *\t */g, '\t');
      l = keepTabs ? l.replace(/^ +| +$/g, '') : l.trim();
      if (!l && !out[out.length - 1]) continue;   // 빈 줄은 하나만(맨 앞은 없이)
      out.push(l);
    }
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join('\n');
}

/** max 글자에서 자른다 — 자르면 끝에 표시를 단다. 이모지 같은 두 칸 글자를 반으로 가르지 않는다. */
function cutText(body, max) {
  if (body.length <= max) return { text: body, cut: false };
  let end = max;
  const c = body.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return { text: `${body.slice(0, end).trimEnd()}\n${CUT_MARK}`, cut: true };
}

/** 조각(슬라이드·시트·구역)을 차례로 글로 바꾼다 — 모은 글이 max 를 넘으면 뒤 조각은 풀지도 않는다(cut). */
async function collect(units, max, make) {
  const blocks = [];
  let total = 0;
  let cut = false;
  for (const [i, u] of units.entries()) {
    if (total > max) {
      cut = true;
      break;
    }
    const block = await make(u, i);
    if (!block) continue;
    total += (blocks.length ? 2 : 0) + block.length;
    blocks.push(block);
  }
  return { blocks, cut };
}

/** 묶음의 본 문서 — _rels/.rels 의 officeDocument 관계, 없으면 fallback. */
async function mainPart(zip, fallback) {
  for (const r of (await zip.rels('')).values()) {
    if (/\/officeDocument$/.test(r.type) && zip.has(r.target)) return r.target;
  }
  return fallback;
}

/* ------------------------------------------------------------ 종류마다 */

async function docxText(zip, { max, headers }) {
  const main = await mainPart(zip, 'word/document.xml');
  const xml = await zip.text(main);
  if (xml == null) throw new Error('word/document.xml 이 없어 Word 문서로 읽지 못했습니다.');
  const blocks = [tidy(flow(xml, { stopAt: max }))];
  if (headers) {
    // 머리말 먼저, 그다음 꼬리말 — 같은 줄은 한 번만, 글자 없는 줄(쪽 번호 "- 1 -")은 뺀다.
    const rank = (r) => (/footer$/i.test(r.type) ? 1e6 : 0) + (Number(/(\d+)\.xml$/i.exec(r.target)?.[1]) || 0);
    const parts = [...(await zip.rels(main)).values()].filter((r) => /\/(header|footer)$/i.test(r.type)).sort((a, b) => rank(a) - rank(b));
    const seen = new Set();
    for (const r of parts) {
      const x = await zip.text(r.target);
      for (const line of x ? tidy(flow(x)).split('\n') : []) if (/\p{L}/u.test(line)) seen.add(line);
    }
    if (seen.size) blocks.push(`(머리말·꼬리말)\n${[...seen].join('\n')}`);
  }
  return { blocks, parts: 1, cut: false };
}

/** 슬라이드 번호 칸(a:fld type="slidenum")은 뺀다 — 메모 쪽에도 든다. */
const slideSkip = (n, attrs) => n === 'fld' && /\btype\s*=\s*["']slidenum["']/i.test(attrs);

const SP_RE = el('sp');
const SLD_ID_RE = tag('sldId');

/** 슬라이드의 발표자 메모 — 슬라이드의 관계가 가리키는 notesSlide 에서 본문 칸(p:ph type="body")만. */
async function notesOf(zip, slide) {
  const r = [...(await zip.rels(slide)).values()].find((x) => /\/notesSlide$/.test(x.type));
  const xml = r ? await zip.text(r.target) : null;
  if (!xml) return '';
  const shapes = [...xml.matchAll(SP_RE)].map((m) => m[0]);
  const body = shapes.filter((s) => /<(?:[\w.-]+:)?ph\b[^>]*\btype\s*=\s*["']body["']/.test(s));
  return tidy(flow((body.length ? body : shapes).join(''), { skip: slideSkip }));
}

async function pptxText(zip, { max, notes }) {
  const main = await mainPart(zip, 'ppt/presentation.xml');
  const slides = [];
  const pres = await zip.text(main);
  if (pres) {
    // 보이는 차례는 presentation.xml 의 sldIdLst 다 — 파일 번호와 다를 수 있다.
    const rels = await zip.rels(main);
    for (const [, a] of pres.matchAll(SLD_ID_RE)) {
      const target = rels.get(attr(a, NS_ID))?.target;
      if (target && zip.has(target) && !slides.some((s) => s.toLowerCase() === target.toLowerCase())) slides.push(target);
    }
  }
  if (!slides.length) slides.push(...numbered(zip.names, /^ppt\/slides\/slide(\d+)\.xml$/));
  if (!slides.length) throw new Error('슬라이드가 없어 PowerPoint 문서로 읽지 못했습니다.');
  const { blocks, cut } = await collect(slides, max, async (path, i) => {
    const xml = await zip.text(path);
    const body = xml ? tidy(flow(xml, { skip: slideSkip, stopAt: max })) : '';
    const memo = notes ? await notesOf(zip, path) : '';
    return `[슬라이드 ${i + 1}]${body ? `\n${body}` : ''}${memo ? `\n(메모)\n${memo}` : ''}`;
  });
  return { blocks, parts: slides.length, cut };
}

const ROW_RE = el('row');
const CELL_RE = el('c');
const T_RE = el('t');
const V_RE = el('v', '');
const RPH_RE = el('rPh');
const SI_RE = el('si');
const SHEET_RE = tag('sheet');
const NUMFMT_RE = tag('numFmt');
const XF_RE = tag('xf');
const CELLXFS_RE = el('cellXfs', '');

/** 칸의 글 — 여러 토막(서식 바꾼 글)은 잇고, 일본어 읽기(rPh)는 뺀다. */
const richText = (xml) => [...xml.replace(RPH_RE, '').matchAll(T_RE)].map((m) => unescapeXml(m[2] || '')).join('');
/** 칸 안의 줄바꿈·탭은 빈칸으로 — 행을 탭으로 잇기 때문이다. */
const clean = (s) => String(s).replace(/\s+/g, ' ').trim();

function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(SI_RE)].map((m) => richText(m[2] || ''));
}

/** 날짜·시각 서식 — 기본 번호(14~22·45~47, 한·중·일 27~36·50~58). */
const D = { date: true, time: false, sec: false };
const T = { date: false, time: true, sec: false };
const TS = { date: false, time: true, sec: true };
const BUILTIN_DATE = {
  14: D, 15: D, 16: D, 17: D, 18: T, 19: TS, 20: T, 21: TS, 22: { date: true, time: true, sec: false },
  27: D, 28: D, 29: D, 30: D, 31: D, 32: T, 33: TS, 34: D, 35: D, 36: D, 45: TS, 46: TS, 47: TS,
  50: D, 51: D, 52: D, 53: D, 54: D, 55: D, 56: D, 57: D, 58: D,
};

/** 사용자 서식 문자열이 날짜·시각인가 — 따옴표 글·\글자·_x·*x·[색·언어]를 떼고 y·d·m·h·s 를 본다. 아니면 null. */
function fmtKind(code) {
  const f = String(code || '').replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/[_*]./g, '')
    .replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, '').toLowerCase();
  const time = /[hs]/.test(f);
  const date = /[yd]/.test(f) || (/m/.test(f) && !time);
  return date || time ? { date, time, sec: /s/.test(f) } : null;
}

/** 칸 서식(cellXfs 의 차례)마다 날짜·시각 서식이면 { date, time, sec }, 아니면 null. */
function dateStyles(xml) {
  if (!xml) return [];
  const custom = new Map();
  for (const [, a] of xml.matchAll(NUMFMT_RE)) custom.set(Number(attr(a, 'numFmtId')), attr(a, 'formatCode'));
  const xfs = CELLXFS_RE.exec(xml);
  if (!xfs?.[2]) return [];
  return [...xfs[2].matchAll(XF_RE)].map(([, a]) => {
    const id = Number(attr(a, 'numFmtId') || 0);
    return custom.has(id) ? fmtKind(custom.get(id)) : BUILTIN_DATE[id] || null;
  });
}

const pad = (n) => String(n).padStart(2, '0');

/** 엑셀 날짜 일련번호를 2026-10-15(시각이 있으면 " 09:30") 로. 시각 서식만이면 09:30(:15). 날짜로 볼 수 없으면 ''. */
function excelDate(n, fmt, date1904) {
  if (!(n >= 0) || n >= 2958466) return '';
  const total = Math.round(n * 86400);   // 초
  const days = Math.floor(total / 86400);
  const s = total - days * 86400;
  if (!fmt.date) {   // 시각만 — 하루를 넘는 것(경과 시간)은 시를 이어 센다
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}${fmt.sec ? `:${pad(total % 60)}` : ''}`;
  }
  if (days < 1 && !date1904) return '';
  // 1900 체계는 1900-02-29(없는 날, 60)를 센다 — 61 부터는 1899-12-30 이 0 이다.
  const base = date1904 ? Date.UTC(1904, 0, 1) : days < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const d = new Date(base + days * 86400000);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return fmt.time && s ? `${day} ${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}${fmt.sec ? `:${pad(s % 60)}` : ''}` : day;
}

/** "AB12" 의 열 번호(A=0). 못 읽으면 -1. */
function colIndex(ref) {
  const m = /^([A-Za-z]{1,3})/.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** 칸 하나의 값 — 공유 글(t="s")·바로 쓴 글(inlineStr)·참거짓·수식 글·숫자(날짜 서식이면 날짜). */
function cellValue(a, body, ctx) {
  const t = attr(a, 't');
  if (t === 'inlineStr') return clean(richText(body));
  const m = V_RE.exec(body);
  if (!m) return '';
  const v = unescapeXml(m[2] || '');
  if (t === 's') return clean(ctx.shared[Number(v)] ?? '');
  if (t === 'b') return v.trim() === '1' ? 'TRUE' : 'FALSE';
  if (t && t !== 'n') return clean(v);   // str(수식의 글)·e(오류)·d(ISO 날짜)
  const n = Number(v);
  if (!v.trim() || !Number.isFinite(n)) return clean(v);
  const fmt = ctx.styles[Number(attr(a, 's') || 0)];
  // 숫자는 그대로 — 다만 엑셀처럼 15자리로 본다(0.30000000000000004 → 0.3).
  return (fmt && excelDate(n, fmt, ctx.date1904)) || String(Number(n.toPrecision(15)));
}

/** 시트의 행들 — 빈 행은 건너뛰고 cap 행까지. 칸은 열 자리를 지켜 탭으로 잇는다(모든 행에서 비어 있는 앞 열은 뺀다). */
function sheetRows(xml, ctx) {
  const rows = [];
  let more = false;
  let wide = false;
  for (const [, , inner] of xml.matchAll(ROW_RE)) {
    if (!inner) continue;
    const cells = [];
    let next = 0;
    for (const [, a, body] of inner.matchAll(CELL_RE)) {
      const at = colIndex(attr(a, 'r'));
      const col = at >= 0 ? at : next;
      next = col + 1;
      if (col >= COLS_MAX) {
        wide = true;
        continue;
      }
      const v = cellValue(a, body || '', ctx);
      if (v) cells.push([col, v]);
    }
    if (!cells.length) continue;
    if (rows.length >= ctx.cap) {
      more = true;
      break;
    }
    rows.push(cells);
  }
  let min = Infinity;
  for (const cells of rows) for (const [c] of cells) if (c < min) min = c;
  const lines = rows.map((cells) => {
    const out = [];
    for (const [c, v] of cells) out[c - min] = v;
    return out.join('\t');
  });
  return { lines, more, wide };
}

async function xlsxText(zip, { max, rows: cap }) {
  const main = await mainPart(zip, 'xl/workbook.xml');
  const wb = await zip.text(main);
  if (wb == null) throw new Error('xl/workbook.xml 이 없어 Excel 문서로 읽지 못했습니다.');
  const rels = await zip.rels(main);
  const dir = dirOf(main);
  const partOf = (type, name) => [...rels.values()].find((r) => r.type.endsWith(`/${type}`))?.target || `${dir}${name}`;
  const ctx = {
    shared: sharedStrings(await zip.text(partOf('sharedStrings', 'sharedStrings.xml'))),
    styles: dateStyles(await zip.text(partOf('styles', 'styles.xml'))),
    date1904: /<(?:[\w.-]+:)?workbookPr\b[^>]*\bdate1904\s*=\s*["'](?:1|true)["']/.test(wb),
    cap,
  };
  const sheets = [];
  for (const [i, [, a]] of [...wb.matchAll(SHEET_RE)].entries()) {
    if (/^(hidden|veryHidden)$/.test(attr(a, 'state'))) continue;
    const rel = rels.get(attr(a, NS_ID));
    if (rel && !/\/worksheet$/.test(rel.type)) continue;   // 차트 시트에는 칸이 없다
    sheets.push({ name: attr(a, 'name') || `시트${i + 1}`, path: rel?.target || `${dir}worksheets/sheet${i + 1}.xml` });
  }
  let cut = false;
  const got = await collect(sheets, max, async (s) => {
    const xml = await zip.text(s.path);
    const r = xml ? sheetRows(xml, ctx) : { lines: [], more: false, wide: false };
    if (r.more || r.wide) cut = true;
    const body = tidy(r.lines, true);
    return `[시트 ${s.name}]${body ? `\n${body}` : ''}${r.more ? `\n…(행이 많아 앞의 ${cap}행만 넣었습니다)` : ''}`;
  });
  return { blocks: got.blocks, parts: sheets.length, cut: cut || got.cut };
}

/** hp:switch 의 갈음 내용(hp:default) — hp:case 와 같은 글이 한 번 더 든다. */
const hwpxSkip = (n) => n === 'default';

async function hwpxText(zip, { max }) {
  const sections = numbered(zip.names, /^contents\/section(\d+)\.xml$/);
  if (!sections.length) throw new Error('Contents/section0.xml 이 없어 한글(hwpx) 문서로 읽지 못했습니다.');
  const { blocks, cut } = await collect(sections, max, async (path) => tidy(flow(await zip.text(path), { skip: hwpxSkip, stopAt: max })));
  return { blocks, parts: sections.length, cut };
}

const READERS = { docx: docxText, pptx: pptxText, xlsx: xlsxText, hwpx: hwpxText };

/** OLE 복합 문서(D0 CF 11 E0 …) — 옛 형식이거나, 암호를 건 docx·xlsx·pptx(겉이 이것으로 바뀐다)다. */
const isCfb = (b) => b.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((x, i) => b[i] === x);

/* ------------------------------------------------------------ 밖으로 */

/**
 * Office·한글 파일의 글자를 뽑는다. 원본 바이트는 건드리지 않는다.
 * @param {Uint8Array|ArrayBuffer} bytes 파일 바이트
 * @param {string} name 파일 이름(확장자로 종류를 가린다 — 없으면 opts.type 의 MIME)
 * @param {{ max?: number, type?: string, notes?: boolean, headers?: boolean, rows?: number, maxBytes?: number }} [opts]
 *   max 는 글자 한도(기본 TEXT_MAX), notes 는 pptx 발표자 메모, headers 는 docx 머리말·꼬리말(둘 다 기본 넣음),
 *   rows 는 xlsx 시트마다 행 한도(기본 ROWS_MAX), maxBytes 는 압축을 풀 바이트의 합(기본 INFLATE_MAX)
 * @returns {Promise<{ kind: 'docx'|'pptx'|'xlsx'|'hwpx', text: string, parts: number, cut: boolean }>}
 *   parts 는 슬라이드·(보이는)시트·구역 수(docx 는 1), cut 은 무엇이든 덜어 냈으면 true. 글자가 없는 파일이면 text 는 ''.
 *   못 읽으면 "이름: 까닭" 으로 던진다.
 */
export async function officeText(bytes, name, { max = TEXT_MAX, type = '', notes = true, headers = true, rows = ROWS_MAX, maxBytes = INFLATE_MAX } = {}) {
  const label = String(name || '').trim() || '첨부 파일';
  const kind = officeKind(name, type);
  if (!kind) throw new Error(`${label}: ${unsupportedNote(name, type) || '글자를 뽑을 수 있는 형식(docx·pptx·xlsx·hwpx)이 아닙니다.'}`);
  const limit = max > 0 ? max : TEXT_MAX;
  try {
    const u8 = asBytes(bytes);
    if (isCfb(u8)) {
      throw new Error(kind === 'hwpx'
        ? '옛 형식(hwp)이거나 암호가 걸린 한글 파일이라 글자를 뽑지 못했습니다.'
        : '암호가 걸렸거나 옛 형식(doc·xls·ppt)을 이름만 바꾼 파일이라 글자를 뽑지 못했습니다.');
    }
    const zip = openZip(u8, { maxBytes });
    const got = await READERS[kind](zip, { max: limit, notes, headers, rows: rows > 0 ? Math.floor(rows) : ROWS_MAX });
    const { text, cut } = cutText(got.blocks.filter(Boolean).join('\n\n'), limit);
    return { kind, text, parts: got.parts, cut: cut || got.cut };
  } catch (err) {
    throw new Error(`${label}: ${err?.message || err}`, { cause: err });
  }
}

/**
 * 읽기에 붙일 글 덩어리 — 머리말 "[첨부 파일 글자 — 이름]" 다음 줄부터 뽑은 글. 읽기는 이것을 붙여 넣은 글처럼 다룬다.
 * @param {string} name 파일 이름
 * @param {{text: string}|string} result officeText 의 결과(또는 글)
 * @returns {string} 글이 없으면 ''
 */
export function officeTextBlock(name, result) {
  const text = String((typeof result === 'string' ? result : result?.text) || '').trim();
  if (!text) return '';
  return `[첨부 파일 글자 — ${String(name || '').trim() || '첨부 파일'}]\n${text}`;
}
