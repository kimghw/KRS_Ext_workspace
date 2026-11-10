// KTX 조회 — 시간표(ktxSearch)는 확장에 포함한 코레일 공식 시간표를 즉시 검색하고 브릿지·네트워크를 쓰지 않는다.
// 좌석 상태(ktxSeats)는 코레일 결과 첫 화면을 읽는다(2026-11-09 사용자 지정: "현재 좌석정보랑 누르면 코에릴 예매정보로 가야지") —
// 사이드 패널이 붙은 창의 코레일 탭에서(ktxSeatsTab, 2026-11-10 사용자 지정: "사이드 패널 옆에 열린 탭중에 하나로 하면 안될까?"), 거기서 못 읽으면 브릿지의 전용 창에서.
// 줄을 누르면(ktxOpen) 그 결과 탭·창을 앞으로 가져오고, 없으면 현재 탭에 예매 화면을 열어 조건을 채워 둔다.
// 좌석 예약(ktxReserve, 2026-11-10 사용자 지정: "좌석이 생기면 결재는 아니고 좌석 예약까지")은 빈자리 대기가 자리를 찾았을 때만 — 결제 직전 화면까지이고 결제는 하지 않는다.
import { KTX_TIMETABLE } from './ktxtimes.js';
import { timetableRows } from './ktxtimetable.js';
import { currentSiteTab, openCurrentTab } from './currenttab.js';
import { korailFillPage } from './korailfill.js';
import { korailSeatsPage, shapeSeatRows } from './korailseats.js';
import { korailReservePage, korailPopupPage } from './korailreserve.js';
export const KORAIL_MAIN = 'https://www.korail.com/ticket/main';
export const KORAIL_SEARCH = 'https://www.korail.com/ticket/search/general';
export const KORAIL_LIST = 'https://www.korail.com/ticket/search/list';
export const KTX_NATIVE_HOST = 'com.krs.meetingroom';
export const KTX_STATIONS = [
  ['서울', '0001'], ['용산', '0104'], ['영등포', '0002'], ['행신', '0390'], ['광명', '0501'], ['수원', '0003'], ['천안아산', '0502'], ['오송', '0297'],
  ['대전', '0010'], ['서대전', '0025'], ['김천구미', '0507'], ['서대구', '0506'], ['동대구', '0015'], ['경산', '0024'], ['밀양', '0017'], ['구포', '0019'],
  ['부산', '0020'], ['경주', '0508'], ['울산(통도사)', '0509'], ['포항', '0515'], ['마산', '0059'], ['창원중앙', '0512'], ['논산', '0027'], ['익산', '0030'],
  ['정읍', '0033'], ['광주송정', '0036'], ['목포', '0041'], ['전주', '0045'], ['순천', '0051'], ['여수EXPO', '0053'], ['강릉', '0115'], ['정동진', '0262'],
];
const names = new Set(KTX_STATIONS.map(([name]) => name));
const failure = (error, code) => ({ ok: false, error, code });

function checkedInput(input) {
  if (!input || !names.has(input.from) || !names.has(input.to)) throw new Error('출발역과 도착역을 선택해 주세요.');
  if (input.from === input.to) throw new Error('출발역과 도착역이 같습니다.');
  const date = input.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('출발일을 확인해 주세요.');
  const day = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) throw new Error('출발일을 확인해 주세요.');
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) throw new Error('출발 시각은 0~23시로 선택해 주세요.');
  const adults = input.adults ?? 1;
  if (!Number.isInteger(adults) || adults < 1 || adults > 9) throw new Error('어른 인원은 1~9명으로 선택해 주세요.');
  return { from: input.from, to: input.to, date, hour: input.hour, adults };
}

/** 시간표 조회의 범위 — 고른 출발 시각부터 24시간 안, 출발 순으로 앞의 10편(2026-11-10 사용자 지정: "KTX 조회 시간을 24시간 그리고 10개 조회 할 수 있도록"). */
export const KTX_HOURS = 24;
export const KTX_LIMIT = 10;

/** 시간표만 조회한다. 브라우저 상태나 좌석 재고를 기다리지 않는다. 날을 넘긴 열차의 줄은 date 가 다음 날이다. */
export async function ktxSearch(input, { timetable = KTX_TIMETABLE, onStage = () => {} } = {}) {
  let query;
  try { query = checkedInput(input); } catch (error) { return failure(error.message, 'INPUT_INVALID'); }
  if (query.date < timetable.basis) return failure(`${timetable.basis} 시행 시간표입니다. 이전 날짜는 코레일에서 확인해 주세요.`, 'TIMETABLE_DATE');
  onStage('시간표 조회 중');
  return { ok: true, rows: timetableRows(timetable, query, { hours: KTX_HOURS, limit: KTX_LIMIT }), basis: timetable.basis, source: timetable.source, url: KORAIL_SEARCH };
}

