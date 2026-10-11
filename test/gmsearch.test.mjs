// 공문 검색(에이전트 갈래)의 순수 로직(src/gmsearch.js): 말 풀이(방향·기간·찾을 말), 기간 셈, 제목 거르기, 읽어 둔 것 맞추기, 저장소 꼴.
// 화면 쪽(갈래 단추·검색 카드·포스트백 차례)은 test/wiring.test.mjs 의 "공문 탭 — 에이전트" 가 본다. 네트워크·DOM 은 없다.
import assert from 'node:assert/strict';

import {
  SEARCH_KEY, AGENT_KIND, DIRS, DEFAULT_DIR, DIR_LABEL, DIR_BOXES, DIR_TITLE, CUSTOM, rangeLabel, parsePeriod, termsOf, parseQuery, periodOf, matchRow, filterRows, sameRead, normalizeSearch,
} from '../src/gmsearch.js';
import { BOX_ORDER, INBOX_ORDER } from '../src/gmlist.js';

const T = '2026-10-12';
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const pick = (p) => (p ? { span: p.span, from: p.from, to: p.to, label: p.label, hit: p.hit } : p);

console.log('방향·함');
t('받은 공문은 결재함 다섯 함, 보낸 공문은 기안함 네 함', () => {
  assert.equal(SEARCH_KEY, 'gongmunSearch');
  assert.equal(AGENT_KIND, 'agent');
  assert.deepEqual(DIRS, ['in', 'out']);
  assert.equal(DEFAULT_DIR, 'in');
  assert.deepEqual(DIR_LABEL, { in: '받은 공문', out: '보낸 공문' });
  assert.deepEqual(DIR_BOXES.in, INBOX_ORDER);
  assert.deepEqual(DIR_BOXES.out, BOX_ORDER);
  assert.match(DIR_TITLE.in, /^결재함\(미결함·진행중·결재 완료함·참조함·결재 반려함\) — 내게 결재·참조로 온 공문$/);
  assert.match(DIR_TITLE.out, /^기안함\(완료함·상신함·반려함·임시보관함\) — 내가 기안한 공문$/);
});

console.log('기간의 말');
t('해·달 — 2025년 9월은 그 달, 2025년은 그 해, 9월은 올해의 그 달, 아직 안 온 12월은 작년의 12월, 13월은 기간이 아니다', () => {
  assert.deepEqual(pick(parsePeriod('2025년 9월 받은 공문', T)), { span: undefined, from: '2025-09-01', to: '2025-09-30', label: '2025년 9월', hit: '2025년 9월' });
  assert.deepEqual(pick(parsePeriod('2025년에 보낸', T)), { span: undefined, from: '2025-01-01', to: '2025-12-31', label: '2025년', hit: '2025년' });
  assert.deepEqual(pick(parsePeriod('9월 출장', T)), { span: undefined, from: '2026-09-01', to: '2026-09-30', label: '9월', hit: '9월' });
  assert.deepEqual(pick(parsePeriod('2월', T)), { span: undefined, from: '2026-02-01', to: '2026-02-28', label: '2월', hit: '2월' });
  assert.deepEqual(pick(parsePeriod('12월 세미나', T)), { span: undefined, from: '2025-12-01', to: '2025-12-31', label: '2025년 12월', hit: '12월' });
  assert.equal(parsePeriod('13월', T), null);
  assert.equal(parsePeriod('출장 공문', T), null);
});
t('올해·작년·재작년·지난달·이번 달 — 해가 바뀌는 1월의 지난달은 작년 12월', () => {
  assert.deepEqual(pick(parsePeriod('올해 구매', T)), { span: 'y0', from: undefined, to: undefined, label: undefined, hit: '올해' });
  assert.equal(parsePeriod('금년', T).span, 'y0');
  assert.deepEqual(pick(parsePeriod('작년 출장', T)), { span: undefined, from: '2025-01-01', to: '2025-12-31', label: '작년(2025년)', hit: '작년' });
  assert.deepEqual(pick(parsePeriod('재작년', T)), { span: undefined, from: '2024-01-01', to: '2024-12-31', label: '재작년(2024년)', hit: '재작년' });
  assert.deepEqual(pick(parsePeriod('지난달 받은', T)), { span: undefined, from: '2026-09-01', to: '2026-09-30', label: '지난달', hit: '지난달' });
  assert.deepEqual(pick(parsePeriod('지난 달', '2026-01-15')), { span: undefined, from: '2025-12-01', to: '2025-12-31', label: '지난달', hit: '지난 달' });
  assert.deepEqual(pick(parsePeriod('이번달', T)), { span: undefined, from: '2026-10-01', to: '2026-10-31', label: '이번 달', hit: '이번달' });
});
t('N개월·N년·최근 — 3개월·1년·2년·최근은 기간 단추(3m·y1·y2)로, 그 밖은 오늘까지의 기간으로', () => {
  assert.deepEqual(pick(parsePeriod('6개월 치', T)), { span: undefined, from: '2026-04-12', to: T, label: '최근 6개월', hit: '6개월' });
  assert.equal(parsePeriod('3개월', T).span, '3m');
  assert.equal(parsePeriod('최근 3개월', T).span, '3m');
  assert.equal(parsePeriod('1년', T).span, 'y1');
  assert.equal(parsePeriod('2년간', T).span, 'y2');
  assert.deepEqual(pick(parsePeriod('5년 동안', T)), { span: undefined, from: '2021-01-01', to: T, label: '2021년부터', hit: '5년 동안' });
  assert.equal(parsePeriod('최근 출장', T).span, '3m');
  assert.equal(parsePeriod('0개월', T), null);
});

