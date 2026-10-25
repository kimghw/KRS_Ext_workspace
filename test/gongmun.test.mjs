// 공문(전자결재 품의) 작성의 순수 로직 — src/gongmun.js. 틀 채우기·조사·한도·결재선·공문 설정 채우기를 못 박는다.
// 화면 쪽(탭 전환·채팅·한도 차단·새 공문 열기)은 test/wiring.test.mjs 의 "공문 탭" 이 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

import {
  delegationOf, docSettingOf, settingText, writePlan, orderAuto, orderFromPurchase, rowsPlan,
} from '../src/gongmun.js';
import { RECIPE } from '../src/gmrecipe.js';
import { injected as page, STEPS } from '../src/gmwrite.js';
import { readRecipe, checkRecipe, render as renderRecipe, build as buildRecipe } from '../tools/gen-gongmun.mjs';
import {
  KINDS, KIND_ORDER, FORMS, DEFAULT_TEMPLATES, MAX_PROJECTS, PURCHASE_LIMIT, FIELDS, VARS, varsFor,
  templateOf, templateEdited, templatesOf, normalizeTemplates, pickTemplate, addTemplate, editTemplate, removeTemplate, MAX_TEMPLATES, VAR_GROUPS, normalizePreset, normalizeProjects, namesOf, josa, hasBatchim, fillTemplate,
  totalOf, gistOf, fromRecord, blankDraft, overLimit, approvalLine, lineText, compose, needs, bodyHtml, draftUrl, attachName,
  moneyOf, won, dotDate, summaryOf, parseSetupLocal, mergeSetup, attachList, attachBlock, mergeDraft, applyReason, reasonInput, REASON_KEYS,
  eduModeOf, EDU_MODES, spreadParts, attachWithCut, rndContent, rndProjects, REASON_LABEL, missingDocs, moreLead,
  normalizeRndExtra, sameProject, formsFor, fieldForm, timeOf, minutesTotal, outsideAuto, draftValue, projectRefs,
} from '../src/gongmun.js';
import { normalizeBook } from '../src/rnd.js';
import { structure, systemPrompt, promptOf, InputError } from '../src/input.js';
import { checkSpec } from '../tools/gen-input.mjs';
import { TASKS } from '../src/input.js';
import { INPUT_SPEC } from '../src/inputspec.js';
import { DOC_NAMES, whoOf } from '../src/gongmun.js';
import { gongmunInput, gongmunSetupSmart } from '../src/llm.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const rx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 새 공문 창의 본문 틀 흉내(jsdom) — 페이지 함수(src/gmwrite.js 의 injected)는 전역 document·window·Event 를 보니 잠시 바꿔 둔다.
const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
async function withDom(html, fn, { scripts = false } = {}) {
  const dom = new JSDOM(`<body>${html}</body>`, {
    url: 'https://eclass.krs.co.kr/RealEANET/Forms/Drafts/KR_Purchase_Order.aspx', runScripts: scripts ? 'dangerously' : undefined, virtualConsole: new VirtualConsole(),
  });
  if (dom.window.document.readyState !== 'complete') await new Promise((r) => dom.window.addEventListener('load', r));
  const prev = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event };
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, Event: dom.window.Event });
  try {
    return await fn(dom.window);
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

// 공문 설정에는 참조자가 없다(2026-10-15 사용자 지정) — 참조자는 과제의 refs(계획서 YAML 의 공문.참조자)에 공문 종류별로 있다.
const PRESET = { dept: '연구본부 수소전기추진연구팀', head: '노길태' };
const PROJECT = {
  name: 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발', code: 'RND-20-2026', lead: '박기도', about: '', account: '',
  refs: { 구매: ['홍길동', '이몽룡'], 출장: '홍길동, 이몽룡' },
};
const CTX = { me: '김거화', preset: PRESET, project: PROJECT, today: '2026-10-07' };

console.log('갈래와 양식');
t('갈래는 구매·교육·출장·수당·자문·구매의뢰·외부활동 일곱이고 일곱 다 문서를 넣어 읽는다(2026-10-08 사용자 지정, 구매의뢰는 2026-10-17, 수당·자문은 2026-10-21 — 단추 글자는 두 글자)', () => {
  assert.deepEqual(KIND_ORDER, ['purchase', 'edu', 'trip', 'allowance', 'consult', 'order', 'outside']);
  assert.deepEqual(KIND_ORDER.map((k) => KINDS[k].label), ['구매', '교육', '출장', '수당', '자문', '의뢰', '외부'], '단추 글자는 두 글자(2026-10-21 사용자 지정 "지금 4글자인걸 2글자로 줄이면 될듯")');
  for (const k of KIND_ORDER) assert.ok(KINDS[k].doc && KINDS[k].ask && KINDS[k].more, `${k} 에 문서 넣는 곳의 말`);
  assert.equal(KINDS.trip.ask, '행사·회의 안내문이나 초청장을 넣으세요');
  assert.deepEqual(FIELDS.trip.map((f) => f.key), ['place', 'from', 'to', 'who', 'cost', 'division', 'purpose', 'reason', 'account'], '출장 구분(국내·해외)은 위임전결을 가른다');
  assert.deepEqual(FIELDS.trip.filter((f) => f.open).map((f) => f.key), ['purpose', 'reason'], '펼쳐 두는 칸은 출장목적·출장사유');
  // 외부활동은 외부강의등 신고서(2026-10-15 사용자 지정) — 칸 하나가 신고서 칸 하나, 과제를 고르지 않는다.
  assert.equal(KINDS.outside.title, '외부강의등 신고서');
  assert.deepEqual(FIELDS.outside.map((f) => f.key), ['org', 'representative', 'contact', 'contactTel', 'subject', 'place', 'from', 'to', 'start', 'end', 'hours', 'mins',
    'fee', 'expenses', 'rank', 'monthCount', 'yearTotal', 'note']);
  assert.deepEqual(FIELDS.outside.filter((f) => f.open).map((f) => f.key), ['rank', 'monthCount', 'yearTotal', 'note'], '펼쳐 두는 칸은 직급·당월 누적·당해 연도 누적·비고');
  assert.deepEqual(KIND_ORDER.map((k) => KINDS[k].project), [true, true, true, true, true, true, false], '수당·자문·구매의뢰도 과제를 고른다(과제 예산)');
});
t('외부활동의 양식은 외부강의등 신고서, 구매의뢰는 구매요청서(둘 다 칸이 정해진 폼) — 그 폼은 그 갈래에서만 고르고, 다른 갈래의 기본 양식은 그대로 연구업무추진품의', () => {
  assert.deepEqual(KIND_ORDER.map((k) => DEFAULT_TEMPLATES[k].form),
    ['KR_EA_Research_Task', 'KR_EA_Research_Task', 'KR_EA_Research_Task', 'KR_EA_Research_Task', 'KR_EA_Research_Task', 'KR_Purchase_Order', 'KR_Outside_Lecture_Report']);
  assert.deepEqual(formsFor('outside').map((f) => f.id), ['KR_EA_Research_Task', 'KR_Outside_Lecture_Report', 'KR_EA_Form2']);
  assert.deepEqual(formsFor('order').map((f) => f.id), ['KR_EA_Research_Task', 'KR_Purchase_Order', 'KR_EA_Form2']);
  assert.deepEqual(formsFor('purchase').map((f) => f.id), ['KR_EA_Research_Task', 'KR_EA_Form2'], '신고서·구매요청서는 그 갈래 초안의 칸이라 다른 갈래에는 없다');
  assert.deepEqual(['KR_Outside_Lecture_Report', 'KR_Purchase_Order', 'KR_EA_Research_Task', 'KR_EA_Form2', 'KR_X'].map(fieldForm), [true, true, false, false, false]);
  assert.equal(DEFAULT_TEMPLATES.outside.title, '외부강의등 신고서', '제목은 양식의 기본 제목 그대로(지난 신고서도 그랬다)');
});
t('구매만 100만원 한도가 있다', () => {
  assert.equal(PURCHASE_LIMIT, 1_000_000);
  assert.equal(KINDS.purchase.limit, PURCHASE_LIMIT);
  assert.equal(KINDS.edu.limit, null);
});
t('옛 꼴(고친 칸만)의 양식은 내 양식 1 로 옮겨 그것을 쓰고, 비운 칸은 기본으로 돌아간다', () => {
  const saved = { purchase: { title: '[구매] {품목요지}' }, edu: { title: DEFAULT_TEMPLATES.edu.title } };
  assert.deepEqual(Object.keys(normalizeTemplates(saved)), ['purchase'], '기본과 같은 옛 꼴은 옮기지 않는다');
  const now = templateOf('purchase', saved);
  assert.deepEqual([now.id, now.name, now.title], ['t1', '내 양식 1', '[구매] {품목요지}']);
  assert.equal(now.body, DEFAULT_TEMPLATES.purchase.body);
  assert.ok(templateEdited('purchase', saved));
  assert.ok(!templateEdited('edu', saved));
  assert.deepEqual([templateOf('edu', saved).id, templateOf('edu', saved).name, templateOf('edu', saved).form], ['', '기본', 'KR_EA_Research_Task']);
});
t('내 양식 — 갈래마다 여러 개 등록·고르기·고치기·지우기, [기본] 은 레시피 그대로', () => {
  let saved = {};
  const one = addTemplate(saved, 'trip', { ...DEFAULT_TEMPLATES.trip, title: '{출장지} 출장 품의' });
  saved = one.templates;
  const two = addTemplate(saved, 'trip', { title: '{과제별명} 출장', body: '' });
  saved = two.templates;
  assert.deepEqual([one.id, two.id], ['t1', 't2']);
  assert.deepEqual(templatesOf('trip', saved).map((t) => t.name), ['내 양식 1', '내 양식 2']);
  assert.equal(templateOf('trip', saved).title, '{과제별명} 출장', '새로 등록한 것을 쓴다');
  assert.equal(templateOf('trip', saved).body, DEFAULT_TEMPLATES.trip.body, '비운 본문은 기본');
  saved = editTemplate(saved, 'trip', 't2', { name: '  짧은   출장 ', body: '{출장지}' });
  assert.deepEqual([templateOf('trip', saved).name, templateOf('trip', saved).body], ['짧은 출장', '{출장지}']);
  saved = pickTemplate(saved, 'trip', 't1');
  assert.equal(templateOf('trip', saved).title, '{출장지} 출장 품의');
  saved = pickTemplate(saved, 'trip', '');
  assert.deepEqual([templateOf('trip', saved).id, templateOf('trip', saved).title], ['', DEFAULT_TEMPLATES.trip.title], '[기본]');
  assert.equal(templatesOf('trip', saved).length, 2, '기본을 골라도 내 양식은 남는다');
  assert.equal(templateOf('edu', saved).title, DEFAULT_TEMPLATES.edu.title, '다른 갈래는 그대로');
  saved = pickTemplate(saved, 'trip', 't1');
  saved = removeTemplate(saved, 'trip', 't1');
  assert.deepEqual([templateOf('trip', saved).id, templatesOf('trip', saved).map((t) => t.id)], ['', ['t2']], '쓰던 것을 지우면 기본');
  const three = addTemplate(saved, 'trip', {});
  assert.deepEqual([three.id, templatesOf('trip', three.templates).at(-1).name], ['t3', '내 양식 1'], '지운 id 는 다시 쓰지 않고, 이름은 빈 번호부터');
  saved = removeTemplate(three.templates, 'trip', 't2');
  saved = removeTemplate(saved, 'trip', 't3');
  assert.deepEqual(saved, {}, '다 지우면 갈래째 빠진다');
  let full = {};
  for (let i = 0; i < MAX_TEMPLATES; i++) full = addTemplate(full, 'order', {}).templates;
  assert.equal(addTemplate(full, 'order', {}), null, `갈래마다 ${MAX_TEMPLATES}개까지`);
  assert.deepEqual(normalizeTemplates({ outside: { pick: 'x', list: [{ id: 'a', title: '신고' }, { id: 'a' }, { name: '이름만' }] } }),
    { outside: { pick: '', list: [{ id: 'a', name: '내 양식 1', form: '', title: '신고', body: '' }] } }, '같은 id·id 없는 것은 버리고, 없는 것을 골랐으면 기본');
});
t('틀에 쓰는 이름 — 공통·갈래·목록 안·꾸밈 무리, 누르면 넣을 글', () => {
  const g = VAR_GROUPS.purchase;
  assert.deepEqual(g.map((x) => x.label), ['공통', '구매', '품목마다', '꾸밈']);
  assert.ok(g[0].vars.some(([tok, , ins]) => tok === '{과제별명}' && ins === '{과제별명}'));
  assert.ok(g[1].vars.some(([tok]) => tok === '{품목요지}'));
  assert.deepEqual(g[2].vars.slice(0, 3).map(([tok, , ins]) => [tok, ins]), [['{{#품목}} … {{/품목}}', '{{#품목}}\n{{/품목}}'], ['{번호}', '{번호}'], ['{품목명}', '{품목명}']]);
  assert.deepEqual(g[3].vars.map(([tok, , ins]) => ins), ['', '', '{차례}', '{세부차례}'], '꼴({이름:은}·{이름?})은 넣지 않는다');
  assert.deepEqual(VAR_GROUPS.edu.map((x) => x.label), ['공통', '교육', '꾸밈']);
  assert.deepEqual(Object.keys(VAR_GROUPS), KIND_ORDER, '공문의 모든 갈래');
});
t('eclass 양식은 본문을 붙여 넣는 것과 칸 지도를 둔 구매요청서(구매의뢰만)·외부강의등 신고서(외부활동만) — manifest 의 order 차례', () => {
  assert.deepEqual(FORMS.map((f) => f.id), ['KR_EA_Research_Task', 'KR_Purchase_Order', 'KR_Outside_Lecture_Report', 'KR_EA_Form2']);
  assert.deepEqual(FORMS.find((f) => f.id === 'KR_Outside_Lecture_Report').only, ['outside']);
  assert.deepEqual(FORMS.find((f) => f.id === 'KR_Purchase_Order').only, ['order']);
});

console.log('틀 채우기');
t('받침에 맞는 조사 — 모르면 둘 다', () => {
  assert.equal(josa('수소전기추진연구팀', '은'), '수소전기추진연구팀은');
  assert.equal(josa('모니터', '을'), '모니터를');
  assert.equal(josa('모니터 외 1건', '를'), '모니터 외 1건을');
  assert.equal(josa('34인치 모니터 (U3425WE)', '을'), '34인치 모니터 (U3425WE)를', '끝의 괄호는 건너뛴다');
  assert.equal(josa('U3425WE', '을'), 'U3425WE을(를)');
  assert.equal(josa('서울', '으로'), '서울로', 'ㄹ 받침 뒤는 로');
  assert.equal(josa('부산', '로'), '부산으로');
  assert.equal(hasBatchim('3'), true);
  assert.equal(hasBatchim('2'), false);
});
t('{이름} 은 값, 비면 [이름] 으로 남기고 알린다 · {이름?} 줄은 비면 뺀다 · 모르는 이름은 그대로', () => {
  const tpl = '제목 {가}\n- 사양 : {나?}\n- 금액 : {다}\n{모름}';
  const out = fillTemplate(tpl, { 가: '모니터', 나: '', 다: '' });
  assert.equal(out.text, '제목 모니터\n- 금액 : [다]\n{모름}');
  assert.deepEqual(out.missing, ['다']);
});
t('{{#목록}} 은 줄마다 되풀이하고 번호를 매긴다 — 빠지는 줄은 그 항목 안에서만 빠진다', () => {
  const tpl = '가.\n{{#품목}}\n  ({번호}) {품목명}\n    - 금액 : {금액?}\n{{/품목}}끝';
  const out = fillTemplate(tpl, {}, { 품목: [{ 품목명: 'A', 금액: '1원' }, { 품목명: 'B', 금액: '' }] });
  assert.equal(out.text, '가.\n  (1) A\n    - 금액 : 1원\n  (2) B\n끝');
  assert.equal(fillTemplate('{{#품목}}\n{없음?}\n{{/품목}}끝', {}, { 품목: [{ 없음: '' }] }).text, '끝', '줄이 다 빠진 항목은 빈 줄도 남기지 않는다');
});

console.log('읽은 문서 → 초안');
t('합계는 최종 금액 → 공급가액+부가세 → 품목 금액 합(알림) 순이다', () => {
  assert.deepEqual(totalOf({ total: 989000, supply: 1, vat: 1 }), { total: 989000, note: '' });
  assert.deepEqual(totalOf({ supply: 900000, vat: 90000 }), { total: 990000, note: '' });
  assert.equal(totalOf({ items: [{ amount: 100 }, { amount: 200 }] }).total, 300);
  assert.match(totalOf({ items: [{ amount: 100 }, { amount: 200 }] }).note, /부가세/);
  assert.equal(totalOf({ items: [{ amount: 100 }, { name: 'x' }] }).total, null, '금액이 빠진 줄이 있으면 더하지 않는다');
});
t('구매 — 품목 요지와 요약("…을 구매하고자")을 만든다', () => {
  const { draft, notes } = fromRecord('purchase', {
    docType: 'quote', vendor: 'OO상사', quoteDate: '2026-10-01', total: 989000, gist: null,
    items: [{ name: '34인치 모니터', spec: 'WQHD', qty: 1, unit: '대', amount: 890000 }, { name: '모니터암', qty: 1, amount: 99000 }],
  });
  assert.equal(draft.gist, '34인치 모니터 외 1건');
  assert.equal(draft.summary, '34인치 모니터 외 1건을 구매하고자');
  assert.equal(draft.total, 989000);
  assert.deepEqual(notes, []);
  assert.equal(gistOf([], '대체'), '대체');
  assert.equal(summaryOf(''), '');
});
t('교육 — 교육명·기간·교육비, 참석자는 나', () => {
  const { draft } = fromRecord('edu', { docType: 'course', provider: '한국전력기술교육원', course: '전력변환 설계 실무', from: '2026-10-12', to: '2026-10-14', fee: 450000 }, { me: '김거화' });
  assert.deepEqual([draft.course, draft.provider, draft.from, draft.to, draft.fee, draft.attendees], ['전력변환 설계 실무', '한국전력기술교육원', '2026-10-12', '2026-10-14', 450000, '김거화']);
});
t('외화 문서는 원화로 고쳐 달라고 알린다', () => {
  assert.match(fromRecord('purchase', { currency: 'USD', total: 500 }).notes.join(), /USD/);
});

console.log('한도');
t('100만원 이하만 작성 — 딱 100만원은 된다', () => {
  assert.equal(overLimit('purchase', { total: 1_000_000 }).over, false);
  assert.equal(overLimit('purchase', { total: 1_000_001 }).over, true);
  assert.equal(overLimit('purchase', { total: '1,239,000' }).over, true, '쉼표 글도 읽는다');
});
t('합계를 모르거나 원화가 아니면 가리지 못한다(unknown) — 화면이 막는다', () => {
  assert.deepEqual(overLimit('purchase', { total: null }), { over: false, unknown: true, limit: PURCHASE_LIMIT, amount: null });
  assert.equal(overLimit('purchase', { total: 500, currency: 'USD' }).unknown, true);
});
t('교육은 한도가 없다', () => assert.deepEqual(overLimit('edu', { fee: 5_000_000 }), { over: false, unknown: false, limit: null, amount: 5_000_000 }));

console.log('결재선');
t('기안자 → 합의자(과제책임자) → 결재자(부서장) · 참조자 — 참조자는 과제의 refs 에서 이 갈래의 것(2026-10-15 사용자 지정)', () => {
  const line = approvalLine({ ...CTX, kind: 'purchase' });
  assert.deepEqual(line.steps, [
    { role: '기안', name: '김거화' }, { role: '합의', name: '박기도', why: '과제책임자' }, { role: '결재', name: '노길태', why: '부서장' },
  ]);
  assert.deepEqual(line.refs, ['홍길동', '이몽룡']);
  assert.equal(lineText(line), '기안자 김거화 → 합의자 박기도 → 결재자 노길태 · 참조자 홍길동, 이몽룡');
  assert.deepEqual(approvalLine({ ...CTX, kind: 'edu' }).refs, [], '교육에는 적혀 있지 않다 — 비운다');
  assert.deepEqual(approvalLine({ ...CTX, kind: 'trip' }).refs, ['홍길동', '이몽룡'], '쉼표로 적은 글도 목록');
  assert.deepEqual(approvalLine(CTX).refs, [], '갈래를 모르면 참조도 없다');
  assert.deepEqual(approvalLine({ ...CTX, project: { ...PROJECT, refs: {} }, kind: 'purchase' }).refs, [], '과제에 적힌 것이 없으면 비운다');
  assert.deepEqual(approvalLine({ ...CTX, preset: { ...PRESET, refs: '홍길동' }, project: { ...PROJECT, refs: {} }, kind: 'purchase' }).refs, [], '공문 설정의 옛 refs 는 버린다');
  assert.deepEqual(approvalLine({ ...CTX, kind: 'outside' }).refs, [], '과제를 고르지 않는 갈래(외부활동)는 참조도 없다');
});
t('과제의 참조자는 갈래 키(purchase)·이름(구매)·제목(구매품의)으로 찾는다 — 공백·대소문자 무시, 배열이나 글', () => {
  assert.deepEqual(projectRefs({ refs: { purchase: ['이몽룡'] } }, 'purchase'), ['이몽룡']);
  assert.deepEqual(projectRefs({ refs: { ' 구매 품의 ': '이몽룡·성춘향' } }, 'purchase'), ['이몽룡', '성춘향']);
  assert.deepEqual(projectRefs({ refs: { Edu: ['성춘향', '성춘향', ' '] } }, 'edu'), ['성춘향'], '같은 이름은 한 번');
  assert.deepEqual(projectRefs({ refs: { 구매: ['이몽룡'] } }, 'edu'), []);
  assert.deepEqual([projectRefs(null, 'purchase'), projectRefs({ refs: 'x' }, 'purchase'), projectRefs({ refs: { 구매: ['a'] } }, '')], [[], [], []]);
});
t('과제책임자가 기안자 본인이면 합의는 뺀다 — 본인이 아니면 부서장이어도 합의자다(2026-10-08 사용자 지정)', () => {
  const mine = approvalLine({ ...CTX, project: { ...PROJECT, lead: '김거화' } });
  assert.deepEqual(mine.steps.map((s) => s.role), ['기안', '결재']);
  assert.match(mine.notes[0], /기안자라 합의는 뺐습니다/);
  const head = approvalLine({ ...CTX, project: { ...PROJECT, lead: '노 길태' } });
  assert.deepEqual(head.steps.map((s) => `${s.role} ${s.name}`), ['기안 김거화', '합의 노 길태', '결재 노길태']);
  assert.match(head.notes[0], /부서장이라 합의와 결재가 같은 사람/);
  assert.deepEqual(approvalLine({ ...CTX, project: { ...PROJECT, lead: '' } }).steps.map((s) => s.role), ['기안', '결재'], '책임자를 모르면 합의 자리가 빈다 — 화면이 채우라고 보인다');
});
t('결재선에 이미 있는 사람은 참조에서 뺀다', () => {
  assert.deepEqual(approvalLine({ ...CTX, project: { ...PROJECT, refs: { 구매: '박기도, 홍길동, 노길태' } }, kind: 'purchase' }).refs, ['홍길동']);
});
t('lead·refs 를 주면(공문 기록의 두 칸) 과제의 것 대신 — 빈 책임자는 과제의 것, 빈 참조자 목록은 참조 없음, null 은 과제의 것', () => {
  const line = approvalLine({ ...CTX, kind: 'purchase', lead: '성춘향', refs: ['변학도', '노길태'] });
  assert.deepEqual(line.steps.map((s) => `${s.role} ${s.name}`), ['기안 김거화', '합의 성춘향', '결재 노길태']);
  assert.deepEqual(line.refs, ['변학도'], '결재선에 선 사람은 여기서도 뺀다');
  assert.deepEqual(approvalLine({ ...CTX, kind: 'purchase', lead: '', refs: [] }).steps[1].name, '박기도');
  assert.deepEqual(approvalLine({ ...CTX, kind: 'purchase', refs: [] }).refs, []);
  assert.deepEqual(approvalLine({ ...CTX, kind: 'purchase', refs: null }).refs, ['홍길동', '이몽룡']);
  assert.deepEqual(approvalLine({ ...CTX, kind: 'purchase', lead: '김 거화' }).steps.map((s) => s.role), ['기안', '결재'], '기안자 본인이면 합의 없음(공백 무시)');
  assert.deepEqual(approvalLine({ ...CTX, kind: 'outside', lead: '성춘향', refs: ['변학도'] }).steps.map((s) => s.role), ['기안', '결재'], '외부활동은 둘 다 없다');
});

console.log('행정지원 — R&D 탭 참여인력에서 공문 참조를 켠 사람(2026-10-16)');
t('projectRefs — 공문 참조를 켠 행정지원이 먼저, 그 뒤에 YAML 의 이 갈래 참조자. 갈래를 가리지 않고 같은 이름은 한 번, 갈래를 모르면 비운다', () => {
  const p = { refs: { 구매: ['이몽룡', '홍길동'] }, support: [{ name: '홍길동', role: '행정 담당', ref: true }, { name: '변학도', role: '연구지원', ref: false }, { name: '' }] };
  assert.deepEqual(projectRefs(p, 'purchase'), ['홍길동', '이몽룡']);
  assert.deepEqual(projectRefs(p, 'edu'), ['홍길동'], '교육에는 YAML 에 적힌 것이 없어도 행정지원은 든다');
  assert.deepEqual(projectRefs(p, 'trip'), ['홍길동']);
  assert.deepEqual(projectRefs(p, ''), []);
  assert.deepEqual(projectRefs({ support: [{ name: '심청' }] }, 'purchase'), ['심청'], 'ref 를 적지 않았으면 참조로 본다');
});
t('approvalLine — 행정지원의 참조자도 결재선에 선 사람(합의·결재)은 뺀다. 외부활동은 참조 없음', () => {
  const project = { ...PROJECT, refs: {}, support: [{ name: '박기도', ref: true }, { name: '홍길동', ref: true }] };
  assert.deepEqual(approvalLine({ ...CTX, project, kind: 'edu' }).refs, ['홍길동']);
  assert.deepEqual(approvalLine({ ...CTX, project, kind: 'outside' }).refs, []);
});
t('rndProjects — R&D 과제의 행정지원이 공문의 과제로 따라온다', () => {
  const book = normalizeBook({ projects: [{ id: 'p1', name: 'A', support: [{ name: '홍길동', role: '행정 담당' }, { name: '홍 길동' }, { name: ' ' }] }] });
  assert.deepEqual(book.projects[0].support, [{ name: '홍길동', role: '행정 담당', ref: true }], '같은 이름(공백 무시)·빈 이름은 버린다');
  const [a] = rndProjects(book, [], '2026-10-16');
  assert.deepEqual(a.support, [{ name: '홍길동', role: '행정 담당', ref: true }]);
  assert.deepEqual(projectRefs(a, 'purchase'), ['홍길동']);
});

console.log('공문 만들기');
t('구매 — 기본 양식의 첫 줄·요약·품목·합계·계정·첨부', () => {
  const draft = { ...fromRecord('purchase', { total: 989000, items: [{ name: '34인치 모니터', spec: 'WQHD · 커브드', qty: 1, unit: '대', amount: 890000 }, { name: '모니터암', amount: 99000 }] }).draft, vendor: 'OO상사', use: '회의 자료 검토용', reason: '대화면 필요' };
  const c = compose('purchase', draft, CTX);
  assert.equal(c.title, '34인치 모니터 외 1건 구매 품의');
  assert.equal(c.form, 'KR_EA_Research_Task');
  const lines = c.body.split('\n');
  assert.equal(lines[0], `1. 연구본부 수소전기추진연구팀은 「${PROJECT.name}」 과제를 수행하고 있습니다.`);
  assert.equal(lines[1], '2. 이와 관련하여 34인치 모니터 외 1건을 구매하고자 아래와 같이 품의하오니 재가하여 주시기 바랍니다.');
  assert.ok(lines.includes('------------ 아   래 ------------'));
  assert.ok(lines.includes('    (1) 구매품 : 34인치 모니터'));
  assert.ok(lines.includes('        - 수량 : 1대'));
  assert.ok(lines.includes('    (2) 구매품 : 모니터암'));
  assert.ok(!lines.some((l) => /\[사양\]|\[수량\]/.test(l)), '빠져도 되는 칸은 줄째 빠진다');
  // 가. 과제 개요(2026-10-16 사용자 지정: "구매양식에 과제 개요가 들어가 있질 않음") — 교육·출장과 같은 네 줄, 비어도 되는 칸(번호·기간·책임자)은 빈 줄째 빠진다.
  const at = lines.indexOf('가. 과제 개요');
  assert.ok(at > 0, '아래 다음에 가. 과제 개요');
  assert.deepEqual(lines.slice(at + 1, at + 4), [`    (1) 과 제 명 : ${PROJECT.name}`, '    (2) 과제번호 : RND-20-2026', '    (3) 과제책임자 : 박기도'], '연구기간이 없으면 그 줄은 빠지고 차례를 잇는다');
  assert.equal(lines[at + 4], '나. 구매 내역');
  assert.ok(lines.includes('다. 구매금액 : 989,000원 (VAT 포함)'));
  assert.ok(lines.includes('마. 구매계정 : 연구활동비(연구실운용비)'));
  assert.equal(lines.at(-1), '    1. 견적서 1부.  끝.');
  assert.deepEqual(c.missing, []);
});
t('과제 개요·계정을 적어 두면 그것을 쓴다', () => {
  const c = compose('purchase', blankDraft('purchase'), { ...CTX, project: { ...PROJECT, about: '친환경 선박용 MVDC 차단기 개발을 수행하고 있습니다', account: '연구재료비' } });
  assert.match(c.body, /^1\. 연구본부 수소전기추진연구팀은 친환경 선박용 MVDC 차단기 개발을 수행하고 있습니다\./);
  assert.match(c.body, /마\. 구매계정 : 연구재료비\n바\. 용도 : \[용도\]/);
  assert.match(c.body, /구매계정 : 연구재료비/);
  assert.deepEqual(c.missing.sort(), ['구매사유', '업체', '요약', '용도', '품목요지', '합계'].sort());
});
const EDU_REC = { course: '전력변환 설계 실무', provider: '교육원', from: '2026-10-12', to: '2026-10-14', fee: 450000, purpose: '전력변환 설계 역량 강화' };
const FULL = { ...PROJECT, alias: '차단기 과제', period: '2026.04.01 ~ 2029.12.31' };
t('교육 — 제목은 "[과제 별명] 수행을 위한 교육 품의", 본문은 가. 과제 개요 · 나. 교육 내용(기간은 며칠인지까지)', () => {
  const { draft } = fromRecord('edu', EDU_REC, { me: '김거화' });
  assert.equal(draft.mode, '교육', '교육장소가 온라인이 아니면 교육');
  const c = compose('edu', draft, { ...CTX, project: FULL });
  assert.equal(c.title, '차단기 과제 수행을 위한 교육 품의');
  assert.match(c.body, /전력변환 설계 역량 강화를 위하여 아래와 같이 교육에 참가하고자/);
  assert.match(c.body, new RegExp(`가\\. 과제 개요\n {4}\\(1\\) 과 제 명 : ${PROJECT.name}\n {4}\\(2\\) 과제번호 : RND-20-2026\n`
    + ' {4}\\(3\\) 연구기간 : 2026\\.04\\.01 ~ 2029\\.12\\.31\n {4}\\(4\\) 과제책임자 : 박기도\n나\\. 교육 내용\n {4}\\(1\\) 교 육 명 : 전력변환 설계 실무\n'));
  assert.match(c.body, / {4}\(3\) 교육기간 : 2026\. 10\. 12\. ~ 2026\. 10\. 14\. \(3일\)/);
  // 교육시간·교육내용이 없어 그 줄이 빠져도 (1)·(2)… 는 이어진다({세부차례}).
  assert.match(c.body, /\(4\) 교육장소 : \[교육장소\]\n {4}\(5\) 참 석 자 : 김거화\n {4}\(6\) 교 육 비 : 450,000원 \(VAT 포함\)/);
  assert.match(c.body, /\(7\) 예산계정 : 연구활동비\(교육훈련비\)\n {4}\(8\) 교육사유 : \[교육사유\]/);
  assert.ok(!/교육시간|교육내용/.test(c.body), '교육시간·교육내용이 없으면 그 줄을 뺀다');
  assert.match(c.body, /※ 첨 부\n {4}1\. 교육 견적서 1부\.\n {4}2\. 교육 내용 1부\.  끝\.$/, '문서 없이 써도 교육 견적서·교육 내용 두 줄');
});
t('교육 — 온라인이면 "… 수행을 위한 온라인교육 품의", 고른 교육 구분이 이긴다', () => {
  const { draft } = fromRecord('edu', { ...EDU_REC, provider: '인프런', place: '온라인' }, { me: '김거화' });
  assert.equal(draft.mode, '온라인교육');
  const c = compose('edu', draft, { ...CTX, project: FULL });
  assert.equal(c.title, '차단기 과제 수행을 위한 온라인교육 품의');
  assert.match(c.body, /아래와 같이 온라인교육에 참가하고자/);
  assert.equal(compose('edu', { ...draft, mode: '교육' }, { ...CTX, project: FULL }).title, '차단기 과제 수행을 위한 교육 품의', '칸에서 고르면 그것');
  assert.deepEqual(EDU_MODES, ['교육', '온라인교육']);
  assert.equal(eduModeOf({ place: '서울 본사 교육장', provider: '한국전력기술교육원' }), '교육');
  assert.equal(eduModeOf({ place: '', provider: 'Udemy' }), '온라인교육', '온라인 강의 사이트면 장소가 비어도 온라인');
  assert.equal(eduModeOf({ place: '실시간 비대면(Zoom)' }), '온라인교육');
});
t('수당 — 제목은 "[과제 별명] 연구수당 지급 품의", 본문은 가. 과제 개요 · 나. 지급 내용(대상 기간은 날수까지), 위임전결은 지급 총액으로 연구비 집행(2026-10-21 사용자 지정)', () => {
  const { draft, notes } = fromRecord('allowance', { who: '김거화 · 홍길동', from: '2026-01-01', to: '2026-06-30', basis: '참여율 차등', total: 3000000, purpose: '상반기 연구 수행에 따른 연구수당 지급' }, { me: '김거화' });
  assert.deepEqual(notes, []);
  assert.deepEqual(Object.keys(draft), ['who', 'from', 'to', 'basis', 'total', 'purpose', 'reason', 'account', 'currency', 'attach']);
  const c = compose('allowance', draft, { ...CTX, project: FULL });
  assert.equal(c.title, '차단기 과제 연구수당 지급 품의');
  assert.match(c.body, /^1\. 연구본부 수소전기추진연구팀은 「.+」 과제를 수행하고 있습니다\.\n2\. 이와 관련하여 아래와 같이 과제 참여연구원에게 연구수당을 지급하고자/);
  assert.match(c.body, /나\. 지급 내용\n {4}\(1\) 지급대상 : 김거화 · 홍길동\n {4}\(2\) 대상기간 : 2026\. 1\. 1\. ~ 2026\. 6\. 30\. \(181일\)\n {4}\(3\) 지급기준 : 참여율 차등\n {4}\(4\) 지급총액 : 3,000,000원\n {4}\(5\) 예산계정 : 연구수당\n {4}\(6\) 지급목적 : 상반기 연구 수행에 따른 연구수당 지급\n {4}\(7\) 지급사유 : \[지급사유\]/);
  assert.deepEqual(c.missing, ['지급사유']);
  assert.match(c.body, /※ 첨 부\n {4}1\. 연구수당 지급 내역표 1부\.  끝\.$/, '문서 없이 써도 지급 내역표 한 줄');
  assert.equal(delegationOf('allowance', draft).rank, '팀장');
  assert.equal(delegationOf('allowance', { ...draft, total: 25000000 }).rank, '소장');
  assert.deepEqual(needs('allowance', blankDraft('allowance'), { preset: PRESET, project: FULL, projects: [FULL] }), ['지급 대상', '대상 기간', '지급 총액', '지급 목적', '지급 사유']);
  assert.deepEqual(REASON_KEYS.allowance, { reason: 'reason', use: 'purpose' });
});
t('자문 — 제목은 "[과제 별명] 수행을 위한 전문가 자문 품의", 본문은 가. 과제 개요 · 나. 자문 내용, 소속·방식·장소는 비면 그 줄이 빠진다(2026-10-21 사용자 지정)', () => {
  const rec = { subject: 'MVDC 차단기 절연 설계 검토', expert: '홍길동', affiliation: '부산대학교 교수', from: '2026-11-12', to: '2026-11-12', method: '대면', place: '부산 KR 본사', fee: 500000, purpose: '절연 설계 타당성 검증' };
  const { draft } = fromRecord('consult', rec, { me: '김거화' });
  const c = compose('consult', draft, { ...CTX, project: FULL });
  assert.equal(c.title, '차단기 과제 수행을 위한 전문가 자문 품의');
  assert.match(c.body, /2\. 이와 관련하여 절연 설계 타당성 검증을 위하여 아래와 같이 전문가 자문을 받고자/);
  assert.match(c.body, /나\. 자문 내용\n {4}\(1\) 자문주제 : MVDC 차단기 절연 설계 검토\n {4}\(2\) 자문위원 : 홍길동\n {4}\(3\) 소속·직위 : 부산대학교 교수\n {4}\(4\) 자문일자 : 2026\. 11\. 12\. \(1일\)\n {4}\(5\) 자문방식 : 대면\n {4}\(6\) 자문장소 : 부산 KR 본사\n {4}\(7\) 자 문 료 : 500,000원\n {4}\(8\) 예산계정 : 연구활동비\(전문가활용비\)\n {4}\(9\) 자문사유 : \[자문사유\]/);
  const lean = compose('consult', { ...draft, affiliation: '', method: '', place: '' }, { ...CTX, project: FULL });
  assert.match(lean.body, /\(2\) 자문위원 : 홍길동\n {4}\(3\) 자문일자 : 2026\. 11\. 12\. \(1일\)\n {4}\(4\) 자 문 료 : 500,000원/, '소속·방식·장소가 비면 그 줄이 빠지고 번호는 이어진다');
  assert.equal(delegationOf('consult', { ...draft, fee: 25000000 }).rank, '소장', '자문료가 위임전결의 기준');
  assert.equal(attachName('consult', draft, '2026-10-21'), '자문의뢰서_홍길동_2026-10-21.pdf');
  assert.deepEqual(REASON_KEYS.consult, { reason: 'reason', use: 'purpose' });
});
t('교육 — 별명이 없으면 제목에 과제명, 번호·기간이 없으면 과제 개요의 그 줄이 빠지고 (1)(2)… 는 이어진다', () => {
  const c = compose('edu', fromRecord('edu', EDU_REC).draft, { ...CTX, project: { ...PROJECT, code: '' } });
  assert.equal(c.title, `${PROJECT.name} 수행을 위한 교육 품의`);
  assert.match(c.body, /가\. 과제 개요\n {4}\(1\) 과 제 명 : .+\n {4}\(2\) 과제책임자 : 박기도\n나\. 교육 내용/);
  const none = compose('edu', fromRecord('edu', EDU_REC).draft, { ...CTX, project: null });
  assert.equal(none.title, '[과제별명] 수행을 위한 교육 품의', '과제를 고르지 않으면 눈에 띄게 남는다');
  assert.ok(none.missing.includes('과제별명'));
});
const TRIP_REC = { docType: 'event', place: '부산(한국선급 본사)', from: '2026-10-20', to: '2026-10-21', cost: 300000, purpose: '실증 시험 참관', summary: '실증 시험 참관 안내' };
t('출장 — 행사 안내문에서 출장지·기간·목적·예상경비를 읽고, 제목은 "[과제 별명] 수행을 위한 출장 품의", 본문에 과제 개요·출장 내용·첨부', () => {
  assert.equal(DEFAULT_TEMPLATES.trip.title, '{과제별명} 수행을 위한 출장 품의');
  const { draft, notes } = fromRecord('trip', TRIP_REC, { me: '김거화' });
  assert.deepEqual([draft.place, draft.from, draft.to, draft.who, draft.purpose, draft.cost, notes], ['부산(한국선급 본사)', '2026-10-20', '2026-10-21', '김거화', '실증 시험 참관', 300000, []]);
  // 목적이 문서에 없으면 행사명으로 "○○ 참석" 처럼 쓰는 것은 읽기 지시문(레시피 trip/purpose.yaml 의 purpose read)이 한다.
  assert.match(systemPrompt('gongmun.trip'), /- purpose \(글 또는 null\): [^\n]*없으면 행사·회의명으로 "○○ 참석"/);
  assert.equal(fromRecord('trip', { ...TRIP_REC, purpose: null }).draft.purpose, '', '못 읽었으면 비어 남은 것에 뜬다');
  const c = compose('trip', { ...draft, reason: '과제의 실증 시험 결과 확인에 필요함' }, { ...CTX, project: FULL });
  assert.equal(c.title, '차단기 과제 수행을 위한 출장 품의');
  assert.match(c.body, /가\. 과제 개요\n[\s\S]*나\. 출장 내용\n {4}\(1\) 출 장 지 : 부산\(한국선급 본사\)\n {4}\(2\) 출장기간 : 2026\. 10\. 20\. ~ 2026\. 10\. 21\. \(2일\)\n {4}\(3\) 출 장 자 : 김거화/);
  assert.match(c.body, /\(4\) 출장목적 : 실증 시험 참관\n {4}\(5\) 출장사유 : 과제의 실증 시험 결과 확인에 필요함\n {4}\(6\) 예상경비 : 300,000원\n {4}\(7\) 예산계정 : 연구활동비\(국내여비\)\n\n※ 첨 부\n {4}1\. 행사 안내문 1부\.  끝\.$/);
});
const OUTSIDE_REC = {
  docType: 'request', org: '부산대학교', representative: null, contact: '조선해양공학과(김철수)', contactTel: '051-510-1234', subject: 'MVDC 차단기 기술 특강',
  place: '부산대학교 공학관 301호', from: '2026-11-05', to: '2026-11-05', start: '오후 2:00', end: '16:30', fee: 300000, expenses: null, summary: '특강 요청 공문',
  parts: [{ file: '요청.png', kind: 'request' }],
};
t('외부활동(외부강의등 신고서, 2026-10-15) — 요청 공문에서 요청인·주제·장소·일시·사례금을 읽고, 시각은 24시간 HH:MM, 연락처는 숫자만, 총 시간은 시작·종료로 센다', () => {
  const { draft, notes } = fromRecord('outside', OUTSIDE_REC, { me: '김거화', files: ['요청.png'] });
  assert.deepEqual(pick(draft, ['org', 'representative', 'contact', 'contactTel', 'subject', 'place', 'from', 'to', 'start', 'end', 'hours', 'mins', 'fee', 'expenses', 'rank', 'monthCount', 'yearTotal', 'note']), {
    org: '부산대학교', representative: '', contact: '조선해양공학과(김철수)', contactTel: '0515101234', subject: 'MVDC 차단기 기술 특강', place: '부산대학교 공학관 301호',
    from: '2026-11-05', to: '2026-11-05', start: '14:00', end: '16:30', hours: 2, mins: 30, fee: 300000, expenses: null, rank: '', monthCount: null, yearTotal: null, note: '',
  });
  assert.deepEqual(notes, []);
  assert.deepEqual(draft.attach, [{ label: '요청 공문', files: ['요청.png'] }]);
  assert.deepEqual(fromRecord('outside', { ...OUTSIDE_REC, fee: null }).notes, ['사례금이 문서에 없습니다 — 받는 금액을 적어 주세요(없으면 0)']);
  const c = compose('outside', { ...draft, rank: '책임연구원', representative: '차정인', monthCount: 1, yearTotal: 500000 }, CTX);
  assert.equal(c.title, '외부강의등 신고서');
  assert.match(c.body, /^■ 신 고 자 : 김거화 · 연구본부 수소전기추진연구팀\n {4}직 {4}급 : 책임연구원\n■ 요 청 인 : 부산대학교 {2}\(대표자 차정인\)\n {4}담당부서\(담당자\) : 조선해양공학과\(김철수\) {2}☎ 0515101234\n/);
  assert.match(compose('outside', { ...draft, rank: '' }, CTX).body, /^■ 신 고 자 : 김거화 · 연구본부 수소전기추진연구팀\n {4}직 {4}급 : \[직급\]\n/, '직급이 비어도 신고자 줄은 남고 직급은 [직급] 으로');
  assert.match(c.body, /■ 일 {4}시 : 2026\. 11\. 5\. \(1일\) {2}14:00 ~ 16:30\n {4}총 시 간 : 2시간 30분\n■ 당월 누적 : 1회\n■ 사 례 금 : 총액 300,000원\n {4}당해 연도 사례금 누적 합계 : 500,000원\n\n※ 첨 부\n {4}1\. 요청 공문 1부\.  끝\.$/,
    '실비·비고가 비면 그 줄이 빠진다');
  assert.deepEqual(c.missing, []);
  assert.match(compose('outside', { ...draft, expenses: 50000, note: '11. 5.·11. 12. 두 차례' }, CTX).body, /교통비·숙박비·식비\(실비\) : 50,000원 별도\n[\s\S]*■ 비 {4}고 : 11\. 5\.·11\. 12\. 두 차례/);
});
t('외부활동 — 시각 읽기·총 시간(여러 날이면 날수를 곱함)·셈하는 칸(고친 칸은 둔다, 요청인은 빈 칸만)', () => {
  assert.deepEqual(['14:00', '9:30', '14시', '14시 30분', '오후 2:00', '2:00 PM', '오전 12:10', '25:00', '', null].map(timeOf), ['14:00', '09:30', '14:00', '14:30', '14:00', '14:00', '00:10', '', '', '']);
  assert.equal(minutesTotal({ start: '09:00', end: '18:00', from: '2026-11-05', to: '2026-11-06' }), 18 * 60);
  assert.equal(minutesTotal({ start: '16:00', end: '14:00' }), null, '종료가 앞서면 모른다');
  const hist = { yearTotal: 700000, monthCount: 2, rank: '책임연구원', representative: '차정인', contact: '공대(이)', contactTel: '051' };
  const base = { start: '14:00', end: '16:00', contact: '조선해양공학과(김철수)', representative: '', yearTotal: null, monthCount: null, rank: '', hours: null, mins: null };
  const got = outsideAuto(base, { hist });
  assert.deepEqual(pick(got.draft, ['hours', 'mins', 'yearTotal', 'monthCount', 'rank', 'representative', 'contact', 'contactTel']),
    { hours: 2, mins: null, yearTotal: 700000, monthCount: 2, rank: '책임연구원', representative: '차정인', contact: '조선해양공학과(김철수)', contactTel: '051' }, '읽은 담당부서는 그대로');
  assert.deepEqual(got.changed, ['hours', 'yearTotal', 'monthCount', 'rank', 'representative', 'contactTel']);
  const kept = outsideAuto({ ...base, hours: 5, yearTotal: 1 }, { touched: ['hours', 'yearTotal'], hist });
  assert.deepEqual([kept.draft.hours, kept.draft.yearTotal, kept.draft.monthCount], [5, 1, 2], '사용자가 고친 칸은 다시 셈하지 않는다');
  assert.deepEqual(outsideAuto(got.draft, { hist }).changed, [], '같으면 바꾼 것이 없다');
});
t('외부활동 — 신고서 칸마다 넣을 값(writePlan) — 숫자 칸은 숫자만, 날짜·시각은 피커 꼴, 쓰지 않는 수 칸은 0, 과제·합의 없이 담당 → 팀장, 보존 3년', () => {
  const draft = { ...fromRecord('outside', OUTSIDE_REC).draft, rank: '책임연구원', representative: '차정인', monthCount: 2, yearTotal: 700000 };
  const plan = writePlan('outside', { title: '외부강의등 신고서', body: '미리보기', draft, form: 'KR_Outside_Lecture_Report' }, CTX);
  assert.match(decodeURIComponent(plan.url), /DocumentView\.aspx\?FORMID=KR_Outside_Lecture_Report&DOCID=&/);
  assert.deepEqual(plan.values.draft, {
    rank: '책임연구원', org: '부산대학교', representative: '차정인', contact: '조선해양공학과(김철수)', contactTel: '0515101234', subject: 'MVDC 차단기 기술 특강',
    place: '부산대학교 공학관 301호', from: '2026-11-05', to: '2026-11-05', start: '2026-11-05 14:00', end: '2026-11-05 16:30', hours: '2', mins: '30',
    batchCount: '0', batchTime: '0', monthCount: '2', fee: '300000', feeAvg: '0', yearTotal: '700000', expenses: '0', expensesAvg: '0', note: '',
  });
  assert.deepEqual(pick(plan.values.names, ['contact', 'contactTel', 'yearTotal', 'note']), {
    contact: { name: '담당부서(담당자)', need: true }, contactTel: { name: '담당자 연락처', need: true }, yearTotal: { name: '당해 연도 사례금 누적 합계', need: true }, note: { name: '비고', need: false },
  });
  assert.deepEqual(plan.values.job, { name: '', code: '', lead: '' }, '과제를 넣지 않는다(신고서에 과제 칸이 없다)');
  assert.deepEqual([plan.line.approvers, plan.line.agree, plan.line.rank], [['노길태'], [], '팀장'], '과제책임자 합의 없이 담당 → 팀장(지난 신고서)');
  assert.deepEqual(pick(plan.setting, ['retention', 'retentionText', 'tag', 'docNo']), { retention: '36', retentionText: '3년', tag: '외부활동', docNo: '8100' });
  assert.equal(draftValue({ kind: 'date', from: ['to', 'from'] }, { from: '2026-11-05', to: '' }), '2026-11-05', '종료일이 비면 시작일');
  assert.equal(draftValue({ kind: 'time', from: 'start', on: 'from' }, { start: '14:00', from: '' }), '', '날짜가 없으면 시각도 넣지 않는다');
  assert.equal(draftValue({ kind: 'text', from: 'fee', digits: true }, { fee: null }), '', '사례금이 비면 비워 둬 상신 때 양식이 묻게 한다');
  assert.equal(draftValue({ kind: 'text', from: 'note' }, { note: '한 줄 — 끝' }), '한 줄 - 끝', '긴 줄표는 전자결재가 받는 꼴로');
});
t('외부활동 — 남은 것(신고서의 필수 칸 — 과제는 묻지 않는다)·사유 쓰기 없음·첨부 이름', () => {
  assert.deepEqual(needs('outside', blankDraft('outside'), { preset: PRESET, project: null, projects: [FULL] }),
    ['기관명', '대표자', '담당부서(담당자)', '담당자 연락처', '주제', '장소', '시작일', '시작 시간', '종료 시간', '총 시간', '사례금 총액', '직급', '당월 누적', '당해 연도 누적 합계']);
  const full = { org: 'o', representative: 'r', contact: 'c', contactTel: '1', subject: 's', place: 'p', from: '2026-11-05', start: '14:00', end: '16:00', hours: 2, fee: 0, rank: 'k', monthCount: 1, yearTotal: 0 };
  assert.deepEqual(needs('outside', full, { preset: PRESET, project: null, projects: [] }), [], '과제가 없어도 묻지 않고, 사례금 0 은 채운 것');
  assert.ok(!REASON_KEYS.outside && !TASKS['gongmunReason.outside'], '신고서에는 사유 칸이 없어 사유 쓰기도 없다');
  assert.deepEqual(approvalLine({ ...CTX, kind: 'outside' }).steps.map((s) => s.role), ['기안', '결재'], '과제를 넘겨도 합의는 없다');
  assert.deepEqual(attachList('outside', [{ file: 'a.png', kind: 'request' }, { file: 'b.png', kind: 'content' }], ['a.png', 'b.png']),
    [{ label: '요청 공문', files: ['a.png'] }, { label: '활동 자료', files: ['b.png'] }]);
  assert.equal(attachName('outside', { org: '부산대학교 조선해양공학과' }, '2026-10-08'), '요청공문_부산대학교조선해양공학과_2026-10-08.pdf');
});

console.log('구매의뢰(구매요청서 KR_Purchase_Order — 총무팀 수신, 2026-10-17 사용자 지정)');
{
  const ORDER_REC = {
    docType: 'quote', vendor: '(주)OO상사', gist: '', total: 5_500_000, targetType: '자산', quoteDate: '2026-10-10',
    items: [
      { name: '고전압 프로브', spec: '10kV · 100MHz', qty: 2, unit: '대', unitPrice: 2_500_000, amount: 5_000_000 },
      { name: '케이블', spec: '', qty: 1, unit: '식', unitPrice: 500_000, amount: 500_000 },
    ],
  };
  const ORDER_FORM = 'KR_Purchase_Order';
  const ACCOUNT = { ...FULL, account: '연구재료비' };
  t('읽은 견적서로 초안 — 구매처럼 품목 표·견적일·합계·품목 요지를 옮기고, 구매대상구분은 읽은 것, 예산유형은 국가수탁과제부터, 500만원 이상이면 비교견적서를 알린다(막지 않는다)', () => {
    const { draft, notes } = fromRecord('order', ORDER_REC, { me: '김거화', files: ['견적.png'] });
    assert.deepEqual(pick(draft, ['gist', 'vendor', 'total', 'targetType', 'budgetType', 'quoteDate', 'business', 'demandDate', 'place', 'feature', 'sourceDoc', 'attachNote']), {
      gist: '고전압 프로브 외 1건', vendor: '(주)OO상사', total: 5_500_000, targetType: '자산', budgetType: '국가수탁과제', quoteDate: '2026-10-10',
      business: '', demandDate: '', place: '', feature: '', sourceDoc: '', attachNote: '',
    });
    assert.deepEqual(draft.items.map((it) => it.name), ['고전압 프로브', '케이블']);
    assert.deepEqual(draft.attach, [{ label: '견적서', files: ['견적.png'] }]);
    assert.deepEqual(notes, ['구매 총액 500만원 이상 — 비교견적서(업체 2곳 이상)도 첨부하세요']);
    assert.deepEqual(fromRecord('order', { ...ORDER_REC, total: 4_999_999 }).notes, [], '500만원 미만은 알리지 않는다');
    assert.deepEqual(overLimit('order', draft), { over: false, unknown: false, limit: null, amount: 5_500_000 }, '한도는 없다');
    assert.equal(delegationOf('order', { total: 20_000_001 }).rank, '소장', '위임전결은 구매와 같이 연구비 집행(2천만원)');
    assert.equal(KINDS.order.title, '구매요청서');
    assert.deepEqual(FIELDS.order.filter((f) => f.open).map((f) => f.key),
      ['targetType', 'budgetType', 'business', 'demandDate', 'place', 'feature', 'subjectCode', 'subjectName', 'ioCode', 'ioName', 'budgetAmount', 'sourceDoc']);
  });
  t('orderAuto — 수요시기는 오늘+14일, 특기사항은 선행 품의가 있으면 그 승인에 따른 요청·없으면 "해당 없음", 계정과목명은 과제의 계정, 첨부자료 안내문구는 첨부 목록. 고친 칸은 둔다', () => {
    const base = fromRecord('order', ORDER_REC, { files: ['견적.png'] }).draft;
    const got = orderAuto(base, { project: ACCOUNT, today: '2026-10-17' });
    assert.deepEqual(got.changed, ['demandDate', 'feature', 'subjectName', 'attachNote']);
    assert.deepEqual(pick(got.draft, ['demandDate', 'feature', 'subjectName', 'attachNote']),
      { demandDate: '2026-10-31', feature: '해당 없음', subjectName: '연구재료비', attachNote: '1. 견적서 1부.' });
    assert.deepEqual(orderAuto(got.draft, { project: ACCOUNT, today: '2026-10-17' }).changed, [], '같으면 바꾼 것이 없다');
    const withDoc = orderAuto({ ...base, sourceDoc: 'HER-2026-000097', sourceTitle: '고전압 프로브 구매 품의' }, { today: '2026-12-25' });
    assert.equal(withDoc.draft.feature, '연구업무추진품의 HER-2026-000097(고전압 프로브 구매 품의) 승인에 따른 구매 요청');
    assert.equal(withDoc.draft.demandDate, '2027-01-08', '해를 넘겨도 14일 뒤');
    assert.equal(orderAuto({ ...base, sourceDoc: 'HER-2026-000097' }, {}).draft.feature, '연구업무추진품의 HER-2026-000097 승인에 따른 구매 요청', '제목이 없으면 번호만');
    assert.equal(orderAuto({ ...got.draft, sourceDoc: 'HER-2026-000097' }, { today: '2026-10-17' }).draft.feature,
      '연구업무추진품의 HER-2026-000097 승인에 따른 구매 요청', '이 함수가 쓴 특기사항은 손대지 않았으면 선행 품의를 따라간다');
    const kept = orderAuto({ ...base, feature: '내가 쓴 특기사항', attachNote: '내가 쓴 안내', subjectName: '', demandDate: '' },
      { project: ACCOUNT, today: '2026-10-17', touched: ['attachNote', 'subjectName'] });
    assert.deepEqual(kept.changed, ['demandDate']);
    assert.deepEqual(pick(kept.draft, ['feature', 'attachNote', 'subjectName']), { feature: '내가 쓴 특기사항', attachNote: '내가 쓴 안내', subjectName: '' }, '고친 칸은 두고, 비었어도 손댄 칸은 두며, 내가 쓴 특기사항은 따라가지 않는다');
    assert.equal(orderAuto(base, { today: '' }).draft.demandDate, '', '오늘을 모르면 수요시기는 비워 둔다');
    // 회계 I/O 와 회계 예산 스냅샷(R&D 탭의 회계 조회 — src/eacct.js, 2026-10-17)이 있으면 예산 내역 다섯 칸을 채운다 — 계정에 맞는 줄로, 빈 칸만.
    const acct = { year: '2026', at: '2026-10-17T10:00:00.000Z', io: '2145NR0124', ioName: '대용량 모듈러 멀티레벨 컨버터 기반 고압 드라이브 시제품 개발', dept: 'HER', deptName: '수소전기추진연구팀',
      rows: [{ code: '603010304', name: '수탁과제(국가)_연구활동비', base: 51500000, transfer: 0, budget: 51500000, actual: 29066990, pending: 0, available: 22433010 },
        { code: '603010311', name: '수탁과제(국가)_연구재료비', base: 31376000, transfer: -1000000, budget: 30376000, actual: 0, pending: 0, available: 31376000 }] };
    const ea = orderAuto(base, { project: { ...ACCOUNT, io: '2145NR0124', acct }, today: '2026-10-17' });
    assert.deepEqual(ea.changed, ['demandDate', 'feature', 'ioCode', 'ioName', 'subjectCode', 'subjectName', 'budgetAmount', 'attachNote']);
    assert.deepEqual(pick(ea.draft, ['subjectCode', 'subjectName', 'ioCode', 'ioName', 'budgetAmount']),
      { subjectCode: '603010311', subjectName: '수탁과제(국가)_연구재료비', ioCode: '2145NR0124', ioName: '대용량 모듈러 멀티레벨 컨버터 기반 고압 드라이브 시제품 개발', budgetAmount: 30376000 });
    const noAcct = orderAuto(base, { project: { ...FULL, account: '', io: '2145NR0124', acct }, today: '2026-10-17' });
    assert.deepEqual(pick(noAcct.draft, ['subjectCode', 'subjectName', 'ioCode', 'budgetAmount']), { subjectCode: '', subjectName: '', ioCode: '2145NR0124', budgetAmount: null }, '계정이 없으면 I/O 만');
    const mine = orderAuto({ ...base, subjectCode: '603010303', subjectName: '연구시설·장비비', budgetAmount: 1 }, { project: { ...ACCOUNT, io: '2145NR0124', acct }, today: '2026-10-17' });
    assert.deepEqual(pick(mine.draft, ['subjectCode', 'subjectName', 'budgetAmount', 'ioCode']), { subjectCode: '603010303', subjectName: '연구시설·장비비', budgetAmount: 1, ioCode: '2145NR0124' }, '적힌 칸은 둔다');
    assert.equal(orderAuto({ ...base, attach: [{ label: '견적서', files: ['a.png'] }, { label: '강의 내용', files: ['b.png'] }] }, {}).draft.attachNote, '1. 견적서 1부.\n2. 강의 내용 1부.');
    assert.equal(orderAuto({ ...base, attach: [] }, {}).draft.attachNote, '1. 견적서 1부.', '첨부 목록이 비면 견적서 한 줄');
  });
  t('orderFromPurchase — 구매 품의 초안에서 구매의뢰 초안으로: 품목 요지·구매처·합계·품목·견적일·첨부를 옮기고, 사업내용은 구매사유(용도를 붙여), 선행 품의는 공문 이력의 줄. 초안 키는 관문이 아는 것만', () => {
    const p = { ...fromRecord('purchase', { ...ORDER_REC, targetType: undefined }, { files: ['견적.png'] }).draft, reason: '시험 데이터 저장에 필요함', use: '시험용', account: '연구재료비' };
    const doc = { id: 'HER-2026-000097', title: '고전압 프로브 외 1건 구매 품의', form: 'KR_EA_Research_Task' };
    const o = orderFromPurchase(p, { me: '김거화', doc });
    const allowed = new Set([...FIELDS.order.map((f) => f.key), ...RECIPE.purposes.order.reads.map((r) => r.key), 'currency', 'attach']);
    assert.deepEqual(Object.keys(o).filter((k) => !allowed.has(k)), [], '구매의뢰 레시피의 fields ∪ reads ∪ { currency, attach } 밖의 키가 없다(실행 모드 관문)');
    assert.deepEqual(pick(o, ['gist', 'vendor', 'total', 'quoteDate', 'currency', 'business', 'sourceDoc', 'sourceTitle', 'targetType', 'budgetType', 'demandDate', 'feature', 'place']), {
      gist: '고전압 프로브 외 1건', vendor: '(주)OO상사', total: 5_500_000, quoteDate: '2026-10-10', currency: 'KRW',
      business: '시험 데이터 저장에 필요함 (용도: 시험용)', sourceDoc: 'HER-2026-000097', sourceTitle: '고전압 프로브 외 1건 구매 품의',
      targetType: 'PC류', budgetType: '국가수탁과제', demandDate: '', feature: '', place: '',
    });
    assert.deepEqual(o.items, p.items);
    assert.notEqual(o.items, p.items, '품목 표는 복사한다(구매 초안과 따로 고친다)');
    assert.notEqual(o.items[0], p.items[0]);
    assert.deepEqual(o.attach, p.attach);
    assert.notEqual(o.attach[0].files, p.attach[0].files);
    assert.ok(!('reason' in o) && !('use' in o) && !('summary' in o) && !('account' in o), '구매만의 칸(구매사유·용도·요약·구매계정)은 넘어오지 않는다');
    assert.equal(orderFromPurchase({ ...p, use: '' }, { doc }).business, '시험 데이터 저장에 필요함', '용도가 없으면 사유만');
    const bare = orderFromPurchase(blankDraft('purchase'), { me: '김거화', doc: null });
    assert.deepEqual(pick(bare, ['gist', 'total', 'business', 'sourceDoc', 'sourceTitle', 'currency']), { gist: '', total: null, business: '', sourceDoc: '', sourceTitle: '', currency: 'KRW' });
    assert.deepEqual(bare.attach, [{ label: '견적서', files: [] }], '빈 구매 초안이면 구매의뢰의 빈 초안과 같다');
    assert.deepEqual(orderFromPurchase(null, { doc: { id: ' HER-2026-000097 ' } }).sourceDoc, 'HER-2026-000097', '초안이 없어도 선행 품의만으로');
  });
  t('쓸 것(writePlan) — 구매요청서 칸마다 넣을 값: 체크 칸은 초안 값과 같은 것만 1, 날짜는 피커 꼴, 표는 품목 줄마다·평평한 칸으로 한 행(digits 는 쉼표 없는 수), 과제·합의 있음, 보존 3년·수신 총무팀', () => {
    const base = orderFromPurchase({ ...fromRecord('purchase', ORDER_REC, { files: ['견적.png'] }).draft, reason: '시험에 필요함' }, { me: '김거화', doc: { id: 'HER-2026-000097', title: '프로브 구매 품의' } });
    const draft = {
      ...orderAuto({ ...base, targetType: '자산' }, { project: ACCOUNT, today: '2026-10-17' }).draft,
      place: '한국선급 본부 3층 수소전기추진연구팀', subjectCode: '5210', ioCode: 'IO-8100', ioName: '수소전기추진연구팀', budgetAmount: 12_000_000,
    };
    const plan = writePlan('order', { title: '고전압 프로브 외 1건 구매 요청', body: '미리보기', draft, form: ORDER_FORM }, { ...CTX, project: ACCOUNT });
    assert.deepEqual([plan.form, plan.known, plan.anchor], [ORDER_FORM, true, '#ctl00_ContentPlaceHolder_Content_SaUpNeYong']);
    assert.match(decodeURIComponent(plan.url), /DocumentView\.aspx\?FORMID=KR_Purchase_Order&DOCID=&/);
    assert.ok(!plan.fields.body && !plan.fields.job, '본문 편집기·과제 칸이 없는 폼');
    assert.deepEqual(plan.values.draft, {
      targetPc: '', targetAsset: '1', targetService: '', targetSw: '', targetSupply: '', business: '시험에 필요함',
      budgetGeneral: '', budgetNational: '1', demandDate: '2026-10-31', place: '한국선급 본부 3층 수소전기추진연구팀',
      feature: '연구업무추진품의 HER-2026-000097(프로브 구매 품의) 승인에 따른 구매 요청', attachNote: '1. 견적서 1부.',
    });
    assert.deepEqual(pick(plan.values.names, ['targetPc', 'budgetNational', 'feature', 'attachNote']), {
      targetPc: { name: '구매대상구분', need: true }, budgetNational: { name: '예산유형', need: false }, feature: { name: '특기사항', need: true }, attachNote: { name: '첨부자료 안내문구', need: false },
    });
    assert.deepEqual(plan.rows, [
      {
        key: 'items', add: '#ctl00_ContentPlaceHolder_Content_LinkButton1',
        probe: "input[id^='ctl00_ContentPlaceHolder_Content_rptRequet_ctl'][id$='_txtItemName']", cell: '#ctl00_ContentPlaceHolder_Content_rptRequet_ctl{nn}_{cell}',
        rows: [
          { txtItemName: '고전압 프로브', txtFuncAndReq: '10kV · 100MHz', txtUnit: '대', txtCnt: '2', txtUnitCost: '2500000', txtEstimate: '5000000' },
          { txtItemName: '케이블', txtUnit: '식', txtCnt: '1', txtUnitCost: '500000', txtEstimate: '500000' },
        ],
      },
      {
        key: 'budget', add: '#ctl00_ContentPlaceHolder_Content_LinkButton2',
        probe: "input[id^='ctl00_ContentPlaceHolder_Content_rptRequetBudget_ctl'][id$='_txtSubjectCode']", cell: '#ctl00_ContentPlaceHolder_Content_rptRequetBudget_ctl{nn}_{cell}',
        rows: [{ txtSubjectCode: '5210', txtSubjectName: '연구재료비', txtDeptOrIoCode: 'IO-8100', txtDeptOrIoName: '수소전기추진연구팀', txtBudgetCost: '12000000' }],
      },
    ]);
    assert.deepEqual(plan.values.job, { name: ACCOUNT.name, code: ACCOUNT.code, lead: ACCOUNT.lead }, '과제는 고른다(작성기는 과제 칸이 없어 쓰지 않는다)');
    assert.deepEqual([plan.line.approvers, plan.line.agree, plan.line.refs, plan.line.rank], [['노길태'], ['박기도'], [], '팀장'], '참조자는 과제 YAML 의 구매의뢰 키가 없어 없음');
    assert.deepEqual(pick(plan.setting, ['profile', 'retention', 'retentionText', 'receiver', 'receiverValue', 'tag', 'docNo']),
      { profile: '구매요청', retention: '36', retentionText: '3년', receiver: '총무팀', receiverValue: '10820-,-(A13) General Affairs Team', tag: '차단기 과제', docNo: '8100' });
    assert.equal(settingText(plan.setting), '보존 3년 · Doc No. 8100 · 수신 총무팀 · 공개 결재선 · 키워드 차단기 과제');
    // 표 — 빈 초안이면 행이 없고(작성기가 단계를 건너뛴다), 셀이 모두 빈 줄은 빼며, 글 셀은 긴 줄표를 바꾸고 digits 는 쉼표·원을 뗀다.
    assert.deepEqual(writePlan('order', { draft: blankDraft('order'), form: ORDER_FORM }, CTX).rows.map((r) => [r.key, r.rows.length]), [['items', 0], ['budget', 0]]);
    const fm = RECIPE.forms[ORDER_FORM];
    assert.deepEqual(rowsPlan(fm, { items: [{ name: ' 프로브 — A ', qty: '1,000', amount: '1,000원' }, { name: '', spec: '' }], budgetAmount: '' }).map((r) => r.rows),
      [[{ txtItemName: '프로브 - A', txtCnt: '1000', txtEstimate: '1000' }], []]);
    assert.deepEqual(rowsPlan(RECIPE.forms.KR_EA_Research_Task, draft), [], '표가 없는 폼은 빈 목록');
    assert.deepEqual(writePlan('purchase', { title: 't', body: 'b', draft }, CTX).rows, []);
  });
  t('draftValue check — 초안 값(글이나 목록)이 on 과 같으면 1, 아니면 빈 글(작성기가 건드리지 않는다 = 체크 안 함)', () => {
    assert.equal(draftValue({ kind: 'check', from: 'targetType', on: '자산' }, { targetType: '자산' }), '1');
    assert.equal(draftValue({ kind: 'check', from: 'targetType', on: 'PC류' }, { targetType: '자산' }), '');
    assert.equal(draftValue({ kind: 'check', from: 'targetType', on: 'SW' }, { targetType: ['자산', ' SW '] }), '1', '목록이면 하나라도');
    assert.equal(draftValue({ kind: 'check', from: 'targetType', on: 'SW' }, { targetType: null }), '');
    assert.equal(draftValue({ kind: 'check', from: 'targetType', on: 'SW' }, {}), '');
  });
  t('문서설정 — 구매요청은 보존 3년·수신 총무팀이고 receiverValue 는 수신처 창의 부서 값·글(레시피 receivers), 내부결재·KRE 는 이름 그대로', () => {
    const s = docSettingOf('order', PRESET, {}, { project: FULL });
    assert.deepEqual(pick(s, ['profile', 'retention', 'receiver', 'receiverValue', 'docNo', 'scope', 'tag']),
      { profile: '구매요청', retention: '36', receiver: '총무팀', receiverValue: '10820-,-(A13) General Affairs Team', docNo: '8100', scope: '결재선', tag: '차단기 과제' });
    assert.equal(docSettingOf('purchase', PRESET).receiverValue, '내부결재-,-내부결재');
    assert.equal(docSettingOf('order', PRESET, { receiver: 'KRE' }).receiverValue, 'KRE-,-KRE', '이 공문에서 바꾼 수신처');
    assert.equal(docSettingOf('order', PRESET, { receiver: '없는곳' }).receiver, '총무팀', '모르는 수신처는 버린다');
    assert.ok(RECIPE.settings.options.receiver.includes('총무팀'));
  });
  t('구매요청서의 제목·본문(미리보기) — "{품목요지} 구매 요청", 구매대상구분·사업내용·수요시기·특기사항·예산 내역·구매 물품·합계·선행 품의·첨부', () => {
    const base = orderFromPurchase({ ...fromRecord('purchase', ORDER_REC, { files: ['견적.png'] }).draft, reason: '시험에 필요함' }, { doc: { id: 'HER-2026-000097', title: '프로브 구매 품의' } });
    const draft = { ...orderAuto(base, { project: ACCOUNT, today: '2026-10-17' }).draft, place: '본부 3층', subjectCode: '5210', budgetAmount: 12_000_000 };
    const c = compose('order', draft, { ...CTX, project: ACCOUNT });
    assert.equal(c.title, '고전압 프로브 외 1건 구매 요청');
    assert.deepEqual(c.missing, []);
    for (const line of ['■ 구매대상구분 : PC류', '■ 사업내용(목적 포함)\n    시험에 필요함', '■ 예산유형 : 국가수탁과제', '■ 수요시기(납품일) : 2026. 10. 31.', '■ 납품장소 : 본부 3층',
      '■ 특기사항 : 연구업무추진품의 HER-2026-000097(프로브 구매 품의) 승인에 따른 구매 요청', '    계정과목코드 : 5210\n    계정과목명 : 연구재료비\n    예산금액 : 12,000,000원',
      '    (1) 고전압 프로브\n        - 기능 및 요구사양 : 10kV · 100MHz\n        - 수량 : 2대\n        - 예상단가 : 2,500,000원\n        - 예상금액 : 5,000,000원', '    (2) 케이블\n        - 수량 : 1식',
      '■ 합계 : 5,500,000원 (VAT 포함)', '■ 구매처 : (주)OO상사', '■ 선행 품의 : HER-2026-000097\n    제목 : 프로브 구매 품의', '    1. 견적서 1부.', '※ 첨 부\n    1. 견적서 1부.  끝.']) {
      assert.ok(c.body.includes(line), `본문에 "${line}"\n---\n${c.body}`);
    }
    assert.ok(!/I\/O 코드/.test(c.body), '비운 예산 내역 줄은 빠진다');
  });
  t('남은 것 — 품목·합계·사업내용·수요시기·납품장소·특기사항(구매대상구분은 처음 값이 있다). 사유 쓰기는 사업내용 하나(gongmunReason.order)', () => {
    assert.deepEqual(needs('order', blankDraft('order'), { preset: PRESET, project: FULL, projects: [FULL] }), ['품목', '합계', '사업내용', '수요시기', '납품장소', '특기사항']);
    const full = { ...orderAuto(blankDraft('order'), { today: '2026-10-17' }).draft, gist: 'g', total: 1, business: 'b', place: 'p' };
    assert.deepEqual(needs('order', full, { preset: PRESET, project: FULL, projects: [FULL] }), []);
    assert.ok(TASKS['gongmun.order'] && TASKS['gongmunReason.order'], '읽기·사유 쓰기 작업');
    assert.match(reasonInput('order', { gist: '프로브', business: '지금 적힌 것' }, FULL), /^품의 종류: 구매요청서\n[\s\S]*품목 요지: 프로브\n지금 적힌 사업내용: 지금 적힌 것$/);
    assert.equal(applyReason('order', { business: '' }, { business: '과제에 필요함' }).business, '과제에 필요함');
    assert.equal(attachName('order', { vendor: '(주)OO상사' }, '2026-10-17'), '견적서_(주)OO상사_2026-10-17.pdf');
  });
  t('작성 차례 — 표(품목·예산)는 새 공문 창 바로 뒤, 제목·칸보다 먼저(행추가 포스트백이 틀을 다시 그린다)', () => {
    assert.deepEqual(STEPS.map((s) => s.key), ['open', 'rows', 'job', 'fields', 'report', 'body', 'setting', 'line', 'attach']);
    assert.equal(STEPS.find((s) => s.key === 'rows').label, '표(품목·예산)');
  });
  await ta('페이지 함수 pageForm check — 꺼진 체크박스는 click 으로 켜고(change 이벤트까지 난다), 켜진 것은 두 번 눌러 끄지 않으며, 없는 칸은 why', async () => {
    await withDom('<input type="checkbox" id="c0"><input type="checkbox" id="c1" checked><input id="t">', async (w) => {
      const events = [];
      for (const id of ['c0', 'c1']) for (const type of ['click', 'change']) w.document.getElementById(id).addEventListener(type, () => events.push(`${id}:${type}`));
      const got = page.pageForm([
        { key: 'a', kind: 'check', selector: '#c0', value: '1' }, { key: 'b', kind: 'check', selector: '#c1', value: '1' },
        { key: 'x', kind: 'check', selector: '#nope', value: '1' }, { key: 't', kind: 'text', selector: '#t', value: '글 — 끝' },
      ]);
      assert.deepEqual(got, [{ key: 'a', ok: true, value: '1' }, { key: 'b', ok: true, value: '1' }, { key: 'x', ok: false, why: '칸이 없습니다' }, { key: 't', ok: true, value: '글 — 끝' }]);
      assert.deepEqual([w.document.getElementById('c0').checked, w.document.getElementById('c1').checked], [true, true]);
      assert.deepEqual(events, ['c0:click', 'c0:change'], '켜진 체크는 건드리지 않는다');
    });
  });
  await ta('페이지 함수 pageRows — count 는 probe 로 센 행 수, add 는 행추가 단추(javascript:__doPostBack 인 a)를 눌러 포스트백을 돌린다', async () => {
    const row = (n) => `<input id="ctl00_ContentPlaceHolder_Content_rptRequet_ctl${String(n).padStart(2, '0')}_txtItemName">`;
    const spec = { add: '#ctl00_ContentPlaceHolder_Content_LinkButton1', probe: "input[id^='ctl00_ContentPlaceHolder_Content_rptRequet_ctl'][id$='_txtItemName']" };
    const html = `<a id="ctl00_ContentPlaceHolder_Content_LinkButton1" href="javascript:__doPostBack('ctl00$ContentPlaceHolder_Content$LinkButton1','')">행추가</a><div id="rows">${row(1)}</div>`;
    await withDom(html, async (w) => {
      const calls = [];
      w.__doPostBack = (target, arg) => { calls.push([target, arg]); w.document.getElementById('rows').insertAdjacentHTML('beforeend', row(calls.length + 1)); };
      assert.deepEqual(page.pageRows('count', spec), { ready: true, count: 1 }, '처음부터 빈 행 1개');
      assert.deepEqual(page.pageRows('add', spec), { ok: true });
      const t0 = Date.now();
      while (page.pageRows('count', spec).count < 2 && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(calls, [['ctl00$ContentPlaceHolder_Content$LinkButton1', '']], '클릭의 기본 동작이 href 의 __doPostBack 을 부른다');
      assert.deepEqual(page.pageRows('count', spec), { ready: true, count: 2 });
      assert.deepEqual(page.pageRows('add', { ...spec, add: '#nope' }), { ok: false, why: '행추가 단추가 없습니다' });
      assert.deepEqual(page.pageRows('x', spec), { ok: false, why: '모르는 동작 x' });
      // 셀은 글 칸처럼 — cell 틀의 {nn}(두 자리)·{cell} 을 채운 selector.
      const put = page.pageForm([{ key: 'items.2.txtItemName', kind: 'text', selector: '#ctl00_ContentPlaceHolder_Content_rptRequet_ctl02_txtItemName', value: '케이블' }]);
      assert.deepEqual(put, [{ key: 'items.2.txtItemName', ok: true, value: '케이블' }]);
    }, { scripts: true });
  });
}
t('구매 — 제목은 그대로, 본문은 교육·출장처럼 가. 과제 개요부터(원본은 과제 개요를 빼는 lean 목적이었다 — 2026-10-16 사용자 지정으로 넣음)', () => {
  assert.equal(DEFAULT_TEMPLATES.purchase.title, '{품목요지} 구매 품의');
  const block = (kind) => DEFAULT_TEMPLATES[kind].body.split('\n').filter((l) => /과제 개요$|과 제 명|과제번호|연구기간|과제책임자/.test(l));
  assert.deepEqual(block('purchase'), block('edu'), '과제 개요 다섯 줄은 교육과 같다');
  assert.deepEqual(block('purchase'), block('trip'), '출장과도 같다');
});
t('남은 것 — 과제·부서장·합의자·용도·구매사유', () => {
  assert.deepEqual(needs('purchase', blankDraft('purchase'), { preset: {}, project: null, projects: [] }),
    ['과제 등록(R&D 탭)', '부서장(공문 설정)', '부서(공문 설정)', '품목', '합계', '용도', '구매사유']);
  assert.deepEqual(needs('purchase', { gist: 'x', total: 1, use: 'u', reason: 'r' }, { preset: PRESET, project: { name: 'p' }, projects: [{ name: 'p' }] }), ['합의자(과제책임자)']);
});
t('남은 것 — 교육·출장은 제목에 쓸 과제 별명(구매는 묻지 않는다)', () => {
  const edu = { course: 'c', from: '2026-10-12', fee: 1, purpose: 'p', reason: 'r' };
  assert.deepEqual(needs('edu', edu, { preset: PRESET, project: PROJECT, projects: [PROJECT] }), ['과제 별명(공문 설정 — 제목)']);
  assert.deepEqual(needs('edu', edu, { preset: PRESET, project: FULL, projects: [FULL] }), []);
  assert.deepEqual(needs('trip', blankDraft('trip'), { preset: PRESET, project: FULL, projects: [FULL] }), ['출장지', '출장기간', '예상경비', '출장목적', '출장사유']);
  assert.deepEqual(needs('trip', { place: '부산', from: '2026-10-20', cost: 1, purpose: 'p', reason: 'r' }, { preset: PRESET, project: FULL, projects: [FULL] }), []);
});
t('편집기에 넣을 HTML — 줄마다 div, 들여쓰기는 &nbsp;, 빈 줄은 <br>, 아 래 줄은 가운데(SetHTMLBody 로 저장까지 남은 꼴)', () => {
  const html = bodyHtml('가. 구매\n    (1) A\n\n------------ 아   래 ------------\n<b>');
  assert.equal(html, '<div>가. 구매</div><div>&nbsp;&nbsp;&nbsp;&nbsp;(1) A</div><div><br></div>'
    + '<div style="text-align:center;">------------ 아   래 ------------</div><div>&lt;b&gt;</div>');
});
t('새 공문 주소는 loginbyname 을 거친다 — 이상한 양식 ID 는 기본 양식으로', () => {
  const doc = '/RealEANet/Main/DocumentView.aspx?FORMID=KR_EA_Form2&DOCID=&GROUPID=0&MDTID=0&DID=0&ISMODIFY=0&OLDDOC=&ATTYN=0&ALERTMAIL=0&DOCCNT=0&EXEMTD=RETMTD&ACTYPE=0';
  assert.equal(draftUrl('KR_EA_Form2'), `https://eclass.krs.co.kr/RealEANET/loginbyname.aspx?ReturnUrl=${encodeURIComponent(doc)}`);
  assert.match(decodeURIComponent(draftUrl('x"><script>')), /FORMID=KR_EA_Research_Task&/);
});
t('첨부 파일 이름', () => {
  assert.equal(attachName('purchase', { vendor: '(주) OO상사' }, '2026-10-07'), '견적서_(주)OO상사_2026-10-07.pdf');
  assert.equal(attachName('edu', { provider: '' }, '2026-10-07'), '교육견적서_2026-10-07.pdf');
  assert.equal(attachName('edu', { provider: '한국교육원' }, '2026-10-07', '교육 내용'), '교육내용_한국교육원_2026-10-07.pdf');
  assert.equal(attachName('trip', { place: '대전 (한국기계연구원)' }, '2026-10-20'), '행사안내문_대전(한국기계연구원)_2026-10-20.pdf');
});
t('작은 도우미', () => {
  assert.equal(moneyOf('1,239,000원'), 1239000);
  assert.equal(moneyOf('abc'), null);
  assert.equal(won(989000), '989,000원');
  assert.equal(dotDate('2026-10-07'), '2026. 10. 7.');
  assert.deepEqual(namesOf('홍길동, 이몽룡·홍길동\n성춘향'), ['홍길동', '이몽룡', '성춘향']);
});

console.log('첨부 — 교육 견적서와 교육 내용');
t('읽은 파일을 문서 종류로 묶는다 — 교육이면 교육 견적서·교육 내용이 한 줄씩', () => {
  const parts = [{ file: 'a.png', kind: 'quote' }, { file: 'b.png', kind: 'content' }, { file: 'c.png', kind: 'content' }];
  assert.deepEqual(attachList('edu', parts, ['a.png', 'b.png', 'c.png']), [
    { label: '교육 견적서', files: ['a.png'] }, { label: '교육 내용', files: ['b.png', 'c.png'] },
  ]);
  assert.deepEqual(attachList('purchase', [], ['x.pdf']), [{ label: '견적서', files: ['x.pdf'] }], '종류를 모르면 갈래의 기본 문서');
  assert.deepEqual(attachList('edu'), [{ label: '교육 견적서', files: [] }, { label: '교육 내용', files: [] }], '교육은 꼭 드는 두 문서');
  assert.deepEqual(attachList('purchase'), [{ label: '견적서', files: [] }]);
});
t('교육의 첨부는 교육 견적서·교육 내용 둘 — 안내문·강의 소개·그 밖의 장은 교육 내용, 청구서·결제 화면은 교육 견적서이고 늘 그 차례', () => {
  const parts = [{ file: '안내.png', kind: 'course' }, { file: '기타.png', kind: 'other' }, { file: '결제.png', kind: 'order' }, { file: '청구.pdf', kind: 'statement' }];
  assert.deepEqual(attachList('edu', parts, ['안내.png', '기타.png', '결제.png', '청구.pdf']), [
    { label: '교육 견적서', files: ['결제.png', '청구.pdf'] }, { label: '교육 내용', files: ['안내.png', '기타.png'] },
  ]);
  assert.deepEqual(attachList('edu', [{ file: '안내.png', kind: 'course' }], ['안내.png']), [
    { label: '교육 견적서', files: [] }, { label: '교육 내용', files: ['안내.png'] },
  ], '안내문만 읽었어도 교육 견적서 줄이 앞에 선다');
});
t('빠진 첨부 — 교육 안내문만 넣었으면 교육 견적서가 남은 것이 되고, 넣는 곳은 견적서를 넣으라고 한다', () => {
  const only = attachList('edu', [{ file: '안내.png', kind: 'course' }], ['안내.png']);
  assert.deepEqual(missingDocs('edu', only).map((d) => d.label), ['교육 견적서']);
  assert.equal(moreLead('edu', only), '교육 견적서(수강료 화면) 더 넣기');
  const quote = attachList('edu', [{ file: '견적.pdf', kind: 'quote' }], ['견적.pdf']);
  assert.equal(moreLead('edu', quote), '교육 내용(커리큘럼) 캡처 더 넣기');
  const both = attachList('edu', [{ file: '견적.pdf', kind: 'quote' }, { file: '커리큘럼.png', kind: 'content' }], ['견적.pdf', '커리큘럼.png']);
  assert.deepEqual(missingDocs('edu', both), []);
  assert.equal(moreLead('edu', both), KINDS.edu.more);
  assert.deepEqual(missingDocs('edu', attachList('edu')), [], '파일을 넣지 않았으면(손으로 쓰기·글 붙여넣기) 짚지 않는다');
  assert.deepEqual(missingDocs('purchase', attachList('purchase', [], ['x.png'])), [], '구매는 꼭 드는 문서가 없다');
  assert.equal(moreLead('purchase', []), KINDS.purchase.more);
  const draft = { course: 'c', from: '2026-10-12', fee: 1, purpose: 'p', reason: 'r', attach: only };
  assert.deepEqual(needs('edu', draft, { preset: PRESET, project: FULL, projects: [FULL] }), ['교육 견적서(첨부)']);
});
t('교육 — 온라인 강의 페이지에서 수강료 칸을 오리면 그것이 교육 견적서, 페이지 장은 교육 내용으로 남는다', () => {
  const tiles = ['인프런_1.png', '인프런_2.png', '인프런_3.png'];
  const parts = [{ file: tiles[0], kind: 'course' }, { file: tiles[1], kind: 'other' }, { file: tiles[2], kind: 'order' }];
  const cut = { name: '견적서_가격부분.png', drop: [tiles[2]], on: true };
  const { draft } = fromRecord('edu', { docType: 'course', course: '웹 해킹 입문', fee: 77000, parts }, { files: tiles, cut });
  assert.deepEqual(draft.attach, [{ label: '교육 견적서', files: ['견적서_가격부분.png'] }, { label: '교육 내용', files: tiles.slice(0, 2) }]);
  assert.match(compose('edu', draft, CTX).body, /※ 첨 부\n {4}1\. 교육 견적서 1부\.\n {4}2\. 교육 내용 1부\.  끝\.$/);
  assert.deepEqual(attachWithCut('edu', parts, tiles, { ...cut, on: false }), [
    { label: '교육 견적서', files: [tiles[2]] }, { label: '교육 내용', files: tiles.slice(0, 2) },
  ], '원래 장으로 — 결제 화면 장이 교육 견적서');
});
t('첨부 줄 — 마지막 줄에만 끝.', () => {
  assert.equal(attachBlock([{ label: '교육 견적서' }, { label: '교육 내용' }]), '    1. 교육 견적서 1부.\n    2. 교육 내용 1부.  끝.');
});
t('교육 — 견적서와 교육 내용을 함께 읽으면 교육내용 줄과 첨부 두 줄이 들어간다', () => {
  const { draft } = fromRecord('edu', {
    course: '전력변환 설계 실무', provider: '교육원', from: '2026-10-12', fee: 450000, topics: 'DC-DC 컨버터 · 제어 루프 설계',
    parts: [{ file: '견적.png', kind: 'quote' }, { file: '커리큘럼.png', kind: 'content' }],
  }, { me: '김거화', files: ['견적.png', '커리큘럼.png'] });
  const body = compose('edu', draft, CTX).body;
  assert.match(body, /교육내용 : DC-DC 컨버터 · 제어 루프 설계/);
  assert.match(body, /※ 첨 부\n {4}1\. 교육 견적서 1부\.\n {4}2\. 교육 내용 1부\.  끝\.$/);
});
t('{차례} 는 남은 줄끼리 가·나·다', () => {
  assert.equal(fillTemplate('{차례}. A\n{차례}. B {x?}\n{차례}. C', { x: '' }).text, '가. A\n나. C');
});
t('{세부차례} 는 (1)(2)… — {차례} 줄마다 새로 세고, 빠진 줄은 건너뛴다', () => {
  const tpl = '{차례}. A\n    {세부차례} a\n    {세부차례} b {x?}\n    {세부차례} c\n{차례}. B\n    {세부차례} d';
  assert.equal(fillTemplate(tpl, { x: '' }).text, '가. A\n    (1) a\n    (2) c\n나. B\n    (1) d');
});
t('다시 읽어도 — 교육 구분은 손대지 않았으면 (고친) 교육장소를 따라가고, 고쳤으면 둔다', () => {
  const prev = { place: '온라인', mode: '교육' };
  const next = { place: '', mode: '교육' };
  assert.equal(mergeDraft(prev, next, ['place']).mode, '온라인교육');
  assert.equal(mergeDraft(prev, next, ['place', 'mode']).mode, '교육');
});
t('더 넣어 다시 읽으면 — 고친 칸과 새로 읽지 못한 칸은 두고, 첨부는 새 목록', () => {
  const prev = { course: '내가 고친 교육명', provider: '교육원', reason: '써 둔 사유', attendees: '김거화, 홍길동', attach: [{ label: '교육 견적서', files: ['a'] }] };
  const next = { course: '읽은 교육명', provider: '', reason: '', attendees: '김거화', topics: '새로 읽은 내용', attach: [{ label: '교육 견적서', files: ['a'] }, { label: '교육 내용', files: ['b'] }] };
  const out = mergeDraft(prev, next, ['course', 'attendees']);
  assert.equal(out.course, '내가 고친 교육명');
  assert.equal(out.attendees, '김거화, 홍길동');
  assert.equal(out.provider, '교육원', '새로 읽은 값이 비면 쓰던 값');
  assert.equal(out.reason, '써 둔 사유');
  assert.equal(out.topics, '새로 읽은 내용');
  assert.equal(out.attach.length, 2);
});

console.log('과제 내용으로 사유 쓰기');
t('사유 칸 — 구매는 구매사유·용도, 교육은 교육사유·교육목적, 출장은 출장사유·출장목적, 수당은 지급 사유·지급 목적, 자문은 자문 사유·자문 목적, 구매의뢰는 사업내용 하나. 외부활동(외부강의등 신고서)은 사유 칸이 없다', () => {
  assert.deepEqual(REASON_KEYS, {
    purchase: { reason: 'reason', use: 'use' }, edu: { reason: 'reason', use: 'purpose' }, trip: { reason: 'reason', use: 'purpose' },
    allowance: { reason: 'reason', use: 'purpose' }, consult: { reason: 'reason', use: 'purpose' }, order: { reason: 'business', use: undefined },
  });
  assert.deepEqual(REASON_LABEL, { purchase: '구매사유', edu: '교육사유', trip: '출장사유', allowance: '지급 사유', consult: '자문 사유', order: '사업내용 (목적 포함)' });
});
t('Claude 에 주는 글에 과제 내용과 품의할 것이 들어가고, 금액·업체는 없다', () => {
  const text = reasonInput('purchase', { items: [{ name: '34인치 모니터', spec: 'WQHD', qty: 1, unit: '대', amount: 890000 }], vendor: 'OO상사', use: '회의용' },
    { ...PROJECT, content: 'MVDC 차단기 시험·평가 체계 구축' });
  assert.match(text, /^품의 종류: 구매품의\n과제명: MW급/);
  assert.match(text, /과제 내용:\n<<<\nMVDC 차단기 시험·평가 체계 구축\n>>>/);
  // 품의할 것은 레시피 purchase/purpose.yaml 의 writing.context — 틀과 같은 꼴로 품목마다 사양·수량을 적는다.
  assert.match(text, /품의할 것:\n품목: 34인치 모니터\n {2}사양: WQHD\n {2}수량: 1대\n/);
  assert.match(text, /지금 적힌 용도: 회의용/);
  assert.ok(!/890|OO상사/.test(text));
  assert.match(reasonInput('edu', { course: '전력변환 설계', topics: 'DC-DC' }, null), /과제명: \(없음\)[\s\S]*교육 내용: DC-DC/);
  const trip = reasonInput('trip', { place: '부산', from: '2026-10-20', to: '2026-10-21', purpose: '실증 시험 참관', reason: '필요함', cost: 300000 }, null, { ask: '더 짧게' });
  assert.match(trip, /품의 종류: 출장품의[\s\S]*출장지: 부산\n출장기간: 2026\. 10\. 20\. ~ 2026\. 10\. 21\. \(2일\)\n지금 적힌 출장목적: 실증 시험 참관\n지금 적힌 출장사유: 필요함\n사용자의 말:/);
  assert.ok(!/300/.test(trip), '예상경비는 넣지 않는다');
});
t('써 온 사유는 넣고, 용도는 사용자가 고쳤으면 둔다', () => {
  const data = { reason: ' 과제의 시험 데이터 검토에 필요함 ', use: '시험 데이터 검토용' };
  assert.deepEqual(applyReason('purchase', { reason: '', use: '' }, data), { reason: '과제의 시험 데이터 검토에 필요함', use: '시험 데이터 검토용' });
  assert.equal(applyReason('purchase', { use: '내가 쓴 용도' }, data, { touched: ['use'] }).use, '내가 쓴 용도');
  // 답의 키는 초안 칸의 key 다 — 교육은 교육목적 칸(purpose)으로 답한다.
  assert.equal(applyReason('edu', { purpose: '' }, { reason: data.reason, purpose: '시험 데이터 검토 역량 강화' }).purpose, '시험 데이터 검토 역량 강화');
  assert.equal(applyReason('edu', { purpose: '' }, data).purpose, '', '다른 갈래의 키(use)는 넣지 않는다');
});

console.log('공문 설정');
t('과제는 이름이 있는 것만, R&D 탭과 같은 열 개까지(처음의 다섯 개는 풀었다 — 연장·겹치는 과제)', () => {
  assert.equal(MAX_PROJECTS, 10);
  const list = normalizeProjects([{ name: '' }, ...Array.from({ length: MAX_PROJECTS + 2 }, (_, i) => ({ name: `과제${i}`, about: '개요.', content: ' 연구내용 ' }))]);
  assert.equal(list.length, MAX_PROJECTS);
  assert.equal(list[0].content, '연구내용', '과제 내용도 담는다');
  assert.equal(list[0].about, '개요', '끝의 마침표는 틀이 붙인다');
  const [one] = normalizeProjects([{ name: '과제', alias: ' 차단기 과제 ', period: '2026.04.01 ~ 2029.12.31' }]);
  assert.deepEqual([one.alias, one.period], ['차단기 과제', '2026.04.01 ~ 2029.12.31'], '별명·연구기간도 담는다');
  assert.deepEqual(normalizePreset({ refs: '가, 나' }), { dept: '', head: '', director: '', chief: '', docNo: '' }, '공문 설정에 참조자는 없다 — 옛 저장분의 refs 는 버린다(2026-10-15)');
  assert.equal(normalizePreset({ docNo: ' (8100) ' }).docNo, '8100', '문서번호 부서는 숫자만');
});
t('채팅 — 과제 목록 표(머리글 줄은 건너뛴다)·부서장을 규칙으로 읽고, 참조 줄은 받지 않고 넘긴다(참조자는 과제 YAML — 2026-10-15)', () => {
  const { patch, reply } = parseSetupLocal(`과제명\t과제번호\t책임자\n${PROJECT.name}\tRND-20-2026\t박기도 책임\n선박용 수소 엔진-연료전지 하이브리드 추진 시스템 | RND-21-2026 | 김거화 수석\n부서장: 노길태 팀장\n참조 홍길동, 이몽룡 선임`);
  assert.deepEqual(patch.projects, [
    { name: PROJECT.name, code: 'RND-20-2026', lead: '박기도' },
    { name: '선박용 수소 엔진-연료전지 하이브리드 추진 시스템', code: 'RND-21-2026', lead: '김거화' },
  ], '참조 줄이 과제가 되지 않는다');
  assert.equal(patch.head, '노길태');
  assert.ok(!('refs' in patch));
  assert.match(reply, /^과제 2개와 합의자 · 부서장를 채웠습니다\. 참조자는 공문 설정이 아니라 과제 YAML\(공문\.참조자\)에 공문 종류별로 적습니다 — 넘겼습니다\.$/);
  assert.deepEqual(parseSetupLocal('참조자: 홍길동'), { patch: {}, reply: '참조자는 공문 설정이 아니라 과제 YAML(공문.참조자)에 공문 종류별로 적습니다 — 넘겼습니다.' });
});
t('채팅 — 과제 줄 뒤의 "내용:"·"개요:" 는 그 과제에, 과제 없이 내용만이면 지금 고른 과제 몫', () => {
  const { patch } = parseSetupLocal('과제: MMC 기반 전력변환 기술 개발, 책임자 박기도\n내용: 모듈형 멀티레벨 컨버터 설계\n연구목표: 효율 98%\n개요: MMC 전력변환 기술 개발을 수행하고 있습니다');
  assert.deepEqual(patch.projects, [{ name: 'MMC 기반 전력변환 기술 개발', lead: '박기도', content: '모듈형 멀티레벨 컨버터 설계\n효율 98%', about: 'MMC 전력변환 기술 개발을 수행하고 있습니다' }]);
  assert.deepEqual(parseSetupLocal('연구내용: 차단기 시험').patch, { content: '차단기 시험' });
  const res = mergeSetup([{ name: '과제A' }], {}, { content: '차단기 시험' }, { current: '과제A' });
  assert.equal(res.rows[0].content, '차단기 시험');
  assert.match(mergeSetup([{ name: '과제A' }], {}, { content: 'x' }).skipped[0], /과제 내용\(어느 과제인지/);
});
t('채팅 — 과제 줄 뒤의 "별명:"·"기간:" 은 그 과제에, 과제 없이 적으면 지금 고른 과제 몫', () => {
  const { patch, reply } = parseSetupLocal('과제: MMC 기반 전력변환 기술 개발, 책임자 박기도\n별명: MMC 과제\n연구기간: 2026.04.01 ~ 2029.12.31');
  assert.deepEqual(patch.projects, [{ name: 'MMC 기반 전력변환 기술 개발', lead: '박기도', alias: 'MMC 과제', period: '2026.04.01 ~ 2029.12.31' }]);
  assert.match(reply, /과제 1개와 합의자/);
  assert.deepEqual(parseSetupLocal('약칭: 차단기 과제').patch, { alias: '차단기 과제' });
  assert.deepEqual(parseSetupLocal('기간 = 2026.04 ~ 2029.12').patch, { period: '2026.04 ~ 2029.12' });
  const res = mergeSetup([{ name: '과제A' }], {}, { alias: '차단기 과제', period: '2026.04 ~ 2029.12' }, { current: '과제A' });
  assert.deepEqual([res.rows[0].alias, res.rows[0].period], ['차단기 과제', '2026.04 ~ 2029.12']);
  assert.deepEqual(res.done, ['과제 별명 차단기 과제 — 과제A', '연구기간 — 과제A']);
  assert.match(mergeSetup([{ name: '과제A' }], {}, { alias: 'x' }).skipped[0], /과제 별명 x\(어느 과제인지/);
  const named = mergeSetup([], {}, { projects: [{ name: '과제B', alias: 'B 과제', period: '2026' }] });
  assert.deepEqual([named.rows[0].alias, named.rows[0].period], ['B 과제', '2026']);
  assert.match(named.done[0], /과제 등록 — 과제B · 별명 B 과제 · 연구기간/);
});
t('채팅 — "과제: …, 책임자 ○○○" 문장과, 과제 없이 "합의자 ○○○"', () => {
  assert.deepEqual(parseSetupLocal('과제: MMC 기반 전력변환 기술 개발, 책임자 박기도').patch, { projects: [{ name: 'MMC 기반 전력변환 기술 개발', lead: '박기도' }] });
  assert.deepEqual(parseSetupLocal('합의자 박기도 책임').patch, { lead: '박기도' });
  assert.deepEqual(parseSetupLocal('안녕하세요').patch, {});
});
t('얹기 — 이름·번호가 같은 과제는 고치고, 빈 줄을 먼저 채우고, 한도(열 개)를 넘으면 뺀다', () => {
  const rows = [{ name: PROJECT.name, code: '', lead: '' }, { name: '' }];
  const res = mergeSetup(rows, { head: '옛 부서장' }, {
    projects: [{ name: PROJECT.name, lead: '박기도 책임' }, { name: '새 과제 A', code: 'RND-1' }, { name: '새 과제 B' }],
    head: '노길태', refs: '홍길동',
  });
  assert.deepEqual(res.rows.map((r) => [r.name, r.lead]), [[PROJECT.name, '박기도'], ['새 과제 A', ''], ['새 과제 B', '']]);
  assert.deepEqual(res.preset, { dept: '', head: '노길태', director: '', chief: '', docNo: '' }, '참조자는 공문 설정에 얹지 않는다');
  assert.deepEqual(res.skipped, ['참조자(공문 설정이 아니라 과제 YAML 의 공문.참조자에 공문 종류별로 적습니다)']);
  assert.ok(!res.done.some((d) => /참조자/.test(d)));
  const five = Array.from({ length: 5 }, (_, i) => ({ name: `과제${i}`, code: `C${i}` }));
  assert.deepEqual(mergeSetup(five, {}, { projects: [{ name: '여섯째' }] }).rows.at(-1).name, '여섯째', '다섯 개 넘게도 둔다(연장·겹치는 과제)');
  const full = Array.from({ length: MAX_PROJECTS }, (_, i) => ({ name: `과제${i}`, code: `C${i}` }));
  const over = mergeSetup(full, {}, { projects: [{ name: '열한째' }, { name: '다른이름', code: 'C2', lead: '박기도' }] });
  assert.deepEqual(over.skipped, ['열한째']);
  assert.equal(over.rows[2].lead, '박기도', '번호가 같으면 같은 과제');
  assert.equal(over.rows[2].name, '과제2', '이미 있는 과제 이름은 두고');
});
t('얹기 — 사람만 왔으면 지금 고른 과제의 합의자, 고른 과제가 없으면 넣지 못한다', () => {
  assert.equal(mergeSetup([{ name: '과제A' }], {}, { lead: '박기도' }, { current: '과제A' }).rows[0].lead, '박기도');
  assert.match(mergeSetup([{ name: '과제A' }], {}, { lead: '박기도' }).skipped[0], /어느 과제인지 모릅니다/);
});

console.log('입력 명세 — gongmun.<갈래>·gongmunSetup');
t('명세가 맞다(목록 형 포함)', () => assert.deepEqual(checkSpec({ tasks: TASKS }), []));
t('목록 안의 목록·줄 칸이 없는 목록은 생성기가 거부한다', () => {
  const broken = structuredClone({ tasks: TASKS });
  broken.tasks['gongmun.purchase'].fields.items.item.sub = { type: 'list', desc: '안', item: { a: { type: 'string', desc: 'a' } } };
  broken.tasks.gongmunSetup.fields.projects.item = {};
  const errors = checkSpec(broken).join('\n');
  assert.match(errors, /items\.sub: 목록 안에 목록을 둘 수 없습니다/);
  assert.match(errors, /projects: 목록은 줄의 칸\(item\)이 있어야 합니다/);
});
t('지시문에 목록의 줄 칸이 들여 적힌다', () => {
  const text = systemPrompt('gongmun.purchase');
  assert.match(text, /- items \(목록\(30줄까지\) — 줄마다 아래 키의 객체 또는 null\)/);
  assert.match(text, /\n {4}- name \(글, 필수\): 품목명/);
});
t('관문 — 품목명이 없는 줄은 빼고 알린다, 목록이 아니면 비운다', () => {
  const { data, notes } = structure('gongmun.purchase', { docType: 'quote', gist: '모니터', summary: '견적서', items: [{ name: 'A', qty: '2', amount: '1000' }, { qty: 1 }, 'x'], total: '1000' });
  assert.deepEqual(data.items, [{ name: 'A', spec: null, qty: 2, unit: null, unitPrice: null, amount: 1000 }]);
  assert.deepEqual(notes, ['품목 중 2줄은 받을 수 없어 뺐습니다']);
  assert.equal(structure('gongmun.purchase', { docType: 'quote', gist: 'g', summary: 's', items: 'A' }).data.items, null);
  assert.throws(() => structure('gongmun.purchase', { docType: 'quote', gist: 'g' }), InputError, '한 줄 요약(summary)은 꼭 있어야 한다');
});
t('공문 설정 조각은 부분 수정 — 말하지 않은 칸은 빠진다', () => {
  assert.deepEqual(structure('gongmunSetup', { projects: [{ name: '과제', lead: '박기도' }], head: null, reply: '채웠습니다' }).data,
    { projects: [{ name: '과제', code: null, lead: '박기도', alias: null, period: null, about: null, content: null }], reply: '채웠습니다' });
});
t('읽기는 파일마다 문서 종류(parts)를 돌려준다 — 모르는 종류의 줄은 뺀다', () => {
  const { data, notes } = structure('gongmun.edu', { docType: 'quote', course: 'c', summary: 's', parts: [{ file: 'a.png', kind: 'quote' }, { file: 'b.png', kind: 'menu' }] });
  assert.deepEqual(data.parts, [{ file: 'a.png', kind: 'quote' }]);
  assert.deepEqual(notes, ['파일 중 1줄은 받을 수 없어 뺐습니다']);
});
t('사유 쓰기의 답은 사유가 꼭 있어야 한다', () => {
  assert.deepEqual(structure('gongmunReason.purchase', { reason: '필요함', use: null }).data, { reason: '필요함', use: null, reply: null });
  assert.deepEqual(structure('gongmunReason.trip', { reason: '필요함', purpose: '학회 참석' }).data, { reason: '필요함', purpose: '학회 참석', reply: null });
  assert.throws(() => structure('gongmunReason.purchase', { use: 'x' }), InputError);
});
t('읽기 입력 — 파일이면 장 수와 이름, 글이면 글을 싸서 보낸다', () => {
  assert.equal(gongmunInput({ files: [{ name: 'a.png' }, { name: 'b.png' }] }, { kind: 'purchase', today: '2026-10-07' }),
    '품의 종류: 구매(견적서·거래명세서·쇼핑몰 주문 화면)\n오늘은 2026-10-07 입니다.\n첨부한 문서 2장(파일 이름: a.png, b.png)을 읽어 출력 키를 채웁니다.'
    + ' 여러 장은 같은 건의 문서들(여러 쪽, 또는 견적서와 교육 내용 등)이니 함께 보고, parts 에 파일마다 무슨 문서인지 적습니다.');
  assert.match(gongmunInput({ files: [{ name: 'a.png' }], text: '커리큘럼 1일차' }, { kind: 'edu' }), /파일 이름: a\.png[\s\S]*붙여 넣은 글도 함께 봅니다\.\n<<<\n커리큘럼 1일차\n>>>$/);
  assert.match(gongmunInput({ text: '모니터 1대 890,000원' }, { kind: 'edu' }), /^품의 종류: 교육[\s\S]*<<<\n모니터 1대 890,000원\n>>>$/);
});
console.log('웹페이지 캡처 묶음의 문서 종류 잇기 (spreadParts)');
t('읽기에 보내지 않은 뒷장은 같은 묶음에서 앞서 가린 종류를 이어 받는다 — 앞 장이 교육 내용이면 뒷장도', () => {
  const tiles = (n) => Array.from({ length: n }, (_, i) => ({ name: `화면캡처_inflearn.com_2026-10-08_${i + 1}.png`, group: 'cap1' }));
  const files = [{ name: '교육견적.png' }, ...tiles(7)];
  const parts = [{ file: '교육견적.png', kind: 'quote' }, { file: tiles(1)[0].name, kind: 'course' }, { file: tiles(2)[1].name, kind: 'content' }];
  const out = spreadParts(parts, files);
  assert.deepEqual(out.map((p) => `${p.file.replace(/^화면캡처_inflearn\.com_2026-10-08_/, 't')}:${p.kind}`),
    ['교육견적.png:quote', 't1.png:course', 't2.png:content', 't3.png:content', 't4.png:content', 't5.png:content', 't6.png:content', 't7.png:content']);
  const attach = attachList('edu', out, files.map((f) => f.name));
  assert.deepEqual(attach.map((a) => [a.label, a.files.length]), [['교육 견적서', 1], ['교육 내용', 7]]);
});
t('묶음이 아닌 파일과 가린 것이 없는 묶음은 그대로 둔다 — 갈래의 기본 문서가 된다', () => {
  assert.deepEqual(spreadParts([{ file: 'a.png', kind: 'quote' }], [{ name: 'a.png' }, { name: 'b.png' }]), [{ file: 'a.png', kind: 'quote' }]);
  assert.deepEqual(spreadParts(null, [{ name: 'x_1.png', group: 'g' }, { name: 'x_2.png', group: 'g' }]), []);
  assert.deepEqual(spreadParts([{ file: 'x_2.png', kind: 'content' }], [{ name: 'x_1.png', group: 'g' }, { name: 'x_2.png', group: 'g' }, { name: 'x_3.png', group: 'g' }]),
    [{ file: 'x_2.png', kind: 'content' }, { file: 'x_3.png', kind: 'content' }], '앞 장은 뒤의 것을 거꾸로 받지 않는다');
  assert.deepEqual(spreadParts([{ file: 'a', kind: 'quote' }, { bad: true }, { file: 'b' }], []), [{ file: 'a', kind: 'quote' }], '모양이 틀린 줄은 뺀다');
});

console.log('구매 — 가격 부분을 오린 견적서(attachWithCut)');
t('오린 견적서가 있으면 그것이 첫 줄 견적서이고, 오려 낸 화면의 장은 첨부에서 빠진다 — 따로 넣은 문서는 남는다', () => {
  const files = ['화면캡처_coupang.com_1.png', '화면캡처_coupang.com_2.png', '사양서.pdf'];
  const parts = [{ file: files[0], kind: 'order' }, { file: files[1], kind: 'order' }, { file: '사양서.pdf', kind: 'other' }];
  const cut = { name: '견적서_가격부분_2026-10-08.png', drop: files.slice(0, 2), on: true };
  assert.deepEqual(attachWithCut('purchase', parts, files, cut), [
    { label: '견적서', files: ['견적서_가격부분_2026-10-08.png'] }, { label: '참고 자료', files: ['사양서.pdf'] },
  ]);
  assert.deepEqual(attachWithCut('purchase', parts, files, { ...cut, on: false }), [
    { label: '주문 내역', files: files.slice(0, 2) }, { label: '참고 자료', files: ['사양서.pdf'] },
  ], '원래 장으로 — 넣은 파일 그대로');
  assert.deepEqual(attachWithCut('purchase', parts, files, null), attachList('purchase', parts, files));
});
t('초안의 첨부와 본문 ※ 첨부 — 쇼핑몰 화면 일곱 장이 견적서 한 줄이 된다', () => {
  const tiles = Array.from({ length: 7 }, (_, i) => `화면캡처_coupang.com_${i + 1}.png`);
  const rec = { docType: 'order', vendor: '쿠팡', gist: '34인치 모니터', total: 489000, parts: tiles.map((file) => ({ file, kind: 'order' })) };
  const { draft } = fromRecord('purchase', rec, { files: tiles, cut: { name: '견적서_가격부분.png', drop: tiles, on: true } });
  assert.deepEqual(draft.attach, [{ label: '견적서', files: ['견적서_가격부분.png'] }]);
  assert.match(compose('purchase', draft, CTX).body, /※ 첨 부\n {4}1\. 견적서 1부\.  끝\.$/);
});
t('읽기는 오릴 칸(quoteArea)을 그림마다 % 로 돌려준다 — 범위 밖·빠진 칸의 줄은 뺀다', () => {
  const { data, notes } = structure('gongmun.purchase', {
    docType: 'order', gist: 'g', summary: 's',
    quoteArea: [{ file: 'a.png', left: 5, top: 10, right: 95, bottom: 40 }, { file: 'b.png', left: -1, top: 0, right: 50, bottom: 50 }, { file: 'c.png', left: 0, top: 0 }],
  });
  assert.deepEqual(data.quoteArea, [{ file: 'a.png', left: 5, top: 10, right: 95, bottom: 40 }]);
  assert.deepEqual(notes, ['견적서로 오릴 칸 중 2줄은 받을 수 없어 뺐습니다']);
  // 오릴 칸은 레시피에 quote_crop 이 있는 갈래(구매·교육)에만 있고, 오린 칸에 꼭 들어갈 것(견적서의 필수 내용)이 지시문에 적힌다.
  assert.match(systemPrompt('gongmun.purchase'), /- quoteArea [^\n]*오린 칸에 꼭 들어갈 것: 상품명·모델·옵션·수량·단가·할인·배송비·합계·판매자\. 넣지 않을 것: 추천 상품/);
  assert.match(systemPrompt('gongmun.edu'), /오린 칸에 꼭 들어갈 것: 수강료\(정가·할인가·결제 금액\)·강의명/);
  assert.deepEqual(['trip', 'outside'].map((k) => 'quoteArea' in TASKS[`gongmun.${k}`].fields), [false, false]);
  assert.deepEqual(KIND_ORDER.filter((k) => KINDS[k].cut), ['purchase', 'edu', 'order'], '구매의뢰도 쇼핑몰 화면의 견적서를 오린다');
});

console.log('구매로 산 강의 — 견적서와 강의 내용');
t('강의 소개·커리큘럼(course·content)은 구매에서도 강의 내용으로 첨부된다 — 오린 견적서와 두 줄', () => {
  const files = ['인프런_1.png', '인프런_2.png', '인프런_3.png'];
  const parts = [{ file: files[0], kind: 'order' }, { file: files[1], kind: 'content' }, { file: files[2], kind: 'content' }];
  const cut = { name: '견적서_가격부분.png', drop: [files[0]], on: true };
  assert.deepEqual(attachWithCut('purchase', parts, files, cut), [
    { label: '견적서', files: ['견적서_가격부분.png'] }, { label: '강의 내용', files: files.slice(1) },
  ]);
  const { draft } = fromRecord('purchase', { docType: 'order', gist: '강의', total: 84700, parts }, { files, cut });
  assert.match(compose('purchase', draft, CTX).body, /※ 첨 부\n {4}1\. 견적서 1부\.\n {4}2\. 강의 내용 1부\.  끝\.$/);
});

console.log('R&D 탭의 과제 — 연구 내용으로 사유 쓰기·에이전트');
{
  const TODAY = '2026-10-08';
  const book = normalizeBook({
    projects: [{
      id: 'p1', name: 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발', alias: 'SSCB', code: 'RS-2026-0001', lead: '박기도',
      start: '2026-04-01', end: '2029-12-31', note: '산업부 과제', refs: { 구매: ['이몽룡'] },
      years: {
        1: { logs: [
          { date: '2026-04-01', title: '연구개발 계획', key: 'plan', text: '■ 개발목표\n1. 10kV 반도체 차단기 시제품 설계' },
          { date: '2026-09-01', title: '시험 장비 선정', text: '고전압 프로브 비교' },
        ] },
      },
    }, { id: 'p2', name: '계획서 없는 과제', alias: '빈과제', start: '2026-01-01', end: '2026-12-31' }],
  });
  t('연구 내용 — 올해 차년도의 연구개발 계획과 진행 기록, 비고', () => {
    const got = rndContent(book.projects[0], TODAY);
    assert.deepEqual([got.year, got.plan, got.logs], [1, 1, 1]);
    assert.match(got.text, /^\[연구개발 계획 — 1차년도\]\n■ 개발목표\n1\. 10kV 반도체 차단기 시제품 설계\n\n\[진행 기록 — 1차년도\]\n- 2026\.09\.01 시험 장비 선정 — 고전압 프로브 비교\n\n\[비고\]\n산업부 과제$/);
    assert.deepEqual(rndContent(book.projects[1], TODAY), { text: '', year: 1, plan: 0, logs: 0 });
  });
  t('올해 차년도에 계획서가 없으면 앞 차년도의 계획을 쓴다 — 진행 기록은 올해 것', () => {
    const got = rndContent(book.projects[0], '2027-05-01');
    assert.deepEqual([got.year, got.plan, got.logs], [2, 1, 0]);
    assert.match(got.text, /\[연구개발 계획 — 1차년도\]/);
  });
  t('R&D 탭의 과제를 공문의 과제로 — 별칭·번호·책임자·연구기간은 그 과제, 개요·계정·빈 칸은 공문 설정의 같은 과제에서', () => {
    const preset = [{ name: '다른 이름', code: 'RS-2026-0001', about: '차단기 과제를 수행하고 있습니다', account: '연구재료비', content: '공문 설정의 내용' },
      { name: '계획서 없는 과제', lead: '홍길동', content: '공문 설정에 적은 과제 내용' }];
    const [a, b] = rndProjects(book, preset, TODAY);
    assert.deepEqual({ ...a, content: a.content.slice(0, 11) }, {
      name: 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발', alias: 'SSCB', code: 'RS-2026-0001', job: '', lead: '박기도', period: '2026.04.01 ~ 2029.12.31',
      about: '차단기 과제를 수행하고 있습니다', content: '[연구개발 계획 — ', account: '연구재료비', refs: { 구매: ['이몽룡'] }, support: [], io: '', acct: null, rnd: { id: 'p1', year: 1, plan: 1, logs: 1 },
    });
    assert.deepEqual([b.lead, b.content, b.rnd.plan, b.refs], ['홍길동', '공문 설정에 적은 과제 내용', 0, {}], '연구 내용이 없으면 공문 설정의 과제 내용 — 참조자는 YAML 에만 있어 줄에서 채우지 않는다');
    assert.deepEqual(approvalLine({ me: '김거화', preset: PRESET, project: a, kind: 'purchase' }).refs, ['이몽룡'], 'R&D 과제의 참조자가 결재선에 선다');
    assert.deepEqual(rndProjects(normalizeBook(null), preset), []);
  });
  t('R&D 과제 몫으로 공문 설정에서 적은 개요·계정(과제 id 로 묶는다)이 같은 과제 줄의 것보다 먼저다 — 비워 두었으면 비운 대로', () => {
    const preset = [{ name: '다른 이름', code: 'RS-2026-0001', about: '줄의 개요', account: '연구재료비' }];
    const extra = normalizeRndExtra({ p1: { about: ' 차단기 과제를 수행하고 있습니다. ', account: '' }, p9: { about: '없는 과제' }, '': { about: 'x' }, p2: 'x' });
    assert.deepEqual(extra, { p1: { about: '차단기 과제를 수행하고 있습니다', account: '' }, p9: { about: '없는 과제', account: '' } });
    const [a, b] = rndProjects(book, preset, TODAY, extra);
    assert.deepEqual([a.about, a.account], ['차단기 과제를 수행하고 있습니다', ''], '적은 것이 이긴다 — 계정을 비웠으면 갈래 기본값');
    assert.deepEqual([b.about, b.account], ['', '']);
    const [c] = rndProjects(book, preset, TODAY);
    assert.deepEqual([c.about, c.account], ['줄의 개요', '연구재료비'], '적은 적이 없으면 같은 과제 줄의 것');
  });
  t('공문 설정의 과제 줄과 R&D 과제가 같은 과제인가 — 과제번호·과제명·별칭 가운데 하나(공백·대소문자 무시)', () => {
    const p = book.projects[0];
    assert.equal(sameProject(p, { name: '다른 이름', code: 'rs-2026-0001' }), true);
    assert.equal(sameProject(p, { name: ' MW급 10kV 고전압 직류 시스템용 반도체 차단기개발' }), true);
    assert.equal(sameProject(p, { name: '다른 이름', alias: 'sscb' }), true);
    assert.equal(sameProject(p, { name: '다른 이름', code: '', alias: '' }), false);
    assert.equal(sameProject(book.projects[1], { name: '다른 이름', code: '', alias: '' }), false, '번호 없는 R&D 과제와 번호 없는 줄은 번호로 같지 않다');
  });
  t('에이전트에 적은 말 — 지금 적힌 사유와 사용자의 말을 넘기고, 과제 내용이 R&D 연구 내용임을 알린다', () => {
    const [p] = rndProjects(book, [], TODAY);
    const text = reasonInput('purchase', { gist: '고전압 프로브', reason: '시험에 필요함', use: '시험용' }, p, { ask: '사유를 시험 장비 검증 쪽으로' });
    assert.match(text, /과제 내용\(R&D 탭의 연구 내용 — 연구개발 계획·진행 기록\):\n<<<\n\[연구개발 계획 — 1차년도\]/);
    assert.match(text, /지금 적힌 구매사유: 시험에 필요함\n사용자의 말:\n<<<\n사유를 시험 장비 검증 쪽으로\n>>>$/);
    assert.ok(!/사용자의 말/.test(reasonInput('purchase', { gist: '프로브' }, p)), '말이 없으면 넣지 않는다');
  });
  t('에이전트에 적은 말로 쓴 용도는 사용자가 고친 칸이어도 넣는다 — 고쳐 달라고 한 사람이 원한 것', () => {
    const data = { reason: '시험 장비 검증에 필요함', use: '고전압 시험 장비 검증용', reply: '사유를 고쳤습니다' };
    assert.equal(applyReason('purchase', { use: '내가 쓴 용도' }, data, { touched: ['use'] }).use, '내가 쓴 용도');
    assert.equal(applyReason('purchase', { use: '내가 쓴 용도' }, data, { touched: ['use'], asked: true }).use, '고전압 시험 장비 검증용');
  });
  t('초안의 칸 — 용도(교육목적)·사유만 펼쳐 두고 나머지 읽은 칸은 접는다', () => {
    assert.deepEqual(FIELDS.purchase.filter((f) => f.open).map((f) => f.key), ['use', 'reason']);
    assert.deepEqual(FIELDS.edu.filter((f) => f.open).map((f) => f.key), ['purpose', 'reason']);
  });
}

console.log('레시피(recipes/gongmun) — 위임전결·문서설정·쓸 것');
{
  const FULL_PRESET = { ...PRESET, director: '송강현', chief: '김대헌' };
  t('레시피 생성물이 레시피와 같고, 틀린 레시피는 생성기가 막는다', () => {
    assert.equal(fs.readFileSync(new URL('../src/gmrecipe.js', import.meta.url), 'utf8'), renderRecipe(), '`node tools/gen-gongmun.mjs` 를 돌리세요');
    const raw = readRecipe();
    assert.deepEqual(checkRecipe(raw), []);
    const broken = structuredClone(raw);
    broken.delegation.rules.연구비집행.source = '';
    broken.forms.find((f) => f.manifest.form_id === 'KR_EA_Research_Task').purposes.find((p) => p.id === 'edu').purpose.rule_key = '없는규정';
    const errs = checkRecipe(broken);
    assert.ok(errs.some((e) => /연구비집행: source\(규정 근거\)가 없습니다/.test(e)), errs.join('\n'));
    assert.ok(errs.some((e) => /purposes\/edu\/purpose.yaml: rule_key 없는규정/.test(e)), errs.join('\n'));
  });
  t('칸이 정해진 폼(외부강의등 신고서)의 칸 지도 — 없는 초안 칸·날짜 칸의 control·시각 칸의 on·only 의 없는 갈래는 생성기가 막는다', () => {
    const broken = structuredClone(readRecipe());
    const form = broken.forms.find((f) => f.manifest.form_id === 'KR_Outside_Lecture_Report');
    form.fieldmap.fields.org.from = 'orgName';
    delete form.fieldmap.fields.from.control;
    delete form.fieldmap.fields.start.on;
    form.fieldmap.fields.batchCount.default = 0;
    form.manifest.only = ['outside', 'nope'];
    form.purposes[0].purpose.project = 'no';
    broken.forms.find((f) => f.manifest.form_id === 'KR_EA_Research_Task').fieldmap.fields.title.digits = true;
    const errs = checkRecipe(broken).join('\n');
    assert.match(errs, /fields\.org: orgName 가 outside\/purpose\.yaml 의 fields 에 없습니다/);
    assert.match(errs, /fields\.from: date 는 control 이 있어야 합니다/);
    assert.match(errs, /fields\.start: time 은 on\(시각을 얹을 날짜 칸\)이 있어야 합니다/);
    assert.match(errs, /fields\.batchCount: default 는 글이어야 합니다/);
    assert.match(errs, /manifest\.yaml: only 의 nope 는 없는 목적입니다/);
    assert.match(errs, /outside\/purpose\.yaml: project 는 true·false 여야 합니다/);
    assert.match(errs, /research_task\/fieldmap\.yaml fields\.title: digits 는 source: draft 칸에만 씁니다/);
    // 2026-10-17(Codex 검토) — 작성기가 넣을 줄 모르는 칸 종류에 source: draft 를 적거나, 칸이 정해진 폼에 only 가 없으면 막는다(생성은 지나고 작성 때 조용히 비던 틈).
    const loose = structuredClone(readRecipe());
    const report = loose.forms.find((f) => f.manifest.form_id === 'KR_Outside_Lecture_Report');
    report.fieldmap.fields.subject.kind = 'picker';
    delete report.manifest.only;
    const errs2 = checkRecipe(loose).join('\n');
    assert.match(errs2, /fields\.subject: source: draft 는 text·date·time·check 칸에만 씁니다\(작성기 pageForm 이 넣는 종류 — picker 는 안 됩니다\)/);
    assert.match(errs2, /kr_outside_lecture_report\/manifest\.yaml: 칸이 정해진 폼\(source: draft 칸이 있는 폼\)은 only/);
  });
  t('구매요청서의 칸 지도(2026-10-17) — 체크 칸(check)의 selector·from 하나·on(고르는 칸의 options 안)·digits 금지, 표(rows)의 add·probe·cell({nn}·{cell})·cells·from(reads 의 list)·셀의 from, 수신처(receivers)의 꼴은 생성기가 막는다', () => {
    const broken = structuredClone(readRecipe());
    const form = broken.forms.find((f) => f.manifest.form_id === 'KR_Purchase_Order');
    const fm = form.fieldmap;
    delete fm.fields.targetPc.selector;
    fm.fields.targetAsset.from = ['targetType', 'budgetType'];
    delete fm.fields.targetService.on;
    fm.fields.targetSw.on = 'S/W';
    fm.fields.targetSupply.digits = true;
    fm.fields.budgetGeneral.source = 'title';
    fm.fields.place.on = 'demandDate';
    fm.rows.items.cell = '#ctl00_ContentPlaceHolder_Content_rptRequet_ctl{nn}_txtItemName';
    fm.rows.items.from = 'quoteDate';
    delete fm.rows.budget.add;
    fm.rows.budget.cells.txtSubjectCode.from = 'subject';
    fm.rows.budget.cells.txtBudgetCost.digits = 'yes';
    fm.rows.extra = { add: '#a', probe: 'input', cell: '#c{nn}_{cell}', cells: {} };
    broken.settings.receivers.총무팀.code = '10820-1';
    broken.settings.receivers.재무팀 = { code: '10911', text: '' };
    const errs = checkRecipe(broken).join('\n');
    const w = 'purchase-order/forms/kr_purchase_order/fieldmap\\.yaml';
    assert.match(errs, new RegExp(`${w} fields\\.targetPc: selector 가 없습니다`));
    assert.match(errs, new RegExp(`${w} fields\\.targetAsset: check 는 from\\(초안 칸\\)이 하나여야 합니다`));
    assert.match(errs, new RegExp(`${w} fields\\.targetService: check 는 on\\(초안 칸의 값이 이것과 같으면 켠다\\)이 있어야 합니다`));
    assert.match(errs, new RegExp(`${w} fields\\.targetSw: on\\(S/W\\)이 order/purpose\\.yaml 의 targetType 칸 options 에 없습니다`));
    assert.match(errs, new RegExp(`${w} fields\\.targetSupply: digits 는 check 에 쓰지 않습니다`));
    assert.match(errs, new RegExp(`${w} fields\\.budgetGeneral: check 는 source: draft 칸이어야 합니다`));
    assert.match(errs, new RegExp(`${w} fields\\.place: on 은 time·check 칸에만 씁니다`));
    assert.match(errs, new RegExp(`${w} rows\\.items: cell 에는 \\{nn\\}\\(행 번호\\)과 \\{cell\\}\\(셀 이름\\)이 들어야 합니다`));
    assert.match(errs, new RegExp(`${w} rows\\.items: from 의 quoteDate 가 order/purpose\\.yaml 의 reads 에 목록\\(list\\)으로 없습니다`));
    assert.match(errs, new RegExp(`${w} rows\\.budget: add\\(selector\\)가 없습니다`));
    assert.match(errs, new RegExp(`${w} rows\\.budget\\.cells\\.txtSubjectCode: subject 가 order/purpose\\.yaml 의 fields 에 없습니다`));
    assert.match(errs, new RegExp(`${w} rows\\.budget\\.cells\\.txtBudgetCost: digits 는 true·false 여야 합니다`));
    assert.match(errs, new RegExp(`${w} rows\\.extra: cells\\(셀 이름 → \\{ from, digits \\}\\)가 비어 있습니다`));
    assert.match(errs, /settings\.yaml receivers\.총무팀: code 는 숫자 글이어야 합니다/);
    assert.match(errs, /settings\.yaml receivers\.재무팀: options\.receiver 에 없는 수신처입니다/);
    assert.match(errs, /settings\.yaml receivers\.재무팀: text\(수신처 창의 부서 글\)가 비어 있습니다/);
    // 셀의 from 이 목록 줄(item)의 키가 아니어도 막는다.
    const cellBad = structuredClone(readRecipe());
    cellBad.forms.find((f) => f.manifest.form_id === 'KR_Purchase_Order').fieldmap.rows.items.cells.txtUnit.from = 'units';
    assert.match(checkRecipe(cellBad).join('\n'), new RegExp(`${w} rows\\.items\\.cells\\.txtUnit: units 가 order/purpose\\.yaml 의 reads items 의 item 에 없습니다`));
  });
  t('위임전결 — 연구비 집행은 2천만원 이하 팀장·넘으면 소장, 출장은 국내 팀장·해외 본부장, 외부활동은 팀장', () => {
    assert.equal(delegationOf('purchase', { total: 989_000 }).rank, '팀장');
    assert.deepEqual(pick(delegationOf('edu', { fee: 20_000_000 }), ['rank', 'basis', 'unknown']), { rank: '팀장', basis: '20,000,000원', unknown: false }, '2천만원은 이하');
    assert.equal(delegationOf('edu', { fee: 20_000_001 }).rank, '소장');
    assert.deepEqual(pick(delegationOf('edu', {}), ['rank', 'unknown']), { rank: '팀장', unknown: true }, '금액을 모르면 맨 아래 구간이고 모른다고 알린다');
    assert.equal(delegationOf('trip', { division: '해외', cost: 1 }).rank, '본부장');
    assert.equal(delegationOf('trip', {}).rank, '팀장', '구분이 비면 국내');
    assert.equal(delegationOf('outside', {}).rank, '팀장');
    assert.match(delegationOf('purchase', {}).source, /QI-01K Rev164 45절/);
    assert.deepEqual(pick(delegationOf('purchase', { total: 1 }, { rank: '소장' }), ['rank', 'auto', 'overridden']), { rank: '소장', auto: '팀장', overridden: true }, '고른 전결권자가 이긴다');
  });
  t('결재선은 부서장부터 전결권자까지 — 이름이 없는 직책은 남은 것으로', () => {
    const line = approvalLine({ ...CTX, preset: FULL_PRESET, kind: 'trip', draft: { division: '해외' } });
    assert.equal(lineText(line), '기안자 김거화 → 합의자 박기도 → 결재자 노길태 → 결재자 송강현 → 결재자 김대헌 · 참조자 홍길동, 이몽룡');
    assert.deepEqual(line.steps.slice(-2).map((s) => s.why), ['소장', '본부장']);
    const short = approvalLine({ ...CTX, kind: 'edu', draft: { fee: 30_000_000 } });
    assert.deepEqual([short.steps.at(-1).name, short.missing], ['노길태', ['소장']]);
    assert.deepEqual(needs('edu', { course: 'c', from: '2026-11-01', fee: 30_000_000, purpose: 'p', reason: 'r' }, { preset: PRESET, project: FULL, projects: [FULL] }),
      ['소장(공문 설정 — 위임전결)']);
    assert.deepEqual(approvalLine({ ...CTX, kind: 'purchase', draft: { total: 1 } }).steps, approvalLine(CTX).steps, '부서장 전결은 예전 결재선과 같다');
  });
  t('문서설정 — 보존 10년 · 기안 팀 채번(부서 이름으로) · 내부결재 · 결재선 공개 · 검색 키워드(과제 별명·출장·외부활동), 이 공문에서 바꾼 것이 이긴다', () => {
    const s = docSettingOf('purchase', PRESET);
    assert.deepEqual(pick(s, ['profile', 'retention', 'retentionText', 'docNo', 'docNoFrom', 'receiver', 'scope', 'scopeCode', 'emergency']),
      { profile: '연구품의', retention: '120', retentionText: '10년', docNo: '8100', docNoFrom: '부서(수소전기추진연구팀)', receiver: '내부결재', scope: '결재선', scopeCode: 'YNN', emergency: false });
    assert.equal(settingText(s), '보존 10년 · Doc No. 8100 · 수신 내부결재 · 공개 결재선');
    const mine = docSettingOf('purchase', { ...PRESET, docNo: '7200' }, { retention: '36', scope: '기안부서', emergency: 1, receiver: '없는곳', tag: ' 장비 ' });
    assert.deepEqual(pick(mine, ['retention', 'docNo', 'docNoFrom', 'scopeCode', 'emergency', 'receiver', 'tag']),
      { retention: '36', docNo: '7200', docNoFrom: '공문 설정', scopeCode: 'NNY', emergency: true, receiver: '내부결재', tag: '장비' }, '모르는 수신처는 버린다');
    assert.equal(docSettingOf('purchase', { dept: '모르는팀' }).docNo, '');
    // 검색 키워드(2026-10-12 사용자 지정: "연구개발 별칭이 있다면 그걸 넣어줘, 외부활동이면 외부활동, 출장이면 출장")
    assert.equal(docSettingOf('purchase', PRESET, {}, { project: FULL }).tag, '차단기 과제', '구매·교육은 고른 과제의 별명');
    assert.equal(docSettingOf('edu', PRESET, {}, { project: PROJECT }).tag, '', '별명이 없으면 빈 칸');
    assert.equal(docSettingOf('edu', PRESET).tag, '', '과제를 고르지 않아도 빈 칸');
    assert.deepEqual(pick(docSettingOf('trip', PRESET, {}, { project: FULL }), ['profile', 'tag', 'retention', 'docNo', 'receiver']),
      { profile: '출장품의', tag: '출장', retention: '120', docNo: '8100', receiver: '내부결재' }, '출장은 별명이 있어도 출장 — 나머지는 연구품의와 같다');
    assert.deepEqual(pick(docSettingOf('outside', PRESET, {}, { project: FULL }), ['profile', 'tag']), { profile: '외부활동', tag: '외부활동' });
    assert.equal(docSettingOf('trip', PRESET, { tag: '학회' }, { project: FULL }).tag, '학회', '칸에서 고친 것이 이긴다');
    assert.equal(settingText(docSettingOf('edu', PRESET, {}, { project: FULL })), '보존 10년 · Doc No. 8100 · 수신 내부결재 · 공개 결재선 · 키워드 차단기 과제');
    assert.deepEqual(needs('purchase', { gist: 'x', total: 1, use: 'u', reason: 'r' }, { preset: { ...PRESET, dept: '모르는팀' }, project: FULL, projects: [FULL] }), ['문서번호 부서(공문 설정)']);
  });
  t('쓸 것(writePlan) — 폼의 칸 지도·값·문서설정·결재선을 한데, 줄표는 바꾸고 제목은 99자', () => {
    const project = { ...FULL, rnd: { id: 'x', year: 1 } };
    const plan = writePlan('purchase', { title: `모니터 — 구매 품의${'가'.repeat(120)}`, body: '1. 사유 — 시험\n\n------------ 아   래 ------------', draft: { total: 989_000 } },
      { me: '김거화', preset: PRESET, project });
    assert.equal(plan.form, 'KR_EA_Research_Task');
    assert.equal(plan.url, draftUrl('KR_EA_Research_Task'));
    assert.equal(plan.fields.job.kind, 'picker');
    assert.equal(plan.fields.body.control, 'ctl00_ContentPlaceHolder_Content_EditorControl1');
    assert.equal(plan.values.title.length, 99);
    assert.ok(plan.values.title.startsWith('모니터 - 구매 품의'), plan.values.title);
    assert.equal(plan.values.html, '<div>1. 사유 - 시험</div><div><br></div><div style="text-align:center;">------------ 아   래 ------------</div>');
    assert.deepEqual([plan.values.degree, plan.values.job], ['1', { name: FULL.name, code: FULL.code, lead: FULL.lead }]);
    assert.deepEqual(writePlan('purchase', { title: 't', body: 'b' }, { me: '김거화', preset: PRESET, project: { ...project, job: 'RND00202026' } }).values.job.code, 'RND00202026',
      'R&D 탭에서 고른 Job Id 가 과제번호보다 먼저다(2026-10-16)');
    assert.equal(plan.setting.docNo, '8100');
    assert.equal(plan.setting.tag, '차단기 과제', '검색 키워드는 고른 과제의 별명');
    assert.deepEqual(plan.line, { approvers: ['노길태'], agree: ['박기도'], refs: ['홍길동', '이몽룡'], missing: [], rank: '팀장', team: '수소전기추진연구팀' });
    const other = writePlan('purchase', { title: 't', body: 'b', form: 'KR_Something' }, { preset: PRESET });
    assert.deepEqual([other.known, other.fields], [false, {}], '칸 지도가 없는 양식은 열기만 한다');
    assert.equal(writePlan('trip', { title: 't', body: 'b', form: 'KR_EA_Form2' }, { preset: PRESET }).fields.job.source, 'jobText', '기안문의 Job Id. 는 글 칸');
  });
}

console.log('레시피 — 칸마다 읽는 법과 틀의 자리(인라인 프롬프트, 2026-10-09 사용자 지정)');
{
  const purposeOf = (raw, id) => raw.forms.flatMap((f) => f.purposes).find((p) => p.id === id);
  const flat = (s) => String(s).replace(/\s+/g, ' ').trim();
  t('문서에서 읽는 칸의 read·example 이 그대로 지시문에 들어가고, 과제 내용으로 쓰는 칸(사유)은 읽지 않는다', () => {
    for (const k of KIND_ORDER) {
      const task = TASKS[`gongmun.${k}`];
      const text = systemPrompt(`gongmun.${k}`);
      assert.match(text, new RegExp(`^당신은 [^\\n]*${KINDS[k].title}에 넣을 값을 뽑습니다`), `${k}: 역할에 갈래 이름`);
      for (const f of FIELDS[k].filter((x) => x.from === 'document')) {
        assert.ok(text.includes(`- ${f.key} (`), `${k}.${f.key}`);
        assert.ok(text.includes(flat(f.read).slice(0, 40)), `${k}.${f.key} 의 read`);
        if ('example' in f) assert.ok(text.includes(`예: ${f.example}`), `${k}.${f.key} 의 example`);
      }
      for (const f of FIELDS[k].filter((x) => x.from === 'write')) assert.ok(!(f.key in task.fields), `${k}.${f.key} 는 읽지 않는다`);
    }
  });
  t('읽기의 키가 곧 초안 칸의 key 다 — 예시로 만든 기록이 초안에 그대로 들어간다', () => {
    for (const k of KIND_ORDER) {
      const rec = Object.fromEntries(FIELDS[k].filter((x) => x.from === 'document' && 'example' in x).map((x) => [x.key, x.example]));
      const got = structure(`gongmun.${k}`, { ...rec, docType: 'quote', summary: 's' });
      assert.deepEqual(got.notes, [], `${k}: 예시는 관문을 그대로 지난다`);
      const { draft } = fromRecord(k, got.data, { me: '김거화' });
      for (const [key, v] of Object.entries(rec)) assert.equal(draft[key], v, `${k}.${key}`);
    }
  });
  t('종료일이 시작일보다 앞서면 종료일만 비우고 알린다(레시피의 not_before)', () => {
    const { data, notes } = structure('gongmun.edu', { docType: 'course', summary: 's', from: '2026-11-05', to: '2026-11-03' });
    assert.deepEqual([data.from, data.to], ['2026-11-05', null]);
    assert.deepEqual(notes, ['교육 종료일이 시작일보다 앞서 종료일은 뺐습니다']);
  });
  t('틀의 자리는 레시피의 from·show 대로 — 기간은 며칠까지, 금액은 원, 비면 내 이름 · 양식 칸 아래에 꼴의 예가 보인다', () => {
    const v = varsFor('edu', { from: '2026-11-03', to: '2026-11-05', fee: 450000, attendees: '' }, { me: '김거화' });
    assert.deepEqual([v.교육기간, v.교육비, v.참석자, v.교육구분], ['2026. 11. 3. ~ 2026. 11. 5. (3일)', '450,000원', '김거화', '교육']);
    assert.equal(varsFor('trip', { from: '2026-10-20' }).출장기간, '2026. 10. 20. (1일)', '하루면 (1일)');
    assert.ok(VARS.edu.some(([tok, d]) => tok === '{교육기간}' && d.includes('2026. 11. 3. ~ 2026. 11. 5. (3일)')));
    assert.ok(VARS.purchase.some(([tok, d]) => tok === '{{#품목}} … {{/품목}}' && d.includes('{번호}·{품목명}·{사양}·{수량}')));
    assert.ok(VARS.trip.some(([tok]) => tok === '{과제별명}'), '공통 자리(registries/vars.yaml)도 갈래마다 앞에');
  });
  t('남은 것의 이름은 레시피의 need 다', () => {
    assert.deepEqual(FIELDS.edu.filter((f) => f.need).map((f) => `${f.key}:${f.need}`), ['course:교육명', 'fee:교육비', 'from:교육기간', 'purpose:교육목적', 'reason:교육사유']);
    assert.deepEqual(needs('edu', { ...blankDraft('edu'), course: 'c' }, { preset: PRESET, project: FULL, projects: [FULL] }), ['교육비', '교육기간', '교육목적', '교육사유']);
  });
  t('틀린 칸·자리는 생성기가 막는다 — 읽지 않는 칸의 read, 꼴이 틀린 예시, read 없는 읽는 칸, 틀에 없는 이름, 없는 칸을 가리키는 자리', () => {
    const broken = structuredClone(readRecipe());
    const edu = purposeOf(broken, 'edu');
    edu.purpose.fields.find((f) => f.key === 'reason').read = '사유를 읽는다';
    edu.purpose.fields.find((f) => f.key === 'from').example = '2026.11.03';
    delete edu.purpose.fields.find((f) => f.key === 'course').read;
    edu.body.body += '\n{교육일정}';
    edu.body.vars.교육기간.from = ['from', 'until'];
    broken.vars.common.결재자 = '없는 자리';
    const errs = checkRecipe(broken).join('\n');
    assert.match(errs, /fields\[\d+\]\(reason\): read 는 from: document 칸에만 씁니다/);
    assert.match(errs, /fields\[\d+\]\(from\): example\(2026\.11\.03\)은 YYYY-MM-DD 날짜여야 합니다/);
    assert.match(errs, /fields\[0\]\(course\): from: document 칸은 read/);
    assert.match(errs, /edu\/body_spec\.yaml body: \{교육일정\} 가 vars·공통 자리/);
    assert.match(errs, /vars\.교육기간: from 의 until 가 칸\(key\)에 없습니다/);
    assert.match(errs, /vars\.yaml common: 결재자 는 코드가 채우지 않는 자리/);
  });
  t('--prompt 는 레시피에서 바로 지시문 전문을 만든다 — 확장이 보내는 것과 같다(읽기·사유 쓰기·공문 설정 채우기)', () => {
    const { tasks } = buildRecipe();
    for (const k of KIND_ORDER) {
      assert.equal(promptOf(tasks[`gongmun.${k}`]), systemPrompt(`gongmun.${k}`), k);
      if (REASON_KEYS[k]) assert.equal(promptOf(tasks[`gongmunReason.${k}`]), systemPrompt(`gongmunReason.${k}`), `${k} 사유`);
    }
    assert.equal(promptOf(tasks.gongmunSetup), systemPrompt('gongmunSetup'));
  });
  t('공문의 작업은 모두 레시피가 만든다 — input.yaml 에는 공문 작업이 없다(사유 쓰기는 사유 칸이 있는 갈래만 — 외부강의등 신고서는 없다)', () => {
    assert.deepEqual(Object.keys(INPUT_SPEC.tasks).filter((n) => n.startsWith('gongmun')), []);
    assert.deepEqual(Object.keys(TASKS).filter((n) => n.startsWith('gongmun')).sort(),
      ['gongmunSetup', ...KIND_ORDER.flatMap((k) => [`gongmun.${k}`, ...(REASON_KEYS[k] ? [`gongmunReason.${k}`] : [])])].sort());
    assert.ok(!('gongmunReason.outside' in TASKS));
  });
  t('사유 쓰기 — 칸의 write·example 이 지시문이 되고, 답의 키는 칸의 key, 사유 칸은 꼭 있어야 한다', () => {
    for (const k of KIND_ORDER.filter((x) => REASON_KEYS[x])) {
      const text = systemPrompt(`gongmunReason.${k}`);
      assert.match(text, new RegExp(`${KINDS[k].title} 본문에 들어갈 다음 칸을 공문체로 씁니다: [^\\n]*${rx(REASON_LABEL[k])}`));
      for (const f of FIELDS[k].filter((x) => x.write)) {
        assert.ok(text.includes(`- ${f.key} (글${f.from === 'write' ? ', 필수' : ' 또는 null'})`), `${k}.${f.key}`);
        assert.ok(text.includes(flat(f.write).slice(0, 30)), `${k}.${f.key} 의 write`);
      }
    }
    assert.match(systemPrompt('gongmunReason.trip'), /출장사유/, '갈래만의 말은 그 칸의 write 에');
  });
  t('공문 설정 채우기도 레시피(registries/setup.yaml)의 키마다 읽는 법·예시로 — 부분 수정이다', () => {
    const text = systemPrompt('gongmunSetup');
    assert.match(text, /\n {4}- code \(글 또는 null\): 과제번호\. 예: RND-20-2026/);
    assert.match(text, /- 필수가 아닌 키는 사용자가 말하지 않았으면 null 입니다\.$/);
  });
  t('읽은 문서의 이름·누구의 것·온라인으로 보는 말도 레시피에서', () => {
    assert.deepEqual([DOC_NAMES.quote, DOC_NAMES.request, DOC_NAMES.unknown], ['견적서', '요청 공문', '문서']);
    assert.deepEqual(KIND_ORDER.map((k) => whoOf(k, { vendor: 'V', provider: 'P', place: 'L', who: 'W', expert: 'E', org: 'O' })), ['V', 'P', 'L', 'W', 'E', 'V', 'O'], '구매의뢰도 구매처, 수당은 지급 대상, 자문은 자문위원');
    assert.equal(eduModeOf({ provider: 'Coursera' }), '온라인교육', 'mode 칸의 online 에 있는 말(대소문자 무시)');
    assert.equal(eduModeOf({ place: '인터넷 강의' }), '온라인교육', '띄어쓰기는 보지 않는다');
  });
  t('사유 쓰기의 틀린 칸은 생성기가 막는다 — 쓰지 않는 칸의 write, write 없는 사유 칸, 품의할 것의 없는 이름, 없는 who', () => {
    const broken = structuredClone(readRecipe());
    const trip = purposeOf(broken, 'trip');
    trip.purpose.fields.find((f) => f.key === 'who').write = '출장자를 쓴다';
    delete trip.purpose.fields.find((f) => f.key === 'reason').write;
    trip.purpose.writing.context += '\n출장 예산: {출장예산?}';
    trip.attach.who = 'host';
    const errs = checkRecipe(broken).join('\n');
    assert.match(errs, /fields\[\d+\]\(who\): write 는 from: document·write 칸에만/);
    assert.match(errs, /fields\[\d+\]\(reason\): from: write 칸은 write/);
    assert.match(errs, /trip\/purpose\.yaml writing\.context: \{출장예산\} 가 vars·공통 자리/);
    assert.match(errs, /trip\/attach_rules\.yaml: who\(host\)/);
  });
}

await ta('Claude 가 닿지 않으면 채팅은 규칙 해석으로 내려가고, 그 답도 관문을 지난다', async () => {
  const got = await gongmunSetupSmart('과제: MMC 기반 전력변환 기술 개발, 책임자 박기도 책임', {}, { apiKey: '', useNative: false });
  assert.equal(got.via, 'local');
  assert.deepEqual(got.patch, { projects: [{ name: 'MMC 기반 전력변환 기술 개발', code: null, lead: '박기도', alias: null, period: null, about: null, content: null }] });
  assert.match(got.reply, /과제 1개와 합의자/);
});

console.log(`통과 ${pass}건`);
