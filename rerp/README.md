# rerp/ — kr_ext_rerp 에서 옮겨 온 코드

이 폴더는 Chrome 확장 **kr_ext_rerp**(`E:\dev\kr_ext_rerp`, "KR eClass + R&D ERP 현황", 2026-10-11 현재 0.8.3 · 커밋 4e4803c 2026-10-11 + 그날 작업 트리의 `lib/render.js` 변경 — 비목별 예상 반영 행을 항목 줄보다 먼저 비목 행 바로 밑에)의 코드를
KRS WORKSPACE 의 R&D 탭이 쓰려고 **그대로 옮겨 온 것**이다(2026-10-11 사용자 지정 — "rerp 의 지출조회와 원노트 동기화를 R&D 탭에, 가능하면 기존 코드를 그대로").
옮긴 날의 원본 커밋·파일 지문은 [origin.json](origin.json) 에 있고, `node tools/rerp.mjs check` 가 지금의 원본과 견준다. Claude 가 지킬 규칙은 [CLAUDE.md](CLAUDE.md).

**정본은 kr_ext_rerp 다.** 동작을 고치려면 그쪽을 먼저 고치고 여기로 옮긴다. 이 저장소만의 것(사이드패널 모양·장부와 잇기)은 `src/rnderp.js`·`rndpanel.js` 에 있다.

## 무엇이 어디서 왔나

| rerp/ | kr_ext_rerp 원본 | 옮긴 것 | 하는 일 |
|---|---|---|---|
| `fmt.js` | `lib/format.js` | 전부 | 숫자·돈·날짜·HTML 이스케이프(`F.num`·`F.money`·`F.esc`·`F.fmtClock` …) |
| `mcp.js` | `lib/mcp-client.js` | 전부 | MCP Streamable HTTP 클라이언트(`open`·`probe`·`describe`) — initialize·세션 id·SSE 답·DELETE. 규약 `2025-06-18` |
| `onenote.js` | `lib/plus-onenote.js` | 전부 | KR_MS365_mcp onenote 도구로 섹션(찾기·만들기 `ensureSection`)·페이지(목록·찾기·만들기·읽기 `include_ids`)·블록(`findBlock`·`writeBlock` — 생성 id 로 replace)·링크 풀기(`resolveLink`) |
| `plansync.js` | `lib/plan-sync.js` | 전부 | 예상 비용 ↔ 과제별 원노트 페이지: 제목 규칙(`[예상 비용] 과제번호 과제명`)·평면화·병합(id 별 ts·묘비 90일)·블록 직렬화(`krx-plan`/`krxplan1:`)·`run` |
| `plan.js` | `lib/plan.js` | 전부 | 예상 비용 저장소(`plannedExpenses` 등 rerp 와 같은 키)·월간 구독 셈·입력 폼의 이벤트 위임(`bind`)·저장 아이콘·⬇⬆ 흐름 |
| `planui.js` | `lib/render.js` | 과제집행비율 표 부분만 | `budgetTable`(비목·예산·예산잔액·집행비율 막대·예상 비용 줄과 폼·미청구·승인전·합계·예상 반영)·`planBtn`·`planRow`·`planForm`·`rateCell`·`isProjectLead`·아이콘·`projectLink` |
| `erp.js` | `lib/rnd-api.js` (+ `lib/settings.js` 의 `adv` 기본값) | `call`·`describe`·`pool`·`fetchProjectRecs`·`fetchProjects`·`dateRange`·`fetchCards`·`trunc`·`execRate`·`fetchBudget`·`ssoLogin` | rERP 호출(`_JSON_` 이중 인코딩·EUC-KR·`GWM0001` 로그인 판정), 과제 목록(500건 절단 대응), 비목별 잔액(`rcomm_0041_01_r004`, 본예산 `_r006` 대체), 미청구 카드, eClass SSO. `collect()` 가 과제마다 하던 미청구·승인전 합산(원본 831~846행)은 `withPending()` 으로 떼어 둠 |
| `plussync.js` | `background.js` 562~708행 + `onMessage` 의 `plan*`·`plus*` 갈래 (+ `settings.js` 의 `plus` 기본값) | 확장 Plus 배선 | `planSync`(한 번에 하나·1분 안 건너뜀·RERP 섹션·책임자만 생성)·`queuePlanSync`(4초 모음)·`plusProbe`·`plusNotebooks`·`planExport`(링크+ID 복사)·`planBind`(동료 링크 묶기)·`plusResolveSection`·`send`(메시지 switch) |
| `plan.css` | `lib/panel.css` | 과제집행비율 표·집행비율 막대·예상 비용 줄과 폼·원노트 아이콘 규칙만 | 클래스 이름 `krext-*` 그대로. 어두운 화면 덮어쓰기는 `sidepanel.css` 의 `.rnd .rd-erp` 절 |
| `test/rerp.test.mjs` | `tests/plan-sync.test.js` | ESM 으로 | plansync·onenote·mcp 의 순수 함수와 `run`(가짜 OneNote) 그대로 + `erp.js`(흉내 fetch)·`plussync.js`(가짜 MCP 서버) |

