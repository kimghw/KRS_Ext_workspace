import test from 'node:test';
import assert from 'node:assert/strict';
import { clickKorailInput } from '../src/korailinput.js';

const LIST = 'https://www.korail.com/ticket/search/list';
const PLAN = { action: 'book', key: '333|gen|33000', point: { x: 321.5, y: 456.25 }, seat: 'gen', price: 33000, kind: 'reserve' };
const plan = (patch = {}) => ({ plan: { ...PLAN, point: { ...PLAN.point }, ...patch }, ready: true });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(options = {}) {
  const calls = [], listeners = new Set();
  const tab = { id: 7, url: LIST, status: 'complete', ...options.tab };
  let preparation = 0, waits = 0, gets = 0;
  const api = {
    tabs: { get: async (id) => {
      calls.push(['get', id]);
      options.onGet?.(++gets, tab);
      return { ...tab };
    } },
    debugger: {
      onDetach: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
      attach: async (...args) => {
        calls.push(['attach', ...args]);
        return options.attach?.(...args);
      },
      sendCommand: async (...args) => {
        calls.push(['send', ...args]);
        return options.send?.(...args);
      },
      detach: async (...args) => {
        calls.push(['detach', ...args]);
        return options.detach?.(...args);
      },
    },
  };
  const prepare = async (key) => {
    calls.push(['prepare', key]);
    return options.prepare ? options.prepare(++preparation, key) : plan();
  };
  const wait = async (ms) => {
    calls.push(['wait', ms]);
    return options.wait?.(++waits, ms);
  };
  return {
    api, tab, calls, listeners,
    detached: (source = { tabId: 7 }) => { for (const listener of [...listeners]) listener(source, 'canceled_by_user'); },
    run: (extra = {}) => clickKorailInput({ api, tabId: 7, prepare, wait, ...extra }),
  };
}
const commands = (f) => f.calls.filter(([name]) => name === 'send');
const types = (f) => commands(f).map(([, , , event]) => event.type);
const count = (f, name) => f.calls.filter(([entry]) => entry === name).length;

test('브라우저 입력 — 연결 후 대상을 재확인하고 move/down/up 한 번 뒤 자기 세션을 정리한다', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.clicked, true);
  assert.notEqual(result.reserved, true);
  assert.deepEqual(result.plan, PLAN);
  assert.deepEqual(f.calls.filter(([name]) => name === 'attach'), [['attach', { tabId: 7 }, '1.3']]);
  assert.deepEqual(f.calls.filter(([name]) => name === 'prepare'), [
    ['prepare', undefined], ['prepare', PLAN.key], ['prepare', PLAN.key],
  ]);
  assert.deepEqual(f.calls.filter(([name]) => name === 'wait'), [['wait', 100], ['wait', 100]]);
  assert.deepEqual(commands(f), [
    ['send', { tabId: 7 }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...PLAN.point, button: 'none', buttons: 0 }],
    ['send', { tabId: 7 }, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...PLAN.point, button: 'left', buttons: 1, clickCount: 1 }],
    ['send', { tabId: 7 }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...PLAN.point, button: 'left', buttons: 0, clickCount: 1 }],
  ]);
  assert.deepEqual(f.calls.filter(([name]) => name === 'detach'), [['detach', { tabId: 7 }]]);
  assert.equal(f.listeners.size, 0);
  assert.deepEqual(f.calls.map(([name]) => name), [
    'get', 'prepare', 'attach', 'wait', 'prepare', 'get', 'send', 'wait', 'prepare', 'get', 'send', 'send', 'detach',
  ]);
});

test('브라우저 입력 — attach 배너 뒤 좌표를 새로 읽고 CSS 소수 좌표를 그대로 사용한다', async () => {
  const point = { x: 123.75, y: 234.5 };
  const f = fixture({ prepare: (n) => plan(n === 1 ? {} : { point }) });
  assert.equal((await f.run()).clicked, true);
  assert.equal(commands(f).every(([, , , event]) => event.x === point.x && event.y === point.y), true);
});

test('브라우저 입력 — 어느 준비 단계든 plan이 없으면 결과를 그대로 반환한다', async () => {
  for (const stopAt of [1, 2, 3]) {
    const unchanged = { ready: true, why: 'already-selected' };
    const f = fixture({ prepare: (n) => n === stopAt ? unchanged : plan() });
    if (stopAt === 1) delete f.api.debugger;
    assert.equal(await f.run(), unchanged);
    assert.equal(count(f, 'attach'), stopAt === 1 ? 0 : 1);
    assert.deepEqual(types(f), stopAt === 3 ? ['mouseMoved'] : []);
    assert.equal(count(f, 'detach'), stopAt === 1 ? 0 : 1);
    assert.equal(f.listeners.size, 0);
  }
});

