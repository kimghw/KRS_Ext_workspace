// 업무 비율 — 일일 업무 카드(dwrbox.js)의 업무별 업무량을 비율(%)로, 연구과제 참여율과 나란히 보인다
// (2026-10-27 사용자 지정: "연구개발 참여율을 월간으로 계산했을 때 해야 되는 업무 시간을 업무별 업무량이랑 같이 보이게 해줘 시간 비율로").
//
// 카드의 「참여율」 칸은 rERP 의 내 과제 참여율 그대로 — 기간이 걸친 달들의 평균이고 참여하지 않은 달은 0 이다(올해면 열두 달 — 4월에 시작한 과제도 12로 나눈다;
// 2026-10-28 사용자 지정: "참여율이 과제 참여율을 년평균으로 한거지? 4월 과제라도 12개월로 나눠야 하잖아"). 남은 몫을 참여율 비중으로 나누던 셈(2026-10-27)은 철회 —
// 더한 업무(AIP 5% …)와 기타는 과제 참여율을 바꾸지 않는다. 달마다의 목표(target)는 그 달 적은 분(T) × 참여율(더한 업무는 × 정한 %) — 풍선말의 달마다 견주기.
// 내 참여율은 R&D 탭 장부(src/rnd.js rndBook)의 rERP 참여인력(erp.staff — rerp/staff.js 사람 모양)에서 내 이름의 달마다 지급 ÷ 월급여.
// 내 참여율이 없는 연구과제(R&D 탭에 없거나 참여인력에 내가 없는 과제 — 업무분류가 '… R&D 과제'인 업무)는 과제마다 한 줄이고 참여율은 0 이다
// (2026-10-27 사용자 지정: "이건 목표가 0인데 준적이 없음"). 기타(연구과제도 더한 업무도 아닌 것 — 연구기획 기타·부서소통회 …)는 참여율이 없다.
// 카드의 「목표」 칸은 내가 줄마다 넣는 % 로(normalizeShare 의 goals — 더한 업무는 items 의 rate) 견주기만 한다(2026-10-28 사용자 지정: "과제 참여율로 몇%가 되어야 하는지를..
// 과제가 아니면 이건 없겠지.. 그리고 2번째 줄은 실제 전체에서 올해 몇퍼센트인지.. 그리고3번째는 내가 입력할 수 있는 목표 업무 %를 입력하게 해줘").
// 화면도 저장소도 모른다 — 일일 업무 줄은 src/dwr.js rowsOf 의 꼴이다.

import { nameKey } from './rnderp.js';

/** 더한 업무(이름 · 목표 % · e-Class 업무명)와 줄마다 내가 넣은 목표 %를 담는 storage 키 — { items: [{ name, rate, title? }], goals: { 줄 열쇠: % } }. */
export const SHARE_KEY = 'dwrShare';
export const SHARE_MAX = 10;
/** 더한 업무의 e-Class 업무명 한도. */
export const TITLE_MAX = 120;
/** 내가 넣은 목표는 이만큼까지 — 과제('prj:id')·참여율이 없는 과제('rnd:이름')·기타('etc') 줄. 더한 업무의 목표는 items 의 rate 다. */
export const GOAL_MAX = 40;
const GOAL_KEY = /^(?:(?:prj|rnd):.+|etc)$/;
/** 업무명과 과제명이 이만큼 닮으면 같은 과제다 — 일일 업무에 적은 과제명은 조금씩 다르다("통합협 PEMFC" ↔ "통합형 100kW급 PEMFC"). */
export const LIKE_MIN = 0.75;
/** 이 업무분류는 연구과제다(국가 R&D 과제 — '국가 R&D 과제 관리'는 아니다). nameKey 를 거친 글에 맞춘다. */
const RND_CATEGORY = /r&d과제$/;

const sum = (xs) => [...xs].reduce((s, x) => s + x, 0);
const squash = (s) => String(s ?? '').replace(/\s/g, '');
const clampRate = (v) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));
const ymOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

/** from~to(YYYY-MM-DD)가 걸친 달들(YYYY-MM). */
function monthsOf(from, to) {
  const out = [];
  for (let y = +from.slice(0, 4), m = +from.slice(5, 7); ymOf(y, m) <= to.slice(0, 7); m === 12 ? (y += 1, m = 1) : (m += 1)) out.push(ymOf(y, m));
  return out;
}

/**
 * 더한 업무 — 이름이 있고 겹치지 않는 것만, 목표는 0~100(소수 한 자리).
 * 줄마다 내가 넣은 목표(goals) — 열쇠가 과제·참여율이 없는 과제·기타 줄인 것만, 빈 칸은 뺀다(2026-10-28 사용자 지정: "3번째는 내가 입력할 수 있는 목표 업무 %").
 */
