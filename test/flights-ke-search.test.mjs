// Curated real search-page DOM. This verifies DOM matching and the read-only
// search action; it does not make a network request or reserve any fare.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { injected } from '../src/flights.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
const INPUT = { airline: 'KE', from: 'PUS', to: 'GMP', date: '2026-11-06', hour: 8, adults: 1 };
const HTML = readFileSync(new URL('./fixtures/korean-air-search-20261105.html', import.meta.url), 'utf8');

function searchPage({ submit = false, mutate = () => {} } = {}) {
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
    const data = JSON.parse(JSON.stringify(dom.window.eval(`(${injected.pageRead.toString()})(${JSON.stringify({ airline: 'KE', input: INPUT, submit })})`)));
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

test('disabled Korean Air search buttons are not submitted', () => {
  for (const mutate of [
    (_, h) => h.setAttribute('is-disabled', 'true'),
    (_, h) => h.setAttribute('is-aria-disabled', 'true'),
    (_, h) => { h.shadowRoot.querySelector('button').disabled = true; },
  ]) {
    assert.deepEqual(searchPage({ submit: true, mutate }).clicked, []);
  }
});
