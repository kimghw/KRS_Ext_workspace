// 공식 항공사 예약 화면에서만 읽는다. API 키·임의 재고·사전 시간표는 사용하지 않는다.
// URL 근거와 실사이트 검증 한계: docs/flights.md. DOM은 의미(편명·시각·조회 조건)로
// 읽되 조건을 확인할 수 없으면 실패로 돌린다. 실패는 매진/운항 없음이 아니다.
import { currentSiteTab } from './currenttab.js';
import { requestFlightReadRepair } from './flightrepair.js';

// logo — 패널이 결과 줄·항공사 머리에 보이는 단색 SVG(확장 루트 기준 경로, 출처는 docs/flights.md "항공사 로고"). 2026-11-06 사용자 지정: "대한항공 부산에어 로고를 넣어줘".
export const AIRLINES = Object.freeze({
  KE: { name: '대한항공', home: 'https://www.koreanair.com/booking/search?bookingType=R&hl=ko', schedule: 'https://www.koreanair.com/flight-status?isSchedule=T', logo: 'icons/airlines/ke.svg' },
  BX: { name: '에어부산', home: 'https://www.airbusan.com/web/individual/booking/domestic', schedule: 'https://www.airbusan.com/web/individual/booking/schedule', logo: 'icons/airlines/bx.svg' },
});

export const FLIGHT_AIRPORTS = [
  ['김해(부산)', 'PUS'], ['김포(서울)', 'GMP'], ['제주', 'CJU'], ['인천', 'ICN'], ['대구', 'TAE'], ['울산', 'USN'],
  ['청주', 'CJJ'], ['광주', 'KWJ'], ['여수', 'RSU'], ['진주(사천)', 'HIN'], ['포항경주', 'KPO'], ['군산', 'KUV'], ['원주', 'WJU'],
  ['도쿄(나리타)', 'NRT'], ['도쿄(하네다)', 'HND'], ['오사카(간사이)', 'KIX'], ['후쿠오카', 'FUK'], ['삿포로', 'CTS'],
  ['타이베이(타오위안)', 'TPE'], ['홍콩', 'HKG'], ['방콕(수완나품)', 'BKK'], ['다낭', 'DAD'], ['싱가포르', 'SIN'],
  ['로스앤젤레스', 'LAX'], ['뉴욕(JFK)', 'JFK'], ['파리(CDG)', 'CDG'], ['런던(히스로)', 'LHR'], ['프랑크푸르트', 'FRA'],
];

const TAB_KEY = 'flightTabs';
const WAIT_MS = 30000;
/** 화면을 읽는 간격 — 한 번 읽는 데 60ms 가 안 든다(2026-11-05 실측). */
const PAUSE_MS = 400;
/** 화면이 다 열리고도 아무 일이 없는 채 이만큼 지나면 한 번 새로고침한다. */
const RELOAD_MS = 8000;
/** 조회 단추를 찾아 누르기를 시도하는 횟수(한 번 눌리면 그만) — 대한항공은 진행 표시가 걷힐 때까지 1.5초쯤 눌리지 않는다. */
const MAX_PRESSES = 15;
/** 쿠키 안내의 "필수 쿠키만 허용"을 누르는 횟수. 눌러도 안 닫히면 그만 누르고 까닭을 알린다. */
const MAX_COOKIE_PRESSES = 2;
/** 표시 형식 복구는 검색/결과 문서마다 한 번, 조회 전체에서 두 번까지만 시도한다. */
const MAX_READ_REPAIRS = 2;
/**
 * 처음 방문한 대한항공은 쿠키 안내를 고를 때까지 본문을 숨기는데, 탭이 보이지 않으면(최소화 창) 그 안내창이 그려지지 않아 영영 멈춘다(2026-11-09 실측: 76초 동안 안 뜸, 창을 보이자 0.4초).
 * 본문이 이만큼 숨어 있으면 조회 창을 포커스 없이 보이게 하고, 그래도 숨어 있으면(다른 창에 가려 보이지 않는 것으로 친다) 앞으로 가져온다. 안내창을 닫으면 곧바로 다시 최소화한다.
 */
const HIDDEN_SHOW_MS = 5000;
const HIDDEN_FOCUS_MS = 10000;
const pending = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const koreaToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

