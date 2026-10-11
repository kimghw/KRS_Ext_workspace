// kr_ext_rerp `lib/render.js` 의 과제집행비율 표 부분(0.8.3, 880a6bc)을 그대로 옮긴 것 — rateCell·pct·rateOf·아이콘·isProjectLead·planBtn·planRow·planForm·budgetTable 과
// 그 표가 쓰는 projectLink(deepLink). render.js 의 다른 부분(패널 틀·카드미청구·참여율·급여)은 옮기지 않았다. 몸통은 원본과 같고 머리의 import 와 꼬리의 export 만 다르다.
// `g.KRX_FMT`·`g.KRX_PLAN` 은 아래 shim `g` 로 그대로 읽는다. 출처·갱신 규칙은 rerp/README.md.
import FMT from './fmt.js';
import PLAN from './plan.js';
const g = { KRX_FMT: FMT, KRX_PLAN: PLAN };
const F = g.KRX_FMT;
const RND_MAIN = 'https://rnd.krs.co.kr/rderp_layoutMain.act';
/* R&D ERP 메인에 화면 열기 요청을 실어 보내는 깊은 링크 — rerp 의 content/rnd-hook.js 가 #krext= 를 읽어 그 화면을 연다. WORKSPACE 에는 그 훅이 없어 메인 화면만 열린다 */
function deepLink(req) { return RND_MAIN + '#krext=' + encodeURIComponent(JSON.stringify(req)); }
function projectLink(prjNo, tabId) {
  return deepLink({ open: 'rtask_0008_t00_01.act', title: '과제정보', menuId: 'menu_id_80', q: 'PRJ_NO=' + encodeURIComponent(prjNo || '') + '&TAB_ID=' + (tabId || '01') });
}

/* ---------- 과제집행비율 보기 (과제정보 › 자금현황 › 비목별 잔액 + 이 과제 카드 미청구액 + 승인 전 신청금액) ---------- */
const pct = (v) => (v == null || Number.isNaN(v)) ? '-' : `${(Math.trunc((Number(v) || 0) * 10) / 10).toFixed(1)}%`;
/* 집행비율 셀: 막대 + 숫자. 100% 이상이면 막대·숫자 빨강 */
function rateCell(rate, title) {
  if (rate == null || Number.isNaN(rate)) return `<span class="krext-rate krext-dim">-</span>`;
  const r = Number(rate) || 0;
  const cls = r >= 100 ? ' krext-bar-over' : '';   // 90% 주의색(주황) 없이 파랑, 100% 초과만 빨강
  return `<span class="krext-rate" title="${F.esc(title || '')}"><span class="krext-bar"><span class="krext-bar-fill${cls}" style="width:${Math.max(0, Math.min(100, r))}%"></span></span><span class="krext-rate-v${r >= 100 ? ' krext-red' : ''}">${pct(r)}</span></span>`;
}

/* 집행비율 계산 (rnd-api execRate 와 동일: 둘 다 양수일 때만, 소수 2자리 절사) */
const rateOf = (v, bgt) => (bgt > 0 && v > 0) ? Math.trunc(v / bgt * 10000) / 100 : 0;

/* ----- 예상 비용 (lib/plan.js 의 storage.local.plannedExpenses): 비목 행의 ＋ 버튼으로 세목·수량·단가를 적어 두면 잔액·집행비율에 반영한 예상값을 함께 표시.
 * 표에서는 기본으로 감춰져 있고(＋·항목 줄·예상 반영 행이 빠지고 과제 행의 예상 잔액만 남음) 머리글 "비목" 옆 눈 아이콘을 누른 동안만 보인다(state.planShown, 저장 안 함).
 * 항목은 바꿀 때마다 자동 저장되며 저장 아이콘은 지금 저장 + "저장됨" 표시 ----- */
