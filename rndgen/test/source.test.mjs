// 문서 → 재료(rndgen/source.js)와 PDF 전체 글자(doctext/browser.js pdfAllText).
//
// 갈래 가리기·쪽/구역 나누기(크기 제한 없이 부분으로 — 2026-10-23 사용자 "크기 제한없이 분할해서 처리")·글 잇기·data URL 은 엔진 없이, readDocument 의 갈래(pdf 글자 층 있음·
// 여러 부분·큰 작은 PDF 의 반 가르기·자르기 실패·스캔본의 쪽 가르기·쪽 수 모름·office·text·yaml/hwp 거절)는 가짜 엔진으로 본다. 작은 PDF 자르기·쪽 수(pdf-lib)와 hwpx 글자(src/officetext.js)는 진짜 엔진으로.
// 사업계획서는 지어낸 것이다(과제 "시험용 직류 차단기 개발", RS-2026-00000001, 홍길동·이몽룡·성춘향 — test/fixtures/rnd 와 같은 가짜). 실물 PDF 는 읽지 않는다.
import assert from 'node:assert/strict';

import { PDFDocument } from '../../vendor/pdf-lib.esm.min.js';
import { buildZip } from '../../src/zip.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
const num = (n) => Number(n).toLocaleString('ko-KR');

console.log('가져오기');
// 가져오기만으로 chrome·document·fetch 를 만지지 않는다 — test/wiring.test.mjs 가 jsdom 에서 sidepanel.js 를 통째로 가져온다.
const touched = [];
const realFetch = globalThis.fetch;
for (const key of ['chrome', 'document', 'fetch']) {
  Object.defineProperty(globalThis, key, { configurable: true, get() { touched.push(key); return key === 'fetch' ? realFetch : undefined; } });
}
const S = await import('../source.js');
const B = await import('../../doctext/browser.js');
const engines0 = S.defaultEngines();
for (const key of ['chrome', 'document']) delete globalThis[key];
Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: realFetch });
t('source.js·doctext/browser.js 를 가져오고 defaultEngines() 를 불러도 chrome·document·fetch 를 만지지 않는다 — 엔진은 부를 때 import() 한다', () => {
  assert.deepEqual(touched, []);
  assert.deepEqual(Object.keys(engines0).sort(), ['officeText', 'pdfCount', 'pdfSlice', 'pdfText']);
  for (const fn of Object.values(engines0)) assert.equal(typeof fn, 'function');
});
const { LIMITS, docKind, unsupportedDocNote, splitPages, splitChunks, pagesText, toDataUrl, dataUrlBytes, readDocument, defaultEngines } = S;
const { pdfAllText } = B;

t('한도는 부분 하나의 크기뿐 — 글자 80,000자 · 붙이는 PDF 100쪽·8MB · 구역 3,000자. 문서 전체의 한도(원본 20MB·24쪽·9만 자 고르기)와 점수·고르기는 없다(2026-10-23)', () => {
  assert.deepEqual(LIMITS, { partChars: 80_000, partPages: 100, attachBytesMax: 8 * 1024 * 1024, chunkChars: 3_000 });
  assert.ok(Object.isFrozen(LIMITS));
  for (const gone of ['KEYWORDS', 'scorePage', 'scorePages', 'pickPages', 'pickChunks']) assert.equal(S[gone], undefined, gone);
});

/* ------------------------------------------------------------ 지어낸 사업계획서 */

