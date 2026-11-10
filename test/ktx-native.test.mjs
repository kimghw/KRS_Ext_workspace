import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { invoke, search, open, searchInput, workerEnv, basePython, PYTHON } from '../native/ktx.mjs';

const input = { from: '부산', to: '서울', date: '2026-11-12', hour: 8, adults: 1 };
const session = 'a'.repeat(32);
const nativePython = fileURLToPath(new URL('../native/ktx-python', import.meta.url));
const hasPython = process.platform === 'win32' && fs.existsSync(PYTHON) && !!basePython() && fs.existsSync(basePython());
function fixture(t, code, python = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krs-ktx-test-'));
  // 죽인 워커(python)가 상태 폴더의 잠금을 놓기 전에 지우면 Windows 가 EBUSY 를 낸다(전체 스위트를 나란히 돌릴 때 가끔, 2026-11-08) — 잠깐씩 다시 해 본다.
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const worker = path.join(root, python ? 'worker.py' : 'worker.mjs');
  fs.writeFileSync(worker, code);
  return { root, worker, stateDir: path.join(root, 'state'), python: python ? PYTHON : process.execPath,
    ...(python ? {} : { launch: (_exe, args, opts) => spawn(process.execPath, [args.at(-1)], opts) }) };
}
const read = `let raw='';for await(const chunk of process.stdin)raw+=chunk;const request=JSON.parse(raw);`;

test('search normalization strips execution fields and rejects bad input without launch', async () => {
  assert.deepEqual(searchInput({ ...input, python: 'bad', stateDir: 'bad' }), input);
  for (const bad of [{ ...input, hour: true }, { ...input, date: '2026-02-30' }, { ...input, from: '없는역' }, { ...input, adults: 0 }]) {
    assert.equal((await search(bad, { launch: () => assert.fail('must not launch') })).code, 'INPUT_INVALID');
  }
  assert.equal((await open('../bad')).code, 'INPUT_INVALID');
});

test('fixed envelope and allowlisted environment reach worker', async t => {
  const opts = fixture(t, read + `console.log(JSON.stringify({ok:true,rows:[{request,cwd:process.cwd(),secret:process.env.KRS_PRIVATE_TEST??null}],session:'${session}'}));`);
  process.env.KRS_PRIVATE_TEST = 'secret';
  t.after(() => delete process.env.KRS_PRIVATE_TEST);
  assert.equal(workerEnv().KRS_PRIVATE_TEST, undefined);
  const result = await invoke({ op: 'search', input, stateDir: 'bad', parentPid: 0, python: 'bad' }, opts);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows[0].request, { op: 'search', input, stateDir: opts.stateDir, parentPid: process.pid });
  assert.equal(result.rows[0].cwd, opts.stateDir);
  assert.equal(result.rows[0].secret, null);
});

test('missing runtime gives actionable error without spawning', async () => {
  const result = await invoke({ op: 'open', session }, { python: 'Z:/absent/python.exe', launch: () => assert.fail('must not launch') });
  assert.equal(result.code, 'RUNTIME_MISSING');
});

test('installer builds from a signed system Python and never downloads one', () => {
  const setup = fs.readFileSync(new URL('../native/setup-ktx.ps1', import.meta.url), 'utf8');
  assert.match(setup, /Get-AuthenticodeSignature/);
  assert.match(setup, /--no-managed-python --python \$ktxSystemPython/);
  assert.match(setup, /UV_PYTHON_DOWNLOADS = 'never'/);
  assert.doesNotMatch(setup, /python install/);
  assert.match(setup, /\$ktxPythonMinor = '3\.12'/);
  const project = fs.readFileSync(new URL('../native/ktx-python/pyproject.toml', import.meta.url), 'utf8');
  assert.match(project, /requires-python = ">=3\.12,<3\.13"/);
});

