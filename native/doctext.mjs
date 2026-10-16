// 출장 증빙·공문 문서에서 글자를 먼저 뽑는다(2026-10-04 사용자 지정) — 다리(native/host.mjs)가 receipt·gongmun.* 작업의 첨부를 claude 에
// 넘기기 전에 부른다. 구조화(명세의 키 채우기)는 전처럼 claude 가 한다.
//
// 무엇을 보내는가(PDF 글자 층은 글자만·스캔본과 그림은 OCR 글자와 파일을 같이·못 뽑으면 파일째)와 그 문구는 doctext/core.js 에 있다 —
// 브라우저(API 키 길, doctext/browser.js)와 같은 것을 쓴다(2026-10-16). 여기에는 node 엔진만 남는다:
//
//   pdfText        PDF 의 글자 층(pdfjs-dist, node 의 legacy 빌드)
//   pdfPageImages  스캔한 PDF 의 앞쪽 몇 장을 PNG 로(@napi-rs/canvas)
//   ocrReady       OCR 이 읽기 좋게 그림을 다듬기(@napi-rs/canvas)
//   ocrImages      그림들을 OCR(tesseract.js, 학습 데이터는 npm 꾸러미에서 native/tessdata 에 풀어 둔다)
//
// 꾸러미(pdfjs-dist·tesseract.js·@napi-rs/canvas)는 쓸 때 불러온다 — 증빙이 아닌 작업은 그 값을 치르지 않는다. 못 불러오면 withText 가
// 잡아 그 첨부를 파일째 보내고 까닭을 read 에 적는다.
// core 는 바이트를 Uint8Array 로 준다(Buffer 가 아니다) — 그림 꾸러미에 주기 전에 Buffer.from 으로 감싼다. pdf.js 에는 Uint8Array 그대로다.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import {
  withText as coreWithText, usable, tidy, ocrScale, PDF_TEXT_MAX, PDF_MAX_PAGES, OCR_MIN_CONF, SCAN_PAGES, SCAN_SIDE, OCR_LIMIT_MS, OCR_LANGS,
} from '../doctext/core.js';

/** 가리는 셈과 한도는 core 의 것 — 다리의 다른 모듈·테스트가 여기서 가져가므로 다시 내보낸다. */
export { usable, PDF_TEXT_MAX, PDF_MAX_PAGES, OCR_MIN_CONF };

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Tesseract 의 학습 데이터를 풀어 두는 곳(.gitignore). */
const TESSDATA = path.join(HERE, 'tessdata');

/** node_modules 의 꾸러미 폴더. pdf.js 는 폴더를 "/" 로 끝나는 경로로 받는다. */
const pkgDir = (name, sub = '') => `${path.join(path.dirname(require.resolve(`${name}/package.json`)), sub).replaceAll(path.sep, '/')}/`;

/** PDF 를 연다(pdf.js). 다 쓰면 close 로 닫는다. */
async function openPdf(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdf.js 는 받은 바이트를 가져가 버린다 — 베낀 것을 준다(스캔본이면 같은 바이트로 한 번 더 연다). Buffer 가 와도 Uint8Array 로 베껴진다.
  const task = getDocument({
    data: new Uint8Array(bytes), cMapUrl: pkgDir('pdfjs-dist', 'cmaps'), cMapPacked: true,
    standardFontDataUrl: pkgDir('pdfjs-dist', 'standard_fonts'), verbosity: 0,
  });
  return { doc: await task.promise, close: () => task.destroy().catch(() => {}) };
}

/**
 * PDF 의 글자 층을 쪽마다 뽑는다(pdf.js). 줄 바꿈은 pdf.js 가 가린 것(hasEOL)을 따른다.
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

/** 스캔한 PDF 의 앞쪽 몇 장을 PNG 로 그린다 — OCR 에 넘길 그림이다. */
export async function pdfPageImages(bytes) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const { doc, close } = await openPdf(bytes);
  try {
    const out = [];
    for (let i = 1; i <= Math.min(doc.numPages, SCAN_PAGES); i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: SCAN_SIDE / Math.max(base.width, base.height) });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      out.push(canvas.toBuffer('image/png'));
    }
    return out;
  } finally {
    await close();
  }
}

