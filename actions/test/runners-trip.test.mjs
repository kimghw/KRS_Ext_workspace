// 여비계산서 어댑터(actions/runners/trip.js) — 기록을 기존 함수의 인자로 바꾸는 변환과 부르는 차례가 맞는가.
// trip.create: 폼 → settlePlan → tripCreate(사번·이름) · trip.presave: picks·edits·meal → prePlan·stayPlan → tripPreSave · preconfirm/postconfirm/delete: 그대로 ·
// trip.after: afterPlan → (preconfirm) → 상한액·같은 줄 → 기록의 lodge 결정 → (ask) → tripAfterSave · trip.send: calPdf → buildPdf → teams|memo.
// 사이트·PDF·Teams·쪽지는 가짜다(셈은 진짜 함수) — 실제 사이트에는 아무것도 가지 않는다.
import assert from 'node:assert/strict';

import { createDispatcher } from '../dispatch.js';
import { ACTIONS } from '../spec.js';
import { ActionError } from '../gate.js';
import { registerTrip, tripFormOf, picksOf } from '../runners/trip.js';
import { settlePlan, prePlan, stayPlan } from '../../src/travel.js';
import { afterPlan, lodgeSettle, lodgeDecide, lodgeAsk, lodgeKnown, LODGE_OVER_REASON } from '../../src/after.js';
import { sendTitle, sendLines, calName } from '../../src/send.js';
import { memoHtml } from '../../src/memo.js';
import { MAIL_DOMAIN } from '../../src/config.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const rejects = async (p, re, Type = Error) => {
  try { await p; } catch (err) { assert.ok(err instanceof Type, `${Type.name} 여야 한다: ${err}`); assert.match(err.message, re); return err; }
  return assert.fail('던져야 한다');
};

const TODAY = '2026-10-16';
const PRESET = { today: TODAY, me: '김기현', tripMe: '김거화' };
/** 그 행위의 사전설정 — 명세의 키를 모두 채운다(실행 모드는 키가 없으면 막는다 — 값은 null 이어도 된다). */
const presetFor = (id, over = {}) => ({ ...Object.fromEntries(Object.keys(ACTIONS.actions[id].preset).map((k) => [k, PRESET[k] ?? null])), ...over });
const ROW = { seq: '145580', href: '/BusinessTrip/Write?seq=145580&mode=E', pre: '완료', from: '2026-09-09', to: '2026-09-10', location: '서울', writer: '김거화', written: '2026-09-01',
  travelers: [{ name: '김거화', post: '대기', trseq: '157777' }] };
const KTX = (seq, date, dep, arr) => ({ seq, trseq: '7380', revno: '', date, dep, arr, transport: 'Train', grade: '일반석', total: 53700, currency: 'KRW' });
const DETAIL = { rows: [KTX('153340', '2026-09-09', '부산', '서울'), KTX('153341', '2026-09-10', '서울', '부산')], transports: ['Train', 'Train'], sHour: 7, eHour: 20,
  stays: [{ seq: '124928', day: 2, daily: 2, long: 0, meal: 6 }], period: '0' };
const CAP = { maxtotal: '120000', maxcur: 'KRW', maxrate: '1', maxconv: '120000' };
// 읽은 증빙(receipt) — test/lodgeask.test.mjs 의 것과 같은 모양.
const blank = { docType: null, vendor: null, seller: null, sellerBiz: null, bizNo: null, payDate: null, payPlace: null, atDestination: null, checkIn: null, checkOut: null, nights: null,
  total: null, totalKRW: null, supply: null, vat: null, currency: 'KRW', corporateCard: null, transport: null, airline: null, flightNo: null, flightDate: null, depPlace: null, arrPlace: null,
  depTime: null, arrTime: null, seatClass: null, retDate: null, retDepPlace: null, retArrPlace: null, retDepTime: null, retFlightNo: null, mileage: null, passenger: null, extra: null, summary: '' };
