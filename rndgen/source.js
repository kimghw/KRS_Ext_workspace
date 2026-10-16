// 사업계획서·연구계획서 한 벌 → LLM 에 줄 재료(Material)(2026-10-16) — R&D 탭의 ＋(과제 더하기)와 변경사항 카드가 쓴다(rndgen/panel.js).
// 국가 R&D 사업계획서는 100~300쪽이고 그 가운데 한국선급(KR)의 몫은 몇십 쪽이다. 통째로 보내면 느리고 비싸며 한도에 걸린다 — 그래서
// 쪽마다 점수를 매겨 고른다: 앞 3쪽(표지·요약문)은 늘, 나머지는 KR 블록(02장 개발목표·개발내용·성능목표·성과지표·수행일정, 06장 연구실
// 안전관리비, 07장 참여연구자, 08장 연구개발비 사용계획의 KR 표)일수록 높게. 고른 쪽은 "— N쪽 —" 표시를 단 글로 싣고, 같은 쪽만 잘라 낸
// 작은 PDF 를 붙인다(표의 칸은 그림으로 보는 편이 정확하다).
//
//   pdf    : 글자 층(pdf.js, doctext/browser.js pdfAllText) → 쪽 고르기(pickPages) → 그 쪽만 작은 PDF(pdf-lib) — attach 'slice'
//            글자 층이 없으면(스캔본) 원본을 8MB 안일 때만 그대로 붙인다(attach 'original'), 아니면 붙이지 못한다(attach 'none' + 경고).
//   office : hwpx·docx·xlsx·pptx 의 글자(src/officetext.js) → 구역 고르기(pickChunks) — 글자만.
//   text   : txt·md 는 그대로 글 → 구역 고르기 — 글자만.
//   yaml·hwp·모름 : 던진다(YAML 은 재료가 아니라 그대로 넣는 파일이고, 옛 한글은 뽑지 못한다).
//
// 엔진(pdf.js·pdf-lib·officetext)은 주입한다 — 점수·고르기·글 잇기는 엔진 없이 검사된다. 가져오기만으로는 chrome·DOM·fetch 를 만지지 않는다
// (test/wiring.test.mjs 가 jsdom 에서 sidepanel.js 를 통째로 가져온다). 진짜 엔진은 defaultEngines() 가 쓸 때 import() 한다.
// 한도·결정은 계약서 §1-10(고른 쪽 ≤ 24 · 글자 ≤ 90,000자 · 원본 ≤ 20MB · 스캔본 원본 첨부 ≤ 8MB).

import { officeKind } from '../src/officetext.js';

/** 한도 — 계약서 §1-10. readDocument 의 limits 로 일부만 바꿔 끼울 수 있다(검사). */
export const LIMITS = Object.freeze({
  textChars: 90_000,        // 재료 글 한도(쪽/구역을 고를 때의 예산)
  pdfPages: 24,             // 작은 PDF 에 넣는 쪽 수 상한
  alwaysPages: 3,           // 앞 3쪽(표지·요약)은 늘
  pdfBytesMax: 20 * 1024 * 1024,     // 원본 PDF 상한 — 넘으면 던진다
  attachBytesMax: 8 * 1024 * 1024,   // 글자 층 없는 스캔본을 원본째 붙일 때의 상한(작은 PDF 도 이보다 크면 붙이지 않는다)
  officeChars: 150_000,     // officeText 의 max
  chunkChars: 3_000,        // office/text 를 구역으로 나누는 크기
});

/** 점수 낱말과 가중치 — 쪽/구역 고르기. 표지 식별(과제명·과제번호·연구개발기간)·KR 블록·02장·08장·06장 안전관리비. */
export const KEYWORDS = Object.freeze([['한국선급', 5], ['KR', 1], ['공동연구개발기관', 3], ['연구개발비', 3], ['사용계획', 3], ['비목', 2], ['간접비', 2], ['연구활동비', 2],
  ['참여연구자', 3], ['참여연구원', 3], ['인건비', 2], ['개발목표', 3], ['개발내용', 3], ['수행일정', 3], ['성과지표', 3], ['성능목표', 3], ['주요결과물', 2], ['외주용역', 2],
  ['세부사용계획', 2], ['안전관리비', 2], ['연차별', 2], ['차년도', 1], ['연구개발기간', 3], ['과제명', 2], ['연구개발과제번호', 3], ['주관연구개발기관', 2], ['협약', 1]]);

/** 깎는 낱말 — 07장의 실적(논문·특허·기술이전·사업화)·장비 보유현황은 KR 이 나와도 스냅샷에 쓰지 않는다. */
const PENALTIES = Object.freeze([['논문', 2], ['특허', 2], ['지식재산권', 3], ['기술이전', 2], ['사업화', 2], ['실적', 2], ['보유현황', 2]]);
/** 한 낱말이 한 쪽에서 셈에 드는 횟수의 상한 — 표 머리가 줄마다 되풀이돼도 한 낱말이 점수를 다 먹지 않게. "한국선급"만은 KR_CAP 까지 센다 —
 *  여러 기관을 한 표에 적은 08장 세부 사용계획·07장 참여연구자 표에서 KR 행이 많은 쪽이 바로 KR 의 값이 든 쪽이다. */
