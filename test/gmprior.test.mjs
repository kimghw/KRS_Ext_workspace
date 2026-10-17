// 선행 품의 읽기(src/gmprior.js)의 순수 로직 — 본문 줄 읽기(세 틀: 이 확장의 구매 틀·원본 구매 틀·원본 구독 틀), 금액·수량 글, 본문 틀 HTML, 첨부 목록, 구매 초안 꼴로 바꾸기,
// 과제 고르기, readPrior(가짜 fetch — 본문·첨부 목록·내려받기, 로그인 화면, 첨부 실패). 네트워크는 없다. 패널 쪽(공문 이력 카드의 구매의뢰 → 행위 gongmun.prior)은 test/wiring.test.mjs 가 본다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { researchPage, attachPage, PURCHASE_LINES, ORIGIN_PURCHASE_LINES, SUBSCRIPTION_LINES, LOGIN_PAGE } from './fixtures/gmprior-fixture.mjs';
import {
  bodyLines, moneyText, qtyText, parseBody, parseResearchDoc, attachListUrl, parseAttachList, readPrior, titleGist, priorToPurchase, priorProject,
} from '../src/gmprior.js';
import { AuthError } from '../src/net.js';
import { blankDraft, orderFromPurchase } from '../src/gongmun.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
globalThis.DOMParser = new JSDOM('').window.DOMParser;

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

console.log('금액·수량 글');
t('금액 — 원화·통화 표시·"=" 뒤의 값·표시 없는 수', () => {
  assert.deepEqual(moneyText('1,239,000원'), { amount: 1239000, currency: 'KRW' });
  assert.deepEqual(moneyText('489,000원 (VAT 포함)'), { amount: 489000, currency: 'KRW' });
  assert.deepEqual(moneyText('USD 1,320'), { amount: 1320, currency: 'USD' });
  assert.deepEqual(moneyText('월 USD 220 (VAT 포함) × 6개월 = USD 1,320 (일시 결제)'), { amount: 1320, currency: 'USD' }, '= 뒤의 값');
  assert.deepEqual(moneyText('$ 99.5'), { amount: 99.5, currency: 'USD' });
  assert.deepEqual(moneyText('1200000'), { amount: 1200000, currency: 'KRW' }, '표시가 없으면 원');
  assert.deepEqual(moneyText('미정'), { amount: null, currency: '' });
});
t('수량 — "2대" 는 2·대, "1" 은 1, 못 읽으면 글만', () => {
  assert.deepEqual(qtyText('2대'), { qty: 2, unit: '대' });
  assert.deepEqual(qtyText('1,000 EA'), { qty: 1000, unit: 'EA' });
  assert.deepEqual(qtyText('1'), { qty: 1, unit: '' });
  assert.deepEqual(qtyText('일식'), { qty: null, unit: '일식' });
});