test('브라우저 입력 — 잘못된 action/key/좌표에는 연결하지 않는다', async () => {
  for (const patch of [
    { action: 'arbitrary' }, { key: '' }, { key: 333 }, { point: { x: NaN, y: 2 } },
    { point: { x: 2, y: Infinity } }, { point: { x: -1, y: 2 } }, { point: null },
  ]) {
    const f = fixture({ prepare: () => plan(patch) });
    assert.equal((await f.run()).code, 'RESERVE_INPUT_INVALID');
    assert.equal(count(f, 'attach'), 0);
    assert.equal(commands(f).length, 0);
  }
});

test('브라우저 입력 — attach 또는 move 뒤 key/action이 바뀌면 누르지 않는다', async () => {
  for (const [at, patch] of [
    [2, { key: 'other-train' }], [2, { action: 'seat' }], [3, { key: 'other-price' }],
    [3, { action: 'notice' }],
  ]) {
    const f = fixture({ prepare: (n) => plan(n === at ? patch : {}) });
    assert.equal((await f.run()).code, 'RESERVE_INPUT_CHANGED');
    assert.deepEqual(types(f), at === 2 ? [] : ['mouseMoved']);
    assert.equal(count(f, 'detach'), 1);
  }
});

test('브라우저 입력 — 배너가 늦게 좌표를 바꾸면 새 위치로 이동해 안정된 뒤 한 번만 누른다', async () => {
  const before = { x: 321.5, y: 630.7421875 }, after = { x: 321.5, y: 602.7421875 };
  const f = fixture({ prepare: (n) => plan({ point: n <= 2 ? before : after }) });
  assert.equal((await f.run()).clicked, true);
  assert.deepEqual(types(f), ['mouseMoved', 'mouseMoved', 'mousePressed', 'mouseReleased']);
  assert.deepEqual(commands(f).map(([, , , event]) => ({ x: event.x, y: event.y })), [before, after, after, after]);
  assert.deepEqual(f.calls.filter(([name]) => name === 'wait'), [['wait', 100], ['wait', 100], ['wait', 100]]);
  assert.equal(count(f, 'prepare'), 4);
  assert.equal(count(f, 'detach'), 1);
});

test('브라우저 입력 — 좌표가 계속 움직이면 최대 6번 확인 후 press 없이 중단한다', async () => {
  const f = fixture({ prepare: (n) => plan({ point: { x: 321.5, y: 630.75 - n } }) });
  const result = await f.run();
  assert.equal(result.code, 'RESERVE_INPUT_CHANGED');
  assert.equal(result.why, 'point-unstable');
  assert.deepEqual(types(f), Array(6).fill('mouseMoved'));
  assert.equal(count(f, 'prepare'), 8);
  assert.equal(count(f, 'detach'), 1);
});

test('브라우저 입력 — 좌표 안정화 중에도 key/action이 바뀌면 즉시 중단한다', async () => {
  for (const patch of [{ key: 'changed-train' }, { action: 'notice' }]) {
    const f = fixture({ prepare: (n) => plan({
      point: { ...PLAN.point, y: n >= 3 ? PLAN.point.y - 28 : PLAN.point.y },
      ...(n >= 4 ? patch : {}),
    }) });
    assert.equal((await f.run()).code, 'RESERVE_INPUT_CHANGED');
    assert.deepEqual(types(f), ['mouseMoved', 'mouseMoved']);
    assert.equal(count(f, 'prepare'), 4);
    assert.equal(count(f, 'detach'), 1);
  }
});

test('브라우저 입력 — 좌표 재확인 대기 중 취소하면 press 없이 정리한다', async () => {
  const ctrl = new AbortController();
  const f = fixture({
    prepare: (n) => plan({ point: { ...PLAN.point, y: n >= 3 ? PLAN.point.y - 28 : PLAN.point.y } }),
    wait: (n) => { if (n === 3) ctrl.abort(); },
  });
  assert.equal((await f.run({ signal: ctrl.signal })).code, 'RESERVE_CANCELLED');
  assert.deepEqual(types(f), ['mouseMoved', 'mouseMoved']);
  assert.equal(count(f, 'detach'), 1);
});

test('브라우저 입력 — HTTPS 코레일 도메인 경계와 완료 상태를 검사한다', async () => {
  for (const tab of [
    { url: 'http://www.korail.com/ticket/search/list' },
    { url: 'https://evilkorail.com/ticket/search/list' },
    { url: 'https://www.korail.com.evil.test/ticket/search/list' },
    { url: 'https://www.korail.com@evil.test/ticket/search/list' },
    { url: 'not a url' }, { status: 'loading' }, { pendingUrl: LIST },
  ]) {
    const f = fixture({ tab });
    assert.equal((await f.run()).code, 'RESERVE_NO_TAB');
    assert.equal(count(f, 'prepare'), 0);
    assert.equal(count(f, 'attach'), 0);
  }
  for (const url of ['https://korail.com/', 'https://www.korail.com/popup/notice']) {
    const f = fixture({ tab: { url } });
    assert.equal((await f.run()).clicked, true);
  }
});

