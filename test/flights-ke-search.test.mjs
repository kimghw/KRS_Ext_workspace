// Curated real search-page DOM. This verifies DOM matching and the read-only
// search action; it does not make a network request or reserve any fare.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { injected } from '../src/flights.js';
import { repairFlightRead } from '../src/flightrepair.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
const INPUT = { airline: 'KE', from: 'PUS', to: 'GMP', date: '2026-11-06', hour: 8, adults: 1 };
const HTML = readFileSync(new URL('./fixtures/korean-air-search-20261105.html', import.meta.url), 'utf8');

function searchPage({ submit = false, mutate = () => {}, exercise } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${HTML}</body>`, {
    url: 'https://www.koreanair.com/booking/search?bookingType=R&hl=ko', runScripts: 'outside-only',
  });
  try {
    const doc = dom.window.document;
    // Chrome Save Page omits the live .checked property of native radio inputs.
    doc.querySelector('#rdo-bookingType-ow').checked = true;
    const host = doc.querySelector('.booking-gate__button kds-button_1');
    const template = host.querySelector('template[shadowrootmode="open"]');
    host.attachShadow({ mode: 'open' }).append(template.content);
    template.remove();
    const clicked = [];
    host.shadowRoot.querySelector('button').addEventListener('click', () => clicked.push('search'));
    mutate(doc, host);
    const read = (options = {}) => JSON.parse(JSON.stringify(dom.window.eval(`(${injected.pageRead.toString()})(${JSON.stringify({ airline: 'KE', input: INPUT, submit, ...options })})`)));
    if (exercise) return exercise({ doc, host, clicked, read, dom });
    const data = read();
    return { data, clicked };
  } finally { dom.window.close(); }
}

test('captured Korean Air initial query is matched without opening or clicking a fare', () => {
  const { data, clicked } = searchPage();
  assert.equal(data.matched, true);
  assert.deepEqual(data.rows, []);
  assert.deepEqual(clicked, []);
});

test('verified Korean Air search submits the actual button inside its open shadow root', () => {
  const { data, clicked } = searchPage({ submit: true });
  assert.equal(data.matched, true);
  assert.equal(data.submitted, true);
  assert.deepEqual(clicked, ['search']);
});

test('Korean Air progress overlay (aria-hidden) only defers the press; a cookie banner or inert content blocks it', () => {
  // 진행 표시("진행중 잠시만 기다려 주세요")가 본문을 aria-hidden 으로 가리는 1.5초 — 안내창이 아니고 보안 확인도 아니다(2026-11-05 실측).
  const overlay = searchPage({ submit: true, mutate: (d, host) => {
    host.closest('.booking-gate').setAttribute('aria-hidden', 'true');
    d.body.insertAdjacentHTML('beforeend', '<div class="loading">진행중 잠시만 기다려 주세요.</div>');
  } });
  assert.deepEqual([overlay.data.matched, overlay.data.challenge, overlay.data.blocked, overlay.data.submitted, overlay.clicked], [true, undefined, undefined, undefined, []]);
  const inert = searchPage({ submit: true, mutate: (d, host) => host.closest('.booking-gate').setAttribute('inert', '') });
  assert.deepEqual([inert.data.blocked, inert.clicked], [true, []]);
  // 안내창 요소는 뜨기 전에도 있다(visibility 만 다르다) — 그 요소만으로는 막힌 것이 아니다.
  const banner = searchPage({ submit: true, mutate: (d) => d.body.insertAdjacentHTML('beforeend', '<kc-global-cookie-banner></kc-global-cookie-banner>') });
  assert.deepEqual([banner.data.blocked, banner.data.submitted, banner.clicked], [undefined, true, ['search']]);
  // 처음 방문: 쿠키 안내가 뜨기까지 본문이 보이지 않는다 — 조건은 맞지만 아직 하는 중(hidden)이고 누르지 않는다.
  const hidden = searchPage({ submit: true, mutate: (d, host) => host.closest('.booking-gate').style.visibility = 'hidden' });
  assert.deepEqual([hidden.data.matched, hidden.data.loading, hidden.data.hidden, hidden.clicked], [true, true, true, []]);
});

test('Korean Air search never submits mismatching route, full date, passenger count or trip', () => {
  const changes = [
    (d) => d.querySelector('[is-from-code]').setAttribute('is-from-code', 'GMP'),
    (d) => d.querySelector('[is-to-code]').setAttribute('is-to-code', 'PUS'),
    (d) => { d.querySelector('.ui-datepicker__td.-start').id = '20271106'; },
    (d) => d.querySelector('[has-adult-number]').setAttribute('has-adult-number', '2'),
    (d) => d.querySelector('[has-child-number]').setAttribute('has-child-number', '1'),
    (d) => { d.querySelector('#rdo-bookingType-rt').checked = true; },
  ];
  for (const mutate of changes) {
    const { data, clicked } = searchPage({ submit: true, mutate });
    assert.equal(data.matched, false, mutate.toString());
    assert.deepEqual(clicked, [], mutate.toString());
  }
});

test('Korean Air search requires a full selected calendar date', () => {
  const { data, clicked } = searchPage({ submit: true, mutate: (d) => d.querySelector('ke-kds-calendar').remove() });
  assert.equal(data.matched, false);
  assert.deepEqual(clicked, []);
});

test('Korean Air search accepts the observed 32-hex calendar prefix and submits the matching date once', () => {
  for (const prefix of ['fa6f10b2c891d492841fc46c82556fc8', 'AF7404040FA89611630AE18E8CC9CA74']) {
    const { data, clicked } = searchPage({ submit: true, mutate: (doc) => {
      doc.querySelector('.ui-datepicker__td.-start').id = `${prefix}20261106`;
    } });
    assert.equal(data.matched, true, prefix);
    assert.equal(data.submitted, true, prefix);
    assert.deepEqual(clicked, ['search']);
  }
});

test('Korean Air search rejects prefixed wrong dates and unrecognized calendar IDs', () => {
  const prefix = 'fa6f10b2c891d492841fc46c82556fc8';
  const ids = [`${prefix}20271106`, `${prefix}20261107`, `${prefix.slice(1)}20261106`, `${prefix}a20261106`,
    `${'z'.repeat(32)}20261106`, 'calendar-20261106', `${prefix}20261106-extra`, `${prefix}2026-11-06`];
  for (const id of ids) {
    const { data, clicked } = searchPage({ submit: true, mutate: (doc) => { doc.querySelector('.ui-datepicker__td.-start').id = id; } });
    assert.equal(data.matched, false, id);
    assert.deepEqual(clicked, [], id);
  }
});

test('Korean Air search still requires exactly one selected day with the new calendar ID format', () => {
  for (const multiple of [false, true]) {
    const { data, clicked } = searchPage({ submit: true, mutate: (doc) => {
      const selected = doc.querySelector('.ui-datepicker__td.-start');
      selected.id = 'fa6f10b2c891d492841fc46c82556fc820261106';
      if (multiple) {
        const duplicate = selected.cloneNode(true);
        duplicate.id = 'af7404040fa89611630ae18e8cc9ca7420261106';
        selected.parentNode.append(duplicate);
      } else selected.classList.remove('-start');
    } });
    assert.equal(data.matched, false, multiple ? 'multiple selected dates' : 'date exists but is not selected');
    assert.deepEqual(clicked, []);
  }
});

test('disabled Korean Air search buttons are not submitted', () => {
  for (const mutate of [
    (_, h) => h.setAttribute('is-disabled', 'true'),
    (_, h) => h.setAttribute('is-aria-disabled', 'true'),
    (_, h) => { h.shadowRoot.querySelector('button').disabled = true; },
  ]) {
    assert.deepEqual(searchPage({ submit: true, mutate }).clicked, []);
  }
});

function changedComponentNames(doc) {
  for (const name of ['kds-fromto', 'kds-passenger']) {
    const old = doc.querySelector(`${name}_1`), replacement = doc.createElement(`${name}_2`);
    for (const { name, value } of old.attributes) replacement.setAttribute(name, value);
    replacement.innerHTML = old.innerHTML;
    old.replaceWith(replacement);
  }
  doc.querySelector('.ui-datepicker__td.-start').id = 'calendar-v2-20261106';
}

test('Korean Air repair inspection captures only selected query evidence and never submits', () => {
  searchPage({ mutate: changedComponentNames, exercise: ({ doc, read, clicked }) => {
    doc.body.insertAdjacentHTML('beforeend', '<aside>PRIVATE_ACCOUNT_SENTINEL</aside><input name="accountToken" value="PRIVATE_TOKEN_SENTINEL">');
    const inspected = read({ inspect: true, submit: true }), snapshot = inspected.repairSnapshot;
    assert.equal(inspected.matched, false);
    assert.deepEqual(inspected.rows, []);
    assert.deepEqual(Object.keys(snapshot), ['version', 'airline', 'url', 'at', 'blocked', 'hidden', 'busy', 'conditions']);
    assert.equal(snapshot.url, 'https://www.koreanair.com/booking/search');
    assert.equal(snapshot.at, inspected.at);
    assert.deepEqual(snapshot.conditions.routes, [{ from: 'PUS', to: 'GMP' }]);
    assert.equal(snapshot.conditions.dates[0].id, 'calendar-v2-20261106');
    assert.equal(JSON.stringify(snapshot).includes('PRIVATE_'), false);
    assert.equal(doc.querySelector('input[name=accountToken]').value, 'PRIVATE_TOKEN_SENTINEL');
    assert.deepEqual(clicked, []);
  } });
});

test('Korean Air repaired component names and calendar IDs still submit only the verified search button', () => {
  searchPage({ mutate: changedComponentNames, exercise: ({ read, clicked }) => {
    const inspected = read({ inspect: true });
    const fixed = repairFlightRead(inspected.repairSnapshot, INPUT);
    assert.equal(fixed.ok, true, fixed.error);
    const verified = read({ repairProof: fixed.proof });
    assert.deepEqual([verified.matched, verified.repaired, verified.submitted], [true, true, undefined]);
    assert.deepEqual(clicked, []);
    const submitted = read({ repairProof: fixed.proof, submit: true });
    assert.deepEqual([submitted.matched, submitted.repaired, submitted.submitted], [true, true, true]);
    assert.deepEqual(clicked, ['search']);
  } });
});

test('Korean Air repair proof survives serialization that reorders object keys but preserves selected evidence', () => {
  const reordered = (value) => Array.isArray(value) ? value.map(reordered)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reordered(value[key])])) : value;
  searchPage({ mutate: changedComponentNames, exercise: ({ read, clicked }) => {
    const snapshot = read({ inspect: true }).repairSnapshot;
    const fixed = repairFlightRead(reordered(snapshot), INPUT);
    assert.equal(fixed.ok, true, fixed.error);
    assert.equal(fixed.proof.snapshotKey, repairFlightRead(snapshot, INPUT).proof.snapshotKey);
    const result = read({ repairProof: reordered(fixed.proof) });
    assert.deepEqual([result.matched, result.repaired, result.submitted], [true, true, undefined]);
    assert.deepEqual(clicked, []);
  } });
});

test('Korean Air repaired query still requires one enabled search button and never selects a fare or payment action', () => {
  for (const mutate of [
    (_, host) => host.setAttribute('is-disabled', 'true'),
    (_, host) => host.setAttribute('is-aria-disabled', 'true'),
    (_, host) => { host.shadowRoot.querySelector('button').disabled = true; },
    (_, host) => { host.textContent = '결제하기'; },
    (_, host) => { host.parentNode.appendChild(host.cloneNode(true)); },
  ]) searchPage({ mutate: changedComponentNames, exercise: ({ doc, host, read, clicked }) => {
    const fixed = repairFlightRead(read({ inspect: true }).repairSnapshot, INPUT);
    assert.equal(fixed.ok, true, fixed.error);
    mutate(doc, host);
    const result = read({ repairProof: fixed.proof, submit: true });
    assert.deepEqual([result.matched, result.repaired, result.submitted], [true, true, undefined]);
    assert.deepEqual(clicked, []);
  } });
});

test('Korean Air repair proof must bind the exact snapshot, epoch, URL, airline and requested conditions', () => {
  searchPage({ mutate: changedComponentNames, exercise: ({ read, clicked }) => {
    const fixed = repairFlightRead(read({ inspect: true }).repairSnapshot, INPUT);
    assert.equal(fixed.ok, true, fixed.error);
    const changes = [
      (proof) => { proof.version = 2; }, (proof) => { proof.airline = 'BX'; },
      (proof) => { proof.at += 1; }, (proof) => { proof.url += '/other'; },
      (proof) => { proof.snapshotKey += ' '; },
      (proof) => { proof.condition.from = 'CJU'; }, (proof) => { proof.condition.to = 'CJU'; },
      (proof) => { proof.condition.date = '2026-11-07'; }, (proof) => { proof.condition.adults = 2; },
      (proof) => { proof.condition.trip = 'RT'; }, (proof) => { proof.condition.children = 1; },
      (proof) => { proof.condition.infants = 1; },
    ];
    for (const mutate of changes) {
      const proof = structuredClone(fixed.proof); mutate(proof);
      const result = read({ repairProof: proof, submit: true });
      assert.deepEqual([result.matched, result.repaired, result.submitted], [false, undefined, undefined], mutate.toString());
    }
    assert.deepEqual(clicked, []);
  } });
});

test('Korean Air repair proof is rejected after conditions, page path or blocking state change in the same document', () => {
  const changes = [
    (doc) => { doc.querySelector('.ui-datepicker__td.-start').id = 'calendar-v2-20261107'; },
    (doc) => { doc.querySelector('[slot=from-date]').textContent = '11월 07일 (토)'; },
    (doc) => { doc.querySelector('[is-from-code]').setAttribute('is-from-code', 'CJU'); },
    (doc) => { doc.querySelector('[has-adult-number]').setAttribute('has-adult-number', '2'); },
    (doc) => { doc.querySelector('#rdo-bookingType-rt').checked = true; },
    (doc) => { doc.querySelector('.booking-gate').setAttribute('inert', ''); },
    (doc) => { doc.querySelector('.booking-gate').hidden = true; },
    (doc) => { doc.body.insertAdjacentHTML('beforeend', '<div aria-busy="true">처리 중</div>'); },
    (doc) => { doc.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true">안내</div>'); },
    (doc, dom) => { dom.window.history.replaceState(null, '', '/booking/select-flight/departure'); },
  ];
  for (const mutate of changes) searchPage({ mutate: changedComponentNames, exercise: ({ doc, dom, read, clicked }) => {
    const fixed = repairFlightRead(read({ inspect: true }).repairSnapshot, INPUT);
    assert.equal(fixed.ok, true, fixed.error);
    mutate(doc, dom);
    const result = read({ repairProof: fixed.proof, submit: true });
    assert.deepEqual([result.matched, result.repaired, result.submitted], [false, undefined, undefined], mutate.toString());
    assert.deepEqual(clicked, []);
  } });
});

test('Korean Air repair proof from a previous document cannot authorize the same query in a new document', () => {
  const old = searchPage({ mutate: changedComponentNames, exercise: ({ read }) => repairFlightRead(read({ inspect: true }).repairSnapshot, INPUT) });
  assert.equal(old.ok, true, old.error);
  searchPage({ mutate: changedComponentNames, exercise: ({ read, clicked }) => {
    const result = read({ repairProof: old.proof, submit: true });
    assert.notEqual(result.at, old.proof.at);
    assert.deepEqual([result.matched, result.repaired, result.submitted], [false, undefined, undefined]);
    assert.deepEqual(clicked, []);
  } });
});

test('Korean Air changed calendar format cannot repair a different selected date', () => {
  searchPage({ mutate: changedComponentNames, exercise: ({ doc, read, clicked }) => {
    doc.querySelector('.ui-datepicker__td.-start').id = 'calendar-v2-20261107';
    const inspected = read({ inspect: true });
    assert.equal(inspected.matched, false);
    const fixed = repairFlightRead(inspected.repairSnapshot, INPUT);
    assert.equal(fixed.ok, false);
    assert.equal(fixed.code, 'FLIGHT_REPAIR_CONDITION_MISMATCH');
    assert.deepEqual(clicked, []);
  } });
});
