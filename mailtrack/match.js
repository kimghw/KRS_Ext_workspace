// 받은 메일 → 등록한 항목의 회신으로 잇기(순수) — 분류(자동 회신·배달 실패·내 메일)·점수(대화 id > 헤더 > 제목+도메인)·연결·수동 덮어쓰기.
//
// 2026-10-15 사용자 지정: "같은 도메인 메일 수신이 보낸 거랑 같으면 완료 … 이 숫자를 관리". 그래서 회신 하나가 채우는 것은 **보낸 사람의 기대 키**
// (도메인 키 또는 내 도메인의 주소 키, model.js expectOf) 하나이고, 센(counted) 회신이 있는 키가 done 이 된다. 자동 회신·배달 실패는 사람이 답한 것이
// 아니라 세지 않지만 저장은 한다 — 사람이 "세기" 로 바꿀 수 있게(계획 8절 7).
// 점수는 확실한 것부터: 3 = Outlook 대화 id 같음(또는 In-Reply-To/References 에 보낸 메일의 Message-ID), 2 = 머리표 뗀 제목이 같고 기대 키의 사람이 보냄,
// 1 = 기대 키의 사람이 나에게 보낸 메일 제목에 보낸 제목이 들어 있음(후보 — 사람이 "연결" 해야 센다). 0 은 버린다.
// 수동 표시(manual)는 다음 갱신이 되돌리지 않는다 — 사람이 고친 것이 이긴다. 꼴은 model.js(계획서 3.2).
// 확인(review — 2026-10-15 사용자 지정 "받은거 accept 할지 거부할지"): 새로 이어진 회신은 pending(확인 필요). 사람이 수락(setReview 'accepted')하면 세고,
// 거부('rejected')하면 세지 않아 그 받을 곳은 다시 기다림이 된다(같은 메일은 taken 이라 다시 잇지 않고, 다음 회신이 오면 새로 선다). 둘 다 manual.
// matchAll 의 autoCount(설정 requireAccept 의 반대)가 false 면 새 회신을 세지 않고 수락을 기다린다.

import { toAddr, domainOf, normalizeSubject, normalizeReply, withStatus, timeOf, isoTime, REVIEW_STATES } from './model.js';

/** 시스템이 보낸 주소(로컬 부분) — 배달 실패 알림을 보내는 곳. Exchange 의 NDR 은 MicrosoftExchange<32자리 16진> 로도 온다. */
export const SYSTEM_FROM = [/^(postmaster|mailer-daemon|no-?reply|do-?not-?reply|noreply|bounce)/i, /^microsoftexchange[0-9a-f]{32}/i];
/** 배달 실패 제목. 한국어 Outlook·Exchange 는 "배달 못 함:"·"배달되지 않음:" 꼴. */
export const NDR_SUBJECT = [
  /undeliverable/i, /undelivered mail/i, /delivery (status|has failed)/i, /배달\s*(못\s*함|실패|할\s*수\s*없음)/, /배달되지\s*않음/, /전달\s*실패/, /returned mail/i, /mail delivery failed/i,
];
/** 자동 회신 제목(앞머리). 회신 머리표·[외부] 를 뗀 제목에도 대 본다("[외부] 자동 회신: …"). */
export const AUTO_SUBJECT = [/^(자동\s*회신|자동\s*응답|부재\s*중|automatic reply|auto(matic)?[- ]?reply|out of office|자리\s*비움)/i];

const lower = (x) => String(x ?? '').trim().toLowerCase();
const meSet = (me) => new Set((Array.isArray(me) ? me : [me]).map(lower).filter(Boolean));

/**
 * 받은 메일의 갈래 — self(내가 보낸 것, 저장하지 않음) · ndr(배달 실패) · auto(자동 회신 — 제목 또는 Auto-Submitted: auto-* 헤더) · reply(사람의 답).
 * 받은 메일 조회가 보낸 편지함까지 훑으므로(서버 기본 URL 이 모든 폴더) self 를 꼭 가른다.
 */
