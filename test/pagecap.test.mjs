// 웹페이지 캡처(src/pagecap.js) — 찍을 자리·A4 장 자르기·글자 다듬기·찍는 차례(가짜 탭)·여러 탭·고르기 막(jsdom)·고른 칸 찍기(가짜 페이지)·잇기(가짜 캔버스).
// 2026-10-15("첨부파일을 열면 내용이 팝업으로 뜨는데 그 부분도 일부 또는 전체 캡쳐할 수 있나?") — 페이지 위 팝업 찾기(jsdom)·전체가 팝업으로 가기·
// 틀 안의 스크롤 칸·한 장씩 넘기는 미리보기·틀 안의 틀 맞추기·방금 보던 팝업 창(가짜 chrome.windows)·메일 단추(webpick.js).
// 화면 쪽(공문 탭의 단추 둘 → 읽기 → 첨부 PDF)은 test/wiring.test.mjs, 출장 카드 쪽은 test/tripcap.test.mjs 가 본다.
import assert from 'node:assert/strict';

import {
  MAX_SHOTS, SHOT_GAP_MS, MAX_SCALE, A4_RATIO, TEXT_MAX, POPUP_RECENT_MS, shotPlan, tileRanges, capturable, hostOf, tileName, normalizeText,
  stitchTiles, capturePage, captureMany, readSlots, pageInfo, pageStep, pageDone,
  pagePick, pickCancel, frameProbe, frameKids, partInfo, partStep, partDone, capturePart, captureParts, matchFrame,
  modalProbe, scrollerInfo, scrollerStep, scrollerDone, unmarkPage, captureWhole, frameTarget, frameFinder, popupCandidates, frontTab, watchWindows,
  captureFront,
} from '../src/pagecap.js';
import { JSDOM } from 'jsdom';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

console.log('찍을 자리');
t('한 화면 높이씩 내려가고 마지막은 끝에 맞춘다 — 끝 화면은 앞 화면과 겹친다', () => {
  assert.deepEqual(shotPlan({ scrollHeight: 2500, viewportHeight: 1000 }), { steps: [0, 1000, 1500], height: 2500, cut: false });
  assert.deepEqual(shotPlan({ scrollHeight: 2000, viewportHeight: 1000 }), { steps: [0, 1000], height: 2000, cut: false });
});
t('한 화면보다 짧은 페이지는 한 장이다', () => {
  assert.deepEqual(shotPlan({ scrollHeight: 400, viewportHeight: 1000 }), { steps: [0], height: 1000, cut: false });
  assert.deepEqual(shotPlan({ scrollHeight: 0, viewportHeight: 0 }), { steps: [0], height: 1, cut: false });
});
t(`${MAX_SHOTS}화면을 넘는 긴 페이지는 앞부분만 찍고 cut 에 표시한다`, () => {
  const plan = shotPlan({ scrollHeight: 100_000, viewportHeight: 1000 });
  assert.equal(plan.steps.length, MAX_SHOTS);
  assert.deepEqual([plan.height, plan.cut], [MAX_SHOTS * 1000, true]);
});
t('찍기 사이의 틈은 captureVisibleTab 의 초당 두 장 제한보다 길다', () => assert.ok(SHOT_GAP_MS >= 500));

console.log('A4 장 자르기');
t('한 장의 높이로 자르고 끝의 짧은 꼬리(1/5 미만)는 앞 장에 붙인다', () => {
  assert.deepEqual(tileRanges(5000, 1697), [{ y: 0, h: 1697 }, { y: 1697, h: 1697 }, { y: 3394, h: 1606 }]);
  assert.deepEqual(tileRanges(3500, 1697), [{ y: 0, h: 1697 }, { y: 1697, h: 1803 }], '106px 꼬리는 앞 장에');
  assert.deepEqual(tileRanges(3800, 1697), [{ y: 0, h: 1697 }, { y: 1697, h: 1697 }, { y: 3394, h: 406 }], '406px 는 한 장');
});
t('한 장보다 짧으면 그 높이 한 장, 0 이면 없다', () => {
  assert.deepEqual(tileRanges(300, 1697), [{ y: 0, h: 300 }]);
  assert.deepEqual(tileRanges(0, 1697), []);
});
t('A4 비율', () => assert.ok(Math.abs(A4_RATIO - 1.4143) < 0.001));

console.log('주소·이름·글자');
t('http·https 만 캡처한다 — 브라우저 안쪽 화면·빈 탭은 까닭을 말한다', () => {
  assert.equal(capturable('https://www.inflearn.com/course/x').ok, true);
  assert.equal(capturable('http://intra/').ok, true);
  assert.match(capturable('chrome://extensions').why, /캡처할 수 없습니다/);
  assert.match(capturable('chrome-extension://abc/sidepanel.html').why, /캡처할 수 없습니다/);
  assert.match(capturable('').why, /캡처할 탭이 없습니다/);
});
t('호스트는 www. 을 뺀다, 이름은 화면캡처_호스트_날짜_n.png', () => {
  assert.equal(hostOf('https://www.inflearn.com/course/x?a=1'), 'inflearn.com');
  assert.equal(hostOf('nonsense'), 'page');
  assert.equal(tileName('inflearn.com', '2026-10-08', 3), '화면캡처_inflearn.com_2026-10-08_3.png');
  assert.equal(tileName('a:b/c', '', 1), '화면캡처_abc_1.png', '파일 이름에 못 쓰는 글자는 뺀다');
});
t('화면 글자는 머리말(제목·주소)을 달고, 빈 줄은 하나로, 빈칸은 하나로', () => {
  const got = normalizeText('  강의 소개 \n\n\n\n커리큘럼\t섹션 1 ·  강의 2\r\n\n  ', { title: 'Hermes Bot 강의 - 인프런', url: 'https://www.inflearn.com/course/x' });
  assert.equal(got, '[웹페이지 글자 — Hermes Bot 강의 - 인프런] https://www.inflearn.com/course/x\n강의 소개\n\n커리큘럼 섹션 1 · 강의 2');
  assert.equal(normalizeText('   \n\n'), '', '글자가 없으면 빈 글');
});
t(`글자는 ${TEXT_MAX}자에서 자르고 잘랐다고 적는다`, () => {
  const got = normalizeText('가'.repeat(TEXT_MAX + 500));
  assert.ok(got.length < TEXT_MAX + 100);
  assert.match(got, /…\(너무 길어 여기서 잘랐습니다\)$/);
});

console.log('탭 안에서 도는 함수 — 바깥 변수를 쓰지 않는다(chrome.scripting 이 글자 그대로 옮긴다)');
/** 다른 창(jsdom)에서 만든 것은 프로토타입이 달라 deepEqual 이 다르다고 본다 — 글로 옮겼다 되돌린다. */
const plain = (x) => JSON.parse(JSON.stringify(x));
const IN_PAGE = [pageInfo, pageStep, pageDone, pagePick, pickCancel, frameProbe, frameKids, partInfo, partStep, partDone, modalProbe, scrollerInfo, scrollerStep, scrollerDone, unmarkPage];
t('탭 안에서 도는 함수들은 import 한 것도 모듈의 상수도 쓰지 않는다', () => {
  for (const fn of IN_PAGE) {
    const src = fn.toString();
    assert.ok(!/MAX_SHOTS|SHOT_GAP_MS|A4_RATIO|TEXT_MAX|TEXT_HEAD|READY_MS|POPUP_RECENT_MS|WATCH|normalizeText|tileRanges|shotPlan|hostOf|capturable|popupCandidates|sleep\(/.test(src), `${fn.name} 이 모듈의 것을 쓴다`);
  }
});
t('글자 그대로 다른 창에 옮겨도 돈다 — chrome.scripting 이 하는 것처럼 페이지 창에서 소스로 다시 만든다', () => {
  const { window } = new JSDOM('<p data-krs-cap="1">글자</p>', { runScripts: 'outside-only', url: 'https://a.b/x' });
  for (const fn of IN_PAGE) assert.equal(typeof window.eval(`(${fn.toString()})`), 'function', fn.name);
  const info = window.eval(`(${partInfo.toString()})`)(1);
  assert.deepEqual([info.url, info.text, info.frame, info.box], ['https://a.b/x', '글자', false, null]);
  assert.deepEqual(plain(window.eval(`(${frameProbe.toString()})`)()), { href: 'https://a.b/x', name: '', w: 1024, h: 768, child: false, depth: 0, scrolls: false });
});

console.log('페이지 위에서 부분 고르기 (jsdom — 자리는 data-rect 로 흉내)');
{
  // 카드(.card) 안에 문단, 그 둘레에 section, 옆에 본문 틀(iframe), 작은 단추(프레임이 아님). 자리는 data-rect="x y w h".
  const { window } = new JSDOM(`<body data-rect="0 0 1200 2000">
    <section id="sec" data-rect="0 100 1200 900"><div id="card" class="card" data-rect="20 120 600 300"><h3 data-rect="30 130 300 30">교육 안내</h3>
      <p id="p" data-rect="30 170 500 40">강의 소개 글</p><button id="btn" data-rect="30 220 80 30">신청</button></div></section>
    <iframe id="frm" name="content-iframe" src="https://a.b/frame" data-rect="0 1000 1200 800"></iframe></body>`, { runScripts: 'outside-only', url: 'https://a.b/' });
  const { document } = window;
  const rect = (el) => {
    const [x, y, w, h] = (el.dataset?.rect || '0 0 0 0').split(' ').map(Number);
    return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y };
  };
  window.Element.prototype.getBoundingClientRect = function () { return rect(this); };
  // 그 자리에 걸친 요소들 — 깊은 것부터(맨 위에 그려진 것부터). 고르기 막(host)이 있으면 그것이 맨 앞이다.
  document.elementsFromPoint = (x, y) => {
    const hits = [...document.querySelectorAll('[data-rect]')].filter((el) => { const r = rect(el); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; });
    hits.sort((a, b) => (a.contains(b) ? 1 : b.contains(a) ? -1 : 0));
    const host = document.querySelector('[data-krs-pick]');
    return host ? [host, ...hits] : hits;
  };
  const pick = window.eval(`(${pagePick.toString()})`);
  const shadow = () => document.querySelector('[data-krs-pick]')?.shadowRoot;
  const mouse = (type, x, y) => shadow().querySelector('.veil').dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
  const key = (k) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  const done = pick();
  await ta('막을 씌우고 위쪽 띠에 안내와 캡처(꺼짐)·취소가 선다 — shadow DOM 이라 페이지 CSS 와 섞이지 않는다', async () => {
    assert.ok(shadow(), '고르기 막');
    assert.match(shadow().querySelector('.bar').textContent, /캡처할 부분을 누르세요 — 여러 개 고를 수 있습니다/);
    assert.ok(shadow().querySelector('.go').disabled);
  });
  await ta('문단을 가리키면 그것을 품은 카드가 점선 칸이 되고, ↑ 는 한 겹 큰 칸(section) — 작은 단추는 프레임이 아니다', async () => {
    mouse('mousemove', 40, 180);
    const hover = shadow().querySelector('.box.hover');
    assert.ok(!hover.hidden);
    assert.deepEqual([hover.style.left, hover.style.top, hover.style.width, hover.style.height], ['20px', '120px', '600px', '300px']);
    assert.match(shadow().querySelector('.tag').textContent, /누르면 고르기 · 칸 600×300 · ↑ 더 큰 칸/);
    key('ArrowUp');
    assert.equal(hover.style.height, '900px', 'section');
    key('ArrowDown');
    assert.equal(hover.style.height, '300px');
    mouse('mousemove', 40, 230);
    assert.equal(hover.style.width, '600px', '단추 위여도 카드');
  });
  await ta('누르면 번호가 붙어 골라지고, 다시 누르면 빠진다 — 틀(iframe)은 틀째로 골라진다', async () => {
    mouse('click', 40, 180);
    assert.deepEqual([...shadow().querySelectorAll('.marks .box b')].map((b) => b.textContent), ['1']);
    assert.equal(shadow().querySelector('.go').textContent, '1개 캡처');
    mouse('mousemove', 600, 1500);
    mouse('click', 600, 1500);
    key('ArrowUp');   // 틀 위로는 더 큰 칸이 없다(body 는 프레임이 아니다)
    mouse('mousemove', 700, 500);
    key('ArrowUp');
    mouse('click', 700, 500);   // section 을 고르고
    assert.equal(shadow().querySelector('.go').textContent, '3개 캡처');
    mouse('click', 700, 500);   // 다시 누르면 빠진다
    assert.equal(shadow().querySelector('.go').textContent, '2개 캡처');
  });
  await ta('Enter 면 고른 차례대로 data-krs-cap 을 달고 목록을 준다 — 막은 걷힌다', async () => {
    key('Enter');
    const got = plain(await done);
    assert.equal(shadow(), undefined);
    assert.deepEqual(got, [
      { n: 1, tag: 'div', title: '교육 안내', frame: null },
      { n: 2, tag: 'iframe', title: 'content-iframe', frame: { href: got[1].frame.href, src: 'https://a.b/frame', name: 'content-iframe', w: 0, h: 0 } },
    ]);
    assert.deepEqual([document.getElementById('card').dataset.krsCap, document.getElementById('frm').dataset.krsCap], ['1', '2']);
    assert.equal(window.__krsPick, undefined);
  });
  await ta('Esc·취소·pickCancel 은 null — 앞서 단 표시는 그대로 둔다', async () => {
    const a = pick();
    key('Escape');
    assert.equal(await a, null);
    const b = pick();
    shadow().querySelector('.no').click();
    assert.equal(await b, null);
    const c = pick();
    window.eval(`(${pickCancel.toString()})`)();
    assert.equal(await c, null);
    assert.equal(document.querySelector('[data-krs-pick]'), null);
  });
  await ta('아무것도 고르지 않으면 Enter 는 듣지 않는다', async () => {
    const d = pick();
    key('Enter');
    assert.ok(shadow(), '그대로 고르는 중');
    key('Escape');
    assert.equal(await d, null);
  });
}

