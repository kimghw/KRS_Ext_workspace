// rerp/ 폴더(kr_ext_rerp 에서 옮긴 코드)가 원본과 같게 도는지 — kr_ext_rerp tests/plan-sync.test.js 를 ESM 으로 옮긴 검사(plansync·onenote·mcp 의 순수 함수와 run() 의 가짜 OneNote)에
// R&D 탭이 쓰는 erp.js(흉내 fetch — _JSON_ 이중 인코딩·EUC-KR·GWM0001 로그인 판정·비목별 잔액·본예산 대체·미청구 합산·SSO)와 plussync.js(배선 — 켜짐·섹션·책임자·내보내기·가져오기)를 보탰다.
// 어디에도 보내지 않는다. 복사본이 원본과 어긋났는지는 `node tools/rerp.mjs check` 가 본다.
import assert from 'node:assert/strict';

import S from '../rerp/plansync.js';
import O from '../rerp/onenote.js';
import M from '../rerp/mcp.js';
import KRX_PLAN from '../rerp/plan.js';
import ERP, { settingsOf, withPending, execRate, trunc } from '../rerp/erp.js';
import { createPlusSync, PLUS_DEFAULTS } from '../rerp/plussync.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

console.log('plansync — kr_ext_rerp tests/plan-sync.test.js 그대로');
t('flatten/unflatten 왕복 · 과제 하나만', () => {
  const plans = { P1: { '10|연구활동비': [{ id: 'a', name: 'x', qty: 2, unit: 10, amt: 20, ts: 5 }], '10|장비비': [{ id: 'b', name: 'y', qty: 1, unit: 3, amt: 3, ts: 6, sub: { date: '2026-09-02' }, by: '홍' }] }, P2: { K: [{ id: 'c', name: 'z', qty: 1, unit: 1, amt: 1, ts: 1 }] } };
  const items = S.flatten(plans);
  assert.equal(items.length, 3);
  assert.deepEqual(S.unflatten(items), plans);
  assert.deepEqual(S.flatten(plans, 'P2').map((e) => e.id), ['c']);
});
t('titleFor / prjOfTitle — 페이지 제목 규약은 rerp 0.8.x 그대로', () => {
  assert.equal(S.titleFor('2026-0063-01', 'MW급 차단기'), '[예상 비용] 2026-0063-01 MW급 차단기');
  assert.equal(S.titleFor('2026-0063-01'), '[예상 비용] 2026-0063-01');
  assert.equal(S.prjOfTitle('[예상 비용] 2026-0063-01 MW급 차단기'), '2026-0063-01');
  assert.equal(S.prjOfTitle(' [예상 비용]  2026-0064-01'), '2026-0064-01');
  assert.equal(S.prjOfTitle('회의록'), '');
  assert.equal(S.BLOCK, 'krx-plan');
});
t('merge: ts 큰 쪽이 이김, 같으면 로컬', () => {
  const L = { items: [{ id: 'a', prj: 'P', key: 'K', name: 'local', qty: 1, unit: 1, amt: 1, ts: 10 }, { id: 'b', prj: 'P', key: 'K', name: 'same-local', qty: 1, unit: 1, amt: 1, ts: 5 }], del: {} };
  const R = { items: [{ id: 'a', prj: 'P', key: 'K', name: 'remote', qty: 1, unit: 1, amt: 1, ts: 20 }, { id: 'b', prj: 'P', key: 'K', name: 'same-remote', qty: 1, unit: 1, amt: 1, ts: 5 }], del: {} };
  const m = S.merge(L, R, 1000);
  const by = Object.fromEntries(m.items.map((e) => [e.id, e.name]));
  assert.equal(by.a, 'remote');
  assert.equal(by.b, 'same-local');
  assert.equal(m.localChanged, true);
  assert.equal(m.remoteChanged, true);
});
t('merge: 묘비(숫자·객체)가 항목보다 새로우면 삭제, 항목이 더 새로우면 묘비 폐기', () => {
  const L = { items: [{ id: 'a', prj: 'P', key: 'K', name: 'a', qty: 1, unit: 1, amt: 1, ts: 10 }, { id: 'b', prj: 'P', key: 'K', name: 'b', qty: 1, unit: 1, amt: 1, ts: 50 }], del: { c: { ts: 30, prj: 'P' } } };
  const R = { items: [{ id: 'c', prj: 'P', key: 'K', name: 'c', qty: 1, unit: 1, amt: 1, ts: 20 }], del: { a: 20, b: 40 } };
  const m = S.merge(L, R, 1000);
  assert.deepEqual(m.items.map((e) => e.id).sort(), ['b']);
  assert.deepEqual(m.del, { a: 20, c: 30 });
});
t('merge: 원격 없음(블록 없음) → remoteChanged, 로컬 그대로 · 같으면 아무것도 안 바뀜', () => {
  const items = [{ id: 'a', prj: 'P', key: 'K', name: 'a', qty: 1, unit: 1, amt: 1, ts: 10 }];
  const m = S.merge({ items, del: { z: 999 } }, null, 1000);
  assert.equal(m.localChanged, false); assert.equal(m.remoteChanged, true); assert.equal(m.items.length, 1);
  const m2 = S.merge({ items, del: {} }, { items: items.map((e) => Object.assign({}, e)), del: {} }, 1000);
  assert.equal(m2.localChanged, false); assert.equal(m2.remoteChanged, false);
});
t('gcTomb: 90일 지난 묘비 버림 (객체 값도)', () => {
  const now = 100 * 24 * 3600 * 1000;
  assert.deepEqual(S.gcTomb({ old: 1, fresh: now - 1000, obj: { ts: now - 5, prj: 'P' } }, now), { fresh: now - 1000, obj: now - 5 });
});
t('serialize → parse 왕복 (한글·특수문자·구독·묘비·제목) — 블록은 rerp 와 바이트까지 같은 꼴', () => {
  const items = [{ id: 'a1', prj: 'PRJ-1', key: '10|연구활동비', name: 'CHATGPT <A&B> "따옴표"', qty: 3, unit: 300000, amt: 900000, ts: 1000, by: '김거화' },
    { id: 'a2', prj: 'PRJ-1', key: '10|연구활동비', name: 'azure', qty: 3, unit: 500000, amt: 1500000, ts: 2000, sub: { date: '2026-09-02' } }];
  const html = S.serialize({ items, del: { zz: 5 }, at: 123456, by: '김거화' }, { title: 'MW급 차단기 (PRJ-1)', calc: KRX_PLAN });
  assert.ok(html.startsWith('<table data-id="krx-plan"'));
  assert.ok(!/<div/.test(html), 'div 없음 (Graph replace 제약)');
  assert.ok(html.includes('MW급 차단기 (PRJ-1)'));
  assert.ok(html.includes('&lt;A&amp;B&gt;'));
  assert.ok(html.includes('krxplan1:'));
  const p = S.parse(html);
  assert.equal(p.at, 123456); assert.equal(p.by, '김거화');
  assert.deepEqual(p.del, { zz: 5 });
  assert.equal(p.items.length, 2);
  assert.equal(p.items.find((e) => e.id === 'a1').name, 'CHATGPT <A&B> "따옴표"');
  assert.deepEqual(p.items.find((e) => e.id === 'a2').sub, { date: '2026-09-02' });
});
t('parse: Graph 가 되돌려 준 형태(생성 id · span · 엔티티 · 줄바꿈)도 읽는다 · JSON 없으면 null', () => {
  const html = S.serialize({ items: [{ id: 'q', prj: 'P', key: 'K', name: 'n', qty: 1, unit: 2, amt: 2, ts: 3 }], del: {}, at: 1, by: 'x' });
  const b64 = /krxplan1:([A-Za-z0-9+/=]+)/.exec(html)[1];
  const wrapped = `<table id="table:{g}{15}" data-id="krx-plan" style="border:1px solid"><tr><td id="td:{g}{1}">제목</td></tr>\n<tr><td><span style="color:#c0c4cc">krxplan1:${b64.slice(0, 10)}\n${b64.slice(10)}</span>&nbsp;</td><td><br /></td></tr></table>`;
  const blk = O.findBlock(wrapped, 'krx-plan');
  assert.ok(blk); assert.equal(blk.tag, 'table'); assert.equal(blk.id, 'table:{g}{15}');
  assert.equal(S.parse(blk.inner).items[0].id, 'q');
  assert.equal(S.parse('<tr><td>x</td></tr>'), null); assert.equal(S.parse(''), null);
});

