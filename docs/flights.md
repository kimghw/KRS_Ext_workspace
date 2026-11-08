# 항공 조회 (2026-11-05)

차량 탭에서 날짜 줄의 시간 칸 옆 아이콘 셋(차량 · KTX · **항공권** — 목록이 아니라 단추)에서 항공권을 누르면 대한항공·에어부산을 함께 조회한다. 편도·성인 1명·일반석·직항 조건이며 날짜와 시작 시간은 패널 상단을 따른다(인원·항공사 고르기는 2026-11-05 뺐다 — 항공사는 결과 탭이 가른다). 출발/도착 시각은 각 공항 현지 시각이다. 공항 목록은 노선 취항 여부를 보장하지 않는다.

## 실측 (2026-11-05)

디버그 포트를 연 크롬(`E:\Chrome-9333` 프로필 — 평소 크롬의 복사본, `node test/cdp/ensure.mjs`)에서 두 항공사 모두 **예약 URL → 조건 확인 → 항공편 줄 읽기**까지 확인했다(김해→김포 2026-11-12·13, 성인 1). 헤드리스 fetch 나 다른 환경에서는 대한항공이 Akamai, 에어부산이 Cloudflare 확인 화면을 돌려주지만 실제 크롬 프로필에서는 두 화면 다 그대로 열린다. 다시 재는 법은 `node test/cdp/flights.mjs KE --submit` · `node test/cdp/flights.mjs BX`.

**대한항공**
- `/booking/search?bookingType=R&tripType=OW&departure=PUS&arrival=GMP&departureDate=…&adults=1&children=0&infants=0&cabinClass=Y` 는 검색 화면(`.booking-gate`)의 위젯에 그대로 실린다 — `kds-fromto_1[is-from-code][is-to-code]`·`kds-passenger_1[has-adult-number]`·`ke-kds-calendar .ui-datepicker__td.-start[id=YYYYMMDD]`·`[slot=from-date]`·여정 타입 라디오 `bookingType=OW`. 결과 화면(`/booking/select-flight/departure`)은 같은 부품을 `.ang-flight-widget` 안에 둔다(편도는 `.ang-flight-widget__aligner.-oneway`).
- 검색은 `.booking-gate__button kds-button_1`("항공편 검색") 하나 — 실제 `<button>` 은 열린 shadow root 안에 있어 그것을 누른다. 조건이 실린 바퀴에 바로 누르고, 눌리지 않으면 다음 바퀴(0.4초)에 다시(`MAX_PRESSES` 15). 위젯이 맞은 뒤에도 진행 표시("진행중 잠시만 기다려 주세요" — 본문을 aria-hidden 으로 가린다)가 1.5초쯤 남아 그동안은 눌리지 않는다 — 이 문구는 보안 확인 화면이 아니다(`잠시만 기다려` 만으로 challenge 로 잡지 않는다).
- 보이는 탭에서 잰 시간(2026-11-05): 검색 화면 열림 → 위젯 2.8초 → 진행 표시 걷힘 4.3초 → 단추 → 결과 화면(새 문서) 6.2초 → 줄 7.6초. 결과 화면 URL(`/booking/select-flight/departure?…`)을 바로 열면 홈으로 튕겨 검색 화면을 건너뛸 수 없다. 화면 읽기(pageRead) 한 번은 60ms 가 안 든다.
- **처음 방문**(새 프로필 실측)은 쿠키 안내가 뜨기까지 본문이 `visibility: hidden` 으로 30초쯤 비어 있다 — 위젯은 DOM 에 있어 조건은 맞지만 누를 수 없다(`hidden` → 기다림, 끝내 안 되면 "쿠키 안내가 뜨기까지 30초쯤" 안내). 안내창 요소(`kc-global-cookie-banner`)는 뜨기 전에도 있어(visibility 만 다르다) 그 요소로는 가리지 못한다 — 안내창이 뜬 동안만 본문이 `inert` 다.
- 결과 카드는 `li.flight-n__item` — `[role=radiogroup]` 의 aria-label("07:40 출발, 08:45 도착, 1시간 5분 소요, 직항")에서 시각을, 운임 라디오의 label 에서 일반석 특가/할인/정상·프레스티지, `₩ 86,300`, `7 석`(일부 운임에만), 매진·미운영을 읽는다. 잔여석 수는 운임마다라 합치지 않는다.
- **쿠키 안내창**(`kc-global-cookie-banner`)이 떠 있으면 본문이 `inert` 라 단추가 듣지 않는다. 동의는 사람이 고르는 것이라 누르지 않고 `안내창을 닫아야 조회할 수 있습니다` 로 끝내며, `예약 페이지에서 확인` 으로 그 탭을 앞에 두면 사람이 닫는다(한 번 고르면 그 프로필에서는 다시 뜨지 않는다).

