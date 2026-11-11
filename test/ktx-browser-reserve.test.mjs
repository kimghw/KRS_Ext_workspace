import test from 'node:test';
import assert from 'node:assert/strict';
import { ktxReserve, KORAIL_LIST } from '../src/ktx.js';
import { korailSeatsPage } from '../src/korailseats.js';
import { korailReservePage, korailPopupPage } from '../src/korailreserve.js';

const TARGET = { from: '대전', to: '부산', date: '2026-11-20', hour: 14, adults: 1, train: '333', dep: '14:44', seat: 'gen' };
const COND = { from: '대전', to: '부산', date: '2026-11-20(금) 14:00', people: '총 1명' };
const SEAT = { seat: '일반실', price: '33,000원', kind: 'gen' };
const GUARD = { code: '-8002', message: '매크로 사용으로 제한되었습니다.' };
const POPUP_URL = 'https://www.korail.com/popup/notice';

function eventSource() {
  const listeners = new Set();
  return { addListener: (listener) => listeners.add(listener), removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => { for (const listener of listeners) listener(...args); }, size: () => listeners.size };
}

/** Model browser-visible state and real input delivery independently of DOM plans. */
function browserReserve({ selected = false, noticeAfter = null, popupAfter = null, guardAfterBook = false, initialGuard = false, login = false,
  failAttach = false, failInput = null, failAction = 'seat', onClick = () => {}, onWait = () => {}, manualDone = false,
  lateNoticeInReady = false, statusInterruptions = 0, popupCloseDetaches = false,
  noticeStaysOpen = false, noticeReadInterruptions = 0, promotionAfterBook = false } = {}) {
  const events = [], clicks = [], detachEvents = eventSource(), debuggerEvents = eventSource();
  let clock = 0, booked = false, notice = false, popup = false, guard = initialGuard, guardClosed = false;
  let lateNoticeShown = false, noticeClickSeen = false;
  const tab = { id: 7, windowId: 3, url: KORAIL_LIST, status: 'complete' };
  const popupTab = { id: 9, windowId: 3, openerTabId: 7, url: POPUP_URL, status: 'complete' };
  const record = (type, extra = {}) => { const event = { type, time: clock, ...extra }; events.push(event); return event; };
  const answer = (result) => [{ result }];
  const plan = (action, popupPlan = false) => ({ action, key: `${popupPlan ? 'popup' : action}-same`,
    point: { x: popupPlan ? 400 : action === 'seat' ? 100 : action === 'book' ? 200 : 300, y: 100 },
    ...(action === 'seat' ? SEAT : {}) });
  const noticeResult = (popupPlan = false) => ({ url: popupPlan ? POPUP_URL : tab.url,
    words: guard ? GUARD.message : promotionAfterBook ? '1일간 그만보기 설문 참여하기 창닫기' : '이용안내 — 계속 진행하시겠습니까?', actionable: true, clicked: false,
    ...(guard ? { guard: GUARD } : {}),
    ...(promotionAfterBook ? { noticeKey: 'survey-promotion-close' } : {}), plan: plan('notice', popupPlan) });
  const currentStatus = () => {
    if (guard) return { done: false, guard: GUARD };
    if (booked && !notice && !popup && (!guardClosed || manualDone)) {
      return { done: true, deadline: '2026.11.11 15:55', seat: SEAT.seat, price: SEAT.price };
    }
    return { done: false, list: true, said: notice ? ['이용안내 — 계속 진행하시겠습니까?'] : [] };
  };
  const api = {
    tabs: {
      get: async (id) => { record('get', { tabId: id }); if (id === 7) return { ...tab }; if (id === 9 && popup) return { ...popupTab }; throw new Error('No tab'); },
      query: async () => { record('query'); return popup ? [{ ...popupTab }, { id: 10, openerTabId: 88, url: POPUP_URL }] : []; },
      update: async (id, options) => { record('update', { tabId: id, options }); return { ...tab }; },
      reload: async () => { record('reload'); throw new Error('Reservation must not reload'); },
    },
    windows: { update: async () => {} },
    runtime: { sendNativeMessage: async () => { record('native-fallback'); throw new Error('No native fallback after browser input'); } },
    debugger: {
      onDetach: detachEvents, onEvent: debuggerEvents,
      attach: async ({ tabId }, version) => { record('attach', { tabId, version }); if (failAttach) throw new Error('Debugger permission denied'); },
      detach: async ({ tabId }) => { record('detach', { tabId }); },
      sendCommand: async ({ tabId }, method, params) => {
        record('command', { tabId, method, params });
        assert.equal(method, 'Input.dispatchMouseEvent', 'Only visible UI mouse input is sent');
        const action = params.x === 100 ? 'seat' : params.x === 200 ? 'book' : params.x === 300 ? 'notice' : params.x === 400 ? 'popup' : 'unexpected';
        const responseLost = params.type === failInput && action === failAction;
        if (params.type !== 'mouseReleased') {
          if (responseLost) throw new Error('Input delivery response lost');
          return {};
        }
        assert.notEqual(action, 'unexpected', 'No payment or arbitrary coordinate is clicked');
        clicks.push(action); record('click', { tabId, action });
        if (action === 'seat') { selected = !selected; notice ||= noticeAfter === 'seat'; popup ||= popupAfter === 'seat'; }
        if (action === 'book') {
          booked = true; notice ||= noticeAfter === 'book' || promotionAfterBook; popup ||= popupAfter === 'book'; guard ||= guardAfterBook;
          if (promotionAfterBook) tab.url = 'https://www.korail.com/ticket/reservation/detail';
        }
        if (action === 'notice') {
          noticeClickSeen = true;
          if (!noticeStaysOpen) notice = false;
          if (guard) { guard = false; guardClosed = booked; }
        }
        if (action === 'popup') {
          popup = false;
          if (popupCloseDetaches) detachEvents.emit({ tabId }, 'target_closed');
        }
        onClick(action);
        if (responseLost) throw new Error('Input was delivered but its response was lost');
        return {};
      },
    },
    scripting: { executeScript: async ({ target, func, args }) => {
      const step = func === korailSeatsPage ? `seats:${args[0]}` : func === korailPopupPage ? 'popup-plan' : args[0];
      record('page', { step, tabId: target.tabId, options: func === korailPopupPage ? args[0] : args[1] });
      if (func === korailSeatsPage) return answer({ url: tab.url, state: 'rows', cond: COND, rows: [], guard: guard ? GUARD : null, ...(login ? { login: true } : {}) });
      if (func === korailPopupPage) {
        assert.equal(target.tabId, 9, 'Only the result tab own popup may be handled');
        assert.ok(args[0]?.observeOnly || args[0]?.prepareInput, 'Popup DOM clicking is forbidden');
        return answer(popup ? noticeResult(true) : { words: '', actionable: false, clicked: false });
      }
      assert.equal(func, korailReservePage);
      if (['pick', 'rebook', 'arm', 'settle'].includes(step)) {
        record('dom-fallback', { step }); throw new Error(`Forbidden mutating DOM step: ${step}`);
      }
      if (step === 'status') {
        if (booked && statusInterruptions-- > 0) throw new Error('Frame with ID 0 was removed');
        return answer({ url: tab.url, guard: null, ...currentStatus() });
      }
      if (step === 'notice-input') {
        if (noticeClickSeen && noticeReadInterruptions-- > 0) throw new Error('One transient notice inspection failure');
        return answer(notice || guard ? noticeResult() : { why: 'notice-unavailable' });
      }
      if (step === 'pick-input') return answer(guard ? { why: 'guard', guard: GUARD }
        : notice ? { why: 'modal-open' }
          : selected ? { picked: true, ready: true, ...SEAT } : { url: tab.url, plan: plan('seat') });
      if (step === 'ready') {
        if (lateNoticeInReady && !lateNoticeShown) { notice = true; lateNoticeShown = true; }
        return answer(notice || popup ? { ready: false, why: 'modal-open' }
          : { ready: selected, key: 'same-selected-train', ...SEAT });
      }
      if (step === 'book-input') return answer(selected && !notice && !popup ? { url: tab.url, plan: plan('book') }
        : { why: 'selection-mismatch' });
      throw new Error(`Unexpected page step: ${step}`);
    } },
  };
  const wait = async (ms) => { record('wait', { ms }); clock += ms; await onWait(ms, events); };
  const run = (options = {}) => ktxReserve(TARGET, { api, tabId: 7, wait, tries: 5, readyTries: 8, manualTries: 2,
    onStage: (message) => record('stage', { message }), ...options });
  const assertNoFallback = () => {
    assert.deepEqual(events.filter((event) => ['native-fallback', 'dom-fallback', 'reload'].includes(event.type)), []);
    assert.equal(detachEvents.size(), 0, 'Debugger detach listener is cleaned up');
  };
  return { api, events, clicks, run, assertNoFallback };
}

