// 현황 탭의 일일 업무 카드 — e-Class 「일일업무통계 대시보드」의 내 것(2026-10-27 사용자 지정: "현황에 eclass 에서 내일일 업무 보고 대쉬보드를 갖어와서 보는 기능 추가해줘").
// 받는 것은 src/dwr.js, 비율과 목표를 셈하는 것은 src/workshare.js 다. 여기는 카드를 그리고(기간 단추 · 업무 비율) 누름을 받는다. 사이트에는 아무것도 쓰지 않는다.
//
// 업무 비율(2026-10-27 사용자 지정: "연구개발 참여율을 월간으로 계산했을 때 해야 되는 업무 시간을 업무별 업무량이랑 같이 보이게 해줘 시간 비율로") — 업무마다 세 칸
// 참여율 · 실제 · 목표(2026-10-28 사용자 지정: "과제 참여율로 몇%가 되어야 하는지를.. 과제가 아니면 이건 없겠지.. 그리고 2번째 줄은 실제 전체에서 올해 몇퍼센트인지..
// 그리고3번째는 내가 입력할 수 있는 목표 업무 %를 입력하게 해줘"). 참여율은 rERP 의 내 과제 참여율 — 올해는 열두 달 평균(과제 줄만 — 막대의 회색 금; 2026-10-28 사용자 지정:
// "4월 과제라도 12개월로 나눠야 하잖아"), 실제는 기간에 적은 시간 가운데 비율(막대), 목표는 내가 넣는 %(막대의 노란 금 — 더한 업무는 그 업무의 %, 나머지 줄은 SHARE_KEY 의 goals).
// 참여율은 R&D 탭 장부(rndBook)의 rERP 참여인력에서 내 이름(설정의 myName)으로 찾는다. R&D 탭에서 열지 않아 참여인력을 받은 적이 없는 과제는 받을 때 그 탭이 받아 온다(fillStaff —
// "rerp 에 보면 참여율 정보가 있잖아 그게 반영이 안된듯 한데").
// 목록에 늘 있는 더하기 줄로 업무(이름 · 목표 %)를 더하고(SHARE_KEY — "나 같은 경우 AIP 업무를 추가할거야. 이건 내가 설정할게" · "그리고 추가할 수 있도록 해줘"),
// 그 줄의 목표 칸을 고치거나 × 로 뺀다. 다시 그려도 더하기 줄에 쓰던 글과 커서는 그대로 둔다.
// 네 칸(총 업무시간·시간외근무·잔여 휴가·이번 주)·진행현황·활동성·최근 업무는 뺐다("최근 업무, 활동성 이런건 필요 없음. 업무시간 이런것도 필요 없음").
//
// 현황 탭을 열 때 받고(10분 안이면 받아 둔 것을 그린다 — DWR_TTL_MS), 현황의 ↻ 가 다시 받는다. 장부·내 이름은 열 때마다 저장소에서 다시 읽는다(R&D 탭에서 바뀌었을 수 있다).
// 사용자 ID 는 처음 한 번 e-Class 홈 머리글에서 알아내 저장소에 둔다(USER_KEY). 고른 기간과 카드를 접었는지는 저장소에 둔다(RANGE_KEY·OPEN_KEY). 머리의 두 아이콘은 일일 업무 작성 화면과 대시보드 원본을 새 탭으로 연다.
//
// 일일 업무 짜기(2026-10-29 사용자 지정: "여기 목표에 맞도록 일일 업무보고를 신청할 수 있도록 해줘. 꼭 딱 맞출 필요는 없고 목표 총 합을 100%로 변경해서 목표와 실제 값이
// 비슷하게 달성할 수 있도록 해줘. 다만, 근태 내역을 보고 출장/외근의 경우 과제에 맞도록 없거나 모모하면 나두고") — 업무 비율 아래에 마지막으로 적은 날 다음날부터 오늘까지
// (60일까지)의 근무일을 HR 근태현황에서 읽어(workPlan — src/hr.js hrWorkPlan, 하루 한 번 DAYS_KEY 에 담는다) 날마다 업무를 짠다(src/dwrplan.js). 목표를 100% 로 늘인 값과
// 지금·쓴 뒤의 실제를 견주는 작은 표, 날마다 한 줄(날짜 · 업무 고르기(두기) · 시간 · 상태 / 업무내용)이 선다. 사람이 고르거나 고친 날은 그대로 두고(edits) 나머지를 다시 짠다.
// 머리의 아이콘으로 짠 날을 e-Class 에 저장(작성중)하거나 제출한다(두 번 누름) — 날마다 dwr.write 기록 하나(actions/spec/dwr/write.yaml)를 디스패처로 돌리고, 작성 화면은
// 뒤 탭 하나(src/dwrwrite.js createDwrWriter)로 차례로 쓴 뒤 닫는다. 저장·제출한 날은 DONE_KEY 에 적어 둔다 — 저장만 한 날은 그 내용 그대로 다시 서고 제출할 수 있다.
// 다 쓰면 대시보드를 다시 받는다. workPlan·actions 를 주지 않으면(검사) 이 칸은 서지 않는다.

