// 공문(구매·교육·출장)의 비용을 R&D 탭 과제의 예산과 견주는 순수 로직(2026-10-12 사용자 지정: "구매 또는 공문 작성 시 비용을 R&D 의 연구활동비나 비용을 비교해서
// 예산이 남아 있는지 … r&d 에 과제 rerp 기능이 연동이 되어 있다면"). 화면은 gongmunpanel.js 의 예산 줄(gmBudget — 과제 기본 내용 아래)이 그린다.
//
// 무엇과 견주는가 — 고른 과제(R&D 탭의 장부 rndBook)의 **오늘이 든 차년도**에서
//   ① rERP 집행내역이 이어져 있고(years[n].erp.snap, R&D 설정에서 켜 둠) 그 스냅샷에 공문 계정의 비목이 있으면 **그 비목의 rERP 잔액**(BAL_AMT = 예산 − 승인 − 승인전 — 재원이 여럿이면 합)
//      에서, R&D 설정의 "집행에 더하기"대로 사용계획(그 비목 키의 예상 비용, rerp/plan.js)과 미청구(연구활동비 줄에만 — src/rnderp.js UNBILLED_ITEM)를 뺀 것. R&D 탭 예산 칸의 잔액과 같은 셈이다.
//      그 비목이 rERP 에 없으면 과제 합계(제외 비목을 뺀 bgtAmt·balAmt)로 견주고 "비목 없음"이라고 적는다.
//   ② rERP 가 없으면(잇지 않음·설정에서 끔) 장부에 손으로(또는 계획서 YAML 로) 적은 그 비목의 계획 − 집행. 그 줄에 계획이 없으면 차년도 합계.
//   ③ 둘 다 없으면 null — 패널이 "R&D 예산 정보 없음"이라고 흐리게 보인다.
// 비목은 공문의 계정 글에서 고른다(itemOf) — 구매 `연구활동비(연구실운용비)`·교육 `연구활동비(교육훈련비)`·출장 `연구활동비(국내여비)`(레시피 purpose.yaml 의 account, 과제·초안에 적은 계정이 이긴다) → 괄호 안(세목)을 걷은 `연구활동비`.
// 이름은 nameKey(띄어쓰기·`·`·괄호 무시)로 견주고, 똑같은 것이 없으면 한쪽이 다른 쪽의 앞부분인 것(`연구활동비국내여비` ↔ `연구활동비`) 가운데 가장 긴 것.
// 모자라도 공문 작성을 막지는 않는다(100만원 한도와 다르다) — rERP 조회가 10분 묵을 수 있고 비목을 잘못 맞출 수 있어 붉게 알리기만 한다. 어디에도 보내지 않는다.

import { currentYear, hasBudget, budgetTotals, won, comma, yearLabel } from './rnd.js';
import { nameKey, normalizeSet, erpExtras, UNBILLED_ITEM, clock } from './rnderp.js';
import PLAN from '../rerp/plan.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const sum = (list, k) => list.reduce((a, x) => a + num(x?.[k]), 0);

/**
 * 공문의 계정 글 → 견줄 비목 이름. 괄호 안(세목)을 걷고 줄표·쌍점·빗금 뒤를 자른다 — `연구활동비(연구실운용비)` → `연구활동비`, `연구활동비 - 국내여비` → `연구활동비`,
 * `연구시설·장비비` 는 그대로(가운뎃점은 이름의 일부). 비면 연구활동비(UNBILLED_ITEM — 과제카드 청구가 올라가는 비목이기도 하다).
 */
export function itemOf(account) {
  const s = String(account ?? '').replace(/\([^)]*\)|（[^）]*）/g, '').split(/[-–—:/>]/)[0].trim();
  return s || UNBILLED_ITEM;
}

/** 이름 키들 가운데 key 와 맞는 것 — 똑같은 것, 없으면 한쪽이 다른 쪽의 앞부분인 것 가운데 가장 긴 것. 없으면 ''. */
export function matchKey(keys, key) {
  const list = [...new Set((Array.isArray(keys) ? keys : []).filter(Boolean))];
  if (!key) return '';
  if (list.includes(key)) return key;
  return list.filter((k) => k.startsWith(key) || key.startsWith(k)).sort((a, b) => b.length - a.length)[0] || '';
}

