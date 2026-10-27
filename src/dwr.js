// 일일 업무(Daily Work Report) — e-Class 「일일업무통계 대시보드」의 내 것을 받아 현황 탭의 일일 업무 카드(dwrbox.js)가 그릴 값으로 바꾼다
// (2026-10-27 사용자 지정: "현황에 eclass 에서 내일일 업무 보고 대쉬보드를 갖어와서 보는 기능 추가해줘").
//
// 실측(2026-10-27 CDP, 읽기 전용 GET 만):
//   e-Class 메뉴 Daily Work Report(workMan/wmmain.aspx) 의 머리 줄(topMenu.aspx)에 「일일업무통계 대시보드」 단추가 있고 /dwrdashboard/home/index 를 새 창으로 연다.
//   그 화면(ASP.NET MVC, amCharts)은 첫 응답에 업무 내역 전체(2012년부터)를 박아 두고, 기간을 바꾸면 아래 JSON 을 다시 부른다 — 모두 GET, 쿠키만:
//     /dwrdashboard/Home/GetAllDashboardData?userId=<ID>  (약 1초, 870KB) → { vacation, workStats: { workloadbyWork, workloadbyWorkCategory, workdetails }, yearlyActivity,
//                                                          surveyorYearlyStats, surveyorPeriodStats, isSurveyor }. startdate·enddate 를 줘도 업무 내역은 전체가 온다 — 기간은 화면이 거른다.
//       vacation 의 열쇠는 이 답에서만 remaininG_ANNUAL_LEAVE 꼴(GetVacation 은 REMAINING_ANNUAL_LEAVE) — 대소문자를 가리지 않고 읽는다.
//       workdetails 한 줄: { WorkDate '2026-09-30T00:00:00', wTitle 업무명, WorkCategory 업무분류, workContent 내용, wMinTotal 분, OverMin 분, isAlways 수시, isCpl 완료, cDate 완료 예정일, sDate }
//         — 날짜 내림차순. 날짜가 없는 칸은 {} 로 온다. workloadbyWork(WorkDate '2026년 1월 8일' · WorkTitle · WTIME 분)와 기간 합·업무명별 합이 같다(2026-10-27 맞춰 봄) — 그래서 workdetails 하나만 쓴다.
//     /dwrdashboard/Home/GetWeeklyWorkHours?userId=<ID>  → { weeklyHours } 주간 누적근무시간(느리다 — 3~6초. 화면도 따로 부른다)
//     /dwrdashboard/Home/GetOvertimeHours?userId=<ID>&startDate=&endDate=  → { overtimeHours } 2026-01-01 이후 시간외근무(그 전은 업무 내역의 OverMin 합)
//     — 이 둘과 vacation·yearlyActivity 는 카드에서 뺐다(2026-10-27 사용자 지정: "최근 업무, 활동성 이런건 필요 없음. 업무시간 이런것도 필요 없음"). 업무 내역만 쓴다.
//   userId 가 없으면 GetWorkStats 말고는 답하지 않는다(오류·빈 답). 부서 코드(deptCode)는 개인 조회에 필요 없다.
//   **Referer 가 e-Class 가 아니면 막는다** — /dwrdashboard/Home/ErrorPopup("잘못된 접근입니다", 로그인 화면으로)으로 리다이렉트. 같은 eclass 탭에서도 referrerPolicy 'no-referrer' 면 막히고
//   'origin'(https://eclass.krs.co.kr/)만 줘도 된다. 확장 페이지의 요청에는 그 Referer 가 없어서, 이 확장이 /dwrdashboard 로 보내는 요청에만 Referer 를 채우는 세션 규칙을 건다(allowReferer —
//   declarativeNetRequest, 권한 declarativeNetRequestWithHostAccess).
//   userId 는 e-Class 홈 머리글의 사용자 ID(src/whoami.js portalUserId — 홈 앞 40KB 안에 있다)다. 한 번 알아내면 저장소에 둔다(dwrbox.js).
//
// 업무 내역을 업무별 비율과 참여율로 셈한 목표로 바꾸는 것은 src/workshare.js 다.
//
// 순수한 것(rangeOf·dayOf·rowsOf — DOM·fetch 없음)과 조회(fetch* — 확장에서 바로, host_permissions 로 쿠키가 실린다)가 같이 있다.