export function classify(mail, { me = '' } = {}) {
  const m = mail || {};
  const from = toAddr(m.from).address;
  if (from && meSet(me).has(from)) return 'self';
  const local = from.includes('@') ? from.slice(0, from.lastIndexOf('@')) : from;
  const subject = String(m.subject ?? '').trim();
  if (SYSTEM_FROM.some((re) => re.test(local)) || NDR_SUBJECT.some((re) => re.test(subject))) return 'ndr';
  const bare = normalizeSubject(subject);
  if (AUTO_SUBJECT.some((re) => re.test(subject) || re.test(bare))) return 'auto';
  if (/^auto-/i.test(String(m.headers?.autoSubmitted ?? '').trim())) return 'auto';
  return 'reply';
}

/**
 * 이 메일의 보낸 사람이 채우는 기대 키 — 주소 키(addr:주소)·그 주소가 든 키·도메인 키(하위 도메인 mail.foo.com 도 foo.com) 차례.
 * from 으로 못 찾으면 sender(대리 발송)로 한 번 더. 없으면 null — 받는 사람에 없던 곳에서 온 답("대상 아님"). 참조(CC)로만 받은 사람도 여기다
 * (받을 곳은 To 에서만 선다 — model.js expectOf).
 */
export function keyOf(mail, item) {
  const ex = Array.isArray(item?.expect) ? item.expect : [];
  const who = [toAddr(mail?.from).address, mail?.sender ? toAddr(mail.sender).address : ''].filter(Boolean);
  for (const a of who) {
    const byAddr = ex.find((e) => e.key === `addr:${a}`) || ex.find((e) => Array.isArray(e.addresses) && e.addresses.includes(a));
    if (byAddr) return byAddr.key;
    const d = domainOf(a);
    if (!d) continue;
    const byDomain = ex.find((e) => e.kind === 'domain' && (e.key === d || d.endsWith(`.${e.key}`)));
    if (byDomain) return byDomain.key;
  }
  return null;
}

/**
 * 메일이 이 항목의 회신일 확률 — 3/2/1/0(위 머리 주석). 점수 1 의 "나에게 온" 은 opts.me(없으면 항목을 보낸 주소 = 나)가 받는 사람(To∪CC)에 있는가.
 * 제목 견주기는 보낸 제목이 빈 글이면 하지 않는다(빈 제목끼리 모두 같아져서).
 */
export function scoreOf(mail, item, { me = '' } = {}) {
  const m = mail || {};
  const it = item || {};
  const got = timeOf(m.receivedAt);
  const sent = timeOf(it.sentAt);
  // 보낸 때보다 먼저 받은 메일은 그 대화의 앞선 글이지 답이 아니다 — 내가 "Re:" 로 답한 메일을 등록하면 상대가 먼저 보낸 메일이 같은 대화 id 로 잡혀
  // 곧바로 완료가 됐다(2026-10-15 실제 메일함으로 실측 — 받고 2분 뒤에 답한 것이라 5분 여유로는 못 걸렀다). 두 시각 다 같은 Exchange 가 찍은 것이라
  // 시계 어긋남은 없고, 답은 보낸 뒤에만 온다 → 여유 없이 가른다. 시각을 모르면 가리지 않는다.
  if (Number.isFinite(got) && Number.isFinite(sent) && got < sent) return 0;
  if (m.conversationId && it.conversationId && m.conversationId === it.conversationId) return 3;
  const mid = String(it.internetMessageId || '');
  const h = m.headers || {};
  if (mid && (String(h.inReplyTo || '').includes(mid) || String(h.references || '').includes(mid))) return 3;
  const key = keyOf(m, it);
  const subjectKey = it.subjectKey || normalizeSubject(it.subject);
  if (key === null || !subjectKey) return 0;
  const subject = normalizeSubject(m.subject);
  if (subject === subjectKey) return 2;   // 보낸 뒤인 것은 위에서 가렸다
  const mine = meSet(me);
  if (!mine.size) mine.add(toAddr(it.from).address);
  const toMe = [...(m.to || []), ...(m.cc || [])].some((a) => mine.has(toAddr(a).address));
  if (got >= sent && toMe && subject.includes(subjectKey)) return 1;
  return 0;
}

