// 웹페이지를 캡처한다 — 공문 탭의 문서 넣는 곳과 출장 카드의 증빙 넣는 곳 아래의 두 단추(webpick.js, 2026-10-08 사용자 지정:
// "현재 보고 있는 탭 아이콘 하나.. 그리고 부분적으로 선택할 수 있는 버튼 하나").
//   · 보고 있는 탭 — 그 탭을 위에서 아래까지 통째로(captureFront → captureTabs).
//   · 부분 골라 캡처 — 페이지 위에 고르기 막을 씌워 프레임(틀·상자)을 눌러 하나 이상 고르고(pagePick), 고른 것만 잘라 찍는다
//     (captureTabParts → captureParts → capturePart). eClass 포털처럼 본문이 틀(iframe) 안에서 따로 내려가는 화면은 틀 안을 내려가며 찍는다.
// 여러 탭을 차례로 앞에 두고 찍는 길(captureMany)은 보고 있는 탭 하나를 찍을 때도 그대로 쓴다(탭 목록에서 고르던 때의 것 — 2026-10-08 앞서).
//
// 2026-10-15 사용자 지정: "첨부파일을 열면 내용이 팝업으로 뜨는데 그 부분도 일부 또는 전체 캡쳐할 수 있나?" — 세 갈래를 더했다.
//   · 페이지 위에 뜬 큰 팝업(새 Outlook 의 첨부 미리보기 대화상자 같은 것 — role=dialog·aria-modal·<dialog open>·modal 이름, 창의 35% 이상)이
//     있으면 "전체"는 뒤의 페이지가 아니라 그 팝업 안을 찍는다(captureWhole → modalProbe → capturePart). 팝업이 틀(iframe)이면 틀 안을,
//     아니면 팝업의 스크롤 칸을 내려가며 찍는다.
//   · 틀 문서가 내려가지 않고 안쪽 칸이 내려가는 미리보기(Word·PDF 보기)는 그 칸(scrollerInfo — 틀 안의 가장 큰 스크롤 칸)을 내린다.
//     PowerPoint 읽기 보기처럼 한 장씩 넘기는 화면은 넘기지 않고 보이는 장만 찍고 paged 로 알린다.
//   · 첨부를 따로 띄운 팝업 창(window.open — chrome 창 type 'popup')을 방금 보다가 패널을 눌렀으면 그 창을 찍는다(watchWindows → frontTab).
// 같은 날 사용자 지정: "전체 하면 메일이랑 첨부를 같이 가져오고.. 첨부는 파일 자체로 관리하지만 ocr 해서 이것도 필요한 내용으로 넣는 거지.
// 부분으로 첨부파일 클릭하면 첨부파일만 가져오고." — 메일인지·첨부는 무엇인지는 src/mailgrab.js 가 보고(webpick.js 가 잇는다), 여기는
// 그 자리를 낸다: captureFront 의 plain(팝업이 없을 때 먼저 불러 보는 길), startPick 의 before(막을 씌우기 전에 첨부 칸에 표시),
// pagePick 의 첨부 칸 고르기(data-krs-attach → attach), 표시 떼기(unmarkPage·clearMarks).
//
// chrome.tabs.captureVisibleTab 은 보이는 만큼만 찍는다. 그래서 탭 안에서 한 화면씩 내려가며 찍고(초당 두 장 제한 — SHOT_GAP_MS), 찍은 것을
// 한 장으로 이어 A4 비율(가로 : 세로 = 210 : 297)로 자른다 — 그 장들이 공문 읽기(src/llm.js 의 gongmunSmart)에 가고, 그대로 첨부 PDF
// (src/pdf.js 의 buildPdf — 한 장에 한 쪽)가 된다. 같이 그 화면의 글자(innerText)도 가져온다 — 화면의 글자는 OCR 보다 정확하다.
// 로컬 CLI 다리는 그림을 OCR 한 글자를 그림과 같이 보낸다(native/host.mjs → native/doctext.mjs).
//
// 여기는 두 층이다. capturePage(탭 하나)·captureMany(고른 탭들)·capturePart(고른 부분 하나)·captureParts 는 찍는 차례(탭에서 돌릴 함수·
// 찍기·잇기·탭 바꾸기를 밖에서 받는다 — 테스트가 갈아 끼운다)이고, captureFront·startPick·captureTabParts·captureTabs 가 chrome API 를
// 그 자리에 꽂는다. pageInfo·pageStep·pageDone·pagePick·pickCancel·frameProbe·frameKids·partInfo·partStep·partDone·modalProbe·
// scrollerInfo·scrollerStep·scrollerDone·unmarkPage 는 chrome.scripting 이 **글자 그대로** 탭에 옮겨 돌리는 함수다 — 바깥 변수를 쓰면 안 된다.

/** 한 번에 찍는 화면 수의 한도 — 끝없이 이어지는 화면(무한 스크롤)을 끝까지 쫓지 않는다. */
export const MAX_SHOTS = 30;
/** 찍기 사이의 틈 — captureVisibleTab 은 초당 두 장까지고, 내려간 뒤 늦게 그려지는 것(지연 로딩 그림)도 기다린다. */
export const SHOT_GAP_MS = 600;
/** 저장하는 배율의 한도 — 고배율 화면(devicePixelRatio 2 이상)을 그대로 두면 장마다 수 MB 가 된다. */
export const MAX_SCALE = 2;
/** A4 의 세로/가로. */
export const A4_RATIO = 297 / 210;
/** 화면 글자의 한도 — 다리는 입력을 2만 자에서 자르고(native/host.mjs), 머리말(품의 종류·파일 이름)이 앞에 붙는다. 탭을 여럿 고르면 나눠 쓴다. */
export const TEXT_MAX = 18000;
/** 탭마다 글자에 붙는 머리말([웹페이지 글자 — 제목] 주소)과 이음 줄의 몫 — 여러 탭의 글자를 합쳐도 TEXT_MAX 안에 들게 뺀다. */
const TEXT_HEAD = 300;
/** 앞에 둔 탭이 다 읽힐 때까지 기다리는 한도 — 잠든 탭(discarded)은 앞에 두면 다시 읽는다. */
const READY_MS = 15000;
/** 팝업 창을 "방금 보던 창"으로 치는 한도 — 그 창에서 패널로 넘어온 지 이만큼 안이면 그 창을 찍는다(2026-10-15). */
export const POPUP_RECENT_MS = 60000;

/* ------------------------------------------------------------ 탭 안에서 도는 함수 */

/**
 * 페이지의 크기와 글자. 글자는 body 의 innerText(보이는 글자만 — 숨은 메뉴·스크립트는 빠진다)이고, 그것이 없는 환경이면 textContent 다.
 * 글자는 여기서 넉넉히 자르고, 다듬는 것은 normalizeText 가 한다.
 */
export function pageInfo() {
  const doc = document.documentElement;
  const body = document.body;
  const raw = body ? (body.innerText ?? body.textContent) : '';
  return {
    url: location.href,
    title: document.title || '',
    scrollHeight: Math.max(doc ? doc.scrollHeight : 0, body ? body.scrollHeight : 0),
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    dpr: window.devicePixelRatio || 1,
    scrollY: window.scrollY,
    text: String(raw || '').slice(0, 60000),
  };
}

/**
 * 한 화면 내려간다. 두 번째 장부터는 고정된 띠(position: fixed·sticky — 머리 메뉴·채팅 단추·쿠키 안내)를 숨긴다 — 장마다 되풀이해
 * 찍히지 않게. 숨긴 것과 원래 스크롤 방식은 window.__krsCap 에 두었다가 pageDone 이 되돌린다. 실제로 선 자리를 돌려준다
 * (끝에서는 바라던 자리보다 덜 내려간다).
 */
export function pageStep(y, hideFixed) {
  const html = document.documentElement;
  const keep = (window.__krsCap ||= { behavior: html.style.scrollBehavior, hidden: [] });
  html.style.scrollBehavior = 'auto';
  if (hideFixed && !keep.hidden.length && document.body) {
    for (const el of document.body.querySelectorAll('*')) {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      keep.hidden.push([el, el.style.visibility]);
      el.style.visibility = 'hidden';
    }
  }
  window.scrollTo(0, y);
  return window.scrollY;
}

/** 다 찍었다 — 숨긴 것과 스크롤 방식·자리를 되돌린다. */
export function pageDone(y) {
  const keep = window.__krsCap;
  if (keep) {
    for (const [el, v] of keep.hidden) el.style.visibility = v;
    document.documentElement.style.scrollBehavior = keep.behavior;
    delete window.__krsCap;
  }
  window.scrollTo(0, y);
}

/**
 * 페이지 위에서 찍을 부분을 고르게 한다(2026-10-08 사용자 지정: "탭이 아니라 프레임으로 선택"). 페이지에 투명한 막을 씌우고, 마우스가
 * 가리키는 프레임(틀 iframe·테두리나 그림자나 바탕색이 있는 상자·표·스크롤 상자 …)에 점선 칸을 그린다. 누르면 고르고(번호가 붙는다)
 * 다시 누르면 뺀다 — 여러 개 고를 수 있다. ↑ 는 한 겹 큰 칸, ↓ 는 다시 작은 칸이다. 막이 위에 있어 틀 안을 눌러도 틀 자체가 골라진다.
 * 위쪽 띠의 캡처(Enter)를 누르면 고른 차례대로 요소에 data-krs-cap="번호" 를 달고 그 목록을, 취소(Esc)면 null 을 준다 —
 * executeScript 는 이 약속이 풀릴 때까지 기다린다. 막은 shadow DOM 이라 페이지의 CSS 와 섞이지 않는다.
 * 2026-10-15 사용자 지정: "부분으로 첨부파일 클릭하면 첨부파일만 가져오고" — 메일 읽기(src/mailgrab.js 의 probeTab)가 첨부 칸에 단
 * data-krs-attach="열쇠" 칸은 작아도 고를 수 있고(그 안을 가리켜도 그 칸), 띠의 이름은 "첨부 파일 · 이름"(names — 열쇠별 이름)이다.
 * 고른 첨부 칸은 data-krs-cap 을 달지 않고 attach(열쇠)로 준다 — 찍지 않고 파일 자체를 가져온다.
 * @param {Object<string, string>|null} [names] 첨부 열쇠별 파일 이름
 * @returns {Promise<{n: number, tag: string, title: string, frame: {href: string|null, src: string, name: string, w: number, h: number}|null,
 *   attach?: string}[]|null>}
 */
