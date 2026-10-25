# rerp/ — kr_ext_rerp 에서 옮겨 온 코드

이 폴더는 Chrome 확장 **kr_ext_rerp**(`E:\dev\kr_ext_rerp`, "KR eClass + R&D ERP 현황", 2026-10-25 현재 0.8.9 · 커밋 036e430)의 코드를
KRS WORKSPACE 의 R&D 탭이 쓰려고 **그대로 옮겨 온 것**이다(2026-10-11 사용자 지정 — "rerp 의 지출조회와 원노트 동기화를 R&D 탭에, 가능하면 기존 코드를 그대로"; 2026-10-18 — 공유가 원노트에서 SharePoint 폴더의 과제별 JSON 으로 바뀌어 "거기도 이렇게 진행하도록 해줘" · "workspace 에도 경로주면 알아서 동기화").
옮긴 날의 원본 커밋·파일 지문은 [origin.json](origin.json) 에 있고, `node tools/rerp.mjs check` 가 지금의 원본과 견준다. Claude 가 지킬 규칙은 [CLAUDE.md](CLAUDE.md).

**정본은 kr_ext_rerp 다.** 동작을 고치려면 그쪽을 먼저 고치고 여기로 옮긴다. 이 저장소만의 것(사이드패널 모양·장부와 잇기·장부 ↔ 연차 파일 변환)은 `src/rnderp.js`·`src/rndshare.js`·`rndpanel.js` 에 있다.

## 무엇이 어디서 왔나

