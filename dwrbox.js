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

import { PORTAL_HOME_URL } from './src/config.js';
import { AuthError } from './src/net.js';
import { todayStr } from './src/parse.js';
import { BOOK_KEY } from './src/rnd.js';
import { nameKey } from './src/rnderp.js';
import { DWR_HOME, DWR_WRITE, USER_KEY, RANGE_KEY, OPEN_KEY, RANGES, DWR_TTL_MS, rangeOf, hoursText, fetchUserId, fetchDashboard } from './src/dwr.js';
import { SHARE_KEY, normalizeShare, myRates, workShare } from './src/workshare.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
const hours = (min) => hoursText(Math.round((min / 60) * 10) / 10);
const pct = (min, all) => (all ? (min / all) * 100 : 0);
const pctText = (v) => `${Math.round(v)}%`;
/** 실제와 목표(넣지 않았으면 참여율)가 이만큼(%p) 벌어지면 실제를 붉게. */
const OFF_PCT = 5;
const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const OK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

/**
 * @param {object} [deps]
 * @param {Document} [deps.doc]
 * @param {{get:Function, set:Function}} [deps.storage] chrome.storage.local
 * @param {(url:string)=>void} [deps.openTab]
 * @param {()=>string} [deps.today] YYYY-MM-DD
 * @param {()=>number} [deps.now]
 * @param {object} [deps.api] 검사용 — src/dwr.js 의 fetchUserId·fetchDashboard 를 바꿔 끼운다
 * @param {()=>Promise<number>} [deps.fillStaff] R&D 탭이 참여인력을 받은 적 없는 과제의 것을 받아 장부에 둔다(rndpanel.js) — 받은 과제 수
 */
export function createDwrBox({
  doc = document, storage = chrome.storage.local, openTab = (url) => chrome.tabs.create({ url }), today = todayStr, now = Date.now, api = {}, fillStaff = async () => 0,
} = {}) {
  const $ = (id) => doc.getElementById(id);
  const box = $('dwrBox');
  const call = { fetchUserId, fetchDashboard, ...api };
  // data: 받은 것 { rows } · at: 받은 때 · share: 더한 업무 · me: 내 이름 · rates: 장부에서 찾은 내 참여율(src/workshare.js myRates) · adding: 더하기 줄이 열렸나
  const st = { range: 'year', id: '', data: null, at: 0, error: null, loading: false, run: null, share: { items: [], goals: {} }, me: '', rates: null, adding: false };
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
    st.rates = myRates(saved?.[BOOK_KEY], st.me);
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
   * @returns {Promise<void>}
   */
  function show({ force = false } = {}) {
    if (st.run) return st.run;
    if (!force && st.data && !st.error && now() - st.at < DWR_TTL_MS) return readBook().then(paint);
    const run = load();
    st.run = run;
    run.finally(() => { if (st.run === run) st.run = null; });
    return run;
  }

  /** 현황 탭에서만 선다. */
  function toggle(on) {
    box.classList.toggle('hidden', !on);
  }

  /** 더한 업무(items)나 줄마다의 목표(goals)를 바꿔 저장하고 다시 그린다. */
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
    ready = Promise.resolve(storage.get([USER_KEY, RANGE_KEY, OPEN_KEY, SHARE_KEY])).then((saved) => {
      if (!st.id) st.id = String(saved?.[USER_KEY] || '');
      if (RANGES[saved?.[RANGE_KEY]]) st.range = saved[RANGE_KEY];
      if (saved?.[OPEN_KEY] === false) box.open = false;
      st.share = normalizeShare(saved?.[SHARE_KEY]);
      paint();
    }, () => {});
    return ready;
  }

  return { wire, show, toggle, state: st };
}
