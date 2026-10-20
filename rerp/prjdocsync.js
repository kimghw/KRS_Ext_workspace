// kr_ext_rerp `lib/prjdoc-sync.js` 를 그대로 옮긴 것 — IIFE 머리와 꼬리의 `g.KRX_PRJDOC_SYNC = api` 를 export 로만 바꿨다(원본이 전역 g.KRX_PRJDOC 로 읽던 것은 아래 shim). 출처·갱신 규칙은 rerp/README.md.
/* 확장 Plus — 과제 공유 문서 동기화의 차례 v2(순수 오케스트레이션 · 백그라운드 background.js shareSync 전용 + Node 테스트는 가짜 store 로).
 * 2026-10-18 사용자 지정: "onedrive 에 업무/shared 안에 과제별로 .. 약칭으로 없으면 jobid 없으면 임시번호. … 년차별로 1개 파일이고 1개 파일에서 변경사항이랑 다 관리" · "참여연구원들에게 공유할 수 있게 … workspace 에도 경로주면 알아서 동기화" ·
 *   "예상지출도 … 별도 파일에서 해도 되긴하는데 알아서 해줘" → 밑폴더(base — 기본 내 OneDrive 문서/업무/shared) 아래 **과제 폴더**(이름 = 약칭 → Job Id → rERP 과제번호, KRX_PRJDOC.folderNameFor)마다 연차 파일 <n>차년도.json 과 예상비용.json 하나.
 *   문서 모양·병합은 lib/prjdoc.js(KRX_PRJDOC), 저장소는 lib/sp-store.js(KRX_SP — deps.store 로 받음, 브라우저 로그인 쿠키만). 원노트·MCP·Graph 는 쓰지 않는다. v1(<과제번호>.json) 파일은 parse 가 null → kind 'parse' 로 그 파일만 건너뛴다.
 *
 * run(deps) — deps = {
 *   store: { listFolders(cfg, io) → [{ name, path, itemCount, modified }], childCfg(cfg, name) → 하위 폴더 cfg, listFiles(cfg, io), readFile(cfg, name, io) → { text, meta } | null,
 *            openWriter(cfg, io) → writer { ensureFolder(), ensurePath?(path), at?(cfg)(같은 작업 탭·다이제스트로 다른 폴더를 쓰는 손잡이), modify(name, transform, { comment }), close() },
 *            sharedWithMe?(io, { driveHost }) → [{ name, webUrl, folder, ownerName?, cfg? }], parseFolder?(url) → cfg, folderUrl?(cfg) → 주소, fileUrl?(cfg, name) }   (KRX_SP 를 감싼 것 — io = deps.io 를 그대로 넘긴다)
 *   base(cfg — 밑폴더, KRX_SP.parseFolder 결과: folderPath · siteUrl · viewUrl · fileUrl(name)), driveHost, names{ prjNo: 과제명 }, rsprs{ prjNo: 책임자 }, myPrjNos[](내 참여 과제), leadPrjNos[](내가 책임자), aliases{ prjNo: 약칭 },
 *   index(storage.local.shareIndex 캐시 — { [prjNo]: { base, folder, site, path, url, owner, at } }), discover(나와 공유 훑기 — 기본 true), only?(과제번호 하나만),
 *   want: { plan, research, staff, budget, changes, alias, support }(끈 칸은 받지도 올리지도 않음 — 파일의 그 칸은 그대로. 2026-10-19 몫: staff·budget 은 rerp 만 고치고 WORKSPACE 는 받기만 — 그쪽은 pullOnly 나 자기 몫으로; 행정지원 support 는 양쪽), who,
 *   pullOnly?: { plan, year }(그 파일은 **읽어 받기만** — 병합해 saveLocal 은 하지만 writer 를 열지 않아 쓰지도 만들지도 않고, 로컬에만 있는 것은 올라가지 않는다. KRS WORKSPACE 가 예상비용.json 을 받기만 할 때 —
 *     2026-10-18 사용자 "예상지출도 … workspace 에도 경로주면 알아서 동기화" 의 몫 나눔: 예상 비용은 rerp 가 쓰고 WORKSPACE 는 본다. 기본 둘 다 false),
 *   loadLocal() → { plan:{ plans, del }, research(맵), staff:{ plans, del }, aliases, aliasesAt, support(맵 prjNo → { people, at }), changes(맵 '과제번호@연차' → []), projects:{ [prjNo]: { prjNm, rspr, anl, stDt, endDt(ERP 현재 연차 기간 — yearSpan 용), start?, end?, jobId?, io?, note?, at? } } },
 *   saveLocal(part, prj, data) — part 'plan'|'research'|'staff'|'budget'|'changes'|'alias'|'support'|'project', data 는 KRX_PRJDOC.toLocalYear · toLocalPlan 의 그 칸(머리 주석 참고), now? }
 * 차례:
 *   ① base 의 폴더 목록(listFolders — 없으면 kind 'nofolder' → 처음 쓸 때 만든다). 폴더마다 색인(index)의 경로가 맞으면 그 과제 폴더로 믿고(그 폴더의 첫 연차 파일을 읽을 때 project.prjNo 로 검증 — 다르면 색인이 틀린 것으로 보고 다시 고른다),
 *      색인에 없는 폴더는 **훑는다**(probe — 파일 목록 + 첫 연차 파일 한 장 → project.prjNo. 연차 파일이 없는 폴더는 '아직 못 알아본 폴더' — 그 이름으로 폴더를 만들 차례가 오면 그것을 쓴다). state.scanned = 훑은 폴더 수.
 *   ② discover 면 "나와 공유" 목록(sharedWithMe)에서 폴더 항목 가운데 경로 끝이 …/shared(동료의 base — 그 안을 listFolders) 또는 …/shared/<이름>(과제 폴더)인 것을 같은 식으로 훑어 project.prjNo 가 내 참여 과제면 대상에 넣는다(owner = 그 폴더 주인).
 *      같은 과제가 내 base 에도 동료 폴더에도 있으면: 내가 책임자면 내 것, 아니면 동료(책임자) 것(내 것은 rec.alt 로 남겨 동료 폴더가 없어졌을 때 되돌아간다). 동료 사이트의 오류(권한 없음 등)는 그 폴더만 건너뛴다.
 *      "나와 공유" 끝점 자체의 auth(401/403 — 테넌트 정책으로 막힌 Graph 호환 끝점)는 base 목록이 이미 성공한 뒤라 전체 실패로 두지 않고 discoverError 로만 남긴다(offline 만 전체 실패).
 *   ③ 대상 과제 = only ∪ (myPrjNos ∪ 로컬 자료가 있는 과제 ∪ 폴더에서 알아낸 내 참여 과제). 과제마다 폴더가 없으면 **내가 책임자거나 로컬 자료가 있을 때만** base 에 folderNameFor 이름으로 만든다(base 도 없으면 먼저), 아니면 noFolder(책임자가 만들어 공유할 때까지 대기 — 오류 아님).
 *      그 이름이 이미 **다른 과제**의 폴더(이번에 알아본 것 · 이번에 만든 것 · base 에 있는데 못 알아본 폴더가 아닌 것)면 '<이름>-<과제번호>' 로 비켜 간다 — 두 과제가 같은 약칭이면 둘째가 첫째의 파일을 덮어쓰던 것(2026-10-18 검토).
 *      폴더 만들기는 **내 base 바로 아래**(owner 없음 · 같은 사이트)에서만 — 색인에 남은 동료 폴더가 지워졌거나 이름이 바뀌어 nofolder 가 되면 동료 사이트에 새로 만들지 않고 그 색인은 버린 뒤(state.index 에서도 빠짐 — 다음 실행이 나와 공유를 다시 훑음) 다시 고른다(alt → 책임자/로컬 자료면 base 에 새로 → 아니면 noFolder).
 *   ④ 연차마다(로컬 계획·기록·변경이력이 있는 연차 ∪ 폴더의 연차 파일 ∪ 현재 연차(projects[prj].anl, 모르면 1)) 연차 파일: readFile → parse(kind 'year'·연차가 이름과 같아야 — 아니면 kind 'parse' 로 그 파일만 건너뜀) → loadLocal → KRX_PRJDOC.mergeYear →
 *      localChanged 인 칸마다 saveLocal(pull — 저장 직전에 loadLocal 을 다시 하고 다시 병합해 그 사이 패널에서 고친 것을 덮지 않음) → remoteChanged·파일 없음·내가 남긴 체크아웃(meta.checkedOutByMe)이면 writer.modify(transform 은 체크아웃한 최신 글로 다시 병합).
 *      체크아웃한 최신 글의 project.prjNo 가 이 과제와 다르면 쓰지 않고(discard) kind 'index' 로 던져 색인 재선택 길을 탄다 — 남의 과제 파일을 덮지 않는 마지막 안전장치.
 *   ⑤ 예상비용.json 도 같은 식(KRX_PRJDOC.mergePlan) — 로컬에 항목·묘비가 없고 파일도 없으면 만들지 않는다. 그 파일의 project.prjNo 가 다르면(연차 파일은 맞는데 예상비용.json 만 남의 것) 그 파일만 kind 'parse' 로 건너뛴다.
 *   ⑥ writer 는 **사이트마다 하나**(동료 폴더는 그 사람의 personal 사이트) — 쓸 것이 있을 때만 열고 finally 에 모두 닫는다. 같은 사이트의 다른 폴더는 writer.at(cfg)(KRX_SP 의 writer 가 줌 — 같은 작업 탭·다이제스트로 다른 폴더의 파일을 다루는 손잡이, close 는 no-op) 로,
 *      at 이 없는 writer(다른 store 구현)면 그 폴더로 하나 더 연다(동작은 같고 과제 폴더마다 작업 탭이 하나씩 더 뜸).
 *      폴더 만들기는 그 과제 폴더의 writer 로 writer.ensurePath(folderPath)(여러 단 — 없던 base 까지 한 번에) 가 있으면 그것, 없으면 writer.ensureFolder()(한 단 — base 의 writer 로 base 부터). rec.created(→ state.created · pages[].folderCreated — 배선의 참여연구원 자동 공유)는 ensurePath/ensureFolder 가 정말 만들었다고 한 때만.
 *   ⑦ 깨진 파일은 kind 'parse' 로 그 파일만 건너뛰고(덮어쓰지 않음 — 폴더에서 지우면 다시 만든다), 남이 체크아웃은 'locked'. auth · offline · badurl · tab 은 내 사이트면 전체 실패(나머지 과제는 멈춤), 동료 사이트면 그 과제만.
 * → { state }  state = { at, ok, base:{ path, viewUrl }(folder 도 같은 값 — v1 호환), count(과제), files(읽은·만든 파일 수), scanned(훑은 폴더 수), written, pulled, errors, error?, kind?, created:[폴더를 새로 만든 과제번호 — 배선이 참여연구원 자동 공유에 씀], discoverError?,
 *   pages: { [prjNo]: { prjNo, title, folder(이름), folderUrl(보기 주소), webUrl(현재 연차 파일 주소 — 파일이 있는 것을 확인했을 때만), planUrl(예상비용.json 주소), owner(남의 폴더면 주인), years:[n…], at, created(파일을 새로 만듦), folderCreated?, pulled, pushed, checkedIn?,
 *                      count(예상 비용 항목 수), counts{ plan, research, staff, budget, changes }, remoteAt(가장 늦은 파일 updatedAt ms), remoteBy, noFolder?, error?, kind? } },
 *   index: 새 shareIndex { [prjNo]: { base, folder, site, path, url, owner, at } } }
 *   pages 는 v1·planSyncState 와 호환 칸(prjNo·title·webUrl·at·created·pulled·pushed·count·remoteAt·remoteBy)을 지킨다. 쿠키·다이제스트 값은 어디에도 남기지 않는다 */
