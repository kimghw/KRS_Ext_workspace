// The fixture files contain sanitized real Korean Air DOM captured on
// 2026-11-05. See their comments for the removed content. They are snapshots,
// not evidence that current inventory remains unchanged after capture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { injected } from '../src/flights.js';
import { repairFlightRead } from '../src/flightrepair.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
const INPUT = { airline: 'KE', from: 'PUS', to: 'GMP', date: '2026-11-06', hour: 8, adults: 1 };
const QUERY = readFileSync(new URL('./fixtures/korean-air-query-20261105.html', import.meta.url), 'utf8');
const FLIGHTS = readFileSync(new URL('./fixtures/korean-air-results-20261105.html', import.meta.url), 'utf8');

function read({ adults = 1, mutate = () => {}, query = QUERY, exercise } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${query}${FLIGHTS}</body>`, {
    url: 'https://www.koreanair.com/booking/select-flight/departure', runScripts: 'outside-only',
  });
  try {
    if (adults !== 1) dom.window.document.querySelector('kds-passenger_1').setAttribute('has-adult-number', String(adults));
    mutate(dom.window.document);
    const run = (options = {}) => JSON.parse(JSON.stringify(dom.window.eval(`(${injected.pageRead.toString()})(${JSON.stringify({ airline: 'KE', input: { ...INPUT, adults }, ...options })})`)));
    if (exercise) return exercise({ doc: dom.window.document, run, dom });
    return run();
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

test('Korean Air results accept the observed 32-hex selected-date prefix without losing fares', () => {
  const expected = read().rows;
  for (const prefix of ['ecb2b60a8b40da34a52a317c197bf60d', 'ECB2B60A8B40DA34A52A317C197BF60D']) {
    const result = read({ mutate: (doc) => { doc.querySelector('td.ui-datepicker__td.-start').id = `${prefix}20261106`; } });
    assert.equal(result.matched, true, prefix);
    assert.deepEqual(result.rows, expected);
  }
});

test('Korean Air results reject prefixed wrong years or days and malformed prefixes', () => {
  const prefix = 'ecb2b60a8b40da34a52a317c197bf60d';
  const ids = [`${prefix}20271106`, `${prefix}20261107`, `${prefix.slice(1)}20261106`, `${prefix}a20261106`,
    `${'z'.repeat(32)}20261106`, 'calendar-20261106', `${prefix}20261106-extra`, `${prefix}2026-11-06`];
  for (const id of ids) {
    const result = read({ mutate: (doc) => { doc.querySelector('td.ui-datepicker__td.-start').id = id; } });
    assert.equal(result.matched, false, id);
    assert.deepEqual(result.rows, [], id);
  }
});

test('Korean Air results do not accept unselected or multiple selected prefixed calendar dates', () => {
  for (const multiple of [false, true]) {
    const result = read({ mutate: (doc) => {
      const selected = doc.querySelector('td.ui-datepicker__td.-start');
      selected.id = 'ecb2b60a8b40da34a52a317c197bf60d20261106';
      if (multiple) {
        const duplicate = selected.cloneNode(true);
        duplicate.id = 'fa6f10b2c891d492841fc46c82556fc820261106';
        selected.parentNode.append(duplicate);
      } else selected.classList.remove('-start');
    } });
    assert.equal(result.matched, false, multiple ? 'multiple selected dates' : 'date exists but is not selected');
    assert.deepEqual(result.rows, []);
  }
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

function changedResultComponents(doc) {
  for (const name of ['kds-fromto', 'kds-passenger']) {
    const old = doc.querySelector(`${name}_1`), replacement = doc.createElement(`${name}_2`);
    for (const { name, value } of old.attributes) replacement.setAttribute(name, value);
    replacement.innerHTML = old.innerHTML;
    old.replaceWith(replacement);
  }
  doc.querySelector('.ui-datepicker__td.-start').id = 'calendar-v2-20261106';
}

test('Korean Air result repair restores verified query matching while preserving the existing fare parser', () => {
  const expectedRows = read().rows;
  read({ mutate: changedResultComponents, exercise: ({ doc, run }) => {
    const clicked = [];
    doc.addEventListener('click', (event) => clicked.push(event.target), true);
    const before = doc.body.innerHTML, inspected = run({ inspect: true });
    assert.deepEqual([inspected.matched, inspected.rows], [false, []]);
    const fixed = repairFlightRead(inspected.repairSnapshot, INPUT);
    assert.equal(fixed.ok, true, fixed.error);
    const repaired = run({ repairProof: fixed.proof, submit: true });
    assert.deepEqual([repaired.matched, repaired.repaired, repaired.submitted], [true, true, undefined]);
    assert.deepEqual(repaired.rows, expectedRows);
    assert.deepEqual(clicked, []);
    assert.equal(doc.body.innerHTML, before);
  } });
});

test('Korean Air result repair cannot expose fares for stale dates, active days or requested conditions', () => {
  for (const mutate of [
    (doc) => { doc.querySelector('.ui-datepicker__td.-start').id = 'calendar-v2-20261107'; },
    (doc) => { doc.querySelector('[slot=from-date]').textContent = '11월 07일 (토)'; },
    (doc) => { doc.querySelector('.flexible-date__link.-active .flexible-date__date').textContent = '7'; },
    (doc) => { doc.querySelector('[has-adult-number]').setAttribute('has-adult-number', '2'); },
  ]) read({ mutate: changedResultComponents, exercise: ({ doc, run }) => {
    const fixed = repairFlightRead(run({ inspect: true }).repairSnapshot, INPUT);
    assert.equal(fixed.ok, true, fixed.error);
    const differentQuery = run({ repairProof: fixed.proof, input: { ...INPUT, date: '2026-11-07' } });
    assert.deepEqual([differentQuery.matched, differentQuery.repaired, differentQuery.rows], [false, undefined, []]);
    mutate(doc);
    const stale = run({ repairProof: fixed.proof });
    assert.deepEqual([stale.matched, stale.repaired, stale.rows], [false, undefined, []], mutate.toString());
    assert.equal(repairFlightRead(run({ inspect: true }).repairSnapshot, INPUT).ok, false);
  } });
});