const KEY_CAP = 3;
const KR_CAP = 6;
/** KR 이 나오지 않는 쪽의 점수 배율 — 다른 기관의 블록 안이면 OTHER, 어느 블록도 아니면(총괄표·장 머리) NEUTRAL. 08장은 기관마다 같은 낱말의 같은 표라 이것으로 가른다. */
const OTHER_FACTOR = 0.25;
const NEUTRAL_FACTOR = 0.5;
/** 이보다 점수가 낮은 쪽은 자리가 남아도 고르지 않는다(앞 always 쪽은 빼고). */
const MIN_SCORE = 1;
/** 뛴 곳 표시(office/text). */
const SKIP_MARK = '(… 생략 …)';
const PDF_TYPE = 'application/pdf';

/* ------------------------------------------------------------ 갈래 */

/** 끝의 확장자(소문자) — "2026.10.15 보고" 처럼 점 뒤가 확장자 꼴이 아니면 ''. */
function extOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

const YAML_MIME = /^(text|application)\/(x-)?yaml$/;
const TEXT_MIME = /^text\/(plain|markdown|x-markdown)$/;
const HWP_MIME = /^application\/(x-hwp|haansofthwp|vnd\.hancom\.hwp)$/;

/** 파일의 갈래 — 'yaml' | 'pdf' | 'office'(hwpx·docx·xlsx·pptx) | 'text'(txt·md) | 'hwp'(옛 한글 — 못 뽑음) | ''(모름). 이름의 확장자 먼저, 없으면 MIME. */
export function docKind(name, type = '') {
  const ext = extOf(name);
  if (ext) {
    if (ext === 'yaml' || ext === 'yml') return 'yaml';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'txt' || ext === 'md' || ext === 'markdown') return 'text';
    if (ext === 'hwp') return 'hwp';
    return officeKind(name) ? 'office' : '';
  }
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  if (!t) return '';
  if (t === PDF_TYPE) return 'pdf';
  if (YAML_MIME.test(t)) return 'yaml';
  if (TEXT_MIME.test(t)) return 'text';
  if (HWP_MIME.test(t)) return 'hwp';
  return officeKind('', t) ? 'office' : '';
}

/** 받을 수 없는 문서의 안내 — 'hwp' 면 옛 한글 안내, '' 면 넣을 수 있는 것의 목록, 받는 것이면 ''. */
export function unsupportedDocNote(name, type = '') {
  const kind = docKind(name, type);
  if (kind === 'hwp') return '옛 한글(.hwp)은 뽑지 못합니다 — 한글에서 PDF 로 저장해 넣으세요(.hwpx 는 그대로 됩니다)';
  if (kind) return '';
  const ext = extOf(name);
  return `${ext ? `.${ext} ` : '이 '}파일은 넣을 수 없습니다 — 넣을 수 있는 것: YAML(.yaml/.yml) · PDF · HWPX · DOCX · XLSX · TXT/MD`;
}

/* ------------------------------------------------------------ 점수 */

/** 한글 낱말은 글자 사이 빈칸을 견딘다 — PDF 글자 층은 "참여 연구자"·"연구개발 비"처럼 표 칸에서 끊겨 나온다. 영문 낱말(KR)은 낱말 경계로(KRW·KRISO 는 아니다). */
const keyRe = (word) => (/^[A-Za-z]+$/.test(word)
  ? new RegExp(`(?<![A-Za-z])${word}(?![A-Za-z])`, 'g')
  : new RegExp([...word].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'g'));
const KEY_RES = KEYWORDS.map(([word, weight]) => [keyRe(word), weight, word === '한국선급' ? KR_CAP : KEY_CAP]);
const PENALTY_RES = PENALTIES.map(([word, weight]) => [keyRe(word), weight, KEY_CAP]);
/** 목차 — "목 차" 줄이 있거나 점선 끌기(·····)가 다섯 줄 넘으면. 낱말은 다 들어 있지만 값이 없다. */
const TOC_RE = /^\s*목\s*차\s*$/m;
const LEADER_RE = /[·.…ㆍ‥]{5,}/g;

/** 천원 단위 금액(쉼표로 묶은 수)·백분율·표 금. */
const AMOUNT_RE = /\d{1,3}(?:,\d{3})+/g;
const PERCENT_RE = /\d(?:\.\d+)?\s*%/g;
const RULE_RE = /[│┃|]/g;
const count = (text, re) => (text.match(re) || []).length;

/**
 * 표 같음 가산 — 08장 예산표·07장 참여연구자 표·02장 성능목표 표는 숫자로 차 있다. 금액(쉼표 묶음) 넷마다 1(6까지), "천원" 2, 백분율 셋마다 1(2까지), 표 금 열마다 1(2까지).
 */
