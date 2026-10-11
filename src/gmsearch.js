// 공문 검색 — 공문 탭의 **에이전트** 갈래(2026-10-12 사용자 지정: "구매/교육/출장/외부활동 옆에 '에이전트' 하나 추가해서 공문검색할 수 있는 기능 추가해줘,
// 받은공문, 보낸 공문"). 말로 적은 것("지난달 받은 출장 공문")을 방향(받은·보낸)·기간·찾을 말로 풀고, 전자결재 문서함(src/gmlist.js — 받은 공문은
// 결재함, 보낸 공문은 기안함)을 제목 검색 포스트백으로 읽어 보인다. 풀이는 규칙뿐이다(Claude 를 부르지 않는다) — 방향·기간의 말은 몇 가지로 정해져
// 있어 규칙이 더 또렷하고, Claude 가 연결되지 않은 브라우저에서도 된다.
//
// 실측(2026-10-12 CDP, 조회 포스트백만): 문서함의 제목 검색(txtSearchKeyWord)은 **이어진 한 토막**만 맞춘다 — "구매 품의" 는 그 차례로 붙은 제목만,
// "품의 구매" 는 0건. 그래서 서버에는 가장 긴 말 하나만 보내고(keyword — 읽을 쪽수를 줄인다), 모든 말(terms)은 받은 줄의 제목에서 여기서 거른다
// (띄어쓰기·대소문자 무시). 조사(을·를·이·가…)는 떼고 남은 것으로 찾는다 — 한 글자 더 떼어도 제목 안의 글이라 맞는다.
import { SPANS, DEFAULT_SPAN, spanFrom, BOX_ORDER, INBOX_ORDER, BOXES, normalizeRows } from './gmlist.js';

/** 찾은 것(저장소) — { on, dir, span, from, to, label, text, keyword, terms, at, read, rows, notes }. */
export const SEARCH_KEY = 'gongmunSearch';
/** 갈래 줄의 에이전트 단추가 쓰는 표 — 레시피의 갈래(KINDS)가 아니다. */
export const AGENT_KIND = 'agent';
/** 방향 — 받은 공문(결재함)·보낸 공문(기안함). */
export const DIRS = ['in', 'out'];
export const DEFAULT_DIR = 'in';
export const DIR_LABEL = { in: '받은 공문', out: '보낸 공문' };
export const DIR_BOXES = { in: INBOX_ORDER, out: BOX_ORDER };
export const DIR_TITLE = {
  in: `결재함(${INBOX_ORDER.map((b) => BOXES[b].label).join('·')}) — 내게 결재·참조로 온 공문`,
  out: `기안함(${BOX_ORDER.map((b) => BOXES[b].label).join('·')}) — 내가 기안한 공문`,
};
/** 기간 단추(3개월·올해·1y·2y)에 없는 기간 — 말로 적은 지난달·작년·9월·2025년 같은 것. from·to 가 든다. */
export const CUSTOM = 'custom';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const monthRange = (y, m) => ({ from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m)) });
const yearRange = (y) => ({ from: `${y}-01-01`, to: `${y}-12-31` });
const yearOf = (today) => +String(today).slice(0, 4);
/** 오늘에서 n 달 전 같은 날(달이 짧으면 다음 달로 넘어간다 — spanFrom 의 3m 과 같은 셈). */
const monthsAgo = (today, n) => { const [y, m, d] = String(today).split('-').map(Number); const x = new Date(y, m - 1 - n, d); return ymd(x.getFullYear(), x.getMonth() + 1, x.getDate()); };

/** 기간 단추의 말 — 상태 줄·빈 목록의 말에 쓴다. */
export const rangeLabel = (span, today) => ({ '3m': '최근 3개월', y0: '올해' }[span] || `${spanFrom(span, today).slice(0, 4)}년부터`);

/**
 * 기간의 말 — 차례대로 처음 맞는 것 하나. 해·달이 붙은 것(2025년 9월)이 해(2025년)보다, 해가 달(9월)보다 먼저다. 달만 적으면 올해의 그 달(아직 안 온 달이면 작년).
 * "3개월"·"최근" 은 기간 단추의 3개월, "1년"·"2년" 은 1y·2y 로 간다 — 단추에 불이 들어온다.
 */
