// 메일 수신의 Outlook MCP 어댑터(mailtrack/mcp/outlook.js) — 가짜 Streamable HTTP 서버(fixtures/mcpfake.mjs)와 Graph 원본(fixtures/graph.mjs)으로 돈다.
// 진짜 서버(KR_MS365_mcp :5001)에는 닿지 않는다. 도구 이름·인자는 서버 소스(spec/param_spec/outlook.yaml)에서 확인한 그대로를 deepEqual 로 못 박는다.
// 2026-10-15 사용자 지정: "mcp 를 이용해야하고.. 내가 보낸 메일에서 받는사람 참조자 또는 메일주소가 도메인이 같은 경우 이를 식별해서 등록 해줍니다"
import assert from 'node:assert/strict';

import {
  createOutlook, describe as explain, isoOf, addrOf, mailOf, metaOf, attOf, isFileAttachment, bytesOf,
  TOOLS, SENT_URL, MCP_URL_DEFAULT, INBOX_SELECT, CHUNK, FILE_ATTACHMENT,
} from '../mcp/outlook.js';
import * as G from './fixtures/graph.mjs';
import { createMcpFake } from './fixtures/mcpfake.mjs';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const URL = 'http://localhost:5001/mcp';
const make = (fake, o = {}) => createOutlook({ url: URL, fetch: fake.fetch, ...o });
const args = (fake, name) => fake.calls.filter((c) => c.name === name).map((c) => c.arguments);

