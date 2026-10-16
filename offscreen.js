// offscreen 문서(offscreen.html)의 스크립트 — 서비스 워커(background.js)가 첨부에서 글자를 먼저 뽑아 달라고 하면 대신 뽑는다.
// 서비스 워커에는 Worker·DOM 이 없어 pdf.js·tesseract.js 를 못 돌린다. doctext/index.js 의 docText 가 이 문서를 띄우고
// { target: 'doctext', task: 'withText', input, files } 를 보내면 doctext/browser.js 로 뽑아 { ok: true, ...Out } 으로 답한다.
//
// chrome.runtime.onMessage 에는 다른 메시지(background.js 가 type 으로 가르는 것들)도 같이 온다 — target 이 'doctext' 가
// 아니면 아무것도 돌려주지 않아(undefined) 그쪽 답을 가로채지 않는다.

/**
 * 메시지 하나를 처리한다. load 는 테스트가 가짜 엔진을 끼우는 자리다.
 * @returns {true|undefined} 내 메시지면 true(답은 나중에 준다), 아니면 undefined
 */
export function onMessage(msg, _sender, sendResponse, load = () => import('./doctext/browser.js')) {
  if (msg?.target !== 'doctext') return;
  (async () => {
    try {
      if (msg.task !== 'withText') throw new Error(`모르는 일(${msg.task})`);
      const { withText } = await load();
      sendResponse({ ok: true, ...(await withText(msg.input, msg.files)) });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;   // 답은 나중에 준다
}

chrome.runtime.onMessage.addListener(onMessage);
