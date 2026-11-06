# KTX 조회 실행부

이 폴더는 binjari에서 추출한 조회 코드와 작은 실행부를 포함합니다. 별도 binjari 프로젝트나 웹서버를 실행하지 않습니다. 기존 네이티브 호스트 `com.krs.meetingroom`의 `entry.mjs`가 KTX 요청을 `ktx.mjs`로 보내고, 고정된 전용 Python으로 `worker.py`를 실행합니다. KTX 코드에서 Claude·OCR·Git·Help 기능의 모듈·설정은 읽지 않습니다.

`../setup-ktx.ps1`은 `pyproject.toml`과 `uv.lock`으로 Python 환경만 준비합니다. 기존 브릿지 설치 프로그램도 이를 호출하며 추가 호스트 등록은 없습니다. 기존 브릿지의 Node.js와 전용 Python·브라우저 제어 라이브러리를 사용합니다. 라이브러리 내부 드라이버도 패키지와 함께 설치됩니다.

브라우저 프레임은 기존 브릿지 진입부가 처리합니다. `ktx.mjs`와 `worker.py` 사이는 표준 입력·출력의 UTF-8 JSON으로 연결하며 실행부 응답은 512KiB까지 받습니다. 패널이 기존 브릿지로 보내는 KTX 작업은 두 가지입니다.

- `{"task":"ktxSearch","input":{"from":"부산","to":"서울","date":"2026-11-12","hour":8,"adults":1}}`: 조회 작업입니다. 제한시간은 120초입니다.
- `{"task":"ktxOpen","session":"조회 응답의 토큰"}`: 해당 조회 창을 표시합니다. 제한시간은 15초입니다.

호스트는 Python·실행 파일·저장 경로·부모 프로세스 ID를 자체적으로 지정하며 확장 메시지로 바꿀 수 없습니다. 제한시간이나 출력 한도를 넘으면 해당 작업의 프로세스 트리를 종료하고 종료를 확인한 뒤 오류를 반환합니다. 실행부 로그는 별도 표준 오류 파이프로 비워 프레임에 섞이지 않게 합니다. 호스트는 자동 재시도를 하지 않습니다. 차단 안내에 대한 같은 조건 재조회(최대 2회)는 실행부 안의 binjari 조회 흐름이 합니다.

`python -I worker.py --check`는 의존성을 불러오는 것까지만 검사합니다. Chrome을 띄우거나 코레일에 요청하지 않습니다.

내부 실행부 `worker.py`는 표준 입력으로 JSON 객체 하나를 받고 표준 출력으로 JSON 한 줄을 돌려줍니다. 일반 로그는 표준 오류로 나갑니다.

```json
{"op":"search","input":{"from":"부산","to":"서울","date":"2026-11-12","hour":8,"adults":1},"stateDir":"E:/dev/kr_ext_workspace/native/ktx-runtime/state","parentPid":12345}
```

- `search`: 전용 Chrome(프로필 하나, 살아 있으면 재사용)에서 binjari 의 조회 흐름(`perform_query`)으로 조회합니다 — 폼 입력, 제출, 차단 안내 기록·닫기 뒤 같은 조건 재조회(최대 2회), 결과 목록 렌더 대기, KTX 탭. 처음 표시된 목록에서 KTX·요청 구간·시각에 해당하는 열차만 반환합니다. 매진도 표시하며 더보기·좌석 선택·예약·결제는 하지 않습니다.
- `open`: 조회 결과의 `session` 토큰을 받아 해당 탭을 앞으로 가져옵니다. 사람이 이미 예매 중이어도 페이지를 이동하거나 클릭하지 않습니다. 예: `{"op":"open","session":"조회 응답의 토큰","stateDir":"위와 같은 경로","parentPid":12345}`. `parentPid`는 실제 요청을 보낸 네이티브 브릿지 프로세스 ID이며 예시 숫자를 그대로 쓰면 요청이 취소됩니다.
- 성공은 `{"ok":true,"rows":[],"session":"..."}`이며, 실패는 `{"ok":false,"error":"...","code":"..."}`입니다. 창을 만든 뒤 실패하면 실행부의 내부 진단 응답에는 `session`도 포함하지만, 호스트가 확장에 전달하는 오류에서는 제외합니다.