const amounts = (n, from = 1000) => Array.from({ length: n }, (_, i) => (from + i * 1250).toLocaleString('en-US')).join(' ');
/** 27쪽짜리 지어낸 사업계획서 — KR(공동연구개발기관2)의 쪽: 9·12·13·15·19·20·22·25·26. 다른 기관의 같은 꼴 쪽: 10·11·14·23·24·27. 이제는 다 보낸다(고르지 않는다). */
function planPages() {
  const budgetTable = (org) => `${org}\n(단위: 천원)\n연구개발기관별 사용계획 총괄표\n비목 직접비 인건비 연구재료비 연구활동비 간접비 합계\n${amounts(16)}`;
  return [
    /* 1 */ `연구개발계획서\n과제명 시험용 직류 차단기 개발\n연구개발과제번호 RS-2026-00000001\n연구개발기간 2025.04.01 ~ 2028.12.31\n주관연구개발기관 가나전기(주)\n공동연구개발기관 한국선급 다라대학교 마바연구원`,
    /* 2 */ '< 요 약 문 >\n연구개발 목표 시험용 직류 차단기의 선급 기준 마련과 시제품 검증\n연구개발 내용 차단기 설계·시험·인증 절차',
    /* 3 */ '요약문 계속\n기대효과 선박 직류 배전 보호 기술 확보\n중심어 직류 차단기 선급',
    /* 4 */ `목 차\n1. 연구개발과제의 필요성 ··········· 1\n2. 연구개발과제의 목표 및 내용 ··········· 5\n2-1. 성능목표 ··········· 6\n6. 안전 ··········· 20\n8. 연구개발비 ··········· 25`,
    /* 5 */ '1. 연구개발과제의 필요성 및 현황\n1-1. 개발 대상 기술의 개요\n직류 배전은 손실이 적고 연구개발비 대비 효과가 크다. 개발목표 를 세운다.',
    /* 6 */ '1-2. 연구개발과제의 배경 및 필요성\n국내외 직류 차단기 시장 현황 2020년 이후 연평균 성장. 연구개발기간 동안의 개발목표 와 개발내용.',
    /* 7 */ '1-3. 관련 지식재산권, 표준화 및 인증기준 현황\nIEC 표준 동향 · 국제 특허 동향 · 한국선급 기준 개정 동향',
    /* 8 */ '국외 기술 동향\n유럽 선급의 직류 배전 지침 현황',
    /* 9 */ `2. 연구개발과제의 목표 및 내용\n2-1. 연구개발과제의 최종 목표\n성능목표 평가항목 단위 목표치 평가방법\n차단 시간 ms 5 공인시험 한국선급 입회\n성과지표 논문 1 · 기준(안) 1`,
    /* 10 */ '2-2. 연차별 개발목표 및 개발내용\n(1) 1차년도\n[주관연구개발기관(가나전기(주))]\n① 개발목표\n- 차단기 회로 설계\n② 개발내용\n- 시제품 제작',
    /* 11 */ '[공동연구개발기관1(다라대학교)]\n① 개발목표\n- 차단 해석 모델\n② 개발내용\n- 해석·검증',
    /* 12 */ '[공동연구개발기관2(한국선급)]\n① 개발목표\n- 직류 차단기 선급 기준(안) 초안\n② 개발내용\n- 국제 기준 조사',
    /* 13 */ '- 형식승인 시험 절차서 작성\n- 시험 입회 계획 수립\n- 기준(안) 검토 회의 4회',
    /* 14 */ '[공동연구개발기관3(마바연구원)]\n① 개발목표\n- 시험 설비 구축\n② 개발내용\n- 시험장 구성',
    /* 15 */ '2-3. 연구개발과제 수행일정 및 주요결과물\n일련 개발내용 기관 기간[주]\n1 기준(안) 초안 한국선급 20\n2 시제품 제작 가나전기 30\n주요결과물 기준(안) 1건',
    /* 16 */ '3. 연구개발과제의 추진전략·방법 및 추진체계\n3-1. 추진전략\n단계별 추진 전략',
    /* 17 */ '4. 연구개발성과의 활용방안 및 기대효과\n선박 직류 배전 시장 진출',
    /* 18 */ '5. 연구개발성과의 사업화 전략 및 계획\n5-1. 사업화 실적\n기술이전 실적 없음',
    /* 19 */ '6. 연구개발 안전 및 보안조치 이행계획\n6-1. 안전조치 이행계획\n[공동연구개발기관2 : 한국선급]\n- 연구실 안전관리비 계상: 인건비의 1~2%\n- 보호장비 구입·안전교육',
    /* 20 */ '7. 연구개발기관 현황\n7-1. 연구책임자 등 현황\n(3) 공동연구개발기관책임자(한국선급)\n가. 인적사항 성명 홍길동 직위 수석\n나. 참여연구자 이몽룡 성춘향',
    /* 21 */ `7-2. 연구개발기관 연구개발 실적\n연구개발기관명 과제명 연구개발기간 연구개발비\n한국선급 지난 과제 2019~2021 ${amounts(8)}\n한국선급 다른 과제 2021~2023 논문 특허 실적`,
    /* 22 */ `8. 연구개발비 사용에 관한 계획\n8-1. 연구개발비 지원·부담계획\n(단위: 천원)\n기관 정부지원 기관부담 합계\n가나전기 한국선급 다라대학교 ${amounts(12)}`,
    /* 23 */ `8-2. 연구개발비 사용계획\n${budgetTable('[주관연구개발기관 : 가나전기(주)]')}`,
    /* 24 */ budgetTable('[공동연구개발기관1 : 다라대학교]'),
    /* 25 */ budgetTable('[공동연구개발기관2 : 한국선급]'),
    /* 26 */ `참여연구자 인건비 현황표\n성명 직위 계상률 참여기간 인건비\n이몽룡 책임 15% 9 ${amounts(3)}\n성춘향 선임 20% 9 ${amounts(3, 2000)}`,
    /* 27 */ budgetTable('[공동연구개발기관3 : 마바연구원]'),
  ];
}

/* ------------------------------------------------------------ 갈래 */

console.log('갈래 (docKind · unsupportedDocNote)');
t('확장자 먼저 — yaml·yml · pdf · hwpx·docx·xlsx·pptx(매크로 꼴도) · txt·md · hwp, 대소문자 무시', () => {
  const want = {
    'KR_과제.yaml': 'yaml', 'x.YML': 'yaml', '사업계획서.PDF': 'pdf', '계획서.hwpx': 'office', 'a.docx': 'office', 'a.docm': 'office', 'b.xlsx': 'office',
    'c.pptx': 'office', '메모.txt': 'text', 'README.md': 'text', '계획서.hwp': 'hwp', '옛.doc': '', '사진.png': '', 'a.zip': '',
  };
  for (const [name, kind] of Object.entries(want)) assert.equal(docKind(name), kind, name);
});
t('확장자가 없으면 MIME — 확장자가 있으면 MIME 은 보지 않는다', () => {
  assert.equal(docKind('사업계획서', 'application/pdf'), 'pdf');
  assert.equal(docKind('붙임', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'office');
  assert.equal(docKind('붙임', 'application/hwp+zip'), 'office');
  assert.equal(docKind('붙임', 'text/plain; charset=utf-8'), 'text');
  assert.equal(docKind('붙임', 'application/x-yaml'), 'yaml');
  assert.equal(docKind('붙임', 'application/x-hwp'), 'hwp');
  assert.equal(docKind('붙임', ''), '');
  assert.equal(docKind('2026.10.15 보고', 'application/pdf'), 'pdf', '"15 보고" 는 확장자가 아니다');
  assert.equal(docKind('a.png', 'application/pdf'), '');
});
t('안내 — hwp 는 PDF 로 저장하라, 모르는 것은 넣을 수 있는 것의 목록, 받는 것은 빈 글', () => {
  assert.equal(unsupportedDocNote('계획서.hwp'), '옛 한글(.hwp)은 뽑지 못합니다 — 한글에서 PDF 로 저장해 넣으세요(.hwpx 는 그대로 됩니다)');
  assert.equal(unsupportedDocNote('옛.doc'), '.doc 파일은 넣을 수 없습니다 — 넣을 수 있는 것: YAML(.yaml/.yml) · PDF · HWPX · DOCX · XLSX · TXT/MD');
  assert.match(unsupportedDocNote('이름만'), /^이 파일은 넣을 수 없습니다 — 넣을 수 있는 것: /);
  for (const name of ['a.yaml', 'a.pdf', 'a.hwpx', 'a.docx', 'a.xlsx', 'a.txt', 'a.md']) assert.equal(unsupportedDocNote(name), '', name);
});

/* ------------------------------------------------------------ 나누기 */

console.log('쪽 나누기 (splitPages · pagesText)');
t('다 합쳐 한도 안이면 한 묶음(1-N) — 쪽이 없으면 빈 목록, 빈 쪽도 든다(점수로 거르지 않는다)', () => {
  assert.deepEqual(splitPages(planPages()), [[1, 27]]);
  assert.deepEqual(splitPages([]), []);
  assert.deepEqual(splitPages(['', '', '']), [[1, 3]]);
});
t('한도를 넘으면 문서 차례대로 이어진 묶음으로 — 묶음마다 pagesText 가 한도 안이고 빠지는 쪽이 없다. 한도가 작을수록 묶음이 많다', () => {
  const pages = planPages();
  const ranges = splitPages(pages, { partChars: 600 });
  assert.ok(ranges.length > 1, `${ranges.length}묶음`);
  assert.equal(ranges[0][0], 1);
  assert.equal(ranges.at(-1)[1], 27);
  for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i][0], ranges[i - 1][1] + 1, '이어진다');
  for (const [a, b] of ranges) assert.ok(pagesText(pages, range(a, b)).length <= 600, `${a}-${b}쪽 ${pagesText(pages, range(a, b)).length}자`);
  assert.ok(splitPages(pages, { partChars: 300 }).length > ranges.length);
});
t('한 쪽이 혼자 한도를 넘으면 그 쪽만의 묶음 — 앞뒤는 따로(뒤에서 llm.js 가 자르고 적는다)', () => {
  assert.deepEqual(splitPages(['a', '가'.repeat(500), 'b', 'c'], { partChars: 100 }), [[1, 1], [2, 2], [3, 4]]);
});
t('pagesText — 고른 쪽만 "— N쪽 —" 표시로 잇고, 없는 쪽 번호는 버린다. 글 안의 >>> 는 > > > (울타리 깨짐 막기)', () => {
  const pages = ['첫 쪽', '둘째 쪽 >>> 끝', '셋째'];
  assert.equal(pagesText(pages, [1, 2, 9, 0]), '— 1쪽 —\n첫 쪽\n\n— 2쪽 —\n둘째 쪽 > > > 끝');
  assert.equal(pagesText(pages, []), '');
  assert.equal(pagesText(['a >>>> b'], [1]), '— 1쪽 —\na > > > > b');
});

