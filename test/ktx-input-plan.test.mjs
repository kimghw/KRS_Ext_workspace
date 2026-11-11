import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { korailReservePage, korailPopupPage } from '../src/korailreserve.js';
import { korailSeatsPage } from '../src/korailseats.js';
const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

const TARGET = { no: '333', dep: '14:44', from: '대전', to: '부산', date: '2026-11-20', adults: 1, seat: 'gen' };
const LIST_URL = 'https://www.korail.com/ticket/search/list';
const ROW = '<li class="tckList">KTX 333 대전 → 부산(14:44 ~ 16:14)'
  + '<div class="data_box"><h3><span>대전</span><span>부산</span></h3></div>'
  + '<div class="price_box gen"><a href="#none" data-rect="10,20,110,60"><span>일반실 33,000원</span></a></div>'
  + '<div class="price_box"><a href="#none" data-rect="130,20,230,60">특실 46,200원</a></div></li>';
const CONDITIONS = '<input id="labelstart" value="대전"><input id="labelend" value="부산">'
  + '<input id="startDate" value="2026-11-20(금) 14:00"><input id="labelple" value="총 1명">';
const BOOK = '<button class="reservbtn" data-rect="10,100,210,140">예매</button>';
const LIST = `<ul>${ROW}</ul>${CONDITIONS}${BOOK}`;
const selected = (body = LIST) => body.replace('price_box gen', 'price_box gen active');
const modal = (message, label = '확인') => `<div role="dialog">${message}<button data-rect="10,200,110,240">${label}</button></div>`;

async function page(body, callback, url = LIST_URL) {
  const dom = new JSDOM(`<body>${body}</body>`, { url, pretendToBeVisual: true });
  const doc = dom.window.document, clicks = [], scrolls = [];
  dom.window.Element.prototype.getClientRects = function () { return this.isConnected && !this.closest('[hidden], [style*="display: none"]') ? [{}] : []; };
  dom.window.Element.prototype.getBoundingClientRect = function () {
    const [left, top, right, bottom] = (this.getAttribute('data-rect') || '0,0,0,0').split(',').map(Number);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };
  dom.window.Element.prototype.scrollIntoView = function () { scrolls.push(this); };
  doc.elementFromPoint = (x, y) => [...doc.querySelectorAll('[data-rect]')].filter((node) => {
    const r = node.getBoundingClientRect();
    return node.getClientRects().length && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  }).at(-1) || null;
  doc.addEventListener('click', (event) => clicks.push(event.target.textContent), true);
  const saved = Object.fromEntries(['document', 'location', 'getComputedStyle', 'setTimeout'].map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, { document: doc, location: dom.window.location, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    setTimeout: () => { throw new Error('input plans must not sleep'); } });
  const run = (step, opts = {}) => korailReservePage(step, { ...TARGET, ...opts });
  try { return await callback({ dom, doc, run, clicks, scrolls }); }
  finally { Object.assign(globalThis, saved); dom.window.close(); }
}

test('input plan — 일반실 가격과 재검증 키·viewport 좌표만 반환하고 클릭·대기·DOM 변경을 하지 않는다', async () => {
  await page(LIST, async ({ doc, run, clicks, scrolls }) => {
    const before = doc.body.innerHTML;
    const result = await run('pick-input');
    assert.deepEqual({ ...result.plan, key: undefined }, { action: 'seat', key: undefined, point: { x: 60, y: 40 }, seat: '일반실', price: '33,000원', kind: 'gen' });
    assert.equal((await run('pick-input', { expectedKey: result.plan.key })).plan.key, result.plan.key);
    assert.deepEqual(clicks, []);
    assert.equal(scrolls.length, 2);
    assert.equal(doc.body.innerHTML, before);
  });
});

test('input plan — any는 일반실 우선·특실 대체를 지원하고 이미 선택한 객실을 다시 누르지 않는다', async () => {
  await page(LIST.replace('일반실 33,000원', '일반실 매진'), async ({ run }) => {
    assert.equal((await run('pick-input', { seat: 'any' })).plan.kind, 'spec');
    assert.equal((await run('pick-input')).why, 'no-seat');
  });
  for (const [body, seat, kind] of [[selected(), 'gen', 'gen'], [LIST.replace('<div class="price_box">', '<div class="price_box active">'), 'any', 'spec']]) {
    await page(body, async ({ run, clicks }) => {
      const result = await run('pick-input', { seat });
      assert.deepEqual([result.picked, result.ready, result.kind, result.plan], [true, true, kind, undefined]);
      assert.equal((await run('pick-input', { seat, expectedKey: 'old selection' })).why, 'input-changed');
      assert.deepEqual(clicks, []);
    });
  }
});

