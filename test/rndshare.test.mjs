// R&D 장부 ↔ SharePoint 공유 폴더의 연차 파일 변환 — src/rndshare.js(2026-10-18, 원노트 공유 src/rndnote.js 를 대신함). 저장 형편의 모양, 공유 열쇠, 과제 → project 칸,
// 차년도 → budget·changes·research, 받은 것을 장부에 들이기(applyYear·applyProject — 별칭 겹침 '-2'·id 맞추기·묘비), matchProject 차례, 그리고 정본(rerp/prjdoc.js)과의 왕복.
// 어디에도 보내지 않는다(실 SharePoint 없음). 화면 쪽(켜기·지금 맞추기·고친 뒤 저절로)은 test/rndpanel.test.mjs 의 "공유" 가 본다.
import assert from 'node:assert/strict';

import { normalizeProject, MAX_PROJECTS, blankYear, parseSections } from '../src/rnd.js';
import {
  SHARE_KEY, DEFAULT_BASE, WS_EXTRA, normalizeShare, erpNoOf, shareKeyOf, projectOf, localProjectOf, localPlanOf, researchOf, planOfResearch, cleanRec, yearOf, budgetHash,
  applyYear, applyProject, matchProject, PEOPLE_KEY, normalizePeople, permRows, PLUS_DEFAULTS, normalizePlus, plusOf, plusSet, plusWant,
} from '../src/rndshare.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
/** 과제 — normalizeProject 는 aliasAt 을 아직 모를 수 있어(배선 에이전트가 src/rnd.js 에 더함) 따로 얹는다. */
const P = (o) => { const p = normalizeProject({ start: '2026-04-01', end: '2029-12-31', ...o }); if (o.aliasAt) p.aliasAt = o.aliasAt; return p; };
const NOW = 1_700_000_000_000;
const YEAR1 = {
  erp: { prjNo: 'P1', prjNm: 'ERP 과제명', anl: 1, rspr: '홍길동' },
  budget: [{ id: 'b1', item: '인건비', plan: 1000000, used: 5000 }, { id: 'b2', item: '연구활동비', plan: null, used: null }, { id: 'b3', item: '연구시설·장비비', plan: 2000000, used: null, erpKey: '10|연구시설장비비' }],
  changes: [{ id: 'c1', date: '2026-10-01', kind: '예산', item: '인건비', before: '1', after: '2', reason: '', auto: true, key: 'snapshot:r1' }],
  logs: [{ id: 'l1', date: '2026-10-01', title: '진행 기록', text: '이 브라우저에만' }],
};
const linked = () => P({ id: 'a', name: 'MVDC 차단기', alias: 'SSCB', aliasAt: 5, code: 'RS-1', job: 'RND00202026', io: '2145nr0124', lead: '홍길동', note: '산업부', years: { 1: YEAR1 } });
const plain = () => P({ id: 'b', name: '수소 추진', alias: 'H2', job: 'RND00302026', calendar: true });
const bare = () => P({ id: 'c', name: '새 과제', alias: 'NEW' });
const book = () => ({ projects: [linked(), plain(), bare()], current: { project: 'a', year: { a: 1, b: 2 } } });
const REC = (name, n, extra) => ({ id: `${name.replace(/\s/g, '').toLowerCase()}#${n}`, name, code: '', n, rev: 'r1', goals: [`${n}차 목표`], prjNo: 'OLD', prjNm: '옛', linkBy: 'auto', src: 'x', ...extra });

console.log('모양');
t('저장해 두는 형편 — 꺼짐이 기본, 모르는 것은 버린다', () => {
  assert.equal(SHARE_KEY, 'rndShare');
  assert.equal(DEFAULT_BASE, '업무/shared');
  assert.deepEqual(WS_EXTRA, ['wsId', 'code', 'calendar']);
  assert.deepEqual(normalizeShare(null), { on: false, folder: '', folderCache: {}, at: 0, memo: {}, del: {}, last: '', error: '', shareWith: 'participants', peer: {}, effective: '', own: {} });
  assert.equal(normalizeShare({ shareWith: 'none' }).shareWith, 'none', '자동 공유 끄기만 남고 그 밖은 기본 participants');
  assert.deepEqual(normalizeShare({ on: 'yes', folder: ' https://x.sharepoint.com/personal/me/Documents/업무/shared ', memo: [1], del: 'x', at: '5', extra: 1, last: 'ok', folderCache: { folderPath: '/p' } }),
    { on: false, folder: 'https://x.sharepoint.com/personal/me/Documents/업무/shared', folderCache: { folderPath: '/p' }, at: 0, memo: {}, del: {}, last: 'ok', error: '', shareWith: 'participants', peer: {}, effective: '', own: {} });
  assert.deepEqual(normalizeShare({ peer: { folder: 'https://x', at: 5 }, effective: 'https://x\nhttps://h' }).peer, { folder: 'https://x', at: 5 }, 'rERP 확장의 설정 기억(peer)과 밑폴더 열쇠(effective)는 그대로 둔다');
  assert.equal(normalizeShare({ peer: 'x', effective: 7 }).effective, '');
  assert.equal(normalizeShare({ on: true, at: 9, memo: { P1: { at: 1 } } }).memo.P1.at, 1);
  assert.deepEqual(normalizeShare({ on: true, shareWith: 'none' }).own, { enabled: true, shareWith: 'none' }, '2026-10-25 전 저장값 — 켬·자동 공유 끔은 이 확장에서 바꾼 것으로');
  assert.deepEqual(normalizeShare({ on: false }).own, {}, '꺼 둔 것은 rERP 확장을 따른다');
  assert.deepEqual(normalizeShare({ on: true, own: { scope: 'pick', x: 1 } }).own, { scope: 'pick' }, 'own 이 있으면 그것만');
});