test('the base interpreter comes only from the venv record', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krs-ktx-cfg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cfg = path.join(dir, 'pyvenv.cfg');
  fs.writeFileSync(cfg, 'home = C:\\Python312\r\nversion_info = 3.12.10\r\n');
  assert.equal(basePython(cfg), path.join('C:\\Python312', 'python.exe'));
  fs.writeFileSync(cfg, 'home = relative\\path\n');
  assert.equal(basePython(cfg), null);
  fs.writeFileSync(cfg, 'version_info = 3.12.10\n');
  assert.equal(basePython(cfg), null);
  assert.equal(basePython(path.join(dir, 'absent.cfg')), null);
});

test('worker guard failure is preserved once, without session or diagnostic data', async t => {
  const opts = fixture(t, read + `console.log(JSON.stringify({ok:false,error:'차단',code:'-8202',session:'${session}',debug:'private'}));`);
  assert.deepEqual(await open(session, opts), { ok: false, error: '차단', code: '-8202' });
});

test('malformed worker output and invalid success are rejected', async t => {
  for (const body of [`console.log('not json')`, `console.log('{"ok":true}')`, `console.log('{"ok":1}')`]) {
    assert.equal((await search(input, fixture(t, read + body))).code, 'WORKER_PROTOCOL');
  }
});

test('stderr is drained independently from one JSON response', async t => {
  const opts = fixture(t, read + `process.stderr.write('log'.repeat(700000));console.log('{"ok":true}');`);
  assert.deepEqual(await open(session, opts), { ok: true });
});

test('stdout overflow kills worker before returning and never retries', async t => {
  const opts = fixture(t, read + `process.stdout.write('x'.repeat(600000));setInterval(()=>{},1000);`);
  let launches = 0;
  const original = opts.launch;
  opts.launch = (...args) => { launches++; return original(...args); };
  assert.equal((await open(session, opts)).code, 'WORKER_PROTOCOL');
  assert.equal(launches, 1);
});

test('Windows managed interpreter preserves the venv and ignores inherited launcher overrides', { skip: !hasPython }, async t => {
  const opts = fixture(t, `import sys,json,importlib.metadata\nr=json.load(sys.stdin)\nprint(json.dumps({'ok':True,'rows':[{'prefix':sys.prefix,'executable':sys.executable,'library':importlib.metadata.version('rebrowser-playwright')}],'session':'${session}'}))\n`, true);
  const previous = process.env.__PYVENV_LAUNCHER__;
  process.env.__PYVENV_LAUNCHER__ = 'Z:/untrusted/python.exe';
  t.after(() => {
    if (previous === undefined) delete process.env.__PYVENV_LAUNCHER__;
    else process.env.__PYVENV_LAUNCHER__ = previous;
  });
  const result = await search(input, opts);
  assert.equal(result.ok, true);
  assert.equal(path.resolve(result.rows[0].prefix), path.dirname(path.dirname(PYTHON)));
  assert.equal(path.resolve(result.rows[0].executable), PYTHON);
  assert.match(result.rows[0].library, /^\d+\.\d+/);
});

