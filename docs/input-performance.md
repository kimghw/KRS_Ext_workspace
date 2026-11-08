# 입력과 조회 반응 개선 (2026-11-07)

출장지·행선지·장소·목적을 입력할 때 해당 칸과 관련 안내만 갱신한다. 차량 현황은 기간·받은 데이터·근무지가 바뀔 때만 다시 계산하고, 같은 차량 목록과 버튼을 유지한다. 한글 조합 중에는 파생 화면을 다시 만들지 않으며 조합이 끝나면 최종 값을 반영한다. 같은 값의 input/change 중복 처리도 줄였다. 운임 조회는 542개 구간의 선형 검색 대신 양방향 색인을 쓴다.

현재 폼의 `출장지: 대전`, `장소: 한국기계연구원`, `목적: 업무 협의` 같은 명시 입력은 `src/quickinput.js`에서 읽고 기존 입력 명세로 검증한다. 여러 항목은 줄바꿈이나 세미콜론으로 나눈다. KTX와 회의실·차량의 지원되는 단순 조회도 로컬에서 바로 읽는다. 문장에 이해하지 못한 조건이 남거나 조건이 충돌하면 기존 Claude 해석으로 넘긴다. 첨부·복잡한 요청의 해석 경로는 유지한다.

Chrome의 검증용 화면에 차량 50대·7일 현황(일별 예약 400개)을 넣고 출장지 입력 24회를 비교했다. 이벤트 처리 중앙값은 **4.3ms → 0.9ms**, 목록 교체는 **24회 → 0회**, DOM 변경은 **792회 → 12회**였다. 별도로 명시 입력·KTX·회의실 단순 조건 세 요청은 합계 약 7ms에 처리됐고 네이티브·API 호출은 0회였다. 네트워크 응답 시간은 이 수치에 포함되지 않는다. 검증 데이터는 로컬 `native/ktx-runtime/state/input-perf-comparison-20261107.json`에 보관한다.

관련 검증:

```powershell
node --test test/quickinput.test.mjs test/llm.test.mjs test/carpanel.test.mjs test/travel.test.mjs test/attend.test.mjs test/ktx.test.mjs test/ktxnlq.test.mjs test/routes.test.mjs test/wiring.test.mjs actions/test/spec.test.mjs
```

한글 조합·커서 및 버튼 유지·입력 중 중복 조회 방지·근무지 변경·날짜 변경·예약 후 재조회·운임과 기존 해석 경로를 검증했다. 확장을 새로고침하고 패널을 다시 열면 적용된다.
