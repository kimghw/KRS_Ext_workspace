// 메일 탭(회신 추적)의 화면. 내가 보낸 메일을 골라 등록하면 받는 사람(To — 참조는 추적하지 않는다, 2026-10-15 사용자 지정)을 도메인(내 도메인은 주소)마다
// "받을 곳" 으로 세우고, 받은 메일에서 회신을 찾아 이어 N/M 으로 센다. 찾기·잇기·저장·병합은 sync(mailtrack/sync.js)가 하고 여기는 그것을 화면에 잇기만 한다.
//
//   머리(연결 칩 · 새로고침 · 등록 + · 마지막 갱신 · 진행 중/완료) → 등록 대화(보낸 메일 고르기) → 목록(메일마다 N/M 배지와 받을 곳 칩)
//   → 상세(보낸 메일 머리·그 첨부·회신 현황이 한 카드, 추적 끝내기는 회신 현황 옆 · 받을 곳 표 · 회신(수락·거부) · 양식 병합 · 모두 zip · 등록 지우기) → 메일 설정(접힌 칸)
//   보낸 메일 머리 바로 아래에 그 첨부, 그 다음에 수신처별 회신 — 2026-10-16 사용자 지정 "보낸메일, 보낸 메일 첨부가 있어야 하고 그 다음 수신처별 회신".
//   첨부는 회신 현황(진행률) 위, 같은 카드 안에 두고 보낸 메일·받은 회신 머리에 보낸/받은 아이콘 — 2026-10-17 사용자 지정 "첨부파일은 회신 현황 위로 빼고 … 보낸/받은 아이콘을 붙여줘".
//   MCP 주소·내 메일 주소·연결 확인은 connRoot(패널 설정의 연결 갈래 — 2026-10-16 사용자 지정 "연결에는 mcp 서버 내용")가 있으면 거기에 그린다(connTemplate).
//   목록 줄마다 오른쪽 아래 "지우기"(두 번 눌러 확인) — 2026-10-15 사용자 지정 "종료 기능이 없네" · "등록한 메일을 취소하는 기능이 안보임": 접힌 칸에 숨기지 않는다.
// 회신 확인(2026-10-15 사용자 지정 "받은거 accept 할지 거부할지"): 새로 이어진 회신은 "확인 필요" 로 서고 머리·목록에 그 수를 보인다. 수락하면 세고(받을 곳 완료),
// 거부하면 세지 않아 받을 곳은 다시 기다림이 되며 병합 칸에서도 빠진다(잠긴 줄). 설정 requireAccept 를 켜면 회신이 와도 수락해야 센다.
//
// 2026-10-15 사용자 지정: "내가 보낸 메일에서 받는사람 참조자 또는 메일주소가 도메인이 같은 경우 이를 식별해서 등록 … 같은 도메인 메일 수신이
// 보낸 거랑 같으면 완료하는데 이 숫자를 관리 … 메일 내용과 첨부파일을 한 곳에 관리 … docx 파일이나 excel 양식으로 작성을 요청한 경우 받아서 병합까지".
//
// sync 는 주입받는다 — 이 파일은 sync·장부·금고·MCP 어댑터를 import 하지 않는다. test/wiring.test.mjs 가 sidepanel.js 를 jsdom 에서 통째로
// import 하므로 import·생성·wire() 시점에는 chrome·indexedDB·fetch 를 건드리지 않는다(장부는 show() 에서 읽는다).
// 메일 본문(HTML)은 태그를 떼어 글자로만 보인다 — 메일에서 온 HTML 을 innerHTML 에 넣지 않고, 메일에서 온 글은 모두 escape 하거나 textContent 로 넣는다.

import { buildZip } from '../src/zip.js';

/** 지우기 버튼은 두 번 누른다 — 처음 누르면 이만큼 동안 "한 번 더 누르면 지웁니다" 로 바뀌고, 그 안에 다시 누르면 지운다(rndpanel.js 와 같은 방식). */
const CONFIRM_MS = 3000;
/** 머리의 "마지막 갱신 n분 전" 을 이만큼마다 다시 쓴다 — 탭이 보일 때만. */
const TICK_MS = 30_000;
/** 등록 대화·설정의 보낸 메일 기간(일). */
const DAY_CHOICES = [7, 14, 30, 60];
/** mcp/outlook.js 의 MCP_URL_DEFAULT 와 같은 값 — 그 파일을 import 하지 않으려고 따로 둔다(병렬 작업·wiring 안전). */
const MCP_URL_DEFAULT = 'http://localhost:5001/mcp';
/** 장부가 아직 없을 때 화면이 기대는 설정 기본값(model.js 의 DEFAULTS 와 같은 뜻). */
const SETTINGS_FALLBACK = { mcpUrl: MCP_URL_DEFAULT, userEmail: '', sentDays: 30, windowDays: 90, ownByAddress: true, useHeaders: false, autoRefreshMin: 10, requireAccept: false };
const EXPECT_STATES = ['open', 'done', 'excluded'];
const STATE_TEXT = { open: '기다림', done: '완료', excluded: '제외' };
/** 회신의 확인 상태(model.js REVIEW_STATES 와 같은 값 — import 하지 않는다) — 칩 글과 풀이. */
const REVIEW_STATES = ['pending', 'accepted', 'rejected'];
const REVIEW_TEXT = { pending: '확인 필요', accepted: '수락', rejected: '거부' };
const REVIEW_TIP = { pending: '새로 이어진 회신 — 수락하거나 거부해 주세요', accepted: '받은 것으로 친 회신', rejected: '받은 것으로 치지 않은 회신 — 받을 곳은 다시 기다립니다' };
/** 메일 보안(block@krs.co.kr)이 붙잡아 둔 회신(block.js) — 알림에서 보낸 사람·제목을 읽어 이은 것이라 본문은 알림이고 첨부는 아직 없다. */
const HELD_TIP = '메일 보안(block@krs.co.kr)이 인증을 기다리며 붙잡아 둔 회신입니다 — 알림 메일에서 보낸 사람·제목을 읽어 이었습니다. Outlook에서 알림을 열어 [수신]을 누르면 원 메일이 받은 편지함에 오고, 새로고침이 본문·첨부와 함께 따로 잇습니다';
const MIME_ZIP = 'application/zip';
/**
 * 양식 갈래마다 병합하지 못하는 같은 집안의 형식 — 옛 이진 형식(.xls·.doc)과 매크로·서식 파일(ooxml/merge.js mergeKind 가 받지 않는 것).
 * 병합 칸에 잠근 줄로 보인다(2026-10-15 통합 때 더함 — 회신이 왔는데 병합 칸에 없으면 까닭을 알 수 없었다).
 */
const UNSUPPORTED = { xlsx: /\.(xls|xlsm|xlsb|xltx|xltm)$/i, docx: /\.(doc|docm|dotx|dotm)$/i };

/**
 * @param {{ root?: HTMLElement, connRoot?: HTMLElement|null, $: (id:string) => HTMLElement|null, escapeHtml?: (v:any) => string,
 *   logEvent?: (kind:string, ok:boolean, text:string, data?:object) => void, sync: object,
 *   flash?: (btn:HTMLElement, text:string, ms?:number) => void,
 *   download?: (file:{ name:string, bytes:Uint8Array, mime:string }) => Promise<void>,
 *   openTab?: (url:string) => any, copyText?: (text:string) => Promise<boolean>, now?: () => number, confirmMs?: number }} deps
 *   root 은 sidepanel.html 의 <section id="mail" class="mail hidden"> — 화면 조각은 전부 이 안에 만든다(id·class 는 mt 접두).
 *   sync 는 mailtrack/sync.js createSync 의 것(검사에서는 흉내). download 는 {name, bytes, mime} 하나를 받는다.
 *   connRoot 은 (있으면) MCP 주소·내 메일 주소·연결 확인을 그릴 다른 칸 — 패널 설정의 연결 갈래(sidepanel.html #connOutlook). 없으면 메일 설정 칸 맨 위에 그린다.
 */
