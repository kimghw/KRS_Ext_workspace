// kr_ext_rerp `lib/plan.js` 를 그대로 옮긴 것. 바꾼 곳은 셋뿐이다(rerp/README.md "옮기며 바꾼 것") —
//   ① IIFE 머리·꼬리를 import/export 로 (`g.KRX_FMT` 는 아래 shim `g` 로 그대로 읽음)
//   ② 백그라운드에 보내던 chrome.runtime.sendMessage(planExport · planBind · planSync · planSyncQueue) 네 곳을 `api.send(msg)` 로 — 기본은 그대로 sendMessage 이고,
//      WORKSPACE 사이드패널은 rerp/plussync.js 의 send() 를 끼워 같은 창 안에서 돌린다
/* 과제집행비율 보기의 "예상 비용" (비목별 세목·수량·단가 계획) 저장소 + 입력 처리. eClass 콘텐츠스크립트 / 팝업 공용
 * storage.local.plannedExpenses = { [과제번호]: { [비목 키]: [ { id, name(세목), qty(수량), unit(단가), amt(금액), ts, sub?: { date: 'YYYY-MM-DD' } } ] } }
 *   sub 가 있으면 월간 구독: date(첫 결제일)의 "일"에 매월 결제로 보고, 수량 = 오늘(포함) 이후 올해 12월까지 남은 결제 횟수를 그릴 때마다 다시 센다 (날짜가 지나면 줄어듦).
 *   금액 = 남은 횟수 × 단가(월 결제액). 저장된 qty/amt 는 저장 시점 값이고 실제 표시·합계는 qtyOf()/amtOf() 로 계산한다
 * 표에서는 기본으로 감춰져(＋·항목 줄·예상 반영 행이 빠지고 과제 행의 예상 잔액만 남음) 머리글의 눈 아이콘을 누른 동안만 보인다. 보이기 상태는 저장하지 않는다(state.planShown)
 * 비목 키 = "재원코드|비목명" (재원이 여럿인 과제는 재원별로 같은 비목이 따로 나오므로 재원을 앞에 붙임)
 * R&D ERP 에는 저장하지 않고 이 브라우저(확장 저장소 storage.local)에만 남으며, 입력·수정·삭제 때마다 자동 저장되어 브라우저를 다시 시작해도 남는다.
 * 저장 아이콘은 지금 한 번 더 저장하고 "저장됨"을 잠깐 보여 준다. storage.local.plannedSavedAt = 마지막 저장 시각 (아이콘 툴팁)
 * 확장 Plus(설정 plus.sectionId)가 켜져 있으면 백그라운드가 같은 값을 과제별 원노트 페이지와 동기화한다(lib/plan-sync.js). 그때 필요한 것들:
 *   storage.local.plannedDeleted = { [id]: { ts(삭제 시각), prj(과제번호) } } 묘비 — 삭제를 다른 사람에게 전파 (90일 지나면 버림, 이전 형식 숫자도 읽음) · 항목의 ts(마지막 수정 시각, 수량 −/＋ 도 갱신)로 병합 · by(작성자 = R&D ERP 로그인 이름)
 *   storage.local.planSyncState = 마지막 동기화 결과 · storage.local.plusPlanPages = 과제별 페이지 캐시 (둘 다 백그라운드가 씀, 아이콘 툴팁·링크) · 저장 뒤 requestSync('edit') → 백그라운드가 4초 모아서 동기화, bind() 때 requestSync('load')
 *   저장 아이콘 옆의 원노트 아이콘(render.js): plan-export(내보내기 = 이 과제 페이지의 링크+ID 를 클립보드에 복사해 동료에게 전달. 페이지가 없으면 먼저 만듦(책임자) → 다시 누르면 복사) ·
 *   plan-import(가져오기 = 동료가 보낸 링크를 붙여 넣는 칸(state.planImport)을 열고, 적용하면 background planBind 로 이 과제를 그 페이지에 연결한 뒤 항목을 가져옴) · 열기(링크).
 *   Plus 가 꺼져 있으면 켜라는 안내. 저장 아이콘은 늘 로컬 저장 + "저장됨". 실제 병합은 양방향(id 별 더 최근 수정)이고 이후 동기화는 자동
 * 렌더러(render.js)는 state.plans / state.planShown / state.planSavedAt / state.planSaved{prjNo,text,error,busy} / state.planSync / state.planEdit / state.planDraft / state.planError 를 읽는다 */
