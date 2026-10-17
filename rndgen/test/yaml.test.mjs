// R&D 탭의 YAML 손질(rndgen/yaml.js) — 풀기, 뽑은 답 검사(꼴·차년도·예산 행·총액), 마무리(판·머리 주석 — src/rndyaml.js headerOf 가 태그·변경분을
// 되읽는 꼴, 본문 주석 보존), 다음 판, 미리보기 요약, 구조 차이(열쇠로 짝지은 path)와 그 글, 장부 사본에 미리 넣기(원본 불변·새 변경이력·older),
// 장부 → 기준 YAML(되넣어도 변경이력이 헛돌지 않음), 파일 이름. 검사 자료는 지어낸 값만(test/fixtures/rnd · rndgen/test/fixtures).
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { parse } from '../../vendor/yaml/index.js';
import { normalizeBook } from '../../src/rnd.js';
import { kindOf, readSnapshot, headerOf, applyYaml } from '../../src/rndyaml.js';
import {
  parseYaml, checkExtracted, finalizeExtracted, finalizeRevised, nextRev, stageCount, summarizeSnapshot, diffYaml, diffLines, previewApply, bookToSnapshot, fileName,
} from '../yaml.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const fx = (name) => fs.readFileSync(new URL(`../../test/fixtures/rnd/${name}`, import.meta.url), 'utf8');
const own = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const TODAY = '2026-10-16';
const R0 = fx('snapshot_r0.yaml');
const R2 = fx('snapshot_r2.yaml');
const RAW = own('extract_raw.yaml');

console.log('풀기');
await ta('YAML 글 → 객체 · 통째로 감싼 코드 펜스와 BOM 은 벗김', async () => {
  const r = await parseYaml(R0);
  assert.deepEqual([r.ok, r.error, r.obj.meta.과제명], [true, '', '시험용 직류 차단기 개발']);
  const fenced = await parseYaml('```yaml\nmeta:\n  과제명: 가\n```\n');
  assert.deepEqual([fenced.ok, fenced.obj], [true, { meta: { 과제명: '가' } }]);
  assert.equal((await parseYaml('﻿a: 1')).obj.a, 1);
});
await ta('못 풀면 ok:false 와 첫 줄 까닭 — 빈 글·주석뿐·겹친 키·깨진 글', async () => {
  assert.deepEqual(await parseYaml(''), { ok: false, obj: null, error: 'YAML 글이 비어 있습니다' });
  assert.match((await parseYaml('# 주석뿐\n')).error, /내용이 없습니다/);
  const dup = await parseYaml('meta:\n  a: 1\n  a: 2\n');
  assert.equal(dup.ok, false);
  assert.match(dup.error, /^Map keys must be unique/);
  assert.ok(!dup.error.includes('\n'), '첫 줄만');
  assert.equal((await parseYaml('meta: [1, 2\n')).ok, false);
  assert.equal((await parseYaml('a: 1\n---\nb: 2\n')).ok, false, '문서 둘');
});