console.log('공유 (Plus) 설정 — 이 확장에서 바꾼 칸 > rERP 확장 > 기본 (2026-10-25)');
t('모양이 맞는 칸만 남는다', () => {
  assert.deepEqual(normalizePlus({ enabled: 1, discover: false, shareWith: 'all', scope: 'pick', projects: [' P1 ', 'P1', '', 7], sitesSync: true }), { discover: false, scope: 'pick', projects: ['P1', '7'] });
  assert.deepEqual(plusOf(null, null), { ...PLUS_DEFAULTS, projects: [] });
  assert.equal(plusOf({}, null).enabled, false, '기본은 꺼짐');
});
t('rERP 확장의 값을 따르고, 바꾼 칸만 이긴다', () => {
  const peer = { enabled: true, scope: 'pick', projects: ['P1'], planSync: false };
  assert.deepEqual(plusOf({}, peer), { ...PLUS_DEFAULTS, enabled: true, scope: 'pick', projects: ['P1'], planSync: false });
  assert.equal(plusOf({ enabled: false }, peer).enabled, false);
  assert.deepEqual(plusOf({ projects: ['P2'] }, peer).projects, ['P2']);
});
t('바꾼 값이 rERP 확장의 값과 같아지면 다시 따른다 — rERP 확장이 모르는 칸은 남긴다', () => {
  const peer = { enabled: true, scope: 'all' };
  assert.deepEqual(plusSet({}, 'enabled', false, peer), { enabled: false });
  assert.deepEqual(plusSet({ enabled: false }, 'enabled', true, peer), {});
  assert.deepEqual(plusSet({}, 'discover', false, peer), { discover: false }, 'rERP 확장이 답하지 않은 칸');
  assert.deepEqual(plusSet({ scope: 'pick', projects: ['P1'] }, 'scope', 'all', peer), { projects: ['P1'] });
  assert.deepEqual(plusSet({}, 'enabled', true, null), { enabled: true }, 'rERP 확장이 없으면 늘 이 확장의 것');
});
t('이 장부의 몫 — 예산 계획은 사업비를 따르고 참여연구원 계획은 늘 안 한다', () => {
  assert.deepEqual(plusWant(PLUS_DEFAULTS), { plan: true, research: true, budget: true, changes: true, alias: true, support: true, staff: false });
  assert.deepEqual(plusWant({ ...PLUS_DEFAULTS, staffSync: false, planSync: false }), { plan: false, research: true, budget: false, changes: true, alias: true, support: true, staff: false });
});

console.log('공유 열쇠 — rERP 과제번호 → Job Id → 장부 id');
t('이어 둔 rERP 는 그 연차 것, 그 연차에 없으면 이어 둔 어느 연차의 것', () => {
  const a = linked();
  assert.equal(erpNoOf(a, 1), 'P1');
  assert.equal(erpNoOf(a, 3), 'P1', '3차년도에는 잇기가 없어도 1차년도의 것');
  assert.equal(erpNoOf(plain()), '');
  assert.deepEqual([shareKeyOf(a), shareKeyOf(plain()), shareKeyOf(bare())], ['P1', 'RND00302026', 'c']);
});

console.log('과제 → 연차 파일의 project 칸');
t('정본 차례(prjNo … note) 뒤에 이 장부의 칸(wsId·code·calendar) — rERP 가 있으면 과제명은 rERP 것', () => {
  const pr = projectOf(linked(), 1);
  assert.deepEqual(pr, { prjNo: 'P1', prjNm: 'ERP 과제명', rspr: '홍길동', alias: 'SSCB', aliasAt: 5, jobId: 'RND00202026', io: '2145NR0124', start: '2026-04-01', end: '2029-12-31', note: '산업부', support: [], supportAt: 0, wsId: 'a', code: 'RS-1', calendar: false });
  assert.deepEqual(Object.keys(pr), ['prjNo', 'prjNm', 'rspr', 'alias', 'aliasAt', 'jobId', 'io', 'start', 'end', 'note', 'support', 'supportAt', 'wsId', 'code', 'calendar']);
  // 행정지원 — 장부의 support(이름 없는 줄·겹친 이름은 걷음)와 supportAt 이 project 칸으로(2026-10-19 "행정지원은 공유가 안되냐? 과제마다 동일해야지")
  const sp = projectOf(P({ id: 's', name: '지원', support: [{ name: '조주희', role: '행정 담당' }, { name: '', role: 'x' }, { name: '조주희', ref: false }], supportAt: 77 }));
  assert.deepEqual([sp.support, sp.supportAt], [[{ name: '조주희', role: '행정 담당', ref: true }], 77]);
  assert.deepEqual([projectOf(P({ id: 's', name: '지원', support: [], supportAt: 99 })).support, projectOf(P({ id: 's', name: '지원', support: [], supportAt: 99 })).supportAt], [[], 99], '다 지워도 시각은 실린다 — 지움이 파일로 간다');
  const q = projectOf(plain());
  assert.deepEqual([q.prjNo, q.prjNm, q.aliasAt, q.calendar, q.rspr], ['', '수소 추진', 0, true, ''], '이어지지 않은 과제는 과제명·빈 과제번호');
});
t('loadLocal 의 projects[열쇠] — project 칸 + 현재 차년도(anl)·그 기간(YYYYMMDD)·받은 시각', () => {
  const l = localProjectOf(linked(), 1, { at: 123, today: '2027-05-01' });
  assert.deepEqual([l.anl, l.stDt, l.endDt, l.at, l.wsId], [2, '20270401', '20280331', 123, 'a']);
  const c = localProjectOf(plain(), 0, { today: '2027-05-01' });
  assert.deepEqual([c.anl, c.stDt, c.endDt], [2, '20270101', '20271231'], 'calendar 과제는 1월 1일에 끊는다');
  assert.deepEqual([localProjectOf(bare(), 0, { today: '2026-01-01' }).anl, localProjectOf(P({ id: 'z', name: 'z', start: '' })).stDt], [1, '']);
});