/**
 * 고른 과제의 올해 차년도 예산과 이번 비용을 견준다.
 * @param {object} book src/rnd.js normalizeBook 을 지난 장부
 * @param {string} projectId R&D 과제 id(src/gongmun.js rndProjects 의 rnd.id)
 * @param {{ amount?: number|null, account?: string, today?: string, set?: object|null, plans?: object }} o
 *   amount 이번 비용(원 — 몰라서 null 이면 잔액만) · account 공문의 계정 글(비목은 itemOf) · set R&D 설정(rndSettings 원본 — normalizeSet) · plans 예상 비용(plannedExpenses)
 * @returns {null | { state:'ok'|'short'|'noamount', source:'rerp'|'book', item:string, name:string, matched:boolean, year:number, prjNo:string, at:number,
 *   plan:number, used:number, left:number, amount:number|null, after:number|null, rate:number|null, rateAfter:number|null, parts:null|{ appr:number, req:number, planned:number, unbilled:number } }}
 *   null 이면 견줄 예산이 없다(과제·차년도 없음, rERP 도 손으로 적은 계획도 없음). item 은 찾으려던 비목, name 은 실제 맞춘 줄의 이름(합계면 ''), parts 는 rERP 일 때의 내역.
 */
export function budgetCheck(book, projectId, { amount = null, account = '', today = '', set = null, plans = {} } = {}) {
  const p = (book?.projects || []).find((x) => x.id === projectId);
  if (!p) return null;
  const n = currentYear(p, today || undefined);
  const y = p.years?.[n];
  if (!y) return null;
  const s = normalizeSet(set);
  const item = itemOf(account);
  const key = nameKey(item);
  const amt = Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null;
  const finish = (base) => {
    const after = amt == null ? null : base.left - amt;
    const rate = base.plan > 0 ? Math.round((base.used / base.plan) * 100) : null;
    const rateAfter = base.plan > 0 && amt != null ? Math.round(((base.used + amt) / base.plan) * 100) : null;
    return { ...base, item, year: n, amount: amt, after, rate, rateAfter, state: amt == null ? 'noamount' : after < 0 ? 'short' : 'ok' };
  };

  const e = y.erp;
  if (s.erp && e?.snap?.budget) {
    const b = e.snap.budget;
    const items = Array.isArray(b.items) ? b.items : [];
    const keyOf = (x) => nameKey(x?.exp || x?.item);
    const hit = matchKey(items.map(keyOf), key);
    const mine = hit ? items.filter((x) => keyOf(x) === hit) : [];
    const plannedOf = (list) => (s.plan ? list.reduce((a, x) => a + num(PLAN.sumOf(PLAN.listOf(plans, e.prjNo, PLAN.itemKey(x)))), 0) : 0);
    const ub = s.unbilled ? num(erpExtras(e.snap, s).unbilled) : 0;
    if (mine.length) {
      const bgt = sum(mine, 'bgt'), appr = sum(mine, 'appr'), req = sum(mine, 'req'), bal = sum(mine, 'bal');
      const planned = plannedOf(mine);
      const unbilled = hit === nameKey(UNBILLED_ITEM) ? ub : 0;
      return finish({
        source: 'rerp', matched: true, name: String(mine[0].exp || mine[0].item || item).trim(), prjNo: e.prjNo, at: num(e.snap.at),
        plan: bgt, used: bgt - bal + planned + unbilled, left: bal - planned - unbilled, parts: { appr, req, planned, unbilled },
      });
    }
    const planned = plannedOf(items.filter((x) => !x.excluded));
    const bgt = num(b.bgtAmt), bal = num(b.balAmt);
    return finish({
      source: 'rerp', matched: false, name: '', prjNo: e.prjNo, at: num(e.snap.at),
      plan: bgt, used: bgt - bal + planned + ub, left: bal - planned - ub, parts: { appr: num(b.apprAmt), req: num(b.reqAmt), planned, unbilled: ub },
    });
  }

  if (!hasBudget(y)) return null;
  const rows = y.budget || [];
  const hit = matchKey(rows.map((r) => nameKey(r.item)), key);
  const row = hit ? rows.find((r) => nameKey(r.item) === hit) : null;
  if (row && row.plan != null) {
    return finish({ source: 'book', matched: true, name: row.item, prjNo: '', at: 0, plan: row.plan, used: row.used || 0, left: row.plan - (row.used || 0), parts: null });
  }
  const t = budgetTotals(rows);
  if (!(t.plan > 0)) return null;
  return finish({ source: 'book', matched: false, name: '', prjNo: '', at: 0, plan: t.plan, used: t.used, left: t.left, parts: null });
}

