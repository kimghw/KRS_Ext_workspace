// 로컬 Claude CLI 다리가 붙지 않았을 때, 다른 코딩 에이전트(Claude Code·Codex …)에 붙여 넣을 연결 지침을 만든다.
//
// 확장은 다리를 스스로 놓을 수 없다 — 레지스트리도 프로세스도 건드리지 못한다. 그래서 이 PC 에서 명령을
// 돌릴 수 있는 쪽에 맡기고, 그쪽이 되묻지 않고 시작할 수 있게 확장 폴더·확장 ID·증상을 같이 적어 준다.

import { NATIVE_HOST } from './llm.js';

const MANIFEST_FILE = `native/${NATIVE_HOST}.json`;
const BRIDGE_BAT = /[\\/]native[\\/]claude-bridge\.bat$/i;

/**
 * install.ps1 이 써 둔 매니페스트에서 확장 폴더를 읽는다. 확장은 자기 폴더의 절대경로를 알 길이 없고,
 * 그것이 적힌 곳은 이 파일뿐이다.
 *
 * 확장 ID 는 폴더 경로에서 나온다. 그래서 매니페스트의 ID 가 지금 ID 와 같을 때만 그 경로를 믿는다(root).
 * 다르면 폴더를 옮겼거나(파일은 따라오지만 안의 경로는 옛 자리다) 다른 ID 로 등록한 것이라 hint 로만 준다.
 *
 * @returns {{root: string, hint: string}}
 */
export function rootFromManifest(manifest, id) {
  const path = String(manifest?.path || '');
  if (!BRIDGE_BAT.test(path)) return { root: '', hint: '' };
  const folder = path.replace(BRIDGE_BAT, '');
  const origins = Array.isArray(manifest.allowed_origins) ? manifest.allowed_origins : [];
  return id && origins.includes(`chrome-extension://${id}/`) ? { root: folder, hint: '' } : { root: '', hint: folder };
}

/** 확장 폴더를 알아낸다. 한 번도 등록한 적이 없으면 매니페스트가 없어 둘 다 빈 문자열이다. */
export async function bridgeRoot(id) {
  try {
    const res = await fetch(chrome.runtime.getURL(MANIFEST_FILE));
    if (res.ok) return rootFromManifest(await res.json(), id);
  } catch { /* 파일이 없다 */ }
  return { root: '', hint: '' };
}

function browserOf(userAgent) {
  const edge = /Edg\/(\d+)/.exec(userAgent);
  if (edge) return { key: 'edge', label: `엣지 ${edge[1]}`, page: 'edge://extensions' };
  const chromeVer = /Chrome\/(\d+)/.exec(userAgent);
  return { key: 'chrome', label: chromeVer ? `크롬 ${chromeVer[1]}` : '크롬 계열', page: 'chrome://extensions' };
}

// 브라우저가 대는 까닭은 몇 가지뿐이고, 고치는 길이 서로 다르다. 확정은 아래 check 가 한다.
const CAUSES = [
  [/not found/i, '호스트가 등록되지 않았거나, 등록한 뒤 브라우저를 완전히 다시 열지 않은 경우입니다(조건 5·6).'],
  [/forbidden/i, '등록된 매니페스트의 allowed_origins 가 이 확장 ID 와 다른 경우입니다 — 위 ID 로 다시 등록합니다(조건 5).'],
  [/exited|communicating|failed to start/i, '호스트가 뜨다가 끝난 경우입니다 — node 가 PATH 에 없거나 native 폴더가 덜 복사됐을 때 흔합니다(조건 1·4).'],
];

/** rERP 확장(kr_ext_rerp) manifest.json 의 name — 압축해제 확장은 ID 가 PC 마다 달라 이름으로 찾는다(rndpanel.js 의 공유 폴더 묻기와 같다). */
export const RERP_NAME = 'KR eClass + R&D ERP 현황';

/**
 * 같은 브라우저에 rERP 확장이 있는가. 연결 지침이 "한 번에 둘 다" 연결하게 하려고 묻는다(2026-10-24 사용자 지정: "하나만 해도 둘다 할 수 있다. 하나만 설치했다면 뭐 하나만 하지만").
 * 켜진 것을 먼저 고른다. chrome.management 를 못 쓰면(검사·권한 없음) undefined — 있는지 모른다는 뜻이고, 없으면 null.
 * @returns {Promise<{id: string, version: string, enabled: boolean} | null | undefined>}
 */
