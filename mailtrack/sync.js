// 메일 수신(회신 추적)의 오케스트레이션 — 등록(보낸 메일 → 항목)·갱신(받은 메일 → 회신 잇기)·수동 조작·병합 호출을 한 줄로 부른다.
//
// 2026-10-15 사용자 지정: "mcp 를 이용해야하고.. 내가 보낸 메일에서 받는사람 참조자 또는 메일주소가 도메인이 같은 경우 이를 식별해서 등록 해줍니다
// … 메일 내용과 첨부파일을 한 곳에 관리해 줍니다. docx 파일이나 excel 양식으로 작성을 요청한 경우 받아서 병합까지".
// 그래서 등록은 보낸 메일의 상세(To·CC·대화 id)·본문·첨부를 받아 장부(book)에 항목을, 금고(vault)에 본문·첨부 바이트를 넣고(내 첨부의 xlsx·docx 가
// 병합 양식), 갱신은 열린 항목들의 조회 창(model.js sinceOf)으로 받은 메일을 한 번에 받아 match.js 로 잇고, **새로 이어진 회신만** 본문·첨부를 받는다.
//
// 바깥은 모두 주입한다 — outlook(mcp/outlook.js 의 createOutlook 결과), book(store/book.js), vault(store/vault.js), merge(ooxml/merge.js; 없으면 병합할 때
// 처음 import). 그래서 이 파일은 chrome·IndexedDB·fetch 를 모르고, 만들기만 해서는 아무것도 부르지 않는다(test/wiring.test.mjs 가 jsdom 에서 통째로 import).
// 등록·갱신 하나는 outlook.run(api => …) 안에서 MCP 세션 하나로 여러 도구를 부른다(세션을 열고 닫는 왕복을 줄이고 서버에 세션이 쌓이지 않게).
// refresh 는 던지지 않는다 — 오류는 장부의 lastSync 와 돌려주는 { ok:false, error:{ kind, message, authUrl? } } 로 말한다(패널이 kind 'auth' 면 "Microsoft 로그인 필요").

import { normalizeBook, newItem, sinceOf, sourceOf, isoTime, timeOf, toAddr, attachmentsOf, downloadable, DAY_MS } from './model.js';
import { matchAll, applyReplies, setExpect, linkReply, unlinkReply, setCounted, setReview } from './match.js';

const str = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
const uniq = (list) => [...new Set((Array.isArray(list) ? list : [list]).map(str).filter(Boolean))];

const arr = (x) => (Array.isArray(x) ? x : []);

/**
 * 오류 → { kind, message, authUrl?, tool? }. 풀이는 어댑터의 describe(outlook.describe — auth_required·토큰 획득 실패·no_authenticated_user 를 'auth' 로,
 * unknown_tool 을 'notool' 로 모은다)를 먼저 쓰고, 없을 때만 여기서 rerp/mcp.js 의 kind 와 auth_required/auth_url 만 본다.
 * authUrl 은 빈 글이면 싣지 않는다(패널이 있을 때만 로그인 창을 연다). 글로 찍으면 message 가 나온다(`${r.error}`).
 */
export function describeError(e, describe = null) {
  let d = null;
  if (typeof describe === 'function') { try { d = describe(e); } catch { d = null; } }
  if (!d || typeof d !== 'object') {
    const o = e && typeof e === 'object' ? e : {};
    const payload = o.payload && typeof o.payload === 'object' ? o.payload : {};
    const authUrl = str(o.authUrl || payload.auth_url || payload.authUrl);
    const kind0 = str(o.kind);
    d = {
      kind: (!kind0 || kind0 === 'tool') && (payload.status === 'auth_required' || authUrl) ? 'auth' : kind0 || 'error',
      message: str(o.message) || str(payload.message) || (typeof e === 'string' ? e : ''),
      authUrl,
    };
  }
  const message = str(d.message) || '알 수 없는 오류';
  const out = { kind: str(d.kind) || 'error', message };
  if (str(d.authUrl)) out.authUrl = str(d.authUrl);
  if (str(d.tool)) out.tool = str(d.tool);
  Object.defineProperty(out, 'toString', { value: () => message, enumerable: false });
  return out;
}
const fail = (kind, message, extra) => Object.assign(new Error(message), { kind }, extra || {});
/** 받을 것이 없을 때의 내려받기 결과. */
const NO_DOWNLOAD = Object.freeze({ files: [], missing: [], failed: new Set() });

