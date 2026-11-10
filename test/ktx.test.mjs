// 시간표 조회와 UI: 네트워크·네이티브 브릿지 없이 조회하고 일반 코레일 탭을 연다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { KTX_STATIONS, KORAIL_SEARCH, ktxSearch, ktxSeats, ktxOpen } from '../src/ktx.js';
import { korailFillPage } from '../src/korailfill.js';
import { createDispatcher } from '../actions/dispatch.js';
import { registerKtx } from '../actions/runners/ktx.js';
import { ACTIONS } from '../actions/spec.js';
import { createKtxBox, PREF_KEY } from '../ktxbox.js';
const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const INPUT = { from: '부산', to: '서울', date: '2026-11-12', hour: 5, adults: 1 };
const ROW = { train: 'KTX', no: '101', date: '2026-11-12', dep: '05:13', arr: '07:51', took: '2시간 38분', nextDay: false };
const TABLE = { basis: '2026-11-01', source: 'https://www.korail.com/official.xlsx', trains: [
  { no: ROW.no, train: ROW.train, days: 127, stops: [['부산', 313], ['서울', 471]] },
] };
const result = (rows = [ROW]) => ({ ok: true, rows, basis: TABLE.basis, source: TABLE.source, url: KORAIL_SEARCH });
function panel({ answer = () => result(), saved, parse, openTab, seats = () => new Promise(() => {}), watch = () => new Promise(() => {}), reserve = async () => ({ ok: true, reserved: true, seat: '일반실', price: '59,800원', note: '일반실 59,800원 좌석을 잡았습니다. 결제는 코레일 탭에서 직접 해 주세요(기한이 지나면 자동 취소).' }) } = {}) {
  const doc = new JSDOM(html).window.document;
  const store = { ...(saved || {}) }, logs = [], opened = [], openInputs = [], openSessions = [], seatCalls = [], whens = [], views = [], calls = [], watchCalls = [], notices = [], reserveCalls = [];
  const d = createDispatcher({ log: (line) => logs.push(line) });
  registerKtx(d, {
    ktxSearch: (input, options) => { calls.push({ message: { task: 'ktxSearch', input } }); return answer(input, options); },
    ktxSeats: (input, options) => { seatCalls.push(input); return seats(input, options); },
    ktxOpen: async (input, options) => {
      opened.push(KORAIL_SEARCH); openInputs.push(input); openSessions.push(options.session);
      return openTab ? openTab(input, options) : { ok: true, filled: true, note: '채웠습니다. 코레일에서 "열차 조회"를 눌러 주세요.' };
    },
    ktxWatch: (input, options) => { watchCalls.push({ input, options }); return watch(input, options); },
    ktxReserve: (input, options) => { reserveCalls.push({ input, options }); return reserve(input, options); },
  });
  let date = INPUT.date, hour = INPUT.hour;
  const box = createKtxBox({
    doc, actions: d, storage: { get: async (key) => ({ [key]: store[key] }), set: async (values) => Object.assign(store, values) },
    when: () => ({ date, hour }),
    ...(parse ? { parse } : {}),
    setWhen: (w) => { whens.push(w); if (w.date) date = w.date; if (Number.isInteger(w.hour)) hour = w.hour; },
    onView: (v) => views.push(v),
    notify: (title, message) => notices.push([title, message]),
  });
  const $ = (id) => doc.getElementById(id);
  const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new doc.defaultView.Event('change', { bubbles: true })); };
  const choose = (view) => $('carViewControl').querySelector('[data-view="' + view + '"] svg').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  return { calls, box, doc, $, store, d, logs, opened, openInputs, openSessions, seatCalls, change, choose, whens, views, watchCalls, notices, reserveCalls,
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
  assert.deepEqual((await ktxSearch({ ...INPUT, hour: 6 }, { timetable: TABLE })).rows, [{ ...ROW, date: '2026-11-13' }], '6시 뒤로는 24시간 안의 다음 날 열차');
});

test('코레일 바로가기는 사이드패널이 있는 창의 현재 탭에서 연다', async () => {
  const calls = [];
  const api = { tabs: {
    query: async (query) => { calls.push(['query', query]); return [{ id: 42, url: 'https://eclass.krs.co.kr/' }]; },
    update: async (id, options) => { calls.push(['update', id, options]); },
    create: async () => { throw new Error('Unexpected new tab'); },
  } };
  assert.deepEqual(await ktxOpen({}, { api }), { ok: true, filled: false });
  assert.deepEqual(calls, [
    ['query', { active: true, currentWindow: true }],
    ['update', 42, { url: KORAIL_SEARCH, active: true }],
  ]);
});

test('현재 탭이 없을 때만 일반 탭을 열고 열기 오류를 알린다', async () => {
  const tabs = [];
  const api = { tabs: { query: async () => [], create: async (options) => tabs.push(options) } };
  assert.deepEqual(await ktxOpen({}, { api }), { ok: true, filled: false });
  assert.deepEqual(tabs, [{ url: KORAIL_SEARCH, active: true }]);
  const failed = await ktxOpen({}, { api: { tabs: { create: async () => { throw new Error('tab error'); } } } });
  assert.equal(failed.code, 'TAB_OPEN_FAILED');
  assert.match(failed.error, /tab error/);
});

console.log('코레일에 조건 채워 두기(2026-11-09 사용자 지정: "조건만 채워두기 해봐") — 열차 조회는 사람이 누른다');

