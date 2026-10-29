// 일일 업무 작성기(src/dwrwrite.js) — e-Class 「Daily Work Report」 작성 화면에 한 날을 쓰기(2026-10-29 사용자 지정: "일일 업무 보고서를 이 데이터 기반으로 등록할 수 있도록").
// 진짜 사이트는 보지 못했다(그날 e-Class 로그인이 풀려 CDP 로 읽지 못함) — 여기의 작성 화면은 krs-web-agents 의 dr_report_run.py 가 쓰는 자리(txtSDate · showHideInput ·
// txtWork{행} · txtWHour/txtWMin · drSH… · btn_save · btn_submit · wmDailyList 의 btn_write)를 jsdom 으로 흉내 낸 것이다. 날짜를 옮기면 그 날 저장된 내용이 뜨는 새 화면
// (포스트백)이 오고, 저장·제출도 새 화면을 띄운다. 알림·확인 창은 dwrhook.js 가 받는다. executeScript 는 틀마다 그 창에서 함수를 돌리고 답을 JSON 으로 옮긴다(크롬처럼).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { AuthError } from '../src/net.js';
import { createDwrWriter, failOf, sameText, WRITE_URL, HOOK_ID, HOOK_FILE } from '../src/dwrwrite.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const HOOK = fs.readFileSync(new URL(`../${HOOK_FILE}`, import.meta.url), 'utf8');

const A = 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발';
const B = '대용량 모듈러 멀티레벨 컨버터 기반 고압 드라이브 시제품 개발';
/** 작성 화면의 업무 목록 — 차단기는 같은 이름이 두 줄(2026-10-01 실측). */
const AIP = '시험/인증업무>AIP 기술검토 및 관리';
/** 줄여 보인 이름(2026-10-29 사용자 화면의 "시험/인증업무>AIP 기술검토 및 ...")은 풍선말(title)에 온 이름이 있다고 본다. */
const GRID = [{ row: '4', name: '부서소통회' }, { row: '6', name: '시험/인증업무>AIP 기술검토 및 ...', full: AIP }, { row: '8', name: A }, { row: '9', name: A }, { row: '12', name: B }, { row: '20', name: 'AIP 개념승인 업무' }];
const two = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * 흉내 낸 e-Class — 뒤 탭 하나(틀 0 은 Common/Default 껍데기, 틀 1 이 wmDailyList ↔ wmDailyInsert2). db 는 { 날짜: { rows: { 행: { text, hour, min } }, time, status } }.
 * picker: 'ajax'(Telerik $find 의 set_selectedDate) · 'none'(날짜 API 가 없어 캘린더를 눌러야 한다).
 */
