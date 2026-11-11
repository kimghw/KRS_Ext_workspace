// 항공 조건 읽기의 제한된 복구. 받은 화면 증거만 해석하며 DOM·파일·네트워크를 읽지 않는다.
export const FLIGHT_REPAIR_TASK = 'flightReadRepair';
export const FLIGHT_REPAIR_TIMEOUT_MS = 5000;
const HOST = 'com.krs.meetingroom';
const URLS = new Set(['https://www.koreanair.com/booking/search', 'https://www.koreanair.com/booking/select-flight/departure']);
const fail = (code, error) => ({ ok: false, code: `FLIGHT_REPAIR_${code}`, error });
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value, names) => plain(value) && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const string = (value, max) => typeof value === 'string' && value.length <= max;
const list = (value, min, max, check) => Array.isArray(value) && value.length >= min && value.length <= max && value.every(check);
const routeKeys = ['from', 'to'], paxKeys = ['adults', 'children', 'infants'];
const dateKeys = ['id', 'date', 'datetime', 'label', 'text'];
const clean = (value) => value.trim().replace(/\s+/g, ' ');

/** Chrome이 객체 키 순서를 바꿔 직렬화해도 같은 화면으로 비교한다. 배열 순서는 증거의 일부다. */
export function flightSnapshotKey(snapshot) {
  const ordered = (value) => Array.isArray(value) ? value.map(ordered)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value;
  return JSON.stringify(ordered(snapshot));
}

function civil(year, month, day) {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : null;
}

function fullDates(raw, id = false) {
  const value = clean(raw), found = [];
  let invalid = false;
  const add = (year, month, day) => { const date = civil(+year, +month, +day); if (date) found.push(date); else invalid = true; };
  for (const match of value.matchAll(/(?<!\d)(\d{4})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})(?:\s*일)?(?!\d)/g)) add(...match.slice(1));
  for (const match of value.matchAll(/(?<![A-Za-z\d])(\d{4})(\d{2})(\d{2})(?!\d)/g)) add(...match.slice(1));
  if (id) {
    // 달력 인스턴스의 불투명 접두어 뒤에 붙은 완전한 연월일. 끝 8자리만 임의로 잘라 쓰지는 않는다.
    const match = value.match(/^(?:[a-f\d]{32}|[A-Za-z0-9_-]{0,95}[A-Za-z_-][A-Za-z0-9_-]{0,95})(\d{4})(\d{2})(\d{2})$/i);
    if (match) add(...match.slice(1));
  }
  return { found: [...new Set(found)], invalid };
}

