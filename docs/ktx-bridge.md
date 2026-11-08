# KTX 시간표 조회

2026-11-07 사용자 정정: 시간만 조회하고 코레일로 바로 이동하면 된다. 조회 경로를 확장 안의 공식 시간표 검색으로 바꿨다.

`ktxbox.js → ktx.search → src/ktx.js → src/ktxtimes.js`

조회는 운행 요일·정차역·출발 시각을 메모리에서 검색한다. 네트워크 요청, CDP, 전용 Chrome, Python, 네이티브 브릿지가 필요 없다. 결과는 열차 번호·출발/도착·소요 시간이며, 자정을 넘는 구간과 이전 날 출발한 열차의 새벽 정차를 구분한다. 코레일 바로가기는 `https://www.korail.com/ticket/search/general`을 사이드패널 옆 현재 탭에서 열고 조건 입력·예매는 사람이 한다. 현재 창에 탭이 없을 때만 새 탭을 연다.

## 시간표 출처와 갱신

[코레일 공식 시간표 게시판](https://www.korail.com/com/userBoard.do?mode=list&schBcid=ticketTable)의 [2026-11-01 시행 KTX 시간표](https://www.korail.com/file/cubedata/COMMON/jfile/202610/13/202610131a130b1ac0b200.xlsx)에서 625편을 가져왔다. 원본 주소·시행일·SHA-256은 생성물 `src/ktxtimes.js`에 보관한다. 화면에도 시행일을 표시한다. 공개 시간표이므로 임시 운행·운휴·좌석 재고는 코레일에서 확인한다. 시행일 이전 날짜는 현재 표로 조회하지 않는다.

```powershell
node tools/import-ktx-timetable.mjs
```

위 명령은 공식 게시판에서 최신 시행표를 찾아 내려받고 `src/ktxtimes.js`를 다시 만든다. XLSX 공유 문자열·정차역·시각·요일을 읽으며 모르는 운행 조건이나 표 구조는 거부한다. 이미 받은 파일은 다음처럼 가져온다.

```powershell
node tools/import-ktx-timetable.mjs <xlsx 파일> --basis YYYY-MM-DD --source <공식 XLSX 주소>
```

생성 후 관련 테스트를 실행하고 확장을 다시 불러온다. 예전 네이티브 KTX 모듈은 현재 패널에서 호출하지 않는다.

```powershell
node --test test/ktx.test.mjs test/ktx-timetable.test.mjs test/ktxnlq.test.mjs
```

검증: 위 28개 테스트와 패널 연결 553건·행위 명세 40건·명세 보기 14건이 통과했다. Chrome에서 실제 패널 컴포넌트의 조회 클릭부터 부산→서울 51편 표시까지 30ms였고, 조회 중 네트워크 요청은 0건이었다. 상단 코레일 바로가기의 목적지도 확인했다. 브라우저의 확장 관리 화면에서 확장을 새로고침하고 패널을 다시 열면 적용된다.

## 이전 브릿지 구현 기록

아래는 시간표 검색으로 바꾸기 전의 구현·진단 기록이다.

2026-11-06 사용자 정정: binjari에서 필요한 조회 코드만 추출해 프로젝트에 포함하고, 기존 브릿지를 통해 사용한다. 기존 기능과 KTX 사이의 코드·설정 의존성을 줄이며 네이티브 호스트를 따로 만들지 않는다.

## 사용

차량 탭의 KTX 칸에서 출발·도착역, 어른 인원을 고르고 조회한다. 날짜·시작 시는 위의 날짜 줄이다.
첫 결과 페이지의 열차·좌석 상태를 패널에 표시한다. **코레일에서 계속**은 해당 조회 창을 앞으로 열며 로그인·좌석 선택·예매·결제는 사람이 한다.
조건을 바꾸면 이전 결과를 지운다. 조회 흐름은 binjari 와 같다(2026-11-06 사용자 지정: "binjari 프로젝트랑 조회할떄 동일한 로직으로 진행되게 해줘" · "매크로 화면이 나오면 바로 종료됨") — 차단 안내는 기록하고 닫은 뒤 같은 조건으로 최대 2회 재조회(결과 화면의 조회 단추 또는 새로고침)하고, 결과 목록이 그려질 때까지 기다린 뒤 KTX 탭을 적용한다. 주기적 조회·더보기는 하지 않는다. **코레일 열기**는 일반 탭에서 직접 입력하는 보조 기능이다.

## 포함한 코드

`native/ktx-python/vendor/ktx_watcher/`에 binjari의 Chrome 연결·검색 폼 입력·결과 읽기·진단에 필요한 코드만 포함한다. 원본 버전과 파일 해시는 `PROVENANCE.json`에 기록한다.
실행 시 별도 binjari 프로젝트·설치 경로·웹서버에 접근하지 않는다. `tools/update_vendor.py`는 개발자가 추출본을 갱신할 때만 사용하는 도구다.
워처·자동 로그인·예약·결제·알림·실제 환경 파일이나 계정 정보는 가져오지 않는다. 설정은 조회 조건을 인자로 받는 작은 자료형으로 대체한다.

## 실행 경로와 의존성

`ktxbox.js → ktx.search 명세 → src/ktx.js → com.krs.meetingroom → native/entry.mjs`

- KTX 요청: `entry.mjs → ktx.mjs → 전용 Python → ktx-python/worker.py → 추출한 조회 코드`
- 기존 요청: `entry.mjs → host.mjs → 기존 Claude·문서·Git·Help 기능`

`entry.mjs`는 요청에 해당하는 모듈만 불러오는 작은 분배기다. KTX가 요청되면 기존 Claude 지시문·문서 처리·Git·Help 모듈을 읽지 않는다. 반대로 기존 기능에는 KTX Python 환경이 필요 없다.
브라우저 등록은 기존 `com.krs.meetingroom` 하나이며, 매니페스트의 `claude-bridge.bat` 경로도 그대로다. Node.js는 이 기존 통신부에 계속 사용한다. KTX 모듈은 Node 내장 기능과 전용 Python·조회 라이브러리만 사용한다.
Python 실행 파일·worker·저장 경로는 내부에 고정한다. 확장 메시지로 임의 명령·경로·환경 설정을 전달할 수 없다. UTF-8 JSON 응답과 일반 로그는 별도 스트림으로 처리한다.
조회 제한시간은 120초, 창 열기는 15초이며, OS 파일 잠금으로 여러 요청을 직렬화한다. 비정상 종료 시 해당 작업이 만든 자식 프로세스만 정리한다.
패널은 작업 종료 확인 시간을 포함해 조회 130초·창 열기 25초까지 기다린다.

## 설치

Windows x64·Chrome·기존 Node 브릿지를 사용한다. 새 PC에서는 기존 브릿지 설치 명령으로 등록과 KTX 환경 준비를 함께 한다.

```powershell
powershell -ExecutionPolicy Bypass -File native\install.ps1 -ExtensionId <확장ID>
```

이미 브릿지가 등록된 PC는 Python 환경만 준비하거나 검사한다. 추가 호스트 등록은 없다.

```powershell
powershell -ExecutionPolicy Bypass -File native\setup-ktx.ps1
powershell -ExecutionPolicy Bypass -File native\setup-ktx.ps1 -CheckOnly
```

KTX를 쓰지 않는 PC는 기존 설치 명령에 `-SkipKtx`를 붙일 수 있다. KTX 환경 준비에 실패하면 그 오류를 따로 안내하며 기존 브릿지의 등록과 기능을 막지 않는다. Claude CLI는 Claude 기능에만 필요하다.
첫 설치에서 고정 버전의 uv·Python·잠금 파일에 기록된 라이브러리를 받는다. uv ZIP의 SHA256을 검사한 뒤 실행한다.
실행 환경·Chrome 프로필·세션은 Git에서 제외된 `native/ktx-runtime/`에 둔다. 시스템 Python·PATH는 변경하지 않는다. PowerShell·uv는 설치·갱신 때 사용하며, 브라우저 제어 라이브러리 내부 드라이버도 함께 설치된다.

## 오류와 진단

| 상황 | 처리 |
|---|---|
| KTX 실행 환경 없음 | `setup-ktx.ps1`로 전용 Python·의존성을 준비한다. |
| 기존 브릿지 연결 없음 | 확장 ID를 지정한 `install.ps1`로 등록한다. |
| `CHROME_RESTART_REQUIRED` | 이전 포트 0 방식으로 열린 KTX 전용 Chrome 창을 닫고 다시 조회한다. |
| `CHROME_NOT_READY` | 살아 있는 전용 창이 일시적으로 응답하지 않는 상태다. 잠시 후 다시 조회한다. 실행 중인 창의 기록은 덮어쓰지 않는다. |
| `GUARD_BLOCKED` | 같은 조건 재조회 한도 뒤에도 차단됐다. 패널에 기록한 실제 차단 코드·안내문을 표시한다. |
| 실행 시간 초과 | 진행 중인 작업을 종료하고 오류를 반환한다. 호스트가 재제출하지 않는다. |

전용 Chrome은 `native/ktx-runtime/state/profile` 하나를 사용한다. 살아 있으면 다음 조회도 같은 창의 새 탭에서 하며 연결 정보는 `state/browser.json`에 저장한다. 오류 화면은 `state/diagnostics/`, 차단 코드·안내문·화면은 `state/runs/guards/`에 남긴다. 실행 환경·프로필·세션·진단 로그는 Git에 포함하지 않는다.

## 2026-11-07 차단·창 종료 수정

조회 함수 30개와 클라이언트 함수 11개를 binjari와 비교했으며, 차단 코드 추출 보완 전 함수 본문은 같았다. 실제 차이는 Chrome 실행 포트와 Windows 자식 프로세스 수명이었다.

### 원인과 조치

- binjari는 0이 아닌 디버그 포트를 명시하지만 브릿지는 `--remote-debugging-port=0`을 사용했다. [Chromium 구현](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/child/runtime_features.cc)에 따라 포트 0은 `AutomationControlled`를 켠다. 같은 설치의 빈 페이지로 `navigator.webdriver`가 포트 0에서 `true`, 명시한 비영 포트에서 `false`인 것을 재현했다. 이제 빈 포트를 구해 그 번호를 명시한다. 비영 포트는 `DevToolsActivePort`를 만들지 않으므로 저장한 프로필·PID·실행 파일·브라우저 GUID와 Windows TCP 포트 소유자를 검사한다. 살아 있는 전용 창이 일시적으로 응답하지 않으면 재실행하거나 연결 기록을 덮어쓰지 않는다.
- Windows venv 실행기와 Node/libuv는 자식 프로세스에 자동 종료 Job을 붙인다([CPython 3.12.12](https://github.com/python/cpython/blob/v3.12.12/PC/launcher.c), [libuv](https://github.com/libuv/libuv/blob/v1.x/src/win/process.c)). 실행부의 안쪽 Job만 해제해도 바깥 Job이 Chrome을 종료했다. 전용 Python 본체를 직접 `detached: true`로 실행하고 CPython의 `__PYVENV_LAUNCHER__`로 기존 venv를 선택한다. 작업 도중 부모가 종료되거나 제한시간을 넘으면 기존 종료 감시가 작업을 정리한다.
- 차단 코드 추출에서 빠졌던 `-8001/-8202`를 보존하고, 반복 실패에도 기록한 실제 차단 코드·안내문을 패널까지 전달한다.

### 실사이트 검증

조건은 **부산→서울, 2026-11-08 09시, 어른 1명**으로 유지했다.

| 검사 | 결과 |
|---|---|
| 수정 전 | 첫 제출 `-8002`, 재조회 두 번 모두 `-8001`. 보이는 창에서도 동일했다. |
| 실행 방식 수정 후 | 첫 `-8002` 뒤 같은 조건 첫 재조회로 **KTX 10편** 수신, 약 37초. `-8001` 재발 없음. |
| 실제 브릿지 경로 재검증 | `entry.mjs`의 네이티브 메시지 프레임으로 다시 조회해 10편 수신, 약 39초. 같은 Chrome PID·브라우저 GUID 재사용. |
| 조회 호스트 종료 후 열기 | 별도 `ktxOpen` 요청이 `ok: true`. 기존 결과 화면 유지. |

요청 구간·날짜·인원을 결과 화면에서 검증했고 첫 열차는 09:05 KTX-산천 022편이었다. **첫 `-8002`는 여전히 관측됐으며, binjari와 같은 재조회 흐름으로 회복한 결과**다. 수정 전에는 2026-11-06 다른 날짜의 조회에서 `-8202`(VPN·데이터센터 이용 제한)도 관측했다.

로컬 검증 기록은 `state/query-fixed-20261107.log`·`.json`, `state/query-final-20261107.json`, `state/query-open-20261107.json`이다.

### 회귀 테스트

Node **54개**, Python **37개**, 총 **91개** 통과. 패널·메시지 프레임·설치·binjari 추출본 해시·오류 코드·포트 소유권·정상/오류 응답 뒤 호스트 종료 시 창 유지·진행 중 호스트 종료 및 시간 초과 시 자식 프로세스 정리를 검증했다.

```powershell
node --test test/ktx.test.mjs test/ktx-native.test.mjs test/bridge-entry.test.mjs test/ktx-install.test.mjs test/ktxnlq.test.mjs
native\ktx-runtime\.venv\Scripts\python.exe -I -X utf8 -m unittest discover -s native/ktx-python/tests -v
```

기존 `claude-bridge.bat`의 `ping` 응답도 유지한다. 기존 기능 파일이 없는 환경의 KTX 경로와 KTX 파일이 없는 환경의 기존 경로를 각각 검사한다. 이전 독립 호스트 `com.krs.ktx` 등록이 남아 있어도 현재 코드와 설치 프로그램은 이를 사용하거나 생성하지 않는다. 개인 경로·확장 ID가 적힌 옛 매니페스트도 Git에서 제외한다.

## 2026-11-07 새로고침 시간 초과 수정

차단 뒤 재조회와 빈 목록 재조회에서 `Page.reload: Timeout 20000ms exceeded`가 그대로 반환되는 경로를 수정했다. 새로고침은 새 문서 응답(`commit`)을 기다린 뒤 목록·열차 없음·안내창 렌더를 확인한다. 응답 자체가 오지 않으면 이전 행을 읽지 않고 한국어 오류를 반환한다. 조회 조건 검증과 재시도 횟수 제한은 유지하며, `overrides/search_retry.py.txt`와 추출 도구에 변경을 반영해 vendor 갱신 후에도 보존한다.

Node 54개·Python 44개, 총 **98개** 테스트 통과. 로컬 Chrome에서 지연 스크립트로 `DOMContentLoaded`가 끝나지 않는 상황을 재현했고, 수정한 대기는 목록·빈 결과·안내창을 모두 인식했다. 실제 네이티브 프레임 조회 응답도 확인했으며, 검증용 부산→대전 **2026-11-13 07시, 어른 1명** 탭의 같은 조건 새로고침은 **2.5초**에 KTX 10편을 반환했다. 검증 기록은 Git에서 제외되는 `state/query-reload-20261107.json`, `state/reload-live-verification-20261107.json`, `state/reload-local-regression-20261107.json`에 있다.