function fakeEclass({ today = '2026-10-29', db = {}, picker = 'ajax', saveAlert = '저장되었습니다.', saveFails = '', login = false } = {}) {
  const frames = new Map();
  const session = new Map();
  const shared = {
    getItem: (k) => (session.has(k) ? session.get(k) : null), setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k),
  };
  const site = { db, hooked: false, opened: 0, closed: 0, updated: 0, log: [], tab: null, session };
  const later = (fn) => setTimeout(fn, 3);

  const shell = '<!doctype html><html><body><iframe name="main"></iframe></body></html>';
  const listHtml = '<!doctype html><html><body><form><input type="button" id="btn_write" value="쓰기"></form></body></html>';
  const loginHtml = '<!doctype html><html><body><input id="tbUserId"><input id="tbPassword"></body></html>';
  const select = (id, values, at) => `<select id="${id}" name="${id}">${values.map((v) => `<option value="${v}"${v === at ? ' selected' : ''}>${two(v)}</option>`).join('')}</select>`;
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const mins = [0, 10, 20, 30, 40, 50];
  const insertHtml = (date) => {
    const day = db[date]?.rows || {};
    return `<!doctype html><html><body><form id="form1">
      <input id="txtSDate_dateInput_TextBox" value="${date}"><a id="txtSDate_popupButton">달력</a>
      <div id="txtSDate_calendar_wrapper" style="display:none"><div id="txtSDate_calendar"><span id="txtSDate_calendar_Title"></span>
        <a id="txtSDate_calendar_NP">&lt;</a><a id="txtSDate_calendar_NN">&gt;</a><table id="calDays"></table></div></div>
      ${select('drSH', hours, 8)}${select('drSM', mins, 30)}${select('drEH', hours, 17)}${select('drEM', mins, 30)}
      <table>${GRID.map((r) => `<tr><td><a onclick="popDoc('${r.row}')"${r.full ? ` title="${r.full}"` : ''}>${r.name}</a></td><td><img onclick="showHideInput('${r.row}')"></td>`
        + `<td><input id="txtWHour" name="txtWHour" value="${day[r.row]?.hour ?? ''}"><input id="txtWMin" name="txtWMin" value="${day[r.row]?.min ?? ''}"></td></tr>`
        + `<tr id="in${r.row}" style="display:none"><td><textarea id="txtWork${r.row}" name="txtWork${r.row}">${esc(day[r.row]?.text)}</textarea></td></tr>`).join('')}</table>
      <input type="button" id="btn_save" value="저장"><input type="button" id="btn_submit" value="제출">
    </form></body></html>`;
  };

  function mount(id, kind, { date = today, alert = '' } = {}) {
    frames.get(id)?.close();
    const page = { top: 'eClassVer4/Common/Default', list: 'intra/Intranet/VSDotNet/workMan/wmDailyList.aspx', insert: 'intra/Intranet/VSDotNet/workMan/wmDailyInsert2.aspx', login: 'eClassVer4/Account/Login' }[kind];
    const html = { top: shell, list: listHtml, insert: insertHtml(date), login: loginHtml }[kind];
    // 크롬은 맨 위 주소의 #krsws-dwr 를 틀이 top.location 으로 본다 — jsdom 의 창은 저마다 top 이라 틀 주소에 붙인다.
    const dom = new JSDOM(html, { url: `https://eclass.krs.co.kr/${page}#krsws-dwr`, runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
    const win = dom.window;
    const doc = win.document;
    // 한 탭의 sessionStorage 는 같은 출처의 화면끼리 이어진다.
    Object.defineProperty(win, 'sessionStorage', { value: shared, configurable: true });
    // jsdom 은 배치를 하지 않는다 — 숨긴 것만 offsetParent 가 없다(캘린더가 보이는지).
    Object.defineProperty(win.HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return win.getComputedStyle(this).display === 'none' ? null : this.parentNode; } });
    if (site.hooked && kind !== 'login') win.eval(HOOK);
    const leave = (fn) => { win.dispatchEvent(new win.Event('beforeunload')); later(fn); };
    if (kind === 'list') doc.getElementById('btn_write').addEventListener('click', () => leave(() => mount(id, 'insert', { date: today })));
    if (kind === 'insert') {
      const go = (d) => { site.log.push(['date', d]); leave(() => mount(id, 'insert', { date: d })); };
      win.showHideInput = (row) => { const tr = doc.getElementById(`in${row}`); tr.style.display = tr.style.display === 'none' ? '' : 'none'; };
      if (picker === 'ajax') {
        win.$find = (x) => (x === 'txtSDate' ? { set_selectedDate: (dt) => go(ymd(dt)), get_selectedDate: () => new Date(`${date}T00:00:00`) } : null);
      } else {
        let [cy, cm] = date.split('-').map(Number);
        const wrap = doc.getElementById('txtSDate_calendar_wrapper');
        const render = () => {
          doc.getElementById('txtSDate_calendar_Title').textContent = `${cm}월 ${cy}`;
          const last = new Date(cy, cm, 0).getDate();
          // 앞 달의 끝 날(26~30)은 이웃 달 칸 — 부모 td 의 class 로만 가린다.
          doc.getElementById('calDays').innerHTML = `<tr>${[26, 27, 28, 29, 30].map((d) => `<td class="rcOtherMonth"><a href="#">${d}</a></td>`).join('')}`
            + `${Array.from({ length: last }, (_, i) => `<td class="rcRow"><a href="#">${i + 1}</a></td>`).join('')}</tr>`;
        };
        doc.getElementById('txtSDate_popupButton').addEventListener('click', () => { wrap.style.display = wrap.style.display === 'none' ? '' : 'none'; render(); });
        doc.getElementById('txtSDate_calendar_NN').addEventListener('click', () => { [cy, cm] = cm === 12 ? [cy + 1, 1] : [cy, cm + 1]; render(); });
        doc.getElementById('txtSDate_calendar_NP').addEventListener('click', () => { [cy, cm] = cm === 1 ? [cy - 1, 12] : [cy, cm - 1]; render(); });
        doc.getElementById('calDays').addEventListener('click', (e) => {
          const a = e.target.closest('a');
          if (!a || /other/i.test(a.closest('td').className)) return;
          go(`${cy}-${two(cm)}-${two(+a.textContent)}`);
        });
      }
      doc.getElementById('btn_save').addEventListener('click', () => {
        if (!win.confirm('저장하시겠습니까?')) { site.log.push(['save-no']); return; }
        if (saveFails) { win.alert(saveFails); return; }
        const rows = {};
        for (const r of GRID) {
          const text = doc.getElementById(`txtWork${r.row}`).value;
          const tr = doc.querySelector(`[onclick="showHideInput('${r.row}')"]`).closest('tr');
          if (text) rows[r.row] = { text, hour: tr.querySelector('#txtWHour').value, min: tr.querySelector('#txtWMin').value };
        }
        db[date] = { rows, time: ['drSH', 'drSM', 'drEH', 'drEM'].map((x) => doc.getElementById(x).value).join(','), status: 'saved' };
        site.log.push(['save', date]);
        leave(() => mount(id, 'list', { alert: saveAlert }));
      });
      doc.getElementById('btn_submit').addEventListener('click', () => {
        if (!win.confirm('제출하시겠습니까?')) { site.log.push(['submit-no']); return; }
        db[date].status = 'submitted';
        site.log.push(['submit', date]);
        leave(() => mount(id, 'list', { alert: '제출되었습니다.' }));
      });
    }
    frames.set(id, win);
    if (alert) win.alert(alert);
  }

  const api = {
    tabs: {
      create: async ({ url, active }) => {
        assert.equal(url, WRITE_URL);
        assert.equal(active, false, '뒤 탭');
        site.opened++;
        site.tab = 7;
        mount(0, 'top');
        mount(1, login ? 'login' : 'list');
        return { id: 7 };
      },
      get: async (id) => { if (site.tab !== id) throw new Error('No tab with id'); return { id }; },
      update: async (id, { url }) => { assert.equal(url, WRITE_URL); site.updated++; mount(1, 'list'); return { id }; },
      remove: async () => { site.tab = null; site.closed++; for (const w of frames.values()) w.close(); frames.clear(); },
    },
    scripting: {
      executeScript: async ({ target, func, args = [], world }) => {
        assert.equal(world, 'MAIN', '페이지 함수(showHideInput · $find · __doPostBack)를 부르려면 MAIN');
        if (site.tab !== target.tabId) throw new Error('No tab with id');
        const ids = target.allFrames ? [...frames.keys()] : target.frameIds;
        return ids.filter((i) => frames.has(i)).map((i) => ({ frameId: i, result: JSON.parse(JSON.stringify(frames.get(i).eval(`(${func})`)(...args) ?? null)) }));
      },
      registerContentScripts: async ([s]) => {
        assert.deepEqual({ id: s.id, js: s.js, world: s.world, runAt: s.runAt, allFrames: s.allFrames, persist: s.persistAcrossSessions }, { id: HOOK_ID, js: [HOOK_FILE], world: 'MAIN', runAt: 'document_start', allFrames: true, persist: false });
        site.hooked = true;
      },
      unregisterContentScripts: async ({ ids }) => { assert.deepEqual(ids, [HOOK_ID]); site.hooked = false; },
    },
  };
  return { api, site, frames };
}