console.log('구역 나누기 (splitChunks)');
t('다 합쳐 한도 안이면 한 부분 — 구역 수(total)는 그대로, 빈 글은 0', () => {
  assert.deepEqual(splitChunks('가\n\n나\n\n다', { partChars: 100, chunk: 3 }), { total: 3, parts: [{ from: 1, to: 3, text: '가\n\n나\n\n다' }] });
  assert.deepEqual(splitChunks('', {}), { total: 0, parts: [] });
  assert.equal(splitChunks('a >>> b').parts[0].text, 'a > > > b');
});
t('넘치면 구역 경계에서 끊어 문서 차례대로 — 부분마다 한도 안, 이어 붙이면 원문 그대로(빠짐도 생략 표시도 없다)', () => {
  const paras = Array.from({ length: 40 }, (_, i) => `문단 ${i} ${'내용 '.repeat(20)}`.trim());
  const text = paras.join('\n\n');
  const got = splitChunks(text, { partChars: 300, chunk: 100 });
  assert.ok(got.parts.length > 1, `${got.parts.length}부분`);
  assert.equal(got.parts[0].from, 1);
  assert.equal(got.parts.at(-1).to, got.total);
  for (let i = 1; i < got.parts.length; i++) assert.equal(got.parts[i].from, got.parts[i - 1].to + 1);
  for (const p of got.parts) assert.ok(p.text.length <= 300, `구역 ${p.from}-${p.to}: ${p.text.length}자`);
  assert.equal(got.parts.map((p) => p.text).join('\n\n'), text);
  assert.ok(!text.includes('(… 생략 …)'));
});
t('구역 크기를 넘는 문단은 줄에서, 그래도 길면 그 자리에서 자른다 — 어느 구역도 chunk 를 넘지 않고 글자는 다 든다', () => {
  const text = [`${'가'.repeat(25)}\n${'나'.repeat(25)}\n${'다'.repeat(70)}`, '라'].join('\n\n');
  const got = splitChunks(text, { partChars: 10_000, chunk: 30 });
  assert.equal(got.parts.length, 1);
  for (const piece of got.parts[0].text.split('\n\n')) assert.ok(piece.length <= 30, piece);
  assert.equal(got.parts[0].text.replace(/\n/g, ''), text.replace(/\n/g, ''));
});

/* ------------------------------------------------------------ 바이트 */

console.log('data URL');
t('toDataUrl 은 덩어리로 btoa 해도 한 번에 만든 base64 와 같다 — dataUrlBytes 가 바이트 수를 되센다', () => {
  for (const n of [0, 1, 2, 3, 4, 24_575, 24_576, 24_577, 100_003]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
    const url = toDataUrl(bytes, 'application/pdf');
    assert.equal(url, `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`, `${n}바이트`);
    assert.equal(dataUrlBytes(url), n, `${n}바이트`);
  }
  assert.ok(toDataUrl(new Uint8Array([1]).buffer, '').startsWith('data:application/octet-stream;base64,'));
});
t('dataUrlBytes — base64 가 아니면 풀어 낸 바이트, 쉼표가 없으면 0', () => {
  assert.equal(dataUrlBytes('data:text/plain,%ED%95%9C'), 3);
  assert.equal(dataUrlBytes('data:text/plain,abc'), 3);
  assert.equal(dataUrlBytes(''), 0);
  assert.equal(dataUrlBytes(null), 0);
});

/* ------------------------------------------------------------ 문서 → 재료 (가짜 엔진) */

