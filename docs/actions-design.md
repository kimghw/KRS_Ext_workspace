# 행위 명세(actions/) — UI 클릭과 LLM 요청을 **같은 구조**로 바꾼 뒤 실행기를 부르는 층

작성 2026-10-16 · 상태 **설계 계약 → 같은 날 1단계 구현(아래 구현 메모)** · 저장소 `E:\dev\kr_ext_workspace`(브랜치 main, HEAD abe6384 위에 작업)
검토: Codex(gpt, read-only)와 Fable 이 현재 구조를 따로 보고 합친 것(1차), 쓴 계약을 Codex 가 다시 본 것(2차 — §14). 받아들인 것은 §10·§11·§14 에 표시.

> **2026-10-16 구현 메모** — 이 계약대로 두 물결의 에이전트(1차: 명세·생성기 / 출장·공문·2단계 stub 명세 / 코어, 2차: LLM 어댑터 / 회의실·차량 / 근태·출장·송부 / 공문 배선)가 만들고 통합자가 합쳤다.
> 결과는 `actions/`(쓰는 법 `actions/README.md`, 규칙 `actions/CLAUDE.md`). `npm test` 는 기준선과 같다(104 pass, 빨간 셋은 이 일과 무관한 rerp-origin·riskyear·sendcard). 실제 확장(CDP)에서 말로 찾기 한 번이
> 로컬 CLI 로 돌아 활동 로그에 `room.search` 기록(by llm · via cli · hash · preset · 바이트 없음)을 남기는 것까지 확인했다.
> 계약과 달라진 것(구현이 정본이다 — 코드와 `actions/spec.js` 를 보라):
> - 행위 entry 에 `task`·`drops`·`ignore`·`hint` 가 더 있고, 칸 속성에 `default`(폼 기본값 — preset 이 아니다)·`drop`·`omit`·`when` 이 있다. 생성 작업의 칸은 `read` 가 desc 가 되고 `label` 이 같이 나간다(초안 알림의 칸 이름).
> - per-kind 작업 이름은 종류 파일이 적는다(`llm: { task: search.room }`). 차량 조회의 minSeats·region 은 `drop` — 기록 칸에서는 빠지고 작업에는 `variants.car.clear` 로 남아 "뺐습니다" 알림이 산다.
> - trip.* 는 preset `tripMe`(ctx — 여비계산서 목록이 아는 내 이름)·`hrMe`(ctx, create 에 required)를 쓰고, `trip.after` 는 사용자가 정한 것(lodge 결정·exclude·picks·always·preconfirm·**keepTrans**)을 기록에 담아 어댑터가 afterPlan 으로 다시 짓는다. 물음(ask)·같은 줄(same)로 안 올린 것도 run 한 줄로 남는다.
> - booking.modify 의 ctx 에 `live(day)`(취소 전에 원래 날을 다시 읽어 손잡이를 찾는 콜백)가 있고, `blocked` 는 새 차량(next)에만 붙는다(되살리기까지 막히던 잠재 버그 교정).
> - 공문 패널은 저장소를 읽은 뒤 `gongmunPreset` 을 화면의 공문 설정(400ms 미뤄 저장되는 값)으로 덮는다. 실행 모드가 엄격해 내 이름·공문 설정이 없거나 제목이 99자를 넘으면 쓰지 않고 상태줄에 까닭을 적는다(전에는 조용히 자르거나 빈 채로 썼다).
> - 근태 결재요청의 성패는 `ctx.outcome` 안에서 목록을 다시 읽어 정한다. 실패 run 의 줄 글은 `ctx.text` 에 "— 까닭" 을 잇는다(패널의 로그 래퍼). 로그 차례는 [근태 줄 → 여비계산서 줄].
> - 단독 패널 테스트가 `actions` 없이 패널을 만들므로 패널 팩토리는 deps.actions 가 없으면 스스로 디스패처를 만든다.
> - `references/input.yaml` 에는 `receipt`·`diagnose` 만 남았다(옮기기 전 모습은 `actions/test/fixtures/tasks-before.json`). `src/logbook.js` 에 `trip`·`rnd` 이름을 더했다.
> - 2단계로 남긴 것: §12 의 planned 행위 배선(R&D·메일·홈 카드·배경·회람·기념일 지원·숙박 줄), 재현용 원장, 통합 명령창. 콘텐츠 스크립트가 `actions/` 를 읽게 되면 `manifest.json` 의 web_accessible_resources 에 더해야 한다.

> 아래부터는 구현 전에 쓴 계약 원문이다(에이전트의 유일한 계약이었다). 이름(파일·함수·행위 ID·칸 이름)은 구현과 같고, 다른 곳은 위 메모와 §14 가 이긴다.

## 0. 한눈에

사용자 지정(2026-10-16): "LLM 이든 사람이 클릭하든 먼저 **구조화**된 다음 러너/실행기를 호출하는 구조로 **모두** 바꾸고 싶다. 중간에 **YAML 구조 파일**을 놓고 LLM 이 읽을 **인라인 프롬프트(read)** 를 넣는다. 사용자가 입력하는 칸도 나중에 LLM 을 넣을 수 있게 read 를 준다. 그 YAML 에는 **사전설정** 정보도 들어가야 하고, **공문 종류·근태 종류마다 YAML 이 따로** 있어야 한다."

```
사람(UI 클릭)  ──  패널이 칸 값을 모음 ──┐
                                        ├─ 기록(record: action + preset + input) ─ 관문(검증·정규화) ─ 디스패처(확인·기록) ─ 실행기(기존 코드)
LLM(말·문서)   ──  명세에서 만든 작업 ───┘
```

- **명세(spec)**: `actions/spec/<갈래>/<종류>.yaml` — 행위 하나에 파일 하나. 칸마다 `read`(LLM 에게 가는 인라인 프롬프트)와 **사전설정(preset)** 이 들어 있다. 단일 출처다.
- **생성물**: `actions/spec.js` — 확장은 YAML 을 못 읽으므로 `tools/gen-actions.mjs` 가 옮긴다(입력 명세 `src/inputspec.js`·공문 레시피 `src/gmrecipe.js` 와 같은 방식). **LLM 작업(task)** 도 여기서 만들어 `src/input.js` 의 `TASKS` 에 합쳐진다.
- **기록(record)**: 실행 중에 돌아다니는 것은 명세에 맞는 **JS 객체**다. 활동 로그에 남고 YAML 글로도 보인다(저장·복사용). 클릭마다 YAML 문자열을 만들고 다시 파싱하지 않는다.
- **관문(gate)**: 어느 길로 왔든(UI·LLM·규칙 해석) 실행기에 가기 전에 지난다. 기존 `src/input.js` 의 `structure` 를 **일반화**해 쓴다 — 초안 모드(LLM 조각, 틀린 칸은 비우고 알림)와 **실행 모드(UI 가 보낸 기록 — 잃는 보정이 생기면 막는다)** 를 가른다.
- **디스패처(dispatch)**: 행위 ID → 실행기 이름 → 등록된 함수. **사람 확인(confirm)** 이 필요한 행위는 확인 증거(기록의 지문) 없이는 돌리지 않는다. 한 번 돌 때마다 활동 로그에 기록(잘라 낸 것)과 결과를 한 줄 남긴다.
- **실행기(runner)**: 기존 코드 그대로(`src/runners.js`·`src/attend.js`+`src/hr.js`·`src/trip.js`·`src/gongmun.js`+`src/gmwrite.js` …). **사이트 특유의 순서·되돌리기 판단은 옮기지 않는다.** 새 층은 그 앞에 서는 얇은 어댑터다.

**1단계(이번)**: 층을 만들고 회의실·차량·근태·출장(여비)·공문의 흐름을 옮긴다. R&D·메일·홈 카드·배경·회람은 명세만 `status: planned` 로 두고 2단계에 옮긴다(§12).

## 1. 용어

| 말 | 뜻 |
|---|---|
| 갈래(domain) | room · car · attend · trip · gongmun · (2단계) rnd · mail · home · circulate |
| 종류(kind) | 갈래 안의 행위 하나. 파일 하나. 근태는 trip·out·leaveout·leave·flex·health + cancel·doc, 공문은 purchase·edu·trip·outside + setup |
| 행위 ID | `<갈래>.<종류>` — `attend.trip`, `gongmun.purchase`, `room.reserve` |
| 사전설정(preset) | 사용자가 그때그때 적지 않는 값 — 내 이름·오늘·근무지·공문 설정(부서·부서장·소장·본부장·문서번호 부서)·고른 과제·종류의 기본값. 저장소·레시피·상수에서 **실행 전에 채워 기록에 같이 담는다** |
| 입력(input) | 사용자(UI) 또는 LLM 이 정하는 칸의 값 |
| 기록(record) | `{ v, action, at, by, via, preset, input, hash }` — 관문을 지난 한 건 |
| 작업(task) | LLM 에게 주는 지시문·스키마 한 벌(`src/input.js` 의 TASKS 원소). 행위 명세에서 **만든다** |
| 실행기(runner) | 기록을 받아 실제로 하는 함수. 디스패처에 **이름으로 등록**된다(LLM 은 이름을 못 정한다) |

## 2. 폴더와 파일