| rerp/ | kr_ext_rerp 원본 | 옮긴 것 | 하는 일 |
|---|---|---|---|
| `fmt.js` | `lib/format.js` | 전부 | 숫자·돈·날짜·HTML 이스케이프(`F.num`·`F.money`·`F.esc`·`F.fmtClock` …) |
| `plansync.js` | `lib/plan-sync.js` | 전부 (2026-10-18 다시) | 예상 비용의 병합 규칙: 평면화(`flatten`/`unflatten`)·병합(`merge` — id 별 ts·묘비 90일)·`gcTomb`·`delSlice`/`putBack`. 원노트 페이지 부분(제목·블록·`run`)은 원본이 걷어 냄 |
| `plan.js` | `lib/plan.js` | 전부 (2026-10-18 다시 · 2026-10-25 다시 — `plusOn(prjNo)` 이 `settings.sharePick` 을 봄) | 예상 비용 저장소(`plannedExpenses` 등 rerp 와 같은 키)·월간 구독 셈·입력 폼의 이벤트 위임(`bind`)·저장 아이콘·⬆(과제 폴더 주소 복사 `shareFolderCopy`)·↗(예상비용.json 열기 — `pageOf` 가 `planSyncState.pages[].planUrl` → `folderUrl`). 원노트 가져오기(plan-import·planBind)는 없어짐 |
| `planui.js` | `lib/render.js` | 과제집행비율 표 부분만 (2026-10-11, 예상 비용 아이콘 부분은 2026-10-19 원본 0.8.7 로 다시, 2026-10-25 `budgetTable` 의 `syncOn` 이 `s.sharePick` 을 보는 한 줄) | `budgetTable`(비목·예산·예산잔액·집행비율 막대·예상 비용 줄과 폼·미청구·승인전·합계·예상 반영)·`planBtn`·`planRow`·`planForm`·`rateCell`·아이콘·`projectLink` |
| `erp.js` | `lib/rnd-api.js` (+ `lib/settings.js` 의 `adv` 기본값) | `call`·`describe`·`pool`·`fetchProjectRecs`·`fetchProjects`·`dateRange`·`fetchCards`·`trunc`·`execRate`·`fetchBudget`·`ssoLogin` (2026-10-11, 다시 옮기지 않음) | rERP 호출(`_JSON_` 이중 인코딩·EUC-KR·`GWM0001` 로그인 판정), 과제 목록(500건 절단 대응), 비목별 잔액(`rcomm_0041_01_r004`, 본예산 `_r006` 대체), 미청구 카드, eClass SSO. `collect()` 가 과제마다 하던 미청구·승인전 합산(원본 831~846행)은 `withPending()` 으로 떼어 둠 |
| `sharesync.js` | `background.js` 의 공유 몫(shareSync·shareAutoRename·share*) + `onMessage` 의 `planSync`·`planSyncQueue`·`share*` 갈래 (+ `settings.js` 의 `plus` 기본값·`sharePick`·`sharesProject`) | 공유 (Plus) 배선 (2026-10-18 · 2026-10-25 다시 — 공유할 과제 `scope`/`projects`·`projectSync`, `shareSkip`, 번호 폴더 → 약칭 `shareAutoRename`) | `createShareSync(deps)` → `shareSync`(한 번에 하나·load/alarm 은 1분 안 건너뜀·진행 중 manual 은 끝난 뒤 한 번 더·`prjNo` 로 한 과제만 — 고르지 않은 과제면 `skipped:'project'`·고른 과제만 `allow`)·`queueShareSync`(4초 모음)·`shareProbe`(연결 확인)·`shareFolderCopy`(과제 폴더/base 주소 복사, 옛 `planExport`)·`shareFolderPeople`(참여연구원에게 편집 공유)·`shareOrgLink`(조직 내 링크)·`shareRename`·`send`(메시지 switch)·`SHARE_DEFAULTS`·`sharePick`·`sharesProject`(이름 export). 폴더를 새로 만든 과제는 `deps.participants` 의 이름(내 이름 제외)에게 자동 공유(`shareWith`) |
| `spstore.js` | `lib/sp-store.js` | 전부 (2026-10-18 · 2026-10-25 다시 — 원본 0.8.9 의 목록(`createList`·`recycleList`·`listItems`·`listInfo`)·`sharePeople` 메일 알림도 같이, WORKSPACE 는 안 씀) | SharePoint(OneDrive) 저장소 — **브라우저 로그인 쿠키만**: 주소 풀기(`parseFolder`·`resolveFolder`·`resolveMyFolder`·`childCfg`·`revive`·`folderUrl`·`fileUrl`), 읽기(`listFolders`·`listFiles`·`readFile`·`sharedWithMe`·`permissions`(폴더 권한 — RoleAssignments 펼침, 2026-10-19)·`findPeople`(이름 → 사람, search REST People 원본) — 확장 출처 GET), 쓰기 `openWriter`(최소화 작업 창에서 contextinfo → CheckOut → PUT → CheckIn, `ensurePath`·`modify`·`write`·`remove`·`sharePeople`(이름 또는 이메일)·`unshare`(PrincipalId 의 역할 거두기)·`orgLink`·`rename`·`at`)·`sweepWorkers`·`describe`. 페이지 안 함수(`sp*`)는 바깥 변수를 쓰지 않는다 |
| `prjdoc.js` | `lib/prjdoc.js` | 전부 (2026-10-18 · 2026-10-19 다시 — 행정지원 `project.support`·`supportAt`: BOTH_FIELDS 병합 `mergeProject`, `fromLocalYear` 의 `support` 맵, `toLocalYear` 의 `support` 칸 · 2026-10-25 다시 — 주석만) | 공유 문서 v2 — 연차 파일 `<n>차년도.json`(`project`·`year`·`budget`·`staff`·`research`·`changes`)과 `예상비용.json`(`plan`)의 모양(`normalizeYear`·`normalizePlanDoc`·`parse`·`serialize` — 키 차례 고정·모르는 칸 보존·v1 거절), 폴더 이름(`folderNameFor` 약칭 → Job Id → 과제번호), 로컬 ↔ 문서(`fromLocalYear`·`fromLocalPlan`·`toLocalYear`·`toLocalPlan`), 병합(`mergeYear`·`mergePlan` — project 는 ERP 칸 rERP 값·alias 는 aliasAt·WORKSPACE 칸은 updatedAt 규칙, budget 한 덩이 at, changes 합집합 500, 칸마다 세 모듈의 merge) |
| `prjdocsync.js` | `lib/prjdoc-sync.js` | 전부 (2026-10-18 · 2026-10-19 다시 — `saveLocal` 칸에 `support`, want 기본 `support: true` · 2026-10-25 다시 — `allow`(공유할 과제만)·`skip`/`state.skip`(나와 공유에서 내 과제가 아니었던 폴더 이레)·나와 공유 폴더를 경로와 상관없이 과제 폴더 후보로(`common` 빼고)·같은 과제 폴더가 여럿이면 책임자 폴더 → 경로 차례·`fatal` 이 지난 색인 지킴) | 과제별 차례 `run(deps)` — base 폴더 훑기·색인·"나와 공유" 자동 발견 → 대상 과제(내 참여 ∪ 로컬 자료 ∪ 폴더) → 폴더 없으면 책임자·로컬 자료일 때 만듦(같은 약칭은 `<이름>-<과제번호>`) → 연차마다 읽기·병합·`saveLocal(part)`·체크아웃한 최신 글로 다시 병합해 쓰기 → 예상비용.json 도 같은 식 → writer 는 사이트마다 하나. `want`(끈 칸은 그대로) · **`pullOnly:{ plan, year }`**(읽어 받기만 — 쓰지도 만들지도 않음; 2026-10-18 WORKSPACE 몫으로 원본에 더함) |
| `staffsync.js` | `lib/staff-sync.js` | 전부 (2026-10-18 · 2026-10-25 다시 — 지급 완료 `paid` 는 계획 at 과 따로 `paid.at` 큰 쪽) | 사업비(참여연구원 계획·예산 줄)의 병합 규칙 — 연차마다 at 큰 쪽·묘비 90일(`plansOf`·`merge`·`gcTomb`·`delSlice`·`putBack`). WORKSPACE 는 `want.staff:false` 로 쓰지 않지만 `prjdoc.js` 가 import 한다 |
| `plan.css` | `lib/panel.css` | 과제집행비율 표·집행비율 막대·예상 비용 줄과 폼·공유 아이콘 규칙만 (2026-10-18 다시) | 클래스 이름 `krext-*` 그대로. 어두운 화면 덮어쓰기는 `sidepanel.css` 의 `.rnd .rd-erp` 절 |
| `test/rerp.test.mjs` | `tests/plan-sync.test.js` | ESM 으로 (2026-10-18 다시) | plansync 병합 규칙 그대로 + `plan.js`(월간 구독·`api.send`·`pageOf`)·`erp.js`(흉내 fetch) |
| `test/rerp-share.test.mjs` | `tests/sp-store.test.js` · `tests/prjdoc.test.js` · `tests/prjdoc-sync.test.js` · `tests/staff-sync.test.js` | ESM 으로 한 파일에 (2026-10-18 · 2026-10-25 다시) | 넷을 블록으로 감싸 차례대로(가짜 fetch·chrome·메모리 폴더 트리 — 실 SharePoint 에 닿지 않음) + `sharesync.js` 배선 검사(가짜 store·chrome.storage·로컬 — 켜기·받기만·자동 공유·연결 확인·주소/링크 복사·공유·이름 바꾸기·auth/badurl·진행 중 요청·`sharePick`/`sharesProject`·공유할 과제(`allow`·`skipped:'project'`)·`shareSkip`·번호 폴더 → 약칭) |
| `research.js` | `lib/research.js` | 전부 (2026-10-18 다시) | 연구개발계획서 기록: `KR_<과제>.yaml` 스냅샷 → 그 차년도 기록(`readSnapshot`), 판 차례(`put`), 글·절(`textOf`·`sections`), `researchPlans` 저장. `bind` 가 `researchSyncState`(공유 결과)를 읽는다 |
| `researchsync.js` | `lib/research-sync.js` | 전부 (2026-10-18 다시) | 연구내용의 병합 규칙 — 기록 id 마다 판 → 넣은 시각 → 로컬(`merge`), 파일에 쓸 때 연결 칸을 빼는 `clean`·`LOCAL`. 원노트 페이지(`serialize`·`publish`·`pull`·`linkText`)는 원본이 걷어 냄 |
| `test/rerp-research.test.mjs` | `tests/research.test.js` | ESM 으로 (2026-10-18 다시) | 스냅샷 읽기·잇기·판 차례·`clean`·`merge` — `help-server/classify.js` 검사는 뺌(이 저장소에 없음) |
| `staff.js` | `lib/staff.js` | 전부 (2026-10-18 다시 · 2026-10-19 다시 — 행정지원 `SUPPORT_MAX`·`normalizeSupport`·`supportText`, 날짜 조각(`from`·`to`)·기간 구간 `runs`·`cuts`·`splitByFrac` 등 0.8.7 계산 · 2026-10-25 다시 — `roleShort`·`MIN_RATE`·`amountOfRate` 내림·지급 완료(`normalizePaid`·`paidThroughOf`·`lockOf`·`paidMismatch`)·`carryOver`·`shareLeft`·`applyShare`·`fitBudget`·`evenRange`·`maxRate` 등) | 참여연구원 참여율·지급액: 달·돈 읽기, rERP 식(월급여 절삭·계상률 올림·균등 분할), 사람 모양·형편, rERP 행 → 사람, 적용월부터 바꾸기·초기화·100% 알림·요약 줄·탭 표, **연차**(`planKey` "과제번호@연차"·`yearSpan`·`plansOfProject`)·예산 줄(`normalizeBudget`·`budgetPayOf`)·묘비(`gcTomb`·`remove`), `staffPlans` 저장. **WORKSPACE 는 보이기만 한다**(2026-10-18 사용자 지정 — 계산·변경은 kr_ext_rerp 의 사업비 관리) |
| `test/rerp-staff.test.mjs` | `tests/staff.test.js` | ESM 으로 (2026-10-25 다시 — 원본 그대로, 머리의 require 만 import) | 위 순수 함수의 검사(rERP 식·사람 모양·형편·rERP 행 → 사람·바꾸기·날짜 조각·알림·글·연차·지급 완료) + 끝에 WORKSPACE 의 행정지원 검사(`normalizeSupport`·`supportText`) |

