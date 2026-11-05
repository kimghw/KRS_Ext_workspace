import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createFlightBox, PREF_KEY, seatLabel } from '../flightbox.js';
import { createKtxBox } from '../ktxbox.js';

const { JSDOM } = createRequire(process.env.JSDOM_BASE || import.meta.url)('jsdom');
const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const rows = [
  { no: 'BX8801', dep: '08:20', arr: '09:20', availability: 'available', seats: 3, price: '52,000원' },
  { no: 'BX8803', dep: '10:20', arr: '11:20', availability: 'soldout', seats: 0, price: '' },
  { no: '<img src=x onerror=alert(1)>', dep: '12:20', arr: '13:20', availability: 'unknown', seats: null, price: '<script>bad()</script>' },
];
const success = () => ({ ok: true, results: [{ airline: 'BX', ok: true, rows, tabId: 22, checkedAt: '2026-11-05T03:15:00Z' }] });

function setup({ result = success(), run, saved = {}, open } = {}) {
  const doc = new JSDOM(html).window.document;
  const store = { ...saved };
  const calls = [];
  const picks = [];
  let date = '2026-11-12';
  let hour = 8;
  const storage = { get: async (key) => ({ [key]: store[key] }), set: async (values) => Object.assign(store, values) };
  const actions = {
    build: (id, value) => { calls.push({ id, ...value }); return { record: { id, ...value } }; },
    run: run || (async () => result),
  };
  const box = createFlightBox({
    doc, storage, actions, when: () => ({ date, hour }), today: () => '2026-11-05',
    open: open || (async (value) => { picks.push(value); return { ok: true }; }),
  });
  const ktx = createKtxBox({ doc, storage });
  return { doc, store, calls, picks, box, ktx, $: (id) => doc.getElementById(id), setDate: (value) => { date = value; }, setHour: (value) => { hour = value; } };
}

test('항공 검색은 공통 날짜·시작 시간과 성인 1명·두 항공사를 flight.search 기록으로 보내고 예약 화면에 같은 조건을 넘긴다', async () => {
  const f = setup({ saved: { [PREF_KEY]: { from: 'GMP', to: 'PUS', airline: 'BX', adults: 2 } } });
  await tick();
  assert.deepEqual([f.$('flightFrom').value, f.$('flightTo').value], ['GMP', 'PUS'], '저장한 공항만 따른다(예전의 항공사·인원은 무시)');
  f.$('flightSwap').click();
  f.$('flightGo').click();
  await tick();
  assert.deepEqual(f.calls, [
    { id: 'flight.search', input: { airline: 'KE', from: 'PUS', to: 'GMP', date: '2026-11-12', hour: 8, adults: 1 }, preset: { today: '2026-11-05' } },
    { id: 'flight.search', input: { airline: 'BX', from: 'PUS', to: 'GMP', date: '2026-11-12', hour: 8, adults: 1 }, preset: { today: '2026-11-05' } },
  ], '인원·항공사 고르기 없이 늘 성인 1명 · 대한항공과 에어부산');
  assert.deepEqual(f.store[PREF_KEY], { from: 'PUS', to: 'GMP' });
  assert.equal(f.$('flightCount').textContent, '3');
  assert.equal(f.$('flightNote').textContent, '1개 항공사 조회 확인 필요 · 좌석과 운임은 예약 페이지에서 최종 확인해 주세요.', '조건을 되풀이하지 않는다');
  assert.match(f.$('flightList').querySelector('[data-airline="BX"] .flight-checked').textContent, /12:15.*확인/);
  const buttons = f.$('flightList').querySelectorAll('.flight-row .flight-open');
  assert.deepEqual([...buttons].map((b) => b.disabled), [false, true, false]);
  assert.match(f.$('flightList').textContent, /예약 가능 · 잔여 3석/);
  assert.match(f.$('flightList').textContent, /좌석 확인 필요/);
  assert.equal(f.$('flightList').querySelector('img, script'), null, '사이트 글은 HTML 로 해석하지 않는다');
  buttons[0].querySelector('span').click();
  await tick();
  assert.deepEqual(f.picks, [{ airline: 'BX', tabId: 22, input: f.calls[1].input, row: rows[0] }]);
  buttons[2].click();
  await tick();
  assert.equal(f.picks[1].row.availability, 'unknown', '확인 못 한 좌석도 공식 페이지에서 확인할 수 있다');
});

