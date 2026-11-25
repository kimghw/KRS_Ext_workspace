// 다른 확장의 받기 다리(native/gitclient.mjs)와 그 등록(native/gitclient-setup.mjs).
//
// 다리 쪽은 임시 폴더의 진짜 저장소(맨 저장소 + 둘)로 본다 — 등록된 주소는 제 폴더만 확인·받고, 등록되지 않은 주소와 받기 아닌 작업은 거절한다.
// 끝에서는 다리를 브라우저가 띄우듯(부른 쪽 주소를 인자로, 프레임을 표준 입력으로) 진짜로 띄워 본다.
// 등록 쪽은 확장 ID 셈(이 확장의 실제 ID 로 맞춰 본다)과 표·매니페스트·레지스트리 명령(흉내)을 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { frame } from '../native/entry.mjs';
import { HOST_NAME, originOf, readClients, clientOf, createHandler } from '../native/gitclient.mjs';
import { extensionIdForPath, extensionIdForKey, resolveClient, manifestOf, apply, addClient, removeClient, main, REG_KEYS } from '../native/gitclient-setup.mjs';

const HOST = fileURLToPath(new URL('../native/gitclient.mjs', import.meta.url));
const A = `chrome-extension://${'a'.repeat(32)}/`;
const B = `chrome-extension://${'b'.repeat(32)}/`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'krs-gitclient-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const sh = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (dir, file, text, subject) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  sh(dir, 'add', file);
  sh(dir, 'commit', '-q', '-m', subject);
};
const who = (dir) => { sh(dir, 'config', 'user.name', '시험'); sh(dir, 'config', 'user.email', 'test@example.org'); sh(dir, 'config', 'core.autocrlf', 'false'); };

// origin(GitHub 대신) ← there(다른 PC) / here(등록된 확장 폴더). other 는 등록되지 않은 남의 폴더.
const origin = path.join(tmp, 'origin.git');
const here = path.join(tmp, 'here');
const there = path.join(tmp, 'there');
sh(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
sh(tmp, 'clone', '-q', '-c', 'core.autocrlf=false', origin, there);
who(there);
sh(there, 'symbolic-ref', 'HEAD', 'refs/heads/main');
commit(there, 'manifest.json', '{"manifest_version":3,"name":"시험","version":"1.0.0"}\n', '처음');
sh(there, 'push', '-q', '-u', 'origin', 'main');
sh(tmp, 'clone', '-q', '-c', 'core.autocrlf=false', origin, here);
who(here);

const clients = { [A]: { name: 'ubob', repo: here } };

test('부른 쪽 주소는 브라우저가 넘긴 인자에서만 읽는다', () => {
  assert.equal(originOf(['node', 'gitclient.mjs', A, '--parent-window=123']), A);
  assert.equal(originOf(['node', 'gitclient.mjs']), '');
  assert.equal(originOf(['node', 'gitclient.mjs', 'chrome-extension://short/', 'https://example.org/']), '');
});

test('등록 표는 없거나 깨졌으면 빈 표이고, 주소가 맞는 줄만 등록으로 본다', () => {
  assert.deepEqual(readClients(path.join(tmp, '없음.json')), {});
  const bad = path.join(tmp, 'bad.json');
  fs.writeFileSync(bad, '{ 깨짐');
  assert.deepEqual(readClients(bad), {});
  assert.deepEqual(clientOf(A, clients), { name: 'ubob', repo: here });
  assert.equal(clientOf(B, clients), null);
  assert.equal(clientOf('constructor', clients), null);
  assert.equal(clientOf(A, { [A]: { name: 'x' } }), null);
});

test('등록되지 않은 주소는 아무 작업도 못 한다', async () => {
  const handle = createHandler({ origin: B, clients });
  for (const task of ['ping', 'gitStatus', 'gitPull']) {
    const r = await handle({ task });
    assert.deepEqual([r.ok, r.code], [false, 'NOT_REGISTERED']);
  }
});

test('등록된 주소도 받기 말고는 못 부른다 — 본래 다리의 작업 이름은 거절된다', async () => {
  const called = [];
  const handle = createHandler({ origin: A, clients, status: async () => { called.push('status'); return { ok: true }; }, pull: async () => { called.push('pull'); return { ok: true }; }, log: () => {} });
  for (const task of ['helpAsk', 'logs', 'search', 'ktxSearch', 'constructor', undefined]) {
    const r = await handle({ task });
    assert.deepEqual([r.ok, r.code], [false, 'NOT_ALLOWED'], String(task));
  }
  assert.deepEqual(called, []);
  assert.deepEqual(await handle({ task: 'ping' }), { ok: true, pong: true, name: 'ubob' });
});

test('등록된 폴더가 없어졌으면 git 을 부르지 않고 알린다', async () => {
  const handle = createHandler({ origin: A, clients: { [A]: { name: 'ubob', repo: path.join(tmp, '옮김') } }, log: () => {} });
  const r = await handle({ task: 'gitStatus' });
  assert.deepEqual([r.ok, r.code], [false, 'REPO_MISSING']);
});

test('제 폴더를 확인하고 받는다 — 받기는 기록에 남고, 설명·검사만 바뀌면 다시 불러오지 않는다', async () => {
  const logged = [];
  const handle = createHandler({ origin: A, clients, log: (e) => logged.push(e) });
  const same = await handle({ task: 'gitStatus' });
  assert.deepEqual([same.ok, same.branch, same.behind, same.ahead], [true, 'main', 0, 0]);

  commit(there, 'README.md', '# 설명\n', '설명 추가');
  commit(there, 'tests/a.test.cjs', '// 검사\n', '검사 추가');
  sh(there, 'push', '-q');
  const behind = await handle({ task: 'gitStatus' });
  assert.deepEqual([behind.behind, behind.commits.map((c) => c.subject)], [2, ['검사 추가', '설명 추가']]);
  assert.deepEqual(logged, []);

  const docs = await handle({ task: 'gitPull' });
  assert.deepEqual([docs.ok, docs.pulled, docs.reload, docs.files], [true, 2, false, ['README.md', 'tests/a.test.cjs']]);
  assert.equal(fs.readFileSync(path.join(here, 'README.md'), 'utf8'), '# 설명\n');
  assert.deepEqual([logged.length, logged[0].task, logged[0].client, logged[0].pulled], [1, 'gitPull', 'ubob', 2]);

  commit(there, 'popup/popup.js', '// 화면\n', '화면 고침');
  sh(there, 'push', '-q');
  const code = await handle({ task: 'gitPull' });
  assert.deepEqual([code.ok, code.pulled, code.reload], [true, 1, true]);
});

function callHost(args, message, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOST, ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    const chunks = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error('다리가 답하지 않았다')); }, 30_000);
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks);
      resolve(raw.length >= 4 ? JSON.parse(raw.subarray(4, 4 + raw.readUInt32LE(0)).toString('utf8')) : null);
    });
    child.stdin.end(frame(message));
  });
}

