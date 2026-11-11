import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { parentWindow, pressInput, press, SCRIPT, POWERSHELL } from '../native/ktxpress.mjs';

const token = 'e8a6932b-4d9c-43da-b89f-d45443e4cf19';
const input = (extra = {}) => ({ token, expiresAt: Date.now() + 9000, ...extra });
const read = `let raw='';for await(const part of process.stdin)raw+=part;const request=JSON.parse(raw);`;
function fixture(t, code) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krs-press-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const script = path.join(root, 'worker.mjs');
  fs.writeFileSync(script, code);
  return { root, script, executable: process.execPath, platform: 'win32', argv: ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/', '--parent-window=1234'],
    launch: (_exe, args, opts) => spawn(process.execPath, [args.at(-1)], opts) };
}

test('native reservation accepts only a fresh UUID marker, expiry and optional boolean probe', async () => {
  const now = 1800000000000;
  assert.deepEqual(pressInput({ token, expiresAt: now + 10000 }, now), { token, expiresAt: now + 10000, probe: false });
  assert.deepEqual(pressInput({ token, expiresAt: now + 1000, probe: true }, now), { token, expiresAt: now + 1000, probe: true });
  const bad = [null, [], { token }, { token, expiresAt: now }, { token, expiresAt: now + 10001 },
    { token: 'not-a-token', expiresAt: now + 1000 }, { token: token.toUpperCase(), expiresAt: now + 1000 },
    { token, expiresAt: now + 1000, probe: 'false' }, { token, expiresAt: now + 1000, windowHandle: 1 },
    { token, expiresAt: now + 1000, script: 'anything' }];
  for (const request of bad) {
    assert.equal((await press(request, { now: () => now, launch: () => assert.fail('invalid requests must not launch') })).code, 'INPUT_INVALID');
  }
});

test('the window comes only from one positive browser argv handle', async () => {
  assert.equal(parentWindow(['chrome-extension://example/', '--parent-window=393520']), '393520');
  for (const args of [[], ['--parent-window=0'], ['--parent-window=-1'], ['--parent-window=1.5'], ['--parent-window=1', '--parent-window=2'], ['--parent-window=9999999999999999']]) {
    assert.equal(parentWindow(args), null);
    assert.equal((await press(input(), { argv: args, launch: () => assert.fail('missing window must not launch') })).code, 'UIA_NO_WINDOW');
  }
});

test('the worker gets a fixed envelope and hidden shell-free execution without inherited secrets', async t => {
  const f = fixture(t, read + `
    if(JSON.stringify(Object.keys(request).sort())!==JSON.stringify(['expiresAt','parentPid','probe','token','windowHandle']))throw Error('bad envelope');
    if(request.windowHandle!=='1234'||request.parentPid!==${process.pid}||request.token!==${JSON.stringify(token)})throw Error('bad identity');
    if(process.env.KRS_PRESS_TEST_SECRET!==undefined)throw Error('environment leaked');
    console.log(JSON.stringify({ok:true,pressed:!request.probe}));`);
  process.env.KRS_PRESS_TEST_SECRET = 'fixture-secret';
  t.after(() => delete process.env.KRS_PRESS_TEST_SECRET);
  const original = f.launch;
  let launches = 0;
  f.launch = (exe, args, opts) => {
    launches++;
    assert.equal(opts.windowsHide, true);
    assert.equal(opts.shell, false);
    assert.equal(opts.detached, false);
    assert.equal(args.at(-1), f.script);
    return original(exe, args, opts);
  };
  assert.deepEqual(await press(input(), f), { ok: true, pressed: true });
  assert.deepEqual(await press(input({ probe: true }), f), { ok: true, pressed: false });
  assert.equal(launches, 2);
});

test('native reservation rejects malformed or ambiguous worker success and retains bounded failures', async t => {
  for (const output of ['not json', '{"ok":true}', '{"ok":true,"pressed":false}', '{"ok":1,"pressed":true}']) {
    assert.equal((await press(input(), fixture(t, read + `console.log(${JSON.stringify(output)});`))).code, 'UIA_PROTOCOL');
  }
  const result = await press(input(), fixture(t, read + `console.log(JSON.stringify({ok:false,code:'UIA_WRONG_DOCUMENT',error:'wrong document',private:'must not escape'}));`));
  assert.deepEqual(result, { ok: false, code: 'UIA_WRONG_DOCUMENT', error: 'wrong document' });
});

