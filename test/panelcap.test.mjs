// 패널 캡처(src/panelcap.js) — 고르기 막·코드 복사·이미지 복사의 순서를 jsdom 에서 본다.
// jsdom 에는 자리(getBoundingClientRect)·맞히기(elementsFromPoint)·캔버스가 없다 — 자리는 data-r 속성으로 흉내 내고, 맞히기는 hitAt 으로,
// 그림은 render 로 갈아 끼운다. 복제·SVG 문서 만들기(cloneStyled·svgOf)는 구조만 본다(계산 스타일은 jsdom 이 display 정도만 준다).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
// jsdom 은 가상 요소의 계산 스타일을 모른다("Not implemented") — 그 투덜거림은 가리고 다른 오류는 보인다(jsdom 30 은 forwardTo — sendTo 는 없어졌다).
const virtualConsole = new VirtualConsole().forwardTo(console, { jsdomErrors: 'none' });
import {
  ENABLE_KEY, captureEnabled, CODE_MAX, DRAG_MIN, nameOf, pathOf, labelOf, snapshot, codeOf, shallowOf, contentText, cloneStyled, svgOf, openDefaults, startPick,
} from '../src/panelcap.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const tick = () => new Promise((r) => setTimeout(r, 10));

const HTML = `<!doctype html><html><body><main class="app" data-r="0,0,400,900">
  <header class="app-header" data-r="0,0,400,60">
    <div class="head-tools" data-r="200,10,190,40">
      <button id="refresh" class="icon refresh" type="button" data-r="300,13,34,34"><svg viewBox="0 0 24 24" data-r="308,21,18,18"><path d="M1 1" data-r="308,21,18,18"/></svg></button>
    </div>
  </header>
  <section id="attend" class="attend card" data-r="0,70,400,200">
    <div class="ask-bar" data-r="10,80,380,44">
      <input type="text" id="atChatInput" value="처음" data-r="20,84,300,36" />
      <input type="checkbox" id="chk" data-r="330,90,16,16" />
      <strong id="st" data-r="350,90,30,16">굵게</strong>
      <textarea id="ta" data-r="0,0,0,0"></textarea>
      <select id="sel" data-r="0,0,0,0"><option value="a">a</option><option value="b">b</option></select>
      <div hidden id="gone" data-r="0,0,0,0">숨은 것</div>
      <input type="password" id="pw" value="비밀" data-r="20,130,100,30" />
    </div>
  </section>
</main></body></html>`;

/** 자리는 data-r="left,top,width,height" 로 흉내 낸다 — 없으면 0. */
function boot() {
  const dom = new JSDOM(HTML, { url: 'https://example.org/sidepanel.html', virtualConsole });
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = function () {
    const [left = 0, top = 0, width = 0, height = 0] = (this.getAttribute?.('data-r') || '').split(',').map(Number);
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
  };
  return { window, doc: window.document };
}

console.log('켜고 끄기');
t('설정 키와 기본값 — 없으면 켬, false 일 때만 끔', () => {
  assert.equal(ENABLE_KEY, 'panelCapture');
  assert.equal(captureEnabled(undefined), true);
  assert.equal(captureEnabled(true), true);
  assert.equal(captureEnabled(false), false);
});

console.log('이름·자리');
{
  const { doc } = boot();
  t('짧은 이름 — 태그#id.클래스(앞의 셋)', () => {
    assert.equal(nameOf(doc.getElementById('refresh')), 'button#refresh.icon.refresh');
    assert.equal(nameOf(doc.querySelector('.head-tools')), 'div.head-tools');
    assert.equal(nameOf(doc.getElementById('refresh'), 1), 'button#refresh.icon');
  });
  t('자리 — body 아래부터 그 요소까지', () =>
    assert.equal(pathOf(doc.getElementById('refresh')), 'main.app > header.app-header > div.head-tools > button#refresh.icon.refresh'));
  t('이름표 — 짧은 이름과 크기', () => assert.equal(labelOf(doc.getElementById('refresh')), 'button#refresh.icon.refresh · 34×34'));
}

