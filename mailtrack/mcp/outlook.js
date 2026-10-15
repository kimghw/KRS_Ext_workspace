// Outlook MCP 어댑터 — 메일 수신(회신 추적)이 KR_MS365_mcp 의 Outlook 서버(:5001)를 부르는 유일한 곳. 도구 이름·인자·응답 정규화를 여기에 가둔다.
// 2026-10-15 사용자 지정: "mcp 를 이용해야하고.. 내가 보낸 메일에서 받는사람 참조자 또는 메일주소가 도메인이 같은 경우 이를 식별해서 등록 해줍니다" ·
// "메일 내용과 첨부파일을 한 곳에 관리해 줍니다". 그래서 보낸 메일(목록·상세)·받은 메일(갱신)·본문과 첨부(목록·바이트)를 부르는 길만 둔다 —
// 장부·매칭·저장은 모른다(sync.js·match.js·store/*). 돌려주는 꼴은 계약서 3.1 의 Addr·SentHead·MailFull·MailHead·AttMeta·MailMeta·FileContent.
//
// 전송은 rerp/mcp.js(KRX_MCP — 읽어 쓰기만, 고치지 않는다): open → call → close(DELETE). 메서드는 혼자 부르면 세션을 열고 닫고,
// run(api => …) 안에서는 세션 하나로 여러 번 부른다(등록 한 번에 목록·상세·첨부를 부르는데 그때마다 세션을 열면 서버에 쌓인다).
//
// 도구 계약의 원본은 서버의 spec/param_spec/outlook.yaml 이다(2026-10-15 서버 소스를 읽어 맞춤). 계약서(mailtrack-plan.md 2절)와 다른 곳:
//   · mail_query_url 의 $select 는 서버 internal 고정 5필드(id·createdDateTime·receivedDateTime·bodyPreview·from)라 **subject 가 안 온다**.
//     인자로 덮을 수 없고(internal 은 늘 spec 기본값을 주입), url 에 $select 를 넣으면 서버가 붙이는 것과 두 번이 되어 Graph 가 400 이다.
//     → listSent 는 같은 세션에서 mail_query_if_emaidID 로 상세를 받아 제목(과 받는 사람·참조)을 채운다. 서버가 subject 를 주게 되면 그 부름은 저절로 빠진다.
//   · test_handler 에는 user_email 파라미터가 없어 서버가 버린다(param_spec.call_args 는 spec 에 적힌 것만 넘김) → 받은 메일은 늘 서버 기본 사용자(auth.db)의 것.
//   · 첨부 바이트(attachment_contents)에는 첨부 ID 가 없고(메일 ID·이름뿐) 인라인 그림도 섞여 온다 → 첨부 목록(mail_attachment_meta)과 메일 ID + 이름
//     (같은 이름은 Graph 차례)으로 짝지어 attachmentId 를 붙이고, 인라인·fileAttachment 아닌 것은 버린다. 바이트가 안 온 것(큰 파일)은 missing 으로 알린다.
//   · 인증 실패의 꼴이 길마다 다르다: 목록 조회는 {status:'auth_required', auth_url}, 상세·첨부는 "Failed to … access token"·"토큰 획득 실패",
//     사용자가 아예 없으면 no_authenticated_user → describe() 가 모두 kind 'auth' 로 모은다(auth_url 이 있을 때만 authUrl 로 로그인 창을 연다).
// import·생성만으로는 아무것도 부르지 않는다(chrome·fetch 없음) — test/wiring.test.mjs 가 jsdom 에서 sidepanel.js 를 통째로 import 한다.
import KRX_MCP from '../../rerp/mcp.js';