const PERIOD_RULES = [
  [/(\d{4})\s*년\s*(\d{1,2})\s*월/, (m) => (m[2] >= 1 && m[2] <= 12 ? { ...monthRange(+m[1], +m[2]), label: `${+m[1]}년 ${+m[2]}월` } : null)],
  [/(\d{4})\s*년/, (m) => ({ ...yearRange(+m[1]), label: `${+m[1]}년` })],
  [/(\d{1,2})\s*월(?!\s*간)/, (m, today) => {
    const mo = +m[1];
    if (mo < 1 || mo > 12) return null;
    const [y, cm] = String(today).split('-').map(Number);
    const yy = mo > cm ? y - 1 : y;
    return { ...monthRange(yy, mo), label: `${yy !== y ? `${yy}년 ` : ''}${mo}월` };
  }],
  [/올해|금년|이번\s*해/, () => ({ span: 'y0' })],
  [/재작년/, (_, today) => ({ ...yearRange(yearOf(today) - 2), label: `재작년(${yearOf(today) - 2}년)` })],
  [/작년|지난\s*해/, (_, today) => ({ ...yearRange(yearOf(today) - 1), label: `작년(${yearOf(today) - 1}년)` })],
  [/지난\s*달|저번\s*달|전월/, (_, today) => { const [y, m] = String(today).split('-').map(Number); const d = new Date(y, m - 2, 1); return { ...monthRange(d.getFullYear(), d.getMonth() + 1), label: '지난달' }; }],
  [/이번\s*달|이달|당월|금월/, (_, today) => { const [y, m] = String(today).split('-').map(Number); return { ...monthRange(y, m), label: '이번 달' }; }],
  [/(\d+)\s*개월/, (m, today) => { const n = +m[1]; return !n ? null : n === 3 ? { span: '3m' } : { from: monthsAgo(today, n), to: today, label: `최근 ${n}개월` }; }],
  [/(\d+)\s*년(?:\s*(?:간|치|동안|전부터|전))?/, (m, today) => { const n = +m[1]; return !n ? null : n === 1 ? { span: 'y1' } : n === 2 ? { span: 'y2' } : { from: `${yearOf(today) - n}-01-01`, to: today, label: `${yearOf(today) - n}년부터` }; }],
  [/최근|요즘/, () => ({ span: '3m' })],
];

/** 기간의 말을 찾는다 — { span?, from?, to?, label?, hit(맞은 글) } 또는 null. */
export function parsePeriod(text, today) {
  for (const [re, fn] of PERIOD_RULES) {
    const m = String(text || '').match(re);
    if (!m) continue;
    const got = fn(m, today);
    if (got) return { ...got, hit: m[0] };
  }
  return null;
}

/** 방향의 말 — 받은(결재·참조로 온 것)·보낸(기안한 것). "결재" 만으로는 어느 쪽인지 몰라 세지 않는다. */
const DIR_RULES = [
  ['in', /받은|수신|접수|결재할|결재\s*(?:함|요청|올라온)|참조|미결|내게\s*온|나한테\s*온|들어온/g],
  ['out', /보낸|발송|기안한?|상신|올린|내가\s*(?:쓴|보낸|올린|만든|작성한?)|작성한|내\s*공문/g],
];

/** 찾을 말이 아닌 것 — 통째로 같은 토막만 뺀다("거래명세서" 의 '거' 는 건드리지 않는다). */
const FILLER = new Set(['공문', '문서', '찾아줘', '찾아', '찾아봐', '찾기', '검색', '검색해줘', '검색해', '보여줘', '보여', '알려줘', '알려', '줘', '주세요', '해줘', '해', '중에서', '중에', '중', '가운데',
  '관련', '관련된', '관련해서', '관한', '대한', '목록', '리스트', '좀', '것', '거', '건', '내역', '이력', '있어', '있나', '있니', '있는지', '뭐', '뭐가', '어떤', '어느', '전부', '전체', '모두', '다', '모든', '나온', '온', '의', '및', '그리고', '또는', '와', '과']);
