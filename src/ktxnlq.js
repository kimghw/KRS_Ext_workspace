// KTX 말로 찾기의 규칙 해석 — Claude(로컬 CLI·API 키)가 없을 때 흔한 문장을 읽는다
// (2026-11-06 사용자 지정: "차량 ktx 부분에도 채팅으로 조회 하는거 기능 차량이랑 동일하게 넣어줘").
// 회의실·차량의 src/nlq.js parseLocal 과 같은 자리다. 돌려주는 것은 작업 search.ktx 의 **조각**(말한 칸만) —
// 부르는 쪽(src/llm.js ktxSmart)이 Claude 의 답과 같은 관문을 지나게 하고, 지금 칸 위에 얹는 것은 패널(ktxbox.js ask)이다.
// 역 이름은 src/ktx.js KTX_STATIONS 의 것만 — 울산·여수·광주·천안·구미·창원·대구처럼 줄여 부르는 이름은 그 역으로 맞춘다.
// DOM 도 chrome 도 쓰지 않는다.
import { KTX_STATIONS } from './ktx.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/** 월요일을 주의 시작으로 본다(src/nlq.js 와 같다). */
const weekStart = (d) => addDays(d, -((d.getDay() + 6) % 7));
const DOW = '일월화수목금토';

/** 줄여 부르는 이름 → 목록의 역 이름. */
export const STATION_ALIAS = Object.freeze({
  울산: '울산(통도사)', 통도사: '울산(통도사)', 여수: '여수EXPO', 광주: '광주송정', 천안: '천안아산', 아산: '천안아산',
  구미: '김천구미', 김천: '김천구미', 창원: '창원중앙', 대구: '동대구',
});
/** 찾을 이름(역 이름 + 줄인 이름) — 긴 이름부터("동대구" 가 "대구" 보다, "서대전" 이 "대전" 보다 먼저 자리를 차지한다). */
const NAMES = [...KTX_STATIONS.map(([name]) => [name, name]), ...Object.entries(STATION_ALIAS)].sort((a, b) => b[0].length - a[0].length);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 역 뒤에 붙은 말 — 출발("부산에서"·"부산발"·"부산 출발"·"부산부터") 과 도착("서울까지"·"서울행"·"서울 가는"·"서울로"·"서울 도착"). 사이의 "역" 은 건너뛴다. */
const FROM_TAIL = /^\s*역?\s*(?:에서|출발|부터|발(?![가-힣]))/;
const TO_TAIL = /^\s*역?\s*(?:까지|행(?![가-힣])|도착|가는|으로|로(?![가-힣])|에\s*(?:가|도착|내리))/;

/** 글에서 역을 찾는다 — 자리 차례대로 { name, tail(뒤에 붙은 말) }. 겹치는 자리는 긴 이름이 이긴다. */
function stations(t) {
  const hits = [];
  for (const [alias, name] of NAMES) {
    for (const m of t.matchAll(new RegExp(escapeRe(alias), 'g'))) {
      const index = m.index, end = index + alias.length;
      if (hits.some((h) => index < h.end && end > h.index)) continue;
      hits.push({ name, index, end });
    }
  }
  return hits.sort((a, b) => a.index - b.index).map((h) => ({ name: h.name, tail: t.slice(h.end, h.end + 8) }));
}

/**
 * 출발역·도착역. 토씨가 붙은 역이 먼저고, 토씨 없는 역은 둘이면 차례대로 출발·도착, 하나면 빈 쪽(둘 다 비었으면 도착 — "서울 KTX" 는 서울 가는 것).
 * @returns {{from: string|null, to: string|null}}
 */
export function parseRoute(text) {
  const t = String(text || '');
  let from = null, to = null;
  const rest = [];
  for (const h of stations(t)) {
    if (!from && FROM_TAIL.test(h.tail)) from = h.name;
    else if (!to && TO_TAIL.test(h.tail)) to = h.name;
    else rest.push(h.name);
  }
  if (rest.length >= 2) { if (!from) from = rest.shift(); if (!to) to = rest.shift(); }
  else if (rest.length === 1) { if (!to) to = rest[0]; else if (!from) from = rest[0]; }
  return { from, to };
}