console.log('차년도 → budget·changes·research');
t('예산은 계획이 적힌 줄만(집행·erpKey 는 가지 않음) · 변경이력은 by·at 를 채워 · 연차 기간은 YYYY-MM', () => {
  const recs = { 'mvdc차단기#1': REC('MVDC 차단기', 1), 'mvdc차단기#2': REC('MVDC 차단기', 2), '다른#1': REC('다른', 1, { code: 'rs-1' }), '남#1': REC('남', 1), 무효: { id: 'x', name: '', n: 1 } };
  const y = yearOf(linked(), 1, { research: recs, budgetAt: 77, by: '나' });
  assert.deepEqual(y.year, { n: 1, start: '2026-04', end: '2027-03' });
  assert.deepEqual(y.budget, [{ name: '인건비', plan: 1000000, at: 77, by: '나' }, { name: '연구시설·장비비', plan: 2000000, at: 77, by: '나' }]);
  assert.deepEqual(y.changes, [{ id: 'c1', date: '2026-10-01', kind: '예산', item: '인건비', before: '1', after: '2', reason: '', by: '나', at: 0, auto: true, key: 'snapshot:r1' }]);
  assert.deepEqual(y.research.map((r) => r.id).sort(), ['mvdc차단기#1', '다른#1'], '과제명이 같은 것과 과제번호(code)가 같은 것, 그 차년도만');
  assert.ok(y.research.every((r) => !('prjNo' in r) && !('prjNm' in r) && !('linkBy' in r) && !('src' in r)), '받는 쪽 연결 칸은 파일에 싣지 않는다');
  assert.deepEqual(yearOf(linked(), 2).budget, [], '없는 차년도는 빈 것');
  assert.deepEqual(yearOf(P({ id: 'z', name: 'z', start: '' }), 1).year, { n: 1, start: '', end: '' });
  // 변경이력에 by·at 가 있으면 그대로(배선 에이전트가 src/rnd.js 에 더한 뒤)
  const p = linked();
  p.years[1].changes[0].by = '남'; p.years[1].changes[0].at = 9;
  assert.deepEqual([yearOf(p, 1, { by: '나' }).changes[0].by, yearOf(p, 1).changes[0].at], ['남', 9]);
});
t('researchOf 는 loadLocal().research 모양 — 기록의 prjNo 를 열쇠로, prjNm 을 과제명으로 · cleanRec', () => {
  const m = researchOf([REC('MVDC 차단기', 1), REC('MVDC 차단기', 2)], linked(), 'P1');
  assert.deepEqual(Object.keys(m).sort(), ['mvdc차단기#1', 'mvdc차단기#2']);
  assert.deepEqual([m['mvdc차단기#2'].prjNo, m['mvdc차단기#2'].prjNm, m['mvdc차단기#2'].linkBy], ['P1', 'MVDC 차단기', 'auto']);
  assert.deepEqual(Object.keys(researchOf([REC('MVDC 차단기', 1)], linked(), 'P1', 2)), [], 'n 을 주면 그 차년도만');
  assert.deepEqual(researchOf([REC('x', 1)], P({ id: 'q', name: '' }), 'q'), {}, '과제명도 과제번호도 없으면 아무것도 안 맞는다');
  assert.deepEqual(cleanRec({ id: 'i', name: 'n', n: 1, prjNo: 'P', prjNm: 'N', linkBy: 'user', src: 's', goals: [] }), { id: 'i', name: 'n', n: 1, goals: [] });
});
t('localPlanOf — 예산 줄을 실어 가는 최소 사업비 계획(사람 없음), 계획이 없는 연차는 null · budgetHash 는 계획만 본다', () => {
  const e = localPlanOf(linked(), 1, 'P1', { at: 77, by: '나' });
  assert.deepEqual(e, { prjNo: 'P1', year: 1, prjNm: 'MVDC 차단기', from: '2026-04', to: '2027-03', budgetPay: null, budget: [{ name: '인건비', plan: 1000000 }, { name: '연구시설·장비비', plan: 2000000 }], basis: 'rerp', src: 'erp', people: [], at: 77, by: '나', note: '' });
  assert.equal(localPlanOf(linked(), 2, 'P1'), null);
  assert.equal(localPlanOf(P({ id: 'z', name: 'z', years: { 1: { budget: [{ id: 'r', item: '인건비', plan: null, used: 100 }] } } }), 1, 'z'), null, '집행만 있으면 올릴 계획이 없다');
  const a = linked();
  const h = budgetHash(a.years[1]);
  a.years[1].budget[0].used = 99999;
  assert.equal(budgetHash(a.years[1]), h, '집행이 바뀌어도 지문은 같다');
  a.years[1].budget[0].plan = 1;
  assert.notEqual(budgetHash(a.years[1]), h);
  assert.equal(budgetHash(null), '[]');
});

console.log('받은 것을 차년도에 — applyYear');
t('예산: 이름이 같은 줄(비목 눈 — 가운뎃점·직접비/ 머리 무시)의 계획만 맞추고, 새 비목은 더하고, 파일에 없는 비목의 계획은 비운다. 집행·erpKey·줄 id 는 그대로', () => {
  const p = linked();
  const r = applyYear(p, 1, 'budget', { year: 1, budget: [{ name: '인건비', plan: '3,000,000', at: 9, by: '동료' }, { name: '직접비/연구시설장비비', plan: null }, { name: '연구수당', plan: 500000 }, { name: '', plan: 1 }, { name: '빈계획', plan: null }], at: 9, by: '동료' });
  assert.equal(r.changed, true);
  assert.deepEqual(r.project.years[1].budget.map((x) => [x.id || '?', x.item, x.plan, x.used, x.erpKey || '']),
    [['b1', '인건비', 3000000, 5000, ''], ['b2', '연구활동비', null, null, ''], ['b3', '연구시설·장비비', null, null, '10|연구시설장비비'], [r.project.years[1].budget[3].id, '연구수당', 500000, null, '']]);
  assert.ok(r.project.years[1].budget[3].id, '새 줄에는 id');
  assert.equal(p.years[1].budget[0].plan, 1000000, '들어온 과제는 바꾸지 않는다');
  assert.deepEqual(r.project.years[1].changes, p.years[1].changes, '다른 칸은 그대로');
  assert.equal(r.project.years[1].logs, p.years[1].logs);
  // 같은 내용이면 바뀐 것 없음
  const same = applyYear(p, 1, 'budget', { budget: [{ name: '인건비', plan: 1000000 }, { name: '연구시설·장비비', plan: 2000000 }] });
  assert.deepEqual([same.changed, same.project], [false, p]);
  // 없는 차년도면 기본 비목 여섯 줄에 얹는다
  const n2 = applyYear(p, 2, 'budget', [{ name: '인건비', plan: 10 }]);
  assert.deepEqual(n2.project.years[2].budget.map((x) => [x.item, x.plan]), blankYear().budget.map((x) => [x.item, x.item === '인건비' ? 10 : null]));
  assert.deepEqual(applyYear(p, 1, '엉뚱', {}), { project: p, changed: false });
});
t('변경이력: 합집합 목록으로 갈아 넣는다(by·at·key 보존, 모르는 kind 는 기타, id 없는 줄은 뺌)', () => {
  const p = linked();
  const list = [...yearOf(p, 1, { by: '나' }).changes, { id: 'c2', date: '2026-10-02', kind: '엉뚱', item: 'x', before: '', after: '', reason: 'r', by: '동료', at: 5, auto: false }, { date: '2026-10-03', item: 'id 없음' }];
  const r = applyYear(p, 1, 'changes', { key: 'P1@1', year: 1, list, all: {} });
  assert.equal(r.changed, true);
  assert.deepEqual(r.project.years[1].changes, [
    { id: 'c1', date: '2026-10-01', kind: '예산', item: '인건비', before: '1', after: '2', reason: '', auto: true, by: '나', key: 'snapshot:r1' },
    { id: 'c2', date: '2026-10-02', kind: '기타', item: 'x', before: '', after: '', reason: 'r', auto: false, by: '동료', at: 5 },
  ]);
  assert.equal(applyYear(r.project, 1, 'changes', r.project.years[1].changes).changed, false);
});