console.log('페이지 위의 팝업 찾기 (jsdom 1024×768 — 자리는 data-rect, 겹침은 data-z, 2026-10-15 첨부 미리보기)');
/**
 * 가짜 페이지 — 자리는 data-rect="x y w h", 눌렀을 때 맨 위인 것은 data-z(가장 가까운 조상의 것)가 큰 것, 같으면 문서에서 나중 것(안쪽).
 * 스크롤 상자는 data-scroll="안의 높이" 로 흉내 낸다(clientHeight 는 data-rect 의 높이).
 */
function domPage(body, url = 'https://outlook.cloud.microsoft/mail/inbox/id/x') {
  const { window } = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { runScripts: 'outside-only', url });
  const { document } = window;
  const rect = (el) => {
    const [x, y, w, h] = (el.getAttribute?.('data-rect') || '0 0 0 0').split(' ').map(Number);
    return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y };
  };
  window.Element.prototype.getBoundingClientRect = function () { return rect(this); };
  for (const el of document.querySelectorAll('[data-rect]')) {
    const r = rect(el);
    const sh = Number(el.dataset.scroll || 0);
    let top = 0;
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => r.width });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => r.height });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => Math.max(sh, r.height) });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v) => { top = Math.max(0, Math.min(v, Math.max(sh, r.height) - r.height)); } });
  }
  const zOf = (el) => Number(el.closest('[data-z]')?.dataset.z || 0);
  const hidden = (el) => !!el.closest('[style*="display: none"], [style*="display:none"]');
  document.elementFromPoint = (x, y) => {
    const hits = [...document.querySelectorAll('[data-rect]')].filter((el) => { const r = rect(el); return !hidden(el) && x >= r.left && x < r.right && y >= r.top && y < r.bottom; });
    hits.sort((a, b) => zOf(b) - zOf(a) || (a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1));
    return hits[0] || null;
  };
  const run = (fn, ...args) => {
    const v = window.eval(`(${fn.toString()})`)(...args);
    return v === undefined ? undefined : plain(v);
  };
  return { window, document, run, marked: () => [...document.querySelectorAll('[data-krs-cap]')].map((e) => e.id || e.className) };
}
// 새 Outlook 의 첨부 미리보기 — 감춘 겉칸(.ms-Layer) 안에 반투명 바탕과 대화상자(role=dialog·aria-modal), 그 안에 파일 이름 띠와 틀(about:blank).
const OUTLOOK = `<div id="app" data-rect="0 0 1024 768"><div id="list" data-rect="0 0 1024 768">받은 편지함</div></div>
  <div class="ms-Layer ms-Layer--fixed" style="position: fixed; visibility: hidden" data-rect="0 0 1024 768" data-z="1000001">
    <div class="fui-DialogSurface__backdrop" style="position: fixed; visibility: visible; background-color: rgba(0, 0, 0, 0.4)" data-rect="0 0 1024 768"></div>
    <div id="dlg" class="fui-DialogSurface" role="dialog" aria-modal="true" aria-labelledby="none" style="position: fixed; visibility: visible; background-color: rgb(255, 255, 255)" data-rect="26 24 972 720">
      <div id="bar" data-rect="27 25 970 45"><div title="회의 자료.pptx" data-rect="40 30 300 30">회의 자료.pptx</div><button data-rect="900 30 60 30">다운로드</button></div>
      <iframe id="prev" src="about:blank" data-rect="27 70 970 673"></iframe>
    </div></div>`;
t('팝업이 없으면 null — 아무것도 달지 않고, 앞서 남은 표시(popup)는 뗀다', () => {
  const p = domPage('<main data-rect="0 0 1024 3000"><p data-krs-cap="popup" id="old" data-rect="0 0 500 20">글</p></main>');
  assert.equal(p.run(modalProbe), null);
  assert.deepEqual(p.marked(), []);
});
t('작은 팝업(창의 35% 미만 — 확인 상자)·숨긴 팝업·흐름 속의 popup 이름 칸은 팝업이 아니다', () => {
  assert.equal(domPage('<div role="dialog" style="position: fixed" data-rect="400 300 300 150">지울까요?</div>').run(modalProbe), null, '작은 확인 상자');
  assert.equal(domPage('<div role="dialog" style="position: fixed; display: none" data-rect="26 24 972 720">숨김</div>').run(modalProbe), null, 'display: none');
  assert.equal(domPage('<div role="dialog" style="position: fixed; opacity: 0" data-rect="26 24 972 720">투명</div>').run(modalProbe), null, 'opacity 0');
  assert.equal(domPage('<div class="popup-content" data-rect="0 0 1024 700">흐름 속 글</div>').run(modalProbe), null, 'position 이 없는 칸');
  assert.equal(domPage('<div class="modal-backdrop" style="position: fixed" data-rect="0 0 1024 768"></div>').run(modalProbe), null, '빈 바탕막');
});
t('새 Outlook 첨부 미리보기 — 대화상자를 거의 채운 틀(about:blank)을 찍을 것으로 삼고, 파일 이름이 제목·"첨부 미리보기 창"이다', () => {
  const p = domPage(OUTLOOK);
  const got = p.run(modalProbe);
  assert.deepEqual(got, { n: 'popup', kind: 'frame', label: '첨부 미리보기 창', title: '회의 자료.pptx', cover: 0.89,
    frame: { href: 'about:blank', src: 'about:blank', name: '', w: 970, h: 673 } });
  assert.deepEqual(p.marked(), ['prev'], '틀에 data-krs-cap="popup"');
  assert.equal(p.run(partInfo, 'popup').frame, true, '고른 부분을 찍는 길(partInfo)이 그대로 찾는다');
  p.run(partDone, 'popup');
  assert.deepEqual(p.marked(), []);
});
t('두 팝업이 겹치면 맨 위의 것 — 창을 다 덮는 반투명 겉칸(.modal)은 그 안의 상자로 보고, 가려진 아래 팝업은 고르지 않는다', () => {
  const p = domPage(`<div id="low" role="dialog" style="position: fixed; background-color: rgb(255, 255, 255)" data-rect="50 50 900 650" data-z="10"><h2>아래 팝업</h2></div>
    <div class="modal show" role="dialog" aria-modal="true" style="position: fixed; background-color: rgba(0, 0, 0, 0.5)" data-rect="0 0 1024 768" data-z="20">
      <div id="mdlg" class="modal-dialog" data-rect="180 140 660 460"><div id="mc" class="modal-content" style="background-color: rgb(255, 255, 255)" data-rect="180 140 660 460">
        <h3 data-rect="190 150 300 30">교육 안내</h3><div class="modal-body" data-rect="190 190 640 400">본문</div></div></div></div>`);
  const got = p.run(modalProbe);
  assert.deepEqual([got.kind, got.label, got.title], ['plain', '팝업', '교육 안내']);
  assert.deepEqual(p.marked(), ['mdlg'], '겉칸이 아니라 상자(겹친 것은 바깥 하나)');
  // 위의 팝업(z-index 큰 것)이 아래 팝업을 다 가리면 아래 것은 한 곳도 맨 위가 아니다 — 위의 것.
  const q = domPage(`<div role="dialog" style="position: fixed; background-color: rgb(255, 255, 255)" data-rect="50 50 900 650" data-z="10"><h2>아래</h2></div>
    <div role="dialog" style="position: fixed; background-color: rgb(255, 255, 255)" data-rect="40 40 920 680" data-z="30"><h2>위</h2></div>`);
  assert.equal(q.run(modalProbe).title, '위');
});
t('팝업 안이 따로 내려가는 칸(팝업의 절반 이상)이면 그 칸을 찍을 것으로 삼는다(상자 모드)', () => {
  const p = domPage(`<div role="dialog" style="position: fixed" data-rect="100 50 800 650"><h2 data-rect="110 55 300 40">공지 사항</h2>
    <div id="scr" style="overflow-y: auto" data-rect="100 100 800 600" data-scroll="2400">긴 글</div></div>`);
  const got = p.run(modalProbe);
  assert.deepEqual([got.kind, got.title, got.frame], ['box', '공지 사항', null]);
  assert.deepEqual(p.marked(), ['scr']);
  assert.deepEqual(p.run(partInfo, 'popup').box, { scrollTop: 0, scrollHeight: 2400 });
});

