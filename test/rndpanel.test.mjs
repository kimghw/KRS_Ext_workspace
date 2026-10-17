// R&D 탭의 화면(rndpanel.js) — 과제·차년도 칩, 예산 줄(계획을 고치면 변경이력에 저절로), 연구내역·변경이력 적기·고치기·지우기(두 번),
// 과제 더하기·고치기(책임자·연구기간을 바꾸면 변경이력에 저절로)·지우기, 요약 복사·JSON 저장·불러오기, 공문 탭의 과제 가져오기, 다시 열기.
// 진짜 화면(sidepanel.html)에 붙여 눌러 본다. 어디에도 보내지 않는다 — 저장소는 흉내이고 날짜는 2026-10-08 로 못 박는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import { readZip } from '../src/zip.js';
import { PAGE_TITLE, blockHtml, findBlock, readBlock } from '../src/rndnote.js';
import PLAN_SYNC from '../rerp/plansync.js';
import { normalizeBook } from '../src/rnd.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok) => { for (let i = 0; i < 80 && !ok(); i++) await wait(25); };

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { window } = new JSDOM(html, { url: 'https://example.org/' });
const doc = window.document;
for (const g of ['document', 'FileReader', 'Element', 'HTMLElement', 'File', 'Blob']) globalThis[g] = window[g];
globalThis.window = window;

// 공문 탭의 공문 설정에 과제 하나가 있다. 저장은 복사해 둔다 — 정말 저장이 됐는지 보려고.
const store = { gongmunProjects: [{ name: 'MVDC 차단기 개발', alias: '차단기 과제', code: 'RND-20-2026', lead: '박기도', period: '2026.04.01 ~ 2029.12.31', about: '', content: '', account: '' }] };
globalThis.chrome = { storage: { local: { get: async () => store, set: async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); } } } };

// rerp/plan.js 의 내보내기(⬆)는 navigator.clipboard 로 바로 복사한다 — 패널의 copyText 와 같은 바구니(copied)에 담는다.
const copied = [];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'rndpanel-test', clipboard: { writeText: async (text) => { copied.push(text); } } } });

const { createRndPanel } = await import('../rndpanel.js');
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logs = [];
const downloads = [];
const flashed = [];
// 원노트 흉내(KR_MS365_mcp 의 onenote 서버 자리) — 섹션 하나, 페이지는 글(body)로 둔다. 다른 기기가 고친 것은 body 를 직접 바꿔 흉내 낸다.
// 목록(list_pages)은 서버 PC 의 저장분이라 sync_onenote_db 뒤에야 다른 데서 만든 페이지가 보인다.
const one = { up: true, pages: [], listed: [], calls: [], n: 0 };
const fakeNote = {
  async tool(name, a) {
    one.calls.push(`${name}${a.action ? `:${a.action}` : ''}`);
    const fail = (error) => { throw new Error(error); };
    if (name === 'read_onenote' && a.action === 'list_sections') return { sections: [{ id: 's1', display_name: 'R&D', parent_notebook_name: '연구' }] };
    if (name === 'read_onenote' && a.action === 'list_pages') return { pages: one.listed.filter((p) => p.section === a.section_id).map((p) => ({ page_id: p.id, title: p.title, web_url: p.url })) };
    if (name === 'sync_onenote_db') { one.listed = [...one.pages]; return { success: true }; }
    if (name === 'write_onenote' && a.action === 'create_page') {
      const p = { id: `p${++one.n}`, section: a.section_id, title: a.title, url: `https://onenote.example/p${one.n}`, body: a.content };
      one.pages.push(p);
      one.listed.push(p);
      return { success: true, page: { id: p.id, web_url: p.url } };
    }
    const p = one.pages.find((x) => x.id === a.page_id) || fail('page not found');
    // Graph 처럼 생성 id 를 붙여 돌려주고, replace 는 그 id 로만 받는다.
    if (a.action === 'get_content') return { success: true, content: `<html><head><title>${p.title}</title></head><body>${p.body.replace('<table data-id', '<table id="table:{t1}{1}" data-id')}</body></html>` };
    if (a.action === 'replace') { if (a.target !== 'table:{t1}{1}') fail('bad target'); p.body = p.body.replace(/<table[\s\S]*<\/table>/, a.content); return { success: true }; }
    if (a.action === 'append') { p.body += a.content; return { success: true }; }
    return fail(`모르는 도구 ${name}`);
  },
};
// rERP 흉내(rerp/erp.js 자리) — 과제 목록(recs)·비목별 잔액(items)·미청구 카드(cards)를 검사가 정한다. 처음엔 비어 있어 저절로 잇기가 "목록이 비어 있습니다" 로 끝난다.
const erpFake = {
  recs: [], items: [], cards: [], loggedIn: true, calls: [],
  settingsOf: (o) => ({ ...o }),
  async fetchProjectRecs() { erpFake.calls.push('recs'); if (!erpFake.loggedIn) throw Object.assign(new Error('rcomm_0009_01_r001: 사용자 정보가 존재하지 않습니다'), { kind: 'login' }); return { recs: erpFake.recs, calls: [], capped: false, firstErr: null }; },
  async fetchBudget(prjNo) {
    erpFake.calls.push(`budget:${prjNo}`);
    if (!erpFake.loggedIn) throw Object.assign(new Error('rcomm_0041_01_r004: 사용자 정보가 존재하지 않습니다'), { kind: 'login' });
    const items = erpFake.items.map((x) => ({ ...x, bal: x.bal ?? x.bgt - x.appr - (x.req || 0), rate: x.bgt > 0 && x.appr > 0 ? Math.trunc(x.appr / x.bgt * 10000) / 100 : 0, excluded: /인건비|연구수당|간접비/.test(x.exp) }));
    const inc = items.filter((x) => !x.excluded);
    const sum = (k) => inc.reduce((s, x) => s + (x[k] || 0), 0);
    const bgtAmt = sum('bgt'), apprAmt = sum('appr');
    return { std: '10', items, bgtAmt, apprAmt, balAmt: sum('bal'), reqAmt: sum('req'), rate: bgtAmt > 0 && apprAmt > 0 ? Math.trunc(apprAmt / bgtAmt * 10000) / 100 : 0, exclNames: items.filter((x) => x.excluded).map((x) => x.exp), resCount: new Set(items.map((x) => x.resCd)).size };
  },
  async fetchCards(prjNo) { erpFake.calls.push(`cards:${prjNo}`); return erpFake.cards; },
  withPending(b, unbilled, count) { b.unbilled = unbilled; b.unbilledCount = count; b.pending = unbilled + (b.reqAmt || 0); b.execAmt = b.apprAmt + b.pending; b.balAfter = b.balAmt - unbilled; b.rateAll = b.bgtAmt > 0 && b.execAmt > 0 ? Math.trunc(b.execAmt / b.bgtAmt * 10000) / 100 : 0; b.pendingRate = b.bgtAmt > 0 && b.pending > 0 ? Math.trunc(b.pending / b.bgtAmt * 10000) / 100 : 0; return b; },
  async ssoLogin() { erpFake.calls.push('sso'); if (erpFake.eclassDown) throw Object.assign(new Error('eClass 로그인이 풀려 R&D ERP 자동 로그인(SSO)을 못 했습니다'), { kind: 'eclass-login' }); erpFake.loggedIn = true; return { ok: true }; },
};
// 예상 비용 원노트 동기화가 두드릴 OneNote MCP 서버 흉내(rerp/mcp.js 가 fetch 로 부른다) — 섹션 RERP 하나, 페이지는 메모리. test/rerp.test.mjs 의 것과 같은 꼴.
const mcp = { pages: [], calls: [], up: true, n: 0 };
const mcpGuid = (k) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
const mcpTool = (name, a) => {
  mcp.calls.push(`${name}${a.action ? `:${a.action}` : ''}`);
  if (name === 'read_onenote' && a.action === 'list_sections') return { success: true, sections: [{ id: 'sec-rerp', display_name: 'RERP', parent_notebook_id: 'nb1', parent_notebook_name: '연구' }] };
  if (name === 'read_onenote' && a.action === 'list_pages') return { success: true, pages: mcp.pages.filter((p) => !a.section_id || p.section === a.section_id).map((p) => ({ page_id: p.id, title: p.title, web_url: p.url, section_id: p.section })) };
  if (name === 'sync_onenote_db') return { success: true };
  if (name === 'write_onenote' && a.action === 'create_page') { const k = ++mcp.n; const p = { id: `1-${'b'.repeat(32)}!${k}-${mcpGuid(k)}`, section: a.section_id, title: a.title, url: `https://krclass-my.sharepoint.com/x?wd=target%28RERP.one%7C${mcpGuid(0)}%2Fp%7C${mcpGuid(k)}%2F%29`, body: a.content }; mcp.pages.push(p); return { success: true, page: { id: p.id, web_url: p.url, title: p.title } }; }
  const p = mcp.pages.find((x) => x.id === a.page_id);
  if (!p) throw new Error('page not found');
  if (a.action === 'get_content') return { success: true, content: `<html><head><title>${p.title}</title></head><body>${p.body.replace('<table data-id', '<table id="table:{t}{1}" data-id')}</body></html>` };
  if (a.action === 'replace') { p.body = p.body.replace(/<table[\s\S]*<\/table>/, a.content); return { success: true }; }
  if (a.action === 'append') { p.body += a.content; return { success: true }; }
  throw new Error(`모르는 도구 ${name}`);
};
const mcpFetch = async (url, init) => {
  if (!mcp.up) throw new TypeError('Failed to fetch');
  if (init.method === 'DELETE') return { ok: true, status: 200, headers: { get: () => null }, text: async () => '' };
  const msg = JSON.parse(init.body);
  const reply = (result) => ({ ok: true, status: 200, headers: { get: (h) => (h === 'mcp-session-id' ? 's-1' : h === 'content-type' ? 'text/event-stream' : null) }, text: async () => `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n` });
  if (msg.method === 'initialize') return reply({ protocolVersion: '2025-06-18' });
  if (!('id' in msg)) return { ok: true, status: 202, headers: { get: () => null }, text: async () => '' };
  if (msg.method === 'tools/list') return reply({ tools: [{ name: 'read_onenote' }, { name: 'write_onenote' }, { name: 'sync_onenote_db' }] });
  try { return reply({ content: [{ type: 'text', text: JSON.stringify(mcpTool(msg.params.name, msg.params.arguments || {})) }], isError: false }); }
  catch (e) { return reply({ content: [{ type: 'text', text: JSON.stringify({ success: false, error: e.message }) }], isError: true }); }
};
let myName = '박기도';   // 설정의 내 이름 — 예상 비용 페이지는 과제책임자(== 내 이름)만 만든다
// R&D PMS 과제 목록 흉내(Job Id 저절로 찾기가 받는다 — 줄은 PMS 그대로의 꼴, src/jobid.js slimJob 이 줄인다). 검사가 rows 를 정하고, fail 이 있으면 받지 못한 것으로.
const jobsFake = { rows: [], fail: '', calls: 0 };
// 회계(e-accounting) 흉내(회계 I/O 저절로 찾기·회계 예산 스냅샷 — src/eacct.js 의 fetchIoList·fetchAcct 자리). options 는 내 부서 과제(I/O) 목록, acct 는 받을 스냅샷(과제 코드 → 줄), fail 은 못 받은 까닭(login 이면 로그인).
const acctFake = { options: [], acct: {}, fail: '', login: false, lists: 0, gets: 0 };
const acctErr = () => { const e = new Error(acctFake.fail); e.login = acctFake.login; return e; };
const make = () => createRndPanel({
  erp: erpFake, me: () => myName, mcpFetch,
  jobs: async () => { jobsFake.calls++; if (jobsFake.fail) throw new Error(jobsFake.fail); return jobsFake.rows; },
  acct: {
    list: async () => { acctFake.lists++; if (acctFake.fail) throw acctErr(); return acctFake.options; },
    get: async (year, io) => { acctFake.gets++; if (acctFake.fail) throw acctErr(); return acctFake.acct[io] ? { year, at: '2026-10-08T09:30:00.000Z', io, ...acctFake.acct[io] } : null; },
  },
  openNote: async () => (one.up ? fakeNote : Promise.reject(new Error('이 PC 의 OneNote MCP 서버(http://localhost:5005/mcp)에 닿지 않습니다'))),
  $: (id) => doc.getElementById(id), escapeHtml,
  logEvent: (kind, ok, text) => logs.push({ kind, ok, text }),
  copyText: async (text) => { copied.push(text); return true; },
  flash: (btn, text) => flashed.push([btn.id, text]),
  download: async (text, name, type) => { downloads.push({ text, name, type }); },
  // 확장 안의 파일(rnd/skills.json · rnd/skills/…)은 저장소에서 읽는다.
  readAsset: async (p, as) => { const buf = fs.readFileSync(new URL(`../${p}`, import.meta.url)); return as === 'bytes' ? new Uint8Array(buf) : buf.toString('utf8'); },
  today: () => '2026-10-08',
});
let panel = make();
panel.wire();
await panel.show();

