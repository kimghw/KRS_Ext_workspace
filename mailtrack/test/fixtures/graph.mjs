// 메일 수신(회신 추적) 검사용 Graph 원본 — Outlook MCP(KR_MS365_mcp :5001)가 돌려주는 꼴 그대로의 가짜 응답.
// 주소·이름·경로는 전부 가짜다(me@krs.co.kr · a@foo.com …). 실제 주소를 넣지 않는다.
//
// 꼴은 서버 소스에서 확인한 대로다(2026-10-15, 읽기만):
//   · mail_query_url(보낸 편지함)  — select 가 서버 internal 고정 5필드(id·createdDateTime·receivedDateTime·bodyPreview·from)라 **subject 가 없다**
//                                   (spec/param_spec/outlook.yaml mail_query_url.select). 그래서 SENT_LIST 에도 subject 를 넣지 않았다.
//   · mail_query_if_emaidID       — $select 없이 Graph 기본 전체 필드(body·toRecipients·ccRecipients·conversationId·internetMessageId·webLink…).
//   · mail_attachment_meta        — from 은 emailAddress 를 벗긴 평평한 {name,address}, ccRecipients·conversationId 없음(mail_attachment.py 344~369행).
//   · mail_attachment_download    — save_file:false 면 attachment_contents[]{message_id, original_name, content_type, content_bytes(base64), size}.
//                                   contentBytes 가 없는 큰 파일은 항목 자체가 빠진다(mail_attachment_processor.py 161~163행) — 안내문.docx 가 그렇다.
//                                   인라인 그림도 바이트가 있으면 그대로 실린다(서버는 isInline 을 거르지 않는다).
//   · test_handler/mail_fetch_filter — 모든 폴더(/users/{me}/messages)라 보낸 메일도 섞여 온다. client_filter·exclude_params 의 발신자 제외로 나를 뺀다.
// 다른 단위의 검사가 나중에 가져다 쓸 수 있게 원본·응답 만들기를 모두 export 한다.

export const ME = 'me@krs.co.kr';
export const ME_NAME = '나담당';
export const SUBJECT = '[조사] 2026 하반기 설비 현황 조사 요청';
export const SUBJECT2 = '10월 회의 일정 안내';

/** 서버가 노출하는 도구 12개 (spec/param_spec/outlook.yaml) */
export const TOOL_NAMES = Object.freeze([
  'mail_list_period', 'mail_list_keyword', 'mail_query_if_emaidID', 'mail_attachment_meta', 'mail_attachment_download',
  'mail_fetch_filter', 'mail_fetch_search', 'mail_process_with_download', 'mail_query_url', 'mail_send', 'mail_draft', 'test_handler',
]);

export const IDS = Object.freeze({
  sent1: 'AAMk-sent-1', sent2: 'AAMk-sent-2',
  x: 'AAMk-in-x', auto: 'AAMk-in-auto', ndr: 'AAMk-in-ndr', y: 'AAMk-in-y', news: 'AAMk-in-news', self: 'AAMk-in-self',
});
export const SENT_IDS = Object.freeze([IDS.sent1, IDS.sent2]);
export const INBOX_IDS = Object.freeze([IDS.x, IDS.auto, IDS.ndr, IDS.y, IDS.news, IDS.self]);

export const FILE = '#microsoft.graph.fileAttachment';
export const ITEM = '#microsoft.graph.itemAttachment';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const ea = (address, name = '') => ({ emailAddress: { name, address } });
const enc = (s) => new TextEncoder().encode(s);
const join = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/** Uint8Array → base64 (btoa — 브라우저·Node 둘 다 있다) */
export function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/* 첨부 바이트 — 첨부 ID → 원본. 안내문.docx(ATT-s1-docx)와 itemAttachment 는 바이트가 없다(서버가 건너뜀) */
export const BYTES = Object.freeze({
  'ATT-s1-xlsx': join(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), enc('sent1 조사표 양식')),
  'ATT-s1-img': join(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), enc('sig')),
  'ATT-x-xlsx': join(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), enc('foo.com 회신 조사표 — 3행 작성')),
  'ATT-x-logo': join(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), enc('logo')),
});

