// CDP 크롬 띄우기 — 127.0.0.1:9333(CDP_PORT)이 답하지 않으면 디버그 포트를 연 크롬을 띄우고 답할 때까지 기다린다
// (2026-10-30 사용자 지정: "helpchat 에서 cdp 가 없는 경우 cdp 9333 포트 생성해서 작업하도록 해줘").
//
//   node test/cdp/ensure.mjs      떠 있으면 그대로, 없으면 띄운다. 끝에 e-Class 로그인 형편을 한 줄로 적는다(띄우지 못하면 exit 1).
//
// 프로필(--user-data-dir)은 KRS_CDP_PROFILE, 없으면 있는 것 가운데 첫째:
//   E:\Chrome-9333 — 바탕화면 「거화 - Chrome」 바로가기와 같은 것(2026-10-29 평소 크롬의 거화 프로필을 복사해 둔 것),
//   E:\dev\krs-web-agents\chrome_profile\KRS — krs-web-agents 러너의 9333 프로필.
//   둘 다 없으면 %LOCALAPPDATA%\KRS-WORKSPACE\chrome-9333(새 프로필 — 로그인부터).
// 크롬 136+ 는 기본 프로필(User Data)에 디버그 포트를 붙이지 않는다 — 그래서 따로 둔 프로필이다(README 「실제 크롬·엣지에서 (CDP)」).
// 띄운 창은 e-Class 홈을 연다. 로그인 화면이면 사람이 그 창에서 로그인해야 한다 — 여기서는 비밀번호를 넣지 않는다.
// Help Chat(native/helprules.md)은 실서버를 읽기 전에 이것을 부른다 — 헤드리스 claude 는 node 만 띄울 수 있어 크롬을 바로 띄우지 못한다.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT } from './cdp.mjs';

/** 띄운 창이 여는 곳 — 로그인이 풀렸으면 로그인 화면으로 간다. */
export const HOME = 'https://eclass.krs.co.kr/eClassVer4/Home/Index';
const PROFILES = ['E:\\Chrome-9333', 'E:\\dev\\krs-web-agents\\chrome_profile\\KRS'];
const START_MS = 25000;
/** 띄운 뒤 e-Class 탭이 홈이나 로그인 화면에 닿기를 기다리는 동안. */
const SETTLE_MS = 12000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 쓸 프로필 폴더. */
export function profileOf({ env = process.env, exists = fs.existsSync } = {}) {
  if (env.KRS_CDP_PROFILE) return env.KRS_CDP_PROFILE;
  return PROFILES.find((p) => exists(p)) || path.join(env.LOCALAPPDATA || '.', 'KRS-WORKSPACE', 'chrome-9333');
}

/** 크롬 실행 파일 — KRS_CHROME_PATH, 아니면 흔한 자리 가운데 있는 것. */
export function chromeOf({ env = process.env, exists = fs.existsSync } = {}) {
  if (env.KRS_CHROME_PATH) return env.KRS_CHROME_PATH;
  const at = [env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', env.LOCALAPPDATA || '']
    .filter(Boolean).map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return at.find((p) => exists(p)) || at[0];
}

/** 바로가기 「거화 - Chrome」과 같은 인자 + 디버그 포트 + e-Class 홈. */
export const launchArgs = (profile, port = PORT) => [`--user-data-dir=${profile}`, '--profile-directory=Default', `--remote-debugging-port=${port}`, HOME];

async function json(fetchImpl, url) {
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(3000) });
  return r.json();
}

/** e-Class 로그인 형편 — 탭들의 주소로 본다: 로그인 화면이 있으면 'out', e-Class 탭이 있으면 'in', 없으면 'unknown'. */
export async function loginState({ port = PORT, fetchImpl = fetch } = {}) {
  const list = await json(fetchImpl, `http://127.0.0.1:${port}/json/list`).catch(() => []);
  const pages = (Array.isArray(list) ? list : []).filter((t) => t.type === 'page' && /^https:\/\/eclass\.krs\.co\.kr\//i.test(t.url || ''));
  if (pages.some((t) => /\/Account\/Log(in|out)/i.test(t.url))) return 'out';
  return pages.length ? 'in' : 'unknown';
}

/**
 * 9333 이 답하면 그대로, 아니면 크롬을 떼어 띄우고(이 프로세스가 끝나도 산다) 답할 때까지.
 * @returns {Promise<{ok: boolean, started: boolean, browser?: string, profile?: string, login?: 'in'|'out'|'unknown', error?: string}>}
 */
export async function ensureChrome({ port = PORT, fetchImpl = fetch, spawnImpl = spawn, env = process.env, exists = fs.existsSync, wait = sleep, now = Date.now } = {}) {
  const version = () => json(fetchImpl, `http://127.0.0.1:${port}/json/version`).then((v) => v?.Browser || 'Chrome', () => '');
  const up = await version();
  if (up) return { ok: true, started: false, browser: up, login: await loginState({ port, fetchImpl }) };
  const profile = profileOf({ env, exists });
  const chrome = chromeOf({ env, exists });
  try {
    const child = spawnImpl(chrome, launchArgs(profile, port), { detached: true, stdio: 'ignore', windowsHide: false });
    child?.on?.('error', () => {});
    child?.unref?.();
  } catch (err) {
    return { ok: false, started: false, profile, error: `크롬을 띄우지 못했습니다 — ${err.message}` };
  }
  const t0 = now();
  let browser = '';
  while (!browser && now() - t0 < START_MS) { await wait(500); browser = await version(); }
  if (!browser) {
    return { ok: false, started: true, profile, error: `${START_MS / 1000}초 안에 ${port} 이 답하지 않습니다 — 그 프로필의 크롬이 디버그 포트 없이 떠 있거나 다른 프로그램이 ${port} 을 씁니다` };
  }
  let login = 'unknown';
  for (const t1 = now(); login === 'unknown' && now() - t1 < SETTLE_MS; ) { await wait(500); login = await loginState({ port, fetchImpl }); }
  return { ok: true, started: true, browser, profile, login };
}

const LOGIN_TEXT = { in: 'e-Class 로그인됨', out: 'e-Class 로그인 필요 — 그 크롬 창에서 사람이 로그인해야 합니다', unknown: 'e-Class 탭이 없어 로그인 형편은 모릅니다(홈을 열어 보세요)' };

/** 한 줄 알림. */
export function describe(r, port = PORT) {
  if (!r.ok) return `${port} 크롬을 띄우지 못했습니다 — ${r.error}`;
  return `${r.started ? `${port} 크롬을 띄웠습니다(프로필 ${r.profile})` : `${port} 크롬이 떠 있습니다`} · ${r.browser} · ${LOGIN_TEXT[r.login] || LOGIN_TEXT.unknown}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await ensureChrome();
  console.log(describe(r));
  process.exitCode = r.ok ? 0 : 1;
}