test('한 항공사가 실패해도 다른 항공사 결과를 남기고 실패 항공사의 예약 페이지 연결을 제공한다', async () => {
  const f = setup({ result: { ok: true, results: [
    { airline: 'KE', ok: false, rows: [], tabId: 11, error: '접속 확인 필요 <img src=x>' },
    success().results[0],
  ] } });
  f.$('flightGo').click();
  await tick();
  assert.equal(f.$('flightList').querySelectorAll('.flight-provider').length, 2);
  assert.equal(f.$('flightList').querySelectorAll('.flight-row').length, 3);
  const failed = f.$('flightList').querySelector('[data-airline="KE"]');
  assert.match(failed.textContent, /접속 확인 필요/);
  assert.equal(failed.querySelector('img'), null);
  assert.equal(failed.querySelector('button').textContent, '예약 페이지에서 확인');
  assert.equal(failed.querySelector('.flight-schedule').href, 'https://www.koreanair.com/flight-status?isSchedule=T');
  assert.equal(failed.querySelector('.flight-schedule').target, '_blank');
  failed.querySelector('button').click();
  await tick();
  assert.deepEqual(f.picks[0], { airline: 'KE', tabId: 11, input: f.calls[0].input, row: undefined });
});

test('빈 결과·모르는 좌석·매진을 구분하고 시각 없는 조회에 새 시각을 꾸미지 않는다', async () => {
  assert.equal(seatLabel({ availability: 'unknown', seats: 0 }), '좌석 확인 필요');
  assert.equal(seatLabel({ availability: 'soldout' }), '매진');
  assert.equal(seatLabel({ availability: 'available', seats: null }), '예약 가능');
  assert.equal(seatLabel({ availability: 'available', seats: 9, seatsAtLeast: true }), '예약 가능 · 잔여 9석 이상');
  const f = setup({ result: { ok: true, results: [{ airline: 'BX', ok: true, rows: [], checkedAt: 'broken' }] } });
  f.$('flightGo').click();
  await tick();
  assert.match(f.$('flightList').textContent, /조건에 맞는 항공편이 없습니다/);
  assert.equal(f.$('flightList').querySelector('.flight-checked'), null);
  assert.equal(f.$('flightCount').textContent, '');
});

test('운임명·가격·잔여석을 같은 항공편에 표시하고 좌석 수가 없는 운임은 수량을 만들지 않는다', async () => {
  const f = setup({ saved: { [PREF_KEY]: { airline: 'KE', from: 'PUS', to: 'GMP', adults: 1 } }, result: { ok: true, results: [{ airline: 'KE', ok: true, rows: [
    { no: 'KE1802', dep: '08:45', arr: '09:50', availability: 'available', seats: 4, price: '₩ 73,300', fareName: '일반석 특가' },
    { no: 'KE1806', dep: '09:45', arr: '10:50', availability: 'available', seats: null, price: '₩ 117,300', fareName: '일반석 정상' },
    { no: 'KE1808', dep: '12:15', arr: '13:20', availability: 'available', seats: null, price: '₩ 117,300', fareName: '<img src=x onerror=alert(1)>' },
  ] }] } });
  await tick();
  f.$('flightGo').click();
  await tick();
  f.$('flightTabs').querySelector('[data-view="KE"]').click();
  const [special, normal, escaped] = f.$('flightList').querySelectorAll('.flight-row');
  assert.equal(special.querySelector('.flight-time').textContent, '08:45 → 09:50');
  assert.equal(special.querySelector('.flight-number').textContent, 'KE1802 · 일반석 특가 기준');
  assert.equal(special.querySelector('.flight-seat').textContent, '예약 가능 · 잔여 4석');
  assert.equal(special.querySelector('.flight-open b').textContent, '₩ 73,300');
  assert.equal(normal.querySelector('.flight-number').textContent, 'KE1806 · 일반석 정상 기준');
  assert.equal(normal.querySelector('.flight-seat').textContent, '예약 가능');
  assert.equal(normal.querySelector('.flight-open b').textContent, '₩ 117,300');
  assert.equal(escaped.querySelector('img'), null);
  assert.match(escaped.querySelector('.flight-number').textContent, /<img src=x/);
});

