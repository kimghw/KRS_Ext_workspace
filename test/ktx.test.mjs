// KTX 조회 — 코레일 조건 짓기·결과 화면 읽기·최소화한 창에서 조회(src/ktx.js), 실행기 어댑터(actions/runners/ktx.js), 차량 탭의 칸(ktxbox.js)
// (2026-11-05 사용자 지정: "여기 차량 말고 추가로 KTX 조회 하고 구매 페이지로 바로 가는 것까지 … 조회만 하는 기능 까지만 넣어줘, 구매페이지까지 들어갔으면 좋겠음" ·
// "이걸 차량 현황 이랑 탭으로 해서 선택할 수 있게 해줘. 그리고 백그라운드에서 실행되도록 해줘").
// 코레일은 흉내 낸다 — 열차 줄의 꼴은 binjari 의 검증된 파서·테스트(li.tckList · .price_box gen/sold_out/sold_out_soon)를 따르고,
// 막힘 안내는 2026-11-05 이 PC(Azure)에서 실제로 본 -8202 모달의 글이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { KTX_STATIONS, korailSearch, ktxSearch, ktxPick, injected } from '../src/ktx.js';
import { createDispatcher } from '../actions/dispatch.js';
import { registerKtx } from '../actions/runners/ktx.js';
import { ACTIONS } from '../actions/spec.js';
import { createKtxBox, PREF_KEY } from '../ktxbox.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');

const ROW = (train, dep, arr, gen, spec) => `<li class="tckList"><div class="data_box"><strong>${train}</strong><h3><span>부산</span> → <span>서울</span>(${dep} ~ ${arr})</h3>`
  + `<p>소요시간: 2시간 38분</p></div>${gen}${spec}</li>`;
const RESULT = `<input id="labelstart" value="부산"><input id="labelend" value="서울"><input id="startDate" value="2026-11-12(목) 05:00"><ul>`
  + ROW('KTX 101', '05:13', '07:51', '<div class="price_box gen"><a href="#none">일반실59,800원5%적립</a></div>', '<div class="price_box sold_out"><a href="#none">특실83,700원5%적립매진</a></div>')
  + ROW('KTX-산천 211', '5:40', '8:20', '<div class="price_box gen sold_out_soon"><a href="#none">일반실(매진임박)59,800원</a></div>', '<div class="price_box"><a href="#none">특실83,700원</a></div>')
  + ROW('KTX 103', '06:00', '08:38', '<div class="price_box sold_out"><a href="#none">일반실59,800원매진</a></div>', '')
  + '</ul>';

/** 결과 화면을 jsdom 에 세우고 탭 안 함수를 그 창에서 돌린다 — 함수가 바깥 이름을 쓰면(executeScript 로 못 넘긴다) 여기서 넘어진다. */
function page(body, path = '/ticket/search/list') {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { url: `https://www.korail.com${path}`, runScripts: 'outside-only' });
  // executeScript 처럼 답을 직렬화해 돌려준다(jsdom 창의 객체는 이 쪽과 프로토타입이 달라 비교가 어긋난다).
  const call = (fn, ...args) => JSON.parse(JSON.stringify(dom.window.eval(`(${fn.toString()})(...${JSON.stringify(args)})`)));
  return { dom, call };
}

test('역 목록은 행위 명세의 values 와 같다(코레일 역 이름 — 울산(통도사)·여수EXPO)', () => {
  const names = KTX_STATIONS.map(([n]) => n);
  assert.deepEqual(ACTIONS.actions['ktx.search'].fields.from.values, names);
  assert.deepEqual(ACTIONS.actions['ktx.search'].fields.to.values, names);
  assert.equal(new Set(KTX_STATIONS.map(([, c]) => c)).size, KTX_STATIONS.length);
});