/** 코레일 탭 흉내 — 불러오기 상태를 차례로 돌려주고 executeScript 의 답을 정한다. */
function korailApi({ current = { id: 42, url: 'https://eclass.krs.co.kr/' }, states = [{ status: 'complete', url: KORAIL_SEARCH }], page, fails } = {}) {
  const calls = [];
  let i = 0;
  return { calls, api: {
    tabs: {
      query: async () => [current],
      update: async (id, options) => { calls.push(['update', id, options]); return { id }; },
      get: async () => states[Math.min(i++, states.length - 1)],
    },
    scripting: { executeScript: async (command) => {
      calls.push(['script', command]);
      if (fails) throw new Error(fails);
      return [{ result: page }];
    } },
  } };
}
const FILLED = { form: true, missing: [], shown: { date: '2026-11-12(목) 05:00', people: '총 1명' } };
const noWait = async () => {};

test('바로가기는 화면이 다 열린 뒤 조건을 넘겨 채우고 열차 조회는 사람에게 남긴다', async () => {
  // 앞 문서가 아직 complete 인 때와 불러오는 중에는 채우지 않는다.
  const f = korailApi({ page: FILLED, states: [{ status: 'complete', url: 'https://eclass.krs.co.kr/' }, { status: 'loading', url: KORAIL_SEARCH }, { status: 'complete', url: KORAIL_SEARCH, pendingUrl: 'x' }, { status: 'complete', url: KORAIL_SEARCH }] });
  const stages = [];
  const r = await ktxOpen({ ...INPUT, command: 'ignored' }, { api: f.api, wait: noWait, onStage: (s) => stages.push(s) });
  assert.deepEqual(f.calls.map(([kind]) => kind), ['update', 'script']);
  const { target, world, func, args } = f.calls[1][1];
  assert.deepEqual([target, world, func, args], [{ tabId: 42 }, 'MAIN', korailFillPage, [INPUT]], '확인한 조건만 넘긴다');
  assert.deepEqual([r.ok, r.filled], [true, true]);
  assert.match(r.note, /부산→서울 11\/12 1명을 채웠습니다.*"열차 조회"를 눌러/);
  assert.equal(stages.length, 1);
});

test('현재 탭이 이미 예매 화면이면 다시 불러오지 않고 그 화면에 채운다', async () => {
  const f = korailApi({ page: FILLED, current: { id: 7, url: KORAIL_SEARCH } });
  assert.equal((await ktxOpen(INPUT, { api: f.api, wait: noWait })).ok, true);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['script']);
  assert.deepEqual(f.calls[0][1].target, { tabId: 7 });
});

test('코레일이 받지 않은 시각은 알리되 실패로 치지 않는다', async () => {
  const f = korailApi({ page: { ...FILLED, shown: { date: '2026-11-12(목) 15:00', people: '총 1명' } } });
  const r = await ktxOpen(INPUT, { api: f.api, wait: noWait });
  assert.equal(r.ok, true);
  assert.match(r.note, /5시는 코레일에서 고를 수 없어 15시로 두었습니다/);
});

test('못 채운 칸·코레일 안내·권한 없음·화면 안 열림은 실패로 까닭을 알린다', async () => {
  const cases = [
    [{ page: { ...FILLED, missing: ['출발일', '인원'] } }, 'FILL_PARTIAL', /출발일·인원을\(를\) 채우지 못했습니다/],
    [{ page: { ...FILLED, guard: '-8002 비정상적인 접속', missing: ['출발역'] } }, 'GUARD_NOTICE', /-8002/],
    [{ page: { form: false, missing: [], shown: {} } }, 'FORM_NOT_FOUND', /입력 칸을 찾지 못했습니다/],
    [{ fails: 'Cannot access contents of the url' }, 'NO_PERMISSION', /다시 불러와/],
    [{ fails: 'Frame removed' }, 'FILL_FAILED', /Frame removed/],
    [{ page: FILLED, states: [{ status: 'loading', url: KORAIL_SEARCH }] }, 'FORM_NOT_LOADED', /열리지 않아/],
  ];
  for (const [options, code, message] of cases) {
    const r = await ktxOpen(INPUT, { api: korailApi(options).api, wait: noWait });
    assert.deepEqual([r.ok, r.code], [false, code]);
    assert.match(r.error, message);
  }
});

test('출발역과 도착역이 같으면 화면만 열고 채우지 않는다', async () => {
  const f = korailApi({ page: FILLED });
  const r = await ktxOpen({ ...INPUT, to: '부산' }, { api: f.api, wait: noWait });
  assert.deepEqual([r.ok, r.code], [false, 'INPUT_INVALID']);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['update']);
});

test('행위 명세 ktx.open — 확인 없는 초안이고 말로 채우지 않으며 매니페스트가 코레일 권한을 갖는다', () => {
  const entry = ACTIONS.actions['ktx.open'];
  assert.deepEqual(Object.keys(entry.fields), ['from', 'to', 'date', 'hour', 'adults']);
  assert.deepEqual(entry.fields.to.values, KTX_STATIONS.map(([name]) => name));
  assert.deepEqual([entry.confirm, entry.effect, entry.llm], [false, 'draft', false]);
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.host_permissions.includes('https://www.korail.com/*'));
});

