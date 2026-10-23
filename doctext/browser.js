// 브라우저(확장 페이지·offscreen 문서)에서 첨부의 글자를 먼저 뽑는 엔진(2026-10-16) — PDF 글자 층은 pdf.js, 그림·스캔본은 tesseract.js OCR.
// 다리(native/doctext.mjs)의 node 엔진을 브라우저로 옮긴 것이다. 무엇을 보내는가(글자만·OCR 글자와 파일·파일째)의 셈은 core.js 가 하고,
// 여기는 엔진 셋(pdf·render·ocr)과 꾸러미 확인(ready)만 둔다 — 그래서 claude 에게 가는 글과 read 의 한 줄이 다리와 같다.
//
// 가져오기만 해서는 chrome·document·Worker 를 만지지 않는다 — node 테스트가 가져온다. 엔진 꾸러미(vendor/doctext — tools/vendor.mjs 가
// node_modules 에서 베낀다)는 쓸 때 import() 한다. 서비스 워커에서는 돌지 않는다(Worker 가 없다) — 거기서는 doctext/index.js 가
// offscreen 문서에 맡긴다. 바깥 망에는 나가지 않는다 — tesseract.js 의 CDN 기본값(workerPath·corePath·langPath)을 전부 덮는다.
//
// 경로는 new URL('../vendor/doctext/...', import.meta.url) 로 만든다 — chrome.runtime.getURL 없이 node(file:)와 확장(chrome-extension:)
// 둘 다 된다. 확장 안의 주소는 pdf.js 의 isValidFetchUrl(http·https 만)에 걸리지 않아 주 스레드 XHR 로 받는다 — useWorkerFetch:false 를 명시한다.

import { withText as coreWithText, tidy, ocrScale, PDF_MAX_PAGES, SCAN_PAGES, SCAN_SIDE, OCR_LIMIT_MS, OCR_LANGS } from './core.js';

/** 꾸러미 폴더(끝에 / 있음). manifest.json 이 있으면 꾸러미가 있는 것이다. */
export const VENDOR_URL = new URL('../vendor/doctext/', import.meta.url).href;
/** 꾸러미가 없을 때의 까닭 — 설정 화면(다리가 하는 일)과 read 의 건너뜀 문구에 그대로 들어간다. */
const NO_VENDOR = '꾸러미 없음 — 저장소 폴더에서 npm install (vendor/doctext)';
/** OCR 워커를 띄워 둔 채 일이 없으면 이만큼 뒤에 내린다 — 학습 데이터(4MB 쯤)를 다시 풀지 않게 잠깐 두되, 패널을 켜 둔 내내 메모리를 잡지는 않게. */
const IDLE_MS = 60_000;

// ---- 꾸러미 확인 ----------------------------------------------------------------------------------------------------------

/** ready 의 약속 — 페이지마다 한 번만 받아 본다(동시에 둘이 불러도 한 번). */
let readiness = null;

/**
 * 꾸러미(vendor/doctext)가 있는지 manifest.json 을 받아 본다. 결과는 외워 둔다 — 없는 꾸러미는 npm install 과 다시 불러오기 전에는 생기지 않는다.
 * 던지지 않는다. node 에서는 fetch 가 file: 을 받지 못해 ok:false 가 된다(테스트는 fetchFn 을 끼운다).
 * @param {{ fetchFn?: Function }} [deps]
 * @returns {Promise<{ ok: boolean, reason: string, version?: object }>} version 은 manifest 그대로({ pdfjs, tesseract, core, langs, at })
 */
export async function ready({ fetchFn = globalThis.fetch } = {}) {
  readiness ||= probe(fetchFn);
  return readiness;
}

/** ready 가 외운 것을 잊는다(테스트). */
export function resetReady() {
  readiness = null;
}

