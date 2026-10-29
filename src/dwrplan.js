// 일일 업무 짜기 — 아직 쓰지 않은 근무일의 일일 업무를 목표에 맞춰 짠다(2026-10-29 사용자 지정: "여기 목표에 맞도록 일일 업무보고를 신청할 수 있도록 해줘.
// 꼭 딱 맞출 필요는 없고 목표 총 합을 100%로 변경해서 목표와 실제 값이 비슷하게 달성할 수 있도록 해줘. 다만, 근태 내역을 보고 출장/외근의 경우 과제에 맞도록
// 없거나 모모하면 나두고"). krs-web-agents 의 dr-dailyreport(dr_report_run.py --list · dr_balance.py)가 하던 일을 일일 업무 카드의 값으로 한다:
//   근무일·시간 — HR 근태현황(/wrk/wrkwork/wrkworkplan100 — src/hr.js hrWorkPlan). 실근무시간(sWorkHour)이 있는 날과 출장·외근 날(workCodeKindName)만 —
//     연차·휴가·주말·공휴일은 쓰지 않는다. 출장·외근 날은 8시간(쓸 때 근무시간을 09:00~18:00 으로 — 원본 러너와 같다).
//   하루 한 업무 — 카드의 목표 칸(더한 업무는 그 %, 나머지는 src/workshare.js normalizeShare 의 goals)을 합이 100 이 되게 늘이거나 줄이고(비율은 그대로),
//     날마다 그 목표에 가장 못 미친 업무를 고른다. 실제는 카드가 고른 기간의 것에서 시작한다 — 카드에 보이는 실제가 목표에 다가가게. 목표가 없는 업무와 기타는 고르지 않는다.
//   출장·외근 날 — 그 근태의 사유(workRsn)에 업무의 별칭(더한 업무는 이름)이 들었거나 과제명에만 있는 낱말이 둘 넘게 들었으면 그 업무로 쓴다.
//     맞는 업무가 없거나 둘 이상이면 그 날은 짜지 않고 둔다(사람이 고를 수 있다).
//   업무명 — 그 줄에 e-Class 업무를 골라 두었으면 그것(2026-10-30 사용자 지정: "저기서 일일업무리스트를 어떤걸 매칭할 건지 선택할 수 있게 해줘" — 업무 번호까지;
//     2026-10-29 "AIP 업무는 이걸로 하게 해줘" 의 「시험/인증업무>AIP 기술검토 및 관리」도 이것으로 옮겼다), 아니면 그 업무로 가장 최근에 적은 일일 업무의 업무명.
//     적은 적이 없으면 과제명·더한 업무의 이름. e-Class 업무 목록(작성 화면의 업무 목록 — src/dwrwrite.js fetchWorkList)을 알면 그 목록에서 맞는 업무를 찾아
//     업무명·번호를 정하고, 맞는 업무가 없는 줄은 짜지 않는다(써도 작성 화면에 그 줄이 없다).
//   내용 — 그 업무로 최근에 적은 내용(겹치지 않게 열 가지까지)을 차례로 돌려 쓴다. 적은 적이 없으면 R&D 탭 그 과제의 올해 차년도 계획의 개발내용. 출장·외근은 그 사유.
//     지어내지 않는다 — 없으면 비워 두고 사람이 적는다.
// 화면도 저장소도 모른다 — 일일 업무 줄은 src/dwr.js rowsOf, 업무 줄은 src/workshare.js workShare 의 꼴이다.

import { lineKeyOf } from './workshare.js';
import { currentYear, fileLog } from './rnd.js';

/** 근태 종류 이름에 이것이 들면 출장·외근 날이다(원본 러너의 TRIP_KEYS). 연차·휴가·공가는 아니다. */
export const TRIP_RE = /출장|외근/;
/** 출장·외근 날의 투입시간 — 근무시간 09:00~18:00 (근태에 실근무시간이 없다). */
export const TRIP_HOURS = 8;
/** 업무마다 돌려 쓰는 지난 내용의 수. */
export const POOL_MAX = 10;
/** 내용 한 칸의 한도. */
export const CONTENT_MAX = 500;
/** 투입시간의 한도(시간). */
export const HOURS_MAX = 24;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** HR 의 날짜 칸 — '20261001' · '2026-10-01' → '2026-10-01'. 못 읽으면 ''. */
export function hrDate(v) {
  const s = String(v ?? '').trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return DATE_RE.test(s.slice(0, 10)) ? s.slice(0, 10) : '';
}

