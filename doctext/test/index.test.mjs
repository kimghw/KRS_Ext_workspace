// 첨부 글자 먼저 뽑기의 한 진입점(doctext/index.js 의 docText)과 offscreen 문서의 리스너(offscreen.js).
//
// 엔진·chrome.offscreen·sendMessage·시계는 전부 가짜다 — 실제 doctext/browser.js 는 index.js 가 정적으로 가져오기만 하고
// 여기서 부르지는 않는다(그 모듈은 제 테스트가 본다).
import assert from 'node:assert/strict';
import { docText, IDLE_MS, OFFSCREEN_URL, JUSTIFICATION } from '../index.js';

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const tick = () => new Promise((r) => setImmediate(r));

const F = { name: 'Receipt.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjc=' };
const OUT = { input: '출장 정보\n\n<문서 글자>…</문서 글자>', files: [], read: ['Receipt.pdf: 글자 층 120자(1쪽) — 글자만 보냄'], lean: true };
/** 부르면 안 되는 것. */
const never = (what) => async () => assert.fail(`${what} 을(를) 부르면 안 된다`);
/** 가짜 시계 — set 은 1부터 번호를 주고, 불릴 함수는 set[번호-1].fn 에 둔다. */
const clock = () => {
  const c = { set: [], cleared: [] };
  c.api = { set: (fn, ms) => c.set.push({ fn, ms }), clear: (id) => { c.cleared.push(id); } };
  return c;
};
/** 가짜 chrome.offscreen — open 으로 문서가 있는지를 기억한다(create 로 열리고 close 로 닫힌다). */
const fakeOffscreen = ({ open = false, has = true, create = async () => {}, close = async () => {} } = {}) => {
  const o = { open, created: [], closed: 0 };
  if (has) o.hasDocument = async () => o.open;
  o.createDocument = async (opts) => { o.created.push(opts); await create(opts); o.open = true; };
  o.closeDocument = async () => { o.closed++; await close(); o.open = false; };
  return o;
};
/** 서비스 워커 갈래의 기본 deps — 넘긴 것만 바꾼다. */
const sw = (over) => ({ hasWorker: false, offscreen: undefined, send: never('send'), load: never('load'), timers: clock().api, ...over });
const answer = (r) => async () => r;
const skippedAs = (out, why) => assert.deepEqual(out, { input: '출장 정보', files: [F], read: [`글자 뽑기를 건너뜀(${why}) — 파일째 보냄`], lean: false });

console.log('확장 페이지 — Worker 가 있으면 그 자리에서 뽑는다');
await ta('browser.withText 를 그대로 부르고 그 결과를 돌려준다 — offscreen·sendMessage 는 건드리지 않는다', async () => {
  const got = [];
  const out = await docText('출장 정보', [F], sw({ hasWorker: true, load: async () => ({ withText: async (...a) => { got.push(a); return OUT; } }) }));
  assert.deepEqual(got, [['출장 정보', [F]]]);
  assert.deepEqual(out, OUT);
});
await ta('엔진 모듈을 못 가져오면(꾸러미 없음) 던지지 않고 파일째 — 까닭이 read 에', async () => {
  const out = await docText('출장 정보', [F], sw({ hasWorker: true, load: async () => { throw new Error('Failed to fetch dynamically imported module'); } }));
  skippedAs(out, 'Failed to fetch dynamically imported module');
});
await ta('withText 가 던져도 파일째 — 까닭은 160자에서 자른다', async () => {
  const out = await docText('출장 정보', [F], sw({ hasWorker: true, load: async () => ({ withText: async () => { throw new Error('x'.repeat(300)); } }) }));
  skippedAs(out, 'x'.repeat(160));
});
await ta('엔진이 Out 모양이 아닌 것을 돌려주면 파일째', async () => {
  const out = await docText('출장 정보', [F], sw({ hasWorker: true, load: async () => ({ withText: async () => undefined }) }));
  skippedAs(out, '엔진이 돌려준 모양이 다름');
});

