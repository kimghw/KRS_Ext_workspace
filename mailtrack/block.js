// 사내 메일 보안(block@krs.co.kr)의 인증 요청 알림 → 붙잡힌 원 메일(보낸 사람·제목·받는 사람)로 풀기(순수).
//
// 2026-10-16 사용자 지정: "메일 수신대기 기능에서 보낸 메일의 경우 block@krs.co.kr 로 수신한 메일까지 조회해서 회신 확인 할 수 있도록 해줘."
// 외부에서 온 메일 가운데 메일 보안이 인증을 기다리며 붙잡아 둔 것은 받은 편지함에 오지 않고, 대신 block@krs.co.kr 이 알림을 보낸다(같은 날 실제 메일함 확인):
//   제목  '<원 제목> [인증 요청] 본 메일은 인증 요청 메일 입니다. [Certification request] This is an authentication request mail.' (길면 끝이 잘림)
//   본문  HTML 표 'Mail Information'(Subject·From·To·Date) · 'Sender Information'(Envelope From·Header From(이름)·Sender IP·Sender Country) — 행마다 <td>이름</td><td>값</td>
// 알림은 대화 id 가 새 것이라 점수 3 은 못 받는다 — 풀어 낸 보낸 사람·제목으로 점수 2(머리표 뗀 제목이 같고 받을 곳의 사람)를 받게 한다(match.js scoreOf).
// 같은 주소의 '[AntiSpam] 스팸 리포트' 는 알림이 아니다(하루치 목록 — 붙잡힌 메일마다 알림이 따로 온다). 받은 때는 알림의 receivedAt(Exchange 시각) 그대로 둔다
// — 본문의 Date 는 시간대 없는 한국 시각이라 보낸 때와 견주기에 못 쓴다.
// 서버 쪽 mail_list_period 는 이 주소를 기본으로 걸러 내지만, 갱신이 쓰는 test_handler·mail_fetch_filter 는 거르지 않는다(KR_MS365_mcp spec_도구정의.md 2026-10-16).

import { toAddr, normalizeSubject } from './model.js';

/** 메일 보안이 알림을 보내는 주소. */
export const BLOCK_FROM = 'block@krs.co.kr';
/** 알림 제목에 붙는 꼬리 — 여기부터 끝까지 떼면 원 제목. */
const NOTICE_TAIL = /\s*\[\s*인증\s*요청\s*\][\s\S]*$/;
/** 같은 주소가 보내는 알림 아닌 것(하루치 스팸 리포트). */
const NOT_NOTICE = /스팸\s*리포트|spam\s*report|\[antispam\]/i;
const ADDRESS = /[^\s<>"'()（）,;:：]+@[^\s<>"'()（）,;:：]+\.[^\s<>"'()（）,;:：]+/;
/** 본문 표에서 읽는 칸(소문자 이름 → 결과 이름). */
const FIELDS = { subject: 'subject', from: 'from', to: 'to', date: 'date', 'envelope from': 'envelopeFrom', 'header from': 'headerFrom' };

const str = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));

/** 메일 보안이 보낸 메일인가(알림·스팸 리포트 모두). */
export const isBlockFrom = (mail) => toAddr(mail?.from).address === BLOCK_FROM;
/** 붙잡힌 메일 하나의 인증 요청 알림인가 — 보낸 주소가 block@krs.co.kr 이고 스팸 리포트가 아니다(제목 꼬리는 잘릴 수 있어 보지 않는다 — 본문을 읽어 가린다). */
export const isNotice = (mail) => isBlockFrom(mail) && !NOT_NOTICE.test(str(mail?.subject));
/** 알림 제목 → 원 제목(꼬리 '[인증 요청] …' 을 뗀다). 꼬리가 없으면 그대로. */
export const noticeSubject = (subject) => str(subject).replace(NOTICE_TAIL, '').trim();

/**
 * 알림의 본문을 받아 볼 만한가 — 원 제목이 기다리는 항목의 제목과 닿을 때만(알림은 광고·뉴스레터에도 와서 다 받으면 무겁다).
 * 같거나 품거나(점수 2·1), 제목이 잘려 항목 제목의 앞머리일 때.
 */