옮기지 않은 것(2026-10-25 더함): 공유 (Plus) 의 **전체 공유 — 자주 사용 가맹점**(`lib/sites-sync.js`·`common/가맹점.json`·`background.js` 의 `shareSitesSync`·`shareSitesPeople`·`shareSitesFolder`·`sitesSelfAt`·`sitesShare` 갈래·`runStore` 의 나와 공유 목록 나눠 쓰기, `settings.js` 의 `sitesSync`·`sitesScope`·`sitesProjects`·`sitesPick`) — WORKSPACE 에 가맹점이 없다. 참여연구원 자료 요청(`lib/collect.js`·`collect*`)·팀즈 MCP·GitHub 동기화(`gitsync`)·연구수당(`allowMembers`)·`staffPersonRates` 도.
그 전부터: rerp 의 패널 틀·카드미청구 보기·참여율·급여·미승인·청구서 입력 도우미·청구 준비·RCMS·사업비 관리 화면(`lib/staff-ui.js`)·Help Chat·콘텐츠 스크립트·팝업·옵션 페이지. 지운 것(2026-10-18): `onenote.js`(`lib/plus-onenote.js`)·`plussync.js`(원노트 배선) — 원본이 걷어 냄("mcp 없이 grph api 하지 않고 브라우저 토큰으로 하라고"). `mcp.js` 는 원본(`lib/mcp-client.js`)이 지워져 **더 옮기지 않지만**(MAP·origin.json 에서 빠짐) `mailtrack/`(Outlook MCP — `mailtrack/mcp/outlook.js`)이 import 하므로 그대로 둔다(`src/teams.js` 는 제 `connect` 를 쓴다) — 아래 "이 저장소에서 쓴 것".