test('브라우저 입력 — 가격 1회, 같은 ready 2회, 예매 1회 후 정확한 예약 상태를 확인한다', async () => {
  const fixture = browserReserve();
  const result = await fixture.run();
  assert.equal(result.reserved, true);
  assert.deepEqual([result.seat, result.price], ['일반실', '33,000원']);
  assert.deepEqual(fixture.clicks, ['seat', 'book']);
  const order = fixture.events.filter((event) => event.type === 'click' || event.type === 'page' && ['ready', 'status'].includes(event.step));
  const seat = order.findIndex((event) => event.action === 'seat');
  const book = order.findIndex((event) => event.action === 'book');
  assert.deepEqual(order.slice(seat + 1, book).filter((event) => event.step === 'ready').map((event) => event.step), ['ready', 'ready']);
  assert.ok(order.slice(book + 1).some((event) => event.step === 'status'));
  assert.equal(fixture.events.filter((event) => event.type === 'command' && event.params.type === 'mousePressed').length, 2);
  fixture.assertNoFallback();
});

test('브라우저 입력 — 같은 가격이 이미 선택되어 있으면 다시 누르지 않는다', async () => {
  const fixture = browserReserve({ selected: true });
  assert.equal((await fixture.run()).reserved, true);
  assert.deepEqual(fixture.clicks, ['book']);
  fixture.assertNoFallback();
});