export async function findPeer(management = globalThis.chrome?.management) {
  try {
    const all = await management.getAll();
    const hit = all.filter((x) => x?.name === RERP_NAME).sort((a, b) => Number(!!b.enabled) - Number(!!a.enabled))[0];
    return hit ? { id: String(hit.id || ''), version: String(hit.version || ''), enabled: !!hit.enabled } : null;
  } catch {
    return undefined;
  }
}

/**
 * 같은 PC 의 rERP 확장을 이어서 연결하는 절. 그 확장은 다리 대신 Help 서버(kr_ext_rerp help-server/server.js)로 Claude 에 닿는다 —
 * 연결 방법은 그 저장소의 CLAUDE.md 가 정본이라 여기서는 폴더를 찾는 법과 어디를 따르는지만 적는다. 있는지 모르면(undefined) 찾아보라고만 한다.
 */
function peerSection(peer, ops, browser) {
  if (peer === null) return `## 같은 PC 의 rERP 확장
이 브라우저에는 rERP 확장(${RERP_NAME})이 없습니다 — 이 확장만 연결하면 됩니다.`;
  const known = !!peer;
  return `## 같은 PC 의 rERP 확장도 이어서 — 한 번에 둘 다
${known
    ? `이 브라우저에 rERP 확장(${RERP_NAME}, ID ${peer.id}${peer.version ? ` · v${peer.version}` : ''}${peer.enabled ? '' : ' · 꺼져 있음'})도 있습니다.`
    : `이 브라우저에 rERP 확장(${RERP_NAME})이 있는지 확장이 확인하지 못했습니다 — ${browser.page} 에서 보고, 없으면 이 절은 건너뜁니다.`}
그 확장은 다리 대신 이 PC 의 Help 서버(node help-server/server.js, http://127.0.0.1:8106)로 Claude 에 닿습니다. 위 다리를 연결한 뒤 이어서:
1. 그 확장 폴더를 찾습니다 — 흔히 이 확장 폴더 옆의 kr_ext_rerp 입니다. 맞는지는 \`${ops} id <그 폴더>\` 의 값이 ${known ? `${peer.id} 와` : '그 확장 카드의 ID 와'} 같은지로 봅니다(아니면 ${browser.page} 의 그 확장 카드 "로드 위치").
2. 그 폴더의 CLAUDE.md "Help Chat (help-server) 을 쓸 때 필요한 것" 절을 따라 준비물을 확인하고 Help 서버를 띄웁니다(그 폴더의 help-server\\setup.cmd 가 CLI 최신화 · git pull · 서버 실행을 한 번에 — 그 창은 닫지 않게 안내).
3. 확인 — curl http://127.0.0.1:8106/health 의 답에 "name":"krx-help" 가 있으면 됩니다. 그 확장 코드도 고치지 않습니다.${known && !peer.enabled ? `\n(그 확장이 꺼져 있으니 쓰려면 ${browser.page} 에서 켜 달라고 사용자에게 말합니다.)` : ''}`;
}

/**
 * 연결 지침. 읽는 쪽은 이 PC 에서 PowerShell 을 돌릴 수 있는 코딩 에이전트다.
 * 이 글 하나로 같은 PC 에 있는 두 확장을 다 연결한다 — 이 확장의 다리(그러면 패널 아래 Help Chat 도 된다)와, 있으면 rERP 확장의 Help 서버(peer).
 *
 * @param {{id?: string, root?: string, hint?: string, error?: string, version?: string, userAgent?: string, peer?: {id: string, version?: string, enabled?: boolean} | null}} info
 *   root 는 확실한 확장 폴더, hint 는 확실하지 않은 후보(rootFromManifest 참고), error 는 브라우저가 댄 까닭, peer 는 findPeer 의 답(undefined = 모름).
 */