export function pagePick(names = null) {
  window.__krsPick?.cancel();
  return new Promise((resolve) => {
    const MIN_W = 120;
    const MIN_H = 40;
    const FRAME = /^(IFRAME|FRAME|EMBED|OBJECT|CANVAS|VIDEO|IMG)$/i;
    const BLOCK = /^(TABLE|SECTION|ARTICLE|MAIN|ASIDE|FORM|FIELDSET|FIGURE|DIALOG)$/;
    const NAMED = /(^|[\s_-])(card|panel|box|portlet|widget|module|frame|section|article|content|container|board|modal|dialog)/i;
    const ATTACH = 'data-krs-attach';
    const isAttach = (el) => el instanceof Element && el.hasAttribute(ATTACH);
    /** 첨부 칸의 파일 이름 — 메일 읽기가 준 이름, 없으면 칸의 title·aria-label·첫 줄. */
    const attachName = (el) => String((names && names[el.getAttribute(ATTACH)]) || el.getAttribute('title') || el.getAttribute('aria-label')
      || String(el.innerText ?? el.textContent ?? '').trim().split('\n')[0] || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const host = document.createElement('div');
    host.setAttribute('data-krs-pick', '');
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';
    const sh = host.attachShadow({ mode: 'open' });
    const CSS = `
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif; }
      .veil { position: fixed; inset: 0; cursor: crosshair; }
      .box { position: fixed; pointer-events: none; border: 2px solid #007aff; border-radius: 3px; background: rgba(0, 122, 255, .14); }
      .box.hover { border-style: dashed; background: rgba(0, 122, 255, .06); }
      .box b { position: absolute; top: -2px; left: -2px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 3px 0 7px 0; background: #007aff; color: #fff; font-size: 13px; font-weight: 700; line-height: 22px; text-align: center; }
      .tag { position: absolute; bottom: 100%; left: -2px; margin-bottom: 3px; padding: 1px 7px; border-radius: 5px; background: #1d1d1f; color: #fff; font-size: 12px; line-height: 19px; white-space: nowrap; }
      .tag.in { bottom: auto; top: 3px; left: 3px; margin: 0; }
      .bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; width: max-content; max-width: calc(100vw - 24px); padding: 8px 10px 8px 14px; border-radius: 12px; background: #1d1d1f; color: #fff; font-size: 13px; line-height: 1.4; box-shadow: 0 6px 24px rgba(0, 0, 0, .28); }
      .bar span { min-width: 0; }
      .bar small { display: block; color: #b9b9c2; font-size: 12px; }
      .bar button { flex: none; min-height: 30px; padding: 4px 12px; border: 0; border-radius: 8px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
      .go { background: #007aff; }
      .go:disabled { opacity: .45; cursor: default; }
      .no { background: #3a3a3f; }`;
    // 모양은 만들어 붙이는 스타일시트로 준다 — 페이지의 CSP(style-src)가 <style> 을 막아도 막이 흐트러지지 않게. 못 만들면 <style>.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      sh.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      sh.append(style);
    }
    sh.innerHTML += `<div class="veil"></div><div class="marks"></div><div class="box hover" hidden><span class="tag"></span></div>
    <div class="bar"><span>캡처할 부분을 누르세요 — 여러 개 고를 수 있습니다<small>↑ 더 큰 칸 · ↓ 작은 칸 · 다시 누르면 빼기 · Enter 캡처 · Esc 취소</small></span>
    <button type="button" class="go" disabled>캡처</button><button type="button" class="no">취소</button></div>`;
    const veil = sh.querySelector('.veil');
    const marks = sh.querySelector('.marks');
    const hover = sh.querySelector('.box.hover');
    const tag = sh.querySelector('.tag');
    const go = sh.querySelector('.go');
    const chosen = [];
    let chain = [];
    let level = 0;
    let last = null;

    const clear = (c) => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c);
    /** 프레임으로 볼 것 — 틀·그림, 큰 덩어리 태그, 스크롤 상자, 테두리(세 면 이상)·그림자·둘레와 다른 바탕색, 카드·패널 같은 이름. */
    function isFrame(el) {
      if (!(el instanceof Element) || el === document.documentElement || el === document.body) return false;
      if (isAttach(el)) return true;   // 첨부 파일 칸 — 작아도 고른다
      const r = el.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) return false;
      if (FRAME.test(el.tagName)) return true;
      const cs = getComputedStyle(el);
      if (cs.display === 'contents' || cs.display.startsWith('inline') || cs.display.startsWith('table-')) return false;
      if (BLOCK.test(el.tagName)) return true;
      if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll|overlay)/.test(cs.overflowY)) return true;
      const sides = ['Top', 'Right', 'Bottom', 'Left']
        .filter((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none' && !clear(cs[`border${s}Color`]));
      if (sides.length >= 3 || (cs.boxShadow && cs.boxShadow !== 'none')) return true;
      if (!clear(cs.backgroundColor)) {
        let p = el.parentElement;
        let bg = '';
        while (p && clear(bg = getComputedStyle(p).backgroundColor)) p = p.parentElement;
        if ((p ? bg : 'rgb(255, 255, 255)') !== cs.backgroundColor) return true;
      }
      const cls = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
      return NAMED.test(cls) || NAMED.test(el.id || '');
    }
    /** 그 자리의 프레임들 — 안쪽부터 바깥으로(첨부 칸 안이면 그 칸이 맨 앞 — 칸 안의 그림 따위는 빼고). 프레임이 없으면 넉넉한 크기의 가장 안쪽 요소 하나. */
    function chainAt(x, y) {
      const hit = document.elementsFromPoint(x, y).find((e) => e !== host);
      let out = [];
      for (let e = hit; e && e !== document.documentElement; e = e.parentElement) if (isFrame(e)) out.push(e);
      const card = hit instanceof Element ? hit.closest(`[${ATTACH}]`) : null;
      if (card) out = [card, ...out.filter((e) => e !== card && !card.contains(e))];
      for (let e = hit; !out.length && e && e !== document.documentElement && e !== document.body; e = e.parentElement) {
        const r = e.getBoundingClientRect();
        if (r.width >= MIN_W && r.height >= MIN_H) out.push(e);
      }
      return out;
    }
    const place = (node, el) => {
      const r = el.getBoundingClientRect();
      Object.assign(node.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      return r;
    };
    const kindOf = (el) => (/^(IFRAME|FRAME)$/.test(el.tagName) ? '틀' : el.tagName === 'TABLE' ? '표' : FRAME.test(el.tagName) ? '그림' : '칸');
    function paintHover() {
      const el = chain[level];
      hover.hidden = !el;
      if (!el) return;
      const r = place(hover, el);
      tag.classList.toggle('in', r.top < 26);
      const what = isAttach(el) ? `첨부 파일 · ${attachName(el) || '이름 없음'}` : `${kindOf(el)} ${Math.round(r.width)}×${Math.round(r.height)}`;
      tag.textContent = `${chosen.includes(el) ? '누르면 빼기' : '누르면 고르기'} · ${what}`
        + `${level < chain.length - 1 ? ' · ↑ 더 큰 칸' : ''}${level > 0 ? ' · ↓ 작은 칸' : ''}`;
    }
    function paintMarks() {
      marks.replaceChildren(...chosen.map((el, i) => {
        const d = document.createElement('div');
        d.className = 'box';
        const b = document.createElement('b');
        b.textContent = String(i + 1);
        d.append(b);
        place(d, el);
        return d;
      }));
      go.disabled = !chosen.length;
      go.textContent = chosen.length ? `${chosen.length}개 캡처` : '캡처';
    }
    function aim() {
      if (!last) return;
      const c = chainAt(last[0], last[1]);
      if (c[0] !== chain[0]) {
        chain = c;
        level = 0;
      } else chain = c;
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
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(null);
      else if (e.key === 'Enter') { if (chosen.length) finish(chosen); }
      else if (e.key === 'ArrowUp') { if (level < chain.length - 1) level++; paintHover(); }
      else if (e.key === 'ArrowDown') { if (level > 0) level--; paintHover(); }
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    veil.addEventListener('mousemove', onMove);
    veil.addEventListener('mousedown', (e) => e.preventDefault());
    veil.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onMove(e);
      const el = chain[level];
      if (!el) return;
      const i = chosen.indexOf(el);
      if (i >= 0) chosen.splice(i, 1);
      else chosen.push(el);
      paintMarks();
      paintHover();
    });
    go.addEventListener('click', () => finish(chosen));
    sh.querySelector('.no').addEventListener('click', () => finish(null));
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);

    function finish(list) {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      host.remove();
      delete window.__krsPick;
      if (!list?.length) return resolve(null);
      for (const old of document.querySelectorAll('[data-krs-cap]')) {
        if (old.getAttribute('data-krs-cap') !== 'mail') old.removeAttribute('data-krs-cap');   // 메일 본문 표시는 메일 읽기의 것
      }
      return resolve(list.map((el, i) => {
        if (isAttach(el)) return { n: i + 1, tag: el.tagName.toLowerCase(), title: attachName(el), frame: null, attach: el.getAttribute(ATTACH) };
        el.setAttribute('data-krs-cap', String(i + 1));
        const isFrameEl = /^(IFRAME|FRAME)$/.test(el.tagName);
        let href = null;
        let inner = '';
        if (isFrameEl) {
          try {
            href = el.contentWindow.location.href;
            inner = el.contentDocument?.title || '';
          } catch {
            href = null;   // 다른 사이트의 틀 — 주소·제목을 못 본다
          }
        }
        const head = isFrameEl ? null : el.querySelector('h1, h2, h3, h4, caption, legend');
        const first = isFrameEl ? '' : String(el.innerText ?? el.textContent ?? '').trim().split('\n')[0];
        const title = String((isFrameEl ? inner || el.title || el.name : (head && (head.innerText ?? head.textContent)) || first) || '')
          .replace(/\s+/g, ' ').trim().slice(0, 60);
        return {
          n: i + 1, tag: el.tagName.toLowerCase(), title,
          frame: isFrameEl ? { href, src: el.src || '', name: el.name || '', w: el.clientWidth, h: el.clientHeight } : null,
        };
      }));
    }
    window.__krsPick = { cancel: () => finish(null) };
    document.documentElement.append(host);
    paintMarks();
  });
}

/** 페이지 위의 고르기를 그만둔다 — 패널의 고르기 취소. */
export function pickCancel() {
  window.__krsPick?.cancel();
  return true;
}

/**
 * 틀마다 주소·이름·크기 — 고른 틀(iframe)이 어느 frameId 인지 맞춘다(matchFrame·frameTarget). child 는 맨 위 문서 바로 아래의 틀이다.
 * depth 는 맨 위 문서에서 몇 겹 아래인지(window.parent 를 거슬러 센다 — 다른 사이트의 틀이어도 parent·top 은 보인다),
 * scrolls 는 그 틀 안이 내려가는지(문서가 내려가거나, 틀 창의 30% 이상인 스크롤 칸이 있거나 — 2026-10-15: 틀 안의 틀이 내려가는 미리보기).
 */
export function frameProbe() {
  let depth = 0;
  try {
    for (let w = window; w !== w.top && depth < 20; w = w.parent) depth++;
  } catch {
    depth = -1;
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const se = document.scrollingElement || document.documentElement;
  let scrolls = !!se && se.scrollHeight > se.clientHeight + 4;
  if (!scrolls && document.body) {
    for (const el of document.body.querySelectorAll('*')) {
      if (el.clientHeight < 40 || el.scrollHeight <= el.clientHeight + 4 || el.clientWidth * el.clientHeight < vw * vh * 0.3) continue;
      if (/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY)) {
        scrolls = true;
        break;
      }
    }
  }
  return { href: location.href, name: window.name, w: vw, h: vh, child: window !== window.top && window.parent === window.top, depth, scrolls };
}

/** 이 문서 안의 틀(iframe·frame)들의 안쪽 자리(창 기준 x·y, 안쪽 크기 w·h) — 틀 안의 틀을 찍을 때 그 틀이 바깥 틀의 어디에 있는지 맞춘다. */
export function frameKids() {
  return [...document.querySelectorAll('iframe, frame')].map((f) => {
    const r = f.getBoundingClientRect();
    return { x: r.left + f.clientLeft, y: r.top + f.clientTop, w: f.clientWidth, h: f.clientHeight };
  });
}

