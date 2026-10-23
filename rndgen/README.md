# rndgen/ — R&D 탭의 과제 더하기 · 변경 및 이력 관리의 YAML 고치기

KRS WORKSPACE 사이드패널 **R&D** 탭의 카드 하나와 카드 하나의 위쪽 몫.

- **과제 더하기**(머리 줄의 차년도 아이콘 · 과제 없음 카드의 `과제 더하기` · 빈 차년도 카드의 `사업계획서에서 이 차년도 뽑기` — 칩 줄의 ＋ 는 2026-10-19 사용자 지정 "sscb 옆에 더하기 취소하고, 과제 더하기 옆에 과제 뱃지를 선택할 수 있게" 로 없앴고, 대상 과제는 카드 제목 옆의 **배지**(장부의 과제들 · 새 과제)로 고른다) — 연구개발계획서 YAML 을 그대로 넣거나,
  **사업계획서·연구계획서**(PDF · HWPX · DOCX · XLSX · PPTX · TXT/MD)에서 **그 차년도의 KR 스냅샷 YAML**(`KR_<과제>.yaml`)을 Claude 로 뽑아 미리보기 뒤 장부에 넣는다. `직접 적기`는 지금까지의 새 과제 폼.
- **변경 및 이력 관리의 YAML 고치기** — 과제를 보고 있고 그 차년도에 예산 정보가 있으면 늘 서는 **변경 및 이력 관리** 카드(`sidepanel.html` 의 `#rdChangeBox` — 진행 기록 아래, 다른 칸처럼 접힌 한 줄)의 위쪽 — 펴야 보인다.
  처음엔 머리 아래의 따로 선 `변경사항 반영` 카드였다가 2026-10-16 사용자 지정("이건 변경 및 이력 관리 로 해서 -- 변경이력 이걸 대체해줘")으로 변경이력 칸을 대체해 그 카드의 위쪽이 됐다 —
  카드 틀·이름·아래의 변경이력 목록(직접 적기·고치기·사유)은 `rndpanel.js` 것이고 여기는 기준 줄부터 그린다. 바뀐 내용을 **아무 꼴**(메일·공문·메모·표)로 적거나 문서를 붙이면 Claude 가 기준 YAML 을 고친 전문을 돌려주고,
  구조 차이·새로 남을 변경이력 미리보기 뒤 `반영`하면 재생성본(`KR_<과제>_rN.yaml`)을 넣은 것과 같다.

> 2026-10-16 사용자 지정(원문): "sscb 버튼 누르면 그리 안감, + 누르면 Yaml 파일을 넣던지 아니면 사업계획서를 넣으면 과제의 YAML을 추출하도록 해줘. 그 스킬은 '차년도 YAML 뽑는 스킬' 거기 있지.
> 그리고 변경사항의 내용을 임의 형식으로 제공 하면 yaml 로 수정해서 업데이트 하도록 해줘."
>
> 앞 문장("sscb 버튼 누르면 그리 안감")은 rndpanel.js 의 버그였다 — 새 과제 폼을 연 채 보고 있던 과제의 칩을 누르면 아무 일도 없었다. 이제 폼·덮개 동안에는 과제 칩이 모두 꺼지며(＋ 칩은 2026-10-19 에 없앴다),
> 어느 칩이든 누르면 폼·덮개를 닫고 그 과제로 간다(`pickProject`).

처음(2026-10-08)에는 "이 확장은 YAML 을 뽑지 않는다" 였다 — 스킬 묶음(`rnd/skills/`)을 복사해 쓰라고 두었을 뿐이다. 이제 **그 차년도 스냅샷 뽑기와 고치기**는 여기서 하고,
이력(`history/*.yaml`)·인력/예산 변경안·최신본 모으기는 여전히 스킬 묶음으로 한다. 뽑기의 지시문은 첫 스킬 `rnd-kr-extract` 의 references 두 문서를 그대로 싣는다.
Claude 가 지킬 규칙은 [CLAUDE.md](CLAUDE.md). 쓰는 법(사람 눈높이)은 저장소 README 의 `## R&D 탭`.

