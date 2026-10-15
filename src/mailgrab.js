// 메일을 통째로 가져온다 — 브라우저 탭에 열어 둔 메일의 글(제목·보낸 사람·받는 사람·날짜·본문)과 첨부 파일 원본을 사이드 패널로.
// 2026-10-15 사용자 지정: "메일에서 첨부 파일 목록을 인식하고 드래그 해서 갖어올 수도 있나" ·
// "메일의 경우 메일 내용과 첨부파일을 통채로 갖어 올 수 있게 해줘, 그 파일은 추후 첨부파일로 사용할 수 있음을 인지해줘" ·
// "전체 하면 메일이랑 첨부를 같이 가져오고.. 첨부는 파일 자체로 관리하지만 ocr 해서 이것도 필요한 내용으로 넣는 거지. 부분으로 첨부파일
// 클릭하면 첨부파일만 가져오고." 그래서 첨부는 **원본 바이트 그대로**(이름·MIME 형식만 맞춘 File)다 — 공문 첨부로 그대로 올리니 그림·PDF 로
// 바꾸지 않는다(글자 뽑기는 부르는 쪽이 원본마다 한다).
//
// 길은 셋이다.
//   · 캡처 단추(webpick.js 의 전체·부분)가 메일 화면을 알아본다 — probeTab 이 메일인지 보고 첨부 카드마다 data-krs-attach="번호", 메일 칸에
//     data-krs-cap="mail" 을 단다. 전체는 grabTab(글 + 모든 첨부; 메일 칸 그림은 부르는 쪽이 pagecap 의 captureTabParts 로 찍는다), 부분은
//     고르기 막이 고른 카드 번호로 fetchTab(그 첨부만)이다. 다 쓰면 unmarkTab.
//   · 끌어 놓기(grabDropped) — 메일의 첨부 카드를 패널에 끌어 놓으면 그 카드의 첨부만 받는다(parseDrop 이 끌어 온 것을 읽는다).
//   · grabFront — 보고 있는 탭을 통째로(그 밖의 웹페이지의 파일 링크까지). 처음 설계의 "메일 가져오기" 단추 자리다.
//
// 사이트마다 읽는 법(2026-10-15 CDP 로 실제 화면을 읽어 맞춘 것 — 새 Outlook 웹 outlook.cloud.microsoft, 한국어 화면):
//   · Outlook — 대화 칸(#ConversationReadingPaneContainer…, 보통 읽기 창 #ReadingPaneContainerId 안)에 제목(CONV_…_SUBJECT)과 펼친 메일마다
//     MSG_<키>_FROM·_TO·_CC·_DATETIME·_ATTACHMENTS 와 본문(UniqueMessageBody_… role=document)이 있다. 받는 사람·참조는 화면 글자가
//     "받는 사람:" 뿐이고 이름은 aria-label 에 다 있다. 대화는 새 메일이 위다. 접힌 메일은 FROM 이 없어 읽지 않는다.
//     첨부는 [role=listbox] 의 [role=option] 카드이고, 카드의 끌 수 있는 칸(draggable)에 dragstart 를 쏘면 Outlook 이 dataTransfer 의
//     'attachment' 에 JSON({attachmentFiles: [{attachmentItemId, name, size, ContentType}]})을 채운다 — 화면 말과 상관없이 정확한 이름·
//     크기·id 를 읽는 길이다(격리된 세계에서 쏘아도 채운다 — 실측).
//     원본 받기는 카드의 "기타 작업"(aria-haspopup 단추) → "다운로드" 메뉴다. 메뉴 글자 앞에는 아이콘 글꼴의 사용자 정의 글자(U+E000 대)가
//     붙어 있어 글자·숫자만 견준다. Outlook 은 attachments.office.net 에서 MSAL 토큰(authorization 머리)을 붙여 받아 blob: 주소를 만들고
//     <a download> 를 누른다 — 그 토큰은 우리가 만들 수 없다. 그래서 페이지 세계(MAIN)에서 URL.createObjectURL·HTMLAnchorElement.prototype.
//     click·EventTarget.prototype.dispatchEvent 를 잠깐 감싸 그 Blob 을 가로채고 원래 누름은 부르지 않는다(브라우저 내려받기가 생기지 않는다).
//     끝나면 꼭 되돌린다. 기다리기는 MutationObserver 로 한다 — 뒤에 깔린 탭은 타이머가 늦춰져(초당 한 번, 오래 숨으면 분당 한 번) 짧은
//     간격으로 되묻는 고리는 제때 끝나지 않는다(실측: 100ms 고리가 20초 한도를 넘겼다).
//   · Outlook 첨부 미리보기 — 주소가 …/sxs/<첨부 id> 이고 Fluent 대화 상자(.fui-DialogSurface[role=dialog])의 명령 띠에 파일 이름(title)과
//     "다운로드"·"닫기" 단추가 있다. 대화 칸이 그 대화 상자 옆에 그려져 있으면(뒤 탭에서 실측) 메일과 첨부를 다 읽고, 그려져 있지 않으면
//     (사용자 탭에서 실측 — 읽기 창이 비었다) 미리보기의 파일만 대화 상자의 "다운로드"로 받고 "미리보기를 닫으면 메일 본문도 가져옵니다" 라고
//     적는다. 미리보기를 우리가 닫지는 않는다(mailUnpreview 는 부르는 쪽이 원할 때만).
//   · eclass 쪽지(eClassVer4/Message/…Detail) — #message-main 의 h3 가 제목, #detail-sender-info 가 보낸 사람, 숨은 #receiverList 표가
//     받는 사람, .message-datetime 이 보낸·받은 때, #htmlContentArea 가 본문이다. 첨부는 .attachmentArea 의 .link-like 마다 숨은 입력
//     (#f_sId·#fId·#fFileName·#fFileType·#fFileSize)이 있고, 화면의 downloadFile 이 #fileDownUrl(/eClassVer4/Message/FileDown)?sId=…&fId=…
//     &fFileName=…&fFileType=…&fFileSize=… 로 간다(message-detail-script.js) — 같은 주소를 같은 출처에서 쿠키를 실어 받는다. 첨부가 있는
//     쪽지는 아직 실제로 받아 보지 못했다(열린 쪽지에 첨부가 없었다).
//   · 그 밖의 페이지(grabFront 만) — 제목은 문서 제목, 글은 body 의 글자, 첨부는 download 속성이 있거나 주소가 파일 확장자로 끝나는 링크다.
//     probeTab 은 메일 사이트가 아니면 스크립트를 넣지 않고 null 이다 — 보통 웹페이지의 전체 캡처는 그대로 화면 캡처다.
//
// 여기도 pagecap 처럼 두 층이다. mailProbe·mailFetch·mailUnmark·mailUnpreview 는 chrome.scripting 이 **글자 그대로** 탭에 옮겨 돌리는
// 함수다 — 바깥 변수·import 를 쓰면 안 된다(안에서 쓰는 도우미도 안에 둔다). mailFetch 는 페이지 세계(world: 'MAIN')에서 돈다 — 페이지의
// URL.createObjectURL 을 감싸야 하기 때문이다. 결과는 JSON 으로 건너오니 바이트는 base64 글자다. grabMail·grabItems·fetchLinks 는
// 차례(탭에서 돌릴 함수·받기를 밖에서 받는다 — 테스트가 갈아 끼운다)이고, probeTab·grabTab·fetchTab·unmarkTab·grabFront·grabDropped 가
// chrome API 를 꽂는다.

import { TEXT_MAX, captureTabParts } from './pagecap.js';

/** 한 파일의 한도 — 결과가 base64 로 건너오니(4/3 배) 확장 메시지 한도(64MB) 안에 넉넉히 들게. 공문 첨부도 이보다 큰 것은 드물다. */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
/** 첨부 하나를 기다리는 한도 — Outlook 이 첨부 서버에서 받아 blob 을 만들 때까지. */
export const FETCH_WAIT_MS = 20000;
/** 미리보기를 닫은 뒤 읽기 창이 다시 그려지기를 기다리는 한도(unpreview 를 켰을 때만). */
export const UNPREVIEW_MS = 8000;
/** Outlook 웹의 주소들 — 끌어 놓은 첨부를 받을 메일 탭을 찾는다. */
export const OUTLOOK_MATCH = ['https://outlook.cloud.microsoft/*', 'https://outlook.office.com/*', 'https://outlook.office365.com/*', 'https://outlook.live.com/*'];
/** 미리보기만 열려 메일 본문을 못 읽었을 때의 말. */
export const PREVIEW_NOTE = '첨부 미리보기가 열려 있어 그 파일만 가져옵니다 — 미리보기를 닫고 다시 하면 메일 본문과 다른 첨부도 가져옵니다.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ 탭 안에서 도는 함수 */

