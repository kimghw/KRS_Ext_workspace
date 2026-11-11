// 페이지가 확인한 주 문서 viewport 좌표에 브라우저 마우스 입력을 한 번 보낸다.
// 사이트 상태 판정은 prepare, 예매 완료 판정은 호출자가 맡는다.
const leases = new WeakMap();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (code, why) => ({ clicked: false, code, why, error: code === 'RESERVE_INPUT_UNCONFIRMED'
  ? '브라우저 입력 결과를 확인하지 못했습니다. 다시 누르기 전에 코레일의 현재 예약 화면을 확인해 주세요.'
  : code === 'RESERVE_CANCELLED' ? '예약 입력을 중지했습니다.'
    : '코레일 예약 입력을 진행하지 못했습니다. 현재 탭과 브라우저 입력 권한을 확인해 주세요.' });
const problem = (code, why) => Object.assign(new Error(why), { code, why });
const validTab = (tab) => {
  if (!tab || tab.status !== 'complete' || tab.pendingUrl) return false;
  try {
    const url = new URL(tab.url);
    return url.protocol === 'https:' && (url.hostname === 'korail.com' || url.hostname.endsWith('.korail.com'));
  } catch { return false; }
};
const validPlan = (plan) => plan && ['seat', 'book', 'notice'].includes(plan.action)
  && typeof plan.key === 'string' && plan.key.length > 0
  && Number.isFinite(plan.point?.x) && Number.isFinite(plan.point?.y)
  && plan.point.x >= 0 && plan.point.y >= 0;
const samePlan = (a, b, point = false) => validPlan(b) && a.key === b.key && a.action === b.action
  && (!point || (a.point.x === b.point.x && a.point.y === b.point.y));

