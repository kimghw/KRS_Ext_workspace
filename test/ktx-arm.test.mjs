// 네이티브 예매는 검증된 버튼의 잠깐 유효한 접근성 이름으로만 연결한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { korailReservePage } from '../src/korailreserve.js';
const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

const TOKEN = '12345678-1234-4234-8234-123456789abc';
const NEXT_TOKEN = '87654321-4321-4321-9321-cba987654321';
const MARKER = 'data-krs-reserve-arm';
const TARGET = { no: '333', dep: '14:44', from: '대전', to: '부산', seat: 'gen', date: '2026-11-13', adults: 1 };
const LIST = '<ul><li class="tckList">KTX 333 대전 → 부산(14:44 ~ 16:14)'
  + '<div class="data_box"><h3><span>대전</span><span>부산</span></h3></div>'
  + '<div class="price_box gen active"><a href="#none">일반실 33,000원</a></div></li></ul>'
  + '<input id="startDate" value="2026-11-13(금) 14:00"><input id="labelple" value="총 1명">'
  + '<button class="reservbtn">예매</button>';
const DETAIL = '<div class="reservation_form"><div class="rsv_confirm-wrap"><div class="tck_list-wrap">'
  + '<div class="tit_box"><div class="flag_wrap"><span class="num">00333</span><span class="dt">2026년11월13일(금)</span></div></div>'
  + '<div class="data_box"><h3 class="txt_bk">대전 → 부산 (14:44 ~ 16:14)</h3><div class="toggle_wrap"><p class="s_txt">일반실 3호차 5A</p></div></div>'
  + '<p>결제기한: 2026. 11. 11. 14:07</p></div><div class="btnWrap btnList"><button class="btn_lookup">결제하기</button></div></div></div>';

async function withPage(body, callback, path = '/ticket/search/list') {
  const dom = new JSDOM(`<body>${body}</body>`, { url: `https://www.korail.com${path}`, pretendToBeVisual: true });
  const doc = dom.window.document, clicks = [], timers = [];
  dom.window.Element.prototype.getClientRects = function () { return this.isConnected && !this.closest('[hidden]') ? [{}] : []; };
  doc.addEventListener('click', (event) => clicks.push(event.target.textContent.trim()), true);
  const saved = Object.fromEntries(['document', 'location', 'getComputedStyle', 'setTimeout', 'clearTimeout'].map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, { document: doc, location: dom.window.location, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; } });
  const run = (step, opts = {}) => korailReservePage(step, opts);
  const arm = (opts = {}) => run('arm', { ...TARGET, token: TOKEN, expiresAt: Date.now() + 10000, ...opts });
  try { return await callback({ dom, doc, clicks, timers, run, arm }); }
  finally {
    for (const timer of timers) if (!timer.cleared) timer.fn();
    Object.assign(globalThis, saved);
    dom.window.close();
  }
}

test('arm — 검증된 예매 버튼에 고유 이름만 붙이고 클릭하지 않는다', async () => {
  await withPage(LIST, async ({ doc, clicks, timers, arm }) => {
    const expiresAt = Date.now() + 10000;
    const result = await arm({ expiresAt });
    assert.deepEqual([result.armed, result.label, result.expiresAt], [true, `예매 KRS-${TOKEN}`, expiresAt]);
    assert.equal(doc.querySelector('.reservbtn').getAttribute('aria-label'), result.label);
    assert.equal(doc.querySelectorAll(`[aria-label="${result.label}"]`).length, 1);
    assert.deepEqual(clicks, []);
    assert.equal(timers.length, 1);
    assert.ok(timers[0].ms > 0 && timers[0].ms <= 10000);
  });
});

test('arm — UUIDv4와 짧은 미래 만료 시간만 받고 잘못된 요청은 화면을 바꾸지 않는다', async () => {
  await withPage(LIST, async ({ doc, clicks, timers, arm }) => {
    const before = doc.body.innerHTML;
    for (const token of [undefined, '', TOKEN.toUpperCase(), TOKEN.replace('-4234-', '-1234-'), `${TOKEN}x`, {}, 'x" onclick="x']) {
      const result = await arm({ token });
      assert.deepEqual([result.armed, result.why], [false, 'bad-token']);
    }
    for (const expiresAt of [undefined, '1234', {}, Symbol('expiry'), 1234n, NaN, Infinity, Date.now(), Date.now() - 1, Date.now() + 16000, Date.now() + 0.5]) {
      const result = await arm({ expiresAt });
      assert.deepEqual([result.armed, result.why], [false, 'bad-expiry']);
    }
    assert.equal(doc.body.innerHTML, before);
    assert.deepEqual([clicks, timers], [[], []]);
  });
});