console.log('파일이 장부의 어느 과제인가 — matchProject');
t('wsId → prjNo(이어 둔 rERP · 이어지지 않은 과제의 열쇠인 id·Job Id) → code → 과제명 차례', () => {
  const b = book();
  assert.equal(matchProject(b, { project: { wsId: 'b', prjNo: 'P1' } }).id, 'b', 'wsId 가 먼저');
  assert.equal(matchProject(b, { project: { prjNo: 'P1', prjNm: '수소 추진' } }).id, 'a', 'rERP 과제번호가 과제명보다 먼저');
  assert.equal(matchProject(b, { prjNo: 'RND00302026' }).id, 'b', 'project 칸만 줘도 되고, Job Id 열쇠도 본다');
  assert.equal(matchProject(b, { project: { prjNo: 'c' } }).id, 'c', '장부 id 열쇠');
  assert.equal(matchProject(b, { project: { prjNo: 'P9', code: 'rs-1' } }).id, 'a', '과제번호(code)는 띄어쓰기·대소문자를 가리지 않는다');
  assert.equal(matchProject(b, { project: { prjNm: '수소추진' } }).id, 'b', '과제명도');
  assert.equal(matchProject(b, { project: { prjNo: 'P9', prjNm: '없는 과제' } }), null);
  assert.equal(matchProject({ projects: [] }, null), null);
});

