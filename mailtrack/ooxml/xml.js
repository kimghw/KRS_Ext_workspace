// 병합(xlsx·docx)이 쓰는 XML 조각 다루기와 OPC 묶음(파트·관계·Content_Types) 손질.
// Node 검사에는 DOMParser 가 없고 확장 페이지와 똑같이 돌아야 해서, DOM 대신 태그를 훑는 작은 스캐너로 요소를 찾고 바꾼다.
// 접두어는 파일마다 다르다(Excel 의 x:, Word 의 w:, 도구가 만든 ns0: …) — 모든 찾기는 로컬 이름으로 하고, 새로 쓰는 요소는 그 파일의 접두어를 따른다.
// 바꾼 파트만 새 XML 로 넣고 나머지는 바이트 그대로 둔다 — 다시 묶을 때 [Content_Types].xml 이 맨 앞(packParts).
// import 할 때는 아무것도 하지 않는다.

import { buildZip } from '../../src/zip.js';

/* ------------------------------------------------------------ 글자 */

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML 1.0 에 쓸 수 없는 글자(제어 문자·짝 없는 서로게이트·FFFE/FFFF)를 지운다 — 회신의 글이 그대로 들어오므로. */
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** 글을 XML 글·속성 값으로 — & < > " ' 를 개체로, 못 쓰는 글자는 지운다. */
export function esc(s) {
  return String(s ?? '').replace(BAD_CHARS, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}

/** XML 개체(&amp; &lt; &gt; &quot; &apos; &#NN; &#xNN;)를 한 번에 푼다 — "&amp;lt;" 는 "&lt;" 로 남는다. */
export function unesc(s) {
  s = String(s ?? '');
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#(\d{1,7})|(amp|lt|gt|quot|apos));/g, (all, hex, num, name) => {
    if (name) return ENTITY[name];
    const cp = hex ? parseInt(hex, 16) : parseInt(num, 10);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
  });
}