console.log('문서 → 재료 (가짜 엔진) — 크기 제한 없이 부분으로');
/** 부르면 안 되는 엔진. */
const never = (what) => async () => assert.fail(`${what} 을(를) 부르면 안 된다`);
const fakeEngines = (over = {}) => ({ pdfText: never('pdfText'), pdfSlice: never('pdfSlice'), officeText: never('officeText'), ...over });
const fromUrl = (url) => new Uint8Array(Buffer.from(url.split(',')[1], 'base64'));
const PDF_BYTES = new Uint8Array(Buffer.from('%PDF-1.7 가짜 사업계획서'));
/** 쪽마다 1,000바이트(또는 per)인 작은 PDF 흉내 — 쪽 수에 비례한 크기. */
const sizedSlice = (per = 1000) => async (_b, picked) => new Uint8Array(picked.length * per);
const contiguous = (parts) => { for (let i = 1; i < parts.length; i++) assert.equal(parts[i].pages[0], parts[i - 1].pages[1] + 1, `${i + 1}부분이 이어진다`); };

await ta('pdf(글자 층 있음, 한도 안) — 한 부분: 모든 쪽의 글자(목차·다른 기관 쪽도 — 점수로 거르지 않는다)와 모든 쪽을 담은 작은 PDF(attach slice)', async () => {
  const calls = [];
  const slice = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);
  const pages = planPages();
  const m = await readDocument({ name: '사업계획서.pdf', type: 'application/pdf', bytes: PDF_BYTES }, {
    engines: fakeEngines({
      pdfText: async (b) => { calls.push(['text', b]); return { pages, total: 27 }; },
      pdfSlice: async (b, picked) => { calls.push(['slice', b, picked]); return slice; },
    }),
  });
  assert.deepEqual(calls.map((c) => c[0]), ['text', 'slice']);
  assert.equal(calls[0][1], PDF_BYTES);
  assert.deepEqual(calls[1][2], range(1, 27));
  assert.deepEqual([m.name, m.kind, m.total, m.attach, m.parts.length], ['사업계획서.pdf', 'pdf', 27, 'slice', 1]);
  assert.deepEqual(m.picked, range(1, 27), '글이 든 쪽 전부');
  assert.deepEqual([m.file.name, m.file.type], ['사업계획서_발췌.pdf', 'application/pdf']);
  assert.deepEqual([...fromUrl(m.file.dataUrl)], [...slice]);
  assert.equal(m.text, pagesText(pages, range(1, 27)));
  assert.ok(m.text.startsWith('— 1쪽 —\n연구개발계획서\n과제명 시험용 직류 차단기 개발'));
  assert.ok(m.text.includes('— 4쪽 —\n목 차'), '목차도 든다');
  assert.ok(m.text.includes('— 25쪽 —\n[공동연구개발기관2 : 한국선급]'));
  assert.ok(m.text.includes('— 27쪽 —\n[공동연구개발기관3 : 마바연구원]'), '다른 기관 쪽도 든다');
  assert.equal(m.chars, m.text.length);
  assert.equal(m.read, `사업계획서.pdf: 27쪽 · 글자 ${num(m.chars)}자 · 한 번에 보냄 · 그 쪽들을 작은 PDF 로 붙임(1KB)`);
  const p = m.parts[0];
  assert.deepEqual([p.name, p.kind, p.total, p.no, p.count, p.pages, p.chunks, p.attach, p.file], ['사업계획서.pdf', 'pdf', 27, 1, 1, [1, 27], null, 'slice', m.file]);
  assert.deepEqual(p.picked, range(1, 27));
  assert.equal(p.text, m.text);
  assert.equal(p.read, `1/1부분 — 1-27쪽 · 글자 ${num(m.chars)}자 · 작은 PDF 1KB`);
  assert.deepEqual(m.warnings, []);
});
await ta('pdf — 글자가 한도를 넘으면 문서 차례대로 여러 부분, 부분마다 그 쪽만 담은 작은 PDF(이름에 번호) — 글자는 빠짐없이, 재료의 text 는 부분들을 이은 것', async () => {
  const calls = [];
  const pages = planPages();
  const m = await readDocument({ name: '사업계획서.pdf', bytes: PDF_BYTES }, {
    engines: fakeEngines({ pdfText: async () => ({ pages, total: 27 }), pdfSlice: async (b, picked) => { calls.push(picked); return new Uint8Array(picked.length * 100); } }),
    limits: { partChars: 600 },
  });
  const ranges = splitPages(pages, { partChars: 600 });
  assert.equal(m.parts.length, ranges.length);
  assert.ok(m.parts.length > 1);
  assert.deepEqual(m.parts.map((p) => p.pages), ranges);
  assert.deepEqual(calls, ranges.map(([a, b]) => range(a, b)), '묶음마다 한 번씩, 차례대로');
  contiguous(m.parts);
  m.parts.forEach((p, i) => {
    assert.deepEqual([p.no, p.count, p.attach], [i + 1, ranges.length, 'slice']);
    assert.equal(p.file.name, `사업계획서_발췌_${i + 1}.pdf`);
    assert.equal(p.text, pagesText(pages, range(p.pages[0], p.pages[1])));
    assert.ok(p.text.length <= 600);
    const where = p.pages[0] === p.pages[1] ? `${p.pages[0]}쪽` : `${p.pages[0]}-${p.pages[1]}쪽`;
    assert.equal(p.read, `${i + 1}/${ranges.length}부분 — ${where} · 글자 ${num(p.text.length)}자 · 작은 PDF 1KB`);
  });
  assert.deepEqual([m.attach, m.file], ['parts', null]);
  assert.equal(m.text, m.parts.map((p) => p.text).join('\n\n'));
  assert.equal(m.text, pagesText(pages, range(1, 27)), '이으면 전체 글 그대로');
  assert.deepEqual(m.picked, range(1, 27));
  assert.equal(m.read, `사업계획서.pdf: 27쪽 · 글자 ${num(m.chars)}자 · ${ranges.length}부분으로 나눠 차례로 보냄(부분마다 그 쪽만 담은 PDF)`);
  assert.deepEqual(m.warnings, []);
});
await ta('pdf — 작은 PDF 가 attachBytesMax 를 넘으면 쪽을 반으로 갈라 다시 만든다(차례 그대로, 빠지는 쪽 없이)', async () => {
  const calls = [];
  const m = await readDocument({ name: '그림많은.pdf', bytes: PDF_BYTES }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: planPages(), total: 27 }), pdfSlice: async (b, picked) => { calls.push(picked.length); return new Uint8Array(picked.length * 1000); } }),
    limits: { attachBytesMax: 4096 },
  });
  assert.equal(calls[0], 27, '먼저 통째로 해 보고');
  assert.ok(m.parts.length >= 7, `${m.parts.length}부분`);
  contiguous(m.parts);
  assert.deepEqual([m.parts[0].pages[0], m.parts.at(-1).pages[1]], [1, 27]);
  for (const p of m.parts) {
    assert.ok(p.pages[1] - p.pages[0] + 1 <= 4, `${p.pages} 쪽`);
    assert.equal(p.attach, 'slice');
    assert.ok(p.file);
  }
  assert.deepEqual(m.warnings, []);
  assert.match(m.read, /^그림많은\.pdf: 27쪽 · 글자 [\d,]+자 · \d+부분으로 나눠 차례로 보냄\(부분마다 그 쪽만 담은 PDF\)$/);
});
await ta('pdf — 한 쪽이 혼자 attachBytesMax 를 넘으면 그 부분은 글자만(attach none), 쪽마다 까닭', async () => {
  const m = await readDocument({ name: '거대쪽.pdf', bytes: PDF_BYTES }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: planPages().slice(0, 3), total: 3 }), pdfSlice: sizedSlice(3000) }),
    limits: { attachBytesMax: 2048 },
  });
  assert.equal(m.parts.length, 3);
  assert.ok(m.parts.every((p) => p.attach === 'none' && p.file === null && p.chars > 0));
  assert.deepEqual(m.warnings, [1, 2, 3].map((n) => `${n}쪽은 그 한 쪽의 PDF 가 커서(3KB) 붙이지 않고 글자만 실었습니다 — 2KB 까지`));
  assert.match(m.read, / · 3부분으로 나눠 차례로 보냄\(글자만\)$/);
});
await ta('pdf — 작은 PDF 를 못 만들면(암호 등) 글자만(attach none), 까닭은 warnings 에 한 번 — 뒤 부분은 다시 해 보지 않는다', async () => {
  const one = await readDocument({ name: '잠긴.pdf', bytes: PDF_BYTES }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: planPages(), total: 27 }), pdfSlice: async () => { throw new Error('Input document to `PDFDocument.load` is encrypted'); } }),
  });
  assert.deepEqual([one.attach, one.file, one.parts.length], ['none', null, 1]);
  assert.ok(one.picked.length === 27 && one.text.length > 0);
  assert.equal(one.read, `잠긴.pdf: 27쪽 · 글자 ${num(one.chars)}자 · 한 번에 보냄 · 글자만 실음(작은 PDF 를 만들지 못함)`);
  assert.deepEqual(one.warnings, ['쪽을 담은 작은 PDF 를 만들지 못해(Input document to `PDFDocument.load` is encrypted) 글자만 실었습니다']);
  let tries = 0;
  const many = await readDocument({ name: '잠긴.pdf', bytes: PDF_BYTES }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: planPages(), total: 27 }), pdfSlice: async () => { tries++; throw new Error('encrypted'); } }),
    limits: { partChars: 600 },
  });
  assert.ok(many.parts.length > 1 && many.parts.every((p) => p.attach === 'none' && p.chars > 0));
  assert.equal(tries, 1);
  assert.equal(many.warnings.length, 1);
  assert.match(many.read, /부분으로 나눠 차례로 보냄\(글자만\)$/);
});
await ta('pdf(글자 층 없음 — 40자 넘는 쪽이 30% 아래) — 원본이 attachBytesMax 안이면 원본째 한 부분(attach original), 글자가 든 쪽은 글로도', async () => {
  const pages = ['- 1 -', '', '', `과제명 시험용 직류 차단기 개발 ${'가'.repeat(40)}`, ...Array(6).fill('')];
  const m = await readDocument({ name: '스캔.pdf', bytes: PDF_BYTES }, { engines: fakeEngines({ pdfText: async () => ({ pages, total: 10 }) }) });
  assert.deepEqual([m.kind, m.total, m.attach, m.picked, m.parts.length], ['pdf', 10, 'original', [4], 1]);
  assert.deepEqual([m.file.name, m.file.type], ['스캔.pdf', 'application/pdf']);
  assert.deepEqual([...fromUrl(m.file.dataUrl)], [...PDF_BYTES]);
  assert.ok(m.text.startsWith('— 4쪽 —\n과제명'));
  assert.deepEqual([m.parts[0].pages, m.parts[0].picked, m.parts[0].attach], [[1, 10], [4], 'original']);
  assert.equal(m.parts[0].read, `1/1부분 — 1-10쪽 · 글자 ${num(m.chars)}자 · 원본 PDF 1KB`);
  assert.equal(m.read, '스캔.pdf: 10쪽 · 글자 층 없음(스캔본) · 원본 PDF 를 붙임(1KB) · 글자가 든 1쪽은 글로도 실음');
  assert.equal(m.warnings.length, 1);
  assert.match(m.warnings[0], /^글자 층이 없는 PDF\(스캔본\)입니다 — 원본 PDF 를 그대로 붙였습니다/);
});
await ta('pdf(글자 층 없음) — 원본이 크면 쪽을 나눠 부분마다 그 쪽만 담은 PDF(거절하지 않는다 — 2026-10-23)', async () => {
  const calls = [];
  const m = await readDocument({ name: '큰스캔.pdf', bytes: new Uint8Array(3000) }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: ['', '', ''], total: 3 }), pdfSlice: async (b, picked) => { calls.push(picked); return new Uint8Array(picked.length * 1000); } }),
    limits: { attachBytesMax: 2048 },
  });
  assert.deepEqual(calls, [[1], [2], [3]], '쪽당 바이트를 어림해 처음부터 한도 안의 묶음으로');
  assert.deepEqual([m.attach, m.file, m.picked, m.text, m.chars, m.parts.length], ['parts', null, [], '', 0, 3]);
  assert.deepEqual(m.parts.map((p) => [p.pages, p.attach, p.file.name]), [[[1, 1], 'slice', '큰스캔_발췌_1.pdf'], [[2, 2], 'slice', '큰스캔_발췌_2.pdf'], [[3, 3], 'slice', '큰스캔_발췌_3.pdf']]);
  assert.equal(m.parts[1].read, '2/3부분 — 2쪽 · 글자 0자 · 작은 PDF 1KB');
  assert.equal(m.read, '큰스캔.pdf: 3쪽 · 글자 층 없음(스캔본) · 3부분으로 나눠 차례로 보냄(부분마다 그 쪽만 담은 PDF)');
  assert.match(m.warnings[0], /^글자 층이 없는 PDF\(스캔본\)입니다 — 원본이 커서\(3KB\) 쪽을 나눠 부분마다 그 쪽만 담은 PDF 를 붙였습니다/);
});
await ta('pdf(글자 층 없음, 큼) — 바이트로는 더 담을 수 있어도 한 부분의 PDF 는 partPages(100쪽)까지(Claude API 의 문서 쪽 수 한도)', async () => {
  const calls = [];
  const m = await readDocument({ name: '얇은스캔.pdf', bytes: new Uint8Array(9000) }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: Array(250).fill(''), total: 250 }), pdfSlice: async (b, picked) => { calls.push(picked.length); return new Uint8Array(picked.length * 10); } }),
    limits: { attachBytesMax: 8192 },
  });
  assert.deepEqual(calls, [100, 100, 50]);
  assert.deepEqual(m.parts.map((p) => p.pages), [[1, 100], [101, 200], [201, 250]]);
  const few = await readDocument({ name: '얇은스캔.pdf', bytes: new Uint8Array(9000) }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: Array(250).fill(''), total: 250 }), pdfSlice: sizedSlice(10) }),
    limits: { attachBytesMax: 8192, partPages: 40 },
  });
  assert.equal(few.parts.length, 7);
});
await ta('pdf(글자 층 없음, 큼) — 암호가 걸려 자르지도 못하면 붙일 것이 없다(글자도 PDF 도 없음 → 패널이 묻지 않는다)', async () => {
  const m = await readDocument({ name: '잠긴스캔.pdf', bytes: new Uint8Array(3000) }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: ['', '', ''], total: 3 }), pdfSlice: async () => { throw new Error('encrypted'); } }),
    limits: { attachBytesMax: 2048 },
  });
  assert.ok(!m.parts.some((p) => p.file || p.chars));
  assert.equal(m.chars, 0);
  assert.ok(m.warnings.includes('붙일 PDF 를 하나도 만들지 못했습니다 — 글자 층이 있는 PDF 로 다시 저장해 넣으세요'), m.warnings.join(' | '));
});
await ta('pdf — 글자를 뽑다 던지면(엔진 없음·깨짐) 스캔본처럼 원본째, 까닭은 warnings 에', async () => {
  const m = await readDocument({ name: '깨진.pdf', bytes: PDF_BYTES }, { engines: fakeEngines({ pdfText: async () => { throw new Error('Invalid PDF structure'); } }) });
  assert.deepEqual([m.attach, m.total, m.picked, m.text, m.parts.length, m.parts[0].pages], ['original', 0, [], '', 1, null]);
  assert.equal(m.read, '깨진.pdf: 글자를 뽑지 못함 · 원본 PDF 를 붙임(1KB)');
  assert.match(m.warnings[0], /^글자를 뽑지 못했습니다\(Invalid PDF structure\) — 원본 PDF 를 그대로 붙였습니다/);
});
await ta('pdf — 글자를 뽑지 못한 큰 PDF 는 pdfCount 로 쪽 수를 알아 나눈다. 쪽 수도 모르면 붙이지 못한다(까닭)', async () => {
  const m = await readDocument({ name: '깨진큰.pdf', bytes: new Uint8Array(5000) }, {
    engines: fakeEngines({ pdfText: async () => { throw new Error('bad'); }, pdfCount: async () => 5, pdfSlice: sizedSlice(1000) }),
    limits: { attachBytesMax: 2048 },
  });
  assert.deepEqual([m.total, m.parts.length, m.parts.every((p) => p.attach === 'slice')], [5, 5, true]);
  assert.equal(m.read, '깨진큰.pdf: 5쪽 · 글자를 뽑지 못함 · 5부분으로 나눠 차례로 보냄(부분마다 그 쪽만 담은 PDF)');
  const none = await readDocument({ name: '깨진큰.pdf', bytes: new Uint8Array(5000) }, {
    engines: fakeEngines({ pdfText: async () => { throw new Error('bad'); } }),
    limits: { attachBytesMax: 2048 },
  });
  assert.deepEqual([none.attach, none.file, none.chars, none.parts.length], ['none', null, 0, 1]);
  assert.equal(none.read, '깨진큰.pdf: 글자를 뽑지 못함 · 붙일 PDF 없음');
  assert.match(none.warnings[0], /^글자를 뽑지 못했습니다\(bad\) — 쪽 수를 알 수 없어 나누지 못했고, 원본이 커서\(5KB\) 붙이지도 못했습니다\(2KB 까지\)/);
});
await ta('pdf — 앞 maxPages 쪽만 읽었으면 알린다', async () => {
  const m = await readDocument({ name: '긴.pdf', bytes: PDF_BYTES }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: planPages(), total: 450 }), pdfSlice: async () => new Uint8Array(10) }),
  });
  assert.equal(m.total, 450);
  assert.deepEqual(m.warnings, ['앞 27쪽만 읽었습니다(전체 450쪽)']);
});
await ta('office — officeText(bytes, name, { max: Infinity, type }) 의 글을 구역으로 나눠 글자만(file null · attach none · picked null) — 한도 안이면 한 부분', async () => {
  const seen = [];
  const bytes = new Uint8Array([80, 75, 3, 4]);
  const m = await readDocument({ name: '계획서.hwpx', type: 'application/hwp+zip', bytes }, {
    engines: fakeEngines({ officeText: async (b, name, o) => { seen.push([b, name, o]); return { kind: 'hwpx', text: '과제명 시험용 직류 차단기 개발\n\n한국선급 인건비 >>> 끝', parts: 1, cut: false }; } }),
  });
  assert.deepEqual(seen, [[bytes, '계획서.hwpx', { max: Infinity, type: 'application/hwp+zip' }]]);
  assert.deepEqual([m.kind, m.total, m.picked, m.file, m.attach, m.warnings, m.parts.length], ['office', 1, null, null, 'none', [], 1]);
  assert.equal(m.text, '과제명 시험용 직류 차단기 개발\n\n한국선급 인건비 > > > 끝');
  assert.equal(m.chars, m.text.length);
  assert.deepEqual([m.parts[0].pages, m.parts[0].chunks, m.parts[0].no, m.parts[0].count], [null, [1, 1], 1, 1]);
  assert.equal(m.parts[0].read, `1/1부분 — 구역 1 · 글자 ${m.chars}자 · 글자만`);
  assert.equal(m.read, `계획서.hwpx: 구역 1개 · 글자 ${m.chars}자 · 한 번에 보냄 · 글자만 실음`);
});
await ta('office — 글이 길면 구역 경계에서 부분으로 나눈다(빠짐없이). officeText 가 잘랐으면 알린다. 글자가 없으면 던진다', async () => {
  const long = Array.from({ length: 60 }, (_, i) => (i % 10 === 3 ? `[한국선급] 인건비 연구개발비 비목 ${i}` : `배경 설명 ${i} `.repeat(30).trim())).join('\n\n');
  const m = await readDocument({ name: '긴.docx', bytes: new Uint8Array(4) }, {
    engines: fakeEngines({ officeText: async () => ({ kind: 'docx', text: long, parts: 1, cut: true }) }),
    limits: { partChars: 3000, chunkChars: 600 },
  });
  assert.ok(m.parts.length >= 6, `${m.parts.length}부분`);
  for (const p of m.parts) assert.ok(p.chars <= 3000 && p.attach === 'none' && p.file === null, `구역 ${p.chunks}`);
  for (let i = 1; i < m.parts.length; i++) assert.equal(m.parts[i].chunks[0], m.parts[i - 1].chunks[1] + 1);
  assert.equal(m.parts.at(-1).chunks[1], m.total);
  assert.equal(m.text, long, '글자는 다 든다 — 생략 표시 없음');
  assert.ok(m.text.includes('[한국선급] 인건비 연구개발비 비목 3'));
  assert.match(m.read, /^긴\.docx: 구역 \d+개 · 글자 [\d,]+자 · \d+부분으로 나눠 차례로 보냄\(글자만\)$/);
  assert.deepEqual(m.warnings, ['글자를 끝까지 읽지 못했습니다(officeText 가 잘랐습니다)']);
  await assert.rejects(readDocument({ name: '빈.xlsx', bytes: new Uint8Array(4) }, { engines: fakeEngines({ officeText: async () => ({ kind: 'xlsx', text: '  ', parts: 1, cut: false }) }) }),
    { message: '빈.xlsx: 글자가 없습니다 — 뽑을 것이 없습니다' });
});
await ta('office — officeText 가 던지면(암호·깨짐) 그 까닭 그대로 던진다', async () => {
  await assert.rejects(readDocument({ name: '잠긴.docx', bytes: new Uint8Array(4) }, {
    engines: fakeEngines({ officeText: async (b, name) => { throw new Error(`${name}: 암호가 걸렸거나 옛 형식(doc·xls·ppt)을 이름만 바꾼 파일이라 글자를 뽑지 못했습니다.`); } }),
  }), /^Error: 잠긴\.docx: 암호가 걸렸거나/);
});
await ta('text — UTF-8(앞의 BOM 은 뗀다)·CRLF 를 그대로 글로. ArrayBuffer 도 받는다', async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('변경 메모\r\n\r\n한국선급 연구재료비 12,000 → 15,000')]);
  const m = await readDocument({ name: '메모.txt', bytes: bytes.buffer }, { engines: fakeEngines() });
  assert.deepEqual([m.kind, m.total, m.picked, m.file, m.attach, m.parts.length], ['text', 1, null, null, 'none', 1], '짧은 문단 둘은 한 구역');
  assert.equal(m.text, '변경 메모\n\n한국선급 연구재료비 12,000 → 15,000');
  await assert.rejects(readDocument({ name: '빈.md', bytes: new Uint8Array(0) }, { engines: fakeEngines() }), /빈\.md: 글자가 없습니다/);
});
await ta('yaml·hwp·모르는 것은 엔진을 부르기 전에 던진다 — 바이트가 없어도 던진다. 큰 PDF 라고 던지지 않는다', async () => {
  await assert.rejects(readDocument({ name: 'KR_과제.yaml', bytes: new Uint8Array(4) }, { engines: fakeEngines() }), { message: 'YAML 은 재료가 아니라 그대로 넣는 파일입니다' });
  await assert.rejects(readDocument({ name: '계획서.hwp', bytes: new Uint8Array(4) }, { engines: fakeEngines() }), { message: unsupportedDocNote('계획서.hwp') });
  await assert.rejects(readDocument({ name: '옛.doc', bytes: new Uint8Array(4) }, { engines: fakeEngines() }), { message: unsupportedDocNote('옛.doc') });
  await assert.rejects(readDocument({ name: 'a.pdf' }, { engines: fakeEngines() }), { message: 'a.pdf: 파일 바이트가 없습니다' });
  const big = await readDocument({ name: '거대한.pdf', bytes: new Uint8Array(30 * 1024 * 1024) }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: ['한국선급 '.repeat(20)], total: 1 }), pdfSlice: async () => new Uint8Array(4) }),
  });
  assert.equal(big.parts.length, 1);
  assert.equal(big.attach, 'slice');
});