import KRX_PRJDOC from './prjdoc.js';
const g = { KRX_PRJDOC };   // [workspace] 원본은 전역 g.KRX_PRJDOC 를 읽는다
const api = {};
const D = () => g.KRX_PRJDOC;
const FATAL = new Set(['auth', 'offline', 'badurl', 'tab']);   // 과제 하나의 문제가 아니라 전체가 안 되는 것(내 사이트일 때)
const SHARED_SEG = 'shared';
const fail = (kind, msg) => { const e = new Error(msg); e.kind = kind; return e; };
const kindOf = (e) => (e && e.kind) || '';
const msgOf = (e) => String((e && e.message) || e);
const str = (v) => (v == null ? '' : String(v));
const lower = (s) => str(s).toLowerCase();
const int = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 ? n : 0; };
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const siteOf = (cfg) => str(cfg && (cfg.siteUrl || cfg.origin));
const PARSE_MSG = (name) => `${name} 을(를) 읽을 수 없습니다 — JSON 이 아니거나 다른 판(v2 아님)의 문서입니다. 폴더에서 그 파일을 지우면 다시 만듭니다`;
const FOREIGN_MSG = (name, other) => `${name} 은(는) 다른 과제(${other})의 파일입니다 — 건너뜁니다. 폴더에서 그 파일을 옮기거나 지우면 다시 만듭니다`;
const indexErr = (actual, name) => Object.assign(fail('index', `${name} 의 과제번호(${actual})가 색인과 다릅니다`), { actual });