console.log('onenote · mcp');
t('parseLink: 웹 링크(인코딩) · onenote: 링크 · sourcedoc 무시 · Graph page_id', () => {
  const web = 'https://krclass-my.sharepoint.com/personal/x/Documents/Notebooks/AIPWork?wd=target%282026.one%7Ca745a153-ea3f-4b6e-8f16-9163bfe64932%2F%EC%A0%9C%EB%AA%A9%7Cb08d1e95-6615-497d-8f11-a88ecb8dea94%2F%29';
  assert.deepEqual(O.parseLink(web), { guid: 'b08d1e95-6615-497d-8f11-a88ecb8dea94' });
  const doc = 'https://x.sharepoint.com/personal/y/_layouts/15/Doc.aspx?sourcedoc={11111111-2222-3333-4444-555555555555}&action=edit&wd=target(2026.one|a745a153-ea3f-4b6e-8f16-9163bfe64932/제목|B08D1E95-6615-497D-8F11-A88ECB8DEA94/)&wdorigin=NavigationUrl';
  assert.deepEqual(O.parseLink(doc), { guid: 'b08d1e95-6615-497d-8f11-a88ecb8dea94' });
  const client = 'onenote:https://x/2026.one#[작업] 문서&section-id={A745A153-EA3F-4B6E-8F16-9163BFE64932}&page-id={B08D1E95-6615-497D-8F11-A88ECB8DEA94}&end';
  assert.deepEqual(O.parseLink(client), { guid: 'b08d1e95-6615-497d-8f11-a88ecb8dea94' });
  const pid = '1-1a765a0db0ab4b3bb67d6117bfe03e9c!6-8ad4548c-604b-4512-a444-e20d8b0b64f1';
  assert.deepEqual(O.parseLink(pid), { pageId: pid });
  assert.equal(O.parseLink('hello'), null); assert.equal(O.parseLink(''), null);
});
t('checkTools: replace · include_ids 지원 판정', () => {
  const tools = [{ name: 'read_onenote', inputSchema: { properties: { include_ids: {} } } }, { name: 'write_onenote', inputSchema: { properties: { action: { enum: ['append', 'replace'] } } } }];
  assert.deepEqual(O.checkTools(tools), { hasWrite: true, hasRead: true, replace: true, includeIds: true });
  assert.deepEqual(O.checkTools([{ name: 'write_onenote', inputSchema: { properties: { action: { enum: ['append'] } } } }]), { hasWrite: true, hasRead: false, replace: false, includeIds: false });
});
await ta('ensureSection: 이름으로 찾기(대소문자 무시) · 여럿이면 노트북 요구 · 없으면 고른 노트북에 만듦', async () => {
  const secs = [{ id: 's1', display_name: '2026', parent_notebook_id: 'n1', parent_notebook_name: 'AIPWork' }, { id: 's2', display_name: 'rerp', parent_notebook_id: 'n2', parent_notebook_name: '회의' }];
  const calls = [];
  const client = { call: async (name, args) => { calls.push(args.action); if (args.action === 'list_sections') return { json: { sections: secs } }; if (args.action === 'create_section') { secs.push({ id: 's9', display_name: args.title, parent_notebook_id: args.notebook_id, parent_notebook_name: 'AIPWork' }); return { json: { section: { id: 's9', display_name: args.title } } }; } throw new Error('unexpected ' + args.action); } };
  const found = await O.ensureSection(client, { name: 'RERP' });
  assert.deepEqual(found, { id: 's2', label: '회의 › rerp', name: 'RERP', notebookId: 'n2', notebook: '회의', created: false });
  await assert.rejects(() => O.ensureSection(client, { name: '2026', notebookId: '' }).then(() => { secs.push({ id: 's3', display_name: '2026', parent_notebook_id: 'n2', parent_notebook_name: '회의' }); return O.ensureSection(client, { name: '2026' }); }), (e) => e.kind === 'notebook' && e.notebooks.length === 2);
  await assert.rejects(() => O.ensureSection(client, { name: 'NEW' }), (e) => e.kind === 'notebook' && e.notebooks.map((n) => n.id).sort().join() === 'n1,n2');
  const made = await O.ensureSection(client, { name: 'NEW', notebookId: 'n1' });
  assert.deepEqual(made, { id: 's9', label: 'AIPWork › NEW', name: 'NEW', notebookId: 'n1', notebook: 'AIPWork', created: true });
  assert.ok(calls.includes('create_section'));
  const again = await O.ensureSection(client, { name: 'new', notebookId: 'n1' });
  assert.equal(again.id, 's9'); assert.equal(again.created, false);
});
await ta('resolveLink: 내보내기가 복사한 글(링크+ID) · 링크만(web_url GUID 대조, 없으면 syncDb 뒤 재시도) · 엉뚱한 글', async () => {
  const pid = '1-1a765a0db0ab4b3bb67d6117bfe03e9c!6-8ad4548c-604b-4512-a444-e20d8b0b64f1';
  const web = 'https://krclass-my.sharepoint.com/personal/x/Documents/Notebooks/AIPWork?wd=target%282026.one%7Ca745a153-ea3f-4b6e-8f16-9163bfe64932%2F%EC%A0%9C%EB%AA%A9%7Cb08d1e95-6615-497d-8f11-a88ecb8dea94%2F%29';
  let synced = 0; let pages = [];
  const client = { call: async (name, args) => { if (args.action === 'list_pages') return { json: { pages } }; if (name === 'sync_onenote_db') { synced++; pages = [{ page_id: pid, title: '[예상 비용] P1', web_url: web, section_id: 's1' }]; return { json: {} }; } throw new Error('unexpected'); } };
  const a = await O.resolveLink(client, `${web}\n[예상 비용 페이지 ID] ${pid}`);
  assert.equal(a.pageId, pid); assert.equal(a.title, '[예상 비용] P1');
  pages = []; synced = 0;
  const b = await O.resolveLink(client, web);
  assert.equal(b.pageId, pid); assert.equal(synced, 1);
  await assert.rejects(() => O.resolveLink(client, '안녕하세요'), (e) => e.kind === 'badlink');
  const pid2 = '1-ffffffffffffffffffffffffffffffff!6-8ad4548c-604b-4512-a444-e20d8b0b64f1';
  const c = await O.resolveLink(client, pid2);
  assert.equal(c.pageId, pid2); assert.equal(c.title, '');
});
t('MCP SSE 응답 해석', () => {
  const sse = 'event: message\r\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":1}}\r\n\r\nevent: message\ndata: {"jsonrpc":"2.0",\ndata: "id":2,"result":{"ok":2}}\n\n';
  const msgs = M._parseSse(sse);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].result.ok, 2);
});
await ta('MCP open: initialize 에 세션 id 를 받아 이후 요청에 싣고(규약 2025-06-18), 도구 답의 JSON 을 풀고, 끝나면 DELETE', async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ method: init.method, session: init.headers['Mcp-Session-Id'] || '', body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'DELETE') return { ok: true, status: 200, headers: { get: () => null }, text: async () => '' };
    const msg = JSON.parse(init.body);
    const reply = (result) => ({ ok: true, status: 200, headers: { get: (h) => (h === 'mcp-session-id' ? 's-9' : h === 'content-type' ? 'text/event-stream' : null) }, text: async () => `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n` });
    if (msg.method === 'initialize') return reply({ protocolVersion: '2025-06-18', serverInfo: { name: 'fake' } });
    if (!('id' in msg)) return { ok: true, status: 202, headers: { get: () => null }, text: async () => '' };
    if (msg.method === 'tools/list') return reply({ tools: [{ name: 'read_onenote' }] });
    return reply({ content: [{ type: 'text', text: JSON.stringify({ success: true, echo: msg.params.arguments }) }] });
  };
  const c = await M.open('http://localhost:5005/mcp', { fetch, clientName: 'krs-workspace' });
  assert.equal(seen[0].body.params.protocolVersion, '2025-06-18');
  assert.equal(seen[0].body.params.clientInfo.name, 'krs-workspace');
  assert.deepEqual((await c.list()).map((x) => x.name), ['read_onenote']);
  assert.deepEqual((await c.call('read_onenote', { action: 'x' })).json, { success: true, echo: { action: 'x' } });
  assert.ok(seen.slice(1).every((s) => s.session === 's-9'));
  await c.close();
  assert.equal(seen.at(-1).method, 'DELETE');
  await assert.rejects(() => M.open('http://localhost:5005/mcp', { fetch: async () => { throw new TypeError('Failed to fetch'); } }), (e) => e.kind === 'offline');
});