export function createMailPanel({
  root, $, escapeHtml, logEvent, sync, connRoot = null, flash = () => {}, download = defaultDownload,
  openTab = (url) => chrome.tabs.create({ url }), copyText = defaultCopy, now = () => Date.now(), confirmMs = CONFIRM_MS,
} = {}) {
  if (!sync) throw new Error('createMailPanel: sync 가 필요합니다');
  const host = root || (typeof $ === 'function' ? $('mail') : null) || globalThis.document?.createElement('section');
  if (!host) throw new Error('createMailPanel: #mail 칸이 없습니다');
  const doc = host.ownerDocument;
  const esc = typeof escapeHtml === 'function' ? escapeHtml : escText;
  const log = typeof logEvent === 'function' ? logEvent : () => {};

  host.innerHTML = TEMPLATE;
  // MCP 주소·내 메일 주소·연결 확인(connTemplate) — 패널 설정의 연결 갈래(connRoot)가 있으면 거기에(상태 칩·로그인 열기·알림 줄을 따로 두고) 메일 설정 칸에는
  // 안내 한 줄만, 없으면 메일 설정 칸 맨 위에(칩·알림 줄은 머리와 메일 설정의 것을 같이 쓴다).
  const connHost = connRoot || null;
  if (connHost) connHost.innerHTML = connTemplate({ standalone: true });
  host.querySelector('#mtSetBody').insertAdjacentHTML('afterbegin', connHost ? CONN_NOTE : connTemplate({ standalone: false }));
  const q = (id) => host.querySelector(`#${id}`) || (connHost ? connHost.querySelector(`#${id}`) : null);
  const el = {
    state: q('mtState'), auth: q('mtAuth'), refresh: q('mtRefresh'), register: q('mtRegister'), summary: q('mtSummary'), stamp: q('mtStamp'), msg: q('mtMsg'),
    reg: q('mtReg'), regDays: q('mtRegDays'), regQ: q('mtRegQ'), regList: q('mtRegList'), regMsg: q('mtRegMsg'), regGo: q('mtRegGo'), regCancel: q('mtRegCancel'),
    listBox: q('mtListBox'), list: q('mtList'), empty: q('mtEmpty'),
    detail: q('mtDetail'), back: q('mtBack'), header: q('mtHeader'), status: q('mtStatus'), progress: q('mtProgress'), expect: q('mtExpect'),
    sent: q('mtSent'), sentBody: q('mtSentBody'), sentText: q('mtSentText'), sentAtts: q('mtSentAtts'),
    replies: q('mtReplies'), replyCount: q('mtReplyCount'),
    merge: q('mtMerge'), mergeTpl: q('mtMergeTpl'), mergeFiles: q('mtMergeFiles'), mergeHdrRow: q('mtMergeHdrRow'), mergeHdr: q('mtMergeHdr'),
    mergeModeRow: q('mtMergeModeRow'), mergeMode: q('mtMergeMode'), mergeGo: q('mtMergeGo'), mergeReport: q('mtMergeReport'),
    allZip: q('mtAllZip'), close: q('mtClose'), remove: q('mtRemove'),
    settings: q('mtSettings'), setState: q('mtSetState'), url: q('mtUrl'), userEmail: q('mtUserEmail'), sentDays: q('mtSentDays'),
    windowDays: q('mtWindowDays'), autoMin: q('mtAutoMin'), ownByAddress: q('mtOwnByAddress'), useHeaders: q('mtUseHeaders'), requireAccept: q('mtRequireAccept'),
    probe: q('mtProbe'), setMsg: q('mtSetMsg'),
    // 연결 갈래에 그렸을 때만 있는 것 — 없으면 머리 칩(mtState)·머리의 열기(mtAuth)·메일 설정의 알림 줄(mtSetMsg)이 그 몫을 한다.
    connState: q('mtConnState'), connAuth: q('mtConnAuth'), connMsg: q('mtConnMsg') || q('mtSetMsg'),
  };

  const st = {
    wired: false, shown: false, book: null,
    // 연결 칩 — state: idle·checking·ok·offline·auth·notool·error, authUrl 은 로그인 창 주소(auth 일 때만). probe 는 마지막 확인 결과.
    conn: { state: 'idle', text: '', authUrl: '' }, probe: null, probeFail: '', probeRun: null, refreshRun: null, bg: null, tick: null,
    // 보는 곳 — 목록(list) 또는 상세(detail, itemId).
    view: 'list', itemId: null,
    // 상세에서 펼친 것(보낸 메일 머리의 받는 사람 칸 metaOpen · 본문 sentOpen · 회신 openBodies), 금고에서 읽어 둔 본문·첨부(cache — 지금 보는 메일 것만), 서버에 저장한 경로(paths).
    metaOpen: false, sentOpen: false, openBodies: new Set(), cache: null, paths: {},
    // 병합 — 고른 양식(첨부 id), 사람이 끈 회신 첨부(`${messageId}\u0001${attachmentId}` — 새로 온 것은 켜진 채로 선다), 도는 중인가.
    mergeTpl: '', mergeOff: new Set(), merging: false,
    // 등록 대화 — 열렸는가, 불러온 보낸 메일(SentHead[]), 고른 id, 거르기 글, 불러오는 차례(늦게 온 옛 응답은 버린다), 등록 중인가.
    reg: { open: false, list: [], picked: new Set(), q: '', seq: 0, loading: false, busy: false },
  };

  /* ---------------------------------------------------------- 장부 읽기 */

  const items = () => (Array.isArray(st.book?.items) ? st.book.items : []);
  const itemOf = (id) => items().find((x) => x.id === id) || null;
  const settingsOf = () => ({ ...SETTINGS_FALLBACK, ...(st.book?.settings || {}) });
  const isOpen = (it) => !it.closed && !statusOf(it).done;
  const port = () => portOf(settingsOf().mcpUrl);

  /**
   * sync 의 조작 뒤 장부를 다시 잡는다 — sync.book() 이 마지막 장부다(계약). 돌려받은 것이 장부 꼴이면 그것을,
   * 항목 꼴(TrackedItem)이면 그 항목만 갈아 끼운다(sync 가 어느 쪽을 돌려줘도 화면이 따라오게).
   */
  function absorb(ret) {
    let b = null;
    try { b = sync.book?.() || null; } catch { b = null; }
    if (ret && typeof ret === 'object' && Array.isArray(ret.items)) b = ret;
    if (!b || !Array.isArray(b.items)) b = st.book;
    if (b && ret && typeof ret === 'object' && !Array.isArray(ret.items) && ret.id && Array.isArray(ret.expect)) {
      b = { ...b, items: b.items.map((x) => (x.id === ret.id ? ret : x)) };
    }
    st.book = b;
  }

  /* ---------------------------------------------------------- 알림 줄 · 오류 */

  function setMsg(text, kind = '') {
    el.msg.className = `status mt-msg${kind ? ` ${kind}` : ''}`;
    el.msg.textContent = text;
  }
  function setRegMsg(text, kind = '') {
    el.regMsg.className = `status mt-reg-msg${kind ? ` ${kind}` : ''}`;
    el.regMsg.textContent = text;
  }
  function setSetMsg(text, kind = '', target = el.setMsg) {
    target.className = `status mt-set-msg${kind ? ` ${kind}` : ''}`;
    target.textContent = text;
  }
  /** 서버 주소·내 메일 주소·연결 확인의 알림 — 연결 갈래에 그렸으면 그쪽 줄, 아니면 메일 설정의 줄. */
  const setConnMsg = (text, kind = '') => setSetMsg(text, kind, el.connMsg);

  /** sync 가 던진 오류를 사람 말로 — kind 는 offline·auth·notool·badurl 이면 머리 칩도 바꾼다. */
  function msgOf(info) {
    if (info.kind === 'offline') return `Outlook MCP 서버가 꺼져 있습니다(${settingsOf().mcpUrl || MCP_URL_DEFAULT})`;
    if (info.kind === 'auth') return 'Microsoft 로그인이 풀렸습니다 — 머리의 열기를 눌러 다시 로그인하세요';
    if (info.kind === 'notool') return `서버에 필요한 도구가 없습니다${info.missing.length ? `: ${info.missing.join(', ')}` : ` — ${info.message}`}`;
    return info.message;
  }

  function connFromError(info) {
    if (info.kind === 'offline') setConn('offline', `MCP 서버가 꺼져 있습니다(:${port()})`, { title: info.message });
    else if (info.kind === 'auth') setConn('auth', 'Microsoft 로그인 필요', { authUrl: info.authUrl, title: info.message });
    else if (info.kind === 'notool') setConn('notool', `도구 없음: ${info.missing.join(', ') || info.message}`, { title: info.message });
    else if (info.kind === 'badurl') setConn('error', info.message);
    else return false;
    return true;
  }

  /** 실패를 알림 줄과 활동 기록에 — 로그인 주소(authUrl)는 기록에 남기지 않는다. */
  function fail(what, e) {
    const info = errInfo(e);
    connFromError(info);
    const text = `${what} 실패: ${msgOf(info)}`;
    setMsg(text, 'error');
    log('mail', false, text, { kind: info.kind || 'error' });
    return info;
  }

  /* ---------------------------------------------------------- 머리 */

  function setConn(state, text, { authUrl = '', title = '' } = {}) {
    st.conn = { state, text, authUrl: state === 'auth' ? authUrl : '' };
    el.state.dataset.state = state;
    el.state.textContent = state === 'ok' ? 'Outlook 연결됨' : text;
    el.state.title = [text, title].filter(Boolean).join(' · ');
    el.auth.classList.toggle('hidden', !(state === 'auth' && safeUrl(authUrl)));
    // 설정 화면의 연결 갈래에도 같은 칩과 로그인 열기(있을 때만).
    if (el.connState) {
      el.connState.dataset.state = state;
      el.connState.textContent = el.state.textContent;
      el.connState.title = el.state.title;
    }
    el.connAuth?.classList.toggle('hidden', !(state === 'auth' && safeUrl(authUrl)));
  }

  function paintSummary() {
    const list = items();
    const done = list.filter((x) => statusOf(x).done).length;
    const open = list.filter(isOpen).length;
    const closed = list.filter((x) => x.closed && !statusOf(x).done).length;
    // 아직 수락·거부하지 않은 회신 — 닫지 않은 메일 것만(닫은 메일의 회신은 더 보지 않는다).
    const pending = list.reduce((n, x) => n + pendingOf(x), 0);
    el.summary.innerHTML = `<span class="mt-summary-open">진행 중 <strong>${open}</strong></span> · <span class="mt-summary-done">완료 <strong>${done}</strong></span>${closed ? ` · <span>닫음 <strong>${closed}</strong></span>` : ''}`
      + (pending ? ` · <span class="mt-summary-pending" title="수락·거부하지 않은 회신">확인 필요 <strong>${pending}</strong></span>` : '');
    paintStamp();
  }

  function paintStamp() {
    const ls = st.book?.lastSync || {};
    const at = Number(ls.at) || 0;
    if (!at) {
      el.stamp.textContent = '아직 갱신하지 않았습니다';
      el.stamp.title = '';
      return;
    }
    const ago = agoText(now() - at);
    el.stamp.textContent = ls.ok === false ? `갱신 실패 ${ago}` : `마지막 갱신 ${ago}`;
    el.stamp.title = ls.ok === false ? String(ls.error || '') : `받은 메일 ${num(ls.fetched)}건 · 새로 이어진 회신 ${num(ls.linked)}건`;
  }

  function setRefreshing(on) {
    el.refresh.disabled = on;
    el.refresh.classList.toggle('spin', on);
    el.refresh.innerHTML = `${icon('refresh')}<span>${on ? '찾는 중…' : '새로고침'}</span>`;
    if (on) host.setAttribute('aria-busy', 'true');
    else host.removeAttribute('aria-busy');
  }

  /* ---------------------------------------------------------- 연결 확인 · 새로고침 */

  /**
   * 서버 확인(tools/list) — 머리 칩을 바꾸고, 쓸 수 있으면 true. 겹쳐 부르면 도는 것을 같이 기다린다.
   * sync.probe 는 던지지 않고 { ok:false, error:{kind,message,authUrl?}, kind } 로 말한다(던져도 같이 다룬다).
   * 기록은 실패의 까닭이 바뀔 때만 남긴다 — 서버가 꺼진 채 탭을 열 때마다 같은 줄이 쌓이지 않게.
   */
  function runProbe() {
    if (st.probeRun) return st.probeRun;
    setConn('checking', '확인 중…');
    const failed = (info) => {
      if (!connFromError(info)) setConn('error', `연결 오류: ${clip(info.message, 60)}`, { title: info.message });
      const text = `메일 서버 확인 실패: ${msgOf(info)}`;
      if (st.probeFail !== text) log('mail', false, text, { kind: info.kind || 'error' });
      st.probeFail = text;
      return false;
    };
    st.probeRun = (async () => {
      try {
        const p = await sync.probe();
        st.probe = p || null;
        const missing = Array.isArray(p?.missing) ? p.missing.map(String) : [];
        if (!p || p.ok === false) {
          // 도구가 모자라면 notool, 그 밖의 까닭(kind·error 를 실어 온 실패)은 던진 오류와 같이 다룬다.
          if (!missing.length) return failed(errInfo(p?.error && typeof p.error === 'object' ? { ...p.error, message: String(p.error.message || p.error) } : { kind: p?.kind, message: p?.error || p?.message || '서버가 답하지 않았습니다', authUrl: p?.authUrl }));
          return failed({ kind: 'notool', message: `없는 도구: ${missing.join(', ')}`, authUrl: '', missing });
        }
        const n = Array.isArray(p.tools) ? p.tools.length : 0;
        const tip = [serverName(p) && `서버 ${serverName(p)}`, missing.length && `없는 도구: ${missing.join(', ')}`].filter(Boolean).join(' · ');
        setConn('ok', `연결됨 · 도구 ${n}개`, { title: tip });
        st.probeFail = '';
        return true;
      } catch (e) {
        return failed(errInfo(e));
      } finally {
        st.probeRun = null;
      }
    })();
    return st.probeRun;
  }

  /** 탭을 열 때 — 서버가 살아 있고 마지막 갱신이 autoRefreshMin(기본 10분)보다 오래됐고 열린 항목이 있으면 저절로 새로고침(계획 4절 7). */
  async function probeThenAuto() {
    const ok = await runProbe();
    if (!ok || !st.shown) return;
    // 도구 목록은 로그인 없이도 온다 — 지난 갱신이 로그인 때문에 실패했으면(장부의 lastSync.kind) 칩을 "로그인 필요" 로 되살린다.
    absorb(null);
    const ls = st.book?.lastSync || {};
    if (ls.ok === false && ls.kind === 'auth') connFromError(errInfo({ kind: 'auth', message: ls.error || '' }));
    const min = Number(settingsOf().autoRefreshMin) || 0;
    if (min <= 0) return;
    const at = Number(st.book?.lastSync?.at) || 0;
    if (at && now() - at < min * 60_000) return;
    if (!items().some(isOpen)) return;
    await refresh({ force: false, why: '열 때' });
  }

  /** 받은 메일에서 회신을 찾는다(sync.refresh). 겹쳐 누르면 도는 것을 같이 기다린다. */
  function refresh({ force = false, why = '' } = {}) {
    if (st.refreshRun) return st.refreshRun;
    st.refreshRun = (async () => {
      setRefreshing(true);
      setMsg('받은 메일에서 회신을 찾는 중…');
      try {
        const r = await sync.refresh({ force });
        absorb(null);
        st.cache = null;
        if (r && r.ok === false) {
          const raw = r.error && typeof r.error === 'object' ? r.error : { kind: r.kind, message: r.error, authUrl: r.authUrl };
          const info = errInfo(raw);
          connFromError(info);
          const text = `새로고침 실패: ${msgOf(info)}`;
          setMsg(text, 'error');
          log('mail', false, text, { kind: info.kind || 'error' });
        } else if (r?.idle) {
          // 열린 항목이 없으면 sync 는 조회하지 않는다(계획 4절 6).
          setMsg('기다리는 메일이 없어 찾지 않았습니다.');
          // 조회하지 않았으니 서버가 살아났는지도 모른다 — 칩이 꺼짐·오류로 남아 있으면 다시 확인한다(연결 확인 단추가 설정 화면으로 간 뒤에도 메일 탭에서 되살리는 길).
          if (!['ok', 'checking'].includes(st.conn.state)) await runProbe();
        } else {
          const text = `받은 메일 ${num(r?.fetched)}건 · 새로 이어진 회신 ${num(r?.linked)}건`;
          // warnings — 큰 첨부를 서버가 주지 않았다 따위(갱신은 됐다).
          const warnings = arr(r?.warnings).map(errText);
          setMsg(`${why ? `${text}(${why})` : text}${warnings.length ? ` — 주의: ${warnings.join(' · ')}` : ''}`);
          log('mail', true, `메일 회신 갱신: ${text}`, { fetched: num(r?.fetched), linked: num(r?.linked), force, ...(warnings.length ? { warnings } : {}) });
          // 갱신이 됐으면 서버는 살아 있다 — 꺼짐·로그인 필요로 남아 있던 칩을 되돌린다.
          if (['offline', 'auth', 'error', 'idle'].includes(st.conn.state)) {
            const n = Array.isArray(st.probe?.tools) ? st.probe.tools.length : 0;
            setConn('ok', n ? `연결됨 · 도구 ${n}개` : '연결됨');
          }
        }
        return r;
      } catch (e) {
        fail('새로고침', e);
        return null;
      } finally {
        st.refreshRun = null;
        setRefreshing(false);
        paint();
      }
    })();
    return st.refreshRun;
  }

  /* ---------------------------------------------------------- 목록 */

  function paint() {
    paintSummary();
    if (st.view === 'detail' && !itemOf(st.itemId)) {
      st.view = 'list';
      st.itemId = null;
    }
    const detail = st.view === 'detail';
    el.listBox.classList.toggle('hidden', detail);
    el.detail.classList.toggle('hidden', !detail);
    if (detail) paintDetail(itemOf(st.itemId));
    else paintList();
  }

  function paintList() {
    // 진행 중인 것이 위로, 그 안에서는 늦게 보낸 것부터.
    const list = [...items()].sort((a, b) => (isOpen(b) - isOpen(a)) || String(b.sentAt || '').localeCompare(String(a.sentAt || '')));
    el.empty.classList.toggle('hidden', list.length > 0);
    el.list.innerHTML = list.map(itemCard).join('');
  }

  function itemCard(it) {
    const s = statusOf(it);
    const badge = s.done ? '<span class="mt-badge done">완료</span>' : `<span class="mt-badge">${s.responded}/${s.expected}</span>`;
    const keys = (it.expect || []).map(keyChip).join('');
    const atts = (it.attachments || []).filter((a) => !a.isInline).length;
    const replies = (it.replies || []).length;
    const pending = pendingOf(it);
    // 지우기 단추는 줄 단추의 형제(단추 안에 단추는 못 둔다) — 줄 오른쪽 아래에 겹쳐 놓고, 두 번 눌러 확인한다(removeItem).
    return `<li class="mt-row"><button type="button" class="mt-item${s.done ? ' done' : ''}${it.closed ? ' closed' : ''}" data-id="${esc(it.id)}" title="${esc(it.subject || '')}">`
      + `<span class="mt-item-top"><span class="mt-subj">${esc(it.subject || '(제목 없음)')}</span>${badge}</span>`
      + `<span class="mt-item-meta">${it.closed ? '닫음 · ' : ''}${esc(fmtDay(it.sentAt))} 보냄 · 첨부 ${atts} · 회신 ${replies}${pending ? ` · <span class="mt-pending">확인 필요 ${pending}</span>` : ''}</span>`
      + (keys ? `<span class="mt-keys">${keys}</span>` : '')
      + '</button>'
      + `<button type="button" class="small ghost mt-item-remove" data-id="${esc(it.id)}" aria-label="등록 지우기: ${esc(it.subject || '(제목 없음)')}" title="이 메일의 등록과 받아 둔 본문·첨부를 지웁니다(메일함은 그대로)">지우기</button>`
      + '</li>';
  }

  function keyChip(e) {
    const state = stateOf(e);
    const tip = [e.label || e.key, STATE_TEXT[state], (e.addresses || []).join(', ')].filter(Boolean).join(' · ');
    return `<span class="mt-key ${state}" title="${esc(tip)}">${esc(e.label || e.key)}</span>`;
  }

  /* ---------------------------------------------------------- 상세 */

  function openDetail(id) {
    if (!itemOf(id)) return;
    closeReg();
    st.view = 'detail';
    st.itemId = id;
    st.metaOpen = false;
    st.sentOpen = false;
    st.openBodies = new Set();
    st.cache = null;
    st.paths = {};
    st.mergeTpl = '';
    st.mergeOff = new Set();
    el.mergeReport.replaceChildren();
    disarm(el.remove);
    setMsg('');
    paint();
    el.back.focus();
  }

  function back() {
    const id = st.itemId;
    st.view = 'list';
    st.itemId = null;
    disarm(el.remove);
    paint();
    [...el.list.querySelectorAll('.mt-item')].find((b) => b.dataset.id === id)?.focus();
  }

  function paintDetail(it) {
    if (!it) return;
    const s = statusOf(it);
    const addrs = (list) => (list || []).map((a) => esc(a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address || a.name || '')).join(', ');
    const web = safeUrl(it.webLink);
    // 보낸 날·받는 사람·참조·Outlook 링크는 접어 둔다(2026-10-16 사용자 지정 "이 부분은 접어줘") — 접힌 줄에 날짜와 사람 수만.
    const brief = `${fmtTime(it.sentAt)} · 받는 사람 ${(it.to || []).length}명${it.cc?.length ? ` · 참조 ${it.cc.length}명` : ''}`;
    el.header.innerHTML = `<h3 class="mt-title">${esc(it.subject || '(제목 없음)')}</h3>`
      + `<details class="mt-meta-fold"${st.metaOpen ? ' open' : ''}><summary>${esc(brief)}</summary>`
      + '<dl class="mt-meta">'
      + `<dt>보낸 날</dt><dd>${esc(fmtTime(it.sentAt))}</dd>`
      + `<dt>받는 사람</dt><dd>${addrs(it.to) || '—'}</dd>`
      + (it.cc?.length ? `<dt>참조</dt><dd>${addrs(it.cc)} <span class="mt-cc-note" title="참조는 받을 곳이 아닙니다 — 받는 사람의 회신만 셉니다">(세지 않음)</span></dd>` : '')
      + '</dl>'
      + (web ? `<button type="button" class="small ghost mt-web" data-act="web" data-url="${esc(web)}">Outlook에서 열기${icon('external')}</button>` : '')
      + '</details>';
    el.status.textContent = `${s.responded}/${s.expected} · ${s.done ? '완료' : '진행 중'}${s.excluded ? ` · 제외 ${s.excluded}` : ''}${it.closed ? ' · 닫음' : ''}`;
    el.status.classList.toggle('done', !!s.done);
    el.progress.max = Math.max(1, s.expected);
    el.progress.value = s.responded;
    el.progress.setAttribute('aria-valuetext', `전체 ${s.expected}곳 중 ${s.responded}곳 회신${s.excluded ? `, ${s.excluded}곳 제외` : ''}`);
    el.progress.classList.toggle('done', !!s.done);
    // 추적 끝내기/다시 추적 — sync.close 가 있을 때만(계약 밖 덧붙임).
    el.close.classList.toggle('hidden', typeof sync.close !== 'function');
    el.close.textContent = it.closed ? '다시 추적' : '추적 끝내기';
    paintExpect(it);
    paintSent(it);
    paintReplies(it);
    paintMerge(it);
  }

  /**
   * 받을 곳 표. 단추는 sync.expect(itemId, key, state) — 완료로 표시(done)·제외(excluded)는 손으로 정한 표시(manual)가 붙어 갱신이 되돌리지 않고,
   * 되돌리기·포함은 'auto' 로 그 표시를 풀어 회신대로 다시 센다(match.js setExpect). 회신으로 저절로 완료된 곳은 회신 카드의 "빼기" 로 되돌린다.
   */
  function paintExpect(it) {
    const btn = (state, text, tip) => `<button type="button" class="small ghost" data-act="expect" data-state="${state}" title="${tip}">${text}</button>`;
    const undo = btn('auto', '되돌리기', '손으로 정한 상태를 풀고 회신대로 셉니다');
    const rows = (it.expect || []).map((e) => {
      const state = stateOf(e);
      const who = state === 'done' ? [e.by, e.doneAt ? fmtDay(e.doneAt) : ''].filter(Boolean).join(' · ') : '';
      const exclude = btn('excluded', '제외', '이 곳은 세지 않습니다');
      const btns = state === 'open' ? [btn('done', '완료로 표시', '회신이 없어도 받은 것으로 칩니다'), exclude, ...(e.manual ? [undo] : [])]
        : state === 'done' ? [...(e.manual ? [undo] : []), exclude]
          : [btn('auto', '포함', '다시 셉니다 — 회신이 와 있으면 완료로')];
      return `<tr class="mt-exp ${state}" data-key="${esc(e.key)}">`
        + `<th scope="row" class="mt-expect-org"><span class="mt-key ${state}">${esc(e.label || e.key)}</span>${e.manual ? '<span class="mt-manual" title="손으로 정한 상태 — 저절로 갱신해도 되돌리지 않습니다">수동</span>' : ''}</th>`
        + `<td class="mt-addrs">${esc((e.addresses || []).join(', '))}${who ? `<span class="mt-who" title="회신한 사람 · 회신 날짜">${esc(who)}</span>` : ''}</td>`
        + `<td class="mt-state-cell"><span class="mt-expect-state">${STATE_TEXT[state]}</span></td>`
        + `<td class="mt-btns">${btns.join('')}</td></tr>`;
    });
    el.expect.innerHTML = rows.length
      ? `<thead><tr><th scope="col">받을 곳</th><th scope="col">주소</th><th scope="col">상태</th><th scope="col"><span class="sr-only">바꾸기</span></th></tr></thead><tbody>${rows.join('')}</tbody>`
      : '<tbody><tr><td class="hint">받을 곳이 없습니다 — 받는 사람이 나뿐인 메일입니다(참조는 세지 않습니다)</td></tr></tbody>';
  }

  /** 금고에서 읽은 본문 하나를 글자로(HTML 은 태그를 뗀다). 아직 못 읽었으면 null. */
  function bodyTextOf(messageId) {
    const bodies = st.cache?.itemId === st.itemId ? st.cache.bodies : null;
    if (!bodies) return null;
    const b = bodies.find((x) => x.messageId === messageId);
    if (!b) return '본문이 저장되지 않았습니다 — 새로고침하면 다시 받아 둡니다.';
    const content = String(b.content ?? '');
    return /html/i.test(String(b.contentType || '')) ? htmlToText(content) : content;
  }

  function paintSent(it) {
    el.sentBody.textContent = st.sentOpen ? '본문 접기' : '본문 보기';
    el.sentBody.setAttribute('aria-expanded', String(st.sentOpen));
    el.sentText.classList.toggle('hidden', !st.sentOpen);
    if (st.sentOpen) el.sentText.textContent = bodyTextOf(it.id) ?? '읽는 중…';
    const tpls = new Set((it.templates || []).map((t) => t.attachmentId));
    const atts = (it.attachments || []).filter((a) => !a.isInline);
    el.sentAtts.innerHTML = atts.length ? atts.map((a) => attRow(it.id, a, tpls.has(a.id))).join('') : '<li class="hint mt-none">첨부 없음</li>';
  }

  /**
   * 첨부 한 줄(보낸 메일·회신 같은 꼴) — 확장에 받아 둔 것은 내려받기, 서버가 바이트를 주지 않은 큰 것(missing)·못 받은 것은 "서버에 저장",
   * 서버에 저장한 것은 그 경로와 복사. 보낸 메일의 첨부는 messageId 가 항목 id 다(sync.fetchServerCopy 가 그렇게 알아본다).
   */
  function attRow(messageId, a, tpl = false) {
    const path = a.serverPath || st.paths[`${messageId}\u0001${a.id}`] || '';
    // missing 은 서버가 정말 바이트를 주지 않은 것(sync 가 짐작하지 않고 어댑터가 알린 것)만 — 그것만 "서버에 저장" 으로 받는다.
    // stored:false 인데 missing 이 아닌 것은 파일이 아닌 첨부(메일 첨부 등)라 받을 길이 없다.
    const act = path
      ? `<span class="mt-path" title="서버 PC 에 저장된 곳: ${esc(path)}">${esc(path)}</span><button type="button" class="small ghost" data-act="copy-path" data-path="${esc(path)}">경로 복사</button>`
      : a.missing
        ? '<button type="button" class="small ghost" data-act="server" title="큰 첨부는 서버가 확장으로 보내 주지 않습니다 — 서버 PC 의 downloads/mailtrack 에 저장합니다">서버에 저장</button>'
        : a.stored === false
          ? '<span class="mt-att-off" title="파일이 아닌 첨부라 받아 두지 않았습니다">받지 않음</span>'
          : `<button type="button" class="small ghost" data-act="dl" aria-label="${esc(a.name || '첨부파일')} 내려받기">${icon('download')}<span class="mt-button-label">내려받기</span></button>`;
    const ext = String(a.name || '').split('.').pop().toLowerCase();
    const kind = ['xlsx', 'docx', 'pptx', 'pdf'].includes(ext) ? ext : 'file';
    return `<li class="mt-att" data-msg="${esc(messageId)}" data-att="${esc(a.id)}">`
      + `<span class="mt-file-icon" data-kind="${kind}" aria-hidden="true">${icon('file')}</span>`
      + `<div class="mt-att-info"><span class="mt-att-name" title="${esc(a.name || '')}">${esc(a.name || '(이름 없음)')}</span><div class="mt-att-meta">`
      + (tpl ? '<span class="mt-chip tpl" title="회신을 이 양식으로 합칠 수 있습니다">양식</span>' : '')
      + `<span class="mt-att-size">${esc(sizeText(a.size))}</span></div></div>${act}</li>`;
  }

  /** 회신의 종류 칩 — 회신 · 대상 아님(받을 곳에 없는 사람) · 자동 회신 · 배달 실패 · 후보(제목만 비슷한 것). */
  function kindOf(r) {
    if (r.kind === 'auto') return { cls: 'auto', text: '자동 회신' };
    if (r.kind === 'ndr') return { cls: 'ndr', text: '배달 실패' };
    if (r.kind === 'candidate') return { cls: 'candidate', text: '후보' };
    if (!r.key) return { cls: 'off', text: '대상 아님' };
    return { cls: 'reply', text: '회신' };
  }

  const labelOfKey = (it, key) => {
    const e = (it.expect || []).find((x) => x.key === key);
    return e ? e.label || e.key : String(key || '').replace(/^addr:/, '');
  };

  /**
   * 회신 카드 — 보낸 사람 · 받은 때 · 칩(종류 · 확인 상태: 확인 필요/수락/거부 · 집계됨) · 제목 · 단추.
   * 수락/거부는 지금 상태가 아닌 쪽만 보인다(확인 필요면 둘 다). 받을 곳이 없는 회신(대상 아님 · 받을 곳을 못 찾은 배달 실패)은 먼저 연결해야 수락할 수 있다.
   * 저절로 센 회신(확인 필요 + 집계됨)은 거부하면 받을 곳이 다시 기다림이 된다.
   */
  function replyCard(it, r) {
    const k = kindOf(r);
    const review = reviewOf(r);
    const target = r.key ? labelOfKey(it, r.key) : '';
    const keys = it.expect || [];
    const linkable = (r.kind === 'candidate' || !r.key) && keys.length > 0;
    const open = st.openBodies.has(r.id);
    const web = safeUrl(r.webLink);
    const from = r.from || {};
    const accept = review === 'accepted' ? ''
      : `<button type="button" class="small primary mt-review-action" data-act="review" data-state="accepted"${r.key ? ' title="받은 것으로 칩니다 — 받을 곳이 완료가 됩니다"' : ' disabled title="먼저 받을 곳에 연결하세요"'}>수락</button>`;
    const reject = review === 'rejected' ? ''
      : '<button type="button" class="small mt-review-action" data-act="review" data-state="rejected" title="받은 것으로 치지 않습니다 — 받을 곳은 다시 기다리고, 병합에서도 뺍니다">거부</button>';
    const link = linkable
      ? `<select class="mt-link-key" aria-label="연결할 받을 곳">${keys.map((e) => `<option value="${esc(e.key)}"${e.key === r.key ? ' selected' : ''}>${esc(e.label || e.key)}</option>`).join('')}</select>`
        + '<button type="button" class="small" data-act="link" title="고른 받을 곳의 회신으로 잇고 수락합니다">연결</button>'
      : '';
    const atts = (r.attachments || []).filter((a) => !a.isInline).map((a) => attRow(r.id, a)).join('');
    // DOM id에는 메일 ID를 쓰지 않는다. 본문 버튼과 영역을 연결할 패널 내 순번만 쓴다.
    const bodyId = `mtReplyBody-${(it.replies || []).indexOf(r)}`;
    return `<article class="mt-reply ${k.cls} ${review}${r.counted ? ' counted' : ''}" data-reply="${esc(r.id)}">`
      + '<div class="mt-reply-top">'
      + `<span class="mt-avatar" aria-hidden="true">${esc(Array.from(from.name || from.address || '?')[0])}</span>`
      + `<div class="mt-sender"><span class="mt-from" title="${esc(from.address || '')}">${esc(from.name || from.address || '(보낸 사람 없음)')}</span>`
      + `<div class="mt-reply-meta">${esc(from.address || '')}${target ? ` → ${esc(target)}` : ''}</div></div>`
      + `<span class="mt-date">${esc(fmtTime(r.receivedAt))}</span>`
      + `<div class="mt-reply-labels"><span class="mt-chip ${k.cls}">${k.text}</span>`
      + `<span class="mt-chip ${review}" title="${REVIEW_TIP[review]}">${REVIEW_TEXT[review]}</span>`
      + `${r.counted && review === 'pending' ? '<span class="mt-chip counted" title="받을 곳을 완료로 센 회신 — 거부하면 다시 기다립니다">집계됨</span>' : ''}`
      + `${r.via === 'block' ? `<span class="mt-chip held" title="${HELD_TIP}">보안 인증 대기</span>` : ''}</div></div>`
      + `<div class="mt-reply-subj">${esc(r.subject || '(제목 없음)')}</div>`
      + '<div class="mt-reply-acts">'
      + `${accept}${reject}`
      + `<button type="button" class="small mt-body-action" data-act="body" aria-expanded="${open}" aria-controls="${bodyId}">${open ? '본문 접기' : '본문 보기'}</button>`
      + (web ? `<button type="button" class="small ghost" data-act="web" data-url="${esc(web)}">Outlook에서 열기${icon('external')}</button>` : '')
      + link
      + '</div>'
      + `<pre id="${bodyId}" class="mt-body${open ? '' : ' hidden'}"></pre>`
      + (atts ? `<ul class="mt-atts">${atts}</ul>` : '')
      + '</article>';
  }

  function paintReplies(it) {
    // 받은 차례(늦은 것이 위)로 — 세는 회신·후보·자동 회신·배달 실패를 한 줄로 둔다.
    const list = [...(it.replies || [])].sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));
    el.replyCount.textContent = list.length ? String(list.length) : '';
    el.replies.innerHTML = list.length ? list.map((r) => replyCard(it, r)).join('') : '<p class="hint mt-none">아직 이어진 회신이 없습니다 — 새로고침하면 받은 메일에서 찾습니다.</p>';
    // 펼친 본문은 글자로만 넣는다(textContent) — 메일의 HTML 은 화면 요소가 되지 않는다.
    for (const card of el.replies.querySelectorAll('.mt-reply')) {
      const id = card.dataset.reply;
      if (!st.openBodies.has(id)) continue;
      card.querySelector('.mt-body').textContent = bodyTextOf(id) ?? '읽는 중…';
    }
  }

  /** 양식(내가 보낸 xlsx/docx)과 같은 종류의 회신 첨부들 — 거부한 회신의 것과 금고에 바이트가 없는 것은 고를 수 없다(ok:false, why 에 까닭). */
  function mergeSources(it, kind) {
    const out = [];
    for (const r of it.replies || []) {
      for (const a of r.attachments || []) {
        if (a.isInline || fileKind(a.name) !== kind) continue;
        const why = reviewOf(r) === 'rejected' ? '거부한 회신 — 수락하면 합칠 수 있습니다' : a.missing || a.stored === false ? '확장에 저장되지 않아 합칠 수 없습니다' : '';
        out.push({ r, a, key: `${r.id}\u0001${a.id}`, ok: !why, why });
      }
    }
    return out;
  }

  /**
   * 양식과 같은 갈래이지만 합칠 수 없는 형식의 회신 첨부들(옛 .xls·.doc, 매크로·서식 파일 .xlsm·.dotx …) — ooxml/merge.js mergeKind 가 받지 않는 것.
   * 고를 수는 없게 잠근 줄로만 보여, 회신이 왔는데 병합 칸에 없는 까닭을 사람이 알게 한다.
   */
  function unsupportedSources(it, kind) {
    const family = UNSUPPORTED[kind];
    if (!family) return [];
    const out = [];
    for (const r of it.replies || []) {
      for (const a of r.attachments || []) {
        const m = family.exec(String(a.name || '').trim());
        if (!a.isInline && m) out.push({ r, a, ext: m[1].toLowerCase() });
      }
    }
    return out;
  }

  /** 병합 출처 글 — org(받을 곳 이름, 없으면 도메인) · 이름 <주소> · 받은 날(model.js sourceOf 와 같은 꼴). */
  function sourceText(it, r) {
    const from = r.from || {};
    const org = r.key ? labelOfKey(it, r.key) : domainOf(from.address);
    const who = from.name && from.name !== from.address ? `${from.name} <${from.address || ''}>` : from.address || '';
    return [org, who, fmtDay(r.receivedAt)].filter(Boolean).join(' · ');
  }

  function curTemplate(it) {
    const tpls = (Array.isArray(it?.templates) ? it.templates : []).filter((t) => t && t.attachmentId);
    if (!tpls.length) return { tpls, tpl: null, kind: null };
    if (!tpls.some((t) => t.attachmentId === st.mergeTpl)) st.mergeTpl = tpls[0].attachmentId;
    const tpl = tpls.find((t) => t.attachmentId === st.mergeTpl);
    return { tpls, tpl, kind: tpl.kind || fileKind(tpl.name) };
  }

  function paintMerge(it) {
    const { tpls, tpl, kind } = curTemplate(it);
    el.merge.classList.toggle('hidden', !tpl);
    if (!tpl) return;
    el.mergeTpl.innerHTML = tpls.map((t) => `<option value="${esc(t.attachmentId)}">${esc(t.name || '(이름 없음)')}${t.stored === false ? ' (저장 안 됨)' : ''}</option>`).join('');
    el.mergeTpl.value = tpl.attachmentId;
    el.mergeHdrRow.classList.toggle('hidden', kind !== 'xlsx');
    el.mergeModeRow.classList.toggle('hidden', kind !== 'docx');
    const src = mergeSources(it, kind);
    // 합칠 수 없는 형식은 체크 칸을 잠근 줄로 — data-r·data-a 가 없어 고른 것(picks)에 들지 않는다.
    const off = unsupportedSources(it, kind).map(({ r, a, ext }) => '<label class="mt-check off mt-unsupported">'
      + '<input type="checkbox" disabled />'
      + `<span><span class="mt-att-name">${esc(a.name || '(이름 없음)')}</span>`
      + `<span class="mt-src">${esc(sourceText(it, r))} · 지원하지 않는 형식(.${esc(ext)}) — ${kind} 로 저장해 다시 받아 주세요</span></span></label>`);
    el.mergeFiles.innerHTML = src.length || off.length
      ? src.map(({ r, a, key, ok, why }) => `<label class="mt-check${ok ? '' : ' off'}${reviewOf(r) === 'rejected' ? ' mt-rejected' : ''}">`
        + `<input type="checkbox" data-r="${esc(r.id)}" data-a="${esc(a.id)}"${ok && !st.mergeOff.has(key) ? ' checked' : ''}${ok ? '' : ' disabled'} />`
        + `<span><span class="mt-att-name">${esc(a.name || '(이름 없음)')}</span>`
        + `<span class="mt-src">${esc(sourceText(it, r))}${why ? ` · ${esc(why)}` : ''}</span></span></label>`).join('') + off.join('')
      : `<p class="hint mt-none">같은 종류(${kind === 'xlsx' ? '엑셀' : '워드'})의 회신 첨부가 아직 없습니다.</p>`;
    paintMergeGo(it);
  }

  /** 병합 단추만 — 체크를 바꿀 때는 목록을 다시 그리지 않는다(키보드 자리를 잃지 않게). */
  function paintMergeGo(it) {
    const { tpl, kind } = curTemplate(it);
    if (!tpl) return;
    const picked = mergeSources(it, kind).some((s) => s.ok && !st.mergeOff.has(s.key));
    el.mergeGo.disabled = st.merging || tpl.stored === false || !picked;
    el.mergeGo.title = tpl.stored === false ? '양식 파일이 확장에 저장되지 않아 합칠 수 없습니다' : picked ? '' : '합칠 회신 첨부를 고르세요';
  }

  /* ---------------------------------------------------------- 금고(본문·첨부) */

  function cacheFor(itemId) {
    if (st.cache?.itemId !== itemId) st.cache = { itemId, bodies: null, files: null };
    return st.cache;
  }
  async function bodiesOf(itemId) {
    const c = cacheFor(itemId);
    if (!c.bodies) c.bodies = arr(await sync.bodies(itemId));
    return c.bodies;
  }
  async function filesOf(itemId) {
    const c = cacheFor(itemId);
    if (!c.files) c.files = arr(await sync.files(itemId));
    return c.files;
  }

  async function save(file) {
    await download({ name: safeName(file.name), bytes: file.bytes, mime: file.mime || 'application/octet-stream' });
  }

  async function toggleSentBody() {
    st.sentOpen = !st.sentOpen;
    const it = itemOf(st.itemId);
    if (!it) return;
    paintSent(it);
    if (!st.sentOpen) return;
    try {
      await bodiesOf(it.id);
    } catch (e) {
      fail('본문 읽기', e);
    }
    if (st.itemId === it.id) paintSent(it);
  }

  async function toggleReplyBody(replyId) {
    const it = itemOf(st.itemId);
    if (!it) return;
    if (st.openBodies.has(replyId)) st.openBodies.delete(replyId);
    else st.openBodies.add(replyId);
    paintReplies(it);
    if (!st.openBodies.has(replyId)) return;
    try {
      await bodiesOf(it.id);
    } catch (e) {
      fail('본문 읽기', e);
    }
    if (st.itemId === it.id) paintReplies(itemOf(it.id) || it);
  }

  async function downloadAtt(btn, messageId, attachmentId) {
    const itemId = st.itemId;
    btn.disabled = true;
    try {
      const f = (await filesOf(itemId)).find((x) => x.messageId === messageId && x.attachmentId === attachmentId);
      if (!f) {
        setMsg('이 첨부는 확장에 저장되지 않았습니다 — 새로고침하거나, 큰 파일이면 서버에 저장을 쓰세요.', 'error');
        return;
      }
      await save({ name: f.name, bytes: f.bytes, mime: f.contentType });
      flash(btn.querySelector('.mt-button-label') || btn, '내려받음 ✓');
    } catch (e) {
      fail('첨부 내려받기', e);
    } finally {
      btn.disabled = false;
    }
  }

  /** 서버 PC 에 저장(sync.fetchServerCopy) — messageId 는 회신 id, 보낸 메일의 첨부면 항목 id. */
  async function serverCopy(btn, messageId, attachmentId) {
    const itemId = st.itemId;
    btn.disabled = true;
    btn.textContent = '저장 중…';
    try {
      const ret = await sync.fetchServerCopy(itemId, messageId, attachmentId);
      const path = typeof ret === 'string' ? ret : String(ret?.serverPath || ret?.file_path || ret?.path || '');
      st.paths[`${messageId}\u0001${attachmentId}`] = path || '(경로를 받지 못함)';
      absorb(null);
      paint();
      setMsg(path ? `서버 PC 에 저장했습니다: ${path}` : '서버에 저장했지만 경로를 받지 못했습니다.');
      log('mail', true, `메일 첨부 서버 저장${path ? `: ${path}` : ''}`, { itemId, messageId, attachmentId });
    } catch (e) {
      fail('서버에 저장', e);
      if (btn.isConnected) {
        btn.disabled = false;
        btn.textContent = '서버에 저장';
      }
    }
  }

  async function copyPath(btn, path) {
    let ok = false;
    try { ok = await copyText(path); } catch { ok = false; }
    flash(btn, ok ? '복사됨 ✓' : '복사 실패', ok ? 1800 : 4000);
  }

  function openUrl(url) {
    const safe = safeUrl(url);
    if (!safe) return;
    try {
      Promise.resolve(openTab(safe)).catch((e) => fail('새 탭 열기', e));
    } catch (e) {
      fail('새 탭 열기', e);
    }
  }

  /* ---------------------------------------------------------- 조작(받을 곳 · 회신) */

  /** sync 의 조작 하나 — 누른 버튼을 잠그고, 끝나면 장부를 다시 잡아 그린다. */
  async function act(btn, what, fn, okText = '') {
    if (btn) btn.disabled = true;
    try {
      const ret = await fn();
      absorb(ret);
      paint();
      if (okText) {
        setMsg(okText);
        log('mail', true, okText);
      }
      return ret;
    } catch (e) {
      fail(what, e);
      return undefined;
    } finally {
      if (btn?.isConnected) btn.disabled = false;
    }
  }

  function onExpectClick(e) {
    const b = closest(e, '[data-act="expect"]');
    const row = b?.closest('tr[data-key]');
    if (!b || !row) return;
    const it = itemOf(st.itemId);
    if (!it) return;
    const key = row.dataset.key;
    const state = b.dataset.state;
    if (!EXPECT_STATES.includes(state) && state !== 'auto') return;
    const said = state === 'auto' ? '회신대로 셉니다' : `${STATE_TEXT[state]}(손으로)`;
    act(b, '받을 곳 상태 바꾸기', () => sync.expect(it.id, key, state), `받을 곳 ${labelOfKey(it, key)}: ${said}`);
  }

  function onRepliesClick(e) {
    const b = closest(e, '[data-act]');
    if (!b || !el.replies.contains(b)) return;
    const card = b.closest('[data-reply]');
    const rid = card?.dataset.reply;
    const it = itemOf(st.itemId);
    if (!it || !rid) return;
    if (b.closest('.mt-att')) {
      onAttClick(b);
      return;
    }
    switch (b.dataset.act) {
      case 'review': {
        const state = b.dataset.state;
        if (state !== 'accepted' && state !== 'rejected') break;
        const on = state === 'accepted';
        act(b, on ? '회신 수락' : '회신 거부', () => sync.review(it.id, rid, state), on ? '회신을 수락했습니다 — 받을 곳을 완료로 셉니다' : '회신을 거부했습니다 — 받을 곳은 다시 기다립니다');
        break;
      }
      case 'link': {
        const key = card.querySelector('.mt-link-key')?.value;
        if (key) act(b, '회신 연결', () => sync.link(it.id, rid, key), `회신을 ${labelOfKey(it, key)} 에 이어 수락했습니다`);
        break;
      }
      case 'body': toggleReplyBody(rid); break;
      case 'web': openUrl(b.dataset.url); break;
      default: break;
    }
  }

  /** 첨부 줄의 단추(보낸 메일·회신 같이) — 내려받기 · 서버에 저장 · 경로 복사. */
  function onAttClick(b) {
    const li = b.closest('.mt-att');
    if (!li || !itemOf(st.itemId)) return;
    if (b.dataset.act === 'dl') downloadAtt(b, li.dataset.msg, li.dataset.att);
    else if (b.dataset.act === 'server') serverCopy(b, li.dataset.msg, li.dataset.att);
    else if (b.dataset.act === 'copy-path') copyPath(b, b.dataset.path || '');
  }

  /* ---------------------------------------------------------- 병합 · zip · 지우기 */

  async function runMerge() {
    const it = itemOf(st.itemId);
    const { tpl, kind } = curTemplate(it);
    if (!it || !tpl || st.merging) return;
    const picks = mergeSources(it, kind).filter((s) => s.ok && !st.mergeOff.has(s.key)).map((s) => ({ messageId: s.r.id, attachmentId: s.a.id }));
    if (!picks.length) {
      setMsg('합칠 회신 첨부를 고르세요.', 'error');
      return;
    }
    const hdr = el.mergeHdr.value;
    const options = kind === 'xlsx'
      ? { headerRows: hdr === 'auto' ? 'auto' : Math.max(1, Number(hdr) || 1) }
      : { mode: el.mergeMode.value === 'rows' ? 'rows' : 'stack' };
    st.merging = true;
    el.mergeGo.disabled = true;
    el.merge.setAttribute('aria-busy', 'true');
    reportLines([`회신 ${picks.length}개를 합치는 중…`]);
    try {
      const out = await sync.mergeFiles(it.id, { templateAttachmentId: tpl.attachmentId, picks, options });
      await save({ name: out?.name || `${safeBase(it.subject)}_병합.${kind}`, bytes: out?.bytes, mime: out?.mime });
      const r = out?.report || {};
      const skipped = arr(r.skipped);
      const warnings = arr(r.warnings);
      reportLines([
        `${out?.name || '병합 파일'} — 회신 ${num(r.merged)}건을 합쳤습니다${r.rows != null ? ` · ${num(r.rows)}행` : ''}`,
        ...skipped.map((s) => `건너뜀: ${srcLabel(s?.source)} — ${s?.reason || '까닭 모름'}`),
        ...warnings.map((w) => `주의: ${w}`),
      ]);
      log('mail', true, `양식 병합: ${out?.name || ''} — 회신 ${num(r.merged)}건`, { merged: num(r.merged), rows: r.rows ?? null, skipped: skipped.length, warnings: warnings.length });
    } catch (e) {
      const info = fail('양식 병합', e);
      reportLines([`병합 실패: ${msgOf(info)}`]);
    } finally {
      st.merging = false;
      el.merge.removeAttribute('aria-busy');
      if (st.itemId === it.id) paintMerge(itemOf(it.id) || it);
    }
  }

  function reportLines(lines) {
    el.mergeReport.replaceChildren(...lines.map((text) => {
      const p = doc.createElement('p');
      p.textContent = text;
      return p;
    }));
  }

  /**
   * 본문(글자)·첨부를 메일마다 폴더로 묶은 zip — 보낸 메일은 00, 회신은 받은 차례로 01·02 …, 맨 위에 요약.txt 와 메일ID.json
   * (메일 ID·첨부 ID — 서버에서 본문·첨부를 다시 받을 때 쓴다. 2026-10-15 사용자 지정 "내용이나 첨부 파일 다운받을 수 있는 id도 같이 다운받게").
   */
  async function allZip() {
    const it = itemOf(st.itemId);
    if (!it) return;
    el.allZip.disabled = true;
    try {
      const [bodies, files] = await Promise.all([bodiesOf(it.id), filesOf(it.id)]);
      const entries = zipEntries(it, bodies, files, { mcpUrl: settingsOf().mcpUrl, at: now() });
      const bytes = buildZip(entries, { date: new Date(now()) });
      const name = `${safeBase(it.subject)}_메일_${ymd(now())}.zip`;
      await save({ name, bytes, mime: MIME_ZIP });
      const text = `${name} — 본문 ${bodies.length}개 · 첨부 ${files.length}개`;
      setMsg(text);
      log('mail', true, `메일 zip 저장: ${text}`, { itemId: it.id });
      flash(el.allZip.querySelector('.mt-button-label') || el.allZip, '저장함 ✓');
    } catch (e) {
      fail('zip 만들기', e);
    } finally {
      el.allZip.disabled = false;
    }
  }

  /** 등록 지우기 — 상세의 단추(기본)나 목록 줄의 지우기 단추(it·btn 을 받는다). 어느 쪽이든 두 번 눌러 확인한다. */
  async function removeItem(it = itemOf(st.itemId), btn = el.remove) {
    if (!it) return;
    if (!confirmTwice(btn, '한 번 더 누르면 지웁니다')) return;
    btn.disabled = true;
    try {
      const ret = await sync.remove(it.id);
      absorb(ret);
      // sync.book() 이 아직 옛 장부를 들고 있어도 지운 항목은 목록에서 뺀다.
      if (itemOf(it.id) && st.book) st.book = { ...st.book, items: st.book.items.filter((x) => x.id !== it.id) };
      st.view = 'list';
      st.itemId = null;
      st.cache = null;
      paint();
      setMsg(`등록을 지웠습니다: ${it.subject || '(제목 없음)'}`);
      log('mail', true, `메일 등록 지움: ${it.subject || ''}`, { id: it.id });
    } catch (e) {
      fail('등록 지우기', e);
    } finally {
      btn.disabled = false;
    }
  }

  const armed = new Map();
  /** 처음 누르면 글이 바뀌고(confirmMs 동안), 그 안에 다시 누르면 true — 글은 그때 되돌린다. */
  function confirmTwice(btn, text) {
    if (armed.has(btn)) {
      disarm(btn);
      return true;
    }
    const was = btn.textContent;
    btn.textContent = text;
    btn.classList.add('armed');
    armed.set(btn, { was, timer: setTimeout(() => disarm(btn), confirmMs) });
    return false;
  }
  function disarm(btn) {
    const a = armed.get(btn);
    if (!a) return;
    clearTimeout(a.timer);
    armed.delete(btn);
    btn.textContent = a.was;
    btn.classList.remove('armed');
  }

  /* ---------------------------------------------------------- 등록 대화 */

  function setDayOptions(select, days) {
    const list = [...new Set([...DAY_CHOICES, days].filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
    select.innerHTML = list.map((n) => `<option value="${n}">${n}일</option>`).join('');
    select.value = String(days);
  }

  async function openReg() {
    if (st.view === 'detail') back();
    if (st.reg.open) {
      el.regQ.focus?.();
      return;
    }
    st.reg.open = true;
    st.reg.list = [];
    st.reg.picked = new Set();
    st.reg.q = '';
    el.regQ.value = '';
    el.reg.classList.remove('hidden');
    el.register.setAttribute('aria-expanded', 'true');
    const days = Number(settingsOf().sentDays) || 30;
    setDayOptions(el.regDays, days);
    await loadSent(days);
  }

  function closeReg() {
    if (!st.reg.open) return;
    st.reg.open = false;
    st.reg.seq++;
    st.reg.list = [];
    st.reg.picked = new Set();
    el.reg.classList.add('hidden');
    el.reg.setAttribute('aria-busy', 'false');
    el.register.setAttribute('aria-expanded', 'false');
    el.regList.innerHTML = '';
    setRegMsg('');
  }

  async function loadSent(days) {
    const seq = ++st.reg.seq;
    st.reg.loading = true;
    el.reg.setAttribute('aria-busy', 'true');
    el.regList.innerHTML = '';
    setRegMsg(`최근 ${days}일 동안 보낸 메일을 불러오는 중…`);
    paintRegGo();
    try {
      const list = await sync.listSent({ days });
      if (seq !== st.reg.seq) return;
      st.reg.list = arr(list);
      setRegMsg(st.reg.list.length ? '' : `최근 ${days}일 동안 보낸 메일이 없습니다.`);
    } catch (e) {
      if (seq !== st.reg.seq) return;
      const info = fail('보낸 메일 불러오기', e);
      setRegMsg(`불러오지 못했습니다: ${msgOf(info)}`, 'error');
    } finally {
      if (seq === st.reg.seq) {
        st.reg.loading = false;
        el.reg.setAttribute('aria-busy', String(st.reg.busy));
        paintRegList();
      }
    }
  }

  function paintRegList() {
    const have = new Set(items().map((x) => x.id));
    const needle = st.reg.q.trim().toLowerCase();
    const rows = st.reg.list.filter((m) => !needle || `${m.subject || ''}\n${m.preview || ''}`.toLowerCase().includes(needle));
    el.regList.innerHTML = rows.map((m) => {
      const done = !!m.registered || have.has(m.id);
      return `<li class="mt-reg-row${done ? ' registered' : ''}"><label>`
        + `<input type="checkbox" value="${esc(m.id)}"${done ? ' disabled' : ''}${!done && st.reg.picked.has(m.id) ? ' checked' : ''} />`
        + '<span class="mt-reg-text"><span class="mt-reg-main">'
        + `<span class="mt-reg-subj">${esc(m.subject || '(제목 없음)')}</span>`
        + `<span class="mt-reg-date">${esc(fmtTime(m.receivedAt || m.sentAt))}</span>`
        + (done ? '<span class="mt-chip reg">등록됨</span>' : '')
        + '</span>'
        + (m.preview ? `<span class="mt-reg-prev">${esc(clip(m.preview, 140))}</span>` : '')
        + '</span></label></li>';
    }).join('') || (st.reg.list.length && needle ? '<li class="hint mt-none">거른 결과가 없습니다.</li>' : '');
    paintRegGo();
  }

  function paintRegGo() {
    const n = st.reg.picked.size;
    el.regGo.disabled = !n || st.reg.busy || st.reg.loading;
    el.regGo.textContent = n ? `선택 등록 (${n})` : '선택 등록';
  }

  async function doRegister() {
    const ids = [...st.reg.picked];
    if (!ids.length || st.reg.busy) return;
    st.reg.busy = true;
    el.reg.setAttribute('aria-busy', 'true');
    paintRegGo();
    setRegMsg(`${ids.length}건 등록하는 중… 본문·첨부를 받아 둡니다.`);
    let fresh = 0;
    try {
      // sync.register 는 던지지 않는다 — 통째 실패는 errors 와 error:{kind,message,authUrl?} 로 온다(칩도 그에 맞춘다).
      const r = (await sync.register(ids)) || {};
      const added = arr(r.added);
      fresh = added.length;
      const skipped = arr(r.skipped);
      const errors = arr(r.errors).map(errText);
      // warnings — 등록은 됐지만 알릴 것(서버가 바이트를 주지 않은 큰 첨부 따위). 오류가 아니라 결과 줄 아래 흐린 한 줄로 보인다.
      const warnings = arr(r.warnings).map(errText);
      if (r.error) connFromError(errInfo(r.error));
      absorb(null);
      st.cache = null;
      const addedIds = new Set(added.map((a) => (a && typeof a === 'object' ? a.id : a)));
      st.reg.list = st.reg.list.map((m) => (addedIds.has(m.id) ? { ...m, registered: true } : m));
      st.reg.picked = new Set();
      const text = `등록 ${added.length} · 건너뜀 ${skipped.length}${errors.length ? ` · 오류 ${errors.length}: ${errors[0]}` : ''}`;
      setRegMsg(text, errors.length ? 'error' : '');
      if (warnings.length) {
        const note = doc.createElement('span');
        note.className = 'mt-note';
        note.textContent = `주의: ${warnings.join(' · ')}`;
        el.regMsg.append(note);
      }
      log('mail', !errors.length, `메일 등록: ${text}`, { added: [...addedIds], skipped: skipped.length, errors, ...(warnings.length ? { warnings } : {}) });
      paint();
    } catch (e) {
      const info = fail('메일 등록', e);
      setRegMsg(`등록하지 못했습니다: ${msgOf(info)}`, 'error');
    } finally {
      st.reg.busy = false;
      el.reg.setAttribute('aria-busy', String(st.reg.loading));
      paintRegList();
    }
    // 새로 등록했으면 곧바로 한 번 찾는다 — 등록 전에 이미 와 있던 회신이 바로 이어지게.
    if (fresh) await refresh({ force: false, why: '등록 뒤' });
  }

  /* ---------------------------------------------------------- 설정 */

  function paintSettings() {
    const s = settingsOf();
    const focused = doc.activeElement;
    if (focused !== el.url) {
      el.url.value = s.mcpUrl || MCP_URL_DEFAULT;
      el.url.removeAttribute('aria-invalid');
    }
    if (focused !== el.userEmail) {
      el.userEmail.value = s.userEmail || '';
      el.userEmail.removeAttribute('aria-invalid');
    }
    setDayOptions(el.sentDays, Number(s.sentDays) || 30);
    if (focused !== el.windowDays) el.windowDays.value = String(Number(s.windowDays) || 90);
    if (focused !== el.autoMin) el.autoMin.value = String(Number(s.autoRefreshMin) || 0);
    el.ownByAddress.checked = s.ownByAddress !== false;
    el.useHeaders.checked = !!s.useHeaders;
    el.requireAccept.checked = !!s.requireAccept;
    el.setState.textContent = hostOf(s.mcpUrl);
  }

  async function saveSettings(patch, { reprobe = false } = {}) {
    // 서버 주소·내 메일 주소의 알림은 연결 갈래의 줄로(거기 그렸으면), 나머지는 메일 설정의 줄로.
    const say = 'mcpUrl' in patch || 'userEmail' in patch ? setConnMsg : setSetMsg;
    try {
      const ret = await sync.settings(patch);
      absorb(ret);
      paintSettings();
      paintSummary();
      say('저장했습니다.');
      // 메일 주소는 기록에 남기지 않는다 — 바꾼 칸 이름만.
      log('mail', true, `메일 설정 바꿈: ${Object.keys(patch).join(', ')}`);
      // 탭이 보일 때, 또는 연결 갈래에 칩이 있을 때(탭이 안 보여도 거기서 바꿨을 테니) 다시 확인해 칩을 맞춘다.
      if (reprobe && (st.shown || el.connState)) runProbe();
    } catch (e) {
      const info = fail('메일 설정 저장', e);
      say(`저장하지 못했습니다: ${msgOf(info)}`, 'error');
    }
  }

  function onUrlChange() {
    const v = el.url.value.trim() || MCP_URL_DEFAULT;
    const chk = checkMcpUrl(v);
    if (!chk.ok) {
      el.url.setAttribute('aria-invalid', 'true');
      setConnMsg(chk.error, 'error');
      return;
    }
    el.url.removeAttribute('aria-invalid');
    if (v === settingsOf().mcpUrl) return;
    saveSettings({ mcpUrl: v }, { reprobe: true });
  }

  function onUserEmailChange() {
    const v = el.userEmail.value.trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      el.userEmail.setAttribute('aria-invalid', 'true');
      setConnMsg(`메일 주소 꼴이 아닙니다: ${v}`, 'error');
      return;
    }
    el.userEmail.removeAttribute('aria-invalid');
    if (v === (settingsOf().userEmail || '')) return;
    saveSettings({ userEmail: v });
  }

  function onNumberChange(input, key, lo, hi) {
    const n = Math.round(Number(input.value));
    if (!Number.isFinite(n) || input.value.trim() === '') {
      setSetMsg('숫자를 적으세요.', 'error');
      input.value = String(settingsOf()[key]);
      return;
    }
    const v = Math.min(hi, Math.max(lo, n));
    input.value = String(v);
    if (v !== Number(settingsOf()[key])) saveSettings({ [key]: v });
  }

  async function probeClick() {
    el.probe.disabled = true;
    setConnMsg('서버를 확인하는 중…');
    try {
      const ok = await runProbe();
      setConnMsg(ok ? `연결됨 — ${st.conn.text}` : st.conn.text, ok ? '' : 'error');
    } finally {
      el.probe.disabled = false;
    }
  }

  /* ---------------------------------------------------------- 배선 · 보이기 */

  function wire() {
    if (st.wired) return;
    st.wired = true;
    el.refresh.addEventListener('click', () => refresh({ force: false }));
    el.register.addEventListener('click', () => (st.reg.open ? closeReg() : openReg()));
    el.auth.addEventListener('click', () => openUrl(st.conn.authUrl));
    el.regDays.addEventListener('change', () => loadSent(Number(el.regDays.value) || 30));
    el.regQ.addEventListener('input', () => { st.reg.q = el.regQ.value; paintRegList(); });
    el.regList.addEventListener('change', (e) => {
      const box = e.target;
      if (!box || box.type !== 'checkbox' || box.disabled) return;
      if (box.checked) st.reg.picked.add(box.value);
      else st.reg.picked.delete(box.value);
      paintRegGo();
    });
    el.regGo.addEventListener('click', doRegister);
    el.regCancel.addEventListener('click', closeReg);
    el.reg.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeReg(); });
    el.list.addEventListener('click', (e) => {
      const r = closest(e, '.mt-item-remove[data-id]');
      if (r) return removeItem(itemOf(r.dataset.id), r);
      const b = closest(e, '.mt-item[data-id]');
      if (b) openDetail(b.dataset.id);
    });
    el.back.addEventListener('click', back);
    el.header.addEventListener('click', (e) => {
      const b = closest(e, '[data-act="web"]');
      if (b) openUrl(b.dataset.url);
    });
    // 다시 그려도 펼친 채로 — toggle 은 거품이 일지 않아 잡는 단계에서 듣는다.
    el.header.addEventListener('toggle', (e) => {
      if (e.target.classList?.contains('mt-meta-fold')) st.metaOpen = e.target.open;
    }, true);
    el.expect.addEventListener('click', onExpectClick);
    el.sentBody.addEventListener('click', toggleSentBody);
    el.sentAtts.addEventListener('click', (e) => {
      const b = closest(e, '.mt-att [data-act]');
      if (b) onAttClick(b);
    });
    el.replies.addEventListener('click', onRepliesClick);
    el.mergeTpl.addEventListener('change', () => {
      st.mergeTpl = el.mergeTpl.value;
      const it = itemOf(st.itemId);
      if (it) paintMerge(it);
    });
    el.mergeFiles.addEventListener('change', (e) => {
      const box = e.target;
      if (!box || box.type !== 'checkbox') return;
      const key = `${box.dataset.r}\u0001${box.dataset.a}`;
      if (box.checked) st.mergeOff.delete(key);
      else st.mergeOff.add(key);
      const it = itemOf(st.itemId);
      if (it) paintMergeGo(it);
    });
    el.mergeGo.addEventListener('click', runMerge);
    el.allZip.addEventListener('click', allZip);
    el.close.addEventListener('click', () => {
      const it = itemOf(st.itemId);
      if (!it || typeof sync.close !== 'function') return;
      const on = !it.closed;
      act(el.close, on ? '추적 끝내기' : '다시 추적', () => sync.close(it.id, on), on ? '추적을 끝냈습니다 — 새로고침에서 이 메일의 회신은 찾지 않습니다' : '다시 추적합니다');
    });
    el.remove.addEventListener('click', () => removeItem());
    el.url.addEventListener('change', onUrlChange);
    el.userEmail.addEventListener('change', onUserEmailChange);
    el.sentDays.addEventListener('change', () => {
      const v = Number(el.sentDays.value);
      if (v > 0 && v !== Number(settingsOf().sentDays)) saveSettings({ sentDays: v });
    });
    // 범위는 model.js normalizeSettings 와 같게(조회 창 1~3650일 · 저절로 갱신 0~1440분).
    el.windowDays.addEventListener('change', () => onNumberChange(el.windowDays, 'windowDays', 1, 3650));
    el.autoMin.addEventListener('change', () => onNumberChange(el.autoMin, 'autoRefreshMin', 0, 1440));
    el.ownByAddress.addEventListener('change', () => saveSettings({ ownByAddress: el.ownByAddress.checked }));
    el.useHeaders.addEventListener('change', () => saveSettings({ useHeaders: el.useHeaders.checked }));
    el.requireAccept.addEventListener('change', () => saveSettings({ requireAccept: el.requireAccept.checked }));
    el.probe.addEventListener('click', probeClick);
    el.connAuth?.addEventListener('click', () => openUrl(st.conn.authUrl));
  }

  /** 탭을 열 때 — 장부를 읽어 그리고, 서버 확인과 (조건이 맞으면) 저절로 새로고침은 기다리지 않는다(st.bg 로 남긴다). */
  async function show() {
    host.classList.remove('hidden');
    st.shown = true;
    clearInterval(st.tick);
    st.tick = setInterval(paintStamp, TICK_MS);
    try {
      const b = await sync.load();
      absorb(b && Array.isArray(b.items) ? b : null);
    } catch (e) {
      fail('메일 장부 읽기', e);
    }
    paint();
    paintSettings();
    if (st.reg.open) paintRegList();
    st.bg = probeThenAuto().catch((e) => { fail('메일 서버 확인', e); });
  }

  function hide() {
    host.classList.add('hidden');
    st.shown = false;
    clearInterval(st.tick);
    st.tick = null;
    for (const btn of [...armed.keys()]) disarm(btn);
  }

  /** 패널 머리의 공용 새로고침 — 창을 무시하고 다시 찾는다. */
  async function reload() {
    return refresh({ force: true });
  }

  /**
   * 패널 설정의 연결 갈래를 열 때 — 메일 탭을 아직 열지 않았으면 장부를 읽어 저장된 MCP 주소·내 메일 주소를 그린다(서버 확인은 하지 않는다 —
   * 연결 확인 단추가 한다). 이미 읽었으면 그려 둔 그대로.
   */
  async function loadSettings() {
    setConnMsg('');   // 지난번의 오류·저장 알림은 지운다 — 칸은 저장된 값으로 다시 그려지니 어긋난 알림이 남지 않게
    if (!st.book) {
      try {
        const b = await sync.load();
        absorb(b && Array.isArray(b.items) ? b : null);
      } catch (e) {
        // fail() 은 메일 탭의 알림 줄에 적는데 설정 화면이 열려 있으면 그 탭은 숨어 있다 — 연결 갈래의 줄에도 적는다.
        const info = fail('메일 장부 읽기', e);
        setConnMsg(`저장된 설정을 읽지 못했습니다: ${msgOf(info)}`, 'error');
      }
    }
    paintSettings();
  }

  // 처음 그림 — 장부를 읽기 전이라 빈 목록과 "확인 전" 칩이 선다(섹션은 숨겨진 채).
  setConn('idle', '확인 전');
  paint();
  paintSettings();

  return { wire, show, hide, reload, loadSettings, state: () => st };
}

