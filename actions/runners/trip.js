// 여비계산서 실행기 어댑터 — trip.* 기록을 src/travel.js·src/after.js·src/trip.js(송부는 src/send.js·pdf.js·teams.js·memo.js)의 인자로 바꿔 부른다.
//
//   registerTrip(d, deps)   디스패처에 trip.create · presave · preconfirm · postconfirm · delete · after · send · lodge 를 등록한다. deps 의 키는 실제 함수 이름과
//                           같고 기본값은 src 모듈의 진짜 함수다(테스트는 가짜를 넣는다)
//
//   trip.create     (rec, { memo, onStage })                → tripCreate(settlePlan(폼, memo), { emplNo: preset.hrMe.emplNo, name, onStage })
//                   폼은 기록의 칸 그대로이고 근무지가 비면 preset.workplace 다. memo 는 그 출장지에 기억해 둔 교통편(src/routes.js recallRoute — 패널이 준다)
//   trip.presave    (rec, { row, detail, onStage })         → tripPreSave(row, { ...prePlan(picks·edits), meals: stayPlan(meal).set }, { name, onStage })
//   trip.preconfirm · trip.postconfirm · trip.delete (rec, { row, onStage }) → src/trip.js 의 같은 이름 함수(row, { name, onStage })
//   trip.after      (rec, { row, detail, files, onStage })  → 지금 attendpanel 의 runAfter/sendAfter 차례 그대로:
//                   afterPlan(records − exclude, { trip: row, detail, picks, workplace }) → problems·대상 아님이면 던진다 → keepTrans 면 모르는 편이 있을 때 교통 줄을 비운다
//                   → 사전정산이 아직 "작성" 이면 preconfirm 일 때만 tripPreConfirm 부터(아니면 던진다) → 숙박 줄마다 tripLodgeMax 를 붙여 lodgeSettle → 이미 올라간 같은 줄은
//                   그 금액으로(lodgeKnown) → 기록의 lodge 결정(krw 는 actual 에 금액을 넣고 lodgeSettle, cap·actual 은 lodgeDecide)을 같은 함수로 되얹는다
//                   → 아직 사람이 정할 것이 남았으면(lodgeAsk) 올리지 않고 { sent: false, ask } 를 돌려준다 → tripAfterSave(row, trseq, plan, { name, onStage, always })
//   trip.send       (rec, { row, stage, kept, onStage })    → tripCalPdf → buildPdf(계산서 + 보관함 증빙) → Teams(teamsSendFile) 또는 쪽지(memoSend). 보내기만 한다(§14.4) —
//                   그 앞의 사후정산 저장·확정은 trip.after·trip.postconfirm 으로 패널이 먼저 돈다. 돌려주는 것은 { ok: true, channel, to, file, pages }
//   trip.lodge      (rec, { lodge, kept, maxes })           → lodgebox.js 의 `상한`·`비고에 저장`·지우기 차례 그대로:
//                   delete → tripAfterLodgeDelete · reason → 비고의 사유만 바꿔(lodgeReasonOf·lodgeCommentWith) tripAfterLodgeComment ·
//                   cap·real → lodgeCapState 로 상한액·실제 금액을 알아(모르면 ActionError) lodgeSettle → 비고의 사유를 잇거나 걷어 tripAfterLodgeAmount.
//                   lodge 는 화면에서 읽은 그 줄(tripAfterRows), kept 는 적어 둔 실제 금액·사유(attendLodgeActual 의 그 줄), maxes 는 읽어 둔 상한액이다.
//                   돌려주는 것은 { rows(다시 읽은 숙박 줄), lodge(정한 줄 — cap·real), comment(바뀐 비고 — 그대로면 null), reason, had(전에 비고에 있던 사유) }
//
// 숙박 줄(trip.lodge)이 아닌 trip.* 는 ctx.row(목록 줄)의 seq 가 기록의 seq 와 같은지 본다(§14.2 — 다르면 ActionError). trip.lodge 는 ctx.lodge 의 줄 번호를 본다.
// name 은 preset.tripMe(여비계산서 목록이 아는 내 이름)이고 비면 preset.me 다. 성공 판정(§14.3): trip.send 는 ok, 나머지는 던지지 않으면 성공(sent false 도 정상).
// 사이트 특유의 차례(저장 뒤 다시 읽어 판정·같은 줄 거르기·확정 폼 찾기)는 src/trip.js 에 그대로 있다 — 여기는 기록을 인자로 바꾸기만 한다.