api.run = async function (deps) {
  const now = deps.now || Date.now(), who = str(deps.who);
  const store = deps.store, io = deps.io || {};
  const base = deps.base || deps.cfg || {};
  const names = deps.names || {}, rsprs = deps.rsprs || {}, aliases0 = obj(deps.aliases) || {};
  const want = Object.assign({ plan: true, research: true, staff: true, budget: true, changes: true, alias: true, support: true }, deps.want || {});
  const pullOnly = Object.assign({ plan: false, year: false }, obj(deps.pullOnly) || {});   // 받기만 하는 파일 — 읽어 병합해 saveLocal 은 하되 writer 는 열지 않는다(없으면 만들지도 않음)
  const only = deps.only ? str(deps.only) : '';
  const mine = Array.from(new Set((deps.myPrjNos || []).map(String).filter(Boolean)));
  const leads = new Set((deps.leadPrjNos || []).map(String).filter(Boolean));
  const discover = deps.discover !== false && typeof store.sharedWithMe === 'function';
  const index0 = obj(deps.index) || {};
  const baseSite = siteOf(base), basePath = str(base.folderPath);
  const baseInfo = { path: basePath, viewUrl: str(base.viewUrl) };
  const state = { at: now, ok: true, base: baseInfo, folder: baseInfo, count: 0, files: 0, scanned: 0, written: 0, pulled: 0, errors: 0, created: [], pages: {}, index: {} };
  const fileUrlOf = (cfg, name) => (typeof cfg.fileUrl === 'function' ? str(cfg.fileUrl(name)) : typeof store.fileUrl === 'function' ? str(store.fileUrl(cfg, name)) : '');
  const folderUrlOf = (cfg) => (typeof store.folderUrl === 'function' ? str(store.folderUrl(cfg)) : str(cfg.url));
  const viewUrlOf = (cfg) => str(cfg.viewUrl) || folderUrlOf(cfg);
  const underBase = (cfg) => siteOf(cfg) === baseSite && lower(cfg.folderPath).startsWith(`${lower(basePath)}/`);
  const finish = () => { state.count = Object.keys(state.pages).length; state.ok = state.errors === 0; if (!state.ok && !state.error) state.error = '동기화에 실패한 과제가 있습니다'; return { state }; };
  const fatal = (e) => { state.ok = false; state.errors++; state.error = msgOf(e); state.kind = kindOf(e) || 'error'; return finish(); };
  const fatalFor = (e, rec) => FATAL.has(kindOf(e)) && (!rec || rec.site === baseSite || kindOf(e) === 'offline');   // 동료 사이트의 auth 등은 그 과제만

  /* ---------- 폴더 알아보기 ---------- */
  // 폴더 기록 = { name, cfg, base(상위 경로), owner(남의 폴더면 주인), site, fmap(파일 이름 → 메타 | null = 아직 안 받음), pre({ 파일 이름: readFile 결과 — 훑을 때 읽은 것 }), exists, fromIndex(색인으로 믿은 것 — 첫 읽기에서 검증), created, alt?(pick 이 밀어낸 내 base 의 폴더) }
  const folderOf = {};        // prjNo → 폴더 기록
  /* 폴더를 만들 수 있는 자리 — 내 base 바로 아래(owner 없음 · 같은 사이트). 동료 사이트·다른 곳의 폴더가 없어졌으면 만들지 않고 색인을 버린다 */
  const canCreate = (rec) => !rec.owner && rec.site === baseSite && lower(rec.base) === lower(basePath);
  const staleErr = (rec) => Object.assign(fail('nofolder', `공유 폴더가 없습니다: ${str(rec.cfg.folderPath)}`), { stale: true });
  const unidentified = {};    // 이름 → 연차 파일이 없어 아직 못 알아본 base 의 폴더
  const probed = new Set();   // 이번에 훑은(또는 색인으로 잡은) 폴더 경로(소문자)
  const idxByPath = {};
  for (const [prj, e] of Object.entries(index0)) { if (!obj(e)) continue; const p = str(e.path) || (e.base && e.folder ? `${e.base}/${e.folder}` : ''); if (p) idxByPath[lower(p)] = prj; }
  const mkRec = (name, cfg, parent, owner) => ({ name: str(name), cfg, base: str(parent), owner: str(owner), site: siteOf(cfg), fmap: null, pre: {}, exists: true, fromIndex: false, created: false });
  /* 폴더 하나를 훑는다 — 파일 목록 + 첫 연차 파일 → { prjNo, jobId }. 연차 파일이 없으면 prjNo '' */
  async function probe(rec) {
    state.scanned++;
    rec.fmap = new Map(((await store.listFiles(rec.cfg, io)) || []).map((f) => [str(f.name), f]));
    const years = Array.from(rec.fmap.keys()).map((nm) => D().isYearName(nm)).filter(Boolean).sort((a, b) => a - b);
    if (!years.length) return { prjNo: '', jobId: '' };
    const name = D().yearName(years[0]);
    const file = await store.readFile(rec.cfg, name, io);
    rec.pre[name] = file;
    const parsed = file && file.text != null ? D().parse(file.text, { year: years[0] }) : null;
    const pj = parsed && parsed.kind === 'year' ? parsed.doc.project : null;
    return { prjNo: pj ? str(pj.prjNo) : '', jobId: pj ? str(pj.jobId) : '' };
  }
  /* 과제에 폴더를 붙인다 — 이미 있으면: 내 base 폴더 vs 동료 폴더는 내가 책임자면 내 것, 아니면 동료 것 */
  const pick = (prj, rec) => {
    const cur = folderOf[prj];
    if (!cur) { folderOf[prj] = rec; return; }
    if (!cur.owner && rec.owner && !leads.has(prj)) { rec.alt = cur; folderOf[prj] = rec; }   // 밀어낸 내 폴더는 alt 로 — 동료 폴더가 없어졌을 때 되돌아간다
  };
  // ① base
  let baseMissing = false, folders = [];
  try { folders = (await store.listFolders(base, io)) || []; } catch (e) { if (kindOf(e) === 'nofolder') baseMissing = true; else return fatal(e); }
  const toProbe = [];
  for (const f of folders) {
    if (!f || !f.name) continue;
    const rec = mkRec(f.name, store.childCfg(base, f.name), basePath, '');
    const key = lower(rec.cfg.folderPath);
    probed.add(key);
    const hit = idxByPath[key];
    if (hit && !folderOf[hit]) { rec.fromIndex = true; folderOf[hit] = rec; } else toProbe.push(rec);
  }
  for (const rec of toProbe) {
    let p;
    try { p = await probe(rec); } catch (e) { if (kindOf(e) === 'nofolder') continue; if (fatalFor(e, rec)) return fatal(e); continue; }
    if (p.prjNo) { if (!folderOf[p.prjNo]) folderOf[p.prjNo] = rec; } else unidentified[rec.name] = rec;
  }
  // 색인에 있는 동료 폴더(base 밖) — 주소에서 cfg 를 되살릴 수 있으면 훑지 않고 쓴다(첫 읽기에서 검증). 내 base 에도 같은 과제가 있으면 pick 의 규칙(책임자면 내 것, 아니면 동료 것)
  if (typeof store.parseFolder === 'function') {
    for (const [prj, e] of Object.entries(index0)) {
      if (!obj(e) || !e.url) continue;
      let cfg = null;
      try { cfg = store.parseFolder(str(e.url)); } catch (x) { cfg = null; }
      if (!cfg || underBase(cfg) || probed.has(lower(cfg.folderPath))) continue;
      const rec = mkRec(e.folder || cfg.name, cfg, e.base || str(cfg.folderPath).replace(/\/[^/]*$/, ''), e.owner);
      rec.fromIndex = true;
      probed.add(lower(cfg.folderPath));
      pick(prj, rec);
    }
  }
  // ② 나와 공유
  if (discover && (!only || !folderOf[only])) {
    let shared = [];
    try { shared = (await store.sharedWithMe(io, { driveHost: deps.driveHost })) || []; } catch (e) { if (kindOf(e) === 'offline') return fatal(e); state.discoverError = msgOf(e); }   // auth 도 여기(base 목록은 이미 성공 — 끝점 하나가 정책으로 403 이어도 내 base 는 계속)
    for (const it of shared) {
      if (!it || !it.folder) continue;
      let cfg = it.cfg || null;
      if (!cfg && typeof store.parseFolder === 'function') { try { cfg = store.parseFolder(str(it.webUrl)); } catch (x) { cfg = null; } }
      if (!cfg || !cfg.folderPath) continue;
      const segs = str(cfg.folderPath).split('/').filter(Boolean);
      const last = lower(segs[segs.length - 1]), parent = lower(segs[segs.length - 2]);
      const owner = str(it.ownerName);
      const cands = [];
      try {
        if (last === SHARED_SEG) { for (const f of (await store.listFolders(cfg, io)) || []) if (f && f.name) cands.push(mkRec(f.name, store.childCfg(cfg, f.name), cfg.folderPath, owner)); }
        else if (parent === SHARED_SEG) cands.push(mkRec(segs[segs.length - 1], cfg, segs.slice(0, -1).join('/') ? `/${segs.slice(0, -1).join('/')}` : '', owner));
      } catch (e) { if (kindOf(e) === 'offline') return fatal(e); state.discoverError = msgOf(e); continue; }
      for (const rec of cands) {
        const key = lower(rec.cfg.folderPath);
        if (underBase(rec.cfg) || probed.has(key)) continue;   // 내 base 의 폴더가 공유로 되돌아온 것 · 이미 본 폴더
        probed.add(key);
        const hit = idxByPath[key];
        if (hit) { rec.fromIndex = true; pick(hit, rec); continue; }
        let p;
        try { p = await probe(rec); } catch (e) { if (kindOf(e) === 'offline') return fatal(e); state.discoverError = msgOf(e); continue; }
        if (p.prjNo && mine.includes(p.prjNo)) pick(p.prjNo, rec);
      }
    }
  }

  /* ---------- writer(사이트마다 하나) · 폴더 만들기 ---------- */
  const sites = new Map();     // site → { writer, folderPath }
  const extras = new Map();    // folderPath(소문자) → writer (at 이 없는 writer 로 같은 사이트의 다른 폴더를 쓸 때)
  const siteErrors = new Map();
  async function openFor(cfg) {
    const site = siteOf(cfg), path = str(cfg.folderPath);
    if (siteErrors.has(site)) throw siteErrors.get(site);
    let s = sites.get(site);
    if (!s) {
      let w;
      try { w = await store.openWriter(cfg, io); } catch (e) { siteErrors.set(site, e); throw e; }
      s = { writer: w, folderPath: path };
      sites.set(site, s);
    }
    if (lower(s.folderPath) === lower(path)) return s.writer;
    if (typeof s.writer.at === 'function') return s.writer.at(cfg);
    let w2 = extras.get(lower(path));
    if (!w2) { try { w2 = await store.openWriter(cfg, io); } catch (e) { siteErrors.set(site, e); throw e; } extras.set(lower(path), w2); }
    return w2;
  }
  /* 그 폴더에 쓸 writer — 폴더가 없으면 만든다(내 base 바로 아래만 — canCreate; 동료 사이트 등은 stale nofolder 로 던져 색인을 버리고 다시 고르게). writer.ensurePath(path) 가 있으면 그 폴더의 writer 로 여러 단(base 포함)을 한 번에, 없으면 ensureFolder()(한 단) 로 base 부터.
   *   rec.created 는 ensurePath/ensureFolder 가 돌려준 created(또는 made 가 있음)로 — 이미 있던 폴더를 "새로 만듦" 으로 보고 참여연구원에게 다시 공유하지 않게 */
  const madeOf = (r) => (r && typeof r === 'object' ? !!(r.created || (Array.isArray(r.made) && r.made.length)) : true);   // 결과를 안 주는 store 는 만들었다고 침
  async function writerFor(rec) {
    if (!rec.exists) {
      if (!canCreate(rec)) throw staleErr(rec);
      const w = await openFor(rec.cfg);
      let made = false;
      if (typeof w.ensurePath === 'function') { made = madeOf(await w.ensurePath(str(rec.cfg.folderPath))); baseMissing = false; }
      else {
        if (baseMissing) { const wb = await openFor(base); await wb.ensureFolder(); baseMissing = false; }
        made = madeOf(await w.ensureFolder());
      }
      rec.exists = true; rec.created = made;
    }
    return openFor(rec.cfg);
  }

  /* ---------- 대상 과제 ---------- */
  let local = await deps.loadLocal();
  const targets = new Set();
  if (only) targets.add(only);
  else {
    for (const p of mine) targets.add(p);
    for (const p of D().localPrjNos(local)) targets.add(p);
    for (const p of Object.keys(folderOf)) if (mine.includes(p)) targets.add(p);
  }
  const projectOf = (l, prj) => obj(obj(l.projects) && l.projects[prj]) || {};
  const metaOf = (prj, l) => { const pr = projectOf(l, prj); return { prjNm: names[prj] || str(pr.prjNm), rspr: rsprs[prj] || str(pr.rspr), stDt: str(pr.stDt), endDt: str(pr.endDt), who }; };   // 과제 전체 기간(start·end)은 WORKSPACE 몫 — fromLocalYear 가 local.projects 에서 가져간다
  const aliasOf = (prj, l) => str(aliases0[prj] || (l.aliases || {})[prj]);
  /* 이 이름의 base 폴더가 다른 과제 것인가 — 이번에 알아본·만든 폴더(folderOf) 또는 base 에 있는데 못 알아본 폴더가 아닌 것(연차 파일로 다른 과제가 확인된 폴더) */
  const takenBy = (prj, name) => {
    const key = lower(str(store.childCfg(base, name).folderPath));
    for (const [p, rec] of Object.entries(folderOf)) if (p !== prj && lower(str(rec.cfg.folderPath)) === key) return true;
    return folders.some((f) => f && lower(f.name) === lower(name)) && !unidentified[name];
  };
  /* 폴더 고르기 — 없으면 내가 책임자거나 로컬 자료가 있을 때만 base 에 새로(같은 이름의 못 알아본 폴더가 있으면 그것). 이름이 다른 과제의 폴더면 '<이름>-<과제번호>' 로 비켜 간다(그것도 겹치면 과제번호만) */
  function resolveFolder(prj, l, hasLocal) {
    if (folderOf[prj]) return folderOf[prj];
    if (!(leads.has(prj) || hasLocal)) return null;
    let name = D().folderNameFor({ alias: aliasOf(prj, l), jobId: projectOf(l, prj).jobId, prjNo: prj });
    if (takenBy(prj, name)) { const alt = `${name}-${prj}`; name = takenBy(prj, alt) ? D().folderNameFor({ prjNo: prj }) : alt; }
    let rec = unidentified[name];
    if (rec) delete unidentified[name];
    else { rec = mkRec(name, store.childCfg(base, name), basePath, ''); rec.exists = false; rec.fmap = new Map(); }
    folderOf[prj] = rec;
    return rec;
  }
  const newPage = (prj) => ({ prjNo: prj, title: names[prj] || prj, folder: '', folderUrl: '', webUrl: '', planUrl: '', owner: '', years: [], at: now, created: false, pulled: false, pushed: false, count: 0, counts: { plan: 0, research: 0, staff: 0, budget: 0, changes: 0 }, remoteAt: 0, remoteBy: '' });
  const noteError = (r, e) => { if (!r.error) { r.error = msgOf(e); r.kind = kindOf(e) || 'error'; state.errors++; } if (!state.error) { state.error = r.error; state.kind = r.kind; } };
  const comment = `KR eClass 확장 공유 ${who ? `· ${who} ` : ''}${new Date(now).toISOString()}`;

  /* ---------- 연차 파일 하나 ---------- */
  /* localChanged 인 칸마다 saveLocal — m.doc 을 **지금** 로컬과 다시 병합한 결과를 되돌려 넣는다(작업 탭을 여는 몇 초 사이 패널에서 고친 것을 덮지 않게). 받을 것이 없으면 저장하지 않는다 */
  const pullYear = async (prj, n, m, r, rec) => {
    if (!Object.values(m.localChanged).some(Boolean)) return false;
    local = await deps.loadLocal();
    const meta = metaOf(prj, local);
    const m2 = D().mergeYear(D().fromLocalYear(prj, n, local, meta), m.doc, now, who, { want, others: D().otherRecs(prj, local), localAt: D().localProjectAt(local, prj) });
    const back = D().toLocalYear(prj, n, local, m2, { src: `${rec.name}/${D().yearName(n)}` });
    let any = false;
    for (const part of ['budget', 'staff', 'research', 'changes', 'alias', 'support', 'project']) if (m2.localChanged[part]) { await deps.saveLocal(part, prj, back[part]); any = true; }
    if (any) { r.pulled = true; local = await deps.loadLocal(); }
    return any;
  };
  async function syncYear(prj, n, rec, r, curYear) {
    const name = D().yearName(n);
    const file = rec.fmap.has(name) ? (name in rec.pre ? rec.pre[name] : await store.readFile(rec.cfg, name, io)) : null;
    let remote = null, remoteAt0 = 0;
    if (file && file.text != null) {
      state.files++;
      const parsed = D().parse(file.text, { year: n });
      if (!parsed || parsed.kind !== 'year' || (parsed.doc.year.n && parsed.doc.year.n !== n)) { r.webUrl = r.webUrl || fileUrlOf(rec.cfg, name); throw fail('parse', PARSE_MSG(name)); }   // 있는 파일(깨진 것도)은 주소를 걸어 열어 볼 수 있게
      remote = parsed.doc;
      if (remote.project.prjNo && remote.project.prjNo !== prj) throw indexErr(remote.project.prjNo, name);
      remoteAt0 = Date.parse(remote.updatedAt) || 0;
      if (remoteAt0 >= r.remoteAt) { r.remoteAt = remoteAt0; r.remoteBy = remote.updatedBy || ''; }
      if (!names[prj] && remote.project.prjNm) r.title = remote.project.prjNm;
    }
    const tidy = !!(file && file.meta && file.meta.checkedOutByMe);   // 내가 남긴 체크아웃 — 내용이 같아도 modify 로 이어받아 체크인
    local = await deps.loadLocal();
    const meta = metaOf(prj, local);
    const optsOf = (l, extraAt) => ({ want, others: D().otherRecs(prj, l), localAt: Math.max(D().localProjectAt(l, prj), extraAt || 0) });
    let m = D().mergeYear(D().fromLocalYear(prj, n, local, meta), remote, now, who, optsOf(local));
    await pullYear(prj, n, m, r, rec);
    let seen = !!remote;
    if (!pullOnly.year && (m.remoteChanged || !remote || tidy)) {   // pullOnly.year 면 받기만 — 쓰지도 만들지도 않는다
      const w = await writerFor(rec);
      if (rec.created && !r.folderCreated) { r.folderCreated = true; state.created.push(prj); }
      let m2 = null, parseFail = false, foreign = '', wrote = false, sawFile = false, res = null;
      try {
        res = await w.modify(name, (cur) => {
          sawFile = cur != null;
          const p2 = cur == null ? null : D().parse(cur, { year: n });
          if (cur != null && (!p2 || p2.kind !== 'year')) { parseFail = true; return { changed: false, discard: true }; }   // 해석 안 되는 글(이어받은 초안이면 버림)
          const other = p2 ? str(p2.doc.project.prjNo) : '';
          if (other && other !== prj) { foreign = other; return { changed: false, discard: true }; }   // 체크아웃한 최신 글이 남의 과제 것 — 쓰지 않는다(아래에서 index 로 던져 다시 고름)
          m2 = D().mergeYear(m.doc, p2 ? p2.doc : null, now, who, optsOf(local, remoteAt0));   // 체크아웃한 최신 글로 다시 — 그 사이 동료가 쓴 것을 잃지 않게
          wrote = !p2 || m2.remoteChanged;
          return { changed: wrote, text: wrote ? D().serialize(m2.doc) : '' };
        }, { comment });
      } catch (e) {
        if (!(tidy && !m.remoteChanged && kindOf(e) === 'locked')) throw e;   // 체크인하러 갔는데 남이 잡고 있다 — 쓸 것이 없으니 조용히
      }
      if (foreign) throw indexErr(foreign, name);
      if (parseFail) throw fail('parse', PARSE_MSG(name));
      if (wrote || sawFile) { seen = true; rec.fmap.set(name, Object.assign({}, rec.fmap.get(name) || {}, { name, modified: new Date(now).toISOString(), version: (res && res.version) || '' })); }
      if (res && res.checkedIn && !wrote) r.checkedIn = true;
      if (m2) { if (Object.values(m2.localChanged).some(Boolean)) await pullYear(prj, n, m2, r, rec); m = m2; }
      if (wrote) { r.pushed = true; if (!remote) { r.created = true; state.files++; } state.written++; }
    }
    if (seen && (n === curYear || !r.webUrl)) r.webUrl = fileUrlOf(rec.cfg, name);
    const c = D().countOfYear(m.doc);
    for (const k of Object.keys(c)) r.counts[k] += c[k];
    r.years.push(n);
  }

  /* ---------- 예상 비용 파일 ---------- */
  const pullPlan = async (prj, m, r) => {
    if (!m.localChanged.plan) return false;
    local = await deps.loadLocal();
    const m2 = D().mergePlan(D().fromLocalPlan(prj, local, metaOf(prj, local)), m.doc, now, who, { want });
    if (!m2.localChanged.plan) return false;
    await deps.saveLocal('plan', prj, D().toLocalPlan(prj, local, m2).plan);
    r.pulled = true; local = await deps.loadLocal();
    return true;
  };
  async function syncPlan(prj, rec, r) {
    const name = D().PLAN_NAME;
    const file = rec.fmap.has(name) ? await store.readFile(rec.cfg, name, io) : null;
    let remote = null;
    if (file && file.text != null) {
      state.files++;
      const parsed = D().parse(file.text);
      if (!parsed || parsed.kind !== 'plan') { r.planUrl = fileUrlOf(rec.cfg, name); throw fail('parse', PARSE_MSG(name)); }
      remote = parsed.doc;
      if (remote.project.prjNo && remote.project.prjNo !== prj) { r.planUrl = fileUrlOf(rec.cfg, name); throw fail('parse', FOREIGN_MSG(name, remote.project.prjNo)); }   // 연차 파일은 이 과제 것인데 예상비용.json 만 남의 것 — 그 파일만 건너뜀
      const at = Date.parse(remote.updatedAt) || 0;
      if (at >= r.remoteAt) { r.remoteAt = at; r.remoteBy = remote.updatedBy || ''; }
    }
    const tidy = !!(file && file.meta && file.meta.checkedOutByMe);
    local = await deps.loadLocal();
    const L = D().fromLocalPlan(prj, local, metaOf(prj, local));
    if (!remote && !L.plan.items.length && !Object.keys(L.plan.del).length) return;   // 쓸 것이 없으면 만들지 않는다
    let m = D().mergePlan(L, remote, now, who, { want });
    await pullPlan(prj, m, r);
    let seen = !!remote;
    if (!pullOnly.plan && (m.remoteChanged || !remote || tidy)) {   // pullOnly.plan(KRS WORKSPACE)이면 예상비용.json 은 받기만 — 쓰지도 만들지도 않는다
      const w = await writerFor(rec);
      if (rec.created && !r.folderCreated) { r.folderCreated = true; state.created.push(prj); }
      let m2 = null, parseFail = false, foreign = '', wrote = false, sawFile = false, res = null;
      try {
        res = await w.modify(name, (cur) => {
          sawFile = cur != null;
          const p2 = cur == null ? null : D().parse(cur);
          if (cur != null && (!p2 || p2.kind !== 'plan')) { parseFail = true; return { changed: false, discard: true }; }
          const other = p2 ? str(p2.doc.project.prjNo) : '';
          if (other && other !== prj) { foreign = other; return { changed: false, discard: true }; }
          m2 = D().mergePlan(m.doc, p2 ? p2.doc : null, now, who, { want });
          wrote = !p2 || m2.remoteChanged;
          return { changed: wrote, text: wrote ? D().serialize(m2.doc) : '' };
        }, { comment });
      } catch (e) {
        if (!(tidy && !m.remoteChanged && kindOf(e) === 'locked')) throw e;
      }
      if (foreign) { r.planUrl = fileUrlOf(rec.cfg, name); throw fail('parse', FOREIGN_MSG(name, foreign)); }
      if (parseFail) throw fail('parse', PARSE_MSG(name));
      if (wrote || sawFile) { seen = true; rec.fmap.set(name, Object.assign({}, rec.fmap.get(name) || {}, { name, modified: new Date(now).toISOString(), version: (res && res.version) || '' })); }
      if (res && res.checkedIn && !wrote) r.checkedIn = true;
      if (m2) { if (m2.localChanged.plan) await pullPlan(prj, m2, r); m = m2; }
      if (wrote) { r.pushed = true; if (!remote) { r.created = true; state.files++; } state.written++; }
    }
    if (seen) r.planUrl = fileUrlOf(rec.cfg, name);
    r.counts.plan = D().countOfPlan(m.doc).plan;
  }

  /* ---------- 과제 하나 ---------- */
  async function syncProject(prj, rec, r) {
    r.folder = rec.name; r.owner = rec.owner; r.folderUrl = viewUrlOf(rec.cfg);
    if (rec.exists && !rec.fmap) {
      try { rec.fmap = new Map(((await store.listFiles(rec.cfg, io)) || []).map((f) => [str(f.name), f])); }
      catch (e) { if (kindOf(e) !== 'nofolder') throw e; if (!canCreate(rec)) throw staleErr(rec); rec.exists = false; rec.fmap = new Map(); }   // 내 base 의 폴더만 다시 만든다 — 동료 폴더가 없어졌으면 색인을 버리고 다시 고름
    }
    const fileYears = Array.from(rec.fmap.keys()).map((nm) => D().isYearName(nm)).filter(Boolean).sort((a, b) => a - b);
    if (rec.fromIndex && fileYears.length) {   // 색인으로 믿은 폴더 — 쓰기 전에 첫 연차 파일의 과제번호로 검증
      const name = D().yearName(fileYears[0]);
      const file = name in rec.pre ? rec.pre[name] : (rec.pre[name] = await store.readFile(rec.cfg, name, io));
      const parsed = file && file.text != null ? D().parse(file.text, { year: fileYears[0] }) : null;
      const pj = parsed && parsed.kind === 'year' ? parsed.doc.project : null;
      if (pj && pj.prjNo && pj.prjNo !== prj) throw indexErr(pj.prjNo, name);
      rec.fromIndex = false;
    }
    local = await deps.loadLocal();
    const cur = int(projectOf(local, prj).anl);
    const years = new Set(D().localYears(prj, local).concat(fileYears));
    if (cur) years.add(cur);
    if (!years.size) years.add(1);
    const list = Array.from(years).sort((a, b) => a - b);
    const curYear = cur || list[list.length - 1];
    for (const n of list) {
      try { await syncYear(prj, n, rec, r, curYear); }
      catch (e) { if (kindOf(e) === 'index' || fatalFor(e, rec)) throw e; noteError(r, e); }
    }
    if (want.plan) { try { await syncPlan(prj, rec, r); } catch (e) { if (fatalFor(e, rec)) throw e; noteError(r, e); } }
    r.count = r.counts.plan;
    if (r.pulled) state.pulled++;
  }

  try {
    for (const prj of targets) {
      const r = newPage(prj);
      state.pages[prj] = r;
      let rec = null;
      try {
        local = await deps.loadLocal();
        const hasLocal = D().localPrjNos(local).includes(prj);
        rec = resolveFolder(prj, local, hasLocal);
        if (!rec) { r.noFolder = true; r.kind = 'nofolder'; continue; }   // 참여자 — 책임자가 폴더를 만들어 공유할 때까지(오류 아님)
        try { await syncProject(prj, rec, r); }
        catch (e) {
          const k = kindOf(e);
          if (!(k === 'index' || (k === 'nofolder' && e.stale))) throw e;
          if (k === 'index') {
            // 색인이 틀림(폴더의 파일은 다른 과제의 것) — 그 폴더는 실제 과제에 돌리고 이 과제는 다시 고른다
            delete folderOf[prj];
            if (e.actual && !folderOf[e.actual]) folderOf[e.actual] = rec;
          } else if (rec.alt) folderOf[prj] = rec.alt;   // 동료 폴더가 없어짐(지움·이름 바꿈) — 밀어냈던 내 base 폴더로, 없으면 다시 고른다(색인은 버려짐)
          else delete folderOf[prj];
          rec = resolveFolder(prj, local, hasLocal);
          if (!rec) { r.noFolder = true; r.kind = 'nofolder'; continue; }
          Object.assign(r, newPage(prj));
          await syncProject(prj, rec, r);
        }
      } catch (e) {
        noteError(r, e);
        if (fatalFor(e, rec)) break;
      }
    }
  } finally {
    for (const s of sites.values()) { try { await s.writer.close(); } catch (e) { /* 이미 닫힘 */ } }
    for (const w of extras.values()) { try { await w.close(); } catch (e) { /* 이미 닫힘 */ } }
  }
  // 색인 — 이번에 알아본 폴더(검증 전 색인 항목은 뺀다). only 면 다른 과제의 옛 항목은 그대로
  for (const [prj, rec] of Object.entries(folderOf)) {
    if (!rec.exists || rec.fromIndex) continue;
    state.index[prj] = { base: rec.base, folder: rec.name, site: rec.site, path: str(rec.cfg.folderPath), url: folderUrlOf(rec.cfg), owner: rec.owner, at: now };
  }
  for (const [prj, e] of Object.entries(index0)) if (!state.index[prj] && obj(e) && (only ? prj !== only : folderOf[prj] && folderOf[prj].fromIndex)) state.index[prj] = e;
  return finish();
};

export default api;
