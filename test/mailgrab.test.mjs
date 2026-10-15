// 메일 통째로 가져오기(src/mailgrab.js) — 끌어 놓은 것 읽기·MIME·파일 만들기·메일 글·주소 가리기(순수), 탭 안의 함수(jsdom 에 실제 Outlook·
// eclass 쪽지 모양을 세운 가짜 페이지 — 2026-10-15 CDP 로 읽은 구조), 첨부 가로채기(가짜 OWA 가 blob 을 만들어 <a download> 를 누른다),
// 차례(가짜 exec)와 chrome 꽂기(가짜 chrome).
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  MAX_FILE_BYTES, PREVIEW_NOTE, mailProbe, mailFetch, mailUnmark, mailUnpreview, mimeOf, cleanName, uniqueName, fileOf, dispositionName,
  mailSiteOf, isOutlookUrl, dropReady, parseDrop, mailText, grabWhat, pickFrame, grabItems, grabMail, fetchLinks,
  probeTab, grabTab, fetchTab, unmarkTab, grabDropped,
} from '../src/mailgrab.js';
import { TEXT_MAX } from '../src/pagecap.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const plain = (x) => JSON.parse(JSON.stringify(x));   // 다른 영역(jsdom)의 객체 — executeScript 처럼 JSON 으로 건너온 꼴로
const b64 = (s) => Buffer.from(s).toString('base64');
const PUA = '';   // Outlook 메뉴 글자 앞의 아이콘 글꼴 글자(U+E000 대 — 실측)

/* ------------------------------------------------------------ 가짜 페이지 */

const OUTLOOK_URL = 'https://outlook.cloud.microsoft/mail/inbox/id/AAQk%3D';

/** 실제 Outlook 읽기 창의 모양(2026-10-15 실측) — 대화 칸에 메일 두 통, 둘째 메일에 첨부 카드 둘. */
const OUTLOOK_HTML = `<body>
<div id="메시지로 건너뛰기-region" role="main" aria-label="읽기 창"><div id="ReadingPaneContainerId">
 <div id="ConversationReadingPaneContainerId">
  <span id="CONV_x_SUBJECT" role="heading" aria-level="3" title="[일정 협의] 진도점검회의 참석 일정">[일정 협의] 진도점검회의 참석 일정</span>
  <div aria-label="2개 메시지">
   <div id="focused" aria-label="전자 메일 메시지">
    <span id="MSG_m1_FROM" role="heading"><span role="button" aria-label="제공: KIM Geohwa">KIM Geohwa</span></span>
    <div data-testid="RecipientWell"><div id="MSG_m1_TO" role="heading"><div id="0" role="presentation" aria-label="받는 사람: 김거화 &lt;kimghw@krs.co.kr&gt;">받는 사람:</div></div></div>
    <div id="MSG_m1_DATETIME" role="heading" data-testid="SentReceivedSavedTime">화 2026-10-14 오후 4:51</div>
    <div id="UniqueMessageBody_2" role="document" aria-label="메시지 본문"><p>안녕하세요.   </p>

<p>참석 가능합니다.</p></div>
   </div>
   <div aria-label="전자 메일 메시지">
    <span id="MSG_m2_FROM" role="heading"><span role="button" aria-label="제공: 이지혜">이지혜&lt;jh@krs.co.kr&gt;</span></span>
    <div data-testid="RecipientWell">
     <div id="MSG_m2_TO" role="heading"><div id="1" role="presentation" aria-label="받는 사람: a@krs.co.kr, b@krs.co.kr">받는 사람:</div></div>
     <div id="MSG_m2_CC" role="heading"><div id="2" role="presentation" aria-label="참조: c@krs.co.kr">참조:</div></div>
    </div>
    <div id="MSG_m2_DATETIME" role="heading" data-testid="SentReceivedSavedTime">화 2026-10-14 오후 3:21</div>
    <div id="MSG_m2_ATTACHMENTS" role="heading">
     <div role="listbox" aria-label="파일 첨부">
      <div role="option" aria-label="양식_수정본.pptx 열기 222KB "><div draggable="true" data-att='{"id":"AAk1","name":"양식_수정본.pptx","size":227305,"ct":"application/octet-stream"}'>
       <div title="양식_수정본.pptx">양식_수정본.pptx</div><div title="222KB">222KB</div></div>
       <button aria-label="기타 작업" title="기타 작업" aria-haspopup="true">${PUA}</button></div>
      <div role="option" aria-label="vcard.vcf 열기 614바이트 "><div draggable="true" data-att='{"id":"AAk2","name":"vcard.vcf","size":614,"ct":"text/x-vcard"}'>
       <div title="vcard.vcf">vcard.vcf</div><div title="614바이트">614바이트</div></div>
       <button aria-label="기타 작업" title="기타 작업" aria-haspopup="true">${PUA}</button></div>
     </div>
     <button type="button">${PUA}\n모두 다운로드</button>
    </div>
    <div id="UniqueMessageBody_2" role="document" aria-label="메시지 본문"><p>발표자료 양식을 보냅니다.</p></div>
   </div>
  </div>
 </div>
</div></div></body>`;

/** 사용자 탭의 미리보기 모양(실측) — 읽기 창은 비고, 대화 상자의 명령 띠에 파일 이름과 다운로드·닫기. */
const PREVIEW_HTML = `<body>
<div role="main" aria-label="읽기 창"><div id="ReadingPaneContainerId"></div></div>
<div class="fui-DialogSurface" role="dialog"><i role="none"></i>
 <div role="region" aria-label="명령 도구 모음"><div>PowerPoint</div><div title="양식_수정본.pptx">양식_수정본.pptx</div>
  <div class="fui-Toolbar" role="toolbar">
   <button aria-label="PowerPoint에서 열기">PowerPoint에서 열기</button>
   <button aria-label="다운로드"><i>${PUA}</i>\n다운로드</button>
   <button aria-label="OneDrive에 저장"><i>${PUA}</i>\nOneDrive에 저장</button>
   <button aria-label="닫기"><i>${PUA}</i></button>
  </div></div>
 <div role="complementary"><iframe></iframe></div>
</div></body>`;

/**
 * 가짜 OWA — dragstart 에 'attachment' JSON 을 채우고, "기타 작업" 을 누르면 메뉴(아이콘 글자 + 줄바꿈 + 이름)를 띄우고, "다운로드" 를 누르면
 * blob 을 만들어 <a download href="blob:…"> 를 누른다(첫 카드는 a.click(), 둘째는 a.dispatchEvent(click) — 둘 다 가로채야 한다).
 * 미리보기의 "다운로드" 도 같다. 페이지에 닿은 a 의 click 은 window.__anchorClicks 에, 눌린 메뉴 이름은 window.__pressed 에 남긴다.
 */
