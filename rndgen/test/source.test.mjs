// 문서 → 재료(rndgen/source.js)와 PDF 전체 글자(doctext/browser.js pdfAllText).
//
// 갈래 가리기·쪽 점수(낱말·표 같음·기관 블록·장)·쪽/구역 고르기·글 잇기·data URL 은 엔진 없이, readDocument 의 갈래(pdf 글자 층 있음·없음·
// 작은 PDF 실패·office·text·yaml/hwp 거절·20MB 거절)는 가짜 엔진으로 본다. 작은 PDF 자르기(pdf-lib)와 hwpx 글자(src/officetext.js)는 진짜 엔진으로.
// 사업계획서는 지어낸 것이다(과제 "시험용 직류 차단기 개발", RS-2026-00000001, 홍길동·이몽룡·성춘향 — test/fixtures/rnd 와 같은 가짜). 실물 PDF 는 읽지 않는다.
import assert from 'node:assert/strict';

import { PDFDocument } from '../../vendor/pdf-lib.esm.min.js';
import { buildZip } from '../../src/zip.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

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
  assert.deepEqual(Object.keys(engines0).sort(), ['officeText', 'pdfSlice', 'pdfText']);
  for (const fn of Object.values(engines0)) assert.equal(typeof fn, 'function');
});
const {
  LIMITS, KEYWORDS, docKind, unsupportedDocNote, scorePage, scorePages, pickPages, pickChunks, pagesText, toDataUrl, dataUrlBytes, readDocument, defaultEngines,
} = S;
const { pdfAllText } = B;

t('한도는 계약서 §1-10 그대로 — 24쪽 · 90,000자 · 앞 3쪽 · 원본 20MB · 붙임 8MB · office 150,000자 · 구역 3,000자. 얼려 있다', () => {
  assert.deepEqual({ ...LIMITS }, {
    textChars: 90_000, pdfPages: 24, alwaysPages: 3, pdfBytesMax: 20 * 1024 * 1024, attachBytesMax: 8 * 1024 * 1024, officeChars: 150_000, chunkChars: 3_000,
  });
  assert.ok(Object.isFrozen(LIMITS) && Object.isFrozen(KEYWORDS));
  assert.deepEqual(KEYWORDS[0], ['한국선급', 5]);
  assert.ok(KEYWORDS.every(([w, n]) => typeof w === 'string' && Number.isInteger(n) && n > 0));
});

/* ------------------------------------------------------------ 지어낸 사업계획서 */