const SEATS_MS = 130_000;
const OPEN_MS = 25_000;
const validSession = (value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
const errorText = (error) => String(error?.message || error || '').slice(0, 2000);

/** 브릿지에 한 번 묻는다. 시간 초과·차단·실패를 자동으로 재시도하지 않는다(차단 뒤 같은 조건 재조회는 실행부 안의 흐름이 한다). */
async function nativeCall(message, { api, timeoutMs }) {
  let timer;
  try {
    if (typeof api?.runtime?.sendNativeMessage !== 'function') return failure('로컬 브릿지에 연결할 수 없어 좌석을 읽지 못했습니다.', 'BRIDGE_UNAVAILABLE');
    const response = await Promise.race([
      api.runtime.sendNativeMessage(KTX_NATIVE_HOST, message),
      new Promise((resolve) => { timer = setTimeout(() => resolve(failure('코레일 조회의 응답 시간이 지났습니다. 다시 조회해 주세요.', 'BRIDGE_TIMEOUT')), timeoutMs); }),
    ]);
    if (!response || typeof response.ok !== 'boolean') return failure('코레일 조회의 응답 형식이 올바르지 않습니다.', 'BRIDGE_RESPONSE');
    if (response.ok) return response;
    const error = errorText(response.error);
    const code = typeof response.code === 'string' ? response.code : 'BRIDGE_FAILED';
    if (code === 'RUNTIME_MISSING') return failure('좌석 조회 환경이 준비되지 않았습니다. native/setup-ktx.ps1 을 실행해 주세요.', code);
    return failure(error || '코레일 조회를 마치지 못했습니다.', code);
  } catch (error) {
    return failure(`로컬 브릿지에 연결하지 못해 좌석을 읽지 못했습니다. ${errorText(error)}`, 'BRIDGE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

/** 실행부에서 받은 값만 표시한다. HTML 이나 명령은 결과로 받지 않는다. */
function checkedSeatRows(rows) {
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('열차 목록 형식이 올바르지 않습니다.');
  const text = (value, limit) => {
    if (typeof value !== 'string' || value.length > limit) throw new Error('열차 정보 형식이 올바르지 않습니다.');
    return value;
  };
  const seat = (value) => {
    if (value == null) return null;
    if (typeof value !== 'object' || typeof value.soldOut !== 'boolean' || typeof value.soon !== 'boolean') throw new Error('좌석 정보 형식이 올바르지 않습니다.');
    const note = text(value.note ?? '', 80);
    // wait — 코레일 예약대기를 걸 수 있는 칸(빈자리 대기를 두지 않는다). 전용 창에서 읽은 줄은 코레일이 적은 말로 가린다.
    return { price: text(value.price, 80), soldOut: value.soldOut, soon: value.soon, note, ...(value.wait === true || note.includes('예약대기') ? { wait: true } : {}) };
  };
  return rows.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('열차 정보 형식이 올바르지 않습니다.');
    const dep = text(row.dep, 5), arr = text(row.arr, 5);
    if (![dep, arr].every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('열차 시각 형식이 올바르지 않습니다.');
    return { train: text(row.train, 80), no: text(row.no, 20), dep, arr, took: text(row.took ?? '', 80), gen: seat(row.gen), spec: seat(row.spec) };
  });
}

const FILL_MS = 45_000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 탭이 코레일 화면(기본은 예매 화면)을 다 불러올 때까지 기다린다. 앞 문서에 손대지 않도록 주소까지 본다. */
async function formLoaded(api, tabId, { wait = pause, tries = 80, url = KORAIL_SEARCH } = {}) {
  for (let i = 0; i < tries; i++) {
    const tab = await api.tabs.get(tabId);
    if (tab?.status === 'complete' && !tab.pendingUrl && String(tab.url || '').startsWith(url)) return true;
    await wait(250);
  }
  return false;
}

/** 탭 안에서 함수 하나를 돌려 그 답을 받는다. 끝나지 않으면 던진다. */
async function inTab(api, tabId, func, args, ms = FILL_MS) {
  let timer;
  try {
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('시간이 초과되었습니다')), ms); });
    const done = await Promise.race([api.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args }), late]);
    return done?.[0]?.result;
  } finally {
    clearTimeout(timer);
  }
}

const REQUERIES = 2;
let seatTabId = null;
const blocked = (guard) => failure(`코레일 조회가 제한되었습니다 (${guard.code || '차단 안내'}). ${guard.message || ''}`.trim().slice(0, 1800), 'GUARD_BLOCKED');
/** 결과 화면의 조건이 요청과 같은가 — 다른 조건의 줄을 싣지 않는다. */
const sameCond = (cond, query) => {
  const people = String(cond?.people || '').match(/(\d+)\s*명/);
  return cond?.from === query.from && cond?.to === query.to && String(cond?.date || '').startsWith(query.date) && +people?.[1] === query.adults;
};
const onKorail = (tab, urls) => Number.isInteger(tab?.id) && urls.some((url) => String(tab.url || '').startsWith(url));

