// 메일 탭 화면(mailtrack/panel.js) — 머리 칩(확인 중·연결됨·꺼짐·로그인 필요·도구 없음)과 저절로 새로고침, 목록 배지(N/M·완료),
// 등록 대화(등록됨 잠금·거르기·고른 id 넘기기·aria-busy), 상세(받을 곳 단추 → sync.expect · 회신 수락/거부(→ sync.review, 확인 필요 수·병합 잠김)·연결 · 본문은 글자로만 ·
// 첨부 내려받기/서버에 저장), 양식 병합(양식이 있을 때만 · 고른 첨부 → sync.mergeFiles → 내려받기), 모두 zip, 두 번 눌러 지우기,
// 설정(MCP 주소는 이 PC 만), 다시 읽기(reload → refresh force)와 오류. sync 는 흉내이고 어디에도 보내지 않는다 — 시각은 2026-10-15 로 못 박는다.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { readZip } from '../../src/zip.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, what = '') => {
  for (let i = 0; i < 100 && !ok(); i++) await wait(10);
  assert.ok(ok(), `기다렸지만 되지 않았습니다${what ? `: ${what}` : ''}`);
};
const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };

const MIME_X = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIME_D = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ME = 'me@krs.co.kr';
const at = (d) => `${d}T12:00:00Z`;
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------------------------------------------------- 장부 흉내(계획 3.2 의 꼴) */

const att = (id, name, extra = {}) => ({ id, name, contentType: 'application/octet-stream', size: 2048, isInline: false, odataType: '#microsoft.graph.fileAttachment', ...extra });
const reply = (id, from, extra = {}) => ({
  id, from, key: null, receivedAt: at('2026-10-14'), subject: 'RE: 견적 양식 회신 부탁', conversationId: 'c1', hasAttachments: false,
  kind: 'reply', score: 3, counted: false, manual: false, attachments: [], bodyStored: true, webLink: '', review: 'pending', reviewedAt: '', ...extra,
});
const exp = (key, state, addresses, extra = {}) => ({
  key, kind: key.startsWith('addr:') ? 'address' : 'domain', label: key.replace(/^addr:/, ''), addresses, state, manual: false, doneAt: '', by: '', ...extra,
});
function restat(it) {
  const live = it.expect.filter((e) => e.state !== 'excluded');
  const responded = live.filter((e) => e.state === 'done').length;
  it.status = { expected: live.length, responded, excluded: it.expect.length - live.length, done: live.length > 0 && responded === live.length };
  return it;
}
const baseItem = (id, subject, sentAt, extra = {}) => ({
  id, conversationId: `c-${id}`, internetMessageId: `<${id}@krs>`, subject, subjectKey: subject, sentAt, registeredAt: sentAt, webLink: '',
  from: { name: '나', address: ME }, to: [], cc: [], expect: [], replies: [], attachments: [], templates: [], synced: false, closed: false, note: '', ...extra,
});

function makeBook() {
  const A = baseItem('A', '견적 양식 회신 부탁', at('2026-10-13'), {
    webLink: 'https://outlook.office365.com/owa/?ItemID=A', synced: true,
    to: [{ name: '김철수', address: 'a@foo.com' }, { name: '', address: 'c@bar.com' }],
    cc: [{ name: '박영희', address: 'kim@krs.co.kr' }],
    expect: [
      exp('foo.com', 'done', ['a@foo.com'], { by: 'a@foo.com', doneAt: at('2026-10-14') }),
      exp('bar.com', 'open', ['c@bar.com']),
      exp('baz.com', 'done', ['b@baz.com'], { by: 'b@baz.com', doneAt: at('2026-10-14') }),
      exp('addr:kim@krs.co.kr', 'done', ['kim@krs.co.kr'], { manual: true }),
      exp('qux.com', 'open', ['x@qux.com']),
      exp('zed.com', 'excluded', ['z@zed.com'], { manual: true }),
    ],
    replies: [
      // r1 은 수락한 회신, r4 는 저절로 센 뒤 아직 확인하지 않은 회신(확인 필요 + 집계됨), 나머지는 확인 필요.
      reply('r1', { name: '김철수', address: 'a@foo.com' }, { key: 'foo.com', counted: true, hasAttachments: true, review: 'accepted', reviewedAt: at('2026-10-14'), attachments: [{ ...att('a1', '견적_foo.xlsx'), stored: true, missing: false }] }),
      reply('r2', { name: '', address: 'c@bar.com' }, { key: 'bar.com', kind: 'candidate', score: 1, subject: '견적 관련', attachments: [{ ...att('a2', '견적_bar.xlsx'), stored: true, missing: false }] }),
      reply('r3', { name: 'Mail Delivery', address: 'postmaster@qux.com' }, { kind: 'ndr', score: 2, subject: 'Undeliverable: 견적 양식 회신 부탁' }),
      reply('r4', { name: '', address: 'b@baz.com' }, {
        key: 'baz.com', counted: true,
        attachments: [{ ...att('a4', 'big.xlsx', { size: 30_000_000 }), stored: false, missing: true }, { ...att('a5', '회신서_baz.docx'), stored: true, missing: false }],
      }),
      reply('r5', { name: '', address: 'x@qux.com' }, { key: 'qux.com', kind: 'auto', subject: '자동 회신: 견적 양식 회신 부탁' }),
      // 옛 형식(.xls) 첨부 — 병합 칸에 잠근 줄로만 보인다(합칠 수 없는 까닭과 함께).
      reply('r6', { name: '', address: 'someone@other.com' }, { attachments: [{ ...att('a6', '견적_old.xls'), stored: true, missing: false }] }),
    ],
    // 보낸 첨부 — 양식 둘(받아 둠), 서버가 바이트를 주지 않은 큰 것(missing), 파일이 아닌 첨부(stored:false · missing:false), 본문 그림(inline).
    attachments: [
      { ...att('t1', '견적양식.xlsx', { size: 20480 }), stored: true, missing: false }, { ...att('t2', '회신서.docx', { size: 1000 }), stored: true, missing: false },
      { ...att('s3', '안내.pdf', { size: 30_000_000 }), stored: false, missing: true }, { ...att('s4', '전달한 메일', { odataType: '#microsoft.graph.itemAttachment' }), stored: false, missing: false },
      att('i1', 'logo.png', { isInline: true }),
    ],
    templates: [{ attachmentId: 't1', name: '견적양식.xlsx', kind: 'xlsx', stored: true }, { attachmentId: 't2', name: '회신서.docx', kind: 'docx', stored: true }],
  });
  // 제목에 꼬리표가 든 메일 — 화면 요소가 되면 안 된다.
  const B = baseItem('B', '완료된 건 <img src=x onerror="globalThis.__pwned=1">', at('2026-10-10'), {
    to: [{ name: '', address: 'a@foo.com' }, { name: '', address: 'c@bar.com' }],
    expect: [exp('foo.com', 'done', ['a@foo.com'], { by: 'a@foo.com' }), exp('bar.com', 'done', ['c@bar.com'], { by: 'c@bar.com' })],
  });
  return {
    v: 1, me: ME,
    settings: { mcpUrl: 'http://localhost:5001/mcp', userEmail: '', sentDays: 30, windowDays: 90, ownByAddress: true, useHeaders: false, autoRefreshMin: 10, requireAccept: false },
    items: [restat(A), restat(B)], syncedUntil: '', lastSync: { at: 0, ok: true, error: '', fetched: 0, linked: 0 },
  };
}

const BODIES = [
  { itemId: 'A', messageId: 'A', subject: '견적 양식 회신 부탁', from: { name: '나', address: ME }, receivedAt: at('2026-10-13'), contentType: 'html',
    content: '<html><head><style>p { color: red }</style><title>t</title></head><body><p>안녕하세요,&nbsp;양식을   보냅니다.</p>\n<p>둘째 줄</p></body></html>', savedAt: 1 },
  { itemId: 'A', messageId: 'r1', subject: 'RE: 견적 양식 회신 부탁', from: { name: '김철수', address: 'a@foo.com' }, receivedAt: at('2026-10-14'), contentType: 'html',
    content: '<div>회신입니다 &lt;b&gt;굵게&lt;/b&gt;</div><script>globalThis.__pwned = 1</script><img src=x onerror="globalThis.__pwned=2"><p>끝</p>', savedAt: 1 },
  { itemId: 'A', messageId: 'r4', subject: 'RE: 견적 양식 회신 부탁', from: { name: '', address: 'b@baz.com' }, receivedAt: at('2026-10-14'), contentType: 'text',
    content: '<script>plain</script> 그대로 글자', savedAt: 1 },
];
const FILES = [
  { itemId: 'A', messageId: 'A', attachmentId: 't1', name: '견적양식.xlsx', contentType: MIME_X, size: 4, bytes: new Uint8Array([1, 2, 3, 4]) },
  { itemId: 'A', messageId: 'r1', attachmentId: 'a1', name: '견적_foo.xlsx', contentType: MIME_X, size: 3, bytes: new Uint8Array([5, 6, 7]) },
  { itemId: 'A', messageId: 'r4', attachmentId: 'a5', name: '회신서_baz.docx', contentType: MIME_D, size: 2, bytes: new Uint8Array([8, 9]) },
];
const SERVER_PATH = 'C:\\KR_MS365_mcp\\downloads\\mailtrack\\big.xlsx';
const OK_PROBE = {
  ok: true, server: 'outlook', missing: [],
  tools: ['mail_query_url', 'mail_query_if_emaidID', 'mail_attachment_meta', 'mail_attachment_download', 'test_handler', 'mail_fetch_filter'],
  has: { sent: true, details: true, meta: true, download: true, inbox: true, inboxFallback: true },
};

let clock = Date.parse('2026-10-15T06:00:00Z');