const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ATTR_RE = new Map();
function attrRe(name, any) {
  const key = (any ? '*' : '') + name;
  let re = ATTR_RE.get(key);
  if (!re) {
    const n = any ? `(?:[\\w.-]+:)?${reEsc(name)}` : reEsc(name);
    ATTR_RE.set(key, (re = new RegExp(`(^|\\s)(${n})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)));
  }
  return re;
}

/** 태그 안의 속성 값(개체를 푼 것) — name 은 쓰인 그대로("r", "r:id", "w:val"). 없으면 ''. */
export function attr(attrs, name) {
  const m = attrRe(name, false).exec(attrs || '');
  return m ? unesc(m[3] ?? m[4]) : '';
}

/** 접두어가 무엇이든(또는 없든) 로컬 이름이 맞는 속성 값 — w:val 과 ns0:val 을 같이 본다. */
export function attrAny(attrs, local) {
  const m = attrRe(local, true).exec(attrs || '');
  return m ? unesc(m[3] ?? m[4]) : '';
}

/** 그 속성이 있는지(값이 비어도). */
export function hasAttr(attrs, name, any = false) {
  return attrRe(name, any).test(attrs || '');
}

/** 관계를 가리키는 r:id — 접두어가 무엇이든(r: 이 아닐 수 있다). 접두어 없는 id 는 보지 않는다. */
export function relIdOf(attrs) {
  const m = /(^|\s)[\w.-]+:id\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs || '');
  return m ? unesc(m[2] ?? m[3]) : '';
}

/** 속성 하나를 바꾸거나(있으면) 끝에 더한다. 값은 escape 한다. */
export function setAttr(attrs, name, value) {
  const a = String(attrs || '');
  const v = esc(value);
  const re = attrRe(name, false);
  if (re.test(a)) return a.replace(re, (all, sp, n) => `${sp}${n}="${v}"`);
  return `${a.replace(/\s+$/, '')} ${name}="${v}"`;
}

/** 속성을 뺀다 — any 면 접두어가 무엇이든 그 로컬 이름을. */
export function dropAttr(attrs, name, any = false) {
  const n = any ? `(?:[\\w.-]+:)?${reEsc(name)}` : reEsc(name);
  return String(attrs || '').replace(new RegExp(`\\s+${n}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'g'), '');
}

/* ------------------------------------------------------------ 스캐너 */

/** 속성 자리 — 따옴표 안의 '>'·'/' 는 건너뛴다(서식 "[>=100]" 같은 것). */
const ATTRS = String.raw`((?:[^>"'/]|\/(?!>)|"[^"]*"|'[^']*')*)`;
/** 주석 · CDATA · 처리 지시 · 선언 · 닫는 태그(1 이름) · 여는/스스로 닫는 태그(2 이름, 3 속성, 4 '/'). */
const TOKEN_SRC = String.raw`<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/([\w.:-]+)\s*>|<([\w.:-]+)${ATTRS}(\/?)>`;
// 스캐너 정규식은 칸마다 불려 수십만 번 만들어진다 — 다 쓴 것을 모아 다시 쓴다. transform 의 fn 이 findFirst 를 부르는 것처럼
// 겹쳐 불려도 저마다 다른 객체를 쥐므로(lastIndex 를 나눠 쓰지 않으므로) 안전하다.
const POOL = [];
const takeRe = () => POOL.pop() || new RegExp(TOKEN_SRC, 'g');
const giveRe = (re) => {
  if (POOL.length < 16) POOL.push(re);
};

const localOf = (name) => name.slice(name.indexOf(':') + 1);
const prefixOf = (name) => (name.indexOf(':') < 0 ? '' : name.slice(0, name.indexOf(':')));

/** 요소 하나 — 이름·로컬 이름·접두어·속성 글·속(inner)·통째(raw)와 자리들. */
function mkEl(xml, m, start, openEnd, innerEnd, end) {
  const name = m[2];
  const self = openEnd === end && innerEnd === end && m[4] === '/';
  return {
    name,
    local: localOf(name),
    prefix: prefixOf(name),
    attrs: m[3] || '',
    self,
    start,
    end,
    openEnd,
    innerStart: openEnd,
    innerEnd,
    inner: self ? '' : xml.slice(openEnd, innerEnd),
    raw: xml.slice(start, end),
    open: xml.slice(start, openEnd),
  };
}

/**
 * from~to 사이의 바로 아래 자식 요소들(손자는 그 안에) — 글·주석은 건너뛴다.
 * 닫히지 않은 요소(깨진 XML)는 버린다.
 */
export function children(xml, from = 0, to = xml.length) {
  const re = takeRe();
  try {
    return childrenWith(re, xml, from, to);
  } finally {
    giveRe(re);
  }
}

function childrenWith(re, xml, from, to) {
  re.lastIndex = from;
  const out = [];
  let depth = 0;
  let cur = null;
  for (let m; (m = re.exec(xml)) && m.index < to;) {
    if (m[1] !== undefined) {
      depth--;
      if (depth === 0 && cur) {
        out.push(mkEl(xml, cur.m, cur.start, cur.openEnd, m.index, re.lastIndex));
        cur = null;
      }
      if (depth < 0) break;   // 부모의 닫는 태그 — 여기서 끝
      continue;
    }
    if (m[2] === undefined) continue;
    const self = m[4] === '/';
    if (depth === 0) {
      if (self) out.push(mkEl(xml, m, m.index, re.lastIndex, re.lastIndex, re.lastIndex));
      else {
        cur = { m, start: m.index, openEnd: re.lastIndex };
        depth = 1;
      }
    } else if (!self) depth++;
  }
  return out;
}

/**
 * 로컬 이름이 local 인 요소를 깊이와 상관없이 앞에서부터(겹친 것은 바깥 것만). 접두어는 무엇이든.
 * @returns {Array<{ name, local, prefix, attrs, inner, raw, open, start, end, innerStart, innerEnd, self }>}
 */
export function findAll(xml, local, from = 0, to = xml.length, limit = Infinity) {
  const re = takeRe();
  try {
    return findAllWith(re, xml, local, from, to, limit);
  } finally {
    giveRe(re);
  }
}

function findAllWith(re, xml, local, from, to, limit) {
  re.lastIndex = from;
  const out = [];
  let depth = 0;
  let cur = null;
  for (let m; (m = re.exec(xml)) && m.index < to;) {
    if (m[1] !== undefined) {
      depth--;
      if (cur && depth === cur.depth) {
        out.push(mkEl(xml, cur.m, cur.start, cur.openEnd, m.index, re.lastIndex));
        cur = null;
        if (out.length >= limit) break;
      }
      continue;
    }
    if (m[2] === undefined) continue;
    const self = m[4] === '/';
    if (!cur && localOf(m[2]) === local) {
      if (self) {
        out.push(mkEl(xml, m, m.index, re.lastIndex, re.lastIndex, re.lastIndex));
        if (out.length >= limit) break;
      } else cur = { m, start: m.index, openEnd: re.lastIndex, depth };
    }
    if (!self) depth++;
  }
  return out;
}

/** findAll 의 첫 것(없으면 null). */
export function findFirst(xml, local, from = 0, to = xml.length) {
  return findAll(xml, local, from, to, 1)[0] || null;
}

/** 문서의 맨 바깥 요소(뿌리) — 여는 태그 자리와 속성. */
export function rootOf(xml) {
  const re = takeRe();
  try {
    re.lastIndex = 0;
    for (let m; (m = re.exec(xml));) {
      if (m[2] !== undefined) return { name: m[2], local: localOf(m[2]), prefix: prefixOf(m[2]), attrs: m[3] || '', start: m.index, openEnd: re.lastIndex };
    }
    return null;
  } finally {
    giveRe(re);
  }
}

/**
 * 요소를 지우고·벗기고·바꾸며 다시 쓴다(스택을 따라가 겹친 요소도 바르게). fn 은 여는 태그마다 불리고 다음 중 하나를 돌려준다:
 *   없음(그대로) · 'drop'(통째로 지움) · 'unwrap'(태그만 떼고 속은 남김) · { replace: 글 }(통째로 바꿈) · { tag: 글 }(여는 태그만 바꿈).
 * fn 이 받는 context 는 벗기지 않은 가장 가까운 조상의 로컬 이름(맨 위면 opts.context) — 자리에 맞는 대체 글을 고르려고.
 */
export function transform(xml, fn, { from = 0, to = xml.length, context = null } = {}) {
  const re = takeRe();
  try {
    return transformWith(re, xml, fn, from, to, context);
  } finally {
    giveRe(re);
  }
}

function transformWith(re, xml, fn, from, to, context) {
  re.lastIndex = from;
  const out = [];
  let last = from;
  const stack = [];
  let skipTo = -1;
  for (let m; (m = re.exec(xml)) && m.index < to;) {
    const isClose = m[1] !== undefined;
    const isEl = m[2] !== undefined;
    if (skipTo >= 0) {
      if (isClose) {
        stack.pop();
        if (stack.length === skipTo) {
          skipTo = -1;
          last = re.lastIndex;
        }
      } else if (isEl && m[4] !== '/') stack.push(null);
      continue;
    }
    if (isClose) {
      const top = stack.pop();
      if (top && top.mode === 'unwrap') {
        out.push(xml.slice(last, m.index));
        last = re.lastIndex;
      }
      continue;
    }
    if (!isEl) continue;
    const self = m[4] === '/';
    const name = m[2];
    const local = localOf(name);
    let ctx = context;
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k] && stack[k].mode !== 'unwrap') {
        ctx = stack[k].local;
        break;
      }
    }
    const act = fn({ name, local, prefix: prefixOf(name), attrs: m[3] || '', self, context: ctx, start: m.index, openEnd: re.lastIndex, xml });
    if (!act) {
      if (!self) stack.push({ local, mode: 'keep' });
      continue;
    }
    out.push(xml.slice(last, m.index));
    last = re.lastIndex;
    if (act === 'drop' || typeof act.replace === 'string') {
      if (act !== 'drop') out.push(act.replace);
      if (!self) {
        skipTo = stack.length;
        stack.push(null);
      }
    } else if (act === 'unwrap') {
      if (!self) stack.push({ local, mode: 'unwrap' });
    } else if (typeof act.tag === 'string') {
      out.push(act.tag);
      if (!self) stack.push({ local, mode: 'keep' });
    }
  }
  out.push(xml.slice(last, to));
  return out.join('');
}

