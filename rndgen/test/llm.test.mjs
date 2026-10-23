// R&D 스냅샷 뽑기·YAML 고치기의 LLM 배관(rndgen/llm.js) — 입력 글의 배치(머리말 → 스킬 문서 → 재료)·자르기·울타리, 스킬 문서 외우기,
// askRndTask 의 던짐과 ask 끼우기, 진짜 askClaude(가짜 chrome 다리)를 지난 답이 관문(actions/spec/rnd 의 작업)에서 잘리지 않는지.
// 재료(Material)는 rndgen/source.js 를 import 하지 않고 계약서 §2.4 의 꼴로 여기서 짓는다(병렬 작업의 계약). 검사 자료는 지어낸 값뿐이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';

// import 만으로는 chrome 을 만지지 않는다 — chrome 이 없는 채로 가져온다.
delete globalThis.chrome;
const llm = await import('../llm.js');
const { SKILL_DOCS, INPUT_BUDGET, loadSkillDocs, resetSkillDocs, extractInput, reviseInput, askRndTask, askExtract, askRevise, pageRanges } = llm;
const { tuneOf } = await import('../../src/tasktune.js');

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const root = new URL('../../', import.meta.url);
const TODAY = '2026-10-16';
const INPUT_MAX = tuneOf('rnd.extract').inputMax;
const NO_CLAUDE = 'Claude 연결(로컬 CLI 또는 API 키)이 필요합니다 — 설정 → LLM';
const PROJECT = { name: '시험용 직류 차단기 개발', code: 'RS-2026-00000001', alias: 'SSCB', start: '2026-04-01', end: '2029-12-31', calendar: false };
const DOCS = { fields: 'FIELDS 문서', output: 'OUTPUT 문서' };
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const PICKED = [...range(1, 3), ...range(45, 52), ...range(118, 130)];
const PDF_FILE = { name: '사업계획서_발췌.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERg==' };
/** 계약서 §2.4 의 Material — 사업계획서 312쪽 가운데 24쪽을 고르고 작은 PDF 를 붙인 것. */
const material = (over = {}) => {
  const text = over.text ?? '— 1쪽 —\n과제명 시험용 직류 차단기 개발\n— 45쪽 —\n한국선급 연구개발비 사용계획';
  return { name: '사업계획서.pdf', kind: 'pdf', total: 312, picked: PICKED, text, chars: text.length, file: PDF_FILE, attach: 'slice', read: '사업계획서.pdf: 312쪽 가운데 24쪽', warnings: [], ...over };
};
const lines = (s) => s.split('\n');
const BASE = fs.readFileSync(new URL('test/fixtures/rnd/snapshot_r2.yaml', root), 'utf8');

console.log('스킬 문서');
await ta('SKILL_DOCS 는 확장 안의 파일이고 loadSkillDocs 가 둘을 읽는다(실제 파일)', async () => {
  for (const p of Object.values(SKILL_DOCS)) assert.ok(fs.existsSync(new URL(p, root)), p);
  resetSkillDocs();
  const docs = await loadSkillDocs(async (p, as) => { assert.equal(as, 'text'); return fs.readFileSync(new URL(p, root), 'utf8'); });
  assert.match(docs.fields, /target: "한국선급\(KR\)"/);
  assert.match(docs.output, /구조화 추출\(YAML\/JSON\) 스키마/);
});
await ta('한 번 읽으면 외운다 — resetSkillDocs() 뒤에 다시 읽는다. 바이트로 와도 글로 푼다', async () => {
  resetSkillDocs();
  const asked = [];
  const read = async (p) => { asked.push(p); return p.endsWith('.md') ? new TextEncoder().encode('출력 문서') : '필드 문서'; };
  const a = await loadSkillDocs(read);
  const b = await loadSkillDocs(read);
  assert.deepEqual(a, { fields: '필드 문서', output: '출력 문서' });
  assert.equal(a, b);
  assert.deepEqual(asked, [SKILL_DOCS.fields, SKILL_DOCS.output]);
  resetSkillDocs();
  await loadSkillDocs(read);
  assert.equal(asked.length, 4);
});
await ta('못 읽으면 경로와 까닭을 적어 던지고, 실패는 외우지 않는다(다음에 다시 읽는다)', async () => {
  resetSkillDocs();
  await assert.rejects(loadSkillDocs(async (p) => { if (p.endsWith('.md')) throw new Error('없음'); return '필드'; }),
    { message: `스킬 문서를 읽지 못했습니다 — ${SKILL_DOCS.output} (없음)` });
  await assert.rejects(loadSkillDocs(async (p) => (p.endsWith('.yaml') ? '  ' : '출력')), { message: `스킬 문서를 읽지 못했습니다 — ${SKILL_DOCS.fields} (빈 파일)` });
  assert.deepEqual(await loadSkillDocs(async () => '다시 읽음'), { fields: '다시 읽음', output: '다시 읽음' });
  resetSkillDocs();
});