/**
 * 고른 부분(data-krs-cap="n")의 자리와 글자. edge 는 테두리 안쪽(틀이면 틀 안의 창, 스크롤 상자면 보이는 칸)이고, box 는 안이 따로
 * 내려가는 상자일 때의 높이다. 글자는 그 요소의 innerText(같은 사이트의 틀이면 틀 안의 글자)다.
 */
export function partInfo(n) {
  const el = document.querySelector(`[data-krs-cap="${n}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const isFrameEl = /^(IFRAME|FRAME)$/.test(el.tagName);
  const box = !isFrameEl && el.scrollHeight > el.clientHeight + 4 && /(auto|scroll|overlay)/.test(cs.overflowY);
  let text = '';
  try {
    text = isFrameEl ? el.contentDocument?.body?.innerText || '' : el.innerText || el.textContent || '';
  } catch {
    text = '';
  }
  return {
    url: location.href, title: document.title || '', vw: window.innerWidth, vh: window.innerHeight, scrollY: window.scrollY,
    top: r.top + window.scrollY, width: r.width, height: r.height,
    edge: { top: el.clientTop, left: el.clientLeft, w: el.clientWidth || r.width, h: el.clientHeight || r.height },
    frame: isFrameEl, box: box ? { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight } : null,
    text: String(text).slice(0, 60000),
  };
}

/**
 * 고른 부분을 찍을 자리에 둔다. rel 이 있으면 그 부분의 머리에서 rel 만큼 내려간 곳을 그 부분이 든 스크롤 칸(그 부분을 품은 가장 가까운
 * 스크롤 상자 — 없으면 창)의 맨 위에 둔다(처음에는 scrollIntoView 로 바깥 칸들까지 맞춘다 — 창이 아니라 안쪽 상자가 내려가는 페이지도 있다).
 * inner 가 있으면 그 부분(스크롤 상자) 안을 그만큼 내린다. 처음 한 번 그 부분을 품지도 그 안에 있지도 않은 고정 띠(position: fixed·sticky —
 * 머리 메뉴·채팅 단추)를 숨긴다(부분을 가리지 않게). 그 부분의 창 안 자리와, 보이는 칸(clip — 창과 스크롤 칸이 겹치는 곳)을 돌려준다.
 */
export function partStep(n, rel, inner) {
  const el = document.querySelector(`[data-krs-cap="${n}"]`);
  if (!el) return null;
  const html = document.documentElement;
  const keep = (window.__krsCap ||= { behavior: html.style.scrollBehavior, hidden: [], boxes: [], x: window.scrollX, y: window.scrollY });
  html.style.scrollBehavior = 'auto';
  const save = (b) => {
    if (!keep.boxes.some(([x]) => x === b)) keep.boxes.push([b, b.scrollTop, b.style.scrollBehavior]);
    b.style.scrollBehavior = 'auto';
  };
  let sc = null;
  for (let p = el.parentElement; p && p !== document.body && p !== html; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight + 1 && /(auto|scroll|overlay)/.test(getComputedStyle(p).overflowY)) {
      sc = p;
      break;
    }
  }
  const view = () => {
    if (!sc) return { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
    const r = sc.getBoundingClientRect();
    const top = r.top + sc.clientTop;
    const left = r.left + sc.clientLeft;
    return { top: Math.max(top, 0), left: Math.max(left, 0), bottom: Math.min(top + sc.clientHeight, window.innerHeight), right: Math.min(left + sc.clientWidth, window.innerWidth) };
  };
  if (!keep.hid && document.body) {
    keep.hid = true;
    for (const x of document.body.querySelectorAll('*')) {
      if (x.contains(el) || el.contains(x)) continue;
      const pos = getComputedStyle(x).position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      keep.hidden.push([x, x.style.visibility]);
      x.style.visibility = 'hidden';
    }
  }
  if (rel != null) {
    if (sc) save(sc);
    // 떠 있는 칸(position: fixed 안 — 대화상자·첨부 미리보기, 2026-10-15)은 창을 내려도 움직이지 않는다 — 창은 그대로 둔다.
    let pinned = false;
    for (let p = sc ? null : el; p && p !== html; p = p.parentElement) {
      if (getComputedStyle(p).position === 'fixed') {
        pinned = true;
        break;
      }
    }
    if (!pinned) {
      if (!keep.placed) {
        keep.placed = true;
        el.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
      }
      const d = el.getBoundingClientRect().top - view().top + rel;
      if (sc) sc.scrollTop += d;
      else window.scrollBy(0, d);
    }
  }
  if (inner != null) {
    save(el);
    el.scrollTop = inner;
  }
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height, inner: el.scrollTop, clip: view() };
}

/** 그 부분을 다 찍었다 — 숨긴 띠·스크롤 칸과 상자 안 자리·창 자리를 되돌리고 표시(data-krs-cap)를 뗀다. */
export function partDone(n) {
  const keep = window.__krsCap;
  if (keep) {
    for (const [x, v] of keep.hidden) x.style.visibility = v;
    for (const [b, top, sb] of keep.boxes) {
      b.scrollTop = top;
      b.style.scrollBehavior = sb;
    }
    window.scrollTo(keep.x, keep.y);
    document.documentElement.style.scrollBehavior = keep.behavior;
    delete window.__krsCap;
  }
  document.querySelector(`[data-krs-cap="${n}"]`)?.removeAttribute('data-krs-cap');
}

/**
 * 페이지 위에 뜬 큰 팝업을 찾는다(2026-10-15 사용자 지정: "첨부파일을 열면 내용이 팝업으로 뜨는데 그 부분도 … 캡쳐할 수 있나?").
 * 후보는 <dialog open>·role=dialog·role=alertdialog·aria-modal=true 와, modal·popup·layer-popup·lightbox 같은 이름의 떠 있는 칸
 * (자기나 조상이 position: fixed·absolute)이다. 창 전체를 덮는 반투명 겉칸(Bootstrap 의 .modal)이면 그 안의 불투명한 상자를 팝업으로 본다.
 * 보이고(display·visibility·opacity) 창의 35% 이상을 덮고, 그 자리를 눌렀을 때 맨 위에 있는 것 가운데 가장 위(z-index·나중 것)를 고른다.
 * 그 팝업이 틀(iframe)로 거의 차 있으면(60% 이상) 그 틀을, 아니면 팝업의 스크롤 칸을, 그것도 없으면 팝업 자체를 찍을 것으로 삼아
 * data-krs-cap="popup" 을 단다(partInfo·partStep·partDone 이 그대로 쓴다). 팝업이 없으면 null — 아무것도 달지 않는다.
 * label 은 파일 이름 꼴의 제목이나 문서 보기 틀이 있으면 "첨부 미리보기 창", 아니면 "팝업"이다.
 * @returns {{n: string, kind: 'frame'|'box'|'plain', label: string, title: string, cover: number,
 *   frame: {href: string|null, src: string, name: string, w: number, h: number}|null}|null}
 */
export function modalProbe() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const VIEW = vw * vh;
  if (!(VIEW > 0) || !document.body) return null;
  for (const old of document.querySelectorAll('[data-krs-cap="popup"]')) old.removeAttribute('data-krs-cap');
  const STRONG = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
  const NAMED = /(^|[\s_-])(modal|popup|pop-?layer|layer-?pop(up)?|lightbox|ui-dialog|dialog)([\s_-]|$)/i;
  const NOT = /(^|[\s_-])(backdrop|overlay|mask|dim|bg|open|close|btn|button|header|footer|title|body|trigger|toggle|icon)([\s_-]|$)/i;
  const FRAMES = /^(IFRAME|FRAME)$/;
  const SOLID = /^(IFRAME|FRAME|IMG|VIDEO|CANVAS|EMBED|OBJECT)$/;
  const FILE = /[^\s\\/:*?"<>|]+\.(pdf|hwpx?|docx?|xlsx?|pptx?|txt|csv|rtf|odt|ods|odp|jpe?g|png|gif|bmp|tiff?|zip|eml|msg)$/i;
  const VIEWER = /officeapps|viewer|preview|attach|docview|pdf/i;
  const clsOf = (el) => (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '');
  const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const x = Math.max(r.left, 0);
    const y = Math.max(r.top, 0);
    const w = Math.max(0, Math.min(r.left + r.width, vw) - x);
    const h = Math.max(0, Math.min(r.top + r.height, vh) - y);
    return { x, y, w, h, cover: (w * h) / VIEW };
  };
  const alpha = (c) => {
    if (!c || c === 'transparent') return 0;
    const m = String(c).match(/rgba?\(([^)]*)\)/);
    if (!m) return 1;
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    return p.length > 3 ? parseFloat(p[3]) : 1;
  };
  const shown = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const o = parseFloat(getComputedStyle(p).opacity);
      if (o < 0.05) return false;
    }
    return true;
  };
  const floating = (el) => {
    if (el.tagName === 'DIALOG') return true;
    for (let p = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === 'fixed' || pos === 'absolute') return true;
    }
    return false;
  };
  const scrolls = (el) => el.scrollHeight > el.clientHeight + 4 && el.clientHeight >= 40 && /(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY);
  /** 창을 다 덮는 반투명 겉칸이면 그 안의 불투명한 상자(그림자·틀·그림도) 가운데 가장 큰 것 — 없으면 그 칸 자체. */
  const surface = (el) => {
    const b = box(el);
    if (b.cover < 0.95 || alpha(getComputedStyle(el).backgroundColor) >= 0.9) return [el, b];
    let best = null;
    const walk = [...el.children];
    for (let n = 0; walk.length && n < 800; n++) {
      const d = walk.shift();
      const db = box(d);
      const cs = getComputedStyle(d);
      if (db.cover < 0.95 && db.cover > 0.01 && (alpha(cs.backgroundColor) >= 0.9 || (cs.boxShadow && cs.boxShadow !== 'none') || SOLID.test(d.tagName))) {
        if (!best || db.cover > best[1].cover) best = [d, db];
        continue;   // 상자를 찾으면 그 안은 더 보지 않는다
      }
      walk.push(...d.children);
    }
    return best || [el, b];
  };
  const cands = new Set(document.querySelectorAll(STRONG));
  for (const el of document.body.querySelectorAll('[class]')) {
    const c = clsOf(el);
    if (NAMED.test(c) && !NOT.test(c)) cands.add(el);
  }
  // 빈 칸(글자도 그림·틀도 없는 투명한 덮개)은 팝업이 아니다.
  const filled = (s) => SOLID.test(s.tagName) || !!clean(s.textContent) || !!s.querySelector('iframe, frame, img, video, canvas, embed, object, svg');
  const found = new Map();
  for (const el of cands) {
    if (el.closest('[data-krs-pick]') || !floating(el) || !shown(el)) continue;
    const [s, b] = surface(el);
    if (b.cover >= 0.35 && shown(s) && filled(s)) found.set(s, b);
  }
  // 겹친 것은 바깥 것 하나(modal-content 안의 modal-body 를 따로 세지 않는다).
  const list = [...found.keys()].filter((s) => ![...found.keys()].some((o) => o !== s && o.contains(s)));
  const zOf = (el) => {
    let modal = false;
    try {
      modal = el.matches(':modal') || !!el.closest('dialog:modal');
    } catch {
      modal = false;
    }
    if (modal) return Infinity;
    let z = 0;
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const v = parseInt(getComputedStyle(p).zIndex, 10);
      if (Number.isFinite(v)) z = Math.max(z, v);
    }
    return z;
  };
  /** 그 자리를 눌렀을 때 맨 위에 있는 횟수 — 가운데와 네 귀 안쪽(25%·75%) 다섯 곳. 다른 팝업에 가려진 것은 0 이다. */
  const hits = (s) => {
    if (typeof document.elementFromPoint !== 'function') return 1;
    const b = found.get(s);
    let n = 0;
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const hit = document.elementFromPoint(b.x + b.w * fx, b.y + b.h * fy);
      if (hit && (hit === s || s.contains(hit))) n++;
    }
    return n;
  };
  const ranked = list.map((s) => ({ s, n: hits(s), z: zOf(s) })).filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || b.z - a.z || (a.s.compareDocumentPosition(b.s) & 4 ? 1 : -1));
  const top = ranked[0]?.s;
  if (!top) return null;
  const sb = found.get(top);
  // 찍을 것 — 팝업을 거의 채운 틀, 팝업의 스크롤 칸(자기 또는 팝업의 절반 이상인 안쪽 칸), 아니면 팝업 자체.
  let target = top;
  let kind = 'plain';
  const area = (el) => { const b = box(el); return b.w * b.h; };
  const whole = Math.max(1, sb.w * sb.h);
  const frames = FRAMES.test(top.tagName) ? [top] : [...top.querySelectorAll('iframe, frame')].filter(shown);
  const big = frames.map((f) => [f, area(f)]).sort((a, b) => b[1] - a[1])[0];
  if (big && big[1] >= whole * 0.6) {
    target = big[0];
    kind = 'frame';
  } else if (scrolls(top)) {
    kind = 'box';
  } else {
    const inner = [...top.querySelectorAll('*')].filter((el) => scrolls(el) && shown(el)).map((el) => [el, area(el)]).sort((a, b) => b[1] - a[1])[0];
    if (inner && inner[1] >= whole * 0.5) {
      target = inner[0];
      kind = 'box';
    }
  }
  // 제목 — 파일 이름 꼴(첨부 미리보기의 띠)이 먼저, 그다음 aria 이름·머리글·첫 줄.
  const lines = String(top.innerText ?? top.textContent ?? '').split('\n').map(clean).filter(Boolean);
  let file = '';
  for (const e of [top, ...top.querySelectorAll('[title]')]) {
    const v = clean(e.getAttribute('title'));
    if (v && v.length <= 200 && FILE.test(v)) {
      file = v;
      break;
    }
  }
  if (!file) file = lines.find((l) => l.length <= 200 && FILE.test(l)) || '';
  const named = (top.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
    .map((id) => document.getElementById(id)).filter(Boolean).map((e) => clean(e.innerText ?? e.textContent)).join(' ');
  const head = top.querySelector('h1, h2, h3, h4, [role="heading"]');
  const title = (file || named || clean(top.getAttribute('aria-label')) || clean(head && (head.innerText ?? head.textContent)) || lines[0] || '').slice(0, 60);
  let frame = null;
  if (kind === 'frame') {
    let href = null;
    try {
      href = target.contentWindow.location.href;
    } catch {
      href = null;   // 다른 사이트의 틀 — 주소를 못 본다
    }
    frame = { href, src: target.getAttribute('src') || '', name: target.name || '', w: target.clientWidth, h: target.clientHeight };
  }
  const viewer = !!file || (frame && VIEWER.test(`${frame.src} ${frame.href || ''}`));
  target.setAttribute('data-krs-cap', 'popup');
  return { n: 'popup', kind, label: viewer ? '첨부 미리보기 창' : '팝업', title, cover: Math.round(sb.cover * 100) / 100, frame };
}

/**
 * 틀 안이 어떻게 내려가는지(2026-10-15 — 첨부 미리보기 틀). doc 은 문서 자체가 정말 내려가면 그 높이(scrollingElement — body 만 큰 것은
 * 내려가지 않는다), box 는 문서가 내려가지 않을 때 보이는 가장 큰 스크롤 칸(틀 창의 30% 이상 — Word·PDF 보기의 본문 칸)의 틀 창 안 자리와
 * 높이, paged 는 둘 다 없고 슬라이드처럼 한 장씩 넘기는 화면(PowerPoint 읽기 보기)인지다. 찾은 칸과 그 자리는 window.__krsScroll 에
 * 두었다가 scrollerDone 이 되돌린다.
 * @returns {{doc: {scrollHeight: number, clientHeight: number}|null, box: {x: number, y: number, w: number, h: number, scrollTop: number,
 *   scrollHeight: number, clientHeight: number}|null, paged: boolean}}
 */
export function scrollerInfo() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const se = document.scrollingElement || document.documentElement;
  if (se && se.scrollHeight > se.clientHeight + 4) return { doc: { scrollHeight: se.scrollHeight, clientHeight: se.clientHeight }, box: null, paged: false };
  let best = null;
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (el.clientHeight < 40 || el.scrollHeight <= el.clientHeight + 4) continue;
    const cs = getComputedStyle(el);
    if (!/(auto|scroll|overlay)/.test(cs.overflowY) || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    const top = r.top + el.clientTop;
    const left = r.left + el.clientLeft;
    const x = Math.max(left, 0);
    const y = Math.max(top, 0);
    const w = Math.min(left + el.clientWidth, vw) - x;
    const h = Math.min(top + el.clientHeight, vh) - y;
    if (w < 40 || h < 40 || w * h < vw * vh * 0.3) continue;
    if (!best || w * h > best.w * best.h) best = { el, x, y, w, h };
  }
  if (best) {
    const el = best.el;
    if (!window.__krsScroll || window.__krsScroll.el !== el) window.__krsScroll = { el, top: el.scrollTop, sb: el.style.scrollBehavior };
    return { doc: null, box: { x: best.x, y: best.y, w: best.w, h: best.h, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }, paged: false };
  }
  const clsOf = (e) => (typeof e.className === 'string' ? e.className : e.getAttribute('class') || '');
  const SLIDE = /(^|[\s_.-])slide/i;
  const big = (e) => {
    const r = e.getBoundingClientRect();
    return r.width * r.height >= vw * vh * 0.3;
  };
  const slides = [...document.querySelectorAll('[aria-roledescription], [id*="lide" i], [class*="lide" i]')]
    .some((e) => (/slide|슬라이드/i.test(e.getAttribute('aria-roledescription') || '') || SLIDE.test(e.id || '') || SLIDE.test(clsOf(e))) && big(e));
  const flip = [...document.querySelectorAll('[aria-label], [title]')]
    .some((e) => /(다음|이전)\s*슬라이드|(next|previous|prev)\s*slide/i.test(`${e.getAttribute('aria-label') || ''} ${e.getAttribute('title') || ''}`));
  return { doc: null, box: null, paged: /PowerPoint(Frame|View)|[?&]PowerPointView=/i.test(location.href) || slides || flip };
}

/** 찾은 스크롤 칸(scrollerInfo)을 y 로 내린다 — 실제로 선 자리를 돌려준다(끝에서는 덜 내려간다). 칸이 없으면 null. */
export function scrollerStep(y) {
  const keep = window.__krsScroll;
  if (!keep) return null;
  keep.el.style.scrollBehavior = 'auto';
  keep.el.scrollTop = y;
  return keep.el.scrollTop;
}

/** 스크롤 칸을 다 찍었다 — 칸 안 자리와 스크롤 방식을 되돌린다. */
export function scrollerDone() {
  const keep = window.__krsScroll;
  if (!keep) return;
  keep.el.scrollTop = keep.top;
  keep.el.style.scrollBehavior = keep.sb;
  delete window.__krsScroll;
}

/** 메일 읽기가 단 표시를 뗀다 — 첨부 칸(data-krs-attach)과 메일 본문(data-krs-cap="mail"), 남은 팝업 표시(popup)도(2026-10-15). 뗀 수. */
export function unmarkPage() {
  let n = 0;
  for (const el of document.querySelectorAll('[data-krs-attach]')) {
    el.removeAttribute('data-krs-attach');
    n++;
  }
  for (const el of document.querySelectorAll('[data-krs-cap="mail"], [data-krs-cap="popup"]')) {
    el.removeAttribute('data-krs-cap');
    n++;
  }
  return n;
}

/* ------------------------------------------------------------ 순수 셈 */

/**
 * 찍을 자리. 한 화면 높이씩 내려가고, 마지막은 끝에 맞춘다(끝 화면은 앞 화면과 겹친다). MAX_SHOTS 를 넘는 긴 페이지는 앞부분만
 * 찍고 cut 에 표시한다. height 는 찍히는 높이(CSS px)다.
 * @returns {{steps: number[], height: number, cut: boolean}}
 */
export function shotPlan({ scrollHeight, viewportHeight }) {
  const vh = Math.max(1, Math.floor(Number(viewportHeight) || 0));
  const total = Math.max(vh, Math.floor(Number(scrollHeight) || 0));
  const steps = [];
  for (let y = 0; y < total && steps.length < MAX_SHOTS; y += vh) steps.push(Math.min(y, total - vh));
  const reached = steps.at(-1) + vh;
  const cut = reached < total;
  return { steps, height: cut ? reached : total, cut };
}

/**
 * 이은 그림을 자를 자리(CSS px). 한 장의 높이가 tileHeight 이고, 끝의 짧은 꼬리(한 장의 1/5 미만)는 앞 장에 붙인다 —
 * 몇 줄짜리 쪽을 따로 내지 않는다.
 * @returns {{y: number, h: number}[]}
 */
export function tileRanges(totalHeight, tileHeight) {
  const th = Math.max(1, Math.floor(Number(tileHeight) || 0));
  const total = Math.max(0, Math.floor(Number(totalHeight) || 0));
  const out = [];
  for (let y = 0; y < total; y += th) out.push({ y, h: Math.min(th, total - y) });
  if (out.length > 1 && out.at(-1).h < th / 5) {
    const tail = out.pop();
    out.at(-1).h += tail.h;
  }
  return out;
}

/** 캡처할 수 있는 주소인가 — 브라우저 안쪽 화면(chrome://·확장 화면)과 파일은 스크립트를 넣지 못한다. */
export function capturable(url) {
  const u = String(url || '');
  if (/^https?:\/\//i.test(u)) return { ok: true, why: '' };
  if (!u) return { ok: false, why: '캡처할 탭이 없습니다 — 읽을 웹페이지를 이 창에서 열어 두세요.' };
  return { ok: false, why: '이 화면은 캡처할 수 없습니다(브라우저 안쪽 화면·파일) — 읽을 웹페이지 탭을 앞에 두고 다시 누르세요.' };
}

/** 주소의 호스트 — 파일 이름에 쓴다(www. 은 뺀다). */
export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '') || 'page';
  } catch {
    return 'page';
  }
}

/** 장의 파일 이름 — 화면캡처_inflearn.com_2026-10-08_1.png. 이름의 꼴로 읽기가 무엇인지 알아본다(input.yaml gongmun 의 parts). */
export const tileName = (host, today, n) => `화면캡처_${String(host).replace(/[\\/:*?"<>|\s]+/g, '')}${today ? `_${today}` : ''}_${n}.png`;

/**
 * 화면 글자를 다듬는다 — 줄마다 앞뒤 빈칸을 지우고, 빈 줄은 하나로, 한도를 넘으면 자르고 표시한다.
 * 머리에 무슨 화면인지(제목·주소)를 적어 읽기가 "붙여 넣은 글" 이 아니라 웹페이지의 글자임을 알게 한다.
 */
export function normalizeText(raw, { title = '', url = '', max = TEXT_MAX } = {}) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ')
    .split('\n').map((l) => l.replace(/ {2,}/g, ' ').trim());
  const out = [];
  for (const l of lines) {
    if (!l && !out.at(-1)) continue;   // 빈 줄은 하나만
    out.push(l);
  }
  let body = out.join('\n').trim();
  if (body.length > max) body = `${body.slice(0, max).trimEnd()}\n…(너무 길어 여기서 잘랐습니다)`;
  const head = `[웹페이지 글자${title ? ` — ${String(title).trim()}` : ''}]${url ? ` ${url}` : ''}`;
  return body ? `${head}\n${body}` : '';
}

/**
 * 읽기에 보낼 장을 고른다 — 탭을 여럿 찍었으면 탭마다 첫 장부터 돌아가며(1번 탭 1쪽, 2번 탭 1쪽, 1번 탭 2쪽 …) room 장까지.
 * 긴 페이지 하나가 자리를 다 차지해 뒤 탭은 한 장도 못 읽히는 일이 없게 한다. 못 고른 장은 첨부에만 간다.
 * @param {number[]} counts 탭마다 장 수(찍은 차례대로)
 * @returns {boolean[]} 장마다(탭 차례로 이어서) 읽기에 보내면 true
 */
export function readSlots(counts, room) {
  const out = (counts || []).map((n) => Array(Math.max(0, n | 0)).fill(false));
  let left = Math.max(0, room | 0);
  for (let page = 0; left > 0 && out.some((p) => page < p.length); page++) {
    for (const p of out) {
      if (left > 0 && page < p.length) {
        p[page] = true;
        left--;
      }
    }
  }
  return out.flat();
}

/* ------------------------------------------------------------ 잇고 자르기 (브라우저) */

/** data URL 의 바이트. fetch 를 쓰지 않는다 — 패널의 fetch 는 사이트 요청용이다. 견적서 오리기(src/quotecut.js)도 쓴다. */
export function blobOf(dataUrl) {
  const [meta, b64 = ''] = String(dataUrl).split(',');
  const type = (meta.match(/^data:([^;]+)/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * 찍은 화면들을 A4 비율의 장으로 잇고 자른다. 거대한 캔버스 하나를 만들지 않는다 — 장마다 캔버스를 내고 거기에 걸치는 화면만 그린다
 * (화면 서른 장을 한 장으로 이으면 메모리를 수백 MB 쓴다). 그림은 쓸 때마다 풀고 바로 닫는다.
 * 배율은 첫 화면의 픽셀 폭 / 뷰포트 폭(= devicePixelRatio × 확대)이고, MAX_SCALE 을 넘으면 줄여 저장한다.
 * 부분을 찍은 것(capturePart)은 화면마다 crop(창 안의 x·y·w·h)만 오려 붙이고, 장의 폭은 width(그 부분의 폭)다.
 * @param {{shots: {dataUrl: string, y: number, h: number, crop?: {x: number, y: number, w: number, h: number}}[], viewportWidth: number,
 *   width?: number, totalHeight: number, tileHeight: number}} job y·h·crop 은 CSS px
 * @returns {Promise<Blob[]>} PNG 장들
 */
export async function stitchTiles({ shots, viewportWidth, width: cssWidth = viewportWidth, totalHeight, tileHeight }, { bitmapOf = (d) => createImageBitmap(blobOf(d)) } = {}) {
  if (!shots?.length) throw new Error('찍은 화면이 없습니다.');
  if (typeof OffscreenCanvas !== 'function') throw new Error('이 브라우저에서는 캡처를 이을 수 없습니다.');
  const first = await bitmapOf(shots[0].dataUrl);
  const scale = first.width / Math.max(1, viewportWidth);
  first.close?.();
  const k = Math.min(scale, MAX_SCALE);
  const width = Math.max(1, Math.round(cssWidth * k));
  const out = [];
  for (const r of tileRanges(totalHeight, tileHeight)) {
    const canvas = new OffscreenCanvas(width, Math.max(1, Math.round(r.h * k)));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const s of shots) {
      if (s.y + s.h <= r.y || s.y >= r.y + r.h) continue;
      const bm = await bitmapOf(s.dataUrl);
      const c = s.crop;
      if (c) {
        ctx.drawImage(bm, Math.round(c.x * scale), Math.round(c.y * scale), Math.round(c.w * scale), Math.round(c.h * scale),
          0, Math.round((s.y - r.y) * k), Math.round(c.w * k), Math.round(c.h * k));
      } else {
        ctx.drawImage(bm, 0, Math.round((s.y - r.y) * k), Math.round((bm.width * k) / scale), Math.round((bm.height * k) / scale));
      }
      bm.close?.();
    }
    out.push(await canvas.convertToBlob({ type: 'image/png' }));
  }
  return out;
}

/* ------------------------------------------------------------ 찍는 차례 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 탭 하나를 통째로 찍어 장(File)과 글자로 돌려준다.
 * @param {{tab: {url?: string}, exec: (func: Function, args?: any[]) => Promise<any>, shoot: () => Promise<string>, wait?: Function,
 *   stitch?: Function, today?: string, seq?: number, textMax?: number, onProgress?: (done: number, total: number) => void}} deps
 *   exec 는 탭 안에서 함수를 돌려 결과를 주고, shoot 는 보이는 화면을 PNG data URL 로 찍는다. seq 는 첫 장의 번호다(같은 사이트의 앞 탭에 잇는다)
 * @returns {Promise<{files: File[], text: string, title: string, url: string, host: string, shots: number, tiles: number, cut: boolean}>}
 */
export async function capturePage({ tab, exec, shoot, wait = sleep, stitch = stitchTiles, today = '', seq = 1, textMax = TEXT_MAX, onProgress = () => {} }) {
  const can = capturable(tab?.url);
  if (!can.ok) throw new Error(can.why);
  const info = await exec(pageInfo, []);
  if (!info || !Number.isFinite(info.viewportWidth) || !Number.isFinite(info.viewportHeight)) {
    throw new Error('페이지를 읽지 못했습니다 — 이 화면에는 스크립트를 넣을 수 없습니다.');
  }
  const plan = shotPlan(info);
  const shots = [];
  try {
    for (const [i, y] of plan.steps.entries()) {
      const at = await exec(pageStep, [y, i > 0]);
      await wait(SHOT_GAP_MS);
      onProgress(i + 1, plan.steps.length);
      shots.push({ dataUrl: await shoot(), y: Number.isFinite(at) ? at : y, h: info.viewportHeight });
    }
  } finally {
    await Promise.resolve().then(() => exec(pageDone, [info.scrollY || 0])).catch(() => {});
  }
  const tileHeight = Math.round(info.viewportWidth * A4_RATIO);
  const blobs = await stitch({ shots, viewportWidth: info.viewportWidth, totalHeight: plan.height, tileHeight });
  const url = info.url || tab.url || '';
  const host = hostOf(url);
  const files = blobs.map((b, i) => new File([b], tileName(host, today, seq + i), { type: 'image/png' }));
  return { files, text: normalizeText(info.text, { title: info.title, url, max: textMax }), title: info.title || '', url, host, shots: shots.length, tiles: files.length, cut: plan.cut };
}

/**
 * 고른 탭들을 차례로 앞에 두고(activate) 통째로 찍는다 — captureVisibleTab 은 앞에 있는 탭만 찍는다. 다 찍으면(실패해도) 처음 보던 탭을
 * 다시 앞에 둔다(back). 한 탭이 실패해도 나머지는 찍고 까닭을 failed 에 남긴다 — 하나도 못 찍으면 던진다.
 * 장 번호는 사이트마다 이어 간다(같은 사이트의 두 탭이 같은 이름을 내지 않게). 화면 글자의 한도는 탭 수로 나눈다.
 * 탭마다 큰 팝업이 떠 있으면 그 팝업 안을 찍는다(captureWhole — 2026-10-15). frameIn 은 그 탭의 틀을 맞추는 길(frameFinder)이다(없으면
 * 팝업의 틀은 보이는 만큼만 찍는다).
 * @param {{tabs: {id: number, url: string, title?: string}[], activate: (tab: object) => Promise<void>, back: () => Promise<void>,
 *   execIn: (tab: object) => Function, frameIn?: ((tab: object) => Function)|null, shoot: () => Promise<string>, wait?: Function, stitch?: Function,
 *   today?: string, onProgress?: (done: number, total: number, nth: number, of: number) => void, onTarget?: Function}} deps
 * @returns {Promise<{pages: object[], failed: {title: string, why: string}[]}>} pages 는 찍은 탭마다 captureWhole(capturePage) 의 결과(고른 차례)
 */
export async function captureMany({ tabs, activate, back, execIn, frameIn = null, shoot, wait = sleep, stitch = stitchTiles, today = '', onProgress = () => {}, onTarget = () => {} }) {
  const list = tabs || [];
  if (!list.length) throw new Error('캡처할 웹페이지를 고르세요.');
  const textMax = list.length > 1 ? Math.floor(TEXT_MAX / list.length) - TEXT_HEAD : TEXT_MAX;
  const next = {};
  const pages = [];
  const failed = [];
  try {
    for (const [i, tab] of list.entries()) {
      const host = hostOf(tab.url);
      try {
        await activate(tab);
        const got = await captureWhole({
          tab, exec: execIn(tab), frameOf: frameIn ? frameIn(tab) : null, shoot, wait, stitch, today, seq: next[host] || 1, textMax, onTarget,
          onProgress: (done, total) => onProgress(done, total, i + 1, list.length),
        });
        next[host] = (next[host] || 1) + got.files.length;
        pages.push(got);
      } catch (err) {
        failed.push({ title: String(tab.title || host), why: err?.message || String(err) });
      }
    }
  } finally {
    await Promise.resolve().then(back).catch(() => {});
  }
  if (!pages.length) {
    throw new Error(failed.length === 1 ? failed[0].why : `고른 웹페이지를 하나도 찍지 못했습니다 — ${failed.map((f) => `${f.title}: ${f.why}`).join(' / ')}`);
  }
  return { pages, failed };
}

/**
 * 페이지 위에서 고른 부분(pagePick 이 data-krs-cap="n" 을 단 요소) 하나를 찍는다 — 그 부분만 오려 A4 비율의 장으로 잇는다. 세 갈래다.
 *  · 틀(iframe) 안이 따로 내려가면 — 창은 틀의 머리에 두고 틀 안을 틀의 보이는 높이씩 내리며 찍는다(eClass 포털의 본문 틀).
 *  · 상자 안이 따로 내려가면(overflow: auto) — 같은 식으로 상자 안을 내린다.
 *  · 아니면 — 그 부분이 든 스크롤 칸(창, 또는 안쪽 상자)을 내리며 그 부분의 머리부터 끝까지 찍는다(한 화면보다 짧으면 한 번).
 * 그 부분을 품지도 그 안에 있지도 않은 고정 띠는 첫 장부터 숨긴다. 다 찍으면(실패해도) 자리와 숨긴 것을 되돌린다.
 * 글자는 그 부분의 글자다(틀이면 틀 안의 글자 — 다른 사이트의 틀이어도 frame 으로 읽는다).
 * 2026-10-15(첨부 미리보기 틀): 틀 문서가 거의 내려가지 않으면 틀 안을 다시 본다(scrollerInfo) — 문서가 정말 내려가면 위와 같이, 안쪽의
 * 큰 스크롤 칸(Word·PDF 보기의 본문 칸)이 내려가면 그 칸을 내리며 그 칸만 오리고(scrollerStep — 끝에 scrollerDone 이 되돌린다), 둘 다 없고
 * 슬라이드처럼 한 장씩 넘기는 화면이면 넘기지 않고 보이는 만큼 찍어 paged 로 알린다. frame.at 이 있으면 frame 은 고른 틀 안의 더 깊은
 * 틀이고 at 은 그 틀이 고른 틀의 안쪽에서 놓인 자리다(frameTarget·frameFinder).
 * @param {{part: {n: number|string, title?: string}, exec: Function, frame?: Function|null, shoot: () => Promise<string>, wait?: Function,
 *   stitch?: Function, today?: string, seq?: number, textMax?: number, onProgress?: (done: number, total: number) => void}} deps
 *   exec 는 탭의 맨 위 문서에서, frame 은 고른 틀 안에서 함수를 돌린다(틀을 못 맞췄으면 null — 틀이 보이는 만큼만 찍는다)
 * @returns {Promise<{files: File[], text: string, title: string, url: string, host: string, shots: number, tiles: number, cut: boolean, part: number, paged: boolean}>}
 */
export async function capturePart({ part, exec, frame = null, shoot, wait = sleep, stitch = stitchTiles, today = '', seq = 1, textMax = TEXT_MAX, onProgress = () => {} }) {
  const lost = () => new Error('고른 부분을 찾지 못했습니다 — 페이지가 바뀌었으면 다시 고르세요.');
  const info = await exec(partInfo, [part.n]);
  if (!info || !Number.isFinite(info.vw) || !Number.isFinite(info.vh)) throw lost();
  const inFrame = info.frame && frame ? await Promise.resolve().then(() => frame(pageInfo, [])).catch(() => null) : null;
  // 틀 문서가 (거의 — 10% 안) 내려가지 않으면 틀 안을 다시 본다. pageInfo 의 높이는 body 의 넘친 높이까지 보아(PowerPoint 보기는 18px)
  // 정말 내려가는지는 scrollerInfo 가 가린다. 그것도 못 돌리면 pageInfo 의 높이대로 한다.
  const slight = !!inFrame && Number.isFinite(inFrame.viewportHeight) && inFrame.scrollHeight <= inFrame.viewportHeight + Math.max(4, inFrame.viewportHeight * 0.1);
  const look = slight ? await Promise.resolve().then(() => frame(scrollerInfo, [])).catch(() => null) : null;
  const docFull = !inFrame ? 0 : look ? look.doc?.scrollHeight || 0 : inFrame.scrollHeight > inFrame.viewportHeight + 4 ? inFrame.scrollHeight : 0;
  const scroller = (inFrame && !docFull && look?.box) || null;
  const shots = [];
  let width = 0;
  let plan = null;
  let total = 0;   // 이어 붙일 높이 — shotPlan 은 한 화면보다 짧아도 한 화면 높이를 주니 부분의 높이로 줄인다
  let paged = false;
  const snap = async (i) => {
    await wait(SHOT_GAP_MS);
    onProgress(i + 1, plan.steps.length);
    return shoot();
  };
  try {
    // 그 부분의 머리를 보이는 칸의 맨 위에 둔다(페이지 끝이면 덜 내려간다).
    const head = await exec(partStep, [part.n, 0, null]);
    if (!head) throw lost();
    // 보이는 칸 — 창과, 그 부분이 든 스크롤 칸이 겹치는 곳(partStep 이 준다).
    const clip = head.clip || { top: 0, left: 0, bottom: info.vh, right: info.vw };
    const inner = docFull ? 'frame' : scroller ? 'scroller' : info.box ? 'box' : '';
    if (inner) {
      // 테두리 안쪽에서 보이는 칸이 한 화면이다 — 틀 안의 더 깊은 틀이면 그 틀의 창, 스크롤 칸이면 틀 창 안의 그 칸.
      const at = inFrame && frame.at && Number.isFinite(frame.at.x) && Number.isFinite(frame.at.y) ? frame.at : null;
      const left = head.left + info.edge.left + (at ? at.x : 0);
      const top = head.top + info.edge.top + (at ? at.y : 0);
      const fw = at && inFrame.viewportWidth > 0 ? inFrame.viewportWidth : info.edge.w;
      const fh = at && inFrame.viewportHeight > 0 ? inFrame.viewportHeight : info.edge.h;
      const sx = scroller ? left + scroller.x : left;
      const sy0 = scroller ? top + scroller.y : top;
      const x = Math.max(sx, left, clip.left);
      const y = Math.max(sy0, top, clip.top);
      const w = Math.min(scroller ? sx + scroller.w : left + fw, left + fw, clip.right) - x;
      const h = Math.min(scroller ? sy0 + scroller.h : top + fh, top + fh, clip.bottom) - y;
      if (w < 1 || h < 1) throw new Error('고른 부분이 화면에 보이지 않습니다.');
      // 스크롤 칸이 틀 창 밖으로 넘쳐 덜 보이면, 끝까지 내려도 보이는 칸 아래는 닿지 않는다 — 닿는 데까지.
      const full = inner === 'frame' ? docFull : inner === 'scroller' ? scroller.scrollHeight - Math.max(0, scroller.clientHeight - h) : info.box.scrollHeight;
      plan = shotPlan({ scrollHeight: full, viewportHeight: h });
      total = Math.min(plan.height, full);
      let prev = null;
      for (const [i, sy] of plan.steps.entries()) {
        const got = inner === 'frame' ? await frame(pageStep, [sy, i > 0])
          : inner === 'scroller' ? await frame(scrollerStep, [sy])
            : (await exec(partStep, [part.n, null, sy]))?.inner;
        const pos = Number.isFinite(got) ? got : sy;
        if (prev != null && pos === prev) continue;   // 더 내려가지 않았다(끝·스크롤이 막힘) — 같은 자리를 또 찍지 않는다
        prev = pos;
        shots.push({ dataUrl: await snap(i), y: pos, h, crop: { x, y, w, h } });
      }
      width = w;
    } else {
      const x = Math.max(head.left, clip.left);
      width = Math.min(head.left + head.width, clip.right) - x;
      const view = clip.bottom - clip.top;
      if (width < 1 || view < 1) throw new Error('고른 부분이 화면에 보이지 않습니다.');
      plan = shotPlan({ scrollHeight: info.height, viewportHeight: view });
      total = Math.min(plan.height, Math.ceil(info.height));
      let prev = null;
      for (const [i, sy] of plan.steps.entries()) {
        const at = i === 0 ? head : await exec(partStep, [part.n, sy, null]);
        if (!at || (prev && at.top === prev.top)) continue;   // 더 내려가지 않았다(페이지 끝·스크롤이 막힘)
        prev = at;
        const c = at.clip || clip;
        const top = Math.max(at.top, c.top);
        const bottom = Math.min(at.top + at.height, c.bottom);
        if (bottom - top < 1) continue;
        shots.push({ dataUrl: await snap(i), y: top - at.top, h: bottom - top, crop: { x, y: top, w: width, h: bottom - top } });
      }
      // 틀 안이 내려가지 않고 슬라이드처럼 한 장씩 넘기는 화면(PowerPoint 읽기 보기) — 넘기지 않고 보이는 장만 찍었다.
      paged = !!(inFrame && look?.paged);
    }
  } finally {
    if (scroller) await Promise.resolve().then(() => frame(scrollerDone, [])).catch(() => {});
    if (inFrame) await Promise.resolve().then(() => frame(pageDone, [inFrame.scrollY || 0])).catch(() => {});
    await Promise.resolve().then(() => exec(partDone, [part.n])).catch(() => {});
  }
  // 덜 내려가 찍은 데가 모자라면(스크롤이 막힘·떠 있는 팝업) 찍은 데까지만 잇는다 — 아래에 빈 흰 칸을 붙이지 않는다.
  if (shots.length) total = Math.min(total, Math.max(...shots.map((s) => s.y + s.h)));
  const blobs = await stitch({ shots, viewportWidth: info.vw, width, totalHeight: total, tileHeight: Math.round(width * A4_RATIO) });
  const url = info.url || '';
  const host = hostOf(url);
  const files = blobs.map((b, i) => new File([b], tileName(host, today, seq + i), { type: 'image/png' }));
  const text = normalizeText(inFrame?.text || info.text, { title: [info.title, part.title].filter(Boolean).join(' — '), url: inFrame?.url || url, max: textMax });
  return { files, text, title: part.title || info.title || '', url, host, shots: shots.length, tiles: files.length, cut: plan.cut, part: part.n, paged };
}

/**
 * "전체" — 탭 하나를 통째로 찍되, 페이지 위에 큰 팝업(첨부 미리보기 같은 대화상자)이 떠 있으면 뒤의 페이지 대신 그 팝업 안을 찍는다
 * (2026-10-15 사용자 지정: "첨부파일을 열면 내용이 팝업으로 뜨는데 그 부분도 일부 또는 전체 캡쳐할 수 있나?"). modalProbe 가 찍을 것에
 * data-krs-cap="popup" 을 달면 고른 부분을 찍는 길(capturePart)로 찍는다 — 틀이면 frameOf 로 그 틀을 맞춰 틀 안을, 아니면 팝업의
 * 스크롤 칸을 내린다. 팝업이 없으면(또는 못 보면) capturePage 그대로다. 찾은 팝업은 onTarget({where}) 로 먼저 알린다.
 * 결과는 capturePage 의 것에 popup(팝업의 종류 — "첨부 미리보기 창"·"팝업")·where(찍은 곳 — 「제목」까지)·paged 가 붙는다.
 * 탭이 팝업 창의 것(frontTab 의 popup)이면 where·fromPopup 이 붙는다.
 * @param {{tab: {url?: string, popup?: boolean, where?: string}, exec: Function, frameOf?: Function|null, onTarget?: Function}} deps
 *   나머지(shoot·wait·stitch·today·seq·textMax·onProgress)는 capturePage·capturePart 와 같다
 */
export async function captureWhole({ tab, exec, frameOf = null, onTarget = () => {}, ...rest }) {
  const can = capturable(tab?.url);
  if (!can.ok) throw new Error(can.why);
  const pop = await Promise.resolve().then(() => exec(modalProbe, [])).catch(() => null);
  if (!pop || pop.n == null) {
    const got = await capturePage({ tab, exec, ...rest });
    return tab.popup ? { ...got, where: tab.where || '팝업 창', fromPopup: true } : got;
  }
  const label = pop.label || '팝업';
  const where = `${tab.popup && tab.where ? `${tab.where}의 ` : ''}${label}${pop.title ? `「${pop.title}」` : ''}`;
  onTarget({ where, popup: label, title: pop.title || '' });
  let got;
  try {
    const frame = pop.frame && frameOf ? await Promise.resolve().then(() => frameOf(pop.frame)).catch(() => null) : null;
    got = await capturePart({ part: { n: pop.n, title: pop.title || label }, exec, frame: frame || null, ...rest });
  } finally {
    await Promise.resolve().then(() => exec(partDone, [pop.n])).catch(() => {});   // 찾은 것을 찍지 못했어도 표시는 뗀다
  }
  const page = { ...got, title: pop.title || got.title, popup: label, where, ...(tab.popup ? { fromPopup: true } : {}) };
  delete page.part;   // 고른 부분이 아니다 — "부분 1" 로 적지 않는다
  return page;
}

/**
 * 고른 부분들을 고른 차례대로 찍는다 — 부분 하나가 한 묶음(페이지 하나와 같다)이다. 한 부분이 실패해도 나머지는 찍고 까닭을 남긴다.
 * 장 번호는 이어 가고, 글자의 한도는 부분 수로 나눈다. frameOf 는 고른 틀의 frameId 를 맞춰 그 틀 안에서 돌리는 함수를 준다(못 맞추면 null).
 * @returns {Promise<{pages: object[], failed: {title: string, why: string}[]}>}
 */
export async function captureParts({ parts, exec, frameOf = async () => null, shoot, wait = sleep, stitch = stitchTiles, today = '', onProgress = () => {} }) {
  const list = parts || [];
  if (!list.length) throw new Error('캡처할 부분을 고르세요.');
  const textMax = list.length > 1 ? Math.floor(TEXT_MAX / list.length) - TEXT_HEAD : TEXT_MAX;
  let seq = 1;
  const pages = [];
  const failed = [];
  for (const [i, part] of list.entries()) {
    try {
      const frame = part.frame ? await Promise.resolve().then(() => frameOf(part.frame)).catch(() => null) : null;
      const got = await capturePart({ part, exec, frame, shoot, wait, stitch, today, seq, textMax, onProgress: (done, total) => onProgress(done, total, i + 1, list.length) });
      seq += got.files.length;
      pages.push(got);
    } catch (err) {
      failed.push({ title: part.title || `${i + 1}번째 부분`, why: err?.message || String(err) });
    }
  }
  if (!pages.length) {
    throw new Error(failed.length === 1 ? failed[0].why : `고른 부분을 하나도 찍지 못했습니다 — ${failed.map((f) => `${f.title}: ${f.why}`).join(' / ')}`);
  }
  return { pages, failed };
}

/**
 * 고른 틀이 어느 frameId 인지 — frameProbe 를 모든 틀에 돌린 결과에서 맨 위 문서 바로 아래의 틀(child, 또는 depth 1)만 본다. 주소(같은 사이트면
 * 지금 주소)·이름·src·크기 차례로, 하나로 좁혀지는 것을 쓴다(여럿이면 그 가운데 크기가 맞는 하나). about:blank 같은 주소는 틀마다 같아
 * 견주지 않는다(2026-10-15 — 새 Outlook 의 첨부 미리보기 틀은 src 가 about:blank 이고 안은 다른 사이트다). 틀이 하나뿐이면 그것이다. 못 맞추면 null.
 */
export function matchFrame(frames, want) {
  if (!want) return null;
  const kids = (frames || []).filter((f) => f && f.frameId !== 0 && (f.child || f.depth === 1));
  const real = (u) => !!u && !/^(about:|javascript:|data:)/i.test(u);
  const sized = (f) => want.w > 0 && want.h > 0 && Math.abs(f.w - want.w) <= 1 && Math.abs(f.h - want.h) <= 1;
  const tries = [
    (f) => real(want.href) && f.href === want.href,
    (f) => !!want.name && f.name === want.name,
    (f) => real(want.src) && f.href === want.src,
    sized,
  ];
  for (const ok of tries) {
    const hit = kids.filter(ok);
    if (hit.length === 1) return hit[0].frameId;
    const fit = hit.length > 1 ? hit.filter(sized) : [];
    if (fit.length === 1) return fit[0].frameId;
  }
  return kids.length === 1 ? kids[0].frameId : null;
}

/**
 * 고른 틀과, 그 대신 찍을 더 깊은 틀(2026-10-15). matchFrame 으로 맞춘 틀이 안 내려가는데(scrolls === false) 그보다 깊은 틀 가운데
 * 그 틀을 90% 이상 채우고 내려가는 것이 있으면 그 틀을 deep 으로 준다 — 바깥 틀은 껍데기이고 문서는 안쪽 틀에서 내려가는 미리보기.
 * 어느 틀이 어느 틀 안인지는 frameProbe 만으로 모른다(webNavigation 권한 없이) — 깊이와 크기로 고른다. 못 맞추면 null.
 * @returns {{id: number, deep: {id: number, w: number, h: number}|null}|null}
 */
export function frameTarget(frames, want) {
  const id = matchFrame(frames, want);
  if (id == null) return null;
  const list = (frames || []).filter((f) => f && f.frameId !== 0);
  const top = list.find((f) => f.frameId === id);
  if (!top || top.scrolls !== false) return { id, deep: null };
  const depth = Number.isFinite(top.depth) && top.depth > 0 ? top.depth : 1;
  const area = top.w * top.h;
  const deep = list.filter((f) => f.frameId !== id && Number.isFinite(f.depth) && f.depth > depth && f.scrolls
    && f.w <= top.w + 1 && f.h <= top.h + 1 && f.w * f.h >= area * 0.9)
    .sort((a, b) => a.depth - b.depth || b.w * b.h - a.w * a.h)[0];
  return { id, deep: deep ? { id: deep.frameId, w: deep.w, h: deep.h } : null };
}

/**
 * 방금 보던 팝업 창의 후보(2026-10-15). log 는 창이 앞에 선 차례({id, at, tab?} — watchWindows 가 적는다, 오래된 것부터)다.
 * 끝의 패널 창(panelId)·크롬 밖(-1) 기록을 패널로 돌아온 것으로 보고, 그 앞에서 패널 창이 앞을 내준 뒤 앞에 섰던 창들을 최근 것부터 준다 —
 * 그 창이 앞을 내준 지 within 안인 것만. 패널로 돌아온 뒤 패널 창에서 탭을 바꿨으면(tab) 사용자는 그 창을 보고 있다 — 없다.
 * 창이 팝업인지·열려 있는지는 부른 곳(frontTab)이 본다.
 * @returns {number[]}
 */
export function popupCandidates(log, panelId, now, within = POPUP_RECENT_MS) {
  const list = (log || []).filter((e) => e && Number.isFinite(e.id));
  let end = list.length;
  while (end > 0 && (list[end - 1].id === panelId || list[end - 1].id < 0)) {
    if (list[end - 1].tab && list[end - 1].id === panelId) return [];
    end--;
  }
  let start = end;
  while (start > 0 && list[start - 1].id !== panelId) start--;
  const out = [];
  for (let i = end - 1; i >= start; i--) {
    const e = list[i];
    if (e.id < 0 || out.includes(e.id)) continue;
    const lost = i + 1 < list.length ? list[i + 1].at : now;
    if (now - lost <= within) out.push(e.id);
  }
  return out;
}

/* ------------------------------------------------------------ chrome 에 꽂기 */

const ALL_SITES = { origins: ['<all_urls>'] };

/**
 * 사이트 접근 권한. captureVisibleTab 은 <all_urls>(또는 activeTab) 가 있어야 하고, 그 탭에 스크립트를 넣는 데도 호스트 권한이 든다.
 * 매니페스트의 optional_host_permissions 에 두고 처음 누를 때 한 번 묻는다(허용하면 남는다). 거절하면 까닭을 던진다.
 */
async function ensureSites() {
  if (!chrome.permissions?.contains) return;
  if (await chrome.permissions.contains(ALL_SITES)) return;
  const ok = await chrome.permissions.request(ALL_SITES).catch((e) => { throw new Error(`사이트 접근 권한을 묻지 못했습니다 — ${e?.message || e}`); });
  if (!ok) throw new Error('웹페이지를 캡처하려면 사이트 접근 권한이 필요합니다 — 다시 누르고 허용해 주세요.');
}

function needApi(api = globalThis.chrome) {
  if (!api || !api.tabs?.captureVisibleTab || !api.scripting?.executeScript) {
    throw new Error('이 브라우저에서는 웹페이지를 캡처할 수 없습니다.');
  }
}

/** 창이 앞에 선 차례 — watchWindows 가 적고 frontTab 이 읽는다(패널 하나에 하나). 오래된 것은 버린다. */
const WATCH = { on: false, log: [] };
const WATCH_KEEP = 30;

/**
 * 창이 앞에 서는 것을 적기 시작한다(2026-10-15 — 첨부를 따로 띄운 팝업 창을 방금 보다가 패널의 단추를 누르면 그 창을 찍으려고).
 * 패널의 캡처 단추(webpick.js 의 createWebPick)가 부른다 — 두 번째부터는 아무것도 하지 않는다. chrome.windows.onFocusChanged(창이 앞에
 * 섬 — 크롬 밖이면 -1)와 chrome.tabs.onActivated(그 창에서 탭을 바꿈 — tab)를 적는다. chrome.windows 가 없으면(테스트·다른 브라우저)
 * 아무것도 하지 않는다.
 * @param {{api?: object, now?: () => number, into?: {on: boolean, log: object[]}}} [deps] 테스트가 갈아 끼운다
 * @returns {{on: boolean, log: {id: number, at: number, tab?: boolean}[]}}
 */
export function watchWindows({ api = globalThis.chrome, now = () => Date.now(), into = WATCH } = {}) {
  if (into.on || typeof api?.windows?.onFocusChanged?.addListener !== 'function') return into;
  into.on = true;
  const note = (id, tab) => {
    if (!Number.isFinite(id)) return;
    into.log.push(tab ? { id, at: now(), tab: true } : { id, at: now() });
    if (into.log.length > WATCH_KEEP) into.log.splice(0, into.log.length - WATCH_KEEP);
  };
  api.windows.onFocusChanged.addListener((id) => note(id, false));
  if (typeof api.tabs?.onActivated?.addListener === 'function') api.tabs.onActivated.addListener((e) => note(e?.windowId, true));
  return into;
}

/** 창을 앞에 둔다 — 팝업 창이 패널 창 뒤에 가려 있으면 찍히지도 고를 수도 없다. 못 해도 넘어간다. */
async function focusWindow(id, api = globalThis.chrome) {
  if (id == null || typeof api?.windows?.update !== 'function') return;
  await Promise.resolve().then(() => api.windows.update(id, { focused: true })).catch(() => {});
}

/**
 * 탭을 앞에 두고 다 읽힐 때까지 기다린다 — 잠든 탭은 앞에 두면 다시 읽는다. 그려질 틈은 찍기 전의 SHOT_GAP_MS 가 준다.
 * windowId 를 주면(팝업 창의 탭) 그 창부터 앞에 둔다.
 */
async function bringUp(tabId, windowId = null) {
  const gone = () => new Error('탭이 닫혔습니다 — 다시 골라 주세요.');
  if (windowId != null) await focusWindow(windowId);
  await chrome.tabs.update(tabId, { active: true }).catch(() => { throw gone(); });
  for (let t = 0; t < READY_MS; t += 200) {
    const now = await chrome.tabs.get(tabId).catch(() => null);
    if (!now) throw gone();
    if (now.active && now.status === 'complete') return;
    await sleep(200);
  }
}

/**
 * 탭 하나의 틀을 맞추는 길 — 고른 틀(pagePick·modalProbe 의 frame)을 받아 그 틀 안에서 함수를 돌리는 함수를 준다(못 맞추면 null).
 * 모든 틀에 frameProbe 를 돌려 frameTarget 으로 고르고, 더 깊은 틀(deep)을 찍을 때는 바깥 틀에서 frameKids 로 그 틀의 자리를 맞춰
 * 함수의 at 에 단다(capturePart 가 그만큼 비켜 오린다 — 자리를 못 맞추면 바깥 틀 그대로). scripting 은 테스트가 갈아 끼운다.
 */
export function frameFinder({ tabId, scripting = globalThis.chrome?.scripting } = {}) {
  const run = async (func, args = [], frameId = null) => (await scripting.executeScript({
    target: frameId == null ? { tabId } : { tabId, frameIds: [frameId] }, func, args,
  }))?.[0]?.result;
  return async (want) => {
    const all = await Promise.resolve().then(() => scripting.executeScript({ target: { tabId, allFrames: true }, func: frameProbe })).catch(() => []);
    const hit = frameTarget((all || []).map((r) => ({ frameId: r.frameId, ...(r.result || {}) })), want);
    if (!hit) return null;
    const into = (id) => (func, args = []) => run(func, args, id);
    if (hit.deep) {
      const kids = await Promise.resolve().then(() => run(frameKids, [], hit.id)).catch(() => null);
      const fit = (Array.isArray(kids) ? kids : []).filter((k) => Math.abs(k.w - hit.deep.w) <= 1 && Math.abs(k.h - hit.deep.h) <= 1);
      if (fit.length === 1) return Object.assign(into(hit.deep.id), { at: { x: fit[0].x, y: fit[0].y } });
    }
    return into(hit.id);
  };
}

/**
 * 탭들을 통째로 찍는다 — 지금은 보고 있는 탭 하나(captureFront)다. 권한은 사용자 동작(단추 누름) 안에서 먼저 묻는다.
 * 찍는 동안 그 탭들이 차례로 앞에 나왔다가, 끝나면 누르기 전에 보던 탭으로 돌아온다. 팝업 창의 탭(frontTab 의 popup)이면 그 창을 앞에 두고
 * 그 창을 찍은 뒤 패널 창을 다시 앞에 둔다(2026-10-15). 탭에 큰 팝업이 떠 있으면 그 안을 찍는다(captureWhole).
 * @param {{id: number, url: string, title?: string, windowId?: number, popup?: boolean}[]} tabs
 * @param {{today?: string, onProgress?: Function, onTarget?: Function}} [opts]
 */
export async function captureTabs(tabs, opts = {}) {
  needApi();
  await ensureSites();
  const win = await chrome.windows.getCurrent();
  const list = tabs || [];
  // 창마다 누르기 전에 앞에 있던 탭 — 끝나면 그 탭으로 돌아온다.
  const fronts = [];
  for (const w of new Set(list.map((t) => t.windowId ?? win.id))) {
    const [f] = await chrome.tabs.query({ active: true, windowId: w });
    if (f) fronts.push(f.id);
  }
  let cur = null;
  return captureMany({
    tabs,
    activate: async (tab) => {
      cur = tab;
      await bringUp(tab.id, tab.popup ? tab.windowId : null);
    },
    back: async () => {
      for (const id of fronts) await Promise.resolve().then(() => chrome.tabs.update(id, { active: true })).catch(() => {});
      if (list.some((t) => t.popup)) await focusWindow(win.id);
    },
    execIn: (tab) => async (func, args = []) => (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }))?.[0]?.result,
    frameIn: (tab) => frameFinder({ tabId: tab.id }),
    shoot: () => chrome.tabs.captureVisibleTab(cur?.windowId ?? win.id, { format: 'png' }),
    ...opts,
  });
}

/**
 * 보고 있는 탭 — 이 창(패널이 붙은 창)의 앞 탭. 다만 방금 보던 팝업 창(chrome 창 type 'popup' — 첨부·문서 보기를 따로 띄운 창)이 있으면
 * 그 창의 탭이다(2026-10-15): watchWindows 가 적은 차례에서 패널 창이 앞을 내준 뒤 앞에 섰던 창 가운데, 그 창에서 패널로 넘어온 지
 * POPUP_RECENT_MS 안이고(popupCandidates) 아직 열려 있고(최소화하지 않은) 찍을 수 있는 웹페이지를 띄운 팝업 창 — 최근 것부터.
 * 그 탭에는 popup·where(팝업 창「제목」)·home(패널 창)이 붙는다. 찍을 수 없는 화면(브라우저 안쪽 화면·파일)이면 까닭을 던진다.
 * @param {{api?: object, log?: object[], now?: number, within?: number}} [deps] 테스트가 갈아 끼운다
 */
export async function frontTab({ api = globalThis.chrome, log = WATCH.log, now = Date.now(), within = POPUP_RECENT_MS } = {}) {
  needApi(api);
  const win = await api.windows.getCurrent();
  if (typeof api.windows.get === 'function') {
    for (const id of popupCandidates(log, win.id, now, within)) {
      const w = await Promise.resolve().then(() => api.windows.get(id, { populate: true })).catch(() => null);
      if (!w || w.type !== 'popup' || w.state === 'minimized') continue;
      const tab = (w.tabs || []).find((x) => x.active) || (w.tabs || [])[0];
      if (!tab || !capturable(tab.url).ok) continue;
      const title = String(tab.title || '').trim() || hostOf(tab.url);
      return { id: tab.id, url: tab.url, title, host: hostOf(tab.url), active: true, windowId: w.id, popup: true, where: `팝업 창「${title.slice(0, 40)}」`, home: win.id };
    }
  }
  const [tab] = await api.tabs.query({ active: true, windowId: win.id });
  const can = capturable(tab?.url);
  if (!can.ok) throw new Error(can.why);
  return { id: tab.id, url: tab.url, title: String(tab.title || '').trim() || hostOf(tab.url), host: hostOf(tab.url), active: true, windowId: win.id };
}

/** 탭에 큰 팝업(첨부 미리보기 창 같은 것)이 떠 있는가 — modalProbe 를 돌려 보고 단 표시는 바로 뗀다. 못 보면 false. */
async function popupOpen(tab) {
  const run = (func, args = []) => chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }).then((r) => r?.[0]?.result);
  const pop = await Promise.resolve().then(() => run(modalProbe)).catch(() => null);
  if (pop?.n != null) await Promise.resolve().then(() => run(partDone, [pop.n])).catch(() => {});
  return !!pop?.n;
}

/** 메일 읽기가 단 표시(첨부 칸·메일 본문)를 그 탭의 모든 틀에서 뗀다(unmarkPage). 못 해도 넘어간다. */
export async function clearMarks(tab) {
  if (tab?.id == null || typeof globalThis.chrome?.scripting?.executeScript !== 'function') return;
  await Promise.resolve().then(() => chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: unmarkPage })).catch(() => {});
}