/** 코레일 예매 화면 흉내 — 역·날짜·인원 팝업이 눌러야 뜨고 입력 칸은 읽기 전용이다. 열차 조회가 눌리면 센다. */
function korailDom() {
  const dom = new JSDOM(`<body>
    <div class="selectAreaWrap">
      <div class="start"><input name="txtGoStart" value="서울" readonly><a class="btn_pop-open" href="#none"></a></div>
      <div class="end"><input name="txtGoEnd" value="부산" readonly><a class="btn_pop-open" href="#none"></a></div>
    </div>
    <input id="startDate" value="2026-11-09(월) 15:00" readonly><a class="btn_pop btn_d-day" href="#none"></a>
    <a class="data btn_pop" href="#none">총 1명</a>
    <button class="btn_lookup">열차 조회</button>
    <div class="ReactModalPortal"><div id="notice"><a href="#none">1일간 그만보기</a><button>창닫기</button></div></div></body>`, { pretendToBeVisual: true });
  const doc = dom.window.document;
  const q = (s, root = doc) => root.querySelector(s);
  const portal = q('.ReactModalPortal');
  const counts = { lookup: 0, snooze: 0 };
  const pop = (html) => { portal.insertAdjacentHTML('beforeend', html); return portal.lastElementChild; };
  q('#notice button').addEventListener('click', () => q('#notice').remove());
  q('#notice a').addEventListener('click', () => { counts.snooze++; });
  q('.btn_lookup').addEventListener('click', () => { counts.lookup++; });
  for (const [slot, name] of [['start', 'txtGoStart'], ['end', 'txtGoEnd']]) {
    q(`.${slot} a`).addEventListener('click', () => {
      const p = pop(`<div class="layerWrap type_tranin-station-pop_wrap"><button class="btn_close"></button><input name="searchTxt">
        <div class="found"></div><span class="ch_tag"><a href="#none">서울</a></span><span class="ch_tag"><a href="#none">부산</a></span><span class="ch_tag"><a href="#none">대전</a></span></div>`);
      const choose = (e) => {
        if (e.target.closest('a')) { q(`input[name=${name}]`).value = e.target.closest('a').textContent.trim(); p.remove(); }
      };
      p.addEventListener('click', choose);
      q('input', p).addEventListener('input', (e) => { q('.found', p).innerHTML = `<a href="#none"><span class="txt_sky">${e.target.value}</span></a>`; });
      q('.btn_close', p).addEventListener('click', () => p.remove());
    });
  }
  q('.btn_d-day').addEventListener('click', () => {
    const cells = Array.from({ length: 30 }, (_, i) => `<td class="${i + 1 < 9 ? 'disabled' : ''}"><a href="#none" aria-disabled="${i + 1 < 9}"><span class="day">${i + 1}</span></a></td>`).join('');
    const hours = Array.from({ length: 24 }, (_, h) => `<div class="slick-slide"><a href="#none" aria-disabled="${h < 15}">${String(h).padStart(2, '0')}시</a></div>`).join('');
    const p = pop(`<div class="layerWrap type_date-pop_wrap">
      <div class="datepk_wrap"><div class="slick-slide slick-active"><div class="datepicker"><p class="date">2026. 11.</p><table><tbody><tr>${cells}</tr></tbody></table></div></div></div>
      <div class="timeSelect">${hours}</div><div class="btn_wrap"><button class="btn_pop-close">취소</button><button class="btn_bn-blue">적용</button></div></div>`);
    let day = 9, hour = 15;
    q('.datepk_wrap', p).addEventListener('click', (e) => { day = +e.target.closest('td').textContent; });
    q('.timeSelect', p).addEventListener('click', (e) => { const a = e.target.closest('a'); if (a.getAttribute('aria-disabled') !== 'true') hour = parseInt(a.textContent, 10); });
    q('.btn_pop-close', p).addEventListener('click', () => p.remove());
    q('.btn_bn-blue', p).addEventListener('click', () => {
      q('#startDate').value = `2026-11-${String(day).padStart(2, '0')}(목) ${String(hour).padStart(2, '0')}:00`;
      p.remove();
    });
  });
  q('.data.btn_pop').addEventListener('click', () => {
    const row = (label, n) => `<li><p>${label}</p><div class="flo_right"><button class="down_num"></button><span>${n}</span><button class="up_num"></button></div></li>`;
    const p = pop(`<div class="layerWrap personnel_pop_wrap"><div class="ticketInfo_bottom"><ul>${row('어른(13세 이상)', 1)}${row('어린이(6 ~ 12세)', 0)}</ul></div>
      <div class="btnWrap"><button class="btn_pop-close">취소</button><button class="btn_bn-blue">적용</button></div></div>`);
    for (const li of p.querySelectorAll('li')) {
      const span = q('span', li);
      q('.up_num', li).addEventListener('click', () => { span.textContent = +span.textContent + 1; });
      q('.down_num', li).addEventListener('click', () => { span.textContent = +span.textContent - 1; });
    }
    q('.btn_pop-close', p).addEventListener('click', () => p.remove());
    q('.btn_bn-blue', p).addEventListener('click', () => {
      q('.data.btn_pop').textContent = `총 ${[...p.querySelectorAll('li span')].reduce((sum, s) => sum + +s.textContent, 0)}명`;
      p.remove();
    });
  });
  return { dom, doc, counts };
}

async function fillIn(t, query, prepare) {
  const page = korailDom();
  const saved = { document: globalThis.document, HTMLInputElement: globalThis.HTMLInputElement, Event: globalThis.Event, Element: globalThis.Element };
  Object.assign(globalThis, { document: page.doc, HTMLInputElement: page.dom.window.HTMLInputElement, Event: page.dom.window.Event, Element: page.dom.window.Element });
  t.after(() => Object.assign(globalThis, saved));
  prepare?.(page);
  return { ...page, answer: await korailFillPage(query) };
}