console.log('부분 고르기의 첨부 칸 (jsdom — 2026-10-15 "부분으로 첨부파일 클릭하면 첨부파일만 가져오고")');
{
  // 메일 읽기가 첨부 칸(작다 — 90×30)에 data-krs-attach 를, 본문에 data-krs-cap="mail" 을 달아 두었다. 칸 안에는 커다란 그림 아이콘이 있다.
  const { window } = new JSDOM(`<body data-rect="0 0 1200 2000"><div id="mail" data-krs-cap="mail" data-rect="0 0 1200 1500">
    <div class="att" id="att" data-krs-attach="a1" data-rect="20 20 90 30"><img id="ico" data-rect="22 22 120 40"><span data-rect="40 22 60 20">안내문.pdf</span></div>
    <section id="body" data-rect="0 100 1200 900">본문 첫 줄</section></div></body>`, { runScripts: 'outside-only', url: 'https://outlook.cloud.microsoft/mail/' });
  const { document } = window;
  const rect = (el) => {
    const [x, y, w, h] = (el.dataset?.rect || '0 0 0 0').split(' ').map(Number);
    return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y };
  };
  window.Element.prototype.getBoundingClientRect = function () { return rect(this); };
  document.elementsFromPoint = (x, y) => {
    const hits = [...document.querySelectorAll('[data-rect]')].filter((el) => { const r = rect(el); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; });
    hits.sort((a, b) => (a.contains(b) ? 1 : b.contains(a) ? -1 : 0));
    const host = document.querySelector('[data-krs-pick]');
    return host ? [host, ...hits] : hits;
  };
  const pick = window.eval(`(${pagePick.toString()})`);
  const shadow = () => document.querySelector('[data-krs-pick]')?.shadowRoot;
  const mouse = (type, x, y) => shadow().querySelector('.veil').dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
  await ta('첨부 칸은 작아도 고르고(칸 안의 그림을 가리켜도 그 칸), 띠에는 "첨부 파일 · 이름" — 고르면 attach 로 주고 찍을 표시는 달지 않는다', async () => {
    const done = pick({ a1: '11월 안내문.pdf' });
    mouse('mousemove', 30, 30);
    assert.match(shadow().querySelector('.tag').textContent, /^누르면 고르기 · 첨부 파일 · 11월 안내문\.pdf/);
    mouse('click', 30, 30);
    mouse('mousemove', 600, 500);
    mouse('click', 600, 500);
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.deepEqual(plain(await done), [
      { n: 1, tag: 'div', title: '11월 안내문.pdf', frame: null, attach: 'a1' },
      { n: 2, tag: 'section', title: '본문 첫 줄', frame: null },
    ]);
    assert.deepEqual([document.getElementById('att').dataset.krsCap, document.getElementById('body').dataset.krsCap], [undefined, '2']);
    assert.equal(document.getElementById('mail').dataset.krsCap, 'mail', '메일 본문 표시는 메일 읽기의 것 — 그대로');
  });
  t('표시 떼기(unmarkPage) — 첨부 칸·메일 본문·팝업 표시만 떼고, 고른 부분의 번호는 그대로 둔다', () => {
    document.getElementById('att').setAttribute('data-krs-cap', 'popup');
    assert.equal(window.eval(`(${unmarkPage.toString()})`)(), 3);
    assert.deepEqual([document.querySelectorAll('[data-krs-attach]').length, document.getElementById('mail').dataset.krsCap, document.getElementById('body').dataset.krsCap],
      [0, undefined, '2']);
  });
}

console.log('틀 안이 어떻게 내려가는지 (jsdom — 2026-10-15 Word·PDF·PowerPoint 미리보기)');
t('문서가 정말 내려가면 doc, 안쪽의 큰 스크롤 칸이 내려가면 그 칸(틀 창의 30% 이상)의 자리, 슬라이드 화면이면 paged', () => {
  const doc = domPage('<main data-rect="0 0 1024 3000">긴 글</main>', 'https://a.b/frame');
  Object.defineProperty(doc.document.documentElement, 'scrollHeight', { configurable: true, get: () => 3000 });
  Object.defineProperty(doc.document.documentElement, 'clientHeight', { configurable: true, get: () => 768 });
  assert.deepEqual(doc.run(scrollerInfo), { doc: { scrollHeight: 3000, clientHeight: 768 }, box: null, paged: false });
  const word = domPage(`<div id="ribbon" style="overflow-y: auto" data-rect="0 0 1024 40" data-scroll="80">띠</div>
    <div id="thumbs" style="overflow-y: auto" data-rect="0 40 150 728" data-scroll="9000">쪽 그림</div>
    <div id="body" style="overflow-y: auto" data-rect="150 40 874 728" data-scroll="6000">본문</div>`, 'https://word-view.officeapps.live.com/wv/x');
  assert.deepEqual(word.run(scrollerInfo), { doc: null, box: { x: 150, y: 40, w: 874, h: 728, scrollTop: 0, scrollHeight: 6000, clientHeight: 728 }, paged: false }, '쪽 그림 띠가 아니라 본문 칸');
  const fresh = word.window.eval(`(${scrollerStep.toString()})`);
  word.window.eval(`(${scrollerInfo.toString()})`)();
  assert.equal(fresh(2000), 2000);
  assert.equal(fresh(9999), 6000 - 728, '끝에서는 덜 내려간다');
  word.window.eval(`(${scrollerDone.toString()})`)();
  assert.deepEqual([word.document.getElementById('body').scrollTop, word.window.__krsScroll], [0, undefined], '칸 자리를 되돌린다');
  const ppt = domPage('<div id="SlidePanel" class="SlidePanel" data-rect="0 40 1024 700">제목 슬라이드</div>', 'https://a.b/viewer');
  assert.deepEqual(ppt.run(scrollerInfo), { doc: null, box: null, paged: true });
  assert.equal(domPage('<p data-rect="0 0 500 20">짧은 글</p>', 'https://krc-powerpoint.officeapps.live.com/p/PowerPointFrame.aspx?PowerPointView=ReadingView').run(scrollerInfo).paged, true, 'PowerPoint 보기 주소');
  assert.equal(domPage('<p data-rect="0 0 500 20">짧은 글</p>', 'https://eclass.krs.co.kr/x').run(scrollerInfo).paged, false, '짧은 틀은 그냥 짧은 것');
  assert.equal(domPage('<button aria-label="다음 슬라이드" data-rect="0 0 40 40">›</button>', 'https://a.b/v').run(scrollerInfo).paged, true);
});
t('틀마다 깊이와 내려가는지(frameProbe), 틀 안의 틀 자리(frameKids)', () => {
  const p = domPage(`<div style="overflow-y: auto" data-rect="0 40 1024 700" data-scroll="5000">본문</div>
    <iframe id="k" data-rect="10 45 600 400"></iframe>`, 'https://a.b/outer');
  const probe = p.run(frameProbe);
  assert.deepEqual([probe.depth, probe.scrolls], [0, true]);
  assert.deepEqual(p.run(frameKids), [{ x: 10, y: 45, w: 600, h: 400 }]);
});
t('떠 있는 칸(position: fixed 안 — 대화상자의 틀)은 머리에 둔다고 창을 내리지 않는다 — 흐름 속 칸은 내린다', () => {
  const p = domPage(`<div style="position: fixed" data-rect="26 24 972 720"><iframe data-krs-cap="popup" data-rect="27 70 970 673"></iframe></div>
    <section data-krs-cap="2" data-rect="0 1500 800 300">아래 칸</section>`);
  const moved = [];
  p.window.scrollBy = (x, y) => moved.push(['by', y]);
  p.window.scrollTo = (x, y) => moved.push(['to', y]);
  p.window.Element.prototype.scrollIntoView = function () { moved.push(['into', this.tagName]); };
  const step = p.window.eval(`(${partStep.toString()})`);
  const done = p.window.eval(`(${partDone.toString()})`);
  const head = plain(step('popup', 0, null));
  assert.deepEqual([head.top, head.left, moved], [70, 27, []]);
  done('popup');
  moved.length = 0;
  step(2, 0, null);
  assert.deepEqual(moved, [['into', 'SECTION'], ['by', 1500]]);
  done(2);
});

console.log('찍는 차례 (가짜 탭)');
/** 가짜 탭 — 높이 4200, 뷰포트 1200×1000. 찍을 때마다 자리를 적어 두고, 끝에 되돌렸는지 본다. */
function fakeTab({ scrollHeight = 4200, text = '강의 소개\n\n\n커리큘럼' } = {}) {
  const log = [];
  const page = { scrollY: 350, hidden: null };
  const exec = async (func, args) => {
    log.push([func.name, ...args]);
    if (func === pageInfo) {
      return { url: 'https://www.inflearn.com/course/x', title: 'Hermes Bot 강의', scrollHeight, viewportHeight: 1000, viewportWidth: 1200, dpr: 1.25, scrollY: page.scrollY, text };
    }
    if (func === pageStep) {
      const [y, hide] = args;
      if (hide) page.hidden = true;
      page.scrollY = Math.min(y, scrollHeight - 1000);
      return page.scrollY;
    }
    if (func === pageDone) {
      page.hidden = false;
      page.scrollY = args[0];
      return null;
    }
    throw new Error(`모르는 함수 ${func.name}`);
  };
  let shots = 0;
  const shoot = async () => `data:image/png;base64,${Buffer.from(`shot-${shots++}-at-${page.scrollY}`).toString('base64')}`;
  return { exec, shoot, log, page };
}

await ta('한 화면씩 내려가며 찍고(두 번째부터 고정 띠 숨김) 끝에 되돌린 뒤, A4 장과 머리말 단 글자를 돌려준다', async () => {
  const tab = fakeTab();
  const waits = [];
  const progress = [];
  let job;
  const got = await capturePage({
    tab: { url: 'https://www.inflearn.com/course/x' }, exec: tab.exec, shoot: tab.shoot, today: '2026-10-08',
    wait: async (ms) => { waits.push(ms); },
    stitch: async (j) => { job = j; return j.shots.map(() => new Blob(['png'], { type: 'image/png' })).slice(0, 3); },
    onProgress: (a, b) => progress.push(`${a}/${b}`),
  });
  // 4200 / 1000 → 0, 1000, 2000, 3000, 3200(끝에 맞춤)
  assert.deepEqual(tab.log.map((l) => l.join(' ')), ['pageInfo', 'pageStep 0 false', 'pageStep 1000 true', 'pageStep 2000 true', 'pageStep 3000 true', 'pageStep 3200 true', 'pageDone 350']);
  assert.deepEqual([tab.page.scrollY, tab.page.hidden], [350, false], '자리와 숨긴 것을 되돌렸다');
  assert.deepEqual(waits, Array(5).fill(SHOT_GAP_MS));
  assert.deepEqual(progress, ['1/5', '2/5', '3/5', '4/5', '5/5']);
  assert.deepEqual(job.shots.map((s) => [s.y, s.h]), [[0, 1000], [1000, 1000], [2000, 1000], [3000, 1000], [3200, 1000]], '실제로 선 자리를 쓴다');
  assert.deepEqual([job.viewportWidth, job.totalHeight, job.tileHeight], [1200, 4200, Math.round(1200 * A4_RATIO)]);
  assert.deepEqual(got.files.map((f) => [f.name, f.type]), [
    ['화면캡처_inflearn.com_2026-10-08_1.png', 'image/png'], ['화면캡처_inflearn.com_2026-10-08_2.png', 'image/png'], ['화면캡처_inflearn.com_2026-10-08_3.png', 'image/png'],
  ]);
  assert.equal(got.text, '[웹페이지 글자 — Hermes Bot 강의] https://www.inflearn.com/course/x\n강의 소개\n\n커리큘럼');
  assert.deepEqual([got.host, got.shots, got.tiles, got.cut, got.title], ['inflearn.com', 5, 3, false, 'Hermes Bot 강의']);
});
await ta('찍다가 실패해도 탭을 되돌린다', async () => {
  const tab = fakeTab();
  let n = 0;
  const shoot = async () => { if (++n === 2) throw new Error('Tabs cannot be edited right now'); return tab.shoot(); };
  await assert.rejects(capturePage({ tab: { url: 'https://a.b/' }, exec: tab.exec, shoot, wait: async () => {}, stitch: async () => [] }), /Tabs cannot be edited/);
  assert.equal(tab.log.at(-1)[0], 'pageDone');
  assert.deepEqual([tab.page.scrollY, tab.page.hidden], [350, false]);
});
await ta('캡처할 수 없는 주소는 탭을 건드리지 않고 던진다', async () => {
  const tab = fakeTab();
  await assert.rejects(capturePage({ tab: { url: 'chrome://extensions' }, exec: tab.exec, shoot: tab.shoot }), /캡처할 수 없습니다/);
  assert.deepEqual(tab.log, []);
});
await ta('긴 페이지는 앞부분만 찍고 cut 을 알린다', async () => {
  const tab = fakeTab({ scrollHeight: 100_000 });
  const got = await capturePage({ tab: { url: 'https://a.b/' }, exec: tab.exec, shoot: tab.shoot, wait: async () => {}, stitch: async (j) => j.shots.slice(0, 1).map(() => new Blob(['x'])) });
  assert.deepEqual([got.shots, got.cut], [MAX_SHOTS, true]);
});