export function normalizeShare(raw) {
  const items = [];
  for (const x of Array.isArray(raw?.items) ? raw.items : []) {
    const name = String(x?.name ?? '').trim().slice(0, 40);
    const rate = Number(x?.rate);
    if (!nameKey(name) || items.some((y) => nameKey(y.name) === nameKey(name))) continue;
    // title — e-Class 업무명(작성 화면 업무 목록의 줄 이름, 2026-10-29 사용자 지정: AIP 는 「시험/인증업무>AIP 기술검토 및 관리」). 정했을 때만 둔다.
    const title = String(x?.title ?? '').trim().slice(0, TITLE_MAX);
    items.push({ name, rate: Number.isFinite(rate) ? clampRate(rate) : 0, ...(title ? { title } : {}) });
    if (items.length >= SHARE_MAX) break;
  }
  const goals = {};
  for (const [k, v] of Object.entries(raw?.goals && typeof raw.goals === 'object' ? raw.goals : {})) {
    if (!GOAL_KEY.test(k) || k.length > 120 || v == null || String(v).trim() === '' || !Number.isFinite(Number(v))) continue;
    goals[k] = clampRate(Number(v));
    if (Object.keys(goals).length >= GOAL_MAX) break;
  }
  return { items, goals };
}

/** 두 이름이 얼마나 닮았나(0~1) — nameKey 를 거친 글의 두 글자 묶음 겹침(Dice). */
export function likeness(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) || 0) + 1);
    return m;
  };
  const gx = grams(x);
  const gy = grams(y);
  let common = 0;
  for (const [g, n] of gx) common += Math.min(n, gy.get(g) || 0);
  const all = Math.max(0, x.length - 1) + Math.max(0, y.length - 1);
  return all ? (2 * common) / all : 0;
}

/**
 * R&D 장부에서 내 달마다 참여율.
 * @param {object} book src/rnd.js 장부 { projects: [{ id, name, alias, years: { n: { erp: { staff: { people } } } } }] }
 * @param {string} me 내 이름(설정 › 일반)
 * @returns {{ projects: Array<{ id, name, label, rates: Map<string, number> }> }} 장부의 모든 과제(내 참여율을 모르면 rates 가 비었다)
 */
export function myRates(book, me) {
  const projects = [];
  for (const p of Array.isArray(book?.projects) ? book.projects : []) {
    const rates = new Map();
    for (const y of Object.values(p?.years || {})) {
      const q = squash(me) ? (y?.erp?.staff?.people || []).find((x) => squash(x?.name) === squash(me)) : null;
      const monthly = Number(q?.erp?.monthly);
      if (!(monthly > 0)) continue;
      for (const x of q.plan || []) if (x?.ym && x.amt > 0) rates.set(x.ym, (x.amt / monthly) * 100);
    }
    if (p?.id) projects.push({ id: p.id, name: String(p.name || ''), label: String(p.alias || p.name || ''), rates });
  }
  return { projects };
}

/**
 * 줄 하나가 어디에 드나 — 더한 업무('item:이름') · 참여율이 있는 과제('prj:id') · 참여율이 없는 연구과제('rnd:과제 별칭' — R&D 탭 과제면 별칭, 아니면 업무명) · 기타('etc').
 * 일일 업무 짜기(src/dwrplan.js)도 지난 줄을 업무마다 모으는 데 쓴다.
 * @param {{title: string, category: string}} row src/dwr.js rowsOf 의 줄
 * @param {{name: string}[]} items 더한 업무
 * @param {ReturnType<typeof myRates>['projects']} projects
 */
export function lineKeyOf(row, items, projects) {
  const t = nameKey(row.title);
  const c = nameKey(row.category);
  // 더한 업무 — 업무명·업무분류에 그 이름이 들었거나, 그 업무에 정해 둔 e-Class 업무명과 같은 줄.
  const item = items.find((i) => { const k = nameKey(i.name); return t.includes(k) || c.includes(k) || (!!i.title && nameKey(i.title) === t); });
  if (item) return `item:${item.name}`;
  let best = null;
  let score = LIKE_MIN;
  for (const p of projects) {
    const s = likeness(row.title, p.name);
    if (s >= score) { best = p; score = s; }
  }
  if (best?.rates.size) return `prj:${best.id}`;
  if (best) return `rnd:${best.label}`;
  return RND_CATEGORY.test(c) && row.title ? `rnd:${row.title}` : 'etc';
}