test('조건 — 사이트 GENERAL 폼의 칸에 역 코드·날짜·시·인원', () => {
  const s = korailSearch({ from: '부산', to: '서울', date: '2026-11-12', hour: 5, adults: 2 }, '2026-11-05');
  assert.equal(s.searchType, 'GENERAL');
  assert.deepEqual([s.txtGoStart, s.txtGoStartCode, s.txtGoEnd, s.txtGoEndCode], ['부산', '0020', '서울', '0001']);
  assert.deepEqual([s.txtGoAbrdDt, s.txtGoHour, s.limitStartDate, s.txtPsgFlg_1, s.txtPsgFlg_2], ['20261112', '050000', '20261105', 2, 0]);
  assert.equal(s.txtMenuId, '11');
});

test('결과 화면 읽기 — 시각·열차·소요·좌석(매진·매진임박), 화면에 선 조건', () => {
  const r = page(RESULT).call(injected.pageRows);
  assert.equal(r.path, '/ticket/search/list');
  assert.deepEqual([r.from, r.to, r.date], ['부산', '서울', '2026-11-12(목) 05:00']);
  assert.equal(r.notice, '');
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows[0], { train: 'KTX', no: '101', dep: '05:13', arr: '07:51', took: '2시간 38분', gen: { price: '59,800원', soldOut: false, soon: false }, spec: { price: '83,700원', soldOut: true, soon: false } });
  assert.deepEqual([r.rows[1].train, r.rows[1].no, r.rows[1].dep, r.rows[1].gen.soon, r.rows[1].gen.soldOut, r.rows[1].spec.soldOut], ['KTX-산천', '211', '05:40', true, false, false]);
  assert.deepEqual([r.rows[2].gen.soldOut, r.rows[2].spec], [true, null]);
});

test('결과 화면 읽기 — 막힘 안내(보이는 모달의 CODE)와 열차 없음', () => {
  const { dom, call } = page('<div class="ReactModal__Content"><h2>안내 메시지</h2><p>VPN 또는 데이터센터를 통해서는 서비스를 이용할 수 없습니다.</p><p>CODE : -8202</p>'
    + '<p>ID : 61fcca7a-012d-1497-8f62-a857c08e737e</p><button>확인</button></div><div class="layerWrap">CODE : -1 숨은 것</div>');
  const modal = dom.window.document.querySelector('.ReactModal__Content');
  modal.getClientRects = () => [1];
  modal.innerText = '안내 메시지\n\nVPN 또는 데이터센터를 통해서는 서비스를 이용할 수 없습니다.\n\nCODE : -8202\n\nID : 61fcca7a-012d-1497-8f62-a857c08e737e\n\n \n\n확인';   // 2026-11-05 실제 모달의 innerText
  assert.equal(call(injected.pageRows).notice, 'VPN 또는 데이터센터를 통해서는 서비스를 이용할 수 없습니다. CODE : -8202');
  assert.equal(page('<div class="tck_confirm_no-data">해당 스케줄에 운행하는 열차가 없습니다</div>').call(injected.pageRows).empty, true);
});

test('좌석 고르기 — 출발 시각·열차 번호로 줄을 찾아 그 좌석의 단추를 누른다', () => {
  const { dom, call } = page(RESULT);
  const hits = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  for (const a of dom.window.document.querySelectorAll('a')) a.addEventListener('click', () => hits.push(a.textContent));
  assert.deepEqual(call(injected.pagePick, '05:40', '211', 'spec'), { ok: true });
  assert.deepEqual(hits, ['특실83,700원']);
  assert.equal(call(injected.pagePick, '07:00', '999', 'gen').ok, false);
});

