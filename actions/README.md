# actions/ — 행위 명세와 디스패처

사람이 패널에서 누르든 LLM 이 말을 읽어 채우든, **먼저 같은 구조(기록)가 되고, 그 다음에 실행기가 돈다.** 그 구조를 정하는 것이 이 폴더의 YAML 이고, 구조를 검사해 실행기까지 데려가는 것이 디스패처다(2026-10-16 사용자 지정: "LLM 하고 사람이 클릭을 하면 이게 구조화 된 다음에 러너/실행기를 호출하는 구조로 모두 바꾸고 싶어 … 중간에 yaml 구조파일을 놓고 LLM 으로 read 할 수 있는 인라인 프롬프트를 넣던가 … 사전설정에 대한 정보도 들어가야 되고, 공문 종류·근태 종류에 따라 각각 yaml 이 존재해야지"). 설계 배경과 검토(Codex 와 두 번 교차 검토)는 `docs/actions-design.md`, 이 폴더를 고칠 때의 규칙은 [CLAUDE.md](CLAUDE.md).

```
사람(UI 클릭)  ── 패널이 칸 값을 모음 ──┐
                                        ├─ 기록(record: action + preset + input) ─ 관문(검증·정규화) ─ 디스패처(확인·활동 로그) ─ 실행기(기존 코드)
LLM(말·문서)   ── 명세에서 만든 작업 ───┘
```

## 무엇이 어디에

| 파일 | 역할 |
|---|---|
| `spec/<갈래>/<종류>.yaml` | **정본.** 행위 하나에 파일 하나 — 근태 6종(`attend/trip.yaml` …)·공문 5종(`gongmun/purchase.yaml` … — 구매의뢰 `order.yaml` 은 2026-10-17)과 선행 품의 읽기(`gongmun/prior.yaml` — 공문 이력 카드의 `구매의뢰`, 조회라 confirm 없음, 같은 날 "이것도 명세서를 만든 다음에 러너로")·회의실·차량·여비계산서·(2단계) R&D·메일·홈·회람. 칸마다 `read`(LLM 에게 가는 인라인 프롬프트)와 `preset`(사전설정) |
| `spec/<갈래>/_domain.yaml` | 갈래 공통 — LLM 작업을 어떻게 만드는지(`llm.mode`), 공통 규칙·공통 사전설정(종류 preset 앞에 저절로 합쳐진다), **공통 칸 `fields`**(종류 파일이 `칸: { from: domain }` 으로 같은 자리에 가져온다 — 공문의 form·title·body·rank·lead·refs·setting·attach, 2026-10-17), 종류 차례(`recipe` 모드에서는 레시피의 목적 차례와 같아야 한다) |
| `spec.js` | **생성물** — `node tools/gen-actions.mjs`(`npm run gen` 에도 든다). 행위(`ACTIONS.actions`)·갈래·LLM 작업(`ACTIONS.tasks` — `src/input.js` 의 `TASKS` 에 합쳐진다) |
| `gate.js` | 관문 — 기록을 명세로 검증·정규화. **초안 모드**(LLM 조각 — 틀린 칸은 비우고 알림)와 **실행 모드**(사람이 보낸 기록 — 잃는 보정이 생기면 막는다) |
| `preset.js` | 사전설정 채우기 — `from: today · me · storage:<키>[.경로] · recipe:<레지스트리>.<경로> · ctx:<이름>` 또는 `value:` |
| `record.js` | 기록 짓기·지문(hash)·로그용으로 자르기(바이트 없음)·YAML 글·한 줄 요약(`summary` 틀) |
| `dispatch.js` | 디스패처 — 실행기 등록(`register`), 기록 짓기(`build`), 실행(`run`: 실행 모드 재검사 → 지문 → 사람 확인 → 실행기 → 활동 로그 한 줄) |
| `runners/<갈래>.js` | 실행기 어댑터 — 기록을 기존 함수(`src/runners.js`·`src/attend.js`+`src/hr.js`·`src/trip.js`·`src/gongmun.js`+`src/gmwrite.js` …)의 인자로 바꿔 부른다. 사이트 특유의 순서·되돌리기 판단은 그 함수들에 그대로 있다 |
| `test/*.test.mjs` | `node --test "actions/test/*.test.mjs"` — 생성물 일치·명세 검사·관문·사전설정·기록·디스패처·어댑터(가짜 실행기) |
| `tools/gen-actions.mjs` | 생성기. `--check`(어긋났는지만) · `--prompt <작업>`(LLM 지시문 전문 — `attend`·`search.room`·`search.car`) · `--show <행위>`(합쳐진 명세) · `--example <행위>`(보기 기록을 YAML 글로) |

