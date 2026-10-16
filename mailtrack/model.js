// 메일 수신(회신 추적)의 장부 꼴과 순수 로직 — 등록한 보낸 메일(TrackedItem)·받는 사람에서 뽑은 기대 키(Expect)·상태(N/M)·양식 가리기·갱신 조회 창.
//
// 2026-10-15 사용자 지정: "내가 보낸 메일에서 받는사람 참조자 또는 메일주소가 도메인이 같은 경우 이를 식별해서 등록 … 같은 도메인 메일 수신이
// 보낸 거랑 같으면 완료 … 이 숫자를 관리". 그래서 받는 사람을 **도메인 하나 = 기대 키 하나**로 묶고(외부 회사는 누가 답하든 그 회사가
// 답한 것), 내 도메인(krs.co.kr)은 같은 회사 사람끼리 묶으면 다 한 키가 돼 버리므로 기본으로 **주소마다** 따로 센다(ownByAddress, 설정에서 끔).
// 그 숫자가 status 의 responded/expected 이고, 다 차면 done(완료).
// 같은 날 사용자 지정 "참조는 추적을 하지 않아. 받는 사람 뿐이야." — 받을 곳은 **받는 사람(To)에서만** 세운다. 참조(CC)는 항목에 남겨 보이기만 하고
// 기대 키가 되지 않으며, 참조로만 받은 사람의 답은 키가 없어 "대상 아님"(match.js keyOf)이다. v1 장부의 참조에서 세운 받을 곳은 normalizeBook 이 지운다.
//
// 여기는 chrome·IndexedDB·네트워크를 모른다 — 장부 읽고 쓰기는 store/book.js, 본문·첨부 바이트는 store/vault.js, 부르는 순서는 sync.js.
// 회신을 어느 항목·어느 키에 잇는지(분류·점수·연결·수동 덮어쓰기)는 match.js.
//
//   Book        = { v, me, settings, items: TrackedItem[], syncedUntil, lastSync:{ at, ok, error, fetched, linked, kind } }
//   TrackedItem = { id(보낸 메일 messageId), conversationId, internetMessageId, subject, subjectKey, sentAt, registeredAt, webLink, from, to, cc,
//                   expect: Expect[], replies: Reply[], attachments, templates, status:{ expected, responded, excluded, done }, synced, closed, note }
//   Reply       = { id, from, key, receivedAt, subject, conversationId, hasAttachments, kind, score, counted, manual, attachments, bodyStored, webLink,
//                   review('pending' 확인 필요 · 'accepted' 수락 · 'rejected' 거부), reviewedAt }
//   (꼴의 원본은 계획서 3.2 — 병렬 작업의 계약이라 이름을 바꾸지 않는다. lastSync.kind 는 덧붙인 것: 마지막 실패의 갈래(auth·offline…)를 패널이 다시 열었을 때도 말하려고.
//    review·reviewedAt 도 덧붙인 것(2026-10-15 사용자 지정 "받은거 accept 할지 거부할지") — 사람이 회신을 보고 수락(센다)·거부(세지 않고 그 받을 곳은 다시 기다림)한다.)

/** 장부의 chrome.storage 키 — store/book.js 의 BOOK_KEY 와 같은 값(서로 import 하지 않는다). */
export const BOOK_KEY = 'mailtrackBook';
/** 장부 꼴의 판. 2 = 받을 곳을 받는 사람(To)에서만 세운다 — v1 장부의 참조(CC)에서 세운 받을 곳은 읽을 때 지운다(normalizeBook). */
export const BOOK_VERSION = 2;
/**
 * 설정 기본값. sentDays: 등록 대화의 보낸 메일 기간 · windowDays: 갱신 조회를 이보다 앞으로는 넓히지 않는다(오래 열어 둔 항목 하나가 매번 석 달치를 긁지 않게)
 * · ownByAddress: 내 도메인 받는 사람은 주소마다 센다 · useHeaders: 받은 메일의 internetMessageHeaders(In-Reply-To·References·Auto-Submitted)도 받아 본다
 * · autoRefreshMin: 탭을 열 때 마지막 갱신이 이만큼 지났으면 저절로 새로 고친다(0 이면 안 함)
 * · requireAccept: 켜면 회신이 와도 사람이 수락해야 센다(받을 곳이 완료가 된다). 끄면(기본) 회신이 오면 바로 세고, 거부로 되돌린다.
 */
export const DEFAULTS = Object.freeze({ mcpUrl: 'http://localhost:5001/mcp', userEmail: '', sentDays: 30, windowDays: 90, ownByAddress: true, useHeaders: false, autoRefreshMin: 10, requireAccept: false });

