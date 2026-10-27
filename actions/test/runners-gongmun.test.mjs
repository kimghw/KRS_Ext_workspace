// 공문 어댑터(actions/runners/gongmun.js) — 기록 → writePlan·writeGongmun 의 인자 변환(갈래는 entry 에서, 입력 칸 그대로, preset.setup → ctx.preset,
// me·project·today) · 첨부 이름 ↔ ctx.files 검사 · ok 판정(안 된 단계가 없을 때) · 공문 갈래는 다섯 종류뿐(공문 설정은 종류마다의 preset.setup) ·
// 얼린 기록으로 진짜 writePlan 이 돌고 화면 상태를 바로 넣던 예전 길과 같은 계획이 나온다 · 구매의뢰(gongmun.order — 구매요청서, 2026-10-17)는 구매 품의에서 넘어온 초안이 그대로 writePlan('order') 에 간다.
//
// 명세는 생성물(actions/spec.js)의 진짜 gongmun.* 를 쓴다 — 칸 이름·사전설정 키가 어긋나면 여기서 드러난다.
import assert from 'node:assert/strict';

import { ACTIONS } from '../spec.js';
import { createDispatcher } from '../dispatch.js';
import { ActionError } from '../gate.js';
import { registerGongmun, writeOk, formProblem } from '../runners/gongmun.js';
import { writePlan, blankDraft } from '../../src/gongmun.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const rejects = async (p, re) => {
  try { await p; } catch (err) {
    assert.ok(err instanceof ActionError, `ActionError 여야 한다: ${err}`);
    assert.match(err.message, re);
    return err;
  }
  return assert.fail('던져야 한다');
};

const NOW = 1760600000000;
const SETUP = { dept: '연구본부 수소전기추진연구팀', head: '노길태', director: '', chief: '', docNo: '' };
const PROJECT = { name: 'MVDC 차단기 개발', alias: '차단기 과제', code: 'RND-20-2026', lead: '박기도', period: '2026.04.01 ~ 2029.12.31', about: '', content: '긴 연구 내용', account: '', refs: { 구매: ['홍길동'] } };
const PRESET = { me: '김거화', today: '2026-10-16', setup: SETUP, project: PROJECT, kindTitle: '구매품의' };
// 패널의 화면 상태 그대로 — 제목에 공백이 붙고, 전결권자는 빈 글, 문서설정은 바꾼 칸만, 초안은 blankDraft 위에 읽은 값.
const INPUT = {
  form: 'KR_EA_Research_Task', title: ' 연구 데이터 저장용 모니터 구매 품의 ', body: '본문 글',
  draft: { ...blankDraft('purchase', { me: '김거화' }), gist: '모니터', vendor: '업체', total: 1200000, items: [{ name: '모니터', qty: 2, unitPrice: 600000, amount: 1200000 }], attach: [{ label: '견적서', files: ['견적서.png'] }] },
  rank: '', setting: { retention: '36', docNo: '8100' }, attach: [{ name: '견적서_업체_2026-10-16.pdf', kind: '견적서' }, { name: '원본.hwp', kind: 'original' }],
};
const FILES = [
  { name: '견적서_업체_2026-10-16.pdf', type: 'application/pdf', base64: 'AAAA' },
  { name: '원본.hwp', type: 'application/octet-stream', base64: 'BBBB' },
];
const RESULT = { tabId: 77, docId: 'HER-2026-000700', steps: [{ key: 'open', label: '새 공문 창', ok: true, detail: '' }, { key: 'attach', label: '첨부', ok: 'skip', detail: '' }] };
const OUT_PRESET = { me: '김거화', today: '2026-10-16', setup: SETUP, kindTitle: '외부강의등 신고서' };
const OUT_INPUT = {
  form: 'KR_Outside_Lecture_Report', title: '외부강의등 신고서', body: '■ 신 고 자 : 김거화 (미리보기)',
  draft: {
    ...blankDraft('outside', { me: '김거화' }),
    org: '더브릿지전략컨설팅', representative: '정민의', subject: 'MVDC 차단기 기술 특강', place: '부산대학교 공학관',
    from: '2026-11-05', to: '2026-11-05', start: '14:00', end: '16:00', hours: 2, fee: 300000, rank: '책임연구원', monthCount: 1, yearTotal: 500000,
  },
  rank: '', setting: {}, attach: [],
};
// 구매의뢰(구매요청서 KR_Purchase_Order — 총무팀 수신) — 구매 품의에서 넘어온 초안의 꼴(src/gongmun.js orderFromPurchase: 품목·합계·구매처·첨부는 구매 초안의 것, 구매사유는 사업내용으로,
// 선행 품의 문서번호·제목은 공문 이력의 줄). 계정과목코드·I/O 코드·예산금액은 이 확장이 모르는 칸이라 빈 채로 둔다. 본문 칸은 양식에 없어(when: form!=KR_Purchase_Order) 입력에 두지 않는다.
const ORDER_PRESET = { me: '김거화', today: '2026-10-16', setup: SETUP, project: PROJECT, kindTitle: '구매요청서' };
const ORDER_INPUT = {
  form: 'KR_Purchase_Order', title: '모니터 구매 요청',
  draft: {
    ...blankDraft('order', { me: '김거화' }),
    gist: '모니터', vendor: '업체', total: 1200000, targetType: 'PC류', budgetType: '국가수탁과제',
    business: 'MVDC 차단기 개발 과제의 단락 시험 데이터를 저장·분석할 모니터가 필요함', demandDate: '2026-10-30', place: '한국선급 본부 3층 수소전기추진연구팀',
    feature: '연구업무추진품의 HER-2026-000097 승인에 따른 구매 요청', sourceDoc: 'HER-2026-000097', sourceTitle: '모니터 구매 품의', attachNote: '1. 견적서 1부.',
    items: [{ name: '모니터', qty: 2, unitPrice: 600000, amount: 1200000 }], quoteDate: '2026-10-01', attach: [{ label: '견적서', files: ['견적서.png'] }],
  },
  rank: '', setting: { retention: '36', receiver: '총무팀' }, attach: [{ name: '견적서_업체_2026-10-16.pdf', kind: '견적서' }],
};