## 기록(record)은 이렇게 생겼다

```yaml
v: 1
action: attend.trip          # <갈래>.<종류> — spec/attend/trip.yaml
at: 1760600000000            # 지은 때
by: ui                       # ui | llm | auto
via: null                    # by 가 llm 일 때 cli | api | local
preset:                      # 사전설정 — 저장소·레시피·화면에서 실행 전에 채운 것
  today: '2026-10-16'
  me: 김기현
  hrMe: { emplNo: '…', name: 김기현 }
  workplace: 부산
input:                       # 사람(UI) 또는 LLM 이 정한 칸
  op: request                # 임시저장(save)·결재요청(request)
  dateFrom: '2026-10-20'
  start: '07:00'
  dateTo: '2026-10-21'
  end: '20:00'
  days: 2
  place: 대전
  venue: 한국기계연구원
  purpose: 착수회의 참석
  settle: true
hash: 1a2b3c4d               # action + preset + input 의 지문 — 사람 확인(confirm)은 이 지문에 묶인다
```

- 기록에는 **바이트·세션·사이트 손잡이·DOM** 이 없다. 파일은 이름·형식만(`{ name, type }`), 바이트는 `run` 의 `ctx.files` 로 간다. 사이트에서 읽은 산 손잡이(취소할 줄·여비계산서 줄)도 `ctx` 다.
- 활동 로그(패널 설정 → 활동 로그)에는 run 마다 한 줄 — 문구(`summary` 틀이나 패널이 준 글) · `data.record`(자른 기록) · `data.result`(스칼라만).
- `node tools/gen-actions.mjs --example gongmun.purchase` 처럼 보기 기록을 YAML 로 찍어 볼 수 있다.

## 명세 YAML 쓰는 법

종류 파일(`spec/attend/trip.yaml`)의 뼈대 — 전체 꼴과 속성은 `docs/actions-design.md` §3·§14:

```yaml
id: attend.trip
title: 출장 신청
confirm: true                  # 사람이 눌러야 돈다(조회·초안 얹기만 false)
effect: write                  # none | draft | write
summary: '출장 {dateFrom}~{dateTo} {place} · {purpose}'
preset:
  hrMe:      { from: ctx:hrMe, type: object, required: true, desc: HR 의 나(사번·이름) }
  workplace: { from: storage:attendWorkplace, desc: 근무지 }
fields:
  dateFrom: { type: date, required: true, label: 출발일, desc: 출발일, default: 오늘,
              read: '출발일(YYYY-MM-DD). "내일"·"다음 주 수요일" 은 오늘을 기준으로 실제 날짜로', example: 2026-10-20 }
  settle:   { type: boolean, label: 여비계산서 사전정산, desc: 결재요청 뒤 여비계산서를 만든다, llm: false,
              read: 사용자가 여비계산서·사전정산을 말했을 때만 true }
rules: [ … ]                   # 이 종류만의 LLM 규칙
runner: attend.apply           # runners/attend.js 가 이 이름으로 등록한다 — LLM 은 이름을 못 정한다
uses: [{ module: src/attend.js, export: buildJob }, { module: src/hr.js, export: hrRunJob }]
then: [{ action: trip.create, when: settle }]   # 뒤따르는 행위(패널이 차례로 부른다 — 자동으로 잇지 않는다)
```