/* 메일별 첨부(Graph $expand=attachments 차례). size 는 Graph 가 주는 값이라 원본 바이트보다 조금 크다 */
export const ATTACHMENTS = Object.freeze({
  [IDS.sent1]: [
    { '@odata.type': FILE, id: 'ATT-s1-xlsx', name: '조사표.xlsx', contentType: XLSX, size: BYTES['ATT-s1-xlsx'].length + 160, isInline: false },
    { '@odata.type': FILE, id: 'ATT-s1-docx', name: '안내문.docx', contentType: DOCX, size: 8_500_000, isInline: false },
    { '@odata.type': FILE, id: 'ATT-s1-img', name: 'image001.png', contentType: 'image/png', size: BYTES['ATT-s1-img'].length + 160, isInline: true },
  ],
  [IDS.x]: [
    { '@odata.type': FILE, id: 'ATT-x-xlsx', name: '조사표.xlsx', contentType: XLSX, size: BYTES['ATT-x-xlsx'].length + 160, isInline: false },
    { '@odata.type': FILE, id: 'ATT-x-logo', name: 'logo.png', contentType: 'image/png', size: BYTES['ATT-x-logo'].length + 160, isInline: true },
    { '@odata.type': ITEM, id: 'ATT-x-item', name: '원본 메일', contentType: null, size: 12345, isInline: false },
  ],
});

/* Graph 메시지 하나(기본 전체 필드) — mail_query_if_emaidID·mail_fetch_filter 가 주는 꼴 */
function message(o) {
  return {
    '@odata.etag': `W/"${o.id}"`,
    id: o.id,
    createdDateTime: o.receivedDateTime,
    lastModifiedDateTime: o.receivedDateTime,
    changeKey: 'CQAAABYAAA' + o.id.slice(-4),
    categories: [],
    receivedDateTime: o.receivedDateTime,
    sentDateTime: o.sentDateTime || o.receivedDateTime,
    hasAttachments: !!o.hasAttachments,
    internetMessageId: o.internetMessageId || `<${o.id}@fake.example>`,
    subject: o.subject,
    bodyPreview: o.bodyPreview || '',
    importance: 'normal',
    parentFolderId: o.parentFolderId || 'FOLDER-INBOX',
    conversationId: o.conversationId,
    conversationIndex: 'AQHZ' + o.id.slice(-4),
    isDeliveryReceiptRequested: false,
    isReadReceiptRequested: false,
    isRead: true,
    isDraft: !!o.isDraft,
    webLink: `https://outlook.office365.com/owa/?ItemID=${encodeURIComponent(o.id)}&exvsurl=1&viewmodel=ReadMessageItem`,
    inferenceClassification: 'focused',
    body: o.body || { contentType: 'html', content: `<html><body><p>${o.bodyPreview || ''}</p></body></html>` },
    sender: o.sender || o.from,
    from: o.from,
    toRecipients: o.toRecipients || [ea(ME, ME_NAME)],
    ccRecipients: o.ccRecipients || [],
    bccRecipients: [],
    replyTo: [],
    flag: { flagStatus: 'notFlagged' },
  };
}

const ME_RAW = ea('Me@KRS.co.kr', ME_NAME);   // Graph 가 돌려주는 대소문자 그대로 — 어댑터가 소문자로 맞춘다

export const SENT = Object.freeze([
  message({
    id: IDS.sent1, subject: SUBJECT, from: ME_RAW, parentFolderId: 'FOLDER-SENT',
    receivedDateTime: '2026-10-01T00:30:12Z', sentDateTime: '2026-10-01T00:30:10Z',
    conversationId: 'CONV-SENT1', internetMessageId: '<SENT1@krs.co.kr>', hasAttachments: true,
    bodyPreview: '안녕하세요. 첨부 조사표를 작성해 10월 10일까지 회신 바랍니다.',
    body: { contentType: 'html', content: '<html><body><p>안녕하세요.</p><p>첨부 조사표를 작성해 10월 10일까지 회신 바랍니다.</p></body></html>' },
    // 받을 곳은 To 에서만 선다(참조는 추적하지 않는다) — c@foo.com 은 참조라 foo.com 의 주소에 들지 않고, d@krs.co.kr 은 받는 사람이라 주소 키.
    toRecipients: [ea('a@foo.com', '에이'), ea('B@Bar.co.kr', '비'), ea('d@krs.co.kr', '디')],
    ccRecipients: [ea('c@foo.com', '씨')],
  }),
  message({
    id: IDS.sent2, subject: SUBJECT2, from: ME_RAW, parentFolderId: 'FOLDER-SENT',
    receivedDateTime: '2026-10-05T08:00:00Z', sentDateTime: '2026-10-05T07:59:58Z',
    conversationId: 'CONV-SENT2', internetMessageId: '<SENT2@krs.co.kr>', hasAttachments: false,
    bodyPreview: '10월 회의는 14일 오후 2시입니다.', body: { contentType: 'text', content: '10월 회의는 14일 오후 2시입니다.' },
    toRecipients: [ea('e@baz.com', '이')],
  }),
]);