const rec = (over) => ({ ...blank, ...over });
const AGODA = rec({ docType: 'lodging_booking', vendor: 'Toyoko INN Gangnam Seoul', seller: '아고다', payDate: '2026-09-08', checkIn: '2026-09-09', checkOut: '2026-09-10', nights: 1,
  total: 88.46, currency: 'USD', summary: 'Toyoko INN Gangnam Seoul 1박 예약 확인서 USD 88.46' });
const HOTEL = rec({ docType: 'lodging_receipt', vendor: '킨텍스호텔', bizNo: '128-81-00000', payDate: '2026-09-10', checkIn: '2026-09-09', checkOut: '2026-09-10', nights: 1,
  total: 110000, supply: 100000, vat: 10000, summary: '킨텍스호텔 1박 110,000원' });
const FILES = { 'a.png': { name: 'a.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }, 'h.png': { name: 'h.png', type: 'image/png', dataUrl: 'data:image/png;base64,BBBB' } };
const withFile = (r, name) => ({ ...r, file: { name, type: 'image/png' } });

/** 가짜 사이트·보내는 길과, 부른 차례를 적는 진짜 셈 함수를 단 디스패처. */
function make(site = {}) {
  const calls = [];
  const log = [];
  const spy = (name, fn) => (...args) => { calls.push([name, ...args]); return fn(...args); };
  const d = createDispatcher({ spec: ACTIONS, log: (e) => log.push(e), now: () => 1760600000000 });
  const fresh = { ...ROW, travelers: [{ name: '김거화', post: '대기', trseq: '157777' }] };
  registerTrip(d, {
    settlePlan: spy('settlePlan', settlePlan), prePlan: spy('prePlan', prePlan), stayPlan: spy('stayPlan', stayPlan),
    afterPlan: spy('afterPlan', afterPlan), lodgeSettle: spy('lodgeSettle', lodgeSettle), lodgeDecide: spy('lodgeDecide', lodgeDecide),
    lodgeAsk: spy('lodgeAsk', lodgeAsk), lodgeKnown: spy('lodgeKnown', lodgeKnown),
    tripCreate: spy('tripCreate', async () => site.create ?? { row: fresh, existing: false, linked: 2 }),
    tripPreSave: spy('tripPreSave', async (row) => ({ row, stage: { phase: 'pre', done: true, label: '사전정산 완료' }, detail: DETAIL, linked: 0 })),
    tripPreConfirm: spy('tripPreConfirm', async () => ({ row: fresh, stage: { phase: 'pre', done: true, label: '사전정산 완료' }, sent: true })),
    tripPostConfirm: spy('tripPostConfirm', async (row) => ({ row, stage: { phase: 'post', done: true, label: '사후정산 완료' }, sent: true })),
    tripDelete: spy('tripDelete', async (row) => ({ seq: String(row.seq) })),
    tripLodgeMax: spy('tripLodgeMax', async () => CAP),
    tripAfterLodges: spy('tripAfterLodges', async () => site.lodges || []),
    tripAfterSave: spy('tripAfterSave', async (row) => ({ row, stage: { phase: 'post', done: false, label: '사후정산 작성' }, sent: true, same: [], lodgeRows: [{ seq: '81561' }], lodgeSeqs: ['81561'] })),
    tripCalPdf: spy('tripCalPdf', async () => { if (site.noCal) throw Object.assign(new Error('리포트를 찾지 못했습니다'), { name: site.noCal }); return { bytes: new Uint8Array([1, 2]), pages: 1 }; }),
    buildPdf: spy('buildPdf', async () => ({ bytes: new Uint8Array([9]), pages: 3 })),
    teamsSendFile: spy('teamsSendFile', async () => ({ messageId: 'm-1' })),
    memoSend: spy('memoSend', async () => ({ dId: '771', file: 'ok' })),
  });
  const names = () => calls.map((c) => c[0]);
  const argsOf = (name) => calls.find((c) => c[0] === name)?.slice(1);
  return { d, calls, log, names, argsOf };
}
const build = (d, id, input, preset = null) => d.build(id, { input, preset: presetFor(id, preset || {}) }).record;
const run = (d, record, ctx = {}) => d.run(record, { confirmed: record.hash, ...ctx });

console.log('trip.create — 폼 → settlePlan(memo) → tripCreate(사번·이름)');
await ta('기록의 칸이 폼이 되고(근무지가 비면 사전설정의 근무지), ctx.memo 가 settlePlan 에 가며, 사번·이름은 hrMe 의 것이다', async () => {
  const { d, names, argsOf, log } = make();
  const preset = { hrMe: { emplNo: '11115', name: '김거화', dept: '전기' }, workplace: '부산' };
  const record = build(d, 'trip.create', { dateFrom: '2026-10-20', start: '07:00', dateTo: '2026-10-21', end: '20:00', days: 2, place: '대전', venue: '한국기계연구원', purpose: '착수회의', transport: ['train'], trainGrade: 'standard' }, preset);
  assert.equal(record.input.workplace, null);
  const memo = { transport: ['train'], trainGrade: 'standard', path: ['부산', '대전'], date: '2026-09-01' };
  const r = await run(d, record, { memo, onStage: () => {} });
  assert.deepEqual(names(), ['settlePlan', 'tripCreate']);
  assert.deepEqual(argsOf('settlePlan'), [tripFormOf(record), memo]);
  assert.deepEqual(tripFormOf(record), { kind: 'trip', dateFrom: '2026-10-20', start: '07:00', dateTo: '2026-10-21', end: '20:00', days: 2, place: '대전', venue: '한국기계연구원', purpose: '착수회의', workplace: '부산', transport: ['train'], trainGrade: 'standard' });
  const [plan, who] = argsOf('tripCreate');
  assert.deepEqual([plan.sDate, plan.eDate, plan.location, plan.trans.length > 0, who.emplNo, who.name], ['2026-10-20', '2026-10-21', '대전(한국기계연구원)', true, '11115', '김거화']);
  assert.deepEqual([r.existing, r.linked, log[0].kind, log[0].ok], [false, 2, 'trip', true]);
});
await ta('hrMe 가 없으면 기록을 짓지 못하고(required), 사번이 없으면 실행기가 던진다', async () => {
  const { d, calls } = make();
  const input = { dateFrom: '2026-10-20', start: '07:00', dateTo: '2026-10-20', end: '20:00', days: 1, place: '대전', purpose: '회의' };
  assert.throws(() => build(d, 'trip.create', input, { hrMe: null }), (err) => err instanceof ActionError && /hrMe 가 없습니다/.test(err.message));
  const record = build(d, 'trip.create', input, { hrMe: { name: '김거화' } });
  await rejects(run(d, record), /HR 에서 사번을 확인하지 못했습니다/);
  assert.deepEqual(calls, []);
});

console.log('trip.presave — picks·edits 줄 → prePlan, meal → stayPlan, 둘을 합쳐 tripPreSave');
await ta('고른 편(특실)·고친 일자·시각·식수가 패널이 짓던 계획과 같은 계획이 된다. 이름은 tripMe 다', async () => {
  const { d, names, argsOf } = make();
  const record = build(d, 'trip.presave', { seq: '145580', trseq: '157777', picks: [{ leg: 'go', t: 'train', g: 'first' }], edits: [{ leg: 'back', date: '2026-09-10', shr: 16, ehr: 20 }], meal: 4 });
  await run(d, record, { row: ROW, detail: DETAIL, onStage: () => {} });
  assert.deepEqual(names(), ['prePlan', 'stayPlan', 'tripPreSave']);
  const want = prePlan({ trip: ROW, picks: { go: { t: 'train', g: 'first' } }, rows: DETAIL.rows, workplace: '', sHour: 7, eHour: 20, edits: { back: { date: '2026-09-10', shr: 16, ehr: 20 } } });
  assert.deepEqual(argsOf('prePlan')[0], { trip: ROW, picks: { go: { t: 'train', g: 'first' } }, rows: DETAIL.rows, workplace: '', sHour: 7, eHour: 20, edits: { back: { date: '2026-09-10', shr: 16, ehr: 20 } } });
  const [row, plan, who] = argsOf('tripPreSave');
  assert.deepEqual([row, plan, who.name], [ROW, { ...want, meals: { 124928: 4 } }, '김거화']);
  assert.ok(plan.add.length > 0 && plan.drop.length === 2, '가는 편을 바꿨으니 줄을 모두 지우고 다시 넣는다');
});
await ta('줄이 없으면(손대지 않음·식수 null) 바꿀 것 없는 계획이고, 편의 문제(비행기인데 사전정산에 줄을 안 넣는 것은 문제가 아니다)가 있으면 던진다', async () => {
  const { d, argsOf, calls } = make();
  const record = build(d, 'trip.presave', { seq: '145580', picks: [], edits: [], meal: null });
  await run(d, record, { row: ROW, detail: DETAIL });
  const [, plan] = argsOf('tripPreSave');
  assert.deepEqual([plan.changed, plan.drop, plan.add, plan.meals], [false, [], [], null]);
  const plane = build(d, 'trip.presave', { seq: '145580', picks: [{ leg: 'back', t: 'plane', g: null }], edits: [], meal: null });
  await run(d, plane, { row: ROW, detail: DETAIL });
  assert.deepEqual(calls.filter((c) => c[0] === 'prePlan').at(-1)[1].picks, { back: { t: 'plane', g: 'standard' } }, '등급이 비면 일반석이다');
});

console.log('trip.preconfirm · trip.postconfirm · trip.delete — row 와 이름을 그대로 넘긴다');
await ta('세 행위 모두 src/trip.js 의 같은 함수에 (row, { name, onStage }) — tripMe 가 비면 갈래의 me 다', async () => {
  const { d, calls } = make();
  const onStage = () => {};
  for (const id of ['trip.preconfirm', 'trip.postconfirm', 'trip.delete']) {
    const record = build(d, id, { seq: '145580', trseq: '157777', docNo: 'TR-1' });
    await run(d, record, { row: ROW, onStage });
  }
  assert.deepEqual(calls.map((c) => [c[0], c[1], c[2]]), [['tripPreConfirm', ROW, { name: '김거화', onStage }], ['tripPostConfirm', ROW, { name: '김거화', onStage }], ['tripDelete', ROW, { name: '김거화', onStage }]]);
  const noMe = build(d, 'trip.delete', { seq: '145580' }, { tripMe: null });
  await run(d, noMe, { row: ROW });
  assert.deepEqual(calls.at(-1)[2], { name: '김기현', onStage: undefined });
});
await ta('ctx.row 가 기록의 계산서가 아니면 ActionError — 사이트로 가지 않는다', async () => {
  const { d, calls } = make();
  const record = build(d, 'trip.delete', { seq: '145580' });
  await rejects(run(d, record, { row: { ...ROW, seq: '999' } }), /계산서 번호\(999\)가 기록의 145580 와 다릅니다/, ActionError);
  await rejects(run(d, record, {}), /계산서 번호\(없음\)/, ActionError);
  assert.deepEqual(calls, []);
});

console.log('trip.after — afterPlan → (preconfirm) → 상한액·같은 줄 → lodge 결정 → (ask) → tripAfterSave');
const AFTER = (over = {}) => ({ seq: '145580', trseq: '157777', records: [], picks: { goT: null, goG: null, backT: null, backG: null }, workplace: '부산', lodge: [], exclude: [], always: false, keepTrans: false, preconfirm: false, ...over });
await ta('원화 영수증(상한 안): afterPlan → tripLodgeMax → lodgeSettle → lodgeAsk → tripAfterSave 차례이고, 같은 줄은 보지 않는다(cap 이 아니라). 숙박 줄에 첨부 바이트가 붙는다', async () => {
  const { d, names, argsOf, log } = make();
  const record = build(d, 'trip.after', AFTER({ records: [withFile(HOTEL, 'h.png')] }));
  assert.deepEqual(record.input.records[0].file, { name: 'h.png', type: 'image/png' });
  const onStage = () => {};
  const r = await run(d, record, { row: ROW, detail: DETAIL, files: [FILES['h.png']], onStage });
  assert.deepEqual(names(), ['afterPlan', 'tripLodgeMax', 'lodgeSettle', 'lodgeAsk', 'lodgeAsk', 'tripAfterSave']);
  assert.deepEqual(argsOf('tripLodgeMax'), ['157777', 'KR||', 'KRW']);
  const [row, trseq, plan, opts] = argsOf('tripAfterSave');
  assert.deepEqual([row, trseq, opts], [ROW, '157777', { name: '김거화', onStage, always: false }]);
  assert.deepEqual([plan.lodge.length, plan.lodge[0].company, plan.lodge[0].total, plan.lodge[0].samount, plan.lodge[0].vat, plan.lodge[0].maxconv, plan.lodge[0].file], [1, '킨텍스호텔', 110000, 100000, 10000, '120000', FILES['h.png']]);
  assert.deepEqual([r.sent, r.lodgeSeqs, r.confirmed, r.plan, log[0].ok], [true, ['81561'], false, plan, true]);
});
await ta('외화 예약서(원화 금액 없음): 올리지 않고 ask(krw) 를 돌려준다 — 원화 금액을 적은 기록은 상한액을 넘어 cap 을 묻고, 상한액으로 고른 기록이 올라간다(정산금액 120,000·비고에 사유 없음)', async () => {
  const { d, names, argsOf } = make();
  const first = build(d, 'trip.after', AFTER({ records: [withFile(AGODA, 'a.png')] }));
  const r1 = await run(d, first, { row: ROW, detail: DETAIL, files: [FILES['a.png']] });
  assert.deepEqual([r1.sent, r1.ask, r1.plan.lodge[0].actual, names().includes('tripAfterSave')], [false, [{ key: 'a.png', kind: 'krw' }], null, false]);
  const second = build(d, 'trip.after', AFTER({ records: [withFile(AGODA, 'a.png')], lodge: [{ key: 'a.png', settle: 'krw', amount: 125052, reason: null }] }));
  const r2 = await run(d, second, { row: ROW, detail: DETAIL, files: [FILES['a.png']] });
  assert.deepEqual([r2.sent, r2.ask, r2.plan.lodge[0].actual, r2.plan.lodge[0].total], [false, [{ key: 'a.png', kind: 'cap' }], 125052, 125052]);
  const third = build(d, 'trip.after', AFTER({ records: [withFile(AGODA, 'a.png')], lodge: [{ key: 'a.png', settle: 'krw', amount: 125052 }, { key: 'a.png', settle: 'cap', reason: LODGE_OVER_REASON }] }));
  const r3 = await run(d, third, { row: ROW, detail: DETAIL, files: [FILES['a.png']] });
  const [, , plan] = argsOf('tripAfterSave');
  assert.deepEqual([r3.sent, plan.lodge[0].total, plan.lodge[0].capped, plan.lodge[0].samount, plan.lodge[0].vat, plan.lodge[0].settle], [true, 120000, true, 109091, 10909, 'cap']);
  // 차례: 상한액 → 정함 → (cap 인가 — 아직 krw) → 기록의 결정(krw 는 lodgeSettle, cap 은 lodgeDecide — 안에서 제 lodgeSettle 을 부른다) → 남은 물음 없음 → 올림
  assert.deepEqual(names().slice(-7), ['tripLodgeMax', 'lodgeSettle', 'lodgeAsk', 'lodgeSettle', 'lodgeDecide', 'lodgeAsk', 'tripAfterSave']);
});
await ta('실제 금액으로 고르면(actual + 사유) 그 금액 그대로 올라가고 비고에 사유가 붙는다 — 사유가 null 이면 기본 문구다', async () => {
  const { d, argsOf } = make();
  const typed = build(d, 'trip.after', AFTER({ records: [withFile(AGODA, 'a.png')], lodge: [{ key: 'a.png', settle: 'krw', amount: 125052 }, { key: 'a.png', settle: 'actual', reason: '행사 기간이라 인근 숙소가 다 찼음' }] }));
  await run(d, typed, { row: ROW, detail: DETAIL, files: [FILES['a.png']] });
  let [, , plan] = argsOf('tripAfterSave');
  assert.deepEqual([plan.lodge[0].total, plan.lodge[0].settle, plan.lodge[0].reason, plan.notes.some((n) => /부서장 승인 필요/.test(n))], [125052, 'real', '행사 기간이라 인근 숙소가 다 찼음', true]);
  const blankReason = make();
  const r = build(blankReason.d, 'trip.after', AFTER({ records: [withFile(AGODA, 'a.png')], lodge: [{ key: 'a.png', settle: 'krw', amount: 125052 }, { key: 'a.png', settle: 'actual', reason: '   ' }] }));
  assert.equal(r.input.lodge[1].reason, null, '빈 글은 기록에 없는 것이다');
  await run(blankReason.d, r, { row: ROW, detail: DETAIL, files: [FILES['a.png']] });
  [, , plan] = blankReason.argsOf('tripAfterSave');
  assert.deepEqual([plan.lodge[0].total, plan.lodge[0].reason ?? ''], [125052, '']);
});
await ta('이미 올라가 있는 같은 줄이면(lodgeKnown) 상한액을 넘어도 묻지 않고 그 금액으로 정한다 — tripAfterLodges 를 한 번 읽는다', async () => {
  const { d, names, argsOf } = make({ lodges: [{ seq: '81558', del: '0', paydate: '2026-09-08', sday: '1', company: '아고다', total: '120000', maxconv: '120000' }] });
  const record = build(d, 'trip.after', AFTER({ records: [withFile({ ...AGODA, totalKRW: 125052 }, 'a.png')] }));
  const r = await run(d, record, { row: ROW, detail: DETAIL, files: [FILES['a.png']] });
  assert.deepEqual(names(), ['afterPlan', 'tripLodgeMax', 'lodgeSettle', 'lodgeAsk', 'tripAfterLodges', 'lodgeAsk', 'lodgeKnown', 'lodgeDecide', 'lodgeAsk', 'tripAfterSave']);
  assert.deepEqual([argsOf('tripAfterLodges'), r.sent, argsOf('tripAfterSave')[2].lodge[0].total], [['145580', '157777'], true, 120000]);
});
await ta('사전정산이 아직 "작성" 이면: preconfirm 이 참일 때만 tripPreConfirm 부터 하고(출장자 번호는 다시 읽은 줄에서), 거짓이면 던진다', async () => {
  const writing = { ...ROW, pre: '작성', travelers: [{ name: '김거화', post: '', trseq: '' }] };
  const { d, names, argsOf } = make();
  const no = build(d, 'trip.after', AFTER({ trseq: null, records: [withFile(HOTEL, 'h.png')] }));
  await rejects(run(d, no, { row: writing, detail: DETAIL, files: [FILES['h.png']] }), /사전정산이 아직 완료\(확정\)되지 않아/);
  assert.deepEqual(names(), ['afterPlan'], '확정하지 않으면 상한액도 읽지 않는다');
  const yes = build(d, 'trip.after', AFTER({ trseq: null, records: [withFile(HOTEL, 'h.png')], preconfirm: true }));
  const r = await run(d, yes, { row: writing, detail: DETAIL, files: [FILES['h.png']] });
  assert.deepEqual(names().slice(1), ['afterPlan', 'tripPreConfirm', 'tripLodgeMax', 'lodgeSettle', 'lodgeAsk', 'lodgeAsk', 'tripAfterSave']);
  assert.deepEqual([argsOf('tripPreConfirm')[0], argsOf('tripAfterSave')[0].travelers[0].trseq, argsOf('tripAfterSave')[1], r.confirmed], [writing, '157777', '157777', true]);
});
await ta('exclude 의 증빙은 묶지 않고, 바꾼 편만 올릴 때(기록이 비어 있음)는 교통 줄이 간다. keepTrans 면 값을 모르는 편이 있을 때 교통 줄을 비운다', async () => {
  const { d, argsOf } = make();
  const skip = build(d, 'trip.after', AFTER({ records: [withFile(AGODA, 'a.png'), withFile(HOTEL, 'h.png')], exclude: [{ name: 'a.png' }] }));
  await run(d, skip, { row: ROW, detail: DETAIL, files: [FILES['a.png'], FILES['h.png']] });
  assert.deepEqual(argsOf('tripAfterSave')[2].lodge.map((l) => l.company), ['킨텍스호텔']);
  const legs = make();
  const first = build(legs.d, 'trip.after', AFTER({ picks: { goT: null, goG: null, backT: 'train', backG: 'first' } }));
  await run(legs.d, first, { row: ROW, detail: DETAIL, files: [] });
  assert.deepEqual(picksOf(first.input.picks), { back: { t: 'train', g: 'first' } });
  assert.deepEqual(legs.argsOf('tripAfterSave')[2].trans.map((x) => [x.dep, x.arr, x.grade, x.total]), [['부산', '서울', '일반석', 53700], ['서울', '부산', '특실', 78900]]);
  const hold = make();
  const unknown = build(hold.d, 'trip.after', AFTER({ picks: { goT: null, goG: null, backT: 'plane', backG: null }, always: true, keepTrans: true }));
  await run(hold.d, unknown, { row: ROW, detail: DETAIL, files: [] });
  assert.deepEqual([hold.argsOf('tripAfterSave')[2].trans, hold.argsOf('tripAfterSave')[3].always], [[], true], '항공권 없는 비행기 편 — 교통비 내역은 화면 그대로');
  const drop = make();
  const known = build(drop.d, 'trip.after', AFTER({ picks: { goT: null, goG: null, backT: 'plane', backG: null } }));
  await run(drop.d, known, { row: ROW, detail: DETAIL, files: [] });
  assert.deepEqual(drop.argsOf('tripAfterSave')[2].trans.map((x) => x.dep), ['부산'], 'keepTrans 가 아니면 아는 편만 간다');
});
await ta('문제(필수 값 못 읽음)·대상 아님(당일·비행기 없음)이면 던지고, 첨부 바이트가 ctx.files 에 없거나 lodge 의 key 가 묶음에 없으면 ActionError 다', async () => {
  const { d, names } = make();
  const bad = build(d, 'trip.after', AFTER({ records: [withFile({ ...AGODA, total: null }, 'a.png')] }));
  await rejects(run(d, bad, { row: ROW, detail: DETAIL, files: [FILES['a.png']] }), /정산금액을\(를\) 읽지 못했습니다/);
  const day = { ...ROW, to: '2026-09-09' };
  const none = build(d, 'trip.after', AFTER({ records: [withFile(HOTEL, 'h.png')] }));
  await rejects(run(d, none, { row: day, detail: { rows: [], transports: [] }, files: [FILES['h.png']] }), /사후정산 대상이 아닙니다/);
  await rejects(run(d, none, { row: ROW, detail: DETAIL, files: [] }), /h\.png 의 바이트가 ctx\.files 에 없습니다/, ActionError);
  const stray = build(d, 'trip.after', AFTER({ records: [withFile(HOTEL, 'h.png')], lodge: [{ key: 'x.png', settle: 'cap' }] }));
  await rejects(run(d, stray, { row: ROW, detail: DETAIL, files: [FILES['h.png']] }), /숙박 줄 x\.png 이\(가\) 이번 묶음에 없습니다/, ActionError);
  assert.equal(names().includes('tripAfterSave'), false);
});

console.log('trip.send — calPdf → buildPdf(계산서 + 증빙) → 쪽지 또는 Teams. 보내기만 한다');
const SEND = { seq: '145580', docNo: 'TR-1', account: 'RND-2026-01', to: { id: 'hong', name: '홍길동' }, channel: 'memo', reason: '세미나', file: '여비증빙_145580_김거화.pdf' };
const KEPT = [{ name: '점심.png', type: 'image/png', dataUrl: 'data:image/png;base64,CCCC', label: '당일출장 증명' }];
const STAGE = { phase: 'post', done: true, label: '사후정산 완료' };
await ta('쪽지: tripCalPdf(이름) → buildPdf(계산서 출력이 맨 앞, 보관함 증빙 뒤) → memoSend(받는 사람 ID·제목·본문·PDF). 결과는 { ok, channel, to, file, pages }', async () => {
  const { d, names, argsOf, log } = make();
  const record = build(d, 'trip.send', SEND);
  const onStage = () => {};
  const r = await run(d, record, { row: ROW, stage: STAGE, kept: KEPT, onStage });
  assert.deepEqual(names(), ['tripCalPdf', 'buildPdf', 'memoSend']);
  assert.deepEqual(argsOf('tripCalPdf'), [ROW, { name: '김거화', onStage }]);
  const [files, opts] = argsOf('buildPdf');
  assert.deepEqual([files.map((f) => f.name), files[0].bytes, opts], [[calName({ trip: ROW }), '점심.png'], new Uint8Array([1, 2]), { title: '여비계산서 145580 증빙' }]);
  const lines = sendLines({ account: 'RND-2026-01', me: '김거화', trip: ROW, stage: STAGE, reason: '세미나', kept: KEPT, file: SEND.file });
  assert.deepEqual(argsOf('memoSend')[0], { to: ['hong'], title: sendTitle({ account: 'RND-2026-01', me: '김거화', trip: ROW }), lines, file: { name: SEND.file, bytes: new Uint8Array([9]), type: 'application/pdf' }, onStage });
  assert.deepEqual([r, log[0].ok, log[0].data.result.pages], [{ ok: true, channel: 'memo', to: 'hong', file: SEND.file, pages: 3 }, true, 3]);
});
await ta('Teams: teamsSendFile(받는 사람 메일 = ID@회사 도메인, 제목·본문 HTML, PDF) — 쪽지는 부르지 않는다', async () => {
  const { d, names, argsOf } = make();
  const record = build(d, 'trip.send', { ...SEND, channel: 'teams', reason: null });
  const r = await run(d, record, { row: ROW, stage: STAGE, kept: [] });
  assert.deepEqual(names(), ['tripCalPdf', 'buildPdf', 'teamsSendFile']);
  const title = sendTitle({ account: 'RND-2026-01', me: '김거화', trip: ROW });
  const lines = sendLines({ account: 'RND-2026-01', me: '김거화', trip: ROW, stage: STAGE, reason: '', kept: [], file: SEND.file });
  assert.deepEqual(argsOf('teamsSendFile')[0], { email: `hong@${MAIL_DOMAIN}`, html: memoHtml([title, ...lines]), file: { name: SEND.file, bytes: new Uint8Array([9]) } });
  assert.deepEqual([r.channel, r.pages], ['teams', 3]);
});
await ta('계산서를 PDF 로 받지 못하면 보내지 않는다 — 까닭 앞에 그렇게 적고, 로그인 만료(AuthError)는 그 말 그대로 둔다', async () => {
  const { d, names, log } = make({ noCal: 'Error' });
  const record = build(d, 'trip.send', SEND);
  await rejects(run(d, record, { row: ROW, stage: STAGE, kept: KEPT }), /^여비계산서를 PDF 로 받지 못해 보내지 않았습니다 — 리포트를 찾지 못했습니다$/);
  assert.deepEqual([names(), log[0].ok, log[0].data.result.error], [['tripCalPdf'], false, '여비계산서를 PDF 로 받지 못해 보내지 않았습니다 — 리포트를 찾지 못했습니다']);
  const auth = make({ noCal: 'AuthError' });
  const again = build(auth.d, 'trip.send', SEND);
  await rejects(run(auth.d, again, { row: ROW, stage: STAGE, kept: KEPT }), /^리포트를 찾지 못했습니다$/);
});
t('관문: 받는 사람·과제·계정·보내는 길·PDF 이름이 비면 기록을 짓지 못한다', () => {
  const { d } = make();
  assert.throws(() => build(d, 'trip.send', { ...SEND, to: null }), (err) => err instanceof ActionError && /to 가 없습니다/.test(err.message));
  assert.throws(() => build(d, 'trip.send', { ...SEND, channel: 'fax' }), (err) => err instanceof ActionError && /channel 값\(fax\)이 틀렸습니다/.test(err.message));
});

console.log(`\n통과 ${pass}건`);
