// kr_ext_rerp `background.js` 의 공유 (Plus) 배선(0.8.6 + 2026-10-18 작업 트리 — 585~1098행 shareSync · queueShareSync · shareProbe · shareFolderCopy · shareFolderPeople · shareOrgLink · shareRename 과
// onMessage 의 planSync · planSyncQueue · share* 갈래)을 그대로 옮긴 것. 2026-10-18 사용자 지정("원노트 공유는 mcp 없어도 되긴하지? … 아니 mcp 없이 grph api 하지 않고 브라우저 토큰으로 하라고" ·
// "onedrive 에 업무/shared 안에 과제별로 .. 약칭으로 없으면 jobid 없으면 임시번호 … 년차별로 1개 파일" · "참여연구원들에게 공유할 수 있게 설정까지 … workspace 에도 경로주면 알아서 동기화")으로
// 원노트·MCP 배선(rerp/plussync.js)을 걷어 내고 그 자리에 들어왔다 — 저장소는 SharePoint(OneDrive) 폴더의 과제별 JSON(rerp/spstore.js · prjdoc.js · prjdocsync.js), 전제는 브라우저의 SharePoint 로그인 쿠키 하나.
// 서비스워커가 아니라 사이드패널 안에서 돌므로 바깥과 닿는 곳만 deps 로 받는다(rerp/README.md "옮기며 바꾼 것"):
//   · KRX_SETTINGS.load().plus → deps.settings()  (WORKSPACE 는 R&D 탭 공유 카드의 rndShare — enabled · folder · driveHost · discover · shareWith; 동기화 항목 체크(planSync …) 대신 deps.want · deps.pullOnly)
//   · 과제명·책임자·내 참여 과제·책임 과제·별칭·내 이름(패널 캐시 · projectList · rndUser · 참여인력 · 설정 myName) → deps.context()  (WORKSPACE 는 장부 — rERP 에 이어진 차년도의 prjNo, 과제책임자 == 내 이름)
//   · shareLoadLocal / shareSaveLocal(storage.local 의 plannedExpenses · researchPlans · staffPlans · shareChanges · shareProjects · projectAliases) → deps.loadLocal() / deps.saveLocal(part, prj, data, names)  (WORKSPACE 는 src/rndshare.js 로 장부와 변환)
//   · 참여인력 조회 KRX_API.call(rtask_0008_t03_01_r001) → deps.participants(prjNo) → 이름 목록(내 이름은 여기서 뺀다)
//   · 오프스크린 문서 clipboardWrite → deps.copyText  (사이드패널은 navigator.clipboard)
//   · fetch · chrome 전역 → deps.fetch · deps.chrome (없으면 전역) · KRX_SP → SPX(deps.store 로 가짜 store 를 끼울 수 있게 — 검사. 원본은 KRX_SP 를 직접 부름)
//   · chrome.storage.local 의 shareState(+ 호환 planSyncState · researchSyncState · staffSyncState) · shareIndex · shareFolder 는 키 이름까지 rerp 그대로
//   · chrome.runtime.onMessage 의 switch 는 send(msg) 함수로 — rerp/plan.js 의 api.send 에 끼운다
import KRX_SP from './spstore.js';
import KRX_PRJDOC from './prjdoc.js';
import KRX_PRJDOC_SYNC from './prjdocsync.js';

/* rerp lib/settings.js DEFAULTS.plus — 공유 (Plus) 기본값 */
export const SHARE_DEFAULTS = Object.freeze({
  enabled: false,
  folder: '',                     // 밑폴더(base) 주소. 비우면 **내 OneDrive 의 문서/업무/shared**(KRX_SP.resolveMyFolder 가 driveHost 의 /_api/v2.0/me/drive 로 찾아 storage.local.shareFolder 에 캐시, 두 단 모두 없으면 만듦).
                                  //   동료 폴더(동료가 자동 공유해 준 것)는 보통 비워 두어도 "나와 공유" 에서 저절로 찾는다(discover). 팀 사이트나 동료의 base 를 직접 쓰려면 그 주소를 여기에.
  driveHost: 'https://krclass-my.sharepoint.com',   // 내 OneDrive 를 찾는 호스트(folder 가 비었을 때)
  researchSync: true,             // 연구내용(연구개발계획서 기록) 공유: 연차 파일의 research 칸과 기록 id(과제명 키#차년도)마다 — 판·넣은 시각이 새로운 쪽 (lib/research-sync.js merge)
  staffSync: true,                // 사업비(참여연구원 참여율·지급액 계획 · 예산 줄) 공유: 연차 파일의 staff·budget 칸과 연차마다 — 수정 시각이 새로운 쪽, 지운 연차는 묘비로 (lib/staff-sync.js merge)
  planSync: true,                 // 예상 비용 공유: 예상비용.json 의 plan 칸과 항목 id 마다 — 마지막 수정 시각이 새로운 쪽, 삭제는 묘비 (lib/plan-sync.js merge)
  changesSync: true,              // 변경이력 공유: 연차 파일의 changes 칸과 — 덧붙이기만(id 합집합, 최대 500)
  discover: true,                 // 나와 공유된 과제 폴더 자동 찾기: 동기화 때 "나와 공유"(/_api/v2.0/me/drive/sharedWithMe) 의 폴더 가운데 내 참여 과제의 연차 파일이 든 것을 대상에 넣는다
  shareWith: 'participants'       // 과제 폴더를 새로 만들 때 참여연구원에게 자동 공유(편집): 'participants' | 'none'
});