function tableBonus(text) {
  return Math.min(6, Math.floor(count(text, AMOUNT_RE) / 4))
    + (/천\s*원/.test(text) ? 2 : 0)
    + Math.min(2, Math.floor(count(text, PERCENT_RE) / 3))
    + Math.min(2, Math.floor(count(text, RULE_RE) / 10));
}

/**
 * 쪽(또는 구역) 글 하나의 점수 — KEYWORDS 합(낱말마다 무게 × 나온 횟수, 횟수는 KEY_CAP 까지) + 표 같음(숫자·천원·%·│ 많음) 가산
 * − 깎는 낱말(실적·특허 …). 목차는 0, 빈 글은 0, 0 아래로는 내려가지 않는다. 정수다.
 */
export function scorePage(text) {
  const s = String(text || '');
  if (!s.trim() || isToc(s)) return 0;
  let score = 0;
  for (const [re, weight, cap] of KEY_RES) score += weight * Math.min(cap, count(s, re));
  for (const [re, weight, cap] of PENALTY_RES) score -= weight * Math.min(cap, count(s, re));
  return Math.max(0, score + tableBonus(s));
}

/* ------------------------------------------------------------ 장·기관 블록 따라가기 */

// 낱말만으로는 모자란다 — 2026-10-16 실물 사업계획서 다섯 벌(107~354쪽)에 돌려 보고 둘을 더했다.
//  ① 기관 블록: 사업계획서는 기관마다 블록을 나눠 적는다 — "[공동연구개발기관2 : 한국선급]" 같은 머리 한 줄 뒤에 몇 쪽이 이어지고, 이어지는
//     쪽에는 "한국선급"이 다시 나오지 않는 일이 많다(02장 개발내용·08장 세부 사용계획). 그래서 머리를 따라가며 KR 블록의 쪽에 KR_BLOCK 을 더한다.
//     거꾸로 08장의 기관별 표처럼 낱말·숫자가 똑같은 다른 기관의 쪽은 KR 이 한 번도 안 나오면 OTHER_FACTOR 로 깎는다 — 깎지 않으면 다른 기관의
//     예산표가 KR 의 것보다 먼저 자리를 차지했다. 다른 기관의 머리, 장·절 제목, CARRY_PAGES 를 넘김이 블록을 끝낸다.
//  ② 장: 표준 양식(범부처 연구개발계획서)의 장 제목으로 지금 어느 장인지 따라가 장마다 배율을 곱한다 — 02·06·07·08장은 그대로, 03장(추진체계 ·
//     연구개발팀 편성도)은 조금, 01·04·05장(필요성·활용·사업화)과 실적·장비·보안 절은 많이 깎는다. 07장의 실적 표(과제명·연구개발기간·연구개발비 칸)와
//     01장의 배경 글이 낱말로는 KR 블록만큼 점수를 받았다. 장 번호는 글자 층에서 제목 뒤로 가기도 한다("연구개발비 사용에 관한 계획8.").

const ORG_HEAD_RE = /^[\s[(<［【〔「\d.)\]:-]*(?:주\s*관|공\s*동|위\s*탁)\s*연\s*구\s*(?:개\s*발|수\s*행)\s*기\s*관/;
/** 기관 이름만 괄호에 넣은 머리 — "[한국선급]" · "[11. 한국선급]" · "[코오롱 중앙기술원]"(기관이 열 곳 넘는 계획서). 표·그림·요약표 같은 괄호 제목은 뺀다. */
const BRACKET_HEAD_RE = /^[[［【〔]\s*(?:\d{1,2}\s*[.)]\s*)?([^\]］】〕]{2,30})[\]］】〕]$/;
const NOT_ORG_RE = /요\s*약|그\s*림|표\s*\d|확\s*약|첨\s*부|별\s*첨|예\s*시|참\s*고|단\s*위|계\s*획|현\s*황|목\s*록|목\s*표|일\s*정|내\s*용|양\s*식|서\s*식|[√✓∨]/;
const KR_RE = /한\s*국\s*선\s*급|(?<![A-Za-z])KR(?![A-Za-z])/;
const KR_ALL_RE = new RegExp(KR_RE.source, 'g');
/** KR 블록(머리가 있는 쪽과 이어지는 쪽)에 더하는 점수와, 머리 뒤로 이어 보는 쪽 수. */
const KR_BLOCK = 10;
const CARRY_PAGES = 12;

