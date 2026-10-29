// 일일 업무 한 날을 e-Class 「Daily Work Report」 작성 화면에 쓴다 — 저장(작성중)하고, 시키면 제출까지(2026-10-29 사용자 지정: "일일 업무보고를 신청할 수 있도록 해줘 …
// 일일 업무 보고서를 이 데이터 기반으로 등록할 수 있도록 기능을 워크스페이스 현황에 넣어줘"). 무엇을 쓸지는 일일 업무 카드(dwrbox.js — 짜기는 src/dwrplan.js)가 정하고
// dwr.write 기록(actions/spec/dwr/write.yaml → actions/runners/dwr.js)으로 온다.
//
// 원본은 krs-web-agents 의 dr_dailyreport/runners/dr_report_run.py(Playwright — 2026-07~10 그쪽에서 저장·제출을 실제로 했다). 화면의 차례와 자리는 그것을 따른다:
//   Common/Default(menuID=MBR00004) → wmmain 틀 → wmDailyList(btn_write) → wmDailyInsert2. 업무일자는 Telerik 날짜 칸 txtSDate(날짜 글 txtSDate_dateInput_TextBox,
//   캘린더 팝업 txtSDate_calendar — 달 넘기기 _NP·_NN, 제목 _Title '10월 2026', 날짜는 <a> — 이웃 달의 날은 부모 td 의 class 로 거른다), 업무 목록은 showHideInput(행) 을 단 줄들 —
//   그 줄의 업무내용 txtWork{행}, 투입시간은 그 줄(tr) 안의 txtWHour·txtWMin(같은 id 가 줄마다 있다), 전체 근무시간은 drSH·drSM·drEH·drEM(출장·외근 날만 09:00~18:00 —
//   근태에 실시간이 없다), 저장 btn_save(작성중) · 제출 btn_submit. 날짜를 옮기면 그 날 적어 둔 내용이 업무내용 칸에 뜬다 — 원본은 그것으로 이미 쓴 날을 거르고(이중 작성 방지),
//   제출 전에 저장된 내용을 다시 읽는다.
// 확장은 진짜 클릭이 없으니 같은 페이지 함수·요소를 부른다(같은 출처). 날짜는 Telerik 의 날짜 API(set_selectedDate · 옛 SetDate)로 옮기고, 안 되면 원본처럼 캘린더를 열어
// 달을 넘기고 날짜를 누른다. 어느 쪽이든 날짜 칸을 다시 읽어 맞았는지 본다. 날짜 칸이 이미 그 날이면 하루 앞으로 갔다가 돌아온다 — 날짜를 옮겨야 그 날 적어 둔 내용이
// 뜨는지 아직 모른다(처음 뜬 화면에 오늘 것이 실리는지 확인하지 못했다).
//
// 지키는 것(원본과 같다):
//   · 그 날 어느 업무에든 이미 내용이 있으면 쓰지 않는다(exists) — 고치기·덮어쓰기는 하지 않는다. 제출만은 그 날 그 줄 하나에 같은 내용이 있을 때(이 패널이 저장해 둔 날) 그대로 제출한다.
//   · 저장한 뒤 작성 화면을 처음부터 다시 열어 그 날 그 줄의 내용이 보낸 것과 같은지 본다 — 포스트백 뒤 화면의 칸은 보낸 글을 되돌려 줄 뿐이라 저장의 증거가 아니다. 다르면 됐다고 하지 않는다.
//   · 제출은 다시 읽기가 맞은 뒤에만 누른다(원본의 제출 전용 모드 — 저장된 그대로 제출). 삭제·확정은 하지 않는다.
// 뒤 탭 — 작성 화면은 뒤 탭으로 열고(주소 끝 #krsws-dwr) 다 쓰면 닫는다(close). 그 탭의 알림·확인 창은 dwrhook.js 가 받아 둔다(창이 뜨면 뒤 탭의 스크립트가 멈춘다) —
// 작성기가 열려 있는 동안만 등록한다. 기다리기는 패널 쪽이 한다(뒤 탭의 타이머는 늦춰진다 — src/gmwrite.js 와 같다).
// 2026-10-29 에는 e-Class 로그인이 풀려 이 화면을 CDP 로 읽어 보지 못했다 — 자리는 원본 러너의 것이고, 처음 실제로 쓰는 것은 사람이 패널에서 한다.