const svgIcon = (d) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_EYE = svgIcon('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>');
const ICON_EYE_OFF = svgIcon('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>');
const ICON_REPEAT = svgIcon('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>');
const ICON_SAVE = svgIcon('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>');
const ICON_IMPORT = svgIcon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>');   // 확장 Plus: 원노트에서 가져오기 (비목 머리글, 저장 아이콘 옆)
const ICON_EXPORT = svgIcon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>');   // 확장 Plus: 원노트로 내보내기
/* 내가 이 과제의 책임자인지 — 참여율 표의 "책" 태그와 같은 규칙: 참여인력 역할에 "책임"이 있거나 과제책임자 이름이 본인(참여인력 행 이름 · 설정/자동 감지 이름). d = state.data */
function isProjectLead(d, prjNo, rspr) {
  if (!d) return false;
  const myNames = (d.myNames || []).map((n) => String(n || '').trim()).filter(Boolean);
  const x = ((d.participation && d.participation.items) || []).find((i) => i && i.prjNo === prjNo);
  if (x && (/책임/.test(String(x.role || '')) || (!!x.rspr && (String(x.rspr).trim() === String(x.empNm || '').trim() || myNames.includes(String(x.rspr).trim()))))) return true;
  return !!rspr && myNames.includes(String(rspr).trim());
}
const ICON_EXT = svgIcon('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>');
const planBtn = (prjNo, key) => `<button type="button" class="krext-plus-btn" data-act="plan-open" data-prj="${F.esc(prjNo)}" data-key="${F.esc(key)}" title="예상 비용 추가 (세목 · 수량 · 단가)">＋</button>`;
/* 예상 비용 한 줄: 세목 · [−] 수량 [＋] × 단가 · −금액 · 예산 대비 비율. bgt 가 없으면(표에 없는 비목) 비율 생략.
 * 월간 구독(e.sub)은 수량이 "올해 남은 결제 횟수"로 자동 계산되므로 −/＋ 대신 "월간 N일" 표시 (툴팁에 남은 결제일 목록) */
function planRow(prjNo, key, e, bgt) {
  const P = g.KRX_PLAN;
  const sub = P.isSub(e), qty = P.qtyOf(e), amt = P.amtOf(e), unit = F.num(e.unit);
  const ref = `data-prj="${F.esc(prjNo)}" data-key="${F.esc(key)}" data-id="${F.esc(e.id)}"`;
  const acts = `<span class="krext-plan-acts"><button type="button" data-act="plan-edit" ${ref} title="수정">✎</button><button type="button" data-act="plan-del" ${ref} title="삭제">×</button></span>`;
  let tip, qtyBox;
  if (sub) {
    const r = P.subRemaining(e.sub.date);
    const list = r.dates.map((d) => `${F.pad2(d.getMonth() + 1)}-${F.pad2(d.getDate())}`).join(', ');
    tip = `월간 구독: ${e.name} · 매월 ${r.day}일 결제 (첫 결제일 ${e.sub.date}) · 올해 남은 결제 ${F.money(qty)}회${list ? ` (${list})` : ''} × 월 ${F.money(unit)}원 = ${F.money(amt)}원 · 날짜가 지나면 횟수가 자동으로 줄어듭니다`;
    qtyBox = `<span class="krext-tag krext-tag-sub" title="매월 ${r.day}일 결제 (${e.sub.date}부터)">월간 ${r.day}일</span> <span class="krext-plan-qty-v" title="올해 남은 결제 횟수 (오늘 포함, 날짜가 지나면 줄어듦)">${F.money(qty)}</span>`;
  } else {
    tip = `예상 비용: ${e.name} · 수량 ${F.money(qty)} × 단가 ${F.money(unit)} = ${F.money(amt)}원${e.ts ? ` · ${F.fmtClock(e.ts)} 입력` : ''} · R&D ERP 에는 없고 이 브라우저에만 저장된 값`;
    qtyBox = `<span class="krext-plan-qty"><button type="button" data-act="plan-qty" data-d="-1" ${ref} title="수량 −1">−</button><span class="krext-plan-qty-v" title="수량">${F.money(qty)}</span><button type="button" data-act="plan-qty" data-d="1" ${ref} title="수량 +1">＋</button></span>`;
  }
  return `<tr class="krext-bgt-plan${sub ? ' krext-bgt-sub' : ''}" title="${F.esc(tip)}"><td class="krext-bgt-nm"><span class="krext-plan-ind">↳</span> <span class="krext-plan-nm">${F.esc(e.name)}</span> ${qtyBox}<span class="krext-dim"> × ${F.money(unit)}</span>${acts}</td><td class="krext-num krext-dim">-</td><td class="krext-num">−${F.money(amt)}</td><td class="krext-num">${bgt > 0 && amt > 0 ? `<span class="krext-rate-plus krext-plan-rate">+${pct(amt / bgt * 100)}</span>` : '<span class="krext-dim">-</span>'}</td></tr>`;
}
/* 예상 비용 입력 폼 (한 번에 하나만 열림: state.planEdit). 값은 state.planDraft 에 있어 다시 그려도 입력이 유지된다.
 * "월간" 토글을 켜면 수량 −/＋ 대신 결제일(date) 입력과 남은 횟수가 나온다 */
