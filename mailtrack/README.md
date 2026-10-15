# mailtrack/ — 메일 탭(회신 추적)

KRS WORKSPACE 사이드패널의 **메일** 탭. 내가 보낸 메일을 등록해 두면 받는 사람·참조를 조직(도메인)마다 "받을 곳" 으로 세우고, 받은 메일에서 회신을 찾아
**N/M** 으로 세며, 회신의 본문·첨부를 한곳에 모으고, 양식(xlsx·docx)으로 받은 회신을 한 파일로 합친다.

> 2026-10-15 사용자 지정(원문): "별도 폴더에 작성합니다. 근태---------------현황에서 메일수신 기능을 추가 합니다. mcp 를 이용해야하고.. 내가 보낸 메일에서 받는사람
> 참조자 또는 메일주소가 도메인이 같은 경우 이를 식별해서 등록 해줍니다. 같은 도메인 메일 수신이 보낸 거랑 같으면 완료하는데 이 숫자를 관리해 줍니다. 물론 어떤 메일을
> 내가 등록할지는 등록 기능이 있어야 겠죠. 그렇면 메일 내용과 첨부파일을 한 곳에 관리해 줍니다. docx 파일이나 excel 양식으로 작성을 요청한 경우 받아서 병합까지 할 수 있는
> 기능을 추가 합니다... 멀티에이전트로 구성해 주세요.. 지금 프로젝트와 가능한 분리해서 작성해 주시기 바랍니다."

그래서 이 폴더는 **패널과 떨어져 있다** — 바깥에서 읽어 쓰는 것은 `../rerp/mcp.js`(MCP 클라이언트)와 `../src/zip.js`(ZIP 쓰기·CRC)뿐이고, 패널과 닿는 곳은 아래 **바깥과 닿는 곳** 몇 줄뿐이다.
Claude 가 지킬 규칙은 [CLAUDE.md](CLAUDE.md). 쓰는 법(사람 눈높이)은 저장소 README 의 `## 메일 탭`.

## 흐름

```
[KR_MS365_mcp Outlook :5001] ──rerp/mcp.js(읽어 쓰기만)── mcp/outlook.js  (도구 이름·인자·응답 정규화, 오류 → kind)
   등록: mail_query_url(보낸 편지함) → mail_query_if_emaidID(상세·제목) → mail_attachment_meta(본문·첨부 목록) → mail_attachment_download(save_file:false, 인라인 바이트)
   갱신: test_handler(받은 메일 — 없으면 mail_fetch_filter) → match → 새로 이어진 회신만 mail_attachment_meta·download
        ▼
 sync.js  (오케스트레이션 — outlook·book·vault·merge 를 주입받는다, 던지지 않는 register/refresh)
   ├─ model.js  장부 꼴·받을 곳(expectOf)·N/M(statusOf)·양식 가리기·조회 창(sinceOf)·병합 출처(sourceOf)      (순수)
   ├─ match.js  회신 분류(reply·auto·ndr·self)·점수(0~3)·잇기(matchAll)·수동 덮어쓰기                        (순수)
   ├─ store/book.js   chrome.storage.local["mailtrackBook"] — 읽기·쓰기·줄 세운 update
   └─ store/vault.js  IndexedDB "krsMailtrack" — 본문(bodies)·첨부 바이트(files), 처음 쓸 때 연다
        ▼
 panel.js (+ panel.css)  #mail 안에 화면을 만든다 — 머리 칩·등록 대화·N/M 목록·상세·양식 병합·zip·설정. sync 를 주입받는다
        ▼
 ooxml/{zipread,xml,xlsx,docx,merge}.js  양식 + 회신 첨부들 → 한 파일 (sync.mergeFiles 가 처음 병합할 때 import)

 index.js  위를 조립한다: createMailPanel(deps) = panel(sync(outlook, book, vault)) — sidepanel.js 가 import 하는 유일한 파일
```

## 파일

