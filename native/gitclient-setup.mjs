// 다른 확장을 받기 다리(native/gitclient.mjs — com.krs.gitsync)에 등록한다. 그 확장의 폴더만 주면 된다.
//
//   node native/gitclient-setup.mjs add <확장 폴더> [--id <확장 ID>] [--name <이름>]
//   node native/gitclient-setup.mjs remove <확장 폴더 | 확장 ID>
//   node native/gitclient-setup.mjs list
//
// add 는 ① 등록 표(gitclients.json)에 "그 확장의 주소 → 폴더" 를 적고 ② 표에 있는 주소만 부를 수 있는 호스트 매니페스트
// (com.krs.gitsync.json)를 쓰고 ③ 크롬·엣지의 레지스트리 키에 건다. 본래 다리의 등록(install.ps1 — com.krs.meetingroom)은 건드리지 않는다.
// 확장 ID 는 폴더에서 나온다 — 압축해제 확장의 ID 는 브라우저가 폴더 경로로 만들고, manifest 에 key 가 있으면 그 key 로 만든다.
// chrome://extensions 에 보이는 ID 와 다르면(다른 경로로 올렸다 등) --id 로 준다.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOST_NAME, CLIENTS_FILE, ORIGIN, readClients } from './gitclient.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MANIFEST_FILE = path.join(HERE, `${HOST_NAME}.json`);
const BAT = path.join(HERE, 'gitclient-bridge.bat');
// 브라우저마다 읽는 키가 다르다(install.ps1 과 같다). 매니페스트는 하나, 키는 둘 — 설치되지 않은 브라우저의 키는 놀 뿐 해가 없다.
export const REG_KEYS = [
  ['크롬', `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`],
  ['엣지', `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`],
];
const ID = /^[a-p]{32}$/;

/** SHA-256 의 앞 16바이트를 a~p 로 적은 것이 확장 ID 다. */
const idOf = (bytes) => [...crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32)]
  .map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');

/**
 * 압축해제 확장의 ID — 브라우저가 폴더의 절대 경로로 만든다. Windows 에서는 드라이브 글자를 대문자로 바꾼 경로의 UTF-16LE 바이트다
 * (2026-11-13 이 확장으로 확인: E:\dev\kr_ext_workspace → dhlebfmc…). 그 밖에서는 경로의 UTF-8 바이트.
 */
export function extensionIdForPath(dir, { win = process.platform === 'win32' } = {}) {
  const p = String(dir).replace(/[\\/]+$/, '');
  return win ? idOf(Buffer.from(p.replace(/^[a-z]:/, (d) => d.toUpperCase()), 'utf16le')) : idOf(Buffer.from(p, 'utf8'));
}

/** manifest 에 key(공개 키, base64)가 있으면 ID 는 폴더와 상관없이 그 key 에서 나온다. */
export const extensionIdForKey = (key) => idOf(Buffer.from(String(key).replace(/\s+/g, ''), 'base64'));

/** 폴더의 진짜 이름(대소문자)으로 — 브라우저는 폴더 고르기 창이 준 경로를 쓰므로 디스크에 적힌 꼴과 같다. */
function canonical(dir) {
  const p = path.resolve(dir);
  try { return fs.realpathSync.native(p); } catch { return p; }
}

/**
 * 폴더를 등록할 한 줄로 바꾼다 — 확장 폴더(manifest.json)이고 git 저장소 안이어야 한다.
 * @returns {{origin: string, id: string, repo: string, name: string, from: 'id'|'key'|'path'}}
 */
export function resolveClient(dir, { id = '', name = '', inRepo = insideRepo } = {}) {
  const repo = canonical(dir);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(repo, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(`확장 폴더가 아닙니다(manifest.json 을 읽지 못함): ${repo}`);
  }
  if (!inRepo(repo)) throw new Error(`git 저장소가 아닙니다: ${repo}`);
  const from = id ? 'id' : manifest.key ? 'key' : 'path';
  const extId = id || (manifest.key ? extensionIdForKey(manifest.key) : extensionIdForPath(repo));
  if (!ID.test(extId)) throw new Error(`확장 ID 모양이 아닙니다 (a~p 32글자): ${extId}`);
  return { origin: `chrome-extension://${extId}/`, id: extId, repo, name: name || path.basename(repo), from };
}