export const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=fake-client&state=st-fake-1';

export const INBOX = Object.freeze([
  // x@foo.com — 같은 대화(conversationId)로 온 회신 + 조사표.xlsx
  message({
    id: IDS.x, subject: 'RE: ' + SUBJECT, from: ea('X@Foo.com', '엑스'),
    receivedDateTime: '2026-10-03T05:06:07Z', sentDateTime: '2026-10-03T05:06:01Z',
    conversationId: 'CONV-SENT1', internetMessageId: '<X1@foo.com>', hasAttachments: true,
    bodyPreview: '작성한 조사표 보내 드립니다.',
  }),
  // b@bar.co.kr — 자동 회신(머리글 Auto-Submitted 까지 — HEADERS)
  message({
    id: IDS.auto, subject: '자동 회신: ' + SUBJECT, from: ea('b@bar.co.kr', '비'),
    receivedDateTime: '2026-10-01T00:31:00Z', conversationId: 'CONV-SENT1', internetMessageId: '<AUTO1@bar.co.kr>',
    bodyPreview: '10월 12일까지 휴가입니다.',
  }),
  // postmaster — 배달 실패
  message({
    id: IDS.ndr, subject: 'Undeliverable: ' + SUBJECT, from: ea('postmaster@krs.co.kr', 'Microsoft Outlook'),
    receivedDateTime: '2026-10-01T00:32:00Z', conversationId: 'CONV-NDR', internetMessageId: '<NDR1@krs.co.kr>',
    bodyPreview: '메시지를 배달하지 못했습니다.',
  }),
  // y@bar.co.kr — 같은 제목이지만 다른 대화(제목·도메인으로만 이어짐). 시각에 소수점 7자리(Graph 가 가끔 그렇게 준다)
  message({
    id: IDS.y, subject: 'RE: ' + SUBJECT, from: ea('y@bar.co.kr', '와이'),
    receivedDateTime: '2026-10-04T01:00:00.1234567Z', conversationId: 'CONV-OTHER', internetMessageId: '<Y1@bar.co.kr>',
    bodyPreview: '저희 쪽 회신입니다.', ccRecipients: [ea('b@bar.co.kr', '비')],
  }),
  // 관계없는 메일
  message({
    id: IDS.news, subject: '10월 할인 소식', from: ea('news@shop.example', '쇼핑 소식'),
    receivedDateTime: '2026-10-02T09:00:00Z', conversationId: 'CONV-NEWS', bodyPreview: '이번 달 할인 품목',
  }),
  // 내가 나에게(참조로) 받은 사본 — client_filter 의 발신자 제외로 빠져야 한다
  message({
    id: IDS.self, subject: SUBJECT, from: ME_RAW,
    receivedDateTime: '2026-10-01T00:30:15Z', conversationId: 'CONV-SENT1', internetMessageId: '<SENT1@krs.co.kr>',
    bodyPreview: '안녕하세요. 첨부 조사표를 작성해 10월 10일까지 회신 바랍니다.',
  }),
]);

/** id → Graph 전체 메시지 */
export const MESSAGES = Object.freeze(Object.fromEntries([...SENT, ...INBOX].map((m) => [m.id, m])));

/* internetMessageHeaders — Graph 는 $select 로 고를 때만 준다(기본 전체 필드에는 없다). 여기 없는 메일은 Received 한 줄만 */
export const HEADERS = Object.freeze({
  [IDS.auto]: [
    { name: 'Received', value: 'from mx.bar.example by mx.krs.example' },
    { name: 'Auto-Submitted', value: 'auto-replied' },
    { name: 'In-Reply-To', value: '<SENT1@krs.co.kr>' },
    { name: 'References', value: '<SENT1@krs.co.kr>' },
    { name: 'X-MS-Exchange-Organization-AuthAs', value: 'Anonymous' },
  ],
  [IDS.x]: [
    { name: 'Received', value: 'from mx.foo.example by mx.krs.example' },
    { name: 'In-Reply-To', value: '<SENT1@krs.co.kr>' },
    { name: 'References', value: '<SENT1@krs.co.kr>' },
  ],
});
const headersFor = (id) => HEADERS[id] || [{ name: 'Received', value: 'from mx.fake.example by mx.krs.example' }];

