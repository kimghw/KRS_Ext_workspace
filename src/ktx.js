// KTX 조회 — 코레일(www.korail.com) 승차권 예매 화면을 최소화한 창에서 열어 조회하고, 고른 열차·좌석은 그 탭을 사람의 창으로 옮겨 골라 둔다
// (2026-11-05 사용자 지정: "여기 차량 말고 추가로 KTX 조회 하고 구매 페이지로 바로 가는 것까지 … 조회만 하는 기능 까지만 넣어줘, 구매페이지까지 들어갔으면 좋겠음").
//
//   ktxSearch(input, { api, onStage })   → { ok, rows, tabId } | { ok: false, error, tabId }      행위 ktx.search 의 실행기(actions/runners/ktx.js)
//   ktxPick({ tabId, row, seat }, { api }) → { ok, error? }   그 탭을 패널의 창으로 옮겨 앞에 두고 그 줄의 좌석(일반실·특실)을 누른다 — 줄이 골라질 뿐, 예매 단추는 사람이
//   korailSearch(input, today)            결과 화면이 스스로 조회하는 조건(history.state.state.search)
//   KTX_STATIONS                          [역 이름, 코레일 역 코드] — /com/talkLiteStationInfo.do 의 이름·코드(2026-11-05 받아 맞춤)
//   injected = { pageQuery, pageRows, pagePick }   탭 안에서 도는 함수(테스트가 jsdom 에서 같은 함수를 돌린다)
//
// 조회는 사이트의 조회 단추를 누르지 않는다. 코레일 SPA 는 조회 폼이 결과 화면으로 갈 때 조건을 react-router 의 기록
// (history.push('/ticket/search/list', { search })) 에 싣고, 결과 화면은 열릴 때(새로고침 포함) 그 조건으로 스스로 조회한다(번들 1.0.221 — 간편 예매의 조건 짓기와 같은 칸).
// 그래서 코레일 화면 하나를 (최소화한 창에 — 2026-11-05 사용자 지정: "백그라운드에서 실행되도록 해줘") 연 뒤 그 탭의 기록을 결과 화면 + 조건으로 바꾸고 새로고침한다 — 사람이 결과 화면에서 F5 를 누른 것과 같다
// (binjari 2026-11-04 실측: 매크로 가드 -8002 는 조회 폼의 제출에서 나고, 결과 화면 새로고침은 SUCC). 열차 줄의 꼴은 binjari 의 검증된 파서(li.tckList ·
// .price_box — gen 이 일반실, sold_out(sold_out_soon 제외)이 매진)를 따른다.
// 사이트가 막으면(안내 모달의 CODE — -8002 매크로 · -8202 VPN·데이터센터 IP 등) 그 글을 그대로 돌려준다. 2026-11-05 이 저장소의 Azure PC(AS8075)에서는
// 조건은 결과 화면에 그대로 섰지만 -8202 로 막혔다 — 망 탓이라 확장이 고칠 수 없다.

export const KORAIL = 'https://www.korail.com';
export const KORAIL_MAIN = `${KORAIL}/ticket/main`;
const RESULT_PATH = '/ticket/search/list';
const TAB_KEY = 'ktxTab';
const WAIT_MS = 25000;
const POLL_MS = 500;
/** 빈 목록 표시가 이만큼 이어져야 '열차 없음' 으로 본다 — 조회 답이 오기 전의 빈 화면과 가른다. */
const EMPTY_SETTLE = 4;

/** KTX 가 서는 역 — 코레일 번들의 KTX 역 목록(isKtx) 코드에 사이트 역 목록의 한글 이름을 붙였다. 차례는 경부·호남·전라·경전·동해·강릉선 대략. */
export const KTX_STATIONS = [
  ['서울', '0001'], ['용산', '0104'], ['영등포', '0002'], ['행신', '0390'], ['광명', '0501'], ['수원', '0003'], ['천안아산', '0502'], ['오송', '0297'],
  ['대전', '0010'], ['서대전', '0025'], ['김천구미', '0507'], ['서대구', '0506'], ['동대구', '0015'], ['경산', '0024'], ['밀양', '0017'], ['구포', '0019'],
  ['부산', '0020'], ['경주', '0508'], ['울산(통도사)', '0509'], ['포항', '0515'], ['마산', '0059'], ['창원중앙', '0512'], ['논산', '0027'], ['익산', '0030'],
  ['정읍', '0033'], ['광주송정', '0036'], ['목포', '0041'], ['전주', '0045'], ['순천', '0051'], ['여수EXPO', '0053'], ['강릉', '0115'], ['정동진', '0262'],
];
const CODE = new Map(KTX_STATIONS);