/**
 * 좌석을 읽을 탭 — 앞서 쓴 탭, 없으면 패널이 붙은 창의 코레일 승차권 조회 탭(예매 화면·결과 목록), 그것도 없으면 뒤쪽에 새 탭.
 * 예매·결제 중일 수 있는 다른 코레일 화면은 고르지 않는다.
 */
async function seatTab(api) {
  const reusable = [KORAIL_SEARCH, KORAIL_LIST];
  const mine = Number.isInteger(seatTabId) ? await Promise.resolve().then(() => api.tabs.get(seatTabId)).catch(() => null) : null;
  if (onKorail(mine, reusable)) return mine;
  const open = await api.tabs.query({ currentWindow: true, url: 'https://www.korail.com/ticket/search/*' });
  return (open || []).find((tab) => onKorail(tab, reusable)) || api.tabs.create({ url: KORAIL_SEARCH, active: false });
}

/**
 * 사이드 패널이 붙은 창의 탭에서 좌석 상태를 읽는다(2026-11-10) — 조건을 채우고 열차 조회를 눌러 결과 첫 화면의 줄을 읽는다.
 * 차단 안내는 닫고 같은 조건으로 다시 조회한다(전용 창 조회와 같게 최대 2회). 보던 탭을 앞에서 밀어내지 않는다.
 * @returns {Promise<{ok: true, rows: object[], tabId: number}|{ok: false, error: string, code: string}>}
 */
export async function ktxSeatsTab(query, { api = globalThis.chrome, onStage = () => {}, wait = pause, forWatch = false } = {}) {
  if (!api?.tabs?.query || !api.tabs.create || !api.scripting?.executeScript) return failure('옆 탭에서 코레일을 열 수 없습니다.', 'TAB_UNAVAILABLE');
  // 같은 탭을 5초마다 다시 읽는 빈자리 대기가 돌고 있으면 끝낸 뒤에 조회한다 — 새 조회가 그 탭을 예매 화면으로 돌린다.
  if (!forWatch) await ktxWatchStop('새로 조회해 빈자리 대기를 멈췄습니다.');
  let tab;
  try {
    tab = await seatTab(api);
    if (!Number.isInteger(tab?.id)) throw new Error('탭을 열지 못했습니다');
    if (!onKorail(tab, [KORAIL_SEARCH]) && !String(tab.pendingUrl || '').startsWith(KORAIL_SEARCH)) await api.tabs.update(tab.id, { url: KORAIL_SEARCH });
  } catch (error) {
    return failure(`옆 탭에서 코레일을 열지 못했습니다. ${errorText(error)}`, 'TAB_UNAVAILABLE');
  }
  const tabId = seatTabId = tab.id;
  try {
    if (!await formLoaded(api, tabId, { wait })) return failure('코레일 화면이 열리지 않아 좌석을 읽지 못했습니다.', 'FORM_NOT_LOADED');
    onStage('코레일 탭에 조건을 넣는 중');
    const filled = await inTab(api, tabId, korailFillPage, [query]);
    if (filled?.guard) return blocked({ message: filled.guard });
    if (!filled?.form) return failure('코레일 화면에서 입력 칸을 찾지 못했습니다.', 'FORM_NOT_FOUND');
    if (filled.missing?.length) return failure(`코레일 화면에 ${filled.missing.join('·')}을(를) 넣지 못했습니다.`, 'FILL_PARTIAL');
    await wait(1200);
    onStage('코레일에서 좌석 확인 중');
    const sent = await inTab(api, tabId, korailSeatsPage, ['submit']);
    if (sent?.guard) return blocked(sent.guard);
    if (!sent?.clicked) return failure('코레일 화면에서 열차 조회 단추를 찾지 못했습니다.', 'FORM_NOT_FOUND');
    if (!await formLoaded(api, tabId, { wait, url: KORAIL_LIST, tries: 60 })) {
      const stuck = await inTab(api, tabId, korailSeatsPage, ['read', { waitMs: 1500 }]).catch(() => null);
      return stuck?.guard ? blocked(stuck.guard) : failure('코레일이 결과 화면으로 넘어가지 않았습니다.', 'RESULT_NOT_REACHED');
    }
    let guard = null, refresh = 1;
    const again = async () => {
      // 결과 화면의 조회 단추가 보이면 그것으로, 접혀 있으면 새로고침으로 — 어느 쪽이든 조건은 그대로다.
      const asked = await inTab(api, tabId, korailSeatsPage, ['requery']).catch(() => null);
      if (!asked?.clicked) {
        await api.tabs.reload(tabId);
        await wait(1500);
        await formLoaded(api, tabId, { wait, url: KORAIL_LIST, tries: 60 });
      }
      await wait(1500);
    };
    for (let attempt = 0; attempt <= REQUERIES; attempt++) {
      // 새 문서로 넘어가는 중이면 주입이 끊긴다 — 한 번 더 읽는다.
      const read = () => inTab(api, tabId, korailSeatsPage, ['read', { ktx: true }]);
      const page = await read().catch(async () => { await wait(1500); return read(); });
      if (page?.guard) {
        guard = page.guard;
        if (attempt < REQUERIES) await again();
        continue;
      }
      if (page?.state === 'rows' || page?.state === 'empty') {
        if (!sameCond(page.cond, query)) return failure('코레일 결과 화면의 조건이 요청과 달라 좌석을 싣지 않았습니다.', 'CONDITION_MISMATCH');
        return { ok: true, rows: checkedSeatRows(shapeSeatRows(page.rows, query)), tabId };
      }
      // 안내도 '열차 없음'도 없는 빈 화면 — 그리다 만 것일 수 있어 새로고침으로 한 번만 더.
      if (attempt >= REQUERIES || refresh-- <= 0) break;
      await again();
    }
    return guard ? blocked(guard) : failure('코레일 결과 화면에서 열차 목록을 확인하지 못했습니다.', 'RESULT_UNAVAILABLE');
  } catch (error) {
    const why = errorText(error);
    if (/Cannot access|permission/i.test(why)) return failure('코레일 사이트 권한이 없어 옆 탭에서 좌석을 읽지 못했습니다. 확장을 다시 불러와 주세요.', 'NO_PERMISSION');
    return failure(`옆 탭에서 좌석을 읽지 못했습니다. ${why}`, 'TAB_FAILED');
  }
}

