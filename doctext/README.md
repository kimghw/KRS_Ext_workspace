# doctext/ — 첨부에서 글자를 먼저 뽑기 (다리·브라우저 공용)

claude 에게 첨부(출장 증빙·공문 문서)를 넘기기 전에 **글자를 먼저 뽑는다** — PDF 는 pdf.js 의 글자 층을, 그림·스캔 PDF 는 Tesseract OCR 을.
글자 층이 있는 PDF 는 글자만 보내고 파일을 붙이지 않는다(토큰·시간이 준다). 그림·스캔본은 OCR 글자를 입력에 적고 파일도 붙인다
(OCR 은 표의 줄을 말없이 빠뜨린다 — 2026-10-04 표본: 그림만 67/84 · OCR 글자만 69/84 · 둘 다 76/84).

2026-10-04 에 로컬 CLI 다리(`native/doctext.mjs`)에서 먼저 만들었고, 2026-10-16 에 **API 키 길도 같게** 만들면서 셈을 `core.js` 로 뽑아 두 길이 같이 쓴다.
다리가 없는 PC(API 키만 있는 PC)도 같은 글자·같은 기록(`read`)을 본다.

## 흐름

```
패널(attendpanel.js)·공문 탭(gongmunpanel.js)·백그라운드(background.js)
   └─ src/llm.js askClaude(receipt · gongmun.*) ── 첨부가 있으면 ──▶ doctext/index.js docText(input, files)     ← 어디서 불렸든 한 진입점, 절대 던지지 않는다
                                                                       ├─ 확장 페이지(Worker 있음)     → doctext/browser.js withText  ─┐
                                                                       └─ 서비스 워커(Worker 없음)     → offscreen.html/offscreen.js ─┘→ browser.js withText
                                                                                                                                          ├─ ready()  vendor/doctext/manifest.json 이 있는가
                                                                                                                                          └─ core.withText(input, files, { pdf: pdfText, ocr: ocrImages, render: pdfPageImages })
로컬 CLI 다리(native/host.mjs extractText) ──▶ native/doctext.mjs withText ──▶ core.withText(…, { node 의 pdf.js · @napi-rs/canvas · tesseract.js })
```

| 파일 | 하는 일 |
|---|---|
| `core.js` | 순수 로직 — 무엇을 보내는가(글자만 · OCR 글자+파일 · 파일째), claude 에게 주는 문구, `read` 의 한 줄, 한도(PDF 6쪽·12000자, OCR 믿음 45, 25초). DOM 도 node API 도 없다 |
| `browser.js` | 브라우저 엔진 — pdf.js(`pdfText`·`pdfPageImages`)와 tesseract.js(`ocrReady`·`ocrImages`), 꾸러미 확인(`ready`), 진입점 `withText`. 확장 페이지·offscreen 문서에서 돈다 |
| `index.js` | 어디서 불렸든 한 진입점 `docText` — 페이지면 browser.js 를 바로, 서비스 워커면 offscreen 문서에 맡긴다 |
| `../offscreen.html` · `../offscreen.js` | 서비스 워커 대신 엔진을 돌리는 offscreen 문서 — `chrome.runtime` 메시지(`target: 'doctext'`)를 받아 browser.js 를 부른다 |
| `../native/doctext.mjs` | 다리의 node 엔진(pdf.js legacy 빌드·`@napi-rs/canvas`·tesseract.js node 워커) — 셈은 core.js 를 쓴다 |
| `../tools/vendor.mjs` | node_modules 에서 `vendor/doctext/` 로 꾸러미를 베낀다 — 아래 **꾸러미** |
| `test/core.test.mjs` · `test/browser.test.mjs` · `test/index.test.mjs` | 회귀 테스트 — `node doctext/test/<파일>` 로 하나씩, `npm test` 에도 들어 있다 |

## 브라우저 길과 다리 길 — 무엇이 같고 무엇이 다른가

같은 것(core.js 가 한다): 보내는 글의 문구, `read` 의 한 줄(`Receipt.pdf: 글자 층 312자(1쪽) — 글자만 보냄` 같은), 한도와 믿음의 문턱, 못 뽑았을 때 파일째 가는 것, 꾸러미가 없을 때의 건너뜀 문구
(`글자 뽑기를 건너뜀(…) — 파일째 보냄`).

