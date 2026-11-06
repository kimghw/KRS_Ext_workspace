// 기존 브릿지의 KTX 조회 모듈 연결 — 실제 사이트나 Python 실행 없이 메시지·표시·실패 경계를 검증한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { KTX_STATIONS, KTX_NATIVE_HOST, KORAIL_MAIN, ktxSearch, ktxOpen } from '../src/ktx.js';
import { createDispatcher } from '../actions/dispatch.js';
import { registerKtx } from '../actions/runners/ktx.js';
import { ACTIONS } from '../actions/spec.js';
import { createKtxBox, PREF_KEY } from '../ktxbox.js';
const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const SESSION = '0123456789abcdef0123456789abcdef';
const INPUT = { from: '부산', to: '서울', date: '2026-11-12', hour: 5, adults: 1 };
const ROW = { train: 'KTX', no: '101', dep: '05:13', arr: '07:51', took: '2시간 38분',
  gen: { price: '59,800원', soldOut: false, soon: true }, spec: { price: '83,700원', soldOut: true, soon: false } };
const result = (rows = [ROW]) => ({ ok: true, rows, session: SESSION });
function native(answer = () => result()) {
  const calls = [], forbidden = [];
  const deny = (name) => { forbidden.push(name); throw new Error('Unexpected API: ' + name); };
  const api = new Proxy({
    runtime: new Proxy({ sendNativeMessage: async (host, message) => { calls.push({ host, message }); return answer(message); } },
      { get: (target, key) => key in target ? target[key] : deny('runtime.' + String(key)) }),
  }, { get: (target, key) => key in target ? target[key] : deny(String(key)) });
  return { api, calls, forbidden };
}
function panel({ answer, open, saved, parse } = {}) {
  const doc = new JSDOM(html).window.document;
  const store = { ...(saved || {}) }, logs = [], opened = [], continued = [], whens = [], views = [];
  const f = native(answer);
  const d = createDispatcher({ log: (line) => logs.push(line) });
  registerKtx(d, { ktxSearch: (input, options) => ktxSearch(input, { ...options, api: f.api }) });
  let date = INPUT.date, hour = INPUT.hour;
  const box = createKtxBox({
    doc, actions: d, storage: { get: async (key) => ({ [key]: store[key] }), set: async (values) => Object.assign(store, values) },
    when: () => ({ date, hour }),
    open: async (pick) => { continued.push(pick); return open ? open(pick) : { ok: true }; },
    openTab: async (url) => { opened.push(url); },
    // 말로 찾기 — parse 는 테스트가 끼운 가짜(src/llm.js ktxSmart 의 자리), setWhen 은 날짜 줄(공통 날짜·시작 시)에 넣는 손.
    ...(parse ? { parse } : {}),
    setWhen: (w) => { whens.push(w); if (w.date) date = w.date; if (Number.isInteger(w.hour)) hour = w.hour; },
    onView: (v) => views.push(v),
  });
  const $ = (id) => doc.getElementById(id);
  const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new doc.defaultView.Event('change', { bubbles: true })); };
  const choose = (view) => $('carViewControl').querySelector('[data-view="' + view + '"] svg').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  return { ...f, box, doc, $, store, d, logs, opened, continued, change, choose, whens, views,
    setDate: (value) => { date = value; }, setHour: (value) => { hour = value; } };
}

test('ktxSearch — 한 번의 네이티브 메시지로 조건만 보내고 페이지·창·저장소에 접근하지 않는다', async (t) => {
  assert.equal(KTX_NATIVE_HOST, 'com.krs.meetingroom');
  const f = native();
  const requests = t.mock.method(globalThis, 'fetch', () => { throw new Error('network forbidden'); });
  const stages = [];
  assert.deepEqual(await ktxSearch({ ...INPUT, command: 'ignored', url: 'https://example.com' }, { api: f.api, onStage: (s) => stages.push(s) }), result());
  assert.deepEqual(f.calls, [{ host: KTX_NATIVE_HOST, message: { task: 'ktxSearch', input: INPUT } }]);
  assert.deepEqual(f.forbidden, []);
  assert.equal(requests.mock.callCount(), 0);
  assert.deepEqual(stages, ['열차 조회 중']);
});

