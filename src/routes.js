// 출장지마다 지난번에 쓴 교통편을 기억해 두었다가 다음에 먼저 쓴다(2026-10-04 사용자 지정: "한번 설정한 교통편은 다음에도 우선하여 재사용").
// 화면도 저장소도 모른다 — 무엇을 기억하고 무엇을 되살릴지만 셈한다. 담아 두는 것은 패널(attendpanel.js)이 chrome.storage.local 의 ROUTES_KEY 에 한다.
//
// 기억하는 것(출장지에 적은 글이 열쇠):
//   go · back   신청 폼의 가는 편·오는 편 아이콘({t: 기차·비행기·버스, g: 기차의 좌석 등급} — 2026-11-03 부터 편마다). 모르는 편은 null 이다
//               (사이트에서 읽었는데 그 편의 줄이 없다 — 비행기·버스인 편은 사전정산에 줄이 없다). 예전 꼴(transport 목록·trainGrade)도 읽는다
//   path        KTX 로 간 길 — 근무지 쪽에서의 역의 차례([부산, 서울], 갈아탔으면 [부산, 오송, 목포]). KTX 로 가지 않았으면 null
//   date        그 출장의 출발일. 더 나중의 출장이 앞의 것을 덮어쓴다
//
// 기억은 두 곳에서 온다. 패널이 사전정산을 만들었을 때(routeOfPlan — 폼에서 고른 그대로), 그리고 사전정산 화면의 교통편 줄을 읽었을 때
// (routeOfRows — 사이트에서 손으로 고친 것까지 따라간다). 다음에 같은 출장지를 적으면 아이콘이 그때대로 골라지고(withRoute),
// 사전정산의 KTX 줄은 그 길로 짓는다(src/travel.js 의 settlePlan 이 path 를 받는다) — 요금은 그때의 값이 아니라 지금 운임표의 정가다.

import { TRANSPORTS, DEFAULT_GRADE, TRAIN_GRADES, stationOf, legsOfRows, legParts, pickOfRow, pathKnown, formLegs } from './travel.js';

/** chrome.storage.local 에 담는 이름. 값은 { 출장지: { go, back, path, date } } 다. */
export const ROUTES_KEY = 'tripRoutes';
/** 기억해 두는 출장지 수. 넘치면 오래된 출장부터 버린다. */
export const ROUTES_MAX = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN = TRANSPORTS.map((t) => t.value);
const TRAIN = 'train';

/**
 * 출장지에 적은 글을 열쇠로 — 앞뒤와 겹친 빈칸만 고른다("경기도  고양시 킨텍스 " = "경기도 고양시 킨텍스").
 * 여비계산서에서 읽은 출장지는 "출장지(장소)"라(src/travel.js 의 tripLocation) 끝의 괄호(장소)는 뗀다 — "대전(한국기계연구원)" = "대전".
 */
export const routeKey = (place) => String(place || '').replace(/(\S)\s*\([^()]*\)\s*$/, '$1').replace(/\s+/g, ' ').trim();

/** 편 하나의 기억을 고른다 — 아는 교통편이면 {t, g}(등급은 기차만), 아니면 null(모르는 편). */
const legIn = (p) => (KNOWN.includes(p?.t) ? { t: p.t, g: p.t === TRAIN && TRAIN_GRADES.some((x) => x.value === p.g) ? p.g : DEFAULT_GRADE } : null);

/**
 * 기억 하나의 모양을 고른다. 쓸 수 없는 것(두 편 모두 모른다, 날짜가 틀렸다)이면 null.
 * 예전 꼴(교통편 목록 transport · 기차 등급 trainGrade)은 목록의 첫 교통편을 두 편에 둔다 — 그때는 편을 가리지 않았다.
 */
function clean(entry) {
  if (!DATE_RE.test(entry?.date || '')) return null;
  let go = legIn(entry.go);
  let back = legIn(entry.back);
  if (!go && !back && !('go' in entry) && !('back' in entry)) {
    const old = KNOWN.find((v) => (Array.isArray(entry.transport) ? entry.transport : []).includes(v));
    go = back = legIn({ t: old, g: entry.trainGrade });
  }
  if (!go && !back) return null;
  const path = Array.isArray(entry.path) && entry.path.length >= 2 && entry.path.every((s) => typeof s === 'string' && s) ? [...entry.path] : null;
  return { go, back: back && { ...back }, path, date: entry.date };
}

