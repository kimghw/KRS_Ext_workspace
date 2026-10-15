// 메일 수신(회신 추적)의 오케스트레이션(mailtrack/sync.js) — 등록(상세 → 첨부 목록 → 바이트, 금고·장부·book.me)·갱신(조회 창·나 제외·새로 이어진 것만 본문/첨부·
// syncedUntil·오류는 던지지 않고 lastSync 로·대체 도구)·수동 조작·서버에 저장·병합 호출·지우기·설정. outlook·book·vault·merge 는 여기서 만든 가짜다
// (mcp/outlook.js·store/*·ooxml/* 를 import 하지 않는다 — 병렬 작업의 계약). 가짜의 꼴은 계약서 3.3 과 U1 어댑터의 실제 동작(downloadAll 의 missing·
// attachmentId, describe)을 따른다. 네트워크 없음.
import assert from 'node:assert/strict';

import { createSync, describeError } from '../sync.js';
import { normalizeBook, sourceOf, templateKind } from '../model.js';

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const ME = 'me@krs.co.kr';
const A = (address, name = '') => ({ name, address });
const clone = (x) => (x === undefined ? undefined : structuredClone(x));
const FILE = '#microsoft.graph.fileAttachment';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ── 가짜들 ──────────────────────────────────────────────────────────────
/** store/book.js 와 같은 약속: load 는 꼴 맞춘 것, update(fn) 는 줄 세워 fn(지금 장부) → 고친 것(또는 돌려준 새 장부)을 꼴 맞춰 쓴다. */
function fakeBook(initial) {
  let state = clone(initial);
  let tail = Promise.resolve();
  let busy = false;
  return {
    get state() { return state; },
    async load() { return normalizeBook(clone(state)); },
    async save(b) { state = clone(b); return b; },
    update(fn) {
      const run = tail.then(async () => {
        assert.equal(busy, false, 'update 안에서 update 를 부르면 줄이 막힌다');
        busy = true;
        try {
          const cur = normalizeBook(clone(state));
          const out = await fn(cur);
          state = clone(normalizeBook(out == null ? cur : out));
          return normalizeBook(clone(state));
        } finally { busy = false; }
      });
      tail = run.catch(() => {});
      return run;
    },
    onChange: () => () => {},
  };
}
/** store/vault.js 와 같은 약속(메모리). 바이트는 Uint8Array 만 받는다. */
function fakeVault() {
  const bodies = new Map();
  const files = new Map();
  const removed = [];
  const k = (...p) => p.join('\u0001');
  return {
    bodiesMap: bodies, filesMap: files, removed,
    async putBody(rec) { bodies.set(k(rec.itemId, rec.messageId), { ...rec }); return rec; },
    async getBody(i, m) { return bodies.get(k(i, m)) || null; },
    async bodies(i) { return [...bodies.values()].filter((v) => v.itemId === i); },
    async putFile(rec) {
      if (!(rec.bytes instanceof Uint8Array)) throw new Error('바이트가 Uint8Array 가 아닙니다');
      files.set(k(rec.itemId, rec.messageId, rec.attachmentId), { ...rec });
      return rec;
    },
    async getFile(i, m, a) { return files.get(k(i, m, a)) || null; },
    async files(i) { return [...files.values()].filter((v) => v.itemId === i); },
    async removeItem(i) {
      removed.push(i);
      let n = 0;
      for (const map of [bodies, files]) for (const key of [...map.keys()]) if (key.startsWith(i + '\u0001')) { map.delete(key); n++; }
      return n;
    },
    async usage() { return { bodies: bodies.size, files: files.size, bytes: 0 }; },
  };
}
const PROBE_OK = { ok: true, server: { name: 'outlook' }, tools: ['mail_query_url', 'mail_query_if_emaidID', 'mail_attachment_meta', 'mail_attachment_download', 'test_handler', 'mail_fetch_filter'], has: { sent: true, details: true, meta: true, download: true, inbox: true, inboxFallback: true }, missing: [] };
/**
 * mcp/outlook.js createOutlook 결과와 같은 꼴. d: { sent, details{id:MailFull}, inbox, metas{id:MailMeta}, files, missing, dlErrors, saved, probe, fail{메서드:오류}, describe }.
 * downloadAll 은 어댑터처럼 meta 를 받으면 다시 묻지 않고, 큰 파일은 missing 과 errors 둘 다로 알린다.
 */
function fakeOutlook(d = {}) {
  const calls = [];
  let runs = 0;
  const boom = (name) => { if (d.fail?.[name]) throw d.fail[name]; };
  const api = {
    async probe() { calls.push(['probe']); boom('probe'); return clone(d.probe || PROBE_OK); },
    async listSent(o) { calls.push(['listSent', o]); boom('listSent'); return clone(d.sent || []); },
    async fetchDetails(ids) { calls.push(['fetchDetails', ids]); boom('fetchDetails'); return ids.map((id) => d.details?.[id]).filter(Boolean).map(clone); },
    async fetchInbox(o) { calls.push(['fetchInbox', o]); boom('fetchInbox'); return clone(d.inbox || []); },
    async attachmentMeta(ids) { calls.push(['attachmentMeta', ids]); boom('attachmentMeta'); return ids.map((id) => d.metas?.[id]).filter(Boolean).map(clone); },
    async downloadAll(ids, o) {
      calls.push(['downloadAll', ids, o]);
      boom('downloadAll');
      const missing = (d.missing || []).filter((m) => ids.includes(m.messageId));
      return { files: (d.files || []).filter((f) => ids.includes(f.messageId)).map(clone), errors: [...(d.dlErrors || []), ...missing.map((m) => `${m.name}: 서버가 바이트를 주지 않았습니다(큰 파일) — 서버에 저장으로 받으세요`)], missing: clone(missing) };
    },
    async saveOnServer(pairs, dir) { calls.push(['saveOnServer', pairs, dir]); boom('saveOnServer'); return clone(d.saved || { results: [], errors: [] }); },
  };
  const o = { calls, data: d, get runs() { return runs; }, reset() { calls.length = 0; runs = 0; }, async run(fn) { runs++; calls.push(['run']); return fn(api); }, ...api };
  if (d.describe) o.describe = d.describe;
  return o;
}
const names = (calls) => calls.map((c) => c[0]);
/** ooxml/merge.js 와 같은 꼴의 가짜 — 받은 인자를 남긴다. */
function fakeMerge() {
  const seen = [];
  return {
    seen,
    mergeKind: (n) => templateKind(n),
    mergedName: (subject, kind, date) => `${subject}_병합_${date.toISOString().slice(0, 10).replace(/-/g, '')}.${kind}`,
    async mergeOffice(args) { seen.push(args); return { bytes: new Uint8Array([9, 9]), mime: XLSX_MIME, report: { merged: args.replies.length, skipped: [], warnings: ['표 서식 제거'] } }; },
  };
}
const toolError = (kind, message, extra = {}) => Object.assign(new Error(message), { kind }, extra);

