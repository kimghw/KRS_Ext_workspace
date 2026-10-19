// kr_ext_rerp `lib/plan-sync.js` 를 그대로 옮긴 것 — IIFE 머리와 꼬리의 `g.KRX_PLAN_SYNC = api` 를 export 로만 바꿨다. 출처·갱신 규칙은 rerp/README.md.
/* 공유 (Plus) — 과제집행비율 예상 비용(lib/plan.js, storage.local.plannedExpenses)의 병합 규칙. 과제 폴더의 예상비용.json(plan 칸 — lib/prjdoc.js v2, 연차에 걸치는 항목이 두 파일에 걸치지 않게 과제마다 한 파일)과 로컬을 맞출 때 lib/prjdoc.js mergePlan 이 부른다.
 * 백그라운드 전용 · 순수 함수라 Node 테스트 겸용. 0.8.7 (2026-10-18) 까지는 원노트 페이지의 표(serialize/parse)·페이지 찾기(run)까지 여기 있었으나, 저장소가 SharePoint 폴더의 JSON 으로 바뀌어
 *   (사용자 결정 "mcp 없이 … 브라우저 토큰으로" · "과제 별로 하면 1개 … json 이나 yaml 형식") 병합과 그 보조만 남겼다 — 파일 읽기·쓰기는 lib/sp-store.js, 문서 모양은 lib/prjdoc.js, 과제별 차례는 lib/prjdoc-sync.js.
 *
 * 항목의 평면 모양 [{ id, prj(과제번호), key(재원|비목), name, qty, unit, amt, sub?:{date}, ts(마지막 수정 시각), by?(작성자) }] ↔ 저장소 모양 { [prj]: { [key]: [항목] } } 은 flatten/unflatten.
 * 병합(같은 파일을 여러 사람이 쓰므로): 항목은 id 별로 ts 가 큰 쪽이 이김(같으면 로컬).
 *   삭제는 묘비 del[id]=삭제 시각으로 전파 — 묘비가 항목 ts 이상이면 삭제, 항목이 더 새로우면(다시 고친 것) 항목이 남고 묘비는 버림. 90일 지난 묘비는 버림(plan.js 도 같은 규칙)
 *   로컬 묘비(plannedDeleted)는 { [id]: { ts, prj } } (이전 형식 숫자도 받음)라 과제별 파일에는 그 과제의 묘비만 싣는다(delSlice) — 병합 결과를 로컬 전체 구조에 되돌려 넣는 것은 putBack */
const TOMB_TTL = 90 * 24 * 3600 * 1000;
const api = {};
const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
/* 묘비 값: 숫자(이전 형식) 또는 { ts, prj } */
const tombTs = (v) => (v && typeof v === 'object') ? num(v.ts) : num(v);
const tombPrj = (v) => (v && typeof v === 'object') ? String(v.prj || '') : '';
api.tombTs = tombTs; api.tombPrj = tombPrj;

/* 항목 정규화: 저장소의 { [prj]: { [key]: [entry] } } ↔ 평면 목록 [{ id, prj, key, ...entry }] */
function normEntry(e) {
  const o = { id: String(e.id || ''), prj: String(e.prj || ''), key: String(e.key || ''), name: String(e.name || ''), qty: num(e.qty) || 1, unit: num(e.unit), amt: num(e.amt), ts: num(e.ts) };
  if (e.sub && e.sub.date) o.sub = { date: String(e.sub.date) };
  if (e.by) o.by = String(e.by);
  return o;
}
api.normEntry = normEntry;
api.flatten = function (plans, onlyPrj) {
  const out = [];
  for (const [prj, byKey] of Object.entries(plans || {})) {
    if (onlyPrj && prj !== onlyPrj) continue;
    for (const [key, list] of Object.entries(byKey || {})) for (const e of list || []) if (e && e.id) out.push(normEntry(Object.assign({}, e, { prj, key })));
  }
  return out;
};
api.unflatten = function (items) {
  const plans = {};
  for (const it of items || []) {
    if (!it || !it.id || !it.prj || !it.key) continue;
    const e = { id: it.id, name: it.name, qty: it.qty, unit: it.unit, amt: it.amt, ts: it.ts };
    if (it.sub) e.sub = { date: it.sub.date };
    if (it.by) e.by = it.by;
    (plans[it.prj] = plans[it.prj] || {})[it.key] = (plans[it.prj][it.key] || []).concat([e]);
  }
  return plans;
};
const canon = (items) => JSON.stringify((items || []).map(normEntry).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
const canonDel = (del) => JSON.stringify(Object.entries(del || {}).map(([k, v]) => [k, tombTs(v)]).sort());
api.gcTomb = function (del, now) {
  const out = {}; const t0 = (now || Date.now()) - TOMB_TTL;
  for (const [id, v] of Object.entries(del || {})) if (tombTs(v) > t0) out[id] = tombTs(v);
  return out;
};

/* 병합. local = { items, del } · remote = { items, del } | null(파일에 아직 없음) → { items, del(숫자 맵), localChanged, remoteChanged } */
api.merge = function (local, remote, now) {
  const L = { items: (local && local.items) || [], del: (local && local.del) || {} };
  const R = { items: (remote && remote.items) || [], del: (remote && remote.del) || {} };
  const best = new Map();
  for (const e of L.items.map(normEntry)) best.set(e.id, e);
  for (const e of R.items.map(normEntry)) { const cur = best.get(e.id); if (!cur || e.ts > cur.ts) best.set(e.id, e); }
  const del = {};
  for (const [id, v] of Object.entries(L.del)) del[id] = Math.max(tombTs(v), num(del[id]));
  for (const [id, v] of Object.entries(R.del)) del[id] = Math.max(tombTs(v), num(del[id]));
  const items = [];
  for (const e of best.values()) {
    if (del[e.id] != null && del[e.id] >= e.ts) continue;   // 묘비가 항목보다 새로움 → 삭제
    if (del[e.id] != null) delete del[e.id];               // 항목이 더 새로움(다시 고침) → 묘비 폐기
    items.push(e);
  }
  const gc = api.gcTomb(del, now);
  return {
    items, del: gc,
    localChanged: canon(items) !== canon(L.items) || canonDel(gc) !== canonDel(L.del),
    remoteChanged: !remote || canon(items) !== canon(R.items) || canonDel(gc) !== canonDel(R.del)
  };
};

/* 로컬 묘비 맵에서 이 과제 몫(prj 가 같거나 없는 것) → 숫자 맵 */
api.delSlice = (del, prj) => { const out = {}; for (const [id, v] of Object.entries(del || {})) { const p = tombPrj(v); if (!p || p === prj) out[id] = tombTs(v); } return out; };
/* 과제 하나의 병합 결과(items 평면 · del 숫자 맵)를 로컬 전체 구조 { plans, del } 에 되돌려 넣는다 (다른 과제는 그대로) */
api.putBack = function (local, prj, items, del) {
  const plans = Object.assign({}, (local && local.plans) || {});
  delete plans[prj];
  Object.assign(plans, api.unflatten(items));
  const all = Object.assign({}, (local && local.del) || {});
  for (const [id, v] of Object.entries(all)) { const p = tombPrj(v); if ((!p || p === prj) && (del || {})[id] == null) delete all[id]; }
  for (const [id, ts] of Object.entries(del || {})) all[id] = { ts: num(ts), prj };
  return { plans, del: all };
};

export default api;