```
actions/
  README.md                 무엇·왜·흐름·YAML 쓰는 법·바깥과 닿는 곳 표(통합자)
  CLAUDE.md                 경계 규칙(통합자)
  spec/                     ★ 명세(단일 출처) — 갈래 폴더 / 종류 파일
    room/_domain.yaml  room/search.yaml  room/reserve.yaml  room/cancel.yaml  room/modify.yaml
    car/_domain.yaml   car/search.yaml   car/reserve.yaml   car/cancel.yaml   car/modify.yaml
    attend/_domain.yaml  attend/trip.yaml  attend/out.yaml  attend/leaveout.yaml  attend/leave.yaml  attend/flex.yaml  attend/health.yaml  attend/cancel.yaml  attend/doc.yaml
    trip/_domain.yaml  trip/create.yaml  trip/presave.yaml  trip/preconfirm.yaml  trip/postconfirm.yaml  trip/after.yaml  trip/delete.yaml  trip/send.yaml
    gongmun/_domain.yaml  gongmun/purchase.yaml  gongmun/edu.yaml  gongmun/trip.yaml  gongmun/outside.yaml  gongmun/setup.yaml
    rnd/… mail/… home/… circulate/…   (status: planned — 2단계)
  spec.js                   생성물 — 고치지 않는다(`node tools/gen-actions.mjs`)
  gate.js                   관문 — 기록을 명세로 검증·정규화(초안/실행 모드)
  preset.js                 사전설정 채우기 — from 문법 풀이
  record.js                 기록 짓기·지문·로그용으로 자르기·YAML 글·한 줄 요약
  dispatch.js               디스패처 — 실행기 등록·build·run·확인·활동 로그
  runners/
    booking.js              room·car 실행기 어댑터(src/runners.js·src/modify.js·src/search.js)
    attend.js               근태(src/attend.js·src/hr.js)
    trip.js                 여비계산서(src/travel.js·src/after.js·src/trip.js·sendbox 의 송부)
    gongmun.js              공문(src/gongmun.js·src/gmwrite.js)
  test/*.test.mjs           node --test
tools/gen-actions.mjs       생성기(--check · --prompt <작업> · --show <행위> · --example <행위>)
```

- `actions/` 안의 코어(gate·preset·record·dispatch)는 **순수**다 — chrome·DOM·fetch·시계를 import 시점에도 호출 시점에도 직접 만지지 않는다(시각·저장소는 인자). `test/wiring.test.mjs` 가 jsdom 에서 `sidepanel.js` 를 통째로 import 한다 — import 만으로 아무것도 하지 않는다.
- `actions/runners/*.js` 는 `src/*` 실행기를 import 한다(그것들은 이미 import 안전하다). 패널만 import 한다. **서비스 워커·콘텐츠 스크립트는 1단계에서 이 폴더를 읽지 않는다**(2단계에 환경별 실행기를 따로 주입한다 — `manifest.json` 의 web_accessible_resources 는 `src/*.js` 뿐이다).
- `src/input.js` 는 `../actions/spec.js`(순수 데이터)만 import 한다. `native/host.mjs` 가 `src/input.js` 를 import 하므로 그 길에 실행 코드가 섞이면 안 된다.
- `recipes/gongmun` 은 **고치지 않는다**(레시피 생성기는 `from: document` 가 아닌 칸의 read 를 거부한다 — 공문 종류 YAML 이 초안 칸을 레시피에서 **참조**하고 나머지 칸의 read 는 YAML 쪽에 적는다). `mailtrack/`·`rerp/` 는 손대지 않는다.

## 3. YAML 명세의 꼴

### 3.1 갈래 파일 `_domain.yaml`

```yaml
domain: attend                 # 폴더 이름과 같다
title: 근태
log: attend                    # 활동 로그 kind(src/logbook.js KIND_LABEL 의 키). 종류 파일이 덮어쓸 수 있다
kinds: [trip, out, leaveout, leave, flex, health, cancel, doc]   # 종류 파일 차례(화면 차례). 파일이 다 있어야 한다
preset:                        # 갈래 공통 사전설정 — 종류 파일의 preset 앞에 합쳐진다(같은 키는 종류가 이긴다)
  today: { from: today, desc: 오늘 날짜 }
  me:    { from: me, desc: 내 이름 }
llm:                           # 이 갈래의 LLM 작업을 어떻게 만드는가
  task: attend                 # 작업 이름
  mode: merged                 # merged | per-kind | recipe | none  (아래 3.4)
  partial: true                # 답이 부분 수정(조각)인가 — null 은 "바꾸지 않음"
  input: attend                # 입력 글을 짓는 함수의 이름 — src/llm.js 의 INPUTS 표(attend → attendInput, search → searchInput …)
  role: >-                     # 지시문 첫 문단({종류} 자리는 per-kind 에서 종류 title 로 바뀐다)
    당신은 사내 근태 신청 도우미입니다. …
  rules: [ … ]                 # 모든 종류에 같이 가는 규칙(문장 목록)
  fields:                      # 모든 종류에 같이 들어가는 LLM 칸(reply 등) — 작업의 맨 뒤에 붙는다. ui: false 면 화면 칸이 아니다
    reply: { type: string, max: 300, desc: 답 한 줄, read: 무엇을 채웠는지 한국어 한 문장, ui: false }
```

### 3.2 종류 파일 `<종류>.yaml`

```yaml
id: attend.trip                # 필수 — <갈래>.<파일 이름>
title: 출장 신청                # 필수
status: live                   # live(기본) | planned — planned 는 runner·uses 검사와 배선에서 뺀다
confirm: true                  # 기본 true. false 면 사람이 누르지 않아도 run 한다(조회·초안 얹기·설정 반영)
effect: write                  # none(조회만) | draft(화면·저장소만) | write(사이트·HR·MCP 에 쓴다). 기본 write
log: attend                    # 갈래의 log 를 덮어쓸 때만
summary: '{dateFrom}~{dateTo} {place} · {purpose}'   # 활동 로그 한 줄 틀 — {칸} 은 input, {preset.키} 는 사전설정. 빈 값은 빈 글
preset:                        # 사전설정 — 3.3
  workplace: { from: storage:attendWorkplace, desc: 근무지(서울·부산) — 한 번 적으면 남는다 }
  start:     { value: '07:00', type: time, desc: 출발 시각 기본값 }
fields:                        # 입력 칸 — 3.3. 차례가 화면 차례다
  dateFrom: { type: date, required: true, label: 출발일, desc: 출발일, read: '출발일(YYYY-MM-DD). "내일"·"다음 주 수요일" 은 오늘을 기준으로 실제 날짜로', example: 2026-10-20 }
  …
checks:                        # 칸 사이 관계 — references/input.yaml 과 같은 꼴
  - { left: dateFrom, op: '<=', right: dateTo, drop: dateTo, message: 종료일이 시작일보다 앞서 종료일은 뺐습니다 }
rules: [ … ]                   # 이 종류만의 LLM 규칙 — merged 작업에서는 "종류가 trip(출장)일 때:" 를 앞에 붙여 들어간다
llm: true                      # 이 종류의 칸을 LLM 이 채우는가(기본 true). recipe 모드의 갈래에서는 객체 — 3.4
runner: attend.apply           # 실행기 이름 — actions/runners/<갈래>.js 가 이 이름으로 register 한다. 여러 종류가 같은 실행기를 쓸 수 있다
uses:                          # 사람이 읽는 실행 경로 — 테스트가 module 에 export 가 있는지 본다(input.yaml 의 consumer 와 같은 뜻)
  - { module: src/attend.js, export: buildJob }
  - { module: src/hr.js, export: hrRunJob }
then:                          # 뒤따르는 행위(사람이 같은 누름으로 승인한 범위). 디스패처가 **자동으로 잇지 않는다** — 패널이 차례로 부른다. 테스트는 action 이 있는지만 본다
  - { action: trip.create, when: settle }
  - { action: car.reserve, when: car }
next: 결재요청 뒤 HR 신청 내역에서 상태를 확인한다 …   # 사람이 읽는 다음 길
```

### 3.3 칸과 사전설정의 꼴

**칸(fields)** — `references/input.yaml` 의 칸 꼴 그대로에 아래를 더한다.

| 키 | 뜻 |
|---|---|
| `type` | `date` · `time` · `integer` · `number` · `string` · `enum`(values) · `boolean` · `list`(item — 줄의 칸, 한 겹) · **`tags`**(values — 값의 목록, 예: 교통편 [train, plane]) · **`file`**({ name, type, dataUrl } — 기록에는 이름·형식만 남고 바이트는 로그에 안 간다) · **`object`**(fields — 한 겹, 안에 list 는 되고 object 는 안 된다) |
| `required` | 실행 모드에서 꼭 있어야 하는가. (LLM 작업에서는 merged·partial 이면 전부 false 로 나간다) |
| `desc` | 짧은 설명(화면·스키마). 필수 |
| `label` | 화면 이름. 없으면 desc |
| `read` | **LLM 에게 가는 인라인 프롬프트**. 모든 칸에 둔다(사용자 지정 — 나중에 LLM 을 넣을 수 있게). `llm: false` 인 칸의 read 는 작업에 들어가지 않고 남아 있기만 한다 |
| `llm` | 기본 true. false 면 이 칸은 LLM 작업에 넣지 않는다(1단계: 지금 input.yaml 의 attend 작업에 없던 칸 — span·settle·car·transport·file·welfare 칸 — 은 false) |
| `ui` | 기본 true. false 면 화면 칸이 아니다(reply) |
| `when` | 이 칸이 사는 조건 — 다른 칸의 키(참일 때) 또는 `!키`. 문서·테스트용(관문은 1단계에서 보지 않는다) |
| `example` | 값의 보기(지시문에 들어간다 — 레시피와 같다) |
| `min` `max` `values` `item` | input.yaml 과 같다 |