console.log('상수·정규화');
t('도구 이름·주소는 서버 spec 그대로', () => {
  assert.deepEqual({ ...TOOLS }, { sent: 'mail_query_url', details: 'mail_query_if_emaidID', meta: 'mail_attachment_meta', download: 'mail_attachment_download', inbox: 'test_handler', inboxFallback: 'mail_fetch_filter' });
  for (const n of Object.values(TOOLS)) assert.ok(G.TOOL_NAMES.includes(n), n + ' 는 서버가 노출하는 도구');
  assert.equal(SENT_URL, 'https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?');
  assert.equal(MCP_URL_DEFAULT, 'http://localhost:5001/mcp');
  assert.equal(CHUNK, 50);
});
t('isoOf: 밀리초·Graph 소수점 7자리를 떼고, 시간대 없는 시각은 UTC, 못 읽으면 빈 글', () => {
  assert.equal(isoOf(new Date('2026-10-15T01:02:03.456Z')), '2026-10-15T01:02:03Z');
  assert.equal(isoOf(Date.UTC(2026, 9, 15, 1, 2, 3, 999)), '2026-10-15T01:02:03Z');
  assert.equal(isoOf('2026-10-04T01:00:00.1234567Z'), '2026-10-04T01:00:00Z');
  assert.equal(isoOf('2026-10-04T01:00:00'), '2026-10-04T01:00:00Z');
  assert.equal(isoOf('2026-10-04T10:00:00+09:00'), '2026-10-04T01:00:00Z');
  assert.equal(isoOf('2026-10-04'), '2026-10-04T00:00:00Z');
  for (const bad of ['', null, undefined, '어제', NaN]) assert.equal(isoOf(bad), '');
});
t('addrOf: {emailAddress:{}} 와 평평한 {name,address} 둘 다 · 주소는 소문자 · 글 · 없음', () => {
  assert.deepEqual(addrOf({ emailAddress: { name: ' 엑스 ', address: ' X@Foo.COM ' } }), { name: '엑스', address: 'x@foo.com' });
  assert.deepEqual(addrOf({ name: '나담당', address: 'Me@KRS.co.kr' }), { name: '나담당', address: 'me@krs.co.kr' });
  assert.deepEqual(addrOf('"홍 길동" <Hong@Bar.co.kr>'), { name: '홍 길동', address: 'hong@bar.co.kr' });
  assert.deepEqual(addrOf('A@Foo.com'), { name: '', address: 'a@foo.com' });
  assert.deepEqual(addrOf(null), { name: '', address: '' });
  assert.deepEqual(addrOf({ emailAddress: {} }), { name: '', address: '' });
});
t('mailOf: Graph 전체 메시지 → MailFull (받는 사람·참조 소문자, ISO, 본문 형식)', () => {
  const m = mailOf(G.MESSAGES[G.IDS.sent1]);
  assert.deepEqual(m, {
    id: G.IDS.sent1, subject: G.SUBJECT, from: { name: G.ME_NAME, address: G.ME }, sender: { name: G.ME_NAME, address: G.ME },
    to: [{ name: '에이', address: 'a@foo.com' }, { name: '비', address: 'b@bar.co.kr' }, { name: '디', address: 'd@krs.co.kr' }],
    cc: [{ name: '씨', address: 'c@foo.com' }],
    sentAt: '2026-10-01T00:30:10Z', receivedAt: '2026-10-01T00:30:12Z', conversationId: 'CONV-SENT1', internetMessageId: '<SENT1@krs.co.kr>',
    hasAttachments: true, isDraft: false, preview: G.MESSAGES[G.IDS.sent1].bodyPreview, webLink: G.MESSAGES[G.IDS.sent1].webLink,
    body: { contentType: 'html', content: G.MESSAGES[G.IDS.sent1].body.content },
  });
  assert.equal('headers' in m, false, '머리글은 왔을 때만');
  assert.deepEqual(mailOf({ ...G.MESSAGES[G.IDS.sent2], body: { contentType: 'Text', content: 'x' } }).body, { contentType: 'text', content: 'x' });
  const auto = mailOf({ ...G.MESSAGES[G.IDS.auto], internetMessageHeaders: G.HEADERS[G.IDS.auto] });
  assert.deepEqual(auto.headers, { inReplyTo: '<SENT1@krs.co.kr>', references: '<SENT1@krs.co.kr>', autoSubmitted: 'auto-replied' });
  assert.deepEqual(mailOf({ ...G.MESSAGES[G.IDS.auto], internetMessageHeaders: [{ name: 'AUTO-SUBMITTED', value: 'auto-generated' }] }).headers, { inReplyTo: '', references: '', autoSubmitted: 'auto-generated' }, '머리글 이름은 대소문자 무시');
  const noBody = { ...G.MESSAGES[G.IDS.x] }; delete noBody.body;
  assert.equal('body' in mailOf(noBody), false, '본문을 안 고른 조회는 MailHead');
});
t('metaOf / attOf: 평평한 from · @odata.type → odataType · 받을 첨부 판정', () => {
  const v = metaOf(G.metaView(G.MESSAGES[G.IDS.x]));
  assert.deepEqual(v.from, { name: '엑스', address: 'x@foo.com' });
  assert.equal(v.receivedAt, '2026-10-03T05:06:07Z');
  assert.deepEqual(v.attachments.map((a) => [a.name, a.odataType, a.isInline, isFileAttachment(a)]), [
    ['조사표.xlsx', FILE_ATTACHMENT, false, true], ['logo.png', FILE_ATTACHMENT, true, false], ['원본 메일', '#microsoft.graph.itemAttachment', false, false],
  ]);
  assert.deepEqual(attOf(v.attachments[0]), v.attachments[0], '정규화한 것을 다시 넣어도 같다');
  assert.equal(isFileAttachment(attOf({ id: 'a', name: 'x.bin', size: 3 })), true, '형식을 모르면 받아 본다');
});
t('bytesOf: base64 → Uint8Array (길이·내용, 줄바꿈 섞여도)', () => {
  const src = G.BYTES['ATT-x-xlsx'];
  const b = G.b64(src);
  const got = bytesOf(b.slice(0, 8) + '\r\n' + b.slice(8));
  assert.ok(got instanceof Uint8Array);
  assert.equal(got.length, src.length);
  assert.deepEqual([...got], [...src]);
});
await ta('import·생성만으로는 아무것도 부르지 않는다 (fetch·chrome 없음)', async () => {
  const saved = globalThis.fetch;
  let touched = 0;
  globalThis.fetch = async () => { touched++; throw new Error('부르면 안 됨'); };
  try {
    const mod = await import('../mcp/outlook.js?fresh=' + Date.now());
    mod.createOutlook();
    mod.createOutlook({ url: () => { touched++; return URL; }, userEmail: () => { touched++; return ''; } });
    assert.equal(touched, 0);
    assert.equal(typeof globalThis.chrome, 'undefined');
  } finally { globalThis.fetch = saved; }
});

