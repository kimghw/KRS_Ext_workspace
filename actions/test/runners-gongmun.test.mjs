// 공문 어댑터(actions/runners/gongmun.js) — 기록 → writePlan·writeGongmun 의 인자 변환(갈래는 entry 에서, 입력 칸 그대로, preset.setup → ctx.preset,
// me·project·today) · 첨부 이름 ↔ ctx.files 검사 · ok 판정(안 된 단계가 없을 때) · 공문 갈래는 네 종류뿐(공문 설정은 종류마다의 preset.setup) ·
// 얼린 기록으로 진짜 writePlan 이 돌고 화면 상태를 바로 넣던 예전 길과 같은 계획이 나온다.
//
// 명세는 생성물(actions/spec.js)의 진짜 gongmun.* 를 쓴다 — 칸 이름·사전설정 키가 어긋나면 여기서 드러난다.
import assert from 'node:assert/strict';

import { ACTIONS } from '../spec.js';
import { createDispatcher } from '../dispatch.js';
import { ActionError } from '../gate.js';
import { registerGongmun, writeOk } from '../runners/gongmun.js';
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
t('gongmun.write 를 등록한다 — 같은 디스패처에 두 번은 throw. 공문 갈래는 네 종류뿐이고 모두 gongmun.write 로 돈다', () => {
  const { d } = make();
  assert.throws(() => registerGongmun(d), /gongmun\.write 는 이미 등록/);
  const ids = ['gongmun.purchase', 'gongmun.edu', 'gongmun.trip', 'gongmun.outside'];
  assert.deepEqual(ACTIONS.domains.gongmun.kinds, ['purchase', 'edu', 'trip', 'outside']);
  assert.deepEqual(Object.keys(ACTIONS.actions).filter((id) => id.startsWith('gongmun.')), ids);
  for (const id of ids) assert.equal(ACTIONS.actions[id].runner, 'gongmun.write', id);
});
t('공문 설정은 따로 된 행위가 아니라 종류마다의 사전설정 setup 이다(저장소 gongmunPreset, 없으면 관문이 막는다 — 채우던 채팅 칸은 2026-10-09 에 뺐다)', () => {
  for (const id of ['gongmun.purchase', 'gongmun.edu', 'gongmun.trip', 'gongmun.outside']) {
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
  assert.deepEqual(calls.write[0].opts, { files: FILES, onStep, onTab, dry: true });
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
  assert.deepEqual(calls.write[0].opts, { files: [], onStep: undefined, onTab: undefined, dry: undefined });
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
await ta('얼린 기록으로 진짜 writePlan 이 돌고, 화면 상태를 바로 넣던 예전 길(writePlan 직접)과 같은 계획이 나온다 — 구매·외부활동', async () => {
  for (const [id, input, preset, kind] of [['gongmun.purchase', INPUT, PRESET, 'purchase'], ['gongmun.outside', OUT_INPUT, OUT_PRESET, 'outside']]) {
    const calls = [];
    const d = createDispatcher({ spec: ACTIONS, now: () => NOW });
    registerGongmun(d, { writeGongmun: async (plan) => { calls.push(plan); return RESULT; } });
    const { record } = d.build(id, { input, preset });
    await d.run(record, { confirmed: record.hash, files: FILES });
    const { title, body, draft, form, setting, rank } = input;
    const old = writePlan(kind, { title, body, draft, form, setting, rank }, { me: preset.me, preset: preset.setup, project: preset.project || null, today: preset.today });
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

console.log(`\n통과 ${pass}건`);
