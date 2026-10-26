// 패널 캡처 — 머리의 캡처 단추를 누르면 패널 위에 고르기 막을 씌워 칸·단추를 눌러 하나 이상 고르고, 고른 부분의 코드(HTML)나 이미지(PNG)를
// 클립보드에 복사한다(2026-10-17 사용자 지정: "사이드패널 캡쳐 기능을 추가해줘. 클릭클릭 하면 1개 이상을 캡쳐해서 해당 부분의 코드나 이미지를
// 복사할 수 있게. 그 기능은 상단에 두고 설정에서 onoff 할수 있게"). 패널의 어느 부분을 말하는지 개발자(코딩 에이전트)에게 붙여 넣어 보이는 용도다.
//
//   · 고르기 막(startPick) — 웹페이지 캡처의 고르기 막(src/pagecap.js 의 pagePick)과 같은 손놀림: 가리키면 점선 칸과 이름(button#refresh · 34×34),
//     누르면 번호가 붙고 다시 누르면 뺀다, ↑ 는 한 겹 큰 칸·↓ 는 작은 칸, Esc 는 끝. 막 아래쪽의 띠에 코드 복사·이미지 복사·끝 단추가 있다
//     (위에 두면 좁은 패널의 머리를 가려 머리의 단추를 고를 수 없다 — 2026-10-17 실측).
//     끌어 네모를 그으면(DRAG_MIN 넘게) 그 안에 통째로 든 것들이 한꺼번에 들어간다(2026-10-17 사용자 지정: "드래그 하면 여러개 포함되도록") — 바깥 것부터
//     살펴 카드가 통째로 들면 카드 하나이고 그 안의 칸들은 아니다(unitsIn). 끄는 동안 네모와 들 것들의 점선을 미리 보이고, 놓으면 문서 차례로 더한다
//     (이미 고른 것은 그대로). 안 움직이고 놓으면 누른 것이다.
//     글자만 감싸는 inline 요소(strong·code …)는 건너뛰고 상자(display 가 inline 이 아닌 것)·단추·입력칸을 고른다. 아이콘(svg) 안을 가리키면 그 단추다.
//     막은 바퀴(휠)를 막지 않아 패널을 내리면서 고를 수 있다.
//   · 코드(codeOf) — 고른 차례대로 자리(선택자 경로 · 크기)를 주석으로 적고 그 HTML 을 그대로 준다. 입력칸의 지금 값(value·checked·selected)은
//     outerHTML 에 없어 속성으로 적어 넣는다(snapshot). 한 곳이 너무 길면 자른다(CODE_MAX).
//   · Help Chat 에 붙이기 — 고르는 대로(onChange) 얕은 코드(codeOf 의 shallow — 한 겹 아래까지, shallowOf)를 Help Chat 줄에 넘긴다(2026-10-26 사용자 지정:
//     "캡쳐버튼 누르고 선택하면 바로 help chat에 들어 가게 … 상세 코드가 아니라 위치나 디자인을 추론할 수 있는정도"). 넘기는 길은 sidepanel.js.
//   · 이미지(renderPng) — 확장 페이지는 chrome.tabs.captureVisibleTab 으로 찍을 수 없다(탭의 것만 찍는다). 그래서 고른 요소를 복제해 계산된 스타일을
//     인라인으로 박고(기본값과 다른 것만 — 숨은 틀 문서의 같은 태그와 견준다, cloneStyled) SVG <foreignObject> 에 넣어 그림으로 읽어 캔버스에 그린다 —
//     스타일시트가 없는 그림 안에서도 같은 모양이 나오게. ::before/::after 는 span 으로, appearance: none 인 체크박스(스위치)도 span 으로 바꾼다
//     (입력칸은 자식을 못 가진다). 여러 개면 세로로 이어 한 장에 번호를 붙인다. 바탕은 패널의 바탕색. 배율은 화면의 것(MAX_SCALE 까지).
//   · 켜고 끄기 — 설정 → 일반 → 화면 구성의 스위치(ENABLE_KEY, 기본 켬). 끄면 머리의 단추가 숨고 고르던 것도 끝난다(sidepanel.js).
//
// 클립보드에 그림을 넣지 못하면(초점이 빠졌다 등) PNG 파일로 내려 둔다 — 복사한 줄 알고 붙여 넣었다가 비어 있는 것보다 낫다.