test('조회 조건 — 모르는 역·같은 역·없는 날짜·잘못된 시와 인원은 브릿지 호출 전 거부한다', async () => {
  const f = native();
  for (const patch of [{ from: '인천' }, { to: '부산' }, { date: '2026-02-30' }, { date: '2026-2-3' }, { hour: 24 }, { hour: '5' }, { adults: 0 }, { adults: 10 }, { adults: NaN }]) {
    const value = await ktxSearch({ ...INPUT, ...patch }, { api: f.api });
    assert.equal(value.ok, false, JSON.stringify(patch));
    assert.equal(value.code, 'INPUT_INVALID');
  }
  assert.deepEqual(f.calls, []);
});

test('조회 실패 — 차단·실행 환경 없음·옛 브릿지·미등록·시간 초과를 구분하고 재시도하지 않는다', async () => {
  for (const [response, code, words] of [
    [{ ok: false, error: 'CODE : -8003', code: 'GUARD_BLOCKED' }, 'GUARD_BLOCKED', /-8003/],
    [{ ok: false, error: 'python missing', code: 'RUNTIME_MISSING' }, 'RUNTIME_MISSING', /KTX 실행 환경/],
    [{ ok: false, error: '알 수 없는 작업: ktxSearch' }, 'BRIDGE_OUTDATED', /최신 브릿지 등록/],
  ]) {
    const f = native(() => response);
    const r = await ktxSearch(INPUT, { api: f.api });
    assert.equal(r.code, code);
    assert.match(r.error, words);
    if (code === 'RUNTIME_MISSING') {
      assert.match(r.error, /native\/setup-ktx\.ps1/);
      assert.doesNotMatch(r.error, /ExtensionId|native\/install\.ps1/);
    }
    if (code === 'BRIDGE_OUTDATED') {
      assert.match(r.error, /native\/install\.ps1 -ExtensionId <확장ID>/);
      assert.doesNotMatch(r.error, /setup-ktx/);
    }
    assert.equal(f.calls.length, 1);
  }
  const missing = native(() => { throw new Error('Specified native messaging host not found.'); });
  assert.equal((await ktxSearch(INPUT, { api: missing.api })).code, 'BRIDGE_UNAVAILABLE');
  assert.equal((await ktxSearch(INPUT, { api: {} })).code, 'BRIDGE_UNAVAILABLE');
  const late = native(() => new Promise(() => {}));
  assert.equal((await ktxSearch(INPUT, { api: late.api, timeoutMs: 1 })).code, 'BRIDGE_TIMEOUT');
  assert.equal(late.calls.length, 1);
});

test('브릿지 미등록 — 조회와 계속 열기 모두 기존 단일 호스트만 사용하고 별도 호스트로 우회하지 않는다', async () => {
  const hosts = [];
  const api = { runtime: { sendNativeMessage: async (host) => {
    hosts.push(host);
    if (host === 'com.krs.ktx') return result();
    throw new Error('Specified native messaging host not found.');
  } } };
  for (const response of [await ktxSearch(INPUT, { api }), await ktxOpen({ session: SESSION }, { api })]) {
    assert.equal(response.ok, false);
    assert.equal(response.code, 'BRIDGE_UNAVAILABLE');
    assert.match(response.error, /브릿지 설치·등록/);
    assert.match(response.error, /native\/install\.ps1 -ExtensionId <확장ID>/);
    assert.doesNotMatch(response.error, /Claude|Node|setup-ktx|com\.krs\.ktx/);
  }
  assert.deepEqual(hosts, ['com.krs.meetingroom', 'com.krs.meetingroom']);
});

test('브릿지 응답 — 빈 목록은 허용하고 잘못된 세션·열차·좌석·시각은 성공으로 표시하지 않는다', async () => {
  assert.deepEqual(await ktxSearch(INPUT, { api: native(() => result([])).api }), result([]));
  for (const response of [null, {}, { ok: true, rows: [], session: '../escape' },
    { ...result(), rows: {} }, result([{ ...ROW, dep: '99:30' }]), result([{ ...ROW, gen: { price: '1원', soldOut: 'false', soon: false } }])]) {
    const r = await ktxSearch(INPUT, { api: native(() => response).api });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'BRIDGE_RESPONSE');
  }
});

test('ktxOpen — 조회 세션만 보내 화면을 열고 좌석·예약 명령은 보내지 않는다', async () => {
  const f = native(() => ({ ok: true, ignored: 'value' }));
  assert.deepEqual(await ktxOpen({ session: SESSION, seat: 'gen', row: ROW }, { api: f.api }), { ok: true });
  assert.deepEqual(f.calls, [{ host: KTX_NATIVE_HOST, message: { task: 'ktxOpen', session: SESSION } }]);
  assert.deepEqual(f.forbidden, []);
  assert.equal((await ktxOpen({ session: '../bad' }, { api: f.api })).code, 'SESSION_INVALID');
  assert.equal(f.calls.length, 1);
  const lost = native(() => ({ ok: false, error: '조회 창이 닫혔습니다', code: 'SESSION_MISSING' }));
  assert.equal((await ktxOpen({ session: SESSION }, { api: lost.api })).code, 'SESSION_MISSING');
});

