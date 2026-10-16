// 메일 탭 조립(mailtrack/index.js) — ① import·만들기·wire() 만으로는 chrome·indexedDB·fetch 를 건드리지 않고 기록도 남기지 않는다
// (test/wiring.test.mjs 가 jsdom 에서 sidepanel.js 를 통째로 import 하는 것과 같은 조건), ② 진짜 sync·장부·금고·어댑터·병합을 조립해
// 가짜 MCP 서버(fixtures/mcpfake.mjs)와 끝에서 끝까지 — 등록(큰 첨부는 주의로) → 갱신 → 상세 → 양식 병합 → 서버에 저장, 한 일마다 기록 한 줄.
// 저장소는 메모리, 금고는 memoryBackend, 시각은 2026-10-12 로 못 박는다. 네트워크 없음.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import * as G from './fixtures/graph.mjs';
import { createMcpFake } from './fixtures/mcpfake.mjs';
import { xlsxOf } from './fixtures/office.mjs';
import { memoryBackend } from '../store/vault.js';
import { readXlsx } from '../ooxml/xlsx.js';

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, what = '') => {
  for (let i = 0; i < 300 && !ok(); i++) await wait(10);
  assert.ok(ok(), `기다렸지만 되지 않았습니다${what ? `: ${what}` : ''}`);
};
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = () => {
  const { window } = new JSDOM('<!doctype html><body><section id="mail" class="mail hidden"></section></body>', { url: 'https://example.org/' });
  return { window, $: (id) => window.document.getElementById(id) };
};

console.log('불러오기 — chrome·indexedDB·네트워크 없이');
await ta('import·만들기·wire() 는 아무것도 부르지 않는다 — 저장소·금고·MCP 는 처음 쓸 때 본다', async () => {
  assert.equal(typeof globalThis.chrome, 'undefined');
  assert.equal(typeof globalThis.indexedDB, 'undefined');
  const realFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (...a) => { fetched.push(a); throw new TypeError('막힌 네트워크'); };
  try {
    const { $ } = page();
    const { createMailPanel } = await import('../index.js');
    const logs = [];
    const mail = createMailPanel({ root: $('mail'), $, escapeHtml, logEvent: (...a) => logs.push(a) });
    for (const k of ['wire', 'show', 'hide', 'reload']) assert.equal(typeof mail[k], 'function', `${k} 가 없습니다`);
    mail.wire();
    mail.wire();
    await wait(30);
    assert.deepEqual(fetched, [], 'MCP 를 부르지 않았다');
    assert.deepEqual(logs, [], '기록도 남기지 않았다');
    assert.ok($('mail').classList.contains('hidden'), '보이기 전에는 숨은 채');
    assert.ok($('mtList') && $('mtSettings') && $('mtMerge'));
    assert.equal($('mtState').textContent, '확인 전');
    assert.equal($('mtUrl').value, 'http://localhost:5001/mcp');
  } finally {
    globalThis.fetch = realFetch;
  }
});

console.log('끝에서 끝까지 — 진짜 sync·장부·금고·어댑터·병합 + 가짜 MCP 서버');
const NOW = Date.parse('2026-10-12T00:00:00Z');
// 가짜 서버의 조사표 바이트는 ZIP 머리만 흉내 낸 것이라 진짜 xlsx 로 바꿔 끼운다 — 양식(보낸 메일)과 foo.com 의 회신.
const REAL = {
  'ATT-s1-xlsx': xlsxOf({ sheets: [{ name: '조사', rows: [['설비', '수량']] }] }),
  'ATT-x-xlsx': xlsxOf({ sheets: [{ name: '조사', rows: [['설비', '수량'], ['차단기', 3], ['변압기', 2]] }] }),
};
const nameToId = (messageId, name) => (G.ATTACHMENTS[messageId] || []).find((a) => a.name === name)?.id;
const fake = createMcpFake({
  responses: {
    mail_attachment_download: (a) => {
      const list = a.message_attachment_ids || [];
      if (!list.every((x) => typeof x === 'string')) return G.saveResponse(list, a.save_directory || 'downloads');
      const r = G.downloadResponse(list);
      r.attachment_contents = r.attachment_contents.map((c) => {
        const real = REAL[nameToId(c.message_id, c.original_name)];
        return real ? { ...c, content_bytes: G.b64(real), size: real.length } : c;
      });
      return r;
    },
  },
});
const mem = {};
const storage = { get: async (k) => ({ [k]: mem[k] }), set: async (o) => { Object.assign(mem, JSON.parse(JSON.stringify(o))); } };
const { window, $ } = page();
const fire = (n, type) => n.dispatchEvent(new window.Event(type, { bubbles: true }));
const logs = [];
const downloads = [];
const { createMailPanel } = await import('../index.js');
const mail = createMailPanel({
  root: $('mail'), $, escapeHtml, logEvent: (kind, ok, text, data) => logs.push({ kind, ok, text, data }),
  storage, vaultBackend: memoryBackend(), fetch: fake.fetch, now: () => NOW,
  download: async (f) => { downloads.push(f); }, openTab: () => {}, copyText: async () => true,
});
mail.wire();
const logsOf = (re) => logs.filter((l) => re.test(l.text));