import FMT from './fmt.js';
const g = { KRX_FMT: FMT };
const F = g.KRX_FMT;
const KEY = 'plannedExpenses';
const HKEY = 'plannedHidden';   // 이전 버전의 감춤 목록. 지금은 쓰지 않아 load() 가 지운다
const TKEY = 'plannedSavedAt';
const DKEY = 'plannedDeleted';  // 묘비 { [id]: { ts, prj } } (확장 Plus 동기화의 삭제 전파용. 이전 형식: 숫자)
const SKEY = 'planSyncState';   // 마지막 동기화 상태 (background.js planSync 가 씀)
const PKEY = 'plusPlanPages';   // 과제별 페이지 캐시 { [과제번호]: { pageId, title, webUrl, sectionId } } (링크 복사용)
const TOMB_TTL = 90 * 24 * 3600 * 1000;
const EMPTY = () => ({ name: '', qty: '1', unit: '', amt: '', sub: false, date: '' });
let savedAtCache = 0;   // load() 가 읽어 둔 마지막 저장 시각. bind() 가 state.planSavedAt 의 초기값으로 씀
let deletedCache = {}, syncCache = null, pagesCache = {}, whoCache = '';   // load() 가 읽어 둔 묘비 · 동기화 상태 · 페이지 캐시 · 작성자 이름(rndUser.userNm)
const api = {};
api._now = () => new Date();   // 테스트에서 바꿔 끼움
/* [workspace] 백그라운드로 보내는 길. rerp 는 chrome.runtime.sendMessage(서비스워커의 planSync·planExport·planBind), WORKSPACE 는 rerp/plussync.js 의 send 를 끼운다 */
api.send = (msg) => chrome.runtime.sendMessage(msg);

const itemKey = (x) => `${(x && (x.resCd || x.res)) || ''}|${(x && (x.exp || x.item)) || ''}`;
const keyName = (k) => { const s = String(k || ''); const i = s.indexOf('|'); return (i >= 0 ? s.slice(i + 1) : s) || '-'; };
const listOf = (plans, prjNo, key) => (((plans || {})[prjNo] || {})[key]) || [];

/* 월간 구독: 첫 결제일(YYYY-MM-DD)의 "일"로 매월 결제. 오늘(0시, 당일 포함) 이후부터 올해 12월까지 남은 결제일 목록.
 * 31일처럼 짧은 달에 없는 날은 그 달 말일. 첫 결제일이 내년이면 0회, 지난해면 올해 1월부터 */