console.log('뽑기 입력 글 — 머리말 → 스킬 문서 두 벌 → 재료 글(계약서 §5)');
t('머리말: 오늘 · 뽑을 차년도 · 장부 기준 차년도 · 장부의 과제 · 원본 문서(고른 쪽 범위와 작은 PDF)', () => {
  const input = extractInput(material(), { today: TODAY, stage: 2, project: PROJECT, currentStage: 2, docs: DOCS });
  const ls = lines(input);
  assert.deepEqual(ls.slice(0, 4), [
    '오늘은 2026-10-16 입니다.',
    '뽑을 차년도: 2차년도',
    '장부 기준 오늘이 든 차년도: 2차년도',
    '장부의 과제: 시험용 직류 차단기 개발 · 과제번호 RS-2026-00000001 · 별칭 SSCB · 연구기간 2026-04-01 ~ 2029-12-31',
  ]);
  assert.equal(ls[4], '원본 문서: 사업계획서.pdf — 312쪽 가운데 24쪽(1-3, 45-52, 118-130)의 글자를 실었고, 같은 쪽을 그 차례대로 담은 작은 PDF 를 붙였습니다(PDF 의 k번째 쪽이 글로 실은 k번째 쪽입니다).');
  assert.deepEqual(ls.slice(5), [
    '',
    '[스킬 규칙 1 — rnd-kr-extract/references/extract_fields.yaml — 무엇을 넣고 빼는가]', '<<<', 'FIELDS 문서', '>>>',
    '[스킬 규칙 2 — rnd-kr-extract/references/structured_output.md — 값의 모양]', '<<<', 'OUTPUT 문서', '>>>',
    '위 두 문서의 폴더·스크립트·에이전트·이력(init)·JSON 사본 절차는 무시합니다 — 여기서는 YAML 글 하나만 냅니다.',
    '',
    '[문서 글자]', '<<<', '— 1쪽 —', '과제명 시험용 직류 차단기 개발', '— 45쪽 —', '한국선급 연구개발비 사용계획', '>>>',
  ]);
});
t('차년도를 고르지 않았으면 "오늘이 든 차년도" — 장부를 모르면 장부 줄이 없다(틀린 차년도 수도 없는 것으로 본다)', () => {
  for (const stage of [null, undefined, 0, 21, '2', 1.5]) {
    const ls = lines(extractInput(material(), { today: TODAY, stage, project: null, currentStage: null, docs: DOCS }));
    assert.equal(ls[1], '뽑을 차년도: 오늘이 든 차년도(표지의 연차별 연구개발기간 표로 셈)', String(stage));
    assert.ok(ls[2].startsWith('원본 문서: '), '장부 기준 차년도·장부의 과제 줄이 없다');
  }
  const ls = lines(extractInput(material(), { today: TODAY, stage: null, project: { name: '과제', code: '', alias: '', start: '', end: '' }, currentStage: 3, docs: DOCS }));
  assert.deepEqual(ls.slice(2, 4), ['장부 기준 오늘이 든 차년도: 3차년도', '장부의 과제: 과제'], '빈 칸은 빼고 적는다');
});
t('원본 문서 문장 — 글자만(attach none)·원본째(original)·스캔본·문서(office/text)', () => {
  const head = (m) => lines(extractInput(m, { today: TODAY, docs: DOCS })).find((l) => l.startsWith('원본 문서: '));
  assert.equal(head(material({ attach: 'none', file: null })), '원본 문서: 사업계획서.pdf — 312쪽 가운데 24쪽(1-3, 45-52, 118-130)의 글자를 실었고, PDF 는 붙이지 않았습니다(글자만).');
  assert.match(head(material({ attach: 'original', total: 12, picked: [1, 2, 5] })), /12쪽 가운데 3쪽\(1-2, 5\)의 글자를 실었고, 원본 PDF 를 통째로 붙였습니다\(PDF 의 쪽 번호가 원본 쪽 번호입니다/);
  assert.match(head(material({ attach: 'original', total: 12, picked: [], text: '' })), /12쪽 — 글자 층이 없어 실은 글자가 없고, 원본 PDF 를 통째로 붙였습니다/);
  assert.equal(head(material({ name: '계획서.hwpx', kind: 'office', total: 40, picked: null, text: '가'.repeat(1234), chars: 1234, file: null, attach: 'none' })),
    '원본 문서: 계획서.hwpx — 글자만 실었습니다(1,234자 · 구역 40개 전부 — 빠짐없이).');
  assert.deepEqual([pageRanges([3, 1, 2, 2, 9, 10, 7]), pageRanges([]), pageRanges([5])], ['1-3, 7, 9-10', '', '5']);
});
t('부분(source.js 가 크기 제한 없이 나눈 것 — 2026-10-23): 몇째 부분인지와 쪽·구역 범위를 적고, 둘째 부분부터는 [앞 부분까지 뽑은 YAML] 을 스킬 문서 뒤·재료 앞에 싣는다', () => {
  const part = (no, over = {}) => material({ no, count: 3, pages: [71, 106], picked: range(71, 106), total: 312, ...over });
  const first = lines(extractInput(part(1), { today: TODAY, docs: DOCS }));
  assert.equal(first[2], '원본 문서: 사업계획서.pdf — 3부분으로 나뉘어 차례로 옵니다. 이번은 1/3부분: 312쪽 가운데 71-106쪽의 글자를 모두 실었고, 같은 쪽(71-106쪽)을 차례대로 담은 작은 PDF 를 붙였습니다(PDF 의 1쪽이 원본 71쪽입니다).');
  assert.ok(!first.some((l) => l.startsWith('이어 뽑기') || l.startsWith('[앞 부분까지 뽑은 YAML')), '첫 부분에는 앞 YAML 이 없다');
  const ls = lines(extractInput(part(2), { today: TODAY, docs: DOCS, prior: 'meta:\n  과제명: 시험용\n>>>' }));
  assert.equal(ls[3], '이어 뽑기: 앞 1부분까지 뽑은 YAML 이 아래 [앞 부분까지 뽑은 YAML] 에 있습니다 — 이번 부분의 글자로 더하고 고쳐 스냅샷 전문을 다시 냅니다(이번 부분에 없는 값은 그대로 둡니다).');
  const at = ls.indexOf('[앞 부분까지 뽑은 YAML — 3부분 가운데 1부분까지]');
  assert.ok(at > ls.indexOf('[스킬 규칙 2 — rnd-kr-extract/references/structured_output.md — 값의 모양]') && at < ls.indexOf('[문서 글자]'), '스킬 문서 뒤, 재료 앞');
  assert.deepEqual(ls.slice(at + 1, at + 6), ['<<<', 'meta:', '  과제명: 시험용', '> > >', '>>>'], '앞 YAML 도 울타리 안, >>> 는 > > >');
  const some = lines(extractInput(part(3, { picked: [71, 72, 100] }), { today: TODAY, docs: DOCS })).find((l) => l.startsWith('원본 문서'));
  assert.match(some, /이번은 3\/3부분: 312쪽 가운데 71-106쪽 — 글자가 든 3쪽\(71-72, 100\)의 글자를 실었고, 같은 쪽\(71-106쪽\)을/);
  const none = lines(extractInput(part(2, { attach: 'none', file: null }), { today: TODAY, docs: DOCS })).find((l) => l.startsWith('원본 문서'));
  assert.match(none, /글자를 모두 실었고, PDF 는 붙이지 않았습니다\(글자만\)\.$/);
  const scan = lines(extractInput(part(2, { picked: [], text: '' }), { today: TODAY, docs: DOCS })).find((l) => l.startsWith('원본 문서'));
  assert.match(scan, /312쪽 가운데 71-106쪽 — 글자 층이 없어 실은 글자가 없고, 같은 쪽\(71-106쪽\)을 차례대로 담은 작은 PDF/);
  const office = lines(extractInput(material({ name: '계획서.hwpx', kind: 'office', total: 40, no: 2, count: 4, chunks: [13, 24], picked: null, file: null, attach: 'none', text: '가'.repeat(100), chars: 100 }), { today: TODAY, docs: DOCS }))
    .find((l) => l.startsWith('원본 문서'));
  assert.equal(office, '원본 문서: 계획서.hwpx — 4부분으로 나뉘어 차례로 옵니다. 이번은 2/4부분: 글자만 실었습니다(100자 · 구역 13-24(전체 40개) — 빠짐없이).');
  const whole = lines(extractInput(material({ pages: [1, 312], picked: range(1, 312) }), { today: TODAY, docs: DOCS })).find((l) => l.startsWith('원본 문서'));
  assert.equal(whole, '원본 문서: 사업계획서.pdf — 312쪽의 글자를 모두 실었고, 같은 쪽(1-312쪽)을 차례대로 담은 작은 PDF 를 붙였습니다(PDF 의 1쪽이 원본 1쪽입니다).', '한 부분뿐이면 부분 말이 없다');
});
t('앞 부분까지의 YAML 은 자르지 않고 재료 예산을 그만큼 줄인다 — 전체는 다리의 입력 한도 안', () => {
  const input = extractInput(material({ no: 2, count: 2, text: 'ㄴ'.repeat(120_000) }), { today: TODAY, docs: DOCS, prior: 'y: 1\n'.repeat(8_000) });
  assert.ok(input.length <= INPUT_MAX, input.length);
  assert.equal(input.split('y: 1').length - 1, 8_000, '앞 YAML 은 그대로');
  assert.match(input, /…\([\d,]+자 더 있음 — 잘림\)\n>>>$/);
});
t('재료 글이 예산(100,000자)을 넘으면 뒤를 자르고 몇 자 더 있었는지 적는다 — 전체는 다리의 입력 한도(150,000자) 안', () => {
  const input = extractInput(material({ text: 'ㄱ'.repeat(INPUT_BUDGET.extractMaterial + 5) }), { today: TODAY, docs: DOCS });
  assert.ok(input.endsWith(`<<<\n${'ㄱ'.repeat(INPUT_BUDGET.extractMaterial)}\n…(5자 더 있음 — 잘림)\n>>>`));
  assert.equal(input.split('ㄱ').length - 1, INPUT_BUDGET.extractMaterial);
  // 스킬 문서가 커도 다리가 뒤를 말없이 자르지 않게 재료 예산을 줄인다.
  const big = extractInput(material({ text: 'ㄴ'.repeat(120_000) }), { today: TODAY, docs: { fields: 'F'.repeat(40_000), output: 'O'.repeat(30_000) } });
  assert.ok(big.length <= INPUT_MAX, big.length);
  assert.match(big, /…\([\d,]+자 더 있음 — 잘림\)\n>>>$/);
});
t('울타리 — 재료·스킬 문서 안의 >>> 는 > > > 로 바뀌어 >>> 줄은 울타리 셋뿐이다', () => {
  const input = extractInput(material({ text: '— 3쪽 —\n표 >>> 끝\n>>>\n>>>>' }), { today: TODAY, docs: { fields: 'a >>> b', output: '>>>' } });
  assert.equal(lines(input).filter((l) => l === '>>>').length, 3);
  assert.ok(input.includes('표 > > > 끝\n> > >\n> > > >'));
  assert.ok(input.includes('a > > > b'));
});
t('스킬 문서가 없으면 짓지 않는다', () => {
  assert.throws(() => extractInput(material(), { today: TODAY }), /스킬 문서가 없습니다 — loadSkillDocs 를 먼저 부르세요/);
});

console.log('고치기 입력 글 — 머리말 → [기준 YAML] → [변경사항] → [붙인 문서 글자]');
t('배치 — 지금 판과 "코드가 적는다" 를 머리에, 기준 YAML 은 그대로', () => {
  const input = reviseInput({
    baseYaml: BASE, text: '2차년도 연구재료비 12,000 → 15,000', today: TODAY, project: PROJECT, n: 2, rev: 'r2',
    materials: [{ ...material(), name: '변경승인.pdf', text: '— 1쪽 —\n변경 승인 >>> 끝' }],
  });
  const ls = lines(input);
  assert.deepEqual(ls.slice(0, 6), [
    '오늘은 2026-10-16 입니다.',
    '과제: 시험용 직류 차단기 개발 · 과제번호 RS-2026-00000001 · 별칭 SSCB · 2차년도 · 지금 판 r2 (다음 판 번호와 파일 머리 주석은 코드가 적습니다 — 바꾸지 마세요)',
    '',
    '[기준 YAML]', '<<<', BASE.trim().split('\n')[0],
  ]);
  assert.ok(input.includes(`<<<\n${BASE.trim()}\n>>>\n[변경사항]\n<<<\n2차년도 연구재료비 12,000 → 15,000\n>>>\n[붙인 문서 글자 — 변경승인.pdf]\n<<<\n— 1쪽 —\n변경 승인 > > > 끝\n>>>`));
  assert.ok(input.endsWith('>>>'));
});
t('과제를 모르거나 판이 없고 글이 비어도 자리는 그대로다', () => {
  const ls = lines(reviseInput({ baseYaml: 'meta:\n  과제명: x', text: '  ', today: TODAY, project: null, n: 3, rev: '', materials: [{ name: '메모.txt', text: '연구원 추가' }] }));
  assert.equal(ls[1], '과제: (장부에 없는 과제) · 3차년도 · 지금 판 (판 없음) (다음 판 번호와 파일 머리 주석은 코드가 적습니다 — 바꾸지 마세요)');
  assert.deepEqual(ls.slice(3, 11), ['[기준 YAML]', '<<<', 'meta:', '  과제명: x', '>>>', '[변경사항]', '<<<', '(글 없음 — 아래 붙인 문서의 글자를 보세요)']);
  assert.deepEqual(ls.slice(-4), ['[붙인 문서 글자 — 메모.txt]', '<<<', '연구원 추가', '>>>']);
});
t('변경 글은 20,000자, 붙인 문서는 합쳐 40,000자에서 자른다 — 짧은 문서는 다 싣고 긴 문서가 남은 몫을 쓴다', () => {
  const input = reviseInput({
    baseYaml: BASE, text: 'ㄱ'.repeat(INPUT_BUDGET.reviseText + 10), today: TODAY, project: PROJECT, n: 2, rev: 'r2',
    materials: [{ name: '긴.pdf', text: 'ㄴ'.repeat(50_000) }, { name: '짧은.txt', text: 'ㄷ'.repeat(5_000) }],
  });
  assert.ok(input.includes(`${'ㄱ'.repeat(5)}\n…(10자 더 있음 — 잘림)\n>>>`));
  assert.equal(input.split('ㄷ').length - 1, 5_000);
  assert.equal(input.split('ㄴ').length - 1, INPUT_BUDGET.reviseMaterial - 5_000);
  assert.ok(input.includes('…(15,000자 더 있음 — 잘림)'));
});
t('기준 YAML 은 자르지 않는다 — 90,000자를 넘거나 비면 던진다. 다 차도 전체는 다리의 입력 한도 안', () => {
  assert.throws(() => reviseInput({ baseYaml: 'x'.repeat(90_001), text: '변경', today: TODAY, n: 2 }), { message: '기준 YAML 이 너무 깁니다(90,001자)' });
  assert.throws(() => reviseInput({ baseYaml: ' \n', text: '변경', today: TODAY, n: 2 }), /기준 YAML 이 비어 있습니다/);
  const full = reviseInput({
    baseYaml: 'a: 1\n'.repeat(17_999), text: 'ㄱ'.repeat(30_000), today: TODAY, project: PROJECT, n: 2, rev: 'r9',
    materials: [{ name: '하나.pdf', text: 'ㄴ'.repeat(60_000) }, { name: '둘.pdf', text: 'ㄷ'.repeat(60_000) }],
  });
  assert.ok(full.length <= INPUT_MAX, full.length);
});

t('붙인 문서가 부분으로 나뉘어 차례로 오면(2026-10-23) 머리에 몇째 부분인지, 붙인 문서 머리에 그 부분의 쪽·구역 범위를 적는다 — 부분이 아니면 전과 같다', () => {
  const ls = lines(reviseInput({
    baseYaml: 'meta:\n  과제명: x', text: '변경', today: TODAY, project: PROJECT, n: 2, rev: 'r2', part: { no: 2, count: 3 },
    materials: [{ name: '계획서.pdf', no: 2, count: 3, pages: [37, 72], text: '글' }],
  }));
  assert.equal(ls[2], '붙인 문서는 3부분으로 나뉘어 차례로 옵니다 — 이번은 2/3부분이고 [기준 YAML] 은 앞 부분까지 반영한 것입니다.');
  assert.ok(ls.includes('[붙인 문서 글자 — 계획서.pdf (2/3부분 · 37-72쪽)]'), ls.join('\n'));
  const office = lines(reviseInput({ baseYaml: 'a: 1', text: '', today: TODAY, n: 2, materials: [{ name: '메모.docx', no: 1, count: 2, chunks: [1, 9], text: '글' }] }));
  assert.ok(office.includes('[붙인 문서 글자 — 메모.docx (1/2부분 · 구역 1-9)]'));
  assert.ok(!office.some((l) => l.startsWith('붙인 문서는')), 'part 를 주지 않으면 머리에 부분 줄이 없다');
  const one = lines(reviseInput({ baseYaml: 'a: 1', text: '', today: TODAY, n: 2, materials: [{ name: '메모.txt', text: '글' }] }));
  assert.ok(one.includes('[붙인 문서 글자 — 메모.txt]'), '부분이 아니면 그대로');
});

console.log('묻기 — askRndTask(공용 consumer)·askExtract·askRevise');
const fakeAsk = (got) => {
  const calls = [];
  const ask = async (...args) => { calls.push(args); return typeof got === 'function' ? got(...args) : got; };
  return { ask, calls };
};
await ta('Claude 연결이 없으면 묻지 않고 던진다', async () => {
  const { ask, calls } = fakeAsk({ data: {} });
  for (const ai of [undefined, {}, { apiKey: '', cli: false }, { apiKey: '   ' }]) {
    await assert.rejects(askRndTask('rnd.extract', '글', { ai, ask }), { message: NO_CLAUDE });
  }
  assert.equal(calls.length, 0);
});
await ta('로컬 CLI → askClaude(task, input, { apiKey, useNative, files }) — 답·길·비용·알림(fails 다음 notes, ", " 로)', async () => {
  const { ask, calls } = fakeAsk({ data: { yaml: 'meta: {}' }, via: 'cli', costUsd: 0.42, fails: [], notes: ['뽑은 차년도 값(25)은 받을 수 없어 뺐습니다'] });
  const r = await askRndTask('rnd.extract', '입력 글', { ai: { cli: true }, ask, files: [PDF_FILE] });
  assert.deepEqual(calls, [['rnd.extract', '입력 글', { apiKey: undefined, useNative: true, files: [PDF_FILE] }]]);
  assert.deepEqual(r, { data: { yaml: 'meta: {}' }, via: 'cli', costUsd: 0.42, note: '뽑은 차년도 값(25)은 받을 수 없어 뺐습니다' });
  const api = fakeAsk({ data: { yaml: 'y' }, via: 'api', fails: ['로컬 CLI 실패(x)'] });
  const r2 = await askRndTask('rnd.revise', '글', { ai: { apiKey: 'sk-x', cli: false }, ask: api.ask });
  assert.deepEqual(api.calls[0][2], { apiKey: 'sk-x', useNative: false, files: [] });
  assert.deepEqual(r2, { data: { yaml: 'y' }, via: 'api', note: '로컬 CLI 실패(x)' });
});
await ta('답이 없으면 내려온 까닭을 적어 던진다 — 모르는 작업도 던진다', async () => {
  const { ask } = fakeAsk({ fails: ['로컬 CLI 실패(CLI 응답이 600초 안에 오지 않았습니다.)', 'API 실패(Claude 호출 실패 (HTTP 401) bad key)'] });
  await assert.rejects(askRndTask('rnd.extract', '글', { ai: { apiKey: 'sk-x', cli: true }, ask }),
    { message: '답을 받지 못했습니다 — 로컬 CLI 실패(CLI 응답이 600초 안에 오지 않았습니다.), API 실패(Claude 호출 실패 (HTTP 401) bad key)' });
  await assert.rejects(askRndTask('search.room', '글', { ai: { cli: true }, ask }), /모르는 R&D 작업 search\.room/);
});
await ta('askExtract — 입력 글은 extractInput, 첨부는 재료의 작은 PDF 하나(없으면 빈 목록). 돌려준 것에 input 이 붙는다', async () => {
  const ctx = { today: TODAY, stage: 2, project: PROJECT, currentStage: 2, docs: DOCS };
  const { ask, calls } = fakeAsk({ data: { yaml: 'meta: {}', stage: 2 }, via: 'cli', fails: [] });
  const r = await askExtract(material(), ctx, { ai: { cli: true }, ask });
  assert.equal(calls[0][0], 'rnd.extract');
  assert.equal(calls[0][1], extractInput(material(), ctx));
  assert.deepEqual(calls[0][2].files, [PDF_FILE]);
  assert.equal(r.input, calls[0][1]);
  assert.deepEqual(r.data, { yaml: 'meta: {}', stage: 2 });
  await askExtract(material({ file: null, attach: 'none' }), ctx, { ai: { cli: true }, ask });
  assert.deepEqual(calls[1][2].files, []);
});
await ta('askRevise — 입력 글은 reviseInput, 첨부는 없다(문서는 글자로만)', async () => {
  const args = { baseYaml: BASE, text: '연구재료비 15,000', materials: [material()], today: TODAY, project: PROJECT, n: 2, rev: 'r2' };
  const { ask, calls } = fakeAsk({ data: { yaml: BASE, summary: 's' }, via: 'api', fails: [] });
  const r = await askRevise(args, { ai: { apiKey: 'sk-x' }, ask, files: [PDF_FILE] });
  assert.deepEqual([calls[0][0], calls[0][1], calls[0][2].files], ['rnd.revise', reviseInput(args), []]);
  assert.equal(r.input, reviseInput(args));
});

console.log('진짜 askClaude(가짜 chrome 다리) — 작업은 행위 명세가 만든 rnd.extract·rnd.revise, 답은 관문을 지난다');
await ta('다리에 작업 이름·입력·첨부가 가고, 2,000자가 넘는 YAML 도 자르지 않는다(yaml max 120000)', async () => {
  const sent = [];
  const yaml = `meta:\n  과제명: 시험용 직류 차단기 개발\n# ${'가'.repeat(20_000)}`;
  globalThis.chrome = { runtime: { sendNativeMessage: async (_h, msg) => { sent.push(msg); return { ok: true, costUsd: 0.3, data: { yaml, alias: 'SSCB', stage: 25, warnings: null } }; } } };
  try {
    const r = await askExtract(material(), { today: TODAY, stage: null, project: null, currentStage: null, docs: DOCS }, { ai: { cli: true } });
    assert.deepEqual([sent[0].task, sent[0].files], ['rnd.extract', [PDF_FILE]]);
    assert.equal(sent[0].input, r.input);
    assert.equal(r.via, 'cli');
    assert.equal(r.data.yaml, yaml);
    assert.equal(r.data.stage, null);
    assert.match(r.note, /뽑은 차년도 값\(25\)은 받을 수 없어 뺐습니다/);
  } finally { delete globalThis.chrome; }
});
await ta('필수 칸(yaml·summary)이 빠진 답은 관문이 막아 "답을 받지 못했습니다" — changes 의 줄은 경로가 있어야 한다', async () => {
  globalThis.chrome = { runtime: { sendNativeMessage: async () => ({ ok: true, data: { yaml: 'meta: {}', summary: null, changes: [], warnings: null } }) } };
  try {
    await assert.rejects(askRevise({ baseYaml: BASE, text: '변경', today: TODAY, n: 2 }, { ai: { cli: true } }), /답을 받지 못했습니다 — 로컬 CLI 실패\(답이 입력 명세와 다릅니다 — summary 가 없습니다\)/);
    globalThis.chrome.runtime.sendNativeMessage = async () => ({ ok: true, data: { yaml: 'meta: {}', summary: '연구재료비 12,000 → 15,000', changes: [{ path: '예산.비목별[2차년도].직접비.연구재료비', before: '12000', after: '15000' }, { path: null, before: 'x', after: 'y' }], warnings: null } });
    const r = await askRevise({ baseYaml: BASE, text: '변경', today: TODAY, n: 2 }, { ai: { cli: true } });
    assert.deepEqual(r.data.changes, [{ path: '예산.비목별[2차년도].직접비.연구재료비', before: '12000', after: '15000' }]);
    assert.match(r.note, /1줄은 받을 수 없어 뺐습니다/);
  } finally { delete globalThis.chrome; }
});

console.log(`\n통과 ${pass}건`);
