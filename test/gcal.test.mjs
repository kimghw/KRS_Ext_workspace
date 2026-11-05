// 근태 → 구글 캘린더 일정 창(2026-11-03 사용자 지정: "근태 올릴때 구글 캘린더에 이런식으로 넣을 수 있게 옵션을 넣어줘. 사전정산, 차량조회 옆에 G캘린더").
//
// 못 박는 것: 제목은 팀 캘린더의 꼴 `[종류-이름] 목적(출장지, 장소)`, 출장·휴가·반차·하루 전체 건강검진은 종일(끝은 다음 날),
// 외근·교육·외출·시간 건강검진은 시각(Asia/Seoul), 유연근무는 없다. 패널은 G캘린더를 켜고 결재요청이 목록에서 확인된 뒤에만
// 그 주소를 새 탭으로 열고(임시저장·끈 것은 열지 않는다), 고른 것을 기억한다(attendGcal).
// HR 은 흉내 낸다 — **실제 사이트에는 아무것도 보내지 않는다.**
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, what) => {
  for (let i = 0; i < 320 && !ok(); i++) await wait(25);
  assert.ok(ok(), `기다렸지만 되지 않았다: ${what}`);
};

const { gcalEvent, gcalUrl, gcalLabel, gcalKind, GCAL_TEMPLATE } = await import('../src/gcal.js');
const { blankForm, settle, fieldsFor } = await import('../src/attend.js');
const TODAY = '2026-11-03';
const form = (kind, over) => settle({ ...blankForm(kind, TODAY), ...over });
const ME = { name: '김거화', docNo: '202611-11115-0001' };

console.log('일정 — 제목·날짜');
t('출장: [출장-이름] 목적(출장지, 장소), 종일 일정이고 끝은 도착일 다음 날, 장소는 "출장지 장소"', () => {
  const ev = gcalEvent(form('trip', { dateFrom: '2026-11-13', days: 2, place: '울산', venue: 'KSC', purpose: '선박용 CO2 포집 단위 모듈 시험' }), ME);
  assert.equal(ev.title, '[출장-김거화] 선박용 CO2 포집 단위 모듈 시험(울산, KSC)');
  assert.deepEqual([ev.allDay, ev.dates, ev.location], [true, '20261113/20261115', '울산 KSC']);
  assert.match(ev.details, /^HR 근태 신청 — 출장 11\/13~11\/14 07:00~20:00/);
  assert.match(ev.details, /\n문서번호 202611-11115-0001$/);
  assert.equal(gcalEvent(form('trip', { dateFrom: '2026-11-13', place: '세종', purpose: 'SSCB 진도점검' }), ME).title, '[출장-김거화] SSCB 진도점검(세종)');
});
t('외근·교육·외출은 시각이 있는 일정이다(시작~시작+몇 시간)', () => {
  const out = gcalEvent(form('out', { dateFrom: '2026-11-10', start: '14:00', span: 150, purpose: '과제 협의 (부산시청)' }), ME);
  assert.deepEqual([out.title, out.allDay, out.dates, out.location], ['[외근-김거화] 과제 협의 (부산시청)', false, '20261110T140000/20261110T163000', '']);
  assert.equal(gcalLabel(form('out', { sub: 'TR' })), '교육');
  assert.equal(gcalLabel(form('out', { sub: 'MEET' })), '외근', '부서소통회도 외근이다');
  const lo = gcalEvent(form('leaveout', { dateFrom: '2026-11-10', start: '16:00', span: 60, purpose: '병원 방문' }), ME);
  assert.deepEqual([lo.title, lo.dates], ['[외출-김거화] 병원 방문', '20261110T160000/20261110T170000']);
});
t('휴가: 연차·체력단련·오전반차·오후반차는 제목에 종류만, 종일 일정', () => {
  const ly = gcalEvent(form('leave', { dateFrom: '2026-11-20', days: 3 }), ME);
  assert.deepEqual([ly.title, ly.allDay, ly.dates], ['[연차-김거화]', true, '20261120/20261123']);
  assert.equal(gcalEvent(form('leave', { dateFrom: '2026-11-20', half: 'pm' }), ME).title, '[오후반차-김거화]');
  assert.equal(gcalEvent(form('leave', { dateFrom: '2026-11-20', half: 'am' }), ME).title, '[오전반차-김거화]');
  assert.equal(gcalEvent(form('leave', { dateFrom: '2026-11-20', sub: 'LH' }), ME).title, '[체력단련-김거화]');
});
t('건강검진: 하루 전체면 종일, 시간이면 시각. 사유가 "건강검진"이면 제목에 한 번만', () => {
  const all = gcalEvent(form('health', { dateFrom: '2026-11-20', purpose: '건강검진' }), ME);
  assert.deepEqual([all.title, all.allDay, all.dates], ['[건강검진-김거화]', true, '20261120/20261121']);
  const part = gcalEvent(form('health', { dateFrom: '2026-11-20', allDay: false, start: '13:00', span: 300, purpose: '2차 검사' }), ME);
  assert.deepEqual([part.title, part.allDay, part.dates], ['[건강검진-김거화] 2차 검사', false, '20261120T130000/20261120T180000']);
});
t('이름이 없으면 [종류] 만, 유연근무·날짜 없는 폼은 일정이 없다', () => {
  assert.equal(gcalEvent(form('leave', { dateFrom: '2026-11-20' })).title, '[연차]');
  assert.equal(gcalEvent(form('flex', { dateFrom: '2026-11-20', flexStart: '09:00' }), ME), null);
  assert.equal(gcalEvent(form('leave', { dateFrom: '' }), ME), null);
  assert.equal(gcalUrl(form('flex', {}), ME), '');
  assert.deepEqual(['trip', 'out', 'leaveout', 'leave', 'health', 'flex'].map(gcalKind), [true, true, true, true, true, false]);
});
t('주소는 구글 캘린더 TEMPLATE — 시각 일정에만 시간대(ctz)가 붙는다', () => {
  const url = new URL(gcalUrl(form('trip', { dateFrom: '2026-11-13', place: '울산', venue: 'KSC', purpose: '시험' }), ME));
  assert.equal(`${url.origin}${url.pathname}`, GCAL_TEMPLATE);
  assert.deepEqual([url.searchParams.get('action'), url.searchParams.get('text'), url.searchParams.get('dates'), url.searchParams.get('location'), url.searchParams.get('ctz')],
    ['TEMPLATE', '[출장-김거화] 시험(울산, KSC)', '20261113/20261114', '울산 KSC', null]);
  const timed = new URL(gcalUrl(form('out', { dateFrom: '2026-11-10', start: '14:00', span: 60, purpose: '협의' }), ME));
  assert.deepEqual([timed.searchParams.get('ctz'), timed.searchParams.has('location')], ['Asia/Seoul', false]);
});
t('폼: G캘린더 단추(G 아이콘)는 옵션 줄 끝(출장은 계산서·차량·KTX·항공기 옆)이고 기본은 꺼짐, 유연근무에는 없다', () => {
  const opts = (kind) => fieldsFor(blankForm(kind, TODAY)).filter((f) => f.group === 'opts').map((f) => f.key);
  assert.deepEqual(['trip', 'out', 'leaveout', 'leave', 'health'].map(opts), [['settle', 'car', 'ktx', 'flight', 'gcal'], ['car', 'gcal'], ['gcal'], ['wfa', 'gcal'], ['gcal']]);
  assert.equal(fieldsFor(blankForm('flex', TODAY)).some((f) => f.key === 'gcal'), false);
  const box = fieldsFor(blankForm('trip', TODAY)).find((f) => f.key === 'gcal');
  assert.deepEqual([box.type, box.icon, box.label, box.required, blankForm('trip', TODAY).gcal], ['toggle', 'gcal', 'G캘린더', false, false]);
});