/**
 * 탭의 메일을 읽는다 — 제목·보낸 사람·받는 사람·참조·날짜·본문 글자와 첨부 목록(번호·이름·크기). Outlook 대화는 펼친 메일마다 messages 에
 * 담고(새 메일이 앞), 맨 위 칸(from·to·cc·date·text)은 첫 메일 것이다. attachments 는 모든 메일의 첨부를 겹치지 않게 모은 것이고 key 는
 * 화면 차례의 번호('1', '2', …)다 — 같은 화면이면 몇 번을 읽어도 같은 번호다.
 * mark 면 먼저 지난 표시를 떼고, 첨부 카드마다 data-krs-attach="번호", 메일 칸(Outlook 대화 칸·쪽지 본문 칸)에 data-krs-cap="mail" 을 단다 —
 * 고르기 막이 카드를 고르고, pagecap 의 captureTabParts 가 메일 칸을 찍는다(part 를 그대로 넘긴다). 틀 안의 메일이면 맨 위 문서의 그 틀
 * (iframe)에 단다(같은 출처이고 맨 위 바로 아래의 틀일 때).
 * Outlook 카드는 dragstart 를 쏘아 정확한 이름·크기·id 를 읽는다(ids: false 면 쏘지 않고 화면 글자만 읽는다).
 * @returns {{site: 'outlook'|'eclass'|'page', url: string, title: string, subject: string, from: string, to: string, cc: string, date: string,
 *   text: string, messages: object[], attachments: {key: string, name: string, size: number, sizeText: string, id?: string, type?: string,
 *   url?: string, preview?: boolean}[], preview: {open: true, name: string}|null, marked: boolean,
 *   part: {n: 'mail', tag: string, title: string, frame: object|null}|null}}
 */