test('브라우저 입력 — 준비 중 탭 주소나 탐색 상태가 변하면 누르지 않는다', async () => {
  for (const at of [2, 3]) {
    for (const patch of [{ url: 'https://www.korail.com/ticket/login' }, { status: 'loading' }, { pendingUrl: LIST }]) {
      const f = fixture({ onGet: (n, tab) => { if (n === at) Object.assign(tab, patch); } });
      assert.equal((await f.run()).code, 'RESERVE_TAB_CHANGED');
      assert.equal(types(f).includes('mousePressed'), false);
      assert.equal(count(f, 'detach'), 1);
    }
  }
});

test('브라우저 입력 — 시작 전과 각 prepare 직후 취소하면 press하지 않는다', async () => {
  const first = new AbortController();
  first.abort();
  const early = fixture();
  assert.equal((await early.run({ signal: first.signal })).code, 'RESERVE_CANCELLED');
  assert.equal(early.calls.length, 0);
  for (const at of [1, 2, 3]) {
    const ctrl = new AbortController();
    const f = fixture({ prepare: (n) => { if (n === at) ctrl.abort(); return plan(); } });
    assert.equal((await f.run({ signal: ctrl.signal })).code, 'RESERVE_CANCELLED');
    assert.equal(types(f).includes('mousePressed'), false);
    assert.equal(count(f, 'detach'), at === 1 ? 0 : 1);
    assert.equal(f.listeners.size, 0);
  }
});

test('브라우저 입력 — move 뒤 대기 중 취소하면 press 없이 연결을 정리한다', async () => {
  const ctrl = new AbortController();
  const f = fixture({ wait: (n) => { if (n === 2) ctrl.abort(); } });
  assert.equal((await f.run({ signal: ctrl.signal })).code, 'RESERVE_CANCELLED');
  assert.deepEqual(types(f), ['mouseMoved']);
  assert.equal(count(f, 'detach'), 1);
});

test('브라우저 입력 — press를 보낸 뒤 취소해도 release를 한 번 보내고 결과를 불명으로 남긴다', async () => {
  const ctrl = new AbortController();
  const f = fixture({ send: (_, __, event) => { if (event.type === 'mousePressed') ctrl.abort(); } });
  assert.equal((await f.run({ signal: ctrl.signal })).code, 'RESERVE_INPUT_UNCONFIRMED');
  assert.deepEqual(types(f), ['mouseMoved', 'mousePressed', 'mouseReleased']);
  assert.equal(count(f, 'detach'), 1);
  assert.equal(f.listeners.size, 0);
});

test('브라우저 입력 — attach 거절은 기존 디버거를 detach하지 않는다', async () => {
  const f = fixture({ attach: () => { throw new Error('Another debugger is already attached'); } });
  assert.equal((await f.run()).code, 'RESERVE_INPUT_FAILED');
  assert.equal(count(f, 'attach'), 1);
  assert.equal(count(f, 'detach'), 0);
  assert.equal(commands(f).length, 0);
  assert.equal(f.listeners.size, 0);
});

test('브라우저 입력 — 명령 실패 후 press 재시도 없이 필요한 release와 detach만 수행한다', async () => {
  for (const failed of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    const f = fixture({ send: (_, __, event) => { if (event.type === failed) throw new Error('transport failed'); } });
    const result = await f.run();
    assert.equal(result.code, failed === 'mouseMoved' ? 'RESERVE_INPUT_FAILED' : 'RESERVE_INPUT_UNCONFIRMED');
    assert.deepEqual(types(f), failed === 'mouseMoved' ? ['mouseMoved'] : ['mouseMoved', 'mousePressed', 'mouseReleased']);
    assert.equal(count(f, 'detach'), 1);
    assert.equal(f.listeners.size, 0);
  }
});

test('브라우저 입력 — attach 시간 초과 뒤 늦은 연결은 입력 없이 정리하고 대기 중 중복 연결을 막는다', async () => {
  const attached = deferred();
  const f = fixture({ attach: () => attached.promise });
  assert.equal((await f.run({ timeoutMs: 10 })).code, 'RESERVE_INPUT_TIMEOUT');
  assert.equal((await f.run()).code, 'RESERVE_INPUT_BUSY');
  assert.equal(count(f, 'attach'), 1);
  assert.equal(commands(f).length, 0);
  attached.resolve();
  await tick();
  assert.equal(count(f, 'detach'), 1);
  assert.equal(f.listeners.size, 0);
  assert.equal(commands(f).length, 0);
  assert.equal((await f.run()).clicked, true, '늦게 붙은 세션 정리 후에만 새 요청을 허용한다');
});