function subRemaining(dateStr) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(dateStr || '').trim());
  if (!m) return { qty: 0, dates: [], day: 0 };
  const sy = +m[1], sm = +m[2], sd = +m[3];
  const t = api._now(), ty = t.getFullYear();
  const t0 = new Date(ty, t.getMonth(), t.getDate()).getTime();
  const dates = [];
  if (sy <= ty) for (let mo = (sy === ty ? sm : 1); mo <= 12; mo++) {
    const d = new Date(ty, mo - 1, Math.min(sd, new Date(ty, mo, 0).getDate()));
    if (d.getTime() >= t0) dates.push(d);
  }
  return { qty: dates.length, dates, day: sd };
}
const isSub = (e) => !!(e && e.sub && e.sub.date);
/* 표시·합계에 쓰는 실제 수량/금액 (구독은 남은 횟수 × 단가) */
const qtyOf = (e) => isSub(e) ? subRemaining(e.sub.date).qty : (F.num(e && e.qty) || 1);
const amtOf = (e) => isSub(e) ? Math.round(qtyOf(e) * F.num(e.unit)) : F.num(e && e.amt);
const sumOf = (list) => (list || []).reduce((s, e) => s + (amtOf(e) || 0), 0);
/* 과제 전체 합계 { sum, count } (표에 없는 비목의 항목 포함) */
function projectTotal(plans, prjNo) {
  const byKey = (plans || {})[prjNo] || {};
  let sum = 0, count = 0;
  for (const list of Object.values(byKey)) { sum += sumOf(list); count += list.length; }
  return { sum, count };
}
function find(plans, prjNo, key, id) { return listOf(plans, prjNo, key).find((e) => e.id === id) || null; }
function upsert(plans, prjNo, key, entry) {
  if (!plans[prjNo]) plans[prjNo] = {};
  if (!plans[prjNo][key]) plans[prjNo][key] = [];
  const list = plans[prjNo][key];
  const i = list.findIndex((e) => e.id === entry.id);
  if (i >= 0) list[i] = entry; else list.push(entry);
}
function remove(plans, prjNo, key, id) {
  const byKey = plans[prjNo]; if (!byKey || !byKey[key]) return;
  byKey[key] = byKey[key].filter((e) => e.id !== id);
  if (!byKey[key].length) delete byKey[key];
  if (!Object.keys(byKey).length) delete plans[prjNo];
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const isoToday = () => { const t = api._now(); return `${t.getFullYear()}-${F.pad2(t.getMonth() + 1)}-${F.pad2(t.getDate())}`; };

async function load() {
  try {
    const r = await chrome.storage.local.get([KEY, HKEY, TKEY, DKEY, SKEY, PKEY, 'rndUser']);
    if (r[HKEY] !== undefined) { try { chrome.storage.local.remove(HKEY); } catch (e) {} }   // 이전 버전의 감춤 목록 정리
    savedAtCache = F.num(r[TKEY]) || 0;
    deletedCache = r[DKEY] || {};
    syncCache = r[SKEY] || null;
    pagesCache = r[PKEY] || {};
    whoCache = String((r.rndUser && r.rndUser.userNm) || '');
    return r[KEY] || {};
  } catch (e) { return {}; }
}
/* 90일 지난 묘비는 버림 (lib/plan-sync.js 도 같은 규칙). 값은 { ts, prj } 또는 이전 형식 숫자 */
function gcTomb(d) {
  const out = {}; const t0 = Date.now() - TOMB_TTL;
  for (const [id, v] of Object.entries(d || {})) { const ts = (v && typeof v === 'object') ? F.num(v.ts) : F.num(v); if (ts > t0) out[id] = (v && typeof v === 'object') ? { ts, prj: String(v.prj || '') } : ts; }
  return out;
}
/* 저장. prjNo 를 주면 저장소를 다시 읽어 그 과제 몫만 바꾼다 — eClass 탭·팝업·백그라운드 동기화가 같은 키를 쓰므로 어느 한쪽의 오래된 메모리로 다른 과제를 덮어쓰지 않게 (2026-09-27 시험 중 다른 과제 항목이 사라진 일이 있어 방어) */
async function save(plans, deleted, prjNo) {
  const patch = { [TKEY]: Date.now() };
  if (deleted) patch[DKEY] = gcTomb(deleted);
  if (prjNo) {
    const cur = Object.assign({}, ((await chrome.storage.local.get(KEY))[KEY]) || {});
    if (plans && plans[prjNo] && Object.keys(plans[prjNo]).length) cur[prjNo] = plans[prjNo]; else delete cur[prjNo];
    patch[KEY] = cur;
  } else patch[KEY] = plans;
  await chrome.storage.local.set(patch);
}
/* 백그라운드에 동기화 요청 (확장 Plus 가 꺼져 있으면 백그라운드가 무시). edit 는 4초 모아서, 나머지는 바로. prjNo 를 주면 그 과제만 (view: 눈 아이콘으로 펼칠 때) */
api.requestSync = (reason, prjNo) => {
  try { const r = api.send(Object.assign({ type: reason === 'edit' ? 'planSyncQueue' : 'planSync', reason }, prjNo ? { prjNo } : {})); if (r && r.catch) r.catch(() => {}); } catch (e) {}
};
/* 이 과제 원노트 페이지 { pageId, webUrl, title } (페이지 캐시 → 마지막 동기화 결과 순) · 웹 링크만 (render.js 의 열기(↗) 링크) */
api.pageOf = (state, prjNo) => {
  const a = state.planPages && state.planPages[prjNo];
  const b = state.planSync && state.planSync.pages && state.planSync.pages[prjNo];
  const p = (a && a.pageId && a) || (b && b.pageId && b) || null;
  return p ? { pageId: p.pageId, webUrl: p.webUrl || '', title: p.title || '' } : null;
};
api.linkOf = (state, prjNo) => { const p = api.pageOf(state, prjNo); return p ? p.webUrl : ''; };
/* 클립보드 복사 (사용자 클릭 안에서 불러야 함): navigator.clipboard → 안 되면 숨은 textarea + execCommand */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return !!ok;
  } catch (e) { return false; }
}

