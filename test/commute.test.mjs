// 출퇴근 위반(src/commute.js + attendpanel.js) — 유연 종류에서 HR 자율출퇴근 체크리스트의 날마다 출근·퇴근을 근무시간(계획)과 맞춰
// 위반한 날만 보인다(2026-10-27 사용자 지정: "유연에 내 출근/퇴근 실제 시간이랑 기록되어 있는 시간이랑 비교해서 시간 위반한 내역을
// 볼 수 있도록"). HR 의 위반 표시(isPlanNotFollowed 'O')는 출장·연차·건강검진 날에도 붙어서 믿지 않고, 근태와 점심(12~13시)으로
// 비운 시간을 뺀 나머지에 자리에 없었는지로 다시 판정한다. 기록이 없는 출근·퇴근은 보지 않는다(2~3일 늦게 올라온다).
// 줄의 모양은 2026-10-27 실제 응답(/wrk/wrkcommute/wrkcommute100)이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { judgeDay, leavesOf, faultText, commuteBreaches, spanText, fixDefaults, recentBreaches, daysBefore, pruneFixes, COMMUTE_FIX_KEY } from '../src/commute.js';
import { buildCommuteJob } from '../src/attend.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, what) => {
  for (let i = 0; i < 240 && !ok(); i++) await wait(25);
  assert.ok(ok(), `기다렸지만 되지 않았다: ${what}`);
};

const row = (workDate, startTime, endTime, workStatus = '', over = {}) => ({
  workDate, days: '화', planTime: '0830 ~ 1730', startTime, endTime, workStatus, isPlanNotFollowed: '', nextDayInd: '', chngInd: '', ...over,
});
const kinds = (d) => d.faults.map((f) => (f.min ? `${f.kind} ${f.min}` : f.kind));

console.log('하루치 판정 — 계획 시간 가운데 근태·점심으로 덮이지 않은 시간에 자리에 없었으면 위반');
t('계획(08:30~17:30) 안에 와서 계획 뒤에 갔으면 위반이 없다 — 08:30 정각 출근도 지각이 아니다', () => {
  assert.deepEqual(kinds(judgeDay(row('2026-10-26', '0826', '1736'))), []);
  assert.deepEqual(kinds(judgeDay(row('2026-09-02', '0830', '1730'))), []);
});
t('늦게 오면 지각, 일찍 가면 조퇴 — 분으로 센다', () => {
  assert.deepEqual(kinds(judgeDay(row('2026-10-21', '0842', '1715'))), ['late 12', 'early 15']);
});
t('오후 건강검진(13:00~18:00) 날 12:06 퇴근은 조퇴가 아니다 — 12~13시는 점심, 그 뒤는 근태다 (HR 은 O 로 표시한다)', () => {
  const d = judgeDay(row('2026-10-08', '0825', '1206', '정기 건강검진(13:00~18:00)', { isPlanNotFollowed: 'O' }));
  assert.deepEqual([kinds(d), d.hr, d.covered], [[], true, false]);
});
t('오후 외근(13:00~18:00) 날 12:30 퇴근도 위반이 아니다. 11:30 에 갔으면 점심 전 30분이 조퇴다', () => {
  assert.deepEqual(kinds(judgeDay(row('2026-08-04', '0826', '1230', '외근(13:00~18:00)'))), []);
  assert.deepEqual(kinds(judgeDay(row('2026-08-04', '0826', '1130', '외근(13:00~18:00)'))), ['early 30']);
});
t('외근이 14:00 부터면 13:50 퇴근은 10분 조퇴다 — 근태와 근태 사이를 비운 것이다', () => {
  assert.deepEqual(kinds(judgeDay(row('2026-08-04', '0826', '1350', '외근(14:00~18:00)'))), ['early 10']);
});
t('외출(16:00~17:00) 은 그 한 시간만 덮는다 — 17:10 퇴근은 20분 조퇴', () => {
  assert.deepEqual(kinds(judgeDay(row('2026-09-01', '0828', '1740', '외출(16:00~17:00)'))), []);
  assert.deepEqual(kinds(judgeDay(row('2026-09-01', '0828', '1710', '외출(16:00~17:00)'))), ['early 20']);
});
t('연차·출장·건강검진처럼 하루를 다 쓴 날은 기록이 없어도 위반이 아니다 — 연차는 계획과 다른 09:00~18:00 으로 적혀 와도 하루 전체다', () => {
  for (const s of ['연차(09:00~18:00)', '국내출장(07:00~23:59)', '국내출장(00:00~20:00)', '정기 건강검진(09:00~18:00)']) {
    const d = judgeDay(row('2026-08-24', '', '', s, { isPlanNotFollowed: 'O' }));
    assert.deepEqual([kinds(d), d.covered], [[], true], s);
  }
});
t('오전 외근(09:00~11:00) 뒤 11:30 출근은 08:30~09:00 과 11:00~11:30 을 합쳐 지각 1시간이다', () => {
  assert.deepEqual(kinds(judgeDay(row('2026-10-14', '1130', '1735', '외근(09:00~11:00)'))), ['late 60']);
});
t('기록이 없는 출근·퇴근은 보지 않는다 — 2~3일 늦게 올라온다(2026-10-27 사용자 지정: "출퇴근 없음은 빼줘")', () => {
  assert.deepEqual(kinds(judgeDay(row('2026-10-14', '', ''))), []);
  assert.deepEqual(kinds(judgeDay(row('2026-10-14', '0825', ''))), []);
  assert.deepEqual(kinds(judgeDay(row('2026-10-14', '', '1740'))), []);
});
t('있는 쪽만 본다 — 출근만 있으면 지각, 퇴근만 있으면 조퇴', () => {
  assert.deepEqual(faultText(judgeDay(row('2026-10-14', '0850', ''))), ['지각 20분']);
  assert.deepEqual(faultText(judgeDay(row('2026-10-14', '', '1700'))), ['조퇴 30분']);
});
t('다음 날 퇴근(nextDayInd Y)은 조퇴가 아니다', () => {
  assert.deepEqual(kinds(judgeDay(row('2026-10-14', '0826', '0110', '', { nextDayInd: 'Y' }))), []);
});
t('계획이 없는 줄은 판정하지 않는다', () => {
  assert.equal(judgeDay(row('2026-10-14', '0900', '1800', '', { planTime: '' })), null);
});
t('줄에는 날짜·요일·계획·출근·퇴근이 시계 글로 실린다', () => {
  const d = judgeDay(row('2026-10-21', '0842', '1715'));
  assert.deepEqual([d.date, d.dow, d.plan, d.start, d.end], ['2026-10-21', '화', '08:30~17:30', '08:42', '17:15']);
});