/** 가짜 chrome — 코레일 탭 하나(최소화한 창 3 에), 패널의 창은 1. executeScript 는 함수 이름으로 답한다(pageRows 는 차례로 준 답). */
function fakeChrome(answers) {
  const calls = [];
  const session = {};
  let tab = null;
  const api = {
    storage: { session: { get: async (k) => ({ [k]: session[k] }), set: async (o) => Object.assign(session, o), remove: async (k) => { delete session[k]; } } },
    tabs: {
      get: async (id) => { if (!tab || tab.id !== id) throw new Error('No tab with id'); return tab; },
      update: async (id, o) => { calls.push(['update', id, o.active]); },
      move: async (id, o) => { calls.push(['move', id, o.windowId]); tab.windowId = o.windowId; },
    },
    windows: {
      create: async (o) => { calls.push(['window', o.url, o.state]); tab = { id: 7, url: o.url, status: 'complete', windowId: 3 }; return { id: 3, tabs: [tab] }; },
      getCurrent: async () => ({ id: 1 }),
      update: async (id) => { calls.push(['focus', id]); },
    },
    scripting: {
      executeScript: async ({ target, world, func, args }) => {
        calls.push([func.name, target.tabId, world, args]);
        if (func.name === 'pageQuery') return [{ result: 1 }];
        if (func.name === 'pageRows') { const a = answers.length > 1 ? answers.shift() : answers[0]; if (a instanceof Error) throw a; return [{ result: a }]; }
        if (func.name === 'pagePick') return [{ result: { ok: true } }];
        return [{ result: null }];
      },
    },
  };
  return { api, calls, session, closeTab: () => { tab = null; } };
}

const INPUT = { from: '부산', to: '서울', date: '2026-11-12', hour: 5, adults: 1 };
const fresh = (over) => ({ at: 2, path: '/ticket/search/list', rows: [], notice: '', empty: false, from: '부산', to: '서울', date: '2026-11-12(목) 05:00', ...over });

test('ktxSearch — 최소화한 창을 열고(탭 줄에 서지 않는다), 결과 화면을 조건으로 새로고침하고, 새 문서의 줄을 읽는다', async () => {
  const row = { train: 'KTX', no: '101', dep: '05:13', arr: '07:51' };
  const f = fakeChrome([{ at: 1, path: '/ticket/main', rows: [] }, new Error('Frame removed'), fresh({ rows: [row] })]);
  const stages = [];
  const r = await ktxSearch(INPUT, { api: f.api, today: '2026-11-05', onStage: (s) => stages.push(s) });
  assert.deepEqual(r, { ok: true, rows: [row], tabId: 7 });
  assert.deepEqual(f.calls[0], ['window', 'https://www.korail.com/ticket/main', 'minimized']);
  const q = f.calls.find((c) => c[0] === 'pageQuery');
  assert.equal(q[2], 'MAIN');
  assert.deepEqual([q[3][0].txtGoStartCode, q[3][0].txtGoAbrdDt, q[3][1]], ['0020', '20261112', '/ticket/search/list']);
  assert.equal(f.session.ktxTab, 7);
  assert.deepEqual(stages, ['코레일 여는 중', '조회 중']);
  // 같은 패널이 다시 조회하면 이 확장의 탭을 다시 쓴다
  const again = await ktxSearch(INPUT, { api: f.api, today: '2026-11-05' });
  assert.equal(again.ok, true);
  assert.equal(f.calls.filter((c) => c[0] === 'window').length, 1);
  // 좌석을 골라 사람에게 넘긴 탭은 다시 쓰지 않는다 — 다음 조회는 새 창
  await ktxPick({ tabId: 7, row: { dep: '05:13', no: '101' }, seat: 'gen' }, { api: f.api });
  assert.equal(f.session.ktxTab, undefined);
  await ktxSearch(INPUT, { api: f.api, today: '2026-11-05' });
  assert.equal(f.calls.filter((c) => c[0] === 'window').length, 2);
});

test('ktxSearch — 막힘 안내는 그 글로, 조건이 다른 화면은 줄을 받지 않는다, 같은 역은 탭을 열지 않는다', async () => {
  const blocked = await ktxSearch(INPUT, { api: fakeChrome([fresh({ notice: 'VPN 또는 데이터센터를 통해서는 서비스를 이용할 수 없습니다. CODE : -8202' })]).api });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /^코레일이 조회를 막았습니다 — .*-8202$/);
  const other = await ktxSearch(INPUT, { api: fakeChrome([fresh({ from: '서울', to: '부산', rows: [{ dep: '05:00' }] })]).api });
  assert.equal(other.ok, false);
  assert.match(other.error, /서울→부산/);
  const f = fakeChrome([]);
  assert.equal((await ktxSearch({ ...INPUT, to: '부산' }, { api: f.api })).ok, false);
  assert.equal(f.calls.length, 0);
});