/**
 * 패널이 사전정산을 만들었을 때 기억할 것 — 폼에서 고른 가는 편·오는 편과, KTX 줄이 들어갔으면 그 길(근무지 쪽에서의 역의 차례)이다.
 * @param {object} plan src/travel.js settlePlan 의 결과
 */
export function routeOfPlan(plan) {
  return clean({ go: plan?.legs?.go, back: plan?.legs?.back, path: plan?.trans?.length ? plan.path : null, date: plan?.sDate });
}

/**
 * 사전정산 화면의 교통편 줄에서 기억할 것 — 사이트에서 손으로 고친 것까지 따라간다. 줄이 없으면 null(무엇을 골랐는지 알 수 없다).
 *
 * 편마다 그 편의 줄의 교통편·등급이고, 줄이 없는 편은 모른다(null — 담을 때 같은 출장의 기억에서 가져온다, keepRoute). 길은 가는 편이 KTX 일 때
 * 그 편이 지난 역의 차례다(가는 편이 KTX 가 아니고 오는 편이 KTX 면 그것을 뒤집는다). 줄에 적힌 곳에서 역을 못 찾거나 운임표로 이어지지 않는
 * 길이면 길은 기억하지 않는다.
 * @param {object[]} rows src/travel.js parseTransRows 의 줄
 * @param {{from: string, to?: string}} trip 그 출장의 기간
 */
export function routeOfRows(rows, trip) {
  const { go, back } = legsOfRows(rows, trip);
  const [g, b] = [go, back].map((leg) => legIn(pickOfRow(leg)));
  if (!g && !b) return null;
  const stops = (leg) => [leg.dep, ...legParts(leg).map((p) => p.arr)].map((s) => stationOf(s));
  const raw = g?.t === TRAIN ? stops(go) : b?.t === TRAIN ? stops(back).reverse() : null;
  return clean({ go: g, back: b, path: raw && raw.every(Boolean) && pathKnown(raw) ? raw : null, date: trip?.from });
}

/**
 * 기억을 담는다. 같은 출장지에 더 나중의 출장이 이미 적혀 있으면 그대로 둔다(예전 출장 카드를 펴도 요즘 것을 덮어쓰지 않는다).
 * 같은 출장을 다시 담을 때 모르는 편(null)은 앞의 기억의 그 편이다 — 사전정산에 줄이 없는 비행기 편을 사이트에서 읽은 것이 지우지 않게.
 * ROUTES_MAX 를 넘으면 오래된 출장부터 버린다. 바뀐 것이 없으면 받은 것을 그대로 돌려준다(저장할지 가릴 수 있다).
 * @returns {object} 새 기억 묶음
 */
export function keepRoute(store, place, entry) {
  const key = routeKey(place);
  let next = clean(entry);
  const all = store && typeof store === 'object' ? store : {};
  if (!key || !next) return all;
  const old = clean(all[key]);
  if (old && old.date === next.date) next = { ...next, go: next.go || old.go, back: next.back || old.back };
  if (old && (old.date > next.date || JSON.stringify(old) === JSON.stringify(next))) return all;
  const kept = Object.entries({ ...all, [key]: next }).sort(([, a], [, b]) => String(b?.date || '').localeCompare(String(a?.date || ''))).slice(0, ROUTES_MAX);
  return Object.fromEntries(kept);
}

/** 그 출장지에 기억해 둔 교통편. 없으면 null. */
export const recallRoute = (store, place) => clean(store?.[routeKey(place)]);

/**
 * 출장지를 적었을 때의 가는 편·오는 편 아이콘 — 기억해 둔 것이 있으면 그것(모르는 편은 아는 편을 따른다), 없으면 기본(기차 일반석)이다.
 * 이 신청서에서 아이콘을 손대지 않았을 때만 쓴다(패널이 가린다).
 * @returns {{go: {t: string, g: string}, back: {t: string, g: string}}}
 */
export const withRoute = (memo) => formLegs(memo);