| 파일 | 하는 일 |
|---|---|
| `index.js` | 조립. `createMailPanel(deps)` → `{ wire, show, hide, reload, state }`. 검사용 바꿔 끼우기 `deps.storage`·`deps.vaultBackend`·`deps.fetch`·`deps.merge`·`deps.now`(모두 생략 가능). sync 의 기록은 `logEvent('mail', …)` 로 |
| `panel.js` · `panel.css` | 화면(모든 id·class 는 `mt` 접두). 메일 본문 HTML 은 태그를 떼어 **글자로만**(`htmlToText` → textContent), 메일에서 온 글은 전부 escape. 내려받기는 `chrome.downloads`(없으면 `<a download>`) |
| `sync.js` | `probe`·`listSent`·`register`·`refresh`·`remove`·`expect`·`link`·`unlink`·`review`(수락/거부)·`counted`(= review 의 옛 이름)·`close`·`bodies`·`files`·`fetchServerCopy`·`mergeFiles`·`settings`·`book`·`load` |
| `model.js` | `normalizeBook`·`expectOf`·`newItem`·`statusOf`·`sinceOf`·`sourceOf`·`templateKind`·`normalizeSubject`·`domainOf`, `REVIEW_STATES`(pending·accepted·rejected) |
| `match.js` | `classify`·`keyOf`·`scoreOf`·`matchAll`(opts.autoCount)·`applyReplies`·`setExpect`·`linkReply`·`unlinkReply`·`setReview`·`setCounted`(= setReview) |
| `mcp/outlook.js` | `createOutlook({ url, userEmail, fetch })` → `probe`·`run(api => …)`(세션 하나에 여러 도구)·`listSent`·`fetchDetails`·`fetchInbox`·`attachmentMeta`·`downloadAll`·`saveOnServer`, `describe(e)` |
| `store/book.js` · `store/vault.js` | 장부(줄 세운 `update`, `onChange`) · 금고(`idbBackend`·`memoryBackend`, `putBody`·`putFile`·`bodies`·`files`·`removeItem`·`usage`) |
| `ooxml/zipread.js` · `xml.js` · `xlsx.js` · `docx.js` · `merge.js` | ZIP 읽기(store·deflate, CRC·크기·항목 수 한도) · XML 손질 · 엑셀 병합 · 워드 병합 · 입구(`mergeKind`·`mergedName`·`mergeOffice`) |
| `test/` | 아래 **검사** |

## 메일 화면

- **회신 추적**에서 진행 중·완료 건수, Outlook 연결 상태, 마지막 갱신 시간을 확인하고 **메일 등록**으로 보낸 메일을 고른다. 연결 도구 수와 갱신 상세 건수는 각 상태의 툴팁에 있다.
- 상세는 제목·받는 사람·회신 진행률, **수신처별 회신**, **보낸 메일 · 첨부**, **받은 회신** 순서다. 수신처는 좁은 사이드패널에서도 주소와 버튼이 겹치지 않는 카드형 행으로 표시한다.
- 첨부는 파일 아이콘·전체 이름·용량·내려받기로 구분한다. 회신 카드의 칩은 종류(회신·후보·자동 회신·배달 실패·대상 아님) 옆에 **확인 상태**(확인 필요 · 수락 · 거부)가 서고,
  저절로 센 것은 **집계됨**. 단추 **수락**(센다 — 받을 곳 완료)·**거부**(세지 않는다 — 받을 곳은 다시 기다림, 병합 칸에서는 잠긴 줄)는 지금 상태가 아닌 쪽만 보인다.
  머리의 요약과 목록의 메일 줄에 **확인 필요 n** 이 선다(닫은 메일은 빼고).
- **본문·첨부 모두 받기**로 ZIP을 저장한다. **추적 관리**를 펼치면 추적 끝내기·등록 지우기가 나온다. 삭제는 기존처럼 두 번 눌러 확인한다.
- 상세 진입·목록 복귀 시 키보드 포커스를 옮기며 본문 접기 버튼과 진행률에는 접근성 정보를 붙인다. 스타일은 `panel.css`의 `.mail` 범위에 둔다.

## MCP 도구와 서버 소스에서 확인한 것 (2026-10-15, `E:\dev\KR_MS365_mcp` 읽기만)

| 쓰임 | 도구 | 보내는 것 |
|---|---|---|
| 보낸 메일 목록 | `mail_query_url` | `url: …/me/mailFolders/sentitems/messages?`, `filter_params.received_date_from/to`, `top: 100` |
| 상세(받는 사람·참조·대화 id·본문) | `mail_query_if_emaidID` | `message_ids`(50개씩) |
| 본문 + 첨부 목록 | `mail_attachment_meta` | `message_ids`(50개씩) |
| 첨부 바이트(인라인) | `mail_attachment_download` | 메일 id 목록(10개씩) + `save_file:false, include_body:false, convert_to_txt:false, skip_duplicates:false` |
| 큰 첨부(서버에 저장) | `mail_attachment_download` | `[{message_id, attachment_id}]` + `save_file:true, storage_type:'local', save_directory:'downloads/mailtrack'` |
| 받은 메일(갱신) | `test_handler` | `filter_params{received_date_from, is_draft:false}`, `client_filter.exclude_from_address:[나]`, `select_params`, `top: 500` |
| 받은 메일(대체) | `mail_fetch_filter` | 같은 거르기, `exclude_params` — **최대 50건**(top 이 노출되지 않음) |

