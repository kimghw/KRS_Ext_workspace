// 일일 업무 작성기(src/dwrwrite.js)가 연 뒤 탭에서만 알림·확인 창을 받아 둔다(2026-10-29 — 일일 업무 짜기의 저장·제출).
// 뒤 탭의 alert·confirm 은 그 창의 스크립트를 멈춰 세워 작성기가 기다리다 끝난다(src/gmwrite.js 머리 메모). 그래서 작성기가 탭을 열기 전에
// 이 파일을 MAIN 세계·document_start·모든 틀로 등록하고(chrome.scripting.registerContentScripts — 끝나면 지운다), 맨 위 주소에 #krsws-dwr 가 붙은 탭에서만
// 창 대신 sessionStorage 에 적는다 — 사람이 연 e-Class 탭은 건드리지 않는다. 포스트백 뒤 새로 뜬 화면의 알림(저장되었습니다 …)도 먼저 받는다.
// 확인 창은 작성기가 저장·제출 단추를 누르기 직전에 켠 때(krswsDwrAllow)만 '예', 아니면 '아니오'다 — 날짜를 옮길 때 뜨는 뜻밖의 확인에 '예'를 하지 않는다.
(() => {
  let mine = false;
  try {
    mine = /krsws-dwr/.test(window.top.location.hash);
  } catch {
    return;
  }
  if (!mine) return;
  const KEY = 'krswsDwrDialogs';
  const keep = (kind, text, answer) => {
    try {
      const all = JSON.parse(sessionStorage.getItem(KEY) || '[]');
      all.push({ kind, text: String(text ?? '').slice(0, 300), answer, at: Date.now(), path: location.pathname });
      sessionStorage.setItem(KEY, JSON.stringify(all.slice(-30)));
    } catch {
      // 적지 못해도 창은 띄우지 않는다
    }
  };
  window.alert = (text) => { keep('alert', text, null); };
  window.confirm = (text) => {
    let ok = false;
    try { ok = sessionStorage.getItem('krswsDwrAllow') === '1'; } catch { ok = false; }
    keep('confirm', text, ok);
    return ok;
  };
  window.prompt = (text) => { keep('prompt', text, null); return null; };
})();