test('input plan — 다른 선택·중복 열차·조건 변경·누락된 목표를 거부한다', async () => {
  const cases = [
    [LIST + '<div><li class="tckList"><div class="price_box active">다른 열차</div></li></div>', {}, 'selection-mismatch'],
    [LIST.replace('</ul>', ROW + '</ul>'), {}, 'many-rows'],
    [LIST, { no: '999' }, 'no-row'], [LIST, { date: '2026-11-21' }, 'condition-mismatch'],
    [LIST, { adults: 2 }, 'condition-mismatch'], [LIST, { from: '서울' }, 'condition-mismatch'],
    [LIST, { date: undefined }, 'bad-target'], [LIST, { adults: undefined }, 'bad-target'],
  ];
  for (const [body, target, why] of cases) await page(body, async ({ run, clicks }) => {
    const result = await run('pick-input', target);
    assert.equal(result.why, why);
    assert.equal(result.plan, undefined);
    assert.deepEqual(clicks, []);
  });
});

test('input plan — 예매는 같은 선택과 정확한 reservbtn 예매 한 개가 있어야 계획한다', async () => {
  await page(selected(), async ({ run }) => {
    const result = await run('book-input');
    assert.deepEqual([result.plan.action, result.plan.kind, result.plan.point], ['book', 'gen', { x: 110, y: 120 }]);
  });
  for (const [body, why] of [
    [LIST, 'selection-mismatch'], [selected() + BOOK, 'many-book-buttons'],
    [selected().replace('class="reservbtn"', ''), 'no-book-button'],
    [selected().replace('class="reservbtn"', 'class="reservbtn" disabled'), 'book-disabled'],
    [selected().replace('>예매</button>', '>결제하기</button>'), 'no-book-button'],
    [selected() + '<div id="loadingbar">처리 중</div>', 'page-busy'],
    [selected() + modal('이용 안내'), 'modal-open'],
  ]) await page(body, async ({ run, clicks }) => {
    const result = await run('book-input');
    assert.equal(result.why, why);
    assert.equal(result.plan, undefined);
    assert.deepEqual(clicks, []);
  });
});

test('input plan — 가려짐·비활성·숨김·viewport 밖 좌표는 계획하지 않고 자식 hit는 허용한다', async () => {
  await page(LIST, async ({ doc, run }) => {
    doc.elementFromPoint = () => doc.querySelector('.gen a span');
    assert.ok((await run('pick-input')).plan);
    doc.elementFromPoint = () => doc.body;
    assert.equal((await run('pick-input')).why, 'input-obscured');
  });
  for (const [attribute, value] of [['aria-disabled', 'true'], ['hidden', ''], ['data-rect', '-100,-100,-10,-10'], ['data-rect', '10,10,10,20'], ['data-rect', 'NaN,10,20,30']]) {
    await page(LIST, async ({ doc, run, clicks }) => {
      doc.querySelector('.gen a').setAttribute(attribute, value);
      assert.equal((await run('pick-input')).plan, undefined);
      assert.deepEqual(clicks, []);
    });
  }
});

test('input plan — 가격·조건 문구가 바뀌면 expectedKey 재검증을 거부하고 위치만 바뀌면 새 좌표를 돌려준다', async () => {
  for (const mutate of [
    (doc) => { doc.querySelector('.gen a span').textContent = '일반실 34,000원'; },
    (doc) => { doc.querySelector('#labelple').value = '성인 1명'; },
  ]) await page(LIST, async ({ doc, run }) => {
    const previous = await run('pick-input');
    mutate(doc);
    const next = await run('pick-input', { expectedKey: previous.plan.key });
    assert.deepEqual([next.why, next.plan], ['input-changed', undefined]);
  });
  await page(LIST, async ({ doc, run }) => {
    const previous = await run('pick-input');
    doc.querySelector('.gen a').setAttribute('data-rect', '20,20,120,60');
    const next = await run('pick-input', { expectedKey: previous.plan.key });
    assert.equal(next.plan.key, previous.plan.key);
    assert.deepEqual(next.plan.point, { x: 70, y: 40 });
  });
});

test('input plan — 차단은 pick/book에서 건드리지 않고 notice 확인 계획으로만 반환한다', async () => {
  await page(selected() + modal('매크로 CODE : -8002'), async ({ run, clicks }) => {
    for (const step of ['pick-input', 'book-input']) {
      const result = await run(step);
      assert.deepEqual([result.why, result.guard.code, result.plan, result.passed], ['guard', '-8002', undefined, []]);
    }
    const notice = await run('notice-input');
    assert.equal(notice.plan.action, 'notice');
    assert.equal(notice.guard.code, '-8002');
    assert.deepEqual(clicks, []);
  });
});