console.log('보낸 메일 · 상세');
await ta('listSent: mail_query_url 인자 그대로 · 서버가 안 주는 제목은 같은 세션의 상세로 채움 · 최근 것부터', async () => {
  const fake = createMcpFake();
  const o = make(fake);
  const heads = await o.listSent({ from: new Date('2026-09-15T00:00:00.500Z'), to: '2026-10-15T09:10:11.250Z', top: 100 });
  assert.deepEqual(args(fake, 'mail_query_url'), [{ url: SENT_URL, filter_params: { received_date_from: '2026-09-15T00:00:00Z', received_date_to: '2026-10-15T09:10:11Z' }, top: 100 }]);
  assert.deepEqual(args(fake, 'mail_query_if_emaidID'), [{ message_ids: [G.IDS.sent1, G.IDS.sent2] }]);
  assert.deepEqual(heads.map((h) => [h.id, h.subject]), [[G.IDS.sent2, G.SUBJECT2], [G.IDS.sent1, G.SUBJECT]]);
  const h1 = heads[1];
  assert.deepEqual({ id: h1.id, subject: h1.subject, from: h1.from, receivedAt: h1.receivedAt, preview: h1.preview },
    { id: G.IDS.sent1, subject: G.SUBJECT, from: { name: G.ME_NAME, address: G.ME }, receivedAt: '2026-10-01T00:30:12Z', preview: G.MESSAGES[G.IDS.sent1].bodyPreview });
  assert.deepEqual(h1.to.map((a) => a.address), ['a@foo.com', 'b@bar.co.kr', 'd@krs.co.kr']);
  assert.deepEqual(h1.cc.map((a) => a.address), ['c@foo.com']);
  assert.equal(fake.sessions, 1, '목록과 상세를 세션 하나로');
  assert.equal(fake.requests.at(-1).method, 'DELETE');
});
await ta('listSent: 서버가 제목을 주면 상세를 부르지 않는다 · details:false 면 제목 없이', async () => {
  const withSubject = () => G.listShape(G.SENT.map((m) => ({ id: m.id, subject: m.subject, receivedDateTime: m.receivedDateTime, bodyPreview: m.bodyPreview, from: m.from })));
  const fake = createMcpFake({ responses: { mail_query_url: withSubject } });
  const heads = await make(fake).listSent({ from: '2026-09-15' });
  assert.deepEqual(fake.names(), ['mail_query_url']);
  assert.deepEqual(args(fake, 'mail_query_url')[0].filter_params, { received_date_from: '2026-09-15T00:00:00Z' });
  assert.deepEqual(heads.map((h) => h.subject), [G.SUBJECT2, G.SUBJECT]);
  const fake2 = createMcpFake();
  const bare = await make(fake2).listSent({ from: '2026-09-15', details: false });
  assert.deepEqual(fake2.names(), ['mail_query_url']);
  assert.deepEqual(bare.map((h) => h.subject), ['', '']);
});
await ta('fetchDetails: 50개씩 끊어 묻고 물은 차례로 · 못 찾은 ID 는 빠짐 · 중복 ID 는 한 번', async () => {
  const ids = Array.from({ length: 118 }, (_, i) => `AAMk-missing-${i}`);
  ids.splice(3, 0, G.IDS.y);
  ids.splice(60, 0, G.IDS.sent1);
  ids.push(G.IDS.x, G.IDS.x);
  const fake = createMcpFake();
  const list = await make(fake).fetchDetails(ids);
  const sent = args(fake, 'mail_query_if_emaidID');
  assert.deepEqual(sent.map((a) => a.message_ids.length), [50, 50, 21]);
  assert.deepEqual(sent.flatMap((a) => a.message_ids), [...new Set(ids)]);
  assert.ok(sent.every((a) => Object.keys(a).join() === 'message_ids'), '인자는 message_ids 하나');
  assert.deepEqual(list.map((m) => m.id), [G.IDS.y, G.IDS.sent1, G.IDS.x]);
  assert.equal(list[0].receivedAt, '2026-10-04T01:00:00Z', 'Graph 소수점 시각도 초까지');
  assert.equal(fake.sessions, 1);
});