/** 로컬 이름이 't' 인 요소들의 글을 이어 붙인다(개체를 푼 것) — 엑셀의 윗주(rPh) 안 글은 뺀다. */
export function textOf(xml, from = 0, to = xml.length) {
  const s = String(xml || '');
  const skip = findAll(s, 'rPh', from, to);
  let out = '';
  for (const t of findAll(s, 't', from, to)) {
    if (skip.some((r) => t.start >= r.start && t.end <= r.end)) continue;
    out += unesc(t.inner);
  }
  return out;
}

/* ------------------------------------------------------------ 칸 주소 */

/** 열 번호(1부터) → 글자('A', 'AB'). */
export function colLetter(n) {
  let x = Math.floor(Number(n));
  if (!(x >= 1)) return '';
  let s = '';
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** 열 글자 → 번호('A' → 1, 'AB' → 28, 앞의 '$' 는 무시). 글자가 아니면 0. */
export function colIndex(s) {
  const t = String(s ?? '');
  let i = t[0] === '$' ? 1 : 0;
  if (i >= t.length) return 0;
  let n = 0;
  for (; i < t.length; i++) {
    const c = t.charCodeAt(i) | 0x20;   // 소문자로
    if (c < 97 || c > 122) return 0;
    n = n * 26 + (c - 96);
  }
  return n;
}

/** 칸 주소 'B12'(또는 '$B$12') → { col: 2, row: 12 }. 못 읽으면 null. 칸마다 불리니 정규식 없이 글자를 센다. */
export function parseRef(ref) {
  const s = typeof ref === 'string' ? ref.trim() : String(ref ?? '').trim();
  let i = s[0] === '$' ? 1 : 0;
  const c0 = i;
  let col = 0;
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i) | 0x20;
    if (c < 97 || c > 122) break;
    col = col * 26 + (c - 96);
  }
  if (i === c0 || i - c0 > 3) return null;
  if (s[i] === '$') i++;
  const r0 = i;
  let row = 0;
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return null;
    row = row * 10 + (c - 48);
  }
  return i === r0 ? null : { col, row };
}