test('timeout waits for process exit and cannot leave a later click worker alive', async t => {
  const f = fixture(t, `import fs from 'node:fs';` + read + `
    fs.writeFileSync('pid',String(process.pid));
    setTimeout(()=>fs.writeFileSync('pressed','late'),2000);
    setInterval(()=>{},500);`);
  let launches = 0;
  const original = f.launch;
  f.launch = (...args) => { launches++; return original(...args); };
  const result = await press(input(), { ...f, timeoutMs: 700 });
  assert.equal(result.code, 'UIA_TIMEOUT');
  assert.equal(launches, 1);
  const pid = Number(fs.readFileSync(path.join(f.root, 'pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'return must follow the input worker exit');
  await delay(1600);
  assert.equal(fs.existsSync(path.join(f.root, 'pressed')), false);
});

test('oversized output terminates the worker once before returning', async t => {
  const f = fixture(t, `import fs from 'node:fs';` + read + `fs.writeFileSync('pid',String(process.pid));process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000);`);
  assert.equal((await press(input(), f)).code, 'UIA_PROTOCOL');
  assert.throws(() => process.kill(Number(fs.readFileSync(path.join(f.root, 'pid'), 'utf8')), 0), /ESRCH/);
});

test('real PowerShell helper compiles and rejects an invalid HWND without invoking any browser', { skip: process.platform !== 'win32' || !fs.existsSync(POWERSHELL) }, async () => {
  assert.deepEqual([...fs.readFileSync(SCRIPT).subarray(0, 3)], [0xef, 0xbb, 0xbf], 'PowerShell 5 must read Korean UIA labels as UTF-8');
  const result = await press(input(), { argv: ['--parent-window=1'] });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UIA_NO_WINDOW', JSON.stringify(result));
});

test('real helper rejects expired requests and dead parents before window inspection', { skip: process.platform !== 'win32' || !fs.existsSync(POWERSHELL) }, () => {
  for (const [request, expected] of [
    [{ ...input({ expiresAt: Date.now() - 1, probe: true }), windowHandle: '1', parentPid: process.pid }, 'UIA_EXPIRED'],
    [{ ...input({ probe: true }), windowHandle: '1', parentPid: 2147483647 }, 'UIA_PARENT_EXITED'],
  ]) {
    const result = spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-MTA', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
      { input: JSON.stringify(request), encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout.replace(/^\uFEFF/, '')).code, expected);
  }
});

test('real helper immediately refuses a concurrent reservation mutex without inspecting a browser', { skip: process.platform !== 'win32' || !fs.existsSync(POWERSHELL) }, async t => {
  const keeper = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command',
    '$m = New-Object System.Threading.Mutex($true, "Local\\KRS.KTX.ReservePress"); [Console]::Out.WriteLine("ready"); [Console]::Out.Flush(); $null = [Console]::In.ReadLine(); $m.ReleaseMutex(); $m.Dispose()'],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => keeper.once('close', resolve));
  t.after(async () => {
    keeper.stdin.end('\n');
    if (keeper.exitCode === null && keeper.signalCode === null) keeper.kill();
    await closed;
  });
  keeper.stderr.on('data', () => {});
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mutex fixture did not start')), 5000);
    keeper.once('error', error => { clearTimeout(timer); reject(error); });
    keeper.stdout.once('data', chunk => { clearTimeout(timer); assert.match(chunk.toString(), /ready/); resolve(); });
  });
  const result = await press(input({ probe: true }), { argv: ['--parent-window=1'] });
  assert.equal(result.code, 'UIA_BUSY', JSON.stringify(result));
});

test('launcher forwards the browser origin and parent HWND to entry', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t, '');
  const launcher = path.join(f.root, 'claude-bridge.bat');
  fs.copyFileSync(new URL('../native/claude-bridge.bat', import.meta.url), launcher);
  fs.writeFileSync(path.join(f.root, 'entry.mjs'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  // Fixed fixture paths and browser-shaped argv; no request text is shell code.
  const command = `& '${launcher.replaceAll("'", "''")}' 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/' '--parent-window=1234'`;
  const result = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/', '--parent-window=1234']);
});
