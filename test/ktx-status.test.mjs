// 수동 예매 완료 관찰은 읽기만 하고, 같은 예약 항목의 열차·날짜·구간·출발시각으로 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { korailReservePage } from '../src/korailreserve.js';
const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

const DETAIL = 'https://www.korail.com/ticket/reservation/detail';
const LIST = 'https://www.korail.com/ticket/search/list';
const TARGET = { no: '333', dep: '14:44', from: '대전', to: '부산', date: '2026-11-13', adults: 1, seat: 'gen' };
const PAYMENT = '<div class="btnWrap btnList"><button class="btn_lookup">결제하기</button></div>';
const card = ({ no = '00333', date = '2026년11월13일(금)', from = '대전', to = '부산', dep = '14:44' } = {}) =>
  `<div class="tck_list-wrap"><div class="tit_box type02"><div class="flag_wrap ktx"><span>KTX</span><span class="num">${no}</span><span class="dt">${date}</span></div></div>`
  + `<div class="data_box"><h3 class="txt_bk">${from} → ${to} (${dep} ~ 16:14)</h3><div class="toggle_wrap"><p class="s_txt">일반실 3호차 5A</p></div></div>`
  + '<p class="r_txt">결제기한: 2026. 11. 11. 14:07</p></div>';
const detail = (cards = card(), payment = PAYMENT) => `<div class="reservation_form"><div class="rsv_confirm-wrap">${cards}${payment}</div></div>`;
const conditions = ({ from = '대전', to = '부산', date = '2026-11-13(금) 14:00', people = '총 1명' } = {}) =>
  `<input id="labelstart" value="${from}"><input id="labelend" value="${to}"><input id="startDate" value="${date}"><input id="labelple" value="${people}"><button class="reservbtn">예매</button>`;

async function status(body, { url = DETAIL, target = TARGET } = {}) {
  const dom = new JSDOM(`<body>${body}</body>`, { url, pretendToBeVisual: true });
  const { document } = dom.window;
  dom.window.Element.prototype.getClientRects = function () {
    return this.isConnected && !this.closest('[hidden], [style*="display: none"]') ? [{}] : [];
  };
  const clicks = [];
  document.addEventListener('click', (e) => clicks.push(e.target.textContent.trim()), true);
  const saved = Object.fromEntries(['document', 'location', 'getComputedStyle'].map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, { document, location: dom.window.location, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) });
  try {
    const before = document.body.innerHTML;
    const result = await korailReservePage('status', target);
    assert.deepEqual(clicks, [], 'status는 안내·좌석·예매·결제를 전혀 누르지 않는다');
    assert.equal(document.body.innerHTML, before, 'status는 화면을 변경하지 않는다');
    return result;
  } finally {
    Object.assign(globalThis, saved);
    dom.window.close();
  }
}

test('수동 완료 관찰 — 같은 예약 항목의 번호·날짜·구간·시각과 보이는 결제 버튼으로 완료를 확인한다', async () => {
  const result = await status(detail());
  assert.deepEqual([result.done, result.deadline, result.guard, result.passed, result.said], [true, '2026. 11. 11. 14:07', null, [], []]);
  assert.equal((await status(detail(card({ no: '333', date: '2026년11월13일(금)' })))).done, true);
});

test('수동 완료 관찰 — 다른 열차·날짜·노선·출발시각과 목표 없는 상세는 완료로 알리지 않는다', async () => {
  for (const changed of [{ no: '334' }, { date: '2026년11월14일(토)' }, { from: '서울' }, { to: '울산' }, { dep: '14:45' }]) {
    const result = await status(detail(card(changed)));
    assert.deepEqual([result.done, result.why], [false, 'reservation-mismatch'], JSON.stringify(changed));
  }
  for (const target of [{}, { ...TARGET, date: undefined }, { ...TARGET, from: undefined }]) {
    const result = await status(detail(), { target });
    assert.deepEqual([result.done, result.why], [false, 'reservation-mismatch']);
  }
});