| | 다리 (`native/doctext.mjs`) | 브라우저 (`browser.js`) |
|---|---|---|
| pdf.js | `pdfjs-dist/legacy/build/pdf.mjs` (node), cmap·글꼴은 node_modules 경로 | `vendor/doctext/pdfjs/pdf.min.mjs` + 전용 워커(`pdf.worker.min.mjs`), cmap·글꼴·wasm 은 `chrome-extension://…/vendor/doctext/pdfjs/` 에서 주 스레드가 XHR 로 받는다(`useWorkerFetch:false` — pdf.js 는 http(s) 만 fetch 로 받는다) |
| 쪽 그리기 | `@napi-rs/canvas` | DOM 캔버스(문서가 있으면) 또는 `OffscreenCanvas`, `toBlob`/`convertToBlob` 로 PNG |
| 그림 다듬기 | `@napi-rs/canvas` 의 loadImage(EXIF 를 스스로 세운다) | `createImageBitmap(blob, { imageOrientation: 'from-image' })` — 배율은 `core.ocrScale` |
| OCR | tesseract.js node 워커, 학습 데이터는 `native/tessdata/` 에 풀어 둠(`cacheMethod:'readOnly'`) | tesseract.js 웹 워커(`worker.min.js`), 코어는 `tesseract-core-simd-lstm.wasm.js`(wasm 이 js 안에 base64 로), 학습 데이터는 `.gz` 그대로 두고 워커가 푼다(`gzip:true`, `cacheMethod:'none'`) |
| 워커 수명 | 부를 때마다 띄우고 끝나면 내린다(내리지 않으면 다리 프로세스가 안 끝난다) | 페이지에 **하나**만 띄워 두고 약속 사슬로 차례로 읽힌다. 60초 동안 일이 없으면 내린다(IDLE). 한 번 부름이 25초(`OCR_LIMIT_MS`)를 넘기면 거절하고 워커를 내린다 — 다음 부름이 새로 띄운다 |
| 꾸러미 없을 때 | `import('pdfjs-dist')` 가 던진다 → host.mjs 가 건너뜀 문구로 | `ready()` 가 `manifest.json` 을 못 받으면 건너뜀 문구로(`꾸러미 없음 — 저장소 폴더에서 npm install (vendor/doctext)`). 결과는 페이지마다 한 번 외운다 |
| 바깥 망 | 나가지 않는다 | 나가지 않는다 — tesseract.js 의 CDN 기본값(`workerPath`·`corePath`·`langPath`)을 전부 확장 안 파일로 덮는다 |

## 꾸러미 — `vendor/doctext/` (12MB 쯤, `.gitignore`)

확장은 번들러 없는 순수 ES 모듈이라 node_modules 를 그대로 읽지 못하고, 확장 폴더 밖의 파일은 `chrome-extension://` 로 닿지 않는다. 그래서 node_modules 에서 베껴 둔다.
저장소에는 버전만 적히고(package.json), 파일은 PC 마다 `npm install` 이 만든다(`postinstall` → `node tools/vendor.mjs`).

```
node tools/vendor.mjs            베낀다 — 멱등(같은 파일은 다시 쓰지 않고, 목록에 없는 파일은 지운다). 끝에 베낀 수와 크기를 찍는다
node tools/vendor.mjs --check    있는지·버전이 node_modules 와 같은지만 본다 — 어긋나면 종료 코드 1
node tools/vendor.mjs --out <dir>        다른 곳에 베낀다(테스트)
node tools/vendor.mjs --modules <dir>    다른 node_modules 에서(테스트 — 없는 경우를 흉내 낸다)
```

```
vendor/doctext/manifest.json                      { pdfjs, tesseract, core, langs: ['kor','eng'], at }  ← 버전은 node_modules 의 package.json 에서
vendor/doctext/pdfjs/pdf.min.mjs · pdf.worker.min.mjs · cmaps/** · standard_fonts/** · wasm/{openjpeg.wasm, jbig2.wasm, qcms_bg.wasm, LICENSE_*} · LICENSE
vendor/doctext/tesseract/tesseract.esm.min.js · worker.min.js · tesseract-core-simd-lstm.wasm.js · LICENSE.md · tesseract-core.LICENSE · *.LICENSE.txt
vendor/doctext/tessdata/kor.traineddata.gz · eng.traineddata.gz          ← @tesseract.js-data/<lang>/4.0.0_best_int/ (LSTM 전용, 작은 것)
```

