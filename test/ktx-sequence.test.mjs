// 좌석 선택·안내 닫힘·로딩 종료를 확인한 뒤에만 예매 단계로 넘어간다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { korailReservePage } from '../src/korailreserve.js';
const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

const TARGET = { no: '333', dep: '14:44', from: '대전', to: '부산', seat: 'gen', date: '2026-11-13', adults: 1 };
const ROW = '<li class="tckList">KTX 333 대전 → 부산(14:44 ~ 16:14)'
  + '<div class="data_box"><h3><span>대전</span><span>부산</span></h3></div>'
  + '<div class="price_box gen active"><a href="#none">일반실 33,000원</a></div></li>';
const COND = '<input id="startDate" value="2026-11-13(금) 14:00"><input id="labelple" value="총 1명">';
const MODAL = '<div class="ReactModal__Content" id="notice">이용 안내 <button>확인</button></div>';

function page(extra = '', { selected = true } = {}) {
  const row = selected ? ROW : ROW.replace('gen active', 'gen');
  const dom = new JSDOM(`<body><ul>${row}</ul>${COND}<button class="reservbtn">예매</button>${extra}</body>`,
    { url: 'https://www.korail.com/ticket/search/list', pretendToBeVisual: true });
  dom.window.Element.prototype.getClientRects = function () {
    return this.isConnected && !this.closest('[hidden], [style*="display: none"]') ? [{}] : [];
  };
  const clicks = [];
  dom.window.document.addEventListener('click', (e) => clicks.push(e.target.textContent.trim()), true);
  return { dom, doc: dom.window.document, clicks };
}

async function run(p, step, target = TARGET) {
  const saved = Object.fromEntries(['document', 'location', 'getComputedStyle'].map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, { document: p.doc, location: p.dom.window.location, getComputedStyle: p.dom.window.getComputedStyle.bind(p.dom.window) });
  try { return await korailReservePage(step, target); } finally { Object.assign(globalThis, saved); }
}

test('순차 예약 — ready는 목표 선택·조건·활성 예매 버튼을 읽기만 하고 안정 비교 키를 반환한다', async () => {
  const p = page();
  try {
    const before = p.doc.body.innerHTML;
    const a = await run(p, 'ready');
    const b = await run(p, 'ready');
    assert.equal(a.ready, true);
    assert.equal(typeof a.key, 'string');
    assert.ok(a.key.length > 0);
    assert.equal(a.key, b.key);
    assert.deepEqual(p.clicks, []);
    assert.equal(p.doc.body.innerHTML, before);
    p.doc.querySelector('.gen a').textContent = '일반실 34,000원';
    const changed = await run(p, 'ready');
    assert.equal(changed.ready, true);
    assert.notEqual(changed.key, a.key, '가격 등 선택 상태가 바뀌면 두 번 연속 확인을 다시 시작해야 한다');
  } finally { p.dom.window.close(); }
});

test('순차 예약 — 일반 안내·버튼 없는 모달·로딩 표시가 남으면 ready와 rebook 모두 예매하지 않는다', async () => {
  const cases = [
    [MODAL, 'modal-open'],
    ['<div role="dialog">처리 중인 안내</div>', 'modal-open'],
    ['<div id="loadingbar" class="layerPopup"><div class="loading_spinner"></div></div>', 'page-busy'],
    ['<div class="loading_spinner"></div>', 'page-busy'],
    ['<main aria-busy="true">처리 중</main>', 'page-busy'],
  ];
  for (const [html, why] of cases) {
    const p = page(html);
    try {
      const before = p.doc.body.innerHTML;
      const ready = await run(p, 'ready');
      const rebook = await run(p, 'rebook');
      assert.equal(ready.ready, false, html);
      assert.equal(ready.why, why, html);
      assert.equal(rebook.booked, undefined, html);
      assert.equal(rebook.why, why, html);
      assert.deepEqual(p.clicks, [], html);
      assert.equal(p.doc.body.innerHTML, before);
    } finally { p.dom.window.close(); }
  }
});

test('순차 예약 — 숨겨진 로딩은 진행을 막지 않으며 날짜·인원·선택·활성 버튼은 다시 확인한다', async () => {
  const p = page('<div id="loadingbar" hidden><div class="loading_spinner"></div></div>');
  try {
    assert.equal((await run(p, 'ready')).ready, true);
    assert.equal((await run(p, 'ready', { ...TARGET, date: '2026-11-14' })).why, 'condition-mismatch');
    assert.equal((await run(p, 'ready', { ...TARGET, adults: 2 })).why, 'condition-mismatch');
    p.doc.querySelector('.reservbtn').disabled = true;
    assert.equal((await run(p, 'ready')).why, 'book-disabled');
    p.doc.querySelector('.reservbtn').disabled = false;
    p.doc.querySelector('.gen').classList.remove('active');
    assert.equal((await run(p, 'ready')).why, 'selection-mismatch');
    assert.deepEqual(p.clicks, []);
  } finally { p.dom.window.close(); }
});