/* 조회 결과 공통 꼴 (graph_mail_query.py 820~841행) */
export function listShape(value, extra = {}) {
  return { value, total: value.length, '@odata.count': value.length, request_url: extra.request_url || 'https://graph.microsoft.com/v1.0/users/me@krs.co.kr/messages', pages_requested: extra.pages_requested || 1, fetch_time: 0.42, ...extra };
}

/** mail_query_url(보낸 편지함) 응답 — 서버 internal select 5필드뿐(subject 없음) */
export function sentListResponse() {
  const value = SENT.map((m) => ({ '@odata.etag': m['@odata.etag'], id: m.id, createdDateTime: m.createdDateTime, receivedDateTime: m.receivedDateTime, bodyPreview: m.bodyPreview, from: m.from }));
  return listShape(value, { request_url: 'https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?&$filter=receivedDateTime ge 2026-09-15T00:00:00Z&$select=id,createdDateTime,receivedDateTime,bodyPreview,from', query_method: 'url' });
}

/** mail_query_if_emaidID 응답 (graph_mail_client.batch_and_fetch) — 하나도 못 찾으면 status error */
export function detailsResponse(ids = []) {
  if (!ids.length) return { status: 'success', value: [], total: 0, message: 'No message IDs provided', query_method: 'batch_id' };
  const value = ids.map((id) => MESSAGES[id]).filter(Boolean);
  const errors = ids.filter((id) => !MESSAGES[id]).map((id) => ({ batch: 1, id, status: 404, error: 'ErrorItemNotFound' }));
  if (!value.length) return { status: 'error', error: 'Batch fetch failed', value: [], errors, query_method: 'batch_id' };
  return { status: 'success', value, total: value.length, requested: ids.length, errors: errors.length ? errors : null, query_method: 'batch_id', batches_processed: Math.ceil(ids.length / 20) };
}

/** mail_attachment_meta 의 value[] 한 줄 — from 은 평평함, ccRecipients·conversationId 없음 */
export function metaView(m) {
  const atts = ATTACHMENTS[m.id] || [];
  return {
    id: m.id, subject: m.subject, from: m.from.emailAddress, toRecipients: m.toRecipients, receivedDateTime: m.receivedDateTime,
    hasAttachments: m.hasAttachments, importance: m.importance, isRead: m.isRead, bodyPreview: m.bodyPreview, body: m.body,
    attachments: atts.map((a) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size, isInline: a.isInline, '@odata.type': a['@odata.type'] })),
  };
}

/** mail_attachment_meta 응답 (graph_mail_client.fetch_attachments_metadata) */
export function metaResponse(ids = []) {
  const value = ids.filter((id) => MESSAGES[id]).map((id) => metaView(MESSAGES[id]));
  const errors = ids.filter((id) => !MESSAGES[id]).map((id) => `Mail ${id.slice(0, 20)}...: The specified object was not found in the store.`);
  const attachments_count = value.reduce((n, v) => n + v.attachments.length, 0);
  if (ids.length && !value.length) return { status: 'error', error: errors.join('; '), value: [], total: 0, attachments_count: 0, errors };
  return { status: errors.length ? 'partial' : 'success', value, total: value.length, attachments_count, errors: errors.length ? errors : null };
}

/** mail_attachment_download(메일 ID 목록 + save_file:false) 응답 — 바이트가 있는 첨부만 인라인 base64 로 */
export function downloadResponse(ids = []) {
  const found = ids.filter((id) => MESSAGES[id]);
  const attachment_contents = [];
  for (const id of found) {
    for (const a of ATTACHMENTS[id] || []) {
      const bytes = BYTES[a.id];
      if (!bytes) continue;   // [SKIP] contentBytes 없음 (대용량 파일) · itemAttachment
      attachment_contents.push({ message_id: id, original_name: a.name, content_type: a.contentType, content_bytes: b64(bytes), size: bytes.length });
    }
  }
  const errors = ids.filter((id) => !MESSAGES[id]).map((id) => `메일 ${id.slice(0, 20)}...: The specified object was not found in the store.`);
  const payload = {
    mode: 'all_attachments', total_mails: ids.length, processed: found.length, saved_attachments: [], saved_folders: [], converted_files: [],
    body_contents: [], attachment_contents, skipped_duplicates: 0, errors, storage_type: 'local', save_file: false, convert_to_txt: false,
  };
  if (!found.length) return { ...payload, status: 'error', error: errors.join('; ') || '첨부파일 처리 실패 (처리된 메일 없음)' };
  return { ...payload, status: errors.length ? 'partial' : 'success' };
}