/** 가짜 writePlan·writeGongmun 을 끼운 디스패처 — 무엇을 받았는지(calls)와 로그 한 줄을 본다. spec 을 주면 그 명세로. */
function make({ result = RESULT, plan = { fake: 'plan' }, spec = ACTIONS } = {}) {
  const calls = { plan: [], write: [] };
  const log = [];
  const d = createDispatcher({ spec, log: (e) => log.push(e), now: () => NOW });
  registerGongmun(d, {
    writePlan: (kind, input, ctx) => { calls.plan.push({ kind, input, ctx }); return plan; },
    writeGongmun: async (p, opts) => { calls.write.push({ plan: p, opts }); return result; },
  });
  return { d, calls, log };
}

console.log('등록');
t('gongmun.write 를 등록한다 — 같은 디스패처에 두 번은 throw. 공문 갈래는 다섯 종류뿐(구매의뢰 order 는 출장과 외부활동 사이 — 레시피 RECIPE.order 의 차례)이고 모두 gongmun.write 로 돈다', () => {
  const { d } = make();
  assert.throws(() => registerGongmun(d), /gongmun\.prior 는 이미 등록/, '둘(prior·write)을 등록하고 prior 가 먼저다');
  const ids = ['gongmun.purchase', 'gongmun.edu', 'gongmun.trip', 'gongmun.allowance', 'gongmun.consult', 'gongmun.order', 'gongmun.outside'];
  // 선행 품의 읽기(prior — 조회, 2026-10-17 "이것도 명세서를 만든 다음에 러너로")는 레시피의 목적이 아니라 목적들 뒤에 서고 실행기가 다르다(gongmun.prior).
  assert.deepEqual(ACTIONS.domains.gongmun.kinds, ['purchase', 'edu', 'trip', 'allowance', 'consult', 'order', 'outside', 'prior']);
  assert.deepEqual(Object.keys(ACTIONS.actions).filter((id) => id.startsWith('gongmun.')), [...ids, 'gongmun.prior']);
  for (const id of ids) assert.equal(ACTIONS.actions[id].runner, 'gongmun.write', id);
  assert.deepEqual([ACTIONS.actions['gongmun.prior'].runner, ACTIONS.actions['gongmun.prior'].confirm, ACTIONS.actions['gongmun.prior'].llm], ['gongmun.prior', false, false]);
});
t('공문 설정은 따로 된 행위가 아니라 종류마다의 사전설정 setup 이다(저장소 gongmunPreset, 없으면 관문이 막는다 — 채우던 채팅 칸은 2026-10-09 에 뺐다)', () => {
  for (const id of ['gongmun.purchase', 'gongmun.edu', 'gongmun.trip', 'gongmun.allowance', 'gongmun.consult', 'gongmun.order', 'gongmun.outside']) {
    const { from, type, required } = ACTIONS.actions[id].preset.setup;
    assert.deepEqual({ from, type, required }, { from: 'storage:gongmunPreset', type: 'object', required: true }, id);
  }
});