전용 프로필 하나(`../ktx-runtime/state/profile`)를 사용합니다. 빈 로컬 포트를 먼저 구한 뒤 binjari처럼 **0이 아닌 포트 번호**를 Chrome에 명시합니다. `--remote-debugging-port=0`은 Chrome의 자동화 상태를 켜므로 사용하지 않습니다. 살아 있는 Chrome은 다음 조회도 같은 창의 새 탭(빈 탭이 있으면 그 탭)에서 재사용합니다(`state/browser.json`). 저장한 프로필·프로세스·실행 파일·브라우저 식별자와 실제 루프백 포트 소유 프로세스를 검증해야 다시 연결합니다. 이 방식에서는 Chrome이 `DevToolsActivePort`를 만들지 않으므로 그 파일은 이전 세션 확인에만 씁니다. 조회 창은 보이는 창으로 띄우되 초점을 가져가지 않으며, `open`은 해당 탭을 앞으로 가져옵니다. 이전 포트 0 방식으로 열린 전용 창이 살아 있으면 닫고 다시 조회하도록 안내합니다.

상태와 프로필은 `../ktx-runtime/state/`에 남습니다. 문제 화면은 그 아래 `diagnostics/`와 `runs/guards/`에 저장됩니다. 옛 구조의 조회별 프로필(`profiles/`)은 쓰지 않으므로 지워도 됩니다. 개인정보가 든 환경 파일·로그인·카드 설정은 불러오지 않습니다.

`lifecycle.py`는 Windows가 소유하는 파일 잠금으로 여러 브릿지의 조회·열기 요청을 직렬화합니다. 프로세스가 종료되면 잠금도 자동 해제됩니다. 부모 브릿지는 안정된 프로세스 핸들로 0.5초마다 감시하며, 연결이 끊기면 작업과 그 작업이 새로 만든 Chrome·드라이버를 Job Object로 함께 종료합니다. 정상 응답 전에는 Job Object의 자동 종료를 해제하여 조회 창을 남깁니다. `open`으로 연결한 기존 조회 창은 이 작업의 자식 프로세스가 아니므로 종료 대상이 아닙니다. Node는 전용 Python 본체를 `detached: true`로 실행하고 `__PYVENV_LAUNCHER__`를 고정된 venv 경로로 지정합니다. Windows venv 실행기와 Node의 자동 종료 Job이 완료된 Chrome까지 닫지 않도록 하면서 기존 venv 의존성과 작업 취소 감시는 유지합니다.

binjari 출처와 원본·포함 파일의 SHA-256은 `PROVENANCE.json`에 있습니다. `vendor/`는 조회에 쓰이는 함수·선택자만 추출한 사본입니다. `overrides/`는 연결부(`client_head` — 팝업 가드 부착, 빈 탭 재사용, 차단 코드 추출)와 한 번 조회 진입부(`search_tail` — `perform_query`, 배경 창용 간격 폴링)입니다. 차단 재조회는 binjari 원본 함수를 그대로 씁니다. 코드 추출은 실제 관측한 `-8001/-8002/-8003/-8202`를 보존하도록 보완했고, 최종 실패에도 기록한 차단 코드와 안내문을 전달합니다. `tools/update_vendor.py <binjari 경로>`는 공개 코드 파일만 읽어 추출하며 환경 파일을 읽지 않습니다. 갱신 후 코드 검토와 테스트가 필요합니다.

```powershell
native/ktx-runtime/.venv/Scripts/python.exe -I -m unittest discover -s native/ktx-python/tests -v
```

테스트는 모의 페이지·브라우저와 로컬 임시 실행부를 사용합니다. 프레임 경계·실행 경로 고정·출력 한도·제한시간·부모 종료 감시는 실제 로컬 프로세스로 검사합니다. 테스트 중 코레일에는 요청하지 않습니다.
