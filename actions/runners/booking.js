// 회의실·차량 실행기 어댑터 — 기록(record)을 기존 실행기(src/runners.js RUNNERS · src/modify.js · src/search.js)의 인자로 바꿔 부른다.
//
//   registerBooking(d, { runners, modifyReservation, findSlots })   디스패처 d 에 네 실행기를 등록한다(검사는 가짜를 넣는다)
//     booking.search  (rec, { onProgress, loadDay })        → findSlots(rec.input, onProgress, loadDay)              room.search · car.search(confirm false)
//     booking.reserve (rec, { day, blocked })               → RUNNERS[갈래].reserve(payloadOf(rec, { blocked }), day)   ok: r.ok && r.verified !== false
//     booking.cancel  (rec, { day, record })                → RUNNERS[갈래].cancel(record, day)                      ok: r.ok — record 는 사이트에서 읽은 산 손잡이
//     booking.modify  (rec, { day, target, live, reloadFor, onStage, blocked })
//                                                          → modifyReservation({ cancel, reserve, restore, onStage })   ok: r.ok && r.verified !== false
//   payloadOf(rec, { blocked })        기록의 input 을 RUNNERS.<갈래>.payload(pick) 이 내던 모양 그대로(kind·차량의 room 별칭·endDate 규칙·blocked)
//   inputOf(payload)                   거꾸로 — 패널이 pickToPayload 로 지은 한 건을 기록의 input 으로(kind·별칭·blocked 는 뺀다)
//   cancelInputOf(kind, span)          취소 기록의 input — 내 예약 목록의 줄이나 격자의 손잡이(handleSpan)에서
//   handleSpan(record, day)            격자의 산 손잡이에서 취소 기록이 볼 구간(차량은 자르기 전의 원래 구간)
//   kindOf(rec)                        행위 ID 의 갈래(room · car)
//   LIVE_RECORD_GONE                   다시 읽은 화면에 그 예약이 없을 때의 말(수정의 취소 단계·내 예약 목록의 취소)
//
// 여기는 **기록 → 인자 변환만** 한다. 실행 순서·다시 조회·되돌리기 판단(src/modify.js)·단계 표시는 기존 함수와 패널에 그대로 있다.
//
// booking.modify 의 ctx — 패널의 두 길을 그대로 옮긴 것이다.
//   수정(runModify):      live(day) 가 있다 — 취소 전에 원래 날짜를 다시 읽고(reloadFor) 거기서 산 손잡이를 찾는다. 없으면 취소를 보내지 않고
//                         LIVE_RECORD_GONE 으로 멈춘다(modify.js 가 "그대로 두었다" 고 말한다)
//   이어붙이기(extend):   target 이 있다 — 보고 있던 화면(day)의 손잡이로 바로 취소한다
//   둘 다 새 예약·되살리기 전에는 그 날짜를 다시 읽어 그 화면의 ViewState 로 보낸다. reloadFor(date) 는 패널이 실행자·지역을 묶어 준다.
//   blocked 는 새 차량(next)의 막음만이다 — 되살리는 원래 건에는 붙이지 않는다.

import { RUNNERS } from '../../src/runners.js';
import { modifyReservation } from '../../src/modify.js';
import { findSlots } from '../../src/search.js';
import { fmtTime } from '../../src/parse.js';
import { ACTIONS } from '../spec.js';
import { ActionError } from '../gate.js';

/** 다시 읽은 화면에서 그 예약을 찾지 못했을 때의 말. 취소를 보내지 않았으므로 원래 예약은 그대로다. */
export const LIVE_RECORD_GONE = '방금 다시 읽은 화면에서 그 예약을 찾지 못했습니다. 이미 취소됐거나 바뀌었을 수 있습니다 — 새로고침한 뒤 다시 해 주세요.';

/** 행위 ID 의 갈래 — 'room.reserve' → 'room'. */
export const kindOf = (record) => String(record?.action ?? '').split('.')[0];