const $ = (id) => doc.getElementById(id);
const q = (sel) => doc.querySelector(sel);
const type = (node, value, ev = 'input') => { node.value = value; node.dispatchEvent(new window.Event(ev, { bubbles: true })); };
/** 다 적고 칸을 나간다(input 뒤 change). */
const commit = (node, value) => { type(node, value); node.dispatchEvent(new window.Event('change', { bubbles: true })); };
const chips = () => [...$('rdProjects').querySelectorAll('[data-proj]')].map((b) => [b.textContent, b.classList.contains('active')]);
const years = () => [...$('rdYears').querySelectorAll('[data-year]')].map((b) => `${b.textContent}${b.classList.contains('active') ? '*' : ''}`);
/** 예산 정보가 없어 회색으로 잠긴 차년도 칩들. */
const locked = () => [...$('rdYears').querySelectorAll('[data-year].off')].map((b) => b.dataset.year);
const rows = () => [...$('rdBudget').querySelectorAll('.rd-brow')].map((r) => [r.querySelector('[data-k="item"]').value, r.querySelector('[data-k="plan"]').value, r.querySelector('[data-k="used"]').value, r.querySelector('[data-left]').textContent]);
const row = (item) => [...$('rdBudget').querySelectorAll('.rd-brow')].find((r) => r.querySelector('[data-k="item"]').value === item);
const sum = () => [...$('rdBudgetSum').children].map((s) => s.textContent);
// 연구내역의 줄들만(:scope > li) — 계획서에서 온 줄 안에는 목록(li)이 더 있다.
const logItems = () => [...$('rdLogs').querySelectorAll(':scope > li')].map((li) => [li.querySelector('.rd-date').textContent, li.querySelector('.rd-title').textContent, li.querySelector('.rd-text')?.textContent || '']);
/** 계획서에서 온 줄의 꼴 — 참여연구자 표의 줄들, 계획의 절 제목들. */
const rosterTable = (li) => [...li.querySelectorAll('.rd-table tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));
const sectionHeads = (li) => [...li.querySelectorAll('.rd-sec h4')].map((h) => h.textContent);
const chItems = () => [...$('rdChanges').querySelectorAll('li')].map((li) => [
  li.querySelector('.rd-date').textContent, li.querySelector('.rd-kind').textContent, li.querySelector('.rd-title').textContent,
  li.querySelector('.rd-diff')?.textContent || '', li.querySelector('.rd-reason')?.textContent || '', li.classList.contains('auto'),
]);
const status = () => $('rdStatus').textContent;
const hidden = (id) => $(id).classList.contains('hidden');
/** 머리의 접힌 과제 정보 — "과제번호 RND-20-2026 · 책임자 박기도 · …" 처럼 이어서. */
const metaText = () => [...$('rdMeta').querySelectorAll('div')].map((d) => `${d.querySelector('dt').textContent} ${d.querySelector('dd').textContent}`).join(' · ');
/** 복사 아이콘을 누른 뒤 — 체크로 바뀌었는가. */
const copiedIcon = (id) => $(id).classList.contains('done') && !!$(id).querySelector('svg');

console.log('처음 열기 — 공문 탭의 과제를 가져온다');
t('과제 칩 하나(별칭)가 켜져 있고 머리는 별칭 한 줄 — 과제명·번호·책임자·연구기간(총 4차년도)은 접힌 과제 정보 안에', () => {
  assert.deepEqual(chips(), [['차단기 과제', true]]);
  assert.ok(hidden('rdEmpty'));
  assert.ok(!hidden('rdHead'));
  assert.ok(!hidden('rdBody'));
  assert.ok(hidden('rdForm'));
  assert.equal($('rdName').textContent, '차단기 과제');
  assert.equal($('rdName').title, 'MVDC 차단기 개발');
  assert.ok(!$('rdInfo').open, '과제 정보는 처음엔 접혀 있다');
  assert.ok($('rdInfo').querySelector('summary').contains($('rdEdit')) && $('rdEdit').querySelector('svg'), '과제 고치기는 머리 줄 별칭 옆의 연필 아이콘(2026-10-16)');
  assert.ok(hidden('rdAliasAsk'), '별칭이 있으면 정하는 칸은 없다');
  assert.match(metaText(), /MVDC 차단기 개발.*과제번호 RND-20-2026.*책임자 박기도.*연구기간 2026\.04\.01 ~ 2029\.12\.31 \(총 4차년도\)/);
  assert.match(status(), /공문 탭의 과제 1개를 가져왔습니다/);
  assert.ok(logs.some((l) => l.kind === 'rnd' && /처음 열 때/.test(l.text)));
});
t('차년도 칩은 넷, 오늘(2026-10-08)이 든 1차년도가 켜져 있고 "올해" 표시 — 예산이 없는 2·3·4차년도는 회색으로 잠겨 있다', () => {
  assert.deepEqual(years(), ['1차년도올해*', '2차년도', '3차년도', '4차년도']);
  assert.equal(q('#rdYears .rd-year.now').dataset.year, '1');
  assert.deepEqual(locked(), ['2', '3', '4']);
  assert.equal(q('#rdYears [data-year="2"]').title, '2027.04.01 ~ 2028.03.31 · 예산 정보가 들어 있지 않습니다');
  assert.equal(q('#rdYears [data-year="2"]').getAttribute('aria-disabled'), null, '잠긴 칩도 누를 수 있다(2026-10-11 사용자 지정 — 넘어가면 기록 칸 대신 R&D 설정이 선다)');
  assert.equal($('rdYearNote').textContent, '1차년도 · 2026.04.01 ~ 2027.03.31 · 진행 중');
  assert.ok(hidden('rdYearEmpty'), '예산이 든(올해) 차년도에는 까닭 카드가 없다');
});
t('기본 비목 여섯 줄, 아직 적은 것 없음 · 계획서가 없으면 참여연구자·연구개발 계획은 넣는 곳을 짚는다 · 변경이력 구분 다섯', () => {
  assert.deepEqual(rows().map((r) => r[0]), ['인건비', '연구시설·장비비', '연구재료비', '연구활동비', '연구수당', '간접비']);
  assert.equal($('rdBudgetState').textContent, '적은 것 없음');
  assert.deepEqual([$('rdRosterState').textContent, $('rdPlanState').textContent], ['계획서 없음', '계획서 없음']);
  assert.match($('rdRoster').textContent, /맨 아래 칸에 연구개발계획서 YAML/);
  assert.ok(hidden('rdRosterTools') && hidden('rdPlanTools'), '복사할 것이 없으면 복사 아이콘도 없다');
  assert.ok(!$('rdRosterBox').open && !$('rdPlanBox').open && !$('rdLogBox').open, '참여연구자·연구개발 계획·진행 기록은 접혀 있다');
  assert.ok($('rdBudgetBox').open, '예산만 펴져 있다');
  assert.deepEqual([...$('rdBody').querySelectorAll(':scope > details > summary > span:first-of-type')].map((s) => s.textContent), ['예산', '참여인력', '연구개발 계획', '진행 기록', '변경 및 이력 관리']);
  // 변경 및 이력 관리(2026-10-16 사용자 지정 — 변경사항 반영 카드가 접혀 있던 변경이력 칸을 대체): 진행 기록 아래 카드 하나 —
  // 위는 rndgen 의 YAML 고치기(#rdgRevise), 아래는 변경이력(직접 적기 · 복사 · 목록). 손으로 적는 칸은 직접 적기를 누를 때만.
  // 같은 날 사용자 지정 "접어라" — 다른 칸처럼 접힌 한 줄(아이콘 · 이름 · 변경이력 형편 · 꺾쇠)로 선다.
  assert.equal($('rdChangeBox').tagName, 'DETAILS');
  assert.ok(!$('rdChangeBox').open, '변경 및 이력 관리도 접혀 있다');
  assert.equal($('rdChangeState').parentElement.tagName, 'SUMMARY', '변경이력 건수는 접힌 머리 줄에');
  assert.equal($('rdChangeBox').previousElementSibling.id, 'rdLogBox');
  assert.equal($('rdChangeTitle').textContent, '변경 및 이력 관리');
  assert.ok($('rdChangeBox').contains($('rdgRevise')) && $('rdChangeBox').contains($('rdChanges')));
  assert.ok($('rdgRevise').compareDocumentPosition($('rdChanges')) & window.Node.DOCUMENT_POSITION_FOLLOWING, 'YAML 고치기가 위, 변경이력이 아래');
  assert.ok(hidden('rdChForm') && !hidden('rdChNew'));
  assert.ok(!$('rnd').textContent.includes('연구내역'), '"연구내역" 이라는 말은 화면에 없다');
  // R&D 설정(2026-10-11 사용자 지정) — 탭 맨 아래 접힌 한 줄 안에 rERP 집행내역 체크 · 원노트 공유 · 연구개발계획서 YAML 넣기 · 차년도 YAML 뽑는 스킬
  assert.equal($('rnd').lastElementChild.id, 'rdSetBox');
  assert.ok(!$('rdSetBox').open, 'R&D 설정은 접혀 있다');
  // 2026-10-11 사용자 지정 — 공문 탭의 공문 설정(gmPresetBox)과 같은 카드 한 줄: 아이콘 · 이름 · 형편(summary-detail) · 화살표
  assert.ok($('rdSetBox').classList.contains('card') && $('rdSetBox').classList.contains('rd-box'), 'R&D 설정은 공문 설정처럼 카드');
  assert.deepEqual([...$('rdSetBox').querySelectorAll(':scope > summary > *')].map((x) => x.tagName.toLowerCase() + (x.getAttribute('class') ? `.${x.getAttribute('class')}` : '')), ['svg', 'span', 'span.summary-detail']);
  assert.deepEqual([...$('rdSetBox').querySelectorAll(':scope > .rd-set-body > *')].map((x) => x.id || x.className), ['rd-check rd-set-check', 'rdItemBox', 'rdNoteBox', 'rdIntake', 'rdSkillBox']);
  assert.ok($('rdErpOn').checked, 'rERP 집행내역은 기본 켬');
  // 예산 칸에 보일 비목(2026-10-11 사용자 지정) — 계획서의 여섯 비목이 모두 켜진 채 늘어선다
  assert.deepEqual([...$('rdItems').querySelectorAll('label')].map((l) => [l.textContent, l.querySelector('input').checked]), [['인건비', true], ['연구시설·장비비', true], ['연구재료비', true], ['연구활동비', true], ['연구수당', true], ['간접비', true]]);
  // 집행에 더하기(미청구·사용계획 — 승인전 체크는 2026-10-11 사용자 지정으로 뺌)는 예산 칸 맨 위 줄 — 복사 아이콘 왼쪽(2026-10-11 사용자 지정으로 R&D 설정에서 옮김)
  assert.equal($('rdIncRow').closest('details').id, 'rdBudgetBox', '집행에 더하기는 예산 칸 안');
  assert.equal($('rdIncRow').parentElement, $('rdBudgetBox').querySelector('.rd-box-body').firstElementChild, '예산 칸 맨 위 줄');
  assert.equal($('rdIncRow').nextElementSibling.id, 'rdBudgetCopy', '복사 아이콘 왼쪽');
  assert.ok(!hidden('rdIncRow'));
  assert.equal($('rdIncReq'), null, '승인전 체크는 없다');
  assert.deepEqual([$('rdIncUnbilled').checked, $('rdIncPlan').checked], [false, false], '집행은 승인액만이 기본');
  assert.equal($('rdSetState').textContent, 'rERP 켬 · 원노트 꺼짐', '형편은 공문 설정처럼 한 줄에 들어가게 짧게');
  assert.equal($('rdSkillBox').previousElementSibling.id, 'rdIntake', '연구개발계획서 넣기는 스킬 칸 바로 위');
  assert.equal($('rdLogState').textContent, '적은 것 없음');
  assert.equal($('rdChangeState').textContent, '적은 것 없음');
  assert.deepEqual([...$('rdChKind').options].map((o) => o.value), ['예산', '연구내용', '연구기간', '연구진', '기타']);
  assert.equal($('rdLogDate').value, '2026-10-08');
});
await ta('저장소(rndBook)에 남는다', async () => {
  await wait(500);
  assert.equal(store.rndBook.projects.length, 1);
  assert.deepEqual([store.rndBook.projects[0].alias, store.rndBook.projects[0].start, store.rndBook.projects[0].end], ['차단기 과제', '2026-04-01', '2029-12-31']);
});

console.log('예산');
t('계획을 1,000만처럼 적으면 원으로 읽어 천원으로 보이고(2026-10-11 사용자 지정), 처음 적는 것은 변경이 아니다', () => {
  commit(row('인건비').querySelector('[data-k="plan"]'), '1,000만');
  assert.equal(row('인건비').querySelector('[data-k="plan"]').value, '10,000');
  assert.equal(row('인건비').querySelector('[data-left]').textContent, '10,000');
  assert.deepEqual(sum(), ['합계', '10,000', '0', '10,000', '']);
  assert.equal($('rdBudgetState').textContent, '계획 1,000만 · 집행 0원 (0%)');
  assert.equal(chItems().length, 0);
  assert.match(doc.querySelector('#rdBudgetBox .rd-bhead').textContent, /계획\(천원\)집행\(천원\)/);
});
t('집행을 천원 숫자로 적으면(8,000 = 800만원) 잔액·집행률 — 막대 80%. 집행은 변경이 아니다', () => {
  commit(row('인건비').querySelector('[data-k="used"]'), '8,000');
  assert.equal(row('인건비').querySelector('[data-left]').textContent, '2,000');
  assert.equal(row('인건비').querySelector('.rd-bar').style.width, '80%');
  assert.equal($('rdBudgetState').textContent, '계획 1,000만 · 집행 800만 (80%)');
  assert.equal(chItems().length, 0);
});
t('계획을 고치면 변경이력에 저절로 남고 사유를 묻는다', () => {
  commit(row('인건비').querySelector('[data-k="plan"]'), '1,500만');
  assert.deepEqual(chItems(), [['2026.10.08', '예산', '인건비', '10,000,000원→15,000,000원', '', true]]);
  assert.equal($('rdChangeState').textContent, '1건 · 사유 없음 1');
  assert.match(status(), /변경이력에 1건을 남겼습니다/);
  assert.ok($('rdChanges').querySelector('[data-reason]'), '줄 안에 사유 칸');
  assert.deepEqual(sum(), ['합계', '15,000', '8,000', '7,000', '']);
});
t('줄 안의 사유 칸에 적으면 붙는다', () => {
  commit($('rdChanges').querySelector('[data-reason]'), '연구원 1명 충원');
  assert.equal(chItems()[0][4], '연구원 1명 충원');
  assert.equal($('rdChangeState').textContent, '1건');
  assert.ok(!$('rdChanges').querySelector('[data-reason]'));
});
t('못 읽는 금액은 되돌리고 말한다', () => {
  commit(row('인건비').querySelector('[data-k="plan"]'), 'abc');
  assert.equal(row('인건비').querySelector('[data-k="plan"]').value, '15,000');
  assert.match(status(), /금액을 읽지 못했습니다.*천원 단위/);
  assert.equal(chItems().length, 1);
});
t('집행이 계획을 넘으면 잔액이 빨갛고 막대도 넘침 — 단위를 붙이면(2천만) 그 단위로 읽는다', () => {
  commit(row('인건비').querySelector('[data-k="used"]'), '2천만');
  assert.equal(row('인건비').querySelector('[data-left]').textContent, '-5,000');
  assert.ok(row('인건비').querySelector('[data-left]').classList.contains('over'));
  assert.ok(row('인건비').querySelector('.rd-bar').classList.contains('over'));
  assert.equal(row('인건비').querySelector('.rd-bar').style.width, '100%');
  commit(row('인건비').querySelector('[data-k="used"]'), '8,000');
  assert.ok(!row('인건비').querySelector('[data-left]').classList.contains('over'));
  assert.equal(panel.book().projects[0].years[1].budget[0].used, 8000000, '저장은 원');
});
t('비목 더하기 단추는 없다(2026-10-11 사용자 지정 — 비목은 계획서의 여섯 비목). 빈 줄은 바로 빼고 금액 있는 줄은 두 번 — 뺀 비목도 변경이력에', () => {
  assert.equal($('rdBudgetAdd'), null, '비목 더하기 단추가 없다');
  assert.equal(rows().length, 6);
  row('연구재료비').querySelector('[data-del]').click();
  assert.equal(rows().length, 5, '빈 줄은 바로');
  commit(row('연구수당').querySelector('[data-k="plan"]'), '300만');
  assert.equal(chItems().length, 1, '처음 적는 계획은 변경이 아니다');
  const del = row('연구수당').querySelector('[data-del]');
  del.click();
  assert.equal(rows().length, 5, '한 번으로는 안 뺀다');
  assert.equal(del.textContent, '정말');
  del.click();
  assert.equal(rows().length, 4);
  assert.deepEqual(chItems()[0].slice(1, 4), ['예산', '연구수당', '3,000,000원→(비목 뺌)']);
  assert.equal($('rdChangeState').textContent, '2건 · 사유 없음 1');
});

console.log('진행 기록(손으로 적는 것)');
t('제목을 적고 기록 — 늦은 것부터, 내용은 여러 줄, 칸은 비운다', () => {
  type($('rdLogTitle'), '차단기 시제품 1차 시험');
  type($('rdLogText'), '10kV 인가\n차단 성공');
  $('rdLogAdd').click();
  type($('rdLogDate'), '2026-06-15');
  type($('rdLogTitle'), '설계 검토회');
  $('rdLogAdd').click();
  assert.deepEqual(logItems(), [['2026.10.08', '차단기 시제품 1차 시험', '10kV 인가\n차단 성공'], ['2026.06.15', '설계 검토회', '']]);
  assert.equal($('rdLogState').textContent, '2건');
  assert.equal($('rdLogTitle').value, '');
  assert.equal($('rdLogDate').value, '2026-10-08');
});
t('빈 채로 기록은 안 된다 · Enter 로도 기록', () => {
  $('rdLogAdd').click();
  assert.equal(logItems().length, 2);
  assert.match(status(), /제목이나 내용을 적으세요/);
  type($('rdLogTitle'), 'Enter 로 적음');
  $('rdLogTitle').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(logItems().length, 3);
  const del = q('#rdLogs li [data-del]');
  del.click();
  del.click();
  assert.equal(logItems().length, 2);
});
t('고치기 → 칸에 올라오고 저장하면 바뀐다 · 그만두기', () => {
  q('#rdLogs li:nth-child(2) [data-edit]').click();
  assert.equal($('rdLogTitle').value, '설계 검토회');
  assert.equal($('rdLogDate').value, '2026-06-15');
  assert.equal($('rdLogAdd').textContent, '저장');
  assert.ok(!hidden('rdLogCancel'));
  assert.ok(q('#rdLogs li:nth-child(2)').classList.contains('editing'));
  type($('rdLogTitle'), '설계 검토회(2차)');
  $('rdLogAdd').click();
  assert.equal(logItems()[1][1], '설계 검토회(2차)');
  assert.equal($('rdLogAdd').textContent, '기록');
  assert.ok(hidden('rdLogCancel'));
  q('#rdLogs li [data-edit]').click();
  $('rdLogCancel').click();
  assert.equal($('rdLogTitle').value, '');
  assert.ok(!q('#rdLogs li.editing'));
});
t('지우기는 두 번', () => {
  const del = q('#rdLogs li:nth-child(2) [data-del]');
  del.click();
  assert.equal(logItems().length, 2);
  assert.equal(del.textContent, '정말 지우기');
  del.click();
  assert.equal(logItems().length, 1);
  assert.match(status(), /진행 기록을 지웠습니다/);
});

console.log('변경이력 — 손으로');
t('직접 적기로 연 칸에 구분·항목·전후·사유를 적고 기록하면 날짜 차례에 들어가고 칸은 비우고 닫는다', () => {
  $('rdChNew').click();
  assert.ok(!hidden('rdChForm') && hidden('rdChNew'), '직접 적기를 누르면 적는 칸이 열리고 단추는 숨는다');
  assert.equal($('rdChAdd').textContent, '기록');
  type($('rdChDate'), '2026-09-20');
  $('rdChKind').value = '연구내용';
  type($('rdChItem'), '2차년도 목표');
  type($('rdChBefore'), '10kV');
  type($('rdChAfter'), '12kV');
  type($('rdChReason'), '발주처 요청');
  $('rdChAdd').click();
  assert.deepEqual(chItems().at(-1), ['2026.09.20', '연구내용', '2차년도 목표', '10kV→12kV', '발주처 요청', false]);
  assert.equal($('rdChangeState').textContent, '3건 · 사유 없음 1');
  assert.equal($('rdChKind').value, '예산');
  assert.equal($('rdChItem').value, '');
  assert.ok(hidden('rdChForm') && !hidden('rdChNew'), '기록하면 칸이 닫힌다');
  $('rdChNew').click();
  $('rdChAdd').click();
  assert.equal(chItems().length, 3, '빈 채로는 안 된다');
  assert.match(status(), /항목이나 변경 전·후를 적으세요/);
  assert.ok(!hidden('rdChForm'), '못 적으면 칸은 열린 채');
  $('rdChCancel').click();
  assert.ok(hidden('rdChForm') && !hidden('rdChNew'), '취소하면 닫힌다');
});
t('고치기·지우기(두 번)', () => {
  q('#rdChanges li:last-child [data-edit]').click();
  assert.ok(!hidden('rdChForm'), '줄의 고치기도 적는 칸을 연다');
  assert.equal($('rdChItem').value, '2차년도 목표');
  assert.equal($('rdChKind').value, '연구내용');
  assert.equal($('rdChAdd').textContent, '저장');
  type($('rdChAfter'), '12.5kV');
  $('rdChAdd').click();
  assert.equal(chItems().at(-1)[3], '10kV→12.5kV');
  assert.ok(hidden('rdChForm'));
  const del = q('#rdChanges li:last-child [data-del]');
  del.click();
  assert.equal(chItems().length, 3);
  del.click();
  assert.equal(chItems().length, 2);
});

console.log('차년도 바꾸기');
// 2026-10-11 사용자 지정 — "3·4차년도처럼 비활성이면 이전 차년도 기록을 보여주지 말고 R&D 설정을 열어서": 넘어가되 상관없는 예산·참여연구자·계획·기록 칸은 숨긴다.
t('예산 정보가 없는 2차년도를 누르면 넘어간다 — 1차년도의 예산·참여연구자·계획·기록 칸은 숨고, 까닭 카드와 R&D 설정(YAML 넣기)이 저절로 펴진다', () => {
  assert.ok(!$('rdSetBox').open);
  q('#rdYears [data-year="2"]').click();
  assert.deepEqual(years(), ['1차년도올해', '2차년도*', '3차년도', '4차년도']);
  assert.deepEqual(locked(), ['2', '3', '4'], '보고 있어도 예산이 없으면 점선 그대로');
  assert.equal(status(), '', '까닭은 카드에만 — 상태 줄에 같은 말을 또 적지 않는다');
  assert.equal($('rdYearNote').textContent, '2차년도 · 2027.04.01 ~ 2028.03.31 · 예정');
  assert.ok(hidden('rdBody'), '예산·참여연구자·연구개발 계획·진행 기록·변경이력·요약 복사는 없다');
  assert.ok(!hidden('rdYearEmpty'));
  assert.match($('rdYearEmpty').textContent, /^2차년도 — 예산 정보가 들어 있지 않습니다\. 아래 R&D 설정의 연구개발계획서 YAML 넣기에/);
  // YAML 고치기(rndgen — 2026-10-16)는 변경 및 이력 관리 카드 안이라 기록 칸과 함께 숨는다(이 카드와 함께 서지 않는다).
  assert.equal($('rdYearEmpty').nextElementSibling.id, 'rdBody', '까닭 카드는 상태 줄 아래, 숨은 기록 칸 자리 위');
  assert.ok($('rdBody').contains($('rdgRevise')));
  assert.ok($('rdSetBox').open, 'R&D 설정이 저절로 펴진다');
  assert.ok($('rdSetBox').contains($('rdIntake')), 'YAML 넣는 칸이 그 안에');
  // 예산이 든 1차년도로 돌아오면 기록 칸이 다시 서고, 저절로 편 설정은 도로 접힌다.
  q('#rdYears [data-year="1"]').click();
  assert.deepEqual(years(), ['1차년도올해*', '2차년도', '3차년도', '4차년도']);
  assert.ok(!hidden('rdBody') && hidden('rdYearEmpty'));
  assert.ok(!$('rdSetBox').open, '저절로 편 것은 도로 접는다');
  assert.equal(status(), '');
  assert.equal(rows().find((r) => r[0] === '인건비')[1], '15,000');
});
t('R&D 설정을 손으로 펴 두었으면 예산 없는 차년도를 오가도 그대로 펴져 있다', () => {
  $('rdSetBox').open = true;
  q('#rdYears [data-year="3"]').click();
  assert.ok($('rdSetBox').open && hidden('rdBody') && !hidden('rdYearEmpty'));
  assert.match($('rdYearEmpty').textContent, /^3차년도 — /);
  q('#rdYears [data-year="1"]').click();
  assert.ok($('rdSetBox').open, '손으로 편 것은 접지 않는다');
  $('rdSetBox').open = false;
});
t('장부에 2차년도 예산이 들어가면(계획서 YAML 이 넣듯) 그 칩이 열린다 — 누르면 그 차년도의 장부, 1차년도로 돌아오면 그대로', () => {
  // 계획서 YAML 넣기가 하는 일을 장부에 바로 — 비목 한 줄에 계획만.
  panel.book().projects[0].years[2] = { budget: [{ id: 'y2-a', item: '인건비', plan: 20000000, used: null }], logs: [], changes: [] };
  q('#rdYears [data-year="2"]').click();
  assert.deepEqual(years(), ['1차년도올해', '2차년도*', '3차년도', '4차년도']);
  assert.deepEqual(locked(), ['3', '4'], '예산이 든 2차년도는 더는 잠기지 않는다');
  assert.equal($('rdYearNote').textContent, '2차년도 · 2027.04.01 ~ 2028.03.31 · 예정');
  assert.deepEqual(rows().map((r) => [r[0], r[1]]), [['인건비', '20,000']]);
  assert.equal(logItems().length, 0);
  assert.equal(chItems().length, 0);
  q('#rdYears [data-year="1"]').click();
  assert.deepEqual(years(), ['1차년도올해*', '2차년도', '3차년도', '4차년도']);
  assert.deepEqual(locked(), ['3', '4']);
  assert.equal(logItems().length, 1);
  assert.equal(chItems().length, 2);
  assert.equal(rows().find((r) => r[0] === '인건비')[1], '15,000');
});
await ta('보고 있던 차년도가 저장된다 — 예산 없는 3차년도로 넘어간 것도 남는다(다시 열면 그 자리에 까닭 카드와 R&D 설정)', async () => {
  q('#rdYears [data-year="2"]').click();
  await wait(500);
  const id = store.rndBook.projects[0].id;
  assert.equal(store.rndBook.current.year[id], 2);
  assert.ok(!hidden('rdBody') && !$('rdSetBox').open, '예산이 든 2차년도는 보통대로');
  q('#rdYears [data-year="3"]').click();
  await wait(500);
  assert.equal(store.rndBook.current.year[id], 3);
  assert.deepEqual(years(), ['1차년도올해', '2차년도', '3차년도*', '4차년도']);
  assert.ok(hidden('rdBody') && $('rdSetBox').open);
  q('#rdYears [data-year="1"]').click();
  assert.ok(!$('rdSetBox').open);
});

console.log('과제 더하기·고치기·지우기');
t('＋ → 폼이 서고 머리·몸통은 숨는다. 과제명 없이는 저장 안 됨', () => {
  q('#rdProjects [data-add]').click();
  assert.ok(!hidden('rdForm'));
  assert.ok(hidden('rdHead'));
  assert.ok(hidden('rdBody'));
  assert.ok(hidden('rdFDel'));
  assert.equal($('rdFormTitle').textContent, '새 과제');
  $('rdFSave').click();
  assert.equal($('rdFNeed').textContent, '과제명을 적으세요.');
  assert.ok(!hidden('rdForm'));
});
t('별칭은 필수이고 다른 과제와 겹치면 안 된다(띄어쓰기·대소문자 무시)', () => {
  type($('rdFName'), '수소 추진');
  $('rdFSave').click();
  assert.match($('rdFNeed').textContent, /^별칭을 적으세요/);
  assert.ok(!hidden('rdForm'));
  type($('rdFAlias'), '차단기  과제');
  $('rdFSave').click();
  assert.equal($('rdFNeed').textContent, '같은 별칭의 과제가 있습니다 — MVDC 차단기 개발');
  assert.ok(!hidden('rdForm'));
});
t('종료일이 시작일보다 앞서면 안 됨', () => {
  type($('rdFAlias'), '수소');
  type($('rdFStart'), '2027-01-01');
  type($('rdFEnd'), '2026-12-31');
  $('rdFSave').click();
  assert.equal($('rdFNeed').textContent, '종료일이 시작일보다 앞섭니다.');
});
t('저장하면 칩이 둘(별칭)이고 새 과제가 켜진다 — 연구기간 없는 과제는 1차년도 하나·미정', () => {
  type($('rdFStart'), '');
  type($('rdFEnd'), '');
  $('rdFSave').click();
  assert.deepEqual(chips(), [['차단기 과제', false], ['수소', true]]);
  assert.equal(q('#rdProjects .active').title, '수소 추진', '칩의 툴팁은 과제명');
  assert.ok(hidden('rdForm'));
  assert.ok(!hidden('rdHead'));
  assert.deepEqual(years(), ['1차년도*']);
  assert.match(metaText(), /연구기간 미정/);
  assert.equal($('rdYearNote').textContent, '1차년도 · 연구기간 미정');
  assert.ok(logs.some((l) => l.kind === 'rnd' && /과제 더함: 수소 추진/.test(l.text)));
});
t('칩을 누르면 그 과제로', () => {
  q('#rdProjects [data-proj]').click();
  assert.deepEqual(chips(), [['차단기 과제', true], ['수소', false]]);
  assert.equal(chItems().length, 2);
});
t('과제 고치기 — 책임자·연구기간을 바꾸면 변경이력에 저절로 두 줄', () => {
  $('rdEdit').click();
  assert.equal($('rdFormTitle').textContent, '과제 고치기');
  assert.equal($('rdFName').value, 'MVDC 차단기 개발');
  assert.equal($('rdFLead').value, '박기도');
  assert.equal($('rdFEnd').value, '2029-12-31');
  assert.ok(!hidden('rdFDel'));
  type($('rdFLead'), '김철수');
  type($('rdFEnd'), '2030-03-31');
  $('rdFSave').click();
  assert.match(metaText(), /책임자 김철수.*2026\.04\.01 ~ 2030\.03\.31 \(총 4차년도\)/);
  assert.deepEqual(chItems().slice(0, 2).map((c) => c.slice(1, 4)), [
    ['연구기간', '연구기간', '2026.04.01 ~ 2029.12.31→2026.04.01 ~ 2030.03.31'], ['연구진', '과제책임자', '박기도→김철수'],
  ]);
  assert.equal($('rdChangeState').textContent, '4건 · 사유 없음 3');
  assert.match(status(), /변경이력에 2건을 남겼습니다/);
});
t('Enter 로 저장 · Esc 로 닫기 · 과제 지우기는 두 번', () => {
  $('rdEdit').click();
  type($('rdFNote'), '산업부');
  $('rdFNote').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.ok(hidden('rdForm'));
  assert.match(metaText(), /산업부/);
  assert.equal(chItems().length, 4, '비고는 이력이 아니다');
  doc.querySelectorAll('#rdProjects [data-proj]')[1].click();
  $('rdEdit').click();
  $('rdForm').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(hidden('rdForm'));
  $('rdEdit').click();
  $('rdFDel').click();
  assert.equal($('rdFDel').textContent, '정말 지우기');
  assert.equal(chips().length, 2);
  $('rdFDel').click();
  assert.deepEqual(chips(), [['차단기 과제', true]]);
  assert.ok(hidden('rdForm'));
  assert.match(status(), /과제를 지웠습니다 — 수소/);
});

console.log('요약 복사 · JSON 저장·불러오기 · 공문 탭의 과제 가져오기');
await ta('요약 복사 — 보고 있는 과제·차년도의 개요·예산·연구내역·변경이력', async () => {
  $('rdCopy').click();
  await wait(10);
  assert.equal(copied.length, 1);
  assert.match(copied[0], /^\[차단기 과제\] 1차년도 \(2026\.04\.01 ~ 2027\.03\.31\) — 진행 중\n/);
  assert.match(copied[0], /- 인건비: 계획 15,000,000원 · 집행 8,000,000원 · 잔액 7,000,000원 · 집행률 53%/);
  assert.match(copied[0], /- 2026\.10\.08 차단기 시제품 1차 시험\n  10kV 인가\n  차단 성공\n/);
  assert.match(copied[0], /\[연구진\] 과제책임자: 박기도 → 김철수/);
  assert.deepEqual(flashed.at(-1), ['rdCopy', '복사했습니다 ✓']);
});
await ta('JSON 저장', async () => {
  $('rdExport').click();
  await wait(10);
  assert.equal(downloads[0].name, 'R&D과제_2026-10-08.json');
  const obj = JSON.parse(downloads[0].text);
  assert.equal(obj.kind, 'rndBook');
  assert.equal(obj.projects.length, 1);
  assert.match(status(), /저장했습니다 — R&D과제_2026-10-08\.json/);
});
await ta('JSON 불러오기 — 같은 id 는 파일 것으로, 없던 과제는 더함', async () => {
  const obj = JSON.parse(downloads[0].text);
  obj.projects[0].years[1].logs.push({ id: 'from-file', date: '2026-07-07', title: '파일에서 온 기록' });
  obj.projects.push({ id: 'new-from-file', name: '파일 과제', start: '2026-01-01', end: '2026-12-31' });
  const file = new window.File([JSON.stringify(obj)], 'rnd.json', { type: 'application/json' });
  Object.defineProperty($('rdImport'), 'files', { value: [file], configurable: true });
  $('rdImport').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(60);
  assert.deepEqual(chips(), [['차단기 과제', true], ['파일 과제', false]]);
  assert.ok(logItems().some((l) => l[1] === '파일에서 온 기록'));
  assert.match(status(), /들여왔습니다 — 바꿈 1 · 더함 1 \(과제 2개\)/);
});
await ta('못 읽는 파일은 말만 하고 아무것도 바꾸지 않는다', async () => {
  const file = new window.File(['{"x":1}'], 'bad.json');
  Object.defineProperty($('rdImport'), 'files', { value: [file], configurable: true });
  $('rdImport').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(60);
  assert.match(status(), /들여오지 못했습니다 — R&D 과제 파일이 아닙니다/);
  assert.equal(chips().length, 2);
  assert.ok(logs.some((l) => l.kind === 'rnd' && !l.ok && /불러오기 실패/.test(l.text)));
});
await ta('공문 탭의 과제 가져오기 — 이미 있으면 그대로(빈 칸만 채움), 새것은 더한다, 다시 누르면 달라질 것 없음', async () => {
  store.gongmunProjects.push({ name: '수소전기추진 연구', alias: '', code: 'RND-21-2026', lead: '노길태', period: '', about: '', content: '', account: '' });
  $('rdImportGm').click();
  await wait(20);
  assert.deepEqual(chips().map((c) => c[0]), ['차단기 과제', '파일 과제', '수소전기추진 연구']);
  assert.match(status(), /공문 탭의 과제를 가져왔습니다 — 더함 1$/);
  assert.match(metaText(), /책임자 김철수/, '있는 칸은 공문 탭 것으로 덮지 않는다');
  $('rdImportGm').click();
  await wait(20);
  assert.match(status(), /이미 다 있습니다/);
  assert.equal(chips().length, 3);
});

console.log('연구개발계획서 YAML 넣기 — RND 폴더의 KR_<과제>.yaml · history/*.yaml');
const fx = (name) => fs.readFileSync(new URL(`./fixtures/rnd/${name}`, import.meta.url), 'utf8');
const dropFiles = (files, target = $('rnd')) => {
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files, types: ['Files'], dropEffect: '' } });
  target.dispatchEvent(ev);
  return ev;
};
const paste = (text, target = doc.body) => {
  const ev = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: { files: [], getData: () => text, types: ['text/plain'] } });
  target.dispatchEvent(ev);
  return ev;
};
await ta('스냅샷을 탭 어디에나 끌어다 놓으면 과제가 생기고(1월 1일 기준 차년도) 예산·계획·참여연구자가 들어간다', async () => {
  const ev = dropFiles([new window.File([fx('snapshot_r0.yaml')], 'KR_test.yaml', { type: 'application/x-yaml' })], $('rdLogs'));
  assert.ok(ev.defaultPrevented);
  await until(() => chips().length === 4);
  assert.deepEqual(chips().map((c) => c[0]), ['차단기 과제', '파일 과제', '수소전기추진 연구', '시험용 직류 차단기 개발']);
  assert.equal(chips().at(-1)[1], true, '넣은 과제가 켜진다');
  assert.deepEqual(years(), ['1차년도올해*', '2차년도', '3차년도', '4차년도']);
  assert.equal($('rdYearNote').textContent, '1차년도 · 2026.04.01 ~ 2026.12.31 · 진행 중');
  // 공문 참조자(파일의 공문.참조자 — 공문 종류마다)는 과제 정보에 보이기만 한다. 적는 곳은 YAML 이다(2026-10-15).
  assert.match(metaText(), /과제번호 RS-2026-00000001.*책임자 홍길동.*공문 참조자 구매 이몽룡 \/ 교육 성춘향.*연구기간 2026\.04\.01 ~ 2029\.12\.31 \(총 4차년도 · 1월 1일 기준\).*산업통상부/);
  assert.deepEqual(rows().map((r) => [r[0], r[1]]), [['인건비', '30,000'], ['연구시설·장비비', ''], ['연구재료비', ''], ['연구활동비', '50,000'], ['연구수당', '6,000'], ['간접비', '20,000']]);
  assert.equal($('rdBudgetState').textContent, '계획 1.1억 · 집행 0원 (0%)');
  // 계획서에서 온 두 줄은 진행 기록이 아니라 저마다의 칸에 — 참여연구자는 표로, 계획은 절 제목과 번호·점 목록으로(글은 그대로).
  assert.deepEqual(logItems(), [], '진행 기록에는 없다');
  const roster = $('rdRoster');
  const plan = $('rdPlan');
  assert.equal($('rdRosterState').textContent, '연구자 3명', '머리 줄은 연구자 수만 — 인건비는 적지 않는다(2026-10-17 사용자 지정)');
  assert.equal($('rdPlanState').textContent, '목표 2개 · 9개월');
  assert.deepEqual([$('rdRosterSrc').textContent, $('rdPlanSrc').textContent], ['연구개발계획서 r0 기준', '연구개발계획서 r0 기준']);
  assert.ok(!hidden('rdRosterTools') && !hidden('rdPlanTools'));
  assert.deepEqual([...roster.querySelectorAll('.rd-table th')].map((th) => th.textContent), ['성명', '직위', '계상률', '참여', '계상인건비']);
  assert.deepEqual(rosterTable(roster), [['이몽룡', '수석', '15%', '9개월', '11,250,000원'], ['홍길동', '수석', '20%', '9개월', '15,000,000원'], ['성춘향', '책임', '10%', '9개월', '3,750,000원']]);
  assert.deepEqual(sectionHeads(plan), ['개발목표', '개발내용', '성능목표', '주요결과물', '수행일정9개월']);
  assert.deepEqual([...plan.querySelectorAll('.rd-sec:first-child ol > li')].map((n) => n.textContent), ['규정 공백 분석 및 평가 기준 도출', '용어 분류 체계 설계']);
  assert.deepEqual([...plan.querySelectorAll('.rd-sec:nth-child(2) > ul > li > ul > li')].map((n) => n.textContent), ['선급규정 및 국제표준 비교', '시험기준 도출', '핵심 개념 추출']);
  assert.equal(plan.querySelector('.rd-sec:nth-child(3) li b').textContent, '규정 공백 분석', '"항목: 값" 은 항목이 굵다');
  assert.ok(!plan.querySelector('.rd-text'), '글 그대로가 아니라 꼴을 입혔다');
  assert.equal(chItems().length, 0, '처음 넣는 것은 기준선');
  assert.match(status(), /^연구개발계획서 스냅샷\(KR_test\.yaml\): 과제 만듦: 시험용 직류 차단기 개발 · 1차년도 · 비목 4개/);
  assert.ok(logs.some((l) => l.kind === 'rnd' && /YAML 넣음 — 연구개발계획서 스냅샷/.test(l.text)));
  assert.ok(!hidden('rdAliasAsk'), '계획서로 만든 과제는 별칭이 없어 정하는 칸이 선다');
});
t('머리에서 별칭 정하기 — 겹치면 안 되고, 정하면 칩·머리가 별칭으로 바뀌고 칸은 걷힌다(Enter 로도)', () => {
  $('rdAliasSet').click();
  assert.match(status(), /별칭을 적으세요/);
  type($('rdAliasIn'), '차단기 과제');
  $('rdAliasSet').click();
  assert.equal(status(), '같은 별칭의 과제가 있습니다 — MVDC 차단기 개발');
  assert.ok(!hidden('rdAliasAsk'));
  type($('rdAliasIn'), 'TEST');
  $('rdAliasIn').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(chips().at(-1)[0], 'TEST');
  assert.equal($('rdName').textContent, 'TEST');
  assert.ok(hidden('rdAliasAsk'));
  assert.equal(status(), '별칭을 정했습니다 — TEST');
  assert.ok(logs.some((l) => l.kind === 'rnd' && /별칭: 시험용 직류 차단기 개발 → TEST/.test(l.text)));
});
await ta('과제 고치기 폼에 1월 1일 기준이 켜져 있다 — 끄면 차년도가 시작일 기준으로 바뀌고 변경이력에 남는다', async () => {
  $('rdEdit').click();
  assert.ok($('rdFCalendar').checked);
  $('rdFCalendar').checked = false;
  $('rdFSave').click();
  assert.deepEqual(years().slice(0, 2), ['1차년도올해*', '2차년도']);
  assert.equal($('rdYearNote').textContent, '1차년도 · 2026.04.01 ~ 2027.03.31 · 진행 중');
  assert.deepEqual(chItems()[0].slice(1, 4), ['연구기간', '차년도 끊는 기준', '1월 1일(첫 해는 시작일부터 12월 31일까지)→시작일부터 한 해씩']);
  $('rdEdit').click();
  $('rdFCalendar').checked = true;
  $('rdFSave').click();
  assert.equal($('rdYearNote').textContent, '1차년도 · 2026.04.01 ~ 2026.12.31 · 진행 중');
  assert.equal(chItems().length, 2);
});
await ta('r2 재생성본과 history 세 파일을 한꺼번에 넣으면 차례대로(스냅샷 → 레지스트리 → 예산 → 참여연구원) 들어가고 변경이력이 선다', async () => {
  dropFiles([
    new window.File([fx('researchers_history.yaml')], 'researchers_history.yaml'),
    new window.File([fx('revisions.yaml')], 'revisions.yaml'),
    new window.File([fx('snapshot_r2.yaml')], 'KR_test_r2.yaml'),
    new window.File([fx('budget_history.yaml')], 'budget_history.yaml'),
  ]);
  await until(() => /참여연구원 이력/.test(status()));
  assert.deepEqual(rows().map((r) => [r[0], r[1]]).filter((r) => r[1]), [['인건비', '30,000'], ['연구시설·장비비', '10,000'], ['연구활동비', '40,000'], ['연구수당', '6,000'], ['간접비', '20,000']]);
  const items = chItems();
  // 앞서 둘(차년도 기준) + 스냅샷 r2 의 달라진 것 셋 + 레지스트리 셋 + 예산 이력은 스냅샷 줄에 사유만 붙임 + 참여연구원 둘
  assert.equal(items.length, 2 + 3 + 3 + 0 + 2);
  assert.ok(items.some((c) => c[1] === '예산' && c[2] === '연구활동비' && c[3] === '50,000,000원→40,000,000원' && c[4] === '연구활동비→연구시설·장비비 10,000 재배분' && c[0] === '2026.07.15'), '스냅샷이 남긴 줄에 예산 이력의 사유·날짜가 붙는다');
  assert.ok(items.some((c) => c[1] === '연구진' && c[2] === '이몽룡' && c[3].endsWith('→제외')));
  assert.ok(items.some((c) => c[0] === '2026.07.15' && c[1] === '예산' && c[2] === 'r2 계획수정'));
  assert.ok(items.some((c) => c[1] === '연구진' && c[2] === '참여연구자' && c[3] === '이몽룡 15% · 홍길동 20% · 성춘향 10%→홍길동 27.45% · 성춘향 20%'));
  assert.match(status(), /^연구개발계획서 스냅샷\(KR_test_r2\.yaml\): .* \/ 개정 레지스트리\(revisions\.yaml\): .* \/ 예산 이력\(budget_history\.yaml\): .*2건에 사유 붙임.* \/ 참여연구원 이력\(researchers_history\.yaml\): .*2건 넣음$/);
  assert.equal($('rdChangeState').textContent, '10건 · 사유 없음 2', '사유가 빈 것은 앞서 손으로 바꾼 차년도 기준 두 줄뿐 — 파일에서 온 줄은 사유가 있다');
  assert.deepEqual(rosterTable($('rdRoster')), [['홍길동', '수석', '27.45%', '9개월', '20,900,000원'], ['성춘향', '책임', '20%', '9개월', '9,100,000원']]);
  assert.equal($('rdRosterState').textContent, '연구자 2명');
  assert.equal($('rdRosterSrc').textContent, '연구개발계획서 r2 기준');
  assert.equal(chips().at(-1)[0], 'TEST', '레지스트리의 project: TEST 는 이미 그 별칭인 과제로 찾았다');
});
await ta('스냅샷을 섞어 놓아도(r2 다음 r0) 판 차례로 넣어 최종본이 남는다 — 오래된 r0 는 넣지 않고 알려 준다', async () => {
  const n = chItems().length;
  dropFiles([new window.File([fx('snapshot_r2.yaml')], 'KR_test_r2.yaml'), new window.File([fx('snapshot_r0.yaml')], 'KR_test.yaml')]);
  await until(() => /오래된 r0/.test(status()));
  assert.equal(status(), '연구개발계획서 스냅샷(KR_test.yaml): TEST 1차년도에는 이미 r2 가 들어 있어 더 오래된 r0 는 넣지 않았습니다 — 최종본(KR_<과제>_rN.yaml)을 넣으세요'
    + ' / 연구개발계획서 스냅샷(KR_test_r2.yaml): 과제 찾음: TEST · 1차년도 · 비목 5개');
  assert.deepEqual(rosterTable($('rdRoster')).map((r) => [r[0], r[2]]), [['홍길동', '27.45%'], ['성춘향', '20%']]);
  assert.equal($('rdRosterSrc').textContent, '연구개발계획서 r2 기준');
  assert.equal(chItems().length, n, '되돌린 변경이력이 생기지 않는다');
});
await ta('칸마다 복사 아이콘 — 예산·참여연구자는 탭으로 나눈 표, 계획은 글 그대로, 변경이력은 전부·한 줄. 누르면 아이콘이 체크로', async () => {
  const n = copied.length;
  for (const id of ['rdBudgetCopy', 'rdRosterCopy', 'rdPlanCopy', 'rdLogsCopy', 'rdChangesCopy']) {
    assert.ok($(id).classList.contains('rd-icon') && $(id).querySelector('svg') && $(id).textContent === '', `${id} 는 글 없는 아이콘`);
    assert.match($(id).getAttribute('aria-label'), /복사$/);
  }
  $('rdBudgetCopy').click();
  await until(() => copied.length === n + 1);
  assert.equal(copied[n], ['비목\t계획(천원)\t집행(천원)\t잔액(천원)\t집행률', '인건비\t30,000\t0\t30,000\t0%', '연구시설·장비비\t10,000\t0\t10,000\t0%', '연구활동비\t40,000\t0\t40,000\t0%', '연구수당\t6,000\t0\t6,000\t0%', '간접비\t20,000\t0\t20,000\t0%', '합계\t106,000\t0\t106,000\t0%'].join('\n'));
  assert.ok(copiedIcon('rdBudgetCopy'), '체크로 바뀐다');
  assert.ok(!flashed.some((f) => f[0] === 'rdBudgetCopy'), '아이콘은 글자를 바꾸는 flash 를 쓰지 않는다');
  $('rdRosterCopy').click();
  await until(() => copied.length === n + 2);
  assert.equal(copied[n + 1], ['참여연구자 — 1차년도', '성명\t직위\t계상률\t참여\t계상인건비', '홍길동\t수석\t27.45%\t9개월\t20,900,000원', '성춘향\t책임\t20%\t9개월\t9,100,000원'].join('\n'));
  $('rdPlanCopy').click();
  await until(() => copied.length === n + 3);
  assert.match(copied[n + 2], /^연구개발 계획 — 1차년도\n■ 개발목표\n1\. 규정 공백 분석/);
  $('rdChangesCopy').click();
  await until(() => copied.length === n + 4);
  const lines = copied[n + 3].split('\n');
  assert.equal(lines.length, 10);
  assert.match(lines[0], /^- 2026\.05\.22 \[기타\] r0 최초협약 \(최초 기준선\)$/);
  assert.ok(lines.includes('- 2026.07.15 [예산] 연구활동비: 50,000,000원 → 40,000,000원 (연구활동비→연구시설·장비비 10,000 재배분)'));
  q('#rdChanges li [data-copy]').click();
  await until(() => copied.length === n + 5);
  assert.match(copied[n + 4], /^2026\.10\.08 \[연구진\] 참여연구자: 이몽룡 15% · 홍길동 20% · 성춘향 10% → 홍길동 27\.45% · 성춘향 20% \(/, '맨 위 줄(같은 날짜면 뒤에 넣은 것)');
  assert.ok(logs.some((l) => l.kind === 'rnd' && /R&D 복사 — 예산 표 \(TEST 1차년도\)/.test(l.text)));
});
await ta('진행 기록에는 손으로 적은 것만 — 전부 복사도 그것만, 줄의 복사도 아이콘', async () => {
  type($('rdLogTitle'), '시제품 설계 검토');
  $('rdLogAdd').click();
  assert.deepEqual(logItems().map((l) => l[1]), ['시제품 설계 검토']);
  assert.equal($('rdLogState').textContent, '1건');
  const n = copied.length;
  $('rdLogsCopy').click();
  await until(() => copied.length === n + 1);
  assert.equal(copied[n], '- 2026.10.08 시제품 설계 검토');
  const rowCopy = q('#rdLogs li [data-copy]');
  assert.ok(rowCopy.classList.contains('rd-icon') && rowCopy.querySelector('svg'));
  rowCopy.querySelector('svg').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));   // 아이콘의 그림을 눌러도
  await until(() => copied.length === n + 2);
  assert.equal(copied[n + 1], '시제품 설계 검토');
});
await ta('붙여 넣은 YAML 글도 읽는다 — project: 값(별칭)으로 과제를 찾고, 칸에 적는 중이면 가로채지 않는다', async () => {
  q('#rdProjects [data-proj]').click();   // 다른 과제를 보고 있어도
  const ev = paste(fx('revisions.yaml').replace('rev: r2', 'rev: r3'));
  assert.ok(ev.defaultPrevented);
  await until(() => /개정 레지스트리/.test(status()));
  assert.equal(chips().at(-1)[1], true, '넣은 과제로 간다');
  assert.equal(chItems().filter((c) => c[2] === 'r3 계획수정').length, 1);
  assert.equal(chItems().length, 11);
  const ev2 = paste('meta:\n  과제명: x', $('rdLogTitle'));
  assert.ok(!ev2.defaultPrevented);
  const ev3 = paste('그냥 글');
  assert.ok(!ev3.defaultPrevented);
});
await ta('YAML 이 아니거나 모르는 모양이면 말만 하고 아무것도 바꾸지 않는다', async () => {
  dropFiles([new window.File(['a: [1, 2'], 'bad.yaml')]);
  await until(() => /읽지 못했습니다/.test(status()));
  assert.match(status(), /^bad\.yaml: YAML 을 읽지 못했습니다/);
  dropFiles([new window.File(['foo: 1\n'], 'other.yaml')]);
  await until(() => /아는 모양/.test(status()));
  dropFiles([new window.File(['x'], 'note.txt')]);
  await wait(30);
  assert.match(status(), /YAML 파일\(\.yaml · \.yml\)만/);
  assert.equal(chItems().length, 11);
  assert.ok(logs.some((l) => l.kind === 'rnd' && !l.ok && /YAML 넣기 실패/.test(l.text)));
});
await ta('과제가 없는 장부에 이력 파일만 넣으면 먼저 스냅샷을 넣으라고 한다', async () => {
  const empty = createRndPanel({ $: (id) => doc.getElementById(id), escapeHtml, logEvent: () => {}, today: () => '2026-10-08', erp: erpFake });
  // 같은 화면을 빌려 쓰되 저장소는 빈 것으로 — 배선은 하지 않고 넣기만 부른다
  const saved = store.rndBook;
  delete store.rndBook;
  const gm = store.gongmunProjects;
  store.gongmunProjects = [];
  await empty.show();
  assert.ok(!hidden('rdEmpty'));
  assert.match($('rdEmpty').textContent, /연구개발계획서 YAML/);
  store.rndBook = saved;
  store.gongmunProjects = gm;
  await panel.show();
});

