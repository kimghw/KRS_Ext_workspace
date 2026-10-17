# rndgen/ — R&D 탭의 과제 더하기·변경 및 이력 관리의 YAML 고치기 (Claude 가 지킬 규칙)

이 폴더는 **R&D 탭(rndpanel.js)과 떨어뜨려 둔 것**이다 — ＋(과제 더하기)로 YAML 을 넣거나 사업계획서에서 그 차년도 KR 스냅샷 YAML 을 뽑고, 아무 꼴의 변경 글로 그 YAML 을 고친다
(2026-10-16 사용자 지정: "sscb 버튼 누르면 그리 안감, + 누르면 Yaml 파일을 넣던지 아니면 사업계획서를 넣으면 과제의 YAML을 추출하도록 해줘. 그 스킬은 '차년도 YAML 뽑는 스킬' 거기 있지.
그리고 변경사항의 내용을 임의 형식으로 제공 하면 yaml 로 수정해서 업데이트 하도록 해줘."). 무엇을 하는지·흐름·한도·한계는 [README.md](README.md).

## 경계

- **바깥에서 import 하는 것**: `../src/rnd.js`·`../src/rndyaml.js`(순수 — 장부 셈과 YAML 넣기의 정본, 여기서 고치지 않는다), `../src/llm.js`(`askClaude` — `llm.js` 만),
  `../src/tasktune.js`(`llm.js` 만), `../src/officetext.js`(`source.js` 만), `../src/zip.js`(`panel.js` 만 — 모든 차년도의 zip 저장, 순수), 쓸 때 `import()` 하는 `../doctext/browser.js`·`../vendor/pdf-lib.esm.min.js`(`source.js`)·`../vendor/yaml/index.js`(`yaml.js`).
  `rerp/*`·`mailtrack/*`·`sidepanel.js`·`rndpanel.js` 는 import 하지 않는다 — rndpanel 과는 **손잡이(rnd)** 로만 닿는다.
- sidepanel.js 는 `rndgen/index.js` 의 `createRndGen` 하나만 import 한다. 무엇을 꽂을지(source·llm·yaml·store)는 `index.js` 에서만 정한다. `panel.js` 는 그것들을 import 하지 않고 주입받는다.
- **패널과 닿는 곳은 README 의 "바깥과 닿는 곳" 표의 줄뿐이다**(sidepanel.html 세 곳·sidepanel.js 세 곳·rndpanel.js 의 손잡이·package.json 의 test·src/ai.js·src/tasktune.js·native/host.mjs·
  actions/spec/rnd 두 파일·README 들·test/wiring.test.mjs·test/rndpanel.test.mjs). 이 폴더 밖을 고쳐야 한다면 먼저 그것이 정말 필요한지 보고, 고쳤으면 그 표를 갱신한다.
  모양은 `panel.css`(`.rnd .rdg…` 만) — `sidepanel.css` 는 고치지 않는다.
- LLM 작업(지시문·답 칸)의 정본은 `actions/spec/rnd/extract.yaml`·`revise.yaml` 이다 — 칸·규칙을 바꾸면 YAML 을 고치고 `node tools/gen-actions.mjs`. 여기서 지시문을 짓지 않는다.
  여기서 짓는 것은 **입력 글**(머리말·스킬 문서 두 벌·재료 글 — `llm.js`)뿐이다. 스킬 문서는 `rnd/skills/rnd-kr-extract/references/` 의 것을 그대로 읽는다(고치지 않는다).
- **판(rev)·`meta.차년도`·`meta.source`·파일 머리 주석은 LLM 이 아니라 `yaml.js` 가 적는다.** 머리 주석은 `src/rndyaml.js headerOf` 가 `tag`·`changed` 로 되읽는 꼴이어야 한다(변경분이 장부의 변경이력 사유가 된다).

## import 안전

- `test/wiring.test.mjs` 가 jsdom 에서 `sidepanel.js` 를 통째로 import 한다. 그래서 이 폴더의 어느 파일도 **import·생성·`wire()` 시점에** chrome·fetch 를 건드리지 않는다 —
  저장소는 처음 읽을 때(`store.load`), LLM 은 사람이 누를 때(`askClaude`), 엔진(pdf.js·pdf-lib·officetext·yaml)은 처음 쓸 때 `import()`.
- rnd 손잡이에 키가 없어도 깨지지 않는다(`rnd.onView?.()`·`typeof rnd.onIntake === 'function'`). `rndgen/test/index.test.mjs` 의 첫 검사가 이것을 지킨다.
- pdf.js 는 사이드 패널(확장 페이지)에서만 돈다 — 서비스 워커에서는 Worker 가 없어 돌지 않는다. 이 폴더는 패널에서만 쓴다.

## 단위의 경계

- `source.js`·`yaml.js`·`llm.js`(askRndTask 를 빼고) 는 **순수**하다 — 엔진·저장소·askClaude 는 주입. `store.js` 는 저장소를 주입받는다(기본은 처음 쓸 때 본 `chrome.storage.local`).
- **원문 저장(`rndYamlText`)은 `index.js` 의 onIntake 훅 한 곳에서만** 한다. 끌어 놓기·붙여 넣기(rndpanel 의 YAML 넣기 칸)·뽑기·고치기가 모두 `rnd.intake` 를 지나기 때문이다.
  `panel.js` 는 `store.get` 만 읽는다. 장부에 넣는 규칙은 `src/rndyaml.js applyYaml` 이 정본이다 — 여기서 장부를 직접 고치지 않고 `rnd.intake`·`rnd.setAlias`·`rnd.pick` 을 부른다.
- 활동 로그 kind 는 `rnd` — 한 일마다 한 줄(뽑음·고침·실패). 넣기·반영은 `rnd.intake` 가 남기므로 따로 남기지 않는다.
- 사람이 적은 글·파일 이름·LLM 답은 화면에 **textContent 로만** 넣는다. 단추는 접힌 칸(`<details>`) 뒤에 두지 않는다 — 접는 것은 YAML 원문 칸뿐이다(2026-10-15 사용자: 접힌 칸은 "기능이 없다" 로 읽힌다).
- 검사 자료는 **지어낸 값**만(과제명·과제번호·사람 이름 모두 가짜 — `rndgen/test/fixtures/`, `test/fixtures/rnd/`). 실물 사업계획서(`E:\dev\RND\…`)는 검사에서 읽지 않는다.

## 고친 뒤

```
node --check <고친 파일>
node tools/gen-actions.mjs --check     # actions/spec/rnd 를 고쳤으면 먼저 node tools/gen-actions.mjs
node --test "rndgen/test/*.test.mjs"
node test/llm.test.mjs                 # src/ai.js·src/tasktune.js 를 고쳤으면(다른 작업의 본문은 바이트까지 그대로여야 한다)
node test/host.test.mjs                # native/host.mjs 를 고쳤으면
node test/rndpanel.test.mjs            # rndpanel.js 의 손잡이를 고쳤으면
node test/wiring.test.mjs              # 패널 배선(sidepanel.js 를 통째로 import)
npm test                               # 전부
```

다른 세션이 같은 작업 트리를 고치고 있을 수 있다 — `test/` 쪽 빨간 것이 이 폴더 탓인지 먼저 가린다. 커밋은 사용자가 시킬 때만.