/* ------------------------------------------------------------ 화면 뼈대(정적 — 메일에서 온 글은 없다) */

/** 고정 아이콘만 그린다. 메일에서 온 SVG/HTML은 넣지 않는다. */
function icon(name) {
  const paths = {
    refresh: '<path d="M20 4v6h-6M20 10a8 8 0 1 0-1.5 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="m14 6-6 6 6 6"/>',
    external: '<path d="M14 3h7v7M21 3 10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h5"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/>',
    sent: '<path d="m21 3-7 18-4-9-9-4Z"/><path d="M21 3 10 12"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.mail}</svg>`;
}

const TEMPLATE = `
<div class="mt-head card">
  <div class="mt-head-row mt-head-top">
    <h2 class="mt-heading">회신 추적</h2>
    <span class="mt-head-tools">
      <button type="button" id="mtRefresh" class="small ghost mt-refresh" title="받은 메일에서 등록한 메일의 회신을 찾습니다">${icon('refresh')}<span>새로고침</span></button>
      <button type="button" id="mtRegister" class="small primary" aria-expanded="false" aria-controls="mtReg" title="보낸 메일을 골라 회신을 추적합니다">${icon('plus')}메일 등록</button>
    </span>
  </div>
  <div class="mt-head-row mt-head-sub">
    <span id="mtSummary" class="mt-summary"></span>
  </div>
  <div class="mt-connection">
    <span id="mtState" class="mt-state" data-state="idle" role="status" aria-live="polite">확인 전</span>
    <button type="button" id="mtAuth" class="small mt-auth hidden" title="Microsoft 로그인 창을 새 탭으로 엽니다 — 로그인한 뒤 새로고침을 누르세요">열기</button>
    <span id="mtStamp" class="mt-stamp"></span>
  </div>
</div>
<p id="mtMsg" class="status mt-msg" role="status" aria-live="polite"></p>
<div id="mtReg" class="mt-reg card hidden" aria-busy="false" role="group" aria-label="보낸 메일 등록">
  <div class="mt-reg-head">
    <strong>보낸 메일 등록</strong>
    <label class="mt-inline">기간 <select id="mtRegDays" aria-label="보낸 메일 기간"></select></label>
  </div>
  <input type="search" id="mtRegQ" class="mt-reg-q" placeholder="보낸 메일 제목 검색" aria-label="보낸 메일 제목 검색" autocomplete="off" />
  <ul id="mtRegList" class="mt-reg-list" aria-label="보낸 메일"></ul>
  <p id="mtRegMsg" class="status mt-reg-msg" role="status" aria-live="polite"></p>
  <div class="mt-actions">
    <button type="button" id="mtRegGo" class="primary small" disabled>선택 등록</button>
    <button type="button" id="mtRegCancel" class="ghost small">닫기</button>
  </div>
</div>
<div id="mtListBox" class="mt-list-box">
  <p id="mtEmpty" class="mt-empty card hidden"><span class="mt-empty-icon">${icon('mail')}</span><strong>기다리는 회신을 한눈에</strong><span>메일 등록을 눌러 보낸 메일을 선택하세요.<br>수신처별 회신과 첨부파일을 모아 볼 수 있어요.</span></p>
  <ul id="mtList" class="mt-list" aria-label="등록한 메일"></ul>
</div>
<div id="mtDetail" class="mt-detail hidden">
  <button type="button" id="mtBack" class="small ghost mt-back">${icon('back')}메일 목록</button>
  <div class="mt-overview card">
    <section id="mtSent" class="mt-sent" aria-label="보낸 메일">
      <div class="mt-sent-top"><span class="mt-header-label"><span class="mt-dir-icon" aria-hidden="true">${icon('sent')}</span>보낸 메일</span><button type="button" id="mtSentBody" class="small ghost mt-sent-body" aria-expanded="false" aria-controls="mtSentText">본문 보기</button></div>
      <div id="mtHeader" class="mt-header"></div>
      <ul id="mtSentAtts" class="mt-atts mt-atts-thin" aria-label="보낸 메일 첨부"></ul>
      <pre id="mtSentText" class="mt-body hidden"></pre>
    </section>
    <div class="mt-progress-area">
      <div class="mt-progress-head"><span class="mt-progress-label">회신 현황</span><div class="mt-progress-tools"><p id="mtStatus" class="mt-status"></p><button type="button" id="mtClose" class="small ghost mt-close hidden" title="추적을 끝낸 메일은 새로고침에서 회신을 찾지 않습니다(기록은 남고, 다시 추적으로 되돌립니다)">추적 끝내기</button></div></div>
      <progress id="mtProgress" class="mt-progress" value="0" max="1" aria-label="수신처 회신 진행률"></progress>
    </div>
  </div>
  <section class="mt-sec card" aria-label="받을 곳">
    <div class="mt-sec-head"><h3 class="mt-h">수신처별 회신</h3><span class="mt-section-note">도메인·주소 기준</span></div>
    <table id="mtExpect" class="mt-expect" aria-label="수신처별 회신 상태"></table>
  </section>
  <section class="mt-sec card" aria-label="회신">
    <div class="mt-sec-head"><h3 class="mt-h"><span class="mt-dir-icon in" aria-hidden="true">${icon('inbox')}</span>받은 회신 <span id="mtReplyCount" class="count"></span></h3><span class="mt-section-note">최신순</span></div>
    <div id="mtReplies" class="mt-replies"></div>
  </section>
  <section id="mtMerge" class="mt-sec mt-merge card hidden" aria-label="양식 병합">
    <h3 class="mt-h">양식 병합</h3>
    <p class="hint mt-merge-hint">보낸 양식(엑셀·워드)으로 받은 회신 첨부를 한 파일로 합칩니다. 출처(받을 곳 · 보낸 사람 · 날짜)가 함께 들어갑니다.</p>
    <label class="mt-field"><span>양식</span><select id="mtMergeTpl" aria-label="양식"></select></label>
    <div id="mtMergeFiles" class="mt-merge-files" role="group" aria-label="합칠 회신 첨부"></div>
    <label id="mtMergeHdrRow" class="mt-field" title="양식 위쪽의 머리 행 수 — 회신의 이 행들 아래만 합칩니다"><span>머리 행</span><select id="mtMergeHdr">
      <option value="auto">자동</option><option value="1">1행</option><option value="2">2행</option><option value="3">3행</option><option value="4">4행</option><option value="5">5행</option>
    </select></label>
    <label id="mtMergeModeRow" class="mt-field"><span>합치는 방식</span><select id="mtMergeMode">
      <option value="stack">쌓기 — 회신마다 쪽을 나눠 이어 붙이기</option><option value="rows">표 행 합치기 — 양식의 표에 회신의 행을 모으기</option>
    </select></label>
    <div class="mt-actions"><button type="button" id="mtMergeGo" class="primary small">병합해 내려받기</button></div>
    <div id="mtMergeReport" class="mt-report" role="status" aria-live="polite"></div>
  </section>
  <div class="mt-foot card">
    <button type="button" id="mtAllZip" class="small mt-export" title="보낸 메일·회신의 본문(글자)과 첨부를 메일마다 폴더로 묶어 내려받습니다">${icon('download')}<span class="mt-button-label">본문·첨부 모두 받기</span><span class="mt-zip-label">ZIP</span></button>
    <div class="mt-manage-actions">
      <span class="mt-manage-hint">등록과 받아 둔 본문·첨부만 지웁니다 — 메일함은 그대로</span>
      <button type="button" id="mtRemove" class="small ghost mt-remove" title="이 메일의 등록과 확장에 받아 둔 본문·첨부를 지웁니다(메일함은 그대로)">등록 지우기</button>
    </div>
  </div>
</div>
<details id="mtSettings" class="mt-settings card">
  <summary><span>메일 설정</span><span id="mtSetState" class="mt-set-state"></span></summary>
  <div id="mtSetBody" class="mt-set-body">
    <label class="mt-field"><span>보낸 메일 기간</span><select id="mtSentDays" aria-label="등록 대화의 기본 기간"></select></label>
    <label class="mt-field" title="회신을 찾을 때 이보다 오래된 받은 메일은 보지 않습니다"><span>조회 창(일)</span><input type="number" id="mtWindowDays" min="1" max="3650" step="1" /></label>
    <label class="mt-field" title="탭을 열 때 마지막 갱신이 이보다 오래됐으면 저절로 찾습니다 — 0 이면 끕니다"><span>저절로 갱신(분)</span><input type="number" id="mtAutoMin" min="0" max="1440" step="1" /></label>
    <label class="mt-check"><input type="checkbox" id="mtOwnByAddress" /><span>우리 회사(내 도메인) 받는 사람은 주소마다 따로 셉니다 — 끄면 도메인 하나로 묶습니다(새로 등록하는 메일부터)</span></label>
    <label class="mt-check"><input type="checkbox" id="mtUseHeaders" /><span>메일 머리(In-Reply-To · References)로도 회신을 잇습니다 — 조금 느립니다</span></label>
    <label class="mt-check" title="끄면 회신이 오면 바로 세고, 아니다 싶은 것은 거부로 되돌립니다"><input type="checkbox" id="mtRequireAccept" /><span>회신이 와도 수락해야 받을 곳을 완료로 셉니다(새로 이어지는 회신부터)</span></label>
    <p id="mtSetMsg" class="status mt-set-msg" role="status" aria-live="polite"></p>
  </div>
</details>
`;

/** 연결 갈래에 그렸을 때 메일 설정 칸 맨 위에 두는 안내 한 줄. */
const CONN_NOTE = '<p class="hint mt-conn-note">서버(MCP) 주소와 내 메일 주소는 패널 머리의 설정(톱니) → <strong>연결</strong> 에 있습니다.</p>';

/**
 * MCP 주소·내 메일 주소·연결 확인. standalone 이면(패널 설정의 연결 갈래) 상태 칩·로그인 열기·알림 줄을 따로 둔다 — 메일 설정 칸 안에 그릴 때는
 * 머리 칩(mtState)·열기(mtAuth)·메일 설정의 알림 줄(mtSetMsg)이 그 몫이라 두지 않는다.
 */
function connTemplate({ standalone }) {
  return `
<div id="mtConn" class="mt-conn">
  <label class="mt-field" title="KR_MS365_mcp 의 Outlook 서버 — 이 PC(localhost · 127.0.0.1)만 됩니다"><span>MCP 주소</span><input type="url" id="mtUrl" placeholder="${MCP_URL_DEFAULT}" autocomplete="off" spellcheck="false" /></label>
  <label class="mt-field" title="비우면 서버가 로그인한 계정을 씁니다"><span>내 메일 주소</span><input type="email" id="mtUserEmail" placeholder="비우면 서버 기본" autocomplete="off" spellcheck="false" /></label>
  <div class="mt-actions">${standalone ? '<span id="mtConnState" class="mt-state" data-state="idle" role="status" aria-live="polite">확인 전</span><button type="button" id="mtConnAuth" class="small mt-auth hidden" title="Microsoft 로그인 창을 새 탭으로 엽니다 — 로그인한 뒤 연결 확인을 누르세요">열기</button>' : ''}<button type="button" id="mtProbe" class="${standalone ? 'ghost small' : 'small'}">연결 확인</button></div>
  ${standalone ? '<p id="mtConnMsg" class="status mt-set-msg" role="status" aria-live="polite"></p>' : ''}
</div>`;
}

/* ------------------------------------------------------------ 순수 도우미 */

/** MCP 주소 검사 — http(s)://localhost | 127.0.0.1 만(manifest host_permissions, rerp/plussync.js plusAllowed 와 같은 규칙). */
export function checkMcpUrl(url) {
  let u = null;
  try { u = new URL(String(url ?? '')); } catch { u = null; }
  if (!u || !/^https?:$/.test(u.protocol)) return { ok: false, kind: 'badurl', error: `MCP 주소가 올바르지 않습니다: ${url}` };
  if (!/^(localhost|127\.0\.0\.1)$/i.test(u.hostname)) return { ok: false, kind: 'badurl', error: `MCP 주소는 이 PC(localhost · 127.0.0.1)만 됩니다: ${u.hostname}` };
  return { ok: true };
}

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', copy: '©', reg: '®', trade: '™', times: '×', rarr: '→', larr: '←',
};
// </li> 는 넣지 않는다 — <li> 가 이미 새 줄(• )을 연다.
const BLOCK_END = /<\/(p|div|tr|h[1-6]|blockquote|table|ul|ol|pre|section|article|header|footer)\s*>/gi;
const DROP_WHOLE = /<(script|style|head|title|noscript|template|iframe|object|svg|math|xml)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/**
 * 메일 HTML → 읽을 글자. 화면에는 textContent 로만 넣는다 — 이것은 꼴을 다듬을 뿐 막는 장치가 아니다(막는 것은 textContent).
 * 스크립트·스타일·머리는 통째로, 나머지 태그는 떼고, 문단·줄바꿈은 줄로, 문자 참조는 풀어 둔다.
 */