**사전설정(preset)** — 키마다 `{ from | value, type?, desc, log? }`. `from` 과 `value` 가운데 **하나만**.

| `from` 값 | 뜻 |
|---|---|
| `today` | 오늘 YYYY-MM-DD(패널이 준다) |
| `me` | 내 이름(sidepanel 의 `myName`) |
| `storage:<키>` · `storage:<키>.<경로>` | `chrome.storage.local` 의 키(점 경로로 안쪽) — 패널이 `get` 함수를 준다 |
| `recipe:<레지스트리>.<경로>` | `src/gmrecipe.js` RECIPE 의 값(예: `recipe:settings.profiles.연구품의`) |
| `ctx:<이름>` | 패널이 build 때 ctx 로 준다(고른 과제 `project`, HR 의 나 `hrMe` 처럼 저장소 키 하나로 못 집는 것) |

`type` 은 칸과 같은 형(없으면 string, `object` 도 된다). `log: false` 면 활동 로그의 기록에서 뺀다(과제 내용 3000자 같은 것). 사전설정은 LLM 이 정하지 않는다(read 를 적어도 작업에 안 들어간다).

### 3.4 LLM 작업을 만드는 네 가지 모드

| mode | 만드는 작업 | 칸 | 쓰는 갈래 |
|---|---|---|---|
| `merged` | `llm.task` 하나 | `kind`(enum — 종류 목록, read 는 종류마다 "trip(출장)·out(외근·교육·부서소통회)…" 를 종류 파일의 title·hint 로 짓는다) + 모든 종류의 `llm: true` 칸의 **합집합**(종류 차례) + 갈래 `llm.fields`. 같은 키가 여러 종류에 있으면 type 이 같아야 하고(enum 은 values 합집합), read 가 다르면 "종류별 — trip: …; leave: …" 로 합친다. partial 이면 required 는 모두 false. rules = 갈래 rules + 종류 rules("종류가 trip(출장)일 때: …") | attend |
| `per-kind` | `<llm.task>.<종류>` | 그 종류의 칸만. role 의 `{종류}` 자리에 종류 title | room·car 의 search → `search.room`·`search.car` |
| `recipe` | 만들지 않는다 | 종류 파일의 `llm` 이 객체 — `llm: { tasks: [{ task: gongmun.purchase, fills: draft }, { task: gongmunReason.purchase, fills: draft }] }`. 생성기는 task 가 `RECIPE.tasks` 에 있는지, fills 가 칸인지 본다 | gongmun |
| `none` | 만들지 않는다 | UI 만 | trip(여비)·cancel·doc 같은 것 |

생성된 작업은 `tools/gen-input.mjs` 의 `checkSpec` 을 지나야 한다(작업에 들어가는 칸은 input.yaml 의 형만 쓴다 — `tags`·`file`·`object` 칸은 1단계에서 `llm: false`).

**1단계 호환 규칙(테스트로 못 박는다)**: 생성된 `attend` 작업의 칸 키·형·enum values 는 지금 `references/input.yaml` 의 `attend` 작업과 같다(desc·read 글만 다를 수 있다). `search.room` 은 `parse` 와 같은 칸, `search.car` 는 거기서 minSeats·region 을 뺀 것. 통합자가 마지막에 input.yaml 의 parse·attend 를 지우고 그 테스트를 고정 스냅샷(`actions/test/fixtures/tasks-before.json`)과 비교하는 것으로 바꾼다.

### 3.5 보기 셋

**`actions/spec/room/reserve.yaml`**

```yaml
id: room.reserve
title: 회의실 예약
effect: write
confirm: true
log: reserve
summary: '{room} {date} {start}~{end} · {title}'
preset:
  me:     { from: me, desc: 예약자(내 이름 — 내 예약 판정에 쓴다) }
  region: { from: storage:region, desc: 보고 있던 지역 }
fields:
  room:      { type: string, required: true, label: 회의실, desc: 회의실 이름, read: 조회 결과에서 고른 회의실 이름 그대로. 지어내지 않습니다 }
  roomValue: { type: string, required: true, desc: 사이트의 회의실 값, read: 조회 결과의 회의실 값(코드) 그대로, llm: false }
  region:    { type: enum, values: [부산, 서울], desc: 지역, read: 고른 회의실의 지역 }
  date:      { type: date, required: true, desc: 예약일, read: 예약일 YYYY-MM-DD }
  start:     { type: time, required: true, desc: 시작, read: 시작 시각 HH:MM(정시) }
  end:       { type: time, required: true, desc: 종료, read: 종료 시각 HH:MM(정시) }
  title:     { type: string, required: true, max: 100, label: 회의주제, desc: 회의주제, read: 사용자가 적은 회의주제. 지어내지 않습니다 }
checks:
  - { left: start, op: '<', right: end, message: 종료 시각이 시작보다 늦어야 합니다 }
llm: false                     # 1단계: 예약은 UI 가 고른 칸으로만 짓는다(말로 찾기는 room.search). 칸의 read 는 2단계 통합 명령창을 위해 둔다
runner: booking.reserve
uses: [{ module: src/runners.js, export: RUNNERS }]
next: 실행기가 다시 조회해 확인된 것만 ok 다 — 그 뒤 '내가 넣음' 기록과 내 이름을 남긴다(패널)
```

**`actions/spec/attend/trip.yaml`** (칸은 `src/attend.js` 의 `fieldsFor({kind:'trip'})`·`blankForm('trip')` 과 맞춘다)

```yaml
id: attend.trip
title: 출장 신청
summary: '출장 {dateFrom}~{dateTo} {place} · {purpose}'
preset:
  hrMe:      { from: ctx:hrMe, type: object, desc: HR 의 나(사번·이름) — 결재요청과 여비계산서에 쓴다 }
  workplace: { from: storage:attendWorkplace, desc: 근무지(서울·부산) }
  start:     { value: '07:00', type: time, desc: 출발 시각 기본값(아침 7시 — 2026-10-02 사용자 지정) }
  end:       { value: '20:00', type: time, desc: 도착 시각 기본값 }
  expense:   { value: 'Y', desc: 출장경비(늘 선급 예산) }
  transport: { value: [train], type: tags, desc: 교통편 기본값 }
fields:
  dateFrom:  { type: date, required: true, label: 출발일, desc: 출발일, read: … }
  start:     { type: time, required: true, label: 출발, desc: 출발 시각(정시), read: … }
  dateTo:    { type: date, required: true, label: 도착일, desc: 도착일, read: 여러 날 출장의 종료일. 당일이면 null }
  end:       { type: time, required: true, label: 도착, desc: 도착 시각(정시), read: … }
  days:      { type: integer, required: true, min: 1, max: 31, label: 며칠간, desc: 며칠간, read: '며칠간인지(당일 1, 1박 2일이면 2)' }
  place:     { type: string, required: true, max: 200, label: 출장지, desc: 출장지(도시·지역), read: '출장지 — 도시·지역(예: 대전). "대전 한국기계연구원" 이면 대전' }
  venue:     { type: string, max: 200, label: 장소, desc: 찾아갈 기관·건물, read: … }
  purpose:   { type: string, required: true, max: 200, label: 목적, desc: 목적, read: 목적·사유. 지어내지 않습니다 }
  settle:    { type: boolean, label: 여비계산서 사전정산, desc: 결재요청 뒤 여비계산서(사전정산)를 만든다, read: 사용자가 여비계산서·사전정산을 말했을 때만 true, llm: false }
  car:       { type: boolean, label: 차량 조회, desc: 빈 차량을 찾아 신청한다, read: 사용자가 차량을 말했을 때만 true, llm: false }
  workplace: { type: string, label: 근무지, desc: 떠나는 근무지(서울·부산), read: 근무지 — 서울 또는 부산, llm: false, when: settle }
  transport: { type: tags, values: [train, plane, bus], label: 교통편, desc: 교통편(여럿), read: 기차(train)·비행기(plane)·버스(bus), llm: false, when: settle }
  trainGrade: { type: enum, values: [normal, first], desc: 기차 좌석 등급, read: 특실이라고 했을 때만 first, llm: false, when: settle }
  sub: { … }  # 출장에는 갈래가 없다 — 넣지 않는다
rules:
  - 출장(trip)은 출장지(place — 도시·지역)와 장소(venue — 찾아갈 기관·건물)를 나눠 넣습니다. …
  - '"1박 2일"·"3일간" 처럼 기간으로 말했으면 days 에 날 수를 넣습니다(당일은 1).'
checks:
  - { left: dateFrom, op: '<=', right: dateTo, drop: dateTo, message: 종료일이 시작일보다 앞서 종료일은 뺐습니다 }
runner: attend.apply
uses:
  - { module: src/attend.js, export: buildJob }
  - { module: src/hr.js, export: hrRunJob }
then:
  - { action: trip.create, when: settle }
  - { action: car.reserve, when: car }
next: 결재요청(op=request) 뒤 HR 신청 내역에서 상태를 확인한다. 사전정산을 켰으면 trip.create 가 이어진다(패널이 부른다)
```

`attend/_domain.yaml` 의 `llm.fields` 에 `kind`? — **아니다.** `kind` 는 merged 모드가 종류 목록에서 **저절로** 만든다. 갈래 공통 칸은 `reply` 하나. `op`(save|request — 임시저장·결재요청)는 **종류 파일의 칸**이 아니라 **run 의 ctx** 다(§6.4) — 같은 기록을 임시저장했다가 결재요청할 수 있다.

