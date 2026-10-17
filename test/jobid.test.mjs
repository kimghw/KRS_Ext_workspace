// 전자결재 과제(Job Id) 찾기 — 규칙(src/jobid.js), R&D 탭 과제 정보 카드의 저절로 찾기(rndpanel.js autoJob — 2026-10-16 사용자 지정), 공문 작성의 고르기(src/gmwrite.js).
// 2026-10-16 사용자 지정: "과제 책임자로 우선 검색하고 유사도가 높은 0.5 이상인 걸 … 규칙식으로 검색해서 가장 높은 걸 가져오고 선택할 수 있도록".
// 어디에도 보내지 않는다 — 과제 목록은 흉내다.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { rankJobs, similarity, parseJobRows, isJobCode, slimJob, JOB_QUERY, JOB_MIN } from '../src/jobid.js';

const NAME = 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발';
// R&D PMS 목록(ListJSON_Ver2.ashx)의 꼴 그대로 — 쓰지 않는 칸은 뺐다.
const ROWS = [
  { Project_ID: 'RND00052026', Project_ID_DASH: 'RND-05-2026', Project_Name: '선박용 수소 엔진 추진 시스템', User_Name: '김거화', Process: '진행', YEAR: '2026' },
  { Project_ID: 'RND00102025', Project_ID_DASH: 'RND-10-2025', Project_Name: `${NAME} 기획`, User_Name: '박기도', Process: '완료', YEAR: '2025' },
  { Project_ID: 'RND00202026', Project_ID_DASH: 'RND-20-2026', Project_Name: NAME, User_Name: '김거화', Process: '진행', YEAR: '2026', TURN: '1 / 0' },
  { Project_ID: 'RND00992024', Project_ID_DASH: 'RND-99-2024', Project_Name: NAME, User_Name: '김거화', Process: '미선정', YEAR: '2024' },
];

test('과제명 유사도 — 빈칸·기호·대소문자를 떼고 두 글자씩 묶은 Dice 계수, 같으면 1', () => {
  assert.equal(similarity(NAME, ` mw급 10KV 고전압-직류 시스템용 반도체 차단기개발 `), 1);
  assert.equal(similarity(NAME, ''), 0);
  assert.equal(similarity('가', '가'), 1);
  assert.ok(similarity(NAME, `${NAME} 기획`) > 0.9);
  assert.ok(similarity(NAME, '선박용 수소 엔진 추진 시스템') < JOB_MIN);
});

test('Job Id 꼴 — RND00202026 · RND-20-2026 은 번호, 국가과제 번호(RS-…)는 아니다(PMS 목록에 없다)', () => {
  assert.deepEqual(['RND00202026', ' rnd-20-2026 ', 'RS-2026-25547199', ''].map(isJobCode), [true, true, false, false]);
  assert.deepEqual(parseJobRows(JSON.stringify(JSON.stringify(ROWS))).length, 4, '문자열로 한 번 더 싸여 와도');
  assert.deepEqual(parseJobRows(JSON.stringify({ Table: ROWS })).length, 4);
  assert.deepEqual(parseJobRows('<script>alert("You must sign in.")</script>'), []);
  assert.equal(slimJob(ROWS[2]).lead, '김거화');
});

test('Job Id 가 목록에 있으면 그 줄 하나 — 두 꼴 모두', () => {
  for (const job of ['RND-10-2025', 'rnd00102025']) {
    const r = rankJobs(ROWS, { job, name: NAME, lead: '김거화' });
    assert.equal(r.by, 'job');
    assert.deepEqual(r.list.map((x) => x.id), ['RND00102025']);
  }
  const miss = rankJobs(ROWS, { job: 'RND-77-2026', name: NAME, lead: '김거화' });
  assert.equal(miss.by, 'lead', '목록에 없는 Job Id 면 책임자·과제명으로');
});