console.log('받은 메일');
await ta('fetchInbox: test_handler 인자 그대로 · 나·임시보관 제외 · 오래된 것부터 · from 소문자', async () => {
  const fake = createMcpFake();
  const mails = await make(fake).fetchInbox({ since: new Date('2026-09-30T23:00:00.123Z'), excludeFrom: ['Me@KRS.co.kr'] });
  assert.deepEqual(args(fake, 'test_handler'), [{
    filter_params: { received_date_from: '2026-09-30T23:00:00Z', is_draft: false },
    client_filter: { exclude_from_address: ['me@krs.co.kr'] },
    select_params: { id: true, subject: true, from_recipient: true, sender: true, to_recipients: true, cc_recipients: true, received_date_time: true, sent_date_time: true, conversation_id: true, internet_message_id: true, has_attachments: true, body_preview: true, is_draft: true, parent_folder_id: true, web_link: true },
    top: 500,
  }]);
  assert.deepEqual(mails.map((m) => m.id), [G.IDS.auto, G.IDS.ndr, G.IDS.news, G.IDS.x, G.IDS.y], '내 사본·보낸 메일 빠짐, 받은 시각 차례');
  const x = mails.find((m) => m.id === G.IDS.x);
  assert.deepEqual(x.from, { name: '엑스', address: 'x@foo.com' });
  assert.equal(x.conversationId, 'CONV-SENT1');
  assert.equal(x.hasAttachments, true);
  assert.equal('body' in x, false, 'body 를 고르지 않았으니 MailHead');
  assert.equal('headers' in x, false, '머리글을 고르지 않음');
  assert.deepEqual(mails.find((m) => m.id === G.IDS.y).cc, [{ name: '비', address: 'b@bar.co.kr' }]);
});
await ta('fetchInbox: useHeaders 면 internet_message_headers 를 더 고르고 headers 로 풀어 준다 · top 바꾸기 · 제외 없으면 client_filter 없음', async () => {
  const fake = createMcpFake();
  const mails = await make(fake).fetchInbox({ since: '2026-09-30T00:00:00Z', useHeaders: true, top: 200 });
  const a = args(fake, 'test_handler')[0];
  assert.deepEqual(a.select_params, { ...INBOX_SELECT, internet_message_headers: true });
  assert.equal(a.top, 200);
  assert.equal('client_filter' in a, false);
  assert.deepEqual(mails.find((m) => m.id === G.IDS.auto).headers, { inReplyTo: '<SENT1@krs.co.kr>', references: '<SENT1@krs.co.kr>', autoSubmitted: 'auto-replied' });
  assert.deepEqual(mails.find((m) => m.id === G.IDS.x).headers, { inReplyTo: '<SENT1@krs.co.kr>', references: '<SENT1@krs.co.kr>', autoSubmitted: '' });
  assert.deepEqual(mails.find((m) => m.id === G.IDS.news).headers, { inReplyTo: '', references: '', autoSubmitted: '' });
  await assert.rejects(() => make(fake).fetchInbox({ excludeFrom: [G.ME] }), (e) => e.kind === 'args', 'since 없으면 메일함 전체를 읽지 않는다');
});
await ta("fetchInbox: status 'partial'(일부 쪽 실패)은 받은 만큼 쓴다", async () => {
  const fake = createMcpFake({ responses: { test_handler: (a) => G.inboxResponse({ select: a.select_params, exclude: a.client_filter.exclude_from_address, since: a.filter_params.received_date_from, partial: true }) } });
  const mails = await make(fake).fetchInbox({ since: '2026-09-30', excludeFrom: [G.ME] });
  assert.equal(mails.length, 5);
});
await ta('fetchInbox: 서버에 test_handler 가 없으면 mail_fetch_filter(exclude_params) 로 · fallback:true 면 바로', async () => {
  const tools = G.TOOL_NAMES.filter((n) => n !== 'test_handler');
  const fake = createMcpFake({ tools });
  const mails = await make(fake).fetchInbox({ since: '2026-09-30T00:00:00Z', excludeFrom: [G.ME] });
  assert.deepEqual(fake.names(), ['test_handler', 'mail_fetch_filter']);
  assert.deepEqual(args(fake, 'mail_fetch_filter'), [{ filter_params: { received_date_from: '2026-09-30T00:00:00Z', is_draft: false }, exclude_params: { exclude_from_address: [G.ME] } }]);
  assert.deepEqual(mails.map((m) => m.id), [G.IDS.auto, G.IDS.ndr, G.IDS.news, G.IDS.x, G.IDS.y]);
  assert.equal(mails[0].body.contentType, 'html', '대체 도구는 전체 필드(본문 포함)');
  assert.equal(fake.sessions, 1);
  const fake2 = createMcpFake();
  await make(fake2).fetchInbox({ since: '2026-09-30', excludeFrom: [G.ME], fallback: true });
  assert.deepEqual(fake2.names(), ['mail_fetch_filter']);
  // 대체 도구에 서버 쪽 제외가 빠져도(옛 서버) 어댑터가 한 번 더 거른다
  const fake3 = createMcpFake({ responses: { mail_fetch_filter: () => G.inboxResponse({}) } });
  const all = await make(fake3).fetchInbox({ since: '2026-09-30', excludeFrom: [G.ME], fallback: true });
  assert.ok(all.every((m) => m.from.address !== G.ME));
});

