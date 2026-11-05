// The fixture is sanitized real Air Busan DOM captured over CDP on 2026-11-05
// (see its comment). It is a snapshot of that page, not of current inventory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { injected, flightBookingUrl } from '../src/flights.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
const INPUT = { airline: 'BX', from: 'PUS', to: 'GMP', date: '2026-11-12', hour: 0, adults: 1 };
const HTML = readFileSync(new URL('./fixtures/air-busan-results-20261105.html', import.meta.url), 'utf8');

function read({ input = INPUT, mutate = () => {} } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${HTML}</body>`, { url: flightBookingUrl('BX', INPUT), runScripts: 'outside-only' });
  try {
    mutate(dom.window.document);
    return JSON.parse(JSON.stringify(dom.window.eval(`(${injected.pageRead.toString()})(${JSON.stringify({ airline: 'BX', input, submit: true })})`)));
  } finally { dom.window.close(); }
}
const param = (doc, name) => doc.querySelector(`form[name="formSearchParam"] [name="${name}"]`);

test('captured Air Busan rows expose times, the cheapest open fare and its column name', () => {
  const r = read();
  assert.equal(r.matched, true);
  assert.equal(r.empty, false);
  assert.equal(r.submitted, undefined, 'the page searches by itself; nothing is clicked');
  assert.deepEqual(r.rows, [
    { no: 'BX8032', dep: '07:10', arr: '08:15', availability: 'available', seats: null, seatsAtLeast: false, price: '9,900원', fareName: '실속항공권' },
    { no: 'BX8050', dep: '09:00', arr: '10:05', availability: 'available', seats: null, seatsAtLeast: false, price: '42,300원', fareName: '실속항공권' },
    { no: 'BX8052', dep: '10:50', arr: '11:55', availability: 'available', seats: null, seatsAtLeast: false, price: '50,900원', fareName: '실속항공권' },
  ]);
});

test('Air Busan conditions are read from the hidden search form and the result header', () => {
  for (const mutate of [
    (doc) => { param(doc, 'depCity1').value = 'GMP'; },
    (doc) => { param(doc, 'arrCity1').value = 'PUS'; },
    (doc) => { param(doc, 'depDate1').value = '2026-11-13'; },
    (doc) => { param(doc, 'paxCountAd').value = '2'; },
    (doc) => { param(doc, 'paxCountCh').value = '1'; },
    (doc) => { param(doc, 'tripType').value = 'RT'; },
    (doc) => doc.querySelector('.nativeAvail').setAttribute('data-depdate', '2026-11-13'),
    (doc) => { for (const el of doc.querySelectorAll('form[name="formSearchParam"] input')) el.value = ''; },
  ]) {
    const r = read({ mutate });
    assert.equal(r.matched, false, mutate.toString());
    assert.deepEqual(r.rows, []);
  }
  assert.equal(read({ input: { ...INPUT, adults: 2 } }).matched, false);
});

test('closed and disabled Air Busan fares are sold out, a single open fare is enough, and the empty row is empty', () => {
  const soldout = read({ mutate: (doc) => {
    const [first, second] = doc.querySelectorAll('.nativeListFlight tr');
    for (const cell of first.querySelectorAll('td.nativeFlightCls')) cell.innerHTML = '<div class="notAvailable">마감</div>';
    for (const label of second.querySelectorAll('label.nativeClsLabel')) { label.classList.add('disable'); label.querySelector('input').disabled = true; }
  } });
  assert.equal(soldout.rows[0].availability, 'soldout');
  assert.equal(soldout.rows[0].price, '');
  assert.equal(soldout.rows[1].availability, 'soldout');
  assert.equal(soldout.rows[2].availability, 'available');
  const expensive = read({ mutate: (doc) => {
    const label = doc.querySelector('.nativeListFlight tr label.nativeClsLabel');
    label.classList.add('disable');
  } });
  assert.deepEqual([expensive.rows[0].price, expensive.rows[0].fareName], ['66,000원', '일반항공권']);
  const empty = read({ mutate: (doc) => { doc.querySelector('.nativeListFlight').innerHTML = '<tr class="nativeRowFlightEmpty"><td colspan="5">예약 가능한 좌석이 없습니다. 예약/스케줄 - 스케줄 조회에서 운항일자를 확인하시기 바랍니다.</td></tr>'; } });
  assert.equal(empty.matched, true);
  assert.equal(empty.empty, true);
  assert.deepEqual(empty.rows, []);
});

test('Air Busan alert layer is the reason, and progress or NetFunnel waiting-room popups are loading', () => {
  // $.bxAlert 가 그리는 층(2026-11-05 실측): .lyPop.typeS > .lyPophead h4 "AIR BUSAN" + .lyPopcont strong.point00 문구<br>에러코드 : <span.errorCode>
  const alerted = read({ mutate: (doc) => {
    doc.querySelector('.nativeListFlight').innerHTML = '';
    doc.body.insertAdjacentHTML('beforeend', '<div class="lyPop typeS" style="display: block;"><div class="lyPophead"><h4>AIR BUSAN</h4><a href="#none">닫기</a></div>'
      + '<div class="lyPopcont"><div class="tc"><strong class="point00">조회 중 오류가 발생했습니다.<br><br>에러코드 : <span class="errorCode">RS500</span></strong></div>'
      + '<div class="tc mgt20"><span class="btn mBtn01"><a href="#none">확인</a></span></div></div></div>');
  } });
  assert.equal(alerted.error, '에어부산 안내: 조회 중 오류가 발생했습니다. 에러코드 : RS500');
  assert.equal(alerted.rows, undefined);
  const progress = read({ mutate: (doc) => {
    doc.querySelector('.nativeListFlight').innerHTML = '';
    doc.body.insertAdjacentHTML('beforeend', '<div class="progressPopup" style="position: fixed; inset: 0px; opacity: 0.3;"></div>');
  } });
  assert.deepEqual([progress.matched, progress.loading, progress.queued, progress.rows], [true, true, false, []]);
  const queued = read({ mutate: (doc) => {
    doc.querySelector('.nativeListFlight').innerHTML = '';
    doc.body.insertAdjacentHTML('beforeend', '<div class="nf-vwr-popup"><div class="nf-vwr-metrics-ahead-count-value">120</div></div>');
  } });
  assert.deepEqual([queued.matched, queued.loading, queued.queued, queued.rows], [true, true, true, []]);
  // 닫힌(display:none) 층은 아무것도 아니다 — 줄을 그대로 읽는다.
  const closed = read({ mutate: (doc) => {
    doc.body.insertAdjacentHTML('beforeend', '<div class="lyPop typeS" style="display: none;"><div class="lyPopcont"><strong class="point00">지난 안내</strong></div></div><div class="progressPopup" style="display: none;"></div>');
  } });
  assert.deepEqual([closed.error, closed.loading, closed.rows.length], [undefined, undefined, 3]);
});
