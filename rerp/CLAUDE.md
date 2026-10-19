# rerp/ — kr_ext_rerp 에서 옮겨 온 코드 (Claude 가 지킬 규칙)

이 폴더의 코드는 **이 저장소에서 쓴 것이 아니라 `E:\dev\kr_ext_rerp`(Chrome 확장 "KR eClass + R&D ERP 현황")에서 옮겨 온 것**이다.
R&D 탭의 rERP 집행내역(과제집행비율 표·예상 비용)과 **공유 (Plus) — SharePoint(OneDrive) 공유 폴더의 과제별 JSON 파일**(2026-10-18 부터; 그 전은 원노트·MCP)이 kr_ext_rerp 와 **같은 코드·같은 저장 키·같은 파일 모양·같은 병합 규칙**을 쓰려고
2026-10-11 에 가져왔고(사용자 지정: "가능하면 기존 코드를 그대로"), 2026-10-18 에 공유 쪽을 다시 옮겼다(사용자 "거기도 이렇게 진행하도록 해줘" · "workspace 에도 경로주면 알아서 동기화"). 어느 파일이 어디서 왔고 무엇을 바꿨는지는 [README.md](README.md), 옮길 때의 원본 커밋·파일 지문은 [origin.json](origin.json).

## 고칠 때

- **원본이 정본이다.** 동작을 바꾸고 싶으면 먼저 `E:\dev\kr_ext_rerp` 에서 고치고(그쪽 테스트), 그 다음 여기로 옮긴다. 여기서만 고치면 두 확장이 어긋나고 다음에 옮길 때 사라진다.
  이 저장소에만 필요한 것(사이드패널에서 어떻게 보일지, 장부와 어떻게 잇는지, 장부 ↔ 연차 파일 변환)은 여기가 아니라 `src/rnderp.js`·`src/rndshare.js`·`rndpanel.js` 에 쓴다.
- **옮기며 바꾼 곳은 README.md 의 "옮기며 바꾼 것" 표에 있는 것뿐이어야 한다**(IIFE → ESM, `chrome.runtime.sendMessage` → `api.send`, 바깥과 닿는 것을 deps 로). 그 밖의 줄은 원본과 같게 둔다 — 그래야 원본의 diff 를 그대로 댈 수 있다.
- 원본이 바뀌었는지는 `node tools/rerp.mjs check`(= `npm run rerp`)가 본다. `npm test` 의 `test/rerp-origin.test.mjs` 가 같은 것을 돌려 **원본이 옮긴 뒤로 바뀌었으면 빨갛게** 한다.
  반영 차례: `check` 로 바뀐 파일 확인 → 원본 diff(`git -C E:\dev\kr_ext_rerp diff <origin.json 의 commit>..HEAD -- <파일>`)를 여기 짝 파일에 같은 뜻으로 적용 → `node --test test/rerp*.test.mjs` →
  `rerp/origin.json` 의 그 파일 지문을 다시 적기(**`node tools/rerp.mjs stamp` 는 옮기지 않은 파일(render.js · rnd-api.js · settings.js)의 드리프트를 가리니 다 옮겼을 때만**) → `npm test`.
- 상호운용 규약은 **바꾸지 않는다**: 저장 키(`plannedExpenses`·`plannedDeleted`·`planSyncState`·`researchPlans`·`staffPlans`·`shareState`·`shareIndex`·`shareFolder`), 공유 폴더 트리(base/<약칭 → Job Id → 과제번호>/`<n>차년도.json` · `예상비용.json`),
  문서 v2 의 모양과 병합(id·ts·aliasAt·at 큰 쪽, changes 는 id 합집합 500, ERP 칸은 rERP 값, 모르는 칸 보존), 집행비율 식(승인액÷예산액 · 미청구·승인전 반영 · 제외 비목 인건비·연구수당·간접비). 이것이 같아야 rerp 가 쓴 파일을 WORKSPACE 가 그대로 읽고 거꾸로도 된다.
- 테스트는 `test/rerp.test.mjs`(원본 `tests/plan-sync.test.js` 를 ESM 으로 + plan·erp) · `test/rerp-share.test.mjs`(원본 `tests/sp-store·prjdoc·prjdoc-sync·staff-sync.test.js` 넷을 ESM 으로 한 파일에 + sharesync 배선) · `test/rerp-research.test.mjs` · `test/rerp-staff.test.mjs` — 원본 테스트가 늘면 같이 옮긴다. 실 SharePoint 에는 닿지 않는다(가짜 fetch·chrome·store).

## 쓰는 쪽

`rndpanel.js`(예산 칸 아래 "rERP 집행내역", 공유 카드 "공유 (SharePoint)" — `createShareSync(deps)`)와 `src/rnderp.js`(차년도 ↔ rERP 잇기·스냅샷·비목 맞추기) · `src/rndshare.js`(장부 ↔ 연차 파일 `project`·`budget`·`changes`·`research` 변환). 설계 배경은 `docs/erp-shared-design.md`(2026-10-10 설계안 — 새 저장소 대신 이 폴더로 둔 것이 2026-10-11 결정).

## 예외 — `mcp.js`

`rerp/mcp.js`(MCP Streamable HTTP 클라이언트)는 원본 `lib/mcp-client.js` 가 2026-10-18 에 지워져 더 옮기지 않는다(MAP·origin.json 에 없음). `mailtrack/`(Outlook MCP — `mailtrack/mcp/outlook.js`)이 import 하므로(`src/teams.js` 는 제 `connect` 를 쓴다) **이 저장소 몫으로 남겨 두고** 고칠 일이 있으면 여기서 고친다. 공유 (Plus) 는 더 이상 MCP 를 쓰지 않는다.

## 참조

rERP 화면이 실제로 어떻게 계산·검증·저장하는지(인건비지급계획 팝업의 계상률 올림, 자료생성 검사, 저장 행, 참여율과 월별 지급의 역할)는 [reference.md](reference.md). 옮겨 온 코드가 아니라 이 저장소의 실측 기록이므로 위 "고칠 때" 규칙·`check` 와 무관하다. rERP 화면을 새로 실측하면 거기에 덧붙이고, 계산 규칙을 바꾸는 쪽(`rnd/skills/rnd-manpower-change`, krs-web-agents 러너)은 그 문서를 먼저 본다.