- **모든 칸에 `read` 가 있다.** 지금 LLM 이 채우지 않는 칸(`llm: false` — 첨부·체크박스·교통편 …)도 read 를 둔다 — 나중에 LLM 을 넣을 때 그대로 쓴다.
- `preset` 은 그때그때 적지 않는 값 — 내 이름·오늘·근무지·공문 설정(부서·부서장·소장·본부장·문서번호 부서)·고른 과제·HR 의 나. 실행 전에 채워 기록에 같이 담긴다. 폼의 기본값(출장 07:00~20:00 같은 것)은 preset 이 아니라 칸의 `default` 다.
- LLM 작업은 갈래의 `llm.mode` 로 만든다 — `merged`(근태: LLM 이 종류를 고른다 — 종류별 칸을 합쳐 작업 `attend` 하나), `per-kind`(회의실·차량 조회: `search.room`·`search.car`), `recipe`(공문: 작업은 레시피 `recipes/gongmun` 의 `gongmun.<갈래>`·`gongmunReason.<갈래>` 를 가리킨다 — 공문 초안 칸은 YAML 에 다시 적지 않고 `draft: { from: recipe }` 로 펼친다), `none`.
- **갈래 공통 칸** — 여러 종류가 같은 글로 적는 칸은 `_domain.yaml` 의 `fields` 에 한 번 적고 종류 파일에서 `칸: { from: domain }` 으로 가져온다(차례는 종류 파일의 자리, 다르게 쓰려면 칸을 통째로 적는다 — 외부활동의 `form`·`body`). 공통 preset 과 달리 저절로 합쳐지지 않는다(종류마다 있고 없는 칸이 달라서).
- `recipe` 모드의 갈래(공문)는 `kinds` 가 레시피의 목적 차례(`RECIPE.order`)와 같아야 하고 종류의 `llm.tasks` 는 그 종류의 작업(`.<종류>` 로 끝남)이어야 한다 — 생성기가 막는다. 공문 종류·양식을 더하는 차례는 [`recipes/gongmun/README.md`](../recipes/gongmun/README.md).
- per-kind 의 또 한 보기는 R&D 다 — `rnd.extract`(사업계획서 → 그 차년도 KR 스냅샷 YAML)·`rnd.revise`(아무 꼴의 변경 글 → 고친 YAML). 갈래의 consumer 는 `rndgen/llm.js askRndTask` 하나이고, 디스패처 전이라 패널 `rndgen/` 이 askClaude 를 바로 부른다(2026-10-16 — 자세히 `rndgen/README.md`).
- `references/input.yaml` 에는 **읽기 작업**(출장 증빙 `receipt`·실패 원인 `diagnose`)만 남는다. 조회 조건(`parse`)·근태 조각(`attend`)은 이 폴더가 만든다.
- 고친 뒤: `node tools/gen-actions.mjs` → `node --test "actions/test/*.test.mjs"` → `npm test`. 틀린 명세는 생성기가 무엇이 틀렸는지만 말하고 끝낸다(없는 칸을 summary 가 가리킴·모르는 형·read 없음·없는 실행기·uses 의 없는 export …).

## 패널에서 쓰는 법

```js
import { createDispatcher } from './actions/dispatch.js';
import { registerBooking } from './actions/runners/booking.js';
import { resolvePreset } from './actions/preset.js';

const actions = createDispatcher({ log: (e) => logEvent(e.kind, e.ok, e.text, e.data) });
registerBooking(actions);

// 사람이 눌렀을 때 — 기록을 짓고(관문), 누른 자리에서 확인(hash)을 넣어 돌린다
const preset = await resolvePreset(actions.entry('room.reserve').preset, { storage: (k) => chrome.storage.local.get(k), me, today });
const { record } = actions.build('room.reserve', { input, preset });          // 틀리면 ActionError(problems)
const result = await actions.run(record, { day, confirmed: record.hash, text: what });

// LLM 이 채운 조회 조건 — 초안 모드로 짓고(틀린 칸은 비움), 조회는 confirm 이 없어 바로 돈다
const { record: q } = actions.build('room.search', { input: filter, preset, by: 'llm', via, mode: 'draft' });
const found = await actions.run(q, { onProgress, loadDay });
```