console.log('본문·첨부');
await ta('attachmentMeta: 인자 · 평평한 from · 첨부 목록(odataType) · 일부 못 찾음(partial)은 받은 만큼', async () => {
  const fake = createMcpFake();
  const list = await make(fake).attachmentMeta([G.IDS.x, 'AAMk-gone', G.IDS.sent1]);
  assert.deepEqual(args(fake, 'mail_attachment_meta'), [{ message_ids: [G.IDS.x, 'AAMk-gone', G.IDS.sent1] }]);
  assert.deepEqual(list.map((m) => m.id), [G.IDS.x, G.IDS.sent1]);
  const s1 = list[1];
  assert.deepEqual(s1.from, { name: G.ME_NAME, address: G.ME });
  assert.deepEqual(s1.to.map((a) => a.address), ['a@foo.com', 'b@bar.co.kr', 'd@krs.co.kr']);
  assert.equal(s1.body.contentType, 'html');
  assert.deepEqual(s1.attachments.map((a) => a.id), ['ATT-s1-xlsx', 'ATT-s1-docx', 'ATT-s1-img']);
  assert.deepEqual(s1.attachments[1], { id: 'ATT-s1-docx', name: '안내문.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 8_500_000, isInline: false, odataType: FILE_ATTACHMENT });
});
await ta('downloadAll: 첨부 목록을 먼저 받고(같은 세션) 받을 첨부가 있는 메일만 인라인 바이트로 · 인라인·itemAttachment 제외 · 큰 파일은 던지지 않고 missing', async () => {
  const fake = createMcpFake();
  const r = await make(fake).downloadAll([G.IDS.sent1, G.IDS.sent2, G.IDS.x]);
  assert.deepEqual(fake.names(), ['mail_attachment_meta', 'mail_attachment_download']);
  assert.deepEqual(args(fake, 'mail_attachment_download'), [{ message_attachment_ids: [G.IDS.sent1, G.IDS.x], save_file: false, include_body: false, convert_to_txt: false, skip_duplicates: false }], '첨부 없는 sent2 는 묻지 않음');
  assert.deepEqual(r.files.map((f) => [f.messageId, f.attachmentId, f.name]), [[G.IDS.sent1, 'ATT-s1-xlsx', '조사표.xlsx'], [G.IDS.x, 'ATT-x-xlsx', '조사표.xlsx']]);
  for (const f of r.files) {
    assert.ok(f.bytes instanceof Uint8Array);
    assert.equal(f.size, G.BYTES[f.attachmentId].length);
    assert.equal(f.bytes.length, f.size);
    assert.deepEqual([...f.bytes], [...G.BYTES[f.attachmentId]]);
    assert.equal(f.contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  assert.deepEqual(r.missing, [{ messageId: G.IDS.sent1, attachmentId: 'ATT-s1-docx', name: '안내문.docx', size: 8_500_000 }]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /안내문\.docx/);
  assert.equal(fake.sessions, 1);
});
await ta('downloadAll: meta 를 주면 다시 묻지 않음 · 바이트 빈 항목·망가진 base64 도 missing · 같은 이름의 인라인 그림과 파일을 차례로 짝지음', async () => {
  const meta = [{ id: 'M1', attachments: [
    { id: 'A-inline', name: 'image.png', contentType: 'image/png', size: 9, isInline: true, odataType: FILE_ATTACHMENT },
    { id: 'A-file', name: 'image.png', contentType: 'image/png', size: 9, isInline: false, odataType: FILE_ATTACHMENT },
    { id: 'A-empty', name: '빈.xlsx', contentType: 'x', size: 9, isInline: false, odataType: FILE_ATTACHMENT },
    { id: 'A-bad', name: '깨짐.docx', contentType: 'x', size: 9, isInline: false, odataType: FILE_ATTACHMENT },
  ] }];
  const fileBytes = new Uint8Array([1, 2, 3, 4, 5]);
  const fake = createMcpFake({ responses: { mail_attachment_download: () => ({ status: 'success', errors: [], attachment_contents: [
    { message_id: 'M1', original_name: 'image.png', content_type: 'image/png', content_bytes: G.b64(new Uint8Array([9, 9])), size: 2 },
    { message_id: 'M1', original_name: 'image.png', content_type: 'image/png', content_bytes: G.b64(fileBytes), size: 5 },
    { message_id: 'M1', original_name: '빈.xlsx', content_type: 'x', content_bytes: '', size: 0 },
    { message_id: 'M1', original_name: '깨짐.docx', content_type: 'x', content_bytes: 'A', size: 1 },
  ] }) } });
  const r = await make(fake).downloadAll(['M1', 'M2'], { meta });
  assert.deepEqual(fake.names(), ['mail_attachment_download']);
  assert.deepEqual(r.files.map((f) => [f.attachmentId, [...f.bytes]]), [['A-file', [1, 2, 3, 4, 5]]]);
  assert.deepEqual(r.missing.map((m) => m.attachmentId), ['A-empty', 'A-bad']);
  assert.ok(r.errors.some((e) => /M2/.test(e)), '첨부 목록이 없는 메일은 건너뛰었다고 알림');
});
await ta('downloadAll: 한 묶음이 도구 오류면 errors 로 남기고 계속 · 받을 첨부가 없으면 다운로드를 부르지 않음 · 빈 목록은 아무것도', async () => {
  const fake = createMcpFake({ responses: { mail_attachment_download: { status: 'error', error: '첨부파일 처리 실패 (처리된 메일 없음)', errors: [] } } });
  const r = await make(fake).downloadAll([G.IDS.x]);
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.missing.map((m) => m.attachmentId), ['ATT-x-xlsx']);
  assert.ok(r.errors.some((e) => /처리된 메일 없음/.test(e)));
  const fake2 = createMcpFake();
  const none = await make(fake2).downloadAll([G.IDS.sent2, G.IDS.news]);
  assert.deepEqual(fake2.names(), ['mail_attachment_meta']);
  assert.deepEqual(none, { files: [], errors: [], missing: [] });
  assert.deepEqual(await make(fake2).downloadAll([]), { files: [], errors: [], missing: [] });
});
await ta('saveOnServer: 첨부 ID 쌍 인자 그대로(서버 PC 저장) · 서버 필드 + camelCase · 두 꼴의 쌍을 받음', async () => {
  const fake = createMcpFake();
  const r = await make(fake).saveOnServer([{ messageId: G.IDS.sent1, attachmentId: 'ATT-s1-docx' }, { message_id: G.IDS.x, attachment_id: 'ATT-x-xlsx' }, { messageId: '', attachmentId: 'z' }]);
  assert.deepEqual(args(fake, 'mail_attachment_download'), [{
    message_attachment_ids: [{ message_id: G.IDS.sent1, attachment_id: 'ATT-s1-docx' }, { message_id: G.IDS.x, attachment_id: 'ATT-x-xlsx' }],
    save_file: true, storage_type: 'local', save_directory: 'downloads/mailtrack', flat_folder: false,
  }]);
  assert.equal(r.results.length, 2);
  const a = r.results[0];
  assert.equal(a.success, true);
  assert.equal(a.messageId, G.IDS.sent1); assert.equal(a.attachmentId, 'ATT-s1-docx');
  assert.match(a.filePath, /downloads\\mailtrack\\.*안내문\.docx$/);
  assert.equal(a.file_path, a.filePath); assert.equal(a.folder_path, a.folderPath); assert.equal(a.name, '안내문.docx');
  await make(fake).saveOnServer([{ message_id: G.IDS.x, attachment_id: 'ATT-x-xlsx' }], 'downloads/other');
  assert.equal(args(fake, 'mail_attachment_download')[1].save_directory, 'downloads/other');
  const before = fake.calls.length;
  assert.deepEqual(await make(fake).saveOnServer([]), { results: [], errors: [] });
  assert.equal(fake.calls.length, before);
});

console.log('세션 · 사용자 · 주소');
await ta('run(): 세션 하나로 여러 번 부르고 끝에 DELETE · 모든 요청이 같은 세션 id', async () => {
  const fake = createMcpFake();
  const o = make(fake);
  const out = await o.run(async (api) => {
    const sent = await api.listSent({ from: '2026-09-15', to: '2026-10-15' });
    const full = await api.fetchDetails([G.IDS.sent1]);
    const inbox = await api.fetchInbox({ since: '2026-09-30', excludeFrom: [G.ME] });
    const files = await api.downloadAll([G.IDS.x]);
    const nested = await api.run((same) => same.attachmentMeta([G.IDS.y]));
    const p = await api.probe();
    return { sent: sent.length, full: full.length, inbox: inbox.length, files: files.files.length, nested: nested.length, ok: p.ok };
  });
  assert.deepEqual(out, { sent: 2, full: 1, inbox: 5, files: 1, nested: 1, ok: true });
  assert.equal(fake.sessions, 1, '세션은 하나');
  assert.equal(fake.deletes, 1);
  assert.equal(fake.open, 0, '닫혔다');
  assert.equal(fake.requests.at(-1).method, 'DELETE');
  assert.ok(fake.requests.slice(1).every((r) => r.session === 'mt-sess-1'));
  assert.equal(fake.names().length, 7);
});
await ta('run(): fn 이 던져도 세션을 닫는다 · 따로 부른 메서드는 각자 열고 닫는다', async () => {
  const fake = createMcpFake();
  const o = make(fake);
  await assert.rejects(() => o.run(async (api) => { await api.fetchDetails([G.IDS.x]); throw new Error('중간 실패'); }), /중간 실패/);
  assert.equal(fake.deletes, 1);
  await o.fetchDetails([G.IDS.x]);
  await o.attachmentMeta([G.IDS.x]);
  assert.equal(fake.sessions, 3);
  assert.equal(fake.deletes, 3);
  assert.equal(fake.open, 0);
});
await ta('userEmail: 비면 user_email 을 싣지 않고, 글이나 함수(부를 때마다 읽음)면 모든 도구에 싣는다', async () => {
  const fake = createMcpFake();
  await make(fake).fetchDetails([G.IDS.x]);
  await make(fake, { userEmail: '   ' }).attachmentMeta([G.IDS.x]);
  assert.ok(fake.calls.every((c) => !('user_email' in c.arguments)));
  fake.reset();
  await make(fake, { userEmail: 'boss@krs.co.kr' }).run(async (api) => { await api.listSent({ from: '2026-09-15' }); await api.downloadAll([G.IDS.x]); });
  assert.equal(fake.calls.length, 4);
  assert.ok(fake.calls.every((c) => c.arguments.user_email === 'boss@krs.co.kr'));
  fake.reset();
  let who = '';
  const o = make(fake, { userEmail: () => who });
  await o.fetchDetails([G.IDS.x]);
  who = 'other@krs.co.kr';
  await o.fetchInbox({ since: '2026-09-30' });
  assert.deepEqual(fake.calls.map((c) => c.arguments.user_email), [undefined, 'other@krs.co.kr']);
});
await ta('url: 함수면 부를 때마다 읽고, 비면 기본 주소', async () => {
  const fake = createMcpFake();
  let u = 'http://127.0.0.1:5001/mcp';
  const o = createOutlook({ url: () => u, fetch: fake.fetch });
  await o.fetchDetails([G.IDS.x]);
  u = '';
  await o.fetchDetails([G.IDS.x]);
  assert.deepEqual([...new Set(fake.requests.map((r) => r.url))], ['http://127.0.0.1:5001/mcp', MCP_URL_DEFAULT]);
});

console.log('서버 확인 · 오류');
await ta('probe(): 도구가 다 있으면 ok · has · 세션을 닫음', async () => {
  const fake = createMcpFake();
  const p = await make(fake).probe();
  assert.equal(p.ok, true);
  assert.deepEqual(p.has, { sent: true, details: true, meta: true, download: true, inbox: true, inboxFallback: true });
  assert.deepEqual(p.missing, []);
  assert.deepEqual(p.tools, [...G.TOOL_NAMES]);
  assert.deepEqual(p.server, { name: 'outlook', version: '1.0.0' });
  assert.equal(fake.deletes, 1);
  assert.deepEqual(fake.calls, [], '도구는 부르지 않는다');
});
await ta('probe(): test_handler 만 없으면 대체 도구로 ok · 둘 다 없거나 필수 도구가 없으면 missing', async () => {
  const noInbox = await make(createMcpFake({ tools: G.TOOL_NAMES.filter((n) => n !== 'test_handler') })).probe();
  assert.equal(noInbox.ok, true);
  assert.deepEqual([noInbox.has.inbox, noInbox.has.inboxFallback], [false, true]);
  const bare = await make(createMcpFake({ tools: ['mail_query_url', 'mail_send'] })).probe();
  assert.equal(bare.ok, false);
  assert.deepEqual(bare.missing, ['mail_query_if_emaidID', 'mail_attachment_meta', 'mail_attachment_download', 'test_handler']);
  assert.deepEqual(bare.has, { sent: true, details: false, meta: false, download: false, inbox: false, inboxFallback: false });
});
await ta("인증이 풀린 서버: auth_required(isError) → describe 가 kind 'auth' + authUrl · 세션은 닫힘", async () => {
  const fake = createMcpFake({ authRequired: true });
  const o = make(fake);
  let caught = null;
  await assert.rejects(() => o.listSent({ from: '2026-09-15' }), (e) => { caught = e; return e.kind === 'tool'; });
  const d = explain(caught);
  assert.equal(d.kind, 'auth');
  assert.equal(d.authUrl, G.AUTH_URL);
  assert.match(d.message, /로그인/);
  assert.deepEqual(o.describe(caught), d, '주입받은 쪽은 outlook.describe 로 같은 풀이');
  assert.equal(fake.deletes, 1);
  // 상세·첨부 길의 토큰 실패(auth_url 없음)와 사용자 없음도 auth
  const f2 = createMcpFake({ responses: {
    mail_query_if_emaidID: { status: 'error', error: 'Failed to get access token for me@krs.co.kr', value: [] },
    mail_attachment_meta: { status: 'error', error: 'Failed to acquire access token', errors: ['Failed to acquire access token'], value: [] },
    mail_attachment_download: { status: 'error', error: 'no_authenticated_user', message: 'user_email 이 지정되지 않았고 auth.db 에 인증된 사용자도 없습니다.' },
  } });
  const o2 = make(f2);
  for (const run of [() => o2.fetchDetails(['a']), () => o2.attachmentMeta(['a']), () => o2.saveOnServer([{ message_id: 'a', attachment_id: 'b' }])]) {
    let e2 = null;
    await assert.rejects(run, (e) => { e2 = e; return true; });
    assert.deepEqual(explain(e2), { kind: 'auth', message: 'Microsoft 로그인이 필요합니다 — MCP 서버에서 로그인을 마친 뒤 다시 하세요', authUrl: '' });
  }
  // 첨부 바이트 묶음의 인증 실패는 errors 로 삼키지 않고 던진다
  const f3 = createMcpFake({ responses: { mail_attachment_download: { status: 'error', error: '토큰 획득 실패', errors: ['토큰 획득 실패'] } } });
  await assert.rejects(() => make(f3).downloadAll([G.IDS.x]), (e) => explain(e).kind === 'auth');
});
await ta("서버가 꺼져 있으면 kind 'offline' (probe 도) · 없는 도구는 'notool' · 그 밖은 KRX_MCP 그대로", async () => {
  const off = createMcpFake({ up: false });
  for (const run of [() => make(off).probe(), () => make(off).listSent({ from: '2026-09-15' }), () => make(off).run(async () => 1)]) {
    let e = null;
    await assert.rejects(run, (x) => { e = x; return true; });
    assert.equal(explain(e).kind, 'offline');
  }
  const fake = createMcpFake({ tools: ['mail_send'] });
  let e = null;
  await assert.rejects(() => make(fake).fetchDetails(['a']), (x) => { e = x; return true; });
  assert.deepEqual(explain(e), { kind: 'notool', message: 'MCP 서버에 mail_query_if_emaidID 도구가 없습니다', tool: 'mail_query_if_emaidID' });
  // test_handler·mail_fetch_filter 둘 다 없으면 받은 메일도 notool
  await assert.rejects(() => make(fake).fetchInbox({ since: '2026-09-30' }), (x) => explain(x).kind === 'notool' && explain(x).tool === 'mail_fetch_filter');
  const plain = explain(Object.assign(new Error('MCP 서버 오류 500: x'), { kind: 'http', status: 500 }));
  assert.deepEqual(plain, { kind: 'http', message: 'MCP 서버 오류 500: x' });
  assert.equal(explain(null).kind, 'error');
});
await ta('옛 서버처럼 실패를 isError 없이 status 로만 주어도 오류로 · partial 은 성공', async () => {
  const fake = createMcpFake({ strictErrors: false, responses: { mail_query_if_emaidID: { status: 'error', error: 'Batch fetch failed', value: [] }, mail_attachment_meta: { success: false, error: 'boom' }, test_handler: G.AUTH_REQUIRED } });
  const o = make(fake);
  await assert.rejects(() => o.fetchDetails(['a']), (e) => e.kind === 'tool' && /Batch fetch failed/.test(e.message));
  await assert.rejects(() => o.attachmentMeta(['a']), (e) => e.kind === 'tool');
  await assert.rejects(() => o.fetchInbox({ since: '2026-09-30' }), (e) => explain(e).kind === 'auth' && explain(e).authUrl === G.AUTH_URL);
});

console.log(`\n${pass} passed`);