function planForm(state, names) {
  const pe = state.planEdit, d = state.planDraft || { name: '', qty: '1', unit: '', amt: '', sub: false, date: '' };
  const opts = (names || []).map((n) => `<option value="${F.esc(n)}">`).join('');
  const subQty = d.sub ? g.KRX_PLAN.subRemaining(d.date).qty : 0;
  const qtyBox = d.sub
    ? `<span class="krext-plan-lbl">결제일</span><input type="date" data-plan="date" value="${F.esc(d.date)}" title="첫 결제일. 매월 같은 날 결제로 보고 오늘부터 올해 12월까지 남은 횟수를 수량으로 셉니다"><span class="krext-plan-lbl" title="올해 남은 결제 횟수 (오늘 포함)">남은 <b data-plan-out="subqty">${F.money(subQty)}</b>회</span>`
    : `<span class="krext-plan-lbl">수량</span><span class="krext-plan-step"><button type="button" data-act="plan-step" data-d="-1" title="수량 −1">−</button><input type="text" inputmode="decimal" data-plan="qty" value="${F.esc(d.qty)}" title="수량 (기본 1, ↑/↓ 키로도 증감)"><button type="button" data-act="plan-step" data-d="1" title="수량 +1">＋</button></span>`;
  return `<tr class="krext-bgt-form"><td colspan="4"><div class="krext-plan-form">
    <span class="krext-plan-ind">↳</span>
    <input type="text" data-plan="name" list="krext-plan-names" placeholder="세목 (예: 회의비, 소프트웨어 활용비)" value="${F.esc(d.name)}" maxlength="60" autocomplete="off" title="세목 (청구서 세목 빠른 선택 목록과 이전에 적은 세목이 자동완성에 나옵니다)">
    <button type="button" class="krext-plan-subtn${d.sub ? ' krext-on' : ''}" data-act="plan-sub" title="월간 구독: 결제일을 고르면 오늘부터 올해 12월까지 남은 결제 횟수가 수량이 되고, 날짜가 지나면 자동으로 줄어듭니다 (단가 = 월 결제액)">${ICON_REPEAT}월간</button>
    ${qtyBox}
    <label>${d.sub ? '월 결제액' : '단가'} <input type="text" inputmode="numeric" data-plan="unit" value="${F.esc(d.unit)}" placeholder="0" title="${d.sub ? '월 결제액 (원). 남은 횟수 × 월 결제액 = 금액' : '단가 (원). 수량 × 단가 = 금액'}"></label>
    <label>금액 <input type="text" inputmode="numeric" data-plan="amt" value="${F.esc(d.amt)}" placeholder="0" title="예상 금액 (원). 직접 적으면 단가를 수량으로 나눠 맞춥니다"></label>
    <button type="button" class="krext-plan-btn krext-plan-save" data-act="plan-save">${pe && pe.id ? '저장' : '추가'}</button>
    <button type="button" class="krext-plan-btn" data-act="plan-cancel" title="취소 (Esc)">취소</button>
    ${state.planError ? `<span class="krext-err krext-plan-err">${F.esc(state.planError)}</span>` : ''}
  </div><datalist id="krext-plan-names">${opts}</datalist></td></tr>`;
}