export const ENABLE_KEY = 'panelCapture';
export const captureEnabled = (value) => value !== false;
/** 코드 복사에서 한 곳의 HTML 한도 — 목록 전체를 고르면 수십만 자가 된다. 넘으면 자르고 몇 자였는지 적는다. */
export const CODE_MAX = 30000;
/** 그림 배율의 한도 — devicePixelRatio 가 3 인 화면도 2 까지만. */
export const MAX_SCALE = 2;
/** 복사했다는 말을 띠에 띄워 두는 시간. */
export const SAID_MS = 1800;
/** 누른 채 이만큼(px) 넘게 움직이면 끌기 — 덜 움직였으면 누른 것. */
export const DRAG_MIN = 4;
/** 끌어 그은 네모에 통째로 들었는지 볼 때의 여유(px) — 테두리에 딱 맞춰 긋지 않아도 들게. */
const SLACK = 2;

const XHTML = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** 고를 수 있는 최소 크기 — 이보다 작은 것(구분선·빈 칸)은 지나친다. */
const MIN = 6;
/** inline 이어도 고르는 태그 — 글자 사이에 있어도 하나의 것이다. */
const UNIT_TAGS = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY|IMG|CANVAS|LI|TD|TH)$/;
/** 그림에 넣지 않는 태그. */
const SKIP_TAGS = /^(script|style|link|template|noscript|iframe|object|embed|video|audio)$/;
/** 그림에 인라인하지 않는 스타일 — 움직임·마우스·스크롤은 그림에 없다. 논리 속성(inline-size …)은 물리 속성과 겹친다. */
const NOISY = /^(transition|animation|cursor|pointer-events|user-select|-webkit-user|will-change|touch-action|caret-color|scroll-|overscroll-|inline-size|block-size|min-inline|min-block|max-inline|max-block|inset-|margin-inline|margin-block|padding-inline|padding-block|border-inline|border-block)/;
/** XML 에 들어갈 수 없는 제어 문자. */
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/* ------------------------------------------------------------ 이름·자리 */

/**
 * 요소의 짧은 이름 — 태그#id.클래스(앞의 max 개). 예) button#refresh.icon.refresh
 * @param {Element} el
 * @param {number} [max]
 */
export function nameOf(el, max = 3) {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = [...el.classList].slice(0, max).map((c) => `.${c}`).join('');
  return `${tag}${id}${cls}`;
}

/** body 아래부터 그 요소까지의 자리 — 코드 복사의 주석에 적는다. 예) main.app > header.app-header > div.head-tools > button#refresh.icon.refresh */
export function pathOf(el) {
  const doc = el.ownerDocument;
  const out = [];
  for (let n = el; n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) out.unshift(nameOf(n));
  return out.join(' > ');
}

/** 가리킬 때 띄우는 이름 — 짧은 이름과 크기. 예) button#refresh.icon · 34×34 */
export function labelOf(el) {
  const r = el.getBoundingClientRect();
  return `${nameOf(el, 2)} · ${Math.round(r.width)}×${Math.round(r.height)}`;
}

/* ------------------------------------------------------------ 코드 */

/** 입력칸의 지금 값을 복제본의 속성으로 — outerHTML 에는 처음 값만 있다. 비밀번호 칸의 값은 적지 않는다. */
function applyValue(out, src) {
  const tag = src.tagName;
  if (tag === 'INPUT') {
    if (/^(checkbox|radio)$/i.test(src.type)) out.toggleAttribute('checked', !!src.checked);
    else if (!/^(file|password)$/i.test(src.type)) out.setAttribute('value', src.value ?? '');
  } else if (tag === 'TEXTAREA') out.textContent = src.value ?? '';
  else if (tag === 'OPTION') out.toggleAttribute('selected', !!src.selected);
}

/**
 * 요소의 깊은 복제본에 입력칸의 지금 값을 넣은 것 — 코드 복사가 outerHTML 을 뽑는 대상.
 * @param {Element} el
 * @returns {Element}
 */
export function snapshot(el) {
  const clone = el.cloneNode(true);
  const sel = 'input, textarea, option';
  const from = [el, ...el.querySelectorAll(sel)].filter((n) => n.matches?.(sel));
  const to = [clone, ...clone.querySelectorAll(sel)].filter((n) => n.matches?.(sel));
  from.forEach((src, i) => { if (to[i]) applyValue(to[i], src); });
  return clone;
}