**`actions/spec/gongmun/purchase.yaml`**

```yaml
id: gongmun.purchase
title: 구매품의 작성
log: gongmun
summary: '{preset.kindTitle} · {title}'
preset:
  me:      { from: me, desc: 기안자 }
  today:   { from: today, desc: 오늘 }
  setup:   { from: storage:gongmunPreset, type: object, desc: 공문 설정(부서·부서장·소장·본부장·문서번호 부서) }
  project: { from: ctx:project, type: object, desc: 고른 과제(이름·별명·번호·책임자·연구기간·개요·계정·참조자), log: false }
  kindTitle: { value: 구매품의, desc: 갈래 이름 }
  profile: { from: recipe:settings.profiles.연구품의, type: object, desc: 문서설정 프로파일 }
  rule:    { from: recipe:delegation.rules.연구비집행, type: object, desc: 위임전결 규정 }
fields:
  form:    { type: enum, values: [KR_EA_Research_Task, KR_EA_Form2], required: true, label: 양식, desc: eclass 양식, read: 품의 양식 — 연구업무추진품의(KR_EA_Research_Task)가 기본 }
  title:   { type: string, required: true, max: 99, label: 제목, desc: 공문 제목, read: 제목 틀을 채운 제목 }
  body:    { type: string, required: true, max: 20000, label: 본문, desc: 본문(틀을 채운 글), read: 본문 틀을 채운 글, llm: false }
  draft:   { type: object, from: recipe, desc: 초안 칸(레시피 purpose.yaml 의 fields·reads — 생성기가 펼친다), read: 읽은 문서와 과제 내용으로 채운 초안 }
  rank:    { type: string, max: 10, label: 전결권자, desc: 이 공문에서 고른 전결권자 직책(비면 규정대로), read: 사용자가 전결권자를 말했을 때만 }
  setting: { type: object, desc: 문서설정에서 이 공문만 바꾼 값, read: …, llm: false,
             fields: { retention: { type: string, desc: 보존년한 코드, read: … }, tag: { type: string, max: 60, desc: 검색 키워드, read: … }, emergency: { type: boolean, desc: 긴급, read: … } } }
  attach:  { type: list, max: 5, desc: 첨부 파일 이름(바이트는 ctx.files), read: 첨부 목록, llm: false, item: { name: { type: string, required: true, desc: 파일 이름, read: 파일 이름 }, kind: { type: string, desc: 무엇의 문서인지, read: … } } }
llm:
  tasks:
    - { task: gongmun.purchase, fills: draft }
    - { task: gongmunReason.purchase, fills: draft }
runner: gongmun.write
uses:
  - { module: src/gongmun.js, export: writePlan }
  - { module: src/gmwrite.js, export: writeGongmun }
next: 뒤 탭에 공문을 쓴다(과제·제목·본문·문서설정·결재선·첨부). 임시저장·상신은 사람이 창에서 한다
```

`draft: { from: recipe }` 는 생성기가 `RECIPE.purposes.purchase.fields`·`reads` 를 펼쳐 `fields.draft.fields` 로 만든다(레시피 type → 칸 type: text→string · money→number · date→date · choice→enum(options) · time→time · number→number · list→list(item 도 같은 규칙)). `read` 는 레시피의 read(없는 칸 — from: write/me/user/auto/setup — 은 label 로 "<label> 칸" 을 read 로 둔다). `required` 는 두지 않는다(레시피의 need 는 작성 준비의 뜻이라 실행 전 검사는 `src/gongmun.js` 가 한다 — Codex 지적 반영).

## 4. 생성물 `actions/spec.js` 의 꼴

```js
// 생성물 — 고치지 않는다. actions/spec 을 고치고 `node tools/gen-actions.mjs` 를 돌린다.
export const ACTIONS = {
  version: 1,
  domains: { attend: { domain, title, log, kinds, preset, llm: { task, mode, partial, input, role, rules, fields } }, … },
  actions: {
    'attend.trip': {
      id, domain: 'attend', kind: 'trip', title, status, confirm, effect, log, summary,
      preset: { today: {from:'today', desc}, me: {…}, workplace: {…}, start: { value:'07:00', type:'time', desc } },   // 갈래 preset 이 앞에 합쳐진 것
      fields: { dateFrom: { type:'date', required:true, label, desc, read, llm:true, ui:true, example }, … },  // 종류 칸(+ 갈래 llm.fields 는 넣지 않는다 — 작업에만)
      checks: [...], rules: [...], llm: true | { tasks: [...] },
      runner: 'attend.apply', uses: [...], then: [...], next,
    }, …
  },
  tasks: {   // src/input.js 의 TASKS 에 합쳐진다 — references/input.yaml 의 작업과 같은 꼴(title·kinds·consumer·next·role·fields·checks·rules·partial·variants)
    attend: { title, kinds: ['attend'], partial: true, consumer: { module: 'src/attend.js', export: 'applyPatch' }, next, role, fields: { kind: {…}, …, reply }, checks, rules },
    'search.room': { … consumer: { module: 'src/search.js', export: 'findSlots' } }, 'search.car': { … },
  },
};
```

- 생성기는 결정적이다(같은 YAML → 바이트까지 같은 JS). `--check` 는 쓰지 않고 어긋났는지만 본다(종료 코드 1). 테스트 `actions/test/spec.test.mjs` 가 `render()` 결과와 파일을 비교한다.
- 생성기의 검사(틀린 명세는 무엇이 틀렸는지만 말하고 끝낸다): id 와 파일 자리 · 갈래 kinds 와 파일 · 칸 형·desc·read(모든 칸) · enum values · list 한 겹·object 한 겹 · checks 가 있는 칸 · summary 의 {칸} 이 있는 칸 · preset 의 from 문법·from/value 하나 · runner 이름(live 면 필수) · uses 의 module 파일이 있고 export 가 있는지 · then 의 action 이 있는지 · recipe 모드의 task 가 RECIPE.tasks 에 있는지 · 생성된 tasks 는 `checkSpec`(gen-input) 통과 · merged 에서 같은 키의 type 충돌.
- `--prompt <작업>` 은 그 작업의 지시문 전문(`src/input.js` 의 promptOf), `--show <행위>` 는 합쳐진 명세, `--example <행위>` 는 example 로 채운 보기 기록을 YAML 글로.

## 5. 기록(record)의 꼴

```js
{
  v: 1,
  action: 'attend.trip',
  at: 1760600000000,              // 지은 때(ms) — 패널이 now 를 준다
  by: 'ui' | 'llm' | 'auto',      // 누가 지었나 (auto 는 2단계 — 회람·홈 카드)
  via: 'cli' | 'api' | 'local' | null,   // by 가 llm 일 때 어느 길
  preset: { today: '2026-10-16', me: '김기현', workplace: '부산', start: '07:00', … },   // 관문을 지난 사전설정
  input:  { dateFrom: '2026-10-20', dateTo: '2026-10-21', days: 2, place: '대전', … },    // 관문을 지난 입력
  hash: '1a2b3c4d',               // action + preset + input 의 지문(FNV-1a 32비트, 키를 정렬한 JSON) — 확인 증거와 묶는다
}
```

- 기록에는 **바이트·세션·ViewState·삭제 손잡이·DOM** 을 넣지 않는다(Codex 지적). 파일은 이름·형식만, 바이트는 `run` 의 ctx 로 간다. 사이트에서 읽은 산 손잡이(취소 record)는 ctx 다.
- 활동 로그에는 `clipRecord(record)` 가 간다 — `log: false` 인 preset 을 빼고, 긴 글은 200자에서 자르고(`…(N자)`), file 형 칸은 `{ name, type }` 만.
- YAML 글(`toYaml`)은 사람이 보고 복사하는 용도다(작은 emitter — 문자열은 필요할 때만 따옴표, 중첩 맵·목록 2칸 들여쓰기, null 은 `null`). 런타임은 JS 객체로만 다닌다.

## 6. 모듈 API

### 6.1 `src/input.js` 확장(기존 API 유지)

```js
export const TASKS = { ...INPUT_SPEC.tasks, ...RECIPE.tasks, ...ACTIONS.tasks };   // ../actions/spec.js 의 ACTIONS
export function structureOf(spec, raw, { kind, mode = 'draft' } = {}) → { data, notes }   // 명세 객체를 직접 받는 관문. structure(task, …) 는 specOf(task) 로 이것을 부른다
export function schemaOf(spec) → JSON 스키마   // jsonSchema(task) 는 이것을 부른다
export function promptOf(spec, { jsonOnly }) // 그대로
```

- 새 형: `tags`(배열, values 밖의 값은 뺀다 — 초안 모드에서는 note, 실행 모드에서는 problem), `file`(`{ name: string, type: string, dataUrl: string }` 모양이면 그대로, 아니면 undefined; 스키마·지시문에는 "파일(이름·형식)" 로), `object`(`fields` 로 한 겹 재귀 — 안의 list 는 된다. 없는 값은 null 또는 partial 이면 뺀다).
- `mode: 'execute'`: 초안 모드에서 note 로 끝나던 것(필수 아닌 칸의 틀린 값 비우기·목록 줄 빼기·checks 의 drop·variants 의 clear·tags 의 값 빼기)이 **모두 problem** 이 된다 → `InputError`. 글자 수 넘침(string max)만은 자르지 않고 problem 이다. 사람이 본 것과 보내는 것이 달라지면 안 된다(Codex 지적).
- `tools/gen-input.mjs` 의 `checkSpec` TYPES 에 `tags`·`file`·`object` 를 더한다(object 는 nested 금지 규칙: object 안에 object 없음, list item 안에 object 없음).
- `test/input.test.mjs` 에 새 형과 실행 모드의 검사를 더한다. 기존 검사는 그대로 통과해야 한다(`TASKS.attend` 는 1단계 동안 input.yaml 의 것이 남아 있고, 통합자가 지울 때 ACTIONS.tasks.attend 가 같은 키를 돌려준다).