export function mailProbe({ mark = false, ids = true, max = 60000 } = {}) {
  const one = (s) => String(s ?? '').replace(/[ ​﻿]/g, ' ').replace(/\s+/g, ' ').trim();
  const label = (s) => String(s ?? '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();   // 아이콘 글꼴 글자·기호를 뺀 말
  const textOf = (el) => (el ? String(el.innerText ?? el.textContent ?? '').slice(0, max) : '');
  const after = (s) => one(String(s ?? '').replace(/^[^:：]{1,20}[:：]\s*/, ''));   // "받는 사람: 가, 나" → "가, 나"
  const bytesOf = (s) => {
    const m = /([\d.,]+)\s*(바이트|bytes?|kb|mb|gb|b)(?![a-z])/i.exec(String(s || ''));   // \b 는 한글 뒤에서 듣지 않는다
    if (!m) return 0;
    const n = parseFloat(m[1].replace(/,/g, ''));
    const u = m[2].toLowerCase();
    const k = u === 'kb' ? 1024 : u === 'mb' ? 1048576 : u === 'gb' ? 1073741824 : 1;
    return Number.isFinite(n) ? Math.round(n * k) : 0;
  };
  const out = {
    site: 'page', url: location.href, title: document.title || '', subject: '', from: '', to: '', cc: '', date: '', text: '',
    messages: [], attachments: [], preview: null, marked: false, part: null,
  };
  if (mark) {
    for (const x of document.querySelectorAll('[data-krs-attach]')) x.removeAttribute('data-krs-attach');
    for (const x of document.querySelectorAll('[data-krs-cap="mail"]')) x.removeAttribute('data-krs-cap');
  }
  const marks = [];
  // 첨부를 모은다 — 같은 것(id 가 같거나, id 가 없으면 이름·크기·주소가 같은 것)은 한 번만. 카드 요소는 번호 표시에 쓴다.
  const addAtt = (a, el) => {
    if (!a.name) return null;
    let same = out.attachments.find((b) => (a.id && b.id ? a.id === b.id : b.name === a.name && (!a.size || !b.size || a.size === b.size)) && (a.url || '') === (b.url || ''));
    if (!same) {
      same = { key: String(out.attachments.length + 1), ...a };
      out.attachments.push(same);
    }
    if (el) marks.push([same.key, el]);
    return same;
  };
  let capEl = null;

  if (/(^|\.)outlook\.(cloud\.microsoft|office\.com|office365\.com|live\.com)$/i.test(location.hostname)) {
    // Outlook 웹
    out.site = 'outlook';
    const FROM = '[id^="MSG_"][id$="_FROM"]';
    const conv = [...document.querySelectorAll('[id^="ConversationReadingPaneContainer"]')].find((c) => c.querySelector(FROM)) || null;
    const pane = document.querySelector('#ReadingPaneContainerId') || document.querySelector('[aria-label="읽기 창"], [aria-label="Reading Pane"], [aria-label="Reading pane"]');
    const root = conv || (pane && pane.querySelector(FROM) ? pane : null) || (document.querySelector(FROM) ? document.querySelector('[role=main]') || document.body : null);
    const cardOf = (opt) => {
      const named = [...opt.querySelectorAll('[title]')].filter((x) => !x.closest('button'));
      let name = one(named[0]?.getAttribute('title'));
      const sizeText = one(named[1]?.getAttribute('title'));
      let size = bytesOf(sizeText);
      let id = '';
      let type = '';
      const drag = ids && opt.querySelector('[draggable="true"]');
      if (drag) {
        try {
          const dt = new DataTransfer();
          drag.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }));
          const j = JSON.parse(dt.getData('attachment') || 'null');
          drag.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
          const f = (j && Array.isArray(j.attachmentFiles) && j.attachmentFiles[0]) || null;
          if (f) {
            name = one(f.name) || name;
            size = Number(f.size) || size;
            id = String(f.attachmentItemId || '');
            type = String(f.ContentType || '');
          }
        } catch { /* 화면 글자로 */ }
      }
      if (!name) name = one(String(opt.getAttribute('aria-label') || '').replace(/\s+(열기|Open)\s+.*$/i, ''));
      return { name, size, sizeText, ...(id ? { id } : {}), ...(type ? { type } : {}) };
    };
    if (root) {
      const subj = root.querySelector('[id^="CONV_"][id$="_SUBJECT"]') || root.querySelector('[id$="_SUBJECT"][role=heading]') || root.querySelector('[role=heading]');
      out.subject = one(subj?.getAttribute('title') || textOf(subj));
      for (const from of root.querySelectorAll(FROM)) {
        const key = from.id.replace(/_FROM$/, '');
        // 메일 한 통의 칸 — 다른 메일의 FROM 을 품기 전까지 위로 올라간다.
        let box = from;
        while (box.parentElement && box !== root && box.parentElement.querySelectorAll(FROM).length === 1) box = box.parentElement;
        const part = (s) => box.querySelector(`[id="${key}_${s}"]`);
        const people = (el) => (el ? after(el.querySelector('[aria-label]')?.getAttribute('aria-label') || el.getAttribute('aria-label') || '') || after(textOf(el)) : '');
        const body = box.querySelector('[id^="UniqueMessageBody"]') || box.querySelector('[role=document]');
        const msg = {
          from: one(textOf(from)) || after(from.querySelector('[aria-label]')?.getAttribute('aria-label')),
          to: people(part('TO')),
          cc: people(part('CC')),
          date: one(textOf(part('DATETIME') || box.querySelector('[data-testid="SentReceivedSavedTime"]'))),
          text: textOf(body),
          attachments: [],
        };
        for (const opt of box.querySelectorAll('[role=listbox] [role=option]')) {
          const a = addAtt(cardOf(opt), opt);
          if (a && !msg.attachments.includes(a)) msg.attachments.push(a);
        }
        out.messages.push(msg);
      }
      if (out.messages.length) capEl = root;
    }
    // 첨부 미리보기 — 대화 상자의 명령 띠에 파일 이름과 다운로드 단추가 있다.
    for (const d of document.querySelectorAll('.fui-DialogSurface[role=dialog], [role=dialog]')) {
      const dl = [...d.querySelectorAll('button')].find((b) => !b.closest('[role=listbox]') && /^(다운로드|Download)$/i.test(label(b.getAttribute('aria-label') || b.innerText)));
      if (!dl) continue;
      let bar = dl.parentElement;
      let titled = null;
      for (; bar && bar !== d && !titled; bar = bar.parentElement) {
        titled = [...bar.querySelectorAll('[title]')].find((x) => !x.closest('[role=listbox], button') && /\.[a-z0-9]{1,5}$/i.test(one(x.getAttribute('title')))) || null;
      }
      const name = one(titled?.getAttribute('title'));
      out.preview = { open: true, name };
      if (name) {
        const shown = out.attachments.find((a) => a.name === name);
        if (shown) {
          shown.preview = true;
          marks.push([shown.key, titled]);
        } else addAtt({ name, size: 0, sizeText: '', preview: true }, titled);
      }
      break;
    }
  } else if (/(^|\.)eclass\.krs\.co\.kr$/i.test(location.hostname) && document.querySelector('#message-main')) {
    // eclass 쪽지
    out.site = 'eclass';
    const main = document.querySelector('#message-main');
    out.subject = one(textOf(main.querySelector('h3')));
    out.from = one(textOf(document.querySelector('#detail-sender-info span')));
    const rows = [...document.querySelectorAll('#receiverList tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => one(textOf(td) || td.textContent))).filter((r) => r.length >= 2);
    out.to = rows.length
      ? rows.map((r) => (r[2] ? `${r[1]}(${r[2]})` : r[1])).filter(Boolean).join(', ')
      : one(`${textOf(document.querySelector('#detail-view-receiver-info'))} ${textOf(document.querySelector('#detail-receiver-count'))}`);
    out.date = after(textOf(document.querySelector('.message-datetime')));
    out.text = textOf(document.querySelector('#htmlContentArea'));
    const base = document.querySelector('#fileDownUrl')?.value || '/eClassVer4/Message/FileDown';
    for (const el of document.querySelectorAll('.attachmentArea .link-like, #message-view .link-like')) {
      const v = (id) => String(el.querySelector(`[id="${id}"]`)?.value ?? '');
      const name = one(v('fFileName')) || one(textOf(el));
      const q = ['sId', 'fId', 'fFileName', 'fFileType', 'fFileSize'].map((k) => `${k}=${encodeURIComponent(v(k === 'sId' ? 'f_sId' : k))}`).join('&');
      addAtt({ name, size: Number(v('fFileSize')) || bytesOf(textOf(el)), sizeText: '', url: new URL(`${base}?${q}`, location.href).href }, el);
    }
    out.messages.push({ from: out.from, to: out.to, cc: '', date: out.date, text: out.text, attachments: out.attachments.slice() });
    capEl = main;
  } else {
    // 그 밖의 페이지 — 제목·글자와 파일 링크.
    out.subject = one(document.title);
    out.text = textOf(document.body);
    const FILE = /\.(pdf|hwpx?|docx?|xlsx?|pptx?|csv|txt|rtf|zip|7z|png|jpe?g|gif|bmp|webp|tiff?|eml|msg|vcf|ics)$/i;
    for (const a of document.querySelectorAll('a[href]')) {
      if (out.attachments.length >= 30) break;
      let u;
      try {
        u = new URL(a.getAttribute('href'), location.href);
      } catch {
        continue;
      }
      if (!/^(https?|blob):$/.test(u.protocol)) continue;
      let last = u.pathname.split('/').pop() || '';
      try {
        last = decodeURIComponent(last);
      } catch { /* 그대로 */ }
      const text = one(a.innerText || a.textContent);
      if (!a.hasAttribute('download') && !FILE.test(last) && !FILE.test(text)) continue;
      const name = one(a.getAttribute('download')) || (FILE.test(last) ? last : '') || (FILE.test(text) ? text : '') || last || 'download';
      addAtt({ name, size: 0, sizeText: '', url: u.href }, a);
    }
  }
  if (out.messages.length) {
    const first = out.messages[0];
    Object.assign(out, { from: first.from, to: first.to, cc: first.cc, date: first.date, text: first.text });
  }
  if (mark) {
    for (const [key, el] of marks) el.setAttribute('data-krs-attach', key);
    let at = capEl;
    let frame = null;
    if (at && window !== window.top) {
      // 틀 안의 메일 — 맨 위 문서의 그 틀에 단다(맨 위 바로 아래의 같은 출처 틀일 때만 — pagecap 의 matchFrame 이 맞춘다).
      try {
        const fe = window.frameElement;
        if (fe && window.parent === window.top) {
          frame = { href: location.href, src: fe.getAttribute('src') || '', name: window.name || '', w: window.innerWidth, h: window.innerHeight };
          at = fe;
        } else at = null;
      } catch {
        at = null;
      }
    }
    if (at) {
      at.setAttribute('data-krs-cap', 'mail');
      out.marked = true;
      out.part = { n: 'mail', tag: at.tagName.toLowerCase(), title: out.subject || out.title, frame };
    }
  }
  return out;
}

/** 표시를 뗀다 — 첨부 카드의 data-krs-attach 와 메일 칸의 data-krs-cap="mail". 뗀 수를 준다. */
export function mailUnmark() {
  let n = 0;
  for (const x of document.querySelectorAll('[data-krs-attach]')) {
    x.removeAttribute('data-krs-attach');
    n++;
  }
  for (const x of document.querySelectorAll('[data-krs-cap="mail"]')) {
    x.removeAttribute('data-krs-cap');
    n++;
  }
  return n;
}

/** Outlook 첨부 미리보기를 닫는다 — 대화 상자의 "닫기"(Close) 단추. 화면만 바뀐다(메일은 그대로). 닫기 단추가 없으면 false. */
export function mailUnpreview() {
  const label = (s) => String(s ?? '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const d of document.querySelectorAll('.fui-DialogSurface[role=dialog], [role=dialog]')) {
    const btns = [...d.querySelectorAll('button')].filter((b) => !b.closest('[role=listbox]'));
    if (!btns.some((b) => /^(다운로드|Download)$/i.test(label(b.getAttribute('aria-label') || b.innerText)))) continue;
    const close = btns.find((b) => /^(닫기|Close)$/i.test(label(b.getAttribute('aria-label') || b.innerText)));
    if (close) {
      close.click();
      return true;
    }
  }
  return false;
}

/**
 * 첨부 원본을 받는다 — **페이지 세계(world: 'MAIN')에서** 돈다. items 는 이름이거나 mailProbe 의 첨부 칸({key?, name, id?, url?, size?})이다.
 *   · url 이 있으면(eclass 쪽지·그 밖의 페이지) 같은 출처에서 쿠키를 실어 받는다.
 *   · Outlook 이면 미리보기가 그 파일을 보이고 있으면 미리보기의 "다운로드"를, 아니면 카드(번호 표시 data-krs-attach → id → 이름 차례로
 *     찾는다)의 "기타 작업" → "다운로드" 를 누르고, 페이지가 만드는 blob 을 가로챈다(원래 내려받기는 일어나지 않는다). 그 밖의 단추는
 *     누르지 않는다. 메뉴가 남아 있으면 그 메뉴에 Escape 를 보낸다.
 * 파일마다 한도(maxBytes)를 넘으면 받지 않는다. waitMs 는 첨부 하나를, menuMs 는 메뉴가 뜨기를 기다리는 한도다. 결과는 JSON 으로
 * 건너오니 바이트는 base64 다.
 * @returns {Promise<({name: string, type: string, size: number, base64: string}|{name: string, error: string})[]>}
 */
export async function mailFetch(items, { maxBytes = 30 * 1024 * 1024, waitMs = 20000, menuMs = 6000 } = {}) {
  const one = (s) => String(s ?? '').replace(/[ ​﻿]/g, ' ').replace(/\s+/g, ' ').trim();
  const label = (s) => String(s ?? '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();   // 메뉴 글자 앞의 아이콘 글꼴 글자를 뺀다
  const mb = (n) => `${(n / 1048576).toFixed(1).replace(/\.0$/, '')}MB`;
  const tooBig = (name, n) => ({ name, error: `${mb(n)}로 한 파일의 한도(${mb(maxBytes)})를 넘어 가져오지 않았습니다 — 메일에서 내려받아 직접 넣어 주세요.` });
  const b64 = (blob) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = () => rej(fr.error || new Error('파일을 읽지 못했습니다.'));
    fr.readAsDataURL(blob);
  });
  const pack = async (name, blob) => (blob.size > maxBytes ? tooBig(name, blob.size) : { name, type: blob.type || '', size: blob.size, base64: await b64(blob) });
  const fromUrl = async (name, url) => {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const len = Number(r.headers.get('content-length')) || 0;
    if (len > maxBytes) return tooBig(name, len);
    const blob = await r.blob();
    if (/^text\/html/i.test(blob.type || '') && !/\.html?$/i.test(name)) throw new Error('파일 대신 웹페이지가 왔습니다(로그인이 풀렸거나 파일이 없습니다)');
    return pack(name, blob);
  };
  // 화면이 바뀌기를 기다린다 — MutationObserver 라 뒤 탭의 타이머 늦춤에 묶이지 않는다. 한도 타이머 하나만 쓴다.
  const until = (check, ms) => new Promise((resolve) => {
    const now = check();
    if (now) return resolve(now);
    let done = false;
    const end = (v) => {
      if (done) return;
      done = true;
      mo.disconnect();
      clearTimeout(timer);
      resolve(v);
    };
    const mo = new MutationObserver(() => {
      const v = check();
      if (v) end(v);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => end(check() || null), ms);
  });
  const cardId = (opt) => {
    const drag = opt.querySelector('[draggable="true"]');
    if (!drag) return '';
    try {
      const dt = new DataTransfer();
      drag.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }));
      const j = JSON.parse(dt.getData('attachment') || 'null');
      drag.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
      return String(j?.attachmentFiles?.[0]?.attachmentItemId || '');
    } catch {
      return '';
    }
  };
  const cardName = (opt) => one([...opt.querySelectorAll('[title]')].find((x) => !x.closest('button'))?.getAttribute('title'));
  const menuItem = () => [...document.querySelectorAll('[role=menu] [role=menuitem]')].find((x) => /^(다운로드|Download)$/i.test(label(x.innerText || x.textContent))) || null;

  // 페이지가 내려받기로 누르는 <a download href="blob:…"> 를 가로챈다. 감싼 것은 끝에 반드시 되돌린다(있던 그대로 — 없던 속성은 지운다).
  const intercept = (trigger) => new Promise((resolve) => {
    const blobs = new Map();
    const keep = [[URL, 'createObjectURL'], [HTMLAnchorElement.prototype, 'click'], [EventTarget.prototype, 'dispatchEvent']]
      .map(([o, k]) => [o, k, Object.getOwnPropertyDescriptor(o, k)]);
    const origCreate = URL.createObjectURL;
    const origClick = HTMLAnchorElement.prototype.click;
    const origDispatch = EventTarget.prototype.dispatchEvent;
    let done = false;
    let timer = 0;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const [o, k, d] of keep) {
        if (d) Object.defineProperty(o, k, d);
        else delete o[k];
      }
      resolve(v);
    };
    const caught = (a) => {
      const href = String(a.href || '');
      if (!a.hasAttribute('download') && !/^blob:/i.test(href)) return false;
      finish({ href, name: a.getAttribute('download') || '', blob: blobs.get(href) || null });
      return true;
    };
    try {
      URL.createObjectURL = function (obj) {
        const u = origCreate.call(this, obj);
        if (obj instanceof Blob) blobs.set(u, obj);
        return u;
      };
      HTMLAnchorElement.prototype.click = function () {
        if (!done && caught(this)) return undefined;
        return origClick.call(this);
      };
      EventTarget.prototype.dispatchEvent = function (ev) {
        if (!done && this instanceof HTMLAnchorElement && ev && ev.type === 'click' && caught(this)) return false;
        return origDispatch.call(this, ev);
      };
      timer = setTimeout(() => finish(null), waitMs);
      Promise.resolve().then(trigger).catch((e) => finish({ error: String(e?.message || e) }));
    } catch (e) {
      finish({ error: String(e?.message || e) });
    }
  });

  // Outlook — 카드의 "기타 작업" 메뉴에서 "다운로드".
  const viaMenu = async (opt) => {
    const more = opt.querySelector('button[aria-haspopup]');
    if (!more) throw new Error('첨부의 메뉴 단추(기타 작업)를 찾지 못했습니다');
    more.click();
    const item = await until(menuItem, menuMs);
    if (!item) throw new Error('첨부 메뉴에 "다운로드" 가 없습니다');
    item.click();
  };
  // 미리보기 대화 상자의 명령 띠 — 그 파일 이름이 보이는 띠의 "다운로드".
  const previewButton = (name) => {
    for (const d of document.querySelectorAll('.fui-DialogSurface[role=dialog], [role=dialog]')) {
      const dl = [...d.querySelectorAll('button')].find((b) => !b.closest('[role=listbox]') && /^(다운로드|Download)$/i.test(label(b.getAttribute('aria-label') || b.innerText)));
      if (!dl) continue;
      for (let bar = dl.parentElement; bar && bar !== d; bar = bar.parentElement) {
        const t = [...bar.querySelectorAll('[title]')].find((x) => !x.closest('[role=listbox], button') && /\.[a-z0-9]{1,5}$/i.test(one(x.getAttribute('title'))));
        if (t) {
          if (one(t.getAttribute('title')) === name) return dl;
          break;
        }
      }
    }
    return null;
  };

  const outlook = /(^|\.)outlook\.(cloud\.microsoft|office\.com|office365\.com|live\.com)$/i.test(location.hostname);
  if (window.__krsMailFetch) return (items || []).map((x) => ({ name: one(typeof x === 'string' ? x : x?.name), error: '이미 다른 첨부를 가져오는 중입니다 — 끝난 뒤 다시 해 주세요.' }));
  window.__krsMailFetch = true;
  const res = [];
  try {
    for (const raw of items || []) {
      const it = typeof raw === 'string' ? { name: raw } : raw || {};
      const name = one(it.name);
      try {
        if (it.size && it.size > maxBytes) {
          res.push(tooBig(name, it.size));
          continue;
        }
        if (it.url) {
          res.push(await fromUrl(name, it.url));
          continue;
        }
        if (!outlook) throw new Error('받을 주소가 없습니다');
        const pv = previewButton(name);
        let card = null;
        if (!pv) {
          const marked = it.key != null ? document.querySelector(`[role=option][data-krs-attach="${String(it.key).replace(/"/g, '')}"]`) : null;
          const cards = [...document.querySelectorAll('[role=listbox] [role=option]')];
          card = (marked && (!name || cardName(marked) === name) ? marked : null)
            || (it.id && cards.find((o) => cardId(o) === it.id)) || cards.find((o) => cardName(o) === name) || null;
        }
        if (!pv && !card) throw new Error('메일에서 이 첨부를 찾지 못했습니다 — 메일을 연 채로 다시 해 주세요');
        const got = await intercept(() => (pv ? pv.click() : viaMenu(card)));
        if (!got) throw new Error(`${Math.round(waitMs / 1000)}초 안에 받지 못했습니다`);
        if (got.error) throw new Error(got.error);
        let blob = got.blob;
        if (!blob && /^blob:/i.test(got.href)) blob = await (await fetch(got.href)).blob();
        res.push(blob ? await pack(name || one(got.name), blob) : await fromUrl(name || one(got.name), got.href));
      } catch (e) {
        res.push({ name, error: String(e?.message || e) });
      } finally {
        const menu = outlook && document.querySelector('[role=menu]');
        if (menu) {
          const at = menu.contains(document.activeElement) ? document.activeElement : menu;
          for (const type of ['keydown', 'keyup']) at.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
        }
      }
    }
  } finally {
    delete window.__krsMailFetch;
  }
  return res;
}