/** 달력에 있는 날인가 — new Date(2026, 1, 30) 은 3월 2일로 넘어가므로 달을 다시 본다. */
const realDate = (y, m, d) => { const x = new Date(y, m - 1, d); return x.getMonth() === m - 1 && x.getDate() === d ? x : null; };

/**
 * 출발일 — 오늘·내일·모레·글피·N일 뒤·(이번 주|다음 주|다다음 주) X요일·X요일(오늘 뒤의 첫 그 요일)·YYYY-MM-DD·M월 D일·M/D.
 * 연도 없는 날이 이미 지났으면 다음 해다. relative 는 오늘을 기준으로 셈한 날(Claude 의 답을 이것으로 바로잡는다).
 * @returns {{date: string, how: string, relative: boolean}|null}
 */
export function parseKtxDate(text, today) {
  const t = String(text || '');
  const base = new Date(`${today}T00:00:00`);
  const rel = (n, how) => ({ date: ymd(addDays(base, n)), how, relative: true });
  if (/글피/.test(t)) return rel(3, '글피');
  if (/모레/.test(t)) return rel(2, '모레');
  if (/내일/.test(t)) return rel(1, '내일');
  if (/오늘/.test(t)) return rel(0, '오늘');
  let m = t.match(/(\d{1,2})\s*일\s*(?:뒤|후)/);
  if (m) return rel(+m[1], `${+m[1]}일 뒤`);
  m = t.match(/(다다음\s*주|다음\s*주|담주|이번\s*주|금주)?\s*([일월화수목금토])요일/);
  if (m) {
    const week = (m[1] || '').replace(/\s/g, '');
    const offset = (DOW.indexOf(m[2]) + 6) % 7;   // 월요일부터 며칠째
    let d;
    if (week === '다다음주') d = addDays(weekStart(base), 14 + offset);
    else if (week === '다음주' || week === '담주') d = addDays(weekStart(base), 7 + offset);
    else if (week) d = addDays(weekStart(base), offset);
    else d = addDays(base, ((DOW.indexOf(m[2]) - base.getDay() + 7) % 7) || 7);
    return { date: ymd(d), how: `${week ? m[1].trim() + ' ' : ''}${m[2]}요일`, relative: true };
  }
  m = t.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (m) { const d = realDate(+m[1], +m[2], +m[3]); return d ? { date: ymd(d), how: ymd(d), relative: false } : null; }
  m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) || t.match(/(?:^|[^\d:])(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d/.])/);
  if (m) {
    const y = base.getFullYear();
    let d = realDate(y, +m[1], +m[2]);
    if (!d) return null;
    if (ymd(d) < today) d = realDate(y + 1, +m[1], +m[2]) || d;
    return { date: ymd(d), how: `${+m[1]}/${+m[2]}`, relative: false };
  }
  return null;
}

const HOUR_WORD = [['새벽', 5], ['아침', 7], ['오전', 9], ['정오', 12], ['점심', 12], ['낮', 12], ['오후', 12], ['저녁', 18], ['밤', 20]];

/**
 * 출발 시(0~23) — "오후 2시"·"14시"·"9시 반"·"09:30"·"저녁 7시", 수 없이 "아침"·"오후" 같은 말만 있으면 그 때의 시작.
 * "2시간" 의 "2시" 는 시각이 아니다. 오전·오후가 없는 1~5시는 오후로 본다 — 그 새벽에는 KTX 가 없다.
 * @returns {{hour: number, how: string}|null}
 */
export function parseKtxHour(text) {
  const t = String(text || '');
  const m = t.match(/(오전|오후|아침|저녁|밤|새벽|낮|정오)?\s*(\d{1,2})\s*(?:시(?!간)|:\d{2})/);
  if (m) {
    let h = +m[2];
    const when = m[1];
    if (['오후', '저녁', '밤', '낮'].includes(when) && h < 12) h += 12;
    else if (when === '오전' && h === 12) h = 0;
    else if (!when && h >= 1 && h <= 5) h += 12;
    return h <= 23 ? { hour: h, how: `${h}시~` } : null;
  }
  for (const [word, hour] of HOUR_WORD) if (t.includes(word)) return { hour, how: word };
  return null;
}