### 6.2 `actions/gate.js`

```js
import { ACTIONS } from './spec.js';
export class ActionError extends Error { constructor(action, problems) }   // .action .problems[]
export function specOf(id, spec = ACTIONS) → 행위 명세 (없으면 ActionError)
export function presetSpec(entry)  → structureOf 가 받는 { fields } 꼴 (preset 의 type 기본 string)
export function check(id, { input = {}, preset = {} }, { mode = 'execute', spec = ACTIONS } = {}) → { input, preset, notes }
   // input 은 structureOf({ fields: entry.fields, checks: entry.checks, partial: mode==='draft' && 갈래 llm.partial }, raw, { mode })
   // preset 은 structureOf(presetSpec(entry), raw, { mode })  — 실행 모드에서 from 으로 채워져야 할 키가 없으면 problem(값이 null 이어도 키는 있어야 한다)
```

### 6.3 `actions/preset.js`

```js
export function parseFrom(from) → { source: 'today'|'me'|'storage'|'recipe'|'ctx', key, path: string[] }   // 틀리면 throw
export async function resolvePreset(entry, { storage, me = '', today = '', recipe = null, ctx = {} }) → { 키: 값 }
   // storage: async (keys: string[]) => object  — 패널이 (k) => chrome.storage.local.get(k) 를 준다. 한 번에 모아 읽는다(키 중복 제거)
   // recipe: RECIPE 객체(gongmun) — 없으면 recipe: 를 쓰는 명세는 throw
   // value 가 있는 키는 그 값(깊은 복사). from 이 못 찾으면 null(실행 모드 관문이 필수를 본다 — preset 에는 required 가 없으므로 null 도 통과한다; 꼭 있어야 하는 값은 실행기가 본다)
```

### 6.4 `actions/record.js`

```js
export function hashOf(value) → 8자리 16진 글(FNV-1a 32bit over 키를 정렬한 JSON)
export function makeRecord(id, { input, preset, by = 'ui', via = null, at }) → record (hash 포함) — 관문은 지나지 않는다(디스패처 build 가 지난 뒤 부른다)
export function clipRecord(record, entry, { max = 200 } = {}) → 로그용 복사본 (§5 규칙)
export function describe(record, entry) → summary 틀을 채운 한 줄(틀이 없으면 `${entry.title}`)
export function toYaml(value, { indent = 0 } = {}) → string
export function clipResult(result, { max = 300 } = {}) → { ok, verified, submitted, uncertain, stage, docNo, seq, docId, message, error, 그 밖의 스칼라 } 만
```

### 6.5 `actions/dispatch.js`

```js
export function createDispatcher({ spec = ACTIONS, log = () => {}, now = () => Date.now() } = {})
  .register(runnerName, fn, { ok = (r) => r?.ok === true } = {})   // fn: async (record, ctx) => result. 같은 이름을 두 번 등록하면 throw
  .build(id, { input = {}, preset = {}, by = 'ui', via = null, mode = 'execute' } = {}) → { record, notes }   // check → makeRecord. 틀리면 ActionError
  async .run(record, ctx = {}) → result
     // 1 entry = specOf(record.action); status 가 live 가 아니면 ActionError
     // 2 entry.confirm 이면 ctx.confirmed === record.hash 여야 한다(아니면 ActionError '확인 없이 실행할 수 없습니다') — LLM 이 준 confirmed 는 증거가 아니다. 패널이 누름 자리에서 record.hash 를 넣는다
     // 3 runner = runners[entry.runner] 없으면 ActionError
     // 4 result = await runner(record, ctx) — 던지면 { ok:false, error } 로 기록하고 **다시 던진다**
     // 5 log({ kind: entry.log || 갈래 log, ok: okOf(result), text: ctx.text ?? describe(record, entry), data: { record: clipRecord(record, entry), ...(ctx.data || {}), result: clipResult(result) } })
     // 6 return result
  .has(id) .ids() .entry(id)
```

- 디스패처는 **재시도·되돌리기·then 자동 실행을 하지 않는다.** 한 번의 run 은 실행기 한 번이다.
- `log` 는 패널의 `logEvent(kind, ok, text, data)` 를 감싼 함수다(sidepanel 이 만들어 준다: `(e) => logEvent(e.kind, e.ok, e.text, e.data)`). 활동 로그 kind 는 기존 KIND_LABEL 의 키를 쓴다 — 새 kind 가 필요하면 통합자에게.
- run 이 로그를 남기므로, 옮긴 호출 자리의 기존 `logEvent(...)` 는 **지운다**(중복 기록 금지). 기존 글은 `ctx.text`, 기존 data 는 `ctx.data` 로 넘긴다.

### 6.6 `actions/runners/*.js` — 실행기 어댑터

```js
// booking.js
export function registerBooking(d, { runners = RUNNERS } = {})
  'booking.search'  (rec, { onProgress, loadDay })  → findSlots(rec.input, onProgress, loadDay)          // room.search · car.search (confirm false)
  'booking.reserve' (rec, { day })                   → runners[kindOf(rec)].reserve(payloadOf(rec), day)   // payloadOf: input 을 RUNNERS.payload 가 내는 모양으로(kind·room·roomValue… 그대로) + car 는 car·carValue·room 별칭·blocked 는 ctx.blocked
  'booking.cancel'  (rec, { day, record })           → runners[kindOf(rec)].cancel(record, day)            // record 는 사이트에서 읽은 산 손잡이(ctx)
  'booking.modify'  (rec, { day, target, reloadFor, onStage }) → modifyReservation({ cancel, reserve, restore, onStage })   // rec.input = { back: {reserve 칸}, next: {reserve 칸} } — 콜백은 어댑터가 짓는다(지금 sidepanel 의 runModify·extendBooking 의 것을 옮긴다)
  ok: reserve·modify 는 (r) => r.ok === true && r.verified !== false
// attend.js
export function registerAttend(d)
  'attend.apply' (rec, { op = 'request', doc = null, today, onStage }) → hrRunJob(buildJob(formOf(rec, today), { action: op, doc }), { onStage })   // formOf: blankForm(kind, today) 위에 rec.input 을 얹은 폼(span·end 등 이미 settle 된 값)
  'attend.doc'   (rec, { item, onStage }) → action === 'delete' ? hrDeleteDoc(item) : hrRunJob(buildDocJob(item, rec.input.action))
  'attend.cancel'(rec, { item, onStage }) → hrRunJob(buildCancelJob(item, rec.input.reason))
// trip.js
export function registerTrip(d)
  'trip.create'  (rec, { memo, onStage }) → tripCreate(settlePlan(formOf(rec), memo), { emplNo: rec.preset.hrMe.emplNo, name, onStage })
  'trip.presave' · 'trip.preconfirm' · 'trip.postconfirm' · 'trip.delete' (rec, { row, onStage, … })  → src/trip.js 의 같은 이름 함수(row 는 ctx — 목록에서 읽은 줄)
  'trip.after'   (rec, { row, trseq, detail, picks, onStage, always, preconfirm }) → afterPlan(rec.input.records, {…}) → (필요하면 tripPreConfirm) → tripAfterSave   // 지금 attendpanel 의 runAfter/sendAfter 차례 그대로
  'trip.send'    (rec, { evidence, buildPdf, teams, memo, onStage }) → sendbox 의 go 가 하던 차례(계산서 PDF → 묶기 → Teams 또는 쪽지)
// gongmun.js
export function registerGongmun(d)
  'gongmun.write' (rec, { files, onStep, onTab, dry }) → writeGongmun(writePlan(rec.kind, { title, body, draft, form, setting, rank } = rec.input, { me, preset: setup, project, today } = rec.preset), { files, onStep, onTab, dry })
  'gongmun.setup' (rec, { rows, preset, current })   → mergeSetup(rows, preset, rec.input, { current })   // confirm false · effect draft
```

실행기 어댑터는 **기록을 기존 함수의 인자로 바꾸는 일만** 한다. 실행 순서·다시 조회·되돌리기 판단·단계 표시는 기존 함수와 패널에 그대로 있다.

### 6.7 `src/llm.js` — LLM 쪽 어댑터(2차 물결, U3)

```js
export async function askClaude(task, input, opts)   // 지금의 내부 함수를 내보낸다(모양 그대로)
export async function fillAction(id, text, ctx = {}, opts = {}) → { input, reply, via, costUsd, note, fails }
   // entry = ACTIONS.actions[id]; 갈래 llm.mode 가 merged 면 task = 갈래 llm.task, per-kind 면 `${task}.${kind}`, recipe/none 이면 throw
   // 입력 글: INPUTS[갈래 llm.input](text, ctx) — attend → attendInput(text, {form, today, history}), search → searchInput(text, {today, kind})
   // askClaude(task, …) → structure(task, …) 는 지금처럼 초안 모드. reply 는 떼어 돌려준다
export async function parseSmart(text, opts)        // 그대로 두되 안에서 task 를 `search.${kind}` 로 — 규칙 해석(parseLocal) 도 같은 작업의 관문
export async function fillAttendSmart(text, opts)   // 그대로(작업 이름 'attend' 는 이제 ACTIONS.tasks 의 것)
```