console.log('차년도 YAML 뽑는 스킬 — 목록·묶음 저장(zip)·쓰는 법 복사');
await ta('칸을 펴면 스킬 다섯 개가 서고, zip 으로 받고(README 가 맨 앞), 쓰는 법을 복사한다', async () => {
  assert.equal($('rdSkills').children.length, 0, '펴기 전에는 읽지 않는다');
  $('rdSkillBox').open = true;
  $('rdSkillBox').dispatchEvent(new window.Event('toggle'));
  await until(() => $('rdSkills').children.length > 0);
  assert.deepEqual([...$('rdSkills').querySelectorAll('li strong')].map((s) => s.textContent), ['rnd-kr-extract', 'rnd-kr-history', 'rnd-manpower-change', 'rnd-budget-change', 'rnd-export-latest']);
  assert.match($('rdSkillState').textContent, /^스킬 5개 · \d+K · 복사 \d{4}-\d{2}-\d{2}$/);
  assert.match(q('#rdSkills li').title, /^인자: /);
  const n = downloads.length;
  $('rdSkillZip').click();
  await until(() => downloads.length === n + 1);
  const d = downloads[n];
  assert.deepEqual([d.name, d.type], ['rnd-skills_2026-10-08.zip', 'application/zip']);
  assert.ok(d.text instanceof Uint8Array);
  const names = readZip(d.text).map((e) => e.name);
  assert.equal(names[0], 'README.md');
  assert.ok(names.includes('rnd-kr-extract/SKILL.md') && names.includes('rnd-kr-history/templates/history/revisions.yaml') && names.includes('rnd-kr-extract/scripts/year_slice.py'));
  assert.equal(names.length, 31);
  assert.match(status(), /스킬 묶음을 저장했습니다 — rnd-skills_2026-10-08\.zip \(\d+K\)\. 과제 작업 프로젝트의 \.claude\/skills\/ 에 푸세요\./);
  assert.deepEqual(flashed.at(-1), ['rdSkillZip', '저장됨 ✓']);
  const c = copied.length;
  $('rdSkillGuide').click();
  await until(() => copied.length === c + 1);
  assert.match(copied[c], /^KRS WORKSPACE — R&D 과제의 차년도 YAML 을 뽑는 Claude Code 스킬 묶음 \(2026-10-08\)\n/);
  assert.match(copied[c], /\n1\. 연구개발계획서\(PDF·HWP\)를 구조화 — \/rnd-kr-extract <계획서\.pdf> --format structured --stage <n>차년도\n/);
  assert.ok(logs.some((l) => l.kind === 'rnd' && /스킬 묶음 저장: rnd-skills_2026-10-08\.zip/.test(l.text)));
});
await ta('목록을 못 읽으면 버튼을 잠그고 까닭을 보인다', async () => {
  // 같은 화면을 빌려 쓰되 배선은 하지 않는다(배선된 패널의 리스너가 이미 붙어 있다) — 읽기만 직접 부른다.
  const broken = createRndPanel({ $: (id) => doc.getElementById(id), escapeHtml, logEvent: () => {}, readAsset: async () => { throw new Error('없음'); }, today: () => '2026-10-08', erp: erpFake });
  assert.equal(await broken.skills(), null);
  assert.match($('rdSkills').textContent, /스킬 목록을 읽지 못했습니다 — 없음/);
  assert.ok($('rdSkillZip').disabled && $('rdSkillGuide').disabled);
  assert.equal($('rdSkillState').textContent, '목록 없음');
  assert.equal(await broken.skills(), null, '다시 불러도 다시 읽지 않고 같은 까닭');
  const m = await panel.skills();
  assert.equal(m.skills.length, 5);
  assert.ok(!$('rdSkillZip').disabled);
  $('rdSkillBox').open = false;
});