옮기지 않은 것: rerp 의 패널 틀·카드미청구 보기·참여율·급여·미승인·청구서 입력 도우미·청구 준비·RCMS·Help Chat·콘텐츠 스크립트·팝업·옵션 페이지.

## 옮기며 바꾼 것 (이것 말고는 원본과 같다)

| 어디 | 바꾼 것 | 왜 |
|---|---|---|
| 모든 파일 | IIFE `(function (g) { … g.KRX_X = api; })(self)` → ESM `import`/`export default api`. 원본이 `g.KRX_FMT`·`g.KRX_PLAN`·`g.KRX_SETTINGS` 로 읽던 것은 파일 머리의 shim `const g = { KRX_FMT: F, … }` 로 그대로 읽는다 | 사이드패널·서비스워커·`node --test` 가 모두 ESM |
| `mcp.js` | `g` = `globalThis` (`g.fetch`) | 전역 fetch |
| `plan.js` | `chrome.runtime.sendMessage(...)` 네 곳(`requestSync`·`prepareExport`·`applyImport`·`plan-persist`) → `api.send(msg)`. 기본은 그대로 `sendMessage`, WORKSPACE 는 `plussync.js` 의 `send` 를 끼운다 | rerp 는 백그라운드 서비스워커가 동기화하고, 사이드패널은 같은 창에서 돌린다 |
| `erp.js` | `KRX_SETTINGS.load()` 대신 `DEFAULTS`(rerp 의 `adv`·제외 비목·조회 기간 기본값) + `settingsOf(over)` · `withPending()` 추가 | 설정 페이지가 없다 |
| `plussync.js` | 함수 묶음 → `createPlusSync(deps)`. `KRX_SETTINGS.load().plus` → `deps.settings()`, 과제명·내 과제·책임 과제·내 이름(패널 캐시·`projectList`·`rndUser`·참여인력) → `deps.context()`, 오프스크린 클립보드 → `deps.copyText`, `KRX_MCP.open(url, { … fetch: deps.fetch })` | 사이드패널에는 설정 페이지·캐시·오프스크린 문서가 없다. 저장 키(`plusSection`·`plusPlanPages`·`planSyncState`)는 그대로 |
| `planui.js` | `deepLink`·`projectLink` 를 같이 옮김(원본 190·217행). WORKSPACE 에는 `#krext=` 를 읽는 `rnd-hook.js` 가 없어 링크는 rERP 메인만 연다 | 표 안의 "자금현황에서 확인" 링크 |

## 상호운용 규약 — 바꾸지 않는다