const amounts = (n, from = 1000) => Array.from({ length: n }, (_, i) => (from + i * 1250).toLocaleString('en-US')).join(' ');
/** 27쪽짜리 지어낸 사업계획서 — KR(공동연구개발기관2)의 쪽: 9·12·13·15·19·20·22·25·26. 다른 기관의 같은 꼴 쪽: 10·11·14·23·24·27. */
function planPages() {
  const budgetTable = (org) => `${org}\n(단위: 천원)\n연구개발기관별 사용계획 총괄표\n비목 직접비 인건비 연구재료비 연구활동비 간접비 합계\n${amounts(16)}`;
  return [
    /* 1 */ `연구개발계획서\n과제명 시험용 직류 차단기 개발\n연구개발과제번호 RS-2026-00000001\n연구개발기간 2025.04.01 ~ 2028.12.31\n주관연구개발기관 가나전기(주)\n공동연구개발기관 한국선급 책임자 홍길동\n총 연구개발비 ${amounts(3)} 천원`,
    /* 2 */ '< 요 약 문 >\n연구개발 목표 시험용 직류 차단기의 선급 기준 마련과 시제품 검증\n연구개발 내용 차단기 설계·시험·인증 절차',
    /* 3 */ '요약문 계속\n기대효과 선박 직류 배전 보호 기술 확보\n중심어 직류 차단기 선급',
    /* 4 */ `목 차\n1. 연구개발과제의 필요성 ··········· 1\n2. 연구개발과제의 목표 및 내용 ··········· 5\n2-1. 성능목표 ··········· 6\n6. 안전 ··········· 20\n8. 연구개발비 사용에 관한 계획 ··········· 25\n8-2. 연구개발비 사용계획 ··········· 26\n한국선급 참여연구자 인건비 성과지표 개발목표 개발내용 수행일정`,
    /* 5 */ '1. 연구개발과제의 필요성 및 현황\n1-1. 개발 대상 기술의 개요\n직류 배전은 손실이 적고 연구개발비 대비 효과가 크다. 개발목표 를 세운다.',
    /* 6 */ '1-2. 연구개발과제의 배경 및 필요성\n국내외 직류 차단기 시장 현황 2020년 이후 연평균 성장. 연구개발기간 동안의 개발목표 와 개발내용.',
    /* 7 */ '1-3. 관련 지식재산권, 표준화 및 인증기준 현황\nIEC 표준 동향 · 국제 특허 동향 · 한국선급 기준 개정 동향',
    /* 8 */ '국외 기술 동향\n유럽 선급의 직류 배전 지침 현황',
    /* 9 */ `2. 연구개발과제의 목표 및 내용\n2-1. 연구개발과제의 최종 목표\n성능목표 평가항목 단위 목표치 평가방법\n차단 시간 ms 5 공인시험 한국선급 입회\n성과지표 논문 1 · 기준(안) 1 (한국선급)`,
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
const KR_PAGES = [9, 12, 13, 15, 19, 20, 22, 25, 26];
const OTHER_PAGES = [10, 11, 14, 23, 24, 27];

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

/* ------------------------------------------------------------ 점수 */

console.log('쪽 점수 (scorePage)');
t('빈 글은 0, 낱말마다 무게 × 횟수 — 한글 낱말은 글자 사이 빈칸을 견디고, KR 은 낱말 경계로만(KRW 는 아니다)', () => {
  assert.equal(scorePage(''), 0);
  assert.equal(scorePage('  \n '), 0);
  assert.equal(scorePage(null), 0);
  assert.equal(scorePage('한국선급'), 5);
  assert.equal(scorePage('참여 연구자'), 3);
  assert.equal(scorePage('연구개발 비'), 3);
  assert.equal(scorePage('KR'), 1);
  assert.equal(scorePage('KRW KRISO'), 0);
  assert.equal(scorePage('아무 관계 없는 글'), 0);
});
t('한 낱말은 세 번까지만 센다 — "한국선급"만 여섯 번까지(KR 행이 많은 표)', () => {
  assert.equal(scorePage('개발목표 '.repeat(10)), 9);
  assert.equal(scorePage('한국선급 '.repeat(4)), 20);
  assert.equal(scorePage('한국선급 '.repeat(10)), 30);
});
t('표 같음 가산 — 금액 넷마다 1(6까지)·"천원" 2·백분율 셋마다 1·표 금 열마다 1', () => {
  assert.equal(scorePage(amounts(8)), 2);
  assert.equal(scorePage(amounts(40)), 6);
  assert.equal(scorePage('단위 천원'), 2);
  assert.equal(scorePage('15% 20% 30%'), 1);
  assert.equal(scorePage('│'.repeat(10)), 1);
});
t('목차는 낱말이 다 들어 있어도 0 — "목 차" 줄이나 점선 끌기 다섯 줄', () => {
  const toc = planPages()[3];
  assert.equal(scorePage(toc), 0);
  assert.equal(scorePage(`개발목표 한국선급\n${'항목 ······ 1\n'.repeat(5)}`), 0);
  assert.ok(scorePage(`개발목표 한국선급\n${'항목 ······ 1\n'.repeat(4)}`) > 0);
});
t('실적·특허·논문은 깎는다 — 0 아래로는 안 간다, 늘 정수', () => {
  assert.equal(scorePage('한국선급 특허'), 3);
  assert.equal(scorePage('특허 논문 실적'), 0);
  for (const p of planPages()) assert.ok(Number.isInteger(scorePage(p)));
});

console.log('기관 블록·장 (scorePages)');
const BODY = '개발내용 시험 절차';   // scorePage 3
t('KR 블록 — 머리 쪽과 이어지는 쪽(KR 이 다시 안 나와도)에 10 을 더한다', () => {
  assert.deepEqual(scorePages(['[공동연구개발기관2 : 한국선급]', BODY]), [18, 13]);
  assert.deepEqual(scorePages(['[한국선급]', BODY]), [15, 13], '기관 이름만 괄호에 넣은 머리');
  assert.deepEqual(scorePages(['[11. 한국선급]', BODY]), [15, 13]);
  assert.deepEqual(scorePages(['(3) 공동연구개발기관책임자(한국선급)', BODY]), [18, 13]);
});
t('다른 기관의 블록이면 KR 이 안 나오는 쪽은 ×0.25, 어느 블록도 아니면 ×0.5 — KR 이 한 번이라도 나오면 그대로', () => {
  assert.deepEqual(scorePages(['[공동연구개발기관1 : 다라대학교]', BODY]), [0, 0]);
  assert.deepEqual(scorePages(['[코오롱 중앙기술원]', BODY]), [0, 0]);
  assert.deepEqual(scorePages([BODY]), [1]);
  assert.deepEqual(scorePages(['[공동연구개발기관1 : 다라대학교]', `${BODY} 한국선급`]), [0, 8]);
});
t('괄호 제목(요약표·그림·확약서)은 기관 머리가 아니다', () => {
  for (const head of ['[요약표]', '[그림 3]', '[수요기업 확약서]', '[첨부 2]']) assert.deepEqual(scorePages([`${head}\n${BODY}`]), [1], head);
});
t('블록은 다른 기관의 머리·장 제목·절 제목·12쪽을 넘김에서 끝난다', () => {
  assert.deepEqual(scorePages(['[한국선급]', '[공동연구개발기관3 : 마바연구원]', BODY]), [15, 0, 0]);
  assert.deepEqual(scorePages(['[한국선급]', `8-3. 연구개발비 세부 사용계획\n${BODY}`]).at(1), Math.floor(scorePage(`8-3. 연구개발비 세부 사용계획\n${BODY}`) * 0.5));
  const run = scorePages(['[한국선급]', ...Array(13).fill(BODY)]);
  assert.deepEqual(run.slice(1, 13), Array(12).fill(13));
  assert.equal(run[13], 1, '열세 번째 쪽부터는 블록 밖');
});
t('장 — 01·04·05장은 ×0.3, 03장 ×0.6, 02·06·07·08장 그대로. 글자 층이 번호를 뒤로 보낸 제목("…계획8.")도 장이다', () => {
  const page = '연구개발비 사용계획 비목 한국선급';   // 13
  assert.deepEqual(scorePages(['8. 연구개발비 사용에 관한 계획', page]).at(1), 13);
  assert.deepEqual(scorePages(['연구개발비 사용에 관한 계획8.', page]).at(1), 13);
  assert.deepEqual(scorePages(['1. 연구개발과제의 필요성 및 현황', page]).at(1), 3);
  assert.deepEqual(scorePages(['연구개발과제의 필요성1.', page]).at(1), 3);
  assert.deepEqual(scorePages(['3. 연구개발과제의 추진전략·방법 및 추진체계', page]).at(1), 7);
  assert.deepEqual(scorePages(['5. 연구개발성과의 사업화 전략 및 계획', page]).at(1), 3);
});
t('절 — 실적·보유현황·일반 현황·시설·장비·보안 절은 ×0.3, 절 번호가 장을 정한다. 번호만 맞고 제목이 다른 줄("1. 시험 장비 구축")은 장이 아니다', () => {
  const page = '연구개발비 사용계획 비목 한국선급';
  assert.equal(scorePages(['7-2. 연구개발기관 연구개발 실적', page]).at(1), 3);
  assert.equal(scorePages(['연구시설 장비 보유현황7-2.', page]).at(1), 3);
  assert.equal(scorePages(['6-2. 보안조치 이행계획', page]).at(1), 3);
  assert.equal(scorePages(['1. 연구개발과제의 필요성', '8-2. 연구개발비 사용계획', page]).at(2), 13, '절이 장을 8 로 되돌린다');
  assert.equal(scorePages(['8. 연구개발비 사용에 관한 계획', '1. 시험 장비 구축', page]).at(2), 13);
});
t('목차 쪽은 0 이고 따라가기에 넣지 않는다 — 목차의 장 제목이 뒤 쪽의 장을 바꾸지 않는다', () => {
  const toc = '목 차\n8. 연구개발비 사용에 관한 계획\n1. 연구개발과제의 필요성';
  assert.deepEqual(scorePages(['[한국선급]', toc, BODY]), [15, 0, 13]);
});
t('같은 입력이면 같은 점수 — 정수 배열', () => {
  const a = scorePages(planPages());
  assert.deepEqual(scorePages(planPages()), a);
  assert.equal(a.length, 27);
  assert.ok(a.every(Number.isInteger));
  assert.deepEqual(scorePages(undefined), []);
});

/* ------------------------------------------------------------ 고르기 */

console.log('쪽 고르기 (pickPages · pagesText)');
t('지어낸 사업계획서 — 12쪽이면 앞 3쪽과 KR 쪽 아홉이 다 들고, 목차·다른 기관의 같은 꼴 쪽·실적·01장은 안 든다', () => {
  const picked = pickPages(planPages(), { max: 12 });
  assert.deepEqual(picked, [1, 2, 3, ...KR_PAGES]);
});
t('24쪽(기본) — KR 쪽 먼저, 남는 자리는 점수 차례로 채우되 0점인 쪽(목차 등)은 넣지 않는다', () => {
  const picked = pickPages(planPages());
  for (const n of [1, 2, 3, ...KR_PAGES]) assert.ok(picked.includes(n), `${n}쪽`);
  assert.ok(!picked.includes(4), '목차');
  assert.ok(picked.length <= 24);
  assert.deepEqual(picked, [...picked].sort((a, b) => a - b));
  const scores = scorePages(planPages());
  for (const n of picked) assert.ok(n <= 3 || scores[n - 1] >= 1, `${n}쪽 점수 ${scores[n - 1]}`);
});
t('쪽이 max 안이고 다 합쳐도 예산 안이면 전부 — 점수를 보지 않는다', () => {
  assert.deepEqual(pickPages(['', '가', '나', '다', '라']), [1, 2, 3, 4, 5]);
  assert.deepEqual(pickPages([]), []);
});
t('앞 always 쪽은 점수가 0 이어도 늘 — 나머지는 점수 차례, 같으면 앞 쪽', () => {
  const pages = ['', '', '', BODY, '한국선급', '한국선급', '한국선급 개발목표', '', ''];
  assert.deepEqual(pickPages(pages, { max: 5, always: 3 }), [1, 2, 3, 5, 7]);
  assert.deepEqual(pickPages(pages, { max: 4, always: 0 }), [5, 6, 7, 4].sort((a, b) => a - b));
  assert.deepEqual(pickPages(pages, { max: 2, always: 3 }), [1, 2], 'always 도 max 를 넘지 않는다');
});
t('예산(글자)은 pagesText 가 이을 꼴로 센다 — 안 맞는 쪽은 건너뛰고 다음 쪽을 본다', () => {
  const big = `한국선급 개발목표 ${'가'.repeat(500)}`;   // 점수 높고 길다
  const small = '한국선급';
  const pages = ['표지', '', '', big, small, small];
  const picked = pickPages(pages, { max: 6, always: 1, budget: 60 });
  assert.deepEqual(picked, [1, 5, 6]);
  assert.ok(pagesText(pages, picked).length <= 60);
  const all = pickPages(pages, { max: 6, always: 1, budget: 2000 });
  assert.ok(all.includes(4));
});
t('pagesText — 고른 쪽만 "— N쪽 —" 표시로 잇고, 없는 쪽 번호는 버린다. 글 안의 >>> 는 > > > (울타리 깨짐 막기)', () => {
  const pages = ['첫 쪽', '둘째 쪽 >>> 끝', '셋째'];
  assert.equal(pagesText(pages, [1, 2, 9, 0]), '— 1쪽 —\n첫 쪽\n\n— 2쪽 —\n둘째 쪽 > > > 끝');
  assert.equal(pagesText(pages, []), '');
  assert.equal(pagesText(['a >>>> b'], [1]), '— 1쪽 —\na > > > > b');
});

console.log('구역 고르기 (pickChunks)');
t('다 합쳐 예산 안이면 전부(생략 표시 없음) — 빈 글은 구역 0', () => {
  assert.deepEqual(pickChunks('가\n\n나\n\n다', { budget: 100, chunk: 3 }), { text: '가\n\n나\n\n다', picked: 3, total: 3 });
  assert.deepEqual(pickChunks('', {}), { text: '', picked: 0, total: 0 });
  assert.deepEqual(pickChunks('a >>> b').text, 'a > > > b');
});
t('넘치면 첫 구역은 늘, 나머지는 점수 차례로 예산 안에서 — 차례는 문서 차례, 뛴 곳과 끝은 "(… 생략 …)". 구역에도 KR 블록 잇기가 든다', () => {
  // 문단마다 한 구역(이웃과 합치면 60자를 넘는다). 0점 문단(배경·끝맺음)은 자리가 남아도 넣지 않지만, KR 머리 바로 뒤의 문단(실무 내용)은 KR 블록이라 든다.
  const paras = ['과제명 시험용 직류 차단기 개발', '배경 설명 '.repeat(8).trim(), '[공동연구개발기관2 : 한국선급]\n개발목표 기준(안)', '시험 절차 '.repeat(8).trim(), '한국선급 인건비 비목 연구개발비', '끝맺음 글 '.repeat(8).trim()];
  const got = pickChunks(paras.join('\n\n'), { budget: 200, chunk: 60 });
  assert.equal(got.total, 6);
  assert.equal(got.picked, 4);
  assert.equal(got.text, [paras[0], '(… 생략 …)', paras[2], paras[3], paras[4], '(… 생략 …)'].join('\n\n'));
  assert.ok(got.text.length <= 200);
  const tight = pickChunks(paras.join('\n\n'), { budget: 120, chunk: 60 });
  assert.ok(tight.text.length <= 120, `${tight.text.length}자`);
  assert.ok(tight.text.startsWith(paras[0]) && tight.text.includes(paras[2]), '예산이 모자라면 점수 높은 것부터');
});
t('구역 크기를 넘는 문단은 줄에서, 그래도 길면 그 자리에서 자른다 — 어느 구역도 chunk 를 넘지 않는다', () => {
  const text = [`${'가'.repeat(25)}\n${'나'.repeat(25)}\n${'다'.repeat(70)}`, '라'].join('\n\n');
  const got = pickChunks(text, { budget: 10_000, chunk: 30 });
  for (const piece of got.text.split('\n\n')) assert.ok(piece.length <= 30, piece);
  assert.equal(got.text.replace(/\n/g, ''), text.replace(/\n/g, ''));
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

console.log('문서 → 재료 (가짜 엔진)');
/** 부르면 안 되는 엔진. */
const never = (what) => async () => assert.fail(`${what} 을(를) 부르면 안 된다`);
const fakeEngines = (over = {}) => ({ pdfText: never('pdfText'), pdfSlice: never('pdfSlice'), officeText: never('officeText'), ...over });
const fromUrl = (url) => new Uint8Array(Buffer.from(url.split(',')[1], 'base64'));
const PDF_BYTES = new Uint8Array(Buffer.from('%PDF-1.7 가짜 사업계획서'));

await ta('pdf(글자 층 있음) — 쪽을 골라 글로 싣고 같은 쪽을 pdfSlice 로 잘라 붙인다(attach slice)', async () => {
  const calls = [];
  const slice = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);
  const m = await readDocument({ name: '사업계획서.pdf', type: 'application/pdf', bytes: PDF_BYTES }, {
    engines: fakeEngines({
      pdfText: async (b) => { calls.push(['text', b]); return { pages: planPages(), total: 27 }; },
      pdfSlice: async (b, picked) => { calls.push(['slice', b, picked]); return slice; },
    }),
    limits: { pdfPages: 12 },
  });
  assert.deepEqual(calls.map((c) => c[0]), ['text', 'slice']);
  assert.equal(calls[0][1], PDF_BYTES);
  assert.deepEqual(calls[1][2], [1, 2, 3, ...KR_PAGES]);
  assert.deepEqual([m.name, m.kind, m.total, m.picked, m.attach], ['사업계획서.pdf', 'pdf', 27, [1, 2, 3, ...KR_PAGES], 'slice']);
  assert.deepEqual([m.file.name, m.file.type], ['사업계획서_발췌.pdf', 'application/pdf']);
  assert.deepEqual([...fromUrl(m.file.dataUrl)], [...slice]);
  assert.equal(m.text, pagesText(planPages(), m.picked));
  assert.ok(m.text.startsWith('— 1쪽 —\n연구개발계획서\n과제명 시험용 직류 차단기 개발'));
  assert.ok(m.text.includes('— 25쪽 —\n[공동연구개발기관2 : 한국선급]'));
  assert.equal(m.chars, m.text.length);
  assert.equal(m.read, `사업계획서.pdf: 27쪽 가운데 12쪽 · 글자 ${m.chars.toLocaleString('ko-KR')}자 · 그 쪽들을 작은 PDF 로 붙임(1KB)`);
  assert.deepEqual(m.warnings, []);
});
await ta('pdf — 쪽 글은 다듬는다(빈칸 묶음·줄 끝 빈칸·빈 줄 셋 이상), 다 고르면 "N쪽 전부"', async () => {
  const pages = [`과제명   시험용\u00a0직류 차단기  \n\n\n\n개발 ${'가'.repeat(40)}`, `한국선급 ${'나'.repeat(40)}`];
  const m = await readDocument({ name: 'a.pdf', bytes: PDF_BYTES }, { engines: fakeEngines({ pdfText: async () => ({ pages, total: 2 }), pdfSlice: async () => new Uint8Array(3000) }) });
  assert.equal(m.text, `— 1쪽 —\n과제명 시험용 직류 차단기\n\n개발 ${'가'.repeat(40)}\n\n— 2쪽 —\n한국선급 ${'나'.repeat(40)}`);
  assert.match(m.read, /^a\.pdf: 2쪽 전부 · 글자 \d+자 · 그 쪽들을 작은 PDF 로 붙임\(3KB\)$/);
});
await ta('pdf — 작은 PDF 를 못 만들면(암호 등) 글자만(attach none), 까닭은 warnings 에', async () => {
  const m = await readDocument({ name: '잠긴.pdf', bytes: PDF_BYTES }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: planPages(), total: 27 }), pdfSlice: async () => { throw new Error('Input document to `PDFDocument.load` is encrypted'); } }),
  });
  assert.deepEqual([m.attach, m.file], ['none', null]);
  assert.ok(m.picked.length > 0 && m.text.length > 0);
  assert.match(m.read, /^잠긴\.pdf: 27쪽 가운데 \d+쪽 · 글자 [\d,]+자 · 글자만 실음\(작은 PDF 를 만들지 못함\)$/);
  assert.deepEqual(m.warnings, ['고른 쪽만 담은 작은 PDF 를 만들지 못해(Input document to `PDFDocument.load` is encrypted) 글자만 실었습니다']);
});
await ta('pdf — 작은 PDF 도 attachBytesMax 를 넘으면 붙이지 않고 글자만', async () => {
  const m = await readDocument({ name: '그림많은.pdf', bytes: PDF_BYTES }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: planPages(), total: 27 }), pdfSlice: async () => new Uint8Array(5000) }),
    limits: { attachBytesMax: 4096 },
  });
  assert.deepEqual([m.attach, m.file], ['none', null]);
  assert.match(m.read, /글자만 실음\(작은 PDF 가 5KB로 큼\)$/);
  assert.deepEqual(m.warnings, ['고른 쪽만 담은 작은 PDF 도 커서(5KB) 붙이지 않고 글자만 실었습니다 — 4KB 까지']);
});
await ta('pdf(글자 층 없음 — 40자 넘는 쪽이 30% 아래) — 원본이 attachBytesMax 안이면 원본째(attach original)', async () => {
  const pages = ['- 1 -', '', '', `과제명 시험용 직류 차단기 개발 ${'가'.repeat(40)}`, ...Array(6).fill('')];
  const m = await readDocument({ name: '스캔.pdf', bytes: PDF_BYTES }, { engines: fakeEngines({ pdfText: async () => ({ pages, total: 10 }) }) });
  assert.deepEqual([m.kind, m.total, m.attach, m.picked], ['pdf', 10, 'original', [4]]);
  assert.deepEqual([m.file.name, m.file.type], ['스캔.pdf', 'application/pdf']);
  assert.deepEqual([...fromUrl(m.file.dataUrl)], [...PDF_BYTES]);
  assert.ok(m.text.startsWith('— 4쪽 —\n과제명'));
  assert.equal(m.read, `스캔.pdf: 10쪽 · 글자 층 없음(스캔본) · 원본 PDF 를 붙임(1KB) · 글자가 든 1쪽은 글로도 실음`);
  assert.equal(m.warnings.length, 1);
  assert.match(m.warnings[0], /^글자 층이 없는 PDF\(스캔본\)입니다 — 원본 PDF 를 그대로 붙였습니다/);
});
await ta('pdf(글자 층 없음) — 원본이 크면 붙이지 못한다(attach none + 경고), 글자가 하나도 없으면 text 는 빈 글', async () => {
  const m = await readDocument({ name: '큰스캔.pdf', bytes: new Uint8Array(3000) }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: ['', '', ''], total: 3 }) }),
    limits: { attachBytesMax: 2048 },
  });
  assert.deepEqual([m.attach, m.file, m.picked, m.text, m.chars], ['none', null, [], '', 0]);
  assert.equal(m.read, '큰스캔.pdf: 3쪽 · 글자 층 없음(스캔본) · 원본이 커서(3KB) 붙이지 못함');
  assert.match(m.warnings[0], /^글자 층이 없는 PDF\(스캔본\)입니다 — 원본이 커서\(3KB\) 붙이지도 못했습니다\(2KB 까지\)/);
});
await ta('pdf — 글자를 뽑다 던지면(엔진 없음·깨짐) 스캔본처럼 원본째, 까닭은 warnings 에', async () => {
  const m = await readDocument({ name: '깨진.pdf', bytes: PDF_BYTES }, { engines: fakeEngines({ pdfText: async () => { throw new Error('Invalid PDF structure'); } }) });
  assert.deepEqual([m.attach, m.total, m.picked, m.text], ['original', 0, [], '']);
  assert.equal(m.read, '깨진.pdf: 글자를 뽑지 못함 · 원본 PDF 를 붙임(1KB)');
  assert.match(m.warnings[0], /^글자를 뽑지 못했습니다\(Invalid PDF structure\) — 원본 PDF 를 그대로 붙였습니다/);
});
await ta('pdf — 앞 maxPages 쪽만 읽었으면 알린다', async () => {
  const m = await readDocument({ name: '긴.pdf', bytes: PDF_BYTES }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: planPages(), total: 450 }), pdfSlice: async () => new Uint8Array(10) }),
  });
  assert.equal(m.total, 450);
  assert.deepEqual(m.warnings, ['앞 27쪽만 읽었습니다(전체 450쪽)']);
});
await ta('pdf — 원본이 pdfBytesMax(20MB)를 넘으면 엔진을 부르기 전에 던진다', async () => {
  const big = new Uint8Array(20 * 1024 * 1024 + 1);
  await assert.rejects(readDocument({ name: '거대한.pdf', type: 'application/pdf', bytes: big }, { engines: fakeEngines() }),
    { message: '거대한.pdf: PDF 가 너무 큽니다(20.0MB) — 20MB 까지' });
  await assert.rejects(readDocument({ name: 'b.pdf', bytes: new Uint8Array(30 * 1024 * 1024) }, { engines: fakeEngines() }), /\(30\.0MB\) — 20MB 까지$/);
  await assert.doesNotReject(readDocument({ name: 'c.pdf', bytes: new Uint8Array(10) }, {
    engines: fakeEngines({ pdfText: async () => ({ pages: ['한국선급 '.repeat(20)], total: 1 }), pdfSlice: async () => new Uint8Array(4) }),
  }));
});
await ta('office — officeText(bytes, name, { max: 150,000, type }) 의 글을 구역으로 고른다. 글자만(file null · attach none · picked null)', async () => {
  const seen = [];
  const bytes = new Uint8Array([80, 75, 3, 4]);
  const m = await readDocument({ name: '계획서.hwpx', type: 'application/hwp+zip', bytes }, {
    engines: fakeEngines({ officeText: async (b, name, o) => { seen.push([b, name, o]); return { kind: 'hwpx', text: '과제명 시험용 직류 차단기 개발\n\n한국선급 인건비 >>> 끝', parts: 1, cut: false }; } }),
  });
  assert.deepEqual(seen, [[bytes, '계획서.hwpx', { max: 150_000, type: 'application/hwp+zip' }]]);
  assert.deepEqual([m.kind, m.total, m.picked, m.file, m.attach, m.warnings], ['office', 1, null, null, 'none', []]);
  assert.equal(m.text, '과제명 시험용 직류 차단기 개발\n\n한국선급 인건비 > > > 끝');
  assert.equal(m.chars, m.text.length);
  assert.equal(m.read, `계획서.hwpx: 구역 1개 전부 · 글자 ${m.chars}자 · 글자만 실음`);
});
await ta('office — 글이 길면 구역을 고르고, officeText 가 잘랐으면(cut) 알린다. 글자가 없으면 던진다', async () => {
  const long = Array.from({ length: 60 }, (_, i) => (i % 10 === 3 ? `[한국선급] 인건비 연구개발비 비목 ${i}` : `배경 설명 ${i} `.repeat(30))).join('\n\n');
  const m = await readDocument({ name: '긴.docx', bytes: new Uint8Array(4) }, {
    engines: fakeEngines({ officeText: async () => ({ kind: 'docx', text: long, parts: 1, cut: true }) }),
    limits: { textChars: 3000, chunkChars: 600 },
  });
  assert.ok(m.chars <= 3000);
  assert.ok(m.text.includes('(… 생략 …)'));
  assert.ok(m.text.includes('[한국선급] 인건비 연구개발비 비목 3'));
  assert.match(m.read, /^긴\.docx: 구역 \d+개 가운데 \d+개 · 글자 [\d,]+자 · 글자만 실음$/);
  assert.deepEqual(m.warnings, ['글자가 150,000자를 넘어 뒤는 읽지 않았습니다']);
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
  assert.deepEqual([m.kind, m.total, m.picked, m.file, m.attach], ['text', 1, null, null, 'none'], '짧은 문단 둘은 한 구역');
  assert.equal(m.text, '변경 메모\n\n한국선급 연구재료비 12,000 → 15,000');
  await assert.rejects(readDocument({ name: '빈.md', bytes: new Uint8Array(0) }, { engines: fakeEngines() }), /빈\.md: 글자가 없습니다/);
});
await ta('yaml·hwp·모르는 것은 엔진을 부르기 전에 던진다 — 바이트가 없어도 던진다', async () => {
  await assert.rejects(readDocument({ name: 'KR_과제.yaml', bytes: new Uint8Array(4) }, { engines: fakeEngines() }), { message: 'YAML 은 재료가 아니라 그대로 넣는 파일입니다' });
  await assert.rejects(readDocument({ name: '계획서.hwp', bytes: new Uint8Array(4) }, { engines: fakeEngines() }), { message: unsupportedDocNote('계획서.hwp') });
  await assert.rejects(readDocument({ name: '옛.doc', bytes: new Uint8Array(4) }, { engines: fakeEngines() }), { message: unsupportedDocNote('옛.doc') });
  await assert.rejects(readDocument({ name: 'a.pdf' }, { engines: fakeEngines() }), { message: 'a.pdf: 파일 바이트가 없습니다' });
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
await ta('maxPages 까지만 — total 은 문서의 쪽 수 그대로. 기본은 400쪽', async () => {
  const fake = fakePdf(500);
  const got = await pdfAllText(new Uint8Array(1), { open: fake.open, maxPages: 3 });
  assert.deepEqual([got.pages.length, got.total], [3, 500]);
  const all = await pdfAllText(new Uint8Array(1), { open: fakePdf(500).open });
  assert.deepEqual([all.pages.length, all.total], [400, 500]);
});
await ta('쪽을 읽다 던지면 그대로 던지되 close 는 부른다', async () => {
  const fake = fakePdf(5, { failAt: 3 });
  await assert.rejects(pdfAllText(new Uint8Array(1), { open: fake.open }), /쪽 3 이 깨짐/);
  assert.equal(fake.log.at(-1), 'close');
});

/* ------------------------------------------------------------ 진짜 엔진 */

console.log('진짜 엔진 — pdf-lib 자르기 · officetext');
/** 쪽마다 너비가 다른 PDF(n쪽 너비 = 100 + n) — 자른 쪽이 어느 쪽인지 너비로 안다. */
async function widthPdf(count) {
  const doc = await PDFDocument.create();
  for (let n = 1; n <= count; n++) doc.addPage([100 + n, 300]);
  return doc.save();
}
const widthsOf = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => Math.round(p.getWidth()));

await ta('defaultEngines().pdfSlice — 3쪽 PDF 에서 [1,3] 을 잘라 2쪽 PDF(다시 load 해 getPageCount 2, 1·3쪽의 너비)', async () => {
  const out = await defaultEngines().pdfSlice(await widthPdf(3), [1, 3]);
  assert.ok(out instanceof Uint8Array);
  assert.equal((await PDFDocument.load(out)).getPageCount(), 2);
  assert.deepEqual(await widthsOf(out), [101, 103]);
});
await ta('pdfSlice — 쪽 번호는 겹침을 빼고 차례로, 없는 쪽은 버리고, 남는 것이 없으면 던진다. PDF 가 아니면 던진다', async () => {
  const src = await widthPdf(4);
  assert.deepEqual(await widthsOf(await defaultEngines().pdfSlice(src, [4, 2, 2, 9, 0])), [102, 104]);
  await assert.rejects(defaultEngines().pdfSlice(src, [7]), /고른 쪽이 없습니다/);
  await assert.rejects(defaultEngines().pdfSlice(new Uint8Array(Buffer.from('PDF 아님')), [1]));
});
await ta('readDocument 끝까지 — 가짜 글자 층 + 진짜 pdf-lib: 붙인 작은 PDF 의 쪽이 고른 쪽과 같다', async () => {
  const bytes = await widthPdf(27);
  const m = await readDocument({ name: '사업계획서.pdf', type: 'application/pdf', bytes }, {
    engines: { pdfText: async () => ({ pages: planPages(), total: 27 }) },
    limits: { pdfPages: 12 },
  });
  assert.equal(m.attach, 'slice');
  assert.deepEqual(await widthsOf(fromUrl(m.file.dataUrl)), m.picked.map((n) => 100 + n));
  assert.ok(m.read.endsWith(`붙임(${Math.max(1, Math.ceil(dataUrlBytes(m.file.dataUrl) / 1024))}KB)`));
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
