// R&D 탭의 예산 칸에 rERP 집행내역을 잇는 **이 확장만의 풀**(2026-10-11 사용자 지정 — "rerp 의 지출조회와 원노트 동기화를 R&D 탭에").
// rERP 를 부르는 코드·집행비율 셈·예상 비용·원노트 동기화는 kr_ext_rerp 에서 옮긴 rerp/ 폴더(rerp/erp.js · rerp/planui.js · rerp/plan.js · rerp/plussync.js)가 하고,
// 여기는 장부(src/rnd.js 의 rndBook)와 그것을 잇는 순수 로직만 둔다 — 차년도 ↔ rERP 과제 잇기(어느 연차 행인가), 받은 것(스냅샷)을 장부 줄에(집행 = 승인액), 비목 맞추기, 칸 머리 글.
//
// 장부에 남는 것: project.years[n].erp = { prjNo, anl, prjNm, rspr, stDt, endDt, auto, linkedAt, snap }
//   snap = { at, std, budget(rerp/erp.js fetchBudget 결과 + withPending — bgtAmt·apprAmt·balAmt·reqAmt·rate·items[]·unbilled·pending·execAmt·balAfter·rateAll …), cards:{ from, to, count, amount }, error }
//   budget 줄(r)에 erpKey '재원코드|비목명' — 맞춰진 rERP 비목. 있으면 집행 칸은 읽기 전용이고 used 는 rERP 승인액을 따른다. 예상 비용의 키(rerp/plan.js itemKey)와 같은 꼴이라 같은 원노트 페이지에서 만난다.
// 살아 있는 조회는 오늘이 든 차년도만(isLive) — 지난 차년도는 마지막 스냅샷이 장부에 남는다(rERP 는 덮어쓰지만 장부는 해마다 남긴다). 다시 받는 주기는 10분(ERP_TTL_MS, rerp 의 refreshMinutes 와 같다).

/** 마지막 조회가 이만큼 지났으면 다시 받는다(rerp 설정 refreshMinutes 기본 10분과 같다). */
export const ERP_TTL_MS = 10 * 60 * 1000;

/** R&D 설정이 남는 곳(chrome.storage). */
export const SET_KEY = 'rndSettings';
/**
 * R&D 설정 — erp: 예산 칸에 rERP 집행내역을 보이고 rERP 를 부르는가(기본 켬, R&D 설정 칸) · 장부의 집행 칸에 승인액 말고 무엇을 더할지(2026-10-11 사용자 지정 — 체크는 예산 칸 맨 위 줄 "집행에 더하기"):
 * unbilled 미청구(이 과제 카드로 썼지만 청구 전 — 비목이 없어 합계에만) · plan 사용계획(예상 비용).
 * 승인전(req — 청구했지만 결재 전인 신청금액)은 2026-10-11 사용자 지정으로 뺐다: 집행에 더하지 않고 저장돼 있던 req 도 읽지 않는다(rERP 집행비율에는 rerp 식대로 든다).
 * hide: 예산 칸에서 숨긴 비목 이름들(2026-10-11 사용자 지정 — "R&D 설정에서 어떤 항목을 볼지 고르게"). 줄만 숨고 합계·표 복사·요약에는 그대로 든다. 이름은 nameKey 로 견준다(isHidden).
 */
export function normalizeSet(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const hide = [...new Set((Array.isArray(o.hide) ? o.hide : []).map((v) => text(v, 60)).filter(Boolean))].slice(0, 40);
  return { erp: o.erp !== false, unbilled: o.unbilled === true, plan: o.plan === true, hide };
}
/** 설정에 따라 집행에 더하는 것의 이름들 — 기록 글용. */
export const includeNames = (set) => [set?.unbilled ? '미청구' : '', set?.plan ? '사용계획' : ''].filter(Boolean);
/** 예산 칸에서 숨긴 비목인가 — 설정의 hide 와 이름 키(nameKey — 띄어쓰기·`·`·괄호 안 무시)로 견준다. 빈 이름은 숨기지 않는다. */
export function isHidden(set, item) {
  const k = nameKey(item);
  return !!k && (Array.isArray(set?.hide) ? set.hide : []).some((h) => nameKey(h) === k);
}