console.log('서비스 워커 — offscreen 문서에 맡긴다');
await ta('문서가 없으면 만들고(url·reasons·justification) 메시지를 보내 답을 돌려준다', async () => {
  const off = fakeOffscreen();
  const sent = [];
  const out = await docText('출장 정보', [F], sw({ offscreen: off, send: async (m) => { sent.push(m); return { ok: true, ...OUT }; } }));
  assert.deepEqual(off.created, [{ url: OFFSCREEN_URL, reasons: ['WORKERS'], justification: JUSTIFICATION }]);
  assert.equal(OFFSCREEN_URL, 'offscreen.html');
  assert.ok(JUSTIFICATION.length > 10);
  assert.deepEqual(sent, [{ target: 'doctext', task: 'withText', input: '출장 정보', files: [F] }]);
  assert.deepEqual(out, OUT);
});
await ta('hasDocument 가 있다고 하면 만들지 않는다', async () => {
  const off = fakeOffscreen({ open: true });
  const out = await docText('출장 정보', [F], sw({ offscreen: off, send: answer({ ok: true, ...OUT }) }));
  assert.deepEqual([off.created, out], [[], OUT]);
});
await ta('hasDocument 가 없는 옛 Chrome 이면 바로 만들어 본다', async () => {
  const off = fakeOffscreen({ has: false });
  await docText('출장 정보', [F], sw({ offscreen: off, send: answer({ ok: true, ...OUT }) }));
  assert.equal(off.created.length, 1);
});
await ta('hasDocument 가 던지면 모르는 것으로 치고 만들어 본다', async () => {
  const off = fakeOffscreen();
  off.hasDocument = async () => { throw new Error('no'); };
  await docText('출장 정보', [F], sw({ offscreen: off, send: answer({ ok: true, ...OUT }) }));
  assert.equal(off.created.length, 1);
});
await ta('동시에 두 번 불려도 createDocument 는 한 번 — 둘 다 답을 받는다', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const off = fakeOffscreen({ create: () => gate });
  const sent = [];
  const d = sw({ offscreen: off, send: async (m) => { sent.push(m.input); return { ok: true, ...OUT, input: m.input + '!' }; } });
  const p1 = docText('하나', [F], d);
  const p2 = docText('둘', [F], d);
  await tick();
  assert.equal(off.created.length, 1);
  assert.deepEqual(sent, []);   // 문서가 뜨기 전에는 보내지 않는다
  release();
  const [a, b] = await Promise.all([p1, p2]);
  assert.deepEqual([a.input, b.input, sent.sort()], ['하나!', '둘!', ['둘', '하나']]);
  assert.equal(off.created.length, 1);
});
for (const text of ['Only a single offscreen document may be created.', 'An offscreen document already exists.']) {
  await ta(`이미 있다는 오류("${text.slice(0, 20)}…")는 삼키고 메시지를 보낸다`, async () => {
    const off = fakeOffscreen({ create: async () => { throw new Error(text); } });
    const out = await docText('출장 정보', [F], sw({ offscreen: off, send: answer({ ok: true, ...OUT }) }));
    assert.deepEqual(out, OUT);
  });
}
await ta('다른 createDocument 오류는 파일째 — offscreen: 까닭', async () => {
  const off = fakeOffscreen({ create: async () => { throw new Error('offscreen 권한 없음'); } });
  const out = await docText('출장 정보', [F], sw({ offscreen: off, send: never('send') }));
  skippedAs(out, 'offscreen: offscreen 권한 없음');
});
await ta('응답이 없으면(undefined) 파일째', async () => {
  const out = await docText('출장 정보', [F], sw({ offscreen: fakeOffscreen(), send: answer(undefined) }));
  skippedAs(out, 'offscreen: 응답 없음');
});
await ta('{ ok: false, error } 면 파일째 — 그 까닭을 적는다', async () => {
  const out = await docText('출장 정보', [F], sw({ offscreen: fakeOffscreen(), send: answer({ ok: false, error: 'OCR 시간 초과' }) }));
  skippedAs(out, 'offscreen: OCR 시간 초과');
});
await ta('sendMessage 가 던지면(받는 쪽 없음) 파일째', async () => {
  const out = await docText('출장 정보', [F], sw({ offscreen: fakeOffscreen(), send: async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); } }));
  skippedAs(out, 'offscreen: Could not establish connection. Receiving end does not exist.');
});
await ta('ok 인데 Out 모양이 아니면 파일째', async () => {
  const out = await docText('출장 정보', [F], sw({ offscreen: fakeOffscreen(), send: answer({ ok: true, input: '글' }) }));
  skippedAs(out, 'offscreen: 응답 모양이 다름');
});
await ta('답의 lean 은 불로, read 는 글로 맞춘다', async () => {
  const out = await docText('출장 정보', [F], sw({ offscreen: fakeOffscreen(), send: answer({ ok: true, input: '글', files: [], read: [1], lean: 1 }) }));
  assert.deepEqual(out, { input: '글', files: [], read: ['1'], lean: true });
});

