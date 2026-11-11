import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRouter, frame, MAX_INPUT } from '../native/entry.mjs';

const ENTRY = fileURLToPath(new URL('../native/entry.mjs', import.meta.url));
function fixture(t, modules) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'krs-entry-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entry = path.join(root, 'entry.mjs');
  fs.copyFileSync(ENTRY, entry);
  for (const [name, source] of Object.entries(modules)) fs.writeFileSync(path.join(root, name), source);
  return entry;
}
function call(entry, data, fragmented = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [], logs = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error('fixture timed out')); }, 5000);
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => logs.push(chunk));
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks), messages = [];
      let offset = 0;
      while (offset < raw.length) {
        const size = raw.readUInt32LE(offset);
        messages.push(JSON.parse(raw.subarray(offset + 4, offset + 4 + size).toString('utf8')));
        offset += 4 + size;
      }
      assert.equal(offset, raw.length);
      resolve({ code, messages, stderr: Buffer.concat(logs).toString('utf8') });
    });
    if (fragmented) {
      let offset = 0;
      const send = () => { if (offset === data.length) child.stdin.end(); else { child.stdin.write(data.subarray(offset, ++offset)); setImmediate(send); } };
      send();
    } else child.stdin.end(data);
  });
}

test('KTX route works without legacy host, fragmented Korean frame and stdout noise', async t => {
  const entry = fixture(t, { 'ktx.mjs': `console.log('ktx module log');export async function search(input){console.log('worker log');return {ok:true,input};}export async function open(session){return {ok:true,session};}` });
  const result = await call(entry, frame({ task: 'ktxSearch', input: { from: '부산', to: '서울' } }), true);
  assert.deepEqual(result.messages, [{ ok: true, input: { from: '부산', to: '서울' } }]);
  assert.match(result.stderr, /ktx module log/);
  assert.match(result.stderr, /worker log/);
});

test('legacy ping works without KTX module and retains existing response', async t => {
  const entry = fixture(t, { 'host.mjs': `export function pruneLogs(){console.log('prune');}export function pruneTempDebug(){}export async function handle(m){return {ok:true,pong:true,help:true};}` });
  const result = await call(entry, frame({ task: 'ping' }));
  assert.deepEqual(result.messages, [{ ok: true, pong: true, help: true }]);
  assert.match(result.stderr, /prune/);
});

test('reservation press routes without loading search or legacy modules', async t => {
  const entry = fixture(t, { 'ktxpress.mjs': 'export async function press(input){return {ok:true,pressed:false,input};}' });
  const input = { token: 'fixture', expiresAt: 123, probe: true };
  const result = await call(entry, frame({ task: 'ktxReservePress', input }));
  assert.deepEqual(result.messages, [{ ok: true, pressed: false, input }]);
});

test('router loads each branch lazily and prunes legacy once', async () => {
  let trains = 0, hosts = 0, prunes = 0;
  const route = createRouter({ loadKtx: async () => { trains++; return { search: x => x, open: x => x }; },
    loadLegacy: async () => { hosts++; return { pruneLogs: () => prunes++, pruneTempDebug: () => prunes++, handle: x => x }; } });
  assert.equal(await route({ task: 'ktxOpen', session: 'token' }), 'token');
  assert.equal(hosts, 0);
  await route({ task: 'ping' }); await route({ task: 'logs' });
  assert.equal(trains, 1); assert.equal(hosts, 1); assert.equal(prunes, 2);
});

test('large existing attachment requests remain supported', async t => {
  const entry = fixture(t, { 'host.mjs': `export async function handle(m){return {ok:true,length:m.input.length};}` });
  const result = await call(entry, frame({ task: 'receipt', input: 'x'.repeat(100000) }));
  assert.equal(result.messages[0].length, 100000);
  assert.equal(MAX_INPUT, 64 * 1024 * 1024);
});

test('multiple frames retain reply order and malformed frame is explicit', async t => {
  const entry = fixture(t, { 'host.mjs': `export async function handle(m){await new Promise(r=>setTimeout(r,m.delay));return {ok:true,id:m.id};}` });
  const result = await call(entry, Buffer.concat([frame({ id: 1, delay: 30 }), frame({ id: 2, delay: 0 })]));
  assert.deepEqual(result.messages.map(m => m.id), [1, 2]);
  const bad = Buffer.alloc(4); bad.writeUInt32LE(MAX_INPUT + 1);
  assert.equal((await call(entry, bad)).messages[0].code, 'FRAME_PROTOCOL');
});

test('importing entry does not start native input or change stdout', async () => {
  const code = `const write=process.stdout.write;const before=process.stdin.listenerCount('data');await import(${JSON.stringify(new URL('../native/entry.mjs', import.meta.url).href)});if(write!==process.stdout.write||before!==process.stdin.listenerCount('data'))process.exit(2);process.stdout.write('clean');`;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true });
    let out = ''; child.stdout.on('data', x => out += x); child.on('error', reject); child.on('close', status => resolve({ status, out }));
  });
  assert.deepEqual(result, { status: 0, out: 'clean' });
});
