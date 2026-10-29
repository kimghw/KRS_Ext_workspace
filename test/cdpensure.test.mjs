// CDP 크롬 띄우기(test/cdp/ensure.mjs) — 2026-10-30 사용자 지정: "helpchat 에서 cdp 가 없는 경우 cdp 9333 포트 생성해서 작업하도록 해줘".
// 9333 과 크롬은 흉내 낸다(fetch · spawn 을 갈아 끼운다). 진짜 크롬은 띄우지 않는다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureChrome, profileOf, chromeOf, launchArgs, loginState, describe, HOME } from './cdp/ensure.mjs';

/** 가짜 9333 — up 이 참이면 답하고, tabs 가 /json/list 다. */
function fake({ up = false, tabs = [] } = {}) {
  const port = { up, tabs, spawned: [] };
  port.fetchImpl = async (url) => {
    if (!port.up) throw new TypeError('fetch failed');
    return { json: async () => (url.endsWith('/json/version') ? { Browser: 'Chrome/156.0.8078.73' } : port.tabs) };
  };
  port.spawnImpl = (bin, args, opts) => {
    port.spawned.push({ bin, args, opts });
    port.up = true;
    return { on() {}, unref() { port.unref = true; } };
  };
  return port;
}
const clock = () => { let t = 0; return { now: () => t, wait: async (ms) => { t += ms; } }; };
const ECLASS = (url) => ({ type: 'page', url });

test('9333 이 답하면 띄우지 않고 로그인 형편만 — e-Class 탭의 주소로 본다', async () => {
  const p = fake({ up: true, tabs: [ECLASS('https://eclass.krs.co.kr/eClassVer4/Home/Index'), { type: 'page', url: 'https://hr.krs.co.kr/' }] });
  const r = await ensureChrome({ port: 9333, fetchImpl: p.fetchImpl, spawnImpl: p.spawnImpl, ...clock() });
  assert.deepEqual([r.ok, r.started, r.login, p.spawned.length], [true, false, 'in', 0]);
  assert.equal(describe(r, 9333), '9333 크롬이 떠 있습니다 · Chrome/156.0.8078.73 · e-Class 로그인됨');
  p.tabs = [ECLASS('https://eclass.krs.co.kr/eClassVer4/Account/Login?ReturnUrl=%2F')];
  assert.equal(await loginState({ port: 9333, fetchImpl: p.fetchImpl }), 'out');
  p.tabs = [];
  assert.equal(await loginState({ port: 9333, fetchImpl: p.fetchImpl }), 'unknown');
});

test('답하지 않으면 거화 9333 프로필로 크롬을 떼어 띄우고(e-Class 홈) 답할 때까지 — 로그인 화면이면 그렇다고', async () => {
  const p = fake({ tabs: [ECLASS('https://eclass.krs.co.kr/eClassVer4/Account/Login?ReturnUrl=%2FeClassVer4%2FHome%2FIndex')] });
  const env = { ProgramFiles: 'C:\\Program Files' };
  const exists = (f) => f === 'E:\\Chrome-9333' || f === 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const r = await ensureChrome({ port: 9333, fetchImpl: p.fetchImpl, spawnImpl: p.spawnImpl, env, exists, ...clock() });
  assert.deepEqual([r.ok, r.started, r.profile, r.login], [true, true, 'E:\\Chrome-9333', 'out']);
  assert.equal(p.spawned.length, 1);
  assert.equal(p.spawned[0].bin, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.deepEqual(p.spawned[0].args, ['--user-data-dir=E:\\Chrome-9333', '--profile-directory=Default', '--remote-debugging-port=9333', HOME], '바로가기 「거화 - Chrome」과 같은 인자');
  assert.deepEqual([p.spawned[0].opts.detached, p.spawned[0].opts.stdio, p.unref], [true, 'ignore', true], '이 프로세스가 끝나도 산다');
  assert.match(describe(r, 9333), /^9333 크롬을 띄웠습니다\(프로필 E:\\Chrome-9333\) · .* · e-Class 로그인 필요 — 그 크롬 창에서 사람이 로그인해야 합니다$/);
});

test('띄워도 답하지 않으면 실패 — 까닭과 함께(exit 1)', async () => {
  const p = fake();
  p.spawnImpl = (bin, args) => { p.spawned.push({ bin, args }); return { on() {}, unref() {} }; };
  const r = await ensureChrome({ port: 9333, fetchImpl: p.fetchImpl, spawnImpl: p.spawnImpl, env: {}, exists: () => false, ...clock() });
  assert.deepEqual([r.ok, r.started], [false, true]);
  assert.match(describe(r, 9333), /^9333 크롬을 띄우지 못했습니다 — 25초 안에 9333 이 답하지 않습니다/);
  const boom = await ensureChrome({ port: 9333, fetchImpl: p.fetchImpl, spawnImpl: () => { throw new Error('ENOENT'); }, env: {}, exists: () => false, ...clock() });
  assert.deepEqual([boom.ok, boom.error], [false, '크롬을 띄우지 못했습니다 — ENOENT']);
});

test('프로필 — KRS_CDP_PROFILE, 아니면 거화 9333 복사본 · krs-web-agents 프로필 가운데 있는 것, 없으면 새 폴더. 크롬은 KRS_CHROME_PATH 나 흔한 자리', () => {
  assert.equal(profileOf({ env: { KRS_CDP_PROFILE: 'D:\\p' }, exists: () => true }), 'D:\\p');
  assert.equal(profileOf({ env: {}, exists: (f) => f.endsWith('KRS') }), 'E:\\dev\\krs-web-agents\\chrome_profile\\KRS');
  assert.match(profileOf({ env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, exists: () => false }), /KRS-WORKSPACE[\\/]chrome-9333$/);
  assert.equal(chromeOf({ env: { KRS_CHROME_PATH: 'X:\\chrome.exe' } }), 'X:\\chrome.exe');
  assert.match(chromeOf({ env: { LOCALAPPDATA: 'C:\\L' }, exists: (f) => f.startsWith('C:\\L') }), /^C:\\L[\\/]Google[\\/]Chrome[\\/]Application[\\/]chrome\.exe$/);
  assert.deepEqual(launchArgs('E:\\x', 9444).slice(0, 3), ['--user-data-dir=E:\\x', '--profile-directory=Default', '--remote-debugging-port=9444']);
});