const text = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max).trim() : '');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * 비목 이름 맞추기용 키 — 괄호 안(`간접비(출금)` 의 `(출금)` — 2026-10-11 실서버의 비목명)을 통째로 걷고, 띄어쓰기·`·`·`/`·줄표를 걷어 소문자.
 * `연구시설·장비비` = `연구시설장비비` = `연구시설 장비비`, `간접비(출금)` = `간접비`.
 */
export const nameKey = (s) => String(s ?? '').replace(/\([^)]*\)|（[^）]*）/g, '').replace(/[\s·・ㆍ/()（）\-]/g, '').toLowerCase();

/** rERP 의 날짜(20260401 · 2026-04-01 · 2026.04.01) → 'YYYY-MM-DD'. 못 읽으면 ''. */
export function d8(s) {
  const d = String(s ?? '').replace(/\D/g, '');
  return d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '';
}

/* ------------------------------------------------------------ 잇기 */

const keyOf = (s) => String(s ?? '').replace(/\s/g, '').toLowerCase();

/**
 * rERP 과제 목록의 원본 행(rcomm_0009_01_r001 — 과제번호×연차마다 한 행)에서 장부 과제의 행들 — 과제번호가 같은 것, 없으면 과제명이 같은 것.
 * @returns {{ prjNo, anl, prjNm, rspr, stDt, endDt, status }[]} 연차 차례
 */
export function projectRecs(recs, { code = '', name = '' } = {}) {
  const rows = (Array.isArray(recs) ? recs : []).map((r) => ({
    prjNo: text(r?.PRJ_NO, 40), anl: num(r?.ANL), prjNm: text(r?.PRJ_NM), rspr: text(r?.PRJ_RSPR_EMP_NM, 40),
    stDt: d8(r?.RCH_ST_DT), endDt: d8(r?.RCH_END_DT), status: text(r?.PROG_STS_NM, 20),
  })).filter((r) => r.prjNo);
  let hit = code ? rows.filter((r) => keyOf(r.prjNo) === keyOf(code)) : [];
  if (!hit.length && name) hit = rows.filter((r) => keyOf(r.prjNm) === keyOf(name));
  return hit.sort((a, b) => a.anl - b.anl);
}

/**
 * 차년도에 맞는 rERP 행 — ① 연차(ANL)가 차년도 번호와 같은 행 ② 연구기간이 그 차년도 구간을 품는 행 ③ 행이 하나뿐이면 그것. 못 고르면 null.
 * @param {{ n:number, start:string, end:string }} year 장부의 차년도(src/rnd.js yearsOf)
 */
export function pickYearRec(rows, year) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const byAnl = list.find((r) => r.anl === year?.n);
  if (byAnl) return byAnl;
  if (year?.start) {
    const around = list.find((r) => r.stDt && r.endDt && r.stDt <= year.start && year.end <= r.endDt);
    if (around) return around;
  }
  return list.length === 1 ? list[0] : null;
}

/**
 * 저절로 못 골랐을 때 고르게 할 후보 — 과제번호마다 연차가 큰 행 하나씩, 과제명이 장부 과제명과 비슷한 것(앞 여섯 글자가 들어감) 먼저, 그 다음 시작일이 늦은 것 먼저.
 * @returns {{ prjNo, anl, prjNm, rspr, stDt, endDt, status, like:boolean }[]}
 */
export function candidates(recs, { name = '' } = {}) {
  const byNo = new Map();
  for (const raw of Array.isArray(recs) ? recs : []) {
    const r = { prjNo: text(raw?.PRJ_NO, 40), anl: num(raw?.ANL), prjNm: text(raw?.PRJ_NM), rspr: text(raw?.PRJ_RSPR_EMP_NM, 40), stDt: d8(raw?.RCH_ST_DT), endDt: d8(raw?.RCH_END_DT), status: text(raw?.PROG_STS_NM, 20) };
    if (!r.prjNo) continue;
    const prev = byNo.get(r.prjNo);
    if (!prev || r.anl >= prev.anl) byNo.set(r.prjNo, r);
  }
  // 장부 과제명의 낱말(두 글자 이상, 흔한 말은 뺌)이 rERP 과제명에 들어가면 비슷한 것 — 많이 겹칠수록 앞.
  const stop = new Set(['개발', '연구', '과제', '기술', '시스템', '사업', '관한', '위한', '대한', '및']);
  const tokens = String(name ?? '').split(/\s+/).map((w) => nameKey(w)).filter((w) => w.length >= 2 && !stop.has(w));
  const score = (nm) => { const k = nameKey(nm); return tokens.filter((w) => k.includes(w)).length; };
  return [...byNo.values()].map((r) => ({ ...r, score: score(r.prjNm), like: score(r.prjNm) > 0 }))
    .sort((a, b) => (b.score - a.score) || (b.stDt || '').localeCompare(a.stDt || '') || a.prjNo.localeCompare(b.prjNo))
    .map(({ score: _s, ...r }) => r);
}