- **`mail_query_url` 은 subject 를 주지 않는다** — 서버가 `$select` 를 internal 고정 5필드(id·createdDateTime·receivedDateTime·bodyPreview·from)로 박는다. 그래서 등록 대화의
  목록은 같은 세션에서 `mail_query_if_emaidID` 를 한 번 더 불러 제목(과 받는 사람·참조)을 채운다(서버가 subject 를 주게 되면 그 부름은 저절로 빠진다).
- **`attachment_contents` 에는 첨부 id 가 없다**(메일 id·`original_name` 뿐, 인라인 그림도 섞여 온다) → 첨부 목록과 **메일 id + 이름**(같은 이름은 Graph 차례)으로 짝지어 붙인다.
- **큰 파일은 인라인으로 오지 않는다**(`$expand=attachments` 가 contentBytes 를 안 준 것은 서버가 조용히 건너뜀) → `missing` 으로 표시하고 화면의 `서버에 저장`(첨부 id 쌍 경로 —
  `save_file` 과 상관없이 늘 서버 PC 디스크에 저장하고 `file_path` 만 돌려줌)으로 받는다. 등록·갱신 결과에는 **주의(warnings)** 로 알린다(오류 아님).
- **`test_handler` 는 `user_email` 을 버린다**(spec 에 없는 인자) → 받은 메일은 늘 서버 기본 사용자(auth.db)의 것. 설정의 `내 메일 주소` 는 다른 도구에만 실린다.
- `test_handler`·`mail_fetch_filter` 는 `/users/{me}/messages` = **모든 폴더**(보낸 편지함·임시보관함 포함)를 읽는다 → 임시보관·나를 서버와 어댑터 양쪽에서 거른다.
- 인증이 풀리면 `{status:'auth_required', auth_url}`(목록 조회) 또는 "access token"·"토큰 획득 실패"·`no_authenticated_user`(상세·첨부) — `describe` 가 모두 `kind:'auth'` 로 모으고, `auth_url` 이 있으면 머리의 `열기` 가 로그인 창을 연다.
- 서버는 `http://localhost:5001/mcp`(Streamable HTTP, CORS 없음) — manifest `host_permissions` 의 `http://localhost:5001/*` 로 부른다. 설정의 MCP 주소는 localhost·127.0.0.1 만 받는다.

## 받을 곳·회신·완료 규칙

1. **받을 곳(expectOf)** — To → CC 차례로 주소를 소문자로 모으고 나·빈 주소를 뺀다. 도메인 ≠ 내 도메인이면 키 `foo.com`(같은 도메인 여러 명은 `addresses` 로 한 키).
   내 도메인이면 `ownByAddress`(기본 켬)일 때 **주소마다** `addr:x@krs.co.kr`, 끄면 도메인 키. 첫 등장 차례. 나(`book.me`)는 첫 등록 때 보낸 메일의 보낸 주소.
2. **분류(classify)** — 보낸 사람이 나 → `self`(버림). postmaster·mailer-daemon·no-reply·bounce·`MicrosoftExchange…` 또는 배달 실패 제목 → `ndr`. 자동 회신·부재 중·out of office 제목
   또는 `Auto-Submitted: auto-*` → `auto`. 나머지 `reply`.
3. **점수(scoreOf)** — **보낸 때보다 먼저 받은 메일은 무조건 0**(같은 대화라도 앞선 글이지 답이 아니다 — 내가 `Re:` 로 답한 메일을 등록하면 상대가 먼저 보낸 메일이 같은
   conversationId 로 잡혀 곧바로 완료가 됐다, 2026-10-15 실제 메일함 실측. 두 시각 다 Exchange 가 찍은 것이라 여유는 두지 않는다). 그 다음 3: conversationId 같음 또는
   In-Reply-To/References 에 보낸 메일의 internetMessageId. 2: 머리표(`RE:`·`FW:`·`회신:`·`[외부]`·`[EXTERNAL]` …)를 뗀 제목이 같고 보낸 사람이 받을 곳에 있음.
   1: 받을 곳에 있고 나에게 왔고 제목에 보낸 제목이 들어 있음. 0: 버림.