/**
 * 받아 온 파일(FileContent — 메일 하나의 것)을 첨부 목록에 짝짓는다. 어댑터가 붙여 준 attachmentId 로, 없으면(옛 어댑터) 이름으로(같은 이름은 차례대로).
 * 서버의 인라인 다운로드 응답 자체에는 첨부 id 가 없다(original_name 만) — 계획 0절.
 */
function pairFiles(atts, files) {
  const out = new Map();
  const left = atts.filter(downloadable);
  for (const f of files) {
    const name = str(f?.name);
    const free = (a) => !out.has(a.id);
    const a = (f?.attachmentId && left.find((x) => free(x) && x.id === f.attachmentId))
      || left.find((x) => free(x) && x.name === name)
      || left.find((x) => free(x) && x.name.toLowerCase() === name.toLowerCase());
    if (a) out.set(a.id, f);
  }
  return out;
}

/**
 * @param {object} deps
 * @param {object} deps.outlook createOutlook(...) 결과 — probe·run·listSent·fetchDetails·fetchInbox·attachmentMeta·downloadAll·saveOnServer
 * @param {object} deps.book createBook(...) 결과 — load·update(fn)(줄 세움)
 * @param {object} deps.vault createVault(...) 결과 — putBody·putFile·getFile·bodies·files·removeItem
 * @param {object|null} [deps.merge] ooxml/merge.js 모듈({ mergeOffice, mergedName, mergeKind }). null 이면 병합할 때 import
 * @param {() => number} [deps.now]
 * @param {(ok: boolean, text: string, data?: object) => void} [deps.log] 기록 한 줄(index.js 가 logEvent('mail', …) 로 잇는다). 등록·갱신·서버에 저장·병합은
 *   패널이 결과를 받아 제 말로 기록하므로 여기서는 남기지 않는다(한 일이 두 줄이 되지 않게) — 패널이 모르는 것(지우기 뒤 금고 정리 실패)만 이 줄로.
 */
