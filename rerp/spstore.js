// kr_ext_rerp `lib/sp-store.js` 를 그대로 옮긴 것 — IIFE 의 `g`(self) 를 globalThis 로(fetch · chrome 전역을 읽는 자리), 꼬리의 `g.KRX_SP = api` 를 export 로만 바꿨다. 출처·갱신 규칙은 rerp/README.md.
/* lib/sp-store.js — 확장 Plus 의 공유 저장소: SharePoint(OneDrive) 폴더 트리(기본 밑폴더 → 과제 폴더 → 연차 파일·예상비용 파일)를 **브라우저의 로그인 쿠키만으로** 읽고 쓴다
 *   (0.8.7, 2026-10-18 사용자 지정: "원노트 공유는 mcp 없어도 되긴하지? … mcp 없이 grph api 하지 않고 브라우저 토큰으로 하라고" · "과제 별로 하면 1개 … json 이나 yaml 형식으로 기록되어 있으면" ·
 *   "네가 붙여 넣도록 해줘. 공유할때 공유주소를 주면 되지" · 저녁 "onedrive 에 업무/shared 안에 과제별로 .. 약칭으로 없으면 jobid 없으면 임시번호 … 년차별로 1개 파일" · "참여연구원들에게 공유할 수 있게 설정까지 같이해줘").
 * v2(폴더 트리)에서 더한 것 — 폴더 이름·파일 모양은 lib/prjdoc.js·prjdoc-sync.js 몫이고 여기는 손잡이만:
 *   listFolders(cfg, io) 하위 폴더 목록 · childCfg(cfg, name) 하위 폴더 cfg · writer.ensurePath(path) 여러 단 만들기(ensureFolder 도 같은 길 — 문서함 뿌리(cfg.libPath) 위로는 올라가지 않음) ·
 *   sharedWithMe(io, { driveHost }) "나와 공유" 목록(<driveHost>/_api/v2.0/me/drive/sharedWithMe, @odata.nextLink 끝까지 최대 20쪽 — 실측 2026-10-18 200, value[].remoteItem.webUrl 이 주인 사이트의 실제 위치) ·
 *   writer.at(cfg) 같은 사이트의 다른 폴더를 같은 작업 탭·다이제스트로 다루는 손잡이(modify·write·remove·ensurePath·sharePeople·orgLink·rename, close 는 no-op — prjdoc-sync 가 사이트마다 writer 하나로 여러 과제 폴더를 쓴다; 없으면 과제 폴더마다 창을 하나씩 더 열었다) ·
 *   writer.sharePeople(folderPath, names, { role }) 이름으로 사람 찾기(ClientPeoplePicker — 결과 가운데 표시 이름이 질문한 이름과 꼭 같은(공백 무시) 1명이 있을 때만 그 사람; 1명이 왔어도 이름이 다르면(접두 일치 '이영' → '이영희') ambiguous, 같은 이름 여럿도 ambiguous, 0명 notFound) 뒤
 *   SP.Web.ShareObject(편집 role:1073741827 · 읽기 role:1073741826, sendEmail:false) 한 번에(StatusCode ≠ 0 이면 한 명씩) ·
 *   writer.orgLink(folderPath, { edit }) 조직 내 링크(ListItemAllFields → Lists(guid)/GetItemById/ShareLink linkKind 3 편집·2 보기 → 안 되면 SP.Web.CreateOrganizationSharingLink) · writer.rename(folderPath, newName) 폴더 이름 바꾸기(MoveTo → 안 되면 MoveToUsingPath).
 *   공유·링크·이름 바꾸기도 다이제스트가 필요해 writer(작업 창)의 페이지 함수(spSharePeople · spOrgLink · spRename)로 돈다. 피커의 Key(로그인 이름)는 페이지 함수 안에만 두고 결과에는 이름·이메일만 싣는다.
 *   공유·링크 호출은 아직 실측 전(2026-10-18 저녁) — 응답 모양이 다르면 kind 'http' 에 본문 요지(200자)를 담아 사용자에게 보인다.
 *   permissions(cfg, io) 폴더 권한 읽기(ListItemAllFields 의 RoleAssignments 펼침 — 사람은 PrincipalId·표시 이름·이메일·가장 센 역할, 조직 내 링크 그룹은 links, 나 표시) · findPeople(cfg, names, io) 이름 → 사람(사이트 search REST 의 People 원본 — 한글 이름도 찾힘) ·
 *   writer.unshare(folderPath, ids) 사람(PrincipalId)의 권한 거두기(RoleAssignments/GetByPrincipalId → 역할마다 RemoveRoleAssignment) — 2026-10-19 KRS WORKSPACE 참여인력 칸의 읽기·편집 체크("체크하면 반영")가 쓴다.
 *   참여연구원 자료 요청(0.8.9, 2026-10-20 — lib/collect.js · background.js collect*): writer.createList({ title, description, fields, titleField, ownOnly }) 이 사이트에 사용자 지정 목록(SharePoint List)을 만들고 칸(영문 내부 이름 → 한글 표시 이름·설명·기본값)·기본 보기·항목 보안(자기 항목만)을 맞춤(같은 제목이 있으면 그 목록에 빠진 칸만 — 되돌려 받을 수 있게) ·
 *   writer.recycleList(id) 목록을 재활용통으로 · listItems(siteUrl, listId, io, { fields, top }) 목록 항목 읽기(확장 출처 GET — Author 의 이름·이메일 펼침) · listInfo(siteUrl, listId, io) 목록 정보(경로 · 폼 주소 — 공유 전에 저장된 경로 대신) · writer.sharePeople 의 { email:{ subject, body } } 는 ShareObject 의 메일 알림(sendEmail) — 목록(RootFolder 경로)도 폴더와 같은 길로 공유한다(자료 요청은 팀즈 딥 링크로 알리므로 메일은 쓰지 않음).
 *   실측(2026-10-19, 내 OneDrive 과제 폴더 — 권한·사람 찾기 GET 만): 사이트 사용자 정보의 Title 은 영문("MOON Changjae")이라 한글 이름과 맞춰지지 않는다 — 권한은 **이메일**로 맞추고, 주기는 sharePeople 에 이메일을 넘겨(피커가 이메일로 찾음) ShareObject, 바꾸기는 거둔 뒤 다시 주기.
 * kr_ext_aip 확장(E:\dev\kr_ext_aip\extension\lib\sharepoint.js · lib/scan/worker.js · lib/core/sharepointurl.js)이 SharePoint 시트를 다루는 방식을 이 저장소 꼴(IIFE · self.KRX_SP · ESM 아님)로 옮긴 것 —
 *   MCP 서버·Graph·Entra 로그인·원노트는 쓰지 않는다. 백그라운드 전용(chrome.windows · tabs · scripting) · Node 테스트 겸용(가짜 fetch · 가짜 chrome 주입).
 *   무엇을 파일에 쓰는지는 모른다 — 문서 모양·병합은 lib/prjdoc.js, 동기화 차례는 lib/prjdoc-sync.js.
 *
 * 읽기(listFiles · readFile · resolveMyFolder · 공유 링크 풀기): 확장 출처에서 fetch(credentials:'include') — 실측(2026-10-18, 로그인된 KRS Chrome) GET 은 200.
 *   401/403 또는 로그인 화면으로 넘어가면(응답 url 이 사이트 밖) kind 'auth', 연결 실패는 'offline'.
 * 쓰기(openWriter): 확장 출처의 POST/PUT 은 403 이라(AIP 와 같음) 사이트 페이지(<siteUrl>/_api/web/currentuser?$select=Id)를 작업 창(최소화·비포커스)으로 열고 그 안(최상위 프레임 MAIN world)에서 돌린다 —
 *   contextinfo(X-RequestDigest — writer 가 받아 클로저에 두고, FormDigestTimeoutSeconds(기본 30분) 만료 1분 전이 지났으면 다시 받는다; 403 "security validation"(code 'digest') 이 오면 다시 받아 한 번 더 돈다 — 과제가 많아 30분을 넘기거나 테넌트가 짧게 둔 경우) →
 *   modify(name, transform): [없으면 transform(null) → Files/add(url,overwrite=false) 본문 = 내용 → "체크아웃 필수" 문서함이면 파일이 내 체크아웃 상태로 남아 남에게 안 보이므로 CheckOutType 이 2 가 아니면 CheckIn] ·
 *   [있으면 CheckOut → $value 읽기 → (확장 쪽에서 transform) → 바뀌면 PUT $value → CheckIn(주 버전) / 안 바뀌면 UndoCheckOut — 단 **내가 잡고 있던 체크아웃을 이어받은 것(resumed)** 이면 안 바뀌어도 CheckIn:
 *   지난 쓰기가 PUT 뒤 CheckIn 전에 끊겼으면 초안이 올라가 있고 $value 는 나에게 그 초안을 주므로(남에게는 지난 판) UndoCheckOut 은 초안을 버리고(체크인된 판이 없는 새 파일은 지워 버림) 체크아웃이 영원히 남아 동료가 locked 로 건너뛰게 된다; transform 이 { changed:false, discard:true } 를 주면(해석 안 되는 초안) 그때만 UndoCheckOut].
 *   한 동기화에 writer 하나로 여러 파일을 쓰고 끝에 close().
 *   페이지 안 함수(sp* — spDigest · spEnsureFolder · spBegin · spCommit · spRelease · spCreate · spRecycle)는 직렬화돼 주입되므로 **바깥 변수를 쓰지 않는다**(AIP 와 같은 규칙, 결과는 JSON 으로 돌아온다).
 *   GetFolderByServerRelativePath 는 없는 폴더에도 200 을 주고 JSON 의 Exists:false 로 알리므로 Exists 를 본다(파일 정보도 같이 봄). 남이 체크아웃한 파일은 kind 'locked'(그 파일만 건너뜀),
 *   내가 잡고 있던 체크아웃(끊긴 지난 쓰기)은 이어서 쓴다(spBegin resumed:true). 백업은 SharePoint 버전 기록(체크인마다 주 버전)이 대신한다.
 *   readFile 의 meta 에 checkedOut · checkedOutByMe 를 실어(CheckOutType ≠ 2 면 CheckedOutByUser 와 currentuser 를 견줌) prjdoc-sync 가 내용이 같아도 modify 로 이어받아 체크인하게 한다.
 *   서비스워커가 쓰기 도중 끝나면(메모리 압박·확장 reload) finally 가 돌지 않아 최소화된 작업 창이 남는다 — sweepWorkers({ chrome }) 가 다음 워커 시작 때(background.js 최상위) 그 주소(…/_api/web/currentuser?$select=Id)의 탭을 찾아 닫는다(지금 살아 있는 writer 의 탭은 건너뜀).
 * 주소(parseFolder): 폴더 주소(https://<테넌트>-my.sharepoint.com/personal/<u>/Documents/업무/shared · https://<테넌트>.sharepoint.com/sites/<x>/Shared Documents/<폴더>, 퍼센트 인코딩 가능) ·
 *   문서함 보기 주소(…/onedrive.aspx?id=<서버 상대 경로> · …/Forms/AllItems.aspx?id=…, 파일을 고른 주소면 parent= 가 폴더). 공유 링크(/:f:/…)는 parseFolder 가 받지 않고
 *   resolveFolder 가 확장 출처 GET redirect:'follow' 로 따라간 마지막 주소의 id= 에서 푼다(못 풀면 badurl "공유 링크 대신 폴더를 연 뒤 주소창의 주소를 넣으세요").
 *   비면 내 OneDrive 의 문서/업무/shared(resolveMyFolder(name — 기본 DEFAULT_FOLDER_NAME, 여러 단 가능): <driveHost>/_api/v2.0/me/drive 의 webUrl, 없으면 SP.UserProfiles.PeopleManager/GetMyProperties 의 PersonalUrl + /Documents).
 *   REST 의 decodedurl='…' 과 add('…') 리터럴은 encodeURIComponent 뒤 ' → '' (AIP 와 같음).
 *   cfg 는 storage.local.shareFolder 에 캐시되는데 JSON 은 함수(fileApi · fileUrl)를 잃으므로 모든 진입점이 revive(cfg) 로 되살린다 — 다른 모듈도 캐시에서 읽은 cfg 는 KRX_SP.revive(cfg) 를 거치거나 KRX_SP.fileApi(cfg, name) · KRX_SP.fileUrl(cfg, name) 을 쓸 것.
 * 폴더 주소(folderUrl)는 칸마다 encodeURIComponent 로 만든다 — encodeURI 는 폴더 이름의 '#' 을 두어 붙여 넣은 쪽의 parseFolder 가 fragment 로 잘라 상위 폴더로 풀린다.
 * 오류는 Error 에 kind: badurl · auth · offline · nofolder · notfound · locked · http(status) · tab. describe(e) → { kind, message }.
 * 쿠키·다이제스트 값은 로그·결과에 찍지 않는다 — 쿠키는 브라우저가 붙이고 다이제스트는 writer 클로저에만 있다. */
const g = globalThis;   // [workspace] 원본은 IIFE 인자 self
const DEFAULT_DRIVE_HOST = 'https://krclass-my.sharepoint.com';
const DEFAULT_FOLDER_NAME = '업무/shared';   // 설정 folder 가 비었을 때 내 OneDrive 문서 아래 밑폴더(두 단 — 2026-10-18 저녁 사용자 "onedrive 에 업무/shared 안에 과제별로"). background.js SHARE_BASE_NAME 과 같은 값
const TAB_TIMEOUT_MS = 30000;
const DIGEST_TTL_SEC = 1800;   // contextinfo 가 FormDigestTimeoutSeconds 를 안 주면(SharePoint 기본 30분)
const WORKER_PAGE = '/_api/web/currentuser?$select=Id';   // 작업 창에 여는 사이트 페이지(사이트 상대) — sweepWorkers 가 이 주소로 남은 창을 알아본다
const DEFAULT_COMMENT = 'KR eClass 확장 공유 (Plus)';
const AUTH_MSG = '이 브라우저에서 SharePoint(OneDrive)에 로그인하세요';
const URL_HINT = '폴더 주소(https://…sharepoint.com/personal/<u>/Documents/업무/shared 또는 …/sites/<x>/Shared Documents/<폴더>)나 문서함에서 폴더를 연 주소(…onedrive.aspx?id=… · …AllItems.aspx?id=…)를 넣으세요';
const SHARE_HINT = '공유 링크 대신 폴더를 연 뒤 주소창의 주소를 넣으세요';
const ACCEPT_JSON = 'application/json;odata=nometadata';
const ROLE_EDIT = 'role:1073741827';   // SP.Web.ShareObject roleValue — 편집(Contribute 역할 정의 id)
const ROLE_READ = 'role:1073741826';   // 읽기
const SHARED_MAX_PAGES = 20;           // sharedWithMe 가 따라가는 @odata.nextLink 쪽수 상한(한 쪽 최대 500개)
const PEOPLE_SOURCE = 'b09a7990-05ea-4af9-81ef-edfab16c4e31';   // search REST 의 People 결과 원본(Local People Results) — findPeople
const api = { DEFAULT_DRIVE_HOST, DEFAULT_FOLDER_NAME, TAB_TIMEOUT_MS, DIGEST_TTL_SEC, WORKER_PAGE, DEFAULT_COMMENT, AUTH_MSG, URL_HINT, SHARE_HINT, ROLE_EDIT, ROLE_READ, SHARED_MAX_PAGES, PEOPLE_SOURCE };