// ── 빈자리 대기(2026-11-10 사용자 지정: "한번에 3개 까지. 예약대기가 안되는 경우만 … 간격은 5초, 1시간 지나면 정지 … 알림만. 패널이 열린경우만") ──
// 옆 코레일 탭의 결과 화면을 다시 읽어 지켜보는 열차에 살 수 있는 자리가 나오면 알린다. 좌석을 고르거나 예매하지 않는다.
// 조회 하나(같은 조건·같은 탭)에 열차를 셋까지 얹는다 — 열차마다 ktxWatch 한 번이고, 도는 것은 하나다. 패널의 페이지에서만 돈다(닫히면 같이 끝난다).
export const WATCH_MAX = 3;
export const WATCH_GAP_MS = 5000;
export const WATCH_LIMIT_MS = 60 * 60 * 1000;
const WATCH_BLANKS = 3;
let watcher = null;
const trainNo = (no) => String(no ?? '').replace(/^0+(?=\d)/, '');
/** 살 수 있는 자리 — 값이 있고 매진이 아닌 칸. "입석 + 좌석"·예약대기는 자리가 아니다. */
export const openSeat = (seat) => !!seat && !seat.soldOut && !!seat.price;

/** 결과 화면을 한 번 다시 읽는다. 차단 안내는 확인으로 닫고 새로고침 한 번, 그래도 뜨면 막힌 것이다. */
async function watchPoll(w, { api, wait }) {
  const read = () => inTab(api, w.tabId, korailSeatsPage, ['read', { ktx: true, have: [...w.targets.keys()] }]);
  let guard = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    await api.tabs.reload(w.tabId);
    await wait(1000);
    await formLoaded(api, w.tabId, { wait, url: KORAIL_LIST, tries: 60 });
    const page = await read().catch(async () => { await wait(1500); return read(); });
    if (page?.guard) { guard = page.guard; continue; }
    if (page?.state === 'rows' || page?.state === 'empty') {
      if (!sameCond(page.cond, w.query)) return failure('코레일 탭의 조회 조건이 바뀌어 빈자리 대기를 멈췄습니다.', 'CONDITION_MISMATCH');
      w.blanks = 0;
      return { ok: true, rows: checkedSeatRows(shapeSeatRows(page.rows, w.query)) };
    }
    // 그리다 만 화면 — 다음 차례에 다시 본다. 거듭되면 끝낸다.
    if (++w.blanks >= WATCH_BLANKS) return failure('코레일 결과 화면에서 열차 목록을 거듭 확인하지 못해 빈자리 대기를 멈췄습니다.', 'RESULT_UNAVAILABLE');
    return { ok: true, rows: null };
  }
  return blocked(guard);
}