console.log('근태내역 글 읽기 · 말');
t('여러 건이 쉼표로 와도 다 줍는다', () => {
  assert.deepEqual(leavesOf('외출(10:00~11:00), 외근(15:00~17:00)'),
    { whole: false, spans: [{ label: '외출', from: 600, to: 660 }, { label: '외근', from: 900, to: 1020 }] });
});
t('시각이 없는 근태가 있으면 하루 전체로 본다 — 모르는 근태로 위반을 만들지 않는다', () => {
  assert.equal(leavesOf('공가').whole, true);
  assert.equal(leavesOf('').whole, false);
});
t('시간 글: 59분까지는 분, 그 위는 시간과 분', () => {
  assert.deepEqual([spanText(12), spanText(60), spanText(84), spanText(324)], ['12분', '1시간', '1시간 24분', '5시간 24분']);
});

console.log('여러 날');
t('위반한 날만 최근 날이 위로 — HR 이 O 로 표시했지만 근태로 덮였거나 기록이 없는 날은 빼고 그 수를 센다(오늘은 세지 않는다)', () => {
  const rows = [
    row('2026-10-20', '0826', '1748'),
    row('2026-10-27', '', '', '', { isPlanNotFollowed: 'O' }),
    row('2026-10-08', '0825', '1206', '정기 건강검진(13:00~18:00)', { isPlanNotFollowed: 'O' }),
    row('2026-10-21', '0842', '1735', '', { isPlanNotFollowed: 'O' }),
    row('2026-09-10', '', '', '국내출장(00:00~20:00)', { isPlanNotFollowed: 'O' }),
    row('2026-10-23', '0827', '1710', '', { isPlanNotFollowed: 'O' }),
    row('2026-10-15', '', '', '', { isPlanNotFollowed: 'O' }),
  ];
  const r = commuteBreaches(rows, { today: '2026-10-27' });
  assert.deepEqual(r.days.map((d) => [d.date, faultText(d).join(',')]), [['2026-10-23', '조퇴 20분'], ['2026-10-21', '지각 12분']]);
  assert.deepEqual([r.judged, r.excused], [7, 3]);
});