**에어부산**
- `/web/individual/booking/flightsAvail/OW/PUS/GMP/YYYYMMDD/GMP/PUS/YYYYMMDD/0/1/0/0/N` — 서버가 경로 조각을 페이지 초기화 스크립트에 써 주고, 페이지가 도시 목록(`GET /web/bookingApi/bookingCity`)을 받은 뒤 검색 폼(`formSearchOWRT`)과 숨은 `formSearchParam`(tripType·depCity1·arrCity1·depDate1·paxCountAd …)을 채우고 스스로 `#buttonSearchAvail` 을 눌러 `POST /web/bookingApi/flightsAvail` 로 조회한다(NetFunnel 대기열도 그 흐름 안). 확장은 아무것도 누르지 않고 `formSearchParam` 과 결과 머리(`.nativeAvail[data-depcity|data-arrcity|data-depdate]`)가 조건과 같은지만 본다.
- 첫 방문에서 도시 목록 요청이 Cloudflare 403 으로 막혀 화면이 빈 채로 서거나, 화면 자체가 Cloudflare 확인("잠시만 기다려 … 사람인지 확인")으로 뜬 적이 있다(새로고침하니 200; 같은 날 저녁 새 프로필에서는 바로 200). 확인 화면은 실패가 아니라 기다림(`challenge`)이고, 화면이 다 열리고도 8초 동안 아무 일이 없으면(조건이 안 실렸든, 실렸는데 조회가 시작되지 않았든) 한 번 새로고침한다(`RELOAD_MS`). `Access Denied`·접근 제한만 바로 실패다.
- 조회는 NetFunnel 대기열을 거친다 — `BXNetFunnel_Action` 은 에이전트(`agent-lib.stclab.com/…/netfunnel-javascript-agent.js`)의 `nfStart` 가 없으면 100ms 마다 기다리기만 해, 그 스크립트가 안 실리면(광고 차단 확장 등) **조건만 실린 채 영영 조회하지 않는다**(2026-11-05 그 URL 을 막고 재현: matched true · 줄 0 · 빈 결과 아님이 그대로). 평소 크롬 패널의 "항공편 시간표와 좌석을 읽지 못했습니다" 가 이 꼴이었다 — 지금은 끝내기 전에 **페이지 세계(MAIN)에서 탐침**(`pageProbe`: 에이전트 `<script>` 유무 · `typeof nfStart` · `typeof BXNetFunnel_Action`)을 한 번 돌려 "대기열 스크립트가 끝내 실리지 않았습니다 — 광고 차단 …" / "실렸는데 조회 요청이 나가지 않았습니다" / "태그가 없습니다(구조 변경)" 로 가른다(binjari 의 코레일 조회가 차단 안내를 닫기 전에 기록하고 GuardBlocked·QueryConditionMismatch·SearchResultUnavailable 로 가르는 것과 같은 뜻 — `E:\dev\binjari\ktx_watcher\QUERY_AUTOMATION_ANALYSIS_2026-11-04.md`). 막은 화면 실측: `nfStart` undefined · `BXNetFunnel_Action` function(윈도 속성이 아닌 전역 선언이라 bare `typeof` 로만 보인다) · 줄 0; 평소: `nfStart` function · 줄 8. 대기열 창은 `.nf-vwr-popup`(`queued`, 끝내 안 끝나면 "접속 대기열이 끝나지 않았습니다").
- 서버가 조회를 거절하면 `$.bxAlert` 가 알림 층 `.lyPop.typeS`(`.lyPophead h4` "AIR BUSAN" · `.lyPopcont strong.point00` 문구 + `에러코드 : <span.errorCode>`)를 띄운다 — 그 문구를 `에어부산 안내: …` 로 돌려준다(실패). 진행 표시는 `.progressPopup`(하는 중).
- 결과 줄은 `tr[data-flightno][data-flighttime="07:10 - 08:15"]`, 운임 칸 `td.nativeFlightCls` 셋(머리글 특가·실속·일반항공권 차례)은 `label.nativeClsLabel`(라디오 + `.nativePrice` "9,900") 아니면 `마감`. 운임이 잠기면 label 에 `.disable`. **잔여석 수는 화면에 없다**(모형 `cls.avail` 에만 있고 읽지 않는다) — 열린 운임이 있으면 `예약 가능`, 다 마감이면 `매진`. 빈 결과는 `.nativeRowFlightEmpty`/`.nativeAvailEmpty`("예약 가능한 좌석이 없습니다").

