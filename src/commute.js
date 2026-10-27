// 출퇴근 위반 — HR 자율출퇴근 체크리스트(근태 > 개인근태현황, /wrk/wrkcommute/wrkcommute100)의 날마다 출근·퇴근 기록을
// 그 날의 근무시간(계획)과 맞춰 본다(2026-10-27 사용자 지정: "유연에 내 출근/퇴근 실제 시간이랑 기록되어 있는 시간이랑 비교해서
// 시간 위반한 내역을 볼 수 있도록"). 화면도 네트워크도 모른다 — 읽는 일은 src/hr.js 의 hrCommutes 가 한다.
//
// 줄 하나(2026-10-27 실제 응답): { workDate: '2026-10-08', days: '목', planTime: '0830 ~ 1730', startTime: '0825', endTime: '1206',
// workStatus: '정기 건강검진(13:00~18:00)', isPlanNotFollowed: 'O', nextDayInd: '' }.
// HR 의 위반 표시(isPlanNotFollowed)는 계획보다 늦게 왔거나 일찍 갔으면 근태로 비운 시간이어도 'O' 다 — 출장·연차·건강검진 날이 다 걸린다.
// 그래서 표시를 믿지 않고 다시 판정한다: 계획 시간 가운데 **근태로도 점심(12~13시)으로도 덮이지 않은** 시간에 자리에 없었으면 위반이다.
// 출근·퇴근 기록이 없는 것은 보지 않는다 — 기록이 2~3일 늦게 올라온다(2026-10-27 사용자 지정: "출퇴근 없음은 빼줘").
// 있는 기록만 지각·조퇴로 본다.

const pad = (n) => String(n).padStart(2, '0');

/** 점심 — 반차 시간대와 같은 12~13시(2026-10-08 사용자 지정: 오전 = 출근~12시, 오후 = 13시~퇴근). */
export const LUNCH = [12 * 60, 13 * 60];

/** 근태 한 건이 이만큼(8시간) 넘게 걸쳐 있으면 하루 전체다 — 연차·출장은 계획과 다른 09:00~18:00 으로 적혀 온다. */
const WHOLE_DAY_MIN = 8 * 60;

/** "0830" · "08:30" → 분. 아니면 null. */
const minutes = (s) => {
  const m = /^(\d{2}):?(\d{2})$/.exec(String(s ?? '').trim());
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
};

/** 분 → "08:30". 하루를 넘긴 퇴근(다음 날)도 시계 글로 적는다. */
export const clockOf = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

/** 분 → "12분" · "1시간 24분". */
export const spanText = (mins) => (mins >= 60 ? `${Math.floor(mins / 60)}시간${mins % 60 ? ` ${mins % 60}분` : ''}` : `${mins}분`);

/**
 * 근태내역 글 → 근태 건들. "정기 건강검진(13:00~18:00)" 꼴이 쉼표·줄바꿈으로 여럿 올 수 있다고 보고 다 줍는다.
 * 시각이 없는 건이 있으면 하루 전체로 본다(무엇인지 모르는 근태로 위반을 만들지 않는다).
 * @returns {{ whole: boolean, spans: Array<{label: string, from: number, to: number}> }}
 */
export function leavesOf(text) {
  const s = String(text ?? '').trim();
  const spans = [];
  for (const m of s.matchAll(/([^,()\n]*)\((\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})\)/g)) {
    const from = +m[2] * 60 + +m[3];
    const to = +m[4] * 60 + +m[5];
    if (to > from) spans.push({ label: m[1].trim(), from, to });
  }
  const bare = s.replace(/[^,()\n]*\(\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}\)/g, '').replace(/[\s,]/g, '');
  return { whole: !!bare || spans.some((x) => x.to - x.from >= WHOLE_DAY_MIN), spans };
}

/** [from, to) 가운데 덮이지 않은 분. covers 는 [from, to] 쌍들이다. */
function uncovered(from, to, covers) {
  if (!(to > from)) return 0;
  let left = to - from;
  const parts = covers.map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let at = from;
  for (const [a, b] of parts) {
    if (b <= at) continue;
    left -= b - Math.max(a, at);
    at = b;
  }
  return left;
}

/**
 * 하루치 판정.
 * @param {object} row HR 체크리스트의 줄
 * @returns {null | {date, dow, plan, start, end, status, hr, faults: Array<{kind: 'late'|'early', min: number}>, covered: boolean}}
 *   계획이 없는 줄은 null. covered 는 근태로 하루가 다 덮인 날이다.
 */