## 흐름

```
머리 줄의 차년도 아이콘(2026-10-19) · 과제 없음 카드의 과제 더하기 · 빈 차년도 카드의 단추 ── rndpanel.js(onAdd 훅) ──▶ panel.js openAdd(대상 { projectId } · {} · { projectId, n } — 아이콘이면 아직 없는 첫 차년도를 골라 둠 firstMissing)
   덮개: rnd.setOverlay('add', close) — 머리·몸통·빈 차년도 카드가 숨고 과제 칩은 모두 꺼진다(칩 줄의 ＋ 는 2026-10-19 에 없앰). 과제 칩을 누르면 close → 카드가 닫히고 그 과제로.
   제목 옆 과제 배지(paintProjects — 장부의 과제들 · 새 과제, 열 개면 새 과제 잠김) ─▶ retarget: 대상만 바꾼다 — 차년도 단추 줄(골라 둔 숫자·모두·없는 것만은 그대로, 자동이었으면 firstMissing)·별칭(뽑은 것이 없을 때만)이 따라가고 재료·미리보기는 둔다(다시 뽑기는 바뀐 대상으로)
   │
   ├─ YAML 파일 ─────────────────────────────▶ rnd.intake(texts, { source: 'file' }) ─▶ (들어가면) 카드 닫고 rnd.pick(과제, 차년도)
   │
   └─ 문서 하나 ─▶ source.readDocument  (크기 제한 없이 — 2026-10-23 사용자 "크기 제한없이 분할해서 처리". PDF: doctext/browser.js pdfAllText 로 모든 쪽 글자 → splitPages 로 글자 8만 자 안의 이어진 쪽 묶음
                  │                       → pdf-lib 로 묶음마다 그 쪽만 담은 작은 PDF(8MB 를 넘으면 쪽을 반으로) · 스캔본은 쪽 수로 묶음(원본이 8MB 안이면 통째) · HWPX/DOCX/XLSX/PPTX: src/officetext.js → splitChunks
                  │                       · TXT/MD 그대로) → 재료(Material — parts[] 가 문서 차례대로의 부분, text 는 다 이은 것)
                  │  재료가 비면(글자도 PDF 도 없음) 묻지 않고 까닭을 알린다
                  ▼
               llm.loadSkillDocs(rnd/skills/rnd-kr-extract/references/{extract_fields.yaml, structured_output.md})
               llm.askExtract → extractInput(머리말 · 스킬 문서 둘 · 재료 글) → askClaude('rnd.extract', …, { files: [작은 PDF] })  (로컬 CLI → API 키, API 는 스트리밍)
                  ▼
               yaml.checkExtracted(스냅샷 꼴인가 · 차년도 · 비목 합) → yaml.finalizeExtracted(meta.차년도 · rev r0 · source · # [n차년도 최초] 머리 주석)
                  ▼
               미리보기(summarizeSnapshot · 경고 · 별칭 · YAML 원문) ─ 넣기 ─▶ rnd.intake(source 'extract') → rnd.setAlias(새 과제면) → 닫고 rnd.pick

   차년도 고르기의 '모든 차년도'(2026-10-16) ─▶ 같은 재료로 1차년도부터 위 묻기·검사·마무리를 차년도마다 한 번씩 차례로(한 번에 하나)
   '없는 차년도만'(2026-10-19 사용자 "E(있는거 빼고 아직 없는거)") ─▶ 같은 길인데 예산 정보가 있는 차년도(대상 과제 → 재료 글의 과제번호·과제명으로 짚은 장부 과제 guessProject → 처음 답의 과제)는 skip 줄로 건너뛰고,
      연구기간 안이 다 있으면 그 다음 차년도를 물어 답의 연차범위까지(문서가 거기까지가 아니면 그 답은 버림 — beyond). 차년도 칸은 과제가 있으면 적어도 1~5(STAGE_MIN) — 연구기간 밖을 넣으면 src/rndyaml.js 가 종료일을 늘린다
   차년도 고르기는 드롭다운이 아니라 단추 줄(paintStage · setStage · toggleStage — 자동 · 1…N · 모두 · 없는 것만, 고른 값은 #rdgStage 의 data-value; 2026-10-19 사용자 "버튼으로 선택할 수 있게") — 과제가 있으면 예산 정보가 없는 차년도는 점선(off), 툴팁에 이미 있음/아직 없음
   숫자 단추는 여러 개를 켜고 끈다(같은 날 사용자 "3,4 이렇게 2개만 선택할 수도 있게" — 값은 '3,4'; 자동·모두·없는 것만은 하나, 숫자가 다 꺼지면 자동) ─▶ 둘 이상이면 extractYears(그 숫자들, PICKED): 같은 길로 그 차년도들만 차례로 — counted 로 두어 문서의 연차범위로 줄을 늘리거나 줄이지 않는다. zip 은 `_3-4차년도.zip`
                  몇 차년도까지 = 대상 과제의 연구기간(있으면) → 처음 읽힌 답의 yaml.stageCount(meta.연차범위 · 연차별기간 · 기간 — 문서가 이긴다) · 둘 다 모르면 1차년도만
                  ▼  한 차년도가 실패해도 다음으로 — 그 줄의 다시 뽑기는 그 차년도만
               차년도마다 한 줄(합계 · 참여연구자 · 경고 / 까닭 · YAML 칸에 열기 · 다시 뽑기) ─ 넣기 ─▶ rnd.intake 한 번(이름 'N차년도/KR_<과제>.yaml' — onIntake 가 차년도마다 짝지음)
                  · 과제명·과제번호가 다른 차년도가 섞이면 넣지 않음 · 저장은 buildZip(src/zip.js) 의 N차년도/KR_<과제>.yaml 묶음

변경 및 이력 관리 카드의 YAML 고치기(view.project && !editing && !overlay && !yearEmpty)
   기준 = store.get(과제, 차년도).text  또는  yaml.bookToSnapshot(장부 → 스냅샷 꼴, 손실 있음)
   변경 글 + 붙인 문서(source.readDocument — 글자만) ─▶ llm.askRevise → reviseInput → askClaude('rnd.revise', …)
      ▼
   yaml.nextRev(저장된 판 · 장부의 판 · 기준의 판 · 답의 판) → yaml.finalizeRevised(meta.rev rN · # [재생성 rN] · # 변경분: <summary>)
   yaml.diffYaml(기준, 고친 것) · yaml.previewApply(장부 사본에 넣어 보기 → 새로 남을 변경이력) ─ 반영 ─▶ rnd.intake(source 'revise', summary)

rnd.intake 를 지나면(어느 길이든 — rndpanel 의 끌어 놓기·붙여 넣기 포함) ─▶ index.js onIntake 훅 ─▶ store.put(과제, 차년도, 원문)  (chrome.storage.local['rndYamlText'])
과제를 지우면 ─▶ index.js onDelete 훅 ─▶ store.remove(과제)
```

