// 차량 탭의 KTX 조회. 조건은 기존 브릿지의 Python 조회 모듈로 보내고 결과는 읽기 전용으로 표시한다.
// 2026-11-06 사용자 정정: binjari의 필요한 조회 코드만 추출·병합하고 기존 브릿지 통로를 유지한다.
// 차량·KTX·항공권 전환은 이 파일이 맡으며 패널을 열 때의 기본은 차량이다(2026-11-05).
// 말로 찾기(2026-11-06 사용자 지정: "차량 ktx 부분에도 채팅으로 조회 하는거 기능 차량이랑 동일하게 넣어줘") — 날짜 줄 아래의 말로 찾기 칸(sidepanel.js runKtxAsk)이
// KTX 보기에서는 여기의 ask(text) 로 온다: parse(src/llm.js ktxSmart)가 읽은 조각을 지금 칸 위에 얹어 역·인원은 이 칸에, 출발일·시는 날짜 줄(setWhen)에 채우고 바로 조회한다.
import { TRANSPORT_ICON } from './src/icons.js';
import { KTX_STATIONS, KORAIL_MAIN, ktxOpen } from './src/ktx.js';

export const PREF_KEY = 'ktxPref';
const DEFAULT = { from: '부산', to: '서울', adults: 1 };
const VIA_LABEL = { cli: '로컬 CLI', api: 'API 키', local: '규칙 해석' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const messageOf = (err) => Array.isArray(err?.problems) && err.problems.length ? err.problems.join(', ') : String(err?.message || err);
const same = (a, b) => a && b && ['from', 'to', 'date', 'hour', 'adults'].every((key) => a[key] === b[key]);
/** 알림·활동 로그의 머리 — "부산→서울 11/07 09시~". */
const headOf = (input) => `${input.from}→${input.to} ${String(input.date).slice(5).replace('-', '/')} ${String(input.hour).padStart(2, '0')}시~`;

/**
 * 패널은 입력·표시만 맡는다. 브라우저 열기는 사람이 누른 계속/코레일 열기 단추에서만 한다.
 * parse(text, form) 은 말로 찾기의 읽는 길(src/llm.js ktxSmart — { patch, summary, via, note, costUsd }, 못 읽으면 던진다), setWhen({ date, hour }) 은 읽은 출발일·시를
 * 공통 날짜 줄에 넣는 손, onView(view) 는 차량·KTX·항공권 보기가 바뀌었다는 알림(패널이 말로 찾기 칸의 플레이스홀더를 바꾼다).
 */
export function createKtxBox({
  doc = document, storage = globalThis.chrome?.storage?.local, actions = null,
  when = () => ({ date: '', hour: 8 }), open = ktxOpen,
  openTab = (url) => chrome.tabs.create({ url, active: true }),
  parse = null, setWhen = () => {}, onView = () => {},
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
    onView(st.view);
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

  /**
   * 조회 — 지금 칸으로 ktx.search 기록을 지어 돌린다. 말로 찾기(ask)에서 왔으면 by llm·via 와 활동 로그 문장(text·data)을 받는다.
   * 돌려주는 { ok, rows?, error? } 는 화면의 알림(note)과 같은 내용이다 — ask 가 말로 찾기 칸에도 적는다.
   */
  async function search({ by = 'ui', via = null, text, data } = {}) {
    const fail = (error) => { note(error, true); return { ok: false, error }; };
    if (st.busy || st.opening) return { ok: false, error: '조회가 진행 중입니다.' };
    if (!actions) return fail('조회 연결을 준비하지 못했습니다. 패널을 다시 열어 주세요.');
    st.touched = true;
    const input = inputNow();
    if (input.from === input.to) return fail('출발역과 도착역이 같습니다.');
    savePref();
    const revision = ++st.revision;
    st.busy = true;
    st.input = input;
    st.rows = [];
    st.session = null;
    paint();
    const head = headOf(input);
    note(`${head} · 조회 중`);
    try {
      const { record } = actions.build('ktx.search', { input, by, via });
      const result = await actions.run(record, {
        onStage: (stage) => { if (revision === st.revision) note(`${head} · ${stage}`); },
        ...(text ? { text } : {}), ...(data ? { data } : {}),
      });
      if (revision !== st.revision || !same(input, inputNow())) {
        st.rows = [];
        st.session = null;
        st.input = null;
        const stale = '조회 조건이 바뀌어 이전 결과를 표시하지 않았습니다. 다시 조회해 주세요.';
        note(stale);
        return { ok: false, error: stale };
      }
      if (!result?.ok) return fail(result?.error || 'KTX를 조회하지 못했습니다.');
      if (!Array.isArray(result.rows) || !result.session) return fail('조회 결과 형식이 올바르지 않습니다.');
      st.rows = result.rows;
      st.session = result.session;
      note(st.rows.length ? `${head} · ${st.rows.length}편 — 첫 결과 목록입니다. 좌석 선택·예매는 코레일에서 진행해 주세요.` : `${head} · 표시할 열차가 없습니다. 코레일 화면에서 확인할 수 있습니다.`);
      return { ok: true, rows: st.rows.length };
    } catch (error) {
      if (revision === st.revision) note(messageOf(error), true);
      return { ok: false, error: messageOf(error) };
    } finally {
      st.busy = false;
      paint();
    }
  }

  /**
   * 말로 찾기(2026-11-06 사용자 지정: "차량 ktx 부분에도 채팅으로 조회 하는거 기능 차량이랑 동일하게 넣어줘") — 말을 조각으로 읽어(parse: 로컬 CLI → API 키 → 규칙 해석)
   * 지금 칸 위에 얹고, 역·인원은 이 칸에, 출발일·시는 날짜 줄(setWhen)에 채운 뒤 바로 조회한다(기록은 by llm — 활동 로그에 말과 길이 남는다).
   * 읽은 것이 하나도 없으면 parse 가 던진다 — 채우지도 조회하지도 않는다. 돌려주는 것은 말로 찾기 칸의 알림에 적을 것(읽은 조각 read · 조회한 조건 head · 조회 결과).
   * @returns {Promise<{via: string, read: string, head: string, ok: boolean, rows?: number, error?: string, note?: string, costUsd?: number}>}
   */
  async function ask(text) {
    if (typeof parse !== 'function') throw new Error('말로 찾기를 쓸 수 없습니다.');
    if (st.busy || st.opening) throw new Error('조회가 끝난 뒤에 다시 적어 주세요.');
    const before = inputNow();
    const r = await parse(text, before);
    const patch = r?.patch || {};
    const next = { ...before, ...patch };
    if (patch.from) el.from.value = next.from;
    if (patch.to) el.to.value = next.to;
    if (patch.adults) el.pax.value = String(next.adults);
    st.touched = true;
    savePref();
    if (patch.date != null || patch.hour != null) setWhen({ date: next.date, hour: next.hour });
    invalidate();
    const via = VIA_LABEL[r.via] || r.via;
    const head = `${headOf(next)} ${next.adults}명`;
    const result = await search({ by: 'llm', via: r.via, text: `"${text}" → [${via}] KTX ${head}`, data: { via: r.via, costUsd: r.costUsd } });
    return { via: r.via, read: r.summary, head, note: r.note, costUsd: r.costUsd, ...result };
  }

  el.go.addEventListener('click', () => search());
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
  return { toggle(on) { st.on = !!on; paintView(); }, invalidate, ask, view: () => st.view };
}