test('책임자가 같은 과제 먼저, 그 안에서 유사도 높은 차례(같으면 진행 → 최근 해) — 책임자가 다른 줄은 뒤에, 0.5 아래는 뺀다', () => {
  const r = rankJobs(ROWS, { name: NAME, lead: '김거화' });
  assert.equal(r.by, 'lead');
  assert.deepEqual(r.list.map((x) => [x.id, x.sameLead, x.score]), [['RND00202026', true, 1], ['RND00992024', true, 1], ['RND00102025', false, r.list[2].score]]);
  assert.ok(r.list[2].score >= JOB_MIN && r.list[2].score < 1);
  // 과제명이 다른 과제(기획)와 더 같아도 책임자가 같은 과제가 먼저다.
  const plan = rankJobs(ROWS, { name: `${NAME} 기획`, lead: '김거화' });
  assert.deepEqual(plan.list.map((x) => x.id), ['RND00202026', 'RND00992024', 'RND00102025']);
  // 책임자를 모르면 유사도만.
  assert.deepEqual(rankJobs(ROWS, { name: `${NAME} 기획` }).list.map((x) => x.id), ['RND00102025', 'RND00202026', 'RND00992024']);
  assert.equal(rankJobs(ROWS, { name: `${NAME} 기획` }).by, 'name');
  assert.deepEqual(rankJobs(ROWS, { name: '수소 연료전지', lead: '김거화' }), { by: 'none', list: [] });
  assert.equal(rankJobs(ROWS, { name: NAME }, { limit: 1 }).list.length, 1);
});

/* ------------------------------------------------------------ R&D 탭 과제 정보 카드의 저절로 찾기(2026-10-16 사용자 지정) */

