// 차량 탭의 KTX 조회. 조건은 기존 브릿지의 Python 조회 모듈로 보내고 결과는 읽기 전용으로 표시한다.
// 2026-11-06 사용자 정정: binjari의 필요한 조회 코드만 추출·병합하고 기존 브릿지 통로를 유지한다.
// 차량·KTX·항공권 전환은 이 파일이 맡으며 패널을 열 때의 기본은 차량이다(2026-11-05).
import { TRANSPORT_ICON } from './src/icons.js';
import { KTX_STATIONS, KORAIL_MAIN, ktxOpen } from './src/ktx.js';

export const PREF_KEY = 'ktxPref';
const DEFAULT = { from: '부산', to: '서울', adults: 1 };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const messageOf = (err) => Array.isArray(err?.problems) && err.problems.length ? err.problems.join(', ') : String(err?.message || err);
const same = (a, b) => a && b && ['from', 'to', 'date', 'hour', 'adults'].every((key) => a[key] === b[key]);

/** 패널은 입력·표시만 맡는다. 브라우저 열기는 사람이 누른 계속/코레일 열기 단추에서만 한다. */
export function createKtxBox({
  doc = document, storage = globalThis.chrome?.storage?.local, actions = null,
  when = () => ({ date: '', hour: 8 }), open = ktxOpen,
  openTab = (url) => chrome.tabs.create({ url, active: true }),
} = {}) {
  const $ = (id) => doc.getElementById(id);
  const box = $('ktxBox');
  if (!box) return { toggle() {}, invalidate() {} };
  const el = { from: $('ktxFrom'), to: $('ktxTo'), pax: $('ktxPax'), swap: $('ktxSwap'), go: $('ktxGo'),
    site: $('ktxSite'), next: $('ktxContinue'), note: $('ktxNote'), list: $('ktxList'), count: $('ktxCount') };
  const st = { rows: [], session: null, input: null, revision: 0, busy: false, opening: false, touched: false, on: false, view: 'car' };
  const viewWrap = $('carViewControl');
  for (const [view, icon] of [['car', 'car'], ['ktx', 'train'], ['flight', 'plane']]) {
    const b = viewWrap?.querySelector(`[data-view="${view}"]`);
    if (b) b.innerHTML = TRANSPORT_ICON[icon];
  }

  function paintView() {
    const ktx = st.on && st.view === 'ktx', flight = st.on && st.view === 'flight';
    if (viewWrap) {
      viewWrap.hidden = !st.on;
      for (const b of viewWrap.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === st.view));
    }
    box.hidden = !ktx;
    if ($('flightBox')) $('flightBox').hidden = !flight;
    box.closest('.app')?.classList.toggle('ktx-view', ktx);
    box.closest('.app')?.classList.toggle('flight-view', flight);
  }
  viewWrap?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-view]');
    if (!b || !['car', 'ktx', 'flight'].includes(b.dataset.view) || b.dataset.view === st.view) return;
    st.view = b.dataset.view;
    paintView();
  });

  const option = (text, value) => new doc.defaultView.Option(text, value);
  for (const select of [el.from, el.to]) for (const [name] of KTX_STATIONS) select.add(option(name, name));
  for (let n = 1; n <= 9; n++) el.pax.add(option(`${n}명`, String(n)));
  const names = new Set(KTX_STATIONS.map(([name]) => name));
  const setPref = (p) => {
    el.from.value = names.has(p.from) ? p.from : DEFAULT.from;
    el.to.value = names.has(p.to) ? p.to : DEFAULT.to;
    el.pax.value = String(Number.isInteger(p.adults) && p.adults >= 1 && p.adults <= 9 ? p.adults : DEFAULT.adults);
  };
  setPref(DEFAULT);
  Promise.resolve().then(() => storage?.get?.(PREF_KEY)).then((r) => {
    if (!st.touched && r?.[PREF_KEY]) setPref(r[PREF_KEY]);
  }).catch(() => {});
  const savePref = () => Promise.resolve().then(() => storage?.set?.({
    [PREF_KEY]: { from: el.from.value, to: el.to.value, adults: +el.pax.value },
  })).catch(() => {});
  const inputNow = () => {
    const { date, hour } = when();
    return { from: el.from.value, to: el.to.value, date, hour: +hour, adults: +el.pax.value };
  };
  const note = (text, bad = false) => { el.note.textContent = text; el.note.classList.toggle('bad', bad); };
  const seat = (label, value) => {
    if (!value) return '';
    const status = value.soldOut ? '매진' : value.price || '상태 확인 필요';
    return `<span class="ktx-seat-status${value.soldOut ? ' sold' : ''}${value.soon ? ' soon' : ''}"><span>${label}</span><b>${esc(status)}</b>${value.soon && !value.soldOut ? '<small>매진임박</small>' : ''}</span>`;
  };
  function paint() {
    el.go.disabled = st.busy || st.opening;
    el.count.textContent = st.rows.length ? String(st.rows.length) : '';
    el.next.hidden = !st.session;
    el.next.disabled = st.busy || st.opening;
    el.list.innerHTML = st.rows.map((r) => `<li class="ktx-row"><span class="ktx-time"><b>${esc(r.dep)}</b> → ${esc(r.arr)}</span>`
      + `<span class="ktx-train">${esc(r.train)} ${esc(r.no)}${r.took ? ' · ' + esc(r.took) : ''}</span>`
      + `<span class="ktx-seats">${seat('일반실', r.gen)}${seat('특실', r.spec)}</span></li>`).join('');
  }
  function invalidate() {
    if (!st.input || same(st.input, inputNow())) return;
    st.revision++;
    st.rows = [];
    st.session = null;
    st.input = null;
    paint();
    note(st.busy ? '조회 조건이 바뀌었습니다. 진행 중인 조회가 끝나면 다시 조회해 주세요.' : '조회 조건이 바뀌었습니다. 다시 조회해 주세요.');
  }

  async function search() {
    if (st.busy || st.opening) return;
    if (!actions) return note('조회 연결을 준비하지 못했습니다. 패널을 다시 열어 주세요.', true);
    st.touched = true;
    const input = inputNow();
    if (input.from === input.to) return note('출발역과 도착역이 같습니다.', true);
    savePref();
    const revision = ++st.revision;
    st.busy = true;
    st.input = input;
    st.rows = [];
    st.session = null;
    paint();
    const head = `${input.from}→${input.to} ${input.date.slice(5).replace('-', '/')} ${String(input.hour).padStart(2, '0')}시~`;
    note(`${head} · 조회 중`);
    try {
      const { record } = actions.build('ktx.search', { input });
      const result = await actions.run(record, { onStage: (stage) => { if (revision === st.revision) note(`${head} · ${stage}`); } });
      if (revision !== st.revision || !same(input, inputNow())) {
        st.rows = [];
        st.session = null;
        st.input = null;
        return note('조회 조건이 바뀌어 이전 결과를 표시하지 않았습니다. 다시 조회해 주세요.');
      }
      if (!result?.ok) return note(result?.error || 'KTX를 조회하지 못했습니다.', true);
      if (!Array.isArray(result.rows) || !result.session) return note('조회 결과 형식이 올바르지 않습니다.', true);
      st.rows = result.rows;
      st.session = result.session;
      note(st.rows.length ? `${head} · ${st.rows.length}편 — 첫 결과 목록입니다. 좌석 선택·예매는 코레일에서 진행해 주세요.` : `${head} · 표시할 열차가 없습니다. 코레일 화면에서 확인할 수 있습니다.`);
    } catch (error) {
      if (revision === st.revision) note(messageOf(error), true);
    } finally {
      st.busy = false;
      paint();
    }
  }

  el.go.addEventListener('click', search);
  for (const control of [el.from, el.to, el.pax]) {
    control.addEventListener('change', () => { st.touched = true; savePref(); invalidate(); });
    control.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  }
  el.swap.addEventListener('click', () => {
    [el.from.value, el.to.value] = [el.to.value, el.from.value];
    st.touched = true;
    savePref();
    invalidate();
  });
  // 날짜 화살표는 input 이벤트 없이 값을 바꾸므로 버블 단계에서 읽는다.
  doc.addEventListener('click', (e) => { if (e.target.closest?.('#prevDay, #nextDay, #today')) invalidate(); });
  for (const event of ['input', 'change']) doc.addEventListener(event, (e) => {
    if (['date', 'hourStart'].includes(e.target.id)) invalidate();
  });
  el.next.addEventListener('click', async () => {
    if (st.busy || st.opening || !st.session || !st.input) return;
    if (!same(st.input, inputNow())) return invalidate();
    const session = st.session;
    st.opening = true;
    paint();
    try {
      const result = await open({ session });
      if (session !== st.session) return;
      note(result?.ok ? '조회한 코레일 화면을 열었습니다. 좌석 선택·예매·결제는 직접 진행해 주세요.' : result?.error || '코레일 화면을 열지 못했습니다.', !result?.ok);
    } catch (error) {
      if (session === st.session) note(messageOf(error), true);
    } finally {
      st.opening = false;
      paint();
    }
  });
  el.site.addEventListener('click', async () => {
    try {
      await openTab(KORAIL_MAIN);
      note('코레일을 새 탭으로 열었습니다. 조회 조건은 직접 입력해 주세요.');
    } catch (error) { note(messageOf(error), true); }
  });
  paint();
  return { toggle(on) { st.on = !!on; paintView(); }, invalidate };
}