const KO_COUNT = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9 };

/** 어른 인원(1~9) — "2명"·"2인"·"두 명"·"둘이"·"혼자". 10명 넘는 수나 0은 읽지 않는다. */
export function parseKtxAdults(text) {
  const t = String(text || '');
  let m = t.match(/(\d{1,2})\s*(?:명|인(?![가-힣])|사람)/);
  if (m) return +m[1] >= 1 && +m[1] <= 9 ? +m[1] : null;
  if (/혼자/.test(t)) return 1;
  m = t.match(/(한|두|세|네|다섯|여섯|일곱|여덟|아홉)\s*(?:명|사람)/);
  if (m) return KO_COUNT[m[1]];
  if (/둘이/.test(t)) return 2;
  if (/셋이/.test(t)) return 3;
  if (/넷이/.test(t)) return 4;
  return null;
}

/**
 * 문장을 KTX 조회 조건의 조각으로 바꾼다 — 읽은 칸만 든다(작업 search.ktx 가 partial 인 것과 같다).
 * summary 는 읽은 것을 사람이 확인할 한 줄, relative 는 날짜를 오늘 기준으로 셈했다는 뜻(Claude 의 날짜를 이것으로 바로잡는다).
 * @param {string} text
 * @param {string} today 'YYYY-MM-DD'
 * @returns {{patch: {from?:string, to?:string, date?:string, hour?:number, adults?:number}, summary: string, relative: boolean}}
 */
export function parseKtxLocal(text, today) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const patch = {};
  const parts = [];
  const { from, to } = parseRoute(t);
  if (from) patch.from = from;
  if (to) patch.to = to;
  if (from || to) parts.push(`${from || '…'}→${to || '…'}`);
  const date = parseKtxDate(t, today);
  if (date) { patch.date = date.date; parts.push(date.how); }
  const hour = parseKtxHour(t);
  if (hour) { patch.hour = hour.hour; parts.push(hour.how); }
  const adults = parseKtxAdults(t);
  if (adults) { patch.adults = adults; parts.push(`${adults}명`); }
  return { patch, summary: parts.join(' · '), relative: !!date?.relative };
}

/** Only take the fast path when every part of a routine request is understood. */
export function simpleKtxRequest(text, local) {
  if (!Object.keys(local.patch).length) return false;
  let rest = String(text || '').trim();
  const consume = (re, key) => {
    const matches = [...rest.matchAll(re)];
    if (matches.length > 1 || (matches.length && local.patch[key] == null)) return false;
    rest = rest.replace(re, ' ');
    return true;
  };
  if (!consume(/(?:\d{4}\s*[-./년]\s*)?\d{1,2}\s*[-./월]\s*\d{1,2}(?:일)?|(?:다다음\s*주|다음\s*주|담주|이번\s*주|금주)?\s*[일월화수목금토]요일|\d{1,2}\s*일\s*(?:뒤|후)|오늘|내일|모레|글피/g, 'date')) return false;
  if (!consume(/(?:(?:오전|오후|아침|저녁|밤|새벽)\s*)?\d{1,2}\s*시|오전|오후|아침|저녁|밤|새벽/g, 'hour')) return false;
  if (!consume(/\d+\s*(?:명|인|사람)|혼자|둘이|셋이|넷이|(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)\s*(?:명|사람)/g, 'adults')) return false;
  const stationRe = new RegExp(NAMES.map(([name]) => escapeRe(name)).join('|'), 'g');
  if ([...rest.matchAll(stationRe)].length > 2) return false;
  rest = rest.replace(stationRe, ' ');
  rest = rest.replace(/KTX|ktx|열차|기차|시간표|조회|역|에서|부터|출발|까지|도착|가는|으로|이후|찾아주세요|찾아줘|보여주세요|보여줘|해주세요|해줘|주세요|좀|로|행|발/g, ' ');
  return !rest.replace(/[\s,.!?~→-]/g, '');
}