/** sync 흉내(계획 3.3 U2 sync API) — 부른 것을 차례로 적고, 장부(book)를 제자리에서 고친다. *Gate 는 그 호출을 붙잡아 두는 약속. */
function fakeSync(book) {
  const itemOf = (id) => book.items.find((x) => x.id === id);
  const replyOf = (id, rid) => itemOf(id).replies.find((r) => r.id === rid);
  const s = {
    calls: [], probeOut: OK_PROBE, probeErr: null, probeGate: null, listGate: null, regGate: null, regOut: null, regWarn: null, refreshGate: null, refreshErr: null, refreshOut: null, mergeErr: null,
    sent: [
      { id: 'A', subject: '견적 양식 회신 부탁', from: { name: '나', address: ME }, receivedAt: at('2026-10-13'), preview: '첨부한 양식으로 회신 부탁드립니다' },
      { id: 'n1', subject: '새 견적 요청', from: { name: '나', address: ME }, receivedAt: at('2026-10-14'), preview: '견적서를 보내 주세요' },
      { id: 'n2', subject: '회의록 공유', from: { name: '나', address: ME }, receivedAt: at('2026-10-12'), preview: '지난 회의 회의록입니다' },
      { id: 'n3', subject: '견적 재요청', from: { name: '나', address: ME }, receivedAt: at('2026-10-11'), preview: '' },
    ],
    book: () => book,
    async load() { s.calls.push(['load']); return book; },
    async probe() {
      s.calls.push(['probe']);
      if (s.probeGate) await s.probeGate;
      if (s.probeErr) throw s.probeErr;
      return s.probeOut;
    },
    async listSent(o) {
      s.calls.push(['listSent', o]);
      if (s.listGate) await s.listGate;
      return s.sent.map((m) => ({ ...m, registered: book.items.some((x) => x.id === m.id) }));
    },
    async register(ids) {
      s.calls.push(['register', ids]);
      if (s.regGate) await s.regGate;
      if (s.regOut) return s.regOut;
      const added = ids.map((id) => {
        const m = s.sent.find((x) => x.id === id);
        const it = restat(baseItem(id, m.subject, m.receivedAt, { to: [{ name: '', address: 'n@new.com' }], expect: [exp('new.com', 'open', ['n@new.com'])] }));
        book.items.push(it);
        return it;
      });
      return { added, skipped: [], errors: [], warnings: s.regWarn ? [...s.regWarn] : [] };
    },
    async refresh(o) {
      s.calls.push(['refresh', o]);
      if (s.refreshGate) await s.refreshGate;
      if (s.refreshErr) throw s.refreshErr;
      if (s.refreshOut) return s.refreshOut;
      book.lastSync = { at: clock, ok: true, error: '', fetched: 4, linked: 1 };
      return { ok: true, fetched: 4, linked: 1, at: clock };
    },
    async remove(id) {
      s.calls.push(['remove', id]);
      book.items = book.items.filter((x) => x.id !== id);
      return book;
    },
    async expect(id, key, state) {
      s.calls.push(['expect', id, key, state]);
      const it = itemOf(id);
      const e = it.expect.find((x) => x.key === key);
      if (state === 'auto') {
        // 손 표시를 풀고 회신대로(match.js setExpect 'auto' 의 흉내) — 센 회신이 있으면 완료, 없으면 기다림.
        e.manual = false;
        e.state = it.replies.some((r) => r.counted && r.key === key) ? 'done' : 'open';
      } else {
        e.state = state;
        e.manual = true;
      }
      return restat(it);
    },
    async close(id, on = true) {
      s.calls.push(['close', id, on]);
      itemOf(id).closed = !!on;
      return itemOf(id);
    },
    async link(id, rid, key) {
      s.calls.push(['link', id, rid, key]);
      Object.assign(replyOf(id, rid), { key, kind: 'reply', counted: true, manual: true, review: 'accepted' });
      return restat(itemOf(id));
    },
    async unlink(id, rid) { s.calls.push(['unlink', id, rid]); return itemOf(id); },
    async counted(id, rid, on) {
      s.calls.push(['counted', id, rid, on]);
      Object.assign(replyOf(id, rid), { counted: on, manual: true });
      return restat(itemOf(id));
    },
    async review(id, rid, state) {
      s.calls.push(['review', id, rid, state]);
      const it = itemOf(id);
      const r = replyOf(id, rid);
      const on = state === 'accepted';
      Object.assign(r, { review: state, reviewedAt: '2026-10-15T06:00:00Z', counted: on, manual: true, kind: on && r.kind === 'candidate' ? 'reply' : r.kind });
      // match.js settle 의 흉내 — 수동 아닌 받을 곳은 센 회신대로(거부하면 다시 기다림).
      for (const e of it.expect) {
        if (e.manual || e.state === 'excluded') continue;
        const c = it.replies.find((x) => x.counted && x.key === e.key);
        Object.assign(e, c ? { state: 'done', by: c.from.address, doneAt: c.receivedAt } : { state: 'open', by: '', doneAt: '' });
      }
      return restat(it);
    },
    async bodies(id) { s.calls.push(['bodies', id]); return BODIES.filter((b) => b.itemId === id); },
    async files(id) { s.calls.push(['files', id]); return FILES.filter((f) => f.itemId === id); },
    async fetchServerCopy(id, rid, aid) {
      s.calls.push(['fetchServerCopy', id, rid, aid]);
      // replyId 가 비었거나 itemId 와 같으면 보낸 메일 자신의 첨부(sync.js 와 같은 규칙).
      const atts = !rid || rid === id ? itemOf(id).attachments : replyOf(id, rid).attachments;
      const path = `${SERVER_PATH.replace(/[^\\]+$/, '')}${atts.find((a) => a.id === aid).name}`;
      atts.find((a) => a.id === aid).serverPath = path;
      return path;
    },
    async mergeFiles(id, opts) {
      s.calls.push(['mergeFiles', id, opts]);
      if (s.mergeErr) throw s.mergeErr;
      const kind = opts.templateAttachmentId === 't2' ? 'docx' : 'xlsx';
      return {
        name: `견적 양식 회신 부탁_병합_20261015.${kind}`, bytes: new Uint8Array([80, 75, 3, 4, 1, 2]), mime: kind === 'xlsx' ? MIME_X : MIME_D,
        report: {
          merged: opts.picks.length, ...(kind === 'xlsx' ? { rows: 7 } : {}),
          skipped: [{ source: { org: 'bar.com', name: '', address: 'c@bar.com', date: '2026-10-14' }, reason: '시트가 없습니다' }],
          warnings: ['표 서식(tableParts)을 지웠습니다'],
        },
      };
    },
    async settings(patch) {
      s.calls.push(['settings', patch]);
      book.settings = { ...book.settings, ...patch };
      return book;
    },
  };
  return s;
}
const callsOf = (s, name) => s.calls.filter((c) => c[0] === name);

/* ---------------------------------------------------------- 불러오기 */

console.log('불러오기 — chrome·indexedDB 없이');
await ta('import·만들기·wire() 는 chrome·indexedDB 를 건드리지 않고 sync 도 부르지 않는다(장부는 show 에서)', async () => {
  assert.equal(typeof globalThis.chrome, 'undefined');
  assert.equal(typeof globalThis.indexedDB, 'undefined');
  const { window } = new JSDOM('<!doctype html><body><section id="mail" class="mail hidden"></section></body>', { url: 'https://example.org/' });
  const { createMailPanel } = await import('../panel.js');
  const s = fakeSync(makeBook());
  const p = createMailPanel({ root: window.document.getElementById('mail'), $: (id) => window.document.getElementById(id), escapeHtml, logEvent: () => {}, sync: s });
  p.wire();
  p.wire();
  assert.deepEqual(s.calls, []);
  const root = window.document.getElementById('mail');
  assert.ok(root.classList.contains('hidden'), '보이기 전에는 숨은 채');
  assert.ok(root.querySelector('#mtList') && root.querySelector('#mtSettings'));
  assert.ok(!root.querySelector('#mtEmpty').classList.contains('hidden'), '장부를 읽기 전에는 빈 목록 안내');
  assert.equal(root.querySelector('#mtState').textContent, '확인 전');
  assert.throws(() => createMailPanel({ root, $: () => null }), /sync/);
});

const { createMailPanel, htmlToText, checkMcpUrl, safeName } = await import('../panel.js');

console.log('순수 도우미');
t('htmlToText — 스크립트·스타일·머리는 통째로, 태그는 떼고, 문단·줄바꿈은 줄로, 문자 참조는 푼다', () => {
  assert.equal(htmlToText('<p>가&nbsp;나</p><p>다<br>라</p>'), '가 나\n다\n라');
  assert.equal(htmlToText('<style>x{}</style><script>alert(1)</script><div>&lt;b&gt; &amp; &#44032;&#xAC01;</div>'), '<b> & 가각');
  assert.equal(htmlToText('<table><tr><td>1</td><td>2</td></tr></table>'), '1\t2');
  assert.equal(htmlToText('<ul><li>하나</li><li>둘</li></ul>'), '• 하나\n• 둘');
  assert.equal(htmlToText('<img src=x onerror=alert(1)>남음'), '남음');
  assert.equal(htmlToText(null), '');
});
t('checkMcpUrl — http(s)://localhost · 127.0.0.1 만(rerp/plussync.js 와 같은 규칙)', () => {
  assert.equal(checkMcpUrl('http://localhost:5001/mcp').ok, true);
  assert.equal(checkMcpUrl('https://127.0.0.1:5001/mcp').ok, true);
  assert.match(checkMcpUrl('http://evil.example.com:5001/mcp').error, /localhost · 127\.0\.0\.1.*evil\.example\.com/);
  assert.match(checkMcpUrl('file:///C:/x').error, /올바르지 않습니다/);
  assert.equal(checkMcpUrl('아무거나').ok, false);
});
t('safeName — 윈도·chrome.downloads 가 거절하는 글자는 _ 로, 길면 확장자를 살려 자른다', () => {
  assert.equal(safeName('a/b:c*?.xlsx'), 'a_b_c__.xlsx');
  assert.equal(safeName('견적 양식 회신 부탁_병합_20261015.xlsx'), '견적 양식 회신 부탁_병합_20261015.xlsx');
  assert.equal(safeName('  ..  '), '파일');
  const long = safeName(`${'가'.repeat(200)}.docx`);
  assert.equal(long.length, 150);
  assert.ok(long.endsWith('.docx'));
});

/* ---------------------------------------------------------- 진짜 패널 */

const { window } = new JSDOM('<!doctype html><body><nav class="tabs"><button id="tabMail" class="tab">메일</button></nav><section id="mail" class="mail hidden"></section></body>', { url: 'https://example.org/' });
const doc = window.document;
const $ = (id) => doc.getElementById(id);
const hidden = (id) => $(id).classList.contains('hidden');
const fire = (node, type) => node.dispatchEvent(new window.Event(type, { bubbles: true }));
const setVal = (node, v, type = 'change') => { node.value = v; fire(node, type); };
const check = (node, on) => { node.checked = on; fire(node, 'change'); };

