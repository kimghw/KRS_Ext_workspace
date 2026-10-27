// 업무 비율 — 일일 업무 카드(dwrbox.js)의 업무별 업무량을 비율(%)로, 연구과제 참여율로 달마다 셈한 목표 비율과 나란히 보인다
// (2026-10-27 사용자 지정: "연구개발 참여율을 월간으로 계산했을 때 해야 되는 업무 시간을 업무별 업무량이랑 같이 보이게 해줘 시간 비율로" ·
// "전체 비중은 100, 이중 5% 는 AIP 일부 기타 있겠고, 이 나머지를 연구 참여율 비중으로 나누는 거야. 월간으로 계산해서 반영해야해").
//
// 달마다: 그 달에 적은 분(T) 가운데 — 내가 더한 업무(AIP 5% …)는 T × 정한 %, 기타(연구과제도 더한 업무도 아닌 것 — 연구기획 기타·부서소통회 …)는 적은 만큼,
// 남은 몫을 그 달 내 참여율의 비중으로 연구과제마다 나눈다. 기간의 실제·목표는 달마다의 합이다.
// 그래서 업무를 더하거나 % 를 올리면 과제들의 목표가 참여율 비중대로 줄고, 내리거나 빼면 같은 비중대로 늘며, 기타와 다른 더한 업무는 그대로다
// (2026-10-27 사용자 지정: "기타는 변경되면 안되서" · "새로 목표가 추가 되면 다른 항목이 비중별로 감소 … 다른 항목이 줄어 들면 과제들은 동일한 비중으로 늘어 나고").
// 내 참여율은 R&D 탭 장부(src/rnd.js rndBook)의 rERP 참여인력(erp.staff — rerp/staff.js 사람 모양)에서 내 이름의 달마다 지급 ÷ 월급여.
// 그 달 내 참여율이 없는 연구과제(R&D 탭에 없거나 참여인력에 내가 없는 과제 — 업무분류가 '… R&D 과제'인 업무)는 과제마다 한 줄이고 목표는 0 이다
// (2026-10-27 사용자 지정: "이건 목표가 0인데 준적이 없음"). 참여율을 하나도 모르는 달만 연구과제 몫을 적은 비중대로 둔다(틀린 목표를 만들지 않는다).
// 화면도 저장소도 모른다 — 일일 업무 줄은 src/dwr.js rowsOf 의 꼴이다.

import { nameKey } from './rnderp.js';

/** 더한 업무(이름 · 목표 %)를 담는 storage 키 — { items: [{ name, rate }] }. */
export const SHARE_KEY = 'dwrShare';
export const SHARE_MAX = 10;
/** 업무명과 과제명이 이만큼 닮으면 같은 과제다 — 일일 업무에 적은 과제명은 조금씩 다르다("통합협 PEMFC" ↔ "통합형 100kW급 PEMFC"). */
export const LIKE_MIN = 0.75;
/** 이 업무분류는 연구과제다(국가 R&D 과제 — '국가 R&D 과제 관리'는 아니다). nameKey 를 거친 글에 맞춘다. */
const RND_CATEGORY = /r&d과제$/;

const sum = (xs) => [...xs].reduce((s, x) => s + x, 0);
const squash = (s) => String(s ?? '').replace(/\s/g, '');

/** 더한 업무 — 이름이 있고 겹치지 않는 것만, 목표는 0~100(소수 한 자리). */
export function normalizeShare(raw) {
  const items = [];
  for (const x of Array.isArray(raw?.items) ? raw.items : []) {
    const name = String(x?.name ?? '').trim().slice(0, 40);
    const rate = Number(x?.rate);
    if (!nameKey(name) || items.some((y) => nameKey(y.name) === nameKey(name))) continue;
    items.push({ name, rate: Number.isFinite(rate) ? Math.min(100, Math.max(0, Math.round(rate * 10) / 10)) : 0 });
    if (items.length >= SHARE_MAX) break;
  }
  return { items };
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
 */
function classify(row, items, projects) {
  const t = nameKey(row.title);
  const c = nameKey(row.category);
  const item = items.find((i) => { const k = nameKey(i.name); return t.includes(k) || c.includes(k); });
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
 * @param {{ from: string, to: string, items?: {name, rate}[], rates?: ReturnType<typeof myRates> }} q
 * @returns {{ minutes: number, unknown: string[], lines: Array<{ key, kind: 'project'|'rnd'|'item'|'etc', label, name, actual, target, months: {ym, actual, target, total}[], titles: [string, number][] }> }}
 *   actual·target 은 분(기타의 target 은 null — 적은 만큼이다). unknown 은 참여율을 하나도 몰라 연구과제 몫을 적은 대로 둔 달(YYYY-MM).
 *   줄 차례: 참여율이 있는 과제(목표 큰 차례) → 참여율이 없는 과제(적은 차례) → 더한 업무(정한 차례) → 기타.
 */
export function workShare(rows, { from, to, items = [], rates = { projects: [] } }) {
  const keyOf = new Map();
  const byMonth = new Map();
  const titles = new Map();
  for (const r of rows || []) {
    if (!(r.date >= from && r.date <= to) || !(r.minutes > 0)) continue;
    const ck = `${r.title}\n${r.category}`;
    if (!keyOf.has(ck)) keyOf.set(ck, classify(r, items, rates.projects));
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
  const unknown = [];
  let minutes = 0;
  for (const [ym, m] of [...byMonth].sort((a, b) => a[0].localeCompare(b[0]))) {
    const T = sum(m.values());
    minutes += T;
    const goal = new Map();
    let fixed = 0;
    for (const i of items) {
      goal.set(`item:${i.name}`, (T * i.rate) / 100);
      fixed += (T * i.rate) / 100;
    }
    const pool = Math.max(0, T - fixed - (m.get('etc') || 0));
    const share = new Map();
    for (const p of rates.projects) if (p.rates.get(ym) > 0) share.set(`prj:${p.id}`, p.rates.get(ym));
    if (!share.size) {
      for (const [k, v] of m) if (k.startsWith('rnd:') || k.startsWith('prj:')) share.set(k, v);
      if (share.size) unknown.push(ym);
    }
    const S = sum(share.values());
    for (const [k, v] of share) goal.set(k, S ? (pool * v) / S : 0);
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
    .filter((L) => L.key.startsWith('item:') || L.actual > 0 || L.target > 0)
    .map((L) => {
      const kind = L.key.startsWith('prj:') ? 'project' : L.key.startsWith('item:') ? 'item' : L.key.startsWith('rnd:') ? 'rnd' : 'etc';
      const p = named.get(L.key);
      const label = p ? p.label : kind === 'item' ? L.key.slice(5) : kind === 'rnd' ? L.key.slice(4) : '기타';
      const list = [...(titles.get(L.key) || [])].sort((a, b) => b[1] - a[1]);
      return { ...L, kind, label, name: p ? p.name : label, target: kind === 'etc' ? null : L.target, titles: list };
    });
  const rank = { project: 0, rnd: 1, item: 2, etc: 3 };
  const order = new Map(items.map((i, n) => [`item:${i.name}`, n]));
  out.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.kind === 'item' ? order.get(a.key) - order.get(b.key) : b.target - a.target || b.actual - a.actual));
  return { minutes, unknown, lines: out };
}
