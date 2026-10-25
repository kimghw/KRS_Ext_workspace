#!/usr/bin/env node
// rerp/ 폴더는 kr_ext_rerp(E:\dev\kr_ext_rerp)의 코드를 옮겨 온 것이다(rerp/README.md). 원본이 바뀌면 rerp/ 도 따라 고쳐야 하므로,
// 옮길 때 원본 파일의 지문(sha1)을 rerp/origin.json 에 적어 두고 이 도구가 지금의 원본과 견준다.
//
//   node tools/rerp.mjs check [--source <kr_ext_rerp 경로>]   # 원본이 옮긴 뒤로 바뀌었는지 — 바뀐 파일이 있으면 1 로 끝남 (npm test 의 test/rerp-origin.test.mjs 가 부른다)
//   node tools/rerp.mjs stamp [--source <경로>]               # 지금 원본의 지문·커밋·날짜를 rerp/origin.json 에 다시 적는다 (rerp/ 를 원본에 맞춰 고친 뒤)
//   node tools/rerp.mjs list                                  # 무엇이 어디서 왔는지 보인다
//
// 원본 경로는 --source, 환경변수 KR_EXT_RERP, 기본값 E:/dev/kr_ext_rerp 차례. 원본이 없는 PC(다른 사람의 PC)에서는 check 가 "원본 없음" 으로 0 으로 끝난다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = path.join(ROOT, 'rerp', 'origin.json');
const DEFAULT_SOURCE = process.env.KR_EXT_RERP || 'E:/dev/kr_ext_rerp';

/** 원본 파일 → rerp/ 의 파일. 한 원본이 여러 곳으로 가기도 한다(render.js → planui.js · background.js → sharesync.js). 원노트·MCP(lib/mcp-client.js · lib/plus-onenote.js → rerp/mcp.js · onenote.js · plussync.js)는
 *  2026-10-18 원본이 걷어 내어(사용자 "mcp 없이 … 브라우저 토큰으로") 여기서도 지웠다 — 그 자리는 SharePoint 폴더의 과제별 JSON(spstore · prjdoc · prjdocsync · staffsync · sharesync). */
export const MAP = [
  { from: 'lib/format.js', to: 'rerp/fmt.js', how: '그대로 (IIFE → export)' },
  { from: 'lib/plan-sync.js', to: 'rerp/plansync.js', how: '그대로 (export)' },
  { from: 'lib/plan.js', to: 'rerp/plan.js', how: '그대로 + chrome.runtime.sendMessage 세 곳 → api.send' },
  { from: 'lib/render.js', to: 'rerp/planui.js', how: '과제집행비율 표 부분만 (rateCell·pct·rateOf·아이콘·isProjectLead·planBtn·planRow·planForm·budgetTable·projectLink)' },
  { from: 'lib/rnd-api.js', to: 'rerp/erp.js', how: 'call·describe·pool·fetchProjectRecs·fetchProjects·dateRange·fetchCards·trunc·execRate·fetchBudget·ssoLogin + collect 의 미청구 합산(withPending) · settings.js 의 adv 기본값' },
  { from: 'lib/settings.js', to: 'rerp/erp.js · rerp/sharesync.js', how: 'DEFAULTS 의 adv·budgetExclude(erp.js)·plus(sharesync.js SHARE_DEFAULTS — 가맹점 sitesSync·sitesScope·sitesProjects 빼고) · sharePick·sharesProject(sharesync.js) 와 parseJson 만' },
  { from: 'background.js', to: 'rerp/sharesync.js', how: '공유 (Plus) 배선(shareSync·queueShareSync·shareAutoRename·shareProbe·shareFolderCopy·shareFolderPeople·shareOrgLink·shareRename·onMessage 갈래) — 설정·과제 문맥·loadLocal/saveLocal·참여인력·클립보드·chrome·fetch 는 deps · 가맹점(sites*)·collect*·git* 은 옮기지 않음' },
  { from: 'lib/panel.css', to: 'rerp/plan.css', how: '과제집행비율 표·집행비율 막대·예상 비용 줄과 폼·공유 아이콘 규칙만' },
  { from: 'tests/plan-sync.test.js', to: 'test/rerp.test.mjs', how: 'ESM 으로 옮기고 plan.js·erp.js 검사를 보탬' },
  // 연구내용(2026-10-14 원노트 → 2026-10-18 과제 폴더의 연차 파일 research 칸) — 연구개발계획서 기록과 그 병합 규칙
  { from: 'lib/research.js', to: 'rerp/research.js', how: '그대로 (IIFE → export)' },
  { from: 'lib/research-sync.js', to: 'rerp/researchsync.js', how: '그대로 (IIFE → export, g.KRX_RESEARCH 는 shim)' },
  { from: 'tests/research.test.js', to: 'test/rerp-research.test.mjs', how: 'ESM 으로 (help-server/classify.js 검사는 뺌)' },
  // 참여연구원 참여율·지급액(2026-10-18) — 계산은 kr_ext_rerp 의 사업비 변경 메뉴로 넘기고(사용자 지정), WORKSPACE 의 참여인력 칸은 rERP 에 등록된 값을 보이기만 한다(rndpanel.js · src/rnderp.js)
  { from: 'lib/staff.js', to: 'rerp/staff.js', how: '그대로 (IIFE → export)' },
  { from: 'tests/staff.test.js', to: 'test/rerp-staff.test.mjs', how: 'ESM 으로 (머리의 require 만 import, 끝에 행정지원 검사 보탬)' },
  // 공유 (Plus) v2(2026-10-18 저녁 — "onedrive 에 업무/shared 안에 과제별로 … 년차별로 1개 파일" · "workspace 에도 경로주면 알아서 동기화"): SharePoint 저장소 · 문서 모양과 병합 · 과제별 차례 · 사업비 병합
  { from: 'lib/staff-sync.js', to: 'rerp/staffsync.js', how: '그대로 (IIFE → export, g.KRX_STAFF 는 shim)' },
  { from: 'lib/sp-store.js', to: 'rerp/spstore.js', how: '그대로 (g = globalThis, export)' },
  { from: 'lib/prjdoc.js', to: 'rerp/prjdoc.js', how: '그대로 (IIFE → export, g.KRX_PLAN_SYNC·KRX_RESEARCH_SYNC·KRX_STAFF_SYNC·KRX_STAFF 는 shim)' },
  { from: 'lib/prjdoc-sync.js', to: 'rerp/prjdocsync.js', how: '그대로 (IIFE → export, g.KRX_PRJDOC 는 shim)' },
  { from: 'tests/staff-sync.test.js', to: 'test/rerp-share.test.mjs', how: 'ESM 으로 (한 파일에 넷 + sharesync 배선 검사)' },
  { from: 'tests/sp-store.test.js', to: 'test/rerp-share.test.mjs', how: 'ESM 으로 (가짜 fetch·chrome — 실 SharePoint 에 쓰지 않음)' },
  { from: 'tests/prjdoc.test.js', to: 'test/rerp-share.test.mjs', how: 'ESM 으로' },
  { from: 'tests/prjdoc-sync.test.js', to: 'test/rerp-share.test.mjs', how: 'ESM 으로 (가짜 store)' },
];