test('브라우저가 띄우듯 띄운 다리 — 주소로 폴더를 찾아 확인하고, 다른 주소는 거절한다', async () => {
  const file = path.join(tmp, 'clients.json');
  fs.writeFileSync(file, JSON.stringify(clients));
  const env = { KRS_GIT_CLIENTS: file, KRS_BRIDGE_LOG_DIR: path.join(tmp, 'logs') };
  commit(there, 'src/background.js', '// 뒤\n', '뒤 고침');
  sh(there, 'push', '-q');

  const s = await callHost([A, '--parent-window=0'], { task: 'gitStatus' }, env);
  assert.deepEqual([s.ok, s.behind, s.commits[0].subject], [true, 1, '뒤 고침']);
  const p = await callHost([A, '--parent-window=0'], { task: 'gitPull' }, env);
  assert.deepEqual([p.ok, p.pulled, p.reload], [true, 1, true]);
  assert.equal(fs.readdirSync(path.join(tmp, 'logs')).length, 1);

  const stranger = await callHost([B], { task: 'gitStatus' }, env);
  assert.deepEqual([stranger.ok, stranger.code], [false, 'NOT_REGISTERED']);
  const none = await callHost([], { task: 'gitPull' }, env);
  assert.deepEqual([none.ok, none.code], [false, 'NOT_REGISTERED']);
  const other = await callHost([A], { task: 'helpAsk', text: '고쳐 줘' }, env);
  assert.deepEqual([other.ok, other.code], [false, 'NOT_ALLOWED']);
});

test('확장 ID 셈 — 압축해제 확장은 폴더 경로에서(이 확장의 실제 ID), key 가 있으면 key 에서', () => {
  // 2026-11-13 chrome://extensions 에 보이는 이 확장의 ID(native/com.krs.meetingroom.json 의 allowed_origins).
  assert.equal(extensionIdForPath('E:\\dev\\kr_ext_workspace', { win: true }), 'dhlebfmcjdocldbfighcfkphgkpdkjbf');
  // 드라이브 글자는 대문자로, 끝의 구분자는 뗀다. 폴더 이름의 대소문자는 그대로 쓴다.
  assert.equal(extensionIdForPath('e:\\dev\\kr_ext_workspace\\', { win: true }), 'dhlebfmcjdocldbfighcfkphgkpdkjbf');
  assert.notEqual(extensionIdForPath('E:\\dev\\KR_EXT_WORKSPACE', { win: true }), 'dhlebfmcjdocldbfighcfkphgkpdkjbf');
  assert.match(extensionIdForPath('/home/me/ext', { win: false }), /^[a-p]{32}$/);
  assert.match(extensionIdForKey('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\nMIIBCgKCAQEA'), /^[a-p]{32}$/);
  assert.equal(extensionIdForKey('AAEC AwQ='), extensionIdForKey('AAECAwQ='));
});