console.log('뽑은 답 검사');
await ta('스냅샷 꼴 · 고른 차년도와 같고 · 예산 행과 총액이 맞으면 problems·warnings 없음', async () => {
  const c = await checkExtracted(RAW, { stage: 2 });
  assert.deepEqual([c.ok, c.problems, c.warnings], [true, [], []]);
  assert.deepEqual([c.snap.n, c.snap.project.name, c.snap.project.code], [2, '모의 해상풍력 케이블 진단 기술 개발', 'RS-2099-00000042']);
  assert.equal(c.obj.meta.차년도, '2차년도');
  const auto = await checkExtracted(RAW);
  assert.deepEqual([auto.ok, auto.warnings, auto.snap.n], [true, [], 2], 'stage 없으면 meta.차년도 를 따른다');
  assert.deepEqual((await checkExtracted(R0, { stage: '1차년도' })).warnings, [], 'stage 는 "1차년도" 글이어도 된다');
});
await ta('고른 차년도와 다르면 warnings(차년도는 마무리가 고쳐 씀) — 그 차년도 행이 없고 다른 차년도 행이 섞였다고도', async () => {
  const c = await checkExtracted(RAW, { stage: 3 });
  assert.equal(c.ok, true);
  assert.deepEqual(c.warnings, [
    'meta.차년도(2차년도)가 고른 3차년도와 다릅니다 — 3차년도로 고쳐 적습니다',
    '예산.비목별 에 3차년도 행이 없습니다 — 이 차년도 예산이 들어가지 않습니다',
    '예산.비목별 에 다른 차년도 행(2차년도)도 있습니다 — 그 행은 넣지 않습니다',
  ]);
  assert.equal(c.snap.n, 3, 'snap 은 고른 차년도로 친 모습');
});
await ta('meta.차년도 가 없으면 — stage 가 있으면 warnings, 없으면 problems(몇 차년도인지 모른다)', async () => {
  const text = RAW.replace(/^ {2}차년도: .*$/m, '');
  const none = await checkExtracted(text);
  assert.equal(none.ok, false);
  assert.match(none.problems[0], /^meta\.차년도 가 없습니다/);
  assert.equal(none.snap.project.name, '모의 해상풍력 케이블 진단 기술 개발', '스냅샷이면 snap 은 준다');
  const given = await checkExtracted(text, { stage: 2 });
  assert.deepEqual([given.ok, given.warnings], [true, ['meta.차년도 가 없어 2차년도로 적습니다']]);
});
await ta('비목 합 ≠ 총액 · 모르는 단위 · 단위 없음 · 예산 블록 없음 · 금액 없는 행 → warnings', async () => {
  assert.deepEqual((await checkExtracted(RAW.replace('총액: 100000', '총액: 99000'), { stage: 2 })).warnings, ['예산.비목별[2차년도] 비목 합 100,000 ≠ 총액 99,000 (천원)']);
  assert.match((await checkExtracted(RAW.replace('단위: 천원', '단위: 만원'))).warnings[0], /^예산\.단위\(만원\)를 모릅니다/);
  assert.deepEqual((await checkExtracted(RAW.replace('  단위: 천원\n', ''))).warnings, ['예산.단위 가 없어 천원으로 봅니다']);
  assert.deepEqual((await checkExtracted('meta:\n  과제명: 가\n  차년도: 1차년도\n')).warnings, ['예산 블록이 없습니다 — 1차년도 예산이 들어가지 않습니다']);
  assert.deepEqual((await checkExtracted('meta: {과제명: 가, 차년도: 1차년도}\n예산: {단위: 천원, 비목별: [{연차: 1차년도, 직접비: {인건비: 0}}]}\n')).warnings, ['예산.비목별[1차년도] 에 금액이 없습니다']);
});
await ta('스냅샷이 아니면 problems — 이력 파일 · 목록 · 못 푸는 글', async () => {
  const hist = await checkExtracted(fx('revisions.yaml'));
  assert.deepEqual([hist.ok, hist.snap, hist.problems], [false, null, ['meta.과제명 이 없습니다 — 스냅샷(meta · 연구개발내용 · 예산) 꼴이 아닙니다']]);
  assert.deepEqual((await checkExtracted('- a\n- b\n')).problems, ['맨 위가 「키: 값」 꼴이 아닙니다']);
  const bad = await checkExtracted('meta: [1');
  assert.deepEqual([bad.ok, bad.obj], [false, null]);
  assert.match(bad.problems[0], /^YAML 로 풀리지 않습니다 — /);
});