async function watchLoop(w, { api, wait, now, gapMs }) {
  const endAll = (result) => { for (const target of [...w.targets.values()]) target.done(result); };
  try {
    let rows = null;
    const tab = Number.isInteger(w.tabId) ? await Promise.resolve().then(() => api.tabs.get(w.tabId)).catch(() => null) : null;
    if (!onKorail(tab, [KORAIL_LIST])) {
      // 결과 탭이 없다(전용 창에서 읽었거나 닫혔다) — 옆 탭에서 한 번 조회해 세운다.
      const set = await ktxSeatsTab(w.query, { api, wait, forWatch: true });
      if (!set.ok) return endAll(set);
      w.tabId = set.tabId;
      rows = set.rows;
    }
    while (w.targets.size) {
      if (!rows) {
        // 기다리는 열차가 없어지면(멈춤) 간격을 다 채우지 않고 깬다.
        await Promise.race([wait(gapMs), new Promise((resolve) => { w.wake = resolve; })]);
        for (const target of [...w.targets.values()]) {
          if (now() >= target.deadline) target.done({ ok: true, found: false, expired: true, note: '1시간이 지나 빈자리 대기를 멈췄습니다.' });
        }
        if (!w.targets.size) break;
        const at = await Promise.resolve().then(() => api.tabs.get(w.tabId)).catch(() => null);
        if (!onKorail(at, [KORAIL_LIST])) return endAll(failure('코레일 탭이 닫혔거나 다른 화면으로 넘어가 빈자리 대기를 멈췄습니다.', 'WATCH_TAB_GONE'));
        // 그 탭을 보고 있는 동안은 새로고침하지 않는다 — 예매하려는 화면을 밀어내지 않는다.
        if (at.active) { for (const target of w.targets.values()) target.onTick({ paused: true, count: w.count, tabId: w.tabId }); continue; }
        const polled = await watchPoll(w, { api, wait });
        if (!polled.ok) return endAll(polled);
        rows = polled.rows;
        if (!rows) continue;
      }
      w.count++;
      const seen = rows;
      rows = null;
      for (const target of [...w.targets.values()]) {
        if (!w.targets.has(target.no)) continue;   // 앞 열차를 예약하느라 끝났다
        const row = seen.find((r) => trainNo(r.no) === target.no);
        if (!row || !(openSeat(row.gen) || openSeat(row.spec))) { target.onTick({ rows: seen, count: w.count, tabId: w.tabId }); continue; }
        if (typeof target.onFound !== 'function') { target.done({ ok: true, found: true, row, rows: seen, tabId: w.tabId, count: w.count }); continue; }
        // 자리가 나면 예약까지(2026-11-10) — 예약이 끝날 때까지 이 탭을 다시 읽지 않는다. 예약하면 탭이 결제 직전 화면으로 넘어가 다른 대기는 멈춘다.
        let reserve;
        try { reserve = await target.onFound({ row, tabId: w.tabId }); } catch (error) { reserve = failure(errorText(error), 'RESERVE_FAILED'); }
        target.done({ ok: true, found: true, row, rows: seen, tabId: w.tabId, count: w.count, reserve });
        if (reserve?.ok && reserve.reserved) return endAll({ ok: true, found: false, stopped: true, note: '다른 열차를 예약해 빈자리 대기를 멈췄습니다.' });
      }
    }
  } catch (error) {
    const why = errorText(error);
    endAll(/Cannot access|permission/i.test(why)
      ? failure('코레일 사이트 권한이 없어 빈자리 대기를 멈췄습니다. 확장을 다시 불러와 주세요.', 'NO_PERMISSION')
      : failure(`빈자리 대기 중에 코레일 탭을 읽지 못했습니다. ${why}`, 'WATCH_FAILED'));
  } finally {
    if (watcher === w) watcher = null;
  }
}

/** 돌고 있는 빈자리 대기를 모두 끝내고, 도는 것이 멎을 때까지 기다린다. */
export async function ktxWatchStop(note = '빈자리 대기를 멈췄습니다.') {
  const w = watcher;
  if (!w) return;
  for (const target of [...w.targets.values()]) target.done({ ok: true, found: false, stopped: true, note });
  await w.running;
}

/**
 * 열차 하나의 빈자리를 기다린다 — 자리가 나오거나(found), 1시간이 지나거나(expired), 멈추거나(stopped — signal), 막히면 끝난다.
 * tabId 는 좌석을 읽은 코레일 결과 탭(없으면 옆 탭에서 새로 조회한다), onTick 은 읽을 때마다의 줄({ rows, count, tabId } · 탭을 보고 있어 쉬면 { paused }).
 * onFound({ row, tabId }) 를 주면 자리가 났을 때 그것(예약 — 패널이 ktx.reserve 를 돌린다)이 끝나기를 기다려 그 답을 reserve 로 싣는다.
 * @returns {Promise<{ok: true, found: boolean, row?: object, rows?: object[], tabId?: number, count?: number, expired?: boolean, stopped?: boolean, note?: string}|{ok: false, error: string, code: string}>}
 */