console.log('본문 읽기');
t('이 확장의 구매 틀 — 과제 개요는 건너뛰고 품목 둘(사양·수량·금액), 구매금액·구매처·구매계정·용도·구매사유·첨부', () => {
  const b = parseBody(PURCHASE_LINES);
  assert.equal(b.items.length, 2);
  assert.deepEqual([b.items[0].name, b.items[0].spec, b.items[0].qty, b.items[0].unit, b.items[0].amount], ['LG 34WR50QK 34인치 모니터', '34인치 WQHD · 커브드', 1, '대', 489000]);
  assert.deepEqual([b.items[1].name, b.items[1].qty, b.items[1].unit, b.items[1].amount], ['모니터암', 1, '개', 99000]);
  assert.equal(b.total, 588000, '항목 줄의 구매금액이 합계');
  assert.equal(b.currency, 'KRW');
  assert.deepEqual([b.vendor, b.account, b.use], ['쿠팡', '연구활동비(연구실운용비)', '연구 자료 검토용']);
  assert.equal(b.reason, '과제 회의에서 회로도·시험 데이터를 함께 검토할 대화면이 필요함');
  assert.deepEqual(b.attach, ['견적서']);
  assert.match(b.overview, /^연구본부 수소전기추진연구팀은/);
  assert.equal(b.summary, '34인치 모니터 외 1건을 구매하고자');
});
t('원본 구매 틀 — 품목 안의 용도·구매금액·구매계정·구매사유가 문서의 값이 되고 합계는 품목 금액', () => {
  const b = parseBody(ORIGIN_PURCHASE_LINES);
  assert.equal(b.items.length, 1);
  assert.deepEqual([b.items[0].name, b.items[0].spec, b.items[0].amount, b.items[0].use], ['전류 프로브 CP-30 (Tektronix)', '30A · 100MHz · BNC', 1870000, 'MVDC 차단기 단락 시험 전류 계측']);
  assert.equal(b.total, 1870000);
  assert.deepEqual([b.vendor, b.account, b.use], ['', '연구재료비', 'MVDC 차단기 단락 시험 전류 계측']);
  assert.match(b.reason, /프로브가 필요함$/);
});
t('원본 구독 틀(2026-10-17 실측 HER-2026-000097) — 번호 줄이 칸이다: 구독서비스 하나, 구독사유·구독기간(사양 자리)·구독금액(USD)·구매계정, 비고는 품목 밖', () => {
  const b = parseBody(SUBSCRIPTION_LINES);
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].name, 'Claude 맥스 플랜 (Anthropic Claude Max, Pro 대비 20배 사용량)');
  assert.equal(b.items[0].spec, '2026.07 ~ 2026.12 (6개월)', '구독기간이 사양 자리에');
  assert.deepEqual([b.items[0].amount, b.items[0].currency], [1320, 'USD']);
  assert.deepEqual([b.total, b.currency], [1320, 'USD']);
  assert.equal(b.account, '연구활동비(소프트웨어 활용비)');
  assert.match(b.reason, /^LLM기반 평가지원 도구 개발/);
  assert.equal(b.items[0].note, 'API 이용시 하루 USD200 이상 비용 사용이 예상됨');
  assert.deepEqual(b.attach, ['claude_견적서']);
  assert.equal(b.vendor, '');
});
t('빈 본문·모르는 줄 — 품목 없음, 합계 null, 나머지 빈 글', () => {
  const b = parseBody(['안녕하세요', '그냥 글']);
  assert.deepEqual([b.items, b.total, b.currency, b.vendor, b.reason], [[], null, '', '', '']);
  assert.deepEqual(parseBody([]).items, []);
});

console.log('본문 틀 HTML');
t('bodyLines — td#…tdEditorControl 의 <p> 마다 한 줄, 들여쓰기(&nbsp;)와 스크립트는 글에 들지 않는다', () => {
  const lines = bodyLines(researchPage({ title: 't', lines: PURCHASE_LINES }));
  assert.equal(lines.length, PURCHASE_LINES.length);
  assert.equal(lines[0].trim(), PURCHASE_LINES[0]);
  assert.ok(!lines.join('\n').includes('theForm'));
});
t('parseResearchDoc — 제목·Job Id·차수·수신·참조와 본문', () => {
  const d = parseResearchDoc(researchPage({ title: '차단기 과제 수행을 위한 시험 장비 구매 품의', job: 'RND00202026', degree: '1', reference: '조주희 [연구지원팀]', lines: PURCHASE_LINES }));
  assert.deepEqual([d.title, d.job, d.degree, d.reference], ['차단기 과제 수행을 위한 시험 장비 구매 품의', 'RND00202026', '1', '조주희 [연구지원팀]']);
  assert.equal(d.items.length, 2);
  assert.equal(d.total, 588000);
  assert.ok(d.text.includes('라. 구매처 : 쿠팡'));
});

console.log('첨부 목록');
t('주소 — 문서 보기 창의 의견·첨부 틀(CommentAttachmentInfo.aspx)', () => {
  assert.equal(attachListUrl({ id: 'HER-2026-000097', form: 'KR_EA_Research_Task' }), 'https://eclass.krs.co.kr/RealEANET/Main/CommentAttachmentInfo.aspx?FORMID=KR_EA_Research_Task&DOCID=HER-2026-000097&GROUPID=0&MDTID=0&DID=0&ISMODIFY=0&OLDDOC=&ATTYN=0&ACTYPE=-1&VIEWMODE=2&FLOWST=7&DOCTYPE=1&BOXTYPE=-1');
  assert.match(attachListUrl({ id: 'X' }), /FORMID=KR_EA_Research_Task&DOCID=X&/, '양식이 없으면 연구업무추진품의');
});
t('parseAttachList — AttID 마다 하나(이름은 FileName, 내려받기는 View=0, 크기 글)', () => {
  const list = parseAttachList(attachPage([{ id: '574551', name: '견적서_2.pdf', size: '60.68 KB' }, { id: '574552', name: '사양서.pdf', size: '1.2 MB' }]));
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { id: '574551', name: '견적서_2.pdf', url: 'https://eclass.krs.co.kr/RealEANET/Manager/AttachFileDown.aspx?AttID=574551&FileName=%EA%B2%AC%EC%A0%81%EC%84%9C_2.pdf&View=0', size: '60.68 KB' });
  assert.equal(list[1].name, '사양서.pdf');
  assert.deepEqual(parseAttachList(attachPage([])), []);
  assert.deepEqual(parseAttachList('<html><body>없음</body></html>'), []);
});