test('input plan — 진행 네와 일반 확인만 계획하고 결제·취소·환불·반환 질문은 제외한다', async () => {
  await page(LIST + modal('정차역 수가 적습니다. 계속 진행하시겠습니까?', '네'), async ({ run }) => {
    assert.equal((await run('notice-input')).plan.action, 'notice');
  });
  for (const message of ['결제를 계속 진행하시겠습니까?', '예매를 취소하시겠습니까?', '환불 안내 계속 진행하시겠습니까?', '반환 안내 진행하시겠습니까?']) {
    await page(LIST + modal(message, '네') + '<button>결제하기</button>', async ({ run, clicks }) => {
      assert.equal((await run('notice-input')).plan, undefined);
      assert.deepEqual(clicks, []);
    });
  }
});

test('notice input plan — 버튼이 비활성·숨김·제거돼도 같은 안내의 noticeKey를 유지한다', async () => {
  for (const message of ['이용 안내', '매크로 CODE : -8002', '정차역 안내 계속 진행하시겠습니까?']) {
    const label = message.includes('진행') ? '네' : '확인';
    await page(LIST + modal(message, label), async ({ doc, run, clicks }) => {
      const button = doc.querySelector('[role=dialog] button'), node = button.parentElement;
      const first = await run('notice-input');
      assert.ok(first.plan);
      assert.equal(typeof first.noticeKey, 'string');
      button.disabled = true;
      let next = await run('notice-input');
      assert.deepEqual([next.plan, next.noticeKey], [undefined, first.noticeKey]);
      button.disabled = false; button.hidden = true;
      next = await run('notice-input');
      assert.deepEqual([next.plan, next.noticeKey], [undefined, first.noticeKey]);
      button.hidden = false; button.remove();
      next = await run('notice-input');
      assert.deepEqual([next.plan, next.noticeKey], [undefined, first.noticeKey]);
      node.appendChild(button);
      next = await run('notice-input');
      assert.ok(next.plan);
      assert.equal(next.noticeKey, first.noticeKey);
      node.firstChild.textContent = message + ' 새로운 문구';
      assert.notEqual((await run('notice-input')).noticeKey, first.noticeKey);
      assert.deepEqual(clicks, []);
    });
  }
});

test('notice input plan — 예약 상세 프로모션은 창닫기만 계획하고 같은 팝업의 키를 유지한다', async () => {
  const promotion = '<div class="ReactModal__Content" role="dialog"><div class="layerWrap emer_pop">'
    + '<img src="/survey.png" alt="설문 안내"><label><input type="checkbox">1일간 그만보기</label>'
    + '<button data-rect="10,150,210,190">설문 참여하기</button><button data-rect="10,200,110,240">창닫기</button></div></div>';
  await page(promotion, async ({ doc, run, clicks }) => {
    const before = doc.body.innerHTML, first = await run('notice-input');
    assert.deepEqual([first.plan.action, first.plan.point], ['notice', { x: 60, y: 220 }]);
    assert.equal((await run('notice-input', { expectedKey: first.plan.key })).plan.key, first.plan.key);
    assert.equal(doc.body.innerHTML, before);
    assert.equal(doc.querySelector('input').checked, false);
    const close = [...doc.querySelectorAll('button')].find((button) => button.textContent === '창닫기');
    close.disabled = true;
    let current = await run('notice-input');
    assert.deepEqual([current.plan, current.noticeKey], [undefined, first.noticeKey]);
    close.disabled = false;
    close.remove();
    current = await run('notice-input');
    assert.deepEqual([current.plan, current.noticeKey], [undefined, first.noticeKey]);
    doc.querySelector('.emer_pop').appendChild(close);
    doc.querySelector('.emer_pop').appendChild(close.cloneNode(true));
    assert.equal((await run('notice-input')).plan, undefined);
    assert.deepEqual(clicks, []);
  }, 'https://www.korail.com/ticket/reservation/detail');
  await page(promotion.replace('layerWrap emer_pop', 'layerWrap'), async ({ run, clicks }) => {
    assert.equal((await run('notice-input')).plan, undefined);
    assert.deepEqual(clicks, []);
  }, 'https://www.korail.com/ticket/reservation/detail');
});

test('input plan — 정확한 코레일 URL만 허용하고 로그인·결제 페이지는 예약 입력으로 쓰지 않는다', async () => {
  for (const url of ['https://evilkorail.com/ticket/search/list', 'https://www.korail.com.evil.test/ticket/search/list',
    'http://www.korail.com/ticket/search/list', 'https://www.korail.com/ticket/reservation/detail', LIST_URL + '?changed=1']) {
    await page(selected(), async ({ run }) => { assert.equal((await run('book-input')).why, 'wrong-url'); }, url);
  }
  await page(selected(), async ({ run }) => { assert.equal((await run('pick-input')).login, true); }, 'https://www.korail.com/ticket/login');
});