export function ktxWatch(input, { api = globalThis.chrome, tabId = null, signal = null, onTick = () => {}, onFound = null, wait = pause, now = () => Date.now(), gapMs = WATCH_GAP_MS, limitMs = WATCH_LIMIT_MS } = {}) {
  let query;
  try { query = checkedInput(input); } catch (error) { return Promise.resolve(failure(error.message, 'INPUT_INVALID')); }
  if (typeof input.train !== 'string' || !/^\d{1,4}$/.test(input.train)) return Promise.resolve(failure('기다릴 열차 번호를 확인해 주세요.', 'INPUT_INVALID'));
  if (!api?.tabs?.get || !api.tabs.reload || !api.scripting?.executeScript) return Promise.resolve(failure('옆 탭에서 코레일을 열 수 없어 빈자리를 기다리지 못합니다.', 'TAB_UNAVAILABLE'));
  if (signal?.aborted) return Promise.resolve({ ok: true, found: false, stopped: true, note: '빈자리 대기를 멈췄습니다.' });
  const no = trainNo(input.train), key = JSON.stringify(query);
  if (watcher && watcher.key !== key) return Promise.resolve(failure('다른 조건의 빈자리 대기가 돌고 있습니다. 그것을 멈춘 뒤에 다시 눌러 주세요.', 'WATCH_OTHER'));
  if (watcher?.targets.has(no)) return Promise.resolve(failure('이미 기다리고 있는 열차입니다.', 'WATCH_DUPLICATE'));
  if (watcher && watcher.targets.size >= WATCH_MAX) return Promise.resolve(failure(`빈자리 대기는 한 번에 ${WATCH_MAX}편까지입니다.`, 'WATCH_FULL'));
  return new Promise((resolve) => {
    const w = watcher || (watcher = { key, query, tabId, targets: new Map(), count: 0, blanks: 0, running: null, wake: null });
    const stop = () => target.done({ ok: true, found: false, stopped: true, note: '빈자리 대기를 멈췄습니다.' });
    const target = { no, deadline: now() + limitMs, onTick, onFound, done: (result) => {
      if (!w.targets.delete(no)) return;
      if (!w.targets.size) w.wake?.();
      signal?.removeEventListener?.('abort', stop);
      resolve(result);
    } };
    w.targets.set(no, target);
    signal?.addEventListener?.('abort', stop, { once: true });
    if (!w.running) w.running = watchLoop(w, { api, wait, now, gapMs });
  });
}

// ── 좌석 예약(2026-11-10 사용자 지정: "좌석이 생기면 결재는 아니고 좌석 예약까지 할 수 있도록" · "이미 로그인이 되었다고 가정하고") ──
export const RESERVE_TRIES = 25;
const RESERVE_WHY = {
  'not-list': '코레일 탭이 결과 화면이 아닙니다.',
  'bad-target': '예약할 열차 번호·출발 시각을 확인해 주세요.',
  'no-row': '코레일 결과 화면에서 그 열차를 찾지 못했습니다.',
  'many-rows': '코레일 결과 화면에서 그 열차를 한 줄로 특정하지 못했습니다.',
  'no-seat': '그 사이 자리가 없어졌습니다.',
  'no-book-button': '좌석은 골랐지만 코레일의 예매 단추를 찾지 못했습니다.',
  'book-disabled': '좌석은 골랐지만 코레일의 예매 단추가 눌리지 않는 상태입니다.',
};

/**
 * 빈자리가 난 열차를 그 코레일 결과 탭에서 예약한다 — 일반실(없으면 특실)의 가격을 고르고 예매를 눌러 결제 직전 화면(좌석이 잡힌 화면)까지. 결제는 하지 않는다.
 * 코레일 로그인은 되어 있다고 본다(로그인 화면이 나오면 멈춘다). 다른 열차로 대신하지 않고, 재시도하지 않는다. 예약하면 그 탭을 앞으로 가져온다.
 * input — 조회 조건 + train(열차 번호) · dep(출발 HH:MM) · seat('any'|'gen'|'spec'). tabId 는 좌석을 읽은 결과 탭(ctx).
 * @returns {Promise<{ok: true, reserved: true, seat: string, price: string, deadline: string, tabId: number, note: string}|{ok: false, error: string, code: string}>}
 */