// ── 자료(가짜 주소만) ───────────────────────────────────────────────────
const SENT_AT = '2026-10-10T01:00:00Z';
const S1 = {
  id: 's1', subject: '2026 실적 자료 요청', from: A(ME, '나'), sender: A(ME), to: [A('kim@foo.com', '김'), A('lee@krs.co.kr', '이')], cc: [A('park@bar.org', '박')],
  sentAt: SENT_AT, receivedAt: SENT_AT, conversationId: 'conv-s1', internetMessageId: '<s1@krs.co.kr>', hasAttachments: true, isDraft: false,
  body: { contentType: 'html', content: '<p>양식을 채워 주세요</p>' }, preview: '양식을 채워 주세요', webLink: 'https://outlook/s1',
};
const S1_META = {
  id: 's1', subject: S1.subject, from: A(ME), to: S1.to, receivedAt: SENT_AT, hasAttachments: true, body: S1.body,
  attachments: [
    { id: 'tpl', name: '실적양식.xlsx', contentType: XLSX_MIME, size: 3, isInline: false, odataType: FILE },
    { id: 'big', name: '참고자료.pdf', contentType: 'application/pdf', size: 9e6, isInline: false, odataType: FILE },
    { id: 'img', name: 'image001.png', contentType: 'image/png', size: 10, isInline: true, odataType: FILE },
  ],
};
const S2 = { ...S1, id: 's2', subject: '회의 일정', to: [A('x@qux.net')], cc: [], conversationId: 'conv-s2', internetMessageId: '<s2@krs.co.kr>', hasAttachments: false, body: { contentType: 'text', content: '일정 문의' } };
const S2_META = { id: 's2', subject: S2.subject, from: A(ME), to: S2.to, receivedAt: SENT_AT, hasAttachments: false, body: S2.body, attachments: [] };
const TPL_BYTES = new Uint8Array([1, 2, 3]);
const REG = {
  details: { s1: S1, s2: S2 }, metas: { s1: S1_META, s2: S2_META },
  files: [{ messageId: 's1', attachmentId: 'tpl', name: '실적양식.xlsx', contentType: XLSX_MIME, size: 3, bytes: TPL_BYTES }],
  missing: [{ messageId: 's1', attachmentId: 'big', name: '참고자료.pdf', size: 9e6 }],
};

const NOW0 = Date.parse('2026-10-15T09:00:00Z');
const inboxMail = (id, from, extra = {}) => ({
  id, subject: 'RE: 2026 실적 자료 요청', from: typeof from === 'string' ? A(from) : from, sender: null, to: [A(ME)], cc: [], sentAt: '2026-10-11T00:00:00Z', receivedAt: '2026-10-11T00:00:00Z',
  conversationId: 'conv-s1', internetMessageId: `<${id}@x>`, hasAttachments: false, isDraft: false, preview: '', webLink: 'https://outlook/' + id, ...extra,
});
const INBOX = [
  inboxMail('r1', A('kim@foo.com', '김'), { hasAttachments: true }),
  inboxMail('r2', 'lee@krs.co.kr', { subject: '자동 회신: 2026 실적 자료 요청', receivedAt: '2026-10-10T02:00:00Z' }),
  inboxMail('r3', ME),
  inboxMail('r4', 'news@shop.com', { subject: '할인 안내', conversationId: 'conv-z' }),
];
const R_METAS = {
  r1: { id: 'r1', subject: 'RE: 2026 실적 자료 요청', from: A('kim@foo.com', '김'), to: [A(ME)], receivedAt: '2026-10-11T00:00:00Z', hasAttachments: true, body: { contentType: 'html', content: '<p>첨부합니다</p>' },
    attachments: [{ id: 'ra', name: '실적양식.xlsx', contentType: XLSX_MIME, size: 2, isInline: false, odataType: FILE }, { id: 'rbig', name: 'big.zip', contentType: 'application/zip', size: 9e7, isInline: false, odataType: FILE }, { id: 'rimg', name: 'sig.png', contentType: 'image/png', size: 1, isInline: true, odataType: FILE }] },
  r2: { id: 'r2', subject: '자동 회신: 2026 실적 자료 요청', from: A('lee@krs.co.kr'), to: [A(ME)], receivedAt: '2026-10-10T02:00:00Z', hasAttachments: false, body: { contentType: 'text', content: '부재 중입니다' }, attachments: [] },
};
const RA_BYTES = new Uint8Array([7, 7]);
const R_FILES = [{ messageId: 'r1', attachmentId: 'ra', name: '실적양식.xlsx', contentType: XLSX_MIME, size: 2, bytes: RA_BYTES }];
const R_MISSING = [{ messageId: 'r1', attachmentId: 'rbig', name: 'big.zip', size: 9e7 }];