import { settlePlan, prePlan, stayPlan, tripStage, DEFAULT_TRANSPORT, DEFAULT_GRADE } from '../../src/travel.js';
import { afterPlan, lodgeSettle, lodgeDecide, lodgeAsk, lodgeKnown, lodgeCommentWith, lodgeCommentWithout, LODGE_CURRENCY, LODGE_OVER_REASON } from '../../src/after.js';
import { lodgeKey } from '../../src/afterup.js';
import {
  tripCreate, tripPreSave, tripPreConfirm, tripPostConfirm, tripDelete, tripLodgeMax, tripAfterLodges, tripAfterSave, tripCalPdf,
  tripAfterLodgeAmount, tripAfterLodgeComment, tripAfterLodgeDelete,
} from '../../src/trip.js';
import { lodgeCapState, lodgeReasonOf } from '../../lodgebox.js';
import { sendTitle, sendLines, calName, WAYS } from '../../src/send.js';
import { buildPdf } from '../../src/pdf.js';
import { teamsSendFile } from '../../src/teams.js';
import { memoSend, memoHtml } from '../../src/memo.js';
import { MAIL_DOMAIN } from '../../src/config.js';
import { ActionError } from '../gate.js';
import { fileOf } from './attend.js';

const defaults = {
  settlePlan, prePlan, stayPlan, tripStage, afterPlan, lodgeSettle, lodgeDecide, lodgeAsk, lodgeKnown,
  tripCreate, tripPreSave, tripPreConfirm, tripPostConfirm, tripDelete, tripLodgeMax, tripAfterLodges, tripAfterSave, tripCalPdf,
  tripAfterLodgeAmount, tripAfterLodgeComment, tripAfterLodgeDelete,
  sendTitle, sendLines, calName, buildPdf, teamsSendFile, memoSend, memoHtml,
};
const always = () => true;

/** 여비계산서 화면이 아는 내 이름 — 비면 패널 설정의 내 이름. */
const nameOf = (rec) => rec.preset?.tripMe || rec.preset?.me || '';

/** ctx.row 가 기록의 계산서인지 본다(§14.2). */
function sameRow(rec, ctx) {
  const row = ctx?.row;
  if (!row || String(row.seq) !== String(rec.input.seq)) {
    throw new ActionError(rec.action, [`ctx.row 의 계산서 번호(${row?.seq ?? '없음'})가 기록의 ${rec.input.seq} 와 다릅니다`]);
  }
  return row;
}

/** ctx.lodge(화면에서 읽은 숙박 줄)가 기록의 줄인지 본다(§14.2). */
function sameLodge(rec, ctx) {
  const row = ctx?.lodge;
  if (!row || String(row.seq) !== String(rec.input.lodgeSeq)) {
    throw new ActionError(rec.action, [`ctx.lodge 의 숙박 줄 번호(${row?.seq ?? '없음'})가 기록의 ${rec.input.lodgeSeq} 와 다릅니다`]);
  }
  return row;
}

/** 그 계산서에서 내 출장자 번호 — 이름이 맞는 출장자가 없으면 첫 사람(attendpanel 의 trseqOf 와 같다). */
const trseqOf = (row, name) => ((row.travelers || []).find((t) => t.name === name) || (row.travelers || [])[0])?.trseq || '';

/** trip.create 기록 → settlePlan 이 받는 출장 폼. 근무지가 비면 사전설정의 근무지, 교통편·등급이 비면 기본값(기차·일반석 — 폼과 같다). */
export function tripFormOf(rec) {
  const i = rec.input;
  return {
    kind: 'trip', dateFrom: i.dateFrom, start: i.start, dateTo: i.dateTo, end: i.end, days: i.days,
    place: i.place || '', venue: i.venue || '', purpose: i.purpose || '', workplace: i.workplace || rec.preset?.workplace || '',
    transport: Array.isArray(i.transport) && i.transport.length ? [...i.transport] : [DEFAULT_TRANSPORT], trainGrade: i.trainGrade || DEFAULT_GRADE,
  };
}