async function probe(fetchFn) {
  if (typeof fetchFn !== 'function') return { ok: false, reason: '이 환경에서는 꾸러미를 확인할 수 없음(fetch 없음)' };
  let res;
  try {
    res = await fetchFn(`${VENDOR_URL}manifest.json`);
  } catch {
    return { ok: false, reason: NO_VENDOR };
  }
  if (!res?.ok) return { ok: false, reason: NO_VENDOR };
  try {
    const version = await res.json();
    if (!version || typeof version !== 'object' || !version.pdfjs || !version.tesseract) throw new Error('manifest.json 의 모양이 다름');
    return { ok: true, reason: '', version };
  } catch (err) {
    return { ok: false, reason: `꾸러미가 깨짐(${String(err?.message || err).slice(0, 80)}) — 저장소 폴더에서 npm install (vendor/doctext)` };
  }
}

// ---- 캔버스 ----------------------------------------------------------------------------------------------------------------

/** 흰 바탕의 캔버스 — 문서가 있으면(확장 페이지·offscreen 문서) DOM 캔버스, 없으면 OffscreenCanvas. 투명한 PNG 는 OCR 이 검게 읽는다. */
function whiteCanvas(width, height) {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  let canvas;
  if (typeof document !== 'undefined' && document.createElement) {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
  } else {
    canvas = new OffscreenCanvas(w, h);
  }
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  return { canvas, ctx };
}

/** 캔버스를 PNG 바이트로 — OffscreenCanvas 는 convertToBlob, DOM 캔버스는 toBlob. */
async function pngBytes(canvas) {
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('캔버스를 PNG 로 만들지 못함'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// ---- PDF (pdf.js) ------------------------------------------------------------------------------------------------------------

/** PDF 를 연다(pdf.js). 다 쓰면 close 로 닫는다 — 닫지 않으면 워커가 남는다. */
async function openPdf(bytes) {
  const { getDocument, GlobalWorkerOptions } = await import('../vendor/doctext/pdfjs/pdf.min.mjs');
  GlobalWorkerOptions.workerSrc = `${VENDOR_URL}pdfjs/pdf.worker.min.mjs`;
  // pdf.js 는 받은 바이트를 가져가 버린다(워커로 옮긴다) — 베낀 것을 준다(스캔본이면 같은 바이트로 한 번 더 연다).
  const task = getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: `${VENDOR_URL}pdfjs/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${VENDOR_URL}pdfjs/standard_fonts/`,
    wasmUrl: `${VENDOR_URL}pdfjs/wasm/`,
    // chrome-extension:// 은 pdf.js 의 isValidFetchUrl(http·https 만)에 걸린다 — 워커가 아니라 주 스레드(XHR)가 cmap·글꼴·wasm 을 받는다.
    useWorkerFetch: false,
    // MV3 CSP 는 eval 을 막는다 — pdf.js 가 글꼴 프로그램을 eval 로 돌리려 들지 않게.
    isEvalSupported: false,
    verbosity: 0,
  });
  return { doc: await task.promise, close: () => task.destroy().catch(() => {}) };
}

/**
 * PDF 의 글자 층을 쪽마다 뽑는다(pdf.js). 줄 바꿈은 pdf.js 가 가린 것(hasEOL)을 따른다 — 다리의 pdfText 와 같은 셈.
 * @param {Uint8Array} bytes
 * @returns {Promise<{pages: string[], total: number}>} pages 는 앞에서 PDF_MAX_PAGES 쪽까지, total 은 문서의 쪽 수
 */
export async function pdfText(bytes) {
  const { doc, close } = await openPdf(bytes);
  try {
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, PDF_MAX_PAGES); i++) {
      const { items } = await (await doc.getPage(i)).getTextContent();
      pages.push(items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('').trim());
    }
    return { pages, total: doc.numPages };
  } finally {
    await close();
  }
}

/**
 * 스캔한 PDF 의 앞쪽 SCAN_PAGES 쪽을 긴 변 SCAN_SIDE 픽셀의 PNG 로 그린다 — OCR 에 넘길 그림이다.
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array[]>}
 */
