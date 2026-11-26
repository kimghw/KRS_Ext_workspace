// 조회 전용 Python 어댑터. 기존 Claude/OCR 브릿지 모듈은 불러오지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PYTHON = path.join(HERE, 'ktx-runtime', '.venv', 'Scripts', 'python.exe');
export const VENV_CONFIG = path.join(HERE, 'ktx-runtime', '.venv', 'pyvenv.cfg');
/**
 * The signed Python 3.12 that setup-ktx.ps1 built the venv from, as recorded in pyvenv.cfg (never from a request).
 * Launch this interpreter directly: Windows' venv redirector owns an outer kill-on-close Job Object that
 * would kill Chrome even after ParentWatch releases its own job on completion.
 */
export function basePython(config = VENV_CONFIG) {
  try {
    const home = fs.readFileSync(config, 'utf8').match(/^home\s*=\s*(.+?)\s*$/m)?.[1];
    return home && path.isAbsolute(home) ? path.join(home, 'python.exe') : null;
  } catch { return null; }
}
export const WORKER = path.join(HERE, 'ktx-python', 'worker.py');
export const STATE = path.join(HERE, 'ktx-runtime', 'state');
export const SEARCH_MS = 120_000;
export const OPEN_MS = 15_000;
const MAX_OUTPUT = 512 * 1024;
const SESSION = /^[0-9a-f]{32}$/;
const STATIONS = new Set(['수서', '서울', '용산', '영등포', '행신', '광명', '수원', '천안아산', '오송', '대전', '서대전', '김천구미', '서대구', '동대구', '경산', '밀양', '구포', '부산', '경주', '울산(통도사)', '포항', '마산', '창원중앙', '논산', '익산', '정읍', '광주송정', '목포', '전주', '순천', '여수EXPO', '강릉', '정동진']);
const fail = (code, error) => ({ ok: false, code, error });

export function searchInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('조회 조건이 없습니다.');
  const { from, to, date, hour, adults } = input;
  if (!STATIONS.has(from) || !STATIONS.has(to) || from === to) throw new Error('출발역·도착역을 확인해 주세요.');
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('출발일을 확인해 주세요.');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date) throw new Error('출발일을 확인해 주세요.');
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('출발 시각은 0~23시입니다.');
  if (!Number.isInteger(adults) || adults < 1 || adults > 9) throw new Error('어른 인원은 1~9명입니다.');
  return { from, to, date, hour, adults };
}

export function workerEnv() {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PATH']) {
    if (process.env[key] != null) env[key] = process.env[key];
  }
  return env;
}