/** 가상 시계 — 기다림마다 시계를 그만큼 넘기고 진짜로는 잠깐(페이지의 타이머가 돌게) 쉰다. */
function writerFor(api) {
  let clock = 0;
  return createDwrWriter({ api, now: () => clock, wait: async (ms) => { clock += ms; await new Promise((r) => setTimeout(r, 2)); } });
}
const DAY = { date: '2026-10-02', title: A, hours: 8, content: 'MVDC 시험기준 분석', trip: false, op: 'save' };

test('알림 글 — 안 됐다는 알림·확인에 아니오를 한 것만 실패, 글 견주기는 빈칸 차이를 보지 않는다', () => {
  assert.equal(failOf([{ kind: 'alert', text: '저장되었습니다.' }, { kind: 'confirm', text: '저장하시겠습니까?', answer: true }]), '');
  assert.equal(failOf([{ kind: 'alert', text: '업무내용을 입력하십시오.' }]), '업무내용을 입력하십시오.');
  assert.equal(failOf([{ kind: 'confirm', text: '이동하시겠습니까?', answer: false }]), '확인 창에 답하지 않았습니다: 이동하시겠습니까?');
  assert.equal(failOf(null), '');
  assert.ok(sameText(' a\n b ', 'a b'));
  assert.ok(!sameText('a', 'b'));
});