`test/llm.test.mjs` 의 작업 이름 기대값을 고친다('parse' → 'search.room'/'search.car'). `native/host.mjs` 는 TASKS 에서 작업을 만들므로 저절로 따라온다(`test/host.test.mjs` 의 `task: 'parse'` 는 다리가 모르는 작업이 되므로 'search.room' 으로 고친다 — 통합자가 본다).

## 7. 패널 배선 규칙(2차 물결 — U4·U5·U6)

1. 패널 머리에서 한 번: `const actions = createDispatcher({ log: (e) => logEvent(e.kind, e.ok, e.text, e.data) }); registerBooking(actions); …` — 세 패널(sidepanel·attendpanel·gongmunpanel)은 **같은 디스패처**를 쓴다: sidepanel 이 만들어 `createAttendPanel({ …, actions })`·`createGongmunPanel({ …, actions })` 로 넘긴다(패널 팩토리의 deps 객체에 키 하나 더). 패널 안에서 자기 갈래의 register 를 부른다.
2. 사전설정은 `resolvePreset(actions.entry(id).preset, { storage: (k) => chrome.storage.local.get(k), me, today, recipe: RECIPE, ctx })` 로 채운다. 자주 쓰는 것은 패널이 한 함수로 감싼다(`presetFor(id, ctx)`).
3. 옮기는 자리마다: **기존 실행기 직접 호출을 지우고** `const { record } = actions.build(id, { input, preset })` → `await actions.run(record, { confirmed: record.hash, text, data, …실행기 ctx })`. `confirmed` 는 **사람이 누른 핸들러 안에서만** 넣는다. `build` 의 `ActionError` 는 상태줄에 problems 를 적는다(지금 missingInput 이 하던 일).
4. LLM 이 채운 조각(fillAttendSmart·parseSmart)은 지금처럼 폼·조회로 간다. 조회(`room.search`)는 `build(…, { by: 'llm', via })` → `run`(confirm false). 근태 조각은 `applyPatch` 로 폼에 얹는다(행위 실행이 아니다 — 올리는 것은 사람이 누른 뒤 attend.<kind> 기록).
5. 옮긴 호출 자리의 `logEvent` 는 지운다(run 이 남긴다). 패널만 아는 뒷일(rememberBooked·forgetDays·confirmInList·여비계산서 이어 만들기)은 그대로 패널에 둔다.
6. **고치는 범위는 호출 자리와 import 뿐이다.** 화면·상태·문구·단계 표시는 건드리지 않는다. 다른 세션이 같은 파일을 고치고 있을 수 있다 — 고치기 직전에 다시 읽고, 작은 anchor 기준 치환으로만 고친다.
7. 배선이 끝난 흐름에는 **입구에서 실행기로 바로 가는 우회 호출이 남지 않는다**(테스트가 `sidepanel.js` 글에서 `run.reserve(`·`hrRunJob(`·`writeGongmun(` 직접 호출이 없음을 본다 — 통합자).

## 8. 테스트

| 파일 | 본다 |
|---|---|
| `actions/test/spec.test.mjs` (U1) | 생성물 = render(yaml) · 명세 검사가 틀린 것을 잡는다(id 불일치·모르는 형·read 없음·runner 없음·uses 없는 export·then 없는 행위·summary 없는 칸) · live 행위마다 runner 이름이 §6.6 의 등록 목록에 있다 · 1단계 호환(§3.4: attend 작업 = input.yaml attend, search.room = parse, search.car = parse − minSeats·region) · 근태 종류 칸 ⊆ `fieldsFor` 가 낼 수 있는 키(대표 상태 몇 가지 — settle/car/wfa 켠 것 포함) 이고 label 이 같다 · 공문 draft 칸 = 레시피 fields+reads 의 키 |
| `actions/test/gate.test.mjs` (U2) | 초안/실행 모드 차이(잃는 보정은 실행 모드에서 막힘) · tags/file/object · preset 검사 · partial |
| `actions/test/preset.test.mjs` (U2) | from 문법 · storage 모아 읽기 · recipe · ctx · value 깊은 복사 · 모르는 from 은 throw |
| `actions/test/record.test.mjs` (U2) | hash 가 키 차례와 무관 · clip(바이트 없음·log:false 제외·자르기) · describe · toYaml(둥근 왕복은 node 의 yaml 로 parse 해 deepEqual) |
| `actions/test/dispatch.test.mjs` (U2) | confirm 없이는 안 돈다 · hash 가 다르면 안 돈다 · planned 는 안 돈다 · 모르는 runner · 던지면 기록하고 다시 던짐 · 로그 한 줄의 모양 · 같은 입력을 UI/LLM 로 넣으면 정규화 결과가 같다 |
| `actions/test/runners.test.mjs` (U4·U5·U6 가 갈래별로 더한다) | 가짜 src 함수로 기록 → 인자 변환이 맞다(회의실·차량 payload 가 `RUNNERS.payload` 결과와 같다 등) |
| `test/input.test.mjs` (U2) | 새 형·실행 모드 |
| `test/llm.test.mjs` (U3) | fillAction · 작업 이름 |
| `test/wiring.test.mjs` (U4) | 그대로 통과 + 디스패처가 만들어졌는지 |

고친 뒤 늘: `node --check <파일>` → `node --test actions/test/*.test.mjs` → 갈래 테스트 → `node test/wiring.test.mjs` → `npm test`. 기준선(2026-10-16 HEAD abe6384, `npm test`): `test/rerp-origin.test.mjs`(kr_ext_rerp 원본이 stamp 뒤 바뀜)·`test/riskyear.test.mjs`·`test/sendcard.test.mjs` 세 파일은 이미 빨갛다(이 일과 무관 — 건드리지 않는다). 그 밖에 새로 빨개지면 내 탓인지 먼저 가린다.

## 9. 유닛과 파일 소유(겹치지 않게)

**1차 물결(동시)**

| 유닛 | 만드는 것 | 소유 파일 |
|---|---|---|
| U1 명세·생성기 | `tools/gen-actions.mjs`, `actions/spec.js`(생성), `actions/spec/{room,car,attend}/**`, `actions/test/spec.test.mjs`, `actions/test/fixtures/tasks-before.json` | 그 파일들만. `references/input.yaml` 은 **고치지 않는다**(통합자가 마지막에 parse·attend 를 지운다) |
| U1b 명세(출장·공문·2단계 stub) | `actions/spec/{trip,gongmun,rnd,mail,home,circulate}/**` — YAML 만. 생성기는 U1 것(나오면 받아 돌린다; 그 전에는 §3 의 꼴대로 적고 `yaml` 로 파싱만 확인) | 그 폴더들만 |
| U2 코어 | `actions/gate.js`·`preset.js`·`record.js`·`dispatch.js`, `actions/test/{gate,preset,record,dispatch}.test.mjs`, `src/input.js`(§6.1), `tools/gen-input.mjs`(TYPES), `test/input.test.mjs` | 그 파일들만. `actions/spec.js` 가 아직 없을 수 있다 — 테스트는 **작은 명세 객체를 직접 만들어** 검사하고, 코어는 `spec` 인자로 받는다(기본값 import 는 `./spec.js` — 없으면 import 가 실패하므로 U2 는 자리맡이 `actions/spec.js`(`export const ACTIONS = { version: 1, domains: {}, actions: {}, tasks: {} }`)를 두고 U1 이 덮어쓴다) |

**2차 물결(1차가 합쳐진 뒤 동시)**

| 유닛 | 만드는 것 | 소유 파일 |
|---|---|---|
| U3 LLM | §6.7 | `src/llm.js`, `test/llm.test.mjs`, `native/host.mjs`(필요하면) |
| U4 회의실·차량 | `actions/runners/booking.js`, sidepanel 배선(§7: submitBooking·reserveCarPick·cancelPicked·cancelFromMine·extendBooking·runModify·runAsk) | `actions/runners/booking.js`, `sidepanel.js`, `actions/test/runners-booking.test.mjs`, `test/wiring.test.mjs`(필요한 줄만) |
| U5 근태·출장 | `actions/runners/attend.js`·`trip.js`, attendpanel 배선(send·act·makeTripDoc·savePre·confirmPre·confirmPost·dropTrip·saveAfter·runAfter/sendAfter), sendbox 의 go(trip.send) | `actions/runners/attend.js`·`trip.js`, `attendpanel.js`, `sendbox.js`, `actions/test/runners-attend.test.mjs`·`runners-trip.test.mjs` |
| U6 공문 | `actions/runners/gongmun.js`, gongmunpanel 배선(writeDoc; 읽기·사유는 그대로 llm 작업) | `actions/runners/gongmun.js`, `gongmunpanel.js`, `actions/test/runners-gongmun.test.mjs` |

**통합(통합자 — 이 세션)**: `actions/README.md`·`CLAUDE.md`, `docs/actions-design.md`(이 문서), `README.md`(구조 표·입력 명세 절), `package.json`(test glob에 `actions/test/*.test.mjs`), `tools/refdata.mjs`(gen/check 에 gen-actions), `references/input.yaml`(parse·attend 삭제 + `src/inputspec.js` 재생성), `test/host.test.mjs`(작업 이름), 활동 로그 KIND_LABEL, CDP 로 실제 확장 확인(`test/cdp/reload.mjs` → 패널 열기 → 말로 찾기 한 번 → 로그에 기록이 남는지), 커밋은 사용자가 시킬 때만.

