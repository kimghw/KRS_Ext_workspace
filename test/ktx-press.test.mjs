import test from 'node:test';
import assert from 'node:assert/strict';
import { pressKorailReserve } from '../src/korailpress.js';

const TARGET = { no: '333', dep: '14:44', from: '대전', to: '부산', date: '2026-11-13', adults: 1, seat: 'gen' };
const TOKEN = 'e9855383-b24b-436c-ad33-1be4429c89cd';
const NOW = Date.parse('2026-11-11T05:50:00Z');
const LIST = 'https://www.korail.com/ticket/search/list';

function fixture({ currentWindow = 3, url = LIST, arm, native = { ok: true, pressed: true }, signal, onArm } = {}) {
  const calls = [];
  const tab = { id: 7, windowId: 3, url, status: 'complete', active: false };
  const api = {
    tabs: {
      get: async (id) => { calls.push(['get', id]); return { ...tab }; },
      update: async (id, patch) => { calls.push(['activate', id, patch]); Object.assign(tab, patch); return { ...tab }; },
    },
    windows: {
      getCurrent: async () => ({ id: currentWindow }),
      update: async (id, patch) => { calls.push(['focus', id, patch]); return { id, ...patch }; },
    },
    runtime: {
      sendNativeMessage: async (host, message) => {
        calls.push(['native', host, message]);
        if (typeof native === 'function') return native(host, message);
        if (native instanceof Error) throw native;
        return native;
      },
    },
  };
  const runPage = async (step, opts) => {
    calls.push([step, opts]);
    if (step === 'disarm') return { disarmed: true };
    assert.equal(step, 'arm', '최종 예매 경로에서 DOM rebook이나 임의 페이지 클릭을 호출하지 않는다');
    onArm?.();
    if (arm instanceof Error) throw arm;
    return arm ?? { armed: true, label: `예매 KRS-${opts.token}`, expiresAt: opts.expiresAt, guard: null, said: [], passed: [] };
  };
  const options = { api, tabId: 7, runPage, signal, now: () => NOW, token: () => TOKEN };
  return { calls, api, tab, options, run: (extra = {}) => pressKorailReserve(TARGET, { ...options, ...extra }) };
}

const nativeCalls = (f) => f.calls.filter(([step]) => step === 'native');
const pageSteps = (f) => f.calls.filter(([step]) => ['arm', 'disarm', 'rebook'].includes(step));

test('접근성 예매 — 같은 창의 검증된 버튼을 표시하고 native 입력 한 번 후 표시를 정리한다', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.booked, true);
  assert.notEqual(result.reserved, true, '버튼 입력 성공은 예약 완료 판정이 아니다');
  assert.deepEqual(nativeCalls(f), [['native', 'com.krs.meetingroom', {
    task: 'ktxReservePress', input: { token: TOKEN, expiresAt: NOW + 10000 },
  }]]);
  assert.deepEqual(pageSteps(f), [
    ['arm', { ...TARGET, token: TOKEN, expiresAt: NOW + 10000 }],
    ['disarm', { token: TOKEN }],
  ]);
  const order = f.calls.map(([step]) => step);
  assert.ok(order.indexOf('activate') < order.indexOf('arm'));
  assert.ok(order.indexOf('focus') < order.indexOf('arm'));
  assert.ok(order.indexOf('arm') < order.indexOf('native'));
  assert.ok(order.indexOf('native') < order.indexOf('disarm'));
});

test('접근성 예매 — 브릿지가 없거나 다른 창의 탭이면 버튼을 표시하거나 누르지 않는다', async () => {
  const missing = fixture();
  delete missing.api.runtime.sendNativeMessage;
  const noBridge = await missing.run();
  assert.equal(noBridge.booked, false);
  assert.equal(nativeCalls(missing).length, 0);
  assert.equal(pageSteps(missing).length, 0);

  const other = fixture({ currentWindow: 99 });
  const wrongWindow = await other.run();
  assert.equal(wrongWindow.booked, false);
  assert.equal(nativeCalls(other).length, 0);
  assert.equal(pageSteps(other).length, 0);
  assert.equal(other.calls.some(([step]) => step === 'activate' || step === 'focus'), false);
});

