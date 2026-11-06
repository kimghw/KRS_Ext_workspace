# KTX 조회 모듈과 기존 브릿지

2026-11-06 사용자 정정: binjari에서 필요한 조회 코드만 추출해 프로젝트에 포함하고, 기존 브릿지를 통해 사용한다. 기존 기능과 KTX 사이의 코드·설정 의존성을 줄이며 네이티브 호스트를 따로 만들지 않는다.

## 사용

차량 탭의 KTX 칸에서 출발·도착역, 어른 인원을 고르고 조회한다. 날짜·시작 시는 위의 날짜 줄이다.
첫 결과 페이지의 열차·좌석 상태를 패널에 표시한다. **코레일에서 계속**은 해당 조회 창을 앞으로 열며 로그인·좌석 선택·예매·결제는 사람이 한다.
조건을 바꾸면 이전 결과를 지운다. 자동 재시도·주기적 조회는 하지 않는다. **코레일 열기**는 일반 탭에서 직접 입력하는 보조 기능이다.

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

## 오류와 검증

KTX 실행 환경 누락은 `setup-ktx.ps1`, 기존 브릿지 연결 누락은 확장 ID를 지정한 `install.ps1`로 해결한다. 차단·시간 초과는 원인을 표시하고 자동 재제출하지 않는다.

```powershell
node --test test/ktx.test.mjs test/ktx-native.test.mjs test/bridge-entry.test.mjs test/ktx-install.test.mjs
native\ktx-runtime\.venv\Scripts\python.exe -I -m unittest discover -s native/ktx-python/tests -v
```

2026-11-06 사이트 실측: 부산→서울, 2026-11-12 08시, 어른 1명으로 한 번 조회했다. 조건 입력과 제출 후 코레일이 `-8202`와 “VPN 또는 데이터센터를 통해서는 서비스를 이용할 수 없습니다.” 안내를 반환했다. 실제 열차 목록 수신은 아직 검증되지 않았다. 화면과 오류 기록은 `native/ktx-runtime/state/diagnostics/`·`state/runs/guards/`에 남겨 두었다. 이번 구조 정정에서는 사이트에 재제출하지 않는다.

구조 정정 검증: 기존 등록의 `claude-bridge.bat`으로 `ping`이 이전과 같은 응답을 반환하고, KTX의 잘못된 입력·없는 조회 세션 요청도 해당 실행부에서 반환하는 것을 확인했다. 기존 기능 파일이 없는 테스트 환경에서 KTX 경로가 동작하고, KTX 파일이 없는 환경에서 기존 경로가 동작하는 검사를 포함한다.

중간 구현에서 생성했던 `com.krs.ktx`의 로컬 레지스트리 등록은 삭제 작업이 자동 승인 검토에서 거절되어 남아 있다(구체적인 사유 미제공). 현재 코드와 설치 프로그램은 이 등록을 사용하거나 생성하지 않는다. 개인 경로·확장 ID가 적힌 옛 매니페스트는 계속 Git에서 제외한다.