/** 장 제목 — "8. 연구개발비 사용에 관한 계획" 또는 (글자 층이 번호를 뒤로 보낸) "연구개발비 사용에 관한 계획8.". 번호와 제목 낱말이 둘 다 맞아야 장이다. */
const CHAPTER_RE = /^([1-8])\s*\.\s*([가-힣].*)$|^([가-힣].*?)\s*([1-8])\s*\.$/;
const CHAPTERS = Object.freeze({
  1: [/필\s*요\s*성/, 0.3],
  2: [/목\s*표\s*및\s*내\s*용/, 1],
  3: [/추\s*진\s*(?:전\s*략|체\s*계)/, 0.6],
  4: [/활\s*용\s*방\s*안|기\s*대\s*효\s*과/, 0.3],
  5: [/사\s*업\s*화/, 0.3],
  6: [/안\s*전|보\s*안/, 1],
  7: [/기\s*관\s*현\s*황/, 1],
  8: [/연\s*구\s*개\s*발\s*비/, 1],
});
/** 절 제목 — "8-3. 연구개발비 세부 사용계획" 또는 "연구개발비 세부 사용계획8-3.". 장은 번호로 정하고, 이 낱말이 든 절은 LOW_ZONE. */
const SUB_RE = /^([1-8])-\d{1,2}\s*\.\s*([가-힣].*)$|^([가-힣].*?)\s*([1-8])-\d{1,2}\s*\.$/;
const LOW_SUB_RE = /실\s*적|보\s*유\s*현\s*황|일\s*반\s*현\s*황|시\s*설\s*[·ㆍ･]?\s*장\s*비|지\s*식\s*재\s*산|보\s*안/;
const LOW_ZONE = 0.3;
/** 첨부·별첨 — 활용계획서(외주 용역·시약 재료)는 KR 몫이 있을 수 있어 조금만 깎는다. */
const APPENDIX_RE = /^(?:첨\s*부|별\s*첨)\s*\d*/;
const APPENDIX_ZONE = 0.6;

/** 줄 하나가 장·절·첨부의 제목이면 그 배율, 아니면 null. */
function zoneOf(line) {
  if (APPENDIX_RE.test(line)) return APPENDIX_ZONE;
  let m = SUB_RE.exec(line);
  if (m) return LOW_SUB_RE.test(m[2] || m[3]) ? LOW_ZONE : CHAPTERS[m[1] || m[4]][1];
  m = CHAPTER_RE.exec(line);
  if (m) {
    const [want, zone] = CHAPTERS[m[1] || m[4]];
    if (want.test(m[2] || m[3])) return zone;
  }
  return null;
}

/**
 * 한 쪽의 줄에서 머리를 차례로 — { kind: 'kr'(KR 기관 머리) | 'other'(다른 기관 머리) | 'section'(장·절·첨부 제목), zone?, at }.
 * at 은 빈 줄을 뺀 줄 번호(0부터) — 쪽 맨 위(LEAD_LINES 안)의 머리는 그 쪽 전체의 머리로 본다. 긴 줄(본문 문장)은 머리가 아니다.
 */
function headsOf(text) {
  const out = [];
  let at = -1;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    at += 1;
    if (line.length > 60) continue;
    const bracket = BRACKET_HEAD_RE.exec(line);
    if (ORG_HEAD_RE.test(line) || (bracket && (KR_RE.test(bracket[1]) || !NOT_ORG_RE.test(bracket[1])))) {
      out.push({ kind: KR_RE.test(line) ? 'kr' : 'other', at });
      continue;
    }
    const zone = zoneOf(line);
    if (zone != null) out.push({ kind: 'section', zone, at });
  }
  return out;
}
/** 쪽 맨 위로 보는 줄 수 — 쪽 번호("- 13 -")·장 제목·절 제목·기관 머리가 이 안에 겹쳐 온다. */
const LEAD_LINES = 4;

const isToc = (text) => TOC_RE.test(text) || count(text, LEADER_RE) >= 5;

/**
 * 쪽(구역)마다 점수 — scorePage 에 기관 블록·장을 따라간 가감을 한 것. pickPages·pickChunks 가 쓴다. 차례는 받은 차례(1쪽이 [0]). 정수다.
 *   KR 이 나오는 쪽                         → scorePage            (KR 기관 머리가 있는 쪽은 + KR_BLOCK)
 *   KR 블록이 이어지는 쪽(머리는 앞 쪽에)   → scorePage + KR_BLOCK
 *   다른 기관의 블록 안인 쪽                → scorePage × OTHER_FACTOR (이 쪽 첫 머리가 다른 기관이거나, 다른 기관 블록이 이어짐)
 *   어느 블록도 아닌 쪽                     → scorePage × NEUTRAL_FACTOR
 * "이 쪽의 블록"은 쪽 맨 위(LEAD_LINES 줄 안)의 머리로 정한다 — 거기 기관 머리가 있으면 (마지막) 그 기관, 장·절 제목만 있으면 블록 없음, 맨 위에 머리가
 * 없으면 앞에서 이어 온 블록("8-2. 연구개발비 사용계획" 바로 아래 "[주관연구개발기관 : …]" 이면 그 쪽은 주관기관의 것이다).
 * 그다음 장 배율(CHAPTERS·LOW_ZONE·APPENDIX_ZONE)을 곱한다 — 쪽 안에서 장이 바뀌면 큰 쪽, 다만 쪽 맨 위에 장·절 제목이 있으면 앞 장의 배율은 치지
 * 않는다. 첫 장 제목 앞(표지·요약문)은 1. 목차 쪽은 0 이고 따라가기에 넣지 않는다.
 * @param {string[]} texts
 * @returns {number[]}
 */