// Overrides are for local tests only; extension requests never supply them.
export async function invoke(request, { python = PYTHON, worker = WORKER, stateDir = STATE, launch = spawn,
  timeoutMs = SEARCH_MS, maxOutput = MAX_OUTPUT } = {}) {
  const executable = python === PYTHON ? basePython() : python;
  if (!fs.existsSync(python) || !executable || !fs.existsSync(executable) || !fs.existsSync(worker)) return fail('RUNTIME_MISSING', 'KTX 실행 환경이 없습니다. native/setup-ktx.ps1을 실행해 주세요.');
  const env = workerEnv();
  // CPython's own redirector uses this value to select the venv even with -I.
  // It is fixed by the host, never copied from the caller's environment/request.
  if (python === PYTHON) env.__PYVENV_LAUNCHER__ = PYTHON;
  try { fs.mkdirSync(stateDir, { recursive: true }); }
  catch { return fail('RUNTIME_FAILED', 'KTX 작업 폴더를 준비하지 못했습니다.'); }
  return new Promise((resolve, reject) => {
    let child, timer, settled = false, stopping = false, closed = false, bytes = 0;
    const chunks = [];
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const stop = async result => {
      if (settled || stopping) return;
      stopping = true;
      clearTimeout(timer);
      // A child can exit before inherited pipe handles close. Do not taskkill a
      // PID after Node has observed its exit; Windows may already have reused it.
      if (!closed && child?.pid && child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') {
          await new Promise(done => {
            const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
              ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
            const limit = setTimeout(() => { killer.kill(); done(); }, 3000);
            const ended = () => { clearTimeout(limit); done(); };
            killer.once('error', ended);
            killer.once('close', ended);
          });
        } else {
          try { child.kill('SIGKILL'); } catch { }
        }
      }
      if (!closed) await new Promise(done => {
        const limit = setTimeout(done, 3000);
        child.once('close', () => { clearTimeout(limit); done(); });
      });
      if (!closed) {
        // No response while a worker may still submit. The entry exits, which
        // signals the worker's stable parent HANDLE and kills its owned job.
        settled = true;
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
        reject(Object.assign(new Error('KTX 실행부 종료를 확인하지 못했습니다.'), { terminateHost: true }));
        return;
      }
      finish(result);
    };
    try {
      child = launch(executable, ['-I', '-X', 'utf8', '-u', worker], {
        // libuv puts non-detached Windows children in another kill-on-close job.
        // ParentWatch owns active-request cancellation; allow the handed-off
        // Chrome to outlive this host too. Keep pipes/ref until worker closure.
        cwd: stateDir, env, detached: process.platform === 'win32', windowsHide: true, shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch { return finish(fail('WORKER_FAILED', 'KTX 실행부를 시작하지 못했습니다.')); }
    timer = setTimeout(() => { void stop(fail('WORKER_TIMEOUT', 'KTX 요청 시간이 초과되었습니다. 자동으로 재시도하지 않습니다.')); }, timeoutMs);
    child.stdout.on('data', chunk => {
      if (stopping) return;
      bytes += chunk.length;
      if (bytes > maxOutput) { void stop(fail('WORKER_PROTOCOL', 'KTX 실행부 응답이 너무 큽니다.')); return; }
      chunks.push(Buffer.from(chunk));
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.once('error', () => finish(fail('WORKER_FAILED', 'KTX 실행부를 시작하지 못했습니다.')));
    child.once('close', code => {
      closed = true;
      if (settled || stopping) return;
      let result;
      try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return finish(fail('WORKER_PROTOCOL', 'KTX 실행부의 응답을 읽지 못했습니다.')); }
      if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') return finish(fail('WORKER_PROTOCOL', 'KTX 실행부의 응답 형식이 올바르지 않습니다.'));
      if (!result.ok) return finish(fail(String(result.code || 'WORKER_FAILED').slice(0, 80), String(result.error || 'KTX 조회에 실패했습니다.').slice(0, 1200)));
      if (code !== 0) return finish(fail('WORKER_FAILED', 'KTX 실행부가 정상적으로 끝나지 않았습니다.'));
      if (request.op === 'search') {
        if (!Array.isArray(result.rows) || result.rows.length > 100 || typeof result.session !== 'string' || !SESSION.test(result.session)) return finish(fail('WORKER_PROTOCOL', 'KTX 조회 결과 형식이 올바르지 않습니다.'));
        return finish({ ok: true, rows: result.rows, session: result.session });
      }
      finish({ ok: true });
    });
    const field = request.op === 'search' ? 'input' : 'session';
    child.stdin.end(JSON.stringify({ op: request.op, [field]: request[field], stateDir, parentPid: process.pid }) + '\n');
  });
}

export async function search(input, opts) {
  let normalized;
  try { normalized = searchInput(input); } catch (error) { return fail('INPUT_INVALID', error.message); }
  return invoke({ op: 'search', input: normalized }, opts);
}

export async function open(session, opts) {
  if (typeof session !== 'string' || !SESSION.test(session)) return fail('INPUT_INVALID', '조회 결과가 없습니다. 먼저 KTX를 조회해 주세요.');
  return invoke({ op: 'open', session }, { timeoutMs: OPEN_MS, ...opts });
}