test('조건 변경은 이전 결과를 지우며 공유 날짜 화살표와 시작 시간 변경도 반영한다', async () => {
  const f = setup();
  f.$('flightGo').click();
  await tick();
  f.$('flightSwap').click();
  assert.deepEqual([f.$('flightFrom').value, f.$('flightTo').value], ['GMP', 'PUS']);
  assert.equal(f.$('flightList').textContent, '');
  assert.match(f.$('flightNote').textContent, /조건이 바뀌었습니다/);
  f.$('flightGo').click();
  await tick();
  f.setDate('2026-11-13');
  f.$('nextDay').click();
  assert.equal(f.$('flightList').textContent, '');
  f.$('flightGo').click();
  await tick();
  f.setHour(10);
  f.$('hourStart').dispatchEvent(new f.doc.defaultView.Event('change', { bubbles: true }));
  assert.equal(f.$('flightList').textContent, '');
});

test('항공사마다 기록 하나를 나란히 돌리고 먼저 온 쪽부터 그린다', async () => {
  const finish = {};
  const f = setup({ run: (record) => new Promise((resolve) => { finish[record.input.airline] = resolve; }) });
  f.$('flightGo').click();
  await tick();
  assert.deepEqual(f.calls.map((c) => c.input.airline), ['KE', 'BX']);
  assert.deepEqual([...f.$('flightList').querySelectorAll('.flight-provider')].map((p) => p.querySelector('h3').textContent + ':' + p.querySelector('.flight-pending')?.textContent), ['대한항공:조회 중…', '에어부산:조회 중…']);
  assert.equal(f.$('flightList').querySelector('.flight-links'), null, '조회 중에는 열 단추가 없다');
  finish.KE({ ok: true, results: [{ airline: 'KE', ok: true, rows: [rows[0]], tabId: 11, checkedAt: '2026-11-05T03:15:00Z' }] });
  await tick();
  assert.equal(f.$('flightList').querySelectorAll('.flight-row[data-airline="KE"]').length, 1, '대한항공 줄은 에어부산을 기다리지 않는다');
  assert.equal(f.$('flightList').querySelector('[data-airline="BX"] .flight-pending').textContent, '조회 중…');
  assert.equal(f.$('flightGo').disabled, true);
  finish.BX({ ok: false, results: [{ airline: 'BX', ok: false, rows: [], error: '대기열' }] });
  await tick();
  assert.equal(f.$('flightGo').disabled, false);
  assert.match(f.$('flightList').querySelector('[data-airline="BX"] .flight-error').textContent, /대기열/);
  assert.match(f.$('flightNote').textContent, /1개 항공사 조회 확인 필요/);
});

test('조회 중 중복 실행을 막고 공유 날짜가 바뀐 동안 도착한 결과를 폐기한다', async () => {
  const finishers = [];
  const f = setup({ run: () => new Promise((resolve) => { finishers.push(resolve); }) });
  f.$('flightGo').click();
  f.$('flightGo').click();
  assert.equal(f.calls.length, 2, '항공사 둘 — 두 번째 누름은 막힌다');
  assert.equal(f.$('flightGo').disabled, true);
  f.setDate('2026-11-13');
  for (const finish of finishers) finish(success());
  await tick();
  assert.equal(f.$('flightGo').disabled, false);
  assert.equal(f.$('flightList').textContent, '');
  assert.match(f.$('flightNote').textContent, /조회 중 조건이 바뀌었습니다/);
});