/* ------------------------------------------------------------ 순수 셈 */

const MIME = {
  pdf: 'application/pdf',
  hwp: 'application/x-hwp',
  hwpx: 'application/hwp+zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  rtf: 'application/rtf',
  htm: 'text/html',
  html: 'text/html',
  xml: 'application/xml',
  json: 'application/json',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  eml: 'message/rfc822',
  msg: 'application/vnd.ms-outlook',
  vcf: 'text/vcard',
  ics: 'text/calendar',
};

/** 이름의 확장자로 본 MIME 형식 — 모르는 확장자면 ''. Outlook 은 첨부를 application/octet-stream 으로 주므로 이것으로 바로잡는다. */
export function mimeOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || '').trim());
  return (m && MIME[m[1].toLowerCase()]) || '';
}

/** 파일 이름 — 경로 구분자와 파일 이름에 못 쓰는 글자만 바꾼다(원래 이름을 지킨다). 비면 'attachment'. */
export function cleanName(name) {
  const s = String(name || '').replace(/[\u0000-\u001f]/g, '').replace(/[\\/:*?"<>|]/g, '_').trim();
  return s || 'attachment';
}

/** 같은 이름이 이미 있으면 "이름 (2).확장자" — 공문 첨부 화면은 같은 이름을 받지 않는다. taken 에 쓴 이름(소문자)을 넣는다. */
export function uniqueName(name, taken) {
  const m = /^(.*?)(\.[a-z0-9]{1,5})?$/i.exec(name);
  let out = name;
  for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${m[1]} (${n})${m[2] || ''}`;
  taken.add(out.toLowerCase());
  return out;
}

/**
 * 받은 바이트를 File 로 — 이름은 그대로(못 쓰는 글자만 바꾼다), 형식은 확장자로 아는 것이면 그것, 아니면 받은 형식, 그것도 없으면
 * application/octet-stream. 바이트는 바꾸지 않는다.
 */
export function fileOf({ name, type = '', base64 = '' }, { File: FileCtor = globalThis.File } = {}) {
  const bin = atob(String(base64 || ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const given = String(type || '').toLowerCase() === 'application/octet-stream' ? '' : String(type || '');
  return new FileCtor([bytes], cleanName(name), { type: mimeOf(name) || given || 'application/octet-stream' });
}

/** Content-Disposition 의 파일 이름 — filename*=UTF-8''… 를 먼저, 없으면 filename="…". 없으면 ''. */
export function dispositionName(header) {
  const h = String(header || '');
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(h);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''));
    } catch { /* 아래로 */ }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(h);
  return plain ? String(plain[2] ?? plain[1]).trim() : '';
}

/**
 * 주소로 본 메일 화면 — 'outlook'(Outlook 웹의 /mail 아래) | 'eclass'(eclass 쪽지 …Detail — 포털 틀 안이면 menu 칸으로 본다) | ''.
 * 스크립트를 넣기 전에 가린다 — 보통 웹페이지는 메일로 치지 않는다.
 */
export function mailSiteOf(url) {
  let u;
  try {
    u = new URL(String(url || ''));
  } catch {
    return '';
  }
  if (/(^|\.)outlook\.(cloud\.microsoft|office\.com|office365\.com|live\.com)$/i.test(u.hostname) && /^\/mail(\/|$)/i.test(u.pathname)) return 'outlook';
  if (/^eclass\.krs\.co\.kr$/i.test(u.hostname)) {
    const DETAIL = /^\/eClassVer4\/Message\/\w*Detail(\/|$|\?)/i;
    if (DETAIL.test(u.pathname)) return 'eclass';
    if (DETAIL.test(u.searchParams.get('menu') || '')) return 'eclass';
  }
  return '';
}

/** Outlook 웹 주소인가(어느 화면이든). */
export function isOutlookUrl(url) {
  try {
    return /(^|\.)outlook\.(cloud\.microsoft|office\.com|office365\.com|live\.com)$/i.test(new URL(String(url)).hostname);
  } catch {
    return false;
  }
}

/**
 * 끌어 놓은 것에 무엇이 있나 — dragover 처럼 글자를 못 읽을 때(types 만 있을 때)도 쓴다. 파일(Files)이면 false — 그것은 패널이
 * 원래 받는 길이다. Outlook 카드('attachment')·크롬의 DownloadURL·링크(text/uri-list)면 true.
 */
export function dropReady(types) {
  const t = [...(types || [])];
  if (t.includes('attachment')) return true;
  if (t.includes('Files')) return false;
  return t.includes('DownloadURL') || t.includes('text/uri-list');
}

/**
 * 끌어 놓은 것을 읽는다 — drop 처리기 안에서 곧바로 불러야 한다(dataTransfer 는 drop 이 끝나면 비고, await 뒤에는 못 읽는다).
 *   · Outlook 첨부 카드 — 'attachment' 형식의 JSON(카드에 dragstart 를 쏘면 Outlook 이 채우는 것 — 실측). → {kind: 'outlook', items}
 *     **다른 출처(Outlook 탭 → 확장 패널)로 진짜로 끌어 놓았을 때 이 형식이 건너오는지는 아직 실측하지 못했다**(뒤 탭에서는 마우스 끌기가
 *     시작되지 않아 CDP 로도 보지 못했다) — 건너오지 않으면 null 이 되고, 부르는 쪽은 캡처 단추를 권한다.
 *   · 파일(Files)이 실려 있으면 null — 패널이 원래 받는 길(intake)로 간다.
 *   · DownloadURL("형식:이름:주소" — 크롬의 끌어 내려받기)·text/uri-list(링크) → {kind: 'links', urls, items: [{url, name}]}
 *   · 그 밖은 null.
 * @param {{types: Iterable<string>, getData: (type: string) => string}} dt
 * @returns {{kind: 'outlook', items: {name: string, size: number, id: string, type?: string}[]}|{kind: 'links', urls: string[], items: {url: string, name: string}[]}|null}
 */
export function parseDrop(dt) {
  if (!dt || typeof dt.getData !== 'function') return null;
  const types = [...(dt.types || [])];
  const get = (t) => {
    try {
      return String(dt.getData(t) || '');
    } catch {
      return '';
    }
  };
  if (types.includes('attachment')) {
    try {
      const j = JSON.parse(get('attachment'));
      const files = Array.isArray(j?.attachmentFiles) ? j.attachmentFiles : [];
      const items = files.filter((f) => f && f.name).map((f) => ({
        name: String(f.name).trim(), size: Number(f.size) || 0, id: String(f.attachmentItemId || ''), ...(f.ContentType ? { type: String(f.ContentType) } : {}),
      }));
      if (items.length) return { kind: 'outlook', items };
    } catch { /* 아래로 */ }
  }
  if (types.includes('Files')) return null;
  const items = [];
  const push = (url, name = '') => {
    if (!/^https?:\/\//i.test(url) || items.some((x) => x.url === url)) return;
    items.push({ url, name });
  };
  if (types.includes('DownloadURL')) {
    const m = /^([^:]*):([^:]*):(.+)$/.exec(get('DownloadURL').trim());
    if (m) push(m[3].trim(), m[2].trim());
  }
  if (types.includes('text/uri-list')) {
    for (const line of get('text/uri-list').split(/\r?\n/)) {
      const l = line.trim();
      if (l && !l.startsWith('#')) push(l);
    }
  }
  return items.length ? { kind: 'links', urls: items.map((x) => x.url), items } : null;
}

const LABEL = { outlook: '메일', eclass: '쪽지', page: '웹페이지' };
const CUT = '\n…(너무 길어 여기서 잘랐습니다)';

/** 본문 글자를 다듬는다 — 줄마다 앞뒤 빈칸을 지우고 빈칸·빈 줄은 하나로(pagecap 의 normalizeText 와 같은 다듬기, 머리말은 따로 붙인다). */
function tidy(raw) {
  const out = [];
  for (const l of String(raw || '').replace(/\r\n?/g, '\n').replace(/[ ​﻿]/g, ' ').replace(/[\t ]+/g, ' ').split('\n').map((x) => x.trim())) {
    if (!l && !out.at(-1)) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * 읽기(공문 읽기·LLM)에 보낼 메일 글 — 머리말과 머리 칸, 본문. 대화면 펼친 메일마다 차례로(새 메일이 앞) 잇는다. max 를 넘으면 뒤(오래된
 * 메일)부터 잘린다 — 잘림 표시까지 max 안이다.
 *   [메일 — 제목]
 *   보낸 사람: …
 *   받는 사람: …
 *   참조: …
 *   날짜: …
 *   첨부: 이름 (크기), …
 *
 *   본문…
 */
export function mailText(mail, { max = TEXT_MAX } = {}) {
  if (!mail) return '';
  const msgs = mail.messages?.length ? mail.messages : [{ from: mail.from, to: mail.to, cc: mail.cc, date: mail.date, text: mail.text, attachments: mail.attachments }];
  const lines = [`[${LABEL[mail.site] || '메일'}${mail.subject ? ` — ${oneLine(mail.subject)}` : ''}]${mail.site === 'page' && mail.url ? ` ${mail.url}` : ''}`];
  msgs.forEach((m, i) => {
    if (i > 0) lines.push('', `── 앞선 메일 ${i + 1}/${msgs.length} ──`);
    if (m.from) lines.push(`보낸 사람: ${oneLine(m.from)}`);
    if (m.to) lines.push(`받는 사람: ${oneLine(m.to)}`);
    if (m.cc) lines.push(`참조: ${oneLine(m.cc)}`);
    if (m.date) lines.push(`날짜: ${oneLine(m.date)}`);
    const att = (m.attachments || []).filter((a) => a?.name).map((a) => (a.sizeText ? `${a.name} (${a.sizeText})` : a.name));
    if (att.length) lines.push(`첨부: ${att.join(', ')}`);
    const body = tidy(m.text);
    if (body) lines.push('', body);
  });
  let s = lines.join('\n').trim();
  if (s.length > max) s = `${s.slice(0, Math.max(0, max - CUT.length)).trimEnd()}${CUT}`;
  return s;
}

/** 무엇을 가져왔나 한 줄 — 메일 「제목」 · 대화 2통 · 첨부 2개 · 못 가져온 첨부 1개. */
export function grabWhat(mail, files = [], failed = []) {
  if (!mail) return '';
  const parts = [`${LABEL[mail.site] || '메일'}${mail.subject ? ` 「${oneLine(mail.subject)}」` : ''}`];
  const n = mail.messages?.length || 0;
  if (n > 1) parts.push(`대화 ${n}통`);
  if (!n && mail.preview?.open) parts.push('본문 없음(첨부 미리보기)');
  if (files.length) parts.push(`첨부 ${files.length}개`);
  if (failed.length) parts.push(`못 가져온 첨부 ${failed.length}개`);
  return parts.join(' · ');
}

/**
 * 여러 틀(frame)에서 돌린 mailProbe 중 메일이 든 것 — Outlook·eclass 쪽지를 먼저, 그다음 메일 칸·첨부·글이 많은 것. eclass 는 쪽지가
 * 포털의 틀 안에 뜨기도 한다(Common/Default?menu=…). 없으면 null.
 * @param {{frameId: number, result: object|null}[]} results executeScript({allFrames: true}) 의 결과
 */
export function pickFrame(results) {
  const ok = (results || []).filter((r) => r && r.result);
  const rank = (r) => (r.result.site === 'page' ? 0 : 1e9) + (r.result.messages?.length ? 1e8 : 0) + (r.result.preview ? 1e7 : 0)
    + Math.min(r.result.attachments?.length || 0, 9) * 1e6 + Math.min(String(r.result.text || '').length, 999999) + (r.frameId === 0 ? 0.5 : 0);
  return ok.sort((a, b) => rank(b) - rank(a))[0] || null;
}

/* ------------------------------------------------------------ 차례 (chrome 을 밖에서 받는다) */

/**
 * 첨부 목록을 하나씩 받는다 — 한 번에 하나(결과가 크면 확장 메시지 한도에 걸리니)씩 execMain(mailFetch) 로. 받은 것은 File, 못 받은 것은
 * failed 에 까닭과 함께. 같은 이름은 "(2)" 를 붙여 겹치지 않게 한다.
 * @returns {Promise<{files: File[], failed: {name: string, why: string}[]}>}
 */
export async function grabItems({ items, execMain, onStatus = () => {}, maxBytes = MAX_FILE_BYTES, waitMs = FETCH_WAIT_MS, File: FileCtor = globalThis.File }) {
  const files = [];
  const failed = [];
  const taken = new Set();
  const list = (items || []).filter((a) => a && a.name);
  for (const [i, a] of list.entries()) {
    onStatus(`첨부 ${i + 1}/${list.length} 가져오는 중 — ${a.name}`);
    if (a.size && a.size > maxBytes) {
      failed.push({ name: a.name, why: `${(a.size / 1048576).toFixed(1)}MB로 한 파일의 한도(${Math.round(maxBytes / 1048576)}MB)를 넘어 가져오지 않았습니다 — 메일에서 내려받아 직접 넣어 주세요.` });
      continue;
    }
    let r = null;
    try {
      r = (await execMain(mailFetch, [[a], { maxBytes, waitMs }]))?.[0] || null;
    } catch (e) {
      r = { name: a.name, error: `탭에서 받지 못했습니다 — ${e?.message || e}` };
    }
    if (r && !r.error && typeof r.base64 === 'string') files.push(fileOf({ ...r, name: uniqueName(cleanName(r.name || a.name), taken) }, { File: FileCtor }));
    else failed.push({ name: a.name, why: r?.error || '가져오지 못했습니다' });
  }
  return { files, failed };
}

/**
 * 메일을 통째로 가져온다 — 읽고(mailProbe), 첨부를 하나씩 받는다(grabItems). 미리보기만 열려 본문이 없으면 그 파일만 받고 notes 에 적는다
 * (unpreview 면 미리보기를 닫고 다시 읽는다 — 기본은 닫지 않는다). mark 면 메일 칸·카드에 표시를 남긴다(부르는 쪽이 찍는다).
 * capture 가 있으면 메일 칸을 그림으로도 찍는다(pages — 실패해도 글과 파일은 준다).
 * @param {{exec: (func: Function, args?: any[]) => Promise<any>, execMain?: Function, capture?: ((mail: object) => Promise<any>)|null, mark?: boolean,
 *   onStatus?: (msg: string) => void, wait?: (ms: number) => Promise<void>, maxBytes?: number, waitMs?: number, textMax?: number, unpreview?: boolean}} deps
 * @returns {Promise<{mail: object, text: string, files: File[], failed: {name: string, why: string}[], notes: string[], what: string, pages?: any}>}
 */
export async function grabMail({ exec, execMain = exec, capture = null, mark = !!capture, onStatus = () => {}, wait = sleep, maxBytes = MAX_FILE_BYTES, waitMs = FETCH_WAIT_MS, textMax = TEXT_MAX, unpreview = false, File: FileCtor = globalThis.File }) {
  const probe = () => exec(mailProbe, [{ mark }]);
  onStatus('메일을 읽는 중…');
  let mail = await probe();
  if (!mail) throw new Error('메일을 읽지 못했습니다 — 메일을 연 탭을 앞에 두고 다시 하세요.');
  const notes = [];
  if (mail.preview?.open && !mail.messages?.length && unpreview && (await Promise.resolve(exec(mailUnpreview, [])).catch(() => false))) {
    onStatus('첨부 미리보기를 닫고 메일을 다시 읽는 중…');
    for (let t = 0; t < UNPREVIEW_MS; t += 500) {
      await wait(500);
      const again = await Promise.resolve(probe()).catch(() => null);
      if (again?.messages?.length) {
        mail = again;
        notes.push('첨부 미리보기를 닫고 메일 전체를 가져왔습니다.');
        break;
      }
    }
  }
  if (mail.preview?.open && !mail.messages?.length) notes.push(PREVIEW_NOTE);
  if (mail.site === 'page' && !mail.attachments?.length) notes.push('이 페이지에서 첨부 파일 링크를 찾지 못해 글만 가져왔습니다.');
  const { files, failed } = await grabItems({ items: mail.attachments, execMain, onStatus, maxBytes, waitMs, File: FileCtor });
  const out = { mail, text: mailText(mail, { max: textMax }), files, failed, notes, what: grabWhat(mail, files, failed) };
  if (capture && mail.marked) {
    onStatus('메일 화면을 찍는 중…');
    try {
      out.pages = await capture(mail);
    } catch (e) {
      notes.push(`메일 화면은 찍지 못했습니다 — ${e?.message || e}`);
    }
  }
  onStatus('');
  return out;
}

/**
 * 끌어 놓은 링크를 패널에서 받는다 — 확장의 사이트 권한으로 받으니 CORS 에 막히지 않고 그 사이트의 쿠키가 실린다. 이름은 끌어 온 이름,
 * 없으면 Content-Disposition, 그것도 없으면 주소의 끝.
 * @returns {Promise<{files: File[], failed: {name: string, why: string}[]}>}
 */
export async function fetchLinks({ items, fetch: fetchFn = globalThis.fetch, onStatus = () => {}, maxBytes = MAX_FILE_BYTES, File: FileCtor = globalThis.File }) {
  const files = [];
  const failed = [];
  const taken = new Set();
  const list = items || [];
  const over = (n) => `${(n / 1048576).toFixed(1)}MB로 한 파일의 한도(${Math.round(maxBytes / 1048576)}MB)를 넘었습니다`;
  for (const [i, it] of list.entries()) {
    let name = String(it.name || '').trim();
    if (!name) {
      try {
        name = decodeURIComponent(new URL(it.url).pathname.split('/').pop() || '');
      } catch {
        name = '';
      }
    }
    onStatus(`파일 ${i + 1}/${list.length} 가져오는 중${name ? ` — ${name}` : ''}`);
    try {
      const r = await fetchFn(it.url, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const len = Number(r.headers?.get?.('content-length')) || 0;
      if (len > maxBytes) throw new Error(over(len));
      name = String(it.name || '').trim() || dispositionName(r.headers?.get?.('content-disposition')) || name || 'download';
      const blob = await r.blob();
      if (blob.size > maxBytes) throw new Error(over(blob.size));
      if (/^text\/html/i.test(blob.type) && !/\.html?$/i.test(name)) throw new Error('파일 대신 웹페이지가 왔습니다(로그인이 필요하거나 파일 주소가 아닙니다)');
      const given = blob.type && blob.type !== 'application/octet-stream' ? blob.type : '';
      files.push(new FileCtor([blob], uniqueName(cleanName(name), taken), { type: mimeOf(name) || given || 'application/octet-stream' }));
    } catch (e) {
      failed.push({ name: name || it.url, why: String(e?.message || e) });
    }
  }
  return { files, failed };
}

/* ------------------------------------------------------------ chrome 에 꽂기 */

const ALL_SITES = { origins: ['<all_urls>'] };

function needApi(api) {
  if (!api?.tabs?.query || !api?.scripting?.executeScript || !api?.windows?.getCurrent) throw new Error('이 브라우저에서는 탭의 메일을 가져올 수 없습니다.');
}

/**
 * 사이트 접근 권한. eclass 는 매니페스트에 있고, Outlook 은 optional_host_permissions 의 <all_urls> 가 든다(pagecap 의 캡처와 같은 권한 —
 * 한 번 허용하면 남는다). 그 사이트를 이미 받았는지 먼저 보고(싸다), 없을 때만 묻는다. 묻기(permissions.request)는 사용자 동작 안이어야
 * 한다 — 단추 누름은 되고, 끌어 놓기(drop)는 사용자 동작으로 치지 않을 수 있어 그때는 캡처 단추를 한 번 눌러 허용하라고 적는다.
 */
async function ensureAccess(api, url, { fromDrop = false } = {}) {
  if (!api.permissions?.contains) return;
  let want = ALL_SITES;
  try {
    want = { origins: [`${new URL(String(url)).origin}/*`] };
  } catch { /* 모든 사이트로 */ }
  if (await api.permissions.contains(want)) return;
  let ok = false;
  try {
    ok = await api.permissions.request(ALL_SITES);
  } catch (e) {
    if (fromDrop) throw new Error('메일 탭에서 첨부를 가져오려면 사이트 접근 권한이 필요합니다 — 캡처 단추를 한 번 눌러 허용한 뒤 다시 끌어 놓으세요.');
    throw new Error(`사이트 접근 권한을 묻지 못했습니다 — ${e?.message || e}`);
  }
  if (!ok) throw new Error('메일을 가져오려면 사이트 접근 권한이 필요합니다 — 다시 누르고 허용해 주세요.');
}

/** 패널이 있는 창의 앞 탭. */
async function frontOf(api) {
  const win = await api.windows.getCurrent();
  const [tab] = await api.tabs.query({ active: true, windowId: win.id });
  return tab ? { ...tab, windowId: tab.windowId ?? win.id } : null;
}

/** 탭(과 틀)에서 함수를 돌리는 손잡이 — world 가 'MAIN' 이면 페이지 세계에서. */
function runner(api, tabId, frameId = 0, world = 'ISOLATED') {
  return async (func, args = []) => (await api.scripting.executeScript({
    target: frameId ? { tabId, frameIds: [frameId] } : { tabId }, world, func, args,
  }))?.[0]?.result;
}

/**
 * 메일이 든 틀의 frameId — Outlook·eclass 쪽지 화면은 맨 위 문서(0)이고, eclass 포털(Common/Default?menu=…)이면 모든 틀에서 읽어
 * 고른다(pickFrame — dragstart 는 쏘지 않는다). 못 고르면 null.
 */
async function frameOf(api, tab) {
  if (mailSiteOf(tab.url) && !/[?&]menu=/i.test(String(tab.url))) return 0;
  const all = await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mailProbe, args: [{ ids: false }] }).catch(() => []);
  const hit = pickFrame(all);
  return hit ? hit.frameId || 0 : null;
}