console.log('여러 탭 (2026-10-08 — 전체 또는 하나 이상 골라 찍기)');
t('읽기 자리는 탭마다 첫 장부터 돌아가며 나눈다 — 긴 탭 하나가 다 차지하지 않는다', () => {
  assert.deepEqual(readSlots([4, 3], 5), [true, true, true, false, true, true, false]);
  assert.deepEqual(readSlots([7], 5), [true, true, true, true, true, false, false], '탭 하나면 앞 다섯 장');
  assert.deepEqual(readSlots([1, 6, 1], 5), [true, true, true, true, false, false, false, true]);
  assert.deepEqual(readSlots([2, 2], 0), [false, false, false, false], '자리가 없으면 모두 첨부에만');
  assert.deepEqual(readSlots([2, 1], 9), [true, true, true]);
});
/** 가짜 창 — 탭마다 fakeTab 을 두고, 앞에 둔 탭을 적어 둔다. */
function fakeWindow(pages) {
  const front = { id: 9 };
  const order = [];
  const tabs = Object.fromEntries(Object.entries(pages).map(([id, opts]) => [id, fakeTab(opts)]));
  return {
    front, order, tabs,
    activate: async (tab) => { if (tab.id === 66) throw new Error('탭이 닫혔습니다'); front.id = tab.id; order.push(tab.id); },
    back: async () => { front.id = 9; order.push(9); },
    execIn: (tab) => tabs[tab.id].exec,
    shoot: async () => tabs[front.id].shoot(),
  };
}
const stitchAll = async (j) => j.shots.map(() => new Blob(['png'], { type: 'image/png' }));
await ta('고른 탭을 차례로 앞에 두고 찍은 뒤 보던 탭으로 돌아온다 — 같은 사이트는 장 번호를 잇고, 글자 한도는 탭 수로 나눈다', async () => {
  const win = fakeWindow({ 1: { scrollHeight: 2000, text: '가'.repeat(TEXT_MAX) }, 2: { scrollHeight: 1000, text: '나'.repeat(TEXT_MAX) } });
  const progress = [];
  const got = await captureMany({
    tabs: [{ id: 1, url: 'https://www.inflearn.com/course/x', title: '강의' }, { id: 2, url: 'https://www.inflearn.com/course/x/curriculum', title: '커리큘럼' }],
    activate: win.activate, back: win.back, execIn: win.execIn, shoot: win.shoot, wait: async () => {}, stitch: stitchAll, today: '2026-10-08',
    onProgress: (...a) => progress.push(a.join(' ')),
  });
  assert.deepEqual(win.order, [1, 2, 9]);
  assert.deepEqual(progress, ['1 2 1 2', '2 2 1 2', '1 1 2 2']);
  assert.deepEqual(got.pages.map((p) => p.files.map((f) => f.name.replace('화면캡처_inflearn.com_2026-10-08_', ''))), [['1.png', '2.png'], ['3.png']]);
  assert.deepEqual(got.failed, []);
  const total = got.pages.reduce((n, p) => n + p.text.length, 0) + 2;   // 이음 줄
  assert.ok(total <= TEXT_MAX, `두 탭의 글자를 합쳐 ${total}자 — ${TEXT_MAX}자 안이어야 한다`);
  assert.ok(got.pages.every((p) => /잘랐습니다\)$/.test(p.text)));
});
await ta('한 탭이 실패해도 나머지는 찍고 까닭을 남긴다, 모두 실패하면 던지고 그래도 보던 탭으로 돌아온다', async () => {
  const win = fakeWindow({ 1: {} });
  const got = await captureMany({
    tabs: [{ id: 66, url: 'https://gone.example/', title: '닫힌 탭' }, { id: 1, url: 'https://a.b/', title: '강의' }],
    activate: win.activate, back: win.back, execIn: win.execIn, shoot: win.shoot, wait: async () => {}, stitch: stitchAll,
  });
  assert.deepEqual([got.pages.length, got.failed], [1, [{ title: '닫힌 탭', why: '탭이 닫혔습니다' }]]);
  const win2 = fakeWindow({});
  await assert.rejects(captureMany({ tabs: [{ id: 66, url: 'https://gone.example/', title: '닫힌 탭' }], activate: win2.activate, back: win2.back, execIn: win2.execIn, shoot: win2.shoot }), /탭이 닫혔습니다/);
  assert.deepEqual(win2.order, [9]);
  await assert.rejects(captureMany({ tabs: [], activate: win2.activate, back: win2.back }), /고르세요/);
});

console.log('고른 부분 찍기 (가짜 페이지 — 창 1200×1000)');
/**
 * 가짜 페이지 — 고른 부분 n 의 자리(문서 기준 top·left·width·height)와 창 자리를 들고, partStep 이 창·상자를 내리면 창 안 자리를 셈한다.
 * box 를 주면 상자 안이 따로 내려가고(scrollHeight), frame 을 주면 그 틀 안의 가짜 창(pageInfo·pageStep·pageDone)을 준다.
 */
function fakePart({ top = 1500, left = 100, width = 800, height = 2500, box = null, frame = null, pageHeight = 6000, text = '카드 글자' } = {}) {
  const log = [];
  const page = { scrollY: 200, inner: 0, hidden: false, done: false };
  const vh = 1000;
  const at = () => ({ top: top - page.scrollY, left, width, height, inner: page.inner });
  const exec = async (func, args) => {
    log.push([func.name, ...args]);
    if (func === partInfo) {
      return { url: 'https://eclass.krs.co.kr/x', title: '공지', vw: 1200, vh, scrollY: page.scrollY, top, width, height,
        edge: { top: 1, left: 1, w: width - 2, h: height - 2 }, frame: !!frame, box: box ? { scrollTop: 0, scrollHeight: box } : null, text };
    }
    if (func === partStep) {
      // rel 은 부분의 머리에서 내려간 만큼 — 창을 부분의 머리 + rel 로 내린다(페이지 끝에서 멈춘다).
      const [, rel, inner] = args;
      page.hidden = true;
      if (rel != null) page.scrollY = Math.max(0, Math.min(top + rel, pageHeight - vh));
      if (inner != null) page.inner = Math.min(inner, box - (height - 2));
      return at();
    }
    if (func === partDone) {
      Object.assign(page, { hidden: false, done: true, scrollY: 200, inner: 0 });
      return null;
    }
    throw new Error(`모르는 함수 ${func.name}`);
  };
  const flog = [];
  const fpage = { scrollY: 0 };
  const inFrame = frame && (async (func, args) => {
    flog.push([func.name, ...args]);
    if (func === pageInfo) return { url: 'https://eclass.krs.co.kr/frame', title: '본문', scrollHeight: frame, viewportHeight: height - 2, viewportWidth: width - 2, dpr: 1, scrollY: 0, text: '틀 안 글자' };
    if (func === pageStep) { fpage.scrollY = Math.min(args[0], frame - (height - 2)); return fpage.scrollY; }
    if (func === pageDone) { fpage.scrollY = args[0]; return null; }
    throw new Error(`모르는 함수 ${func.name}`);
  });
  const shoot = async () => `data:image/png;base64,${Buffer.from(`at-${page.scrollY}-${page.inner}-${fpage.scrollY}`).toString('base64')}`;
  return { exec, frame: inFrame || null, shoot, log, flog, page };
}
const keepJob = (into) => async (j) => { into.job = j; return j.shots.map(() => new Blob(['png'], { type: 'image/png' })); };
await ta('창 모드 — 부분의 머리로 창을 내리고 한 화면씩 찍어, 부분의 칸만 오려 잇는다. 끝에 창·숨긴 띠를 되돌린다', async () => {
  const p = fakePart();
  const out = {};
  const got = await capturePart({ part: { n: 1, title: '교육 안내' }, exec: p.exec, shoot: p.shoot, wait: async () => {}, stitch: keepJob(out), today: '2026-10-08', seq: 3 });
  // 높이 2500 / 창 1000 → 부분 안 0·1000·1500(창 1500·2500·3000)
  assert.deepEqual(p.log.map((l) => l.join(' ')), ['partInfo 1', 'partStep 1 0 ', 'partStep 1 1000 ', 'partStep 1 1500 ', 'partDone 1']);
  assert.deepEqual(out.job.shots.map((s) => [s.y, s.h, s.crop]), [
    [0, 1000, { x: 100, y: 0, w: 800, h: 1000 }], [1000, 1000, { x: 100, y: 0, w: 800, h: 1000 }], [1500, 1000, { x: 100, y: 0, w: 800, h: 1000 }],
  ]);
  assert.deepEqual([out.job.viewportWidth, out.job.width, out.job.totalHeight, out.job.tileHeight], [1200, 800, 2500, Math.round(800 * A4_RATIO)]);
  assert.deepEqual([p.page.done, p.page.hidden, p.page.scrollY], [true, false, 200]);
  assert.deepEqual(got.files.map((f) => f.name), ['화면캡처_eclass.krs.co.kr_2026-10-08_3.png', '화면캡처_eclass.krs.co.kr_2026-10-08_4.png', '화면캡처_eclass.krs.co.kr_2026-10-08_5.png']);
  assert.equal(got.text, '[웹페이지 글자 — 공지 — 교육 안내] https://eclass.krs.co.kr/x\n카드 글자');
  assert.deepEqual([got.title, got.host, got.part, got.cut], ['교육 안내', 'eclass.krs.co.kr', 1, false]);
});
await ta('창 모드 — 페이지 끝이라 부분의 머리까지 못 내려가면 창 안의 그 자리에서 오리고, 한 화면보다 짧으면 그 높이 한 장이다', async () => {
  const p = fakePart({ top: 4800, height: 400, pageHeight: 5200 });
  const out = {};
  await capturePart({ part: { n: 2 }, exec: p.exec, shoot: p.shoot, wait: async () => {}, stitch: keepJob(out) });
  // 창은 4200 까지만 내려간다 — 부분은 창 안 600 에서 1000 까지
  assert.deepEqual(out.job.shots.map((s) => [s.y, s.h, s.crop.y]), [[0, 400, 600]]);
  assert.equal(out.job.totalHeight, 400);
});
await ta('창 모드 — 창이 내려가지 않는 페이지(스크롤이 막힘)면 같은 자리를 또 찍지 않는다', async () => {
  const p = fakePart({ top: 300, height: 1400, pageHeight: 1000 });
  const out = {};
  await capturePart({ part: { n: 1 }, exec: p.exec, shoot: p.shoot, wait: async () => {}, stitch: keepJob(out) });
  assert.deepEqual(out.job.shots.map((s) => [s.y, s.h, s.crop.y]), [[0, 700, 300]]);
});
await ta('상자 모드 — 안이 따로 내려가는 상자는 창을 상자 머리에 두고 상자 안을 보이는 높이씩 내린다', async () => {
  const p = fakePart({ top: 300, height: 402, width: 602, box: 1500 });
  const out = {};
  await capturePart({ part: { n: 1 }, exec: p.exec, shoot: p.shoot, wait: async () => {}, stitch: keepJob(out) });
  // 보이는 칸 400(테두리 안쪽) — 상자 안 0·400·800·1100
  assert.deepEqual(p.log.map((l) => l.join(' ')), ['partInfo 1', 'partStep 1 0 ', 'partStep 1  0', 'partStep 1  400', 'partStep 1  800', 'partStep 1  1100', 'partDone 1']);
  assert.deepEqual(out.job.shots.map((s) => s.y), [0, 400, 800, 1100]);
  assert.deepEqual(out.job.shots[0].crop, { x: 101, y: 1, w: 600, h: 400 });
  assert.deepEqual([out.job.width, out.job.totalHeight], [600, 1500]);
});
await ta('틀 모드 — 틀 안이 따로 내려가면(eClass 본문 틀) 틀 안을 내리며 찍고, 글자는 틀 안의 것이다. 틀의 자리도 되돌린다', async () => {
  const p = fakePart({ top: 80, left: 0, height: 702, width: 1202, frame: 2000 });
  const out = {};
  const got = await capturePart({ part: { n: 1, title: 'content-iframe' }, exec: p.exec, frame: p.frame, shoot: p.shoot, wait: async () => {}, stitch: keepJob(out) });
  assert.deepEqual(p.flog.map((l) => l.join(' ')), ['pageInfo', 'pageStep 0 false', 'pageStep 700 true', 'pageStep 1300 true', 'pageDone 0']);
  assert.deepEqual(out.job.shots.map((s) => [s.y, s.h]), [[0, 700], [700, 700], [1300, 700]]);
  assert.deepEqual(out.job.shots[0].crop, { x: 1, y: 1, w: 1199, h: 700 }, '창 폭(1200) 밖은 뺀다');
  assert.match(got.text, /^\[웹페이지 글자 — 공지 — content-iframe\] https:\/\/eclass\.krs\.co\.kr\/frame\n틀 안 글자$/);
  assert.equal(p.page.done, true);
});
await ta('틀을 못 맞췄으면(frame 없음) 창 모드로 틀이 보이는 만큼 찍는다', async () => {
  const p = fakePart({ top: 80, height: 702, width: 1202, frame: 2000 });
  const out = {};
  await capturePart({ part: { n: 1 }, exec: p.exec, frame: null, shoot: p.shoot, wait: async () => {}, stitch: keepJob(out) });
  assert.equal(out.job.shots.length, 1);
  assert.equal(out.job.totalHeight, 702);
});
await ta('부분이 사라졌으면 까닭을 던진다 — 여러 부분이면 나머지는 찍고 장 번호를 잇는다', async () => {
  const gone = { exec: async (func) => (func === partInfo ? null : null) };
  await assert.rejects(capturePart({ part: { n: 1 }, exec: gone.exec, shoot: async () => '' }), /고른 부분을 찾지 못했습니다/);
  const p = fakePart({ height: 600 });
  const exec = async (func, args) => (args[0] === 9 ? null : p.exec(func, args));
  const out = {};
  const progress = [];
  const got = await captureParts({
    parts: [{ n: 1, title: '첫 칸' }, { n: 9, title: '사라진 칸' }, { n: 1, title: '다시 첫 칸' }], exec, shoot: p.shoot, wait: async () => {},
    stitch: keepJob(out), today: '2026-10-08', onProgress: (...a) => progress.push(a.join(' ')),
  });
  assert.deepEqual(got.pages.map((x) => x.files.map((f) => f.name.slice(-6))), [['_1.png'], ['_2.png']]);
  assert.deepEqual(got.failed, [{ title: '사라진 칸', why: '고른 부분을 찾지 못했습니다 — 페이지가 바뀌었으면 다시 고르세요.' }]);
  assert.deepEqual(progress, ['1 1 1 3', '1 1 3 3']);
  await assert.rejects(captureParts({ parts: [], exec }), /고르세요/);
});
t('고른 틀의 frameId — 지금 주소 → 이름 → src → 크기, 하나로 좁혀지는 것. 맨 위 문서 바로 아래의 틀만 본다', () => {
  const frames = [
    { frameId: 0, href: 'https://e/', child: false },
    { frameId: 3, href: 'https://e/content?id=1', name: 'content-iframe', w: 1200, h: 700, child: true },
    { frameId: 4, href: 'https://ads/', name: '', w: 300, h: 250, child: true },
    { frameId: 5, href: 'https://e/content?id=1', name: 'inner', w: 1200, h: 700, child: false },
  ];
  assert.equal(matchFrame(frames, { href: 'https://e/content?id=1', name: '', src: '', w: 0, h: 0 }), 3);
  assert.equal(matchFrame(frames, { href: null, name: 'content-iframe', src: 'https://e/old', w: 0, h: 0 }), 3, '다른 사이트의 틀은 이름으로');
  assert.equal(matchFrame(frames, { href: null, name: '', src: 'https://ads/', w: 0, h: 0 }), 4);
  assert.equal(matchFrame(frames, { href: null, name: '', src: '', w: 300, h: 250 }), 4);
  assert.equal(matchFrame(frames, { href: null, name: '', src: '', w: 10, h: 10 }), null);
  assert.equal(matchFrame([frames[0], frames[2]], { href: null, name: 'x', src: '', w: 0, h: 0 }), 4, '틀이 하나뿐이면 그것');
  assert.equal(matchFrame(frames, null), null);
});