console.log('변경신청 · 홈 카드 — 기본 시각, 지난 7일, 일감(2026-10-27)');
t('변경의 기본 시각 — 어긴 쪽만 계획 시각, 다른 쪽은 찍힌 그대로(없으면 계획). 익일 퇴근은 그대로 익일', () => {
  assert.deepEqual(fixDefaults(judgeDay(row('2026-10-21', '0842', '1745'))), { start: '08:30', end: '17:45', nextDay: false });
  assert.deepEqual(fixDefaults(judgeDay(row('2026-10-21', '0825', '1518'))), { start: '08:25', end: '17:30', nextDay: false });
  assert.deepEqual(fixDefaults(judgeDay(row('2026-10-21', '0842', '1518'))), { start: '08:30', end: '17:30', nextDay: false });
  assert.deepEqual(fixDefaults(judgeDay(row('2026-10-21', '0842', ''))), { start: '08:30', end: '17:30', nextDay: false });
  assert.deepEqual(fixDefaults(judgeDay(row('2026-10-21', '0842', '0110', '', { nextDayInd: 'Y' }))), { start: '08:30', end: '01:10', nextDay: true });
});
t('홈 카드 — 지난 7일(오늘 포함)의 위반만, 최근 날이 위', () => {
  const rows = [row('2026-10-27', '0840', ''), row('2026-10-21', '0842', '1745'), row('2026-10-20', '0842', '1745'), row('2026-10-23', '0825', '1600')];
  assert.deepEqual(recentBreaches(rows, '2026-10-27').map((d) => d.date), ['2026-10-27', '2026-10-23', '2026-10-21']);
  assert.equal(daysBefore('2026-03-02', 6), '2026-02-24', '달을 넘는다');
});
t('올린 변경신청은 60일 지나면 버린다 — 꼴이 틀린 것도', () => {
  assert.deepEqual(pruneFixes({ '2026-10-21': { docNo: 'A' }, '2026-08-01': { docNo: 'B' }, '2026-10-22': 'x' }, '2026-10-27'), { '2026-10-21': { docNo: 'A' } });
  assert.deepEqual(pruneFixes(null, '2026-10-27'), {});
});
t('일감 — 출/퇴근기록 변경신청 화면에서 그 날 줄(YYYYMMDD · 그 달 목록)을 넣고 변경 시각·익일·사유, 결재요청만', () => {
  const job = buildCommuteJob({ date: '2026-10-21', start: '08:30', end: '17:45', reason: '출근 태깅 누락' });
  assert.equal(job.route, '/uhr/docappr/apprtmchng100/view');
  assert.deepEqual(job.ready, { global: 'docapprtmchng100Grid', fn: 'apprRequest' });
  assert.deepEqual(job.ops, [{ op: 'commuteRow', grid: 'docapprtmchng100Grid', pop: '/uhr/docappr/apprtm-pop', month: '2026-10', workDate: '20261021',
    start: '08:30', end: '17:45', nextDay: 'N', reason: '출근 태깅 누락' }]);
  assert.deepEqual([job.action, job.fn, job.open], ['request', 'apprRequest', null]);
  assert.equal(buildCommuteJob({ date: '2026-10-21', start: '22:00', end: '01:00', nextDay: true, reason: '야근' }).ops[0].nextDay, 'Y');
});
t('일감 — 날짜·시각 꼴, 퇴근이 출근보다 늦은지(익일이 아니면), 사유가 없으면 던진다', () => {
  const ok = { date: '2026-10-21', start: '08:30', end: '17:30', reason: '누락' };
  assert.throws(() => buildCommuteJob({ ...ok, date: '10/21' }), /날짜가 아닙니다/);
  assert.throws(() => buildCommuteJob({ ...ok, start: '8:30' }), /HH:MM/);
  assert.throws(() => buildCommuteJob({ ...ok, end: '08:00' }), /늦어야 합니다/);
  assert.throws(() => buildCommuteJob({ ...ok, reason: '  ' }), /사유/);
});

/* ------------------------------------------------------------ 패널 — 유연 종류에서만 선다 */