console.log('찾을 말');
t('공문·문서·찾아줘 같은 말과 조사는 떼고, 토막 끝의 공문·관련도 뗀다. 한 글자·겹치는 것은 뺀다', () => {
  assert.deepEqual(termsOf('출장 공문 찾아줘'), ['출장']);
  assert.deepEqual(termsOf('구매 품의를 보여줘'), ['구매', '품의']);
  assert.deepEqual(termsOf('출장공문 관련 건'), ['출장']);
  assert.deepEqual(termsOf('세미나는 뭐가 있나'), ['세미나']);
  assert.deepEqual(termsOf('장비가 든 거래명세서 좀'), ['장비', '든', '거래명세서'].filter((w) => w.length >= 2));
  assert.deepEqual(termsOf('PC, 모니터 구매 / 구매 중에'), ['PC', '모니터', '구매']);
  assert.deepEqual(termsOf('회의비 사용'), ['회의비', '사용'], '두 글자 토막의 조사는 떼지 않는다(회의 → 회 를 막는다)');
  assert.deepEqual(termsOf(''), []);
  assert.deepEqual(termsOf('공문 전부'), []);
});

console.log('말 풀이');
t('"지난달 받은 출장 공문" — 받은 공문, 지난달(말로 적은 기간), 출장', () => {
  const q = parseQuery('지난달 받은 출장 공문', { today: T });
  assert.deepEqual(q, { dir: 'in', span: CUSTOM, from: '2026-09-01', to: '2026-09-30', label: '지난달', keyword: '출장', terms: ['출장'], said: { dir: true, period: true } });
});
t('"올해 보낸 구매 품의" — 보낸 공문으로 바뀌고 기간 단추는 올해, 서버에는 가장 긴 말(같으면 앞의 것)', () => {
  const q = parseQuery('올해 보낸 구매 품의', { today: T, dir: 'in', span: '3m' });
  assert.deepEqual([q.dir, q.span, q.from, q.to, q.label, q.keyword, q.terms], ['out', 'y0', '', '', '', '구매', ['구매', '품의']]);
  assert.deepEqual(parseQuery('내가 올린 거래명세서 첨부 건', { today: T }).terms, ['거래명세서', '첨부']);
  assert.equal(parseQuery('내가 올린 거래명세서 첨부 건', { today: T }).keyword, '거래명세서');
  assert.equal(parseQuery('수신 공문 중 세미나', { today: T, dir: 'out' }).dir, 'in');
  assert.equal(parseQuery('2025년 9월 참조', { today: T }).dir, 'in');
  assert.equal(parseQuery('결재 올라온 것', { today: T, dir: 'out' }).dir, 'in');
  assert.equal(parseQuery('결재 문서', { today: T, dir: 'out' }).dir, 'out', '"결재" 만으로는 방향을 바꾸지 않는다');
});
t('말에 없는 것은 고른 것 그대로 — 방향·기간 단추·말로 적은 기간도', () => {
  const q = parseQuery('세미나', { today: T, dir: 'out', span: 'y1' });
  assert.deepEqual([q.dir, q.span, q.keyword, q.said], ['out', 'y1', '세미나', { dir: false, period: false }]);
  const kept = parseQuery('구독', { today: T, span: CUSTOM, from: '2025-09-01', to: '2025-09-30', label: '지난달' });
  assert.deepEqual([kept.span, kept.from, kept.to, kept.label, kept.terms], [CUSTOM, '2025-09-01', '2025-09-30', '지난달', ['구독']]);
  const none = parseQuery('', { today: T });
  assert.deepEqual([none.dir, none.span, none.keyword, none.terms], ['in', '3m', '', []]);
  const only = parseQuery('보낸 공문', { today: T });
  assert.deepEqual([only.dir, only.keyword, only.terms], ['out', '', []]);
});

