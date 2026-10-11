// kr_ext_rerp `lib/plan-sync.js` 를 그대로 옮긴 것 — IIFE 머리와 꼬리의 `g.KRX_PLAN_SYNC = api` 를 export 로만 바꿨다. 출처·갱신 규칙은 rerp/README.md.
/* 확장 Plus — 과제집행비율 예상 비용(lib/plan.js, storage.local.plannedExpenses)을 과제별 원노트 페이지와 동기화.
 * 백그라운드 전용(background.js planSync) · 순수 함수(flatten/merge/serialize/parse/titleFor)는 Node 테스트 겸용. 페이지 접근은 lib/plus-onenote.js, MCP 호출은 lib/mcp-client.js 에 맡긴다
 *
 * 페이지: 설정에서 고른 섹션(plus.sectionId) 안에 과제마다 한 장. 제목 "[예상 비용] {과제번호} {과제명}" — 과제번호로 찾으므로 동료 확장도 같은 섹션을 고르면 같은 페이지를 쓴다.
 *   없으면 **과제 책임자만** 만든다(deps.leadPrjNos: 참여인력 역할에 "책임"이 있거나 과제책임자 이름이 본인인 과제 — render.js isLead 와 같은 규칙).
 *   책임자인 과제는 항목이 없어도 동기화 때 **자동으로** 만든다(페이지가 공유의 단위라 늘 있어야 링크를 줄 수 있음, 2026-09-27 사용자). 책임자가 아니면 페이지가 생길 때까지 noPage 로 기다린다(오류 아님) — 동료가 보낸 링크를 가져오기로 적용하면 됨.
 *   만들기 전에(그리고 책임자가 아닌 사람이 페이지를 못 찾았을 때) sync_onenote_db 로 목록을 새로 받아 동료가 만든 페이지를 놓치지 않는다 (한 번의 동기화에 한 번만)
 *   찾은 페이지는 storage.local.plusPlanPages = { [과제번호]: { pageId, title, webUrl, sectionId, at } } 에 캐시 (섹션이 바뀌면 무시)
 * 블록 = 표 하나 <table data-id="krx-plan">: 제목 줄(동기화 시각·누가·건수·합계) + 머리글 + 항목 줄(비목·세목·수량·단가·금액·월간·작성자) + 맨 아래 기계용 한 칸 "krxplan1:BASE64"
 *   (Graph 의 replace 는 div 를 못 바꾸고 table 은 생성 id 로 되므로 표 하나로 묶는다 — 한 번의 PATCH 로 통째로 교체. OneNote 표는 셀 병합(colspan)이 없어 제목·JSON 은 첫 칸에 둔다)
 *   BASE64 = UTF-8 JSON { v:1, at(동기화 시각), by(누가), items:[{ id, prj(과제번호), key(재원|비목), name, qty, unit, amt, sub?:{date}, ts, by? }], del:{ [id]: 삭제 시각 } }
 *   진실은 JSON 이다 — 표는 보기용이라 원노트에서 표를 손으로 고쳐도 다음 동기화 때 덮인다. base64 라 OneNote 가 따옴표·기호를 바꾸거나 HTML 엔티티로 감싸도 안전
 * 병합(같은 페이지를 여러 사람이 쓰므로): 항목은 id 별로 ts(마지막 수정 시각)가 큰 쪽이 이김(같으면 로컬).
 *   삭제는 묘비 del[id]=삭제 시각으로 전파 — 묘비가 항목 ts 이상이면 삭제, 항목이 더 새로우면(다시 고친 것) 항목이 남고 묘비는 버림. 90일 지난 묘비는 버림(plan.js 도 같은 규칙)
 *   로컬 묘비(plannedDeleted)는 { [id]: { ts, prj } } (이전 형식 숫자도 받음)라 과제별 페이지에는 그 과제의 묘비만 싣는다
 *   병합 결과가 로컬과 다르면 로컬 저장소에 쓰고(pulled), 페이지와 다르면(또는 블록이 없으면) 페이지 블록을 통째로 바꾼다(pushed)
 * 상태: storage.local.planSyncState = { at, ok, reason, ms, count, errors, waiting, error?, pages: { [과제번호]: { prjNo, title, pageId, webUrl, at, created, pulled, pushed, count, remoteAt, remoteBy, noPage?, error? } } }
 *   — 패널 구름 아이콘 툴팁(과제별)·설정 페이지가 읽음. noPage = 페이지가 없고 내가 책임자가 아니라 못 만듦(책임자 생성 대기) */