console.log('패널 — 유연 종류를 고르면 신청 내역 위에 출퇴근 위반');
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8)}`;

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { window } = new JSDOM(html, { url: 'https://example.org/' });
const doc = window.document;
for (const g of ['document', 'DOMParser', 'FileReader', 'Element', 'HTMLElement', 'HTMLInputElement']) globalThis[g] = window[g];
globalThis.window = window;

const HR = 'https://hr.krs.co.kr';
// 지난 날 셋: 제때(위반 아님) · 지각 · 오후 건강검진으로 일찍 간 날(HR 은 O, 여기서는 뺀다).
const commuteRows = [
  row(plus(-1), '0826', '1736'),
  row(plus(-2), '0912', '1740', '', { isPlanNotFollowed: 'O' }),
  row(plus(-3), '0825', '1206', '정기 건강검진(13:00~18:00)', { isPlanNotFollowed: 'O' }),
];
const store = { attendKind: 'flex', attendView: '' };
const calls = [];
// 출/퇴근기록 변경신청 — hrRunJob 이 폼을 숨은 프레임에 띄우고(pageMount · frameProbe) 일감을 돌린다(frameRun). 일감만 받아 두고 됐다고 답한다.
const jobs = [];
globalThis.chrome = {
  storage: { local: {
    get: async () => store,
    set: async (obj) => { Object.assign(store, obj); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
  } },
  runtime: { sendNativeMessage: async () => { throw new Error('no host'); } },
  tabs: {
    get: async (id) => ({ id, url: `${HR}/`, status: 'complete' }),
    create: async () => ({ id: 7, url: `${HR}/`, status: 'complete' }),
    update: async (id) => ({ id }), remove: async () => {}, query: async () => [],
  },
  scripting: {
    executeScript: async ({ func, args }) => {
      if (func.name === 'pageShell') return [{ result: { href: `${HR}/`, shell: true, login: false } }];
      if (func.name === 'frameProbe') return [{ frameId: 3, result: { ready: true } }];
      if (func.name === 'frameRun') {
        jobs.push(args[0]);
        return [{ result: { ok: true, stage: 'done', docNo: '202610-11115-0009', errors: [], dialogs: [{ kind: 'alert', text: '결재 요청되었습니다.' }], read: { commuteRow: { workDate: args[0].ops[0].workDate } } } }];
      }
      if (func.name !== 'pageFetch') return [{ result: null }];
      const path = String(args[0]);
      calls.push(path);
      const ok = (v) => [{ result: { status: 200, url: '', text: JSON.stringify(v) } }];
      if (path === '/api/user') return ok({ loginUserId: '11115', loginUserNm: '김거화' });
      if (path.startsWith('/wrk/wrkcommute/wrkcommute100?')) return ok(commuteRows);
      if (path.startsWith('/uhr/docappr/apprflex100/current-week-work-time')) return ok({});
      return ok([]);
    },
  },
};
globalThis.fetch = async () => new Response(`<html><body>home${' '.repeat(1600)}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

const { createAttendPanel } = await import('../attendpanel.js');
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const panel = createAttendPanel({
  $: (id) => doc.getElementById(id), escapeHtml, logEvent: () => {}, ai: () => ({ apiKey: '', cli: false }),
  evidence: { list: async () => [], keep: async () => {}, remove: async () => {} },
});
panel.wire();
const st = panel.state;
const box = doc.getElementById('atCommute');
const lines = () => [...doc.querySelectorAll('#atCommuteList > li')].map((li) => [
  li.querySelector('.at-cm-date').textContent, li.querySelector('.at-cm-times').textContent, [...li.querySelectorAll('.at-cm-why em')].map((e) => e.textContent).join(''),
]);
const commuteCalls = () => calls.filter((p) => p.startsWith('/wrk/wrkcommute/wrkcommute100?'));
const SPANS = ['4w', '8w', '3m', '6m', '12m'];
const pressed = () => SPANS.map((s) => box.querySelector(`button[data-commute="${s}"]`).getAttribute('aria-pressed'));
const on = (s) => SPANS.map((x) => String(x === s));
const monthsBack = (n) => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth() - n, d.getDate())); };

await panel.show();
await until(() => st.commute?.rows, '출퇴근 기록 읽기');

