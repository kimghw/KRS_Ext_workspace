import test from 'node:test';
import assert from 'node:assert/strict';
import { currentSiteTab } from '../src/currenttab.js';
import { siteFetch, AuthError } from '../src/net.js';

const ORIGIN = 'https://eclass.krs.co.kr';
const HTML = '<html><body>current tab session</body></html>';
function globals(t, api, fetch) {
  const previous = globalThis.chrome;
  globalThis.chrome = api;
  t.after(() => { globalThis.chrome = previous; });
  t.mock.method(globalThis, 'fetch', fetch || (async () => { throw new Error('Unexpected direct request'); }));
}
function fakeCurrent(url = `${ORIGIN}/eClassVer4/Home/Index`) {
  const calls = [];
  const api = {
    tabs: { query: async (query) => { calls.push(['query', query]); return [{ id: 42, url, status: 'complete' }]; } },
    scripting: { executeScript: async (command) => {
      calls.push(['script', command.target.tabId]);
      return [{ result: { ok: true, status: 200, html: HTML, finalUrl: `${ORIGIN}/list` } }];
    } },
  };
  return { calls, api };
}

test('사이드패널 창의 활성 탭을 정확한 출처로 찾는다', async () => {
  const f = fakeCurrent();
  assert.equal((await currentSiteTab(ORIGIN, { api: f.api })).id, 42);
  assert.deepEqual(f.calls, [['query', { active: true, currentWindow: true }]]);
  for (const url of ['https://eclass.krs.co.kr.evil.test/', 'https://hr.krs.co.kr/', 'chrome://settings', 'not a URL']) {
    assert.equal(await currentSiteTab(ORIGIN, { api: fakeCurrent(url).api }), null, url);
  }
});

test('현재 eclass 탭에서 조회하고 확장 직접 요청을 중복 실행하지 않는다', async (t) => {
  const f = fakeCurrent(); globals(t, f.api);
  const result = await siteFetch(`${ORIGIN}/list`);
  assert.equal(result.via, 'tab');
  assert.equal(result.html, HTML);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.deepEqual(f.calls.filter(([kind]) => kind === 'script'), [['script', 42]]);
});

test('현재 탭이 다른 사이트면 이동시키지 않고 기존 직접 조회를 쓴다', async (t) => {
  const f = fakeCurrent('https://example.org/work');
  globals(t, f.api, async () => ({ ok: true, url: `${ORIGIN}/list`, headers: { get: () => 'text/html' }, arrayBuffer: async () => new TextEncoder().encode(HTML).buffer }));
  assert.equal((await siteFetch(`${ORIGIN}/list`)).via, 'direct');
  assert.equal(f.calls.some(([kind]) => kind === 'script'), false);
});

test('현재 탭 경유가 실패해도 직접 조회로 복구하며 같은 탭을 거듭 두드리지 않는다', async (t) => {
  const f = fakeCurrent();
  f.api.scripting.executeScript = async () => { f.calls.push(['failed']); throw new Error('Tab closed'); };
  globals(t, f.api, async () => ({ ok: true, url: `${ORIGIN}/list`, headers: { get: () => 'text/html' }, arrayBuffer: async () => new TextEncoder().encode(HTML).buffer }));
  assert.equal((await siteFetch(`${ORIGIN}/list`)).via, 'direct');
  assert.equal(f.calls.filter(([kind]) => kind === 'failed').length, 1);
});

test('저장·예약 POST는 기존 실행 경로를 유지한다', async (t) => {
  const f = fakeCurrent();
  globals(t, f.api, async () => ({ ok: true, url: `${ORIGIN}/save`, headers: { get: () => 'text/html' }, arrayBuffer: async () => new TextEncoder().encode(HTML).buffer }));
  await siteFetch(`${ORIGIN}/save`, { method: 'POST', body: 'action=save' });
  assert.equal(globalThis.fetch.mock.callCount(), 1);
  assert.deepEqual(f.calls, []);
});

function hrChrome(t, { savedId = 42 } = {}) {
  const store = { hrWorkerTab: { id: savedId } }, calls = [];
  let active = 42, expired = false;
  const api = {
    storage: { local: { get: async (key) => ({ [key]: store[key] }), set: async (value) => Object.assign(store, value) } },
    tabs: {
      query: async () => [{ id: active, url: 'https://hr.krs.co.kr/empmenu/home', status: 'complete' }],
      create: async () => { calls.push(['create']); throw new Error('Unexpected new tab'); },
      update: async () => { calls.push(['navigate']); throw new Error('Unexpected navigation'); },
      remove: async (id) => { calls.push(['remove', id]); },
    },
    scripting: { executeScript: async ({ target, func, args }) => {
      calls.push(['script', target.tabId, func.name, args?.[0]]);
      if (func.name === 'pageShell') return [{ result: { shell: true, login: false } }];
      const user = args[0] === '/api/user';
      return [{ result: { status: !user && expired ? 401 : 200, text: JSON.stringify(user ? { loginUserId: String(target.tabId), loginUserNm: '테스트' } : []), url: `https://hr.krs.co.kr${args[0]}` } }];
    } },
  };
  globals(t, api);
  return { store, calls, activate: (id) => { active = id; }, expire: () => { expired = true; } };
}
const hrModule = () => import(`../src/hr.js?current-tab=${Math.random()}`);

test('현재 HR 탭으로 조회하고 패널 종료 때 그 탭을 닫지 않는다', async (t) => {
  const f = hrChrome(t), hr = await hrModule();
  const result = await hr.hrListDocs({ from: '2026-11-01', to: '2026-11-07' });
  assert.deepEqual(result.rows, []);
  assert.equal(result.user.emplNo, '42');
  assert.equal(f.store.hrWorkerTab, null, '활성 탭을 폐기 가능한 작업 탭으로 남기지 않는다');
  await hr.hrCloseWorker();
  assert.equal(f.calls.some(([kind]) => ['create', 'navigate', 'remove'].includes(kind)), false);
  assert.ok(f.calls.filter(([kind]) => kind === 'script').every(([, id]) => id === 42));
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('다른 현재 HR 탭으로 옮기면 이전 세션보다 현재 탭을 우선한다', async (t) => {
  const f = hrChrome(t), hr = await hrModule();
  assert.equal((await hr.hrSession()).user.emplNo, '42');
  f.activate(43);
  assert.equal((await hr.hrSession()).user.emplNo, '43');
});

test('재사용한 HR 탭이 미인증이면 그 탭을 about:blank/SSO로 이동시키지 않는다', async (t) => {
  const f = hrChrome(t), hr = await hrModule();
  await hr.hrSession(); f.expire();
  await assert.rejects(hr.hrListDocs({ from: '2026-11-01', to: '2026-11-07' }), (error) => error instanceof AuthError && /현재 HR 탭/.test(error.message));
  assert.equal(f.calls.some(([kind]) => ['create', 'navigate', 'remove'].includes(kind)), false);
});