/** 범위 'A1:C3' → { c1, r1, c2, r2 }(한 칸이면 같은 값). 못 읽으면 null. */
export function parseRange(ref) {
  const [a, b] = String(ref || '').trim().split(':');
  const p = parseRef(a);
  const q = b ? parseRef(b) : p;
  if (!p || !q) return null;
  return { c1: Math.min(p.col, q.col), r1: Math.min(p.row, q.row), c2: Math.max(p.col, q.col), r2: Math.max(p.row, q.row) };
}

/** 범위를 글로 — 한 칸이면 'B2', 아니면 'A1:C3'. */
export function rangeText({ c1, r1, c2, r2 }) {
  const a = `${colLetter(c1)}${r1}`;
  const b = `${colLetter(c2)}${r2}`;
  return a === b ? a : `${a}:${b}`;
}

/* ------------------------------------------------------------ 출처 글 */

const pad2 = (n) => String(n).padStart(2, '0');
const localStamp = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** 날짜를 출처 글에 — Date·밀리초·ISO(시각 있음)는 그 PC 시각 'YYYY-MM-DD HH:mm', 그 밖의 글은 그대로. */
export function dateText(d) {
  if (d == null || d === '') return '';
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? '' : localStamp(d);
  if (typeof d === 'number') return Number.isFinite(d) ? localStamp(new Date(d)) : '';
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const t = new Date(s);
    if (!Number.isNaN(t.getTime())) return localStamp(t);
  }
  return s;
}