export function mayMatch(mail, items) {
  const s = normalizeSubject(noticeSubject(mail?.subject));
  if (!s) return false;
  return (Array.isArray(items) ? items : []).some((it) => {
    const k = it?.subjectKey || normalizeSubject(it?.subject);
    return !!k && (s.includes(k) || k.startsWith(s));
  });
}

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}
/** HTML 조각 → 한 줄 글(태그를 떼고 글자 참조를 풀고 공백을 접는다). */
const textOf = (html) => decode(str(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/* HTML 의 표 행(<td>이름</td><td>값</td>) → { 이름: 값 } (앞의 것이 이긴다 — Mail Information 표가 먼저 온다) */
function fromRows(html) {
  const out = {};
  const body = str(html).replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  for (const tr of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => textOf(c[1]));
    if (cells.length < 2) continue;
    const name = FIELDS[cells[0].toLowerCase().replace(/\s*[:：]$/, '')];
    if (name && !(name in out)) out[name] = cells[1];
  }
  return out;
}
/* 글 본문 → 줄마다 '이름 값' 또는 '이름' 다음 줄의 값 (Mail Information 뒤부터) */
function fromLines(text) {
  const out = {};
  const s = str(text);
  const at = s.search(/mail information/i);
  const lines = (at >= 0 ? s.slice(at) : s).split(/\r?\n/).map((x) => x.replace(/\s+/g, ' ').trim());
  const names = Object.keys(FIELDS).sort((a, b) => b.length - a.length);   // 'envelope from' 이 'from' 보다 먼저
  for (let i = 0; i < lines.length; i++) {
    const low = lines[i].toLowerCase();
    const n = names.find((x) => low === x || low.startsWith(`${x} `) || low.startsWith(`${x}:`) || low.startsWith(`${x}：`));
    if (!n || FIELDS[n] in out) continue;
    let v = lines[i].slice(n.length).replace(/^\s*[:：]?\s*/, '');
    if (!v) { let j = i + 1; while (j < lines.length && !lines[j]) j++; v = lines[j] || ''; }
    out[FIELDS[n]] = v;
  }
  return out;
}

/**
 * 알림 본문 → { subject, from, to, date, envelopeFrom, headerFrom }(글). body 는 { contentType, content } 나 글.
 * 원 메일의 보낸 주소(From, 없으면 Envelope From)를 못 찾으면 null — 알림 꼴이 아니다.
 */
export function parseNotice(body) {
  const b = body && typeof body === 'object' ? body : { contentType: '', content: body };
  const content = str(b.content);
  if (!content.trim()) return null;
  const html = /html/i.test(str(b.contentType)) || /<t[dr][\s>]/i.test(content);
  let f = html ? fromRows(content) : {};
  if (!f.from && !f.envelopeFrom) f = fromLines(html ? decode(content.replace(/<br\s*\/?>|<\/(p|div|tr|td|th|li)>/gi, '\n').replace(/<[^>]*>/g, ' ')) : content);
  const pick = (k) => str(f[k]).trim();
  const out = { subject: pick('subject'), from: pick('from'), to: pick('to'), date: pick('date'), envelopeFrom: pick('envelopeFrom'), headerFrom: pick('headerFrom') };
  return ADDRESS.test(out.from) || ADDRESS.test(out.envelopeFrom) ? out : null;
}

/** 'Header From' → 이름. '"이름" <주소>'·'"이름"'·'이름' 꼴, 주소뿐이면 ''. */
function nameOf(headerFrom) {
  const s = str(headerFrom).replace(/<[^>]*>/g, '').trim().replace(/^"(.*)"$/, '$1').trim();
  return !s || ADDRESS.test(s) ? '' : s;
}

/**
 * 알림 메일 + 그 본문 → 원 메일 머리(MailHead 꼴): 보낸 사람·제목·받는 사람을 본문에서, id·받은 때·대화 id·webLink 는 알림 것 그대로(Outlook 에서 열면 알림 —
 * 거기서 [수신] 을 눌러야 원 메일이 받은 편지함에 온다). via:'block' 이 붙는다. 본문이 알림 꼴이 아니면 null.
 */
export function unwrapNotice(mail, body) {
  const p = parseNotice(body);
  if (!p) return null;
  const address = toAddr((ADDRESS.exec(p.from) || ADDRESS.exec(p.envelopeFrom))[0]).address;
  const to = ADDRESS.exec(p.to);
  return {
    ...mail,
    from: { name: nameOf(p.headerFrom), address },
    sender: null,
    subject: p.subject || noticeSubject(mail?.subject),
    to: to ? [{ name: '', address: toAddr(to[0]).address }] : Array.isArray(mail?.to) ? mail.to : [],
    via: 'block',
  };
}