/**
 * 받은 메일들을 항목들에 잇는다(장부는 고치지 않는다 — 결과를 applyReplies 로 넣는다).
 * 메일 하나는 항목 하나에만: 점수 최고, 동점이면 sentAt ≤ receivedAt 인 것 중 가장 늦게 보낸 항목(같은 사람에게 같은 제목을 다시 보냈으면 새 것에 대한 답).
 * 이미 어떤 항목의 replies 에 있는 id(와 opts.known — 닫힌 항목의 회신 id 처럼 items 에 없는 것)는 건너뛴다. 갈래:
 *   reply & 점수 ≥ 2 → 'reply', counted(키가 없으면 세지 않음 — "대상 아님") · reply & 점수 1 → 'candidate' · auto/ndr → 그 갈래, 세지 않음 · self → 버림.
 * 새로 이어진 회신은 모두 review 'pending'(확인 필요). opts.autoCount 가 false 면(설정 requireAccept) 사람의 답도 세지 않고 수락을 기다린다.
 * unmatched = 내 메일·이미 이은 것을 빼고 어느 항목에도 점수가 없던 메일 수.
 */
export function matchAll(mails, items, { me = '', known = [], autoCount = true } = {}) {
  const list = Array.isArray(items) ? items : [];
  const taken = new Set(known instanceof Set ? known : Array.isArray(known) ? known : []);
  for (const it of list) for (const r of it?.replies || []) if (r?.id) taken.add(r.id);
  const linked = [];
  let unmatched = 0;
  for (const mail of Array.isArray(mails) ? mails : []) {
    const id = mail?.id;
    if (!id || taken.has(id)) continue;
    const cls = classify(mail, { me });
    if (cls === 'self') continue;
    taken.add(id);
    const got = timeOf(mail.receivedAt);
    let best = null;
    for (const item of list) {
      if (!item) continue;
      const score = scoreOf(mail, item, { me });
      if (!score) continue;
      const sent = timeOf(item.sentAt);
      const fits = sent <= got;
      if (!best || score > best.score || (score === best.score && ((fits && !best.fits) || (fits === best.fits && sent > best.sent)))) best = { item, score, fits, sent };
    }
    if (!best) { unmatched++; continue; }
    const key = keyOf(mail, best.item);
    const kind = cls === 'reply' ? (best.score >= 2 ? 'reply' : 'candidate') : cls;
    const reply = normalizeReply({
      id, from: mail.from, key, receivedAt: mail.receivedAt, subject: mail.subject, conversationId: mail.conversationId, hasAttachments: mail.hasAttachments === true,
      kind, score: best.score, counted: autoCount !== false && kind === 'reply' && key !== null, manual: false, attachments: [], bodyStored: false, webLink: mail.webLink,
      review: 'pending', reviewedAt: '',
    });
    linked.push({ itemId: best.item.id, reply });
  }
  return { linked, unmatched };
}

const byTime = (a, b) => (timeOf(a.receivedAt) || 0) - (timeOf(b.receivedAt) || 0);

/**
 * 회신에서 기대 키 상태를 다시 맞춘다. 수동이 아닌 키는 센 회신이 있으면 done(by = 가장 먼저 답한 주소, doneAt = 그 받은 때), 없으면 open.
 * 수동(manual) 키는 되돌리지 않는다 — open 인 수동 키만, 이번에 새로 센 회신(fresh)이 있으면 done 으로 올린다. excluded 는 손대지 않는다.
 */
function settle(item, fresh = []) {
  const replies = Array.isArray(item.replies) ? item.replies : [];
  const counted = replies.filter((r) => r.counted && r.key).sort(byTime);
  const freshKeys = new Set(fresh.filter((r) => r && r.counted && r.key).map((r) => r.key));
  const expect = (item.expect || []).map((e) => {
    if (e.state === 'excluded') return e;
    const r = counted.find((x) => x.key === e.key);
    if (!e.manual) return r ? { ...e, state: 'done', by: r.from.address, doneAt: r.receivedAt } : { ...e, state: 'open', by: '', doneAt: '' };
    if (e.state === 'open' && r && freshKeys.has(e.key)) return { ...e, state: 'done', by: r.from.address, doneAt: r.receivedAt };
    return e;
  });
  return withStatus({ ...item, expect });
}

/** 새로 이어진 회신을 더한다 — 이미 있는 id 는 건너뛰고(있는 것의 수동 표시를 지킨다), 센 회신이 채운 키는 done, status 다시 셈. */
export function applyReplies(item, replies) {
  const have = new Set((item.replies || []).map((r) => r.id));
  const fresh = [];
  for (const raw of Array.isArray(replies) ? replies : []) {
    const r = normalizeReply(raw);
    if (!r || have.has(r.id)) continue;
    have.add(r.id);
    fresh.push(r);
  }
  return settle({ ...item, replies: [...(item.replies || []), ...fresh] }, fresh);
}