for (const rejected of [false, true]) {
  test(`Windows child remains usable after host exit following ${rejected ? 'handled site rejection' : 'normal completion'}`, { skip: !hasPython }, async t => {
    // The child waits for a request made only after BOTH worker and one-shot
    // native host exit. Checking only worker exit misses libuv's outer job.
    const child = `import pathlib,sys,time\nroot=pathlib.Path(sys.argv[1])\nend=time.monotonic()+5\nwhile time.monotonic()<end:\n if (root/'probe').exists():\n  (root/'reply').write_text('alive')\n  break\n time.sleep(0.02)\n`;
    const opts = fixture(t, `import sys,json,subprocess\nsys.path.insert(0,${JSON.stringify(nativePython)})\nfrom lifecycle import ParentWatch\nr=json.load(sys.stdin)\nwith ParentWatch(r['parentPid']):\n p=subprocess.Popen([sys._base_executable,'-I','-c',${JSON.stringify(child)},r['stateDir']],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)\n result={'ok':${rejected ? 'False' : 'True'},'code':'GUARD_BLOCKED','error':'차단'}\nprint(json.dumps(result))\n`, true);
    const host = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {open} from ${JSON.stringify(new URL('../native/ktx.mjs', import.meta.url).href)};
       console.log(JSON.stringify(await open(${JSON.stringify(session)}, ${JSON.stringify(opts)})));`],
    { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.equal(host.status, 0, host.stderr);
    const result = JSON.parse(host.stdout);
    assert.equal(result.ok, !rejected);
    if (rejected) assert.equal(result.code, 'GUARD_BLOCKED');
    fs.writeFileSync(path.join(opts.stateDir, 'probe'), 'ping');
    const deadline = Date.now() + 2000;
    while (!fs.existsSync(path.join(opts.stateDir, 'reply')) && Date.now() < deadline) await delay(20);
    assert.equal(fs.readFileSync(path.join(opts.stateDir, 'reply'), 'utf8'), 'alive');
    await delay(100); // Let the child close its current directory before fixture cleanup.
  });
}

test('Windows managed interpreter timeout waits for worker and descendant exit', { skip: !hasPython }, async t => {
  const opts = fixture(t, `import sys,json,time,subprocess,os\nr=json.load(sys.stdin)\np=subprocess.Popen([sys.executable,'-I','-c','import time;time.sleep(30)'],creationflags=subprocess.CREATE_NO_WINDOW)\nopen(os.path.join(r['stateDir'],'pids'),'w').write(str(os.getpid())+','+str(p.pid))\ntime.sleep(30)\n`, true);
  assert.equal((await open(session, { ...opts, timeoutMs: 1000 })).code, 'WORKER_TIMEOUT');
  for (const pid of fs.readFileSync(path.join(opts.stateDir, 'pids'), 'utf8').split(',').map(Number)) {
    assert.throws(() => process.kill(pid, 0), /ESRCH/, 'response must follow process exit');
  }
});

test('Windows host death still cancels detached active worker and its child', { skip: !hasPython }, async t => {
  const opts = fixture(t, `import sys,json,subprocess,os,time\nsys.path.insert(0,${JSON.stringify(nativePython)})\nfrom lifecycle import ParentWatch\nr=json.load(sys.stdin)\nwith ParentWatch(r['parentPid']):\n p=subprocess.Popen([sys._base_executable,'-I','-c','import time;time.sleep(30)'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)\n with open(os.path.join(r['stateDir'],'pids'),'w') as f: f.write(str(os.getpid())+','+str(p.pid))\n time.sleep(30)\n`, true);
  const host = spawn(process.execPath, ['--input-type=module', '-e',
    `import {open} from ${JSON.stringify(new URL('../native/ktx.mjs', import.meta.url).href)};
     await open(${JSON.stringify(session)}, ${JSON.stringify(opts)});`],
  { windowsHide: true, stdio: 'ignore' });
  const closed = once(host, 'close');
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    const pathPids = path.join(opts.stateDir, 'pids');
    const ready = Date.now() + 5000;
    while (!fs.existsSync(pathPids) && Date.now() < ready) await delay(20);
    const pids = fs.readFileSync(pathPids, 'utf8').split(',').map(Number);
    assert.equal(pids.length, 2);
    assert.ok(pids.every(pid => Number.isInteger(pid) && pid > 0 && alive(pid)));
    host.kill();
    await closed;
    const deadline = Date.now() + 3000;
    while (pids.some(alive) && Date.now() < deadline) await delay(20);
    assert.ok(pids.every(pid => !alive(pid)), 'parent HANDLE cancellation must remain effective after detaching');
  } finally {
    if (host.exitCode === null && host.signalCode === null) host.kill();
    await closed;
  }
});