export function bridgeGuide({ id = '', root = '', hint = '', error = '', version = '', userAgent = '', peer } = {}) {
  const browser = browserOf(userAgent);
  const ops = `powershell -ExecutionPolicy Bypass -File "${root || '<확장 폴더>'}\\.claude\\skills\\bridge\\bridge_ops.ps1"`;
  const cause = CAUSES.find(([re]) => re.test(error))?.[1];

  const folder = root
    ? `- 확장 폴더(작업 폴더): ${root}`
    : [
      '- 확장 폴더(작업 폴더): 확장은 자기 폴더의 경로를 알 수 없어 적지 못했습니다.',
      hint && `  · 예전 등록에는 ${hint} 로 적혀 있지만, 그때의 확장 ID 가 지금과 달라 믿을 수 없습니다(폴더를 옮겼거나 다른 ID 로 등록).`,
      '  · 먼저 지금 작업 폴더가 확장 폴더인지 봅니다 — native\\host.mjs 가 있으면 아래를 돌려, 나온 값이 아래 확장 ID 와 같으면 그 폴더입니다',
      '    (확장 ID 는 폴더 경로에서 계산되므로 같으면 틀림없습니다):',
      '    powershell -ExecutionPolicy Bypass -File ".\\.claude\\skills\\bridge\\bridge_ops.ps1" id',
      `  · 아니면 ${browser.page} 에서 이 확장 카드의 "로드 위치"에 적혀 있습니다. 사용자에게 물어보고, 받은 폴더도 같은 id 명령으로 확인합니다.`,
      '  · 아래 명령의 <확장 폴더> 자리에 그 경로를 넣습니다.',
    ].filter(Boolean).join('\n');

  return `KRS WORKSPACE 브라우저 확장에 이 PC 의 Claude Code CLI 를 연결해 주세요.

## 지금 상태 (확장이 스스로 적은 것)
${folder}
- 확장 ID: ${id || '(알 수 없음)'}
- 브라우저: ${browser.label}${version ? ` · 확장 v${version}` : ''}
- 증상: 네이티브 메시징 호스트 ${NATIVE_HOST} 에 닿지 않습니다${error ? ` — "${error}"` : ''}${cause ? `\n  → 흔히 ${cause}` : ''}

## 배경
브라우저 확장은 claude 를 직접 실행할 수 없어서, 네이티브 메시징 호스트(native\\host.mjs, node 로 돕니다)를 거쳐 부릅니다.
다리가 연결되면 패널 아래 Help Chat(안 되는 점 디버깅·확장 코드 고치기, 요청하면 git 커밋·푸시·포크)도 같은 다리로 돕니다 — 따로 띄울 서버는 없습니다.
포크·PR 까지 쓰려면 GitHub CLI(gh)에 로그인돼 있으면 됩니다(gh auth status — 없어도 연결에는 상관없음).
로그인이나 토큰 문제가 아니라 통로 문제이고, 아래 여섯 가지가 모두 맞아야 연결됩니다.
1. node 가 PATH 에 있다
2. claude 가 PATH 에 있다
3. claude 에 로그인돼 있다 (claude login)
4. 확장 폴더에 native\\host.mjs 와 native\\claude-bridge.bat 이 있다
5. 호스트가 레지스트리(HKCU 의 크롬·엣지 NativeMessagingHosts)에 등록돼 있고, 그 매니페스트의 allowed_origins 가 위 확장 ID 다
6. 등록한 뒤에 브라우저를 완전히 끝냈다가 다시 열었다

## 할 일 (Windows PowerShell)
1. 점검 — 여섯 항목을 [OK]/[--] 로 찍고 "다음 할 일"을 알려 줍니다. 증상만 보고 짐작하지 말고 이것부터 돌립니다.
   ${ops} check
2. node 나 claude 가 없으면 설치하고, 로그인이 없으면 사용자에게 claude login 을 부탁합니다.
3. 등록 — 위 확장 ID 로 크롬·엣지 키에 한 번에 등록하고, 곧바로 다리 왕복(ping)까지 확인합니다. HKCU 라 관리자 권한이 필요 없습니다.
   ${ops} install ${id || '<확장 ID>'}
4. 브라우저 다시 열기 — 등록은 브라우저가 뜰 때 한 번만 읽습니다. 열린 탭을 잃으니 브라우저를 임의로 끄지 말고,
   사용자에게 창을 모두 닫아 달라고 한 뒤 아래를 돌립니다. 창이 남아 있으면 끝내지 않고, 창을 닫아도 남는 본체(엣지에 흔합니다)를 정리해 다시 띄웁니다.
   ${ops} restart ${browser.key}
5. 확인 — 사용자가 확장 패널 머리의 톱니 "설정 → LLM → 로컬 Claude CLI"에서 "다시 확인"을 눌러 배지가 "연결됨"인지 봅니다.
   그래도 안 되면 다리 호출 기록을 봅니다: ${ops} log

${peerSection(peer, ops, browser)}

## 주의
- 확장 ID 는 확장 폴더의 절대경로에서 나옵니다. 폴더를 옮기면 ID 가 바뀌어 다시 등록해야 합니다.
- ~\\.claude\\.credentials.json 을 읽거나 복사하거나 확장에 넘기지 않습니다. 연결에 필요하지 않습니다.
- test 명령은 실제로 claude 를 한 번 부릅니다(1센트 남짓). 사용자에게 알리고 돌립니다.
- Claude Code 라면 확장 폴더에서 /bridge 스킬이 같은 일을 합니다. 자세한 설명은 README.md 의 "로컬 CLI 연결"과 .claude\\skills\\bridge\\SKILL.md 에 있습니다.
`;
}