export async function pdfPageImages(bytes) {
  const { doc, close } = await openPdf(bytes);
  try {
    const out = [];
    for (let i = 1; i <= Math.min(doc.numPages, SCAN_PAGES); i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: SCAN_SIDE / Math.max(base.width, base.height) });
      const { canvas, ctx } = whiteCanvas(viewport.width, viewport.height);
      // intent 는 print 다 — display 면 pdf.js 가 그리기 단계를 requestAnimationFrame 으로 잇는데, offscreen 문서(서비스 워커 길)는 화면에 없어
      // 그 프레임이 영영 오지 않아 멈춘다(2026-10-16 CDP 실측: 사이드패널에서는 되고 offscreen 에서만 40초 넘게 안 끝났다). print 는 바로 잇는다.
      await page.render({ canvasContext: ctx, canvas, viewport, intent: 'print' }).promise;
      out.push(await pngBytes(canvas));
    }
    return out;
  } finally {
    await close();
  }
}

// ---- OCR (tesseract.js) ------------------------------------------------------------------------------------------------------

/**
 * OCR 이 읽기 좋게 그림을 다듬는다 — 작은 그림(화면 캡처)은 두 배로 키우고, 큰 사진은 줄이고(core.ocrScale), 투명한 바탕은 희게 채운다.
 * 돌려 찍은 사진(EXIF)은 createImageBitmap 이 바로 세운다(imageOrientation: 'from-image') — 여기서 또 돌리지 않는다.
 * 풀 수 없는 그림이면 던진다 — 엔진을 띄우기 전에 걸린다.
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>} PNG 바이트
 */