console.log('코드 복사');
{
  const { doc } = boot();
  doc.getElementById('atChatInput').value = '적은 글';
  doc.getElementById('chk').checked = true;
  doc.getElementById('ta').value = '여러\n줄';
  doc.getElementById('sel').value = 'b';
  doc.getElementById('pw').value = '바뀐 비밀';
  const section = doc.getElementById('attend');
  const snap = snapshot(section);
  t('입력칸의 지금 값이 속성으로 — value·checked·selected·textarea', () => {
    assert.equal(snap.querySelector('#atChatInput').getAttribute('value'), '적은 글');
    assert.ok(snap.querySelector('#chk').hasAttribute('checked'));
    assert.equal(snap.querySelector('#ta').textContent, '여러\n줄');
    assert.ok(snap.querySelector('#sel option[value="b"]').hasAttribute('selected'));
    assert.ok(!snap.querySelector('#sel option[value="a"]').hasAttribute('selected'));
  });
  t('비밀번호 칸의 값은 적지 않는다 — 처음 속성 그대로', () => assert.equal(snap.querySelector('#pw').getAttribute('value'), '비밀'));
  t('원본은 건드리지 않는다', () => assert.equal(section.querySelector('#atChatInput').getAttribute('value'), '처음'));
  const text = codeOf([doc.getElementById('refresh'), section], { head: '회의실 예약 · v0.4.0' });
  t('머리말 주석 · 곳마다 번호·자리·크기 주석과 HTML', () => {
    assert.match(text, /^<!-- 패널 캡처 · 회의실 예약 · v0\.4\.0 -->\n/);
    assert.match(text, /<!-- 1\/2 · main\.app > header\.app-header > div\.head-tools > button#refresh\.icon\.refresh · 34×34 -->\n<button id="refresh"/);
    assert.match(text, /<!-- 2\/2 · main\.app > section#attend\.attend\.card · 400×200 -->\n<section id="attend"/);
    assert.match(text, /value="적은 글"/);
    assert.match(text, /\n$/);
  });
  t('하나면 번호 없이', () => assert.match(codeOf([doc.getElementById('refresh')]), /^<!-- 패널 캡처 -->\n<!-- main\.app > header/));
  t('너무 길면 자르고 몇 자였는지 적는다', () => {
    const big = doc.createElement('div');
    big.setAttribute('data-r', '0,0,10,10');
    big.textContent = 'x'.repeat(CODE_MAX + 500);
    doc.body.append(big);
    const out = codeOf([big]);
    assert.ok(out.length < CODE_MAX + 400);
    assert.match(out, /<!-- … 잘림 — 전체 30,5\d\d자 -->/);
  });
  t('얕은 코드(Help Chat 에 붙이는 것, 2026-10-26) — 자리 주석과 여는 태그, 바로 아래 자식만 한 줄씩, 더 깊은 것은 보이지 않는다', () => {
    const out = codeOf([section], { shallow: true });
    assert.match(out, /^<!-- 패널 캡처 -->\n<!-- main\.app > section#attend\.attend\.card · 400×200 -->\n<section id="attend" class="attend card" data-r="0,70,400,200">\n  <div class="ask-bar" data-r="10,80,380,44">[^\n]*<\/div>\n<\/section>\n$/);
    assert.doesNotMatch(out, /<input|<strong/);
  });
  t('자식 줄 — 글 칸은 지금 값, 글은 한 줄로, 글 없이 자식만 있으면 …', () => {
    const bar = shallowOf(doc.querySelector('.ask-bar'));
    assert.match(bar, /^  <input type="text" id="atChatInput" value="적은 글" data-r="20,84,300,36">$/m);
    assert.match(bar, /^  <strong id="st" data-r="350,90,30,16">굵게<\/strong>$/m);
    assert.match(bar, /^  <textarea id="ta" data-r="0,0,0,0">여러 줄<\/textarea>$/m);
    assert.equal(shallowOf(doc.getElementById('refresh')),
      '<button id="refresh" class="icon refresh" type="button" data-r="300,13,34,34">\n  <svg viewBox="0 0 24 24" data-r="308,21,18,18">…</svg>\n</button>');
    assert.equal(shallowOf(doc.getElementById('st')), '<strong id="st" data-r="350,90,30,16">굵게</strong>', '자식이 없으면 한 줄');
  });
  t('자식은 12개까지, 글은 40자까지', () => {
    const list = doc.createElement('ul');
    for (let i = 0; i < 14; i++) list.append(Object.assign(doc.createElement('li'), { textContent: i ? `${i}` : 'ㄱ'.repeat(50) }));
    const out = shallowOf(list);
    assert.equal(out.split('\n').length, 1 + 12 + 1 + 1);
    assert.match(out, /^  <li>ㄱ{40}…<\/li>$/m);
    assert.match(out, /^  <!-- … 외 2개 -->$/m);
  });
}

console.log('가상 요소의 content');
{
  const { doc } = boot();
  const el = doc.createElement('span');
  el.setAttribute('title', '제목');
  t('따옴표 글·attr() 을 잇고 이스케이프를 푼다, none·normal·url() 은 비운다', () => {
    assert.equal(contentText('"→ "', el), '→ ');
    assert.equal(contentText("'a' attr(title) \"\\201C\"", el), 'a제목\u201C');
    assert.equal(contentText('"\\"q\\""', el), '"q"');
    assert.equal(contentText('none', el), '');
    assert.equal(contentText('normal', el), '');
    assert.equal(contentText('url("x.png")', el), '');
  });
}

console.log('복제와 SVG 문서');
{
  const { doc, window } = boot();
  doc.getElementById('atChatInput').value = '적은 글';
  doc.getElementById('chk').checked = true;
  const section = doc.getElementById('attend');
  const defaults = openDefaults(doc);
  const node = await cloneStyled(section, defaults, { root: true, w: 400, h: 200 });
  defaults.close();
  t('root 는 크기를 못 박고 여백·자리를 없앤다', () => {
    assert.equal(node.style.width, '400px');
    assert.equal(node.style.height, '200px');
    assert.equal(node.style.margin, '0px');
    assert.equal(node.style.position, 'relative');
  });
  t('숨은 것(display: none)은 빠지고, 입력칸의 값은 속성으로', () => {
    assert.equal(node.querySelector('#gone'), null);
    assert.equal(node.querySelector('#atChatInput').getAttribute('value'), '적은 글');
    assert.ok(node.querySelector('#chk').hasAttribute('checked'));
  });
  t('숨은 틀 문서는 닫으면 없어진다', () => assert.equal(doc.querySelector('iframe'), null));
  const svg = svgOf(node, 400, 200, 2);
  t('SVG 문서 — 배율만큼 큰 그림에 foreignObject 안의 XHTML, 안쪽 div 가 배율을 맡는다', () => {
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="800" height="400"><foreignObject width="100%" height="100%">/);
    assert.match(svg, /<div xmlns="http:\/\/www\.w3\.org\/1999\/xhtml" style="width:400px;height:200px;overflow:hidden;transform:scale\(2\);transform-origin:0 0">/);
    assert.match(svg, /<section xmlns="http:\/\/www\.w3\.org\/1999\/xhtml" id="attend"/);
  });
  t('XML 로 읽힌다', () => {
    const parsed = new window.DOMParser().parseFromString(svg, 'image/svg+xml');
    assert.equal(parsed.querySelector('parsererror'), null);
    assert.ok(parsed.querySelector('foreignObject input'));
  });
}

console.log('고르기 막');
{
  const { doc, window } = boot();
  /** 맞히기 — 자리(data-r)가 그 점을 품는 것들을 안쪽(깊은 것)부터. */
  const hitAt = (x, y) => [...doc.querySelectorAll('[data-r]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; })
    .sort((a, b) => (a.contains(b) ? 1 : b.contains(a) ? -1 : 0));
  const clipboard = { texts: [], items: [], writeText: async (s) => { clipboard.texts.push(s); }, write: async (items) => { clipboard.items.push(items); } };
  const copies = [];
  let ended = 0;
  const fakeBlob = { type: 'image/png', size: 3 };
  let renderCalls = [];
  const render = async (els) => { renderCalls.push(els); return fakeBlob; };
  window.ClipboardItem = class { constructor(parts) { this.parts = parts; } };
  const changes = [];
  const pick = startPick({ doc, hitAt, clipboard, render, head: '머리', onCopy: (r) => copies.push(r), onChange: (els) => changes.push(els.map((e) => e.id)), onEnd: () => { ended++; } });
  const host = doc.querySelector('.pcap');
  const veil = host.querySelector('.pcap-veil');
  const bar = host.querySelector('.pcap-bar');
  const big = host.querySelector('.pcap-n b');
  const codeBtn = host.querySelector('.pcap-code');
  const imgBtn = host.querySelector('.pcap-img');
  const move = (x, y) => veil.dispatchEvent(new window.MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
  /** 누름 — 고르기는 mouseup 에서(끌지 않았으면). */
  const click = (x, y) => { for (const type of ['mousedown', 'mouseup']) veil.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true })); };
  const key = (k) => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  t('막은 body 끝에 붙고 띠는 처음엔 고르라는 말과 잠긴 복사 단추', () => {
    assert.ok(host && host === doc.body.lastElementChild);
    assert.equal(host.getAttribute('role'), 'dialog');
    assert.equal(big.textContent, '캡처할 곳을 누르세요');
    assert.ok(codeBtn.disabled && imgBtn.disabled);
    assert.ok(bar.querySelector('.pcap-no'));
  });
  move(310, 25);
  const hover = host.querySelector('.pcap-hover');
  t('아이콘(svg 의 path) 위를 가리키면 그 단추가 점선 칸 — 이름표에 짧은 이름과 크기', () => {
    assert.equal(hover.hidden, false);
    assert.equal(hover.style.left, '300px');
    assert.equal(hover.style.width, '34px');
    assert.equal(hover.querySelector('.pcap-tag').textContent, '누르면 고르기 · button#refresh.icon.refresh · 34×34 · ↑');
  });
  key('ArrowUp');
  t('↑ 는 한 겹 큰 칸(div.head-tools)', () =>
    assert.equal(hover.querySelector('.pcap-tag').textContent, '누르면 고르기 · div.head-tools · 190×40 · ↑ · ↓'));
  key('ArrowDown');
  click(310, 25);
  t('누르면 고르고 번호 1 이 붙는다 · 띠는 1개·복사 단추 열림', () => {
    assert.deepEqual(pick.chosen().map((e) => e.id), ['refresh']);
    const marks = [...host.querySelectorAll('.pcap-marks .pcap-box')];
    assert.equal(marks.length, 1);
    assert.equal(marks[0].querySelector('b').textContent, '1');
    assert.equal(marks[0].style.top, '13px');
    assert.equal(big.textContent, '1개 골랐습니다');
    assert.ok(!codeBtn.disabled && !imgBtn.disabled);
    assert.equal(hover.querySelector('.pcap-tag').textContent, '누르면 빼기 · button#refresh.icon.refresh · 34×34 · ↑');
  });
  move(360, 95);
  t('inline 글자(strong)는 건너뛰고 그 상자(div.ask-bar)를 고른다', () =>
    assert.equal(hover.querySelector('.pcap-tag').textContent, '누르면 고르기 · div.ask-bar · 380×44 · ↑'));
  move(100, 100);
  t('글 칸(input)은 inline 이어도 고른다', () =>
    assert.equal(hover.querySelector('.pcap-tag').textContent, '누르면 고르기 · input#atChatInput · 300×36 · ↑'));
  click(100, 100);
  t('둘째는 번호 2', () => {
    assert.deepEqual(pick.chosen().map((e) => e.id), ['refresh', 'atChatInput']);
    assert.deepEqual([...host.querySelectorAll('.pcap-marks b')].map((b) => b.textContent), ['1', '2']);
    assert.equal(big.textContent, '2개 골랐습니다');
  });
  click(310, 25);
  t('고른 것을 다시 누르면 빠지고 번호가 당겨진다', () => {
    assert.deepEqual(pick.chosen().map((e) => e.id), ['atChatInput']);
    assert.deepEqual([...host.querySelectorAll('.pcap-marks b')].map((b) => b.textContent), ['1']);
  });
  t('고르고 뺄 때마다 onChange 에 지금 고른 것(Help Chat 에 붙이기)', () =>
    assert.deepEqual(changes, [['refresh'], ['refresh', 'atChatInput'], ['atChatInput']]));
  click(310, 25);
  codeBtn.click();
  await tick();
  await ta('코드 복사 — codeOf 의 글이 클립보드로, 띠에 복사됐다는 말, onCopy', async () => {
    assert.equal(clipboard.texts.length, 1);
    assert.equal(clipboard.texts[0], codeOf([doc.getElementById('atChatInput'), doc.getElementById('refresh')], { head: '머리' }));
    assert.equal(big.textContent, '코드 복사됨 · 2곳');
    assert.ok(host.classList.contains('pcap-said'));
    assert.deepEqual(copies.at(-1), { kind: 'code', count: 2, ok: true });
  });
  imgBtn.click();
  await tick();
  await ta('이미지 복사 — render 가 준 PNG 를 ClipboardItem 으로, onCopy', async () => {
    assert.equal(renderCalls.length, 1);
    assert.deepEqual(renderCalls[0].map((e) => e.id), ['atChatInput', 'refresh']);
    assert.equal(clipboard.items.length, 1);
    assert.equal(clipboard.items[0][0].parts['image/png'], fakeBlob);
    assert.equal(big.textContent, '이미지 복사됨 · 2곳');
    assert.deepEqual(copies.at(-1), { kind: 'image', count: 2, ok: true });
    assert.ok(!imgBtn.disabled, '복사한 뒤에도 단추는 열려 있다');
  });
  doc.getElementById('refresh').remove();
  codeBtn.click();
  await tick();
  t('떨어져 나간 것(패널이 다시 그려짐)은 빼고 복사한다', () => {
    assert.equal(copies.at(-1).count, 1);
    assert.deepEqual(pick.chosen().map((e) => e.id), ['atChatInput']);
  });
  clipboard.writeText = async () => { throw new Error('초점이 없습니다'); };
  codeBtn.click();
  await tick();
  t('못 넣으면 까닭을 띠에, onCopy 에 error', () => {
    assert.equal(big.textContent, '복사하지 못했습니다 — 초점이 없습니다');
    assert.ok(host.classList.contains('pcap-fail'));
    assert.equal(copies.at(-1).ok, false);
    assert.equal(copies.at(-1).error.message, '초점이 없습니다');
  });
  t('아직 끝나지 않았다', () => assert.equal(ended, 0));
  key('Escape');
  t('Esc 는 막을 걷고 onEnd', () => {
    assert.equal(doc.querySelector('.pcap'), null);
    assert.equal(ended, 1);
  });
  pick.cancel();
  t('다시 끝내도 한 번만', () => assert.equal(ended, 1));
}
{
  const { doc, window } = boot();
  let ended = 0;
  const render = async () => { throw new Error('캔버스가 없습니다'); };
  const clipboard = { writeText: async () => {}, write: async () => {} };
  window.ClipboardItem = class {};
  const pick = startPick({ doc, hitAt: () => [doc.getElementById('refresh')], clipboard, render, onEnd: () => { ended++; } });
  const host = doc.querySelector('.pcap');
  for (const type of ['mousedown', 'mouseup']) host.querySelector('.pcap-veil').dispatchEvent(new window.MouseEvent(type, { clientX: 310, clientY: 25, bubbles: true, cancelable: true }));
  host.querySelector('.pcap-img').click();
  await tick();
  t('그리지 못하면 까닭을 띠에 적고 단추는 다시 열린다', () => {
    assert.equal(host.querySelector('.pcap-n b').textContent, '그리지 못했습니다 — 캔버스가 없습니다');
    assert.ok(!host.querySelector('.pcap-img').disabled);
  });
  host.querySelector('.pcap-no').click();
  t('띠의 ✕ 도 끝', () => { assert.equal(doc.querySelector('.pcap'), null); assert.equal(ended, 1); });
  pick.cancel();
}
{
  const { doc, window } = boot();
  const changes = [];
  const pick = startPick({ doc, hitAt: () => [doc.getElementById('refresh')], copy: false, onChange: (els) => changes.push(els.length) });
  const host = doc.querySelector('.pcap');
  for (const type of ['mousedown', 'mouseup']) host.querySelector('.pcap-veil').dispatchEvent(new window.MouseEvent(type, { clientX: 310, clientY: 25, bubbles: true, cancelable: true }));
  t('copy: false(Help Chat 의 캡처)면 코드·이미지 복사를 묻지 않는다 — 고르면 onChange 로 붙고 띠는 고른 수와 끝만(2026-10-27)', () => {
    assert.equal(host.querySelector('.pcap-code, .pcap-img'), null);
    assert.ok(host.querySelector('.pcap-no'));
    assert.deepEqual(changes, [1]);
    assert.equal(host.querySelector('.pcap-n b').textContent, '1개 골랐습니다 · Help Chat 에 붙음');
  });
  pick.cancel();
}

console.log('끌어서 여러 개 (2026-10-17 "드래그 하면 여러개 포함되도록")');
{
  const { doc, window } = boot();
  const hitAt = (x, y) => [...doc.querySelectorAll('[data-r]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; })
    .sort((a, b) => (a.contains(b) ? 1 : b.contains(a) ? -1 : 0));
  const clipboard = { writeText: async () => {}, write: async () => {} };
  const changes = [];
  const pick = startPick({ doc, hitAt, clipboard, render: async () => ({}), onChange: (els) => changes.push(els.length) });
  const host = doc.querySelector('.pcap');
  const veil = host.querySelector('.pcap-veil');
  const dragBox = host.querySelector('.pcap-drag');
  const hover = host.querySelector('.pcap-hover');
  const big = host.querySelector('.pcap-n b');
  const ev = (type, x, y, target = veil) => target.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
  const tagOf = () => dragBox.querySelector('.pcap-tag').textContent;
  const preIds = () => [...host.querySelectorAll('.pcap-pre .pcap-box')].map((d) => `${d.style.left}/${d.style.top}`);
  const ids = () => pick.chosen().map((e) => e.id);

  ev('mousedown', 15, 82);
  ev('mousemove', 17, 83);
  t('DRAG_MIN 보다 덜 움직이면 아직 끌기가 아니다 — 네모 없음, 가리키는 칸은 그대로', () => {
    assert.equal(DRAG_MIN, 4);
    assert.equal(dragBox.hidden, true);
    assert.equal(hover.hidden, false);
  });
  ev('mousemove', 348, 122);
  t('넘게 움직이면 네모와 통째로 든 것들의 미리 보기 — 글 칸·체크박스 둘(반만 든 상자 div.ask-bar 와 inline 글자 strong 은 아니다), 가리키는 칸은 숨는다', () => {
    assert.equal(dragBox.hidden, false);
    assert.deepEqual([dragBox.style.left, dragBox.style.top, dragBox.style.width, dragBox.style.height], ['15px', '82px', '333px', '40px']);
    assert.equal(tagOf(), '놓으면 2개 고르기');
    assert.deepEqual(preIds(), ['20px/84px', '330px/90px']);
    assert.equal(hover.hidden, true);
    assert.deepEqual(ids(), [], '놓기 전에는 아직');
  });
  ev('mouseup', 348, 122);
  t('놓으면 그것들이 문서 차례로 들어가고 네모·미리 보기는 걷힌다, 띠는 2개', () => {
    assert.deepEqual(ids(), ['atChatInput', 'chk']);
    assert.equal(dragBox.hidden, true);
    assert.deepEqual(preIds(), []);
    assert.equal(big.textContent, '2개 골랐습니다');
    assert.equal(host.querySelectorAll('.pcap-marks .pcap-box').length, 2);
  });
  ev('mousedown', 400, 280);
  ev('mousemove', 0, 65);
  t('거꾸로(오른쪽 아래 → 왼쪽 위) 끌어도 같은 네모 · 카드가 통째로 들면 카드 하나(안의 칸은 아니다) · 이미 고른 것은 세지 않는다', () => {
    assert.deepEqual([dragBox.style.left, dragBox.style.top, dragBox.style.width, dragBox.style.height], ['0px', '65px', '400px', '215px']);
    assert.equal(tagOf(), '놓으면 1개 고르기');
    assert.deepEqual(preIds(), ['0px/70px']);
  });
  ev('mouseup', 0, 65);
  t('카드가 더해진다 — 번호 3, 먼저 고른 것은 그대로', () => assert.deepEqual(ids(), ['atChatInput', 'chk', 'attend']));
  ev('mousedown', 25, 86);
  ev('mousemove', 60, 100);
  t('통째로 든 것이 없으면 그렇다고', () => { assert.equal(tagOf(), '통째로 든 것이 없습니다'); assert.deepEqual(preIds(), []); });
  ev('mouseup', 60, 100);
  t('놓아도 아무것도 더하지 않는다', () => assert.deepEqual(ids(), ['atChatInput', 'chk', 'attend']));
  ev('mousedown', 15, 82);
  ev('mousemove', 348, 122);
  t('든 것이 모두 이미 고른 것이면 그렇다고', () => { assert.equal(tagOf(), '이미 고른 것입니다'); assert.deepEqual(preIds(), []); });
  ev('mouseup', 348, 122);
  t('다시 들어가지 않는다(한 번만)', () => assert.deepEqual(ids(), ['atChatInput', 'chk', 'attend']));
  t('onChange 는 더해졌을 때만 — 든 것이 없거나 모두 이미 고른 것이면 부르지 않는다', () => assert.deepEqual(changes, [2, 3]));
  ev('mousedown', 100, 100);
  ev('mouseup', 100, 100);
  t('안 움직이고 놓으면 누른 것 — 고른 것을 빼고 번호가 당겨진다', () => {
    assert.deepEqual(ids(), ['chk', 'attend']);
    assert.deepEqual([...host.querySelectorAll('.pcap-marks b')].map((b) => b.textContent), ['1', '2']);
  });
  ev('mousedown', 100, 100);
  ev('mouseup', 100, 100, host.querySelector('.pcap-code'));
  t('띠 위에서 놓으면 고르지 않는다', () => assert.deepEqual(ids(), ['chk', 'attend']));
  ev('mousedown', 15, 82);
  ev('mousemove', 348, 122);
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  ev('mouseup', 348, 122, window);
  t('끌다가 Esc 면 막이 걷히고 놓아도 아무 일 없다', () => {
    assert.equal(doc.querySelector('.pcap'), null);
    assert.deepEqual(ids(), ['chk', 'attend']);
  });
  pick.cancel();
}

console.log(`\n${pass} passed`);