console.log('기록 짓기');
t('build — 기록에 kind 는 없다(행위 ID 에 든다). 제목은 다듬어지고 빈 전결권자는 null, 문서설정은 아는 칸만, 첨부는 이름·종류', () => {
  const { d } = make();
  const { record, notes } = d.build('gongmun.purchase', { input: INPUT, preset: PRESET });
  assert.deepEqual(notes, []);
  assert.equal(record.action, 'gongmun.purchase');
  assert.ok(!('kind' in record.input) && !('kind' in record));
  assert.deepEqual(Object.keys(record.input).sort(), ['attach', 'body', 'draft', 'form', 'lead', 'rank', 'refs', 'setting', 'title']);
  assert.deepEqual([record.input.title, record.input.rank, record.input.form], ['연구 데이터 저장용 모니터 구매 품의', null, 'KR_EA_Research_Task']);
  assert.deepEqual([record.input.lead, record.input.refs], [null, null], '합의자·참조자를 주지 않으면 null — writePlan 이 고른 과제의 것을 쓴다');
  assert.deepEqual(record.input.setting, { retention: '36', docNo: '8100', receiver: null, scope: null, emergency: null, approvingOpen: null, drm: null, tag: null });
  assert.deepEqual(record.input.attach, INPUT.attach);
  assert.deepEqual([record.input.draft.gist, record.input.draft.total, record.input.draft.items, record.input.draft.attach, record.input.draft.currency],
    ['모니터', 1200000, [{ name: '모니터', spec: null, qty: 2, unit: null, unitPrice: 600000, amount: 1200000 }], [{ label: '견적서', files: ['견적서.png'] }], 'KRW']);
  assert.deepEqual(record.preset, PRESET, '사전설정은 깊은 복사 — 과제 내용도 든다(로그에서만 뺀다)');
  assert.match(record.hash, /^[0-9a-f]{8}$/);
});
t('build — 관문이 막는 것: 전결권자가 직책 밖 · 제목 99자 넘침 · 첨부 6개 · 내 이름 없음 · 공문 설정 없음 · 과제 키 자체가 없음', () => {
  const { d } = make();
  const problems = (input, preset = PRESET) => { try { d.build('gongmun.purchase', { input, preset }); } catch (e) { return e.problems; } return []; };
  assert.deepEqual(problems({ ...INPUT, rank: '사장' }), ['rank 값(사장)이 틀렸습니다']);
  assert.deepEqual(problems({ ...INPUT, title: 'x'.repeat(120) }), ['title 가 99자를 넘습니다(120자)']);
  assert.deepEqual(problems({ ...INPUT, attach: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `f${i}.pdf` })) }), ['attach 가 5줄을 넘습니다(6줄)']);
  assert.deepEqual(problems(INPUT, { ...PRESET, me: '' }), ['me 가 없습니다']);
  assert.deepEqual(problems(INPUT, { ...PRESET, setup: null }), ['setup 가 없습니다']);
  assert.deepEqual(problems(INPUT, { me: '김거화', today: '2026-10-16', setup: SETUP, kindTitle: '구매품의' }), ['사전설정 project 가 채워지지 않았습니다']);
  assert.deepEqual(problems(INPUT, { ...PRESET, project: null }), [], '과제를 고르지 않은 것은 null 로 지나간다');
});