const book = makeBook();
const s = fakeSync(book);
const logs = [];
const downloads = [];
const opened = [];
const copied = [];
const panel = createMailPanel({
  root: $('mail'), $, escapeHtml, sync: s,
  logEvent: (kind, ok, text, data) => logs.push({ kind, ok, text, data }),
  flash: () => {},
  download: async (f) => { downloads.push(f); },
  openTab: (url) => { opened.push(url); },
  copyText: async (text) => { copied.push(text); return true; },
  now: () => clock,
  confirmMs: 80,
});
panel.wire();

const card = (id) => $('mtList').querySelector(`.mt-item[data-id="${id}"]`);
const regInput = (id) => $('mtRegList').querySelector(`input[value="${id}"]`);
const regRows = () => [...$('mtRegList').querySelectorAll('.mt-reg-row')];
const expRow = (key) => [...$('mtExpect').querySelectorAll('tr[data-key]')].find((tr) => tr.dataset.key === key);
const expBtn = (key, text) => [...expRow(key).querySelectorAll('button')].find((b) => b.textContent === text);
const replyCard = (rid) => $('mtReplies').querySelector(`[data-reply="${rid}"]`);
const replyBtn = (rid, act) => replyCard(rid).querySelector(`[data-act="${act}"]`);
const attBtn = (rid, aid, act) => replyCard(rid).querySelector(`.mt-att[data-att="${aid}"] [data-act="${act}"]`);
const bodyOf = (rid) => replyCard(rid).querySelector('.mt-body');
const mergeRows = () => [...$('mtMergeFiles').querySelectorAll('label')].map((l) => {
  const i = l.querySelector('input');
  return [l.querySelector('.mt-att-name').textContent, i.checked, i.disabled, l.querySelector('.mt-src').textContent];
});
const pick = (r, a) => $('mtMergeFiles').querySelector(`input[data-r="${r}"][data-a="${a}"]`);
const noMarkup = () => {
  assert.equal($('mail').querySelectorAll('script, img, iframe, object').length, 0, '메일에서 온 글이 화면 요소가 됐습니다');
  assert.equal(globalThis.__pwned, undefined);
  assert.equal(window.__pwned, undefined);
};

console.log('화면 뼈대 · 보이기');
t('#mail 안에 머리·등록 대화·목록·상세·설정이 서고(id 는 mt 접두), 보이기 전에는 숨어 있다', () => {
  for (const id of ['mtState', 'mtAuth', 'mtRefresh', 'mtRegister', 'mtStamp', 'mtSummary', 'mtReg', 'mtRegDays', 'mtRegQ', 'mtRegList', 'mtRegGo', 'mtRegCancel',
    'mtList', 'mtEmpty', 'mtDetail', 'mtBack', 'mtStatus', 'mtExpect', 'mtSent', 'mtReplies', 'mtMerge', 'mtMergeTpl', 'mtMergeFiles', 'mtMergeHdr', 'mtMergeMode',
    'mtMergeGo', 'mtMergeReport', 'mtAllZip', 'mtRemove', 'mtSettings', 'mtUrl', 'mtUserEmail', 'mtOwnByAddress', 'mtUseHeaders', 'mtRequireAccept', 'mtProbe']) {
    assert.ok($(id) && $('mail').contains($(id)), `${id} 가 #mail 안에 없습니다`);
  }
  assert.equal($('mtSettings').tagName, 'DETAILS');
  assert.ok(hidden('mail'));
  assert.ok(hidden('mtReg') && hidden('mtDetail') && hidden('mtAuth'));
});
await ta('show() — 장부를 읽어 그리고, 서버를 확인하는 동안 칩은 "확인 중…"', async () => {
  const g = gate();
  s.probeGate = g.p;
  await panel.show();
  assert.ok(!hidden('mail'));
  assert.equal(callsOf(s, 'load').length, 1);
  assert.equal($('mtState').dataset.state, 'checking');
  assert.equal($('mtState').textContent, '확인 중…');
  assert.equal($('mtSummary').textContent, '진행 중 1 · 완료 1 · 확인 필요 5', '수락·거부하지 않은 회신 수(수락한 r1 은 빼고)');
  assert.equal($('mtStamp').textContent, '아직 갱신하지 않았습니다');
  assert.ok(panel.state().tick, '보이는 동안 "n분 전" 을 고치는 타이머');
  s.probeGate = null;
  g.open();
  await panel.state().bg;
});
t('서버가 살아 있고 갱신한 적이 없으면 저절로 새로고침(force 없이) — 칩은 연결됨', () => {
  assert.deepEqual(callsOf(s, 'refresh'), [['refresh', { force: false }]]);
  assert.equal($('mtState').dataset.state, 'ok');
  assert.equal($('mtState').textContent, 'Outlook 연결됨');
  assert.equal($('mtStamp').textContent, '마지막 갱신 방금');
  assert.equal($('mtMsg').textContent, '받은 메일 4건 · 새로 이어진 회신 1건(열 때)');
  assert.ok(logs.some((l) => l.kind === 'mail' && l.ok && /^메일 회신 갱신/.test(l.text)));
});
await ta('다시 열 때 마지막 갱신이 autoRefreshMin(10분) 안이면 찾지 않고, 지났으면 찾는다 · hide() 는 타이머를 치운다', async () => {
  panel.hide();
  assert.ok(hidden('mail'));
  assert.equal(panel.state().tick, null);
  clock += 5 * 60_000;
  await panel.show();
  await panel.state().bg;
  assert.equal(callsOf(s, 'refresh').length, 1);
  assert.match($('mtStamp').textContent, /^마지막 갱신 5분 전$/);
  panel.hide();
  clock += 6 * 60_000;
  await panel.show();
  await panel.state().bg;
  assert.equal(callsOf(s, 'refresh').length, 2);
  assert.match($('mtStamp').textContent, /^마지막 갱신 방금/);
});

console.log('연결 칩');
/** sync.probe 의 실패 꼴 — 던지지 않고 { ok:false, error:{kind,message,authUrl?}, kind } 로 돌려준다(sync.js). */
const probeFail = (kind, message, authUrl) => ({
  ok: false, server: null, tools: [], has: {}, missing: [], error: { kind, message, ...(authUrl ? { authUrl } : {}) }, kind, ...(authUrl ? { authUrl } : {}),
});
await ta('서버가 꺼져 있으면 "MCP 서버가 꺼져 있습니다(:5001)" — 설정의 연결 확인에도, 기록은 까닭이 바뀔 때만', async () => {
  s.probeOut = probeFail('offline', 'fetch failed');
  const before = logs.filter((l) => /^메일 서버 확인 실패/.test(l.text)).length;
  $('mtProbe').click();
  await until(() => $('mtState').dataset.state === 'offline' && !$('mtProbe').disabled, '꺼짐');
  assert.equal($('mtState').textContent, 'MCP 서버가 꺼져 있습니다(:5001)');
  assert.ok(hidden('mtAuth'));
  assert.match($('mtSetMsg').textContent, /꺼져 있습니다/);
  $('mtProbe').click();
  await until(() => $('mtState').dataset.state === 'offline' && !$('mtProbe').disabled);
  const fails = logs.filter((l) => /^메일 서버 확인 실패/.test(l.text));
  assert.equal(fails.length, before + 1, '꺼진 채 다시 확인해도 기록은 한 줄');
  assert.deepEqual(fails.at(-1), { kind: 'mail', ok: false, text: '메일 서버 확인 실패: Outlook MCP 서버가 꺼져 있습니다(http://localhost:5001/mcp)', data: { kind: 'offline' } });
});
await ta('로그인이 풀렸으면 "Microsoft 로그인 필요" 와 열기 — 누르면 로그인 주소를 새 탭으로(기록에는 남기지 않는다)', async () => {
  const url = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=abc';
  s.probeOut = probeFail('auth', 'auth_required', url);
  $('mtProbe').click();
  await until(() => $('mtState').dataset.state === 'auth', '로그인 필요');
  assert.equal($('mtState').textContent, 'Microsoft 로그인 필요');
  assert.ok(!hidden('mtAuth'));
  $('mtAuth').click();
  assert.deepEqual(opened, [url]);
  assert.ok(!JSON.stringify(logs).includes('login.microsoftonline'));
});
await ta('필요한 도구가 없으면 "도구 없음: …" — 결과로 오든(ok:false · missing) 던지든(kind notool)', async () => {
  s.probeOut = { ok: false, server: 'outlook', tools: ['mail_query_url'], missing: ['test_handler', 'mail_attachment_download'], has: {} };
  $('mtProbe').click();
  await until(() => $('mtState').dataset.state === 'notool' && !$('mtProbe').disabled, '도구 없음');
  assert.equal($('mtState').textContent, '도구 없음: test_handler, mail_attachment_download');
  assert.ok(hidden('mtAuth'));
  s.probeErr = Object.assign(new Error('missing'), { kind: 'notool', missing: ['mail_attachment_meta'] });
  $('mtProbe').click();
  await until(() => $('mtState').textContent === '도구 없음: mail_attachment_meta' && !$('mtProbe').disabled);
});
await ta('다시 살아나면 연결됨', async () => {
  s.probeErr = null;
  s.probeOut = OK_PROBE;
  $('mtProbe').click();
  await until(() => $('mtState').dataset.state === 'ok' && !$('mtProbe').disabled);
  assert.equal($('mtSetMsg').textContent, '연결됨 — 연결됨 · 도구 6개');
});
await ta('지난 갱신이 로그인 때문에 실패했으면(lastSync.kind) 다시 열 때 칩이 "로그인 필요" 로 선다 — 도구 목록은 로그인 없이도 오므로', async () => {
  const keep = book.lastSync;
  book.lastSync = { at: clock, ok: false, error: '로그인이 필요합니다', fetched: 0, linked: 0, kind: 'auth' };
  panel.hide();
  await panel.show();
  await panel.state().bg;
  assert.equal($('mtState').dataset.state, 'auth');
  assert.ok(hidden('mtAuth'), '로그인 주소가 없으면 열기는 없다');
  assert.match($('mtStamp').textContent, /^갱신 실패 방금$/);
  book.lastSync = keep;
  $('mtProbe').click();
  await until(() => $('mtState').dataset.state === 'ok' && !$('mtProbe').disabled);
});