/** trip.after 의 picks(goT·goG·backT·backG) → afterPlan 의 { go: { t, g }, back: { t, g } }. t 가 없는 편은 고르지 않은 것이라 키를 두지 않는다. */
export function picksOf(p) {
  const out = {};
  if (p?.goT) out.go = { t: p.goT, g: p.goG || DEFAULT_GRADE };
  if (p?.backT) out.back = { t: p.backT, g: p.backG || DEFAULT_GRADE };
  return out;
}

/** trip.presave 의 picks 줄([{ leg, t, g }]) → prePlan 의 { go, back }. t 가 없는 줄은 손대지 않은 편이다. */
function prePicksOf(list) {
  const out = {};
  for (const p of list || []) if (p?.t) out[p.leg] = { t: p.t, g: p.g || DEFAULT_GRADE };
  return out;
}

/** trip.presave 의 edits 줄([{ leg, date, shr, ehr }]) → prePlan 의 edits({ go: { date?, shr?, ehr? } }). 비운 칸은 적지 않는다. */
function preEditsOf(list) {
  const out = {};
  for (const e of list || []) {
    const one = {};
    if (e?.date) one.date = e.date;
    if (Number.isInteger(e?.shr)) one.shr = e.shr;
    if (Number.isInteger(e?.ehr)) one.ehr = e.ehr;
    if (Object.keys(one).length) out[e.leg] = one;
  }
  return out;
}

/**
 * @param {ReturnType<import('../dispatch.js').createDispatcher>} d
 * @param {Partial<typeof defaults>} [deps]
 */