console.log('돌리기 — 인자 변환');
await ta('gongmun.write — writePlan 은 (entry.kind, 입력 여덟 칸, { me, preset: setup, project, today }), writeGongmun 은 (계획, { files, onStep, onTab, dry }). 결과는 그대로', async () => {
  const plan = { planned: true };
  const { d, calls, log } = make({ plan });
  const { record } = d.build('gongmun.purchase', { input: INPUT, preset: PRESET });
  const onStep = () => {};
  const onTab = () => {};
  const res = await d.run(record, { confirmed: record.hash, files: FILES, onStep, onTab, dry: true });
  assert.equal(res, RESULT, '실행기 결과를 그대로 돌려준다');
  assert.equal(calls.plan.length, 1);
  assert.equal(calls.plan[0].kind, 'purchase', '갈래는 기록이 아니라 명세(entry.kind)에서');
  assert.deepEqual(Object.keys(calls.plan[0].input).sort(), ['body', 'draft', 'form', 'lead', 'rank', 'refs', 'setting', 'title'], 'attach 는 writePlan 에 가지 않는다');
  assert.deepEqual(calls.plan[0].input, {
    title: record.input.title, body: record.input.body, draft: record.input.draft, form: record.input.form, setting: record.input.setting, rank: null, lead: null, refs: null,
  });
  assert.deepEqual(calls.plan[0].ctx, { me: '김거화', preset: SETUP, project: PROJECT, today: '2026-10-16' }, 'ctx.preset 자리에 공문 설정(setup)');
  assert.equal(calls.write.length, 1);
  assert.equal(calls.write[0].plan, plan);
  assert.deepEqual(calls.write[0].opts, { files: FILES, onStep, onTab, dry: true, signal: null }, 'signal 은 작성 취소(ctx.signal — 없으면 null)');
  assert.equal(calls.write[0].opts.files, FILES, '바이트는 ctx.files 그대로');
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].kind, log[0].ok, log[0].text], ['gongmun', true, '구매품의 · 연구 데이터 저장용 모니터 구매 품의']);
  assert.deepEqual(log[0].data.result, { docId: 'HER-2026-000700', tabId: 77 }, '단계 목록은 로그에 안 남는다');
  assert.ok(!('project' in log[0].data.record.preset), '과제(log:false)는 로그에서 뺀다');
  assert.deepEqual(log[0].data.record.input.attach, INPUT.attach);
});
await ta('gongmun.outside — 갈래는 outside, 과제 사전설정이 없어 writePlan 의 ctx.project 는 비어 있다. ctx 에 onStep·onTab·dry 가 없으면 undefined 로 넘긴다', async () => {
  const { d, calls } = make();
  const { record } = d.build('gongmun.outside', { input: OUT_INPUT, preset: OUT_PRESET });
  assert.ok(!('project' in record.preset));
  await d.run(record, { confirmed: record.hash });
  assert.equal(calls.plan[0].kind, 'outside');
  assert.deepEqual(calls.plan[0].ctx, { me: '김거화', preset: SETUP, project: undefined, today: '2026-10-16' });
  assert.deepEqual(calls.plan[0].input.draft.start, '14:00');
  assert.deepEqual(calls.write[0].opts, { files: [], onStep: undefined, onTab: undefined, dry: undefined, signal: null });
});
await ta('gongmun.order — 갈래는 order(구매요청서). 구매 품의에서 넘어온 초안(품목·합계·사업내용·선행 품의 문서번호)이 그대로 writePlan 에 가고, 모르는 칸은 빈 채로, 본문 칸은 없다(when: form!=KR_Purchase_Order)', async () => {
  const { d, calls, log } = make();
  const { record, notes } = d.build('gongmun.order', { input: ORDER_INPUT, preset: ORDER_PRESET });
  assert.deepEqual(notes, []);
  assert.equal(record.action, 'gongmun.order');
  assert.ok(!('body' in record.input), '구매요청서 기록에는 body 가 없다(공문 탭의 본문은 넣을 칸의 미리보기)');
  assert.deepEqual(Object.keys(record.input).sort(), ['attach', 'draft', 'form', 'lead', 'rank', 'refs', 'setting', 'title']);
  assert.equal(record.input.setting.receiver, '총무팀', '수신처 총무팀은 문서설정 enum 에 있다(레시피 settings options.receiver — 프로파일 구매요청의 수신처)');
  await d.run(record, { confirmed: record.hash, files: [FILES[0]] });
  assert.equal(calls.plan.length, 1);
  assert.equal(calls.plan[0].kind, 'order', '갈래는 명세(entry.kind)에서 — 기록에 kind 는 없다');
  assert.deepEqual(Object.keys(calls.plan[0].input).sort(), ['body', 'draft', 'form', 'lead', 'rank', 'refs', 'setting', 'title']);
  const { form, title, body, draft, setting, rank, lead, refs } = calls.plan[0].input;
  assert.deepEqual([form, title, body, rank, lead, refs], ['KR_Purchase_Order', '모니터 구매 요청', undefined, null, null, null], '본문은 기록에 없어 undefined 로 간다(작성기가 쓰지 않는다)');
  assert.deepEqual(
    [draft.gist, draft.vendor, draft.total, draft.targetType, draft.budgetType, draft.business, draft.demandDate, draft.place, draft.feature, draft.sourceDoc, draft.sourceTitle, draft.attachNote, draft.quoteDate, draft.currency],
    ['모니터', '업체', 1200000, 'PC류', '국가수탁과제', ORDER_INPUT.draft.business, '2026-10-30', ORDER_INPUT.draft.place, ORDER_INPUT.draft.feature, 'HER-2026-000097', '모니터 구매 품의', '1. 견적서 1부.', '2026-10-01', 'KRW'],
  );
  assert.deepEqual(draft.items, [{ name: '모니터', spec: null, qty: 2, unit: null, unitPrice: 600000, amount: 1200000 }], '품목 줄은 구매 초안과 같은 꼴');
  assert.deepEqual([draft.subjectCode, draft.subjectName, draft.ioCode, draft.ioName, draft.budgetAmount], [null, null, null, null, null], '계정과목코드·I/O·예산금액은 이 확장이 모른다 — 빈 채로 가고 사람이 적는다');
  assert.deepEqual(draft.attach, [{ label: '견적서', files: ['견적서.png'] }]);
  assert.deepEqual(setting, { retention: '36', docNo: null, receiver: '총무팀', scope: null, emergency: null, approvingOpen: null, drm: null, tag: null });
  assert.deepEqual(calls.plan[0].ctx, { me: '김거화', preset: SETUP, project: PROJECT, today: '2026-10-16' }, '과제를 고르는 갈래 — ctx.project 가 든다');
  assert.equal(calls.write.length, 1);
  assert.deepEqual([log[0].kind, log[0].ok, log[0].text], ['gongmun', true, '구매요청서 · 모니터 구매 요청'], '활동 로그 kind 는 gongmun 그대로');
  // 양식을 본문 편집기가 있는 것(연구업무추진품의·기안문)으로 바꾸면 본문이 꼭 있어야 한다 — 신고서와 같은 규칙. 구매요청서는 이 갈래에서만 고른다(only).
  assert.throws(() => d.build('gongmun.order', { input: { ...ORDER_INPUT, form: 'KR_EA_Research_Task' }, preset: ORDER_PRESET }), /body 가 없습니다/);
  assert.equal(d.build('gongmun.order', { input: { ...ORDER_INPUT, form: 'KR_EA_Research_Task', body: '본문 글' }, preset: ORDER_PRESET }).record.input.body, '본문 글');
  assert.equal(formProblem('KR_Purchase_Order', 'order'), '');
  assert.match(formProblem('KR_Purchase_Order', 'edu'), /양식 KR_Purchase_Order 은 order 에서만 고를 수 있습니다\(edu 에서는 안 됩니다\)/);
});

