// 메일 탭(회신 추적)의 조립 — sidepanel.js 가 import 하는 mailtrack/ 의 유일한 입구.
// 장부(store/book.js + model.js normalizeBook) · 금고(store/vault.js, IndexedDB krsMailtrack) · Outlook MCP 어댑터(mcp/outlook.js) 를 sync.js 에 꽂고,
// 그 sync 를 화면(panel.js)에 넣는다. 화면은 sync·장부·금고·MCP 를 import 하지 않으므로 무엇을 쓸지는 여기서만 정한다.
//
// 2026-10-15 사용자 지정: "별도 폴더에 작성합니다 … 지금 프로젝트와 가능한 분리해서 작성해 주시기 바랍니다". 그래서 바깥(sidepanel.js)과 닿는 곳은
// createMailPanel 하나이고, 돌려주는 것도 다른 패널과 같은 { wire, show, hide, reload } 다(rndpanel.js 꼴).
//
// 만들기만 해서는 아무것도 부르지 않는다 — 장부는 처음 읽을 때 chrome.storage 를, 금고는 처음 쓸 때 IndexedDB 를, 어댑터는 처음 부를 때 fetch 를 본다.
// test/wiring.test.mjs 가 jsdom(indexedDB·네트워크 없음)에서 sidepanel.js 를 통째로 import 하므로 import·생성·wire() 시점에는 그것들을 건드리면 안 된다.
//
//   import { createMailPanel } from './mailtrack/index.js';
//   const mail = createMailPanel({ root: $('mail'), $, escapeHtml, logEvent, flash, copyText });
//   mail.wire();  …  mail.show() / mail.hide() / mail.reload()

import { createMailPanel as createPanel } from './panel.js';
import { createSync } from './sync.js';
import { normalizeBook, DEFAULTS } from './model.js';
import { createBook } from './store/book.js';
import { createVault } from './store/vault.js';
import { createOutlook } from './mcp/outlook.js';

/**
 * 메일 탭 하나를 조립한다. deps 는 panel.js createMailPanel 의 것(root · connRoot · $ · escapeHtml · logEvent · flash · copyText · download · openTab · now · confirmMs)에
 * 검사용 바꿔 끼우기 몇 개를 더한 것 — 모두 생략할 수 있고, 생략하면 확장의 진짜 것(chrome.storage.local · IndexedDB · 전역 fetch)을 처음 쓸 때 본다.
 * @param {object} deps
 * @param {{get: Function, set: Function}} [deps.storage] 장부 저장소(기본 chrome.storage.local)
 * @param {object} [deps.vaultBackend] 금고 뒷단(store/vault.js idbBackend() · memoryBackend(); 기본은 처음 쓸 때 만드는 idbBackend)
 * @param {typeof fetch} [deps.fetch] MCP 를 부를 fetch(기본 전역 fetch — rerp/mcp.js 가 부를 때 본다)
 * @param {object} [deps.merge] ooxml/merge.js 모듈(기본은 처음 병합할 때 import)
 * @param {() => number} [deps.now] 시각 — sync 와 화면이 같이 쓴다
 * @returns {{ wire: () => void, show: () => Promise<void>, hide: () => void, reload: () => Promise<any>, loadSettings: () => Promise<void>, state: () => object }}
 */
export function createMailPanel(deps = {}) {
  const { storage, vaultBackend, fetch, merge, ...view } = deps;
  const logEvent = typeof deps.logEvent === 'function' ? deps.logEvent : null;

  const book = createBook({ normalize: normalizeBook, ...(storage ? { storage } : {}) });
  const vault = createVault(vaultBackend || undefined);
  let sync = null;
  // 어댑터는 MCP 주소·계정을 부를 때마다 장부의 설정에서 읽는다(설정을 바꾸면 다음 부름부터). sync.book() 은 만들 때부터 기본 장부를 들고 있지만,
  // 어댑터가 sync 보다 먼저 서므로 그 사이에 불려도 model.js 기본값으로 답하게 한다.
  const settings = () => sync?.book()?.settings || DEFAULTS;
  const outlook = createOutlook({ url: () => settings().mcpUrl, userEmail: () => settings().userEmail, ...(fetch ? { fetch } : {}) });
  sync = createSync({
    outlook, book, vault,
    ...(merge ? { merge } : {}),
    ...(typeof deps.now === 'function' ? { now: deps.now } : {}),
    // 등록·갱신·서버에 저장·병합의 기록은 화면이 남긴다(한 일마다 한 줄) — sync 는 화면이 모르는 것(금고 지우기 실패)만 이 줄로 말한다.
    log: logEvent ? (ok, text, data) => logEvent('mail', ok, text, data) : () => {},
  });
  return createPanel({ ...view, sync });
}
