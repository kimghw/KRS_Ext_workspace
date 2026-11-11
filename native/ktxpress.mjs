// The validated page marks one reservation button. Only Windows UIA presses it;
// browser/window handles and execution paths never come from extension input.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SCRIPT = fileURLToPath(new URL('./ktxpress.ps1', import.meta.url));
export const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
export const PRESS_MS = 10_000;
const MAX_OUTPUT = 64 * 1024;
const fail = (code, error) => ({ ok: false, code, error });

export function parentWindow(argv = process.argv.slice(2)) {
  const handles = argv.filter((arg) => typeof arg === 'string' && arg.startsWith('--parent-window='));
  if (handles.length !== 1 || !/^--parent-window=[1-9]\d{0,15}$/.test(handles[0])) return null;
  const value = handles[0].slice('--parent-window='.length);
  return BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER) ? value : null;
}

export function pressInput(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['token', 'expiresAt', 'probe'].includes(key))
    || typeof input.token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.token)
    || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now || input.expiresAt > now + PRESS_MS
    || (input.probe !== undefined && typeof input.probe !== 'boolean')) throw new Error('예매 요청의 표식이나 유효시간이 올바르지 않습니다.');
  return { token: input.token, expiresAt: input.expiresAt, probe: input.probe === true };
}

// Overrides are local-test dependencies, never request fields.
export async function press(input, { argv = process.argv.slice(2), launch = spawn, executable = POWERSHELL,
  script = SCRIPT, now = Date.now, platform = process.platform, timeoutMs = PRESS_MS, maxOutput = MAX_OUTPUT } = {}) {
  let request;
  try { request = pressInput(input, now()); } catch (error) { return fail('INPUT_INVALID', error.message); }
  const windowHandle = parentWindow(argv);
  if (!windowHandle) return fail('UIA_NO_WINDOW', '예매할 브라우저 창을 확인하지 못했습니다. 같은 창의 사이드 패널에서 다시 진행해 주세요.');
  if (platform !== 'win32') return fail('WINDOWS_REQUIRED', '이 예매 입력 기능은 Windows에서 사용할 수 있습니다.');
  if (!fs.existsSync(executable) || !fs.existsSync(script)) return fail('UIA_RUNTIME_MISSING', '예매 입력 실행부를 찾지 못했습니다. 확장 폴더의 native 파일을 확인해 주세요.');
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return new Promise((resolve, reject) => {
    let child, timer, killTimer, settled = false, stopping = false, exited = false, bytes = 0;
    const chunks = [];
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(killTimer);
      resolve(result);
    };
    let stoppedResult;
    const stop = (result) => {
      if (settled || stopping) return;
      stopping = true;
      stoppedResult = result;
      clearTimeout(timer);
      if (exited) return finish(result);
      // This worker has no browser children. Wait for its actual exit before
      // returning a timeout; an overdue UIA worker must not press later.
      try { child.kill('SIGKILL'); } catch { }
      killTimer = setTimeout(() => {
        if (settled || exited) return;
        settled = true;
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
        // The entry must exit, closing Node's Windows child job. Never report a
        // retryable failure while an input worker may remain alive.
        reject(Object.assign(new Error('예매 입력 실행부 종료를 확인하지 못했습니다.'), { terminateHost: true }));
      }, 3000);
    };
    try {
      child = launch(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-MTA', '-ExecutionPolicy', 'Bypass', '-File', script], {
        cwd: path.dirname(script), env, windowsHide: true, shell: false, detached: false, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch { return finish(fail('UIA_WORKER_FAILED', '예매 입력 실행부를 시작하지 못했습니다.')); }
    timer = setTimeout(() => stop(fail('UIA_TIMEOUT', '예매 입력 시간이 초과되었습니다. 자동으로 재시도하지 않습니다. 코레일 예약내역을 확인해 주세요.')),
      Math.max(1, Math.min(timeoutMs, request.expiresAt - now())));
    child.stdout.on('data', (chunk) => {
      if (stopping) return;
      bytes += chunk.length;
      if (bytes > maxOutput) return stop(fail('UIA_PROTOCOL', '예매 입력 실행부의 응답이 너무 큽니다.'));
      chunks.push(Buffer.from(chunk));
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.once('error', () => {
      const failure = fail('UIA_WORKER_FAILED', '예매 입력 실행부를 시작하지 못했습니다.');
      if (child.pid && !exited) stop(failure);
      else finish(failure);
    });
    child.once('exit', () => { exited = true; if (stopping) finish(stoppedResult); });
    child.once('close', (code) => {
      exited = true;
      if (settled) return;
      if (stopping) return finish(stoppedResult);
      let result;
      try { result = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); }
      catch { return finish(fail('UIA_PROTOCOL', '예매 입력 실행부의 응답을 확인하지 못했습니다. 예약내역을 먼저 확인해 주세요.')); }
      if (result?.ok === false) return finish(fail(String(result.code || 'UIA_FAILED').slice(0, 80), String(result.error || '예매를 누르지 못했습니다.').slice(0, 1200)));
      if (code !== 0 || result?.ok !== true || result.pressed !== !request.probe) return finish(fail('UIA_PROTOCOL', '예매 입력 결과를 확인하지 못했습니다. 예약내역을 먼저 확인해 주세요.'));
      finish({ ok: true, pressed: result.pressed });
    });
    child.stdin.end(JSON.stringify({ ...request, windowHandle, parentPid: process.pid }) + '\n');
  });
}