## 파일

| 파일 | 하는 일 |
|---|---|
| `index.js` | 조립. `createRndGen({ rnd, $, escapeHtml, logEvent, flash, ai, today, now?, readAsset?, download?, storage?, engines? })` → `{ wire, panel, store, saved }`. `wire()` 가 카드를 그리고 rnd 의 `onIntake`(원문 저장)·`onDelete`(지우기) 훅을 단다. `pairResults(results, texts)` — 정렬된 intake 결과와 넣은 글을 이름으로 짝짓기 |
| `panel.js` · `panel.css` | 더하기 카드(`#rdgAdd` 안)와 YAML 고치기 몫(`#rdgRevise` 안 — 카드 틀은 바깥 `#rdChangeBox`). id 는 `rdg` 접두. 의존은 모두 주입(모든 차년도 zip 의 `../src/zip.js buildZip` 만 바로 import). 바쁠 때 host 에 `aria-busy` 와 지난 초, 늦게 온 답은 버림 |
| `source.js` | `LIMITS`(부분 하나의 크기)·`docKind`·`unsupportedDocNote`·`splitPages`·`splitChunks`·`pagesText`·`toDataUrl`·`dataUrlBytes`·`readDocument`(→ Material — `parts[]`)·`defaultEngines`(pdfText·pdfSlice·pdfCount·officeText). 2026-10-16 ~ 10-22 의 쪽 점수·고르기(`scorePages`·`pickPages`·`pickChunks`)는 2026-10-23 에 걷어 냈다 — 크기로 거르지 않는다 |
| `llm.js` | `SKILL_DOCS`·`INPUT_BUDGET`·`loadSkillDocs`·`resetSkillDocs`·`pageRanges`·`extractInput`·`reviseInput`·`askRndTask`(갈래 consumer)·`askExtract`·`askRevise` |
| `yaml.js` | `parseYaml`·`checkExtracted`·`finalizeExtracted`·`finalizeRevised`·`nextRev`·`stageCount`(모든 차년도의 차년도 수)·`summarizeSnapshot`·`diffYaml`·`diffLines`·`previewApply`·`bookToSnapshot`·`fileName` |
| `store.js` | `YAML_KEY`(`rndYamlText`)·`HISTORY_MAX`(5)·`normalizeYamlStore`·`createYamlStore({ storage, now })` → `load`·`get`·`history`·`put`·`remove`·`all` |
| `test/` | 아래 **검사** |

