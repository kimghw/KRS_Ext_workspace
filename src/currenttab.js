// 사이드패널이 붙은 창의 현재 탭. 다른 창의 활성 탭이나 비슷한 호스트는 고르지 않는다.
export async function currentSiteTab(origin, { api = globalThis.chrome } = {}) {
  if (!api?.tabs?.query) return null;
  try {
    const expected = new URL(origin).origin;
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs.find((tab) => {
      if (!Number.isInteger(tab.id) || typeof tab.url !== 'string') return false;
      try { return new URL(tab.url).origin === expected; } catch { return false; }
    }) || null;
  } catch { return null; }
}

/** 명시적으로 누른 바로가기를 사이드패널 옆 탭에서 연다. */
export async function openCurrentTab(url, { api = globalThis.chrome } = {}) {
  const [tab] = await api.tabs.query?.({ active: true, currentWindow: true }) || [];
  if (Number.isInteger(tab?.id)) return api.tabs.update(tab.id, { url, active: true });
  return api.tabs.create({ url, active: true });
}