console.log('목록');
t('메일마다 N/M 배지 — 다 받으면 초록 "완료", 진행 중인 것이 위', () => {
  assert.deepEqual([...$('mtList').querySelectorAll('.mt-item')].map((b) => b.dataset.id), ['A', 'B']);
  assert.equal(card('A').querySelector('.mt-badge').textContent, '3/5');
  assert.ok(!card('A').querySelector('.mt-badge').classList.contains('done'));
  assert.equal(card('B').querySelector('.mt-badge').textContent, '완료');
  assert.ok(card('B').querySelector('.mt-badge').classList.contains('done'));
  assert.ok(card('B').classList.contains('done'));
  assert.ok(hidden('mtEmpty'));
});
t('받을 곳 칩은 상태 색(done·open·excluded) · 첨부 수(본문 그림은 빼고) · 회신 수', () => {
  const chips = [...card('A').querySelectorAll('.mt-key')].map((k) => [k.textContent, [...k.classList].filter((c) => c !== 'mt-key').join()]);
  assert.deepEqual(chips, [['foo.com', 'done'], ['bar.com', 'open'], ['baz.com', 'done'], ['kim@krs.co.kr', 'done'], ['qux.com', 'open'], ['zed.com', 'excluded']]);
  assert.match(card('A').querySelector('.mt-item-meta').textContent, /^2026-10-1\d 보냄 · 첨부 4 · 회신 6 · 확인 필요 5$/);
  assert.doesNotMatch(card('B').querySelector('.mt-item-meta').textContent, /확인 필요/, '확인할 회신이 없으면 적지 않는다');
});
t('메일에서 온 제목은 글자로만 — <img onerror> 가 요소가 되지 않는다', () => {
  assert.equal(card('B').querySelector('.mt-subj').textContent, '완료된 건 <img src=x onerror="globalThis.__pwned=1">');
  noMarkup();
});

console.log('등록 대화');
await ta('등록 + — 설정의 기간(30일)으로 보낸 메일을 불러오고, 그동안 aria-busy', async () => {
  const g = gate();
  s.listGate = g.p;
  $('mtRegister').click();
  assert.ok(!hidden('mtReg'));
  assert.equal($('mtRegister').getAttribute('aria-expanded'), 'true');
  assert.equal($('mtReg').getAttribute('aria-busy'), 'true');
  assert.equal($('mtRegDays').value, '30');
  assert.deepEqual([...$('mtRegDays').options].map((o) => o.value), ['7', '14', '30', '60']);
  assert.deepEqual(callsOf(s, 'listSent'), [['listSent', { days: 30 }]]);
  s.listGate = null;
  g.open();
  await until(() => $('mtReg').getAttribute('aria-busy') === 'false');
  assert.equal(regRows().length, 4);
});
t('이미 등록된 메일은 잠기고 "등록됨" — 나머지는 고를 수 있다', () => {
  assert.ok(regInput('A').disabled);
  assert.match(regInput('A').closest('li').textContent, /등록됨/);
  for (const id of ['n1', 'n2', 'n3']) {
    assert.ok(!regInput(id).disabled);
    assert.doesNotMatch(regInput(id).closest('li').textContent, /등록됨/);
  }
  assert.ok($('mtRegGo').disabled, '고른 것이 없으면 잠김');
  assert.match(regInput('n1').closest('li').querySelector('.mt-reg-prev').textContent, /견적서를 보내 주세요/);
});
await ta('기간을 바꾸면 그 기간으로 다시 불러온다', async () => {
  setVal($('mtRegDays'), '14');
  await until(() => callsOf(s, 'listSent').length === 2 && $('mtReg').getAttribute('aria-busy') === 'false');
  assert.deepEqual(callsOf(s, 'listSent')[1], ['listSent', { days: 14 }]);
});
t('제목으로 거르기 — 맞는 것이 없으면 한 줄 알림', () => {
  setVal($('mtRegQ'), '견적', 'input');
  assert.deepEqual(regRows().map((li) => li.querySelector('input').value), ['A', 'n1', 'n3']);
  setVal($('mtRegQ'), 'zzz', 'input');
  assert.equal(regRows().length, 0);
  assert.match($('mtRegList').textContent, /거른 결과가 없습니다/);
  setVal($('mtRegQ'), '', 'input');
  assert.equal(regRows().length, 4);
});
await ta('등록이 통째로 실패하면(sync.register 는 던지지 않고 error 를 싣는다) 결과 줄에 오류, 로그인 문제면 칩도', async () => {
  const url = 'https://login.microsoftonline.com/x?state=reg';
  s.regOut = { added: [], skipped: [], errors: ['Microsoft 로그인이 필요합니다'], error: { kind: 'auth', message: 'Microsoft 로그인이 필요합니다', authUrl: url } };
  const refreshes = callsOf(s, 'refresh').length;
  check(regInput('n2'), true);
  $('mtRegGo').click();
  await until(() => /오류 1/.test($('mtRegMsg').textContent) && $('mtReg').getAttribute('aria-busy') === 'false');
  assert.equal($('mtRegMsg').textContent, '등록 0 · 건너뜀 0 · 오류 1: Microsoft 로그인이 필요합니다');
  assert.match($('mtRegMsg').className, /error/);
  assert.equal($('mtState').dataset.state, 'auth');
  assert.ok(!hidden('mtAuth'));
  assert.equal(callsOf(s, 'refresh').length, refreshes, '하나도 등록하지 못했으면 찾지 않는다');
  assert.ok(logs.some((l) => !l.ok && l.text === '메일 등록: 등록 0 · 건너뜀 0 · 오류 1: Microsoft 로그인이 필요합니다'));
  assert.ok(!regInput('n2').checked, '고른 것은 비운다');
  s.regOut = null;
});
await ta('고른 것만 sync.register 로 — 거르기를 해도 고른 것은 남고, 등록 중에는 aria-busy, 끝나면 결과 줄과 "등록됨", 곧바로 한 번 새로고침', async () => {
  const refreshes = callsOf(s, 'refresh').length;
  check(regInput('n1'), true);
  check(regInput('n3'), true);
  assert.equal($('mtRegGo').textContent, '선택 등록 (2)');
  assert.ok(!$('mtRegGo').disabled);
  setVal($('mtRegQ'), '회의', 'input');
  setVal($('mtRegQ'), '', 'input');
  assert.ok(regInput('n1').checked && regInput('n3').checked && !regInput('n2').checked);
  const g = gate();
  s.regGate = g.p;
  $('mtRegGo').click();
  assert.equal($('mtReg').getAttribute('aria-busy'), 'true');
  assert.ok($('mtRegGo').disabled);
  s.regGate = null;
  g.open();
  await until(() => $('mtReg').getAttribute('aria-busy') === 'false' && /^등록 2/.test($('mtRegMsg').textContent), '등록 결과');
  assert.deepEqual(callsOf(s, 'register').at(-1), ['register', ['n1', 'n3']]);
  assert.equal($('mtRegMsg').textContent, '등록 2 · 건너뜀 0');
  assert.ok(regInput('n1').disabled && regInput('n3').disabled && !regInput('n2').disabled);
  assert.equal($('mtList').querySelectorAll('.mt-item').length, 4);
  assert.equal($('mtSummary').textContent, '진행 중 3 · 완료 1 · 확인 필요 5');
  assert.ok(logs.some((l) => l.ok && l.text === '메일 등록: 등록 2 · 건너뜀 0'));
  // 등록 전에 이미 와 있던 회신이 바로 이어지게 — 그리고 칩도 연결됨으로 돌아온다.
  await until(() => callsOf(s, 'refresh').length === refreshes + 1 && !$('mtRefresh').disabled, '등록 뒤 새로고침');
  assert.deepEqual(callsOf(s, 'refresh').at(-1), ['refresh', { force: false }]);
  assert.equal($('mtMsg').textContent, '받은 메일 4건 · 새로 이어진 회신 1건(등록 뒤)');
  assert.equal($('mtState').dataset.state, 'ok');
});
await ta('등록의 주의(warnings — 서버가 주지 않은 큰 첨부)는 오류가 아니다: 결과 줄은 붉지 않고 그 아래 흐린 한 줄, 기록은 성공 한 줄', async () => {
  const warn = '큰 첨부 1개는 서버가 바이트를 주지 않았습니다 — "서버에 저장" 으로 받으세요: 안내.pdf';
  s.regWarn = [warn];
  const before = logs.filter((l) => /^메일 등록/.test(l.text)).length;
  const refreshes = callsOf(s, 'refresh').length;
  check(regInput('n2'), true);
  $('mtRegGo').click();
  await until(() => $('mtReg').getAttribute('aria-busy') === 'false' && $('mtRegMsg').querySelector('.mt-note'), '등록 결과');
  assert.equal($('mtRegMsg').firstChild.textContent, '등록 1 · 건너뜀 0');
  assert.doesNotMatch($('mtRegMsg').className, /error/);
  assert.equal($('mtRegMsg').querySelector('.mt-note').textContent, `주의: ${warn}`);
  const regLogs = logs.filter((l) => /^메일 등록/.test(l.text));
  assert.equal(regLogs.length, before + 1, '한 번 등록에 기록 한 줄');
  assert.deepEqual([regLogs.at(-1).ok, regLogs.at(-1).text, regLogs.at(-1).data.warnings], [true, '메일 등록: 등록 1 · 건너뜀 0', [warn]]);
  await until(() => callsOf(s, 'refresh').length === refreshes + 1 && !$('mtRefresh').disabled, '등록 뒤 새로고침');
  s.regWarn = null;
});
t('닫기', () => {
  $('mtRegCancel').click();
  assert.ok(hidden('mtReg'));
  assert.equal($('mtRegister').getAttribute('aria-expanded'), 'false');
});