4. **잇기(matchAll)** — 메일 하나는 항목 하나에만(점수 높은 것, 같으면 그 전에 보낸 가장 늦은 항목). 이미 어느 항목에든 이은 id 는 건너뛴다(닫은 항목 것도).
   점수 ≥ 2 인 `reply` → 셈(`counted`, 받을 곳이 없으면 "대상 아님"), 점수 1 → `candidate`, `auto`·`ndr` → 저장만(사람이 `수락` 으로 바꿀 수 있다).
   새로 이어진 회신은 모두 `review: 'pending'`(확인 필요). 설정 `requireAccept` 를 켜면(`matchAll` 의 `autoCount:false`) 사람의 답도 세지 않고 수락을 기다린다.
5. **완료** — `expected` = 제외 아닌 받을 곳 수, `responded` = 그중 완료, `done = expected > 0 && responded === expected`. 센 회신의 키는 완료(누가·언제).
   손으로 정한 것(`완료로 표시`·`제외`)은 `manual` 이라 새로고침이 되돌리지 않는다 — `되돌리기`·`포함` 이 표시를 풀고 회신대로 다시 센다.
   **수락/거부(setReview)** — 2026-10-15 사용자 지정 "받은거 accept 할지 거부할지". `accepted` 는 센다(키가 없으면 보낸 사람으로 찾고, 후보는 `reply` 로), `rejected` 는 세지 않되
   키는 남긴다(어디서 온 답이었는지) — 그 받을 곳의 유일한 센 회신이었으면 수동 아닌 받을 곳은 다시 `open`. 둘 다 `manual`·`reviewedAt`. 거부한 메일 id 는 이미 이은 것이라 다음 갱신이
   다시 잇지 않고, 그 사람이 다시 보내면 새 회신으로 선다. `연결`(linkReply)도 수락이다. `pending` 으로 되돌리는 길은 없다(수락↔거부로만 바꾼다).
6. **조회 창(sinceOf)** — 열린 항목(닫지 않고 완료 아님)의 보낸 때(이미 한 번 훑었으면 `syncedUntil`) 중 가장 이른 것 − 1시간, 단 `windowDays`(기본 90일)보다 앞으로는 가지 않는다.
   열린 항목이 없으면 조회하지 않는다. 잇기에는 닫지 않은 모든 항목을 준다(완료 뒤 온 회신도 붙게). 패널 머리의 공용 새로고침(`reload`)은 `force` — 완료 항목도 보낸 때부터 다시 훑는다.
7. **언제** — 새로고침 단추 · 탭을 열 때(마지막 갱신이 `autoRefreshMin`(10분)보다 오래됐고 서버가 살아 있고 열린 항목이 있으면) · 등록 직후 · 공용 새로고침. 백그라운드 알람은 없다.

## 저장

- **장부** `chrome.storage.local["mailtrackBook"]` — `{ v:1, me, settings:{ mcpUrl, userEmail, sentDays, windowDays, ownByAddress, useHeaders, autoRefreshMin, requireAccept }, items, syncedUntil, lastSync }`.
  항목은 보낸 메일 하나(받을 곳·회신 메타·첨부 메타·양식·상태·닫음). 회신에는 `review`(pending·accepted·rejected)·`reviewedAt` — 없는 옛 회신은 `pending` 으로 선다.
  패널을 열 때마다 통째로 읽으니 바이트는 넣지 않는다. 고치기는 `book.update` 의 줄에 서서 하나씩.
- **금고** IndexedDB `krsMailtrack` v1 — `bodies`(키 `항목\u0001메일`), `files`(키 `항목\u0001메일\u0001첨부`), 둘 다 index `itemId`. 증빙 보관함의 `krsWorkspace`(v1)와 **따로** —
  같은 DB 에 스토어를 더하면 그쪽이 VersionError 로 깨진다. 등록을 지우면 그 항목의 본문·첨부도 지운다.

## 양식 병합

보낸 첨부 중 `.xlsx`·`.docx` 가 양식(`templates`)이다. 상세의 **양식 병합** 칸에서 양식과 같은 종류의 회신 첨부를 골라(기본 전부) 합친 파일을 내려받는다 — 이름 `제목_병합_YYYYMMDD.xlsx|docx`.