/**
 * 병합 결과에 적는 출처 — "org · name <address> · date". 빈 것은 빼고, org 가 주소와 같으면(주소로 센 키) 한 번만.
 * (2026-10-15 사용자 지정: 받은 회신을 병합할 때 누가 보낸 줄인지 남긴다 — xlsx 는 출처 열, docx 는 출처 문단·행.)
 */
export function sourceText(src) {
  const s = src || {};
  const clean = (x) => String(x ?? '').replace(/\s+/g, ' ').trim();
  const address = clean(s.address);
  let org = clean(s.org);
  const name = clean(s.name);
  if (org && address && org.toLowerCase() === address.toLowerCase()) org = '';
  const who = name && address ? `${name} <${address}>` : name || (address ? `<${address}>` : '');
  return [org, who, dateText(s.date)].filter(Boolean).join(' · ');
}

/* ------------------------------------------------------------ OPC 묶음 */

const utf8 = new TextDecoder();
const enc = new TextEncoder();

/** XML 바이트를 글로 — UTF-16(BOM)도 받는다. 앞의 BOM 은 떼어진다. */
export function xmlText(b) {
  if (!b) return '';
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  return utf8.decode(b);
}

/** 이름으로 파트를 찾는다 — 먼저 그대로, 없으면 대소문자 무시(OPC 의 부분 이름 규칙). 실제 이름을 돌려준다(없으면 ''). */
export function partName(parts, name) {
  const n = String(name || '').replace(/^\/+/, '');
  if (parts.has(n)) return n;
  const low = n.toLowerCase();
  for (const k of parts.keys()) if (k.toLowerCase() === low) return k;
  return '';
}

/** 파트의 글(없으면 null). */
export function getXml(parts, name) {
  const n = partName(parts, name);
  return n ? xmlText(parts.get(n)) : null;
}

/** 파트를 새 XML 글로 바꾼다 — UTF-8 로 쓰니 선언의 encoding 도 UTF-8 로. 없던 이름이면 그대로 더한다. */
export function setXml(parts, name, xml) {
  const n = partName(parts, name) || String(name).replace(/^\/+/, '');
  const s = String(xml).replace(/^(<\?xml[^>]*?encoding\s*=\s*["'])[^"']*(["'])/, '$1UTF-8$2');
  parts.set(n, enc.encode(s));
}

const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);

/** 그 파트의 관계 파일 이름 — 'xl/workbook.xml' → 'xl/_rels/workbook.xml.rels', 묶음 전체('')는 '_rels/.rels'. */
export function relsPathOf(part) {
  return `${dirOf(part)}_rels/${baseOf(part)}.rels`;
}

/** 관계 파일 이름에서 그 주인 파트 — 'xl/_rels/workbook.xml.rels' → 'xl/workbook.xml'. 관계 파일이 아니면 null. */
export function ownerOfRels(relsPath) {
  const m = /^(.*?)_rels\/([^/]*)\.rels$/i.exec(relsPath);
  return m ? m[1] + m[2] : null;
}

