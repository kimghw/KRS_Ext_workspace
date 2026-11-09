// KTX 조회 — 시간표(ktxSearch)는 확장에 포함한 코레일 공식 시간표를 즉시 검색하고 브릿지·네트워크를 쓰지 않는다.
// 좌석 상태(ktxSeats)는 브릿지의 조회 실행부가 코레일 결과 첫 화면을 읽는다(2026-11-09 사용자 지정: "현재 좌석정보랑 누르면 코에릴 예매정보로 가야지").
// 줄을 누르면(ktxOpen) 그 결과 창을 앞으로 가져오고, 없으면 현재 탭에 예매 화면을 열어 조건을 채워 둔다. 좌석 선택·예매·결제는 하지 않는다.
import { KTX_TIMETABLE } from './ktxtimes.js';
import { timetableRows } from './ktxtimetable.js';
import { currentSiteTab, openCurrentTab } from './currenttab.js';
import { korailFillPage } from './korailfill.js';
export const KORAIL_MAIN = 'https://www.korail.com/ticket/main';
export const KORAIL_SEARCH = 'https://www.korail.com/ticket/search/general';
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

/** 시간표만 조회한다. 브라우저 상태나 좌석 재고를 기다리지 않는다. */
export async function ktxSearch(input, { timetable = KTX_TIMETABLE, onStage = () => {} } = {}) {
  let query;
  try { query = checkedInput(input); } catch (error) { return failure(error.message, 'INPUT_INVALID'); }
  if (query.date < timetable.basis) return failure(`${timetable.basis} 시행 시간표입니다. 이전 날짜는 코레일에서 확인해 주세요.`, 'TIMETABLE_DATE');
  onStage('시간표 조회 중');
  return { ok: true, rows: timetableRows(timetable, query), basis: timetable.basis, source: timetable.source, url: KORAIL_SEARCH };
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
    return { price: text(value.price, 80), soldOut: value.soldOut, soon: value.soon, note: text(value.note ?? '', 80) };
  };
  return rows.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('열차 정보 형식이 올바르지 않습니다.');
    const dep = text(row.dep, 5), arr = text(row.arr, 5);
    if (![dep, arr].every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('열차 시각 형식이 올바르지 않습니다.');
    return { train: text(row.train, 80), no: text(row.no, 20), dep, arr, took: text(row.took ?? '', 80), gen: seat(row.gen), spec: seat(row.spec) };
  });
}

/**
 * 브릿지의 조회 실행부로 코레일 결과 첫 화면의 좌석 상태를 읽는다. 좌석을 고르거나 예매하지 않는다.
 * @returns {Promise<{ok: true, rows: object[], session: string}|{ok: false, error: string, code: string}>}
 */
export async function ktxSeats(input, { api = globalThis.chrome, onStage = () => {}, timeoutMs = SEATS_MS } = {}) {
  let query;
  try { query = checkedInput(input); } catch (error) { return failure(error.message, 'INPUT_INVALID'); }
  onStage('코레일에서 좌석 확인 중');
  const result = await nativeCall({ task: 'ktxSearch', input: query }, { api, timeoutMs });
  if (!result.ok) return result;
  try {
    if (!validSession(result.session)) throw new Error('조회 화면의 연결 정보가 올바르지 않습니다.');
    return { ok: true, rows: checkedSeatRows(result.rows), session: result.session };
  } catch (error) {
    return failure(error.message, 'BRIDGE_RESPONSE');
  }
}

const FILL_MS = 45_000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 탭이 코레일 예매 화면을 다 불러올 때까지 기다린다. 앞 문서에 채우지 않도록 주소까지 본다. */
async function formLoaded(api, tabId, { wait = pause, tries = 80 } = {}) {
  for (let i = 0; i < tries; i++) {
    const tab = await api.tabs.get(tabId);
    if (tab?.status === 'complete' && !tab.pendingUrl && String(tab.url || '').startsWith(KORAIL_SEARCH)) return true;
    await wait(250);
  }
  return false;
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
 * 줄을 눌렀을 때 코레일 화면으로 간다(2026-11-09). 좌석 조회가 열어 둔 결과 창(session)이 있으면 그 창을 앞으로 가져온다.
 * 없거나 닫혔으면 승차권 예매 화면을 사이드패널 옆의 현재 탭에서 열고 조건을 채워 둔다 — 조회 제출은 하지 않는다.
 * 조건 없이 부르면 열기만 한다. 현재 탭이 이미 예매 화면이면 다시 불러오지 않고 그 화면에 채운다.
 */
export async function ktxOpen(input = {}, { api = globalThis.chrome, onStage = () => {}, wait = pause, fillMs = FILL_MS, session = null, openMs = OPEN_MS } = {}) {
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