test('브라우저 입력 — 처음부터 열린 제한 안내도 읽기 전용 조회 후 브라우저 입력으로 확인한다', async () => {
  const fixture = browserReserve({ initialGuard: true });
  const result = await fixture.run();
  assert.equal(result.reserved, true);
  assert.deepEqual(fixture.clicks, ['notice', 'seat', 'book']);
  const reads = fixture.events.filter((event) => event.type === 'page' && event.step === 'seats:read');
  assert.ok(reads.length >= 2, 'Conditions are read again after the initial notice closes');
  assert.ok(reads.every((event) => event.options?.observeOnly === true), 'Initial reads must not click notices or filters in the DOM');
  const detected = fixture.events.findIndex((event) => event.type === 'page' && event.step === 'notice-input');
  const clicked = fixture.events.findIndex((event) => event.type === 'click' && event.action === 'notice');
  assert.ok(detected >= 0 && clicked > detected);
  assert.ok(fixture.events.slice(detected + 1, clicked).some((event) => event.type === 'wait' && event.ms >= 1000));
  fixture.assertNoFallback();
});

test('브라우저 입력 — 초기 읽기에서 로그인 필요를 알면 가격과 예매를 누르지 않는다', async () => {
  const fixture = browserReserve({ login: true });
  const result = await fixture.run();
  assert.equal(result.code, 'RESERVE_LOGIN');
  assert.deepEqual(fixture.clicks, []);
  assert.deepEqual(fixture.events.filter((event) => event.type === 'attach'), []);
  assert.deepEqual(fixture.events.filter((event) => event.type === 'page' && ['pick-input', 'book-input'].includes(event.step)), []);
  assert.ok(fixture.events.find((event) => event.type === 'page' && event.step === 'seats:read')?.options?.observeOnly);
  fixture.assertNoFallback();
});

for (const moment of ['seat', 'book']) {
  test(`브라우저 입력 — ${moment} 뒤 본문 안내를 발견한 뒤 1초 기다리고 한 번만 확인한다`, async () => {
    const fixture = browserReserve({ noticeAfter: moment });
    assert.equal((await fixture.run()).reserved, true);
    assert.equal(fixture.clicks.filter((action) => action === 'notice').length, 1);
    const first = fixture.events.findIndex((event) => event.type === 'page' && event.step === 'notice-input'
      && fixture.events.slice(0, fixture.events.indexOf(event)).some((before) => before.type === 'click' && before.action === moment));
    const clicked = fixture.events.findIndex((event) => event.type === 'click' && event.action === 'notice');
    assert.ok(first >= 0 && clicked > first);
    assert.ok(fixture.events.slice(first + 1, clicked).some((event) => event.type === 'wait' && event.ms >= 1000), 'The reading interval starts after discovery');
    assert.ok(fixture.events[clicked].time - fixture.events[first].time >= 1000);
    fixture.assertNoFallback();
  });
}