/* ------------------------------------------------------------ pdfAllText (가짜 open) */

console.log('doctext/browser.js pdfAllText (가짜 open)');
/** 가짜 pdf.js 문서 — 쪽마다 글 조각(str·hasEOL). 무엇을 불렀는지 적는다. */
function fakePdf(numPages, { failAt = 0 } = {}) {
  const log = [];
  const doc = {
    numPages,
    getPage: async (i) => {
      log.push(`page:${i}`);
      if (i === failAt) throw new Error(`쪽 ${i} 이 깨짐`);
      return {
        getTextContent: async () => ({ items: [{ str: `${i}쪽 첫 줄`, hasEOL: true }, { str: '둘째', hasEOL: false }, { str: ' 줄', hasEOL: false }, {}] }),
        cleanup: () => log.push(`cleanup:${i}`),
      };
    },
  };
  const open = async (bytes) => { log.push(`open:${bytes.length}`); return { doc, close: async () => { log.push('close'); } }; };
  return { open, log };
}
await ta('모든 쪽을 뽑는다(pdfText 의 6쪽 한도 없이) — 줄 바꿈은 hasEOL, 쪽마다 cleanup, 끝에 close', async () => {
  const fake = fakePdf(9);
  const got = await pdfAllText(new Uint8Array(5), { open: fake.open });
  assert.equal(got.total, 9);
  assert.equal(got.pages.length, 9);
  assert.equal(got.pages[0], '1쪽 첫 줄\n둘째 줄');
  assert.equal(got.pages[8], '9쪽 첫 줄\n둘째 줄');
  assert.deepEqual(fake.log.slice(0, 3), ['open:5', 'page:1', 'cleanup:1']);
  assert.equal(fake.log.at(-1), 'close');
});
await ta('maxPages 까지만 — total 은 문서의 쪽 수 그대로. 기본은 400쪽, 재료는 Infinity 로 다 읽는다', async () => {
  const fake = fakePdf(500);
  const got = await pdfAllText(new Uint8Array(1), { open: fake.open, maxPages: 3 });
  assert.deepEqual([got.pages.length, got.total], [3, 500]);
  const all = await pdfAllText(new Uint8Array(1), { open: fakePdf(500).open });
  assert.deepEqual([all.pages.length, all.total], [400, 500]);
  const every = await pdfAllText(new Uint8Array(1), { open: fakePdf(450).open, maxPages: Infinity });
  assert.deepEqual([every.pages.length, every.total], [450, 450]);
});
await ta('쪽을 읽다 던지면 그대로 던지되 close 는 부른다', async () => {
  const fake = fakePdf(5, { failAt: 3 });
  await assert.rejects(pdfAllText(new Uint8Array(1), { open: fake.open }), /쪽 3 이 깨짐/);
  assert.equal(fake.log.at(-1), 'close');
});