/* ----- 공유 (Plus) v2: 예상 비용(lib/plan.js) · 연구내용(lib/research.js) · 사업비(lib/staff.js — 예산 줄·참여인력) · 변경이력 · 과제 별칭 ↔ SharePoint(OneDrive) 공유 폴더의 **과제별 폴더**. 여기는 배선만 -----
 * 폴더 트리: base(설정 folder — 비면 내 OneDrive 문서/업무/shared: KRX_SP.resolveMyFolder(name) · 두 단 모두 없으면 만듦) / <과제 폴더 — 별칭 → Job Id(파일의 project.jobId, WORKSPACE 몫) → rERP 과제번호, KRX_PRJDOC.folderNameFor> / <n>차년도.json · 예상비용.json.
 *   폴더 이름은 표시용 — 과제는 파일 안의 project.prjNo 로 알아보고 storage.local.shareIndex = { [prjNo]: { base, folder, site, owner?, at } } 에 캐시한다(prjdoc-sync 가 돌려주는 state.index). 폴더 이름은 만들 때만 정하고 저절로 바꾸지 않는다(shareRename 으로 사용자가).
 *   받는 쪽(참여자)은 설정 없이도 "나와 공유"(discover) 의 폴더에서 내 참여 과제의 연차 파일을 찾아 대상에 넣는다 — 동료의 personal 사이트라 writer 는 사이트마다 따로(prjdoc-sync).
 * shareSync(reason, { prjNo? }): 한 번에 하나만. 진행 중이면 load/alarm 은 그 결과를 같이 받고, edit/manual(편집 큐·버튼·구름 아이콘)은 **끝난 뒤 한 번 더** 돈다(shareNext — 진행 중인 것은 loadLocal 을 이미 지나 그 편집을 모르므로; 기다리는 요청이 여럿이면 한 번으로 모으고 과제가 다르면 전체).
 *   load/alarm 은 마지막 성공 뒤 SHARE_SYNC_MIN_MS 안이면 건너뜀. prjNo 를 주면 그 과제만(구름/저장 아이콘 — prjdoc-sync 의 only).
 *   폴더를 **새로 만든** 과제가 있고 설정 shareWith 가 'participants' 면 그 과제의 참여인력(deps.participants — 내 이름 제외)에게 폴더를 편집 권한으로 공유하고 결과를 pages[prj].share 에 남긴다(shareFolderPeople 과 같은 길).
 *   결과 storage.local.shareState = { at, ok, reason, ms, base:{ path, viewUrl }, folder(= base, 호환), count(과제), files, written, pulled, errors, error?, kind?, created, pages:{ [prjNo]: { … } } } — 호환을 위해 planSyncState · researchSyncState · staffSyncState 에도 같은 것을 쓴다(rerp/plan.js 아이콘 툴팁이 planSyncState 를 읽음).
 *   kind 'auth'(이 브라우저에서 SharePoint 로그인 필요) · 'badurl' · 'offline' · 'nofolder' · 'locked' · 'parse' · 'http' · 'tab' 은 KRX_SP.describe · prjdoc-sync 가 메시지와 함께 준다 — 화면이 그대로 보여 준다
 * shareProbe(msg): [연결 확인] — base 를 다시 풀고(msg.folder 가 있으면 저장 전 칸 값) 과제 폴더 목록(listFolders)과 "나와 공유" 의 폴더 수를 받아 본다. shareFolderCopy(msg): base(또는 prjNo 의 과제 폴더 · file 이면 예상비용.json)를 여는 주소를 클립보드에.
 * shareFolderPeople(msg): 과제 폴더를 사람들(names — 없으면 참여인력 전부)에게 공유 → { share:{ shared, ambiguous, notFound } }. shareOrgLink(msg): 조직 내 편집 링크를 만들어 복사 → { ok, url, copied }. shareRename(msg): 과제 폴더 이름 바꾸기(선택 — shareIndex 도 고침).
 * 쿠키·다이제스트·피커 Key 값은 로그·상태에 찍지 않는다(이메일은 상태 표시에 쓴다) */
const SHARE_SYNC_MIN_MS = 60 * 1000;
const SHARE_BASE_NAME = '업무/shared';       // 설정 folder 가 비었을 때 내 OneDrive 문서 아래 밑폴더(두 단) — KRX_SP.resolveMyFolder 의 name (2026-10-18 저녁 사용자 "onedrive 에 업무/shared 안에 과제별로")
const SHARE_INDEX_KEY = 'shareIndex';         // { [prjNo]: { base, folder, site, owner?, at } } — 과제 → 폴더 캐시 (prjdoc-sync 가 돌려주는 state.index. 맞지 않으면 다시 훑는다)
const SHARE_MISSING = { off: 'R&D 탭 공유 카드의 "공유 (SharePoint)" 켜기', items: '동기화 항목(want) 가운데 하나 이상' };   // [workspace] rerp 는 팝업 아래 줄·설정 › 공유 (Plus) 탭을 가리킨다
const SHARE_NOFOLDER_MSG = '이 과제의 공유 폴더가 아직 없습니다 — 공유를 켜고 지금 맞추면 만듭니다(과제책임자 또는 이 과제의 자료가 있을 때)';

/**
 * @param {{ settings: () => Promise<object>|object, context: () => Promise<{ names:object, rsprs?:object, myPrjNos:string[], leadPrjNos?:string[], aliases?:object, who?:string, myNames?:string[] }>|object,
 *   loadLocal: () => Promise<object>, saveLocal: (part:string, prj:string, data:any, names?:object) => Promise<void>,
 *   want?: object|((plus:object) => object), pullOnly?: object|(() => object), participants?: (prjNo:string) => Promise<Array<string|{name:string}>>,
 *   copyText?: (text:string) => Promise<boolean>, chrome?: object, fetch?: Function, store?: object }} deps
 */