/** 고른 행을 장부에 둘 잇기 모양으로. */
export const linkOf = (rec, { auto = true, now = Date.now() } = {}) => ({
  prjNo: rec.prjNo, anl: num(rec.anl), prjNm: rec.prjNm || '', rspr: rec.rspr || '', stDt: rec.stDt || '', endDt: rec.endDt || '', auto: !!auto, linkedAt: now, snap: null,
});

/** 저장된 잇기를 지금 모양으로 — 과제번호가 없으면 null(이어지지 않은 차년도). */
export function normalizeErp(raw) {
  if (!raw || typeof raw !== 'object' || !text(raw.prjNo, 40)) return null;
  const snap = raw.snap && typeof raw.snap === 'object' && raw.snap.budget && typeof raw.snap.budget === 'object' ? {
    at: num(raw.snap.at), std: text(raw.snap.std, 4) || '10', budget: raw.snap.budget,
    cards: raw.snap.cards && typeof raw.snap.cards === 'object' ? { from: text(raw.snap.cards.from, 10), to: text(raw.snap.cards.to, 10), count: num(raw.snap.cards.count), amount: num(raw.snap.cards.amount) } : { from: '', to: '', count: 0, amount: 0 },
    error: text(raw.snap.error, 400),
  } : null;
  return {
    prjNo: text(raw.prjNo, 40), anl: num(raw.anl), prjNm: text(raw.prjNm), rspr: text(raw.rspr, 40), stDt: d8(raw.stDt) || text(raw.stDt, 10), endDt: d8(raw.endDt) || text(raw.endDt, 10),
    auto: raw.auto !== false, linkedAt: num(raw.linkedAt), snap,
  };
}

/** 오늘이 든 차년도인가 — 살아 있는 조회는 이것만. 연구기간이 없으면(기간 미정) 산다. */
export const isLive = (year, today) => !year?.start || (year.start <= today && today <= year.end);
/** 마지막 조회가 아직 신선한가. */
export const isFresh = (snap, now = Date.now(), ttl = ERP_TTL_MS) => !!(snap && snap.at && !snap.error && now - snap.at < ttl);

/* ------------------------------------------------------------ 받기 */

/**
 * rERP 에서 한 과제의 집행내역을 받아 스냅샷으로 — 비목별 잔액(fetchBudget) + 미청구 카드(fetchCards: 차년도 시작일부터 오늘 + 한 달) → withPending.
 * "로그인 필요"(kind 'login')로 끝나면 eClass SSO(ssoLogin)를 **한 번** 하고 다시 받는다. eClass 도 풀렸으면 kind 'eclass-login' 으로 던진다.
 * @param {{ fetchBudget, fetchCards, withPending, ssoLogin, settingsOf }} erp rerp/erp.js (검사에서는 흉내)
 */
export async function fetchSnapshot(erp, prjNo, { year, today, now = Date.now(), settings = {} } = {}) {
  const months = year?.start && year.start <= today ? Math.max(1, monthsBetween(year.start, today) + 1) : 6;
  const s = erp.settingsOf({ ...settings, monthsBack: months, monthsForward: 1 });
  const once = async () => {
    const budget = await erp.fetchBudget(prjNo, s);
    let cards = [];
    let cardsError = '';
    try { cards = await erp.fetchCards(prjNo, s); } catch (err) { if (err?.kind === 'login') throw err; cardsError = String(err?.message || err); }
    erp.withPending(budget, cards.reduce((a, c) => a + (c.amount || 0), 0), cards.length);
    return { at: now, std: budget.std || '10', budget, cards: { from: year?.start || '', to: today, count: cards.length, amount: budget.unbilled }, error: cardsError ? `미청구 카드는 못 받음 — ${cardsError}` : '' };
  };
  try {
    return await once();
  } catch (err) {
    if (err?.kind !== 'login') throw err;
    await erp.ssoLogin();
    return once();
  }
}