console.log('양식 ID — 닫힌 목록이 아니다(공문 탭의 "양식 ID 직접 적기"는 칸 지도가 없는 양식을 창만 연다, 2026-10-17 Codex 검토)');
await ta('목록에 없는 양식 ID 는 관문과 어댑터를 지나 writePlan 에 그대로 간다 · 꼴이 틀린 ID · 다른 갈래 전용 폼(only)은 어댑터가 막는다', async () => {
  const { d, calls } = make();
  // 레시피에 없는 양식 ID(칸 지도가 없다 — 창만 연다). 구매요청서 KR_Purchase_Order 는 2026-10-17 부터 레시피에 있고 only: [order] 라 여기서는 못 쓴다(아래).
  const { record } = d.build('gongmun.purchase', { input: { ...INPUT, form: 'KR_Something' }, preset: PRESET });
  assert.equal(record.input.form, 'KR_Something');
  await d.run(record, { confirmed: record.hash, files: FILES });
  assert.equal(calls.plan[0].input.form, 'KR_Something');
  const bad = d.build('gongmun.purchase', { input: { ...INPUT, form: 'KR Purchase; Order' }, preset: PRESET }).record;
  await rejects(d.run(bad, { confirmed: bad.hash, files: FILES }), /양식 ID\(KR Purchase; Order\)는 영문·숫자·_ 로만/);
  const only = d.build('gongmun.purchase', { input: { ...INPUT, form: 'KR_Outside_Lecture_Report' }, preset: PRESET }).record;
  await rejects(d.run(only, { confirmed: only.hash, files: FILES }), /양식 KR_Outside_Lecture_Report 은 outside 에서만 고를 수 있습니다\(purchase 에서는 안 됩니다\)/);
  const order = d.build('gongmun.purchase', { input: { ...INPUT, form: 'KR_Purchase_Order' }, preset: PRESET }).record;
  await rejects(d.run(order, { confirmed: order.hash, files: FILES }), /양식 KR_Purchase_Order 은 order 에서만 고를 수 있습니다\(purchase 에서는 안 됩니다\)/);
  assert.equal(formProblem('KR_EA_Form2', 'outside'), '', 'only 가 없는 폼은 어느 갈래든 된다');
  assert.equal(formProblem('KR_Outside_Lecture_Report', 'outside'), '');
  assert.match(formProblem('', 'purchase'), /영문·숫자·_/);
});
t('외부강의등 신고서에는 본문 칸이 없다(when: form!=KR_Outside_Lecture_Report) — 편집기 양식으로 바꾸면 본문이 꼭 있어야 한다', () => {
  const { d } = make();
  const { record } = d.build('gongmun.outside', { input: OUT_INPUT, preset: OUT_PRESET });
  assert.ok(!('body' in record.input), '신고서 기록에는 body 가 없다(미리보기 글은 기록이 아니다)');
  const editor = d.build('gongmun.outside', { input: { ...OUT_INPUT, form: 'KR_EA_Research_Task', body: '본문 글' }, preset: OUT_PRESET }).record;
  assert.equal(editor.input.body, '본문 글');
  assert.throws(() => d.build('gongmun.outside', { input: { ...OUT_INPUT, form: 'KR_EA_Research_Task', body: '' }, preset: OUT_PRESET }), /body 가 없습니다/);
});