/** 메일이 든 틀을 찾아 읽는다(mark 면 표시하며). @returns {Promise<{frameId: number, mail: object}|null>} */
async function locate(api, tab, { mark = false } = {}) {
  const frameId = await frameOf(api, tab);
  if (frameId == null) return null;
  const mail = await runner(api, tab.id, frameId)(mailProbe, [{ mark }]);
  return mail ? { frameId, mail } : null;
}

/** probeTab·grabTab 이 주는 메일의 머리 칸. */
const headOf = (mail) => ({ site: mail.site, subject: mail.subject, from: mail.from, to: mail.to, cc: mail.cc, date: mail.date, url: mail.url });

/**
 * 탭이 메일 화면인지 본다 — 캡처 단추(전체·부분)가 먼저 부른다. 주소로 먼저 가려 메일 사이트(Outlook 웹 /mail·eclass 쪽지 …Detail)가
 * 아니면 스크립트를 넣지 않고 null 이다. 열린 메일이 없으면(받은 편지함 목록뿐) 그것도 null. 무엇이 잘못되어도 던지지 않고 null 이다.
 * 메일이면 첨부 카드마다 data-krs-attach="번호", 메일 칸에 data-krs-cap="mail" 을 단다(지난 표시는 먼저 뗀다) — 고르기 막은
 * [data-krs-attach] 를 고를 거리로 삼고, 전체는 part 를 captureTabParts(tab, [part]) 에 넘겨 메일 칸을 찍는다.
 * @param {{id: number, windowId?: number, url: string, title?: string}} tab
 * @returns {Promise<{site: string, subject: string, from: string, to: string, date: string, attachments: {key: string, name: string, size: number,
 *   sizeText: string, preview?: boolean}[], preview: {open: true, name: string}|null, notes: string[], part: object|null, frameId: number}|null>}
 */
