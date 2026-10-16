// 첨부 글자 먼저 뽑기의 한 진입점 — 어디서 불렸든 docText 하나를 부른다(src/llm.js 의 API 키 길이 쓴다).
//
//   확장 페이지(패널·공문 탭)    Worker 가 있다 → doctext/browser.js 가 그 자리에서 pdf.js·tesseract.js 를 돌린다
//   서비스 워커(background.js)   Worker·DOM 이 없어 엔진을 못 돌린다 → offscreen 문서(offscreen.html)를 띄워 거기서 뽑고 답을 받는다
//   둘 다 아니면                파일째 보낸다
//
// 절대 던지지 않는다 — 못 뽑으면 파일째 보내고 까닭을 read 에 적는다(다리 native/host.mjs 의 extractText 와 같은 문구).
// 결과 모양은 다리(native/doctext.mjs 의 withText)와 같다: { input, files, read, lean }.
//
// 이 모듈은 src/llm.js 가 정적으로 가져와 서비스 워커 안에서도 평가된다. 그래서 가져오기만으로는 chrome·document·Worker 를
// 만지지 않고, 엔진 모듈(browser.js)도 정적으로 가져온다 — MV3 서비스 워커는 import() 를 막는다
// ("import() is disallowed on ServiceWorkerGlobalScope"). browser.js 는 가져오기만으로는 아무것도 안 만진다(doctext/README.md).

import { withText as browserText } from './browser.js';

/** offscreen 문서가 이만큼 일 없이 있으면 닫는다 — 다음 첨부가 오면 다시 띄운다. */
export const IDLE_MS = 90_000;
export const OFFSCREEN_URL = 'offscreen.html';
/** chrome.offscreen.createDocument 에 적는 까닭 — 스토어 심사가 보는 글이다. */
export const JUSTIFICATION = '첨부(출장 증빙·공문 문서)에서 글자를 먼저 뽑는다 — PDF 글자 층과 OCR';

/** 못 뽑았다 — 파일째 보내고 까닭을 read 에 남긴다(host.mjs 의 extractText 와 같은 문구). */
const skipped = (input, files, why) => ({ input, files, read: [`글자 뽑기를 건너뜀(${why}) — 파일째 보냄`], lean: false });
const reason = (e) => String(e?.message || e).slice(0, 160);
/** 엔진이 돌려준(또는 offscreen 이 답한) 것이 Out 모양인가 — 아니면 null(그 때는 파일째 간다). */
const shape = (r) => (r && typeof r.input === 'string' && Array.isArray(r.files) && Array.isArray(r.read))
  ? { input: r.input, files: r.files, read: r.read.map(String), lean: !!r.lean }
  : null;
/** node 에서는 시계가 프로세스를 붙들지 않게 한다(브라우저의 setTimeout 은 숫자를 돌려줘 unref 가 없다). */
const setTimer = (fn, ms) => { const id = setTimeout(fn, ms); id?.unref?.(); return id; };

/**
 * offscreen 문서의 상태 — chrome.offscreen 객체마다 하나(테스트는 가짜를 여럿 쓴다).
 *   making   createDocument 약속 — 동시에 온 호출은 이것을 같이 기다린다(문서는 하나만 띄울 수 있다)
 *   closing  closeDocument 약속 — 닫는 중에 새 일이 오면 다 닫힌 뒤 다시 띄운다
 *   busy     지금 맡긴 일 수 · idle 유휴 시계를 끄는 함수(일이 새로 오면 끈다)
 */
const docs = new WeakMap();
const stateOf = (offscreen) => {
  let st = docs.get(offscreen);
  if (!st) docs.set(offscreen, (st = { making: null, closing: null, busy: 0, idle: null }));
  return st;
};

/** 문서가 이미 있는가 — hasDocument 는 Chrome 116 부터 있다. 없거나 던지면 모르는 것으로 치고 만들어 본다. */
async function hasDoc(offscreen) {
  try { return typeof offscreen.hasDocument === 'function' && !!(await offscreen.hasDocument()); }
  catch { return false; }
}

/**
 * offscreen 문서를 띄운다. 동시에 두 번 만들지 않게 약속 하나를 나눠 쓰고, 이미 있다는 오류는 삼킨다 —
 * Chrome 의 문구는 "Only a single offscreen document may be created." 다("already exists" 도 같이 본다).
 */
function ensureOffscreen(offscreen, st) {
  st.making ||= (async () => {
    try {
      if (st.closing) await st.closing;
      if (await hasDoc(offscreen)) return;
      await offscreen.createDocument({ url: OFFSCREEN_URL, reasons: ['WORKERS'], justification: JUSTIFICATION });
    } catch (e) {
      if (!/already exists|single offscreen document/i.test(reason(e))) throw e;   // 다른 길로 먼저 띄워져 있다 — 괜찮다
    } finally {
      st.making = null;
    }
  })();
  return st.making;
}

/** 서비스 워커 갈래 — offscreen 문서에 맡기고 답을 받는다. 일이 다 끝나고 IDLE_MS 동안 더 없으면 문서를 닫는다. */
async function viaOffscreen(input, files, { offscreen, send, timers }) {
  const st = stateOf(offscreen);
  st.busy++;
  if (st.idle) { st.idle(); st.idle = null; }
  try {
    await ensureOffscreen(offscreen, st);
    const r = await send({ target: 'doctext', task: 'withText', input, files });
    if (r === undefined) throw new Error('응답 없음');          // 문서가 없거나 리스너가 답하지 않았다
    if (r?.ok !== true) throw new Error(String(r?.error || '까닭 없이 실패'));
    const out = shape(r);
    if (!out) throw new Error('응답 모양이 다름');
    return out;
  } catch (e) {
    return skipped(input, files, `offscreen: ${reason(e)}`);
  } finally {
    st.busy--;
    if (!st.busy) {
      const id = timers.set(() => {
        st.idle = null;
        st.closing = Promise.resolve().then(() => offscreen.closeDocument()).catch(() => {}).finally(() => { st.closing = null; });
      }, IDLE_MS);
      st.idle = () => timers.clear(id);
    }
  }
}

/**
 * 어디서 불렸든 한 진입점. 절대 던지지 않는다 — 못 뽑으면 파일째(read 에 까닭).
 * @param {string} input
 * @param {{name: string, type: string, dataUrl: string}[]} files
 * @param {{ hasWorker?: boolean, offscreen?: object, send?: Function, load?: Function, timers?: {set: Function, clear: Function} }} [deps] 테스트가 갈아 끼운다
 * @returns {Promise<{input: string, files: object[], read: string[], lean: boolean}>}
 */
export async function docText(input, files, deps = {}) {
  const {
    hasWorker = typeof Worker !== 'undefined',
    offscreen = globalThis.chrome?.offscreen,
    send = (msg) => globalThis.chrome.runtime.sendMessage(msg),
    load = async () => ({ withText: browserText }),   // 테스트가 가짜 엔진을 끼우는 자리 — 페이지 길에서만 부른다
    timers = { set: setTimer, clear: (id) => clearTimeout(id) },
  } = deps;
  if (hasWorker) {
    // 확장 페이지 — 그 자리에서 뽑는다(꾸러미가 없으면 browser.withText 가 스스로 건너뛴다).
    try {
      return shape(await (await load()).withText(input, files)) || skipped(input, files, '엔진이 돌려준 모양이 다름');
    } catch (e) {
      return skipped(input, files, reason(e));
    }
  }
  if (offscreen) return viaOffscreen(input, files, { offscreen, send, timers });
  return skipped(input, files, '이 환경에서는 뽑을 수 없음');
}