console.log('성패와 첨부 검사');
t('writeOk — 단계에 ok:false 가 없으면 됐다(skip·하는 중 null 은 안 된 것이 아니다)', () => {
  assert.equal(writeOk({ steps: [{ ok: true }, { ok: 'skip' }, { ok: null }] }), true);
  assert.equal(writeOk({ steps: [] }), true);
  assert.equal(writeOk({ steps: [{ ok: true }, { ok: false }] }), false);
});
await ta('안 된 단계가 있으면 로그는 ✕ 지만 결과는 그대로 돌아온다(제출 뒤 결과 불명은 실패가 아니다 — 패널이 단계마다 보인다)', async () => {
  const result = { tabId: 77, docId: '', steps: [{ key: 'open', label: '새 공문 창', ok: true, detail: '' }, { key: 'line', label: '결재선(위임전결)', ok: false, detail: '사람을 못 찾음' }] };
  const { d, log } = make({ result });
  const { record } = d.build('gongmun.purchase', { input: INPUT, preset: PRESET });
  assert.equal(await d.run(record, { confirmed: record.hash, files: FILES }), result);
  assert.deepEqual([log[0].ok, log[0].data.result], [false, { docId: '', tabId: 77 }]);
});
await ta('outcome 이 최종 문구를 정한다 — 패널이 문서 ID·첨부 수·안 된 단계를 붙인다', async () => {
  const { d, log } = make();
  const { record } = d.build('gongmun.purchase', { input: INPUT, preset: PRESET });
  await d.run(record, { confirmed: record.hash, files: FILES, text: '공문 작성 · 구매품의 · 제목', outcome: async (r) => ({ text: `공문 작성 · 구매품의 · 제목 · ${r.docId} · 첨부 2개` }) });
  assert.deepEqual([log[0].ok, log[0].text], [true, '공문 작성 · 구매품의 · 제목 · HER-2026-000700 · 첨부 2개']);
});
await ta('첨부 이름이 ctx.files 에 없으면 ActionError — writeGongmun 은 불리지 않고 로그는 ✕ 에 까닭', async () => {
  const { d, calls, log } = make();
  const { record } = d.build('gongmun.purchase', { input: INPUT, preset: PRESET });
  await rejects(d.run(record, { confirmed: record.hash, files: [FILES[0]] }), /첨부 원본\.hwp 의 파일이 ctx\.files 에 없습니다/);
  await rejects(d.run(record, { confirmed: record.hash }), /첨부 견적서_업체_2026-10-16\.pdf · 원본\.hwp 의 파일이 ctx\.files 에 없습니다/);
  assert.deepEqual([calls.plan.length, calls.write.length], [0, 0]);
  assert.equal(log.length, 2);
  assert.deepEqual([log[0].ok, log[0].data.result.ok], [false, false]);
  assert.match(log[0].data.result.error, /ctx\.files 에 없습니다/);
  // 기록의 첨부가 비면 ctx.files 가 무엇이든 지나간다(파일이 더 있는 것은 막지 않는다).
  const { record: none } = d.build('gongmun.purchase', { input: { ...INPUT, attach: [] }, preset: PRESET });
  await d.run(none, { confirmed: none.hash, files: FILES });
  assert.equal(calls.write.length, 1);
});
await ta('확인(confirmed: record.hash) 없이는 안 돈다 — 공문 작성 단추가 확인이다', async () => {
  const { d, calls } = make();
  const { record } = d.build('gongmun.purchase', { input: INPUT, preset: PRESET });
  await rejects(d.run(record, { files: FILES }), /확인 없이 실행할 수 없습니다/);
  await rejects(d.run({ ...record, input: { ...record.input, title: '바꾼 제목' } }, { confirmed: record.hash, files: FILES }), /지은 뒤에 바뀌었습니다/);
  assert.equal(calls.write.length, 0);
});