const BLOCK = 'krx-plan', MAGIC = 'krxplan1:', TITLE_PREFIX = '[예상 비용] ';
const TOMB_TTL = 90 * 24 * 3600 * 1000;
const api = { BLOCK, TITLE_PREFIX };
const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const pad2 = (n) => String(n).padStart(2, '0');
const clock = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const money = (v) => num(v).toLocaleString('ko-KR');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* 묘비 값: 숫자(이전 형식) 또는 { ts, prj } */
const tombTs = (v) => (v && typeof v === 'object') ? num(v.ts) : num(v);
const tombPrj = (v) => (v && typeof v === 'object') ? String(v.prj || '') : '';
api.tombTs = tombTs; api.tombPrj = tombPrj;

/* base64 ↔ UTF-8 문자열 (서비스워커·Node 공용: TextEncoder + btoa) */
function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64dec(b64) {
  const bin = atob(String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, ''));
  const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* 페이지 제목 ↔ 과제번호 */
api.titleFor = (prjNo, prjNm) => `${TITLE_PREFIX}${String(prjNo || '').trim()}${prjNm ? ` ${String(prjNm).trim()}` : ''}`;
api.prjOfTitle = (title) => { const m = /^\s*\[예상 비용\]\s*(\S+)/.exec(String(title || '')); return m ? m[1] : ''; };

/* 항목 정규화: 저장소의 { [prj]: { [key]: [entry] } } ↔ 평면 목록 [{ id, prj, key, ...entry }] */
function normEntry(e) {
  const o = { id: String(e.id || ''), prj: String(e.prj || ''), key: String(e.key || ''), name: String(e.name || ''), qty: num(e.qty) || 1, unit: num(e.unit), amt: num(e.amt), ts: num(e.ts) };
  if (e.sub && e.sub.date) o.sub = { date: String(e.sub.date) };
  if (e.by) o.by = String(e.by);
  return o;
}
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

/* 병합. local = { items, del } · remote = { items, del } | null(블록 없음) → { items, del(숫자 맵), localChanged, remoteChanged } */
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

/* 블록 HTML. opts.title = 제목 줄에 넣을 과제 표시("과제명 (과제번호)"), opts.calc = { qtyOf, amtOf }(월간 구독의 남은 횟수 계산, 없으면 저장값) */
api.serialize = function (data, opts) {
  opts = opts || {};
  const calc = opts.calc || null;
  const items = (data.items || []).map(normEntry).sort((a, b) => (a.prj + a.key + a.name).localeCompare(b.prj + b.key + b.name, 'ko'));
  const qtyOf = (e) => (calc && calc.qtyOf ? calc.qtyOf(e) : e.qty);
  const amtOf = (e) => (calc && calc.amtOf ? calc.amtOf(e) : e.amt);
  const keyName = (k) => { const i = k.indexOf('|'); return i >= 0 ? k.slice(i + 1) : k; };
  let total = 0;
  const rows = items.map((e) => {
    const amt = amtOf(e); total += amt;
    return `<tr><td>${esc(keyName(e.key))}</td><td>${esc(e.name)}</td><td>${money(qtyOf(e))}</td><td>${money(e.unit)}</td><td>${money(amt)}</td><td>${e.sub ? `매월 ${esc(e.sub.date)}부터` : ''}</td><td>${esc(e.by || '')}${e.ts ? `<br/>${esc(clock(e.ts))}` : ''}</td></tr>`;
  }).join('');
  const head = '<tr><td><b>비목</b></td><td><b>세목</b></td><td><b>수량</b></td><td><b>단가</b></td><td><b>금액</b></td><td><b>월간</b></td><td><b>작성</b></td></tr>';
  const payload = { v: 1, at: data.at || Date.now(), by: data.by || '', items, del: data.del || {} };
  const json = MAGIC + b64enc(JSON.stringify(payload));
  const blank = '<td></td>'.repeat(6);
  return `<table data-id="${BLOCK}" border="1">`
    + `<tr><td><b>R&amp;D ERP 예상 비용</b>${opts.title ? ` · ${esc(opts.title)}` : ''} (KR eClass 확장 · 과제집행비율) · ${esc(clock(payload.at))} ${esc(payload.by)} · ${items.length}건 · 합계 ${money(total)}원 — 확장이 이 표를 통째로 갱신하므로 손으로 고친 내용은 남지 않습니다</td>${blank}</tr>`
    + head + rows
    + `<tr><td style="font-size:6pt;color:#c0c4cc">${json}</td>${blank}</tr>`
    + '</table>';
};
/* 블록 안쪽 HTML → { items, del, at, by } | null (JSON 칸이 없거나 못 풀면 null). 태그를 걷어낸 글에서 krxplan1: 뒤의 base64 를 읽는다 (OneNote 가 줄을 나누거나 span 으로 감싸도 됨) */
api.parse = function (inner) {
  const text = String(inner || '').replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, '');
  const m = new RegExp(`${MAGIC}([A-Za-z0-9+/=]+)`).exec(text);
  if (!m) return null;
  try {
    const p = JSON.parse(b64dec(m[1]));
    if (!p || !Array.isArray(p.items)) return null;
    return { items: p.items.map(normEntry), del: p.del || {}, at: num(p.at), by: String(p.by || '') };
  } catch (e) { return null; }
};

