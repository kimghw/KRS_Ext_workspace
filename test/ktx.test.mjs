// 시간표 조회와 UI: 네트워크·네이티브 브릿지 없이 조회하고 일반 코레일 탭을 연다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { KTX_STATIONS, KORAIL_SEARCH, ktxSearch, ktxOpen } from '../src/ktx.js';
import { createDispatcher } from '../actions/dispatch.js';
import { registerKtx } from '../actions/runners/ktx.js';
import { ACTIONS } from '../actions/spec.js';
import { createKtxBox, PREF_KEY } from '../ktxbox.js';
const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const INPUT = { from: '부산', to: '서울', date: '2026-11-12', hour: 5, adults: 1 };
const ROW = { train: 'KTX', no: '101', dep: '05:13', arr: '07:51', took: '2시간 38분', nextDay: false };
const TABLE = { basis: '2026-11-01', source: 'https://www.korail.com/official.xlsx', trains: [
  { no: ROW.no, train: ROW.train, days: 127, stops: [['부산', 313], ['서울', 471]] },
] };
const result = (rows = [ROW]) => ({ ok: true, rows, basis: TABLE.basis, source: TABLE.source, url: KORAIL_SEARCH });
function panel({ answer = () => result(), saved, parse, openTab } = {}) {
  const doc = new JSDOM(html).window.document;
  const store = { ...(saved || {}) }, logs = [], opened = [], whens = [], views = [], calls = [];
  const d = createDispatcher({ log: (line) => logs.push(line) });
  registerKtx(d, { ktxSearch: (input, options) => { calls.push({ message: { task: 'ktxSearch', input } }); return answer(input, options); } });
  let date = INPUT.date, hour = INPUT.hour;
  const box = createKtxBox({
    doc, actions: d, storage: { get: async (key) => ({ [key]: store[key] }), set: async (values) => Object.assign(store, values) },
    when: () => ({ date, hour }),
    openTab: async (url) => { opened.push(url); if (openTab) return openTab(url); },
    ...(parse ? { parse } : {}),
    setWhen: (w) => { whens.push(w); if (w.date) date = w.date; if (Number.isInteger(w.hour)) hour = w.hour; },
    onView: (v) => views.push(v),
  });
  const $ = (id) => doc.getElementById(id);
  const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new doc.defaultView.Event('change', { bubbles: true })); };
  const choose = (view) => $('carViewControl').querySelector('[data-view="' + view + '"] svg').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  return { calls, box, doc, $, store, d, logs, opened, change, choose, whens, views,
    setDate: (value) => { date = value; }, setHour: (value) => { hour = value; } };
}

test('시간표 조회는 네트워크·브릿지·브라우저 API에 접근하지 않는다', async (t) => {
  const requests = t.mock.method(globalThis, 'fetch', () => { throw new Error('network forbidden'); });
  const api = new Proxy({}, { get: () => { throw new Error('browser API forbidden'); } });
  const stages = [];
  assert.deepEqual(await ktxSearch({ ...INPUT, command: 'ignored' }, { api, timetable: TABLE, onStage: (s) => stages.push(s) }), result());
  assert.equal(requests.mock.callCount(), 0);
  assert.deepEqual(stages, ['시간표 조회 중']);
});

test('잘못된 조건과 시간표 시행일 이전 날짜는 명확히 거부한다', async () => {
  for (const patch of [{ from: '인천' }, { to: '부산' }, { date: '2026-02-30' }, { date: '2026-2-3' }, { hour: 24 }, { hour: '5' }, { adults: 0 }, { adults: 10 }, { adults: NaN }]) {
    const r = await ktxSearch({ ...INPUT, ...patch }, { timetable: TABLE });
    assert.equal(r.ok, false, JSON.stringify(patch));
    assert.equal(r.code, 'INPUT_INVALID');
  }
  assert.equal((await ktxSearch({ ...INPUT, date: '2026-10-31' }, { timetable: TABLE })).code, 'TIMETABLE_DATE');
  assert.deepEqual((await ktxSearch({ ...INPUT, hour: 6 }, { timetable: TABLE })).rows, []);
});