test('폴더를 등록할 한 줄로 — 확장 폴더이고 git 저장소여야 한다', () => {
  const c = resolveClient(here);
  assert.deepEqual([c.name, c.from, c.origin], ['here', 'path', `chrome-extension://${c.id}/`]);
  assert.equal(c.id, extensionIdForPath(c.repo));
  assert.equal(path.basename(c.repo), 'here');
  assert.deepEqual([resolveClient(here, { id: 'c'.repeat(32), name: '유밥' }).origin, resolveClient(here, { id: 'c'.repeat(32), name: '유밥' }).name],
    [`chrome-extension://${'c'.repeat(32)}/`, '유밥']);
  assert.throws(() => resolveClient(here, { id: 'XYZ' }), /확장 ID 모양/);
  assert.throws(() => resolveClient(tmp), /manifest\.json/);
  const plain = path.join(tmp, 'plain');
  fs.mkdirSync(plain);
  fs.writeFileSync(path.join(plain, 'manifest.json'), '{"name":"x"}');
  assert.throws(() => resolveClient(plain, { inRepo: () => false }), /git 저장소가 아닙니다/);
  fs.writeFileSync(path.join(plain, 'manifest.json'), '{"name":"x","key":"AAECAwQ="}');
  assert.deepEqual([resolveClient(plain, { inRepo: () => true }).from, resolveClient(plain, { inRepo: () => true }).id], ['key', extensionIdForKey('AAECAwQ=')]);
});

test('표에 더하고 빼기 — 한 폴더에 주소 하나, 폴더나 ID 로 뺀다', () => {
  const one = addClient({}, { origin: A, name: 'ubob', repo: here });
  assert.deepEqual(one, { [A]: { name: 'ubob', repo: here } });
  // 같은 폴더를 다른 ID 로 다시 올렸으면 옛 줄은 사라진다.
  assert.deepEqual(addClient(one, { origin: B, name: 'ubob', repo: here.toUpperCase() }), { [B]: { name: 'ubob', repo: here.toUpperCase() } });
  const two = addClient(one, { origin: B, name: 'aip', repo: there });
  assert.deepEqual(Object.keys(two), [A, B]);
  assert.deepEqual(removeClient(two, here), { clients: { [B]: { name: 'aip', repo: there } }, removed: [A] });
  assert.deepEqual(removeClient(two, 'b'.repeat(32)).removed, [B]);
  assert.deepEqual(removeClient(two, path.join(tmp, '없음')).removed, []);
});

test('표대로 매니페스트와 레지스트리를 맞춘다 — 표에 있는 주소만 부를 수 있고, 표가 비면 등록을 걷는다', () => {
  const file = path.join(tmp, 'apply-clients.json');
  const manifestFile = path.join(tmp, `${HOST_NAME}.json`);
  const calls = [];
  const reg = (args) => { calls.push(args); return { ok: true, err: '' }; };
  const io = { file, manifestFile, bat: 'C:\\다리\\gitclient-bridge.bat', reg };

  const rows = apply({ [A]: { name: 'ubob', repo: here }, 엉뚱한: { repo: 'x' } }, io);
  assert.deepEqual(rows.map((r) => [r.label, r.ok]), [['크롬', true], ['엣지', true]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestFile, 'utf8')),
    { name: 'com.krs.gitsync', description: 'KRS WORKSPACE - 다른 확장의 GitHub 받기 다리', path: 'C:\\다리\\gitclient-bridge.bat', type: 'stdio', allowed_origins: [A] });
  assert.deepEqual(calls, REG_KEYS.map(([, key]) => ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestFile, '/f']));
  assert.deepEqual(manifestOf({ [A]: {}, [B]: {} }, 'x').allowed_origins, [A, B]);

  calls.length = 0;
  apply({}, io);
  assert.equal(fs.existsSync(manifestFile), false);
  assert.deepEqual(calls, REG_KEYS.map(([, key]) => ['delete', key, '/f']));
  assert.deepEqual(readClients(file), {});
});

test('명령줄 — add·list·remove', () => {
  const file = path.join(tmp, 'cli-clients.json');
  const manifestFile = path.join(tmp, 'cli-manifest.json');
  const lines = [];
  const io = { file, manifestFile, reg: () => ({ ok: true, err: '' }), out: (l) => lines.push(l) };

  assert.equal(main(['add', here, '--name', '유밥'], io), 0);
  const id = extensionIdForPath(resolveClient(here).repo);
  assert.deepEqual(Object.values(readClients(file)).map((c) => c.name), ['유밥']);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).allowed_origins, [`chrome-extension://${id}/`]);
  assert.ok(lines.some((l) => l.includes(id)));

  lines.length = 0;
  assert.equal(main(['list'], io), 0);
  assert.ok(lines[0].startsWith('유밥  chrome-extension://'));
  assert.equal(main(['remove', path.join(tmp, '없음')], io), 1);
  assert.equal(main(['remove', here], io), 0);
  assert.deepEqual(readClients(file), {});
  assert.equal(fs.existsSync(manifestFile), false);
  assert.equal(main(['이상한 명령'], io), 1);
  assert.equal(main(['add', here], { ...io, reg: () => ({ ok: false, err: '접근 거부' }) }), 1);
});