/** 등록까지 마친 sync 하나(장부·금고·가짜 outlook 을 같이 돌려준다). extra.outlook 의 metas·files·missing 은 등록 자료(REG)에 더한다. */
async function registered(extra = {}) {
  const book = fakeBook(extra.book);
  const vault = fakeVault();
  const x = extra.outlook || {};
  const outlook = fakeOutlook({ ...x, details: { ...REG.details, ...x.details }, metas: { ...REG.metas, ...x.metas }, files: [...REG.files, ...(x.files || [])], missing: [...REG.missing, ...(x.missing || [])] });
  let nowMs = NOW0;
  const logs = [];
  const sync = createSync({ outlook, book, vault, merge: extra.merge ?? null, now: () => nowMs, log: (ok, text, data) => logs.push([ok, text, data]) });
  const reg = await sync.register(extra.ids || ['s1']);
  outlook.reset();
  return { sync, book, vault, outlook, reg, logs, setNow: (ms) => { nowMs = ms; } };
}

console.log('만들기');
await ta('createSync — 만들기만 해서는 아무것도 부르지 않는다, book() 은 기본 장부, load() 가 읽는다', async () => {
  const outlook = fakeOutlook();
  const book = fakeBook({ me: ME, settings: { sentDays: 7 } });
  const sync = createSync({ outlook, book, vault: fakeVault() });
  assert.deepEqual(outlook.calls, []);
  assert.deepEqual(sync.book(), normalizeBook(null));
  const b = await sync.load();
  assert.equal(b.me, ME);
  assert.equal(sync.book().settings.sentDays, 7);
});
t('describeError — kind·authUrl(auth_required) 를 지키고, 어댑터의 describe 가 있으면 그것을 쓰며, 글로 찍으면 message', () => {
  const e = toolError('tool', 'mail_query_url: 인증 필요', { payload: { status: 'auth_required', auth_url: 'https://login.example/x' } });
  const d = describeError(e);
  assert.deepEqual({ ...d }, { kind: 'auth', message: 'mail_query_url: 인증 필요', authUrl: 'https://login.example/x' });
  assert.equal(`${d}`, 'mail_query_url: 인증 필요');
  assert.deepEqual({ ...describeError(toolError('offline', '꺼짐')) }, { kind: 'offline', message: '꺼짐' });
  assert.deepEqual({ ...describeError('글') }, { kind: 'error', message: '글' });
  const viaAdapter = describeError(e, () => ({ kind: 'auth', message: 'Microsoft 로그인이 필요합니다', authUrl: '' }));
  assert.deepEqual({ ...viaAdapter }, { kind: 'auth', message: 'Microsoft 로그인이 필요합니다' }, '빈 authUrl 은 싣지 않는다');
  assert.deepEqual({ ...describeError(e, () => { throw new Error('x'); }) }, { ...d }, '어댑터 풀이가 깨지면 스스로');
});