t('유연 종류면 출퇴근 위반이 보이고, 위반한 날(지각)만 한 줄이다 — 근태로 덮인 건강검진 날은 없다', () => {
  assert.ok(!box.classList.contains('hidden'));
  assert.deepEqual(lines(), [[`${md(plus(-2))} 화`, '09:12 → 17:40', '지각 42분']]);
  assert.equal(doc.getElementById('atCommuteCount').textContent, '1');
});
t('제목 줄의 기간은 4주 전부터 오늘까지, 4W 가 켜져 있다. 그 기간을 내 사번으로 읽는다(조회 GET 하나 — 출근·퇴근을 적는 요청은 없다)', () => {
  assert.equal(doc.getElementById('atCommuteRange').textContent, `${md(plus(-28))} ~ ${md(plus(0))}`);
  assert.deepEqual(pressed(), on('4w'));
  assert.equal(commuteCalls().length, 1);
  assert.match(commuteCalls()[0], new RegExp(`fromDate=${plus(-28)}&toDate=${plus(0)}&emplNo=11115`));
  assert.ok(!calls.some((p) => /wrkcommute100\/(work|leave)/.test(p)));
});
t('HR 이 위반으로 표시했지만 근태로 덮여 뺀 날의 수는 제목의 풍선말에 있다', () => {
  assert.match(doc.getElementById('atCommuteTitle').title, /HR 이 위반으로 표시한 날 가운데 1일은 근태로 비웠거나 기록이 아직 없어 뺐습니다/);
});

console.log('패널 — 위반 줄의 변경(출/퇴근기록 변경신청, 2026-10-27)');
const lateLi = () => doc.querySelector(`#atCommuteList li[data-date="${plus(-2)}"]`);
const cm = (k) => doc.querySelector(`#atCommuteList [data-cm="${k}"]`);
const send = () => doc.querySelector('#atCommuteList [data-cmsend]');
t('어긴 시각은 붉다 — 지각이면 출근 시각(퇴근은 그대로). 줄마다 `변경`', () => {
  const bad = lateLi().querySelectorAll('.at-cm-bad');
  assert.deepEqual([...bad].map((b) => [b.textContent, b.title]), [['09:12', '지각']]);
  assert.ok(lateLi().querySelector('[data-cmfix]'));
  assert.equal(cm('start'), null, '누르기 전에는 변경 칸이 없다');
});
lateLi().querySelector('[data-cmfix]').click();
t('`변경`을 누르면 그 줄 아래에 변경 칸 — 지각이라 출근은 계획 시작(08:30), 퇴근은 찍힌 그대로(17:40), 사유 칸에 커서', () => {
  assert.deepEqual([cm('start').value, cm('end').value, cm('nextDay').checked, cm('reason').value], ['08:30', '17:40', false, '']);
  assert.equal(doc.activeElement, cm('reason'));
  assert.equal(send().textContent, '결재요청');
});
cm('reason').value = '출근 태깅 누락';
cm('reason').dispatchEvent(new window.Event('input', { bubbles: true }));
send().click();
t('결재요청은 두 번 누른다 — 처음에는 한 번 더 누르라고만 하고 HR 에 가지 않는다. 다시 그려도 쓴 사유는 그대로', () => {
  assert.equal(send().textContent, '한 번 더 누르면 결재요청');
  assert.equal(cm('reason').value, '출근 태깅 누락');
  assert.equal(jobs.length, 0);
});
send().click();
await until(() => store[COMMUTE_FIX_KEY]?.[plus(-2)], '변경신청 올리기');
t('두 번째에 행위 attend.commute 로 HR 「출/퇴근기록 변경신청」 — 그 날 줄(YYYYMMDD)과 변경 시각·사유, 결재요청', () => {
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].route, '/uhr/docappr/apprtmchng100/view');
  assert.deepEqual(jobs[0].ops[0], { op: 'commuteRow', grid: 'docapprtmchng100Grid', pop: '/uhr/docappr/apprtm-pop', month: plus(-2).slice(0, 7),
    workDate: plus(-2).replace(/-/g, ''), start: '08:30', end: '17:40', nextDay: 'N', reason: '출근 태깅 누락' });
  assert.equal(jobs[0].fn, 'apprRequest');
});
t('올렸으면 그 날을 적어 두고(attendCommuteFix — 홈 카드도 뺀다) 줄은 `변경` 대신 "변경 신청함", 변경 칸은 닫힌다', () => {
  assert.deepEqual({ ...store[COMMUTE_FIX_KEY][plus(-2)], at: 0 }, { at: 0, docNo: '202610-11115-0009', start: '08:30', end: '17:40' });
  assert.equal(lateLi().querySelector('.at-cm-sent').textContent, '변경 신청함');
  assert.equal(lateLi().querySelector('[data-cmfix]'), null);
  assert.equal(cm('start'), null);
  assert.match(doc.getElementById('atStatus').textContent, /변경신청을 결재요청했습니다/);
});
delete store[COMMUTE_FIX_KEY];
st.cmFixed = {};
panel.seekCommute(plus(-2));
t('홈 카드의 `변경`에서 오면(seekCommute) 유연에서 그 날의 변경 칸이 바로 열린다', () => {
  assert.equal(st.form.kind, 'flex');
  assert.ok(cm('start'), '변경 칸');
  assert.equal(lateLi().classList.contains('editing'), true);
});
cm('start').value = '0845';
cm('start').dispatchEvent(new window.Event('input', { bubbles: true }));
t('시각은 24시간 HH:MM — "0845" 로 넣어도 08:45 로 맞춘다', () => assert.equal(st.cmFix.start, '08:45'));
doc.querySelector('#atCommuteList [data-cmclose]').click();
t('× 로 닫는다', () => assert.equal(cm('start'), null));