console.log('파일의 project 칸을 장부에 — applyProject');
t('장부에 없는 과제는 만든다 — 과제명·책임자·기간·비고·Job Id·I/O, 겹치는 별칭은 -2, prjNo 가 있으면 그 연차에 rERP 를 잇는다(다음 열쇠가 같게), id 는 파일의 wsId', () => {
  const b = book();
  const doc = { prjNo: 'P9', prjNm: '동료 과제', rspr: '이몽룡', alias: 'SSCB', aliasAt: 3, jobId: 'RND9', io: 'io9', start: '2026-01-01', end: '2027-12-31', note: '비고', wsId: 'remote1', code: 'RS-9', calendar: true, at: 50 };
  const r = applyProject(b, 'P9', doc, { P1: { at: 1 } }, { now: NOW, n: 2 });
  assert.deepEqual([r.created, r.id, r.alias, r.aliasFixed, r.changed], [true, 'remote1', 'SSCB-2', true, ['created', 'alias']]);
  const p = r.book.projects.find((x) => x.id === 'remote1');
  assert.deepEqual([p.name, p.lead, p.alias, p.aliasAt, p.job, p.io, p.start, p.end, p.note, p.code, p.calendar], ['동료 과제', '이몽룡', 'SSCB-2', NOW, 'RND9', 'IO9', '2026-01-01', '2027-12-31', '비고', 'RS-9', true]);
  assert.deepEqual([p.years[2].erp.prjNo, p.years[2].erp.prjNm, p.years[2].erp.auto, p.years[2].erp.linkedAt, shareKeyOf(p)], ['P9', '동료 과제', false, NOW, 'P9']);
  assert.deepEqual(r.memo, { P1: { at: 1 }, P9: { id: 'remote1', at: 50 } });
  assert.equal(b.projects.length, 3, '들어온 장부는 바꾸지 않는다');
  assert.deepEqual(r.book.current, b.current);
  // 이름이 없으면 별칭, 그것도 없으면 열쇠 · n 이 없으면 잇지 않는다 · 겹치지 않는 별칭은 파일의 aliasAt 그대로
  const q = applyProject(b, 'RND7', { prjNo: 'RND7', alias: 'ALONE', aliasAt: 4 }, {}, { now: NOW }).book.projects.at(-1);
  assert.deepEqual([q.name, q.alias, q.aliasAt, q.years], ['ALONE', 'ALONE', 4, {}]);
  assert.equal(applyProject(b, 'k', { prjNo: 'k' }, {}, { now: NOW }).book.projects.at(-1).name, 'k');
  // 열 개가 차면 만들지 않는다
  const full = { projects: Array.from({ length: MAX_PROJECTS }, (_, i) => P({ id: `f${i}`, name: `F${i}`, alias: `F${i}` })), current: { project: 'f0', year: {} } };
  const s = applyProject(full, 'P9', doc, {}, { now: NOW });
  assert.deepEqual([s.skipped, s.created, s.book.projects.length], [true, false, MAX_PROJECTS]);
});
t('행정지원 — support 칸이 오면 걷어서 들이고(바뀌면 changed support) supportAt 은 큰 쪽만, support·supportAt 만 온 payload 로는 과제를 만들지 않는다(별칭처럼)', () => {
  const b = book();
  const r = applyProject(b, 'P1', { support: [{ name: ' 조주희 ', role: '행정 담당' }, { name: '', role: 'x' }], supportAt: 500, at: 500 }, { P1: { id: 'a', at: 100 } }, { now: NOW });
  const p = r.book.projects[0];
  assert.deepEqual([r.created, r.id, r.changed, p.support, p.supportAt], [false, 'a', ['support'], [{ name: '조주희', role: '행정 담당', ref: true }], 500]);
  assert.deepEqual(b.projects[0].support, [], '들어온 장부는 그대로');
  // 같은 내용에 시각만 뒤 — supportAt 만 올리고 changed 는 supportAt
  const q = applyProject(r.book, 'P1', { support: [{ name: '조주희', role: '행정 담당', ref: true }], supportAt: 900 }, r.memo, { now: NOW });
  assert.deepEqual([q.changed, q.book.projects[0].supportAt], [['supportAt'], 900]);
  // 비운 목록이 오면 지움(시각은 큰 쪽) — 정본 mergeProject 가 supportAt 큰 쪽으로 고른 결과가 온다
  const e = applyProject(q.book, 'P1', { support: [], supportAt: 1000 }, q.memo, { now: NOW });
  assert.deepEqual([e.changed, e.book.projects[0].support, e.book.projects[0].supportAt], [['support'], [], 1000]);
  // 앞선 시각은 받지 않고, support 없이 supportAt 만 와도 큰 쪽만
  assert.deepEqual(applyProject(e.book, 'P1', { supportAt: 5 }, e.memo, { now: NOW }).book.projects[0].supportAt, 1000);
  assert.deepEqual(applyProject(e.book, 'P1', { supportAt: 2000 }, e.memo, { now: NOW }).changed, ['supportAt']);
  // 장부에 없는 열쇠로 행정지원만 — 만들지 않는다
  const none = applyProject(b, 'ZZ', { support: [{ name: '조주희' }], supportAt: 1 }, {}, { now: NOW });
  assert.deepEqual([none.created, none.id, none.book.projects.length], [false, '', 3]);
});
t('있는 과제 — 온 칸만 바꾼다(정본 toLocalYear 의 project 는 ERP 칸·별칭이 없다): 이어진 과제의 과제명은 두고, 책임자·기간·비고·Job Id·I/O·code·calendar 를 받고, 받은 시각은 memo 에', () => {
  const b = book();
  const part = { jobId: 'RND 00202026X', io: 'abc', start: '2026-05-01', end: '2030-03-31', note: '새 비고', wsId: 'a', code: 'RS-2', calendar: true, at: 500 };
  const r = applyProject(b, 'P1', part, { P1: { id: 'a', at: 100 } }, { now: NOW });
  assert.deepEqual([r.created, r.removed, r.renamed, r.id, r.changed], [false, false, null, 'a', ['job', 'io', 'code', 'note', 'calendar', 'start', 'end']]);
  const p = r.book.projects[0];
  assert.deepEqual([p.name, p.lead, p.alias, p.aliasAt, p.job, p.io, p.start, p.end, p.note, p.code, p.calendar], ['MVDC 차단기', '홍길동', 'SSCB', 5, 'RND00202026X', 'ABC', '2026-05-01', '2030-03-31', '새 비고', 'RS-2', true]);
  assert.deepEqual(r.memo.P1, { id: 'a', at: 500 });
  assert.equal(b.projects[0].note, '산업부', '들어온 장부는 그대로');
  assert.equal(p.years, b.projects[0].years, '차년도 내용은 건드리지 않는다');
  // 전체 project 칸이 오면 — 이어진 과제는 과제명을 두고(rERP 이름은 years[n].erp 에 따로), 이어지지 않은 과제는 과제명도 받는다. 책임자는 둘 다
  const full = applyProject(b, 'P1', { prjNo: 'P1', prjNm: 'ERP 과제명', rspr: '이몽룡', wsId: 'a' }, {}, { now: NOW });
  assert.deepEqual([full.book.projects[0].name, full.book.projects[0].lead, full.changed], ['MVDC 차단기', '이몽룡', ['lead']]);
  const un = applyProject(b, 'RND00302026', { prjNo: 'RND00302026', prjNm: '수소 추진 2', rspr: '성춘향' }, {}, { now: NOW });
  assert.deepEqual([un.book.projects[1].name, un.book.projects[1].lead, un.changed], ['수소 추진 2', '성춘향', ['name', 'lead']]);
  // 기간 — 종료일이 시작일보다 앞서면 비운다, 시작일이 없으면 종료일도
  assert.deepEqual((() => { const q = applyProject(b, 'P1', { wsId: 'a', end: '2020-01-01' }).book.projects[0]; return [q.start, q.end]; })(), ['2026-04-01', '']);
  assert.deepEqual((() => { const q = applyProject(b, 'P1', { wsId: 'a', start: '' }).book.projects[0]; return [q.start, q.end]; })(), ['', '']);
  // 아무 칸도 안 오면 바뀐 것 없음 — memo 의 at 는 줄지 않는다
  const none = applyProject(b, 'P1', { at: 10 }, { P1: { id: 'a', at: 100 } });
  assert.deepEqual([none.changed, none.memo.P1], [[], { id: 'a', at: 100 }]);
});
t('별칭(정본 toLocalYear 의 alias 칸) — 그대로 받되 다른 과제가 쓰는 별칭이면 -2 를 붙이고 지금 시각으로(이 기기가 늦게 고친 것으로 퍼진다)', () => {
  const b = book();
  const r = applyProject(b, 'P1', { alias: 'MVDC', aliasAt: 777 }, {}, { now: NOW });
  assert.deepEqual([r.book.projects[0].alias, r.book.projects[0].aliasAt, r.alias, r.aliasFixed, r.changed], ['MVDC', 777, 'MVDC', false, ['alias']]);
  const same = applyProject(b, 'P1', { alias: 'SSCB', aliasAt: 2 }, {}, { now: NOW });
  assert.deepEqual([same.book.projects[0].aliasAt, same.changed], [5, []], '같은 별칭이면 시각은 큰 쪽');
  const dup = applyProject(b, 'P1', { alias: 'h2', aliasAt: 777 }, {}, { now: NOW });
  assert.deepEqual([dup.book.projects[0].alias, dup.book.projects[0].aliasAt, dup.aliasFixed], ['h2-2', NOW, true], '띄어쓰기·대소문자를 가리지 않고 겹침을 본다');
  const twice = applyProject(dup.book, 'c', { wsId: 'c', alias: 'H2' }, {}, { now: NOW });
  assert.equal(twice.book.projects[2].alias, 'H2-3', '-2 도 쓰고 있으면 -3');
  const empty = applyProject(b, 'P1', { alias: '', aliasAt: 0 }, {}, { now: NOW });
  assert.deepEqual([empty.book.projects[0].alias, empty.book.projects[0].aliasAt], ['', 0], '빈 별칭도 받는다(파일 쪽이 비웠다)');
  // 별칭 없이 aliasAt 만 오면 큰 쪽으로만
  assert.equal(applyProject(b, 'P1', { aliasAt: 9 }).book.projects[0].aliasAt, 9);
});
t('다른 기기가 따로 만든 같은 과제 — 파일의 wsId 로 장부 id 를 바꾼다(보고 있던 과제·차년도도 따라감)', () => {
  const b = book();
  const r = applyProject(b, 'P1', { prjNo: 'P1', wsId: 'remoteA', note: 'x' }, { P1: { id: 'a', at: 1 } }, { now: NOW });
  assert.deepEqual([r.renamed, r.id, r.changed], [['a', 'remoteA'], 'remoteA', ['note', 'id']]);
  assert.deepEqual([r.book.projects[0].id, r.book.current.project, r.book.current.year], ['remoteA', 'remoteA', { remoteA: 1, b: 2 }]);
  assert.equal(r.memo.P1.id, 'remoteA');
  const clash = applyProject(b, 'P1', { prjNo: 'P1', wsId: 'b' }, {}, { now: NOW });
  assert.equal(clash.renamed, null, '이미 다른 과제가 쓰는 id 로는 바꾸지 않는다');
  assert.equal(clash.id, 'b', 'wsId 가 먼저 맞으니 그 과제다');
});
t('묘비 — project.deletedAt 가 있으면 장부에서 지운다(보고 있던 과제면 첫 과제로), 없는 과제면 아무것도 안 함', () => {
  const b = book();
  const r = applyProject(b, 'P1', { wsId: 'a', deletedAt: NOW }, { P1: { id: 'a', at: 1 }, Q: { at: 2 } }, { now: NOW });
  assert.deepEqual([r.removed, r.id, r.created, r.book.projects.map((p) => p.id)], [true, 'a', false, ['b', 'c']]);
  assert.deepEqual(r.book.current, { project: 'b', year: { b: 2 } });
  assert.deepEqual(r.memo, { Q: { at: 2 } });
  assert.equal(b.projects.length, 3);
  const none = applyProject(b, 'ZZ', { prjNo: 'ZZ', prjNm: '없는 과제', deletedAt: NOW }, {}, { now: NOW });
  assert.deepEqual([none.removed, none.created, none.book.projects.length], [false, false, 3]);
});
t('별칭만 온 payload(정본 toLocalYear 의 alias 칸)로는 과제를 만들지 않는다 — 지운 과제의 열쇠로 별칭이 되돌아올 때 빈 과제가 되살아나지 않게(2026-10-19 검토)', () => {
  const b = book();
  const memo = { GONE: { id: 'zz', at: 1 } };
  const r = applyProject(b, 'GONE', { alias: 'X', aliasAt: 5, at: 9 }, memo, { now: NOW });
  assert.deepEqual([r.created, r.skipped, r.id, r.changed, r.book.projects.length, r.memo], [false, false, '', [], 3, memo], '만들지도, memo 를 적지도 않는다');
  assert.equal(applyProject(b, 'GONE', { alias: 'X' }, {}, { now: NOW }).created, false);
  assert.equal(applyProject(b, 'GONE', { alias: 'X', jobId: '' }, {}, { now: NOW }).created, true, 'project 칸(jobId 등)이 함께 오면 만든다 — 이름은 별칭');
  assert.equal(applyProject(b, 'GONE', { alias: 'X', jobId: '' }, {}, { now: NOW }).book.projects.at(-1).name, 'X');
  assert.equal(applyProject(b, 'P1', { alias: 'MVDC', aliasAt: 7 }, {}, { now: NOW }).book.projects[0].alias, 'MVDC', '있는 과제의 별칭은 그대로 받는다');
});
t('열쇠만으로도 과제를 찾는다 — 장부 id · Job Id · rERP 과제번호 · memo 에 적어 둔 id', () => {
  const b = book();
  assert.equal(applyProject(b, 'c', { note: '1' }).id, 'c');
  assert.equal(applyProject(b, 'RND00302026', { note: '1' }).id, 'b');
  assert.equal(applyProject(b, 'P1', { note: '1' }).id, 'a');
  assert.equal(applyProject(b, 'K', { note: '1' }, { K: { id: 'c', at: 0 } }).id, 'c');
  assert.equal(applyProject(b, 'K', { note: '1' }).created, true, '못 찾으면 만든다');
});