/* 로컬 묘비 맵에서 이 과제 몫(prj 가 같거나 없는 것) → 숫자 맵 */
const delSlice = (del, prj) => { const out = {}; for (const [id, v] of Object.entries(del || {})) { const p = tombPrj(v); if (!p || p === prj) out[id] = tombTs(v); } return out; };
/* 과제 하나의 병합 결과를 로컬 전체 구조에 되돌려 넣는다 (다른 과제는 그대로) */
function putBack(local, prj, items, del) {
  const plans = Object.assign({}, local.plans);
  delete plans[prj];
  Object.assign(plans, api.unflatten(items));
  const all = Object.assign({}, local.del);
  for (const [id, v] of Object.entries(all)) { const p = tombPrj(v); if ((!p || p === prj) && del[id] == null) delete all[id]; }
  for (const [id, ts] of Object.entries(del)) all[id] = { ts, prj };
  return { plans, del: all };
}

/* 동기화 한 번(과제별). deps = { client(열린 MCP 클라이언트), onenote(KRX_ONENOTE), sectionId, pages?(캐시 맵), names?({ prjNo: 과제명 }), myPrjNos?([과제번호] 내 참여 과제),
 *   leadPrjNos?([과제번호] 내가 책임자인 과제 — 이 과제만 페이지를 만들 수 있음), only?(과제번호 하나만), createAll?(항목이 없는 책임 과제도 페이지 생성),
 *   calc?, who?, loadLocal() → { plans, del }, saveLocal(plans, del, prj)(prj 몫만 저장하면 다른 창의 편집과 안 겹침), now? }
 * → { state, pages }  (state 는 위 planSyncState 형식에서 reason/ms 를 뺀 것, pages 는 갱신된 캐시 맵) */