## 바깥과 닿는 곳

| 곳 | 무엇 |
|---|---|
| `sidepanel.html` | `<link rel="stylesheet" href="rndgen/panel.css">` · `#rdStatus` 줄 앞의 `<div id="rdgAdd" class="rdg hidden">` · 변경 및 이력 관리 카드(`#rdChangeBox` — `#rdBody` 안 진행 기록 아래) 머리 줄 뒤의 `<div id="rdgRevise" class="rdg hidden">` (+ 과제 없음 카드·스킬 칸의 문구) |
| `sidepanel.js` | `import { createRndGen } from './rndgen/index.js'` · `const rndgen = createRndGen({ rnd, $, escapeHtml, logEvent, flash, ai: () => ({ apiKey, cli }), today })` · `rnd.wire()` 뒤 `rndgen.wire()` |
| `rndpanel.js` | 손잡이 `current`·`view`·`onView`·`onAdd`·`setOverlay`·`addManually`·`intake`(결과를 돌려줌)·`onIntake`·`onDelete`·`pick`·`setAlias`·`download`·`readAsset`, `st.overlay`, 칩·머리의 폼/덮개 칠, 머리 줄의 차년도 아이콘·과제 더하기·빈 차년도 카드 단추 → onAdd(없으면 새 과제 폼 — 칩 줄의 ＋ 는 2026-10-19 에 없앰), 드롭 표시 거두기(잡는 단계) |
| `actions/spec/rnd/` | `_domain.yaml`(llm per-kind · consumer `rndgen/llm.js askRndTask`) · `extract.yaml`·`revise.yaml`(planned — 답 칸·규칙·uses) → `node tools/gen-actions.mjs` → `actions/spec.js` |
| `src/tasktune.js` · `src/ai.js` · `native/host.mjs` | 두 작업만 effort medium · max_tokens 32000 · 입력 15만 자 · CLI 10분 · API 스트리밍(SSE). 다른 작업은 바이트까지 그대로 |
| `doctext/browser.js` | 끝에 `pdfAllText`(모든 쪽 글자 층 — 기존 `pdfText` 는 6쪽) |
| `package.json` | `npm test` 에 `"rndgen/test/*.test.mjs"` |
| `README.md` · `rnd/README.md` · `docs/actions-design.md` §12 · `actions/CLAUDE.md` · `actions/README.md` | 쓰는 법·스킬과의 나눔·LLM 작업 목록 |
| `test/wiring.test.mjs` · `test/rndpanel.test.mjs` | R&D 리스너 목록의 `rdg…`·`rdYearEmpty` · 손잡이 회귀 |

