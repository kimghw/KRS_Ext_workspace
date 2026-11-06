// KTX 말로 찾기의 규칙 해석(src/ktxnlq.js) — Claude 가 없을 때 역·날짜·시·인원을 읽는다(2026-11-06 "차량 ktx 부분에도 채팅으로 조회 하는거 기능 차량이랑 동일하게 넣어줘").
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKtxLocal, parseRoute, parseKtxDate, parseKtxHour, parseKtxAdults, STATION_ALIAS } from '../src/ktxnlq.js';
import { KTX_STATIONS } from '../src/ktx.js';

const TODAY = '2026-11-06';   // 금요일

test('역 — 토씨로 출발·도착을 가르고, 토씨 없는 역은 둘이면 차례대로, 하나면 도착', () => {
  assert.deepEqual(parseRoute('부산에서 서울 가는'), { from: '부산', to: '서울' });
  assert.deepEqual(parseRoute('서울발 부산행'), { from: '서울', to: '부산' });
  assert.deepEqual(parseRoute('부산 출발 대전 도착'), { from: '부산', to: '대전' });
  assert.deepEqual(parseRoute('서울역에서 부산역까지'), { from: '서울', to: '부산' });
  assert.deepEqual(parseRoute('부산부터 광명으로'), { from: '부산', to: '광명' });
  assert.deepEqual(parseRoute('부산→서울'), { from: '부산', to: '서울' });
  assert.deepEqual(parseRoute('부산 서울'), { from: '부산', to: '서울' });
  assert.deepEqual(parseRoute('서울행 KTX 부산'), { from: '부산', to: '서울' });
  assert.deepEqual(parseRoute('서울'), { from: null, to: '서울' });
  assert.deepEqual(parseRoute('부산에서'), { from: '부산', to: null });
  assert.deepEqual(parseRoute('내일 아침'), { from: null, to: null });
});

test('역 — 줄인 이름은 목록의 역으로, 긴 이름이 짧은 이름을 가린다(서대전·동대구·천안아산)', () => {
  for (const [alias, name] of Object.entries(STATION_ALIAS)) assert.ok(KTX_STATIONS.some(([n]) => n === name), `${alias} → ${name}`);
  assert.deepEqual(parseRoute('울산 가는'), { from: null, to: '울산(통도사)' });
  assert.deepEqual(parseRoute('여수까지'), { from: null, to: '여수EXPO' });
  assert.deepEqual(parseRoute('광주로'), { from: null, to: '광주송정' });
  assert.deepEqual(parseRoute('서울에서 대구'), { from: '서울', to: '동대구' });
  assert.deepEqual(parseRoute('서대전에서 천안아산'), { from: '서대전', to: '천안아산' });
  assert.deepEqual(parseRoute('동대구에서 서대구'), { from: '동대구', to: '서대구' });
  assert.deepEqual(parseRoute('인천에서 제주'), { from: null, to: null });
});

test('날짜 — 오늘·내일·모레·글피·N일 뒤·요일(이번 주·다음 주·다다음 주·맨 요일은 오늘 뒤의 첫 그 요일)·M월 D일·M/D·YYYY-MM-DD', () => {
  const d = (s) => parseKtxDate(s, TODAY);
  assert.deepEqual(d('오늘 서울'), { date: '2026-11-06', how: '오늘', relative: true });
  assert.deepEqual(d('내일'), { date: '2026-11-07', how: '내일', relative: true });
  assert.deepEqual(d('내일모레'), { date: '2026-11-08', how: '모레', relative: true });
  assert.deepEqual(d('글피'), { date: '2026-11-09', how: '글피', relative: true });
  assert.equal(d('3일 뒤').date, '2026-11-09');
  assert.equal(d('이번 주 금요일').date, '2026-11-06');
  assert.equal(d('이번주 일요일').date, '2026-11-08');
  assert.equal(d('다음 주 월요일').date, '2026-11-09');
  assert.equal(d('담주 수요일').date, '2026-11-11');
  assert.equal(d('다다음 주 월요일').date, '2026-11-16');
  assert.equal(d('금요일').date, '2026-11-13', '오늘이 금요일이면 다음 금요일');
  assert.equal(d('토요일').date, '2026-11-07');
  assert.deepEqual(d('11월 12일 9시'), { date: '2026-11-12', how: '11/12', relative: false });
  assert.equal(d('11/12').date, '2026-11-12');
  assert.equal(d('1월 5일').date, '2027-01-05', '지난 날은 다음 해');
  assert.deepEqual(d('2026-12-01 서울'), { date: '2026-12-01', how: '2026-12-01', relative: false });
  assert.equal(d('2/30'), null, '달력에 없는 날');
  assert.equal(d('아무 때나'), null);
  assert.equal(d('09:30 출발'), null, '시각은 날짜가 아니다');
});

test('시 — 오전·오후·아침·저녁·밤·새벽, 수 없이 때만 말해도, "2시간" 은 시각이 아니고 1~5시는 오후', () => {
  const h = (s) => parseKtxHour(s)?.hour ?? null;
  assert.equal(h('오후 2시'), 14);
  assert.equal(h('14시'), 14);
  assert.equal(h('2시'), 14);
  assert.equal(h('7시'), 7);
  assert.equal(h('오전 12시'), 0);
  assert.equal(h('12시'), 12);
  assert.equal(h('밤 11시'), 23);
  assert.equal(h('새벽 5시'), 5);
  assert.equal(h('저녁 7시'), 19);
  assert.equal(h('9시 반'), 9);
  assert.equal(h('09:30'), 9);
  assert.equal(h('2시간 걸리는'), null);
  assert.equal(h('아침'), 7);
  assert.equal(h('오전'), 9);
  assert.equal(h('오후'), 12);
  assert.equal(h('저녁'), 18);
  assert.equal(h('밤'), 20);
  assert.equal(h('25시'), null);
  assert.equal(h('부산'), null);
});

test('인원 — N명·N인·N사람·우리말 수·둘이·혼자, 0과 10명 넘는 수는 읽지 않는다', () => {
  assert.equal(parseKtxAdults('2명'), 2);
  assert.equal(parseKtxAdults('3인'), 3);
  assert.equal(parseKtxAdults('두 명'), 2);
  assert.equal(parseKtxAdults('세 사람'), 3);
  assert.equal(parseKtxAdults('둘이서'), 2);
  assert.equal(parseKtxAdults('혼자'), 1);
  assert.equal(parseKtxAdults('10명'), null);
  assert.equal(parseKtxAdults('0명'), null);
  assert.equal(parseKtxAdults('서울'), null);
});

test('parseKtxLocal — 읽은 칸만 든 조각과 확인용 한 줄, 상대 날짜 표시', () => {
  assert.deepEqual(parseKtxLocal('내일 아침 9시 부산에서 서울 가는 KTX 2명', TODAY),
    { patch: { from: '부산', to: '서울', date: '2026-11-07', hour: 9, adults: 2 }, summary: '부산→서울 · 내일 · 9시~ · 2명', relative: true });
  assert.deepEqual(parseKtxLocal('울산 가는 기차 둘이', TODAY), { patch: { to: '울산(통도사)', adults: 2 }, summary: '…→울산(통도사) · 2명', relative: false });
  assert.deepEqual(parseKtxLocal('11/12 저녁 7시', TODAY), { patch: { date: '2026-11-12', hour: 19 }, summary: '11/12 · 19시~', relative: false });
  assert.deepEqual(parseKtxLocal('아무거나', TODAY), { patch: {}, summary: '', relative: false });
  assert.deepEqual(parseKtxLocal('', TODAY), { patch: {}, summary: '', relative: false });
});