/**
 * 기간의 업무 비율.
 * @param {ReturnType<import('./dwr.js').rowsOf>} rows
 * @param {{ from: string, to: string, items?: {name, rate}[], rates?: ReturnType<typeof myRates> }} q 참여율은 from~to 가 걸친 달들의 평균 — 올해의 열두 달이면 to 를 12월 31일로
 * @returns {{ minutes: number, lines: Array<{ key, kind: 'project'|'rnd'|'item'|'etc', label, name, rate, actual, target, months: {ym, actual, target, total}[], titles: [string, number][] }> }}
 *   rate 는 참여율 %(과제 줄 — 참여율이 없는 과제는 0, 그 밖은 null). actual·target 은 분(target 은 달마다 적은 분 × 참여율·정한 %, 기타는 null).
 *   줄 차례: 참여율이 있는 과제(참여율 큰 차례) → 참여율이 없는 과제(적은 차례) → 더한 업무(정한 차례) → 기타.
 */
export function workShare(rows, { from, to, items = [], rates = { projects: [] } }) {
  const keyOf = new Map();
  const byMonth = new Map();
  const titles = new Map();
  for (const r of rows || []) {
    if (!(r.date >= from && r.date <= to) || !(r.minutes > 0)) continue;
    const ck = `${r.title}\n${r.category}`;
    if (!keyOf.has(ck)) keyOf.set(ck, lineKeyOf(r, items, rates.projects));
    const key = keyOf.get(ck);
    const ym = r.date.slice(0, 7);
    const m = byMonth.get(ym) || byMonth.set(ym, new Map()).get(ym);
    m.set(key, (m.get(key) || 0) + r.minutes);
    const tm = titles.get(key) || titles.set(key, new Map()).get(key);
    tm.set(r.title, (tm.get(r.title) || 0) + r.minutes);
  }

  const lines = new Map();
  const line = (key) => lines.get(key) || lines.set(key, { key, actual: 0, target: 0, months: [] }).get(key);
  for (const i of items) line(`item:${i.name}`);
  // 참여율 칸 — 걸친 달들의 평균(참여하지 않은 달은 0). 그 기간에 적은 것이 없어도 참여율이 있으면 줄이 선다.
  const months = monthsOf(from, to);
  const rateOf = new Map(rates.projects.map((p) => [`prj:${p.id}`, sum(months.map((ym) => p.rates.get(ym) || 0)) / months.length]));
  for (const [k, v] of rateOf) if (v > 0) line(k);
  let minutes = 0;
  for (const [ym, m] of [...byMonth].sort((a, b) => a[0].localeCompare(b[0]))) {
    const T = sum(m.values());
    minutes += T;
    const goal = new Map(items.map((i) => [`item:${i.name}`, (T * i.rate) / 100]));
    for (const p of rates.projects) if (p.rates.get(ym) > 0) goal.set(`prj:${p.id}`, (T * p.rates.get(ym)) / 100);
    for (const k of new Set([...m.keys(), ...goal.keys()])) {
      const L = line(k);
      const a = m.get(k) || 0;
      const g = k === 'etc' ? a : goal.get(k) || 0;
      L.actual += a;
      L.target += g;
      L.months.push({ ym, actual: a, target: g, total: T });
    }
  }

  const named = new Map(rates.projects.flatMap((p) => [[`prj:${p.id}`, p], [`rnd:${p.label}`, p]]));
  const out = [...lines.values()]
    .filter((L) => L.key.startsWith('item:') || L.actual > 0 || L.target > 0 || rateOf.get(L.key) > 0)
    .map((L) => {
      const kind = L.key.startsWith('prj:') ? 'project' : L.key.startsWith('item:') ? 'item' : L.key.startsWith('rnd:') ? 'rnd' : 'etc';
      const p = named.get(L.key);
      const label = p ? p.label : kind === 'item' ? L.key.slice(5) : kind === 'rnd' ? L.key.slice(4) : '기타';
      const list = [...(titles.get(L.key) || [])].sort((a, b) => b[1] - a[1]);
      const rate = kind === 'project' ? rateOf.get(L.key) : kind === 'rnd' ? 0 : null;
      return { ...L, kind, label, name: p ? p.name : label, rate, target: kind === 'etc' ? null : L.target, titles: list };
    });
  const rank = { project: 0, rnd: 1, item: 2, etc: 3 };
  const order = new Map(items.map((i, n) => [`item:${i.name}`, n]));
  out.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.kind === 'item' ? order.get(a.key) - order.get(b.key) : b.rate - a.rate || b.target - a.target || b.actual - a.actual));
  return { minutes, lines: out };
}