test('브라우저 입력 — 별도 안내 창도 발견 후 1초 기다리고 그 창만 한 번 확인한다', async () => {
  const fixture = browserReserve({ popupAfter: 'seat' });
  assert.equal((await fixture.run()).reserved, true);
  assert.deepEqual(fixture.clicks, ['seat', 'popup', 'book']);
  const first = fixture.events.findIndex((event) => event.type === 'page' && event.step === 'popup-plan');
  const clicked = fixture.events.findIndex((event) => event.type === 'click' && event.action === 'popup');
  assert.ok(fixture.events.slice(first + 1, clicked).some((event) => event.type === 'wait' && event.ms >= 1000));
  assert.equal(fixture.events[clicked].tabId, 9);
  fixture.assertNoFallback();
});

test('브라우저 입력 — 예약 상세의 설문 홍보 창닫기를 1초 뒤 한 번 누르고 기존 예약을 완료로 확인한다', async () => {
  const fixture = browserReserve({ promotionAfterBook: true });
  const result = await fixture.run();
  assert.equal(result.reserved, true);
  assert.deepEqual(fixture.clicks, ['seat', 'book', 'notice'], 'Closing the promotion must not make another booking or payment');
  const book = fixture.events.findIndex((event) => event.type === 'click' && event.action === 'book');
  const detected = fixture.events.findIndex((event, index) => index > book && event.type === 'page' && event.step === 'notice-input');
  const closed = fixture.events.findIndex((event) => event.type === 'click' && event.action === 'notice');
  assert.ok(detected > book && closed > detected);
  assert.ok(fixture.events.slice(detected + 1, closed).some((event) => event.type === 'wait' && event.ms >= 1000));
  assert.ok(fixture.events[closed].time - fixture.events[detected].time >= 1000);
  assert.ok(fixture.events.slice(closed + 1).some((event) => event.type === 'page' && event.step === 'status'));
  fixture.assertNoFallback();
});

test('브라우저 입력 — 준비 확인 중 늦게 뜬 본문 안내를 확인하고 안정 상태를 다시 두 번 읽는다', async () => {
  const fixture = browserReserve({ lateNoticeInReady: true });
  assert.equal((await fixture.run()).reserved, true);
  assert.deepEqual(fixture.clicks, ['seat', 'notice', 'book']);
  const notice = fixture.events.findIndex((event) => event.type === 'click' && event.action === 'notice');
  const book = fixture.events.findIndex((event) => event.type === 'click' && event.action === 'book');
  assert.equal(fixture.events.slice(notice + 1, book).filter((event) => event.type === 'page' && event.step === 'ready').length, 2);
  fixture.assertNoFallback();
});

test('브라우저 입력 — 예매 후 문서 전환으로 상태 읽기 한 번이 실패해도 다음 관찰에서 예약을 확인한다', async () => {
  const fixture = browserReserve({ statusInterruptions: 1 });
  assert.equal((await fixture.run()).reserved, true);
  assert.deepEqual(fixture.clicks, ['seat', 'book']);
  const book = fixture.events.findIndex((event) => event.type === 'click' && event.action === 'book');
  assert.ok(fixture.events.slice(book + 1).filter((event) => event.type === 'page' && event.step === 'status').length >= 2);
  fixture.assertNoFallback();
});

test('브라우저 입력 — 확인 클릭으로 팝업이 닫혀 debugger가 끊겨도 재클릭 없이 예매로 이어 간다', async () => {
  const fixture = browserReserve({ popupAfter: 'seat', popupCloseDetaches: true });
  assert.equal((await fixture.run()).reserved, true);
  assert.deepEqual(fixture.clicks, ['seat', 'popup', 'book']);
  assert.equal(fixture.events.filter((event) => event.type === 'command' && event.tabId === 9 && event.params.type === 'mousePressed').length, 1);
  fixture.assertNoFallback();
});