console.log('정본(rerp/prjdoc.js — kr_ext_rerp lib/prjdoc.js 를 옮긴 것)과의 왕복');
let D = null;
try { D = (await import('../rerp/prjdoc.js')).default; } catch (err) { console.log('  --  rerp/prjdoc.js 를 아직 못 불러온다(포팅 에이전트 몫) — 왕복 검사는 건너뜀: ' + String(err?.message || err).split('\n')[0]); }
if (D && typeof D.mergeYear === 'function') {
  const KEY = 'P1', N = 1, WHO = '나';
  /** loadLocal() — 배선이 머리 주석대로 만드는 것 */
  const localOf = (p, { at = 0, budgetAt = 0, recs = [] } = {}) => ({
    plan: { plans: {}, del: {} }, research: researchOf(recs, p, KEY), staff: { plans: Object.fromEntries([[`${KEY}@${N}`, localPlanOf(p, N, KEY, { at: budgetAt, by: WHO })]].filter(([, v]) => v)), del: {} },
    aliases: { [KEY]: p.alias }, aliasesAt: { [KEY]: p.aliasAt || 0 }, changes: { [`${KEY}@${N}`]: yearOf(p, N, { by: WHO }).changes }, projects: { [KEY]: localProjectOf(p, N, { at, today: '2026-06-01' }) },
  });
  const META = { prjNm: 'ERP 과제명', rspr: '홍길동', who: WHO };
  const WANT = { budget: true, staff: false, research: true, changes: true, alias: true };
  await ta('직렬화·해석 왕복 — 이 장부의 칸(wsId·code·calendar)이 모르는 칸으로 보존되고 budget·changes 줄이 그대로', async () => {
    const p = linked();
    const y = yearOf(p, N, { budgetAt: 7, by: WHO, research: [REC('MVDC 차단기', 1)] });
    const doc = D.normalizeYear({ project: projectOf(p, N), year: y.year, budget: y.budget, changes: y.changes, research: y.research, updatedBy: WHO });
    const back = D.parse(D.serialize(doc), { year: N });
    assert.equal(back.kind, 'year');
    assert.deepEqual(back.doc.project, projectOf(p, N));
    assert.deepEqual(back.doc.budget, y.budget);
    assert.deepEqual(back.doc.changes, y.changes);
    assert.deepEqual(back.doc.research.map((r) => r.id), ['mvdc차단기#1']);
    assert.deepEqual(back.doc.year, { n: 1, start: '2026-04', end: '2027-03' });
    assert.equal(matchProject(book(), back.doc).id, 'a');
  });
  await ta('동료가 늦게 고친 파일을 받는다 — 예산 계획·별칭·비고·변경이력(합집합)이 장부에 들고, 집행·진행 기록은 그대로', async () => {
    const p = linked();
    const local = localOf(p, { at: 0, budgetAt: 0, recs: [REC('MVDC 차단기', 1)] });
    const L = D.fromLocalYear(KEY, N, local, META);
    assert.deepEqual(L.budget.map((r) => [r.name, r.plan, r.at]), [['인건비', 1000000, 0], ['연구시설·장비비', 2000000, 0]], '최소 사업비 계획에서 예산 줄이 나온다');
    assert.deepEqual([L.project.wsId, L.project.code, L.project.calendar, L.year], ['a', 'RS-1', false, { n: 1, start: '2026-04', end: '2027-03' }]);
    const remote = D.normalizeYear({
      project: { ...projectOf(p, N), alias: '동료별칭', aliasAt: NOW + 1, note: '동료 비고' }, year: { n: 1, start: '2026-04', end: '2027-03' },
      budget: [{ name: '인건비', plan: 3000000, at: NOW + 5, by: '동료' }],
      changes: [{ id: 'c2', date: '2026-10-02', kind: '기타', item: 'x', before: '', after: '', reason: 'r', by: '동료', at: 1, auto: false }],
      updatedAt: new Date(NOW + 10).toISOString(), updatedBy: '동료',
    });
    const m = D.mergeYear(L, remote, NOW + 20, WHO, { want: WANT, others: {}, localAt: D.localProjectAt(local, KEY) });
    assert.deepEqual(m.localChanged, { budget: true, staff: false, research: false, changes: true, alias: true, support: false, project: true });
    const back = D.toLocalYear(KEY, N, local, m);
    let r = applyYear(p, N, 'budget', back.budget);
    assert.deepEqual(r.project.years[1].budget.map((x) => [x.item, x.plan, x.used]), [['인건비', 3000000, 5000], ['연구활동비', null, null], ['연구시설·장비비', null, null]], '계획만 — 집행은 그대로');
    r = applyYear(r.project, N, 'changes', back.changes);
    assert.deepEqual(r.project.years[1].changes.map((c) => [c.id, c.by]), [['c1', WHO], ['c2', '동료']]);
    assert.equal(r.project.years[1].logs.length, 1, '진행 기록은 파일에 없으니 그대로');
    let b = { projects: [r.project, plain()], current: { project: 'a', year: {} } };
    const pr = applyProject(b, KEY, back.project, {}, { now: NOW + 20 });
    assert.deepEqual([pr.changed, pr.book.projects[0].note, pr.memo.P1.at >= NOW + 10], [['note'], '동료 비고', true]);
    const al = applyProject(pr.book, KEY, back.alias, pr.memo, { now: NOW + 20 });
    assert.deepEqual([al.book.projects[0].alias, al.book.projects[0].aliasAt, al.changed], ['동료별칭', NOW + 1, ['alias']]);
    assert.deepEqual([m.doc.budget.length, m.doc.changes.length, m.doc.project.alias, m.remoteChanged], [1, 2, '동료별칭', true], '파일에는 합집합이 쓰인다(변경이력)');
    // 받은 뒤 memo 규칙대로 다시 내보내면 바뀐 것 없음
    const p2 = al.book.projects[0];
    const again = D.mergeYear(D.fromLocalYear(KEY, N, localOf(p2, { at: pr.memo.P1.at, budgetAt: back.budget.at, recs: [REC('MVDC 차단기', 1)] }), META), m.doc, NOW + 30, WHO, { want: WANT, others: {}, localAt: pr.memo.P1.at });
    assert.deepEqual(Object.values(again.localChanged).some(Boolean), false, '받은 것을 다시 받지 않는다');
  });
  await ta('이 기기에서 늦게 고친 예산·별칭은 파일로 간다(budgetAt 이 지금이면 이김) — 집행·진행 기록은 가지 않는다', async () => {
    const p = linked();
    p.years[1].budget[0].plan = 1234000;
    p.alias = '내별칭'; p.aliasAt = NOW + 50;
    const local = localOf(p, { at: NOW, budgetAt: NOW + 50 });
    const remote = D.normalizeYear({ project: projectOf(linked(), N), year: { n: 1 }, budget: [{ name: '인건비', plan: 1000000, at: NOW, by: '동료' }], updatedAt: new Date(NOW).toISOString(), updatedBy: '동료' });
    const m = D.mergeYear(D.fromLocalYear(KEY, N, local, META), remote, NOW + 60, WHO, { want: WANT, others: {}, localAt: D.localProjectAt(local, KEY) });
    assert.deepEqual([m.remoteChanged, m.localChanged.budget, m.localChanged.alias], [true, false, false]);
    assert.deepEqual(m.doc.budget.map((r) => [r.name, r.plan, r.at, r.by]), [['인건비', 1234000, NOW + 50, WHO], ['연구시설·장비비', 2000000, NOW + 50, WHO]]);
    assert.deepEqual([m.doc.project.alias, m.doc.project.aliasAt, m.doc.staff.plans], ['내별칭', NOW + 50, []], 'staff 를 끄면 최소 계획은 파일로 가지 않는다');
    assert.ok(!JSON.stringify(m.doc).includes('진행 기록') && !JSON.stringify(m.doc).includes('"used"'));
  });
}

