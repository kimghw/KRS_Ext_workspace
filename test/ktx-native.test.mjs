import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { invoke, search, open, searchInput, workerEnv, PYTHON } from '../native/ktx.mjs';

const input = { from: '부산', to: '서울', date: '2026-11-12', hour: 8, adults: 1 };
const session = 'a'.repeat(32);
function fixture(t, code, python = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krs-ktx-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
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

test('Windows venv timeout waits for worker and descendant exit', { skip: process.platform !== 'win32' || !fs.existsSync(PYTHON) }, async t => {
  const opts = fixture(t, `import sys,json,time,subprocess,os\nr=json.load(sys.stdin)\np=subprocess.Popen([sys.executable,'-I','-c','import time;time.sleep(30)'],creationflags=subprocess.CREATE_NO_WINDOW)\nopen(os.path.join(r['stateDir'],'pids'),'w').write(str(os.getpid())+','+str(p.pid))\ntime.sleep(30)\n`, true);
  assert.equal((await open(session, { ...opts, timeoutMs: 1000 })).code, 'WORKER_TIMEOUT');
  for (const pid of fs.readFileSync(path.join(opts.stateDir, 'pids'), 'utf8').split(',').map(Number)) {
    assert.throws(() => process.kill(pid, 0), /ESRCH/, 'response must follow process exit');
  }
});
