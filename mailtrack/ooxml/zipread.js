// 메일 수신 탭의 병합(xlsx·docx)이 회신 첨부를 여는 작은 ZIP 읽기 — 중앙 목록을 따라 항목을 꺼낸다(store·deflate).
// 쓰기는 src/zip.js 의 buildZip(store)을 그대로 쓰고, 읽기만 여기 둔다 — src/officetext.js 는 다른 작업이라 기대지 않는다
// (2026-10-15 사용자 지정: "docx 파일이나 excel 양식으로 작성을 요청한 경우 받아서 병합까지 할 수 있는 기능").
// 압축은 웹 표준 DecompressionStream('deflate-raw')으로 푼다 — 크롬 확장 페이지와 Node 24 에서 똑같이 돈다.
// 회신 첨부는 남이 보낸 파일이다: 푼 크기의 합(maxBytes)과 항목 수(maxEntries)로 압축 폭탄을 막고, CRC 가 맞아야 돌려준다.
// import 할 때는 아무것도 하지 않는다.

import { crc32 } from '../../src/zip.js';

/** 한 파일에서 풀어 낼 바이트의 합(기본 40MiB) — 넘으면 압축 폭탄으로 보고 멈춘다. */
export const UNZIP_MAX_BYTES = 40 * 1024 * 1024;
/** 항목 수의 한도 — Office 파일은 많아야 수백 개다. */
export const UNZIP_MAX_ENTRIES = 5000;

const utf8 = new TextDecoder();
const sizeText = (n) => (n >= 1048576 ? `${Math.round(n / 1048576)}MB` : `${Math.ceil(n / 1024)}KB`);
const NOT_ZIP = 'ZIP 형식이 아닙니다 — 깨졌거나 옛 형식(.xls·.doc), 또는 암호·보안(DRM)이 걸린 파일일 수 있습니다.';
const BROKEN_CD = 'ZIP 중앙 목록이 깨졌습니다.';

/** Uint8Array·ArrayBuffer·다른 TypedArray 를 Uint8Array 로(복사하지 않는다). */
export function asBytes(b) {
  if (b instanceof Uint8Array) return b;
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  throw new Error('파일 바이트가 없습니다.');
}

/** 옛 Office 형식(OLE 복합 문서 — .xls·.doc, 암호 건 xlsx·docx 도 이 껍데기다)의 첫 8바이트. */
export function isOle(bytes) {
  const b = asBytes(bytes);
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return b.length >= 8 && sig.every((x, i) => b[i] === x);
}

/** ZIP 로컬 파일 머리("PK\3\4")로 시작하는지 — 병합 전에 회신을 가리는 데 쓴다. */
export function isZip(bytes) {
  const b = asBytes(bytes);
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

/** 옛 형식·이진 형식 확장자 → 보여 줄 이름. */
const LEGACY = { xls: 'xls(엑셀 옛 형식)', xlt: 'xlt(엑셀 옛 서식)', xlsb: 'xlsb(엑셀 이진 형식)', doc: 'doc(워드 옛 형식)', dot: 'dot(워드 옛 서식)', hwp: 'hwp(한글)', hwpx: 'hwpx(한글)' };
const KIND_TEXT = { xlsx: '엑셀(xlsx)', docx: '워드(docx)' };

/**
 * 회신 첨부를 병합에 넣지 못하는 까닭 — 넣을 수 있으면 ''. 바이트를 보고(OLE 껍데기·ZIP 머리), 파일 이름이 있으면 확장자도 본다.
 * 옛 .xls·.doc 는 속이 ZIP 이 아니라 풀 수 없다 — 회신자에게 새 형식으로 다시 받아야 한다.
 * @param {{ bytes?: Uint8Array|ArrayBuffer, name?: string }} rep
 * @param {'xlsx'|'docx'} kind
 */
export function replyProblem(rep, kind) {
  const want = KIND_TEXT[kind] || kind;
  let b;
  try {
    b = asBytes(rep?.bytes);
  } catch {
    return '파일 바이트가 없습니다(첨부를 아직 받지 못했습니다).';
  }
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(String(rep?.name || '').trim()) || [])[1]?.toLowerCase() || '';
  if (LEGACY[ext]) return `${LEGACY[ext]} 파일은 병합하지 못합니다 — ${want} 로 저장한 파일을 다시 받아야 합니다.`;
  if (isOle(b)) return `옛 형식(.xls·.doc)이거나 암호·보안(DRM)이 걸린 파일이라 병합하지 못합니다 — ${want} 로 저장한 파일을 다시 받아야 합니다.`;
  if (!isZip(b)) return `${want} 파일이 아닙니다.`;
  return '';
}