console.log('원노트 공유(선택) — 과제 정보만 원노트의 한 페이지에 두고 다른 기기와 맞춘다');
const pageData = () => readBlock(findBlock(one.pages[0].body).inner);
const change = (node, value) => { if (value !== undefined) node.value = value; node.dispatchEvent(new window.Event('change', { bubbles: true })); };
const pickChip = (label) => [...doc.querySelectorAll('#rdProjects [data-proj]')].find((b) => b.textContent === label).click();
t('꺼져 있는 것이 기본 — 아무 데도 닿지 않는다. 칸은 YAML 넣는 곳 위에, 과제가 없어도 보인다(rdBody 밖)', () => {
  assert.equal($('rdNoteState').textContent, '꺼짐');
  assert.ok(!$('rdNoteOn').checked);
  assert.ok($('rdNoteSync').disabled && $('rdNoteSection').disabled);
  assert.deepEqual(one.calls, []);
  assert.equal($('rdNoteBox').nextElementSibling.id, 'rdIntake');
  assert.ok(!$('rdBody').contains($('rdNoteBox')));
  assert.ok($('rdSetBox').contains($('rdNoteBox')), 'R&D 설정 칸 안');
});
await ta('켜면 섹션을 불러와 고르게 한다', async () => {
  $('rdNoteOn').checked = true;
  change($('rdNoteOn'));
  await until(() => $('rdNoteSection').options.length === 2);
  assert.deepEqual([...$('rdNoteSection').options].map((o) => o.textContent), ['섹션 고르기 — 1개', '연구 › R&D']);
  assert.equal($('rdNoteState').textContent, '섹션을 고르세요');
  assert.match($('rdNoteMsg').textContent, /다른 기기에서도 같은 노트북의 같은 섹션/);
  assert.ok($('rdNoteSync').disabled, '섹션을 고르기 전에는 맞출 수 없다');
  assert.ok(logs.some((l) => l.kind === 'rnd' && l.text === 'R&D 원노트 공유 켬'));
});
await ta('섹션을 고르면 페이지를 찾고(없으면 목록을 새로 받은 뒤) 만들어 과제 정보 넷을 표로 쓴다 — 차년도 내용은 올리지 않는다', async () => {
  change($('rdNoteSection'), 's1');
  await until(() => /^맞춤 /.test($('rdNoteState').textContent));
  assert.deepEqual(one.calls, ['read_onenote:list_sections', 'read_onenote:list_pages', 'sync_onenote_db', 'read_onenote:list_pages', 'write_onenote:create_page']);
  assert.equal(one.pages[0].title, PAGE_TITLE);
  assert.deepEqual(pageData().projects.map((p) => p.alias || p.name), ['차단기 과제', '파일 과제', '수소전기추진 연구', 'TEST']);
  assert.ok(!/인건비|시제품 설계 검토|참여연구자/.test(one.pages[0].body), '예산·기록·참여연구자는 원노트에 없다');
  assert.equal($('rdNoteMsg').textContent, '맞췄습니다 — 원노트에 씀 (과제 4개)');
  assert.ok(!hidden('rdNoteOpen'));
  assert.equal($('rdNoteOpen').href, 'https://onenote.example/p1');
  await wait(10);
  assert.deepEqual([store.rndNote.on, store.rndNote.sectionId, store.rndNote.sectionLabel, store.rndNote.pageId], [true, 's1', '연구 › R&D', 'p1']);
});
await ta('다른 기기에서 고친 것(별칭)과 더한 과제를 지금 맞추기로 받는다 — 달라진 것이 원노트 쪽뿐이면 페이지는 그대로', async () => {
  const d = pageData();
  const later = Date.now() + 1000;
  const projects = d.projects.map((p) => (p.name === '파일 과제' ? { ...p, alias: '파일', ts: later } : p));
  projects.push({ id: 'other1', name: '다른 기기 과제', alias: 'OTHER', code: '', lead: '', start: '', end: '', calendar: false, note: '', ts: later });
  one.pages[0].body = blockHtml({ projects, del: d.del });
  const n = one.calls.length;
  $('rdNoteSync').click();
  await until(() => chips().some((c) => c[0] === 'OTHER'));
  await until(() => !$('rdNoteSync').disabled);
  assert.deepEqual(chips().map((c) => c[0]), ['차단기 과제', '파일', '수소전기추진 연구', 'TEST', 'OTHER']);
  assert.equal($('rdNoteMsg').textContent, '맞췄습니다 — 원노트에서 더함 1 · 받아 고침 1 (과제 5개)');
  assert.deepEqual(one.calls.slice(n), ['read_onenote:get_content'], '기억해 둔 페이지를 바로 읽고, 쓸 것은 없다');
});
await ta('이 기기에서 과제를 지우면 잠깐 뒤 저절로 맞춰 원노트에 묘비가 선다', async () => {
  pickChip('OTHER');
  $('rdEdit').click();
  $('rdFDel').click();
  $('rdFDel').click();
  assert.ok(!chips().some((c) => c[0] === 'OTHER'));
  await until(() => pageData().del.other1 > 0);
  assert.ok(!pageData().projects.some((p) => p.id === 'other1'));
  assert.ok(one.calls.at(-1) === 'write_onenote:replace', '있던 표를 생성 id 로 통째로 바꾼다');
  assert.ok(logs.some((l) => l.kind === 'rnd' && /R&D 원노트 맞춤\(고침\)/.test(l.text)));
});
await ta('서버가 없으면 까닭을 보이고 장부는 그대로', async () => {
  one.up = false;
  $('rdNoteSync').click();
  await until(() => $('rdNoteState').textContent === '못 맞춤');
  assert.match($('rdNoteMsg').textContent, /^원노트와 맞추지 못했습니다 — 이 PC 의 OneNote MCP 서버/);
  assert.ok($('rdNoteMsg').classList.contains('error'));
  assert.equal(chips().length, 4);
  one.up = true;
});
await ta('끄면 더는 닿지 않는다 — 과제 정보를 고쳐도', async () => {
  $('rdNoteOn').checked = false;
  change($('rdNoteOn'));
  assert.equal($('rdNoteState').textContent, '꺼짐');
  const n = one.calls.length;
  pickChip('파일');
  $('rdEdit').click();
  type($('rdFAlias'), '파일 과제');
  $('rdFSave').click();
  await wait(1500);
  assert.equal(one.calls.length, n);
  pickChip('TEST');
});