## 동작

- `flightbox.js`가 **항공사마다** `flight.search` 기록 하나를 만들어 나란히 디스패처 → `actions/runners/flight.js` → `src/flights.js`로 보내고, 먼저 온 쪽부터 그린다(그동안 다른 쪽은 "조회 중…"). 한 곳이 30초를 끌어도 다른 곳의 줄이 같이 늦지 않는다(2026-11-05 사용자 지정: "대한항공 조회가 좀 많이 늦어" — 그때는 두 항공사를 한 기록으로 돌려 에어부산이 끝날 때까지 대한항공 줄도 안 보였다). 조회는 확인/결제가 없는 읽기 작업이다. 활동 로그에는 항공사마다 한 줄, 설정의 행위 명세 목록에도 항공 갈래가 있다.
- 현재 탭이 해당 항공사이고 출발·도착·날짜·인원이 일치하면 그 화면에서 조회한다. 재사용한 탭은 자동 새로고침하거나 다른 창으로 옮기지 않는다. 조건이 다르거나 다른 사이트이면 기존처럼 항공사별 공식 예약 URL을 최소화한 창에 연다. 확장 소유 탭을 재조회할 때는 이전 문서의 `performance.timeOrigin`을 기록하고 새 문서 결과만 받는다.
- URL에 조건이 실렸다는 이유만으로 성공 처리하지 않는다. 화면의 출발·도착 공항, 날짜, 인원, 편도가 전부 확인되어야 한다. 대한항공은 조건이 확인된 뒤 결과가 없으면 '항공편 검색' 하나만 누르고, 에어부산은 화면이 스스로 조회한다. 예매·예약·결제 버튼은 누르지 않는다. 그 밖의 화면은 같은 폼의 명확한 **조회/검색** 버튼 하나만 한 번 누르고, 조건이 반영되지 않으면 수동 확인 안내로 끝난다.
- 결과 위에 탭 셋 **전체 · 대한항공 · 에어부산**(2026-11-05 사용자 지정: "전체 시간별, 대한항공, 에어부산 순으로 탭을 넣어서"). 전체는 두 항공사의 줄을 출발 시각 순으로 한 목록에 섞고 줄마다 항공사 로고를 앞에 달며(2026-11-06, 아래 "항공사 로고"), 그 아래 항공사마다 확인 시각·예약 페이지 열기·공식 시간표(조회 중·실패는 그 자리에 상태). 항공사 탭은 그 항공사 줄만. 고른 탭은 저장하지 않는다. 칸 위의 안내 문구와 조건을 되풀이하던 상태 줄은 뺐다(2026-11-05 "이건 제거해줘") — 상태 줄은 조회 중·확인 필요·오류만.
- 줄은 출발 시각 순이고 상단의 시작 시간 이후 출발편만 남는다. 줄마다 출발→도착 시각·편명·운임명(그 항공편의 가장 싼 열린 일반석 운임)·운임·좌석 — 대한항공은 그 운임의 잔여석 수(없으면 `예약 가능`), 에어부산은 `예약 가능`/`매진`. 서로 다른 객실 정보, 요청 인원보다 적은 잔여석, 일부 운임만 매진인 경우에는 전체 항공편의 예약 가능/매진을 단정하지 않는다.
- 항공사별 결과와 확인 시각을 분리한다. 조건을 바꾸면 이전 결과를 지우고, 조회 중 바꾼 조건의 늦은 응답은 버린다. 한 항공사의 실패가 다른 항공사의 결과를 지우지 않는다. 접근 제한·시간 초과·구조 변경·안내창은 `좌석 확인 필요` 경로로 처리하며 매진/운항 없음으로 바꾸지 않는다.
- `예약 페이지`는 조회한 항공사 탭을 앞으로 가져온다. 찾을 수 있으면 해당 편명/출발시각의 위치로 스크롤만 한다. 항공편 선택이나 예약 확정을 대신하지 않는다. 닫힌 탭 또는 이미 넘긴 탭은 원래 조건의 URL을 새로 연다.
- 실패한 항공사에도 `예약 페이지에서 확인`과 `공식 시간표`가 남는다. 시간표 링크는 공식 스케줄의 진입 화면이다.

