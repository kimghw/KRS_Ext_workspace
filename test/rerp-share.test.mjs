// kr_ext_rerp 의 공유 (Plus) v2 검사 넷 — tests/sp-store.test.js(SharePoint 저장소 · 가짜 fetch·chrome) · tests/prjdoc.test.js(문서 모양·병합) · tests/prjdoc-sync.test.js(과제별 차례 · 가짜 store) · tests/staff-sync.test.js(사업비 병합)를
// ESM 으로 옮겨 한 파일에 둔 것(파일마다 블록으로 감싸 이름이 겹치지 않게, 차례대로 await) + 끝에 rerp/sharesync.js(createShareSync 배선) 검사. 머리의 require·전역 별칭·n/failed/test 선언과 꼬리의 passed 출력만 뗐고 본문은 원본 그대로다.
// 실 SharePoint 에는 닿지 않는다(가짜 fetch · 가짜 chrome · 메모리 폴더 트리) — 쿠키·다이제스트 값도 가짜. 복사본이 원본과 어긋났는지는 `node tools/rerp.mjs check`. 실행: node test/rerp-share.test.mjs (npm test 에 듦)
import assert from 'node:assert';
import SP from '../rerp/spstore.js';
import PRJDOC from '../rerp/prjdoc.js';
import PRJDOC_SYNC from '../rerp/prjdocsync.js';
import STAFF from '../rerp/staff.js';
import STAFF_SYNC from '../rerp/staffsync.js';
import { createShareSync, SHARE_DEFAULTS } from '../rerp/sharesync.js';
globalThis.self = globalThis;   // 원본 검사가 두는 전역(옮긴 모듈은 쓰지 않지만 가짜 chrome 등이 기댈 수 있음)
let n = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.stack || e.message); process.exitCode = 1; } };