import { ORIGIN, PORTAL_HOME_URL } from './config.js';
import { AuthError, directFetch, portalState } from './net.js';
import { portalUserId } from './whoami.js';

export const DWR_BASE = `${ORIGIN}/dwrdashboard`;
/** 대시보드 원본(사이트의 「일일업무통계 대시보드」 단추가 여는 주소). */
export const DWR_HOME = `${DWR_BASE}/home/index`;
/** 일일 업무 작성 화면(e-Class 메뉴 Daily Work Report). */
export const DWR_WRITE = `${ORIGIN}/eClassVer4/Common/Default?title=Daily%20Work%20Report&menu=%2Fintra%2FIntranet%2FVSDotNet%2FworkMan%2Fwmmain.aspx&menuID=MBR00004&newWindow=False&PmenuID=MBR00001`;

/** 알아낸 e-Class 사용자 ID 를 담는 storage 키. */
export const USER_KEY = 'eclassUserId';
/** 고른 기간(year·month·week)과 카드를 펴 두었는지. */
export const RANGE_KEY = 'dwrRange';
export const OPEN_KEY = 'dwrOpen';
/** 기간 단추 — 대시보드의 올해(1월 1일부터, 첫 화면) · 최근 한달 · 최근 7일. */
export const RANGES = Object.freeze({ year: '올해', month: '한 달', week: '7일' });
/** 받아 둔 것을 다시 받지 않는 동안. ↻ 는 이것과 상관없이 받는다. */
export const DWR_TTL_MS = 10 * 60 * 1000;
export const LOGIN_MESSAGE = '로그인이 필요합니다. eclass 에 로그인한 뒤 다시 조회하세요.';
/** eclass 로그인은 살아 있는데 대시보드가 돌려보냈다 — Referer 규칙이 걸리지 않았을 때(확장을 다시 올리기 전 등). */
export const REFUSED_MESSAGE = '일일업무통계 대시보드가 요청을 받지 않았습니다("잘못된 접근") — 확장을 다시 올린 뒤 ↻ 를 눌러 주세요.';

const two = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 기간 단추의 시작·끝(YYYY-MM-DD) — 대시보드의 버튼과 같은 셈이다. 올해는 1월 1일부터, 한 달은 지난달의 같은 날부터, 7일은 7일 전부터 오늘까지.
 * @param {'year'|'month'|'week'} kind
 * @param {string} today YYYY-MM-DD
 */
export function rangeOf(kind, today) {
  const [y, m, d] = String(today).split('-').map(Number);
  const from = kind === 'month' ? new Date(y, m - 2, d) : kind === 'week' ? new Date(y, m - 1, d - 7) : new Date(y, 0, 1);
  return { from: ymd(from), to: today };
}

/** 사이트의 날짜 칸 하나를 YYYY-MM-DD 로 — '2026-09-30T00:00:00' · '2026년 9월 30일' · {}(없음) → ''. */
export function dayOf(v) {
  if (typeof v !== 'string') return '';
  const iso = v.slice(0, 10);
  if (DATE_RE.test(iso)) return iso;
  const m = v.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  return m ? `${m[1]}-${two(m[2])}-${two(m[3])}` : '';
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * GetAllDashboardData 의 업무 내역을 한 꼴로 — 날짜 내림차순(같은 날은 받은 차례). 날짜가 없는 줄은 뺀다.
 * @returns {{date:string, title:string, category:string, content:string, minutes:number, overMin:number, always:boolean, done:boolean, due:string}[]}
 */
export function rowsOf(raw) {
  const stats = raw?.workStats || raw || {};
  const list = stats.workdetails || stats.workdetailsByDept || [];
  return (Array.isArray(list) ? list : [])
    .map((x, i) => ({
      date: dayOf(x?.WorkDate), title: str(x?.wTitle), category: str(x?.WorkCategory), content: str(x?.workContent),
      minutes: num(x?.wMinTotal), overMin: num(x?.OverMin), always: x?.isAlways === true || x?.isAlways === 1,
      done: x?.isCpl === true || x?.isCpl === 1, due: dayOf(x?.cDate), i,
    }))
    .filter((r) => r.date)
    .sort((a, b) => b.date.localeCompare(a.date) || a.i - b.i)
    .map(({ i, ...r }) => r);
}

/** 시간을 화면 글로 — 1,229 · 4.5 · 0. */
export const hoursText = (h) => (Number.isInteger(h) ? h.toLocaleString('ko-KR') : (Math.round(h * 10) / 10).toLocaleString('ko-KR'));

/* ------------------------------------------------------------ 조회 */

/** Referer 를 채우는 세션 규칙의 번호(이 확장의 다른 규칙과 겹치지 않게). */
export const REFERER_RULE_ID = 4801;

/**
 * 이 확장이 보내는 /dwrdashboard 요청에 e-Class 의 Referer 를 채우는 세션 규칙(브라우저를 닫을 때까지). 몇 번을 불러도 규칙은 하나다.
 * 요청한 쪽(initiatorDomains)을 이 확장으로 묶어 다른 사이트의 요청은 건드리지 않는다. declarativeNetRequest 가 없으면(검사) 아무것도 하지 않는다.
 * @returns {Promise<boolean>} 걸었는가
 */
export async function allowReferer(dnr = globalThis.chrome?.declarativeNetRequest, extId = globalThis.chrome?.runtime?.id) {
  if (!dnr?.updateSessionRules || !extId) return false;
  await dnr.updateSessionRules({
    removeRuleIds: [REFERER_RULE_ID],
    addRules: [{
      id: REFERER_RULE_ID,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: `${ORIGIN}/` }] },
      condition: { urlFilter: `|${DWR_BASE}/`, initiatorDomains: [extId], resourceTypes: ['xmlhttprequest'] },
    }],
  });
  return true;
}
let refererReady = null;
/** 한 번만 건다 — 실패하면 다음에 다시. */
const referer = () => (refererReady ||= allowReferer().catch(() => { refererReady = null; return false; }));