/**
 * 중앙 목록 — 항목마다 이름·방식·크기·자리. 크기와 CRC 는 중앙 목록의 것을 믿는다(데이터 설명자를 쓰면 파일 머리의 값은 0 이다).
 * ZIP64·여러 조각 묶음·항목이 너무 많은 것은 한국어 까닭으로 던진다.
 */
function listZip(bytes, dv, maxEntries) {
  const len = bytes.length;
  let eocd = -1;
  // 끝 기록 뒤에는 64KB 까지 주석이 붙을 수 있다 — 그만큼만 거슬러 찾는다.
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
      // 이름은 UTF-8 로 읽는다(Office 는 늘 ASCII·UTF-8). 역슬래시·앞의 '/' 는 고쳐 둔다.
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
 * deflate(raw)를 푼다 — 목록에 적힌 크기를 넘으면 그 자리에서 멈춘다(크기를 속인 압축 폭탄).
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

/** 항목 하나의 바이트. 푼 크기는 budget 에서 깎는다(store 도 센다 — 병합은 푼 것을 모두 손에 든다). CRC 가 맞아야 돌려준다. */
async function readEntry(bytes, dv, e, budget) {
  if (e.flags & 1 || e.method === 99) throw new Error(`${e.name}: 암호가 걸린 항목이라 풀지 못합니다.`);
  if (e.zip64) throw new Error(`${e.name}: ZIP64 항목(4GB 넘는 묶음용)은 읽지 않습니다.`);
  if (e.method !== 0 && e.method !== 8) throw new Error(`${e.name}: 이 압축 방식(${e.method})은 풀지 못합니다 — store·deflate 만 풉니다.`);
  if (e.offset + 30 > bytes.length || dv.getUint32(e.offset, true) !== 0x04034b50) throw new Error(`${e.name}: 파일 머리가 깨졌습니다.`);
  // 파일 머리의 이름·덧붙임 길이는 중앙 목록과 다를 수 있다 — 데이터 자리는 파일 머리의 것으로 센다.
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  if (start + e.csize > bytes.length) throw new Error(`${e.name}: 묶음이 중간에 잘렸습니다.`);
  if (e.usize > budget.left) throw new Error(`압축을 푼 크기가 너무 큽니다(${sizeText(budget.max)} 넘음) — 압축 폭탄일 수 있어 풀지 않습니다.`);
  budget.left -= e.usize;
  const raw = bytes.subarray(start, start + e.csize);
  let data = raw;
  if (e.method === 8) data = await inflateRaw(raw, e.usize, e.name);
  else if (e.csize !== e.usize) throw new Error(`${e.name}: 크기가 맞지 않습니다 — 깨진 항목입니다.`);
  if (crc32(data) !== e.crc) throw new Error(`${e.name}: CRC 가 맞지 않습니다 — 깨진 파일입니다.`);
  return data;
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
 * ZIP 을 풀어 이름 → 바이트로. 차례는 중앙 목록의 차례(병합 결과를 원본과 같은 차례로 다시 묶으려고).
 * 폴더 항목은 빼고, 같은 이름은 처음 것만. store 항목은 원본 바이트를 가리키는 조각이다.
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {{ want?: ((name: string) => boolean)|RegExp|string[]|string, maxBytes?: number, maxEntries?: number }} [opts]
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function unzip(bytes, { want, maxBytes = UNZIP_MAX_BYTES, maxEntries = UNZIP_MAX_ENTRIES } = {}) {
  const b = asBytes(bytes);
  if (b.length < 22) throw new Error(NOT_ZIP);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const list = listZip(b, dv, maxEntries);
  const pick = wantOf(want);
  const budget = { left: maxBytes, max: maxBytes };
  const out = new Map();
  for (const e of list) {
    if (!e.name || e.name.endsWith('/') || out.has(e.name) || !pick(e.name)) continue;
    out.set(e.name, await readEntry(b, dv, e, budget));
  }
  return out;
}