## 한도

| 무엇 | 값 | 어디 |
|---|---|---|
| 문서 전체 | **한도 없음** — 쪽 수·글자·MB 로 거절하거나 잘라 내지 않는다(2026-10-23 사용자 지정 "사업계획서 첨부할때.. 크기 제한없이 분할해서 처리 하도록 해줘"). 문서 차례대로 부분으로 나눠 부분마다 한 번씩 차례로 묻고, 앞 부분까지 뽑은(고친) YAML 을 다음 부분에 이어 준다. 그 전(10-16 ~ 10-22)에는 원본 20MB 거절·스캔본 8MB·24쪽 9만 자 고르기였다 | `source.js readDocument` · `panel.js askOne`·`revise` |
| 부분 하나의 글자 | 8만 자(쪽·구역 경계에서 끊음) — 입력 글에서는 10만 자, 전체 15만 자 안(머리말·스킬 문서 약 3만 자·앞 부분까지의 YAML 이 함께 든다) | `LIMITS.partChars` · `llm.js INPUT_BUDGET` |
| 부분 하나에 붙이는 PDF | 100쪽(Claude API 가 문서 하나에 받는 쪽 수)·8MB — 넘으면 쪽을 반으로 갈라 다시(한 쪽이 혼자 넘으면 그 부분은 글자만). 글자 층 없는 스캔본도 같은 식으로 나눠 붙인다 | `LIMITS.partPages`·`attachBytesMax` |
| HWPX·DOCX·XLSX·PPTX 글자 | 한도 없이 읽고 3천 자 구역으로 나눠 부분에 담는다 | `LIMITS.chunkChars` |
| 고치기 | 기준 YAML 9만 자(넘으면 던짐) · 변경 글 2만 자 · 붙인 문서는 4만 자 부분으로 나눠 부분마다 한 번(문서 6개) | `INPUT_BUDGET` · `panel.js REVISE_PART_CHARS`·`MAX_CHANGE_FILES` |
| LLM | effort medium · max_tokens 32000 · 입력 15만 자 · CLI 10분 · API 스트리밍 | `src/tasktune.js` |
| 답의 YAML 칸 | 12만 자(관문 초안 모드는 넘는 글을 말없이 자른다) | `actions/spec/rnd/*.yaml` 의 `max` |
| 원문 저장 | 과제·차년도마다 지금 판 1 + 지난 판 5 | `store.js HISTORY_MAX` |

## 저장 키 `rndYamlText`

```js
// chrome.storage.local['rndYamlText']
{ v: 1, projects: { [projectId]: { [n]: { current: Entry, history: Entry[] /* 최신이 앞, 5개 */ } } } }
// Entry = { text, rev: 'r0'|'r2'|'', at: ISO, file: 'KR_….yaml'|'', source: 'file'|'paste'|'extract'|'revise', summary: '변경분 한 줄'|'' }
```

장부(`rndBook`)는 YAML 을 풀어 넣은 결과만 가지므로 YAML 고치기의 **기준 YAML** 을 여기 따로 둔다. 더 오래된 판이라 장부에 넣지 않은 것(`applied: false`)·이력 파일은 남기지 않는다.
같은 글이면 지난 판으로 밀지 않고 시각·출처만 고친다. `unlimitedStorage` 없이 `chrome.storage.local` 은 10MB — 과제 10 × 차년도 여럿 × 6판 × 30KB 면 가까워질 수 있다.

