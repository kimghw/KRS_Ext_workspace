// 선행 품의 읽기 — eclass 에 올린 연구업무추진품의(구매·구독 품의)의 본문과 첨부를 읽어 구매요청서(구매의뢰) 초안의 재료로 만든다.
// 공문 이력 카드의 '구매의뢰' 가 쓴다(2026-10-17 사용자 지정: "그 의뢰서는 구매공문과 연동되어야 하고, 우측 하단에 구매의뢰하기 버튼" — 같은 날 "다른 것들이 들어가 있지를 않네?":
// 문서번호·제목만 옮기던 것을 품목·사양·수량·금액·구매처·구매계정·용도·사유·견적서 첨부까지 옮긴다). 읽기만 한다 — GET 둘(본문 틀·첨부 목록)과 첨부 내려받기.
//
// 실측(2026-10-17 CDP, 읽기 전용 — HER-2026-000097 "SSCB 연구과제 Claude 맥스 플랜 구독 품의"):
//   본문 틀 Forms/Drafts/KR_EA_Research_Task.aspx?…&ACTYPE=-1(src/gmlist.js 의 bodyUrl) — 완료 문서는 읽기 꼴이라 본문이 td#…tdEditorControl 안의 <p> 들이다(hfDocBodyValue 는 빈 칸).
//   제목은 #ctl00_ApplineInfoInReportKRTA1_lblDocTitle, Job Id 는 …lblJobID(RND00202026 꼴), 차수 …lblDegree, 수신·참조 …lblReceive·lblReference.
//   첨부 목록은 문서 보기 창의 의견·첨부 틀(frameDocOther) = Main/CommentAttachmentInfo.aspx?FORMID&DOCID… — a[href*="AttachFileDown.aspx"](…&FileName=…&View=1 이 이름 링크, View=0 이 내려받기).
//   내려받기는 application/pdf 바이트 그대로(Content-Disposition: attachment;filename=…) — src/net.js siteFetchBytes.
//
// 본문의 꼴 셋을 같은 길로 읽는다 — 줄마다 "이름 : 값" 이고, 번호 줄((1) …)과 줄표 줄(- …)이 어느 품목에 붙는지로 가른다:
//   이 확장의 구매 품의 틀   나. 구매 내역 (1) 구매품 : … / - 사양 / - 수량 / - 금액 · 다. 구매금액 · 라. 구매처 · 마. 구매계정 · 바. 용도 · 사. 구매사유
//   원본(krs-web-agents) 구매  가. 구매 내역 (1) 구매품 : … / - 사양 / - 용도 / - 구매금액 / - 구매계정 / - 구매사유
//   원본 구독                 가. 구독 서비스 (1) 구독서비스 : … (2) 구독사유 (3) 구독기간 (4) 구독금액 (5) 구매계정 (6) 사용자 — 번호 줄이 품목이 아니라 칸이다
// 품목을 여는 이름(구매품·구독서비스·품목·구입품·서비스)만 새 품목이고, 그 밖의 번호 줄·줄표 줄은 지금 품목의 칸, 품목이 없으면 문서의 칸이다. 틀이 조금 달라도 이름이 같으면 읽힌다.
// 못 읽은 값은 비워 둔다 — 사람이 적는다. 금액은 통화를 같이 읽는다("월 USD 220 × 6개월 = USD 1,320" 은 '=' 뒤의 USD 1,320).

import { ORIGIN } from './config.js';
import { AuthError, siteFetch, siteFetchBytes } from './net.js';
import { bodyUrl, RESEARCH_FORM } from './gmlist.js';
import { gistOf, summaryOf } from './gongmun.js';

const LOGIN = '로그인이 필요합니다. eclass 에 로그인한 뒤 다시 시도하세요.';
const looksLogin = (html) => /id="tbUserId"|Account\/Log(in|out)|You must sign in|loginbyname\.aspx/i.test(html || '');
const toDoc = (html) => new DOMParser().parseFromString(html, 'text/html');
const text = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
const keyOf = (s) => String(s ?? '').replace(/[\s·.()]/g, '');