/* ------------------------------------------------------------ 진짜 엔진 */

console.log('진짜 엔진 — pdf-lib 자르기·쪽 수 · officetext');
/** 쪽마다 너비가 다른 PDF(n쪽 너비 = 100 + n) — 자른 쪽이 어느 쪽인지 너비로 안다. */
async function widthPdf(count) {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= count; n++) doc.addPage([100 + n, 300]);
  return doc.save();
}
const widthsOf = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => Math.round(p.getWidth()));

await ta('defaultEngines().pdfSlice — 3쪽 PDF 에서 [1,3] 을 잘라 2쪽 PDF(다시 load 해 getPageCount 2, 1·3쪽의 너비) · pdfCount 는 쪽 수', async () => {
  const out = await defaultEngines().pdfSlice(await widthPdf(3), [1, 3]);
  assert.ok(out instanceof Uint8Array);
  assert.equal((await PDFDocument.load(out)).getPageCount(), 2);
  assert.deepEqual(await widthsOf(out), [101, 103]);
  assert.equal(await defaultEngines().pdfCount(await widthPdf(4)), 4);
});
await ta('pdfSlice — 쪽 번호는 겹침을 빼고 차례로, 없는 쪽은 버리고, 남는 것이 없으면 던진다. PDF 가 아니면 던진다', async () => {
  const src = await widthPdf(4);
  assert.deepEqual(await widthsOf(await defaultEngines().pdfSlice(src, [4, 2, 2, 9, 0])), [102, 104]);
  await assert.rejects(defaultEngines().pdfSlice(src, [7]), /고른 쪽이 없습니다/);
  await assert.rejects(defaultEngines().pdfSlice(new Uint8Array(Buffer.from('PDF 아님')), [1]));
});
await ta('readDocument 끝까지 — 가짜 글자 층 + 진짜 pdf-lib: 부분마다 붙인 작은 PDF 의 쪽이 그 부분의 쪽 범위와 같다', async () => {
  const bytes = await widthPdf(27);
  const m = await readDocument({ name: '사업계획서.pdf', type: 'application/pdf', bytes }, {
    engines: { pdfText: async () => ({ pages: planPages(), total: 27 }) },
    limits: { partChars: 600 },
  });
  assert.ok(m.parts.length > 1);
  for (const p of m.parts) {
    assert.equal(p.attach, 'slice');
    assert.deepEqual(await widthsOf(fromUrl(p.file.dataUrl)), range(p.pages[0], p.pages[1]).map((n) => 100 + n));
    assert.ok(p.read.endsWith(`작은 PDF ${Math.max(1, Math.ceil(dataUrlBytes(p.file.dataUrl) / 1024))}KB`));
  }
  const one = await readDocument({ name: '사업계획서.pdf', bytes }, { engines: { pdfText: async () => ({ pages: planPages(), total: 27 }) } });
  assert.equal(one.attach, 'slice');
  assert.deepEqual(await widthsOf(fromUrl(one.file.dataUrl)), range(1, 27).map((n) => 100 + n));
});
await ta('readDocument 끝까지 — 진짜 officetext 로 hwpx 의 글자', async () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">'
    + '<hp:p><hp:run><hp:t>과제명 시험용 직류 차단기 개발</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>공동연구개발기관 한국선급 책임자 홍길동</hp:t></hp:run></hp:p></hs:sec>';
  const bytes = buildZip([{ name: 'mimetype', data: 'application/hwp+zip' }, { name: 'Contents/section0.xml', data: xml }], { date: new Date(2026, 9, 16) });
  const m = await readDocument({ name: '계획서.hwpx', bytes });
  assert.equal(m.kind, 'office');
  assert.equal(m.text, '과제명 시험용 직류 차단기 개발\n공동연구개발기관 한국선급 책임자 홍길동');
  await assert.rejects(defaultEngines().officeText(new Uint8Array(4), '옛.doc', {}), /^Error: 옛\.doc: doc\(워드 옛 형식\)/);
});

console.log(`\n통과 ${pass}건`);