test('행위 명세 — 32개 역·인원·날짜로 기록하고 확인 없이 조회 결과만 기록한다', async () => {
  const entry = ACTIONS.actions['ktx.search'];
  assert.deepEqual(Object.keys(entry.fields), ['from', 'to', 'date', 'hour', 'adults']);
  assert.deepEqual(entry.fields.from.values, KTX_STATIONS.map(([name]) => name));
  assert.deepEqual(entry.fields.to.values, entry.fields.from.values);
  assert.deepEqual([entry.confirm, entry.effect], [false, 'none']);
  const f = panel();
  const { record } = f.d.build('ktx.search', { input: INPUT });
  assert.deepEqual(await f.d.run(record), result());
  assert.deepEqual(f.logs.map(({ kind, ok }) => [kind, ok]), [['ktx', true]]);
  assert.match(f.logs[0].text, /부산→서울/);
  assert.throws(() => f.d.build('ktx.search', { input: { ...INPUT, adults: 12 } }), /인원|adults/);
});

test('패널 — 조건을 보내 열차·좌석을 읽기 전용으로 표시하고 계속을 누를 때만 화면을 연다', async () => {
  const f = panel({ saved: { [PREF_KEY]: { from: '부산', to: '서울', adults: 2 } } });
  await tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.$('ktxPax').value, '2');
  f.$('ktxGo').click();
  await tick();
  assert.deepEqual(f.calls[0].message.input, { ...INPUT, adults: 2 });
  assert.equal(f.$('ktxList').querySelectorAll('li').length, 1);
  assert.equal(f.$('ktxCount').textContent, '1');
  assert.equal(f.$('ktxList').querySelector('button'), null);
  assert.match(f.$('ktxList').textContent, /일반실59,800원매진임박.*특실매진/);
  assert.equal(f.$('ktxContinue').hidden, false);
  assert.deepEqual(f.continued, []);
  f.$('ktxContinue').click();
  await tick();
  assert.deepEqual(f.continued, [{ session: SESSION }]);
  assert.match(f.$('ktxNote').textContent, /좌석 선택·예매·결제는 직접/);
  assert.deepEqual(f.opened, []);
});

test('패널 — 사이트가 보낸 글은 열차명·가격·소요시간 모두 HTML로 실행하지 않는다', async () => {
  const f = panel({ answer: () => result([{ ...ROW, train: '<img src=x onerror=evil()>', took: '<svg onload=evil()>',
    gen: { ...ROW.gen, price: '<script>evil()</script>' } }]) });
  f.$('ktxGo').click();
  await tick();
  assert.equal(f.$('ktxList').querySelector('img,svg,script'), null);
  assert.match(f.$('ktxList').textContent, /<img src=x onerror=evil\(\)>/);
  assert.match(f.$('ktxList').textContent, /<script>evil\(\)<\/script>/);
});

test('패널 — 조회 중 중복 클릭을 막고 조건이 바뀐 동안 도착한 결과와 세션을 폐기한다', async () => {
  let finish;
  const f = panel({ answer: () => new Promise((resolve) => { finish = resolve; }) });
  const click = () => f.$('ktxGo').dispatchEvent(new f.doc.defaultView.MouseEvent('click', { bubbles: true }));
  click(); click();
  assert.equal(f.calls.length, 1);
  assert.equal(f.$('ktxGo').disabled, true);
  f.setDate('2026-11-13');
  f.$('date').dispatchEvent(new f.doc.defaultView.Event('change', { bubbles: true }));
  finish(result());
  await tick();
  assert.equal(f.$('ktxList').children.length, 0);
  assert.equal(f.$('ktxContinue').hidden, true);
  assert.equal(f.$('ktxGo').disabled, false);
  assert.match(f.$('ktxNote').textContent, /이전 결과/);
});