/** 닫는 태그가 없는 것. */
const VOID_TAGS = /^(AREA|BASE|BR|COL|EMBED|HR|IMG|INPUT|LINK|META|SOURCE|TRACK|WBR)$/;
/** 얕은 코드에서 보이는 자식 수와 자식 글의 앞부분 길이. */
const SHALLOW_KIDS = 12;
const SHALLOW_TEXT = 40;
const brief = (s, max) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max)}…` : t; };
/** 여는 태그만 — 글 칸은 지금 값을 넣어. */
function openTag(el) {
  const c = el.cloneNode(false);
  if (el.tagName === 'INPUT') applyValue(c, el);
  const html = c.outerHTML;
  return VOID_TAGS.test(el.tagName) ? html : html.slice(0, html.lastIndexOf('</'));
}
/** 한 줄 — 여는 태그, 글 앞부분(글 없이 자식만 있으면 …), 닫는 태그. */
function lineOf(el) {
  if (VOID_TAGS.test(el.tagName)) return openTag(el);
  const text = brief(el.tagName === 'TEXTAREA' ? el.value : el.textContent, SHALLOW_TEXT) || (el.children.length ? '…' : '');
  return `${openTag(el)}${text}</${el.tagName.toLowerCase()}>`;
}

/**
 * 한 겹 아래까지만의 코드 — 요소의 여는 태그와 바로 아래 자식마다 한 줄(lineOf). 더 깊은 것은 보이지 않는다 — 자리와 모양을 짐작할 만큼만(Help Chat 에 붙이는 것).
 * @param {Element} el
 * @returns {string}
 */
export function shallowOf(el) {
  const kids = [...el.children];
  if (!kids.length) return lineOf(el);
  const rows = kids.slice(0, SHALLOW_KIDS).map((ch) => `  ${lineOf(ch)}`);
  if (kids.length > SHALLOW_KIDS) rows.push(`  <!-- … 외 ${kids.length - SHALLOW_KIDS}개 -->`);
  return `${openTag(el)}\n${rows.join('\n')}\n</${el.tagName.toLowerCase()}>`;
}

/**
 * 고른 요소들의 코드 — 맨 앞에 머리말 주석, 곳마다 번호·자리·크기 주석과 HTML.
 * @param {Element[]} els
 * @param {{head?: string, shallow?: boolean}} [opts] head 는 머리말에 붙는 말(탭 이름·버전·시각), shallow 면 HTML 대신 한 겹 아래까지(shallowOf)
 * @returns {string}
 */
export function codeOf(els, { head = '', shallow = false } = {}) {
  const parts = els.map((el, i) => {
    const r = el.getBoundingClientRect();
    let html = shallow ? shallowOf(el) : snapshot(el).outerHTML;
    if (html.length > CODE_MAX) html = `${html.slice(0, CODE_MAX)}\n<!-- … 잘림 — 전체 ${html.length.toLocaleString('ko-KR')}자 -->`;
    const no = els.length > 1 ? `${i + 1}/${els.length} · ` : '';
    return `<!-- ${no}${pathOf(el)} · ${Math.round(r.width)}×${Math.round(r.height)} -->\n${html}`;
  });
  return `<!-- 패널 캡처${head ? ` · ${head}` : ''} -->\n${parts.join('\n\n')}\n`;
}

/* ------------------------------------------------------------ 이미지 */

/**
 * 태그마다의 기본 계산 스타일 — 스타일시트가 없는 숨은 틀 문서에 같은 태그를 만들어 읽는다. 요소는 틀 안에 붙여 둔 채라 읽은 선언이 살아 있다.
 * input 은 type 마다 다르다(체크박스·글 칸). svg 안의 태그는 svg 안에 만든다.
 * @param {Document} doc
 * @returns {{of: (tag: string, ns: string|null, type?: string) => CSSStyleDeclaration, close: () => void}}
 */
export function openDefaults(doc) {
  const frame = doc.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 10px; height: 10px; border: 0; visibility: hidden;';
  doc.body.append(frame);
  const idoc = frame.contentDocument;
  if (!idoc.body) idoc.documentElement.append(idoc.createElement('body'));
  const cache = new Map();
  let svgRoot = null;
  return {
    of(tag, ns = null, type = '') {
      const key = `${ns === SVG_NS ? 'svg:' : ''}${tag}${type ? `[${type}]` : ''}`;
      let cs = cache.get(key);
      if (cs) return cs;
      let el;
      if (ns === SVG_NS) {
        svgRoot ||= idoc.body.appendChild(idoc.createElementNS(SVG_NS, 'svg'));
        el = svgRoot.appendChild(idoc.createElementNS(SVG_NS, tag));
      } else {
        el = idoc.body.appendChild(idoc.createElement(tag));
        if (type) el.setAttribute('type', type);
      }
      cs = idoc.defaultView.getComputedStyle(el);
      cache.set(key, cs);
      return cs;
    },
    close() { frame.remove(); },
  };
}

/** 계산 스타일 중 기본값과 다른 것을 인라인 스타일로. */
function inlineStyle(out, cs, def) {
  for (let i = 0; i < cs.length; i++) {
    const name = cs[i];
    if (NOISY.test(name)) continue;
    const v = cs.getPropertyValue(name);
    if (v !== def.getPropertyValue(name)) out.style.setProperty(name, v);
  }
}

/**
 * ::before/::after 의 content 를 글자로 — "…"·'…' 과 attr(…) 만 잇는다. url()·counter() 는 비운다.
 * @param {string} content 계산된 content 값
 * @param {Element} src
 */
export function contentText(content, src) {
  if (!content || content === 'none' || content === 'normal') return '';
  let out = '';
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|attr\(\s*([^)\s]+)\s*\)/g;
  const text = content.replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/g, '');   // 그림(url)은 못 넣는다 — 그 안의 따옴표 글을 글자로 보지 않게
  let m;
  while ((m = re.exec(text))) {
    if (m[3] != null) out += src.getAttribute(m[3]) ?? '';
    else out += (m[1] ?? m[2] ?? '').replace(/\\([0-9a-fA-F]{1,6}) ?|\\(.)/g, (_, hex, ch) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : ch));
  }
  return out;
}

/** 가상 요소(::before·::after)를 span 으로 — 없으면 null. */
function pseudoSpan(src, which, defaults) {
  const win = src.ownerDocument.defaultView;
  const ps = win.getComputedStyle(src, which);
  const c = ps.getPropertyValue('content');
  if (!c || c === 'none' || c === 'normal' || ps.getPropertyValue('display') === 'none') return null;
  const span = src.ownerDocument.createElement('span');
  inlineStyle(span, ps, defaults.of('span'));
  span.style.removeProperty('content');
  span.textContent = contentText(c, src);
  return span;
}

/** 그림(img)의 주소를 data: 로 — SVG 그림 안에서는 바깥 자원을 읽지 않는다. 못 읽으면 주소를 뗀다(빈 자리). */
async function inlineImg(out, src) {
  const url = src.currentSrc || src.src || '';
  if (!url || url.startsWith('data:')) return;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const blob = await res.blob();
    out.src = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    out.removeAttribute('src');
    out.removeAttribute('srcset');
  }
}

/**
 * 요소를 복제하며 계산 스타일을 인라인으로 박는다 — SVG <foreignObject> 안(스타일시트가 없다)에서도 같은 모양이 나오게.
 * 숨은 것(display: none)은 빼고, 입력칸의 지금 값은 속성으로, 내려간 스크롤 상자는 안쪽을 그만큼 올려 그린다.
 * @param {Element} src
 * @param {{of: Function}} defaults openDefaults 가 준 것
 * @param {{root?: boolean, w?: number, h?: number}} [opts] root 면 자리·여백을 없애고 크기를 못 박는다
 * @returns {Promise<Element|null>}
 */
export async function cloneStyled(src, defaults, { root = false, w = 0, h = 0 } = {}) {
  const doc = src.ownerDocument;
  const win = doc.defaultView;
  const cs = win.getComputedStyle(src);
  const tag = src.tagName.toLowerCase();
  if (SKIP_TAGS.test(tag) || (!root && cs.getPropertyValue('display') === 'none')) return null;
  const ns = src.namespaceURI === SVG_NS ? SVG_NS : null;
  const type = tag === 'input' ? String(src.type || 'text').toLowerCase() : '';
  let out;
  let defTag = tag;
  if (tag === 'canvas') {
    out = doc.createElement('img');
    try { out.src = src.toDataURL(); } catch { /* 더럽혀진 캔버스 — 빈 자리 */ }
  } else if (tag === 'input' && /^(checkbox|radio)$/.test(type) && cs.getPropertyValue('appearance') === 'none') {
    out = doc.createElement('span');   // 스위치 — ::before(손잡이)를 안에 넣어야 하는데 입력칸은 자식을 못 가진다
    defTag = 'span';
  } else {
    out = src.cloneNode(false);
  }
  if (out.tagName !== src.tagName) {
    for (const a of src.attributes) if (!/^(type|name|checked|value|width|height|src)$/i.test(a.name)) out.setAttribute(a.name, a.value);
  } else {
    applyValue(out, src);
    if (tag === 'img') await inlineImg(out, src);
  }
  inlineStyle(out, cs, defaults.of(defTag, ns, defTag === 'input' ? type : ''));
  if (root) {
    out.style.setProperty('margin', '0');
    out.style.setProperty('position', 'relative');
    for (const side of ['top', 'right', 'bottom', 'left']) out.style.setProperty(side, 'auto');
    out.style.setProperty('transform', 'none');
    out.style.setProperty('box-sizing', 'border-box');
    out.style.setProperty('width', `${w}px`);
    out.style.setProperty('height', `${h}px`);
    out.style.setProperty('flex', 'none');
  }
  if (out.tagName === 'IMG' || out.tagName === 'INPUT' || tag === 'textarea') return out;
  const before = pseudoSpan(src, '::before', defaults);
  if (before) out.append(before);
  let holder = out;
  if (src.scrollTop || src.scrollLeft) {
    holder = doc.createElement('div');
    holder.style.cssText = `transform: translate(${-src.scrollLeft}px, ${-src.scrollTop}px);`;
    out.append(holder);
  }
  for (const ch of src.childNodes) {
    if (ch.nodeType === 3) holder.append(doc.createTextNode(ch.data));
    else if (ch.nodeType === 1) {
      const c = await cloneStyled(ch, defaults);
      if (c) holder.append(c);
    }
  }
  const after = pseudoSpan(src, '::after', defaults);
  if (after) out.append(after);
  return out;
}

/**
 * 복제본을 SVG 문서로 — <foreignObject> 안에 XHTML 로 넣는다. 배율은 안쪽 div 의 transform 으로(캔버스가 또렷하게).
 * @param {Element} node cloneStyled 의 root
 * @param {number} w
 * @param {number} h
 * @param {number} [scale]
 * @returns {string}
 */
export function svgOf(node, w, h, scale = 1) {
  const win = node.ownerDocument.defaultView;
  const xml = new win.XMLSerializer().serializeToString(node).replace(BAD_XML, '');
  return `<svg xmlns="${SVG_NS}" width="${Math.ceil(w * scale)}" height="${Math.ceil(h * scale)}"><foreignObject width="100%" height="100%">`
    + `<div xmlns="${XHTML}" style="width:${w}px;height:${h}px;overflow:hidden;transform:scale(${scale});transform-origin:0 0">${xml}</div></foreignObject></svg>`;
}

/** SVG 문서를 그림으로 읽는다 — data: 주소로(같은 출처라 캔버스가 더럽혀지지 않는다). */
function loadSvg(svg, win) {
  return new Promise((resolve, reject) => {
    const img = new win.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('고른 부분을 그림으로 읽지 못했습니다'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** 번호 딱지 — 고르기 막의 번호와 같은 모양(파란 네모에 흰 숫자). */
function badge(ctx, x, y, n) {
  const w = 22;
  ctx.save();
  ctx.fillStyle = '#007aff';
  ctx.beginPath();
  ctx.roundRect(x, y, w + (n >= 10 ? 6 : 0), w, [3, 0, 7, 0]);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x + (w + (n >= 10 ? 6 : 0)) / 2, y + w / 2 + 1);
  ctx.restore();
}

/**
 * 고른 요소들을 PNG 한 장으로 — 세로로 잇고(gap), 둘레에 여백(pad), 여러 개면 번호 딱지. 바탕은 body 의 바탕색.
 * @param {Element[]} els
 * @param {{scale?: number, pad?: number, gap?: number}} [opts]
 * @returns {Promise<Blob>}
 */
export async function renderPng(els, { scale = 0, pad = 12, gap = 14 } = {}) {
  if (!els.length) throw new Error('고른 것이 없습니다');
  const doc = els[0].ownerDocument;
  const win = doc.defaultView;
  const k = scale || Math.min(win.devicePixelRatio || 1, MAX_SCALE);
  const defaults = openDefaults(doc);
  let imgs;
  const parts = [];
  try {
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, Math.ceil(r.width));
      const h = Math.max(1, Math.ceil(r.height));
      const node = await cloneStyled(el, defaults, { root: true, w, h });
      parts.push({ w, h, svg: svgOf(node, w, h, k) });
    }
    imgs = await Promise.all(parts.map((p) => loadSvg(p.svg, win)));
  } finally {
    defaults.close();
  }
  const W = Math.max(...parts.map((p) => p.w)) + pad * 2;
  const H = parts.reduce((s, p) => s + p.h, 0) + gap * (parts.length - 1) + pad * 2;
  const canvas = doc.createElement('canvas');
  canvas.width = Math.ceil(W * k);
  canvas.height = Math.ceil(H * k);
  const ctx = canvas.getContext('2d');
  ctx.scale(k, k);
  const bg = win.getComputedStyle(doc.body).backgroundColor;
  ctx.fillStyle = !bg || bg === 'transparent' || /^rgba\(.*,\s*0\)$/.test(bg) ? '#f5f5f7' : bg;
  ctx.fillRect(0, 0, W, H);
  let y = pad;
  parts.forEach((p, i) => {
    ctx.drawImage(imgs[i], pad, y, p.w, p.h);
    if (parts.length > 1) badge(ctx, pad, y, i + 1);
    y += p.h + gap;
  });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 로 만들지 못했습니다'))), 'image/png'));
}

/** 클립보드에 못 넣었을 때 — PNG 파일로 내려 둔다. */
function saveBlob(blob, doc) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const a = doc.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `panel-capture-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/* ------------------------------------------------------------ 고르기 막 */