import { AuthError } from './net.js';
import { DWR_WRITE, LOGIN_MESSAGE } from './dwr.js';
import { hourParts, matchRow } from './dwrplan.js';

/** 작성기가 여는 탭의 주소 — 끝의 #krsws-dwr 가 dwrhook.js 에게 이 탭이라고 알린다. */
export const WRITE_URL = `${DWR_WRITE}#krsws-dwr`;
/** dwrhook.js 를 등록하는 이름. */
export const HOOK_ID = 'krsws-dwr-hook';
export const HOOK_FILE = 'dwrhook.js';

const OPEN_MS = 45000;
const STEP_MS = 20000;
const DATE_MS = 30000;
/** 같은 화면에서 이만큼 잠잠하면 포스트백이 없었던 것이다. */
const QUIET_MS = 2500;
const PRESS_MS = 45000;
const POLL_MS = 500;
/** 목록 화면에서 쓰기를 다시 누르기까지. */
const WRITE_AGAIN_MS = 8000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 저장·제출 뒤 알림 가운데 안 됐다는 뜻의 것. */
const FAIL_RE = /실패|오류|에러|error|입력하|선택하|확인하십|확인해\s*주|없습니다|할\s*수\s*없|불가|초과|잘못/i;
/** 알림들 가운데 안 됐다는 뜻의 첫 글(없으면 ''). 확인 창에 '아니오'를 한 것도 안 된 것이다. */
export function failOf(dialogs) {
  for (const x of dialogs || []) {
    if (x?.kind === 'confirm' && x.answer === false) return `확인 창에 답하지 않았습니다: ${x.text}`;
    if (x?.kind === 'alert' && FAIL_RE.test(String(x.text || ''))) return String(x.text);
  }
  return '';
}

/** 칸의 글이 같은가 — 빈칸·줄바꿈의 차이는 보지 않는다. */
export const sameText = (a, b) => String(a ?? '').replace(/\s+/g, ' ').trim() === String(b ?? '').replace(/\s+/g, ' ').trim();

/** 날짜의 하루 앞(YYYY-MM-DD). */
const dayBefore = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(y, m - 1, d - 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

/* ------------------------------------------------- 작성 화면 틀 안에서 도는 함수들 */
// chrome.scripting 으로 **글자 그대로** 옮겨져 그 틀의 MAIN 세계에서 돈다. 바깥 변수를 쓰면 안 된다.

/** 이 틀이 무엇인가 — 작성 화면(insert)·목록(list)·로그인, 다 떴는지, 작성기가 붙인 표(mark), 넘어가는 중(posting — beforeunload)·부분 포스트백 중(busy). */
function pageProbe() {
  const $ = (id) => document.getElementById(id);
  const href = location.href;
  let busy = false;
  try { busy = !!(window.Sys && Sys.WebForms && Sys.WebForms.PageRequestManager.getInstance().get_isInAsyncPostBack()); } catch (e) { busy = false; }
  return {
    href,
    ready: document.readyState === 'complete',
    login: /\/Account\/Log(in|out)/i.test(href) || !!document.querySelector('#tbUserId'),
    insert: /wmDailyInsert/i.test(href) && (!!$('btn_save') || !!document.querySelector('[id^="txtSDate"]')),
    list: !!$('btn_write'),
    mark: String(window.__krswsDwr || ''),
    posting: !!window.__krswsPosting,
    busy,
  };
}

/** 표를 붙인다 — 뒤에 새 화면이 뜨면(포스트백) 표가 없다. 넘어가기 시작하면(beforeunload) posting 이 선다. */
function pageMark(mark) {
  window.__krswsDwr = mark;
  window.__krswsPosting = 0;
  if (!window.__krswsUnload) {
    window.__krswsUnload = 1;
    window.addEventListener('beforeunload', () => { window.__krswsPosting = 1; });
  }
  return true;
}

/** 목록 화면의 쓰기(btn_write). */
function pageWrite() {
  const b = document.getElementById('btn_write');
  if (b) { setTimeout(() => b.click(), 0); return true; }
  if (typeof window.__doPostBack === 'function') { setTimeout(() => window.__doPostBack('btn_write', ''), 0); return true; }
  return false;
}

/** 업무일자 — 'read' 는 지금 날짜(YYYY-MM-DD), 'set' 은 Telerik 날짜 API 로 옮긴다(되면 via). */
function pageDate(op, target) {
  const two = (n) => String(n).padStart(2, '0');
  const norm = (v) => { const m = String(v == null ? '' : v).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); return m ? `${m[1]}-${two(m[2])}-${two(m[3])}` : ''; };
  const ymd = (d) => (d instanceof Date && !isNaN(d) ? `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` : '');
  let ajax = null;
  try { ajax = typeof window.$find === 'function' ? window.$find('txtSDate') : null; } catch (e) { ajax = null; }
  const classic = window.txtSDate && typeof window.txtSDate.SetDate === 'function' ? window.txtSDate : null;
  const box = ['txtSDate_dateInput_TextBox', 'txtSDate_dateInput', 'txtSDate_dateInput_text', 'txtSDate'].map((id) => document.getElementById(id)).find((x) => x && 'value' in x);
  const read = () => norm(box && box.value) || (ajax && ajax.get_selectedDate ? ymd(ajax.get_selectedDate()) : '') || (classic && classic.GetDate ? ymd(classic.GetDate()) : '');
  if (op === 'read') return { value: read() };
  const [y, m, d] = String(target).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  try {
    if (ajax && typeof ajax.set_selectedDate === 'function') { ajax.set_selectedDate(date); return { via: 'ajax' }; }
    if (classic) { classic.SetDate(date); return { via: 'classic' }; }
  } catch (e) {
    return { via: '', error: String((e && e.message) || e) };
  }
  return { via: '' };
}