## 옮기며 바꾼 것 (이것 말고는 원본과 같다)

| 어디 | 바꾼 것 | 왜 |
|---|---|---|
| 모든 파일 | IIFE `(function (g) { … g.KRX_X = api; })(self)` → ESM `import`/`export default api`(본문은 2칸 내어쓰기). 원본이 `g.KRX_FMT`·`g.KRX_PLAN_SYNC`·`g.KRX_RESEARCH_SYNC`·`g.KRX_STAFF_SYNC`·`g.KRX_STAFF`·`g.KRX_RESEARCH`·`g.KRX_PRJDOC` 로 읽던 것은 파일 머리의 shim `import …; const g = { KRX_X }` 로 그대로 읽는다 | 사이드패널·서비스워커·`node --test` 가 모두 ESM |
| `spstore.js` | `g` = `globalThis` (`g.fetch`·`g.chrome`) | 전역 fetch·chrome |
| `staff.js` | `export default api` 에 더해 같은 이름들을 `export { … }` 로도 | `rndpanel.js`·`src/rnderp.js` 가 이름으로 import |
| `plan.js` | `chrome.runtime.sendMessage(...)` 세 곳(`requestSync` 의 planSyncQueue/planSync · `copyFolder` 의 shareFolderCopy · 저장 아이콘의 planSync manual) → `api.send(msg)`. 기본은 그대로 `sendMessage`, WORKSPACE 는 `sharesync.js` 의 `send` 를 끼운다 | rerp 는 백그라운드 서비스워커가 동기화하고, 사이드패널은 같은 창에서 돌린다 |
| `erp.js` | `KRX_SETTINGS.load()` 대신 `DEFAULTS`(rerp 의 `adv`·제외 비목·조회 기간 기본값) + `settingsOf(over)` · `withPending()` 추가 | 설정 페이지가 없다 |
| `sharesync.js` | 함수 묶음 → `createShareSync(deps)`. `KRX_SETTINGS.load().plus` → `deps.settings()`, 과제명·책임자·내 참여 과제·책임 과제·별칭·내 이름(projectList·패널 캐시·rndUser·설정 myName) → `deps.context()`, `shareLoadLocal`/`shareSaveLocal`(storage.local 의 plannedExpenses·researchPlans·staffPlans·shareChanges·shareProjects·projectAliases) → `deps.loadLocal()`/`deps.saveLocal(part, prj, data, names)`, 참여인력 조회 `KRX_API.call(rtask_0008_t03_01_r001)` → `deps.participants(prjNo)`, 오프스크린 클립보드 → `deps.copyText`, `fetch`·`chrome` 전역 → `deps.fetch`·`deps.chrome`(없으면 전역), `KRX_SP.` → `SPX.`(= KRX_SP 에 `deps.store` 를 덧씌운 것 — 검사가 가짜 store 를 끼움). 설정의 동기화 항목 체크 대신 `deps.want`(객체/함수)·`deps.pullOnly` 로 `run` 의 want·pullOnly 를 준다. `SHARE_MISSING` 문구는 WORKSPACE 의 설정 › 공유 (Plus) 를 가리킴(가맹점 안내 없음). `shareAutoRename` 의 Job Id 는 `storage.local.shareProjects` 대신 `deps.loadLocal().projects`(폴더 이름이 과제번호가 아닐 때만 한 번). 가맹점이 없어 `sitesOn` 이 늘 거짓 — `projOn` 이 거짓이면 바로 `skipped:'off'`(원본의 `!projOn ? { state: {} }` 갈래 없음). `sharePick`·`sharesProject` 는 `settings.js` 에서 와 이름 export | 사이드패널에는 설정 페이지·패널 캐시·R&D ERP 조회·오프스크린 문서가 없고, 로컬은 장부(`src/rndshare.js` 변환)다. 저장 키(`shareState`·`planSyncState`·`shareIndex`·`shareFolder`·`shareSkip`)는 그대로 |
| `planui.js` | `deepLink`·`projectLink` 를 같이 옮김(원본 190·217행). WORKSPACE 에는 `#krext=` 를 읽는 `rnd-hook.js` 가 없어 링크는 rERP 메인만 연다 | 표 안의 "자금현황에서 확인" 링크 |
| `test/rerp-share.test.mjs` | 원본 검사 넷의 머리(require·전역 별칭·n/failed/test 선언)와 꼬리(passed 출력)만 떼고 파일마다 블록 `{ … }` 으로 감싸 차례대로 `await` | 한 파일에 넷 — 이름이 겹치지 않게 |
| `test/rerp-staff.test.mjs` | 머리의 `require`·`KRX_STAFF` 를 `import S from '../rerp/staff.js'` 로, 끝에 행정지원 검사 하나 | 원본에 `normalizeSupport` 검사가 없다 |