console.log('참여인력 공유 권한(2026-10-19 "체크하면 반영") — 이름 → 이메일 캐시와 권한 표의 줄');
t('normalizePeople — 이름 → 이메일(소문자)·표시 이름·로그인·시각만, 이메일 없는 것·빈 이름·모르는 칸은 버린다', () => {
  assert.equal(PEOPLE_KEY, 'rndSharePeople');
  assert.deepEqual(normalizePeople(null), {});
  assert.deepEqual(normalizePeople([1]), {});
  assert.deepEqual(normalizePeople({ '문창재': { email: ' CJMoon@krs.co.kr ', title: 'MOON Changjae', login: 'i:0#.f|membership|cjmoon@krs.co.kr', at: 5, x: 1 }, '없음': { title: 'x' }, ' ': { email: 'a@b' }, '김거화': { email: 'nomail' }, '홍길동': 'hong@krs.co.kr' }),
    { '문창재': { email: 'cjmoon@krs.co.kr', title: 'MOON Changjae', login: 'i:0#.f|membership|cjmoon@krs.co.kr', at: 5 } });
  assert.deepEqual(normalizePeople({ '박기도': { email: 'park@krs.co.kr' } }), { '박기도': { email: 'park@krs.co.kr', title: '', login: '', at: 0 } });
});
t('permRows — 이름은 이메일로 폴더 권한과 맞추고(표시 이름은 영문), 못 찾은 이름은 lookup/ambiguous/notFound, 나는 빼고(이름·폴더의 me·이메일), 폴더에만 있는 사람은 뒤에 extra, 중복·빈 이름은 한 번', () => {
  const perms = { me: { id: 3, email: 'kimghw@krs.co.kr', name: 'KIM Geohwa' }, people: [
    { id: 1909, name: 'MOON Changjae', email: 'CJMoon@krs.co.kr', role: 'edit', me: false },
    { id: 1944, name: 'LEE Jaehoon', email: 'jhlee81@krs.co.kr', role: 'read', me: false },
    { id: 3, name: 'KIM Geohwa', email: 'kimghw@krs.co.kr', role: 'edit', me: true },
    { id: 2040, name: 'ROH Gilltae', email: 'gtroh@krs.co.kr', role: 'owner', me: false },
    { id: 9, name: '김 거화', email: 'me2@krs.co.kr', role: 'edit', me: false },
  ], links: [{ id: 3478, name: 'SharingLinks.x.OrganizationEdit.y', role: 'edit' }] };
  const people = { '문창재': { email: 'cjmoon@krs.co.kr', title: 'MOON Changjae' }, '이영희': { ambiguous: ['LEE A <a@krs.co.kr>', 'LEE B <b@krs.co.kr>'] }, '없는사람': { notFound: true }, '박기도': { email: 'park@krs.co.kr', title: 'PARK Kido' } };
  const rows = permRows(['문창재', '김거화', ' 이영희 ', '없는사람', '새사람', '문창재', '', null, '박기도'], perms, people, { me: '김거화' });
  assert.deepEqual(rows.map((r) => [r.name, r.email, r.title, r.id, r.role, r.state, r.extra]), [
    ['문창재', 'cjmoon@krs.co.kr', 'MOON Changjae', 1909, 'edit', '', false],
    ['이영희', '', '', 0, '', 'ambiguous', false],
    ['없는사람', '', '', 0, '', 'notFound', false],
    ['새사람', '', '', 0, '', 'lookup', false],
    ['박기도', 'park@krs.co.kr', 'PARK Kido', 0, '', '', false],
    ['LEE Jaehoon', 'jhlee81@krs.co.kr', 'LEE Jaehoon', 1944, 'read', '', true],
    ['ROH Gilltae', 'gtroh@krs.co.kr', 'ROH Gilltae', 2040, 'owner', '', true],
  ], '김거화(나)는 이름으로도 폴더의 me 로도 공백만 다른 이름으로도 오지 않는다');
  assert.deepEqual(rows[1].candidates, ['LEE A <a@krs.co.kr>', 'LEE B <b@krs.co.kr>']);
  assert.deepEqual(permRows(['a'], null, null), [{ name: 'a', email: '', title: '', id: 0, role: '', state: 'lookup', candidates: [], extra: false }]);
  assert.deepEqual(permRows([], perms, {}, { me: '김거화' }).map((r) => r.name), ['MOON Changjae', 'LEE Jaehoon', 'ROH Gilltae'], '이름이 없으면 폴더의 사람만 extra 로');
});

t('planOfResearch — 공유 폴더 연구내용 기록을 연구개발 계획 ■ 절 글로(2026-10-27)', () => {
  const r = planOfResearch({ n: 1, goals: ['A 개발', 'B'], contents: [{ item: '항목1', details: ['세부'] }], perf: [{ name: '효율', target: '90', unit: '%', method: '시험' }], outputs: ['보고서'], schedule: { months: 9, items: [{ name: '설계', weeks: 4 }] } });
  assert.equal(r.title, '연구개발 계획 — 1차년도');
  assert.deepEqual(r.goals, ['A 개발', 'B']);
  assert.deepEqual(parseSections(r.text).map((s) => [s.title, s.note, s.items.length]), [['개발목표', '', 2], ['개발내용', '', 1], ['성능목표', '', 1], ['주요결과물', '', 1], ['수행일정', '9개월', 1]]);
  assert.match(r.text, /- 효율: 90 % \(시험\)/);
  assert.equal(planOfResearch({ n: 2, goals: [], contents: [] }), null);
  assert.equal(planOfResearch(null), null);
});

console.log(`\n${pass} passed`);