- `run` 은 실행 직전에 기록을 **실행 모드로 다시 검사하고 지문을 다시 센다** — 지은 뒤 고친 기록, 손으로 만든 객체, 필수가 빈 초안은 여기서 막힌다. `confirm: true` 인 행위는 `ctx.confirmed === record.hash` 여야 한다(LLM 의 답에서 받지 않는다).
- `ctx.outcome(result)` 를 주면 실행기가 돌아온 뒤 로그 전에 기다린다 — 패널이 목록을 다시 읽어 최종 성패와 문구를 정하는 근태 결재요청이 이것을 쓴다. 실행기가 던진 run 은 `ctx.text` 로 ✕ 줄을 남기고 까닭은 `data.result.error` 에 둔다(패널의 로그 래퍼가 "— 까닭" 을 잇는다).
- 디스패처는 재시도·되돌리기·`then` 자동 실행을 하지 않는다. 한 번의 `run` 은 실행기 한 번이다. 사후정산(`trip.after`)처럼 "물어볼 것이 남아 올리지 않음"·"같은 줄이 있어 올리지 않음" 으로 끝나는 run 도 한 줄로 남는다.
- 산 손잡이는 ctx 로 간다 — 취소할 줄(`record`), 수정의 원래 건(`target`) 또는 취소 전에 원래 날을 다시 읽어 손잡이를 찾는 `live(day)`, 여비계산서 줄(`row`), 목록 줄(`item`), 파일 바이트(`files`). 어댑터는 그것이 기록의 식별자(seq·docNo·이름)와 같은지 보고 다르면 ActionError 다.
- 실행 모드는 엄격하다 — 내 이름이나 공문 설정이 비었거나 제목이 한도를 넘으면 `build` 가 막고 상태줄에 까닭이 적힌다(전처럼 조용히 자르거나 빈 채로 보내지 않는다).
  막은 까닭은 글(`problems`)과 함께 구조(`ActionError.missing` — `[{ where: 'input' | 'preset', key, why }]`)로도 오고, 패널은 그것으로 **빈 곳으로 가는 단추**(`src/jump.js` — "내 이름 채우기 →"·"공문 설정 채우기 →"·폼의 칸)를
  상태줄 끝에 세운다(2026-10-16 사용자 지정). 누르면 설정 → 일반의 내 이름 칸, 공문 설정 칸, 폼의 그 칸으로 옮겨 초점을 두고 윤곽선을 잠깐 켠다. 어디로 갈지 패널이 모르는 칸은 단추가 서지 않는다.

## 바깥과 닿는 곳

| 어디 | 무엇 |
|---|---|
| `src/input.js` | `TASKS` 에 `ACTIONS.tasks` 를 합친다(`import { ACTIONS } from '../actions/spec.js'` — 순수 데이터). `structureOf`·`schemaOf`·실행 모드·`when`·새 형(`tags`·`file`·`object`) 은 관문이 쓴다 |
| `src/llm.js` | `fillAction(id, text, ctx, opts)` — 행위의 작업(`entry.task`)으로 말을 읽어 초안 조각을 돌려준다. `parseSmart` 는 `search.<kind>`, `fillAttendSmart` 는 `attend` |
| `sidepanel.js` | 디스패처를 하나 만들어 근태·공문 패널에 넘긴다. 회의실·차량의 예약·취소·수정·말로 찾기가 지난다 |
| `attendpanel.js` · `sendbox.js` · `lodgebox.js` | 근태 신청·상신·회수·삭제·취소신청, 여비계산서(사전정산 작성·고치기·확정, 사후정산 올리기·확정·지우기), 여비증빙 송부, 사후정산 숙박 줄의 `상한`·`비고에 저장`·지우기(`trip.lodge` — 기록은 attendpanel 의 buildRecord·runRecord 로, 화면의 그 줄·적어 둔 실제 금액·상한액은 ctx) |
| `gongmunpanel.js` | 공문 작성(`gongmun.<갈래>`) |
| `tools/refdata.mjs` · `package.json` | `gen`/`check` 에 생성기, `npm test` 에 `actions/test` |
| `native/host.mjs` | 손대지 않는다 — `src/input.js` 의 `TASKS` 에서 작업을 만들므로 저절로 따라온다 |

## 아직 안 옮긴 것(2단계 — `status: planned`)

R&D 탭(과제·YAML 넣기·rERP·원노트·연구내용 공유·스킬 zip), 메일 탭(등록·갱신·지우기·병합·설정), 홈 카드(증빙 받기·사후정산 올리기)·사후정산 입력 화면의 증빙 읽기, DOC-Cruiser 회람, 기념일 지원 화면 채우기. 명세 파일은 있고(`spec/rnd` …) 실행기 등록과 배선이 없다 — `dispatch.run` 은 planned 를 돌리지 않는다. 같은 입력으로 계획을 다시 짓는 재현용 원장, LLM 이 허용 행위 가운데 고르는 통합 명령창도 2단계다.
2026-10-16 사용자 지정 범위는 근태·공문·회의실·차량이다 — 숙박 줄 고치기(`trip.lodge`)는 그날 live 로 옮겼고, R&D·기념일 지원은 이번에 옮기지 않는다. 공문 설정 채우기(`gongmun.setup`)는 걷어냈다(그 채팅 칸은 2026-10-09 에 뺐다 — 공문 설정은 공문 5종의 `preset.setup` 이다).