console.log('plansync.run — 가짜 OneNote');
/* run(): 가짜 OneNote(메모리 페이지 저장소)로 과제별 생성·병합·묘비·과제 하나만 동기화를 검증 */
function fakeOneNote() {
  const pages = {};   // pageId → { title, sectionId, html }
  let seq = 0;
  const calls = [];
  const api = {
    calls, pages,
    listSectionPages: async (c, sectionId) => { calls.push('list'); return Object.entries(pages).filter(([, p]) => p.sectionId === sectionId).map(([pageId, p]) => ({ pageId, title: p.title, webUrl: `web:${pageId}`, sectionId })); },
    syncDb: async () => { calls.push('syncDb'); },
    createPage: async (c, sectionId, title, html) => { calls.push('create:' + title); const pageId = `pg${++seq}`; pages[pageId] = { title, sectionId, html: `<html><head><title>${title}</title></head><body>${html.replace('<table ', `<table id="table:{x}{${seq}}" `)}</body></html>` }; return { pageId, title, webUrl: `web:${pageId}` }; },
    readPage: async (c, pageId) => { calls.push('read:' + pageId); if (!pages[pageId]) throw new Error('없는 페이지'); return pages[pageId].html; },
    pageTitle: O.pageTitle, findBlock: O.findBlock,
    writeBlock: async (c, pageId, dataId, html, block) => { calls.push((block ? 'replace:' : 'append:') + pageId); const p = pages[pageId]; const withId = html.replace('<table ', `<table id="table:{x}{${++seq}}" `); p.html = block ? p.html.replace(block.html, withId) : p.html.replace('</body>', withId + '</body>'); }
  };
  return api;
}
function memStore(plans, del) { const st = { plans, del: del || {} }; return { st, loadLocal: async () => ({ plans: JSON.parse(JSON.stringify(st.plans)), del: JSON.parse(JSON.stringify(st.del)) }), saveLocal: async (plans, del) => { st.plans = plans; st.del = del; } }; }
await ta('링크로 연결한(bound) 페이지는 섹션 없이도 동기화되고 만들지는 않는다', async () => {
  const fake = fakeOneNote();
  const boss = memStore({ P1: { K: [{ id: 'a', name: '책임자것', qty: 1, unit: 10, amt: 10, ts: 5 }] } });
  const r1 = await S.run({ client: {}, onenote: fake, sectionId: 'S', names: { P1: '과제1' }, myPrjNos: ['P1'], leadPrjNos: ['P1'], calc: KRX_PLAN, who: '책임자', loadLocal: boss.loadLocal, saveLocal: boss.saveLocal, now: 1000 });
  const pageId = r1.pages.P1.pageId;
  const me = memStore({ P1: { K: [{ id: 'b', name: '내것', qty: 1, unit: 1, amt: 1, ts: 2000 }] }, P2: { K: [{ id: 'c', name: 'p2', qty: 1, unit: 1, amt: 1, ts: 1 }] } });
  const bound = { P1: { pageId, title: 't', webUrl: 'web:' + pageId, sectionId: '', bound: true } };
  const calls0 = fake.calls.length;
  const r2 = await S.run({ client: {}, onenote: fake, sectionId: '', pages: bound, names: {}, myPrjNos: ['P1', 'P2'], leadPrjNos: ['P2'], createAll: true, calc: KRX_PLAN, who: '나', loadLocal: me.loadLocal, saveLocal: me.saveLocal, now: 3000 });
  assert.deepEqual(Object.keys(r2.state.pages).sort(), ['P1', 'P2']);
  assert.equal(r2.state.pages.P1.pulled, true, '책임자 항목을 가져옴');
  assert.equal(r2.state.pages.P1.pushed, true, '내 항목을 올림');
  assert.equal(r2.state.pages.P2.noPage, true, '섹션이 없으면 책임자여도 만들지 않음');
  assert.equal(Object.keys(fake.pages).length, 1);
  assert.ok(!fake.calls.slice(calls0).includes('list') && !fake.calls.slice(calls0).includes('syncDb'), '섹션이 없으면 목록 조회 없음');
  assert.deepEqual(me.st.plans.P1.K.map((e) => e.id).sort(), ['a', 'b']);
  assert.ok(r2.pages.P1.bound, '연결 표시가 캐시에 남음');
});
await ta('책임자가 아니면 페이지를 만들지 않고 noPage 로 기다린다 (오류 아님) · 책임자가 만든 뒤에는 씀', async () => {
  const fake = fakeOneNote();
  const me = memStore({ P1: { K: [{ id: 'a', name: 'x', qty: 1, unit: 10, amt: 10, ts: 5 }] } });
  const r = await S.run({ client: {}, onenote: fake, sectionId: 'S', names: { P1: '과제1' }, myPrjNos: ['P1'], leadPrjNos: [], calc: KRX_PLAN, who: '나', loadLocal: me.loadLocal, saveLocal: me.saveLocal, now: 1000 });
  assert.equal(r.state.ok, true);
  assert.equal(r.state.waiting, 1);
  assert.equal(r.state.pages.P1.noPage, true);
  assert.equal(r.state.pages.P1.count, 1);
  assert.equal(Object.keys(fake.pages).length, 0, '페이지 생성 없음');
  assert.equal(fake.calls.filter((c) => c === 'syncDb').length, 1, '목록 갱신은 한 번');
  const r2 = await S.run({ client: {}, onenote: fake, sectionId: 'S', names: {}, myPrjNos: ['P1', 'P2'], leadPrjNos: [], createAll: true, calc: KRX_PLAN, loadLocal: me.loadLocal, saveLocal: me.saveLocal, now: 1500 });
  assert.equal(Object.keys(fake.pages).length, 0);
  assert.equal(r2.state.waiting, 1);
  const boss = memStore({});
  await S.run({ client: {}, onenote: fake, sectionId: 'S', names: { P1: '과제1' }, myPrjNos: ['P1'], leadPrjNos: ['P1'], calc: KRX_PLAN, who: '책임자', loadLocal: boss.loadLocal, saveLocal: boss.saveLocal, now: 2000 });
  assert.equal(Object.keys(fake.pages).length, 1);
  const r3 = await S.run({ client: {}, onenote: fake, sectionId: 'S', names: { P1: '과제1' }, myPrjNos: ['P1'], leadPrjNos: [], calc: KRX_PLAN, who: '나', loadLocal: me.loadLocal, saveLocal: me.saveLocal, now: 3000 });
  assert.equal(r3.state.pages.P1.noPage, undefined);
  assert.equal(r3.state.pages.P1.pushed, true);
  assert.equal(r3.state.waiting, 0);
});
await ta('책임자인 과제는 항목이 없어도 페이지를 자동으로 만들고, 책임자가 아닌 과제는 항목이 없으면 건너뜀', async () => {
  const fake = fakeOneNote();
  const A = memStore({ P1: { K: [{ id: 'a', name: 'x', qty: 1, unit: 10, amt: 10, ts: 5 }] } });
  const r = await S.run({ client: {}, onenote: fake, sectionId: 'S', names: { P1: '과제1', P2: '과제2', P3: '과제3' }, myPrjNos: ['P1', 'P2', 'P3'], leadPrjNos: ['P1', 'P2'], calc: KRX_PLAN, who: '나', loadLocal: A.loadLocal, saveLocal: A.saveLocal, now: 1000 });
  assert.equal(r.state.ok, true);
  assert.deepEqual(Object.keys(r.state.pages).sort(), ['P1', 'P2'], 'P3 은 책임자가 아니고 항목도 없어 대상 아님');
  assert.equal(r.state.pages.P1.created, true);
  assert.equal(r.state.pages.P2.created, true, '항목이 없어도 책임 과제는 자동 생성');
  assert.equal(r.state.pages.P1.title, '[예상 비용] P1 과제1');
  assert.ok(fake.calls.includes('syncDb'), '만들기 전에 목록 새로 받음');
  assert.equal(Object.keys(fake.pages).length, 2);
  const r2 = await S.run({ client: {}, onenote: fake, sectionId: 'S', pages: r.pages, names: { P1: '과제1', P2: '과제2' }, myPrjNos: ['P1', 'P2'], leadPrjNos: ['P1', 'P2'], calc: KRX_PLAN, loadLocal: A.loadLocal, saveLocal: A.saveLocal, now: 2000 });
  assert.equal(r2.state.pages.P1.created, false); assert.equal(r2.state.pages.P2.created, false);
  assert.equal(r2.state.pages.P1.pushed, false, 'P1 은 페이지와 같아 안 씀');
  assert.equal(Object.keys(fake.pages).length, 2);
});
await ta('동료가 같은 섹션에서 동기화하면 같은 페이지를 쓰고 항목·묘비가 오간다 (과제별 묘비)', async () => {
  const fake = fakeOneNote();
  const me = memStore({ P1: { K: [{ id: 'a', name: '내것', qty: 1, unit: 10, amt: 10, ts: 5 }] }, P2: { K: [{ id: 'p2', name: 'p2', qty: 1, unit: 1, amt: 1, ts: 1 }] } });
  const r1 = await S.run({ client: {}, onenote: fake, sectionId: 'S', names: {}, myPrjNos: ['P1', 'P2'], leadPrjNos: ['P1', 'P2'], calc: KRX_PLAN, who: '나', loadLocal: me.loadLocal, saveLocal: me.saveLocal, now: 1000 });
  assert.equal(Object.keys(fake.pages).length, 2);
  const you = memStore({});
  const r2 = await S.run({ client: {}, onenote: fake, sectionId: 'S', names: {}, myPrjNos: ['P1'], calc: KRX_PLAN, who: '동료', loadLocal: you.loadLocal, saveLocal: you.saveLocal, now: 2000 });
  assert.equal(Object.keys(fake.pages).length, 2, '페이지 중복 생성 없음');
  assert.deepEqual(Object.keys(r2.state.pages), ['P1'], '참여하지 않는 P2 는 건드리지 않음');
  assert.equal(r2.state.pages.P1.pulled, true);
  assert.equal(you.st.plans.P1.K[0].name, '내것');
  you.st.plans = { P1: { K: [{ id: 'b', name: '동료것', qty: 2, unit: 5, amt: 10, ts: 3000, by: '동료' }] } };
  you.st.del = { a: { ts: 3000, prj: 'P1' }, zz: { ts: 3000, prj: 'P9' } };
  await S.run({ client: {}, onenote: fake, sectionId: 'S', pages: r2.pages, names: {}, myPrjNos: ['P1'], calc: KRX_PLAN, who: '동료', loadLocal: you.loadLocal, saveLocal: you.saveLocal, now: 3500 });
  const callsBefore = fake.calls.length;
  const r3 = await S.run({ client: {}, onenote: fake, sectionId: 'S', pages: r1.pages, names: {}, myPrjNos: ['P1', 'P2'], only: 'P1', calc: KRX_PLAN, who: '나', loadLocal: me.loadLocal, saveLocal: me.saveLocal, now: 4000 });
  assert.deepEqual(Object.keys(r3.state.pages), ['P1']);
  assert.equal(r3.state.pages.P1.pulled, true);
  assert.equal(r3.state.pages.P1.remoteBy, '동료');
  assert.deepEqual(me.st.plans.P1.K.map((e) => e.id), ['b']);
  assert.deepEqual(me.st.plans.P2.K.map((e) => e.id), ['p2']);
  assert.deepEqual(me.st.del, { a: { ts: 3000, prj: 'P1' } });
  const p1 = Object.values(fake.pages).find((p) => p.title.includes('P1'));
  const parsed = S.parse(O.findBlock(p1.html, 'krx-plan').inner);
  assert.deepEqual(Object.keys(parsed.del), ['a']);
  assert.ok(!fake.calls.slice(callsBefore).includes('list'), '캐시된 페이지로 과제 하나만 돌 때는 목록 조회 없음');
});
await ta('과제 하나가 실패해도 나머지는 진행하고 errors 에 남긴다', async () => {
  const fake = fakeOneNote();
  const me = memStore({ P1: { K: [{ id: 'a', name: 'x', qty: 1, unit: 1, amt: 1, ts: 5 }] }, P2: { K: [{ id: 'b', name: 'y', qty: 1, unit: 1, amt: 1, ts: 5 }] } });
  const r = await S.run({ client: {}, onenote: fake, sectionId: 'S', pages: { P1: { pageId: 'ghost', title: 't', sectionId: 'S' } }, names: {}, myPrjNos: [], leadPrjNos: ['P2'], calc: KRX_PLAN, loadLocal: me.loadLocal, saveLocal: me.saveLocal, now: 1000 });
  assert.equal(r.state.ok, false);
  assert.equal(r.state.errors, 1);
  assert.ok(/없는 페이지/.test(r.state.pages.P1.error));
  assert.equal(r.state.pages.P2.created, true);
});