test('코레일 바로가기는 사이드패널이 있는 창의 현재 탭에서 연다', async () => {
  const calls = [];
  const api = { tabs: {
    query: async (query) => { calls.push(['query', query]); return [{ id: 42, url: 'https://eclass.krs.co.kr/' }]; },
    update: async (id, options) => { calls.push(['update', id, options]); },
    create: async () => { throw new Error('Unexpected new tab'); },
  } };
  assert.deepEqual(await ktxOpen({}, { api }), { ok: true });
  assert.deepEqual(calls, [
    ['query', { active: true, currentWindow: true }],
    ['update', 42, { url: KORAIL_SEARCH, active: true }],
  ]);
});

test('현재 탭이 없을 때만 일반 탭을 열고 열기 오류를 알린다', async () => {
  const tabs = [];
  const api = { tabs: { query: async () => [], create: async (options) => tabs.push(options) } };
  assert.deepEqual(await ktxOpen({}, { api }), { ok: true });
  assert.deepEqual(tabs, [{ url: KORAIL_SEARCH, active: true }]);
  const failed = await ktxOpen({}, { api: { tabs: { create: async () => { throw new Error('tab error'); } } } });
  assert.equal(failed.code, 'TAB_OPEN_FAILED');
  assert.match(failed.error, /tab error/);
});

test('패널의 실제 바로가기 기본 경로도 현재 탭을 재사용한다', async (t) => {
  const previous = globalThis.chrome, calls = [];
  globalThis.chrome = { tabs: {
    query: async () => [{ id: 43 }],
    update: async (id, options) => { calls.push([id, options]); },
    create: async () => { throw new Error('Unexpected new tab'); },
  } };
  t.after(() => { globalThis.chrome = previous; });
  const doc = new JSDOM(html).window.document;
  createKtxBox({ doc, storage: null });
  doc.getElementById('ktxSite').click(); await tick();
  assert.deepEqual(calls, [[43, { url: KORAIL_SEARCH, active: true }]]);
});

test('행위 명세는 확인 없는 시간표 조회로 기록한다', async () => {
  const entry = ACTIONS.actions['ktx.search'];
  assert.deepEqual(Object.keys(entry.fields), ['from', 'to', 'date', 'hour', 'adults']);
  assert.deepEqual(entry.fields.from.values, KTX_STATIONS.map(([name]) => name));
  assert.deepEqual([entry.confirm, entry.effect], [false, 'none']);
  assert.match(entry.next, /출발·도착 시각/);
  const f = panel();
  const { record } = f.d.build('ktx.search', { input: INPUT });
  assert.deepEqual(await f.d.run(record), result());
  assert.deepEqual(f.logs.map(({ kind, ok }) => [kind, ok]), [['ktx', true]]);
  assert.match(f.logs[0].text, /부산→서울/);
});

test('패널은 시각·소요 시간·시행일을 표시하며 좌석이나 세션을 요구하지 않는다', async () => {
  const f = panel({ saved: { [PREF_KEY]: { from: '부산', to: '서울', adults: 2 } } });
  await tick();
  f.$('ktxGo').click(); await tick();
  assert.deepEqual(f.calls[0].message.input, { ...INPUT, adults: 2 });
  assert.equal(f.$('ktxList').children.length, 1);
  assert.match(f.$('ktxList').textContent, /05:13.*07:51.*KTX 101.*2시간 38분/);
  assert.doesNotMatch(f.$('ktxList').textContent, /매진|일반실|특실|좌석/);
  assert.match(f.$('ktxNote').textContent, /1편.*2026-11-01 시행 시간표/);
  assert.equal(f.$('ktxContinue'), null);
  assert.equal(f.$('ktxSite').parentElement.className, 'section-heading');
  assert.ok(f.$('ktxSite').compareDocumentPosition(f.$('ktxList')) & 4, '바로가기는 긴 목록보다 위에 있다');
  assert.deepEqual(f.opened, []);
  f.$('ktxSite').click(); await tick();
  assert.deepEqual(f.opened, [KORAIL_SEARCH]);
});