test('검색 예외와 예약 화면 열기 실패를 표시하고 다시 시도할 수 있다', async () => {
  const failedSearch = setup({ run: async () => { throw new Error('연결 끊김'); } });
  failedSearch.$('flightGo').click();
  await tick();
  assert.match(failedSearch.$('flightNote').textContent, /연결 끊김/);
  assert.equal(failedSearch.$('flightGo').disabled, false);
  assert.equal(failedSearch.$('flightList').querySelectorAll('.flight-fallback').length, 2, '전체 조회 실패도 두 항공사의 예약 화면은 열 수 있다');
  const failedOpen = setup({ open: async () => { throw new Error('탭 닫힘'); } });
  failedOpen.$('flightGo').click();
  await tick();
  const button = failedOpen.$('flightList').querySelector('.flight-open');
  button.click();
  await tick();
  assert.match(failedOpen.$('flightNote').textContent, /탭 닫힘/);
  assert.equal(button.disabled, false);
});

test('결과 없이 전체 실패한 응답도 선택한 항공사의 예약 페이지로 이어진다', async () => {
  const f = setup({ result: { ok: false, error: '사이트 응답 없음' } });
  f.$('flightGo').click();
  await tick();
  const buttons = f.$('flightList').querySelectorAll('.flight-fallback');
  assert.equal(buttons.length, 2);
  buttons[1].click();
  await tick();
  assert.equal(f.picks[0].airline, 'BX');
  assert.deepEqual(f.picks[0].input, f.calls[1].input, '에어부산 기록(둘째)과 같은 조건');
});

test('시간 옆 고르기(차량·KTX·항공권)는 칸을 서로 숨기며 차량으로 열고(저장한 것 없음) 다른 상위 탭에서는 숨는다', async () => {
  const f = setup({ saved: { ktxView: 'flight' } });
  const choose = (view) => f.$('carViewControl').querySelector(`[data-view="${view}"]`).click();
  f.ktx.toggle(true);
  await tick();
  assert.equal(f.$('flightBox').hidden, true, '예전에 저장된 탭이 있어도 차량으로 연다');
  assert.equal(f.$('carViewControl').querySelector('[aria-pressed="true"]').dataset.view, 'car');
  choose('flight');
  assert.equal(f.$('flightBox').hidden, false);
  assert.equal(f.$('ktxBox').hidden, true);
  assert.equal(f.doc.querySelector('.app').classList.contains('flight-view'), true);
  choose('ktx');
  assert.equal(f.$('flightBox').hidden, true);
  assert.equal(f.$('ktxBox').hidden, false);
  choose('flight');
  assert.equal(f.store.ktxView, 'flight', '고른 것을 저장하지 않는다(예전 값 그대로)');
  f.ktx.toggle(false);
  assert.equal(f.$('flightBox').hidden, true);
  assert.equal(f.$('carViewControl').hidden, true);
  assert.equal(f.doc.querySelector('.app').classList.contains('flight-view'), false);
  f.ktx.toggle(true);
  assert.equal(f.$('flightBox').hidden, false);
  choose('car');
  assert.equal(f.$('flightBox').hidden, true);
  assert.equal(f.doc.querySelector('.app').classList.contains('flight-view'), false);
});

