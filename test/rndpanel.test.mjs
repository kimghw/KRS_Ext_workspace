// R&D 탭의 화면(rndpanel.js) — 과제·차년도 칩, 예산 줄(계획을 고치면 변경이력에 저절로), 연구내역·변경이력 적기·고치기·지우기(두 번),
// 과제 더하기·고치기(책임자·연구기간을 바꾸면 변경이력에 저절로)·지우기, 요약 복사·JSON 저장·불러오기, 공문 탭의 과제 가져오기, 다시 열기.
// 진짜 화면(sidepanel.html)에 붙여 눌러 본다. 어디에도 보내지 않는다 — 저장소는 흉내이고 날짜는 2026-10-08 로 못 박는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import { readZip } from '../src/zip.js';
import KRX_SP from '../rerp/spstore.js';
import { normalizeBook } from '../src/rnd.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok) => { for (let i = 0; i < 80 && !ok(); i++) await wait(25); };
/** 저절로 맞추기(장부를 고친 뒤 1.2초)까지 기다리는 긴 until — 최대 5초. */
const untilLong = async (ok) => { for (let i = 0; i < 200 && !ok(); i++) await wait(25); };

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { window } = new JSDOM(html, { url: 'https://example.org/' });
const doc = window.document;
for (const g of ['document', 'FileReader', 'Element', 'HTMLElement', 'File', 'Blob']) globalThis[g] = window[g];
globalThis.window = window;

// 공문 탭의 공문 설정에 과제 하나가 있다. 저장은 복사해 둔다 — 정말 저장이 됐는지 보려고.
const store = { gongmunProjects: [{ name: 'MVDC 차단기 개발', alias: '차단기 과제', code: 'RND-20-2026', lead: '박기도', period: '2026.04.01 ~ 2029.12.31', about: '', content: '', account: '' }] };
globalThis.chrome = { storage: { local: { get: async () => store, set: async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); }, remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; } } } };

// rerp/plan.js 의 내보내기(⬆)는 navigator.clipboard 로 바로 복사한다 — 패널의 copyText 와 같은 바구니(copied)에 담는다.
const copied = [];
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'rndpanel-test', clipboard: { writeText: async (text) => { copied.push(text); } } } });

