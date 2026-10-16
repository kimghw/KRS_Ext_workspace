# mailtrack/ — 메일 탭(회신 추적) (Claude 가 지킬 규칙)

이 폴더는 **일부러 패널과 떨어뜨려 둔 것**이다(2026-10-15 사용자 지정: "별도 폴더에 작성합니다 … 지금 프로젝트와 가능한 분리해서 작성해 주시기 바랍니다").
무엇을 하는지·흐름·MCP 도구·한계는 [README.md](README.md).

## 경계

- **바깥에서 import 하는 것은 둘뿐이다**: `../rerp/mcp.js`(MCP Streamable HTTP 클라이언트 — `mcp/outlook.js` 만, 읽어 쓰기만. `rerp/` 는 kr_ext_rerp 의 정본 사본이라 **고치지 않는다**)와
  `../src/zip.js`(`buildZip`·`crc32` — `panel.js`·`ooxml/*`). 다른 `src/*`(특히 `src/officetext.js`·`src/evidence.js`)에 기대지 않는다. 필요한 것은 이 폴더 안에 둔다.
- **패널과 닿는 곳은 README 의 "바깥과 닿는 곳" 표에 있는 줄뿐이다**(sidepanel.html 세 곳·sidepanel.js 의 배선·manifest 의 `localhost:5001`·package.json 의 test·README 세 곳·
  test/wiring.test.mjs). 기능을 고칠 때 이 폴더 밖을 고쳐야 한다면 먼저 그것이 정말 필요한지 보고, 고쳤으면 그 표를 갱신한다. `background.js`·`sidepanel.css` 는 손대지 않는다
  (모양은 `panel.css` — `.mail` 아래와 `.tabs:has(#tabMail)` 만).
- sidepanel.js 는 `mailtrack/index.js` 의 `createMailPanel` 하나만 import 한다. 조립(무엇을 꽂을지)은 `index.js` 에서만 한다.

## import 안전

- `test/wiring.test.mjs` 가 jsdom(indexedDB·네트워크 없음)에서 `sidepanel.js` 를 통째로 import 한다. 그래서 이 폴더의 어느 파일도 **import·생성·`wire()` 시점에**
  chrome·indexedDB·fetch·DecompressionStream 을 건드리지 않는다 — 장부는 `show()`·처음 읽을 때, 금고는 처음 쓸 때, 어댑터는 처음 부를 때, 병합 모듈은 처음 병합할 때(`import()`).
- `panel.js` 는 sync·store·mcp 를 import 하지 않는다(주입받는다). `index.test.mjs` 의 첫 검사가 이것을 지킨다.

## 단위의 경계

- `model.js`·`match.js`·`block.js` 는 **순수**하다(chrome·IndexedDB·네트워크·시계 없음 — 시각은 인자로). 장부 꼴(계획서 3.2)의 이름은 바꾸지 않는다.
- `sync.js` 는 outlook·book·vault·merge 를 **주입받는다** — chrome·fetch 를 직접 부르지 않는다. `register`·`refresh`·`probe` 는 던지지 않고 결과로 말한다
  (`errors` 는 실패, `warnings` 는 된 것 중 알릴 것 — 큰 첨부 따위). 활동 로그는 **패널이 한 일마다 한 줄** 남긴다; sync 의 `log` 는 패널이 모르는 일(지우기 뒤 금고 정리 실패)에만 쓴다.
- `mcp/outlook.js` 만 도구 이름·인자를 안다. 서버 꼴이 바뀌면 여기와 `test/fixtures/graph.mjs` 를 같이 고친다(서버 소스 `E:\dev\KR_MS365_mcp` 는 읽기만).
- 메일에서 온 HTML·글은 화면 요소가 되면 안 된다 — escape 하거나 textContent 로만. 로그인 주소·메일 주소는 활동 로그에 남기지 않는다.
- 사용자의 실제 메일 주소를 코드·검사에 박지 않는다(검사는 `me@krs.co.kr` 같은 가짜 주소).

## 고친 뒤

```
node --check <고친 파일>
node --test "mailtrack/test/*.test.mjs"
node test/wiring.test.mjs        # 패널 배선(sidepanel.js 를 통째로 import)
npm test                         # 전부
```

다른 세션이 같은 작업 트리를 고치고 있을 수 있다 — `test/` 쪽 빨간 것이 이 폴더 탓인지 먼저 가린다. 커밋은 사용자가 시킬 때만.