/** YYYY-MM-DD → YYYYMMDD. */
const compact = (date) => String(date).replace(/-/g, '');

/**
 * 결과 화면이 스스로 조회하는 조건 — 사이트의 일반 승차권 폼 초기값(번들의 GENERAL 폼)에 역·날짜·시·인원을 넣은 것.
 * @param {{from: string, to: string, date: string, hour: number, adults: number}} input
 * @param {string} today 오늘(YYYY-MM-DD) — 사이트가 조회 시작 한계(limitStartDate)로 싣는다
 */
export function korailSearch({ from, to, date, hour, adults }, today) {
  const none = { txtPsgFlg_1: 0, txtPsgFlg_2: 0, txtPsgFlg_3: 0, txtPsgFlg_4: 0, txtPsgFlg_5: 0 };
  return {
    searchType: 'GENERAL', txtGoStart: from, txtGoEnd: to, txtGoStartCode: CODE.get(from), txtGoEndCode: CODE.get(to),
    recommendTravel: '', txtTrnGpCd: '109', adjStnScdlOfrFlg: 'N', adjStnScdlOfrFlg2: 'N', srtCheckYn: 'N', ebizCrossCheck: 'N', radJobId: '1',
    ...none, txtPsgFlg_1: adults, rtYn: 'N',
    txtGoAbrdDt: compact(date), txtGoHour: `${String(hour).padStart(2, '0')}0000`, txtComeAbrdDt: '', txtComeHour: '', txtWkndUseFlg: 'Y',
    spePersonnel: { ...none }, txtMenuId: '11', limitStartDate: compact(today), txtTrainNm: '전체',
  };
}

/* ------------------------------------------------------------ 탭 안에서 도는 함수 */

/** (MAIN) 지금 탭의 기록을 결과 화면 + 조건으로 바꾸고 새로고침한다. 바뀌기 전 문서의 timeOrigin 을 돌려준다 — 새 문서가 섰는지 가르는 데 쓴다. */
function pageQuery(search, path) {
  window.history.replaceState({ key: Math.random().toString(36).slice(2, 8), state: { search, isTotal: false, isDisplayOption: true } }, '', path);
  setTimeout(() => window.location.reload(), 0);
  return performance.timeOrigin;
}