/** 두 날짜 사이의 달 수(내림). */
export function monthsBetween(from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

/* ------------------------------------------------------------ 비목 맞추기 · 장부에 */

/**
 * 장부의 비목 줄과 rERP 비목(fetchBudget 의 items — 재원이 여럿이면 같은 비목이 재원마다 한 줄)을 이름 키로 맞춘다.
 * @returns {{ matched: Map<string, { key:string, keys:string[], appr:number, bgt:number, bal:number, req:number, items:object[] }>, orphans: object[] }}
 *   matched 는 장부 줄 id → 그 비목의 rERP 합(재원 합) · 키(첫 재원의 '재원코드|비목', 예상 비용의 키와 같은 꼴). orphans 는 rERP 에만 있는 비목.
 */
export function matchRows(bookRows, items) {
  const groups = new Map();
  for (const x of Array.isArray(items) ? items : []) {
    const k = nameKey(x.exp || x.item);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, { keys: [], appr: 0, bgt: 0, bal: 0, req: 0, items: [] });
    const g = groups.get(k);
    g.keys.push(`${x.resCd || x.res || ''}|${x.exp || x.item || ''}`);
    g.appr += num(x.appr); g.bgt += num(x.bgt); g.bal += num(x.bal); g.req += num(x.req);
    g.items.push(x);
  }
  const matched = new Map();
  const used = new Set();
  for (const r of Array.isArray(bookRows) ? bookRows : []) {
    const k = nameKey(r.item);
    const g = k ? groups.get(k) : null;
    if (!g || used.has(k)) continue;
    used.add(k);
    matched.set(r.id, { key: g.keys[0], keys: g.keys, appr: g.appr, bgt: g.bgt, bal: g.bal, req: g.req, items: g.items });
  }
  const orphans = [...groups.entries()].filter(([k]) => !used.has(k)).flatMap(([, g]) => g.items);
  return { matched, orphans };
}

/** 미청구(과제카드) 몫이 드는 장부 비목 — 과제카드 청구는 연구활동비로 올린다(2026-10-12 사용자 지정: "미청구 체크했는데도 연구활동비에 반영이 안됨"). 이 이름의 맞춰진 줄이 없으면 합계 위 보조 줄로(rndpanel.js). */
export const UNBILLED_ITEM = '연구활동비';

/**
 * 스냅샷을 장부 줄에 — 맞춰진 줄은 집행(used)에 rERP 승인액(+ 설정에 따라 사용계획 planned(key), 미청구 unbilled)을 넣고 erpKey 를 적는다. 안 맞는 줄은 erpKey 를 비운다(손으로 적은 집행은 둔다).
 * 더한 사용계획 몫은 erpPlan(원)에, 미청구 몫은 erpUnbilled(원)에 따로 적어 둔다 — 줄 아래 막대가 승인액과 다른 색으로 그린다(2026-10-11 사용자 지정). 0 이면 지운다. 장부에 남지만 읽을 때(src/rnd.js normalizeRow) 걷히는 셈값이다.
 * 미청구는 UNBILLED_ITEM(연구활동비) 이름의 맞춰진 줄 하나에만 든다(2026-10-12 사용자 지정) — 그 줄이 없으면 어느 줄에도 들지 않는다(패널이 합계 위 보조 줄로).
 * 승인전(req)은 더하지 않는다(2026-10-11 사용자 지정) — matchRows 가 세어 두지만 여기서는 쓰지 않는다.
 * @param {{ planned?: ((key:string) => number)|null, unbilled?: number }} opts planned 는 '재원코드|비목' 키의 예상 비용 합(rerp/plan.js sumOf·listOf) · unbilled 는 미청구(원, erpExtras)
 * @returns {number} 바뀐 줄 수
 */