export function htmlToText(html) {
  let s = String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(DROP_WHOLE, '')
    .replace(/\s+/g, ' ')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<hr\b[^>]*>/gi, '\n――――\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(BLOCK_END, '\n')
    .replace(/<[^>]*>/g, '');
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, k) => {
    if (k[0] === '#') {
      const cp = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[k.toLowerCase()] ?? m;
  });
  return s.split('\n').map((line) => line.replace(/[ \t ]+$/g, '').replace(/^ +/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 받을 곳 상태(장부의 status 가 없으면 expect 로 센다 — model.js statusOf 와 같은 규칙). */
function statusOf(item) {
  const s = item?.status;
  if (s && typeof s.expected === 'number' && typeof s.responded === 'number') return { excluded: 0, ...s, done: !!s.done };
  const all = Array.isArray(item?.expect) ? item.expect : [];
  const live = all.filter((e) => e.state !== 'excluded');
  const responded = live.filter((e) => e.state === 'done').length;
  return { expected: live.length, responded, excluded: all.length - live.length, done: live.length > 0 && responded === live.length };
}

const stateOf = (e) => (EXPECT_STATES.includes(e?.state) ? e.state : 'open');
/** 회신의 확인 상태 — review 가 없는(옛 장부) 회신은 확인 필요. */
const reviewOf = (r) => (REVIEW_STATES.includes(r?.review) ? r.review : 'pending');
/** 아직 수락·거부하지 않은 회신 수 — 닫은 메일은 0(그 회신은 더 보지 않는다). */
const pendingOf = (it) => (it?.closed ? 0 : (it?.replies || []).filter((r) => reviewOf(r) === 'pending').length);
const arr = (x) => (Array.isArray(x) ? x : []);
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const escText = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const closest = (e, sel) => (e?.target && typeof e.target.closest === 'function' ? e.target.closest(sel) : null);
const domainOf = (address) => {
  const a = String(address || '').toLowerCase();
  const i = a.lastIndexOf('@');
  return i >= 0 ? a.slice(i + 1) : '';
};
const fileKind = (name) => (/\.xlsx$/i.test(String(name || '')) ? 'xlsx' : /\.docx$/i.test(String(name || '')) ? 'docx' : null);
const errText = (e) => (typeof e === 'string' ? e : String(e?.message || e?.error || JSON.stringify(e ?? '')));
const serverName = (p) => (typeof p?.server === 'string' ? p.server : p?.server?.name ? `${p.server.name}${p.server.version ? ` ${p.server.version}` : ''}` : '');
const srcLabel = (s) => (s && typeof s === 'object' ? [s.org, s.name || s.address, s.date].filter(Boolean).join(' · ') : String(s ?? ''));

/** sync 가 던진 것에서 kind·글·로그인 주소·없는 도구를 꺼낸다(mcp/outlook.js describe 와 같은 꼴, payload.auth_url 도 본다). */
function errInfo(e) {
  const payload = e?.payload && typeof e.payload === 'object' ? e.payload : null;
  const authUrl = String(e?.authUrl || e?.auth_url || payload?.auth_url || '');
  let kind = String(e?.kind || '');
  if (authUrl && (!kind || kind === 'tool')) kind = 'auth';
  if (kind === 'tool' && payload?.status === 'auth_required') kind = 'auth';
  const message = String((typeof e === 'string' ? e : e?.message || e?.error || payload?.message) || '알 수 없는 오류');
  return { kind, message, authUrl, missing: arr(e?.missing).map(String) };
}

/** 새 탭으로 열어도 되는 주소 — https, 또는 이 PC 의 http. */
function safeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(String(url));
    if (u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/i.test(u.hostname))) return u.href;
  } catch { /* 아래로 */ }
  return '';
}