export const EXPECT_STATES = ['open', 'done', 'excluded'];
export const REPLY_KINDS = ['reply', 'auto', 'ndr', 'candidate'];
/** 회신의 확인 상태 — pending(새로 이어짐, 사람이 아직 안 봄) · accepted(수락 — 센다) · rejected(거부 — 세지 않는다). */
export const REVIEW_STATES = ['pending', 'accepted', 'rejected'];
export const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const arr = (x) => (Array.isArray(x) ? x : []);
const str = (x) => (typeof x === 'string' ? x : x == null ? '' : typeof x === 'number' ? String(x) : '');
const lower = (x) => str(x).trim().toLowerCase();
const num = (x, d = 0) => (Number.isFinite(+x) && x !== '' && x !== null ? +x : d);
const intIn = (x, lo, hi, d) => { const n = Math.round(num(x, NaN)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
const uniqBy = (list, k) => { const seen = new Set(); return list.filter((x) => (seen.has(x[k]) ? false : (seen.add(x[k]), true))); };

/** 시각 → 'YYYY-MM-DDTHH:mm:ssZ'(밀리초 없이 — MCP 서버의 날짜 거르기가 받는 꼴). 숫자(ms)·Date·ISO 글 모두 받고, 못 읽으면 ''. */
export function isoTime(x) {
  const ms = x instanceof Date ? x.getTime() : typeof x === 'number' ? x : Date.parse(str(x));
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
/** ISO 글 → ms. 못 읽으면 NaN(비교가 모두 false 가 되어 '맞지 않음' 쪽으로 떨어진다). */
export const timeOf = (x) => (typeof x === 'number' ? x : x instanceof Date ? x.getTime() : Date.parse(str(x)));

/** 주소 하나 — Graph 의 {emailAddress:{name,address}} 와 어댑터가 벗긴 {name,address}, 맨 글자 주소 모두 받는다. 주소는 소문자. */
export function toAddr(x) {
  if (typeof x === 'string') return { name: '', address: lower(x) };
  const o = obj(x);
  const e = o.emailAddress && typeof o.emailAddress === 'object' ? o.emailAddress : o;
  return { name: str(e.name).trim(), address: lower(e.address) };
}
const addrs = (list) => uniqBy(arr(list).map(toAddr).filter((a) => a.address), 'address');

/** 주소의 도메인 — 마지막 @ 뒤, 소문자. @ 가 없으면 ''(Exchange 의 X500 주소 같은 것). */
export function domainOf(address) {
  const a = lower(address);
  const i = a.lastIndexOf('@');
  return i < 0 ? '' : a.slice(i + 1);
}

// 제목 머리표 — 회신·전달 표시(RE:·FW:·회신:·전달:… 와 RE[2]: 꼴)와 메일 게이트웨이가 붙이는 [외부]·[EXTERNAL]·[SPAM] 꼴.
// 한 번에 하나씩 반복해 뗀다("RE: [외부] FW: 제목" 처럼 섞여 쌓인다). 전각 콜론(：)도 Outlook 한국어판에서 보인다.
const SUBJECT_HEAD = /^\s*(?:(?:re|fw|fwd|aw|wg|sv|답장|회신|전달)\s*(?:\[\d+\])?\s*[:：]|\[\s*(?:외부|외부\s*메일|external|ext|spam|스팸)\s*\]|\(\s*(?:외부|external)\s*\))\s*/i;
/** 견주기용 제목 — 머리표를 반복해 떼고 공백을 접고 소문자. 회신 제목이 보낸 제목과 같은지(점수 2)·포함하는지(점수 1) 보는 데 쓴다. */
export function normalizeSubject(s) {
  let x = str(s).replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 32; i++) {
    const y = x.replace(SUBJECT_HEAD, '');
    if (y === x) break;
    x = y;
  }
  return x.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 받는 사람(To) → 기대 키. me(글 또는 글 목록 — 나와 내 별칭)와 빈 주소·겹친 주소는 뺀다. 첫 등장 차례를 지킨다.
 * 참조(CC)는 받지 않는다 — 2026-10-15 사용자 지정 "참조는 추적을 하지 않아. 받는 사람 뿐이야." (newItem 은 cc 를 항목에 남겨 보이기만 한다).
 * 외부 도메인은 도메인 하나가 키 하나(같은 회사 여러 명은 addresses 로 모은다 — 그 회사 누구든 답하면 완료).
 * 내 도메인은 ownByAddress(기본 켬)면 주소마다 'addr:<주소>' — 같은 회사 사람끼리는 각자 답해야 하는 일이 대부분이라서.
 * 도메인이 없는 주소(X500 등)도 주소 키로 둔다(도메인 '' 로 묶으면 서로 다른 사람이 한 키가 된다).
 */
export function expectOf({ to = [], me = '', ownByAddress = true } = {}) {
  const mine = new Set((Array.isArray(me) ? me : [me]).map(lower).filter(Boolean));
  const myDomain = domainOf([...mine][0] || '');
  const out = [];
  const byKey = new Map();
  const seen = new Set();
  for (const a of arr(to).map(toAddr)) {
    if (!a.address || mine.has(a.address) || seen.has(a.address)) continue;
    seen.add(a.address);
    const d = domainOf(a.address);
    const own = !d || (myDomain && d === myDomain && ownByAddress !== false);
    const key = own ? `addr:${a.address}` : d;
    const e = byKey.get(key);
    if (e) { e.addresses.push(a.address); continue; }
    const next = { key, kind: own ? 'address' : 'domain', label: own ? a.name || a.address : d, addresses: [a.address], state: 'open', manual: false, doneAt: '', by: '' };
    byKey.set(key, next);
    out.push(next);
  }
  return out;
}

/** 병합할 수 있는 양식인가 — .xlsx·.docx 만(옛 .xls·.doc 은 ZIP 이 아니라 못 합치고, .xlsm·.docm 은 매크로 형식이라 결과 이름·형식이 어긋난다). Office 임시 파일(~$…)은 아니다. */
export function templateKind(name) {
  const n = lower(name).replace(/^.*[\\/]/, '');
  if (!n || n.startsWith('~$')) return null;
  if (n.endsWith('.xlsx')) return 'xlsx';
  if (n.endsWith('.docx')) return 'docx';
  return null;
}

/** 바이트를 받을 수 있는 첨부인가 — 본문 속 그림(isInline)과 첨부한 메일(itemAttachment)·링크(referenceAttachment)는 바이트가 없다. 갈래를 모르면 받아 본다. */
export function downloadable(att) {
  const a = obj(att);
  if (a.isInline === true) return false;
  const t = str(a.odataType || a['@odata.type']);
  return !t || /fileAttachment$/i.test(t);
}

function normalizeAtt(raw) {
  const o = obj(raw);
  const id = str(o.id);
  if (!id) return null;
  const a = { id, name: str(o.name), contentType: str(o.contentType), size: num(o.size), isInline: o.isInline === true, odataType: str(o.odataType || o['@odata.type']), stored: o.stored === true, missing: o.missing === true };
  if (str(o.serverPath)) a.serverPath = str(o.serverPath);
  return a;
}
/** 첨부 목록 — 본문 속 그림은 문서가 아니라 뺀다(서명 그림이 회신마다 붙어 "첨부 3" 으로 보이지 않게). */
export const attachmentsOf = (list) => uniqBy(arr(list).map(normalizeAtt).filter((a) => a && !a.isInline), 'id');

function normalizeExpect(raw) {
  const o = obj(raw);
  const key = lower(o.key);
  if (!key) return null;
  const address = key.startsWith('addr:');
  return {
    key, kind: address ? 'address' : 'domain', label: str(o.label) || (address ? key.slice(5) : key),
    addresses: [...new Set(arr(o.addresses).map(lower).filter(Boolean))],
    state: EXPECT_STATES.includes(o.state) ? o.state : 'open', manual: o.manual === true, doneAt: str(o.doneAt), by: lower(o.by),
  };
}

/** 회신 하나의 꼴. 키가 없으면 null("대상 아님" — 받는 사람에 없던 사람이 답했다). review 가 없거나 모르는 값이면 pending(옛 장부의 회신은 확인 필요로 선다). */
export function normalizeReply(raw) {
  const o = obj(raw);
  const id = str(o.id);
  if (!id) return null;
  const key = lower(o.key);
  return {
    id, from: toAddr(o.from), key: key || null, receivedAt: str(o.receivedAt), subject: str(o.subject), conversationId: str(o.conversationId),
    hasAttachments: o.hasAttachments === true, kind: REPLY_KINDS.includes(o.kind) ? o.kind : 'reply', score: intIn(o.score, 0, 3, 0),
    counted: o.counted === true, manual: o.manual === true, attachments: attachmentsOf(o.attachments), bodyStored: o.bodyStored === true, webLink: str(o.webLink),
    review: REVIEW_STATES.includes(o.review) ? o.review : 'pending', reviewedAt: str(o.reviewedAt),
  };
}

function normalizeTemplate(raw) {
  const o = obj(raw);
  const attachmentId = str(o.attachmentId);
  const kind = o.kind === 'xlsx' || o.kind === 'docx' ? o.kind : templateKind(o.name);
  if (!attachmentId || !kind) return null;
  return { attachmentId, name: str(o.name), kind, stored: o.stored === true };
}

/** 항목 하나의 꼴(없는 칸은 기본값, status 는 다시 셈). id 가 없으면 null. subjectKey 는 늘 다시 만든다 — 제목 규칙이 바뀌어도 장부가 따라오게. */
export function normalizeItem(raw) {
  const o = obj(raw);
  const id = str(o.id);
  if (!id) return null;
  const subject = str(o.subject);
  return withStatus({
    id, conversationId: str(o.conversationId), internetMessageId: str(o.internetMessageId), subject, subjectKey: normalizeSubject(subject),
    sentAt: str(o.sentAt), registeredAt: str(o.registeredAt), webLink: str(o.webLink),
    from: toAddr(o.from), to: addrs(o.to), cc: addrs(o.cc),
    expect: uniqBy(arr(o.expect).map(normalizeExpect).filter(Boolean), 'key'),
    replies: uniqBy(arr(o.replies).map(normalizeReply).filter(Boolean), 'id'),
    attachments: attachmentsOf(o.attachments),
    templates: uniqBy(arr(o.templates).map(normalizeTemplate).filter(Boolean), 'attachmentId'),
    status: null, synced: o.synced === true, closed: o.closed === true, note: str(o.note),
  });
}

export function normalizeSettings(raw) {
  const o = obj(raw);
  return {
    mcpUrl: str(o.mcpUrl).trim() || DEFAULTS.mcpUrl,
    userEmail: lower(o.userEmail),
    sentDays: intIn(o.sentDays, 1, 365, DEFAULTS.sentDays),
    windowDays: intIn(o.windowDays, 1, 3650, DEFAULTS.windowDays),
    ownByAddress: o.ownByAddress !== false,
    useHeaders: o.useHeaders === true,
    autoRefreshMin: intIn(o.autoRefreshMin, 0, 1440, DEFAULTS.autoRefreshMin),
    requireAccept: o.requireAccept === true,
  };
}

/**
 * v1 장부의 항목 → 받을 곳을 받는 사람(To)에서만 남긴다(참조는 추적하지 않는다 — 2026-10-15 사용자 지정). 받을 곳마다 주소를 To 의 것만 남기고 빈 곳은 지우며,
 * 지운 곳에 이어졌던 회신은 키를 떼어 "대상 아님"(세지 않음)으로 둔다. To 를 모르는 항목(빈 목록)은 가를 수 없어 그대로 둔다. 두 번 해도 같다.
 */
function toOnlyExpect(item) {
  const to = new Set(item.to.map((a) => a.address));
  if (!to.size) return item;
  const expect = item.expect.map((e) => ({ ...e, addresses: e.addresses.filter((a) => to.has(a)) })).filter((e) => e.addresses.length);
  const keys = new Set(expect.map((e) => e.key));
  const replies = item.replies.map((r) => (r.key === null || keys.has(r.key) ? r : { ...r, key: null, counted: false }));
  return withStatus({ ...item, expect, replies });
}

/**
 * 장부 꼴 맞추기 — 없거나 깨진 것은 기본값, 같은 id 의 항목은 앞의 것만, 항목마다 status 를 다시 센다. 두 번 불러도 같다(store/book.js 가 읽을 때·쓸 때 부른다).
 * 판(v)이 2 보다 낮은 장부(없으면 1)는 참조에서 세운 받을 곳을 지우고(toOnlyExpect) 판을 올린다.
 */
export function normalizeBook(raw) {
  const o = obj(raw);
  const ls = obj(o.lastSync);
  const upgrade = num(o.v, 1) < 2 ? toOnlyExpect : (it) => it;
  return {
    v: BOOK_VERSION,
    me: lower(o.me),
    settings: normalizeSettings(o.settings),
    items: uniqBy(arr(o.items).map(normalizeItem).filter(Boolean).map(upgrade), 'id'),
    syncedUntil: str(o.syncedUntil),
    lastSync: { at: num(ls.at), ok: ls.ok === true, error: str(ls.error), fetched: num(ls.fetched), linked: num(ls.linked), kind: str(ls.kind) },
  };
}

/**
 * 보낸 메일 하나 → 새 항목. full 은 등록 상세(mail_query_if_emaidID — To·CC·conversationId 가 여기만 있다), meta 는 mail_attachment_meta(첨부 목록).
 * 기대 키는 받는 사람(To)에서만 — cc 는 항목에 남겨 상세에 보이기만 한다(참조는 추적하지 않는다). me 와 이 메일의 보낸 주소를 함께 뺀다
 * (다른 별칭으로 보냈어도 나는 기다릴 사람이 아니다). 양식은 내 첨부 중 xlsx·docx — 받은 바이트로 병합한다(stored 는 금고에 넣은 뒤 sync 가 켠다).
 */
export function newItem(full, meta, { me = '', now = Date.now(), ownByAddress = true } = {}) {
  const f = obj(full);
  const from = toAddr(f.from);
  const to = addrs(f.to);
  const cc = addrs(f.cc);
  const attachments = attachmentsOf(meta ? obj(meta).attachments : []).map((a) => ({ ...a, stored: false, missing: false }));
  const templates = attachments.filter((a) => downloadable(a) && templateKind(a.name)).map((a) => ({ attachmentId: a.id, name: a.name, kind: templateKind(a.name), stored: false }));
  const subject = str(f.subject);
  return withStatus({
    id: str(f.id), conversationId: str(f.conversationId), internetMessageId: str(f.internetMessageId), subject, subjectKey: normalizeSubject(subject),
    sentAt: str(f.sentAt) || str(f.receivedAt), registeredAt: isoTime(now), webLink: str(f.webLink),
    from, to, cc,
    expect: expectOf({ to, me: [lower(me), from.address].filter(Boolean), ownByAddress }),
    replies: [], attachments, templates, status: null, synced: false, closed: false, note: '',
  });
}

/** 숫자 — expected: 빼지 않은 키 수, responded: 그중 완료, excluded: 뺀 키 수, done: 기다릴 키가 있고 다 찼다. 배지는 responded/expected, done 이면 "완료". */
export function statusOf(item) {
  const ex = arr(obj(item).expect);
  const live = ex.filter((e) => e && e.state !== 'excluded');
  const expected = live.length;
  const responded = live.filter((e) => e.state === 'done').length;
  return { expected, responded, excluded: ex.length - expected, done: expected > 0 && responded === expected };
}
export const withStatus = (item) => ({ ...item, status: statusOf(item) });

/** 아직 기다리는 항목인가 — 닫지 않았고 완료가 아니다. */
export const isOpen = (item) => !!item && !item.closed && !statusOf(item).done;

/**
 * 받은 메일 갱신 조회의 시작점. 열린 항목마다 기준 = 한 번 조회했으면(synced) 장부의 syncedUntil, 아니면 그 메일을 보낸 때.
 * 그중 가장 이른 것에서 1시간 앞(서버 시각·배달 지연으로 경계에 걸린 메일을 놓치지 않게 — 겹친 것은 이미 이어진 id 라 건너뛴다),
 * 단 now − windowDays 보다 이르지 않게. 열린 항목이 없으면 null(조회하지 않는다).
 * all: true 면(sync 의 refresh({force})) 닫지 않은 모든 항목을 보낸 때부터 다시 훑는다 — 놓친 회신 찾기.
 */
export function sinceOf(book, now, { all = false } = {}) {
  const b = obj(book);
  const nowMs = timeOf(now ?? Date.now());
  const windowDays = intIn(obj(b.settings).windowDays, 1, 3650, DEFAULTS.windowDays);
  const until = timeOf(b.syncedUntil);
  let min = Infinity;
  for (const it of arr(b.items)) {
    if (!it || it.closed || (!all && statusOf(it).done)) continue;
    const base = !all && it.synced && Number.isFinite(until) ? until : timeOf(it.sentAt);
    min = Math.min(min, Number.isFinite(base) ? base : -Infinity);
  }
  if (min === Infinity) return null;
  const floor = nowMs - windowDays * DAY_MS;
  return isoTime(Math.max(min - HOUR_MS, floor));
}

/** 로컬 날짜 'YYYY-MM-DD'. */
function ymdOf(x) {
  const ms = timeOf(x);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 병합 결과에 적는 출처 — org · name <address> · date. org 는 그 회신이 채운 도메인 키, 주소 키(내 도메인)나 키가 없으면 보낸 주소의 도메인,
 * 도메인도 없으면 주소 그대로.
 */
export function sourceOf(reply) {
  const r = obj(reply);
  const from = toAddr(r.from);
  const key = lower(r.key);
  const org = key && !key.startsWith('addr:') ? key : domainOf(from.address) || from.address;
  return { org, name: from.name, address: from.address, date: ymdOf(r.receivedAt) };
}