const { createRndPanel } = await import('../rndpanel.js');
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logs = [];
const downloads = [];
const flashed = [];
// SharePoint(OneDrive) 흉내 — rerp/sharesync.js 가 rerp/spstore.js(KRX_SP) 대신 쓰는 가짜 저장소(deps.store): 메모리 폴더 트리 sp.tree = { [서버 상대 경로]: { [파일 이름]: 글 } }.
// cfg 는 진짜 KRX_SP.parseFolder·childCfg 것(순수 함수)이라 folderPath 로 찍는다. 쓰기(openWriter)도 메모리 — 실 SharePoint 에는 닿지 않고 실 fetch 는 막아 둔다(make 의 spFetch).
// kr_ext_rerp tests/prjdoc-sync.test.js 의 가짜 store 와 같은 꼴. authList 를 켜면 폴더 목록이 로그인 필요(auth)로 끝난다.
const ORIGIN = 'https://krclass-my.sharepoint.com';
const BASE = '/personal/me/Documents/업무/shared';
const sp = { tree: { '/personal/me/Documents': {} }, calls: [], puts: [], authList: false, shared: [], store: null };
/** 트리를 비운다(밑폴더까지만 남김) — 공유 검사 사이에 지난 과제 폴더가 남지 않게. */
sp.reset = () => { sp.tree = { '/personal/me/Documents': {}, '/personal/me/Documents/업무': {}, [BASE]: {} }; sp.calls.length = 0; sp.puts.length = 0; };
const spErr = (kind, msg) => Object.assign(new Error(msg || kind), { kind });
const spCfg = (p) => { const c = KRX_SP.parseFolder(`${ORIGIN}${p.split('/').map(encodeURIComponent).join('/')}`); c.mine = true; return c; };
const spMeta = (p, name) => ({ name, length: sp.tree[p][name].length, modified: '2026-10-08T00:00:00Z', version: '1.0', uniqueId: `u-${name}`, checkedOut: false, checkedOutByMe: false });
const spWriter = (p) => ({
  folderPath: p,
  ensureFolder: async () => { sp.calls.push(`ensureFolder:${p}`); if (p in sp.tree) return { created: false }; sp.tree[p] = {}; return { created: true }; },
  // KRX_SP 처럼 여러 단을 한 번에(문서함 뿌리 /personal/me/Documents 는 있다) → { created, made }
  ensurePath: async (pp) => { sp.calls.push(`ensurePath:${pp}`); const segs = pp.split('/').filter(Boolean); const made = []; for (let i = 3; i <= segs.length; i++) { const at = `/${segs.slice(0, i).join('/')}`; if (!(at in sp.tree)) { sp.tree[at] = {}; made.push(at); } } return { created: made.length > 0, made }; },
  at: (cfg) => spWriter(cfg.folderPath),
  modify: async (name, transform) => {
    sp.calls.push(`modify:${p}/${name}`);
    if (!(p in sp.tree)) throw spErr('nofolder', `공유 폴더가 없습니다: ${p}`);
    const cur = name in sp.tree[p] ? sp.tree[p][name] : null;
    const r = transform(cur);
    if (r && r.changed) { sp.tree[p][name] = r.text; sp.puts.push(`${p}/${name}`); return { changed: true, created: cur == null, updated: cur != null, checkedIn: cur != null, version: '2.0' }; }
    return { changed: false, checkedIn: false };
  },
  // 사람 공유 — 이름이면 <이름>@krs.co.kr, 이메일이면 그 사람(표시 이름은 sp.titles — 영문). 폴더의 권한(sp.perms[path])에도 남겨 permissions 가 보게(같은 사람이면 역할을 바꿈). sp.permFail 이 'share' 면 아무도 공유되지 않는다.
  sharePeople: async (path, names, { role } = {}) => {
    sp.calls.push(`share:${path}:${names.join(',')}:${role || 'edit'}`);
    if (sp.permFail === 'share') return { shared: [], ambiguous: [], notFound: [], failed: names.map((n) => ({ name: n, email: n, error: '공유 실패(검사)' })), error: '공유 실패(검사)', role };
    const list = sp.perms[path] = sp.perms[path] || [];
    const shared = names.map((n) => {
      const email = n.includes('@') ? n.toLowerCase() : `${n}@krs.co.kr`;
      const name = n.includes('@') ? (sp.titles[email] || n) : n;
      let who = list.find((x) => x.email === email);
      if (!who) { who = { id: ++sp.nextId, name, email, role: '' }; list.push(who); }
      who.role = role === 'read' ? 'read' : 'edit';
      return { name, email };
    });
    return { shared, ambiguous: [], notFound: [], failed: [], role };
  },
  // 권한 거두기(2026-10-19) — 그 사람을 폴더의 권한에서 뺀다. sp.permFail 이 'unshare' 면 실패.
  unshare: async (path, ids) => {
    sp.calls.push(`unshare:${path}:${ids.join(',')}`);
    if (sp.permFail === 'unshare') throw spErr('http', '권한 거두기 실패(검사)');
    const list = sp.perms[path] || []; const removed = [], missing = [];
    for (const id of ids) { const i = list.findIndex((x) => x.id === id); if (i < 0) missing.push(id); else { removed.push({ id, roles: [list[i].role === 'read' ? 1073741826 : 1073741827] }); list.splice(i, 1); } }
    return { removed, missing };
  },
  orgLink: async (path, { edit } = {}) => { sp.calls.push(`link:${path}`); return { url: `${ORIGIN}/:f:/g/personal/me/${encodeURIComponent(path)}?e=${edit === false ? 'r' : 'w'}`, edit: edit !== false, via: 'fake' }; },
  rename: async () => { throw spErr('http', '검사에서는 이름을 바꾸지 않는다'); },
  close: async () => { sp.calls.push(`close:${p}`); },
});
// 공유 권한(2026-10-19) 흉내 — perms 는 폴더 경로 → [{ id, name(표시 이름 — 영문), email, role }], people 은 사람 찾기(findPeople)가 답할 이름 → { email, title }, ambiguous 는 이름 → 후보, titles 는 이메일 → 표시 이름, permFail 은 'share' | 'unshare'.
Object.assign(sp, { perms: {}, people: {}, ambiguous: {}, titles: {}, nextId: 100, permFail: '', links: [] });
sp.store = {
  // 밑폴더 풀기 — 비우면 내 OneDrive 의 문서/업무/shared(KRX_SP.resolveMyFolder 자리, fetch 없이), 주소면 진짜 parseFolder
  resolveFolder: async (input) => { sp.calls.push(`resolve:${input || '(내 OneDrive)'}`); if (sp.authList) throw spErr('auth', '이 브라우저에서 SharePoint(OneDrive)에 로그인하세요'); return input ? KRX_SP.parseFolder(input) : spCfg(BASE); },
  resolveMyFolder: async () => spCfg(BASE),
  listFolders: async (cfg) => {
    sp.calls.push(`folders:${cfg.folderPath}`);
    if (sp.authList) throw spErr('auth', '이 브라우저에서 SharePoint(OneDrive)에 로그인하세요');
    if (!(cfg.folderPath in sp.tree)) throw spErr('nofolder', `공유 폴더가 없습니다: ${cfg.folderPath}`);
    return Object.keys(sp.tree).filter((k) => k.startsWith(`${cfg.folderPath}/`) && !k.slice(cfg.folderPath.length + 1).includes('/')).map((k) => ({ name: k.split('/').pop(), path: k, itemCount: Object.keys(sp.tree[k]).length, modified: '2026-10-08T00:00:00Z' }));
  },
  listFiles: async (cfg) => { sp.calls.push(`list:${cfg.folderPath}`); if (!(cfg.folderPath in sp.tree)) throw spErr('nofolder', `공유 폴더가 없습니다: ${cfg.folderPath}`); return Object.keys(sp.tree[cfg.folderPath]).map((nm) => spMeta(cfg.folderPath, nm)); },
  readFile: async (cfg, name) => { sp.calls.push(`read:${cfg.folderPath}/${name}`); const f = sp.tree[cfg.folderPath]; return f && name in f ? { text: f[name], meta: spMeta(cfg.folderPath, name) } : null; },
  openWriter: async (cfg) => { sp.calls.push(`open:${cfg.siteUrl}`); return spWriter(cfg.folderPath); },
  sharedWithMe: async () => { sp.calls.push('shared'); return sp.shared; },
  // 폴더 권한(2026-10-19) — sp.perms 의 사람들(나는 박기도 park@krs.co.kr · id 3). 로그인 필요(authList)·없는 폴더는 던진다.
  permissions: async (cfg) => {
    sp.calls.push(`perms:${cfg.folderPath}`);
    if (sp.authList) throw spErr('auth', '이 브라우저에서 SharePoint(OneDrive)에 로그인하세요');
    if (!(cfg.folderPath in sp.tree)) throw spErr('nofolder', `공유 폴더가 없습니다: ${cfg.folderPath}`);
    const list = sp.perms[cfg.folderPath] || [];
    return { unique: list.length > 0, me: { id: 3, name: 'PARK Kido', email: 'park@krs.co.kr' }, people: list.map((x) => ({ ...x, login: `i:0#.f|membership|${x.email}`, roles: [], me: x.email === 'park@krs.co.kr' })), links: sp.links };
  },
  // 사람 찾기(2026-10-19) — sp.people 에 있으면 found, sp.ambiguous 에 있으면 ambiguous, 아니면 notFound.
  findPeople: async (cfg, names) => {
    sp.calls.push(`find:${names.join(',')}`);
    if (sp.authList) throw spErr('auth', '이 브라우저에서 SharePoint(OneDrive)에 로그인하세요');
    const found = [], ambiguous = [], notFound = [];
    for (const n of names) { if (sp.people[n]) found.push({ name: n, ...sp.people[n], login: `i:0#.f|membership|${sp.people[n].email}` }); else if (sp.ambiguous[n]) ambiguous.push({ name: n, candidates: sp.ambiguous[n] }); else notFound.push(n); }
    return { found, ambiguous, notFound };
  },
};
/** 과제 폴더의 파일을 JSON 으로. */
const spDoc = (folder, name) => JSON.parse(sp.tree[`${BASE}/${folder}`][name]);
const spFolders = () => Object.keys(sp.tree).filter((k) => k.startsWith(`${BASE}/`)).map((k) => k.slice(BASE.length + 1)).sort();
// rERP 흉내(rerp/erp.js 자리) — 과제 목록(recs)·비목별 잔액(items)·미청구 카드(cards)를 검사가 정한다. 처음엔 비어 있어 저절로 잇기가 "목록이 비어 있습니다" 로 끝난다.
const erpFake = {
  recs: [], items: [], cards: [], loggedIn: true, calls: [],
  // 참여인력(rtask_0008_t03_01_r001)·다른 과제 참여율(rtask_0013_12_r003) — 검사가 participants/others 를 정한다(과제번호마다). 없으면 빈 답.
  participants: {}, others: {},
  settingsOf: (o) => ({ ...o }),
  async call(svc, input) {
    erpFake.calls.push(`${svc}:${input.PRJ_NO || ''}`);
    if (!erpFake.loggedIn) throw Object.assign(new Error(`${svc}: 사용자 정보가 존재하지 않습니다`), { kind: 'login' });
    if (svc === 'rtask_0008_t03_01_r001') return { INFO_REC: erpFake.participants[input.PRJ_NO] || [] };
    if (svc === 'rtask_0013_12_r003') return { STD_AMT: '0', REC: erpFake.others[`${input.PRJ_NO}:${input.SEQ_NO}`] || [] };
    throw Object.assign(new Error(`${svc}: 모르는 서비스`), { kind: 'service' });
  },
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
let myName = '박기도';   // 설정의 내 이름 — 예상 비용 페이지는 과제책임자(== 내 이름)만 만든다
// R&D PMS 과제 목록 흉내(Job Id 저절로 찾기가 받는다 — 줄은 PMS 그대로의 꼴, src/jobid.js slimJob 이 줄인다). 검사가 rows 를 정하고, fail 이 있으면 받지 못한 것으로.
const jobsFake = { rows: [], fail: '', calls: 0 };
// 회계(e-accounting) 흉내(회계 I/O 저절로 찾기·회계 예산 스냅샷 — src/eacct.js 의 fetchIoList·fetchAcct 자리). options 는 내 부서 과제(I/O) 목록, acct 는 받을 스냅샷(과제 코드 → 줄), fail 은 못 받은 까닭(login 이면 로그인).
const acctFake = { options: [], acct: {}, fail: '', login: false, lists: 0, gets: 0 };
const acctErr = () => { const e = new Error(acctFake.fail); e.login = acctFake.login; return e; };
const make = () => createRndPanel({
  erp: erpFake, me: () => myName, store: sp.store, spFetch: async () => { throw new Error('실 fetch 금지 — 공유는 가짜 저장소(sp)로'); },
  jobs: async () => { jobsFake.calls++; if (jobsFake.fail) throw new Error(jobsFake.fail); return jobsFake.rows; },
  acct: {
    list: async () => { acctFake.lists++; if (acctFake.fail) throw acctErr(); return acctFake.options; },
    get: async (year, io) => { acctFake.gets++; if (acctFake.fail) throw acctErr(); return acctFake.acct[io] ? { year, at: '2026-10-08T09:30:00.000Z', io, ...acctFake.acct[io] } : null; },
  },
  $: (id) => doc.getElementById(id), escapeHtml,
  logEvent: (kind, ok, text) => logs.push({ kind, ok, text }),
  copyText: async (text) => { copied.push(text); return true; },
  flash: (btn, text) => flashed.push([btn.id, text]),
  download: async (text, name, type) => { downloads.push({ text, name, type }); },
  // 확장 안의 파일(rnd/skills.json · rnd/skills/…)은 저장소에서 읽는다.
  readAsset: async (p, as) => { const buf = fs.readFileSync(new URL(`../${p}`, import.meta.url)); return as === 'bytes' ? new Uint8Array(buf) : buf.toString('utf8'); },
  today: () => '2026-10-08',
  openPlus: () => { opened.push('plus'); },   // 설정 › Plus(공유 카드 — 2026-10-25 R&D 설정에서 옮김)를 연 횟수
});
/** 패널이 설정 › Plus 를 열어 달라고 한 기록. */
const opened = [];
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
// 참여인력 칸의 rERP 참여인력 표(rerp/staff.js 의 사람 모양 — 보이기만, 2026-10-18)의 사람 줄 — 성명 · 역할 · 월급여 · 참여 · 지급 합 · 참여율(연간 — 그 아래 월 최대는 따로 본다).
const staffRows = () => [...$('rdRoster').querySelectorAll('.rd-staff-row')].map((tr) => [...tr.children].map((td) => (td.classList.contains('rd-td-rate') ? td.firstChild.textContent : td.textContent).trim()));
const staffMonths = (name) => { const tr = [...$('rdRoster').querySelectorAll('.rd-staff-row')].find((x) => x.children[0].textContent === name); return [...tr.nextElementSibling.querySelectorAll('.rd-mo')].map((b) => `${b.querySelector('b').textContent}${b.classList.contains('off') ? '(없음)' : b.classList.contains('max') ? '(최대)' : ''}`); };
const staffWarns = () => [...$('rdRoster').querySelectorAll('.rd-staff-warn li')].map((li) => [li.className, li.textContent]);
const sectionHeads = (li) => [...li.querySelectorAll('.rd-sec h4')].map((h) => h.textContent);
const chItems = () => [...$('rdChanges').querySelectorAll('li')].map((li) => [
  li.querySelector('.rd-date').textContent, li.querySelector('.rd-kind').textContent, li.querySelector('.rd-title').textContent,
  li.querySelector('.rd-diff')?.textContent || '', li.querySelector('.rd-reason-text')?.textContent || '', li.classList.contains('auto'),
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
  assert.deepEqual([...$('rdInfo').querySelectorAll(':scope > summary > *')].map((x) => x.id || x.tagName.toLowerCase() + (x.getAttribute('class') ? `.${x.getAttribute('class')}` : '')), ['svg', 'rdName', 'rdEdit', 'rdHeadYear', 'rdHeadLink', 'rdHeadSet', 'span.summary-detail'], '머리 줄: 폴더 그림 · 별칭 · 연필 · 차년도 · 링크 · 톱니 · 과제 정보(2026-10-19)');
  assert.ok($('rdHeadYear').querySelector('svg') && !$('rdHeadYear').textContent.trim() && /차년도 더하기·고치기/.test($('rdHeadYear').title), '차년도 아이콘은 그림만 — 툴팁에 쓰임새');
  assert.ok($('rdHeadLink').querySelector('svg') && $('rdHeadSet').querySelector('svg') && !$('rdHeadLink').textContent.trim() && !$('rdHeadSet').textContent.trim(), '링크·톱니는 그림만');
  assert.match($('rdHeadLink').title, /꺼져 있습니다/, '공유가 꺼져 있으면 툴팁이 알린다');
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
  // R&D 설정(2026-10-11 사용자 지정) — 탭 맨 아래 접힌 한 줄 안에 rERP 집행내역 체크 · 공유 (SharePoint) · 연구개발계획서 YAML 넣기 · 차년도 YAML 뽑는 스킬
  assert.equal($('rnd').lastElementChild.id, 'rdSetBox');
  assert.ok(!$('rdSetBox').open, 'R&D 설정은 접혀 있다');
  // 2026-10-11 사용자 지정 — 공문 탭의 공문 설정(gmPresetBox)과 같은 카드 한 줄: 아이콘 · 이름 · 형편(summary-detail) · 화살표
  assert.ok($('rdSetBox').classList.contains('card') && $('rdSetBox').classList.contains('rd-box'), 'R&D 설정은 공문 설정처럼 카드');
  assert.deepEqual([...$('rdSetBox').querySelectorAll(':scope > summary > *')].map((x) => x.tagName.toLowerCase() + (x.getAttribute('class') ? `.${x.getAttribute('class')}` : '')), ['svg', 'span', 'span.summary-detail']);
  assert.deepEqual([...$('rdSetBox').querySelectorAll(':scope > .rd-set-body > *')].map((x) => x.id || x.className), ['rd-check rd-set-check', 'rdItemBox', 'rdShareGo', 'rdIntake', 'rdSkillBox']);
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
  assert.equal($('rdSetState').textContent, 'rERP 켬 · 공유 꺼짐', '형편은 공문 설정처럼 한 줄에 들어가게 짧게');
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
// 2026-10-19 사용자 지정 "이것도 주요 변경사항만 보이게 하고 세부적인 것은 접어줘" — YAML 고치기로 남은 줄마다 사유가 세 줄씩이던 그림.
t('적은 사유는 접힌 한 줄 — 머리 줄·전 → 후만 펴 두고 사유는 "사유" 뒤에 한 줄로 잘라 보이며 눌러 편다. 펴 둔 채 다시 그려도 접히지 않는다', () => {
  const li = q('#rdChanges li');
  const fold = li.querySelector(':scope > details.rd-reason');
  assert.ok(fold && !fold.open, '사유는 details 로, 처음엔 접힌 채');
  assert.equal(fold.querySelector('summary').textContent, '사유연구원 1명 충원', '접힌 줄은 사유 이름표 + 한 줄로 자른 글');
  assert.equal(fold.querySelector('.rd-reason-text').textContent, '연구원 1명 충원');
  const folded = (sel) => li.contains(li.querySelector(sel).closest('details')); // 카드 자체(rdChangeBox)의 details 는 세지 않는다
  assert.ok(!folded('.rd-row-head') && !folded('.rd-diff') && folded('.rd-reason-text'), '날짜·구분·항목·전 → 후는 접지 않고 사유 글만 접는다');
  fold.open = true;
  q('#rdChanges li [data-edit]').click(); // 고치기는 목록을 다시 그린다(editing 띠)
  assert.ok(q('#rdChanges li').classList.contains('editing'));
  assert.ok(q('#rdChanges li > details.rd-reason').open, '다시 그려도 펴 둔 사유는 펴진 채');
  $('rdChCancel').click();
  assert.ok(hidden('rdChForm') && !q('#rdChanges li').classList.contains('editing'));
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
t('과제 더하기(머리 줄의 차년도 아이콘 — rndgen 이 없으면 새 과제 폼; 칩 줄의 ＋ 는 2026-10-19 에 없앰) → 폼이 서고 머리·몸통은 숨는다. 과제명 없이는 저장 안 됨', () => {
  assert.equal(q('#rdProjects [data-add]'), null, '칩 줄에 ＋ 가 없다');
  $('rdHeadYear').click();
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
  assert.ok(hidden('rdStaffRefresh'), 'rERP 에 이어지지 않은 차년도라 참여인력 ↻ 는 없다(2026-10-18 — 계산은 kr_ext_rerp 의 사업비 변경 메뉴)');
  assert.match(roster.querySelector('.rd-hint').textContent, /^rERP 에 이어지지 않은 차년도라 계획서의 참여연구자를 보이기만 합니다.*사업비 변경 메뉴에서 합니다\.$/);
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

console.log('공유 (SharePoint, 2026-10-18) — 과제마다 OneDrive 공유 폴더의 연차 파일과 맞춘다(원노트·MCP 없이 브라우저 로그인만, 가짜 저장소)');
const change = (node, value) => { if (value !== undefined) node.value = value; node.dispatchEvent(new window.Event('change', { bubbles: true })); };
const pickChip = (label) => [...doc.querySelectorAll('#rdProjects [data-proj]')].find((b) => b.textContent === label).click();
const bookProject = (alias) => panel.book().projects.find((x) => x.alias === alias);
t('꺼져 있는 것이 기본 — 아무 데도 닿지 않는다. 카드는 설정 › Plus(2026-10-25), R&D 설정에는 그리로 가는 한 줄(YAML 넣는 곳 바로 위). 옛 원노트 카드는 없다', () => {
  assert.equal($('rdShareState').textContent, '꺼짐');
  assert.equal($('rdShareGoState').textContent, '꺼짐');
  assert.ok(!$('rdShareOn').checked);
  assert.ok($('rdShareSync').disabled && $('rdShareLink').disabled);
  assert.deepEqual(sp.calls, [], '꺼져 있으면 저장소에 닿지 않는다(탭을 열 때도)');
  assert.equal($('rdShareGo').nextElementSibling.id, 'rdIntake');
  assert.equal($('rdShareBox'), null);
  for (const id of ['rdShareOn', 'rdShareFolder', 'rdShareWith', 'rdShareSync', 'rdShareOpen', 'rdShareLink', 'rdShareMsg', 'rdShareState', 'plusDiscover', 'plusProjectSync', 'plusPrjPick', 'plusPages']) assert.ok($('setPlus').contains($(id)), `${id} 는 설정 › Plus 안`);
  const n = opened.length;
  $('rdShareGo').click();
  assert.equal(opened.length, n + 1, 'R&D 설정의 한 줄을 누르면 설정 › Plus 로');
  assert.equal($('rdShareFolder').placeholder, '비우면 내 OneDrive 의 문서/업무/shared');
  for (const id of ['rdNoteBox', 'rdNoteOn', 'rdPlusOn', 'rdResShare']) assert.equal($(id), null, `${id} 는 없다`);
});
await ta('켜면 바로 맞춘다 — 밑폴더(내 OneDrive 문서/업무/shared)를 만들고 과제마다 약칭 폴더에 연차 파일을 쓴다: 과제 정보·예산 계획·변경이력·연구내용, 집행·참여연구원 계획은 없다. 예상비용.json 은 만들지 않는다', async () => {
  $('rdShareOn').checked = true;
  change($('rdShareOn'));
  await until(() => /^맞춤 /.test($('rdShareState').textContent));
  assert.match($('rdShareState').textContent, /^맞춤 \d\d\.\d\d \d\d:\d\d · 과제 4개$/);
  assert.ok(sp.calls[0].startsWith('resolve:'), '밑폴더를 풀고');
  assert.ok(BASE in sp.tree, '업무/shared 를 만들었다');
  assert.deepEqual(spFolders(), ['TEST', '수소전기추진 연구', '차단기 과제', '파일 과제'].sort(), '과제 폴더 이름은 별칭(없으면 과제명 — 이어지지 않은 과제는 별칭이 없어도 이 장부만의 과제라 폴더를 만든다)');
  const p = bookProject('차단기 과제');
  const y1 = spDoc('차단기 과제', '1차년도.json');
  assert.deepEqual([y1.v, y1.kind, y1.year.n, y1.year.start, y1.year.end], [2, 'year', 1, '2026-04', '2027-03']);
  assert.deepEqual([y1.project.prjNo, y1.project.alias, y1.project.prjNm, y1.project.rspr, y1.project.start, y1.project.end, y1.project.wsId, y1.project.code],
    [p.id, '차단기 과제', 'MVDC 차단기 개발', p.lead, p.start, p.end, p.id, p.code], '이어지지 않은 과제의 열쇠는 장부 id — wsId·code 는 모르는 칸으로 보존');
  assert.equal(spDoc('파일 과제', '1차년도.json').project.alias, '', '별칭이 없는 과제의 파일 alias 는 비어 있다(폴더 이름만 과제명)');
  assert.ok(y1.project.aliasAt > 0 && p.aliasAt === y1.project.aliasAt, '별칭을 바꾼 시각이 파일과 장부에 같이');
  assert.deepEqual(y1.budget.map((b) => [b.name, b.plan]), p.years[1].budget.filter((r) => r.plan != null).map((r) => [r.item, r.plan]), '예산은 계획이 적힌 줄만');
  assert.ok(y1.budget.every((b) => !('used' in b) && b.by === '박기도'), '집행은 없고 by 는 내 이름');
  assert.deepEqual(y1.changes.map((c) => c.id).sort(), p.years[1].changes.map((c) => c.id).sort(), '변경이력 그대로');
  assert.ok(y1.changes.every((c) => 'by' in c && 'at' in c));
  assert.deepEqual(y1.staff, { plans: [], del: {} }, '참여연구원 계획은 올리지 않는다');
  assert.equal(y1.updatedBy, '박기도');
  assert.ok(!('예상비용.json' in sp.tree[`${BASE}/차단기 과제`]), '예상 비용은 받기만 — 파일을 만들지 않는다');
  const yt = spDoc('TEST', '1차년도.json');
  assert.deepEqual(yt.research.map((r) => [r.id, r.rev, 'prjNo' in r]), [['시험용직류차단기개발#1', 'r2', false]], 'YAML 로 넣은 연구내용 기록은 연차 파일로(연결 칸은 빼고)');
  assert.match($('rdShareMsg').textContent, /^맞췄습니다 — 과제 4개 · 파일 \d+개 · 씀 \d+/);
  assert.ok(!$('rdShareMsg').classList.contains('error'));
  assert.equal($('rdSetState').textContent, 'rERP 켬 · 공유 켬');
  assert.match($('rdShareOpen').textContent, /^폴더 열기 — /, '보고 있는 과제의 폴더');
  assert.match($('rdShareOpen').dataset.url, /^https:\/\/krclass-my\.sharepoint\.com\/personal\/me\//);
  await wait(10);
  assert.deepEqual([store.rndShare.on, store.rndShare.folder], [true, '']);
  assert.ok(store.planSyncState?.ok && store.shareState?.ok && store.shareIndex, 'rerp 와 같은 저장 키(planSyncState · shareState · shareIndex)에 결과를 남긴다');
  assert.ok(logs.some((l) => l.text === 'R&D 공유 (SharePoint) 켬'));
  assert.ok(logs.some((l) => l.kind === 'rnd' && /^R&D 공유 맞춤\(켬\): 과제 4개/.test(l.text)));
});
await ta('다른 기기·동료가 고친 연차 파일을 지금 동기화로 받는다 — 비고(WORKSPACE 몫)·별칭(늦게 바꾼 쪽)·변경이력(합집합)·예산 계획(파일이 더 늦으면 그 줄 전체), 달라진 것이 파일 쪽뿐이면 쓰지 않는다', async () => {
  await wait(5);
  const folder = `${BASE}/파일 과제`;
  const d = JSON.parse(sp.tree[folder]['1차년도.json']);
  const later = Date.now();
  d.project.note = '동료가 적은 비고';
  d.project.alias = '파일';
  d.project.aliasAt = later;
  d.changes.push({ id: 'c-remote', date: '2026-10-07', kind: '기타', item: '동료 변경', before: '', after: '', reason: '동료가 적음', by: '동료', at: later, auto: false });
  d.budget = [{ name: '인건비', plan: 1234000, at: later, by: '동료' }];
  d.updatedAt = new Date(later).toISOString();
  d.updatedBy = '동료';
  sp.tree[folder]['1차년도.json'] = JSON.stringify(d, null, 2);
  const n = sp.puts.length;
  $('rdShareSync').click();
  await until(() => chips().some((c) => c[0] === '파일') && !$('rdShareSync').disabled);
  const p = bookProject('파일');
  assert.equal(p.note, '동료가 적은 비고');
  assert.equal(p.aliasAt, later, '별칭의 시각은 파일 것');
  assert.ok(p.years[1].changes.some((c) => c.id === 'c-remote' && c.by === '동료' && c.at === later), '변경이력은 합집합 — by·at 그대로');
  assert.deepEqual(p.years[1].budget.filter((r) => r.plan != null).map((r) => [r.item, r.plan]), [['인건비', 1234000]], '예산 계획은 파일(더 늦음) 것 — 줄 전체가 한 덩이');
  assert.match($('rdShareMsg').textContent, /받음 1/);
  assert.equal(sp.puts.length, n, '달라진 것이 파일 쪽뿐이면 쓰지 않는다');
  assert.equal(sp.tree[folder]['1차년도.json'], JSON.stringify(d, null, 2), '파일은 그대로');
  assert.ok(logs.some((l) => /^R&D 공유 맞춤\(지금 동기화\)/.test(l.text)));
});
await ta('이 기기에서 과제 정보를 고치면 잠깐 뒤 저절로 맞춰 파일에 쓴다 — 별칭은 늦게 바꾼 쪽', async () => {
  pickChip('파일');
  $('rdEdit').click();
  type($('rdFAlias'), '파일 과제');
  $('rdFSave').click();
  assert.ok(bookProject('파일 과제').aliasAt > 0);
  await until(() => JSON.parse(sp.tree[`${BASE}/파일 과제`]['1차년도.json']).project.alias === '파일 과제');
  const d = JSON.parse(sp.tree[`${BASE}/파일 과제`]['1차년도.json']);
  assert.equal(d.project.aliasAt, bookProject('파일 과제').aliasAt);
  assert.equal(d.project.note, '동료가 적은 비고', '받은 비고는 그대로');
  assert.ok(logs.some((l) => /^R&D 공유 맞춤\(고침\)/.test(l.text)));
});
/** 새 과제를 폼으로 더한다(별칭 필수) — 공유가 켜져 있으면 잠깐 뒤 저절로 폴더·연차 파일이 생긴다. */
const addProject = async (name, alias, extra = {}) => {
  panel.addManually();   // 더하기 카드의 직접 적기 — 새 과제 폼(＋ 칩은 없다)
  type($('rdFName'), name);
  type($('rdFAlias'), alias);
  for (const [id, v] of Object.entries(extra)) type($(id), v);
  $('rdFSave').click();
  assert.ok(bookProject(alias), `${alias} 를 더했다`);
};
/** 보고 있는 과제를 지운다(두 번 누르기). */
const delCurrent = () => { $('rdEdit').click(); $('rdFDel').click(); $('rdFDel').click(); };
const syncNow = async () => { $('rdShareSync').click(); await untilLong(() => !$('rdShareSync').disabled); };
await ta('지운 과제는 되살아나지 않는다(2026-10-19 검토) — 묘비(deletedAt)가 파일에 퍼진 뒤 두 번 맞춰도 과제 수·폴더가 그대로, 별칭만 든 payload 로 빈 과제를 만들지 않는다', async () => {
  await addProject('ZZ 과제', 'ZZ');
  await untilLong(() => !!sp.tree[`${BASE}/ZZ`]?.['1차년도.json'] && !$('rdShareSync').disabled);
  const key = bookProject('ZZ').id;   // 이어지지 않은 과제의 열쇠는 장부 id
  assert.equal(spDoc('ZZ', '1차년도.json').project.prjNo, key);
  assert.equal(chips().length, 5);
  pickChip('ZZ');
  delCurrent();
  assert.equal(chips().length, 4);
  assert.ok(panel.share().del[key], '폴더를 아는 과제를 지우면 묘비가 남는다');
  await untilLong(() => (spDoc('ZZ', '1차년도.json').project.deletedAt || 0) > 0 && !$('rdShareSync').disabled);
  assert.equal(chips().length, 4, '지운 기기의 첫 맞춤에 빈 과제가 생기지 않는다');
  await syncNow();
  assert.equal(chips().length, 4, '다시 맞춰도 그대로');
  assert.ok(!panel.book().projects.some((p) => p.alias === 'ZZ' || p.name === 'ZZ' || p.name === key), '열쇠·별칭 이름의 빈 과제가 없다');
  assert.deepEqual(spFolders().filter((f) => f.startsWith('ZZ')), ['ZZ'], '"ZZ-<열쇠>" 같은 둘째 폴더도 없다');
  assert.ok(!logs.some((l) => l.text.includes(`공유에서 받음 — 다른 기기가 지웠다): ${key}`)), '지운 기기에서는 받아 지울 것이 없다');
  assert.match($('rdShareState').textContent, /· 과제 5개$/, '묘비는 퍼뜨리는 동안(90일) 대상에 든다');
  panel.share().del = {};   // 검사 뒷정리 — 묘비는 퍼졌다
});
await ta('다른 기기가 지운 과제(파일 project.deletedAt)를 받으면 지우고, 그 열쇠에 이어 둔 연구내용 기록의 연결을 끊어 다음 맞춤에 다시 만들지 않는다', async () => {
  await addProject('YY 과제', 'YY');
  await untilLong(() => !!sp.tree[`${BASE}/YY`]?.['1차년도.json'] && !$('rdShareSync').disabled);
  const key = bookProject('YY').id;
  // 이 열쇠에 이어 둔 연구내용 기록(다른 기기에서 받은 꼴 — prjNo 가 열쇠)
  store.researchPlans = { ...(store.researchPlans || {}), 'yy과제#1': { id: 'yy과제#1', name: 'YY 과제', code: '', n: 1, rev: 'r1', goals: ['목표'], prjNo: key, prjNm: 'YY 과제', linkBy: 'auto', src: 'x' } };
  const folder = `${BASE}/YY`;
  const d = JSON.parse(sp.tree[folder]['1차년도.json']);
  const later = Date.now();
  d.project.deletedAt = later;
  d.updatedAt = new Date(later).toISOString();
  d.updatedBy = '동료';
  sp.tree[folder]['1차년도.json'] = JSON.stringify(d, null, 2);
  await syncNow();
  assert.ok(!bookProject('YY'), '받아서 지웠다');
  assert.equal(chips().length, 4);
  const gone = () => logs.filter((l) => l.text === `R&D 과제 지움(공유에서 받음 — 다른 기기가 지웠다): ${key}`).length;
  assert.equal(gone(), 1);
  assert.ok(store.researchPlans['yy과제#1'] && store.researchPlans['yy과제#1'].prjNo === undefined, '그 열쇠에 이어 둔 기록은 연결만 끊고 남긴다');
  await syncNow();
  assert.equal(chips().length, 4, '다시 맞춰도 과제가 생기지 않는다');
  assert.equal(gone(), 1, '만들고 지우기를 되풀이하지 않는다');
  assert.deepEqual(spFolders().filter((f) => f.startsWith('YY')), ['YY']);
  assert.match($('rdShareState').textContent, /· 과제 4개$/, '받아 지운 과제는 더는 대상이 아니다');
});
await ta('공유 폴더 칸에 다른 밑폴더 주소를 넣으면 과제 → 폴더 캐시(shareIndex)를 버려 모든 과제가 새 자리에 맞춰진다(옛 자리에는 더 쓰지 않음) — 비우면 다시 내 OneDrive 의 폴더를 알아본다', async () => {
  const OTHER = '/personal/other/Documents/업무/shared';
  const n = sp.puts.length;
  commit($('rdShareFolder'), `${ORIGIN}${OTHER.split('/').map(encodeURIComponent).join('/')}`);
  // 칸을 고치면 캐시를 지운 뒤(await) 맞추기 시작 — 캐시가 새 자리로 다시 채워지고 맞추기가 끝날 때까지
  //   (캐시에는 밑폴더에서 알아본 폴더가 다 든다 — 내 OneDrive 로 돌아오면 지운 ZZ·YY 의 폴더도 — 그래서 장부의 네 과제(열쇠 = 장부 id)가 다 그 자리인지 본다)
  const under = (root) => { const v = Object.values(store.shareIndex || {}); return v.length >= 4 && v.every((e) => String(e.path || '').startsWith(`${root}/`)) && panel.book().projects.every((p) => store.shareIndex[p.id]); };
  await untilLong(() => under(OTHER) && !$('rdShareSync').disabled);
  assert.match($('rdShareState').textContent, /^맞춤 .* · 과제 4개$/);
  const idx = store.shareIndex;
  assert.equal(Object.keys(idx).length, 4);
  assert.ok(Object.values(idx).every((e) => e.path.startsWith(`${OTHER}/`)), `캐시는 새 자리의 폴더만 — ${JSON.stringify(Object.values(idx).map((e) => e.path))}`);
  assert.ok(sp.puts.length > n && sp.puts.slice(n).every((x) => x.startsWith(`${OTHER}/`)), '새 자리에 쓰고 옛 자리에는 더 쓰지 않는다');
  assert.equal(store.shareFolder?.path, OTHER, '밑폴더 캐시도 새 주소');
  assert.ok(logs.some((l) => /^R&D 공유 폴더: https:/.test(l.text)));
  const n2 = sp.puts.length;
  commit($('rdShareFolder'), '');
  await untilLong(() => under(BASE) && !$('rdShareSync').disabled);
  assert.ok(under(BASE), `내 OneDrive 의 과제 폴더를 다시 알아본다 — ${JSON.stringify(Object.values(store.shareIndex || {}).map((e) => e.path))}`);
  assert.equal(store.shareIndex[bookProject('파일 과제').id]?.folder, '파일 과제');
  assert.match($('rdShareState').textContent, /^맞춤 .* · 과제 4개$/);
  assert.equal(sp.puts.length, n2, '파일이 장부와 같아 다시 쓰지 않는다');
  pickChip('파일 과제');
});
await ta('rERP 확장(kr_ext_rerp)의 공유 폴더 설정을 따른다 — 칸이 비어 있으면 chrome.management 에서 이름으로 찾아 shareFolder 를 묻고 그 folder·driveHost 로 맞춘다(값이 바뀌면 캐시를 버림), 칸에 값이 있으면 그것이 이기고 다르면 알림, rERP 확장이 없으면 기본', async () => {
  const OTHER = '/personal/rerp/Documents/업무/shared';
  const OTHER_URL = `${ORIGIN}${OTHER.split('/').map(encodeURIComponent).join('/')}`;
  const asked = [];
  let peerFolder = OTHER_URL;
  chrome.management = { getAll: async () => [{ id: 'zzz', name: '다른 확장', type: 'extension', enabled: true }, { id: 'rerp-off', name: 'KR eClass + R&D ERP 현황', type: 'extension', enabled: false }, { id: 'rerp1', name: 'KR eClass + R&D ERP 현황', type: 'extension', enabled: true }] };
  chrome.runtime = { id: 'me', sendMessage: async (id, msg) => { asked.push(`${id}:${msg?.type}`); if (id !== 'rerp1') throw new Error('Could not establish connection. Receiving end does not exist.'); return { ok: true, enabled: true, folder: peerFolder, driveHost: ORIGIN, version: '0.8.7' }; } };
  const under = (root) => { const v = Object.values(store.shareIndex || {}); return v.length >= 4 && v.every((e) => String(e.path || '').startsWith(`${root}/`)) && panel.book().projects.every((p) => store.shareIndex[p.id]); };
  $('rdShareSync').click();
  await untilLong(() => under(OTHER) && !$('rdShareSync').disabled);
  assert.ok(asked.length >= 1 && asked.every((a) => a === 'rerp1:shareFolder'), `켜진 rERP 확장에만 묻는다 — ${asked.join(',')}`);
  assert.ok(under(OTHER), `rERP 확장의 폴더에 맞춘다 — ${JSON.stringify(Object.values(store.shareIndex || {}).map((e) => e.path))}`);
  assert.equal(store.shareFolder?.path, OTHER, '밑폴더 캐시도 그 자리');
  assert.equal($('rdShareFolder').value, '', '칸은 비어 있고');
  assert.equal($('rdShareFolder').placeholder, `rERP 확장의 설정을 따름 — ${OTHER_URL}`);
  assert.ok($('rdShareMsg').textContent.includes(`밑폴더 ${OTHER}`), `결과 줄에 밑폴더 — ${$('rdShareMsg').textContent}`);
  assert.ok(!/다릅니다/.test($('rdShareMsg').textContent));
  assert.ok(logs.some((l) => /^R&D 공유 폴더\(rERP 확장의 설정을 따름\): https:/.test(l.text)));
  assert.equal(store.rndShare?.peer?.folder, OTHER_URL, '기억(peer)은 저장소에');
  // rERP 확장이 기본(비움)으로 돌아가면 — 다시 내 OneDrive, 캐시는 새 자리로
  peerFolder = '';
  $('rdShareSync').click();
  await untilLong(() => under(BASE) && !$('rdShareSync').disabled);
  assert.ok(under(BASE), `rERP 확장이 비우면 내 OneDrive — ${JSON.stringify(Object.values(store.shareIndex || {}).map((e) => e.path))}`);
  assert.equal($('rdShareFolder').placeholder, 'rERP 확장의 설정을 따름 — 내 OneDrive 의 문서/업무/shared');
  // 칸에 값을 넣으면 그것이 이긴다 — rERP 확장의 것(OTHER)과 다르면 알림 한 줄
  peerFolder = OTHER_URL;
  const n = sp.puts.length;
  commit($('rdShareFolder'), `${ORIGIN}${BASE.split('/').map(encodeURIComponent).join('/')}`);
  await untilLong(() => !$('rdShareSync').disabled && /다릅니다/.test($('rdShareMsg').textContent));
  assert.ok(under(BASE), '칸의 자리에 맞춘다');
  assert.match($('rdShareMsg').textContent, /rERP 확장의 공유 폴더\(https:[^)]*\)와 다릅니다 — 같은 폴더를 쓰려면 칸을 비우세요/);
  assert.equal($('rdShareFolder').placeholder, '비우면 내 OneDrive 의 문서/업무/shared', '따르지 않을 때는 기본 문구');
  assert.ok(sp.puts.slice(n).every((x) => x.startsWith(`${BASE}/`)), 'rERP 확장의 자리에는 쓰지 않는다');
  // rERP 확장이 없으면(답 없음) — 기억을 지우고 기본값으로
  delete chrome.management;
  delete chrome.runtime;
  const n3 = logs.length;
  commit($('rdShareFolder'), '');
  await untilLong(() => logs.slice(n3).some((l) => /^R&D 공유 맞춤\(폴더\)/.test(l.text)) && !$('rdShareSync').disabled);   // 칸을 비운 뒤의 맞춤이 끝날 때까지(캐시는 이미 그 자리라 under 로는 못 기다린다)
  assert.ok(under(BASE));
  assert.equal($('rdShareFolder').placeholder, '비우면 내 OneDrive 의 문서/업무/shared');
  assert.deepEqual(store.rndShare?.peer, {}, 'rERP 확장이 안 닿으면 기억을 지운다');
  assert.ok(!/다릅니다/.test($('rdShareMsg').textContent));
  pickChip('파일 과제');
});
await ta('[링크 복사] — 보고 있는 과제 폴더의 조직 내 편집 링크를 만들어 복사한다', async () => {
  const n = copied.length;
  $('rdShareLink').click();
  await until(() => copied.length === n + 1);
  assert.match(copied[n], /^https:\/\/krclass-my\.sharepoint\.com\/:f:\/g\/personal\/me\/.*%ED%8C%8C%EC%9D%BC%20%EA%B3%BC%EC%A0%9C\?e=w$/, '파일 과제 폴더의 편집 링크');
  assert.match($('rdShareMsg').textContent, /^과제 폴더 파일 과제의 조직 내 편집 링크를 복사했습니다/);
  assert.ok(flashed.some(([id, text]) => id === 'rdShareLink' && text === '복사함'));
});
await ta('머리 줄의 링크 아이콘 — 같은 과제 폴더 링크를 복사하고 잠깐 체크(2026-10-19)', async () => {
  const n = copied.length, was = $('rdInfo').open;
  assert.match($('rdHeadLink').title, /과제 폴더 파일 과제의 조직 내 편집 링크$/);
  $('rdHeadLink').click();
  await until(() => copied.length === n + 1);
  assert.equal(copied[n], copied[n - 1], '공유 카드의 링크 복사와 같은 주소');
  assert.ok(copiedIcon('rdHeadLink'), '아이콘이 체크로');
  assert.equal($('rdInfo').open, was, '누름이 접기/펴기로 번지지 않는다');
  assert.match($('rdShareMsg').textContent, /^과제 폴더 파일 과제의 조직 내 편집 링크를 복사했습니다/);
  await until(() => !$('rdHeadLink').classList.contains('done'));
  assert.ok($('rdHeadLink').querySelector('svg path') && !$('rdHeadLink').classList.contains('done'), '링크 그림이 돌아온다');
});
await ta('머리 줄의 톱니 아이콘 — R&D 설정을 펴고, 손으로 편 것이라 과제를 옮겨도 접지 않는다(2026-10-19)', async () => {
  $('rdSetBox').open = false;
  const was = $('rdInfo').open;
  $('rdHeadSet').click();
  assert.ok($('rdSetBox').open, 'R&D 설정이 펴진다');
  assert.equal($('rdInfo').open, was, '누름이 접기/펴기로 번지지 않는다');
  pickChip('TEST');
  pickChip('파일 과제');
  assert.ok($('rdSetBox').open, '다른 과제로 가도 그대로');
  $('rdSetBox').open = false;
});
await ta('로그인이 풀리면(auth) "OneDrive 에 로그인하세요" 와 OneDrive 열기 — 장부는 그대로', async () => {
  sp.authList = true;
  $('rdShareSync').click();
  await until(() => $('rdShareState').textContent === 'OneDrive 에 로그인하세요');
  assert.match($('rdShareMsg').textContent, /^OneDrive 에 로그인하세요 — 이 브라우저에서 SharePoint\(OneDrive\)에 로그인한 뒤/);
  assert.ok($('rdShareMsg').classList.contains('error'));
  assert.equal($('rdShareOpen').textContent, 'OneDrive 열기');
  assert.ok($('rdShareOpen').dataset.url.startsWith('https://krclass-my.sharepoint.com'));
  assert.equal(chips().length, 4);
  assert.ok(logs.some((l) => l.kind === 'rnd' && !l.ok && /^R&D 공유 맞춤\(지금 동기화\): OneDrive 에 로그인하세요/.test(l.text)));
  sp.authList = false;
});
await ta('끄면 더는 닿지 않는다 — 과제 정보를 고쳐도', async () => {
  $('rdShareOn').checked = false;
  change($('rdShareOn'));
  assert.equal($('rdShareState').textContent, '꺼짐');
  assert.equal($('rdShareMsg').textContent, '');
  assert.ok($('rdShareSync').disabled);
  assert.equal($('rdSetState').textContent, 'rERP 켬 · 공유 꺼짐');
  // 머리 줄의 링크 아이콘은 꺼져 있으면 복사하지 않고 공유 카드(설정 › Plus — 2026-10-25)로 간다(2026-10-19)
  const c = copied.length, o = opened.length;
  $('rdHeadLink').click();
  assert.equal(copied.length, c, '꺼져 있으면 복사하지 않는다');
  assert.equal(opened.length, o + 1, '설정 › Plus 를 연다');
  assert.ok($('rdHeadLink').classList.contains('fail'), '× 표시');
  assert.match($('rdHeadLink').title, /꺼져 있습니다/);
  const n = sp.calls.length;
  pickChip('파일 과제');
  $('rdEdit').click();
  type($('rdFAlias'), '파일 과제');
  $('rdFSave').click();
  await wait(1500);
  assert.equal(sp.calls.length, n);
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
  assert.equal($('rdSetState').textContent, 'rERP 끔 · 공유 꺼짐');
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
await ta('공유를 켜면 이어진 과제는 rERP 과제번호를 열쇠로 파일을 쓴다(폴더 이름은 약칭, 과제명·책임자는 rERP 값) — kr_ext_rerp 가 적은 예상비용.json 은 받아 보기만: 표에 비목 → 비목 예상 반영 → 항목 줄, 저장소(plannedExpenses)에 과제번호로, 파일은 그대로', async () => {
  // rerp 확장(책임자)이 과제 폴더 TEST 에 적은 예상비용.json — 같은 모양(rerp/prjdoc.js kind 'plan'). 연차 파일은 아직 없다(폴더만 있으면 그 이름을 쓴다).
  myName = '홍길동';   // 이 과제(TEST)의 rERP 책임자 — 책임자여도 예상비용.json 은 쓰지 않는다(아래 검사). 이름은 파일 줄의 by·updatedBy 가 되니 맞추기 전에 바꾼다
  sp.reset();
  delete store.shareIndex;   // 트리를 비웠으니 이 기기의 폴더 캐시도 — 2026-10-25 정본은 전체 실패(위 auth) 뒤에도 색인을 남겨, 잇기 전 열쇠가 TEST 폴더를 쥔 채 남는다
  delete store.shareSkip;
  const folder = `${BASE}/TEST`;
  const planText = JSON.stringify({
    v: 2, kind: 'plan', project: { prjNo: PRJ, prjNm: 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발' },
    plan: { items: [{ id: 'a1', prj: PRJ, key: '10|연구활동비', name: '회의비', qty: 3, unit: 50000, amt: 150000, ts: 1000, by: '동료' }], del: {} },
    updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: '동료',
  }, null, 2);
  sp.tree[folder] = { '예상비용.json': planText };
  $('rdShareOn').checked = true;
  change($('rdShareOn'));
  await until(() => !!store.plannedExpenses?.[PRJ]);
  await until(() => /^맞춤 /.test($('rdShareState').textContent));
  const list = store.plannedExpenses[PRJ]['10|연구활동비'];
  assert.deepEqual([list.length, list[0].name, list[0].qty, list[0].unit, list[0].amt, list[0].by], [1, '회의비', 3, 50000, 150000, '동료']);
  assert.equal(sp.tree[folder]['예상비용.json'], planText, '예상비용.json 은 받기만 — 그대로');
  const y1 = spDoc('TEST', '1차년도.json');
  assert.deepEqual([y1.project.prjNo, y1.project.prjNm, y1.project.rspr, y1.project.alias], [PRJ, 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발', '홍길동', 'TEST'], '이어진 과제 — 열쇠·과제명·책임자는 rERP 값, 별칭은 장부');
  assert.equal(y1.budget.find((b) => b.name === '인건비')?.plan, 30000000, '계획서의 예산 계획');
  const snapDate = Date.parse(bookProject('TEST').years[1].snapshot?.date || '') || 0;
  assert.ok(snapDate > 0 && y1.budget.every((b) => b.at === snapDate), `처음 올리는 예산 줄의 시각은 계획서 스냅샷 날짜 — ${snapDate} / ${y1.budget.map((b) => b.at).join(',')}`);
  assert.deepEqual(y1.research.map((r) => [r.id, r.rev]), [['시험용직류차단기개발#1', 'r2']]);
  assert.match($('rdShareState').textContent, /· 과제 4개$/);
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
  assert.ok(tbl.querySelector('a.krext-ico-btn')?.href.startsWith('https://krclass-my.sharepoint.com/'), '열기(↗) 링크 — 예상비용.json');
});
await ta('이어지지 않은 채 공유하던 과제를 rERP 에 이으면 옛 폴더를 이어 쓴다(2026-10-19 검토) — 파일의 project.prjNo 가 과제번호로 바뀌고 색인·기억이 옮겨져 "<약칭>-<과제번호>" 폴더가 생기지 않는다', async () => {
  pickChip('파일 과제');
  const oldKey = bookProject('파일 과제').id;
  assert.equal(spDoc('파일 과제', '1차년도.json').project.prjNo, oldKey, '이어지지 않은 과제의 파일은 장부 id 열쇠');
  assert.equal(store.shareIndex[oldKey]?.folder, '파일 과제');
  // 과제번호·이름이 rERP 목록에 없어 고르기 목록이 선다(탭을 열 때 저절로, 또는 잇기 단추) → 다른 과제(RS-2025-00000009)를 고른다
  await until(() => !hidden('rdErpPick'));
  if (hidden('rdErpPick')) { $('rdErpLink').click(); await until(() => !hidden('rdErpPick')); }
  $('rdErpSelect').value = 'RS-2025-00000009';
  $('rdErpPickOk').click();
  await untilLong(() => spDoc('파일 과제', '1차년도.json').project.prjNo === 'RS-2025-00000009');
  await until(() => panel.erp()?.prjNo === 'RS-2025-00000009' && !$('rdErpRefresh').disabled);
  const y1 = spDoc('파일 과제', '1차년도.json');
  assert.deepEqual([y1.project.prjNm, y1.project.rspr, y1.project.wsId, y1.project.alias], ['다른 과제', '김아무', oldKey, '파일 과제'], '과제명·책임자는 rERP 값, 나머지는 그대로');
  assert.ok(store.shareIndex['RS-2025-00000009']?.folder === '파일 과제' && !store.shareIndex[oldKey], '색인은 새 열쇠로');
  assert.ok(panel.share().memo['RS-2025-00000009'] && !panel.share().memo[oldKey], '맞춘 기억도 새 열쇠로');
  assert.ok(logs.some((l) => /^R&D 공유 폴더 이어 쓰기: 파일 과제 \(.* → RS-2025-00000009, 파일 1개\)$/.test(l.text)));
  // 다음 맞춤 — 같은 폴더를 쓰고 새 폴더를 만들지 않는다
  await untilLong(() => !$('rdShareSync').disabled);
  const before = spFolders();
  await syncNow();
  assert.deepEqual(spFolders(), before, '"파일 과제-RS-2025-00000009" 폴더가 생기지 않는다');
  assert.match($('rdShareState').textContent, /^맞춤 .* · 과제 4개$/);
  assert.equal(store.shareIndex['RS-2025-00000009']?.folder, '파일 과제');
  pickChip('TEST');
});
await ta('공유 폴더에 있는데 장부에 없는 내 rERP 참여 과제는 저절로 장부에 더한다(2026-10-19 "sharepoint 의 변경사항을 반영하지 않네?") — rerp 가 적은 연차 파일의 과제명·책임자·별칭·예산 계획·변경이력을 받고 그 연차를 rERP 에 잇는다, 참여 과제가 아닌 폴더는 두고, 더한 뒤 이 장부의 id 를 파일에 올린다', async () => {
  const SOC = 'RS-2026-00000077', MMC = 'RS-2026-00000088';
  erpFake.recs.push({ PRJ_NO: SOC, ANL: '1', PRJ_NM: '선박용 SOC 시스템 개발', PRJ_RSPR_EMP_NM: '김아무', PROG_STS_NM: '진행', RCH_ST_DT: '20260101', RCH_END_DT: '20261231' });
  const later = Date.now() - 1000;
  // rerp 가 만든 연차 파일(rerp/prjdoc.js kind 'year') — WORKSPACE 몫 칸은 비어 있고 별칭·예산 줄·변경이력은 동료(rerp)가 적었다
  const yearFile = (prjNo, prjNm, alias) => JSON.stringify({
    v: 2, kind: 'year', project: { prjNo, prjNm, rspr: '김아무', alias, aliasAt: later, jobId: '', io: '', start: '', end: '', note: '' }, year: { n: 1, start: '2026-01', end: '2026-12' },
    budget: [{ name: '인건비', plan: 12340000, at: later, by: '동료' }, { name: '연구활동비', plan: 5000000, at: later, by: '동료' }], staff: { plans: {}, del: {} }, research: [],
    changes: [{ id: 'c-soc', date: '2026-10-19', kind: '예산', item: '인건비', before: '10,000', after: '12,340', reason: '동료가 적음', by: '동료', at: later, auto: false }],
    updatedAt: new Date(later).toISOString(), updatedBy: '동료',
  }, null, 2);
  sp.tree[`${BASE}/SOC`] = { '1차년도.json': yearFile(SOC, '선박용 SOC 시스템 개발', 'SOC') };
  sp.tree[`${BASE}/MMC`] = { '1차년도.json': yearFile(MMC, '참여하지 않는 과제', 'MMC') };
  const n0 = logs.length;
  await syncNow();   // 이번 맞춤이 밑폴더를 훑어 두 폴더를 알아내고 → 바로 한 번 더 돌아(더하기) SOC 를 장부에 만든다
  await untilLong(() => !!bookProject('SOC') && !$('rdShareSync').disabled);
  const p = bookProject('SOC');
  assert.ok(p, `더했다 — ${logs.slice(n0).map((l) => l.text).join(' / ')}`);
  assert.deepEqual([p.name, p.lead, p.alias, p.aliasAt, p.years[1]?.erp?.prjNo], ['선박용 SOC 시스템 개발', '김아무', 'SOC', later, SOC], '과제명·책임자는 rERP 값, 별칭은 파일, 1차년도는 rERP 에 이어 열쇠가 과제번호');
  assert.deepEqual(p.years[1].budget.filter((r) => r.plan != null).map((r) => [r.item, r.plan]), [['인건비', 12340000], ['연구활동비', 5000000]], '같은 파일에서 project 칸보다 먼저 온 예산 계획도 함께');
  assert.ok(p.years[1].changes.some((c) => c.id === 'c-soc' && c.by === '동료'), '변경이력도');
  assert.ok(!bookProject('MMC') && !panel.book().projects.some((q) => q.name === '참여하지 않는 과제'), '참여 과제가 아닌 폴더는 더하지 않는다');
  assert.equal(chips().length, 5);
  assert.ok(logs.slice(n0).some((l) => l.text === `R&D 과제 더함(공유 폴더에서 받음 — rERP 참여 과제): SOC (${SOC})`), logs.slice(n0).map((l) => l.text).join(' / '));
  assert.ok(logs.slice(n0).some((l) => /^R&D 공유 맞춤\(더하기\): 과제 5개 .* · 더함 1$/.test(l.text)), logs.slice(n0).map((l) => l.text).join(' / '));
  assert.match($('rdShareState').textContent, /· 과제 5개$/);
  await untilLong(() => spDoc('SOC', '1차년도.json').project.wsId === p.id && !$('rdShareSync').disabled);
  assert.equal(spDoc('SOC', '1차년도.json').project.wsId, p.id, '잠깐 뒤 한 번 더 돌아 이 장부의 id 를 파일에 올린다');
  assert.equal(spDoc('SOC', '1차년도.json').project.alias, 'SOC', '별칭은 그대로');
  assert.deepEqual(spFolders().filter((f) => f.startsWith('SOC')), ['SOC'], '둘째 폴더가 생기지 않는다');
  assert.ok(!('wsId' in spDoc('MMC', '1차년도.json').project), '더하지 않은 폴더는 건드리지 않는다');
  await syncNow();
  assert.equal(chips().length, 5, '다시 맞춰도 그대로');
  assert.ok(!/더함/.test($('rdShareMsg').textContent), '더한 것이 없는 맞춤에는 더함 표시가 없다');
  // 지우면(묘비 → 파일 project.deletedAt) 묘비가 지난 뒤 폴더만 남아 있어도 다시 더하지 않는다 — deletedAt 은 project 칸에 오므로 받아 둔 칸을 버린다
  pickChip('SOC');
  delCurrent();
  await untilLong(() => (spDoc('SOC', '1차년도.json').project.deletedAt || 0) > 0 && !$('rdShareSync').disabled);
  panel.share().del = {};
  const n1 = logs.length;
  await syncNow();
  await untilLong(() => !$('rdShareSync').disabled && logs.slice(n1).some((l) => /^R&D 공유 맞춤\(지금 동기화\)/.test(l.text)));
  assert.ok(!bookProject('SOC') && chips().length === 4, '지운 과제는 폴더가 남아 있어도 다시 더하지 않는다');
  assert.ok(!logs.slice(n1).some((l) => /과제 더함/.test(l.text)), logs.slice(n1).map((l) => l.text).join(' / '));
  // 뒷정리 — 폴더·색인·목록을 치운다
  delete sp.tree[`${BASE}/SOC`];
  delete sp.tree[`${BASE}/MMC`];
  delete store.shareIndex[SOC];
  delete store.shareIndex[MMC];
  erpFake.recs = erpFake.recs.filter((r) => r.PRJ_NO !== SOC);
  await syncNow();
  assert.equal(chips().length, 4);
  assert.match($('rdShareState').textContent, /· 과제 4개$/);
  pickChip('TEST');
});
await ta('R&D 탭이 보이는 동안 5분마다 저절로 맞춘다(2026-10-19 — rerp 의 자동 갱신 알람에 해당) — 마지막 성공 1분 안이면 건너뛰고, 쓰거나 받은 것이 없으면 활동 로그에 남기지 않으며, 탭을 숨기거나 공유를 끄면 멈춘다', async () => {
  assert.ok(panel.shareAuto(), '공유가 켜져 있고 탭이 보이면 주기 타이머가 돈다');
  const at0 = panel.share().at;
  const n = logs.length;
  await panel.shareTick();
  assert.equal(panel.share().at, at0, '1분 안이면 건너뛴다(sharesync 의 alarm 규칙)');
  // 마지막 성공을 2분 전으로 돌리면 돈다
  const old = Date.now() - 2 * 60 * 1000;
  store.shareState = { ...store.shareState, at: old };
  store.planSyncState = store.shareState;
  await panel.shareTick();
  assert.ok(panel.share().at > old, '돌았다');
  assert.match($('rdShareState').textContent, /^맞춤 .* · 과제 4개$/);
  assert.ok(!logs.slice(n).some((l) => /공유 맞춤\(주기\)/.test(l.text)), `달라진 것이 없으면 로그 없음 — ${logs.slice(n).map((l) => l.text).join(' / ')}`);
  panel.hide();
  assert.ok(!panel.shareAuto(), '탭을 숨기면 멈춘다');
  await panel.show();
  assert.ok(panel.shareAuto(), '다시 보이면 돈다');
  await untilLong(() => !$('rdShareSync').disabled);
  $('rdShareOn').checked = false;
  change($('rdShareOn'));
  assert.ok(!panel.shareAuto(), '공유를 끄면 멈춘다');
  $('rdShareOn').checked = true;
  change($('rdShareOn'));
  await untilLong(() => /^맞춤 /.test($('rdShareState').textContent) && !$('rdShareSync').disabled);
  assert.ok(panel.shareAuto(), '다시 켜면 돈다');
  pickChip('TEST');
});
await ta('예산 칸 위의 "집행에 더하기" — 사용계획을 켜면 그 비목의 예상 비용이, 미청구를 켜면 연구활동비 줄에 더해진다(2026-10-12 사용자 지정 — 보조 줄이 아니라 그 줄의 집행·잔액·막대·표 복사). 승인전 체크는 없다', async () => {
  const bars = (node) => [...node.querySelectorAll('.rd-bar')].map((b) => [b.className.replace('rd-bar ', ''), b.style.left, b.style.width]);
  assert.deepEqual(bars(row('연구활동비')), [['base', '0%', '49.28%']], '승인액 19,712,839 ÷ 계획 40,000,000 — 파랑 하나');
  $('rdIncPlan').checked = true;
  change($('rdIncPlan'));
  assert.equal(used('연구활동비').value, '19,863', '19,712,839 + 예상 150,000');
  assert.equal($('rdSetState').textContent, 'rERP 켬 · 공유 켬', '설정 줄에는 집행에 더할 것이 안 보인다 — 예산 칸 위에 있다');
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
  assert.deepEqual(store.rndSettings, { erp: true, unbilled: true, plan: true, hide: [], months: false }, '승인전(req)은 저장하지 않는다');
  // 기본값으로 돌려 둔다
  $('rdIncUnbilled').checked = false; change($('rdIncUnbilled'));
  $('rdIncPlan').checked = false; change($('rdIncPlan'));
  assert.equal(used('연구활동비').value, '19,713');
  assert.ok(!q('#rdBudget .rd-brow-extra'));
});
await ta('과제책임자가 내 이름이어도 예상비용.json 은 쓰지 않는다(받기만) — 지금 동기화에 쓸 것이 없으면 파일은 그대로', async () => {
  const before = store.planSyncState?.at;
  const n = sp.puts.length;
  $('rdShareSync').click();
  await until(() => store.planSyncState?.at !== before);
  await until(() => !$('rdShareSync').disabled);
  assert.equal(sp.puts.length, n, '쓴 것 없음 — 예상비용.json 도 연차 파일도');
  assert.ok(!sp.puts.some((x) => x.endsWith('예상비용.json')), '예상비용.json 은 한 번도 쓰지 않았다');
  assert.match($('rdShareState').textContent, /^맞춤 .* · 과제 4개$/);
  assert.ok(logs.some((l) => /R&D 공유 맞춤\(지금 동기화\): 과제 4개/.test(l.text)));
});
await ta('rerp(책임자)가 먼저 만든 연차 파일(WORKSPACE 몫 칸이 모두 빈 것)을 처음 받아도 Job Id·I/O·연구기간·비고·과제번호는 지워지지 않고, 잠깐 뒤 한 번 더 맞춰 파일로 간다(2026-10-19 검토)', async () => {
  // 공유를 잠깐 끄고(폴더가 먼저 생기지 않게) 과제 WW 를 더해 rERP 에 잇는다 — 열쇠가 rERP 과제번호가 되어 rerp 가 만든 파일을 만난다
  $('rdShareOn').checked = false;
  change($('rdShareOn'));
  const PRJ2 = 'RS-2026-00000002';
  erpFake.recs.push({ PRJ_NO: PRJ2, ANL: '1', PRJ_NM: 'WW 과제', PRJ_RSPR_EMP_NM: '홍길동', PROG_STS_NM: '진행', RCH_ST_DT: '20260401', RCH_END_DT: '20270331' });
  await addProject('WW 과제', 'WW', { rdFCode: PRJ2, rdFJob: 'RND00412026', rdFIo: '2145nr0999', rdFLead: '홍길동', rdFStart: '2026-04-01', rdFEnd: '2027-03-31', rdFNote: '장부의 비고' });
  $('rdErpLink').click();
  await until(() => panel.erp()?.prjNo === PRJ2 && !$('rdErpRefresh').disabled);
  const folder = `${BASE}/WW`;
  sp.tree[folder] = { '1차년도.json': JSON.stringify({
    v: 2, kind: 'year', project: { prjNo: PRJ2, prjNm: 'WW 과제', rspr: '홍길동', alias: '', aliasAt: 0, jobId: '', io: '', start: '', end: '', note: '' },
    year: { n: 1, start: '2026-04', end: '2027-03' }, budget: [], staff: { plans: [], del: {} }, research: [], changes: [], updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: '홍길동',
  }, null, 2) };
  const n = sp.puts.length;
  $('rdShareOn').checked = true;
  change($('rdShareOn'));
  await untilLong(() => /^맞춤 /.test($('rdShareState').textContent) && !$('rdShareSync').disabled);
  const p = bookProject('WW');
  assert.deepEqual([p.job, p.io, p.start, p.end, p.note, p.code], ['RND00412026', '2145NR0999', '2026-04-01', '2027-03-31', '장부의 비고', PRJ2], '장부의 WORKSPACE 몫 칸은 그대로');
  assert.deepEqual(years().length, 1, '연구기간이 남아 차년도 칩도 남는다');
  assert.ok(logs.some((l) => /^R&D 공유 처음 받기\(RS-2026-00000002\): 파일에 비어 있는 칸 5개는 장부 값을 두고 다음 맞춤에 올린다$/.test(l.text)), `jobId·io·start·end·note 다섯(code 는 rerp 파일에 없는 칸이라 그대로) — ${JSON.stringify(logs.slice(-6).map((l) => l.text))}`);
  await untilLong(() => spDoc('WW', '1차년도.json').project.jobId === 'RND00412026' && !$('rdShareSync').disabled);   // 잠깐 뒤(1.2초) 한 번 더 돌아 올린다
  const y1 = spDoc('WW', '1차년도.json');
  assert.deepEqual([y1.project.io, y1.project.start, y1.project.end, y1.project.note, y1.project.alias, y1.project.code, y1.project.prjNm, y1.project.rspr], ['2145NR0999', '2026-04-01', '2027-03-31', '장부의 비고', 'WW', PRJ2, 'WW 과제', '홍길동']);
  assert.ok(sp.puts.slice(n).every((x) => x === `${folder}/1차년도.json`), '쓴 것은 WW 의 연차 파일뿐');
  assert.match($('rdShareState').textContent, /· 과제 5개$/);
  assert.ok(logs.some((l) => /^R&D 공유 맞춤\(고침\): 과제 5개/.test(l.text)), '올린 맞춤은 "고침" 으로 돈다');
});
await ta('끄면 아이콘도 동기화도 없다', async () => {
  $('rdShareOn').checked = false;
  change($('rdShareOn'));
  assert.equal($('rdShareState').textContent, '꺼짐');
  assert.equal($('rdShareMsg').textContent, '');
  assert.ok(!$('rdErpTable').querySelector('[data-act="plan-export"]'));
  assert.ok($('rdShareSync').disabled);
});
t('(검사 뒷정리) WW 를 지운다 — 공유가 꺼져 있어 묘비는 남지 않는다. 그 뒤는 TEST 로', () => {
  pickChip('WW');
  delCurrent();
  assert.equal(chips().length, 4);
  assert.deepEqual(panel.share().del, {});
  // 폴더·색인·rERP 목록도 치운다 — 묘비 없이 지운 내 참여 과제의 폴더가 남아 있으면 공유를 다시 켤 때 저절로 장부에 더해진다(2026-10-19 — 설계: 공유 폴더가 기준)
  delete sp.tree[`${BASE}/WW`];
  delete store.shareIndex?.['RS-2026-00000002'];
  erpFake.recs = erpFake.recs.filter((r) => r.PRJ_NO !== 'RS-2026-00000002');
  pickChip('TEST');
  assert.equal(panel.erp()?.prjNo, PRJ);
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

console.log('연구내용 기록(2026-10-14 → 2026-10-18 연차 파일로) — YAML 로 넣은 연구개발계획서는 rerp 와 같은 기록으로 남고, 공유가 켜져 있으면 과제 폴더의 연차 파일 research 칸으로 간다(위 공유 검사)');
await ta('YAML 을 넣을 때 rerp 와 같은 기록(researchPlans — 과제명#차년도)으로도 남는다 — 오래된 판은 건너뛴다. 원노트에 올리는 단추·링크 복사는 없다', async () => {
  const rec = store.researchPlans?.['시험용직류차단기개발#1'];
  assert.ok(rec, Object.keys(store.researchPlans || {}).join());
  assert.equal(rec.rev, 'r2', 'r2 뒤에 넣은 r0 는 기록도 건너뛰었다');
  assert.equal(rec.code, 'RS-2026-00000001');
  assert.ok(rec.goals.length > 0 && rec.contents.length > 0);
  for (const id of ['rdResShare', 'rdResCopy', 'rdResOpen', 'rdResMsg']) assert.equal($(id), null, `${id} 는 없다`);
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
  // 로그인이 풀려 못 받으면 까닭과 eclass 로그인 링크(e-accounting 은 eclass 를 거쳐 들어간다).
  acctFake.fail = '로그인이 필요합니다. e-accounting 에 로그인한 뒤 다시 조회하세요.';
  acctFake.login = true;
  $('rdIoRetry').click();
  await until(() => !hidden('rdIoLogin'));
  assert.match($('rdIoMsg').textContent, /회계 과제 목록을 받지 못했습니다 — 로그인이 필요합니다/);
  assert.match(metaText(), /회계 I\/O 없음 — e-accounting 로그인이 필요합니다/);
  assert.equal($('rdIoLogin').getAttribute('href'), 'https://eclass.krs.co.kr/eClassVer4/Home/Index', 'e-accounting 은 eclass 를 거쳐 들어간다(2026-10-29)');
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
const chipOf = (name) => [...$('rdProjects').querySelectorAll('[data-proj]')].find((b) => b.textContent === name);
await ta('새 과제 폼을 연 채 보고 있던 과제의 칩을 누르면 폼이 닫히고 그 과제가 선다 — 폼 동안 과제 칩은 모두 꺼진다(칩 줄의 ＋ 는 2026-10-19 에 없앰 — 대상은 더하기 카드의 배지에서)', async () => {
  assert.equal(chips().at(-1)[0], 'TEST');
  assert.equal(chips().at(-1)[1], true);
  assert.equal(q('#rdProjects [data-add]'), null, '＋ 칩이 없다');
  assert.equal($('rdProjects').querySelectorAll('button').length, chips().length, '칩 줄은 과제 칩뿐');
  panel.addManually();   // 더하기 카드의 직접 적기 — 새 과제 폼
  assert.ok(!hidden('rdForm'));
  assert.equal($('rdFormTitle').textContent, '새 과제');
  assert.deepEqual(chips().filter((c) => c[1]), [], '폼 동안 켜진 과제 칩이 없다');
  chipOf('TEST').click();   // 보고 있던 TEST — 전에는 아무 일도 없었다
  assert.ok(hidden('rdForm'));
  assert.ok(!hidden('rdHead'));
  assert.ok(!hidden('rdBody'));
  assert.equal(chips().at(-1)[1], true);
  // 고치기 폼은 고치는 과제의 칩이 켜진 채다(2026-10-16 사용자 지정 "어떤 과제인지 선택이 안되잖아") — 그 칩을 누르면 닫힌다.
  $('rdEdit').click();
  assert.ok(!hidden('rdForm'));
  assert.deepEqual(chips().filter((c) => c[1]).map((c) => c[0]), ['TEST'], '고치는 과제의 칩이 켜져 있다');
  assert.equal(chipOf('TEST').getAttribute('aria-pressed'), 'true');
  chipOf('TEST').click();
  assert.ok(hidden('rdForm'));
  assert.equal(chips().at(-1)[1], true);
  assert.equal(panel.book().projects.length, 4, '폼을 닫았을 뿐 과제는 그대로');
});

const seenViews = [];
const adds = [];
const intakes = [];
const deletes = [];
await ta('훅을 달면 머리 줄의 차년도 아이콘·과제 없음 카드의 과제 더하기는 더하기 카드(onAdd)로 — 덮개(setOverlay add) 동안 머리·몸통이 숨고 과제 칩은 모두 꺼지며, 다른 칩을 누르면 덮개를 닫고 그리 간다', async () => {
  panel.onView((v) => seenViews.push(v));
  panel.onAdd((target) => adds.push(target));
  panel.onIntake((result, texts, meta) => intakes.push({ result, texts, meta }));
  panel.onDelete((id) => deletes.push(id));
  const test = projId('TEST');
  assert.deepEqual(panel.current(), { project: panel.book().projects.find((x) => x.id === test), n: 1 });
  const v = panel.view();
  assert.deepEqual([v.project.id, v.n, v.editing, v.overlay, v.yearEmpty], [test, 1, false, null, false]);
  assert.equal(v.snapshot.rev, 'r2');
  $('rdHeadYear').click();
  assert.deepEqual(adds, [{ projectId: test }], '머리 줄의 차년도 아이콘 — 보던 과제가 대상');
  assert.ok(hidden('rdForm'), '훅이 있으면 폼을 열지 않는다');
  $('rdEmptyAdd').click();
  assert.deepEqual(adds, [{ projectId: test }, {}]);
  // 덮개 — rndgen 의 openAdd 가 부르는 것
  let closed = 0;
  panel.setOverlay('add', () => { closed++; });
  assert.ok(hidden('rdHead') && hidden('rdBody') && hidden('rdYearEmpty'));
  assert.ok(hidden('rdEmpty'));
  assert.deepEqual(chips().filter((c) => c[1]), [], '덮개 동안 켜진 과제 칩이 없다');
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
  assert.deepEqual(chips().filter((c) => c[1]), [], '새 과제 폼 동안 켜진 과제 칩이 없다');
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
  // 머리 줄의 차년도 아이콘(2026-10-19) — 이 과제만 대상(차년도는 더하기 카드의 단추 줄에서), summary 안이라 접기/펴기로 번지지 않는다
  const wasOpen = $('rdInfo').open;
  $('rdHeadYear').click();
  assert.deepEqual(adds.at(-1), { projectId: mvdc });
  assert.equal($('rdInfo').open, wasOpen, '과제 정보가 접히거나 펴지지 않는다');
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

console.log('참여인력 — rERP 근거 표시(2026-10-18 사용자 지정: "참여연구원 계산하는거 관련해서는 kr_ext_rerp 로 넘기고, 거기는 참여연구원 참여율/지급액 관리만 rerp 근거로 표시")');
const P7_FULL = [
  { EMP_NM: '홍길동', ROLE_NM: '과제책임자', PAY_LIMT_AMT: '8480000', PAY_AMT: '2328000', PART_RT: '27.46', PLAN_YM_FROM: '202604', PLAN_YM_TO: '202611', NCNT: '8', REQ_CNT: '3', SEQ_NO: '1', PARTRATE_YN: 'N', SSN: 'secret' },
  { EMP_NM: '홍길동', ROLE_NM: '과제책임자', PAY_LIMT_AMT: '8480000', PAY_AMT: '0', PART_RT: '0', PLAN_YM_FROM: '202612', PLAN_YM_TO: '202612', NCNT: '1', REQ_CNT: '3', SEQ_NO: '1', PARTRATE_YN: 'Y' },
  { EMP_NM: '성춘향', ROLE_NM: '참여연구원', PAY_LIMT_AMT: '5823000', PAY_AMT: '1165000', PART_RT: '20.01', PLAN_YM_FROM: '202604', PLAN_YM_TO: '202611', NCNT: '8', REQ_CNT: '3', SEQ_NO: '2', PARTRATE_YN: 'N' },
  { EMP_NM: '성춘향', ROLE_NM: '참여연구원', PAY_LIMT_AMT: '5823000', PAY_AMT: '1159000', PART_RT: '19.91', PLAN_YM_FROM: '202612', PLAN_YM_TO: '202612', NCNT: '1', REQ_CNT: '3', SEQ_NO: '2', PARTRATE_YN: 'N' },
];
await ta('이어지지 않은 차년도 — 계획서의 참여연구자 표 그대로, ↻ 없음, 안내 한 줄(사업비 변경 메뉴). refreshStaff 는 아무것도 안 한다', async () => {
  [...$('rdProjects').querySelectorAll('[data-proj]')].find((b) => b.textContent === 'TEST').click();
  $('rdYears').querySelector('[data-year="1"]').click();
  await wait(50);
  assert.equal(panel.erp(), null, 'rERP 검사에서 끊어 둔 그대로');
  assert.deepEqual([...$('rdRoster').querySelectorAll('.rd-table th')].map((th) => th.textContent), ['성명', '직위', '계상률', '참여', '계상인건비']);
  assert.equal(rosterTable($('rdRoster')).length, 2);
  assert.deepEqual([$('rdRosterState').textContent, $('rdRosterSrc').textContent], ['연구자 2명', '연구개발계획서 r2 기준']);
  assert.ok(hidden('rdStaffRefresh') && !hidden('rdRosterCopy') && hidden('rdStaffMsg'));
  assert.match($('rdRoster').querySelector('.rd-hint').textContent, /^rERP 에 이어지지 않은 차년도라 계획서의 참여연구자를 보이기만 합니다.*사업비 변경 메뉴에서 합니다\.$/);
  assert.equal($('rdRoster').querySelector('.rd-hint b').textContent, '사업비 변경');
  assert.equal(panel.staff(), null);
  const n = erpFake.calls.length;
  assert.equal(await panel.refreshStaff({ force: true, reason: '검사' }), false);
  assert.equal(erpFake.calls.length, n);
});
await ta('이어진 차년도 — rERP 참여인력(지급기간을 달마다 펼친 월별 지급·지급한도액)을 받아 읽기만 하는 표로: 성명·역할·월급여·참여·지급 합·참여율(아래 월 최대), 달마다의 지급 줄, 100% 초과 알림', async () => {
  const p = panel.book().projects.find((x) => x.alias === 'TEST');
  // 1차년도를 rERP 과제 P7 에 이은 것처럼(잇기 자체는 rERP 집행내역 검사) — 참여인력·다른 과제 참여율은 흉내 rERP 가 답한다. 주민번호 칸은 버려야 한다.
  p.years[1].erp = { prjNo: 'P7', anl: 1, prjNm: 'TEST', rspr: '', stDt: '', endDt: '', auto: false, linkedAt: 1, snap: null };
  erpFake.participants.P7 = P7_FULL;
  erpFake.others['P7:2'] = [{ PLAN_YM: '202604', ETC_PART_RT: '95.00', ETC_PAY_AMT: '0', SSN: 'secret' }, { PLAN_YM: '202605', ETC_PART_RT: '10.00', ETC_PAY_AMT: '0' }];
  const n = erpFake.calls.length;
  const run = panel.refreshStaff({ force: true, reason: '검사' });
  assert.ok(panel.staffRun() === run && $('rdStaffRefresh').disabled, '도는 동안 ↻ 는 잠긴다');
  assert.equal($('rdStaffMsg').textContent, 'rERP P7 참여인력을 받는 중…');
  assert.equal(await run, true);
  assert.deepEqual(erpFake.calls.slice(n), ['rtask_0008_t03_01_r001:P7', 'rtask_0013_12_r003:P7', 'rtask_0013_12_r003:P7'], '참여인력 한 번, 다른 과제 참여율은 사람마다');
  assert.deepEqual([...$('rdRoster').querySelectorAll('.rd-table th')].map((th) => th.textContent), ['성명', '역할', '월급여', '참여', '지급 합', '참여율']);
  assert.deepEqual(staffRows(), [['홍길동', '과제책임자', '8,480', '4~11월 (8개월)', '18,624', '27.46%'], ['성춘향', '참여연구원', '5,823', '4~12월 (9개월)', '10,479', '20.00%']]);
  assert.deepEqual([...$('rdRoster').querySelectorAll('.rd-td-max')].map((e) => e.textContent), ['월 최대 27.46%', '월 최대 20.01%'], '연간 아래에 월 최대가 늘 선다(같아도)');
  assert.deepEqual(staffMonths('성춘향'), ['1,165(최대)', ...Array(7).fill('1,165'), '1,159'], '지급기간을 달마다 — 월 최대인 달은 표시(연간과 다를 때)');
  assert.deepEqual(staffMonths('홍길동'), [...Array(8).fill('2,328'), '—(없음)'], '0원 달은 — 로 남는다');
  assert.deepEqual(staffWarns(), [['warn', '성춘향 — 4월 참여율 합 115.01% (이 과제 20.01% · rERP 다른 과제 95.00%)']], '100% 초과만 알린다(막지 않는다)');
  assert.equal($('rdRosterState').textContent, '연구자 2명 · 100% 초과 1');
  assert.match($('rdRosterSrc').textContent, /^rERP P7 · \d\d\.\d\d \d\d:\d\d 조회$/);
  assert.ok(!hidden('rdStaffRefresh') && !$('rdStaffRefresh').disabled && hidden('rdStaffMsg') && !hidden('rdRosterCopy'));
  assert.equal($('rdRoster').querySelector('input, button, select'), null, '읽기만 — 적는 칸·단추가 없다');
  assert.ok(!$('rdRoster').querySelector('.rd-hint'), '안내는 없다');
  const staff = panel.staff();
  assert.deepEqual([staff.basis, staff.src, staff.people.length, staff.people[1].erp.others.length, typeof staff.at], ['rerp', 'erp', 2, 2, 'number']);
  assert.ok(!JSON.stringify(panel.book()).includes('secret'), '주민번호 같은 것은 장부에 남지 않는다');
  const saved = () => store.rndBook?.projects.find((x) => x.alias === 'TEST')?.years[1]?.erp?.staff;
  await until(() => saved());
  assert.equal(saved().people.length, 2, '잇기와 함께 저장소에 남는다');
  assert.ok(logs.some((l) => l.kind === 'rnd' && l.ok && /R&D 참여인력 받음\(검사\): P7 · 2명 · 다른 과제 참여율 2명/.test(l.text)));
});
await ta('M — 머리 줄의 M 을 누르면 사람 아래 달마다의 지급 줄이 펴지고 다시 누르면 접힌다(기본 접힘 — 줄은 표에 남고 보이지만 않는다, 누른 상태는 rndSettings.months 에 — 2026-10-19 사용자 지정)', async () => {
  const m = $('rdStaffMonths');
  assert.ok(!hidden('rdStaffMonths'), 'rERP 참여인력(달마다의 지급 줄)이 있으니 M 이 선다');
  assert.ok(m.getAttribute('aria-pressed') === 'false' && !m.classList.contains('on') && !$('rdRoster').classList.contains('rd-months'), '기본은 접힘');
  assert.equal($('rdRoster').querySelectorAll('.rd-staff-months').length, 2, '달마다의 지급 줄은 표에 남아 있다(복사·검사는 그대로)');
  m.click();
  assert.ok(m.getAttribute('aria-pressed') === 'true' && m.classList.contains('on') && $('rdRoster').classList.contains('rd-months'), '누르면 펴진다');
  await until(() => store.rndSettings?.months === true);
  assert.equal(store.rndSettings.months, true, '펼친 상태는 설정에 남는다');
  assert.equal(staffMonths('성춘향').length, 9, '펴도 줄은 같다');
  m.click();
  assert.ok(m.getAttribute('aria-pressed') === 'false' && !m.classList.contains('on') && !$('rdRoster').classList.contains('rd-months'), '다시 누르면 접힌다');
  await until(() => store.rndSettings?.months === false);
  assert.equal(store.rndSettings.months, false);
});
await ta('복사 — 표 복사는 월급여·참여기간·지급 합·참여율·월 최대·월별 지급까지(rerp/staff.js staffTsv), 요약 복사에는 rERP 과제번호·조회 시각 머리 줄과 사람마다 한 줄', async () => {
  const n = copied.length;
  $('rdRosterCopy').click();
  await until(() => copied.length === n + 1);
  // 0.8.7 staffTsv(2026-10-19 다시 옮김)는 기간 구간마다 한 줄 — 12월을 제외한 홍길동은 4~11월 줄과 12월 제외 줄
  assert.equal(copied[n], ['성명\t직위\t월급여(천원)\t참여기간\t개월\t계상인건비(천원)\t참여율\t월 최대\t월별 지급(천원)', '홍길동\t과제책임자\t8,480\t4~11월\t8\t18,624\t27.46%\t27.46%\t4~11월 2,328 · 12월 제외', '홍길동\t과제책임자\t8,480\t12월\t1\t0\t제외\t\t', '성춘향\t참여연구원\t5,823\t4~12월\t9\t10,479\t20.00%\t20.01%\t4~11월 1,165 · 12월 1,159'].join('\n'));
  $('rdCopy').click();
  await until(() => copied.length === n + 2);
  assert.match(copied[n + 1], /\n■ 참여연구자 \(2명\) — rERP P7 참여인력 · 조회 \d\d\.\d\d \d\d:\d\d\n- 홍길동 — 과제책임자 · 월급여 8,480천원\(rERP\) · 4~11월 \(8개월\) · 계상인건비 18,624천원 · 참여율 27\.46% \(월 최대 27\.46%\) · 구간 4~11월 18,624천원 27\.46% · 12월 제외 · 월별 4~11월 2,328 · 12월 제외\n- 성춘향 — 참여연구원 · 월급여 5,823천원\(rERP\)/);
  assert.doesNotMatch(copied[n + 1], /월급여 기준|홍길동 — 수석 · 27\.45%/, '월급여 기준·예산 줄은 없고 계획서 글도 아니다');
});
await ta('↻ — 다시 받는다(로그인이 풀렸으면 SSO 한 번). 지급계획이 없으면 받아 둔 것을 지우고 계획서 표와 안내로, 다시 생기면 돌아온다. eClass 도 풀렸으면 까닭을 말하고 받아 둔 것은 그대로', async () => {
  const n = erpFake.calls.length;
  erpFake.loggedIn = false;
  erpFake.participants.P7 = [];
  $('rdStaffRefresh').click();
  await until(() => !panel.staffRun());
  assert.deepEqual(erpFake.calls.slice(n), ['rtask_0008_t03_01_r001:P7', 'sso', 'rtask_0008_t03_01_r001:P7']);
  assert.equal(panel.staff(), null);
  assert.deepEqual([...$('rdRoster').querySelectorAll('.rd-table th')].map((th) => th.textContent), ['성명', '직위', '계상률', '참여', '계상인건비'], '계획서 표로');
  assert.match($('rdRoster').querySelector('.rd-hint').textContent, /^rERP P7 참여인력에 지급계획이 없습니다 — 참여율·지급액의 계획과 변경은 .*사업비 변경 메뉴에서 합니다\.$/);
  assert.deepEqual([$('rdRosterState').textContent, $('rdRosterSrc').textContent], ['연구자 2명', '연구개발계획서 r2 기준']);
  assert.ok(!hidden('rdStaffRefresh') && hidden('rdStaffMsg'), '이어져 있으니 ↻ 는 남는다');
  assert.ok(hidden('rdStaffMonths'), '달마다의 지급 줄이 없으니 M 은 숨는다');
  const saved = () => store.rndBook?.projects.find((x) => x.alias === 'TEST')?.years[1]?.erp;
  await until(() => saved() && !saved().staff);
  assert.deepEqual([saved().prjNo, saved().staff], ['P7', undefined], '저장소에서도 지워진다');
  erpFake.participants.P7 = P7_FULL.slice(0, 1);
  $('rdStaffRefresh').click();
  await until(() => !panel.staffRun());
  assert.deepEqual(staffRows(), [['홍길동', '과제책임자', '8,480', '4~11월 (8개월)', '18,624', '27.46%']]);
  assert.equal($('rdRosterState').textContent, '연구자 1명');
  assert.ok(!hidden('rdStaffMonths'), 'M 도 돌아온다');
  erpFake.loggedIn = false;
  erpFake.eclassDown = true;
  $('rdStaffRefresh').click();
  await until(() => !panel.staffRun());
  assert.equal($('rdStaffMsg').textContent, '로그인이 필요합니다. eclass 에 로그인한 뒤 ↻ 를 누르세요.');
  assert.ok($('rdStaffMsg').classList.contains('error') && !hidden('rdStaffMsg'));
  assert.equal(staffRows().length, 1, '받아 둔 것은 그대로 보인다');
  assert.ok(logs.some((l) => l.kind === 'rnd' && !l.ok && /R&D 참여인력 실패\(↻\)/.test(l.text)));
  erpFake.loggedIn = true;
  erpFake.eclassDown = false;
  erpFake.participants.P7 = P7_FULL;
});
await ta('저절로 받기 — 막 받았으면 건너뛰고(10분), 오래됐으면 이 세션에서 한 번. 다른 과제로 가면 알림 줄은 걷히고 이어지지 않은 과제는 계획서 표·안내뿐', async () => {
  const n = erpFake.calls.length;
  assert.equal(await panel.refreshStaff({ reason: '열 때' }), false, '막 받았으면 건너뛴다');
  assert.equal(erpFake.calls.length, n);
  panel.staff().at = Date.now() - 11 * 60 * 1000;
  assert.equal(await panel.refreshStaff({ reason: '열 때' }), true);
  assert.deepEqual(erpFake.calls.slice(n), ['rtask_0008_t03_01_r001:P7', 'rtask_0013_12_r003:P7', 'rtask_0013_12_r003:P7']);
  assert.ok(hidden('rdStaffMsg'), '받으면 알림 줄은 걷힌다');
  assert.equal(staffRows().length, 2);
  [...$('rdProjects').querySelectorAll('[data-proj]')].find((b) => b.textContent === '차단기 과제').click();
  await wait(20);
  assert.ok(hidden('rdStaffRefresh') && hidden('rdStaffMsg') && hidden('rdRosterTools'));
  assert.equal($('rdRosterState').textContent, '계획서 없음');
  assert.match($('rdRoster').textContent, /맨 아래 칸에 연구개발계획서 YAML[\s\S]*rERP 에 이어지지 않은 차년도/);
  [...$('rdProjects').querySelectorAll('[data-proj]')].find((b) => b.textContent === 'TEST').click();
  await wait(20);
  assert.equal(staffRows().length, 2);
  assert.equal($('rdRosterState').textContent, '연구자 2명 · 100% 초과 1');
});

console.log('참여인력 공유 권한(2026-10-19 사용자 지정: "sharepoint 링크 읽기, 쓰기 권한 설정 … 아이콘에 공유아이콘 추가 … 그거 누르고.. 체크하면 반영")');
/** 권한 표의 줄 → [성명, 읽기 체크, 편집 체크, 잠김, 상태 글, extra]. */
const permDom = () => [...$('rdStaffPermBody').querySelectorAll('tr[data-perm]')].map((tr) => {
  const read = tr.querySelector('[data-role="read"]'), edit = tr.querySelector('[data-role="edit"]');
  return [tr.dataset.perm, read.checked, edit.checked, read.disabled && edit.disabled, tr.querySelector('.rd-td-state').textContent, tr.classList.contains('extra')];
});
const permBox = (name, role) => $('rdStaffPermBody').querySelector(`tr[data-perm="${name}"] [data-role="${role}"]`);
const tick = async (name, role, on) => { const box = permBox(name, role); box.checked = on; change(box); await until(() => panel.perm().row === ''); };
const permCalls = (n) => sp.calls.slice(n).filter((c) => /^(perms|find|open|share|unshare|close):/.test(c));
let permPath = '', permFolder = '';
await ta('공유가 꺼져 있으면 — 아이콘은 보이고, 누르면 칸이 펴지며 공유 카드로 안내(설정 › Plus 를 엶). 다시 누르면 접힌다', async () => {
  assert.ok(!hidden('rdStaffShare') && hidden('rdStaffPerm') && !$('rdShareOn').checked, 'TEST 1차년도 — 공유는 꺼진 채');
  const n = sp.calls.length;
  $('rdStaffShare').click();
  await wait(20);
  assert.ok(!hidden('rdStaffPerm') && $('rdStaffShare').classList.contains('on') && $('rdStaffShare').getAttribute('aria-pressed') === 'true');
  assert.equal($('rdStaffPermMsg').textContent, '공유 (SharePoint)가 꺼져 있습니다 — 설정 › Plus 에서 켜고 맞춘 뒤 다시 누르세요.');
  assert.ok($('rdStaffPermMsg').classList.contains('error') && opened.at(-1) === 'plus', '공유 카드(설정 › Plus)로');
  assert.equal($('rdStaffPermBody').innerHTML, '');
  assert.equal(sp.calls.length, n, '저장소에 닿지 않는다');
  $('rdStaffShare').click();
  assert.ok(hidden('rdStaffPerm') && !$('rdStaffShare').classList.contains('on') && hidden('rdStaffPermMsg'));
});
await ta('켜고 맞춘 뒤 누르면 — 과제 폴더(shareIndex)의 권한을 읽고 이메일을 모르는 이름을 찾는다: 참여연구자(rERP 참여인력)·행정지원(나는 빼고) 줄에 이메일로 맞춘 역할이 체크로, 못 찾은 사람은 잠긴 채 까닭, 폴더에만 있는 사람은 뒤에 연하게. 찾은 이메일은 저장소(rndSharePeople)에 남는다', async () => {
  $('rdShareOn').checked = true;
  change($('rdShareOn'));
  await untilLong(() => /^맞춤 /.test($('rdShareState').textContent) && store.shareIndex?.P7?.folder);
  const ent = store.shareIndex.P7;
  permFolder = ent.folder;   // rERP P7 에 이어진 TEST 의 폴더(별칭 — 옛 열쇠의 TEST 폴더가 남아 있으면 'TEST-P7')
  assert.match(permFolder, /^TEST/);
  permPath = ent.path;
  assert.ok(permPath && permPath in sp.tree, `폴더 ${permPath}`);
  const p = bookProject('TEST');
  p.support = [{ name: '새사람', role: '행정', ref: true }, { name: '없는사람', role: '', ref: false }, { name: '박기도', role: '', ref: false }];
  sp.people['홍길동'] = { email: 'hong@krs.co.kr', title: 'HONG Gildong' };
  sp.people['성춘향'] = { email: 'sung@krs.co.kr', title: 'SUNG Chunhyang' };
  sp.titles['hong@krs.co.kr'] = 'HONG Gildong'; sp.titles['sung@krs.co.kr'] = 'SUNG Chunhyang';
  sp.ambiguous['새사람'] = ['NEW A <a@krs.co.kr>', 'NEW B <b@krs.co.kr>'];
  sp.perms[permPath] = [{ id: 11, name: 'HONG Gildong', email: 'hong@krs.co.kr', role: 'edit' }, { id: 12, name: 'LEE Jaehoon', email: 'jhlee@krs.co.kr', role: 'read' }, { id: 3, name: 'PARK Kido', email: 'park@krs.co.kr', role: 'edit' }];
  sp.links = [{ id: 99, name: 'SharingLinks.x.OrganizationEdit.y', role: 'edit' }];
  const n = sp.calls.length;
  $('rdStaffShare').click();
  await until(() => !panel.perm().busy && panel.perm().perms);
  assert.deepEqual(permCalls(n), [`perms:${permPath}`, 'find:홍길동,성춘향,새사람,없는사람'], '권한 한 번, 이메일을 모르는 이름(나는 빼고)만 찾는다');
  assert.equal($('rdStaffPermFolder').textContent, `${permFolder} 폴더 · 조직 내 링크 편집`);
  assert.deepEqual(permDom(), [
    ['홍길동', false, true, false, '', false],
    ['성춘향', false, false, false, '', false],
    ['새사람', false, false, true, '이름 겹침 — NEW A <a@krs.co.kr> · NEW B <b@krs.co.kr>', false],
    ['없는사람', false, false, true, '사람을 찾지 못했습니다 — OneDrive 에서 직접 공유하세요', false],
    ['LEE Jaehoon', true, false, false, '', true],
  ], '박기도(나)는 없고, 폴더의 나(park@krs.co.kr)도 오지 않는다');
  assert.equal($('rdStaffPermBody').querySelector('tr[data-perm="홍길동"] small').textContent, 'HONG Gildong <hong@krs.co.kr>', '표시 이름(영문)과 이메일');
  assert.equal($('rdStaffPermBody').querySelector('tr[data-perm="LEE Jaehoon"] small').textContent, '<jhlee@krs.co.kr>');
  assert.ok(hidden('rdStaffPermMsg') && !$('rdStaffPermRefresh').disabled);
  await until(() => store.rndSharePeople?.['성춘향']);
  assert.deepEqual([store.rndSharePeople['홍길동'].email, store.rndSharePeople['성춘향'].title, Object.keys(store.rndSharePeople).sort()], ['hong@krs.co.kr', 'SUNG Chunhyang', ['성춘향', '홍길동']], '찾은 사람만 저장(겹침·못 찾음은 이 세션에만)');
  assert.deepEqual(panel.permPeople()['홍길동'].email, 'hong@krs.co.kr');
});
await ta('체크하면 바로 반영 — 읽기를 켜면 이메일로 읽기 공유, 편집을 켜면 거둔 뒤 편집 공유, 끄면 거두기. 끝나면 권한을 다시 읽어 실제 상태로(둘 중 하나만 켜짐). 활동 로그 한 줄씩', async () => {
  let n = sp.calls.length;
  await tick('성춘향', 'read', true);
  assert.deepEqual(permCalls(n), [`open:${ORIGIN}/personal/me`, `share:${permPath}:sung@krs.co.kr:read`, `close:${permPath}`, `perms:${permPath}`], '역할이 없던 사람 — 거둘 것 없이 읽기로');
  assert.deepEqual(permDom()[1], ['성춘향', true, false, false, '', false]);
  assert.equal($('rdStaffPermBody').querySelector('tr[data-perm="성춘향"] small').textContent, 'SUNG Chunhyang <sung@krs.co.kr>');
  assert.ok(logs.some((l) => l.kind === 'rnd' && l.ok && l.text === `R&D 공유 권한: ${permFolder} · 성춘향 → 읽기`));
  const id = sp.perms[permPath].find((x) => x.email === 'sung@krs.co.kr').id;
  n = sp.calls.length;
  await tick('성춘향', 'edit', true);
  assert.deepEqual(permCalls(n), [`open:${ORIGIN}/personal/me`, `unshare:${permPath}:${id}`, `share:${permPath}:sung@krs.co.kr:edit`, `close:${permPath}`, `perms:${permPath}`], '읽기 → 편집: 거둔 뒤 다시 준다');
  assert.deepEqual(permDom()[1], ['성춘향', false, true, false, '', false]);
  assert.ok(logs.some((l) => l.kind === 'rnd' && l.ok && l.text === `R&D 공유 권한: ${permFolder} · 성춘향 → 편집`));
  const id2 = sp.perms[permPath].find((x) => x.email === 'sung@krs.co.kr').id;
  n = sp.calls.length;
  await tick('성춘향', 'edit', false);
  assert.deepEqual(permCalls(n), [`open:${ORIGIN}/personal/me`, `unshare:${permPath}:${id2}`, `close:${permPath}`, `perms:${permPath}`], '끄면 거두기만');
  assert.deepEqual(permDom()[1], ['성춘향', false, false, false, '', false]);
  assert.ok(!sp.perms[permPath].some((x) => x.email === 'sung@krs.co.kr'));
  assert.ok(logs.some((l) => l.kind === 'rnd' && l.ok && l.text === `R&D 공유 권한: ${permFolder} · 성춘향 → 없음`));
  // 같은 역할을 다시 켜는 건(이미 편집인 홍길동의 편집) 아무것도 안 한다
  n = sp.calls.length;
  assert.equal(await panel.applyPerm('홍길동', 'edit'), false);
  assert.equal(permCalls(n).length, 0);
  // 폴더에만 있던 사람(extra)의 읽기를 끄면 거두어 줄이 사라진다
  n = sp.calls.length;
  await tick('LEE Jaehoon', 'read', false);
  assert.deepEqual(permCalls(n), [`open:${ORIGIN}/personal/me`, `unshare:${permPath}:12`, `close:${permPath}`, `perms:${permPath}`]);
  assert.deepEqual(permDom().map((r) => r[0]), ['홍길동', '성춘향', '새사람', '없는사람']);
});
await ta('실패 — 공유가 안 되면 그 줄의 상태에 까닭(빨강)·활동 로그, 체크는 실제 상태로 돌아온다. ↻ 는 까닭을 지우고 권한·못 찾은 이름을 다시 읽는다', async () => {
  sp.permFail = 'share';
  let n = sp.calls.length;
  await tick('성춘향', 'read', true);
  assert.deepEqual(permCalls(n), [`open:${ORIGIN}/personal/me`, `share:${permPath}:sung@krs.co.kr:read`, `close:${permPath}`, `perms:${permPath}`]);
  assert.deepEqual(permDom()[1], ['성춘향', false, false, false, '공유 실패(검사)', false]);
  assert.ok($('rdStaffPermBody').querySelector('tr[data-perm="성춘향"] .rd-td-state').classList.contains('error'));
  assert.ok(logs.some((l) => l.kind === 'rnd' && !l.ok && l.text.startsWith(`R&D 공유 권한 실패: ${permFolder} · 성춘향 → 읽기: 공유 실패(검사)`)));
  sp.permFail = '';
  sp.people['새사람'] = { email: 'new@krs.co.kr', title: 'NEW Saram' };
  n = sp.calls.length;
  $('rdStaffPermRefresh').click();
  await until(() => !panel.perm().busy);
  assert.deepEqual(permCalls(n), [`perms:${permPath}`, 'find:새사람,없는사람'], '캐시에 있는 이름은 다시 묻지 않는다');
  assert.deepEqual(permDom().map((r) => [r[0], r[3], r[4]]), [['홍길동', false, ''], ['성춘향', false, ''], ['새사람', false, ''], ['없는사람', true, '사람을 찾지 못했습니다 — OneDrive 에서 직접 공유하세요']], '겹치던 사람이 찾히면 풀리고 실패 까닭은 지워진다');
});
await ta('남의 폴더(책임자의 것)는 읽기만 · 과제 폴더가 아직 없으면 안내 · 로그인이 풀리면 안내 · 다른 과제로 가면 접히고 돌아와 다시 열면 찾지 않는다(캐시) · 끄면 다시 안내', async () => {
  store.shareIndex.P7.owner = '동료';
  $('rdStaffPermRefresh').click();
  await until(() => !panel.perm().busy);
  assert.equal($('rdStaffPermFolder').textContent, `${permFolder} 폴더 · 책임자(동료)의 폴더 — 권한은 책임자가 · 조직 내 링크 편집`);
  assert.ok(permDom().every((r) => r[3]), '체크가 모두 잠긴다');
  assert.equal(await panel.applyPerm('성춘향', 'read'), false);
  delete store.shareIndex.P7.owner;
  const keep = store.shareIndex.P7;
  delete store.shareIndex.P7;
  $('rdStaffPermRefresh').click();
  await until(() => !panel.perm().busy);
  assert.equal($('rdStaffPermMsg').textContent, '과제 폴더가 아직 없습니다 — 설정 › Plus 의 지금 동기화로 폴더를 만든 뒤 ↻ 를 누르세요.');
  assert.ok($('rdStaffPermMsg').classList.contains('error') && $('rdStaffPermBody').innerHTML === '' && $('rdStaffPermFolder').textContent === '');
  store.shareIndex.P7 = keep;
  sp.authList = true;
  $('rdStaffPermRefresh').click();
  await until(() => !panel.perm().busy);
  assert.equal($('rdStaffPermMsg').textContent, 'OneDrive 에 로그인하세요 — 설정 › Plus 의 폴더 열기로 로그인한 뒤 ↻');
  assert.ok(logs.some((l) => l.kind === 'rnd' && !l.ok && /^R&D 공유 권한 읽기 실패: /.test(l.text)));
  sp.authList = false;
  $('rdStaffPermRefresh').click();
  await until(() => !panel.perm().busy && panel.perm().perms);
  assert.ok(hidden('rdStaffPermMsg') && permDom().length === 4);
  pickChip('차단기 과제');
  await wait(20);
  assert.ok(hidden('rdStaffPerm') && !$('rdStaffShare').classList.contains('on') && panel.perm().open === '', '다른 과제로 가면 접힌다');
  pickChip('TEST');
  await wait(20);
  assert.ok(hidden('rdStaffPerm'), '돌아와도 접힌 채');
  const n = sp.calls.length;
  $('rdStaffShare').click();
  await until(() => !panel.perm().busy && panel.perm().perms);
  assert.deepEqual(permCalls(n), [`perms:${permPath}`], '찾은 이름은 저장소의 캐시로, 이 세션에서 못 찾은 이름도 다시 묻지 않는다(↻ 만 다시)');
  assert.deepEqual(permDom().map((r) => r[0]), ['홍길동', '성춘향', '새사람', '없는사람']);
  $('rdStaffShare').click();
  assert.ok(hidden('rdStaffPerm'));
  $('rdShareOn').checked = false;
  change($('rdShareOn'));
  await until(() => $('rdShareState').textContent === '꺼짐');
  bookProject('TEST').support = [];
  sp.links = [];
});

console.log('설정 › Plus(2026-10-25 "rerp 에서 plus 기능을 워크스페이스에서 동일하게" · "rerp 설정을 따름") — rERP 확장의 공유 (Plus) 설정을 칸마다 따르고 여기서 바꾼 칸만 이긴다');
await ta('rERP 확장이 답하면 그 설정(켬 · 고른 과제만 · 예상 비용 끔)을 따른다 — 여기서 끈 켜짐은 이기고, [rERP 설정 따르기]를 누르면 비워 따른다. 고른 과제만 맞춘다', async () => {
  const KEY = 'P7';   // TEST 의 지금 차년도는 참여인력 검사에서 rERP 과제 P7 에 이어져 공유 열쇠가 P7
  const peer = { ok: true, enabled: true, folder: '', driveHost: ORIGIN, version: '0.9.0', plus: { scope: 'pick', projects: [KEY], planSync: false } };
  const asked = [];
  const saved = { management: globalThis.chrome.management, runtime: globalThis.chrome.runtime };
  globalThis.chrome.management = { getAll: async () => [{ type: 'extension', name: 'KR eClass + R&D ERP 현황', id: 'rerp-id', enabled: true }] };
  globalThis.chrome.runtime = { id: 'ws-id', sendMessage: async (id, msg) => { asked.push([id, msg.type]); return peer; } };
  try {
    sp.reset();
    await panel.showPlus();
    assert.equal(asked.at(-1)?.[1], 'shareFolder', 'rERP 확장에 묻는다');
    assert.ok(!$('rdShareOn').checked, '여기서 끈 것(own.enabled)이 rERP 확장의 켬을 이긴다');
    assert.equal($('plusFollow').textContent, 'rERP 확장의 설정을 따름 · 여기서 바꾼 칸 1개');
    assert.ok(!$('plusFollowReset').hidden);
    assert.ok($('plusScopePick').checked && !$('plusPrjPick').hidden && !$('plusPlanSync').checked && $('plusResearchSync').checked, '공유할 과제·항목은 rERP 확장의 것');
    assert.deepEqual([...$('plusPrjPick').querySelectorAll('input:checked')].map((x) => x.dataset.key), [KEY]);
    assert.equal($('plusPrjPick').querySelectorAll('input').length, 4, '장부의 과제 넷을 고를 수 있다');
    assert.equal($('plusSummary').textContent, '고른 과제 1개');
    $('plusFollowReset').click();
    await untilLong(() => /^맞춤 /.test($('rdShareState').textContent));
    assert.ok($('rdShareOn').checked && $('plusFollowReset').hidden);
    assert.equal($('plusFollow').textContent, 'rERP 확장의 설정을 따름');
    assert.deepEqual(store.rndShare.own, {});
    assert.deepEqual(Object.keys(store.planSyncState.pages), [KEY], '고른 과제만 맞춘다(allow)');
    assert.deepEqual(spFolders(), ['TEST'], '고르지 않은 과제는 폴더를 만들지 않는다');
    assert.equal($('plusPages').querySelectorAll('li').length, 1);
    assert.match($('plusPages').textContent, /^TEST/);
    // 과제를 하나 더 고르면 그 칸만 여기 것 — 다시 빼면 rERP 확장과 같아져 다시 따른다
    const other = [...$('plusPrjPick').querySelectorAll('input')].find((x) => x.dataset.key !== KEY);
    other.checked = true;
    change(other);
    await wait(10);
    assert.deepEqual(Object.keys(store.rndShare.own), ['projects']);
    assert.deepEqual([...store.rndShare.own.projects].sort(), [other.dataset.key, KEY].sort());
    assert.equal($('plusFollow').textContent, 'rERP 확장의 설정을 따름 · 여기서 바꾼 칸 1개');
    assert.equal($('plusSummary').textContent, '고른 과제 2개');
    const box = [...$('plusPrjPick').querySelectorAll('input')].find((x) => x.dataset.key === other.dataset.key);
    box.checked = false;
    change(box);
    await wait(10);
    assert.deepEqual(store.rndShare.own, {}, 'rERP 확장과 같아지면 다시 따른다');
    $('plusPlanSync').checked = true;
    change($('plusPlanSync'));
    await wait(10);
    assert.deepEqual(store.rndShare.own, { planSync: true }, '항목도 칸마다');
    assert.ok(logs.some((l) => l.text === 'R&D 공유 — 예상 비용: 켬'));
  } finally {
    globalThis.chrome.management = saved.management;
    globalThis.chrome.runtime = saved.runtime;
    $('rdShareOn').checked = false;
    change($('rdShareOn'));
    await until(() => $('rdShareState').textContent === '꺼짐');
  }
});

console.log('다시 열기');
await ta('저장된 것으로 다시 선다 — 공문 탭에서 다시 가져오지 않는다', async () => {
  await wait(500);
  panel.hide();
  assert.ok(hidden('rnd'));
  panel = make();
  await panel.show();
  assert.ok(!hidden('rnd'));
  assert.equal($('rdShareState').textContent, '꺼짐', '공유는 꺼진 채 다시 선다');
  assert.ok(!$('rdShareOn').checked);
  assert.deepEqual(chips().map((c) => c[0]), ['차단기 과제', '파일 과제', '수소전기추진 연구', 'TEST']);
  assert.equal(chips().at(-1)[1], true);
  assert.equal(logItems().length, 1);
  assert.equal(staffRows().length, 2, '참여인력 검사에서 이은 rERP 과제(P7)의 참여인력도 잇기와 함께 남는다');
  assert.equal(chItems().length, 11, '참여인력 칸은 보이기만 하니 변경이력이 늘지 않는다');
  assert.equal(rows().find((r) => r[0] === '인건비')[1], '30,000');
  assert.equal(panel.book().projects.length, 4);
  assert.equal(panel.book().projects[3].years[1].snapshot.rev, 'r2');
});

console.log(`\n${pass} passed`);