/**
 * 패널 위에 고르기 막을 씌운다. 가리키면 점선 칸과 이름, 누르면 번호가 붙고 다시 누르면 뺀다(여러 개), 끌어 네모를 그으면 그 안에 통째로 든 것들을 더한다.
 * ↑ 한 겹 큰 칸 · ↓ 작은 칸 · Esc 끝.
 * 띠의 코드 복사는 codeOf 를 글로, 이미지 복사는 renderPng 를 PNG 로 클립보드에 넣는다. 복사한 뒤에도 막은 남는다(코드와 이미지를 이어 복사하게).
 * @param {{doc?: Document, head?: string, hitAt?: (x: number, y: number) => Element[], clipboard?: {writeText: Function, write: Function},
 *   render?: (els: Element[]) => Promise<Blob>, onCopy?: (r: {kind: 'code'|'image', count: number, ok: boolean, error?: Error}) => void,
 *   onChange?: (els: Element[]) => void, onEnd?: () => void}} [opts] hitAt·clipboard·render 는 검사가 갈아 끼운다, onChange 는 고른 것이 바뀔 때마다(Help Chat 에 붙이기)
 * @returns {{cancel: () => void, chosen: () => Element[], host: HTMLElement}}
 */
export function startPick({ doc = document, head = '', hitAt = null, clipboard = null, render = renderPng, onCopy = null, onChange = null, onEnd = null } = {}) {
  const win = doc.defaultView;
  const clip = clipboard || win.navigator.clipboard;
  const hit = hitAt || ((x, y) => doc.elementsFromPoint(x, y));
  const host = doc.createElement('div');
  host.className = 'pcap';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-label', '패널 캡처');
  host.innerHTML = `<div class="pcap-veil"></div><div class="pcap-marks"></div><div class="pcap-pre"></div><div class="pcap-box pcap-hover" hidden><span class="pcap-tag"></span></div>
    <div class="pcap-box pcap-drag" hidden><span class="pcap-tag"></span></div>
    <div class="pcap-bar"><span class="pcap-n"><b></b><small></small></span>
    <button type="button" class="pcap-go pcap-code" disabled title="고른 부분의 HTML(입력칸의 값 포함)과 자리(선택자 경로)를 클립보드에 복사합니다">코드 복사</button>
    <button type="button" class="pcap-go pcap-img" disabled title="고른 부분을 PNG 로 그려 클립보드에 복사합니다 — 여러 개면 번호를 붙여 한 장으로">이미지 복사</button>
    <button type="button" class="pcap-no" title="캡처 끝 (Esc)" aria-label="캡처 끝"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div>`;
  const veil = host.querySelector('.pcap-veil');
  const marks = host.querySelector('.pcap-marks');
  const pre = host.querySelector('.pcap-pre');
  const hover = host.querySelector('.pcap-hover');
  const tag = hover.querySelector('.pcap-tag');
  const dragBox = host.querySelector('.pcap-drag');
  const dragTag = dragBox.querySelector('.pcap-tag');
  const big = host.querySelector('.pcap-n b');
  const small = host.querySelector('.pcap-n small');
  const codeBtn = host.querySelector('.pcap-code');
  const imgBtn = host.querySelector('.pcap-img');
  let chosen = [];
  let chain = [];
  let level = 0;
  let last = null;
  let busy = false;
  let saidTimer = 0;
  let ended = false;
  /** 누른 채 끄는 중 — { x0, y0: 누른 자리, on: DRAG_MIN 을 넘었다, box: 네모, els: 든 것들 }. 아니면 null. */
  let drag = null;

  /** 고를 것 — 보이는 크기가 있고 display 가 inline 이 아닌 것(상자), 또는 단추·입력칸 같은 태그. */
  function isUnit(n) {
    if (!(n instanceof win.Element)) return false;
    const r = n.getBoundingClientRect();
    if (r.width < MIN || r.height < MIN) return false;
    const d = win.getComputedStyle(n).display;
    if (d === 'none' || d === 'contents') return false;
    return d !== 'inline' || UNIT_TAGS.test(n.tagName);
  }
  /** 그 자리의 것들 — 안쪽부터 바깥으로(body 는 빼고). 아이콘(svg) 안이면 그것을 품은 HTML 요소부터. 고를 것이 없으면 맞은 요소 하나. */
  function chainAt(x, y) {
    let e = (hit(x, y) || []).find((n) => !host.contains(n)) || null;
    while (e && e.namespaceURI !== XHTML) e = e.parentElement;
    const out = [];
    for (let n = e; n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) if (isUnit(n)) out.push(n);
    if (!out.length && e && e !== doc.body && e !== doc.documentElement) out.push(e);
    return out;
  }
  /**
   * 끌어 그은 네모 안에 통째로 든 것들 — 문서 차례. 바깥부터 살펴 든 것은 안을 더 보지 않는다(카드가 통째로 들면 카드 하나, 그 안의 칸들은 아니다).
   * 숨은 가지(display: none)는 건너뛴다 — display: contents 는 상자가 없어도 안에 보이는 것이 있으니 들어간다.
   * @param {{left: number, top: number, right: number, bottom: number}} box
   */
  function unitsIn(box) {
    const out = [];
    const inside = (r) => r.left >= box.left - SLACK && r.top >= box.top - SLACK && r.right <= box.right + SLACK && r.bottom <= box.bottom + SLACK;
    const walk = (n) => {
      for (const ch of n.children) {
        if (ch === host || ch.namespaceURI !== XHTML) continue;
        if (isUnit(ch) && inside(ch.getBoundingClientRect())) out.push(ch);
        else if (win.getComputedStyle(ch).display !== 'none') walk(ch);
      }
    };
    walk(doc.body);
    return out;
  }
  const place = (node, el) => {
    const r = el.getBoundingClientRect();
    Object.assign(node.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    return r;
  };
  /** 떨어져 나간 것(패널이 다시 그려졌다)은 뺀다. */
  const live = () => (chosen = chosen.filter((el) => el.isConnected));
  function paintHover() {
    const el = drag?.on ? null : chain[level];   // 끄는 동안은 네모만
    hover.hidden = !el;
    if (!el) return;
    const r = place(hover, el);
    tag.classList.toggle('in', r.top < 24);
    tag.textContent = `${chosen.includes(el) ? '누르면 빼기' : '누르면 고르기'} · ${labelOf(el)}`
      + `${level < chain.length - 1 ? ' · ↑' : ''}${level > 0 ? ' · ↓' : ''}`;
  }
  function paintMarks() {
    marks.replaceChildren(...live().map((el, i) => {
      const d = doc.createElement('div');
      d.className = 'pcap-box';
      const b = doc.createElement('b');
      b.textContent = String(i + 1);
      d.append(b);
      place(d, el);
      return d;
    }));
  }
  function paintBar() {
    const n = chosen.length;
    host.classList.remove('pcap-said', 'pcap-fail');
    big.textContent = busy ? '그리는 중…' : n ? `${n}개 골랐습니다` : '캡처할 곳을 누르세요';
    small.textContent = n ? '다시 누르면 빼기 · 끌면 더 고름 · ↑↓ 칸 크기 · Esc 끝' : '눌러 하나 · 끌어 여러 개 · ↑↓ 칸 크기 · Esc 끝';
    codeBtn.disabled = imgBtn.disabled = !n || busy;
  }
  /** 띠에 잠깐 띄우는 말 — 복사했다·못 했다. 지나면 원래 글로. */
  function say(text, ok = true) {
    win.clearTimeout(saidTimer);
    big.textContent = text;
    host.classList.toggle('pcap-said', ok);
    host.classList.toggle('pcap-fail', !ok);
    saidTimer = win.setTimeout(() => { if (!ended) paintBar(); }, ok ? SAID_MS : SAID_MS * 2);
  }
  function aim() {
    if (!last) return;
    const c = chainAt(last[0], last[1]);
    if (c[0] !== chain[0]) level = 0;
    chain = c;
    level = Math.min(level, Math.max(chain.length - 1, 0));
  }
  const onMove = (e) => {
    last = [e.clientX, e.clientY];
    aim();
    paintHover();
  };
  const onScroll = () => {
    aim();
    paintHover();
    paintMarks();
    if (drag?.on) { drag.els = unitsIn(drag.box); paintDrag(); }   // 네모는 화면에 붙어 있고 패널이 움직였다
  };
  const onKey = (e) => {
    if (e.key === 'Escape') finish();
    else if (e.key === 'ArrowUp') { if (level < chain.length - 1) level++; paintHover(); }
    else if (e.key === 'ArrowDown') { if (level > 0) level--; paintHover(); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  async function copyCode() {
    const els = live();
    if (!els.length) return;
    const text = codeOf(els, { head });
    try {
      await clip.writeText(text);
      say(`코드 복사됨 · ${els.length}곳`);
      onCopy?.({ kind: 'code', count: els.length, ok: true });
    } catch (error) {
      say(`복사하지 못했습니다 — ${error.message}`, false);
      onCopy?.({ kind: 'code', count: els.length, ok: false, error });
    }
  }
  async function copyImage() {
    const els = live();
    if (!els.length || busy) return;
    busy = true;
    paintBar();
    let blob = null;
    try {
      blob = await render(els);
      busy = false;
      try {
        await clip.write([new win.ClipboardItem({ 'image/png': blob })]);
        say(`이미지 복사됨 · ${els.length}곳`);
        onCopy?.({ kind: 'image', count: els.length, ok: true });
      } catch (error) {
        saveBlob(blob, doc);
        say('클립보드에 넣지 못해 PNG 파일로 내려 두었습니다', false);
        onCopy?.({ kind: 'image', count: els.length, ok: false, error });
      }
    } catch (error) {
      busy = false;
      say(`그리지 못했습니다 — ${error.message}`, false);
      onCopy?.({ kind: 'image', count: els.length, ok: false, error });
    }
    if (!ended) { codeBtn.disabled = imgBtn.disabled = !chosen.length; }
  }
  /** 그 자리의 것(가리키던 칸)을 고르거나 뺀다. */
  function toggleAt(e) {
    onMove(e);
    const el = chain[level];
    if (!el) return;
    const i = chosen.indexOf(el);
    if (i >= 0) chosen.splice(i, 1);
    else chosen.push(el);
    paintMarks();
    paintBar();
    paintHover();
    onChange?.(live());
  }
  /* 끌기 — 막에서 누르면 시작하고, 창에서 움직임·놓음을 받는다(막 밖으로 나가도 이어진다). DRAG_MIN 넘게 움직이면 네모를 그리며 든 것들을 미리 보이고,
     놓으면 그것들을 더한다. 안 움직이고 막 위에서 놓았으면 누른 것이다. */
  const boxOf = (x0, y0, x1, y1) => ({ left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) });
  function paintDrag() {
    const b = drag.box;
    Object.assign(dragBox.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.right - b.left}px`, height: `${b.bottom - b.top}px` });
    dragBox.hidden = false;
    dragTag.classList.toggle('in', b.top < 24);
    const fresh = drag.els.filter((el) => !chosen.includes(el));
    dragTag.textContent = fresh.length ? `놓으면 ${fresh.length}개 고르기` : drag.els.length ? '이미 고른 것입니다' : '통째로 든 것이 없습니다';
    pre.replaceChildren(...fresh.map((el) => {
      const d = doc.createElement('div');
      d.className = 'pcap-box pcap-in';
      place(d, el);
      return d;
    }));
  }
  const onDragMove = (e) => {
    if (!drag.on) {
      if (Math.abs(e.clientX - drag.x0) < DRAG_MIN && Math.abs(e.clientY - drag.y0) < DRAG_MIN) return;
      drag.on = true;
      paintHover();
    }
    drag.box = boxOf(drag.x0, drag.y0, e.clientX, e.clientY);
    drag.els = unitsIn(drag.box);
    paintDrag();
  };
  const onDragEnd = (e) => {
    const d = drag;
    if (d.on) {
      d.box = boxOf(d.x0, d.y0, e.clientX, e.clientY);
      d.els = unitsIn(d.box);
    }
    stopDrag();
    if (d.on) {
      const before = chosen.length;
      for (const el of d.els) if (!chosen.includes(el)) chosen.push(el);
      paintMarks();
      paintBar();
      onMove(e);
      if (chosen.length > before) onChange?.(live());
    } else if (e.target === veil) toggleAt(e);
  };
  function stopDrag() {
    if (!drag) return;
    drag = null;
    win.removeEventListener('mousemove', onDragMove, true);
    win.removeEventListener('mouseup', onDragEnd, true);
    dragBox.hidden = true;
    pre.replaceChildren();
  }
  veil.addEventListener('mousemove', onMove);
  veil.addEventListener('mouseleave', () => { if (drag?.on) return; chain = []; last = null; paintHover(); });
  veil.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (e.button !== 0 || drag) return;
    drag = { x0: e.clientX, y0: e.clientY, on: false, box: null, els: [] };
    win.addEventListener('mousemove', onDragMove, true);
    win.addEventListener('mouseup', onDragEnd, true);
  });
  veil.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });   // 고르기는 mouseup 에서 — 막 아래의 "바깥 누름" 듣는 것들에 가지 않게
  codeBtn.addEventListener('click', copyCode);
  imgBtn.addEventListener('click', copyImage);
  host.querySelector('.pcap-no').addEventListener('click', () => finish());
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('scroll', onScroll, true);
  win.addEventListener('resize', onScroll);

  function finish() {
    if (ended) return;
    ended = true;
    win.clearTimeout(saidTimer);
    stopDrag();
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('scroll', onScroll, true);
    win.removeEventListener('resize', onScroll);
    host.remove();
    onEnd?.();
  }
  doc.body.append(host);
  paintBar();
  return { cancel: finish, chosen: () => [...live()], host };
}