/** 업무일자 캘린더(원본 러너 _set_work_date 의 길) — 'state' 보이나·몇 년 몇 월 · 'toggle' 팝업 단추 · 'nav' 달 넘기기(arg +1·-1) · 'pick' 그 달의 arg 일을 누른다. */
function pageCalendar(op, arg) {
  const cal = document.getElementById('txtSDate_calendar');
  const wrap = document.getElementById('txtSDate_calendar_wrapper') || cal;
  const visible = () => { if (!wrap) return false; const s = getComputedStyle(wrap); return s.display !== 'none' && s.visibility !== 'hidden' && wrap.offsetParent !== null; };
  const title = () => {
    const el = document.getElementById('txtSDate_calendar_Title');
    const t = (el && (el.innerText || el.textContent)) || '';
    const y = t.match(/(20\d{2})/);
    let m = t.match(/(\d{1,2})\s*월/);
    let mo = m ? +m[1] : 0;
    if (!m) {
      const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const low = t.toLowerCase();
      mo = names.findIndex((n) => low.includes(n)) + 1;
    }
    return { y: y ? +y[1] : 0, m: mo };
  };
  if (op === 'toggle') {
    const b = document.getElementById('txtSDate_CalendarPopupButton') || document.getElementById('txtSDate_popupButton');
    if (b) b.click();
    return { ok: !!b };
  }
  if (op === 'nav') {
    const a = document.getElementById(arg > 0 ? 'txtSDate_calendar_NN' : 'txtSDate_calendar_NP');
    if (a) a.click();
    return { ok: !!a };
  }
  if (op === 'pick') {
    if (!cal) return { ok: false };
    const bad = /other|out|disabled|week|daysofweek/i;
    const links = [...cal.querySelectorAll('a')].filter((e) => {
      if ((e.innerText || e.textContent || '').trim() !== String(arg)) return false;
      const cls = `${e.className || ''} ${(e.closest('td') || {}).className || ''}`;
      return !bad.test(cls);
    });
    if (links[0]) { links[0].click(); return { ok: true }; }
    const tds = [...cal.querySelectorAll('td')].filter((e) => (e.innerText || e.textContent || '').trim() === String(arg) && /radcal/i.test(e.className || '') && !bad.test(e.className || ''));
    if (tds[0]) { tds[0].click(); return { ok: true }; }
    return { ok: false };
  }
  return { visible: visible(), ...title() };
}

