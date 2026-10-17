# recipes/gongmun — 공문 레시피와 새 종류·양식 더하기

공문 탭이 만드는 품의·신고서·요청서의 **정본**이다 — 어떤 양식(eclass FORMID)에 어떤 목적(구매·교육·출장·구매의뢰·외부활동)이 있고, 목적마다 초안의 칸·읽는 법(Claude 에게 가는 인라인 프롬프트)·
제목·본문 틀·첨부·위임전결·문서설정이 무엇인지. 확장은 YAML 을 못 읽어 `node tools/gen-gongmun.mjs` 가 `src/gmrecipe.js`(RECIPE)로 옮기고, 패널·`src/gongmun.js`·`src/gmwrite.js` 는 그 생성물만 본다.
쓰임새와 화면은 [README.md 의 공문 탭](../../README.md#공문-탭), 행위 명세(공문 작성 기록의 꼴)는 [actions/README.md](../../actions/README.md).

```
registries/                 모든 목적에 같이 가는 것
  delegation.yaml           위임전결(rule_key → 기준·전결권자·근거)   settings.yaml  문서설정(프로파일·부서 코드·선택지·부서 수신처 receivers)
  reading.yaml              문서 읽기의 공통 지시문                  writing.yaml   사유 쓰기의 공통 지시문
  vars.yaml                 틀의 공통 자리({부서}·{과제명} …)         setup.yaml     공문 설정 채우기(화면에서 뺀 보존 경로 — 머리말)
<유닛>/forms/<폼>/
  manifest.yaml             form_id(FORMID)·label·order·purposes(목적 차례 = 화면의 갈래 차례)·only(이 폼을 고를 수 있는 목적)
  fieldmap.yaml             새 공문 창의 칸 지도 — 제목·과제 피커·본문 편집기, 칸이 정해진 폼이면 source: draft 칸마다, 표가 있으면 rows 절
  purposes/<목적>/
    purpose.yaml            이름·rule_key·document_setting·limit·account·project(false 면 과제를 고르지 않음)·fields(칸마다 from·read·write·example)·reads·reading·quote_crop·writing
    body_spec.yaml          제목·본문 틀과 자리(vars·lists)
    attach_rules.yaml       첨부 문서(doc·ask·more·need·parts·who)
```

유닛은 `research-form`(연구업무추진품의 KR_EA_Research_Task — 구매·교육·출장) · `purchase-order`(구매요청서 KR_Purchase_Order — 구매의뢰, 총무팀 수신, 칸이 정해진 폼에 표 둘 — 2026-10-17) ·
`outside-report`(외부강의등 신고서 KR_Outside_Lecture_Report — 외부활동, 칸이 정해진 폼) · `draft-form`(기안문 KR_EA_Form2 — 목적 없음, 본문 틀만 넣는 양식).
유닛 폴더는 생성기가 훑어 찾는다 — 따로 등록표는 없다. 갈래 차례는 manifest 의 `order`(research-form 1 · purchase-order 2 · outside-report 3), 폼 안에서는 `purposes` 차례다.

## 생성물과 검사

```
node tools/gen-gongmun.mjs            # recipes/gongmun → src/gmrecipe.js   (--check 는 어긋났는지만, --prompt <목적>[ reason] 은 지시문 전문)
node tools/gen-actions.mjs            # actions/spec → actions/spec.js      (공문 종류 YAML 이 레시피의 목적과 같은지도 여기서 본다)
node test/gongmun.test.mjs && node --test "actions/test/*.test.mjs" && node test/gmlist.test.mjs && node test/wiring.test.mjs
```

생성기가 막는 것: 근거 없는 전결권자, 없는 규정·프로파일·칸, 읽지 않는 칸의 `read`, 꼴이 틀린 `example`, 틀에 없는 `{이름}`, 없는 초안 칸을 가리키는 칸 지도,
`source: draft` 를 text·date·time·check 가 아닌 칸에 적은 것, `on` 없는 시각·체크 칸, 칸이 정해진 폼(`rows` 가 있는 폼도)에 `only` 가 없는 것(다른 갈래의 양식 칸에 서서 빈 양식이 된다),
같은 목적이 두 폼에 있는 것, `rows` 의 `cell` 에 `{nn}`·`{cell}` 이 없거나 `from` 이 reads 의 목록·item 키(행 `from` 이 없으면 목적의 칸)가 아닌 것, `settings.receivers` 의 키가 `options.receiver` 에 없거나 `code` 가 숫자 글이 아닌 것.

## 새 목적(갈래) 더하기 — 예: 연구업무추진품의에 회의비 품의 `meeting`

레시피가 패널의 갈래 단추·읽기 작업·제목·본문 틀·위임전결·문서설정·첨부·예산 비교·`src/gongmun.js` 의 KINDS·FIELDS·writePlan 을 **저절로** 늘린다. 손으로 더하는 것은 아래뿐이다.

| 차례 | 어디 | 무엇 |
|---:|---|---|
| 1 | `research-form/forms/research_task/purposes/meeting/purpose.yaml` | `purpose_id: meeting`·label·title·`rule_key`(delegation.yaml 의 키 — 없으면 거기 규정과 근거를 더한다)·`amount_field`·`document_setting`(settings.yaml 의 프로파일)·limit·account·`fields`(칸마다 `from`, 문서에서 읽는 칸은 `read`·`example`, 사유 칸은 `from: write`·`write`)·`reading.docs`·(있으면) `reads`·`writing.context`. 꼴은 `purchase/purpose.yaml` 머리말 |
| 2 | 같은 폴더 `body_spec.yaml` | 제목·본문 틀과 `vars`(틀의 {이름} ↔ 초안 칸). 공통 자리는 `registries/vars.yaml` |
| 3 | 같은 폴더 `attach_rules.yaml` | `doc`·`ask`·`more`·`need`·`parts`(읽기가 가린 종류 → 첨부 이름)·`who`(첨부 파일 이름에 붙일 칸) |
| 4 | `research_task/manifest.yaml` | `purposes` 에 `meeting` — **이 차례가 화면의 갈래 차례**다(보통 outside 앞) |
| 5 | `node tools/gen-gongmun.mjs` | `src/gmrecipe.js` 다시 만들기. 틀리면 무엇이 틀렸는지만 말하고 끝난다 |
| 6 | `actions/spec/gongmun/meeting.yaml` | `edu.yaml` 을 본떠 — id·title·summary·`preset.project`(과제를 고르는 갈래)·`preset.kindTitle: { from: recipe:purposes.meeting.title }`·`fields`(공통 칸은 `{ from: domain }`, 초안 `draft: { from: recipe }`)·`llm.tasks`(`gongmun.meeting`, 사유 칸이 있으면 `gongmunReason.meeting`)·runner·uses·next |
| 7 | `actions/spec/gongmun/_domain.yaml` | `kinds` 에 레시피와 **같은 자리**로 더한다 — 다르면 생성기가 막는다 |
| 8 | `node tools/gen-actions.mjs` | `actions/spec.js` 다시 만들기 |
| 9 | `src/gmlist.js` `KIND_RE` | 공문 이력의 갈래 가르기 — 제목의 말(예: `/회의비/`)을 새 갈래로 옮기고 차례(구체적인 것이 앞)를 맞춘다. 지금은 회의비가 구매의 말에 들어 있다 |
| 10 | 테스트 | 갈래 수를 박아 둔 곳 — `test/gongmun.test.mjs`(KIND_ORDER·label·project·기본 폼·whoOf·REASON_KEYS), `actions/test/runners-gongmun.test.mjs`(행위 ID 목록), `test/gmlist.test.mjs`(분류), `test/wiring.test.mjs`(갈래 단추 목록), `test/host.test.mjs`·`test/llm.test.mjs`(읽기 작업 이름) |
| 11 | 문서 | `README.md` 공문 탭의 "갈래는 … 다섯" 같은 셈, `actions/README.md`·`docs/actions-design.md` 의 "공문 5종" |

조건부 — 새 칸 이름이 `gist`·`summary`·`mode`·`place`·`provider` 면 구매의 요약 줄·교육의 교육 구분(온라인 판정)이 그 칸에 걸린다(`src/gongmun.js` mergeDraft·패널 renderFields) — 다른 이름을 쓰거나 그 코드에 갈래 조건을 더한다.
`from: auto` 칸(코드가 다른 칸으로 셈하는 것)과 `reads` 의 값을 초안에 옮기는 일은 YAML 로 생기지 않는다 — `src/gongmun.js` 의 `FILL[목적]` 에 작은 함수를 더한다(구매의 품목 표·외부활동의 누적·구매의뢰의 500만원 비교견적서 알림이 그렇다).
저절로 채우는 칸(외부활동 `outsideAuto`, 구매의뢰 `orderAuto` — 수요시기 오늘+14·특기사항·계정과목명·첨부 안내문구)과 다른 갈래의 초안에서 옮겨 오는 것(구매 → 구매의뢰 `orderFromPurchase`)도 거기 둔다.
견적서 오리기는 `purpose.yaml` 에 `quote_crop` 을 두면 된다.

## 새 양식(폼) 더하기 — 구매요청서 `KR_Purchase_Order` 가 이 차례로 들어왔다(2026-10-17 — 유닛 `purchase-order`, 그 폼만의 목적 `order` 구매의뢰)

2026-10-17 사용자 지정("kr-weg-agent 에 보면 총무팀에 구매요청서 작성하는게 있거든 … 구매의뢰 하는 공문기능을 추가해줘. 그 의뢰서는 구매공문과 연동되어야 하고, 우측 하단에
구매의뢰하기 버튼을 넣던지, 구매할때 같이 작성할 수 있던지")으로 더한 유닛이 본보기다 — 원본은 `krs-web-agents` 의 `ea_recipes/purchase-order`(계정·I/O 코드를 대조하던
`ea_data/registries/ea_accounts.yaml`·`ea_projects.yaml` 은 가져오지 않았다 — 계정과목코드·I/O 코드·I/O 명·예산금액·납품장소는 사람이 적는다). 위 차례에 더해:

| 차례 | 어디 | 무엇 |
|---:|---|---|
| 0 | 실측 | 새 공문 창(`DocumentView.aspx?FORMID=KR_Purchase_Order` — `test/cdp/cdp.mjs` 로 읽기만. 2026-10-17 HER-2026-000700 임시 문서, 저장 안 함)에서 칸의 selector·Telerik control(수요시기 `…dtpEDate`)·상신 전 검사(`formSubmit(submitType, isValidate, flowStatus)` — 구매대상구분 하나 이상·사업내용·예산유형 하나·수요시기·납품장소·특기사항 여섯. Page_Validators 없음)·행추가 포스트백(`LinkButton1`·`LinkButton2` → `__doPostBack`, 페이지에 `RadAjaxManager1` 이 있어 부분/전체 포스트백 — 행 수를 폴링)·숨은 줄(`display:none` 인 계정과목·예상기간·구매가능 거래처 — 넣지 않는다)·수신처 창의 부서 값(총무팀 `10820`·`(A13) General Affairs Team`)을 본다. 작성기(`src/gmwrite.js`)가 넣을 줄 아는 칸은 아래 kind 표와 `rows` — 그 밖(선택 상자 …)이 있으면 작성기부터 늘린다 |
| 1 | `purchase-order/forms/kr_purchase_order/manifest.yaml` | `working_unit_id: purchase-order`·`label: 구매요청서`·`form_id: KR_Purchase_Order`·`order: 2`(신고서는 3 으로 밀었다)·`purposes: [order]`·**`only: [order]`**(칸이 정해진 폼은 꼭 — 생성기가 막는다) |
| 2 | 같은 폴더 `fieldmap.yaml` | `anchor`(틀이 떴는지 보는 칸 — 사업내용 `SaUpNeYong`)·제목(`source: title`, max 99)·칸마다 `source: draft`(`from` 초안 칸, 비면 `default`, 숫자만이면 `digits`, 시각은 `on` 이 날짜 칸, **체크는 `on` 이 켤 값**)·표는 **`rows` 절** — 아래 |
| 3 | `purposes/order/` 셋 | 위와 같다. 본문 편집기가 없는 폼이라 `body_spec.yaml` 의 body 는 공문 탭에 보이는 **미리보기**다(외부활동처럼). `from: auto` 칸(수요시기·특기사항·첨부 안내문구)과 `from: setup` 칸(계정과목명 — 과제의 계정)은 `src/gongmun.js orderAuto` 가 채운다. `rule_key` 는 구매와 같은 `연구비집행` 준용(구매요청서만의 규정 행을 찾지 못함 — 주석에 적음), `limit: null`(500만원 이상이면 비교견적서가 든다고 알리기만 — `FILL.order`), `document_setting: 구매요청` |
| 4 | `registries/settings.yaml` | 프로파일 `구매요청: { retention: '36', receiver: 총무팀 }`(보존 3년은 새 구매요청서 창의 기본값), `options.receiver` 에 `총무팀`, 부서 수신처 **`receivers`** — 아래 |
| 5 | `actions/spec/gongmun/order.yaml` | `purchase.yaml` 을 본떠(과제를 고르니 `project`·`lead`·`refs` 를 둔다) — `form` 은 통째로(기본값 `KR_Purchase_Order`), `body` 는 `when: form!=KR_Purchase_Order`(편집기 양식으로 바꿨을 때만 본문). 과제를 고르지 않는 폼이면 `outside.yaml` 을 본뜬다 |
| 6 | 실측 | `node test/cdp/gmwrite.mjs --kind order --head <부서장> --project <과제명> --new`(dry) — 시험 초안 `ORDER_DRAFT`(품목 2줄·예산 1줄·[시험] 글·수요시기 오늘+14)는 스크립트에 있다. 다른 폼이면 `OUTSIDE_DRAFT`·`ORDER_DRAFT` 처럼 그 폼의 것을 더한다 |

이미 패널이 폼 이름으로 말하는 곳(본문 칸의 "<폼>에 넣을 칸 (미리보기)", 작성 차례의 "<폼> 칸")은 저절로 따라오고, 공문 이력은 `only` 가 하나인 폼을 그 갈래로 바로 가른다
(구매요청서 → 구매의뢰. 제목의 말 `구매 요청`·`구매 의뢰` 는 `KIND_RE` 맨 앞 — 구매의 말보다 먼저 본다).
구매 품의와 잇는 두 길(구매 갈래의 `구매의뢰 작성` 단추, 공문 이력 구매 카드의 `구매의뢰` 단추 — 선행 품의 문서번호·제목이 `sourceDoc`·`sourceTitle` 로)은 패널이 `orderFromPurchase` 로 초안을 옮기는 것이라 레시피에는 없다.

### 칸 지도의 kind

| kind | 어디에 | 꼭 있어야 하는 것 | 작성기(`src/gmwrite.js pageForm`)가 하는 일 |
|---|---|---|---|
| `title` | 제목 칸(새 공문 창 공통 — `#ctl00_ApplineInfoInReportKRTA1_txtDocTitle`) | `selector`·`max`(99) | 제목을 잘라 넣는다 |
| `text` | 글 칸 · textarea(`value` 로 넣는다) | `selector`·`source: draft`·`from`(비면 `default`, 숫자만이면 `digits`) | value 를 넣고 다시 읽어 ok |
| `date` | Telerik RadDatePicker | `control`·`from` | `$find(control).set_selectedDate` |
| `time` | Telerik 시각 피커 | `control`·`from`·`on`(날짜 칸 key — 그 날에 시각을 얹는다) | 같은 길 |
| `check` | 체크박스(구매대상구분 다섯 `GuMeDeSang_0..4`·예산유형 둘 `YesanType_0..1` — 2026-10-17) | `selector`·`source: draft`·`from`(초안 칸 하나)·`on`(고를 값 — `PC류`·`국가수탁과제` …) | 초안 값(글이나 목록)이 `on` 과 같으면 `'1'` 로 계획에 들어가 `el.click()` 으로 켠다(체크박스는 click 이 값과 이벤트를 같이 낸다 — 합성 이벤트를 따로 보내지 않는다). 같지 않으면 빈 값이라 건드리지 않는다(= 체크 안 함). 작성 기록의 "비어 넣지 않은 칸" 셈은 같은 `from` 을 보는 체크 가운데 하나라도 켜졌으면 빈 것이 아니다 |

`source: draft` 는 text·date·time·check 에만. `on` 은 time(날짜 칸 key)과 check(고를 값)에 쓴다.

### 표 — fieldmap 의 `rows` 절

이름마다 `add`(행추가 단추 — href 가 `javascript:__doPostBack(…)` 이라 `.click()` 안에서 포스트백이 돈다)·`probe`(행 수를 세는 selector)·`cell`(셀 selector 틀 — `{nn}` 은 두 자리 행 번호(01 부터), `{cell}` 은 셀 suffix)·`cells`(셀 suffix → `{ from, digits? }`):

```yaml
rows:
  items:            # 구매 물품 표 — 행 단위 from 이 있으면 초안의 그 목록(reads 의 items) 줄마다 한 행. cells 의 from 은 그 목록의 item 키
    from: items
    add: '#ctl00_ContentPlaceHolder_Content_LinkButton1'
    probe: "input[id^='ctl00_ContentPlaceHolder_Content_rptRequet_ctl'][id$='_txtItemName']"
    cell: '#ctl00_ContentPlaceHolder_Content_rptRequet_ctl{nn}_{cell}'
    cells:
      txtItemName:   { from: name }
      txtFuncAndReq: { from: spec }
      txtUnit:       { from: unit }
      txtCnt:        { from: qty, digits: true }         # digits — 수를 쉼표 없는 자리수 글로(Math.round)
      txtUnitCost:   { from: unitPrice, digits: true }
      txtEstimate:   { from: amount, digits: true }
  budget:           # 예산 내역 표 — 행 단위 from 이 없으면 초안의 평평한 칸으로 한 행. cells 의 from 은 목적의 fields 키
    add: '#ctl00_ContentPlaceHolder_Content_LinkButton2'
    probe: "input[id^='ctl00_ContentPlaceHolder_Content_rptRequetBudget_ctl'][id$='_txtSubjectCode']"
    cell: '#ctl00_ContentPlaceHolder_Content_rptRequetBudget_ctl{nn}_{cell}'
    cells:
      txtSubjectCode:  { from: subjectCode }
      txtSubjectName:  { from: subjectName }
      txtDeptOrIoCode: { from: ioCode }
      txtDeptOrIoName: { from: ioName }
      txtBudgetCost:   { from: budgetAmount, digits: true }
```

생성기는 `rows` 를 `RECIPE.forms[폼].rows` 로 내고, `writePlan` 이 `plan.rows = [{ key, add, probe, cell, rows: [{ <셀 suffix>: <글> }, …] }]` 로 편다(빈 셀은 빼고, 셀이 모두 빈 행은 뺀다).
작성기는 open 다음 **표(품목·예산)** 단계에서(글 칸보다 먼저 — 행추가 포스트백이 틀을 다시 그릴 수 있다) 표마다 행 수(`probe`)를 보고 모자라면 `add` 를 누른 뒤 행 수가 늘 때까지 400ms 씩 폴링하고
(15초 — 원본 `formfill.py` 는 400ms×25. 포스트백 중 executeScript 가 실패하면 삼키고 다시), 행이 다 서면 셀을 글 칸처럼 넣고 다시 읽어 ok. 새 창에는 처음부터 빈 행이 하나(ctl01) 있다.
행이 안 늘면 그 표는 실패로 적고 다음 표로 간다. `plan.rows` 가 없거나 모든 표의 행이 0 이면 단계를 아예 적지 않는다(다른 폼의 작성 기록이 바뀌지 않게). 예산금액 합계(`YeSanGmEk`)는 건드리지 않는다.
생성기가 막는 것: `cell` 에 `{nn}`·`{cell}` 이 없는 것, 행 `from` 이 이 폼의 모든 목적의 `reads` 에 있는 목록 키가 아닌 것, `cells` 의 `from` 이 그 목록의 item 키(행 `from` 이 없으면 목적의 fields 키)가 아닌 것.
`rows` 가 있는 폼도 칸이 정해진 폼이라 `only` 가 있어야 한다.

### 문서설정의 부서 수신처 — `settings.yaml` 의 `receivers`

문서설정 창(DocumentSetting.aspx)의 `SetReceiverValue(retValue)` 는 `'<code>-,-<text>'`(여럿이면 `^` 로 잇는다)를 받아 hfReceiversCode/hfReceiversText 와 수신처 목록에 넣는다.
내부결재·KRE 는 값과 글이 이름 그대로라(`'내부결재-,-내부결재'` — 수신처 창의 내부결재 단추와 같다) 적지 않고, 부서는 `receivers` 에 수신처 고르기 창(SelectReceiver.aspx)의 부서 목록 값과 글을 둔다 —
키는 `options.receiver` 에 있어야 하고 `code` 는 숫자 글, `text` 는 비지 않은 글(생성기 검사):

```yaml
receivers:
  총무팀: { code: '10820', text: '(A13) General Affairs Team' }   # 2026-10-17 실측(부서 목록 69개 — 연구지원팀 18970 (A53) R&D Support Team, 재무팀 10911 (A12) Finance Team)
```

작성기(`docSettingOf` 의 `receiverValue`)는 `RECIPE.settings.receivers[receiver]` 가 있으면 `${code}-,-${text}`, 없으면 `${receiver}-,-${receiver}` 를 넣는다. 수신처가 있으면 문서설정 확인 때
발송경고("…선택된 수신자 (총 N 팀)에게 즉시 발송됩니다. 저장하시겠습니까?")가 뜨고 작성기가 '예'(`__Page_FormSubmitCallback(2)`)로 지난다 — 내부결재와 같은 길이다.

## 고칠 때

- 값(`read`·`write`·`rules`·`example`·`context`)은 그대로 Claude 에게 가는 지시문이다 — `#` 주석은 사람만 본다. 고친 뒤 `node tools/gen-gongmun.mjs --prompt <목적>` 으로 전문을 본다.
- 사람 이름(부서장·소장·본부장)은 여기 두지 않는다 — 패널의 공문 설정(저장소)에만.
- 2026-10-17 Codex 검토로 더한 것: 생성기의 `source: draft`·`only` 검사, 행위 명세의 `kinds` ↔ `RECIPE.order` 검사와 공통 칸(`actions/spec/gongmun/_domain.yaml fields`), 공문 이력의 폼 → 갈래 가르기, 패널의 갈래 리터럴 제거(PICK_FIRST·비교작성 제목·기본 갈래).