export async function clickKorailInput({
  api = globalThis.chrome, tabId, prepare, signal, wait = pause, timeoutMs = 8_000,
} = {}) {
  if (signal?.aborted) return fail('RESERVE_CANCELLED', 'cancelled');
  if (!Number.isInteger(tabId) || typeof api?.tabs?.get !== 'function' || typeof prepare !== 'function') {
    return fail('RESERVE_INPUT_UNAVAILABLE', 'missing-api');
  }
  const slots = leases.get(api) || new Map();
  leases.set(api, slots);
  if (slots.has(tabId)) return fail('RESERVE_INPUT_BUSY', 'input-still-pending');
  const lease = {};
  slots.set(tabId, lease);
  const target = { tabId };
  const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8_000;
  let owned = false, attaching = false, detached = false, finished = false, listening = false;
  let pressed = false, point, releaseTask, detachTask, detachPending = false, stopped, rejectStop;
  const stopPromise = new Promise((_, reject) => { rejectStop = reject; });
  // A stop can arrive between awaited API calls.
  void stopPromise.catch(() => {});
  const stop = (error) => { if (!stopped) { stopped = error; rejectStop(error); } };
  const abort = () => stop(problem('RESERVE_CANCELLED', 'cancelled'));
  const check = () => {
    if (signal?.aborted) abort();
    if (stopped) throw stopped;
  };
  const finish = () => {
    // A timed-out attach/detach may still complete later. Keep its tab lease until it does.
    if (!finished || attaching || owned || detachPending) return;
    if (slots.get(tabId) === lease) slots.delete(tabId);
    signal?.removeEventListener?.('abort', abort);
    if (listening) api.debugger.onDetach.removeListener(onDetach);
    listening = false;
  };
  const onDetach = (source) => {
    if (source?.tabId !== tabId || source?.sessionId || (!owned && !attaching)) return;
    owned = false;
    detached = true;
    stop(problem('RESERVE_INPUT_DETACHED', 'debugger-detached'));
    finish();
  };
  const bounded = async (task, interruptible = true) => {
    let timer;
    try {
      return await Promise.race([
        task,
        new Promise((_, reject) => { timer = setTimeout(() => reject(problem('RESERVE_INPUT_TIMEOUT', 'timeout')), limit); }),
        ...(interruptible ? [stopPromise] : []),
      ]);
    } finally { clearTimeout(timer); }
  };
  const detach = () => {
    if (!owned || detached) return Promise.resolve();
    if (detachTask) return detachTask;
    detachPending = true;
    detachTask = Promise.resolve().then(() => {
      if (owned && !detached) return api.debugger.detach(target);
    }).then(() => {
      owned = false;
      detached = true;
    }).finally(() => { detachPending = false; finish(); });
    return detachTask;
  };
  const send = (type) => api.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type, x: point.x, y: point.y,
    ...(type === 'mouseMoved' ? { button: 'none', buttons: 0 } : { button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }),
  });
  const release = () => {
    if (!pressed || !owned || detached) return Promise.resolve();
    // Even when a press response is lost, issue only one matching release; never another press.
    return releaseTask ||= Promise.resolve().then(() => {
      if (owned && !detached) return send('mouseReleased');
    });
  };
  signal?.addEventListener?.('abort', abort, { once: true });
  let result, cleanupFailed = false;
  try {
    check();
    const tab = await bounded(api.tabs.get(tabId));
    check();
    if (!validTab(tab)) throw problem('RESERVE_NO_TAB', 'invalid-tab');
    let prepared = await bounded(prepare());
    check();
    if (!prepared?.plan) result = prepared;
    else {
      if (!validPlan(prepared.plan)) throw problem('RESERVE_INPUT_INVALID', 'invalid-plan');
      const debuggerApi = api.debugger;
      if (typeof debuggerApi?.attach !== 'function' || typeof debuggerApi?.sendCommand !== 'function'
        || typeof debuggerApi?.detach !== 'function' || typeof debuggerApi?.onDetach?.addListener !== 'function'
        || typeof debuggerApi?.onDetach?.removeListener !== 'function') {
        throw problem('RESERVE_INPUT_UNAVAILABLE', 'missing-debugger');
      }
      debuggerApi.onDetach.addListener(onDetach);
      listening = true;
      attaching = true;
      // Only a successful attach grants ownership. A rejected attach must never detach another client.
      const attached = Promise.resolve().then(() => debuggerApi.attach(target, '1.3')).then(() => {
        attaching = false;
        owned = !detached;
        if (finished) void detach().catch(() => {});
        finish();
      }, (error) => { attaching = false; finish(); throw error; });
      await bounded(attached);
      check();
      await bounded(wait(100));
      check();
      const initial = { key: prepared.plan.key, action: prepared.plan.action };
      prepared = await bounded(prepare(initial.key));
      check();
      if (!prepared?.plan) result = prepared;
      else {
        // The debugger banner can resize the viewport. Adopt coordinates measured after attaching.
        if (!samePlan(initial, prepared.plan)) throw problem('RESERVE_INPUT_CHANGED', 'plan-changed');
        let anchored = { ...prepared.plan, point: { ...prepared.plan.point } }, resolved = false;
        // Banner/layout changes may arrive after attach has resolved. Move again only while
        // the logical target is unchanged, and press only after a full interval at one point.
        for (let attempt = 0; attempt < 6; attempt++) {
          point = { ...anchored.point };
          const current = await bounded(api.tabs.get(tabId));
          check();
          if (!validTab(current) || current.url !== tab.url) throw problem('RESERVE_TAB_CHANGED', 'tab-changed');
          await bounded(send('mouseMoved'));
          check();
          await bounded(wait(100));
          check();
          prepared = await bounded(prepare(anchored.key));
          check();
          if (!prepared?.plan) { result = prepared; resolved = true; break; }
          if (!samePlan(initial, prepared.plan)) throw problem('RESERVE_INPUT_CHANGED', 'plan-changed');
          if (!samePlan(anchored, prepared.plan, true)) {
            anchored = { ...prepared.plan, point: { ...prepared.plan.point } };
            continue;
          }
          const latest = await bounded(api.tabs.get(tabId));
          check();
          if (!validTab(latest) || latest.url !== tab.url) throw problem('RESERVE_TAB_CHANGED', 'tab-changed');
          pressed = true;
          await bounded(send('mousePressed'));
          check();
          await bounded(release());
          check();
          result = { ...prepared, clicked: true };
          resolved = true;
          break;
        }
        if (!resolved) throw problem('RESERVE_INPUT_CHANGED', 'point-unstable');
      }
    }
  } catch (error) {
    result = fail(pressed ? 'RESERVE_INPUT_UNCONFIRMED' : error?.code || 'RESERVE_INPUT_FAILED', error?.why || 'api-failed');
  } finally {
    finished = true;
    if (pressed && owned && !detached) {
      try { await bounded(release(), false); } catch { cleanupFailed = true; }
    }
    if (owned && !detached) {
      try { await bounded(detach(), false); } catch { cleanupFailed = true; }
    }
    finish();
  }
  if (cleanupFailed && !result?.code) return fail(pressed ? 'RESERVE_INPUT_UNCONFIRMED' : 'RESERVE_INPUT_FAILED', 'cleanup-failed');
  return result;
}
