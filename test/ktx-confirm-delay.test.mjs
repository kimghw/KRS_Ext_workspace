import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { korailReservePage } from '../src/korailreserve.js';
import { korailSeatsPage } from '../src/korailseats.js';
const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

const cases = [
  ['예약 일반 안내', '이용 안내', () => korailReservePage('settle')],
  ['예약 매크로 안내', '매크로 -8002', () => korailReservePage('settle')],
  ['조회 매크로 안내', '매크로 -8002', () => korailSeatsPage('read', { waitMs: 300 })],
];

async function withPage(t, words, callback) {
  const dom = new JSDOM(`<body><div role="dialog"><p>${words}</p><button>확인</button></div></body>`,
    { url: 'https://www.korail.com/ticket/search/list', pretendToBeVisual: true });
  dom.window.Element.prototype.getClientRects = function () { return this.isConnected && !this.hidden ? [{}] : []; };
  const doc = dom.window.document, notice = doc.querySelector('[role=dialog]'), clicks = [];
  doc.addEventListener('click', (event) => { clicks.push(event.target.textContent); notice.remove(); });
  const saved = Object.fromEntries(['document', 'location', 'getComputedStyle'].map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, { document: doc, location: dom.window.location, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try { await callback({ notice, clicks }); }
  finally { t.mock.timers.reset(); Object.assign(globalThis, saved); dom.window.close(); }
}

for (const [name, words, run] of cases) {
  test(`${name} — 확인은 안내를 발견한 뒤 1초가 지나야 누른다`, async (t) => {
    await withPage(t, words, async ({ clicks }) => {
      const result = run();
      await new Promise(setImmediate);
      assert.deepEqual(clicks, []);
      t.mock.timers.tick(999);
      await new Promise(setImmediate);
      assert.deepEqual(clicks, [], '999ms까지는 확인을 누르지 않는다');
      t.mock.timers.tick(1);
      await result;
      assert.deepEqual(clicks, ['확인']);
    });
  });

  test(`${name} — 대기 중 안내가 바뀌면 기존 버튼을 누르지 않는다`, async (t) => {
    await withPage(t, words, async ({ notice, clicks }) => {
      const result = run();
      await new Promise(setImmediate);
      t.mock.timers.tick(500);
      notice.querySelector('p').textContent = `${words} 다음 안내`;
      t.mock.timers.tick(500);
      await result;
      assert.deepEqual(clicks, []);
      assert.equal(notice.isConnected, true);
    });
  });
}
