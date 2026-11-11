// 최종 예매는 Windows UI Automation의 Invoke로 한 번만 실행한다.
// 선택 검증/표식은 대상 탭, 실제 입력은 기존 native host, 결과 확인은 ktxReserve가 맡는다.
const HOST = 'com.krs.meetingroom';
const LIST = 'https://www.korail.com/ticket/search/list';
const fail = (code, error, extra = {}) => ({ booked: false, code, error, ...extra });

export async function pressKorailReserve(target, {
  api = globalThis.chrome, tabId, runPage, signal, now = Date.now,
  token = () => globalThis.crypto.randomUUID(), timeoutMs = 20_000,
} = {}) {
  const cancelled = () => fail('RESERVE_CANCELLED', '예약 입력을 중지했습니다. 이미 진행된 예매 결과는 코레일에서 확인해 주세요.', { why: 'cancelled' });
  if (signal?.aborted) return cancelled();
  if (typeof api?.runtime?.sendNativeMessage !== 'function' || typeof runPage !== 'function') {
    return fail('RESERVE_INPUT_UNAVAILABLE', '예약 입력에 필요한 로컬 브릿지가 없습니다. native/install.ps1로 브릿지를 설치해 주세요.');
  }
  if (!Number.isInteger(tabId)) return fail('RESERVE_NO_TAB', '예약할 코레일 탭이 없습니다.');
  let marker, timer, armed = false, cleanupTask;
  const cleanup = () => {
    if (!marker) return Promise.resolve();
    return cleanupTask ||= Promise.resolve().then(() => runPage('disarm', { token: marker })).catch(() => {});
  };
  const abort = () => { if (armed) void cleanup(); };
  try {
    const tab = await api.tabs.get(tabId);
    const window = await api.windows.getCurrent();
    if (!tab || tab.url !== LIST || tab.status !== 'complete' || tab.pendingUrl) {
      return fail('RESERVE_NO_TAB', '예약할 코레일 결과 탭이 준비되지 않았습니다.');
    }
    if (!Number.isInteger(window?.id) || tab.windowId !== window.id) {
      return fail('RESERVE_WINDOW_MISMATCH', '코레일 결과 탭이 있는 브라우저 창에서 패널을 열어 예약해 주세요.');
    }
    if (signal?.aborted) return cancelled();
    await api.tabs.update(tabId, { active: true });
    await api.windows.update(tab.windowId, { focused: true });
    if (signal?.aborted) return cancelled();
    marker = token();
    const expiresAt = now() + 10_000;
    signal?.addEventListener?.('abort', abort, { once: true });
    const preparation = await runPage('arm', { ...target, token: marker, expiresAt });
    armed = preparation?.armed === true;
    if (signal?.aborted) return cancelled();
    if (!armed) return { ...preparation, booked: false };
    // 활성화 뒤 사용자 탭 이동을 다시 확인한다. native도 HWND/문서/표식을 검증한다.
    const current = await api.tabs.get(tabId);
    if (signal?.aborted) return cancelled();
    if (!current?.active || current.url !== LIST || current.windowId !== window.id || current.pendingUrl) {
      return fail('RESERVE_TAB_CHANGED', '예매 전에 코레일 탭이 바뀌어 입력하지 않았습니다.');
    }
    const response = await Promise.race([
      api.runtime.sendNativeMessage(HOST, { task: 'ktxReservePress', input: { token: marker, expiresAt } }),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, code: 'RESERVE_INPUT_TIMEOUT', error: '예약 입력의 응답을 확인하지 못했습니다. 코레일의 현재 예약 화면을 확인해 주세요.' }), timeoutMs); }),
    ]);
    if (signal?.aborted) return cancelled();
    if (response?.ok === true && response.pressed === true) return { ...preparation, booked: true };
    return fail(response?.code || 'RESERVE_INPUT_FAILED', response?.error || '예약 입력 결과를 확인하지 못했습니다. 코레일의 현재 화면을 확인해 주세요.');
  } catch {
    if (signal?.aborted) return cancelled();
    return fail('RESERVE_INPUT_FAILED', '로컬 예약 입력을 완료하지 못했습니다. 코레일의 현재 예약 화면과 로컬 브릿지 설치 상태를 확인해 주세요.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', abort);
    await cleanup();
  }
}