export function createSync({ outlook, book, vault, merge = null, now = () => Date.now(), log = () => {} } = {}) {
  let last = normalizeBook(null);   // 마지막으로 읽거나 쓴 장부 — 패널이 동기로 그린다
  let probed = null;                // 마지막 probe 결과(도구 목록) — 갱신이 test_handler/mail_fetch_filter 를 고른다
  let running = null;               // 도는 갱신(겹쳐 부르면 같은 것을 돌려준다)

  const say = (ok, text, data) => { try { log(ok, text, data); } catch { /* 기록 실패는 일을 막지 않는다 */ } };
  const load = async () => (last = normalizeBook(await book.load()));
  /** 장부 고치기 — book.update 의 줄에 서서 fn(꼴 맞춘 지금 장부) → 새 장부. */
  const commit = async (fn) => (last = normalizeBook(await book.update((cur) => fn(normalizeBook(cur)))));
  /** 항목 하나 고치기. 없으면 null. */
  const updateItem = async (itemId, fn) => {
    let hit = false;
    await commit((b) => ({ ...b, items: b.items.map((it) => (it.id === itemId ? ((hit = true), fn(it)) : it)) }));
    return hit ? last.items.find((it) => it.id === itemId) || null : null;
  };
  const mergeModule = async () => merge || import('./ooxml/merge.js');
  const explain = (e) => describeError(e, typeof outlook?.describe === 'function' ? outlook.describe : null);
  const forget = (err) => { if (['offline', 'auth', 'notool', 'session', 'http'].includes(err.kind)) probed = null; };
  /**
   * 받은 메일을 대체 도구(mail_fetch_filter, 50건 한도)로 볼까 — 마지막 probe 가 test_handler 는 없고 mail_fetch_filter 는 있다고 했을 때만.
   * probe 를 안 했으면 따로 묻지 않는다(왕복 하나 아끼기) — 어댑터의 fetchInbox 가 test_handler 가 없으면 저절로 대체 도구로 간다.
   */
  const inboxFallback = () => !!(probed?.has && !probed.has.inbox && probed.has.inboxFallback);

  /** 메일 하나의 본문을 금고에. 넣었으면 true. */
  async function putBody(itemId, messageId, { subject, from, receivedAt, body }, errors) {
    if (!body || typeof body !== 'object' || body.content == null) return false;
    try {
      await vault.putBody({ itemId, messageId, subject, from, receivedAt, contentType: body.contentType === 'html' ? 'html' : 'text', content: str(body.content) });
      return true;
    } catch (e) {
      errors.push(`본문 저장 실패(${subject || messageId}): ${explain(e).message}`);
      return false;
    }
  }
  /**
   * 메일 하나의 첨부 바이트를 금고에 — 받은 것은 stored. missing("서버에 저장" 대상)은 짐작하지 않고 어댑터가 알린 것(dl.missing — 서버가 건너뛴 큰 파일)과
   * 내려받기 자체가 실패한 메일(dl.failed)의 첨부, 그리고 바이트는 왔는데 금고에 못 넣은 것(다른 길로라도 받게)만.
   */
  async function putFiles(itemId, messageId, atts, dl, errors) {
    const pairs = pairFiles(atts, arr(dl.files).filter((f) => f && f.messageId === messageId));
    const miss = new Set(arr(dl.missing).filter((m) => m && m.messageId === messageId).map((m) => str(m.attachmentId)));
    const failed = dl.failed?.has?.(messageId) === true;
    const out = [];
    for (const a of atts) {
      if (!downloadable(a)) { out.push(a); continue; }
      const f = pairs.get(a.id);
      if (!f) { out.push({ ...a, stored: false, missing: failed || miss.has(a.id) }); continue; }
      try {
        await vault.putFile({ itemId, messageId, attachmentId: a.id, name: a.name || str(f.name), contentType: str(f.contentType) || a.contentType, size: f.bytes?.byteLength ?? f.size, bytes: f.bytes });
        out.push({ ...a, stored: true, missing: false });
      } catch (e) {
        errors.push(`첨부 저장 실패(${a.name}): ${explain(e).message}`);
        out.push({ ...a, stored: false, missing: true });
      }
    }
    return out;
  }

  /**
   * 받을 첨부가 있는 메일만 한 번에 내려받는다 — 이미 받은 첨부 목록(metas)을 넘겨 어댑터가 다시 묻지 않게. → { files, missing, failed:Set<messageId> }.
   * 큰 파일은 어댑터가 missing 과 errors 둘 다로 알리므로 errors 쪽 그 줄은 버리고 한 줄로 모아 말한다(같은 말이 두 번 보이지 않게).
   * 그 한 줄은 warnings 로 간다 — 받을 길("서버에 저장")이 있는 알림이지 실패가 아니다(패널이 "오류" 로 붉게 보이지 않게, 2026-10-15 통합 때 고침).
   * 받기 자체가 실패하면(던짐) 빈 것 + failed — 등록·연결은 그대로 하고 그 첨부들은 missing 이 된다.
   */
  async function downloadFor(api, metas, errors, warnings = errors) {
    const ask = metas.filter((m) => attachmentsOf(m?.attachments).some(downloadable));
    if (!ask.length) return NO_DOWNLOAD;
    const want = ask.map((m) => m.id);
    try {
      const dl = (await api.downloadAll(want, { meta: ask })) || {};
      const missing = arr(dl.missing).filter(Boolean);
      const big = missing.map((m) => `${str(m.name)}:`);
      for (const e of arr(dl.errors)) { const s = str(e); if (s && !big.some((p) => s.startsWith(p))) errors.push(s); }
      if (missing.length) warnings.push(`큰 첨부 ${missing.length}개는 서버가 바이트를 주지 않았습니다 — "서버에 저장" 으로 받으세요: ${missing.map((m) => str(m.name)).join(', ')}`);
      return { files: arr(dl.files), missing, failed: new Set() };
    } catch (e) {
      errors.push(`첨부 받기 실패: ${explain(e).message}`);
      return { files: [], missing: [], failed: new Set(want) };
    }
  }

  async function doRefresh({ force = false } = {}) {
    const t0 = now();
    try {
      const b = await load();
      const since = sinceOf(b, t0, { all: !!force });
      if (!since) {
        // 기다리는 항목이 없으면 조회하지 않는다(계획 4절 6) — 시각만 남겨 탭을 열 때마다 다시 오지 않게.
        await commit((cur) => ({ ...cur, lastSync: { at: t0, ok: true, error: '', fetched: 0, linked: 0, kind: '' } }));
        return { ok: true, fetched: 0, linked: 0, at: t0, idle: true };
      }
      const me = b.me;
      // 닫지 않은 항목 모두에 대 본다(완료 뒤 온 회신도 붙게). 이미 이은 id 는 닫힌 항목 것까지 건너뛴다.
      const items = b.items.filter((it) => !it.closed);
      const scanned = new Set(items.filter((it) => force || !it.status.done).map((it) => it.id));
      const known = new Set(b.items.flatMap((it) => it.replies.map((r) => r.id)));
      const errors = [];
      const fallback = inboxFallback();
      const got = await outlook.run(async (api) => {
        // 어댑터가 임시보관·나(excludeFrom)를 이미 거르지만 옛 서버·대체 도구에도 같게 한 번 더(내 메일은 classify 가 self 로도 버린다).
        const mails = (await api.fetchInbox({ since, top: 500, excludeFrom: me ? [me] : [], useHeaders: b.settings.useHeaders, fallback })) || [];
        // 설정 requireAccept 면 새 회신을 세지 않고(확인 필요로만) 사람의 수락을 기다린다.
        const { linked, unmatched } = matchAll(mails.filter((m) => m && m.isDraft !== true), items, { me, known, autoCount: !b.settings.requireAccept });
        if (!linked.length) return { fetched: mails.length, linked, unmatched, metas: [], dl: NO_DOWNLOAD };
        // 본문·첨부 목록이 안 오면 이번 갱신을 접는다 — syncedUntil 이 그대로라 다음 갱신이 같은 메일을 다시 잇는다.
        const metas = ((await api.attachmentMeta(linked.map((l) => l.reply.id))) || []).filter(Boolean);
        const dl = await downloadFor(api, metas, errors);
        return { fetched: mails.length, linked, unmatched, metas, dl };
      });
      const metaBy = new Map(got.metas.map((m) => [m.id, m]));
      const byItem = new Map();
      for (const { itemId, reply } of got.linked) {
        const m = metaBy.get(reply.id);
        let next = reply;
        if (m) {
          const atts = attachmentsOf(m.attachments).map((a) => ({ ...a, stored: false, missing: false }));
          const bodyStored = await putBody(itemId, reply.id, { subject: reply.subject, from: reply.from, receivedAt: reply.receivedAt, body: m.body }, errors);
          next = { ...reply, attachments: await putFiles(itemId, reply.id, atts, got.dl, errors), bodyStored, hasAttachments: reply.hasAttachments || atts.length > 0 };
        }
        if (!byItem.has(itemId)) byItem.set(itemId, []);
        byItem.get(itemId).push(next);
      }
      await commit((cur) => ({
        ...cur,
        items: cur.items.map((it) => {
          let x = byItem.has(it.id) ? applyReplies(it, byItem.get(it.id)) : it;
          if (scanned.has(it.id) && !x.synced) x = { ...x, synced: true };
          return x;
        }),
        syncedUntil: isoTime(t0),
        lastSync: { at: t0, ok: true, error: errors.join(' · '), fetched: got.fetched, linked: got.linked.length, kind: '' },
      }));
      // 갱신 중에 지운 항목에 들어간 본문·첨부는 치운다.
      for (const itemId of byItem.keys()) {
        if (last.items.some((it) => it.id === itemId)) continue;
        try { await vault.removeItem(itemId); } catch { /* 남은 조각은 다음 지우기에 */ }
      }
      // 기록(활동 로그)은 패널이 남긴다 — 여기서도 남기면 한 갱신이 두 줄이 된다.
      const r = { ok: true, fetched: got.fetched, linked: got.linked.length, unmatched: got.unmatched, at: t0 };
      if (errors.length) r.warnings = errors;
      return r;
    } catch (e) {
      const err = explain(e);
      forget(err);
      try { await commit((cur) => ({ ...cur, lastSync: { at: t0, ok: false, error: err.message, fetched: 0, linked: 0, kind: err.kind } })); } catch { /* 장부도 못 쓰면 돌려주는 값으로만 말한다 */ }
      const r = { ok: false, fetched: 0, linked: 0, at: t0, error: err, kind: err.kind };
      if (err.authUrl) r.authUrl = err.authUrl;
      return r;
    }
  }

  return {
    /** 서버 확인(도구 목록). 던지지 않는다 — 실패는 { ok:false, error:{kind,message,authUrl?}, kind }. */
    async probe() {
      try { await load(); } catch { /* 장부를 못 읽어도 기본 주소로 확인은 해 본다 */ }
      try {
        const p = await outlook.probe();
        probed = p && p.has ? p : null;
        return p;
      } catch (e) {
        const err = explain(e);
        probed = null;
        const r = { ok: false, server: null, tools: [], has: {}, missing: [], error: err, kind: err.kind };
        if (err.authUrl) r.authUrl = err.authUrl;
        return r;
      }
    },

    /** 등록 대화의 보낸 메일 목록 — 최근 days 일(기본 설정 sentDays), 최근 것부터, 이미 등록한 것은 registered:true. 실패는 던진다(오류에 kind). */
    async listSent({ days } = {}) {
      const b = await load();
      const d = Number.isFinite(+days) && +days > 0 ? +days : b.settings.sentDays;
      const t = now();
      const list = (await outlook.listSent({ from: isoTime(t - d * DAY_MS), to: isoTime(t) })) || [];
      const have = new Set(b.items.map((it) => it.id));
      return list.filter((h) => h && h.id).map((h) => ({ ...h, registered: have.has(h.id) })).sort((x, y) => (timeOf(y.receivedAt) || 0) - (timeOf(x.receivedAt) || 0));
    },

    /**
     * 보낸 메일들을 등록한다 — 상세(To·CC·대화 id·본문) → 첨부 목록 → 첨부 바이트(한 세션), 본문·첨부는 금고에, 항목은 장부에. 이미 등록한 id 는 skipped.
     * 처음 등록이면 보낸 메일의 보낸 주소가 곧 나(book.me — 확장은 내 주소를 모른다). 던지지 않는다 — 통째 실패면 errors 와 error:{kind,message,authUrl?}.
     * warnings 는 등록은 됐지만 알릴 것(서버가 바이트를 주지 않은 큰 첨부 — "서버에 저장" 으로 받는다). 기록은 패널이 남긴다.
     */
    async register(ids) {
      const out = { added: [], skipped: [], errors: [], warnings: [] };
      try {
        const b = await load();
        const have = new Set(b.items.map((it) => it.id));
        const todo = [];
        for (const id of uniq(ids)) (have.has(id) ? out.skipped : todo).push(id);
        if (!todo.length) return out;
        const got = await outlook.run(async (api) => {
          const details = ((await api.fetchDetails(todo)) || []).filter((m) => m && m.id);
          const found = todo.filter((id) => details.some((m) => m.id === id));
          if (!found.length) return { details, metas: [], dl: NO_DOWNLOAD };
          const metas = ((await api.attachmentMeta(found)) || []).filter(Boolean);
          const dl = await downloadFor(api, metas, out.errors, out.warnings);
          return { details, metas, dl };
        });
        const detBy = new Map(got.details.map((m) => [m.id, m]));
        const metaBy = new Map(got.metas.map((m) => [m.id, m]));
        const me = b.me || toAddr(got.details.find((m) => todo.includes(m.id))?.from).address;
        const items = [];
        const t = now();
        for (const id of todo) {
          const full = detBy.get(id);
          if (!full) { out.errors.push(`보낸 메일을 찾지 못했습니다: ${id}`); continue; }
          const meta = metaBy.get(id) || null;
          const item = newItem(full, meta, { me, now: t, ownByAddress: b.settings.ownByAddress });
          const body = full.body && full.body.content != null ? full.body : meta?.body;
          await putBody(id, id, { subject: item.subject, from: item.from, receivedAt: item.sentAt, body }, out.errors);
          const attachments = await putFiles(id, id, item.attachments, got.dl, out.errors);
          const stored = new Set(attachments.filter((a) => a.stored).map((a) => a.id));
          items.push({ ...item, attachments, templates: item.templates.map((tp) => ({ ...tp, stored: stored.has(tp.attachmentId) })) });
        }
        if (items.length || (!b.me && me)) {
          await commit((cur) => {
            const ids0 = new Set(cur.items.map((it) => it.id));
            const fresh = items.filter((it) => !ids0.has(it.id));
            return { ...cur, me: cur.me || me, items: [...cur.items, ...fresh] };
          });
        }
        const added = new Set(items.map((it) => it.id));
        out.added = last.items.filter((it) => added.has(it.id));
      } catch (e) {
        const err = explain(e);
        forget(err);
        out.errors.push(err.message);
        out.error = err;
      }
      return out;
    },

    /** 받은 메일로 회신을 잇는다(4절 6~8). 던지지 않는다. force: 닫지 않은 모든 항목을 보낸 때부터 다시 훑는다(조회 창 windowDays 안에서). */
    refresh(opts = {}) {
      if (!running) running = doRefresh(opts).finally(() => { running = null; });
      return running;
    },

    /** 항목을 지운다 — 장부에서, 금고의 본문·첨부도. 금고 지우기가 실패해도 장부에서는 지운다(기록만 남긴다). → 장부 */
    async remove(itemId) {
      await commit((b) => ({ ...b, items: b.items.filter((it) => it.id !== itemId) }));
      try { await vault.removeItem(itemId); } catch (e) { say(false, `메일 금고 지우기 실패 — ${explain(e).message}`, { itemId }); }
      return last;
    },
    /** 기대 키 상태를 사람이 정한다(open·done·excluded — 수동, 갱신이 되돌리지 않음; 'auto' 는 수동 표시를 풀고 회신대로). → 고친 항목 | null */
    expect: (itemId, key, state) => updateItem(itemId, (it) => setExpect(it, key, state, { now: now() })),
    /** 회신을 키에 잇는다(후보 "연결") — 사람이 이은 것이니 수락으로. → 고친 항목 | null */
    link: (itemId, replyId, key) => updateItem(itemId, (it) => linkReply(it, replyId, key, { now: now() })),
    /** 회신을 키에서 뗀다(회신은 남는다). → 고친 항목 | null */
    unlink: (itemId, replyId) => updateItem(itemId, (it) => unlinkReply(it, replyId)),
    /** 수락/거부(state: accepted·rejected) — 수락은 센다(받을 곳 완료), 거부는 세지 않고 그 받을 곳은 다시 기다림. 모르는 상태는 그대로. → 고친 항목 | null */
    review: (itemId, replyId, state) => updateItem(itemId, (it) => setReview(it, replyId, state, { now: now() })),
    /** 세기/빼기 = 수락/거부(옛 이름). → 고친 항목 | null */
    counted: (itemId, replyId, on) => updateItem(itemId, (it) => setCounted(it, replyId, on, { now: now() })),
    /** (계약 밖 덧붙임) 추적 끝내기/다시 열기 — 닫은 항목은 갱신 조회와 잇기에서 빠진다. → 고친 항목 | null */
    close: (itemId, on = true) => updateItem(itemId, (it) => ({ ...it, closed: !!on })),

    /** 금고의 본문들(보낸 메일 + 회신, 받은 차례). */
    bodies: (itemId) => vault.bodies(itemId),
    /** 금고의 첨부들(바이트 포함). */
    files: (itemId) => vault.files(itemId),

    /**
     * 인라인으로 안 온 큰 첨부를 MCP 서버 PC 에 저장시키고 그 경로를 장부에 적는다(첨부 id 쌍 경로는 늘 서버 디스크에 저장 — 계획 0절).
     * replyId 가 비었거나 itemId 와 같으면 보낸 메일(내 첨부). → serverPath. 실패는 던진다.
     */
    async fetchServerCopy(itemId, replyId, attachmentId) {
      const b = await load();
      const item = b.items.find((it) => it.id === itemId);
      if (!item) throw fail('notfound', '등록한 메일을 찾지 못했습니다');
      const own = !replyId || replyId === itemId;
      const messageId = own ? itemId : replyId;
      if (!own && !item.replies.some((r) => r.id === replyId)) throw fail('notfound', '회신을 찾지 못했습니다');
      const res = await outlook.saveOnServer([{ message_id: messageId, attachment_id: attachmentId }]);
      const results = Array.isArray(res?.results) ? res.results : [];
      const pathOf = (x) => str(x?.file_path || x?.filePath || x?.path);
      const idOf = (x) => str(x?.attachment_id || x?.attachmentId);
      const hit = results.find((x) => x && x.success !== false && pathOf(x) && (!idOf(x) || idOf(x) === attachmentId));
      if (!hit) throw fail('tool', str(results.find((x) => x?.error)?.error) || '서버에 저장하지 못했습니다');
      const serverPath = pathOf(hit);
      const mark = (atts) => atts.map((a) => (a.id === attachmentId ? { ...a, serverPath } : a));
      await updateItem(itemId, (it) => (own ? { ...it, attachments: mark(it.attachments) } : { ...it, replies: it.replies.map((r) => (r.id === messageId ? { ...r, attachments: mark(r.attachments) } : r)) }));
      return serverPath;
    },

    /**
     * 양식(내가 보낸 xlsx·docx) + 고른 회신 첨부들 → 하나의 파일. picks 를 주지 않으면 같은 갈래로 금고에 있는 회신 첨부 전부(배달 실패 빼고).
     * 출처는 회신마다 sourceOf(org · name <address> · date). 금고에 없는 첨부는 report.skipped 에. → { name, bytes, mime, report }. 실패는 던진다.
     */
    async mergeFiles(itemId, { templateAttachmentId, picks, options } = {}) {
      const b = await load();
      const item = b.items.find((it) => it.id === itemId);
      if (!item) throw fail('notfound', '등록한 메일을 찾지 못했습니다');
      const tpl = templateAttachmentId ? item.templates.find((x) => x.attachmentId === templateAttachmentId) : item.templates[0];
      if (!tpl) throw fail('notemplate', '병합할 양식(xlsx·docx)이 없습니다');
      const mod = await mergeModule();
      const kind = tpl.kind || mod.mergeKind(tpl.name);
      const tf = await vault.getFile(itemId, itemId, tpl.attachmentId);
      if (!tf?.bytes) throw fail('nofile', `양식 파일(${tpl.name})이 금고에 없습니다 — 다시 등록하거나 서버에 저장해 받으세요`);
      const list = Array.isArray(picks) ? picks : item.replies.filter((r) => r.kind !== 'ndr').flatMap((r) => r.attachments.filter((a) => a.stored && mod.mergeKind(a.name) === kind).map((a) => ({ messageId: r.id, attachmentId: a.id })));
      if (!list.length) throw fail('nopick', '합칠 회신 첨부가 없습니다');
      const replies = [];
      const skipped = [];
      for (const p of list) {
        const r = item.replies.find((x) => x.id === p?.messageId);
        const source = sourceOf(r || {});
        const f = r ? await vault.getFile(itemId, r.id, p.attachmentId) : null;
        if (!f?.bytes) { skipped.push({ source, reason: r ? '첨부가 금고에 없습니다' : '회신을 찾지 못했습니다' }); continue; }
        replies.push({ bytes: f.bytes, source });
      }
      if (!replies.length) throw fail('nofile', '고른 회신 첨부가 금고에 없습니다');
      const res = await mod.mergeOffice({ kind, template: tf.bytes, replies, options });
      const rep = res?.report || {};
      const report = { ...rep, merged: rep.merged ?? replies.length, skipped: [...skipped, ...(Array.isArray(rep.skipped) ? rep.skipped : [])], warnings: Array.isArray(rep.warnings) ? rep.warnings : [] };
      const name = mod.mergedName(item.subject, kind, new Date(now()));
      return { name, bytes: res.bytes, mime: res.mime, report };
    },

    /** 설정 바꾸기(mcpUrl·userEmail·sentDays·windowDays·ownByAddress·useHeaders·autoRefreshMin·requireAccept). 서버 주소·계정이 바뀌면 도구 목록을 다시 본다. → 장부 */
    async settings(patch = {}) {
      const prev = last.settings;
      await commit((b) => ({ ...b, settings: { ...b.settings, ...(patch && typeof patch === 'object' ? patch : {}) } }));
      if (prev.mcpUrl !== last.settings.mcpUrl || prev.userEmail !== last.settings.userEmail) probed = null;
      return last;
    },
    /** 마지막으로 읽은 장부(동기). */
    book: () => last,
    load,
  };
}