test('채우는 함수는 역(검색 포함)·날짜·시각·인원을 팝업으로 고르고 공지만 닫으며 열차 조회는 누르지 않는다', async (t) => {
  const { doc, counts, answer } = await fillIn(t, { from: '서대구', to: '서울', date: '2026-11-20', hour: 18, adults: 3 });
  assert.deepEqual(answer.missing, []);
  assert.equal(answer.form, true);
  assert.deepEqual([doc.querySelector('[name=txtGoStart]').value, doc.querySelector('[name=txtGoEnd]').value], ['서대구', '서울']);
  assert.equal(doc.querySelector('#startDate').value, '2026-11-20(목) 18:00');
  assert.equal(doc.querySelector('.data.btn_pop').textContent, '총 3명');
  assert.equal(doc.querySelector('.layerWrap'), null, '팝업을 남기지 않는다');
  assert.equal(doc.querySelector('#notice'), null, '공지는 닫는다');
  assert.deepEqual(counts, { lookup: 0, snooze: 0 }, '열차 조회·그만보기를 누르지 않는다');
  assert.doesNotMatch(korailFillPage.toString(), /btn_lookup/);
});

test('채우는 함수는 고를 수 없는 날을 못 채운 칸으로 돌려주고 지난 시각은 코레일 값으로 둔다', async (t) => {
  const past = await fillIn(t, { from: '서울', to: '부산', date: '2026-11-03', hour: 9, adults: 1 });
  assert.deepEqual(past.answer.missing, ['출발일']);
  assert.equal(past.doc.querySelector('.layerWrap'), null);
  const hour = await fillIn(t, { from: '서울', to: '부산', date: '2026-11-12', hour: 8, adults: 1 });
  assert.deepEqual(hour.answer.missing, []);
  assert.equal(hour.doc.querySelector('#startDate').value, '2026-11-12(목) 15:00');
});

test('채우는 함수는 코레일 차단 안내가 떠 있으면 건드리지 않고 멈춘다', async (t) => {
  const { doc, counts, answer } = await fillIn(t, { from: '부산', to: '서울', date: '2026-11-12', hour: 9, adults: 1 }, ({ doc: d }) => {
    Object.defineProperty(d.querySelector('.ReactModalPortal'), 'innerText', { get: () => '안내 -8002 비정상적인 접속입니다' });
  });
  assert.match(answer.guard, /-8002/);
  assert.equal(doc.querySelector('[name=txtGoStart]').value, '서울', '멈추면 채우지 않는다');
  assert.ok(doc.querySelector('#notice'), '안내를 닫지 않는다');
  assert.equal(counts.lookup, 0);
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

test('패널은 시각·소요 시간·시행일을 곧바로 표시하고 좌석은 뒤이어 읽는다', async () => {
  const f = panel({ saved: { [PREF_KEY]: { from: '부산', to: '서울', adults: 2 } } });
  await tick();
  f.$('ktxGo').click(); await tick();
  assert.deepEqual(f.calls[0].message.input, { ...INPUT, adults: 2 });
  assert.equal(f.$('ktxList').children.length, 1);
  assert.match(f.$('ktxList').textContent, /05:13.*07:51.*KTX 101.*2시간 38분/);
  assert.match(f.$('ktxList').textContent, /좌석 확인 중/, '시간표는 좌석을 기다리지 않는다');
  assert.deepEqual(f.seatCalls, [{ ...INPUT, adults: 2 }]);
  assert.match(f.$('ktxNote').textContent, /1편.*2026-11-01 시행 시간표/);
  assert.equal(f.$('ktxSite'), null, '머리의 코레일 바로가기는 없다');
  assert.deepEqual(f.opened, []);
  f.$('ktxList').querySelector('.ktx-go').click(); await tick();
  assert.deepEqual(f.opened, [KORAIL_SEARCH]);
});

console.log('좌석 상태와 줄 누르기(2026-11-09 사용자 지정: "코레일 바로 가기 말고.. 현재 좌석정보랑 누르면 코에릴 예매정보로 가야지")');

const SESSION = 'a'.repeat(32);
const GEN = { price: '59,800원', soldOut: false, soon: true };
const seated = (rows, session = SESSION) => () => ({ ok: true, rows, session });

test('좌석은 열차 번호로 줄에 얹고 첫 화면 밖의 줄은 비워 두며 시간표에 없는 열차는 더한다', async () => {
  const later = { ...ROW, no: '103', dep: '06:00', arr: '08:40' };
  const f = panel({
    answer: () => result([ROW, later]),
    seats: seated([{ ...ROW, no: '0101', gen: GEN, spec: { price: '', soldOut: true, soon: false } }, { train: 'KTX-청룡', no: '900', dep: '05:30', arr: '07:50', took: '', gen: { price: '70,000원', soldOut: false, soon: false }, spec: null }]),
  });
  f.$('ktxGo').click(); await tick(); await tick();
  const rows = [...f.$('ktxList').children].map((li) => li.textContent);
  assert.equal(rows.length, 3);
  assert.match(rows[0], /KTX 101.*일반실.*59,800원.*매진임박.*특실.*매진/);
  assert.match(rows[1], /KTX-청룡 900.*70,000원/);
  assert.doesNotMatch(rows[2], /일반실|좌석/);
  assert.match(f.$('ktxSeatNote').textContent, /2편까지 좌석을 읽었습니다/);
  assert.deepEqual(f.logs.map(({ ok }) => ok), [true, true], '시간표·좌석이 각각 활동 로그에 남는다');
});

test('값이 없고 매진도 아닌 좌석은 코레일이 적은 말을 그대로 보인다', async () => {
  const f = panel({ seats: seated([{ ...ROW, gen: { price: '', soldOut: false, soon: false, note: '입석 + 좌석 예약대기' }, spec: { price: '', soldOut: false, soon: false, note: '' } }]) });
  f.$('ktxGo').click(); await tick(); await tick();
  const text = f.$('ktxList').textContent;
  assert.match(text, /일반실입석 \+ 좌석 예약대기/);
  assert.match(text, /특실상태 확인 필요/);
});

test('좌석을 읽지 못해도 시간표는 남고 까닭을 알리며 줄은 누를 수 있다', async () => {
  const f = panel({ seats: () => ({ ok: false, error: '코레일 조회가 제한되었습니다 (-8002).', code: 'GUARD_BLOCKED' }) });
  f.$('ktxGo').click(); await tick(); await tick();
  assert.equal(f.$('ktxList').children.length, 1);
  assert.match(f.$('ktxSeatNote').textContent, /좌석을 읽지 못했습니다.*-8002/);
  assert.equal(f.$('ktxSeatNote').classList.contains('bad'), true);
  f.$('ktxList').querySelector('.ktx-go').click(); await tick();
  assert.deepEqual(f.openSessions, [null], '결과 창이 없으면 손잡이 없이 넘어간다');
});

test('줄을 누르면 좌석 조회가 연 결과 창의 손잡이로 ktx.open 을 돌리고 손잡이는 기록에 넣지 않는다', async () => {
  const f = panel({ seats: seated([{ ...ROW, gen: GEN, spec: null }]) });
  f.$('ktxGo').click(); await tick(); await tick();
  f.$('ktxList').querySelector('.ktx-go').click(); await tick();
  assert.deepEqual(f.openInputs, [INPUT]);
  assert.deepEqual(f.openSessions, [SESSION]);
  const last = f.logs.at(-1);
  assert.equal(last.kind, 'ktx');
  assert.doesNotMatch(JSON.stringify(last.data.record), new RegExp(SESSION));
  assert.match(f.$('ktxNote').textContent, /채웠습니다/);
  const failed = panel({ openTab: async () => ({ ok: false, error: '출발일을(를) 채우지 못했습니다' }) });
  failed.$('ktxGo').click(); await tick();
  failed.$('ktxList').querySelector('.ktx-go').click(); await tick();
  assert.match(failed.$('ktxNote').textContent, /출발일/);
  assert.equal(failed.$('ktxNote').classList.contains('bad'), true);
});

test('24시간 조회 — 다음 날 열차는 날짜를 붙이고 좌석을 얹지 않으며, 누르면 그 날짜·출발 시로 조건을 채운다', async () => {
  const tomorrow = { ...ROW, date: '2026-11-13', dep: '04:50', arr: '07:30' };
  const f = panel({
    answer: () => result([ROW, tomorrow]),
    seats: seated([{ ...ROW, gen: GEN, spec: null }]),
  });
  f.$('ktxGo').click(); await tick(); await tick();
  const [today, next] = [...f.$('ktxList').children];
  assert.equal(today.querySelector('.ktx-day'), null, '고른 날의 열차는 날짜를 붙이지 않는다');
  assert.match(today.textContent, /59,800원/);
  assert.equal(next.querySelector('.ktx-day').textContent, '11/13(금)');
  assert.doesNotMatch(next.textContent, /일반실/, '같은 열차 번호라도 다음 날 줄에는 좌석을 얹지 않는다');
  next.querySelector('.ktx-go').click(); await tick();
  assert.deepEqual(f.openInputs, [{ ...INPUT, date: '2026-11-13', hour: 4 }]);
  assert.deepEqual(f.openSessions, [null], '좌석을 읽은 결과 창은 조회한 날짜라 쓰지 않는다');
});

test('코레일에서 읽은 줄을 더해도 10편까지만 보인다', async () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ ...ROW, no: String(201 + i), dep: `06:${String(10 + i).padStart(2, '0')}` }));
  const f = panel({
    answer: () => result(many),
    seats: seated([{ train: 'KTX-청룡', no: '900', dep: '05:30', arr: '07:50', took: '', gen: GEN, spec: null }]),
  });
  f.$('ktxGo').click(); await tick(); await tick();
  const rows = [...f.$('ktxList').children].map((li) => li.textContent);
  assert.equal(rows.length, 10);
  assert.match(rows[0], /KTX-청룡 900/);
  assert.doesNotMatch(rows.join('|'), /KTX 210/, '출발이 가장 늦은 줄이 밀려난다');
});