test('브라우저 입력 — attach 중 취소해도 늦게 성공한 자기 세션을 정리한다', async () => {
  const attached = deferred(), entered = deferred(), ctrl = new AbortController();
  const f = fixture({ attach: () => { entered.resolve(); return attached.promise; } });
  const running = f.run({ signal: ctrl.signal });
  await entered.promise;
  ctrl.abort();
  assert.equal((await running).code, 'RESERVE_CANCELLED');
  assert.equal((await f.run()).code, 'RESERVE_INPUT_BUSY');
  attached.resolve();
  await tick();
  assert.equal(commands(f).length, 0);
  assert.equal(count(f, 'detach'), 1);
  assert.equal(f.listeners.size, 0);
});

test('브라우저 입력 — press 응답 대기 중 취소는 release 후 종료하고 늦은 응답에도 재입력하지 않는다', async () => {
  const response = deferred(), entered = deferred(), ctrl = new AbortController();
  const f = fixture({ send: (_, __, event) => {
    if (event.type === 'mousePressed') { entered.resolve(); return response.promise; }
  } });
  const running = f.run({ signal: ctrl.signal });
  await entered.promise;
  ctrl.abort();
  assert.equal((await running).code, 'RESERVE_INPUT_UNCONFIRMED');
  assert.deepEqual(types(f), ['mouseMoved', 'mousePressed', 'mouseReleased']);
  assert.equal(count(f, 'detach'), 1);
  response.resolve();
  await tick();
  assert.deepEqual(types(f), ['mouseMoved', 'mousePressed', 'mouseReleased']);
});

test('브라우저 입력 — attach 응답 전에 연결이 해제되면 세션을 다시 붙이지 않는다', async () => {
  let f;
  f = fixture({ attach: () => { queueMicrotask(() => f.detached()); } });
  assert.equal((await f.run()).code, 'RESERVE_INPUT_DETACHED');
  assert.equal(commands(f).length, 0);
  assert.equal(count(f, 'attach'), 1);
  assert.equal(count(f, 'detach'), 0);
  assert.equal(f.listeners.size, 0);
});

test('브라우저 입력 — move 또는 press 응답 시간 초과 이후 늦은 응답으로 재클릭하지 않는다', async () => {
  for (const delayed of ['mouseMoved', 'mousePressed']) {
    const response = deferred();
    const f = fixture({ send: (_, __, event) => event.type === delayed ? response.promise : undefined });
    const result = await f.run({ timeoutMs: 10 });
    assert.equal(result.code, delayed === 'mousePressed' ? 'RESERVE_INPUT_UNCONFIRMED' : 'RESERVE_INPUT_TIMEOUT');
    const expected = delayed === 'mousePressed' ? ['mouseMoved', 'mousePressed', 'mouseReleased'] : ['mouseMoved'];
    assert.deepEqual(types(f), expected);
    response.resolve();
    await tick();
    assert.deepEqual(types(f), expected);
    assert.equal(count(f, 'detach'), 1);
    assert.equal(f.listeners.size, 0);
  }
});

test('브라우저 입력 — 예상 밖 detach 뒤에는 입력·detach를 이어 보내지 않는다', async () => {
  for (const when of ['mouseMoved', 'mousePressed']) {
    let f;
    f = fixture({ send: (_, __, event) => { if (event.type === when) f.detached(); } });
    assert.equal((await f.run()).code, when === 'mousePressed' ? 'RESERVE_INPUT_UNCONFIRMED' : 'RESERVE_INPUT_DETACHED');
    assert.deepEqual(types(f), when === 'mousePressed' ? ['mouseMoved', 'mousePressed'] : ['mouseMoved']);
    assert.equal(count(f, 'detach'), 0);
    assert.equal(f.listeners.size, 0);
  }
});

test('브라우저 입력 — 다른 탭의 detach는 현재 입력에 영향을 주지 않는다', async () => {
  let f;
  f = fixture({ wait: () => f.detached({ tabId: 99 }) });
  assert.equal((await f.run()).clicked, true);
  assert.equal(count(f, 'detach'), 1);
});

test('브라우저 입력 — detach가 지연되면 다음 입력을 막고 완료 뒤 lease를 해제한다', async () => {
  const detached = deferred();
  const f = fixture({ detach: () => detached.promise });
  assert.equal((await f.run({ timeoutMs: 10 })).code, 'RESERVE_INPUT_UNCONFIRMED');
  assert.equal((await f.run()).code, 'RESERVE_INPUT_BUSY');
  assert.equal(count(f, 'attach'), 1);
  detached.resolve();
  await tick();
  assert.equal(f.listeners.size, 0);
  assert.equal((await f.run()).clicked, true);
});