## 이 저장소에서 쓴 것 (kr_ext_rerp 에서 온 것이 아님 — origin.json·`check` 대상 아님)

- `mcp.js` — MCP Streamable HTTP 클라이언트(`open`·`probe`·`describe`, 규약 `2025-06-18`). 2026-10-11 에 kr_ext_rerp `lib/mcp-client.js` 를 옮긴 것인데 원본이 2026-10-18 에 지워져(공유가 원노트·MCP 를 떠남) **이제는 이 저장소 몫**이다 — `mailtrack/mcp/outlook.js` 등 메일 추적의 Outlook MCP 가 import 하므로 남겨 둔다(사용자 2026-10-18: "src/teams.js·mailtrack 의 MCP 는 그대로"). 고칠 일이 있으면 여기서 고친다(`check` 대상 아님).
- [reference.md](reference.md) — rERP 화면 실측 참조(2026-10-18): 참여인력신청의 인건비지급계획 팝업이 지급금액에서 계상률을 어떻게 올림하는지, 자료생성이 무엇을 검사하고 어떤 월 행을 저장하는지, 참여율(공문·IRIS)과 월별 지급(rERP)의 역할, 우리 계산기·러너와 어긋나는 곳. rERP 화면을 새로 실측하면 여기에 덧붙인다.

## 정본(kr_ext_rerp)에 돌려줄 것 — 2026-10-19 검토에서 본 것, 여기서는 배선(`rndpanel.js`)으로 피했다