console.log('전체가 팝업으로 가기 · 틀 안의 스크롤 칸 · 한 장씩 넘기는 미리보기 (가짜 새 Outlook — 창 1290×1422, 2026-10-15)');
const POP = { n: 'popup', kind: 'frame', label: '첨부 미리보기 창', title: '회의 자료.docx', cover: 0.89, frame: { href: null, src: 'about:blank', name: '', w: 1222, h: 1287 } };
/**
 * 가짜 새 Outlook 첨부 미리보기 — 맨 위 문서의 대화상자 안 틀(34,90 1222×1287 — 떠 있어 머리에 둬도 안 움직인다)과 그 틀 안.
 * docH 는 틀 문서 높이(pageInfo), look 은 scrollerInfo 가 줄 것, vp 는 틀 창의 크기, at 은 틀 안의 틀 자리다.
 */
function fakeViewer({ pop = POP, docH = 1287, look = null, vp = { w: 1222, h: 1287 }, at = null, url = 'https://word-view.officeapps.live.com/wv/x' } = {}) {
  const log = [];
  const flog = [];
  const wants = [];
  const st = { scroll: 0, marked: true };
  const exec = async (func, args = []) => {
    log.push([func.name, ...args].join(' '));
    if (func === modalProbe) return pop;
    if (func === partInfo) {
      return { url: 'https://outlook.cloud.microsoft/mail/inbox/id/x', title: '메일 - Outlook', vw: 1290, vh: 1422, scrollY: 0, top: 90, width: 1222, height: 1287,
        edge: { top: 0, left: 0, w: 1222, h: 1287 }, frame: true, box: null, text: '' };
    }
    if (func === partStep) return { top: 90, left: 34, width: 1222, height: 1287, inner: 0, clip: { top: 0, left: 0, bottom: 1422, right: 1290 } };
    if (func === partDone) { st.marked = false; return null; }
    if (func === pageInfo) return { url: 'https://outlook.cloud.microsoft/mail/', title: '메일 - Outlook', scrollHeight: 1422, viewportHeight: 1422, viewportWidth: 1290, dpr: 1, scrollY: 0, text: '받은 편지함' };
    if (func === pageStep) return 0;
    if (func === pageDone) return null;
    throw new Error(`모르는 함수 ${func.name}`);
  };
  const frame = async (func, args = []) => {
    flog.push([func.name, ...args].join(' '));
    if (func === pageInfo) return { url, title: '', scrollHeight: docH, viewportHeight: vp.h, viewportWidth: vp.w, dpr: 1, scrollY: 0, text: '문서 글자' };
    if (func === scrollerInfo) return look;
    if (func === scrollerStep) { st.scroll = Math.min(args[0], look.box.scrollHeight - look.box.clientHeight); return st.scroll; }
    if (func === scrollerDone) { st.scroll = 0; return null; }
    if (func === pageStep) { st.scroll = Math.min(args[0], docH - vp.h); return st.scroll; }
    if (func === pageDone) return null;
    throw new Error(`틀 안에서 모르는 함수 ${func.name}`);
  };
  if (at) frame.at = at;
  const shoot = async () => `data:image/png;base64,${Buffer.from(`s-${st.scroll}`).toString('base64')}`;
  return { exec, frame, frameOf: async (want) => { wants.push(want); return frame; }, shoot, log, flog, st, wants };
}
const WORD_LOOK = { doc: null, box: { x: 0, y: 40, w: 1222, h: 1200, scrollTop: 0, scrollHeight: 4000, clientHeight: 1200 }, paged: false };
await ta('전체 — 첨부 미리보기(틀)가 떠 있으면 그 틀을 맞춰 틀 안의 본문 칸(Word 보기)을 내리며 그 칸만 오려 잇는다. 끝에 칸·표시를 되돌린다', async () => {
  const v = fakeViewer({ look: WORD_LOOK });
  const out = {};
  const targets = [];
  const got = await captureWhole({ tab: { url: 'https://outlook.cloud.microsoft/mail/' }, exec: v.exec, frameOf: v.frameOf, shoot: v.shoot, wait: async () => {},
    stitch: keepJob(out), today: '2026-10-15', onTarget: (x) => targets.push(x) });
  assert.deepEqual(targets, [{ where: '첨부 미리보기 창「회의 자료.docx」', popup: '첨부 미리보기 창', title: '회의 자료.docx' }]);
  assert.deepEqual(v.wants, [POP.frame], '팝업의 틀을 맞춘다');
  assert.deepEqual(v.flog, ['pageInfo', 'scrollerInfo', 'scrollerStep 0', 'scrollerStep 1200', 'scrollerStep 2400', 'scrollerStep 2800', 'scrollerDone', 'pageDone 0']);
  assert.deepEqual(v.log, ['modalProbe', 'partInfo popup', 'partStep popup 0 ', 'partDone popup', 'partDone popup']);
  assert.deepEqual(out.job.shots.map((s) => [s.y, s.h]), [[0, 1200], [1200, 1200], [2400, 1200], [2800, 1200]]);
  assert.deepEqual(out.job.shots[0].crop, { x: 34, y: 130, w: 1222, h: 1200 }, '틀(34,90) 안의 칸(0,40)');
  assert.deepEqual([out.job.width, out.job.totalHeight], [1222, 4000]);
  assert.deepEqual([v.st.scroll, v.st.marked], [0, false]);
  assert.deepEqual([got.popup, got.where, got.title, got.paged, 'part' in got, got.host], ['첨부 미리보기 창', '첨부 미리보기 창「회의 자료.docx」', '회의 자료.docx', false, false, 'outlook.cloud.microsoft']);
  assert.match(got.text, /^\[웹페이지 글자 — 메일 - Outlook — 회의 자료\.docx\] https:\/\/word-view\.officeapps\.live\.com\/wv\/x\n문서 글자$/);
  assert.equal(got.files[0].name, '화면캡처_outlook.cloud.microsoft_2026-10-15_1.png');
});
await ta('전체 — PowerPoint 읽기 보기처럼 틀 안이 안 내려가고 한 장씩 넘기면 넘기지 않고 보이는 장 하나만 찍고 paged 로 알린다', async () => {
  // pageInfo 는 body 의 넘친 18px 까지 보아 1305 라 하지만, 정말 내려가는지는 scrollerInfo 가 가린다.
  const v = fakeViewer({ pop: { ...POP, title: '회의 자료.pptx' }, docH: 1305, look: { doc: null, box: null, paged: true }, url: 'https://krc-powerpoint.officeapps.live.com/p/PowerPointFrame.aspx' });
  const out = {};
  const got = await captureWhole({ tab: { url: 'https://outlook.cloud.microsoft/mail/' }, exec: v.exec, frameOf: v.frameOf, shoot: v.shoot, wait: async () => {}, stitch: keepJob(out) });
  assert.deepEqual(v.flog, ['pageInfo', 'scrollerInfo', 'pageDone 0'], '슬라이드를 넘기지 않는다');
  assert.deepEqual(out.job.shots.map((s) => [s.y, s.h, s.crop]), [[0, 1287, { x: 34, y: 90, w: 1222, h: 1287 }]]);
  assert.equal(out.job.totalHeight, 1287);
  assert.deepEqual([got.paged, got.where], [true, '첨부 미리보기 창「회의 자료.pptx」']);
});
await ta('틀 문서가 조금만 넘쳐도 정말 내려가면(scrollerInfo 의 doc) 틀 문서를 내린다 — 같은 자리는 또 찍지 않는다', async () => {
  const v = fakeViewer({ docH: 1330, look: { doc: { scrollHeight: 1330, clientHeight: 1287 }, box: null, paged: false } });
  const out = {};
  await capturePart({ part: { n: 'popup' }, exec: v.exec, frame: v.frame, shoot: v.shoot, wait: async () => {}, stitch: keepJob(out) });
  assert.deepEqual(v.flog, ['pageInfo', 'scrollerInfo', 'pageStep 0 false', 'pageStep 43 true', 'pageDone 0']);
  assert.deepEqual(out.job.shots.map((s) => s.y), [0, 43]);
  const stuck = fakeViewer({ docH: 3000 });
  const frame = async (func, args) => (func === pageStep ? 0 : stuck.frame(func, args));   // 내려가지 않는 틀
  const out2 = {};
  await capturePart({ part: { n: 'popup' }, exec: stuck.exec, frame, shoot: stuck.shoot, wait: async () => {}, stitch: keepJob(out2) });
  assert.deepEqual([out2.job.shots.length, out2.job.totalHeight], [1, 1287], '한 장만, 찍은 데까지');
});
await ta('틀 안의 틀(frame.at) — 바깥 틀의 안쪽에서 그 틀이 놓인 자리만큼 비켜, 그 틀의 창 높이씩 내리며 오린다', async () => {
  const v = fakeViewer({ docH: 3000, vp: { w: 1222, h: 1242 }, at: { x: 0, y: 45 } });
  const out = {};
  await capturePart({ part: { n: 'popup' }, exec: v.exec, frame: v.frame, shoot: v.shoot, wait: async () => {}, stitch: keepJob(out) });
  assert.deepEqual(v.flog, ['pageInfo', 'pageStep 0 false', 'pageStep 1242 true', 'pageStep 1758 true', 'pageDone 0']);
  assert.deepEqual(out.job.shots[0].crop, { x: 34, y: 135, w: 1222, h: 1242 });
  assert.equal(out.job.totalHeight, 3000);
});
await ta('전체 — 팝업이 없으면(못 봐도) capturePage 그대로, 팝업 창의 탭이면 where·fromPopup 이 붙는다', async () => {
  const v = fakeViewer({ pop: null });
  const got = await captureWhole({ tab: { url: 'https://outlook.cloud.microsoft/mail/' }, exec: v.exec, frameOf: v.frameOf, shoot: v.shoot, wait: async () => {}, stitch: stitchAll });
  assert.deepEqual(v.log, ['modalProbe', 'pageInfo', 'pageStep 0 false', 'pageDone 0']);
  assert.deepEqual([got.popup, got.where, got.shots], [undefined, undefined, 1]);
  const tab = fakeTab();
  const win = await captureWhole({ tab: { url: 'https://a.b/', popup: true, where: '팝업 창「미리보기」' }, exec: tab.exec, shoot: tab.shoot, wait: async () => {}, stitch: stitchAll });
  assert.deepEqual(tab.log[0], ['modalProbe'], '못 본 것(모르는 함수)은 팝업이 없는 것');
  assert.deepEqual([win.where, win.fromPopup, win.popup], ['팝업 창「미리보기」', true, undefined]);
  await assert.rejects(captureWhole({ tab: { url: 'chrome://extensions' }, exec: tab.exec, shoot: tab.shoot }), /캡처할 수 없습니다/);
});
await ta('전체 — 틀이 아닌 팝업은 팝업의 스크롤 칸을 내린다(상자 모드), 이름은 "팝업「제목」"', async () => {
  const p = fakePart({ top: 300, height: 402, width: 602, box: 1500 });
  const exec = async (func, args) => (func === modalProbe ? { n: 'popup', kind: 'box', label: '팝업', title: '공지 사항', frame: null } : p.exec(func, args));
  const out = {};
  let asked = 0;
  const got = await captureWhole({ tab: { url: 'https://eclass.krs.co.kr/' }, exec, frameOf: async () => { asked++; return null; }, shoot: p.shoot, wait: async () => {}, stitch: keepJob(out) });
  assert.deepEqual(out.job.shots.map((s) => s.y), [0, 400, 800, 1100]);
  assert.deepEqual([got.popup, got.where, asked], ['팝업', '팝업「공지 사항」', 0]);
});

