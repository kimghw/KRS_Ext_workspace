// kr_ext_rerp `lib/staff-sync.js` 를 그대로 옮긴 것 — IIFE 머리와 꼬리의 `g.KRX_STAFF_SYNC = api` 를 export 로만 바꿨다(원본이 전역 g.KRX_STAFF 로 읽던 것은 아래 shim). 출처·갱신 규칙은 rerp/README.md.
/* 공유 (Plus) — 사업비(참여연구원 참여율·지급액 계획 · 예산 줄, lib/staff.js storage.local.staffPlans)의 병합 규칙. 과제 폴더의 연차 파일(<n>차년도.json 의 staff 칸 — 그 연차 계획 하나, 예산 줄은 budget 칸에도 — lib/prjdoc.js v2)과 로컬을 맞출 때 lib/prjdoc.js mergeYear 가 부른다.
 * 백그라운드 전용 · 순수 함수라 Node 테스트 겸용. 0.8.7 (2026-10-18) 개발 중에는 원노트 「[사업비] 과제번호 과제명」 페이지의 표(serialize/parse)·페이지 찾기(run)까지 여기 있었으나,
 *   저장소가 SharePoint 폴더의 JSON 으로 바뀌어(사용자 결정 "mcp 없이 … 브라우저 토큰으로" · "변경내역/예산등이 다 포함") 병합과 그 보조만 남겼다 — 파일 읽기·쓰기는 lib/sp-store.js, 문서 모양은 lib/prjdoc.js, 과제별 차례는 lib/prjdoc-sync.js.
 *
 * 계획 모양은 lib/staff.js normalizePlanEntry(prjNo · year · from · to · budgetPay · budget · basis · src · people · at · by · note) — 저장소 맵의 키는 "과제번호@연차"(planKey).
 * 병합: 연차마다 at(마지막 수정 시각)이 큰 쪽이 이김(같으면 로컬). 지급 완료(paid — rERP 자금현황에서 셈한 사실, lib/staff.js paidThroughOf)는 계획의 at 과 따로 **paid.at 큰 쪽**(rERP 를 늦게 조회한 쪽 — 계획을 안 고친 사람의 조회도 퍼지고 새 계획의 옛 paid 가 덮지 않게, 2026-10-19).
 *   삭제는 묘비(storage.local.staffPlansDeleted, lib/staff.js remove — { "과제번호@연차": 지운 시각 })로 전파 —
 *   묘비가 계획 at 이상이면 삭제, 계획이 더 새로우면 계획이 남고 묘비 폐기. 90일 지난 묘비는 버림. 과제별 파일에는 그 과제 몫만(delSlice), 되돌려 넣기는 putBack */
import KRX_STAFF from './staff.js';
const g = { KRX_STAFF };   // [workspace] 원본은 전역 g.KRX_STAFF 를 읽는다
const TOMB_TTL = 90 * 24 * 3600 * 1000;
const api = {};
const S = () => g.KRX_STAFF;
const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };

/* 계획 목록 정리 — 연차 있는 것만, 키 차례. 저장소 맵({ key: plan }) 이든 목록이든 받는다. prj 를 주면 그 과제만 */
api.plansOf = function (plans, prj) {
  const list = Array.isArray(plans) ? plans : Object.values(plans && typeof plans === 'object' ? plans : {});
  const out = [];
  for (const p of list) {
    const e = S().normalizePlanEntry(p);
    if (!e || !e.prjNo || !(e.year >= 1) || (prj && e.prjNo !== prj)) continue;
    out.push(e);
  }
  return out.sort((a, b) => S().planKey(a.prjNo, a.year).localeCompare(S().planKey(b.prjNo, b.year)));
};
const keyOf = (p) => S().planKey(p.prjNo, p.year);
api.keyOf = keyOf;
const canon = (plans) => JSON.stringify(api.plansOf(plans));
const canonDel = (del) => JSON.stringify(Object.entries(del || {}).map(([k, v]) => [k, num(v)]).sort());
api.gcTomb = function (del, now) {
  const out = {}; const t0 = (now || Date.now()) - TOMB_TTL;
  for (const [k, v] of Object.entries(del || {})) if (num(v) > t0) out[k] = num(v);
  return out;
};

/* 병합. local = { plans(목록 또는 맵), del } · remote = { plans, del } | null(파일에 아직 없음) → { plans(목록), del(숫자 맵), localChanged, remoteChanged } */
api.merge = function (local, remote, now) {
  const L = { plans: api.plansOf((local && local.plans) || []), del: (local && local.del) || {} };
  const R = { plans: api.plansOf((remote && remote.plans) || []), del: (remote && remote.del) || {} };
  const best = new Map();
  for (const p of L.plans) best.set(keyOf(p), p);
  for (const p of R.plans) { const cur = best.get(keyOf(p)); if (!cur || p.at > cur.at) best.set(keyOf(p), p); }
  // 지급 완료(paid — rERP 자금현황에서 셈한 사실)는 계획의 at 과 따로 paid.at 큰 쪽(rERP 를 늦게 조회한 쪽) — 계획을 안 고친 사람이 조회한 것도 퍼지고, 계획이 새 쪽의 옛 paid 가 덮지 않게
  const Lp = new Map(L.plans.map((p) => [keyOf(p), p.paid || null])), Rp = new Map(R.plans.map((p) => [keyOf(p), p.paid || null]));
  for (const [k, p] of best) {
    const a = Lp.get(k) || null, b = Rp.get(k) || null;
    const win = a && b ? (b.at > a.at ? b : a) : (a || b);
    if ((win || null) !== (p.paid || null)) { const q = Object.assign({}, p); if (win) q.paid = win; else delete q.paid; best.set(k, q); }
  }
  const del = {};
  for (const [k, v] of Object.entries(L.del)) del[k] = Math.max(num(v), num(del[k]));
  for (const [k, v] of Object.entries(R.del)) del[k] = Math.max(num(v), num(del[k]));
  const plans = [];
  for (const [k, p] of best) {
    if (del[k] != null && del[k] >= p.at) continue;   // 묘비가 계획보다 새로움 → 삭제
    if (del[k] != null) delete del[k];                // 계획이 더 새로움(다시 세움) → 묘비 폐기
    plans.push(p);
  }
  const gc = api.gcTomb(del, now);
  return {
    plans, del: gc,
    localChanged: canon(plans) !== canon(L.plans) || canonDel(gc) !== canonDel(L.del),
    remoteChanged: !remote || canon(plans) !== canon(R.plans) || canonDel(gc) !== canonDel(R.del)
  };
};

/* 로컬 묘비에서 이 과제 몫 */
api.delSlice = (del, prj) => { const out = {}; for (const [k, v] of Object.entries(del || {})) if (k.split('@')[0] === prj) out[k] = num(v); return out; };
/* 과제 하나의 병합 결과(plans 목록 · del 숫자 맵)를 로컬 맵 { plans, del } 에 되돌려 넣는다 (다른 과제는 그대로) */
api.putBack = function (local, prj, plans, del) {
  const map = {};
  for (const [k, v] of Object.entries((local && local.plans) || {})) if (!(v && v.prjNo === prj && v.year >= 1) && k.split('@')[0] !== prj) map[k] = v;
  for (const p of plans || []) map[keyOf(p)] = p;
  const all = {};
  for (const [k, v] of Object.entries((local && local.del) || {})) if (k.split('@')[0] !== prj) all[k] = num(v);
  for (const [k, ts] of Object.entries(del || {})) all[k] = num(ts);
  return { plans: map, del: all };
};

export default api;