베끼지 않는 것: quickjs(`quickjs-eval.*`)·nowasm 대체본(`*_nowasm_fallback.js`), SIMD 없는 코어와 Legacy(비 LSTM) 코어, `4.0.0/`(큰 학습 데이터). 크롬은 2021년부터 SIMD 를 다 지원하고, 대체본은 CSP 가 막는 eval 을 쓴다.
2026-10-16 기준: pdf.js 6.4.299 · tesseract.js 7.0.0 · tesseract.js-core 7.0.0, 206개 파일 12.2MB.

node_modules 가 없으면 한 줄 까닭(`node_modules 에 … 이(가) 없습니다 — 저장소 폴더에서 npm install`)과 종료 코드 1. 꾸러미가 없어도 확장은 전처럼 파일째 보낸다 —
설정 → LLM 갈래의 "다리가 하는 일" 표가 `파일째 보냄 — 꾸러미 없음` 으로 알린다.

## CSP 와 offscreen 이 왜 필요한가

- **`wasm-unsafe-eval`** (manifest.json 의 `content_security_policy.extension_pages`에 `script-src 'self' 'wasm-unsafe-eval'`): MV3 의 기본 CSP 는 `WebAssembly.instantiate` 를 막는다.
  pdf.js 의 그림 해독기(openjpeg·jbig2·qcms)와 Tesseract 코어는 wasm 이다. `'unsafe-eval'` 은 MV3 가 받지 않고 필요하지도 않다 — pdf.js 에는 `isEvalSupported:false` 를 준다.
- **blob: 워커를 쓰지 않는다**: tesseract.js 는 기본으로 `importScripts(workerPath)` 를 담은 blob 워커를 띄우는데 `script-src 'self'` 가 막는다. `workerBlobURL:false` 로 같은 출처의 파일을 `new Worker` 한다.
  pdf.js 도 `workerSrc` 가 같은 출처라 그대로 `new Worker(…, { type: 'module' })` 한다(다른 출처면 blob 으로 감싸려 든다).
- **offscreen 문서** (`permissions: ["offscreen"]`): `receiptSmart` 는 백그라운드 서비스 워커(readReceipt·keepEvidence)에서도 불리는데, 서비스 워커에는 `Worker`·DOM·`createImageBitmap` 을 그릴 캔버스가 없다.
  `doctext/index.js` 가 `chrome.offscreen.createDocument({ reasons: ['WORKERS'] })` 로 `offscreen.html` 을 띄우고 메시지로 맡긴다. 90초 동안 일이 없으면 닫는다.
- 꾸러미 파일은 `web_accessible_resources` 에 넣지 않는다 — 확장 안에서만(같은 출처) 받는다.

## 실측 확인 목록 (조정자가 CDP 로 확장 페이지에서 채운다)

node 테스트는 실제 wasm 을 돌리지 않는다(node 에는 Worker·캔버스·`createImageBitmap` 이 없고, 브라우저 빌드 `pdf.min.mjs` 는 node 에서 불러오는 것부터 거절한다). 아래는 브라우저에서만 볼 수 있다.