console.log('등록');
await ta('register — 한 세션에서 상세 → 첨부 목록 → 바이트(받은 목록을 넘김), 이미 등록한 것은 건너뜀, 못 찾은 id 는 오류', async () => {
  const book = fakeBook();
  const vault = fakeVault();
  const outlook = fakeOutlook(REG);
  const sync = createSync({ outlook, book, vault, now: () => NOW0 });
  const r = await sync.register(['s1', 's2', 's1', 'ghost']);
  assert.equal(outlook.runs, 1, 'MCP 세션 하나');
  assert.deepEqual(names(outlook.calls), ['run', 'fetchDetails', 'attachmentMeta', 'downloadAll']);
  assert.deepEqual(outlook.calls[1][1], ['s1', 's2', 'ghost']);
  assert.deepEqual(outlook.calls[2][1], ['s1', 's2'], '첨부 목록은 찾은 메일만');
  assert.deepEqual(outlook.calls[3][1], ['s1'], '바이트는 받을 첨부가 있는 메일만');
  assert.deepEqual(outlook.calls[3][2].meta.map((m) => m.id), ['s1'], '이미 받은 첨부 목록을 넘겨 다시 묻지 않게');
  assert.deepEqual(r.added.map((it) => it.id), ['s1', 's2']);
  assert.deepEqual(r.skipped, []);
  // 큰 첨부는 "서버에 저장" 으로 받을 길이 있는 알림이라 오류가 아니라 주의(warnings) — 패널이 등록을 "오류 1" 로 붉게 보이지 않게.
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /큰 첨부 1개.*서버에 저장.*참고자료\.pdf/);
  assert.equal([...r.errors, ...r.warnings].filter((e) => e.includes('참고자료.pdf')).length, 1, '큰 파일 말은 한 번만');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /찾지 못했습니다: ghost/);
  assert.equal(r.error, undefined);

  const b = book.state;
  assert.equal(b.me, ME, '처음 등록 — 보낸 메일의 보낸 주소가 나');
  const it = b.items[0];
  assert.deepEqual(it.expect.map((e) => e.key), ['foo.com', 'addr:lee@krs.co.kr', 'bar.org']);
  assert.deepEqual(it.attachments.map((a) => [a.id, a.stored, a.missing]), [['tpl', true, false], ['big', false, true]], '인라인 그림은 빠지고, 큰 파일은 어댑터가 알린 대로 missing');
  assert.deepEqual(it.templates, [{ attachmentId: 'tpl', name: '실적양식.xlsx', kind: 'xlsx', stored: true }]);
  assert.deepEqual([it.registeredAt, it.synced, it.status.expected], ['2026-10-15T09:00:00Z', false, 3]);
  assert.deepEqual(b.items[1].expect.map((e) => e.key), ['qux.net']);

  const body = await vault.getBody('s1', 's1');
  assert.deepEqual([body.contentType, body.content, body.receivedAt, body.from.address], ['html', '<p>양식을 채워 주세요</p>', SENT_AT, ME]);
  assert.equal((await vault.getBody('s2', 's2')).content, '일정 문의');
  const f = await vault.getFile('s1', 's1', 'tpl');
  assert.deepEqual([f.name, f.contentType, f.bytes], ['실적양식.xlsx', XLSX_MIME, TPL_BYTES]);
  assert.equal(await vault.getFile('s1', 's1', 'big'), null);
  assert.deepEqual(sync.book(), normalizeBook(b), 'book() 은 쓴 장부');

  outlook.calls.length = 0;
  const again = await sync.register(['s1', 's2']);
  assert.deepEqual([again.added, again.skipped, again.errors, again.warnings], [[], ['s1', 's2'], [], []]);
  assert.deepEqual(outlook.calls, [], '이미 등록한 것만이면 MCP 를 부르지 않는다');
});
await ta('register — book.me 가 있으면 바꾸지 않는다(다른 별칭으로 보낸 메일), 첨부 없는 메일은 바이트를 묻지 않는다', async () => {
  const book = fakeBook({ me: 'alias@krs.co.kr' });
  const outlook = fakeOutlook(REG);
  const sync = createSync({ outlook, book, vault: fakeVault(), now: () => NOW0 });
  const r = await sync.register(['s2']);
  assert.deepEqual(names(outlook.calls), ['run', 'fetchDetails', 'attachmentMeta']);
  assert.equal(book.state.me, 'alias@krs.co.kr');
  assert.deepEqual(r.added[0].expect.map((e) => e.key), ['qux.net']);
});
await ta('register — 통째 실패는 던지지 않고 errors 와 error(kind·authUrl), 장부는 그대로', async () => {
  const book = fakeBook();
  const outlook = fakeOutlook({ ...REG, fail: { fetchDetails: toolError('tool', '인증 필요', { payload: { status: 'auth_required', auth_url: 'https://login.example/a' } }) } });
  const sync = createSync({ outlook, book, vault: fakeVault(), now: () => NOW0 });
  const r = await sync.register(['s1']);
  assert.deepEqual([r.added, r.skipped, r.errors], [[], [], ['인증 필요']]);
  assert.deepEqual([r.error.kind, r.error.authUrl], ['auth', 'https://login.example/a']);
  assert.equal(book.state, undefined, '아무것도 쓰지 않았다');
});
await ta('register — 바이트 받기가 던져도 등록은 하고 그 첨부는 missing, 바이트가 Uint8Array 가 아니면(금고 거절) 저장 실패로', async () => {
  const outlook = fakeOutlook({ ...REG, fail: { downloadAll: toolError('timeout', '응답 없음') } });
  const sync = createSync({ outlook, book: fakeBook(), vault: fakeVault(), now: () => NOW0 });
  const r = await sync.register(['s1']);
  assert.deepEqual(r.added[0].attachments.map((a) => [a.id, a.stored, a.missing]), [['tpl', false, true], ['big', false, true]]);
  assert.deepEqual(r.added[0].templates[0].stored, false);
  assert.match(r.errors.join('\n'), /첨부 받기 실패: 응답 없음/);
  const bad = fakeOutlook({ ...REG, files: [{ ...REG.files[0], bytes: 'AQID' }] });
  const r2 = await createSync({ outlook: bad, book: fakeBook(), vault: fakeVault(), now: () => NOW0 }).register(['s1']);
  assert.deepEqual(r2.added[0].attachments[0].stored, false);
  assert.match(r2.errors.join('\n'), /첨부 저장 실패\(실적양식\.xlsx\)/);
});
await ta('listSent — 설정 기간(기본 30일)의 보낸 메일, 최근 것부터, 이미 등록한 것은 registered', async () => {
  const { sync, outlook } = await registered({ outlook: { sent: [{ id: 's1', subject: 'a', from: A(ME), receivedAt: '2026-10-10T01:00:00Z', preview: '' }, { id: 's9', subject: 'b', from: A(ME), receivedAt: '2026-10-14T01:00:00Z', preview: '' }, { subject: 'id 없음' }] } });
  const list = await sync.listSent();
  assert.deepEqual(list.map((h) => [h.id, h.registered]), [['s9', false], ['s1', true]]);
  assert.deepEqual(outlook.calls[0], ['listSent', { from: '2026-09-15T09:00:00Z', to: '2026-10-15T09:00:00Z' }]);
  await sync.listSent({ days: 7 });
  assert.equal(outlook.calls[1][1].from, '2026-10-08T09:00:00Z');
});