test('결과 위의 탭 셋 — 전체는 두 항공사 줄을 출발 시각 순으로 섞고(항공사 이름을 앞에), 대한항공·에어부산은 그 항공사만, 조회하지 않은 항공사 탭은 잠긴다', async () => {
  const ke = { airline: 'KE', ok: true, tabId: 11, checkedAt: '2026-11-05T03:15:00Z', rows: [
    { no: 'KE1806', dep: '09:45', arr: '10:50', availability: 'available', seats: null, price: '₩ 117,300', fareName: '일반석 정상' },
    { no: 'KE1802', dep: '08:45', arr: '09:50', availability: 'available', seats: 4, price: '₩ 73,300', fareName: '일반석 특가' },
  ] };
  const bx = { airline: 'BX', ok: true, tabId: 22, checkedAt: '2026-11-05T03:16:00Z', rows: [
    { no: 'BX8050', dep: '09:00', arr: '10:05', availability: 'available', seats: null, price: '61,700원', fareName: '실속항공권' },
  ] };
  const f = setup({ result: { ok: true, results: [ke, bx] } });
  assert.equal(f.$('flightTabs').hidden, true, '결과가 없으면 탭도 없다');
  f.$('flightGo').click();
  await tick();
  const tabs = f.$('flightTabs');
  assert.equal(tabs.hidden, false);
  assert.deepEqual([...tabs.querySelectorAll('[data-view]')].map((b) => b.textContent + ':' + b.getAttribute('aria-selected') + ':' + b.disabled), ['전체:true:false', '대한항공:false:false', '에어부산:false:false']);
  const merged = [...f.$('flightList').querySelectorAll('.flight-row')];
  assert.deepEqual(merged.map((li) => li.querySelector('.flight-time').textContent), ['08:45 → 09:50', '09:00 → 10:05', '09:45 → 10:50'], '출발 시각 순');
  assert.deepEqual(merged.map((li) => li.querySelector('.flight-airline').textContent), ['대한항공', '에어부산', '대한항공']);
  assert.equal(merged[1].querySelector('.flight-number').textContent, '에어부산 · BX8050 · 실속항공권 기준');
  assert.deepEqual([...f.$('flightList').querySelectorAll('.flight-provider')].map((p) => p.querySelector('h3').textContent + ' ' + p.querySelector('.flight-checked').textContent + ' ' + p.querySelectorAll('.flight-row').length), ['대한항공 11. 05. 12:15 확인 0', '에어부산 11. 05. 12:16 확인 0'], '전체 아래에는 항공사마다 확인 시각과 열기 단추만');
  assert.equal(f.$('flightCount').textContent, '3');
  merged[1].querySelector('.flight-open span').click();
  await tick();
  assert.deepEqual(f.picks[0], { airline: 'BX', tabId: 22, input: f.calls[1].input, row: bx.rows[0] }, '전체 탭의 줄도 제 항공사 탭을 연다');
  tabs.querySelector('[data-view="KE"]').click();
  assert.equal(tabs.querySelector('[data-view="KE"]').getAttribute('aria-selected'), 'true');
  const keRows = [...f.$('flightList').querySelectorAll('.flight-row')];
  assert.deepEqual(keRows.map((li) => li.querySelector('.flight-number').textContent), ['KE1806 · 일반석 정상 기준', 'KE1802 · 일반석 특가 기준'], '항공사 탭은 그 항공사 줄만, 이름 없이');
  assert.equal(f.$('flightList').querySelectorAll('.flight-provider').length, 1);
  tabs.querySelector('[data-view="BX"]').click();
  assert.deepEqual([...f.$('flightList').querySelectorAll('.flight-row')].map((li) => li.dataset.airline), ['BX']);
  // 조건을 바꾸면 결과와 탭이 함께 사라지고, 다시 조회하면 고른 탭(에어부산)은 그대로다.
  f.$('flightSwap').click();
  assert.equal(tabs.hidden, true);
  f.$('flightGo').click();
  await tick();
  assert.deepEqual([...tabs.querySelectorAll('[data-view]')].map((b) => b.getAttribute('aria-selected')), ['false', 'false', 'true']);
});
