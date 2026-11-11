// 차량 탭의 KTX. 공식 시간표를 확장 안에서 즉시 보이고, 옆 탭의 코레일에서 읽은 좌석 상태를 뒤이어 줄에 얹는다(2026-11-10 — 옆 탭에서 못 읽으면 브릿지의 전용 창).
// 2026-11-09 사용자 지정: "코레일 바로 가기 말고.. 현재 좌석정보랑 누르면 코에릴 예매정보로 가야지" — 줄을 누르면 코레일 예매 화면으로 간다(ktx.open). 좌석 선택·예매는 사람이.
// 차량·KTX·항공권 전환은 이 파일이 맡으며 패널을 열 때의 기본은 차량이다(2026-11-05).
// 말로 찾기(2026-11-06 사용자 지정: "차량 ktx 부분에도 채팅으로 조회 하는거 기능 차량이랑 동일하게 넣어줘") — 날짜 줄 아래의 말로 찾기 칸(sidepanel.js runKtxAsk)이
// KTX 보기에서는 여기의 ask(text) 로 온다: parse(src/llm.js ktxSmart)가 읽은 조각을 지금 칸 위에 얹어 역·인원은 이 칸에, 출발일·시는 날짜 줄(setWhen)에 채우고 바로 조회한다.
import { TRANSPORT_ICON } from './src/icons.js';
import { KTX_STATIONS, KTX_LIMIT, WATCH_MAX } from './src/ktx.js';

export const PREF_KEY = 'ktxPref';
const DEFAULT = { from: '부산', to: '서울', adults: 1 };
const VIA_LABEL = { cli: '로컬 CLI', api: 'API 키', local: '규칙 해석' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const messageOf = (err) => Array.isArray(err?.problems) && err.problems.length ? err.problems.join(', ') : String(err?.message || err);
const same = (a, b) => a && b && ['from', 'to', 'date', 'hour', 'adults'].every((key) => a[key] === b[key]);
/** 알림·활동 로그의 머리 — "부산→서울 11/07 09시~". */
const headOf = (input) => `${input.from}→${input.to} ${String(input.date).slice(5).replace('-', '/')} ${String(input.hour).padStart(2, '0')}시~`;

const WEEKDAY = '일월화수목금토';
/** 날을 넘긴 열차의 출발 날짜 — "11/14(토)". */
const dayLabel = (date) => `${String(date).slice(5).replace('-', '/')}(${WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()] || ''})`;
const trainNo = (no) => String(no ?? '').replace(/^0+(?=\d)/, '');
/** 살 수 있는 자리(값이 있고 매진이 아님) — src/ktx.js openSeat 와 같다. */
const openSeat = (seat) => !!seat && !seat.soldOut && !!seat.price;
/** 빈자리 대기를 둘 수 있는 줄 — 좌석을 읽었고, 살 수 있는 자리가 없고, 코레일 예약대기도 안 되는 열차. */
const watchable = (r) => /^\d{1,4}$/.test(String(r.no ?? '')) && !!(r.gen || r.spec) && !openSeat(r.gen) && !openSeat(r.spec) && !r.gen?.wait && !r.spec?.wait;

/** 자리가 났다는 알림 — 시스템 알림과 짧은 소리. 어느 쪽이 안 돼도 패널의 줄에는 남는다. */
function defaultNotify(title, message) {
  try {
    const c = globalThis.chrome;
    c?.notifications?.create?.({ type: 'basic', iconUrl: c.runtime.getURL('icons/icon128.png'), title, message, priority: 2 });
  } catch { /* 알림 권한이 없으면 소리와 줄만 */ }
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    const audio = new Ctx();
    for (const [at, freq] of [[0, 880], [0.25, 1175], [0.5, 1568]]) {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, audio.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + at + 0.22);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + at);
      osc.stop(audio.currentTime + at + 0.23);
    }
    setTimeout(() => audio.close().catch(() => {}), 1500);
  } catch { /* 소리를 못 내도 알림과 줄은 남는다 */ }
}

/**
 * 패널은 입력·표시만 맡는다. 코레일로 넘어가는 것은 사람이 줄을 눌렀을 때뿐이다.
 * parse(text, form) 은 말로 찾기의 읽는 길(src/llm.js ktxSmart — { patch, summary, via, note, costUsd }, 못 읽으면 던진다), setWhen({ date, hour }) 은 읽은 출발일·시를
 * 공통 날짜 줄에 넣는 손, onView(view) 는 차량·KTX·항공권 보기가 바뀌었다는 알림(패널이 말로 찾기 칸의 플레이스홀더를 바꾼다).
 */