console.log('갱신');
await ta('refresh — 처음은 보낸 때 − 1시간부터, 나 제외; 이어진 회신만 첨부 목록·바이트(한 세션), 금고·장부·syncedUntil·lastSync', async () => {
  const { sync, book, vault, outlook, logs } = await registered({ outlook: { inbox: INBOX, metas: R_METAS, files: R_FILES, missing: R_MISSING } });
  const r = await sync.refresh();
  assert.deepEqual(r, { ok: true, fetched: 4, linked: 2, unmatched: 1, at: NOW0, warnings: [r.warnings[0]] });
  assert.match(r.warnings[0], /큰 첨부 1개.*big\.zip/);
  assert.equal(outlook.runs, 1);
  assert.deepEqual(names(outlook.calls), ['run', 'fetchInbox', 'attachmentMeta', 'downloadAll'], 'probe 를 안 했으면 따로 묻지 않는다');
  assert.deepEqual(outlook.calls[1][1], { since: '2026-10-10T00:00:00Z', top: 500, excludeFrom: [ME], useHeaders: false, fallback: false });
  assert.deepEqual(outlook.calls[2][1], ['r1', 'r2'], '내 메일(r3)·안 이어진 메일(r4)은 받지 않는다');
  assert.deepEqual(outlook.calls[3][1], ['r1']);

  const b = book.state;
  assert.equal(b.syncedUntil, '2026-10-15T09:00:00Z');
  assert.deepEqual(b.lastSync, { at: NOW0, ok: true, error: r.warnings[0], fetched: 4, linked: 2, kind: '' });
  const it = b.items[0];
  assert.equal(it.synced, true);
  assert.deepEqual(it.expect.map((e) => [e.key, e.state, e.by, e.doneAt]), [['foo.com', 'done', 'kim@foo.com', '2026-10-11T00:00:00Z'], ['addr:lee@krs.co.kr', 'open', '', ''], ['bar.org', 'open', '', '']]);
  assert.deepEqual(it.status, { expected: 3, responded: 1, excluded: 0, done: false });
  const r1 = it.replies.find((x) => x.id === 'r1');
  assert.deepEqual([r1.kind, r1.counted, r1.bodyStored, r1.hasAttachments], ['reply', true, true, true]);
  assert.deepEqual(r1.attachments.map((a) => [a.id, a.stored, a.missing]), [['ra', true, false], ['rbig', false, true]]);
  const r2 = it.replies.find((x) => x.id === 'r2');
  assert.deepEqual([r2.kind, r2.counted, r2.bodyStored, r2.attachments], ['auto', false, true, []]);
  assert.deepEqual((await vault.getFile('s1', 'r1', 'ra')).bytes, RA_BYTES);
  assert.equal((await vault.getBody('s1', 'r2')).content, '부재 중입니다');
  assert.deepEqual((await sync.bodies('s1')).map((x) => x.messageId).sort(), ['r1', 'r2', 's1']);
  assert.deepEqual((await sync.files('s1')).map((x) => x.attachmentId).sort(), ['ra', 'tpl']);
  assert.deepEqual(logs, [], '등록·갱신의 기록은 패널이 남긴다(한 일이 두 줄이 되지 않게)');
});
await ta('refresh — 두 번째는 syncedUntil − 1시간부터, 이미 이은 메일은 건너뛰고 새로 이어진 것만 본문을 받는다', async () => {
  const late = inboxMail('r5', 'park@bar.org', { conversationId: 'conv-other', subject: '[외부] RE: 2026 실적 자료 요청', receivedAt: '2026-10-15T09:30:00Z' });
  const ctx = await registered({ outlook: { inbox: INBOX, metas: { ...REG.metas, ...R_METAS, r5: { id: 'r5', from: A('park@bar.org'), body: { contentType: 'text', content: '보냅니다' }, attachments: [] } }, files: R_FILES } });
  await ctx.sync.refresh();
  ctx.outlook.calls.length = 0;
  ctx.setNow(NOW0 + 60 * 60 * 1000);
  const fake = fakeOutlook({ inbox: [...INBOX, late], metas: { r5: { id: 'r5', from: A('park@bar.org'), body: { contentType: 'text', content: '보냅니다' }, attachments: [] } } });
  Object.assign(ctx.outlook, { run: fake.run, calls: fake.calls });
  const r = await ctx.sync.refresh();
  assert.deepEqual([r.ok, r.fetched, r.linked, r.unmatched], [true, 5, 1, 1]);
  assert.equal(fake.calls[1][1].since, '2026-10-15T08:00:00Z');
  assert.deepEqual(names(fake.calls), ['run', 'fetchInbox', 'attachmentMeta'], '새 회신에 첨부가 없으면 바이트는 묻지 않는다');
  assert.deepEqual(fake.calls[2][1], ['r5']);
  const it = ctx.book.state.items[0];
  assert.deepEqual(it.replies.map((x) => x.id), ['r1', 'r2', 'r5']);
  assert.deepEqual([it.expect[2].state, it.expect[2].by], ['done', 'park@bar.org'], '제목+도메인(점수 2)으로도 센다');
  assert.equal(ctx.book.state.syncedUntil, '2026-10-15T10:00:00Z');
});
await ta('refresh — 수동 표시는 갱신이 되돌리지 않는다(사람이 뺀 회신·제외한 키)', async () => {
  const ctx = await registered({ outlook: { inbox: INBOX, metas: R_METAS, files: R_FILES } });
  await ctx.sync.refresh();
  await ctx.sync.counted('s1', 'r1', false);
  await ctx.sync.expect('s1', 'bar.org', 'excluded');
  const more = inboxMail('r6', 'park@bar.org', { receivedAt: '2026-10-15T09:10:00Z' });
  const fake = fakeOutlook({ inbox: [...INBOX, more], metas: { r6: { id: 'r6', from: A('park@bar.org'), body: { contentType: 'text', content: '.' }, attachments: [] } } });
  Object.assign(ctx.outlook, { run: fake.run });
  ctx.setNow(NOW0 + 30 * 60 * 1000);
  await ctx.sync.refresh();
  const it = ctx.book.state.items[0];
  assert.deepEqual(it.expect.map((e) => [e.key, e.state]), [['foo.com', 'open'], ['addr:lee@krs.co.kr', 'open'], ['bar.org', 'excluded']]);
  assert.deepEqual([it.replies.find((x) => x.id === 'r1').counted, it.replies.find((x) => x.id === 'r6').counted], [false, true]);
  assert.deepEqual(it.status, { expected: 2, responded: 0, excluded: 1, done: false });
});
await ta('refresh — 오류는 던지지 않는다: { ok:false, error:{kind,message,authUrl} }, lastSync 에 남고 syncedUntil·synced 는 그대로', async () => {
  const ctx = await registered({ outlook: { fail: { fetchInbox: toolError('offline', 'MCP 서버에 연결할 수 없습니다') } } });
  const r = await ctx.sync.refresh();
  assert.deepEqual([r.ok, r.fetched, r.linked, r.at, r.kind, r.error.kind, `${r.error}`], [false, 0, 0, NOW0, 'offline', 'offline', 'MCP 서버에 연결할 수 없습니다']);
  assert.deepEqual(ctx.book.state.lastSync, { at: NOW0, ok: false, error: 'MCP 서버에 연결할 수 없습니다', fetched: 0, linked: 0, kind: 'offline' });
  assert.deepEqual([ctx.book.state.syncedUntil, ctx.book.state.items[0].synced], ['', false]);
  assert.deepEqual(ctx.logs, [], '실패의 기록도 패널이 돌려받은 값으로 남긴다');

  const auth = await registered({ outlook: { fail: { fetchInbox: toolError('tool', 'test_handler: auth', { payload: { status: 'auth_required', auth_url: 'https://login.example/z' } }) } } });
  const ra = await auth.sync.refresh();
  assert.deepEqual([ra.ok, ra.kind, ra.authUrl, ra.error.kind, ra.error.authUrl], [false, 'auth', 'https://login.example/z', 'auth', 'https://login.example/z']);
  assert.equal(auth.book.state.lastSync.kind, 'auth');

  const adapter = await registered({ outlook: { fail: { fetchInbox: toolError('tool', 'Failed to acquire access token') }, describe: () => ({ kind: 'auth', message: 'Microsoft 로그인이 필요합니다', authUrl: '' }) } });
  const rd = await adapter.sync.refresh();
  assert.deepEqual([rd.kind, rd.error.message, 'authUrl' in rd], ['auth', 'Microsoft 로그인이 필요합니다', false], '어댑터의 describe 로 푼다(토큰 실패도 auth)');

  const broken = createSync({ outlook: fakeOutlook(), book: { load: async () => { throw new Error('저장소 없음'); }, update: async () => { throw new Error('저장소 없음'); } }, vault: fakeVault(), now: () => NOW0 });
  const rb = await broken.refresh();
  assert.deepEqual([rb.ok, rb.error.message], [false, '저장소 없음'], '장부를 못 읽어도 던지지 않는다');
});
await ta('refresh — 첨부 목록이 실패하면 이번 갱신을 접고(아무것도 잇지 않음) 다음 갱신이 같은 메일을 다시 잇는다', async () => {
  const ctx = await registered({ outlook: { inbox: INBOX, metas: R_METAS, files: R_FILES } });
  ctx.outlook.data.fail = { attachmentMeta: toolError('timeout', '느림') };
  const r = await ctx.sync.refresh();
  assert.deepEqual([r.ok, r.kind], [false, 'timeout']);
  assert.deepEqual([ctx.book.state.items[0].replies, ctx.book.state.syncedUntil], [[], '']);
  const fake = fakeOutlook({ inbox: INBOX, metas: R_METAS, files: R_FILES });
  Object.assign(ctx.outlook, { run: fake.run });
  const r2 = await ctx.sync.refresh();
  assert.deepEqual([r2.ok, r2.linked], [true, 2]);
  assert.equal(fake.calls[1][1].since, '2026-10-10T00:00:00Z', 'syncedUntil 이 그대로라 같은 창');
});
await ta('refresh — 바이트 받기가 던지면 잇기는 하고 그 첨부는 missing(서버에 저장 대상), 경고로 말한다', async () => {
  const ctx = await registered({ outlook: { inbox: INBOX, metas: R_METAS, files: R_FILES } });
  ctx.outlook.data.fail = { downloadAll: toolError('timeout', '느림') };
  const r = await ctx.sync.refresh();
  assert.deepEqual([r.ok, r.linked], [true, 2]);
  assert.match(r.warnings.join(), /첨부 받기 실패: 느림/);
  const r1 = ctx.book.state.items[0].replies.find((x) => x.id === 'r1');
  assert.deepEqual(r1.attachments.map((a) => [a.id, a.stored, a.missing]), [['ra', false, true], ['rbig', false, true]]);
  assert.equal(r1.bodyStored, true);
});
await ta('refresh — 기다리는 항목이 없으면 조회하지 않는다(lastSync 시각만), force 면 완료 항목도 보낸 때부터 다시 훑어 늦은 회신을 붙인다', async () => {
  const empty = createSync({ outlook: fakeOutlook(), book: fakeBook(), vault: fakeVault(), now: () => NOW0 });
  const r0 = await empty.refresh();
  assert.deepEqual(r0, { ok: true, fetched: 0, linked: 0, at: NOW0, idle: true });
  const ctx = await registered({ outlook: { inbox: INBOX, metas: R_METAS, files: R_FILES } });
  for (const k of ['foo.com', 'addr:lee@krs.co.kr', 'bar.org']) await ctx.sync.expect('s1', k, 'done');
  assert.equal(ctx.sync.book().items[0].status.done, true);
  const r1 = await ctx.sync.refresh();
  assert.equal(r1.idle, true);
  assert.deepEqual(ctx.outlook.calls, []);
  assert.deepEqual(ctx.book.state.lastSync, { at: NOW0, ok: true, error: '', fetched: 0, linked: 0, kind: '' });
  const r2 = await ctx.sync.refresh({ force: true });
  assert.deepEqual([r2.ok, r2.linked], [true, 2]);
  assert.equal(ctx.outlook.calls[1][1].since, '2026-10-10T00:00:00Z');
  assert.deepEqual(ctx.book.state.items[0].replies.map((x) => x.id), ['r1', 'r2'], '완료 뒤 온 회신도 붙는다');
});
await ta('refresh — 닫은 항목은 창에도 잇기에도 들지 않고, 그 회신 id 는 다른 항목에 다시 잇지 않는다', async () => {
  // s3 은 s1 과 같은 제목을 같은 회사에 조금 뒤에 다시 보낸 것 — r1(대화 id 는 s1)은 s3 에도 점수 2 로 맞는다.
  const S3 = { ...S1, id: 's3', to: [A('kim@foo.com')], cc: [], conversationId: 'conv-s3', internetMessageId: '<s3@krs.co.kr>', sentAt: '2026-10-10T12:00:00Z', hasAttachments: false };
  const ctx = await registered({ ids: ['s1', 's3'], outlook: { details: { s3: S3 }, metas: { ...R_METAS, s3: { ...S2_META, id: 's3' } }, inbox: INBOX, files: R_FILES } });
  const r0 = await ctx.sync.refresh();
  assert.deepEqual([r0.linked, ctx.book.state.items.map((it) => it.replies.map((x) => x.id))], [2, [['r1', 'r2'], []]], '점수 3(s1)이 2(s3)를 이긴다');
  await ctx.sync.close('s1');
  ctx.outlook.reset();
  const r = await ctx.sync.refresh({ force: true });
  assert.deepEqual([r.ok, r.linked], [true, 0], '닫힌 s1 에 이어진 r1·r2 는 s3 에 다시 잇지 않는다');
  assert.equal(ctx.outlook.calls.find((c) => c[0] === 'fetchInbox')[1].since, '2026-10-10T11:00:00Z', '닫힌 항목의 보낸 때는 창을 넓히지 않는다');
  assert.deepEqual(ctx.book.state.items.map((it) => [it.id, it.closed, it.replies.length]), [['s1', true, 2], ['s3', false, 0]]);
  await ctx.sync.close('s1', false);
  assert.equal(ctx.book.state.items[0].closed, false);
});
await ta('refresh — 겹쳐 부르면 같은 갱신 하나(세션 하나)', async () => {
  const ctx = await registered({ outlook: { inbox: INBOX, metas: R_METAS, files: R_FILES } });
  const [a, b] = await Promise.all([ctx.sync.refresh(), ctx.sync.refresh()]);
  assert.equal(a, b);
  assert.equal(ctx.outlook.runs, 1);
});
await ta('probe → 받은 메일 도구(test_handler)가 없다고 하면 갱신은 대체 도구(mail_fetch_filter)로, 설정에서 서버를 바꾸면 다시 본다', async () => {
  const ctx = await registered({ outlook: { inbox: INBOX, metas: R_METAS, files: R_FILES, probe: { ...PROBE_OK, ok: true, tools: ['mail_fetch_filter'], has: { ...PROBE_OK.has, inbox: false, inboxFallback: true } } } });
  const p = await ctx.sync.probe();
  assert.equal(p.has.inbox, false);
  await ctx.sync.refresh();
  assert.equal(ctx.outlook.calls.find((c) => c[0] === 'fetchInbox')[1].fallback, true);
  const b = await ctx.sync.settings({ mcpUrl: 'http://127.0.0.1:5001/mcp', windowDays: '30' });
  assert.deepEqual([b.settings.mcpUrl, b.settings.windowDays, ctx.book.state.settings.windowDays], ['http://127.0.0.1:5001/mcp', 30, 30]);
  ctx.outlook.calls.length = 0;
  await ctx.sync.refresh({ force: true });
  assert.equal(ctx.outlook.calls.find((c) => c[0] === 'fetchInbox')[1].fallback, false, '도구 목록을 잊었다');
});
await ta('probe — 실패는 던지지 않고 { ok:false, error, kind }', async () => {
  const sync = createSync({ outlook: fakeOutlook({ fail: { probe: toolError('offline', '꺼짐') } }), book: fakeBook(), vault: fakeVault() });
  const p = await sync.probe();
  assert.deepEqual([p.ok, p.kind, p.error.message, p.tools], [false, 'offline', '꺼짐', []]);
});