test('조건이 바뀌면 늦게 온 좌석과 결과 창 손잡이를 버린다', async () => {
  let finish;
  const f = panel({ seats: () => new Promise((resolve) => { finish = resolve; }) });
  f.$('ktxGo').click(); await tick();
  f.change('ktxPax', '2');
  finish({ ok: true, rows: [{ ...ROW, gen: GEN, spec: null }], session: SESSION }); await tick();
  assert.equal(f.$('ktxList').children.length, 0);
  assert.equal(f.$('ktxSeatNote').textContent, '');
});

test('ktxSeats 는 조건만 브릿지로 보내고 응답 형식을 검사하며 까닭을 고쳐 말한다', async () => {
  const api = (answer) => { const sent = []; return { sent, runtime: { sendNativeMessage: async (host, message) => { sent.push([host, message]); return answer; } } }; };
  const good = api({ ok: true, rows: [{ ...ROW, gen: GEN, spec: null }], session: SESSION });
  const r = await ktxSeats({ ...INPUT, command: 'ignored' }, { api: good });
  assert.deepEqual(good.sent, [['com.krs.meetingroom', { task: 'ktxSearch', input: INPUT }]]);
  assert.deepEqual([r.ok, r.session, r.rows[0].gen], [true, SESSION, { ...GEN, note: '' }]);
  assert.equal((await ktxSeats({ ...INPUT, to: '부산' }, { api: good })).code, 'INPUT_INVALID');
  assert.equal((await ktxSeats(INPUT, { api: api({ ok: true, rows: [], session: '../x' }) })).code, 'BRIDGE_RESPONSE');
  assert.equal((await ktxSeats(INPUT, { api: api({ ok: true, rows: [{ ...ROW, dep: '<b>' }], session: SESSION }) })).code, 'BRIDGE_RESPONSE');
  assert.match((await ktxSeats(INPUT, { api: api({ ok: false, code: 'RUNTIME_MISSING', error: 'x' }) })).error, /setup-ktx/);
  assert.equal((await ktxSeats(INPUT, { api: {} })).code, 'BRIDGE_UNAVAILABLE');
  const thrown = await ktxSeats(INPUT, { api: { runtime: { sendNativeMessage: async () => { throw new Error('Specified native messaging host not found.'); } } } });
  assert.deepEqual([thrown.code, /not found/.test(thrown.error)], ['BRIDGE_UNAVAILABLE', true]);
  const late = await ktxSeats(INPUT, { api: { runtime: { sendNativeMessage: () => new Promise(() => {}) } }, timeoutMs: 5 });
  assert.equal(late.code, 'BRIDGE_TIMEOUT');
});