| 항목 | 값 |
|---|---|
| 예상 비용 저장 | `chrome.storage.local.plannedExpenses = { [과제번호]: { [재원코드\|비목명]: [{ id, name, qty, unit, amt, ts, by?, sub?: { date } }] } }` · 묘비 `plannedDeleted = { [id]: { ts, prj } }` · `planSyncState` · `plusPlanPages` · `plusSection` |
| 페이지 | 섹션 이름 기본 `RERP`(대소문자 무시, 없으면 고른 노트북에 만듦) · 과제마다 한 장 `[예상 비용] {과제번호} {과제명}` · 과제번호로 찾는다 · **과제 책임자만 만든다** |
| 블록 | `<table data-id="krx-plan">` 하나 — 제목 줄 · 머리글 · 줄 · 기계용 칸 `krxplan1:` + base64 UTF-8 JSON `{ v:1, at, by, items[], del{} }` · 있던 표는 `include_ids` 로 읽은 생성 id 로 통째로 replace |
| 병합 | id 별 ts 큰 쪽(같으면 로컬) · 묘비가 항목 ts 이상이면 삭제, 항목이 더 새로우면 묘비 폐기 · 90일 지난 묘비 버림 |
| 집행비율 | 비목 `승인액÷예산액`(둘 다 양수일 때, 소수 2자리 절사) · 과제 `(승인액 + 미청구 + 승인전)÷예산액` · 잔액 `BAL_AMT − 미청구`(승인전은 이미 차감) · 제외 비목 인건비·연구수당·간접비 |

그래서 **eClass 홈의 rerp 패널에서 적은 예상 비용이 WORKSPACE 의 R&D 탭에 그대로 오고, 거꾸로도 온다**(같은 PC 면 저장소까지 같고, 다른 PC 면 원노트 페이지에서 만난다).

## 갱신 (kr_ext_rerp 가 바뀌었을 때)

```
npm run rerp                 # = node tools/rerp.mjs check — 옮긴 뒤로 바뀐 원본 파일을 보인다(npm test 의 test/rerp-origin.test.mjs 도 같은 것을 돌려 빨갛게 한다)
git -C E:\dev\kr_ext_rerp diff 4e4803c..HEAD -- lib/plan-sync.js     # (origin.json 의 commit 부터) 원본 diff 를 보고 — 작업 트리 변경까지 옮겼으면 origin.json 의 dirty 도 함께 본다
                             # 여기 짝 파일(위 표)에 같은 뜻으로 적용한다 — "옮기며 바꾼 것" 의 자리는 그대로 두고
node test/rerp.test.mjs      # 옮긴 것이 원본과 같게 도는지(원본 tests/plan-sync.test.js 가 늘었으면 같이 옮긴다)
node tools/rerp.mjs stamp    # origin.json 의 지문·커밋을 지금 원본으로
npm test
```

`node tools/rerp.mjs list` 는 위 표를 한 줄씩 보인다. 원본 경로는 `--source <경로>` 나 환경변수 `KR_EXT_RERP` 로 바꾼다(기본 `E:/dev/kr_ext_rerp`). 원본이 없는 PC 에서는 `check` 가 "원본 없음" 으로 지나간다.

## 쓰는 쪽

- `rndpanel.js` — 예산 칸 아래 **rERP 집행내역**(`planui.budgetTable` 그대로 · `plan.bind` 로 ＋/수정/삭제/월간/눈/저장/⬇⬆↗) · 원노트 칸의 **예상 비용** 체크(`plussync.createPlusSync`).
- `src/rnderp.js` — 차년도 ↔ rERP 과제 잇기(어느 연차 행인가), 스냅샷(`erp.fetchBudget` + `fetchCards` + `withPending`)을 장부 줄에(집행 = 승인액), 비목 이름 맞추기.
- 설계 배경 `docs/erp-shared-design.md`(2026-10-10 설계안). 거기서는 공유 코드를 새 저장소 `kr_ext_shared` 에 두자고 했으나, 2026-10-11 사용자가 **이 저장소의 별도 폴더(rerp/)에 두고 출처를 적어 두는 것**으로 정했다.