console.log('rERP 집행내역 — kr_ext_rerp 의 과제집행비율 표를 예산 칸 아래에 그대로(rerp/ 로 옮긴 코드, 2026-10-11 사용자 지정)');
const used = (item) => row(item).querySelector('[data-k="used"]');
const PRJ = 'RS-2026-00000001';
t('이어지지 않은 차년도 — 과제번호로 찾는다는 안내, 표 없음. 탭을 열 때 저절로 잇기를 해 봤지만 목록이 비어 끝났다', () => {
  assert.equal($('rdErpInfo').textContent, `과제번호 ${PRJ} 로 rERP 과제를 찾습니다`);
  assert.equal($('rdErpTable').innerHTML, '');
  assert.ok($('rdErpRefresh').disabled);
  assert.ok(hidden('rdErpUnlink'));
  assert.equal($('rdErpLink').textContent, 'rERP 과제 잇기');
  assert.ok(erpFake.calls.includes('recs'), '탭을 열 때 과제 목록을 받아 저절로 잇기를 해 봤다');
  assert.ok(logs.every((l) => !/rERP 잇기:/.test(l.text)), '목록이 비어 잇지 못했다');
  assert.equal($('rdErp').parentElement.closest('details').id, 'rdBudgetBox', '예산 칸 안, 비목 더하기 아래');
  // 2026-10-11 사용자 지정 — 기본은 접힌 한 줄(제목 · 형편 · 꺾쇠). 펴면 머리 줄(이은 과제 · ↻ · 잇기/끊기) · 고르기 · 표
  assert.equal($('rdErp').tagName, 'DETAILS');
  assert.ok(!$('rdErp').open, 'rERP 집행내역은 접혀 있다');
  assert.deepEqual([...$('rdErp').querySelectorAll(':scope > summary > *')].map((x) => x.className), ['rd-erp-title', 'summary-detail']);
  assert.equal($('rdErpState').textContent, '잇지 않음');
  assert.ok($('rdErp').querySelector(':scope > .rd-erp-head').contains($('rdErpLink')) && !$('rdErp').querySelector('summary').contains($('rdErpLink')), '단추는 펴야 보인다');
});
await ta('rERP 과제 잇기 — 과제번호의 연차 행에서 1차년도를 골라 잇고 바로 받는다: 표가 서고, 맞춰진 비목의 집행 칸은 rERP 승인액(읽기 전용), 칸 머리에 집행비율', async () => {
  const NM = 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발';
  erpFake.recs = [
    { PRJ_NO: PRJ, ANL: '1', PRJ_NM: NM, PRJ_RSPR_EMP_NM: '홍길동', PROG_STS_NM: '진행', RCH_ST_DT: '20260401', RCH_END_DT: '20261231' },
    { PRJ_NO: PRJ, ANL: '2', PRJ_NM: NM, PRJ_RSPR_EMP_NM: '홍길동', PROG_STS_NM: '진행', RCH_ST_DT: '20270101', RCH_END_DT: '20271231' },
    { PRJ_NO: 'RS-2025-00000009', ANL: '1', PRJ_NM: '다른 과제', PRJ_RSPR_EMP_NM: '김아무', PROG_STS_NM: '진행', RCH_ST_DT: '20250101', RCH_END_DT: '20251231' },
  ];
  erpFake.items = [
    { res: '산업부', resCd: '10', exp: '인건비', bgt: 30000000, appr: 12345000, req: 0, dir: false, psnl: true },
    { res: '산업부', resCd: '10', exp: '연구시설·장비비', bgt: 10000000, appr: 0, req: 0, dir: true, psnl: false },
    { res: '산업부', resCd: '10', exp: '연구활동비', bgt: 40000000, appr: 19712839, req: 148500, dir: true, psnl: false },
    { res: '산업부', resCd: '10', exp: '위탁연구개발비', bgt: 5000000, appr: 3000000, req: 0, dir: true, psnl: false },
  ];
  erpFake.cards = [{ amount: 500000 }, { amount: 23000 }];
  $('rdErpLink').click();
  await until(() => /조회 /.test($('rdErpInfo').textContent));
  const e = panel.erp();
  assert.deepEqual([e.prjNo, e.anl, e.rspr, e.auto, e.prjNm], [PRJ, 1, '홍길동', false, NM]);
  assert.match($('rdErpInfo').textContent, new RegExp(`^${PRJ} 1연차 · ${NM} · 조회 \\d\\d\\.\\d\\d \\d\\d:\\d\\d$`));
  assert.match($('rdErpState').textContent, new RegExp(`^${PRJ} 1연차 · 조회 \\d\\d\\.\\d\\d \\d\\d:\\d\\d$`), '접힌 한 줄에는 과제명 없이 과제번호·연차·조회 시각');
  assert.ok(!$('rdErp').open, '받아도 저절로 펴지 않는다');
  assert.equal($('rdErpLink').textContent, 'rERP 잇기 바꾸기');
  assert.ok(!hidden('rdErpUnlink') && !$('rdErpRefresh').disabled);
  assert.equal($('rdErpMsg').textContent, '');
  // 표는 rerp 그대로 — 제외 비목(인건비)은 빠지고, 비목·예산·예산잔액·집행비율, 미청구·승인전 행, 합계(미청구·승인전 반영)
  const tbl = $('rdErpTable');
  const body = [...tbl.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
  assert.deepEqual(body.map((r) => r[0].split(' ')[0]), ['연구시설·장비비', '연구활동비', '위탁연구개발비', '미청구']);
  assert.deepEqual(body[1].slice(1), ['40,000,000', '20,138,661', '49.2%']);
  assert.match(body[3][0], /과제카드 2건.*승인전 148,500/);
  assert.deepEqual(body[3].slice(1), ['-', '−523,000', '+1.2%']);
  const foot = [...tbl.querySelectorAll('tfoot tr')].map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
  assert.deepEqual(foot, [['합계 (미청구 · 승인전 반영)', '55,000,000', '31,615,661', '42.5%']]);
  assert.equal(tbl.querySelector('[data-act="plan-open"]'), null, '비목 줄에 ＋ 가 없다 — 예상 비용은 rerp 확장에서 적는다(보기만)');
  // 장부 줄: 맞춰진 비목은 집행 = rERP 승인액(천원으로 보임, 읽기 전용) — 승인전 148,500 은 더하지 않는다(2026-10-11 사용자 지정), 간접비는 rERP 에 없어 그대로. 연구활동비 19,712,839
  assert.deepEqual(['인건비', '연구시설·장비비', '연구활동비'].map((n) => [used(n).value, used(n).readOnly]), [['12,345', true], ['0', true], ['19,713', true]]);
  assert.equal(used('간접비').readOnly, false);
  assert.equal($('rdBudgetState').textContent, '계획 1.1억 · 집행 3,206만 (30%) · rERP 집행비율 42.5%');
  assert.deepEqual(panel.book().projects[3].years[1].budget.filter((r) => r.erpKey).map((r) => [r.item, r.erpKey, r.used]), [['인건비', '10|인건비', 12345000], ['연구시설·장비비', '10|연구시설·장비비', 0], ['연구활동비', '10|연구활동비', 19712839]]);
  commit(used('인건비'), '1');
  assert.match(status(), /집행은 rERP 승인액입니다/);
  assert.equal(used('인건비').value, '12,345');
  assert.equal(erpFake.calls.filter((c) => c === `budget:${PRJ}`).length, 1);
  await wait(500);
  assert.equal(store.rndBook.projects[3].years[1].erp.snap.budget.bgtAmt, 55000000, '스냅샷이 장부에 남는다');
  assert.ok(logs.some((l) => l.kind === 'rnd' && /rERP 잇기: TEST 1차년도 → RS-2026-00000001 1연차/.test(l.text)));
});
await ta('↻ 는 다시 받고, 10분 안의 탭 열기는 다시 받지 않는다 · 로그인이 풀리면 SSO 를 한 번 하고, eClass 도 풀렸으면 로그인이 필요하다고 한다', async () => {
  const n = erpFake.calls.length;
  await panel.refreshErp({ reason: '열 때' });
  assert.equal(erpFake.calls.length, n, '막 받았으면 건너뛴다');
  erpFake.loggedIn = false;
  $('rdErpRefresh').click();
  await until(() => erpFake.calls.length >= n + 3);
  assert.deepEqual(erpFake.calls.slice(n), [`budget:${PRJ}`, 'sso', `budget:${PRJ}`, `cards:${PRJ}`]);
  erpFake.loggedIn = false;
  erpFake.eclassDown = true;
  $('rdErpRefresh').click();
  await until(() => /로그인이 필요합니다/.test($('rdErpMsg').textContent));
  assert.equal($('rdErpMsg').textContent, '로그인이 필요합니다. eclass 에 로그인한 뒤 ↻ 를 누르세요.');
  assert.equal($('rdBudgetState').textContent, '계획 1.1억 · 집행 3,206만 (30%) · rERP 집행비율 42.5% · 로그인 필요');
  assert.ok($('rdErpTable').querySelector('tfoot'), '지난 스냅샷은 그대로 보인다');
  erpFake.loggedIn = true;
  erpFake.eclassDown = false;
});
await ta('R&D 설정의 "rERP 집행내역" 체크를 끄면 칸이 숨고 집행 칸은 다시 손으로 적을 수 있으며(이어 둔 것은 남음), 켜면 돌아온다', async () => {
  $('rdErpOn').checked = false;
  change($('rdErpOn'));
  assert.ok(hidden('rdErp'));
  assert.equal(used('인건비').readOnly, false);
  assert.equal(used('인건비').value, '12,345', '값은 남는다');
  assert.equal($('rdBudgetState').textContent, '계획 1.1억 · 집행 3,206만 (30%)');
  assert.equal($('rdSetState').textContent, 'rERP 끔 · 원노트 꺼짐');
  assert.ok($('rdIncUnbilled').disabled && $('rdIncPlan').disabled, '끄면 집행에 더할 것도 잠근다');
  assert.ok(hidden('rdIncRow'), '예산 칸 위의 집행에 더하기 줄도 숨는다');
  assert.ok(panel.erp(), '이어 둔 과제는 장부에 그대로');
  await wait(10);
  assert.equal(store.rndSettings.erp, false);
  const n = erpFake.calls.length;
  $('rdErpOn').checked = true;
  change($('rdErpOn'));
  assert.ok(!hidden('rdErp') && !hidden('rdIncRow'));
  assert.equal(used('인건비').readOnly, true);
  assert.match($('rdBudgetState').textContent, /rERP 집행비율 42\.5%/);
  assert.equal(erpFake.calls.length, n, '막 받은 스냅샷이라 다시 부르지 않는다');
  assert.ok(logs.some((l) => /R&D 설정: rERP 집행내역 끔/.test(l.text)));
});
t('예상 비용은 보기만(2026-10-11 사용자 지정) — 표에 ＋·저장·내보내기가 없다. 적고 고치고 페이지를 만드는 것은 rerp 확장에서', () => {
  const tbl = $('rdErpTable');
  assert.ok(tbl.querySelector('tbody tr'), '표는 있다');
  for (const sel of ['[data-act="plan-open"]', '[data-act="plan-persist"]', '[data-act="plan-export"]', '[data-act="plan-qty"]', '.krext-plan-acts']) assert.equal(tbl.querySelector(sel), null, sel);
  assert.equal(store.plannedExpenses, undefined, '여기서 적은 예상 비용은 없다');
});
await ta('원노트 칸의 예상 비용 공유를 켜면 RERP 섹션을 찾아 맞춘다 — 페이지가 없는 과제는 만들지 않고 rerp 확장에서 만들라고 알린다', async () => {
  $('rdPlusOn').checked = true;
  change($('rdPlusOn'));
  await until(() => /맞춤 |못 맞춤/.test($('rdPlusMsg').textContent));
  assert.match($('rdPlusMsg').textContent, /^맞춤 \d\d\.\d\d \d\d:\d\d · 과제 0개 · 항목 0건 · 페이지 없음 1개\(rerp 확장에서 만듭니다\)$/);
  assert.equal(mcp.pages.length, 0, '여기서는 만들지 않는다');
  assert.match($('rdNoteState').textContent, /^예상 비용 맞춤 /);
  assert.ok(!hidden('rdPlusRow') && $('rdPlusSection').value === 'RERP');
  assert.ok(!$('rdNoteSync').disabled, '예상 비용만 켜도 지금 맞추기를 쓸 수 있다');
  await wait(10);
  assert.deepEqual([store.rndNote.plus.on, store.plusSection.id], [true, 'sec-rerp']);
  const tbl = $('rdErpTable');
  assert.ok(tbl.querySelector('[data-act="plan-import"]'), '켜면 가져오기(⬇)가 선다');
  assert.equal(tbl.querySelector('[data-act="plan-export"]'), null, '내보내기(⬆)는 없다 — 페이지는 rerp 확장에서');
});
await ta('rerp 확장이 만든 페이지(동료가 적은 예상 비용)를 지금 맞추기로 받는다 — 표에 비목 → 비목 예상 반영 → 항목 줄(보기만), 저장소(plannedExpenses)에 과제번호로', async () => {
  // rerp 확장(책임자)이 RERP 섹션에 만든 페이지 — 같은 제목·같은 블록(rerp/plansync.js serialize)
  const k = ++mcp.n;
  mcp.pages.push({
    id: `1-${'b'.repeat(32)}!${k}-${mcpGuid(k)}`, section: 'sec-rerp', title: `[예상 비용] ${PRJ} MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발`,
    url: `https://krclass-my.sharepoint.com/x?wd=target%28RERP.one%7C${mcpGuid(0)}%2Fp%7C${mcpGuid(k)}%2F%29`,
    body: PLAN_SYNC.serialize({ items: [{ id: 'a1', prj: PRJ, key: '10|연구활동비', name: '회의비', qty: 3, unit: 50000, amt: 150000, ts: 1000, by: '동료' }], del: {}, at: 1000, by: '동료' }, { title: `MW급 (${PRJ})` }),
  });
  $('rdNoteSync').click();
  await until(() => !!store.plannedExpenses?.[PRJ]);
  await until(() => /과제 1개 · 항목 1건$/.test($('rdPlusMsg').textContent));
  const list = store.plannedExpenses[PRJ]['10|연구활동비'];
  assert.deepEqual([list.length, list[0].name, list[0].qty, list[0].unit, list[0].amt, list[0].by], [1, '회의비', 3, 50000, 150000, '동료']);
  assert.equal(mcp.pages.length, 1, '페이지는 그대로');
  const tbl = $('rdErpTable');
  tbl.querySelector('[data-act="plan-hide"]').click();   // 항목이 있는 과제는 기본 감춤 — 눈으로 펼친다
  const text = tbl.textContent.replace(/\s+/g, ' ');
  assert.match(text, /↳ 회의비 .*× 50,000.*−150,000/);
  // 예상 반영 줄은 항목 줄보다 먼저 비목 줄 바로 아래(rerp 원본대로), 비목 이름을 앞에(이 패널만 — 2026-10-11 사용자 지정) — 연구활동비 → ↳ 연구활동비 예상 반영 → ↳ 회의비. 합계 아래 예상 반영은 그대로.
  assert.match(text, /↳ 연구활동비 예상 반영 1건 · 150,000원.*19,988,661.*↳ 회의비/, '연구활동비 잔액 20,138,661 − 150,000 이 항목 줄보다 먼저');
  const proj = tbl.querySelector('tbody tr.krext-bgt-proj');
  assert.ok(proj.previousElementSibling && !proj.previousElementSibling.className, '바로 위가 비목 줄');
  assert.ok(/krext-bgt-plan/.test(proj.nextElementSibling.className), '바로 아래가 항목 줄');
  assert.match(text, /합계 \(미청구 · 승인전 반영\).*예상 반영 \(예상 1건 · 150,000원\).*31,465,661/, '합계와 그 아래 예상 반영은 그대로');
  for (const sel of ['[data-act="plan-open"]', '[data-act="plan-qty"]', '.krext-plan-acts', '[data-act="plan-persist"]', '[data-act="plan-export"]']) assert.equal(tbl.querySelector(sel), null, `${sel} 은 없다(보기만)`);
  assert.ok(tbl.querySelector('a.krext-ico-btn')?.href.startsWith('https://krclass-my.sharepoint.com/'), '열기(↗) 링크');
});
await ta('예산 칸 위의 "집행에 더하기" — 사용계획을 켜면 그 비목의 예상 비용이, 미청구를 켜면 연구활동비 줄에 더해진다(2026-10-12 사용자 지정 — 보조 줄이 아니라 그 줄의 집행·잔액·막대·표 복사). 승인전 체크는 없다', async () => {
  const bars = (node) => [...node.querySelectorAll('.rd-bar')].map((b) => [b.className.replace('rd-bar ', ''), b.style.left, b.style.width]);
  assert.deepEqual(bars(row('연구활동비')), [['base', '0%', '49.28%']], '승인액 19,712,839 ÷ 계획 40,000,000 — 파랑 하나');
  $('rdIncPlan').checked = true;
  change($('rdIncPlan'));
  assert.equal(used('연구활동비').value, '19,863', '19,712,839 + 예상 150,000');
  assert.equal($('rdSetState').textContent, 'rERP 켬 · 원노트 예상 비용', '설정 줄에는 집행에 더할 것이 안 보인다 — 예산 칸 위에 있다');
  assert.ok(logs.some((l) => /R&D 예산 집행에 더하기: 사용계획$/.test(l.text)));
  // 막대는 몫마다 다른 색(2026-10-11 사용자 지정) — 승인액(파랑) 뒤에 사용계획(주황)이 이어 붙는다. 150,000 ÷ 40,000,000 = 0.375%
  const seg = bars(row('연구활동비'));
  assert.deepEqual([seg.length, seg[0], seg[1][0], seg[1][1]], [2, ['base', '0%', '49.28%'], 'plan', '49.28%']);
  assert.ok(Math.abs(parseFloat(seg[1][2]) - 0.375) < 0.02, `사용계획 몫 ${seg[1][2]}`);
  assert.match(used('연구활동비').title, /^rERP 승인액 19,712,839원 \+ 사용계획 150,000원/);
  assert.deepEqual(bars(row('인건비')), [['base', '0%', '41.15%']], '예상 비용이 없는 비목은 파랑 하나 — 12,345,000 ÷ 30,000,000');
  $('rdIncUnbilled').checked = true;
  change($('rdIncUnbilled'));
  // 미청구(과제카드 2건 523,000)는 연구활동비 줄에 든다(2026-10-12 사용자 지정) — 보조 줄은 없고 그 줄의 집행·잔액이 바뀐다: 19,862,839 + 523,000 = 20,385,839 · 잔액 19,614,161
  assert.equal(q('#rdBudget .rd-brow-extra'), null, '미청구 보조 줄은 연구활동비 줄이 없을 때만');
  assert.equal(used('연구활동비').value, '20,386', '승인액 + 사용계획 + 미청구');
  assert.equal(row('연구활동비').querySelector('[data-left]').textContent, '19,614');
  assert.match(used('연구활동비').title, /^rERP 승인액 19,712,839원 \+ 사용계획 150,000원 \+ 미청구 523,000원\(과제카드 2건/);
  assert.equal(used('인건비').value, '12,345', '다른 줄은 그대로');
  // 연구활동비 줄 막대 — 승인액(파랑) → 사용계획(주황) → 미청구(보라, 523,000 ÷ 40,000,000 = 1.3075%)
  const seg2 = bars(row('연구활동비'));
  assert.deepEqual([seg2.length, seg2[0], seg2[1][0], seg2[2][0], seg2[2][1]], [3, ['base', '0%', '49.28%'], 'plan', 'unbilled', '49.66%']);
  assert.ok(Math.abs(parseFloat(seg2[2][2]) - 1.3075) < 0.02, `미청구 몫 ${seg2[2][2]}`);
  assert.deepEqual(sum(), ['합계', '106,000', '32,731', '73,269', ''], '12,345,000 + 0 + 20,385,839 — 합계는 보조 줄로 더하던 때와 같다');
  // 합계 줄 막대 — 승인액 32,057,839 → 사용계획 150,000 → 미청구 523,000 (÷ 106,000,000), 마지막 빈 칸 안에 있어 칸 수는 다섯 그대로
  const tot = bars($('rdBudgetSum'));
  assert.deepEqual(tot.map((b) => b[0]), ['base', 'plan', 'unbilled']);
  assert.deepEqual([tot[0][1], tot[0][2], tot[1][1], tot[2][2]], ['0%', '30.24%', '30.24%', '0.49%']);
  assert.ok($('rdBudgetSum').lastElementChild.querySelector('.rd-bars'));
  // 범례는 체크 상자 자체의 색(accent-color — 사용자 지정 "체크 박스 자체에 색상을", 따로 색 점은 없다)
  assert.ok($('rdIncPlan').classList.contains('rd-tint') && $('rdIncPlan').classList.contains('plan'));
  assert.ok($('rdIncUnbilled').classList.contains('rd-tint') && $('rdIncUnbilled').classList.contains('unbilled'));
  assert.equal($('rdIncRow').querySelector('.rd-dot'), null, '체크와 글 사이에 색 점은 없다');
  assert.equal(doc.querySelector('#rnd .rd-dot'), null);
  assert.match($('rdBudgetState').textContent, /^계획 1\.1억 · 집행 3,273만 \(31%\) · rERP 집행비율 42\.5%/);
  const n = copied.length;
  $('rdBudgetCopy').click();
  await until(() => copied.length === n + 1);
  assert.match(copied[n], /\n연구활동비\t40,000\t20,386\t19,614\t51%\n/, '표 복사의 연구활동비 집행에 미청구가 들어 있다');
  assert.ok(!/미청구\(과제카드/.test(copied[n]), '미청구 줄은 따로 없다(연구활동비 줄에 들었으므로)');
  assert.match(copied[n], /\n합계\t106,000\t32,731\t73,269\t31%$/);
  await wait(10);
  assert.deepEqual(store.rndSettings, { erp: true, unbilled: true, plan: true, hide: [] }, '승인전(req)은 저장하지 않는다');
  // 기본값으로 돌려 둔다
  $('rdIncUnbilled').checked = false; change($('rdIncUnbilled'));
  $('rdIncPlan').checked = false; change($('rdIncPlan'));
  assert.equal(used('연구활동비').value, '19,713');
  assert.ok(!q('#rdBudget .rd-brow-extra'));
});
await ta('과제책임자가 내 이름이어도 여기서는 페이지를 만들지 않고 받기만 한다(보기만) — 다른 과제의 페이지가 없어도 그대로', async () => {
  myName = '홍길동';   // 이 과제의 책임자
  const before = store.planSyncState?.at;
  const n = mcp.calls.length;
  $('rdNoteSync').click();
  await until(() => store.planSyncState?.at !== before);
  await wait(30);
  assert.equal(mcp.pages.length, 1, '새 페이지 없음');
  assert.ok(!mcp.calls.slice(n).includes('write_onenote:create_page'));
  assert.match($('rdPlusMsg').textContent, /과제 1개 · 항목 1건$/);
  assert.ok(logs.some((l) => /R&D 예상 비용 원노트 맞춤\(manual\)/.test(l.text)));
});
await ta('MCP 서버가 없으면 까닭을 보이고, 끄면 아이콘도 동기화도 없다', async () => {
  mcp.up = false;
  $('rdNoteSync').click();
  await until(() => /못 맞춤/.test($('rdNoteState').textContent));
  assert.match($('rdPlusMsg').textContent, /MCP 서버에 연결할 수 없습니다/);
  assert.ok($('rdPlusMsg').classList.contains('error'));
  mcp.up = true;
  $('rdPlusOn').checked = false;
  change($('rdPlusOn'));
  assert.equal($('rdNoteState').textContent, '꺼짐');
  assert.equal($('rdPlusMsg').textContent, '');
  assert.ok(!$('rdErpTable').querySelector('[data-act="plan-export"]'));
  assert.ok($('rdNoteSync').disabled);
});
t('끊기(두 번) — 표가 사라지고 집행 칸은 다시 손으로 적는다(값은 남는다)', () => {
  $('rdErpUnlink').click();
  assert.ok(panel.erp(), '한 번으로는 안 끊는다');
  $('rdErpUnlink').click();
  assert.equal(panel.erp(), null);
  assert.deepEqual([used('인건비').readOnly, used('인건비').value], [false, '12,345']);
  assert.equal($('rdErpTable').innerHTML, '');
  assert.ok(hidden('rdErpUnlink'));
  assert.match(status(), /rERP 연결을 끊었습니다/);
  assert.equal($('rdBudgetState').textContent, '계획 1.1억 · 집행 3,206만 (30%)');
  myName = '박기도';
});

console.log('R&D 설정 — 예산 칸에 보일 비목');
await ta('비목 체크를 끄면 그 줄만 숨고(합계·표 복사는 그대로) 합계 위에 알림 한 줄, 설정 줄에 "비목 1 숨김", 저장·기록 — 다시 켜면 돌아온다', async () => {
  const names = rows().map((r) => r[0]);
  assert.ok(names.includes('인건비') && names.includes('간접비'), `보고 있는 차년도에 인건비·간접비 줄이 있다 — ${names.join(',')}`);
  const before = { sum: sum(), state: $('rdBudgetState').textContent, count: rows().length };
  const box = $('rdItems').querySelector('input[data-item="간접비"]');
  box.checked = false;
  change(box);
  assert.ok(!row('간접비'), '간접비 줄이 숨는다');
  assert.equal(rows().length, before.count - 1);
  assert.deepEqual(sum(), before.sum, '합계는 그대로');
  assert.equal($('rdBudgetState').textContent, before.state, '칸 머리도 그대로');
  assert.equal(q('#rdBudget .rd-hidden-note').textContent, '숨긴 비목 1 · 간접비 — 합계에는 듭니다 (R&D 설정)');
  assert.equal(q('#rdBudget .rd-hidden-note').nextElementSibling, null, '알림은 줄들 아래(미청구 보조 줄이 없을 때는 맨 아래)');
  assert.match($('rdSetState').textContent, / · 비목 1 숨김$/);
  await wait(10);
  assert.deepEqual(store.rndSettings.hide, ['간접비']);
  assert.ok(logs.some((l) => /^R&D 설정: 예산 칸에 숨긴 비목 — 간접비$/.test(l.text)));
  const n = copied.length;
  $('rdBudgetCopy').click();
  await until(() => copied.length === n + 1);
  assert.match(copied[n], /\n간접비\t/, '표 복사에는 숨긴 비목도 든다');
  // 다른 차년도·과제로 가도 같은 설정 — 체크 목록은 장부의 비목을 다 모은다(여섯 비목 차례, 겹치지 않게)
  assert.deepEqual([...$('rdItems').querySelectorAll('label')].map((l) => l.textContent).slice(0, 6), ['인건비', '연구시설·장비비', '연구재료비', '연구활동비', '연구수당', '간접비']);
  const again = $('rdItems').querySelector('input[data-item="간접비"]');   // 설정 줄을 다시 그려 새 요소
  assert.equal(again.checked, false, '다시 그려도 끈 채');
  again.checked = true;
  change(again);
  assert.ok(row('간접비'), '다시 켜면 돌아온다');
  assert.equal(q('#rdBudget .rd-hidden-note'), null);
  assert.ok(!/숨김/.test($('rdSetState').textContent));
  await wait(10);
  assert.deepEqual(store.rndSettings.hide, []);
  assert.ok(logs.some((l) => /^R&D 설정: 예산 칸에 숨긴 비목 — 없음\(모두 보임\)$/.test(l.text)));
});

console.log('연구내용 원노트 공유(2026-10-14) — YAML 로 넣은 연구개발계획서를 「[연구내용] 과제명」 페이지에 올려 링크로 kr_ext_rerp 에 보낸다');
const RSY = (await import('../rerp/researchsync.js')).default;
const ONENOTE = (await import('../rerp/onenote.js')).default;
await ta('YAML 을 넣을 때 rerp 와 같은 기록(researchPlans — 과제명#차년도)으로도 남는다 — 오래된 판은 건너뛴다', async () => {
  const rec = store.researchPlans?.['시험용직류차단기개발#1'];
  assert.ok(rec, Object.keys(store.researchPlans || {}).join());
  assert.equal(rec.rev, 'r2', 'r2 뒤에 넣은 r0 는 기록도 건너뛰었다');
  assert.equal(rec.code, 'RS-2026-00000001');
  assert.ok(rec.goals.length > 0 && rec.contents.length > 0);
  assert.equal($('rdResShare').textContent, '연구내용 올리기');
  assert.ok($('rdResCopy').disabled);
  assert.ok(hidden('rdResOpen'));
});
await ta('연구내용 올리기 — RERP 섹션에 페이지를 만들고 링크(웹 링크 + 페이지 ID)를 복사한다. rerp 의 받기(researchsync.parse)로 그대로 읽힌다', async () => {
  const n = mcp.calls.length;
  $('rdResShare').click();
  await until(() => !$('rdResShare').disabled && /만들었습니다/.test($('rdResMsg').textContent));
  const page = mcp.pages.find((p) => p.title === '[연구내용] 시험용 직류 차단기 개발');
  assert.ok(page, mcp.pages.map((p) => p.title).join());
  assert.equal(page.section, 'sec-rerp', '예상 비용과 같은 섹션');
  assert.ok(mcp.calls.slice(n).includes('write_onenote:create_page'));
  assert.equal(copied.at(-1), `${page.url}\n[연구내용 페이지 ID] ${page.id}`);
  assert.match($('rdResMsg').textContent, /링크를 복사했습니다 — kr_ext_rerp 확장 설정의 연구개발계획서 칸에 붙여 넣으세요$/);
  const back = RSY.parse(ONENOTE.findBlock(page.body, RSY.BLOCK).inner);
  assert.equal(back.name, '시험용 직류 차단기 개발');
  assert.equal(back.code, 'RS-2026-00000001');
  assert.equal(back.by, myName);
  assert.deepEqual(back.recs.map((r) => [r.n, r.rev]), [[1, 'r2']]);
  assert.ok(page.body.includes('<td>개발목표</td>'), '사람이 읽는 표도 있다');
  assert.equal($('rdResShare').textContent, '연구내용 다시 올리기');
  assert.ok(!$('rdResCopy').disabled);
  assert.ok(!hidden('rdResOpen'));
  assert.equal(store.researchShare?.['시험용직류차단기개발']?.pageId, page.id);
  assert.ok(logs.some((l) => /^R&D 연구내용 원노트 올림\(TEST\): \[연구내용\] 시험용 직류 차단기 개발 · 차년도 1개$/.test(l.text)));
});
await ta('계획서를 다시 넣으면 올린 페이지를 저절로 고친다(같은 페이지 · 클립보드는 그대로) — 링크 복사는 언제든', async () => {
  const n = mcp.calls.length;
  const before = copied.length;
  dropFiles([new window.File([fx('snapshot_r2.yaml')], 'KR_test_r2.yaml')]);
  await until(() => mcp.calls.slice(n).includes('write_onenote:replace') && /고쳤습니다/.test($('rdResMsg').textContent));
  assert.equal(mcp.pages.filter((p) => p.title.startsWith('[연구내용]')).length, 1);
  assert.equal(copied.length, before, '저절로 고칠 때는 클립보드를 건드리지 않는다');
  $('rdResCopy').click();
  await until(() => copied.length === before + 1);
  assert.match(copied.at(-1), /^https:\/\/krclass-my\.sharepoint\.com\/.*\n\[연구내용 페이지 ID\] 1-b{32}!\d+-/);
});

await ta('행정지원 — 참여인력 칸 안에서 사람을 더하고 이름·맡은 일·공문 참조를 적으면 과제에 남고 머리 줄에 "행정 n명"으로 보인다(인건비·참조자 이름은 없다 — 2026-10-17 사용자 지정). 빈 줄은 저장소에서 다시 읽을 때 빠진다(2026-10-16)', async () => {
  const type = (node, v) => { node.value = v; node.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const row = () => $('rdSupport').querySelector('tbody tr:last-child');
  assert.equal($('rdSupportNote'), null, '행정지원 머리의 설명문은 없다(2026-10-16 사용자 지정)');
  assert.ok($('rdSupportAdd').classList.contains('rd-icon') && $('rdSupportAdd').querySelector('svg'), '사람 더하기는 아이콘 단추(2026-10-16 사용자 지정)');
  assert.equal($('rdSupportAdd').getAttribute('aria-label'), '사람 더하기');
  assert.match($('rdSupportAdd').title, /^사람 더하기 — /);
  $('rdSupportAdd').click();
  assert.equal($('rdSupport').querySelectorAll('.rd-support-row').length, 1);
  assert.ok($('rdSupport').querySelector('table.rd-table'), '참여연구자 표와 같은 꼴의 표(2026-10-16)');
  assert.deepEqual([...$('rdSupport').querySelectorAll('th')].map((x) => x.textContent), ['성명', '맡은 일', '공문 참조', '']);
  assert.ok(row().querySelector('[data-k="ref"]').checked, '새 사람은 공문 참조가 켜져 있다');
  type(row().querySelector('[data-k="name"]'), '홍길동');
  type(row().querySelector('[data-k="role"]'), '행정 담당');
  assert.match($('rdRosterState').textContent, /^(연구자 \d+명|계획서 없음|있음) · 행정 1명$/, '머리 줄은 연구자 수 · 행정 수뿐 — 인건비·공문 참조 이름은 없다(2026-10-17 사용자 지정)');
  $('rdSupportAdd').click();
  type(row().querySelector('[data-k="name"]'), '이몽룡');
  const ref = row().querySelector('[data-k="ref"]');
  ref.checked = false;
  ref.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.match($('rdRosterState').textContent, /^(연구자 \d+명|계획서 없음|있음) · 행정 2명$/);
  $('rdSupportAdd').click();
  await wait(500);
  const saved = () => store.rndBook.projects.find((x) => x.id === store.rndBook.current.project);
  assert.deepEqual(saved().support.slice(0, 2), [{ name: '홍길동', role: '행정 담당', ref: true }, { name: '이몽룡', role: '', ref: false }]);
  assert.deepEqual(normalizeBook(store.rndBook).projects.find((x) => x.id === store.rndBook.current.project).support.length, 2, '이름을 적지 않은 줄은 다시 읽을 때 빠진다');
  $('rdSupport').querySelector('tbody tr:first-child [data-drop]').click();
  assert.deepEqual([...$('rdSupport').querySelectorAll('[data-k="name"]')].map((x) => x.value), ['이몽룡', '']);
  assert.match($('rdRosterState').textContent, / · 행정 1명$/);
  // 뒤의 시험이 보는 머리 줄을 그대로 두도록 비운다.
  for (let i = 0; i < 5 && $('rdSupport').querySelector('[data-drop]'); i++) $('rdSupport').querySelector('[data-drop]').click();
  assert.equal($('rdSupport').children.length, 0);
  await wait(500);
});

await ta('Job Id 저절로 찾기 — 과제 정보 카드가 후보(책임자 같은 과제 먼저 · 과제명 유사도 0.5 이상)를 보이고 이 번호로 저장을 누르면 과제에 남으며 묶음은 사라진다. 과제 고치기에서 비우면 다시 보인다(2026-10-16)', async () => {
  const p = () => store.rndBook.projects.find((x) => x.id === store.rndBook.current.project);
  const name = $('rdName').title;
  const cands = () => [...$('rdJobList').querySelectorAll('.rd-job-cand')].map((b) => [b.querySelector('b').textContent, b.classList.contains('active')]);
  assert.equal(p().job, '', '아직 Job Id 가 없다');
  // 처음 열 때는 목록이 비어 있었다 — 후보 없음과 다시 찾기만.
  await until(() => !hidden('rdJobBox') && !hidden('rdJobRetry'));
  assert.ok(hidden('rdJobSave'));
  assert.match(metaText(), /Job Id 없음 — 비슷한 과제가 없습니다\(과제 고치기에서 적으세요\)/);
  assert.match($('rdJobMsg').textContent, /과제 목록이 비었습니다/);
  jobsFake.rows = [
    { Project_ID: 'RND00982026', Project_ID_DASH: 'RND-98-2026', Project_Name: `${name} 후속`, User_Name: '아무개', Process: '진행' },
    { Project_ID: 'RND00992026', Project_ID_DASH: 'RND-99-2026', Project_Name: name, User_Name: p().lead || '', Process: '진행' },
    { Project_ID: 'RND00012020', Project_ID_DASH: 'RND-01-2020', Project_Name: '전혀 다른 과제', User_Name: '아무개', Process: '완료' },
  ];
  const calls = jobsFake.calls;
  $('rdJobRetry').click();
  await until(() => cands().length === 2);
  assert.equal(jobsFake.calls, calls + 1, '다시 찾기는 목록을 새로 받는다');
  assert.deepEqual(cands(), [['RND00992026', true], ['RND00982026', false]], '과제명이 같은 것이 먼저 골라져 있고, 전혀 다른 과제는 후보가 아니다');
  assert.match(metaText(), /Job Id RND00992026 \(후보 — 맞는지 보고 아래에서 저장\)/);
  assert.ok(hidden('rdJobRetry') && !hidden('rdJobSave'));
  assert.match($('rdJobMsg').textContent, /가장 비슷한 과제를 골라 두었습니다/);
  // 다른 후보를 누르면 바뀐다.
  $('rdJobList').querySelectorAll('.rd-job-cand')[1].click();
  assert.deepEqual(cands().map((c) => c[1]), [false, true]);
  assert.match(metaText(), /Job Id RND00982026 \(후보/);
  $('rdJobList').querySelectorAll('.rd-job-cand')[0].click();
  // 이 번호로 저장 — 묶음은 사라지고 표의 Job Id 줄만 남는다. 저장소에도.
  $('rdJobSave').click();
  assert.ok(hidden('rdJobBox'));
  assert.match(metaText(), /Job Id RND00992026 · /);
  assert.match(status(), /Job Id 를 저장했습니다 — RND00992026/);
  assert.ok(logs.some((l) => l.kind === 'rnd' && /Job Id: .* → RND00992026/.test(l.text)));
  await wait(500);
  assert.equal(p().job, 'RND00992026');
  // 과제 고치기의 Job Id 칸에 들어 있다 — 연필 아이콘은 과제 정보를 접거나 펴지 않는다. 비우고 저장하면 후보가 다시 보인다(목록은 다시 받지 않는다).
  const wasOpen = $('rdInfo').open;
  $('rdEdit').click();
  assert.equal($('rdInfo').open, wasOpen);
  assert.equal($('rdFJob').value, 'RND00992026');
  $('rdFJob').value = '';
  $('rdFSave').click();
  assert.ok(!hidden('rdJobBox') && !hidden('rdJobSave'));
  assert.deepEqual(cands(), [['RND00992026', true], ['RND00982026', false]]);
  assert.equal(jobsFake.calls, calls + 1, '같은 세션의 목록을 다시 쓴다');
  $('rdJobSave').click();
  await wait(500);
  assert.equal(p().job, 'RND00992026');
  jobsFake.rows = [];
});

await ta('회계 I/O 저절로 찾기 — 과제 정보 카드가 회계(e-accounting)의 내 부서 과제 목록에서 후보(과제명 유사도 0.5 이상)를 보이고 이 코드로 저장을 누르면 과제에 남으며 바로 그 해의 계정과목별 예산 표가 선다. 로그인이 풀리면 링크, 고치기에서 비우면 다시(2026-10-17)', async () => {
  const p = () => store.rndBook.projects.find((x) => x.id === store.rndBook.current.project);
  const name = $('rdName').title;
  const cands = () => [...$('rdIoList').querySelectorAll('.rd-job-cand')].map((b) => [b.querySelector('b').textContent, b.classList.contains('active')]);
  const cells = () => [...$('rdAcctTable').querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((td) => td.textContent));
  assert.equal(p().io, '', '아직 회계 I/O 가 없다');
  assert.ok(hidden('rdAcctBox'), '회계 I/O 가 없으면 회계 예산 표도 없다');
  // 처음 열 때는 목록이 비어 있었다 — 후보 없음과 다시 찾기만.
  await until(() => !hidden('rdIoBox') && !hidden('rdIoRetry'));
  assert.ok(hidden('rdIoSave') && hidden('rdIoLogin'));
  assert.match(metaText(), /회계 I\/O 없음 — 비슷한 회계 과제가 없습니다\(과제 고치기에서 적으세요\)/);
  assert.match($('rdIoMsg').textContent, /회계 과제 목록이 비었습니다/);
  // 로그인이 풀려 못 받으면 까닭과 e-accounting 로그인 링크.
  acctFake.fail = '로그인이 필요합니다. e-accounting 에 로그인한 뒤 다시 조회하세요.';
  acctFake.login = true;
  $('rdIoRetry').click();
  await until(() => !hidden('rdIoLogin'));
  assert.match($('rdIoMsg').textContent, /회계 과제 목록을 받지 못했습니다 — 로그인이 필요합니다/);
  assert.match(metaText(), /회계 I\/O 없음 — e-accounting 로그인이 필요합니다/);
  assert.equal($('rdIoLogin').getAttribute('href'), 'https://e-accounting.krs.co.kr/App_Usr/UsrStart.aspx');
  acctFake.fail = '';
  acctFake.login = false;
  // 목록이 오면 과제명이 같은(잘린 이름도) 것이 먼저 골라져 있고, 전혀 다른 과제는 후보가 아니다.
  acctFake.options = [
    { code: '2176NR0126', name: `${name} 후속`, text: '' },
    { code: '2145NR0124', name: name.slice(0, 20), text: '' },
    { code: '2083LR9123', name: 'AIP 용역', text: '' },
  ];
  acctFake.acct = { '2145NR0124': { ioName: name, dept: 'HER', deptName: '수소전기추진연구팀', rows: [
    { code: '603010304', name: '수탁과제(국가)_연구활동비', base: 51500000, transfer: 0, budget: 51500000, actual: 29066990, pending: 0, available: 22433010 },
    { code: '603010311', name: '수탁과제(국가)_연구재료비', base: 31376000, transfer: -1000000, budget: 30376000, actual: 0, pending: 0, available: 31376000 },
  ] } };
  const lists = acctFake.lists;
  $('rdIoRetry').click();
  await until(() => cands().length === 2);
  assert.equal(acctFake.lists, lists + 1, '다시 찾기는 목록을 새로 받는다');
  assert.deepEqual(cands(), [['2145NR0124', true], ['2176NR0126', false]]);
  assert.match(metaText(), /회계 I\/O 2145NR0124 \(후보 — 맞는지 보고 아래에서 저장\)/);
  assert.ok(hidden('rdIoRetry') && !hidden('rdIoSave') && hidden('rdIoLogin'));
  assert.match($('rdIoMsg').textContent, /가장 비슷한 회계 과제를 골라 두었습니다\(유사도 1\.00\)/);
  $('rdIoList').querySelectorAll('.rd-job-cand')[1].click();
  assert.deepEqual(cands().map((c) => c[1]), [false, true]);
  $('rdIoList').querySelectorAll('.rd-job-cand')[0].click();
  // 이 코드로 저장 — 묶음은 사라지고 표의 회계 I/O 줄만 남으며, 바로 계정과목별 예산을 받아 표로.
  const gets = acctFake.gets;
  $('rdIoSave').click();
  assert.ok(hidden('rdIoBox'));
  assert.match(status(), /회계 I\/O 를 저장했습니다 — 2145NR0124/);
  assert.ok(logs.some((l) => l.kind === 'rnd' && /회계 I\/O: .* → 2145NR0124/.test(l.text)));
  assert.ok(!hidden('rdAcctBox'));
  await until(() => cells().length === 2);
  assert.equal(acctFake.gets, gets + 1);
  assert.deepEqual(cells(), [['603010304', '연구활동비', '51,500,000', '29,066,990', '22,433,010'], ['603010311', '연구재료비', '30,376,000', '0', '31,376,000']], '계정명은 끝마디(전체는 툴팁)');
  assert.equal($('rdAcctTable').querySelector('tbody tr .rd-acct-name').title, '수탁과제(국가)_연구활동비');
  // 표는 과제 정보 카드가 아니라 예산 칸 안의 접힌 한 줄(rERP 집행내역과 같은 꼴 — 2026-10-17 사용자 지정). 접힌 줄에는 해·I/O·조회 시각, 펴면 머리 줄에 I/O 와 회계 과제명.
  assert.ok($('rdAcctBox').closest('#rdBudgetBox'), '회계 예산은 예산 칸 안');
  assert.ok(!$('rdAcctBox').open, '기본은 접힘');
  assert.match($('rdAcctState').textContent, /^2026년 · I\/O 2145NR0124 · 조회 \d\d:\d\d$/);
  assert.match($('rdAcctHead').textContent, new RegExp(`^2145NR0124 ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · 2026년 · 조회 \\d\\d:\\d\\d$`));
  assert.equal($('rdAcctMsg').textContent, '');
  assert.ok(metaText().includes(`회계 I/O 2145NR0124 ${name} · `), '표의 줄에는 회계의 과제명도');
  await wait(500);
  assert.equal(p().io, '2145NR0124');
  assert.equal(p().acct.rows.length, 2, '스냅샷이 저장소에 남는다');
  assert.equal(p().acct.year, '2026');
  // 다시 조회(↻)는 다시 받는다 — 같은 과제를 다시 그려도 10분 안이면 받지 않는다.
  $('rdAcctRefresh').click();
  await until(() => acctFake.gets === gets + 2);
  await until(() => !$('rdAcctRefresh').disabled);
  // 못 받으면 까닭(스냅샷은 그대로)과 로그인 링크.
  acctFake.fail = '로그인이 필요합니다. e-accounting 에 로그인한 뒤 다시 조회하세요.';
  acctFake.login = true;
  $('rdAcctRefresh').click();
  await until(() => !hidden('rdAcctLogin'));
  assert.match($('rdAcctMsg').textContent, /회계 예산을 받지 못했습니다 — 로그인이 필요합니다/);
  assert.equal(cells().length, 2, '받아 둔 표는 그대로');
  acctFake.fail = '';
  acctFake.login = false;
  // 요약 복사에 회계 줄이 든다.
  $('rdCopy').click();
  await until(() => copied.length && /■ 회계 예산 \(2026년 · I\/O 2145NR0124/.test(copied[copied.length - 1]));
  assert.match(copied[copied.length - 1], /회계 I\/O: 2145NR0124 \(/);
  assert.match(copied[copied.length - 1], /- 603010311 수탁과제\(국가\)_연구재료비: 예산 30,376,000원 · 실적 0원 · 가용 31,376,000원/);
  // 과제 고치기의 회계 I/O 칸에 들어 있다 — 다른 코드로 고치면 스냅샷을 버리고 새로 받고, 비우고 저장하면 후보가 다시 보인다(목록은 다시 받지 않는다).
  $('rdEdit').click();
  assert.equal($('rdFIo').value, '2145NR0124');
  $('rdFIo').value = '2176nr0126';
  $('rdFSave').click();
  await wait(500);
  assert.equal(p().io, '2176NR0126', '대문자로');
  assert.ok(!p().acct, '다른 코드로 고치면 전 스냅샷은 버린다');
  await until(() => /회계가 계정 줄을 주지 않았습니다|아직 받지 못했습니다/.test($('rdAcctMsg').textContent));
  assert.equal(cells().length, 0);
  $('rdEdit').click();
  $('rdFIo').value = '';
  $('rdFSave').click();
  await until(() => !hidden('rdIoBox') && !hidden('rdIoSave'));
  assert.ok(hidden('rdAcctBox'));
  assert.deepEqual(cands(), [['2145NR0124', true], ['2176NR0126', false]]);
  assert.equal(acctFake.lists, lists + 1, '같은 세션의 목록을 다시 쓴다');
  $('rdIoSave').click();
  await until(() => cells().length === 2);
  await wait(500);
  assert.equal(p().io, '2145NR0124');
  acctFake.options = [];
  acctFake.acct = {};
});

console.log('과제 더하기 카드(rndgen)의 손잡이 — 2026-10-16 사용자 지정: "sscb 버튼 누르면 그리 안감, + 누르면 Yaml 파일을 넣던지 아니면 사업계획서를 넣으면 과제의 YAML을 추출"');
const projId = (alias) => panel.book().projects.find((x) => x.alias === alias)?.id;
const addChip = () => q('#rdProjects [data-add]');
const chipOf = (name) => [...$('rdProjects').querySelectorAll('[data-proj]')].find((b) => b.textContent === name);
await ta('새 과제 폼을 연 채 보고 있던 과제의 칩을 누르면 폼이 닫히고 그 과제가 선다 — 폼 동안 과제 칩은 꺼지고 ＋ 칩이 켜진다(rndgen 이 없으면 ＋ 는 폼)', async () => {
  assert.equal(chips().at(-1)[0], 'TEST');
  assert.equal(chips().at(-1)[1], true);
  addChip().click();
  assert.ok(!hidden('rdForm'));
  assert.equal($('rdFormTitle').textContent, '새 과제');
  assert.deepEqual(chips().filter((c) => c[1]), [], '폼 동안 켜진 과제 칩이 없다');
  assert.ok(addChip().classList.contains('active'));
  assert.equal(addChip().getAttribute('aria-pressed'), 'true');
  chipOf('TEST').click();   // 보고 있던 TEST — 전에는 아무 일도 없었다
  assert.ok(hidden('rdForm'));
  assert.ok(!hidden('rdHead'));
  assert.ok(!hidden('rdBody'));
  assert.equal(chips().at(-1)[1], true);
  assert.ok(!addChip().classList.contains('active'));
  assert.equal(addChip().getAttribute('aria-pressed'), 'false');
  // 고치기 폼은 고치는 과제의 칩이 켜진 채다(2026-10-16 사용자 지정 "어떤 과제인지 선택이 안되잖아") — ＋ 는 켜지지 않고, 그 칩을 누르면 닫힌다.
  $('rdEdit').click();
  assert.ok(!hidden('rdForm'));
  assert.deepEqual(chips().filter((c) => c[1]).map((c) => c[0]), ['TEST'], '고치는 과제의 칩이 켜져 있다');
  assert.equal(chipOf('TEST').getAttribute('aria-pressed'), 'true');
  assert.ok(!addChip().classList.contains('active'));
  chipOf('TEST').click();
  assert.ok(hidden('rdForm'));
  assert.equal(chips().at(-1)[1], true);
  assert.equal(panel.book().projects.length, 4, '폼을 닫았을 뿐 과제는 그대로');
});

const seenViews = [];
const adds = [];
const intakes = [];
const deletes = [];
await ta('훅을 달면 ＋·과제 없음 카드의 과제 더하기는 더하기 카드(onAdd)로 — 덮개(setOverlay add) 동안 머리·몸통이 숨고 ＋ 가 켜지며, 다른 칩을 누르면 덮개를 닫고 그리 간다', async () => {
  panel.onView((v) => seenViews.push(v));
  panel.onAdd((target) => adds.push(target));
  panel.onIntake((result, texts, meta) => intakes.push({ result, texts, meta }));
  panel.onDelete((id) => deletes.push(id));
  const test = projId('TEST');
  assert.deepEqual(panel.current(), { project: panel.book().projects.find((x) => x.id === test), n: 1 });
  const v = panel.view();
  assert.deepEqual([v.project.id, v.n, v.editing, v.overlay, v.yearEmpty], [test, 1, false, null, false]);
  assert.equal(v.snapshot.rev, 'r2');
  addChip().click();
  assert.deepEqual(adds, [{}]);
  assert.ok(hidden('rdForm'), '훅이 있으면 폼을 열지 않는다');
  $('rdEmptyAdd').click();
  assert.deepEqual(adds, [{}, {}]);
  // 덮개 — rndgen 의 openAdd 가 부르는 것
  let closed = 0;
  panel.setOverlay('add', () => { closed++; });
  assert.ok(hidden('rdHead') && hidden('rdBody') && hidden('rdYearEmpty'));
  assert.ok(hidden('rdEmpty'));
  assert.deepEqual(chips().filter((c) => c[1]), []);
  assert.ok(addChip().classList.contains('active'));
  assert.equal(seenViews.at(-1).overlay, 'add', 'paintAll 끝에 훅이 view 를 받는다');
  assert.equal(panel.view().overlay, 'add');
  // 같은 과제 칩 — 덮개를 닫고(닫는 쪽을 한 번 부름) 그 과제가 다시 선다
  chipOf('TEST').click();
  assert.equal(closed, 1);
  assert.equal(panel.view().overlay, null);
  assert.ok(!hidden('rdHead') && !hidden('rdBody'));
  assert.equal(chips().at(-1)[1], true);
  // 다른 과제 칩 — 덮개를 닫고 그 과제로
  panel.setOverlay('add', () => { closed++; });
  q('#rdProjects [data-proj]').click();
  assert.equal(closed, 2);
  assert.equal(chips()[0][1], true);
  assert.equal(seenViews.at(-1).project.alias, '차단기 과제');
  // 끄기(null) 는 닫는 쪽을 부르지 않는다
  panel.setOverlay('add', () => { closed++; });
  panel.setOverlay(null);
  assert.equal(closed, 2);
  assert.ok(!hidden('rdHead'));
  // 덮개를 켜면 열린 폼은 닫힌다(폼과 덮개는 하나만)
  $('rdEdit').click();
  assert.ok(!hidden('rdForm'));
  panel.setOverlay('add', () => { closed++; });
  assert.ok(hidden('rdForm'));
  assert.equal(panel.view().editing, false);
  // 직접 적기 — 덮개를 (닫는 쪽 없이) 걷고 새 과제 폼
  panel.addManually();
  assert.equal(closed, 2);
  assert.equal(panel.view().overlay, null);
  assert.ok(!hidden('rdForm'));
  assert.equal($('rdFormTitle').textContent, '새 과제');
  assert.equal(seenViews.at(-1).editing, true, '폼을 열어도 훅이 받는다');
  assert.ok(addChip().classList.contains('active'));
  $('rdFCancel').click();
  assert.ok(hidden('rdForm'));
  // pick — 그 과제·차년도로
  panel.pick(test, 1);
  assert.equal(chips().at(-1)[1], true);
  assert.equal(panel.view().n, 1);
});

await ta('빈 차년도 카드의 "사업계획서에서 이 차년도 뽑기" — 그 과제·차년도로 더하기 카드를 연다(훅이 없으면 새 과제 폼)', async () => {
  // 예산 정보가 없는(회색 점선) 차년도가 있는 과제를 찾는다 — 앞의 시험들이 넣은 것에 따라 다르다.
  let mvdc = '';
  let empty = 0;
  let was = 0;
  for (const p of panel.book().projects) {
    panel.pick(p.id);
    const off = q('#rdYears [data-year].off');
    if (off) { mvdc = p.id; empty = Number(off.dataset.year); was = panel.view().n; break; }
  }
  assert.ok(mvdc, '빈 차년도가 있는 과제');
  panel.pick(mvdc, empty);
  assert.equal(panel.view().yearEmpty, true);
  assert.ok(!hidden('rdYearEmpty'));
  assert.match($('rdYearEmpty').textContent, /R&D 설정의 연구개발계획서 YAML 넣기에/, 'YAML 넣는 길도 그대로 적혀 있다');
  const btn = q('#rdYearEmpty [data-rdg-extract]');
  assert.equal(btn.textContent, '사업계획서에서 이 차년도 뽑기');
  assert.equal(btn.closest('details'), null, '접힌 칸 뒤에 두지 않는다');
  btn.click();
  assert.deepEqual(adds.at(-1), { projectId: mvdc, n: empty });
  panel.onAdd(null);
  q('#rdYearEmpty [data-rdg-extract]').click();
  assert.ok(!hidden('rdForm'));
  $('rdFCancel').click();
  panel.onAdd((target) => adds.push(target));
  panel.pick(mvdc, was);
  panel.pick(projId('TEST'), 1);
  assert.equal(chips().at(-1)[1], true);
});

await ta('intake 는 결과를 돌려주고(종류·과제·차년도·판·들어갔는가) onIntake 훅을 부른다 · setAlias · 과제를 지우면 onDelete', async () => {
  const before = intakes.length;
  // 더 오래된 판(r0 — TEST 1차년도에는 r2 가 있다)은 들어가지 않는다 — applied false
  const old = await panel.intake([{ name: 'KR_test.yaml', text: fx('snapshot_r0.yaml') }], { source: 'file' });
  assert.equal(old.ok, true);
  assert.deepEqual({ ...old.results[0], summary: '' }, { name: 'KR_test.yaml', kind: 'snapshot', label: '연구개발계획서 스냅샷', summary: '', projectId: projId('TEST'), n: 1, rev: 'r0', applied: false });
  assert.match(old.results[0].summary, /이미 r2 가 들어 있어/);
  assert.equal(old.lines.length, 1);
  assert.deepEqual(intakes.slice(before).map((x) => x.meta), [{ source: 'file', summary: '' }]);
  // 새 과제의 스냅샷 — 과제가 서고 applied true. 훅은 넣은 글과 source·summary 를 받는다
  const text = fx('snapshot_r0.yaml').replace('과제명: 시험용 직류 차단기 개발', '과제명: 시험용 새 과제').replaceAll('RS-2026-00000001', 'RS-2026-00000077');
  const texts = [{ name: 'KR_시험용_새_과제.yaml', text }];
  const res = await panel.intake(texts, { source: 'extract', summary: '' });
  const made = panel.book().projects.find((x) => x.name === '시험용 새 과제');
  assert.ok(made);
  assert.deepEqual([res.ok, res.error, res.results.length], [true, '', 1]);
  assert.deepEqual({ ...res.results[0], summary: '' }, { name: 'KR_시험용_새_과제.yaml', kind: 'snapshot', label: '연구개발계획서 스냅샷', summary: '', projectId: made.id, n: 1, rev: 'r0', applied: true });
  assert.match(res.results[0].summary, /^과제 만듦: 시험용 새 과제 · 1차년도/);
  assert.equal(intakes.at(-1).result, res);
  assert.equal(intakes.at(-1).texts, texts);
  assert.deepEqual(intakes.at(-1).meta, { source: 'extract', summary: '' });
  // 모르는 YAML — 들어간 것이 없으면 훅은 부르지 않는다
  const n = intakes.length;
  const bad = await panel.intake([{ name: 'x.yaml', text: 'a: 1' }]);
  assert.deepEqual([bad.ok, bad.results.length, intakes.length], [false, 0, n]);
  assert.match(bad.error, /^x\.yaml: 아는 모양의 YAML 이 아닙니다/);
  // 별칭 — 비었거나 겹치면 붙이지 않는다(대소문자 무시)
  assert.deepEqual(panel.setAlias(made.id, ' '), { ok: false, error: '별칭을 적으세요 — 예) SSCB' });
  assert.deepEqual(panel.setAlias(made.id, 'test'), { ok: false, error: '같은 별칭의 과제가 있습니다 — 시험용 직류 차단기 개발' });
  assert.deepEqual(panel.setAlias('없는 과제', 'NEWX'), { ok: false, error: '과제를 찾지 못했습니다' });
  assert.deepEqual(panel.setAlias(made.id, 'NEWX'), { ok: true, error: '' });
  assert.ok(chips().some((c) => c[0] === 'NEWX'));
  assert.ok(logs.some((l) => l.text === 'R&D 과제 별칭: 시험용 새 과제 → NEWX'));
  // 지우기(두 번) → onDelete(그 과제 id)
  panel.pick(made.id, 1);
  $('rdEdit').click();
  $('rdFDel').click();
  $('rdFDel').click();
  assert.deepEqual(deletes, [made.id]);
  assert.equal(panel.book().projects.length, 4);
  panel.pick(projId('TEST'), 1);
  assert.equal(chips().at(-1)[0], 'TEST');
  assert.equal(chips().at(-1)[1], true);
  // 다른 훅이 없으면(통합 앞) 손잡이의 download·readAsset 은 만들 때 받은 것 그대로
  await panel.download('x', 'a.yaml', 'text/yaml');
  assert.deepEqual(downloads.at(-1), { text: 'x', name: 'a.yaml', type: 'text/yaml' });
  assert.match(await panel.readAsset('rnd/skills.json'), /rnd-kr-extract/);
});

t('더하기·변경사항 카드가 놓인 파일의 전파를 멈춰도 YAML 넣기 칸의 "놓기" 표시는 거둔다(잡는 단계)', () => {
  const host = $('rdgRevise');
  const stop = (e) => e.stopPropagation();
  host.addEventListener('drop', stop);
  $('rdIntake').classList.add('over');
  const ev = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [] } });
  host.dispatchEvent(ev);
  host.removeEventListener('drop', stop);
  assert.ok(!$('rdIntake').classList.contains('over'));
  panel.onView(null);
  panel.onAdd(null);
  panel.onIntake(null);
  panel.onDelete(null);
});

console.log('다시 열기');
await ta('저장된 것으로 다시 선다 — 공문 탭에서 다시 가져오지 않는다', async () => {
  await wait(500);
  panel.hide();
  assert.ok(hidden('rnd'));
  panel = make();
  $('rdNoteSection').innerHTML = '';   // 새로 연 화면에는 섹션 목록이 없다
  await panel.show();
  assert.ok(!hidden('rnd'));
  assert.deepEqual([...$('rdNoteSection').options].map((o) => [o.value, o.textContent]), [['s1', '연구 › R&D']], '고른 섹션은 이름으로 다시 선다');
  assert.equal($('rdNoteState').textContent, '꺼짐');
  assert.deepEqual(chips().map((c) => c[0]), ['차단기 과제', '파일 과제', '수소전기추진 연구', 'TEST']);
  assert.equal(chips().at(-1)[1], true);
  assert.equal(logItems().length, 1);
  assert.equal(rosterTable($('rdRoster')).length, 2);
  assert.equal(chItems().length, 11);
  assert.equal(rows().find((r) => r[0] === '인건비')[1], '30,000');
  assert.equal(panel.book().projects.length, 4);
  assert.equal(panel.book().projects[3].years[1].snapshot.rev, 'r2');
});

console.log(`\n${pass} passed`);