export const MCP_URL_DEFAULT = 'http://localhost:5001/mcp';
export const TOOLS = Object.freeze({
  sent: 'mail_query_url', details: 'mail_query_if_emaidID', meta: 'mail_attachment_meta', download: 'mail_attachment_download',
  inbox: 'test_handler', inboxFallback: 'mail_fetch_filter',
});
export const SENT_URL = 'https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?';
/** 바이트가 있는 첨부의 Graph 형식 — itemAttachment(첨부된 메일)·referenceAttachment(링크)는 바이트가 없다 */
export const FILE_ATTACHMENT = '#microsoft.graph.fileAttachment';
/** 상세·첨부 목록을 한 번에 물을 메일 수 (서버는 안에서 다시 20개씩 Graph $batch 로 나눈다) */
export const CHUNK = 50;
/** 첨부 바이트를 한 번에 받을 메일 수 — 답이 base64 를 품은 JSON 이라 크다 */
export const DOWNLOAD_CHUNK = 10;
/** 받은 메일 갱신에 고르는 필드 (test_handler select_params, snake_case 는 서버 SelectParams 이름) */
export const INBOX_SELECT = Object.freeze({
  id: true, subject: true, from_recipient: true, sender: true, to_recipients: true, cc_recipients: true, received_date_time: true,
  sent_date_time: true, conversation_id: true, internet_message_id: true, has_attachments: true, body_preview: true, is_draft: true,
  parent_folder_id: true, web_link: true,
});
/* 없으면 기능이 서지 않는 도구 — 받은 메일은 test_handler 나 mail_fetch_filter 둘 중 하나면 된다 */
const REQUIRED = ['sent', 'details', 'meta', 'download'];
/* 길마다 다른 인증 실패 글 (graph_mail_id_batch·mail_attachment·user_resolver) */
const AUTH_TEXT = /access token|토큰 획득|no_authenticated_user|auth_required/i;

function err(kind, message, extra) { const e = new Error(message); e.kind = kind; return Object.assign(e, extra || {}); }
const str = (v) => (v === null || v === undefined ? '' : String(v));
const flat = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v));
const uniq = (ids) => [...new Set([].concat(ids || []).map((x) => str(x).trim()).filter(Boolean))];
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const byTime = (dir) => (a, b) => (a.receivedAt < b.receivedAt ? -dir : a.receivedAt > b.receivedAt ? dir : 0);