console.log('수동 조작·지우기');
await ta('expect·link·unlink·counted — 장부를 고치고 고친 항목을 돌려준다(상태 다시 셈), 없는 항목은 null', async () => {
  const ctx = await registered({ outlook: { inbox: [...INBOX, inboxMail('c1', 'park@bar.org', { subject: '2026 실적 자료 요청 관련 질문', conversationId: 'x' })], metas: R_METAS, files: R_FILES } });
  await ctx.sync.refresh();
  let it = ctx.sync.book().items[0];
  assert.equal(it.replies.find((x) => x.id === 'c1').kind, 'candidate');
  it = await ctx.sync.link('s1', 'c1', 'bar.org');
  assert.deepEqual([it.expect[2].state, it.status.responded], ['done', 2]);
  it = await ctx.sync.unlink('s1', 'r1');
  assert.deepEqual([it.expect[0].state, it.status.responded], ['open', 1], '유일한 센 회신을 떼면 다시 open');
  it = await ctx.sync.counted('s1', 'r2', true);
  assert.deepEqual([it.expect[1].state, it.expect[1].by], ['done', 'lee@krs.co.kr'], '자동 회신을 세기');
  it = await ctx.sync.expect('s1', 'foo.com', 'excluded');
  assert.deepEqual(it.status, { expected: 2, responded: 2, excluded: 1, done: true });
  assert.deepEqual(ctx.book.state.items[0].status, it.status, '장부에 썼다');
  assert.equal(await ctx.sync.expect('nope', 'foo.com', 'done'), null);
});
await ta('review — 수락은 세고(reviewedAt 은 now) 거부는 세지 않아 받을 곳이 다시 기다림; 새 회신은 확인 필요', async () => {
  const ctx = await registered({ outlook: { inbox: INBOX, metas: R_METAS, files: R_FILES } });
  await ctx.sync.refresh();
  let it = ctx.sync.book().items[0];
  assert.deepEqual(it.replies.map((r) => [r.id, r.review, r.counted]), [['r1', 'pending', true], ['r2', 'pending', false]], '새로 이어진 회신은 확인 필요(사람의 답은 바로 센다)');
  it = await ctx.sync.review('s1', 'r1', 'rejected');
  assert.deepEqual([it.replies[0].review, it.replies[0].reviewedAt, it.replies[0].counted, it.replies[0].key, it.expect[0].state, it.status.responded], ['rejected', '2026-10-15T09:00:00Z', false, 'foo.com', 'open', 0]);
  it = await ctx.sync.review('s1', 'r2', 'accepted');
  assert.deepEqual([it.replies[1].review, it.replies[1].counted, it.expect[1].state, it.expect[1].by], ['accepted', true, 'done', 'lee@krs.co.kr'], '자동 회신도 수락하면 센다');
  it = await ctx.sync.review('s1', 'r1', 'nope');
  assert.equal(it.replies[0].review, 'rejected', '모르는 상태는 그대로');
  assert.equal(await ctx.sync.review('zz', 'r1', 'accepted'), null);
  assert.deepEqual(ctx.book.state.items[0].replies.map((r) => r.review), ['rejected', 'accepted'], '장부에 썼다');
});
await ta('settings requireAccept — 새 회신을 세지 않고 수락을 기다린다; 수락하면 완료', async () => {
  const ctx = await registered({ book: { settings: { requireAccept: true } }, outlook: { inbox: INBOX, metas: R_METAS, files: R_FILES } });
  await ctx.sync.refresh();
  let it = ctx.sync.book().items[0];
  assert.deepEqual([it.replies[0].kind, it.replies[0].counted, it.replies[0].review, it.expect[0].state, it.status.responded], ['reply', false, 'pending', 'open', 0]);
  it = await ctx.sync.review('s1', 'r1', 'accepted');
  assert.deepEqual([it.replies[0].counted, it.expect[0].state, it.status.responded], [true, 'done', 1]);
});
await ta('remove — 장부에서 지우고 금고의 본문·첨부도 지운다', async () => {
  const ctx = await registered({ ids: ['s1', 's2'] });
  const b = await ctx.sync.remove('s1');
  assert.deepEqual(b.items.map((it) => it.id), ['s2']);
  assert.deepEqual(ctx.book.state.items.map((it) => it.id), ['s2']);
  assert.deepEqual(ctx.vault.removed, ['s1']);
  assert.equal(await ctx.vault.getFile('s1', 's1', 'tpl'), null);
  assert.notEqual(await ctx.vault.getBody('s2', 's2'), null);
  assert.deepEqual(ctx.logs, []);
});
await ta('remove — 금고 지우기가 실패해도 장부에서는 지우고, 그것만은 sync 가 기록한다(패널이 모르는 일)', async () => {
  const ctx = await registered({ ids: ['s1', 's2'] });
  ctx.vault.removeItem = async () => { throw new Error('금고가 잠겼습니다'); };
  const b = await ctx.sync.remove('s1');
  assert.deepEqual(b.items.map((it) => it.id), ['s2']);
  assert.equal(ctx.logs.length, 1);
  assert.deepEqual([ctx.logs[0][0], ctx.logs[0][1], ctx.logs[0][2]], [false, '메일 금고 지우기 실패 — 금고가 잠겼습니다', { itemId: 's1' }]);
});