console.log('상세');
t('양식이 없는 메일은 병합 칸이 없다 · 뒤로', () => {
  card('B').click();
  assert.ok(hidden('mtListBox') && !hidden('mtDetail'));
  assert.equal($('mtStatus').textContent, '2/2 · 완료');
  assert.ok(hidden('mtMerge'));
  noMarkup();
  $('mtBack').click();
  assert.ok(!hidden('mtListBox') && hidden('mtDetail'));
});
t('목록을 누르면 상세 — 머리(제목·받는 사람·참조) · 상태 줄 · 받을 곳 표와 단추', () => {
  card('A').click();
  assert.ok(hidden('mtListBox') && !hidden('mtDetail'));
  assert.equal($('mtHeader').querySelector('.mt-title').textContent, '견적 양식 회신 부탁');
  assert.match($('mtHeader').textContent, /김철수 <a@foo\.com>, c@bar\.com/);
  assert.match($('mtHeader').textContent, /참조박영희 <kim@krs\.co\.kr>/);
  assert.equal($('mtStatus').textContent, '3/5 · 진행 중 · 제외 1');
  const btns = (key) => [...expRow(key).querySelectorAll('button')].map((b) => b.textContent);
  assert.deepEqual(btns('bar.com'), ['완료로 표시', '제외']);
  assert.deepEqual(btns('foo.com'), ['제외'], '회신으로 완료된 곳은 회신의 "거부" 로 되돌린다');
  assert.deepEqual(btns('addr:kim@krs.co.kr'), ['되돌리기', '제외'], '손으로 정한 것만 되돌리기');
  assert.deepEqual(btns('zed.com'), ['포함']);
  assert.match(expRow('foo.com').querySelector('.mt-who').textContent, /^a@foo\.com · 2026-10-1\d$/);
  assert.ok(expRow('addr:kim@krs.co.kr').querySelector('.mt-manual'), '손으로 정한 것은 표시');
});
await ta('Outlook 에서 열기 — webLink 를 새 탭으로', async () => {
  $('mtHeader').querySelector('[data-act="web"]').click();
  assert.equal(opened.at(-1), 'https://outlook.office365.com/owa/?ItemID=A');
});
await ta('받을 곳 단추 → sync.expect(itemId, key, state) — 되돌리기·포함은 \'auto\'(손 표시를 풀고 회신대로), 다시 그려 N/M 이 바뀐다', async () => {
  expBtn('bar.com', '완료로 표시').click();
  await until(() => $('mtStatus').textContent.startsWith('4/5'));
  assert.ok(expRow('bar.com').querySelector('.mt-manual'));
  expBtn('zed.com', '포함').click();
  await until(() => $('mtStatus').textContent.startsWith('4/6'));
  expBtn('bar.com', '되돌리기').click();
  await until(() => $('mtStatus').textContent.startsWith('3/6'));
  assert.ok(!expRow('bar.com').querySelector('.mt-manual'));
  expBtn('zed.com', '제외').click();
  await until(() => $('mtStatus').textContent === '3/5 · 진행 중 · 제외 1');
  assert.deepEqual(callsOf(s, 'expect'), [
    ['expect', 'A', 'bar.com', 'done'], ['expect', 'A', 'zed.com', 'auto'], ['expect', 'A', 'bar.com', 'auto'], ['expect', 'A', 'zed.com', 'excluded'],
  ]);
  assert.ok(logs.some((l) => l.ok && l.text === '받을 곳 bar.com: 회신대로 셉니다'));
});
await ta('추적 끝내기/다시 추적 → sync.close(itemId, on) — 상태 줄에 "닫음"', async () => {
  assert.ok(!hidden('mtClose'));
  assert.equal($('mtClose').textContent, '추적 끝내기');
  $('mtClose').click();
  await until(() => $('mtStatus').textContent.endsWith(' · 닫음') && !$('mtClose').disabled);
  assert.equal($('mtClose').textContent, '다시 추적');
  $('mtClose').click();
  await until(() => !$('mtStatus').textContent.endsWith(' · 닫음') && !$('mtClose').disabled);
  assert.deepEqual(callsOf(s, 'close'), [['close', 'A', true], ['close', 'A', false]]);
});
const chipsOf = (rid) => [...replyCard(rid).querySelectorAll('.mt-reply-top .mt-chip')].map((c) => c.textContent);
const reviewBtn = (rid, state) => replyCard(rid).querySelector(`[data-act="review"][data-state="${state}"]`);
t('회신 카드 — 종류 칩 · 확인 칩(확인 필요/수락/거부) · 집계됨, 수락/거부는 지금 상태가 아닌 쪽만, 받을 곳이 없으면 수락 잠김, 후보·대상 아님에는 연결', () => {
  assert.equal($('mtReplyCount').textContent, '6');
  assert.deepEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map(chipsOf), [
    ['회신', '수락'], ['후보', '확인 필요'], ['배달 실패', '확인 필요'], ['회신', '확인 필요', '집계됨'], ['자동 회신', '확인 필요'], ['대상 아님', '확인 필요'],
  ]);
  const acts = (rid) => [...replyCard(rid).querySelectorAll('[data-act="review"]')].map((b) => `${b.textContent}${b.disabled ? '(잠김)' : ''}`);
  assert.deepEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map(acts), [['거부'], ['수락', '거부'], ['수락(잠김)', '거부'], ['수락', '거부'], ['수락', '거부'], ['수락(잠김)', '거부']]);
  assert.ok(replyCard('r1').classList.contains('accepted') && replyCard('r4').classList.contains('pending'));
  assert.ok(!replyCard('r1').querySelector('.mt-link-key'));
  assert.equal(replyCard('r2').querySelector('.mt-link-key').value, 'bar.com', '후보는 짐작한 받을 곳이 골라져 있다');
  assert.ok(replyCard('r3').querySelector('.mt-link-key') && replyCard('r6').querySelector('.mt-link-key'));
});
await ta('수락/거부 → sync.review(itemId, replyId, state) — 거부하면 받을 곳이 다시 기다림(N/M 내려감)·병합 칸에서 잠김, 수락하면 되돌아온다', async () => {
  reviewBtn('r1', 'rejected').click();
  await until(() => replyCard('r1').classList.contains('rejected') && $('mtStatus').textContent.startsWith('2/5'), '거부');
  assert.deepEqual(chipsOf('r1'), ['회신', '거부']);
  assert.ok(!reviewBtn('r1', 'rejected') && reviewBtn('r1', 'accepted'), '거부한 뒤에는 수락만');
  assert.deepEqual([...expRow('foo.com').querySelectorAll('button')].map((b) => b.textContent), ['완료로 표시', '제외'], '받을 곳이 다시 기다림');
  const row = mergeRows().find((r) => r[0] === '견적_foo.xlsx');
  assert.deepEqual(row.slice(1, 3), [false, true]);
  assert.match(row[3], /^foo\.com · 김철수 <a@foo\.com> · 2026-10-1\d · 거부한 회신 — 수락하면 합칠 수 있습니다$/);
  assert.ok($('mtMergeFiles').querySelector('.mt-rejected'));
  assert.ok(!$('mtMergeGo').disabled, '다른 회신 첨부가 남아 있다');
  reviewBtn('r1', 'accepted').click();
  await until(() => replyCard('r1').classList.contains('accepted') && $('mtStatus').textContent.startsWith('3/5'), '수락');
  assert.deepEqual(mergeRows().find((r) => r[0] === '견적_foo.xlsx').slice(1, 3), [true, false], '수락하면 다시 고를 수 있다');
  reviewBtn('r5', 'accepted').click();
  await until(() => $('mtStatus').textContent.startsWith('4/5'), '자동 회신 수락');
  assert.deepEqual(chipsOf('r5'), ['자동 회신', '수락'], '자동 회신도 수락하면 센다');
  reviewBtn('r5', 'rejected').click();
  await until(() => $('mtStatus').textContent.startsWith('3/5'), '자동 회신 거부');
  assert.deepEqual(callsOf(s, 'review'), [['review', 'A', 'r1', 'rejected'], ['review', 'A', 'r1', 'accepted'], ['review', 'A', 'r5', 'accepted'], ['review', 'A', 'r5', 'rejected']]);
  assert.ok(logs.some((l) => l.ok && l.text === '회신을 거부했습니다 — 받을 곳은 다시 기다립니다'));
  assert.ok(logs.some((l) => l.ok && l.text === '회신을 수락했습니다 — 받을 곳을 완료로 셉니다'));
  assert.match($('mtSummary').textContent, / · 확인 필요 4$/, '머리의 확인 필요도 줄어든다(r1 수락 · r5 거부)');
  assert.equal(callsOf(s, 'counted').length, 0, '옛 세기/빼기는 부르지 않는다');
});
await ta('후보·대상 아님은 받을 곳을 골라 연결 → sync.link(itemId, replyId, key)', async () => {
  replyBtn('r2', 'link').click();
  await until(() => callsOf(s, 'link').length === 1 && !replyCard('r2').querySelector('.mt-link-key'));
  setVal(replyCard('r3').querySelector('.mt-link-key'), 'qux.com');
  replyBtn('r3', 'link').click();
  await until(() => callsOf(s, 'link').length === 2);
  assert.deepEqual(callsOf(s, 'link'), [['link', 'A', 'r2', 'bar.com'], ['link', 'A', 'r3', 'qux.com']]);
  await until(() => replyCard('r3').querySelector('.mt-reply-meta').textContent === 'postmaster@qux.com → qux.com');
});
await ta('회신 본문은 글자로만 — <script> · <img onerror> 가 요소가 되지 않고 실행되지 않는다', async () => {
  replyBtn('r1', 'body').click();
  await until(() => !bodyOf('r1').classList.contains('hidden') && bodyOf('r1').textContent !== '읽는 중…', '본문');
  assert.equal(bodyOf('r1').textContent, '회신입니다 <b>굵게</b>\n끝');
  assert.equal(bodyOf('r1').children.length, 0);
  assert.equal(replyBtn('r1', 'body').textContent, '본문 접기');
  // text/plain 본문은 꺾쇠까지 그대로 글자로.
  replyBtn('r4', 'body').click();
  await until(() => bodyOf('r4').textContent === '<script>plain</script> 그대로 글자');
  noMarkup();
  assert.equal(callsOf(s, 'bodies').length, 1, '본문은 한 번 읽어 둔다');
  replyBtn('r4', 'body').click();
  assert.ok(bodyOf('r4').classList.contains('hidden'));
});
await ta('보낸 메일 본문 보기 — 머리·스타일은 빼고 글자로', async () => {
  $('mtSentBody').click();
  await until(() => !hidden('mtSentText') && $('mtSentText').textContent !== '읽는 중…');
  assert.equal($('mtSentText').textContent, '안녕하세요, 양식을 보냅니다.\n둘째 줄');
  assert.equal($('mtSentBody').getAttribute('aria-expanded'), 'true');
  $('mtSentBody').click();
  assert.ok(hidden('mtSentText'));
});
await ta('회신 첨부 내려받기 — 금고(sync.files)의 바이트로 {name, bytes, mime}', async () => {
  attBtn('r1', 'a1', 'dl').click();
  await until(() => downloads.length === 1);
  assert.equal(downloads[0].name, '견적_foo.xlsx');
  assert.deepEqual([...downloads[0].bytes], [5, 6, 7]);
  assert.equal(downloads[0].mime, MIME_X);
  assert.deepEqual(callsOf(s, 'files'), [['files', 'A']]);
});
await ta('보낸 메일의 첨부 — 양식 칩, 본문 그림은 빼고, 받아 둔 것은 내려받기 · 서버가 주지 않은 것은 서버에 저장 · 파일이 아닌 것은 "받지 않음"', async () => {
  const rows = [...$('mtSentAtts').querySelectorAll('.mt-att')];
  assert.deepEqual(rows.map((li) => li.querySelector('.mt-att-name').textContent), ['견적양식.xlsx', '회신서.docx', '안내.pdf', '전달한 메일']);
  assert.deepEqual(rows.map((li) => !!li.querySelector('.mt-chip.tpl')), [true, true, false, false]);
  assert.deepEqual(rows.map((li) => li.querySelector('[data-act]')?.dataset.act || li.querySelector('.mt-att-off')?.textContent), ['dl', 'dl', 'server', '받지 않음']);
  rows[0].querySelector('[data-act="dl"]').click();
  await until(() => downloads.length === 2);
  assert.equal(downloads[1].name, '견적양식.xlsx');
  assert.deepEqual([...downloads[1].bytes], [1, 2, 3, 4]);
  assert.equal(callsOf(s, 'files').length, 1, '첨부 목록도 한 번 읽어 둔다');
});
await ta('서버가 보내 주지 않은 큰 첨부 — 서버에 저장 → sync.fetchServerCopy → 경로가 서고 복사할 수 있다', async () => {
  attBtn('r4', 'a4', 'server').click();
  await until(() => replyCard('r4').querySelector('.mt-path'), '서버 경로');
  assert.deepEqual(callsOf(s, 'fetchServerCopy'), [['fetchServerCopy', 'A', 'r4', 'a4']]);
  assert.equal(replyCard('r4').querySelector('.mt-path').textContent, SERVER_PATH);
  assert.equal($('mtMsg').textContent, `서버 PC 에 저장했습니다: ${SERVER_PATH}`);
  attBtn('r4', 'a4', 'copy-path').click();
  await until(() => copied.length === 1);
  assert.equal(copied[0], SERVER_PATH);
});
await ta('보낸 메일 자신의 큰 첨부도 서버에 저장 — replyId 자리에 항목 id', async () => {
  $('mtSentAtts').querySelector('.mt-att[data-att="s3"] [data-act="server"]').click();
  await until(() => $('mtSentAtts').querySelector('.mt-att[data-att="s3"] .mt-path'), '보낸 첨부 서버 경로');
  assert.deepEqual(callsOf(s, 'fetchServerCopy')[1], ['fetchServerCopy', 'A', 'A', 's3']);
  assert.equal($('mtSentAtts').querySelector('.mt-att[data-att="s3"] .mt-path').textContent, 'C:\\KR_MS365_mcp\\downloads\\mailtrack\\안내.pdf');
});