test('저장 — 뒤 탭으로 목록 → 쓰기 → 작성 화면, 날짜를 옮겨 그 줄(같은 이름이면 첫 줄)에 내용·시간을 넣고 저장, 처음부터 다시 열어 같으면 됐다. 다 쓰면 탭과 알림 받이를 치운다', async () => {
  const { api, site } = fakeEclass();
  const w = writerFor(api);
  const stages = [];
  const r = await w.writeDay({ ...DAY, hours: 7.5 }, { onStage: (s) => stages.push(s) });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'saved');
  assert.deepEqual([r.row, r.rowName], ['8', A]);
  assert.deepEqual(site.db['2026-10-02'], { rows: { 8: { text: DAY.content, hour: '7', min: '30' } }, time: '8,30,17,30', status: 'saved' }, '출장이 아니면 근무시간은 그대로');
  assert.deepEqual(r.dialogs.map((x) => [x.kind, x.text, x.answer]), [['confirm', '저장하시겠습니까?', true], ['alert', '저장되었습니다.', null]], '저장 확인에 예, 저장 뒤 알림은 창 대신 받아 둔다');
  assert.equal(site.updated, 1, '다시 읽기는 작성 화면을 처음부터');
  assert.deepEqual(stages, ['작성 화면 여는 중…', '칸 채우는 중…', '저장 중…', '저장한 것을 다시 읽는 중…']);
  assert.equal(site.session.get('krswsDwrAllow'), undefined, '확인 창의 예는 끈다');
  assert.equal(site.hooked, true);
  await w.close();
  assert.deepEqual([site.closed, site.hooked, w.tabId], [1, false, null]);
});

test('출장·외근 날은 근무시간을 09:00~18:00 으로', async () => {
  const { api, site } = fakeEclass();
  const w = writerFor(api);
  const r = await w.writeDay({ ...DAY, trip: true, content: 'K-Battery Show 참석' });
  assert.equal(r.status, 'saved');
  assert.equal(site.db['2026-10-02'].time, '9,0,18,0');
  await w.close();
});

test('그 날 이미 적은 업무가 있으면 쓰지 않는다(exists — 원본의 이중 작성 방지). 제출만은 그 줄 하나에 같은 내용이 있을 때 저장된 그대로 제출', async () => {
  const db = { '2026-10-02': { rows: { 12: { text: '드라이브 시험', hour: '8', min: '0' } }, status: 'saved' } };
  const { api, site } = fakeEclass({ db });
  const w = writerFor(api);
  const r = await w.writeDay(DAY);
  assert.deepEqual([r.ok, r.status], [false, 'exists']);
  assert.match(r.note, new RegExp(`이미 적은 업무가 있어 쓰지 않았습니다\\(${B}\\)`));
  assert.ok(!site.log.some(([k]) => k === 'save'));
  const s = await w.writeDay({ ...DAY, op: 'submit' });
  assert.equal(s.status, 'exists', '다른 줄의 내용은 제출하지 않는다');

  db['2026-10-03'] = { rows: { 8: { text: 'MVDC  시험기준 분석', hour: '8', min: '0' } }, status: 'saved' };
  const t = await w.writeDay({ ...DAY, date: '2026-10-03', op: 'submit' });
  assert.deepEqual([t.ok, t.status, t.row], [true, 'submitted', '8']);
  assert.equal(db['2026-10-03'].status, 'submitted');
  assert.ok(!site.log.some(([k, d]) => k === 'save' && d === '2026-10-03'), '저장하지 않고 제출만');
  await w.close();
});