/** 관문은 빈 글을 null 로 두지만, 실행기는 입력칸의 값('' — el.title.value.trim())을 받던 자리다. */
const text = (v) => (v == null ? '' : String(v));

/**
 * 기록의 칸을 RUNNERS.<갈래>.payload(pick) 이 내던 한 건으로. 키의 차례까지 같다(test/runners.test.mjs 의 기대와 맞춘다).
 *   room: kind · room · roomValue · region · date · start · end · title
 *   car:  kind · car · carValue · room(별칭 — 진행 표시와 '내가 넣음' 기록이 room 을 본다) · date · start · end · endDate?(이용일과 다를 때만) ·
 *         title · place · passenger · blocked?(사이트가 예약 버튼에서 막는 차량 — 기록이 아니라 ctx 에서 온다)
 */
export function toPayload(kind, input, { blocked } = {}) {
  const f = input || {};
  if (kind === 'room') {
    return { kind: 'room', room: f.room, roomValue: f.roomValue, region: f.region ?? null, date: f.date, start: f.start, end: f.end, title: f.title };
  }
  if (kind === 'car') {
    return {
      kind: 'car',
      car: f.car,
      carValue: f.carValue,
      room: f.car,
      date: f.date,
      start: f.start,
      end: f.end,
      ...(f.endDate && f.endDate !== f.date ? { endDate: f.endDate } : {}),
      title: text(f.title),
      place: text(f.place),
      passenger: text(f.passenger),
      ...(blocked ? { blocked } : {}),
    };
  }
  throw new ActionError(`${kind}.?`, [`모르는 갈래 ${kind}`]);
}

/** 기록 → 실행기가 받는 한 건. */
export function payloadOf(record, { blocked } = {}) {
  return toPayload(kindOf(record), record?.input, { blocked });
}

/** 실행기가 받는 한 건 → 기록의 input. kind·blocked 와 차량의 room 별칭은 기록의 칸이 아니다(관문은 모르는 키를 버리지만 여기서 미리 뗀다). */
export function inputOf(payload) {
  const rest = { ...(payload || {}) };
  delete rest.kind;
  delete rest.blocked;
  if (payload?.kind === 'car') delete rest.room;
  return rest;
}

/**
 * 격자의 산 손잡이에서 취소 기록이 볼 구간. 차량은 여러 날에 걸쳐 그날 것으로 잘린 start·end(0·1440)로는 시각을 적을 수 없어
 * 자르기 전의 원래 구간(spanStart·spanEnd)을 쓰고, 회의실은 그날의 분이다.
 */
export function handleSpan(record, day) {
  const r = record || {};
  return {
    name: r.room || r.name || null,
    from: r.spanStart || { date: day?.date ?? null, minutes: r.start },
    to: r.spanEnd || { date: day?.date ?? null, minutes: r.end },
    title: r.title ?? null,
    region: day?.region ?? null,
  };
}

/**
 * 취소 기록의 input. 구간은 내 예약 목록의 줄(from·to: { date, minutes })과 같은 꼴이다 — 격자의 손잡이는 handleSpan 으로 맞춘다.
 * 회의주제·행선지는 기록용이라 명세의 한도에서 자른다 — 사이트의 긴 제목이 취소를 막으면 안 된다.
 */
export function cancelInputOf(kind, { name, from, to, title, region, place } = {}) {
  const fields = ACTIONS.actions[`${kind}.cancel`]?.fields || {};
  const clip = (v, key) => (typeof v === 'string' && v ? v.slice(0, fields[key]?.max ?? 2000) : null);
  const time = (m) => (Number.isFinite(m) ? fmtTime(m) : null);
  const base = { date: from?.date ?? null, start: time(from?.minutes), end: time(to?.minutes), title: clip(title, 'title') };
  if (kind === 'car') {
    return { car: name ?? null, ...base, endDate: to?.date && from?.date && to.date !== from.date ? to.date : null, place: clip(place, 'place') };
  }
  return { room: name ?? null, ...base, region: region ?? null };
}