export function judgeDay(row) {
  const [planFrom, planTo] = String(row?.planTime ?? '').split('~').map(minutes);
  if (planFrom == null || planTo == null || planTo <= planFrom) return null;
  const date = String(row.workDate || '');
  const start = minutes(row.startTime);
  let end = minutes(row.endTime);
  // 다음 날 퇴근(nextDayInd 'Y') — 자정을 넘겼으면 하루를 더한다.
  if (end != null && (row.nextDayInd === 'Y' || (start != null && end < start))) end += 24 * 60;
  const leave = leavesOf(row.workStatus);
  const day = {
    date, dow: String(row.days || ''), plan: `${clockOf(planFrom)}~${clockOf(planTo)}`,
    start: start == null ? '' : clockOf(start), end: end == null ? '' : clockOf(end), nextDay: end != null && end >= 24 * 60,
    status: String(row.workStatus || '').trim(), hr: row.isPlanNotFollowed === 'O', faults: [], covered: leave.whole,
  };
  if (leave.whole) return day;
  const covers = [LUNCH, ...leave.spans.map((x) => [x.from, x.to])];
  if (start != null) {
    const late = uncovered(planFrom, start, covers);
    if (late > 0) day.faults.push({ kind: 'late', min: late });
  }
  if (end != null) {
    const early = uncovered(end, planTo, covers);
    if (early > 0) day.faults.push({ kind: 'early', min: early });
  }
  return day;
}

/** 위반 한 건의 말 — "지각 12분" · "조퇴 1시간 24분". */
export function faultText(day) {
  return day.faults.map((f) => `${f.kind === 'late' ? '지각' : '조퇴'} ${spanText(f.min)}`);
}

/**
 * 체크리스트 줄들 → 위반한 날(최근 날이 위)과 셈.
 * @param {{today?: string}} at 오늘(YYYY-MM-DD)
 * @returns {{ days: object[], judged: number, excused: number }} excused 는 HR 이 위반(O)으로 표시했지만 근태로 덮여 뺀 날 수
 *   (오늘은 세지 않는다 — 끝나지 않은 날이라 HR 이 표시한 것이다)
 */
export function commuteBreaches(rows, at = {}) {
  const all = (Array.isArray(rows) ? rows : []).map((r) => judgeDay(r)).filter(Boolean);
  const days = all.filter((d) => d.faults.length).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { days, judged: all.length, excused: all.filter((d) => d.hr && !d.faults.length && d.date !== at.today).length };
}

/* ------------------------------------------------------------ 변경신청 · 홈 카드 */
// 위반 줄에서 HR 「출/퇴근기록 변경신청」을 바로 한다(2026-10-27 사용자 지정: "출퇴근 시간 변경 기능을 추가해줘") — 일감은 src/attend.js buildCommuteJob,
// 행위는 attend.commute. 홈 WORKSPACE 카드에는 지난 7일의 위반이 뜨고 거기서 변경으로 간다("출퇴근 위반이 발생하면 여기에 뜨고 수정할 수 있도록" ·
// "워크스페이스는 1주일 이전까지만 보이게 해줘").

/** 패널이 올린 변경신청 — { [YYYY-MM-DD]: { at, docNo, start, end } }. 결재돼 HR 기록이 바뀌면 그 날은 위반에서 저절로 빠지고, 그 전에는 "변경 신청함"이다. */
export const COMMUTE_FIX_KEY = 'attendCommuteFix';
/** 홈 카드가 보는 지난 7일의 체크리스트 줄 — { day: 읽은 날, at, rows } (배경이 하루 한 번 읽어 담는다 — src/commuteweek.js). */
export const COMMUTE_WEEK_KEY = 'hrCommuteWeek';
/** 홈 카드에 보이는 날 수(오늘 포함). */
export const WEEK_DAYS = 7;
/** 변경신청을 적어 둔 것을 이만큼 지나면 버린다(결재가 늦어도 이 안에는 끝난다). */
const FIX_KEEP_DAYS = 60;

/** YYYY-MM-DD 의 n 일 전. */
export function daysBefore(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const t = new Date(y, m - 1, d - n);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** 지난 7일(오늘 포함)의 위반한 날 — 홈 WORKSPACE 카드에 뜨는 것. 최근 날이 위. */
export function recentBreaches(rows, today, days = WEEK_DAYS) {
  const from = daysBefore(today, days - 1);
  return commuteBreaches(rows, { today }).days.filter((d) => d.date >= from && d.date <= today);
}

/**
 * 변경신청의 기본 시각 — 위반한 쪽만 계획 시각으로 고치고 다른 쪽은 찍힌 그대로(없으면 계획).
 * 지각이면 출근을 계획 시작으로, 조퇴면 퇴근을 계획 끝으로. 사람이 칸에서 고친다.
 * @returns {{ start: string, end: string, nextDay: boolean }} "HH:MM"
 */
export function fixDefaults(day) {
  const [planStart, planEnd] = String(day?.plan || '').split('~');
  const late = day?.faults?.some((f) => f.kind === 'late');
  const early = day?.faults?.some((f) => f.kind === 'early');
  return {
    start: late || !day?.start ? planStart : day.start,
    end: early || !day?.end ? planEnd : day.end,
    nextDay: !early && !!day?.end && !!day.nextDay,
  };
}

/** 적어 둔 변경신청 가운데 오래된 것을 버린다. */
export function pruneFixes(fixes, today) {
  const from = daysBefore(today, FIX_KEEP_DAYS);
  return Object.fromEntries(Object.entries(fixes || {}).filter(([date, v]) => date >= from && v && typeof v === 'object'));
}