const ENTITIES = { '&mdash;': '—', '&rarr;': '→', '&larr;': '←', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'" };

/** 근태 사유·상태 글 — HTML 엔티티를 풀고, 쉼표로 겹쳐 온 사유는 한 번씩만 ' / ' 로 잇는다(원본 러너 _clean_rsn). */
export function cleanReason(s) {
  const t = String(s ?? '').replace(/&(?:mdash|rarr|larr|amp|lt|gt|nbsp|quot|#39);/g, (m) => ENTITIES[m]);
  return [...new Set(t.split(',').map((x) => x.trim()).filter(Boolean))].join(' / ');
}

/**
 * 근태현황의 줄들 → 일일 업무를 쓸 수 있는 근무일(날짜 차례). 실근무시간이 있거나(칸이 비었으면 출근 시각이 있거나) 출장·외근인 날만.
 * 투입시간은 실근무시간(없으면 계획 근무시간, 그것도 없으면 8), 출장·외근 날은 8. 한 날에 줄이 여럿이면 하나로 — 하나라도 출장·외근이면 출장·외근 날이다.
 * @param {object[]} rows HR /wrk/wrkwork/wrkworkplan100 의 줄 { workDate, sWorkHour, sStartTime, planWorkHour, workCodeKindName, workRsn, workStatus }
 * @returns {{date: string, hours: number, trip: boolean, kind: string, reason: string, status: string}[]}
 */
export function workDays(rows, { from = '', to = '9999-12-31' } = {}) {
  const by = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const date = hrDate(r?.workDate);
    if (!date || date < from || date > to) continue;
    const kind = String(r?.workCodeKindName ?? '').trim();
    const trip = TRIP_RE.test(kind);
    const raw = String(r?.sWorkHour ?? '').trim();
    const h = Number(raw);
    const worked = raw && Number.isFinite(h) ? h > 0 : !!String(r?.sStartTime ?? '').trim();
    if (!worked && !trip) continue;
    const plan = Number(r?.planWorkHour);
    const hours = trip ? TRIP_HOURS : h > 0 ? h : plan > 0 ? plan : TRIP_HOURS;
    const reason = cleanReason(r?.workRsn);
    const status = cleanReason(r?.workStatus);
    const d = by.get(date);
    if (!d) { by.set(date, { date, hours, trip, kind, reason: trip ? reason : '', status }); continue; }
    // 같은 날 줄이 또 — 출장·외근이 이긴다(사유는 잇는다), 아니면 긴 시간.
    if (trip) {
      d.reason = cleanReason([d.trip ? d.reason : '', reason].filter(Boolean).join(','));
      if (!d.trip) d.kind = kind;
      d.trip = true;
      d.hours = TRIP_HOURS;
    } else if (!d.trip) d.hours = Math.max(d.hours, hours);
    d.status = cleanReason([d.status, status].filter(Boolean).join(','));
  }
  return [...by.values()].map((d) => ({ ...d, hours: Math.min(HOURS_MAX, Math.round(d.hours * 10) / 10) })).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 업무마다 지난 일일 업무 — 업무명(가장 최근에 적은 것)과 내용 묶음(최근부터 겹치지 않게 POOL_MAX 개). 열쇠는 src/workshare.js lineKeyOf 와 같다.
 * @param {ReturnType<import('./dwr.js').rowsOf>} rows 날짜 내림차순
 * @param {{items?: {name: string}[], rates?: ReturnType<import('./workshare.js').myRates>, links?: Record<string, {id, name}>}} [q]
 * @returns {Map<string, {title: string, pool: string[], last: string}>}
 */
export function historyOf(rows, { items = [], rates = { projects: [] }, links = {} } = {}) {
  const out = new Map();
  const keys = new Map();
  const seen = new Map();
  for (const r of rows || []) {
    const ck = `${r.title}\n${r.category}`;
    if (!keys.has(ck)) keys.set(ck, lineKeyOf(r, items, rates.projects, links));
    const key = keys.get(ck);
    if (!out.has(key)) { out.set(key, { title: r.title, pool: [], last: r.date }); seen.set(key, new Set()); }
    const h = out.get(key);
    const text = String(r.content || '').trim().slice(0, CONTENT_MAX);
    const k = squash(text);
    if (text && h.pool.length < POOL_MAX && !seen.get(key).has(k)) { seen.get(key).add(k); h.pool.push(text); }
  }
  return out;
}

/**
 * R&D 탭 과제의 올해 차년도 계획(계획서에서 온 연구내역 key 'plan' — 그 차년도에 없으면 계획이 있는 앞 차년도)의 개발내용 — 세부가 있으면 세부, 없으면 항목.
 * 일일 업무에 그 과제를 적은 적이 없을 때 내용으로 쓴다.
 * @returns {string[]}
 */
export function planItems(project, today) {
  const years = project?.years || {};
  let now = 0;
  try { now = currentYear(project, today); } catch { now = 0; }
  const have = Object.keys(years).map(Number).filter((n) => fileLog(years[n], 'plan')).sort((a, b) => b - a);
  const n = have.includes(now) ? now : have.find((k) => k < now) || have[0] || 0;
  const text = n ? String(fileLog(years[n], 'plan')?.text || '') : '';
  const out = [];
  let on = false;
  let item = '';
  let subs = 0;
  const flush = () => { if (item && !subs) out.push(item); item = ''; subs = 0; };
  for (const line of text.split('\n')) {
    if (/^\s*■/.test(line)) { flush(); on = /개발내용/.test(line); continue; }
    if (!on) continue;
    const it = line.match(/^-\s+(.+)/);
    const sub = line.match(/^\s+·\s+(.+)/);
    if (it) { flush(); item = it[1].trim(); } else if (sub) { out.push(sub[1].trim()); subs += 1; }
  }
  flush();
  return out.filter(Boolean).slice(0, 40);
}

/**
 * 목표 — 카드의 업무 줄 가운데 목표 % 를 넣은 것을 합이 100 이 되게(비율 그대로). 카드의 차례 그대로.
 * @param {Array<{key, kind, label, name, actual}>} lines 카드가 고른 기간의 workShare().lines
 * @param {{items: {name, rate}[], goals: Record<string, number>}} share normalizeShare 의 것
 * @returns {{key, kind, label, name, goal: number, norm: number, actual: number}[]}
 */
export function targetsOf(lines, share) {
  const goalOf = (L) => Number(L.kind === 'item' ? share?.items?.find((i) => `item:${i.name}` === L.key)?.rate : share?.goals?.[L.key]) || 0;
  const got = (lines || []).map((L) => ({ key: L.key, kind: L.kind, label: L.label, name: L.name, goal: goalOf(L), actual: L.actual || 0 })).filter((t) => t.goal > 0);
  const all = sum(got.map((t) => t.goal));
  return got.map((t) => ({ ...t, norm: all ? (t.goal * 100) / all : 0 }));
}

/** 이름의 낱말 — 두 글자 넘는 한글·영문·숫자 덩이(소문자). */
const wordsOf = (s) => (String(s ?? '').match(/[0-9A-Za-z가-힣]{2,}/g) || []).map((w) => w.toLowerCase());
/** 어느 과제명에나 들 만한 말 — 출장 사유를 과제에 잇는 근거로 보지 않는다. */
const PLAIN = new Set(['개발', '기술', '시스템', '과제', '연구', '기반', '위한', '대한', '구축', '사업', '업무', '관리', '국가', '연구개발', '및']);
/** 과제명에만 있는 낱말이 사유에 이만큼 들면 그 과제다. */
export const TRIP_WORDS_MIN = 2;

/**
 * 출장·외근 사유에 맞는 업무. 별칭(더한 업무·참여율 없는 과제는 이름)이 사유에 들었거나, 과제명·업무명의 낱말 가운데 다른 업무에는 없는 것이
 * TRIP_WORDS_MIN 개 넘게 들었으면 맞는다. 하나만 맞으면 그 업무, 없거나 둘 이상이면 null — 그 날은 둔다. 별칭으로 맞은 것이 하나뿐이면 그것이 이긴다.
 * @param {string} reason
 * @param {{key, kind, label, name, title?}[]} lines 견줄 업무(기타는 넣지 않는다)
 * @returns {{key: string|null, why: string}}
 */
export function tripLine(reason, lines) {
  // 괄호 안도 본다(src/rnderp.js nameKey 는 괄호를 지운다) — "K-Battery Show 참석(차세대 배터리 전시 참관)".
  const flat = (s) => String(s ?? '').replace(/\s/g, '').toLowerCase();
  const text = flat(reason);
  if (!text) return { key: null, why: '사유가 없습니다' };
  const own = lines.map((L) => new Set([...wordsOf(L.name), ...wordsOf(L.title)].filter((w) => !PLAIN.has(w))));
  const count = new Map();
  for (const ws of own) for (const w of ws) count.set(w, (count.get(w) || 0) + 1);
  const hits = lines.map((L, i) => {
    const alias = flat(L.label);
    const byAlias = alias.length >= 2 && alias !== flat(L.name) ? text.includes(alias) : false;
    const byName = !byAlias && flat(L.name).length >= 2 && text.includes(flat(L.name));
    // 사유는 붙여 쓴 말이 많다("수소연료전지 실증") — 낱말이 사유 글 안에 들었는지로 본다.
    const unique = [...own[i]].filter((w) => count.get(w) === 1 && text.includes(w));
    return { L, byAlias: byAlias || byName, n: unique.length };
  }).filter((h) => h.byAlias || h.n >= TRIP_WORDS_MIN);
  if (!hits.length) return { key: null, why: '사유에 맞는 업무가 없습니다' };
  if (hits.length === 1) return { key: hits[0].L.key, why: '' };
  const named = hits.filter((h) => h.byAlias);
  if (named.length === 1) return { key: named[0].L.key, why: '' };
  return { key: null, why: `사유가 ${hits.map((h) => h.L.label).join(' · ')} 에 다 맞습니다` };
}

/**
 * 목표가 있는 업무들의 지금 실제와 짠 대로 쓴 뒤의 실제(%).
 * @param {ReturnType<typeof targetsOf>} targets
 * @param {number} minutes 카드가 고른 기간에 적은 분
 * @param {{key: string|null, hours: number}[]} days 짠 날(key 가 없는 날은 쓰지 않는다)
 */
export function forecastOf(targets, minutes, days) {
  const add = new Map();
  let all = minutes;
  for (const d of days || []) {
    if (!d.key || !(d.hours > 0)) continue;
    add.set(d.key, (add.get(d.key) || 0) + d.hours * 60);
    all += d.hours * 60;
  }
  return targets.map((t) => ({ key: t.key, label: t.label, goal: t.goal, norm: t.norm, now: minutes ? (t.actual / minutes) * 100 : 0, after: all ? ((t.actual + (add.get(t.key) || 0)) / all) * 100 : 0 }));
}

/**
 * 줄의 e-Class 업무 — 골라 둔 것(links)이 먼저, 아니면 업무명(guess — 가장 최근에 적은 업무명·과제명·이름)으로 저절로. works(e-Class 업무 목록)를 모르면 이름만 정한다.
 * @param {{id: string, name: string}|undefined} link 그 줄에 골라 둔 업무
 * @param {string} guess
 * @param {{id: string, name: string}[]|null} works
 * @returns {{title: string, work: string, chosen: boolean, missing: boolean}} missing 은 works 에 맞는 업무가 없는 것
 */
export function workOf(link, guess, works) {
  const chosen = !!link?.name;
  const title = chosen ? link.name : guess;
  if (!Array.isArray(works)) return { title, work: chosen ? link.id || '' : '', chosen, missing: false };
  const rows = works.map((w) => ({ row: w.id, name: w.name, id: w.id }));
  const hit = matchRow(rows, title, chosen ? link.id : '').row;
  return hit ? { title: hit.name, work: hit.id, chosen, missing: false } : { title, work: chosen ? link.id || '' : '', chosen, missing: true };
}

/**
 * 짜기.
 * @param {object} q
 * @param {Array} q.lines 카드가 고른 기간의 업무 줄(workShare().lines)
 * @param {number} q.minutes 그 기간에 적은 분(workShare().minutes)
 * @param {{items, goals, links?}} q.share 더한 업무와 줄마다의 목표·고른 e-Class 업무
 * @param {Array<ReturnType<typeof workDays>[number] & {fixed?: boolean, key?: string|null, content?: string, title?: string, label?: string, work?: string}>} q.days 근무일(이미 쓴 날은 부른 쪽이 뺀다).
 *   fixed 인 날은 짜지 않는다 — 사람이 고른(두기면 key null)·고친 날, 이 카드가 저장해 둔 날. 그 업무는 다른 날을 짤 때 실제에 먼저 든다. content·title·label·work 를 주면 그대로 둔다.
 * @param {ReturnType<typeof historyOf>} q.history 업무마다 지난 일일 업무
 * @param {(key: string) => string[]} [q.planOf] 과제 줄의 계획 개발내용(적은 적이 없을 때의 내용)
 * @param {{id: string, name: string}[]|null} [q.works] e-Class 업무 목록 — 모르면 null(업무명만으로 짠다)
 * @returns {{ targets: ReturnType<typeof targetsOf>, lines: {key, label, title, work}[], links: Array<{key, label, title, work, chosen: boolean, missing: boolean}>, days: Array<{date, hours, trip, kind, reason, status, fixed: boolean, key: string|null, label: string, title: string, work: string, content: string, why: string}> }}
 *   links 는 기타를 뺀 카드의 줄마다 e-Class 업무(골라 두었나 · 목록에 없나), lines 는 그 가운데 날마다 고를 수 있는 업무(목록에 있는 것).
 *   days 의 key 가 null 이면 짜지 않은 날이고 why 가 까닭이다.
 */
export function planDays({ lines = [], minutes = 0, share = { items: [], goals: {} }, days = [], history = new Map(), planOf = () => [], works = null }) {
  // 업무명 — 줄에 골라 둔 e-Class 업무가 먼저, 그다음 가장 최근에 적은 것, 없으면 과제명·업무 이름. e-Class 업무 목록에 없는 줄은 고르지 않는다.
  const guess = (L) => history.get(L.key)?.title || (L.kind === 'project' ? L.name : L.label) || '';
  const links = lines.filter((L) => L.kind !== 'etc').map((L) => ({ key: L.key, kind: L.kind, label: L.label, name: L.name, ...workOf(share?.links?.[L.key], guess(L), works) })).filter((L) => L.title);
  const pickable = links.filter((L) => !L.missing);
  const known = new Map(pickable.map((L) => [L.key, L]));
  const targets = targetsOf(lines, share);
  const goals = targets.filter((t) => known.has(t.key));
  const actual = new Map(targets.map((t) => [t.key, t.actual]));
  let all = minutes;
  const put = (key, hours) => { actual.set(key, (actual.get(key) || 0) + hours * 60); all += hours * 60; };

  const out = days.map((d) => ({
    ...d, fixed: !!d.fixed, key: d.fixed ? d.key ?? null : null, label: d.fixed ? d.label || '' : '', title: d.fixed ? d.title || '' : '', work: d.fixed ? d.work || '' : '',
    content: d.fixed ? d.content ?? null : null, why: d.fixed && !d.key ? '두기' : '',
  }));
  // 정해 둔 날 · 출장·외근 날을 먼저 — 그 날의 업무는 사람이나 사유가 정한다. 남은 날로 목표를 맞춘다.
  for (const d of out.filter((x) => x.fixed && x.key)) put(d.key, d.hours);
  for (const d of out.filter((x) => !x.fixed && x.trip)) {
    const m = tripLine(d.reason, pickable);
    if (m.key) { d.key = m.key; put(m.key, d.hours); } else d.why = m.why;
  }
  for (const d of out.filter((x) => !x.fixed && !x.trip)) {
    if (!goals.length) { d.why = '목표 % 를 넣은 업무가 없습니다'; continue; }
    let best = null;
    let need = -Infinity;
    for (const t of goals) {
      const n = (t.norm / 100) * (all + d.hours * 60) - (actual.get(t.key) || 0);
      if (n > need + 1e-9 || (Math.abs(n - need) <= 1e-9 && t.norm > best.norm)) { best = t; need = n; }
    }
    d.key = best.key;
    put(best.key, d.hours);
  }
  const turn = new Map();
  for (const d of out) {
    if (!d.key) { d.content ??= ''; continue; }
    const L = known.get(d.key);
    d.label ||= L?.label || '';
    d.title ||= L?.title || '';
    // 번호는 업무명과 짝일 때만 — 저장해 둔 날의 업무명이 지금 고른 업무와 다르면 그 날의 업무명으로 찾는다.
    if (!d.work && L?.work && d.title === L.title) d.work = L.work;
    // 내용을 정해 둔 날도 차례는 센다 — 그 업무의 다른 날이 같은 내용을 받지 않게.
    const next = contentOf(d, history, planOf, turn);
    d.content ??= next;
  }
  return {
    targets,
    lines: pickable.map(({ key, label, title, work }) => ({ key, label, title, work })),
    links: links.map(({ key, label, title, work, chosen, missing }) => ({ key, label, title, work, chosen, missing })),
    days: out,
  };
}

/**
 * 그 날 그 업무의 내용 — 출장·외근은 사유, 아니면 그 업무의 지난 내용(없으면 계획의 개발내용)을 차례로. turn 은 업무마다 몇 번째인지 센다(부른 쪽이 날짜 차례로 부른다).
 * @returns {string}
 */
export function contentOf(day, history, planOf = () => [], turn = new Map()) {
  if (day.trip && day.reason) return day.reason.slice(0, CONTENT_MAX);
  const pool = history.get(day.key)?.pool?.length ? history.get(day.key).pool : planOf(day.key) || [];
  const n = turn.get(day.key) || 0;
  turn.set(day.key, n + 1);
  return pool.length ? String(pool[n % pool.length]).slice(0, CONTENT_MAX) : '';
}

/** 투입시간(시간) → 작성 화면의 시·분 칸. 8.5 → { h: 8, m: 30 }. */
export function hourParts(hours) {
  const v = Math.max(0, Math.min(HOURS_MAX, Number(hours) || 0));
  let h = Math.floor(v);
  let m = Math.round((v - h) * 60);
  if (m >= 60) { h += 1; m -= 60; }
  return { h, m };
}

/**
 * 작성 화면의 업무 목록 줄 가운데 맞는 것 — 업무 번호(카드에서 고른 e-Class 업무)가 있고 그 줄이 있으면 그 줄. 아니면 업무명으로:
 * 공백을 뺀 이름이 같은 줄(같은 이름이 여럿이면 첫 줄 — 원본 러너와 같다, 2026-10-01 사용자 확정 "8번(기존)"),
 * 없으면 한쪽이 다른 쪽을 품는 줄이 하나뿐일 때(업무명이 이름을 품으려면 이름이 여덟 자 넘어야 — 원본 러너 _match_row). 없거나 둘 이상이면 null.
 * @param {{row: string, name: string, id?: string}[]} rows
 * @param {string} title 업무명
 * @param {string} [work] 업무 번호
 * @returns {{row: {row: string, name: string, id?: string}|null, why: string}}
 */
export function matchRow(rows, title, work = '') {
  if (work) {
    const byId = (rows || []).find((r) => r.id && r.id === String(work));
    if (byId) return { row: byId, why: '' };
  }
  const key = (s) => String(s ?? '').replace(/\s/g, '').toLowerCase();
  // 작성 화면은 긴 업무명을 "시험/인증업무>AIP 기술검토 및 ..." 처럼 줄여 보일 수 있다(2026-10-29 사용자 화면) — 줄인 이름은 앞부분으로 본다.
  const cut = (s) => key(s).replace(/(?:\.{3}|…)$/, '');
  const short = (s) => /(?:\.{3}|…)\s*$/.test(String(s ?? ''));
  const k = key(title);
  if (!k) return { row: null, why: '업무명이 없습니다' };
  const exact = (rows || []).filter((r) => key(r.name) === k);
  if (exact.length) return { row: exact[0], why: '' };
  const head = (rows || []).filter((r) => short(r.name) && cut(r.name).length >= 8 && k.startsWith(cut(r.name)));
  if (head.length) return { row: head[0], why: '' };
  const part = (rows || []).filter((r) => {
    const n = cut(r.name);
    return !!n && ((k.length >= 2 && n.includes(k)) || (n.length >= 8 && k.includes(n)));
  });
  if (part.length === 1) return { row: part[0], why: '' };
  return { row: null, why: part.length ? `작성 화면의 업무 목록에 "${title}" 에 맞는 줄이 ${part.length}개입니다` : `작성 화면의 업무 목록에 "${title}" 이 없습니다 — 작성 화면의 업무추가로 넣어 주세요` };
}