/* ---------- sp-store — kr_ext_rerp tests/sp-store.test.js 그대로 ---------- */
/* lib/sp-store.js (확장 Plus — SharePoint(OneDrive) 폴더 저장소, 0.8.7) 테스트: parseFolder 네 모양(폴더 주소 · onedrive.aspx?id= · AllItems.aspx?id= · 퍼센트 인코딩)과 badurl, 한글 폴더·파일 이름 왕복, folderUrl('#' 왕복),
 * resolveMyFolder(webUrl → /RERP · PersonalUrl 대체 · auth · offline), resolveFolder 의 공유 링크 redirect 풀기, listFiles 모양·nofolder(404 · Exists:false), readFile 200/404/로그인 redirect→auth · checkedOut/checkedOutByMe,
 * writer.modify 네 경로(없으면 생성 / 바뀌면 체크아웃·PUT·체크인 / 안 바뀌면 UndoCheckOut / 남이 잡으면 locked) + 동료가 먼저 만든 경쟁, 끊긴 체크아웃 이어받기(안 바뀌어도 CheckIn · discard 면 UndoCheckOut · 체크인 실패 뒤 다음 쓰기가 체크인),
 * "체크아웃 필수" 문서함(Files/add 뒤 CheckIn), 다이제스트 만료(403 security validation → 다시 받아 한 번 더 · TTL 지나면 미리 다시), ensureFolder, close 가 창을 닫는지, sweepWorkers 가 남은 작업 창만 닫는지,
 * v2 폴더 트리(2026-10-18 저녁 "업무/shared 안에 과제별로 … 참여연구원들에게 공유"): listFolders(모양 · Forms 제외 · Exists 규칙) · childCfg · writer.ensurePath(여러 단 — 문서함 뿌리 위로는 안 올라감) · sharedWithMe(nextLink 2쪽 · 폴더/파일 · cfg 는 폴더 주소가 풀릴 때만) ·
 * writer.sharePeople(피커 — 표시 이름이 꼭 같은 1명만, 1명이어도 이름이 다르면 ambiguous, 여럿/0명 · ShareObject 호출 모양 — odata=verbose · roleValue · peoplePickerInput JSON 문자열 · StatusCode≠0 → 한 명씩) · writer.orgLink(ShareLink → 실패 시 CreateOrganizationSharingLink) · writer.rename(MoveTo → MoveToUsingPath) ·
 * writer.at(같은 사이트의 다른 폴더 — 같은 작업 창·다이제스트, close 는 no-op, 사이트 밖은 badurl),
 * 쿠키·다이제스트·피커 Key 값이 결과에 없는지, 페이지 함수가 바깥 변수를 쓰지 않는지. 가짜 fetch(메모리 폴더·파일(체크인 글 text · 체크아웃 초안 draft) · 요청 기록 · 다이제스트 검사 · 피커/공유/링크 끝점)·가짜 chrome(executeScript 는 func 를 실제로 호출해 가짜 fetch 위에서 돌림)만 쓴다 — 실 SharePoint 에 쓰지 않는다.
 * 실행: node tests/sp-store.test.js */
{
  const rejects = async (p, kind, re) => { try { await p; } catch (e) { assert.strictEqual(e.kind, kind, `kind ${e.kind} ≠ ${kind}: ${e.message}`); if (re) assert.ok(re.test(e.message), `메시지 "${e.message}" 가 ${re} 에 안 맞음`); return e; } throw new Error(`오류(${kind})가 나야 하는데 성공함`); };
  const throws = (fn, kind, re) => { try { fn(); } catch (e) { assert.strictEqual(e.kind, kind, `kind ${e.kind} ≠ ${kind}: ${e.message}`); if (re) assert.ok(re.test(e.message), `메시지 "${e.message}" 가 ${re} 에 안 맞음`); return e; } throw new Error(`오류(${kind})가 나야 하는데 성공함`); };

  const ORIGIN = 'https://krclass-my.sharepoint.com';
  const ME_PATH = '/personal/kimghw_krs_co_kr/Documents';
  const RERP = `${ME_PATH}/RERP`;              // 시험용 폴더(이름은 아무것이어도 됨 — v1 때의 이름을 그대로 둠)
  const BASE = `${ME_PATH}/업무/shared`;       // 설정 folder 가 비었을 때의 기본 밑폴더(DEFAULT_FOLDER_NAME, 두 단) — background.js SHARE_BASE_NAME 과 같음
  const ME = 7;
  const COOKIE = 'FedAuth=SECRET-COOKIE-VALUE-77';
  const DIGEST = '0xDIGEST-SECRET-ABC,18 Oct 2026 00:00:00 -0000';

  /* 가짜 SharePoint: 메모리 폴더·파일 + REST 끝점. o = { folders:[경로], files:{ 경로:{ 이름: 내용 } }, loggedIn, drive(404 면 v2.0 drive 없음), deny403, failPut, failCheckIn(한 번 500), shareDest, raceCreate,
   *   checkedOutBy:{ 이름: 사용자 Id }, drafts:{ 이름: 초안 }(내가 잡은 체크아웃에 올라가 있던 글), requireCheckout("체크아웃 필수" 문서함 — Files/add 가 파일을 내 체크아웃·판 0 으로 둠),
   *   people:{ 검색어: [피커 항목] }(clientPeoplePickerSearchUser), shareFailEmails:[이메일](그 사람이 든 ShareObject 는 StatusCode 1), shareHttp(ShareObject 가 늘 이 HTTP 상태), noShareLink(ShareLink 400), noOrgLink(CreateOrganizationSharingLink 400),
   *   noMoveTo(MoveTo 404 → MoveToUsingPath 로), shared:[{ value:[항목] } …](sharedWithMe 쪽들 — $skiptoken 으로 다음 쪽), noShared(sharedWithMe 404),
   *   perms:{ 폴더 경로: [{ id, type(1 사용자 · 8 그룹), title, email, login, roles:[{ id, name, kind, hidden }] }] }(권한 — permissions · unshare; ShareObject 가 성공하면 그 폴더에 사람을 더함), search:{ 질문: [{ title, email, login }] }(search REST People 줄), searchVerbose(verbose 모양으로 답함) }
   * 파일 = { text(체크인된 글), draft(체크아웃 중 PUT 한 글 — 주인에게만 $value 로 보임), version(0 = 체크인된 판 없음 — UndoCheckOut 이 파일을 지움), checkedOutBy }
   * 다이제스트: contextinfo 마다 새 값을 내고(st.validDigests), F.expire() 뒤 옛 값으로 쓰면 403 + "security validation" 본문(실 SharePoint 의 -2130575251). st.calls = [메서드, 짧은 경로(폴더/파일은 디코딩한 서버 상대 경로)]
   * st.pickerBodies · st.shareBodies · st.linkBodies = [{ headers, body }](받은 요청 그대로 — 호출 모양 검사용), st.shares = [{ url, roleValue, emails }](성공한 공유), st.unshares = [[폴더, principalId, roleId]](거둔 역할), st.searchUrls(사람 찾기 요청 주소) */
  function fakeSp(o) {
    o = o || {};
    const st = { folders: {}, calls: [], digestIssued: 0, validDigests: new Set(), cookie: COOKIE, loggedIn: o.loggedIn !== false, pickerBodies: [], shareBodies: [], linkBodies: [], shares: [], unshares: [], searchUrls: [], perms: JSON.parse(JSON.stringify(o.perms || {})), nextPrincipal: 5000 };
    const LIST_ID = 'aaaabbbb-0000-0000-0000-000000000001', ITEM_ID = 42;
    let seq = 0;
    const mkFile = (text) => ({ text, draft: null, version: 1, checkedOutBy: null, uniqueId: `${String(++seq).padStart(8, '0')}-0000-0000-0000-00000000ABCD`, modified: '2026-10-18T01:02:03Z' });
    const addFolder = (p) => { st.folders[p] = st.folders[p] || { files: {} }; return st.folders[p]; };
    for (const p of o.folders || []) addFolder(p);
    for (const [p, files] of Object.entries(o.files || {})) for (const [name, text] of Object.entries(files)) addFolder(p).files[name] = mkFile(text);
    for (const [name, who] of Object.entries(o.checkedOutBy || {})) for (const f of Object.values(st.folders)) if (f.files[name]) f.files[name].checkedOutBy = who;
    for (const [name, draft] of Object.entries(o.drafts || {})) for (const f of Object.values(st.folders)) if (f.files[name]) f.files[name].draft = draft;
    const json = (obj, status, url) => ({ ok: (status || 200) >= 200 && (status || 200) < 300, status: status || 200, url: url || '', json: async () => obj, text: async () => JSON.stringify(obj) });
    const text = (s, status) => ({ ok: (status || 200) >= 200 && (status || 200) < 300, status: status || 200, url: '', json: async () => { throw new Error('not json'); }, text: async () => s });
    const login = () => ({ ok: true, status: 200, url: 'https://login.microsoftonline.com/common/oauth2/authorize?x=1', json: async () => ({}), text: async () => '<html>login</html>' });
    const dec = (lit) => decodeURIComponent(lit).replace(/''/g, "'");
    const LIT = "([^']*(?:''[^']*)*)";
    const fetch = async (url, init) => {
      init = init || {};
      const m = String(init.method || 'GET').toUpperCase();
      const u = String(url);
      const H = init.headers || {};
      assert.strictEqual(init.credentials, 'include', `쿠키로 요청해야: ${m} ${u}`);
      if (!st.loggedIn) { st.calls.push([m, 'login-redirect']); return login(); }
      if (/^https:\/\/[^/]+\/:[a-z]:\//.test(u)) {   // 공유 링크 → redirect 끝 주소
        st.calls.push([m, 'share', init.redirect]);
        if (o.shareDest === 'login') return login();
        return json({}, 200, o.shareDest || `${ORIGIN}/personal/kimghw_krs_co_kr/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fkimghw%5Fkrs%5Fco%5Fkr%2FDocuments%2FRERP&view=0`);
      }
      if (u === `${ORIGIN}/_api/v2.0/me/drive`) { st.calls.push([m, 'me/drive']); if (o.deny403) return json({}, 403); return o.drive === 404 ? json({ error: 'nope' }, 404) : json({ id: 'b!xyz', webUrl: `${ORIGIN}${ME_PATH}` }); }
      if (u.startsWith(`${ORIGIN}/_api/SP.UserProfiles.PeopleManager/GetMyProperties`)) { st.calls.push([m, 'GetMyProperties']); return json({ PersonalUrl: `${ORIGIN}/personal/kimghw_krs_co_kr/` }); }
      const am = /^(https:\/\/[^/]+)((?:\/(?:sites|teams|personal)\/[^/]+)?)\/_api\/(.*)$/.exec(u);
      if (!am) { st.calls.push([m, u]); return text('nope', 404); }
      const rest = am[3];
      if (rest.startsWith('v2.0/me/drive/sharedWithMe')) {   // "나와 공유" — 쪽은 $skiptoken=<쪽 번호>
        const idx = Number(new URL(u).searchParams.get('$skiptoken') || 0);
        st.calls.push([m, `sharedWithMe#${idx}`]);
        if (o.deny403) return json({}, 403);
        if (o.noShared) return json({ error: 'nope' }, 404);
        const pages = o.shared || [{ value: [] }];
        const page = pages[idx] || { value: [] };
        const r = { value: page.value };
        if (idx + 1 < pages.length) r['@odata.nextLink'] = `${ORIGIN}/_api/v2.0/me/drive/sharedWithMe?$skiptoken=${idx + 1}`;
        return json(r);
      }
      if (rest === 'contextinfo') {
        st.calls.push([m, 'contextinfo']); if (o.deny403) return json({}, 403); if (m !== 'POST') return json({}, 405);
        const d = `${DIGEST}#${++st.digestIssued}`; st.validDigests.add(d);
        return json({ FormDigestValue: d, FormDigestTimeoutSeconds: o.digestSec || 1800 });
      }
      if (rest.startsWith('web/currentuser')) { st.calls.push([m, 'currentuser']); return json({ Id: ME }); }
      if (rest.startsWith('search/query?')) {   // 사람 찾기(findPeople) — People 결과 원본, querytext 리터럴로 질문
        const qm = /querytext='([^']*)'/.exec(rest); const q = qm ? dec(qm[1]) : '';
        st.calls.push([m, `search(${q})`]); st.searchUrls.push(u);
        if (o.deny403) return json({}, 403);
        const rows = ((o.search || {})[q] || []).map((x) => ({ Cells: [{ Key: 'PreferredName', Value: x.title }, { Key: 'WorkEmail', Value: x.email || null }, { Key: 'AccountName', Value: x.login || (x.email ? `i:0#.f|membership|${x.email}` : '') }, { Key: 'Rank', Value: '1' }] }));
        if (o.searchVerbose) return json({ d: { query: { PrimaryQueryResult: { RelevantResults: { Table: { Rows: { results: rows.map((r) => ({ Cells: { results: r.Cells } })) } } } } } } });
        return json({ PrimaryQueryResult: { RelevantResults: { Table: { Rows: rows } } } });
      }
      const digestOk = st.validDigests.has(H['X-RequestDigest']);
      // 다이제스트가 없거나 틀리면 403. 우리가 냈던 값(만료)이면 실 SharePoint 처럼 "security validation" 본문
      const deny = () => (H['X-RequestDigest'] && String(H['X-RequestDigest']).startsWith(DIGEST) && !digestOk
        ? json({ 'odata.error': { code: '-2130575251, Microsoft.SharePoint.SPException', message: { lang: 'en-US', value: "The security validation for this page is invalid and might be corrupted. Please use your web browser's Back button to try your operation again." } } }, 403)
        : json({}, 403));
      const body = () => { try { return JSON.parse(init.body); } catch (e) { return null; } };
      const verbose = /odata=verbose/.test(String(H.Accept || ''));
      const children = (p) => Object.keys(st.folders).filter((k) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes('/'));
      const moveFolder = (p, to) => { for (const k of Object.keys(st.folders)) if (k === p || k.startsWith(`${p}/`)) { st.folders[`${to}${k.slice(p.length)}`] = st.folders[k]; delete st.folders[k]; } };
      // 사람 찾기 · 공유 · 조직 내 링크(사이트 _api 바로 아래)
      if (rest === 'SP.UI.ApplicationPages.ClientPeoplePickerWebServiceInterface.clientPeoplePickerSearchUser') {
        st.calls.push([m, 'peoplePicker']);
        if (m !== 'POST' || !digestOk) return deny();
        const b = body(); st.pickerBodies.push({ headers: H, body: b });
        const q = b && b.queryParams && b.queryParams.QueryString;
        const entries = (o.people || {})[q] || [];
        return verbose ? json({ d: { ClientPeoplePickerSearchUser: JSON.stringify(entries) } }) : json({ value: JSON.stringify(entries) });
      }
      if (rest === 'SP.Web.ShareObject') {
        st.calls.push([m, 'ShareObject']);
        if (m !== 'POST' || !digestOk) return deny();
        const b = body(); st.shareBodies.push({ headers: H, body: b });
        let entries = []; try { entries = JSON.parse(b.peoplePickerInput); } catch (e) { return json({ 'odata.error': { message: { value: 'peoplePickerInput 이 JSON 문자열이 아님' } } }, 400); }
        const emails = entries.map((e) => e.EntityData && e.EntityData.Email);
        if (o.shareHttp) return json({ 'odata.error': { message: { value: 'ShareObject boom' } } }, o.shareHttp);
        const bad = emails.filter((e) => (o.shareFailEmails || []).includes(e));
        const wrap = (r) => (verbose ? json({ d: { ShareObject: r } }) : json(r));
        if (bad.length) return wrap({ StatusCode: 1, ErrorMessage: `초대할 수 없는 사용자: ${bad.join(', ')}`, InvitedUsers: null, UniquelyPermissionedUsers: { results: [] } });
        st.shares.push({ url: b.url, roleValue: b.roleValue, emails });
        // 폴더의 권한에도 남긴다(permissions 가 보게) — 같은 사람이면 역할을 더함
        const fp = decodeURIComponent(new URL(b.url).pathname);
        if (st.folders[fp]) {
          const role = b.roleValue === 'role:1073741826' ? { id: 1073741826, name: '읽기', kind: 2 } : { id: 1073741827, name: '참가', kind: 3 };
          const list = st.perms[fp] = st.perms[fp] || [];
          for (const e of entries) { const email = e.EntityData && e.EntityData.Email; let who = list.find((y) => y.email === email); if (!who) { who = { id: ++st.nextPrincipal, type: 1, title: e.DisplayText, email, roles: [] }; list.push(who); } if (!who.roles.some((r) => r.id === role.id)) who.roles.push(Object.assign({}, role)); }
        }
        return wrap({ StatusCode: 0, ErrorMessage: null, InvitedUsers: null, UniquelyPermissionedUsers: { results: emails.map((Email) => ({ Email, DisplayName: '', User: 'i:0#.f|membership|KEY-SECRET-x' })) } });
      }
      if (rest === 'SP.Web.CreateOrganizationSharingLink') {
        st.calls.push([m, 'CreateOrganizationSharingLink']);
        if (m !== 'POST' || !digestOk) return deny();
        const b = body(); st.linkBodies.push({ headers: H, body: b, at: 'CreateOrganizationSharingLink' });
        if (o.noOrgLink) return json({ 'odata.error': { message: { value: 'Sharing links are disabled by policy' } } }, 400);
        return json({ value: `${ORIGIN}/:f:/g/personal/kimghw_krs_co_kr/EFallback?e=${b && b.isEditLink ? 'edit' : 'view'}` });
      }
      let lm = /^web\/Lists\(guid'([^']+)'\)\/GetItemById\((\d+)\)\/ShareLink$/.exec(rest);
      if (lm) {
        st.calls.push([m, `ShareLink(${lm[1]},${lm[2]})`]);
        if (m !== 'POST' || !digestOk) return deny();
        const b = body(); st.linkBodies.push({ headers: H, body: b, at: 'ShareLink' });
        if (lm[1] !== LIST_ID || Number(lm[2]) !== ITEM_ID) return json({ 'odata.error': { message: { value: 'Item does not exist' } } }, 404);
        if (o.noShareLink) return json({ 'odata.error': { message: { value: 'ShareLink not supported here' } } }, 400);
        const kind = b && b.request && b.request.settings && b.request.settings.linkKind;
        return json({ sharingLinkInfo: { Url: `${ORIGIN}/:f:/g/personal/kimghw_krs_co_kr/EOrgLink${kind}?e=abc`, IsEditLink: kind === 3, LinkKind: kind } });
      }
      let fm = new RegExp(`^web/GetFolderByServerRelativePath\\(decodedurl='${LIT}'\\)(.*)$`).exec(rest);
      if (fm) {
        const p = dec(fm[1]), tail = fm[2];
        st.calls.push([m, `folder(${p})${tail}`]);
        const f = st.folders[p];
        if (tail.startsWith('?$select=Exists')) return json({ Exists: !!f, Name: p.slice(p.lastIndexOf('/') + 1) });   // 없는 폴더에도 200 + Exists:false (실측 2026-10-18)
        if (tail.startsWith('/Files?')) { if (!f) return json({}, 404); return json({ value: Object.entries(f.files).filter(([, x]) => x.version > 0 || x.checkedOutBy === ME).map(([Name, x]) => ({ Name, Length: String(x.text.length), TimeLastModified: x.modified, UIVersionLabel: `${x.version}.0`, UniqueId: x.uniqueId })) }); }
        if (tail.startsWith('/Folders?')) { if (!f) return json({}, 404); return json({ value: children(p).map((k) => ({ Name: k.slice(p.length + 1), ServerRelativeUrl: k, ItemCount: Object.keys(st.folders[k].files).length + children(k).length, TimeLastModified: '2026-10-18T03:04:05Z' })) }); }
        if (tail.startsWith('/ListItemAllFields?') && /RoleAssignments/.test(tail)) {   // 권한(permissions) — RoleAssignments(Member · RoleDefinitionBindings) 펼침
          if (!f) return json({ 'odata.error': { message: { value: 'File Not Found.' } } }, 404);
          if (o.deny403) return json({}, 403);
          const list = st.perms[p] || [];
          return json({ Id: ITEM_ID, HasUniqueRoleAssignments: list.length > 0, RoleAssignments: list.map((y) => ({ PrincipalId: y.id, Member: { Id: y.id, Title: y.title, Email: y.email || '', LoginName: y.login || (y.email ? `i:0#.f|membership|${y.email}` : y.title), PrincipalType: y.type || 1 }, RoleDefinitionBindings: y.roles.map((r) => ({ Id: r.id, Name: r.name || '', RoleTypeKind: r.kind, Hidden: !!r.hidden })) })) });
        }
        if (tail.startsWith('/ListItemAllFields?')) { if (!f) return json({ 'odata.error': { message: { value: 'File Not Found.' } } }, 404); return json({ Id: ITEM_ID, ParentList: { Id: LIST_ID } }); }
        let x;
        if ((x = /^\/ListItemAllFields\/RoleAssignments\/GetByPrincipalId\((\d+)\)\/RoleDefinitionBindings\?/.exec(tail))) {   // unshare 1단계 — 그 사람의 역할
          const who = (st.perms[p] || []).find((y) => y.id === Number(x[1]));
          if (!f || !who) return json({ 'odata.error': { message: { value: 'Item does not exist' } } }, 404);
          return json({ value: who.roles.map((r) => ({ Id: r.id, RoleTypeKind: r.kind, Hidden: !!r.hidden })) });
        }
        if ((x = /^\/ListItemAllFields\/RoleAssignments\/RemoveRoleAssignment\(principalid=(\d+),roledefid=(\d+)\)$/.exec(tail))) {   // unshare 2단계 — 역할 하나 거두기(다이제스트)
          if (m !== 'POST' || !digestOk) return deny();
          const list = st.perms[p] || []; const who = list.find((y) => y.id === Number(x[1]));
          if (!f || !who || !who.roles.some((r) => r.id === Number(x[2]))) return json({ 'odata.error': { message: { value: 'Item does not exist' } } }, 404);
          who.roles = who.roles.filter((r) => r.id !== Number(x[2])); if (!who.roles.length) list.splice(list.indexOf(who), 1);
          st.unshares.push([p, Number(x[1]), Number(x[2])]);
          return json({}, 200);
        }
        if ((x = new RegExp(`^/MoveTo\\(newUrl='${LIT}'\\)$`).exec(tail))) { if (m !== 'POST' || !digestOk) return deny(); if (!f) return json({}, 404); if (o.noMoveTo) return json({ 'odata.error': { message: { value: 'MoveTo 없음' } } }, 404); moveFolder(p, dec(x[1])); return json({}, 200); }
        if ((x = new RegExp(`^/MoveToUsingPath\\(DecodedUrl='${LIT}'\\)$`).exec(tail))) { if (m !== 'POST' || !digestOk) return deny(); if (!f) return json({}, 404); moveFolder(p, dec(x[1])); return json({}, 200); }
        if ((x = new RegExp(`^/Folders/add\\('${LIT}'\\)$`).exec(tail))) { if (m !== 'POST' || !digestOk) return deny(); if (!f) return json({}, 404); const name = dec(x[1]); addFolder(`${p}/${name}`); return json({ Name: name, Exists: true }); }
        if ((x = new RegExp(`^/Files/add\\(url='${LIT}',overwrite=(true|false)\\)$`).exec(tail))) {
          if (m !== 'POST' || !digestOk) return deny();
          if (!f) return json({}, 404);
          const name = dec(x[1]);
          if (o.raceCreate && !f.files[name]) { f.files[name] = mkFile(o.raceCreate); return json({ 'odata.error': { message: { value: 'exists' } } }, 400); }   // 그사이 동료가 만듦
          if (f.files[name] && x[2] !== 'true') return json({ 'odata.error': { message: { value: 'A file with the name already exists' } } }, 400);
          const nf = f.files[name] = mkFile(String(init.body));
          if (o.requireCheckout) { nf.draft = nf.text; nf.text = ''; nf.version = 0; nf.checkedOutBy = ME; }   // "체크아웃 필수" 문서함: 새 파일은 내 체크아웃 상태(판 0.1) — 남에게 안 보임
          return json({ Name: name, UniqueId: nf.uniqueId, UIVersionLabel: o.requireCheckout ? '0.1' : '1.0', CheckOutType: o.requireCheckout ? 0 : 2, Length: String((nf.draft || nf.text).length), TimeLastModified: nf.modified });
        }
        return text('nope', 404);
      }
      fm = new RegExp(`^web/GetFileByServerRelativePath\\(decodedurl='${LIT}'\\)(.*)$`).exec(rest);
      if (fm) {
        const full = dec(fm[1]), tail = fm[2];
        const i = full.lastIndexOf('/'); const p = full.slice(0, i), name = full.slice(i + 1);
        st.calls.push([m, `file(${full})${tail}`]);
        const f = st.folders[p]; const file = f && f.files[name];
        if (!file) return json({ 'odata.error': { message: { value: 'File Not Found.' } } }, 404);
        const meta = () => ({ Exists: true, CheckOutType: file.checkedOutBy == null ? 2 : 0, UniqueId: file.uniqueId, UIVersionLabel: `${file.version}.0`, Length: String(file.text.length), TimeLastModified: file.modified });
        if (tail.startsWith('?$select')) return json(meta());
        if (tail.startsWith('/CheckedOutByUser')) return json({ Id: file.checkedOutBy, Email: 'other@krs.co.kr', Title: '다른 사람' });
        if (tail === '/CheckOut()') { if (m !== 'POST' || !digestOk) return deny(); if (file.checkedOutBy != null && file.checkedOutBy !== ME) return json({}, 423); file.checkedOutBy = ME; return json({}, 200); }
        if (tail === '/UndoCheckOut()') { if (m !== 'POST' || !digestOk) return deny(); file.checkedOutBy = null; file.draft = null; if (file.version === 0) delete f.files[name]; return json({}, 200); }   // 체크인된 판이 없는 파일은 되돌리면 사라진다
        if (tail.startsWith('/CheckIn(')) {
          if (m !== 'POST' || !digestOk) return deny();
          if (o.failCheckIn) { o.failCheckIn = false; return json({}, 500); }
          const cm = /comment='(.*)',checkintype=1\)$/.exec(tail); file.lastComment = dec(cm[1]);
          if (file.draft != null) file.text = file.draft; file.draft = null; file.checkedOutBy = null; file.version++; file.modified = '2026-10-18T02:00:00Z'; return json({}, 200);
        }
        if (tail === '/recycle()') { if (m !== 'POST' || !digestOk) return deny(); delete f.files[name]; return json('recycle-guid'); }
        if (tail === '/$value') {
          if (m === 'GET') return text(file.checkedOutBy === ME && file.draft != null ? file.draft : file.text);   // 주인에게는 초안, 남에게는 지난 판
          if (m === 'PUT') { if (!digestOk) return deny(); if (o.failPut) return json({}, 500); if (file.checkedOutBy !== ME) return json({}, 423); file.draft = String(init.body); return { ok: true, status: 204, url: '', json: async () => null, text: async () => '' }; }
        }
        return text('nope', 404);
      }
      st.calls.push([m, rest]);
      return text('nope', 404);
    };
    return { st, fetch, file: (p, name) => st.folders[p] && st.folders[p].files[name], expire: () => st.validDigests.clear() };
  }

  /* 가짜 chrome: windows.create 로 창·탭 하나, executeScript 는 func 를 이 프로세스에서 globalThis.fetch 를 가짜로 바꿔 실행. o = { landing(탭이 멈춘 주소), failOpen, noTabs }
   *   tabs.query 는 windowId 와 url(매치 패턴 — * 만 받음) 로 고른다. addWindow(urls) 로 미리 열린 창을 흉내 낸다(sweepWorkers) */
  function fakeChrome(fetch, o) {
    o = o || {};
    const log = [];
    const windows = {};
    let nextId = 10;
    const allTabs = () => Object.values(windows).flatMap((w) => w.tabs);
    const matches = (pattern, url) => new RegExp(`^${String(pattern).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(String(url || ''));
    const c = {
      log, windows_: windows,
      windows: {
        create: async (opts) => {
          if (o.failOpen) throw new Error('창 없음');
          const id = ++nextId; const tab = { id: ++nextId, windowId: id, url: o.landing || opts.url, status: 'complete' };
          windows[id] = { tabs: [tab] };
          log.push(['create', opts.state, opts.focused, opts.url]);
          return { id, tabs: o.noTabs ? undefined : [tab] };
        },
        remove: async (id) => { log.push(['windows.remove', id]); delete windows[id]; }
      },
      tabs: {
        get: async (id) => { const t = allTabs().find((x) => x.id === id); if (!t) throw new Error('No tab with id'); return t; },
        query: async (q) => allTabs().filter((t) => (q.windowId == null || t.windowId === q.windowId) && (q.url == null || matches(q.url, t.url))),
        update: async (id, p) => { log.push(['update', id, JSON.stringify(p)]); },
        remove: async (id) => { log.push(['tabs.remove', id]); for (const w of Object.values(windows)) w.tabs = w.tabs.filter((t) => t.id !== id); }
      },
      addWindow: (urls) => { const id = ++nextId; windows[id] = { tabs: urls.map((url) => ({ id: ++nextId, windowId: id, url, status: 'complete' })) }; return { id, tabIds: windows[id].tabs.map((t) => t.id) }; },
      scripting: {
        executeScript: async ({ target, world, func, args }) => {
          log.push(['run', func.name, world, target.frameIds.join()]);
          const orig = globalThis.fetch; globalThis.fetch = fetch;
          try { return [{ result: await func(...(args || [])) }]; } finally { globalThis.fetch = orig; }
        }
      },
      addTab: (windowId) => { windows[windowId].tabs.push({ id: ++nextId, windowId, url: 'https://other.example/', status: 'complete' }); }
    };
    return c;
  }
  const calls = (F, from) => F.st.calls.slice(from || 0).map((c) => c.join(' '));
  const CFG = SP.parseFolder(`${ORIGIN}${RERP}`);
  /* 피커 항목(clientPeoplePickerSearchUser 가 주는 모양). Key 는 로그인 이름 — 결과·기록에 새면 안 되는 값이라 KEY-SECRET 표식을 넣는다 */
  const person = (name, email) => ({ Key: `i:0#.f|membership|KEY-SECRET-${email}`, DisplayText: name, EntityType: 'User', IsResolved: true, Description: email, EntityData: { Email: email, Title: '연구원', Department: 'R&D', PrincipalType: 'User' } });
  const PEOPLE = {
    '문창재': [person('문창재', 'moon@krs.co.kr')],                                                    // 1명
    '김철수': [person('김철수', 'kim1@krs.co.kr'), person('김철수(해양)', 'kim2@krs.co.kr')],            // 여럿 — 표시 이름이 꼭 같은 1명
    '이영희': [person('이영희 (연구)', 'lee1@krs.co.kr'), person('이영희 (기획)', 'lee2@krs.co.kr')],   // 여럿 — 꼭 같은 이름 없음 → ambiguous
    '박보람': [person('박보람', 'park1@krs.co.kr'), person('박보람', 'park2@krs.co.kr')],              // 동명이인 → ambiguous
    '이영': [person('이영희', 'lee1@krs.co.kr')],                                                       // 1명이지만 이름이 다름(접두 일치 — 디렉터리에 없는 이름) → ambiguous
    '홍길동': [person('홍 길동', 'hong@krs.co.kr')],                                                    // 공백만 다름 → 같은 이름으로 봄
    '없는사람': [],
    'moon@krs.co.kr': [person('MOON Changjae', 'moon@krs.co.kr')],                                      // 이메일로 물음(2026-10-19) — 표시 이름이 영문이라도 이메일이 같은 1명
    'kim@krs.co.kr': [person('김철수', 'kim1@krs.co.kr')]                                               // 이메일로 물었는데 이메일이 다른 1명 → ambiguous
  };
  /* 권한(permissions · unshare)의 가짜 폴더 — 실측(2026-10-19) 모양: 제한된 액세스 시스템 그룹 · 사람(참가 3 / 읽기 2 / 모든 권한 5 / 편집 6) · 제한된 액세스만 있는 사람 · 조직 내 링크 그룹 · 나(ME) */
  const PERM_FOLDER = `${BASE}/과제A`;
  const PERMS = { [PERM_FOLDER]: [
    { id: 14, type: 8, title: 'Limited Access System Group For List 3051a4ff', roles: [{ id: 1073741825, name: '제한된 액세스', kind: 1, hidden: true }] },
    { id: 1909, type: 1, title: 'MOON Changjae', email: 'moon@krs.co.kr', roles: [{ id: 1073741827, name: '참가', kind: 3 }] },
    { id: 1944, type: 1, title: 'LEE Jaehoon', email: 'jhlee81@krs.co.kr', roles: [{ id: 1073741826, name: '읽기', kind: 2 }, { id: 1073741825, name: '제한된 액세스', kind: 1, hidden: true }] },
    { id: 2040, type: 1, title: 'ROH Gilltae', email: '', login: 'i:0#.f|membership|gtroh@krs.co.kr', roles: [{ id: 1073741829, name: '모든 권한', kind: 5 }, { id: 1073741827, name: '참가', kind: 3 }] },
    { id: 2411, type: 1, title: 'YOON Sewoong', email: 'swyoon@krs.co.kr', roles: [{ id: 1073741825, name: '제한된 액세스', kind: 1, hidden: true }] },
    { id: 3478, type: 8, title: 'SharingLinks.70ebcbd6-e7ab-4052-b4c3-7bd3ed3f1648.OrganizationEdit.a30f6b6c', roles: [{ id: 1073741827, name: '참가', kind: 3 }] },
    { id: ME, type: 1, title: 'KIM Geohwa', email: 'kimghw@krs.co.kr', roles: [{ id: 1073741830, name: '편집', kind: 6 }] },
  ] };
  const SEARCH = {
    '문창재': [{ title: 'MOON Changjae', email: 'cjmoon@krs.co.kr', login: 'i:0#.f|membership|cjmoon@krs.co.kr' }],
    '김철수': [{ title: 'KIM Chulsoo', email: 'kim1@krs.co.kr' }, { title: 'KIM Chulsoo (해양)', email: 'kim2@krs.co.kr' }],
    'kim2@krs.co.kr': [{ title: 'KIM Chulsoo', email: 'kim1@krs.co.kr' }, { title: 'KIM Chulsoo (해양)', email: 'kim2@krs.co.kr' }],
    'LEE Jaehoon': [{ title: 'LEE Jaehoon', email: 'jhlee81@krs.co.kr' }, { title: 'LEE Jaehoon2', email: 'jhlee2@krs.co.kr' }],
    '없는사람': [],
    '메일없음': [{ title: 'NO Mail', email: '' }],
  };

  await (async () => {
  await test('parseFolder: 폴더 주소(내 OneDrive · 팀 사이트 · 퍼센트 인코딩 · 끝 /) → origin · sitePath · api · folderApi · viewUrl', () => {
    const a = SP.parseFolder(`${ORIGIN}/personal/kimghw_krs_co_kr/Documents/RERP/`);
    assert.strictEqual(a.origin, ORIGIN);
    assert.strictEqual(a.sitePath, '/personal/kimghw_krs_co_kr');
    assert.strictEqual(a.siteUrl, `${ORIGIN}/personal/kimghw_krs_co_kr`);
    assert.strictEqual(a.apiRoot, `${a.siteUrl}/_api`);
    assert.strictEqual(a.api, `${a.siteUrl}/_api/web`);
    assert.strictEqual(a.folderPath, RERP);
    assert.strictEqual(a.name, 'RERP');
    assert.strictEqual(a.folderApi, `${a.api}/GetFolderByServerRelativePath(decodedurl='${encodeURIComponent(RERP)}')`);
    assert.strictEqual(a.fileApi('2026-0063-01.json'), `${a.api}/GetFileByServerRelativePath(decodedurl='${encodeURIComponent(`${RERP}/2026-0063-01.json`)}')`);
    assert.strictEqual(a.fileUrl('2026-0063-01.json'), `${ORIGIN}${RERP}/2026-0063-01.json`);
    assert.strictEqual(a.viewUrl, `${a.siteUrl}/_layouts/15/onedrive.aspx?id=${encodeURIComponent(RERP)}`);
    assert.strictEqual(a.personal, true); assert.strictEqual(a.mine, false);
    // 팀 사이트 — 공백·한글 퍼센트 인코딩, 문서함 보기 주소는 AllItems.aspx
    const b = SP.parseFolder('https://krclass.sharepoint.com/sites/AIP/Shared%20Documents/%EA%B3%B5%EC%9C%A0/RERP');
    assert.strictEqual(b.sitePath, '/sites/AIP');
    assert.strictEqual(b.siteUrl, 'https://krclass.sharepoint.com/sites/AIP');
    assert.strictEqual(b.folderPath, '/sites/AIP/Shared Documents/공유/RERP');
    assert.strictEqual(b.viewUrl, `https://krclass.sharepoint.com/sites/AIP/Shared%20Documents/Forms/AllItems.aspx?id=${encodeURIComponent('/sites/AIP/Shared Documents/공유/RERP')}`);
    assert.strictEqual(b.personal, false);
    // 루트 사이트의 문서함
    const c = SP.parseFolder('https://krclass.sharepoint.com/Shared Documents/RERP');
    assert.strictEqual(c.sitePath, ''); assert.strictEqual(c.siteUrl, 'https://krclass.sharepoint.com'); assert.strictEqual(c.folderPath, '/Shared Documents/RERP');
  });

  await test('parseFolder: 문서함 보기 주소 onedrive.aspx?id= · Forms/AllItems.aspx?id= · 파일을 고른 주소(parent=)', () => {
    const a = SP.parseFolder(`${ORIGIN}/personal/kimghw_krs_co_kr/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fkimghw%5Fkrs%5Fco%5Fkr%2FDocuments%2FRERP&view=0`);
    assert.strictEqual(a.folderPath, RERP);
    assert.strictEqual(a.siteUrl, `${ORIGIN}/personal/kimghw_krs_co_kr`);
    const b = SP.parseFolder('https://krclass.sharepoint.com/sites/AIP/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FAIP%2FShared%20Documents%2FRERP&p=true&ga=1');
    assert.strictEqual(b.folderPath, '/sites/AIP/Shared Documents/RERP');
    assert.strictEqual(b.api, 'https://krclass.sharepoint.com/sites/AIP/_api/web');
    // 파일을 고른 보기 주소 → parent 가 폴더
    const c = SP.parseFolder(`${ORIGIN}/personal/kimghw_krs_co_kr/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fkimghw%5Fkrs%5Fco%5Fkr%2FDocuments%2FRERP%2F2026%2D0063%2D01%2Ejson&parent=%2Fpersonal%2Fkimghw%5Fkrs%5Fco%5Fkr%2FDocuments%2FRERP`);
    assert.strictEqual(c.folderPath, RERP);
    // 폴더를 연 주소에 parent 가 있어도(하위 폴더로 들어감) id 가 폴더
    const d = SP.parseFolder(`${ORIGIN}/personal/kimghw_krs_co_kr/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fkimghw%5Fkrs%5Fco%5Fkr%2FDocuments%2FRERP&parent=%2Fpersonal%2Fkimghw%5Fkrs%5Fco%5Fkr%2FDocuments`);
    assert.strictEqual(d.folderPath, RERP);
  });

  await test('parseFolder: badurl — 빈 값 · 주소 아님 · http · sharepoint 아님 · 공유 링크 · id 없는 aspx · 사이트만(폴더 없음) · _layouts 경로 · 금지 글자', () => {
    throws(() => SP.parseFolder(''), 'badurl', /비어/);
    throws(() => SP.parseFolder('안녕'), 'badurl', /주소 모양/);
    throws(() => SP.parseFolder('http://krclass.sharepoint.com/sites/A/Shared Documents/x'), 'badurl', /https/);
    throws(() => SP.parseFolder('https://onedrive.live.com/?id=abc'), 'badurl', /sharepoint/);
    throws(() => SP.parseFolder(`${ORIGIN}/:f:/g/personal/kimghw_krs_co_kr/EabcDEF?e=xyz`), 'badurl', /공유 링크 대신 폴더를 연 뒤/);
    throws(() => SP.parseFolder(`${ORIGIN}/personal/kimghw_krs_co_kr/_layouts/15/onedrive.aspx?view=0`), 'badurl', /id=/);
    throws(() => SP.parseFolder('https://krclass.sharepoint.com/sites/AIP'), 'badurl', /문서함 안의 폴더/);
    throws(() => SP.parseFolder('https://krclass.sharepoint.com/'), 'badurl', /문서함 안의 폴더/);
    throws(() => SP.parseFolder(`${ORIGIN}/personal/kimghw_krs_co_kr/_layouts/15/download`), 'badurl');
    throws(() => SP.parseFolder('https://krclass.sharepoint.com/sites/AIP/Shared%20Documents/a%3Cb'), 'badurl', /글자/);
    throws(() => SP.parseFolder(`https://krclass.sharepoint.com/sites/AIP/x/${'a'.repeat(2100)}`), 'badurl', /너무/);
  });

  await test('한글·공백·따옴표 폴더와 한글 파일 이름 왕복 — decodedurl 은 encodeURIComponent 뒤 \' → \'\', 가짜 서버가 디코딩해 같은 폴더를 찾는다 · fileUrl 은 브라우저 주소', async () => {
    const folder = "/personal/kimghw_krs_co_kr/Documents/공유 자료/RERP's";
    const name = '2026-0063-01 한글 과제.json';
    const cfg = SP.parseFolder(`${ORIGIN}${encodeURI(folder)}`);
    assert.strictEqual(cfg.folderPath, folder);
    assert.ok(cfg.folderApi.endsWith(`(decodedurl='${encodeURIComponent(folder.replace("'", "''"))}')`), cfg.folderApi);
    assert.ok(!/[가-힣 ]/.test(cfg.folderApi) && !/[가-힣 ]/.test(cfg.fileApi(name)), '요청 주소에 한글·공백이 날로 남지 않음');
    assert.strictEqual(decodeURIComponent(new URL(cfg.fileUrl(name)).pathname), `${folder}/${name}`);
    assert.strictEqual(cfg.fileUrl(name), `${ORIGIN}/personal/kimghw_krs_co_kr/Documents/%EA%B3%B5%EC%9C%A0%20%EC%9E%90%EB%A3%8C/RERP's/2026-0063-01%20%ED%95%9C%EA%B8%80%20%EA%B3%BC%EC%A0%9C.json`);
    const F = fakeSp({ files: { [folder]: { [name]: '{"v":1,"prjNo":"2026-0063-01"}' } } });
    const list = await SP.listFiles(cfg, { fetch: F.fetch });
    assert.deepStrictEqual(list.map((f) => f.name), [name]);
    assert.strictEqual(calls(F)[0], `GET folder(${folder})/Files?$select=Name,Length,TimeLastModified,UIVersionLabel,UniqueId`);
    const r = await SP.readFile(cfg, name, { fetch: F.fetch });
    assert.strictEqual(r.text, '{"v":1,"prjNo":"2026-0063-01"}');
    assert.ok(calls(F).includes(`GET file(${folder}/${name})/$value`));
    // 쓰기도 같은 경로로
    const C = fakeChrome(F.fetch);
    const w = await SP.openWriter(cfg, { chrome: C });
    const res = await w.write(name, '{"v":1,"x":"한글"}', { comment: "한글 '설명'" });
    assert.strictEqual(res.updated, true);
    assert.strictEqual(F.file(folder, name).text, '{"v":1,"x":"한글"}');
    assert.strictEqual(F.file(folder, name).lastComment, "한글 '설명'");
    await w.close();
  });

  await test('revive: storage 캐시(JSON)에서 읽은 cfg 에 fileApi · fileUrl 을 되살림 · KRX_SP.fileApi(cfg, name) 은 함수 없는 cfg 에도 됨 · 설정 없으면 badurl', () => {
    const plain = JSON.parse(JSON.stringify(Object.assign({}, CFG, { mine: true })));
    assert.strictEqual(plain.fileApi, undefined);
    assert.strictEqual(SP.fileApi(plain, 'a.json'), CFG.fileApi('a.json'));
    assert.strictEqual(SP.fileUrl(plain, 'a.json'), CFG.fileUrl('a.json'));
    const back = SP.revive(plain);
    assert.strictEqual(back.fileApi('a.json'), CFG.fileApi('a.json'));
    assert.strictEqual(back.viewUrl, CFG.viewUrl); assert.strictEqual(back.mine, true); assert.strictEqual(back.url, CFG.url);
    assert.strictEqual(SP.revive(CFG), CFG, '살아 있으면 그대로');
    throws(() => SP.revive(null), 'badurl'); throws(() => SP.revive({}), 'badurl');
    throws(() => SP.fileApi(CFG, 'a/b.json'), 'badurl', /파일 이름/); throws(() => SP.fileApi(CFG, ''), 'badurl');
  });

  await test('resolveMyFolder: v2.0 me/drive 의 webUrl + /업무/shared(기본 — 두 단, name 으로 바꿀 수 있음) → mine:true · drive 404 면 PersonalUrl 대체 · 403 → auth · 로그인 화면 → auth · 연결 실패 → offline', async () => {
    const F = fakeSp();
    const cfg = await SP.resolveMyFolder({ fetch: F.fetch });
    assert.strictEqual(cfg.folderPath, BASE); assert.strictEqual(cfg.name, 'shared'); assert.strictEqual(cfg.libPath, `${ME_PATH}`); assert.strictEqual(cfg.mine, true); assert.strictEqual(cfg.siteUrl, `${ORIGIN}/personal/kimghw_krs_co_kr`);
    assert.deepStrictEqual(calls(F), ['GET me/drive']);
    const G = fakeSp({ drive: 404 });
    const cfg2 = await SP.resolveMyFolder({ fetch: G.fetch, driveHost: `${ORIGIN}/` });
    assert.strictEqual(cfg2.folderPath, BASE);
    assert.strictEqual((await SP.resolveMyFolder({ fetch: F.fetch, name: 'RERP' })).folderPath, RERP, 'name 한 단');
    assert.deepStrictEqual(calls(G), ['GET me/drive', 'GET GetMyProperties']);
    const other = await SP.resolveMyFolder({ fetch: F.fetch, name: '공유' });
    assert.strictEqual(other.folderPath, `${ME_PATH}/공유`);
    await rejects(SP.resolveMyFolder({ fetch: fakeSp({ deny403: true }).fetch }), 'auth', /로그인/);
    await rejects(SP.resolveMyFolder({ fetch: fakeSp({ loggedIn: false }).fetch }), 'auth', /로그인 화면/);
    await rejects(SP.resolveMyFolder({ fetch: async () => { throw new Error('ENOTFOUND'); } }), 'offline', /연결/);
    await rejects(SP.resolveMyFolder({ fetch: F.fetch, driveHost: 'nope' }), 'badurl');
  });

  await test('resolveFolder: 비면 내 OneDrive · 공유 링크는 redirect:follow 로 따라간 끝 주소의 id= · 끝에 id 없으면 badurl(안내) · 로그인 화면 → auth · 폴더 주소는 parseFolder · 엉뚱한 글 badurl', async () => {
    const F = fakeSp();
    const mine = await SP.resolveFolder('', { fetch: F.fetch });
    assert.strictEqual(mine.mine, true); assert.strictEqual(mine.folderPath, BASE);
    assert.strictEqual((await SP.resolveFolder('', { fetch: F.fetch, name: 'RERP' })).folderPath, RERP, 'name 을 넘기면 그 밑폴더');
    const share = `${ORIGIN}/:f:/g/personal/kimghw_krs_co_kr/EabcDEFghi?e=xyz12`;
    const s = await SP.resolveFolder(share, { fetch: F.fetch });
    assert.strictEqual(s.folderPath, RERP); assert.strictEqual(s.mine, false); assert.strictEqual(s.shareUrl, share);
    assert.ok(s.url.includes('onedrive.aspx'), '풀린 주소가 url');
    assert.deepStrictEqual(calls(F).slice(-1), ['GET share follow']);
    await rejects(SP.resolveFolder(share, { fetch: fakeSp({ shareDest: `${ORIGIN}/personal/kimghw_krs_co_kr/_layouts/15/onedrive.aspx?view=0` }).fetch }), 'badurl', /공유 링크 대신 폴더를 연 뒤 주소창의 주소를 넣으세요/);
    await rejects(SP.resolveFolder(share, { fetch: fakeSp({ shareDest: 'login' }).fetch }), 'auth', /로그인/);
    await rejects(SP.resolveFolder(share, { fetch: async () => ({ ok: true, status: 200, url: '' }) }), 'badurl', /따라가지/);
    await rejects(SP.resolveFolder(share, { fetch: async () => { throw new Error('down'); } }), 'offline');
    const plain = await SP.resolveFolder(` ${ORIGIN}${RERP} `, { fetch: F.fetch });
    assert.strictEqual(plain.folderPath, RERP);
    await rejects(SP.resolveFolder('hello', { fetch: F.fetch }), 'badurl');
  });

  await test('listFiles: 모양(name · length · modified · version · uniqueId 소문자) · 404 → nofolder · 빈 폴더는 Exists 로 가름(false → nofolder, true → []) · 로그인 화면 → auth · 403 → auth', async () => {
    const F = fakeSp({ files: { [RERP]: { 'P1.json': '{"a":1}', 'P2.json': '{"b":22}' } } });
    const list = await SP.listFiles(CFG, { fetch: F.fetch });
    assert.deepStrictEqual(list, [
      { name: 'P1.json', length: 7, modified: '2026-10-18T01:02:03Z', version: '1.0', uniqueId: '00000001-0000-0000-0000-00000000abcd' },
      { name: 'P2.json', length: 8, modified: '2026-10-18T01:02:03Z', version: '1.0', uniqueId: '00000002-0000-0000-0000-00000000abcd' }
    ]);
    assert.strictEqual(F.st.calls.length, 1, '목록이 있으면 Exists 조회 없음');
    const e = await rejects(SP.listFiles(CFG, { fetch: fakeSp().fetch }), 'nofolder', /공유 폴더가 없습니다/);
    assert.strictEqual(e.path, RERP);
    const E = fakeSp({ folders: [RERP] });
    assert.deepStrictEqual(await SP.listFiles(CFG, { fetch: E.fetch }), []);
    assert.deepStrictEqual(calls(E), [`GET folder(${RERP})/Files?$select=Name,Length,TimeLastModified,UIVersionLabel,UniqueId`, `GET folder(${RERP})?$select=Exists`]);
    // 가짜가 200 + 빈 목록 뒤 Exists:false 를 주는 경우(실측의 GetFolder… 동작)
    const X = fakeSp({ folders: [RERP] });
    const base = X.fetch;
    const fetch2 = async (u, i) => (String(u).includes('/Files?') ? { ok: true, status: 200, url: '', json: async () => ({ value: [] }) } : base(u, i));
    delete X.st.folders[RERP];
    await rejects(SP.listFiles(CFG, { fetch: fetch2 }), 'nofolder');
    await rejects(SP.listFiles(CFG, { fetch: fakeSp({ loggedIn: false }).fetch }), 'auth', /로그인 화면/);
    await rejects(SP.listFiles(CFG, { fetch: async (u, i) => ({ ok: false, status: 403, url: '', json: async () => ({}) }) }), 'auth');
    await rejects(SP.listFiles(CFG, { fetch: async () => ({ ok: true, status: 200, url: '', json: async () => 'x' }) }), 'http', /JSON/);
    await rejects(SP.listFiles(JSON.parse(JSON.stringify(CFG)), { fetch: fakeSp().fetch }), 'nofolder');   // 캐시 cfg 도 받음
  });

  await test('readFile: 200 → { text, meta } · 404 → null · Exists:false → null · 로그인 redirect → auth · 500 → http(status) · 연결 실패 → offline', async () => {
    const F = fakeSp({ files: { [RERP]: { 'P1.json': '{"v":1,"prjNo":"P1"}' } } });
    const r = await SP.readFile(CFG, 'P1.json', { fetch: F.fetch });
    assert.deepStrictEqual(r, { text: '{"v":1,"prjNo":"P1"}', meta: { version: '1.0', modified: '2026-10-18T01:02:03Z', length: 20, uniqueId: '00000001-0000-0000-0000-00000000abcd', checkedOut: false, checkedOutByMe: false } });
    assert.deepStrictEqual(calls(F), [`GET file(${RERP}/P1.json)?$select=Exists,CheckOutType,UniqueId,Length,TimeLastModified,UIVersionLabel`, `GET file(${RERP}/P1.json)/$value`]);
    assert.strictEqual(await SP.readFile(CFG, 'none.json', { fetch: F.fetch }), null);
    // 체크아웃된 파일: 내가 잡은 것(끊긴 지난 쓰기)은 checkedOutByMe 와 함께 $value 가 내 초안, 남이 잡은 것은 지난 판
    const G = fakeSp({ files: { [RERP]: { 'mine.json': '{"n":1}', 'other.json': '{"n":1}' } }, checkedOutBy: { 'mine.json': ME, 'other.json': 99 }, drafts: { 'mine.json': '{"n":2}' } });
    const mine = await SP.readFile(CFG, 'mine.json', { fetch: G.fetch });
    assert.deepStrictEqual([mine.text, mine.meta.checkedOut, mine.meta.checkedOutByMe], ['{"n":2}', true, true]);
    assert.ok(calls(G).includes('GET currentuser') && calls(G).some((c) => c.includes('/CheckedOutByUser')), '누가 잡았는지 본다');
    const other = await SP.readFile(CFG, 'other.json', { fetch: G.fetch });
    assert.deepStrictEqual([other.text, other.meta.checkedOut, other.meta.checkedOutByMe], ['{"n":1}', true, false]);
    assert.strictEqual(await SP.readFile(CFG, 'x.json', { fetch: async () => ({ ok: true, status: 200, url: '', json: async () => ({ Exists: false }) }) }), null);
    await rejects(SP.readFile(CFG, 'P1.json', { fetch: fakeSp({ loggedIn: false }).fetch }), 'auth', /로그인 화면/);
    const e = await rejects(SP.readFile(CFG, 'P1.json', { fetch: async () => ({ ok: false, status: 500, url: '', json: async () => ({}) }) }), 'http');
    assert.strictEqual(e.status, 500);
    await rejects(SP.readFile(CFG, 'P1.json', { fetch: async () => { throw new TypeError('Failed to fetch'); } }), 'offline');
    await rejects(SP.readFile(CFG, '../x', { fetch: F.fetch }), 'badurl', /파일 이름/);
  });

  await test('openWriter: 최소화·비포커스 창으로 사이트 페이지를 열고 contextinfo 한 번 · 작업 탭이 로그인 화면이면 auth(페이지 함수 없이 창 닫음) · 창 못 열면 tab · contextinfo 403 → auth', async () => {
    const F = fakeSp({ folders: [RERP] });
    const C = fakeChrome(F.fetch);
    const w = await SP.openWriter(CFG, { chrome: C });
    assert.deepStrictEqual(C.log[0], ['create', 'minimized', false, `${CFG.siteUrl}/_api/web/currentuser?$select=Id`]);
    assert.deepStrictEqual(C.log.filter((l) => l[0] === 'run').map((l) => l.slice(1)), [['spDigest', 'MAIN', '0']]);
    assert.strictEqual(F.st.digestIssued, 1);
    assert.strictEqual(w.tabId, 12); assert.strictEqual(w.windowId, 11); assert.strictEqual(w.folderPath, RERP);
    await w.close();
    assert.deepStrictEqual(C.log.slice(-1), [['windows.remove', 11]]);
    await w.close();   // 두 번 닫아도 조용히
    assert.strictEqual(C.log.filter((l) => l[0] === 'windows.remove').length, 1);
    // 로그인 화면으로 넘어간 탭
    const L = fakeChrome(F.fetch, { landing: 'https://login.microsoftonline.com/common/oauth2/authorize?x=1' });
    await rejects(SP.openWriter(CFG, { chrome: L }), 'auth', /로그인/);
    assert.deepStrictEqual(L.log.map((l) => l[0]), ['create', 'update', 'windows.remove']);
    // 창 못 열면 tab
    await rejects(SP.openWriter(CFG, { chrome: fakeChrome(F.fetch, { failOpen: true }) }), 'tab', /작업 탭/);
    // 창에 tabs 가 없으면 tabs.query 로 찾음
    const N = fakeChrome(F.fetch, { noTabs: true });
    const w2 = await SP.openWriter(CFG, { chrome: N }); assert.strictEqual(w2.tabId, 12); await w2.close();
    // contextinfo 403 → auth, 창 닫음
    const D = fakeSp({ deny403: true }); const DC = fakeChrome(D.fetch);
    await rejects(SP.openWriter(CFG, { chrome: DC }), 'auth');
    assert.strictEqual(DC.log.slice(-1)[0][0], 'windows.remove');
    await rejects(SP.openWriter(CFG, { chrome: {} }), 'tab');
  });

  await test('writer.modify ① 없으면 transform(null) → Files/add(url,overwrite=false) 본문 = 내용 (체크아웃 없음) · transform 이 changed:false 면 만들지 않음', async () => {
    const F = fakeSp({ folders: [RERP] });
    const C = fakeChrome(F.fetch);
    const w = await SP.openWriter(CFG, { chrome: C });
    const from = F.st.calls.length;
    const seen = [];
    const r = await w.modify('P1.json', (cur) => { seen.push(cur); return { changed: true, text: '{"v":1,"prjNo":"P1"}' }; });
    assert.deepStrictEqual(seen, [null]);
    assert.deepStrictEqual(r, { changed: true, created: true, updated: false, checkedIn: false, version: '1.0', meta: { version: '1.0', modified: '2026-10-18T01:02:03Z', length: 20, uniqueId: '00000001-0000-0000-0000-00000000abcd' } });
    assert.strictEqual(F.file(RERP, 'P1.json').text, '{"v":1,"prjNo":"P1"}');
    assert.deepStrictEqual(calls(F, from), [`GET file(${RERP}/P1.json)?$select=Exists,CheckOutType,UniqueId,UIVersionLabel,Length,TimeLastModified`, `POST folder(${RERP})/Files/add(url='P1.json',overwrite=false)`], '보통 문서함(CheckOutType 2)이면 체크인 호출 없음');
    const from2 = F.st.calls.length;
    const r2 = await w.modify('P2.json', () => ({ changed: false }));
    assert.deepStrictEqual(r2, { changed: false, created: false, updated: false, checkedIn: false, version: '', meta: null });
    assert.strictEqual(F.file(RERP, 'P2.json'), undefined);
    assert.strictEqual(calls(F, from2).length, 1, '파일 정보만 봄');
    assert.strictEqual(F.st.digestIssued, 1, '다이제스트는 writer 하나에 한 번');
    await w.close();
  });

  await test('writer.modify ② 있고 바뀌면 CheckOut → $value → PUT → CheckIn(comment, 주 버전) → 파일 정보 · ③ 안 바뀌면 UndoCheckOut(PUT 없음)', async () => {
    const F = fakeSp({ files: { [RERP]: { 'P1.json': '{"v":1,"n":1}' } } });
    const C = fakeChrome(F.fetch);
    const w = await SP.openWriter(CFG, { chrome: C });
    const from = F.st.calls.length;
    const r = await w.modify('P1.json', (cur) => ({ changed: true, text: cur.replace('"n":1', '"n":2') }), { comment: "동기화 'x'" });
    assert.deepStrictEqual(r, { changed: true, created: false, updated: true, checkedIn: true, version: '2.0', meta: { version: '2.0', modified: '2026-10-18T02:00:00Z', length: 13, uniqueId: '00000001-0000-0000-0000-00000000abcd' } });
    const file = F.file(RERP, 'P1.json');
    assert.strictEqual(file.text, '{"v":1,"n":2}'); assert.strictEqual(file.checkedOutBy, null); assert.strictEqual(file.version, 2); assert.strictEqual(file.lastComment, "동기화 'x'");
    const P = `file(${RERP}/P1.json)`;
    assert.deepStrictEqual(calls(F, from), [
      `GET ${P}?$select=Exists,CheckOutType,UniqueId,UIVersionLabel,Length,TimeLastModified`, `POST ${P}/CheckOut()`, `GET ${P}/$value`,
      `PUT ${P}/$value`, `POST ${P}/CheckIn(comment='${encodeURIComponent("동기화 ''x''")}',checkintype=1)`, `GET ${P}?$select=UniqueId,UIVersionLabel,Length,TimeLastModified`
    ]);
    assert.deepStrictEqual(C.log.filter((l) => l[0] === 'run').map((l) => l[1]), ['spDigest', 'spBegin', 'spCommit']);
    // ③ 안 바뀌면
    const from2 = F.st.calls.length;
    const r2 = await w.modify('P1.json', () => ({ changed: false }));
    assert.deepStrictEqual(r2, { changed: false, created: false, updated: false, checkedIn: false, version: '2.0', meta: { version: '2.0', modified: '2026-10-18T02:00:00Z', length: 13, uniqueId: '00000001-0000-0000-0000-00000000abcd' } });
    assert.ok(!calls(F, from2).some((c) => c.startsWith('PUT')), 'PUT 없음');
    assert.ok(calls(F, from2).includes(`POST ${P}/UndoCheckOut()`));
    assert.strictEqual(file.checkedOutBy, null); assert.strictEqual(file.version, 2);
    // 기본 설명 · 비동기 transform
    await w.modify('P1.json', async (cur) => ({ changed: true, text: cur + ' ' }));
    assert.strictEqual(file.lastComment, SP.DEFAULT_COMMENT);
    // transform 이 던지면 UndoCheckOut 뒤 그대로 던짐 · 결과가 없으면 Error
    await assert.rejects(w.modify('P1.json', () => { throw new Error('병합 실패'); }), /병합 실패/);
    assert.strictEqual(file.checkedOutBy, null);
    await assert.rejects(w.modify('P1.json', () => null), /변환 결과/);
    assert.strictEqual(file.checkedOutBy, null);
    await w.close();
  });

  await test('writer.modify ④ 남이 체크아웃 → locked(쓰지 않음, 그 파일만) · 내가 잡고 있던 체크아웃은 이어서 씀 · PUT 실패 → http + UndoCheckOut', async () => {
    const F = fakeSp({ files: { [RERP]: { 'P1.json': '{"a":1}', 'P2.json': '{"b":1}', 'P3.json': '{"c":1}' } }, checkedOutBy: { 'P1.json': 99, 'P3.json': ME } });
    const C = fakeChrome(F.fetch);
    const w = await SP.openWriter(CFG, { chrome: C });
    const from = F.st.calls.length;
    const e = await rejects(w.modify('P1.json', () => ({ changed: true, text: 'x' })), 'locked', /다른 사람/);
    assert.strictEqual(F.file(RERP, 'P1.json').text, '{"a":1}'); assert.strictEqual(F.file(RERP, 'P1.json').checkedOutBy, 99);
    assert.ok(!calls(F, from).some((c) => c.includes('CheckOut()') || c.startsWith('PUT')), '체크아웃·PUT 시도 없음');
    assert.strictEqual(SP.describe(e).kind, 'locked');
    // 같은 writer 로 다른 파일은 계속
    const r2 = await w.modify('P2.json', () => ({ changed: true, text: '{"b":2}' }));
    assert.strictEqual(r2.updated, true); assert.strictEqual(F.file(RERP, 'P2.json').text, '{"b":2}');
    // 내가 잡고 있던 것(지난번에 끊긴 체크아웃)은 CheckOut 없이 이어서
    const from3 = F.st.calls.length;
    const r3 = await w.modify('P3.json', () => ({ changed: true, text: '{"c":2}' }));
    assert.strictEqual(r3.updated, true);
    assert.ok(!calls(F, from3).some((c) => c.includes('/CheckOut()')), '이미 내가 잡고 있으면 CheckOut 안 함');
    assert.ok(calls(F, from3).includes('GET currentuser') && calls(F, from3).some((c) => c.includes('/CheckedOutByUser')));
    assert.strictEqual(F.file(RERP, 'P3.json').checkedOutBy, null);
    // CheckOut 이 423 이면 locked
    const base = F.fetch;
    C.scripting.executeScript = (({ target, world, func, args }) => { C.log.push(['run', func.name]); const orig = globalThis.fetch; globalThis.fetch = async (u, i) => (String(u).endsWith('/CheckOut()') ? { ok: false, status: 423, json: async () => ({}) } : base(u, i)); return (async () => { try { return [{ result: await func(...args) }]; } finally { globalThis.fetch = orig; } })(); });
    await rejects(w.modify('P2.json', () => ({ changed: true, text: 'y' })), 'locked');
    await w.close();
    // PUT 실패 → http + UndoCheckOut
    const G = fakeSp({ files: { [RERP]: { 'P1.json': '{"a":1}' } }, failPut: true });
    const w2 = await SP.openWriter(CFG, { chrome: fakeChrome(G.fetch) });
    const e2 = await rejects(w2.modify('P1.json', () => ({ changed: true, text: 'x' })), 'http', /쓰기 500/);
    assert.strictEqual(e2.status, 500);
    assert.strictEqual(G.file(RERP, 'P1.json').text, '{"a":1}'); assert.strictEqual(G.file(RERP, 'P1.json').checkedOutBy, null, 'PUT 실패 → UndoCheckOut');
    await w2.close();
  });

  await test('끊긴 체크아웃 이어받기(resumed): 올라간 초안과 같아 안 바뀌어도 UndoCheckOut 이 아니라 CheckIn(초안이 판이 되고 체크아웃 끝) · discard:true 면 UndoCheckOut · 체크인 실패 뒤 다음 쓰기가 체크인한다', async () => {
    // 지난 쓰기가 PUT 뒤 CheckIn 전에 끊김: 내 체크아웃 + 초안 {"n":2}, 체크인된 판은 {"n":1}
    const F = fakeSp({ files: { [RERP]: { 'P1.json': '{"n":1}', 'P2.json': '{"n":1}' } }, checkedOutBy: { 'P1.json': ME, 'P2.json': ME }, drafts: { 'P1.json': '{"n":2}', 'P2.json': '깨진 초안' } });
    const w = await SP.openWriter(CFG, { chrome: fakeChrome(F.fetch) });
    const from = F.st.calls.length;
    const seen = [];
    const r = await w.modify('P1.json', (cur) => { seen.push(cur); return { changed: false }; });
    assert.deepStrictEqual(seen, ['{"n":2}'], 'transform 은 초안을 본다');
    assert.deepStrictEqual([r.changed, r.updated, r.checkedIn, r.version], [false, false, true, '2.0']);
    const P = `file(${RERP}/P1.json)`;
    assert.ok(!calls(F, from).some((c) => c.includes('UndoCheckOut') || c.startsWith('PUT') || c.includes('/CheckOut()')), 'UndoCheckOut · PUT · CheckOut 없음');
    assert.ok(calls(F, from).some((c) => c.startsWith(`POST ${P}/CheckIn(`)), 'CheckIn 만');
    assert.deepStrictEqual([F.file(RERP, 'P1.json').text, F.file(RERP, 'P1.json').draft, F.file(RERP, 'P1.json').checkedOutBy, F.file(RERP, 'P1.json').version], ['{"n":2}', null, null, 2], '초안이 판이 됐고 체크아웃이 끝남');
    // 해석되지 않는 초안은 transform 이 discard 로 알려 UndoCheckOut(지난 판으로)
    const r2 = await w.modify('P2.json', () => ({ changed: false, discard: true }));
    assert.deepStrictEqual([r2.changed, r2.checkedIn, F.file(RERP, 'P2.json').text, F.file(RERP, 'P2.json').draft, F.file(RERP, 'P2.json').checkedOutBy], [false, false, '{"n":1}', null, null]);
    await w.close();
    // PUT 은 됐는데 CheckIn 이 실패 → http(체크아웃은 내게 남음) → 다음 writer 의 modify(안 바뀜)가 이어받아 체크인
    const G = fakeSp({ files: { [RERP]: { 'P1.json': '{"n":1}' } }, failCheckIn: true });
    const w2 = await SP.openWriter(CFG, { chrome: fakeChrome(G.fetch) });
    const e = await rejects(w2.modify('P1.json', () => ({ changed: true, text: '{"n":2}' })), 'http', /체크인 500/);
    assert.strictEqual(e.status, 500);
    assert.deepStrictEqual([G.file(RERP, 'P1.json').checkedOutBy, G.file(RERP, 'P1.json').draft, G.file(RERP, 'P1.json').text], [ME, '{"n":2}', '{"n":1}']);
    await w2.close();
    const read = await SP.readFile(CFG, 'P1.json', { fetch: G.fetch });
    assert.deepStrictEqual([read.text, read.meta.checkedOutByMe], ['{"n":2}', true], '읽기는 내 초안을 주고 내 체크아웃이라 알린다 — prjdoc-sync 가 내용이 같아도 modify 를 탄다');
    const w3 = await SP.openWriter(CFG, { chrome: fakeChrome(G.fetch) });
    const r3 = await w3.modify('P1.json', (cur) => ({ changed: cur !== '{"n":2}', text: '{"n":2}' }));
    assert.deepStrictEqual([r3.changed, r3.checkedIn, G.file(RERP, 'P1.json').checkedOutBy, G.file(RERP, 'P1.json').text, G.file(RERP, 'P1.json').version], [false, true, null, '{"n":2}', 2]);
    await w3.close();
  });

  await test('"체크아웃 필수" 문서함: Files/add 뒤 파일이 내 체크아웃(CheckOutType 0 · 판 0.1)이면 CheckIn 까지 — 남에게 보이고 UndoCheckOut 이 파일을 지우는 일이 없다', async () => {
    const F = fakeSp({ folders: [RERP], requireCheckout: true });
    const w = await SP.openWriter(CFG, { chrome: fakeChrome(F.fetch) });
    const from = F.st.calls.length;
    const r = await w.modify('P1.json', () => ({ changed: true, text: '{"v":1}' }), { comment: '처음' });
    assert.deepStrictEqual([r.created, r.checkedIn, r.version], [true, true, '1.0']);
    const P = `file(${RERP}/P1.json)`;
    assert.deepStrictEqual(calls(F, from).filter((c) => c.startsWith('POST')), [`POST folder(${RERP})/Files/add(url='P1.json',overwrite=false)`, `POST ${P}/CheckIn(comment='${encodeURIComponent('처음')}',checkintype=1)`]);
    const file = F.file(RERP, 'P1.json');
    assert.deepStrictEqual([file.text, file.draft, file.checkedOutBy, file.version, file.lastComment], ['{"v":1}', null, null, 1, '처음']);
    // 다음 쓰기(안 바뀜)는 보통 경로: CheckOut → UndoCheckOut — 파일은 남는다
    await w.modify('P1.json', () => ({ changed: false }));
    assert.ok(F.file(RERP, 'P1.json'), '파일 보존');
    await w.close();
  });

  await test('다이제스트: 만료·거부(403 security validation)면 다시 받아 한 번 더 · TTL(FormDigestTimeoutSeconds - 1분)이 지나면 쓰기 전에 미리 다시 받음 · 그래도 거부면 http(auth 로 오해하지 않음)', async () => {
    const F = fakeSp({ files: { [RERP]: { 'P1.json': '{"n":1}', 'P2.json': '{"n":1}' } } });
    const w = await SP.openWriter(CFG, { chrome: fakeChrome(F.fetch) });
    assert.strictEqual(F.st.digestIssued, 1);
    F.expire();   // 서버가 다이제스트를 만료시킴
    const r = await w.modify('P1.json', () => ({ changed: true, text: '{"n":2}' }));
    assert.deepStrictEqual([r.updated, F.file(RERP, 'P1.json').text, F.file(RERP, 'P1.json').checkedOutBy, F.st.digestIssued], [true, '{"n":2}', null, 2], '체크아웃 403 → 새 다이제스트로 다시');
    // PUT 뒤 체크인 사이에 만료 — PUT 은 되돌리지 않고(다이제스트 탓) 새 다이제스트로 다시 PUT·체크인
    const base = F.fetch;
    let armed = true;
    const C = fakeChrome(async (u, i) => { const r2 = await base(u, i); if (armed && String(u).endsWith('/$value') && String((i || {}).method).toUpperCase() === 'PUT') { armed = false; F.expire(); } return r2; });
    const w2 = await SP.openWriter(CFG, { chrome: C });
    const n0 = F.st.digestIssued;
    const r2 = await w2.modify('P2.json', () => ({ changed: true, text: '{"n":3}' }));
    assert.deepStrictEqual([r2.updated, F.file(RERP, 'P2.json').text, F.file(RERP, 'P2.json').checkedOutBy, F.st.digestIssued - n0], [true, '{"n":3}', null, 1]);
    await w2.close();
    await w.close();
    // TTL: 시각을 주입 — 발급 뒤 29분이 지나면 다음 쓰기 전에 다시 받는다 (서버 거부 전에)
    let t = 1000000;
    const G = fakeSp({ files: { [RERP]: { 'P1.json': '{"n":1}' } } });
    const w3 = await SP.openWriter(CFG, { chrome: fakeChrome(G.fetch), now: () => t });
    await w3.modify('P1.json', () => ({ changed: true, text: '{"n":2}' }));
    assert.strictEqual(G.st.digestIssued, 1);
    t += 29 * 60 * 1000 + 1;
    await w3.modify('P1.json', () => ({ changed: true, text: '{"n":3}' }));
    assert.strictEqual(G.st.digestIssued, 2, '만료 1분 전이 지나 미리 다시 받음');
    assert.strictEqual(G.file(RERP, 'P1.json').text, '{"n":3}');
    await w3.close();
    // 짧은 FormDigestTimeoutSeconds(90초)도 따른다
    const H = fakeSp({ files: { [RERP]: { 'P1.json': '{"n":1}' } }, digestSec: 90 });
    let t2 = 0;
    const w4 = await SP.openWriter(CFG, { chrome: fakeChrome(H.fetch), now: () => t2 });
    t2 += 61 * 1000;
    await w4.modify('P1.json', () => ({ changed: true, text: '{"n":2}' }));
    assert.strictEqual(H.st.digestIssued, 2);
    await w4.close();
    // 새로 받아도 거부하면 http (로그인 안내가 아니라)
    const K = fakeSp({ files: { [RERP]: { 'P1.json': '{"n":1}' } } });
    const w5 = await SP.openWriter(CFG, { chrome: fakeChrome(K.fetch) });
    K.st.validDigests.clear(); K.st.validDigests.add = () => K.st.validDigests;   // 앞으로 내는 다이제스트도 모두 거부
    const e = await rejects(w5.modify('P1.json', () => ({ changed: true, text: 'x' })), 'http', /체크아웃 403/);
    assert.strictEqual(e.status, 403);
    await w5.close();
  });

  await test('folderUrl: 폴더 이름의 # · 공백 · 한글 · % 가 parseFolder 로 그대로 돌아온다 (encodeURI 는 # 을 두어 fragment 로 잘림)', () => {
    const folder = '/sites/x/Shared Documents/RERP#2 (가) 100%';   // SharePoint Online 은 폴더 이름에 # 과 % 를 허용한다
    const cfg = SP.parseFolder(`https://krclass.sharepoint.com${folder.split('/').map(encodeURIComponent).join('/')}`);
    assert.strictEqual(cfg.folderPath, folder);
    const url = SP.folderUrl(cfg);
    assert.strictEqual(url, 'https://krclass.sharepoint.com/sites/x/Shared%20Documents/RERP%232%20(%EA%B0%80)%20100%25');
    assert.strictEqual(SP.parseFolder(url).folderPath, folder, '동료가 붙여 넣으면 같은 폴더');
    assert.notStrictEqual(SP.parseFolder(`https://krclass.sharepoint.com${encodeURI(folder)}`).folderPath, folder, 'encodeURI 로 만든 주소는 # 뒤가 잘린다(옛 결함)');
    assert.strictEqual(SP.folderUrl(CFG), `${ORIGIN}${RERP}`);
    assert.strictEqual(SP.folderUrl(JSON.parse(JSON.stringify(CFG))), `${ORIGIN}${RERP}`, '캐시 cfg 에도');
  });

  await test('sweepWorkers: 지난 워커가 남긴 작업 창(…/_api/web/currentuser?$select=Id)만 닫고, 다른 SharePoint 탭·지금 살아 있는 writer 의 탭은 두며, 다른 탭이 섞인 창은 그 탭만 닫는다', async () => {
    const F = fakeSp({ folders: [RERP] });
    const C = fakeChrome(F.fetch);
    const orphan = C.addWindow([`${CFG.siteUrl}${SP.WORKER_PAGE}`]);
    const mixed = C.addWindow(['https://krclass.sharepoint.com/sites/AIP/Shared%20Documents/Forms/AllItems.aspx', `https://krclass.sharepoint.com/sites/AIP/_api/web/currentuser?%24select=Id`]);
    const other = C.addWindow([`${ORIGIN}/personal/kimghw_krs_co_kr/_layouts/15/onedrive.aspx?id=x`, 'https://eclass.krs.co.kr/']);
    const w = await SP.openWriter(CFG, { chrome: C });   // 살아 있는 writer
    const r = await SP.sweepWorkers({ chrome: C });
    assert.strictEqual(r.closed, 2);
    assert.ok(!C.windows_[orphan.id], '우리 탭만 있던 창은 창째');
    assert.deepStrictEqual(C.windows_[mixed.id].tabs.map((t) => t.url), ['https://krclass.sharepoint.com/sites/AIP/Shared%20Documents/Forms/AllItems.aspx'], '섞인 창은 작업 탭만');
    assert.strictEqual(C.windows_[other.id].tabs.length, 2, '다른 탭은 그대로');
    assert.ok(C.windows_[w.windowId] && C.windows_[w.windowId].tabs.length === 1, '살아 있는 writer 의 탭은 둔다');
    const ok = await w.write('P1.json', '{"a":1}');
    assert.strictEqual(ok.created, true, 'writer 는 계속 쓸 수 있다');
    await w.close();
    assert.deepStrictEqual(await SP.sweepWorkers({ chrome: C }), { closed: 0 });
    assert.deepStrictEqual(await SP.sweepWorkers({ chrome: {} }), { closed: 0 }, 'tabs 가 없으면 조용히');
    assert.deepStrictEqual(await SP.sweepWorkers({ chrome: { tabs: { query: async () => { throw new Error('x'); } } } }), { closed: 0 });
  });

  await test('writer.modify: 없다고 보고 만들다가 동료가 먼저 만들었으면(add 400) 체크아웃 경로로 다시 — transform 이 그 글로 한 번 더 불린다', async () => {
    const F = fakeSp({ folders: [RERP], raceCreate: '{"v":1,"by":"동료"}' });
    const w = await SP.openWriter(CFG, { chrome: fakeChrome(F.fetch) });
    const seen = [];
    const r = await w.modify('P1.json', (cur) => { seen.push(cur); return { changed: true, text: cur ? cur.replace('}', ',"me":1}') : '{"v":1,"me":1}' }; });
    assert.deepStrictEqual(seen, [null, '{"v":1,"by":"동료"}']);
    assert.strictEqual(r.created, false); assert.strictEqual(r.updated, true); assert.strictEqual(r.version, '2.0');
    assert.strictEqual(F.file(RERP, 'P1.json').text, '{"v":1,"by":"동료","me":1}');
    await w.close();
    // 폴더가 없는데 만들려 하면 nofolder
    const G = fakeSp();
    const w2 = await SP.openWriter(CFG, { chrome: fakeChrome(G.fetch) });
    await rejects(w2.modify('P1.json', () => ({ changed: true, text: 'x' })), 'nofolder');
    await w2.close();
  });

  await test('writer.write: 없으면 생성, 있으면 체크아웃·PUT·체크인 · writer.remove: recycle() → removed, 없으면 false', async () => {
    const F = fakeSp({ folders: [RERP] });
    const w = await SP.openWriter(CFG, { chrome: fakeChrome(F.fetch) });
    const a = await w.write('P1.json', '{"a":1}');
    assert.strictEqual(a.created, true); assert.strictEqual(a.version, '1.0');
    const b = await w.write('P1.json', '{"a":2}', { comment: '둘째' });
    assert.strictEqual(b.updated, true); assert.strictEqual(b.version, '2.0');
    assert.strictEqual(F.file(RERP, 'P1.json').text, '{"a":2}'); assert.strictEqual(F.file(RERP, 'P1.json').lastComment, '둘째');
    const from = F.st.calls.length;
    assert.deepStrictEqual(await w.remove('P1.json'), { removed: true });
    assert.deepStrictEqual(calls(F, from), [`POST file(${RERP}/P1.json)/recycle()`]);
    assert.strictEqual(F.file(RERP, 'P1.json'), undefined);
    assert.deepStrictEqual(await w.remove('P1.json'), { removed: false });
    await w.close();
  });

  await test('writer.ensureFolder: 있으면 created:false(Folders/add 없음) · 없으면 부모의 Folders/add(이름) · 부모도 없으면 nofolder · 한글 폴더 이름', async () => {
    const F = fakeSp({ folders: [RERP] });
    const w = await SP.openWriter(CFG, { chrome: fakeChrome(F.fetch) });
    const from = F.st.calls.length;
    assert.deepStrictEqual(await w.ensureFolder(), { created: false });
    assert.deepStrictEqual(calls(F, from), [`GET folder(${RERP})?$select=Exists`]);
    await w.close();
    const G = fakeSp({ folders: [ME_PATH] });
    const w2 = await SP.openWriter(CFG, { chrome: fakeChrome(G.fetch) });
    const from2 = G.st.calls.length;
    assert.deepStrictEqual(await w2.ensureFolder(), { created: true });
    assert.deepStrictEqual(calls(G, from2), [`GET folder(${RERP})?$select=Exists`, `GET folder(${ME_PATH})?$select=Exists`, `POST folder(${ME_PATH})/Folders/add('RERP')`]);
    assert.ok(G.st.folders[RERP], '폴더가 생김');
    assert.deepStrictEqual(await w2.ensureFolder(), { created: false });
    await w2.close();
    const H = fakeSp();   // 부모(Documents)도 없음
    const w3 = await SP.openWriter(CFG, { chrome: fakeChrome(H.fetch) });
    await rejects(w3.ensureFolder(), 'nofolder', /상위 폴더가 없습니다/);
    await w3.close();
    const K = fakeSp({ folders: ['/sites/AIP/Shared Documents'] });
    const kcfg = SP.parseFolder("https://krclass.sharepoint.com/sites/AIP/Shared Documents/공유 자료's");
    const w4 = await SP.openWriter(kcfg, { chrome: fakeChrome(K.fetch) });
    assert.deepStrictEqual(await w4.ensureFolder(), { created: true });
    assert.ok(K.st.folders["/sites/AIP/Shared Documents/공유 자료's"], '한글·따옴표 이름이 디코딩돼 생김');
    assert.ok(calls(K).includes(`POST folder(/sites/AIP/Shared Documents)/Folders/add('${encodeURIComponent('공유 자료')}''s')`), '리터럴은 encodeURIComponent 뒤 \' → \'\'');
    await w4.close();
  });

  await test('listFolders: 하위 폴더 모양(name · path · itemCount · modified) · 문서함 뿌리의 Forms 는 뺌(아래 단의 Forms 는 둠) · 404 → nofolder · 빈 폴더는 Exists 로 가름 · 로그인 화면 → auth · 캐시 cfg · ServerRelativeUrl 없으면 folderPath/이름', async () => {
    const F = fakeSp({ folders: [ME_PATH, `${ME_PATH}/Forms`, `${ME_PATH}/업무`, `${ME_PATH}/업무/shared`, `${ME_PATH}/업무/shared/과제A`, `${ME_PATH}/업무/shared/과제A/Forms`, `${ME_PATH}/업무/shared/B-2026-0001`], files: { [`${ME_PATH}/업무/shared/과제A`]: { '1차년도.json': '{}', '2차년도.json': '{}' } } });
    const root = SP.parseFolder(`${ORIGIN}${ME_PATH}`);
    assert.strictEqual(root.libPath, ME_PATH);
    assert.deepStrictEqual(await SP.listFolders(root, { fetch: F.fetch }), [{ name: '업무', path: `${ME_PATH}/업무`, itemCount: 1, modified: '2026-10-18T03:04:05Z' }]);
    assert.deepStrictEqual(calls(F), [`GET folder(${ME_PATH})/Folders?$select=Name,ServerRelativeUrl,ItemCount,TimeLastModified`]);
    const base = SP.childCfg(root, '업무/shared');
    const list = await SP.listFolders(base, { fetch: F.fetch });
    assert.deepStrictEqual(list.map((f) => [f.name, f.path, f.itemCount]), [['과제A', `${ME_PATH}/업무/shared/과제A`, 3], ['B-2026-0001', `${ME_PATH}/업무/shared/B-2026-0001`, 0]]);
    assert.deepStrictEqual((await SP.listFolders(SP.childCfg(base, '과제A'), { fetch: F.fetch })).map((f) => f.name), ['Forms'], '뿌리가 아닌 곳의 Forms 는 그대로');
    const e = await rejects(SP.listFolders(SP.childCfg(base, '없음'), { fetch: F.fetch }), 'nofolder', /공유 폴더가 없습니다/);
    assert.strictEqual(e.path, `${ME_PATH}/업무/shared/없음`);
    const empty = SP.childCfg(base, 'B-2026-0001');
    const from = F.st.calls.length;
    assert.deepStrictEqual(await SP.listFolders(empty, { fetch: F.fetch }), []);
    assert.deepStrictEqual(calls(F, from), [`GET folder(${empty.folderPath})/Folders?$select=Name,ServerRelativeUrl,ItemCount,TimeLastModified`, `GET folder(${empty.folderPath})?$select=Exists`]);
    const fetch2 = async (u, i) => (String(u).includes('/Folders?') ? { ok: true, status: 200, url: '', json: async () => ({ value: [] }) } : F.fetch(u, i));   // 200 + 빈 목록 뒤 Exists:false
    await rejects(SP.listFolders(SP.childCfg(base, '없음'), { fetch: fetch2 }), 'nofolder');
    await rejects(SP.listFolders(base, { fetch: fakeSp({ loggedIn: false }).fetch }), 'auth', /로그인 화면/);
    await rejects(SP.listFolders(base, { fetch: async () => ({ ok: true, status: 200, url: '', json: async () => 'x' }) }), 'http', /JSON/);
    assert.strictEqual((await SP.listFolders(JSON.parse(JSON.stringify(base)), { fetch: F.fetch })).length, 2, '캐시 cfg 도 받음');
    const r = await SP.listFolders(base, { fetch: async () => ({ ok: true, status: 200, url: '', json: async () => ({ value: [{ Name: 'X' }] }) }) });
    assert.deepStrictEqual(r, [{ name: 'X', path: `${base.folderPath}/X`, itemCount: 0, modified: '' }]);
  });

  await test('childCfg: 하위 폴더 cfg — 같은 사이트 · folderPath/api/viewUrl · mine 상속 · url 은 폴더 주소(parseFolder 왕복) · 여러 단 · libPath 그대로 · 금지 글자·빈 이름 badurl · 캐시 cfg 도 받음', () => {
    const mine = Object.assign(SP.parseFolder(`${ORIGIN}${ME_PATH}/업무/shared`), { mine: true });
    const c = SP.childCfg(mine, '과제A');
    assert.strictEqual(c.folderPath, `${ME_PATH}/업무/shared/과제A`);
    assert.strictEqual(c.siteUrl, mine.siteUrl); assert.strictEqual(c.api, mine.api); assert.strictEqual(c.libPath, ME_PATH); assert.strictEqual(c.name, '과제A'); assert.strictEqual(c.personal, true);
    assert.strictEqual(c.mine, true);
    assert.strictEqual(c.url, SP.folderUrl(c)); assert.strictEqual(SP.parseFolder(c.url).folderPath, c.folderPath);
    assert.strictEqual(c.viewUrl, `${mine.siteUrl}/_layouts/15/onedrive.aspx?id=${encodeURIComponent(c.folderPath)}`);
    assert.strictEqual(c.fileApi('1차년도.json'), `${mine.api}/GetFileByServerRelativePath(decodedurl='${encodeURIComponent(`${c.folderPath}/1차년도.json`)}')`);
    assert.strictEqual(c.fileUrl('예상비용.json'), `${ORIGIN}${ME_PATH}/${encodeURIComponent('업무')}/shared/${encodeURIComponent('과제A')}/${encodeURIComponent('예상비용.json')}`);
    const two = SP.childCfg(SP.parseFolder(`${ORIGIN}${ME_PATH}`), '업무/shared');
    assert.strictEqual(two.folderPath, `${ME_PATH}/업무/shared`); assert.strictEqual(two.mine, false);
    const team = SP.childCfg(SP.parseFolder('https://krclass.sharepoint.com/sites/AIP/Shared Documents/공유'), "RERP's #1");
    assert.strictEqual(team.folderPath, "/sites/AIP/Shared Documents/공유/RERP's #1"); assert.strictEqual(team.libPath, '/sites/AIP/Shared Documents');
    assert.ok(team.viewUrl.includes('/Forms/AllItems.aspx?id='));
    assert.strictEqual(SP.parseFolder(team.url).folderPath, team.folderPath, "# 과 ' 도 왕복");
    throws(() => SP.childCfg(mine, ''), 'badurl', /비어/); throws(() => SP.childCfg(mine, '/'), 'badurl'); throws(() => SP.childCfg(mine, 'a:b'), 'badurl', /글자/); throws(() => SP.childCfg(mine, '..'), 'badurl');
    assert.strictEqual(SP.childCfg(JSON.parse(JSON.stringify(mine)), 'X').folderPath, `${ME_PATH}/업무/shared/X`);
    assert.strictEqual(SP.revive(JSON.parse(JSON.stringify(c))).libPath, ME_PATH, '캐시에서 되살려도 libPath');
  });

  await test('writer.ensurePath / ensureFolder(path): 여러 단(업무/shared 둘 다 없으면 위로 올라가 있는 단을 찾고 아래로 add) · 한 단 · 문서함 뿌리가 없으면 nofolder(뿌리 위로는 안 올라감) · 인수 없으면 writer 폴더 · 다른 사이트·상대 경로 badurl · 다이제스트 만료 중간에도 끝까지', async () => {
    const base = SP.parseFolder(`${ORIGIN}${ME_PATH}/업무/shared`);
    const F = fakeSp({ folders: [ME_PATH] });
    const w = await SP.openWriter(base, { chrome: fakeChrome(F.fetch) });
    const from = F.st.calls.length;
    assert.deepStrictEqual(await w.ensurePath(), { created: true, made: [`${ME_PATH}/업무`, `${ME_PATH}/업무/shared`] });
    assert.deepStrictEqual(calls(F, from), [
      `GET folder(${ME_PATH}/업무/shared)?$select=Exists`, `GET folder(${ME_PATH}/업무)?$select=Exists`, `GET folder(${ME_PATH})?$select=Exists`,
      `POST folder(${ME_PATH})/Folders/add('${encodeURIComponent('업무')}')`, `POST folder(${ME_PATH}/업무)/Folders/add('shared')`
    ]);
    assert.ok(F.st.folders[`${ME_PATH}/업무/shared`]);
    assert.deepStrictEqual(await w.ensurePath(), { created: false, made: [] });
    assert.deepStrictEqual(await w.ensurePath(`${ME_PATH}/업무/shared/과제A`), { created: true, made: [`${ME_PATH}/업무/shared/과제A`] });
    assert.deepStrictEqual(await w.ensureFolder(SP.childCfg(base, 'B-2026-0001')), { created: true });
    assert.deepStrictEqual(await w.ensureFolder(SP.childCfg(base, 'B-2026-0001')), { created: false });
    assert.deepStrictEqual(await w.ensureFolder(`${ME_PATH}/업무/shared/과제A/`), { created: false }, '끝 / 는 떼고');
    assert.ok(F.st.folders[`${ME_PATH}/업무/shared/B-2026-0001`]);
    await rejects(w.ensurePath('/personal/other_krs_co_kr/Documents/업무/shared'), 'badurl', /사이트.*밖/);
    await rejects(w.ensurePath(SP.parseFolder('https://krclass.sharepoint.com/sites/AIP/Shared Documents/x')), 'badurl', /밖/);
    await rejects(w.ensurePath('relative/path'), 'badurl', /서버 상대/);
    await rejects(w.ensurePath(`${ME_PATH}/a<b`), 'badurl', /글자/);
    await w.close();
    // 문서함 뿌리(Documents)가 없으면 nofolder — 사이트 뿌리에 만들려 하지 않는다
    const G = fakeSp();
    const w2 = await SP.openWriter(base, { chrome: fakeChrome(G.fetch) });
    await rejects(w2.ensurePath(), 'nofolder', new RegExp(`상위 폴더가 없습니다: ${ME_PATH}$`));
    assert.ok(!calls(G).some((c) => c.startsWith('POST folder(')), '만들기 시도 없음');
    assert.ok(!calls(G).includes('GET folder(/personal/kimghw_krs_co_kr)?$select=Exists'), '사이트 뿌리는 보지 않음');
    await w2.close();
    // 둘째 단을 만드는 사이에 다이제스트가 만료돼도 새로 받아 이어 만든다(이미 만든 단은 Exists 로 건너뜀)
    const K = fakeSp({ folders: [ME_PATH] });
    let armed = true;
    const C = fakeChrome(async (u, i) => { const r = await K.fetch(u, i); if (armed && /Folders\/add/.test(String(u))) { armed = false; K.expire(); } return r; });
    const w3 = await SP.openWriter(base, { chrome: C });
    const r3 = await w3.ensurePath();
    assert.deepStrictEqual([r3.created, K.st.digestIssued, !!K.st.folders[`${ME_PATH}/업무/shared`]], [true, 2, true]);
    assert.strictEqual(calls(K).filter((c) => c.includes('Folders/add')).length, 3, '업무(성공) · shared(403 거부) · shared(다시)');
    await w3.close();
    // 팀 사이트: 문서함 뿌리 Shared Documents 아래 두 단
    const T = fakeSp({ folders: ['/sites/AIP/Shared Documents'] });
    const tcfg = SP.parseFolder('https://krclass.sharepoint.com/sites/AIP/Shared Documents/RERP/shared');
    const w4 = await SP.openWriter(tcfg, { chrome: fakeChrome(T.fetch) });
    assert.deepStrictEqual(await w4.ensurePath(), { created: true, made: ['/sites/AIP/Shared Documents/RERP', '/sites/AIP/Shared Documents/RERP/shared'] });
    await w4.close();
  });

  await test('sharedWithMe: @odata.nextLink 2쪽을 끝까지 · 폴더/파일 flag · 폴더 주소(remoteItem.webUrl 우선)가 풀리면 cfg(주인의 personal 사이트) · 공유 링크 모양·파일·다른 호스트는 cfg 없이 · ownerName · 404 → [] · 403/로그인 화면 → auth · maxPages · 다른 호스트 nextLink 는 안 따라감', async () => {
    const other = `${ORIGIN}/personal/moon_krs_co_kr/Documents/${encodeURIComponent('업무')}/shared`;
    const pages = [
      { value: [
        { name: '과제A', folder: { childCount: 2 }, webUrl: `${ORIGIN}/:f:/g/personal/moon_krs_co_kr/EabcA?e=1`, remoteItem: { name: '과제A', folder: { childCount: 2 }, webUrl: `${other}/${encodeURIComponent('과제A')}`, shared: { owner: { user: { displayName: '문창재' } } }, parentReference: { driveId: 'b!m' } } },
        { name: '보고서.docx', file: { mimeType: 'x' }, webUrl: `${ORIGIN}/:w:/g/personal/moon_krs_co_kr/Edoc`, remoteItem: { file: {}, webUrl: `${other}/${encodeURIComponent('보고서.docx')}`, createdBy: { user: { displayName: '문창재' } } } },
        { name: 'shared', folder: {}, remoteItem: { folder: {}, webUrl: other, shared: { owner: { user: { displayName: '문창재' } } } } }
      ] },
      { value: [
        { name: '링크만', folder: {}, webUrl: `${ORIGIN}/:f:/g/personal/x_krs_co_kr/Eonly?e=2` },   // remoteItem 없음 — 공유 링크 모양이라 cfg 없음
        { name: '팀 폴더', folder: {}, remoteItem: { folder: {}, webUrl: 'https://krclass.sharepoint.com/sites/AIP/Shared%20Documents/RERP', createdBy: { user: { displayName: '팀' } } } },
        { name: '다른 호스트', folder: {}, remoteItem: { folder: {}, webUrl: 'https://example.com/x/y' } },
        null, 'junk'
      ] }
    ];
    const F = fakeSp({ shared: pages });
    const list = await SP.sharedWithMe({ fetch: F.fetch }, { driveHost: ORIGIN });
    assert.deepStrictEqual(calls(F), ['GET sharedWithMe#0', 'GET sharedWithMe#1']);
    assert.deepStrictEqual(list.map((x) => [x.name, x.folder, x.ownerName, !!x.cfg]), [['과제A', true, '문창재', true], ['보고서.docx', false, '문창재', false], ['shared', true, '문창재', true], ['링크만', true, '', false], ['팀 폴더', true, '팀', true], ['다른 호스트', true, '', false]]);
    assert.strictEqual(list[0].webUrl, `${other}/${encodeURIComponent('과제A')}`, 'remoteItem.webUrl 우선');
    assert.strictEqual(list[0].cfg.folderPath, '/personal/moon_krs_co_kr/Documents/업무/shared/과제A');
    assert.strictEqual(list[0].cfg.siteUrl, `${ORIGIN}/personal/moon_krs_co_kr`, '주인의 personal 사이트 — writer 는 사이트마다');
    assert.strictEqual(list[0].cfg.mine, false);
    assert.strictEqual(list[2].cfg.folderPath, '/personal/moon_krs_co_kr/Documents/업무/shared');
    assert.strictEqual(list[4].cfg.folderPath, '/sites/AIP/Shared Documents/RERP');
    assert.strictEqual(list[3].webUrl, `${ORIGIN}/:f:/g/personal/x_krs_co_kr/Eonly?e=2`);
    assert.deepStrictEqual(Object.keys(list[1]), ['name', 'webUrl', 'folder', 'ownerName'], '파일은 cfg 칸 없음');
    const G = fakeSp({ shared: pages });
    assert.strictEqual((await SP.sharedWithMe({ fetch: G.fetch }, { driveHost: ORIGIN, maxPages: 1 })).length, 3);
    assert.deepStrictEqual(calls(G), ['GET sharedWithMe#0']);
    assert.deepStrictEqual(await SP.sharedWithMe({ fetch: fakeSp().fetch }), [], '기본 driveHost · 빈 목록');
    assert.deepStrictEqual(await SP.sharedWithMe({ fetch: fakeSp({ noShared: true }).fetch }), [], '끝점 없음(404)은 빈 목록');
    await rejects(SP.sharedWithMe({ fetch: fakeSp({ deny403: true }).fetch }), 'auth');
    await rejects(SP.sharedWithMe({ fetch: fakeSp({ loggedIn: false }).fetch }), 'auth', /로그인 화면/);
    await rejects(SP.sharedWithMe({ fetch: async () => { throw new Error('down'); } }), 'offline');
    await rejects(SP.sharedWithMe({ fetch: async () => ({ ok: true, status: 200, url: '', json: async () => ({ x: 1 }) }) }), 'http', /JSON/);
    await rejects(SP.sharedWithMe({ fetch: async () => ({ ok: false, status: 500, url: '', json: async () => ({}) }) }), 'http');
    await rejects(SP.sharedWithMe({ fetch: F.fetch }, { driveHost: 'nope' }), 'badurl');
    let n = 0;
    const far = async () => ({ ok: true, status: 200, url: '', json: async () => (n++ === 0 ? { value: [], '@odata.nextLink': 'https://evil.example/next' } : { value: [{ name: 'x' }] }) });
    assert.deepStrictEqual(await SP.sharedWithMe({ fetch: far }), []); assert.strictEqual(n, 1);
    // 상대 경로 nextLink 도 같은 호스트로
    let seen = [];
    const rel = async (u) => { seen.push(String(u)); return { ok: true, status: 200, url: '', json: async () => (seen.length === 1 ? { value: [], '@odata.nextLink': '/_api/v2.0/me/drive/sharedWithMe?$skiptoken=z' } : { value: [] }) }; };
    await SP.sharedWithMe({ fetch: rel });
    assert.deepStrictEqual(seen, [`${SP.DEFAULT_DRIVE_HOST}/_api/v2.0/me/drive/sharedWithMe`, `${SP.DEFAULT_DRIVE_HOST}/_api/v2.0/me/drive/sharedWithMe?$skiptoken=z`]);
  });

  await test('writer.sharePeople: 이름마다 피커 검색(표시 이름이 꼭 같은(공백 무시) 1명 → 그 사람 · 1명이어도 이름이 다르면(접두 일치) ambiguous · 여럿(비슷한 이름·동명이인) → ambiguous · 0명 → notFound) → 모인 사람을 ShareObject 한 번에(odata=verbose · 다이제스트 · roleValue · peoplePickerInput 은 피커 항목 JSON 문자열 · url 은 폴더 절대 주소 · sendEmail:false)', async () => {
    const base = SP.parseFolder(`${ORIGIN}${ME_PATH}/업무/shared`);
    const folder = `${ME_PATH}/업무/shared/과제A`;
    const F = fakeSp({ folders: [folder], people: PEOPLE });
    const w = await SP.openWriter(base, { chrome: fakeChrome(F.fetch) });
    const from = F.st.calls.length;
    const r = await w.sharePeople(folder, ['문창재', '김철수', ' 이영희 ', '박보람', '없는사람', '문창재', '', null]);
    assert.deepStrictEqual(r, {
      shared: [{ name: '문창재', email: 'moon@krs.co.kr' }, { name: '김철수', email: 'kim1@krs.co.kr' }],
      ambiguous: [{ name: '이영희', candidates: ['이영희 (연구)', '이영희 (기획)'] }, { name: '박보람', candidates: ['박보람', '박보람'] }],
      notFound: ['없는사람'], failed: []
    });
    assert.deepStrictEqual(calls(F, from), ['POST peoplePicker', 'POST peoplePicker', 'POST peoplePicker', 'POST peoplePicker', 'POST peoplePicker', 'POST ShareObject'], '이름 5개(중복·빈 것 제외) 검색 뒤 공유 한 번');
    assert.deepStrictEqual(F.st.pickerBodies.map((p) => p.body.queryParams.QueryString), ['문창재', '김철수', '이영희', '박보람', '없는사람']);
    assert.deepStrictEqual(F.st.pickerBodies[0].body, { queryParams: { AllowEmailAddresses: true, AllowMultipleEntities: false, AllUrlZones: false, MaximumEntitySuggestions: 10, PrincipalSource: 15, PrincipalType: 1, QueryString: '문창재' } });
    assert.strictEqual(F.st.pickerBodies[0].headers['Content-Type'], 'application/json;odata=verbose');
    assert.strictEqual(F.st.shareBodies.length, 1);
    const s = F.st.shareBodies[0];
    assert.strictEqual(s.headers.Accept, 'application/json;odata=verbose'); assert.strictEqual(s.headers['Content-Type'], 'application/json;odata=verbose');
    assert.ok(F.st.validDigests.has(s.headers['X-RequestDigest']), '다이제스트를 실음');
    assert.strictEqual(s.body.url, `${ORIGIN}${folder}`, '폴더 절대 주소(디코딩)');
    assert.strictEqual(s.body.roleValue, 'role:1073741827'); assert.strictEqual(SP.ROLE_EDIT, 'role:1073741827'); assert.strictEqual(SP.ROLE_READ, 'role:1073741826');
    assert.strictEqual(typeof s.body.peoplePickerInput, 'string', 'JSON 문자열');
    assert.deepStrictEqual(JSON.parse(s.body.peoplePickerInput).map((e) => [e.Key, e.DisplayText, e.EntityData.Email]), [['i:0#.f|membership|KEY-SECRET-moon@krs.co.kr', '문창재', 'moon@krs.co.kr'], ['i:0#.f|membership|KEY-SECRET-kim1@krs.co.kr', '김철수', 'kim1@krs.co.kr']], '피커 결과 항목 그대로(Key 포함)');
    assert.deepStrictEqual([s.body.groupId, s.body.propagateAcl, s.body.sendEmail, s.body.includeAnonymousLinkInEmail, s.body.emailSubject, s.body.emailBody], [0, false, false, false, '', '']);
    assert.deepStrictEqual(F.st.shares, [{ url: `${ORIGIN}${folder}`, roleValue: 'role:1073741827', emails: ['moon@krs.co.kr', 'kim1@krs.co.kr'] }]);
    // 읽기 역할 · cfg 인수 · 문자열 하나 · 비면 writer 폴더
    const r2 = await w.sharePeople(SP.childCfg(base, '과제A'), '문창재', { role: 'read' });
    assert.deepStrictEqual(r2.shared, [{ name: '문창재', email: 'moon@krs.co.kr' }]);
    assert.strictEqual(F.st.shareBodies[1].body.roleValue, 'role:1073741826');
    const r3 = await w.sharePeople(null, ['문창재']);
    assert.strictEqual(F.st.shareBodies[2].body.url, `${ORIGIN}${ME_PATH}/업무/shared`);
    assert.strictEqual(r3.shared.length, 1);
    // 빈 이름 → 호출 없이 빈 결과 · 공유할 사람이 없으면 ShareObject 없음
    const from2 = F.st.calls.length;
    assert.deepStrictEqual(await w.sharePeople(folder, []), { shared: [], ambiguous: [], notFound: [], failed: [] });
    assert.deepStrictEqual(await w.sharePeople(folder, [' ', null]), { shared: [], ambiguous: [], notFound: [], failed: [] });
    assert.deepStrictEqual(await w.sharePeople(folder), { shared: [], ambiguous: [], notFound: [], failed: [] });
    assert.strictEqual(calls(F, from2).length, 0);
    const r4 = await w.sharePeople(folder, ['없는사람', '이영희']);
    assert.deepStrictEqual([r4.shared, r4.notFound, r4.ambiguous.length], [[], ['없는사람'], 1]);
    assert.ok(!calls(F, from2).includes('POST ShareObject'), '공유할 사람이 없으면 ShareObject 안 부름');
    // 1명이 왔어도 표시 이름이 질문한 이름과 다르면(ERP 참여인력 '이영' 이 디렉터리에 없어 접두 일치 '이영희' 한 사람) 그 사람에게 주지 않고 ambiguous — 자동 공유는 사람이 보지 않고 돈다
    const from3 = F.st.calls.length;
    const r5 = await w.sharePeople(folder, ['이영']);
    assert.deepStrictEqual(r5, { shared: [], ambiguous: [{ name: '이영', candidates: ['이영희'] }], notFound: [], failed: [] });
    assert.ok(!calls(F, from3).includes('POST ShareObject'));
    const r6 = await w.sharePeople(folder, ['홍길동']);
    assert.deepStrictEqual(r6.shared, [{ name: '홍 길동', email: 'hong@krs.co.kr' }], '공백만 다른 표시 이름은 같은 이름');
    await rejects(w.sharePeople('/personal/moon_krs_co_kr/Documents/업무/shared/과제A', ['문창재']), 'badurl', /밖/);
    await w.close();
  });

  await test('writer.at(cfg|경로): 같은 사이트의 다른 폴더에 묶인 writer — 같은 작업 창·다이제스트(창 하나 · contextinfo 한 번), modify/write/remove/ensurePath/sharePeople 의 폴더가 그 폴더, close 는 no-op(원래 writer 의 close 가 창을 닫음) · 사이트 밖은 badurl', async () => {
    const base = SP.parseFolder(`${ORIGIN}${BASE}`);
    const A = `${BASE}/과제A`, B = `${BASE}/과제B`;
    const F = fakeSp({ folders: [BASE, A], people: PEOPLE });
    const C = fakeChrome(F.fetch);
    const w = await SP.openWriter(base, { chrome: C });
    const a = w.at(SP.childCfg(base, '과제A'));
    assert.deepStrictEqual([a.folderPath, a.tabId, a.windowId, typeof a.at, typeof a.modify, typeof a.close], [A, w.tabId, w.windowId, 'function', 'function', 'function']);
    const from = F.st.calls.length;
    const r = await a.modify('1차년도.json', (cur) => ({ changed: true, text: `{"v":2,"kind":"year","cur":${JSON.stringify(cur)}}` }));
    assert.deepStrictEqual([r.created, F.file(A, '1차년도.json').text, F.file(BASE, '1차년도.json')], [true, '{"v":2,"kind":"year","cur":null}', undefined], '과제A 폴더에 만듦(base 가 아님)');
    assert.deepStrictEqual(calls(F, from), [`GET file(${A}/1차년도.json)?$select=Exists,CheckOutType,UniqueId,UIVersionLabel,Length,TimeLastModified`, `POST folder(${A})/Files/add(url='${encodeURIComponent('1차년도.json')}',overwrite=false)`]);
    await a.write('예상비용.json', '{"v":2,"kind":"plan"}');
    assert.strictEqual(F.file(A, '예상비용.json').text, '{"v":2,"kind":"plan"}');
    assert.strictEqual((await a.remove('예상비용.json')).removed, true); assert.strictEqual(F.file(A, '예상비용.json'), undefined);
    // 경로 문자열로도 · 없는 폴더는 ensurePath()(인수 없음 = 그 폴더) 로
    const b = w.at(B);
    assert.strictEqual(b.folderPath, B);
    assert.deepStrictEqual(await b.ensurePath(), { created: true, made: [B] });
    assert.ok(F.st.folders[B]);
    assert.deepStrictEqual(await b.ensurePath(), { created: false, made: [] }, '이미 있으면 created:false');
    await b.write('1차년도.json', '{"v":2}');
    assert.strictEqual(F.file(B, '1차년도.json').text, '{"v":2}');
    // sharePeople 의 기본 폴더도 그 폴더
    const s = await a.sharePeople(null, ['문창재']);
    assert.deepStrictEqual([s.shared.length, F.st.shareBodies[F.st.shareBodies.length - 1].body.url], [1, `${ORIGIN}${A}`]);
    // 창 하나 · 다이제스트 한 번 · 하위 writer 의 close 는 창을 두고, 원래 writer 가 닫는다
    assert.deepStrictEqual([C.log.filter((l) => l[0] === 'create').length, F.st.digestIssued, Object.keys(C.windows_).length], [1, 1, 1]);
    await a.close(); await b.close();
    assert.strictEqual(Object.keys(C.windows_).length, 1, '하위 writer 의 close 는 no-op');
    assert.strictEqual((await a.write('2차년도.json', '{"v":2}')).created, true, '닫은 뒤에도(원래 writer 가 살아 있으면) 쓸 수 있다');
    // 사이트 밖 → badurl(다른 personal 사이트 · 다른 origin)
    throws(() => w.at('/personal/moon_krs_co_kr/Documents/업무/shared/과제A'), 'badurl', /밖/);
    throws(() => w.at(SP.parseFolder('https://krclass.sharepoint.com/sites/AIP/Shared Documents/x')), 'badurl', /밖/);
    throws(() => a.at(SP.parseFolder('https://krclass.sharepoint.com/sites/AIP/Shared Documents/x')), 'badurl', /밖/);
    await w.close();
    assert.strictEqual(Object.keys(C.windows_).length, 0, '원래 writer 의 close 가 창을 닫음');
  });

  await test('writer.sharePeople: ShareObject 가 StatusCode ≠ 0 이면 한 명씩 다시 돌려 안 되는 사람만 failed(+error 요지) · HTTP 500 도 같은 길(본문 요지) · 피커 403 → auth · 다이제스트 만료는 다시 받아 한 번 더 · nometadata 응답(value)도 읽음', async () => {
    const base = SP.parseFolder(`${ORIGIN}${ME_PATH}/업무/shared`);
    const folder = `${ME_PATH}/업무/shared/과제A`;
    const F = fakeSp({ folders: [folder], people: PEOPLE, shareFailEmails: ['kim1@krs.co.kr'] });
    const w = await SP.openWriter(base, { chrome: fakeChrome(F.fetch) });
    const from = F.st.calls.length;
    const r = await w.sharePeople(folder, ['문창재', '김철수']);
    assert.deepStrictEqual(r.shared, [{ name: '문창재', email: 'moon@krs.co.kr' }]);
    assert.deepStrictEqual(r.failed, [{ name: '김철수', email: 'kim1@krs.co.kr', error: '공유 실패(StatusCode 1): 초대할 수 없는 사용자: kim1@krs.co.kr' }]);
    assert.ok(/^김철수: 공유 실패\(StatusCode 1\)/.test(r.error), r.error);
    assert.deepStrictEqual(r.ambiguous, []); assert.deepStrictEqual(r.notFound, []);
    assert.strictEqual(calls(F, from).filter((c) => c === 'POST ShareObject').length, 3, '한 번에(실패) → 한 명씩 둘');
    assert.deepStrictEqual(F.st.shares.map((s) => s.emails), [['moon@krs.co.kr']]);
    const from2 = F.st.calls.length;
    const r2 = await w.sharePeople(folder, ['김철수']);
    assert.deepStrictEqual([r2.shared, r2.failed.length, calls(F, from2).filter((c) => c === 'POST ShareObject').length], [[], 1, 1], '한 명만 실패 — 다시 돌 것 없음');
    await w.close();
    const G = fakeSp({ folders: [folder], people: PEOPLE, shareHttp: 500 });
    const w2 = await SP.openWriter(base, { chrome: fakeChrome(G.fetch) });
    const r3 = await w2.sharePeople(folder, ['문창재']);
    assert.deepStrictEqual([r3.shared, r3.failed.length], [[], 1]);
    assert.ok(/^공유 500: .*ShareObject boom/.test(r3.failed[0].error), r3.failed[0].error);
    assert.strictEqual(r3.error, `문창재: ${r3.failed[0].error}`);
    await w2.close();
    const K = fakeSp({ folders: [folder], people: PEOPLE });
    const w3 = await SP.openWriter(base, { chrome: fakeChrome(K.fetch) });
    K.expire();
    const r4 = await w3.sharePeople(folder, ['문창재']);
    assert.deepStrictEqual([r4.shared.length, K.st.digestIssued], [1, 2], '피커 403 security validation → 새 다이제스트로 다시');
    await w3.close();
    const D = fakeSp({ folders: [folder], people: PEOPLE });
    const w4 = await SP.openWriter(base, { chrome: fakeChrome(async (u, i) => (String(u).endsWith('clientPeoplePickerSearchUser') ? { ok: false, status: 403, url: '', json: async () => ({}), text: async () => 'Access denied' } : D.fetch(u, i))) });
    await rejects(w4.sharePeople(folder, ['문창재']), 'auth');
    await w4.close();
    const N = fakeSp({ folders: [folder], people: PEOPLE });
    const w5 = await SP.openWriter(base, { chrome: fakeChrome(async (u, i) => { if (/clientPeoplePickerSearchUser$|SP\.Web\.ShareObject$/.test(String(u))) i = Object.assign({}, i, { headers: Object.assign({}, i.headers, { Accept: 'application/json;odata=nometadata' }) }); return N.fetch(u, i); }) });
    const r5 = await w5.sharePeople(folder, ['문창재']);
    assert.deepStrictEqual(r5.shared, [{ name: '문창재', email: 'moon@krs.co.kr' }]);
    await w5.close();
  });

  await test('writer.orgLink: ListItemAllFields(Id·ParentList/Id) → Lists(guid)/GetItemById/ShareLink(createLink · linkKind 3 편집 / 2 보기 · expiration null) → sharingLinkInfo.Url · 안 되면 SP.Web.CreateOrganizationSharingLink(url, isEditLink) · 둘 다 안 되면 http 에 본문 요지 · 폴더 없으면 ShareLink 건너뜀 · 다이제스트 만료', async () => {
    const base = SP.parseFolder(`${ORIGIN}${ME_PATH}/업무/shared`);
    const folder = `${ME_PATH}/업무/shared/과제A`;
    const F = fakeSp({ folders: [`${ME_PATH}/업무/shared`, folder] });
    const w = await SP.openWriter(base, { chrome: fakeChrome(F.fetch) });
    const from = F.st.calls.length;
    const r = await w.orgLink(folder);
    assert.deepStrictEqual(r, { url: `${ORIGIN}/:f:/g/personal/kimghw_krs_co_kr/EOrgLink3?e=abc`, edit: true, via: 'ShareLink' });
    assert.deepStrictEqual(calls(F, from), [`GET folder(${folder})/ListItemAllFields?$select=Id,ParentList/Id&$expand=ParentList`, 'POST ShareLink(aaaabbbb-0000-0000-0000-000000000001,42)']);
    assert.deepStrictEqual(F.st.linkBodies[0].body, { request: { createLink: true, settings: { linkKind: 3, expiration: null } } });
    assert.ok(F.st.validDigests.has(F.st.linkBodies[0].headers['X-RequestDigest']));
    const v = await w.orgLink(SP.childCfg(base, '과제A'), { edit: false });
    assert.deepStrictEqual([v.url.includes('EOrgLink2'), v.edit, v.via], [true, false, 'ShareLink']);
    assert.strictEqual((await w.orgLink()).via, 'ShareLink', '인수 없으면 writer 폴더');
    await rejects(w.orgLink('/sites/AIP/Shared Documents/x'), 'badurl', /밖/);
    await w.close();
    const G = fakeSp({ folders: [folder], noShareLink: true });
    const w2 = await SP.openWriter(base, { chrome: fakeChrome(G.fetch) });
    const r2 = await w2.orgLink(folder);
    assert.deepStrictEqual(r2, { url: `${ORIGIN}/:f:/g/personal/kimghw_krs_co_kr/EFallback?e=edit`, edit: true, via: 'CreateOrganizationSharingLink' });
    assert.deepStrictEqual(G.st.linkBodies.map((l) => l.at), ['ShareLink', 'CreateOrganizationSharingLink']);
    assert.deepStrictEqual(G.st.linkBodies[1].body, { url: `${ORIGIN}${folder}`, isEditLink: true });
    assert.strictEqual((await w2.orgLink(folder, { edit: false })).url, `${ORIGIN}/:f:/g/personal/kimghw_krs_co_kr/EFallback?e=view`);
    await w2.close();
    const H = fakeSp({ folders: [folder], noShareLink: true, noOrgLink: true });
    const w3 = await SP.openWriter(base, { chrome: fakeChrome(H.fetch) });
    const e = await rejects(w3.orgLink(folder), 'http', /ShareLink 400: .*not supported.*CreateOrganizationSharingLink 400: .*disabled by policy/);
    assert.strictEqual(e.status, 400);
    await w3.close();
    const K = fakeSp({ folders: [folder], noOrgLink: true });
    const w4 = await SP.openWriter(base, { chrome: fakeChrome(K.fetch) });
    await rejects(w4.orgLink(`${ME_PATH}/업무/shared/없음`), 'http', /항목 정보 404/);
    assert.ok(!calls(K).some((c) => c.startsWith('POST ShareLink')), 'ShareLink 시도 없음');
    await w4.close();
    const D = fakeSp({ folders: [folder] });
    const w5 = await SP.openWriter(base, { chrome: fakeChrome(D.fetch) });
    D.expire();
    assert.strictEqual((await w5.orgLink(folder)).via, 'ShareLink'); assert.strictEqual(D.st.digestIssued, 2);
    await w5.close();
  });

  await test('writer.rename: MoveTo(newUrl=<부모>/<새 이름>) 로 폴더(하위·파일까지) 이름 바꾸기 → { path, name, changed, url } · 같은 이름이면 호출 없이 changed:false · 새 이름이 이미 있으면 http("이미 있습니다") · 없는 폴더 notfound · MoveTo 404 면 MoveToUsingPath · 금지 글자·문서함 뿌리·다른 사이트 badurl', async () => {
    const base = SP.parseFolder(`${ORIGIN}${ME_PATH}/업무/shared`);
    const F = fakeSp({ folders: [`${ME_PATH}/업무/shared`, `${ME_PATH}/업무/shared/2026-0063-01`, `${ME_PATH}/업무/shared/2026-0063-01/sub`, `${ME_PATH}/업무/shared/기존`], files: { [`${ME_PATH}/업무/shared/2026-0063-01`]: { '1차년도.json': '{}' } } });
    const w = await SP.openWriter(base, { chrome: fakeChrome(F.fetch) });
    const from = F.st.calls.length;
    const r = await w.rename(`${ME_PATH}/업무/shared/2026-0063-01`, "선체 AI's");
    assert.deepStrictEqual(r, { path: `${ME_PATH}/업무/shared/선체 AI's`, name: "선체 AI's", changed: true, url: `${ORIGIN}${ME_PATH}/${encodeURIComponent('업무')}/shared/${encodeURIComponent("선체 AI's")}` });
    assert.deepStrictEqual(calls(F, from), [`GET folder(${ME_PATH}/업무/shared/선체 AI's)?$select=Exists`, `POST folder(${ME_PATH}/업무/shared/2026-0063-01)/MoveTo(newUrl='${encodeURIComponent(`${ME_PATH}/업무/shared/선체 AI`)}''s')`]);
    assert.ok(F.st.folders[`${ME_PATH}/업무/shared/선체 AI's`] && F.st.folders[`${ME_PATH}/업무/shared/선체 AI's/sub`] && !F.st.folders[`${ME_PATH}/업무/shared/2026-0063-01`], '하위까지 옮겨짐');
    assert.ok(F.st.folders[`${ME_PATH}/업무/shared/선체 AI's`].files['1차년도.json'], '파일 보존');
    assert.strictEqual(SP.parseFolder(r.url).folderPath, r.path, '돌려준 주소가 새 폴더');
    const from2 = F.st.calls.length;
    assert.deepStrictEqual(await w.rename(`${ME_PATH}/업무/shared/기존`, '기존'), { path: `${ME_PATH}/업무/shared/기존`, name: '기존', changed: false, url: `${ORIGIN}${ME_PATH}/${encodeURIComponent('업무')}/shared/${encodeURIComponent('기존')}` });
    assert.strictEqual(calls(F, from2).length, 0);
    const e = await rejects(w.rename(SP.childCfg(base, "선체 AI's"), '기존'), 'http', /이미 있습니다/);
    assert.strictEqual(e.status, 409);
    assert.ok(F.st.folders[`${ME_PATH}/업무/shared/선체 AI's`], '그대로');
    await rejects(w.rename(`${ME_PATH}/업무/shared/기존`, 'a/b'), 'badurl', /파일 이름/);
    await rejects(w.rename(`${ME_PATH}/업무/shared/기존`, ''), 'badurl');
    await rejects(w.rename(ME_PATH, 'X'), 'badurl', /뿌리/);
    await rejects(w.rename('/personal/moon_krs_co_kr/Documents/x', 'y'), 'badurl', /밖/);
    await rejects(w.rename(`${ME_PATH}/업무/shared/없음`, 'y'), 'notfound');
    await w.close();
    const G = fakeSp({ folders: [`${ME_PATH}/업무/shared`, `${ME_PATH}/업무/shared/A`], noMoveTo: true });
    const w2 = await SP.openWriter(base, { chrome: fakeChrome(G.fetch) });
    const r2 = await w2.rename(`${ME_PATH}/업무/shared/A`, 'B');
    assert.deepStrictEqual([r2.changed, r2.path, !!G.st.folders[`${ME_PATH}/업무/shared/B`]], [true, `${ME_PATH}/업무/shared/B`, true]);
    assert.ok(calls(G).some((c) => c.includes('/MoveTo(newUrl=')) && calls(G).some((c) => c.includes('/MoveToUsingPath(DecodedUrl=')));
    G.expire();
    assert.strictEqual((await w2.rename(`${ME_PATH}/업무/shared/B`, 'C')).changed, true); assert.strictEqual(G.st.digestIssued, 2, '다이제스트 만료 → 다시');
    await w2.close();
  });

  await test('writer.close: 창에 우리 탭만 있으면 windows.remove, 사용자가 다른 탭을 옮겨 놓았으면 tabs.remove 만 · 탭이 사라져도 조용히', async () => {
    const F = fakeSp({ folders: [RERP] });
    const C = fakeChrome(F.fetch);
    const w = await SP.openWriter(CFG, { chrome: C });
    C.addTab(w.windowId);
    await w.close();
    assert.deepStrictEqual(C.log.slice(-1), [['tabs.remove', w.tabId]]);
    assert.strictEqual(C.windows_[w.windowId].tabs.length, 1, '다른 탭은 남음');
    const D = fakeChrome(F.fetch);
    const w2 = await SP.openWriter(CFG, { chrome: D });
    delete D.windows_[w2.windowId];   // 사용자가 이미 닫음
    await w2.close();
    // 닫힌 탭에서 페이지 함수를 돌리면 tab
    const E = fakeChrome(F.fetch);
    const w3 = await SP.openWriter(CFG, { chrome: E });
    E.scripting.executeScript = async () => { throw new Error('No tab with id: 12.'); };
    await rejects(w3.modify('P1.json', () => ({ changed: true, text: 'x' })), 'tab', /작업 탭/);
    E.scripting.executeScript = async () => [];
    await rejects(w3.ensureFolder(), 'tab', /결과 없음/);
    E.scripting.executeScript = async () => [{ error: { message: 'boom' } }];
    await rejects(w3.remove('P1.json'), 'tab', /boom/);
    await w3.close();
  });

  await test('쿠키·다이제스트 값이 결과·오류·writer 객체·호출 기록에 없다 (쿠키는 브라우저가 붙이고 다이제스트는 클로저에만)', async () => {
    const F = fakeSp({ files: { [RERP]: { 'P1.json': '{"a":1}', 'P2.json': '{"b":1}' } }, checkedOutBy: { 'P2.json': 99 } });
    const C = fakeChrome(F.fetch);
    const out = [];
    out.push(await SP.resolveMyFolder({ fetch: F.fetch }));
    out.push(await SP.listFiles(CFG, { fetch: F.fetch }));
    out.push(await SP.readFile(CFG, 'P1.json', { fetch: F.fetch }));
    const w = await SP.openWriter(CFG, { chrome: C });
    out.push(w);
    out.push(await w.modify('P1.json', () => ({ changed: true, text: '{"a":2}' })));
    out.push(await w.modify('P1.json', () => ({ changed: false })));
    out.push(await w.ensureFolder());
    try { await w.modify('P2.json', () => ({ changed: true, text: 'x' })); } catch (e) { out.push(SP.describe(e)); out.push({ message: e.message, stack: e.stack }); }
    await w.close();
    out.push(C.log);
    // v2: 폴더 목록 · 나와 공유 · 공유(피커 Key) · 링크 · 이름 바꾸기 · 여러 단
    const base2 = SP.parseFolder(`${ORIGIN}${ME_PATH}/업무/shared`);
    const F2 = fakeSp({ folders: [`${ME_PATH}/업무/shared`, `${ME_PATH}/업무/shared/과제A`], people: PEOPLE, shareFailEmails: ['kim1@krs.co.kr'], shared: [{ value: [{ name: '과제A', folder: {}, remoteItem: { folder: {}, webUrl: `${ORIGIN}/personal/moon_krs_co_kr/Documents/${encodeURIComponent('업무')}/shared/A` } }] }] });
    out.push(await SP.listFolders(base2, { fetch: F2.fetch }));
    out.push(await SP.sharedWithMe({ fetch: F2.fetch }));
    const C2 = fakeChrome(F2.fetch);
    const w2 = await SP.openWriter(base2, { chrome: C2 });
    out.push(await w2.sharePeople(`${ME_PATH}/업무/shared/과제A`, ['문창재', '김철수', '이영희', '박보람']));
    out.push(await w2.orgLink(`${ME_PATH}/업무/shared/과제A`));
    out.push(await w2.rename(`${ME_PATH}/업무/shared/과제A`, '과제B'));
    out.push(await w2.ensurePath(`${ME_PATH}/업무/shared/과제C`));
    try { await w2.rename(`${ME_PATH}/업무/shared/없음`, 'x'); } catch (e) { out.push(SP.describe(e)); out.push({ message: e.message, stack: e.stack }); }
    await w2.close();
    out.push(C2.log);
    const dump = JSON.stringify(out, (k, v) => (typeof v === 'function' ? `[fn ${v.name}]` : v));
    assert.ok(!dump.includes('SECRET-COOKIE'), '쿠키 값 없음');
    assert.ok(!dump.includes('DIGEST-SECRET'), '다이제스트 값 없음');
    assert.ok(!dump.includes('KEY-SECRET') && !dump.includes('i:0#.f|membership'), '피커 Key(로그인 이름) 없음');
    assert.ok(dump.includes('moon@krs.co.kr') && dump.includes('kim1@krs.co.kr'), '이름·이메일은 결과에 있음(공유 n명 표시용)');
    assert.ok(F.st.calls.length > 5 && F.st.digestIssued >= 1 && F2.st.shareBodies.length >= 2, '정말 다이제스트를 쓰는 요청이 있었다');
    assert.ok(!Object.keys(w).includes('digest') && !('digest' in w) && !('digest' in w2));
    assert.ok(F.st.calls.every((c) => !c.join(' ').includes('SECRET')) && F2.st.calls.every((c) => !c.join(' ').includes('SECRET')), '기록에도 없음');
  });

  await test('permissions: ListItemAllFields(RoleAssignments 펼침 — 확장 출처 GET, 다이제스트 없음) + currentuser → 사람(PrincipalType 1)만 people(PrincipalId · 표시 이름 · 이메일(없으면 LoginName 의 것) · 가장 센 역할: 참가 3 → edit · 읽기 2 → read · 모든 권한 5 → owner · 편집 6 → edit), 제한된 액세스(Hidden·kind 1)만 있는 사람·시스템 그룹은 빼고, SharingLinks 그룹은 links, 나(currentuser) 표시, 상속이면 unique:false · 없는 폴더 nofolder · 403 → auth · 로그인 화면 → auth', async () => {
    const cfg = SP.childCfg(SP.parseFolder(`${ORIGIN}${BASE}`), '과제A');
    const F = fakeSp({ folders: [PERM_FOLDER], perms: PERMS });
    const r = await SP.permissions(cfg, { fetch: F.fetch });
    assert.deepStrictEqual(calls(F).map((c) => c.replace(/\?.*$/, '')), [`GET folder(${PERM_FOLDER})/ListItemAllFields`, 'GET currentuser']);
    assert.ok(F.st.calls[0][1].includes('$expand=RoleAssignments/Member,RoleAssignments/RoleDefinitionBindings') && F.st.calls[0][1].includes('RoleAssignments/RoleDefinitionBindings/RoleTypeKind'));
    assert.strictEqual(r.unique, true);
    assert.deepStrictEqual(r.me, { id: ME, name: '', email: '' });
    assert.deepStrictEqual(r.people.map((p) => [p.id, p.name, p.email, p.login, p.role, p.roles.map((x) => x.id), p.me]), [
      [1909, 'MOON Changjae', 'moon@krs.co.kr', 'i:0#.f|membership|moon@krs.co.kr', 'edit', [1073741827], false],
      [1944, 'LEE Jaehoon', 'jhlee81@krs.co.kr', 'i:0#.f|membership|jhlee81@krs.co.kr', 'read', [1073741826], false],
      [2040, 'ROH Gilltae', 'gtroh@krs.co.kr', 'i:0#.f|membership|gtroh@krs.co.kr', 'owner', [1073741829, 1073741827], false],
      [ME, 'KIM Geohwa', 'kimghw@krs.co.kr', 'i:0#.f|membership|kimghw@krs.co.kr', 'edit', [1073741830], true],
    ], '제한된 액세스만 있는 YOON 과 시스템 그룹은 없고, 숨은 역할은 roles 에서도 빠진다');
    assert.deepStrictEqual(r.people[0].roles, [{ id: 1073741827, name: '참가', kind: 3 }]);
    assert.deepStrictEqual(r.links, [{ id: 3478, name: 'SharingLinks.70ebcbd6-e7ab-4052-b4c3-7bd3ed3f1648.OrganizationEdit.a30f6b6c', role: 'edit' }]);
    assert.ok(!JSON.stringify(r).includes('SECRET'));
    const G = fakeSp({ folders: [PERM_FOLDER] });
    const r2 = await SP.permissions(cfg, { fetch: G.fetch });
    assert.deepStrictEqual([r2.unique, r2.people, r2.links, r2.me.id], [false, [], [], ME], '상속(아무에게도 따로 주지 않음)');
    await rejects(SP.permissions(cfg, { fetch: fakeSp().fetch }), 'nofolder', /공유 폴더가 없습니다/);
    await rejects(SP.permissions(cfg, { fetch: fakeSp({ folders: [PERM_FOLDER], deny403: true }).fetch }), 'auth', /로그인/);
    await rejects(SP.permissions(cfg, { fetch: fakeSp({ loggedIn: false }).fetch }), 'auth', /로그인 화면/);
    await rejects(SP.permissions(JSON.parse(JSON.stringify(cfg)), { fetch: fakeSp().fetch }), 'nofolder');   // 캐시 cfg 도 받음
    assert.deepStrictEqual([SP.roleOf([{ kind: 2 }, { kind: 3 }]), SP.roleOf([{ kind: 0 }]), SP.roleOf([{ kind: 5 }, { kind: 2 }]), SP.roleOf([]), SP.roleOf(null)], ['edit', 'other', 'owner', '', '']);
  });

  await test('findPeople: 사이트 search REST(People 결과 원본 sourceid · querytext 리터럴(한글은 퍼센트 인코딩) · 확장 출처 GET) → 1명이면 그 사람(한글 질문 → 영문 PreferredName 이라도), 여럿이면 PreferredName/이메일이 꼭 같은 1명 아니면 ambiguous(후보 "이름 <이메일>"), 없으면 notFound, 이메일 없는 줄은 안 셈, 중복·빈 이름은 한 번·건너뜀, 빈 목록은 호출 없음 · verbose 응답 · 403 → auth', async () => {
    const cfg = SP.parseFolder(`${ORIGIN}${BASE}`);
    const F = fakeSp({ search: SEARCH });
    const r = await SP.findPeople(cfg, ['문창재', ' 김철수 ', 'kim2@krs.co.kr', 'LEE Jaehoon', '없는사람', '메일없음', '문창재', '', null], { fetch: F.fetch });
    assert.deepStrictEqual(r, {
      found: [{ name: '문창재', title: 'MOON Changjae', email: 'cjmoon@krs.co.kr', login: 'i:0#.f|membership|cjmoon@krs.co.kr' }, { name: 'kim2@krs.co.kr', title: 'KIM Chulsoo (해양)', email: 'kim2@krs.co.kr', login: 'i:0#.f|membership|kim2@krs.co.kr' }, { name: 'LEE Jaehoon', title: 'LEE Jaehoon', email: 'jhlee81@krs.co.kr', login: 'i:0#.f|membership|jhlee81@krs.co.kr' }],
      ambiguous: [{ name: '김철수', candidates: ['KIM Chulsoo <kim1@krs.co.kr>', 'KIM Chulsoo (해양) <kim2@krs.co.kr>'] }],
      notFound: ['없는사람', '메일없음'],
    });
    assert.deepStrictEqual(calls(F), ['GET search(문창재)', 'GET search(김철수)', 'GET search(kim2@krs.co.kr)', 'GET search(LEE Jaehoon)', 'GET search(없는사람)', 'GET search(메일없음)']);
    assert.strictEqual(F.st.searchUrls[0], `${ORIGIN}/personal/kimghw_krs_co_kr/_api/search/query?querytext='${encodeURIComponent('문창재')}'&sourceid='b09a7990-05ea-4af9-81ef-edfab16c4e31'&selectproperties='PreferredName,WorkEmail,AccountName'&rowlimit=10`);
    assert.strictEqual(SP.PEOPLE_SOURCE, 'b09a7990-05ea-4af9-81ef-edfab16c4e31');
    const from = F.st.calls.length;
    assert.deepStrictEqual(await SP.findPeople(cfg, [], { fetch: F.fetch }), { found: [], ambiguous: [], notFound: [] });
    assert.deepStrictEqual(await SP.findPeople(cfg, [' ', null], { fetch: F.fetch }), { found: [], ambiguous: [], notFound: [] });
    assert.strictEqual(F.st.calls.length, from);
    const V = fakeSp({ search: SEARCH, searchVerbose: true });
    assert.deepStrictEqual((await SP.findPeople(cfg, '문창재', { fetch: V.fetch })).found.map((x) => x.email), ['cjmoon@krs.co.kr'], 'verbose(d.query … results) 도 읽는다 · 문자열 하나도 받는다');
    await rejects(SP.findPeople(cfg, ['문창재'], { fetch: fakeSp({ search: SEARCH, deny403: true }).fetch }), 'auth', /로그인/);
    await rejects(SP.findPeople(cfg, ['문창재'], { fetch: fakeSp({ loggedIn: false }).fetch }), 'auth', /로그인 화면/);
  });

  await test('writer.unshare: 사람(PrincipalId)마다 GetByPrincipalId(id)/RoleDefinitionBindings 로 역할을 읽어 Hidden·제한된 액세스가 아닌 역할마다 RemoveRoleAssignment(principalid,roledefid)(다이제스트) → { removed:[{ id, roles }], missing }, 없는 사람은 missing, 겹침·0·글자는 거름, 빈 목록은 호출 없음, 다이제스트 만료는 다시 받아 한 번 더, 거둔 뒤 permissions 에서 사라짐 · 이메일로 sharePeople(피커가 이메일로 찾은 1명 — 표시 이름은 영문, 이메일이 다르면 ambiguous)한 사람이 permissions 에 보임 · 사이트 밖 badurl', async () => {
    const base = SP.parseFolder(`${ORIGIN}${BASE}`);
    const cfg = SP.childCfg(base, '과제A');
    const F = fakeSp({ folders: [PERM_FOLDER], perms: PERMS, people: PEOPLE });
    const w = await SP.openWriter(base, { chrome: fakeChrome(F.fetch) });
    const from = F.st.calls.length;
    const r = await w.unshare(PERM_FOLDER, [1944, 2040, 999, 1944, 0, 'x']);
    assert.deepStrictEqual(r, { removed: [{ id: 1944, roles: [1073741826] }, { id: 2040, roles: [1073741829, 1073741827] }], missing: [999] });
    const item = `folder(${PERM_FOLDER})/ListItemAllFields/RoleAssignments`;
    assert.deepStrictEqual(calls(F, from).map((c) => c.replace(/\?.*$/, '')), [
      `GET ${item}/GetByPrincipalId(1944)/RoleDefinitionBindings`, `POST ${item}/RemoveRoleAssignment(principalid=1944,roledefid=1073741826)`,
      `GET ${item}/GetByPrincipalId(2040)/RoleDefinitionBindings`, `POST ${item}/RemoveRoleAssignment(principalid=2040,roledefid=1073741829)`, `POST ${item}/RemoveRoleAssignment(principalid=2040,roledefid=1073741827)`,
      `GET ${item}/GetByPrincipalId(999)/RoleDefinitionBindings`,
    ], '제한된 액세스(숨은 역할)는 거두지 않는다');
    assert.deepStrictEqual(F.st.unshares, [[PERM_FOLDER, 1944, 1073741826], [PERM_FOLDER, 2040, 1073741829], [PERM_FOLDER, 2040, 1073741827]]);
    const perms = await SP.permissions(cfg, { fetch: F.fetch });
    assert.deepStrictEqual(perms.people.map((p) => [p.id, p.role]), [[1909, 'edit'], [ME, 'edit']], '거둔 사람은 없고(LEE 는 제한된 액세스만 남음) 나머지는 그대로');
    const from2 = F.st.calls.length;
    assert.deepStrictEqual(await w.unshare(PERM_FOLDER, []), { removed: [], missing: [] });
    assert.deepStrictEqual(await w.unshare(PERM_FOLDER, [0, 'x', null]), { removed: [], missing: [] });
    assert.strictEqual(F.st.calls.length, from2);
    // 다이제스트 만료 → 다시 받아 한 번 더(이미 거둔 역할은 다시 읽히지 않는다) · cfg 인수 · 숫자 하나
    F.expire();
    const from3 = F.st.calls.length;
    assert.deepStrictEqual(await w.unshare(cfg, 1909), { removed: [{ id: 1909, roles: [1073741827] }], missing: [] });
    assert.ok(calls(F, from3).includes('POST contextinfo') && F.st.unshares.length === 4);
    // 이메일로 공유 → 피커 질문이 이메일, 이메일이 같은 1명(표시 이름은 영문) → permissions 에 읽기로 보임. 이메일이 다른 1명이면 ambiguous
    const s = await w.sharePeople(PERM_FOLDER, ['moon@krs.co.kr'], { role: 'read' });
    assert.deepStrictEqual(s, { shared: [{ name: 'MOON Changjae', email: 'moon@krs.co.kr' }], ambiguous: [], notFound: [], failed: [] });
    assert.strictEqual(F.st.pickerBodies.slice(-1)[0].body.queryParams.QueryString, 'moon@krs.co.kr');
    assert.strictEqual(F.st.shareBodies.slice(-1)[0].body.roleValue, 'role:1073741826');
    const after = await SP.permissions(cfg, { fetch: F.fetch });
    assert.deepStrictEqual(after.people.filter((p) => p.email === 'moon@krs.co.kr').map((p) => [p.name, p.role]), [['MOON Changjae', 'read']]);
    assert.deepStrictEqual(await w.sharePeople(PERM_FOLDER, ['kim@krs.co.kr']), { shared: [], ambiguous: [{ name: 'kim@krs.co.kr', candidates: ['김철수'] }], notFound: [], failed: [] });
    await rejects(w.unshare('/personal/moon_krs_co_kr/Documents/업무/shared/과제A', [1]), 'badurl', /밖/);
    // 역할 읽기 403 → auth(상태 그대로 던짐)
    const D = fakeSp({ folders: [PERM_FOLDER], perms: PERMS, deny403: true });
    await rejects(SP.openWriter(base, { chrome: fakeChrome(D.fetch) }), 'auth');
    await w.close();
  });

  await test('describe: kind 있는 오류 · kind 없는 Error(error) · 문자열', () => {
    assert.deepStrictEqual(SP.describe(Object.assign(new Error('x'), { kind: 'auth' })), { kind: 'auth', message: 'x' });
    assert.deepStrictEqual(SP.describe(new Error('y')), { kind: 'error', message: 'y' });
    assert.deepStrictEqual(SP.describe('z'), { kind: 'error', message: 'z' });
    assert.strictEqual(SP.describe(null).kind, 'error');
  });

  await test('페이지 함수는 바깥 변수를 쓰지 않는다(직렬화 주입) — 모듈 안 이름이 소스에 없고 쿠키로 요청한다', () => {
    const names = Object.keys(SP._page);
    assert.deepStrictEqual(names.sort(), ['spBegin', 'spCommit', 'spCreate', 'spDigest', 'spEnsureFolder', 'spOrgLink', 'spRecycle', 'spRelease', 'spRename', 'spSharePeople', 'spUnshare']);
    for (const fn of Object.values(SP._page)) {
      const src = fn.toString();
      assert.ok(!/mkErr|encLit|encPath|AUTH_MSG|ACCEPT_JSON|errOfResult|errOfStatus|kindOfStatus|DEFAULT_COMMENT|checkName|metaOf|redirectedOut|ROLE_EDIT|ROLE_READ|ROLE_RANK|roleOfKind|PEOPLE_SOURCE|SHARED_MAX_PAGES|\bbadurl\b|\bfolderOf\b|\bfileOf\b|\bsharedItemOf\b|\blistChildren\b|\bspGet\b|\bapi\.|\bg\./.test(src), `${fn.name}: 바깥 이름 참조`);
      assert.ok(/credentials: 'include'/.test(src), `${fn.name}: 쿠키로 요청`);
      assert.ok(/^async function sp[A-Z]/.test(src), `${fn.name}: 이름 있는 async 함수(executeScript func)`);
    }
  });

  })();
}

/* ---------- prjdoc — kr_ext_rerp tests/prjdoc.test.js 그대로 ---------- */
/* lib/prjdoc.js v2 (확장 Plus — 과제 폴더의 연차 파일 <n>차년도.json · 예상비용.json, 2026-10-18 저녁) 테스트: 파일·폴더 이름(약칭 → Job Id → 과제번호), 빈 문서·직렬화·해석(키 차례·모르는 칸 보존·v1·다른 판 거절),
 * 로컬 몫 떼기(fromLocalYear · fromLocalPlan — 연차 기간·예산 줄·연차 슬라이스), 병합(project — ERP 칸은 ERP 값·alias 는 aliasAt·jobId 는 시각 규칙 / budget 한 덩이 at·빈 쪽 못 이김·사업비 계획에 비침 / staff·research 연차 /
 * changes 합집합·500 제한 / want 로 끈 칸), 로컬에 되돌려 넣기(toLocalYear — 그 연차 키만 · toLocalPlan). 실행: node tests/prjdoc.test.js */
{
  const D = PRJDOC, S = STAFF;

  /* 자료 예 — 각 칸은 지금 저장소 모양 그대로 */
  const item = (id, ts, extra) => Object.assign({ id, name: `항목 ${id}`, qty: 1, unit: 1000, amt: 1000, ts }, extra || {});
  const rec = (prjNo, nn, rev, at, extra) => Object.assign({ id: `mw급과제#${nn}`, name: 'MW급 과제', code: 'RS-1', n: nn, rev, tag: '', file: 'KR_x.yaml', at, agree: '', period: '', role: '공동', lead: '김거화', note: '',
    goals: [`${nn}차 목표`], contents: [], perf: [], outputs: [], schedule: null, spend: [], budget: [], roster: [], prjNo, prjNm: prjNo ? '과제1' : '', linkBy: prjNo ? 'auto' : '' }, extra || {});
  const person = (name, amts, monthly) => S.normalizePerson({ id: name, name, role: '연구원', manual: monthly, plan: amts.map((amt, i) => ({ ym: `2026-${String(i + 4).padStart(2, '0')}`, amt })) });
  const BUDGET = [{ name: '인건비', plan: 31425000 }, { name: '연구활동비', plan: 5000000 }];
  const splan = (prjNo, year, at, people, extra) => Object.assign({ prjNo, year, prjNm: '과제1', from: year === 1 ? '2026-04' : '2027-01', to: year === 1 ? '2026-12' : '2027-12', budgetPay: 31425000, budget: BUDGET, basis: 'rerp', src: 'erp', people, at, by: '김거화', note: '' }, extra || {});
  const change = (id, date, kind, item, before, after, extra) => Object.assign({ id, date, kind, item, before, after, reason: '', by: '나', at: Number(id.replace(/\D/g, '')) || 0, auto: false }, extra || {});
  const localOf = () => ({
    plan: { plans: { P1: { '10|연구활동비': [item('a', 5), item('b', 6, { sub: { date: '2026-09-02' }, by: '홍' })], '10|장비비': [item('c', 7)] }, P2: { K: [item('z', 1)] } },
      del: { d: { ts: 9, prj: 'P1' }, e: { ts: 9, prj: 'P2' }, f: 8 } },   // f = 이전 형식(과제 없음) — 모든 과제 몫
    research: { 'mw급과제#1': rec('P1', 1, 'r2', 3), 'mw급과제#2': rec('P1', 2, 'r1', 4), '다른#1': rec('P2', 1, 'r0', 1, { id: '다른#1', name: '다른' }), '안이음#1': rec('', 1, 'r0', 1, { id: '안이음#1', name: '안이음' }) },
    staff: { plans: { 'P1@1': splan('P1', 1, 1000, [person('문창재', [1165000, 1165000], 5823000)]), 'P1@2': splan('P1', 2, 2000, [person('홍길동', [1000000], 5000000)]), 'P2@1': splan('P2', 1, 1000, [person('x', [1])]), P1: { prjNo: 'P1' } }, del: { 'P1@3': 30, 'P2@2': 20 } },
    aliases: { P1: 'SSCB', P2: 'X' }, aliasesAt: { P1: 10 },
    changes: { 'P1@1': [change('c10', '2026-10-01', '예산', '연구활동비', '5,000천원', '6,000천원'), change('c20', '2026-10-05', '연구진', '참여연구원', '', '홍길동')], 'P1@2': [change('c30', '2026-10-06', '연구기간', '기간', '', '')], 'P2@1': [change('c40', '2026-10-07', '기타', 'x', '', '')] },
    // projects: ERP 칸(prjNm·rspr·anl)과 ERP 현재 연차 기간(stDt/endDt — yearSpan 용, 문서로는 안 감) + 받아 둔 WORKSPACE 몫(start/end = 과제 전체 연구기간, jobId …; at 없으면 0 = 아직 못 받음)
    projects: { P1: { prjNm: '과제1', rspr: '김거화', anl: 1, stDt: '20260401', endDt: '20261231', start: '2026-04-01', end: '2026-12-31' }, P2: { prjNm: '과제2', rspr: '', anl: 1, stDt: '20260101', endDt: '20261231', start: '20260101', end: '20261231' } },
  });
  const META = { prjNm: '과제1', rspr: '김거화', stDt: '20260401', endDt: '20261231', who: '나' };   // prjdoc-sync 의 metaOf 가 주는 것 — 과제 전체 기간(start/end)은 없다(WORKSPACE 몫)

  await (async () => {
  await test('파일 이름(yearName · isYearName · planName) · 폴더 이름(약칭 → Job Id → 과제번호, 못 쓰는 글자 걷고 60자)', () => {
    assert.strictEqual(D.yearName(1), '1차년도.json'); assert.strictEqual(D.yearName('3'), '3차년도.json');
    assert.strictEqual(D.isYearName('2차년도.json'), 2); assert.strictEqual(D.isYearName(' 12차년도.JSON '), 12);
    assert.deepStrictEqual([D.isYearName('예상비용.json'), D.isYearName('P1.json'), D.isYearName('차년도.json'), D.isYearName('')], [0, 0, 0, 0]);
    assert.strictEqual(D.planName(), '예상비용.json'); assert.strictEqual(D.PLAN_NAME, '예상비용.json');
    assert.ok(D.isPlanName('예상비용.json') && !D.isPlanName('1차년도.json'));
    assert.strictEqual(D.folderNameFor({ alias: 'SSCB', jobId: 'RND00202026', prjNo: '2026-0063-01' }), 'SSCB');
    assert.strictEqual(D.folderNameFor({ alias: '', jobId: 'RND00202026', prjNo: '2026-0063-01' }), 'RND00202026');
    assert.strictEqual(D.folderNameFor({ prjNo: '2026-0063-01' }), '2026-0063-01');
    assert.strictEqual(D.folderNameFor({ alias: ' MW급/과제: "A"? *.. ' }), 'MW급과제 A');
    assert.strictEqual(D.folderNameFor({ alias: 'x'.repeat(80) }).length, 60);
    assert.strictEqual(D.folderNameFor({ alias: '///' }), '과제');
  });

  await test('emptyYear · serialize 키 차례 고정 · parse 왕복 · 모르는 칸 보존(최상위·project·changes) · v1·JSON 아님·종류 모름은 null', () => {
    const e = D.emptyYear({ prjNo: 'P1', prjNm: '과제1', rspr: '김거화', who: '나', yearStart: '2026-04', yearEnd: '2026-12' }, 1);
    assert.deepStrictEqual(e, { v: 2, kind: 'year', project: { prjNo: 'P1', prjNm: '과제1', rspr: '김거화', alias: '', aliasAt: 0, jobId: '', io: '', start: '', end: '', note: '' }, year: { n: 1, start: '2026-04', end: '2026-12' },
      budget: [], staff: { plans: [], del: {} }, research: [], changes: [], updatedAt: '', updatedBy: '나' });
    const text = D.serialize(Object.assign({ workspace: { x: 1 }, zeta: 'z' }, e, {
      project: Object.assign({}, e.project, { jobId: 'RND1', extra: '보존' }), research: [rec('', 1, 'r2', 3)], budget: [{ name: '인건비', plan: '31,425,000', at: 5, by: '나' }, { name: '', plan: null }, 3],
      staff: { plans: [splan('P1', 1, 1000, [person('문창재', [1165000], 5823000)]), splan('P1', 2, 1, [])], del: { 'P1@1': 5, 'P1@2': 6, 'P2@1': 7 } },
      changes: [change('c2', '2026-10-02', '예산', 'a', '1', '2', { key: 'yaml' }), change('c1', '2026-10-01', '엉뚱', 'b', '1', '2'), { id: 'c3', date: '2026-10-03', kind: '기타' }, { date: '2026-10-04', item: 'id 없음' }] }));
    assert.ok(text.endsWith('\n') && text.includes('\n  "project": {\n'), '2칸 들여쓰기');
    assert.deepStrictEqual(Object.keys(JSON.parse(text)), ['v', 'kind', 'project', 'year', 'budget', 'staff', 'research', 'changes', 'updatedAt', 'updatedBy', 'workspace', 'zeta'], '정해진 차례 뒤에 모르는 칸');
    const back = D.parse(text);
    assert.strictEqual(back.kind, 'year');
    const d = back.doc;
    assert.deepStrictEqual([d.workspace, d.zeta, d.project.jobId, d.project.extra], [{ x: 1 }, 'z', 'RND1', '보존']);
    assert.deepStrictEqual(Object.keys(d.project), ['prjNo', 'prjNm', 'rspr', 'alias', 'aliasAt', 'jobId', 'io', 'start', 'end', 'note', 'extra']);
    assert.deepStrictEqual(d.budget, [{ name: '인건비', plan: 31425000, at: 5, by: '나' }], '이름도 금액도 없는 줄·객체 아닌 것은 뺀다');
    assert.deepStrictEqual([d.staff.plans.map((p) => p.year), d.staff.del], [[1], { 'P1@1': 5 }], '연차 파일에는 그 연차 계획·묘비만');
    assert.deepStrictEqual(d.research.map((r) => r.id), ['mw급과제#1']);
    assert.deepStrictEqual(d.changes.map((c) => [c.id, c.kind, c.key]), [['c1', '기타', undefined], ['c2', '예산', 'yaml']], '날짜 차례 · 모르는 kind 는 기타 · 내용 없는 줄·id 없는 줄은 뺌 · key 보존');
    // 연구내용의 n 이 연차와 다르면 그 파일에 넣지 않는다
    assert.deepStrictEqual(D.parse(D.serialize(Object.assign({}, e, { research: [rec('', 2, 'r0', 1)] }))).doc.research, []);
    // 종류
    assert.strictEqual(D.parse(JSON.stringify({ v: 2, year: { n: 1 } })).kind, 'year'); assert.strictEqual(D.parse(JSON.stringify({ v: 2, plan: { items: [] } })).kind, 'plan');
    assert.strictEqual(D.parse(JSON.stringify({ v: 2, project: {} })), null, '종류를 모르면 null');
    assert.strictEqual(D.parse(JSON.stringify({ v: 1, prjNo: 'P1', plan: { items: {} } })), null, 'v1 파일은 읽지 않는다');
    assert.strictEqual(D.parse(JSON.stringify({ v: 3, kind: 'year' })), null, '다른 판');
    assert.strictEqual(D.parse('[1,2]'), null); assert.strictEqual(D.parse('not json'), null); assert.strictEqual(D.parse(''), null);
    // 파일 이름의 연차 힌트 — year.n 이 없을 때만
    assert.strictEqual(D.parse('{"v":2,"kind":"year"}', { year: 3 }).doc.year.n, 3);
    assert.strictEqual(D.parse('{"v":2,"kind":"year","year":{"n":"2"}}', { year: 3 }).doc.year.n, 2);
    // 예상 비용 문서
    const p = D.emptyPlan({ prjNo: 'P1', prjNm: '과제1', who: '나' });
    assert.deepStrictEqual(p, { v: 2, kind: 'plan', project: { prjNo: 'P1', prjNm: '과제1' }, plan: { items: [], del: {} }, updatedAt: '', updatedBy: '나' });
    const pt = D.serialize(Object.assign({ ws: 1 }, p, { project: { prjNo: 'P1', prjNm: '과제1', alias: '보존' }, plan: { items: [{ id: 'a', key: 'K', name: 'x', qty: 1, unit: 5, amt: 5, ts: 1 }, { key: 'K' }], del: { q: 7 } } }));
    assert.deepStrictEqual(Object.keys(JSON.parse(pt)), ['v', 'kind', 'project', 'plan', 'updatedAt', 'updatedBy', 'ws']);
    const pb = D.parse(pt);
    assert.deepStrictEqual([pb.kind, pb.doc.project, pb.doc.plan.items.map((e) => [e.id, e.prj, e.key]), pb.doc.plan.del, pb.doc.ws], ['plan', { prjNo: 'P1', prjNm: '과제1', alias: '보존' }, [['a', 'P1', 'K']], { q: 7 }, 1], 'prj 가 비면 과제번호로');
  });

  await test('fromLocalYear: 과제·연차 몫만 — project(ERP meta·별칭·받아 둔 jobId·start/end) · 연차 기간(계획 from/to, 없으면 yearSpan — ERP 현재 연차 기간 stDt/endDt 에서; meta.start/end 는 쓰지 않음) · 예산 줄(계획의 at·by) · 그 연차 계획·묘비 · 그 차년도 기록 · 변경이력', () => {
    const local = localOf();
    local.projects.P1.jobId = 'RND1'; local.projects.P1.at = 77;
    const L = D.fromLocalYear('P1', 1, local, META);
    assert.deepStrictEqual(L.project, { prjNo: 'P1', prjNm: '과제1', rspr: '김거화', alias: 'SSCB', aliasAt: 10, jobId: 'RND1', io: '', start: '2026-04-01', end: '2026-12-31', note: '' });
    assert.deepStrictEqual(D.fromLocalYear('P1', 1, local, Object.assign({}, META, { start: '2000-01-01', end: '2000-12-31' })).project.start, '2026-04-01', 'meta.start/end(옛 ERP 연차 기간 자리)는 받지 않는다 — 받아 둔 WORKSPACE 값만');
    assert.ok(!('stDt' in L.project) && !('endDt' in L.project) && !('anl' in L.project), 'ERP 연차 기간·연차는 문서 project 로 가지 않는다');
    assert.deepStrictEqual(L.year, { n: 1, start: '2026-04', end: '2026-12' });
    assert.deepStrictEqual(L.budget, [{ name: '인건비', plan: 31425000, at: 1000, by: '김거화' }, { name: '연구활동비', plan: 5000000, at: 1000, by: '김거화' }]);
    assert.deepStrictEqual([L.staff.plans.map((p) => `${p.prjNo}@${p.year}`), L.staff.del], [['P1@1'], {}], '그 연차 계획·묘비만(옛 키 P1 은 뺀다)');
    const l1 = localOf(); l1.staff.del['P1@1'] = 5;
    assert.deepStrictEqual(D.fromLocalYear('P1', 1, l1, META).staff.del, { 'P1@1': 5 }, '이 연차 묘비는 싣고 다른 연차(P1@3)·과제(P2@2) 묘비는 뺀다');
    assert.deepStrictEqual(L.research.map((r) => [r.id, r.prjNo]), [['mw급과제#1', 'P1']], '연결 칸은 그대로');
    assert.deepStrictEqual(L.changes.map((c) => c.id), ['c10', 'c20']);
    assert.strictEqual(L.updatedBy, '나');
    assert.strictEqual(D.localProjectAt(local, 'P1'), 77);
    const L2 = D.fromLocalYear('P1', 2, local, META);
    assert.deepStrictEqual([L2.year, L2.staff.plans.map((p) => p.year), L2.research.map((r) => r.id), L2.changes.map((c) => c.id), L2.staff.del], [{ n: 2, start: '2027-01', end: '2027-12' }, [2], ['mw급과제#2'], ['c30'], {}]);
    // 계획이 없는 연차 — 기간은 ERP 현재 연차(stDt/endDt)에서 12달씩(yearSpan), 예산 줄 없음. 연차 기간을 모르면(stDt 없음) 빈 값 — 과제 전체 기간(start/end)으로 셈하지 않는다(36달짜리 연차가 된다)
    const L3 = D.fromLocalYear('P1', 3, local, META);
    assert.deepStrictEqual([L3.year, L3.budget, L3.staff, L3.research, L3.changes], [{ n: 3, start: '2028-01', end: '2028-12' }, [], { plans: [], del: { 'P1@3': 30 } }, [], []]);
    const l3n = localOf(); delete l3n.projects.P1.stDt; delete l3n.projects.P1.endDt;
    assert.deepStrictEqual(D.fromLocalYear('P1', 3, l3n, { prjNm: '과제1' }).year, { n: 3, start: '', end: '' });
    // meta 가 없으면 local.projects 의 ERP 칸
    const L4 = D.fromLocalYear('P2', 1, local, {});
    assert.deepStrictEqual([L4.project.prjNm, L4.project.start, L4.project.alias, L4.project.aliasAt, L4.year], ['과제2', '20260101', 'X', 0, { n: 1, start: '2026-04', end: '2026-12' }]);
    const L5 = D.fromLocalYear('P9', 1, {}, {});
    assert.deepStrictEqual([L5.project.prjNo, L5.year, L5.budget, L5.staff, L5.research, L5.changes], ['P9', { n: 1, start: '', end: '' }, [], { plans: [], del: {} }, [], []]);
    // 예상 비용 몫
    const P = D.fromLocalPlan('P1', local, META);
    assert.deepStrictEqual([P.project, P.plan.items.map((e) => [e.id, e.prj, e.key]).sort(), P.plan.del], [{ prjNo: 'P1', prjNm: '과제1' }, [['a', 'P1', '10|연구활동비'], ['b', 'P1', '10|연구활동비'], ['c', 'P1', '10|장비비']], { d: 9, f: 8 }], 'P2 묘비 e 는 빼고 과제 없는 f 는 넣는다');
    assert.deepStrictEqual(P.plan.items.find((e) => e.id === 'b').sub, { date: '2026-09-02' });
    // 대상 고르기
    assert.deepStrictEqual(D.localPrjNos(local).sort(), ['P1', 'P2']);
    assert.deepStrictEqual(D.localPrjNos({ aliases: { P7: 'a', P8: '' }, changes: { 'P6@1': [change('c1', '2026-10-01', '기타', 'x', '', '')], 'P5@1': [] }, research: { x: rec('', 1, 'r0', 1) } }).sort(), ['P6', 'P7']);
    assert.deepStrictEqual([D.localYears('P1', local), D.localYears('P2', local), D.localYears('P9', local)], [[1, 2], [1], []]);
    assert.deepStrictEqual(D.otherRecs('P2', local) && Object.keys(D.otherRecs('P2', local)).sort(), ['mw급과제#1', 'mw급과제#2']);
  });

  await test('mergeYear: 파일 없음 → 로컬로 문서를 만든다(remoteChanged, 로컬 안 바뀜, updatedAt/updatedBy) · 왕복하면 아무것도 안 바뀜', () => {
    const L = D.fromLocalYear('P1', 1, localOf(), META);
    const m = D.mergeYear(L, null, 100000, '나');
    assert.strictEqual(m.remoteChanged, true);
    assert.deepStrictEqual(m.localChanged, { budget: false, staff: false, research: false, changes: false, alias: false, project: false });
    assert.deepStrictEqual([m.year, m.doc.updatedAt, m.doc.updatedBy, m.doc.project.prjNm, m.doc.project.alias, m.doc.year], [1, '1970-01-01T00:01:40.000Z', '나', '과제1', 'SSCB', { n: 1, start: '2026-04', end: '2026-12' }]);
    assert.deepStrictEqual(m.doc.budget.map((r) => r.name), ['인건비', '연구활동비']);
    assert.ok(m.doc.research.every((r) => !('prjNo' in r) && !('linkBy' in r) && !('src' in r)), '문서의 기록에는 연결 칸이 없다');
    assert.deepStrictEqual([m.doc.staff.plans[0].people[0].name, m.doc.staff.del, m.doc.changes.map((c) => c.id)], ['문창재', {}, ['c10', 'c20']]);
    assert.deepStrictEqual(D.countOfYear(m.doc), { budget: 2, staff: 1, research: 1, changes: 2 });
    assert.deepStrictEqual(m.parts.project, Object.assign({}, m.doc.project, { at: 0 }));
    // 로컬 별칭에 시각이 없으면 지금으로(로컬에만 반영 — aliasAt 저장)
    const m2 = D.mergeYear(D.fromLocalYear('P2', 1, localOf(), {}), null, 500, '나');
    assert.deepStrictEqual([m2.doc.project.alias, m2.doc.project.aliasAt, m2.localChanged.alias], ['X', 500, true]);
    // 왕복
    const again = D.mergeYear(L, D.parse(D.serialize(m.doc)).doc, 200000, '나');
    assert.deepStrictEqual([again.remoteChanged, Object.values(again.localChanged).some(Boolean), again.doc.updatedAt, again.doc.updatedBy], [false, false, '1970-01-01T00:01:40.000Z', '나']);
    // 90일 지난 묘비는 병합 때 버려진다 — 그것만으로도 로컬이 바뀐 것으로 친다
    const l3 = localOf(); delete l3.staff.plans['P1@1']; l3.staff.del['P1@1'] = 5;
    const old = D.mergeYear(D.fromLocalYear('P1', 1, l3, META), null, 1700000000000, '나');
    assert.deepStrictEqual([old.localChanged.staff, old.doc.staff.del], [true, {}]);
    assert.deepStrictEqual(D.mergeYear(D.fromLocalYear('P1', 1, l3, META), null, 100, '나').doc.staff.del, { 'P1@1': 5 }, '90일 안이면 묘비가 파일에 실린다');
  });

  await test('mergeYear project: ERP 칸(prjNm·rspr)은 로컬(ERP) 값, 비면 파일 것 · alias 는 aliasAt 큰 쪽 · jobId·io·start·end·note·모르는 칸은 파일이 로컬이 받은 시각보다 뒤면 파일 것(빈 값이라도) 아니면 로컬 것 · parts.project.at — start/end(과제 전체 연구기간)는 WORKSPACE 몫(rERP 가 아는 날짜는 연차 기간)', () => {
    const local = localOf();
    local.projects.P1.jobId = 'RND-OLD'; local.projects.P1.at = 1000; local.projects.P1.rspr = '';
    const L = D.fromLocalYear('P1', 1, local, Object.assign({}, META, { prjNm: 'ERP 과제명', rspr: '' }));
    const R = Object.assign(D.emptyYear({ prjNo: 'P1', prjNm: '파일 과제명', rspr: '파일 책임자', alias: 'SSCB2', aliasAt: 20, jobId: 'RND-NEW', io: 'IO1', note: '메모', start: '2020-01-01', end: '2020-12-31' }, 1), { updatedAt: new Date(5000).toISOString(), updatedBy: 'WORKSPACE' });
    R.project.extra = { ws: true };
    const m = D.mergeYear(L, R, 100000, '나');
    assert.deepStrictEqual(m.doc.project, { prjNo: 'P1', prjNm: 'ERP 과제명', rspr: '파일 책임자', alias: 'SSCB2', aliasAt: 20, jobId: 'RND-NEW', io: 'IO1', start: '2020-01-01', end: '2020-12-31', note: '메모', extra: { ws: true } });
    assert.deepStrictEqual([m.localChanged.alias, m.localChanged.project, m.remoteChanged, m.parts.project.at], [true, true, true, 5000], 'ERP 과제명이 파일과 달라 파일도 바뀜 · 로컬은 jobId·io·start·end·note·extra 를 받음(파일 5000 > 로컬이 받은 시각 1000)');
    // 파일이 로컬이 받은 시각보다 앞이면 로컬의 WORKSPACE 칸이 이김(연차 파일 여럿에 퍼뜨리는 길)
    local.projects.P1.at = 9000;
    const at = () => ({ localAt: D.localProjectAt(local, 'P1') });   // prjdoc-sync 가 넘기는 값(로컬이 WORKSPACE 칸을 받은 시각)
    const m2 = D.mergeYear(D.fromLocalYear('P1', 1, local, META), R, 100000, '나', at());
    assert.deepStrictEqual([m2.doc.project.jobId, m2.doc.project.io, m2.doc.project.note, m2.doc.project.start, m2.doc.project.end, m2.localChanged.project, m2.remoteChanged, m2.parts.project.at], ['RND-OLD', '', '', '2026-04-01', '2026-12-31', true, true, 9000], '로컬이 받은 시각(9000)이 파일(5000)보다 뒤 — jobId·io·note·start·end 모두 로컬 값(빈 것도) · extra 는 로컬에 없어 파일 것(→ project 바뀜)');
    // 연차 기간이 바뀌어도(stDt/endDt — 다음 연차) project 는 그대로 — 매 연차 가짜 '연구기간' 변경이 나지 않는다
    const l2 = localOf(); l2.projects.P1.stDt = '20270401'; l2.projects.P1.endDt = '20280331'; l2.projects.P1.anl = 2; l2.projects.P1.at = 9000; l2.projects.P1.extra = { ws: true };
    const m2b = D.mergeYear(D.fromLocalYear('P1', 1, l2, { prjNm: 'ERP 과제명', rspr: '', stDt: '20270401', endDt: '20280331' }), Object.assign({}, R, { project: Object.assign({}, R.project, { start: '2026-04-01', end: '2026-12-31', jobId: 'RND-OLD', io: '', note: '' }) }), 100000, '나', { localAt: 9000 });
    assert.deepStrictEqual([m2b.doc.project.start, m2b.doc.project.end, m2b.localChanged.project], ['2026-04-01', '2026-12-31', false]);
    local.projects.P1.extra = { ws: true };
    assert.strictEqual(D.mergeYear(D.fromLocalYear('P1', 1, local, META), R, 100000, '나', at()).localChanged.project, false, '받아 둔 모르는 칸(extra)까지 같으면 로컬은 안 바뀜');
    delete local.projects.P1.extra;
    // 파일 쪽이 더 새로우면 빈 값으로 지우는 것도 받는다(되치기 방지)
    const R2 = Object.assign({}, R, { project: Object.assign({}, R.project, { jobId: '' }), updatedAt: new Date(20000).toISOString() });
    const m3 = D.mergeYear(D.fromLocalYear('P1', 1, local, META), R2, 100000, '나', at());
    assert.deepStrictEqual([m3.doc.project.jobId, m3.localChanged.project, m3.parts.project.at], ['', true, 20000]);
    // 로컬 시각이 없으면(0) 파일 것
    assert.strictEqual(D.mergeYear(D.fromLocalYear('P1', 1, local, META), R, 100000, '나').doc.project.jobId, 'RND-NEW');
    // 별칭: 같은 시각이면 파일 · 로컬이 더 새로우면 로컬 · 로컬 시각 없고 파일 별칭 있으면 파일 · 로컬 별칭이 다른데 시각이 없으면 지금
    const withAlias = (a, t) => { const l = localOf(); l.aliases.P1 = a; if (t) l.aliasesAt.P1 = t; else delete l.aliasesAt.P1; return D.fromLocalYear('P1', 1, l, META); };
    assert.deepStrictEqual([D.mergeYear(withAlias('A', 20), R, 1, '나').doc.project.alias, D.mergeYear(withAlias('A', 30), R, 1, '나').doc.project.alias, D.mergeYear(withAlias('', 0), R, 999, '나').doc.project.alias, D.mergeYear(withAlias('B', 0), R, 999, '나').doc.project.aliasAt], ['SSCB2', 'A', 'SSCB2', 999]);
    // want.alias 를 끄면 별칭은 파일 그대로(받지도 올리지도 않음)
    const off = D.mergeYear(withAlias('A', 99), R, 1, '나', { want: { alias: false } });
    assert.deepStrictEqual([off.doc.project.alias, off.doc.project.aliasAt, off.localChanged.alias], ['SSCB2', 20, false]);
  });

  await test('mergeYear budget: 내용이 다르면 at 큰 쪽(같으면 로컬) · 빈 쪽은 못 이김(로컬 budget null = 기본값) · 이긴 줄이 사업비 계획의 budget 에도 비침 · 같은 내용이면 at·by 만 맞춤', () => {
    const local = localOf();
    const L = D.fromLocalYear('P1', 1, local, META);   // 예산 줄 at 1000(계획의 at)
    const mk = (rows, planAt) => Object.assign(D.emptyYear({ prjNo: 'P1', prjNm: '과제1' }, 1), { budget: rows, staff: { plans: planAt ? [splan('P1', 1, planAt, [person('옛것', [1])])] : [], del: {} }, updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: 'WORKSPACE' });
    // WORKSPACE 가 더 늦게 고친 예산 줄 → 받고, 내 계획(at 1000 > 파일 계획 500)은 남되 그 budget 은 파일 줄로 비침
    const m = D.mergeYear(L, mk([{ name: '인건비', plan: 40000000, at: 3000, by: 'WORKSPACE' }], 500), 100000, '나');
    assert.deepStrictEqual([m.doc.budget, m.localChanged.budget, m.localChanged.staff, m.remoteChanged], [[{ name: '인건비', plan: 40000000, at: 3000, by: 'WORKSPACE' }], true, true, true]);
    assert.deepStrictEqual([m.doc.staff.plans[0].people[0].name, m.doc.staff.plans[0].budget, m.doc.staff.plans[0].at], ['문창재', [{ name: '인건비', plan: 40000000 }], 1000], '내 계획이 이기되 budget 은 이긴 줄');
    assert.deepStrictEqual(m.parts.budget, { year: 1, rows: m.doc.budget, at: 3000, by: 'WORKSPACE' });
    // 파일 예산 줄이 이기면 계획의 budgetPay(참여인력 카드의 인건비 예산)도 따라온다 — 로컬 계획은 31,425,000 이었다
    assert.deepStrictEqual([m.doc.staff.plans[0].budgetPay, m.parts.staff.plans[0].budgetPay], [40000000, 40000000], '비친 줄에 맞춰 budgetPay 도(KRX_STAFF.budgetPayOf)');
    const noPay = D.mergeYear(L, mk([{ name: '연구활동비', plan: 9, at: 3000, by: 'WS' }]), 100000, '나');
    assert.deepStrictEqual([noPay.doc.staff.plans[0].budget, noPay.doc.staff.plans[0].budgetPay], [[{ name: '연구활동비', plan: 9 }], null], '인건비 줄이 없으면 null(lib/staff-ui.js syncPay 와 같음)');
    // 내 줄이 더 새로우면(계획 at 1000 > 파일 줄 at 300) 내 것 → 파일 바뀜, 로컬 안 바뀜
    const m2 = D.mergeYear(L, mk([{ name: '인건비', plan: 40000000, at: 300, by: 'WORKSPACE' }]), 100000, '나');
    assert.deepStrictEqual([m2.doc.budget.map((r) => [r.name, r.plan, r.at]), m2.localChanged.budget, m2.remoteChanged], [[['인건비', 31425000, 1000], ['연구활동비', 5000000, 1000]], false, true]);
    // 같은 at 이면 로컬
    const m3 = D.mergeYear(L, mk([{ name: '인건비', plan: 1, at: 1000, by: 'WORKSPACE' }]), 100000, '나');
    assert.deepStrictEqual([m3.doc.budget[0].plan, m3.localChanged.budget], [31425000, false]);
    // 로컬 budget 이 null(기본값) 이면 파일 줄을 받는다 — 계획 at 가 커도
    local.staff.plans['P1@1'].budget = null;
    const m4 = D.mergeYear(D.fromLocalYear('P1', 1, local, META), mk([{ name: '인건비', plan: 7, at: 1, by: 'WS' }]), 100000, '나');
    assert.deepStrictEqual([m4.doc.budget, m4.localChanged.budget, m4.doc.staff.plans[0].budget, m4.doc.staff.plans[0].budgetPay], [[{ name: '인건비', plan: 7, at: 1, by: 'WS' }], true, [{ name: '인건비', plan: 7 }], 7]);
    // 파일 줄이 비면 로컬 것(지우기는 전파하지 않음)
    const m5 = D.mergeYear(L, mk([]), 100000, '나');
    assert.deepStrictEqual([m5.doc.budget.length, m5.localChanged.budget, m5.remoteChanged], [2, false, true]);
    // 같은 내용 · 파일 at 가 더 크면 at·by 만 파일 것으로(로컬 변경 아님, 예산 줄로는 파일도 그대로) · 내 at 가 더 크면 내 at·by 로 파일만 맞춤
    const rows5000 = BUDGET.map((r) => Object.assign({}, r, { at: 5000, by: 'WS' }));
    assert.deepStrictEqual(D.mergeBudget(L.budget, rows5000, true), { rows: rows5000, localChanged: false, remoteChanged: false });
    assert.deepStrictEqual(D.mergeBudget(L.budget, BUDGET.map((r) => Object.assign({}, r, { at: 1, by: 'WS' })), true), { rows: L.budget, localChanged: false, remoteChanged: true });
    const m6 = D.mergeYear(L, mk(rows5000), 100000, '나');
    assert.deepStrictEqual([m6.doc.budget[0].at, m6.doc.budget[0].by, m6.localChanged.budget], [5000, 'WS', false]);
    // 끄면 파일 그대로
    const m7 = D.mergeYear(L, mk([{ name: '인건비', plan: 1, at: 1, by: 'WS' }]), 100000, '나', { want: { budget: false } });
    assert.deepStrictEqual([m7.doc.budget[0].plan, m7.localChanged.budget, m7.parts.budget, m7.doc.staff.plans[0].budget], [1, false, null, BUDGET], '비치지도 않음');
  });

  await test('mergeYear changes: id 합집합(둘 다 있으면 파일 것) · (date, at, id) 차례 · 500 개 상한(오래된 것부터 버림) · 로컬·파일 바뀜 판정 · 끄면 파일 그대로', () => {
    const L = D.fromLocalYear('P1', 1, localOf(), META);   // c10(10-01) · c20(10-05)
    const R = Object.assign(D.emptyYear({ prjNo: 'P1', prjNm: '과제1' }, 1), { changes: [change('c15', '2026-10-03', '예산', 'ws', '1', '2', { by: '', at: 0, auto: true, key: 'yaml' }), change('c20', '2026-10-05', '연구진', '참여연구원', '', '홍길동(파일)')], updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: 'WS' });
    const m = D.mergeYear(L, R, 100000, '나');
    assert.deepStrictEqual(m.doc.changes.map((c) => [c.id, c.after]), [['c10', '6,000천원'], ['c15', '2'], ['c20', '홍길동(파일)']], '파일 것이 같은 id 를 덮음');
    assert.deepStrictEqual([m.localChanged.changes, m.remoteChanged, m.doc.changes[1].key, m.doc.changes[1].auto], [true, true, 'yaml', true]);
    assert.deepStrictEqual(m.parts.changes, m.doc.changes);
    // 둘이 같으면 안 바뀜
    const same = D.mergeYear(L, Object.assign({}, R, { changes: L.changes }), 100000, '나');
    assert.deepStrictEqual([same.localChanged.changes, same.remoteChanged], [false, true], '변경이력은 같고(파일에 budget 등이 없어 파일은 바뀜)');
    // 500 개 상한
    const many = []; for (let i = 0; i < 520; i++) many.push(change(`m${String(i).padStart(4, '0')}`, `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`, '기타', `x${i}`, '', '', { at: i }));
    const big = D.mergeYear(L, Object.assign({}, R, { changes: many }), 100000, '나');
    assert.strictEqual(big.doc.changes.length, 500);
    assert.ok(big.doc.changes.some((c) => c.id === 'c20') && big.doc.changes.some((c) => c.id === 'c10'), '내 10월 줄은 남는다');
    assert.ok(!big.doc.changes.some((c) => c.id === 'm0000'), '1월 1일의 가장 오래된 것부터 버림');
    assert.strictEqual(big.remoteChanged, true);
    // 끄면
    const off = D.mergeYear(L, R, 100000, '나', { want: { changes: false } });
    assert.deepStrictEqual([off.doc.changes.map((c) => c.id), off.localChanged.changes, off.parts.changes], [['c15', 'c20'], false, null]);
  });

  await test('mergeYear staff·research·연차 기간: 연차별 at · 묘비 · 판 → 넣은 시각 · year.start/end 는 계획의 from/to · 끈 칸은 파일 그대로 · 모르는 최상위 칸 보존', () => {
    const local = localOf();
    const L = D.fromLocalYear('P1', 1, local, META);
    const R = Object.assign(D.emptyYear({ prjNo: 'P1', prjNm: '과제1' }, 1), {
      year: { n: 1, start: '2026-01', end: '2026-12' }, workspace: { note: '보존' },
      staff: { plans: [splan('P1', 1, 3000, [person('새사람', [1000000], 5000000)], { from: '2026-05', to: '2026-12' })], del: {} },
      research: [D.cleanRec(rec('P1', 1, 'r3', 2, { goals: ['새 판'] })), D.cleanRec(rec('P1', 2, 'r0', 1))],   // 2차 기록은 1차 파일에 들어가지 않음(normalize 가 뺌)
      updatedAt: '2026-10-18T01:00:00.000Z', updatedBy: '동료' });
    const m = D.mergeYear(L, R, 100000, '나');
    assert.deepStrictEqual([m.doc.staff.plans[0].people[0].name, m.doc.staff.plans[0].at, m.localChanged.staff], ['새사람', 3000, true], '파일 계획(3000)이 내 것(1000)보다 새로움');
    assert.deepStrictEqual(m.doc.year, { n: 1, start: '2026-05', end: '2026-12' }, '연차 기간은 이긴 계획의 from/to');
    assert.deepStrictEqual([m.doc.research.map((r) => [r.n, r.rev]), m.parts.research.fromRemote, m.localChanged.research], [[[1, 'r3']], { 'mw급과제#1': true }, true]);
    assert.deepStrictEqual([m.doc.workspace, m.doc.budget.map((r) => r.plan)], [{ note: '보존' }, [31425000, 5000000]], '모르는 칸 보존 · 파일에 예산 줄이 없어 내 것(파일 계획의 budget 에도 비침)');
    assert.deepStrictEqual(m.doc.staff.plans[0].budget, [{ name: '인건비', plan: 31425000 }, { name: '연구활동비', plan: 5000000 }]);
    // 묘비가 계획보다 새로우면 지움
    const gone = D.mergeYear(L, Object.assign({}, R, { staff: { plans: [], del: { 'P1@1': 5000 } } }), 100000, '나');
    assert.deepStrictEqual([gone.doc.staff.plans, gone.doc.staff.del, gone.localChanged.staff, gone.doc.year], [[], { 'P1@1': 5000 }, true, { n: 1, start: '2026-01', end: '2026-12' }], '계획이 없으면 연차 기간은 파일 것');
    // 끈 칸
    const off = D.mergeYear(L, R, 100000, '나', { want: { staff: false, research: false } });
    assert.deepStrictEqual([off.doc.staff.plans[0].people[0].name, off.doc.research.map((r) => r.rev), off.localChanged.staff, off.localChanged.research, off.parts.staff, off.parts.research], ['새사람', ['r3'], false, false, null, null]);
    // 파일이 없을 때 끈 칸은 빈 값(내 자료를 올리지 않음)
    const off2 = D.mergeYear(L, null, 100000, '나', { want: { staff: false, budget: false, changes: false } });
    assert.deepStrictEqual([off2.doc.staff, off2.doc.budget, off2.doc.changes, off2.doc.research.length], [{ plans: [], del: {} }, [], [], 1]);
    // 같은 연구내용 기록이 두 과제 파일에(others) — 파일에만 있어도 "받았다" 고 하지 않는다
    const l2 = localOf(); l2.research['mw급과제#1'].linkBy = 'user';
    const L2 = D.fromLocalYear('P2', 1, l2, { prjNm: '과제2' });
    const R2 = Object.assign(D.emptyYear({ prjNo: 'P2', prjNm: '과제2' }, 1), { research: [D.cleanRec(rec('P2', 1, 'r2', 3)), D.cleanRec(rec('P2', 1, 'r0', 1, { id: '다른#1', name: '다른' }))], updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '동료' });
    const o = D.mergeYear(L2, R2, 100000, '나', { others: D.otherRecs('P2', l2) });
    assert.deepStrictEqual([o.localChanged.research, o.parts.research.fromRemote, o.doc.research.map((r) => r.id).sort()], [false, {}, ['mw급과제#1', '다른#1']]);
  });

  await test('toLocalYear: 그 과제·연차 몫만 갈아 넣고 다른 연차·과제는 그대로 — staff 키 · budget(plans 의 그 연차 계획에 비침) · 받은 기록은 과제에 잇고(user 유지·src) · changes 키 · 별칭 · project(WORKSPACE 몫·at)', () => {
    const local = localOf();
    local.research['mw급과제#1'].linkBy = 'user';
    local.staff.del['P1@1'] = 5;   // 내 묘비(5) — 파일 계획(5000)이 새로워 폐기된다
    const L = D.fromLocalYear('P1', 1, local, META);
    const R = Object.assign(D.emptyYear({ prjNo: 'P1', prjNm: '과제1', alias: 'SSCB2', aliasAt: 20, jobId: 'RND1', io: 'IO1' }, 1), {
      budget: [{ name: '인건비', plan: 40000000, at: 3000, by: 'WS' }],
      staff: { plans: [splan('P1', 1, 5000, [person('새사람', [1000000], 5000000)])], del: {} },
      research: [D.cleanRec(rec('P1', 1, 'r3', 2)), D.cleanRec(rec('P1', 1, 'r0', 1, { id: '새것#1', name: '새것' }))],
      changes: [change('c15', '2026-10-03', '예산', 'ws', '1', '2')], updatedAt: new Date(7000).toISOString(), updatedBy: 'WS' });
    const m = D.mergeYear(L, R, 100000, '나');
    assert.deepStrictEqual(m.localChanged, { budget: true, staff: true, research: true, changes: true, alias: true, project: true });
    const back = D.toLocalYear('P1', 1, local, m, { src: 'SSCB/1차년도.json' });
    // 사업비: P1@1 만 바뀜, P1@2 · P2@1 · 옛 키 P1 그대로(옛 키는 연차가 없어 이 연차 몫이 아님)
    assert.deepStrictEqual(Object.keys(back.staff.plans).sort(), ['P1', 'P1@1', 'P1@2', 'P2@1']);
    assert.deepStrictEqual([back.staff.plans['P1@1'].people[0].name, back.staff.plans['P1@1'].budget, back.staff.plans['P1@2'], back.staff.del], ['새사람', [{ name: '인건비', plan: 40000000 }], local.staff.plans['P1@2'], { 'P1@3': 30, 'P2@2': 20 }], '내 묘비 P1@1(5) 은 계획(5000)이 새로워 폐기');
    // 예산 줄 — 그 연차 줄만(계획 쪽은 staff 가 비춘 budget 으로 간다)
    assert.deepStrictEqual(back.budget, { year: 1, budget: [{ name: '인건비', plan: 40000000, at: 3000, by: 'WS' }], at: 3000, by: 'WS' });
    // 연구내용: 1차는 user 연결 유지·src · 새것은 auto 로 잇고 · 2차·다른 과제 기록 그대로
    assert.deepStrictEqual(Object.keys(back.research.map).sort(), ['mw급과제#1', 'mw급과제#2', '다른#1', '새것#1', '안이음#1']);
    assert.deepStrictEqual([back.research.map['mw급과제#1'].rev, back.research.map['mw급과제#1'].linkBy, back.research.map['mw급과제#1'].src, back.research.map['새것#1'].linkBy, back.research.map['새것#1'].prjNm, back.research.map['새것#1'].src], ['r3', 'user', 'SSCB/1차년도.json', 'auto', '과제1', 'SSCB/1차년도.json']);
    assert.strictEqual(back.research.map['mw급과제#2'], local.research['mw급과제#2']);
    assert.deepStrictEqual([back.research.ids, back.research.year, back.research.yearRecs.map((r) => r.id)], [['mw급과제#1', '새것#1', 'mw급과제#2'], 1, ['mw급과제#1', '새것#1']], 'recs 는 이 과제 기록 전부(차년도 차례) · yearRecs 는 이 연차 것');
    // 변경이력
    assert.deepStrictEqual([back.changes.key, back.changes.year, back.changes.list.map((c) => c.id), back.changes.all['P1@1'].length, back.changes.all['P1@2'].map((c) => c.id), back.changes.all['P2@1'].length], ['P1@1', 1, ['c10', 'c15', 'c20'], 3, ['c30'], 1]);
    // 별칭
    assert.deepStrictEqual(back.alias, { alias: 'SSCB2', aliasAt: 20, aliases: { P1: 'SSCB2', P2: 'X' }, aliasesAt: { P1: 20 } });
    // project: WORKSPACE 몫(jobId·io·start·end·note)과 받은 시각만(ERP 칸·별칭은 넣지 않음 — 배선이 그대로 shareProjects[prj] 에 겹친다). 파일(7000)이 로컬이 받은 시각(0)보다 뒤라 빈 start/end 도 받는다
    assert.deepStrictEqual(back.project, { jobId: 'RND1', io: 'IO1', start: '', end: '', note: '', at: 7000 });
    assert.deepStrictEqual(back.research.others, {}, '이 과제 기록만 받았으면 others 는 비어 있다');
    // 다른 과제(P2)에 이어 둔 기록이 이 파일에서 새 글을 받으면 — 연결은 그대로, 글만 새것, research.others 로 따로(배선이 그 과제 몫(recs)과 함께 저장해야 매 동기화마다 다시 "받은 것" 이 되지 않는다)
    const l3 = localOf();
    const R3 = Object.assign(D.emptyYear({ prjNo: 'P1', prjNm: '과제1' }, 1), { research: [D.cleanRec(rec('P1', 1, 'r2', 5, { id: '다른#1', name: '다른', goals: ['새 글'] }))], updatedAt: new Date(8000).toISOString(), updatedBy: 'WS' });
    const m3 = D.mergeYear(D.fromLocalYear('P1', 1, l3, META), R3, 100000, '나', { others: D.otherRecs('P1', l3) });
    const b3 = D.toLocalYear('P1', 1, l3, m3, { src: 'SSCB/1차년도.json' });
    assert.deepStrictEqual([m3.localChanged.research, Object.keys(b3.research.others), b3.research.others['다른#1'].prjNo, b3.research.others['다른#1'].rev, b3.research.others['다른#1'].goals, b3.research.others['다른#1'].src, b3.research.map['다른#1'].rev, b3.research.ids.includes('다른#1')],
      [true, ['다른#1'], 'P2', 'r2', ['새 글'], undefined, 'r2', false], 'P2 연결 그대로(src 도 안 바꿈) · 글은 r2 · 이 과제 recs 에는 없음');
    // 끈 칸(parts null)은 로컬 그대로
    const off = D.toLocalYear('P1', 1, local, D.mergeYear(L, R, 100000, '나', { want: { budget: false, staff: false, research: false, changes: false } }));
    assert.deepStrictEqual([off.staff.plans, off.staff.del, off.budget, off.research.ids, off.changes.list.map((c) => c.id), off.changes.all], [local.staff.plans, { 'P1@3': 30, 'P2@2': 20, 'P1@1': 5 }, null, ['mw급과제#1', 'mw급과제#2'], ['c10', 'c20'], local.changes]);
    // 별칭을 지운 쪽이 새로우면 로컬에서도 지운다
    const gone = D.toLocalYear('P1', 1, local, D.mergeYear(L, Object.assign({}, R, { project: Object.assign({}, R.project, { alias: '', aliasAt: 99 }) }), 1, '나'));
    assert.deepStrictEqual(gone.alias, { alias: '', aliasAt: 99, aliases: { P2: 'X' }, aliasesAt: { P1: 99 } });
  });

  await test('mergePlan · toLocalPlan: KRX_PLAN_SYNC.merge 그대로(id 별 ts·묘비) · 과제명은 ERP 값 · 모르는 칸 보존 · 끄면 파일 그대로 · 로컬 전체 구조에 되돌려 넣기(묘비 { ts, prj })', () => {
    const local = localOf();
    const L = D.fromLocalPlan('P1', local, META);
    const m0 = D.mergePlan(L, null, 100000, '나');
    assert.deepStrictEqual([m0.remoteChanged, m0.localChanged, m0.doc.project, m0.doc.plan.items.map((e) => e.id).sort(), m0.doc.plan.del, m0.doc.updatedAt], [true, { plan: false }, { prjNo: 'P1', prjNm: '과제1' }, ['a', 'b', 'c'], { d: 9, f: 8 }, '1970-01-01T00:01:40.000Z']);
    assert.deepStrictEqual(D.countOfPlan(m0.doc), { plan: 3 });
    const again = D.mergePlan(L, D.parse(D.serialize(m0.doc)).doc, 200000, '나');
    assert.deepStrictEqual([again.remoteChanged, again.localChanged.plan], [false, false]);
    const R = { v: 2, kind: 'plan', project: { prjNo: 'P1', prjNm: '파일 과제명', ws: 1 }, extra: true, plan: { items: [item('a', 5, { prj: 'P1', key: '10|연구활동비' }), item('g', 50, { key: '10|연구활동비', by: '동료' })], del: { b: 60, c: 1 } }, updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '동료' };
    const m = D.mergePlan(L, R, 100000, '나');
    assert.deepStrictEqual([m.localChanged.plan, m.remoteChanged, m.doc.project, m.doc.extra], [true, true, { prjNo: 'P1', prjNm: '과제1', ws: 1 }, true]);
    assert.deepStrictEqual([m.doc.plan.items.map((e) => e.id).sort(), m.doc.plan.del], [['a', 'c', 'g'], { b: 60, d: 9, f: 8 }], 'g 받음 · b 묘비 받음 · c 묘비(1)는 항목(7)이 새로워 폐기');
    const back = D.toLocalPlan('P1', local, m);
    assert.deepStrictEqual(Object.keys(back.plan.plans).sort(), ['P1', 'P2']);
    assert.deepStrictEqual(back.plan.plans.P1['10|연구활동비'].map((e) => e.id), ['a', 'g']);
    assert.deepStrictEqual(back.plan.plans.P1['10|장비비'].map((e) => e.id), ['c']);
    assert.deepStrictEqual(back.plan.plans.P2, local.plan.plans.P2);
    assert.deepStrictEqual(back.plan.del, { e: { ts: 9, prj: 'P2' }, b: { ts: 60, prj: 'P1' }, d: { ts: 9, prj: 'P1' }, f: { ts: 8, prj: 'P1' } });
    const off = D.mergePlan(L, R, 100000, '나', { want: { plan: false } });
    assert.deepStrictEqual([off.doc.plan.items.map((e) => e.id), off.localChanged.plan, off.parts.plan, off.remoteChanged], [['a', 'g'], false, null, true], '과제명만 ERP 값으로 바뀜');
    assert.deepStrictEqual(D.toLocalPlan('P1', local, off).plan, { plans: local.plan.plans, del: local.plan.del });
  });

  })();
}

/* ---------- prjdoc-sync — kr_ext_rerp tests/prjdoc-sync.test.js 그대로 ---------- */
/* lib/prjdoc-sync.js v2 (확장 Plus — base/<과제 폴더>/<n>차년도.json · 예상비용.json ↔ 로컬 동기화 차례, 2026-10-18 저녁) 테스트 — 가짜 store(메모리 폴더 트리: listFolders/childCfg/listFiles/readFile/openWriter(ensureFolder·ensurePath·at·modify)/sharedWithMe/parseFolder)와 가짜 로컬로:
 * 처음(업무/shared 와 과제 폴더 만들기 — 이름 규칙 약칭 → Job Id → 과제번호, 책임자 아닌데 로컬 자료 없으면 noFolder) · 연차 파일 둘 + 예상비용.json 생성·갱신 · 동료 변경 받기(칸마다 saveLocal) · 변경이력 합집합 · project 칸 규칙 · 모르는 칸 보존 ·
 * 나와 공유에서 찾은 다른 사이트 폴더(writer 가 사이트마다 따로) · 색인 적중/불일치 · 깨진 파일·v1 파일 건너뜀 · locked · auth/tab 전체 실패(나와 공유 끝점의 auth 는 discoverError 만) · want · pull 다시 병합 · 내가 남긴 체크아웃 · only · at 없는 writer · pages 호환 칸 ·
 * (2026-10-18 검토 반영) 같은 약칭의 두 과제는 <이름>-<과제번호> 로 비켜 감 · 체크아웃한 최신 글이 남의 과제 것이면 쓰지 않고 다시 고름 · 이미 있던 폴더는 created 아님 · 색인에 남은 동료 폴더가 없어졌으면 동료 사이트에 만들지 않음(alt → 내 base → noFolder) · 예상비용.json 만 남의 것이면 그 파일만 parse.
 * 실 SharePoint 에는 닿지 않는다. 실행: node tests/prjdoc-sync.test.js */
{
  const D = PRJDOC, Y = PRJDOC_SYNC, S = STAFF;

  /* ---------- 자료 예 (저장소 모양 그대로) ---------- */
  const item = (id, ts, extra) => Object.assign({ id, name: `항목 ${id}`, qty: 1, unit: 1000, amt: 1000, ts }, extra || {});
  const rec = (prjNo, nn, rev, at, extra) => Object.assign({ id: `mw급과제#${nn}`, name: 'MW급 과제', code: 'RS-1', n: nn, rev, tag: '', file: 'KR_x.yaml', at, agree: '', period: '', role: '공동', lead: '김거화', note: '',
    goals: [`${nn}차 목표`], contents: [], perf: [], outputs: [], schedule: null, spend: [], budget: [], roster: [], prjNo, prjNm: prjNo ? '과제1' : '', linkBy: prjNo ? 'auto' : '' }, extra || {});
  const person = (name, amts, monthly) => S.normalizePerson({ id: name, name, role: '연구원', manual: monthly, plan: amts.map((amt, i) => ({ ym: `2026-${String(i + 4).padStart(2, '0')}`, amt })) });
  const BUDGET = [{ name: '인건비', plan: 31425000 }, { name: '연구활동비', plan: 5000000 }];
  const splan = (prjNo, year, at, people, extra) => Object.assign({ prjNo, year, prjNm: '과제1', from: year === 1 ? '2026-04' : '2027-01', to: year === 1 ? '2026-12' : '2027-12', budgetPay: 31425000, budget: BUDGET, basis: 'rerp', src: 'erp', people, at, by: '김거화', note: '' }, extra || {});
  const change = (id, date, kind, item, before, after, extra) => Object.assign({ id, date, kind, item, before, after, reason: '', by: '나', at: Number(id.replace(/\D/g, '')) || 0, auto: false }, extra || {});
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const err = (kind, msg) => Object.assign(new Error(msg || kind), { kind });
  const ORIGIN = 'https://krclass-my.sharepoint.com';
  const ME = '/personal/me', YOU = '/personal/you';
  const BASE = `${ME}/Documents/업무/shared`, YOUR_BASE = `${YOU}/Documents/업무/shared`;
  /* 폴더 경로 → cfg (KRX_SP.parseFolder 결과 꼴 가운데 prjdoc-sync 가 쓰는 칸) */
  const cfgOf = (p) => { const site = `${ORIGIN}${p.split('/').slice(0, 3).join('/')}`; return { origin: ORIGIN, siteUrl: site, folderPath: p, name: p.split('/').pop(), url: `${ORIGIN}${p}`, viewUrl: `${site}/_layouts/15/onedrive.aspx?id=${encodeURIComponent(p)}`, fileUrl: (nm) => `${ORIGIN}${p}/${nm}` }; };
  const siteOf = (p) => `${ORIGIN}${p.split('/').slice(0, 3).join('/')}`;

  /* 가짜 store — tree: { [폴더 경로]: { [파일 이름]: 글 } }(키가 있으면 폴더 — 빈 객체도). opts = { locked:[경로/이름], mine:[경로/이름](내가 남긴 체크아웃), authList, openFail, denied:[사이트](그 사이트는 readFile·listFiles·openWriter 가 auth),
   *   beforeModify(path, name, tree), shared:[{ path, ownerName }](나와 공유 — 폴더 항목), sharedFail(kind), noAt(writer.at 없음 — 폴더마다 하나 더 연다), noEnsurePath(writer.ensurePath 없음 — 한 단씩) } */
  function fakeStore(tree, opts) {
    opts = opts || {};
    const calls = [];
    const mine = new Set(opts.mine || []);
    const meta = (p, name) => ({ name, length: tree[p][name].length, modified: '2026-10-18T00:00:00Z', version: '1.0', uniqueId: `u-${name}`, checkedOut: mine.has(`${p}/${name}`), checkedOutByMe: mine.has(`${p}/${name}`) });
    const nofolder = (p) => err('nofolder', `공유 폴더가 없습니다: ${p}`);
    const denied = (cfg) => (opts.denied || []).includes(siteOf(cfg.folderPath));
    const bound = (p) => {
      const w = {
        folderPath: p,
        ensureFolder: async () => { calls.push(`ensureFolder:${p}`); if (p in tree) return { created: false }; const parent = p.replace(/\/[^/]*$/, ''); if (!(parent in tree)) throw nofolder(parent); tree[p] = {}; return { created: true }; },
        modify: async (name, transform) => {
          calls.push(`modify:${p}/${name}`);
          if (!(p in tree)) throw nofolder(p);
          const key = `${p}/${name}`;
          if ((opts.locked || []).includes(key)) throw err('locked', `${name} 을(를) 다른 사람이 체크아웃했습니다`);
          if (opts.beforeModify) opts.beforeModify(p, name, tree);
          const cur = name in tree[p] ? tree[p][name] : null;
          const r = transform(cur);
          if (r && r.changed) { tree[p][name] = r.text; mine.delete(key); calls.push(`put:${key}`); return { changed: true, created: cur == null, updated: cur != null, checkedIn: cur != null, version: '2.0' }; }
          if (cur != null && mine.has(key) && !(r && r.discard)) { mine.delete(key); calls.push(`checkin:${key}`); return { changed: false, checkedIn: true, version: '2.0' }; }
          calls.push(`undo:${key}`); return { changed: false, checkedIn: false };
        },
        close: async () => { calls.push(`close:${p}`); },
      };
      if (!opts.noEnsurePath) w.ensurePath = async (pp) => {   // KRX_SP(spEnsureFolder) 처럼: 있는 가장 깊은 단을 찾아 거기서부터 만들고 { created, made } — 다 있으면 made 비움(성근 시험 트리라 문서함 뿌리(3단)까지 없으면 뿌리도 만든다)
        calls.push(`ensurePath:${pp}`);
        const segs = pp.split('/').filter(Boolean), at = (d) => `/${segs.slice(0, d).join('/')}`;
        let d = segs.length;
        while (d > 3 && !(at(d) in tree)) d--;
        const made = [];
        if (!(at(d) in tree)) { tree[at(d)] = {}; made.push(at(d)); }
        for (let i = d + 1; i <= segs.length; i++) { tree[at(i)] = {}; made.push(at(i)); }
        return { created: made.length > 0, made };
      };
      if (!opts.noAt) w.at = (cfg) => bound(cfg.folderPath);
      return w;
    };
    return {
      calls, tree, mine,
      listFolders: async (cfg, io) => { calls.push(`folders:${cfg.folderPath}`); assert.ok(io && typeof io === 'object', 'io 를 넘긴다'); if (opts.authList) throw err('auth', '이 브라우저에서 SharePoint(OneDrive)에 로그인하세요'); if (denied(cfg)) throw err('auth', '권한 없음'); if (!(cfg.folderPath in tree)) throw nofolder(cfg.folderPath); return Object.keys(tree).filter((k) => k.startsWith(`${cfg.folderPath}/`) && !k.slice(cfg.folderPath.length + 1).includes('/')).map((k) => ({ name: k.split('/').pop(), path: k, itemCount: Object.keys(tree[k]).length, modified: '2026-10-18T00:00:00Z' })); },
      childCfg: (cfg, name) => cfgOf(`${cfg.folderPath}/${name}`),
      listFiles: async (cfg) => { calls.push(`list:${cfg.folderPath}`); if (denied(cfg)) throw err('auth', '권한 없음'); if (!(cfg.folderPath in tree)) throw nofolder(cfg.folderPath); return Object.keys(tree[cfg.folderPath]).map((nm) => meta(cfg.folderPath, nm)); },
      readFile: async (cfg, name) => { calls.push(`read:${cfg.folderPath}/${name}`); if (denied(cfg)) throw err('auth', '권한 없음'); const f = tree[cfg.folderPath]; return f && name in f ? { text: f[name], meta: meta(cfg.folderPath, name) } : null; },
      openWriter: async (cfg) => { calls.push(`open:${siteOf(cfg.folderPath)}`); if (opts.openFail) throw err(opts.openFail, '작업 탭을 열 수 없습니다'); if (denied(cfg)) throw err('auth', '권한 없음'); return bound(cfg.folderPath); },
      sharedWithMe: async (io, o) => { calls.push('shared'); assert.ok(o && 'driveHost' in o); if (opts.sharedFail) throw err(opts.sharedFail, '나와 공유 실패'); return (opts.shared || []).map((s) => ({ name: s.path.split('/').pop(), webUrl: furl(s.path), folder: true, ownerName: s.ownerName || '', cfg: cfgOf(s.path) })); },
      parseFolder: (url) => cfgOf(decodeURIComponent(new URL(url).pathname)),   // KRX_SP.parseFolder 처럼 경로를 디코딩
      folderUrl: (cfg) => furl(cfg.folderPath),
    };
  }
  /* 폴더 주소 — KRX_SP.folderUrl 처럼 칸마다 encodeURIComponent */
  const furl = (p) => `${ORIGIN}${p.split('/').map(encodeURIComponent).join('/')}`;
  /* 가짜 로컬 — loadLocal/saveLocal(part, prj, data): background.js 가 할 일을 그대로(그 칸의 전체 구조를 받아 저장). 시각 없는 별칭은 10 으로 찍어 둔다(시각 없는 별칭은 병합이 지금 시각을 매겨 로컬에 저장하므로 — 그 동작은 prjdoc.test.js 에서 본다) */
  function memLocal(init) {
    // projects 는 background.js shareLoadLocal 모양 — ERP 칸(prjNm·rspr·anl)과 ERP 현재 연차 기간 stDt/endDt(yearSpan 용). 과제 전체 기간 start/end 는 WORKSPACE 몫이라 rerp 로컬에는 받아 둔 것(shareProjects)만 있다
    const st = Object.assign({ plan: { plans: {}, del: {} }, research: {}, staff: { plans: {}, del: {} }, aliases: {}, aliasesAt: {}, changes: {}, projects: { P1: { prjNm: '과제1', rspr: '김거화', anl: 1, stDt: '20260401', endDt: '20261231' }, P2: { prjNm: '과제2', rspr: '동료', anl: 1, stDt: '20260101', endDt: '20261231' } } }, clone(init || {}));
    for (const k of Object.keys(st.aliases)) if (st.aliases[k] && !st.aliasesAt[k]) st.aliasesAt[k] = 10;
    const saved = [];
    return {
      st, saved,
      loadLocal: async () => clone(st),
      saveLocal: async (part, prj, data) => {
        saved.push(`${part}:${prj}`);
        if (part === 'plan') { st.plan.plans = clone(data.plans); st.plan.del = clone(data.del); }
        else if (part === 'research') st.research = clone(data.map);
        else if (part === 'staff') { st.staff.plans = clone(data.plans); st.staff.del = clone(data.del); }
        else if (part === 'budget') { const key = `${prj}@${data.year}`; const plan = st.staff.plans[key] || S.normalizePlanEntry({ prjNo: prj, year: data.year }, key); plan.budget = data.budget.map((r) => ({ name: r.name, plan: r.plan })); plan.budgetPay = S.budgetPayOf(plan.budget); st.staff.plans[key] = plan; }   // background.js 처럼 그 연차 계획의 budget(·budgetPay)만(없으면 빈 계획)
        else if (part === 'changes') st.changes[`${prj}@${data.year}`] = clone(data.list);
        else if (part === 'alias') { st.aliases = clone(data.aliases); st.aliasesAt = clone(data.aliasesAt); }
        else if (part === 'project') st.projects[prj] = Object.assign({}, st.projects[prj], clone(data));   // shareProjects[prj] 에 겹치듯
        else throw new Error('모르는 칸 ' + part);
      },
    };
  }
  const deps = (store, mem, extra) => Object.assign({ store, io: { fetch: () => { throw new Error('실 fetch 금지'); } }, base: cfgOf(BASE), driveHost: ORIGIN, names: { P1: '과제1', P2: '과제2' }, rsprs: { P1: '김거화', P2: '동료' }, myPrjNos: ['P1', 'P2'], leadPrjNos: ['P1'], aliases: {}, index: {}, discover: true,
    want: { plan: true, research: true, staff: true, budget: true, changes: true, alias: true }, who: '나', loadLocal: mem.loadLocal, saveLocal: mem.saveLocal, now: 100000 }, extra || {});
  const PAGE_KEYS = ['prjNo', 'title', 'webUrl', 'at', 'created', 'pulled', 'pushed', 'count', 'remoteAt', 'remoteBy'];   // planSyncState.pages 와 호환해야 하는 칸
  const docOf = (store, p, name) => D.parse(store.tree[p][name]).doc;
  const myLocal = () => ({
    plan: { plans: { P1: { '10|연구활동비': [item('a', 5), item('b', 6, { sub: { date: '2026-09-02' }, by: '나' })] } }, del: { x: { ts: 9, prj: 'P1' }, y: { ts: 9, prj: 'P9' } } },
    research: { 'mw급과제#1': rec('P1', 1, 'r2', 3), 'mw급과제#2': rec('P1', 2, 'r1', 4), '안이음#1': rec('', 1, 'r0', 1, { id: '안이음#1', name: '안이음' }) },
    staff: { plans: { 'P1@1': splan('P1', 1, 1000, [person('문창재', [1165000], 5823000)]), 'P1@2': splan('P1', 2, 2000, [person('홍길동', [1000000], 5000000)]) }, del: { 'P1@3': 30 } },
    aliases: { P1: 'SSCB' }, aliasesAt: { P1: 10 },
    changes: { 'P1@1': [change('c10', '2026-10-01', '예산', '연구활동비', '5,000천원', '6,000천원')], 'P1@2': [change('c30', '2026-10-06', '연구기간', '기간', '', '')] },
  });

  await (async () => {
  await test('처음: 업무/shared 도 과제 폴더도 없음 → base 를 만들고(ensurePath) 책임자인 P1 은 약칭 폴더 SSCB 에 1·2차년도.json + 예상비용.json 을 만들며 로컬 전부 올림 · 참여자인 P2 는 로컬 자료가 없어 noFolder(오류 아님) · writer 는 사이트에 하나 · pages·index 모양', async () => {
    const store = fakeStore({ [`${ME}/Documents`]: {} });
    const me = memLocal(myLocal());
    const r = await Y.run(deps(store, me));
    assert.deepStrictEqual([r.state.ok, r.state.count, r.state.written, r.state.files, r.state.pulled, r.state.errors, r.state.created, r.state.scanned], [true, 2, 3, 3, 0, 0, ['P1'], 0]);
    assert.deepStrictEqual([r.state.base, r.state.folder], [{ path: BASE, viewUrl: cfgOf(BASE).viewUrl }, { path: BASE, viewUrl: cfgOf(BASE).viewUrl }]);
    assert.deepStrictEqual(Object.keys(store.tree).sort(), [`${ME}/Documents`, `${ME}/Documents/업무`, BASE, `${BASE}/SSCB`].sort(), '업무 · shared · 과제 폴더(약칭)');
    assert.deepStrictEqual(Object.keys(store.tree[`${BASE}/SSCB`]).sort(), ['1차년도.json', '2차년도.json', '예상비용.json']);
    const y1 = docOf(store, `${BASE}/SSCB`, '1차년도.json'), y2 = docOf(store, `${BASE}/SSCB`, '2차년도.json'), pl = docOf(store, `${BASE}/SSCB`, '예상비용.json');
    assert.deepStrictEqual(y1.project, { prjNo: 'P1', prjNm: '과제1', rspr: '김거화', alias: 'SSCB', aliasAt: 10, jobId: '', io: '', start: '', end: '', note: '' }, 'start/end(과제 전체 기간)는 rerp 가 몰라 비움 — ERP 현재 연차 기간(stDt/endDt)을 넣지 않는다');
    assert.deepStrictEqual([y1.year, y1.budget.map((b) => [b.name, b.plan, b.at, b.by]), y1.staff.plans.map((p) => p.year), y1.staff.del, y1.research.map((x) => [x.id, 'prjNo' in x]), y1.changes.map((c) => c.id), y1.updatedBy, y1.updatedAt],
      [{ n: 1, start: '2026-04', end: '2026-12' }, [['인건비', 31425000, 1000, '김거화'], ['연구활동비', 5000000, 1000, '김거화']], [1], {}, [['mw급과제#1', false]], ['c10'], '나', '1970-01-01T00:01:40.000Z']);
    assert.deepStrictEqual([y2.project, y2.year, y2.staff.plans.map((p) => p.year), y2.research.map((x) => x.n), y2.changes.map((c) => c.id)], [y1.project, { n: 2, start: '2027-01', end: '2027-12' }, [2], [2], ['c30']], 'project 는 연차 파일마다 같은 내용 · 2차년도에는 2차 것만');
    assert.deepStrictEqual([pl.project, pl.plan.items.map((e) => [e.id, e.prj, e.key]), pl.plan.del], [{ prjNo: 'P1', prjNm: '과제1' }, [['a', 'P1', '10|연구활동비'], ['b', 'P1', '10|연구활동비']], { x: 9 }], 'P9 묘비는 P1 파일에 안 실림');
    const pg = r.state.pages.P1;
    for (const k of PAGE_KEYS) assert.ok(k in pg, `pages 에 ${k}`);
    assert.deepStrictEqual([pg.prjNo, pg.title, pg.folder, pg.folderUrl, pg.webUrl, pg.planUrl, pg.owner, pg.years, pg.at, pg.created, pg.folderCreated, pg.pulled, pg.pushed, pg.remoteAt, pg.remoteBy, pg.count, pg.counts],
      ['P1', '과제1', 'SSCB', cfgOf(`${BASE}/SSCB`).viewUrl, `${ORIGIN}${BASE}/SSCB/1차년도.json`, `${ORIGIN}${BASE}/SSCB/예상비용.json`, '', [1, 2], 100000, true, true, false, true, 0, '', 2, { plan: 2, research: 2, staff: 2, budget: 4, changes: 2 }]);
    assert.deepStrictEqual([r.state.pages.P2.noFolder, r.state.pages.P2.kind, r.state.pages.P2.error, r.state.pages.P2.folder], [true, 'nofolder', undefined, '']);
    assert.deepStrictEqual(r.state.index, { P1: { base: BASE, folder: 'SSCB', site: siteOf(BASE), path: `${BASE}/SSCB`, url: furl(`${BASE}/SSCB`), owner: '', at: 100000 } });
    assert.deepStrictEqual(me.saved, [], '로컬은 안 바뀜');
    assert.deepStrictEqual(store.calls.filter((c) => c.startsWith('open') || c.startsWith('close') || c.startsWith('ensure') || c === 'shared'), ['shared', `open:${siteOf(BASE)}`, `ensurePath:${BASE}/SSCB`, `close:${BASE}/SSCB`], 'writer 하나(과제 폴더에서 열어 ensurePath 로 base 까지 한 번에)');
    // 둘 다 같음 → 쓰지 않고 writer 도 안 열며 index 가 맞아 훑지도 않는다
    const n0 = store.calls.length;
    const r2 = await Y.run(deps(store, me, { now: 200000, index: r.state.index }));
    assert.deepStrictEqual([r2.state.ok, r2.state.written, r2.state.pulled, r2.state.scanned, r2.state.pages.P1.pushed, r2.state.pages.P1.pulled, r2.state.pages.P1.remoteBy, r2.state.pages.P1.remoteAt, r2.state.pages.P1.webUrl], [true, 0, 0, 0, false, false, '나', 100000, `${ORIGIN}${BASE}/SSCB/1차년도.json`]);
    assert.ok(!store.calls.slice(n0).some((c) => c.startsWith('open') || c.startsWith('modify')), 'writer 안 열림');
    assert.deepStrictEqual(me.saved, []);
  });

  await test('폴더 이름 규칙: 약칭 → 없으면 Job Id(로컬 projects 의 jobId) → 없으면 과제번호 · ensurePath 가 없는 writer 면 ensureFolder 를 한 단씩 · 같은 이름의 못 알아본 폴더가 있으면 그것을 쓴다', async () => {
    const store = fakeStore({ [`${ME}/Documents/업무`]: {}, [BASE]: {}, [`${BASE}/P5`]: {}, [`${BASE}/메모`]: { '읽어줘.txt': 'x' } }, { noEnsurePath: true });
    const me = memLocal({ aliases: { P3: 'MW' }, projects: { P3: { anl: 1 }, P4: { anl: 2, jobId: 'RND4' }, P5: { anl: 1 } } });
    const r = await Y.run(deps(store, me, { myPrjNos: ['P3', 'P4', 'P5'], leadPrjNos: ['P3', 'P4', 'P5'], names: {} }));
    assert.deepStrictEqual([r.state.ok, Object.keys(r.state.pages).sort(), r.state.scanned], [true, ['P3', 'P4', 'P5'], 2], '알 수 없는 폴더 둘(P5 · 메모)을 훑었다');
    assert.deepStrictEqual([r.state.pages.P3.folder, r.state.pages.P4.folder, r.state.pages.P5.folder, r.state.pages.P4.years, r.state.pages.P5.folderCreated], ['MW', 'RND4', 'P5', [2], undefined], 'P5 는 비어 있던 같은 이름 폴더를 그대로 씀 · 현재 연차 2 인 P4 는 2차년도만');
    assert.deepStrictEqual(Object.keys(store.tree).filter((k) => k.startsWith(`${BASE}/`)).sort(), [`${BASE}/MW`, `${BASE}/P5`, `${BASE}/RND4`, `${BASE}/메모`]);
    assert.deepStrictEqual(Object.keys(store.tree[`${BASE}/P5`]), ['1차년도.json'], '예상 비용이 비면 예상비용.json 은 만들지 않음');
    assert.deepStrictEqual(store.calls.filter((c) => c.startsWith('ensure')), [`ensureFolder:${BASE}/MW`, `ensureFolder:${BASE}/RND4`]);
    assert.deepStrictEqual(r.state.created.sort(), ['P3', 'P4']);
  });

  await test('동료가 고친 파일: 예산 줄(WORKSPACE at)·새 사람(새 at)·높은 판·변경이력·별칭·jobId 를 받아 칸마다 saveLocal, 내 것은 올림 · 다시 돌리면 둘이 같아 쓰지 않음 · 동료가 다시 받으면 내 것이 들어온다', async () => {
    const store = fakeStore({ [BASE]: {} });
    const you = memLocal({ plan: { plans: { P1: { '10|연구활동비': [item('a', 5), item('d', 6, { by: '동료' })] } }, del: {} }, research: { 'mw급과제#1': rec('P1', 1, 'r3', 2, { goals: ['새 판'] }) },
      staff: { plans: { 'P1@1': splan('P1', 1, 3000, [person('새사람', [1000000], 5000000)], { budget: [{ name: '인건비', plan: 40000000 }] }) }, del: {} }, aliases: { P1: 'SSCB' }, aliasesAt: { P1: 10 },
      changes: { 'P1@1': [change('c15', '2026-10-03', '예산', '인건비', '31,425천원', '40,000천원', { by: '동료' })] }, projects: { P1: { prjNm: '과제1', rspr: '김거화', start: '2026-04-01', end: '2026-12-31', anl: 1, jobId: 'RND1', io: 'IO1', at: 1 } } });
    const r0 = await Y.run(deps(store, you, { who: '동료', myPrjNos: ['P1'], leadPrjNos: ['P1'], now: 50000 }));
    assert.deepStrictEqual([r0.state.ok, r0.state.pages.P1.folder, docOf(store, `${BASE}/SSCB`, '1차년도.json').project.jobId], [true, 'SSCB', 'RND1']);
    const me = memLocal({ plan: { plans: { P1: { '10|연구활동비': [item('c', 7)] } }, del: { a: { ts: 9, prj: 'P1' }, y: { ts: 9, prj: 'P9' } } },   // a 는 내가 지움(묘비 9 > ts 5) · y 는 다른 과제 묘비
      research: { 'mw급과제#1': rec('P1', 1, 'r2', 3), 'mw급과제#2': rec('P1', 2, 'r1', 4) }, staff: { plans: { 'P1@1': splan('P1', 1, 1000, [person('문창재', [1165000], 5823000)]), 'P1@2': splan('P1', 2, 2000, [person('홍길동', [1000000], 5000000)]) }, del: {} },
      changes: { 'P1@1': [change('c10', '2026-10-01', '예산', '연구활동비', '5,000천원', '6,000천원')] } });
    const r = await Y.run(deps(store, me, { myPrjNos: ['P1'], leadPrjNos: [] }));   // 나는 참여자 — 로컬 자료가 있어 폴더(이미 있음)를 쓴다
    assert.deepStrictEqual([r.state.ok, r.state.count, r.state.written, r.state.pulled, r.state.files], [true, 1, 3, 1, 3], '1차년도(병합) · 2차년도(새로) · 예상비용(병합)');
    const pg = r.state.pages.P1;
    assert.deepStrictEqual([pg.created, pg.pulled, pg.pushed, pg.remoteBy, pg.remoteAt, pg.title, pg.years, pg.folder], [true, true, true, '동료', 50000, '과제1', [1, 2], 'SSCB']);
    assert.deepStrictEqual(me.saved, ['budget:P1', 'staff:P1', 'research:P1', 'changes:P1', 'alias:P1', 'project:P1', 'plan:P1'], '칸마다 그 과제 몫만(연차 파일 → 예상 비용 파일)');
    assert.deepStrictEqual([me.st.staff.plans['P1@1'].people[0].name, me.st.staff.plans['P1@1'].budget, Object.keys(me.st.staff.plans).sort()], ['새사람', [{ name: '인건비', plan: 40000000 }], ['P1@1', 'P1@2']], '동료 계획(3000 > 1000)과 그 예산 줄');
    assert.deepStrictEqual([me.st.research['mw급과제#1'].rev, me.st.research['mw급과제#1'].goals, me.st.research['mw급과제#1'].linkBy, me.st.research['mw급과제#1'].src, me.st.research['mw급과제#2'].rev], ['r3', ['새 판'], 'auto', 'SSCB/1차년도.json', 'r1']);
    assert.deepStrictEqual(me.st.changes['P1@1'].map((c) => c.id), ['c10', 'c15'], '변경이력 합집합');
    assert.deepStrictEqual([me.st.aliases, me.st.aliasesAt, me.st.projects.P1.jobId, me.st.projects.P1.io, me.st.projects.P1.at], [{ P1: 'SSCB' }, { P1: 10 }, 'RND1', 'IO1', 100000], 'WORKSPACE 몫을 받은 시각 = 이번에 쓴 문서의 updatedAt(now)');
    assert.deepStrictEqual(me.st.plan.plans.P1['10|연구활동비'].map((e) => e.id).sort(), ['c', 'd'], 'd 받음 · a 는 묘비로 안 들어옴');
    assert.deepStrictEqual([Object.keys(me.st.plan.plans), me.st.plan.del], [['P1'], { a: { ts: 9, prj: 'P1' }, y: { ts: 9, prj: 'P9' } }], '다른 과제 묘비 그대로');
    const y1 = docOf(store, `${BASE}/SSCB`, '1차년도.json');
    assert.deepStrictEqual([y1.changes.map((c) => c.id), y1.research.map((x) => x.rev), y1.staff.plans[0].people[0].name, y1.updatedBy, y1.updatedAt, y1.project.jobId], [['c10', 'c15'], ['r3'], '새사람', '나', '1970-01-01T00:01:40.000Z', 'RND1']);
    assert.deepStrictEqual([Object.values(docOf(store, `${BASE}/SSCB`, '예상비용.json').plan.items).map((e) => e.id).sort(), docOf(store, `${BASE}/SSCB`, '예상비용.json').plan.del], [['c', 'd'], { a: 9 }]);
    assert.deepStrictEqual(docOf(store, `${BASE}/SSCB`, '2차년도.json').project.jobId, 'RND1', '2차년도 를 새로 만들 때 1차년도에서 받은 jobId 가 퍼진다');
    // 둘 다 같음
    const n0 = store.calls.length; me.saved.length = 0;
    const r2 = await Y.run(deps(store, me, { myPrjNos: ['P1'], leadPrjNos: [], now: 200000, index: r.state.index }));
    assert.deepStrictEqual([r2.state.written, r2.state.pulled, r2.state.pages.P1.pushed, r2.state.pages.P1.pulled, me.saved], [0, 0, false, false, []]);
    assert.ok(!store.calls.slice(n0).some((c) => c.startsWith('open')));
    // 동료가 다시 받으면 내 것(c · 묘비 a · 2차년도 · 2차 기록 · c10)이 들어온다
    const r3 = await Y.run(deps(store, you, { who: '동료', myPrjNos: ['P1'], leadPrjNos: ['P1'], now: 300000 }));
    assert.deepStrictEqual([r3.state.pages.P1.pulled, r3.state.pages.P1.pushed, you.st.plan.plans.P1['10|연구활동비'].map((e) => e.id).sort(), you.st.plan.del, Object.keys(you.st.staff.plans).sort(), you.st.research['mw급과제#2'].prjNm, you.st.changes['P1@1'].map((c) => c.id), you.st.changes['P1@2'] || []],
      [true, false, ['c', 'd'], { a: { ts: 9, prj: 'P1' } }, ['P1@1', 'P1@2'], '과제1', ['c10', 'c15'], []]);
  });

  await test('나와 공유: 동료 base(…/shared)와 과제 폴더(…/shared/<이름>) 항목을 훑어 내 참여 과제(P2)면 그 폴더에 — writer 는 사이트마다 따로 · 남의 과제(P9)·엉뚱한 폴더는 무시 · index 에 owner·site · 다음엔 index 만으로(discover 끄면 sharedWithMe 안 부름) · 참여자는 동료 폴더를, 책임자는 내 폴더를 고른다', async () => {
    const p2doc = Object.assign(D.emptyYear({ prjNo: 'P2', prjNm: '과제2', rspr: '동료' }, 1), { staff: { plans: [splan('P2', 1, 500, [person('옛것', [1])], { prjNm: '과제2' })], del: {} }, updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '동료' });
    const tree = { [BASE]: {}, [YOUR_BASE]: {}, [`${YOUR_BASE}/MW`]: { '1차년도.json': D.serialize(p2doc) }, [`${YOUR_BASE}/ZZ`]: { '1차년도.json': D.serialize(D.emptyYear({ prjNo: 'P9' }, 1)) }, [`${YOU}/Documents/기타`]: { '1차년도.json': D.serialize(D.emptyYear({ prjNo: 'P2' }, 1)) } };
    const store = fakeStore(tree, { shared: [{ path: YOUR_BASE, ownerName: '동료' }, { path: `${YOU}/Documents/기타`, ownerName: '동료' }] });
    const me = memLocal({ staff: { plans: { 'P2@1': splan('P2', 1, 9000, [person('문창재', [1165000], 5823000)], { prjNm: '과제2' }) }, del: {} }, aliases: { P1: 'SSCB' } });
    const r = await Y.run(deps(store, me));
    assert.deepStrictEqual([r.state.ok, r.state.scanned, Object.keys(r.state.pages).sort()], [true, 2, ['P1', 'P2']], '동료 base 의 폴더 둘을 훑음(기타 폴더는 shared 가 아니라 무시)');
    assert.deepStrictEqual([r.state.pages.P2.folder, r.state.pages.P2.owner, r.state.pages.P2.folderUrl, r.state.pages.P2.pushed, r.state.pages.P2.pulled, r.state.pages.P2.webUrl], ['MW', '동료', cfgOf(`${YOUR_BASE}/MW`).viewUrl, true, false, `${ORIGIN}${YOUR_BASE}/MW/1차년도.json`]);
    assert.deepStrictEqual(docOf(store, `${YOUR_BASE}/MW`, '1차년도.json').staff.plans[0].people[0].name, '문창재', '내 계획(9000)이 동료 폴더의 파일에 올라감');
    assert.deepStrictEqual([r.state.pages.P1.folder, r.state.pages.P1.owner], ['SSCB', '']);
    assert.deepStrictEqual(store.calls.filter((c) => c.startsWith('open')).sort(), [`open:${siteOf(BASE)}`, `open:${siteOf(YOUR_BASE)}`], '사이트마다 writer 하나');
    assert.deepStrictEqual(store.calls.filter((c) => c.startsWith('close')).length, 2);
    assert.deepStrictEqual(r.state.index.P2, { base: YOUR_BASE, folder: 'MW', site: siteOf(YOUR_BASE), path: `${YOUR_BASE}/MW`, url: furl(`${YOUR_BASE}/MW`), owner: '동료', at: 100000 });
    assert.ok(!('P9' in r.state.pages) && !('P9' in r.state.index));
    // index 만으로(discover 끔) — sharedWithMe 를 부르지 않고 parseFolder 로 cfg 를 되살려 그 폴더를 쓴다
    const n0 = store.calls.length;
    const r2 = await Y.run(deps(store, me, { now: 200000, index: r.state.index, discover: false }));
    assert.deepStrictEqual([r2.state.ok, r2.state.scanned, r2.state.pages.P2.folder, r2.state.pages.P2.owner, r2.state.pages.P2.pushed, r2.state.index.P2.owner], [true, 0, 'MW', '동료', false, '동료']);
    assert.ok(!store.calls.slice(n0).includes('shared'));
    // 책임자는 내 base 의 폴더를, 참여자는 동료 폴더를 — P1 이 동료 base 에도 있고 내 base 에도 있으면 내 것(책임자) · P2 가 내 base 에도 있으면 동료 것(참여자)
    tree[`${YOUR_BASE}/P1-copy`] = { '1차년도.json': D.serialize(D.emptyYear({ prjNo: 'P1', prjNm: '과제1' }, 1)) };
    tree[`${BASE}/P2-mine`] = { '1차년도.json': D.serialize(D.emptyYear({ prjNo: 'P2', prjNm: '과제2' }, 1)) };
    const r3 = await Y.run(deps(store, me, { now: 300000 }));
    assert.deepStrictEqual([r3.state.pages.P1.folder, r3.state.pages.P1.owner, r3.state.pages.P2.folder, r3.state.pages.P2.owner], ['SSCB', '', 'MW', '동료']);
    // 동료 사이트의 권한 오류(공유가 풀림)는 그 과제만(전체 실패 아님) — 참여자라 내 base 의 사본(P2-mine)보다 색인의 동료 폴더를 고르므로 조용히 내 사본으로 돌아가지 않고 알린다
    const store2 = fakeStore(clone(tree), { shared: [{ path: YOUR_BASE, ownerName: '동료' }], denied: [siteOf(YOUR_BASE)] });
    const r4 = await Y.run(deps(store2, memLocal({ aliases: { P1: 'SSCB' } }), { index: r.state.index }));
    assert.deepStrictEqual([r4.state.ok, r4.state.pages.P1.error, r4.state.pages.P1.pushed, r4.state.pages.P2.kind, r4.state.pages.P2.folder, r4.state.kind, /권한/.test(r4.state.discoverError)], [false, undefined, false, 'auth', 'MW', 'auth', true]);
  });

  await test('색인(index): 경로가 맞으면 훑지 않고(scanned 0) 첫 읽기에서 과제번호로 검증 · 폴더가 없어진 색인은 버리고 다시 훑는다 · 색인의 폴더가 실제로 다른 과제 것이면 그 과제에 돌리고 이 과제는 새로 고른다', async () => {
    const tree = { [BASE]: {}, [`${BASE}/X`]: { '1차년도.json': D.serialize(D.emptyYear({ prjNo: 'P2', prjNm: '과제2' }, 1)) } };
    // 적중
    const hit = await Y.run(deps(fakeStore(clone(tree)), memLocal({}), { index: { P2: { base: BASE, folder: 'X', site: siteOf(BASE), path: `${BASE}/X`, url: `${ORIGIN}${BASE}/X`, owner: '', at: 1 } }, leadPrjNos: [] }));
    assert.deepStrictEqual([hit.state.scanned, hit.state.pages.P2.folder, hit.state.pages.P1.noFolder, hit.state.index.P2.folder, hit.state.index.P2.at], [0, 'X', true, 'X', 100000]);
    // 불일치: 색인은 OLD 인데 폴더가 없다 → 버리고 X 를 훑어 P2 를 찾는다
    const miss = await Y.run(deps(fakeStore(clone(tree)), memLocal({}), { index: { P2: { base: BASE, folder: 'OLD', path: `${BASE}/OLD` } }, leadPrjNos: [] }));
    assert.deepStrictEqual([miss.state.scanned, miss.state.pages.P2.folder, miss.state.index.P2.folder, JSON.stringify(miss.state.index).includes('OLD')], [1, 'X', 'X', false]);
    // 색인이 P1 → X 라는데 X 의 파일은 P2 것 → P2 에 돌리고 P1(책임자)은 약칭 폴더를 새로 만든다
    const store = fakeStore(clone(tree));
    const me = memLocal({ aliases: { P1: 'SSCB' } });
    const r = await Y.run(deps(store, me, { index: { P1: { base: BASE, folder: 'X', path: `${BASE}/X` } } }));
    assert.deepStrictEqual([r.state.ok, r.state.scanned, r.state.pages.P1.folder, r.state.pages.P1.folderCreated, r.state.pages.P2.folder, r.state.index.P1.folder, r.state.index.P2.folder], [true, 0, 'SSCB', true, 'X', 'SSCB', 'X']);
    assert.deepStrictEqual(Object.keys(store.tree).filter((k) => k.startsWith(`${BASE}/`)).sort(), [`${BASE}/SSCB`, `${BASE}/X`]);
    assert.deepStrictEqual(docOf(store, `${BASE}/X`, '1차년도.json').project.prjNo, 'P2', 'X 를 P1 것으로 덮어쓰지 않음');
  });

  await test('깨진 파일·v1 파일: 그 파일만 kind parse 로 건너뛰고(덮어쓰지 않음) 같은 과제의 다른 연차·예상 비용은 계속 · 폴더의 P1.json(v1) 과 다른 파일은 건드리지 않음 · 연차가 이름과 다른 파일도 parse', async () => {
    const good2 = D.serialize(Object.assign(D.emptyYear({ prjNo: 'P1', prjNm: '과제1' }, 2), { updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '동료' }));
    const tree = { [BASE]: {}, [`${BASE}/SSCB`]: { '1차년도.json': '{"v":2, 깨짐', '2차년도.json': good2, '3차년도.json': JSON.stringify({ v: 1, prjNo: 'P1', plan: { items: {} } }), '4차년도.json': D.serialize(D.emptyYear({ prjNo: 'P1' }, 5)), 'P1.json': '{"v":1,"prjNo":"P1"}', '메모.txt': 'x' } };
    const store = fakeStore(clone(tree), { index: {} });
    const me = memLocal({ aliases: { P1: 'SSCB' }, plan: { plans: { P1: { K: [item('a', 1)] } }, del: {} }, staff: { plans: { 'P1@2': splan('P1', 2, 2000, [person('홍길동', [1000000], 5000000)]) }, del: {} } });
    const r = await Y.run(deps(store, me, { myPrjNos: ['P1'] }));
    const pg = r.state.pages.P1;
    assert.deepStrictEqual([r.state.ok, r.state.errors, r.state.kind, pg.kind, pg.years, pg.pushed, pg.planUrl], [false, 1, 'parse', 'parse', [2], true, `${ORIGIN}${BASE}/SSCB/예상비용.json`], '1·3·4차는 건너뛰고 2차와 예상 비용은 씀');
    assert.ok(/1차년도\.json/.test(pg.error) && /지우면 다시/.test(r.state.error));
    assert.deepStrictEqual([store.tree[`${BASE}/SSCB`]['1차년도.json'], store.tree[`${BASE}/SSCB`]['3차년도.json'], store.tree[`${BASE}/SSCB`]['4차년도.json'], store.tree[`${BASE}/SSCB`]['P1.json']], [tree[`${BASE}/SSCB`]['1차년도.json'], tree[`${BASE}/SSCB`]['3차년도.json'], tree[`${BASE}/SSCB`]['4차년도.json'], '{"v":1,"prjNo":"P1"}'], '덮어쓰지 않음');
    assert.deepStrictEqual(docOf(store, `${BASE}/SSCB`, '2차년도.json').staff.plans.map((p) => p.year), [2]);
    assert.ok(!store.calls.some((c) => c === `modify:${BASE}/SSCB/1차년도.json` || c === `modify:${BASE}/SSCB/3차년도.json` || c === `modify:${BASE}/SSCB/P1.json`));
    assert.deepStrictEqual([me.saved, me.st.plan.plans.P1.K[0].id], [[], 'a'], '로컬 보존');
    assert.strictEqual(pg.webUrl, `${ORIGIN}${BASE}/SSCB/1차년도.json`, '있는 파일(깨진 것도)은 주소를 걸어 열어 볼 수 있게');
    // 폴더를 훑을 때 첫 연차 파일이 깨져 있으면 그 폴더는 못 알아본 폴더 — 책임자가 같은 이름으로 만들 차례면 그것을 쓴다
    const r2 = await Y.run(deps(fakeStore(clone(tree)), memLocal({ aliases: { P1: 'SSCB' } }), { myPrjNos: ['P1'] }));
    assert.deepStrictEqual([r2.state.pages.P1.folder, r2.state.pages.P1.kind, r2.state.pages.P1.years], ['SSCB', 'parse', [2]]);
  });

  await test('남이 체크아웃(locked): 그 파일만 실패하고 같은 과제의 다른 파일·다른 과제는 계속 · writer 는 닫힘 · 만들지 못한 파일에는 webUrl 을 걸지 않는다', async () => {
    const store = fakeStore({ [BASE]: {} }, { locked: [`${BASE}/SSCB/1차년도.json`] });
    const me = memLocal({ aliases: { P1: 'SSCB', P2: 'X' }, plan: { plans: { P1: { K: [item('a', 1)] }, P2: { K: [item('b', 1)] } }, del: {} } });
    const r = await Y.run(deps(store, me, { leadPrjNos: ['P1', 'P2'] }));
    assert.deepStrictEqual([r.state.ok, r.state.errors, r.state.kind, r.state.pages.P1.kind, r.state.pages.P1.years, r.state.pages.P1.planUrl, r.state.pages.P2.pushed, r.state.pages.P2.created], [false, 1, 'locked', 'locked', [], `${ORIGIN}${BASE}/SSCB/예상비용.json`, true, true]);
    assert.ok(/체크아웃/.test(r.state.error));
    assert.deepStrictEqual([Object.keys(store.tree[`${BASE}/SSCB`]), Object.keys(store.tree[`${BASE}/X`]).sort()], [['예상비용.json'], ['1차년도.json', '예상비용.json']]);
    assert.ok(store.calls[store.calls.length - 1].startsWith('close:'));
    assert.deepStrictEqual([r.state.pages.P1.webUrl, r.state.pages.P2.webUrl], ['', `${ORIGIN}${BASE}/X/1차년도.json`], '없는 파일 주소(404)를 ↗ 에 걸지 않는다');
  });

  await test('로그인 필요(auth)·작업 탭 실패(tab)는 전체 실패로 — 던지지 않고 state.kind 로, 나머지 과제는 멈춤 · 나와 공유 목록의 http 오류는 discoverError 로만', async () => {
    const r = await Y.run(deps(fakeStore({ [BASE]: {} }, { authList: true }), memLocal({})));
    assert.deepStrictEqual([r.state.ok, r.state.kind, r.state.count, r.state.pages, r.state.index], [false, 'auth', 0, {}, {}]);
    assert.ok(/로그인/.test(r.state.error));
    const store = fakeStore({ [BASE]: {} }, { openFail: 'tab' });
    const me = memLocal({ aliases: { P1: 'A', P2: 'B' }, plan: { plans: { P1: { K: [item('a', 1)] }, P2: { K: [item('b', 1)] } }, del: {} } });
    const r2 = await Y.run(deps(store, me, { leadPrjNos: ['P1', 'P2'] }));
    assert.deepStrictEqual([r2.state.ok, r2.state.kind, r2.state.pages.P1.kind, 'P2' in r2.state.pages, store.calls.filter((c) => c.startsWith('open')).length], [false, 'tab', 'tab', false, 1]);
    const r3 = await Y.run(deps(fakeStore({ [BASE]: {} }, { sharedFail: 'http' }), memLocal({ aliases: { P1: 'A' } }), { myPrjNos: ['P1'] }));
    assert.deepStrictEqual([r3.state.ok, r3.state.pages.P1.pushed, /나와 공유/.test(r3.state.discoverError)], [true, true, true]);
    // 나와 공유 끝점만 auth(테넌트 정책으로 403) — base 목록은 이미 성공했으므로 전체 실패가 아니라 discoverError 로만, 내 base 의 과제는 계속 쓴다(offline 은 여전히 전체 실패)
    const r4 = await Y.run(deps(fakeStore({ [BASE]: {} }, { sharedFail: 'auth' }), memLocal({ aliases: { P1: 'A' } }), { myPrjNos: ['P1'] }));
    assert.deepStrictEqual([r4.state.ok, r4.state.kind, r4.state.pages.P1.pushed, r4.state.pages.P1.folder, /나와 공유/.test(r4.state.discoverError)], [true, undefined, true, 'A', true]);
    const r5 = await Y.run(deps(fakeStore({ [BASE]: {} }, { sharedFail: 'offline' }), memLocal({ aliases: { P1: 'A' } }), { myPrjNos: ['P1'] }));
    assert.deepStrictEqual([r5.state.ok, r5.state.kind, r5.state.pages], [false, 'offline', {}]);
  });

  await test('같은 약칭의 두 과제: 둘째는 <이름>-<과제번호> 폴더로 비켜 가 첫째의 파일을 덮지 않는다 · base 에 다른 과제로 확인된 같은 이름 폴더가 있어도 비켜 간다 · 체크아웃한 최신 글이 남의 과제 것이면 쓰지 않고(discard) 다시 고른다 · 이미 있던 폴더는 created 가 아니다', async () => {
    const store = fakeStore({ [BASE]: {} });
    const me = memLocal({ aliases: { P1: 'SSCB', P2: 'SSCB' }, staff: { plans: { 'P1@1': splan('P1', 1, 1000, [person('문창재', [1165000], 5823000)]), 'P2@1': splan('P2', 1, 1000, [person('홍길동', [1000000], 5000000)], { prjNm: '과제2' }) }, del: {} } });
    const r = await Y.run(deps(store, me, { leadPrjNos: ['P1', 'P2'] }));
    assert.deepStrictEqual([r.state.ok, r.state.pages.P1.folder, r.state.pages.P2.folder, r.state.created.sort()], [true, 'SSCB', 'SSCB-P2', ['P1', 'P2']]);
    assert.deepStrictEqual(Object.keys(store.tree).filter((k) => k.startsWith(`${BASE}/`)).sort(), [`${BASE}/SSCB`, `${BASE}/SSCB-P2`]);
    assert.deepStrictEqual([docOf(store, `${BASE}/SSCB`, '1차년도.json').project.prjNo, docOf(store, `${BASE}/SSCB`, '1차년도.json').staff.plans[0].people[0].name, docOf(store, `${BASE}/SSCB-P2`, '1차년도.json').project.prjNo, docOf(store, `${BASE}/SSCB-P2`, '1차년도.json').staff.plans[0].people[0].name], ['P1', '문창재', 'P2', '홍길동']);
    assert.notStrictEqual(r.state.index.P1.path, r.state.index.P2.path);
    assert.deepStrictEqual([r.state.index.P1.folder, r.state.index.P2.folder], ['SSCB', 'SSCB-P2']);
    // 다시 돌려도 같은 폴더(색인·훑기 모두) — 두 번째 run 은 색인 없이 훑어서도 SSCB-P2 를 P2 로 알아본다
    const r2 = await Y.run(deps(store, me, { leadPrjNos: ['P1', 'P2'], now: 200000 }));
    assert.deepStrictEqual([r2.state.pages.P1.folder, r2.state.pages.P2.folder, r2.state.written, Object.keys(store.tree).filter((k) => k.startsWith(`${BASE}/`)).length], ['SSCB', 'SSCB-P2', 0, 2]);
    // base 에 P2 것으로 확인된 폴더 'SSCB' 가 이미 있고 P1(책임자)의 약칭도 SSCB → P1 은 SSCB-P1
    const store2 = fakeStore({ [BASE]: {}, [`${BASE}/SSCB`]: { '1차년도.json': D.serialize(D.emptyYear({ prjNo: 'P2', prjNm: '과제2' }, 1)) } });
    const r3 = await Y.run(deps(store2, memLocal({ aliases: { P1: 'SSCB' } }), { myPrjNos: ['P1'] }));
    assert.deepStrictEqual([r3.state.pages.P1.folder, docOf(store2, `${BASE}/SSCB`, '1차년도.json').project.prjNo, 'SSCB-P1' in Object.fromEntries(Object.keys(store2.tree).map((k) => [k.split('/').pop(), 1]))], ['SSCB-P1', 'P2', true]);
    // 체크아웃한 최신 글이 남의 과제 것(그 사이 누가 SSCB/1차년도.json 을 P9 파일로 바꿔 놓음) → 쓰지 않고(discard → undo) 색인을 돌려 P1 은 SSCB-P1 에 새로
    const p9 = D.serialize(Object.assign(D.emptyYear({ prjNo: 'P9', prjNm: '남의 과제' }, 1), { updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '남' }));
    const store3 = fakeStore({ [BASE]: {}, [`${BASE}/SSCB`]: { '1차년도.json': D.serialize(D.emptyYear({ prjNo: 'P1', prjNm: '과제1' }, 1)) } }, { beforeModify: (p, name, tree) => { if (p === `${BASE}/SSCB` && name === '1차년도.json') tree[p][name] = p9; } });
    const me3 = memLocal({ aliases: { P1: 'SSCB' }, changes: { 'P1@1': [change('c1', '2026-10-01', '기타', 'x', '', '')] } });
    const r4 = await Y.run(deps(store3, me3, { myPrjNos: ['P1'] }));
    assert.deepStrictEqual([r4.state.ok, r4.state.pages.P1.folder, r4.state.pages.P1.pushed, store3.tree[`${BASE}/SSCB`]['1차년도.json'], docOf(store3, `${BASE}/SSCB-P1`, '1차년도.json').project.prjNo, docOf(store3, `${BASE}/SSCB-P1`, '1차년도.json').changes.map((c) => c.id)], [true, 'SSCB-P1', true, p9, 'P1', ['c1']], 'P9 파일은 그대로 · P1 자료는 새 폴더에');
    assert.ok(store3.calls.includes(`undo:${BASE}/SSCB/1차년도.json`) && !store3.calls.includes(`put:${BASE}/SSCB/1차년도.json`), '남의 파일에 PUT 없음(체크아웃 되돌림)');
    assert.deepStrictEqual([r4.state.index.P1.folder, r4.state.index.P9.folder], ['SSCB-P1', 'SSCB'], '그 폴더는 실제 과제(P9)의 것으로 색인');
    // 폴더 목록이 비었는데 폴더가 실제로는 이미 있으면(그 사이 동료가 만듦) ensurePath 가 만든 것이 없다고 하므로 created 가 아니다 → 참여연구원 자동 공유를 다시 하지 않는다
    const store4 = fakeStore({ [BASE]: {}, [`${BASE}/SSCB`]: {} });
    const listFolders0 = store4.listFolders; store4.listFolders = async (cfg, io) => (cfg.folderPath === BASE ? [] : listFolders0(cfg, io));
    const r5 = await Y.run(deps(store4, memLocal({ aliases: { P1: 'SSCB' } }), { myPrjNos: ['P1'] }));
    assert.deepStrictEqual([r5.state.pages.P1.folder, r5.state.pages.P1.pushed, r5.state.pages.P1.folderCreated, r5.state.created], ['SSCB', true, undefined, []]);
  });

  await test('색인에 남은 동료 폴더가 없어졌으면(지움·이름 바꿈) 동료 사이트에 새로 만들지 않는다 — 색인을 버리고(state.index 에서 빠짐) 다시 고름: 밀어냈던 내 base 폴더(alt) → 책임자·로컬 자료면 내 base 에 새로 → 아니면 noFolder', async () => {
    const idx = { P2: { base: YOUR_BASE, folder: '과제2', site: siteOf(YOUR_BASE), path: `${YOUR_BASE}/과제2`, url: furl(`${YOUR_BASE}/과제2`), owner: '동료', at: 1 } };
    // 참여자 · 로컬 자료 없음 → noFolder, 동료 사이트는 열지도 만들지도 않음, 색인에서 빠짐
    const store = fakeStore({ [BASE]: {}, [YOUR_BASE]: {} });
    const r = await Y.run(deps(store, memLocal({}), { index: clone(idx), leadPrjNos: [], discover: false }));
    assert.deepStrictEqual([r.state.ok, r.state.pages.P2.noFolder, r.state.pages.P2.kind, r.state.pages.P2.error, 'P2' in r.state.index, `${YOUR_BASE}/과제2` in store.tree], [true, true, 'nofolder', undefined, false, false]);
    assert.ok(!store.calls.some((c) => c.startsWith('open') || c.startsWith('ensure')), 'writer 를 열지 않음');
    // 참여자 · 로컬 자료 있음 → 내 base 에 새로(동료 사이트 아님)
    const store2 = fakeStore({ [BASE]: {}, [YOUR_BASE]: {} });
    const me2 = memLocal({ staff: { plans: { 'P2@1': splan('P2', 1, 9000, [person('문창재', [1165000], 5823000)], { prjNm: '과제2' }) }, del: {} } });
    const r2 = await Y.run(deps(store2, me2, { index: clone(idx), leadPrjNos: [], discover: false }));
    assert.deepStrictEqual([r2.state.ok, r2.state.pages.P2.folder, r2.state.pages.P2.owner, r2.state.pages.P2.pushed, r2.state.pages.P2.folderCreated, Object.keys(store2.tree).filter((k) => k.includes('과제2') || k.endsWith('/P2')), r2.state.index.P2.base, r2.state.index.P2.owner], [true, 'P2', '', true, true, [`${BASE}/P2`], BASE, '']);
    assert.deepStrictEqual(store2.calls.filter((c) => c.startsWith('open')), [`open:${siteOf(BASE)}`], '내 사이트만');
    // 내 base 에 P2 사본이 있었으면(pick 이 동료 폴더로 밀어냄 — alt) 그 사본으로 되돌아간다
    const store3 = fakeStore({ [BASE]: {}, [`${BASE}/P2-mine`]: { '1차년도.json': D.serialize(D.emptyYear({ prjNo: 'P2', prjNm: '과제2' }, 1)) }, [YOUR_BASE]: {} });
    const r3 = await Y.run(deps(store3, me2, { index: clone(idx), leadPrjNos: [], discover: false }));
    assert.deepStrictEqual([r3.state.ok, r3.state.pages.P2.folder, r3.state.pages.P2.owner, r3.state.pages.P2.pushed, r3.state.index.P2.folder, Object.keys(store3.tree).filter((k) => k.startsWith(`${YOUR_BASE}/`))], [true, 'P2-mine', '', true, 'P2-mine', []]);
    // 동료 폴더가 있으면 그대로 그 폴더(비교)
    const store4 = fakeStore({ [BASE]: {}, [YOUR_BASE]: {}, [`${YOUR_BASE}/과제2`]: { '1차년도.json': D.serialize(D.emptyYear({ prjNo: 'P2', prjNm: '과제2' }, 1)) } });
    const r4 = await Y.run(deps(store4, me2, { index: clone(idx), leadPrjNos: [], discover: false }));
    assert.deepStrictEqual([r4.state.pages.P2.folder, r4.state.pages.P2.owner, r4.state.index.P2.owner], ['과제2', '동료', '동료']);
  });

  await test('예상비용.json 만 다른 과제 것이면(연차 파일은 맞음) 그 파일만 kind parse 로 건너뛰고 덮어쓰지 않는다 — 폴더는 그대로 이 과제 것', async () => {
    const foreign = D.serialize(Object.assign(D.emptyPlan({ prjNo: 'P2', prjNm: '과제2' }), { plan: { items: [item('z', 1, { prj: 'P2', key: 'K' })], del: {} }, updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '동료' }));
    const store = fakeStore({ [BASE]: {}, [`${BASE}/SSCB`]: { '1차년도.json': D.serialize(D.emptyYear({ prjNo: 'P1', prjNm: '과제1' }, 1)), '예상비용.json': foreign } });
    const me = memLocal({ aliases: { P1: 'SSCB' }, plan: { plans: { P1: { K: [item('a', 1)] } }, del: {} } });
    const r = await Y.run(deps(store, me, { myPrjNos: ['P1'] }));
    const pg = r.state.pages.P1;
    assert.deepStrictEqual([r.state.ok, pg.folder, pg.kind, /다른 과제\(P2\)/.test(pg.error), pg.years, store.tree[`${BASE}/SSCB`]['예상비용.json'], me.st.plan.plans.P1.K.map((e) => e.id), pg.planUrl], [false, 'SSCB', 'parse', true, [1], foreign, ['a'], `${ORIGIN}${BASE}/SSCB/예상비용.json`]);
    assert.ok(!store.calls.some((c) => c.startsWith(`put:${BASE}/SSCB/예상비용.json`)), '덮어쓰지 않음');
    assert.deepStrictEqual([r.state.index.P1.folder, 'P2' in r.state.index], ['SSCB', false], '폴더는 이 과제 것 그대로');
  });

  await test('want 로 끈 칸: 파일의 그 칸은 받지도 덮지도 않고 그대로 · plan 을 끄면 예상비용.json 은 읽지도 쓰지도 않음', async () => {
    const doc = Object.assign(D.emptyYear({ prjNo: 'P1', prjNm: '과제1' }, 1), { research: [D.cleanRec(rec('P1', 1, 'r2', 3))], staff: { plans: [splan('P1', 1, 1000, [person('문창재', [1165000], 5823000)])], del: {} }, changes: [change('c1', '2026-10-01', '기타', 'x', '', '')], updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '동료' });
    const store = fakeStore({ [BASE]: {}, [`${BASE}/SSCB`]: { '1차년도.json': D.serialize(doc), '예상비용.json': D.serialize(Object.assign(D.emptyPlan({ prjNo: 'P1' }), { plan: { items: [item('q', 1, { prj: 'P1', key: 'K' })], del: {} } })) } });
    const me = memLocal({ aliases: { P1: 'SSCB' }, plan: { plans: { P1: { K: [item('b', 6)] } }, del: {} }, research: { 'mw급과제#2': rec('P1', 2, 'r0', 1) }, staff: { plans: { 'P1@2': splan('P1', 2, 5, [person('x', [1])]) }, del: {} }, changes: { 'P1@1': [change('c9', '2026-10-09', '기타', 'y', '', '')] } });
    const r = await Y.run(deps(store, me, { myPrjNos: ['P1'], want: { plan: false, research: false, staff: false, budget: false, changes: false, alias: true } }));
    const back = docOf(store, `${BASE}/SSCB`, '1차년도.json');
    assert.deepStrictEqual([r.state.pages.P1.pushed, r.state.pages.P1.years, me.saved, back.research.map((x) => x.n), back.staff.plans.map((x) => x.year), back.changes.map((c) => c.id), back.budget], [true, [1, 2], [], [1], [1], ['c1'], []], '1차년도는 project(ERP 칸)만 맞추고 2차년도는 빈 껍데기');
    assert.deepStrictEqual([Object.keys(me.st.research), Object.keys(me.st.staff.plans), me.st.changes['P1@1'].map((c) => c.id)], [['mw급과제#2'], ['P1@2'], ['c9']]);
    assert.ok(!store.calls.some((c) => /예상비용\.json/.test(c)), '예상비용.json 은 건드리지 않음');
    assert.deepStrictEqual([r.state.pages.P1.planUrl, r.state.pages.P1.counts.plan], ['', 0]);
  });

  await test('pullOnly(받기만 — KRS WORKSPACE 몫): plan 이면 예상비용.json 을 읽어 로컬에 받기만 하고 쓰지도 만들지도 않음(로컬에만 있는 항목은 올라가지 않음) · year 면 연차 파일도 같은 식 · 파일·폴더가 없으면 만들지도 않음', async () => {
    const pl = Object.assign(D.emptyPlan({ prjNo: 'P1', prjNm: '과제1' }), { plan: { items: [item('q', 1, { prj: 'P1', key: 'K' })], del: {} }, updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '동료' });
    const y1 = Object.assign(D.emptyYear({ prjNo: 'P1', prjNm: '과제1', alias: 'SSCB', aliasAt: 10 }, 1), { changes: [change('c1', '2026-10-01', '기타', 'x', '', '')], updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '동료' });
    const store = fakeStore({ [BASE]: {}, [`${BASE}/SSCB`]: { '1차년도.json': D.serialize(y1), '예상비용.json': D.serialize(pl) } });
    const me = memLocal({ aliases: { P1: 'SSCB' }, plan: { plans: { P1: { K: [item('b', 6)] } }, del: {} }, changes: { 'P1@1': [change('c9', '2026-10-09', '기타', 'y', '', '')] } });
    // ① plan 만 받기 — 연차 파일(변경이력 c9)은 양방향이라 쓴다
    const r = await Y.run(deps(store, me, { myPrjNos: ['P1'], pullOnly: { plan: true } }));
    assert.deepStrictEqual([r.state.ok, r.state.pages.P1.pulled, r.state.pages.P1.pushed, r.state.written, me.saved], [true, true, true, 1, ['changes:P1', 'plan:P1']], '연차 파일만 씀(변경이력 합집합) · 예상 비용은 받기만');
    assert.deepStrictEqual([me.st.plan.plans.P1.K.map((e) => e.id).sort(), docOf(store, `${BASE}/SSCB`, '예상비용.json').plan.items.map((e) => e.id)], [['b', 'q'], ['q']], '동료 항목 q 는 받고 내 항목 b 는 올라가지 않음');
    assert.deepStrictEqual(store.calls.filter((c) => /예상비용\.json/.test(c)), [`read:${BASE}/SSCB/예상비용.json`], '예상비용.json 은 읽기만');
    assert.deepStrictEqual([r.state.pages.P1.planUrl, r.state.pages.P1.counts.plan, docOf(store, `${BASE}/SSCB`, '1차년도.json').changes.map((c) => c.id)], [`${ORIGIN}${BASE}/SSCB/예상비용.json`, 2, ['c1', 'c9']]);
    // ② year 도 받기만 — 동료의 변경이력을 받되 내 것은 올리지 않고, 파일이 없는 2차년도는 만들지 않는다
    const me2 = memLocal({ aliases: { P1: 'SSCB' }, changes: { 'P1@1': [change('c8', '2026-10-08', '기타', 'z', '', '')], 'P1@2': [change('c30', '2026-10-06', '연구기간', '기간', '', '')] } });
    const n0 = store.calls.length;
    const r2 = await Y.run(deps(store, me2, { myPrjNos: ['P1'], pullOnly: { plan: true, year: true } }));
    assert.deepStrictEqual([r2.state.ok, r2.state.written, r2.state.pages.P1.pulled, r2.state.pages.P1.pushed, r2.state.pages.P1.years, me2.saved, me2.st.changes['P1@1'].map((c) => c.id), me2.st.plan.plans.P1.K.map((e) => e.id)], [true, 0, true, false, [1, 2], ['changes:P1', 'plan:P1'], ['c1', 'c8', 'c9'], ['q']], '동료 변경이력 c1 과 예상 비용 q 를 받음');
    assert.deepStrictEqual([docOf(store, `${BASE}/SSCB`, '1차년도.json').changes.map((c) => c.id), Object.keys(store.tree[`${BASE}/SSCB`]).sort()], [['c1', 'c9'], ['1차년도.json', '예상비용.json']], '파일은 그대로 · 2차년도.json 안 만듦');
    assert.ok(!store.calls.slice(n0).some((c) => /^(open|modify|ensure)/.test(c)), 'writer 를 열지 않음');
    // ③ 폴더조차 없는 책임자 과제 — 받을 것이 없고 만들지도 않는다
    const empty = fakeStore({ [BASE]: {} });
    const me3 = memLocal(myLocal());
    const r3 = await Y.run(deps(empty, me3, { myPrjNos: ['P1'], pullOnly: { plan: true, year: true } }));
    assert.deepStrictEqual([r3.state.ok, r3.state.written, r3.state.created, Object.keys(empty.tree), r3.state.index, r3.state.pages.P1.noFolder], [true, 0, [], [BASE], {}, undefined]);
  });

  await test('작업 탭을 여는 사이에 동료가 쓴 것(체크아웃한 최신 글)을 다시 병합해 잃지 않고 새로 받은 것은 로컬에도 넣는다 · 그 사이 패널에서 고친 항목은 덮지 않는다(pull 이 저장 직전에 로컬을 다시 읽어 다시 병합)', async () => {
    const me = memLocal({ aliases: { P1: 'SSCB' }, plan: { plans: { P1: { K: [item('a', 1)] } }, del: {} }, staff: { plans: { 'P1@1': splan('P1', 1, 1000, [person('문창재', [1165000], 5823000)]) }, del: {} } });
    const store = fakeStore({ [BASE]: {} }, { beforeModify: (p, name, tree) => {
      if (name === '예상비용.json' && !tree[p][name]) {   // 동료가 late 를 썼고, 나는 패널에서 edit 를 더하고 2차년도 계획을 넣었다
        tree[p][name] = D.serialize(Object.assign(D.emptyPlan({ prjNo: 'P1' }), { plan: { items: [item('late', 50, { prj: 'P1', key: 'K', by: '동료' })], del: {} }, updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '동료' }));
        me.st.plan.plans.P1.K.push(item('edit', 70));
        me.st.staff.plans['P1@2'] = splan('P1', 2, 2000, [person('홍길동', [1000000], 5000000)]);
      }
    } });
    const r = await Y.run(deps(store, me, { myPrjNos: ['P1'] }));
    assert.deepStrictEqual(me.st.plan.plans.P1.K.map((e) => e.id).sort(), ['a', 'edit', 'late'], '패널 편집(edit)이 남고 동료 항목(late)도 들어옴');
    assert.deepStrictEqual([Object.keys(me.st.staff.plans).sort(), me.saved], [['P1@1', 'P1@2'], ['plan:P1']]);
    const pl = docOf(store, `${BASE}/SSCB`, '예상비용.json');
    assert.deepStrictEqual([pl.plan.items.map((e) => e.id).sort(), r.state.pages.P1.pulled, r.state.pages.P1.pushed, r.state.pages.P1.count], [['a', 'late'], true, true, 2], '파일은 이번에 a+late — edit 는 다음에');
    me.saved.length = 0;
    const r2 = await Y.run(deps(store, me, { myPrjNos: ['P1'], now: 200000 }));
    assert.deepStrictEqual([docOf(store, `${BASE}/SSCB`, '예상비용.json').plan.items.map((e) => e.id).sort(), r2.state.pages.P1.years, r2.state.pages.P1.pushed, r2.state.pages.P1.pulled, me.saved], [['a', 'edit', 'late'], [1, 2], true, false, []]);
    // 연차 파일에서도: 쓰기 직전에 동료가 변경이력을 더했으면 합쳐 쓰고 로컬에도 받는다
    const me2 = memLocal({ aliases: { P1: 'SSCB' }, changes: { 'P1@1': [change('c10', '2026-10-01', '기타', 'a', '', '')] } });
    const store2 = fakeStore({ [BASE]: {} }, { beforeModify: (p, name, tree) => { if (name === '1차년도.json' && !tree[p][name]) tree[p][name] = D.serialize(Object.assign(D.emptyYear({ prjNo: 'P1' }, 1), { changes: [change('c20', '2026-10-02', '기타', 'b', '', '', { by: '동료' })], updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '동료' })); } });
    const r3 = await Y.run(deps(store2, me2, { myPrjNos: ['P1'] }));
    assert.deepStrictEqual([docOf(store2, `${BASE}/SSCB`, '1차년도.json').changes.map((c) => c.id), me2.st.changes['P1@1'].map((c) => c.id), me2.saved, r3.state.pages.P1.pulled, r3.state.pages.P1.created], [['c10', 'c20'], ['c10', 'c20'], ['changes:P1'], true, true]);
  });

  await test('내가 남긴 체크아웃(readFile checkedOutByMe): 내용이 같아 쓸 것이 없어도 modify 로 이어받아 체크인(checkedIn, pushed 아님) · 다음엔 writer 를 열지 않음 · 남이 잡은 것으로 드러나면(locked) 조용히 · 쓸 것이 있는데 잡혀 있으면 locked', async () => {
    const me = memLocal({ aliases: { P1: 'SSCB' }, plan: { plans: { P1: { K: [item('a', 1)] } }, del: {} } });
    const text = D.serialize(D.mergePlan(D.fromLocalPlan('P1', me.st, { prjNm: '과제1', who: '나' }), null, 100000, '나').doc);
    const ytext = D.serialize(D.mergeYear(D.fromLocalYear('P1', 1, me.st, { prjNm: '과제1', rspr: '김거화', start: '2026-04-01', end: '2026-12-31', who: '나' }), null, 100000, '나').doc);
    const mk = (extra) => fakeStore({ [BASE]: {}, [`${BASE}/SSCB`]: { '1차년도.json': ytext, '예상비용.json': text } }, Object.assign({ mine: [`${BASE}/SSCB/예상비용.json`] }, extra || {}));
    const store = mk();
    const r = await Y.run(deps(store, me, { myPrjNos: ['P1'] }));
    assert.deepStrictEqual([r.state.ok, r.state.written, r.state.pages.P1.pushed, r.state.pages.P1.pulled, r.state.pages.P1.checkedIn, store.mine.size], [true, 0, false, false, true, 0]);
    assert.deepStrictEqual(store.calls.filter((c) => /open|modify|checkin|close/.test(c)), [`open:${siteOf(BASE)}`, `modify:${BASE}/SSCB/예상비용.json`, `checkin:${BASE}/SSCB/예상비용.json`, `close:${BASE}/SSCB`]);
    const n0 = store.calls.length;
    const r2 = await Y.run(deps(store, me, { myPrjNos: ['P1'], now: 200000 }));
    assert.deepStrictEqual([r2.state.ok, store.calls.slice(n0).some((c) => c.startsWith('open')), r2.state.pages.P1.checkedIn], [true, false, undefined]);
    const store2 = mk({ locked: [`${BASE}/SSCB/예상비용.json`] });
    const r3 = await Y.run(deps(store2, me, { myPrjNos: ['P1'] }));
    assert.deepStrictEqual([r3.state.ok, r3.state.errors, r3.state.pages.P1.error], [true, 0, undefined]);
    me.st.plan.plans.P1.K.push(item('b', 2));
    const r4 = await Y.run(deps(store2, me, { myPrjNos: ['P1'] }));
    assert.deepStrictEqual([r4.state.ok, r4.state.pages.P1.kind], [false, 'locked']);
  });

  await test('과제 하나만(only): 그 과제만 읽고 쓰며 pages 도 그것만 · 다른 과제의 색인은 그대로 둔다 · 참여 과제가 아니어도 로컬 자료가 있는 과제는 대상(폴더를 만든다)', async () => {
    const store = fakeStore({ [BASE]: {} });
    const me = memLocal({ aliases: { P1: 'SSCB' }, plan: { plans: { P1: { K: [item('a', 1)] }, P9: { K: [item('q', 1)] } }, del: {} } });
    const r = await Y.run(deps(store, me, { only: 'P9', index: { P1: { base: BASE, folder: 'SSCB', path: `${BASE}/SSCB`, at: 1 } } }));
    assert.deepStrictEqual([Object.keys(r.state.pages), r.state.pages.P9.folder, r.state.pages.P9.title, Object.keys(store.tree[`${BASE}/P9`]).sort(), Object.keys(r.state.index).sort()], [['P9'], 'P9', 'P9', ['1차년도.json', '예상비용.json'], ['P1', 'P9']]);
    const r2 = await Y.run(deps(store, me));
    assert.deepStrictEqual(Object.keys(r2.state.pages).sort(), ['P1', 'P2', 'P9'], 'myPrjNos ∪ 로컬 자료');
    assert.deepStrictEqual([r2.state.pages.P2.noFolder, r2.state.pages.P1.folder, r2.state.pages.P9.folder], [true, 'SSCB', 'P9']);
  });

  await test('at 이 없는 writer(같은 사이트의 다른 폴더를 못 바꾸는 store): 폴더마다 writer 를 하나 더 열어도 동작은 같고 끝에 모두 닫는다', async () => {
    const store = fakeStore({ [BASE]: {} }, { noAt: true });
    const me = memLocal({ aliases: { P1: 'A', P2: 'B' }, plan: { plans: { P1: { K: [item('a', 1)] }, P2: { K: [item('b', 1)] } }, del: {} } });
    const r = await Y.run(deps(store, me, { leadPrjNos: ['P1', 'P2'] }));
    assert.deepStrictEqual([r.state.ok, r.state.written, r.state.pages.P1.folder, r.state.pages.P2.folder], [true, 4, 'A', 'B']);
    assert.deepStrictEqual([store.calls.filter((c) => c.startsWith('open')).length, store.calls.filter((c) => c.startsWith('close')).sort()], [2, [`close:${BASE}/A`, `close:${BASE}/B`]]);
  });

  await test('모르는 최상위 칸·project 의 모르는 칸 보존 · 동료 변경을 받아도 그대로 남는다', async () => {
    const doc = Object.assign(D.emptyYear({ prjNo: 'P1', prjNm: '과제1' }, 1), { workspace: { memo: 'KRS WORKSPACE 가 넣은 것' }, changes: [change('c1', '2026-10-01', '기타', 'x', '', '', { key: 'yaml' })], updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '동료' });
    doc.project.extra = { ws: 1 };
    const store = fakeStore({ [BASE]: {}, [`${BASE}/SSCB`]: { '1차년도.json': D.serialize(doc) } });
    const me = memLocal({ aliases: { P1: 'SSCB' }, changes: { 'P1@1': [change('c2', '2026-10-02', '기타', 'y', '', '')] } });
    const r = await Y.run(deps(store, me, { myPrjNos: ['P1'] }));
    const back = JSON.parse(store.tree[`${BASE}/SSCB`]['1차년도.json']);
    assert.deepStrictEqual([r.state.pages.P1.pulled, r.state.pages.P1.pushed, back.workspace, back.project.extra, back.changes.map((c) => [c.id, c.key]), Object.keys(back).slice(-1), r.state.pages.P1.remoteAt], [true, true, { memo: 'KRS WORKSPACE 가 넣은 것' }, { ws: 1 }, [['c1', 'yaml'], ['c2', undefined]], ['workspace'], Date.parse('2026-10-18T00:00:00.000Z')]);
    assert.deepStrictEqual([me.st.changes['P1@1'].map((c) => c.id), me.st.projects.P1.extra, me.st.projects.P1.at], [['c1', 'c2'], { ws: 1 }, 100000], '받은 시각은 이번에 쓴 문서의 updatedAt(= now — 파일도 바뀌었으므로)');
    // 다시 돌리면 받아 둔 extra 가 같아 project 를 다시 받지 않는다
    me.saved.length = 0;
    const r2 = await Y.run(deps(store, me, { myPrjNos: ['P1'], now: 200000 }));
    assert.deepStrictEqual([r2.state.pages.P1.pulled, r2.state.pages.P1.pushed, me.saved], [false, false, []]);
  });

  })();
}

/* ---------- staff-sync — kr_ext_rerp tests/staff-sync.test.js 그대로 ---------- */
/* lib/staff-sync.js (공유 (Plus) — 사업비 참여연구원 계획 병합 규칙, 0.8.7) 테스트: plansOf, 연차별 at 병합·묘비, gcTomb, delSlice/putBack. 원노트 페이지 부분은 0.8.7 에서 걷어 냄(2026-10-18) — 파일 쪽은 lib/prjdoc*.js 테스트. 실행: node tests/staff-sync.test.js */
{
  const S = STAFF, Y = STAFF_SYNC;

  const person = (name, amts, monthly) => S.normalizePerson({ id: name, name, role: '연구원', manual: monthly, plan: amts.map((amt, i) => ({ ym: `2026-${String(i + 4).padStart(2, '0')}`, amt })) });
  const plan = (prjNo, year, at, people, extra) => Object.assign({ prjNo, year, prjNm: '과제', from: '2026-04', to: '2026-12', budgetPay: 31425000, basis: 'rerp', src: 'erp', people, at, by: '김거화', note: 'n' }, extra || {});
  const P1Y1 = () => plan('P1', 1, 1000, [person('문창재', [1165000, 1165000, 1159000], 5823000)]);

  await (async () => {
  await test('plansOf 는 연차 있는 것만 키 차례로 · 과제 하나만 · keyOf', () => {
    const list = Y.plansOf({ 'P1@2': plan('P1', 2, 1), P1: { prjNo: 'P1' }, 'P1@1': plan('P1', 1, 1), 'P2@1': plan('P2', 1, 1) });
    assert.deepStrictEqual(list.map((p) => `${p.prjNo}@${p.year}`), ['P1@1', 'P1@2', 'P2@1']);
    assert.deepStrictEqual(Y.plansOf(list, 'P2').map((p) => p.prjNo), ['P2']);
    assert.strictEqual(Y.keyOf(list[1]), S.planKey('P1', 2));
    assert.deepStrictEqual(Y.plansOf(null), []);
  });
  await test('merge — 연차마다 at 큰 쪽(같으면 로컬), 묘비가 새로우면 삭제 · 계획이 새로우면 묘비 폐기, 원격 없음, 같음', () => {
    const L = { plans: { 'P1@1': plan('P1', 1, 10, [person('a', [1000])]), 'P1@2': plan('P1', 2, 50, [person('b', [1000])]) }, del: { 'P1@3': 30 } };
    const R = { plans: [plan('P1', 1, 20, [person('a', [2000])]), plan('P1', 2, 50, [person('b', [9000])]), plan('P1', 3, 20, [person('c', [1000])]), plan('P1', 4, 5, [person('d', [1000])])], del: { 'P1@4': 40 } };
    const m = Y.merge(L, R, 1000);
    const by = Object.fromEntries(m.plans.map((p) => [p.year, p.people[0].plan[0].amt]));
    assert.deepStrictEqual(by, { 1: 2000, 2: 1000 }, '1차: 원격이 새로움 · 2차: 같으면 로컬 · 3차: 묘비 · 4차: 원격 묘비');
    assert.deepStrictEqual(m.del, { 'P1@3': 30, 'P1@4': 40 });
    assert.ok(m.localChanged && m.remoteChanged);
    const m2 = Y.merge({ plans: { 'P1@1': plan('P1', 1, 100, [person('a', [1])]) }, del: {} }, { plans: [], del: { 'P1@1': 90 } }, 1000);
    assert.deepStrictEqual([m2.plans.length, m2.del], [1, {}], '계획이 묘비보다 새로우면 계획이 남고 묘비는 버림');
    const m3 = Y.merge({ plans: { 'P1@1': P1Y1() }, del: {} }, null, 1000);
    assert.deepStrictEqual([m3.localChanged, m3.remoteChanged, m3.plans.length], [false, true, 1]);
    const m4 = Y.merge({ plans: { 'P1@1': P1Y1() }, del: {} }, { plans: [P1Y1()], del: {} }, 1000);
    assert.deepStrictEqual([m4.localChanged, m4.remoteChanged], [false, false]);
    const withBudget = plan('P1', 1, 2000, [], { budget: [{ name: '인건비', plan: 31425000 }, { name: '연구활동비', plan: 50000000 }] });
    const m5 = Y.merge({ plans: { 'P1@1': P1Y1() }, del: {} }, { plans: [withBudget], del: {} }, 3000);
    assert.deepStrictEqual([m5.plans[0].budget && m5.plans[0].budget.length, m5.plans[0].people.length, m5.localChanged], [2, 0, true], '예산 줄도 연차 계획과 함께 오간다');
    const old = 200 * 24 * 3600 * 1000;
    assert.deepStrictEqual(Y.gcTomb({ a: 1, b: old - 1000 }, old), { b: old - 1000 });
  });
  await test('delSlice — 그 과제 묘비만 · putBack — 그 과제 몫만 바꾸고 다른 과제는 그대로', () => {
    const del = { 'P1@1': 10, 'P2@1': 20, 'P1@3': 30 };
    assert.deepStrictEqual(Y.delSlice(del, 'P1'), { 'P1@1': 10, 'P1@3': 30 });
    const local = { plans: { 'P1@1': P1Y1(), 'P2@1': plan('P2', 1, 1, [person('x', [1])]) }, del };
    const back = Y.putBack(local, 'P1', [plan('P1', 2, 500, [person('홍길동', [1000000], 5000000)])], { 'P1@1': 400 });
    assert.deepStrictEqual(Object.keys(back.plans).sort(), ['P1@2', 'P2@1'], 'P1 은 병합 결과(2차년도만)로, P2 는 그대로');
    assert.deepStrictEqual(back.del, { 'P2@1': 20, 'P1@1': 400 }, 'P1 묘비는 새것으로(P1@3 은 사라짐), P2 는 그대로');
    assert.strictEqual(back.plans['P2@1'], local.plans['P2@1']);
  });
  })();
}

/* ---------- sharesync — 사이드패널 배선(가짜 store · 가짜 chrome.storage · 가짜 로컬) ---------- */
// rerp background.js 의 공유 (Plus) 배선을 createShareSync(deps) 로 옮긴 것이 원본과 같게 도는지 — 설정·과제 문맥·loadLocal/saveLocal·참여인력·클립보드는 deps, 저장소는 가짜 store(메모리 폴더 트리 — 실 SharePoint 에 닿지 않음).
{
  const ORIGIN = 'https://krclass-my.sharepoint.com';
  const ME = '/personal/me', BASE = `${ME}/Documents/업무/shared`;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const err = (kind, msg) => Object.assign(new Error(msg || kind), { kind });
  const furl = (p) => `${ORIGIN}${p.split('/').map(encodeURIComponent).join('/')}`;
  const siteOf = (p) => `${ORIGIN}${p.split('/').slice(0, 3).join('/')}`;
  const cfgOf = (p) => { const site = siteOf(p); return { origin: ORIGIN, sitePath: p.split('/').slice(0, 3).join('/'), siteUrl: site, folderPath: p, name: p.split('/').pop(), url: furl(p), viewUrl: `${site}/_layouts/15/onedrive.aspx?id=${encodeURIComponent(p)}`, mine: p.startsWith(ME), fileUrl: (nm) => `${ORIGIN}${p}/${nm}` }; };
  const item = (id, ts, extra) => Object.assign({ id, name: `항목 ${id}`, qty: 1, unit: 1000, amt: 1000, ts }, extra || {});
  const change = (id, date, kind, it, before, after, extra) => Object.assign({ id, date, kind, item: it, before, after, reason: '', by: '나', at: Number(id.replace(/\D/g, '')) || 0, auto: false }, extra || {});
  /* 가짜 store — KRX_SP 의 자리(createShareSync 의 deps.store). tree: { [폴더 경로]: { [파일 이름]: 글 } }. opts = { authAll(모든 읽기가 auth), people:{ 이름: 이메일 }(피커가 아는 사람), link(orgLink 가 주는 주소) } */
  function fakeStore(tree, opts) {
    opts = opts || {};
    const calls = [];
    const nofolder = (p) => err('nofolder', `공유 폴더가 없습니다: ${p}`);
    const meta = (p, name) => ({ name, length: tree[p][name].length, modified: '2026-10-18T00:00:00Z', version: '1.0', uniqueId: `u-${name}`, checkedOut: false, checkedOutByMe: false });
    const bound = (p) => {
      const w = {
        folderPath: p,
        at: (cfg) => bound(cfg.folderPath),
        ensurePath: async (pp) => { calls.push(`ensurePath:${pp}`); const segs = pp.split('/').filter(Boolean), at = (d) => `/${segs.slice(0, d).join('/')}`; let d = segs.length; while (d > 3 && !(at(d) in tree)) d--; const made = []; if (!(at(d) in tree)) { tree[at(d)] = {}; made.push(at(d)); } for (let i = d + 1; i <= segs.length; i++) { tree[at(i)] = {}; made.push(at(i)); } return { created: made.length > 0, made }; },
        ensureFolder: async () => { if (p in tree) return { created: false }; tree[p] = {}; return { created: true }; },
        modify: async (name, transform) => { calls.push(`modify:${p}/${name}`); if (!(p in tree)) throw nofolder(p); const cur = name in tree[p] ? tree[p][name] : null; const r = transform(cur); if (r && r.changed) { tree[p][name] = r.text; return { changed: true, created: cur == null, updated: cur != null, checkedIn: cur != null, version: '2.0' }; } return { changed: false, checkedIn: false }; },
        sharePeople: async (fp, names, o) => { calls.push(`share:${fp}:${names.join(',')}:${o.role}`); const shared = [], notFound = []; for (const n of names) (opts.people && opts.people[n] ? shared : notFound).push(opts.people && opts.people[n] ? { name: n, email: opts.people[n] } : n); return { shared, ambiguous: [], notFound, failed: [] }; },
        orgLink: async (fp, o) => { calls.push(`link:${fp}:${o.edit}`); return { url: opts.link || `https://krclass-my.sharepoint.com/:f:/g/personal/me/LINK${encodeURIComponent(fp)}`, edit: !!o.edit, via: 'ShareLink' }; },
        rename: async (fp, newName) => { calls.push(`rename:${fp}:${newName}`); const parent = fp.replace(/\/[^/]*$/, ''), np = `${parent}/${newName}`; if (np in tree) throw err('http', '같은 이름의 폴더가 이미 있습니다'); tree[np] = tree[fp]; delete tree[fp]; return { path: np, name: newName, changed: true, url: furl(np) }; },
        close: async () => { calls.push(`close:${p}`); },
      };
      return w;
    };
    const guard = (what) => { if (opts.authAll) throw err('auth', `이 브라우저에서 SharePoint(OneDrive)에 로그인하세요 (${what} 403)`); };
    return {
      calls, tree,
      describe: (e) => ({ kind: (e && e.kind) || 'error', message: String((e && e.message) || e || '알 수 없는 오류') }),
      parseFolder: (url) => cfgOf(decodeURIComponent(new URL(url).pathname)),
      revive: (cfg) => cfgOf(cfg.folderPath),
      childCfg: (cfg, name) => cfgOf(`${cfg.folderPath}/${name}`),
      folderUrl: (cfg) => furl(cfg.folderPath),
      fileUrl: (cfg, name) => `${ORIGIN}${cfg.folderPath}/${name}`,
      resolveMyFolder: async (o) => { calls.push(`my:${o.name}`); guard('내 OneDrive'); assert.ok(typeof o.fetch === 'function', 'fetch 를 넘긴다'); return cfgOf(`${ME}/Documents/${o.name}`); },
      resolveFolder: async (input, o) => { calls.push(`resolve:${input || '(비움)'}`); guard('폴더'); if (!input) return cfgOf(`${ME}/Documents/${o.name}`); return cfgOf(decodeURIComponent(new URL(input).pathname)); },
      listFolders: async (cfg, io) => { calls.push(`folders:${cfg.folderPath}`); assert.ok(io && typeof io.fetch === 'function', 'io 에 fetch'); guard('폴더 목록'); if (!(cfg.folderPath in tree)) throw nofolder(cfg.folderPath); return Object.keys(tree).filter((k) => k.startsWith(`${cfg.folderPath}/`) && !k.slice(cfg.folderPath.length + 1).includes('/')).map((k) => ({ name: k.split('/').pop(), path: k, itemCount: Object.keys(tree[k]).length, modified: '2026-10-18T00:00:00Z' })); },
      listFiles: async (cfg) => { calls.push(`list:${cfg.folderPath}`); guard('파일 목록'); if (!(cfg.folderPath in tree)) throw nofolder(cfg.folderPath); return Object.keys(tree[cfg.folderPath]).map((nm) => meta(cfg.folderPath, nm)); },
      readFile: async (cfg, name) => { calls.push(`read:${cfg.folderPath}/${name}`); guard('읽기'); const f = tree[cfg.folderPath]; return f && name in f ? { text: f[name], meta: meta(cfg.folderPath, name) } : null; },
      openWriter: async (cfg, o) => { calls.push(`open:${siteOf(cfg.folderPath)}`); assert.ok(o && o.fetch && o.chrome !== undefined, 'io 를 넘긴다'); guard('작업 탭'); return bound(cfg.folderPath); },
      sharedWithMe: async (io, o) => { calls.push('shared'); assert.ok(o && 'driveHost' in o); return (opts.shared || []).map((s) => ({ name: s.path.split('/').pop(), webUrl: furl(s.path), folder: true, ownerName: s.ownerName || '', cfg: cfgOf(s.path) })); },
    };
  }
  /* chrome.storage.local 흉내 — rerp 와 같은 키(shareState · planSyncState · shareIndex · shareFolder) */
  function fakeChrome(init) {
    const store = Object.assign({}, init || {});
    return { store, storage: { local: { get: async (k) => (Array.isArray(k) ? Object.fromEntries(k.map((x) => [x, clone(store[x])])) : typeof k === 'string' ? { [k]: store[k] === undefined ? undefined : clone(store[k]) } : clone(store)), set: async (o) => { Object.assign(store, clone(o)); }, remove: async (k) => { for (const x of Array.isArray(k) ? k : [k]) delete store[x]; } } } };
  }
  /* 가짜 로컬 — WORKSPACE 의 src/rndshare.js 변환 자리. prjdoc-sync 의 loadLocal 모양 그대로 */
  function memLocal(init) {
    const st = Object.assign({ plan: { plans: {}, del: {} }, research: {}, staff: { plans: {}, del: {} }, aliases: {}, aliasesAt: {}, changes: {}, projects: { P1: { prjNm: '과제1', rspr: '나', anl: 1, stDt: '20260401', endDt: '20261231' } } }, clone(init || {}));
    const saved = [];
    return {
      st, saved,
      loadLocal: async () => clone(st),
      saveLocal: async (part, prj, data, names) => {
        saved.push(`${part}:${prj}`);
        assert.ok(names && typeof names === 'object', 'saveLocal 에 과제명 맵이 온다');
        if (part === 'plan') { st.plan.plans = clone(data.plans); st.plan.del = clone(data.del); }
        else if (part === 'changes') st.changes[`${prj}@${data.year}`] = clone(data.list);
        else if (part === 'alias') { st.aliases = clone(data.aliases); st.aliasesAt = clone(data.aliasesAt); }
        else if (part === 'project') st.projects[prj] = Object.assign({}, st.projects[prj], clone(data));
        else if (part === 'research') st.research = clone(data.map);
        else if (part === 'budget' || part === 'staff') { /* WORKSPACE 는 참여연구원 계획을 안 쓴다(want.staff false) — 예산 줄만 장부로 */ }
        else throw new Error('모르는 칸 ' + part);
      },
    };
  }
  const WS_WANT = { plan: true, research: true, budget: true, changes: true, alias: true, staff: false };   // 계약 — plan 받기만 · research·budget(계획만)·changes·alias 양방향 · staff 안 함
  const mk = (o) => {
    const C = fakeChrome(o.init);
    const copied = [];
    const ss = createShareSync({
      settings: () => o.settings, context: () => o.context, loadLocal: o.mem.loadLocal, saveLocal: o.mem.saveLocal,
      want: o.want === undefined ? WS_WANT : o.want, pullOnly: o.pullOnly === undefined ? { plan: true } : o.pullOnly,
      participants: o.participants || (async () => []), copyText: async (t) => { copied.push(t); return true; }, chrome: C, fetch: async () => { throw new Error('실 fetch 금지'); }, store: o.store,
    });
    return { ss, C, copied };
  };
  const docOf = (store, p, name) => PRJDOC.parse(store.tree[p][name]).doc;
  const CTX = { names: { P1: '과제1' }, rsprs: { P1: '나' }, myPrjNos: ['P1'], leadPrjNos: ['P1'], aliases: { P1: 'SSCB' }, who: '나', myNames: ['나'] };

  await (async () => {
  await test('꺼져 있으면 아무 데도 닿지 않고 skipped off · 동기화 항목이 다 꺼져도 off · SHARE_DEFAULTS 는 rerp lib/settings.js plus 와 같은 칸', async () => {
    const store = fakeStore({ [BASE]: {} });
    const { ss, C } = mk({ store, settings: { enabled: false }, context: CTX, mem: memLocal() });
    const r = await ss.send({ type: 'planSync', reason: 'load' });
    assert.deepStrictEqual([r.ok, r.skipped, r.missing.length], [false, 'off', 1]);
    const off = mk({ store, settings: { enabled: true }, context: CTX, mem: memLocal(), want: { plan: false, research: false, staff: false, changes: false, budget: false, alias: true } });
    assert.deepStrictEqual((await off.ss.send({ type: 'planSync', reason: 'manual' })).skipped, 'off');
    assert.deepStrictEqual(store.calls, []);
    assert.deepStrictEqual(Object.keys(C.store), []);
    assert.deepStrictEqual(Object.keys(SHARE_DEFAULTS).sort(), ['changesSync', 'discover', 'driveHost', 'enabled', 'folder', 'planSync', 'researchSync', 'shareWith', 'staffSync']);
    assert.strictEqual(SHARE_DEFAULTS.driveHost, 'https://krclass-my.sharepoint.com');
  });
  await test('켜면 base(비면 내 OneDrive 문서/업무/shared) 를 풀어 shareFolder 에 캐시하고 책임 과제의 약칭 폴더에 연차 파일을 만들며 shareState·planSyncState·shareIndex 에 남긴다 · 폴더를 새로 만들었으니 참여연구원(내 이름 제외)에게 편집 공유 · 막 맞췄으면 load 는 recent', async () => {
    const store = fakeStore({ [`${ME}/Documents`]: {} }, { people: { 홍길동: 'hong@krs.co.kr' } });
    const mem = memLocal({ aliases: { P1: 'SSCB' }, aliasesAt: { P1: 10 }, changes: { 'P1@1': [change('c10', '2026-10-01', '예산', '연구활동비', '5,000천원', '6,000천원')] }, projects: { P1: { prjNm: '과제1', rspr: '나', anl: 1, stDt: '20260401', endDt: '20261231', jobId: 'RND1', io: 'IO1', note: '메모', start: '2026-04-01', end: '2028-12-31', at: 5 } } });
    const participants = [];
    const { ss, C } = mk({ store, settings: { enabled: true }, context: CTX, mem, participants: async (prjNo) => { participants.push(prjNo); return ['나', '홍길동', { name: '이영희' }]; } });
    const r = await ss.send({ type: 'planSync', reason: 'manual' });
    assert.deepStrictEqual([r.ok, r.reason, r.count, r.written, r.created, r.base.path, r.folder.path], [true, 'manual', 1, 1, ['P1'], BASE, BASE]);
    assert.deepStrictEqual(Object.keys(store.tree).sort(), [`${ME}/Documents`, `${ME}/Documents/업무`, BASE, `${BASE}/SSCB`].sort(), 'base 두 단과 과제 폴더(약칭)');
    assert.deepStrictEqual(Object.keys(store.tree[`${BASE}/SSCB`]), ['1차년도.json'], '예상 비용은 받기만(pullOnly) — 로컬에 항목도 없어 만들지 않음');
    const y1 = docOf(store, `${BASE}/SSCB`, '1차년도.json');
    assert.deepStrictEqual([y1.project, y1.changes.map((c) => c.id), y1.staff.plans, y1.updatedBy], [{ prjNo: 'P1', prjNm: '과제1', rspr: '나', alias: 'SSCB', aliasAt: 10, jobId: 'RND1', io: 'IO1', start: '2026-04-01', end: '2028-12-31', note: '메모' }, ['c10'], [], '나'], 'WORKSPACE 몫(jobId·io·start·end·note)이 project 칸으로 · 참여연구원 계획은 안 씀');
    const pg = r.pages.P1;
    assert.deepStrictEqual([pg.folder, pg.folderUrl, pg.webUrl, pg.pushed, pg.folderCreated, pg.years], ['SSCB', cfgOf(`${BASE}/SSCB`).viewUrl, `${ORIGIN}${BASE}/SSCB/1차년도.json`, true, true, [1]]);
    assert.deepStrictEqual([participants, pg.share.shared, pg.share.notFound, pg.share.role], [['P1'], [{ name: '홍길동', email: 'hong@krs.co.kr' }], ['이영희'], 'edit'], '내 이름은 빼고 참여연구원에게 편집 공유');
    assert.ok(store.calls.includes(`share:${BASE}/SSCB:홍길동,이영희:edit`));
    assert.deepStrictEqual([C.store.shareState.reason, C.store.planSyncState.pages.P1.folder, C.store.researchSyncState.ok, C.store.staffSyncState.ok], ['manual', 'SSCB', true, true], '네 호환 키에 같은 결과');
    assert.deepStrictEqual(C.store.shareIndex, { P1: { base: BASE, folder: 'SSCB', site: siteOf(BASE), path: `${BASE}/SSCB`, url: furl(`${BASE}/SSCB`), owner: '', at: r.at } });
    assert.deepStrictEqual([C.store.shareFolder.input, C.store.shareFolder.baseName, C.store.shareFolder.path, C.store.shareFolder.mine], ['', '업무/shared', BASE, true]);
    const again = await ss.send({ type: 'planSync', reason: 'load' });
    assert.strictEqual(again.skipped, 'recent');
    const n0 = store.calls.length;
    await ss.send({ type: 'planSync', reason: 'manual', prjNo: 'P1' });
    assert.ok(!store.calls.slice(n0).some((c) => c.startsWith('resolve') || c.startsWith('my:')), '캐시한 shareFolder 로 base 를 다시 풀지 않음');
  });
  await test('동료 폴더의 변경 받기 — 예상비용.json 은 받기만(로컬 항목은 올리지 않음) · 변경이력 합집합 · 별칭(aliasAt) · 예상 비용은 planUrl 로 · 상태 pages 호환 칸', async () => {
    const pl = Object.assign(PRJDOC.emptyPlan({ prjNo: 'P1', prjNm: '과제1' }), { plan: { items: [item('q', 1, { prj: 'P1', key: '10|연구활동비' })], del: {} }, updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '동료' });
    const y1 = Object.assign(PRJDOC.emptyYear({ prjNo: 'P1', prjNm: '과제1', alias: 'SSCB-2', aliasAt: 20 }, 1), { changes: [change('c1', '2026-10-01', '기타', 'x', '', '')], updatedAt: '2026-10-18T00:00:00.000Z', updatedBy: '동료' });
    const store = fakeStore({ [BASE]: {}, [`${BASE}/SSCB`]: { '1차년도.json': PRJDOC.serialize(y1), '예상비용.json': PRJDOC.serialize(pl) } });
    const mem = memLocal({ aliases: { P1: 'SSCB' }, aliasesAt: { P1: 10 }, plan: { plans: { P1: { '10|연구활동비': [item('b', 6)] } }, del: {} }, changes: { 'P1@1': [change('c9', '2026-10-09', '기타', 'y', '', '')] } });
    const { ss, C } = mk({ store, settings: { enabled: true, shareWith: 'none' }, context: CTX, mem });
    const r = await ss.send({ type: 'planSync', reason: 'manual' });
    assert.deepStrictEqual([r.ok, r.pages.P1.pulled, r.pages.P1.pushed, r.written, mem.saved], [true, true, true, 1, ['changes:P1', 'alias:P1', 'plan:P1']]);
    assert.deepStrictEqual([mem.st.plan.plans.P1['10|연구활동비'].map((e) => e.id).sort(), docOf(store, `${BASE}/SSCB`, '예상비용.json').plan.items.map((e) => e.id)], [['b', 'q'], ['q']], 'q 받음 · b 는 올라가지 않음');
    assert.deepStrictEqual([mem.st.aliases, mem.st.aliasesAt, mem.st.changes['P1@1'].map((c) => c.id), docOf(store, `${BASE}/SSCB`, '1차년도.json').changes.map((c) => c.id)], [{ P1: 'SSCB-2' }, { P1: 20 }, ['c1', 'c9'], ['c1', 'c9']], '파일 별칭(aliasAt 20 > 10) 받음 · 변경이력은 양쪽 합집합');
    assert.deepStrictEqual([r.pages.P1.planUrl, r.pages.P1.count, r.pages.P1.counts.plan], [`${ORIGIN}${BASE}/SSCB/예상비용.json`, 2, 2]);
    for (const k of ['prjNo', 'title', 'webUrl', 'at', 'created', 'pulled', 'pushed', 'count', 'remoteAt', 'remoteBy']) assert.ok(k in r.pages.P1, `pages 에 ${k}`);
    assert.strictEqual(r.pages.P1.share, undefined, 'shareWith none — 자동 공유 없음');
    assert.strictEqual(C.store.shareState.pages.P1.remoteBy, '동료');
  });
  await test('shareProbe — base 풀기(저장 전 칸 값 msg.folder) · 과제 폴더 목록 · 나와 공유 · 밑폴더가 없어도 연결됨 · 주소 모양이 틀리면 badurl', async () => {
    const store = fakeStore({ [BASE]: {}, [`${BASE}/SSCB`]: {}, [`${BASE}/X`]: {} }, { shared: [{ path: '/personal/you/Documents/업무/shared/수소', ownerName: '동료' }] });
    const { ss, C } = mk({ store, settings: { enabled: true }, context: CTX, mem: memLocal(), init: { shareIndex: { P2: { base: '/personal/you/Documents/업무/shared', folder: '수소', site: `${ORIGIN}/personal/you`, path: '/personal/you/Documents/업무/shared/수소', url: furl('/personal/you/Documents/업무/shared/수소'), owner: '동료', at: 1 } } } });
    const r = await ss.send({ type: 'shareProbe' });
    assert.deepStrictEqual([r.ok, r.folder.path, r.folders.map((f) => f.name), r.count, r.exists, r.mine, r.shared, r.sharedFolders[0].ownerName, r.sharedKnown], [true, BASE, ['SSCB', 'X'], 2, true, true, 1, '동료', 1]);
    assert.match(r.message, /연결됨 · 과제 폴더 2개 · 나와 공유 1개 \(그중 동기화 대상 1개\)/);
    assert.strictEqual(C.store.shareFolder.path, BASE, '연결 확인은 늘 다시 풀어 캐시');
    const r2 = await ss.send({ type: 'shareProbe', folder: `${ORIGIN}/personal/you/Documents/업무/shared` });
    assert.deepStrictEqual([r2.ok, r2.exists, r2.mine, r2.message], [true, false, false, '밑폴더가 아직 없습니다 — 지금 맞추면 만듭니다']);
    const bad = fakeStore({ [BASE]: {} });
    bad.resolveFolder = async () => { throw err('badurl', '폴더 주소를 읽을 수 없습니다'); };
    const r3 = await mk({ store: bad, settings: { enabled: true }, context: CTX, mem: memLocal() }).ss.send({ type: 'shareProbe', folder: 'x' });
    assert.deepStrictEqual([r3.ok, r3.kind, r3.error], [false, 'badurl', '폴더 주소를 읽을 수 없습니다']);
  });
  await test('shareFolderCopy(옛 planExport) 는 과제 폴더(모르면 base) 주소를 deps.copyText 로 · file 이면 예상비용.json · shareOrgLink 는 writer.orgLink 의 조직 내 링크를 복사 · shareFolderPeople 은 이름을 주면 그 사람들, 없으면 참여인력(내 이름 제외) · shareRename 은 색인·상태를 고침', async () => {
    const store = fakeStore({ [BASE]: {}, [`${BASE}/SSCB`]: {} }, { people: { 홍길동: 'hong@krs.co.kr' }, link: 'https://krclass-my.sharepoint.com/:f:/g/personal/me/ORG' });
    const idx = { P1: { base: BASE, folder: 'SSCB', site: siteOf(BASE), path: `${BASE}/SSCB`, url: furl(`${BASE}/SSCB`), owner: '', at: 1 } };
    const { ss, C, copied } = mk({ store, settings: { enabled: true }, context: CTX, mem: memLocal(), init: { shareIndex: idx }, participants: async () => ['나', '홍길동', '김철수'] });
    const a = await ss.send({ type: 'planExport', prjNo: 'P1' });
    assert.deepStrictEqual([a.ok, a.copied, a.what, a.url, copied[0]], [true, true, 'project', cfgOf(`${BASE}/SSCB`).viewUrl, cfgOf(`${BASE}/SSCB`).viewUrl]);
    const b = await ss.send({ type: 'shareFolderCopy', prjNo: 'P9' });
    assert.deepStrictEqual([b.ok, b.what, b.url], [true, 'base', cfgOf(BASE).viewUrl], '모르는 과제는 base 주소');
    const c = await ss.send({ type: 'shareFolderCopy', prjNo: 'P1', file: true });
    assert.strictEqual(c.url, `${ORIGIN}${BASE}/SSCB/예상비용.json`);
    const l = await ss.send({ type: 'shareOrgLink', prjNo: 'P1' });
    assert.deepStrictEqual([l.ok, l.url, l.copied, copied.at(-1)], [true, 'https://krclass-my.sharepoint.com/:f:/g/personal/me/ORG', true, 'https://krclass-my.sharepoint.com/:f:/g/personal/me/ORG']);
    assert.ok(store.calls.includes(`link:${BASE}/SSCB:true`) && store.calls.includes(`close:${BASE}/SSCB`), 'writer 를 열고 닫음');
    const sp = await ss.send({ type: 'shareFolderPeople', prjNo: 'P1' });
    assert.deepStrictEqual([sp.ok, sp.folder, sp.share.shared.map((x) => x.name), sp.share.notFound, sp.message], [true, 'SSCB', ['홍길동'], ['김철수'], '공유 1명 · 못 찾음 1']);
    assert.deepStrictEqual(C.store.shareState.pages.P1.share.shared, [{ name: '홍길동', email: 'hong@krs.co.kr' }], '결과는 shareState.pages 에도');
    const sp2 = await ss.send({ type: 'shareFolderPeople', prjNo: 'P1', names: ['홍길동'], role: 'read' });
    assert.ok(store.calls.includes(`share:${BASE}/SSCB:홍길동:read`));
    assert.deepStrictEqual([sp2.ok, sp2.share.role], [true, 'read']);
    const none = await ss.send({ type: 'shareFolderPeople', prjNo: 'P9' });
    assert.deepStrictEqual([none.ok, none.kind], [false, 'nofolder']);
    const rn = await ss.send({ type: 'shareRename', prjNo: 'P1', name: 'SSCB:새/이름' });
    assert.deepStrictEqual([rn.ok, rn.name, rn.path, C.store.shareIndex.P1.folder, C.store.shareIndex.P1.path, C.store.shareState.pages.P1.folder], [true, 'SSCB새이름', `${BASE}/SSCB새이름`, 'SSCB새이름', `${BASE}/SSCB새이름`, 'SSCB새이름'], '못 쓰는 글자를 걷고 색인·상태를 고침');
    assert.deepStrictEqual((await ss.send({ type: 'shareRename', prjNo: 'P1', name: 'SSCB새이름' })).unchanged, true);
    assert.match((await ss.send({ type: 'what' })).error, /모르는 요청/);
  });
  await test('로그인 필요(auth)는 던지지 않고 상태(kind auth)에 남기며 지난 pages 는 둔다 · badurl 이면 shareFolder 캐시를 지움 · 진행 중에 들어온 manual 은 끝난 뒤 한 번 더 돈다', async () => {
    const store = fakeStore({ [BASE]: {} }, { authAll: true });
    const prev = { at: 1, ok: true, pages: { P1: { prjNo: 'P1', title: '과제1', folder: 'SSCB' } } };
    const { ss, C } = mk({ store, settings: { enabled: true }, context: CTX, mem: memLocal(), init: { shareState: prev, shareFolder: { origin: ORIGIN, folderPath: BASE, input: '', driveHost: SHARE_DEFAULTS.driveHost, baseName: '업무/shared', url: furl(BASE), path: BASE } } });
    const r = await ss.send({ type: 'planSync', reason: 'manual' });
    assert.deepStrictEqual([r.ok, r.kind, r.pages.P1.folder, C.store.shareState.kind], [false, 'auth', 'SSCB', 'auth']);
    assert.match(r.error, /로그인하세요/);
    assert.ok(C.store.shareFolder, 'auth 는 캐시를 지우지 않음');
    const bad = fakeStore({ [BASE]: {} });
    bad.resolveFolder = async () => { throw err('badurl', '주소 모양이 아닙니다'); };
    const b = mk({ store: bad, settings: { enabled: true, folder: 'https://x' }, context: CTX, mem: memLocal(), init: { shareFolder: { origin: ORIGIN, folderPath: BASE, input: '(다른 값)', driveHost: SHARE_DEFAULTS.driveHost, baseName: '업무/shared' } } });
    const rb = await b.ss.send({ type: 'planSync', reason: 'manual' });
    assert.deepStrictEqual([rb.ok, rb.kind, b.C.store.shareFolder], [false, 'badurl', undefined]);
    // 진행 중 + manual → 끝난 뒤 한 번 더(두 번째 결과가 돌아옴)
    const slow = fakeStore({ [BASE]: {} });
    let gate; const opened = new Promise((res) => { gate = res; });
    const orig = slow.listFolders; slow.listFolders = async (...a) => { await opened; return orig(...a); };
    const s = mk({ store: slow, settings: { enabled: true, shareWith: 'none' }, context: CTX, mem: memLocal({ changes: { 'P1@1': [change('c1', '2026-10-01', '기타', 'x', '', '')] } }) });
    const first = s.ss.send({ type: 'planSync', reason: 'manual' });
    const second = s.ss.send({ type: 'planSync', reason: 'manual', prjNo: 'P1' });
    const third = s.ss.send({ type: 'planSync', reason: 'load' });
    gate();
    const [r1, r2, r3] = await Promise.all([first, second, third]);
    assert.deepStrictEqual([r1.ok, r2.ok, r3 === r1, r1.written, r2.written], [true, true, true, 1, 0], 'load 는 진행 중인 결과 · manual 은 끝난 뒤 다시(이미 같아 쓸 것 없음)');
    assert.strictEqual(slow.calls.filter((c) => c.startsWith('folders:')).length, 2, '두 번 돌았다');
  });
  })();
}

console.log(`\n${n} passed${failed ? `, ${failed} failed` : ''}`);