console.log('유휴 — 일이 끝나고 IDLE_MS 동안 더 없으면 문서를 닫는다');
await ta('일이 끝나면 IDLE_MS 시계를 걸고, 울리면 closeDocument 한 번 — 그 전에는 닫지 않는다', async () => {
  const c = clock();
  const off = fakeOffscreen();
  await docText('출장 정보', [F], sw({ offscreen: off, send: answer({ ok: true, ...OUT }), timers: c.api }));
  assert.deepEqual([c.set.length, c.set[0].ms, off.closed], [1, IDLE_MS, 0]);
  c.set[0].fn();
  await tick();
  assert.deepEqual([off.closed, off.open], [1, false]);
});
await ta('유휴 중에 새 일이 오면 시계를 끄고, 끝나면 다시 건다', async () => {
  const c = clock();
  const off = fakeOffscreen();
  const d = sw({ offscreen: off, send: answer({ ok: true, ...OUT }), timers: c.api });
  await docText('하나', [F], d);
  await docText('둘', [F], d);
  assert.deepEqual([c.set.length, c.cleared, off.closed, off.created.length], [2, [1], 0, 1]);
});
await ta('동시에 맡긴 일은 마지막 것이 끝난 뒤에야 시계를 건다', async () => {
  const c = clock();
  const off = fakeOffscreen();
  let release;
  const gate = new Promise((r) => { release = r; });
  const d = sw({ offscreen: off, send: async (m) => { if (m.input === '느림') await gate; return { ok: true, ...OUT }; }, timers: c.api });
  const slow = docText('느림', [F], d);
  await docText('빠름', [F], d);
  assert.equal(c.set.length, 0);
  release();
  await slow;
  assert.equal(c.set.length, 1);
});
await ta('닫는 중에 새 일이 오면 다 닫힌 뒤 다시 띄운다', async () => {
  const c = clock();
  let release;
  const gate = new Promise((r) => { release = r; });
  const off = fakeOffscreen({ close: () => gate });
  const d = sw({ offscreen: off, send: answer({ ok: true, ...OUT }), timers: c.api });
  await docText('하나', [F], d);
  c.set[0].fn();
  await tick();
  const p = docText('둘', [F], d);
  await tick();
  assert.deepEqual([off.closed, off.created.length], [1, 1]);   // 아직 닫히는 중 — 새로 띄우지 않았다
  release();
  const out = await p;
  assert.deepEqual([out, off.created.length, off.open], [OUT, 2, true]);
});
await ta('closeDocument 가 던져도 조용히 넘어간다', async () => {
  const c = clock();
  const off = fakeOffscreen({ close: async () => { throw new Error('No current offscreen document.'); } });
  await docText('출장 정보', [F], sw({ offscreen: off, send: answer({ ok: true, ...OUT }), timers: c.api }));
  c.set[0].fn();
  await tick();
  assert.equal(off.closed, 1);   // 던진 약속을 아무도 안 받았으면 node 가 여기서 죽는다
});
await ta('실패한 호출 뒤에도 시계는 걸린다(busy 가 돌아온다)', async () => {
  const c = clock();
  const off = fakeOffscreen();
  await docText('출장 정보', [F], sw({ offscreen: off, send: answer(undefined), timers: c.api }));
  assert.equal(c.set.length, 1);
});

console.log('둘 다 아니면');
await ta('Worker 도 chrome.offscreen 도 없으면 파일째', async () => {
  skippedAs(await docText('출장 정보', [F], sw()), '이 환경에서는 뽑을 수 없음');
});

console.log('offscreen.js — 리스너');
let listener;
globalThis.chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } };
const { onMessage } = await import('../../offscreen.js');
/** sendResponse 를 기다릴 수 있게 약속으로 감싼다. */
const reply = () => { let res; const p = new Promise((r) => { res = r; }); return { p, fn: (v) => res(v) }; };
await ta('가져오면 chrome.runtime.onMessage 에 리스너를 건다 — export 한 onMessage 와 같은 것', async () => {
  assert.equal(typeof listener, 'function');
  assert.equal(listener, onMessage);
});
await ta('target 이 doctext 가 아니면 undefined — 답하지 않는다(background.js 의 type 메시지를 가로채지 않는다)', async () => {
  assert.equal(listener({ type: 'receiptRead', file: F }, {}, never('sendResponse')), undefined);
  assert.equal(listener(undefined, {}, never('sendResponse')), undefined);
});
await ta('내 메시지면 true 를 돌려주고 browser.withText 의 결과를 { ok: true, ...Out } 으로 답한다', async () => {
  const r = reply();
  const got = [];
  const ret = listener({ target: 'doctext', task: 'withText', input: '출장 정보', files: [F] }, {}, r.fn, async () => ({ withText: async (...a) => { got.push(a); return OUT; } }));
  assert.equal(ret, true);
  assert.deepEqual(await r.p, { ok: true, ...OUT });
  assert.deepEqual(got, [['출장 정보', [F]]]);
});
await ta('withText 가 던지면 { ok: false, error }', async () => {
  const r = reply();
  listener({ target: 'doctext', task: 'withText', input: '출장 정보', files: [F] }, {}, r.fn, async () => ({ withText: async () => { throw new Error('OCR 시간 초과'); } }));
  assert.deepEqual(await r.p, { ok: false, error: 'OCR 시간 초과' });
});
await ta('엔진 모듈을 못 가져와도 { ok: false, error }', async () => {
  const r = reply();
  listener({ target: 'doctext', task: 'withText', input: '출장 정보', files: [F] }, {}, r.fn, async () => { throw new Error('모듈 없음'); });
  assert.deepEqual(await r.p, { ok: false, error: '모듈 없음' });
});
await ta('모르는 task 는 { ok: false } — 엔진을 가져오지 않는다', async () => {
  const r = reply();
  listener({ target: 'doctext', task: 'ping' }, {}, r.fn, never('load'));
  assert.deepEqual(await r.p, { ok: false, error: '모르는 일(ping)' });
});

console.log(`\n통과 ${pass}건`);