export function registerTrip(d, deps = defaults) {
  const f = { ...defaults, ...deps };

  d.register('trip.create', (rec, ctx = {}) => {
    const who = rec.preset?.hrMe;
    if (!who?.emplNo) throw new Error('HR 에서 사번을 확인하지 못했습니다');
    const plan = f.settlePlan(tripFormOf(rec), ctx.memo || null);
    return f.tripCreate(plan, { emplNo: who.emplNo, name: who.name || rec.preset?.me || '', onStage: ctx.onStage });
  }, { ok: always });

  d.register('trip.presave', (rec, ctx = {}) => {
    const row = sameRow(rec, ctx);
    const detail = ctx.detail || {};
    const plan = f.prePlan({
      trip: row, picks: prePicksOf(rec.input.picks), rows: detail.rows || [], workplace: rec.preset?.workplace || '',
      sHour: detail.sHour ?? null, eHour: detail.eHour ?? null, edits: preEditsOf(rec.input.edits),
    });
    if (plan.problems.length) throw new Error(plan.problems.join(' · '));
    const stay = f.stayPlan({ stays: detail.stays || [], period: detail.period || '', want: Number.isInteger(rec.input.meal) ? rec.input.meal : null });
    return f.tripPreSave(row, { ...plan, meals: stay?.set || null }, { name: nameOf(rec), onStage: ctx.onStage });
  }, { ok: always });

  d.register('trip.preconfirm', (rec, ctx = {}) => f.tripPreConfirm(sameRow(rec, ctx), { name: nameOf(rec), onStage: ctx.onStage }), { ok: always });
  d.register('trip.postconfirm', (rec, ctx = {}) => f.tripPostConfirm(sameRow(rec, ctx), { name: nameOf(rec), onStage: ctx.onStage }), { ok: always });
  d.register('trip.delete', (rec, ctx = {}) => f.tripDelete(sameRow(rec, ctx), { name: nameOf(rec), onStage: ctx.onStage }), { ok: always });

  d.register('trip.after', async (rec, ctx = {}) => {
    const first = sameRow(rec, ctx);
    const name = nameOf(rec);
    const onStage = typeof ctx.onStage === 'function' ? ctx.onStage : () => {};
    const i = rec.input;
    // 기록의 증빙은 참조뿐이다 — 바이트를 ctx.files 에서 잇는다(숙박 줄의 첨부 lodge_file). 빼기로 한 증빙은 묶지 않는다(보관함에는 그대로다).
    const records = (i.records || []).map((r) => ({ ...r, file: r.file ? fileOf(rec, r.file, ctx.files) : null }));
    const skip = new Set((i.exclude || []).map((x) => x.name));
    const use = records.filter((r) => !(r.file && skip.has(r.file.name)));
    const plan = f.afterPlan(use, { trip: first, detail: ctx.detail || {}, picks: picksOf(i.picks), workplace: i.workplace || '' });
    if (plan.problems.length) throw new Error(plan.problems.join(' · '));
    if (!plan.need?.needed) throw new Error('당일 출장이고 비행기를 타지 않아 사후정산 대상이 아닙니다.');
    // 값을 모르는 편이 있으면(항공권을 다시 넣어야 하는 편 등) 교통비 내역은 화면에 있는 그대로 둔다 — 아는 편만 올리면 화면에 있던 줄이 지워진다(saveAfter).
    if (i.keepTrans && plan.legs.some((l) => l.pick?.t && !l.row)) plan.trans = [];

    // 사후정산을 올리려면 사전정산이 완료(확정)돼 있어야 한다(2026-10-03 사용자 지정) — 아직이면 preconfirm 일 때만 확정부터 한다. row 는 확정하면 다시 읽은 줄이 된다(출장자 번호가 그때 생긴다).
    let row = first;
    let confirmed = false;
    const stage = f.tripStage(row, name);
    if (stage.phase === 'pre' && !stage.done) {
      if (!i.preconfirm) throw new Error(`여비계산서 ${row.seq} 의 사전정산이 아직 완료(확정)되지 않아 사후정산을 올리지 않았습니다 — 먼저 확정해 주세요`);
      const r = await f.tripPreConfirm(row, { name, onStage });
      row = r.row;
      confirmed = !!r.sent;
    }
    const trseq = i.trseq || trseqOf(row, name);

    // 숙박 줄의 정산금액 — 사이트의 상한액을 붙여 정하고, 이미 올라가 있는 같은 줄은 그 금액으로(상한액을 넘어도 다시 묻지 않는다 — 2026-10-05 사용자 지정).
    if (plan.lodge.length) onStage('숙박비 상한액을 확인하는 중...');
    for (const l of plan.lodge) f.lodgeSettle(Object.assign(l, await f.tripLodgeMax(trseq, l.nation, l.currency)));
    if (plan.lodge.some((l) => f.lodgeAsk(l) === 'cap')) {
      const have = await f.tripAfterLodges(row.seq, trseq).catch(() => []);
      for (const l of plan.lodge) {
        const how = f.lodgeAsk(l) === 'cap' ? f.lodgeKnown(l, have) : '';
        if (how) f.lodgeDecide(plan, l, how);
      }
    }
    // 사람이 정해 준 것(기록의 lodge — 차례대로: 원화 금액을 적은 뒤 상한액/실제 금액을 고를 수 있다)을 같은 함수로 되얹는다.
    for (const dec of i.lodge || []) {
      const l = plan.lodge.find((x) => lodgeKey(x) === dec.key);
      if (!l) throw new ActionError(rec.action, [`숙박 줄 ${dec.key} 이(가) 이번 묶음에 없습니다`]);
      if (dec.settle === 'krw') {
        if (!(dec.amount > 0)) throw new ActionError(rec.action, [`숙박 줄 ${dec.key} 의 원화 금액(amount)이 없습니다`]);
        l.actual = Math.round(dec.amount);
        f.lodgeSettle(l);
      } else {
        f.lodgeDecide(plan, l, dec.settle === 'cap' ? 'cap' : 'real', typeof dec.reason === 'string' ? dec.reason : undefined);
      }
    }
    // 아직 사람이 정할 것이 남았으면 올리지 않는다 — 패널이 묻고, 답을 lodge 에 담은 새 기록으로 다시 온다.
    const asks = plan.lodge.filter((l) => f.lodgeAsk(l));
    if (asks.length) {
      return { row, stage: f.tripStage(row, name), sent: false, asked: asks.length, ask: asks.map((l) => ({ key: lodgeKey(l), kind: f.lodgeAsk(l) })), confirmed, plan };
    }
    const r = await f.tripAfterSave(row, trseq, plan, { name, onStage, always: !!i.always });
    return { ...r, confirmed, plan };
  }, { ok: always });

  d.register('trip.send', async (rec, ctx = {}) => {
    const row = sameRow(rec, ctx);
    const { account, to, channel, reason, file } = rec.input;
    const me = nameOf(rec);
    const onStage = typeof ctx.onStage === 'function' ? ctx.onStage : () => {};
    const kept = ctx.kept || [];
    const label = WAYS.find((w) => w.channel === channel)?.label || channel;
    // 확정한 여비계산서를 출력(PDF)해 증빙 앞에 붙인다(2026-10-04 사용자 지정) — 받지 못하면 증빙만 보내지 않고 멈춘다. 로그인이 풀린 것은 그 말 그대로 둔다.
    onStage('여비계산서를 PDF 로 받는 중...');
    const cal = await f.tripCalPdf(row, { name: me, onStage }).catch((err) => {
      if (err?.name !== 'AuthError') err.message = `여비계산서를 PDF 로 받지 못해 보내지 않았습니다 — ${err.message}`;
      throw err;
    });
    onStage('여비계산서와 증빙을 PDF 로 묶는 중...');
    const pdf = await f.buildPdf([{ name: f.calName({ trip: row }), bytes: cal.bytes }, ...kept], { title: `여비계산서 ${row.seq} 증빙` });
    const title = f.sendTitle({ account, me, trip: row });
    const lines = f.sendLines({ account, me, trip: row, stage: ctx.stage || { label: '' }, reason: reason || '', kept, file });
    onStage(`${label}로 보내는 중...`);
    if (channel === 'teams') await f.teamsSendFile({ email: `${to.id}@${MAIL_DOMAIN}`, html: f.memoHtml([title, ...lines]), file: { name: file, bytes: pdf.bytes } });
    else await f.memoSend({ to: [to.id], title, lines, file: { name: file, bytes: pdf.bytes, type: 'application/pdf' }, onStage });
    return { ok: true, channel, to: to.id, file, pages: pdf.pages };
  });

  d.register('trip.lodge', async (rec, ctx = {}) => {
    const i = rec.input;
    const row = sameLodge(rec, ctx);
    if (i.action === 'delete') return { rows: await f.tripAfterLodgeDelete(i.seq, i.trseq, i.lodgeSeq), lodge: null, comment: null, reason: '', had: '' };
    const kept = ctx.kept || null;
    const { reason: had, base, known } = lodgeReasonOf(row, kept);
    const before = String(row.comment ?? '').trim();
    // 비고의 상한 초과 사유만 고쳐 쓴다 — 나머지 글(묵은 곳 등)은 그대로, 빈 사유는 기본 문구(사유는 필수다).
    if (i.action === 'reason') {
      const reason = i.reason || LODGE_OVER_REASON;
      const comment = lodgeCommentWith(base, reason);
      return { rows: await f.tripAfterLodgeComment(i.seq, i.trseq, i.lodgeSeq, comment), lodge: null, comment, reason, had };
    }
    // `상한` — 실제 금액과 상한액 사이를 오간다. 공급가액·부가세는 lodgeSettle 이 정한다(적어 둔 문서의 값이 있으면 그것). 실제 금액으로 되돌리면 비고에 사유를 잇고, 낮추면 걷는다.
    const c = lodgeCapState(row, kept, ctx.maxes || {});
    if (!c?.can) throw new ActionError(rec.action, [`숙박 줄 ${i.lodgeSeq} 의 상한액이나 실제 금액을 몰라 정산금액을 바꿀 수 없습니다`]);
    const l = f.lodgeSettle({ actual: c.actual, maxconv: c.day, sday: c.sday, settle: i.action, doc: { currency: LODGE_CURRENCY, total: c.actual, supply: kept?.supply ?? null, vat: kept?.vat ?? null } });
    // 기록에 사유가 있으면(말로 정한 것) 비고에 있던 사유를 그것으로 바꾼다 — 없으면 있던 사유를 그대로 둔다(`상한` 버튼은 사유 없이 온다).
    const reason = i.action === 'real' ? i.reason || had || known[0] : '';
    const comment = i.action === 'real' ? lodgeCommentWith(i.reason ? base : before, reason) : lodgeCommentWithout(before, known);
    const commented = comment !== before;
    const rows = await f.tripAfterLodgeAmount(i.seq, i.trseq, i.lodgeSeq, { total: l.total, samount: l.samount, vat: l.vat, ...(commented ? { comment } : {}) });
    return { rows, lodge: l, comment: commented ? comment : null, reason, had };
  }, { ok: always });
  return d;
}
