// 여비계산서 **사후정산**(eclass /BusinessTrip/AfterTrip) — 사용자가 숙박 증빙·항공권을 넣으면 자동으로 짓고 올린다(2026-10-03 사용자 지정).
//
//   증빙 파일(이미지·PDF) → Claude 가 한 장씩 읽어 기록(input.yaml 의 receipt) → 여기서 숙박비·교통비·항공 마일리지로 묶는다
//   → src/trip.js 의 tripAfterSave 가 사후정산 입력 화면의 폼(AfterTrip/Save, multipart)으로 올린다.
//
// 사후정산을 하는 조건(사용자 지정): **비행기를 탔거나 1박 이상**이다. 당일 출장이면 숙박비 내역은 넣지 않는다.
//
// 교통비 내역은 출장 카드의 **가는 편·오는 편**에서 나온다(2026-10-03 사용자 지정, 셈은 src/travel.js 의 legPlan).
// 처음에는 사전정산대로 골라져 있고, 카드에서 손으로 바꾸거나 항공권을 넣으면 그 날짜의 편이 비행기로 바뀐다 —
// 두 편이 같은 날이면 시각으로 가린다. 항공권이 한 편뿐이면 나머지 편은 KTX 다. 항공권을 넣었거나 편을 바꿨을 때만
// 두 편을 교통비 내역으로 넣고, 사전정산 그대로면 넣지 않는다(사전정산의 값이 선다).
// **기차표는 증빙으로 받지 않는다 — KTX 는 운임표의 정가로 넣는다.** 당일 출장의 증빙은 **그 출장지에서 결제한 영수증**이다.
//
// 읽지 못한 **필수** 값이 있으면 올리지 않고 무엇이 비었는지 말한다 — 틀린 값으로 올리느니 비워 두고 사람이 채우게 한다.
// 영수증에 적힌 그 밖의 정보(조식 포함·예약번호 …)는 notes 로 알린다.
//
// 이 파일은 DOM·네트워크 없이 돈다. 사이트 화면의 칸 이름(lodge_*, tr_*, air_*)은 2026-10-03 실제 사후정산 입력 화면 소스에서 확인했다.

import { legsOfRows, ticketsOf, seatTickets, picksWithTickets, legPlan, legTimesAll, legParts } from './travel.js';
import { milesOf, isFirstSeat, describeMiles } from './mileage.js';
import { TRAVEL_RULES } from './travelspec.js';