test('arm — 목표·조건·선택·안내·로딩·활성 버튼 검증을 통과해야 표식을 붙인다', async () => {
  const cases = [
    [LIST, { no: '999' }, 'no-row'], [LIST, { date: '2026-11-14' }, 'condition-mismatch'],
    [LIST, { adults: 2 }, 'condition-mismatch'], [LIST, { date: undefined }, 'bad-target'],
    [LIST, { adults: undefined }, 'bad-target'], [LIST, { seat: 'spec' }, 'selection-mismatch'],
    [LIST.replace('gen active', 'gen'), {}, 'selection-mismatch'],
    [LIST.replace('class="reservbtn"', 'class="reservbtn" disabled'), {}, 'book-disabled'],
    [LIST + '<div id="loadingbar">처리 중</div>', {}, 'page-busy'],
    [LIST + '<div role="dialog">안내 <button>확인</button></div>', {}, 'modal-open'],
    [LIST + '<div role="dialog">매크로 -8002 <button>확인</button></div>', {}, 'guard'],
  ];
  for (const [body, opts, why] of cases) {
    await withPage(body, async ({ doc, clicks, timers, arm }) => {
      const before = doc.body.innerHTML;
      const result = await arm(opts);
      assert.deepEqual([result.armed, result.why], [false, why]);
      assert.equal(doc.body.innerHTML, before);
      assert.deepEqual([clicks, timers], [[], []]);
    });
  }
});

test('disarm — 화면이 바뀌어도 해당 토큰의 원래 접근성 이름을 정확히 복원한다', async () => {
  for (const label of [null, '', '기존 예매 이름']) {
    await withPage(LIST, async ({ dom, doc, clicks, run, arm }) => {
      const book = doc.querySelector('.reservbtn');
      if (label !== null) book.setAttribute('aria-label', label);
      assert.equal((await arm()).armed, true);
      assert.equal((await run('disarm', { token: NEXT_TOKEN })).disarmed, false);
      assert.equal(book.getAttribute('aria-label'), `예매 KRS-${TOKEN}`);
      dom.reconfigure({ url: 'https://www.korail.com/ticket/login' });
      doc.body.insertAdjacentHTML('beforeend', '<div role="dialog">매크로 -8002 <button>확인</button></div>');
      assert.equal((await run('disarm', { token: TOKEN })).disarmed, true);
      assert.equal(book.getAttribute('aria-label'), label);
      assert.equal(book.hasAttribute(MARKER), false);
      assert.deepEqual(clicks, []);
    });
  }
});

test('arm 만료 — 자동 정리하며 이전 타이머와 disarm은 새 토큰을 지우지 않는다', async () => {
  await withPage(LIST, async ({ doc, timers, arm, run }) => {
    const book = doc.querySelector('.reservbtn');
    book.setAttribute('aria-label', '원래 이름');
    await arm();
    await run('disarm', { token: TOKEN });
    await arm({ token: NEXT_TOKEN });
    timers[0].fn();
    assert.equal(book.getAttribute('aria-label'), `예매 KRS-${NEXT_TOKEN}`);
    assert.equal((await run('disarm', { token: TOKEN })).disarmed, false);
    timers[1].fn();
    assert.equal(book.getAttribute('aria-label'), '원래 이름');
    assert.equal(book.hasAttribute(MARKER), false);
  });
});

test('arm — 기존 표식과 고유 이름 충돌은 덮어쓰지 않는다', async () => {
  for (const extra of [`<span ${MARKER}="기존 페이지 값"></span>`, `<span aria-label="예매 KRS-${TOKEN}"></span>`]) {
    await withPage(LIST + extra, async ({ doc, timers, arm }) => {
      const before = doc.body.innerHTML;
      const result = await arm();
      assert.equal(result.armed, false);
      assert.ok(['arm-busy', 'arm-label-exists'].includes(result.why));
      assert.equal(doc.body.innerHTML, before);
      assert.deepEqual(timers, []);
    });
  }
});

test('disarm — 제거된 버튼은 안전하게 무시하고 페이지가 새로 붙인 이름을 보존한다', async () => {
  await withPage(LIST, async ({ doc, timers, arm, run }) => {
    const book = doc.querySelector('.reservbtn');
    await arm();
    book.setAttribute('aria-label', '페이지가 바꾼 이름');
    await run('disarm', { token: TOKEN });
    assert.equal(book.getAttribute('aria-label'), '페이지가 바꾼 이름');
    await arm({ token: NEXT_TOKEN });
    book.remove();
    assert.equal((await run('disarm', { token: NEXT_TOKEN })).disarmed, false);
    assert.doesNotThrow(() => timers.forEach(({ fn }) => fn()));
  });
});

test('arm 감시 — 사용자 입력과 화면 이동은 즉시 표식을 지우며 실제 클릭의 기본 동작은 막지 않는다', async () => {
  for (const type of ['pointerdown', 'keydown', 'input', 'change', 'click', 'popstate', 'hashchange', 'pagehide']) {
    await withPage(LIST, async ({ dom, doc, timers, arm }) => {
      const book = doc.querySelector('.reservbtn');
      await arm();
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      const target = ['popstate', 'hashchange', 'pagehide'].includes(type) ? dom.window : type === 'click' ? book : doc.querySelector('#startDate');
      let clicked = false;
      book.addEventListener('click', (click) => { clicked = true; assert.equal(click.defaultPrevented, false); });
      assert.equal(target.dispatchEvent(event), true);
      assert.equal(event.defaultPrevented, false);
      assert.equal(book.hasAttribute(MARKER), false, type);
      assert.equal(book.hasAttribute('aria-label'), false, type);
      assert.equal(timers[0].cleared, true);
      assert.equal(clicked, type === 'click');
    });
  }
});