function insideRepo(repo) {
  const r = spawnSync(process.env.GIT_BIN || 'git', ['rev-parse', '--is-inside-work-tree'], { cwd: repo, windowsHide: true, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'true';
}

/** 호스트 매니페스트 — 표에 있는 주소만 이 다리를 부를 수 있다. */
export const manifestOf = (clients, bat = BAT) => ({
  name: HOST_NAME,
  description: 'KRS WORKSPACE - 다른 확장의 GitHub 받기 다리',
  path: bat,
  type: 'stdio',
  allowed_origins: Object.keys(clients).filter((o) => ORIGIN.test(o)),
});

const writeJson = (file, obj) => fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
const regRun = (args) => {
  const r = spawnSync('reg', args, { windowsHide: true, encoding: 'utf8' });
  return { ok: r.status === 0, err: String(r.stderr || r.error?.message || '').trim() };
};

/**
 * 표를 저장하고 그 표대로 매니페스트·레지스트리를 맞춘다. 표가 비면 등록을 걷는다(키와 매니페스트를 지운다).
 * @returns {{label: string, key: string, ok: boolean, err: string}[]} 레지스트리 키마다의 결과
 */
export function apply(clients, { file = CLIENTS_FILE, manifestFile = MANIFEST_FILE, bat = BAT, reg = regRun } = {}) {
  writeJson(file, clients);
  const origins = Object.keys(clients).filter((o) => ORIGIN.test(o));
  if (!origins.length) {
    fs.rmSync(manifestFile, { force: true });
    // 없는 키를 지우려 한 것은 실패가 아니다.
    return REG_KEYS.map(([label, key]) => ({ label, key, ...reg(['delete', key, '/f']), ok: true }));
  }
  writeJson(manifestFile, manifestOf(clients, bat));
  return REG_KEYS.map(([label, key]) => ({ label, key, ...reg(['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestFile, '/f']) }));
}

/** 같은 폴더가 다른 ID 로 적혀 있던 줄은 지운다(폴더를 다시 올려 ID 가 바뀐 것) — 한 폴더에 주소 하나. */
export function addClient(clients, c) {
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const rest = Object.fromEntries(Object.entries(clients).filter(([o, v]) => o !== c.origin && !(v && typeof v.repo === 'string' && same(v.repo, c.repo))));
  return { ...rest, [c.origin]: { name: c.name, repo: c.repo } };
}

/** 폴더나 확장 ID 로 한 줄을 찾아 뺀다. 못 찾으면 removed 가 비어 있다. */
export function removeClient(clients, what) {
  const w = String(what);
  const byId = ID.test(w) ? `chrome-extension://${w}/` : '';
  const dir = byId ? '' : path.resolve(w).toLowerCase();
  const removed = Object.keys(clients).filter((o) => (byId ? o === byId : typeof clients[o]?.repo === 'string' && path.resolve(clients[o].repo).toLowerCase() === dir));
  return { clients: Object.fromEntries(Object.entries(clients).filter(([o]) => !removed.includes(o))), removed };
}

const USAGE = `사용법:
  node native/gitclient-setup.mjs add <확장 폴더> [--id <확장 ID>] [--name <이름>]
  node native/gitclient-setup.mjs remove <확장 폴더 | 확장 ID>
  node native/gitclient-setup.mjs list`;

/** @returns {number} 끝내는 코드 */
export function main(argv, { out = console.log, ...io } = {}) {
  const [cmd, ...rest] = argv;
  const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? String(rest[i + 1] || '') : ''; };
  const target = rest.find((a, i) => !a.startsWith('--') && !['--id', '--name'].includes(rest[i - 1]));
  const clients = readClients(io.file || CLIENTS_FILE);
  const said = (rows) => rows.forEach((r) => out(`  ${r.label} : ${r.ok ? '등록' : `실패 — ${r.err}`}  ${r.key}`));

  if (cmd === 'list') {
    const rows = Object.entries(clients);
    if (!rows.length) out('등록된 확장이 없습니다.');
    rows.forEach(([origin, c]) => out(`${c?.name || '?'}  ${origin}  ${c?.repo || ''}`));
    return 0;
  }
  if (cmd === 'add' && target) {
    const c = resolveClient(target, { id: flag('--id'), name: flag('--name'), ...(io.inRepo ? { inRepo: io.inRepo } : {}) });
    const rows = apply(addClient(clients, c), io);
    out(`등록 완료 — ${c.name}`);
    out(`  폴더    : ${c.repo}`);
    out(`  확장 ID : ${c.id}${c.from === 'path' ? ' (폴더 경로로 셈 — chrome://extensions 의 ID 와 다르면 --id 로 다시)' : c.from === 'key' ? ' (manifest 의 key 로 셈)' : ''}`);
    said(rows);
    out('그 확장을 새로고침하면 됩니다. 다리를 찾지 못한다고 나오면 브라우저를 완전히 껐다 켜세요.');
    return rows.every((r) => r.ok) ? 0 : 1;
  }
  if (cmd === 'remove' && target) {
    const r = removeClient(clients, target);
    if (!r.removed.length) { out(`등록돼 있지 않습니다: ${target}`); return 1; }
    apply(r.clients, io);
    out(`등록 해제 — ${r.removed.join(', ')}${Object.keys(r.clients).length ? '' : ' (남은 확장이 없어 다리 등록도 걷었습니다)'}`);
    return 0;
  }
  out(USAGE);
  return cmd ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(String(e?.message || e));
    process.exitCode = 1;
  }
}
