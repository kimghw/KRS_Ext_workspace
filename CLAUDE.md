# KRS WORKSPACE 확장 — 먼저 알 것

KRS eclass·HR·R&D 를 사이드 패널에서 다루는 크롬 확장(MV3)이다. 폴더에 따로 `CLAUDE.md` 가 있으면 그 폴더에서는 그것을 따른다(`actions/`·`mailtrack/`·`rerp/`).

## 요구사항 — `spec/` 에 주제별로, 요구사항만

사용자가 말한 요구와 결정은 `spec/<주제>.md` 에 **날짜 · 원문(요지) · 결정** 한 줄로 적는다(2026-10-18 사용자 지정: "spec 폴더를 하나 만들고 사용자의 요구사항… 요구사항만을 주제 별로 관리할 수 있도록"). krs-web-agents 의 `spec/`(① 질의·요청 ② 확정 사양 ③ 구현 상태 ④ 미결 사양서)에서 **① 만 떼어 둔 꼴**이다 — 설계·구현 상태·실측은 적지 않는다(그건 README·`docs/`·폴더 README·`rerp/reference.md` 몫). 쓰는 법과 주제 목록은 [spec/README.md](spec/README.md).

- 새 요구가 나오면 **코드보다 먼저** 그 주제 파일에 한 줄 더한다. 뒤집히면 지우지 않고 `(철회 YYYY-MM-DD)` 를 붙이고 새 줄을 쓴다.
- 주제가 없으면 파일을 만들고 `spec/README.md` 의 목록에 더한다. 한 요구는 주된 주제 하나에 적고 다른 쪽은 `→ <주제>.md` 한 줄.
- README·커밋 메시지의 `(날짜 사용자 지정: "…")` 인용은 그대로 두되, 요구의 원본은 `spec/` 이다.
- `actions/spec/` 은 행위 명세 YAML(기계 정본)이다 — 다른 것.

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

## 설치 — 새 PC 에 올릴 때 브릿지와 KTX 까지 한 번에

사용자가 "설치"·"새 PC"·"브릿지 등록"·"KTX 환경" 을 말하면 이 차례로 간다(2026-11-06 사용자 지정: "이 워크스페이스를 설치할때 claude.md 에 브릿지랑 KTX를 설치할 수 있도록 사전정보를 줘"). 자세한 설명은 README 「로컬 CLI 연결」· `docs/ktx-bridge.md` · `/bridge` 스킬(여섯 항목 점검표).

- **미리 있어야 할 것**: Windows x64, Node.js(`node` 가 PATH 에), 크롬 또는 엣지. Claude 기능(말로 찾기·문서 읽기)은 `claude` CLI 와 `claude login` 이 더 필요하고, KTX 조회에는 필요 없다. KTX 는 uv·Python·조회 라이브러리를 `native/ktx-runtime/`(깃 제외) 안에 스스로 받으므로 시스템 Python 은 쓰지 않는다.
- **차례**: ① `chrome://extensions`(엣지는 `edge://extensions`)에 이 폴더를 압축해제 확장으로 올리고 **ID** 를 복사 ② `/bridge install` 또는 `powershell -ExecutionPolicy Bypass -File native\install.ps1 -ExtensionId <ID>` — 크롬·엣지 레지스트리 키 등록, `native\com.krs.meetingroom.json` 생성, **KTX 실행 환경(`setup-ktx.ps1`)까지 한 번에**(`-SkipKtx` 로 생략, KTX 실패는 등록을 막지 않음) ③ 브라우저 완전 재시작(엣지는 창을 닫아도 남으니 `/bridge restart edge`) ④ 패널 설정 → LLM 의 배지가 `연결됨` 인지 ⑤ `npm install`(증빙 글자 뽑기 꾸러미, 없어도 다리는 뜸).
- **확인**: `/bridge ping`(왕복) · `/bridge test`(실제 claude 호출) · `powershell -ExecutionPolicy Bypass -File native\setup-ktx.ps1 -CheckOnly`(KTX, `ok: true` 와 Python·라이브러리 버전).
- **자주 어긋나는 것**: 폴더를 옮기거나 이름을 바꾸면 확장 ID 가 바뀌므로 새 ID 로 `install.ps1` 을 다시(호스트 이름 `com.krs.meetingroom` 은 그대로). 브릿지를 등록한 **뒤에** git pull 로 KTX 코드가 들어온 PC 는 `native/ktx-runtime/` 이 없어 패널이 "KTX 실행 환경이 준비되지 않았습니다" 를 보인다 — `setup-ktx.ps1` 만 다시 돌리면 되고, 등록은 그대로라 브라우저 재시작은 필요 없다.