## LLM 작업

- `rnd.extract` — 답 `{ yaml(필수), alias, stage, warnings }`. 입력은 오늘 · 뽑을 차년도(고른 것 또는 "오늘이 든 차년도") · 장부 기준 오늘이 든 차년도 · 장부의 과제 · 원본 문서(몇째 부분인지 · 쪽 범위 · 무엇을 붙였나) →
  `[스킬 규칙 1 — extract_fields.yaml]` · `[스킬 규칙 2 — structured_output.md]` → (둘째 부분부터) `[앞 부분까지 뽑은 YAML]` → `[문서 글자]`(`— N쪽 —` 표시). 스킬 문서의 절차(폴더·스크립트·에이전트·이력 init·JSON 사본)는 무시하라고 적는다.
  부분이 여럿이면 패널(`askOne`)이 부분마다 차례로 묻고 앞 부분까지 뽑은 YAML 을 `ctx.prior` 로 준다 — 꼴이 아닌 부분의 답은 버리고 앞 것으로 이어 가며(경고), 마지막으로 꼴이었던 답이 뽑은 것이다. 길·비용은 합친다.
- `rnd.revise` — 답 `{ yaml(필수), summary(필수), changes[≤50]{path, before, after}, warnings }`. 입력은 오늘 · 과제·차년도·지금 판 · (붙인 문서가 부분이면) 몇째 부분인지 → `[기준 YAML]` → `[변경사항]` → `[붙인 문서 글자 — 이름 (k/N부분 · 쪽/구역)]`.
  붙인 문서의 부분마다 차례로 묻고(기준은 앞 부분까지 고친 YAML) summary(` · ` 로)·changes·warnings 를 모은다 — 판·머리 주석·차이·미리보기는 마지막 답으로 한 번.
- 울타리 `<<<`·`>>>` 안의 글에 든 `>>>` 는 `> > >` 로 바꾼다. 지시문(rules)과 답 칸은 `actions/spec/rnd/*.yaml` 이 정본이다(`node tools/gen-actions.mjs --prompt rnd.extract` 로 본다).

## 한계

- 옛 한글(`.hwp`)은 못 읽는다 — 한글에서 PDF 로 저장해 넣는다(`.hwpx` 는 된다).
- 글자 층 없는 스캔본은 Claude 가 그림으로 읽어 느리고 표의 값을 틀릴 수 있다. 커도 쪽을 나눠 부분마다 PDF 로 붙인다(2026-10-23) — 암호가 걸려 자르지 못하고 8MB 를 넘는 것, 쪽 수조차 모르는 깨진 것만 붙이지 못한다(글자 층이 있는 PDF 로 다시 저장).
- 부분이 여럿이면 부분 수만큼 Claude 를 부른다(부분마다 몇 분 — 300쪽 계획서는 4~9부분, 모든 차년도면 차년도마다 그만큼). 앞 부분까지의 YAML 을 이어 주니 뒤 부분이 앞 값을 지우지 않도록 명세의 규칙이 막지만,
  **실제 Claude 로 여러 부분을 끝까지 돌려 보지는 않았다**(2026-10-23 — 검사는 흉내). 처음 쓸 때 볼 것: 둘째 부분부터의 답이 앞 YAML 의 값을 그대로 두는가 · 부분 수와 걸린 시간.