console.log('plan — 월간 구독·금액');
t('월간 구독: 오늘(2026-10-11)부터 올해 12월까지 남은 결제 횟수 — 짧은 달은 말일, 내년 시작은 0회', () => {
  const was = KRX_PLAN._now;
  KRX_PLAN._now = () => new Date(2026, 9, 11);
  try {
    // 결제일이 2일이면 10월 2일은 이미 지나 11·12월 두 번, 11일이면 오늘 포함 세 번, 10일이면 두 번
    assert.deepEqual([KRX_PLAN.subRemaining('2026-09-02').qty, KRX_PLAN.subRemaining('2026-10-11').qty, KRX_PLAN.subRemaining('2026-10-10').qty, KRX_PLAN.subRemaining('2027-01-05').qty, KRX_PLAN.subRemaining('2025-01-31').qty], [2, 3, 2, 0, 3]);
    assert.equal(KRX_PLAN.subRemaining('2025-01-31').dates.map((d) => d.getDate()).join(','), '31,30,31');
    const e = { id: 'x', name: 'azure', qty: 9, unit: 100, amt: 900, sub: { date: '2026-09-02' } };
    assert.equal(KRX_PLAN.qtyOf(e), 2, '저장값이 아니라 다시 센다');
    assert.equal(KRX_PLAN.amtOf(e), 200);
    assert.deepEqual(KRX_PLAN.projectTotal({ P: { K: [e, { id: 'y', qty: 2, unit: 5, amt: 10 }] } }, 'P'), { sum: 210, count: 2 });
    assert.equal(KRX_PLAN.itemKey({ resCd: '10', exp: '연구활동비' }), '10|연구활동비');
    assert.equal(KRX_PLAN.keyName('10|연구활동비'), '연구활동비');
  } finally { KRX_PLAN._now = was; }
});