test('접근성 예매 — 다른 주소나 미완료 탭에는 접근성 입력을 보내지 않는다', async () => {
  for (const patch of [
    { url: 'https://evilkorail.com/ticket/search/list' },
    { url: 'https://www.korail.com/ticket/reservation/detail' },
    { status: 'loading' },
    { pendingUrl: 'https://www.korail.com/ticket/search/general' },
  ]) {
    const f = fixture();
    Object.assign(f.tab, patch);
    assert.equal((await f.run()).booked, false);
    assert.equal(nativeCalls(f).length, 0);
    assert.equal(pageSteps(f).length, 0);
  }
});

test('접근성 예매 — 조건·선택 검증 실패 또는 표시 실패이면 native 입력을 보내지 않는다', async () => {
  for (const arm of [{ armed: false, why: 'selection-mismatch' }, { armed: false, why: 'condition-mismatch' }, null, new Error('injection failed')]) {
    const f = fixture({ arm: arm ?? { armed: false } });
    const result = await f.run();
    assert.equal(result.booked, false);
    assert.equal(nativeCalls(f).length, 0);
    assert.equal(f.calls.some(([step]) => step === 'rebook'), false);
  }
});

test('접근성 예매 — native 거절·통신 실패·잘못된 성공 응답에는 재클릭 없이 표시를 정리한다', async () => {
  for (const native of [
    { ok: false, code: 'UIA_NOT_FOUND', error: '표시된 버튼이 없습니다.' },
    new Error('native host disconnected'),
    { ok: true },
    null,
  ]) {
    const f = fixture({ native });
    const result = await f.run();
    assert.equal(result.booked, false);
    assert.equal(nativeCalls(f).length, 1);
    assert.equal(f.calls.filter(([step]) => step === 'disarm').length, 1);
    assert.equal(f.calls.some(([step]) => step === 'rebook'), false);
  }
});

test('접근성 예매 — 버튼 표시 뒤 탭이 바뀌면 native 입력 없이 표시를 정리한다', async () => {
  for (const patch of [{ active: false }, { url: 'https://www.korail.com/ticket/login' }, { windowId: 9 }]) {
    const f = fixture({ onArm: () => Object.assign(f.tab, patch) });
    assert.equal((await f.run()).booked, false);
    assert.equal(nativeCalls(f).length, 0);
    assert.deepEqual(pageSteps(f).map(([step]) => step), ['arm', 'disarm']);
  }
});

test('접근성 예매 — 응답 시간이 지나면 표시를 제거하고 늦게 온 성공에도 재클릭하지 않는다', async () => {
  let resolveNative;
  const f = fixture({ native: () => new Promise((resolve) => { resolveNative = resolve; }) });
  const result = await f.run({ timeoutMs: 5 });
  assert.equal(result.booked, false);
  assert.equal(result.code, 'RESERVE_INPUT_TIMEOUT');
  assert.equal(nativeCalls(f).length, 1);
  assert.deepEqual(pageSteps(f).map(([step]) => step), ['arm', 'disarm']);
  resolveNative({ ok: true, pressed: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nativeCalls(f).length, 1);
  assert.equal(f.calls.some(([step]) => step === 'rebook'), false);
});

test('접근성 예매 — 시작 전 또는 버튼 표시 직후 취소하면 native 입력을 보내지 않는다', async () => {
  const early = new AbortController();
  early.abort();
  const f = fixture({ signal: early.signal });
  assert.equal((await f.run()).booked, false);
  assert.equal(nativeCalls(f).length, 0);
  assert.equal(pageSteps(f).length, 0);

  const later = new AbortController();
  const g = fixture({ signal: later.signal, onArm: () => later.abort() });
  assert.equal((await g.run()).booked, false);
  assert.equal(nativeCalls(g).length, 0);
  assert.equal(g.calls.some(([step]) => step === 'disarm'), true);
});

test('접근성 예매 — native 요청 중 취소하면 표시를 제거하고 진행 중 응답까지 기다린다', async () => {
  const ctrl = new AbortController();
  let resolveNative, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const native = () => new Promise((resolve) => { resolveNative = resolve; entered(); });
  const f = fixture({ signal: ctrl.signal, native });
  let finished = false;
  const pending = f.run().then((result) => { finished = true; return result; });
  await started;
  ctrl.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false, '취소만으로 native 작업이 끝났다고 보고 탭 잠금을 먼저 풀지 않는다');
  assert.equal(f.calls.some(([step]) => step === 'disarm'), true, '취소 시 표시를 제거해 뒤늦은 UIA 입력을 막는다');
  resolveNative({ ok: false, code: 'UIA_NOT_FOUND', error: '취소된 표시입니다.' });
  assert.equal((await pending).booked, false);
  assert.equal(nativeCalls(f).length, 1);
});