/** UI/디스패처 밖에서 부르는 경우도 같은 조건으로 검사한다. */
export function validateFlightInput(input, today = koreaToday()) {
  if (!input || !['all', 'KE', 'BX'].includes(input.airline)) return '항공사를 선택해 주세요.';
  if (![input.from, input.to].every((code) => typeof code === 'string' && /^[A-Z]{3}$/.test(code))) return '공항은 세 글자 IATA 코드로 입력해 주세요.';
  if (input.from === input.to) return '출발 공항과 도착 공항이 같습니다.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) return '출발일을 선택해 주세요.';
  const date = new Date(`${input.date}T00:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== input.date) return '올바른 출발일을 선택해 주세요.';
  if (today && input.date < today) return '지난 날짜는 조회할 수 없습니다.';
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) return '출발 시간은 0~23시로 선택해 주세요.';
  if (!Number.isInteger(input.adults) || input.adults < 1 || input.adults > 9) return '성인 인원은 1~9명으로 선택해 주세요.';
  return '';
}

/** 공식 예약 경로의 조건. 실제 화면이 이 조건을 받아들였는지는 pageRead에서 별도로 확인한다. */
export function flightBookingUrl(airline, input) {
  if (!Object.hasOwn(AIRLINES, airline)) throw new Error('지원하지 않는 항공사입니다.');
  const error = validateFlightInput({ ...input, airline }, '');
  if (error) throw new Error(error);
  if (airline === 'KE') {
    const url = new URL(AIRLINES.KE.home);
    for (const [key, value] of Object.entries({ tripType: 'OW', departure: input.from, arrival: input.to, departureDate: input.date, adults: input.adults, children: 0, infants: 0, cabinClass: 'Y' })) url.searchParams.set(key, value);
    return url.href;
  }
  // 공식 /domestic 리다이렉트의 RT/PUS/GMP/date/GMP/PUS/date/0/1/0/0/N 구조.
  // OW 파생은 실사이트 재검증 필요. URL 자체는 조회 성공의 증거로 사용하지 않는다.
  const date = input.date.replaceAll('-', '');
  return `https://www.airbusan.com/web/individual/booking/flightsAvail/OW/${input.from}/${input.to}/${date}/${input.to}/${input.from}/${date}/0/${input.adults}/0/0/N`;
}

/** executeScript로 전달되므로 바깥 변수·함수에 의존하지 않는 읽기 전용 함수. */
function pageRead({ airline, input, submit = false, inspect = false, repairProof = null }) {
  let repaired = false;
  const result = (data) => ({ ...data, ...(repaired ? { repaired: true } : {}), at: performance.timeOrigin });
  const expected = airline === 'KE' ? 'www.koreanair.com' : 'www.airbusan.com';
  if (location.protocol !== 'https:' || location.hostname !== expected) return result({ error: '항공사 공식 화면이 아닙니다.' });
  const visibility = new WeakMap();
  const shown = (el) => {
    if (el && visibility.has(el)) return visibility.get(el);
    if (!el || el.closest('[hidden], [aria-hidden="true"]')) return false;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') { visibility.set(el, false); return false; }
    }
    visibility.set(el, true);
    return true;
  };
  const texts = new WeakMap();
  const txt = (el) => {
    if (!el) return '';
    if (texts.has(el)) return texts.get(el);
    const chunks = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.parentElement?.closest('script, style, template, noscript') && shown(node.parentElement)) chunks.push(node.textContent);
    }
    const text = chunks.join(' ').replace(/\s+/g, ' ').trim();
    texts.set(el, text);
    return text;
  };
  const body = txt(document.body);
  const head = `${document.title} ${body.slice(0, 1800)}`;
  if (/Access Denied|비정상적인 접근|접근이 제한|접속이 제한|비정상적인 접속|Access to this page has been denied/i.test(head)) return result({ error: '항공사 보안 확인 또는 접근 제한으로 조회하지 못했습니다. 예약 페이지에서 확인해 주세요.' });
  // Cloudflare 류의 확인 화면("잠시만 기다려 주세요 … 사람인지 확인")은 몇 초 뒤 스스로 지나간다 — 실패가 아니라 기다림(에어부산 첫 방문, 2026-11-05 실측).
  // "잠시만 기다려" 만으로는 잡지 않는다 — 대한항공 검색 화면의 진행 표시("진행중 잠시만 기다려 주세요")가 1.5초쯤 같은 말을 쓴다(2026-11-05 실측).
  if (/Just a moment|Checking your browser|verify you are human|사람인지\s*확인/i.test(head)) return result({ matched: false, rows: [], challenge: true, ready: document.readyState === 'complete' });
  if (!location.pathname.startsWith(airline === 'KE' ? '/booking/' : '/web/individual/booking/')) return result({ error: '항공사 예약 화면이 바뀌었습니다. 예약 페이지에서 조회해 주세요.' });

  // 주소는 사이트가 무시할 수 있다. 화면의 실제 입력값 또는 표시된 여정 요약이 모두 맞아야 한다.
  const queryControls = [];
  const value = (names) => {
    for (const name of names) {
      const elements = [...document.querySelectorAll(`[name="${name}"], [id="${name}"]`)];
      for (const el of elements) {
        if (['radio', 'checkbox'].includes(el.type) && !el.checked) continue;
        if ('value' in el && String(el.value).trim()) { queryControls.push(el); return String(el.value).trim(); }
      }
    }
    return '';
  };
  const from = value(['departure', 'depCity1', 'departureAirport']);
  const to = value(['arrival', 'arrCity1', 'arrivalAirport']);
  const date = value(['departureDate', 'depDate1']);
  const adults = value(['adults', 'paxCountAd']);
  const trip = value(['tripType']);
  const digitDate = (s) => s.replace(/\D/g, '');
  const formMatches = from === input.from && to === input.to && digitDate(date) === digitDate(input.date) && Number(adults) === input.adults && /^(OW|편도)$/i.test(trip);
  const summaries = [...document.querySelectorAll('form, header, [role="search"], [class*="summary"], [class*="Summary"], [class*="itinerary"], [class*="Itinerary"]')]
    .filter(shown).map(txt).filter((text) => text.length < 2200);
  const [year, month, day] = input.date.split('-');
  const dateRe = new RegExp(`${year}\\s*[-./년]\\s*0?${+month}\\s*[-./월]\\s*0?${+day}(?:\\D|$)`);
  const paxRe = new RegExp(`(?:성인\\s*${input.adults}\\s*명|Adults?\\s*:?\\s*${input.adults}(?:\\D|$)|${input.adults}\\s*Adults?\\b)`, 'i');
  const summaryMatches = summaries.some((text) => {
    const a = text.search(new RegExp(`\\b${input.from}\\b`));
    const b = text.search(new RegExp(`\\b${input.to}\\b`));
    return a >= 0 && b > a && dateRe.test(text) && paxRe.test(text) && /편도|one[ -]?way/i.test(text);
  });
  const contradicted = (from && from !== input.from) || (to && to !== input.to) || (date && digitDate(date) !== digitDate(input.date)) || (adults && Number(adults) !== input.adults) || (trip && !/^(OW|편도)$/i.test(trip));
  // 대한항공 KDS 위젯은 현재 값을 custom-element 속성과 접힌 달력에 보관한다.
  // 화면 폭에 따라 날짜/인원이 숨겨져도 선택된 연월일(id)을 읽어 검증한다.
  // URL이나 달력에 단순히 존재하는 날짜는 선택 조건으로 인정하지 않는다.
  // 검색 화면(/booking/search)은 .booking-gate, 결과 화면(/booking/select-flight)은 .ang-flight-widget — 같은 부품을 쓴다(2026-11-05 실측).
  const keWidget = airline === 'KE' ? document.querySelector('.ang-flight-widget, .booking-gate') : null;
  // 편도: 결과 화면은 -oneway 정렬 틀, 검색 화면은 여정 타입 라디오(bookingType=OW)가 켜져 있어야 한다.
  const keOneway = !!keWidget && (!!keWidget.querySelector('.ang-flight-widget__aligner.-oneway')
    || [...keWidget.querySelectorAll('input[name="bookingType"]')].some((radio) => radio.checked && radio.value === 'OW'));
  const keRoute = keWidget?.querySelector('kds-fromto_1[is-from-code][is-to-code]');
  const kePax = keWidget?.querySelector('kds-passenger_1[has-adult-number]');
  const keDates = [...(keWidget?.querySelectorAll('ke-kds-calendar .ui-datepicker__td.-start[id]') || [])];
  // 2026-11-11 실측: 선택 날짜 id 앞에 달력별 32자리 hex 식별자가 붙는다.
  // 예전 YYYYMMDD와 이 형식만 읽고, 선택되지 않은 날짜·주소의 날짜로 대체하지 않는다.
  const keSelectedDate = keDates.length === 1 ? keDates[0].id.match(/^(?:[a-f0-9]{32})?(\d{8})$/i)?.[1] : '';
  const keDateText = keWidget?.querySelector('[slot="from-date"]')?.textContent || '';
  const keActiveDay = document.querySelector('.flexible-date__link.-active .flexible-date__date')?.textContent;
  const keMatches = !!keWidget && keRoute?.getAttribute('is-from-code') === input.from
    && keRoute?.getAttribute('is-to-code') === input.to
    && Number(kePax?.getAttribute('has-adult-number')) === input.adults
    && kePax?.getAttribute('has-child-number') === '0' && kePax?.getAttribute('has-infant-number') === '0'
    && keOneway
    && keSelectedDate === digitDate(input.date)
    && new RegExp(`0?${+month}\\s*월\\s*0?${+day}\\s*일`).test(keDateText)
    && (!keActiveDay || Number(keActiveDay.match(/\d+/)?.[0]) === +day);
  // 복구에는 조회 위젯의 조건만 보낸다. 문서 본문·계정·쿠키·숨은 페이지 상태는 포함하지 않는다.
  // 태그 이름이 바뀌어도 의미가 명시된 속성과 실제 선택된 날짜를 수집할 수 있다.
  const repairSnapshot = () => {
    if (!keWidget || contradicted || !['/booking/search', '/booking/select-flight/departure'].includes(location.pathname)) return null;
    const selected = [...keWidget.querySelectorAll('.ui-datepicker__td.-start, [role="gridcell"][aria-selected="true"], [data-selected="true"][data-date]')];
    const checkedTrips = [...keWidget.querySelectorAll('input[name="bookingType"]')].filter((el) => el.checked).map((el) => el.value);
    const conditions = {
      routes: [...keWidget.querySelectorAll('[is-from-code][is-to-code]')].map((el) => ({ from: el.getAttribute('is-from-code'), to: el.getAttribute('is-to-code') })),
      passengers: [...keWidget.querySelectorAll('[has-adult-number]')].map((el) => ({ adults: el.getAttribute('has-adult-number'), children: el.getAttribute('has-child-number'), infants: el.getAttribute('has-infant-number') })),
      trips: checkedTrips.length ? checkedTrips : keWidget.querySelector('.ang-flight-widget__aligner.-oneway') ? ['OW'] : [],
      dates: selected.map((el) => ({ id: el.id || '', date: el.getAttribute('data-date') || '', datetime: el.getAttribute('datetime') || '', label: el.getAttribute('aria-label') || '', text: String(el.textContent || '').replace(/\s+/g, ' ').trim() })),
      dateLabels: [...keWidget.querySelectorAll('[slot="from-date"]')].map((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
      activeDay: String(keActiveDay || '').trim(),
    };
    if (Object.values(conditions).some((value) => Array.isArray(value) && value.length > 4)) return null;
    const snapshot = { version: 1, airline: 'KE', url: `${location.origin}${location.pathname}`, at: performance.timeOrigin,
      blocked: !!keWidget.closest('[inert]') || [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(shown),
      hidden: !shown(keWidget), busy: [...document.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(shown), conditions };
    return JSON.stringify(snapshot).length <= 12000 ? snapshot : null;
  };
  const snapshot = inspect || repairProof ? repairSnapshot() : null;
  // Chrome/native 메시지 직렬화는 객체 키 순서를 바꿀 수 있다. 조건 목록의 순서는 유지한다.
  const ordered = (value) => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value;
  const condition = repairProof?.condition;
  repaired = !!snapshot && !snapshot.blocked && !snapshot.hidden && !snapshot.busy
    && repairProof?.version === 1 && repairProof.airline === airline && repairProof.at === snapshot.at && repairProof.url === snapshot.url
    && repairProof.snapshotKey === JSON.stringify(ordered(snapshot))
    && condition?.from === input.from && condition.to === input.to && condition.date === input.date
    && condition.adults === input.adults && condition.trip === 'OW' && condition.children === 0 && condition.infants === 0;
  // 에어부산(2026-11-05 실측): 주소의 OW/출발/도착/날짜/…/성인 조건을 페이지가 도시 목록을 받은 뒤 숨은 formSearchParam 에 옮기고 스스로 조회한다 —
  // 누를 단추가 없다. 그 폼의 값과(있으면) 결과 머리(.nativeAvail 의 data-depcity·arrcity·depdate)가 조건과 같아야 결과로 본다.
  const bxForm = airline === 'BX' ? document.querySelector('form[name="formSearchParam"]') : null;
  const bxValue = (name) => String(bxForm?.elements[name]?.value ?? '').trim();
  const bxAvail = bxForm ? document.querySelector('.nativeAvail[data-depcity]') : null;
  const bxMatches = !!bxForm && bxValue('tripType') === 'OW' && bxValue('depCity1') === input.from && bxValue('arrCity1') === input.to
    && digitDate(bxValue('depDate1')) === digitDate(input.date) && Number(bxValue('paxCountAd')) === input.adults
    && !Number(bxValue('paxCountCh')) && !Number(bxValue('paxCountIn'))
    && (!bxAvail || (bxAvail.dataset.depcity === input.from && bxAvail.dataset.arrcity === input.to && digitDate(bxAvail.dataset.depdate || '') === digitDate(input.date)));
  const matched = !contradicted && (keWidget ? keMatches || repaired : bxForm ? bxMatches : formMatches || summaryMatches);
  if (inspect) return result({ matched, rows: [], repairSnapshot: snapshot, ready: document.readyState === 'complete' });
  if (!matched) return result({ matched: false, rows: [], ready: document.readyState === 'complete',
    ...(keWidget && !shown(keWidget) ? { hidden: true, loading: true } : {}),
    ...([...document.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(shown) ? { loading: true } : {}) });
  if ([...document.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(shown)) return result({ matched: true, rows: [], loading: true });
  // 대한항공 검색 화면은 처음 방문에서 쿠키 안내가 뜨기까지(30초쯤) 본문을 보이지 않게 둔다(2026-11-05 새 프로필 실측) — 위젯은 있어도 아직 누를 수 없다.
  if (keWidget?.matches('.booking-gate') && !shown(keWidget)) return result({ matched: true, rows: [], loading: true, hidden: true });
  // 에어부산(2026-11-05 실측): 조회가 서버 쪽에서 거절되면 알림 층(.lyPop — "AIR BUSAN" 제목 · 문구 · 에러코드)을 띄운다 — 그 문구가 까닭이다.
  // 진행 표시(.progressPopup)와 NetFunnel 대기 창(.nf-vwr-popup)은 아직 하는 중이다(대기 창은 queued).
  if (bxForm) {
    const alert = [...document.querySelectorAll('.lyPop .lyPopcont')].filter(shown).map(txt).find(Boolean);
    if (alert) return result({ error: `에어부산 안내: ${alert.replace(/\s*확인\s*$/, '').slice(0, 160)}` });
    const queued = [...document.querySelectorAll('.nf-vwr-popup')].some(shown);
    if (queued || [...document.querySelectorAll('.progressPopup')].some(shown)) return result({ matched: true, rows: [], loading: true, queued });
  }

  // 직항의 편명 하나 + 시각 둘을 포함하는 가장 작은 행을 찾는다. 여러 구간/편명은 추측하지 않는다.
  const flightsOf = (text) => [...text.matchAll(/\b(KE|BX)\s*-?\s*(\d{1,4})\b/g)].map((m) => `${m[1]}${m[2]}`);
  const timesOf = (text) => [...text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)].map((m) => `${m[1].padStart(2, '0')}:${m[2]}`);
  const nodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (!bxForm && walker.nextNode()) {
    const node = walker.currentNode;
    if (flightsOf(node.textContent).some((no) => no.startsWith(airline))) nodes.push(node.parentElement);
    if (nodes.length >= 400) break;
  }
  const candidates = new Set();
  // 현재 KE 카드의 시간 영역과 운임 영역은 형제다. 편명에서 올라가며
  // 먼저 만나는 작은 div에서 멈추면 운임을 잃으므로 카드 전체를 먼저 취한다.
  for (const el of document.querySelectorAll('li.flight-n__item')) {
    if (shown(el) && el.querySelector('[role="radiogroup"]')) candidates.add(el);
  }
  for (const start of nodes) {
    if (!shown(start) || start.closest('aside, nav, header, footer, form, [role="alert"], [role="dialog"], [role="status"], [class*="notice"], [class*="modal"], [class*="popup"]')) continue;
    let candidate = null;
    for (let el = start, depth = 0; el && depth < 8 && !['BODY', 'MAIN', 'HTML'].includes(el.tagName); el = el.parentElement, depth++) {
      const text = txt(el);
      const flights = [...new Set(flightsOf(text))];
      if (flights.length > 1 || text.length > 3500) break;
      if (flights.length !== 1 || !flights[0].startsWith(airline) || timesOf(text).length !== 2) continue;
      candidate = el;
      if (el.matches('tr, li, article, [role="row"], [role="listitem"]') || /잔여|매진|sold out|원|KRW|seats? left/i.test(text)) break;
    }
    if (candidate && shown(candidate)) candidates.add(candidate);
  }
  const rows = [];
  const seen = new Set();
  // 에어부산 결과 표: 줄마다 tr[data-flightno][data-flighttime="07:10 - 08:15"], 운임 칸(특가·실속·일반항공권 — 머리글 차례)은
  // label.nativeClsLabel(라디오 + .nativePrice "9,900") 아니면 '마감'. 잔여석 수는 화면에 없다(모형에만 있어 읽지 않는다).
  for (const tr of bxForm ? document.querySelectorAll('.nativeAvail .nativeListFlight tr[data-flightno]') : []) {
    if (!shown(tr)) continue;
    const no = (tr.dataset.flightno || '').replace(/\s+/g, '').toUpperCase();
    const [dep, arr] = timesOf(tr.dataset.flighttime || txt(tr.cells[0]));
    if (!/^BX\d{1,4}$/.test(no) || !dep || !arr || seen.has(`${no}/${dep}`)) continue;
    const heads = [...(tr.closest('table')?.querySelectorAll('thead th') || [])];
    const fares = [...tr.querySelectorAll('td.nativeFlightCls')].map((cell) => {
      const label = cell.querySelector('label.nativeClsLabel');
      const radio = label?.querySelector('input[type="radio"]');
      const amount = (label?.querySelector('.nativePrice')?.textContent || '').replace(/\D/g, '');
      const enabled = !!radio && !radio.disabled && !label.closest('.disable');
      return { closed: !label && /마감|매진/.test(txt(cell)), enabled, price: amount ? `${Number(amount).toLocaleString('ko-KR')}원` : '',
        fareName: txt(heads[cell.cellIndex]).match(/(특가|실속|일반)\s*항공권/)?.[0]?.replace(/\s+/g, '') || '' };
    });
    const offered = fares.filter((fare) => fare.enabled && fare.price).sort((a, b) => Number(a.price.replace(/\D/g, '')) - Number(b.price.replace(/\D/g, '')))[0];
    const allSold = fares.length > 0 && fares.every((fare) => fare.closed || !fare.enabled);
    rows.push({ no, dep, arr, availability: offered ? 'available' : allSold ? 'soldout' : 'unknown', seats: null, seatsAtLeast: false,
      price: offered?.price || '', ...(offered?.fareName ? { fareName: offered.fareName } : {}) });
    seen.add(`${no}/${dep}`);
  }
  for (const el of candidates) {
    const text = txt(el);
    const flightNos = [...new Set(flightsOf(text))];
    const no = flightNos[0];
    const group = el.querySelector('[role="radiogroup"]');
    const groupText = group?.getAttribute('aria-label') || '';
    const [dep, arr] = timesOf(groupText || text);
    if (!no || !dep || !arr || seen.has(`${no}/${dep}`)) continue;
    if (flightNos.length !== 1 || !no.startsWith(airline) || timesOf(groupText || text).length !== 2) continue;
    if (group && /경유|환승|\bstops?\b/i.test(groupText) && !/직항|non[ -]?stop/i.test(groupText)) continue;
    const radios = [...el.querySelectorAll('input[type="radio"], [role="radio"]')];
    if (radios.length) {
      const fares = radios.map((radio) => {
        const label = radio.labels?.[0] || radio;
        const labelText = `${txt(label)} ${radio.getAttribute('aria-label') || ''}`.trim();
        if (!shown(label) || !/일반석|economy/i.test(labelText)
          || /프레스티지|비즈니스|일등석|prestige|business|first\s*class/i.test(labelText)) return null;
        // 운임 뒤 접근성 설명에 환불 수수료가 있어 통화 접두 가격을 우선한다.
        const price = labelText.match(/(?:₩|KRW)\s*[\d,]+/i)?.[0]
          || labelText.match(/[\d,]+\s*(?:원|KRW)/i)?.[0] || '';
        const count = labelText.match(/(?:^|\s)(\d{1,2})\s*석|(?:잔여|남은)\s*(\d{1,2})\s*석|(\d{1,2})\s*seats?\s*left/i);
        const seats = count ? Number(count[1] || count[2] || count[3]) : null;
        const unavailable = /매진|미운영|sold\s*out|not\s*(?:available|operated)/i.test(labelText);
        const enabled = !radio.disabled && radio.getAttribute('aria-disabled') !== 'true' && !radio.closest('[inert]');
        return { price, seats, enabled, unavailable,
          fareName: labelText.match(/일반석\s*(?:특가|할인|정상)|economy(?:\s+\w+)?/i)?.[0] || '일반석' };
      }).filter(Boolean);
      const offered = fares.filter((fare) => fare.enabled && !fare.unavailable && fare.price
        && (fare.seats == null || fare.seats >= input.adults))
        .sort((a, b) => Number(a.price.replace(/\D/g, '')) - Number(b.price.replace(/\D/g, '')))[0];
      const allSold = fares.length > 0 && fares.every((fare) => fare.unavailable);
      rows.push({ no, dep, arr, availability: offered ? 'available' : allSold ? 'soldout' : 'unknown',
        seats: offered?.seats ?? null, seatsAtLeast: airline === 'BX' && offered?.seats >= 9,
        price: offered?.price || '', ...(offered ? { fareName: offered.fareName } : {}) });
      seen.add(`${no}/${dep}`);
      continue;
    }
    const controls = [...el.querySelectorAll('button, a, [role="button"], label')].filter(shown);
    const enabled = controls.filter((c) => !c.disabled && c.getAttribute('aria-disabled') !== 'true' && !c.querySelector('input:disabled') && !c.closest('[inert]'));
    const money = /(?:[\d,]+\s*원|KRW\s*[\d,]+|[\d,]+\s*KRW)/i;
    const sold = /매진|sold\s*out|예약\s*불가|not\s*available/i;
    const offers = enabled.filter((c) => {
      const label = `${txt(c)} ${c.getAttribute('aria-label') || ''}`;
      return money.test(label) && !sold.test(label) && !/프레스티지|비즈니스|일등석|prestige|business|first\s*class/i.test(txt(c.parentElement));
    });
    const mixedCabins = /프레스티지|비즈니스|일등석|prestige|business|first\s*class/i.test(text);
    const positive = /(?:예약\s*가능|좌석\s*있음|seats?\s*available)(?=$|[\s.,·!()])/i.test(text)
      && !/예약\s*가능\s*(여부|한\s*경우|하지|하지\s*않)|not\s*available/i.test(text);
    // 객실별 재고가 섞인 행에서는 잔여석 수를 합치거나 일반석으로 간주하지 않는다.
    const residual = mixedCabins ? null : text.match(/(?:잔여|남은)\s*(\d{1,2})\s*석|(\d{1,2})\s*seats?\s*left/i);
    const seats = residual ? Number(residual[1] || residual[2]) : null;
    const fares = controls.filter((c) => money.test(txt(c)) || sold.test(txt(c)));
    const allSold = /전석\s*매진|모든\s*(운임|좌석).*매진/i.test(text)
      || (fares.length > 0 && fares.every((c) => sold.test(txt(c))) && !/조회\s*중|loading|잔여\s*[1-9]/i.test(text))
      || (!controls.length && /(?:매진|sold\s*out)\s*$/i.test(text) && !/조회|특가|할인|대기/.test(text));
    const enough = seats == null || seats >= input.adults;
    const availability = mixedCabins ? 'unknown' : enough && (offers.length || positive || (seats != null && seats >= input.adults)) ? 'available'
      : allSold && !offers.length ? 'soldout' : 'unknown';
    const price = !mixedCabins && offers.length ? (txt(offers[0]).match(money)?.[0] || '') : '';
    rows.push({ no, dep, arr, availability, seats, seatsAtLeast: airline === 'BX' && seats >= 9, price });
    seen.add(`${no}/${dep}`);
  }
  const empty = /조회된 항공편이 없습니다|검색된 항공편이 없습니다|운항하는 항공편이 없습니다|no flights (?:are )?(?:available|found)/i.test(body)
    || (!!bxForm && [...document.querySelectorAll('.nativeRowFlightEmpty, .nativeAvailEmpty')].some(shown));
  // URL이 조건만 채우는 화면이라면 검증한 같은 폼의 조회 버튼 한 개만 누른다.
  // 경로·공항·날짜·인원·편도가 확정되지 않거나 예약/결제 버튼뿐이면 아무 동작도 하지 않는다.
  // 대한항공 검색 화면: 조건이 위젯에 다 실린 뒤 '항공편 검색' kds-button 하나 — 실제 단추는 열린 shadow root 안에 있다.
  if (submit && keWidget && (keMatches || repaired) && !rows.length && !empty) {
    const hosts = [...document.querySelectorAll('.booking-gate__button kds-button_1')].filter((host) =>
      host.getAttribute('is-disabled') !== 'true' && host.getAttribute('is-aria-disabled') !== 'true' && /^항공편\s*검색$/.test(host.textContent.replace(/\s+/g, ' ').trim()));
    // 쿠키 안내(kc-global-cookie-banner) 같은 안내창이 떠 있으면 본문이 inert 라 단추가 듣지 않는다. 쿠키 안내는 pageCookie 가 먼저 닫으므로 여기까지 온 것은 닫지 못한 안내창이다 — 알린다.
    // 안내창이 떠 있을 때만 본문이 inert 다. 진행 표시 동안의 aria-hidden 은 안내창이 아니고, 안내창 요소(kc-global-cookie-banner)는 뜨기 전에도
    // 있어(visibility 만 다르다) 그 요소로는 가리지 못한다(2026-11-05 실측) — 눌리지 않으면 다음 바퀴에 다시 본다.
    if (hosts.length === 1 && hosts[0].closest('[inert]')) return result({ matched, rows: [], blocked: true });
    const button = hosts.length === 1 && shown(hosts[0]) ? hosts[0].shadowRoot?.querySelector('button') : null;
    if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
      button.click();
      return result({ matched, rows: [], submitted: true });
    }
  }
  if (submit && formMatches && !rows.length && !empty) {
    const form = queryControls[0]?.form;
    if (form && queryControls.length === 5 && queryControls.every((control) => control.form === form)) {
      const buttons = [...form.querySelectorAll('button, input[type="submit"], [role="button"]')].filter((button) =>
        shown(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
        && /^(조회|검색|항공편\s*(조회|검색)|항공권\s*검색|search(?:\s*flights)?|find\s*flights)$/i.test(txt(button) || button.value || button.getAttribute('aria-label') || ''));
      if (buttons.length === 1) {
        buttons[0].click();
        return result({ matched, rows: [], submitted: true });
      }
    }
  }
  return result({ matched, rows, empty, ready: document.readyState === 'complete' });
}

function pageEpoch() { return performance.timeOrigin; }

/**
 * 대한항공 쿠키 안내창의 "필수 쿠키만 허용"을 누른다(2026-11-09 사용자 지정: "자동으로 눌러 줄 수 있으면 눌러줘"). 안내창이 뜬 동안은 본문이 inert 라 조회 단추가 듣지 않는다.
 * 조회에 필요한 만큼만 고른다 — "모든 쿠키 허용"·"쿠키 설정"은 누르지 않는다. 안내창 요소는 뜨기 전에도 있어(visibility 만 다르다) 보일 때만 누른다.
 */
function pageCookie() {
  if (location.protocol !== 'https:' || location.hostname !== 'www.koreanair.com') return { pressed: false };
  const root = document.querySelector('kc-global-cookie-banner')?.shadowRoot;
  const button = [...(root?.querySelectorAll('button') || [])].find((b) => /^필수\s*쿠키만\s*허용$/.test(b.textContent.trim()));
  if (!button || button.disabled || !button.getClientRects().length || getComputedStyle(button).visibility !== 'visible') return { pressed: false };
  button.click();
  return { pressed: true };
}

/** 항공편을 보이게만 한다. 선택/예약/결제 버튼을 누르지 않는다. */
function pageHighlight(row) {
  if (!row) return false;
  const normalized = (text) => String(text || '').replace(/\s+/g, '');
  const target = [...document.querySelectorAll('tr, li, article, [role="row"], [role="listitem"], div')]
    .filter((el) => normalized(el.textContent).includes(normalized(row.no)) && String(el.textContent).includes(row.dep))
    .sort((a, b) => a.textContent.length - b.textContent.length)[0];
  if (!target) return false;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

/**
 * 에어부산이 끝내 조회를 시작하지 않을 때 그 까닭을 페이지 세계(MAIN)에서 잰다 — 대기열 에이전트(agent-lib.stclab.com)가 실렸는지(nfStart),
 * 페이지의 조회 함수(BXNetFunnel_Action)가 있는지. binjari 가 코레일 차단을 닫기 전에 기록하듯 실패의 까닭을 남기는 것이고, 읽기만 한다(2026-11-05).
 */
function pageProbe() {
  const agentTag = [...document.scripts].some((script) => /stclab\.com\/.*netfunnel/i.test(script.src));
  // BXNetFunnel_Action 은 window 속성이 아니라 스크립트의 전역 선언이라 이름으로만 보인다(2026-11-05 실측) — typeof 는 없는 이름에도 안전하다.
  /* eslint-disable no-undef */
  return { agentTag, nfStart: typeof nfStart, action: typeof BXNetFunnel_Action, jquery: typeof jQuery,
    visibility: document.visibilityState, ready: document.readyState };
  /* eslint-enable no-undef */
}

export const injected = { pageRead, pageHighlight, pageEpoch, pageProbe, pageCookie };
const run = async (api, tabId, func, args = [], world = 'ISOLATED') => (await api.scripting.executeScript({ target: { tabId }, world, func, args }))?.[0]?.result;
/** 대기열 스크립트가 왜 안 도는지 한 줄 — 잴 수 없으면 빈 글. */
const probeReason = (probe) => {
  if (!probe) return '';
  if (probe.nfStart !== 'undefined') return probe.action === 'function' ? ' 대기열 스크립트는 실렸는데 조회 요청이 나가지 않았습니다(대기열 서버 응답 문제일 수 있습니다).' : ' 화면의 조회 함수가 없습니다 — 화면 구조가 바뀐 것 같습니다.';
  return probe.agentTag ? ' 대기열 스크립트(agent-lib.stclab.com)가 끝내 실리지 않았습니다 — 광고 차단 확장 등이 그 주소를 막고 있는지 봐 주세요.'
    : ' 대기열 스크립트 태그가 없습니다 — 화면 구조가 바뀐 것 같습니다.';
};
const hostOf = (airline) => new URL(AIRLINES[airline].home).hostname;
const isOfficial = (tab, airline) => {
  try { const url = new URL(tab?.url || tab?.pendingUrl); return url.protocol === 'https:' && url.hostname === hostOf(airline); } catch { return false; }
};
// 저장은 항공사별 키를 써 다른 항공사 동시 조회와 덮어쓰지 않는다.
const handleKey = (airline) => `${TAB_KEY}.${airline}`;
const getHandle = async (api, airline) => (await api.storage?.session?.get?.(handleKey(airline)))?.[handleKey(airline)];

async function searchOne(airline, input, { api, onStage, waitMs, pause, now }) {
  const bookingUrl = flightBookingUrl(airline, input);
  const base = { airline, bookingUrl, rows: [], checkedAt: null };
  if (pending.has(airline)) return { ...base, ok: false, error: '이 항공사를 이미 조회하고 있습니다. 잠시 후 다시 조회해 주세요.' };
  pending.add(airline);
  let tabId;
  let previousEpoch = null;
  let borrowed = false;
  let shownStep = 0;
  let windowId;
  // 쿠키 안내를 띄우려고 보이게 한 조회 창을 다시 내린다. 닫혔으면 그만이다.
  const hideAgain = async () => {
    if (!shownStep) return;
    shownStep = 0;
    await api.windows.update(windowId, { state: 'minimized' }).catch(() => {});
  };
  try {
    onStage(`${AIRLINES[airline].name} 조회 중`);
    const old = await getHandle(api, airline);
    const current = await currentSiteTab(AIRLINES[airline].home, { api });
    let tab = null;
    if (current) {
      const state = await run(api, current.id, pageRead, [{ airline, input }]).catch(() => null);
      if (state?.matched && !state.error) { tab = current; borrowed = true; }
    }
    if (!tab && !old?.borrowed && old?.tabId != null) tab = await api.tabs.get(old.tabId).catch(() => null);
    // 사람이 넘겨받은 탭(핸들이 지워짐)이나 다른 경로로 이동한 탭은 절대로 재조회하지 않는다.
    if (!borrowed && tab && isOfficial(tab, airline) && tab.url === old.bookingUrl) {
      previousEpoch = await run(api, tab.id, pageEpoch).catch(() => null);
      // 문서가 바뀌었는지 확인할 수 없으면 새 창을 쓴다.
      if (typeof previousEpoch === 'number') tab = await api.tabs.update(tab.id, { url: bookingUrl });
      else { tab = null; previousEpoch = null; }
    } else if (!borrowed) tab = null;
    if (!tab) {
      const win = await api.windows.create({ url: bookingUrl, state: 'minimized' });
      tab = win?.tabs?.[0];
    }
    if (!tab?.id) throw new Error('항공사 조회 창을 열지 못했습니다.');
    tabId = tab.id;
    windowId = tab.windowId;
    await api.storage?.session?.set?.({ [handleKey(airline)]: { tabId, bookingUrl, input, ...(borrowed ? { borrowed: true } : {}) } });
    const started = now();
    let end = started + waitMs;
    let last = null;
    let emptyCount = 0;
    let submitted = false;
    let presses = 0;
    let reloaded = false;
    let cookiePresses = 0;
    let repairProof = null, repairAttempts = 0, repairDisabled = false, repairError = '', recovered = false;
    let unmatchedAt = null, unmatchedReads = 0;
    const repairedDocuments = new Set();
    while (now() < end) {
      await pause(PAUSE_MS);
      tab = await api.tabs.get(tabId).catch(() => null);
      if (!tab) throw new Error('항공사 조회 창이 닫혔습니다.');
      if (tab.status !== 'complete') continue;
      if (!isOfficial(tab, airline)) throw new Error('항공사 공식 화면에서 벗어났습니다.');
      if (airline === 'KE' && cookiePresses < MAX_COOKIE_PRESSES) {
        const cookie = await run(api, tabId, pageCookie).catch(() => null);
        if (cookie?.pressed) {
          cookiePresses++;
          onStage('대한항공 쿠키 안내를 필수 쿠키만 허용으로 닫았습니다');
          await hideAgain();
          // 안내창을 기다리느라 쓴 시간은 조회 시간으로 치지 않는다.
          end = now() + waitMs;
          continue;
        }
      }
      last = await run(api, tabId, pageRead, [{ airline, input, ...(repairProof ? { repairProof } : {}) }]).catch(() => null);
      if (!last) continue;
      if (previousEpoch != null && (!Number.isFinite(last.at) || last.at === previousEpoch)) continue;
      if (last.error) throw new Error(last.error);
      // 본문이 숨어 있으면 쿠키 안내를 기다리는 것이다 — 최소화 창에서는 안내창이 그려지지 않으므로 창을 보이게 한다. 사람의 탭(borrowed)은 이미 보인다.
      if (last.hidden && !borrowed && !cookiePresses && windowId != null) {
        const hiddenFor = now() - started;
        const step = hiddenFor >= HIDDEN_FOCUS_MS ? 2 : hiddenFor >= HIDDEN_SHOW_MS ? 1 : 0;
        if (step > shownStep) {
          shownStep = step;
          onStage('대한항공 쿠키 안내를 띄우려고 조회 창을 잠깐 엽니다');
          await api.windows.update(windowId, { state: 'normal', focused: step === 2 }).catch(() => {});
          end = Math.max(end, now() + waitMs);
          continue;
        }
      }
      // 같은 문서에서 조건 읽기가 두 번 실패하면 한 번만 제한된 증거 해석을 맡긴다.
      // 화면 구조만 복구한다. 원문 페이지나 실행 코드는 보내지 않으며 조회 버튼은 기존 검증을 통과해야 누른다.
      if (airline === 'KE' && last.matched === false && last.ready && !last.loading && !last.challenge) {
        unmatchedReads = unmatchedAt === last.at ? unmatchedReads + 1 : 1;
        unmatchedAt = last.at;
        const documentKey = `${last.at}/${new URL(tab.url).pathname}`;
        if (unmatchedReads >= 2 && !repairDisabled && repairAttempts < MAX_READ_REPAIRS && !repairedDocuments.has(documentKey)) {
          const inspected = await run(api, tabId, pageRead, [{ airline, input, inspect: true }]).catch(() => null);
          const snapshot = inspected?.repairSnapshot;
          if (snapshot && snapshot.at === last.at && !snapshot.blocked && !snapshot.hidden && !snapshot.busy) {
            repairedDocuments.add(documentKey);
            repairAttempts++;
            onStage('대한항공 화면 표시를 브릿지로 다시 확인하는 중');
            const fixed = await requestFlightReadRepair(snapshot, { ...input, airline }, { api });
            if (fixed.ok && fixed.proof) {
              repairProof = fixed.proof;
              // 브릿지가 답하는 동안 선택·문서가 바뀌었으면 이 증거는 사용할 수 없다.
              last = await run(api, tabId, pageRead, [{ airline, input, repairProof }]).catch(() => null);
              if (!last) continue;
              if (previousEpoch != null && (!Number.isFinite(last.at) || last.at === previousEpoch)) continue;
              if (last.error) throw new Error(last.error);
              if (last.repaired && last.matched) { recovered = true; onStage('대한항공 조회 조건을 다시 확인했습니다'); }
              else if (!last.matched) repairError = '브릿지 확인 중 화면이 바뀌어 복구 결과를 사용하지 않았습니다.';
            } else {
              repairDisabled = true;
              repairError = fixed.error || '브릿지가 화면의 조회 조건을 확인하지 못했습니다.';
            }
          }
        }
      } else { unmatchedAt = null; unmatchedReads = 0; }
      // 화면이 다 열리고도(ready) 8초 동안 아무 일이 없으면 — 조건이 안 실렸거나, 실렸는데 조회가 시작되지 않았으면 — 한 번 새로고침한다.
      // 에어부산은 도시 목록을 받은 뒤 스스로 조회하는데 첫 방문에서 그 요청이 403 으로 막힌 적이 있고(2026-11-05 실측),
      // 대기열 스크립트(agent-lib.stclab.com)가 안 실리면 조건만 실린 채 영영 조회하지 않는다(같은 날 막아서 재현).
      if (!borrowed && !reloaded && !submitted && last.ready && !last.loading && !last.rows?.length && !last.empty && now() - started >= RELOAD_MS) {
        reloaded = true;
        presses = 0;
        await api.tabs.reload(tabId);
        continue;
      }
      if (!last.matched || last.loading) { emptyCount = 0; continue; }
      if (!last.rows?.length && !last.empty && !submitted && presses < MAX_PRESSES) {
        // 조건이 실린 바퀴에 바로 누른다. 단추가 아직 안 그려졌거나 진행 표시에 가려 있으면(대한항공은 위젯보다 단추가 늦다) 누른 셈 치지 않고 다음 바퀴에 다시.
        presses++;
        const pressed = await run(api, tabId, pageRead, [{ airline, input, submit: true, ...(repairProof ? { repairProof } : {}) }]).catch(() => null);
        if (pressed?.blocked) throw new Error(`${AIRLINES[airline].name} 화면의 안내창(쿠키 안내 등)을 닫아야 조회할 수 있습니다. 예약 페이지에서 한 번 닫은 뒤 다시 조회해 주세요.`);
        submitted = !!pressed?.submitted;
        continue;
      }
      if (!last.empty) emptyCount = 0;
      if (!last.rows?.length && !(last.empty && ++emptyCount >= 3)) continue;
      const rows = (last.rows || []).filter((row) => Number(row.dep.slice(0, 2)) >= input.hour).sort((a, b) => a.dep.localeCompare(b.dep) || a.no.localeCompare(b.no));
      return { ...base, ok: true, tabId, rows, checkedAt: new Date(now()).toISOString(), ...(recovered ? { recovered: true } : {}) };
    }
    // 에어부산이 조건만 실린 채 끝났으면 닫기 전에 까닭을 잰다(페이지 세계) — 대기열 스크립트가 실렸는지.
    const idle = airline === 'BX' && last && last.matched && !last.loading && !last.challenge;
    const probe = idle ? await run(api, tabId, pageProbe, [], 'MAIN').catch(() => null) : null;
    throw new Error(last?.challenge ? '항공사 보안 확인 화면이 끝나지 않았습니다. 예약 페이지에서 확인해 주세요.'
      : last?.queued ? `${AIRLINES[airline].name} 접속 대기열이 끝나지 않았습니다. 예약 페이지에서 확인해 주세요.`
      : last?.hidden ? '대한항공 화면이 아직 보이지 않습니다 — 처음 방문이면 쿠키 안내가 뜨기까지 기다려야 합니다. 예약 페이지에서 안내를 한 번 닫은 뒤 다시 조회해 주세요.'
      : last?.matched === false ? `항공사 화면에 출발지·도착지·날짜·인원이 반영됐는지 확인하지 못했습니다.${repairError ? ` ${repairError}` : ''} 예약 페이지에서 조건을 확인해 주세요.`
      : idle ? `에어부산 화면이 조회를 시작하지 않았습니다.${probeReason(probe) || ' 대기열 스크립트(agent-lib.stclab.com)가 막혔거나 응답이 없으면 그렇습니다.'} 예약 페이지에서 확인해 주세요.`
      : '항공편 시간표와 좌석을 읽지 못했습니다. 예약 페이지에서 확인해 주세요.');
  } catch (error) {
    return { ...base, ok: false, tabId, error: error?.message || String(error) };
  } finally {
    await hideAgain();
    pending.delete(airline);
  }
}

/** 두 항공사를 독립 조회한다. 한 곳의 차단/오류가 다른 결과를 지우지 않는다. */
export async function flightSearch(input, { api = globalThis.chrome, today = koreaToday(), onStage = () => {}, waitMs = WAIT_MS, pause = sleep, now = Date.now } = {}) {
  const error = validateFlightInput(input, today);
  if (error) return { ok: false, results: [], error };
  const airlines = input.airline === 'all' ? ['KE', 'BX'] : [input.airline];
  const results = await Promise.all(airlines.map((airline) => searchOne(airline, { ...input }, { api, onStage, waitMs, pause, now })));
  return { ok: results.some((r) => r.ok), results };
}

/** 조회 탭을 사람의 창으로 넘긴다. 닫혔거나 이미 넘긴 탭이면 같은 조건으로 새 탭을 연다. */
export async function flightOpen({ airline, tabId, input, row }, { api = globalThis.chrome } = {}) {
  if (!Object.hasOwn(AIRLINES, airline)) return { ok: false, error: '지원하지 않는 항공사입니다.' };
  try {
    const bookingUrl = flightBookingUrl(airline, input);
    const own = await getHandle(api, airline);
    const same = own && ['from', 'to', 'date', 'adults'].every((key) => own.input?.[key] === input[key]);
    const tab = same && own.tabId === tabId ? await api.tabs.get(tabId).catch(() => null) : null;
    if (!tab || !isOfficial(tab, airline)) {
      await api.tabs.create({ url: bookingUrl, active: true });
      return { ok: true, reopened: true, highlighted: false };
    }
    // 손을 넘긴 다음의 조회는 이 탭을 바꾸지 않도록, 화면을 앞에 두기 전에 소유권을 해제한다.
    await api.storage?.session?.remove?.(handleKey(airline));
    if (own.borrowed) {
      await api.tabs.update(tab.id, { active: true });
      await api.windows.update(tab.windowId, { focused: true });
      const highlighted = row ? await run(api, tab.id, pageHighlight, [row]).catch(() => false) : false;
      return { ok: true, highlighted: !!highlighted };
    }
    const win = await api.windows.getCurrent().catch(() => null);
    if (win?.id != null && win.id !== tab.windowId) await api.tabs.move(tab.id, { windowId: win.id, index: -1 });
    await api.tabs.update(tab.id, { active: true });
    await api.windows.update(win?.id ?? tab.windowId, { focused: true, state: 'normal' });
    const highlighted = row ? await run(api, tab.id, pageHighlight, [row]).catch(() => false) : false;
    return { ok: true, highlighted: !!highlighted };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}