- **밑폴더(설정 folder)를 바꿔도 `shareIndex` 가 남는다** — `prjdocsync.js run` 은 색인의 항목 가운데 새 base 밖에 있는 것을 "색인에 있는 동료 폴더" 로 믿어(128~139행) 이미 맞춘 과제는 계속 옛 밑폴더에 쓰고 새 주소는 새 과제에만 쓰인다. WORKSPACE 는 공유 폴더 칸을 고칠 때 `rndpanel.js onShareFolder` 가 `shareIndex`·`shareFolder` 를 지운다.
  rerp 도 같은 길이다(`options/options.js` 가 `plus.folder` 를 저장만 하고, `background.js` 의 `storage.onChanged` 는 "지울 것이 없다" 고 둠) — 설정 저장에서 folder 가 바뀌면 `shareIndex`(적어도 owner 가 없고 base 가 다른 항목)·`shareFolder` 를 지우는 처리를 정본에 더해야 한다. 정본은 고치지 않았다(이 작업은 WORKSPACE 몫만).
- 알아 둔 것: ~~`run` 이 전체 실패(auth·offline 등 `fatal`)로 끝나면 `state.index` 가 빈 것으로 돌아온다~~ — 원본이 고침(2026-10-25 옮김: `fatal` 이 지난 색인을 그대로 돌려준다). 그래서 로그인이 풀린 맞춤 뒤에도 `shareIndex` 가 남는다 — WORKSPACE 는 장부 과제를 rERP 에 이으면 열쇠가 장부 id → 과제번호로 바뀌므로, 옛 열쇠의 색인 항목이 남아 있으면 그 폴더를 옛 열쇠가 차지해 새 열쇠가 `<약칭>-<과제번호>` 폴더를 만든다(잇기 때 색인을 새 열쇠로 옮기는 `rndpanel.js` 몫).

## 상호운용 규약 — 바꾸지 않는다