export function applySnapshot(bookRows, snap, { planned = null, unbilled = 0 } = {}) {
  const rows = Array.isArray(bookRows) ? bookRows : [];
  const { matched } = matchRows(rows, snap?.budget?.items);
  const ubKey = nameKey(UNBILLED_ITEM);
  let changed = 0;
  for (const r of rows) {
    const m = matched.get(r.id);
    if (m) {
      const plan = planned ? m.keys.reduce((a, k) => a + (Number(planned(k)) || 0), 0) : 0;
      const ub = num(unbilled) > 0 && nameKey(r.item) === ubKey ? num(unbilled) : 0;
      const used = m.appr + plan + ub;
      if (r.used !== used || r.erpKey !== m.key || (r.erpPlan || 0) !== plan || (r.erpUnbilled || 0) !== ub) changed++;
      r.used = used;
      r.erpKey = m.key;
      if (plan > 0) r.erpPlan = plan; else delete r.erpPlan;
      if (ub > 0) r.erpUnbilled = ub; else delete r.erpUnbilled;
    } else if (r.erpKey) {
      delete r.erpKey;
      delete r.erpPlan;
      delete r.erpUnbilled;
      changed++;
    }
  }
  return changed;
}

/** 장부에 더하는 과제 단위 몫 — 미청구(과제카드). 설정에서 끄면 0. applySnapshot 이 UNBILLED_ITEM 줄에 넣고, 그 줄이 없으면 패널이 합계 위 보조 줄로 보인다. */
export function erpExtras(snap, set) {
  const b = snap?.budget;
  if (!b || !set?.unbilled) return { unbilled: 0, count: 0 };
  return { unbilled: num(b.unbilled), count: num(b.unbilledCount) };
}

/* ------------------------------------------------------------ 글 */

const pad = (n) => String(n).padStart(2, '0');
export const clock = (ms) => { const d = new Date(ms); return `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const pct = (v) => `${(Math.trunc((Number(v) || 0) * 10) / 10).toFixed(1)}%`;

/** 칸 머리 뒤에 붙는 rERP 형편 — `rERP 집행비율 45.1%` · `rERP 로그인 필요` · `rERP 못 받음`. 이어지지 않았으면 ''. */
export function erpHead(erp) {
  if (!erp) return '';
  const s = erp.snap;
  const why = erp.error ? (erp.error.kind === 'login' || erp.error.kind === 'eclass-login' ? '로그인 필요' : '못 받음') : '';
  if (!s?.budget) return why ? `rERP ${why}` : 'rERP 이음';
  const b = s.budget;
  return `rERP 집행비율 ${pct(b.rateAll ?? b.rate)}${why ? ` · ${why}` : ''}`;
}

/** 요약 글(src/rnd.js summaryText)에 들어가는 rERP 줄들. 스냅샷이 없으면 []. */
export function erpSummaryLines(erp) {
  const s = erp?.snap;
  if (!s?.budget) return [];
  const b = s.budget;
  const won = (n) => `${Math.round(num(n)).toLocaleString('ko-KR')}원`;
  const lines = [`- rERP ${erp.prjNo}${erp.prjNm ? ` ${erp.prjNm}` : ''}${erp.anl ? ` (${erp.anl}연차)` : ''} · 조회 ${clock(s.at)}${s.std === '20' ? ' · 본예산 기준' : ''}`];
  lines.push(`- rERP 집행비율 ${pct(b.rateAll ?? b.rate)} = (승인액 ${won(b.apprAmt)} + 미청구 ${won(b.unbilled || 0)} + 승인전 ${won(b.reqAmt || 0)}) ÷ 예산액 ${won(b.bgtAmt)}${b.exclNames?.length ? ` (${b.exclNames.join('·')} 제외)` : ''}`);
  if (b.unbilledCount || b.reqAmt) lines.push(`- 미청구 과제카드 ${num(b.unbilledCount)}건 ${won(b.unbilled || 0)} · 승인전 ${won(b.reqAmt || 0)} · 잔액(미청구 반영) ${won(b.balAfter ?? b.balAmt)}`);
  if (s.error) lines.push(`- ${s.error}`);
  return lines;
}