box.querySelector('button[data-commute="8w"]').click();
await until(() => st.commute?.span === '8w', '8주 읽기');
t('8W 를 누르면 8주 전부터 오늘까지를 곧바로 읽는다', () => {
  assert.deepEqual(pressed(), on('8w'));
  assert.match(commuteCalls().at(-1), new RegExp(`fromDate=${plus(-56)}&toDate=${plus(0)}`));
  assert.equal(doc.getElementById('atCommuteRange').textContent, `${md(plus(-56))} ~ ${md(plus(0))}`);
});

t('제목 줄의 기간 버튼은 4W · 8W · 3M · 6M · 12M 차례다(2026-10-27 사용자 지정: 3·6·12개월)', () => {
  assert.deepEqual([...box.querySelectorAll('button[data-commute]')].map((b) => b.textContent), ['4W', '8W', '3M', '6M', '12M']);
});
box.querySelector('button[data-commute="3m"]').click();
await until(() => st.commute?.span === '3m', '3개월 읽기');
t('3M 을 누르면 3개월 전 같은 날부터 오늘까지를 곧바로 읽는다', () => {
  assert.deepEqual(pressed(), on('3m'));
  assert.match(commuteCalls().at(-1), new RegExp(`fromDate=${monthsBack(3)}&toDate=${plus(0)}`));
});
box.querySelector('button[data-commute="12m"]').click();
await until(() => st.commute?.span === '12m', '12개월 읽기');
t('12M 은 1년 전 같은 날부터 — 해가 걸치므로 제목 줄의 기간에 연도가 붙는다. 읽기는 여전히 GET 하나', () => {
  const from = monthsBack(12);
  assert.deepEqual(pressed(), on('12m'));
  assert.match(commuteCalls().at(-1), new RegExp(`fromDate=${from}&toDate=${plus(0)}`));
  assert.equal(doc.getElementById('atCommuteRange').textContent, `${from.slice(2, 4)}/${md(from)} ~ ${plus(0).slice(2, 4)}/${md(plus(0))}`);
  assert.equal(commuteCalls().length, 4);
});
box.querySelector('button[data-commute="12m"]').click();
t('켜진 버튼을 다시 눌러도 다시 읽지 않는다', () => assert.equal(commuteCalls().length, 4));

doc.querySelector('#atKinds button[data-kind="leave"]').click();
t('다른 종류를 고르면 숨는다', () => assert.ok(box.classList.contains('hidden')));
doc.querySelector('#atKinds button[data-view="all"]').click();
t('"내역"(모든 종류)에서도 숨는다', () => assert.ok(box.classList.contains('hidden')));

commuteRows.splice(1, 1);
doc.querySelector('#atKinds button[data-kind="flex"]').click();
await panel.reload();
await until(() => st.commute?.rows, '다시 읽기');
t('탭을 다시 열면(reload) 다시 읽는다 — 위반이 없으면 그렇다고 한 줄', () => {
  assert.deepEqual(lines(), []);
  assert.equal(doc.getElementById('atCommuteEmpty').textContent, '위반한 날이 없습니다 (근무일 2일)');
  assert.equal(doc.getElementById('atCommuteCount').textContent, '');
});

console.log(`\n통과 ${pass}건`);
process.exit(0);