console.log('서버에 저장·병합');
await ta('fetchServerCopy — 첨부 id 쌍으로 서버 저장, 경로를 회신(또는 보낸 메일) 첨부에 적는다; 실패는 던진다', async () => {
  const ctx = await registered({ outlook: { inbox: INBOX, metas: R_METAS, files: R_FILES, missing: R_MISSING,
    saved: { results: [{ message_id: 'r1', attachment_id: 'rbig', name: 'big.zip', file_path: 'downloads/mailtrack/big.zip', success: true, filePath: 'downloads/mailtrack/big.zip' }], errors: [] } } });
  await ctx.sync.refresh();
  ctx.outlook.calls.length = 0;
  const p = await ctx.sync.fetchServerCopy('s1', 'r1', 'rbig');
  assert.equal(p, 'downloads/mailtrack/big.zip');
  assert.deepEqual(ctx.outlook.calls[0], ['saveOnServer', [{ message_id: 'r1', attachment_id: 'rbig' }], undefined]);
  const att = ctx.book.state.items[0].replies.find((x) => x.id === 'r1').attachments.find((a) => a.id === 'rbig');
  assert.deepEqual([att.serverPath, att.missing], ['downloads/mailtrack/big.zip', true]);
  ctx.outlook.calls.length = 0;
  await ctx.sync.fetchServerCopy('s1', 's1', 'big').catch(() => {});
  assert.deepEqual(ctx.outlook.calls[0][1], [{ message_id: 's1', attachment_id: 'big' }], '보낸 메일(내 첨부)');
  const failing = await registered({ outlook: { saved: { results: [{ message_id: 's1', attachment_id: 'big', success: false, error: '권한 없음' }] } } });
  await assert.rejects(failing.sync.fetchServerCopy('s1', '', 'big'), /권한 없음/);
  await assert.rejects(failing.sync.fetchServerCopy('nope', 'r1', 'x'), /찾지 못했습니다/);
});
await ta('mergeFiles — 양식 바이트 + 고른 회신 첨부들(출처 sourceOf)을 merge.mergeOffice 에, 이름은 mergedName(제목, 갈래, 오늘)', async () => {
  const merge = fakeMerge();
  const ctx = await registered({ merge, outlook: { inbox: INBOX, metas: R_METAS, files: R_FILES } });
  await ctx.sync.refresh();
  const r1 = ctx.book.state.items[0].replies.find((x) => x.id === 'r1');
  const out = await ctx.sync.mergeFiles('s1', { templateAttachmentId: 'tpl', picks: [{ messageId: 'r1', attachmentId: 'ra' }, { messageId: 'r1', attachmentId: 'rbig' }, { messageId: 'zz', attachmentId: 'q' }], options: { headerRows: 2 } });
  assert.equal(merge.seen.length, 1);
  const args = merge.seen[0];
  assert.deepEqual([args.kind, args.template, args.options], ['xlsx', TPL_BYTES, { headerRows: 2 }]);
  assert.deepEqual(args.replies, [{ bytes: RA_BYTES, source: sourceOf(r1) }]);
  assert.deepEqual(sourceOf(r1), { org: 'foo.com', name: '김', address: 'kim@foo.com', date: '2026-10-11' });
  assert.deepEqual(out.name, '2026 실적 자료 요청_병합_20261015.xlsx');
  assert.deepEqual([out.bytes, out.mime], [new Uint8Array([9, 9]), XLSX_MIME]);
  assert.equal(out.report.merged, 1);
  assert.deepEqual(out.report.warnings, ['표 서식 제거']);
  assert.deepEqual(out.report.skipped.map((s) => s.reason), ['첨부가 금고에 없습니다', '회신을 찾지 못했습니다']);
  assert.deepEqual(ctx.logs, [], '병합의 기록은 패널이 남긴다');

  const all = await ctx.sync.mergeFiles('s1', {});
  assert.equal(merge.seen[1].replies.length, 1, 'picks 가 없으면 금고에 있는 같은 갈래 회신 첨부 전부(양식도 첫 것)');
  assert.ok(all.name.endsWith('.xlsx'));
  await assert.rejects(ctx.sync.mergeFiles('s1', { picks: [] }), /합칠 회신 첨부가 없습니다/);
  await assert.rejects(ctx.sync.mergeFiles('s1', { templateAttachmentId: 'nope' }), /양식/);
  await ctx.vault.removeItem('s1');
  await assert.rejects(ctx.sync.mergeFiles('s1', {}), /양식 파일\(실적양식\.xlsx\)이 금고에 없습니다/);
});

console.log(`\n${pass} passed`);