test('ktxPick — 최소화한 창의 코레일 탭을 패널의 창으로 옮겨 앞에 두고 그 줄의 좌석을 누른다, 닫힌 탭이면 다시 조회하라고', async () => {
  const f = fakeChrome([]);
  await f.api.windows.create({ url: 'https://www.korail.com/ticket/search/list', state: 'minimized' });
  f.session.ktxTab = 7;
  const r = await ktxPick({ tabId: 7, row: { dep: '05:13', no: '101' }, seat: 'gen' }, { api: f.api });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(f.calls.slice(1).map((c) => c.slice(0, 3)), [['move', 7, 1], ['update', 7, true], ['focus', 1], ['pagePick', 7, 'ISOLATED']]);
  assert.equal(f.session.ktxTab, undefined, '넘긴 탭은 잊는다');
  // 이미 패널의 창에 있으면 옮기지 않는다
  await ktxPick({ tabId: 7, row: { dep: '05:13', no: '101' }, seat: 'spec' }, { api: f.api });
  assert.equal(f.calls.filter((c) => c[0] === 'move').length, 1);
  assert.deepEqual(f.calls.find((c) => c[0] === 'pagePick')[3], ['05:13', '101', 'gen']);
  f.closeTab();
  assert.match((await ktxPick({ tabId: 7, row: {}, seat: 'gen' }, { api: f.api })).error, /닫혔습니다/);
});

test('ktx.search — 조회라 확인 없이 돌고, 사전설정의 오늘을 넘긴다', async () => {
  const seen = [];
  const log = [];
  const d = createDispatcher({ log: (e) => log.push(e) });
  registerKtx(d, { ktxSearch: async (input, opts) => { seen.push({ input, today: opts.today }); return { ok: true, rows: [], tabId: 7 }; } });
  const { record } = d.build('ktx.search', { input: INPUT, preset: { today: '2026-11-05' } });
  assert.equal((await d.run(record)).ok, true);
  assert.deepEqual(seen, [{ input: INPUT, today: '2026-11-05' }]);
  assert.equal(log[0].kind, 'ktx');
  assert.match(log[0].text, /부산→서울/);
  assert.throws(() => d.build('ktx.search', { input: { ...INPUT, from: '인천' }, preset: { today: '2026-11-05' } }), /출발역|from/);
});