console.log('틀 맞추기 — about:blank 틀·틀 안의 틀 (2026-10-15)');
const VIEW_FRAMES = [
  { frameId: 0, href: 'https://outlook.cloud.microsoft/mail/', w: 1290, h: 1422, child: false, depth: 0, scrolls: false },
  { frameId: 7, href: 'https://word-view.officeapps.live.com/wv/shell', name: '', w: 1222, h: 1287, child: true, depth: 1, scrolls: false },
  { frameId: 8, href: 'about:blank', name: '', w: 300, h: 150, child: true, depth: 1, scrolls: false },
  { frameId: 9, href: 'https://word-view.officeapps.live.com/wv/doc', name: '', w: 1222, h: 1242, child: false, depth: 2, scrolls: true },
  { frameId: 10, href: 'https://oauth.officeapps.live.com/oa', name: '', w: 0, h: 0, child: false, depth: 2, scrolls: false },
];
t('src 가 about:blank 인 틀은 주소로 견주지 않고 크기로 맞춘다 — 다른 about:blank 틀을 잘못 고르지 않는다', () => {
  assert.equal(matchFrame(VIEW_FRAMES, POP.frame), 7);
  assert.equal(matchFrame(VIEW_FRAMES, { href: 'about:blank', src: '', name: '', w: 300, h: 150 }), 8, '같은 사이트의 빈 틀이면 크기로');
  assert.equal(matchFrame([...VIEW_FRAMES, { frameId: 11, href: 'x', name: 'v', w: 1222, h: 1287, depth: 1 }], { href: null, src: '', name: 'v', w: 1222, h: 1287 }), 11, 'depth 1 도 맨 위 바로 아래');
});
t('맞춘 틀이 안 내려가고 그 틀을 90% 이상 채우는 더 깊은 틀이 내려가면 그 틀이 deep — 아니면 없다', () => {
  assert.deepEqual(frameTarget(VIEW_FRAMES, POP.frame), { id: 7, deep: { id: 9, w: 1222, h: 1242 } });
  assert.deepEqual(frameTarget(VIEW_FRAMES.map((f) => (f.frameId === 7 ? { ...f, scrolls: true } : f)), POP.frame), { id: 7, deep: null }, '바깥이 내려가면 바깥');
  assert.deepEqual(frameTarget(VIEW_FRAMES.map((f) => (f.frameId === 9 ? { ...f, h: 900 } : f)), POP.frame), { id: 7, deep: null }, '덜 채우면 아니다');
  assert.deepEqual(frameTarget(VIEW_FRAMES.map((f) => (f.frameId === 9 ? { ...f, scrolls: false } : f)), POP.frame), { id: 7, deep: null });
  assert.deepEqual(frameTarget([VIEW_FRAMES[0], { frameId: 5, href: 'https://e/x', name: 'content-iframe', w: 1200, h: 700, child: true }], { href: 'https://e/x' }), { id: 5, deep: null }, 'depth 를 모르는 예전 결과');
  assert.equal(frameTarget(VIEW_FRAMES, { href: null, src: '', name: '', w: 10, h: 10 }), null);
});
await ta('frameFinder — 모든 틀에 frameProbe, 깊은 틀이면 바깥 틀의 frameKids 로 자리를 맞춰 at 을 단 그 틀의 손잡이를 준다', async () => {
  const ran = [];
  const scripting = {
    executeScript: async ({ target, func }) => {
      ran.push(`${target.allFrames ? 'all' : target.frameIds?.[0] ?? 'top'} ${func.name}`);
      if (target.allFrames) return VIEW_FRAMES.map(({ frameId, ...result }) => ({ frameId, result }));
      if (func === frameKids) return [{ result: [{ x: 0, y: 45, w: 1222, h: 1242 }, { x: 0, y: 0, w: 0, h: 0 }] }];
      return [{ result: `ran ${func.name}` }];
    },
  };
  const find = frameFinder({ tabId: 41, scripting });
  const fn = await find(POP.frame);
  assert.deepEqual(fn.at, { x: 0, y: 45 });
  assert.equal(await fn(pageInfo), 'ran pageInfo');
  assert.deepEqual(ran, ['all frameProbe', '7 frameKids', '9 pageInfo']);
  assert.equal(await find({ href: null, src: '', name: '', w: 10, h: 10 }), null);
});