/**
 * 보고 있는 탭을 위에서 아래까지 통째로 찍는다 — "전체" 단추. 권한은 단추 누름 안에서 먼저 묻는다. 방금 보던 팝업 창을 찍으면
 * 찍기 전에 onTarget({where: '팝업 창「제목」'}) 로 알린다(탭에 뜬 팝업을 찾으면 captureWhole 이 또 알린다).
 * plain 을 주면(2026-10-15 — 메일이면 본문과 첨부를 함께 가져오기, webpick.js) 탭에 큰 팝업이 없을 때 그 탭으로 먼저 불러 보고, 무엇을
 * 돌려주면 그것을 그대로 돌려준다(null 이면 여느 때처럼 통째로 찍는다). 팝업이 떠 있으면 plain 은 부르지 않는다 — 팝업 안을 찍는다.
 * @param {{today?: string, onProgress?: Function, onTarget?: Function, plain?: ((tab: object) => Promise<object|null>)|null}} [opts]
 */
export async function captureFront(opts = {}) {
  needApi();
  await ensureSites();
  const tab = await frontTab();
  if (tab.popup) await Promise.resolve().then(() => opts.onTarget?.({ where: tab.where, tab })).catch(() => {});
  if (typeof opts.plain === 'function' && !(await popupOpen(tab))) {
    const alt = await opts.plain(tab);
    if (alt) return alt;
  }
  const { plain, ...rest } = opts;
  return captureTabs([tab], rest);
}