/**
 * OCR 이 읽기 좋게 그림을 다듬는다 — 작은 그림(화면 캡처)은 두 배로 키우고, 큰 사진은 줄이고(배율은 core 의 ocrScale), 투명한 바탕은 희게 채운다.
 * 돌려 찍은 사진(EXIF)은 그림을 푸는 꾸러미(@napi-rs/canvas)가 스스로 바로 세운다 — 여기서 또 돌리지 않는다.
 * 풀 수 없는 그림이면 던진다. 그 꾸러미가 없으면 받은 그대로 돌려준다.
 */
export async function ocrReady(bytes) {
  let canvasLib;
  try {
    canvasLib = await import('@napi-rs/canvas');
  } catch {
    return bytes;
  }
  const img = await canvasLib.loadImage(Buffer.from(bytes));
  const scale = ocrScale(img.width, img.height);
  const canvas = canvasLib.createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer('image/png');
}

/**
 * Tesseract 의 학습 데이터를 캐시 폴더에 풀어 둔다 — npm 꾸러미(@tesseract.js-data/*)에 든 것을 쓴다. 꾸러미가 없으면 던진다:
 * 그대로 두면 tesseract.js 가 CDN 에서 받으려 드는데, 다리는 밖에 나가지 않는다(막힌 망에서는 언제 끝날지도 모른다).
 */
function seedTessdata() {
  for (const lang of OCR_LANGS) {
    const to = path.join(TESSDATA, `${lang}.traineddata`);
    if (fs.existsSync(to)) continue;
    let gz;
    try {
      gz = path.join(path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), '4.0.0_best_int', `${lang}.traineddata.gz`);
    } catch {
      throw new Error(`OCR 학습 데이터(${lang})가 없습니다 — 저장소 폴더에서 npm install 을 해 주세요`);
    }
    fs.mkdirSync(TESSDATA, { recursive: true });
    fs.writeFileSync(to, zlib.gunzipSync(fs.readFileSync(gz)));
  }
}

/**
 * 그림들을 OCR 한다(Tesseract, 한글+영문). 엔진은 한 번 띄워 차례로 읽히고, 끝나면 내린다 — 내리지 않으면 다리 프로세스가 끝나지 않는다.
 * @param {Uint8Array[]} images
 * @returns {Promise<{text: string, confidence: number}[]>}
 */
export async function ocrImages(images) {
  // 풀 수 없는 그림은 엔진을 띄우기 전에 걸러진다(여기서 던진다).
  const ready = [];
  for (const bytes of images) ready.push(Buffer.from(await ocrReady(bytes)));
  const { createWorker } = await import('tesseract.js');
  seedTessdata();
  let worker;
  let timer;
  let gaveUp = false;
  const work = (async () => {
    // errorHandler 를 주지 않으면 tesseract.js 는 엔진이 실패를 알릴 때 약속을 거절하고 나서 **또 던진다**(createWorker.js) — 그 던짐은
    // 여기서 잡히지 않아 다리가 통째로 죽는다(학습 데이터가 깨졌을 때 등). 빈 처리기를 주면 거절만 남아 아래에서 잡히고 파일째 읽힌다.
    worker = await createWorker(OCR_LANGS, 1, { cachePath: TESSDATA, cacheMethod: 'readOnly', errorHandler: () => {} });
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
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => { gaveUp = true; reject(new Error(`OCR 이 ${OCR_LIMIT_MS / 1000}초 안에 끝나지 않았습니다`)); }, OCR_LIMIT_MS);
    })]);
  } finally {
    clearTimeout(timer);
    if (worker) await worker.terminate().catch(() => {});
    // 엔진이 아직 뜨는 중에 시간이 다 됐으면, 뜬 뒤에 내린다.
    else work.catch(() => {}).then(() => worker?.terminate()).catch(() => {});
  }
}

/**
 * 첨부마다 글자를 먼저 뽑아 claude 에게 줄 글과 첨부를 다시 짓는다(doctext/core.js 의 withText 에 node 엔진을 끼운 것). 던지지 않는다.
 * @param {string} input 확장이 보낸 글(출장 정보·파일 이름)
 * @param {{name:string, type:string, dataUrl:string}[]} files
 * @param {{pdf?: Function, ocr?: Function, render?: Function}} [engines] 테스트가 갈아 끼운다
 * @returns {Promise<{input: string, files: object[], read: string[], lean: boolean}>}
 */
export async function withText(input, files, { pdf = pdfText, ocr = ocrImages, render = pdfPageImages } = {}) {
  return coreWithText(input, files, { pdf, ocr, render });
}