test('ktxOpen 은 결과 창이 있으면 앞으로 가져오고 닫혔으면 현재 탭에 조건을 채운다', async () => {
  const sent = [];
  const shown = korailApi({ page: FILLED });
  shown.api.runtime = { sendNativeMessage: async (host, message) => { sent.push(message); return { ok: true }; } };
  const r = await ktxOpen(INPUT, { api: shown.api, wait: noWait, session: SESSION });
  assert.deepEqual(sent, [{ task: 'ktxOpen', session: SESSION }]);
  assert.deepEqual([r.ok, r.shown, shown.calls.length], [true, true, 0], '현재 탭을 건드리지 않는다');
  assert.match(r.note, /앞으로 가져왔습니다/);
  const closed = korailApi({ page: FILLED });
  closed.api.runtime = { sendNativeMessage: async () => ({ ok: false, code: 'SESSION_CLOSED', error: '조회 창이 닫혔습니다.' }) };
  const fallback = await ktxOpen(INPUT, { api: closed.api, wait: noWait, session: SESSION });
  assert.deepEqual([fallback.ok, fallback.filled], [true, true]);
  assert.deepEqual(closed.calls.map(([kind]) => kind), ['update', 'script']);
  const odd = korailApi({ page: FILLED });
  odd.api.runtime = { sendNativeMessage: async () => { throw new Error('호출되면 안 됩니다'); } };
  assert.equal((await ktxOpen(INPUT, { api: odd.api, wait: noWait, session: '../x' })).filled, true, '이상한 손잡이는 보내지 않는다');
});