- **xlsx** — 시트마다 머리 행 수(자동: 첫 비지 않은 행부터 이어진 행 + 모든 회신이 양식과 똑같이 둔 행, 또는 1~5행)를 정하고, 회신의 같은 이름 시트(없으면 같은 차례)에서
  머리 뒤의 사람이 쓴 행을 차례로 쌓는다(양식과 똑같은 행은 건너뜀). 마지막 머리 행 오른쪽에 **출처** 열(`받을 곳 · 이름 <주소> · 날짜`).
- **docx** — `쌓기`(기본): 회신마다 출처 문단 + 본문, 사이에 쪽 나눔. `표 행 합치기`: 양식의 최상위 표마다 머리 행 아래에 회신마다 출처 행 + 회신의 같은 표의 행.

**한계** (병합 결과에서 알고 쓸 것):

- 워드: 그림·개체(drawing·pict·object)는 `[그림 생략]` 글로 바뀌고, 글상자는 글만 남는다(`[글상자] 글`). 메모·각주·미주 참조·책갈피·내용 컨트롤 꾸밈은 지운다.
  구역 설정은 **양식의 마지막 sectPr 하나만**(회신의 쪽 방향·여백·머리글은 따라오지 않는다). 변경 내용 추적(삽입·삭제 표시)은 그대로 남는다.
  회신은 양식의 사본이라 **스타일·번호 id 가 같다고 본다** — 다르면 Word 가 기본 스타일로 보인다.
- 엑셀: 회신 칸의 서식 번호(`s`)는 회신의 `cellXfs` 수가 양식과 같을 때만 남긴다(다르면 서식 없이). 합친 시트의 **표(tableParts·xl/tables)와 calcChain 은 지운다**(보고서에 주의).
  **수식은 버리고 캐시 값만**, 서식 있는 글(rich text)은 맨 글로. 조건부 서식·데이터 유효성·이름 정의·인쇄 영역은 손대지 않는다 — 행이 늘어 아래로 밀려도 범위는 양식 그대로다.
  숨긴 시트·합칠 행이 없는 시트는 양식 그대로 복사한다.
- 형식: 옛 `.xls`·`.doc`, 매크로·서식 파일(`.xlsm`·`.xlsb`·`.xltx`·`.docm`·`.dotx` …)은 합치지 못한다 — 병합 칸에 잠긴 줄로 "지원하지 않는 형식(.xls) — xlsx 로 저장해 다시 받아 주세요".
  암호·DRM 이 걸린 파일·깨진 파일은 보고서의 `건너뜀` 에 까닭과 함께.
- 결과는 **압축하지 않은(store) ZIP** 이다(`src/zip.js`) — Word·Excel 은 그대로 열지만 파일이 원본보다 크다. 서버가 인라인으로 주지 않은 큰 첨부는 금고에 없어 합칠 수 없다.

## 바깥과 닿는 곳 (이 폴더 밖에서 고친 줄 — 이것뿐)

| 파일 | 무엇 |
|---|---|
| `sidepanel.html` | `<link rel="stylesheet" href="mailtrack/panel.css" />`, 탭 단추 `#tabMail`(R&D 뒤), `<section id="mail" class="mail hidden">`(`.controls` 앞) |
| `sidepanel.js` | `import { createMailPanel } from './mailtrack/index.js'`, `el.tabMail`, `isMail`·`isPanelTab`, `const mail = createMailPanel({...})`, `load()` 의 `mail.reload()`, `applyMode` 의 탭·제목·`mail.show/hide`, `mail.wire()`, 복원할 모드 목록의 `'mail'` |
| `manifest.json` | `host_permissions` 의 `http://localhost:5001/*` (`downloads` 권한은 이미 있음) |
| `package.json` | `npm test` 에 `"mailtrack/test/*.test.mjs"` |
| `README.md` | `## 메일 탭` · `## 구조` 의 한 줄 · `## 테스트` 의 한 줄 |
| `test/wiring.test.mjs` | 메일 탭 클릭 리스너 두 줄, 탭 차례(`근태 · 공문 · R&D · 메일 · 회의실 · 차량 · 현황`) |

## 검사

```
node --test "mailtrack/test/*.test.mjs"   # 아홉 파일 — npm test 에도 들어 있다
node mailtrack/test/<파일>.test.mjs        # 하나만
```