test('수동 완료 관찰 — 여러 카드에 흩어진 조건이나 숨겨진 일치 카드를 합쳐 성공으로 보지 않는다', async () => {
  const mixed = card({ date: '2026년11월14일(토)' }) + card({ no: '334' });
  assert.equal((await status(detail(mixed))).why, 'reservation-mismatch');
  const hidden = `<div hidden>${card()}</div>${card({ no: '334' })}`;
  assert.equal((await status(detail(hidden))).why, 'reservation-mismatch');
  assert.equal((await status(detail(card() + card()))).why, 'reservation-mismatch', '같은 목표가 두 카드면 하나로 확정하지 않는다');
});

test('수동 완료 관찰 — 객실이 바뀌었거나 명시된 좌석 수가 다르면 이전 객실·가격으로 성공을 알리지 않는다', async () => {
  const special = detail(card().replace('일반실 3호차 5A', '특실 3호차 5A'));
  assert.equal((await status(special)).why, 'reservation-mismatch');
  assert.equal((await status(special, { target: { ...TARGET, seat: 'spec' } })).done, true);
  assert.equal((await status(detail(), { target: { ...TARGET, adults: 2 } })).why, 'reservation-mismatch');
  const two = detail(card().replace('일반실 3호차 5A', '일반실 3호차 5A 외 1석(총 2석)'));
  assert.equal((await status(two)).why, 'reservation-mismatch');
  assert.equal((await status(two, { target: { ...TARGET, adults: 2 } })).done, true);
  const unclear = detail(card().replace('일반실 3호차 5A', '일반실 좌석 정보'));
  assert.equal((await status(unclear, { target: { ...TARGET, adults: 2 } })).done, true, '불명확한 좌석 수를 추정하지 않는다');
});

test('수동 완료 관찰 — 로딩·예약내역·안내 글·숨겨진 결제 버튼은 완료가 아니다', async () => {
  for (const body of [detail('', ''), detail('', PAYMENT), detail(card(), ''), detail(card(), '<p>결제하기를 눌러 주세요</p>'), detail(card(), `<div hidden>${PAYMENT}</div>`)]) {
    const result = await status(body);
    assert.deepEqual([result.done, result.why], [false, undefined]);
  }
  assert.equal((await status(detail(), { url: 'https://www.korail.com/ticket/reservation/list' })).done, false);
});

test('수동 완료 관찰 — 차단 확인·일반 확인·진행 확인을 누르지 않고 사용자에게 맡긴다', async () => {
  const guard = '<div class="ReactModal__Content">매크로 이용 제한 -8002 <button>확인</button></div>';
  let result = await status(detail() + guard);
  assert.deepEqual([result.done, result.guard.code, result.passed], [false, '-8002', []]);
  result = await status(detail() + '<div role="dialog">계속 진행하시겠습니까? <button>네</button><button>확인</button><button>창닫기</button></div>');
  assert.equal(result.done, false);
  assert.match(result.said[0], /계속 진행/);
  result = await status(conditions() + guard, { url: LIST });
  assert.equal(result.guard.code, '-8002');
});

test('수동 완료 관찰 — 로그인과 목록의 실제 조건 변경을 읽으며 로딩 중에는 기다린다', async () => {
  const login = await status('<button>로그인</button>', { url: 'https://www.korail.com/ticket/login' });
  assert.deepEqual([login.done, login.login], [false, true]);
  const same = await status(conditions(), { url: LIST });
  assert.deepEqual([same.done, same.list, same.why], [false, true, undefined]);
  for (const changed of [{ from: '서울' }, { to: '울산' }, { date: '2026-11-14(토) 14:00' }, { people: '총 2명' }]) {
    const result = await status(conditions(changed), { url: LIST });
    assert.deepEqual([result.done, result.list, result.why], [false, true, 'condition-mismatch']);
  }
  const loading = await status('<p>조회 중</p>', { url: LIST });
  assert.deepEqual([loading.done, loading.list, loading.why], [false, true, undefined]);
});