test('코레일 바로가기는 조회 전·빈 결과·조회 실패에도 바로 사용할 수 있다', async () => {
  for (const answer of [() => result([]), () => ({ ok: false, error: '시간표를 읽지 못했습니다' })]) {
    const f = panel({ answer });
    f.$('ktxSite').click(); await tick();
    f.$('ktxGo').click(); await tick();
    f.$('ktxSite').click(); await tick();
    assert.deepEqual(f.opened, [KORAIL_SEARCH, KORAIL_SEARCH]);
    assert.equal(f.$('ktxList').children.length, 0);
  }
});

test('패널의 시간표 글을 HTML로 실행하지 않고 다음 날 도착을 구분한다', async () => {
  const f = panel({ answer: () => result([{ ...ROW, train: '<img src=x onerror=evil()>', took: '<svg onload=evil()>', nextDay: true }]) });
  f.$('ktxGo').click(); await tick();
  assert.equal(f.$('ktxList').querySelector('img,svg,script'), null);
  assert.match(f.$('ktxList').textContent, /<img src=x onerror=evil\(\)>/);
  assert.match(f.$('ktxList').textContent, /다음 날/);
});

test('중복 조회를 막고 조건이 바뀐 동안 도착한 결과를 폐기한다', async () => {
  let finish;
  const f = panel({ answer: () => new Promise((resolve) => { finish = resolve; }) });
  const click = () => f.$('ktxGo').dispatchEvent(new f.doc.defaultView.MouseEvent('click', { bubbles: true }));
  click(); click();
  assert.equal(f.calls.length, 1);
  f.setDate('2026-11-13');
  f.$('date').dispatchEvent(new f.doc.defaultView.Event('change', { bubbles: true }));
  finish(result()); await tick();
  assert.equal(f.$('ktxList').children.length, 0);
  assert.equal(f.$('ktxGo').disabled, false);
  assert.match(f.$('ktxNote').textContent, /이전 결과/);
});

test('날짜·시각·역·인원 변경은 이전 결과를 지운다', async () => {
  const f = panel();
  const search = async () => { f.$('ktxGo').click(); await tick(); assert.equal(f.$('ktxList').children.length, 1); };
  await search(); f.change('ktxPax', '2'); assert.equal(f.$('ktxList').children.length, 0);
  await search(); f.change('ktxTo', '대전'); assert.equal(f.$('ktxList').children.length, 0);
  await search(); f.setHour(8); f.$('hourStart').dispatchEvent(new f.doc.defaultView.Event('input', { bubbles: true }));
  assert.equal(f.$('ktxList').children.length, 0);
  await search(); f.$('nextDay').addEventListener('click', () => f.setDate('2026-11-13')); f.$('nextDay').click();
  assert.equal(f.$('ktxList').children.length, 0);
  await search(); f.$('ktxSwap').click();
  assert.deepEqual([f.$('ktxFrom').value, f.$('ktxTo').value], ['대전', '부산']);
  assert.equal(f.$('ktxList').children.length, 0);
});

test('바로가기 실패를 알리고 중복 열기를 막은 뒤 다시 사용할 수 있다', async () => {
  let finish;
  const f = panel({ openTab: () => new Promise((_, reject) => { finish = () => reject(new Error('탭 오류')); }) });
  const click = () => f.$('ktxSite').dispatchEvent(new f.doc.defaultView.MouseEvent('click'));
  click(); click();
  assert.equal(f.opened.length, 1);
  finish(); await tick();
  assert.match(f.$('ktxNote').textContent, /탭 오류/);
  assert.equal(f.$('ktxSite').disabled, false);
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