/** mail_attachment_download(첨부 ID 쌍) 응답 — save_file 과 상관없이 서버 PC 에 저장하고 경로만 준다 */
export function saveResponse(pairs = [], dir = 'downloads') {
  const results = [];
  const errors = [];
  for (const p of pairs) {
    const att = (ATTACHMENTS[p.message_id] || []).find((a) => a.id === p.attachment_id);
    if (!att || att['@odata.type'] !== FILE) {
      const error = att ? 'No content bytes in attachment' : 'The specified object was not found in the store.';
      errors.push(`Failed ${p.message_id}/${p.attachment_id}: ${error}`);
      results.push({ message_id: p.message_id, attachment_id: p.attachment_id, success: false, error });
      continue;
    }
    const folder = `C:\\mcp\\${dir.replace(/\//g, '\\')}\\20261001_${ME_NAME}_${p.message_id}`;
    results.push({ message_id: p.message_id, attachment_id: p.attachment_id, file_path: `${folder}\\${att.name}`, folder_path: folder, name: att.name, success: true });
  }
  const downloaded = results.filter((r) => r.success).length;
  const payload = { mode: 'specific_attachments', total_requested: pairs.length, downloaded, failed: results.length - downloaded, results, errors };
  if (!downloaded) return { ...payload, status: 'error', error: errors.join('; ') || '첨부파일 다운로드 실패 (다운로드 0건)' };
  return { ...payload, status: errors.length ? 'partial' : 'success' };
}

/* test_handler select_params(snake) → Graph 필드 */
const SELECT_MAP = {
  id: 'id', subject: 'subject', from_recipient: 'from', sender: 'sender', to_recipients: 'toRecipients', cc_recipients: 'ccRecipients',
  received_date_time: 'receivedDateTime', sent_date_time: 'sentDateTime', conversation_id: 'conversationId', internet_message_id: 'internetMessageId',
  has_attachments: 'hasAttachments', body_preview: 'bodyPreview', is_draft: 'isDraft', parent_folder_id: 'parentFolderId', web_link: 'webLink',
  internet_message_headers: 'internetMessageHeaders', body: 'body',
};

/** test_handler / mail_fetch_filter 응답 — 모든 폴더(보낸 메일 포함)에서 날짜·임시보관·발신자 제외를 서버처럼 걸고 select 로 필드를 고른다 */
export function inboxResponse({ select = null, exclude = [], isDraft = null, since = '', limit = 0, partial = false } = {}) {
  const ex = [].concat(exclude || []).map((a) => String(a).toLowerCase());
  const t0 = since ? Date.parse(since) : -Infinity;
  let list = [...SENT, ...INBOX]
    .filter((m) => Date.parse(m.receivedDateTime) >= t0)
    .filter((m) => isDraft === null || isDraft === undefined || m.isDraft === isDraft)
    .filter((m) => !ex.includes(String((m.from || m.sender).emailAddress.address).toLowerCase()));
  if (limit) list = list.slice(0, limit);
  const fields = select ? Object.entries(select).filter(([, on]) => on === true).map(([k]) => SELECT_MAP[k]).filter(Boolean) : null;
  const pick = (m) => Object.fromEntries([['@odata.etag', m['@odata.etag']], ...fields.map((f) => [f, f === 'internetMessageHeaders' ? headersFor(m.id) : m[f]]).filter(([, v]) => v !== undefined)]);
  const value = fields ? list.map(pick) : list;
  const extra = { query_method: 'filter', pages_requested: 4 };
  if (partial) Object.assign(extra, { status: 'partial', has_errors: true, errors: [{ value: [], error: 'HTTP 503', page: 4 }] });
  return listShape(value, extra);
}

/** 인증이 풀렸을 때 (session/auth_manager.py get_auth_url_for_login) — isError 로 온다 */
export const AUTH_REQUIRED = Object.freeze({
  status: 'auth_required', auth_url: AUTH_URL, state: 'st-fake-1', email: 'unknown',
  message: `인증이 필요합니다. 아래 URL을 브라우저에서 열어 로그인해주세요.\n${AUTH_URL}`,
});