test('순차 예약 — 일반 안내 확인은 한 번만 누르고 실제 닫힌 뒤에야 선택 완료를 알린다', async () => {
  const p = page('', { selected: false });
  let closed = false;
  try {
    p.doc.querySelector('.gen a').addEventListener('click', (e) => {
      e.preventDefault();
      p.doc.querySelector('.gen').classList.add('active');
      p.doc.body.insertAdjacentHTML('beforeend', MODAL);
      p.doc.querySelector('#notice button').addEventListener('click', () => {
        p.dom.window.setTimeout(() => { p.doc.querySelector('#notice')?.remove(); closed = true; }, 700);
      });
    });
    const r = await run(p, 'pick', { ...TARGET, hold: true });
    assert.equal(r.ready, true);
    assert.equal(closed, true);
    assert.deepEqual(p.clicks, ['일반실 33,000원', '확인']);
  } finally { p.dom.window.close(); }
});

test('순차 예약 — 확인해도 남은 일반 안내는 반복 클릭하거나 뒤의 예매를 누르지 않는다', async () => {
  const p = page('', { selected: false });
  try {
    p.doc.querySelector('.gen a').addEventListener('click', (e) => {
      e.preventDefault();
      p.doc.querySelector('.gen').classList.add('active');
      p.doc.body.insertAdjacentHTML('beforeend', MODAL);
    });
    const r = await run(p, 'pick', { ...TARGET, hold: true });
    assert.equal(r.why, 'modal-pending');
    assert.notEqual(r.ready, true);
    assert.equal(r.booked, undefined);
    assert.deepEqual(p.clicks, ['일반실 33,000원', '확인']);
  } finally { p.dom.window.close(); }
});

test('순차 예약 — settle은 일반 안내 한 개만 처리하고 다음 안내는 다음 호출에서 다시 읽는다', async () => {
  const p = page(MODAL + '<div role="dialog" id="second">정차역 안내 <button>확인</button></div>');
  try {
    p.doc.querySelector('#notice button').addEventListener('click', () => {
      p.dom.window.setTimeout(() => p.doc.querySelector('#notice')?.remove(), 400);
    });
    const r = await run(p, 'settle');
    assert.equal(r.done, false);
    assert.deepEqual(p.clicks, ['확인']);
    assert.equal(p.doc.querySelector('#notice'), null);
    assert.ok(p.doc.querySelector('#second'));
  } finally { p.dom.window.close(); }
});

test('순차 예약 — 안내 틀을 재사용해 버튼을 교체해도 이전 확인 완료로 보고 새 안내는 누르지 않는다', async () => {
  const p = page(MODAL);
  try {
    const node = p.doc.querySelector('#notice');
    const previousButton = node.querySelector('button');
    previousButton.addEventListener('click', () => {
      p.dom.window.setTimeout(() => { node.innerHTML = '다음 정차역 안내 <button>확인</button>'; }, 100);
    });
    const r = await run(p, 'settle');
    assert.equal(r.done, false);
    assert.notEqual(r.why, 'modal-pending');
    assert.equal(p.doc.querySelector('#notice'), node, 'React가 안내 틀은 유지한다');
    assert.equal(previousButton.isConnected, false);
    assert.match(node.textContent, /다음 정차역 안내/);
    assert.deepEqual(p.clicks, ['확인'], '새 안내는 다음 호출에서 읽고 처리한다');
  } finally { p.dom.window.close(); }
});

test('순차 예약 — 같은 안내 틀과 버튼에서 문구만 바뀌어도 다음 안내는 다음 호출에서 처리한다', async () => {
  const p = page(MODAL);
  try {
    const node = p.doc.querySelector('#notice');
    const button = node.querySelector('button');
    let presses = 0;
    button.addEventListener('click', () => {
      presses++;
      p.dom.window.setTimeout(() => {
        if (presses === 1) node.firstChild.nodeValue = '다음 정차역 안내 ';
        else node.remove();
      }, 100);
    });
    const first = await run(p, 'settle');
    assert.equal(first.done, false);
    assert.notEqual(first.why, 'modal-pending');
    assert.equal(p.doc.querySelector('#notice'), node);
    assert.equal(node.querySelector('button'), button, 'React가 확인 버튼까지 재사용한다');
    assert.match(node.textContent, /다음 정차역 안내/);
    assert.deepEqual(p.clicks, ['확인'], '문구가 바뀌었다고 같은 호출에서 새 안내를 누르지 않는다');
    const second = await run(p, 'settle');
    assert.notEqual(second.why, 'modal-pending');
    assert.equal(p.doc.querySelector('#notice'), null);
    assert.deepEqual(p.clicks, ['확인', '확인']);
  } finally { p.dom.window.close(); }
});