test('줄의 시간표 글과 좌석 글을 HTML로 실행하지 않는다', async () => {
  const f = panel({ seats: seated([{ ...ROW, gen: { price: '<img src=x onerror=evil()>', soldOut: false, soon: false }, spec: null }]) });
  f.$('ktxGo').click(); await tick(); await tick();
  assert.equal(f.$('ktxList').querySelector('img,script'), null);
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

test('줄 누르기 실패를 알리고 중복 열기를 막은 뒤 다시 사용할 수 있다', async () => {
  let finish;
  const f = panel({ openTab: () => new Promise((_, reject) => { finish = () => reject(new Error('탭 오류')); }) });
  f.$('ktxGo').click(); await tick();
  const button = () => f.$('ktxList').querySelector('.ktx-go');
  const click = () => button().dispatchEvent(new f.doc.defaultView.MouseEvent('click', { bubbles: true }));
  click();
  assert.equal(button().disabled, true);
  click();
  assert.equal(f.opened.length, 1);
  finish(); await tick();
  assert.match(f.$('ktxNote').textContent, /탭 오류/);
  assert.equal(button().disabled, false);
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
  assert.deepEqual(f.store[PREF_KEY], { from: '부산', to: '대전', adults: 2, reserve: false });
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

console.log('빈자리 대기(2026-11-10 사용자 지정: "한번에 3개 까지. 예약대기가 안되는 경우만 할거야. 간격은 5초, 1시간 지나면 정지 … 알림만. 패널이 열린경우만")');

const SOLD = { price: '', soldOut: true, soon: false, note: '' };
const FREE = { price: '59,800원', soldOut: false, soon: false, note: '' };
const train = (no, dep, gen = SOLD, spec = SOLD) => ({ ...ROW, no, dep, arr: '09:00', gen, spec });
const FIVE = [train('101', '05:13'), train('103', '05:30'), train('105', '05:40'), train('107', '05:50'),
  train('109', '06:00', { ...SOLD, wait: true }), train('111', '06:10', FREE), train('113', '06:20', { price: '', soldOut: false, soon: false, note: '입석 + 좌석' })];
const sold = (options = {}) => panel({ answer: () => result(FIVE.map(({ gen, spec, ...row }) => row)), seats: () => ({ ok: true, rows: FIVE, tabId: 9 }), ...options });
const pills = (f) => [...f.$('ktxList').querySelectorAll('.ktx-watch')];

test('빈자리 대기 단추는 자리가 없고 예약대기도 안 되는 줄에만 서고, 좌석을 읽기 전에는 없다', async () => {
  const waiting = sold({ seats: () => new Promise(() => {}) });
  waiting.$('ktxGo').click(); await tick(); await tick();
  assert.equal(pills(waiting).length, 0, '좌석을 읽기 전');
  const f = sold();
  f.$('ktxGo').click(); await tick(); await tick();
  assert.deepEqual(pills(f).map((b) => [b.dataset.no, b.textContent, b.getAttribute('aria-pressed')]),
    [['101', '빈자리 대기', 'false'], ['103', '빈자리 대기', 'false'], ['105', '빈자리 대기', 'false'], ['107', '빈자리 대기', 'false'], ['113', '빈자리 대기', 'false']],
    '예약대기가 되는 109 와 자리가 있는 111 에는 없다');
  assert.deepEqual(f.opened, [], '대기 단추는 줄 누르기(코레일로)가 아니다');
});

test('대기를 누르면 그 열차로 ktx.watch 를 돌리고(결과 탭·멈춤 신호는 ctx) 읽을 때마다 좌석을 고쳐 얹으며 자리가 나면 알리기만 한다', async () => {
  let finish;
  const f = sold({ watch: () => new Promise((resolve) => { finish = resolve; }) });
  f.$('ktxGo').click(); await tick(); await tick();
  pills(f)[0].click(); await tick();
  const { input, options } = f.watchCalls[0];
  assert.deepEqual(input, { ...INPUT, train: '101' });
  assert.deepEqual([options.tabId, options.signal.aborted, typeof options.onTick], [9, false, 'function']);
  assert.deepEqual(pills(f).map((b) => b.textContent)[0], '대기 중');
  assert.match(f.$('ktxSeatNote').textContent, /KTX 101 05:13 빈자리 대기 시작.*5초/);
  options.onTick({ rows: [train('103', '05:30', FREE)], count: 2, tabId: 9 });
  assert.match(f.$('ktxSeatNote').textContent, /빈자리 대기 1편 · 2번째 확인/);
  assert.match(f.$('ktxList').children[1].textContent, /59,800원/, '함께 읽은 다른 줄도 새로 얹는다');
  options.onTick({ paused: true, count: 2, tabId: 9 });
  assert.match(f.$('ktxSeatNote').textContent, /보고 있는 동안은 쉽니다/);
  const found = train('101', '05:13', SOLD, { ...FREE, price: '83,700원' });
  finish({ ok: true, found: true, row: found, rows: [found], tabId: 9, count: 3 }); await tick();
  assert.match(f.$('ktxSeatNote').textContent, /KTX 101 05:13 빈자리가 났습니다 — 특실 83,700원.*줄을 눌러/);
  assert.deepEqual(f.notices, [['KTX 빈자리 — KTX 101 05:13', '부산→서울 11/12 05시~ 특실 83,700원']]);
  assert.equal(f.$('ktxList').children[0].classList.contains('found'), true);
  assert.equal(pills(f).some((b) => b.dataset.no === '101'), false, '자리가 난 줄에는 대기 단추가 없다');
  assert.deepEqual(f.opened, [], '코레일로 넘어가지 않는다 — 알리기만 한다');
  const last = f.logs.at(-1);
  assert.deepEqual([last.kind, last.ok, /빈자리 대기 101/.test(last.text)], ['ktx', true, true]);
  assert.doesNotMatch(JSON.stringify(last.data.record), /signal|tabId/);
});

test('한 번에 3편까지이고, 다시 누르면 그 열차만 멈추며, 조건이 바뀌거나 다시 조회하면 모두 멈춘다', async () => {
  const f = sold({ watch: (input, { signal }) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: true, found: false, stopped: true, note: '빈자리 대기를 멈췄습니다.' }))) });
  f.$('ktxGo').click(); await tick(); await tick();
  for (let i = 0; i < 4; i++) { pills(f)[i].click(); await tick(); }
  assert.equal(f.watchCalls.length, 3);
  assert.match(f.$('ktxSeatNote').textContent, /한 번에 3편까지/);
  assert.equal(f.$('ktxSeatNote').classList.contains('bad'), true);
  pills(f)[1].click(); await tick(); await tick();
  assert.deepEqual(f.watchCalls.map((c) => c.options.signal.aborted), [false, true, false]);
  assert.match(f.$('ktxSeatNote').textContent, /KTX 103 05:30 — 빈자리 대기를 멈췄습니다/);
  assert.deepEqual(pills(f).map((b) => b.getAttribute('aria-pressed')), ['true', 'false', 'true', 'false', 'false']);
  f.change('ktxPax', '2'); await tick();
  assert.deepEqual(f.watchCalls.map((c) => c.options.signal.aborted), [true, true, true]);
  assert.equal(f.$('ktxList').children.length, 0);
});

test('대기가 막히면(차단 안내 등) 까닭을 알리고 단추를 되돌린다', async () => {
  const f = sold({ watch: async () => ({ ok: false, code: 'GUARD_BLOCKED', error: '코레일 조회가 제한되었습니다 (-8002).' }) });
  f.$('ktxGo').click(); await tick(); await tick();
  pills(f)[0].click(); await tick(); await tick();
  assert.match(f.$('ktxSeatNote').textContent, /KTX 101 05:13 빈자리 대기를 멈췄습니다 — .*-8002/);
  assert.equal(f.$('ktxSeatNote').classList.contains('bad'), true);
  assert.equal(pills(f)[0].getAttribute('aria-pressed'), 'false');
  assert.deepEqual(f.notices, []);
});

test('행위 명세 ktx.watch — 확인 없는 조회이고 말로 채우지 않으며 열차 번호가 기록에 든다', () => {
  const entry = ACTIONS.actions['ktx.watch'];
  assert.deepEqual(Object.keys(entry.fields), ['from', 'to', 'date', 'hour', 'adults', 'train']);
  assert.deepEqual([entry.confirm, entry.effect, entry.llm, entry.runner], [false, 'none', false, 'ktx.watch']);
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.permissions.includes('notifications'));
});

