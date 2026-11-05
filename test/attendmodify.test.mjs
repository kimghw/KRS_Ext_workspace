// 결재완료 근태의 근태 변경 = HR 근태수정신청(2026-11-03 HR 공지 「기결재 근태 수정 프로세스 변경」 — 취소신청 → 취소결재 → 새 상신 대신
// 수정신청 → 수정결재, 사용자 지정: "근태 수정에서 이거 반영해줘").
//
// 못 박는 것: 결재완료 줄의 `근태 변경`은 한 번에 같은 내용을 폼에 불러올 뿐 HR 에 아무것도 보내지 않는다(취소신청 칸도 펴지 않는다),
// 폼은 "… 수정신청 · 원 문서번호"이고 임시저장이 숨는다, 결재요청하면 원 문서를 수정 모드(open.modify)로 여는 일감 하나만 나가고
// 취소신청(cancelRow)·취소 중 기록은 없다, 새 문서를 목록에서 확인한 뒤 "기존 근태는 그대로"라고 말한다.
// HR 은 흉내 낸다 — **실제 사이트에는 아무것도 보내지 않는다.** 실제 화면에서의 수정 모드 전환은 2026-11-03 에 누르지 않는 건식으로 확인했다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, what) => {
  for (let i = 0; i < 320 && !ok(); i++) await wait(25);
  assert.ok(ok(), `기다렸지만 되지 않았다: ${what}`);
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { window } = new JSDOM(html, { url: 'https://example.org/' });
const doc = window.document;
for (const g of ['document', 'DOMParser', 'FileReader', 'Element', 'HTMLElement', 'HTMLInputElement']) globalThis[g] = window[g];
globalThis.window = window;

/* ------------------------------------------------------------ 가짜 HR 문서함 */

const HR = 'https://hr.krs.co.kr';
const DAY = plus(7);
const hrRows = [{
  docNo: 'D-1', statusCode: '5', statusName: '결재완료', formId: 'TRO', formName: '외근/교육 신청서', workCodeKindName: '외근',
  startDate: DAY.replace(/-/g, ''), endDate: DAY.replace(/-/g, ''), startTime: '1300', endTime: '1500', wrkGubunName: '시간',
  reqRsn: '과제 협의', reqstDate: `${plus(-3)} 09:00:00`, pgmUrlAd: '/uhr/docappr/approut100/view',
}];
// 문서 조회(외근/교육 신청서) — 패널 폼으로 되돌리는 칸만.
const DOC = { docNo: 'D-1', biztripKind: 'OD', wrkGubun: '04', biztripDateFrom: DAY, biztripDateTo: DAY,
  strHour: '13', strMin: '00', endHour: '15', endMin: '00', biztripContent: '과제 협의', biztripExpKind: 'N' };
const site = { jobs: [], docReads: [] };

