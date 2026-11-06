// KTX 조회 — 기존 네이티브 브릿지 통로에서 분리된 Python 조회 모듈을 호출한다.
// binjari에서 필요한 조회 코드만 추출했으며 기존 Claude/OCR 처리와 결합하지 않는다.
// 확장은 코레일 페이지에 스크립트를 주입하지 않는다(2026-11-06 사용자 결정).
export const KORAIL_MAIN = 'https://www.korail.com/ticket/main';
export const KTX_NATIVE_HOST = 'com.krs.meetingroom';
export const KTX_STATIONS = [
  ['서울', '0001'], ['용산', '0104'], ['영등포', '0002'], ['행신', '0390'], ['광명', '0501'], ['수원', '0003'], ['천안아산', '0502'], ['오송', '0297'],
  ['대전', '0010'], ['서대전', '0025'], ['김천구미', '0507'], ['서대구', '0506'], ['동대구', '0015'], ['경산', '0024'], ['밀양', '0017'], ['구포', '0019'],
  ['부산', '0020'], ['경주', '0508'], ['울산(통도사)', '0509'], ['포항', '0515'], ['마산', '0059'], ['창원중앙', '0512'], ['논산', '0027'], ['익산', '0030'],
  ['정읍', '0033'], ['광주송정', '0036'], ['목포', '0041'], ['전주', '0045'], ['순천', '0051'], ['여수EXPO', '0053'], ['강릉', '0115'], ['정동진', '0262'],
];
const names = new Set(KTX_STATIONS.map(([name]) => name));
const validSession = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
const failure = (error, code) => ({ ok: false, error, code });
const errorText = (error) => String(error?.message || error || '').slice(0, 2000);
const runtimeSetupHint = 'native/setup-ktx.ps1을 실행해 주세요.';
const bridgeSetupHint = 'native/install.ps1 -ExtensionId <확장ID>를 실행해 주세요.';

/** 이름·달력 날짜·시·인원을 가린다. 임의 경로·명령·설정은 실행부에 넘기지 않는다. */
function checkedInput(input) {
  if (!input || !names.has(input.from) || !names.has(input.to)) throw new Error('출발역과 도착역을 선택해 주세요.');
  if (input.from === input.to) throw new Error('출발역과 도착역이 같습니다.');
  const date = input.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('출발일을 확인해 주세요.');
  const day = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) throw new Error('출발일을 확인해 주세요.');
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) throw new Error('출발 시각은 0~23시로 선택해 주세요.');
  if (!Number.isInteger(input.adults) || input.adults < 1 || input.adults > 9) throw new Error('어른 인원은 1~9명으로 선택해 주세요.');
  return { from: input.from, to: input.to, date, hour: input.hour, adults: input.adults };
}

function runtimeFailure(result) {
  const error = errorText(result?.error);
  const code = typeof result?.code === 'string' ? result.code : 'BRIDGE_FAILED';
  if (/알 수 없는 작업|unknown task/i.test(error)) {
    return failure('현재 브릿지는 KTX 조회를 지원하지 않습니다. 최신 브릿지 등록을 갱신해 주세요. ' + bridgeSetupHint, 'BRIDGE_OUTDATED');
  }
  if (code === 'RUNTIME_MISSING') {
    return failure('KTX 실행 환경이 준비되지 않았습니다. ' + runtimeSetupHint + (error ? ' ' + error : ''), code);
  }
  return failure(error || 'KTX 실행부가 작업을 완료하지 못했습니다.', code);
}

/** 한 번의 네이티브 요청. 시간 초과·차단·실패를 자동으로 재시도하지 않는다. */
async function nativeCall(message, { api, timeoutMs }) {
  let timer;
  try {
    if (typeof api?.runtime?.sendNativeMessage !== 'function') {
      return failure('로컬 브릿지에 연결할 수 없습니다. 브릿지 설치·등록을 확인해 주세요. ' + bridgeSetupHint, 'BRIDGE_UNAVAILABLE');
    }
    const response = await Promise.race([
      api.runtime.sendNativeMessage(KTX_NATIVE_HOST, message),
      new Promise((resolve) => { timer = setTimeout(() => resolve(failure('KTX 실행부의 응답 시간이 지났습니다. 실행 상태를 확인한 뒤 다시 조회해 주세요.', 'BRIDGE_TIMEOUT')), timeoutMs); }),
    ]);
    if (!response || typeof response.ok !== 'boolean') return failure('KTX 실행부의 응답 형식이 올바르지 않습니다.', 'BRIDGE_RESPONSE');
    return response.ok ? response : runtimeFailure(response);
  } catch (error) {
    return failure('로컬 브릿지에 연결하지 못했습니다. 브릿지 설치·등록을 확인해 주세요. ' + bridgeSetupHint + ' ' + errorText(error), 'BRIDGE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

/** 실행부에서 받은 값만 표시하며 HTML이나 실행 명령은 결과로 받지 않는다. */
function checkedRows(rows) {
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('열차 목록 형식이 올바르지 않습니다.');
  const text = (value, limit) => {
    if (typeof value !== 'string' || value.length > limit) throw new Error('열차 정보 형식이 올바르지 않습니다.');
    return value;
  };
  const seat = (value) => {
    if (value == null) return null;
    if (typeof value !== 'object' || typeof value.soldOut !== 'boolean' || typeof value.soon !== 'boolean') throw new Error('좌석 정보 형식이 올바르지 않습니다.');
    return { price: text(value.price, 80), soldOut: value.soldOut, soon: value.soon };
  };
  return rows.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('열차 정보 형식이 올바르지 않습니다.');
    const dep = text(row.dep, 5), arr = text(row.arr, 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dep) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(arr)) throw new Error('열차 시각 형식이 올바르지 않습니다.');
    return { train: text(row.train, 80), no: text(row.no, 20), dep, arr, took: text(row.took ?? '', 80), gen: seat(row.gen), spec: seat(row.spec) };
  });
}

/** 조건을 기존 브릿지의 조회 모듈로 보내 첫 결과 페이지를 받는다. 예약·좌석 선택은 하지 않는다. */
export async function ktxSearch(input, { api = globalThis.chrome, onStage = () => {}, timeoutMs = 130000 } = {}) {
  let query;
  try { query = checkedInput(input); } catch (error) { return failure(error.message, 'INPUT_INVALID'); }
  onStage('열차 조회 중');
  const result = await nativeCall({ task: 'ktxSearch', input: query }, { api, timeoutMs });
  if (!result.ok) return result;
  try {
    if (!validSession(result.session)) throw new Error('조회 화면의 연결 정보가 올바르지 않습니다.');
    return { ok: true, rows: checkedRows(result.rows), session: result.session };
  } catch (error) {
    return failure(error.message, 'BRIDGE_RESPONSE');
  }
}

/** 그 조회 화면만 앞으로 연다. 좌석이나 예매 단추는 누르지 않는다. */
export async function ktxOpen({ session } = {}, { api = globalThis.chrome, timeoutMs = 25000 } = {}) {
  if (!validSession(session)) return failure('조회 화면이 없습니다. 먼저 KTX를 조회해 주세요.', 'SESSION_INVALID');
  const result = await nativeCall({ task: 'ktxOpen', session }, { api, timeoutMs });
  return result.ok ? { ok: true } : result;
}