/**
 * 대시보드의 JSON 하나 — 리다이렉트는 따라가지 않는다(로그인이 풀렸으면 로그인 화면으로 보내는데, 포털 홈처럼 따라가다 남은 쿠키를 지울 수 있다 — src/net.js portalState).
 * 리다이렉트는 로그인이 풀렸거나 Referer 를 못 채워 막힌 것이다 — 포털 로그인이 살아 있으면 막힌 것(REFUSED_MESSAGE), 아니면 AuthError. JSON 이 아니면(로그인 화면) AuthError.
 * @param {{fetchImpl:Function, portal:()=>Promise<string>}} opts portal 은 src/net.js portalState('alive'·'expired'·'unknown')
 */
async function getJson(url, { fetchImpl, portal }) {
  await referer();
  let res;
  try {
    res = await fetchImpl(url, { redirect: 'manual' });
  } catch (err) {
    if (err?.status !== 0) throw err;
    const state = await portal().catch(() => 'unknown');
    if (state === 'alive') throw new Error(REFUSED_MESSAGE);
    throw new AuthError(LOGIN_MESSAGE, { portal: state });
  }
  try {
    return JSON.parse(String(res?.html ?? ''));
  } catch {
    throw new AuthError(LOGIN_MESSAGE);
  }
}

const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/**
 * e-Class 홈 머리글의 사용자 ID. 홈도 리다이렉트를 따라가지 않는다(src/net.js portalState 와 같은 까닭). 못 찾으면 빈 글.
 * @param {{fetchImpl?:Function, parse?:(html:string)=>Document}} [opts] fetchImpl·parse 는 검사용
 */
export async function fetchUserId({ fetchImpl = directFetch, parse = (html) => new DOMParser().parseFromString(html, 'text/html') } = {}) {
  let res;
  try {
    res = await fetchImpl(PORTAL_HOME_URL, { redirect: 'manual' });
  } catch (err) {
    if (err?.status === 0) throw new AuthError(LOGIN_MESSAGE);
    throw err;
  }
  const html = String(res?.html ?? '');
  if (/id="tbUserId"|name="UserId"/i.test(html)) throw new AuthError(LOGIN_MESSAGE);
  return portalUserId(parse(html));
}

/**
 * 대시보드 한 번 — 업무 내역.
 * @returns {Promise<{rows: ReturnType<typeof rowsOf>}>}
 */
export async function fetchDashboard(userId, { fetchImpl = directFetch, portal = portalState } = {}) {
  const raw = await getJson(`${DWR_BASE}/Home/GetAllDashboardData?${q({ userId })}`, { fetchImpl, portal });
  if (!raw || typeof raw !== 'object' || !raw.workStats) throw new Error('대시보드가 업무 내역을 주지 않았습니다');
  return { rows: rowsOf(raw) };
}