const store = { attendKind: 'out', attendView: 'all' };
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
      if (func.name === 'frameProbe') return [{ frameId: 1, result: { ready: true } }];
      if (func.name === 'frameRun') {
        const job = args[0];
        site.jobs.push(job);
        // 수정결재요청이 올라가면 원 문서를 잇는 새 문서가 목록에 결재요청으로 선다. 원 문서는 그대로 결재완료다.
        hrRows.push({ ...hrRows[0], docNo: 'M-1', statusCode: '3', statusName: '결재요청', startTime: '1400', endTime: '1600', reqstDate: `${plus(0)} 10:00:00` });
        return [{ result: { ok: true, errors: [], dialogs: [], read: { bfDocNo: job.open?.docNo || '' }, docNo: 'M-1', stage: 'done', message: '결재 요청되었습니다.' } }];
      }
      if (func.name !== 'pageFetch') return [{ result: null }];
      if (args[0] === '/api/user') return [{ result: { status: 200, url: '', text: JSON.stringify({ loginUserId: '11115', loginUserNm: '김거화' }) } }];
      if (String(args[0]).startsWith('/uhr/docappr/approut100?')) {
        site.docReads.push(args[0]);
        return [{ result: { status: 200, url: '', text: JSON.stringify([DOC]) } }];
      }
      return [{ result: { status: 200, url: '', text: JSON.stringify(hrRows) } }];
    },
  },
};
globalThis.fetch = async (url, init = {}) => {
  if (init.method === 'POST') throw new Error('모르는 쓰기 주소 ' + url);
  return new Response('<html><body>home</body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
};

/* ------------------------------------------------------------ 패널 */

const { CANCELLING_KEY } = await import('../src/attend.js');
const { createAttendPanel } = await import('../attendpanel.js');
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const logs = [];
const panel = createAttendPanel({
  $: (id) => doc.getElementById(id), escapeHtml, logEvent: (kind, ok, text, data) => logs.push({ kind, ok, text, data }), ai: () => ({ apiKey: '', cli: false }),
  evidence: { list: async () => [], keep: async () => {}, remove: async () => {} },
});
panel.wire();
const st = panel.state;
const li = (docNo = 'D-1') => [...doc.querySelectorAll('#atList > li')].find((x) => x.querySelector('.at-head') && st.items[+x.dataset.i]?.docNo === docNo);
const btn = (act) => li()?.querySelector(`button[data-act="${act}"]`);
const $ = (id) => doc.getElementById(id);

console.log('결재완료 근태의 근태 변경 — 근태수정신청');
await panel.show();
await until(() => li(), '신청 내역');
li().querySelector('.at-head').click();
await until(() => btn('change'), '펴진 외근 카드');
await ta('결재완료 줄에는 근태 변경과 취소신청이 서고, 근태 변경 설명은 근태수정신청이다', async () => {
  assert.ok(btn('cancel'));
  assert.match(btn('change').title, /HR 근태수정신청/);
});
btn('change').click();
await until(() => st.edit?.docNo === 'D-1' && !st.busy, '폼에 불러옴');
await ta('한 번 누르면 같은 내용이 폼에 불러와지고 HR 에는 아무것도 나가지 않는다(취소 사유 칸도 펴지 않는다)', async () => {
  assert.equal(site.jobs.length, 0);
  assert.equal(site.docReads.length, 1);
  assert.equal($('atCancelReason'), null);
  assert.equal(st.form.kind, 'out');
  assert.deepEqual([st.form.dateFrom, st.form.start, st.form.end, st.form.purpose], [DAY, '13:00', '15:00', '과제 협의']);
  assert.match($('atStatus').textContent, /근태수정신청으로 불러왔습니다 — 고친 뒤 결재요청하세요\. 기존 근태는 수정결재가 승인될 때까지 그대로입니다/);
});
await ta('폼 제목은 "… 수정신청 · 원 문서번호", 임시저장은 숨고 그만두기는 "수정신청 그만두기", 올릴 내용에 근태수정신청이 적힌다', async () => {
  assert.match($('atFormTitle').textContent, /수정신청 · D-1$/);
  assert.ok($('atSave').classList.contains('hidden'));
  assert.ok($('atSave').disabled);
  assert.equal($('atSubmit').classList.contains('hidden'), false);
  assert.equal($('atEditCancel').textContent, '수정신청 그만두기');
  assert.match($('atEditNote').textContent, /HR 근태수정신청으로 고칩니다/);
  assert.match($('atNeed').textContent, /근태수정신청\(D-1\)/);
});
// 시간을 고친다 — 13:00~15:00 → 14:00~16:00.
st.form = { ...st.form, start: '14:00', end: '16:00', span: 120 };
$('atSubmit').click();
await until(() => site.jobs.length === 1 && !st.busy, '결재요청');
await ta('결재요청하면 원 문서를 수정 모드로 여는 일감 하나만 나간다 — 종류는 다시 넣지 않고, 원 문서번호를 확인한 뒤 누른다', async () => {
  const job = site.jobs[0];
  assert.deepEqual(job.open, { docNo: 'D-1', statusCode: '5', modify: true, related: '/uhr/docappr/approut100/related-modifications' });
  assert.equal(job.fn, 'apprRequest');
  assert.equal(job.ops.some((o) => o.op === 'cancelRow'), false);
  assert.equal(job.ops.some((o) => o.sel === '#biztripKind'), false);
  assert.ok(job.ops.some((o) => o.sel === '#strHour' && o.value === '14'));
  assert.deepEqual(job.expect[0], { sel: '#bfDocNo', value: 'D-1', label: '원 문서번호(근태수정신청)' });
});
await ta('새 문서를 목록에서 확인하고 "기존 근태는 그대로"라고 말한다 — 취소 중 기록은 없고, 폼은 비워진다', async () => {
  assert.match($('atStatus').textContent, /^결재요청했습니다 — 근태수정신청\(D-1\) .* · M-1 \(결재요청\) · 기존 근태\(D-1\)는 수정결재가 승인될 때까지 그대로입니다/);
  assert.equal(store[CANCELLING_KEY], undefined);
  assert.equal(st.edit, null);
  const log = logs.find((l) => l.kind === 'attend' && /M-1/.test(l.text));
  assert.ok(log?.ok, JSON.stringify(logs));
  assert.equal(log.data?.modifyOf, 'D-1');
});

console.log(`\n통과 ${pass}건`);
process.exit(0);
