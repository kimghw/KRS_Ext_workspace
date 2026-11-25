// 다른 확장의 폴더(git 저장소)를 GitHub 과 맞춰 보는 다리 — 이 확장의 받기(gitsync.mjs)를 다른 확장(ubob 등)이 빌려 쓴다.
// 2026-11-13 사용자 지정(ubob 에서): "workspace 브릿지에 파일 받기 사용할 수 있게 하고".
//
// 네이티브 호스트 이름이 따로다(com.krs.gitsync — gitclient-bridge.bat 이 이 파일을 띄운다). 이 다리가 아는 작업은
// ping·gitStatus·gitPull 셋뿐이라, 여기에 등록된 확장은 본래 다리(com.krs.meetingroom)의 Claude·Help Chat·KTX 를 부를 수 없다.
// 어느 저장소를 볼지도 확장이 정하지 못한다 — 브라우저가 다리를 띄울 때 넘기는 부른 쪽 주소(chrome-extension://<ID>/)로
// 이 PC 의 등록 표(gitclients.json — gitclient-setup.mjs 가 쓴다)에서 찾는다. 확장이 git 에 넘기는 값은 여기서도 없다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGit, gitStatus, gitPull } from './gitsync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HOST_NAME = 'com.krs.gitsync';
/** 등록 표 — { "chrome-extension://<ID>/": { name, repo } }. PC 마다 다르다(깃 제외). */
export const CLIENTS_FILE = process.env.KRS_GIT_CLIENTS || path.join(HERE, 'gitclients.json');
const LOG_DIR = process.env.KRS_BRIDGE_LOG_DIR || path.join(HERE, 'logs');
export const ORIGIN = /^chrome-extension:\/\/[a-p]{32}\/$/;
/** 받은 뒤 확장을 다시 불러오지 않아도 되는 파일 — 어느 확장에서든 브라우저가 싣지 않는 것(설명·검사·문서·저장소 설정). */
const NO_RELOAD = /^(README\.md$|tests?\/|docs\/|\.claude\/|\.github\/|\.gitignore$)/;

/** 브라우저가 다리를 띄울 때 넘긴 부른 쪽 주소. 없으면(손으로 띄웠다) 빈 글. */
export const originOf = (argv = process.argv) => argv.find((a) => ORIGIN.test(a)) || '';

/** 등록 표를 읽는다. 없거나 깨졌으면 빈 표 — 아무도 등록되지 않은 것과 같다. */
export function readClients(file = CLIENTS_FILE) {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/** 그 주소로 등록된 확장. 표에 적힌 이름만 받는다('constructor' 같은 주소가 객체의 내장 속성에 걸리지 않게). */
export function clientOf(origin, clients) {
  const c = ORIGIN.test(String(origin)) && Object.hasOwn(clients, origin) ? clients[origin] : null;
  return c && typeof c.repo === 'string' && c.repo ? { name: String(c.name || ''), repo: c.repo } : null;
}

const pad = (n) => String(n).padStart(2, '0');

/** 받기를 본래 다리와 같은 기록(native/logs/<날짜>.jsonl)에 한 줄 남긴다. 실패해도 응답은 보내야 하므로 삼킨다. */
export function writeLog(entry, dir = LOG_DIR) {
  try {
    const d = new Date();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.jsonl`),
      `${JSON.stringify({ at: d.toISOString(), ...entry })}\n`);
  } catch {
    // 기록 실패로 다리가 멈추면 안 된다
  }
}

/**
 * 요청 하나를 처리하는 함수를 짓는다. 확인(gitStatus)은 몇 분마다 돌아 남기지 않고, 받기(gitPull)는 파일을 바꾸므로 남긴다.
 * @param {{ origin?: string, clients?: object, status?: Function, pull?: Function, log?: Function, exists?: Function }} [deps] 테스트가 갈아 끼운다
 */
export function createHandler({ origin = originOf(), clients = readClients(), status = gitStatus, pull = gitPull, log = writeLog,
  exists = (repo) => fs.existsSync(repo) } = {}) {
  const client = clientOf(origin, clients);
  const git = client ? (args, o) => runGit(args, { ...o, cwd: client.repo }) : null;
  return async (msg) => {
    if (!client) return { ok: false, code: 'NOT_REGISTERED', error: '이 확장은 다리에 등록돼 있지 않습니다.' };
    const task = msg?.task;
    if (task === 'ping') return { ok: true, pong: true, name: client.name };
    if (task !== 'gitStatus' && task !== 'gitPull') return { ok: false, code: 'NOT_ALLOWED', error: `이 다리는 GitHub 받기만 합니다: ${String(task)}` };
    if (!exists(client.repo)) return { ok: false, code: 'REPO_MISSING', error: '등록해 둔 확장 폴더가 없습니다 — 폴더를 옮겼으면 다시 등록하세요.' };
    if (task === 'gitStatus') return status({ git });
    const started = Date.now();
    const r = await pull({ git, noReload: NO_RELOAD });
    log({ task: 'gitPull', client: client.name || origin, ms: Date.now() - started, ...r });
    return r;
  };
}

/* ---------------------------------------------------------------- 진입 */

// 프레임 읽고 쓰기는 본래 다리의 입구(entry.mjs 의 run)를 그대로 쓴다 — 그 파일은 불러오기만 해서는 아무 모듈도 싣지 않는다.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { run } = await import('./entry.mjs');
  run({ handle: createHandler() });
}