console.log('구매 초안 꼴·과제');
t('titleGist — 별명 머리와 "… 품의" 꼬리를 뗀다', () => {
  assert.equal(titleGist('[SSCB] 수행을 위한 34인치 모니터 구매 품의'), '34인치 모니터');
  assert.equal(titleGist('SSCB 연구과제 Claude 맥스 플랜 구독 품의'), 'SSCB 연구과제 Claude 맥스 플랜 구독');
  assert.equal(titleGist('시험 장비 구입 품의'), '시험 장비');
  assert.equal(titleGist(''), '');
});
t('priorToPurchase — 품목이 있으면 품목 요지는 첫 품목 외 N건, 없으면 제목에서; 합계·구매처·용도·사유·계정·통화', () => {
  const p = priorToPurchase(parseResearchDoc(researchPage({ lines: PURCHASE_LINES })), { title: '차단기 과제 수행을 위한 시험 장비 구매 품의' });
  assert.equal(p.gist, 'LG 34WR50QK 34인치 모니터 외 1건');
  assert.deepEqual([p.vendor, p.total, p.use, p.account, p.currency], ['쿠팡', 588000, '연구 자료 검토용', '연구활동비(연구실운용비)', 'KRW']);
  assert.equal(p.summary, 'LG 34WR50QK 34인치 모니터 외 1건을 구매하고자');
  assert.deepEqual(Object.keys(p.items[0]), ['name', 'spec', 'qty', 'unit', 'unitPrice', 'amount']);
  const q = priorToPurchase(parseResearchDoc(researchPage({ lines: ['그냥 글'] })), { title: 'SSCB 연구과제 Claude 맥스 플랜 구독 품의' });
  assert.equal(q.gist, 'SSCB 연구과제 Claude 맥스 플랜 구독');
  assert.deepEqual([q.items, q.total, q.currency], [[], null, 'KRW']);
  // 구매의뢰 초안으로 옮겨도 초안 키가 실행 모드 관문의 밖으로 나가지 않는다(orderFromPurchase 가 거른다).
  const o = orderFromPurchase(p, { me: '김거화', doc: { id: 'HER-2026-000128', title: 'x' } });
  assert.deepEqual(new Set(Object.keys(o)), new Set(Object.keys(blankDraft('order', { me: '김거화' }))));
  assert.equal(o.business, '과제 회의에서 회로도·시험 데이터를 함께 검토할 대화면이 필요함 (용도: 연구 자료 검토용)');
});
t('priorProject — Job Id 가 같은 과제, 없으면 과제 개요의 과제명, 없으면 제목의 별명, 그것도 없으면 빈 글', () => {
  const projects = [{ name: 'MW급 10kV 반도체 차단기 개발', job: 'RND00202026', alias: 'SSCB', code: 'RND-20-2026' }, { name: '다른 과제', job: '', alias: '다른', code: '' }];
  assert.equal(priorProject({ job: 'RND00202026', lines: [], title: '' }, projects), 'MW급 10kV 반도체 차단기 개발');
  assert.equal(priorProject({ job: '', lines: ['    (1) 과 제 명 : MW급 10kV 반도체 차단기 개발'], title: '' }, projects), 'MW급 10kV 반도체 차단기 개발');
  assert.equal(priorProject({ job: '', lines: [], title: '다른 과제 수행을 위한 구매 품의' }, projects), '다른 과제');
  assert.equal(priorProject({ job: 'RND00999999', lines: [], title: '무관' }, projects), '');
  assert.equal(priorProject(null, []), '');
});