## 항공사 로고 (2026-11-06)

전체 탭의 줄과 항공사 머리에 이름 글자 대신 로고를 단다(2026-11-06 사용자 지정: "대한항공 부산에어 로고를 넣어줘"). `<img>` 의 `alt`·`title` 이 이름이라 글로 읽는 쪽(테스트·보조 기술)은 그대로다. 파일은 `icons/airlines/`, 경로는 `src/flights.js` 의 `AIRLINES[].logo`, 크기는 `sidepanel.css` 의 `.flight-logo`(높이만 정하고 너비는 비율대로 — 대한항공 13px, 에어부산은 물결이 글자 위에 있어 17px).
- `ke.svg` — koreanair.com 머리의 로고 SVG(`/header/header/images/logo/logo__koreanair.svg`, 2025년 새 상징, 단색 `#051766`)를 9333 크롬 안에서 받아(curl 은 Akamai 가 403) 빈 여백만 잘랐다(viewBox `5 5 195 30` — 크롬 getBBox 5.13,5.13~200,34.87).
- `bx.svg` — 공식 화면의 로고는 123×38 비트맵(`story.airbusan.com/content/assets/images/common/img_logo.png`)뿐이라 위키미디어 공용의 `Air Busan logo.svg`(단색 `#1e409a`, 글자표 로고로 퍼블릭 도메인 표시)를 쓴다.
- 어두운 화면에서는 CSS `filter` 로 흰색 단색으로 뒤집는다(두 로고 다 단색이라 모양이 보존된다). 상표는 항공사의 것이고 조회 결과에서 항공사를 가리키는 데만 쓴다.

## URL 근거

| 항공사 | 근거 | 실측 |
|---|---|---|
| 대한항공 | [공식 예약 및 관리](https://www.koreanair.com/contents/booking/book-and-manage?hl=ko)의 `/booking/search` 링크, `bookingType=R` 일반 예약 화면, `tripType`·`departure`·`arrival`·`departureDate`·인원·`cabinClass` 쿼리 | 2026-11-05 — 검색 화면에 조건이 실리고 '항공편 검색' 뒤 결과 화면을 읽었다 |
| 에어부산 | [공식 예약 진입](https://www.airbusan.com/web/individual/booking/domestic)이 `flightsAvail/RT/PUS/GMP/날짜/GMP/PUS/날짜/0/1/0/0/N`으로 이동하는 것에서 `OW` 파생 | 2026-11-05 — 서버가 조각을 초기화 스크립트에 써 주고 화면이 스스로 조회해 결과 표를 읽었다 |

공식 스케줄: [대한항공](https://www.koreanair.com/flight-status?isSchedule=T), [에어부산](https://www.airbusan.com/web/individual/booking/schedule).

## 개발 검증

`node --test test/flights.test.mjs test/flights-korean.test.mjs test/flights-ke-search.test.mjs test/flights-airbusan.test.mjs test/flightbox.test.mjs` — 입력 검사, 합성 HTML 의 의미 기반 파서와 부분 실패·문서 교체·탭 인계, 그리고 실측 DOM fixture(`test/fixtures/korean-air-*-20261105.html`·`air-busan-results-20261105.html` — 개인·세션 정보를 뺀 것)로 조건 검증·운임·매진·빈 결과·검색 단추를 본다. 행위 명세 변경 후 `node tools/gen-actions.mjs --check`와 `actions/test`, 패널 전체 배선은 `test/wiring.test.mjs`. 실사이트는 `test/cdp/flights.mjs`.

fixture 는 그날의 화면이지 지금의 좌석이 아니다. 사이트 구조가 바뀌면 `test/cdp/flights.mjs` 로 다시 재고 fixture 를 새로 뜬다.