export async function probeTab(tab, opts = {}) {
  try {
    if (!tab || !mailSiteOf(tab.url)) return null;
    const api = opts.chrome || globalThis.chrome;
    if (!api?.scripting?.executeScript) return null;
    await ensureAccess(api, tab.url);
    const got = await locate(api, tab, { mark: true });
    const mail = got?.mail;
    if (!mail || mail.site === 'page' || (!mail.messages?.length && !mail.preview)) return null;
    return {
      ...headOf(mail),
      attachments: (mail.attachments || []).map((a) => ({ key: a.key, name: a.name, size: a.size || 0, sizeText: a.sizeText || '', ...(a.preview ? { preview: true } : {}) })),
      preview: mail.preview, notes: mail.preview?.open && !mail.messages?.length ? [PREVIEW_NOTE] : [], part: mail.part, frameId: got.frameId,
    };
  } catch {
    return null;
  }
}

/**
 * 메일을 통째로 — 캡처 단추의 전체. 글(mailText 의 머리 칸 + 본문)과 모든 첨부의 원본 File. 메일 칸의 그림은 찍지 않는다 — 표시
 * (data-krs-cap="mail")를 남겨 두니 부르는 쪽이 part 로 captureTabParts 를 부른다. 미리보기는 닫지 않는다(그 파일만 받고 notes 에 적는다).
 * @param {{id: number, windowId?: number, url: string, title?: string}} tab
 * @param {{today?: string, onStatus?: (msg: string) => void, maxBytes?: number, chrome?: object}} [opts]
 * @returns {Promise<{mail: {site: string, subject: string, from: string, to: string, cc: string, date: string, url: string}, text: string,
 *   files: File[], failed: {name: string, why: string}[], notes: string[], what: string, part: object|null}>}
 */