console.log('방금 보던 팝업 창 (가짜 chrome.windows — 2026-10-15)');
t(`패널 창이 앞을 내준 뒤 섰던 창 — 그 창에서 넘어온 지 ${POPUP_RECENT_MS / 1000}초 안인 것만, 최근 것부터. 패널 창에서 탭을 바꿨으면 없다`, () => {
  const P = 1;
  assert.deepEqual(popupCandidates([{ id: P, at: 0 }, { id: 5, at: 1000 }, { id: P, at: 50000 }], P, 55000), [5]);
  assert.deepEqual(popupCandidates([{ id: P, at: 0 }, { id: 5, at: 1000 }, { id: P, at: 50000 }], P, 50000 + POPUP_RECENT_MS + 1), [], '오래 전');
  assert.deepEqual(popupCandidates([{ id: P, at: 0 }, { id: 5, at: 1000 }, { id: P, at: 50000 }, { id: P, at: 51000, tab: true }], P, 52000), [], '패널 창에서 탭을 바꿨다');
  assert.deepEqual(popupCandidates([{ id: P, at: 0 }, { id: 5, at: 1000 }, { id: -1, at: 2000 }, { id: P, at: 3000 }], P, 4000), [5], '크롬 밖에 다녀와도');
  assert.deepEqual(popupCandidates([{ id: P, at: 0 }, { id: 5, at: 1000 }], P, 1500), [5], '패널의 앞 서기가 아직 안 왔다(누름이 먼저)');
  assert.deepEqual(popupCandidates([{ id: P, at: 0 }, { id: 5, at: 1000 }, { id: 6, at: 2000 }, { id: 5, at: 2500 }, { id: P, at: 3000 }], P, 4000), [5, 6]);
  assert.deepEqual(popupCandidates([{ id: 5, at: 0 }, { id: P, at: 1000 }, { id: P, at: 2000 }], P, 2500), [5], '패널 창이 두 번 서도');
  assert.deepEqual(popupCandidates([], P, 1), []);
});
/** 가짜 chrome — 패널 창 1(앞 탭은 Outlook), 팝업 창 5(첨부 미리보기 창), 보통 창 6. */
function fakeChrome({ popupType = 'popup', popupUrl = 'https://view.officeapps.live.com/op/view.aspx?src=x', state = 'normal', exec = null } = {}) {
  const calls = { focus: [], shots: [], ran: [], active: [], listeners: {} };
  const wins = {
    5: { id: 5, type: popupType, state, tabs: [{ id: 51, active: true, url: popupUrl, title: '회의 자료.pdf' }] },
    6: { id: 6, type: 'normal', state: 'normal', tabs: [{ id: 61, active: true, url: 'https://a.b/', title: '다른 창' }] },
  };
  const api = {
    windows: {
      getCurrent: async () => ({ id: 1 }),
      get: async (id) => { if (!wins[id]) throw new Error(`No window with id: ${id}.`); return wins[id]; },
      update: async (id, props) => { calls.focus.push([id, props.focused]); return { id }; },
      onFocusChanged: { addListener: (fn) => { calls.listeners.focus = fn; } },
    },
    tabs: {
      query: async ({ windowId }) => (windowId === 1 ? [{ id: 11, url: 'https://outlook.cloud.microsoft/mail/', title: '메일 - Outlook', active: true }] : wins[windowId]?.tabs || []),
      update: async (id) => { calls.active.push(id); return { id }; },
      get: async (id) => ({ id, active: true, status: 'complete' }),
      captureVisibleTab: async (windowId) => { calls.shots.push(windowId); return `data:image/png;base64,${Buffer.from('x').toString('base64')}`; },
      onActivated: { addListener: (fn) => { calls.listeners.tab = fn; } },
    },
    scripting: {
      executeScript: async ({ target, func, args = [] }) => {
        calls.ran.push(`${target.tabId} ${func.name}`);
        const r = exec ? await exec(func, args, target) : undefined;
        if (r !== undefined) return [{ result: r }];
        if (func === pageInfo) return [{ result: { url: popupUrl, title: '회의 자료.pdf', scrollHeight: 900, viewportHeight: 900, viewportWidth: 800, dpr: 1, scrollY: 0, text: '문서 글자' } }];
        if (func === pageStep) return [{ result: 0 }];
        return [{ result: null }];
      },
    },
  };
  return { api, calls };
}
await ta('frontTab — 방금 보던 팝업 창이 열려 있고 웹페이지면 그 창의 탭(popup·where·home), 아니면 패널 창의 앞 탭', async () => {
  const log = [{ id: 1, at: 0 }, { id: 5, at: 1000 }, { id: 1, at: 2000 }];
  const { api } = fakeChrome();
  assert.deepEqual(await frontTab({ api, log, now: 3000 }), {
    id: 51, url: 'https://view.officeapps.live.com/op/view.aspx?src=x', title: '회의 자료.pdf', host: 'view.officeapps.live.com', active: true,
    windowId: 5, popup: true, where: '팝업 창「회의 자료.pdf」', home: 1,
  });
  const panel = { id: 11, url: 'https://outlook.cloud.microsoft/mail/', title: '메일 - Outlook', host: 'outlook.cloud.microsoft', active: true, windowId: 1 };
  assert.deepEqual(await frontTab({ api, log, now: 2000 + POPUP_RECENT_MS + 1 }), panel, '오래 전');
  assert.deepEqual(await frontTab({ api: fakeChrome({ popupType: 'normal' }).api, log, now: 3000 }), panel, '보통 창은 아니다');
  assert.deepEqual(await frontTab({ api: fakeChrome({ state: 'minimized' }).api, log, now: 3000 }), panel, '내려 둔 창');
  assert.deepEqual(await frontTab({ api: fakeChrome({ popupUrl: 'chrome-extension://x/viewer.html' }).api, log, now: 3000 }), panel, '찍을 수 없는 화면');
  assert.deepEqual(await frontTab({ api, log: [{ id: 1, at: 0 }, { id: 9, at: 1000 }, { id: 1, at: 2000 }], now: 3000 }), panel, '닫힌 창');
  const { windows: { get, ...noGet }, ...rest } = api;
  assert.deepEqual(await frontTab({ api: { ...rest, windows: noGet }, log, now: 3000 }), panel, 'windows.get 이 없으면');
});
t('watchWindows — 창이 앞에 서는 것과 탭 바꿈을 적고(한 번만 건다), chrome.windows 가 없으면 아무것도 하지 않는다', () => {
  const { api, calls } = fakeChrome();
  let clock = 100;
  const into = { on: false, log: [] };
  assert.equal(watchWindows({ api, now: () => clock, into }), into);
  calls.listeners.focus(5);
  clock = 200;
  calls.listeners.tab({ tabId: 11, windowId: 1 });
  calls.listeners.focus(-1);
  calls.listeners.focus(undefined);
  assert.deepEqual(into.log, [{ id: 5, at: 100 }, { id: 1, at: 200, tab: true }, { id: -1, at: 200 }]);
  const before = calls.listeners.focus;
  watchWindows({ api: fakeChrome().api, into });
  assert.equal(calls.listeners.focus, before, '두 번째는 걸지 않는다');
  const none = { on: false, log: [] };
  assert.deepEqual(watchWindows({ api: { tabs: {} }, into: none }), { on: false, log: [] });
  assert.deepEqual(watchWindows({ api: undefined, into: none }).on, false);
});
await ta('captureFront — 방금 보던 팝업 창을 앞에 두고 그 창을 찍은 뒤 패널 창을 다시 앞에 둔다. plain 은 팝업이 없을 때만 먼저 불러 본다', async () => {
  let popupOpen = false;
  const { api, calls } = fakeChrome({ exec: async (func) => (func === modalProbe ? (popupOpen ? { n: 'popup', kind: 'plain', label: '팝업', title: '안내', frame: null } : null) : undefined) });
  const kept = globalThis.chrome;
  globalThis.chrome = api;
  try {
    watchWindows();   // 패널(webpick.js)이 하는 것 — 이 모듈의 기록에 건다
    calls.listeners.focus(5);
    calls.listeners.focus(1);
    const targets = [];
    const plained = [];
    const got = await captureFront({ wait: async () => {}, stitch: stitchAll, onTarget: (x) => targets.push(x.where), plain: async (tab) => { plained.push(tab.id); return null; } });
    assert.deepEqual(targets, ['팝업 창「회의 자료.pdf」']);
    assert.deepEqual(plained, [51]);
    assert.deepEqual(calls.shots, [5], '팝업 창을 찍는다');
    assert.deepEqual(calls.focus, [[5, true], [1, true]], '팝업 창을 앞에 두고, 끝나면 패널 창');
    assert.deepEqual([got.pages[0].where, got.pages[0].fromPopup, got.pages[0].host], ['팝업 창「회의 자료.pdf」', true, 'view.officeapps.live.com']);
    assert.deepEqual(calls.ran, ['51 modalProbe', '51 modalProbe', '51 pageInfo', '51 pageStep', '51 pageDone']);
    const alt = { pages: [], failed: [], files: ['x'] };
    assert.equal(await captureFront({ plain: async () => alt }), alt, 'plain 이 준 것을 그대로');
    calls.ran.length = 0;
    popupOpen = true;
    plained.length = 0;
    await captureFront({ wait: async () => {}, stitch: stitchAll, plain: async (tab) => { plained.push(tab.id); return alt; } }).catch(() => {});
    assert.deepEqual([plained, calls.ran.slice(0, 2)], [[], ['51 modalProbe', '51 partDone']], '팝업이 떠 있으면 plain 은 부르지 않고 표시를 뗀다');
  } finally {
    globalThis.chrome = kept;
  }
});