import { PORTAL_HOME_URL } from './src/config.js';
import { AuthError } from './src/net.js';
import { todayStr } from './src/parse.js';
import { BOOK_KEY } from './src/rnd.js';
import { nameKey } from './src/rnderp.js';
import { DWR_HOME, DWR_WRITE, USER_KEY, RANGE_KEY, OPEN_KEY, RANGES, DWR_TTL_MS, rangeOf, hoursText, fetchUserId, fetchDashboard } from './src/dwr.js';
import { SHARE_KEY, normalizeShare, myRates, workShare } from './src/workshare.js';
import { HOURS_MAX, CONTENT_MAX, workDays, historyOf, planItems, planDays, forecastOf } from './src/dwrplan.js';
import { createDwrWriter } from './src/dwrwrite.js';

/** 하루 한 번 읽어 두는 HR 근태현황 — { day: 읽은 날, from, to, rows }. */
export const DAYS_KEY = 'dwrDays';
/** 이 카드가 저장·제출한 날 — { [YYYY-MM-DD]: { status: 'saved'|'submitted', key, label, title, hours, content, trip, at } }. */
export const DONE_KEY = 'dwrDone';
/** 짜는 날은 마지막으로 적은 날 다음날부터 — 그래도 오늘에서 이만큼 앞까지만. */
export const PLAN_BACK_DAYS = 60;
/** 적어 둔 저장·제출을 이만큼 지나면 버린다. */
const DONE_KEEP_DAYS = 90;
/** 제출의 두 번째 누름을 기다리는 동안. */
const ARM_MS = 4000;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
const hours = (min) => hoursText(Math.round((min / 60) * 10) / 10);
const pct = (min, all) => (all ? (min / all) * 100 : 0);
const pctText = (v) => `${Math.round(v)}%`;
/** 실제와 목표(넣지 않았으면 참여율)가 이만큼(%p) 벌어지면 실제를 붉게. */
const OFF_PCT = 5;
const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const OK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const RELOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>';
const SAVE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg>';
const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/></svg>';
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const two = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
/** YYYY-MM-DD 에 n 일. */
const shift = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymdOf(new Date(y, m - 1, d + n)); };
const dow = (s) => { const [y, m, d] = s.split('-').map(Number); return DOW[new Date(y, m - 1, d).getDay()]; };
/** 짠 날의 형편 — 카드 줄의 상태 칸 글. */
const STATE_TEXT = { busy: '쓰는 중…', saved: '저장함', submitted: '제출함', exists: '이미 있음', unverified: '확인 필요', fail: '안 됨', filled: '채움' };

/**
 * @param {object} [deps]
 * @param {Document} [deps.doc]
 * @param {{get:Function, set:Function}} [deps.storage] chrome.storage.local
 * @param {(url:string)=>void} [deps.openTab]
 * @param {()=>string} [deps.today] YYYY-MM-DD
 * @param {()=>number} [deps.now]
 * @param {object} [deps.api] 검사용 — src/dwr.js 의 fetchUserId·fetchDashboard 를 바꿔 끼운다
 * @param {()=>Promise<number>} [deps.fillStaff] R&D 탭이 참여인력을 받은 적 없는 과제의 것을 받아 장부에 둔다(rndpanel.js) — 받은 과제 수
 * @param {(range: {from: string, to: string}) => Promise<object[]>} [deps.workPlan] HR 근태현황의 줄(src/hr.js hrWorkPlan) — 없으면 일일 업무 짜기가 서지 않는다
 * @param {object} [deps.actions] 디스패처(actions/dispatch.js — dwr.write 가 등록된 것). 없으면 짜기가 서지 않는다
 * @param {() => {writeDay: Function, close: Function}} [deps.createWriter] 작성기(src/dwrwrite.js createDwrWriter — 검사는 가짜)
 */
