# actions/ — 행위 명세와 디스패처 (Claude 가 지킬 규칙)

이 폴더는 **UI 클릭과 LLM 요청을 같은 구조(기록)로 바꾼 뒤 실행기를 부르는 층**이다(2026-10-16 사용자 지정: "LLM 하고 사람이 클릭을 하면 이게 구조화 된 다음에 러너/실행기를 호출하는 구조로 모두 바꾸고 싶어 … 중간에 yaml 구조파일을 놓고 … 사전설정에 대한 정보도 들어가야 되고, 공문 종류·근태 종류에 따라 각각 yaml 이 존재해야지"). 무엇을 하는지·흐름·YAML 쓰는 법은 [README.md](README.md), 설계 배경은 `docs/actions-design.md`.

## 정본과 생성물

- **`spec/<갈래>/<종류>.yaml` 이 정본**이다 — 행위 하나에 파일 하나, 칸마다 `read`(LLM 에게 가는 인라인 프롬프트)와 `preset`(사전설정). `spec/<갈래>/_domain.yaml` 은 갈래 공통(LLM 작업 모드·공통 규칙·공통 사전설정).
- `spec.js` 는 **생성물**이다 — 고치지 않는다. YAML 을 고친 뒤 `node tools/gen-actions.mjs`(`npm run gen` 에도 든다). 어긋나면 `actions/test/spec.test.mjs` 가 빨갛다.
- 패널의 **설정 → 일반 → 행위 명세**가 `spec/` 의 YAML 원본을 갈래 → 종류로 보여 준다(읽기만 — `src/specview.js`, 목록은 `ACTIONS` 에서). 갈래 폴더를 새로 만들면 `src/specview.js` 의 `DOMAIN_ORDER` 에 자리를 준다(없으면 맨 끝).
- LLM 작업(`attend`·`search.room`·`search.car`)은 여기서 만들어 `src/input.js` 의 `TASKS` 에 합쳐진다. 공문의 작업(`gongmun.<갈래>`·`gongmunReason.<갈래>`)은 레시피(`recipes/gongmun` → `src/gmrecipe.js`)의 것을 **가리키기만** 한다 — 공문 초안 칸은 YAML 에 다시 적지 않고 `draft: { from: recipe }` 로 펼친다. `recipes/gongmun` 은 여기서 고치지 않는다.
- 공문 종류 파일의 공통 칸(form·title·body·rank·lead·refs·setting·attach)은 `spec/gongmun/_domain.yaml` 의 `fields` 에만 적고 종류 파일은 `칸: { from: domain }` 으로 가져온다(2026-10-17) — 종류 파일에 같은 글을 다시 적지 않는다. 종류만 다른 칸(외부활동의 `form`·`body`)만 통째로 적는다.
- `recipe` 모드의 `kinds` 가운데 레시피의 목적인 것은 레시피의 목적 차례(`RECIPE.order`)와 같아야 한다 — 레시피에 목적을 더했으면 종류 YAML 도 더한다(차례는 `recipes/gongmun/README.md`). 목적이 아닌 종류(선행 품의 읽기 `prior` — 조회, 2026-10-17)는 그 뒤에 두고 `llm: false` 다(레시피가 작업을 만들지 않는다). 공문의 `form` 은 닫힌 enum 이 아니다(양식 ID 직접 적기 — 꼴·`only` 는 어댑터가 본다).
- 새 실행기 이름은 `tools/gen-actions.mjs` 의 `RUNNERS` 와 `docs/actions-design.md` §6.6 에 같이 적는다 — YAML 이 없는 실행기를 가리키면 생성기가 막는다(2026-10-17 `gongmun.prior` 가 그렇게 들어갔다).
- R&D 의 LLM 작업 `rnd.extract`(사업계획서 → 그 차년도 스냅샷 YAML)·`rnd.revise`(변경 글 → 고친 YAML)도 여기서 만들어 `TASKS` 에 합쳐진다(per-kind, status planned — 2026-10-16). 디스패처 전이라 패널 `rndgen/` 이 `rndgen/llm.js askRndTask` 로 askClaude 를 바로 부른다. 두 작업의 한도(effort·max_tokens·입력 길이·시간·API 스트리밍)는 `src/tasktune.js` 에 있고 다른 작업은 그대로다.

## 경계

- `gate.js`·`preset.js`·`record.js`·`dispatch.js` 는 **순수**하다 — chrome·DOM·fetch·시계를 import 때도 호출 때도 직접 만지지 않는다(시각·저장소·레시피는 인자). `test/wiring.test.mjs` 가 jsdom 에서 `sidepanel.js` 를 통째로 import 하므로 import 만으로는 아무 일도 일어나면 안 된다.
- `src/input.js` 는 `actions/spec.js`(순수 데이터)만 import 한다. `native/host.mjs`(로컬 Claude 다리)가 `src/input.js` 를 import 하므로 그 길에 실행 코드가 섞이면 안 된다.
- `runners/<갈래>.js` 는 기존 실행기(`src/runners.js`·`src/attend.js`+`src/hr.js`·`src/trip.js`·`src/gongmun.js`+`src/gmwrite.js` …)를 **기록 → 인자**로 바꿔 부르는 어댑터일 뿐이다. 사이트 특유의 순서(HR 입력 차례·ViewState 다시 읽기·차량 취소 손잡이 다시 찾기·수정의 되돌리기 판단·정산의 덮어쓰기 규칙·공문의 단계)는 기존 코드에 둔다 — 여기로 옮기지 않는다.
- 디스패처는 **재시도·되돌리기·뒤따르는 행위(then)의 자동 실행을 하지 않는다.** 한 번의 `run` 은 실행기 한 번이다. `confirm: true` 인 행위는 사람이 누른 핸들러 안에서 `confirmed: record.hash` 를 넣어야만 돈다 — LLM 의 답에서 `confirmed` 를 받지 않는다.
- 기록(record)에는 **바이트·세션·ViewState·삭제 손잡이·DOM** 을 넣지 않는다. 파일은 이름·형식만(바이트는 `run` 의 ctx), 사이트에서 읽은 산 손잡이는 ctx.
- 패널이 디스패처를 하나 만들어(`sidepanel.js`) 근태·공문 패널에 넘긴다. 서비스 워커·콘텐츠 스크립트는 1단계에서 이 폴더를 읽지 않는다(`manifest.json` 의 web_accessible_resources 는 `src/*.js` 뿐).
- `mailtrack/`·`rerp/` 는 손대지 않는다 — 그쪽은 2단계에 주입으로 잇는다.

## 고친 뒤

```
node tools/gen-actions.mjs            # YAML 을 고쳤으면
node --check <고친 파일>
node --test "actions/test/*.test.mjs"
node test/input.test.mjs test/llm.test.mjs
node test/wiring.test.mjs             # 패널 배선(sidepanel.js 를 통째로 import)
npm test                              # 전부
```

다른 세션이 같은 작업 트리를 고치고 있을 수 있다 — `test/` 쪽 빨간 것이 이 폴더 탓인지 먼저 가린다. 커밋은 사용자가 시킬 때만.