console.log('캡처 단추(webpick.js) — 팝업·메일을 아는 전체·부분 (가짜 mail, 2026-10-15)');
const { createWebPick, pickButton, PAGED_NOTE } = await import('../webpick.js');
{
  const tile = (n) => new File([Buffer.from('png')], `t${n}.png`, { type: 'image/png' });
  const page = (over = {}) => ({ files: [tile(1)], text: '글', title: '칸', host: 'outlook.cloud.microsoft', shots: 1, tiles: 1, cut: false, ...over });
  const TAB = { id: 11, windowId: 1, url: 'https://outlook.cloud.microsoft/mail/inbox/id/x', title: '메일 - Outlook' };
  /** 가짜 메일 읽기 — 부른 것을 적는다. */
  // probe 는 src/mailgrab.js 의 probeTab 꼴 — part 는 메일 칸(data-krs-cap="mail")이고, eClass 포털이면 frame 이 있다.
  const fakeMail = ({ probe = { site: 'outlook', subject: '11월 교육 안내', attachments: [{ key: 'a1', name: '안내문.pdf', size: 1000 }, { key: 'a2', name: '신청서.hwp', size: 500 }], part: { n: 'mail', tag: 'div', title: '11월 교육 안내', frame: null } }, grab = null, fetched = null } = {}) => {
    const calls = [];
    return {
      calls,
      probeTab: async (tab) => { calls.push(['probe', tab.id]); return probe; },
      grabTab: async (tab, opts) => {
        calls.push(['grab', tab.id, opts.today]);
        opts.onStatus('첨부 파일 1/2 — 안내문.pdf');
        return grab || { mail: { subject: '11월 교육 안내' }, text: '[메일 — 11월 교육 안내]\n본문 글', files: [new File(['%PDF'], '안내문.pdf'), new File(['hwp'], '신청서.hwp')],
          failed: [{ name: '큰파일.zip', why: '30MB 를 넘습니다' }], notes: ['첨부 2개를 원본 그대로 가져왔습니다'], what: '메일 첨부 2개' };
      },
      fetchTab: async (tab, keys) => { calls.push(['fetch', tab.id, keys]); return fetched || { files: keys.map((k) => new File(['x'], `${k}.pdf`)), failed: [] }; },
    };
  };
  t('단추는 둘(전체·부분) — 메일 단추는 없고, 풀이 글에 메일·첨부·팝업을 적는다', () => {
    const { window } = new JSDOM('<div id="b"></div>');
    const box = window.document.getElementById('b');
    box.innerHTML = pickButton({ mail: true });
    const btns = [...box.querySelectorAll('button')];
    assert.deepEqual(btns.map((b) => b.dataset.pick), ['tab', 'part']);
    assert.match(btns[0].title, /^전체 캡처 — .*메일이면 본문과 첨부 파일을 함께 가져오고.*팝업/);
    assert.match(btns[1].title, /메일의 첨부 파일을 누르면 그 파일만 가져옵니다/);
  });
  await ta('전체 — 첨부 미리보기 창을 찍으면 진행 글에 그 창을 적고, notes 에 그 창만 찍었다는 말과 한 장씩 넘기는 화면의 알림', async () => {
    let watched = 0;
    const said = [];
    const pick = createWebPick({
      watch: () => { watched++; }, mail: null,
      front: async ({ onTarget, onProgress }) => {
        onTarget({ where: '첨부 미리보기 창「회의 자료.pptx」' });
        onProgress(1, 1);
        return { pages: [page({ title: '회의 자료.pptx', paged: true, popup: '첨부 미리보기 창', where: '첨부 미리보기 창「회의 자료.pptx」' })], failed: [] };
      },
    });
    const got = await pick.shoot('tab', { onStatus: (s) => said.push(s) });
    assert.equal(watched, 1, '창 지켜보기는 만들 때 한 번');
    assert.deepEqual(said, ['보고 있는 탭을 캡처하는 중입니다…', '첨부 미리보기 창「회의 자료.pptx」 — 캡처하는 중입니다…', '첨부 미리보기 창「회의 자료.pptx」 — 캡처하는 중입니다… 1/1']);
    assert.deepEqual(got.notes, ['열린 첨부 미리보기 창「회의 자료.pptx」만 캡처했습니다 — 뒤의 페이지를 찍으려면 그 창을 닫고 다시 누르세요', PAGED_NOTE]);
    assert.equal(got.what, '첨부 미리보기 창 outlook.cloud.microsoft 화면 1개 → 1장');
    assert.ok(!('files' in got) && !('text' in got), '메일이 아니면 예전 모양 그대로');
    const win = await createWebPick({ watch: () => {}, mail: null, front: async () => ({ pages: [page({ where: '팝업 창「미리보기」', fromPopup: true })], failed: [] }) }).shoot('tab');
    assert.deepEqual([win.notes, win.what], [['팝업 창「미리보기」에서 캡처했습니다'], '팝업 창 outlook.cloud.microsoft 화면 1개 → 1장']);
  });
  await ta('전체 — 메일이면(probeTab) 본문 화면(data-krs-cap="mail")을 찍고 본문 글자·첨부 원본을 가져와 files·text 로 준다. 끝에 표시를 뗀다', async () => {
    const mail = fakeMail();
    const said = [];
    const unmarked = [];
    let asked = null;
    const pick = createWebPick({
      watch: () => {}, mail, unmark: async (tab) => { unmarked.push(tab.id); },
      front: async ({ plain }) => (await plain(TAB)) || { pages: [], failed: [] },
      parts: async (tab, chosen, opts) => { asked = [tab.id, chosen]; opts.onProgress(1, 2, 1, 1); return { pages: [page({ title: '11월 교육 안내', part: 'mail' })], failed: [] }; },
    });
    const got = await pick.shoot('tab', { today: '2026-10-15', onStatus: (s) => said.push(s) });
    assert.deepEqual(asked, [11, [{ n: 'mail', tag: 'div', title: '11월 교육 안내', frame: null }]]);
    assert.deepEqual(mail.calls, [['probe', 11], ['grab', 11, '2026-10-15']]);
    assert.deepEqual(unmarked, [11]);
    assert.deepEqual(got.files.map((f) => f.name), ['안내문.pdf', '신청서.hwp']);
    assert.equal(got.text, '[메일 — 11월 교육 안내]\n본문 글');
    assert.equal(got.pages.length, 1);
    assert.deepEqual(got.mail, { subject: '11월 교육 안내' });
    assert.ok(said.includes('메일「11월 교육 안내」 — 캡처하는 중입니다… 1/2'));
    assert.ok(said.includes('메일 본문과 첨부 파일 2개를 가져오는 중입니다…'));
    assert.equal(said.at(-1), '첨부 파일 1/2 — 안내문.pdf', '메일 읽기의 진행 글도 그대로');
    assert.deepEqual(got.notes, ['첨부 2개를 원본 그대로 가져왔습니다', '가져오지 못한 첨부 파일 — 큰파일.zip: 30MB 를 넘습니다']);
    assert.deepEqual(got.failed, [{ title: '큰파일.zip', why: '30MB 를 넘습니다', file: true }]);
    assert.equal(got.what, '부분 mail outlook.cloud.microsoft 화면 1개 → 1장 · 메일 첨부 2개 · 못 가져옴 1개');
  });
  await ta('전체 — 메일인데 본문 표시가 없으면 본문 화면은 건너뛰고 글자·첨부만, 메일이 아니거나 메일 읽기가 없으면 통째로 찍는다', async () => {
    const mail = fakeMail();
    const lost = createWebPick({
      watch: () => {}, mail, unmark: async () => {},
      front: async ({ plain }) => plain(TAB),
      parts: async () => { throw new Error('고른 부분을 찾지 못했습니다 — 페이지가 바뀌었으면 다시 고르세요.'); },
    });
    const got = await lost.shoot('tab');
    assert.deepEqual([got.pages.length, got.files.length, got.notes.some((n) => /찍지 못한/.test(n))], [0, 2, false]);
    for (const m of [fakeMail({ probe: null }), () => Promise.reject(new Error('Cannot find module mailgrab.js')), { grabTab: async () => ({}) }]) {
      const unmarked = [];
      const pick = createWebPick({
        watch: () => {}, mail: m, unmark: async (tab) => { unmarked.push(tab.id); },
        front: async ({ plain }) => (await plain(TAB)) || { pages: [page()], failed: [] },
      });
      const whole = await pick.shoot('tab');
      assert.deepEqual([whole.what, 'files' in whole, unmarked], ['outlook.cloud.microsoft 화면 1개 → 1장', false, []]);
    }
  });
  await ta('부분 — 막을 씌우기 전에 첨부 칸에 표시를 달게 하고(before), 고른 첨부 칸은 그 파일을 가져오고(fetchTab) 나머지는 찍는다', async () => {
    const mail = fakeMail();
    const said = [];
    const unmarked = [];
    let resolvePick;
    let partsAsked = null;
    const tab = { ...TAB };
    const pick = createWebPick({
      watch: () => {}, mail, unmark: async (x) => { unmarked.push(x.id); },
      start: async ({ before } = {}) => { await before(tab); return { tab, done: new Promise((r) => { resolvePick = r; }), cancel: () => resolvePick(null) }; },
      parts: async (x, chosen) => { partsAsked = chosen; return { pages: [page({ part: 1 })], failed: [] }; },
    });
    const run = pick.shoot('part', { key: 'g', onStatus: (s) => said.push(s) });
    await new Promise((r) => setTimeout(r, 0));
    assert.match(said.at(-1), /캡처할 부분\(프레임\)을 누르세요 .* 첨부 파일을 누르면 그 파일만 가져옵니다\.$/);
    resolvePick([{ n: 1, tag: 'table', title: '일정표', frame: null }, { n: 2, tag: 'div', title: '안내문.pdf', frame: null, attach: 'a1' }]);
    const got = await run;
    assert.deepEqual(partsAsked, [{ n: 1, tag: 'table', title: '일정표', frame: null }]);
    assert.deepEqual(mail.calls, [['probe', 11], ['fetch', 11, ['a1']]]);
    assert.deepEqual([got.pages.length, got.files.map((f) => f.name), unmarked], [1, ['a1.pdf'], [11]]);
    assert.equal(got.what, '부분 1 outlook.cloud.microsoft 화면 1개 → 1장 · 첨부 파일 1개');
    assert.ok(said.includes('고른 첨부 파일 1개를 가져오는 중입니다…'));
  });
  await ta('부분 — 첨부 칸만 고르면 찍지 않고 가져오기만, 못 가져오면 까닭을 던진다. 그만둬도 표시를 뗀다. 팝업 창이면 그 창에서 고르라고 한다', async () => {
    const mk = (mail, tab = TAB) => {
      const unmarked = [];
      let resolvePick;
      let partsCalled = 0;
      const pick = createWebPick({
        watch: () => {}, mail, unmark: async (x) => { unmarked.push(x.id); },
        start: async ({ before } = {}) => { await before?.(tab); return { tab, done: new Promise((r) => { resolvePick = r; }), cancel: () => resolvePick(null) }; },
        parts: async () => { partsCalled++; return { pages: [], failed: [] }; },
      });
      return { pick, unmarked, choose: (c) => resolvePick(c), parts: () => partsCalled };
    };
    const a = mk(fakeMail({ fetched: { files: [], failed: [{ name: '신청서.hwp', why: '받지 못했습니다' }] } }));
    const run = a.pick.shoot('part', { key: 'g' });
    await new Promise((r) => setTimeout(r, 0));
    a.choose([{ n: 1, tag: 'div', title: '신청서.hwp', frame: null, attach: 'a2' }]);
    await assert.rejects(run, /첨부 파일을 가져오지 못했습니다 — 신청서\.hwp: 받지 못했습니다/);
    assert.deepEqual([a.parts(), a.unmarked], [0, [11]]);
    const b = mk(fakeMail());
    const said = [];
    const run2 = b.pick.shoot('part', { key: 'g', onStatus: (s) => said.push(s) });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(await b.pick.shoot('part', { key: 'g' }), null, '같은 단추를 다시 누르면 그만둔다');
    assert.equal(await run2, null);
    assert.deepEqual(b.unmarked, [11]);
    const c = mk(null, { ...TAB, popup: true, where: '팝업 창「미리보기」' });
    const said3 = [];
    const run3 = c.pick.shoot('part', { key: 'g', onStatus: (s) => said3.push(s) });
    await new Promise((r) => setTimeout(r, 0));
    assert.match(said3.at(-1), /^팝업 창「미리보기」에서 캡처할 부분\(프레임\)을 누르세요/);
    c.choose(null);
    assert.equal(await run3, null);
    assert.deepEqual(c.unmarked, [], '메일 읽기가 없으면 뗄 것도 없다');
  });
}

console.log('잇고 자르기 (가짜 캔버스)');
{
  // 가짜 캔버스 — 그린 것(어느 화면을 어느 자리에)과 만든 장의 크기를 적어 둔다.
  const made = [];
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; this.drawn = []; made.push(this); }
    // drawImage 는 다섯 인자(통째로)와 아홉 인자(오려서 — 오린 자리는 끝에 붙여 적는다) 둘 다 받는다.
    getContext() { const c = this; return { fillRect() {}, drawImage(bm, ...a) { c.drawn.push(a.length === 8 ? [bm.tag, ...a.slice(4), a.slice(0, 4)] : [bm.tag, ...a]); } }; }
    async convertToBlob({ type }) { return new Blob([`tile-${this.height}`], { type }); }
  };
  const opened = [];
  const bitmapOf = async (dataUrl) => {
    const tag = Buffer.from(dataUrl.split(',')[1], 'base64').toString();
    const bm = { tag, width: 1500, height: 1250, closed: false, close() { this.closed = true; } };   // 1200×1000 CSS 를 1.25 배로 찍은 것
    opened.push(bm);
    return bm;
  };
  const shot = (tag) => `data:image/png;base64,${Buffer.from(tag).toString('base64')}`;
  await ta('장마다 캔버스를 내어 걸치는 화면만 그리고(배율은 첫 화면으로 잰다), 쓴 그림은 닫는다', async () => {
    made.length = 0;
    const shots = [{ dataUrl: shot('s0'), y: 0, h: 1000 }, { dataUrl: shot('s1'), y: 1000, h: 1000 }, { dataUrl: shot('s2'), y: 1200, h: 1000 }];
    const blobs = await stitchTiles({ shots, viewportWidth: 1200, totalHeight: 2200, tileHeight: 1697 }, { bitmapOf });
    assert.equal(blobs.length, 2);
    assert.deepEqual(made.map((c) => [c.width, c.height]), [[1500, 2121], [1500, 629]]);   // 1.25 배 저장
    assert.deepEqual(made[0].drawn, [['s0', 0, 0, 1500, 1250], ['s1', 0, 1250, 1500, 1250], ['s2', 0, 1500, 1500, 1250]]);
    assert.deepEqual(made[1].drawn, [['s1', 0, -871, 1500, 1250], ['s2', 0, -621, 1500, 1250]], '첫 화면은 둘째 장에 걸치지 않는다');
    assert.ok(opened.every((bm) => bm.closed));
    assert.deepEqual(await Promise.all(blobs.map((b) => b.text())), ['tile-2121', 'tile-629']);
  });
  await ta(`배율이 ${MAX_SCALE} 을 넘으면 줄여 저장한다`, async () => {
    made.length = 0;
    const big = async () => ({ tag: 'b', width: 3600, height: 3000, close() {} });   // 3 배
    await stitchTiles({ shots: [{ dataUrl: shot('b'), y: 0, h: 1000 }], viewportWidth: 1200, totalHeight: 1000, tileHeight: 1697 }, { bitmapOf: big });
    assert.deepEqual(made.map((c) => [c.width, c.height]), [[2400, 2000]]);
    assert.deepEqual(made[0].drawn, [['b', 0, 0, 2400, 2000]]);
  });
  await ta('부분을 찍은 것은 화면마다 crop 만 오려 붙이고, 장의 폭은 그 부분의 폭이다', async () => {
    made.length = 0;
    const shots = [{ dataUrl: shot('c0'), y: 0, h: 1000, crop: { x: 100, y: 0, w: 800, h: 1000 } }, { dataUrl: shot('c1'), y: 600, h: 400, crop: { x: 100, y: 600, w: 800, h: 400 } }];
    await stitchTiles({ shots, viewportWidth: 1200, width: 800, totalHeight: 1000, tileHeight: 1131 }, { bitmapOf });
    assert.deepEqual(made.map((c) => [c.width, c.height]), [[1000, 1250]], '1.25 배');
    assert.deepEqual(made[0].drawn, [['c0', 0, 0, 1000, 1250, [125, 0, 1000, 1250]], ['c1', 0, 750, 1000, 500, [125, 750, 1000, 500]]]);
  });
  await ta('찍은 것이 없으면 던진다', async () => {
    await assert.rejects(stitchTiles({ shots: [], viewportWidth: 1200, totalHeight: 0, tileHeight: 1697 }, { bitmapOf }), /찍은 화면이 없습니다/);
  });
  delete globalThis.OffscreenCanvas;
}

console.log(`\n${pass} passed`);