export function createShareSync(deps) {
  const chrome = deps.chrome || globalThis.chrome;   // [workspace] storage.local 의 shareState · shareIndex · shareFolder (rerp 와 같은 키)
  const spFetch = (u, o) => (deps.fetch || globalThis.fetch)(u, o);   // 쿠키는 credentials:'include' 로 브라우저가 붙인다. 쿠키·다이제스트 값은 로그·결과 어디에도 찍지 않는다
  const spIo = () => ({ fetch: spFetch, chrome });
  const SPX = Object.assign(Object.create(null), KRX_SP, deps.store || {});   // [workspace] 원본은 KRX_SP 를 직접 — 검사는 가짜 store(메모리 폴더 트리)를 끼운다
  /* 저장소 손잡이 — lib/prjdoc-sync.js 가 받는 store { listFiles, readFile, listFolders, sharedWithMe, openWriter, childCfg, … }. KRX_SP 함수에 fetch · chrome 을 여기서 넣어 prjdoc-sync 는 순수하게 둔다.
   *   그 밖의 KRX_SP 함수(childCfg · parseFolder · revive · fileUrl · folderUrl · describe …)는 그대로 넘긴다(순수 함수) */
  const shareStore = Object.assign(Object.create(null), SPX, {
    listFiles: (cfg, o) => SPX.listFiles(cfg, Object.assign(spIo(), o || {})),
    readFile: (cfg, name, o) => SPX.readFile(cfg, name, Object.assign(spIo(), o || {})),
    listFolders: (cfg, o) => SPX.listFolders(cfg, Object.assign(spIo(), o || {})),
    sharedWithMe: (io, o) => SPX.sharedWithMe(Object.assign(spIo(), io || {}), o || {}),
    openWriter: (cfg, o) => SPX.openWriter(cfg, Object.assign(spIo(), o || {}))
  });
  let shareInflight = null, shareNext = null, shareNextOpts = null, shareTimer = 0;
  const loadPlus = async () => Object.assign({}, SHARE_DEFAULTS, (await deps.settings()) || {});
  /* 무엇을 맞출지 — 설정의 체크. budget(예산 줄)은 사업비 체크와 함께, alias 는 늘 (prjdoc-sync 의 want). [workspace] deps.want(객체 또는 함수)가 있으면 그것으로 덧씀 — WORKSPACE 는 plan 받기만 · staff 안 함 · budget 은 계획만 */
  const shareWant = (p) => ({ plan: p.planSync !== false, research: p.researchSync !== false, staff: p.staffSync !== false, budget: p.staffSync !== false, changes: p.changesSync !== false, alias: true });
  const wantOf = (p) => (deps.want ? Object.assign(shareWant(p), (typeof deps.want === 'function' ? deps.want(p) : deps.want) || {}) : shareWant(p));
  const pullOnlyOf = () => ((typeof deps.pullOnly === 'function' ? deps.pullOnly() : deps.pullOnly) || {});   // [workspace] 받기만 하는 파일(prjdoc-sync 의 pullOnly — WORKSPACE 는 { plan: true })
  const shareDriveHost = (p) => String((p && p.driveHost) || '').trim() || SHARE_DEFAULTS.driveHost;
  const shareObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  /* 과제 문맥 — [workspace] 원본은 projectList · 패널 캐시(cache.projects · participation · myNames) · rndUser · 설정 myName 에서 모았다 */
  async function ctxOf() {
    const c = (await deps.context()) || {};
    const who = String(c.who || '');
    return {
      names: shareObj(c.names), rsprs: shareObj(c.rsprs), aliases: shareObj(c.aliases),
      myPrjNos: Array.from(new Set((c.myPrjNos || []).map(String).filter(Boolean))), leadPrjNos: Array.from(new Set((c.leadPrjNos || []).map(String).filter(Boolean))),
      who, myNames: new Set((c.myNames || []).concat([who]).map((x) => String(x || '').trim()).filter(Boolean))   // 자동 공유에서 나를 빼는 데
    };
  }
  /* 예상 비용 파일 이름 — KRX_PRJDOC.planName(함수 또는 문자열), 없으면 기본 */
  const sharePlanName = () => { try { const v = KRX_PRJDOC.planName; return String((typeof v === 'function' ? v() : v) || '예상비용.json'); } catch (e) { return '예상비용.json'; } };
  /* cfg 의 파일 주소 — 캐시에서 온 cfg 는 함수가 없을 수 있어 KRX_SP.fileUrl 로 */
  const shareFileUrl = (cfg, name) => (typeof cfg.fileUrl === 'function' ? cfg.fileUrl(name) : SPX.fileUrl(cfg, name));
  /* 오류 → { kind, message } — KRX_SP.describe 가 못 받는 것(일반 Error)도 kind 'error' 로 */
  function describeShare(e) {
    try { const d = SPX.describe(e); if (d && d.message) return { kind: String(d.kind || 'error'), message: String(d.message) }; } catch (x) {}
    return { kind: String((e && e.kind) || 'error'), message: String((e && e.message) || e) };
  }
  const shareFail = (kind, message) => ({ ok: false, kind, message, error: message });
  /* 설정 → base cfg(KRX_SP.parseFolder 결과 — origin · sitePath · folderPath · viewUrl · mine 과 함수 fileApi · fileUrl). storage.local.shareFolder 에 cfg 를 JSON 으로 캐시(함수는 빠짐)하고 거기에 input(설정 folder) · driveHost · baseName · at 를 붙여 둔다 —
   *   설정 folder·driveHost 가 같고 기본 밑폴더 이름도 같으면 네트워크 없이 KRX_SP.revive 로 함수를 되살려 쓴다. force(연결 확인)이거나 캐시가 맞지 않으면 다시 푼다:
   *   KRX_SP.resolveFolder — folder 가 비면 내 OneDrive 의 문서/업무/shared(resolveMyFolder(name), mine:true), 공유 링크면 redirect 를 따라가, 아니면 parseFolder. 실패(auth · badurl · offline …)는 kind 가 붙은 Error 그대로 던진다 */
  async function shareCfg(p, force) {
    const input = String((p && p.folder) || '').trim();
    const driveHost = shareDriveHost(p);
    if (!force) {
      const c = (await chrome.storage.local.get('shareFolder')).shareFolder || null;
      if (c && c.origin && c.folderPath && c.input === input && c.driveHost === driveHost && c.baseName === SHARE_BASE_NAME) { try { return typeof SPX.revive === 'function' ? SPX.revive(c) : SPX.parseFolder(c.url || shareFolderUrl(c)); } catch (e) {} }   // 캐시가 안 풀리면(모양이 바뀜) 다시 푼다
    }
    const cfg = await SPX.resolveFolder(input, { fetch: spFetch, driveHost, name: SHARE_BASE_NAME });
    const cached = JSON.parse(JSON.stringify(Object.assign({}, cfg)));   // 함수를 뺀 cfg
    await chrome.storage.local.set({ shareFolder: Object.assign(cached, { input, driveHost, baseName: SHARE_BASE_NAME, url: cached.url || shareFolderUrl(cfg), path: cfg.folderPath, at: Date.now() }) });
    return cfg;
  }
  /* 폴더 주소(브라우저·parseFolder 가 받는 모양 — [주소 복사] · 캐시 url). KRX_SP.folderUrl: 칸마다 encodeURIComponent — encodeURI 는 폴더 이름의 '#' 을 두어 동료가 붙여 넣으면 fragment 로 잘려 상위 폴더로 풀렸다 */
  const shareFolderUrl = (cfg) => (typeof SPX.folderUrl === 'function' ? SPX.folderUrl(cfg) : cfg.origin + String(cfg.folderPath || '').split('/').map(encodeURIComponent).join('/'));
  /* 과제 폴더 cfg — shareIndex 항목({ base, folder, site })으로. base 가 cfg 꼴(JSON)이면 revive, 폴더 주소면 parseFolder, 서버 상대 경로면 site 의 origin 과 합쳐 parseFolder, 그 밖엔 설정 base. 항목이 없으면 null(폴더를 아직 모름) */
  async function shareProjectCfg(prjNo, p, index) {
    const idx = shareObj(index || (await chrome.storage.local.get(SHARE_INDEX_KEY))[SHARE_INDEX_KEY]);
    const e = idx[String(prjNo || '')];
    if (!e || !e.folder) return null;
    let base = null;
    try {
      if (e.base && typeof e.base === 'object' && e.base.origin && e.base.folderPath) base = SPX.revive(e.base);
      else if (typeof e.base === 'string' && /^https:\/\//i.test(e.base)) base = SPX.parseFolder(e.base);
      else if (typeof e.base === 'string' && e.base.startsWith('/') && e.site) base = SPX.parseFolder(new URL(e.site).origin + e.base.split('/').map(encodeURIComponent).join('/'));
    } catch (x) { base = null; }
    if (!base) base = await shareCfg(p, false);
    return typeof SPX.childCfg === 'function' ? SPX.childCfg(base, String(e.folder)) : SPX.parseFolder(`${shareFolderUrl(base)}/${encodeURIComponent(String(e.folder))}`);
  }
  /* 과제의 참여인력 이름(내 이름 제외) — [workspace] deps.participants(prjNo)(이름 문자열 또는 { name }). rerp 는 R&D ERP 참여인력 조회(rtask_0008_t03_01_r001 → lib/staff.js rowsOfErp · byName) */
  async function shareParticipantNames(prjNo, myNames) {
    const list = typeof deps.participants === 'function' ? await deps.participants(String(prjNo)) : [];
    return Array.from(new Set((Array.isArray(list) ? list : []).map((h) => String((h && typeof h === 'object' ? h.name : h) || '').trim()).filter((n) => n && !myNames.has(n))));
  }
  /* writer.sharePeople 결과 → 상태에 남길 모양(피커 Key 같은 로그인 값은 싣지 않는다 — 이름·이메일·후보 표시 이름만) */
  function shareResultOf(r, role) {
    const o = r && typeof r === 'object' ? r : {};
    const share = {
      shared: (Array.isArray(o.shared) ? o.shared : []).map((x) => ({ name: String((x && x.name) || ''), email: String((x && x.email) || '') })),
      ambiguous: (Array.isArray(o.ambiguous) ? o.ambiguous : []).map((x) => ({ name: String((x && x.name) || ''), candidates: (Array.isArray(x && x.candidates) ? x.candidates : []).slice(0, 10).map(String) })),
      notFound: (Array.isArray(o.notFound) ? o.notFound : []).map(String),
      role: role || 'edit', at: Date.now()
    };
    if (o.error) share.error = String(o.error);
    return share;
  }
  const shareResultText = (s) => `공유 ${s.shared.length}명${s.ambiguous.length ? ` · 이름 겹침 ${s.ambiguous.length}` : ''}${s.notFound.length ? ` · 못 찾음 ${s.notFound.length}` : ''}${s.error ? ` · 오류: ${s.error}` : ''}`;
  /* 여러 과제 폴더를 사람들에게 공유 — jobs = [{ prjNo, cfg, names, pg(결과를 받을 pages 항목) }]. writer 는 **사이트마다** 하나(동료 폴더는 그 사람의 personal 사이트) */
  async function sharePeopleJobs(jobs, role) {
    const bySite = new Map();
    for (const j of jobs) { const k = String((j.cfg && j.cfg.siteUrl) || ''); if (!bySite.has(k)) bySite.set(k, []); bySite.get(k).push(j); }
    for (const list of bySite.values()) {
      let w = null;
      try { w = await shareStore.openWriter(list[0].cfg); }
      catch (e) { const d = describeShare(e); for (const j of list) j.pg.share = Object.assign(shareResultOf(null, role), { error: d.message, kind: d.kind }); continue; }
      try {
        for (const j of list) {
          try { j.pg.share = shareResultOf(await w.sharePeople(j.cfg.folderPath, j.names, { role: role || 'edit' }), role); }
          catch (e) { const d = describeShare(e); j.pg.share = Object.assign(shareResultOf(null, role), { error: d.message, kind: d.kind }); }
        }
      } finally { try { await w.close(); } catch (e) {} }
    }
  }
  /* 동기화 결과의 pages 에 과제 폴더 주소(folderUrl) · 예상비용.json 주소(planUrl — 항목이 있을 때) · 주인(owner)을 shareIndex 로 채운다(prjdoc-sync 가 이미 넣었으면 그대로). 네트워크 없음 */
  async function shareDecoratePages(state, p, index) {
    for (const [prj, pg] of Object.entries(state.pages || {})) {
      const e = index[prj];
      if (!pg || !e || !e.folder) continue;
      try {
        const cfg = await shareProjectCfg(prj, p, index);
        if (!cfg) continue;
        if (!pg.folder) pg.folder = String(e.folder);
        if (!pg.folderUrl) pg.folderUrl = cfg.viewUrl || shareFolderUrl(cfg);
        if (!pg.planUrl && (pg.planFile || (pg.counts && pg.counts.plan > 0))) pg.planUrl = shareFileUrl(cfg, sharePlanName());
        if (!pg.owner && e.owner) pg.owner = String(e.owner);
      } catch (x) {}
    }
  }
  /* 폴더를 **새로 만든** 과제(prjdoc-sync 의 state.created 목록 또는 pages[prj].folderCreated — pages[prj].created 는 "파일을 새로 만듦" 이라 쓰지 않는다: 있던 폴더에 다음 연차 파일이 생길 때마다 다시 공유하지 않게)의
   *   참여인력에게 자동 공유(편집) — 설정 shareWith 'participants'. 남의 폴더(owner)·오류 과제는 건너뛴다. 결과는 pages[prj].share */
  async function shareAutoPeople(state, p, index, ctx) {
    const pages = Object.values(state.pages || {}).filter((pg) => pg && !pg.error && !pg.owner && index[pg.prjNo] && index[pg.prjNo].folder);
    const createdSet = new Set((Array.isArray(state.created) ? state.created : []).map(String));
    const made = pages.filter((pg) => pg.folderCreated === true || createdSet.has(String(pg.prjNo)));
    if (!made.length) return;
    const jobs = [];
    for (const pg of made) {
      try {
        const names = await shareParticipantNames(pg.prjNo, ctx.myNames);
        if (!names.length) { pg.share = Object.assign(shareResultOf(null, 'edit'), { note: '참여인력에 나 말고는 없음' }); continue; }
        const cfg = await shareProjectCfg(pg.prjNo, p, index);
        if (cfg) jobs.push({ prjNo: pg.prjNo, cfg, names, pg });
      } catch (e) { const d = describeShare(e); pg.share = Object.assign(shareResultOf(null, 'edit'), { error: d.message, kind: d.kind }); }
    }
    if (jobs.length) await sharePeopleJobs(jobs, 'edit');
  }
  /* shareState.pages[prjNo] 에 칸을 덧씀(공유 결과 · 폴더 이름) — 네 호환 키에 같이 */
  async function sharePatchPage(prjNo, patch) {
    const st = (await chrome.storage.local.get('shareState')).shareState || { at: 0, ok: true, count: 0, written: 0, pulled: 0, errors: 0, pages: {} };
    st.pages = Object.assign({}, st.pages);
    st.pages[prjNo] = Object.assign({ prjNo, title: prjNo }, st.pages[prjNo] || {}, patch);
    await chrome.storage.local.set({ shareState: st, planSyncState: st, researchSyncState: st, staffSyncState: st });
    return st;
  }
  async function shareSync(reason, opts) {
    opts = opts || {};
    if (shareInflight) {
      if (reason === 'load' || reason === 'alarm') return shareInflight;   // 곧 끝날 결과로 충분
      // 편집 큐·버튼·구름 아이콘: 진행 중인 동기화는 loadLocal 을 이미 지나 이 편집을 모른다 → 끝난 뒤 한 번 더(기다리는 요청은 하나로 모음 — 과제가 다르면 전체, manual 이 하나라도 있으면 manual)
      if (shareNext) {
        if (shareNextOpts.prjNo && shareNextOpts.prjNo !== String(opts.prjNo || '')) shareNextOpts.prjNo = '';
        if (reason === 'manual') shareNextOpts.reason = 'manual';
        return shareNext;
      }
      shareNextOpts = { reason, prjNo: String(opts.prjNo || '') };
      const go = () => { const o = shareNextOpts; shareNext = null; shareNextOpts = null; return shareSync(o.reason, { prjNo: o.prjNo }); };
      shareNext = shareInflight.then(go, go);
      return shareNext;
    }
    shareInflight = (async () => {
      const p = await loadPlus();
      const want = wantOf(p);
      if (!p.enabled || !(want.plan || want.research || want.staff || want.changes)) return { ok: false, skipped: 'off', missing: [!p.enabled && SHARE_MISSING.off, p.enabled && SHARE_MISSING.items].filter(Boolean) };
      const prev = (await chrome.storage.local.get('shareState')).shareState || null;
      if ((reason === 'load' || reason === 'alarm') && prev && prev.ok && Date.now() - prev.at < SHARE_SYNC_MIN_MS) return Object.assign({ skipped: 'recent' }, prev);
      const t0 = Date.now();
      let state;
      try {
        const ctx = await ctxOf();   // [workspace] 과제명·책임자·내 참여 과제·책임 과제·별칭·내 이름은 장부에서 (rerp 는 projectList · 패널 캐시 · rndUser · 설정 myName)
        const index = shareObj((await chrome.storage.local.get(SHARE_INDEX_KEY))[SHARE_INDEX_KEY]);
        const cfg = await shareCfg(p, false);   // 못 풀면(auth · badurl · offline) 아래 catch 가 kind 그대로 상태에 남겨 화면이 안내한다
        const r = await KRX_PRJDOC_SYNC.run({
          store: shareStore, io: spIo(), base: cfg, cfg, driveHost: shareDriveHost(p), names: ctx.names, rsprs: ctx.rsprs, myPrjNos: ctx.myPrjNos, leadPrjNos: ctx.leadPrjNos, aliases: ctx.aliases, index, discover: p.discover !== false,
          only: opts.prjNo || '', want, pullOnly: pullOnlyOf(), who: ctx.who, loadLocal: deps.loadLocal, saveLocal: (part, prj, data) => deps.saveLocal(part, prj, data, ctx.names), now: t0
        });
        const rs = (r && r.state) || {};
        state = Object.assign({ at: t0, ok: true, base: { path: cfg.folderPath, viewUrl: cfg.viewUrl || '' }, count: 0, files: 0, written: 0, pulled: 0, errors: 0, pages: {} }, rs, { reason, ms: Date.now() - t0 });
        if (!state.base || !state.base.path) state.base = { path: cfg.folderPath, viewUrl: cfg.viewUrl || '' };
        state.folder = state.folder && state.folder.path ? state.folder : state.base;   // 호환(옛 화면이 folder 를 읽음)
        const newIndex = rs.index && typeof rs.index === 'object' && !Array.isArray(rs.index) ? rs.index : index;   // run 이 돌려준 새 캐시(비어 있어도 그것) — 없으면 지난 것
        if (newIndex !== index) await chrome.storage.local.set({ [SHARE_INDEX_KEY]: newIndex });
        delete state.index;   // 캐시는 shareIndex 에 — 상태에는 두지 않는다
        await shareDecoratePages(state, p, newIndex);
        if (p.shareWith !== 'none') await shareAutoPeople(state, p, newIndex, ctx);
        state.ms = Date.now() - t0;
      } catch (e) {
        const d = describeShare(e);
        state = { at: t0, ok: false, reason, error: d.message, kind: d.kind, ms: Date.now() - t0, base: (prev && prev.base) || null, folder: (prev && (prev.folder || prev.base)) || null, count: 0, written: 0, pulled: 0, errors: 1, pages: (prev && prev.pages) || {} };
        if (d.kind === 'badurl') { try { await chrome.storage.local.remove('shareFolder'); } catch (e2) {} }   // 캐시한 폴더 주소가 틀렸을 수 있다 — 다음에 다시 푼다
      }
      if ((opts.prjNo || !state.ok) && prev && prev.pages) state.pages = Object.assign({}, prev.pages, state.pages || {});   // 과제 하나만 돌렸거나 실패했으면(로그인 풀림 등 — run 이 ok:false 로 돌려줄 때도) 다른 과제·지난 결과는 남긴다 (툴팁이 과제별로 읽음, 오류는 error · kind 에)
      await chrome.storage.local.set({ shareState: state, planSyncState: state, researchSyncState: state, staffSyncState: state });
      return state;
    })().finally(() => { shareInflight = null; });
    return shareInflight;
  }
  function queueShareSync(reason) { clearTimeout(shareTimer); shareTimer = setTimeout(() => { shareSync(reason || 'edit').catch(() => {}); }, 4000); }   // 그때 동기화가 진행 중이면 shareSync 가 끝난 뒤 한 번 더 돌게 잡아 둔다
  /* [연결 확인] — base 를 다시 풀고(msg.folder 가 있으면 저장 전 칸 값으로) 과제 폴더 목록과 "나와 공유" 의 폴더를 받아 본다
   *   → { ok, folder:{ path, viewUrl, url }, folders:[{ name, path, itemCount, modified }], count(과제 폴더 수), exists(밑폴더 있음), mine(내 OneDrive 인지), shared(나와 공유의 폴더 가운데 shared 밑 — 연차 파일은 여기서 읽지 않음), sharedFolders:[{ name, webUrl, ownerName }], sharedKnown(shareIndex 에 주인이 적힌 과제 수 — 지난 동기화가 찾은 것), message }
   *   실패 → { ok:false, kind, message, error } — 'auth' 면 이 브라우저에서 SharePoint(OneDrive) 로그인 필요(화면이 OneDrive 열기 링크로 안내), 'badurl' 이면 주소 모양(공유 링크 대신 폴더를 연 뒤 주소창의 주소) */
  async function shareProbe(msg) {
    const p = await loadPlus();
    if (msg && msg.folder !== undefined && msg.folder !== null) p.folder = String(msg.folder);
    try {
      const cfg = await shareCfg(p, true);
      let folders = null;
      try { folders = await shareStore.listFolders(cfg); } catch (e) { if (!(e && e.kind === 'nofolder')) throw e; }
      let mine = !!cfg.mine || !String(p.folder || '').trim();   // 비워 두었으면 내 OneDrive(resolveMyFolder 가 mine:true). 붙여 넣은 주소면 내 OneDrive 와 사이트가 같은지 본다
      if (!mine) { try { const my = await SPX.resolveMyFolder({ fetch: spFetch, driveHost: shareDriveHost(p), name: SHARE_BASE_NAME }); mine = my.origin === cfg.origin && String(my.sitePath || '').toLowerCase() === String(cfg.sitePath || '').toLowerCase(); } catch (e) {} }
      let shared = null;
      if (p.discover !== false) {
        try {
          const dec = (u) => { try { return decodeURIComponent(String(u || '')); } catch (e) { return String(u || ''); } };
          shared = ((await shareStore.sharedWithMe({}, { driveHost: shareDriveHost(p) })) || []).filter((f) => f && f.folder && /\/shared(\/[^/]*)?\/?$/i.test(dec(f.webUrl))).map((f) => ({ name: String(f.name || ''), webUrl: String(f.webUrl || ''), ownerName: String(f.ownerName || '') }));
        } catch (e) { shared = null; }
      }
      const index = shareObj((await chrome.storage.local.get(SHARE_INDEX_KEY))[SHARE_INDEX_KEY]);
      const sharedKnown = Object.values(index).filter((e) => e && e.owner).length;
      const list = (folders || []).map((f) => ({ name: String(f.name || ''), path: String(f.path || ''), itemCount: Number(f.itemCount) || 0, modified: String(f.modified || '') }));
      return { ok: true, folder: { path: cfg.folderPath, viewUrl: cfg.viewUrl || '', url: shareFolderUrl(cfg) }, folders: list, count: list.length, exists: folders !== null, mine, shared: shared ? shared.length : 0, sharedFolders: shared || [], sharedKnown,
        message: folders === null ? '밑폴더가 아직 없습니다 — 지금 맞추면 만듭니다' : `연결됨 · 과제 폴더 ${list.length}개${shared !== null ? ` · 나와 공유 ${shared.length}개` : ''}${sharedKnown ? ` (그중 동기화 대상 ${sharedKnown}개)` : ''}` };
    } catch (e) { const d = describeShare(e); return shareFail(d.kind, d.message); }
  }
  /* 클립보드 쓰기: rerp 는 서비스워커라 오프스크린 문서(offscreen/offscreen.html)를 띄웠고, 사이드패널은 deps.copyText(navigator.clipboard) — 폴더를 푸는 몇 초 뒤라 못 쓰면 화면이 주소를 보여 준다 */
  async function clipboardWrite(text) {
    try { return !!(deps.copyText && await deps.copyText(text)); } catch (e) { return false; }
  }
  /* 패널 ⬆(plan-export) · [주소 복사]: 주소를 클립보드에 복사한다 — prjNo 가 있고 그 과제 폴더를 알면 과제 폴더 보기 주소(msg.file 이면 예상비용.json 주소), 아니면 base 를 여는 주소(viewUrl — 없으면 폴더 주소). 공유가 꺼져 있어도 복사해 준다
   *   → { ok, copied, url, what('project' | 'base'), prjNo, folder:{ path, viewUrl } } | { ok:false, kind, message, error }. 옛 메시지 이름 'planExport' 도 여기로 */
  async function shareFolderCopy(msg) {
    const p = await loadPlus();
    try {
      const prj = msg && msg.prjNo ? String(msg.prjNo) : '';
      let cfg = prj ? await shareProjectCfg(prj, p) : null, what = cfg ? 'project' : 'base';
      if (!cfg) cfg = await shareCfg(p, false);
      const url = (what === 'project' && msg.file) ? shareFileUrl(cfg, sharePlanName()) : (cfg.viewUrl || shareFolderUrl(cfg));
      const copied = await clipboardWrite(url);
      return { ok: true, copied, url, what, prjNo: prj, folder: { path: cfg.folderPath, viewUrl: cfg.viewUrl || '' } };
    } catch (e) { const d = describeShare(e); return shareFail(d.kind, d.message); }
  }
  /* [참여연구원에게 공유]: 과제 폴더를 사람들에게 공유 — msg = { prjNo, names?(없으면 참여인력 전부, 내 이름 제외), role?('edit' 기본 | 'read') }
   *   → { ok, prjNo, folder(이름), share:{ shared:[{ name, email }], ambiguous:[{ name, candidates }], notFound:[name], error? }, message } | { ok:false, kind, message, error }. 결과는 shareState.pages[prjNo].share 에도 남긴다 */
  async function shareFolderPeople(msg) {
    const p = await loadPlus();
    const prjNo = String((msg && msg.prjNo) || '').trim();
    if (!prjNo) return shareFail('error', '과제번호가 없습니다');
    try {
      const index = shareObj((await chrome.storage.local.get(SHARE_INDEX_KEY))[SHARE_INDEX_KEY]);
      const cfg = await shareProjectCfg(prjNo, p, index);
      if (!cfg) return shareFail('nofolder', SHARE_NOFOLDER_MSG);
      const role = msg && msg.role === 'read' ? 'read' : 'edit';
      const ctx = await ctxOf();
      const names = Array.isArray(msg.names) && msg.names.length
        ? Array.from(new Set(msg.names.map((s) => String(s || '').trim()).filter(Boolean)))
        : await shareParticipantNames(prjNo, ctx.myNames);
      const folder = String(index[prjNo].folder || '');
      if (!names.length) {
        const share = Object.assign(shareResultOf(null, role), { note: '참여인력에 나 말고는 없음' });
        await sharePatchPage(prjNo, { share });
        return { ok: true, prjNo, folder, share, message: '공유할 사람이 없습니다 — 참여인력에 나 말고는 없음' };
      }
      const pg = {};
      await sharePeopleJobs([{ prjNo, cfg, names, pg }], role);
      const share = pg.share || shareResultOf(null, role);
      await sharePatchPage(prjNo, { share, folder });
      return { ok: !share.error, prjNo, folder, share, message: shareResultText(share), error: share.error, kind: share.kind };
    } catch (e) { const d = describeShare(e); return shareFail(d.kind, d.message); }
  }
  /* [링크 복사]: 조직 내 편집 링크(linkKind OrganizationEdit)를 만들어 클립보드에 — msg = { prjNo?(없으면 base), edit?(false 면 읽기) } → { ok, url, copied, prjNo, folder:{ path, viewUrl } } | { ok:false, kind, message, error } */
  async function shareOrgLink(msg) {
    const p = await loadPlus();
    try {
      const prjNo = String((msg && msg.prjNo) || '').trim();
      const cfg = prjNo ? await shareProjectCfg(prjNo, p) : await shareCfg(p, false);
      if (!cfg) return shareFail('nofolder', SHARE_NOFOLDER_MSG);
      const w = await shareStore.openWriter(cfg);
      let r;
      try { r = await w.orgLink(cfg.folderPath, { edit: !(msg && msg.edit === false) }); } finally { try { await w.close(); } catch (e) {} }
      const url = String((r && r.url) || '');
      if (!url) throw Object.assign(new Error(`공유 링크를 받지 못했습니다${r && r.error ? ` — ${r.error}` : ''}`), { kind: 'http' });
      const copied = await clipboardWrite(url);
      return { ok: true, url, copied, prjNo, folder: { path: cfg.folderPath, viewUrl: cfg.viewUrl || '' } };
    } catch (e) { const d = describeShare(e); return shareFail(d.kind, d.message); }
  }
  /* 과제 폴더 이름 바꾸기(선택) — msg = { prjNo, name } → { ok, prjNo, name, unchanged? }. 이름은 KRX_PRJDOC.folderNameFor 규칙(파일 이름에 못 쓰는 글자 제거 · 60자)으로 다듬고, shareIndex 의 folder·path·url 을 rename 결과로 고친다
   *   (path·url 을 옛 경로로 두면 다음 동기화가 그 색인을 믿고 옛 경로를 nofolder 로 보아 — 동료 폴더면 색인을 버리고 다시 훑고, 내 base 면 매번 다시 훑는다; 2026-10-18 검토) */
  async function shareRename(msg) {
    const p = await loadPlus();
    const prjNo = String((msg && msg.prjNo) || '').trim(), name = String((msg && msg.name) || '').trim();
    if (!prjNo || !name) return shareFail('error', '과제번호와 새 폴더 이름이 필요합니다');
    try {
      const index = shareObj((await chrome.storage.local.get(SHARE_INDEX_KEY))[SHARE_INDEX_KEY]);
      const cfg = await shareProjectCfg(prjNo, p, index);
      if (!cfg) return shareFail('nofolder', SHARE_NOFOLDER_MSG);
      const clean = typeof KRX_PRJDOC.folderNameFor === 'function' ? String(KRX_PRJDOC.folderNameFor({ alias: name, prjNo }) || '') : name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 60);
      if (!clean) return shareFail('badurl', '폴더 이름에 쓸 수 있는 글자가 없습니다');
      if (clean === String(index[prjNo].folder || '')) return { ok: true, prjNo, name: clean, unchanged: true };
      const w = await shareStore.openWriter(cfg);
      let r;
      try { r = await w.rename(cfg.folderPath, clean); } finally { try { await w.close(); } catch (e) {} }
      const newPath = String((r && r.path) || `${String(cfg.folderPath).replace(/\/[^/]*$/, '')}/${clean}`);
      const newCfg = (() => { try { return SPX.parseFolder(String((r && r.url) || `${cfg.origin}${newPath.split('/').map(encodeURIComponent).join('/')}`)); } catch (e) { return null; } })();
      index[prjNo] = Object.assign({}, index[prjNo], { folder: clean, path: newPath, url: String((r && r.url) || (newCfg ? shareFolderUrl(newCfg) : '')), at: Date.now() });
      await chrome.storage.local.set({ [SHARE_INDEX_KEY]: index });
      await sharePatchPage(prjNo, { folder: clean, folderUrl: newCfg ? (newCfg.viewUrl || shareFolderUrl(newCfg)) : '', planUrl: '', webUrl: '' });
      return { ok: true, prjNo, name: clean, path: newPath };
    } catch (e) { const d = describeShare(e); return shareFail(d.kind, d.message); }
  }

  // rerp background.js 의 chrome.runtime.onMessage switch 가운데 planSync · planSyncQueue · share* 갈래 — rerp/plan.js 의 api.send 에 끼운다
  async function send(msg) {
    switch (msg && msg.type) {
      case 'planSync': return await shareSync(String(msg.reason || 'manual'), { prjNo: msg.prjNo ? String(msg.prjNo) : '' });   // 공유 (Plus): 과제별 공유 파일과 맞춤 (구름/저장 아이콘 manual+prjNo · 패널 열 때 load · 지금 맞추기 manual). 이름은 옛 planSync 그대로 — rerp/plan.js 가 보냄
      case 'planSyncQueue': queueShareSync(String(msg.reason || 'edit')); return { ok: true };   // 항목 편집 뒤 4초 모아서
      case 'shareProbe': return await shareProbe(msg);                                      // [연결 확인] — base 풀기(msg.folder 가 있으면 저장 전 칸 값) + 과제 폴더 목록 + 나와 공유 → { ok, folder, folders, count, shared, mine } / 로그인 필요(auth)
      case 'shareFolderCopy': case 'planExport': return await shareFolderCopy(msg);        // 패널 ⬆ · [주소 복사]: base(또는 prjNo 의 과제 폴더 · file 이면 예상비용.json) 주소를 클립보드에 (planExport 는 옛 이름)
      case 'shareFolderPeople': return await shareFolderPeople(msg);                       // [참여연구원에게 공유]: 과제 폴더를 사람들(names 또는 참여인력 전부)에게 편집 공유 → { ok, share:{ shared, ambiguous, notFound } }
      case 'shareOrgLink': return await shareOrgLink(msg);                                 // [링크 복사]: 조직 내 편집 링크를 만들어 클립보드에 → { ok, url, copied }
      case 'shareRename': return await shareRename(msg);                                   // 과제 폴더 이름 바꾸기(선택) → { ok, name }
      default: return { ok: false, error: `모르는 요청 ${msg && msg.type}` };
    }
  }

  return { shareSync, queueShareSync, shareProbe, shareFolderCopy, shareFolderPeople, shareOrgLink, shareRename, shareCfg, shareProjectCfg, send, SHARE_SYNC_MIN_MS, SHARE_BASE_NAME, SHARE_INDEX_KEY };
}