const sha1 = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
function argOf(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ''; }
const source = () => path.resolve(argOf('--source') || DEFAULT_SOURCE);
const git = (dir, args) => { try { return execSync(`git ${args}`, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };

export function readOrigin() { return JSON.parse(fs.readFileSync(ORIGIN, 'utf8')); }

/** 지금 원본과 origin.json 을 견준다 → { missing, changed:[{from, was, now}], same:[], head } */
export function compare(src, origin) {
  const out = { missing: !fs.existsSync(src), changed: [], same: [], head: '' };
  if (out.missing) return out;
  out.head = git(src, 'rev-parse --short HEAD');
  for (const f of origin.files) {
    const file = path.join(src, f.from);
    if (!fs.existsSync(file)) { out.changed.push({ from: f.from, was: f.sha1, now: '(없음)' }); continue; }
    const now = sha1(file);
    if (now === f.sha1) out.same.push(f.from); else out.changed.push({ from: f.from, was: f.sha1, now });
  }
  return out;
}

function stamp(src) {
  const files = [];
  for (const m of MAP) {
    const file = path.join(src, m.from);
    if (!fs.existsSync(file)) throw new Error(`${m.from} 이 ${src} 에 없습니다.`);
    files.push({ from: m.from, to: m.to, how: m.how, sha1: sha1(file), bytes: fs.statSync(file).size });
  }
  const origin = {
    source: 'kr_ext_rerp', path: src.split(path.sep).join('/'),
    commit: git(src, 'rev-parse --short HEAD'), commitDate: git(src, 'log -1 --format=%ad --date=short'), version: JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')).version,
    dirty: git(src, 'status --short').split('\n').filter(Boolean).map((l) => l.trim()),
    note: (() => { try { return readOrigin().note || ""; } catch { return ""; } })(),   // 손으로 적은 갱신 내력은 지키고 다시 적는다(2026-10-19 — 전에는 stamp 가 버렸다)
    portedAt: new Date().toISOString().slice(0, 10), files,
  };
  fs.writeFileSync(ORIGIN, `${JSON.stringify(origin, null, 2)}\n`);
  return origin;
}

function main() {
  const cmd = process.argv[2] || 'check';
  if (cmd === 'list') {
    for (const m of MAP) console.log(`${m.from.padEnd(26)} → ${m.to.padEnd(32)} ${m.how}`);
    return;
  }
  if (cmd === 'stamp') {
    const o = stamp(source());
    console.log(`rerp/origin.json 을 다시 적었습니다 — ${o.source} ${o.version} (${o.commit} ${o.commitDate}${o.dirty.length ? `, 작업 트리 변경 ${o.dirty.length}` : ''}), 파일 ${o.files.length}개`);
    return;
  }
  if (cmd !== 'check') throw new Error(`모르는 명령 ${cmd} — check | stamp | list`);
  const origin = readOrigin();
  const r = compare(source(), origin);
  if (r.missing) { console.log(`원본(${source()})이 없어 견주지 못했습니다 — rerp/ 는 ${origin.source} ${origin.version} (${origin.commit} ${origin.commitDate}) 기준입니다.`); return; }
  console.log(`rerp/ 기준: ${origin.source} ${origin.version} (${origin.commit} ${origin.commitDate}) · 지금 원본: ${r.head}`);
  for (const f of r.same) console.log(`  같음  ${f}`);
  for (const c of r.changed) console.log(`  바뀜  ${c.from}  (${c.was.slice(0, 8)} → ${c.now.slice(0, 8)})`);
  if (r.changed.length) {
    console.log(`\n원본이 옮긴 뒤로 바뀐 파일 ${r.changed.length}개 — rerp/README.md 의 "갱신" 차례대로 rerp/ 에 반영한 뒤 \`node tools/rerp.mjs stamp\` 로 지문을 다시 적으세요.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (err) { console.error(err.message); process.exitCode = 1; }
}