console.log('readPrior — 가짜 fetch');
const ROW = { id: 'HER-2026-000128', form: 'KR_EA_Research_Task', title: '차단기 과제 수행을 위한 시험 장비 구매 품의' };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const pages = ({ body = researchPage({ title: ROW.title, job: 'RND00202026', lines: PURCHASE_LINES }), attach = attachPage([{ id: '574551', name: '견적서_2.pdf' }]) } = {}) => async (url) => {
  const u = String(url);
  if (/Forms\/Drafts\/KR_EA_Research_Task\.aspx/.test(u)) return { html: body, via: 'direct' };
  if (/CommentAttachmentInfo\.aspx/.test(u)) return { html: attach, via: 'direct' };
  throw new Error(`모르는 주소 ${u}`);
};
await ta('본문·첨부 목록을 읽고 파일을 내려받는다 — 이름은 목록의 것, 형식은 확장자로', async () => {
  const urls = [];
  const got = await readPrior(ROW, { fetch: pages(), fetchBytes: async (u) => { urls.push(u); return { bytes: PDF, type: 'application/pdf', name: '견적서_2.pdf' }; } });
  assert.equal(got.doc.title, ROW.title);
  assert.equal(got.doc.items.length, 2);
  assert.deepEqual(got.files.map((f) => [f.name, f.type, f.size]), [['견적서_2.pdf', 'application/pdf', 8]]);
  assert.equal(got.files[0].bytes, PDF);
  assert.deepEqual(urls, ['https://eclass.krs.co.kr/RealEANET/Manager/AttachFileDown.aspx?AttID=574551&FileName=%EA%B2%AC%EC%A0%81%EC%84%9C_2.pdf&View=0']);
  assert.deepEqual(got.notes, []);
});
await ta('첨부가 없으면 파일 없이, 내려받기가 실패하면 알림에 적고 나머지는 간다, 너무 크면 넣지 않는다', async () => {
  const none = await readPrior(ROW, { fetch: pages({ attach: attachPage([]) }), fetchBytes: async () => { throw new Error('안 부른다'); } });
  assert.deepEqual([none.files, none.notes], [[], []]);
  const two = attachPage([{ id: '1', name: 'a.pdf' }, { id: '2', name: 'b.pdf' }]);
  const got = await readPrior(ROW, { fetch: pages({ attach: two }), fetchBytes: async (u) => { if (/AttID=1&/.test(u)) throw new Error('HTTP 500'); return { bytes: PDF, type: 'application/pdf', name: 'b.pdf' }; } });
  assert.deepEqual(got.files.map((f) => f.name), ['b.pdf']);
  assert.deepEqual(got.notes, ['a.pdf 을(를) 내려받지 못했습니다 — HTTP 500']);
  const big = await readPrior(ROW, { fetch: pages(), fetchBytes: async () => ({ bytes: new Uint8Array(10), type: 'application/pdf', name: '' }), maxBytes: 5 });
  assert.deepEqual([big.files, big.notes], [[], ['견적서_2.pdf 은(는) 너무 커서(0MB) 넣지 않았습니다']]);
});
await ta('첨부 목록 화면을 못 읽으면 본문만 돌려주고 알림에 적는다 — 첨부가 여섯이면 다섯만', async () => {
  const got = await readPrior(ROW, { fetch: async (u) => { if (/CommentAttachmentInfo/.test(u)) throw new Error('HTTP 404'); return pages()(u); }, fetchBytes: async () => ({ bytes: PDF, type: 'application/pdf', name: '' }) });
  assert.deepEqual([got.files, got.notes], [[], ['첨부 목록을 읽지 못했습니다 — HTTP 404']]);
  const six = attachPage([1, 2, 3, 4, 5, 6].map((n) => ({ id: String(n), name: `f${n}.pdf` })));
  const many = await readPrior(ROW, { fetch: pages({ attach: six }), fetchBytes: async () => ({ bytes: PDF, type: 'application/pdf', name: '' }) });
  assert.equal(many.files.length, 5);
  assert.deepEqual(many.notes, ['첨부가 6개라 앞의 5개만 가져왔습니다']);
});
await ta('로그인 화면이면 AuthError(본문이든 첨부 목록이든), 모양이 다르면 오류', async () => {
  await assert.rejects(readPrior(ROW, { fetch: async () => ({ html: LOGIN_PAGE }), fetchBytes: async () => ({}) }), AuthError);
  await assert.rejects(readPrior(ROW, { fetch: async (u) => (/CommentAttachmentInfo/.test(u) ? { html: LOGIN_PAGE } : pages()(u)), fetchBytes: async () => ({}) }), AuthError);
  await assert.rejects(readPrior(ROW, { fetch: async () => ({ html: '<html><body></body></html>' }), fetchBytes: async () => ({}) }), /모양이 다릅니다/);
});

console.log(`\n통과 ${pass}건`);