function monthDays(value) {
  const found = [];
  for (const match of value.matchAll(/(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) found.push([+match[1], +match[2]]);
  for (const match of value.matchAll(/(?<!\d)(\d{1,2})\s*[-./]\s*(\d{1,2})(?!\d)/g)) found.push([+match[1], +match[2]]);
  return found;
}

/** 증거가 부족하거나 모순되면 요청값으로 채우지 않고 실패한다. */
export function repairFlightRead(snapshot, input) {
  try {
    if (!keys(input, ['airline', 'from', 'to', 'date', 'hour', 'adults']) || input.airline !== 'KE'
      || !routeKeys.every((key) => typeof input[key] === 'string' && /^[A-Z]{3}$/.test(input[key])) || input.from === input.to
      || typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)
      || civil(...input.date.split('-').map(Number)) !== input.date
      || !Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23
      || !Number.isInteger(input.adults) || input.adults < 1 || input.adults > 9) {
      return fail('INVALID', '항공 읽기 복구의 조회 조건이 올바르지 않습니다.');
    }
    if (!keys(snapshot, ['version', 'airline', 'url', 'at', 'blocked', 'hidden', 'busy', 'conditions'])
      || snapshot.version !== 1 || snapshot.airline !== 'KE' || !URLS.has(snapshot.url)
      || !Number.isFinite(snapshot.at) || snapshot.at <= 0 || snapshot.at > Number.MAX_SAFE_INTEGER
      || !['blocked', 'hidden', 'busy'].every((key) => typeof snapshot[key] === 'boolean')) {
      return fail('INVALID', '항공 읽기 복구의 화면 정보가 올바르지 않습니다.');
    }
    const conditions = snapshot.conditions;
    if (!keys(conditions, ['routes', 'passengers', 'trips', 'dates', 'dateLabels', 'activeDay'])
      || !list(conditions.routes, 1, 4, (route) => keys(route, routeKeys) && routeKeys.every((key) => string(route[key], 12)))
      || !list(conditions.passengers, 1, 4, (pax) => keys(pax, paxKeys) && paxKeys.every((key) => string(pax[key], 12)))
      || !list(conditions.trips, 1, 4, (trip) => string(trip, 24))
      || !list(conditions.dates, 1, 1, (date) => keys(date, dateKeys) && dateKeys.every((key) => string(date[key], key === 'text' ? 512 : 240)))
      || !list(conditions.dateLabels, 1, 4, (label) => string(label, 160))
      || !string(conditions.activeDay, 80)) {
      return fail('INVALID', '항공 읽기 복구에 필요한 선택 조건을 한정하지 못했습니다.');
    }
    const snapshotKey = flightSnapshotKey(snapshot);
    if (new TextEncoder().encode(snapshotKey).length > 16_384) return fail('INVALID', '항공 읽기 복구의 화면 정보가 너무 큽니다.');
    if (snapshot.blocked || snapshot.hidden || snapshot.busy) return fail('BLOCKED', '안내·숨김·로딩 중인 항공 화면은 복구하지 않습니다.');
    if (!conditions.routes.every((route) => clean(route.from) === input.from && clean(route.to) === input.to)
      || !conditions.passengers.every((pax) => clean(pax.adults) === String(input.adults) && clean(pax.children) === '0' && clean(pax.infants) === '0')
      || !conditions.trips.every((trip) => /^(?:OW|편도|one[ -]?way)$/i.test(clean(trip)))) {
      return fail('CONDITION_MISMATCH', '화면의 구간·인원·편도가 조회 조건과 일치하지 않습니다.');
    }
    const selected = conditions.dates[0], evidence = [];
    const [, month, day] = input.date.split('-').map(Number);
    for (const field of dateKeys) {
      const value = fullDates(selected[field], field === 'id');
      if (value.invalid || value.found.some((date) => date !== input.date)) return fail('CONDITION_MISMATCH', '선택된 날짜의 연월일 증거가 서로 다릅니다.');
      if (['date', 'datetime'].includes(field) && clean(selected[field]) && !value.found.length) return fail('DATE_UNVERIFIED', '선택 날짜 속성의 전체 연월일을 읽지 못했습니다.');
      if (['label', 'text'].includes(field)) {
        const parts = monthDays(selected[field]);
        const days = [...selected[field].matchAll(/(?<!\d)(\d{1,2})\s*일/g)].map((match) => +match[1]);
        if (/^\d{1,2}$/.test(clean(selected[field]))) days.push(+clean(selected[field]));
        if (parts.some(([m, d]) => m !== month || d !== day) || days.some((d) => d !== day)) {
          return fail('CONDITION_MISMATCH', '선택 날짜에 표시된 월일이 다른 날짜를 가리킵니다.');
        }
      }
      evidence.push(...value.found);
    }
    if (!evidence.length) return fail('DATE_UNVERIFIED', '선택된 날짜에서 전체 연월일을 확인하지 못했습니다.');
    for (const label of conditions.dateLabels) {
      const full = fullDates(label), parts = monthDays(label);
      if (full.invalid || full.found.some((date) => date !== input.date) || !parts.length || parts.some(([m, d]) => m !== month || d !== day)) {
        return fail('CONDITION_MISMATCH', '화면에 표시된 출발일이 선택된 날짜와 일치하지 않습니다.');
      }
    }
    const active = clean(conditions.activeDay);
    if (active) {
      const full = fullDates(active), parts = monthDays(active), numbers = active.match(/\d+/g) || [];
      if (full.invalid || full.found.some((date) => date !== input.date)
        || (parts.length ? parts.some(([m, d]) => m !== month || d !== day) : !full.found.length && (numbers.length !== 1 || +numbers[0] !== day))) {
        return fail('CONDITION_MISMATCH', '결과 화면에서 선택된 출발일이 조회 조건과 다릅니다.');
      }
    }
    return { ok: true, proof: { version: 1, airline: 'KE', at: snapshot.at, url: snapshot.url, snapshotKey,
      condition: { from: input.from, to: input.to, date: input.date, adults: input.adults, trip: 'OW', children: 0, infants: 0 } } };
  } catch {
    return fail('INVALID', '항공 읽기 복구 정보를 해석하지 못했습니다.');
  }
}

/** native 작업을 한 번만 호출한다. 같은 화면 증거로 재검증한 답만 사용한다. */
export async function requestFlightReadRepair(snapshot, input, { api = globalThis.chrome, timeoutMs = FLIGHT_REPAIR_TIMEOUT_MS } = {}) {
  const expected = repairFlightRead(snapshot, input);
  if (!expected.ok) return expected;
  if (typeof api?.runtime?.sendNativeMessage !== 'function') return fail('UNAVAILABLE', '화면 읽기 복구를 위한 로컬 브릿지에 연결할 수 없습니다.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > FLIGHT_REPAIR_TIMEOUT_MS) return fail('INVALID', '화면 읽기 복구의 대기 시간이 올바르지 않습니다.');
  // 호출 중 원본 객체가 바뀌어도 보내는 증거와 비교 기준은 같아야 한다.
  const captured = JSON.parse(expected.proof.snapshotKey), query = JSON.parse(JSON.stringify(input));
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => api.runtime.sendNativeMessage(HOST, { task: FLIGHT_REPAIR_TASK, snapshot: captured, input: query })),
      new Promise((resolve) => { timer = setTimeout(() => resolve(fail('TIMEOUT', '화면 읽기 복구의 응답 시간이 지났습니다.')), timeoutMs); }),
    ]);
    if (keys(result, ['ok', 'code', 'error']) && result.ok === false && /^FLIGHT_REPAIR_[A-Z_]{1,40}$/.test(result.code)
      && string(result.error, 300) && result.error) return result;
    if (!keys(result, ['ok', 'proof']) || result.ok !== true || !keys(result.proof, ['version', 'airline', 'at', 'url', 'snapshotKey', 'condition'])
      || !keys(result.proof.condition, ['from', 'to', 'date', 'adults', 'trip', 'children', 'infants'])
      || !['version', 'airline', 'at', 'url', 'snapshotKey'].every((key) => result.proof[key] === expected.proof[key])
      || !Object.keys(expected.proof.condition).every((key) => result.proof.condition[key] === expected.proof.condition[key])) {
      return fail('RESPONSE', '브릿지가 돌려준 조건을 현재 화면 증거로 확인하지 못했습니다.');
    }
    return expected;
  } catch {
    return fail('UNAVAILABLE', '화면 읽기 복구를 위한 로컬 브릿지 호출에 실패했습니다.');
  } finally { clearTimeout(timer); }
}
