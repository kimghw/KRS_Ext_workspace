// The fixture files contain sanitized real Korean Air DOM captured on
// 2026-11-05. See their comments for the removed content. They are snapshots,
// not evidence that current inventory remains unchanged after capture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { injected } from '../src/flights.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
const INPUT = { airline: 'KE', from: 'PUS', to: 'GMP', date: '2026-11-06', hour: 8, adults: 1 };
const QUERY = readFileSync(new URL('./fixtures/korean-air-query-20261105.html', import.meta.url), 'utf8');
const FLIGHTS = readFileSync(new URL('./fixtures/korean-air-results-20261105.html', import.meta.url), 'utf8');

function read({ adults = 1, mutate = () => {}, query = QUERY } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${query}${FLIGHTS}</body>`, {
    url: 'https://www.koreanair.com/booking/select-flight/departure', runScripts: 'outside-only',
  });
  try {
    if (adults !== 1) dom.window.document.querySelector('kds-passenger_1').setAttribute('has-adult-number', String(adults));
    mutate(dom.window.document);
    return JSON.parse(JSON.stringify(dom.window.eval(`(${injected.pageRead.toString()})(${JSON.stringify({ airline: 'KE', input: { ...INPUT, adults } })})`)));
  } finally { dom.window.close(); }
}

const amount = (row) => Number(row.price.replace(/\D/g, ''));

test('captured Korean Air cards expose times and each lowest available economy fare', () => {
  const result = read();
  assert.equal(result.matched, true);
  assert.deepEqual(result.rows.map(({ no, dep, arr }) => ({ no, dep, arr })), [
    { no: 'KE5136', dep: '07:40', arr: '08:45' },
    { no: 'KE1802', dep: '08:45', arr: '09:50' },
    { no: 'KE1806', dep: '09:45', arr: '10:50' },
  ]);
  assert.deepEqual(result.rows.map(({ availability, seats }) => ({ availability, seats })), [
    { availability: 'available', seats: 7 },
    { availability: 'available', seats: 4 },
    { availability: 'available', seats: null },
  ]);
  assert.deepEqual(result.rows.map(amount), [86300, 73300, 117300]);
});

test('Korean Air fare inventories are not added and an insufficient cheap fare is skipped', () => {
  // Hypothetical passenger count changes exercise the captured fare structure;
  // they do not claim this inventory was queried live for five/eight adults.
  const row = read({ adults: 5 }).rows.find((r) => r.no === 'KE1802');
  assert.equal(row.availability, 'available');
  assert.equal(amount(row), 82300);
  assert.equal(row.seats, null, 'no count is shown for the selected discount fare');
  const insufficient = read({ adults: 8 }).rows.find((r) => r.no === 'KE5136');
  assert.notEqual(insufficient.availability, 'available', '7 and 5 are fare counts, not twelve available seats');
});

test('Korean Air query verification reads selected component state, including the full year', () => {
  const wrongStates = [
    (doc) => doc.querySelector('kds-fromto_1').setAttribute('is-from-code', 'GMP'),
    (doc) => doc.querySelector('kds-fromto_1').setAttribute('is-to-code', 'PUS'),
    (doc) => doc.querySelector('kds-passenger_1').setAttribute('has-adult-number', '2'),
    (doc) => doc.querySelector('td.ui-datepicker__td.-start').id = '20271106',
    (doc) => doc.querySelector('td.ui-datepicker__td.-start').id = '20261107',
    (doc) => doc.querySelector('.ang-flight-widget__aligner').classList.remove('-oneway'),
  ];
  for (const mutate of wrongStates) {
    const result = read({ mutate });
    assert.equal(result.matched, false, mutate.toString());
    assert.deepEqual(result.rows, [], mutate.toString());
  }
});

test('Korean Air selected day and route alone do not establish date year or passenger count', () => {
  const result = read({ mutate: (doc) => {
    doc.querySelector('ke-kds-calendar').remove();
    doc.querySelector('kds-passenger_1').remove();
  } });
  assert.equal(result.matched, false);
  assert.deepEqual(result.rows, []);
});

test('Korean Air disabled sibling radio is respected and prestige stock is not economy stock', () => {
  // Mutate the captured second card: every economy offer is now sold out,
  // while prestige has inventory. These are deliberately synthetic states.
  const result = read({ mutate: (doc) => {
    const card = doc.querySelectorAll('li.flight-n__item')[1];
    for (const label of card.querySelectorAll('label.flight-n__cabin-info.-economy')) {
      doc.getElementById(label.htmlFor).disabled = true;
      label.querySelector('.flight-n__price-num').textContent = '매진';
      label.querySelector('.flight-n__remaining-seat')?.remove();
    }
    const prestige = card.querySelector('label.flight-n__cabin-info.-prestige');
    doc.getElementById(prestige.htmlFor).disabled = false;
    prestige.querySelector('.flight-n__price-num').textContent = '₩ 150,000';
  } });
  const row = result.rows.find((r) => r.no === 'KE1802');
  assert.notEqual(row.availability, 'available');
  assert.equal(row.seats, null);
  assert.equal(row.price, '');
});