export function createDwrBox({
  doc = document, storage = chrome.storage.local, openTab = (url) => chrome.tabs.create({ url }), today = todayStr, now = Date.now, api = {}, fillStaff = async () => 0,
  workPlan = null, actions = null, createWriter = createDwrWriter,
} = {}) {
  const $ = (id) => doc.getElementById(id);
  const box = $('dwrBox');
  const call = { fetchUserId, fetchDashboard, ...api };
  // data: 받은 것 { rows } · at: 받은 때 · share: 더한 업무 · me: 내 이름 · rates: 장부에서 찾은 내 참여율(src/workshare.js myRates) · adding: 더하기 줄이 열렸나
  // book: R&D 장부(계획의 개발내용) · days: HR 근태현황 { day, from, to, rows } · daysError · daysLoading · done: 이 카드가 저장·제출한 날(DONE_KEY) ·
  // edits: 사람이 정한 날 { 날짜: { key, hours?, content? } } · progress: 쓰는 동안·쓴 뒤 날마다의 형편 { 날짜: { state, note } } · writing: 'save'|'submit'|null · armed: 제출 첫 누름
  const st = {
    range: 'year', id: '', data: null, at: 0, error: null, loading: false, run: null, share: { items: [], goals: {} }, me: '', rates: null, adding: false,
    book: null, days: null, daysError: null, daysLoading: false, done: {}, edits: new Map(), progress: new Map(), writing: null, armed: false, note: '',
  };
  const planOn = () => !!(workPlan && actions && $('dwrPlan'));
  // 저장해 둔 사용자 ID·기간을 읽기 전에 받기 시작하면 홈을 괜히 한 번 더 읽는다 — load 는 이것을 기다린다(wire 가 바꾼다).
  let ready = Promise.resolve();

  const period = () => rangeOf(st.range, today());
  /** 업무 비율의 기간 — 올해는 12월 31일까지: 적은 날은 오늘까지라 실제는 같고, 참여율은 열두 달 평균이 된다(4월에 시작한 과제도 12로 나눈다). */
  const sharePeriod = () => { const p = period(); return st.range === 'year' ? { ...p, to: `${p.from.slice(0, 4)}-12-31` } : p; };

  function paintEmpty(text) {
    $('dwrState').textContent = text;
    $('dwrLast').textContent = '';
    $('dwrTop').innerHTML = '';
    $('dwrHint').textContent = '';
    if ($('dwrPlan')) $('dwrPlan').innerHTML = '';
  }

  function paintMsg() {
    const msg = $('dwrMsg');
    if (st.error) {
      const login = st.error instanceof AuthError;
      msg.className = 'dwr-msg error';
      msg.innerHTML = `${esc(st.error.message)}${login ? ' <a href="#" data-login>eclass 열기</a>' : ''}`;
    } else {
      msg.className = 'dwr-msg';
      msg.textContent = st.loading && st.data ? '다시 읽는 중…' : '';
    }
  }

  function paint() {
    for (const b of $('dwrRanges').querySelectorAll('[data-range]')) b.setAttribute('aria-pressed', String(b.dataset.range === st.range));
    box.setAttribute('aria-busy', String(st.loading));
    paintMsg();
    if (!st.data) return paintEmpty(st.loading ? '읽는 중…' : st.error ? '읽지 못함' : '');
    $('dwrState').textContent = RANGES[st.range];
    const last = st.data.rows[0]?.date;
    $('dwrLast').textContent = last ? `${md(last)}까지 작성` : '작성한 날 없음';
    paintShare();
    paintPlan();
  }

  /** 줄의 풍선말 — 이름 · 기간의 실제/참여율(더한 업무는 목표 — 시간과 %) · 달마다의 그 둘 % · 이 줄에 든 업무명. */
  function tipOf(L, all) {
    const head = [L.name];
    if (L.kind === 'item') head.push(`일일 업무의 업무명·업무분류에 "${L.label}" 이 든 줄 — 달마다 적은 시간의 목표 %`);
    if (L.kind === 'rnd') head.push('내 참여율이 없는 연구과제(R&D 탭에 없거나 참여인력에 내가 없다) — 참여율 0');
    if (L.kind === 'etc') head.push('연구과제도 더한 업무도 아닌 것');
    const by = L.kind === 'item' ? `목표 ${hours(L.target)}시간 (${pctText(pct(L.target, all))})` : `참여율 ${pctText(L.rate)}${st.range === 'year' ? '(열두 달 평균)' : ''}`;
    head.push(`실제 ${hours(L.actual)}시간 (${pctText(pct(L.actual, all))})${L.target == null ? '' : ` · ${by}`}`);
    const months = L.months.filter((m) => m.total).map((m) => `${+m.ym.slice(5)}월 ${pctText(pct(m.actual, m.total))}${L.target == null ? '' : ` / ${pctText(pct(m.target, m.total))}`}`);
    const titles = L.kind === 'item' && !L.titles.length ? [] : L.titles.slice(0, 8).map(([t, min]) => `· ${t} ${hours(min)}시간`);
    return [...head, ...(months.length ? [months.join('  ')] : []), ...titles].join('\n');
  }

  /** 참여율 칸 — 내 과제 참여율(과제 줄만). 목표 칸 — 내가 넣은 %(더한 업무는 그 업무의 %, 넣지 않았으면 null). */
  const needOf = (L) => L.rate ?? null;
  const goalOf = (L) => (L.kind === 'item' ? st.share.items.find((i) => `item:${i.name}` === L.key)?.rate ?? 0 : st.share.goals[L.key] ?? null);

  function rowHtml(L, all, scale) {
    const a = pct(L.actual, all);
    const need = needOf(L);
    const goal = goalOf(L);
    const ref = goal ?? need;
    const off = !!all && ref != null && Math.abs(a - ref) >= OFF_PCT;
    const w = (v) => Math.min(100, (v / scale) * 100).toFixed(1);
    const bar = `<span class="dwr-bar" aria-hidden="true"><i style="width:${a > 0 ? Math.max(2, w(a)) : 0}%"></i>`
      + `${need != null ? `<b style="left:${w(need)}%"></b>` : ''}${goal != null ? `<b class="dwr-goal" style="left:${w(goal)}%"></b>` : ''}</span>`;
    const field = L.kind === 'item' ? `data-rate="${esc(L.label)}"` : `data-goal="${esc(L.key)}" placeholder="–"`;
    const input = `<input class="dwr-rate" type="number" min="0" max="100" step="0.5" value="${goal ?? ''}" ${field} aria-label="${esc(L.label)} 목표 %">%`
      + (L.kind === 'item' ? `<button type="button" class="dwr-icon" data-del="${esc(L.label)}" title="${esc(L.label)} 빼기" aria-label="${esc(L.label)} 빼기">${X_ICON}</button>` : '');
    return `<li class="dwr-k-${L.kind}${off ? ' dwr-off' : ''}" data-key="${esc(L.key)}" title="${esc(tipOf(L, all))}"><span class="dwr-top-name">${esc(L.label)}</span>${bar}`
      + `<span class="dwr-need">${need == null ? '' : pctText(need)}</span><strong class="dwr-real">${pctText(a)}</strong><span class="dwr-num">${input}</span></li>`;
  }

  const COLS_HTML = '<li class="dwr-cols"><span>업무 비율</span><span></span>'
    + '<span title="R&D 탭 과제(rERP 참여인력)의 내 참여율 — 올해는 열두 달 평균(4월에 시작한 과제도 12로 나눕니다), 한 달·7일은 걸친 달의 평균. 과제 줄에만 있습니다(막대의 회색 금)">참여율</span>'
    + '<span title="기간에 적은 시간 가운데 그 업무의 비율(막대)">실제</span>'
    + '<span title="내가 정하는 % (막대의 노란 금) — 실제와 견줍니다">목표</span></li>';

  const addHtml = () => '<li class="dwr-k-item dwr-adding"><input id="dwrNewName" class="dwr-item-name" maxlength="40" placeholder="＋ 업무 더하기 (예: AIP)" aria-label="더할 업무 이름"'
    + ' title="과제가 아닌 업무를 목표 % 와 함께 더합니다 — 일일 업무의 업무명·업무분류에 이 말이 든 줄이 이 업무입니다">'
    + '<span class="dwr-num"><input id="dwrNewRate" class="dwr-rate" type="number" min="0" max="100" step="0.5" placeholder="0" aria-label="목표 %">%'
    + `<button type="button" class="dwr-icon" data-save title="더하기" aria-label="더하기">${OK_ICON}</button></span></li>`;

  /** 목록 안의 입력칸 하나를 다시 그린 뒤에도 찾을 이름 — 더하기 줄은 id, 목표 칸은 그 줄. */
  const fieldOf = (x) => (x?.id ? `#${x.id}` : x?.dataset.rate != null ? `rate:${x.dataset.rate}` : x?.dataset.goal != null ? `goal:${x.dataset.goal}` : null);

  /**
   * 업무 비율 — 머리 줄(참여율 · 실제 · 목표) 아래 업무마다 한 줄, 더한 업무 아래에 더하기 줄(늘). 기간에 적은 것이 없어도 더한 업무 줄과 더하기 줄은 선다.
   * 다시 그려도 더하기 줄에 쓰던 글과 목록 안의 커서(더하기 줄 · 목표 칸)는 그대로 — 목표 칸을 고쳐 Enter 를 누르면 그 칸에 남아 이어서 고칠 수 있다.
   */
  function paintShare() {
    const top = $('dwrTop');
    const draft = [$('dwrNewName')?.value || '', $('dwrNewRate')?.value || ''];
    const was = top.contains(doc.activeElement) ? fieldOf(doc.activeElement) : null;
    const s = workShare(st.data.rows, { ...sharePeriod(), items: st.share.items, rates: st.rates || undefined });
    const all = s.minutes;
    const scale = Math.max(1, ...s.lines.map((L) => Math.max(pct(L.actual, all), needOf(L) ?? 0, goalOf(L) ?? 0)));
    const lines = all ? s.lines : s.lines.filter((L) => L.kind === 'item');
    top.innerHTML = COLS_HTML + (all ? '' : '<li class="dwr-none">이 기간에 적은 업무가 없습니다</li>')
      + lines.filter((L) => L.kind !== 'etc').map((L) => rowHtml(L, all, scale)).join('')
      + addHtml() + lines.filter((L) => L.kind === 'etc').map((L) => rowHtml(L, all, scale)).join('');
    [$('dwrNewName').value, $('dwrNewRate').value] = draft;
    if (was) [...top.querySelectorAll('input')].find((x) => fieldOf(x) === was)?.focus();
    const known = !!st.rates?.projects.some((p) => p.rates.size);
    $('dwrHint').textContent = !st.me ? '설정 › 일반의 내 이름이 있어야 R&D 탭 과제에서 내 참여율을 찾습니다.'
      : !known ? `R&D 탭 과제의 rERP 참여인력에서 ${st.me} 님의 참여율을 찾지 못했습니다.` : '';
  }

  /** 장부와 내 이름을 저장소에서 다시 읽는다 — R&D 탭에서 참여인력을 받았거나 설정에서 이름을 바꿨을 수 있다. */
  async function readBook() {
    const saved = await Promise.resolve(storage.get([BOOK_KEY, 'myName'])).catch(() => null);
    st.me = typeof saved?.myName === 'string' ? saved.myName.trim() : '';
    st.book = saved?.[BOOK_KEY] || null;
    st.rates = myRates(st.book, st.me);
  }

  async function load() {
    st.loading = true;
    st.error = null;
    paint();
    try {
      await ready;
      if (!st.id) {
        st.id = await call.fetchUserId();
        if (!st.id) throw new Error('e-Class 홈 머리글에서 사용자 ID 를 찾지 못했습니다');
        storage.set({ [USER_KEY]: st.id });
      }
      const [data] = await Promise.all([call.fetchDashboard(st.id), readBook()]);
      st.data = data;
      st.at = now();
    } catch (err) {
      st.error = err;
    } finally {
      st.loading = false;
      paint();
    }
    // R&D 탭에서 열지 않아 참여인력이 없는 과제를 그 탭이 받아 오면 참여율을 다시 그린다 — 기다리지 않는다.
    Promise.resolve().then(fillStaff).then((n) => (n > 0 ? readBook().then(paint) : null)).catch(() => {});
  }

  /**
   * 현황 탭이 열릴 때·↻ 를 누를 때. 받아 둔 지 10분 안이면 다시 받지 않고 장부만 다시 읽는다(force 는 받는다). 받는 중이면 그것을 기다린다.
   * 일일 업무 짜기의 근태도 같이 — 받은 뒤에 읽는다(기다리지 않는다, 하루 한 번 · force 면 다시).
   * @returns {Promise<void>}
   */
  function show({ force = false, days = force } = {}) {
    if (st.run) return st.run;
    if (!force && st.data && !st.error && now() - st.at < DWR_TTL_MS) return readBook().then(paint).then(() => { loadDays(); });
    const run = load().then(() => { pruneDone(); loadDays({ force: days }); });
    st.run = run;
    run.finally(() => { if (st.run === run) st.run = null; });
    return run;
  }

  /* ------------------------------------------------------------ 일일 업무 짜기 */

  /** 짤 날의 기간 — 마지막으로 적은 날 다음날부터 오늘까지(PLAN_BACK_DAYS 까지). 짤 날이 없으면 null. */
  function planSpan() {
    if (!st.data) return null;
    const to = today();
    const last = st.data.rows[0]?.date || '';
    const back = shift(to, -PLAN_BACK_DAYS);
    const from = last && shift(last, 1) > back ? shift(last, 1) : back;
    // 저장만 해 둔 날은 대시보드에 실려도 제출할 수 있게 그 날부터 본다.
    const saved = Object.entries(st.done).filter(([, v]) => v.status === 'saved').map(([d]) => d).filter((d) => d >= back).sort()[0];
    const start = saved && saved < from ? saved : from;
    return start <= to ? { from: start, to } : null;
  }

  /** HR 근태현황을 읽는다 — 오늘 읽어 둔 것이 그 기간을 덮으면 그것을 쓴다. 못 읽으면 까닭을 적는다(던지지 않는다). */
  async function loadDays({ force = false } = {}) {
    if (!planOn() || st.daysLoading) return;
    const span = planSpan();
    if (!span) return;
    const day = today();
    const saved = st.days || (await Promise.resolve(storage.get(DAYS_KEY)).catch(() => null))?.[DAYS_KEY];
    if (!force && saved?.day === day && saved.from <= span.from && saved.to >= span.to && Array.isArray(saved.rows)) {
      st.days = saved;
      return paint();
    }
    st.daysLoading = true;
    st.daysError = null;
    paint();
    try {
      const rows = await workPlan(span);
      st.days = { day, from: span.from, to: span.to, rows: Array.isArray(rows) ? rows : [] };
      storage.set({ [DAYS_KEY]: st.days });
    } catch (err) {
      st.daysError = err;
    } finally {
      st.daysLoading = false;
      paint();
    }
  }

  /** 지금 짠 것 — 근태의 근무일 가운데 아직 안 쓴 날(이 카드가 저장만 해 둔 날은 그 내용으로) + 사람이 정한 날, 그리고 목표·쓴 뒤의 실제. */
  function planNow() {
    const span = planSpan();
    if (!span || !st.days) return null;
    const written = new Set(st.data.rows.map((r) => r.date));
    const s = workShare(st.data.rows, { ...sharePeriod(), items: st.share.items, rates: st.rates || undefined });
    const days = workDays(st.days.rows, span)
      .filter((d) => st.done[d.date]?.status !== 'submitted' && (!written.has(d.date) || st.done[d.date]?.status === 'saved'))
      .map((d) => {
        const dn = st.done[d.date];
        if (dn?.status === 'saved') return { ...d, fixed: true, key: dn.key, label: dn.label, title: dn.title, hours: dn.hours, content: dn.content, saved: true };
        const e = st.edits.get(d.date);
        return e ? { ...d, fixed: true, key: e.key, hours: e.hours ?? d.hours, content: e.content } : d;
      });
    const history = historyOf(st.data.rows, { items: st.share.items, rates: st.rates || undefined });
    const projects = new Map((st.book?.projects || []).filter((p) => p?.id).map((p) => [`prj:${p.id}`, p]));
    const planOf = (key) => (projects.has(key) ? planItems(projects.get(key), today()) : []);
    const plan = planDays({ lines: s.lines, minutes: s.minutes, share: st.share, days, history, planOf });
    return { ...plan, span, minutes: s.minutes, forecast: forecastOf(plan.targets, s.minutes, plan.days) };
  }

  /** 날 한 줄의 상태 칸 — 쓰는 동안·쓴 뒤의 형편, 아니면 저장해 둔 날·출장·외근. */
  function stateOf(d) {
    const p = st.progress.get(d.date);
    if (p) return { text: p.state === 'busy' && p.note ? p.note : STATE_TEXT[p.state] || p.state, cls: p.state, tip: p.note || '' };
    if (d.saved) return { text: '저장함', cls: 'saved', tip: '이 카드가 e-Class 에 저장(작성중)해 둔 날 — 제출하면 저장된 그대로 제출합니다' };
    if (d.trip) return { text: d.kind || '출장', cls: 'trip', tip: [d.status, d.reason].filter(Boolean).join(' — ') };
    return { text: '', cls: '', tip: '' };
  }

  function dayHtml(d, lines) {
    const date = esc(d.date);
    const state = stateOf(d);
    const opts = lines.map((L) => `<option value="${esc(L.key)}"${L.key === d.key ? ' selected' : ''}>${esc(L.label)}</option>`).join('');
    const lost = d.key && !lines.some((L) => L.key === d.key) ? `<option value="${esc(d.key)}" selected>${esc(d.label || d.key)}</option>` : '';
    const lock = d.saved || !!st.writing ? ' disabled' : '';
    const tip = d.key ? d.title : d.why;
    return `<li class="dwr-day${d.key ? '' : ' dwr-day-off'}${d.trip ? ' dwr-day-trip' : ''}" data-date="${date}">`
      + `<span class="dwr-day-date">${md(d.date)} ${dow(d.date)}</span>`
      + `<select data-day-key="${date}" aria-label="${md(d.date)} 업무" title="${esc(tip)}"${lock}>${lost}${opts}<option value=""${d.key ? '' : ' selected'}>두기</option></select>`
      + `<span class="dwr-num"><input class="dwr-rate" type="number" min="0.5" max="${HOURS_MAX}" step="0.5" value="${esc(d.hours)}" data-day-hours="${date}" aria-label="${md(d.date)} 시간"${lock}>시간</span>`
      + `<span class="dwr-day-state${state.cls ? ` dwr-st-${state.cls}` : ''}" title="${esc(state.tip)}">${esc(state.text)}</span>`
      + (d.key
        ? `<input class="dwr-day-text" maxlength="${CONTENT_MAX}" value="${esc(d.content)}" placeholder="업무내용을 적어 주세요" data-day-content="${date}" aria-label="${md(d.date)} 업무내용"${lock}>`
        : `<span class="dwr-day-why">${esc(d.why)}${d.reason ? ` — ${esc(d.reason)}` : ''}</span>`)
      + '</li>';
  }

  /** 목표(넣은 % 를 합 100 으로) · 지금 실제 · 짠 대로 쓴 뒤의 실제. */
  function goalsHtml(plan) {
    if (!plan.forecast.length) return '<p class="dwr-plan-none">업무 비율의 목표 칸에 % 를 넣으면 그 비율에 맞춰 짭니다</p>';
    const sumGoal = plan.forecast.reduce((a, f) => a + f.goal, 0);
    return `<ol class="dwr-goals"><li class="dwr-cols"><span>목표 ${pctText(sumGoal)} → 100%</span><span>목표</span><span>지금</span><span>쓴 뒤</span></li>`
      + plan.forecast.map((f) => `<li title="넣은 목표 ${f.goal}% — 합 ${Math.round(sumGoal * 10) / 10}% 를 100% 로"><span class="dwr-top-name">${esc(f.label)}</span>`
        + `<span>${pctText(f.norm)}</span><span>${pctText(f.now)}</span><strong>${pctText(f.after)}</strong></li>`).join('')
      + '</ol>';
  }

  /** 짜기 칸 — 머리(기간 · 날 수 · 근태 다시 읽기 · 저장 · 제출), 목표 표, 날마다 한 줄. 다시 그려도 칸의 커서는 그대로. */
  function paintPlan() {
    const el = $('dwrPlan');
    if (!el || !planOn()) return;
    const span = planSpan();
    if (!span) { el.innerHTML = ''; return; }
    const was = el.contains(doc.activeElement) ? [...el.querySelectorAll('input,select')].indexOf(doc.activeElement) : -1;
    const head = (detail, ready) => `<div class="dwr-plan-head"><span class="dwr-plan-title">일일 업무 짜기</span><span class="dwr-plan-span">${detail}</span>`
      + `<button type="button" class="dwr-icon" data-plan="reload" title="근태 다시 읽기" aria-label="근태 다시 읽기"${st.writing || st.daysLoading ? ' disabled' : ''}>${RELOAD_ICON}</button>`
      + (ready ? `<button type="button" class="dwr-icon" data-plan="save" title="짠 날을 e-Class 에 저장(작성중)" aria-label="짠 날 저장"${st.writing ? ' disabled' : ''}>${SAVE_ICON}</button>`
        + `<button type="button" class="dwr-icon dwr-send${st.armed ? ' armed' : ''}" data-plan="submit" title="${st.armed ? '한 번 더 누르면 제출합니다' : '짠 날을 e-Class 에 제출(두 번 누름)'}" aria-label="짠 날 제출"${st.writing ? ' disabled' : ''}>${SEND_ICON}</button>` : '')
      + '</div>';
    const when = `${md(span.from)}~${md(span.to)}`;
    if (st.daysLoading && !st.days) { el.innerHTML = head(`${when} · 근태 읽는 중…`, false); return; }
    if (st.daysError && !st.days) {
      const login = st.daysError instanceof AuthError;
      el.innerHTML = `${head(when, false)}<p class="dwr-msg error">근태현황을 읽지 못했습니다 — ${esc(st.daysError.message)}${login ? ' <a href="#" data-login>eclass 열기</a>' : ''}</p>`;
      return;
    }
    const plan = planNow();
    if (!plan) { el.innerHTML = ''; return; }
    const ready = plan.days.some((d) => d.key);
    const count = plan.days.filter((d) => d.key).length;
    const detail = `${when} · ${plan.days.length ? `${count}일${plan.days.length > count ? ` (둘 ${plan.days.length - count}일)` : ''}` : '쓸 날 없음'}`;
    // 다시 읽기를 못 했으면 전에 읽어 둔 근태로 짜고 그렇다고 적는다.
    const stale = st.daysError ? `<p class="dwr-msg error">근태현황을 다시 읽지 못했습니다(${md(st.days.day)}에 읽은 것으로 짰습니다) — ${esc(st.daysError.message)}</p>` : '';
    el.innerHTML = head(detail, ready)
      + stale
      + (plan.days.length ? goalsHtml(plan) : '')
      + (plan.days.length ? `<ol class="dwr-days">${plan.days.map((d) => dayHtml(d, plan.lines)).join('')}</ol>` : '')
      + (st.note ? `<p class="dwr-plan-note">${esc(st.note)}</p>` : '');
    if (was >= 0) el.querySelectorAll('input,select')[was]?.focus();
  }

  /** 사람이 그 날을 정한다 — 업무를 고르거나(두기면 key null) 시간·내용을 고치면 그 날은 그대로 두고 다른 날을 다시 짠다. */
  function editDay(date, patch) {
    const plan = planNow();
    const d = plan?.days.find((x) => x.date === date);
    if (!d || d.saved) return;
    const base = st.edits.get(date) || { key: d.key, hours: d.hours, content: d.content };
    const next = { ...base, ...patch };
    // 업무를 바꾸면 내용은 그 업무의 것으로 다시(사람이 적은 내용이 아니면).
    if ('key' in patch && patch.key !== base.key && !base.typed) next.content = undefined;
    if ('content' in patch) next.typed = true;
    st.edits.set(date, next);
    paint();
  }

  /** 저장(save)·제출(submit) — 짠 날마다 dwr.write 기록 하나를 지어 디스패처로 차례로 돌린다. 작성 화면은 뒤 탭 하나로 쓰고 닫는다. 다 쓰면 대시보드를 다시 받는다. */
  async function writeAll(op) {
    const plan = planNow();
    const todo = (plan?.days || []).filter((d) => d.key && String(d.content || '').trim() && d.hours > 0 && (op === 'submit' || !d.saved));
    const empty = (plan?.days || []).filter((d) => d.key && !String(d.content || '').trim()).length;
    if (!todo.length) { st.note = empty ? `업무내용이 빈 날(${empty}일)을 채워 주세요` : '쓸 날이 없습니다'; return paint(); }
    st.writing = op;
    st.note = empty ? `업무내용이 빈 ${empty}일은 건너뜁니다` : '';
    for (const d of todo) st.progress.delete(d.date);
    paint();
    const writer = createWriter();
    const tally = new Map();
    let stopped = false;
    try {
      for (const d of todo) {
        st.progress.set(d.date, { state: 'busy', note: '' });
        paint();
        let state = 'fail';
        try {
          const input = { date: d.date, title: d.title, label: d.label, hours: d.hours, content: String(d.content).trim(), trip: !!d.trip, op };
          const { record } = actions.build('dwr.write', { input, preset: { today: today(), me: st.me } });
          const r = await actions.run(record, {
            confirmed: record.hash, writer, text: `일일 업무 ${md(d.date)} ${d.label} ${d.hours}시간 ${op === 'submit' ? '제출' : '저장'}`,
            onStage: (text) => { st.progress.set(d.date, { state: 'busy', note: text }); paint(); },
          });
          state = r?.status || (r?.ok ? 'saved' : 'fail');
          st.progress.set(d.date, { state, note: r?.note || '' });
          if (r?.ok && (state === 'saved' || state === 'submitted')) {
            st.done[d.date] = { status: state, key: d.key, label: d.label, title: d.title, hours: d.hours, content: input.content, trip: !!d.trip, at: now() };
            st.edits.delete(d.date);
            storage.set({ [DONE_KEY]: st.done });
          }
        } catch (err) {
          st.progress.set(d.date, { state: 'fail', note: err?.message || String(err) });
          // 로그인이 풀렸으면 남은 날도 안 된다 — 멈추고 까닭(eclass 열기)을 둔다.
          if (err instanceof AuthError) { st.error = err; stopped = true; }
        }
        tally.set(state, (tally.get(state) || 0) + 1);
        paint();
        if (stopped) break;
      }
    } finally {
      await Promise.resolve(writer.close()).catch(() => {});
      st.writing = null;
      st.note = [...tally].map(([k, n]) => `${STATE_TEXT[k] || k} ${n}일`).join(' · ');
      paint();
    }
    // 대시보드를 다시 받아 실제를 다시 센다(근태는 그대로라 다시 읽지 않는다). 로그인이 풀려 멈췄으면 받지 않는다 — 까닭이 지워진다.
    if (!stopped) await show({ force: true, days: false });
  }

  /** 저장해 둔 기록 가운데 끝난 것을 버린다 — 제출해서 대시보드에 실린 날, 오래된 날. */
  function pruneDone() {
    const keep = shift(today(), -DONE_KEEP_DAYS);
    const written = new Set((st.data?.rows || []).map((r) => r.date));
    const next = Object.fromEntries(Object.entries(st.done).filter(([date, v]) => date >= keep && v && !(v.status === 'submitted' && written.has(date))));
    if (Object.keys(next).length !== Object.keys(st.done).length) { st.done = next; storage.set({ [DONE_KEY]: next }); }
  }

  /** 현황 탭에서만 선다. */
  function toggle(on) {
    box.classList.toggle('hidden', !on);
  }

  /** 더한 업무(items)나 줄마다의 목표(goals)를 바꿔 저장하고 다시 그린다 — 짠 날도 새 목표로 다시 짠다(사람이 정한 날은 그대로). */
  function saveShare(next) {
    st.share = normalizeShare({ ...st.share, ...next });
    storage.set({ [SHARE_KEY]: st.share });
    if (st.data) paint();
  }

  /** 더하기 줄의 이름·목표로 업무를 더하고 그 줄을 비운다. 같은 이름이 있으면 그 목표를 바꾼다. */
  function addItem() {
    const name = $('dwrNewName').value.trim();
    if (!nameKey(name)) return $('dwrNewName').focus();
    const rate = $('dwrNewRate').value;
    $('dwrNewName').value = '';
    $('dwrNewRate').value = '';
    saveShare({ items: [...st.share.items.filter((i) => nameKey(i.name) !== nameKey(name)), { name, rate }] });
  }

  /** 누름을 붙이고 저장해 둔 기간·접힘·사용자 ID·더한 업무를 읽는다. */
  function wire() {
    box.addEventListener('toggle', () => storage.set({ [OPEN_KEY]: box.open }));
    $('dwrRanges').addEventListener('click', (e) => {
      const b = e.target.closest('[data-range]');
      if (!b || !RANGES[b.dataset.range] || b.dataset.range === st.range) return;
      st.range = b.dataset.range;
      storage.set({ [RANGE_KEY]: st.range });
      paint();
    });
    // 머리 줄(summary) 안의 단추라 누르면 카드도 접혔다 펴진다 — 막고 새 탭만 연다.
    $('dwrWrite').addEventListener('click', (e) => { e.preventDefault(); openTab(DWR_WRITE); });
    $('dwrOpen').addEventListener('click', (e) => { e.preventDefault(); openTab(DWR_HOME); });
    $('dwrMsg').addEventListener('click', (e) => {
      if (!e.target.closest('[data-login]')) return;
      e.preventDefault();
      openTab(PORTAL_HOME_URL);
    });
    $('dwrTop').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) return saveShare({ items: st.share.items.filter((i) => i.name !== del.dataset.del) });
      if (e.target.closest('[data-save]')) addItem();
    });
    $('dwrTop').addEventListener('change', (e) => {
      const rate = e.target.closest('[data-rate]');
      if (rate) saveShare({ items: st.share.items.map((i) => (i.name === rate.dataset.rate ? { ...i, rate: rate.value } : i)) });
      // 비우면 그 줄의 목표를 지운다(normalizeShare 가 빈 칸을 뺀다).
      const goal = e.target.closest('[data-goal]');
      if (goal) saveShare({ goals: { ...st.share.goals, [goal.dataset.goal]: goal.value } });
    });
    $('dwrTop').addEventListener('keydown', (e) => {
      if (!e.target.closest('.dwr-adding')) return;
      if (e.key === 'Enter') { e.preventDefault(); addItem(); }
      if (e.key === 'Escape') { $('dwrNewName').value = ''; $('dwrNewRate').value = ''; }
    });
    const plan = $('dwrPlan');
    if (plan) {
      plan.addEventListener('click', (e) => {
        if (e.target.closest('[data-login]')) { e.preventDefault(); return openTab(PORTAL_HOME_URL); }
        const b = e.target.closest('[data-plan]');
        if (!b || b.disabled || st.writing) return;
        if (b.dataset.plan === 'reload') { st.edits.clear(); st.progress.clear(); st.note = ''; return loadDays({ force: true }); }
        if (b.dataset.plan === 'save') return writeAll('save');
        if (b.dataset.plan === 'submit') {
          if (st.armed) { st.armed = false; return writeAll('submit'); }
          st.armed = true;
          paint();
          setTimeout(() => { if (st.armed) { st.armed = false; paint(); } }, ARM_MS);
        }
      });
      plan.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.dayKey) editDay(t.dataset.dayKey, { key: t.value || null });
        else if (t.dataset.dayHours) {
          const h = Number(t.value);
          if (Number.isFinite(h) && h > 0 && h <= HOURS_MAX) editDay(t.dataset.dayHours, { hours: Math.round(h * 10) / 10 }); else paint();
        } else if (t.dataset.dayContent) editDay(t.dataset.dayContent, { content: t.value.slice(0, CONTENT_MAX) });
      });
    }
    ready = Promise.resolve(storage.get([USER_KEY, RANGE_KEY, OPEN_KEY, SHARE_KEY, DONE_KEY])).then((saved) => {
      if (!st.id) st.id = String(saved?.[USER_KEY] || '');
      if (RANGES[saved?.[RANGE_KEY]]) st.range = saved[RANGE_KEY];
      if (saved?.[OPEN_KEY] === false) box.open = false;
      st.share = normalizeShare(saved?.[SHARE_KEY]);
      const done = saved?.[DONE_KEY];
      st.done = done && typeof done === 'object' && !Array.isArray(done) ? done : {};
      paint();
    }, () => {});
    return ready;
  }

  return { wire, show, toggle, state: st, writeAll };
}