/**
 * 보고 있는 탭 위에 고르기 막을 씌운다(pagePick) — "부분 골라 캡처" 단추. done 은 사용자가 페이지의 캡처를 누르면 고른 부분들로,
 * 취소하면 null 로 풀린다. cancel 은 패널의 "고르기 취소"다(페이지의 막을 걷는다). 방금 보던 팝업 창이면(frontTab) 그 창을 앞에 두고
 * 그 창에서 고르게 한다(2026-10-15 — 패널 창 뒤에 가려 있으면 막이 보이지 않는다).
 * before 를 주면(2026-10-15 — 메일 읽기의 probeTab) 막을 씌우기 전에 그 탭으로 불러, 돌려준 attachments({key, name}) 의 이름을 막에 넘긴다 —
 * 첨부 칸(data-krs-attach)을 "첨부 파일 · 이름" 으로 고르게. 그 결과는 probe 로 준다(실패하면 null).
 * @param {{before?: ((tab: object) => Promise<{attachments?: {key: string, name: string}[]}|null>)|null}} [opts]
 * @returns {Promise<{tab: object, done: Promise<object[]|null>, cancel: () => Promise<void>, probe: object|null}>}
 */
export async function startPick({ before = null } = {}) {
  needApi();
  await ensureSites();
  const tab = await frontTab();
  if (tab.popup) await focusWindow(tab.windowId);
  const probe = typeof before === 'function' ? await Promise.resolve().then(() => before(tab)).catch(() => null) : null;
  const names = Array.isArray(probe?.attachments) && probe.attachments.length
    ? Object.fromEntries(probe.attachments.filter((a) => a && a.key != null).map((a) => [String(a.key), String(a.name || '')])) : null;
  const done = chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pagePick, ...(names ? { args: [names] } : {}) })
    .then((r) => r?.[0]?.result || null, (e) => { throw new Error(`페이지에서 고르지 못했습니다 — ${e?.message || e}`); });
  const cancel = () => chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pickCancel }).then(() => {}, () => {});
  return { tab, done, cancel, probe: probe || null };
}