console.log('진짜 writePlan');
await ta('얼린 기록으로 진짜 writePlan 이 돌고, 화면 상태를 바로 넣던 예전 길(writePlan 직접)과 같은 계획이 나온다 — 구매·외부활동·구매의뢰', async () => {
  for (const [id, input, preset, kind] of [['gongmun.purchase', INPUT, PRESET, 'purchase'], ['gongmun.outside', OUT_INPUT, OUT_PRESET, 'outside'], ['gongmun.order', ORDER_INPUT, ORDER_PRESET, 'order']]) {
    const calls = [];
    const d = createDispatcher({ spec: ACTIONS, now: () => NOW });
    registerGongmun(d, { writeGongmun: async (plan) => { calls.push(plan); return RESULT; } });
    const { record } = d.build(id, { input, preset });
    await d.run(record, { confirmed: record.hash, files: FILES });
    // 본문은 기록의 것 — 신고서(외부활동)에는 본문 칸이 없어(when) 기록에 없고 writePlan 에는 빈 글로 간다(예전 길은 미리보기 글을 넘겼지만 작성기가 쓰지 않았다).
    const { title, draft, form, setting, rank } = input;
    const old = writePlan(kind, { title, body: record.input.body ?? '', draft, form, setting, rank }, { me: preset.me, preset: preset.setup, project: preset.project || null, today: preset.today });
    assert.deepEqual(calls[0], old, id);
    assert.equal(calls[0].kind, kind);
  }
  // 구매 — 문서번호는 이 공문의 8100, 결재선은 과제책임자 합의 뒤 부서장 결재(120만 원은 팀장 전결)
  const d = createDispatcher({ spec: ACTIONS, now: () => NOW });
  const plans = [];
  registerGongmun(d, { writeGongmun: async (plan) => { plans.push(plan); return RESULT; } });
  const { record } = d.build('gongmun.purchase', { input: INPUT, preset: PRESET });
  await d.run(record, { confirmed: record.hash, files: FILES });
  assert.deepEqual([plans[0].values.title, plans[0].setting.docNo, plans[0].setting.retention, plans[0].line.agree, plans[0].line.approvers, plans[0].line.rank],
    ['연구 데이터 저장용 모니터 구매 품의', '8100', '36', ['박기도'], ['노길태'], '팀장']);
  assert.deepEqual(plans[0].line.refs, ['홍길동'], '기록에 참조자가 없으면 과제의 것(계획서 YAML 의 공문.참조자.구매)');
  // 구매의뢰(구매요청서) — 표(rows: 구매 물품은 품목 줄마다 한 행, 예산 내역은 계정과목·I/O·예산금액이 비어 행 없음), 문서설정은 프로파일 구매요청(보존 3년 · 수신 총무팀 — 레시피 settings
  // receivers 의 코드가 receiverValue 로 SetReceiverValue 에 간다), 결재선은 구매와 같은 연구비집행 준용(120만 원은 팀장 전결, 과제책임자 합의). 2026-10-17.
  const od = createDispatcher({ spec: ACTIONS, now: () => NOW });
  const oplans = [];
  registerGongmun(od, { writeGongmun: async (plan) => { oplans.push(plan); return RESULT; } });
  const { record: orec } = od.build('gongmun.order', { input: ORDER_INPUT, preset: ORDER_PRESET });
  await od.run(orec, { confirmed: orec.hash, files: FILES });
  const [op] = oplans;
  assert.deepEqual([op.kind, op.form, op.values.title], ['order', 'KR_Purchase_Order', '모니터 구매 요청']);
  assert.deepEqual([op.setting.profile, op.setting.retention, op.setting.receiver, op.setting.receiverValue], ['구매요청', '36', '총무팀', '10820-,-(A13) General Affairs Team']);
  assert.deepEqual([op.line.agree, op.line.approvers, op.line.rank], [['박기도'], ['노길태'], '팀장']);
  assert.deepEqual(op.rows.map((r) => [r.key, r.rows]), [['items', [{ txtItemName: '모니터', txtCnt: '2', txtUnitCost: '600000', txtEstimate: '1200000' }]], ['budget', []]], '표 두 개 — 빈 셀은 빠지고 셀이 모두 빈 행은 없다');
});
await ta('기록의 과제 책임자·참조자(문서설정의 두 칸 — 과제마다)가 과제의 것을 이긴다 — 책임자가 기안자 본인이면 합의는 빠지고, 빈 참조자 목록은 참조 없음(2026-10-16)', async () => {
  const d = createDispatcher({ spec: ACTIONS, now: () => NOW });
  const plans = [];
  registerGongmun(d, { writeGongmun: async (plan) => { plans.push(plan); return RESULT; } });
  const run = async (line) => {
    const { record } = d.build('gongmun.purchase', { input: { ...INPUT, ...line }, preset: PRESET });
    await d.run(record, { confirmed: record.hash, files: FILES });
    return [plans.at(-1).line.agree, plans.at(-1).line.refs, record.input.lead, record.input.refs];
  };
  assert.deepEqual(await run({ lead: '성춘향', refs: ['이몽룡', ' 이몽룡 ', '변학도'] }), [['성춘향'], ['이몽룡', '변학도'], '성춘향', ['이몽룡', '변학도']]);
  assert.deepEqual(await run({ lead: '김거화', refs: [] }), [[], [], '김거화', []], '본인이 책임자면 합의 없음 · 빈 목록은 참조 없음');
  assert.deepEqual((await run({ lead: '', refs: null })).slice(0, 2), [['박기도'], ['홍길동']], '빈 책임자·참조자는 과제의 것');
  const { record } = d.build('gongmun.outside', { input: OUT_INPUT, preset: OUT_PRESET });
  assert.ok(!('lead' in record.input) && !('refs' in record.input), '외부활동(과제를 고르지 않음)에는 두 칸이 없다');
});

