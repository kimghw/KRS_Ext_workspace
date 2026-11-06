// 대한항공·에어부산 시간표/좌석 조회. 조회는 flight.search 기록을 거치고,
// 예약 페이지 열기는 조회했던 조건과 항공사 탭을 그대로 넘긴다(예약·결제는 항공사에서).
import { FLIGHT_AIRPORTS, AIRLINES, flightOpen } from './src/flights.js';

export const PREF_KEY = 'flightPref';
// 늘 편도 · 일반석 · 직항 · 성인 1명 · 두 항공사 — 인원·항공사 고르기는 뺐다(2026-11-05 사용자 지정: "사람수 빼고, 탭이 있으니깐 … 제거해도 되겠지?"). 항공사는 결과 탭이 가른다.
const DEFAULT = { from: 'PUS', to: 'GMP' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const messageOf = (err) => Array.isArray(err?.problems) && err.problems.length ? err.problems.join(', ') : String(err?.message || err);
const same = (a, b) => a && b && ['airline', 'from', 'to', 'date', 'hour', 'adults'].every((k) => a[k] === b[k]);
/** 항공사 자리 — AIRLINES[].logo(확장 안의 단색 SVG)를 <img> 로, alt·title 은 이름이라 글로 읽는 쪽은 그대로(2026-11-06 사용자 지정: "대한항공 부산에어 로고를 넣어줘"). 로고가 없는 항공사는 이름 글자. */
function airlineHtml(airline) {
  const a = AIRLINES[airline];
  if (!a?.logo) return esc(a?.name || airline);
  return `<img class="flight-logo" src="${esc(a.logo)}" alt="${esc(a.name)}" title="${esc(a.name)}" data-airline="${esc(airline)}" draggable="false">`;
}

/** 조회 시각은 한국 시간으로 표시한다. 없거나 잘못된 시각을 현재 시각으로 꾸미지 않는다. */
function checkedLabel(value) {
  if (value == null || value === '') return '';
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return '';
  return `${at.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} 확인`;
}

export function seatLabel(row) {
  if (row.availability === 'soldout') return '매진';
  // 좌석 수는 대한항공 운임에만 보인다(에어부산은 화면에 없다) — 없으면 수량 없이 예약 가능.
  if (row.availability === 'available') return Number.isInteger(row.seats) && row.seats > 0 ? `예약 가능 · 잔여 ${row.seats}석${row.seatsAtLeast ? ' 이상' : ''}` : '예약 가능';
  return '좌석 확인 필요';
}

/** 차량 안의 탭 전환은 ktxbox.js 가 맡는다. 이 모듈은 항공 칸의 입력·결과만 다룬다. */
export function createFlightBox({
  doc = document, storage = chrome.storage.local, actions = null,
  when = () => ({ date: '', hour: 0 }), today = () => '', open = flightOpen,
} = {}) {
  const $ = (id) => doc.getElementById(id);
  const box = $('flightBox');
  if (!box) return { invalidate() {} };
  const el = {
    from: $('flightFrom'), to: $('flightTo'),
    swap: $('flightSwap'), go: $('flightGo'), note: $('flightNote'), list: $('flightList'), count: $('flightCount'), tabs: $('flightTabs'),
  };
  /** view — 결과 탭: all(전체, 출발 시각 순) · KE · BX. 저장하지 않는다. */
  const st = { busy: false, opening: false, touched: false, input: null, results: [], view: 'all' };
  const option = (text, value) => new doc.defaultView.Option(text, value);
  for (const select of [el.from, el.to]) for (const [name, code] of FLIGHT_AIRPORTS) select.add(option(`${name} (${code})`, code));
  function setPref(p) {
    const codes = new Set(FLIGHT_AIRPORTS.map(([, code]) => code));
    el.from.value = codes.has(p.from) ? p.from : DEFAULT.from;
    el.to.value = codes.has(p.to) ? p.to : DEFAULT.to;
  }
  setPref(DEFAULT);
  Promise.resolve(storage.get(PREF_KEY)).then((r) => { if (!st.touched && r?.[PREF_KEY]) setPref({ ...DEFAULT, ...r[PREF_KEY] }); }).catch(() => {});
  const inputNow = () => {
    const { date, hour } = when();
    return { airline: 'all', from: el.from.value, to: el.to.value, date, hour: +hour, adults: 1 };
  };
  const note = (text, bad = false) => { el.note.textContent = text; el.note.classList.toggle('bad', bad); };
  const savePref = () => Promise.resolve(storage.set({ [PREF_KEY]: { from: el.from.value, to: el.to.value } })).catch(() => {});
  function busy(on) {
    st.busy = on;
    box.setAttribute('aria-busy', String(on));
    for (const control of [el.from, el.to, el.swap, el.go]) control.disabled = on;
  }

  /** 줄 하나 — 전체 탭에서는 항공사 로고를 앞에 단다. 단추의 data-provider·data-row 는 st.results 의 자리라 어느 탭에서 눌러도 같은 항공사·줄이다. */
  function rowHtml(r, provider, row, index, withAirline) {
    const name = AIRLINES[r.airline]?.name || r.airline;
    const soldout = row.availability === 'soldout';
    const available = row.availability === 'available';
    return `<li class="flight-row" data-airline="${esc(r.airline)}"><span class="flight-time"><b>${esc(row.dep)}</b> → ${esc(row.arr)}</span>`
      + `<span class="flight-number">${withAirline ? `<span class="flight-airline">${airlineHtml(r.airline)}</span> · ` : ''}${esc(row.no)}${row.fareName ? ` · ${esc(row.fareName)} 기준` : ''}</span>`
      + `<span class="flight-seat${available ? ' available' : ''}">${esc(seatLabel(row))}</span>`
      + `<button type="button" class="flight-open" data-provider="${provider}" data-row="${index}"${soldout ? ' disabled' : ''} title="${esc(name)} 예약 페이지 열기">`
      + `${row.price ? `<b>${esc(row.price)}</b>` : ''}<span>${soldout ? '매진' : available ? '예약 페이지' : '좌석 확인'}</span></button></li>`;
  }
  function providerHtml(r, provider, withRows) {
    const schedule = AIRLINES[r.airline]?.schedule;
    const checked = checkedLabel(r.checkedAt);
    const rows = r.ok && Array.isArray(r.rows) ? r.rows : [];
    const content = r.pending ? '<p class="flight-empty flight-pending">조회 중…</p>'
      : !r.ok ? `<p class="flight-empty flight-error">${esc(r.error || '항공사 화면에서 결과를 확인하지 못했습니다.')}</p>`
      : !withRows ? '' : !rows.length ? '<p class="flight-empty">조건에 맞는 항공편이 없습니다.</p>'
      : `<ul class="flight-rows">${rows.map((row, index) => rowHtml(r, provider, row, index, false)).join('')}</ul>`;
    return `<section class="flight-provider" data-airline="${esc(r.airline)}"><div class="flight-provider-head"><h3>${airlineHtml(r.airline)}</h3>`
      + `${checked ? `<span class="flight-checked">${esc(checked)}</span>` : ''}</div>${content}`
      + (r.pending ? '' : `<div class="flight-links"><button type="button" class="flight-open flight-fallback ghost" data-provider="${provider}">${r.ok ? '항공사 예약 페이지 열기' : '예약 페이지에서 확인'}</button>`
      + `${schedule ? `<a class="flight-schedule" href="${esc(schedule)}" target="_blank" rel="noopener noreferrer">공식 시간표 ↗</a>` : ''}</div>`) + '</section>';
  }

  // 결과 위의 탭 셋 — 전체(두 항공사 줄을 출발 시각 순으로 한 목록에) · 대한항공 · 에어부산(2026-11-05 사용자 지정: "전체 시간별, 대한항공, 에어부산 순으로 탭을 넣어서").
  function paint() {
    const count = st.results.reduce((n, r) => n + (r.ok && Array.isArray(r.rows) ? r.rows.length : 0), 0);
    el.count.textContent = count ? String(count) : '';
    if (el.tabs) {
      el.tabs.hidden = !st.results.length;
      for (const b of el.tabs.querySelectorAll('[data-view]')) b.setAttribute('aria-selected', String(b.dataset.view === st.view));
    }
    if (st.view !== 'all') {
      el.list.innerHTML = st.results.map((r, provider) => (r.airline === st.view ? providerHtml(r, provider, true) : '')).join('');
      return;
    }
    const merged = st.results.flatMap((r, provider) => (r.ok && Array.isArray(r.rows) ? r.rows.map((row, index) => ({ r, provider, row, index })) : []))
      .sort((a, b) => a.row.dep.localeCompare(b.row.dep) || a.row.no.localeCompare(b.row.no));
    const done = st.results.filter((r) => r.ok);
    const list = merged.length ? `<ul class="flight-rows">${merged.map(({ r, provider, row, index }) => rowHtml(r, provider, row, index, true)).join('')}</ul>`
      : done.length ? '<p class="flight-empty">조건에 맞는 항공편이 없습니다.</p>' : '';
    // 다 된 항공사는 줄로 섞이고, 그 아래 항공사마다 확인 시각·예약 페이지·공식 시간표를 둔다. 아직 조회 중이거나 실패한 항공사는 그 상태가 거기 보인다 — 실패가 줄 사이에 묻히지 않는다.
    el.list.innerHTML = list + st.results.map((r, provider) => providerHtml(r, provider, false)).join('');
  }

  function invalidate() {
    if (!st.input || same(st.input, inputNow()) || st.busy) return;
    st.results = [];
    st.input = null;
    paint();
    note('조회 조건이 바뀌었습니다. 다시 조회해 주세요.');
  }

  async function search() {
    if (st.busy || st.opening || !actions) return;
    const input = inputNow();
    if (input.from === input.to) return note('출발 공항과 도착 공항이 같습니다.', true);
    st.touched = true;
    savePref();
    st.input = { ...input };
    // 항공사마다 기록 하나를 나란히 돌린다 — 한 곳이 늦어도(에어부산이 30초를 기다리는 동안) 다른 곳의 줄은 오는 대로 그린다(2026-11-05 사용자 지정: "대한항공 조회가 좀 많이 늦어").
    const airlines = ['KE', 'BX'];
    st.results = airlines.map((airline) => ({ airline, pending: true, ok: false, rows: [] }));
    paint();
    busy(true);
    note('조회 중');
    let thrown = null;
    const settle = (airline, result) => {
      if (!same(input, inputNow())) return;
      st.results = st.results.map((r) => (r.airline === airline ? result : r));
      paint();
    };
    try {
      await Promise.all(airlines.map(async (airline) => {
        try {
          const { record } = actions.build('flight.search', { input: { ...input, airline }, preset: { today: today() } });
          const res = await actions.run(record, { onStage: (stage) => note(stage) });
          const result = Array.isArray(res?.results) ? res.results.find((r) => r.airline === airline) : null;
          settle(airline, result || { airline, ok: false, rows: [], error: res?.error || '조회 결과를 확인하지 못했습니다.' });
        } catch (err) {
          thrown = thrown || err;
          settle(airline, { airline, ok: false, rows: [], error: messageOf(err) });
        }
      }));
    } finally {
      busy(false);
    }
    if (!same(input, inputNow())) {
      st.input = null;
      st.results = [];
      paint();
      return note('조회 중 조건이 바뀌었습니다. 다시 조회해 주세요.');
    }
    if (thrown) return note(messageOf(thrown), true);
    const failed = st.results.filter((r) => !r.ok).length;
    note(`${failed ? `${failed}개 항공사 조회 확인 필요 · ` : ''}좌석과 운임은 예약 페이지에서 최종 확인해 주세요.`, failed === st.results.length);
  }

  el.go.addEventListener('click', search);
  for (const control of [el.from, el.to]) {
    control.addEventListener('change', () => { st.touched = true; savePref(); invalidate(); });
    control.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  }
  el.tabs?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-view]');
    if (!b || b.disabled || !['all', 'KE', 'BX'].includes(b.dataset.view) || b.dataset.view === st.view) return;
    st.view = b.dataset.view;
    paint();
  });
  el.swap.addEventListener('click', () => {
    [el.from.value, el.to.value] = [el.to.value, el.from.value];
    st.touched = true;
    savePref();
    invalidate();
  });
  // 공통 날짜의 화살표/오늘은 input 이벤트 없이 값을 바꾼다. 버블 단계에서 바뀐 값을 읽는다.
  doc.addEventListener('click', (e) => { if (e.target.closest?.('#prevDay, #nextDay, #today')) invalidate(); });
  for (const event of ['input', 'change']) doc.addEventListener(event, (e) => { if (['date', 'hourStart'].includes(e.target.id)) invalidate(); });
  el.list.addEventListener('click', async (e) => {
    const button = e.target.closest?.('button.flight-open');
    if (!button || button.disabled || st.busy || st.opening || !st.input) return;
    if (!same(st.input, inputNow())) return invalidate();
    const provider = st.results[+button.dataset.provider];
    if (!provider) return;
    const row = button.dataset.row == null ? undefined : provider.rows?.[+button.dataset.row];
    if (row?.availability === 'soldout') return;
    // 그 항공사의 기록과 같은 조건(airline 포함)으로 넘긴다 — 탭 핸들의 조건 비교가 기록과 맞는다.
    const input = { ...st.input, airline: provider.airline };
    st.opening = true;
    button.disabled = true;
    try {
      const result = await open({ airline: provider.airline, tabId: provider.tabId, input, row });
      if (!result?.ok) return note(result?.error || '항공사 예약 페이지를 열지 못했습니다.', true);
      note(`${AIRLINES[provider.airline]?.name || provider.airline} 예약 페이지를 열었습니다.`);
    } catch (err) {
      note(messageOf(err), true);
    } finally {
      st.opening = false;
      button.disabled = false;
    }
  });
  return { invalidate };
}