## 10. 하지 말 것(Codex 지적 + 통합자)

- 사이트 실행 순서(HR 입력 차례·ViewState 다시 읽기·차량 취소 손잡이 다시 찾기·수정의 되돌리기 판단·정산의 덮어쓰기 규칙·공문의 단계)를 YAML 이나 디스패처로 옮기지 않는다. 기존 함수를 **감싼다**.
- 디스패처에 재시도·롤백·then 자동 실행을 넣지 않는다. 제출 뒤 결과 불명(`submitted` 인데 `verified` 아님)은 실패와 다르다 — 실행기 결과를 그대로 돌려준다.
- LLM 이 함수·주소·실행기 이름·실행 순서를 정하게 하지 않는다. 명세의 칸 값만 제안한다. `confirmed` 를 LLM 답에서 받지 않는다.
- 조회·초안·제출을 같은 권한으로 다루지 않는다. 구조가 맞다고 다음 쓰기 행위를 자동으로 잇지 않는다.
- `confirm` 을 새 팝업으로 만들지 않는다 — 지금 버튼(예약하기·결재요청·공문 작성)이 확인이다.
- 같은 칸을 input.yaml·레시피·행위 YAML 세 벌로 복사하지 않는다(1단계 동안 input.yaml 의 parse·attend 가 잠시 남는 것은 통합자가 지운다; 공문 초안 칸은 레시피에서 펼친다).
- UI 상태 전체·DOM·콜백·사이트 손잡이·파일 바이트를 기록에 담지 않는다.
- 활동 로그를 재실행 원장이라고 부르지 않는다(500건·6000자·합침). 재현은 2단계(같은 입력으로 계획 다시 짓기).
- `mailtrack/`·`rerp/`·`recipes/gongmun` 을 고치지 않는다. `manifest.json` 은 1단계에서 안 바뀐다.
- 커밋하지 않는다. 다른 세션이 같은 작업 트리를 고치고 있다 — 자기 소유 파일만 고치고, 빨간 테스트는 기준선(§8)과 견준다.

## 11. Codex 검토에서 받아들인 것 / 미룬 것

받아들임: 공통 디스패처가 없다는 진단 · 입구 목록(sendbox·lodgebox·welfare·background·home·circulate·rnd·mail 까지 "모두"의 범위) · YAML 정본 + 런타임 JS 객체 · runner 고정 ID · desc/read 분리 · 공문 칸은 레시피 참조 · 초안/실행 모드 · partial 유지 · 확인 증거를 정규화 기록(hash)에 묶기 · prepare 의 부작용(writeGongmun 의 설정 저장·첨부, afterUp 의 사전확정) 을 "무부작용" 이라 부르지 않기 · 기록에 바이트·손잡이 금지 · 네이티브 호스트 import 경로 순수 유지 · 환경별 실행기 주입(2단계) · mailtrack 은 주입 · rerp 불변 · 생성기 refdata gen/check 연결 · 옮기는 차례.
미룸(2단계): 재현용 원장(명세 해시·확장 버전·단계별 결과) · 통합 명령창(LLM 이 허용 행위 가운데 고르기) · R&D·메일·홈·배경·회람·보조 폼(welfare·lodgebox) 전환.

## 12. 2단계 — planned 로 두는 행위(명세만, U1b)

`rnd.project`(과제 더하기·고치기)·`rnd.delete`·`rnd.yaml`(YAML 넣기)·`rnd.erp.link`·`rnd.erp.fetch`·`rnd.note.sync`·`rnd.research.share`·`rnd.skills.zip` · `mail.register`·`mail.refresh`·`mail.delete`·`mail.merge`·`mail.settings` · `home.evidence`(홈 카드 증빙 받기 — background.evidenceKeep)·`home.afterup`(홈에서 사후정산 올리기)·`home.receipt`(afterpage 의 receiptRead) · `circulate.run` · `attend.welfare`(기념일 지원 화면 채우기)·`trip.lodge`(숙박 줄 상한·비고·지우기 — lodgebox). 각 파일은 id·title·status: planned·effect·fields(지금 코드가 받는 값)·preset·runner(이름만)·uses 를 적는다. 생성기는 planned 의 uses 는 검사하고 runner 등록은 요구하지 않는다.

## 13. 추측·미결(통합자가 결정한다 — 에이전트는 계약대로 간다)

- `gongmunSetupSmart`(공문 설정 채우기)는 지금 패널에서 부르는 곳이 없다 → `gongmun.setup` 은 status: planned.
- 근태 `attend.doc`(상신·회수·삭제)과 `attend.cancel`(취소신청)의 input 은 `{ docNo, formId, action | reason }` 이고 목록 줄(item)은 ctx 다.
- `room.modify` 의 input `{ back, next }` 두 object 칸은 reserve 칸과 같은 fields 를 쓴다(생성기가 `from: room.reserve` 로 펼친다 — U1 이 `from: <행위 ID>` 를 지원한다).
- 여비 `trip.after` 의 `records` 는 `list` 칸이고 item 은 `from: task:receipt`(input.yaml 의 receipt 칸) + `file`(이름·형식) — U1b 가 적고 U1 의 생성기가 `from: task:<이름>` 을 지원한다.

## 14. 계약 수정 — Codex 2차 검토 반영(2026-10-16). **앞 절과 다르면 이 절이 이긴다.**

### 14.1 기록·확인·관문 (U2)
- `run(record, ctx)` 는 실행 직전에 `check(record.action, { input, preset }, { mode: 'execute' })` 를 **다시** 지나고 `hashOf({ action, preset, input })` 를 **다시** 센다. `record.hash` 와 다르면 `ActionError('기록이 지은 뒤에 바뀌었습니다 …')`, `confirm` 행위면 `ctx.confirmed` 가 그 hash 여야 한다. 실행기에는 다시 정규화한 **깊게 얼린(Object.freeze) 기록**을 준다. draft 모드로 지은 기록도 여기서 실행 모드 검사를 지나므로 필수가 비면 막힌다.
- `ctx.outcome?: async (result) => ({ ok?, text?, data? })` — 실행기가 돌아온 뒤, 로그를 남기기 **전에** 기다린다(패널이 confirmInList 같은 최종 확인을 하고 최종 문구·data 를 정한다). 돌려준 ok/text/data 가 있으면 그것으로 로그를 쓴다. 던지면 ok:false 로 기록하고 다시 던진다. 로그는 run 마다 이 한 줄뿐이다.
- `file` 형: 기록의 파일은 **참조**다 — `{ name: string, type: string, size?: integer }` 만 받고 다른 키(dataUrl·bytes)는 두 모드 모두 note 없이 버린다. 바이트는 `run` 의 `ctx.files`(`[{ name, type, dataUrl }]`)로 가고 어댑터가 이름으로 잇는다 — 기록의 파일 이름이 ctx.files 에 없으면 어댑터가 ActionError.
- 실행 모드의 엄격함: 아래가 **모두** problem 이다 — 필수 아닌 칸의 틀린 값 · 목록 줄의 틀린 값(줄 빼기) · 목록 길이 > max · tags 의 모르는 값 · checks 의 drop · variants 의 clear · 글자 수 > max. 명세에 없는 키는 두 모드 모두 조용히 버린다(기록은 선언된 칸뿐이다 — 빠진 칸은 U1 의 blankForm 검사가 잡는다).
- `when`: 칸의 `when` 을 관문이 **두 모드에서** 본다. 문법 `key`(참) · `!key`(거짓) · `key=value` · `key!=value`(value 는 글·수·true·false). 조건이 거짓이면 그 칸은 통째로 건너뛴다(required 도 안 보고 결과에서 뺀다 — null 도 안 넣는다). 조건의 key 는 같은 fields 의 칸이어야 한다(생성기 검사). 조건부 필수(기차일 때만 근무지 …)는 1단계에서 기존 검증기(readyToSend·buildJob)가 본다 — YAML 의 required 는 무조건 필수만.
- preset 항목에 `required: true` 를 둘 수 있다(실행 모드에서 null 이면 problem). `type: object` 인 preset 에 `fields` 가 없으면 **불투명 객체**다(plain object 또는 null 만 받고 깊은 복사해 그대로 둔다).
- `resolvePreset(presetMap, deps)` — 첫 인자는 preset 맵(`entry.preset`)이다.

