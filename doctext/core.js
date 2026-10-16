// 첨부(출장 증빙·공문 문서)에서 글자를 먼저 뽑는 순수 로직(2026-10-16) — 다리(native/doctext.mjs)와 브라우저(doctext/browser.js)가 같이 쓴다.
// 2026-10-04 에 다리에서 만든 것을 그대로 뽑아 왔다. 엔진(PDF 글자 층·쪽 그리기·OCR)은 받는 쪽이 끼운다 —
// 다리는 node 의 pdf.js·Tesseract·@napi-rs/canvas, 브라우저는 확장 안의 pdf.js·tesseract.js(vendor/doctext).
// 여기에는 DOM 도 node 전용 API(Buffer·fs·path)도 없다 — 어느 쪽에서든 그대로 돈다. src/pdf.js 의 sniff(파일 앞머리로 종류 가리기)만 가져온다.
//
//   PDF(글자 층 있음) → 뽑은 글자만 보낸다. 파일은 붙이지 않는다.
//   PDF(스캔본)       → 쪽을 그림으로 그려 OCR 한 글자를 적고, PDF 도 붙인다.
//   그림              → OCR(한글+영문)한 글자를 적고, 그림도 붙인다.
//
// 그림을 같이 붙이는 까닭: OCR 은 표 안의 줄을 말없이 빠뜨리고(총액 줄·출발 시각) 흐린 사진에서는 글자가 깨진다. 2026-10-04 에 표본
// 여섯 장으로 잰 것(haiku, 맞은 칸): 그림만 67/84 · OCR 글자만 69/84 · OCR 글자 + 그림 76/84. PDF 는 글자만 주어도 PDF 째 줄 때와
// 같았다(세 장 × 2회 전부 맞음).
//
// 못 뽑으면(글자가 깨졌다·OCR 을 믿기 어렵다·엔진이 던졌다) 전처럼 파일째 읽힌다 — 여기서는 던지지 않고 까닭을 read 에 적는다.
// claude 에게 주는 글과 read 의 한 줄은 다리와 브라우저가 같다 — 기록을 보는 사람이 어느 길이든 같은 문장을 본다.

import { sniff } from '../src/pdf.js';

/**
 * 엔진 — 받는 쪽이 끼운다. 바이트는 전부 Uint8Array 다(Buffer 가 아니다 — 브라우저에는 없다).
 * @typedef {object} Engines
 * @property {(bytes: Uint8Array) => Promise<{pages: string[], total: number}>} pdf  PDF 의 글자 층 — pages 는 앞 PDF_MAX_PAGES 쪽, total 은 문서의 쪽 수
 * @property {(images: Uint8Array[]) => Promise<{text: string, confidence: number}[]>} ocr  그림들을 OCR — 그림마다 글자와 믿음(0~100)
 * @property {(bytes: Uint8Array) => Promise<Uint8Array[]>} render  스캔한 PDF 의 앞 SCAN_PAGES 쪽을 PNG 로
 */

/** 글자만 보내는 PDF 의 한도 — 이보다 길거나 쪽이 많으면 자르지 않고 전처럼 PDF 째 보낸다. */
export const PDF_TEXT_MAX = 12000;
export const PDF_MAX_PAGES = 6;
/** 글자 층이 있다고 보는 가장 적은 글자 수(공백 빼고) — 스캔본은 0 이거나 쪽 번호쯤만 나온다. */
const PDF_MIN_CHARS = 40;
/** OCR 글자를 적어 줄 만하다고 보는 믿음(Tesseract 가 매긴 0~100)과 글자 수. 흐린 사진을 그대로 읽히면 30 대가 나온다. */
export const OCR_MIN_CONF = 45;
const OCR_MIN_CHARS = 20;
const OCR_TEXT_MAX = 6000;
/** 스캔한 PDF 에서 OCR 할 쪽 수와, 그 쪽을 그릴 때 긴 변의 픽셀. */
export const SCAN_PAGES = 3;
export const SCAN_SIDE = 2200;
/** OCR 전체에 주는 시간 — 넘기면 OCR 없이 간다. */
export const OCR_LIMIT_MS = 25_000;
export const OCR_LANGS = ['kor', 'eng'];

/** 공백을 뺀 글자 — 글자 수를 셀 때와 깨진 글자의 비율을 볼 때 쓴다. */
export const dense = (text) => String(text || '').replace(/\s/g, '');

/** 뽑은 글자가 읽을 만한가 — 너무 적거나(스캔본), 글꼴의 글자 표가 없어 깨진 것(사설 영역·제어 문자)이 많으면 아니다. */
export function usable(text) {
  const d = dense(text);
  if (d.length < PDF_MIN_CHARS) return false;
  const broken = (d.match(/[\p{Co}\p{Cc}\p{Cn}\u{FFFD}]/gu) || []).length;
  return broken / d.length < 0.1;
}

/** OCR 글자를 다듬는다 — 빈 줄과 길게 늘어진 빈칸(표의 칸 사이)을 줄인다. 엔진이 글자를 돌려주기 전에 부른다. */
export const tidy = (text) => String(text || '').replace(/\n{2,}/g, '\n').replace(/ {3,}/g, '   ').trim();

/**
 * data URL 의 base64 를 바이트로. atob 는 node 16+ 와 브라우저 둘 다에 있다. 비었거나 쉼표가 없으면 길이 0 이다.
 * 깨진 base64 는 atob 가 던진다 — withText 는 그것을 잡아 그 첨부를 파일째 보낸다.
 * @returns {Uint8Array}
 */