test('패널 — 공통 날짜 화살표·시각·역·인원 변경은 오래된 결과와 계속 연결을 지운다', async () => {
  const f = panel();
  const search = async () => { f.$('ktxGo').click(); await tick(); assert.equal(f.$('ktxContinue').hidden, false); };
  await search();
  f.change('ktxPax', '2');
  assert.equal(f.$('ktxContinue').hidden, true);
  await search();
  f.change('ktxTo', '대전');
  assert.equal(f.$('ktxList').children.length, 0);
  await search();
  f.setHour(8);
  f.$('hourStart').dispatchEvent(new f.doc.defaultView.Event('input', { bubbles: true }));
  assert.equal(f.$('ktxContinue').hidden, true);
  await search();
  f.$('nextDay').addEventListener('click', () => f.setDate('2026-11-13'));
  f.$('nextDay').click();
  assert.equal(f.$('ktxContinue').hidden, true);
  await search();
  f.$('ktxSwap').click();
  assert.deepEqual([f.$('ktxFrom').value, f.$('ktxTo').value], ['대전', '부산']);
  assert.equal(f.$('ktxContinue').hidden, true);
  await tick();
  assert.deepEqual(f.store[PREF_KEY], { from: '대전', to: '부산', adults: 2 });
});

test('패널 — 실패해도 자동 조회나 탭 열기가 없고 명시적으로 코레일 열기를 누를 수 있다', async () => {
  let failed = true;
  const f = panel({ answer: () => failed ? { ok: false, error: 'Python 실행 환경 없음', code: 'RUNTIME_MISSING' } : result() });
  f.$('ktxGo').click(); await tick();
  assert.equal(f.$('ktxNote').classList.contains('bad'), true);
  assert.match(f.$('ktxNote').textContent, /native\/setup-ktx\.ps1/);
  assert.doesNotMatch(f.$('ktxNote').textContent, /ExtensionId/);
  assert.equal(f.$('ktxGo').disabled, false);
  assert.equal(f.$('ktxContinue').hidden, true);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.opened, []);
  f.$('ktxSite').click(); await tick();
  assert.deepEqual(f.opened, [KORAIL_MAIN]);
  assert.equal(f.calls.length, 1);
  failed = false;
  f.$('ktxFrom').dispatchEvent(new f.doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick();
  assert.equal(f.$('ktxNote').classList.contains('bad'), false);
  assert.equal(f.$('ktxContinue').hidden, false);
});

test('계속 열기 — 실패를 알리고 다시 시도할 수 있으며 바뀐 조건의 화면을 열지 않는다', async () => {
  const f = panel({ open: () => { throw new Error('조회 화면이 닫혔습니다'); } });
  f.$('ktxGo').click(); await tick();
  f.$('ktxContinue').click(); await tick();
  assert.match(f.$('ktxNote').textContent, /조회 화면이 닫혔습니다/);
  assert.equal(f.$('ktxContinue').disabled, false);
  f.setHour(10); // 이벤트가 없는 변경도 클릭 직전에 검사한다.
  f.$('ktxContinue').click();
  assert.equal(f.continued.length, 1);
  assert.equal(f.$('ktxContinue').hidden, true);
});

test('시간 옆 아이콘 — 차량으로 시작하고 KTX·항공권 전환과 다른 탭에서 숨기기를 유지한다', () => {
  const f = panel();
  const app = f.doc.querySelector('.app');
  const pressed = () => f.$('carViewControl').querySelector('[aria-pressed="true"]')?.dataset.view;
  assert.deepEqual([f.$('carViewControl').hidden, f.$('ktxBox').hidden], [true, true]);
  f.box.toggle(true);
  assert.deepEqual([f.$('ktxBox').hidden, pressed()], [true, 'car']);
  f.choose('ktx');
  assert.deepEqual([f.$('ktxBox').hidden, f.$('flightBox').hidden, app.classList.contains('ktx-view')], [false, true, true]);
  f.box.toggle(false);
  assert.deepEqual([f.$('carViewControl').hidden, f.$('ktxBox').hidden, app.classList.contains('ktx-view')], [true, true, false]);
  f.box.toggle(true);
  assert.equal(f.$('ktxBox').hidden, false);
  f.choose('flight');
  assert.deepEqual([f.$('ktxBox').hidden, f.$('flightBox').hidden, app.classList.contains('flight-view'), pressed()], [true, false, true, 'flight']);
  f.choose('car');
  assert.deepEqual([f.$('ktxBox').hidden, f.$('flightBox').hidden, app.classList.contains('flight-view'), pressed()], [true, true, false, 'car']);
  assert.equal(f.calls.length, 0);
});