export async function ocrReady(bytes) {
  const blob = new Blob([bytes]);
  let img;
  try {
    img = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (err) {
    // 'from-image' 를 모르는 오래된 크롬은 TypeError 를 낸다 — 그때만 옵션 없이 다시(기본값이 이미 EXIF 를 따른다). 못 푸는 그림은 그대로 던진다.
    if (!(err instanceof TypeError)) throw new Error(`풀 수 없는 그림(${String(err?.message || err).slice(0, 80)})`);
    img = await createImageBitmap(blob).catch((e) => { throw new Error(`풀 수 없는 그림(${String(e?.message || e).slice(0, 80)})`); });
  }
  try {
    const scale = ocrScale(img.width, img.height);
    const { canvas, ctx } = whiteCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await pngBytes(canvas);
  } finally {
    img.close?.();
  }
}

/**
 * tesseract.js 에 주는 옵션 — CDN 기본값을 전부 덮는다(바깥 망에 나가지 않는다).
 *  - workerPath·corePath: 확장 안의 파일. corePath 가 js 로 끝나면 tesseract.js 가 그 파일을 그대로 importScripts 한다(SIMD 가 없는 기기는 안 본다 — 2021년 이후 크롬은 다 있다).
 *  - langPath: 끝에 / 없음(tesseract.js 가 `${langPath}/${lang}.traineddata.gz` 로 잇는다). gzip:true 는 .gz 를 받아 워커가 푼다.
 *  - workerBlobURL:false — MV3 CSP 가 blob: 워커를 막는다. 같은 출처의 파일로 new Worker 한다.
 *  - cacheMethod:'none' — IndexedDB 캐시를 쓰지 않는다(파일이 이미 확장 안에 있다).
 *  - errorHandler: 빈 처리기 — 주지 않으면 tesseract.js 는 엔진이 실패를 알릴 때 약속을 거절하고 나서 **또 던진다**(createWorker.js) — 그 던짐은
 *    잡히지 않아 콘솔에 남고, 빈 처리기를 주면 거절만 남아 아래에서 잡힌다.
 */
const TESSERACT_OPTIONS = () => ({
  workerPath: `${VENDOR_URL}tesseract/worker.min.js`,
  corePath: `${VENDOR_URL}tesseract/tesseract-core-simd-lstm.wasm.js`,
  langPath: `${VENDOR_URL}tessdata`,
  workerBlobURL: false,
  gzip: true,
  cacheMethod: 'none',
  errorHandler: () => {},
});

/** tesseract.esm.min.js 는 default export 하나다(그 안에 createWorker). */
const vendorCreateWorker = async (...args) => (await import('../vendor/doctext/tesseract/tesseract.esm.min.js')).default.createWorker(...args);

/**
 * 페이지에 하나뿐인 OCR 워커. worker 는 띄우는 약속(아직 뜨는 중이어도 다음 부름이 같이 기다린다), chain 은 부름들을 차례로 세우는 약속 사슬,
 * idle 은 일이 없을 때 내리는 시계. 띄우는 데 몇 초(wasm 4MB·학습 데이터 4MB)가 들어 부름마다 띄우지 않는다.
 */
const pool = { worker: null, chain: Promise.resolve(), idle: null };

/** 워커를 내린다 — 뜨는 중이면 뜬 뒤에 내린다. 다음 부름은 새로 띄운다. */
function dropWorker(clearTimer) {
  clearTimer(pool.idle);
  pool.idle = null;
  const pending = pool.worker;
  pool.worker = null;
  if (pending) pending.then((w) => w.terminate()).catch(() => {});
}

/**
 * 그림들을 OCR 한다(tesseract.js, 한글+영문). 먼저 ocrReady 로 전부 다듬고(못 푸는 그림은 여기서 던진다) 그 다음 엔진을 띄운다 — 다리와 같은 차례.
 * 워커는 페이지에 하나만 띄워 두고 부름들을 차례로 읽힌다. IDLE_MS 동안 일이 없으면 내리고, 한 번 부름이 limitMs 를 넘기면 거절하고 워커를 내린다
 * (다음 부름은 새로 띄운다). 거절은 core.withText 가 잡아 그 첨부를 파일째 보낸다.
 * @param {Uint8Array[]} images
 * @param {{ createWorker?: Function, prep?: Function, idleMs?: number, limitMs?: number, setTimer?: Function, clearTimer?: Function }} [deps] 테스트가 갈아 끼운다
 * @returns {Promise<{text: string, confidence: number}[]>}
 */
export async function ocrImages(images, {
  createWorker = vendorCreateWorker, prep = ocrReady, idleMs = IDLE_MS, limitMs = OCR_LIMIT_MS,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout,
} = {}) {
  const prepping = (async () => {
    const ready = [];
    for (const bytes of images) ready.push(await prep(bytes));
    return ready;
  })();
  // 사슬의 자리는 지금 잡는다(부른 차례대로) — 다듬기를 기다린 뒤 서면 그림이 적은 부름이 앞질러 선다. 다듬기는 앞 부름이 읽히는 동안 돈다.
  const prev = pool.chain;
  const turn = prepping.then((ready) => prev.then(() => recognizeAll(ready, { createWorker, idleMs, limitMs, setTimer, clearTimer })));
  // 내 뒤의 부름은 내가 끝난 뒤에 온다. 내가 실패해도(다듬기·엔진) 뒤는 막지 않는다 — 다듬다 실패했으면 앞 사슬 뒤에 선다.
  pool.chain = turn.catch(() => prev);
  return turn;
}

async function recognizeAll(ready, { createWorker, idleMs, limitMs, setTimer, clearTimer }) {
  clearTimer(pool.idle);
  pool.idle = null;
  if (!pool.worker) {
    const starting = createWorker(OCR_LANGS, 1, TESSERACT_OPTIONS());
    // 뜨지 못하면 잊는다 — 다음 부름이 다시 띄운다(꾸러미를 그 사이에 넣었을 수 있다).
    starting.catch(() => { if (pool.worker === starting) pool.worker = null; });
    pool.worker = starting;
  }
  let timer;
  let gaveUp = false;
  const work = (async () => {
    const worker = await pool.worker;
    const out = [];
    for (const png of ready) {
      // 시간이 다 돼 이미 OCR 없이 가고 있으면 더 읽지 않는다.
      if (gaveUp) break;
      const { data } = await worker.recognize(png);
      out.push({ text: tidy(data.text), confidence: Math.round(data.confidence) });
    }
    return out;
  })();
  try {
    const out = await Promise.race([work, new Promise((_, reject) => {
      timer = setTimer(() => { gaveUp = true; reject(new Error(`OCR 이 ${limitMs / 1000}초 안에 끝나지 않았습니다`)); }, limitMs);
    })]);
    // 잘 끝났다 — 워커는 두고, 일이 없으면 내리는 시계를 건다.
    pool.idle = setTimer(() => dropWorker(clearTimer), idleMs);
    return out;
  } catch (err) {
    // 시간이 다 됐거나 엔진이 실패했다 — 워커를 믿지 않는다. 읽던 일이 남아 있어도 같이 사라진다.
    dropWorker(clearTimer);
    work.catch(() => {});
    throw err;
  } finally {
    clearTimer(timer);
  }
}

// ---- 진입점 ------------------------------------------------------------------------------------------------------------------

/**
 * 첨부마다 글자를 먼저 뽑아 claude 에게 줄 글과 첨부를 다시 짓는다(core.withText) — 꾸러미가 없으면 던지지 않고 파일째(read 에 까닭).
 * 건너뜀 문구는 다리(native/host.mjs 의 extractText)와 같다.
 * @param {string} input
 * @param {{name:string, type:string, dataUrl:string}[]} files
 * @param {{ pdf?: Function, ocr?: Function, render?: Function }} [engines] 테스트가 갈아 끼운다
 * @returns {Promise<{input: string, files: object[], read: string[], lean: boolean}>}
 */
export async function withText(input, files, engines = {}) {
  const r = await ready();
  if (!r.ok) return { input, files, read: [`글자 뽑기를 건너뜀(${r.reason}) — 파일째 보냄`], lean: false };
  // core 는 셋 중 하나라도 빠지면 던진다 — 일부만 갈아 끼워도 나머지는 여기 엔진으로 채운다.
  return coreWithText(input, files, { pdf: pdfText, ocr: ocrImages, render: pdfPageImages, ...engines });
}

// ---- 사업계획서 전체 (rndgen) --------------------------------------------------------------------------------------------------

/**
 * PDF 의 글자 층을 **모든 쪽**(maxPages 까지) 뽑는다 — pdfText(6쪽 한도)와 달리 사업계획서 전체를 본다(rndgen/source.js). 줄 바꿈은 hasEOL.
 * 100~300쪽짜리를 한 쪽씩 읽고 그 쪽의 자원은 바로 놓는다(page.cleanup) — 그림이 많은 계획서도 메모리를 쌓지 않게.
 * 쪽을 어떻게 부분으로 나눠 LLM 에 줄지는 여기서 하지 않는다 — rndgen/source.js 의 splitPages 가 한다(크기 제한 없이, maxPages: Infinity 로 다 읽는다 — 2026-10-23).
 * @param {Uint8Array} bytes
 * @param {{ maxPages?: number, open?: (bytes) => Promise<{doc, close}> }} [opts]  open 은 검사가 끼운다(기본 openPdf)
 * @returns {Promise<{pages: string[], total: number}>} pages 는 앞에서 maxPages 쪽까지, total 은 문서의 쪽 수
 */
export async function pdfAllText(bytes, { maxPages = 400, open = openPdf } = {}) {
  const { doc, close } = await open(bytes);
  try {
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const { items } = await page.getTextContent();
      pages.push(items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : '')).join('').trim());
      page.cleanup?.();
    }
    return { pages, total: doc.numPages };
  } finally {
    await close();
  }
}
