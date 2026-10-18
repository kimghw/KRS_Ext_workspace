# rerp/ — kr_ext_rerp 에서 옮겨 온 코드 (Claude 가 지킬 규칙)

이 폴더의 코드는 **이 저장소에서 쓴 것이 아니라 `E:\dev\kr_ext_rerp`(Chrome 확장 "KR eClass + R&D ERP 현황")에서 옮겨 온 것**이다.
R&D 탭의 rERP 집행내역(과제집행비율 표·예상 비용)과 예상 비용의 원노트 동기화(확장 Plus)가 kr_ext_rerp 와 **같은 코드·같은 저장 키·같은 원노트 페이지**를 쓰려고
2026-10-11 에 가져왔다(사용자 지정: "가능하면 기존 코드를 그대로"). 어느 파일이 어디서 왔고 무엇을 바꿨는지는 [README.md](README.md), 옮길 때의 원본 커밋·파일 지문은 [origin.json](origin.json).

## 고칠 때

- **원본이 정본이다.** 동작을 바꾸고 싶으면 먼저 `E:\dev\kr_ext_rerp` 에서 고치고(그쪽 테스트), 그 다음 여기로 옮긴다. 여기서만 고치면 두 확장이 어긋나고 다음에 옮길 때 사라진다.
  이 저장소에만 필요한 것(사이드패널에서 어떻게 보일지, 장부와 어떻게 잇는지)은 여기가 아니라 `src/rnderp.js`·`rndpanel.js` 에 쓴다.
- **옮기며 바꾼 곳은 README.md 의 "옮기며 바꾼 것" 표에 있는 것뿐이어야 한다**(IIFE → ESM, `chrome.runtime.sendMessage` → `api.send`, 바깥과 닿는 것을 deps 로). 그 밖의 줄은 원본과 같게 둔다 — 그래야 원본의 diff 를 그대로 댈 수 있다.
- 원본이 바뀌었는지는 `node tools/rerp.mjs check`(= `npm run rerp`)가 본다. `npm test` 의 `test/rerp-origin.test.mjs` 가 같은 것을 돌려 **원본이 옮긴 뒤로 바뀌었으면 빨갛게** 한다.
  반영 차례: `check` 로 바뀐 파일 확인 → 원본 diff(`git -C E:\dev\kr_ext_rerp diff <origin.json 의 commit>..HEAD -- <파일>`)를 여기 짝 파일에 같은 뜻으로 적용 → `node test/rerp.test.mjs` →
  `node tools/rerp.mjs stamp`(지문·커밋 다시 적기) → `npm test`.
- 상호운용 규약은 **바꾸지 않는다**: 저장 키(`plannedExpenses`·`plannedDeleted`·`planSyncState`·`plusPlanPages`·`plusSection`), 페이지 제목 `[예상 비용] {과제번호} {과제명}`, 블록 `<table data-id="krx-plan">` + `krxplan1:`,
  병합(id 별 ts·묘비 90일), 집행비율 식(승인액÷예산액 · 미청구·승인전 반영 · 제외 비목 인건비·연구수당·간접비). 이것이 같아야 rerp 패널에서 적은 예상 비용이 WORKSPACE 에 그대로 오고 거꾸로도 온다.
- 테스트는 `test/rerp.test.mjs`(원본 `tests/plan-sync.test.js` 를 ESM 으로 옮긴 것 + erp·plussync) — 원본 테스트가 늘면 같이 옮긴다.

## 쓰는 쪽

`rndpanel.js`(예산 칸 아래 "rERP 집행내역", 원노트 칸의 "예상 비용")와 `src/rnderp.js`(차년도 ↔ rERP 잇기·스냅샷·비목 맞추기). 설계 배경은 `docs/erp-shared-design.md`(2026-10-10 설계안 — 새 저장소 대신 이 폴더로 둔 것이 2026-10-11 결정).

## 참조

rERP 화면이 실제로 어떻게 계산·검증·저장하는지(인건비지급계획 팝업의 계상률 올림, 자료생성 검사, 저장 행, 참여율과 월별 지급의 역할)는 [reference.md](reference.md). 옮겨 온 코드가 아니라 이 저장소의 실측 기록이므로 위 "고칠 때" 규칙·`check` 와 무관하다. rERP 화면을 새로 실측하면 거기에 덧붙이고, 계산 규칙을 바꾸는 쪽(`rnd/skills/rnd-manpower-change`, krs-web-agents 러너)은 그 문서를 먼저 본다.