test('패널 배치 — 시간 옆 아이콘·예약 칸 다음 KTX·출장 바로가기 ktxGo 를 유지한다', () => {
  const f = panel();
  assert.equal(f.$('ktxBox').previousElementSibling.id, 'booking');
  assert.ok(f.$('carViewControl').previousElementSibling.classList.contains('hours-control'));
  assert.deepEqual([...f.$('carViewControl').querySelectorAll('button[data-view]')].map((b) => [b.dataset.view, !!b.querySelector('svg')]), [['car', true], ['ktx', true], ['flight', true]]);
  assert.equal(f.$('carTabs'), null);
  assert.equal(f.$('ktxGo').tagName, 'BUTTON');
  const css = fs.readFileSync(new URL('../sidepanel.css', import.meta.url), 'utf8');
  // 말로 찾기 칸(.ask)은 KTX 보기에서 남는다(2026-11-06 "차량 ktx 부분에도 채팅으로 조회") — 항공권 보기에서는 숨는다.
  assert.match(css, /\.app\.ktx-view > \.schedule, \.app\.ktx-view > #booking \{ display: none; \}/);
  assert.doesNotMatch(css, /\.app\.ktx-view > \.ask/);
  assert.match(css, /\.app\.flight-view > \.ask, \.app\.flight-view > \.schedule, \.app\.flight-view > #booking \{ display: none; \}/);
  assert.equal(f.doc.querySelector('.ask').compareDocumentPosition(f.$('ktxBox')) & 4, 4, '말로 찾기 칸은 KTX 칸보다 앞(날짜 줄 바로 아래)');
});

console.log('말로 찾기 — KTX 보기에서 같은 칸이 KTX 조회 조건을 읽는다(2026-11-06 사용자 지정: "차량 ktx 부분에도 채팅으로 조회 하는거 기능 차량이랑 동일하게 넣어줘")');

test('행위 명세 — 말로 찾기 작업 search.ktx: per-kind·조각(partial)이라 다섯 칸 모두 필수가 아니고 지시문이 역 목록·달력 규칙을 말한다', () => {
  const dom = ACTIONS.domains.ktx;
  assert.deepEqual([dom.llm.mode, dom.llm.partial, dom.llm.input, dom.llm.consumer], ['per-kind', true, 'ktx', { module: 'src/ktx.js', export: 'ktxSearch' }]);
  assert.deepEqual([ACTIONS.actions['ktx.search'].llm, ACTIONS.actions['ktx.search'].task], [true, 'search.ktx']);
  const task = ACTIONS.tasks['search.ktx'];
  assert.deepEqual(Object.keys(task.fields), ['from', 'to', 'date', 'hour', 'adults']);
  assert.equal(task.partial, true);
  for (const [key, f] of Object.entries(task.fields)) assert.equal(f.required, undefined, `${key} 는 조각이라 필수가 아니다`);
  assert.deepEqual(task.fields.from.values, KTX_STATIONS.map(([name]) => name));
  assert.match(task.fields.hour.desc, /"오후 2시" 는 14/);
  assert.match(task.rules.join('\n'), /말하지 않은 칸은 null/);
  assert.match(task.rules.join('\n'), /달력 줄에서 찾습니다/);
});

test('말로 찾기 — 읽은 조각을 역·인원 칸과 날짜 줄에 얹어 바로 조회한다(기록은 by llm, 활동 로그에 말과 길)', async () => {
  const asked = [];
  const f = panel({ parse: async (text, form) => { asked.push({ text, form }); return { patch: { to: '대전', hour: 14, date: '2026-11-13', adults: 2 }, via: 'cli', summary: '…→대전 · 2026-11-13 · 14시~ · 2명', costUsd: 0.01 }; } });
  f.box.toggle(true);
  f.choose('ktx');
  assert.deepEqual([f.box.view(), f.views], ['ktx', ['ktx']]);
  const r = await f.box.ask('다음 주 금요일 오후 2시 대전 2명');
  assert.deepEqual(asked, [{ text: '다음 주 금요일 오후 2시 대전 2명', form: { from: '부산', to: '서울', date: INPUT.date, hour: INPUT.hour, adults: 1 } }], '지금 칸이 읽는 길에 간다');
  assert.deepEqual([f.$('ktxFrom').value, f.$('ktxTo').value, f.$('ktxPax').value], ['부산', '대전', '2']);
  assert.deepEqual(f.whens, [{ date: '2026-11-13', hour: 14 }]);
  assert.deepEqual(f.calls.map((c) => c.message), [{ task: 'ktxSearch', input: { from: '부산', to: '대전', date: '2026-11-13', hour: 14, adults: 2 } }]);
  assert.deepEqual({ via: r.via, read: r.read, head: r.head, ok: r.ok, rows: r.rows, costUsd: r.costUsd }, { via: 'cli', read: '…→대전 · 2026-11-13 · 14시~ · 2명', head: '부산→대전 11/13 14시~ 2명', ok: true, rows: 1, costUsd: 0.01 });
  assert.equal(f.$('ktxList').children.length, 1);
  assert.deepEqual(f.store[PREF_KEY], { from: '부산', to: '대전', adults: 2 });
  assert.equal(f.logs.length, 1);
  assert.deepEqual([f.logs[0].kind, f.logs[0].ok, f.logs[0].data.record.by, f.logs[0].data.record.via, f.logs[0].data.via], ['ktx', true, 'llm', 'cli', 'cli']);
  assert.equal(f.logs[0].text, '"다음 주 금요일 오후 2시 대전 2명" → [로컬 CLI] KTX 부산→대전 11/13 14시~ 2명');
});

test('말로 찾기 — 말하지 않은 칸은 지금 값 그대로다. 역 하나만 읽어도 조회하고 날짜 줄은 건드리지 않는다', async () => {
  const f = panel({ parse: async () => ({ patch: { from: '동대구' }, via: 'local', summary: '동대구→…' }) });
  f.box.toggle(true);
  f.choose('ktx');
  f.change('ktxPax', '3');
  const r = await f.box.ask('동대구에서');
  assert.deepEqual(f.whens, []);
  assert.deepEqual(f.calls.map((c) => c.message.input), [{ from: '동대구', to: '서울', date: INPUT.date, hour: INPUT.hour, adults: 3 }]);
  assert.deepEqual([r.ok, r.via, r.head, f.logs[0].data.record.via], [true, 'local', `동대구→서울 ${INPUT.date.slice(5).replace('-', '/')} 05시~ 3명`, 'local']);
});

test('말로 찾기 — 못 읽으면(parse 가 던짐) 채우지도 조회하지도 않고, 읽은 역이 같으면 조회하지 않는다', async () => {
  const f = panel({ parse: async (text) => { if (text === '아무거나') throw new Error('조건을 읽지 못했습니다 — 역·날짜·시각·인원 가운데 하나는 적어 주세요.'); return { patch: { to: '부산' }, via: 'api', summary: '…→부산' }; } });
  f.box.toggle(true);
  f.choose('ktx');
  await assert.rejects(f.box.ask('아무거나'), /조건을 읽지 못했습니다/);
  assert.deepEqual([f.$('ktxFrom').value, f.$('ktxTo').value, f.$('ktxPax').value, f.calls.length, f.logs.length, f.whens.length], ['부산', '서울', '1', 0, 0, 0]);
  const r = await f.box.ask('부산');
  assert.deepEqual([r.ok, r.error, f.calls.length, f.logs.length], [false, '출발역과 도착역이 같습니다.', 0, 0]);
  assert.deepEqual([f.$('ktxTo').value, f.$('ktxNote').textContent, f.$('ktxNote').classList.contains('bad')], ['부산', '출발역과 도착역이 같습니다.', true]);
  const g = panel();
  await assert.rejects(g.box.ask('서울'), /말로 찾기를 쓸 수 없습니다/);
});

test('말로 찾기 — 조회가 도는 동안에는 받지 않고, 조회 실패는 알림과 결과로 돌아온다', async () => {
  let release;
  const f = panel({ answer: () => new Promise((resolve) => { release = () => resolve(result()); }), parse: async () => ({ patch: { to: '대전' }, via: 'cli', summary: '…→대전' }) });
  f.box.toggle(true);
  f.choose('ktx');
  f.$('ktxGo').click();
  await assert.rejects(f.box.ask('대전'), /조회가 끝난 뒤에/);
  release();
  await tick();
  await tick();
  assert.equal(f.calls.length, 1);
  const g = panel({ answer: () => ({ ok: false, error: 'CODE : -8003', code: 'GUARD_BLOCKED' }), parse: async () => ({ patch: { to: '대전' }, via: 'cli', summary: '…→대전' }) });
  g.box.toggle(true);
  g.choose('ktx');
  const r = await g.box.ask('대전');
  assert.deepEqual([r.ok, r.error, g.$('ktxTo').value, g.$('ktxNote').classList.contains('bad'), g.logs[0].ok], [false, 'CODE : -8003', '대전', true, false]);
});