test('제출 — 저장하고 처음부터 다시 읽어 맞은 뒤에만 제출을 누른다', async () => {
  const { api, site } = fakeEclass();
  const w = writerFor(api);
  const r = await w.writeDay({ ...DAY, op: 'submit' });
  assert.deepEqual([r.ok, r.status], [true, 'submitted']);
  assert.equal(site.db['2026-10-02'].status, 'submitted');
  const order = site.log.filter(([k]) => k === 'save' || k === 'submit').map(([k]) => k);
  assert.deepEqual(order, ['save', 'submit']);
  assert.equal(site.updated, 1);
  await w.close();
});

test('날짜 칸이 이미 그 날이면 하루 앞으로 갔다가 돌아온다(날짜를 옮겨야 그 날 것이 뜨는지 모른다)', async () => {
  const { api, site } = fakeEclass({ today: '2026-10-29' });
  const w = writerFor(api);
  const r = await w.writeDay({ ...DAY, date: '2026-10-29' });
  assert.equal(r.status, 'saved');
  assert.deepEqual(site.log.filter(([k]) => k === 'date').map(([, d]) => d).slice(0, 2), ['2026-10-28', '2026-10-29']);
  await w.close();
});

test('날짜 API 가 없으면 원본처럼 캘린더를 열어 달을 넘기고 그 달의 날(이웃 달 칸은 빼고)을 누른다', async () => {
  const { api, site } = fakeEclass({ picker: 'none' });
  const w = writerFor(api);
  const r = await w.writeDay({ ...DAY, date: '2026-08-28' });
  assert.equal(r.status, 'saved');
  assert.equal(site.log.find(([k]) => k === 'date')[1], '2026-08-28', '8월로 두 달 넘겨 28일 — 앞 달의 28(이웃 달 칸)이 아니라');
  assert.deepEqual(Object.keys(site.db), ['2026-08-28']);
  await w.close();
});

test('업무 목록에 맞는 줄이 없으면 쓰지 않고 까닭을 던진다. 저장이 알림으로 막히면 그 알림 글로 던진다', async () => {
  const { api } = fakeEclass();
  const w = writerFor(api);
  await assert.rejects(w.writeDay({ ...DAY, title: 'MMC 드라이브' }), /업무 목록에 "MMC 드라이브" 이 없습니다 — 작성 화면의 업무추가로/);
  await w.close();
  const bad = fakeEclass({ saveFails: '투입시간을 입력하십시오.' });
  const w2 = writerFor(bad.api);
  await assert.rejects(w2.writeDay(DAY), /저장하지 못했습니다 — 투입시간을 입력하십시오\./);
  assert.equal(bad.site.db['2026-10-02'], undefined);
  await w2.close();
});

test('e-Class 로그인이 풀려 있으면 AuthError', async () => {
  const { api, site } = fakeEclass({ login: true });
  const w = writerFor(api);
  await assert.rejects(w.writeDay(DAY), (err) => err instanceof AuthError);
  await w.close();
  assert.equal(site.closed, 1);
});

test('업무 목록이 긴 업무명을 줄여 보여도(풍선말에 온 이름) 정해 둔 e-Class 업무명의 줄에 쓴다 — AIP 는 「시험/인증업무>AIP 기술검토 및 관리」', async () => {
  const { api, site } = fakeEclass();
  const w = writerFor(api);
  const r = await w.writeDay({ ...DAY, title: AIP, content: 'AIP 개념승인 검토' });
  assert.deepEqual([r.status, r.row, r.rowName], ['saved', '6', AIP]);
  assert.equal(site.db['2026-10-02'].rows[6].text, 'AIP 개념승인 검토');
  await w.close();
});

test('한 작성기로 여러 날 — 탭은 하나', async () => {
  const { api, site } = fakeEclass();
  const w = writerFor(api);
  for (const date of ['2026-10-01', '2026-10-02']) assert.equal((await w.writeDay({ ...DAY, date })).status, 'saved');
  assert.equal(site.opened, 1);
  assert.deepEqual(Object.keys(site.db).sort(), ['2026-10-01', '2026-10-02']);
  await w.close();
});