/** 관계의 Target 을 묶음 안 경로로 — '/xl/a.xml' 은 맨 위부터, '../b.xml' 은 한 칸 위로. */
export function resolveTarget(dir, target) {
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

/**
 * 그 파트의 관계들 — [{ id, type, target(묶음 안 경로, 밖이면 원문), external, raw }]. 관계 파일이 없으면 [].
 * part 가 '' 이면 묶음 전체의 _rels/.rels.
 */
export function readRels(parts, part) {
  const xml = getXml(parts, relsPathOf(part));
  if (xml == null) return [];
  const dir = dirOf(part);
  return findAll(xml, 'Relationship').map((r) => {
    const external = /^external$/i.test(attr(r.attrs, 'TargetMode'));
    const target = attr(r.attrs, 'Target');
    return { id: attr(r.attrs, 'Id'), type: attr(r.attrs, 'Type'), target: external ? target : resolveTarget(dir, target), external, raw: r.raw };
  });
}

/** 묶음의 본문 파트(officeDocument 관계) — 없으면 fallback 이 있으면 그것. */
export function mainPartOf(parts, fallback) {
  const rel = readRels(parts, '').find((r) => /\/officeDocument$/.test(r.type) && !r.external);
  const n = rel && partName(parts, rel.target);
  return n || partName(parts, fallback) || '';
}

/** 관계 파일에서 고른 관계들(keep 이 false 인 것)을 지운다. 바뀌었으면 true. */
export function dropRels(parts, part, drop) {
  const path = relsPathOf(part);
  const xml = getXml(parts, path);
  if (xml == null) return false;
  const dir = dirOf(part);
  let changed = false;
  const out = transform(xml, (e) => {
    if (e.local !== 'Relationship') return null;
    const external = /^external$/i.test(attr(e.attrs, 'TargetMode'));
    const t = attr(e.attrs, 'Target');
    const rel = { id: attr(e.attrs, 'Id'), type: attr(e.attrs, 'Type'), target: external ? t : resolveTarget(dir, t), external };
    if (!drop(rel)) return null;
    changed = true;
    return 'drop';
  });
  if (changed) setXml(parts, path, out);
  return changed;
}

/**
 * 파트들을 묶음에서 뺀다 — 그 파트와 그 관계 파일, [Content_Types].xml 의 Override, 그리고 다른 관계 파일이 그 파트를 가리키는 관계까지
 * 지워 끊긴 참조가 남지 않게 한다(calcChain·표 파트를 뺄 때).
 * @returns {string[]} 실제로 뺀 파트 이름
 */
export function removeParts(parts, names) {
  const gone = new Set();
  for (const raw of names) {
    const n = partName(parts, raw);
    if (!n) continue;
    gone.add(n.toLowerCase());
    parts.delete(n);
    const rp = partName(parts, relsPathOf(n));
    if (rp) {
      gone.add(rp.toLowerCase());
      parts.delete(rp);
    }
  }
  if (!gone.size) return [];
  const ctName = partName(parts, '[Content_Types].xml');
  if (ctName) {
    let changed = false;
    const ct = transform(xmlText(parts.get(ctName)), (e) => {
      if (e.local !== 'Override') return null;
      let p = attr(e.attrs, 'PartName').replace(/^\/+/, '');
      try {
        p = decodeURIComponent(p);
      } catch { /* 그대로 */ }
      if (!gone.has(p.toLowerCase())) return null;
      changed = true;
      return 'drop';
    });
    if (changed) setXml(parts, ctName, ct);
  }
  for (const n of [...parts.keys()]) {
    const owner = ownerOfRels(n);
    if (owner == null) continue;
    dropRels(parts, owner, (r) => !r.external && gone.has(r.target.toLowerCase()));
  }
  return [...gone];
}

/** 파트들을 ZIP 바이트로(store) — [Content_Types].xml 을 맨 앞에, 나머지는 원래 차례. */
export function packParts(parts, { date } = {}) {
  const ct = partName(parts, '[Content_Types].xml');
  const entries = [];
  if (ct) entries.push({ name: ct, data: parts.get(ct) });
  for (const [name, data] of parts) if (name !== ct) entries.push({ name, data });
  return buildZip(entries, date ? { date } : undefined);
}
