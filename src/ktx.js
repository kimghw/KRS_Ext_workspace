// KTX 시간표 조회 — 확장에 포함한 코레일 공식 시간표를 즉시 검색한다.
// 전용 Chrome·CDP·Python·네이티브 브릿지와 네트워크 요청을 사용하지 않는다.
import { KTX_TIMETABLE } from './ktxtimes.js';
import { timetableRows } from './ktxtimetable.js';
import { openCurrentTab } from './currenttab.js';
export const KORAIL_MAIN = 'https://www.korail.com/ticket/main';
export const KORAIL_SEARCH = 'https://www.korail.com/ticket/search/general';
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

/** 코레일 승차권 조회 페이지를 사이드패널 옆의 현재 탭에서 연다. */
export async function ktxOpen(_input = {}, { api = globalThis.chrome } = {}) {
  try {
    await openCurrentTab(KORAIL_SEARCH, { api });
    return { ok: true };
  } catch (error) {
    return failure(`코레일을 열지 못했습니다. ${String(error?.message || error)}`, 'TAB_OPEN_FAILED');
  }
}