export function createKtxBox({
  doc = document, storage = globalThis.chrome?.storage?.local, actions = null,
  when = () => ({ date: '', hour: 8 }),
  parse = null, setWhen = () => {}, onView = () => {}, notify = defaultNotify,
} = {}) {
  const $ = (id) => doc.getElementById(id);
  const box = $('ktxBox');
  if (!box) return { toggle() {}, invalidate() {} };
  const el = { from: $('ktxFrom'), to: $('ktxTo'), pax: $('ktxPax'), swap: $('ktxSwap'), go: $('ktxGo'),
    note: $('ktxNote'), seats: $('ktxSeatNote'), list: $('ktxList'), count: $('ktxCount'), reserve: $('ktxReserve') };
  // seats — idle: 아직 · checking: 코레일에서 읽는 중 · done: 읽음 · failed: 못 읽음. tab·session 은 좌석을 읽은 코레일 결과 탭·전용 창의 손잡이(화면을 연 동안만 든다).
  const st = { rows: [], input: null, revision: 0, busy: false, opening: false, touched: false, on: false, view: 'car', seats: 'idle', session: null, tab: null,
    // 빈자리 대기(2026-11-10) — watch: 열차 번호 → 멈춤 손잡이(AbortController), found: 자리가 난 열차 번호.
    watch: new Map(), found: new Set(), booking: false, reserveCtrl: null };
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
    if (el.reserve) el.reserve.checked = p.reserve === true;   // 자리가 나면 예약까지 — 기본 꺼짐
  };
  setPref(DEFAULT);
  Promise.resolve().then(() => storage?.get?.(PREF_KEY)).then((r) => {
    if (!st.touched && r?.[PREF_KEY]) setPref(r[PREF_KEY]);
  }).catch(() => {});
  const savePref = () => Promise.resolve().then(() => storage?.set?.({
    [PREF_KEY]: { from: el.from.value, to: el.to.value, adults: +el.pax.value, reserve: !!el.reserve?.checked },
  })).catch(() => {});
  const inputNow = () => {
    const { date, hour } = when();
    return { from: el.from.value, to: el.to.value, date, hour: +hour, adults: +el.pax.value };
  };
  const note = (text, bad = false) => { el.note.textContent = text; el.note.classList.toggle('bad', bad); };
  const seat = (label, value) => {
    if (!value) return '';
    const status = value.soldOut ? '매진' : value.price || value.note || '상태 확인 필요';
    return `<span class="ktx-seat-status${value.soldOut ? ' sold' : ''}${value.soon ? ' soon' : ''}"><span>${label}</span><b>${esc(status)}</b>${value.soon && !value.soldOut ? '<small>매진임박</small>' : ''}</span>`;
  };
  // 좌석을 읽은 줄은 일반실·특실, 아직 읽는 중이면 그렇게, 코레일 첫 화면 밖이라 못 읽은 줄은 비워 둔다(누르면 코레일에서 본다).
  const seatsOf = (r) => (r.gen || r.spec ? seat('일반실', r.gen) + seat('특실', r.spec)
    : st.seats === 'checking' ? '<span class="ktx-seat-status wait">좌석 확인 중</span>' : '');
  // 줄의 승차 날짜 — 시간표 줄은 date 를 들고, 코레일에서 읽은 줄은 조회한 날짜다. 24시간 조회라 다음 날 열차가 섞인다(2026-11-10).
  const dayOf = (r) => r.date || st.input?.date || '';
  const otherDay = (r) => !!st.input && dayOf(r) !== st.input.date;
  function paint() {
    el.go.disabled = st.busy || st.opening;
    el.count.textContent = st.rows.length ? String(st.rows.length) : '';
    // 빈자리 대기 단추는 자리가 없고 예약대기도 안 되는 줄에만 선다(기다리는 중이면 눌러서 멈춘다).
    // 자리가 있는 줄의 예약 단추 — "자리가 나면 예약까지"를 켰고 좌석을 옆 결과 탭에서 읽었을 때만(2026-11-10, 패널에서 예약을 시험하는 길).
    const bookOf = (r, i) => (el.reserve?.checked && st.seats === 'done' && Number.isInteger(st.tab) && !otherDay(r) && (openSeat(r.gen) || openSeat(r.spec))
      ? `<button type="button" class="ktx-watch ktx-book" data-book="${i}"${st.booking ? ' disabled' : ''} title="이 열차의 좌석을 코레일 결과 탭에서 잡습니다 — 결제 직전 화면까지, 결제는 직접">예약</button>` : '');
    const watchOf = (r) => {
      const no = trainNo(r.no), on = st.watch.has(no);
      if (!on && !(st.seats === 'done' && watchable(r))) return '';
      const hint = el.reserve?.checked ? '빈자리가 나면 예약까지 합니다(결제는 직접)' : '빈자리가 나면 알립니다';
      return `<button type="button" class="ktx-watch" data-no="${esc(no)}" aria-pressed="${on}" title="${on ? '빈자리 대기를 멈춥니다' : `${hint} — 5초마다 다시 읽고 24시간 뒤에 멈춥니다`}">${on ? '대기 중' : '빈자리 대기'}</button>`;
    };
    el.list.innerHTML = st.rows.map((r, i) => `<li class="ktx-row${st.found.has(trainNo(r.no)) ? ' found' : ''}"><button type="button" class="ktx-go" data-i="${i}"${st.opening ? ' disabled' : ''} title="코레일 예매 화면으로">`
      + `<span class="ktx-time">${otherDay(r) ? `<small class="ktx-day">${esc(dayLabel(dayOf(r)))}</small> ` : ''}<b>${esc(r.dep)}</b> → ${esc(r.arr)}${r.nextDay ? ' <small>다음 날</small>' : ''}</span>`
      + `<span class="ktx-train">${esc(r.train)} ${esc(r.no)}${r.took ? ' · ' + esc(r.took) : ''}</span>`
      + `<span class="ktx-seats">${seatsOf(r)}</span></button>${watchOf(r)}${bookOf(r, i)}</li>`).join('');
  }
  /** 빈자리 대기를 모두 멈춘다 — 조건이 바뀌거나 새로 조회할 때. 끝난 실행의 답은 revision 이 달라 버려진다. */
  function stopWatches() {
    for (const ctrl of st.watch.values()) ctrl.abort();
    st.watch.clear();
    st.found.clear();
  }
  function stopReservation() {
    st.reserveCtrl?.abort();
    st.reserveCtrl = null;
    st.booking = false;
  }
  const seatNote = (text = '', bad = false) => { el.seats.textContent = text; el.seats.classList.toggle('bad', bad); };
  function invalidate() {
    if (!st.input || same(st.input, inputNow())) return;
    st.revision++;
    stopWatches();
    stopReservation();
    st.rows = [];
    st.input = null;
    st.session = null;
    st.tab = null;
    st.seats = 'idle';
    seatNote();
    paint();
    note(st.busy ? '조회 조건이 바뀌었습니다. 진행 중인 조회가 끝나면 다시 조회해 주세요.' : '조회 조건이 바뀌었습니다. 다시 조회해 주세요.');
  }

  /**
   * 시간표 줄에 좌석을 얹는다 — 열차 번호로 맞춘다(코레일은 앞에 0 을 붙여 "022" 로 적는다). 코레일 화면은 조회한 날짜뿐이라 그날 줄에만 얹는다.
   * 시간표에 없는 열차(임시 운행 등)는 코레일이 보인 대로 더하고, 날짜·출발 순으로 앞의 KTX_LIMIT(10)편만 남긴다(대기 중인 열차는 남긴다).
   */
  function mergeSeats(rows) {
    const numberOf = (no) => String(no ?? '').replace(/^0+(?=\d)/, '');
    const day = st.input?.date || '';
    const seen = new Map(rows.map((r) => [numberOf(r.no), r]));
    const known = new Set(st.rows.filter((r) => !otherDay(r)).map((r) => numberOf(r.no)));
    const merged = st.rows.map((r) => {
      const found = otherDay(r) ? null : seen.get(numberOf(r.no));
      return found ? { ...r, gen: found.gen, spec: found.spec } : r;
    });
    for (const r of rows) if (!known.has(numberOf(r.no))) merged.push({ ...r, date: day });
    return merged.sort((x, y) => dayOf(x).localeCompare(dayOf(y)) || x.dep.localeCompare(y.dep))
      .filter((r, i) => i < KTX_LIMIT || st.watch.has(trainNo(r.no)));
  }

  /** 좌석 상태 읽기 — 시간표가 선 뒤에 뒤따른다. 옆 탭에서 코레일을 조회하느라 수십 초 걸릴 수 있어 기다리지 않는다. 실패해도 시간표는 그대로 둔다. */
  async function checkSeats(input, revision) {
    st.seats = 'checking';
    st.session = null;
    st.tab = null;
    seatNote('코레일에서 좌석 확인 중 — 옆 탭에서 조회합니다');
    paint();
    let result;
    try {
      const { record } = actions.build('ktx.seats', { input, by: 'ui' });
      result = await actions.run(record, { onStage: (stage) => { if (revision === st.revision && st.seats === 'checking') seatNote(stage); } });
    } catch (error) {
      result = { ok: false, error: messageOf(error) };
    }
    if (revision !== st.revision) return;
    if (result?.ok) {
      st.rows = mergeSeats(Array.isArray(result.rows) ? result.rows : []);
      st.session = result.session || null;
      st.tab = Number.isInteger(result.tabId) ? result.tabId : null;
      st.seats = 'done';
      seatNote(`코레일 첫 화면의 ${result.rows?.length || 0}편까지 좌석을 읽었습니다. 줄을 누르면 코레일로 갑니다`);
    } else {
      st.seats = 'failed';
      seatNote(`좌석을 읽지 못했습니다 — ${result?.error || '코레일 조회를 마치지 못했습니다.'}`, true);
    }
    paint();
  }

  /**
   * 빈자리 대기(ktx.watch, 2026-11-10 사용자 지정: "한번에 3개 까지. 예약대기가 안되는 경우만 … 간격은 5초, 1시간 지나면 정지 … 알림만. 패널이 열린경우만").
   * 한 번에 10편, 열차마다 24시간(2026-11-10 사용자 지정: "빈자리 대기에 적용해줘" — 한 번에 10편, 열차마다 24시간). 열차 하나에 실행 하나 — 자리가 나오거나, 24시간이 지나거나, 멈추거나, 막힐 때까지 돈다. 읽을 때마다 줄의 좌석을 새로 얹는다. 자리가 나면 알리기만 한다.
   */
  async function watch(row) {
    const no = trainNo(row.no), input = st.input, revision = st.revision;
    if (!input || st.watch.has(no)) return;
    if (st.booking) { seatNote('코레일에서 예약을 확인하고 있습니다. 예약 확인이 끝난 뒤 빈자리 대기를 시작해 주세요.'); return; }
    if (st.watch.size >= WATCH_MAX) { seatNote(`빈자리 대기는 한 번에 ${WATCH_MAX}편까지입니다. 하나를 멈춘 뒤에 눌러 주세요.`, true); return; }
    const ctrl = new (doc.defaultView?.AbortController || globalThis.AbortController)();
    const name = `${row.train} ${row.no} ${row.dep}`;
    const live = () => revision === st.revision && st.watch.get(no) === ctrl;
    // 자리가 나면 예약까지(2026-11-10) — 켠 채 누른 이 누름이 예약의 확인이다. 기록은 지금 짓고(confirmed: 지문) 자리가 나면 그 결과 탭에서 돌린다.
    let booking = null;
    if (el.reserve?.checked) {
      try { booking = actions.build('ktx.reserve', { input: { ...input, train: String(row.no), dep: row.dep, seat: 'any' }, by: 'ui' }).record; }
      catch (error) { seatNote(`예약 조건을 만들지 못해 대기하지 않았습니다 — ${messageOf(error)}`, true); return; }
    }
    st.watch.set(no, ctrl);
    st.found.delete(no);
    seatNote(`${name} 빈자리 대기 시작${booking ? '(자리가 나면 예약까지)' : ''} — 5초마다 코레일 탭을 다시 읽습니다(${st.watch.size}편 대기 중)`);
    paint();
    const onFound = booking ? ({ tabId }) => {
      if (live()) { seatNote(`${name} 빈자리가 났습니다 — 코레일에서 예약하는 중`); paint(); }
      return actions.run(booking, { confirmed: booking.hash, tabId, signal: ctrl.signal, onStage: (stage) => { if (live()) seatNote(`${name} 예약 — ${stage}`); } });
    } : null;
    let result;
    try {
      const { record } = actions.build('ktx.watch', { input: { ...input, train: String(row.no) }, by: 'ui' });
      result = await actions.run(record, {
        tabId: st.tab, signal: ctrl.signal, ...(onFound ? { onFound } : {}),
        onTick: (tick) => {
          if (!live()) return;
          if (Number.isInteger(tick.tabId)) st.tab = tick.tabId;
          if (Array.isArray(tick.rows)) st.rows = mergeSeats(tick.rows);
          seatNote(tick.paused ? `빈자리 대기 ${st.watch.size}편 — 코레일 탭을 보고 있는 동안은 쉽니다`
            : `빈자리 대기 ${st.watch.size}편 · ${tick.count}번째 확인`);
          paint();
        },
      });
    } catch (error) {
      result = { ok: false, error: messageOf(error) };
    }
    if (!live()) return;
    st.watch.delete(no);
    if (Number.isInteger(result?.tabId)) st.tab = result.tabId;
    if (Array.isArray(result?.rows)) st.rows = mergeSeats(result.rows);
    if (result?.found && result.reserve?.ok) {
      // 좌석을 잡았다 — 코레일 탭(결제 직전 화면)이 앞으로 왔다. 결제는 사람이.
      st.found.add(no);
      seatNote(`${name} — ${result.reserve.note}`);
      try { notify(`KTX 좌석 예약 — ${name}`, `${headOf(input)} ${result.reserve.seat} ${result.reserve.price} · 결제는 코레일에서 직접`.trim()); } catch { /* 알림 실패는 줄의 표시를 막지 않는다 */ }
    } else if (result?.found) {
      st.found.add(no);
      const seats = [['일반실', result.row?.gen], ['특실', result.row?.spec]].filter(([, seat]) => openSeat(seat)).map(([label, seat]) => `${label} ${seat.price}`).join(' · ');
      if (result.reserve?.manual) {
        seatNote(`${name} — 코레일에서 직접 예매 확인이 필요합니다. ${result.reserve.error || '코레일 탭의 현재 화면과 예약내역을 확인해 주세요.'}`);
        try { notify(`KTX 예매 확인 필요 — ${name}`, `${headOf(input)} ${seats} · 코레일에서 직접 예매 확인 필요`.trim()); } catch { /* 알림 실패는 줄의 표시를 막지 않는다 */ }
      } else {
        const missed = result.reserve ? ` 예약하지 못했습니다 — ${result.reserve.error || '까닭을 알 수 없습니다.'}` : '';
        const said = `${name} 빈자리가 났습니다${seats ? ` — ${seats}` : ''}.${missed} 줄을 눌러 코레일에서 예매해 주세요`;
        seatNote(said, !!result.reserve);
        try { notify(`KTX 빈자리 — ${name}`, `${headOf(input)} ${seats}${result.reserve ? ' · 예약 실패' : ''}`.trim()); } catch { /* 알림 실패는 줄의 표시를 막지 않는다 */ }
      }
    } else if (result?.ok) {
      seatNote(`${name} — ${result.note || '빈자리 대기를 멈췄습니다.'}`);
    } else {
      seatNote(`${name} 빈자리 대기를 멈췄습니다 — ${result?.error || '코레일 탭을 읽지 못했습니다.'}`, true);
    }
    paint();
  }

  /**
   * 예약 단추(ktx.reserve, 2026-11-10 사용자 지정: "사이드패널 에 있는 탭으로 해야 로그인이 된 상태에서 예약 테스트를 하지") — 자리가 있는 줄을 그 결과 탭에서 바로 예약한다.
   * 이 누름이 확인이다. 결제 직전 화면까지이고 결제는 사람이. 빈자리 대기가 같은 탭을 다시 읽고 있으면 예약하지 않는다.
   */
  async function book(row) {
    if (!row || st.booking || !st.input) return;
    if (st.watch.size) { seatNote('빈자리 대기가 같은 코레일 탭을 읽고 있습니다. 대기를 멈춘 뒤 예약해 주세요.', true); return; }
    const input = st.input, revision = st.revision, name = `${row.train} ${row.no} ${row.dep}`;
    const ctrl = new (doc.defaultView?.AbortController || globalThis.AbortController)();
    let result;
    st.booking = true;
    st.reserveCtrl = ctrl;
    seatNote(`${name} 예약 — 코레일 탭에서 좌석을 잡는 중`);
    paint();
    try {
      const { record } = actions.build('ktx.reserve', { input: { ...input, train: String(row.no), dep: row.dep, seat: 'any' }, by: 'ui' });
      result = await actions.run(record, { confirmed: record.hash, tabId: st.tab, signal: ctrl.signal,
        onStage: (stage) => { if (revision === st.revision && st.reserveCtrl === ctrl && !ctrl.signal.aborted) seatNote(`${name} 예약 — ${stage}`); } });
    } catch (error) {
      result = { ok: false, error: messageOf(error) };
    } finally {
      if (st.reserveCtrl === ctrl) {
        st.reserveCtrl = null;
        st.booking = false;
      }
    }
    if (revision !== st.revision || ctrl.signal.aborted) return;
    if (result?.ok) {
      st.found.add(trainNo(row.no));
      seatNote(`${name} — ${result.note}`);
      try { notify(`KTX 좌석 예약 — ${name}`, `${headOf(input)} ${result.seat} ${result.price} · 결제는 코레일에서 직접`.trim()); } catch { /* 알림 실패는 줄의 표시를 막지 않는다 */ }
    } else if (result?.manual) {
      seatNote(`${name} — 코레일에서 직접 예매 확인이 필요합니다. ${result.error || '코레일 탭의 현재 화면과 예약내역을 확인해 주세요.'}`);
      try { notify(`KTX 예매 확인 필요 — ${name}`, `${headOf(input)} · 코레일에서 직접 예매 확인 필요`); } catch { /* 알림 실패는 줄의 표시를 막지 않는다 */ }
    } else {
      seatNote(`${name} 예약하지 못했습니다 — ${result?.error || '까닭을 알 수 없습니다.'}`, true);
    }
    paint();
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
    stopWatches();
    stopReservation();
    st.busy = true;
    st.input = input;
    st.rows = [];
    st.session = null;
    st.tab = null;
    st.seats = 'idle';
    seatNote();
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
        st.input = null;
        const stale = '조회 조건이 바뀌어 이전 결과를 표시하지 않았습니다. 다시 조회해 주세요.';
        note(stale);
        return { ok: false, error: stale };
      }
      if (!result?.ok) return fail(result?.error || 'KTX를 조회하지 못했습니다.');
      if (!Array.isArray(result.rows)) return fail('조회 결과 형식이 올바르지 않습니다.');
      st.rows = result.rows;
      const basis = result.basis ? ` · ${result.basis} 시행 시간표` : '';
      note(st.rows.length ? `${st.rows.length}편${basis}` : `조건에 맞는 열차가 없습니다${basis}`);
      if (st.rows.length) checkSeats(input, revision);
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
   * 말로 찾기 — 흔한 조건은 즉시 읽고, 나머지는 CLI → API → 규칙 순으로 조각을 읽는다.
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
  el.reserve?.addEventListener('change', () => { st.touched = true; savePref(); paint(); });
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
  // 줄을 누르면 코레일 예매 화면으로(ktx.open) — 좌석을 읽은 결과 탭(없으면 전용 창)이 있으면 그리로, 없으면 현재 탭에 조건을 채운 예매 화면을. 좌석 선택·예매는 사람이 한다.
  el.list.addEventListener('click', async (e) => {
    const bookBtn = e.target.closest?.('.ktx-book');
    if (bookBtn) { if (actions) book(st.rows[+bookBtn.dataset.book]); return; }
    const toggle = e.target.closest?.('.ktx-watch');
    if (toggle && actions) {
      const no = toggle.dataset.no, row = st.rows.find((r) => trainNo(r.no) === no);
      if (st.watch.has(no)) st.watch.get(no).abort();   // 멈춤 — 실행이 끝나며 줄과 알림을 고친다
      else if (row) watch(row);
      return;
    }
    const go = e.target.closest?.('.ktx-go');
    if (!go || st.opening || !actions) return;
    // 다음 날 열차는 좌석을 읽은 탭(조회한 날짜)이 아니라 그 날짜·출발 시로 코레일 조건을 채운다.
    const row = st.rows[+go.dataset.i];
    const later = !!row && otherDay(row);
    st.opening = true;
    paint();
    try {
      const input = later ? { ...inputNow(), date: dayOf(row), hour: Number(String(row.dep).slice(0, 2)) || 0 } : inputNow();
      const { record } = actions.build('ktx.open', { input, by: 'ui' });
      const result = await actions.run(record, { session: later ? null : st.session, tabId: later ? null : st.tab, onStage: (stage) => note(`${headOf(input)} · ${stage}`) });
      if (result?.ok) note(result.note || '');
      else note(result?.error || '코레일 화면으로 가지 못했습니다.', true);
    } catch (error) { note(messageOf(error), true); }
    finally { st.opening = false; paint(); }
  });
  paint();
  return { toggle(on) { st.on = !!on; paintView(); }, invalidate, ask, view: () => st.view };
}