/* ------------------------------------------------------------ 패널 — 결재요청 뒤 일정 창 */

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { window } = new JSDOM(html, { url: 'https://example.org/' });
const doc = window.document;
for (const g of ['document', 'DOMParser', 'FileReader', 'Element', 'HTMLElement', 'HTMLInputElement']) globalThis[g] = window[g];
globalThis.window = window;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 다음 주 수요일 — 주말이 아니어야 외근을 올릴 수 있다.
const DAY = (() => { const d = new Date(); d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7 || 7)); return ymd(d); })();
const HR = 'https://hr.krs.co.kr';
const hrRows = [];
const site = { jobs: [], tabs: [], seq: 0 };
const store = { attendKind: 'out', myName: '설정이름' };
globalThis.chrome = {
  storage: { local: {
    get: async () => store,
    set: async (obj) => { Object.assign(store, obj); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
  } },
  runtime: { sendNativeMessage: async () => { throw new Error('no host'); } },
  tabs: {
    get: async (id) => ({ id, url: `${HR}/`, status: 'complete' }),
    // HR 작업 탭(SSO)도 이것으로 열린다 — 구글 캘린더 창만 센다.
    create: async (o) => { if (String(o?.url || '').startsWith(GCAL_TEMPLATE)) site.tabs.push(o); return { id: 7, url: `${HR}/`, status: 'complete' }; },
    update: async (id) => ({ id }), remove: async () => {}, query: async () => [],
  },
  scripting: {
    executeScript: async ({ func, args }) => {
      if (func.name === 'pageShell') return [{ result: { href: `${HR}/`, shell: true, login: false } }];
      if (func.name === 'frameProbe') return [{ frameId: 1, result: { ready: true } }];
      if (func.name === 'frameRun') {
        const job = args[0];
        site.jobs.push(job);
        const docNo = `N-${++site.seq}`;
        hrRows.push({ docNo, statusCode: job.action === 'request' ? '3' : '1', statusName: job.action === 'request' ? '결재요청' : '임시저장', formId: 'TRO',
          formName: '외근/교육 신청서', workCodeKindName: '외근', startDate: DAY.replace(/-/g, ''), endDate: DAY.replace(/-/g, ''), startTime: '1400', endTime: '1600',
          wrkGubunName: '시간', reqRsn: '과제 협의', reqstDate: `${ymd(new Date())} 10:00:00`, pgmUrlAd: '/uhr/docappr/approut100/view' });
        return [{ result: { ok: true, errors: [], dialogs: [], read: {}, docNo, stage: 'done', message: '' } }];
      }
      if (func.name !== 'pageFetch') return [{ result: null }];
      if (args[0] === '/api/user') return [{ result: { status: 200, url: '', text: JSON.stringify({ loginUserId: '11115', loginUserNm: '김거화' }) } }];
      return [{ result: { status: 200, url: '', text: JSON.stringify(hrRows) } }];
    },
  },
};
globalThis.fetch = async (url, init = {}) => {
  if (init.method === 'POST') throw new Error('모르는 쓰기 주소 ' + url);
  return new Response('<html><body>home</body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
};

const { createAttendPanel } = await import('../attendpanel.js');
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const panel = createAttendPanel({
  $: (id) => doc.getElementById(id), escapeHtml, logEvent: () => {}, ai: () => ({ apiKey: '', cli: false }),
  evidence: { list: async () => [], keep: async () => {}, remove: async () => {} },
});
panel.wire();
const st = panel.state;
const $ = (id) => doc.getElementById(id);
/** 외근 폼을 채운다 — 날짜·시각은 상태에, 목적은 칸에 쳐서 화면이 다시 그려지게. */
const fill = () => {
  st.form = settle({ ...st.form, dateFrom: DAY, start: '14:00', span: 120 });
  const p = $('at_purpose');
  p.value = '과제 협의';
  p.dispatchEvent(new window.Event('input', { bubbles: true }));
};
// G캘린더는 G 아이콘 단추다(2026-11-05) — 켜짐은 aria-pressed, 누르면 뒤집힌다.
const pressed = () => $('at_gcal').getAttribute('aria-pressed') === 'true';
const tick = (on) => { if (pressed() !== on) $('at_gcal').click(); };

console.log('패널 — G캘린더');
await panel.show();
await until(() => st.loadedOnce && st.me, '신청 내역과 HR 의 나');
await ta('외근 폼의 옵션 줄에 차량 조회와 G캘린더가 나란히 서고, 처음에는 꺼져 있다', async () => {
  assert.deepEqual([...doc.querySelector('#atFields .at-group.at-opts').children].map((n) => n.dataset.key), ['car', 'gcal']);
  assert.equal($('at_gcal').tagName, 'BUTTON', '체크 박스가 아니라 G 아이콘 단추');
  assert.equal(pressed(), false);
});
fill();
tick(true);
await ta('켜면 그 선택을 기억하고, 올릴 내용에 구글 캘린더 일정 창이 적힌다', async () => {
  assert.equal(store.attendGcal, true);
  assert.equal(st.form.gcal, true);
  assert.match($('atNeed').textContent, /→ 구글 캘린더 일정 창$/);
});
$('atSave').click();
await until(() => site.jobs.length === 1 && !st.busy, '임시저장');
await ta('임시저장에서는 일정 창을 열지 않는다', async () => {
  assert.equal(site.jobs[0].action, 'save');
  assert.equal(site.tabs.length, 0);
});
fill();
await ta('새 폼도 켜 둔 G캘린더를 따른다', async () => assert.equal(pressed(), true));
$('atSubmit').click();
await until(() => site.jobs.length === 2 && !st.busy, '결재요청');
await ta('결재요청이 목록에서 확인되면 [외근-HR 의 내 이름] 제목의 구글 캘린더 일정 창을 새 탭으로 연다', async () => {
  assert.equal(site.tabs.length, 1);
  const url = new URL(site.tabs[0].url);
  assert.equal(`${url.origin}${url.pathname}`, GCAL_TEMPLATE);
  assert.equal(url.searchParams.get('text'), '[외근-김거화] 과제 협의');
  assert.equal(url.searchParams.get('dates'), `${DAY.replace(/-/g, '')}T140000/${DAY.replace(/-/g, '')}T160000`);
  assert.match(url.searchParams.get('details'), /문서번호 N-2$/);
  assert.equal(site.tabs[0].active, true);
  assert.match($('atStatus').textContent, /구글 캘린더 일정 창을 열었습니다 — 캘린더를 고르고 \[저장\]을 누르세요/);
});
fill();
tick(false);
$('atSubmit').click();
await until(() => site.jobs.length === 3 && !st.busy, '결재요청(G캘린더 끔)');
await ta('끄면 결재요청해도 열지 않고, 끈 것을 기억한다', async () => {
  assert.equal(site.tabs.length, 1);
  assert.equal(store.attendGcal, false);
});

console.log(`\n통과 ${pass}건`);
process.exit(0);