| 파일 | 무엇 |
|---|---|
| `mcp.test.mjs` | 어댑터 — 가짜 Streamable HTTP 서버(`fixtures/mcpfake.mjs`, Graph 꼴 원본 `fixtures/graph.mjs`)로 도구 이름·인자·정규화·첨부 짝짓기·큰 파일 missing·auth/notool/offline |
| `model.test.mjs` · `match.test.mjs` | 받을 곳·N/M·조회 창·출처 · 분류·점수·잇기·수동 덮어쓰기 |
| `sync.test.mjs` | 등록(한 세션·주의/오류 나누기)·갱신(창·새로 이어진 것만·던지지 않음)·수동 조작·지우기·서버에 저장·병합 호출 — 기록은 금고 정리 실패만 |
| `store.test.mjs` | 장부의 줄 세우기·onChange, 금고(메모리·가짜 IndexedDB) |
| `xlsx.test.mjs` · `docx.test.mjs` | 병합 — 검사용 Office 바이트(`fixtures/office.mjs`)와 패키지 검사(`checkPackage`) |
| `panel.test.mjs` | 화면 — 흉내 sync 로 칩·등록 대화(주의는 흐린 한 줄)·목록·상세·병합(지원하지 않는 형식 줄)·zip·설정·오류 |
| `index.test.mjs` | 조립 — import·만들기·`wire()` 만으로는 chrome·indexedDB·fetch 를 건드리지 않음, 진짜 모듈 + 가짜 MCP 서버로 등록 → 갱신 → 병합(진짜 xlsx) → 서버에 저장, 한 일마다 기록 한 줄 |

`test/wiring.test.mjs` 는 jsdom(indexedDB·네트워크 없음)에서 `sidepanel.js` 를 통째로 import 한다 — 이 폴더의 어느 파일도 import·생성 시점에 chrome·indexedDB·fetch·DecompressionStream 을 건드리면 안 된다.

## 살아 있는 서버로 확인한 것 (2026-10-15 오후, 서버를 켠 뒤 — 장부·금고는 메모리, 확장 저장소는 건드리지 않음)

- `tools/list` 에 열두 도구가 다 오고 머리 칩이 `연결됨 · 도구 12개`. 등록 대화가 30일치 보낸 메일 26건을 보인다.
- `mail_query_url` 은 정말 `subject` 없이 온다(`@odata.etag, id, createdDateTime, receivedDateTime, bodyPreview, from`) → 상세(`mail_query_if_emaidID`)로 채워진다. 기간 거르기가 보낸 편지함에 먹는다.
- 첨부 — `mail_attachment_meta` 의 목록과 인라인 바이트가 짝지어지고(docx 두 개, ZIP 머리 `504b0304`), 받은 메일(`test_handler`, `client_filter`·`is_draft`·`select_params`·`top`)은 임시보관·내 메일 없이 온다.
- 끝-끝 — 보낸 메일 셋을 등록(외부 도메인 1곳 · gmail 1곳 · 사내 주소별 4곳)하고 `force` 갱신: 받은 메일 419건에서 conversationId 로 회신 3건을 잇고 본문·첨부 7개(16MB, pptx·pdf·zip 포함)를 금고에 넣었다.
  사내 4곳 중 1곳만 답해 `1/4 진행 중`, gmail 은 `1/1 완료`. 회신의 docx 를 양식과 `stack` 으로 합친 파일은 `[Content_Types].xml` 이 첫 항목이고 XML 파트가 모두 잘 짜였다(그림 2개는 `[그림 생략]`).
- **실측으로 고친 것** — 내가 `Re:` 로 답한 메일을 등록하자 상대가 **먼저** 보낸 메일(같은 conversationId, 2분 25초 전)이 회신으로 잡혀 곧바로 완료가 됐다 → `scoreOf` 가 보낸 때보다 먼저 받은
  메일을 여유 없이 0 으로 가른다(3절 3).

아직 못 본 것: 로그인이 풀렸을 때의 `auth_url` 칩(목록)과 토큰 오류 칩(상세·첨부) · 같은 이름 첨부 둘의 짝짓기 · 서버가 인라인으로 주지 않는 큰 파일의 `서버에 저장` 경로 · 병합한 파일을
Excel·Word 로 실제로 열어 보기(XML 은 잘 짜였지만 화면은 보지 않았다).