/** 토막 끝의 조사 — 세 글자 이상일 때만 뗀다("출장을" → 출장). */
const PARTICLE_RE = /(?:에서|으로|을|를|은|는|이|가|과|와|도|만|로)$/;
/** 토막 끝에 붙은 '공문·문서·관련' — "출장공문" → 출장. */
const TAIL_RE = /(?:공문|문서|관련)$/;
const SPLIT_RE = /[\s,.;:/·'"“”‘’()[\]!?~]+/;
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

/** 남은 글에서 찾을 말들 — 두 글자 이상, 겹치지 않게, 적은 차례대로. */
export function termsOf(text) {
  const out = [];
  for (let tok of String(text || '').split(SPLIT_RE)) {
    tok = tok.trim();
    if (FILLER.has(tok)) continue;
    const bare = tok.replace(TAIL_RE, '');
    if (bare.length >= 2) tok = bare;
    if (tok.length >= 3) tok = tok.replace(PARTICLE_RE, '');
    if (FILLER.has(tok) || tok.length < 2) continue;
    if (!out.some((t) => norm(t) === norm(tok))) out.push(tok);
  }
  return out;
}

/**
 * 말을 푼다 — 방향·기간·찾을 말. 말에 없는 것은 지금 고른 것(dir·span·from·to·label)을 그대로 둔다.
 * @param {string} text
 * @param {{today: string, dir?: string, span?: string, from?: string, to?: string, label?: string}} o
 * @returns {{dir: string, span: string, from: string, to: string, label: string, keyword: string, terms: string[], said: {dir: boolean, period: boolean}}}
 *   keyword 는 서버에 보내는 가장 긴 말(없으면 빈 글), terms 는 제목에서 거를 말 전부
 */
export function parseQuery(text, { today, dir = DEFAULT_DIR, span = DEFAULT_SPAN, from = '', to = '', label = '' } = {}) {
  let rest = String(text || '');
  const out = { dir, span, from, to, label, keyword: '', terms: [], said: { dir: false, period: false } };
  for (const [d, re] of DIR_RULES) {
    if (!re.test(rest)) { re.lastIndex = 0; continue; }
    re.lastIndex = 0;
    out.dir = d;
    out.said.dir = true;
    rest = rest.replace(re, ' ');
    break;
  }
  const p = parsePeriod(rest, today);
  if (p) {
    out.said.period = true;
    rest = rest.replace(p.hit, ' ');
    if (p.span) Object.assign(out, { span: p.span, from: '', to: '', label: '' });
    else Object.assign(out, { span: CUSTOM, from: p.from, to: p.to, label: p.label });
  }
  out.terms = termsOf(rest);
  out.keyword = out.terms.reduce((a, b) => (b.length > a.length ? b : a), '');
  return out;
}

/** 읽을 기간 — 기간 단추면 그 첫날부터 오늘까지, 말로 적은 기간이면 그 from·to. */
export function periodOf({ span, from, to, label } = {}, today) {
  if (span === CUSTOM && DATE_RE.test(from) && DATE_RE.test(to)) return { from, to, label: label || `${from} ~ ${to}` };
  const s = SPANS.includes(span) ? span : DEFAULT_SPAN;
  return { from: spanFrom(s, today), to: today, label: rangeLabel(s, today) };
}

/** 제목에 모든 말이 드는가(띄어쓰기·대소문자 무시). 말이 없으면 다 든다. */
export const matchRow = (row, terms) => { const t = norm(row?.title); return (terms || []).every((w) => t.includes(norm(w))); };
export const filterRows = (rows, terms) => (terms?.length ? (rows || []).filter((r) => matchRow(r, terms)) : (rows || []));

/** 읽어 둔 것이 지금 조건의 것인가 — 방향·기간·서버에 보낸 말이 같아야 한다(제목에서 거르는 말은 여기서 걸러 보이니 상관없다). */
export const sameRead = (a, b) => !!a && !!b && a.dir === b.dir && a.from === b.from && a.to === b.to && a.keyword === b.keyword;

/** 저장소의 것을 이 꼴로 — 모르는 것은 버린다. 말로 적은 기간(custom)은 from·to 가 날짜여야 한다. */
export function normalizeSearch(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const from = String(r.from || '');
  const to = String(r.to || '');
  const custom = r.span === CUSTOM && DATE_RE.test(from) && DATE_RE.test(to);
  const span = custom ? CUSTOM : SPANS.includes(r.span) ? r.span : DEFAULT_SPAN;
  const read = r.read && typeof r.read === 'object' ? { dir: String(r.read.dir || ''), from: String(r.read.from || ''), to: String(r.read.to || ''), keyword: String(r.read.keyword || '') } : null;
  return {
    on: r.on === true, dir: DIRS.includes(r.dir) ? r.dir : DEFAULT_DIR, span, from: custom ? from : '', to: custom ? to : '', label: custom ? String(r.label || '') : '',
    text: String(r.text || ''), keyword: String(r.keyword || ''), terms: Array.isArray(r.terms) ? r.terms.map(String).filter(Boolean) : [],
    at: Number.isFinite(r.at) ? r.at : 0, read, rows: normalizeRows(r.rows), notes: Array.isArray(r.notes) ? r.notes.map(String) : [],
  };
}