api.run = async function (deps) {
  const now = deps.now || Date.now();
  const O = deps.onenote, sectionId = String(deps.sectionId || '');
  const names = deps.names || {};
  // 캐시: 이 섹션에서 찾은 페이지 + 링크로 연결한 페이지(bound — 섹션과 무관, 동료가 보낸 링크를 가져오기로 적용한 것)
  const cache = {};
  for (const [prj, p] of Object.entries(deps.pages || {})) if (p && p.pageId && (p.bound || (sectionId && p.sectionId === sectionId))) cache[prj] = p;
  const mine = new Set((deps.myPrjNos || []).map(String));
  const lead = new Set((deps.leadPrjNos || []).map(String));
  // 1) 대상 과제: 로컬에 항목이 있는 과제 ∪ 섹션에 페이지가 있는 내 참여 과제 ∪ 링크로 연결한 과제 ∪ 내가 책임자인 과제 전부(페이지가 없으면 자동 생성). 섹션이 없으면(RERP 미해결) 연결한 페이지만
  let local = await deps.loadLocal();
  const hasItems = (prj) => api.flatten(local.plans, prj).length > 0;
  let found = {};
  let listed = false, refreshed = false;
  const listPages = async () => { found = {}; if (sectionId) for (const p of await O.listSectionPages(deps.client, sectionId)) { const prj = api.prjOfTitle(p.title); if (prj && !found[prj]) found[prj] = Object.assign({ sectionId, at: now }, p); } listed = true; };
  const refreshList = async () => { if (!refreshed && sectionId) { await O.syncDb(deps.client); refreshed = true; } await listPages(); };   // Graph 전체 목록으로 MCP DB 갱신 뒤 다시 (한 번의 동기화에 한 번만)
  if (!deps.only || !cache[deps.only]) await listPages();
  const targets = new Set();
  if (deps.only) targets.add(String(deps.only));
  else {
    for (const prj of Object.keys(local.plans || {})) if (hasItems(prj)) targets.add(prj);
    for (const prj of Object.keys(found)) if (mine.has(prj) || hasItems(prj)) targets.add(prj);
    for (const prj of Object.keys(cache)) if (cache[prj].bound) targets.add(prj);
    if (sectionId) for (const prj of lead) if (mine.size === 0 || mine.has(prj)) targets.add(prj);   // 책임 과제는 항목이 없어도 (페이지 자동 생성)
  }
  // 2) 과제마다: 페이지 찾기/만들기 → 읽기 → 병합 → 로컬 저장 → 페이지 갱신
  const pages = {}, results = {};
  let errors = 0, waiting = 0, firstError = '', total = 0, synced = false;
  for (const prj of targets) {
    const title = api.titleFor(prj, names[prj]);
    const r = { prjNo: prj, title, at: now, created: false, pulled: false, pushed: false, count: 0, remoteAt: 0, remoteBy: '' };
    try {
      let page = cache[prj] || found[prj] || null;
      if (!page) {
        if (!hasItems(prj) && !(lead.has(prj) && sectionId)) continue;   // 적어 둔 것도 페이지도 없고 내가 만들 수도 없으면 할 일 없음
        if (!listed) await listPages();
        page = found[prj] || null;
        if (!page) { await refreshList(); page = found[prj] || null; }   // 책임자(동료)가 방금 만들었을 수 있으니 목록을 새로 받아 한 번 더
        if (!page && (!lead.has(prj) || !sectionId)) {   // 책임자가 아니거나(또는 RERP 섹션을 아직 못 정했으면) 만들지 않고 기다린다 (툴팁·설정 표에 "책임자 생성 대기" — 동료가 보낸 링크를 가져오기로 적용하면 됨)
          r.noPage = true; r.count = api.flatten(local.plans, prj).length; results[prj] = r; waiting++;
          continue;
        }
        if (!page) {
          local = await deps.loadLocal();
          const items = api.flatten(local.plans, prj);
          const html = api.serialize({ items, del: delSlice(local.del, prj), at: now, by: deps.who || '' }, { title: names[prj] ? `${names[prj]} (${prj})` : prj, calc: deps.calc });
          const made = await O.createPage(deps.client, sectionId, title, html);
          page = Object.assign({ sectionId, at: now }, made);
          Object.assign(r, { pageId: page.pageId, title: page.title || title, webUrl: page.webUrl || '', created: true, pushed: true, count: items.length });
          pages[prj] = page; results[prj] = r; total += items.length; synced = true;
          continue;
        }
      }
      const html = await O.readPage(deps.client, page.pageId);
      const block = O.findBlock(html, BLOCK);
      const remote = block ? api.parse(block.inner) : null;
      local = await deps.loadLocal();
      const m = api.merge({ items: api.flatten(local.plans, prj), del: delSlice(local.del, prj) }, remote, now);
      if (m.localChanged) { const back = putBack(local, prj, m.items, m.del); await deps.saveLocal(back.plans, back.del, prj); local = back; }   // saveLocal 은 prj 몫만 쓰는 것이 안전 (background.js)
      if (m.remoteChanged || !block) {
        const out = api.serialize({ items: m.items, del: m.del, at: now, by: deps.who || '' }, { title: names[prj] ? `${names[prj]} (${prj})` : prj, calc: deps.calc });
        await O.writeBlock(deps.client, page.pageId, BLOCK, out, block);
        r.pushed = true;
      }
      Object.assign(r, { pageId: page.pageId, title: O.pageTitle(html) || page.title || title, webUrl: page.webUrl || '', pulled: m.localChanged, count: m.items.length, remoteAt: remote ? remote.at : 0, remoteBy: remote ? remote.by : '' });
      pages[prj] = Object.assign({}, page, { title: r.title, at: now });
      total += m.items.length; synced = true;
    } catch (e) {
      errors++; r.error = String((e && e.message) || e); r.kind = e && e.kind; if (!firstError) firstError = r.error;
    }
    results[prj] = r;
  }
  const state = { at: now, ok: errors === 0, count: total, errors, waiting, pages: results, synced };
  if (errors) state.error = firstError;
  return { state, pages: Object.assign({}, cache, pages) };
};

api._b64enc = b64enc; api._b64dec = b64dec;
export default api;