/**
 * 기대 키 하나를 사람이 정한다(manual:true — 이후 갱신이 되돌리지 않는다). done 이면 by/doneAt 은 그 키의 센 회신에서, 없으면 opts.now.
 * 계약 밖 덧붙임: state 'auto' 는 수동 표시를 풀고 회신대로 다시 맞춘다("포함" 이나 "되돌리기" 를 자동으로 돌리고 싶을 때).
 */
export function setExpect(item, key, state, { now = null } = {}) {
  const k = lower(key);
  if (!(item.expect || []).some((e) => e.key === k)) return withStatus(item);
  if (state === 'auto') return settle({ ...item, expect: item.expect.map((e) => (e.key === k ? { ...e, manual: false, state: e.state === 'excluded' ? 'open' : e.state } : e)) });
  if (!['open', 'done', 'excluded'].includes(state)) return withStatus(item);
  const r = (item.replies || []).filter((x) => x.counted && x.key === k).sort(byTime)[0];
  const expect = item.expect.map((e) => {
    if (e.key !== k) return e;
    if (state !== 'done') return { ...e, state, manual: true, by: '', doneAt: '' };
    const at = now == null ? '' : isoTime(now);
    return { ...e, state, manual: true, by: r ? r.from.address : e.by || '', doneAt: r ? r.receivedAt : e.doneAt || at };
  });
  return withStatus({ ...item, expect });
}

const replaceReply = (item, next) => ({ ...item, replies: item.replies.map((r) => (r.id === next.id ? next : r)) });

/** 회신을 기대 키 하나에 잇는다(후보의 "연결") — 키를 정하고 센다(후보는 reply 로), 사람이 이은 것이니 수락으로. 모르는 키·없는 회신이면 그대로. */
export function linkReply(item, replyId, key, { now = null } = {}) {
  const r = (item.replies || []).find((x) => x.id === replyId);
  const k = lower(key);
  if (!r || !(item.expect || []).some((e) => e.key === k)) return withStatus(item);
  const next = { ...r, key: k, counted: true, manual: true, kind: r.kind === 'candidate' ? 'reply' : r.kind, review: 'accepted', reviewedAt: now == null ? '' : isoTime(now) };
  return settle(replaceReply(item, next), [next]);
}

/** 회신을 키에서 뗀다 — 회신은 남기고(다음 갱신이 다시 잇지 않게, 본문·첨부도 그대로) 키·세기만 지운다. 그 키의 유일한 센 회신이었으면 수동 아닌 키는 다시 open. */
export function unlinkReply(item, replyId) {
  const r = (item.replies || []).find((x) => x.id === replyId);
  if (!r) return withStatus(item);
  return settle(replaceReply(item, { ...r, key: null, counted: false, manual: true }));
}

/**
 * 수락/거부 — 사람이 회신을 보고 정한다(manual — 갱신이 되돌리지 않는다).
 *   accepted: 센다. 키가 없는 회신이면 보낸 사람으로 키를 찾아 본다(자동 회신·배달 실패를 받은 것으로 치는 경우), 후보는 reply 로. 그 받을 곳은 완료.
 *   rejected: 세지 않는다 — 키는 남겨 어디서 온 답이었는지 보이게 하고, 그 받을 곳의 유일한 센 회신이었으면 수동 아닌 받을 곳은 다시 기다림(settle).
 * 모르는 상태·없는 회신이면 그대로. reviewedAt 은 opts.now(없으면 '').
 */
export function setReview(item, replyId, state, { now = null } = {}) {
  const r = (item.replies || []).find((x) => x.id === replyId);
  if (!r || !REVIEW_STATES.includes(state) || state === 'pending') return withStatus(item);
  const on = state === 'accepted';
  const next = {
    ...r, key: r.key || (on ? keyOf(r, item) : null), counted: on, manual: true, kind: on && r.kind === 'candidate' ? 'reply' : r.kind,
    review: state, reviewedAt: now == null ? '' : isoTime(now),
  };
  return settle(replaceReply(item, next), on ? [next] : []);
}

/** 세기/빼기 = 수락/거부(옛 이름 — sync.counted 가 쓴다). */
export const setCounted = (item, replyId, counted, opts) => setReview(item, replyId, counted ? 'accepted' : 'rejected', opts);