| 항목 | 값 |
|---|---|
| 예상 비용 저장 | `chrome.storage.local.plannedExpenses = { [과제번호]: { [재원코드\|비목명]: [{ id, name, qty, unit, amt, ts, by?, sub?: { date } }] } }` · 묘비 `plannedDeleted = { [id]: { ts, prj } }` · 마지막 공유 결과 `planSyncState`(= `shareState`) |
| 공유 폴더 트리 (2026-10-18) | base = 설정 folder, 비면 **내 OneDrive 의 문서/업무/shared**(`resolveMyFolder('업무/shared')`, 없으면 만듦) / **과제 폴더** = 약칭 → Job Id → rERP 과제번호(`folderNameFor`, 표시용 — 과제는 파일 안 `project.prjNo`, 없으면 `jobId`) / `<n>차년도.json` · `예상비용.json`. 색인 `shareIndex = { [prjNo]: { base, folder, site, path, url, owner?, at } }` · base 캐시 `shareFolder` · 나와 공유에서 훑어 내 과제가 아니었던 폴더 `shareSkip = { [폴더 경로(소문자)]: { at, prj } }`(이레, 2026-10-25) · 공유할 과제 설정 `plus.scope`('all' · 'pick')·`plus.projects`·`plus.projectSync`(`sharePick`·`sharesProject`) |
| 연차 파일 v2 | `{ v:2, kind:'year', project:{ prjNo, prjNm, rspr, alias, aliasAt, jobId, io, start, end, note, … }, year:{ n, start, end }, budget:[{ name, plan, at, by }], staff:{ plans, del }, research:[기록], changes:[{ id, date, kind, item, before, after, reason, by, at, auto, … }], updatedAt, updatedBy }` — 2칸 들여쓰기·키 차례 고정·모르는 칸 보존, `v` 가 2 가 아니면(v1 포함) 그 파일만 `parse` 로 건너뜀 |
| 예상 비용 파일 v2 | `{ v:2, kind:'plan', project:{ prjNo, prjNm }, plan:{ items(평면 `flatten` 모양), del:{ [id]: ts } }, updatedAt, updatedBy }` — 과제 폴더에 하나(연차에 걸치는 항목이 갈라지지 않게) |
| 병합 | 예상 비용 항목 id 별 ts 큰 쪽(같으면 로컬)·묘비 90일 · 연구내용 기록 id 마다 판 → 넣은 시각 → 로컬 · 사업비 연차마다 at·묘비 90일 · 예산 줄 한 덩이 at(빈 쪽은 못 이김) · 변경이력 **덧붙이기만**(id 합집합·같은 id 는 파일 것·(date, at, id) 차례·500) · `project` 의 `prjNo·prjNm·rspr` 는 rERP 값, `alias` 는 `aliasAt` 큰 쪽(같으면 파일), `jobId·io·start·end·note`·모르는 칸은 파일 `updatedAt` > 로컬이 받은 시각이면 파일 값 |
| 몫 나눔 (사용자 "workspace 에도 경로주면 알아서 동기화") | WORKSPACE 는 `project.jobId·io·note·start·end`(과제 전체 연구기간)·변경이력(`auto` 줄)·연구내용·예산 줄(계획)·별칭을 쓰고 **예상 비용은 받기만**(`pullOnly:{ plan:true }`), 참여연구원 계획은 안 함(`want.staff:false`); rerp 는 `project.prjNo·prjNm·rspr`·`budget`·`staff`·변경이력(`auto:false`)·별칭·예상 비용을 쓴다. 양쪽이 쓰는 칸은 위 병합 규칙으로, 모르는 칸은 양쪽이 보존 |
| 공유 폴더 설정 한 곳 (2026-10-19 사용자 "이 링크 공통으로 맞춰봐") | rerp 설정 › 공유 (Plus) 의 공유 폴더 주소가 정본. WORKSPACE 는 공유 폴더 칸이 비면 `chrome.management.getAll()` 에서 rERP 확장을 이름(`KR eClass + R&D ERP 현황`)으로 찾아 `chrome.runtime.sendMessage(id, { type: 'shareFolder' })` 로 묻고, rerp `background.js` 의 `onMessageExternal` 이 `{ ok, enabled, folder(설정 칸 원문), driveHost, url?, path?, mine?, at?(캐시가 설정과 맞을 때만), version }` 으로 읽기만 답한다(다른 type 무응답 · sender.id 없거나 sender.url 이 chrome-extension:// 아니면 무응답 · 쓰기 없음). WORKSPACE 쪽은 `rndpanel.js askPeer`·`shareEffective`(이 배선은 sharesync.js 가 아니라 패널에 있어 `tools/rerp.mjs check` 대상이 아님). 2026-10-25("rerp 설정을 따름") 부터 WORKSPACE 설정 › Plus 는 그 밖의 칸도 따른다 — 답의 `enabled` 와, rerp 가 실어 주면 `plus?: { discover, shareWith, projectSync, scope, projects, planSync, researchSync, staffSync, changesSync }`(`src/rndshare.js normalizePlus` 가 아는 칸만; 아직 rerp 는 싣지 않아 WORKSPACE 는 켜기·폴더만 따름) |
| 공유·발견 | 폴더를 새로 만든 과제는 참여연구원에게 편집 공유(`sharePeople` — 표시 이름이 꼭 같은 1명만, 겹침·못 찾음은 결과에; 이메일로 물으면 이메일이 같은 1명) · 조직 내 링크(`orgLink`) · 받는 쪽은 "나와 공유"(`sharedWithMe`)에서 경로 끝이 `…/shared`·`…/shared/<이름>` 인 폴더를 훑어 자동 발견(`discover`) · 사람마다의 권한은 `permissions`(읽기)·`sharePeople`(주기)·`unshare`(거두기) — WORKSPACE 참여인력 칸의 읽기·편집 체크가 쓴다(2026-10-19; 사이트 사용자 정보의 표시 이름은 영문이라 **이메일**로 맞추고, 한글 이름은 `findPeople` 이 이메일로 푼다) |
| 집행비율 | 비목 `승인액÷예산액`(둘 다 양수일 때, 소수 2자리 절사) · 과제 `(승인액 + 미청구 + 승인전)÷예산액` · 잔액 `BAL_AMT − 미청구`(승인전은 이미 차감) · 제외 비목 인건비·연구수당·간접비 |

그래서 **eClass 홈의 rerp 패널에서 적은 예상 비용·예산 줄·별칭이 WORKSPACE 의 R&D 탭에 그대로 오고, WORKSPACE 의 과제 정보(Job Id·I/O·비고·전체 기간)·연구내용·변경이력이 rerp 에 간다**(같은 PC 면 저장소까지 같고, 다른 PC·다른 사람이면 같은 과제 폴더의 파일에서 만난다 — 전제는 이 브라우저의 SharePoint 로그인 하나).

## 갱신 (kr_ext_rerp 가 바뀌었을 때)

```
npm run rerp                 # = node tools/rerp.mjs check — 옮긴 뒤로 바뀐 원본 파일을 보인다(npm test 의 test/rerp-origin.test.mjs 도 같은 것을 돌려 빨갛게 한다)
git -C E:\dev\kr_ext_rerp diff dedbd24..HEAD -- lib/prjdoc-sync.js   # (origin.json 의 commit 부터) 원본 diff 를 보고 — 작업 트리 변경까지 옮겼으면 origin.json 의 dirty 도 함께 본다
                             # 여기 짝 파일(위 표)에 같은 뜻으로 적용한다 — "옮기며 바꾼 것" 의 자리는 그대로 두고
node --test test/rerp*.test.mjs   # 옮긴 것이 원본과 같게 도는지(원본 tests/*.test.js 가 늘었으면 같이 옮긴다)
                             # rerp/origin.json 의 그 파일 sha1·bytes 를 지금 원본으로(node 로 sha1). `node tools/rerp.mjs stamp` 는 다 옮겼을 때만 — 옮기지 않은 render.js·rnd-api.js·settings.js 의 드리프트를 가린다
npm test
```

`node tools/rerp.mjs list` 는 위 표를 한 줄씩 보인다. 원본 경로는 `--source <경로>` 나 환경변수 `KR_EXT_RERP` 로 바꾼다(기본 `E:/dev/kr_ext_rerp`). 원본이 없는 PC 에서는 `check` 가 "원본 없음" 으로 지나간다. 2026-10-25(036e430) 에 바뀐 파일을 모두 옮기거나 범위 밖임을 확인하고 `stamp` 했다 — `check` 는 모두 같음(rnd-api.js·panel.css 의 그날 변경은 erp.js·plan.css 범위 밖, erp.js 는 여전히 2026-10-11 판).

## 쓰는 쪽

- `rndpanel.js` — 예산 칸 아래 **rERP 집행내역**(`planui.budgetTable` 그대로 · `plan.bind` 로 ＋/수정/삭제/월간/눈/저장/⬆↗) · 설정 › **공유 (Plus)**(2026-10-25 R&D 탭 공유 카드에서 옮김 — `sharesync.createShareSync`, 공유할 과제는 `scope`/`projects`/`projectSync` → `sharePick`; base 는 공유 폴더 칸(비면 내 OneDrive 문서/업무/shared), `want = { plan: 받기만, research·budget(계획만)·changes·alias: 양방향, staff: 안 함 }`, `pullOnly = { plan: true }`, 대상 과제는 장부의 모든 과제, `loadLocal`/`saveLocal` 은 `src/rndshare.js` 변환). `PLAN.send` 에 `send` 를 끼워 rerp/plan.js 의 요청(planSync·planSyncQueue·shareFolderCopy)이 같은 창에서 돈다.
- `src/rnderp.js` — 차년도 ↔ rERP 과제 잇기(어느 연차 행인가), 스냅샷(`erp.fetchBudget` + `fetchCards` + `withPending`)을 장부 줄에(집행 = 승인액), 비목 이름 맞추기, 참여인력 조회(`fetchParticipants` — `sharesync` 의 `deps.participants` 가 쓰는 이름의 바탕).
- `src/rndshare.js` — 장부 과제 ↔ 연차 파일 `project` 칸(별칭·Job Id·I/O·책임자·전체 기간·비고·wsId), 장부 차년도 ↔ `budget`(계획)·`changes`·`research`, 과제 맞추기(wsId → prjNo → code → name).
- `rndpanel.js` 의 **참여인력** 칸 · `src/rnderp.js` 의 `fetchParticipants`·`fetchOthers`(2026-10-18) — 이어진 rERP 과제의 참여인력(지급계획)을 `staff.js` 의 `rowsOfErp`·`peopleOfErp`·`othersOfErp` 로 사람 모양으로 받아 `years[n].erp.staff` 에 두고, `personStats`·`checks`(100% 초과)·`staffTsv`·`staffLines` 로 **보이기만** 한다. 참여율·지급액의 계획과 변경은 kr_ext_rerp 의 사업비 관리 몫이다(2026-10-18 사용자 지정: "참여연구원 계산하는거 관련해서는 kr_ext_rerp 로 넘기고, 거기는 참여연구원 참여율/지급액 관리만 rerp 근거로 표시").
- 설계 배경 `docs/erp-shared-design.md`(2026-10-10 설계안). 거기서는 공유 코드를 새 저장소 `kr_ext_shared` 에 두자고 했으나, 2026-10-11 사용자가 **이 저장소의 별도 폴더(rerp/)에 두고 출처를 적어 두는 것**으로 정했다.