test('자리가 나면 예약까지 — 켠 채 누르면 대기가 자리를 찾았을 때 그 결과 탭으로 ktx.reserve 를 돌리고(확인은 그 누름) 잡았다고 알린다', async () => {
  const f = sold({ watch: async (input, options) => {
    const reserve = await options.onFound({ row: { ...FIVE[0], gen: FREE }, tabId: 9 });
    return { ok: true, found: true, row: { ...FIVE[0], gen: FREE }, tabId: 9, reserve };
  } });
  assert.equal(f.$('ktxReserve').checked, false, '기본은 꺼짐');
  f.$('ktxReserve').click(); await tick();
  assert.equal(f.store[PREF_KEY].reserve, true, '고른 값을 기억한다');
  f.$('ktxGo').click(); await tick(); await tick();
  pills(f)[0].click(); await tick(); await tick(); await tick();
  assert.equal(f.reserveCalls.length, 1);
  assert.deepEqual(f.reserveCalls[0].input, { ...INPUT, train: '101', dep: '05:13', seat: 'any' });
  assert.equal(f.reserveCalls[0].options.tabId, 9);
  const logged = f.logs.find((line) => line.data?.record?.action === 'ktx.reserve');
  assert.ok(logged?.ok, '예약은 활동 로그에 따로 한 줄');
  assert.doesNotMatch(JSON.stringify(logged.data.record), /tabId/);
  assert.match(f.$('ktxSeatNote').textContent, /좌석을 잡았습니다.*결제는 코레일 탭에서 직접/);
  assert.match(f.notices.at(-1)[0], /KTX 좌석 예약/);
});

test('자리가 나면 예약까지 — 끈 채 누르면 예약하지 않고, 예약을 못 하면 그 까닭과 함께 직접 예매하라고 알린다', async () => {
  const off = sold({ watch: async (input, options) => ({ ok: true, found: true, row: { ...FIVE[0], gen: FREE }, hasFound: typeof options.onFound }) });
  off.$('ktxGo').click(); await tick(); await tick();
  pills(off)[0].click(); await tick(); await tick();
  assert.deepEqual([off.watchCalls[0].options.onFound, off.reserveCalls.length], [undefined, 0]);
  assert.match(off.$('ktxSeatNote').textContent, /빈자리가 났습니다.*줄을 눌러 코레일에서 예매/);
  const missed = sold({
    saved: { [PREF_KEY]: { from: '부산', to: '서울', adults: 1, reserve: true } },
    reserve: async () => ({ ok: false, error: '코레일 로그인 화면이 나와 예약하지 못했습니다.', code: 'RESERVE_LOGIN' }),
    watch: async (input, options) => ({ ok: true, found: true, row: { ...FIVE[0], gen: FREE }, reserve: await options.onFound({ row: FIVE[0], tabId: 9 }) }),
  });
  await tick();
  assert.equal(missed.$('ktxReserve').checked, true, '기억한 값을 다시 켠다');
  missed.$('ktxGo').click(); await tick(); await tick();
  pills(missed)[0].click(); await tick(); await tick(); await tick();
  assert.match(missed.$('ktxSeatNote').textContent, /빈자리가 났습니다.*예약하지 못했습니다 — 코레일 로그인 화면.*직접|줄을 눌러/);
  assert.equal(missed.$('ktxSeatNote').classList.contains('bad'), true);
});

test('예약 단추 — "예약까지"를 켜면 자리가 있는 줄에만 서고, 누르면 그 결과 탭으로 ktx.reserve 를 바로 돌린다(그 누름이 확인)', async () => {
  const off = sold();
  off.$('ktxGo').click(); await tick(); await tick();
  assert.equal(off.$('ktxList').querySelectorAll('.ktx-book').length, 0, '끈 채로는 없다');
  const f = sold();
  f.$('ktxReserve').click(); await tick();
  f.$('ktxGo').click(); await tick(); await tick();
  const books = [...f.$('ktxList').querySelectorAll('.ktx-book')];
  assert.equal(books.length, 1);
  assert.match(books[0].closest('li').textContent, /KTX 111/);
  books[0].click(); await tick(); await tick(); await tick();
  assert.deepEqual(f.reserveCalls.map((c) => [c.input, c.options.tabId]), [[{ ...INPUT, train: '111', dep: '06:10', seat: 'any' }, 9]]);
  assert.match(f.$('ktxSeatNote').textContent, /KTX 111 06:10 — .*좌석을 잡았습니다/);
  assert.match(f.notices.at(-1)[0], /KTX 좌석 예약/);
  assert.ok(f.logs.some((line) => line.data?.record?.action === 'ktx.reserve' && line.ok));
});

test('예약 단추 — 빈자리 대기가 같은 탭을 읽는 동안은 예약하지 않고, 못 잡으면 까닭을 알린다', async () => {
  const f = sold({
    reserve: async () => ({ ok: false, error: '코레일 로그인 화면이 나와 예약하지 못했습니다.', code: 'RESERVE_LOGIN' }),
    watch: (input, options) => new Promise((resolve) => options.signal.addEventListener('abort', () => resolve({ ok: true, found: false, stopped: true, note: '빈자리 대기를 멈췄습니다.' }))),
  });
  f.$('ktxReserve').click(); await tick();
  f.$('ktxGo').click(); await tick(); await tick();
  pills(f)[0].click(); await tick();
  f.$('ktxList').querySelector('.ktx-book').click(); await tick();
  assert.equal(f.reserveCalls.length, 0);
  assert.match(f.$('ktxSeatNote').textContent, /대기를 멈춘 뒤 예약/);
  pills(f)[0].click(); await tick(); await tick();
  f.$('ktxList').querySelector('.ktx-book').click(); await tick(); await tick(); await tick();
  assert.equal(f.reserveCalls.length, 1);
  assert.match(f.$('ktxSeatNote').textContent, /예약하지 못했습니다 — 코레일 로그인/);
  assert.equal(f.$('ktxSeatNote').classList.contains('bad'), true);
});