/** (ISOLATED) 결과 화면을 읽는다 — 열차 줄 · 막은 안내 · 열차 없음 · 화면에 선 조건. */
function pageRows() {
  const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const shown = (el) => !!el && (el.offsetParent !== null || el.getClientRects?.().length > 0);
  // 안내 모달은 줄마다 <p> 라 textContent 로는 글이 붙는다 — innerText(없으면 textContent)로 읽고 머리(안내 메시지)·ID·확인 단추 글을 뗀다.
  const notice = [...document.querySelectorAll('.ReactModal__Content, .layerWrap')].filter(shown)
    .map((m) => String(m.innerText || m.textContent || '').replace(/\s+/g, ' ').trim())
    .find((t) => /CODE\s*:\s*-?\d+|미허가|개발자도구|비정상적인 접속|VPN|데이터센터/.test(t))
    ?.replace(/^안내\s*메[시세]지\s*/, '').replace(/\s*ID\s*:\s*[\w-]+/, '').replace(/\s*확인$/, '') || '';
  const seat = (box) => {
    if (!box) return null;
    const t = txt(box);
    const cls = ` ${box.className} `;
    const soon = /sold_out_soon/.test(cls) || /매진임박/.test(t);
    return { price: (t.match(/[\d,]+원/) || [''])[0], soldOut: (/\ssold_out\s/.test(cls) && !soon) || /매진(?!임박)/.test(t), soon };
  };
  const rows = [...document.querySelectorAll('li.tckList')].map((li) => {
    const t = txt(li);
    const time = t.match(/\((\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})\)/);
    if (!time) return null;
    const train = t.match(/(KTX(?:-산천|-이음|-청룡)?|SRT|ITX-새마을|ITX-청춘|ITX-마음|새마을호?|무궁화호?|누리로)\s*(\d+)/);
    const took = t.match(/소요시간\s*:?\s*((?:\d+\s*시간\s*)?(?:\d+\s*분)?)/);
    const boxes = [...li.querySelectorAll('.price_box')];
    const gen = boxes.find((b) => b.classList.contains('gen')) || boxes[0] || null;
    return {
      train: train ? train[1] : '', no: train ? train[2] : '', dep: time[1].padStart(5, '0'), arr: time[2].padStart(5, '0'),
      took: took ? took[1].trim() : '', gen: seat(gen), spec: seat(boxes.find((b) => b !== gen) || null),
    };
  }).filter(Boolean);
  const empty = !!document.querySelector('.tck_confirm_no-data') || /해당 스케줄에 운행하는 열차가 없습니다/.test(document.body?.textContent || '');
  const val = (id) => document.getElementById(id)?.value || '';
  return { at: performance.timeOrigin, path: location.pathname, rows, notice, empty, from: val('labelstart'), to: val('labelend'), date: val('startDate') };
}

/** (ISOLATED) 그 열차 줄(출발 시각 + 열차 번호로 찾는다)을 화면 가운데로 두고 좌석(gen 일반실 · spec 특실)의 단추를 누른다 — 사이트는 줄을 고를 뿐이다. */
function pagePick(dep, no, seat) {
  const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ');
  const depOf = (t) => (t.match(/\((\d{1,2}:\d{2})\s*~/) || ['', ''])[1].padStart(5, '0');
  const li = [...document.querySelectorAll('li.tckList')].find((x) => depOf(txt(x)) === dep && new RegExp(`\\D${no}(\\D|$)`).test(txt(x)));
  if (!li) return { ok: false, error: '코레일 화면에서 그 열차를 찾지 못했습니다 — 다시 조회해 주세요.' };
  li.scrollIntoView({ block: 'center' });
  const boxes = [...li.querySelectorAll('.price_box')];
  const gen = boxes.find((b) => b.classList.contains('gen')) || boxes[0];
  const box = seat === 'spec' ? boxes.find((b) => b !== gen) : gen;
  const a = box?.querySelector('a');
  if (!a) return { ok: false, error: '그 좌석의 단추가 없습니다.' };
  a.click();
  return { ok: true };
}

export const injected = { pageQuery, pageRows, pagePick };

/* ------------------------------------------------------------ 탭 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isKorail = (tab) => String(tab?.url || tab?.pendingUrl || '').startsWith(KORAIL);

/** 이 확장이 연 코레일 탭 — 사람이 따로 연 코레일 탭(결제 중일 수 있다)과 좌석을 골라 사람에게 넘긴 탭은 건드리지 않는다. 세션 저장소에 둔다(패널을 다시 열어도 같은 탭). */
async function ownTab(api) {
  const id = (await api.storage?.session?.get?.(TAB_KEY))?.[TAB_KEY];
  if (id == null) return null;
  try {
    const tab = await api.tabs.get(id);
    return isKorail(tab) ? tab : null;
  } catch {
    return null;   // 닫힌 탭
  }
}

/** 탭 안에서 함수 하나 — 새로고침 중이면 던진다(부르는 쪽이 다시). */
const run = async (api, tabId, func, args = [], world = 'ISOLATED') =>
  (await api.scripting.executeScript({ target: { tabId }, world, func, args }))?.[0]?.result;

/** 탭이 다 뜰 때까지(최대 ms). */
async function settled(api, tabId, ms = WAIT_MS) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const tab = await api.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('코레일 탭이 닫혔습니다.');
    if (tab.status === 'complete' && isKorail(tab)) return tab;
    await sleep(POLL_MS);
  }
  throw new Error('코레일 화면이 뜨지 않았습니다.');
}