| 확인 | 어디서 | 결과 | 날짜 |
|---|---|---|---|
| `ready()` 가 `{ ok: true, version }` — manifest.json 을 chrome-extension:// 로 받는다 | `test/cdp/doctext.mjs --page` | 됨 — pdfjs 6.4.299 · tesseract 7.0.0 · kor·eng | 2026-10-16 |
| `pdfText` — 글자 층 PDF 에서 `{ pages, total }`; 워커(`pdf.worker.min.mjs`)가 뜨고 destroy 로 내려간다 | `--page`, offscreen 문서에서 raw pdf.js 세 번 연속 | 됨 — 두 쪽 견본 `글자 층 96자(2쪽) — 글자만 보냄`, 연속 세 번 40ms 대 | 2026-10-16 |
| `pdfText` — 한글 PDF(CID 글꼴)에서 cmap 을 `pdfjs/cmaps/` 에서 받는다(네트워크 탭에 `.bcmap`, 바깥 요청 없음) | 패널 콘솔·네트워크 | **미확인** — 견본이 영문 Helvetica 뿐. 실제 한글 견적서·영수증 PDF 로 볼 것 | |
| `pdfPageImages` — 스캔 PDF 앞 3쪽이 긴 변 2200 의 PNG 로(흰 바탕) | `--page`·`--sw` | 됨(OCR 결과로 간접 — `글자 층 없음 · OCR 48자(믿음 95)`). **offscreen 문서에서는 `intent:'print'` 가 있어야 한다** — display 면 pdf.js 가 requestAnimationFrame 을 기다리는데 화면에 없는 문서라 영영 안 온다(40초 넘게 멈춤을 보고 고침) | 2026-10-16 |
| `ocrReady` — 작은 캡처는 2배, 큰 사진은 3200 으로, EXIF 로 돌아간 JPG 가 바로 선다, 못 푸는 바이트는 던진다 | 패널 콘솔 | 520px 캡처가 읽힘(2배 간접). EXIF·큰 사진·깨진 바이트는 **미확인** | 2026-10-16 |
| `ocrImages` — 워커·코어·학습 데이터를 전부 `chrome-extension://…/vendor/doctext/` 에서 받는다(네트워크 탭에 jsdelivr 없음), 한글+영문 글자가 나온다 | `--page`·`--sw` | 됨 — 영문 숫자 견본 `OCR 48자(믿음 96)`. 네트워크 탭은 안 봤다(코드가 CDN 기본값을 전부 덮고, 확장은 host_permissions 밖으로 못 나간다). 한글 글자는 **미확인** | 2026-10-16 |
| `ocrImages` — 두 번째 부름은 워커를 다시 띄우지 않는다, 60초 뒤 내려간다(`chrome://inspect` 또는 작업 관리자) | 패널 | 두 번째 부름이 빠르다(세 파일 1616ms → 872ms, offscreen 에서 그림 한 장 315ms). 60초 뒤 내려가는 것은 **미확인** | 2026-10-16 |
| CSP — `wasm-unsafe-eval` 없이는 `WebAssembly.instantiate` 가 막히는 것을 보고, 넣으면 뚫리는 것을 본다 | 콘솔 오류 | 넣은 상태로 wasm(Tesseract 코어)이 돈다. 뺀 상태는 **안 봤다** | 2026-10-16 |
| `withText` — 증빙 PDF 는 글자만(lean:true), 그림은 OCR 글자+그림, read 가 다리와 같은 문장 | `--page` | 됨 — PDF 는 첨부에서 빠지고 글자만, 그림·스캔 PDF 는 OCR 글자+파일, read 세 줄이 다리 문장과 같다 | 2026-10-16 |
| 서비스 워커 길 — `docText` 가 offscreen 문서를 띄우고 같은 결과를 돌려주며 90초 뒤 닫는다 | `--sw`(background.js 의 doctextProbe) | 됨 — 같은 세 줄, 972ms. `createDocument` 19ms, 만든 직후 보낸 첫 메시지도 닿았다(재시도 불필요). 90초 뒤 닫힘은 **미확인**(서비스 워커가 먼저 잠들면 다음 깨어남까지 남는다 — 해롭지 않다) | 2026-10-16 |
| 시간·메모리 — 영수증 사진 한 장 OCR 에 몇 초가 드는가(첫 부름·두 번째 부름), 워커 메모리 | 작업 관리자 | 세 파일(글자 PDF·그림·스캔 PDF) 첫 부름 1.6초, 두 번째 0.9초(이 PC). 메모리는 **안 봤다** | 2026-10-16 |

## 테스트

```
node doctext/test/core.test.mjs       가짜 엔진으로 core.withText 의 갈래, fromDataUrl·ocrScale·usable
node doctext/test/browser.test.mjs    가짜 fetch 로 ready, 가짜 엔진으로 withText, 가짜 createWorker 로 OCR 워커의 큐·IDLE·시간 초과, tools/vendor.mjs 를 임시 폴더에 실제로
node doctext/test/index.test.mjs      가짜 deps 로 docText 의 세 갈래와 offscreen 문서의 수명
node test/doctext.test.mjs            다리의 실제 엔진(node_modules 의 pdfjs-dist·tesseract.js·@napi-rs/canvas)
```