console.log('선행 품의 읽기(gongmun.prior — 공문 이력 카드의 구매의뢰, 2026-10-17 "이것도 명세서를 만든 다음에 러너로 실행하도록")');
const PRIOR_DOC = {
  title: '차단기 과제 수행을 위한 시험 장비 구매 품의', job: 'RND00202026', degree: '1', receive: '', reference: '', lines: [], text: '본문 글',
  items: [{ name: '모니터', spec: 'WQHD', qty: 2, unit: '대', unitPrice: 600000, amount: 1200000, currency: 'KRW', use: '', reason: '', account: '', period: '', note: '' }],
  total: 1200000, currency: 'KRW', vendor: '쿠팡', account: '연구활동비(연구실운용비)', use: '자료 검토', reason: '대화면이 필요함', period: '', overview: '', summary: '모니터를 구매하고자', attach: ['견적서'],
};
const PRIOR_PRESET = { me: '김거화', today: '2026-10-17', setup: SETUP };
await ta('조회라 확인 없이 돈다 — 기록의 문서번호·양식(기본 연구업무추진품의)·제목으로 readPrior 를 부르고, 구매의뢰 초안(품목·합계·구매처·사업내용·선행 품의 칸·계정과목명은 그 품의의 구매계정)·과제(ctx.projects 의 Job Id)·첨부·알림을 돌려준다. 바이트는 로그에 들지 않는다', async () => {
  const log = [];
  const asked = [];
  const d = createDispatcher({ spec: ACTIONS, log: (e) => log.push(e), now: () => NOW });
  registerGongmun(d, { readPrior: async (row) => { asked.push(row); return { doc: PRIOR_DOC, files: [{ name: '견적서_2.pdf', type: 'application/pdf', size: 4, bytes: new Uint8Array([1, 2, 3, 4]) }], notes: ['사양서.pdf 을(를) 내려받지 못했습니다 — HTTP 500'] }; } });
  const { record } = d.build('gongmun.prior', { input: { id: 'HER-2026-000128', title: PRIOR_DOC.title }, preset: PRIOR_PRESET });
  assert.ok(!record.input.form, '양식을 안 적으면 기록에도 없다(명세의 default 는 폼 기본값) — 실행기가 연구업무추진품의로 본다');
  const res = await d.run(record, { projects: [{ name: 'MVDC 차단기 개발', job: 'RND00202026', alias: 'SSCB', code: 'RND-20-2026' }, { name: '다른 과제', job: '', alias: '', code: '' }], text: '선행 품의 읽기 · HER-2026-000128' });
  assert.deepEqual(asked, [{ id: 'HER-2026-000128', form: 'KR_EA_Research_Task', title: PRIOR_DOC.title }]);
  assert.equal(res.ok, true);
  assert.deepEqual([res.draft.gist, res.draft.vendor, res.draft.total, res.draft.sourceDoc, res.draft.sourceTitle, res.draft.subjectName, res.draft.business],
    ['모니터', '쿠팡', 1200000, 'HER-2026-000128', PRIOR_DOC.title, '연구활동비(연구실운용비)', '대화면이 필요함 (용도: 자료 검토)']);
  assert.deepEqual(res.draft.items, [{ name: '모니터', spec: 'WQHD', qty: 2, unit: '대', unitPrice: 600000, amount: 1200000 }]);
  assert.deepEqual(new Set(Object.keys(res.draft)), new Set(Object.keys(blankDraft('order', { me: '김거화' }))), '초안의 키는 구매의뢰 초안의 것뿐');
  assert.equal(res.project, 'MVDC 차단기 개발');
  assert.deepEqual(res.files.map((f) => [f.name, f.type, f.size]), [['견적서_2.pdf', 'application/pdf', 4]]);
  assert.deepEqual(res.notes, ['사양서.pdf 을(를) 내려받지 못했습니다 — HTTP 500']);
  assert.deepEqual(res.doc, { title: PRIOR_DOC.title, job: 'RND00202026', items: 1, total: 1200000, currency: 'KRW', summary: '모니터를 구매하고자', text: '본문 글' });
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].kind, log[0].ok, log[0].text], ['gongmun', true, '선행 품의 읽기 · HER-2026-000128']);
  assert.ok(!('files' in log[0].data.result) && !('draft' in log[0].data.result), '로그에는 수·글만(바이트·초안은 아니다)');
  assert.equal(log[0].data.record.action, 'gongmun.prior');
});
await ta('원화가 아니면(구독 품의의 USD) 고치라는 알림이 앞에 서고, 과제를 못 고르면 빈 글, readPrior 가 던지면 ✕ 한 줄과 함께 다시 던진다', async () => {
  const log = [];
  const d = createDispatcher({ spec: ACTIONS, log: (e) => log.push(e), now: () => NOW });
  registerGongmun(d, { readPrior: async () => ({ doc: { ...PRIOR_DOC, currency: 'USD', total: 1320, job: 'RND00999999', title: '무관한 제목' }, files: [], notes: [] }) });
  const { record } = d.build('gongmun.prior', { input: { id: 'HER-2026-000097' }, preset: PRIOR_PRESET });
  const res = await d.run(record, { projects: [{ name: 'MVDC 차단기 개발', job: 'RND00202026', alias: 'SSCB' }] });
  assert.deepEqual(res.notes, ['선행 품의의 금액이 USD 입니다 — 합계와 품목 금액을 원화로 고쳐 주세요']);
  assert.deepEqual([res.project, res.draft.currency, res.draft.sourceTitle], ['', 'USD', '무관한 제목'], '제목을 안 적으면 읽은 제목');
  const d2 = createDispatcher({ spec: ACTIONS, log: (e) => log.push(e), now: () => NOW });
  registerGongmun(d2, { readPrior: async () => { throw new Error('로그인이 필요합니다.'); } });
  const { record: r2 } = d2.build('gongmun.prior', { input: { id: 'HER-2026-000097' }, preset: PRIOR_PRESET });
  await assert.rejects(d2.run(r2, { text: '선행 품의 읽기' }), /로그인이 필요합니다/);
  assert.deepEqual([log.at(-1).ok, log.at(-1).data.result.error], [false, '로그인이 필요합니다.']);
});
t('문서번호가 없으면 관문이 막는다 — 조회라 confirmed 는 받지 않는다', () => {
  const d = createDispatcher({ spec: ACTIONS, now: () => NOW });
  assert.throws(() => d.build('gongmun.prior', { input: { title: '제목만' }, preset: PRIOR_PRESET }), ActionError);
});

console.log(`\n통과 ${pass}건`);