/** 품목을 여는 이름 — 이 이름의 줄이 새 품목이다. */
const ITEM_KEYS = new Set(['구매품', '구매품목', '구독서비스', '품목', '구입품', '서비스', '구매물품', '품명']);
/** 칸 이름 → 초안의 키. 품목 안이면 품목의 키, 밖이면 문서의 키(amount 는 total). */
const FIELD_KEYS = {
  사양: 'spec', 규격: 'spec', 기능및요구사양: 'spec', 수량: 'qty', 단가: 'unitPrice', 예상단가: 'unitPrice', 금액: 'amount', 구매금액: 'amount', 구독금액: 'amount', 예상금액: 'amount',
  합계: 'amount', 총액: 'amount', 구매처: 'vendor', 업체: 'vendor', 판매처: 'vendor', 구독처: 'vendor', 구매계정: 'account', 계정: 'account', 용도: 'use', 구매사유: 'reason', 구독사유: 'reason', 사유: 'reason',
  구독기간: 'period', 기간: 'period', 비고: 'note',
};
const CURRENCY = { USD: 'USD', $: 'USD', 달러: 'USD', EUR: 'EUR', '€': 'EUR', JPY: 'JPY', '¥': 'JPY', 엔: 'JPY', CNY: 'CNY', 위안: 'CNY', GBP: 'GBP', '£': 'GBP', 원: 'KRW', '₩': 'KRW', KRW: 'KRW' };

/**
 * 본문 틀의 HTML 에서 본문 글을 줄로 — td#…tdEditorControl 안의 <p>·<div> 마다 한 줄(없으면 문서 전체). 스크립트·스타일은 뺀다. 줄 앞의 빈칸(들여쓰기)은 둔다.
 * @returns {string[]}
 */
export function bodyLines(html) {
  const d = toDoc(html);
  const root = d.getElementById('ctl00_ContentPlaceHolder_Content_tdEditorControl') || d.body;
  for (const s of root.querySelectorAll('script, style')) s.remove();
  const walk = (n) => {
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1) return '';
    let s = '';
    for (const c of n.childNodes) s += walk(c);
    if (/^(DIV|P|BR|TR|LI|H\d|TABLE)$/.test(n.tagName)) s += '\n';
    if (n.tagName === 'TD' || n.tagName === 'TH') s += ' | ';
    return s;
  };
  return walk(root).replace(/ /g, ' ').split('\n').map((l) => l.replace(/\s+$/, '').replace(/\s*\|\s*$/, '')).filter((l) => l.trim());
}

/**
 * 금액 글에서 수와 통화 — "1,239,000원" → 1239000 KRW, "USD 1,320" → 1320 USD, "월 USD 220 (VAT 포함) × 6개월 = USD 1,320 (일시 결제)" → '=' 뒤의 1320 USD.
 * 통화 표시가 하나도 없으면 가장 큰 수(원으로 본다). 수가 없으면 null.
 * @returns {{amount: number|null, currency: string}}
 */
export function moneyText(v) {
  const whole = String(v ?? '');
  const s = whole.includes('=') ? whole.slice(whole.lastIndexOf('=') + 1) : whole;
  const tokens = [...s.matchAll(/(USD|EUR|JPY|CNY|GBP|KRW|[$€£¥₩])?\s*(\d[\d,]*(?:\.\d+)?)\s*(원|달러|엔|위안|USD|EUR|JPY|CNY|GBP|KRW)?/g)]
    .map((m) => ({ n: Number(m[2].replace(/,/g, '')), cur: CURRENCY[m[1]] || CURRENCY[m[3]] || '' }))
    .filter((t) => Number.isFinite(t.n));
  if (!tokens.length) return { amount: null, currency: '' };
  const marked = tokens.filter((t) => t.cur);
  const pick = marked.length ? marked[marked.length - 1] : tokens.reduce((a, b) => (b.n > a.n ? b : a));
  return { amount: pick.n, currency: pick.cur || 'KRW' };
}