/* 패널(host)에 위임 리스너를 붙인다. draw() 는 렌더러 호출. state.plans 는 미리 load() 로 채워 둔다.
 * data-act: plan-open(＋ 버튼, data-prj/data-key) · plan-edit/plan-del(data-id) · plan-save · plan-cancel
 *           plan-qty(항목 줄의 수량 −/＋, data-id/data-d) · plan-step(폼의 수량 −/＋, data-d) · plan-sub(폼의 월간 구독 켜기/끄기)
 *           plan-hide(표 머리글 눈 아이콘: 과제 단위 보이기/감추기, data-prj. 기본은 감춤이고 보이기는 이 화면에서만) · plan-persist(저장 아이콘: 지금 저장, 저장됨 표시)
 * 입력칸 data-plan: name(세목) / qty(수량) / unit(단가) / amt(금액) / date(구독 첫 결제일). 수량·단가를 적으면 금액을, 금액을 적으면 단가를 맞춰 준다.
 * 구독이면 수량은 결제일에서 자동 계산되고 [data-plan-out="subqty"] 에 남은 횟수를 표시 */
function bind(host, state, draw) {
  if (!state.plans) state.plans = {};
  if (!state.planShown) state.planShown = new Set();   // 눈 아이콘으로 펼쳐 둔 과제 (이 화면에서만)
  if (!state.planSavedAt) state.planSavedAt = savedAtCache;
  if (!state.planDeleted) state.planDeleted = deletedCache;
  if (state.planSync === undefined) state.planSync = syncCache;
  if (!state.planPages) state.planPages = pagesCache;
  if (!state.planWho) state.planWho = whoCache;
  let savedTimer = 0;
  const input = (f) => host.querySelector(`[data-plan="${f}"]`);
  const focus = (f) => { const el = input(f); if (el) { el.focus(); try { el.select(); } catch (e) {} } };
  const swallow = (r) => { if (r && r.catch) r.catch(() => {}); };
  const persist = (prjNo) => { try { const r = save(state.plans, state.planDeleted, prjNo); if (r && r.then) r.then(() => { state.planSavedAt = Date.now(); api.requestSync('edit'); }); swallow(r); } catch (e) {} };
  /* 아이콘 옆 상태 글("저장됨" · "동기화 중…" · "원노트 링크 복사됨" · 실패 이유). busy 면 지우지 않고, 아니면 ms 뒤에 지움 */
  const show = (prjNo, text, error, busy, ms) => {
    state.planSaved = { prjNo, text, error: !!error, busy: !!busy }; if (!error) state.planSavedAt = Date.now(); draw();
    clearTimeout(savedTimer); if (!busy) savedTimer = setTimeout(() => { state.planSaved = null; draw(); }, ms || 3000);
  };
  const plusOn = () => !!(state.data && state.data.settings && state.data.settings.planSync);
  const OFF_MSG = '원노트 동기화(Plus)가 꺼져 있습니다 · 툴바 팝업 아래 줄에서 켜세요';
  const clip = (pg) => `${pg.webUrl}\n[예상 비용 페이지 ID] ${pg.pageId}`;   // 내보내기가 복사하는 글: 링크 + ID (가져오기는 둘 중 아무거나 있으면 됨)
  /* 내보내기(⬆)인데 페이지를 아직 모를 때: 백그라운드가 이 과제만 동기화해 페이지를 만들고(책임자) 링크+ID 를 클립보드에 복사한다(오프스크린 문서 — 몇 초 걸려도 됨) */
  async function prepareExport(prjNo) {
    try { await save(state.plans, state.planDeleted, prjNo); } catch (e) { show(prjNo, '저장 실패', true); return; }
    show(prjNo, '원노트 페이지를 만들고 링크를 복사하는 중…', false, true);
    let r = null;
    try { r = await api.send({ type: 'planExport', prjNo }); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    const pg = r && r.pages ? r.pages[prjNo] : null;
    if (!r || r.skipped) show(prjNo, `동기화 꺼짐: ${((r && r.missing) || []).join(' · ') || '설정을 확인하세요'}`, true, false, 6000);
    else if (pg && pg.error) show(prjNo, `실패: ${pg.error}`, true, false, 8000);
    else if (pg && pg.noPage) show(prjNo, r.sectionWarn ? 'RERP 섹션이 없음 · 툴바 팝업 아래 줄에서 노트북을 고르세요' : '페이지 없음 · 과제 책임자가 만들어야 합니다', true, false, 8000);
    else if (r.ok && pg && pg.webUrl) show(prjNo, r.copied ? `${pg.created ? '페이지 만들고 ' : ''}원노트 링크 복사됨 · 동료에게 붙여 넣어 주세요` : `${pg.created ? '페이지 만듦' : '페이지 준비됨'} · 다시 누르면 링크 복사`, false, false, 6000);
    else if (r.ok) show(prjNo, '내보낼 항목이 없음', false, false, 4000);
    else show(prjNo, `실패: ${r.error || '응답 없음'}`, true, false, 8000);
  }
  /* 가져오기(⬇) 칸의 링크 적용: 이 과제를 그 페이지에 연결하고 항목을 가져온다 */
  async function applyImport(prjNo) {
    const d = state.planImport; if (!d || d.prjNo !== prjNo) return;
    const text = String(d.value || '').trim();
    if (!text) { d.error = '동료가 내보내기로 복사해 준 원노트 페이지 링크를 붙여 넣으세요'; draw(); const el = host.querySelector('[data-plan-import]'); if (el) el.focus(); return; }
    state.planImport = null;
    show(prjNo, '페이지를 찾아 가져오는 중…', false, true);
    let r = null;
    try { r = await api.send({ type: 'planBind', prjNo, text }); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    const pg = r && r.pages ? r.pages[prjNo] : null;
    if (!r || r.skipped) show(prjNo, `동기화 꺼짐: ${((r && r.missing) || []).join(' · ') || '설정을 확인하세요'}`, true, false, 6000);
    else if (pg && pg.error) show(prjNo, `가져오기 실패: ${pg.error}`, true, false, 8000);
    else if (r.ok) show(prjNo, pg && pg.pulled ? `가져옴 · 항목 ${F.money(pg.count)}건 반영` : `페이지 연결됨 · 항목 ${F.money(pg ? pg.count : 0)}건 (내 목록과 같음)`, false, false, 5000);
    else show(prjNo, `가져오기 실패: ${r.error || r.message || '응답 없음'}`, true, false, 8000);
  }
  const stamp = (e) => { e.ts = Date.now(); if (state.planWho) e.by = state.planWho; return e; };   // 마지막 수정 시각·작성자 (동기화 병합 기준)
  const close = () => { state.planEdit = null; state.planDraft = null; state.planError = ''; };
  const setVal = (f, v) => { const el = input(f); if (el) el.value = v; };

  /* 폼 값 연동: 수량/단가가 바뀌면 금액, 금액이 바뀌면 단가. 구독이면 수량은 결제일에서 계산 */
  function recalc(d, f) {
    if (d.sub) {
      d.qty = String(subRemaining(d.date).qty);
      const out = host.querySelector('[data-plan-out="subqty"]'); if (out) out.textContent = d.qty;
      if (f === 'date') f = 'qty';
    }
    const qty = F.num(d.qty);
    if (f === 'qty' || f === 'unit') {
      const u = F.num(d.unit);
      if (u) { d.amt = F.money(Math.round(qty * u)); setVal('amt', d.amt); }
    } else if (f === 'amt') {
      const a = F.num(d.amt);
      if (a && qty > 0) { d.unit = F.money(Math.round(a / qty)); setVal('unit', d.unit); }
    }
  }
  function submit() {
    const pe = state.planEdit; if (!pe) return;
    const d = state.planDraft || EMPTY();
    const name = String(d.name || '').trim();
    if (!name) { state.planError = '세목을 입력하세요'; draw(); focus('name'); return; }
    const entry = stamp({ id: pe.id || newId(), name });
    if (d.sub) {   // 월간 구독: 결제일 + 단가(월 결제액). 남은 횟수가 0이어도 저장은 된다 (금액 0)
      const r = subRemaining(d.date);
      if (!r.day) { state.planError = '결제일을 고르세요'; draw(); focus('date'); return; }
      let unit = F.num(d.unit), amt = F.num(d.amt);
      if (!unit && amt && r.qty > 0) unit = Math.round(amt / r.qty);
      if (!(unit > 0)) { state.planError = '월 결제액(단가)을 입력하세요'; draw(); focus('unit'); return; }
      Object.assign(entry, { qty: r.qty, unit, amt: Math.round(r.qty * unit), sub: { date: String(d.date).trim() } });
    } else {
      let qty = F.num(d.qty); if (!(qty > 0)) qty = 1;
      let unit = F.num(d.unit), amt = F.num(d.amt);
      if (!amt && unit) amt = Math.round(qty * unit);
      if (!unit && amt) unit = Math.round(amt / qty);
      if (!(amt > 0)) { state.planError = '단가 또는 금액을 입력하세요'; draw(); focus(unit ? 'amt' : 'unit'); return; }
      Object.assign(entry, { qty, unit, amt });
    }
    upsert(state.plans, pe.prjNo, pe.key, entry);
    close(); persist(pe.prjNo); draw();
  }

  host.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act^="plan-"]'); if (!btn) return;
    ev.preventDefault();
    const act = btn.dataset.act, prjNo = btn.dataset.prj, key = btn.dataset.key, id = btn.dataset.id;
    if (act === 'plan-open') {
      state.planEdit = { prjNo, key, id: null }; state.planDraft = EMPTY(); state.planError = '';
      state.expanded.add(prjNo);
      state.planShown.add(prjNo);   // 새 항목이 바로 보이도록 펼침 (기본은 감춤)
      draw(); focus('name');
    } else if (act === 'plan-edit') {
      const e = find(state.plans, prjNo, key, id); if (!e) return;
      state.planEdit = { prjNo, key, id };
      state.planDraft = { name: e.name || '', qty: String(qtyOf(e)), unit: e.unit ? F.money(e.unit) : '', amt: amtOf(e) ? F.money(amtOf(e)) : '', sub: isSub(e), date: isSub(e) ? e.sub.date : '' };
      state.planError = ''; draw(); focus('name');
    } else if (act === 'plan-cancel') { close(); draw(); }
    else if (act === 'plan-save') { submit(); }
    else if (act === 'plan-del') {
      remove(state.plans, prjNo, key, id);
      state.planDeleted[id] = { ts: Date.now(), prj: prjNo };   // 묘비: 동기화 때 다른 사람 쪽에서도 지워지게 (과제별 페이지에 실림)
      if (state.planEdit && state.planEdit.id === id) close();
      persist(prjNo); draw();
    } else if (act === 'plan-qty') {   // 항목 줄의 수량 −/＋: 수량 1 이상, 금액 = 수량 × 단가 (구독은 자동 계산이라 버튼이 없음)
      const e = find(state.plans, prjNo, key, id); if (!e || isSub(e)) return;
      const qty = Math.max(1, (F.num(e.qty) || 1) + (F.num(btn.dataset.d) || 0));
      if (qty === e.qty) return;
      const unit = F.num(e.unit) || (F.num(e.amt) && e.qty ? Math.round(F.num(e.amt) / e.qty) : 0);
      e.qty = qty; if (unit) { e.unit = unit; e.amt = Math.round(qty * unit); }
      stamp(e);
      persist(prjNo); draw();
    } else if (act === 'plan-step') {   // 폼의 수량 −/＋
      const d = state.planDraft || (state.planDraft = EMPTY());
      if (d.sub) return;
      d.qty = String(Math.max(1, (F.num(d.qty) || 0) + (F.num(btn.dataset.d) || 0)));
      setVal('qty', d.qty); recalc(d, 'qty');
    } else if (act === 'plan-sub') {   // 폼의 월간 구독 켜기/끄기. 켜면 결제일 기본값은 오늘
      const d = state.planDraft || (state.planDraft = EMPTY());
      d.sub = !d.sub;
      if (d.sub) { if (!d.date) d.date = isoToday(); recalc(d, 'date'); }
      else if (!(F.num(d.qty) > 0)) d.qty = '1';
      state.planError = ''; draw(); focus(d.sub ? 'date' : 'unit');
    } else if (act === 'plan-hide') {   // 과제 단위 보이기/감추기 (저장하지 않음). 감출 때 열린 폼은 닫는다. 펼칠 때 Plus 가 켜져 있으면 그 과제를 원노트와 바로 맞춘다(view)
      if (state.planShown.has(prjNo)) { state.planShown.delete(prjNo); if (state.planEdit && state.planEdit.prjNo === prjNo) close(); }
      else { state.planShown.add(prjNo); if (plusOn()) api.requestSync('view', prjNo); }
      draw();
    } else if (act === 'plan-persist') {   // 저장 아이콘: 지금 저장하고 "저장됨". Plus 가 켜져 있으면 저장 직후 그 과제를 원노트와 바로 맞추고 결과를 덧붙인다
      (async () => {
        try { await save(state.plans, state.planDeleted, prjNo); } catch (e) { show(prjNo, '저장 실패', true); return; }
        if (!plusOn()) { show(prjNo, '저장됨'); return; }
        show(prjNo, '저장됨 · 원노트와 맞추는 중…', false, true);
        let r = null;
        try { r = await api.send({ type: 'planSync', reason: 'manual', prjNo }); } catch (e) { r = null; }
        const pg = r && r.pages ? r.pages[prjNo] : null;
        if (!r || r.skipped) show(prjNo, '저장됨');
        else if (pg && pg.error) show(prjNo, `저장됨 · 원노트 실패: ${pg.error}`, true, false, 8000);
        else if (pg && pg.noPage) show(prjNo, '저장됨 · 원노트 페이지 없음 (책임자가 만들어야 함)', false, false, 5000);
        else if (r.ok) show(prjNo, pg && pg.pulled ? '저장됨 · 원노트 항목 반영' : pg && pg.pushed ? '저장됨 · 원노트에 씀' : '저장됨 · 원노트와 같음', false, false, 4000);
        else show(prjNo, `저장됨 · 원노트 실패: ${r.error || '응답 없음'}`, true, false, 8000);
      })();
    } else if (act === 'plan-export') {   // 원노트로 내보내기: 이 과제 페이지의 링크+ID 를 클립보드에 복사 (페이지가 없으면 먼저 만듦)
      if (!plusOn()) { show(prjNo, OFF_MSG, true, false, 6000); return; }
      const pg = api.pageOf(state, prjNo);
      if (pg && pg.webUrl) { (async () => { const ok = await copyText(clip(pg)); show(prjNo, ok ? '원노트 링크 복사됨 · 동료에게 붙여 넣어 주세요' : '링크 복사 실패 (클립보드 권한)', !ok, false, 5000); })(); api.requestSync('edit'); }
      else prepareExport(prjNo);
    } else if (act === 'plan-import') {   // 원노트에서 가져오기: 동료가 보낸 링크를 붙여 넣는 칸 열기/닫기
      if (!plusOn()) { show(prjNo, OFF_MSG, true, false, 6000); return; }
      state.planImport = state.planImport && state.planImport.prjNo === prjNo ? null : { prjNo, value: '', error: '' };
      draw();
      if (state.planImport) { const el = host.querySelector('[data-plan-import]'); if (el) el.focus(); }
    } else if (act === 'plan-import-apply') { applyImport(prjNo); }
    else if (act === 'plan-import-cancel') { state.planImport = null; draw(); }
  });
  host.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el && el.dataset && el.dataset.planImport !== undefined) { if (state.planImport) { state.planImport.value = el.value; state.planImport.error = ''; } return; }   // 가져오기 링크 칸
    const f = el && el.dataset ? el.dataset.plan : null; if (!f) return;
    const d = state.planDraft || (state.planDraft = EMPTY());
    d[f] = el.value; recalc(d, f);
  });
  host.addEventListener('keydown', (ev) => {
    const el = ev.target;
    if (el && el.dataset && el.dataset.planImport !== undefined) {   // 가져오기 링크 칸: Enter 적용 · Esc 닫기
      if (ev.key === 'Enter') { ev.preventDefault(); applyImport(state.planImport && state.planImport.prjNo); }
      else if (ev.key === 'Escape') { ev.preventDefault(); state.planImport = null; draw(); }
      return;
    }
    if (!el || !el.dataset || !el.dataset.plan) return;
    if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); close(); draw(); }
    else if (el.dataset.plan === 'qty' && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {   // 수량 칸에서 ↑/↓ 로 증감
      ev.preventDefault();
      const d = state.planDraft || (state.planDraft = EMPTY());
      d.qty = String(Math.max(1, (F.num(d.qty) || 0) + (ev.key === 'ArrowUp' ? 1 : -1)));
      el.value = d.qty; recalc(d, 'qty');
    }
  });
  // 단가·금액 칸은 포커스를 벗어나면 천 단위 구분 기호로 정리
  host.addEventListener('focusout', (ev) => {
    const el = ev.target; const f = el && el.dataset ? el.dataset.plan : null;
    if (f !== 'unit' && f !== 'amt') return;
    const v = F.num(el.value); el.value = v ? F.money(v) : '';
    if (state.planDraft) state.planDraft[f] = el.value;
  });
  // 다른 창(팝업 ↔ eClass)이나 백그라운드 동기화가 바꾼 값 반영
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      try {
        if (area !== 'local') return;
        if (ch[TKEY]) state.planSavedAt = F.num(ch[TKEY].newValue) || state.planSavedAt;
        if (ch[DKEY]) state.planDeleted = ch[DKEY].newValue || {};
        if (ch[SKEY]) { state.planSync = ch[SKEY].newValue || null; if (!ch[KEY]) draw(); }
        if (ch[PKEY]) { state.planPages = ch[PKEY].newValue || {}; if (!ch[KEY] && !ch[SKEY]) draw(); }
        if (ch[KEY]) { state.plans = ch[KEY].newValue || {}; draw(); }
      } catch (e) {}
    });
  } catch (e) {}
  api.requestSync('load');   // 확장 Plus: 패널을 열 때 원노트 페이지와 한 번 맞춤 (꺼져 있으면 백그라운드가 무시)
}

Object.assign(api, { KEY, DKEY, SKEY, PKEY, itemKey, keyName, listOf, sumOf, projectTotal, find, load, save, gcTomb, bind, subRemaining, isSub, qtyOf, amtOf });
export default api;