test('과제 정보 카드 — Job Id 가 비면 저절로 찾아 가장 높은 후보를 골라 두고, 다른 후보를 누르면 바뀌고, 이 번호로 저장을 누르면 남으며 묶음은 사라진다. 못 받으면 까닭과 다시 찾기', async () => {
  const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
  const { window } = new JSDOM(html, { url: 'https://example.org/' });
  const doc = window.document;
  for (const g of ['document', 'FileReader', 'Element', 'HTMLElement', 'File', 'Blob']) globalThis[g] = window[g];
  globalThis.window = window;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'jobid-test', clipboard: { writeText: async () => {} } } });
  const store = { rndBook: { projects: [{ id: 'p1', name: NAME, alias: 'SSCB', code: 'RS-2026-25547199', lead: '김거화', start: '2026-04-01', end: '2029-12-31' }], current: { project: 'p1' } } };
  globalThis.chrome = { storage: { local: { get: async () => JSON.parse(JSON.stringify(store)), set: async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); } } } };
  const { createRndPanel } = await import('../rndpanel.js');
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let asked = 0;
  let fail = null;
  const erp = { settingsOf: (o) => ({ ...o }), fetchProjectRecs: async () => ({ recs: [], calls: [], capped: false, firstErr: null }), fetchBudget: async () => { throw new Error('없음'); } };
  const panel = createRndPanel({
    $: (id) => doc.getElementById(id), escapeHtml, logEvent: () => {}, today: () => '2026-10-16', erp,
    openNote: async () => { throw new Error('없음'); }, readAsset: async () => { throw new Error('없음'); },
    jobs: async () => { asked++; if (fail) throw fail; return ROWS; },
    // 회계(e-accounting — 회계 I/O 저절로 찾기, 2026-10-17)는 이 검사의 것이 아니다 — 빈 목록으로 흉내(어디에도 보내지 않게).
    acct: { list: async () => [], get: async () => null },
  });
  // 처음엔 목록을 못 받는다(로그인 안 됨) — 열자마자 찾고, 까닭과 다시 찾기만 보인다.
  fail = new Error('로그인이 필요합니다');
  panel.wire();
  await panel.show();
  const $ = (id) => doc.getElementById(id);
  const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  const hidden = (id) => $(id).classList.contains('hidden');
  const cands = () => [...$('rdJobList').querySelectorAll('[data-job]')];
  const picked = () => $('rdJobList').querySelector('[aria-pressed="true"] b').textContent;

  await settle();
  assert.equal(asked, 1, '과제를 고르면 폼을 열지 않아도 저절로 한 번 받는다');
  assert.ok(!hidden('rdJobBox') && !hidden('rdJobRetry') && hidden('rdJobSave'));
  assert.match($('rdMeta').textContent, /Job Id\s*없음 — 과제 목록을 받지 못했습니다\(아래 다시 찾기\)/);
  assert.match($('rdJobMsg').textContent, /과제 목록을 받지 못했습니다 — 로그인이 필요합니다/);
  assert.ok($('rdJobMsg').classList.contains('bad'));
  assert.equal(cands().length, 0);

  // 다시 찾기 — 새로 받아 후보를 높은 차례로, 가장 높은 것을 골라 둔다. 표의 Job Id 줄에도 그 후보.
  fail = null;
  $('rdJobRetry').click();
  await settle();
  assert.equal(asked, 2);
  assert.ok(!hidden('rdJobBox') && hidden('rdJobRetry') && !hidden('rdJobSave'));
  assert.match($('rdMeta').textContent, /Job Id\s*RND00202026 \(후보 — 맞는지 보고 아래에서 저장\)/);
  assert.deepEqual(cands().map((b) => [b.querySelector('b').textContent, b.getAttribute('aria-pressed')]),
    [['RND00202026', 'true'], ['RND00992024', 'false'], ['RND00102025', 'false']]);
  assert.match(cands()[0].textContent, /책임자 김거화 같음 · 진행 · 유사도 1\.00/);
  assert.match($('rdJobMsg').textContent, /가장 비슷한 과제를 골라 두었습니다\(책임자 김거화 같음 · 유사도 1\.00\)/);
  assert.ok(!$('rdJobMsg').classList.contains('bad'));

  cands()[2].click();
  assert.equal(picked(), 'RND00102025');
  assert.match($('rdMeta').textContent, /Job Id\s*RND00102025 \(후보/);
  assert.equal(asked, 2, '후보를 바꿔도 다시 받지 않는다');

  // 폼은 손으로 고치는 곳 — 찾기 단추가 없고 칸은 저장 전엔 비어 있다. 폼을 닫아도 고른 후보는 그대로.
  $('rdEdit').click();
  assert.equal($('rdFJob').value, '', 'Job Id 는 과제번호(국가과제 번호)와 따로 — 저장 전엔 비어 있다');
  assert.equal($('rdFJobFind'), null, '폼에는 찾기가 없다 — 과제 정보 카드가 저절로 찾는다');
  $('rdFCancel').click();
  assert.equal(picked(), 'RND00102025');

  // 이 번호로 저장 — 묶음은 사라지고 표의 Job Id 줄만 남는다. 과제번호는 그대로.
  cands()[0].click();
  $('rdJobSave').click();
  assert.ok(hidden('rdJobBox'));
  assert.match($('rdMeta').textContent, /Job Id\s*RND00202026\s*회계 I\/O\s*없음[^책]*책임자/, '표의 Job Id 줄 다음은 회계 I/O 줄(2026-10-17 — 여기서는 빈 목록이라 없음)');
  await settle(500);
  assert.equal(store.rndBook.projects[0].job, 'RND00202026');
  assert.equal(store.rndBook.projects[0].code, 'RS-2026-25547199', '과제번호는 그대로');

  // 과제 고치기에서 손으로 고친다. 비우고 저장하면 같은 세션의 목록으로 후보가 다시 보인다(다시 받지 않는다).
  $('rdEdit').click();
  assert.equal($('rdFJob').value, 'RND00202026');
  $('rdFJob').value = 'RND-10-2025';
  $('rdFSave').click();
  await settle(500);
  assert.equal(store.rndBook.projects[0].job, 'RND-10-2025');
  assert.ok(hidden('rdJobBox'));
  $('rdEdit').click();
  $('rdFJob').value = '';
  $('rdFSave').click();
  assert.equal(asked, 2, '같은 세션의 목록을 다시 쓴다');
  assert.ok(!hidden('rdJobBox') && !hidden('rdJobSave'));
  assert.equal(picked(), 'RND00202026');
});

/* ------------------------------------------------------------ 공문 작성 — 하나로 못 고르면 규칙으로 */