function budgetTable(p, s, state) {
  if (p.budgetError) return `<div class="krext-sub krext-err">자금현황 조회 오류: ${F.esc(p.budgetError)}</div>`;
  const b = p.budget;
  if (!b) return `<div class="krext-sub krext-dim">자금현황 정보를 아직 불러오지 못했습니다. ↻ 새로고침 하세요.</div>`;
  const unbilled = b.unbilled || 0, req = b.reqAmt || 0, pending = b.pending || (unbilled + req);   // 미청구 카드 사용액 · 승인 전 신청금액 · 둘의 합
  if (!b.items.length && !pending) return `<div class="krext-sub krext-dim">비목별 예산 정보가 없습니다 (예산 미등록 또는 조회 권한 없음). <a href="${F.esc(projectLink(p.prjNo, '06'))}" target="_blank" rel="noopener">R&amp;D ERP 자금현황에서 확인 →</a></div>`;
  const multiRes = (b.resCount || 0) > 1;
  // 설정에서 제외한 비목(인건비/연구수당/간접비)은 계산은 물론 표에서도 뺀다
  const shown = b.items.filter((x) => !x.excluded);
  if (!shown.length && !pending) return `<div class="krext-sub krext-dim">설정에서 제외한 비목을 빼면 남는 비목이 없습니다. <a href="${F.esc(projectLink(p.prjNo, '06'))}" target="_blank" rel="noopener">R&amp;D ERP 자금현황에서 확인 →</a></div>`;
  // 예상 비용: 이 과제에 열린 입력 폼(pe), 과제 합계(pt), 감춤 여부. 세목 자동완성은 청구서 세목 빠른 선택 표시이름 + 이미 적어 둔 세목
  const P = g.KRX_PLAN, plans = (P && state.plans) || {};
  const pe = P && state.planEdit && state.planEdit.prjNo === p.prjNo ? state.planEdit : null;
  const pt = P ? P.projectTotal(plans, p.prjNo) : { sum: 0, count: 0 };
  // 항목이 있는 과제는 기본으로 감춤(눈 아이콘으로 펼친 과제만 보임). 감춤이면 ＋·항목 줄·예상 반영 행을 모두 빼고 과제 행의 예상 잔액만 남긴다
  const hidden = !!(P && pt.count && !(state.planShown && state.planShown.has(p.prjNo)));
  const savedMark = state.planSaved && state.planSaved.prjNo === p.prjNo ? `<span class="krext-plan-saved${state.planSaved.error ? ' krext-err' : ''}${state.planSaved.busy ? ' krext-busy' : ''}">${F.esc(state.planSaved.text || (state.planSaved.error ? '저장 실패' : '저장됨'))}</span>` : '';
  const saveTip = `예상 비용 ${F.money(pt.count)}건 저장${state.planSavedAt ? ` · 마지막 저장 ${F.fmtClock(state.planSavedAt)}` : ''} (입력·수정·삭제 때마다 자동 저장되어 브라우저를 다시 시작해도 남습니다. 눌러서 지금 저장)`;
  // 확장 Plus: 저장 아이콘 옆에 원노트 가져오기(⬇ plan-import: RERP 섹션의 이 과제 페이지 항목을 내 목록에 반영)·내보내기(⬆ plan-export: 내 항목을 페이지에 씀, 페이지가 없으면 책임자일 때 만듦)·열기(↗ 링크, 우클릭으로 주소 복사) 아이콘.
  // 눈 아이콘으로 예상 비용을 펼친 과제(hidden 아님)에만, 그리고 Plus 가 켜져 있을 때만 보인다 — 꺼져 있으면 원노트 관련 아이콘·동작이 아예 없다 (2026-09-27 사용자). 항목이 없는 과제는 늘 펼쳐진 상태라 보임.
  // 툴팁에 이 과제 페이지의 마지막 동기화 결과(storage.local.planSyncState.pages[과제번호], lib/plan-sync.js). 실패면 빨간색. 동기화 자체는 켜져 있으면 자동(패널 열 때·편집 4초 뒤·자동 갱신)
  const syncOn = !!(s && s.planSync), ps = syncOn ? (state.planSync || null) : null, pg = ps && ps.pages ? ps.pages[p.prjNo] : null;
  const link = syncOn && g.KRX_PLAN && g.KRX_PLAN.linkOf ? g.KRX_PLAN.linkOf(state, p.prjNo) : '';
  const lead = syncOn && isProjectLead(state.data, p.prjNo, p.rspr);
  const syncStatus = !syncOn ? '' : (pg && pg.error ? `${F.fmtClock(pg.at || ps.at)} 동기화 실패: ${pg.error}`
    : pg && pg.noPage ? `${F.fmtClock(pg.at || ps.at)} 확인: 페이지가 아직 없음 — 과제 책임자만 만들 수 있습니다`
    : pg ? `마지막 동기화 ${F.fmtClock(pg.at || ps.at)}${pg.remoteBy && pg.remoteAt ? ` · 페이지 마지막 갱신 ${pg.remoteBy} ${F.fmtClock(pg.remoteAt)}` : ''}`
    : ps && ps.error ? `${F.fmtClock(ps.at)} 동기화 실패: ${ps.error}` : '아직 동기화 전');
  const pageTxt = pg && pg.title ? `페이지 "${pg.title}"` : '이 과제의 페이지는 아직 없음';
  const importTip = `원노트에서 가져오기: 동료(과제 책임자)가 내보내기로 복사해 준 페이지 링크를 붙여 넣으면 이 과제를 그 페이지에 연결하고 항목을 가져옵니다 (항목별로 더 최근 수정이 남고, 삭제도 반영) · ${pageTxt} · ${syncStatus}`;
  const exportTip = `원노트로 내보내기: 이 과제 페이지의 링크(+ID)를 클립보드에 복사해 동료에게 전달합니다${syncOn && !link ? (lead ? ' · 페이지가 아직 없으면 먼저 RERP 섹션에 만듭니다 (내가 책임자)' : ' · 페이지는 과제 책임자만 만들 수 있습니다') : ''} · ${pageTxt} · ${syncStatus}`;
  const importBox = state.planImport && state.planImport.prjNo === p.prjNo ? `<span class="krext-plan-import"><input type="text" data-plan-import value="${F.esc(state.planImport.value || '')}" placeholder="동료가 보낸 원노트 페이지 링크를 붙여 넣고 Enter" spellcheck="false" autocomplete="off"><button type="button" data-act="plan-import-apply" data-prj="${F.esc(p.prjNo)}">적용</button><button type="button" data-act="plan-import-cancel" data-prj="${F.esc(p.prjNo)}" title="닫기">×</button>${state.planImport.error ? `<span class="krext-err">${F.esc(state.planImport.error)}</span>` : ''}</span>` : '';
  const syncErr = syncOn && ((pg && pg.error) || (ps && ps.ok === false && !pg));
  const ref = `data-prj="${F.esc(p.prjNo)}"`;
  const eyeBtn = pt.count ? `<button type="button" class="krext-ico-btn${hidden ? ' krext-ico-off' : ''}" data-act="plan-hide" data-prj="${F.esc(p.prjNo)}" title="${hidden ? F.esc(`예상 비용 보이기 (${F.money(pt.count)}건 · ${F.money(pt.sum)}원 저장되어 있음. 기본은 감춤이며 이 화면에서만 펼쳐집니다)`) : '예상 비용 감추기 (＋ 버튼·항목 줄·예상 반영 행을 숨기고 과제 행의 예상 잔액만 남김)'}">${hidden ? ICON_EYE_OFF : ICON_EYE}</button>` : '';
  const oneBtns = (hidden || !syncOn) ? '' : `<button type="button" class="krext-ico-btn${syncErr ? ' krext-ico-err' : ''}" data-act="plan-import" ${ref} title="${F.esc(importTip)}">${ICON_IMPORT}</button>`
    + `<button type="button" class="krext-ico-btn${syncErr ? ' krext-ico-err' : ''}" data-act="plan-export" ${ref} title="${F.esc(exportTip)}">${ICON_EXPORT}</button>`
    + (link ? `<a class="krext-ico-btn" href="${F.esc(link)}" target="_blank" rel="noopener" title="${F.esc(`원노트에서 열기: ${pageTxt} (우클릭 › 링크 주소 복사로 동료에게 전달)`)}">${ICON_EXT}</a>` : '');
  const icons = P && (pt.count || syncOn) ? `<span class="krext-plan-ico">${eyeBtn}<button type="button" class="krext-ico-btn" data-act="plan-persist" ${ref} title="${F.esc(saveTip)}">${ICON_SAVE}</button>${oneBtns}${savedMark}${importBox}</span>` : '';
  const names = pe ? Array.from(new Set([].concat(
    (s.quickPicks || []).map((q) => String(q).split('=')[0].trim()),
    Object.values(plans).flatMap((byKey) => Object.values(byKey).flatMap((l) => l.map((e) => e.name)))).filter(Boolean))) : [];
  // 비목 밑의 예상 비용 행들 (수정 중인 항목은 폼으로 대체) + 새 항목 폼
  const planRows = (key, list, bgt) => list.map((e) => (pe && pe.key === key && pe.id === e.id) ? planForm(state, names) : planRow(p.prjNo, key, e, bgt)).join('')
    + (pe && pe.key === key && !pe.id ? planForm(state, names) : '');
  const seen = new Set();
  const rows = shown.map((x) => {
    const name = `${multiRes && x.res ? `<span class="krext-dim">${F.esc(x.res)}</span> ` : ''}${F.esc(x.exp || x.item || '-')}`;
    const tags = `${x.dir ? ' <span class="krext-tag krext-tag-grey" title="직접비 비목">직접비</span>' : ''}${x.psnl ? ' <span class="krext-tag krext-tag-grey" title="인건비 비목">인건비</span>' : ''}`;
    const tip = [x.item ? `예산항목 ${x.item}` : '', `예산액(A) ${F.money(x.bgt)}`, x.cary ? `이월 ${F.money(x.cary)}` : '', x.inter ? `이자 ${F.money(x.inter)}` : '',
      `승인액(B) ${F.money(x.appr)}`, x.req ? `신청 ${F.money(x.req)}` : '', x.purch ? `구매요청 ${F.money(x.purch)}` : '', x.adj ? `예산조정 ${F.money(x.adj)}` : '', `예산잔액(A-B) ${F.money(x.bal)}`].filter(Boolean).join(' · ');
    const key = P ? P.itemKey(x) : ''; seen.add(key);
    const list = (P && !hidden) ? P.listOf(plans, p.prjNo, key) : [];
    let html = `<tr title="${F.esc(tip)}"><td class="krext-bgt-nm">${name}${tags}${P && !hidden ? planBtn(p.prjNo, key) : ''}</td><td class="krext-num">${F.money(x.bgt)}</td><td class="krext-num${x.bal < 0 ? ' krext-red' : ''}">${F.money(x.bal)}</td><td class="krext-num">${rateCell(x.rate, `승인액 ${F.money(x.appr)} / 예산액 ${F.money(x.bgt)}`)}</td></tr>`;
    if (list.length) {   // 이 비목의 예상 비용을 뺀 잔액 / 더한 집행비율 — 항목 줄보다 먼저, 비목 행 바로 밑에 둔다 (총액은 합계의 예상 반영 행에 이미 있음. 2026-10-11 사용자)
      const psum = P.sumOf(list);
      const ptip = `예상 비용 ${F.money(list.length)}건 ${F.money(psum)}원 반영: 잔액 ${F.money(x.bal)} − ${F.money(psum)} · 집행비율 (승인액 ${F.money(x.appr)} + 예상 ${F.money(psum)}) / 예산액 ${F.money(x.bgt)}`;
      html += `<tr class="krext-bgt-proj" title="${F.esc(ptip)}"><td class="krext-bgt-nm"><span class="krext-plan-ind">↳</span> 예상 반영 <span class="krext-dim">${F.money(list.length)}건 · ${F.money(psum)}원</span></td><td class="krext-num krext-dim">-</td><td class="krext-num${x.bal - psum < 0 ? ' krext-red' : ''}">${F.money(x.bal - psum)}</td><td class="krext-num">${rateCell(rateOf(x.appr + psum, x.bgt), `(승인액 + 예상) / 예산액`)}</td></tr>`;
    }
    if (P && !hidden) html += planRows(key, list, x.bgt);   // 항목 줄(수정 중이면 폼) + 새 항목 폼은 예상 반영 행 밑에
    return html;
  }).join('');
  // 표에 없는 비목(설정에서 제외했거나 자금현황에서 사라진 비목)에 적어 둔 예상 비용도 보이게 (합계의 예상 반영에는 포함)
  const orphans = (P && !hidden) ? Object.keys(plans[p.prjNo] || {}).filter((k) => !seen.has(k)).map((k) => {
    const list = P.listOf(plans, p.prjNo, k);
    return `<tr class="krext-bgt-orphan" title="현재 표에 없는 비목에 적어 둔 예상 비용 (설정에서 제외했거나 자금현황에서 사라진 비목). 합계의 예상 반영에는 포함됩니다"><td class="krext-bgt-nm">${F.esc(P.keyName(k))} <span class="krext-tag krext-tag-grey">표에 없는 비목</span></td><td class="krext-num krext-dim">-</td><td class="krext-num krext-dim">-</td><td class="krext-num krext-dim">-</td></tr>` + planRows(k, list, 0);
  }).join('') : '';
  // 미청구 · 승인전 행: 아직 승인액에 잡히지 않은 집행 = 이 과제 카드로 사용했지만 청구 전인 금액(공용 거래 제외) + 청구했지만 승인 전인 신청금액(자금현황 REQ_AMT).
  // 미청구액은 비목 배정 전이라 예산잔액 합계에서 여기서 차감하고, 신청금액은 ERP 예산잔액에 이미 빠져 있어 잔액 열에는 미청구액만 보인다. 집행비율에는 둘 다 더한다
  const ubTip = `승인 전 집행 ${F.money(pending)}원 = 미청구 ${F.money(unbilled)} + 승인전 ${F.money(req)}. 미청구: 이 과제 카드의 미청구 거래 ${F.money(b.unbilledCount || 0)}건 (같은 계좌를 쓰는 다른 과제와 공용인 거래 ${F.money(p.unbilledShared || 0)}건 제외) — 청구 전이라 비목이 정해지지 않아 예산잔액 합계에서 차감. 승인전: 청구(신청)했지만 결재가 끝나지 않은 금액 (자금현황 신청금액) — R&D ERP 예산잔액에는 이미 빠져 있어 잔액 열에는 미청구액만 표시. 집행비율에는 둘 다 더합니다.`;
  const ubName = `미청구 · 승인전 <span class="krext-tag" title="과제카드 미청구 사용액 (거래 건수)">과제카드 ${F.money(b.unbilledCount || 0)}건</span>${req > 0 ? ` <span class="krext-tag krext-tag-grey" title="청구(신청)했지만 승인 전인 금액 — 자금현황 신청금액. R&amp;D ERP 예산잔액(위 비목 행)에 이미 빠져 있어 이 행의 잔액 칸에서는 다시 빼지 않고, 집행비율에만 더합니다">승인전 ${F.money(req)}</span>` : ''}`;
  const ubRow = `<tr class="krext-bgt-unbilled" title="${F.esc(ubTip)}"><td class="krext-bgt-nm">${ubName}</td><td class="krext-num krext-dim">-</td><td class="krext-num${unbilled > 0 ? ' krext-red' : ''}" title="미청구액만 차감 (승인전 신청금액은 위 비목 잔액에 이미 반영)">${unbilled ? '−' + F.money(Math.abs(unbilled)) : '0'}</td><td class="krext-num">${pending > 0 ? `<span class="krext-rate-plus" title="(미청구 ${F.money(unbilled)} + 승인전 ${F.money(req)}) / 예산액 ${F.money(b.bgtAmt)}">+${pct(b.pendingRate)}</span>` : '<span class="krext-dim">-</span>'}</td></tr>`;
  let foot = `<tr class="krext-bgt-total"><td>합계 <span class="krext-dim">(미청구 · 승인전 반영)</span></td><td class="krext-num">${F.money(b.bgtAmt)}</td><td class="krext-num${b.balAfter < 0 ? ' krext-red' : ''}">${F.money(b.balAfter)}</td><td class="krext-num">${rateCell(b.rateAll, `(승인액 ${F.money(b.apprAmt)} + 미청구 ${F.money(unbilled)} + 승인전 ${F.money(req)}) / 예산액 ${F.money(b.bgtAmt)}`)}</td></tr>`;
  if (pt.count && !hidden) {   // 예상 비용까지 뺀 잔액 / 더한 집행비율
    const ftip = `(승인액 ${F.money(b.apprAmt)} + 미청구 ${F.money(unbilled)} + 승인전 ${F.money(req)} + 예상 ${F.money(pt.sum)}) / 예산액 ${F.money(b.bgtAmt)}`;
    foot += `<tr class="krext-bgt-proj" title="${F.esc(ftip)}"><td>예상 반영 <span class="krext-dim">(예상 ${F.money(pt.count)}건 · ${F.money(pt.sum)}원)</span></td><td class="krext-num krext-dim">-</td><td class="krext-num${b.balAfter - pt.sum < 0 ? ' krext-red' : ''}">${F.money(b.balAfter - pt.sum)}</td><td class="krext-num">${rateCell(rateOf(b.execAmt + pt.sum, b.bgtAmt), `(승인액 + 미청구 + 승인전 + 예상) / 예산액`)}</td></tr>`;
  }
  return `<table class="krext-cards krext-bgt"><thead><tr><th>비목${icons}</th><th class="krext-num" title="예산액(A)">예산</th><th class="krext-num" title="예산잔액(A-B)">예산잔액</th><th class="krext-num" title="승인액(B) ÷ 예산액(A)">집행비율</th></tr></thead><tbody>${rows}${orphans}${ubRow}</tbody><tfoot>${foot}</tfoot></table>`;
}

export { budgetTable, planBtn, planRow, planForm, rateCell, rateOf, pct, isProjectLead, projectLink, ICON_EYE, ICON_EYE_OFF, ICON_SAVE, ICON_IMPORT, ICON_EXPORT, ICON_EXT };