### 14.2 명세 (U1 · U1b)
- 작업(task)을 만들 때 칸의 desc 자리에 **read** 를 넣는다(`example` 이 있으면 ` (예: …)` 를 뒤에 — gen-gongmun 과 같다). `promptOf` 는 그대로다. 행위 entry 에는 desc·read 둘 다 남는다.
- per-kind 작업 이름은 종류 파일이 **직접 적는다**: `llm: { task: search.room }` / `llm: { task: search.car }`. 갈래 llm.mode 가 per-kind 면 llm 을 켠 종류마다 task 이름이 있어야 한다(생성기 검사). role 의 `{종류}` 자리는 종류 title.
- 칸의 `drop: '<알림>'`: 이 종류가 받지 않는 칸(차량의 minSeats·region). 행위의 기록 칸에서는 **빠지고**, 생성된 작업에는 칸으로 들어가며(desc 는 read) `kinds: [<종류>]` + `variants: { <종류>: { clear: { 칸: 알림 } } }` 로 나간다 — 지금 parse 의 차량 동작(두 칸을 null 로 비우고 알림)이 그대로 남는다(test/llm.test.mjs 151행).
- 칸의 `default: 값`: 기본값(문서·`--example` 용 — 적용은 지금처럼 blankForm 이 한다). 폼의 기본값(출장 07:00/20:00·expense Y·교통편 train·외근 09:00)은 preset 이 아니라 칸의 `default` 로 적는다. **preset 은 저장소·ctx·레시피에서 실행 전에 채워 어댑터가 실행기에 넘기는 값만** 둔다 — 실행기가 안에서 RECIPE 를 다시 읽는 것(문서설정 프로파일·위임전결 규정)은 preset 에 두지 않는다(참고 정보를 hash 에 넣지 않는다).
- UI 값과 LLM 값이 다른 칸은 **LLM 값(지금 input.yaml 의 values)** 으로 적고 UI 대응을 주석에 적는다 — `half: [am, pm, full]`(UI 의 전일은 빈 값 → 기록에는 없음; 어댑터가 '' ↔ null). `trainGrade` 의 values 는 `[standard, first]`(references/travel-rules.yaml).
- merged 모드: `llm: false` 인 종류(cancel·doc·welfare)는 kind enum 에서 뺀다. 같은 키가 여러 종류에 있으면 type·min·max 는 같아야 하고(enum 의 values 는 합집합) read 가 다르면 종류별로 합친다. checks 는 (left, op, right, drop) 로 중복을 뺀 합집합. `wfa` 는 LLM 칸이다(llm: true) — 나머지 기념일 칸(wfaName…)만 llm: false.
- 근태 종류 파일마다 `op: { type: enum, values: [save, request], required: true, label: 올리는 길, desc: 임시저장·결재요청, read: …, llm: false }` 와 `doc: { type: object, fields: { docNo: {type: string}, statusCode: {type: string} }, desc: 고쳐 올리는 문서(없으면 새 신청), llm: false }` 를 둔다 — 임시저장과 결재요청은 다른 확인이다(기록이 다르다). `op`·`doc` 은 더 이상 ctx 가 아니다.
- 대상 식별자는 **기록에** 둔다: attend.doc `{ docNo, formId, action: enum[request, recall, delete] }` · attend.cancel `{ docNo, formId, reason }` · trip.* `{ seq, trseq? }` · trip.send `{ seq, docNo, account, to: object{ id, name }, channel: enum[teams, memo], reason, file }` · gongmun 의 `attach` 는 파일 이름 목록. 어댑터는 ctx 의 산 대상(item·row·files)이 기록의 식별자와 같은지 확인하고 다르면 ActionError.
- trip.after 는 사용자가 정한 것을 기록에 담는다: `records`(list — item `from: task:receipt` + `file` 참조) · `picks`(object — 가는 편·오는 편) · `workplace` · `lodge`(list — 숙박 줄마다 `{ key(줄 식별 글 — src/afterup.js lodgeKey 꼴), settle: enum[cap, actual, krw], amount: number, reason: string }`) · `exclude`(list of string — 안 올릴 증빙 이름) · `always: boolean` · `preconfirm: boolean`. 어댑터가 afterPlan 으로 다시 짓고 lodge 결정을 같은 함수(lodgeDecide·lodgeSettle …)로 되얹는다 — U5 가 test/lodgeask.test.mjs 로 맞춘다. U1b 는 칸을 두고, U5 가 2차 물결에서 `trip/after.yaml` 을 고칠 수 있다(그때는 U5 소유).
- gongmun 의 `setting` object 칸 = `settingPatch` 가 받는 키 전부: retention · docNo · receiver · scope · emergency(boolean) · approvingOpen(boolean) · drm(boolean) · tag.
- gongmun draft 펼치기(`from: recipe`): 레시피 `fields` ∪ `reads` ∪ `{ currency: enum[KRW, USD, EUR, JPY, CNY, GBP], attach: list{ name: string(required), kind: string } }` — reads 의 item 배열은 key 로 묶은 객체로, 생략된 type 은 text→string, item 의 required 는 그대로. draft 안에 required 는 두지 않는다(need 는 안내용이고 작성을 막지 않는다).
- U1 테스트의 방향: `fieldsFor(form)` 의 키 ⊆ YAML fields(반대가 아니다 — fields 에는 trainGrade 처럼 fieldsFor 가 안 내는 칸도 있다). 그리고 종류마다 `blankForm(kind)` 의 키 ⊆ fields ∪ YAML 의 `ignore`(기록에 안 담는 화면 전용 키 목록 — 까닭 주석) — dateTo·end 처럼 settle 이 만드는 파생 키도 fields 에 있어야 한다.
- `attend/welfare.yaml` 은 **U1** 이 쓴다(status: planned, `_domain.kinds` 에 welfare 를 더한다). U1b 는 쓰지 않는다.

### 14.3 실행기 성공 판정 — 어댑터가 `register` 때 `ok` 를 준다 (U4·U5·U6)

| 실행기 | 돌아오는 것 | ok |
|---|---|---|
| booking.reserve · booking.modify | `{ok, verified, …}` | `r.ok === true && r.verified !== false` |
| booking.cancel | `{ok, …}` | `r.ok === true` |
| booking.search | `{results, skipped, dates}` | 늘 true |
| attend.apply · attend.cancel · attend.doc(request·recall) | hrRunJob 의 `{ok, stage, docNo, …}` | `r.ok === true` |
| attend.doc(delete) | hrDeleteDoc 의 수 | 던지지 않으면 true — 어댑터가 `{ ok: true, deleted: n }` 로 감싼다 |
| trip.create | `{row, existing, linked}` | 던지지 않으면 true |
| trip.presave · preconfirm · postconfirm · delete · after | `{row, stage, sent, …}` / `{seq}` | 던지지 않으면 true(`sent:false` 도 정상일 수 있다) |
| trip.send | 어댑터가 `{ ok: true, channel, to, file, pages }` 를 돌려준다 | `r.ok` |
| gongmun.write | `{tabId, docId, steps}` | `!r.steps.some((x) => x.ok === false)` |

어댑터 주입: `register<갈래>(d, deps = {})` — deps 의 키는 실제 함수 이름과 같고 기본값은 src 모듈의 진짜 함수다(테스트는 가짜를 넣는다). 갈래별 테스트 파일은 §9 대로 `actions/test/runners-<갈래>.test.mjs` 다(§8 의 공용 runners.test.mjs 는 없다).

### 14.4 패널 (U4·U5·U6)
- gongmun.write: `writePlan(entry.kind, { title, body, draft, form, setting, rank } = rec.input, { me: rec.preset.me, preset: rec.preset.setup, project: rec.preset.project, today: rec.preset.today })` — 기록에 kind 는 없다(entry 에서 온다). `ctx.preset` 자리에 `rec.preset.setup` 을 넘긴다(공문 설정 — 문서번호·결재선이 여기서 나온다).
- attend.doc: `rec.input.action === 'delete' ? hrDeleteDoc(ctx.item, { onStage }) : hrRunJob(buildDocJob(ctx.item, rec.input.action), { onStage })`; attend.cancel 도 `{ onStage }` 를 넘긴다.
- `createAttendPanel`·`createGongmunPanel`·`createSendBox` 는 deps.actions 가 없으면 **스스로** `createDispatcher({ log })` 를 만든다(단독 패널 테스트 attendlist·tripcard·tripcancel·lodgeask 가 actions 없이 만든다).
- 근태 결재요청의 최종 성공은 confirmInList 뒤에 정해진다 → `actions.run(record, { …, outcome: async (r) => { /* confirmInList 등 */ return { ok, text, data }; } })`.
- 1단계의 "조회" 는 말로 찾기(search)만 행위다. loadDay·scanDays·tripList·hrListDocs 같은 읽기는 행위가 아니다(그대로 둔다). 우회 호출 검사는 쓰기 함수(reserve·cancel·modifyReservation·hrRunJob·hrDeleteDoc·tripCreate·tripPreSave·tripPreConfirm·tripPostConfirm·tripDelete·tripAfterSave·teamsSendFile·memoSend·writeGongmun)와 findSlots 만 본다.
- trip.send 어댑터는 **보내기만** 한다(계산서 PDF → 묶기 → Teams 또는 쪽지). 그 앞의 사후정산 저장·확정은 trip.after·trip.postconfirm 행위로 패널이 먼저 돈다. 확인한 채널(record.input.channel)과 지금 고른 채널이 다르면 패널이 보내지 않는다.

### 14.5 그 밖
- 서비스 워커도 `background.js → src/llm.js → src/input.js → actions/spec.js` 로 spec.js(순수 데이터)를 읽는다 — 괜찮다. manifest 는 안 바뀐다.
- `{ ...INPUT_SPEC.tasks, ...RECIPE.tasks, ...ACTIONS.tasks }` 라 생성물이 생기는 순간 attend 작업은 생성된 것이 된다(키 호환은 U1 테스트가 보증). 통합자가 input.yaml 의 parse·attend 를 지울 때 test/input.test.mjs 의 parse 를 쓰는 검사(26·98·108행)를 search.room 으로 고친다.
- `actions/spec.js` 는 U1 의 생성물이다. U2 의 자리맡이는 U1 생성물이 없을 때 한 번만, U1b 는 생성기를 돌려 자기 YAML 을 검사해도 되고(결정적이라 같은 결과), U1 이 마지막에 다시 돌린다.