console.log('양식 병합');
t('양식(엑셀)이 있으면 병합 칸 — 같은 종류의 회신 첨부만, 기본 전부 체크, 출처 표시, 확장에 없는 것은 잠김', () => {
  assert.ok(!hidden('mtMerge'));
  assert.deepEqual([...$('mtMergeTpl').options].map((o) => [o.value, o.textContent]), [['t1', '견적양식.xlsx'], ['t2', '회신서.docx']]);
  assert.equal($('mtMergeTpl').value, 't1');
  assert.ok(!hidden('mtMergeHdrRow') && hidden('mtMergeModeRow'));
  const rows = mergeRows();
  assert.deepEqual(rows.map((r) => r.slice(0, 3)), [['견적_foo.xlsx', true, false], ['견적_bar.xlsx', true, false], ['big.xlsx', false, true], ['견적_old.xls', false, true]]);
  assert.match(rows[0][3], /^foo\.com · 김철수 <a@foo\.com> · 2026-10-1\d$/);
  assert.match(rows[1][3], /^bar\.com · c@bar\.com · 2026-10-1\d$/);
  assert.match(rows[2][3], /확장에 저장되지 않아 합칠 수 없습니다$/);
  // 옛 .xls 는 고를 수 없는 줄로 — 회신이 왔는데 병합 칸에 없는 까닭을 보인다.
  assert.match(rows[3][3], /^other\.com · someone@other\.com · 2026-10-1\d · 지원하지 않는 형식\(\.xls\) — xlsx 로 저장해 다시 받아 주세요$/);
  assert.ok($('mtMergeFiles').querySelector('.mt-unsupported'));
  assert.ok(!$('mtMergeGo').disabled);
});
await ta('고른 첨부만 sync.mergeFiles 로 — 결과를 download({name, bytes, mime}) 하고 보고를 적는다', async () => {
  check(pick('r2', 'a2'), false);
  const n = downloads.length;
  $('mtMergeGo').click();
  await until(() => downloads.length === n + 1 && !$('mtMerge').hasAttribute('aria-busy'), '병합');
  assert.deepEqual(callsOf(s, 'mergeFiles'), [['mergeFiles', 'A', { templateAttachmentId: 't1', picks: [{ messageId: 'r1', attachmentId: 'a1' }], options: { headerRows: 'auto' } }]]);
  const d = downloads.at(-1);
  assert.equal(d.name, '견적 양식 회신 부탁_병합_20261015.xlsx');
  assert.ok(d.bytes instanceof Uint8Array && d.bytes.length === 6);
  assert.equal(d.mime, MIME_X);
  assert.deepEqual([...$('mtMergeReport').querySelectorAll('p')].map((p) => p.textContent), [
    '견적 양식 회신 부탁_병합_20261015.xlsx — 회신 1건을 합쳤습니다 · 7행',
    '건너뜀: bar.com · c@bar.com · 2026-10-14 — 시트가 없습니다',
    '주의: 표 서식(tableParts)을 지웠습니다',
  ]);
  assert.ok(logs.some((l) => l.ok && /^양식 병합: 견적 양식 회신 부탁_병합_20261015\.xlsx — 회신 1건$/.test(l.text)));
  assert.equal(pick('r2', 'a2').checked, false, '끈 것은 다시 그려도 꺼진 채');
});
t('하나도 고르지 않으면 병합 단추가 잠긴다(빈 picks 는 sync 가 던진다)', () => {
  check(pick('r1', 'a1'), false);
  assert.ok($('mtMergeGo').disabled);
  assert.equal($('mtMergeGo').title, '합칠 회신 첨부를 고르세요');
  check(pick('r1', 'a1'), true);
  assert.ok(!$('mtMergeGo').disabled);
});
await ta('머리 행을 숫자로 고르면 headerRows 로', async () => {
  setVal($('mtMergeHdr'), '2');
  $('mtMergeGo').click();
  await until(() => callsOf(s, 'mergeFiles').length === 2 && !$('mtMerge').hasAttribute('aria-busy'));
  assert.deepEqual(callsOf(s, 'mergeFiles')[1][2].options, { headerRows: 2 });
});
await ta('워드 양식으로 바꾸면 합치는 방식(쌓기/표 행) — rows 로', async () => {
  setVal($('mtMergeTpl'), 't2');
  assert.ok(hidden('mtMergeHdrRow') && !hidden('mtMergeModeRow'));
  assert.deepEqual(mergeRows().map((r) => r.slice(0, 3)), [['회신서_baz.docx', true, false]]);
  setVal($('mtMergeMode'), 'rows');
  const n = downloads.length;
  $('mtMergeGo').click();
  await until(() => downloads.length === n + 1 && !$('mtMerge').hasAttribute('aria-busy'));
  assert.deepEqual(callsOf(s, 'mergeFiles')[2], ['mergeFiles', 'A', { templateAttachmentId: 't2', picks: [{ messageId: 'r4', attachmentId: 'a5' }], options: { mode: 'rows' } }]);
  assert.equal(downloads.at(-1).name, '견적 양식 회신 부탁_병합_20261015.docx');
  assert.equal(downloads.at(-1).mime, MIME_D);
  assert.match($('mtMergeReport').textContent, /회신 1건을 합쳤습니다/);
  assert.doesNotMatch($('mtMergeReport').textContent, /행/, 'docx 보고에는 행 수가 없다');
});
await ta('병합이 실패하면 보고 줄 · 알림 줄 · 기록에', async () => {
  s.mergeErr = new Error('양식 파일을 읽지 못했습니다');
  const n = downloads.length;
  $('mtMergeGo').click();
  await until(() => /병합 실패/.test($('mtMergeReport').textContent) && !$('mtMerge').hasAttribute('aria-busy'));
  assert.equal($('mtMergeReport').textContent, '병합 실패: 양식 파일을 읽지 못했습니다');
  assert.equal($('mtMsg').className, 'status mt-msg error');
  assert.equal(downloads.length, n);
  assert.ok(logs.some((l) => !l.ok && l.text === '양식 병합 실패: 양식 파일을 읽지 못했습니다'));
  s.mergeErr = null;
});