await ta('show() — 장부가 비어 있어도 서버를 확인하고(연결됨), 기다리는 메일이 없으니 찾지 않는다', async () => {
  await mail.show();
  await mail.state().bg;
  assert.equal($('mtState').dataset.state, 'ok');
  assert.equal($('mtState').textContent, 'Outlook 연결됨');
  assert.ok(!$('mtEmpty').classList.contains('hidden'));
  assert.deepEqual(fake.names(), [], 'tools/list 만 — 도구는 부르지 않았다');
  assert.deepEqual(logs, []);
});

await ta('등록 — 보낸 메일을 골라 등록하면 장부·금고에 들고, 큰 첨부는 오류가 아니라 주의 한 줄, 기록은 등록 한 줄 · 갱신 한 줄', async () => {
  $('mtRegister').click();
  await until(() => $('mtReg').getAttribute('aria-busy') === 'false' && $('mtRegList').querySelector('.mt-reg-row'), '보낸 메일 목록');
  const row = [...$('mtRegList').querySelectorAll('.mt-reg-row')].find((li) => li.textContent.includes(G.SUBJECT));
  assert.ok(row, '제목은 상세 조회로 채운다(mail_query_url 에는 subject 가 없다)');
  const box = row.querySelector('input');
  box.checked = true;
  fire(box, 'change');
  $('mtRegGo').click();
  await until(() => $('mtRegMsg').querySelector('.mt-note') && !$('mtRefresh').disabled && !mail.state().refreshRun, '등록과 등록 뒤 갱신');
  assert.equal($('mtRegMsg').firstChild.textContent, '등록 1 · 건너뜀 0');
  assert.doesNotMatch($('mtRegMsg').className, /error/);
  assert.match($('mtRegMsg').querySelector('.mt-note').textContent, /^주의: 큰 첨부 1개는 .*서버에 저장.*안내문\.docx$/);

  const book = mem.mailtrackBook;
  assert.equal(book.me, G.ME, '보낸 메일의 보낸 주소가 곧 나(소문자)');
  assert.equal(book.items.length, 1);
  const it = book.items[0];
  assert.deepEqual(it.expect.map((e) => [e.key, e.addresses]), [['foo.com', ['a@foo.com']], ['bar.co.kr', ['b@bar.co.kr']], ['addr:d@krs.co.kr', ['d@krs.co.kr']]],
    '받는 사람(To)만 — 외부는 도메인 하나로, 내 도메인은 주소마다, 참조(c@foo.com)는 foo.com 의 주소에도 들지 않는다');
  assert.deepEqual(it.cc.map((a) => a.address), ['c@foo.com'], '참조는 항목에 남아 보이기만');
  assert.deepEqual(it.templates.map((t) => [t.name, t.kind, t.stored]), [['조사표.xlsx', 'xlsx', true], ['안내문.docx', 'docx', false]]);

  const reg = logsOf(/^메일 등록/);
  assert.equal(reg.length, 1, '등록 한 번에 한 줄(sync 가 따로 남기지 않는다)');
  assert.equal(reg[0].ok, true, '큰 첨부 주의는 실패가 아니다');
  assert.equal(logsOf(/갱신/).length, 1, '등록 뒤 갱신도 한 줄');
  assert.ok(logs.every((l) => l.kind === 'mail'));
  assert.match($('mtMsg').textContent, /^받은 메일 \d+건 · 새로 이어진 회신 3건\(등록 뒤\)/);
  // 한 세션 안에서 상세 → 첨부 목록 → 바이트, 갱신은 받은 메일 → 이어진 것만 첨부 목록·바이트.
  assert.deepEqual(fake.names(), [
    'mail_query_url', 'mail_query_if_emaidID', 'mail_query_if_emaidID', 'mail_attachment_meta', 'mail_attachment_download',
    'test_handler', 'mail_attachment_meta', 'mail_attachment_download',
  ]);
  assert.equal(fake.open, 0, '연 세션은 모두 닫았다');
});