/**
 * 고른 부분들을 찍는다(captureParts) — 고른 탭을 앞에 두고(고르는 사이에 탭을 바꿨을 수 있다) 부분마다 찍는다.
 * 고른 틀은 모든 틀에 frameProbe 를 돌려 frameId 를 맞추고(frameFinder — matchFrame·frameTarget), 그 틀 안에서 pageInfo·pageStep·pageDone
 * (틀 안의 스크롤 칸이면 scrollerInfo·scrollerStep·scrollerDone)을 돌린다. 팝업 창의 탭이면 찍은 뒤 패널 창을 다시 앞에 두고, 장마다
 * where(팝업 창「제목」)·fromPopup 을 단다(2026-10-15).
 */
export async function captureTabParts(tab, parts, opts = {}) {
  needApi();
  await bringUp(tab.id, tab.popup ? tab.windowId : null);
  const run = async (func, args = []) => (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }))?.[0]?.result;
  try {
    const got = await captureParts({
      parts, exec: (func, args = []) => run(func, args), frameOf: frameFinder({ tabId: tab.id }),
      shoot: () => chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }), ...opts,
    });
    if (tab.popup) for (const p of got.pages) Object.assign(p, { where: tab.where || '팝업 창', fromPopup: true });
    return got;
  } finally {
    if (tab.popup) await focusWindow(tab.home);
  }
}