console.log('읽을 기간·거르기·저장소');
t('기간 단추는 그 첫날부터 오늘까지, 말로 적은 기간은 그 from·to(말이 없으면 날짜 둘), 날짜가 아니면 3개월', () => {
  assert.deepEqual(periodOf({ span: '3m' }, T), { from: '2026-07-12', to: T, label: '최근 3개월' });
  assert.deepEqual(periodOf({ span: 'y0' }, T), { from: '2026-01-01', to: T, label: '올해' });
  assert.deepEqual(periodOf({ span: 'y2' }, T), { from: '2024-01-01', to: T, label: '2024년부터' });
  assert.deepEqual(periodOf({ span: CUSTOM, from: '2025-09-01', to: '2025-09-30', label: '지난달' }, T), { from: '2025-09-01', to: '2025-09-30', label: '지난달' });
  assert.deepEqual(periodOf({ span: CUSTOM, from: '2025-09-01', to: '2025-09-30' }, T).label, '2025-09-01 ~ 2025-09-30');
  assert.deepEqual(periodOf({ span: CUSTOM, from: '어제', to: '' }, T), { from: '2026-07-12', to: T, label: '최근 3개월' });
  assert.deepEqual(periodOf({}, T).label, '최근 3개월');
  assert.deepEqual(['3m', 'y0', 'y1', 'y2'].map((s) => rangeLabel(s, T)), ['최근 3개월', '올해', '2025년부터', '2024년부터']);
});
t('제목에 모든 말이 들어야 한다 — 띄어쓰기·대소문자 무시, 차례는 상관없다, 말이 없으면 다', () => {
  const row = { title: '[SSCB] 수행을 위한 시험 장비 구매 품의' };
  assert.ok(matchRow(row, ['장비', '구매']));
  assert.ok(matchRow(row, ['품의', '구매']), '차례가 달라도 든다');
  assert.ok(matchRow(row, ['sscb', '시험장비']));
  assert.ok(!matchRow(row, ['품의 구매']), '한 말 안의 차례는 그대로');
  assert.ok(!matchRow(row, ['출장']));
  assert.ok(matchRow(row, []));
  assert.ok(matchRow({}, ['']) === true);
  const rows = [row, { title: '대전 출장 품의' }];
  assert.deepEqual(filterRows(rows, []).length, 2);
  assert.deepEqual(filterRows(rows, ['품의']).length, 2);
  assert.deepEqual(filterRows(rows, ['출장']).map((r) => r.title), ['대전 출장 품의']);
  assert.deepEqual(filterRows(null, ['x']), []);
});
t('읽어 둔 것은 방향·기간·서버에 보낸 말이 같아야 지금 것이다', () => {
  const a = { dir: 'in', from: '2026-07-12', to: T, keyword: '출장' };
  assert.ok(sameRead(a, { ...a }));
  assert.ok(!sameRead(a, { ...a, keyword: '' }));
  assert.ok(!sameRead(a, { ...a, dir: 'out' }));
  assert.ok(!sameRead(null, a));
});
t('저장소의 것 — 모르는 것은 버리고, 말로 적은 기간은 날짜 둘이 있어야 남는다', () => {
  assert.deepEqual(normalizeSearch(null), { on: false, dir: 'in', span: '3m', from: '', to: '', label: '', text: '', keyword: '', terms: [], at: 0, read: null, rows: [], notes: [] });
  const s = normalizeSearch({ on: true, dir: 'out', span: CUSTOM, from: '2025-09-01', to: '2025-09-30', label: '지난달', text: '지난달 보낸 출장', keyword: '출장', terms: ['출장', 7], at: 5,
    read: { dir: 'out', from: '2025-09-01', to: '2025-09-30', keyword: '출장' }, rows: [{ id: 'A', title: 'x' }, { title: 'no id' }, null], notes: ['n'], busy: true });
  assert.deepEqual([s.on, s.dir, s.span, s.from, s.to, s.label, s.text, s.keyword, s.terms, s.at, s.notes], [true, 'out', CUSTOM, '2025-09-01', '2025-09-30', '지난달', '지난달 보낸 출장', '출장', ['출장', '7'], 5, ['n']]);
  assert.deepEqual(s.read, { dir: 'out', from: '2025-09-01', to: '2025-09-30', keyword: '출장' });
  assert.deepEqual(s.rows.map((r) => r.id), ['A']);
  assert.ok(!('busy' in s));
  const bad = normalizeSearch({ on: 'yes', dir: 'x', span: CUSTOM, from: '2025-09-01', label: '반쪽', read: 'no' });
  assert.deepEqual([bad.on, bad.dir, bad.span, bad.from, bad.label, bad.read], [false, 'in', '3m', '', '', null]);
  assert.equal(normalizeSearch({ span: 'y9' }).span, '3m');
  assert.equal(normalizeSearch({ span: 'y2' }).span, 'y2');
});

console.log(`\n통과 ${pass}건`);