/** 업무 목록 — 줄마다 행 번호와 업무명, 그리고 이미 내용이 있는 업무내용 칸. */
function pageGrid() {
  const rows = [];
  const seen = new Set();
  for (const e of document.querySelectorAll('[onclick*=showHideInput]')) {
    const m = (e.getAttribute('onclick') || '').match(/showHideInput\(['"]?(\d+)/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const tr = e.closest('tr');
    const a = tr && tr.querySelector('[onclick*=popDoc],a');
    const name = ((a ? a.innerText || a.textContent : tr ? tr.innerText || tr.textContent : '') || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    rows.push({ row: m[1], name });
  }
  const filled = [];
  for (const t of document.querySelectorAll('textarea')) {
    const m = (t.id || '').match(/^txtWork(\d+)$/);
    if (m && (t.value || '').trim()) filled.push({ row: m[1], text: t.value.trim().slice(0, 600) });
  }
  return { rows, filled };
}

/** 한 줄 채우기(원본 러너 _fill_row·_set_worktime) — 입력칸을 열고(showHideInput) 업무내용, 그 줄의 투입시간 시·분, 출장·외근이면 근무시간 09:00~18:00. */
function pageFill(a) {
  const fire = (el, types) => types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  const pick = (id, v) => {
    const s = document.getElementById(id);
    if (!s || !s.options) return false;
    for (const o of s.options) {
      if (o.value === String(v) || o.text.trim() === String(v) || (o.value !== '' && Number(o.value) === v) || (o.text.trim() !== '' && Number(o.text) === v)) {
        s.value = o.value;
        fire(s, ['change']);
        return true;
      }
    }
    return false;
  };
  const time = a.trip ? ['drSH', 'drSM', 'drEH', 'drEM'].map((id, i) => pick(id, [9, 0, 18, 0][i])) : null;
  try { if (typeof window.showHideInput === 'function') window.showHideInput(String(a.row)); } catch (e) { /* 칸이 이미 열렸을 수 있다 */ }
  const ta = document.getElementById(`txtWork${a.row}`);
  if (ta) { ta.value = a.content; fire(ta, ['input', 'change', 'keyup']); }
  let btn = null;
  for (const e of document.querySelectorAll('[onclick*=showHideInput]')) {
    const m = (e.getAttribute('onclick') || '').match(/showHideInput\(['"]?(\d+)/);
    if (m && m[1] === String(a.row)) { btn = e; break; }
  }
  const tr = btn && btn.closest('tr');
  const hour = tr && tr.querySelector("input[id='txtWHour'],input[name='txtWHour']");
  const min = tr && tr.querySelector("input[id='txtWMin'],input[name='txtWMin']");
  if (hour) { hour.value = String(a.h); fire(hour, ['change', 'keyup']); }
  if (min) { min.value = String(a.m); fire(min, ['change', 'keyup']); }
  return { content: !!ta && ta.value === a.content, hour: !!hour, min: !!min, time };
}

/** 단추 누르기 — 표를 붙이고 확인 창에 '예'를 켠 뒤 돌아가서 누른다(누름이 이 호출을 붙잡지 않게). */
function pageClick(a) {
  try { sessionStorage.setItem('krswsDwrAllow', a.allow ? '1' : ''); } catch (e) { /* 확인 창은 '아니오'가 된다 */ }
  window.__krswsDwr = a.mark;
  window.__krswsPosting = 0;
  if (!window.__krswsUnload) {
    window.__krswsUnload = 1;
    window.addEventListener('beforeunload', () => { window.__krswsPosting = 1; });
  }
  const b = document.getElementById(a.id);
  if (!b) return { clicked: false };
  setTimeout(() => b.click(), 0);
  return { clicked: true };
}

/** dwrhook.js 가 받아 둔 알림·확인 창(이 탭·이 출처). clear 면 비운다. 확인 창의 '예'도 끈다. */
function pageDialogs(clear) {
  let all = [];
  try {
    all = JSON.parse(sessionStorage.getItem('krswsDwrDialogs') || '[]');
    if (clear) sessionStorage.removeItem('krswsDwrDialogs');
    sessionStorage.removeItem('krswsDwrAllow');
  } catch (e) { all = []; }
  return all;
}

export const injected = { pageProbe, pageMark, pageWrite, pageDate, pageCalendar, pageGrid, pageFill, pageClick, pageDialogs };

/* ------------------------------------------------------------ 패널 쪽 */

/**
 * 작성기 하나 — 뒤 탭 하나를 열어 두고 날마다 writeDay 를 부른다. 다 쓰면 close(탭을 닫고 dwrhook.js 등록을 지운다).
 * @param {{api?: object, wait?: (ms: number) => Promise<void>, now?: () => number}} [deps] api 는 chrome(검사는 가짜)
 */
export function createDwrWriter({ api = globalThis.chrome, wait = sleep, now = Date.now } = {}) {
  let tabId = null;
  let hooked = false;
  let seq = 0;
  const token = () => `krsws-${now()}-${++seq}`;

  // 창에 알림이 떠 스크립트가 멈추면 executeScript 가 돌아오지 않는다 — 부를 때마다 시간을 건다.
  const exec = async (frameId, func, args = [], ms = STEP_MS) => {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('e-Class 작성 화면이 답하지 않습니다 — 그 탭에 뜬 알림을 닫았는지 보세요')), ms); });
    try {
      return (await Promise.race([api.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'MAIN', func, args }), late]))?.[0]?.result;
    } finally {
      clearTimeout(timer);
    }
  };
  const probe = async () => {
    const all = await Promise.resolve(api.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: pageProbe })).catch(() => []);
    return (all || []).filter((r) => r?.result);
  };
  const loginIn = (all) => { if (all.some((r) => r.result.login)) throw new AuthError(LOGIN_MESSAGE); };

  async function hook() {
    if (hooked || !api.scripting?.registerContentScripts) return;
    try {
      await api.scripting.registerContentScripts([{
        id: HOOK_ID, js: [HOOK_FILE], matches: ['https://eclass.krs.co.kr/*'], runAt: 'document_start', allFrames: true, world: 'MAIN', persistAcrossSessions: false,
      }]);
    } catch (err) {
      if (!/duplicate|already/i.test(String(err?.message || err))) throw err;
    }
    hooked = true;
  }

  /** 뒤 탭을 연다(열려 있으면 그대로). fresh 면 작성 화면을 처음부터 다시 연다(저장한 것을 서버에서 다시 읽으려고). */
  async function open({ fresh = false } = {}) {
    if (tabId != null) {
      const alive = await Promise.resolve(api.tabs.get(tabId)).then(() => true, () => false);
      if (alive && !fresh) return;
      if (alive) { await api.tabs.update(tabId, { url: WRITE_URL }); return; }
      tabId = null;
    }
    await hook();
    const tab = await api.tabs.create({ url: WRITE_URL, active: false });
    tabId = tab?.id ?? null;
    if (tabId == null) throw new Error('일일 업무 작성 화면을 열지 못했습니다');
  }

  /** 작성 화면(wmDailyInsert2)이 뜬 틀. 목록 화면이면 쓰기를 누른다. */
  async function form(opts) {
    await open(opts);
    const t0 = now();
    let wrote = 0;
    while (now() - t0 < OPEN_MS) {
      const all = await probe();
      loginIn(all);
      const ins = all.find((r) => r.result.insert && r.result.ready && !r.result.posting && !r.result.busy);
      if (ins) return ins.frameId;
      const list = all.find((r) => r.result.list && r.result.ready && !r.result.posting);
      if (list && now() - wrote > WRITE_AGAIN_MS) { await exec(list.frameId, pageWrite, []).catch(() => null); wrote = now(); }
      await wait(POLL_MS);
    }
    throw new Error('일일 업무 작성 화면이 뜨지 않았습니다 — e-Class 의 Daily Work Report 가 열리는지 확인해 주세요');
  }

  /** 날짜를 옮긴 뒤 — 포스트백이 돌면 새 화면이 뜰 때까지, 안 돌면 잠잠해질 때까지 기다려 날짜 칸이 date 인 작성 화면 틀. 아니면 null. */
  async function landed(mark, date) {
    const t0 = now();
    while (now() - t0 < DATE_MS) {
      await wait(POLL_MS);
      const all = await probe();
      loginIn(all);
      const ins = all.find((r) => r.result.insert);
      if (!ins || !ins.result.ready || ins.result.posting || ins.result.busy) continue;
      const same = ins.result.mark === mark;
      if (same && now() - t0 < QUIET_MS) continue;
      const v = await exec(ins.frameId, pageDate, ['read', '']).catch(() => null);
      if (v?.value === date) return ins.frameId;
      return null;
    }
    return null;
  }

  /** 캘린더를 눌러 옮긴다(원본 러너의 길) — 세 번까지. */
  async function byCalendar(date) {
    const [y, m, d] = date.split('-').map(Number);
    for (let attempt = 0; attempt < 3; attempt++) {
      const f = await form();
      const cal = (op, arg = null) => exec(f, pageCalendar, [op, arg]);
      let st = await cal('state');
      for (let i = 0; i < 4 && !(st?.visible && st.y); i++) {
        if (!st?.visible) await cal('toggle');
        await wait(700);
        st = await cal('state');
      }
      if (!(st?.visible && st.y)) continue;
      const delta = y * 12 + m - (st.y * 12 + st.m);
      for (let i = 0; i < Math.min(Math.abs(delta), 36); i++) {
        await cal('nav', delta > 0 ? 1 : -1);
        await wait(650);
      }
      st = await cal('state');
      if (st?.y !== y || st?.m !== m) { if (st?.visible) await cal('toggle'); continue; }
      const mark = token();
      await exec(f, pageMark, [mark]);
      if (!(await cal('pick', d))?.ok) continue;
      const got = await landed(mark, date);
      if (got != null) return got;
    }
    return null;
  }

  /** 한 번 옮기기 — 날짜 API, 안 되면 캘린더. */
  async function move(f, date) {
    const mark = token();
    await exec(f, pageMark, [mark]);
    const set = await exec(f, pageDate, ['set', date]);
    if (set?.via) {
      const got = await landed(mark, date);
      if (got != null) return got;
    }
    return byCalendar(date);
  }

  /**
   * 업무일자를 date 로 — 그 날 적어 둔 내용이 뜬 작성 화면 틀. 이미 그 날이면 하루 앞으로 갔다가 돌아온다(날짜를 옮겨야 그 날 것이 뜨는지 모른다).
   * @returns {Promise<number>} frameId
   */
  async function setDate(date, opts) {
    let f = await form(opts);
    const cur = await exec(f, pageDate, ['read', '']);
    if (cur?.value === date) {
      f = await move(f, dayBefore(date));
      if (f == null) throw new Error(`업무일자를 옮기지 못했습니다(${dayBefore(date)})`);
    }
    const got = await move(f, date);
    if (got == null) throw new Error(`업무일자를 ${date} 로 옮기지 못했습니다`);
    return got;
  }

  /** 단추를 누르고 화면이 바뀔 때까지. 받아 둔 알림·확인 창과 화면이 바뀌었는지를 돌려준다. */
  async function press(f, id) {
    await exec(f, pageDialogs, [true]).catch(() => []);
    const mark = token();
    const r = await exec(f, pageClick, [{ id, mark, allow: true }]);
    if (!r?.clicked) throw new Error(`${id === 'btn_submit' ? '제출' : '저장'} 단추(${id})를 찾지 못했습니다`);
    const t0 = now();
    let moved = false;
    let last = null;
    while (now() - t0 < PRESS_MS) {
      await wait(POLL_MS);
      const all = await probe();
      loginIn(all);
      const fresh = all.find((x) => (x.result.insert || x.result.list) && x.result.ready && !x.result.posting && !x.result.busy && x.result.mark !== mark);
      if (fresh && !all.some((x) => x.result.mark === mark)) { moved = true; last = fresh; break; }
      const same = all.find((x) => x.result.mark === mark);
      // 같은 화면에서 넘어가지도 부분 포스트백이 돌지도 않은 채 잠잠하다 — 화면의 검사(알림)가 막았다.
      if (same && !same.result.posting && !same.result.busy && now() - t0 > QUIET_MS * 2) { last = same; break; }
    }
    const dialogs = await exec((last || { frameId: f }).frameId, pageDialogs, [true]).catch(() => []);
    return { moved, dialogs: Array.isArray(dialogs) ? dialogs : [] };
  }

  /** 그 날 그 줄을 서버에서 다시 읽는다 — 작성 화면을 처음부터 다시 열고 날짜를 옮긴다. */
  async function readBack(date, row) {
    const f = await setDate(date, { fresh: true });
    const grid = await exec(f, pageGrid, []);
    return { f, grid, text: grid?.filled?.find((x) => x.row === row)?.text ?? '' };
  }

  /** 제출 — 그 날 그 줄의 저장된 내용이 맞은 화면(f)에서 btn_submit. */
  async function submit(f, date, base, onStage) {
    onStage('제출 중…');
    const sent = await press(f, 'btn_submit');
    const bad = failOf(sent.dialogs);
    if (bad) throw new Error(`제출하지 못했습니다 — ${bad}`);
    if (!sent.moved) return { ...base, ok: false, status: 'unverified', note: '제출을 눌렀지만 화면이 바뀌는 것을 보지 못했습니다 — e-Class 목록에서 확인해 주세요', dialogs: sent.dialogs };
    return { ...base, ok: true, status: 'submitted', dialogs: sent.dialogs };
  }

  /**
   * 한 날 쓰기.
   * @param {{date: string, title: string, hours: number, content: string, trip?: boolean, op?: 'save'|'submit'}} day
   * @param {{onStage?: (text: string) => void, dry?: boolean}} [opts] dry 면 칸만 채우고 저장하지 않는다(실제 화면 검사용)
   * @returns {Promise<{ok: boolean, status: 'saved'|'submitted'|'exists'|'filled'|'unverified', row: string, rowName: string, note: string, dialogs?: object[]}>}
   *   exists 는 그 날 이미 적은 업무가 있어 쓰지 않은 것(ok false). 업무 목록에 맞는 줄이 없거나·날짜를 못 옮기거나·저장이 막히면 던진다.
   */
  async function writeDay(day, { onStage = () => {}, dry = false } = {}) {
    const { date, title, content, trip = false, op = 'save' } = day;
    const { h, m } = hourParts(day.hours);
    onStage('작성 화면 여는 중…');
    let f = await setDate(date);
    const grid = await exec(f, pageGrid, []);
    const hit = matchRow(grid?.rows || [], title);
    if (!hit.row) throw new Error(hit.why);
    const row = hit.row.row;
    const base = { row, rowName: hit.row.name, note: '' };
    const filled = grid.filled || [];
    if (filled.length) {
      const nameOf = (r) => grid.rows.find((x) => x.row === r)?.name || `${r}번 줄`;
      // 이 패널이 저장해 둔 날(그 줄 하나에 같은 내용)이면 제출만 한다 — 저장된 그대로.
      if (op === 'submit' && filled.length === 1 && filled[0].row === row && sameText(filled[0].text, content)) {
        if (dry) return { ...base, ok: true, status: 'filled', note: '저장된 내용이 있어 제출만 할 날입니다' };
        return submit(f, date, base, onStage);
      }
      return { ...base, ok: false, status: 'exists', note: `그 날 이미 적은 업무가 있어 쓰지 않았습니다(${filled.map((x) => nameOf(x.row)).join(' · ')})` };
    }
    onStage('칸 채우는 중…');
    const put = await exec(f, pageFill, [{ row, content, h, m, trip }]);
    if (!put?.content) throw new Error(`업무내용 칸(txtWork${row})을 찾지 못했습니다`);
    const notes = [];
    if (!put.hour) notes.push('투입시간 칸을 찾지 못했습니다');
    if (trip && put.time?.some((x) => !x)) notes.push('근무시간을 09:00~18:00 으로 맞추지 못했습니다');
    base.note = notes.join(' · ');
    if (dry) return { ...base, ok: true, status: 'filled' };
    onStage('저장 중…');
    const saved = await press(f, 'btn_save');
    const bad = failOf(saved.dialogs);
    if (bad) throw new Error(`저장하지 못했습니다 — ${bad}`);
    if (!saved.moved) throw new Error('저장을 눌렀지만 화면이 바뀌지 않았습니다 — e-Class 에서 그 날을 확인해 주세요');
    onStage('저장한 것을 다시 읽는 중…');
    const back = await readBack(date, row);
    if (!sameText(back.text, content)) throw new Error('저장한 뒤 그 날을 다시 열었더니 그 줄의 내용이 보낸 것과 다릅니다 — e-Class 에서 확인해 주세요');
    if (op !== 'submit') return { ...base, ok: true, status: 'saved', dialogs: saved.dialogs };
    f = back.f;
    return submit(f, date, base, onStage);
  }

  /** 탭을 닫고 dwrhook.js 등록을 지운다. 몇 번 불러도 된다. */
  async function close() {
    const id = tabId;
    tabId = null;
    if (id != null) await Promise.resolve(api.tabs.remove(id)).catch(() => {});
    if (hooked && api.scripting?.unregisterContentScripts) await Promise.resolve(api.scripting.unregisterContentScripts({ ids: [HOOK_ID] })).catch(() => {});
    hooked = false;
  }

  return { writeDay, close, get tabId() { return tabId; } };
}