function outlookPage(html, { url = OUTLOOK_URL, files = {}, menu = ['미리 보기', '다운로드', '제거'] } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url });
  const { window } = dom;
  window.__files = files;
  window.eval(`
    window.__anchorClicks = 0; window.__pressed = []; let seq = 0;
    if (!window.DataTransfer) window.DataTransfer = class { constructor() { this._d = {}; } get types() { return Object.keys(this._d); } setData(k, v) { this._d[k] = String(v); } getData(k) { return this._d[k] ?? ''; } };
    if (!window.DragEvent) window.DragEvent = class extends Event { constructor(type, o = {}) { super(type, o); this.dataTransfer = o.dataTransfer || null; } };
    URL.createObjectURL = (b) => 'blob:https://outlook.cloud.microsoft/' + (++seq);
    URL.revokeObjectURL = () => {};
    document.addEventListener('dragstart', (e) => {
      const d = e.target.closest('[data-att]'); if (!d) return;
      const j = JSON.parse(d.dataset.att);
      e.dataTransfer.setData('attachment', JSON.stringify({ itemType: 'attachment', attachmentFiles: [{ attachmentItemId: j.id, name: j.name, size: j.size, fileType: 5, type: 'ItemIdAttachment:#Exchange', ContentType: j.ct }], mailboxInfos: [{}] }));
    });
    document.addEventListener('click', (e) => { if (e.target instanceof HTMLAnchorElement) window.__anchorClicks++; }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const m of document.querySelectorAll('[role=menu]')) m.remove(); });
    const download = (name, viaDispatch) => setTimeout(() => {
      const blob = new Blob([window.__files[name] ?? ('bytes of ' + name)], { type: 'application/octet-stream' });
      const a = document.createElement('a'); a.download = name; a.href = URL.createObjectURL(blob); document.body.append(a);
      if (viaDispatch) a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); else a.click();
      a.remove(); URL.revokeObjectURL(a.href);
    }, 5);
    document.addEventListener('click', (e) => {
      const more = e.target.closest('button[aria-haspopup]');
      if (more) {
        const opt = more.closest('[role=option]');
        const name = opt.querySelector('[title]').getAttribute('title');
        const idx = [...document.querySelectorAll('[role=option]')].indexOf(opt);
        setTimeout(() => {
          const m = document.createElement('div'); m.setAttribute('role', 'menu');
          for (const label of ${JSON.stringify(menu)}) {
            const it = document.createElement('div'); it.setAttribute('role', 'menuitem'); it.textContent = '${PUA}\\n' + label;
            it.addEventListener('click', () => { window.__pressed.push(label); m.remove(); if (label === '다운로드') download(name, idx === 1); });
            m.append(it);
          }
          document.body.append(m);
        }, 5);
        return;
      }
      const btn = e.target.closest('[role=dialog] button');
      if (btn) {
        window.__pressed.push(btn.getAttribute('aria-label'));
        if (btn.getAttribute('aria-label') === '다운로드') download(btn.closest('[role=dialog]').querySelector('[title]').getAttribute('title'), false);
      }
    });
  `);
  return window;
}
const inPage = (window, fn) => window.eval(`(${fn.toString()})`);

const ECLASS_URL = 'https://eclass.krs.co.kr/eClassVer4/Message/InboxDetail?pRid=20299024';
/** eclass 쪽지(InboxDetail)의 모양(실측) — 첨부 칸(.link-like 의 숨은 입력)은 화면 스크립트(message-detail-script.js)에서 읽은 꼴. */
const ECLASS_HTML = `<body><div id="message-view"><div id="message-main">
 <div><h3><span>Fw: [QMT Reminder] 3/4분기 KPI 입력 요청</span></h3></div>
 <div id="detail-sender-info"><div><span class="text-grey text-600">홍길동
                            과장 / 품질경영팀</span></div>
  <div id="detail-view-receiver-info"><span title="김거화 책임">김거화 책임</span><span>/ 전기전자팀</span></div><div id="detail-receiver-count">+ 1</div></div>
 <div id="receiverList" class="d-none"><table><tr><th>No</th><th>Name</th><th>Department</th><th>Received Time</th></tr>
  <tr><td>1</td><td>김거화 책임</td><td>전기전자팀</td><td>2026-10-14 09:01:00</td></tr><tr><td>2</td><td>이지혜 선임</td><td>전기전자팀</td><td></td></tr></table></div>
 <span class="message-datetime">Send : 2026-10-14 08:59:01</span><span class="message-datetime">Received : 2026-10-14 09:01:00</span>
 <div id="htmlContentArea"><p>안녕하세요</p><p>KPI 입력 부탁드립니다.</p></div>
</div>
<input type="hidden" id="fileDownUrl" value="/eClassVer4/Message/FileDown">
<div class="attachmentArea"><div class="link-like"><span>계획서.hwp</span>
 <input type="hidden" id="f_sId" value="S 1"><input type="hidden" id="fId" value="F1"><input type="hidden" id="fFileName" value="계획서.hwp"><input type="hidden" id="fFileType" value="hwp"><input type="hidden" id="fFileSize" value="12345"></div></div>
</div></body>`;

/* ------------------------------------------------------------ 순수 셈 */

console.log('끌어 놓은 것 읽기');
const dtOf = (data) => ({ types: Object.keys(data), getData: (k) => data[k] ?? '' });
const OUTLOOK_DROP = JSON.stringify({ itemType: 'attachment', attachmentFiles: [{ attachmentItemId: 'AAkAL1', name: '[진도점검] 양식.pptx', size: 227305, fileType: 5, type: 'ItemIdAttachment:#Exchange', ContentType: 'application/octet-stream' }], mailboxInfos: [{}] });
t('Outlook 카드 — attachment JSON 의 이름·크기·id(실측 꼴)', () => {
  assert.deepEqual(parseDrop(dtOf({ attachment: OUTLOOK_DROP })), { kind: 'outlook', items: [{ name: '[진도점검] 양식.pptx', size: 227305, id: 'AAkAL1', type: 'application/octet-stream' }] });
});
t('링크 — uri-list 의 http(s) 줄만(주석·중복·다른 형식은 뺀다), DownloadURL 은 이름까지', () => {
  assert.deepEqual(parseDrop(dtOf({ 'text/uri-list': '# 주석\r\nhttps://a.b/x.pdf\r\nhttps://a.b/x.pdf\njavascript:alert(1)\nhttps://a.b/y.hwp' })),
    { kind: 'links', urls: ['https://a.b/x.pdf', 'https://a.b/y.hwp'], items: [{ url: 'https://a.b/x.pdf', name: '' }, { url: 'https://a.b/y.hwp', name: '' }] });
  assert.deepEqual(parseDrop(dtOf({ DownloadURL: 'application/pdf:보고서.pdf:https://a.b/dl?id=1' })).items, [{ url: 'https://a.b/dl?id=1', name: '보고서.pdf' }]);
});
t('알아볼 수 없는 것은 null — 깨진 JSON·빈 목록·글자만·파일(Files 는 패널이 원래 받는다)·없음', () => {
  assert.equal(parseDrop(dtOf({ attachment: '{깨짐' })), null);
  assert.equal(parseDrop(dtOf({ attachment: JSON.stringify({ attachmentFiles: [] }) })), null);
  assert.equal(parseDrop(dtOf({ 'text/plain': '그냥 글자' })), null);
  assert.equal(parseDrop(dtOf({ Files: '', 'text/uri-list': 'https://a.b/x.pdf' })), null);
  assert.equal(parseDrop(null), null);
  assert.equal(parseDrop({ types: ['attachment'], getData: () => { throw new Error('protected'); } }), null);
});
t('dropReady — dragover 의 types 만으로: 카드·링크는 받고 파일은 패널의 원래 길로', () => {
  assert.equal(dropReady(['attachment']), true);
  assert.equal(dropReady(['text/uri-list']), true);
  assert.equal(dropReady(['DownloadURL']), true);
  assert.equal(dropReady(['Files']), false);
  assert.equal(dropReady(['text/plain']), false);
  assert.equal(dropReady(undefined), false);
});