/** 시각 → 'YYYY-MM-DDTHH:mm:ssZ' (밀리초 없음). Date·ms 숫자·문자열을 받는다. Graph 는 소수점 7자리를 주기도 하고, 시간대 없는 시각은 UTC 다. 못 읽으면 '' */
export function isoOf(v) {
  if (v === null || v === undefined || v === '') return '';
  let d;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number') d = new Date(v);
  else {
    let s = String(v).trim();
    s = s.replace(/(T\d{2}:\d{2}:\d{2})\.\d+/, '$1');
    if (/T\d{2}:\d{2}(:\d{2})?$/.test(s)) s += 'Z';
    d = new Date(s);
  }
  const t = d.getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(Math.floor(t / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 주소 → { name, address(소문자) }. Graph 의 {emailAddress:{name,address}} 와 mail_attachment_meta 의 평평한 {name,address}, '이름 <주소>' 글을 모두 받는다 */
export function addrOf(x) {
  if (!x) return { name: '', address: '' };
  if (typeof x === 'string') {
    const m = /<([^>]*)>/.exec(x);
    return { name: m ? x.slice(0, m.index).trim().replace(/^"(.*)"$/, '$1') : '', address: (m ? m[1] : x).trim().toLowerCase() };
  }
  const e = x.emailAddress && typeof x.emailAddress === 'object' ? x.emailAddress : x;
  return { name: str(e.name).trim(), address: str(e.address).trim().toLowerCase() };
}
const addrsOf = (list) => [].concat(list || []).map(addrOf).filter((a) => a.address);

function bodyOf(b) {
  if (!b || typeof b !== 'object') return { contentType: 'text', content: '' };
  return { contentType: /html/i.test(str(b.contentType)) ? 'html' : 'text', content: str(b.content) };
}
/* internetMessageHeaders[{name,value}] → 회신 판정에 쓰는 셋 (이름은 대소문자 무시) */
function headersOf(list) {
  const get = (n) => { const h = list.find((x) => x && str(x.name).toLowerCase() === n); return h ? str(h.value) : ''; };
  return { inReplyTo: get('in-reply-to'), references: get('references'), autoSubmitted: get('auto-submitted') };
}

/** 보낸 편지함 한 줄 → SentHead */
export function sentHeadOf(m) {
  return { id: str(m.id), subject: str(m.subject), from: addrOf(m.from || m.sender), receivedAt: isoOf(m.receivedDateTime || m.sentDateTime), preview: str(m.bodyPreview) };
}
/** Graph 메시지 → MailFull (body 가 안 왔으면 body 없는 MailHead, 머리글이 왔을 때만 headers) */
export function mailOf(m) {
  const out = {
    id: str(m.id), subject: str(m.subject), from: addrOf(m.from || m.sender), sender: m.sender ? addrOf(m.sender) : null,
    to: addrsOf(m.toRecipients), cc: addrsOf(m.ccRecipients), sentAt: isoOf(m.sentDateTime), receivedAt: isoOf(m.receivedDateTime),
    conversationId: str(m.conversationId), internetMessageId: str(m.internetMessageId), hasAttachments: !!m.hasAttachments, isDraft: !!m.isDraft,
    preview: str(m.bodyPreview), webLink: str(m.webLink),
  };
  if (m.body && typeof m.body === 'object') out.body = bodyOf(m.body);
  if (Array.isArray(m.internetMessageHeaders)) out.headers = headersOf(m.internetMessageHeaders);
  return out;
}
/** 첨부 목록 한 줄 → AttMeta (이미 정규화된 것을 다시 넣어도 같다) */
export function attOf(a) {
  return { id: str(a.id), name: str(a.name), contentType: str(a.contentType), size: Number(a.size) || 0, isInline: !!a.isInline, odataType: str(a.odataType || a['@odata.type']) };
}
/** 바이트를 받을 첨부인가 — 인라인(서명 그림 등)과 fileAttachment 아닌 것은 뺀다. 형식을 모르면(옛 서버) 받아 본다 */
export function isFileAttachment(a) {
  return !!a && !a.isInline && (!a.odataType || a.odataType === FILE_ATTACHMENT);
}
/** mail_attachment_meta 한 줄 → MailMeta */
export function metaOf(m) {
  return {
    id: str(m.id), subject: str(m.subject), from: addrOf(m.from), to: addrsOf(m.toRecipients), receivedAt: isoOf(m.receivedDateTime || m.receivedAt),
    hasAttachments: !!m.hasAttachments, body: bodyOf(m.body), attachments: [].concat(m.attachments || []).map(attOf),
  };
}
/** base64 → Uint8Array (서버는 Python base64.b64encode — 표준 알파벳. 줄바꿈·URL 안전 글자도 견딘다) */
export function bytesOf(b64) {
  const s = atob(str(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 오류 → { kind, message, authUrl? }. kind 는 KRX_MCP 것(offline·http·rpc·tool·parse·timeout·session)에 auth·notool 을 더한다 */
export function describe(e) {
  if (!e) return { kind: 'error', message: '알 수 없는 오류' };
  const p = e.payload && typeof e.payload === 'object' ? e.payload : null;
  if (e.kind === 'auth' || (p && p.status === 'auth_required')) {
    const authUrl = str((p && p.auth_url) || e.authUrl);
    return { kind: 'auth', message: authUrl ? 'Microsoft 로그인이 필요합니다 — 로그인 창에서 로그인한 뒤 다시 하세요' : 'Microsoft 로그인이 필요합니다 — MCP 서버에서 로그인을 마친 뒤 다시 하세요', authUrl };
  }
  if (e.kind === 'notool' || (p && p.error === 'unknown_tool')) {
    const tool = str((p && p.tool) || e.tool);
    return { kind: 'notool', message: `MCP 서버에 ${tool || '필요한'} 도구가 없습니다`, tool };
  }
  if (e.kind === 'tool') {
    const text = p ? [p.error, p.message].concat(Array.isArray(p.errors) ? p.errors : []).map(flat).join(' ') : str(e.payload);
    if (AUTH_TEXT.test(text)) return { kind: 'auth', message: 'Microsoft 로그인이 필요합니다 — MCP 서버에서 로그인을 마친 뒤 다시 하세요', authUrl: '' };
  }
  return KRX_MCP.describe(e);
}

/* tools/list → probe 결과 */
function summarize(server, tools) {
  const names = [].concat(tools || []).map((t) => (typeof t === 'string' ? t : t && t.name)).filter(Boolean);
  const has = Object.fromEntries(Object.entries(TOOLS).map(([k, n]) => [k, names.includes(n)]));
  const missing = REQUIRED.filter((k) => !has[k]).map((k) => TOOLS[k]);
  if (!has.inbox && !has.inboxFallback) missing.push(TOOLS.inbox);
  return { ok: missing.length === 0, server: server || null, tools: names, has, missing };
}

/** 어댑터 만들기. url·userEmail 은 글이나 함수(부를 때마다 읽음 — 설정을 바꾸면 다음 부름부터). open·probe·fetch 는 검사용 바꿔 끼우기 */
export function createOutlook({ url = MCP_URL_DEFAULT, userEmail = '', open = KRX_MCP.open, probe: probeMcp = KRX_MCP.probe, fetch, clientName = 'krs-workspace', callTimeoutMs = 180000 } = {}) {
  const read = (v) => str(typeof v === 'function' ? v() : v).trim();
  const urlNow = () => read(url) || MCP_URL_DEFAULT;
  const opts = () => (fetch ? { clientName, callTimeoutMs, fetch } : { clientName, callTimeoutMs });

  async function session(fn) {
    const client = await open(urlNow(), opts());
    try { return await fn(client); } finally { await client.close(); }
  }
  /* 도구 하나 부르기 — user_email 은 설정에 적었을 때만 싣는다(비우면 서버가 auth.db 에서 정한다) */
  async function call(c, name, args) {
    const who = read(userEmail);
    const r = await c.call(name, who ? { ...args, user_email: who } : args);
    const j = r && r.json;
    if (!j || typeof j !== 'object') throw err('parse', `${name}: 응답이 JSON 이 아닙니다 (${str(r && r.text).slice(0, 80)})`, { tool: name });
    // 지금 서버는 실패를 isError 로 주지만(mcp_common/errors.py) 옛 서버는 status 로만 알렸다 — 같은 오류로 바꾼다. partial 은 성공분이 있으니 그대로 쓴다
    if (['error', 'failed', 'auth_required'].includes(j.status) || j.success === false) throw err('tool', `${name}: ${flat(j.message || j.error || '도구 실행 실패')}`, { payload: j, tool: name });
    return j;
  }

  const impl = {
    async probe(c) { return summarize(c.server, await c.list()); },

    /* 보낸 편지함 목록 — 등록 대화에 쓴다. 최근 것부터 */
    async listSent(c, { from, to, top = 100, details = true } = {}) {
      const filter_params = {};
      if (isoOf(from)) filter_params.received_date_from = isoOf(from);
      if (isoOf(to)) filter_params.received_date_to = isoOf(to);
      const j = await call(c, TOOLS.sent, { url: SENT_URL, filter_params, top });
      const raw = [].concat(j.value || []).filter((m) => m && m.id);
      const heads = raw.map(sentHeadOf);
      const lacking = heads.filter((h, i) => !('subject' in raw[i])).map((h) => h.id);
      if (details && lacking.length) {
        // 제목이 안 오는 서버(위 머리 주석) — 상세로 채우고 받는 사람·참조도 같이 얹는다(등록 대화가 도메인을 미리 보인다)
        let full = [];
        try { full = await impl.fetchDetails(c, lacking); } catch (e) { if (describe(e).kind !== 'tool') throw e; }
        const byId = new Map(full.map((m) => [m.id, m]));
        for (const h of heads) {
          const m = byId.get(h.id);
          if (m) Object.assign(h, { subject: m.subject, to: m.to, cc: m.cc, sentAt: m.sentAt, conversationId: m.conversationId, hasAttachments: m.hasAttachments });
        }
      }
      return heads.sort(byTime(-1));
    },

    /* 등록할 메일의 상세(받는 사람·참조·대화 ID·본문) — 50개씩 끊어 묻고, 물은 차례로 돌려준다. 못 찾은 ID 는 빠진다 */
    async fetchDetails(c, ids) {
      const want = uniq(ids);
      const got = new Map();
      for (const part of chunks(want, CHUNK)) {
        const j = await call(c, TOOLS.details, { message_ids: part });
        for (const m of [].concat(j.value || [])) if (m && m.id) got.set(str(m.id), mailOf(m));
      }
      return want.map((id) => got.get(id)).filter(Boolean);
    },

    /* 받은 메일(갱신) — since 이후, 임시보관·나(excludeFrom) 제외, 오래된 것부터. test_handler 가 없는 서버면 mail_fetch_filter(50건 한도) */
    async fetchInbox(c, { since, top = 500, excludeFrom = [], useHeaders = false, fallback = false } = {}) {
      const from = isoOf(since);
      if (!from) throw err('args', 'fetchInbox: since(조회 시작 시각)가 없습니다 — 없으면 메일함 전체를 읽게 됩니다');
      const ex = uniq([].concat(excludeFrom || []).map((a) => str(a).toLowerCase()));
      const filter_params = { received_date_from: from, is_draft: false };
      let j = null;
      if (!fallback) {
        const select_params = useHeaders ? { ...INBOX_SELECT, internet_message_headers: true } : { ...INBOX_SELECT };
        try { j = await call(c, TOOLS.inbox, { filter_params, ...(ex.length ? { client_filter: { exclude_from_address: ex } } : {}), select_params, top }); }
        catch (e) { if (describe(e).kind !== 'notool') throw e; }
      }
      if (!j) j = await call(c, TOOLS.inboxFallback, { filter_params, ...(ex.length ? { exclude_params: { exclude_from_address: ex } } : {}) });
      // 서버가 모든 폴더(보낸 편지함 포함)를 읽으므로 한 번 더 거른다 — 서버 쪽 제외가 빠져도(옛 서버·대체 도구) 결과가 같게
      return [].concat(j.value || []).filter((m) => m && m.id).map(mailOf)
        .filter((m) => !m.isDraft && !ex.includes(m.from.address))
        .sort(byTime(1));
    },

    /* 본문 + 첨부 목록 — 50개씩, 물은 차례로 */
    async attachmentMeta(c, ids) {
      const want = uniq(ids);
      const got = new Map();
      for (const part of chunks(want, CHUNK)) {
        const j = await call(c, TOOLS.meta, { message_ids: part });
        for (const m of [].concat(j.value || [])) if (m && m.id) got.set(str(m.id), metaOf(m));
      }
      return want.map((id) => got.get(id)).filter(Boolean);
    },

    /* 첨부 바이트(인라인 base64) — { files, errors, missing }. 큰 파일은 서버가 조용히 건너뛰므로 던지지 않고 missing·errors 로 알린다.
     * meta(attachmentMeta 결과)를 주면 다시 묻지 않는다. 받을 첨부가 없는 메일은 묻지도 않는다 */
    async downloadAll(c, ids, { meta = null } = {}) {
      const want = uniq(ids);
      const files = [];
      const errors = [];
      const missing = [];
      if (!want.length) return { files, errors, missing };
      const metas = meta ? [].concat(meta) : await impl.attachmentMeta(c, want);
      const atts = new Map(metas.filter(Boolean).map((m) => [str(m.id), [].concat(m.attachments || []).map(attOf)]));
      const ask = [];
      for (const id of want) {
        if (!atts.has(id)) errors.push(`첨부 목록을 받지 못해 건너뜀: ${id}`);
        else if (atts.get(id).some(isFileAttachment)) ask.push(id);
      }
      for (const part of chunks(ask, DOWNLOAD_CHUNK)) {
        let j;
        try { j = await call(c, TOOLS.download, { message_attachment_ids: part, save_file: false, include_body: false, convert_to_txt: false, skip_duplicates: false }); }
        catch (e) { const d = describe(e); if (d.kind !== 'tool') throw e; errors.push(d.message); j = {}; }
        for (const x of [].concat(j.errors || [])) errors.push(flat(x));
        for (const id of part) {
          const byName = new Map();   // 이름 → 돌아온 바이트들(Graph 차례)
          for (const x of [].concat(j.attachment_contents || [])) {
            if (str(x && x.message_id) !== id) continue;
            const n = str(x.original_name);
            if (!byName.has(n)) byName.set(n, []);
            byName.get(n).push(x);
          }
          // 바이트가 올 수 있는 첨부 전부(인라인 포함)와 차례로 짝짓는다 — 같은 이름의 인라인 그림과 파일이 섞여도 어긋나지 않게
          for (const a of atts.get(id).filter((a) => !a.odataType || a.odataType === FILE_ATTACHMENT)) {
            const x = (byName.get(a.name) || []).shift() || null;
            if (!isFileAttachment(a)) continue;
            let bytes = null;
            if (x && x.content_bytes) { try { bytes = bytesOf(x.content_bytes); } catch (e) { bytes = null; } }
            if (bytes) files.push({ messageId: id, attachmentId: a.id, name: a.name, contentType: a.contentType || str(x.content_type) || 'application/octet-stream', size: bytes.length, bytes });
            else {
              missing.push({ messageId: id, attachmentId: a.id, name: a.name, size: a.size });
              errors.push(`${a.name}: 서버가 바이트를 주지 않았습니다(큰 파일) — 서버에 저장으로 받으세요`);
            }
          }
        }
      }
      return { files, errors, missing };
    },

    /* 큰 첨부의 대체 길 — 첨부 ID 쌍은 save_file 과 상관없이 서버 PC 에 저장되고 경로만 온다. pairs 는 {message_id, attachment_id} 나 {messageId, attachmentId}.
     * results[] 는 서버 필드(message_id·attachment_id·name·file_path·folder_path·success·error) 그대로에 camelCase(messageId·attachmentId·filePath·folderPath)를 더한다 */
    async saveOnServer(c, pairs, dir = 'downloads/mailtrack') {
      const list = [].concat(pairs || []).filter(Boolean)
        .map((p) => ({ message_id: str(p.message_id || p.messageId), attachment_id: str(p.attachment_id || p.attachmentId) }))
        .filter((p) => p.message_id && p.attachment_id);
      if (!list.length) return { results: [], errors: [] };
      const j = await call(c, TOOLS.download, { message_attachment_ids: list, save_file: true, storage_type: 'local', save_directory: dir, flat_folder: false });
      const results = [].concat(j.results || []).filter(Boolean).map((r) => ({
        ...r, messageId: str(r.message_id), attachmentId: str(r.attachment_id), filePath: str(r.file_path), folderPath: str(r.folder_path), success: !!r.success,
      }));
      return { results, errors: [].concat(j.errors || []).map(flat) };
    },
  };

  /* 세션 하나에 묶인 api — run(fn) 의 fn 이 받는 것 */
  const bound = (c) => {
    const api = {
      probe: () => impl.probe(c),
      listSent: (o) => impl.listSent(c, o),
      fetchDetails: (ids) => impl.fetchDetails(c, ids),
      fetchInbox: (o) => impl.fetchInbox(c, o),
      attachmentMeta: (ids) => impl.attachmentMeta(c, ids),
      downloadAll: (ids, o) => impl.downloadAll(c, ids, o),
      saveOnServer: (pairs, dir) => impl.saveOnServer(c, pairs, dir),
      run: (fn) => fn(api),   // 안에서 다시 run 해도 같은 세션
    };
    return api;
  };

  return {
    /* 오류 풀이 — 주입받아 쓰는 쪽(sync.js)이 이 파일을 import 하지 않고도 auth·notool 판정을 같게 하라고 객체에도 단다 */
    describe,
    /* 서버 확인: tools/list 로 필요한 도구가 다 있는지. 꺼져 있으면 던진다(describe 로 offline) */
    async probe() {
      const r = await probeMcp(urlNow(), opts());
      return summarize(r && r.server, r && r.tools);
    },
    run: (fn) => session((c) => fn(bound(c))),
    listSent: (o) => session((c) => impl.listSent(c, o)),
    fetchDetails: (ids) => session((c) => impl.fetchDetails(c, ids)),
    fetchInbox: (o) => session((c) => impl.fetchInbox(c, o)),
    attachmentMeta: (ids) => session((c) => impl.attachmentMeta(c, ids)),
    downloadAll: (ids, o) => session((c) => impl.downloadAll(c, ids, o)),
    saveOnServer: (pairs, dir) => session((c) => impl.saveOnServer(c, pairs, dir)),
  };
}