/** 수량 글 — "2대" → { qty: 2, unit: '대' }, "1" → { qty: 1, unit: '' }. 못 읽으면 qty null 에 글은 unit 으로. */
export function qtyText(v) {
  const m = String(v ?? '').trim().match(/^(\d[\d,]*)\s*([^\d\s(]*)/);
  return m ? { qty: Number(m[1].replace(/,/g, '')), unit: m[2] || '' } : { qty: null, unit: String(v ?? '').trim() };
}

/**
 * 본문 줄들을 읽는다.
 * @param {string[]} lines bodyLines 의 결과(또는 글을 줄로 나눈 것)
 * @returns {{items: object[], total: number|null, currency: string, vendor: string, account: string, use: string, reason: string, period: string, overview: string, summary: string, attach: string[]}}
 *   items 는 { name, spec, qty, unit, unitPrice, amount, currency, use, reason, account, period, note }
 */
export function parseBody(lines) {
  const items = [];
  const doc = {};
  let cur = null;
  let inAttach = false;
  const attach = [];
  const put = (target, key, value) => { if (value && !target[key]) target[key] = value; };
  for (const raw of lines || []) {
    const line = String(raw).trim();
    if (!line) continue;
    if (/^※\s*첨\s*부/.test(line)) { inAttach = true; continue; }
    if (inAttach) {
      const m = line.match(/^\d+\.\s*(.+?)\s*(?:\d+\s*부\.?)?\s*(?:끝\.?)?$/);
      if (m) attach.push(m[1].replace(/\s*\d+\s*부\.?$/, '').trim());
      continue;
    }
    if (/^1\.\s/.test(line) && !doc.overview) { doc.overview = line.replace(/^1\.\s*/, ''); continue; }
    if (/^2\.\s*이와\s*관련하여/.test(line)) { doc.summary = (line.match(/이와\s*관련하여\s*(.+?)\s*(?:아래와\s*같이|을|를)?\s*품의/) || [])[1] || ''; continue; }
    if (/^-+\s*아\s*래\s*-+$/.test(line.replace(/\s+/g, ' '))) continue;
    // 번호 줄 "(1) 이름 : 값", 줄표 줄 "- 이름 : 값", 항목 줄 "다. 이름 : 값", 비고 "# 비고 : 값"
    const m = line.match(/^(?:\((\d+)\)|(\d+)\)|[-•·#]|[가-힣]\.)?\s*([^:：]{1,20}?)\s*[:：]\s*(.*)$/);
    if (!m) continue;
    const numbered = m[1] != null || m[2] != null;
    const key = keyOf(m[3]);
    const value = m[4].trim();
    if (ITEM_KEYS.has(key)) {
      cur = { name: value, spec: '', qty: null, unit: '', unitPrice: null, amount: null, currency: '', use: '', reason: '', account: '', period: '', note: '' };
      items.push(cur);
      continue;
    }
    const field = FIELD_KEYS[key];
    if (!field) continue;
    // 항목 줄("다. 구매금액 : …")은 문서의 칸이고, 번호·줄표 줄은 지금 품목의 칸이다(품목이 없으면 문서의 칸).
    const target = /^[가-힣]\.\s/.test(line) ? doc : cur || doc;
    if (field === 'amount' || field === 'unitPrice') {
      const { amount, currency } = moneyText(value);
      if (amount == null) continue;
      const to = target === doc && field === 'amount' ? 'total' : field;
      if (target[to] == null) target[to] = amount;
      put(target, 'currency', currency);
    } else if (field === 'qty') {
      const { qty, unit } = qtyText(value);
      if (target.qty == null) target.qty = qty;
      put(target, 'unit', unit);
    } else put(target, field, value);
    if (!numbered && target === cur && field === 'period' && !cur.spec) cur.spec = value;
  }
  // 구독 품의처럼 기간이 품목에 있으면 사양 자리에 둔다(구매요청서의 기능 및 요구사양).
  for (const it of items) if (!it.spec && it.period) it.spec = it.period;
  const amounts = items.map((it) => it.amount).filter(Number.isFinite);
  const total = doc.total ?? (amounts.length && amounts.length === items.length ? amounts.reduce((a, b) => a + b, 0) : amounts.length === 1 ? amounts[0] : null);
  const first = items[0] || {};
  const currency = doc.currency || items.find((it) => it.currency)?.currency || (total != null ? 'KRW' : '');
  return {
    items, total, currency, vendor: doc.vendor || first.vendor || '', account: doc.account || items.find((it) => it.account)?.account || '',
    use: doc.use || items.find((it) => it.use)?.use || '', reason: doc.reason || items.find((it) => it.reason)?.reason || '', period: doc.period || first.period || '',
    overview: doc.overview || '', summary: doc.summary || '', attach,
  };
}

/**
 * 본문 틀 HTML 을 통째로 — 제목·Job Id·차수·수신·참조와 본문(parseBody).
 * @returns {{title: string, job: string, degree: string, receive: string, reference: string, lines: string[], text: string} & ReturnType<typeof parseBody>}
 */
export function parseResearchDoc(html) {
  const d = toDoc(html);
  const v = (id) => text(d.getElementById(`ctl00_ContentPlaceHolder_Content_${id}`));
  const lines = bodyLines(html);
  return {
    title: text(d.getElementById('ctl00_ApplineInfoInReportKRTA1_lblDocTitle')) || text(d.querySelector('[id$="lblDocTitle"]')),
    job: v('lblJobID'), degree: v('lblDegree'), receive: v('lblReceive'), reference: v('lblReference'),
    lines, text: lines.join('\n'), ...parseBody(lines),
  };
}

/** 첨부 목록 화면(의견·첨부 틀) 주소 — 문서 보기 창의 frameDocOther 가 여는 것(2026-10-17 실측). */
export const attachListUrl = (row) => `${ORIGIN}/RealEANET/Main/CommentAttachmentInfo.aspx?FORMID=${row.form || RESEARCH_FORM}&DOCID=${row.id}&GROUPID=0&MDTID=0&DID=0&ISMODIFY=0&OLDDOC=&ATTYN=0&ACTYPE=-1&VIEWMODE=2&FLOWST=7&DOCTYPE=1&BOXTYPE=-1`;

/**
 * 첨부 목록 — a[href*="AttachFileDown.aspx"] 를 AttID 로 묶어 이름(FileName 또는 링크 글)과 내려받기 주소(View=0)를 낸다. 크기는 "(60.68 KB)" 글이 있으면.
 * @returns {{id: string, name: string, url: string, size: string}[]}
 */
export function parseAttachList(html) {
  const d = toDoc(html);
  const out = new Map();
  for (const a of d.querySelectorAll('a[href*="AttachFileDown.aspx"]')) {
    const href = a.getAttribute('href') || '';
    const u = new URL(href, ORIGIN);
    const id = u.searchParams.get('AttID') || href;
    const cur = out.get(id) || { id, name: '', url: '', size: '' };
    const name = u.searchParams.get('FileName') || '';
    if (name && !cur.name) cur.name = name;
    if (!cur.name && text(a)) cur.name = text(a).replace(/\s*\([\d.]+\s*[KMG]?B\)\s*$/i, '');
    if (u.searchParams.get('View') === '0' || !cur.url) { u.searchParams.set('View', '0'); cur.url = u.href; }
    const sz = (text(a.parentElement) || '').match(/\(([\d.]+\s*[KMG]?B)\)/i);
    if (sz && !cur.size) cur.size = sz[1];
    out.set(id, cur);
  }
  return [...out.values()].filter((f) => f.name && f.url);
}

const typeOf = (name, given) => (given && given !== 'application/octet-stream' ? given
  : /\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'application/octet-stream');

/**
 * 선행 품의를 읽는다 — 본문(parseResearchDoc)과 첨부(목록 → 파일마다 내려받기, maxFiles 개까지). 첨부 하나를 못 받으면 notes 에 적고 나머지는 간다.
 * 로그인 화면이면 AuthError. 본문 틀의 모양이 다르면(제목도 본문도 없음) 오류.
 * @param {{id: string, form?: string, params?: string}} row 공문 이력의 줄
 * @param {{fetch?: Function, fetchBytes?: Function, maxFiles?: number, maxBytes?: number}} [deps]
 * @returns {Promise<{doc: ReturnType<typeof parseResearchDoc>, files: {name: string, type: string, size: number, bytes: Uint8Array}[], notes: string[]}>}
 */
export async function readPrior(row, { fetch = siteFetch, fetchBytes = siteFetchBytes, maxFiles = 5, maxBytes = 25 * 1024 * 1024 } = {}) {
  const r = await fetch(bodyUrl({ ...row, form: row.form || RESEARCH_FORM }));
  if (looksLogin(r.html)) throw new AuthError(LOGIN);
  const doc = parseResearchDoc(r.html);
  if (!doc.title && !doc.lines.length) throw new Error('선행 품의 화면의 모양이 다릅니다.');
  const notes = [];
  const files = [];
  let list = [];
  try {
    const a = await fetch(attachListUrl(row));
    if (looksLogin(a.html)) throw new AuthError(LOGIN);
    list = parseAttachList(a.html);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    notes.push(`첨부 목록을 읽지 못했습니다 — ${err.message}`);
  }
  if (list.length > maxFiles) notes.push(`첨부가 ${list.length}개라 앞의 ${maxFiles}개만 가져왔습니다`);
  for (const f of list.slice(0, maxFiles)) {
    try {
      const got = await fetchBytes(f.url);
      if (got.bytes.length > maxBytes) { notes.push(`${f.name} 은(는) 너무 커서(${Math.round(got.bytes.length / 1048576)}MB) 넣지 않았습니다`); continue; }
      files.push({ name: f.name || got.name || `첨부${files.length + 1}`, type: typeOf(f.name || got.name, got.type), size: got.bytes.length, bytes: got.bytes });
    } catch (err) {
      if (err instanceof AuthError) throw err;
      notes.push(`${f.name} 을(를) 내려받지 못했습니다 — ${err.message}`);
    }
  }
  return { doc, files, notes };
}

/** 제목에서 품목 요지 — "[SSCB] 수행을 위한 34인치 모니터 구매 품의" → "34인치 모니터", "SSCB 연구과제 Claude 맥스 플랜 구독 품의" → "SSCB 연구과제 Claude 맥스 플랜 구독". */
export const titleGist = (title) => String(title ?? '').replace(/^\[[^\]]*\]\s*(?:수행을\s*위한\s*)?/, '').replace(/\s*(?:구매|구입|대여|임차)?\s*품의\s*$/, '').trim();

/**
 * 읽은 선행 품의 → 구매 초안 꼴(src/gongmun.js FIELDS.purchase ∪ reads ∪ currency·attach) — orderFromPurchase 가 구매의뢰 초안으로 옮긴다.
 * 품목이 없으면 품목 요지는 제목에서, 합계는 본문의 구매금액, 사유는 구매사유·구독사유, 용도는 용도, 계정은 구매계정이다. 첨부 목록(attach)은 부른 쪽이 내려받은 파일로 채운다.
 */
export function priorToPurchase(doc, { title = '' } = {}) {
  const items = (doc?.items || []).map((it) => ({
    name: it.name || '', spec: it.spec || '', qty: it.qty ?? null, unit: it.unit || '', unitPrice: it.unitPrice ?? null, amount: it.amount ?? null,
  }));
  const gist = gistOf(items, titleGist(title || doc?.title || ''));
  return {
    gist, vendor: doc?.vendor || '', total: doc?.total ?? null, use: doc?.use || '', reason: doc?.reason || '', summary: summaryOf(gist), account: doc?.account || '',
    items, quoteDate: '', supply: null, vat: null, currency: doc?.currency || 'KRW', attach: [],
  };
}

/**
 * 선행 품의가 어느 과제인가 — 과제 목록(이름·Job Id·별명·번호)에서 Job Id(RND00202026 꼴)가 같은 것, 없으면 본문 과제 개요의 과제명, 없으면 제목에 별명이 든 것. 못 찾으면 ''.
 * @param {object} doc parseResearchDoc 의 결과
 * @param {{name: string, job?: string, alias?: string, code?: string}[]} projects
 * @returns {string} 과제 이름
 */
export function priorProject(doc, projects = []) {
  const same = (a, b) => !!a && !!b && keyOf(a).toLowerCase() === keyOf(b).toLowerCase();
  const job = String(doc?.job || '').trim();
  const byJob = job && projects.find((p) => same(p.job, job) || same(String(p.code || '').replace(/-/g, ''), job.replace(/^RND0*/i, 'RND')));
  if (byJob) return byJob.name;
  const named = (doc?.lines || []).map((l) => (l.match(/과\s*제\s*명\s*[:：]\s*(.+)$/) || [])[1]).find(Boolean);
  const byName = named && projects.find((p) => same(p.name, named));
  if (byName) return byName.name;
  const title = String(doc?.title || '');
  const byAlias = projects.find((p) => p.alias && title.includes(p.alias));
  return byAlias ? byAlias.name : '';
}