function portOf(url) {
  try {
    const u = new URL(String(url || MCP_URL_DEFAULT));
    return u.port || (u.protocol === 'https:' ? '443' : '80');
  } catch {
    return '5001';
  }
}

function hostOf(url) {
  try {
    return new URL(String(url || MCP_URL_DEFAULT)).host;
  } catch {
    return '';
  }
}

const pad2 = (n) => String(n).padStart(2, '0');
function dateOf(x) {
  if (x == null || x === '') return null;
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** 2026-10-15 */
function fmtDay(x) {
  const d = dateOf(x);
  return d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : '';
}
/** 2026-10-15 14:03 */
function fmtTime(x) {
  const d = dateOf(x);
  return d ? `${fmtDay(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '';
}
/** 20261015 */
function ymd(x) {
  const d = dateOf(x) || new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function agoText(ms) {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function sizeText(size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 파일 이름으로 쓸 수 있게 — 윈도·chrome.downloads 가 거절하는 글자를 _ 로, 너무 길면 확장자를 살려 자른다. */
export function safeName(name, fallback = '파일') {
  let s = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '');
  if (!s) s = fallback;
  if (s.length > 150) {
    const ext = (s.match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0];
    s = s.slice(0, 150 - ext.length) + ext;
  }
  return s;
}
const safeBase = (subject) => safeName(subject, '메일').slice(0, 60).trim() || '메일';

/** zip 맨 위의 ID 목록 파일 이름 — 메일 ID(message_id)·첨부 ID(attachment_id)로 서버에서 본문·첨부를 다시 받을 수 있게. */
export const IDS_FILE = '메일ID.json';
/** 금고 키와 같은 잇는 글자(store/vault.js 의 SEP — import 하지 않는다). */
const SEP = '\u0001';

/**
 * zip 에 넣을 항목들 — 맨 위에 요약.txt 와 메일ID.json(보낸 메일·회신마다 메일 ID·대화 ID·첨부 ID 와 zip 안의 경로 — 서버에서 다시 받을 때 그대로 넣는 값),
 * 본문은 글자(본문.txt — 머리에 메일 ID 와 첨부 ID, 메일의 HTML 을 그대로 내려 두지 않는다), 첨부는 바이트 그대로. 같은 이름은 (2)·(3) 을 붙인다.
 */
function zipEntries(it, bodies, files, { mcpUrl = MCP_URL_DEFAULT, at = Date.now() } = {}) {
  const folders = new Map([[it.id, '00_보낸 메일']]);
  const replies = [...(it.replies || [])].sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')));
  replies.forEach((r, i) => {
    const org = r.key ? String(r.key).replace(/^addr:/, '') : domainOf(r.from?.address) || r.from?.address || '회신';
    folders.set(r.id, `${pad2(i + 1)}_${safeName(org, '회신').slice(0, 40)}_${ymd(r.receivedAt)}`);
  });
  const used = new Set();
  const uniq = (path) => {
    let p = path;
    for (let n = 2; used.has(p.toLowerCase()); n++) p = path.replace(/(\.[^./]*)?$/, (ext) => ` (${n})${ext || ''}`);
    used.add(p.toLowerCase());
    return p;
  };
  const dirOf = (messageId) => folders.get(messageId) || `기타_${safeName(messageId, 'mail').slice(-12)}`;
  // 메일의 첨부 목록(장부) — 본문.txt 머리와 메일ID.json 에 첨부 ID 를 적는다. 본문 속 그림은 첨부가 아니다.
  const attsOf = (messageId) => ((messageId === it.id ? it.attachments : replies.find((r) => r.id === messageId)?.attachments) || []).filter((a) => a && a.id && !a.isInline);
  const summaryName = uniq('요약.txt');
  const idsName = uniq(IDS_FILE);
  const bodyPath = new Map(); // 메일 id → zip 안 본문 경로
  const filePath = new Map(); // 메일 id + 첨부 id → zip 안 첨부 경로
  const entries = [];
  for (const b of bodies) {
    const content = String(b.content ?? '');
    const text = /html/i.test(String(b.contentType || '')) ? htmlToText(content) : content;
    const atts = attsOf(b.messageId);
    const head = [
      `제목: ${b.subject || ''}`, `보낸 사람: ${b.from?.name || ''} <${b.from?.address || ''}>`, `날짜: ${fmtTime(b.receivedAt)}`, `메일 ID: ${b.messageId || ''}`,
      ...(atts.length ? ['첨부:', ...atts.map((a) => `- ${a.name || '(이름 없음)'} · 첨부 ID: ${a.id}`)] : []),
    ].join('\n');
    const name = uniq(`${dirOf(b.messageId)}/본문.txt`);
    if (b.messageId && !bodyPath.has(b.messageId)) bodyPath.set(b.messageId, name);
    entries.push({ name, data: `${head}\n\n${text}\n` });
  }
  for (const f of files) {
    const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes || []);
    const name = uniq(`${dirOf(f.messageId)}/${safeName(f.name)}`);
    if (f.messageId && f.attachmentId) filePath.set(`${f.messageId}${SEP}${f.attachmentId}`, name);
    entries.push({ name, data: bytes });
  }
  const ids = idsOf(it, replies, { mcpUrl, at, folders, bodyPath, filePath, attsOf });
  return [{ name: summaryName, data: summaryText(it) }, { name: idsName, data: `${JSON.stringify(ids, null, 2)}\n` }, ...entries];
}

/**
 * 메일ID.json 의 내용 — 보낸 메일(sent)과 회신(replies)마다 messageId(= MCP 의 message_id)·conversationId 와 첨부마다 attachmentId(= attachment_id).
 * file 은 zip 안의 경로(없으면 null — 서버가 주지 않은 큰 첨부(missing)·파일이 아닌 첨부는 ID 로 다시 받는다), body 는 본문.txt 의 경로. howTo 는 다시 받을 때 부를 도구.
 */
function idsOf(it, replies, { mcpUrl, at, folders, bodyPath, filePath, attsOf }) {
  const attList = (messageId) => attsOf(messageId).map((a) => ({
    attachmentId: a.id, name: a.name || '', size: Number.isFinite(+a.size) ? +a.size : null, contentType: a.contentType || '',
    file: filePath.get(`${messageId}${SEP}${a.id}`) || null,
    ...(a.missing ? { missing: true } : {}), ...(a.serverPath ? { serverPath: a.serverPath } : {}),
  }));
  const mail = (messageId, m, extra) => ({
    messageId, conversationId: m.conversationId || '', ...extra, webLink: m.webLink || '',
    folder: folders.get(messageId) || '', body: bodyPath.get(messageId) || null, attachments: attList(messageId),
  });
  return {
    v: 1,
    madeAt: new Date(at).toISOString(),
    note: '메일 ID(message_id)·첨부 ID(attachment_id)는 Outlook MCP 서버(mcpUrl)에서 본문·첨부를 다시 받을 때 그대로 넣는 값입니다. file 이 null 인 첨부는 이 zip 에 없습니다 — ID 로 받으세요.',
    mcpUrl: mcpUrl || MCP_URL_DEFAULT,
    howTo: {
      body: 'mail_query_if_emaidID { message_ids: [messageId] }',
      attachmentList: 'mail_attachment_meta { message_ids: [messageId] }',
      attachment: 'mail_attachment_download [{ message_id: messageId, attachment_id: attachmentId }] (save_file:true 면 서버 PC 에 저장, file_path 를 돌려줌)',
    },
    sent: mail(it.id, it, { internetMessageId: it.internetMessageId || '', subject: it.subject || '', from: it.from?.address || '', sentAt: it.sentAt || '' }),
    replies: replies.map((r) => mail(r.id, r, {
      subject: r.subject || '', from: r.from?.address || '', receivedAt: r.receivedAt || '', key: r.key || null, kind: r.kind || 'reply', review: reviewOf(r), counted: r.counted === true,
      ...(r.via ? { via: r.via } : {}),
    })),
  };
}

function summaryText(it) {
  const s = statusOf(it);
  const addr = (a) => (a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address || '');
  const lines = [
    `제목: ${it.subject || ''}`,
    `메일 ID: ${it.id || ''}`,
    `보낸 날: ${fmtTime(it.sentAt)}`,
    `받는 사람: ${(it.to || []).map(addr).join(', ')}`,
    ...(it.cc?.length ? [`참조: ${it.cc.map(addr).join(', ')}`] : []),
    `상태: ${s.responded}/${s.expected} · ${s.done ? '완료' : '진행 중'}`,
    '',
    '[받을 곳]',
    ...(it.expect || []).map((e) => `- ${e.label || e.key} · ${STATE_TEXT[stateOf(e)]}${e.by ? ` · ${e.by}` : ''}${e.doneAt ? ` · ${fmtDay(e.doneAt)}` : ''} (${(e.addresses || []).join(', ')})`),
    '',
    '[회신]',
    ...(it.replies || []).map((r) => `- ${fmtTime(r.receivedAt)} · ${r.from?.address || ''} · ${r.kind} · ${REVIEW_TEXT[reviewOf(r)]}${r.counted ? ' · 셈' : ''}${r.via === 'block' ? ' · 보안 인증 대기(block@krs.co.kr 알림)' : ''} · ${r.subject || ''} · 메일 ID: ${r.id}`),
    '',
    `(메일 ID·첨부 ID 는 ${IDS_FILE} 과 각 본문.txt 머리에 — 서버에서 본문·첨부를 다시 받을 때 씁니다)`,
  ];
  return `${lines.join('\n')}\n`;
}

async function defaultCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 바이트를 파일로 내려받는다 — 확장의 downloads 권한으로(저장 위치를 묻는다), 없으면 링크를 눌러서(rndpanel.js defaultDownload 와 같은 방식). */
async function defaultDownload({ name, bytes, mime = 'application/octet-stream' }) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    if (globalThis.chrome?.downloads?.download) {
      await chrome.downloads.download({ url, filename: name, saveAs: true });
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