export function scorePages(texts) {
  let ctx = null;     // 'kr' | 'other' | null — 앞 쪽에서 이어 온 기관 블록
  let since = 0;      // 블록 머리 뒤로 지난 쪽 수
  let zone = 1;       // 지금 장의 배율
  return (Array.isArray(texts) ? texts : []).map((raw) => {
    const text = String(raw ?? '');
    if (isToc(text)) return 0;
    const base = scorePage(text);
    const carried = since < CARRY_PAGES ? ctx : null;
    const heads = headsOf(text);
    const lead = heads.filter((h) => h.at < LEAD_LINES);
    const leadOrg = lead.filter((h) => h.kind !== 'section').at(-1);
    const top = !lead.length ? carried : leadOrg ? leadOrg.kind : null;
    const sections = heads.filter((h) => h.kind === 'section').map((h) => h.zone);
    const zones = lead.some((h) => h.kind === 'section') ? sections : [zone, ...sections];
    for (const h of heads) {
      if (h.kind === 'section') zone = h.zone;
      ctx = h.kind === 'section' ? null : h.kind;
    }
    since = heads.length ? 0 : since + 1;
    const krHead = heads.some((h) => h.kind === 'kr');
    let score;
    if (krHead) score = base + KR_BLOCK;
    else if (count(text, KR_ALL_RE)) score = base;
    else if (top === 'kr') score = base + KR_BLOCK;
    else score = base * (top === 'other' ? OTHER_FACTOR : NEUTRAL_FACTOR);
    return Math.floor(score * Math.max(...zones));
  });
}

/* ------------------------------------------------------------ 고르기 */

/** 울타리(<<< >>>) 깨짐 막기 — 재료 글 안의 ">>>" 는 "> > >" 로. */
const fence = (text) => String(text || '').replace(/>{3,}/g, (m) => [...m].join(' '));
const pageMark = (n) => `— ${n}쪽 —`;