export async function grabTab(tab, opts = {}) {
  const api = opts.chrome || globalThis.chrome;
  needApi(api);
  if (!mailSiteOf(tab?.url)) throw new Error('메일 화면이 아닙니다 — Outlook 메일이나 eclass 쪽지를 연 탭에서 하세요.');
  await ensureAccess(api, tab.url);
  const frameId = await frameOf(api, tab);
  if (frameId == null) throw new Error('이 탭에서 메일을 읽지 못했습니다 — 메일을 연 채로 다시 하세요.');
  const out = await grabMail({
    exec: runner(api, tab.id, frameId), execMain: runner(api, tab.id, frameId, 'MAIN'), mark: true,
    onStatus: opts.onStatus || (() => {}), maxBytes: opts.maxBytes || MAX_FILE_BYTES,
  });
  if (out.mail.site === 'page' || (!out.mail.messages?.length && !out.mail.preview)) throw new Error('열린 메일이 없습니다 — 메일을 연 채로 다시 하세요.');
  return { mail: headOf(out.mail), text: out.text, files: out.files, failed: out.failed, notes: out.notes, what: out.what, part: out.mail.part || null };
}

/**
 * 고른 첨부만 — 캡처 단추의 부분에서 고르기 막이 준 카드 번호(probeTab 의 key). 메일을 다시 읽어(같은 화면이면 같은 번호다) 그 번호의
 * 첨부를 받는다. 못 찾은 번호는 failed 에 적는다.
 * @param {{id: number, url: string}} tab
 * @param {(string|number)[]} keys
 * @returns {Promise<{files: File[], failed: {name: string, why: string}[]}>}
 */