export async function ktxReserve(input = {}, { api = globalThis.chrome, tabId = null, onStage = () => {}, wait = pause, tries = RESERVE_TRIES } = {}) {
  let query;
  try { query = checkedInput(input); } catch (error) { return failure(error.message, 'INPUT_INVALID'); }
  if (typeof input.train !== 'string' || !/^\d{1,4}$/.test(input.train) || typeof input.dep !== 'string' || !/^\d{2}:\d{2}$/.test(input.dep)) {
    return failure('예약할 열차 번호·출발 시각을 확인해 주세요.', 'INPUT_INVALID');
  }
  const seat = ['gen', 'spec'].includes(input.seat) ? input.seat : 'any';
  if (!api?.tabs?.get || !api.scripting?.executeScript) return failure('코레일 탭을 다룰 수 없어 예약하지 못했습니다.', 'TAB_UNAVAILABLE');
  const tab = Number.isInteger(tabId) ? await Promise.resolve().then(() => api.tabs.get(tabId)).catch(() => null) : null;
  if (!onKorail(tab, [KORAIL_LIST])) return failure('예약할 코레일 결과 탭이 없습니다. 다시 조회한 뒤 빈자리 대기를 걸어 주세요.', 'RESERVE_NO_TAB');
  try {
    const page = await inTab(api, tabId, korailSeatsPage, ['read', { waitMs: 3000, have: [trainNo(input.train)] }]);
    if (page?.guard) return blocked(page.guard);
    if (!sameCond(page?.cond, query)) return failure('코레일 탭의 조회 조건이 요청과 달라 예약하지 않았습니다.', 'CONDITION_MISMATCH');
    onStage('코레일에서 좌석을 고르는 중');
    const picked = await inTab(api, tabId, korailReservePage, ['pick', { no: input.train, dep: input.dep, from: query.from, to: query.to, seat }]);
    if (picked?.guard) return blocked(picked.guard);
    if (!picked?.booked) return failure(RESERVE_WHY[picked?.why] || '코레일에서 좌석을 고르지 못했습니다.', 'RESERVE_NOT_PICKED');
    onStage(`${picked.seat} ${picked.price} — 예매를 눌러 결제 직전 화면을 기다리는 중`);
    const said = [];
    for (let i = 0; i < tries; i++) {
      await wait(1000);
      // 예매 뒤 따로 뜬 안내 창(window.open)은 확인을 누른다.
      const popups = ((await Promise.resolve().then(() => api.tabs.query({})).catch(() => [])) || [])
        .filter((t) => t.openerTabId === tabId && /^https:\/\/[^/]*korail\.com\//.test(String(t.url || '')));
      for (const popup of popups) {
        const r = await inTab(api, popup.id, korailPopupPage, [], 5000).catch(() => null);
        if (r?.words) said.push(r.words.slice(0, 200));
      }
      const now = await Promise.resolve().then(() => api.tabs.get(tabId)).catch(() => null);
      if (!now) return failure('예약하던 코레일 탭이 닫혔습니다.', 'RESERVE_TAB_GONE');
      if (now.status !== 'complete' || now.pendingUrl) continue;
      const seen = await inTab(api, tabId, korailReservePage, ['settle'], 8000).catch(() => null);
      if (!seen) continue;   // 화면이 넘어가는 중이라 주입이 끊겼다
      if (seen.guard) return blocked(seen.guard);
      if (seen.login) return failure('코레일 로그인 화면이 나와 예약하지 못했습니다. 그 탭에서 로그인한 뒤 다시 대기를 걸어 주세요.', 'RESERVE_LOGIN');
      said.push(...(seen.said || []));
      if (seen.done) {
        await Promise.resolve().then(() => api.tabs.update(tabId, { active: true })).catch(() => {});
        if (Number.isInteger(now.windowId)) await Promise.resolve().then(() => api.windows?.update?.(now.windowId, { focused: true })).catch(() => {});
        const until = seen.deadline ? ` 결제 기한 ${seen.deadline}.` : '';
        return { ok: true, reserved: true, seat: picked.seat, price: picked.price, deadline: seen.deadline || '', tabId,
          note: `${picked.seat} ${picked.price} 좌석을 잡았습니다.${until} 결제는 코레일 탭에서 직접 해 주세요(기한이 지나면 자동 취소).` };
      }
    }
    const heard = [...new Set(said)].join(' / ').slice(0, 400);
    return failure(`예매를 눌렀지만 결제 직전 화면을 확인하지 못했습니다${heard ? ` — 코레일: ${heard}` : ''}. 코레일 탭을 확인해 주세요.`, 'RESERVE_UNCONFIRMED');
  } catch (error) {
    const why = errorText(error);
    if (/Cannot access|permission/i.test(why)) return failure('코레일 사이트 권한이 없어 예약하지 못했습니다. 확장을 다시 불러와 주세요.', 'NO_PERMISSION');
    return failure(`코레일에서 예약하지 못했습니다. ${why}`, 'RESERVE_FAILED');
  }
}

/** 브릿지의 조회 실행부(전용 창)로 좌석 상태를 읽는다 — 옆 탭에서 못 읽었을 때의 예비. */
async function bridgeSeats(query, { api, timeoutMs }) {
  const result = await nativeCall({ task: 'ktxSearch', input: query }, { api, timeoutMs });
  if (!result.ok) return result;
  try {
    if (!validSession(result.session)) throw new Error('조회 화면의 연결 정보가 올바르지 않습니다.');
    return { ok: true, rows: checkedSeatRows(result.rows), session: result.session };
  } catch (error) {
    return failure(error.message, 'BRIDGE_RESPONSE');
  }
}

/**
 * 코레일 결과 첫 화면의 좌석 상태를 읽는다. 좌석을 고르거나 예매하지 않는다.
 * 먼저 사이드 패널 옆의 탭에서 읽고(tabId), 거기서 못 읽으면 브릿지의 전용 창에서 읽는다(session).
 * 둘 다 못 읽으면 옆 탭의 까닭을 알린다(옆 탭을 열지도 못한 때만 브릿지의 까닭).
 * @returns {Promise<{ok: true, rows: object[], tabId?: number, session?: string}|{ok: false, error: string, code: string}>}
 */
export async function ktxSeats(input, { api = globalThis.chrome, onStage = () => {}, timeoutMs = SEATS_MS, wait = pause } = {}) {
  let query;
  try { query = checkedInput(input); } catch (error) { return failure(error.message, 'INPUT_INVALID'); }
  onStage('코레일에서 좌석 확인 중');
  const near = await ktxSeatsTab(query, { api, onStage, wait });
  if (near.ok) return near;
  onStage('옆 탭에서 읽지 못해 전용 창에서 확인 중');
  const far = await bridgeSeats(query, { api, timeoutMs });
  return far.ok || near.code === 'TAB_UNAVAILABLE' ? far : near;
}

/** 탭에서 돌아온 것을 패널의 한 줄로. 못 채운 칸이 있으면 실패로 알린다 — 사람이 채운 줄 알고 조회하지 않게. */
function fillSaid(query, page) {
  const opened = '코레일 화면은 열었지만';
  if (page?.guard) return failure(`${opened} 코레일 안내가 떠 있어 멈췄습니다 — ${page.guard}`, 'GUARD_NOTICE');
  if (!page?.form) return failure(`${opened} 입력 칸을 찾지 못했습니다. 조건을 직접 골라 주세요.`, 'FORM_NOT_FOUND');
  if (page.missing?.length) return failure(`${opened} ${page.missing.join('·')}을(를) 채우지 못했습니다. 그 칸은 직접 골라 주세요.`, 'FILL_PARTIAL');
  const shownHour = Number(page.shown?.date?.match(/(\d{1,2}):00/)?.[1]);
  const moved = Number.isInteger(shownHour) && shownHour !== query.hour ? ` ${query.hour}시는 코레일에서 고를 수 없어 ${shownHour}시로 두었습니다.` : '';
  return {
    ok: true, filled: true, shown: page.shown,
    note: `${query.from}→${query.to} ${query.date.slice(5).replace('-', '/')} ${query.adults}명을 채웠습니다.${moved} 코레일에서 "열차 조회"를 눌러 주세요.`,
  };
}

/**
 * 줄을 눌렀을 때 코레일 화면으로 간다(2026-11-09). 좌석을 읽은 결과 탭(tabId)이 아직 결과 목록이면 그 탭으로 넘어가고,
 * 전용 창에서 읽었으면(session) 그 창을 앞으로 가져온다.
 * 없거나 닫혔으면 승차권 예매 화면을 사이드패널 옆의 현재 탭에서 열고 조건을 채워 둔다 — 조회 제출은 하지 않는다.
 * 조건 없이 부르면 열기만 한다. 현재 탭이 이미 예매 화면이면 다시 불러오지 않고 그 화면에 채운다.
 */
export async function ktxOpen(input = {}, { api = globalThis.chrome, onStage = () => {}, wait = pause, fillMs = FILL_MS, session = null, tabId = null, openMs = OPEN_MS } = {}) {
  if (Number.isInteger(tabId)) {
    try {
      const tab = await api.tabs.get(tabId);
      if (onKorail(tab, [KORAIL_LIST])) {
        await api.tabs.update(tabId, { active: true });
        if (Number.isInteger(tab.windowId)) await Promise.resolve().then(() => api.windows?.update?.(tab.windowId, { focused: true })).catch(() => {});
        return { ok: true, filled: false, shown: true, note: '조회한 코레일 탭으로 넘어갔습니다. 좌석 선택·예매·결제는 그 탭에서 진행해 주세요.' };
      }
    } catch { /* 탭이 닫혔다 — 아래 길로 */ }
  }
  if (validSession(session)) {
    const shown = await nativeCall({ task: 'ktxOpen', session }, { api, timeoutMs: openMs });
    if (shown.ok) return { ok: true, filled: false, shown: true, note: '조회한 코레일 화면을 앞으로 가져왔습니다. 좌석 선택·예매·결제는 그 창에서 진행해 주세요.' };
  }
  const wantsFill = Object.keys(input || {}).length > 0;
  let tab;
  try {
    const here = wantsFill ? await currentSiteTab(KORAIL_SEARCH, { api }) : null;
    tab = String(here?.url || '').startsWith(KORAIL_SEARCH) ? here : await openCurrentTab(KORAIL_SEARCH, { api });
  } catch (error) {
    return failure(`코레일을 열지 못했습니다. ${String(error?.message || error)}`, 'TAB_OPEN_FAILED');
  }
  if (!wantsFill) return { ok: true, filled: false };
  let query;
  try { query = checkedInput(input); } catch (error) { return failure(`코레일 화면은 열었지만 조건을 채우지 않았습니다. ${error.message}`, 'INPUT_INVALID'); }
  onStage('코레일 화면에 조건을 채우는 중');
  let timer;
  try {
    if (!Number.isInteger(tab?.id) || !await formLoaded(api, tab.id, { wait })) return failure('코레일 화면이 열리지 않아 조건을 채우지 못했습니다.', 'FORM_NOT_LOADED');
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('시간이 초과되었습니다')), fillMs); });
    const done = await Promise.race([api.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: korailFillPage, args: [query] }), late]);
    return fillSaid(query, done?.[0]?.result);
  } catch (error) {
    const why = String(error?.message || error);
    if (/Cannot access|permission/i.test(why)) return failure('코레일 화면은 열었지만 사이트 권한이 없어 조건을 채우지 못했습니다. 확장을 다시 불러와 주세요.', 'NO_PERMISSION');
    return failure(`코레일 화면은 열었지만 조건을 채우지 못했습니다. ${why}`, 'FILL_FAILED');
  } finally {
    clearTimeout(timer);
  }
}