console.log('MIME·파일');
t('확장자로 MIME — 대소문자 무시, 모르면 빈 글자', () => {
  assert.equal(mimeOf('양식.PPTX'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(mimeOf('계획서.hwp'), 'application/x-hwp');
  assert.equal(mimeOf('계획서.hwpx'), 'application/hwp+zip');
  assert.equal(mimeOf('a.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(mimeOf('a.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(mimeOf('scan.JPG'), 'image/jpeg');
  assert.equal(mimeOf('a.pdf'), 'application/pdf');
  assert.equal(mimeOf('a.zip'), 'application/zip');
  assert.equal(mimeOf('a.unknownx'), '');
  assert.equal(mimeOf('README'), '');
});
await ta('fileOf — 바이트는 그대로, octet-stream 은 확장자로 바로잡고, 모르는 확장자는 받은 형식', async () => {
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 255, 128]);
  const f = fileOf({ name: '양식.pptx', type: 'application/octet-stream', base64: bytes.toString('base64') });
  assert.ok(f instanceof File);
  assert.equal(f.name, '양식.pptx');
  assert.equal(f.type, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.deepEqual(Buffer.from(await f.arrayBuffer()), bytes);
  assert.equal(fileOf({ name: 'a.dwgx', type: 'application/acad', base64: '' }).type, 'application/acad');
  assert.equal(fileOf({ name: 'a.dwgx', type: 'application/octet-stream', base64: '' }).type, 'application/octet-stream');
  assert.equal(fileOf({ name: 'a/b:c.pdf', base64: '' }).name, 'a_b_c.pdf', '경로 구분자·못 쓰는 글자만 바꾼다');
});
t('같은 이름은 (2)·(3) — 대소문자 무시', () => {
  const taken = new Set();
  assert.deepEqual(['a.pdf', 'A.pdf', 'a.pdf', 'b'].map((n) => uniqueName(n, taken)), ['a.pdf', 'A (2).pdf', 'a (3).pdf', 'b']);
  assert.equal(cleanName(''), 'attachment');
});
t('Content-Disposition 의 이름 — filename* 먼저, 따옴표 이름, 없으면 빈 글자', () => {
  assert.equal(dispositionName("attachment; filename=\"x.pdf\"; filename*=UTF-8''%EA%B3%84%ED%9A%8D%EC%84%9C.hwp"), '계획서.hwp');
  assert.equal(dispositionName('attachment; filename="a b.pdf"'), 'a b.pdf');
  assert.equal(dispositionName('attachment; filename=c.xlsx'), 'c.xlsx');
  assert.equal(dispositionName('inline'), '');
  assert.equal(dispositionName(null), '');
});

console.log('주소 가리기');
t('메일 화면 — Outlook 웹의 /mail 아래·eclass 쪽지 …Detail(포털 틀이면 menu 칸)', () => {
  assert.equal(mailSiteOf(OUTLOOK_URL), 'outlook');
  assert.equal(mailSiteOf('https://outlook.office.com/mail/'), 'outlook');
  assert.equal(mailSiteOf('https://outlook.live.com/mail/0/inbox/id/x'), 'outlook');
  assert.equal(mailSiteOf('https://outlook.cloud.microsoft/calendar/view/week'), '', '일정 화면은 메일이 아니다');
  assert.equal(mailSiteOf(ECLASS_URL), 'eclass');
  assert.equal(mailSiteOf('https://eclass.krs.co.kr/eClassVer4/Message/SentDetail?pRid=1'), 'eclass');
  assert.equal(mailSiteOf('https://eclass.krs.co.kr/eClassVer4/Common/Default?menu=%2FeClassVer4%2FMessage%2FInboxDetail%3FpRid%3D1'), 'eclass');
  assert.equal(mailSiteOf('https://eclass.krs.co.kr/eClassVer4/Message/InboxList'), '', '목록은 메일 한 통이 아니다');
  assert.equal(mailSiteOf('https://eclass.krs.co.kr/eClassVer4/Common/Default?menu=%2FeClassVer4%2FBoardNew%2FContent%3Fbid%3D1'), '');
  assert.equal(mailSiteOf('https://www.example.com/mail/a.pdf'), '', '보통 웹페이지는 파일 링크가 있어도 메일이 아니다');
  assert.equal(mailSiteOf('chrome://extensions'), '');
  assert.equal(mailSiteOf(''), '');
  assert.equal(isOutlookUrl('https://outlook.cloud.microsoft/calendar'), true);
  assert.equal(isOutlookUrl('https://evil-outlook.office.com.example/'), false);
});

console.log('메일 글');
const MAIL = {
  site: 'outlook', url: OUTLOOK_URL, subject: '[일정 협의] 진도점검회의', preview: null,
  messages: [
    { from: 'KIM Geohwa', to: '김거화 <kimghw@krs.co.kr>', cc: '', date: '화 2026-10-14 오후 4:51', text: '안녕하세요.   \n\n\n\n참석 가능합니다.', attachments: [] },
    { from: '이지혜<jh@krs.co.kr>', to: 'a@krs.co.kr', cc: 'c@krs.co.kr', date: '화 2026-10-14 오후 3:21', text: '양식을 보냅니다.', attachments: [{ key: '1', name: '양식.pptx', sizeText: '222KB' }, { key: '2', name: 'vcard.vcf', sizeText: '' }] },
  ],
};
t('머리말 [메일 — 제목] 과 머리 칸, 본문(빈 줄은 하나로), 대화는 앞선 메일로 잇는다', () => {
  assert.equal(mailText(MAIL), [
    '[메일 — [일정 협의] 진도점검회의]', '보낸 사람: KIM Geohwa', '받는 사람: 김거화 <kimghw@krs.co.kr>', '날짜: 화 2026-10-14 오후 4:51', '', '안녕하세요.', '', '참석 가능합니다.',
    '', '── 앞선 메일 2/2 ──', '보낸 사람: 이지혜<jh@krs.co.kr>', '받는 사람: a@krs.co.kr', '참조: c@krs.co.kr', '날짜: 화 2026-10-14 오후 3:21', '첨부: 양식.pptx (222KB), vcard.vcf', '', '양식을 보냅니다.',
  ].join('\n'));
});
t('쪽지·웹페이지 머리말, messages 가 없으면 맨 위 칸으로', () => {
  assert.match(mailText({ site: 'eclass', subject: 'KPI', from: '홍길동', text: '본문' }), /^\[쪽지 — KPI\]\n보낸 사람: 홍길동\n\n본문$/);
  assert.match(mailText({ site: 'page', subject: '게시글', url: 'https://a.b/1', text: '글' }), /^\[웹페이지 — 게시글\] https:\/\/a\.b\/1\n\n글$/);
  assert.equal(mailText(null), '');
});
t(`한도(TEXT_MAX ${TEXT_MAX}자)를 넘으면 뒤(오래된 메일)부터 잘리고 잘림 표시까지 한도 안`, () => {
  const long = { ...MAIL, messages: [MAIL.messages[0], { ...MAIL.messages[1], text: '가'.repeat(30000) }] };
  const s = mailText(long);
  assert.ok(s.length <= TEXT_MAX, String(s.length));
  assert.match(s, /…\(너무 길어 여기서 잘랐습니다\)$/);
  assert.match(s, /참석 가능합니다/);
  assert.ok(mailText(long, { max: 100 }).length <= 100);
});
t('무엇을 가져왔나 한 줄', () => {
  assert.equal(grabWhat(MAIL, [1, 2], [{}]), '메일 「[일정 협의] 진도점검회의」 · 대화 2통 · 첨부 2개 · 못 가져온 첨부 1개');
  assert.equal(grabWhat({ site: 'outlook', subject: '', messages: [], preview: { open: true, name: 'a.pptx' } }, [1]), '메일 · 본문 없음(첨부 미리보기) · 첨부 1개');
  assert.equal(grabWhat({ site: 'eclass', subject: 'KPI', messages: [{}] }), '쪽지 「KPI」');
});
t('틀 고르기 — 메일 사이트·메일 칸이 있는 틀을 먼저, 없으면 null', () => {
  const r = pickFrame([
    { frameId: 0, result: { site: 'page', text: 'x'.repeat(5000), attachments: [], messages: [] } },
    { frameId: 3, result: { site: 'eclass', text: '짧은 쪽지', attachments: [], messages: [{}] } },
    { frameId: 4, result: null },
  ]);
  assert.equal(r.frameId, 3);
  assert.equal(pickFrame([{ frameId: 2, result: { site: 'page', text: 'ab' } }, { frameId: 0, result: { site: 'page', text: 'ab' } }]).frameId, 0, '같으면 맨 위');
  assert.equal(pickFrame([]), null);
  assert.equal(pickFrame(undefined), null);
});

/* ------------------------------------------------------------ 탭 안에서 도는 함수 (jsdom) */

console.log('탭 안 — 읽기(mailProbe)');
t('탭 안 함수는 바깥 이름을 쓰지 않는다 — jsdom 창에 글자 그대로 옮겨도 함수다', () => {
  const window = outlookPage('<body></body>');
  for (const fn of [mailProbe, mailFetch, mailUnmark, mailUnpreview]) assert.equal(typeof inPage(window, fn), 'function', fn.name);
});
t('Outlook — 제목·메일 두 통(새 메일이 앞)·받는 사람은 aria-label 에서·첨부는 dragstart JSON 의 이름·크기·id', () => {
  const window = outlookPage(OUTLOOK_HTML);
  const m = plain(inPage(window, mailProbe)({ mark: true }));
  assert.equal(m.site, 'outlook');
  assert.equal(m.subject, '[일정 협의] 진도점검회의 참석 일정');
  assert.equal(m.messages.length, 2);
  assert.deepEqual([m.from, m.to, m.cc, m.date], ['KIM Geohwa', '김거화 <kimghw@krs.co.kr>', '', '화 2026-10-14 오후 4:51'], '맨 위 칸은 첫 메일');
  assert.match(m.text, /안녕하세요\.[\s\S]*참석 가능합니다\./);
  assert.deepEqual([m.messages[1].from, m.messages[1].to, m.messages[1].cc], ['이지혜<jh@krs.co.kr>', 'a@krs.co.kr, b@krs.co.kr', 'c@krs.co.kr']);
  assert.match(m.messages[1].text, /발표자료 양식/);
  assert.deepEqual(m.attachments, [
    { key: '1', name: '양식_수정본.pptx', size: 227305, sizeText: '222KB', id: 'AAk1', type: 'application/octet-stream' },
    { key: '2', name: 'vcard.vcf', size: 614, sizeText: '614바이트', id: 'AAk2', type: 'text/x-vcard' },
  ]);
  assert.deepEqual(m.messages[1].attachments.map((a) => a.key), ['1', '2']);
  assert.equal(m.preview, null);
  // 표시 — 카드마다 번호, 대화 칸에 mail. part 는 captureTabParts 에 그대로 넘긴다.
  const doc = window.document;
  assert.deepEqual([...doc.querySelectorAll('[data-krs-attach]')].map((e) => [e.getAttribute('role'), e.getAttribute('data-krs-attach')]), [['option', '1'], ['option', '2']]);
  assert.equal(doc.querySelector('[data-krs-cap="mail"]').id, 'ConversationReadingPaneContainerId');
  assert.deepEqual(m.part, { n: 'mail', tag: 'div', title: '[일정 협의] 진도점검회의 참석 일정', frame: null });
  assert.equal(m.marked, true);
});
t('ids: false 면 dragstart 를 쏘지 않고 화면의 크기 글자(222KB·614바이트)로, mark 가 없으면 표시도 없다', () => {
  const window = outlookPage(OUTLOOK_HTML);
  let drags = 0;
  window.document.addEventListener('dragstart', () => drags++);
  const m = plain(inPage(window, mailProbe)({ ids: false }));
  assert.equal(drags, 0);
  assert.deepEqual(m.attachments.map((a) => [a.key, a.name, a.size, a.id]), [['1', '양식_수정본.pptx', 227328, undefined], ['2', 'vcard.vcf', 614, undefined]]);
  assert.equal(window.document.querySelectorAll('[data-krs-attach], [data-krs-cap]').length, 0);
  assert.equal(m.marked, false);
  assert.equal(m.part, null);
});
t('다시 표시하면 지난 표시를 먼저 뗀다 — 같은 화면이면 같은 번호, mailUnmark 는 다 뗀다', () => {
  const window = outlookPage(OUTLOOK_HTML);
  window.document.querySelector('#focused').setAttribute('data-krs-attach', '9');
  const probe = inPage(window, mailProbe);
  const a = plain(probe({ mark: true })).attachments.map((x) => x.key);
  const b = plain(probe({ mark: true })).attachments.map((x) => x.key);
  assert.deepEqual(a, b);
  assert.equal(window.document.querySelector('#focused').hasAttribute('data-krs-attach'), false);
  assert.equal(inPage(window, mailUnmark)(), 3);
  assert.equal(window.document.querySelectorAll('[data-krs-attach], [data-krs-cap]').length, 0);
});
t('받은 편지함 목록뿐(열린 메일 없음)이면 메일 칸도 첨부도 미리보기도 없다', () => {
  const window = outlookPage('<body><div role="main" aria-label="읽기 창"><div id="ReadingPaneContainerId"></div></div><div role="listbox"><div role="option">메일 목록</div></div></body>');
  const m = plain(inPage(window, mailProbe)({ mark: true }));
  assert.deepEqual([m.site, m.messages.length, m.attachments.length, m.preview, m.marked], ['outlook', 0, 0, null, false]);
});
t('첨부 미리보기(/sxs/ — 읽기 창이 빔) — 대화 상자의 파일만 번호를 받고 그 이름 칸에 표시', () => {
  const window = outlookPage(PREVIEW_HTML, { url: `${OUTLOOK_URL}/sxs/AAkALgA%3D` });
  const m = plain(inPage(window, mailProbe)({ mark: true }));
  assert.deepEqual(m.preview, { open: true, name: '양식_수정본.pptx' });
  assert.equal(m.messages.length, 0);
  assert.deepEqual(m.attachments, [{ key: '1', name: '양식_수정본.pptx', size: 0, sizeText: '', preview: true }]);
  assert.equal(window.document.querySelector('[data-krs-attach="1"]').getAttribute('title'), '양식_수정본.pptx');
  assert.equal(m.marked, false, '메일 칸이 없으니 mail 표시는 없다');
});
t('미리보기 옆에 대화가 그려져 있으면(뒤 탭 실측) 메일과 첨부를 다 읽고, 미리보기 파일은 카드와 같은 번호', () => {
  const conv = OUTLOOK_HTML.replace(/^<body>|<\/body>$/g, '').replace('role="main" aria-label="읽기 창"', '');
  const html = PREVIEW_HTML.replace('<div role="complementary">', `<div role="complementary">${conv}</div><div>`);
  const window = outlookPage(html, { url: `${OUTLOOK_URL}/sxs/AAkALgA%3D` });
  const m = plain(inPage(window, mailProbe)({ mark: true }));
  assert.equal(m.messages.length, 2);
  assert.deepEqual(m.attachments.map((a) => [a.key, a.name, !!a.preview]), [['1', '양식_수정본.pptx', true], ['2', 'vcard.vcf', false]]);
  assert.deepEqual([...window.document.querySelectorAll('[data-krs-attach="1"]')].map((e) => e.getAttribute('role') || e.getAttribute('title')).sort(),
    ['option', '양식_수정본.pptx'].sort(), '미리보기의 이름 칸과 카드 둘 다');
});
t('eclass 쪽지 — 제목·보낸 사람·받는 사람(숨은 표)·보낸 때·본문, 첨부는 화면의 downloadFile 과 같은 주소', () => {
  const { window } = new JSDOM(ECLASS_HTML, { runScripts: 'outside-only', url: ECLASS_URL });
  const m = plain(inPage(window, mailProbe)({ mark: true }));
  assert.equal(m.site, 'eclass');
  assert.equal(m.subject, 'Fw: [QMT Reminder] 3/4분기 KPI 입력 요청');
  assert.equal(m.from, '홍길동 과장 / 품질경영팀');
  assert.equal(m.to, '김거화 책임(전기전자팀), 이지혜 선임(전기전자팀)');
  assert.equal(m.date, '2026-10-14 08:59:01');
  assert.match(m.text, /KPI 입력 부탁드립니다/);
  assert.deepEqual(m.attachments, [{
    key: '1', name: '계획서.hwp', size: 12345, sizeText: '',
    url: 'https://eclass.krs.co.kr/eClassVer4/Message/FileDown?sId=S%201&fId=F1&fFileName=%EA%B3%84%ED%9A%8D%EC%84%9C.hwp&fFileType=hwp&fFileSize=12345',
  }]);
  assert.equal(window.document.querySelector('.link-like').getAttribute('data-krs-attach'), '1');
  assert.equal(window.document.querySelector('[data-krs-cap="mail"]').id, 'message-main');
  assert.equal(m.messages.length, 1);
});
t('그 밖의 페이지 — 문서 제목과 글, download 속성·파일 확장자 링크만 첨부로(javascript: 는 뺀다)', () => {
  const { window } = new JSDOM(`<title>게시글</title><body><p>본문</p>
    <a href="/files/report.pdf">보고서</a><a href="/dl?id=3" download="자료.xlsx">자료</a><a href="/about">소개</a>
    <a href="javascript:void(0)">x.pdf</a><a href="https://cdn.x.com/a/%ED%95%9C.hwp">한</a><a href="/files/report.pdf">다시</a></body>`, { runScripts: 'outside-only', url: 'https://example.com/board/1' });
  const m = plain(inPage(window, mailProbe)({}));
  assert.equal(m.site, 'page');
  assert.equal(m.subject, '게시글');
  assert.deepEqual(m.attachments.map((a) => [a.key, a.name, a.url]), [
    ['1', 'report.pdf', 'https://example.com/files/report.pdf'], ['2', '자료.xlsx', 'https://example.com/dl?id=3'], ['3', '한.hwp', 'https://cdn.x.com/a/%ED%95%9C.hwp'],
  ]);
});
t('미리보기 닫기 — 다운로드 단추가 있는 대화 상자의 "닫기"만 누른다', () => {
  const window = outlookPage(PREVIEW_HTML, { url: `${OUTLOOK_URL}/sxs/A` });
  assert.equal(inPage(window, mailUnpreview)(), true);
  assert.deepEqual(plain(window.__pressed), ['닫기']);
  assert.equal(inPage(outlookPage('<body><div role="dialog"><button aria-label="닫기"></button></div></body>'), mailUnpreview)(), false, '다른 대화 상자는 건드리지 않는다');
});

console.log('탭 안 — 받기(mailFetch, 페이지 세계)');
/** 감싸기 전의 것 — 받은 뒤 그대로 돌아왔는지 본다. */
const snap = (window) => ({ create: window.URL.createObjectURL, dispatch: window.EventTarget.prototype.dispatchEvent, click: Object.getOwnPropertyDescriptor(window.HTMLAnchorElement.prototype, 'click') });
const restored = (window, before) => {
  assert.equal(window.URL.createObjectURL, before.create, 'createObjectURL 은 원래대로');
  assert.equal(window.EventTarget.prototype.dispatchEvent, before.dispatch, 'dispatchEvent 는 원래대로');
  assert.deepEqual(Object.getOwnPropertyDescriptor(window.HTMLAnchorElement.prototype, 'click'), before.click, 'a.click 은 원래대로(없던 것은 지운다)');
  assert.equal(window.__krsMailFetch, undefined);
};
await ta('Outlook — 기타 작업 → 다운로드 로 만든 blob 을 가로챈다(a.click·a.dispatchEvent 둘 다), 내려받기는 일어나지 않는다', async () => {
  const window = outlookPage(OUTLOOK_HTML, { files: { '양식_수정본.pptx': 'PK\u0003\u0004pptx', 'vcard.vcf': 'BEGIN:VCARD' } });
  const before = snap(window);
  const probe = plain(inPage(window, mailProbe)({ mark: true }));
  const got = plain(await inPage(window, mailFetch)(probe.attachments, { waitMs: 2000 }));
  assert.deepEqual(got.map((r) => [r.name, r.type, r.size, Buffer.from(r.base64, 'base64').toString()]), [
    ['양식_수정본.pptx', 'application/octet-stream', 8, 'PK\u0003\u0004pptx'], ['vcard.vcf', 'application/octet-stream', 11, 'BEGIN:VCARD'],
  ]);
  assert.equal(window.__anchorClicks, 0, '원래 누름(내려받기)은 부르지 않는다');
  assert.deepEqual(plain(window.__pressed), ['다운로드', '다운로드'], '메뉴의 다른 것(미리 보기·제거)은 누르지 않는다');
  assert.equal(window.document.querySelectorAll('[role=menu]').length, 0);
  restored(window, before);
});
await ta('카드는 번호 표시 → id → 이름 차례로 찾는다 — 이름만 주어도 된다', async () => {
  const window = outlookPage(OUTLOOK_HTML);
  const [r] = plain(await inPage(window, mailFetch)(['vcard.vcf'], { waitMs: 2000 }));
  assert.equal(Buffer.from(r.base64, 'base64').toString(), 'bytes of vcard.vcf');
  const [byId] = plain(await inPage(window, mailFetch)([{ name: '', id: 'AAk1' }], { waitMs: 2000 }));
  assert.equal(Buffer.from(byId.base64, 'base64').toString(), 'bytes of 양식_수정본.pptx');
});
await ta('미리보기 — 대화 상자의 다운로드로 받는다', async () => {
  const window = outlookPage(PREVIEW_HTML, { url: `${OUTLOOK_URL}/sxs/A`, files: { '양식_수정본.pptx': 'PK..' } });
  const before = snap(window);
  const [r] = plain(await inPage(window, mailFetch)([{ key: '1', name: '양식_수정본.pptx', preview: true }], { waitMs: 2000 }));
  assert.equal(Buffer.from(r.base64, 'base64').toString(), 'PK..');
  assert.deepEqual(plain(window.__pressed), ['다운로드']);
  restored(window, before);
});
await ta('못 받는 것은 까닭과 함께 — 없는 첨부·메뉴에 다운로드 없음·한도 넘음·기다림 넘음, 다른 단추는 누르지 않는다', async () => {
  const window = outlookPage(OUTLOOK_HTML, { menu: ['미리 보기', '제거'] });
  const before = snap(window);
  const fetchIn = inPage(window, mailFetch);
  const got = plain(await fetchIn([{ name: '없는.pdf' }, { name: 'vcard.vcf' }, { name: '양식_수정본.pptx', size: 40 * 1024 * 1024 }], { waitMs: 500, menuMs: 100 }));
  assert.match(got[0].error, /찾지 못했습니다/);
  assert.match(got[1].error, /"다운로드" 가 없습니다/);
  assert.match(got[2].error, /40MB로 한 파일의 한도\(30MB\)를 넘어/);
  assert.deepEqual(plain(window.__pressed), [], '제거·미리 보기는 누르지 않는다');
  assert.equal(window.document.querySelectorAll('[role=menu]').length, 0, '남은 메뉴는 Escape 로 닫는다(가짜 메뉴는 Escape 를 받으면 닫는다)');
  restored(window, before);
  const big = outlookPage(OUTLOOK_HTML, { files: { 'vcard.vcf': 'x'.repeat(2000) } });
  const [r] = plain(await inPage(big, mailFetch)(['vcard.vcf'], { waitMs: 2000, maxBytes: 1000 }));
  assert.match(r.error, /한 파일의 한도/);
  const slow = outlookPage(OUTLOOK_HTML, { menu: [] });
  const slowBefore = snap(slow);
  slow.eval(`document.addEventListener('click', (e) => { if (e.target.closest('button[aria-haspopup]')) setTimeout(() => { const m = document.createElement('div'); m.setAttribute('role', 'menu'); const it = document.createElement('div'); it.setAttribute('role', 'menuitem'); it.textContent = '다운로드'; m.append(it); document.body.append(m); }, 5); });`);
  const [late] = plain(await inPage(slow, mailFetch)(['vcard.vcf'], { waitMs: 300 }));
  assert.match(late.error, /초 안에 받지 못했습니다/);
  restored(slow, slowBefore);
});
await ta('주소가 있으면(eclass 쪽지) 같은 출처에서 쿠키를 실어 받고, 웹페이지가 오면 실패로', async () => {
  const { window } = new JSDOM(ECLASS_HTML, { runScripts: 'outside-only', url: ECLASS_URL });
  const asked = [];
  window.fetch = async (url, init) => {
    asked.push([url, init.credentials]);
    const html = /bad/.test(url);
    return { ok: !/404/.test(url), status: 404, headers: { get: (k) => (k === 'content-length' ? '4' : null) }, blob: async () => new window.Blob([html ? '<html>' : 'HWP!'], { type: html ? 'text/html; charset=utf-8' : 'application/octet-stream' }) };
  };
  const got = plain(await inPage(window, mailFetch)([{ name: '계획서.hwp', url: 'https://eclass.krs.co.kr/eClassVer4/Message/FileDown?fId=1' }, { name: 'b.hwp', url: 'https://eclass.krs.co.kr/bad' }, { name: 'c.hwp', url: 'https://eclass.krs.co.kr/404' }]));
  assert.equal(Buffer.from(got[0].base64, 'base64').toString(), 'HWP!');
  assert.match(got[1].error, /파일 대신 웹페이지/);
  assert.match(got[2].error, /HTTP 404/);
  assert.deepEqual(asked.map((a) => a[1]), ['include', 'include', 'include']);
  assert.match(plain(await inPage(window, mailFetch)(['이름만.hwp']))[0].error, /받을 주소가 없습니다/);
});
await ta('같은 탭에서 두 번 겹쳐 받지 않는다', async () => {
  const window = outlookPage(OUTLOOK_HTML);
  window.__krsMailFetch = true;
  const [r] = plain(await inPage(window, mailFetch)(['vcard.vcf']));
  assert.match(r.error, /이미 다른 첨부를 가져오는 중/);
});

/* ------------------------------------------------------------ 차례 (가짜 exec) */

console.log('차례 — grabItems·grabMail·fetchLinks');
const ok = (name, text, type = 'application/octet-stream') => ({ name, type, size: text.length, base64: b64(text) });
await ta('첨부를 하나씩 받는다 — 성공은 File, 실패·던짐·한도는 failed 에 까닭, 같은 이름은 (2)', async () => {
  const calls = [];
  const execMain = async (fn, [items, opts]) => {
    calls.push(items[0].name);
    assert.equal(fn, mailFetch);
    assert.equal(opts.maxBytes, MAX_FILE_BYTES);
    const n = items[0].name;
    if (n === '깨짐.pdf') return [{ name: n, error: '20초 안에 받지 못했습니다' }];
    if (n === '던짐.pdf') throw new Error('Frame was removed');
    return [ok(n, `bytes ${n}`)];
  };
  const status = [];
  const r = await grabItems({ items: [{ name: 'a.pdf' }, { name: '깨짐.pdf' }, { name: '던짐.pdf' }, { name: 'a.pdf' }, { name: '큰.zip', size: MAX_FILE_BYTES + 1 }, { name: '' }], execMain, onStatus: (s) => status.push(s) });
  assert.deepEqual(r.files.map((f) => [f.name, f.type]), [['a.pdf', 'application/pdf'], ['a (2).pdf', 'application/pdf']]);
  assert.deepEqual(r.failed.map((f) => f.name), ['깨짐.pdf', '던짐.pdf', '큰.zip']);
  assert.match(r.failed[1].why, /탭에서 받지 못했습니다 — Frame was removed/);
  assert.match(r.failed[2].why, /한도/);
  assert.deepEqual(calls, ['a.pdf', '깨짐.pdf', '던짐.pdf', 'a.pdf'], '한도를 넘는 것은 받으러 가지 않는다');
  assert.equal(status[0], '첨부 1/5 가져오는 중 — a.pdf');
});
const fakeTab = (mail, { fetched = (a) => [ok(a.name, `bytes ${a.name}`)], after = null } = {}) => {
  const log = [];
  let probes = 0;
  return {
    log,
    exec: async (fn, args) => {
      log.push(fn.name);
      if (fn === mailProbe) return probes++ && after ? after : mail;
      if (fn === mailUnpreview) return true;
      throw new Error(`unknown ${fn.name}`);
    },
    execMain: async (fn, [items]) => {
      log.push(`${fn.name}:${items[0].name}`);
      return fetched(items[0]);
    },
  };
};
await ta('메일 통째로 — 글(mailText)·파일·못 받은 것·무엇, 표시는 mark 일 때만 남긴다', async () => {
  const mail = { ...MAIL, attachments: MAIL.messages[1].attachments, marked: true, part: { n: 'mail' } };
  const tab = fakeTab(mail, { fetched: (a) => (a.name === 'vcard.vcf' ? [{ name: a.name, error: '첨부 메뉴에 "다운로드" 가 없습니다' }] : [ok(a.name, 'PK')]) });
  let markArg = null;
  const exec = async (fn, args) => { if (fn === mailProbe) markArg = args[0].mark; return tab.exec(fn, args); };
  const r = await grabMail({ exec, execMain: tab.execMain, mark: true });
  assert.equal(markArg, true);
  assert.equal(r.text, mailText(mail));
  assert.deepEqual(r.files.map((f) => [f.name, f.type, f.size]), [['양식.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 2]]);
  assert.deepEqual(r.failed, [{ name: 'vcard.vcf', why: '첨부 메뉴에 "다운로드" 가 없습니다' }]);
  assert.equal(r.what, '메일 「[일정 협의] 진도점검회의」 · 대화 2통 · 첨부 1개 · 못 가져온 첨부 1개');
  assert.deepEqual(r.notes, []);
  assert.equal(r.pages, undefined);
});
await ta('미리보기만 — 그 파일만 받고 닫지 않는다(기본), notes 에 미리보기를 닫으라는 말', async () => {
  const mail = { site: 'outlook', subject: '', messages: [], preview: { open: true, name: 'p.pptx' }, attachments: [{ key: '1', name: 'p.pptx', preview: true }] };
  const tab = fakeTab(mail);
  const r = await grabMail({ exec: tab.exec, execMain: tab.execMain });
  assert.deepEqual(tab.log, ['mailProbe', 'mailFetch:p.pptx'], '미리보기를 닫지 않는다');
  assert.deepEqual(r.notes, [PREVIEW_NOTE]);
  assert.deepEqual(r.files.map((f) => f.name), ['p.pptx']);
});
await ta('unpreview 를 켜면 미리보기를 닫고 다시 읽어 메일 전체를 받는다', async () => {
  const pv = { site: 'outlook', messages: [], preview: { open: true, name: 'p.pptx' }, attachments: [{ key: '1', name: 'p.pptx' }] };
  const full = { ...MAIL, attachments: [{ key: '1', name: 'p.pptx' }, { key: '2', name: 'q.pdf' }] };
  const tab = fakeTab(pv, { after: full });
  const r = await grabMail({ exec: tab.exec, execMain: tab.execMain, unpreview: true, wait: async () => {} });
  assert.deepEqual(tab.log, ['mailProbe', 'mailUnpreview', 'mailProbe', 'mailFetch:p.pptx', 'mailFetch:q.pdf']);
  assert.deepEqual(r.notes, ['첨부 미리보기를 닫고 메일 전체를 가져왔습니다.']);
  assert.equal(r.files.length, 2);
});
await ta('capture 가 있으면 표시한 메일 칸을 찍고(pages), 찍기에 실패해도 글과 파일은 준다', async () => {
  const mail = { ...MAIL, attachments: [], marked: true };
  const tab = fakeTab(mail);
  const r = await grabMail({ exec: tab.exec, execMain: tab.execMain, capture: async (m) => ({ shots: [m.subject] }) });
  assert.deepEqual(r.pages, { shots: ['[일정 협의] 진도점검회의'] });
  const bad = await grabMail({ exec: tab.exec, execMain: tab.execMain, capture: async () => { throw new Error('탭이 닫혔습니다'); } });
  assert.match(bad.notes.join(), /메일 화면은 찍지 못했습니다 — 탭이 닫혔습니다/);
  assert.ok(bad.text);
  await assert.rejects(grabMail({ exec: async () => null }), /메일을 읽지 못했습니다/);
});
await ta('끌어 놓은 링크는 패널에서 받는다 — 이름은 끌어 온 이름·Content-Disposition·주소 끝, 웹페이지·HTTP 오류·한도는 실패', async () => {
  const fetch = async (url, init) => {
    assert.equal(init.credentials, 'include');
    const h = { 'https://a.b/dl?id=1': ["attachment; filename*=UTF-8''%EA%B3%84%ED%9A%8D.hwp", 'application/octet-stream', 'HWP'], 'https://a.b/x/%ED%95%9C.pdf': [null, 'application/pdf', '%PDF'], 'https://a.b/login': [null, 'text/html', '<html>'], 'https://a.b/big': [null, 'application/zip', 'x'.repeat(50)] }[url];
    if (!h) return { ok: false, status: 403, headers: { get: () => null } };
    return { ok: true, headers: { get: (k) => (k === 'content-disposition' ? h[0] : null) }, blob: async () => new Blob([h[2]], { type: h[1] }) };
  };
  const r = await fetchLinks({ items: [{ url: 'https://a.b/dl?id=1', name: '' }, { url: 'https://a.b/x/%ED%95%9C.pdf', name: '' }, { url: 'https://a.b/dl?id=1', name: '끌어온.hwp' }, { url: 'https://a.b/login', name: '' }, { url: 'https://a.b/no', name: 'n.pdf' }, { url: 'https://a.b/big', name: 'big.zip' }], fetch, maxBytes: 10 });
  assert.deepEqual(r.files.map((f) => [f.name, f.type, f.size]), [['계획.hwp', 'application/x-hwp', 3], ['한.pdf', 'application/pdf', 4], ['끌어온.hwp', 'application/x-hwp', 3]]);
  assert.deepEqual(r.failed.map((f) => [f.name, /웹페이지|HTTP 403|한도/.exec(f.why)?.[0]]), [['login', '웹페이지'], ['n.pdf', 'HTTP 403'], ['big.zip', '한도']]);
});

/* ------------------------------------------------------------ chrome 꽂기 (가짜 chrome) */

console.log('chrome 꽂기 — probeTab·grabTab·fetchTab·unmarkTab·grabDropped');
/** 가짜 chrome — executeScript 는 함수 이름으로 답한다(모르는 함수는 던진다 — 다른 배선 테스트처럼). */
function fakeChrome({ tabs = [], granted = true, grant = true, mail = null, fetched = (a) => [ok(a.name, `bytes ${a.name}`)], frames = null } = {}) {
  const calls = [];
  const api = {
    windows: { getCurrent: async () => ({ id: 7 }) },
    tabs: {
      query: async (q) => {
        calls.push(['query', q.url ? 'url' : 'active']);
        if (q.active) return tabs.filter((x) => x.active && x.windowId === q.windowId);
        return tabs.filter((x) => isOutlookUrl(x.url));
      },
    },
    permissions: {
      contains: async (p) => { calls.push(['contains', p.origins[0]]); return granted; },
      request: async (p) => { calls.push(['request', p.origins[0]]); if (grant === 'throw') throw new Error('This function must be called during a user gesture'); return grant; },
    },
    scripting: {
      executeScript: async ({ target, world, func, args }) => {
        calls.push(['exec', func.name, world || 'ISOLATED', target.allFrames ? 'all' : target.frameIds ? target.frameIds[0] : 0, args?.[0]]);
        if (func === mailProbe) return target.allFrames ? frames || [{ frameId: 0, result: mail }] : [{ frameId: target.frameIds?.[0] || 0, result: mail }];
        if (func === mailFetch) return [{ result: fetched(args[0][0]) }];
        if (func === mailUnmark) return [{ result: 3 }];
        throw new Error(`fake executeScript: unknown func ${func.name}`);
      },
    },
  };
  return { api, calls };
}
const OTAB = { id: 11, windowId: 7, url: OUTLOOK_URL, title: 'Outlook', active: true };
const PROBED = { ...MAIL, from: 'KIM Geohwa', to: '김거화', cc: '', date: '화', attachments: [{ key: '1', name: '양식.pptx', size: 227305, sizeText: '222KB', id: 'AAk1' }, { key: '2', name: 'vcard.vcf', size: 614, sizeText: '614바이트', id: 'AAk2' }], marked: true, part: { n: 'mail', tag: 'div', title: '[일정 협의] 진도점검회의', frame: null } };
await ta('probeTab — 메일 사이트가 아니면 스크립트를 넣지 않고 null, 무엇이 잘못되어도 던지지 않는다', async () => {
  const { api, calls } = fakeChrome({ mail: PROBED });
  assert.equal(await probeTab({ id: 1, url: 'https://www.example.com/a.pdf' }, { chrome: api }), null);
  assert.equal(await probeTab({ id: 1, url: 'chrome://newtab' }, { chrome: api }), null);
  assert.equal(await probeTab(null, { chrome: api }), null);
  assert.deepEqual(calls, [], '권한도 묻지 않고 스크립트도 넣지 않는다');
  const broken = fakeChrome();
  broken.api.scripting.executeScript = async () => { throw new Error('Cannot access contents of the page'); };
  assert.equal(await probeTab(OTAB, { chrome: broken.api }), null);
  assert.equal(await probeTab(OTAB, { chrome: fakeChrome({ granted: false, grant: false, mail: PROBED }).api }), null, '권한을 거절하면 null');
  assert.equal(await probeTab(OTAB, { chrome: {} }), null);
  assert.equal(await probeTab(OTAB, { chrome: fakeChrome({ mail: { ...PROBED, messages: [], attachments: [], preview: null } }).api }), null, '열린 메일이 없으면 null');
  assert.equal(await probeTab(OTAB, { chrome: fakeChrome({ mail: { ...PROBED, site: 'page' } }).api }), null);
});
await ta('probeTab — 메일이면 번호 붙은 첨부·part, 표시하며 읽는다(mark), 권한은 있으면 묻지 않는다', async () => {
  const { api, calls } = fakeChrome({ mail: PROBED });
  const p = await probeTab(OTAB, { chrome: api });
  assert.deepEqual(p.attachments, [{ key: '1', name: '양식.pptx', size: 227305, sizeText: '222KB' }, { key: '2', name: 'vcard.vcf', size: 614, sizeText: '614바이트' }]);
  assert.deepEqual([p.site, p.subject, p.from, p.preview, p.notes, p.part, p.frameId], ['outlook', MAIL.subject, 'KIM Geohwa', null, [], PROBED.part, 0]);
  assert.deepEqual(calls, [['contains', 'https://outlook.cloud.microsoft/*'], ['exec', 'mailProbe', 'ISOLATED', 0, { mark: true }]]);
  const pv = await probeTab(OTAB, { chrome: fakeChrome({ mail: { ...PROBED, messages: [], preview: { open: true, name: 'p.pptx' }, attachments: [{ key: '1', name: 'p.pptx', size: 0, sizeText: '', preview: true }], marked: false, part: null } }).api });
  assert.deepEqual([pv.preview, pv.attachments[0].preview, pv.notes], [{ open: true, name: 'p.pptx' }, true, [PREVIEW_NOTE]]);
  const ask = fakeChrome({ granted: false, grant: true, mail: PROBED });
  assert.ok(await probeTab(OTAB, { chrome: ask.api }));
  assert.deepEqual(ask.calls.slice(0, 2), [['contains', 'https://outlook.cloud.microsoft/*'], ['request', '<all_urls>']]);
});
await ta('probeTab — eclass 포털 틀 안의 쪽지는 모든 틀에서 읽어 그 틀을 고른다', async () => {
  const frames = [{ frameId: 0, result: { site: 'page', text: '포털', messages: [], attachments: [] } }, { frameId: 5, result: { site: 'eclass', subject: 'KPI', messages: [{}], attachments: [] } }];
  const { api, calls } = fakeChrome({ mail: { site: 'eclass', subject: 'KPI', from: '홍길동', messages: [{}], attachments: [], marked: true, part: { n: 'mail', tag: 'iframe', frame: { href: 'x' } } }, frames });
  const p = await probeTab({ id: 3, url: 'https://eclass.krs.co.kr/eClassVer4/Common/Default?menu=%2FeClassVer4%2FMessage%2FInboxDetail%3FpRid%3D1' }, { chrome: api });
  assert.equal(p.frameId, 5);
  assert.deepEqual(calls.filter((c) => c[0] === 'exec').map((c) => [c[1], c[3]]), [['mailProbe', 'all'], ['mailProbe', 5]]);
});
await ta('grabTab — 글과 모든 첨부(페이지 세계에서 하나씩), 표시는 남기고(부르는 쪽이 part 로 찍는다), 미리보기는 닫지 않는다', async () => {
  const { api, calls } = fakeChrome({ mail: PROBED });
  const status = [];
  const r = await grabTab(OTAB, { chrome: api, onStatus: (s) => status.push(s) });
  assert.deepEqual(r.mail, { site: 'outlook', subject: MAIL.subject, from: 'KIM Geohwa', to: '김거화', cc: '', date: '화', url: OUTLOOK_URL });
  assert.equal(r.text, mailText(PROBED));
  assert.deepEqual(r.files.map((f) => [f.name, f.type]), [['양식.pptx', mimeOf('a.pptx')], ['vcard.vcf', 'text/vcard']]);
  assert.ok(r.files.every((f) => f instanceof File));
  assert.deepEqual([r.failed, r.notes, r.part], [[], [], PROBED.part]);
  assert.equal(r.what, '메일 「[일정 협의] 진도점검회의」 · 대화 2통 · 첨부 2개');
  const execs = calls.filter((c) => c[0] === 'exec');
  assert.deepEqual(execs.map((c) => [c[1], c[2]]), [['mailProbe', 'ISOLATED'], ['mailFetch', 'MAIN'], ['mailFetch', 'MAIN']], '한 번 읽고 하나씩 받는다');
  assert.deepEqual(execs[0][4], { mark: true }, '표시를 남긴다');
  assert.ok(!execs.some((c) => c[1] === 'mailUnmark' || c[1] === 'mailUnpreview'));
  assert.equal(status.at(-1), '');
  await assert.rejects(grabTab({ id: 1, url: 'https://www.example.com/' }, { chrome: api }), /메일 화면이 아닙니다/);
  await assert.rejects(grabTab(OTAB, { chrome: fakeChrome({ mail: { ...PROBED, messages: [], attachments: [], preview: null } }).api }), /열린 메일이 없습니다/);
});
await ta('fetchTab — 고른 번호의 첨부만, 다시 찾지 못한 번호는 failed', async () => {
  const { api, calls } = fakeChrome({ mail: PROBED });
  const r = await fetchTab(OTAB, [2, '7', '2'], { chrome: api });
  assert.deepEqual(r.files.map((f) => f.name), ['vcard.vcf']);
  assert.deepEqual(r.failed, [{ name: '첨부 7', why: '메일에서 그 첨부를 다시 찾지 못했습니다 — 다시 골라 주세요.' }]);
  assert.deepEqual(calls.filter((c) => c[1] === 'mailFetch').length, 1);
});
await ta('unmarkTab — 모든 틀에서 표시를 떼고, 메일 사이트가 아니거나 실패해도 던지지 않는다', async () => {
  const { api, calls } = fakeChrome();
  await unmarkTab(OTAB, { chrome: api });
  assert.deepEqual(calls, [['exec', 'mailUnmark', 'ISOLATED', 'all', undefined]]);
  await unmarkTab({ id: 1, url: 'https://www.example.com/' }, { chrome: api });
  assert.equal(calls.length, 1);
  const broken = fakeChrome();
  broken.api.scripting.executeScript = async () => { throw new Error('No tab with id'); };
  await unmarkTab(OTAB, { chrome: broken.api });
});
await ta('grabDropped — Outlook 카드는 앞 탭(Outlook)에서 끌어 온 것만 페이지 세계로 받는다', async () => {
  const { api, calls } = fakeChrome({ tabs: [OTAB] });
  const r = await grabDropped(dtOf({ attachment: OUTLOOK_DROP }), { chrome: api });
  assert.equal(r.kind, 'outlook');
  assert.equal(r.tab.id, 11);
  assert.deepEqual(r.files.map((f) => f.name), ['[진도점검] 양식.pptx']);
  assert.deepEqual(calls.filter((c) => c[0] === 'exec').map((c) => [c[1], c[2], c[4]]), [['mailFetch', 'MAIN', [{ name: '[진도점검] 양식.pptx', size: 227305, id: 'AAkAL1', type: 'application/octet-stream' }]]]);
});
await ta('grabDropped — 앞 탭이 Outlook 이 아니면 가장 최근에 본 Outlook 탭, 없으면 까닭을 던진다', async () => {
  const tabs = [{ id: 1, windowId: 7, url: 'https://www.example.com/', active: true }, { id: 21, windowId: 8, url: OUTLOOK_URL, lastAccessed: 100 }, { id: 22, windowId: 9, url: 'https://outlook.office.com/mail/', lastAccessed: 300 }];
  const { api } = fakeChrome({ tabs });
  assert.equal((await grabDropped({ kind: 'outlook', items: [{ name: 'a.pdf', id: 'x' }] }, { chrome: api })).tab.id, 22);
  await assert.rejects(grabDropped({ kind: 'outlook', items: [{ name: 'a.pdf' }] }, { chrome: fakeChrome({ tabs: [tabs[0]] }).api }), /Outlook 메일 탭을 찾지 못했습니다/);
  await assert.rejects(grabDropped(dtOf({ 'text/plain': '글자' }), { chrome: api }), /알아보지 못했습니다 — 메일을 연 탭에서 캡처 단추/);
});
await ta('grabDropped — 권한이 없고 끌어 놓기로는 물을 수 없으면 캡처 단추로 허용하라고 한다', async () => {
  const { api } = fakeChrome({ tabs: [OTAB], granted: false, grant: 'throw' });
  await assert.rejects(grabDropped(dtOf({ attachment: OUTLOOK_DROP }), { chrome: api }), /캡처 단추를 한 번 눌러 허용한 뒤 다시 끌어 놓으세요/);
});
await ta('grabDropped — 링크는 패널에서 받는다(dataTransfer 는 첫 await 전에 읽는다)', async () => {
  let readable = true;
  const dt = { types: ['text/uri-list'], getData: (k) => (readable && k === 'text/uri-list' ? 'https://a.b/x.pdf' : '') };
  const p = grabDropped(dt, { chrome: fakeChrome().api, fetch: async () => ({ ok: true, headers: { get: () => null }, blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }) }) });
  readable = false;   // drop 처리기가 끝나면 dataTransfer 는 빈다
  const r = await p;
  assert.deepEqual([r.kind, r.files.map((f) => f.name), r.failed], ['links', ['x.pdf'], []]);
});

console.log(`\n${pass}개 통과`);