export function fromDataUrl(dataUrl) {
  const bin = atob(String(dataUrl || '').split(',')[1] || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * OCR 이 읽기 좋게 그림을 키우거나 줄이는 배율 — 작은 그림(화면 캡처)은 두 배로, 큰 사진은 긴 변이 3200 이 되게 줄이고, 그 사이는 그대로.
 * 2026-10-04 에 본 것: 가로 520 짜리 영수증 캡처는 두 배로 키워야 금액 줄이 읽혔고, 세 배는 도로 나빠졌다.
 */
export function ocrScale(width, height) {
  const long = Math.max(width, height);
  return long < 1600 ? 2 : long > 3200 ? 3200 / long : 1;
}

/** 글자를 싸는 꼬리표가 글자 안에 들어 있으면 뺀다 — 문서의 글이 꼬리표를 닫아 버리지 못하게. */
const boxed = (text) => `<문서 글자>\n${String(text).replace(/<\/?문서 글자>/g, '')}\n</문서 글자>`;

const pdfSection = (name, text) =>
  `문서(파일 이름: ${name})는 첨부하지 않았습니다 — 아래가 그 문서(PDF)에서 뽑은 글자 전부입니다. 이 글자를 읽습니다.\n\n${boxed(text)}`;
const ocrSection = (name, text) =>
  `아래는 첨부한 문서(파일 이름: ${name})의 그림에서 OCR 로 먼저 읽은 글자입니다 — 글자·숫자를 맞춰 볼 때 쓰되, OCR 이 틀리거나 빠뜨린 곳은 그림을 따릅니다.\n\n${boxed(text)}`;

/** 여러 쪽의 글자를 하나로 — 두 쪽 이상이면 쪽 사이에 금을 긋는다. */
const joinPages = (pages) => (pages.length > 1 ? pages.map((p, i) => `— ${i + 1}쪽 —\n${p}`).join('\n\n') : pages[0] || '').trim();

/** OCR 결과(쪽마다)를 하나로 묶고, 적어 줄 만한지 가린다. 믿음은 가장 낮은 쪽의 것이다. */
function ocrVerdict(results) {
  const text = joinPages(results.map((r) => r.text)).slice(0, OCR_TEXT_MAX);
  const confidence = Math.min(...results.map((r) => r.confidence));
  return { text, confidence, chars: dense(text).length, ok: confidence >= OCR_MIN_CONF && dense(text).length >= OCR_MIN_CHARS };
}

/**
 * 첨부마다 글자를 먼저 뽑아 claude 에게 줄 글과 첨부를 다시 짓는다. 던지지 않는다 — 못 뽑은 첨부는 그대로 붙는다.
 * (엔진을 안 끼운 것만은 던진다 — 그것은 첨부의 탓이 아니라 부르는 쪽의 잘못이다.)
 * @param {string} input 확장이 보낸 글(출장 정보·파일 이름)
 * @param {{name:string, type:string, dataUrl:string}[]} files
 * @param {Engines} engines 다리는 native/doctext.mjs 의 것, 브라우저는 doctext/browser.js 의 것. 기본값은 없다
 * @returns {Promise<{input: string, files: object[], read: string[], lean: boolean}>}
 *   files 는 그래도 붙일 첨부, read 는 첨부마다 어떻게 읽었는지(기록에 남긴다), lean 은 첨부 없이 글자만 가는가
 */
export async function withText(input, files, engines) {
  const { pdf, ocr, render } = engines || {};
  if (typeof pdf !== 'function' || typeof ocr !== 'function' || typeof render !== 'function') {
    throw new TypeError('withText: 엔진(pdf·ocr·render)을 끼워야 합니다 — native/doctext.mjs 나 doctext/browser.js 의 것을');
  }
  const sections = [];
  const keep = [];
  const read = [];
  for (const f of files || []) {
    try {
      // 바이트로 못 푸는 data URL 은 엔진에 들어가기 전에 걸린다 — 그 첨부도 파일째 간다.
      const bytes = fromDataUrl(f.dataUrl);
      if (sniff(bytes) === 'pdf') {
        const got = await pdf(bytes);
        const text = joinPages(got.pages);
        if (usable(text)) {
          if (got.total <= PDF_MAX_PAGES && text.length <= PDF_TEXT_MAX) {
            sections.push(pdfSection(f.name, text));
            read.push(`${f.name}: 글자 층 ${dense(text).length}자(${got.total}쪽) — 글자만 보냄`);
          } else {
            keep.push(f);
            read.push(`${f.name}: 글자가 김(${got.total}쪽) — 파일째 보냄`);
          }
          continue;
        }
        const o = ocrVerdict(await ocr(await render(bytes)));
        keep.push(f);
        if (o.ok) sections.push(ocrSection(f.name, o.text));
        read.push(`${f.name}: 글자 층 없음 · OCR ${o.chars}자(믿음 ${o.confidence}) — ${o.ok ? 'OCR 글자와 파일을 같이 보냄' : 'OCR 을 믿기 어려워 파일째 보냄'}`);
        continue;
      }
      const o = ocrVerdict(await ocr([bytes]));
      keep.push(f);
      if (o.ok) sections.push(ocrSection(f.name, o.text));
      read.push(`${f.name}: OCR ${o.chars}자(믿음 ${o.confidence}) — ${o.ok ? 'OCR 글자와 그림을 같이 보냄' : 'OCR 을 믿기 어려워 그림만 보냄'}`);
    } catch (err) {
      keep.push(f);
      read.push(`${f.name}: 글자를 뽑지 못함(${String(err?.message || err).slice(0, 120)}) — 파일째 보냄`);
    }
  }
  return {
    input: sections.length ? `${input}\n\n${sections.join('\n\n')}` : input,
    files: keep, read, lean: !keep.length && sections.length > 0,
  };
}