const { writeGongmun } = await import('../src/gmwrite.js');

/** 새 공문 창 흉내 — 과제 고르기와 제목만 있는 양식. pageJob 은 Job Id 로 부르면 그 줄을 고르고, 아니면 목록을 줄여 돌려준다. */
function fakeWindow(rows) {
  const jobCalls = [];
  const api = {
    tabs: { create: async () => ({ id: 9 }) },
    scripting: {
      executeScript: async ({ func, args = [] }) => {
        if (func.name === 'pageProbe') return [{ frameId: 0, result: { toolbar: true, ready: true } }, { frameId: 3, result: { form: true, ready: true, docId: 'HER-1' } }];
        if (func.name === 'pageJob') {
          const spec = args[0];
          jobCalls.push(spec);
          const hit = rows.find((r) => r.Project_ID === spec.code);
          return [{ result: hit ? { ok: true, id: hit.Project_ID, dash: hit.Project_ID_DASH, name: hit.Project_Name, turn: hit.TURN || '' }
            : { ok: false, why: `과제 목록에 '${spec.name}' 와 이름이 같은 과제가 없습니다 — 창의 Job Id. 검색으로 고르세요`,
              choices: rows.map((r) => ({ id: r.Project_ID, dash: r.Project_ID_DASH, name: r.Project_Name, lead: r.User_Name, proc: r.Process, year: r.YEAR })) } }];
        }
        if (func.name === 'pageFill') return [{ result: args[0].map((f) => ({ key: f.key, ok: true, value: f.value })) }];
        return [{ result: { ok: false, why: '시험 — 열지 않음' } }];
      },
    },
  };
  const plan = {
    url: 'https://eclass.example/DocumentView.aspx', known: true, form: 'KR_EA_Research_Task', anchor: '#form', setting: {}, line: { missing: [], approvers: [] },
    fields: {
      job: { kind: 'picker', source: 'job', callback: 'callBackReturnFromDialog', hidden: '#hidJobID', list: '/RnDPMS/View/PMS/ListJSON_Ver2.ashx' },
      title: { kind: 'title', source: 'title', selector: '#title' },
    },
    values: { title: '구매 품의', degree: '1', job: { name: '고전압 직류 반도체 차단기 개발(MW급 10kV)', code: 'RS-2026-25547199', lead: '김거화' }, draft: {}, names: {} },
  };
  return { api, plan, jobCalls };
}

test('공문 작성 — 과제명이 같은 줄이 없으면 책임자가 같은 과제 먼저 유사도가 가장 높은 것의 번호로 다시 골라 넣고, 작성 기록에 다른 후보까지 적는다', async () => {
  const { api, plan, jobCalls } = fakeWindow(ROWS);
  const out = await writeGongmun(plan, { api, dry: true });
  assert.deepEqual(jobCalls.map((s) => s.code), ['RS-2026-25547199', 'RND00202026']);
  assert.equal(jobCalls[0].query, JOB_QUERY, '팝업과 같은 조건으로 받는다');
  const job = out.steps.find((s) => s.key === 'job');
  assert.equal(job.ok, true);
  assert.match(job.detail, /^RND-20-2026 · MW급 .* — 책임자·과제명으로 고름\(유사도 0\.\d\d · 책임자 같음 · 다른 후보 RND-99-2024, RND-10-2025\)\. 틀리면 창에서 고르고 R&D 탭 과제 정보의 Job Id 에 적어 두세요$/);
});

test('공문 작성 — 비슷한 과제(0.5 이상)도 없으면 고르지 않는다(첫 줄로 넘어가지 않는다)', async () => {
  const { api, plan, jobCalls } = fakeWindow(ROWS.slice(0, 1));
  const out = await writeGongmun(plan, { api, dry: true });
  assert.equal(jobCalls.length, 1);
  const job = out.steps.find((s) => s.key === 'job');
  assert.equal(job.ok, false);
  assert.match(job.detail, /창의 Job Id\. 검색으로 고르세요 — 책임자·과제명이 비슷한 과제\(유사도 0\.5 이상\)도 없습니다$/);
});