test('popup input plan — 기존 안전 선택을 좌표로만 준비하고 문구·URL·키 변경을 거부한다', async () => {
  await page(modal('이용 안내'), async ({ doc, clicks }) => {
    const first = korailPopupPage({ prepareInput: true });
    assert.equal(first.plan.action, 'notice');
    assert.equal(first.clicked, false);
    assert.ok(korailPopupPage({ prepareInput: true, expectedKey: first.plan.key, expectedWords: first.words, expectedUrl: location.href }).plan);
    assert.equal(korailPopupPage({ prepareInput: true, expectedWords: '이전 안내' }).why, 'input-changed');
    assert.equal(korailPopupPage({ prepareInput: true, expectedUrl: LIST_URL }).why, 'input-changed');
    doc.querySelector('button').setAttribute('data-rect', '30,200,130,240');
    const moved = korailPopupPage({ prepareInput: true, expectedKey: first.plan.key });
    assert.equal(moved.plan.key, first.plan.key);
    assert.deepEqual(moved.plan.point, { x: 80, y: 220 });
    doc.elementFromPoint = () => doc.body;
    assert.equal(korailPopupPage({ prepareInput: true }).why, 'input-obscured');
    assert.deepEqual(clicks, []);
  }, 'https://www.korail.com/popup/notice');
  await page(modal('결제 안내 계속 진행하시겠습니까?', '네'), async ({ clicks }) => {
    assert.equal(korailPopupPage({ prepareInput: true }).plan, undefined);
    assert.deepEqual(clicks, []);
  }, 'https://www.korail.com/popup/notice');
  for (const [message, label] of [['매크로 CODE : -8002', '확인'], ['선택하신 열차를 예매하시겠습니까?', '네']]) {
    await page(modal(message, label), async ({ clicks }) => {
      assert.equal(korailPopupPage({ prepareInput: true }).plan.action, 'notice');
      assert.deepEqual(clicks, []);
    }, 'https://www.korail.com/popup/notice');
  }
});

test('input plan — 직렬화해 독립 함수로 주입해도 외부 함수 없이 계획한다', async () => {
  await page(LIST, async ({ clicks }) => {
    const injected = new Function(`return (${korailReservePage.toString()});`)();
    assert.equal((await injected('pick-input', TARGET)).plan.action, 'seat');
    assert.deepEqual(clicks, []);
  });
});

test('seats observeOnly — 차단·공지·KTX 탭·조회 단추를 누르지 않고 상태만 읽는다', async () => {
  for (const [body, state] of [
    [modal('매크로 CODE : -8002'), 'guard'],
    ['<div class="ReactModalPortal">' + modal('이용 안내', '창닫기') + '</div>', 'modal'],
  ]) await page(body + '<button class="btn_lookup">조회</button><div class="selectAreaWrap"><button class="btn_bn-blue">재조회</button></div>', async ({ clicks }) => {
    const result = await korailSeatsPage('read', { observeOnly: true, waitMs: 0, ktx: true });
    assert.equal(result.state, state);
    assert.equal(result.clicked, false);
    assert.equal(result.guard?.code, state === 'guard' ? '-8002' : undefined);
    for (const step of ['submit', 'requery']) assert.equal((await korailSeatsPage(step, { observeOnly: true })).clicked, false);
    assert.deepEqual(clicks, []);
  });
  await page(LIST + '<ul class="tab_bar"><li><button><div class="korail_logo_tab">KTX</div></button></li></ul>', async ({ clicks }) => {
    globalThis.setTimeout = (callback) => queueMicrotask(callback);
    const result = await korailSeatsPage('read', { observeOnly: true, waitMs: 0, ktx: true });
    assert.equal(result.state, 'rows');
    assert.equal(result.rows.length, 1);
    assert.deepEqual(clicks, []);
  });
});

test('seats observeOnly — 보이는 로그인 링크와 로그아웃 여부 또는 로그인 주소로만 로그인을 알린다', async () => {
  for (const [body, url, login] of [
    ['<a href="/ticket/login">로그인</a>', LIST_URL, true],
    ['<a hidden href="/ticket/login">로그인</a>', LIST_URL, undefined],
    ['<a>로그인</a><a>로그아웃</a>', LIST_URL, undefined],
    ['<a>로그인</a><a hidden>로그아웃</a>', LIST_URL, true],
    ['', 'https://www.korail.com/ticket/login', true],
  ]) await page(body, async ({ clicks }) => {
    assert.equal((await korailSeatsPage('read', { observeOnly: true, waitMs: 0 })).login, login);
    assert.deepEqual(clicks, []);
  }, url);
});
