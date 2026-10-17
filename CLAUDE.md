# KRS WORKSPACE 확장 — 먼저 알 것

KRS eclass·HR·R&D 를 사이드 패널에서 다루는 크롬 확장(MV3)이다. 폴더에 따로 `CLAUDE.md` 가 있으면 그 폴더에서는 그것을 따른다(`actions/`·`mailtrack/`·`rerp/`).

## 행위 층 — 누르든 말하든 YAML 명세를 거쳐 실행기로 간다

사람이 패널에서 누르든 LLM 이 말·문서를 읽어 채우든, **먼저 명세(YAML)대로 같은 기록이 되고 그 다음에 실행기가 돈다**(2026-10-16).

```
사람(UI 클릭) ─ 패널이 칸 값을 모음 ─────────────────────────┐
                                                             ├─ 기록 ─ 관문 ─ 디스패처 ─ 실행기 ─ 기존 코드(src/…)
LLM(말·문서) ─ 명세가 만든 작업 → askClaude(CLI → API 키) ───┘
```

- **명세(정본)**: `actions/spec/<갈래>/<종류>.yaml` — 행위 하나에 파일 하나(근태 종류마다, 공문 종류마다 …). 칸마다 `read`(LLM 에게 가는 인라인 프롬프트)·`preset`(사전설정 — 오늘·내 이름·저장소·레시피)·`default`. `_domain.yaml` 은 갈래 공통.
- **생성물**: `actions/spec.js` — `node tools/gen-actions.mjs` 로 만든다. 고치지 않는다. LLM 작업도 여기서 나와 `src/input.js` 의 `TASKS` 에 합쳐진다.
- **기록(record)**: `action`(`<갈래>.<종류>`) + `preset` + `input` + `hash`. 바이트·세션·DOM 은 넣지 않는다(실행 때 `ctx` 로).
- **관문** `actions/gate.js`: LLM 조각은 초안 모드(틀린 칸은 비우고 알림 → 폼에 채움), 사람이 보낸 기록은 실행 모드(잃는 보정이 생기면 막음).
- **디스패처** `actions/dispatch.js`: 실행 직전에 관문 재검사·지문 확인 → `confirm` 행위(기본)는 사람이 누른 핸들러가 넣은 `confirmed: record.hash` 가 있어야 돈다(LLM 답에서 받지 않는다. 조회처럼 `confirm: false` 인 것만 바로) → 실행기 한 번 → 활동 로그 한 줄. 재시도·되돌리기는 하지 않는다.
- **실행기** `actions/runners/<갈래>.js`: 기록을 기존 함수(`src/runners.js`·`src/attend.js`+`src/hr.js`·`src/trip.js`·`src/gongmun.js` …)의 인자로 바꾸는 어댑터일 뿐이다. 사이트 특유의 순서는 기존 코드에 둔다.
- `status: planned`(R&D·메일·홈 카드·회람 …)는 명세만 있고 아직 디스패처를 거치지 않는다(2단계).
- 새 행위·칸은 **YAML 먼저** → `node tools/gen-actions.mjs` → 실행기 등록 → 패널이 디스패처로 부르게. 새 **공문 종류·양식**은 레시피(`recipes/gongmun`)가 먼저다 — 차례는 `recipes/gongmun/README.md`(행위 명세의 종류 목록이 레시피의 목적과 다르면 생성기가 막는다).
- 확장 안에서 보기: **설정 → 일반 → 행위 명세**(갈래 → 종류 → YAML 원본, `src/specview.js`). 갈래 폴더를 새로 만들면 `src/specview.js` 의 `DOMAIN_ORDER` 에 자리를 준다.

자세히: [actions/CLAUDE.md](actions/CLAUDE.md)(고칠 때의 규칙) · [actions/README.md](actions/README.md)(흐름·기록 꼴·YAML 쓰는 법) · `docs/actions-design.md`(설계·2단계).