console.log('마무리 — 뽑기');
await ta('meta.차년도·rev(r0)·source 를 적고 머리 두 줄(태그·뽑음) 아래 원래 설명은 남김 — 본문 주석도 산다', async () => {
  const f = await finalizeExtracted(RAW, { stage: 2, today: TODAY, source: '사업계획서.pdf' });
  const h = headerOf(f.text);
  assert.equal(h.tag, '2차년도 최초');
  assert.equal(h.changed, '');
  assert.deepEqual(h.lines, [
    '[2차년도 최초]', 'KRS WORKSPACE 가 사업계획서에서 뽑음 2026-10-16 · 원본: 사업계획서.pdf',
    'KR(한국선급) 연구개발 내용·예산 구조화 스냅샷 — 검사용 가짜(과제명·과제번호·기관·사람·금액 모두 지어낸 것)',
  ]);
  assert.equal(f.text.split('\n')[0], '# [2차년도 최초]', '파일 첫 줄이 마커(스킬의 규칙)');
  assert.deepEqual([f.obj.meta.차년도, f.obj.meta.rev, f.obj.meta.source], ['2차년도', 'r0', '사업계획서.pdf']);
  assert.deepEqual(Object.keys(f.obj.meta).slice(-3), ['source', 'rev', '표지'], '없던 키는 structured_output.md 의 차례 자리에');
  assert.match(f.text, /차년도: 2차년도 # 오늘\(2026-10-16\)이 든 차년도/);
  assert.match(f.text, /연구재료비: 15000 # 시편 제작 재료/);
  assert.match(f.text, /사업명: \{세부: 모의해양기술개발사업, 내역: 가상풍력\}/, '한 줄 묶음은 한 줄 그대로');
  assert.deepEqual(parse(f.text), f.obj);
  assert.equal(kindOf(f.obj), 'snapshot');
  assert.equal(readSnapshot(f.obj).n, 2);
  const again = await finalizeExtracted(f.text, { stage: 2, today: TODAY, source: '사업계획서.pdf' });
  assert.equal(again.text, f.text, '다시 마무리해도 머리가 겹치지 않는다');
});
await ta('고른 차년도가 다르면 meta.차년도 를 고쳐 쓴다(그 줄 주석은 둔다) · 이미 있는 rev·source 는 둔다', async () => {
  const f = await finalizeExtracted(RAW, { stage: 3, today: TODAY, source: 'x.pdf' });
  assert.equal(headerOf(f.text).tag, '3차년도 최초');
  assert.match(f.text, /차년도: 3차년도 # 오늘/);
  const kept = await finalizeExtracted('meta:\n  과제명: 가\n  rev: r1\n  source: a.pdf\n', { stage: 1, today: TODAY, source: 'b.pdf' });
  assert.deepEqual([kept.obj.meta.rev, kept.obj.meta.source], ['r1', 'a.pdf']);
  assert.equal(headerOf(kept.text).lines[1], 'KRS WORKSPACE 가 사업계획서에서 뽑음 2026-10-16 · 원본: b.pdf');
});
await ta('LLM 이 적은 머리 — 첫 키에 붙은 주석·--- 뒤 주석도 머리로 보고 옛 태그 줄은 뺀다', async () => {
  const f = await finalizeExtracted('# [1차년도 최초]\n# 설명 줄\nmeta:\n  과제명: 가\n  단계: 1단계\n  연차범위: [1차년도]\n', { stage: 1, today: TODAY, source: '' });
  assert.deepEqual(headerOf(f.text).lines, ['[1차년도 최초]', 'KRS WORKSPACE 가 사업계획서에서 뽑음 2026-10-16', '설명 줄']);
  assert.equal(f.text.split('\n').filter((l) => l === '# 설명 줄').length, 1, '첫 키 앞에 남지 않는다');
  assert.deepEqual(Object.keys(f.obj.meta), ['과제명', '단계', '차년도', '연차범위', 'rev'], '차년도는 연차범위 앞에, source 는 원본이 없어 안 적음');
  const doc = await finalizeExtracted('---\n# [9차년도 최초]\nmeta:\n  과제명: 가\n', { stage: 1, today: TODAY, source: 'a.pdf' });
  assert.equal(headerOf(doc.text).tag, '1차년도 최초');
  assert.doesNotMatch(doc.text, /9차년도/);
  const fenced = await finalizeExtracted('```yaml\nmeta:\n  과제명: 가\n```', { stage: 2, today: TODAY, source: 'a.pdf' });
  assert.equal(fenced.obj.meta.차년도, '2차년도');
});
await ta('스냅샷이 아니거나 못 풀면 던진다', async () => {
  await assert.rejects(finalizeExtracted(fx('revisions.yaml'), { stage: 1, today: TODAY, source: '' }), /meta\.과제명 이 없습니다/);
  await assert.rejects(finalizeExtracted('meta: [1', { stage: 1, today: TODAY, source: '' }), /^Error: YAML 로 풀리지 않습니다/);
  await assert.rejects(finalizeRevised('- 1\n', { rev: 'r1', today: TODAY, summary: '' }), /「키: 값」/);
});

console.log('마무리 — 고치기');
const SUMMARY = '예산.비목별[1차년도].직접비.연구재료비 0 → 5,000 · 참여연구자 김철수 추가';
await ta('meta.rev = rN, 머리 첫 줄 [재생성 rN] · 둘째 줄 변경분 — headerOf 가 그대로 되읽고, 이전 태그·변경분 줄은 빠지고 나머지는 남는다', async () => {
  const f = await finalizeRevised(R2, { rev: 'r3', today: TODAY, summary: SUMMARY });
  const h = headerOf(f.text);
  assert.equal(h.tag, '재생성 r3');
  assert.equal(h.changed, SUMMARY);
  assert.deepEqual(h.lines, [
    '[재생성 r3] KRS WORKSPACE 변경사항 반영 2026-10-16', `변경분: ${SUMMARY}`, 'base = snapshot_r0 · overlay = history 최신 rev — researchers(r1) + budget(r2)',
  ]);
  assert.doesNotMatch(f.text, /\[재생성 r2\]/);
  assert.equal(f.obj.meta.rev, 'r3');
  assert.match(f.text, /연구시설장비비: 10000 # \[r2\] 연구활동비→재배분 신규 계상\(\+10000\)/, '본문 주석(태그 꼴이어도)은 둔다');
});
await ta('변경분은 한 줄로 펴고, 비면 줄을 두지 않는다 · rev 는 R4 도 r4 로 · 판 번호가 아니면 던진다 · meta.rev 가 없으면 넣는다', async () => {
  assert.equal(headerOf((await finalizeRevised(R2, { rev: 'r3', today: TODAY, summary: ' 가\n  나 ' })).text).changed, '가 나');
  const empty = await finalizeRevised(R2, { rev: 'R4', today: TODAY, summary: '' });
  assert.deepEqual([headerOf(empty.text).tag, headerOf(empty.text).changed, empty.obj.meta.rev], ['재생성 r4', '', 'r4']);
  await assert.rejects(finalizeRevised(R2, { rev: 'v2', today: TODAY, summary: '' }), /판 번호가 아닙니다/);
  const added = await finalizeRevised('meta:\n  과제명: 가\n  표지: {KR: {책임자: 홍길동}}\n', { rev: 'r1', today: TODAY, summary: 's' });
  assert.deepEqual(Object.keys(added.obj.meta), ['과제명', 'rev', '표지']);
});
await ta('고친 판을 장부에 넣으면 변경분이 변경이력의 사유가 된다(src/rndyaml.js)', async () => {
  const book = normalizeBook(null);
  applyYaml(book, parse(R2), { text: R2, file: 'KR_test_r2.yaml', today: TODAY });
  const f = await finalizeRevised(R2.replace('        연구수당: 6000', '        연구재료비: 5000\n        연구수당: 6000'), { rev: 'r3', today: TODAY, summary: SUMMARY });
  const pv = previewApply(book, f.obj, { text: f.text, file: fileName(book.projects[0], { rev: 'r3' }), today: TODAY });
  assert.deepEqual(pv.changes, [{ date: TODAY, kind: '예산', item: '연구재료비', before: '(없음)', after: '5,000,000원', reason: SUMMARY }]);
});

console.log('다음 판');
t('받은 것 가운데 가장 큰 판 + 1, 최소 r1 — 글·수·빈 것 섞어도', () => {
  assert.equal(nextRev('r2', 1, ''), 'r3');
  assert.equal(nextRev(), 'r1');
  assert.equal(nextRev('r0'), 'r1');
  assert.equal(nextRev(null, undefined, '', 'v9', -3, 1.5), 'r1');
  assert.equal(nextRev('R4', 2, '7'), 'r8');
  assert.equal(nextRev(0), 'r1');
});

console.log('차년도 수(모든 차년도 뽑기)');
t('meta.연차범위(목록·글) → 연차별기간의 키 → 연구기간 차례로 처음 읽히는 것, 못 읽으면 0', () => {
  assert.equal(stageCount(parse(R0)), 4);
  assert.equal(stageCount(parse(RAW)), 3);
  assert.equal(stageCount({ meta: { 연차범위: '1~4차년도' } }), 4);
  assert.equal(stageCount({ meta: { 연차범위: '1차년도 ~ 5차년도 (3+2)' } }), 5);
  assert.equal(stageCount({ meta: { 연차범위: '2025~2028', 연차별기간: { '1차년도': '2025-04-01 ~ 2025-12-31', '2차년도': '2026-01-01 ~ 2026-12-31' } } }), 2, '연도만 적힌 글은 차년도가 아니다');
  assert.equal(stageCount({ meta: { 과제명: '가', 기간: '2026-04-01 ~ 2028-12-31' } }), 3, '시작일부터 한 해씩');
  assert.equal(stageCount({ meta: { 과제명: '가', 기간: '2026-04-01' } }), 0, '종료일이 없으면 모른다');
  assert.equal(stageCount({ meta: { 연차범위: [] } }), 0);
  assert.equal(stageCount({ 표지: {} }), 0);
  assert.equal(stageCount(null), 0);
});

console.log('미리보기 요약');
t('과제·차년도·판, 비목별 천원 글과 합, 참여연구자 수, 개발목표', () => {
  assert.deepEqual(summarizeSnapshot(parse(R0)), {
    name: '시험용 직류 차단기 개발', code: 'RS-2026-00000001', lead: '홍길동', start: '2026-04-01', end: '2029-12-31', n: 1, rev: 'r0',
    budget: [{ item: '인건비', thousand: '30,000' }, { item: '연구활동비', thousand: '50,000' }, { item: '연구수당', thousand: '6,000' }, { item: '간접비', thousand: '20,000' }],
    totalThousand: '106,000', people: 3, goals: ['규정 공백 분석 및 평가 기준 도출', '용어 분류 체계 설계'],
  });
  const bare = summarizeSnapshot({ meta: { 과제명: '가' } });
  assert.deepEqual([bare.budget, bare.totalThousand, bare.people, bare.goals, bare.n], [[], '', 0, [], 1]);
});

console.log('구조 차이');
await ta('비목 변경·비목 뺌·참여자 추가(열쇠 성명)·참여자 값 변경 — 줄 차례가 바뀐 것은 차이가 아니다', async () => {
  const base = parse(R2);
  const after = structuredClone(base);
  after.연구개발내용.목표[0].개발목표[1] = '용어 사전 편찬';
  after.예산.비목별[0].직접비.연구활동비 = 35000;
  delete after.예산.비목별[0].직접비.연구수당;
  const people = after.예산.참여연구자인건비[0].참여자;
  people.reverse();
  people.find((x) => x.성명 === '홍길동').계상률 = 30;
  people.push({ 성명: '김철수', 직위: '선임', 계상률: 10 });
  const diff = await diffYaml(base, after);
  assert.deepEqual(diff, [
    { path: '연구개발내용.목표[1차년도].개발목표[2]', before: '용어 분류 체계 설계', after: '용어 사전 편찬', op: 'changed' },
    { path: '예산.비목별[1차년도].직접비.연구활동비', before: 40000, after: 35000, op: 'changed' },
    { path: '예산.비목별[1차년도].직접비.연구수당', before: 6000, after: null, op: 'removed' },
    { path: '예산.참여연구자인건비[1차년도].참여자[홍길동].계상률', before: 27.45, after: 30, op: 'changed' },
    { path: '예산.참여연구자인건비[1차년도].참여자[김철수].성명', before: null, after: '김철수', op: 'added' },
    { path: '예산.참여연구자인건비[1차년도].참여자[김철수].직위', before: null, after: '선임', op: 'added' },
    { path: '예산.참여연구자인건비[1차년도].참여자[김철수].계상률', before: null, after: 10, op: 'added' },
  ]);
  assert.deepEqual(diffLines(diff), [
    '연구개발내용.목표[1차년도].개발목표[2]: 용어 분류 체계 설계 → 용어 사전 편찬',
    '예산.비목별[1차년도].직접비.연구활동비: 40,000 → 35,000',
    '예산.비목별[1차년도].직접비.연구수당: 6,000 → (뺌)',
    '예산.참여연구자인건비[1차년도].참여자[홍길동].계상률: 27.45 → 30',
    '예산.참여연구자인건비[1차년도].참여자[김철수].성명: (없음) → 김철수',
    '예산.참여연구자인건비[1차년도].참여자[김철수].직위: (없음) → 선임',
    '예산.참여연구자인건비[1차년도].참여자[김철수].계상률: (없음) → 10',
  ]);
});
await ta('글을 받으면 풀어서 견준다 · 같으면 빈 목록 · 12000 과 "12000" 은 같다 · 못 풀면 던진다', async () => {
  assert.deepEqual(await diffYaml(R0, R0), []);
  assert.deepEqual(await diffYaml('a: 12000\n', 'a: "12000"\n'), []);
  const d = await diffYaml(R0, (await finalizeRevised(R0, { rev: 'r1', today: TODAY, summary: 's' })).text);
  assert.deepEqual(diffLines(d), ['meta.rev: r0 → r1'], '마무리는 판만 바꾼다(머리 주석은 차이가 아니다)');
  await assert.rejects(diffYaml('a: [1', 'a: 1'), /기준 YAML 을 풀지 못했습니다/);
});
await ta('열쇠 차례 — 연차가 겹치는 목록은 다음 열쇠(명칭)로, 열쇠가 없으면 자리로 · 꼴이 바뀌면 뺌+더함 · 빈 목록에서 채운 것', async () => {
  const a = { 세부사용계획: [{ 연차: '1차년도', 명칭: '국내여비', 금액: 4000 }, { 연차: '1차년도', 명칭: '회의비', 금액: 1000 }] };
  const b = { 세부사용계획: [{ 연차: '1차년도', 명칭: '회의비', 금액: 1500 }, { 연차: '1차년도', 명칭: '국내여비', 금액: 4000 }] };
  assert.deepEqual(await diffYaml(a, b), [{ path: '세부사용계획[회의비].금액', before: 1000, after: 1500, op: 'changed' }]);
  assert.deepEqual(await diffYaml({ l: [{ x: 1 }, { x: 2 }] }, { l: [{ x: 1 }] }), [{ path: 'l[2].x', before: 2, after: null, op: 'removed' }]);
  assert.deepEqual(await diffYaml({ a: '글' }, { a: { b: 1 } }), [{ path: 'a', before: '글', after: null, op: 'removed' }, { path: 'a.b', before: null, after: 1, op: 'added' }]);
  assert.deepEqual(await diffYaml({ 참여자: [], 소계: null }, { 참여자: [{ 성명: '홍길동' }], 소계: 100 }), [
    { path: '참여자[홍길동].성명', before: null, after: '홍길동', op: 'added' }, { path: '소계', before: null, after: 100, op: 'changed' },
  ]);
});
t('차이 글 — 연도 칸은 쉼표 없이, 소수는 그대로, null 은 (비어 있음), 여러 줄 글은 " / "', () => {
  assert.deepEqual(diffLines([
    { path: '예산.세부사용계획[국내여비].연도', before: 2026, after: 2027, op: 'changed' },
    { path: 'x.계상률', before: 27.4567, after: 1234567.5, op: 'changed' },
    { path: 'x.소계', before: null, after: 30000, op: 'changed' },
    { path: 'x.글', before: '가\n나', after: '', op: 'changed' },
    { path: 'x.빈것', before: null, after: [], op: 'added' },
  ]), [
    '예산.세부사용계획[국내여비].연도: 2026 → 2027', 'x.계상률: 27.4567 → 1,234,567.5', 'x.소계: (비어 있음) → 30,000', 'x.글: 가 / 나 → ""', 'x.빈것: (없음) → []',
  ]);
  assert.deepEqual(diffLines(null), []);
});

console.log('장부 사본에 미리 넣기');
await ta('r0 가 든 장부에 r2 를 미리 넣으면 새 변경이력 세 줄(사유는 변경분) — 장부 원본은 그대로', async () => {
  const book = normalizeBook(null);
  applyYaml(book, parse(R0), { text: R0, file: 'KR_test.yaml', today: TODAY });
  const frozen = JSON.stringify(book);
  const pv = previewApply(book, parse(R2), { text: R2, file: 'KR_test_r2.yaml', today: TODAY });
  assert.deepEqual([pv.ok, pv.error, pv.created, pv.older, pv.n, pv.projectId], [true, '', false, '', 1, book.projects[0].id]);
  assert.equal(pv.result.kind, 'snapshot');
  const reason = headerOf(R2).changed;
  assert.deepEqual(pv.changes, [
    { date: TODAY, kind: '예산', item: '연구시설·장비비', before: '(없음)', after: '10,000,000원', reason },
    { date: TODAY, kind: '예산', item: '연구활동비', before: '50,000,000원', after: '40,000,000원', reason },
    { date: TODAY, kind: '연구진', item: '참여연구자', before: '이몽룡 15% · 홍길동 20% · 성춘향 10%', after: '홍길동 27.45% · 성춘향 20%', reason },
  ]);
  assert.equal(JSON.stringify(book), frozen, '장부 원본 불변');
  assert.notEqual(pv.result.project, book.projects[0], '결과의 과제는 사본의 것');

  applyYaml(book, parse(R2), { text: R2, file: 'KR_test_r2.yaml', today: TODAY });
  const old = previewApply(book, parse(R0), { text: R0, today: TODAY });
  assert.deepEqual([old.ok, old.older, old.changes, old.n], [true, 'r2', [], 1], 'r2 뒤의 r0 는 더 오래된 판');
});
await ta('새 과제면 created(변경이력 없음 — 기준선) · 이력 파일은 current 를 사본의 과제로 바꿔 넘김 · 못 넣으면 ok:false', async () => {
  const book = normalizeBook(null);
  applyYaml(book, parse(R0), { text: R0, today: TODAY });
  const frozen = JSON.stringify(book);
  const fresh = await finalizeExtracted(RAW, { stage: 2, today: TODAY, source: 'a.pdf' });
  const pv = previewApply(book, fresh.obj, { text: fresh.text, today: TODAY });
  assert.deepEqual([pv.ok, pv.created, pv.n, pv.changes], [true, true, 2, []]);
  assert.ok(pv.projectId && !book.projects.some((p) => p.id === pv.projectId));

  const hist = previewApply(book, parse(fx('revisions.yaml')), { text: fx('revisions.yaml'), current: book.projects[0], today: TODAY });
  assert.deepEqual([hist.ok, hist.result.kind, hist.changes.length, hist.projectId], [true, 'revisions', 3, book.projects[0].id]);
  assert.match(hist.result.summary, /별칭 TEST 붙임/);
  assert.equal(book.projects[0].alias, '', '별칭은 사본에만');
  assert.equal(JSON.stringify(book), frozen);

  const none = previewApply(normalizeBook(null), parse(fx('budget_history.yaml')), { today: TODAY });
  assert.deepEqual([none.ok, none.result, none.changes, none.created], [false, null, [], false]);
  assert.match(none.error, /먼저 그 과제의 스냅샷/);
  assert.match(previewApply(book, { foo: 1 }, { today: TODAY }).error, /아는 모양의 YAML/);
});

console.log('장부 → 기준 YAML');
await ta('r0 를 넣은 장부로 지은 YAML — 스냅샷 꼴, 비목·계획·참여연구자·과제가 그대로 되읽히고, 미리 넣어도 변경이력이 생기지 않는다', async () => {
  const book = normalizeBook(null);
  applyYaml(book, parse(R0), { text: R0, file: 'KR_test.yaml', today: TODAY });
  const p = book.projects[0];
  const frozen = JSON.stringify(book);
  const b = await bookToSnapshot(book, p, 1, { today: TODAY });
  assert.equal(b.lossy, true);
  assert.equal(headerOf(b.text).tag, '장부에서 지음');
  assert.match(headerOf(b.text).lines[0], /저장된 YAML 원문이 없어 장부로 지은 기준\(손실 있음\) 2026-10-16$/);
  assert.deepEqual(parse(b.text), b.obj);
  assert.equal(kindOf(b.obj), 'snapshot');
  const s = readSnapshot(b.obj);
  const orig = readSnapshot(parse(R0));
  assert.deepEqual([s.n, s.rev], [1, 'r0']);
  assert.deepEqual(s.budget, orig.budget);
  assert.equal(s.plan.text, p.years[1].logs.find((l) => l.key === 'plan').text);
  assert.equal(s.roster.text, p.years[1].logs.find((l) => l.key === 'roster').text);
  const { note, ...proj } = orig.project;
  assert.deepEqual({ ...s.project, note: undefined }, { ...proj, note: undefined });
  assert.deepEqual(b.obj.예산.비목별, [{ 연차: '1차년도', 직접비: { 인건비: 30000, 연구활동비: 50000, 연구수당: 6000, 소계: 86000 }, 간접비: 20000, 총액: 106000 }]);
  assert.equal(b.obj.예산.단위, '천원');
  const pv = previewApply(book, b.obj, { text: b.text, today: TODAY });
  assert.deepEqual([pv.ok, pv.changes, pv.created], [true, [], false]);
  assert.doesNotMatch(pv.result.summary, /고침|넣음|변경이력/);
  assert.equal(JSON.stringify(book), frozen, '장부를 읽기만 한다');
});
await ta('2차년도·1월 1일 끊는 과제(뽑은 것을 넣은 장부)도 되넣어 변경이력이 생기지 않는다 — 연차별기간·성능목표 단위 % 까지', async () => {
  const book = normalizeBook(null);
  const f = await finalizeExtracted(RAW, { stage: 2, today: TODAY, source: 'a.pdf' });
  applyYaml(book, f.obj, { text: f.text, file: fileName(f.obj.meta.과제명), today: TODAY });
  const p = book.projects[0];
  assert.equal(p.calendar, true);
  const b = await bookToSnapshot(book, p.id, 2, { today: TODAY });
  assert.deepEqual(Object.keys(b.obj.meta.연차별기간), ['1차년도', '2차년도', '3차년도']);
  assert.deepEqual(b.obj.연구개발내용.성능목표, [{ 평가항목: '진단 정확도', 단위: '%', 목표치: { '2차년도': 90 }, 평가방법: '공인시험' }]);
  assert.deepEqual(b.obj.예산.참여연구자인건비[0].참여자[0], { 성명: '김가상', 직위: '책임', 참여기간_개월: 12, 계상률: 30, 계상인건비: 27000 });
  assert.match(b.text, /- \{성명: 김가상, 직위: 책임, 참여기간_개월: 12, 계상률: 30, 계상인건비: 27000\}/, '참여자는 한 줄 묶음');
  const pv = previewApply(book, b.obj, { text: b.text, today: TODAY });
  assert.deepEqual([pv.ok, pv.changes, pv.n], [true, [], 2]);
});
await ta('원 단위 끝자리가 있으면 단위 원 · 1월 1일에 시작해도 끊는 기준이 장부와 어긋나면 연차별기간을 뺌 · 없는 차년도는 빈 블록(장부는 그대로)', async () => {
  const book = normalizeBook({ projects: [{
    id: 'j', name: '정월 시작 가상 과제', start: '2026-01-01', end: '2027-12-31', calendar: false,
    years: { 1: { budget: [{ id: 'a', item: '인건비', plan: 1234567 }, { id: 'b', item: '연구시설·장비비', plan: 2000000 }, { id: 'c', item: '연구재료비', plan: null, used: 5 }] } },
  }] });
  const b = await bookToSnapshot(book, 'j', 1, { today: TODAY });
  assert.equal(b.obj.예산.단위, '원');
  assert.deepEqual(b.obj.예산.비목별[0], { 연차: '1차년도', 직접비: { 인건비: 1234567, 연구시설장비비: 2000000, 소계: 3234567 }, 총액: 3234567 });
  assert.equal(b.obj.meta.연차별기간, undefined);
  assert.deepEqual(readSnapshot(b.obj).budget, [{ item: '인건비', plan: 1234567 }, { item: '연구시설·장비비', plan: 2000000 }]);
  assert.equal(readSnapshot(b.obj).project.calendar, false);
  assert.deepEqual(previewApply(book, b.obj, { text: b.text, today: TODAY }).changes, []);

  const empty = await bookToSnapshot(book, book.projects[0], 2, { today: TODAY });
  assert.deepEqual(empty.obj.연구개발내용, { 목표: [] });
  assert.deepEqual(empty.obj.예산.비목별, [{ 연차: '2차년도', 직접비: {}, 총액: null }]);
  assert.deepEqual(empty.obj.예산.참여연구자인건비, [{ 연차: '2차년도', 참여자: [], 소계: null }]);
  assert.equal(kindOf(empty.obj), 'snapshot');
  assert.equal(book.projects[0].years[2], undefined, '빈 차년도를 장부에 달지 않는다');
  await assert.rejects(bookToSnapshot(book, '없는id', 1, { today: TODAY }), /장부에 그 과제가 없습니다/);
});

console.log('파일 이름');
t('KR_<과제명>.yaml · r1 이상이면 _rN — 공백·금지 글자는 _', () => {
  assert.equal(fileName('MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발', { rev: 'r2' }), 'KR_MW급_10kV_고전압_직류_시스템용_반도체_차단기_개발_r2.yaml');
  assert.equal(fileName({ name: '시험용 직류 차단기 개발' }), 'KR_시험용_직류_차단기_개발.yaml');
  assert.equal(fileName({ name: '시험용 직류 차단기 개발' }, { rev: 'r0' }), 'KR_시험용_직류_차단기_개발.yaml');
  assert.equal(fileName('가 나', { rev: 'R11' }), 'KR_가_나_r11.yaml');
  assert.equal(fileName(' A/B: "C"? <D>|E\\F* '), 'KR_A_B_C_D_E_F.yaml');
  assert.equal(fileName(''), 'KR_과제.yaml');
  assert.equal(fileName(null, { rev: 'r1' }), 'KR_과제_r1.yaml');
});

console.log(`\n${pass} passed`);