test('arm 감시 — 선택·조건·가격·로딩·안내·버튼 변경은 취소하고 무관한 DOM 변경은 보존한다', async () => {
  const changes = [
    (doc) => doc.querySelector('.gen').classList.remove('active'),
    (doc) => doc.querySelector('#startDate').setAttribute('value', '2026-11-14(토) 14:00'),
    (doc) => doc.querySelector('#labelple').setAttribute('value', '총 2명'),
    (doc) => { doc.querySelector('.gen a').textContent = '일반실 34,000원'; },
    (doc) => doc.body.insertAdjacentHTML('beforeend', '<div id="loadingbar">처리 중</div>'),
    (doc) => doc.body.insertAdjacentHTML('beforeend', '<div role="dialog">새 안내</div>'),
    (doc) => { doc.querySelector('.reservbtn').disabled = true; },
    (doc) => { const book = doc.querySelector('.reservbtn'); book.replaceWith(book.cloneNode(true)); },
  ];
  for (const change of changes) {
    await withPage(LIST, async ({ doc, timers, arm }) => {
      await arm();
      change(doc);
      await Promise.resolve();
      assert.equal(doc.querySelector(`[aria-label="예매 KRS-${TOKEN}"]`), null);
      assert.equal(doc.querySelector(`[${MARKER}]`), null);
      assert.equal(timers[0].cleared, true);
    });
  }
  await withPage(LIST, async ({ doc, arm }) => {
    await arm();
    doc.body.insertAdjacentHTML('beforeend', '<span>다른 안내의 시각 표시</span>');
    await Promise.resolve();
    assert.ok(doc.querySelector(`[aria-label="예매 KRS-${TOKEN}"]`));
  });
});

test('arm 감시 — disarm과 만료 때 observer·입력 감시·타이머를 모두 해제한다', async () => {
  await withPage(LIST, async ({ dom, doc, timers, arm, run }) => {
    const inputs = new Set(['pointerdown', 'keydown', 'input', 'change', 'click', 'visibilitychange']);
    const added = [], removed = [];
    const add = doc.addEventListener.bind(doc), remove = doc.removeEventListener.bind(doc);
    doc.addEventListener = (name, listener, capture) => { if (inputs.has(name)) added.push([name, listener, capture]); add(name, listener, capture); };
    doc.removeEventListener = (name, listener, capture) => { if (inputs.has(name)) removed.push([name, listener, capture]); remove(name, listener, capture); };
    let disconnected = 0;
    const NativeObserver = dom.window.MutationObserver;
    dom.window.MutationObserver = class extends NativeObserver {
      disconnect() { disconnected++; super.disconnect(); }
    };
    await arm();
    await run('disarm', { token: TOKEN });
    assert.equal(disconnected, 1);
    assert.deepEqual(removed, added);
    assert.equal(timers[0].cleared, true);
    await arm({ token: NEXT_TOKEN });
    timers[1].fn();
    assert.equal(disconnected, 2);
    assert.deepEqual(removed, added);
    assert.equal(timers[1].cleared, true);
  });
});

test('settle — 목표를 받으면 자동 완료도 같은 열차·날짜·구간·객실의 상세로 검증한다', async () => {
  await withPage(DETAIL, async ({ run, clicks }) => {
    const matched = await run('settle', TARGET);
    assert.equal(matched.done, true);
    assert.equal(matched.deadline, '2026. 11. 11. 14:07');
    for (const mismatch of [{ no: '334' }, { date: '2026-11-14' }, { from: '서울' }, { dep: '14:45' }, { seat: 'spec' }, { adults: 2 }]) {
      const result = await run('settle', { ...TARGET, ...mismatch });
      assert.deepEqual([result.done, result.why], [false, 'reservation-mismatch']);
    }
    assert.deepEqual(clicks, []);
  }, '/ticket/reservation/detail');
});

test('settle — 상세 로딩이나 남은 안내를 목표 예약 완료로 오인하지 않는다', async () => {
  await withPage('<button>결제하기</button>', async ({ run }) => {
    assert.equal((await run('settle', TARGET)).done, false);
  }, '/ticket/reservation/detail');
  await withPage(DETAIL + '<div role="dialog">안내 <button>확인</button></div>', async ({ doc, run, clicks, timers }) => {
    doc.querySelector('[role=dialog] button').addEventListener('click', (event) => event.target.parentElement.remove());
    const settling = run('settle', TARGET);
    // settle은 passGuard를 먼저 기다리므로 안내의 대기 타이머가 잡힐 때까지 진행한다.
    await Promise.resolve();
    assert.equal(timers[0].ms, 1000);
    assert.deepEqual(clicks, []);
    timers[0].fn();
    assert.equal((await settling).done, false);
    assert.deepEqual(clicks, ['확인']);
    assert.equal((await run('settle', TARGET)).done, true);
  }, '/ticket/reservation/detail');
});