await ta('상세 — 받을 곳 2/3, 회신 셋(자동 회신 포함), 양식 병합은 진짜 xlsx 로 합쳐 내려받고 출처 열이 붙는다', async () => {
  const card = $('mtList').querySelector('.mt-item');
  assert.equal(card.querySelector('.mt-badge').textContent, '2/3');
  card.click();
  assert.equal($('mtStatus').textContent, '2/3 · 진행 중');
  assert.equal($('mtReplies').querySelectorAll('.mt-reply').length, 3);
  assert.ok(!$('mtMerge').classList.contains('hidden'));
  assert.equal($('mtMergeTpl').value, 'ATT-s1-xlsx');
  assert.ok(!$('mtMergeGo').disabled);
  $('mtMergeGo').click();
  await until(() => downloads.length === 1 && !$('mtMerge').hasAttribute('aria-busy'), '병합');
  const d = downloads[0];
  assert.match(d.name, /^\[조사\] 2026 하반기 설비 현황 조사 요청_병합_2026101\d\.xlsx$/);
  assert.equal(d.mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const sheet = (await readXlsx(d.bytes)).sheets[0];
  const rows = sheet.rows.map((r) => r.cells.map((c) => c.text));
  assert.deepEqual(rows.slice(0, 1), [['설비', '수량', '출처']]);
  assert.deepEqual(rows.slice(1).map((r) => r.slice(0, 2)), [['차단기', '3'], ['변압기', '2']]);
  assert.match(rows[1][2], /^foo\.com · 엑스 <x@foo\.com> · 2026-10-0\d$/);
  assert.match($('mtMergeReport').textContent, /회신 1건을 합쳤습니다 · 2행/);
  assert.equal(logsOf(/병합/).length, 1, '병합 한 번에 한 줄');
});

await ta('서버에 저장 — 큰 첨부(안내문.docx)는 첨부 id 쌍으로 서버 PC 에 저장하고 경로를 보인다, 기록 한 줄', async () => {
  const btn = $('mtSentAtts').querySelector('.mt-att[data-att="ATT-s1-docx"] [data-act="server"]');
  assert.ok(btn, '서버가 바이트를 주지 않은 첨부에는 "서버에 저장"');
  btn.click();
  await until(() => $('mtSentAtts').querySelector('.mt-att[data-att="ATT-s1-docx"] .mt-path'), '서버 경로');
  assert.match($('mtSentAtts').querySelector('.mt-att[data-att="ATT-s1-docx"] .mt-path').textContent, /downloads\\mailtrack\\.*안내문\.docx$/);
  assert.deepEqual(fake.calls.at(-1).arguments.message_attachment_ids, [{ message_id: G.IDS.sent1, attachment_id: 'ATT-s1-docx' }]);
  assert.equal(logsOf(/서버 저장/).length, 1);
  assert.equal(mem.mailtrackBook.items[0].attachments.find((a) => a.id === 'ATT-s1-docx').serverPath.endsWith('안내문.docx'), true, '장부에도 적는다');
});

await ta('로그인이 풀리면 새로고침 실패는 한 줄 · 칩은 "Microsoft 로그인 필요" 와 열기', async () => {
  fake.state.authRequired = true;
  const before = logs.length;
  await mail.reload();
  assert.equal($('mtState').dataset.state, 'auth');
  assert.ok(!$('mtAuth').classList.contains('hidden'));
  assert.equal(logs.length, before + 1, '실패도 한 줄');
  assert.equal(logs.at(-1).ok, false);
  assert.ok(!JSON.stringify(logs).includes('login.microsoftonline'), '로그인 주소는 기록에 남기지 않는다');
  fake.state.authRequired = false;
  mail.hide();
});

console.log(`\n${pass} passed`);