/** PDF 쪽 글 다듬기 — 빈칸 묶음은 하나로, 줄 앞뒤 빈칸과 세 줄 넘는 빈 줄은 뗀다(글자 예산을 빈칸에 쓰지 않게). */
function tidyPage(text) {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 쪽 고르기 — 앞 always 쪽은 늘, 나머지는 점수 높은 차례로 budget(글자)·max(쪽) 안에서. 돌려주는 것은 1부터 센 쪽 번호 오름차순.
 * 글자는 pagesText 가 이을 꼴 그대로 센다(쪽 표시·빈 줄 포함). 쪽이 max 안이고 다 합쳐도 budget 안이면 전부. 점수가 같으면 앞 쪽이 먼저.
 * 점수가 MIN_SCORE 보다 낮은 쪽은 자리가 남아도 넣지 않는다. 예산을 넘는 쪽은 건너뛰고 다음 쪽을 본다.
 * @param {string[]} pages
 * @returns {number[]}
 */
export function pickPages(pages, { max = LIMITS.pdfPages, always = LIMITS.alwaysPages, budget = LIMITS.textChars } = {}) {
  const list = Array.isArray(pages) ? pages.map((p) => String(p ?? '')) : [];
  const cost = (i) => pageMark(i + 1).length + 1 + list[i].length + 2;
  const all = list.reduce((a, _, i) => a + cost(i), 0);
  if (list.length <= max && all <= budget) return list.map((_, i) => i + 1);
  const scores = scorePages(list);
  const chosen = new Set();
  let used = 0;
  for (let i = 0; i < Math.min(always, max, list.length); i++) {
    chosen.add(i);
    used += cost(i);
  }
  const order = list.map((_, i) => i).filter((i) => !chosen.has(i) && scores[i] >= MIN_SCORE)
    .sort((a, b) => scores[b] - scores[a] || a - b);
  for (const i of order) {
    if (chosen.size >= max) break;
    if (used + cost(i) > budget) continue;
    chosen.add(i);
    used += cost(i);
  }
  return [...chosen].sort((a, b) => a - b).map((i) => i + 1);
}

/** 쪽 글들을 "— N쪽 —" 표시로 잇는다(고른 쪽만). picked 는 1부터 센 쪽 번호. */
export function pagesText(pages, picked) {
  const list = Array.isArray(pages) ? pages : [];
  return (picked || []).filter((n) => n >= 1 && n <= list.length)
    .map((n) => `${pageMark(n)}\n${fence(list[n - 1] ?? '').trim()}`.trim()).join('\n\n');
}

/** 긴 문단을 size 안의 조각으로 — 줄에서 끊고, 한 줄이 그래도 길면 그 자리에서 자른다. */
function splitLong(para, size) {
  const out = [];
  let cur = '';
  for (const line of para.split('\n')) {
    for (let at = 0; at < Math.max(1, line.length); at += size) {
      const piece = line.slice(at, at + size);
      if (cur && cur.length + 1 + piece.length > size) {
        out.push(cur);
        cur = piece;
      } else {
        cur = cur ? `${cur}\n${piece}` : piece;
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 글을 빈 줄로 나눠 chunk 글자 안의 구역으로 묶는다(문서 차례). */
function chunksOf(text, size) {
  const out = [];
  let cur = '';
  for (const para of text.split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean)) {
    for (const piece of para.length > size ? splitLong(para, size) : [para]) {
      if (cur && cur.length + 2 + piece.length > size) {
        out.push(cur);
        cur = piece;
      } else {
        cur = cur ? `${cur}\n\n${piece}` : piece;
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 긴 글(office/text)을 빈 줄로 나눠 chunkChars 구역으로 묶고 점수로 고른다 — 차례는 문서 차례, 뛴 곳은 "(… 생략 …)".
 * 다 합쳐 budget 안이면 전부(표시 없이). 아니면 첫 구역(제목·표지)은 늘, 나머지는 점수 높은 차례로 budget 안에서.
 * @returns {{ text: string, picked: number, total: number }}  picked·total 은 구역 수
 */
export function pickChunks(text, { budget = LIMITS.textChars, chunk = LIMITS.chunkChars } = {}) {
  const body = String(text || '').replace(/\r\n?/g, '\n').trim();
  const chunks = chunksOf(body, Math.max(1, chunk));
  if (!chunks.length) return { text: '', picked: 0, total: 0 };
  const whole = chunks.join('\n\n');
  if (whole.length <= budget) return { text: fence(whole), picked: chunks.length, total: chunks.length };
  const scores = scorePages(chunks);
  // 구역마다 넉넉히 센다(잇는 빈 줄 + 앞에 생략 표시가 붙을 수 있음) — 끝의 글이 budget 을 넘지 않는다.
  const cost = (i) => chunks[i].length + 2 + SKIP_MARK.length + 2;
  const chosen = new Set([0]);
  let used = cost(0) + SKIP_MARK.length + 2;   // 끝에 붙는 생략 표시
  const order = chunks.map((_, i) => i).filter((i) => i > 0 && scores[i] >= MIN_SCORE).sort((a, b) => scores[b] - scores[a] || a - b);
  for (const i of order) {
    if (used + cost(i) > budget) continue;
    chosen.add(i);
    used += cost(i);
  }
  const out = [];
  let prev = -1;
  for (const i of [...chosen].sort((a, b) => a - b)) {
    if (i > prev + 1) out.push(SKIP_MARK);
    out.push(chunks[i]);
    prev = i;
  }
  if (prev < chunks.length - 1) out.push(SKIP_MARK);
  return { text: fence(out.join('\n\n')), picked: chosen.size, total: chunks.length };
}

/* ------------------------------------------------------------ 바이트 */

/** 바이트 → data URL(큰 바이트도 — 덩어리로 btoa). 덩어리는 3의 배수라 이어 붙인 base64 가 한 번에 만든 것과 같다. */
export function toDataUrl(bytes, type) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const STEP = 3 * 0x2000;
  const parts = [];
  for (let i = 0; i < u8.length; i += STEP) parts.push(btoa(String.fromCharCode.apply(null, u8.subarray(i, i + STEP))));
  return `data:${type || 'application/octet-stream'};base64,${parts.join('')}`;
}

/** data URL 의 바이트 수(base64 길이로 셈). base64 가 아니면 풀어 낸 글자 수. */
export function dataUrlBytes(dataUrl) {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  if (comma < 0) return 0;
  const head = s.slice(0, comma);
  const body = s.slice(comma + 1);
  if (!/;base64$/i.test(head)) {
    try {
      return new TextEncoder().encode(decodeURIComponent(body)).length;
    } catch {
      return body.length;
    }
  }
  const b64 = body.replace(/\s/g, '');
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

const toBytes = (b) => (b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : null);
const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.ceil(n / 1024))}KB`);
/** 한도 글 — 딱 떨어지는 MB 면 "20MB", 아니면 sizeText(검사가 작은 한도를 끼울 때). */
const mbText = (n) => (n > 0 && n % 1048576 === 0 ? `${n / 1048576}MB` : sizeText(n));
const num = (n) => Number(n).toLocaleString('ko-KR');
const why = (err) => String(err?.message || err).slice(0, 120);
const stemOf = (name) => String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '') || '문서';
/** 쓸 만한 글자가 든 쪽 — 공백 빼고 40자 넘고, 글꼴 표가 없어 깨진 글자(사설 영역·제어 문자)가 10% 아래. doctext/core.js usable 과 같은 셈. */
function readable(text) {
  const d = String(text || '').replace(/\s/g, '');
  if (d.length <= 40) return false;
  return (d.match(/[\p{Co}\p{Cc}\p{Cn}\u{FFFD}]/gu) || []).length / d.length < 0.1;
}

/* ------------------------------------------------------------ 문서 → 재료 */

/**
 * 문서 하나 → 재료(Material — 계약서 §2.4). 엔진은 주입(순수 부분과 가른다).
 *   pdf    : engines.pdfText(bytes) → { pages, total }. 글자 층이 쓸 만하면(쪽마다 40자 넘는 쪽이 전체의 30% 이상) 쪽을 고르고 engines.pdfSlice(bytes, picked) 로 작은 PDF(attach 'slice').
 *            pdfSlice 가 던지면(암호 등) 글자만(attach 'none', warnings 에 까닭). 작은 PDF 가 attachBytesMax 를 넘어도 글자만.
 *            글자 층이 없으면 원본을 attachBytesMax 안일 때만 붙이고(attach 'original') 아니면 'none' + warnings. 글자를 뽑다 던져도 같다.
 *   office : engines.officeText(bytes, name, { max: LIMITS.officeChars, type }) → pickChunks. file 은 null, attach 'none'.
 *   text   : TextDecoder('utf-8') → pickChunks.
 *   yaml·hwp·'' : 던진다 — Error(unsupportedDocNote(...)) ('yaml' 은 'YAML 은 재료가 아니라 그대로 넣는 파일입니다').
 * 원본 PDF 가 pdfBytesMax 를 넘으면 Error('<name>: PDF 가 너무 큽니다(NMB) — 20MB 까지'). 글자가 하나도 없는 office/text 도 던진다.
 * @param {{ name: string, type?: string, bytes: Uint8Array }} file
 * @param {{ engines?: Engines, limits?: typeof LIMITS }} [opts]  engines·limits 는 일부만 줘도 된다(나머지는 기본)
 * @returns {Promise<Material>}
 */
export async function readDocument(file, { engines, limits } = {}) {
  const lim = { ...LIMITS, ...(limits || {}) };
  const eng = { ...defaultEngines(), ...(engines || {}) };
  const name = String(file?.name || '').trim() || '문서';
  const type = String(file?.type || '');
  const kind = docKind(name, type);
  if (kind === 'yaml') throw new Error('YAML 은 재료가 아니라 그대로 넣는 파일입니다');
  if (kind !== 'pdf' && kind !== 'office' && kind !== 'text') throw new Error(unsupportedDocNote(name, type));
  const bytes = toBytes(file?.bytes);
  if (!bytes) throw new Error(`${name}: 파일 바이트가 없습니다`);
  if (kind === 'pdf') return readPdf(name, bytes, eng, lim);
  if (kind === 'office') {
    const got = await eng.officeText(bytes, name, { max: lim.officeChars, type });
    return textMaterial(name, 'office', got?.text, lim, got?.cut ? [`글자가 ${num(lim.officeChars)}자를 넘어 뒤는 읽지 않았습니다`] : []);
  }
  return textMaterial(name, 'text', new TextDecoder('utf-8').decode(bytes), lim, []);
}

/** office·text 의 재료 — 구역을 골라 글자만. */
function textMaterial(name, kind, raw, lim, warnings) {
  const body = String(raw || '').trim();
  if (!body) throw new Error(`${name}: 글자가 없습니다 — 뽑을 것이 없습니다`);
  const got = pickChunks(body, { budget: lim.textChars, chunk: lim.chunkChars });
  const share = got.picked < got.total ? `구역 ${num(got.total)}개 가운데 ${num(got.picked)}개` : `구역 ${num(got.total)}개 전부`;
  return {
    name, kind, total: got.total, picked: null, text: got.text, chars: got.text.length, file: null, attach: 'none',
    read: `${name}: ${share} · 글자 ${num(got.text.length)}자 · 글자만 실음`, warnings,
  };
}

/** PDF 의 재료 — 글자 층으로 쪽을 고르고 그 쪽만 작은 PDF. 스캔본은 원본째(작을 때만). */
async function readPdf(name, bytes, eng, lim) {
  if (bytes.length > lim.pdfBytesMax) throw new Error(`${name}: PDF 가 너무 큽니다(${sizeText(bytes.length)}) — ${mbText(lim.pdfBytesMax)} 까지`);
  const warnings = [];
  let pages = [];
  let total = 0;
  let failed = '';
  try {
    const got = await eng.pdfText(bytes);
    pages = (got?.pages || []).map(tidyPage);
    total = Number(got?.total) || pages.length;
    if (pages.length < total) warnings.push(`앞 ${num(pages.length)}쪽만 읽었습니다(전체 ${num(total)}쪽)`);
  } catch (err) {
    failed = why(err);
  }
  const good = pages.filter(readable).length;
  const usable = !failed && pages.length > 0 && good / pages.length >= 0.3;
  const base = { name, kind: 'pdf', total };

  if (usable) {
    const picked = pickPages(pages, { max: lim.pdfPages, always: lim.alwaysPages, budget: lim.textChars });
    const text = pagesText(pages, picked);
    const share = `${num(total)}쪽 ${picked.length < total ? `가운데 ${num(picked.length)}쪽` : '전부'} · 글자 ${num(text.length)}자`;
    let slice = null;
    try {
      slice = toBytes(await eng.pdfSlice(bytes, picked));
      if (!slice?.length) throw new Error('빈 PDF');
    } catch (err) {
      warnings.push(`고른 쪽만 담은 작은 PDF 를 만들지 못해(${why(err)}) 글자만 실었습니다`);
      return { ...base, picked, text, chars: text.length, file: null, attach: 'none', read: `${name}: ${share} · 글자만 실음(작은 PDF 를 만들지 못함)`, warnings };
    }
    if (slice.length > lim.attachBytesMax) {
      warnings.push(`고른 쪽만 담은 작은 PDF 도 커서(${sizeText(slice.length)}) 붙이지 않고 글자만 실었습니다 — ${mbText(lim.attachBytesMax)} 까지`);
      return { ...base, picked, text, chars: text.length, file: null, attach: 'none', read: `${name}: ${share} · 글자만 실음(작은 PDF 가 ${sizeText(slice.length)}로 큼)`, warnings };
    }
    const sliceFile = { name: `${stemOf(name)}_발췌.pdf`, type: PDF_TYPE, dataUrl: toDataUrl(slice, PDF_TYPE) };
    return { ...base, picked, text, chars: text.length, file: sliceFile, attach: 'slice', read: `${name}: ${share} · 그 쪽들을 작은 PDF 로 붙임(${sizeText(slice.length)})`, warnings };
  }

  // 글자 층이 없다(스캔본) 또는 뽑지 못했다 — 글자가 든 쪽이 조금이라도 있으면 그것만 싣고, 원본은 작을 때만 그대로 붙인다.
  const withText = pages.map((p, i) => (readable(p) ? i + 1 : 0)).filter(Boolean);
  const picked = withText.length ? pickPages(withText.map((n) => pages[n - 1]), { max: lim.pdfPages, always: lim.alwaysPages, budget: lim.textChars }).map((k) => withText[k - 1]) : [];
  const text = pagesText(pages, picked);
  const what = failed ? `글자를 뽑지 못했습니다(${failed})` : '글자 층이 없는 PDF(스캔본)입니다';
  const pagesLabel = total ? `${num(total)}쪽 · ` : '';
  const head = failed ? '글자를 뽑지 못함' : '글자 층 없음(스캔본)';
  const some = picked.length ? ` · 글자가 든 ${num(picked.length)}쪽은 글로도 실음` : '';
  if (bytes.length <= lim.attachBytesMax) {
    warnings.push(`${what} — 원본 PDF 를 그대로 붙였습니다(Claude 가 그림으로 읽어 느리고 표의 값을 틀릴 수 있습니다)`);
    return {
      ...base, picked, text, chars: text.length, file: { name, type: PDF_TYPE, dataUrl: toDataUrl(bytes, PDF_TYPE) }, attach: 'original',
      read: `${name}: ${pagesLabel}${head} · 원본 PDF 를 붙임(${sizeText(bytes.length)})${some}`, warnings,
    };
  }
  warnings.push(`${what} — 원본이 커서(${sizeText(bytes.length)}) 붙이지도 못했습니다(${mbText(lim.attachBytesMax)} 까지). 글자 층이 있는 PDF 로 다시 저장하거나 KR 부분만 따로 저장해 넣으세요`);
  return { ...base, picked, text, chars: text.length, file: null, attach: 'none', read: `${name}: ${pagesLabel}${head} · 원본이 커서(${sizeText(bytes.length)}) 붙이지 못함${some}`, warnings };
}

/* ------------------------------------------------------------ 진짜 엔진 */

/** 고른 쪽(1부터)만 담은 새 PDF — pdf-lib. 암호가 걸린 PDF 는 load 가 던진다(ignoreEncryption:false). */
async function slicePdf(bytes, pageNos) {
  const { PDFDocument } = await import('../vendor/pdf-lib.esm.min.js');
  const src = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const count = src.getPageCount();
  const want = [...new Set(pageNos || [])].filter((n) => Number.isInteger(n) && n >= 1 && n <= count).sort((a, b) => a - b);
  if (!want.length) throw new Error('고른 쪽이 없습니다');
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(src, want.map((n) => n - 1))) out.addPage(page);
  return out.save();
}

/**
 * 확장의 진짜 엔진 — 쓸 때 import() 한다(가져오기만으로는 아무것도 안 한다).
 *   pdfText(bytes)             → (await import('../doctext/browser.js')).pdfAllText(bytes)
 *   pdfSlice(bytes, pageNos)   → pdf-lib: PDFDocument.load(bytes, { ignoreEncryption: false }) → create() → copyPages → save() (Uint8Array)
 *   officeText(bytes, name, o) → (await import('../src/officetext.js')).officeText(bytes, name, o)
 * pdf.js 는 사이드 패널(확장 페이지)에서 돈다 — 서비스 워커에서는 Worker 가 없어 돌지 않는다.
 * @returns {Engines}  Engines = { pdfText, pdfSlice, officeText }
 */
export function defaultEngines() {
  return {
    pdfText: async (bytes) => (await import('../doctext/browser.js')).pdfAllText(bytes),
    pdfSlice: (bytes, pageNos) => slicePdf(bytes, pageNos),
    officeText: async (bytes, name, o) => (await import('../src/officetext.js')).officeText(bytes, name, o),
  };
}