export async function fetchTab(tab, keys, opts = {}) {
  const api = opts.chrome || globalThis.chrome;
  needApi(api);
  if (!mailSiteOf(tab?.url)) throw new Error('메일 화면이 아닙니다 — Outlook 메일이나 eclass 쪽지를 연 탭에서 하세요.');
  await ensureAccess(api, tab.url);
  const at = await locate(api, tab, { mark: true });
  if (!at) throw new Error('이 탭에서 메일을 읽지 못했습니다 — 메일을 연 채로 다시 하세요.');
  const want = [...new Set((keys || []).map(String))];
  const items = want.map((k) => at.mail.attachments.find((a) => a.key === k)).filter(Boolean);
  const onStatus = opts.onStatus || (() => {});
  const got = await grabItems({ items, execMain: runner(api, tab.id, at.frameId, 'MAIN'), onStatus, maxBytes: opts.maxBytes || MAX_FILE_BYTES });
  for (const k of want) if (!items.some((a) => a.key === k)) got.failed.push({ name: `첨부 ${k}`, why: '메일에서 그 첨부를 다시 찾지 못했습니다 — 다시 골라 주세요.' });
  onStatus('');
  return got;
}

/** 표시를 뗀다 — 모든 틀의 data-krs-attach·data-krs-cap="mail"(mailUnmark). 던지지 않는다. */
export async function unmarkTab(tab, opts = {}) {
  try {
    const api = opts.chrome || globalThis.chrome;
    if (!tab || !mailSiteOf(tab.url) || !api?.scripting?.executeScript) return;
    await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mailUnmark });
  } catch { /* 탭이 닫혔거나 권한이 없다 */ }
}

/**
 * 보고 있는 탭을 통째로 — 메일이 아닌 웹페이지도(파일 링크까지) 받는다. 권한은 단추 누름 안에서 먼저 묻는다. shots 면 메일 칸을 그림으로도
 * 찍는다(pagecap 의 captureTabParts). 캡처 단추는 probeTab·grabTab 을 쓴다 — 이것은 따로 둔 단추 자리다.
 * @param {{shots?: boolean, today?: string, onStatus?: Function, onProgress?: Function, chrome?: object, maxBytes?: number, unpreview?: boolean}} [opts]
 * @returns {Promise<{tab: object, mail: object, text: string, files: File[], failed: object[], notes: string[], what: string, pages?: any}>}
 */
export async function grabFront(opts = {}) {
  const api = opts.chrome || globalThis.chrome;
  needApi(api);
  const tab = await frontOf(api);
  if (!/^https?:\/\//i.test(String(tab?.url || ''))) throw new Error('메일을 연 웹페이지 탭을 앞에 두고 다시 누르세요(브라우저 안쪽 화면·파일은 읽지 못합니다).');
  await ensureAccess(api, tab.url);
  const all = mailSiteOf(tab.url) && !/[?&]menu=/i.test(tab.url)
    ? [{ frameId: 0, result: {} }]
    : await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mailProbe, args: [{ ids: false }] }).catch(() => []);
  const hit = pickFrame(all);
  if (!hit) throw new Error('이 탭에서 메일을 읽지 못했습니다 — 메일을 연 탭을 앞에 두고 다시 누르세요.');
  const frameId = hit.frameId || 0;
  const capture = opts.shots
    ? (mail) => captureTabParts(tab, [mail.part || { n: 'mail', tag: 'div', title: mail.subject || tab.title || '', frame: null }], { today: opts.today || '', onProgress: opts.onProgress || (() => {}) })
    : null;
  const out = await grabMail({
    exec: runner(api, tab.id, frameId), execMain: runner(api, tab.id, frameId, 'MAIN'), capture,
    onStatus: opts.onStatus || (() => {}), maxBytes: opts.maxBytes || MAX_FILE_BYTES, unpreview: !!opts.unpreview,
  });
  if (!opts.shots) await unmarkTab(tab, { chrome: api });
  return { tab: { id: tab.id, url: tab.url, title: tab.title || '', windowId: tab.windowId }, ...out };
}

/**
 * 끌어 놓은 첨부를 가져온다 — 패널의 drop 처리기에서 **await 앞에** 부른다(dataTransfer 는 그 자리에서만 읽힌다; 이 함수는 첫 await
 * 전에 parseDrop 을 끝낸다). 이미 읽은 parseDrop 결과를 주어도 된다.
 *   · Outlook 카드 — 메일 탭(이 창의 앞 탭이 Outlook 이면 그것, 아니면 가장 최근에 본 Outlook 탭)에서 끌어 온 이름만 mailFetch 로 받는다.
 *   · 링크 — 패널에서 받는다(fetchLinks).
 * 알아보지 못한 것이면 던진다(부르는 쪽은 캡처 단추를 권한다).
 * @returns {Promise<{kind: string, files: File[], failed: {name: string, why: string}[], tab?: object}>}
 */
export async function grabDropped(dataTransfer, opts = {}) {
  const drop = dataTransfer && typeof dataTransfer.getData === 'function' ? parseDrop(dataTransfer) : dataTransfer;
  if (!drop || !drop.kind) throw new Error('끌어 놓은 것에서 첨부를 알아보지 못했습니다 — 메일을 연 탭에서 캡처 단추(전체)로 메일과 첨부를 통째로 가져오세요.');
  const onStatus = opts.onStatus || (() => {});
  const maxBytes = opts.maxBytes || MAX_FILE_BYTES;
  const api = opts.chrome || globalThis.chrome;
  if (drop.kind === 'links') {
    if (api?.permissions?.contains) await ensureAccess(api, drop.items?.[0]?.url || drop.urls?.[0], { fromDrop: true });
    return { kind: 'links', ...(await fetchLinks({ items: drop.items || (drop.urls || []).map((url) => ({ url, name: '' })), fetch: opts.fetch, onStatus, maxBytes })) };
  }
  needApi(api);
  let tab = await frontOf(api);
  if (!isOutlookUrl(tab?.url)) {
    const tabs = await api.tabs.query({ url: OUTLOOK_MATCH });
    tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
  }
  if (!tab) throw new Error('첨부를 받을 Outlook 메일 탭을 찾지 못했습니다 — 메일을 연 채로 다시 끌어 놓으세요.');
  await ensureAccess(api, tab.url, { fromDrop: true });
  const got = await grabItems({ items: drop.items, execMain: runner(api, tab.id, 0, 'MAIN'), onStatus, maxBytes });
  onStatus('');
  return { kind: 'outlook', tab: { id: tab.id, url: tab.url, title: tab.title || '' }, ...got };
}