/** 사후정산 입력 화면의 교통수단 선택지 값(2026-10-03 화면). 사전정산 화면과 달리 한국어 이름이 그대로 값이다. */
export const AFTER_TRANSPORT = { plane: '비행기', train: '기차(KTX등)', subway: '지하철', ship: '선박', bus: '버스', etc: '기타(택시등)' };
/** 사전정산 화면의 교통수단 값 — 비행기를 탔는지 여기서 본다. */
export const PRE_PLANE = 'Airplane';
/** 국내 숙박의 출장지(주재국) 코드와 화폐 기본값. */
export const DOMESTIC = { nation: 'KR||', currency: 'KRW' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 두 날짜 사이의 밤 수. 모르면 0. */
export function nightsBetween(from, to) {
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) return 0;
  const d = (s) => { const [y, m, dd] = s.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
  return Math.max(0, Math.round((d(to) - d(from)) / 86_400_000));
}

/**
 * 이 출장에 사후정산이 필요한가, 무엇을 넣는가.
 * @param {{from:string, to:string}} trip 여비계산서 목록의 한 줄(출장기간)
 * @param {{transports?: string[]}} detail 사전정산 화면에서 읽은 교통편(tripPreDetail)
 * @param {{go?:{t:string}, back?:{t:string}}} [picks] 출장 카드에서 고른 가는 편·오는 편(사전정산과 다르게 고른 것)
 * @returns {{nights:number, plane:boolean, lodging:boolean, transport:boolean, needed:boolean, why:string, hint:string}}
 */
export function afterNeed(trip, detail = {}, picks = {}) {
  const nights = nightsBetween(trip?.from, trip?.to);
  const plane = (detail.transports || []).includes(PRE_PLANE) || [picks?.go, picks?.back].some((x) => x?.t === 'plane');
  const lodging = nights >= 1;
  const why = [lodging ? `${nights}박` : '당일', plane ? '비행기' : ''].filter(Boolean).join(' · ');
  // 항공권은 늘 받는다 — 넣으면 그 편이 비행기로 바뀐다.
  const hint = [lodging ? '숙박 영수증·예약서' : '', '항공권'].filter(Boolean).join('·');
  return { nights, plane, lodging, transport: plane, needed: lodging || plane, why, hint };
}

const LODGING = new Set(['lodging_receipt', 'lodging_booking']);
const FLIGHT = new Set(['flight_ticket', 'flight_receipt']);
const GROUND = new Set(['train_ticket', 'bus_ticket']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
/** 업체 이름을 묶음 열쇠로 — 띄어쓰기·괄호 안·호텔/모텔 같은 꼬리를 떼고 비교한다. */
export const vendorKey = (v) => text(v).toLowerCase().replace(/\(.*?\)/g, '').replace(/[\s·.,-]/g, '').replace(/(호텔|hotel|모텔|리조트|resort)$/i, '');
const hourOf = (t) => (/^\d{2}:\d{2}$/.test(t || '') ? String(+t.slice(0, 2)) : '');
/**
 * 비행기 편의 출발 시·도착 시 — 공항에 가는 시간과 공항에서 나오는 시간을 더해 출발은 탑승 2시간 전, 도착은 착륙 1시간 뒤다(2026-11-20 사용자 지정:
 * "비행기 시간도 출발 2시간 도착 1시간 추가해서 시간을 넣어줘"). 0~23시 안에서 자른다. 시각이 적혀 있지 않은 쪽은 빈 글이다. 둘 다 없으면 null.
 */
export const PLANE_BEFORE = 2;
export const PLANE_AFTER = 1;
function planeHours(ticket) {
  const dep = hourOf(ticket?.depTime);
  const arr = hourOf(ticket?.arrTime);
  if (dep === '' && arr === '') return null;
  return { shr: dep === '' ? '' : String(Math.max(0, +dep - PLANE_BEFORE)), ehr: arr === '' ? '' : String(Math.min(23, +arr + PLANE_AFTER)) };
}
const fileName = (r) => r.file?.name || r.summary || '문서';

const shortDay = (s) => (DATE_RE.test(s || '') ? `${+s.slice(5, 7)}/${+s.slice(8)}` : '?');

/* ------------------------------------------------------------ 숙박 줄 */

/** 숙박 줄의 정산금액은 원화로만 적는다(2026-10-03 사용자 지정). */
export const LODGE_CURRENCY = 'KRW';

/**
 * 숙박 증빙 묶음(같은 숙박의 영수증·예약서)에서 숙박 줄에 넣을 값을 정한다. 출장 카드(afterPlan)와 사후정산 입력 화면
 * (src/afterpage.js 의 fillPlan)이 같이 쓴다. 2026-10-03 사용자 지정:
 *   - 업체명은 **산 곳(구매처)**이다 — 아고다에서 샀으면 아고다이고 호텔 이름이 아니다. 묵은 곳은 비고에 적는다.
 *     사업자등록번호는 그 구매처의 것이고, 문서에 사업자명(법인명)이 따로 적혀 있으면 비고에 같이 적는다.
 *   - 정산금액은 원화로만 적는다. 외화 문서면 문서에 같이 적힌 원화 금액을 쓰고, 없으면 비워 두고 사람에게 묻는다(actual = null).
 *
 * @param {object[]} receipts 결제 영수증·인보이스 기록(receipt 명세)
 * @param {object[]} [bookings] 예약 확인서 기록
 * @returns {{paydate: string|null, sday: number|null, stay: string, company: string, companycode: string, cocard: string, comment: string,
 *            doc: {currency: string, total: number|null, supply: number|null, vat: number|null}, actual: number|null}}
 *   stay 는 묵은 곳, doc 은 문서에 적힌 금액(그 화폐 그대로), actual 은 실제로 낸 금액(원)이다
 */
export function lodgeOf(receipts, bookings = []) {
  const pick = (key, order = [...receipts, ...bookings]) => order.map((r) => r[key]).find((v) => v != null && v !== '') ?? null;
  const stayFirst = [...bookings, ...receipts];
  const checkIn = pick('checkIn', stayFirst);
  const checkOut = pick('checkOut', stayFirst);
  const stay = text(pick('vendor'));
  const seller = text(pick('seller'));
  const biz = text(pick('sellerBiz'));
  const company = seller || stay;
  const comment = [seller && vendorKey(seller) !== vendorKey(stay) ? stay : '', biz && vendorKey(biz) !== vendorKey(company) ? biz : ''].filter(Boolean).join(' · ');
  // 금액·화폐·공급가액·부가세는 한 문서의 것이어야 맞는다 — 금액이 적힌 첫 문서(영수증이 먼저)에서 읽는다.
  const paid = [...receipts, ...bookings].find((r) => num(r.total) != null) || {};
  const currency = paid.currency || LODGE_CURRENCY;
  const total = num(paid.total);
  const krw = currency === LODGE_CURRENCY ? total : num(paid.totalKRW);
  // 문서마다 원화 금액이 다르면(결제 영수증과 예약 화면의 금액이 할인 때문에 다르다 — 2026-11-20 사용자 지정: "만약에 가격이 2개면 선택하라고 해줘")
  // 그 금액들을 낮은 것부터 적어 둔다 — 올리기 전에 사람에게 고르게 한다(lodgeAsk 'amount' → lodgePickAmount). 하나뿐이면 비어 있다.
  const choices = [];
  for (const r of [...receipts, ...bookings]) {
    const t = num(r.total);
    if (t == null) continue;
    const cur = r.currency || LODGE_CURRENCY;
    const won = cur === LODGE_CURRENCY ? t : num(r.totalKRW);
    if (won == null || choices.some((c) => c.won === Math.round(won))) continue;
    choices.push({ won: Math.round(won), from: fileName(r), doc: { currency: cur, total: t, supply: num(r.supply), vat: num(r.vat) } });
  }
  choices.sort((x, y) => x.won - y.won);
  return {
    ...(choices.length > 1 ? { amounts: choices } : {}),
    paydate: pick('payDate') || checkOut || checkIn || null,
    sday: num(pick('nights', stayFirst)) || nightsBetween(checkIn, checkOut) || null,
    stay, company, companycode: text(pick('bizNo')), cocard: pick('corporateCard') === true ? '1' : '0', comment,
    doc: { currency, total, supply: num(paid.supply), vat: num(paid.vat) },
    actual: krw == null ? null : Math.round(krw),
  };
}

/** 그 줄의 상한액 — 1일 상한(사이트의 CalMaxLodge 가 원화로 준 값, lodge_maxconv) × 숙박 일수. 상한을 원화로 모르면 null. */
export function lodgeCap(row) {
  const day = Number(row?.maxconv);
  return day > 0 && row.sday > 0 ? { day, total: day * row.sday } : null;
}

/**
 * 숙박 줄에서 사람이 정해 줘야 하는 것. 없으면 빈 글.
 *   'krw' — 외화 문서인데 원화로 결제한 금액이 문서에 없다. 원화 금액을 적어야 한다(환율로 어림하지 않는다).
 *   'cap' — 실제 금액이 상한액을 넘는다. 상한액으로 정산할지 실제 금액으로 정산할지 고른다(2026-10-03 사용자 지정).
 */
export function lodgeAsk(row) {
  if (row.amounts?.length > 1 && !row.amountPicked) return 'amount';
  if (row.actual == null) return row.doc?.total == null ? '' : 'krw';
  const cap = lodgeCap(row);
  return cap && row.actual > cap.total && !row.settle ? 'cap' : '';
}

const wonText = (n) => `${Number(n).toLocaleString('ko-KR')}원`;

/**
 * 같은 숙박의 문서끼리 금액이 달라 묻던 것(lodgeAsk 'amount')에 답한다 — 고른 원화 금액이 실제 금액이 되고, 그 문서의 금액·공급가액·부가세가
 * 그 줄의 문서 금액이 된다(lodgeSettle 이 그것으로 공급가액·부가세를 정한다). 적어 둔 금액 가운데 없는 것이면 그 금액을 그대로 쓴다.
 * 기본금액을 넘으면 그다음에 기본금액·실제 금액을 묻는다(lodgeAsk 'cap').
 * @returns {object} 그 줄(같은 객체)
 */
export function lodgePickAmount(row, won) {
  const n = Math.round(Number(won));
  if (!(n > 0)) throw new Error('고른 숙박 금액이 없습니다');
  const hit = (row.amounts || []).find((c) => c.won === n);
  if (hit) row.doc = { ...hit.doc };
  row.actual = n;
  row.amountPicked = true;
  return lodgeSettle(row);
}

/** 금액을 고르게 물을 때의 말과 고를 것 — 낮은 것이 먼저이고, 버튼에 그 금액이 적힌 문서 이름을 단다. 물을 줄이 아니면 null. */
export function lodgeAmountChoices(row) {
  if (lodgeAsk(row) !== 'amount') return null;
  return {
    question: `문서마다 금액이 다릅니다(${row.amounts.map((c) => wonText(c.won)).join(' · ')}) — 할인 등으로 결제 금액과 예약 금액이 다를 수 있습니다. 어느 금액으로 정산할까요?`,
    choices: row.amounts.map((c) => ({ won: c.won, label: `${wonText(c.won)}으로`, from: c.from })),
  };
}

/**
 * 실제 금액이 상한액을 넘은 숙박 줄의 승인 규칙 — 상한액의 1.5배까지는 부서장 승인을 받아 실제 금액으로 정산한다
 * (2026-10-05 사용자 지정: "상한액의 1.5배는 부서장 승인". 배수와 승인자는 references/travel-rules.yaml 의 lodging.over_cap).
 * 상한액 안이거나 상한액·실제 금액을 모르면 null.
 * @returns {{cap: number, limit: number, rate: number, approver: string, within: boolean}|null}
 *   cap 은 그 줄의 상한액(1일 상한 × 박 수), limit 은 승인으로 정산할 수 있는 금액(cap × rate), within 은 실제 금액이 그 안인가
 */
export function lodgeOver(row) {
  const cap = lodgeCap(row);
  if (!cap || row.actual == null || row.actual <= cap.total) return null;
  const { approve_rate: rate, approver } = TRAVEL_RULES.lodging.over_cap;
  const limit = Math.round(cap.total * rate);
  return { cap: cap.total, limit, rate, approver, within: row.actual <= limit };
}

/**
 * 상한액을 넘은 숙박 줄을 어느 금액으로 정산할지 물을 때의 말과 고를 것 — 패널의 출장 카드와 홈 카드의 출장 줄이 같은 말을 쓴다.
 * 실제 금액이 승인 범위(상한액의 1.5배) 안이면 그 버튼에 누구의 승인인지 적고, 범위를 넘으면 넘는다고 적는다 — 넘을 때의 규정은
 * 듣지 못해 고르는 것은 막지 않는다. 상한액을 넘지 않은 줄이면 null.
 * @returns {{question: string, choices: {settle: 'cap'|'real', label: string, note?: string, reason?: string}[]}|null}
 *   실제 금액 선택지의 reason 은 그렇게 올릴 때 비고에 적히는 상한 초과 사유다(고르는 자리가 보여 주거나 고쳐 쓰게 한다)
 */
export function lodgeChoices(row) {
  const over = lodgeOver(row);
  if (!over) return null;
  const day = lodgeCap(row).day;
  // 실제 금액·상한액으로 정산하면 비고에 사유가 필수다 — 고쳐 쓴 것이 있으면 그것, 없으면 기본 문구(2026-10-08 사용자 지정).
  const reason = text(row.reason) || LODGE_OVER_REASON;
  // 2026-11-20 사용자 지정: "12만원이 기본금액이고 18만원이 상한액 이야 12만원을 초과한 경우 … 사유를 넣어 주면 됨 그리고, 옵션을 3개 주면됨
  // 실제금액, 12만원 초과인 경우 사유입력, 18만원 초과(인경우 18만원)" — 사이트의 1일 숙박비 한도(× 박)가 기본금액, 그 1.5배가 상한액이다.
  // 고르는 것은 기본금액·실제 금액이고, 실제 금액이 상한액을 넘으면 상한액이 하나 더 선다. 기본금액을 넘는 쪽은 비고에 사유가 들어간다. 풀이 글은 달지 않는다.
  return {
    question: `실제 금액 ${wonText(row.actual)}이 기본금액 ${wonText(over.cap)}(1일 ${wonText(day)} × ${row.sday}박)을 넘습니다. 정산금액을 어느 쪽으로 올릴까요?`,
    choices: [
      { settle: 'cap', label: `기본금액 ${wonText(over.cap)}으로` },
      { settle: 'real', label: `실제 금액 ${wonText(row.actual)}으로`, reason },
      ...(over.within ? [] : [{ settle: 'max', label: `상한액 ${wonText(over.limit)}으로`, reason }]),
    ],
  };
}

/**
 * 상한액을 넘겨 실제 금액으로 정산하기로 한 줄에 붙는 말 — 승인이 필요하다는 것(범위를 넘었으면 넘었다는 것). 그런 줄이 아니면 빈 글.
 */
export function lodgeApproval(row) {
  const over = row.settle === 'real' || row.settle === 'max' ? lodgeOver(row) : null;
  if (!over) return '';
  // 상한액(기본금액의 1.5배)까지는 승인을 받아 정산한다 — 실제 금액이 그보다 크면 범위를 벗어난다(상한액으로 고르면 범위 안이다).
  return row.settle === 'max' || over.within ? `${over.approver} 승인 필요` : `상한액 ${wonText(over.limit)} 초과 — ${over.approver} 승인 범위를 벗어남`;
}

/**
 * 상한액을 넘겨 실제 금액으로 정산할 때 숙박 줄의 **비고에 적는 기본 사유**(references/travel-rules.yaml 의 lodging.over_cap.reason).
 * 2026-10-08 사용자 지정: "상한액 넘어 가면 '비고' 란에 상한 이유를 넣어야 하거든. 이게 상한액 넘어 가면 필수라서. 기본적으로
 * '인근 숙소비 상승으로 인해 숙박비 내에 숙박이 어려움' 라는 내용을 넣어주고, 수정 가능하게 해줘."
 */
export const LODGE_OVER_REASON = TRAVEL_RULES.lodging.over_cap.reason;
/** 비고 안에서 묵은 곳·사업자명·사유를 가르는 글(lodgeOf 가 쓰는 것과 같다). */
const COMMENT_SEP = ' · ';
const COMMENT_SEP_RE = /\s*·\s*/;

/**
 * 그 숙박 줄의 비고에 들어가야 하는 상한 초과 사유 — **정산금액이 상한액을 넘을 때**(실제 금액으로 정산하기로 했고 실제 금액이 상한액을
 * 넘는다, lodgeOver) 필수다. 사람이 고쳐 쓴 것(row.reason)이 먼저고, 없으면 기본 문구(LODGE_OVER_REASON)다.
 * 상한액으로 정산하거나(정산금액이 상한액 안이다) 상한액을 모르면 빈 글 — 사유를 적지 않는다.
 */
export function lodgeReason(row) {
  if ((row?.settle !== 'real' && row?.settle !== 'max') || !lodgeOver(row)) return '';
  return text(row.reason) || LODGE_OVER_REASON;
}

/** 숙박 줄의 비고에 올릴 글 전부 — 묵은 곳·사업자명(lodgeOf 의 comment) 뒤에 상한 초과 사유(lodgeReason)를 잇는다. afterFields 가 쓴다. */
export function lodgeComment(row) {
  return lodgeCommentWith(row?.comment, lodgeReason(row));
}

/** 비고 글에 사유를 잇는다(` · ` 로). 사유가 비었거나 이미 들어 있으면 그대로다. */
export function lodgeCommentWith(comment, reason) {
  const base = text(comment);
  const r = text(reason);
  if (!r || base.includes(r)) return base;
  return [base, r].filter(Boolean).join(COMMENT_SEP);
}

/**
 * 비고 글에서 그 사유(들)를 뺀다 — 상한액으로 되돌릴 때 적어 둔 사유(또는 기본 문구)를 걷는다. 사유만 적혀 있었으면 빈 글이 되고,
 * 다른 글(묵은 곳 등)은 남는다. 어느 사유도 들어 있지 않으면 글을 그대로 돌려준다(띄어쓰기도 건드리지 않는다).
 */
export function lodgeCommentWithout(comment, reasons) {
  let s = text(comment);
  const drop = (Array.isArray(reasons) ? reasons : [reasons]).map(text).filter((r) => r && s.includes(r));
  if (!drop.length) return s;
  for (const r of drop) s = s.split(r).join(COMMENT_SEP);
  return s.split(COMMENT_SEP_RE).map((p) => p.trim()).filter(Boolean).join(COMMENT_SEP);
}

/**
 * 상한액을 넘은 숙박 줄을 어느 금액으로 정산할지 정한다(카드에서 고른 것) — 정산금액을 다시 셈하고(lodgeSettle), 실제 금액으로
 * 정산하면 승인이 필요하다는 알림을 그 줄과 계획의 알림에 더한다(올린 뒤의 결과 글과 줄의 설명에 같이 보인다).
 * 실제 금액으로 정산하는 줄의 비고에는 상한 초과 사유가 붙는다(lodgeReason — 올릴 때 afterFields 가 lodgeComment 로 잇는다).
 * @param {{notes: string[]}} plan afterPlan 의 결과
 * @param {object} row 그 계획의 숙박 줄
 * @param {'cap'|'real'} settle
 * @param {string} [reason] 비고에 적을 상한 초과 사유(사람이 고쳐 쓴 것). 주면 그 줄에 적어 두고(빈 글이면 기본 문구를 쓴다), 안 주면 있던 것을 둔다
 * @returns {object} 그 줄(같은 객체)
 */
export function lodgeDecide(plan, row, settle, reason) {
  const before = lodgeApprovalNote(row);
  row.settle = settle === 'cap' ? 'cap' : settle === 'max' ? 'max' : 'real';
  if (typeof reason === 'string') row.reason = text(reason);
  lodgeSettle(row);
  const note = lodgeApprovalNote(row);
  if (before !== note) {
    const drop = (list) => (list || []).filter((n) => n !== before);
    row.notes = [...drop(row.notes), ...(note ? [note] : [])];
    plan.notes = [...drop(plan.notes), ...(note ? [note] : [])];
  }
  return row;
}
const lodgeApprovalNote = (row) => { const a = lodgeApproval(row); return a ? `${row.stay || row.company || '숙박'}: ${a}` : ''; };

/**
 * 정산금액·공급가액·부가세를 정해 그 줄에 적는다(2026-10-03 사용자 지정). 정산금액은 실제 금액(원)이고, 상한액으로 정산하기로
 * 했으면(settle = 'cap') 상한액이다. 공급가액·부가세는 문서에 적혀 있으면 그 값(하나만 있으면 다른 하나는 뺄셈)이고, 적혀 있지
 * 않거나 정산금액이 문서의 금액과 달라졌으면(외화를 원화로 옮겼거나 상한액으로 낮췄으면) 정산금액에서 되셈한다 —
 * 공급가액 = 정산금액 ÷ 1.1(원 단위 반올림), 부가세 = 나머지.
 * @returns {object} 그 줄(같은 객체) — total·samount·vat, capped(상한액으로 낮췄는가), vatFrom('doc' 문서·'calc' 되셈)
 */
export function lodgeSettle(row) {
  const cap = lodgeCap(row);
  row.capped = row.settle === 'cap' && !!cap && row.actual != null && row.actual > cap.total;
  // 상한액(기본금액의 1.5배)으로 — 실제 금액이 그보다 클 때만이다(2026-11-20 사용자 지정).
  const over = row.settle === 'max' ? lodgeOver(row) : null;
  row.maxed = !!over && !over.within;
  row.total = row.capped ? cap.total : row.maxed ? over.limit : row.actual;
  const { currency, total, supply, vat } = row.doc || {};
  if (row.total == null) return Object.assign(row, { samount: null, vat: null, vatFrom: '' });
  if (currency === LODGE_CURRENCY && row.total === total && (supply != null || vat != null)) {
    return Object.assign(row, { samount: supply ?? Math.max(0, row.total - vat), vat: vat ?? Math.max(0, row.total - supply), vatFrom: 'doc' });
  }
  const samount = Math.round(row.total / 1.1);
  return Object.assign(row, { samount, vat: row.total - samount, vatFrom: 'calc' });
}

/** 사후정산 입력 화면의 숙박 줄 칸(lodge_ 뒤의 이름) — 화면의 addLodge() 가 만드는 것들이다. */
const LODGE_KEYS = new Set(['nation', 'seq', 'del', 'oldfile', 'maxtotal', 'maxcur', 'maxrate', 'maxconv', 'paydate', 'sday', 'company', 'companycode',
  'currency', 'cocard', 'total', 'samount', 'vat', 'comment', 'etcname']);

/**
 * 화면의 칸 목록(src/travel.js formFields 의 결과)에서 지금 있는 숙박 줄을 읽는다 — lodge_nation 이 줄의 시작이다.
 * 값은 화면 그대로의 글이고, 지움 표시(del = '1')가 된 줄도 그대로 준다.
 * @param {[string,string][]} fields
 * @returns {Record<string,string>[]} 줄마다 { seq, del, nation, paydate, sday, company, companycode, currency, cocard, total, samount, vat, comment, … }
 */
export function lodgeRowsOf(fields) {
  const rows = [];
  for (const [name, value] of fields || []) {
    const key = name.startsWith('lodge_') ? name.slice(6) : '';
    if (key === 'nation') rows.push({});
    if (rows.length && LODGE_KEYS.has(key)) rows.at(-1)[key] = value;
  }
  return rows;
}

/** 사후정산 입력 화면의 교통 줄 칸(tr_ 뒤의 이름) — 화면의 addTr() 가 만드는 것들이다. */
const TRANS_KEYS = new Set(['seq', 'del', 'date', 'shr', 'ehr', 'dep', 'arr', 'transport', 'grade', 'total', 'currency', 'cocard', 'comment']);
/** 사후정산 화면의 수단 값(한국어) → 사전정산 화면의 값. 출장 카드가 아이콘으로 아는 것(기차·비행기·버스)만이다. */
const PRE_OF = { [AFTER_TRANSPORT.train]: 'Train', [AFTER_TRANSPORT.plane]: PRE_PLANE, [AFTER_TRANSPORT.bus]: 'Bus' };

/**
 * 화면의 칸 목록(src/travel.js formFields 의 결과)에서 지금 있는 교통 줄을 읽는다 — tr_seq 가 줄의 시작이다.
 * 줄의 모양은 사전정산의 교통편 줄(src/travel.js parseTransRows)과 같다: 수단 값은 사전정산 화면의 것(Train·Airplane·Bus)으로 바꾸고
 * (그 밖의 수단은 화면의 글 그대로), 요금은 수다. 출장 카드가 두 화면의 줄을 같은 길(legsOfRows·describeTrans)로 그린다.
 * 지움 표시(del = '1')가 된 줄도 그대로 준다.
 * @param {[string,string][]} fields
 * @returns {{seq:string, del:string, date:string, dep:string, arr:string, transport:string, grade:string, total:number, currency:string}[]}
 */
export function transRowsOf(fields) {
  const rows = [];
  for (const [name, value] of fields || []) {
    const key = name.startsWith('tr_') ? name.slice(3) : '';
    if (key === 'seq') rows.push({});
    if (rows.length && TRANS_KEYS.has(key)) rows.at(-1)[key] = value;
  }
  return rows.map((r) => ({ ...r, dep: text(r.dep), arr: text(r.arr), grade: text(r.grade), transport: PRE_OF[r.transport] || r.transport || '',
    total: Number(String(r.total ?? '').replace(/,/g, '')) || 0 }));
}

/**
 * 올리려는 줄이 화면에 이미 있는 줄과 같은 것인가 — 결제일·업체명·숙박 일수·정산금액이 모두 같다.
 * 같은 증빙을 두 번 넣었을 때 같은 줄이 겹쳐 올라가지 않게 한다(2026-10-03 실제 계산서에 같은 숙박이 세 줄 올라가 있었다).
 */
export const lodgeSame = (row, have) => have.del !== '1' && (have.paydate || '') === (row.paydate || '') && text(have.company) === text(row.company)
  && Number(have.sday) === Number(row.sday) && row.total != null && Number(have.total) === Number(row.total);

/**
 * 올리려는 숙박 줄이 사후정산 화면에 **이미 올라가 있는가** — 결제일·업체명·숙박 일수가 같고, 정산금액이 실제 금액이거나 그 줄의 상한액이다
 * (2026-10-05 사용자가 이미 올라간 숙박 줄 아래에 "사후정산에 안 올림"과 올리기 버튼이 서 있는 것을 보고: "이게 확인이 안되나? 출장이랑 맞잖아").
 * 그렇다면 어느 금액으로 올라가 있는지를 답한다 — 상한액을 넘어도 다시 묻지 않고, 같은 줄을 또 올리지 않는다.
 * @param {object} row afterPlan 의 숙박 줄
 * @param {Record<string,string>[]} haveRows 화면의 숙박 줄(lodgeRowsOf)
 * @returns {'real'|'cap'|''}
 */
export function lodgeKnown(row, haveRows) {
  if (!row || row.actual == null) return '';
  for (const have of haveRows || []) {
    if (have.del === '1' || (have.paydate || '') !== (row.paydate || '') || text(have.company) !== text(row.company) || Number(have.sday) !== Number(row.sday)) continue;
    const total = Number(String(have.total ?? '').replace(/,/g, ''));
    if (total === row.actual) return 'real';
    const day = Number(row.maxconv) || Number(have.maxconv);
    if (day > 0 && row.sday > 0 && row.actual > day * row.sday && total === day * row.sday) return 'cap';
    const top = lodgeOver({ ...row, maxconv: day });
    if (top && !top.within && total === top.limit) return 'max';
  }
  return '';
}

/**
 * 증빙 한 장이 무엇의 증명이고 그렇게 쓸 수 있는가(2026-10-03 사용자 지정). 카드가 읽은 문서 옆에 적는다.
 *   항공권·항공 영수증 → "항공기 증명"            숙박 영수증·예약서 → "숙박 증빙"
 *   기차표·버스표      → 증빙으로 받지 않는다(KTX 는 운임표의 정가로 넣는다)
 *   그 밖의 영수증     → "당일출장 증명" — **그 출장지에서, 출장 기간 안에 결제한 영수증**이어야 한다(1박 이상이면 "출장지 영수증").
 *                        출장지에서 결제했는지는 영수증을 읽을 때 가린다(input.yaml receipt 의 atDestination).
 * @returns {{label: string, ok: boolean, note: string}} ok 가 거짓이면 note 가 그 까닭이다
 */
export function evidenceOf(record, trip) {
  const type = record?.docType;
  // 출장 기간의 것이 아닌 문서는 그 증명으로 쓰지 않는다(warn) — 버리지 않고 알림 표시를 붙여 보관하고, 사람이 확정하기 전에는
  // 사후정산에 올리지도 담당자에게 보내지도 않는다(periodMiss).
  const warn = periodMiss(record, trip);
  const off = (label) => ({ label, ok: false, note: warn, warn });
  if (FLIGHT.has(type)) return warn ? off('항공기 증명') : { label: '항공기 증명', ok: true, note: '', warn: '' };
  if (LODGING.has(type)) return warn ? off('숙박 증빙') : { label: '숙박 증빙', ok: true, note: '', warn: '' };
  if (GROUND.has(type)) return { label: '기차·버스표', ok: false, note: '증빙으로 받지 않습니다(KTX 는 운임표의 정가로 넣습니다)', warn: '' };
  if (type !== 'other_receipt') return { label: '모르는 문서', ok: false, note: `무슨 문서인지 읽지 못했습니다${text(record?.summary) ? `(${text(record.summary)})` : ''}`, warn: '' };
  const label = nightsBetween(trip?.from, trip?.to) >= 1 ? '출장지 영수증' : '당일출장 증명';
  const note = record.atDestination === false ? `출장지에서 결제한 영수증이 아닙니다${text(record.payPlace) ? `(${text(record.payPlace)})` : ''}`
    : record.atDestination !== true ? '출장지에서 결제한 것인지 영수증에서 확인하지 못했습니다'
      : !record.payDate ? '결제일을 읽지 못했습니다'
        : '';
  if (note) return { label, ok: false, note, warn: '' };
  return warn ? off(label) : { label, ok: true, note: '', warn: '' };
}

/** 증빙 파일의 이름에 적는 문서 종류(evidenceName) — 항공권과 그 결제 영수증, 숙박 영수증과 예약서가 같은 날이어도 이름이 갈리게 따로 부른다. */
const DOC_NAMES = { flight_ticket: '항공권', flight_receipt: '항공영수증', lodging_receipt: '숙박비', lodging_booking: '숙박예약',
  train_ticket: '기차표', bus_ticket: '버스표', other_receipt: '증빙 영수증' };

/**
 * 증빙의 뱃지(2026-11-20 사용자 지정: "사람이 숙박비 인지 항공권인지 뱃지로 선택할 수 있게하고 클릭하면 뱃지가 바뀌면 … 현지 라는 뱃지는
 * 현지 방문한 기타 영수증") — 처음에는 읽은 내용에서 가장 가까운 것이 붙고 사람이 눌러 바꾼다. doc 은 그 뱃지로 바꿀 때 칠 문서 종류,
 * mark 는 읽은 기록이 없는 증빙(완료한 뒤 담은 것)에 적는 이름표, file 은 같은 뱃지의 파일을 합쳤을 때의 이름이다.
 */
export const EVIDENCE_KINDS = [
  { id: 'lodging', label: '숙박비', is: LODGING, doc: 'lodging_receipt', mark: '숙박 증빙', file: '숙박비.pdf' },
  // 항공권은 어느 편의 것인지까지 뱃지로 정한다(2026-11-20 사용자 지정: "항공권도 출발/도착 항공권으로 해서 라벨을 줄까?") — leg 가 그 편이다.
  { id: 'flight_go', label: '가는 항공권', is: FLIGHT, leg: 'go', doc: 'flight_receipt', mark: '항공기 증명', file: '항공권.pdf' },
  { id: 'flight_back', label: '오는 항공권', is: FLIGHT, leg: 'back', doc: 'flight_receipt', mark: '항공기 증명', file: '항공권.pdf' },
  { id: 'local', label: '현지', is: null, doc: 'other_receipt', mark: '증빙', file: '증빙 영수증.pdf' },
];

/** 보관한 증빙(또는 읽은 기록)의 뱃지 — 사람이 고른 것(kind)이 먼저, 다음은 읽은 문서 종류, 그것도 없으면 이름표다. 숙박·항공이 아니면 현지다. */
export function evidenceKind(item) {
  if (EVIDENCE_KINDS.some((k) => k.id === item?.kind)) return item.kind;
  const type = item?.record?.docType ?? item?.docType;
  const hit = EVIDENCE_KINDS.find((k) => (type ? k.is?.has(type) : k.is && k.mark === item?.label));
  if (!hit) return 'local';
  if (!hit.leg) return hit.id;
  // 항공권 — 탑승일이 (출발일과 다른) 도착일이면 오는 항공권, 아니면 가는 항공권이다. 담을 때 앉은 편을 적어 두면(kind) 그것이 먼저다.
  const day = item?.record?.flightDate ?? item?.flightDate ?? item?.date;
  const t = item?.trip;
  return t?.to && t.to !== t.from && day === t.to ? 'flight_back' : 'flight_go';
}

/** 뱃지의 다음 차례 — 숙박비 → 가는 항공권 → 오는 항공권 → 현지 → 숙박비. */
export const nextEvidenceKind = (id) => EVIDENCE_KINDS[(EVIDENCE_KINDS.findIndex((k) => k.id === id) + 1) % EVIDENCE_KINDS.length].id;

/**
 * 읽은 기록을 사람이 고른 뱃지의 종류로 친다 — 이미 그 갈래의 문서면 그대로다(영수증·예약서, 항공권·항공 영수증을 뭉개지 않는다).
 * `현지` 로 고른 것은 출장지에서 결제한 영수증이라고 사람이 말해 준 것이다(atDestination). 결제일을 못 읽었으면 탑승일·체크인으로 채운다.
 * 가는·오는 항공권으로 고른 것은 탑승일이 그 편의 날짜다(trip 을 주면 — 사람이 어느 편인지 말해 준 것이라 읽은 날짜보다 먼저다).
 */
export function withEvidenceKind(record, id, trip = null) {
  const k = EVIDENCE_KINDS.find((x) => x.id === id);
  if (!k || !record) return record;
  if (k.leg) {
    const day = k.leg === 'go' ? trip?.from : trip?.to || trip?.from;
    return { ...record, docType: k.is.has(record.docType) ? record.docType : k.doc, ...(DATE_RE.test(day || '') ? { flightDate: day } : {}) };
  }
  if (k.is) return k.is.has(record.docType) ? record : { ...record, docType: k.doc };
  return { ...record, docType: k.doc, atDestination: true, payDate: record.payDate || record.flightDate || record.checkIn || null };
}

/**
 * 읽은 증빙의 파일 이름을 내용으로 짓는다(2026-11-20 사용자 지정: "파일이름은 내용을 읽어서 항공권, 숙빅비 이런식으로 이용날짜 넣어서") —
 * `종류_이용일.확장자`(항공권_2026-11-05.pdf). 이용일은 항공권·표는 탑승일, 숙박은 체크인, 그 밖의 영수증은 결제일이고, 못 읽었으면
 * 다른 날짜(결제일·탑승일)이며 그것도 없으면 종류만 적는다. 무슨 문서인지 못 읽은 것은 원래 이름 그대로다. 확장자는 원래 이름의 것이다.
 */
export function evidenceName(record, name = '') {
  const kind = DOC_NAMES[record?.docType];
  if (!kind) return name;
  const first = LODGING.has(record.docType) ? record.checkIn : record.docType === 'other_receipt' ? record.payDate : record.flightDate;
  const day = [first, record.flightDate, record.checkIn, record.payDate].find((d) => DATE_RE.test(d || ''));
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(String(name || ''))?.[0] || '';
  return `${kind}${day ? `_${day}` : ''}${ext.toLowerCase()}`;
}

/** 증빙 파일 이름의 길이 한도(확장자 빼고) — 넘으면 자른다(shortFileName). */
export const FILE_NAME_MAX = 30;

/**
 * 너무 긴 파일 이름을 자른다(2026-11-20 사용자 지정: "파일 이름이 너무 길면 잘라버리고") — 확장자는 두고 앞부분만 남긴다(`eyJhbGciOiJ….pdf` 같은
 * 토큰 이름이 카드를 덮었다). 자르면 끝에 `…` 를 붙인다. 이름이 비면 `증빙` 이다.
 */
export function shortFileName(name, max = FILE_NAME_MAX) {
  const s = String(name || '').trim() || '증빙';
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(s)?.[0] || '';
  const stem = ext ? s.slice(0, -ext.length) : s;
  return [...stem].length > max ? `${[...stem].slice(0, max).join('')}…${ext}` : s;
}

/** 사후정산에도 올라가야 하는 문서인가(숙박 영수증·예약서, 항공권·항공 영수증). */
export const needsAfter = (record) => LODGING.has(record?.docType) || FLIGHT.has(record?.docType);

/**
 * 그 문서가 출장 기간의 것이 아니면 그 까닭(2026-10-05 사용자 지정: "출장 기간동안의 내용이 아니면 알림을 줘 안맞다고, 맞는것만 선별취급
 * 해서 올리고 해당 없는거는 문서보관에 알림표지 하고 확정 해주기 전까지는 보내기 해도 같이 보내지 말고").
 *   숙박 증빙      묵은 기간(체크인~체크아웃)이 출장 기간 안이어야 한다 — 결제일은 보지 않는다(미리 결제한다)
 *   항공권         탑승일(왕복이면 돌아오는 날도)이 출장 기간 안이어야 한다
 *   그 밖의 영수증  결제일이 출장 기간 안이어야 한다
 * 날짜를 읽지 못했으면 안 맞다고 하지 않는다(모르는 것이다). 사람이 이 출장의 증빙이 맞다고 확정한 기록(record.confirmed —
 * src/evidence.js 의 confirm)은 맞는 것으로 친다.
 * @returns {string} 안 맞으면 알림에 그대로 적을 까닭, 맞거나 모르면 빈 글
 */
export function periodMiss(record, trip) {
  if (!record || record.confirmed || !DATE_RE.test(trip?.from || '')) return '';
  const from = trip.from;
  const to = DATE_RE.test(trip.to || '') ? trip.to : from;
  const day = (v) => (DATE_RE.test(v || '') ? v : '');
  const out = (d) => !!d && (d < from || d > to);
  const period = `출장 기간(${from === to ? shortDay(from) : `${shortDay(from)}~${shortDay(to)}`})`;
  const type = record.docType;
  if (LODGING.has(type)) {
    const [ci, co] = [day(record.checkIn), day(record.checkOut)];
    return out(ci) || out(co) ? `묵은 기간(${[ci, co].filter(Boolean).map(shortDay).join('~')})이 ${period} 밖입니다` : '';
  }
  if (FLIGHT.has(type)) {
    const off = [day(record.flightDate), day(record.retDate)].filter(out);
    return off.length ? `탑승일(${off.map(shortDay).join('·')})이 ${period} 밖입니다` : '';
  }
  if (type === 'other_receipt') return out(day(record.payDate)) ? `결제일(${shortDay(record.payDate)})이 ${period} 밖입니다` : '';
  return '';
}

/**
 * 읽은 기록들을 사후정산 한 벌로 묶는다.
 *
 * - 숙박: 같은 숙박업소의 영수증과 예약서를 한 줄로 합친다 — 금액·결제일은 영수증이, 체크인/아웃·박 수는 예약서가 채운다.
 *   필수: 업체명·결제일·숙박 일수·정산금액. 업체명은 산 곳(구매처), 정산금액은 원화이고 공급가액·부가세는 문서에 없으면
 *   정산금액에서 되셈한다(lodgeOf·lodgeSettle). 외화 금액의 원화 값과 상한액 초과는 올리기 전에 사람에게 묻는다(lodgeAsk).
 * - 교통: 가는 편·오는 편이 한 줄씩이다. 항공권을 그 날짜·시각의 편에 앉혀 그 편을 비행기로 바꾸고(항공권이 한 편뿐이면 나머지
 *   편은 KTX), 항공권을 넣었거나 편이 사전정산과 달라졌을 때만 두 편을 넣는다. 편의 값은 비행기면 항공권, 사전정산에 같은 교통편의
 *   줄이 있으면 그 줄, 기차면 운임표의 정가다 — 값을 모르는 편은 넣지 않고 notes 에 적는다. 기차표·버스표는 쓰지 않는다.
 *   항공권의 필수(일자·출발지·도착지·합계)를 못 읽었으면 problems 다. 항공권이 있으면 항공 마일리지 블록도 켠다
 *   (항공권 출장 = 예, 업무 항공마일리지 발생 = 예, 항공사, 마일리지 공제 = 예). 신규 마일리지는 문서에 적혀 있으면 그 값이고,
 *   없으면 항공 마일리지 표(air-mileage.yaml)에서 편마다 찾는다 — 일반석과 특실·비즈니스의 적립률이 다르다. 표에 없으면 비워 두고 알린다.
 * - 그 밖의 영수증은 여비계산서에 넣을 칸이 없다. 출장지에서 결제한 것이면(당일출장 증명) 확인했다고 notes 에, 아니면 skipped 에 적는다
 *   (확인한 것은 패널이 보관함에 담아 둔다 — 담당자에게 보낼 때 같이 간다).
 * - 조건에 맞지 않는 것(당일인데 숙박)과 모르는 문서는 넣지 않고 skipped 에 적는다.
 *
 * @param {object[]} records receipt 명세를 지난 기록. 각 기록에 file({name,type,dataUrl})이 붙어 있으면 숙박 줄의 첨부가 된다
 * @param {{trip:{from:string,to:string,location?:string}, detail?:{transports?:string[], rows?:object[]}, picks?:object, workplace?:string}} ctx
 *   detail 은 사전정산의 교통편과 출장의 출발·도착 시(tripPreDetail 의 rows·sHour·eHour), picks 는 카드에서 고른 가는 편·오는 편, workplace 는 근무지에 적어 둔 글이다
 * @returns {{lodge:object[], trans:object[], air:object|null, notes:string[], problems:string[], skipped:string[],
 *            need:ReturnType<typeof afterNeed>, picks:object, seats:object, legs:object[], touched:boolean}}
 *   picks·seats 는 표를 앉힌 뒤의 선택과 표(카드가 다시 그릴 때 쓴다), touched 는 교통비 내역을 넣을 까닭이 있는가(표를 넣었거나 편을 바꿨다)
 */
export function afterPlan(records, { trip, detail = {}, picks = {}, workplace = '' }) {
  const notes = [];
  const problems = [];
  // 꼭 있어야 하는 값을 못 읽은 문서마다 사람이 적어 줄 칸(2026-11-20 사용자 지정: "못 읽을 수는 있는데 그렇면 수정할 수 있게") —
  // { file: 그 문서의 파일 이름, what: 무슨 문서인지, fields: [{ key: 기록의 칸 이름, label, type: text·date·int·money }] }. problems 와 짝이다.
  const fixes = [];
  const skipped = [];
  const lodge = [];
  const trans = [];
  let air = null;

  // 출장 기간의 것이 아닌 문서는 묶지 않는다 — 맞는 것만 골라 올린다(2026-10-05 사용자 지정, periodMiss). 무엇을 왜 뺐는지는 skipped 에 적는다.
  const inPeriod = (records || []).filter((r) => !periodMiss(r, trip));
  // 탑승일을 못 읽은 항공권 — 카드에서 비행기로 골라 둔 편이 하나뿐이면 그 편의 날짜다(2026-11-20 사용자 지정: "이미 위에 날짜가 있잖아
  // 2개중 하나고 이미 항공권 클릭해 둔게 1개 있잖아"). 그 날짜로 그 편에 앉고(seatTickets), 탑승일은 묻지 않는다. 그렇게 넣었다고 알린다.
  const flown = ['go', 'back'].filter((key) => picks?.[key]?.t === 'plane');
  const flownDay = flown.length === 1 ? (flown[0] === 'go' ? trip?.from : trip?.to || trip?.from) : '';
  const rows = detail.rows || [];
  const site = legsOfRows(rows, trip);
  // 구간(출발지·도착지)을 못 읽은 항공 문서(결제 영수증·거래확인증처럼 금액만 적힌 것) — 어느 편인지 알면 그 편의 구간으로 넣는다(2026-11-20 사용자
  // 지정: "숙박비랑 항공권 영수증 입력했잖아. 왜 입력을 못하냐고"). 그 편에 비행기 줄이 이미 있으면 그 줄의 구간이고, 없으면 근무지 ↔ 출장지에
  // 적은 글이다. 어느 편인지는 비행기로 골라 둔 편이 하나뿐이면 그 편, 아니면 탑승일이 출발일·도착일 가운데 하나와 맞는 편이다. 금액은 문서의 것이다.
  const multi = !!trip?.to && trip.to !== trip.from;
  // 탑승일이 출발일·도착일 가운데 하나와 맞으면 그 편이 먼저다 — 비행기로 고른 편이 하나뿐이어도 다른 날의 표를 그 편으로 돌리지 않는다
  // (2026-11-20: 11/5 표가 오는 편 구간 일산→부산으로 들어갔다).
  const legOf = (r) => (multi && r.flightDate === trip.from ? 'go' : multi && r.flightDate === trip.to ? 'back' : flown.length === 1 ? flown[0] : '');
  const fit = inPeriod.map((r) => {
    if (!FLIGHT.has(r.docType)) return r;
    let out = r;
    if (!out.flightDate && DATE_RE.test(flownDay || '')) {
      notes.push(`${fileName(r)}: 탑승일을 읽지 못해 비행기로 고른 ${flown[0] === 'go' ? '가는 편' : '오는 편'}의 날짜(${shortDay(flownDay)})로 넣었습니다 — 다르면 사후정산 화면에서 고쳐 주세요`);
      out = { ...out, flightDate: flownDay };
    }
    const key = legOf(out);
    if (key && num(out.total) != null && (!text(out.depPlace) || !text(out.arrPlace))) {
      const had = site[key]?.transport === PRE_PLANE ? site[key] : null;
      // 그 편에 올라가 있는 비행기 줄이 있을 때만 그 구간을 빌린다 — 근무지·출장지 글로 지어 넣지는 않는다(2026-11-20: 숙박 영수증을 항공권 뱃지로
      // 바꾼 것이 "일산(킨텍스)→부산 비행기 188,000원"으로 올라갔다).
      const [dep, arr] = had ? [text(had.dep), text(had.arr)] : ['', ''];
      if (dep && arr) {
        notes.push(`${fileName(r)}: 출발지·도착지를 읽지 못해 ${key === 'go' ? '가는 편' : '오는 편'}의 ${dep}→${arr}(올라가 있는 비행기 줄)로 넣었습니다 — 다르면 사후정산 화면에서 고쳐 주세요`);
        out = { ...out, depPlace: text(out.depPlace) || dep, arrPlace: text(out.arrPlace) || arr };
      }
    }
    return out;
  });

  // ---- 가는 편·오는 편: 표를 앉히고, 그에 따라 선택을 바꾼다
  // 구간·금액을 못 읽은 항공 문서는 편에 앉히지 않는다 — 증빙으로만 둔다(2026-11-20). 앉히면 그 편이 비행기로 바뀌는데 요금을 몰라 줄을 못 짓고,
  // 그 편의 사전정산 줄(KTX)만 교통비 내역에서 빠진 채 올라간다. 사람이 값을 적어 주면(fixes) 그때 앉는다.
  const whole = (r) => !FLIGHT.has(r.docType) || (!!text(r.depPlace) && !!text(r.arrPlace) && num(r.total) != null);
  const seats = seatTickets(ticketsOf(fit.filter(whole)), trip, { home: site.go?.dep || site.back?.arr || workplace, dest: site.go?.arr || site.back?.dep || trip?.location });
  const chosen = picksWithTickets(picks, seats, site);
  const route = legPlan({ trip, picks: chosen, rows, seats, workplace });
  const need = afterNeed(trip, detail, chosen);

  // ---- 숙박: 업체별로 묶는다
  const groups = new Map();
  for (const r of fit) {
    if (!LODGING.has(r.docType)) continue;
    if (!need.lodging) { skipped.push(`${fileName(r)}: 당일 출장이라 숙박비 내역은 넣지 않습니다`); continue; }
    const key = vendorKey(r.vendor) || `#${groups.size}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  // 같은 숙박인데 문서마다 업체명이 달리 적히면 이름으로는 못 묶는다(2026-10-04 실제로 있던 일: 영수증은 "SONO CALM GOYANG",
  // 예약서는 "소노캄 고양" — 예약서가 따로 한 줄이 돼 "정산금액을 읽지 못했습니다"로 올리지 못했다). 영수증 없이 **금액도 없는** 예약서만
  // 남은 묶음은 체크인·체크아웃이 같은 영수증 묶음이 하나뿐이면 거기에 합친다. 금액이 적힌 예약서는 그것만으로 한 줄이 되므로 남의
  // 영수증에 붙이지 않고, 날짜가 같은 영수증 묶음이 여럿이면 어느 것인지 몰라 그대로 둔다.
  const spanOf = (rs) => { const at = (k) => rs.map((r) => r[k]).find(Boolean) || ''; return at('checkIn') && at('checkOut') ? `${at('checkIn')}~${at('checkOut')}` : ''; };
  const paidGroup = (rs) => rs.some((r) => r.docType === 'lodging_receipt');
  // 2026-11-20 사용자 지정("숙박비 뱃지가 있잖아 그걸 사용해야지" · "가격이 2개면 선택하라고 해줘") — 금액이 적힌 예약서도 묵은 기간이 같은
  // 영수증 묶음이 하나뿐이면 같은 숙박으로 합친다. 금액이 서로 다르면 올리기 전에 어느 금액으로 할지 묻는다(lodgeOf 의 amounts).
  // 원화 금액을 모르는 외화 예약서는 고를 금액이 될 수 없어 합치지 않는다 — 따로 한 줄로 서서 원화 금액을 묻는다(lodgeAsk 'krw').
  const wonKnown = (r) => num(r.total) == null || (r.currency || LODGE_CURRENCY) === LODGE_CURRENCY || num(r.totalKRW) != null;
  for (const [key, rs] of [...groups]) {
    if (paidGroup(rs) || !spanOf(rs) || !rs.every(wonKnown)) continue;
    const same = [...groups.values()].filter((other) => other !== rs && paidGroup(other) && spanOf(other) === spanOf(rs));
    if (same.length !== 1) continue;
    same[0].push(...rs);
    groups.delete(key);
  }
  for (const rs of groups.values()) {
    const receipts = rs.filter((r) => r.docType === 'lodging_receipt');
    const bookings = rs.filter((r) => r.docType === 'lodging_booking');
    // 정산금액은 원화로만 적고(외화 문서에 원화 금액이 없으면 actual 이 비어 사람에게 묻는다 — lodgeAsk), 상한액은 올리기 전에
    // 패널이 사이트에서 읽어 붙인다(maxconv). 여기서는 실제 금액 그대로 셈해 둔다.
    // 숙박 일수·결제일을 문서에서 못 읽었으면 그 출장의 것이다(2026-11-20 사용자 지정: "숙박일은 사이드 패널에 이미 있잖아. 그럼 그게
    // 맞겠지") — 일수는 출장의 박 수, 결제일은 출발일(묵은 날)이다. 그렇게 넣었다고 그 줄의 알림에 적는다.
    const read = lodgeOf(receipts, bookings);
    const filled = [];
    if (!read.sday && need.nights) { read.sday = need.nights; filled.push(`숙박 일수를 출장 기간의 ${need.nights}박으로`); }
    if (!read.paydate && DATE_RE.test(trip?.from || '')) { read.paydate = trip.from; filled.push(`결제일을 출발일(${shortDay(trip.from)})로`); }
    const row = lodgeSettle({
      nation: DOMESTIC.nation, currency: LODGE_CURRENCY, etcname: '', settle: '', ...read,
      // 첨부는 영수증이 먼저, 없으면 예약서다.
      file: (receipts.find((r) => r.file) || bookings.find((r) => r.file))?.file || null,
      sources: rs.map(fileName),
      // 그 줄에 딸린 알림 — notes 에도 들어가고, 카드가 그 줄의 내용을 펼 때 같이 보인다.
      notes: [],
    });
    const missing = [[!row.company, '업체명'], [!row.paydate, '결제일'], [!row.sday, '숙박 일수'], [row.actual == null && row.doc.total == null, '정산금액']]
      .filter(([bad]) => bad).map(([, name]) => name);
    if (missing.length) {
      problems.push(`숙박(${row.sources.join('·')})에서 ${missing.join('·')}을(를) 읽지 못했습니다`);
      // 사람이 적어 줄 칸(fixes) — 그 묶음의 첫 문서(영수증이 먼저)의 기록에 적으면 lodgeOf 가 그 값을 쓴다.
      const target = receipts[0] || bookings[0];
      fixes.push({ file: fileName(target), what: `숙박${row.stay ? ` · ${row.stay}` : ''}`, fields: [
        [!row.company, 'vendor', '업체명', 'text'], [!row.paydate, 'payDate', '결제일', 'date'], [!row.sday, 'nights', '숙박 일수(박)', 'int'],
        [row.actual == null && row.doc.total == null, 'total', '정산금액(원)', 'money'],
      ].filter(([bad]) => bad).map(([, key, label, type]) => ({ key, label, type })) });
    }
    if (filled.length) row.notes.push(`${row.stay || '숙박'}: 문서에서 읽지 못해 ${filled.join(', ')} 넣었습니다 — 다르면 사후정산 화면에서 고쳐 주세요`);
    if (!receipts.length) row.notes.push(`${row.stay || '숙박'}은 예약서만 있고 결제 영수증이 없습니다 — 금액은 예약 금액입니다`);
    if (need.nights && row.sday && row.sday !== need.nights) row.notes.push(`${row.stay || '숙박'}의 숙박 일수(${row.sday}박)가 출장 기간(${need.nights}박)과 다릅니다`);
    notes.push(...row.notes);
    lodge.push(row);
  }

  // ---- 교통: 가는 편·오는 편. 표를 넣었거나 편이 사전정산과 달라졌을 때만 넣는다 — 그대로면 사전정산의 값이 선다.
  const flights = fit.filter((r) => FLIGHT.has(r.docType));
  for (const r of flights) {
    // 탑승일을 못 읽었어도 그 항공권이 가는 편·오는 편에 앉았으면 그 편의 날짜다(2026-11-20 사용자 지정: "사이드 패널에 이미 있잖아.
    // 그럼 그게 맞겠지") — 교통 줄의 일자는 이미 그 편의 날짜로 들어간다(legPlan). 그렇게 넣었다고 알린다.
    const seated = r.flightDate ? [] : route.legs.filter((l) => l.ticket && l.ticket.source === fileName(r));
    if (seated.length) notes.push(`${fileName(r)}: 탑승일을 읽지 못해 ${seated.map((l) => `${l.label}의 날짜(${shortDay(l.row?.date || l.date)})`).join('·')}로 넣었습니다 — 다르면 사후정산 화면에서 고쳐 주세요`);
    const noDate = !r.flightDate && !seated.length;
    const missing = [[noDate, '탑승일'], [!text(r.depPlace), '출발지'], [!text(r.arrPlace), '도착지'], [num(r.total) == null, '합계 금액']]
      .filter(([bad]) => bad).map(([, name]) => name);
    if (missing.length) {
      // 값을 못 읽은 항공 문서는 막지도 묻지도 않는다(2026-11-20 사용자 지정: "파악이 안되면 그냥 항공영수증으로 올려" · 적는 칸을 두고 "이거 하지
      // 말라니깐") — 증빙(항공기 증명)으로만 두고 교통비 줄은 넣지 않는다. 적는 칸(fixes)은 올리기를 막는 숙박 증빙에만 준다.
      notes.push(`${fileName(r)}: ${missing.join('·')}을(를) 읽지 못해 항공 영수증(증빙)으로만 두었습니다 — 교통비 줄은 넣지 않았습니다`);
    }
  }
  const touched = route.changed || route.legs.some((l) => l.ticket);
  if (touched) {
    for (const l of route.legs) {
      if (!l.pick?.t) continue;                     // 고르지 않은 편
      if (!l.row) { notes.push(`${l.label}은 넣지 못했습니다 — ${l.problem}. 사후정산 화면에서 넣어 주세요`); continue; }
      // 출발·도착 시: 항공권이 앉은 편은 항공권의 시각이다. 나머지 편은 사전정산의 줄에 적힌 시각이고, 비어 있으면 출장 출발·도착 시각과
      // 구간의 대략 소요 시간으로 채운다(src/travel.js 의 legTimes — 가는 편은 출발 시각에 떠나고, 오는 편은 도착 시각에 닿는다).
      // 갈아타는 KTX 편(부산→오송, 오송→목포)은 구간마다 한 줄이다(legParts) — 시각도 구간이 이어지게 채운다(legTimesAll).
      // 비행기 편은 탑승 2시간 전에 떠나 착륙 1시간 뒤에 닿는 것으로 적는다(planeHours). 표에 시각이 없으면 다른 편처럼 출장 시각으로 채운다.
      const at = (l.ticket && planeHours(l.ticket) && [planeHours(l.ticket)]) || legTimesAll(l.key, l.row, detail);
      legParts(l.row).forEach((r, i) => trans.push({
        date: r.date || null, shr: String(at[i]?.shr ?? ''), ehr: String(at[i]?.ehr ?? ''), dep: text(r.dep), arr: text(r.arr),
        transport: AFTER_TRANSPORT[l.pick.t], grade: text(r.grade), total: num(r.total), currency: r.currency || DOMESTIC.currency,
        cocard: l.ticket?.cocard ? '1' : '0', comment: l.ticket?.name || '', source: l.ticket?.source || l.label,
      }));
    }
    notes.push(...route.notes);
    for (const t of seats.extra) notes.push(`${t.source}: 가는 편·오는 편에 이미 표가 있어 넣지 않았습니다`);
  }
  // 비행기인 편 — 항공권이 앉은 편이거나, 표 없이 비행기 줄(사후정산에 올라가 있는 줄·사전정산의 줄)이 선 편이다.
  const planeLegs = route.legs.filter((l) => l.ticket || (l.row && l.row.transport === PRE_PLANE));
  // 표 없이 비행기 줄만 있는 편은 이번에 비행기 교통 줄을 올릴 때만 마일리지를 셈한다 — 숙박만 올릴 때 항공 칸까지 다시 저장하지 않게.
  if (flights.length || (planeLegs.length && trans.some((t) => t.transport === AFTER_TRANSPORT.plane))) {
    // 항공사는 항공권에서, 없으면 비행기 줄의 비고(올릴 때 항공사·편명을 적는다 — "대한항공 KE1415")에서 읽는다.
    const airline = text(flights.map((r) => r.airline).find(Boolean)) || text(planeLegs.map((l) => l.row?.comment).find((c) => text(c)));
    // 신규 마일리지(2026-10-04 사용자 지정): 문서에 적혀 있으면 그 값이고, 적혀 있지 않은 항공권은 **앉은 편마다 항공 마일리지 표**
    // (air-mileage.yaml, src/mileage.js)에서 찾아 더한다 — 구간 마일 × 좌석 등급의 적립률. 카드에서 그 편을 특실로 골랐거나 항공권의
    // 좌석 등급이 프레스티지·비즈니스면 특실의 적립률이다. 표에 없는 항공사·구간은 채우지 않고 알린다.
    const miles = flights.map((r) => num(r.mileage)).filter((m) => m != null);
    const found = [];
    const unknown = [];
    for (const l of planeLegs) {
      if (l.ticket?.mileage != null) continue;
      // 표가 앉은 편은 표의 구간, 표 없이 비행기 줄만 있는 편은 그 줄의 구간으로 항공 마일리지 표에서 찾는다(2026-11-20 사용자 지정: "항공기
      // 마일리지 표 있잖아 거기서 읽어서 넣어줘야지" — 항공 영수증에 구간이 없어 신규 마일리지가 0 으로 올라갔다).
      const src = l.ticket || { airline, dep: l.row.dep, arr: l.row.arr, grade: l.row.grade };
      const m = milesOf({ airline: src.airline || airline, dep: src.dep, arr: src.arr, first: l.pick?.g === 'first' || isFirstSeat(src.grade) });
      if (!m) { unknown.push(`${l.label} ${[src.airline || airline, `${src.dep}→${src.arr}`].filter(Boolean).join(' ')}`); continue; }
      found.push(`${l.label} ${describeMiles(m)}`);
      miles.push(m.miles);
    }
    // 항공권 출장 = 예, 업무 항공마일리지 발생 = 예(2026-10-03 사용자 지정 — 대한항공이면 예). 마일리지 공제는 예(신청)이고
    // (2026-10-04 사용자 지정 — 화면의 기본값이기도 하다) 공제 금액은 화면이 셈한다(마일 × 5).
    air = { abroad: 'Y', bizmile: 'Y', airline: airline || '', mileage: miles.length ? miles.reduce((a, b) => a + b, 0) : null, deduction: 'Y', usage: 'N' };
    if (!airline) notes.push('항공권에서 항공사를 읽지 못했습니다 — 사후정산 화면에서 항공사를 적어 주세요');
    if (found.length) notes.push(`신규 마일리지는 항공 마일리지 표에서 찾았습니다 — ${found.join(' · ')}`);
    if (unknown.length) notes.push(`항공 마일리지 표에 없어 신규 마일리지를 찾지 못한 편이 있습니다(${unknown.join(' · ')}) — 적립되는 항공권이면 사후정산 화면에서 적어 주세요`);
    else if (air.mileage == null) notes.push('항공권에 적립 마일리지가 적혀 있지 않습니다 — 신규 마일리지는 사후정산 화면에서 적어 주세요');
  }

  // 숙박 증빙도 항공권도 아닌 문서. 여비계산서에는 넣을 칸이 없다 — 무엇으로 읽었는지만 말한다.
  for (const r of records || []) {
    if (needsAfter(r) && !inPeriod.includes(r)) {   // fit 은 탑승일을 채운 사본이 섞여 있어 원본으로 견준다
      // 출장 기간의 것이 아닌 숙박 증빙·항공권 — 넣지 않았다고 알린다(패널·홈 카드가 알림 표시를 붙여 보관한다).
      const e = evidenceOf(r, trip);
      skipped.push(`${fileName(r)}: ${e.label} — ${e.warn} · 사후정산에 넣지 않았습니다`);
      continue;
    }
    if (!LODGING.has(r.docType) && !FLIGHT.has(r.docType)) {
      const e = evidenceOf(r, trip);
      // 여비계산서에는 영수증을 붙일 칸이 없다 — 패널이 보관함(src/evidence.js)에 담아 두었다가 담당자에게 보낼 때 같이 보낸다.
      if (e.ok) notes.push(`${fileName(r)}: ${e.label}으로 확인했습니다(출장지에서 ${shortDay(r.payDate)} 결제)`);
      else if (r.docType === 'other_receipt') skipped.push(`${fileName(r)}: ${e.label}으로 쓸 수 없습니다 — ${e.note}`);
      else skipped.push(`${fileName(r)}: ${e.label} — ${e.note}`);
    }
    if (text(r.extra)) {
      const note = `추가 정보 — ${fileName(r)}: ${text(r.extra)}`;
      notes.push(note);
      if (LODGING.has(r.docType)) lodge.find((l) => l.sources.includes(fileName(r)))?.notes.push(note);
    }
  }
  return { lodge, trans, air, notes, problems, fixes, skipped, need, picks: chosen, seats, legs: route.legs, touched };
}

const won = (n, cur) => (n == null ? '?' : `${Number(n).toLocaleString('ko-KR')}${cur && cur !== 'KRW' ? ` ${cur}` : '원'}`);
/** 교통비 줄의 수단을 짧게 부르는 이름(요약과 카드에 쓴다). */
export const TRANS_NAME = { [AFTER_TRANSPORT.plane]: '비행기', [AFTER_TRANSPORT.train]: 'KTX', [AFTER_TRANSPORT.bus]: '버스' };

/** 올린(또는 올릴) 사후정산을 한 줄로. 상태 줄과 기록에 쓴다. */
export function afterSummary(plan) {
  const parts = [];
  for (const l of plan.lodge) parts.push(`숙박 ${l.company || '?'} ${l.sday ?? '?'}박 ${won(l.total, l.currency)}${l.capped ? '(기본금액)' : l.maxed ? '(상한액)' : ''}`);
  for (const t of plan.trans) parts.push(`${TRANS_NAME[t.transport] || t.transport} ${t.date || '?'} ${t.dep || '?'}→${t.arr || '?'} ${won(t.total, t.currency)}`);
  if (plan.air) parts.push(`항공 마일리지 ${plan.air.airline || '항공사 ?'}${plan.air.mileage != null ? ` ${plan.air.mileage.toLocaleString('ko-KR')}마일` : ''}`);
  return parts.join(' · ');
}

/**
 * 사후정산 입력 화면의 폼 그대로 보낼 칸을 차례대로 만든다 — 화면이 가진 칸(base: formFields 의 결과)에 항공·식비 값을 얹고,
 * 숙박·교통 줄을 화면의 addLodge()/addTr() 가 만드는 순서대로 덧붙인다(같은 이름이 줄마다 되풀이되는 배열 폼이다).
 * 숙박 줄의 비고는 묵은 곳·사업자명 뒤에 상한 초과 사유를 이은 글이다(lodgeComment — 상한액을 넘겨 실제 금액으로 정산하는 줄에만 붙는다).
 * 파일은 { file } 로 표시해 두고 보내는 쪽(src/trip.js)이 Blob 으로 바꾼다.
 * @param {[string,string][]} base 화면의 칸
 * @param {ReturnType<typeof afterPlan>} plan
 * @returns {[string, string|{file:object}][]}
 */
export function afterFields(base, plan) {
  const override = new Map();
  if (plan.air) {
    override.set('air_abroad', plan.air.abroad).set('air_bizmile', plan.air.bizmile).set('air_bizairline', plan.air.airline || '')
      .set('air_mileage', plan.air.mileage == null ? '' : String(plan.air.mileage)).set('air_deduction', plan.air.deduction)
      .set('air_miles', plan.air.mileage == null || plan.air.deduction !== 'Y' ? '0' : String(plan.air.mileage * 5))
      .set('air_mileusage', plan.air.usage);
  }
  // 교통비 줄을 올릴 때는 화면에 이미 있던 교통 줄을 지움 표시한다(화면의 × 와 같다) — 가는 편·오는 편이 교통비 내역의 전부라,
  // 다시 올릴 때 같은 편이 두 번 들어가지 않게 한다. 숙박 줄은 있던 것을 두고 덧붙인다.
  if (plan.trans.length) override.set('tr_del', '1');
  const out = (base || []).map(([name, value]) => [name, override.has(name) ? override.get(name) : value]);
  const s = (v) => (v == null ? '' : String(v));
  for (const l of plan.lodge) {
    out.push(['lodge_nation', l.nation], ['lodge_seq', ''], ['lodge_del', '0'], ['lodge_oldfile', ''],
      ['lodge_maxtotal', s(l.maxtotal)], ['lodge_maxcur', s(l.maxcur)], ['lodge_maxrate', s(l.maxrate)], ['lodge_maxconv', s(l.maxconv)],
      ['lodge_paydate', s(l.paydate)], ['lodge_sday', s(l.sday)], ['lodge_company', s(l.company)], ['lodge_companycode', s(l.companycode)],
      ['lodge_currency', s(l.currency)], ['lodge_cocard', s(l.cocard || '0')], ['lodge_total', s(l.total)], ['lodge_samount', s(l.samount)],
      ['lodge_vat', s(l.vat)], ['lodge_comment', lodgeComment(l)], ['lodge_etcname', s(l.etcname)]);
    if (l.file) out.push(['lodge_file', { file: l.file }]);
  }
  for (const t of plan.trans) {
    out.push(['tr_seq', ''], ['tr_del', '0'], ['tr_smn', '0'], ['tr_emn', '0'], ['tr_date', s(t.date)], ['tr_shr', s(t.shr)], ['tr_ehr', s(t.ehr)],
      ['tr_dep', s(t.dep)], ['tr_arr', s(t.arr)], ['tr_transport', s(t.transport)], ['tr_grade', s(t.grade)], ['tr_total', s(t.total)],
      ['tr_currency', s(t.currency)], ['tr_cocard', s(t.cocard || '0')], ['tr_comment', s(t.comment)]);
  }
  return out;
}