console.log('모두 zip · 지우기');
await ta('본문·첨부 모두 zip — 요약 · 메일ID.json · 메일마다 폴더(보낸 메일 00, 회신은 받은 차례) · 본문은 글자(머리에 메일 ID·첨부 ID)', async () => {
  $('mtAllZip').click();
  await until(() => downloads.at(-1)?.name?.endsWith('.zip'));
  const d = downloads.at(-1);
  assert.equal(d.name, '견적 양식 회신 부탁_메일_20261015.zip');
  assert.equal(d.mime, 'application/zip');
  const entries = readZip(d.bytes);
  const names = entries.map((e) => e.name);
  const noDay = (x) => x.replace(/_2026101\d/, '_D');
  assert.deepEqual(names.map(noDay), [
    '요약.txt', '메일ID.json', '00_보낸 메일/본문.txt', '01_foo.com_D/본문.txt', '04_baz.com_D/본문.txt',
    '00_보낸 메일/견적양식.xlsx', '01_foo.com_D/견적_foo.xlsx', '04_baz.com_D/회신서_baz.docx',
  ]);
  const text = (i) => new TextDecoder().decode(entries[i].data);
  assert.match(text(0), /^제목: 견적 양식 회신 부탁\n메일 ID: A\n/, '요약 머리에 보낸 메일의 ID');
  assert.match(text(0), /상태: 3\/5 · 진행 중/);
  assert.match(text(0), /· a@foo\.com · reply · 수락 · 셈 · RE: 견적 양식 회신 부탁 · 메일 ID: r1$/m, '요약에 회신의 확인 상태와 메일 ID');
  assert.match(text(0), /· x@qux\.com · auto · 거부 · .* · 메일 ID: r5$/m);
  assert.match(text(0), /메일ID\.json 과 각 본문\.txt 머리에/);
  // 메일ID.json — 2026-10-15 사용자 지정 "내용이나 첨부 파일 다운받을 수 있는 id도 같이 다운받게": 메일 ID·첨부 ID 와 zip 안 경로, 다시 받을 도구.
  const ids = JSON.parse(text(1));
  assert.equal(ids.v, 1);
  assert.equal(ids.mcpUrl, 'http://localhost:5001/mcp');
  assert.match(ids.howTo.body, /^mail_query_if_emaidID /);
  assert.match(ids.howTo.attachment, /^mail_attachment_download /);
  assert.equal(ids.sent.messageId, 'A');
  assert.equal(ids.sent.conversationId, 'c-A');
  assert.equal(ids.sent.internetMessageId, '<A@krs>');
  assert.equal(ids.sent.webLink, 'https://outlook.office365.com/owa/?ItemID=A');
  assert.equal(ids.sent.folder, '00_보낸 메일');
  assert.equal(ids.sent.body, '00_보낸 메일/본문.txt');
  // 보낸 첨부 — 받아 둔 양식은 zip 안 경로, 금고에 없는 것·큰 것(missing)·파일 아닌 첨부는 null(ID 로 다시 받는다), 본문 속 그림(i1)은 없다.
  assert.deepEqual(ids.sent.attachments.map((a) => [a.attachmentId, a.name, a.file, a.missing === true]), [
    ['t1', '견적양식.xlsx', '00_보낸 메일/견적양식.xlsx', false], ['t2', '회신서.docx', null, false], ['s3', '안내.pdf', null, true], ['s4', '전달한 메일', null, false],
  ]);
  assert.deepEqual(ids.replies.map((r) => r.messageId), ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'], '회신은 받은 차례');
  const r4 = ids.replies.find((r) => r.messageId === 'r4');
  assert.equal(r4.from, 'b@baz.com');
  assert.equal(r4.key, 'baz.com');
  assert.equal(r4.review, 'pending');
  assert.equal(r4.counted, true);
  assert.equal(noDay(r4.folder), '04_baz.com_D');
  assert.equal(noDay(r4.body), '04_baz.com_D/본문.txt');
  assert.deepEqual(r4.attachments.map((a) => [a.attachmentId, a.name, a.file && noDay(a.file), a.missing === true]), [['a4', 'big.xlsx', null, true], ['a5', '회신서_baz.docx', '04_baz.com_D/회신서_baz.docx', false]]);
  const r3 = ids.replies.find((r) => r.messageId === 'r3');
  assert.equal(r3.body, null, '본문을 받지 않은 회신은 body 가 null');
  assert.deepEqual(r3.attachments, []);
  assert.doesNotMatch(text(1), /__pwned|<script|onerror/);
  // 본문.txt 머리 — 메일 ID 와 첨부 ID 줄.
  assert.match(text(2), /^메일 ID: A$/m);
  assert.match(text(2), /^첨부:\n- 견적양식\.xlsx · 첨부 ID: t1\n- 회신서\.docx · 첨부 ID: t2\n- 안내\.pdf · 첨부 ID: s3\n- 전달한 메일 · 첨부 ID: s4\n\n/m, '보낸 메일의 첨부 ID(본문 속 그림은 빼고)');
  assert.match(text(3), /^메일 ID: r1$/m);
  assert.match(text(3), /^- 견적_foo\.xlsx · 첨부 ID: a1$/m);
  assert.match(text(3), /회신입니다 <b>굵게<\/b>\n끝/);
  assert.doesNotMatch(text(3), /__pwned|<script|onerror/);
  assert.deepEqual([...entries[6].data], [5, 6, 7]);
});
await ta('등록 지우기는 두 번 — 한 번 누르고 기다리면 되돌아가고, 잇달아 두 번이면 sync.remove 하고 목록으로', async () => {
  $('mtRemove').click();
  assert.equal($('mtRemove').textContent, '한 번 더 누르면 지웁니다');
  assert.ok($('mtRemove').classList.contains('armed'));
  assert.equal(callsOf(s, 'remove').length, 0);
  await wait(150);
  assert.equal($('mtRemove').textContent, '등록 지우기');
  assert.ok(!$('mtRemove').classList.contains('armed'));
  $('mtRemove').click();
  $('mtRemove').click();
  await until(() => callsOf(s, 'remove').length === 1 && !hidden('mtListBox'));
  assert.deepEqual(callsOf(s, 'remove'), [['remove', 'A']]);
  assert.equal($('mtRemove').textContent, '등록 지우기');
  assert.ok(hidden('mtDetail'));
  assert.equal(card('A'), null);
  assert.equal($('mtMsg').textContent, '등록을 지웠습니다: 견적 양식 회신 부탁');
});
await ta('목록 줄의 지우기(상세에 들어가지 않고) — 같은 두 번 확인, 줄만 빠지고 목록에 머문다', async () => {
  const rm = $('mtList').querySelector('.mt-item-remove[data-id]');
  assert.ok(rm, '줄마다 지우기 단추');
  const id = rm.dataset.id;
  const subject = card(id).querySelector('.mt-subj').textContent;
  assert.equal(rm.textContent, '지우기');
  assert.equal(rm.closest('.mt-item'), null, '줄 단추 안에 단추를 두지 않는다');
  rm.click();
  assert.equal(rm.textContent, '한 번 더 누르면 지웁니다');
  assert.ok(rm.classList.contains('armed'));
  assert.ok(hidden('mtDetail'), '지우기를 눌러도 상세가 열리지 않는다');
  assert.equal(callsOf(s, 'remove').length, 1);
  await wait(150);
  assert.equal(rm.textContent, '지우기');
  rm.click();
  rm.click();
  await until(() => callsOf(s, 'remove').length === 2 && card(id) === null);
  assert.deepEqual(callsOf(s, 'remove').at(-1), ['remove', id]);
  assert.ok(!hidden('mtListBox') && hidden('mtDetail'));
  assert.equal($('mtMsg').textContent, `등록을 지웠습니다: ${subject}`);
});

console.log('메일 설정');
t('설정 칸은 장부의 설정으로 선다', () => {
  assert.equal($('mtUrl').value, 'http://localhost:5001/mcp');
  assert.equal($('mtUserEmail').value, '');
  assert.equal($('mtSentDays').value, '30');
  assert.equal($('mtWindowDays').value, '90');
  assert.equal($('mtAutoMin').value, '10');
  assert.ok($('mtOwnByAddress').checked);
  assert.ok(!$('mtUseHeaders').checked);
  assert.equal($('mtSetState').textContent, 'localhost:5001');
});
await ta('MCP 주소는 이 PC 만 — 다른 호스트·다른 꼴은 저장하지 않고, 바르면 저장하고 다시 확인한다', async () => {
  const n = callsOf(s, 'settings').length;
  setVal($('mtUrl'), 'http://evil.example.com:5001/mcp');
  assert.equal(callsOf(s, 'settings').length, n);
  assert.equal($('mtUrl').getAttribute('aria-invalid'), 'true');
  assert.equal($('mtSetMsg').textContent, 'MCP 주소는 이 PC(localhost · 127.0.0.1)만 됩니다: evil.example.com');
  setVal($('mtUrl'), 'file:///C:/x');
  assert.match($('mtSetMsg').textContent, /올바르지 않습니다/);
  assert.equal(callsOf(s, 'settings').length, n);
  const probes = callsOf(s, 'probe').length;
  setVal($('mtUrl'), 'http://127.0.0.1:5001/mcp');
  await until(() => callsOf(s, 'settings').length === n + 1 && callsOf(s, 'probe').length === probes + 1);
  assert.deepEqual(callsOf(s, 'settings').at(-1), ['settings', { mcpUrl: 'http://127.0.0.1:5001/mcp' }]);
  assert.equal($('mtUrl').getAttribute('aria-invalid'), null);
  assert.equal($('mtSetState').textContent, '127.0.0.1:5001');
});
await ta('체크·숫자·메일 주소 — 바뀐 칸만 sync.settings(patch), 메일 주소는 꼴을 보고 기록에 남기지 않는다', async () => {
  const n = callsOf(s, 'settings').length;
  check($('mtOwnByAddress'), false);
  check($('mtUseHeaders'), true);
  check($('mtRequireAccept'), true);
  setVal($('mtWindowDays'), '5000');   // model.js 와 같은 범위(1~3650일)로 자른다
  setVal($('mtSentDays'), '14');
  setVal($('mtUserEmail'), 'not-an-email');
  assert.equal($('mtUserEmail').getAttribute('aria-invalid'), 'true');
  setVal($('mtUserEmail'), 'Me@krs.co.kr');
  await until(() => callsOf(s, 'settings').length === n + 6);
  assert.deepEqual(callsOf(s, 'settings').slice(n).map((c) => c[1]), [
    { ownByAddress: false }, { useHeaders: true }, { requireAccept: true }, { windowDays: 3650 }, { sentDays: 14 }, { userEmail: 'Me@krs.co.kr' },
  ]);
  assert.ok($('mtRequireAccept').checked, '장부대로 다시 그려도 켜진 채');
  assert.equal($('mtWindowDays').value, '3650');
  assert.ok(!JSON.stringify(logs).includes('Me@krs.co.kr'));
  assert.equal(book.settings.sentDays, 14);
});

console.log('다시 읽기 · 오류');
await ta('reload() → sync.refresh({force:true}) — 겹쳐 불러도 한 번, 도는 동안 단추 잠김·aria-busy', async () => {
  const n = callsOf(s, 'refresh').length;
  clock += 60_000;
  const g = gate();
  s.refreshGate = g.p;
  const p1 = panel.reload();
  const p2 = panel.reload();
  assert.ok($('mtRefresh').disabled);
  assert.equal($('mail').getAttribute('aria-busy'), 'true');
  s.refreshGate = null;
  g.open();
  await Promise.all([p1, p2]);
  assert.equal(callsOf(s, 'refresh').length, n + 1);
  assert.deepEqual(callsOf(s, 'refresh').at(-1), ['refresh', { force: true }]);
  assert.ok(!$('mtRefresh').disabled);
  assert.equal($('mail').getAttribute('aria-busy'), null);
  assert.equal($('mtStamp').textContent, '마지막 갱신 방금');
});
await ta('새로고침 단추 → sync.refresh({force:false})', async () => {
  $('mtRefresh').click();
  await until(() => !$('mtRefresh').disabled);
  assert.deepEqual(callsOf(s, 'refresh').at(-1), ['refresh', { force: false }]);
});
await ta('새로고침이 로그인 오류로 실패하면(sync.refresh 는 던지지 않고 ok:false · error 를 돌려준다) 칩이 "로그인 필요" 와 열기', async () => {
  const url = 'https://login.microsoftonline.com/x?state=refresh';
  s.refreshOut = { ok: false, fetched: 0, linked: 0, at: clock, error: { kind: 'auth', message: 'auth_required', authUrl: url }, kind: 'auth', authUrl: url };
  $('mtRefresh').click();
  await until(() => $('mtState').dataset.state === 'auth' && !$('mtRefresh').disabled);
  assert.ok(!hidden('mtAuth'));
  assert.equal($('mtMsg').className, 'status mt-msg error');
  assert.match($('mtMsg').textContent, /^새로고침 실패: Microsoft 로그인이 풀렸습니다/);
  assert.deepEqual(logs.at(-1), { kind: 'mail', ok: false, text: $('mtMsg').textContent, data: { kind: 'auth' } });
  $('mtAuth').click();
  assert.equal(opened.at(-1), url);
  s.refreshOut = null;
});
await ta('던진 오류도 같이 다룬다 — rerp/mcp.js 의 tool 오류에 실린 payload.auth_url 도 로그인으로 알아본다', async () => {
  $('mtProbe').click();
  await until(() => $('mtState').dataset.state === 'ok' && !$('mtProbe').disabled);
  s.refreshErr = Object.assign(new Error('auth_required'), { kind: 'tool', payload: { status: 'auth_required', auth_url: 'https://login.microsoftonline.com/y' } });
  $('mtRefresh').click();
  await until(() => $('mtState').dataset.state === 'auth' && !$('mtRefresh').disabled);
  assert.ok(!hidden('mtAuth'));
  s.refreshErr = null;
});
await ta('갱신의 주의(warnings)는 알림 줄 끝에, 기다리는 메일이 없으면(idle) 찾지 않았다고', async () => {
  s.refreshOut = { ok: true, fetched: 2, linked: 0, unmatched: 2, at: clock, warnings: ['큰 첨부 1개는 서버가 바이트를 주지 않았습니다'] };
  $('mtRefresh').click();
  await until(() => !$('mtRefresh').disabled && /주의/.test($('mtMsg').textContent));
  assert.equal($('mtMsg').textContent, '받은 메일 2건 · 새로 이어진 회신 0건 — 주의: 큰 첨부 1개는 서버가 바이트를 주지 않았습니다');
  s.refreshOut = { ok: true, fetched: 0, linked: 0, at: clock, idle: true };
  $('mtRefresh').click();
  await until(() => !$('mtRefresh').disabled && $('mtMsg').textContent === '기다리는 메일이 없어 찾지 않았습니다.');
  s.refreshOut = null;
});
await ta('기다리는 메일이 없어도 칩이 꺼짐으로 남아 있으면 새로고침이 서버를 다시 확인한다(연결 확인 단추가 설정 화면으로 간 뒤 — 2026-10-16)', async () => {
  s.probeOut = probeFail('offline', 'fetch failed');
  $('mtProbe').click();
  await until(() => $('mtState').dataset.state === 'offline' && !$('mtProbe').disabled);
  s.probeOut = OK_PROBE;
  s.refreshOut = { ok: true, fetched: 0, linked: 0, at: clock, idle: true };
  const probes = callsOf(s, 'probe').length;
  $('mtRefresh').click();
  await until(() => $('mtState').dataset.state === 'ok' && !$('mtRefresh').disabled, '다시 확인');
  assert.equal(callsOf(s, 'probe').length, probes + 1);
  assert.equal($('mtMsg').textContent, '기다리는 메일이 없어 찾지 않았습니다.');
  s.refreshOut = null;
});
await ta('sync.refresh 가 ok:false 를 돌려줘도(서버 꺼짐 — sync.js 의 꼴 그대로) 칩과 알림 줄에', async () => {
  const error = { kind: 'offline', message: 'connect ECONNREFUSED 127.0.0.1:5001' };
  s.refreshOut = { ok: false, fetched: 0, linked: 0, at: clock, error, kind: 'offline' };
  $('mtRefresh').click();
  await until(() => $('mtState').dataset.state === 'offline' && !$('mtRefresh').disabled);
  assert.match($('mtMsg').textContent, /^새로고침 실패: Outlook MCP 서버가 꺼져 있습니다/);
  s.refreshOut = null;
  $('mtRefresh').click();
  await until(() => $('mtState').dataset.state === 'ok' && !$('mtRefresh').disabled, '갱신이 되면 칩이 돌아온다');
});
t('hide() — 숨기고 타이머를 치운다', () => {
  panel.hide();
  assert.ok(hidden('mail'));
  assert.equal(panel.state().tick, null);
});

console.log('connRoot — 패널 설정의 연결 갈래(2026-10-16)에 MCP 주소·내 메일 주소·연결 확인을 그린다');
await ta('connRoot 가 있으면 그 칸에(상태 칩·열기·알림 줄 따로), 메일 설정 칸에는 안내 한 줄 — 메일 탭을 열지 않아도 loadSettings 로 저장된 주소가 선다', async () => {
  const { window } = new JSDOM('<!doctype html><body><section id="mail" class="mail hidden"></section><div id="conn"></div></body>', { url: 'https://example.org/' });
  const { createMailPanel } = await import('../panel.js');
  const book = makeBook();
  book.settings = { ...book.settings, mcpUrl: 'http://127.0.0.1:5001/mcp', userEmail: 'me@krs.co.kr' };
  const s = fakeSync(book);
  const d = window.document;
  const conn = d.getElementById('conn');
  const g = (id) => d.getElementById(id);
  const p = createMailPanel({ root: g('mail'), $: g, escapeHtml, logEvent: () => {}, sync: s, connRoot: conn });
  p.wire();
  for (const id of ['mtConn', 'mtUrl', 'mtUserEmail', 'mtProbe', 'mtConnState', 'mtConnAuth', 'mtConnMsg']) assert.ok(conn.querySelector(`#${id}`), id);
  assert.equal(d.querySelector('#mail #mtUrl'), null, '메일 설정 칸에 MCP 주소가 남아 있다');
  assert.ok(d.querySelector('#mail #mtSettings #mtSentDays') && d.querySelector('#mail #mtSettings #mtSetMsg'), '다른 메일 설정은 메일 탭에');
  assert.match(d.querySelector('#mail #mtSettings .mt-conn-note').textContent, /설정.*연결/);
  assert.equal(g('mtConnState').textContent, '확인 전');
  assert.ok(g('mtConnAuth').classList.contains('hidden'));
  assert.equal(g('mtUrl').value, 'http://localhost:5001/mcp', '장부를 읽기 전에는 기본값');
  assert.deepEqual(s.calls, []);
  await p.loadSettings();
  assert.deepEqual(s.calls.map((c) => c[0]), ['load']);
  assert.equal(g('mtUrl').value, 'http://127.0.0.1:5001/mcp');
  assert.equal(g('mtUserEmail').value, 'me@krs.co.kr');
  await p.loadSettings();
  assert.deepEqual(s.calls.map((c) => c[0]), ['load'], '한 번 읽었으면 다시 읽지 않는다');
  // 주소 검사 오류·저장 알림은 연결 갈래의 알림 줄로, 메일 설정의 줄은 비어 있다.
  g('mtUrl').value = 'http://evil.example.com/mcp';
  g('mtUrl').dispatchEvent(new window.Event('change'));
  assert.equal(g('mtConnMsg').textContent, 'MCP 주소는 이 PC(localhost · 127.0.0.1)만 됩니다: evil.example.com');
  assert.equal(g('mtSetMsg').textContent, '');
  g('mtUrl').value = 'http://localhost:5002/mcp';
  g('mtUrl').dispatchEvent(new window.Event('change'));
  await until(() => g('mtConnMsg').textContent === '저장했습니다.', '저장');
  assert.deepEqual(s.calls.filter((c) => c[0] === 'settings').at(-1), ['settings', { mcpUrl: 'http://localhost:5002/mcp' }]);
  assert.equal(g('mtSetMsg').textContent, '');
  // 탭이 보이지 않아도 주소를 바꾸면 다시 확인해 칩을 맞춘다(연결 갈래에 칩이 있으니) — 머리 칩도 같이.
  await until(() => g('mtConnState').dataset.state === 'ok', '다시 확인');
  assert.equal(g('mtConnState').textContent, 'Outlook 연결됨');
  assert.equal(g('mtState').textContent, 'Outlook 연결됨');
  // 연결 확인 단추 → 알림도 연결 갈래의 줄로.
  g('mtProbe').click();
  await until(() => !g('mtProbe').disabled && /^연결됨 — /.test(g('mtConnMsg').textContent), '연결 확인');
  assert.equal(g('mtSetMsg').textContent, '');
  // 로그인이 풀렸으면 연결 갈래의 열기가 보인다.
  s.probeOut = probeFail('auth', 'auth_required', 'https://login.microsoftonline.com/z');
  g('mtProbe').click();
  await until(() => g('mtConnState').dataset.state === 'auth' && !g('mtProbe').disabled, '로그인 필요');
  assert.ok(!g('mtConnAuth').classList.contains('hidden'));
  assert.equal(g('mtConnState').textContent, 'Microsoft 로그인 필요');
  // 갈래로 되돌아오면(loadSettings) 지난 알림은 지운다 — 칸은 저장된 값으로 다시 서니.
  await p.loadSettings();
  assert.equal(g('mtConnMsg').textContent, '');
});
await ta('장부를 읽지 못하면 연결 갈래의 줄에도 적는다 — 메일 탭의 알림 줄은 설정 화면 뒤에 숨어 있으니', async () => {
  const { window } = new JSDOM('<!doctype html><body><section id="mail" class="mail hidden"></section><div id="conn"></div></body>', { url: 'https://example.org/' });
  const { createMailPanel } = await import('../panel.js');
  const s = fakeSync(makeBook());
  s.load = async () => { s.calls.push(['load']); throw new Error('storage broken'); };
  const d = window.document;
  const g = (id) => d.getElementById(id);
  const p = createMailPanel({ root: g('mail'), $: g, escapeHtml, logEvent: () => {}, sync: s, connRoot: g('conn') });
  p.wire();
  await p.loadSettings();
  assert.match(g('mtConnMsg').textContent, /^저장된 설정을 읽지 못했습니다: storage broken/);
  assert.equal(g('mtConnMsg').className, 'status mt-set-msg error');
  assert.equal(g('mtUrl').value, 'http://localhost:5001/mcp', '기본값 그대로');
});

console.log(`\n${pass} passed`);