test('차량 탭의 칸 — 조회하면 줄이 서고, 매진 좌석은 잠기고, 좌석을 누르면 코레일에서 고른다', async () => {
  const doc = new JSDOM(html).window.document;
  const store = { [PREF_KEY]: { from: '부산', to: '서울', adults: 2 } };
  const picks = [];
  const d = createDispatcher();
  const rows = page(RESULT).call(injected.pageRows).rows;
  let asked = null;
  registerKtx(d, { ktxSearch: async (input) => { asked = input; return { ok: true, rows, tabId: 7 }; } });
  const box = createKtxBox({
    doc, actions: d, when: () => ({ date: '2026-11-12', hour: 5 }), today: () => '2026-11-05',
    storage: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) },
    pick: async (p) => { picks.push(p); return { ok: true }; }, openTab: () => {},
  });
  await new Promise((r) => setTimeout(r, 0));
  const $ = (id) => doc.getElementById(id);
  const app = doc.querySelector('.app');
  const pressed = () => $('carViewControl').querySelector('[aria-pressed="true"]')?.dataset.view;
  const choose = (view) => $('carViewControl').querySelector(`[data-view="${view}"]`).querySelector('svg').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  assert.deepEqual([$('carViewControl').hidden, $('ktxBox').hidden], [true, true], '차량 탭이 아니면 시간 옆 아이콘도 칸도 숨는다');
  box.toggle(true);
  assert.deepEqual([$('carViewControl').hidden, $('ktxBox').hidden, app.classList.contains('ktx-view'), pressed()], [false, true, false, 'car'], '차량 탭은 차량부터');
  choose('ktx');
  assert.deepEqual([$('ktxBox').hidden, app.classList.contains('ktx-view'), pressed(), store.ktxView], [false, true, 'ktx', undefined], '아이콘 안을 눌러도 되고, 고른 것은 저장하지 않는다');
  box.toggle(false);
  assert.deepEqual([$('carViewControl').hidden, $('ktxBox').hidden, app.classList.contains('ktx-view')], [true, true, false], '다른 탭으로 가면 숨는다');
  box.toggle(true);
  assert.equal($('ktxBox').hidden, false, '돌아오면 고른 탭 그대로');
  assert.equal($('ktxPax').value, '2', '저장한 인원');
  $('ktxSwap').click();
  assert.deepEqual([$('ktxFrom').value, $('ktxTo').value], ['서울', '부산']);
  $('ktxSwap').click();
  $('ktxGo').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(asked, { from: '부산', to: '서울', date: '2026-11-12', hour: 5, adults: 2 });
  const items = $('ktxList').querySelectorAll('li');
  assert.equal(items.length, 3);
  assert.equal($('ktxCount').textContent, '3');
  assert.match($('ktxNote').textContent, /부산→서울 11\/12 05시~ · 3편/);
  const seats = [...items[0].querySelectorAll('button.ktx-seat')];
  assert.deepEqual(seats.map((b) => [b.dataset.seat, b.disabled, b.textContent]), [['gen', false, '일반실59,800원'], ['spec', true, '특실매진']]);
  assert.ok(items[1].querySelector('button.ktx-seat.soon'), '매진임박 표시');
  seats[0].querySelector('b').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(picks, [{ tabId: 7, row: rows[0], seat: 'gen' }]);
  assert.match($('ktxNote').textContent, /05:13 KTX 101 일반실을 골라 두었습니다/);
  choose('car');
  assert.deepEqual([$('ktxBox').hidden, app.classList.contains('ktx-view'), store.ktxView], [true, false, undefined]);
});

test('시간 옆 고르기 — 예전에 저장해 둔 KTX 조회가 있어도 차량으로 연다(2026-11-05 "기본은 차량 조회로")', async () => {
  const doc = new JSDOM(html).window.document;
  const box = createKtxBox({ doc, actions: null, storage: { get: async (k) => ({ [k]: k === 'ktxView' ? 'ktx' : undefined }), set: async () => {} } });
  box.toggle(true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.getElementById('ktxBox').hidden, true);
  assert.equal(doc.querySelector('#carViewControl [aria-pressed="true"]').dataset.view, 'car');
});

test('패널 — 차량·KTX·항공권 아이콘 셋은 날짜 줄의 시간 칸 옆(목록이 아니라 단추), KTX 칸은 예약 칸 다음(.app 바로 아래), 차량 탭 안의 탭 줄은 없다', () => {
  const doc = new JSDOM(html).window.document;
  const box = doc.getElementById('ktxBox');
  const pick = doc.getElementById('carViewControl');
  assert.equal(box.previousElementSibling.id, 'booking');
  assert.ok(pick.previousElementSibling.classList.contains('hours-control'));
  assert.equal(pick.querySelector('svg'), null, '그림은 src/icons.js 의 것을 ktxbox 가 채운다(출장 폼과 같은 아이콘)');
  createKtxBox({ doc, actions: null, storage: { get: async () => ({}), set: async () => {} } });
  assert.deepEqual([...pick.querySelectorAll('button[data-view]')].map((b) => b.dataset.view + ':' + b.title + ':' + !!b.querySelector('svg')), ['car:차량 현황:true', 'ktx:KTX 조회:true', 'flight:항공권 조회:true']);
  assert.equal(pick.querySelector('select'), null, '목록 팝업이 아니다');
  assert.equal(doc.getElementById('carTabs'), null);
  assert.ok(box.parentElement.classList.contains('app'));
  const css = fs.readFileSync(new URL('../sidepanel.css', import.meta.url), 'utf8');
  assert.match(css, /\.app\.ktx-view > \.ask, \.app\.ktx-view > \.schedule, \.app\.ktx-view > #booking \{ display: none; \}/);
});