/**
 * 예산 줄의 글 — 패널(gmBudget)과 검사가 같은 글을 본다. null 이면 ''.
 *   `R&D 예산 · 연구활동비 잔액 23,838,661원 → 이번 989,000원 쓰면 22,849,661원 남음 (집행 45% → 48%) · rERP 10.12 09:30`
 *   `R&D 예산 부족 — 연구활동비 잔액 500,000원 < 이번 989,000원 · 489,000원 모자람 (집행 99% → 101%) · rERP 10.12 09:30`
 *   `R&D 예산 · 과제 합계 잔액 … (연구재료비 비목 없음) · R&D 장부 — 금액을 적으면 견줍니다`
 */
export function budgetText(c) {
  if (!c) return '';
  const where = c.matched ? `${c.name || c.item} 잔액` : '과제 합계 잔액';
  const src = c.source === 'rerp' ? `rERP ${clock(c.at)}` : 'R&D 장부';
  const miss = c.matched ? '' : ` (${c.item} 비목 없음)`;
  const pct = c.rate == null ? '' : c.rateAfter == null ? ` (집행 ${c.rate}%)` : ` (집행 ${c.rate}% → ${c.rateAfter}%)`;
  if (c.state === 'noamount') return `R&D 예산 · ${where} ${won(c.left)}${pct}${miss} · ${src} — 금액을 적으면 견줍니다`;
  if (c.state === 'short') return `R&D 예산 부족 — ${where} ${won(c.left)} < 이번 ${won(c.amount)} · ${won(-c.after)} 모자람${pct}${miss} · ${src}`;
  return `R&D 예산 · ${where} ${won(c.left)} → 이번 ${won(c.amount)} 쓰면 ${won(c.after)} 남음${pct}${miss} · ${src}`;
}

/** 예산 줄의 툴팁 — 잔액이 어떻게 나왔는지(rERP 는 예산·승인·승인전·미청구·사용계획, 장부는 계획·집행)와 차년도·rERP 과제번호. null 이면 ''. */
export function budgetTitle(c) {
  if (!c) return '';
  const head = c.matched ? `${c.name || c.item}` : `과제 합계(${c.item} 비목이 ${c.source === 'rerp' ? 'rERP 집행내역' : 'R&D 예산 칸'}에 없음)`;
  if (c.source === 'rerp') {
    const x = c.parts || { appr: 0, req: 0, planned: 0, unbilled: 0 };
    const extra = [x.unbilled ? `미청구 ${comma(x.unbilled)}원` : '', x.planned ? `사용계획 ${comma(x.planned)}원` : ''].filter(Boolean);
    return `${head} · ${yearLabel(c.year)} · rERP ${c.prjNo} 조회 ${clock(c.at)}\n잔액 ${comma(c.left)}원 = 예산 ${comma(c.plan)}원 − 승인 ${comma(x.appr)}원 − 승인전 ${comma(x.req)}원${extra.length ? ` − ${extra.join(' − ')}` : ''}`
      + (extra.length ? '\n(미청구·사용계획은 R&D 설정의 "집행에 더하기"대로)' : '')
      + '\n모자라도 작성은 막지 않습니다 — R&D 탭에서 ↻ 로 다시 받아 확인하세요';
  }
  return `${head} · ${yearLabel(c.year)} · R&D 탭 예산 칸(손으로 적은 계획·집행 — rERP 를 이으면 그 잔액으로 견줍니다)\n잔액 ${comma(c.left)}원 = 계획 ${comma(c.plan)}원 − 집행 ${comma(c.used)}원`;
}