console.log('erp — R&D ERP 호출(흉내 fetch)');
/** rERP 서버 흉내 — 서비스 이름마다 답을 정한다. 답은 EUC-KR 이 아니라 UTF-8 로 주되 charset 은 실서버처럼 적는다. */
function fakeErp(routes) {
  const calls = [];
  const enc = new TextEncoder();
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const m = /rnd\.krs\.co\.kr\/(.+)\.jct$/.exec(u);
    if (m) {
      const input = JSON.parse(decodeURIComponent(decodeURIComponent(String(init.body).replace(/^_JSON_=/, ''))));
      calls.push({ service: m[1], input });
      const r = routes[m[1]];
      const out = typeof r === 'function' ? r(input) : r;
      if (out && out.html) return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'text/html; charset=utf-8' : null) }, arrayBuffer: async () => enc.encode('<html>login</html>').buffer };
      return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'application/json; charset=utf-8' : null) }, arrayBuffer: async () => enc.encode(JSON.stringify(out || { COMMON_HEAD: { ERROR: true, CODE: 'X', MESSAGE: `no route ${m[1]}` } })).buffer };
    }
    calls.push({ service: u, input: init || {} });
    const r = routes[u];
    const out = typeof r === 'function' ? r(init) : r;
    return { ok: true, status: 200, redirected: false, url: u, headers: { get: () => null }, text: async () => String(out ?? ''), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return calls;
}
const BUDGET_REC = [
  { RES_NM: '산업부', RES_CD: '10', MARK_EXP_NM: '인건비', BGT_AMT: '31425000', APPR_AMT: '12345000', REQ_AMT: '0', BAL_AMT: '19080000', DIR_COST_YN: 'N', PSNL_COST_YN: 'Y' },
  { RES_NM: '산업부', RES_CD: '10', MARK_EXP_NM: '연구활동비', BGT_AMT: '43700000', APPR_AMT: '19712839', REQ_AMT: '148500', BAL_AMT: '23838661', DIR_COST_YN: 'Y', PSNL_COST_YN: 'N' },
  { RES_NM: '산업부', RES_CD: '10', MARK_EXP_NM: '연구시설·장비비', BGT_AMT: '15000000', APPR_AMT: '0', REQ_AMT: '0', BAL_AMT: '15000000', DIR_COST_YN: 'Y', PSNL_COST_YN: 'N' },
  { RES_NM: '산업부', RES_CD: '10', MARK_EXP_NM: '간접비', BGT_AMT: '23629000', APPR_AMT: '5000000', REQ_AMT: '0', BAL_AMT: '18629000', DIR_COST_YN: 'N', PSNL_COST_YN: 'N' },
];
await ta('call: _JSON_ 이중 인코딩으로 보내고 COMMON_HEAD 오류는 kind 로 — GWM0001·HTML 은 login', async () => {
  const calls = fakeErp({ ok_svc: { COMMON_HEAD: { ERROR: false }, REC: [{ A: 1 }] }, bad_svc: { COMMON_HEAD: { ERROR: true, CODE: 'GWM0001', MESSAGE: '사용자 정보가 존재하지 않습니다' } }, html_svc: { html: true }, svc_err: { COMMON_HEAD: { ERROR: true, CODE: 'E1', MESSAGE: '잘못된 요청' } } });
  assert.deepEqual((await ERP.call('ok_svc', { PRJ_NO: 'P1', NM: '한글' })).REC, [{ A: 1 }]);
  assert.deepEqual(calls[0].input, { PRJ_NO: 'P1', NM: '한글' });
  await assert.rejects(() => ERP.call('bad_svc', {}), (e) => e.kind === 'login' && e.code === 'GWM0001');
  await assert.rejects(() => ERP.call('html_svc', {}), (e) => e.kind === 'login');
  await assert.rejects(() => ERP.call('svc_err', {}), (e) => e.kind === 'service' && /잘못된 요청/.test(e.message));
});
await ta('fetchBudget: 비목별 잔액 — 제외 비목(인건비·연구수당·간접비)은 합계에서 빠지고, 집행비율은 둘 다 양수일 때 소수 2자리 절사 · withPending 으로 미청구·승인전 반영', async () => {
  fakeErp({ rcomm_0041_01_r004: (input) => (input.PRJ_NO === 'P1' && input.REQ_CNT === '-1' && input.INCLUDE_TAX === 'Y' ? { COMMON_HEAD: {}, REC: BUDGET_REC } : { COMMON_HEAD: {}, REC: [] }) });
  const b = await ERP.fetchBudget('P1', settingsOf());
  assert.equal(b.std, '10');
  assert.deepEqual(b.items.map((x) => [x.exp, x.excluded, x.rate]), [['인건비', true, 39.28], ['연구활동비', false, 45.1], ['연구시설·장비비', false, 0], ['간접비', true, 21.16]]);
  assert.deepEqual([b.bgtAmt, b.apprAmt, b.balAmt, b.reqAmt, b.rate, b.resCount, b.exclNames], [58700000, 19712839, 38838661, 148500, 33.58, 1, ['인건비', '간접비']]);
  withPending(b, 523000, 2);
  assert.deepEqual([b.pending, b.execAmt, b.balAfter, b.rateAll, b.pendingRate], [671500, 20384339, 38315661, 34.72, 1.14]);
  assert.equal(execRate(19712839, 43700000), 45.1);
  assert.equal(trunc(45.109, 2), 45.1);
  const b2 = await ERP.fetchBudget('P1', settingsOf({ budgetItemInclude: { 인건비: true } }));
  assert.equal(b2.bgtAmt, 58700000 + 31425000, '설정에서 고른 비목은 들어간다');
});
await ta('fetchBudget: 과제예산(r004)이 0건이면 과제 상세의 예산기준이 본예산(20)일 때 r006 으로 대체', async () => {
  const calls = fakeErp({
    rcomm_0041_01_r004: { COMMON_HEAD: {}, REC: [] },
    rcomm_0102_01_r001: { COMMON_HEAD: {}, BGT_STD_CD: '20', BIZSECTION_CD: 'B1' },
    rcomm_0041_01_r006: (input) => ({ COMMON_HEAD: {}, REC: input.BIZSECTION_CD === 'B1' ? [{ BGT_ITEM_NM: '연구활동비', ATIT_NM: '회의비', BGT_AMT: '1000', APPR_AMT: '100', BAL_AMT: '900' }] : [] }),
  });
  const b = await ERP.fetchBudget('P2', settingsOf());
  assert.equal(b.std, '20');
  assert.deepEqual(b.items.map((x) => [x.exp, x.item, x.bal]), [['연구활동비', '회의비', 900]]);
  assert.deepEqual(calls.map((c) => c.service), ['rcomm_0041_01_r004', 'rcomm_0102_01_r001', 'rcomm_0041_01_r006']);
});
await ta('fetchProjectRecs / fetchProjects: 과제번호×연차 행 → 과제마다 연차 큰 행 하나, 진행 과제만', async () => {
  const recs = [
    { PRJ_NO: 'P1', ANL: '1', PRJ_NM: 'MW급 차단기', PRJ_RSPR_EMP_NM: '박기도', PROG_STS_NM: '진행', RCH_ST_DT: '20260401', RCH_END_DT: '20270331' },
    { PRJ_NO: 'P1', ANL: '2', PRJ_NM: 'MW급 차단기', PRJ_RSPR_EMP_NM: '박기도', PROG_STS_NM: '진행', RCH_ST_DT: '20270401', RCH_END_DT: '20280331' },
    { PRJ_NO: 'P9', ANL: '1', PRJ_NM: '끝난 과제', PRJ_RSPR_EMP_NM: '홍길동', PROG_STS_NM: '완료', RCH_ST_DT: '20200101', RCH_END_DT: '20201231' },
  ];
  const calls = fakeErp({ rcomm_0009_01_r001: { COMMON_HEAD: {}, REC: recs } });
  const pr = await ERP.fetchProjectRecs(settingsOf());
  assert.equal(pr.recs.length, 3);
  assert.deepEqual(calls[0].input, { SEARCH_NM: '', SEARCH_GB: '10', GUBUN: 'A', PRJ_AUTH: '' });
  const list = await ERP.fetchProjects(settingsOf());
  assert.deepEqual(list.map((p) => [p.prjNo, p.anl, p.rspr, p.stDt]), [['P1', '2', '박기도', '20270401']]);
});
await ta('fetchCards: 미청구 카드 사용내역 — 조회 기간은 설정의 N개월, 과제번호 고정', async () => {
  const calls = fakeErp({ rtask_0008_t05_01_r001: { COMMON_HEAD: {}, REC: [{ CARD_NO: '1234567890123456', USER_NM: '김거화', USED_DATE: '20261001', USED_TIME: '120000', SHOP_NAME: '커피', USED_COST: '5000', APPRNO: 'A1', PRJ_NO: 'P1' }] } });
  const cards = await ERP.fetchCards('P1', settingsOf({ monthsBack: 1, monthsForward: 1 }));
  assert.deepEqual(cards.map((c) => [c.tail, c.amount, c.shop]), [['9012-3456', 5000, '커피']]);
  assert.equal(calls[0].input.SEARCH_GB, '1');
  assert.match(calls[0].input.START_DATE, /^\d{8}$/);
});
await ta('ssoLogin: eClass loginCheck 의 UID·SID → sso_login_krs.jct → SYS_LOGIN POST. eClass 세션이 없으면 eclass-login', async () => {
  const calls = fakeErp({
    'https://eclass.krs.co.kr/intra/intranet/Main_N/json/loginCheck_json.aspx?callback=cb&_=1': 'cb({"UID":"u123","SID":"s456"})',
    'jsp/rderp/main/sso_login_krs': (input) => ({ COMMON_HEAD: {}, URL: input.UID === 'u123' && input.SID === 's456' ? 'rderp_layoutMain.act' : '' }),
    'https://rnd.krs.co.kr/jsp/rderp/main/rderp_layoutMain.act': '<html>layout</html>',
  });
  const realNow = Date.now; Date.now = () => 1;
  try {
    const r = await ERP.ssoLogin();
    assert.equal(r.ok, true);
    assert.equal(calls.at(-1).input.body, 'SYS_LOGIN=Y&SSO_PAGE_GB=A');
  } finally { Date.now = realNow; }
  fakeErp({ 'https://eclass.krs.co.kr/intra/intranet/Main_N/json/loginCheck_json.aspx?callback=cb&_=1': 'cb({"UID":"","SID":""})' });
  Date.now = () => 1;
  try { await assert.rejects(() => ERP.ssoLogin(), (e) => e.kind === 'eclass-login'); } finally { Date.now = realNow; }
});