test('브라우저 입력 — 안내 닫힘 관찰이 한 번 실패해도 같은 안내를 다시 확인하지 않는다', async () => {
  const fixture = browserReserve({ noticeAfter: 'book', noticeStaysOpen: true, noticeReadInterruptions: 1 });
  const result = await fixture.run();
  assert.equal(result.code, 'RESERVE_UNCONFIRMED');
  assert.deepEqual(fixture.clicks, ['seat', 'book', 'notice']);
  fixture.assertNoFallback();
});

test('브라우저 입력 — 닫히지 않은 안내의 최종 상태 읽기가 실패해도 확인을 반복하지 않는다', async () => {
  const fixture = browserReserve({ noticeAfter: 'book', noticeStaysOpen: true });
  const execute = fixture.api.scripting.executeScript;
  let interrupted = false;
  fixture.api.scripting.executeScript = async (request) => {
    if (!interrupted && fixture.clicks.includes('notice') && request.func === korailReservePage && request.args[0] === 'status') {
      interrupted = true;
      throw new Error('Transient final status failure');
    }
    return execute(request);
  };
  const result = await fixture.run();
  assert.equal(result.code, 'RESERVE_UNCONFIRMED');
  assert.deepEqual(fixture.clicks, ['seat', 'book', 'notice']);
  fixture.assertNoFallback();
});

test('브라우저 입력 — 가격 클릭 뒤 취소하면 예매 입력을 보내지 않는다', async () => {
  const controller = new AbortController();
  const fixture = browserReserve({ onClick: (action) => { if (action === 'seat') controller.abort(); } });
  assert.equal((await fixture.run({ signal: controller.signal })).code, 'RESERVE_CANCELLED');
  assert.deepEqual(fixture.clicks, ['seat']);
  fixture.assertNoFallback();
});

for (const [name, options] of [
  ['연결 실패', { failAttach: true }],
  ['누름 실패', { failInput: 'mousePressed' }],
  ['놓음 응답 불명', { failInput: 'mouseReleased' }],
]) {
  test(`브라우저 입력 — ${name} 뒤 DOM 또는 UIA로 자동 재시도하지 않는다`, async () => {
    const fixture = browserReserve(options);
    const result = await fixture.run();
    assert.equal(result.ok, false);
    assert.equal(result.reserved, undefined);
    assert.ok(fixture.clicks.length <= 1 && fixture.clicks.every((action) => action === 'seat'), 'An uncertain price click never advances to booking');
    assert.ok(fixture.events.filter((event) => event.type === 'command' && event.params.type === 'mousePressed').length <= 1);
    fixture.assertNoFallback();
  });
}

for (const failInput of ['mousePressed', 'mouseReleased']) {
  test(`브라우저 입력 — 예매 ${failInput} 응답이 불명이어도 예매를 다시 누르지 않는다`, async () => {
    const fixture = browserReserve({ failInput, failAction: 'book' });
    const result = await fixture.run();
    assert.equal(result.code, 'RESERVE_INPUT_UNCONFIRMED');
    assert.equal(result.reserved, undefined, 'Input delivery alone is not confirmed reservation');
    assert.deepEqual(fixture.clicks, ['seat', 'book']);
    assert.equal(fixture.events.filter((event) => event.type === 'command' && event.params.type === 'mousePressed' && event.params.x === 200).length, 1);
    fixture.assertNoFallback();
  });
}

test('브라우저 입력 — 예매 뒤 매크로 안내는 한 번 확인한 뒤 화면 관찰만 한다', async () => {
  const fixture = browserReserve({ guardAfterBook: true });
  const result = await fixture.run();
  assert.equal(result.code, 'RESERVE_MANUAL_REQUIRED');
  assert.equal(result.manual, true);
  assert.deepEqual(fixture.clicks, ['seat', 'book', 'notice']);
  const observing = fixture.events.findIndex((event) => event.type === 'stage' && event.message.includes('자동 예매가 제한'));
  assert.ok(observing >= 0);
  const remaining = fixture.events.slice(observing + 1);
  assert.ok(remaining.some((event) => event.type === 'page' && event.step === 'status'));
  assert.deepEqual(remaining.filter((event) => event.type === 'page' && event.step !== 'status'), []);
  fixture.assertNoFallback();
});