const SAME = (a, b) => String(a || '').trim() === String(b || '').trim();

/**
 * KTX 를 조회한다 — 이 확장의 코레일 탭(없으면 최소화한 창으로 연다 — 사람의 탭 줄에 서지 않는다)에서 결과 화면을 조건으로 새로고침하고, 열차 줄이 서거나 막히거나 없다고 할 때까지 읽는다.
 * @param {{from: string, to: string, date: string, hour: number, adults: number}} input
 * @param {{ api?: typeof chrome, today?: string, onStage?: (text: string) => void }} [opts]
 */
export async function ktxSearch(input, { api = globalThis.chrome, today = input.date, onStage = () => {} } = {}) {
  if (!CODE.has(input.from) || !CODE.has(input.to)) return { ok: false, error: '코레일 역 목록에 없는 역입니다.' };
  if (input.from === input.to) return { ok: false, error: '출발역과 도착역이 같습니다.' };
  onStage('코레일 여는 중');
  let tab = await ownTab(api);
  if (!tab) {
    tab = (await api.windows.create({ url: KORAIL_MAIN, state: 'minimized' })).tabs[0];
    await api.storage?.session?.set?.({ [TAB_KEY]: tab.id });
  }
  const tabId = tab.id;
  await settled(api, tabId);
  onStage('조회 중');
  const before = await run(api, tabId, pageQuery, [korailSearch(input, today), RESULT_PATH], 'MAIN');
  const end = Date.now() + WAIT_MS;
  let empties = 0;
  while (Date.now() < end) {
    await sleep(POLL_MS);
    const page = await run(api, tabId, pageRows).catch(() => null);   // 새로고침 중에는 던진다
    if (!page || page.at === before || page.path !== RESULT_PATH) continue;
    if (page.notice) return { ok: false, error: `코레일이 조회를 막았습니다 — ${page.notice}`, tabId };
    if (!page.rows.length && !(page.empty && ++empties >= EMPTY_SETTLE)) continue;
    // 화면에 선 조건이 보낸 것과 다르면 그 줄은 다른 조회의 것이다(binjari 의 조건 검증과 같은 뜻).
    if (!SAME(page.from, input.from) || !SAME(page.to, input.to) || !page.date.startsWith(input.date)) {
      return { ok: false, error: `코레일 화면의 조건(${page.from}→${page.to} ${page.date})이 보낸 것과 다릅니다 — 다시 조회해 주세요.`, tabId };
    }
    return { ok: true, rows: page.rows, tabId };
  }
  return { ok: false, error: '코레일이 시간 안에 답하지 않았습니다 — 다시 조회해 주세요.', tabId };
}

/**
 * 고른 열차의 좌석으로 — 최소화한 창의 코레일 탭을 패널이 있는 창으로 옮겨 앞에 두고 그 줄의 좌석을 누른다(예매 단추는 사람이 — 누르면 좌석이 잡히는 예약이다).
 * 넘긴 탭은 이제 사람의 것이라(예매·결제 중일 수 있다) 잊는다 — 다음 조회는 새 창에서 한다.
 * @param {{ tabId: number, row: {dep: string, no: string}, seat: 'gen'|'spec' }} pick
 */
export async function ktxPick({ tabId, row, seat }, { api = globalThis.chrome } = {}) {
  const tab = await api.tabs.get(tabId).catch(() => null);
  if (!tab || !isKorail(tab)) return { ok: false, error: '코레일 탭이 닫혔습니다 — 다시 조회해 주세요.' };
  const win = await api.windows.getCurrent().catch(() => null);
  if (win && win.id !== tab.windowId) await api.tabs.move(tabId, { windowId: win.id, index: -1 });   // 최소화한 창은 빈 채로 닫힌다
  await api.storage?.session?.remove?.(TAB_KEY);
  await api.tabs.update(tabId, { active: true });
  await api.windows.update(win?.id ?? tab.windowId, { focused: true });
  return (await run(api, tabId, pagePick, [row.dep, row.no, seat]).catch(() => null)) || { ok: false, error: '코레일 화면을 읽지 못했습니다.' };
}
