// 차량 탭의 KTX 조회 칸(2026-11-05 사용자 지정: "여기 차량 말고 추가로 KTX 조회 하고 구매 페이지로 바로 가는 것까지 추가해줘 … 조회만 하는 기능 까지만 넣어줘,
// 구매페이지까지 들어갔으면 좋겠음"). 차량 탭에서만 선다(sidepanel.js applyMode → toggle).
//
// 출발역 · 바꾸기 · 도착역 · 인원 · 조회. 날짜와 시작 시는 탭 위의 날짜 줄·시작 시간(when())이다. 조회를 누르면 ktx.search 기록 하나를 지어 디스패처로 돌리고
// (actions/spec/ktx/search.yaml — 조회라 확인 없음), 실행기(src/ktx.js ktxSearch)가 이 확장의 코레일 뒤 탭에서 읽은 열차 줄을 그린다.
// 줄마다 출발→도착 시각 · 열차 · 소요 · 일반실/특실 단추(운임, 매진이면 잠김). 단추를 누르면 코레일 탭이 앞으로 와 그 좌석이 골라진다(ktxPick) — 예매 단추(좌석이 잡히는
// 예약)부터는 사람이 누른다. 고른 역·인원은 저장소(PREF_KEY)에 남는다. 줄은 패널을 연 동안만 있다(조회 기록은 활동 로그에).

import { KTX_STATIONS, KORAIL_MAIN, ktxPick } from './src/ktx.js';

export const PREF_KEY = 'ktxPref';
const DEFAULT = { from: '부산', to: '서울', adults: 1 };

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const messageOf = (err) => (Array.isArray(err?.problems) && err.problems.length ? err.problems.join(', ') : String(err?.message || err));
const mmdd = (date) => date.slice(5).replace('-', '/');

/**
 * @param {{ doc?: Document, storage?: object, actions?: object|null, when?: () => {date: string, hour: number}, today?: () => string,
 *   pick?: typeof ktxPick, openTab?: (url: string) => unknown }} [deps]
 */
export function createKtxBox({
  doc = document, storage = chrome.storage.local, actions = null, when = () => ({ date: '', hour: 8 }), today = () => '',
  pick = ktxPick, openTab = (url) => chrome.tabs.create({ url }),
} = {}) {
  const $ = (id) => doc.getElementById(id);
  const box = $('ktxBox');
  const el = { from: $('ktxFrom'), to: $('ktxTo'), pax: $('ktxPax'), swap: $('ktxSwap'), go: $('ktxGo'), site: $('ktxSite'), note: $('ktxNote'), list: $('ktxList'), count: $('ktxCount') };
  const st = { rows: [], tabId: null, busy: false };
  if (!box) return { toggle() {} };

  const option = (text, value) => new doc.defaultView.Option(text, value);
  for (const sel of [el.from, el.to]) for (const [name] of KTX_STATIONS) sel.add(option(name, name));
  for (let n = 1; n <= 9; n++) el.pax.add(option(`${n}명`, String(n)));
  const setPref = (p) => { el.from.value = p.from; el.to.value = p.to; el.pax.value = String(p.adults); };
  setPref(DEFAULT);
  Promise.resolve(storage.get(PREF_KEY)).then((r) => { const p = r?.[PREF_KEY]; if (p) setPref({ ...DEFAULT, ...p }); }).catch(() => {});
  const savePref = () => storage.set({ [PREF_KEY]: { from: el.from.value, to: el.to.value, adults: +el.pax.value } });

  const note = (text, bad = false) => { el.note.textContent = text; el.note.classList.toggle('bad', bad); };

  function seatButton(row, i, kind, s) {
    if (!s) return '';
    const label = kind === 'gen' ? '일반실' : '특실';
    const off = s.soldOut || !s.price;
    return `<button type="button" class="ktx-seat${s.soon ? ' soon' : ''}" data-i="${i}" data-seat="${kind}"${off ? ' disabled' : ''}`
      + ` title="${off ? `${label} 매진` : `코레일에서 ${row.dep} ${esc(row.train)} ${esc(row.no)} ${label}을 골라 둡니다 — 예매는 코레일에서`}">`
      + `<span>${label}</span><b>${off ? '매진' : esc(s.price)}</b></button>`;
  }

  function paint() {
    el.count.textContent = st.rows.length ? String(st.rows.length) : '';
    el.list.innerHTML = st.rows.map((r, i) => `<li class="ktx-row">`
      + `<span class="ktx-time"><b>${r.dep}</b> → ${r.arr}</span>`
      + `<span class="ktx-train">${esc(r.train)} ${esc(r.no)}${r.took ? ` · ${esc(r.took)}` : ''}</span>`
      + `<span class="ktx-seats">${seatButton(r, i, 'gen', r.gen)}${seatButton(r, i, 'spec', r.spec)}</span></li>`).join('');
  }

  async function search() {
    if (st.busy || !actions) return;
    const { date, hour } = when();
    const input = { from: el.from.value, to: el.to.value, date, hour: +hour, adults: +el.pax.value };
    if (input.from === input.to) return note('출발역과 도착역이 같습니다.', true);
    savePref();
    st.busy = true;
    el.go.disabled = true;
    st.rows = [];
    paint();
    const head = `${input.from}→${input.to} ${mmdd(date)} ${String(hour).padStart(2, '0')}시~`;
    try {
      const { record } = actions.build('ktx.search', { input, preset: { today: today() } });
      const res = await actions.run(record, { onStage: (s) => note(`${head} · ${s}`) });
      st.tabId = res?.tabId ?? st.tabId;
      if (!res?.ok) return note(res?.error || '조회하지 못했습니다.', true);
      st.rows = res.rows;
      paint();
      note(st.rows.length ? `${head} · ${st.rows.length}편 — 좌석을 누르면 코레일에서 골라 둡니다` : `${head} · 열차가 없습니다`);
    } catch (err) {
      note(messageOf(err), true);
    } finally {
      st.busy = false;
      el.go.disabled = false;
    }
  }

  el.go.addEventListener('click', search);
  for (const sel of [el.from, el.to, el.pax]) sel.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  el.swap.addEventListener('click', () => { [el.from.value, el.to.value] = [el.to.value, el.from.value]; savePref(); });
  el.site.addEventListener('click', () => openTab(KORAIL_MAIN));
  el.list.addEventListener('click', async (e) => {
    const btn = e.target.closest?.('button.ktx-seat');
    const row = btn && st.rows[+btn.dataset.i];
    if (!row || btn.disabled) return;
    const r = await pick({ tabId: st.tabId, row, seat: btn.dataset.seat }).catch((err) => ({ ok: false, error: messageOf(err) }));
    if (!r?.ok) return note(r?.error || '코레일 화면에서 고르지 못했습니다.', true);
    note(`코레일에서 ${row.dep} ${row.train} ${row.no} ${btn.dataset.seat === 'gen' ? '일반실' : '특실'}을 골라 두었습니다 — 예매를 누르면 좌석이 잡힙니다(로그인 필요).`);
  });

  return {
    /** 차량 탭에서만 선다. */
    toggle(on) { box.hidden = !on; },
  };
}