- 장부로 지은 기준(저장된 원문이 없을 때)은 성과지표·외주용역 같은 장부에 없는 블록이 빠진다 — 원문 YAML 을 한 번 넣어 두면 정확하다.
- pdf.js 는 사이드 패널에서만 돈다(서비스 워커 불가). 이 폴더는 패널에서만 쓴다.
- 2026-10-16 에는 실물 사업계획서 다섯 개로 재료 고르기(1~2.5초, 작은 PDF 0.4~1.4MB, 글자 2.4~2.7만 자)만 재 보았고, **실제 Claude 로 뽑기·고치기를 끝까지 돌려 보지는 않았다**(검사는 모두 흉내).
  처음 쓸 때 볼 것: 뽑은 YAML 이 스킬로 만든 `KR_<과제>.yaml` 과 같은 꼴인가 · 비목 합 경고 · 로컬 CLI 길에서 15만 자 입력이 표준 입력으로 가는가(24,000자 넘는 프롬프트) · API 길의 스트리밍.

## 검사

```
node --test "rndgen/test/*.test.mjs"
```

| 파일 | 본다 |
|---|---|
| `source.test.mjs` | 갈래 가리기·hwp 안내, 쪽·구역 나누기(크기 제한 없이 이어진 묶음·빠짐없음), 가짜 엔진으로 pdf(글자 층 있음 — 한 부분·여러 부분·큰 작은 PDF 의 반 가르기·한 쪽이 넘침·자르기 실패 / 글자 층 없음 — 원본째·쪽 가르기·암호·쪽 수 모름)·office(한도 없음·부분)·text·yaml 거절, pdf-lib 로 지은 PDF 자르기·쪽 수, `pdfAllText` |
| `llm.test.mjs` | 입력 글 배치·자르기·울타리, 부분 문장과 `[앞 부분까지 뽑은 YAML]`·고치기의 부분 머리, 스킬 문서 외우기, `askRndTask` 의 던짐과 `ask` 끼우기 |
| `yaml.test.mjs` | 검사·마무리(머리 주석을 `headerOf` 가 되읽음)·다음 판·차년도 수(연차범위 목록·글 · 연차별기간 · 기간)·구조 차이(열쇠로 짝짓기)·미리 넣기(장부 원본 불변)·장부로 기준 짓기·파일 이름 |
| `store.test.mjs` | put·history 5개·같은 글·remove·normalize·쓰기 실패 되돌림(가짜 저장소) |
| `panel.test.mjs` | jsdom 의 host 둘 — 뽑기·넣기·다시 뽑기·모든 차년도(차례로 묻기·몇 번·그 차년도만 다시·한 번의 intake·고친 칸·zip·과제가 다른 차년도·닫으면 멈춤)·없는 차년도만(있는 차년도는 건너뜀 줄·대상 없으면 재료 글의 과제번호로 짚기·연구기간 밖을 물어 연차범위까지·문서 범위 밖 답은 버림)·고른 차년도들(숫자 둘 이상 — 그것만 차례로·연차범위를 안 봄·zip 이름 `_3-4차년도`·한 번의 intake)·차년도 단추 줄(숫자는 여러 개 켜고 끄기·자동/모두/없는 것만은 하나·점선·머리 줄 아이콘이면 없는 첫 차년도·바쁠 때 잠김)·과제 배지(대상 바꾸기 — 단추 줄·별칭 따라감·재료와 미리보기는 둠·과제 없으면 숨김·열 개면 새 과제 잠김)·직접 적기·닫기·재료가 비면 묻지 않음·고치기·반영·로그·aria-busy·늦은 답 버림·글은 textContent 로만 |
| `index.test.mjs` | import·만들기·wire 가 chrome·fetch 를 만지지 않음(손잡이에 새 키가 없어도), onIntake 로 원문 저장(짝짓기·오래된 판 빼기·지난 판), onDelete, 저장 실패 로그, 저장 뒤 기준 줄 |

API 길의 스트리밍은 `test/llm.test.mjs`(덩어리 경계·CRLF·refusal·max_tokens·error 사건·끊긴 연결, 다른 작업은 본문에 `stream` 없음), 한도는 `test/host.test.mjs`,
rndpanel 의 손잡이는 `test/rndpanel.test.mjs`, 배선은 `test/wiring.test.mjs` 가 본다.