console.log('plussync — 사이드패널 배선(가짜 MCP 서버)');
/** OneNote MCP 서버 흉내 — mcp.js 가 fetch 로 두드리는 자리. 섹션 RERP 하나, 페이지는 메모리. */
function fakeMcpServer(opts = {}) {
  const pages = []; let n = 0; const calls = [];
  // 페이지 id·링크는 Graph 꼴(1-<32자>!<n>-<GUID> · wd=target(…|{GUID}/)) — resolveLink 가 링크의 GUID 로 찾는다
  const guid = (k) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
  const pageId = (k) => `1-${'a'.repeat(32)}!${k}-${guid(k)}`;
  const pageUrl = (k) => `https://krclass-my.sharepoint.com/personal/x/Documents/Notebooks/AIPWork?wd=target%28RERP.one%7C${guid(0)}%2F%EC%A0%9C%EB%AA%A9%7C${guid(k)}%2F%29`;
  const sections = opts.sections || [{ id: 'sec-rerp', display_name: 'RERP', parent_notebook_id: 'nb1', parent_notebook_name: '연구' }];
  const tool = (name, a) => {
    calls.push(`${name}${a.action ? `:${a.action}` : ''}`);
    if (name === 'read_onenote' && a.action === 'list_sections') return { success: true, sections };
    if (name === 'read_onenote' && a.action === 'list_pages') return { success: true, pages: pages.filter((p) => !a.section_id || p.section === a.section_id).map((p) => ({ page_id: p.id, title: p.title, web_url: p.url, section_id: p.section })) };
    if (name === 'sync_onenote_db') return { success: true };
    if (name === 'write_onenote' && a.action === 'create_page') { ++n; const p = { id: pageId(n), section: a.section_id, title: a.title, url: pageUrl(n), body: a.content }; pages.push(p); return { success: true, page: { id: p.id, web_url: p.url, title: p.title } }; }
    if (name === 'write_onenote' && a.action === 'create_section') { const s = { id: `sec${++n}`, display_name: a.title, parent_notebook_id: a.notebook_id, parent_notebook_name: '연구' }; sections.push(s); return { success: true, section: { id: s.id, display_name: s.display_name } }; }
    const p = pages.find((x) => x.id === a.page_id);
    if (!p) throw new Error('page not found');
    if (a.action === 'get_content') return { success: true, content: `<html><head><title>${p.title}</title></head><body>${p.body.replace('<table data-id', '<table id="table:{t}{1}" data-id')}</body></html>` };
    if (a.action === 'replace') { p.body = p.body.replace(/<table[\s\S]*<\/table>/, a.content); return { success: true }; }
    if (a.action === 'append') { p.body += a.content; return { success: true }; }
    throw new Error(`모르는 도구 ${name}`);
  };
  globalThis.fetch = async (url, init) => {
    if (init.method === 'DELETE') return { ok: true, status: 200, headers: { get: () => null }, text: async () => '' };
    const msg = JSON.parse(init.body);
    const reply = (result) => ({ ok: true, status: 200, headers: { get: (h) => (h === 'mcp-session-id' ? 's-1' : h === 'content-type' ? 'text/event-stream' : null) }, text: async () => `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n` });
    if (msg.method === 'initialize') return reply({ protocolVersion: '2025-06-18' });
    if (!('id' in msg)) return { ok: true, status: 202, headers: { get: () => null }, text: async () => '' };
    if (msg.method === 'tools/list') return reply({ tools: [{ name: 'read_onenote', inputSchema: { properties: { include_ids: {} } } }, { name: 'write_onenote', inputSchema: { properties: { action: { enum: ['append', 'replace', 'create_page', 'create_section'] } } } }, { name: 'sync_onenote_db' }] });
    let out;
    try { out = tool(msg.params.name, msg.params.arguments || {}); } catch (e) { return reply({ content: [{ type: 'text', text: JSON.stringify({ success: false, error: e.message }) }], isError: true }); }
    return reply({ content: [{ type: 'text', text: JSON.stringify(out) }], isError: false });
  };
  return { pages, calls, sections };
}
/** chrome.storage.local 흉내 — rerp 와 같은 키(plannedExpenses · plannedDeleted · plusSection · plusPlanPages · planSyncState). */
function fakeChrome(init = {}) {
  const store = { ...init };
  globalThis.chrome = { storage: { local: { get: async (k) => (Array.isArray(k) ? Object.fromEntries(k.map((x) => [x, store[x]])) : typeof k === 'string' ? { [k]: store[k] } : { ...store }), set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); }, remove: async () => {} } } };
  return store;
}
await ta('꺼져 있으면 아무 데도 닿지 않고 skipped', async () => {
  const srv = fakeMcpServer();
  fakeChrome();
  const ps = createPlusSync({ settings: () => ({ enabled: false }), context: () => ({}) });
  const r = await ps.send({ type: 'planSync', reason: 'load' });
  assert.deepEqual([r.ok, r.skipped], [false, 'off']);
  assert.deepEqual(srv.calls, []);
  assert.equal(PLUS_DEFAULTS.sectionName, 'RERP');
  assert.equal(PLUS_DEFAULTS.onenoteMcpUrl, 'http://localhost:5005/mcp');
});
await ta('켜면 RERP 섹션을 찾아(캐시 plusSection) 책임 과제의 페이지를 만들고 planSyncState·plusPlanPages 에 남긴다 — 책임자가 아닌 과제는 noPage', async () => {
  const srv = fakeMcpServer();
  const store = fakeChrome({ plannedExpenses: { P1: { '10|연구활동비': [{ id: 'a', name: '회의비', qty: 3, unit: 50000, amt: 150000, ts: 5 }] }, P2: { '10|연구활동비': [{ id: 'b', name: '장비', qty: 1, unit: 10, amt: 10, ts: 5 }] } } });
  const ps = createPlusSync({ settings: () => ({ enabled: true }), context: () => ({ names: { P1: '차단기', P2: '수소' }, myPrjNos: ['P1', 'P2'], leadPrjNos: ['P1'], who: '김거화' }), version: '0.4.0' });
  const r = await ps.send({ type: 'planSync', reason: 'manual' });
  assert.equal(r.ok, true);
  assert.equal(r.sectionId, 'sec-rerp');
  assert.equal(r.pages.P1.created, true);
  assert.equal(r.pages.P1.title, '[예상 비용] P1 차단기');
  assert.equal(r.pages.P2.noPage, true);
  assert.equal(r.waiting, 1);
  assert.equal(srv.pages[0].title, '[예상 비용] P1 차단기');
  assert.ok(/krxplan1:/.test(srv.pages[0].body));
  assert.equal(store.plusSection.id, 'sec-rerp');
  assert.equal(store.plusPlanPages.P1.pageId, srv.pages[0].id);
  assert.equal(store.planSyncState.reason, 'manual');
  // 막 맞췄으면 load 는 건너뛴다
  const again = await ps.send({ type: 'planSync', reason: 'load' });
  assert.equal(again.skipped, 'recent');
});
await ta('RERP 섹션이 없고 노트북이 여럿이면 kind notebook 으로 고르게 하고, 노트북을 주면 만든다 (plusResolveSection)', async () => {
  const srv = fakeMcpServer({ sections: [{ id: 's1', display_name: '회의', parent_notebook_id: 'nb1', parent_notebook_name: '연구' }, { id: 's2', display_name: '메모', parent_notebook_id: 'nb2', parent_notebook_name: '개인' }] });
  fakeChrome();
  let plus = { enabled: true };
  const ps = createPlusSync({ settings: () => plus, context: () => ({ names: {}, myPrjNos: [], leadPrjNos: [], who: '' }) });
  const r = await ps.send({ type: 'plusResolveSection' });
  assert.deepEqual([r.ok, r.kind, r.notebooks.map((n) => n.name)], [false, 'notebook', ['연구', '개인']]);
  plus = { enabled: true, notebookId: 'nb2' };
  const r2 = await ps.send({ type: 'plusResolveSection' });
  assert.deepEqual([r2.ok, r2.section.name, r2.section.notebook, r2.section.created], [true, 'RERP', '개인', true]);
  assert.ok(srv.calls.includes('write_onenote:create_section'));
  const nb = await ps.send({ type: 'plusNotebooks' });
  assert.deepEqual(nb.notebooks.map((n) => n.id), ['nb1', 'nb2']);
  const probe = await ps.send({ type: 'plusProbe' });
  assert.deepEqual([probe.ok, probe.check.replace, probe.check.includeIds], [true, true, true]);
});
await ta('내보내기는 페이지를 만들고 링크+ID 를 복사하며, 가져오기는 동료의 링크를 이 과제에 묶고(bound) 바로 맞춘다', async () => {
  const srv = fakeMcpServer();
  const store = fakeChrome({ plannedExpenses: { P1: { K: [{ id: 'a', name: '내것', qty: 1, unit: 10, amt: 10, ts: 5 }] } } });
  const copied = [];
  const ps = createPlusSync({ settings: () => ({ enabled: true }), context: () => ({ names: { P1: '차단기' }, myPrjNos: ['P1'], leadPrjNos: ['P1'], who: '나' }), copyText: async (t) => { copied.push(t); return true; } });
  const ex = await ps.send({ type: 'planExport', prjNo: 'P1' });
  assert.equal(ex.copied, true);
  assert.equal(copied[0], `${srv.pages[0].url}\n[예상 비용 페이지 ID] ${srv.pages[0].id}`);
  // 동료(책임자 아님, 섹션 없음)가 그 링크를 붙여 넣는다
  fakeChrome({ plannedExpenses: { P1: { K: [{ id: 'b', name: '동료것', qty: 2, unit: 5, amt: 10, ts: 7 }] } } });
  const mate = createPlusSync({ settings: () => ({ enabled: true }), context: () => ({ names: {}, myPrjNos: ['P1'], leadPrjNos: [], who: '동료' }) });
  const bind = await mate.send({ type: 'planBind', prjNo: 'P1', text: copied[0] });
  assert.equal(bind.ok, true);
  assert.equal(bind.bound, true);
  assert.equal(bind.pages.P1.pulled, true, '책임자 항목을 받았다');
  assert.equal(bind.pages.P1.pushed, true, '내 항목을 올렸다');
  assert.equal(S.parse(O.findBlock(srv.pages[0].body, 'krx-plan').inner).items.length, 2);
  assert.ok(store.plusPlanPages.P1, '처음 사람의 캐시는 그대로');
  const bad = await mate.send({ type: 'planBind', prjNo: 'P1', text: '엉뚱한 글' });
  assert.equal(bad.kind, 'badlink');
});
await ta('서버가 없으면 kind offline 으로 상태에 남기고 던지지 않는다 · 모르는 요청', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const store = fakeChrome();
  const ps = createPlusSync({ settings: () => ({ enabled: true }), context: () => ({ names: {}, myPrjNos: [], leadPrjNos: [], who: '' }) });
  const r = await ps.send({ type: 'planSync', reason: 'manual' });
  assert.deepEqual([r.ok, r.kind], [false, 'offline']);
  assert.equal(store.planSyncState.kind, 'offline');
  assert.match((await ps.send({ type: 'what' })).error, /모르는 요청/);
  const bad = await ps.send({ type: 'plusProbe', url: 'https://evil.example/mcp' });
  assert.equal(bad.kind, 'badurl');
});

console.log(`\n${pass} passed`);