/** 기록이 든 갈래의 실행자. 없으면 ActionError — 짐작으로 회의실에 보내지 않는다. */
function runnerFor(runners, record) {
  const kind = kindOf(record);
  const run = Object.hasOwn(runners, kind) ? runners[kind] : null;
  if (!run) throw new ActionError(record.action, [`모르는 갈래 ${kind}`]);
  return run;
}

/** 사이트에서 읽은 손잡이가 기록의 그 건인지 — 이름이 다르면 다른 건을 지우는 것이다. */
function sameTarget(record, handle) {
  const want = record.input?.room ?? record.input?.car ?? null;
  const got = handle?.room || handle?.name || null;
  return !want || !got || want === got;
}

/**
 * 디스패처에 회의실·차량 실행기를 등록한다. deps 의 키는 실제 함수 이름과 같고 기본값은 src 의 진짜 함수다(검사는 가짜를 넣는다).
 * @param {{ register: Function }} d createDispatcher() 가 만든 디스패처
 */
export function registerBooking(d, { runners = RUNNERS, modifyReservation: modify = modifyReservation, findSlots: search = findSlots } = {}) {
  const okVerified = (r) => r?.ok === true && r?.verified !== false;

  d.register('booking.search', async (rec, ctx = {}) => search(rec.input, ctx.onProgress, ctx.loadDay), { ok: () => true });

  d.register('booking.reserve', async (rec, ctx = {}) => {
    const run = runnerFor(runners, rec);
    return run.reserve(payloadOf(rec, { blocked: ctx.blocked }), ctx.day);
  }, { ok: okVerified });

  d.register('booking.cancel', async (rec, ctx = {}) => {
    const run = runnerFor(runners, rec);
    if (!ctx.record || typeof ctx.record !== 'object') throw new ActionError(rec.action, ['취소할 예약의 손잡이(ctx.record)가 없습니다']);
    if (!sameTarget(rec, ctx.record)) throw new ActionError(rec.action, [`손잡이의 ${ctx.record.room || ctx.record.name} 과 기록의 ${rec.input.room ?? rec.input.car} 이 다릅니다`]);
    return run.cancel(ctx.record, ctx.day);
  }, { ok: (r) => r?.ok === true });

  d.register('booking.modify', async (rec, ctx = {}) => {
    const run = runnerFor(runners, rec);
    const kind = kindOf(rec);
    const { back, next } = rec.input;
    const live = typeof ctx.live === 'function' ? ctx.live : null;
    if (typeof ctx.reloadFor !== 'function') throw new ActionError(rec.action, ['다시 읽을 방법(ctx.reloadFor)이 없습니다']);
    if (!live && (!ctx.target || typeof ctx.target !== 'object')) throw new ActionError(rec.action, ['취소할 예약의 손잡이(ctx.target 또는 ctx.live)가 없습니다']);
    if (!live && !sameTarget({ input: back }, ctx.target)) throw new ActionError(rec.action, [`손잡이의 ${ctx.target.room || ctx.target.name} 과 원래 예약의 ${back.room ?? back.car} 이 다릅니다`]);

    let day = ctx.day;
    return modify({
      onStage: ctx.onStage,
      cancel: async () => {
        if (!live) return run.cancel(ctx.target, day);
        day = await ctx.reloadFor(back.date);
        const handle = live(day);
        // 취소를 보내지 않았으므로 원래 예약은 그대로다. modify.js 가 "그대로 두었다" 고 말한다.
        if (!handle) return { ok: false, submitted: false, message: LIVE_RECORD_GONE };
        return run.cancel(handle, day);
      },
      reserve: async () => {
        day = await ctx.reloadFor(next.date);
        return run.reserve(toPayload(kind, next, { blocked: ctx.blocked }), day);
      },
      restore: async () => {
        day = await ctx.reloadFor(back.date);
        return run.reserve(toPayload(kind, back), day);
      },
    });
  }, { ok: okVerified });

  return d;
}