const mkErr = (kind, message, extra) => { const e = new Error(message || kind); e.kind = kind; if (extra) Object.assign(e, extra); return e; };
const badurl = (message) => { throw mkErr('badurl', message); };
const kindOfStatus = (s) => (s === 401 || s === 403 ? 'auth' : s === 404 ? 'notfound' : s === 423 ? 'locked' : 'http');
const errOfStatus = (status, what) => {
  const k = kindOfStatus(status);
  return mkErr(k, k === 'auth' ? `${AUTH_MSG} (${what} ${status})` : k === 'notfound' ? `${what}: 없습니다 (404)` : k === 'locked' ? `${what}: 다른 사람이 편집 중(체크아웃)입니다 (423)` : `SharePoint 응답 오류 (${what} ${status})`, { status });
};
/* 페이지 함수가 돌려준 { ok:false, code, error, status } → Error(kind) */
function errOfResult(r, what) {
  if (!r || typeof r !== 'object') return mkErr('tab', `${what}: 페이지 함수 결과가 없습니다`);
  const k = r.code || 'http';
  const msg = k === 'auth' ? `${AUTH_MSG} (${r.error || ''})`.trim() : k === 'locked' ? (r.error || `${what}: 다른 사람이 편집 중(체크아웃)입니다`) : `${what}: ${r.error || k}`;
  return mkErr(k === 'exists' || k === 'digest' ? 'http' : k, msg, r.status != null ? { status: r.status } : undefined);   // digest: 다시 받아 한 번 더 돌고도 안 되면 http
}
const isSpHost = (host) => /\.sharepoint\./i.test(String(host || ''));
const encLit = (p) => encodeURIComponent(String(p).replace(/'/g, "''"));   // REST 리터럴('…') 안 — ' 는 '' 로
const encPath = (p) => String(p).split('/').map(encodeURIComponent).join('/');   // 브라우저로 열 주소의 경로
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const inside = (at, origin) => at === origin || at.startsWith(`${origin}/`);
/* 응답이 로그인 화면으로 넘어갔나(응답 url 이 사이트 밖). url 이 없는 fetch 구현(Node)은 모른다고 침 */
const redirectedOut = (res, origin) => { const at = typeof (res && res.url) === 'string' ? res.url : ''; return !!at && !inside(at, origin); };
const checkName = (name) => {
  const s = String(name == null ? '' : name);
  // eslint-disable-next-line no-control-regex
  if (!s || s === '.' || s === '..' || /[\\/<>"|?*:\u0000-\u001f]/.test(s)) badurl(`파일 이름에 쓸 수 없는 글자가 있습니다: ${s}`);
  return s;
};
const metaOf = (m) => ({ version: String((m && m.UIVersionLabel) || (m && m.version) || ''), modified: String((m && m.TimeLastModified) || (m && m.modified) || ''), length: Number((m && m.Length) != null ? m.Length : (m && m.length)) || 0, uniqueId: String((m && m.UniqueId) || (m && m.uniqueId) || '').toLowerCase() });
const fileOf = (f) => ({ name: String(f.Name || ''), length: Number(f.Length) || 0, modified: String(f.TimeLastModified || ''), version: String(f.UIVersionLabel || ''), uniqueId: String(f.UniqueId || '').toLowerCase() });
const folderOf = (cfg, f) => { const name = String(f.Name || ''); return { name, path: String(f.ServerRelativeUrl || `${cfg.folderPath}/${name}`).replace(/\/+$/, ''), itemCount: Number(f.ItemCount) || 0, modified: String(f.TimeLastModified || '') }; };

/* ---------- 주소 ---------- */

/* origin + 디코딩한 서버 상대 폴더 경로 → cfg. extra 는 url · mine 등 덧붙일 것. libPath 는 문서함(라이브러리) 뿌리 — ensurePath 가 이 위로는 폴더를 만들지 않는다 */
function build(origin, folderPath, extra) {
  const m = /^\/(sites|teams|personal)\/[^/]+/i.exec(folderPath);
  const sitePath = m ? m[0] : '';
  const siteUrl = `${origin}${sitePath}`, apiRoot = `${siteUrl}/_api`, web = `${apiRoot}/web`;
  const personal = /^\/personal\//i.test(sitePath);
  const segs = folderPath.split('/').filter(Boolean);
  const libPath = `/${segs.slice(0, sitePath.split('/').filter(Boolean).length + 1).join('/')}`;   // 문서함(라이브러리) 뿌리 — 사이트 다음 한 단
  const viewUrl = personal
    ? `${siteUrl}/_layouts/15/onedrive.aspx?id=${encodeURIComponent(folderPath)}`
    : `${origin}${encPath(libPath)}/Forms/AllItems.aspx?id=${encodeURIComponent(folderPath)}`;
  const cfg = {
    url: '', origin, sitePath, siteUrl, apiRoot, api: web, folderPath, libPath, name: segs[segs.length - 1] || '',
    folderApi: `${web}/GetFolderByServerRelativePath(decodedurl='${encLit(folderPath)}')`,
    viewUrl, personal, mine: false
  };
  Object.assign(cfg, extra || {});
  cfg.fileApi = (n) => api.fileApi(cfg, n);
  cfg.fileUrl = (n) => api.fileUrl(cfg, n);
  return cfg;
}
/* 파일 REST 자원 · 브라우저로 열 주소 — 함수가 떨어진(캐시) cfg 에도 쓸 수 있는 꼴 */
api.fileApi = (cfg, name) => `${cfg.api}/GetFileByServerRelativePath(decodedurl='${encLit(`${cfg.folderPath}/${checkName(name)}`)}')`;
api.fileUrl = (cfg, name) => `${cfg.origin}${encPath(cfg.folderPath)}/${encodeURIComponent(checkName(name))}`;
/* 폴더 주소(parseFolder 가 받는 모양 — 설정 [주소 복사] · 캐시 url). 칸마다 encodeURIComponent: encodeURI 는 '#'·'?' 를 두어 붙여 넣은 쪽에서 fragment·query 로 잘린다 */
api.folderUrl = (cfg) => `${cfg.origin}${encPath(cfg.folderPath)}`;
/* storage 캐시(JSON)에서 읽은 cfg 에 함수를 되살린다. 이미 살아 있으면 그대로 */
api.revive = function (cfg) {
  if (!cfg || typeof cfg !== 'object' || !cfg.origin || !cfg.folderPath) throw mkErr('badurl', '공유 폴더 설정이 없습니다');
  if (typeof cfg.fileApi === 'function' && typeof cfg.fileUrl === 'function') return cfg;
  return build(String(cfg.origin), String(cfg.folderPath), { url: String(cfg.url || ''), shareUrl: cfg.shareUrl, mine: !!cfg.mine });
};
/* 하위 폴더의 cfg(같은 사이트 · mine 상속 · url 은 그 폴더 주소). name 은 한 단('과제A') 또는 여러 단('업무/shared') — 단마다 파일 이름 규칙(checkName) */
api.childCfg = function (cfg, name) {
  cfg = api.revive(cfg);
  const segs = String(name == null ? '' : name).split('/').filter(Boolean).map(checkName);
  if (!segs.length) badurl('하위 폴더 이름이 비어 있습니다');
  const child = build(cfg.origin, `${cfg.folderPath}/${segs.join('/')}`, { mine: !!cfg.mine });
  child.url = api.folderUrl(child);
  return child;
};

/* 폴더 주소 → cfg { url, origin, sitePath, siteUrl, apiRoot, api, folderPath, name, folderApi, fileApi(name), fileUrl(name), viewUrl, personal, mine }. 실패는 kind 'badurl' */
api.parseFolder = function (input) {
  const s = typeof input === 'string' ? input.trim() : '';
  if (!s) badurl('공유 폴더 주소가 비어 있습니다');
  if (s.length > 2048) badurl('주소가 너무 깁니다');
  let u;
  try { u = new URL(s); } catch (e) { badurl(`주소 모양이 아닙니다 — ${URL_HINT}`); }
  if (u.protocol !== 'https:') badurl('https 주소여야 합니다');
  if (!isSpHost(u.hostname)) badurl('SharePoint(OneDrive) 주소(…sharepoint.com)여야 합니다');
  let pathname;
  try { pathname = decodeURIComponent(u.pathname); } catch (e) { badurl('주소의 경로를 해석할 수 없습니다'); }
  if (/^\/:[a-z]:\//i.test(pathname)) badurl(`공유 링크(/:f:/…)는 여기서 풀 수 없습니다 — ${SHARE_HINT}`);
  let folderPath;
  if (/\.aspx$/i.test(pathname)) {
    const id = u.searchParams.get('id') || '';
    const parent = (u.searchParams.get('parent') || '').replace(/\/+$/, '');
    if (!id) badurl(`보기 주소에 id= 가 없습니다 — ${URL_HINT}`);
    // 파일을 고른 주소(id=…/파일.json&parent=…/폴더)면 parent 가 폴더
    folderPath = parent && id.startsWith(`${parent}/`) && /\.[A-Za-z0-9]{1,8}$/.test(id) ? parent : id;
  } else if (/\/_(layouts|api|vti_)/i.test(pathname)) {
    badurl(URL_HINT);
  } else {
    folderPath = pathname;
  }
  folderPath = folderPath.replace(/\/+$/, '') || '/';
  if (!folderPath.startsWith('/')) badurl('폴더 경로는 /personal/… · /sites/… 처럼 서버 상대 경로여야 합니다');
  // eslint-disable-next-line no-control-regex
  if (/[<>"|?*:\u0000-\u001f]/.test(folderPath)) badurl('폴더 경로에 쓸 수 없는 글자가 있습니다');
  const m = /^\/(sites|teams|personal)\/[^/]+/i.exec(folderPath);
  if (folderPath.split('/').filter(Boolean).length - (m ? 2 : 0) < 1) badurl(`문서함 안의 폴더까지 넣으세요 — ${URL_HINT}`);
  return build(u.origin, folderPath, { url: s });
};

/* 확장 출처 GET — 연결 실패 'offline', 401/403·로그인 화면 'auth'. 그 밖의 상태는 부르는 쪽이 본다 */
async function spGet(fetchFn, origin, url, what, accept) {
  let res;
  try { res = await fetchFn(url, { credentials: 'include', cache: 'no-store', redirect: 'follow', headers: { Accept: accept || ACCEPT_JSON } }); } catch (e) { throw mkErr('offline', `SharePoint 에 연결하지 못했습니다: ${(e && e.message) || e}`); }
  if (redirectedOut(res, origin)) throw mkErr('auth', `${AUTH_MSG} (로그인 화면으로 넘어감)`);
  if (res.status === 401 || res.status === 403) throw mkErr('auth', `${AUTH_MSG} (${what} ${res.status})`, { status: res.status });
  return res;
}

/* 내 OneDrive 의 문서/<name>(기본 업무/shared — 'a/b' 처럼 여러 단도 됨, 폴더가 아직 없어도 cfg 는 나옴) → cfg(mine:true). opts = { fetch, driveHost, name } */
api.resolveMyFolder = async function (opts) {
  opts = opts || {};
  const fetchFn = opts.fetch || g.fetch;
  let origin;
  try { origin = new URL(String(opts.driveHost || DEFAULT_DRIVE_HOST)).origin; } catch (e) { badurl('OneDrive 주소(driveHost)가 주소 모양이 아닙니다'); }
  const getJson = async (url, what) => {
    const res = await spGet(fetchFn, origin, url, what);
    if (!res.ok) throw errOfStatus(res.status, what);
    const j = await res.json().catch(() => null);
    return j && typeof j === 'object' ? j : {};
  };
  let base = '';
  try { base = String((await getJson(`${origin}/_api/v2.0/me/drive`, '내 OneDrive')).webUrl || ''); } catch (e) { if (e.kind !== 'notfound' && e.kind !== 'http') throw e; }
  if (!base) {   // v2.0 drive 가 없거나 webUrl 이 없으면 사용자 프로필의 PersonalUrl
    const p = await getJson(`${origin}/_api/SP.UserProfiles.PeopleManager/GetMyProperties?$select=PersonalUrl`, '내 OneDrive');
    base = p.PersonalUrl ? `${String(p.PersonalUrl).replace(/\/+$/, '')}/Documents` : '';
  }
  if (!base) throw mkErr('http', '내 OneDrive 주소를 찾지 못했습니다');
  const cfg = api.parseFolder(`${base.replace(/\/+$/, '')}/${String(opts.name || DEFAULT_FOLDER_NAME)}`);
  cfg.mine = true;
  return cfg;
};

/* 설정의 폴더 주소 → cfg. 비면 resolveMyFolder, 공유 링크(/:f:/…)면 redirect 를 따라가 마지막 주소의 id= 로, 아니면 parseFolder. opts = { fetch, driveHost } */
api.resolveFolder = async function (input, opts) {
  opts = opts || {};
  const s = typeof input === 'string' ? input.trim() : '';
  if (!s) return api.resolveMyFolder(opts);
  let u = null;
  try { u = new URL(s); } catch (e) { u = null; }
  if (u && u.protocol === 'https:' && isSpHost(u.hostname) && /^\/:[a-z]:\//i.test(u.pathname)) {
    const fetchFn = opts.fetch || g.fetch;
    let res;
    try { res = await fetchFn(s, { credentials: 'include', cache: 'no-store', redirect: 'follow', headers: { Accept: 'text/html,*/*' } }); } catch (e) { throw mkErr('offline', `SharePoint 에 연결하지 못했습니다: ${(e && e.message) || e}`); }
    const at = typeof res.url === 'string' ? res.url : '';
    if (!at) badurl(`공유 링크를 따라가지 못했습니다 — ${SHARE_HINT}`);
    let dest = null;
    try { dest = new URL(at); } catch (e) { dest = null; }
    if (!dest || !isSpHost(dest.hostname) || res.status === 401 || res.status === 403) throw mkErr('auth', `${AUTH_MSG} (공유 링크가 로그인 화면으로 넘어감)`);
    let cfg;
    try { cfg = api.parseFolder(at); } catch (e) { badurl(`공유 링크에서 폴더를 찾지 못했습니다 — ${SHARE_HINT}`); }
    cfg.shareUrl = s;
    return cfg;
  }
  return api.parseFolder(s);
};

/* ---------- 읽기(확장 출처) ---------- */

/* 폴더의 자식 목록(Files · Folders) 공통 — 404 → nofolder, 비어 있으면 Exists 로 빈 폴더와 없는 폴더를 가른다(GetFolder… 는 없는 폴더에도 200 + Exists:false) */
async function listChildren(cfg, fetchFn, what, tail) {
  const nofolder = () => mkErr('nofolder', `공유 폴더가 없습니다: ${cfg.folderPath}`, { path: cfg.folderPath });
  const res = await spGet(fetchFn, cfg.origin, `${cfg.folderApi}${tail}`, what);
  if (res.status === 404) throw nofolder();
  if (!res.ok) throw errOfStatus(res.status, what);
  const j = await res.json().catch(() => null);
  const list = j && Array.isArray(j.value) ? j.value : Array.isArray(j) ? j : null;
  if (!list) throw mkErr('http', `${what} 응답이 JSON 이 아닙니다`, { status: res.status });
  if (!list.length) {
    const r2 = await spGet(fetchFn, cfg.origin, `${cfg.folderApi}?$select=Exists`, '폴더 정보');
    if (r2.status === 404) throw nofolder();
    const f = r2.ok ? await r2.json().catch(() => null) : null;
    if (f && f.Exists === false) throw nofolder();
  }
  return list;
}
/* 폴더의 파일 목록 → [{ name, length, modified(ISO), version, uniqueId }]. 폴더 없음 → kind 'nofolder' */
api.listFiles = async function (cfg, opts) {
  cfg = api.revive(cfg);
  const list = await listChildren(cfg, (opts && opts.fetch) || g.fetch, '파일 목록', '/Files?$select=Name,Length,TimeLastModified,UIVersionLabel,UniqueId');
  return list.map(fileOf);
};
/* 폴더의 하위 폴더 목록 → [{ name, path(디코딩한 서버 상대 경로), itemCount, modified(ISO) }] — 문서함 뿌리의 숨은 Forms 폴더는 뺀다. 폴더 없음 → kind 'nofolder'. opts(io) = { fetch } */
api.listFolders = async function (cfg, opts) {
  cfg = api.revive(cfg);
  const list = await listChildren(cfg, (opts && opts.fetch) || g.fetch, '폴더 목록', '/Folders?$select=Name,ServerRelativeUrl,ItemCount,TimeLastModified');
  return list.map((f) => folderOf(cfg, f)).filter((f) => f.name && !(f.name === 'Forms' && f.path === `${cfg.libPath}/Forms`));
};

/* "나와 공유" 항목 하나 → { name, webUrl, folder, ownerName, cfg? }. webUrl 은 remoteItem.webUrl(주인 사이트의 실제 위치 — 바깥 webUrl 은 공유 링크일 수 있음) 우선.
 *   폴더이고 그 주소가 parseFolder 로 풀리면 cfg(주인의 personal 사이트 → writer 는 사이트마다 따로). 파일·공유 링크 모양·다른 호스트는 cfg 없이 */
function sharedItemOf(it) {
  if (!it || typeof it !== 'object') return null;
  const ri = it.remoteItem && typeof it.remoteItem === 'object' ? it.remoteItem : {};
  const name = String(it.name || ri.name || '');
  const webUrl = String(ri.webUrl || it.webUrl || '');
  const folder = !!(it.folder || ri.folder);
  const ownerOf = (s) => (s && s.owner && s.owner.user && s.owner.user.displayName) || '';
  const byOf = (c) => (c && c.user && c.user.displayName) || '';
  const r = { name, webUrl, folder, ownerName: String(ownerOf(ri.shared) || ownerOf(it.shared) || byOf(ri.createdBy) || byOf(it.createdBy) || '') };
  if (folder && webUrl) { try { r.cfg = api.parseFolder(webUrl); } catch (e) { /* 폴더 주소 모양이 아니면 cfg 없이 */ } }
  return r;
}
/* "나와 공유" 목록 → [{ name, webUrl, folder, ownerName, cfg? }] — <driveHost>/_api/v2.0/me/drive/sharedWithMe 를 @odata.nextLink 끝까지(최대 maxPages, 기본 20쪽 · 같은 호스트만). 끝점이 없으면(404) [] — 자동 발견은 선택 기능.
 *   opts(io) = { fetch }, o = { driveHost, maxPages } */
api.sharedWithMe = async function (opts, o) {
  opts = opts || {}; o = o || {};
  const fetchFn = opts.fetch || g.fetch;
  let origin;
  try { origin = new URL(String(o.driveHost || DEFAULT_DRIVE_HOST)).origin; } catch (e) { badurl('OneDrive 주소(driveHost)가 주소 모양이 아닙니다'); }
  const maxPages = o.maxPages > 0 ? Number(o.maxPages) : SHARED_MAX_PAGES;
  const out = [];
  let url = `${origin}/_api/v2.0/me/drive/sharedWithMe`;
  for (let page = 0; url && page < maxPages; page++) {
    const res = await spGet(fetchFn, origin, url, '나와 공유');
    if (res.status === 404) break;
    if (!res.ok) throw errOfStatus(res.status, '나와 공유');
    const j = await res.json().catch(() => null);
    if (!j || typeof j !== 'object' || !Array.isArray(j.value)) throw mkErr('http', '나와 공유 응답이 JSON 이 아닙니다', { status: res.status });
    for (const it of j.value) { const x = sharedItemOf(it); if (x) out.push(x); }
    const next = j['@odata.nextLink'] || j['odata.nextLink'] || '';
    url = typeof next === 'string' && next ? (/^https?:/i.test(next) ? next : `${origin}${next.startsWith('/') ? '' : '/'}${next}`) : '';
    if (url && !inside(url, origin)) break;   // 다른 호스트로 가는 nextLink 는 따르지 않는다
  }
  return out;
};

/* 폴더의 권한(확장 출처 GET — 다이제스트 없음): ListItemAllFields 의 RoleAssignments(Member · RoleDefinitionBindings 펼침)와 HasUniqueRoleAssignments, currentuser(나). 2026-10-19 참여인력 칸의 읽기·편집 체크가 쓴다.
 *   실측(2026-10-19, 내 OneDrive 과제 폴더): 사람(PrincipalType 1)은 Title 이 사이트 사용자 정보의 표시 이름(영문 "MOON Changjae")이고 Email · LoginName(i:0#.f|membership|<이메일>), 역할은 참가(Id 1073741827 · RoleTypeKind 3) — 한글 이름과는 맞춰지지 않으니 **이메일**로 맞춘다(findPeople).
 *   "제한된 액세스"(RoleTypeKind 1 · Hidden)만 있는 항목과 시스템 그룹(Limited Access System Group …)은 빼고, 조직 내 링크의 그룹(SharingLinks.<guid>.OrganizationEdit.<guid>)은 links 에. 밑폴더처럼 상속이면 unique:false 에 아무도 없다.
 *   → { unique(상속 끊김), me:{ id, name, email } | null, people:[{ id(PrincipalId — unshare 에 쓴다), name(표시 이름), email(없으면 LoginName 의 것), login, role, roles:[{ id, name, kind }], me }], links:[{ id, name, role }] }.
 *   role 은 역할들 가운데 가장 센 것(roleOf) — Administrator 5 · WebDesigner 4 → 'owner', Contributor 3 · Editor 6 → 'edit', Reader 2 · RestrictedReader 8 · RestrictedGuest 9 → 'read', 그 밖(None 0 — 사용자 정의) → 'other'. 폴더가 없으면 nofolder, 401/403·로그인 화면 → auth */
const roleOfKind = (k) => (k === 5 || k === 4 ? 'owner' : k === 3 || k === 6 ? 'edit' : k === 2 || k === 8 || k === 9 ? 'read' : 'other');
const ROLE_RANK = { owner: 3, edit: 2, read: 1, other: 0 };
api.roleOf = (roles) => { let best = ''; for (const r of Array.isArray(roles) ? roles : []) { const k = roleOfKind(Number(r && r.kind)); if (!best || ROLE_RANK[k] > ROLE_RANK[best]) best = k; } return best; };
api.permissions = async function (cfg, opts) {
  cfg = api.revive(cfg);
  const fetchFn = (opts && opts.fetch) || g.fetch;
  const sel = ['Id', 'HasUniqueRoleAssignments', 'RoleAssignments/PrincipalId', 'RoleAssignments/Member/Id', 'RoleAssignments/Member/Title', 'RoleAssignments/Member/Email', 'RoleAssignments/Member/LoginName', 'RoleAssignments/Member/PrincipalType',
    'RoleAssignments/RoleDefinitionBindings/Id', 'RoleAssignments/RoleDefinitionBindings/Name', 'RoleAssignments/RoleDefinitionBindings/RoleTypeKind', 'RoleAssignments/RoleDefinitionBindings/Hidden'];
  const what = `권한 ${cfg.folderPath}`;
  const r = await spGet(fetchFn, cfg.origin, `${cfg.folderApi}/ListItemAllFields?$select=${sel.join(',')}&$expand=RoleAssignments/Member,RoleAssignments/RoleDefinitionBindings`, what);
  if (r.status === 404) throw mkErr('nofolder', `공유 폴더가 없습니다: ${cfg.folderPath}`, { path: cfg.folderPath });
  if (!r.ok) throw errOfStatus(r.status, what);
  const j = await r.json().catch(() => null);
  if (!j || typeof j !== 'object') throw mkErr('http', `권한 응답이 JSON 이 아닙니다: ${cfg.folderPath}`, { status: r.status });
  let me = null;
  try {
    const mr = await spGet(fetchFn, cfg.origin, `${cfg.api}/currentuser?$select=Id,Title,Email`, '내 사용자');
    const mj = mr.ok ? await mr.json().catch(() => null) : null;
    if (mj && mj.Id != null) me = { id: Number(mj.Id), name: String(mj.Title || ''), email: String(mj.Email || '') };
  } catch (e) { me = null; }   // 나를 못 알아내도 권한 목록은 보인다
  const emailOfLogin = (s) => { const m = /\|([^|@\s]+@[^|\s]+)$/.exec(String(s || '')); return m ? m[1] : ''; };
  const people = [], links = [];
  for (const ra of Array.isArray(j.RoleAssignments) ? j.RoleAssignments : []) {
    const mb = (ra && ra.Member) || {};
    const id = Number(ra && ra.PrincipalId != null ? ra.PrincipalId : mb.Id);
    const roles = (Array.isArray(ra && ra.RoleDefinitionBindings) ? ra.RoleDefinitionBindings : []).filter((b) => b && !b.Hidden && Number(b.RoleTypeKind) !== 1).map((b) => ({ id: Number(b.Id), name: String(b.Name || ''), kind: Number(b.RoleTypeKind) || 0 }));
    if (!(id > 0) || !roles.length) continue;
    const title = String(mb.Title || ''), role = api.roleOf(roles);
    if (Number(mb.PrincipalType) === 1) people.push({ id, name: title, email: String(mb.Email || '') || emailOfLogin(mb.LoginName), login: String(mb.LoginName || ''), role, roles, me: !!(me && me.id === id) });
    else if (/^SharingLinks\./i.test(title)) links.push({ id, name: title, role });
  }
  return { unique: j.HasUniqueRoleAssignments === true, me, people, links };
};
/* 이름(또는 이메일)으로 사람 찾기 — 사이트 search REST 의 People 결과 원본(확장 출처 GET, 다이제스트 없음): <apiRoot>/search/query?querytext='…'&sourceid='<PEOPLE_SOURCE>'&selectproperties='PreferredName,WorkEmail,AccountName'.
 *   실측(2026-10-19): 한글 이름 '문창재' → PreferredName 'MOON Changjae' · WorkEmail · AccountName(i:0#.f|membership|<이메일>) 1줄 — 표시 이름이 영문이라 피커(sharePeople 의 이름 맞추기)로는 못 찾는 사람도 여기서는 찾힌다.
 *   게스트 계정(AccountName 에 #ext# — 외부 초대, gmail 등)은 조직 사용자 줄이 하나라도 있으면 뺀다(2026-10-20 '이은주' 가 gmail 게스트로 풀린 일; 게스트뿐이면 외부 참여자로 보고 그대로). 1명이면 그 사람(표시 이름이 질문과 달라도), 여럿이면 PreferredName·이메일이 질문과 꼭 같은(공백·대소문자 무시) 1명, 아니면 ambiguous(후보 "이름 <이메일>"), 없으면 notFound. 이메일이 없는 줄은 세지 않는다.
 *   → { found:[{ name(질문), title, email, login }], ambiguous:[{ name, candidates:[…] }], notFound:[name] }. 401/403·로그인 화면 → auth. 응답은 nometadata(PrimaryQueryResult.RelevantResults.Table.Rows[].Cells[])·verbose(d.query … .results) 둘 다 읽는다 */
api.findPeople = async function (cfg, names, opts) {
  cfg = api.revive(cfg);
  const fetchFn = (opts && opts.fetch) || g.fetch;
  const list = Array.from(new Set((Array.isArray(names) ? names : names == null ? [] : [names]).map((x) => String(x == null ? '' : x).trim()).filter(Boolean)));
  const found = [], ambiguous = [], notFound = [];
  const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const arr = (v) => (Array.isArray(v) ? v : v && Array.isArray(v.results) ? v.results : []);
  for (const name of list) {
    const what = `사람 찾기 ${name}`;
    const r = await spGet(fetchFn, cfg.origin, `${cfg.apiRoot}/search/query?querytext='${encLit(name)}'&sourceid='${PEOPLE_SOURCE}'&selectproperties='PreferredName,WorkEmail,AccountName'&rowlimit=10`, what);
    if (!r.ok) throw errOfStatus(r.status, what);
    const j = (await r.json().catch(() => null)) || {};
    const q = (j.d && j.d.query) || j;
    const table = q.PrimaryQueryResult && q.PrimaryQueryResult.RelevantResults && q.PrimaryQueryResult.RelevantResults.Table;
    let rows = arr(table && table.Rows).map((row) => {
      const o = {};
      for (const c of arr(row && row.Cells)) if (c && c.Key) o[c.Key] = c.Value == null ? '' : String(c.Value);
      return { title: o.PreferredName || '', email: o.WorkEmail || '', login: o.AccountName || '' };
    }).filter((x) => x.email);
    const members = rows.filter((x) => !/#ext#/i.test(x.login));   // 게스트(외부 초대 — AccountName …#ext#@…)는 조직 사용자가 있으면 뺀다: 2026-10-20 실측 '이은주' → 'LEE Eunjoo' <ejlee@krs.co.kr> 와 게스트 '이은주' <…@gmail.com> 둘이 와 이름이 꼭 같은 게스트를 골랐다. 게스트뿐이면(외부 참여자) 그대로
    if (members.length) rows = members;
    const exact = rows.filter((x) => norm(x.title) === norm(name) || norm(x.email) === norm(name));
    const hit = rows.length === 1 ? rows[0] : exact.length === 1 ? exact[0] : null;
    if (hit) found.push({ name, title: hit.title, email: hit.email, login: hit.login });
    else if (rows.length) ambiguous.push({ name, candidates: rows.map((x) => `${x.title} <${x.email}>`) });
    else notFound.push(name);
  }
  return { found, ambiguous, notFound };
};

/* 파일 하나 → { text, meta:{ version, modified, length, uniqueId, checkedOut, checkedOutByMe } } | null(없음).
 *   checkedOut = CheckOutType ≠ 2. 체크아웃돼 있으면 CheckedOutByUser 와 currentuser 의 Id 를 견줘 checkedOutByMe — 내가 잡고 있으면 $value 는 (남에게는 안 보이는) 내 초안이라,
 *   부르는 쪽(prjdoc-sync)이 내용이 같아도 writer.modify 로 이어받아 체크인해야 한다(지난 쓰기가 끊긴 자리). 누가 잡았는지 못 알아내면 내 것으로 치고(modify 가 locked 로 가른다) */
api.readFile = async function (cfg, name, opts) {
  cfg = api.revive(cfg);
  const fetchFn = (opts && opts.fetch) || g.fetch;
  const fileApi = api.fileApi(cfg, name);
  const mr = await spGet(fetchFn, cfg.origin, `${fileApi}?$select=Exists,CheckOutType,UniqueId,Length,TimeLastModified,UIVersionLabel`, `파일 정보 ${name}`);
  if (mr.status === 404) return null;
  if (!mr.ok) throw errOfStatus(mr.status, `파일 정보 ${name}`);
  const m = await mr.json().catch(() => null);
  if (!m || typeof m !== 'object') throw mkErr('http', `파일 정보 응답이 JSON 이 아닙니다: ${name}`, { status: mr.status });
  if (m.Exists === false) return null;
  const checkedOut = m.CheckOutType != null && Number(m.CheckOutType) !== 2;
  let checkedOutByMe = false;
  if (checkedOut) {
    const idOf = async (url, what) => { const r = await spGet(fetchFn, cfg.origin, url, what); const j = r.ok ? await r.json().catch(() => null) : null; return j && j.Id != null ? String(j.Id) : ''; };
    const [me, by] = await Promise.all([idOf(`${cfg.api}/currentuser?$select=Id`, '내 사용자'), idOf(`${fileApi}/CheckedOutByUser?$select=Id`, `체크아웃한 사람 ${name}`)]);
    checkedOutByMe = !me || !by || me === by;
  }
  const vr = await spGet(fetchFn, cfg.origin, `${fileApi}/$value`, `읽기 ${name}`, 'application/json,text/plain,*/*');
  if (vr.status === 404) return null;
  if (!vr.ok) throw errOfStatus(vr.status, `읽기 ${name}`);
  return { text: await vr.text(), meta: Object.assign(metaOf(m), { checkedOut, checkedOutByMe }) };
};

/* 목록 항목 읽기(확장 출처 GET — 참여연구원 자료 요청의 응답, lib/collect.js responsesOfItems · background.js collectFetch): <siteUrl>/_api/web/lists(guid'<id>')/items?$select=Id,Title,<fields…>,Created,Modified,Author/Title,Author/EMail&$expand=Author&$orderby=Modified desc&$top=500
 *   → [{ Id, Title, …, Created, Modified, Author:{ Title, EMail } }](nometadata value · verbose d.results 둘 다). 목록이 없으면(404) kind 'notfound', 401/403·로그인 화면 → auth. opts(io) = { fetch }, o = { fields:[내부 이름(영문)…], top } */
api.listItems = async function (siteUrl, listId, opts, o) {
  const fetchFn = (opts && opts.fetch) || g.fetch;
  o = o || {};
  let origin, site;
  try { const u = new URL(String(siteUrl)); origin = u.origin; site = `${u.origin}${u.pathname.replace(/\/+$/, '')}`; } catch (e) { badurl('사이트 주소(siteUrl)가 주소 모양이 아닙니다'); }
  const id = String(listId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) badurl('목록 Id 가 GUID 모양이 아닙니다');
  const fields = (Array.isArray(o.fields) ? o.fields : []).map((f) => String(f).replace(/[^A-Za-z0-9_]/g, '')).filter(Boolean);
  const sel = ['Id', 'Title'].concat(fields, ['Created', 'Modified', 'Author/Title', 'Author/EMail']);
  const top = o.top > 0 ? Math.min(5000, Number(o.top)) : 500;
  const what = `목록 항목 ${id}`;
  const res = await spGet(fetchFn, origin, `${site}/_api/web/lists(guid'${encLit(id)}')/items?$select=${sel.join(',')}&$expand=Author&$orderby=Modified%20desc&$top=${top}`, what);
  if (res.status === 404) throw mkErr('notfound', `${what}: 목록이 없습니다 (404) — 지워졌거나 재활용통에 있습니다`, { status: 404 });
  if (!res.ok) throw errOfStatus(res.status, what);
  const j = await res.json().catch(() => null);
  const list = j && Array.isArray(j.value) ? j.value : j && j.d && Array.isArray(j.d.results) ? j.d.results : null;
  if (!list) throw mkErr('http', `${what} 응답이 JSON 이 아닙니다`, { status: res.status });
  return list;
};

/* 목록 정보(Id 로) — { id, title, path(RootFolder 서버 상대 경로), newFormUrl, viewUrl }. 공유(ShareObject)는 이 경로로 가므로 저장된 경로 대신 매번 이것을 쓴다(저장본이 틀리거나 목록 이름이 바뀌어도). 404 → notfound */
api.listInfo = async function (siteUrl, listId, opts) {
  const fetchFn = (opts && opts.fetch) || g.fetch;
  let origin, site;
  try { const u = new URL(String(siteUrl)); origin = u.origin; site = `${u.origin}${u.pathname.replace(/\/+$/, '')}`; } catch (e) { badurl('사이트 주소(siteUrl)가 주소 모양이 아닙니다'); }
  const id = String(listId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) badurl('목록 Id 가 GUID 모양이 아닙니다');
  const what = `목록 정보 ${id}`;
  const res = await spGet(fetchFn, origin, `${site}/_api/web/lists(guid'${encLit(id)}')?$select=Id,Title,DefaultNewFormUrl,DefaultViewUrl,RootFolder/ServerRelativeUrl&$expand=RootFolder`, what);
  if (res.status === 404) throw mkErr('notfound', `${what}: 목록이 없습니다 (404) — 지워졌거나 재활용통에 있습니다`, { status: 404 });
  if (!res.ok) throw errOfStatus(res.status, what);
  const j = await res.json().catch(() => null), d = (j && j.d) || j;
  if (!d || typeof d !== 'object') throw mkErr('http', `${what} 응답이 JSON 이 아닙니다`, { status: res.status });
  return { id: String(d.Id || ''), title: String(d.Title || ''), path: String((d.RootFolder && d.RootFolder.ServerRelativeUrl) || ''), newFormUrl: String(d.DefaultNewFormUrl || ''), viewUrl: String(d.DefaultViewUrl || '') };
};

/* ---------- 페이지 안에서 도는 함수(사이트 출처, chrome.scripting.executeScript world:'MAIN' 으로 주입) — 바깥 변수 참조 금지, 결과는 JSON ---------- */

/* 다이제스트를 싣는 호출(POST/PUT)의 실패 코드 — 만료·거부된 다이제스트는 403 + "The security validation for this page is invalid …"(-2130575251) 로 오므로 'digest'(writer 가 다시 받아 한 번 더 돈다). 각 페이지 함수 안에 같은 한 줄이 있다(바깥 참조 금지) */
/* [페이지] 요청 다이제스트 → { ok, digest, timeoutSec(FormDigestTimeoutSeconds) } */
async function spDigest(a) {
  const fail = (code, error, status) => ({ ok: false, code, error, status });
  const codeOf = (s) => (s === 401 || s === 403 ? 'auth' : s === 404 ? 'notfound' : 'http');
  try {
    const r = await fetch(`${a.apiRoot}/contextinfo`, { method: 'POST', headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' });
    if (!r.ok) return fail(codeOf(r.status), `contextinfo ${r.status}`, r.status);
    const j = (await r.json().catch(() => null)) || {};
    const info = j.FormDigestValue ? j : (j.d && j.d.GetContextWebInformation) || {};
    const digest = info.FormDigestValue || '';
    if (!digest) return fail('http', '요청 다이제스트를 받지 못했습니다');
    return { ok: true, digest, timeoutSec: Number(info.FormDigestTimeoutSeconds) || 0 };
  } catch (e) { return fail('offline', String((e && e.message) || e)); }
}

/* [페이지] 폴더 확인·생성(여러 단): Exists → 없으면 위로 올라가며 있는 상위를 찾고(a.stop = 문서함 뿌리 — 이 위로는 올라가지 않으며 뿌리도 없으면 nofolder; stop 이 없으면 한 단만), 거기서부터 단마다 Folders/add('이름')
 *   → { ok, created(하나라도 만들었나), made:[만든 경로…] }. 다이제스트 거부로 다시 돌면 이미 만든 단은 Exists 로 건너뛴다 */
async function spEnsureFolder(a) {
  const J = { Accept: 'application/json;odata=nometadata' };
  const H = { Accept: J.Accept, 'X-RequestDigest': a.digest };
  const fail = (code, error, status) => ({ ok: false, code, error, status });
  const codeOf = (s) => (s === 401 || s === 403 ? 'auth' : s === 404 ? 'notfound' : 'http');
  const codeOfRes = async (r) => (r.status === 403 && /security validation|2130575251/i.test(await r.text().catch(() => '')) ? 'digest' : codeOf(r.status));
  const lit = (p) => encodeURIComponent(String(p).replace(/'/g, "''"));
  const folderApi = (p) => `${a.api}/GetFolderByServerRelativePath(decodedurl='${lit(p)}')`;
  const exists = async (p) => {
    const r = await fetch(`${folderApi(p)}?$select=Exists`, { headers: J, credentials: 'include', cache: 'no-store' });
    if (r.status === 404) return false;
    if (!r.ok) throw Object.assign(new Error(`폴더 정보 ${r.status}`), { code: codeOf(r.status), status: r.status });
    const j = (await r.json().catch(() => null)) || {};
    return j.Exists !== false;   // GetFolder… 는 없는 폴더에도 200 + Exists:false
  };
  try {
    const segs = String(a.folderPath || '').split('/').filter(Boolean);
    if (!segs.length) return fail('nofolder', '폴더 경로가 비어 있습니다');
    const at = (d) => `/${segs.slice(0, d).join('/')}`;
    const stopDepth = Math.max(1, a.stop ? String(a.stop).split('/').filter(Boolean).length : segs.length - 1);
    let d = segs.length;   // 있는 가장 깊은 단을 찾는다
    for (;;) {
      if (await exists(at(d))) break;
      if (d <= stopDepth) return fail('nofolder', `상위 폴더가 없습니다: ${at(d)}`);
      d--;
    }
    const made = [];
    for (let i = d; i < segs.length; i++) {
      const r = await fetch(`${folderApi(at(i))}/Folders/add('${lit(segs[i])}')`, { method: 'POST', headers: H, credentials: 'include' });
      if (!r.ok) return fail(await codeOfRes(r), `폴더 만들기 ${r.status}: ${at(i + 1)}`, r.status);
      made.push(at(i + 1));
    }
    return { ok: true, created: made.length > 0, made };
  } catch (e) { return fail((e && e.code) || 'offline', String((e && e.message) || e), e && e.status); }
}

/* [페이지] 사람 찾기 + 폴더 공유 → { ok, shared:[{ name, email }], ambiguous:[{ name, candidates:[표시 이름] }], notFound:[이름], failed:[{ name, email, error }], error? }.
 *   이름마다 ClientPeoplePickerWebServiceInterface.clientPeoplePickerSearchUser(PrincipalType 1 사용자 · 최대 10) — 결과 가운데 표시 이름이 질문한 이름과 꼭 같은(공백 무시) 1명이 있을 때만 그 사람, 아니면(1명이어도 이름이 다름 · 동명이인) ambiguous, 0명이면 notFound.
 *   1명이라고 바로 받지 않는 까닭: 참여인력 이름이 디렉터리에 없을 때(퇴직·외부) 접두 일치로 비슷한 이름 한 사람이 와서 그 사람에게 편집 권한을 주게 된다(자동 공유는 사람이 보지 않고 돈다).
 *   모인 사람들을 SP.Web.ShareObject(url = 폴더 절대 주소, peoplePickerInput = 피커 결과 JSON 문자열, roleValue, sendEmail:false) 한 번에 — HTTP 실패나 StatusCode ≠ 0 이면 한 명씩 다시 돌려 안 되는 사람만 failed.
 *   피커의 Key(로그인 이름)는 이 함수 안에만 있고 결과에는 표시 이름·이메일만. 응답은 odata=verbose(d.ShareObject · d.ClientPeoplePickerSearchUser)와 nometadata(value) 둘 다 읽는다 */
async function spSharePeople(a) {
  const V = 'application/json;odata=verbose';
  const fail = (code, error, status) => ({ ok: false, code, error, status });
  const codeOf = (s) => (s === 401 || s === 403 ? 'auth' : s === 404 ? 'notfound' : 'http');
  const snip = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const post = (url, body) => fetch(url, { method: 'POST', headers: { Accept: V, 'Content-Type': V, 'X-RequestDigest': a.digest }, body: JSON.stringify(body), credentials: 'include' });
  try {
    const picked = [], ambiguous = [], notFound = [], seen = new Set();
    for (const raw of Array.isArray(a.names) ? a.names : []) {
      const name = String(raw == null ? '' : raw).trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const r = await post(`${a.apiRoot}/SP.UI.ApplicationPages.ClientPeoplePickerWebServiceInterface.clientPeoplePickerSearchUser`,
        { queryParams: { AllowEmailAddresses: true, AllowMultipleEntities: false, AllUrlZones: false, MaximumEntitySuggestions: 10, PrincipalSource: 15, PrincipalType: 1, QueryString: name } });
      if (!r.ok) { const body = await r.text().catch(() => ''); return fail(r.status === 403 && /security validation|2130575251/i.test(body) ? 'digest' : codeOf(r.status), `사람 찾기 ${r.status}: ${snip(body)}`, r.status); }
      const j = (await r.json().catch(() => null)) || {};
      const packed = typeof j.value === 'string' ? j.value : j.d && typeof j.d.ClientPeoplePickerSearchUser === 'string' ? j.d.ClientPeoplePickerSearchUser : Array.isArray(j.value) ? j.value : Array.isArray(j) ? j : '[]';
      let list = [];
      try { list = typeof packed === 'string' ? JSON.parse(packed) : packed; } catch (e) { list = []; }
      list = (Array.isArray(list) ? list : []).filter((x) => x && x.Key && (!x.EntityType || x.EntityType === 'User'));
      // 질문이 이메일이면(2026-10-19 — 사이트 사용자 정보의 표시 이름이 영문이라 한글 이름으로는 못 맞추는 사람을 findPeople 의 이메일로 공유) EntityData.Email 또는 Key 의 끝(|<이메일>)이 꼭 같은 1명, 아니면 표시 이름이 꼭 같은(공백 무시) 1명
      const isMail = /^[^\s@]+@[^\s@]+$/.test(name);
      const same = (s) => String(s || '').replace(/\s+/g, '') === name.replace(/\s+/g, '');
      const byMail = (x) => String((x.EntityData && x.EntityData.Email) || '').toLowerCase() === name.toLowerCase() || String(x.Key || '').toLowerCase().endsWith(`|${name.toLowerCase()}`);
      const exact = list.filter((x) => (isMail ? byMail(x) : same(x.DisplayText)));
      const hit = exact.length === 1 ? exact[0] : null;   // 1명이 와도 이름이 다르면(접두 일치) 받지 않는다
      if (hit) picked.push({ name, entry: hit });
      else if (list.length) ambiguous.push({ name, candidates: list.map((x) => String(x.DisplayText || '')) });
      else notFound.push(name);
    }
    const person = (p) => ({ name: String(p.entry.DisplayText || p.name), email: String((p.entry.EntityData && p.entry.EntityData.Email) || '') });
    const share = async (ps) => {
      const r = await post(`${a.apiRoot}/SP.Web.ShareObject`, { url: a.url, peoplePickerInput: JSON.stringify(ps.map((p) => p.entry)), roleValue: a.roleValue, groupId: 0, propagateAcl: false, sendEmail: !!a.sendEmail, includeAnonymousLinkInEmail: false, emailSubject: String(a.emailSubject || ''), emailBody: String(a.emailBody || '') });
      const body = await r.text().catch(() => '');
      if (!r.ok) return { digest: r.status === 403 && /security validation|2130575251/i.test(body), auth: r.status === 401, error: `공유 ${r.status}: ${snip(body)}`, status: r.status };
      let j = null;
      try { j = JSON.parse(body); } catch (e) { j = null; }
      const res = (j && j.d && (j.d.ShareObject || j.d)) || j || {};
      if (res.StatusCode != null && Number(res.StatusCode) !== 0) return { error: `공유 실패(StatusCode ${res.StatusCode}): ${snip(res.ErrorMessage || '')}` };
      return { ok: true };
    };
    const shared = [], failed = [];
    if (picked.length) {
      let r = await share(picked);
      if (r.digest) return fail('digest', r.error, r.status);
      if (r.auth) return fail('auth', r.error, r.status);
      if (r.ok) shared.push(...picked.map(person));
      else if (picked.length === 1) failed.push(Object.assign(person(picked[0]), { error: r.error }));
      else {
        for (const p of picked) {
          r = await share([p]);
          if (r.digest) return fail('digest', r.error, r.status);
          if (r.auth) return fail('auth', r.error, r.status);
          if (r.ok) shared.push(person(p)); else failed.push(Object.assign(person(p), { error: r.error }));
        }
      }
    }
    const out = { ok: true, shared, ambiguous, notFound, failed };
    if (failed.length) out.error = failed.map((f) => `${f.name}: ${f.error}`).join(' · ');
    return out;
  } catch (e) { return fail('offline', String((e && e.message) || e)); }
}

/* [페이지] 사람(PrincipalId)의 권한 거두기(2026-10-19 참여인력 칸의 읽기·편집 체크): RoleAssignments/GetByPrincipalId(id)/RoleDefinitionBindings 로 묶인 역할을 읽고(404 → 그 사람은 missing)
 *   Hidden·제한된 액세스(RoleTypeKind 1)가 아닌 역할마다 RoleAssignments/RemoveRoleAssignment(principalid=…,roledefid=…) → { ok, removed:[{ id, roles:[역할 id…] }], missing:[id…] }.
 *   다이제스트 거부 → 'digest'(writer 가 다시 받아 한 번 더 — 이미 거둔 역할은 다시 읽히지 않으니 그대로). 역할을 거둔 사람의 "제한된 액세스"는 SharePoint 가 알아서 둔다 */
async function spUnshare(a) {
  const J = { Accept: 'application/json;odata=nometadata' };
  const H = { Accept: J.Accept, 'X-RequestDigest': a.digest };
  const fail = (code, error, status) => ({ ok: false, code, error, status });
  const codeOf = (s) => (s === 401 || s === 403 ? 'auth' : s === 404 ? 'notfound' : 'http');
  const snip = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const lit = (p) => encodeURIComponent(String(p).replace(/'/g, "''"));
  const isDigest = (r, body) => r.status === 403 && /security validation|2130575251/i.test(body);
  try {
    const itemApi = `${a.api}/GetFolderByServerRelativePath(decodedurl='${lit(a.folderPath)}')/ListItemAllFields`;
    const removed = [], missing = [];
    for (const raw of Array.isArray(a.ids) ? a.ids : []) {
      const id = Number(raw);
      if (!(id > 0)) continue;
      const br = await fetch(`${itemApi}/RoleAssignments/GetByPrincipalId(${id})/RoleDefinitionBindings?$select=Id,RoleTypeKind,Hidden`, { headers: J, credentials: 'include', cache: 'no-store' });
      if (br.status === 404) { missing.push(id); continue; }
      if (!br.ok) return fail(codeOf(br.status), `권한 읽기 ${br.status}`, br.status);
      const bj = (await br.json().catch(() => null)) || {};
      const roles = (Array.isArray(bj.value) ? bj.value : []).filter((b) => b && !b.Hidden && Number(b.RoleTypeKind) !== 1).map((b) => Number(b.Id)).filter((n) => n > 0);
      const done = [];
      for (const rid of roles) {
        const r = await fetch(`${itemApi}/RoleAssignments/RemoveRoleAssignment(principalid=${id},roledefid=${rid})`, { method: 'POST', headers: H, credentials: 'include' });
        if (!r.ok) {
          const body = await r.text().catch(() => '');
          if (isDigest(r, body)) return fail('digest', `권한 거두기 ${r.status}`, r.status);
          return fail(codeOf(r.status), `권한 거두기 ${r.status}: ${snip(body)}`, r.status);
        }
        done.push(rid);
      }
      removed.push({ id, roles: done });
    }
    return { ok: true, removed, missing };
  } catch (e) { return fail('offline', String((e && e.message) || e)); }
}

/* [페이지] 조직 내 공유 링크: 폴더의 ListItemAllFields(Id · ParentList/Id) → Lists(guid'…')/GetItemById(…)/ShareLink { request:{ createLink:true, settings:{ linkKind: 3 편집 | 2 보기, expiration:null } } } → sharingLinkInfo.Url;
 *   안 되면 SP.Web.CreateOrganizationSharingLink { url, isEditLink } → value. 둘 다 안 되면 http 에 본문 요지 → { ok, url, via } */
async function spOrgLink(a) {
  const J = { Accept: 'application/json;odata=nometadata' };
  const H = { Accept: J.Accept, 'Content-Type': 'application/json;odata=nometadata', 'X-RequestDigest': a.digest };
  const fail = (code, error, status) => ({ ok: false, code, error, status });
  const snip = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const lit = (p) => encodeURIComponent(String(p).replace(/'/g, "''"));
  const isDigest = (r, body) => r.status === 403 && /security validation|2130575251/i.test(body);
  try {
    const tried = [];
    const mr = await fetch(`${a.api}/GetFolderByServerRelativePath(decodedurl='${lit(a.folderPath)}')/ListItemAllFields?$select=Id,ParentList/Id&$expand=ParentList`, { headers: J, credentials: 'include', cache: 'no-store' });
    if (mr.status === 401) return fail('auth', '항목 정보 401', 401);
    const m = mr.ok ? ((await mr.json().catch(() => null)) || {}) : {};
    const itemId = m.Id, listId = m.ParentList && m.ParentList.Id;
    if (mr.ok && itemId != null && listId) {
      const r = await fetch(`${a.api}/Lists(guid'${lit(listId)}')/GetItemById(${Number(itemId)})/ShareLink`, { method: 'POST', headers: H, body: JSON.stringify({ request: { createLink: true, settings: { linkKind: a.edit ? 3 : 2, expiration: null } } }), credentials: 'include' });
      const body = await r.text().catch(() => '');
      if (isDigest(r, body)) return fail('digest', 'ShareLink 403', 403);
      let j = null;
      try { j = JSON.parse(body); } catch (e) { j = null; }
      const info = j && (j.sharingLinkInfo || (j.d && j.d.ShareLink && j.d.ShareLink.sharingLinkInfo) || (j.d && j.d.sharingLinkInfo)) || null;
      if (r.ok && info && info.Url) return { ok: true, url: String(info.Url), via: 'ShareLink' };
      tried.push(`ShareLink ${r.status}: ${snip((info && info.ErrorMessage) || body)}`);
    } else tried.push(`항목 정보 ${mr.status}${mr.ok ? ' (Id·ParentList 없음)' : ''}`);
    const r2 = await fetch(`${a.apiRoot}/SP.Web.CreateOrganizationSharingLink`, { method: 'POST', headers: H, body: JSON.stringify({ url: a.url, isEditLink: !!a.edit }), credentials: 'include' });
    const body2 = await r2.text().catch(() => '');
    if (isDigest(r2, body2)) return fail('digest', 'CreateOrganizationSharingLink 403', 403);
    let j2 = null;
    try { j2 = JSON.parse(body2); } catch (e) { j2 = null; }
    const url2 = j2 && (typeof j2.value === 'string' ? j2.value : j2.d && (j2.d.CreateOrganizationSharingLink || j2.d.value));
    if (r2.ok && url2) return { ok: true, url: String(url2), via: 'CreateOrganizationSharingLink' };
    tried.push(`CreateOrganizationSharingLink ${r2.status}: ${snip(body2)}`);
    return fail(r2.status === 401 ? 'auth' : 'http', `조직 내 링크를 만들지 못했습니다 — ${tried.join(' · ')}`, r2.status);
  } catch (e) { return fail('offline', String((e && e.message) || e)); }
}

/* [페이지] 폴더 이름 바꾸기: 새 경로가 이미 있으면 code 'exists' → MoveTo(newUrl='…') → 끝점이 없으면(400·404) MoveToUsingPath(DecodedUrl='…') → { ok, path, via }. 403(다이제스트 아님)·그 밖은 http 에 본문 요지 */
async function spRename(a) {
  const J = { Accept: 'application/json;odata=nometadata' };
  const H = { Accept: J.Accept, 'X-RequestDigest': a.digest };
  const fail = (code, error, status) => ({ ok: false, code, error, status });
  const snip = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const lit = (p) => encodeURIComponent(String(p).replace(/'/g, "''"));
  const isDigest = (r, body) => r.status === 403 && /security validation|2130575251/i.test(body);
  try {
    const folderApi = `${a.api}/GetFolderByServerRelativePath(decodedurl='${lit(a.folderPath)}')`;
    const er = await fetch(`${a.api}/GetFolderByServerRelativePath(decodedurl='${lit(a.newPath)}')?$select=Exists`, { headers: J, credentials: 'include', cache: 'no-store' });
    if (er.status === 401) return fail('auth', '폴더 정보 401', 401);
    const ej = er.ok ? ((await er.json().catch(() => null)) || {}) : {};
    if (er.ok && ej.Exists === true) return fail('exists', `같은 이름의 폴더가 이미 있습니다: ${a.newPath}`, 409);
    const r = await fetch(`${folderApi}/MoveTo(newUrl='${lit(a.newPath)}')`, { method: 'POST', headers: H, credentials: 'include' });
    if (r.ok) return { ok: true, path: a.newPath, via: 'MoveTo' };
    const body = await r.text().catch(() => '');
    if (isDigest(r, body)) return fail('digest', `이름 바꾸기 ${r.status}`, r.status);
    if (r.status === 400 || r.status === 404) {
      const r2 = await fetch(`${folderApi}/MoveToUsingPath(DecodedUrl='${lit(a.newPath)}')`, { method: 'POST', headers: H, credentials: 'include' });
      if (r2.ok) return { ok: true, path: a.newPath, via: 'MoveToUsingPath' };
      const body2 = await r2.text().catch(() => '');
      if (isDigest(r2, body2)) return fail('digest', `이름 바꾸기 ${r2.status}`, r2.status);
      return fail(r2.status === 401 ? 'auth' : r2.status === 404 ? 'notfound' : 'http', `이름 바꾸기 ${r2.status}: ${snip(body2)}`, r2.status);
    }
    return fail(r.status === 401 ? 'auth' : 'http', `이름 바꾸기 ${r.status}: ${snip(body)}`, r.status);
  } catch (e) { return fail('offline', String((e && e.message) || e)); }
}

/* [페이지] 쓰기 1단계: 파일 정보 → 없으면 { ok, exists:false } · 남이 잡고 있으면 locked · 아니면 CheckOut(내가 잡고 있던 것은 이어서 — resumed:true) → $value 읽기 → { ok, exists:true, resumed, text, meta } */
async function spBegin(a) {
  const J = { Accept: 'application/json;odata=nometadata' };
  const H = { Accept: J.Accept, 'X-RequestDigest': a.digest };
  const fail = (code, error, status) => ({ ok: false, code, error, status });
  const codeOf = (s) => (s === 401 || s === 403 ? 'auth' : s === 404 ? 'notfound' : s === 423 ? 'locked' : 'http');
  const codeOfRes = async (r) => (r.status === 403 && /security validation|2130575251/i.test(await r.text().catch(() => '')) ? 'digest' : codeOf(r.status));
  try {
    const mr = await fetch(`${a.fileApi}?$select=Exists,CheckOutType,UniqueId,UIVersionLabel,Length,TimeLastModified`, { headers: J, credentials: 'include', cache: 'no-store' });
    if (mr.status === 404) return { ok: true, exists: false };
    if (!mr.ok) return fail(codeOf(mr.status), `파일 정보 ${mr.status}`, mr.status);
    const m = (await mr.json().catch(() => null)) || {};
    if (m.Exists === false) return { ok: true, exists: false };
    const meta = { uniqueId: m.UniqueId, version: m.UIVersionLabel, length: m.Length, modified: m.TimeLastModified };
    let resumed = false;
    if (m.CheckOutType === 2 || m.CheckOutType == null) {   // 2 = 체크아웃 안 됨
      const cr = await fetch(`${a.fileApi}/CheckOut()`, { method: 'POST', headers: H, credentials: 'include' });
      if (!cr.ok) return fail(cr.status === 423 || cr.status === 409 ? 'locked' : await codeOfRes(cr), `체크아웃 ${cr.status}`, cr.status);
    } else {
      // 누가 잡고 있나 — 나면 이어서(지난번에 끊긴 체크아웃 — $value 는 그때 올라간 내 초안), 남이면 locked
      const [me, by] = await Promise.all([
        fetch(`${a.api}/currentuser?$select=Id`, { headers: J, credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${a.fileApi}/CheckedOutByUser?$select=Id,Email,Title`, { headers: J, credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]);
      if (!me || !by || me.Id == null || me.Id !== by.Id) return fail('locked', `다른 사람이 편집 중(체크아웃)입니다: ${(by && (by.Title || by.Email)) || '?'}`);
      resumed = true;
    }
    const vr = await fetch(`${a.fileApi}/$value`, { credentials: 'include', cache: 'no-store' });
    if (!vr.ok) {
      if (!resumed) await fetch(`${a.fileApi}/UndoCheckOut()`, { method: 'POST', headers: H, credentials: 'include' }).catch(() => {});   // 이어받은 초안은 버리지 않는다
      return fail(codeOf(vr.status), `읽기 ${vr.status}`, vr.status);
    }
    return { ok: true, exists: true, resumed, text: await vr.text(), meta };
  } catch (e) { return fail('offline', String((e && e.message) || e)); }
}

/* [페이지] 쓰기 2단계: PUT $value(checkInOnly 면 건너뜀 — 이어받은 초안을 그대로 체크인) → CheckIn(주 버전) → 파일 정보. PUT 실패면 UndoCheckOut → { ok, put, checkIn, meta } */
async function spCommit(a) {
  const J = { Accept: 'application/json;odata=nometadata' };
  const H = { Accept: J.Accept, 'X-RequestDigest': a.digest };
  const fail = (code, error, status) => ({ ok: false, code, error, status });
  const codeOf = (s) => (s === 401 || s === 403 ? 'auth' : s === 404 ? 'notfound' : s === 423 ? 'locked' : 'http');
  const codeOfRes = async (r) => (r.status === 403 && /security validation|2130575251/i.test(await r.text().catch(() => '')) ? 'digest' : codeOf(r.status));
  try {
    let put = null;
    if (!a.checkInOnly) {
      const pr = await fetch(`${a.fileApi}/$value`, { method: 'PUT', headers: { Accept: H.Accept, 'X-RequestDigest': H['X-RequestDigest'], 'Content-Type': 'application/json; charset=utf-8' }, body: a.text, credentials: 'include' });
      if (!pr.ok) {
        const code = await codeOfRes(pr);
        if (code !== 'digest') await fetch(`${a.fileApi}/UndoCheckOut()`, { method: 'POST', headers: H, credentials: 'include' }).catch(() => {});   // 다이제스트 탓이면 되돌리기도 안 되고, 새 다이제스트로 다시 PUT 한다
        return fail(code, `쓰기 ${pr.status}`, pr.status);
      }
      put = pr.status;
    }
    const c = encodeURIComponent(String(a.comment || '').slice(0, 200).replace(/'/g, "''"));
    const ir = await fetch(`${a.fileApi}/CheckIn(comment='${c}',checkintype=1)`, { method: 'POST', headers: H, credentials: 'include' });
    if (!ir.ok) return fail(await codeOfRes(ir), `체크인 ${ir.status} — 내용은 올라갔고 체크아웃이 남았습니다(다음 쓰기가 이어받아 체크인)`, ir.status);
    const mr = await fetch(`${a.fileApi}?$select=UniqueId,UIVersionLabel,Length,TimeLastModified`, { headers: J, credentials: 'include', cache: 'no-store' }).catch(() => null);
    const m = mr && mr.ok ? ((await mr.json().catch(() => null)) || {}) : {};
    return { ok: true, put, checkIn: ir.status, meta: { uniqueId: m.UniqueId, version: m.UIVersionLabel, length: m.Length, modified: m.TimeLastModified } };
  } catch (e) { return fail('offline', String((e && e.message) || e)); }
}

/* [페이지] 체크아웃 되돌리기(변경 없음·변환 실패) → { ok, status } (실패면 code 도) */
async function spRelease(a) {
  const codeOf = (s) => (s === 401 || s === 403 ? 'auth' : s === 404 ? 'notfound' : s === 423 ? 'locked' : 'http');
  const codeOfRes = async (r) => (r.status === 403 && /security validation|2130575251/i.test(await r.text().catch(() => '')) ? 'digest' : codeOf(r.status));
  try {
    const r = await fetch(`${a.fileApi}/UndoCheckOut()`, { method: 'POST', headers: { Accept: 'application/json;odata=nometadata', 'X-RequestDigest': a.digest }, credentials: 'include' });
    if (!r.ok) return { ok: false, code: await codeOfRes(r), error: `체크아웃 되돌리기 ${r.status}`, status: r.status };
    return { ok: true, status: r.status };
  } catch (e) { return { ok: false, code: 'offline', error: String((e && e.message) || e) }; }
}

/* [페이지] 새 파일: Files/add(url='이름',overwrite=…) 본문 = 내용 → "체크아웃 필수" 문서함이면 파일이 내 체크아웃 상태로 남아 남에게 안 보이므로 CheckOutType 이 2 가 아니면 CheckIn(주 버전)
 *   → { ok, checkedIn, meta }. overwrite=false 인데 이미 있으면(400/409) code 'exists' */
async function spCreate(a) {
  const J = { Accept: 'application/json;odata=nometadata' };
  const H = { Accept: J.Accept, 'X-RequestDigest': a.digest };
  const fail = (code, error, status) => ({ ok: false, code, error, status });
  const codeOf = (s) => (s === 401 || s === 403 ? 'auth' : s === 404 ? 'notfound' : s === 423 ? 'locked' : 'http');
  const codeOfRes = async (r) => (r.status === 403 && /security validation|2130575251/i.test(await r.text().catch(() => '')) ? 'digest' : codeOf(r.status));
  const pick = (m) => ({ uniqueId: m.UniqueId, version: m.UIVersionLabel, length: m.Length, modified: m.TimeLastModified });
  try {
    const lit = encodeURIComponent(String(a.name).replace(/'/g, "''"));
    const r = await fetch(`${a.folderApi}/Files/add(url='${lit}',overwrite=${a.overwrite ? 'true' : 'false'})`, { method: 'POST', headers: { Accept: J.Accept, 'X-RequestDigest': a.digest, 'Content-Type': 'application/json; charset=utf-8' }, body: a.text, credentials: 'include' });
    if (!r.ok) return fail(!a.overwrite && (r.status === 400 || r.status === 409) ? 'exists' : await codeOfRes(r), `파일 만들기 ${r.status}`, r.status);
    let m = (await r.json().catch(() => null)) || {};
    let cot = m.CheckOutType;
    if (cot == null && a.fileApi) {   // 응답에 CheckOutType 이 없으면 파일 정보로
      const mr = await fetch(`${a.fileApi}?$select=CheckOutType`, { headers: J, credentials: 'include', cache: 'no-store' }).catch(() => null);
      const mm = mr && mr.ok ? ((await mr.json().catch(() => null)) || {}) : {};
      cot = mm.CheckOutType;
    }
    if (cot == null || Number(cot) === 2 || !a.fileApi) return { ok: true, checkedIn: false, meta: pick(m) };
    const c = encodeURIComponent(String(a.comment || '').slice(0, 200).replace(/'/g, "''"));
    const ir = await fetch(`${a.fileApi}/CheckIn(comment='${c}',checkintype=1)`, { method: 'POST', headers: H, credentials: 'include' });
    if (!ir.ok) return fail(await codeOfRes(ir), `체크인 ${ir.status} — 파일은 만들어졌고 체크아웃이 남았습니다(다음 쓰기가 이어받아 체크인)`, ir.status);
    const mr2 = await fetch(`${a.fileApi}?$select=UniqueId,UIVersionLabel,Length,TimeLastModified`, { headers: J, credentials: 'include', cache: 'no-store' }).catch(() => null);
    if (mr2 && mr2.ok) m = (await mr2.json().catch(() => null)) || m;
    return { ok: true, checkedIn: true, meta: pick(m) };
  } catch (e) { return fail('offline', String((e && e.message) || e)); }
}

/* [페이지] 파일을 재활용통으로 → { ok, removed } (없으면 removed:false) */
async function spRecycle(a) {
  const fail = (code, error, status) => ({ ok: false, code, error, status });
  const codeOf = (s) => (s === 401 || s === 403 ? 'auth' : s === 404 ? 'notfound' : s === 423 ? 'locked' : 'http');
  const codeOfRes = async (r) => (r.status === 403 && /security validation|2130575251/i.test(await r.text().catch(() => '')) ? 'digest' : codeOf(r.status));
  try {
    const r = await fetch(`${a.fileApi}/recycle()`, { method: 'POST', headers: { Accept: 'application/json;odata=nometadata', 'X-RequestDigest': a.digest }, credentials: 'include' });
    if (r.status === 404) return { ok: true, removed: false };
    if (!r.ok) return fail(await codeOfRes(r), `지우기 ${r.status}`, r.status);
    return { ok: true, removed: true };
  } catch (e) { return fail('offline', String((e && e.message) || e)); }
}
/* [페이지] 목록 만들기(참여연구원 자료 요청 — lib/collect.js, 2026-10-20): 같은 제목의 목록이 있으면 그 목록(existed — 지난번에 만들다 끊겼거나 다시 만들기)에 빠진 칸만 더하고, 없으면 POST web/lists(SP.List · BaseTemplate 100 사용자 지정 목록)
 *   → 칸마다 fields/addfield(SP.FieldCreationInformation — Title 을 영문 name 으로 만들어 내부 이름을 고정) → MERGE 로 표시 이름(Title)·Description·DefaultValue → DefaultView/ViewFields/addViewField(새 목록이면 작성자 Author 도) → 제목 칸(Title)도 MERGE(표시 이름 · 설명 · 기본값)
 *   → ownOnly 면 MERGE 목록 ReadSecurity 2 · WriteSecurity 2(응답자는 자기 항목만 보고 고침 — 월급여가 서로에게 보이지 않게; 목록 주인은 모두 봄) → 목록 정보(Id · RootFolder/ServerRelativeUrl · DefaultNewFormUrl · DefaultViewUrl).
 *   a = { api, digest, title, description, fields:[{ name(영문), title, kind(2 글 · 3 여러 줄 · 9 수 · 4 날짜 · 6 선택 — choices:[…] 를 만들 때 Choices 로, MERGE 때 Choices·FillInChoice·EditFormat 0 드롭다운), desc, required?, defaultValue? }], titleField:{ title, desc, defaultValue } | null, ownOnly }
 *   → { ok, id, title, path(RootFolder 서버 상대 경로), newFormUrl, viewUrl(서버 상대), existed, warnings:[…](칸·보기·보안 단계의 실패 — 목록은 있음) }. 다이제스트 거부는 'digest'(writer 가 다시 받아 한 번 더 — 그때는 existed 로 이어 간다). 본문은 verbose(__metadata 가 필요) · 응답은 nometadata 로 받고 d 꼴도 읽는다 */
async function spCreateList(a) {
  const J = { Accept: 'application/json;odata=nometadata' };
  const V = 'application/json;odata=verbose';
  const fail = (code, error, status) => ({ ok: false, code, error, status });
  const codeOf = (s) => (s === 401 || s === 403 ? 'auth' : s === 404 ? 'notfound' : 'http');
  const snip = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const lit = (p) => encodeURIComponent(String(p).replace(/'/g, "''"));
  const isDigest = (r, body) => r.status === 403 && /security validation|2130575251/i.test(body);
  const post = (url, body, extra) => fetch(url, { method: 'POST', headers: Object.assign({ Accept: J.Accept, 'Content-Type': V, 'X-RequestDigest': a.digest }, extra || {}), body: JSON.stringify(body), credentials: 'include' });
  const merge = (url, body) => post(url, body, { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*' });
  const INFO = '?$select=Id,Title,DefaultNewFormUrl,DefaultViewUrl,RootFolder/ServerRelativeUrl&$expand=RootFolder';
  const infoOf = (j) => { const d = j && j.d ? j.d : j || {}; return { id: String(d.Id || ''), title: String(d.Title || ''), path: String((d.RootFolder && d.RootFolder.ServerRelativeUrl) || ''), newFormUrl: String(d.DefaultNewFormUrl || ''), viewUrl: String(d.DefaultViewUrl || '') }; };
  const typeOf = (k) => (k === 3 ? 'SP.FieldMultiLineText' : k === 9 ? 'SP.FieldNumber' : k === 4 ? 'SP.FieldDateTime' : k === 6 ? 'SP.FieldChoice' : 'SP.FieldText');
  const choicesOf = (f, kind) => (kind === 6 && Array.isArray(f.choices) ? f.choices.map((c) => String(c == null ? '' : c).trim()).filter(Boolean).slice(0, 100) : []);
  const choiceBody = (choices) => ({ Choices: { __metadata: { type: 'Collection(Edm.String)' }, results: choices } });   // verbose 본문의 문자열 모음
  try {
    const warnings = [];
    let id = '', existed = false;
    const er = await fetch(`${a.api}/lists/getbytitle('${lit(a.title)}')${INFO}`, { headers: J, credentials: 'include', cache: 'no-store' });
    if (er.status === 401 || er.status === 403) return fail('auth', `목록 정보 ${er.status}`, er.status);
    if (er.ok) { const info = infoOf(await er.json().catch(() => null)); if (info.id) { id = info.id; existed = true; } }
    if (!id) {
      const cr = await post(`${a.api}/lists`, { __metadata: { type: 'SP.List' }, BaseTemplate: 100, Title: String(a.title), Description: String(a.description || ''), AllowContentTypes: false, ContentTypesEnabled: false });
      const cbody = await cr.text().catch(() => '');
      if (!cr.ok) return fail(isDigest(cr, cbody) ? 'digest' : codeOf(cr.status), `목록 만들기 ${cr.status}: ${snip(cbody)}`, cr.status);
      let cj = null; try { cj = JSON.parse(cbody); } catch (e) { cj = null; }
      id = String(((cj && cj.d) || cj || {}).Id || '');
      if (!id) return fail('http', '목록을 만들었지만 Id 를 받지 못했습니다');
    }
    const listApi = `${a.api}/lists(guid'${lit(id)}')`;
    const have = new Set();   // 있던 목록이면 이미 있는 칸은 건너뛴다(내부 이름)
    if (existed) {
      const fr = await fetch(`${listApi}/fields?$select=InternalName`, { headers: J, credentials: 'include', cache: 'no-store' });
      const fj = fr.ok ? ((await fr.json().catch(() => null)) || {}) : {};
      for (const f of Array.isArray(fj.value) ? fj.value : fj.d && Array.isArray(fj.d.results) ? fj.d.results : []) if (f && f.InternalName) have.add(String(f.InternalName));
    }
    for (const f of Array.isArray(a.fields) ? a.fields : []) {
      const name = String((f && f.name) || '').replace(/[^A-Za-z0-9_]/g, '');
      if (!name || have.has(name)) continue;
      const kind = Number(f.kind) || 2, choices = choicesOf(f, kind);
      const fr = await post(`${listApi}/fields/addfield`, { parameters: Object.assign({ __metadata: { type: 'SP.FieldCreationInformation' }, Title: name, FieldTypeKind: kind, Required: !!f.required }, choices.length ? choiceBody(choices) : {}) });
      if (!fr.ok) { const b = await fr.text().catch(() => ''); if (isDigest(fr, b)) return fail('digest', `칸 만들기 ${fr.status}`, fr.status); warnings.push(`칸 ${name} 만들기 ${fr.status}: ${snip(b)}`); continue; }
      const patch = { __metadata: { type: typeOf(kind) }, Title: String(f.title || name), Description: String(f.desc || '') };
      if (f.defaultValue != null) patch.DefaultValue = String(f.defaultValue);
      if (choices.length) Object.assign(patch, choiceBody(choices), { FillInChoice: true, EditFormat: 0 });   // 선택 칸 — 드롭다운(EditFormat 0) + 목록 밖 값 직접 입력 허용
      const mr = await merge(`${listApi}/fields/getbyinternalnameortitle('${lit(name)}')`, patch);
      if (!mr.ok) { const b = await mr.text().catch(() => ''); if (isDigest(mr, b)) return fail('digest', `칸 이름 ${mr.status}`, mr.status); warnings.push(`칸 ${name} 표시 이름 ${mr.status}: ${snip(b)}`); }
      const vr = await post(`${listApi}/DefaultView/ViewFields/addViewField('${lit(name)}')`, {});
      if (!vr.ok) { const b = await vr.text().catch(() => ''); if (isDigest(vr, b)) return fail('digest', `보기 칸 ${vr.status}`, vr.status); warnings.push(`보기에 ${name} 더하기 ${vr.status}: ${snip(b)}`); }
    }
    if (!existed) {   // 새 목록의 기본 보기에 작성자(Author) 열 — 목록 주인이 누가 적었는지 보게(2026-10-20 사용자 "이거 누가 작성했는지도 모르네"). 있던 목록은 건드리지 않음(두 번 더하면 400)
      const ar = await post(`${listApi}/DefaultView/ViewFields/addViewField('Author')`, {});
      if (!ar.ok) { const b = await ar.text().catch(() => ''); if (isDigest(ar, b)) return fail('digest', `보기 작성자 ${ar.status}`, ar.status); warnings.push(`보기에 작성자 더하기 ${ar.status}: ${snip(b)}`); }
    }
    if (a.titleField && typeof a.titleField === 'object') {   // 제목 칸(Title) — 표시 이름 · 설명 · 기본값(과제 제목 — lib/collect.js titleFieldFor)
      const tf = a.titleField;
      const patch = { __metadata: { type: 'SP.FieldText' }, Title: String(tf.title || 'Title'), Description: String(tf.desc || '') };
      if (tf.defaultValue != null) patch.DefaultValue = String(tf.defaultValue);
      const tr = await merge(`${listApi}/fields/getbyinternalnameortitle('Title')`, patch);
      if (!tr.ok) { const b = await tr.text().catch(() => ''); if (isDigest(tr, b)) return fail('digest', `제목 칸 ${tr.status}`, tr.status); warnings.push(`제목 칸 ${tr.status}: ${snip(b)}`); }
    }
    if (a.ownOnly) {
      const sr = await merge(listApi, { __metadata: { type: 'SP.List' }, ReadSecurity: 2, WriteSecurity: 2 });
      if (!sr.ok) { const b = await sr.text().catch(() => ''); if (isDigest(sr, b)) return fail('digest', `목록 보안 ${sr.status}`, sr.status); warnings.push(`항목 보안(자기 항목만) ${sr.status}: ${snip(b)}`); }
    }
    const ir = await fetch(`${listApi}${INFO}`, { headers: J, credentials: 'include', cache: 'no-store' });
    const info = ir.ok ? infoOf(await ir.json().catch(() => null)) : { id, title: String(a.title), path: '', newFormUrl: '', viewUrl: '' };
    if (!info.id) info.id = id;
    return Object.assign({ ok: true, existed, warnings }, info);
  } catch (e) { return fail('offline', String((e && e.message) || e)); }
}

/* [페이지] 목록을 재활용통으로(자료 요청 지우기) — lists(guid'…')/recycle() → { ok, removed }(없으면 removed:false) */
async function spRecycleList(a) {
  const fail = (code, error, status) => ({ ok: false, code, error, status });
  const lit = (p) => encodeURIComponent(String(p).replace(/'/g, "''"));
  try {
    const r = await fetch(`${a.api}/lists(guid'${lit(a.id)}')/recycle()`, { method: 'POST', headers: { Accept: 'application/json;odata=nometadata', 'X-RequestDigest': a.digest }, credentials: 'include' });
    if (r.status === 404) return { ok: true, removed: false };
    if (!r.ok) { const body = await r.text().catch(() => ''); return fail(r.status === 403 && /security validation|2130575251/i.test(body) ? 'digest' : r.status === 401 || r.status === 403 ? 'auth' : 'http', `목록 지우기 ${r.status}: ${String(body).replace(/\s+/g, ' ').trim().slice(0, 200)}`, r.status); }
    return { ok: true, removed: true };
  } catch (e) { return fail('offline', String((e && e.message) || e)); }
}
api._page = { spDigest, spEnsureFolder, spBegin, spCommit, spRelease, spCreate, spRecycle, spSharePeople, spUnshare, spOrgLink, spRename, spCreateList, spRecycleList };

/* ---------- 작업 창(AIP lib/scan/worker.js 포팅) ---------- */

const liveWorkers = new Set();   // 이 서비스워커에서 지금 열어 둔 작업 탭 id — sweepWorkers 가 건너뛴다
const isWorkerPage = (url) => /\/_api\/web\/currentuser\?(\$|%24)select=Id$/i.test(String(url || ''));
/* 사이트 페이지를 최소화·비포커스 창으로 연다 → { tabId, windowId } */
async function openWorker(c, url) {
  const win = await c.windows.create({ url, state: 'minimized', focused: false, type: 'normal' });
  const windowId = win && win.id;
  let tabId = win && win.tabs && win.tabs[0] ? win.tabs[0].id : undefined;
  if (tabId == null && windowId != null) { const tabs = await c.tabs.query({ windowId }); tabId = tabs && tabs[0] && tabs[0].id; }
  if (tabId == null) throw new Error('작업 탭을 만들지 못했습니다');
  liveWorkers.add(tabId);
  try { await c.tabs.update(tabId, { autoDiscardable: false }); } catch (e) { /* 오래된 크롬 — 무시 */ }
  return { tabId, windowId };
}
/* 탭 로드 완료(status 'complete')까지. 닫혔거나 시간이 넘으면 던진다 */
async function waitTabComplete(c, tabId, timeoutMs, intervalMs) {
  const t0 = Date.now();
  for (;;) {
    let tab;
    try { tab = await c.tabs.get(tabId); } catch (e) { throw new Error('작업 탭이 닫혔습니다'); }
    if (!tab) throw new Error('작업 탭이 닫혔습니다');
    if (tab.status === 'complete') return tab;
    if (Date.now() - t0 >= timeoutMs) throw new Error(`작업 탭 로드 시간 초과(${Math.round(timeoutMs / 1000)}초)`);
    await delay(intervalMs || 300);
  }
}
/* 작업 창을 닫는다 — 사용자가 다른 탭을 옮겨 놓았으면 우리 탭만. 이미 닫혔으면 조용히 */
async function closeWorker(c, w) {
  if (!w || w.tabId == null) return;
  liveWorkers.delete(w.tabId);
  try {
    if (w.windowId != null) {
      const tabs = await c.tabs.query({ windowId: w.windowId });
      if (tabs && tabs.length && tabs.every((t) => t.id === w.tabId)) { await c.windows.remove(w.windowId); return; }
    }
    await c.tabs.remove(w.tabId);
  } catch (e) { /* 이미 닫힘 */ }
}
/* 지난 서비스워커가 쓰기 도중 끝나(메모리 압박·확장 reload·업데이트) 남긴 작업 창을 거둔다 — background.js 가 워커를 시작할 때 부른다.
 *   sharepoint.com 탭 가운데 주소가 작업 페이지(…/_api/web/currentuser?$select=Id)인 것만, 지금 살아 있는 writer 의 탭은 빼고 closeWorker 와 같은 규칙으로 닫는다 → { closed }. opts = { chrome } */
api.sweepWorkers = async function (opts) {
  const c = (opts && opts.chrome) || g.chrome;
  if (!c || !c.tabs || !c.tabs.query) return { closed: 0 };
  let tabs = [];
  try { tabs = (await c.tabs.query({ url: 'https://*.sharepoint.com/*' })) || []; } catch (e) { return { closed: 0 }; }
  let closed = 0;
  for (const t of tabs) {
    if (!t || t.id == null || liveWorkers.has(t.id) || !isWorkerPage(t.url || t.pendingUrl)) continue;
    await closeWorker(c, { tabId: t.id, windowId: t.windowId });
    closed++;
  }
  return { closed };
};
/* run(func, args) — 작업 탭 최상위 프레임 MAIN world 에서 페이지 함수를 돌리고 결과를 돌려준다 */
function makeRun(c, tabId) {
  return async function run(func, args) {
    let res;
    try { res = await c.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', func, args: args || [] }); } catch (e) { throw mkErr('tab', `SharePoint 작업 탭에서 실행하지 못했습니다(${func && func.name}): ${(e && e.message) || e}`); }
    const r = Array.isArray(res) ? res[0] : null;
    if (!r) throw mkErr('tab', `페이지 함수 결과 없음: ${func && func.name}`);
    if (r.error) throw mkErr('tab', `페이지 함수 오류(${func && func.name}): ${(r.error && r.error.message) || r.error}`);
    return r.result;
  };
}

/* ---------- 쓰기(작업 탭) ---------- */

/* 작업 탭을 열고 다이제스트를 받아 writer 를 돌려준다. opts = { chrome, timeoutMs, intervalMs, now?(시각 함수 — 테스트) }
 * writer = { tabId, windowId, folderPath, ensureFolder(path?) → { created }, ensurePath(path?) → { created, made:[경로…] }, write(name, text, { comment }) → { changed, created, updated, checkedIn, version, meta },
 *            modify(name, transform(curText|null) → { changed, text, discard? }, { comment }) → 같은 꼴, remove(name) → { removed }, close(),
 *            sharePeople(path, names, { role:'edit'|'read' }) → { shared, ambiguous, notFound, failed, error? }, unshare(path, ids) → { removed, missing }, orgLink(path, { edit }) → { url, edit, via }, rename(path, newName) → { path, name, changed, url },
 *            createList({ title, description, fields, titleField, ownOnly }) → { id, title, path, url, newFormUrl, viewUrl, existed, warnings }, recycleList(id) → { removed }   (참여연구원 자료 요청 — sharePeople(path = 목록 경로, …, { role, email? }) 로 목록도 공유),
 *            at(path|cfg) → 같은 사이트의 다른 폴더에 묶인 writer(같은 작업 탭·다이제스트 — 파일 함수(modify·write·remove)와 폴더 기본값이 그 폴더, close 는 no-op; 사이트 밖이면 badurl) }
 *   path 인수(폴더): 서버 상대 경로 · cfg(folderPath) · 비면 writer 의 폴더 — 이 writer 의 사이트 안이어야 한다(동료의 personal 사이트 폴더는 그 사이트로 writer 를 따로 연다)
 *   modify: 내가 잡고 있던 체크아웃을 이어받았는데(spBegin resumed) 안 바뀌면 UndoCheckOut 대신 CheckIn(checkedIn:true) — 올라가 있던 초안을 살리고 체크아웃을 끝낸다. transform 이 discard:true 를 주면 그래도 UndoCheckOut.
 * 다이제스트: 만료(FormDigestTimeoutSeconds, 기본 30분) 1분 전이 지났으면 쓰기 전에 다시 받고, 페이지 함수가 code 'digest'(403 "security validation") 를 주면 다시 받아 한 번 더 돈다.
 * 탭이 로그인 화면으로 가면 kind 'auth'(창은 닫음). 다이제스트는 이 클로저에만 두고 writer 객체·결과에 싣지 않는다 */
api.openWriter = async function (cfg, opts) {
  cfg = api.revive(cfg);
  opts = opts || {};
  const c = opts.chrome || g.chrome;
  if (!c || !c.windows || !c.tabs || !c.scripting) throw mkErr('tab', 'chrome.windows · chrome.tabs · chrome.scripting 을 쓸 수 없습니다');
  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : TAB_TIMEOUT_MS;
  const nowMs = typeof opts.now === 'function' ? opts.now : Date.now;
  let w;
  try { w = await openWorker(c, `${cfg.siteUrl}${WORKER_PAGE}`); } catch (e) { throw mkErr('tab', `SharePoint 작업 탭을 열지 못했습니다: ${(e && e.message) || e}`); }
  const run = makeRun(c, w.tabId);
  let digest = '', digestExp = 0;
  const takeDigest = async () => {
    const d = await run(spDigest, [{ apiRoot: cfg.apiRoot }]);
    if (!d || !d.ok) throw errOfResult(d, '요청 다이제스트');
    digest = String(d.digest);
    const sec = Number(d.timeoutSec) > 0 ? Number(d.timeoutSec) : DIGEST_TTL_SEC;
    digestExp = nowMs() + Math.max(60, sec - 60) * 1000;   // 만료 1분 전까지만 쓴다
  };
  try {
    let tab;
    try { tab = await waitTabComplete(c, w.tabId, timeoutMs, opts.intervalMs); } catch (e) { throw mkErr('tab', `SharePoint 작업 탭: ${(e && e.message) || e}`); }
    const at = String((tab && (tab.url || tab.pendingUrl)) || '');
    if (!inside(at, cfg.origin)) throw mkErr('auth', `${AUTH_MSG} (작업 탭이 로그인 화면으로 넘어감)`);
    await takeDigest();
  } catch (e) {
    await closeWorker(c, w).catch(() => {});
    throw e;
  }
  /* 다이제스트를 싣는 페이지 함수 실행 — 만료됐으면 먼저 다시 받고, 'digest' 거부면 다시 받아 한 번 더 */
  const runW = async (fn, args) => {
    if (!digest || nowMs() >= digestExp) await takeDigest();
    let r = await run(fn, [Object.assign({}, args, { digest })]);
    if (r && !r.ok && r.code === 'digest') { await takeDigest(); r = await run(fn, [Object.assign({}, args, { digest })]); }
    return r;
  };
  const callTransform = async (transform, cur) => {
    const r = await transform(cur);
    if (!r || typeof r !== 'object') throw new Error('변환 결과가 없습니다');
    return r;
  };
  /* 폴더 인수 → 이 사이트 안의 서버 상대 경로. 비면 dflt(그 writer 의 폴더), cfg 면 그 folderPath(origin 이 다르면 badurl) */
  const pathOf = (p, dflt) => {
    if (p && typeof p === 'object') { if (p.origin && String(p.origin) !== cfg.origin) badurl(`이 작업 창의 사이트(${cfg.siteUrl}) 밖 폴더입니다: ${p.origin}`); p = p.folderPath; }
    const s = String(p == null ? '' : p).trim().replace(/\/+$/, '') || dflt || cfg.folderPath;
    if (!s.startsWith('/')) badurl('폴더 경로는 /personal/… · /sites/… 처럼 서버 상대 경로여야 합니다');
    // eslint-disable-next-line no-control-regex
    if (/[<>"|?*:\u0000-\u001f]/.test(s)) badurl('폴더 경로에 쓸 수 없는 글자가 있습니다');
    const sp = String(cfg.sitePath || '').toLowerCase(), low = s.toLowerCase();
    if (sp ? !(low === sp || low.startsWith(`${sp}/`)) : /^\/(sites|teams|personal)\//i.test(s)) badurl(`이 작업 창의 사이트(${cfg.siteUrl}) 밖 폴더입니다: ${s}`);
    return s;
  };
  let closed = false;
  /* 폴더 하나에 묶인 writer — fp 는 이 사이트 안의 서버 상대 폴더 경로(파일 함수·폴더 기본값). top(openWriter 가 돌려주는 것)만 close 가 작업 창을 닫고, at(cfg) 로 얻은 것은 같은 탭·다이제스트를 나누므로 close 가 no-op */
  const mkWriter = (fp, top) => {
  const folderApiOf = () => `${cfg.api}/GetFolderByServerRelativePath(decodedurl='${encLit(fp)}')`;
  const fileApiOf = (name) => api.fileApi({ api: cfg.api, folderPath: fp }, name);
  const writer = {
    tabId: w.tabId, windowId: w.windowId, folderPath: fp,
    /* 같은 사이트의 다른 폴더(서버 상대 경로 · cfg)에 묶인 writer — 같은 작업 탭·다이제스트. 사이트 밖이면 badurl */
    at(p) { return mkWriter(pathOf(p, fp), false); },
    async ensureFolder(p) { const r = await writer.ensurePath(p); return { created: r.created }; },
    /* 여러 단을 만든다(문서함 뿌리 cfg.libPath 위로는 올라가지 않음 — 뿌리도 없으면 nofolder) → { created, made:[만든 경로…] } */
    async ensurePath(p) {
      const folderPath = pathOf(p, fp);
      const r = await runW(spEnsureFolder, { api: cfg.api, folderPath, stop: cfg.libPath });
      if (!r || !r.ok) throw errOfResult(r, `폴더 확인 ${folderPath}`);
      return { created: !!r.created, made: Array.isArray(r.made) ? r.made.map(String) : [] };
    },
    /* 폴더를 이름으로 찾은 사람들에게 공유(기본 편집) → { shared:[{ name, email }], ambiguous:[{ name, candidates }], notFound:[name], failed:[{ name, email, error }], error? }. 빈 이름 목록이면 호출 없이 빈 결과 */
    async sharePeople(p, names, o) {
      const folderPath = pathOf(p, fp);
      const role = o && o.role === 'read' ? 'read' : 'edit';
      const list = (Array.isArray(names) ? names : names == null ? [] : [names]).map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
      if (!list.length) return { shared: [], ambiguous: [], notFound: [], failed: [] };
      const em = o && o.email && typeof o.email === 'object' ? o.email : null;   // 메일 알림(ShareObject sendEmail) — 기본은 보내지 않음(자료 요청은 팀즈 딥 링크로 알림)
      const r = await runW(spSharePeople, { apiRoot: cfg.apiRoot, url: `${cfg.origin}${folderPath}`, names: list, roleValue: role === 'read' ? ROLE_READ : ROLE_EDIT, sendEmail: !!em, emailSubject: em ? String(em.subject || '') : '', emailBody: em ? String(em.body || '') : '' });
      if (!r || !r.ok) throw errOfResult(r, `공유 ${folderPath}`);
      const out = { shared: Array.isArray(r.shared) ? r.shared : [], ambiguous: Array.isArray(r.ambiguous) ? r.ambiguous : [], notFound: Array.isArray(r.notFound) ? r.notFound : [], failed: Array.isArray(r.failed) ? r.failed : [] };
      if (r.error) out.error = String(r.error);
      return out;
    },
    /* 사람들(permissions 의 people[].id — PrincipalId)의 이 폴더 권한을 거둔다 → { removed:[{ id, roles:[역할 id…] }], missing:[id…] }(2026-10-19). 빈 목록이면 호출 없이 빈 결과 */
    async unshare(p, ids) {
      const folderPath = pathOf(p, fp);
      const list = Array.from(new Set((Array.isArray(ids) ? ids : ids == null ? [] : [ids]).map(Number).filter((n) => n > 0)));
      if (!list.length) return { removed: [], missing: [] };
      const r = await runW(spUnshare, { api: cfg.api, folderPath, ids: list });
      if (!r || !r.ok) throw errOfResult(r, `권한 거두기 ${folderPath}`);
      return { removed: Array.isArray(r.removed) ? r.removed : [], missing: Array.isArray(r.missing) ? r.missing : [] };
    },
    /* 조직 내 공유 링크(기본 편집) → { url, edit, via:'ShareLink'|'CreateOrganizationSharingLink' } */
    async orgLink(p, o) {
      const folderPath = pathOf(p, fp);
      const edit = !(o && o.edit === false);
      const r = await runW(spOrgLink, { api: cfg.api, apiRoot: cfg.apiRoot, folderPath, url: `${cfg.origin}${folderPath}`, edit });
      if (!r || !r.ok || !r.url) throw errOfResult(r && r.ok ? { ok: false, code: 'http', error: '링크 주소가 없습니다' } : r, `조직 내 링크 ${folderPath}`);
      return { url: String(r.url), edit, via: String(r.via || '') };
    },
    /* 폴더 이름 바꾸기(같은 부모 안) → { path, name, changed, url }. 문서함 뿌리는 안 됨 */
    async rename(p, newName) {
      const folderPath = pathOf(p, fp);
      const name = checkName(newName);
      const i = folderPath.lastIndexOf('/');
      const parent = folderPath.slice(0, i);
      if (!parent || folderPath.toLowerCase() === String(cfg.libPath).toLowerCase()) badurl('문서함 뿌리는 이름을 바꿀 수 없습니다');
      const newPath = `${parent}/${name}`;
      if (newPath === folderPath) return { path: folderPath, name, changed: false, url: `${cfg.origin}${encPath(folderPath)}` };
      const r = await runW(spRename, { api: cfg.api, folderPath, newPath });
      if (!r || !r.ok) throw errOfResult(r, `이름 바꾸기 ${folderPath}`);
      return { path: newPath, name, changed: true, url: `${cfg.origin}${encPath(newPath)}` };
    },
    /* 목록 만들기(참여연구원 자료 요청 — lib/collect.js · background.js collectCreate, 2026-10-20): 이 사이트에 사용자 지정 목록을 만들고 칸·기본 보기·항목 보안(자기 항목만)을 맞춘다(같은 제목이 있으면 그 목록에 빠진 칸만 — existed).
     *   o = { title, description, fields:[{ name(영문 내부 이름), title(표시 이름), kind, desc, defaultValue? }], titleField:{ title, desc, defaultValue } | null, ownOnly(기본 true) } → { id, title, path(서버 상대), url, newFormUrl, viewUrl(절대 주소), existed, warnings } */
    async createList(o) {
      o = o || {};
      const title = String(o.title || '').trim().slice(0, 80);
      if (!title) badurl('목록 제목이 비어 있습니다');
      const r = await runW(spCreateList, { api: cfg.api, title, description: String(o.description || ''), fields: Array.isArray(o.fields) ? o.fields : [], titleField: o.titleField && typeof o.titleField === 'object' ? o.titleField : null, ownOnly: o.ownOnly !== false });
      if (!r || !r.ok) throw errOfResult(r, `목록 만들기 ${title}`);
      const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
      const abs = (p) => (p ? (/^https?:/i.test(p) ? String(p) : `${cfg.origin}${String(p).startsWith('/') ? '' : '/'}${encPath(dec(String(p)))}`) : '');   // 서버 상대 경로(SP 는 디코딩된 모양으로 줌)를 절대 주소로
      return { id: String(r.id || ''), title: String(r.title || title), path: dec(String(r.path || '')), url: abs(r.path), newFormUrl: abs(r.newFormUrl), viewUrl: abs(r.viewUrl), existed: !!r.existed, warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [] };
    },
    /* 목록을 재활용통으로(자료 요청 지우기) → { removed }(없으면 false) */
    async recycleList(id) {
      const s = String(id || '').trim();
      if (!/^[0-9a-f-]{36}$/i.test(s)) badurl('목록 Id 가 GUID 모양이 아닙니다');
      const r = await runW(spRecycleList, { api: cfg.api, id: s });
      if (!r || !r.ok) throw errOfResult(r, `목록 지우기 ${s}`);
      return { removed: !!r.removed };
    },
    async modify(name, transform, o) {
      name = checkName(name);
      const comment = (o && typeof o.comment === 'string' && o.comment.trim()) || DEFAULT_COMMENT;
      const fileApi = fileApiOf(name);
      for (let attempt = 0; ; attempt++) {
        const b = await runW(spBegin, { api: cfg.api, fileApi });
        if (!b || !b.ok) throw errOfResult(b, `체크아웃·읽기 ${name}`);
        if (!b.exists) {
          const r = await callTransform(transform, null);
          if (!r.changed) return { changed: false, created: false, updated: false, checkedIn: false, version: '', meta: null };
          const cr = await runW(spCreate, { folderApi: folderApiOf(), fileApi, name, text: String(r.text == null ? '' : r.text), overwrite: false, comment });
          if (cr && cr.ok) return { changed: true, created: true, updated: false, checkedIn: !!cr.checkedIn, version: metaOf(cr.meta).version, meta: metaOf(cr.meta) };
          if (cr && cr.code === 'exists' && attempt === 0) continue;   // 그사이 동료가 만들었다(또는 Files/add 뒤 체크인만 실패해 다시 돈 것) → 체크아웃 경로로 다시(병합)
          if (cr && cr.code === 'notfound') throw mkErr('nofolder', `공유 폴더가 없습니다: ${fp}`, { path: fp });
          throw errOfResult(cr, `파일 만들기 ${name}`);
        }
        const release = () => runW(spRelease, { fileApi }).catch(() => {});
        let r;
        try { r = await callTransform(transform, b.text); } catch (e) { await release(); throw e; }
        if (!r.changed) {
          if (!b.resumed || r.discard) { await release(); return { changed: false, created: false, updated: false, checkedIn: false, version: metaOf(b.meta).version, meta: metaOf(b.meta) }; }
          // 내가 남긴(끊긴) 체크아웃을 이어받았는데 글이 그대로 — UndoCheckOut 은 올라가 있던 초안을 버리고(체크인된 판이 없으면 파일째) 체크아웃을 남기므로 체크인한다
          const cm = await runW(spCommit, { fileApi, checkInOnly: true, comment });
          if (!cm || !cm.ok) throw errOfResult(cm, `체크인 ${name}`);
          return { changed: false, created: false, updated: false, checkedIn: true, version: metaOf(cm.meta).version, meta: metaOf(cm.meta) };
        }
        const cm = await runW(spCommit, { fileApi, text: String(r.text == null ? '' : r.text), comment });
        if (!cm || !cm.ok) throw errOfResult(cm, `쓰기·체크인 ${name}`);
        return { changed: true, created: false, updated: true, checkedIn: true, version: metaOf(cm.meta).version, meta: metaOf(cm.meta) };
      }
    },
    async write(name, text, o) { return writer.modify(name, () => ({ changed: true, text: String(text == null ? '' : text) }), o); },
    async remove(name) {
      const r = await runW(spRecycle, { fileApi: fileApiOf(name) });
      if (!r || !r.ok) throw errOfResult(r, `지우기 ${name}`);
      return { removed: !!r.removed };
    },
    async close() { if (!top || closed) return; closed = true; digest = ''; await closeWorker(c, w).catch(() => {}); }
  };
  return writer;
  };
  return mkWriter(cfg.folderPath, true);
};

/* 오류 → { kind, message } (kind 가 없는 Error 는 'error') */
api.describe = (e) => ({ kind: (e && e.kind) || 'error', message: String((e && e.message) || e || '알 수 없는 오류') });

export default api;
