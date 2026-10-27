// 홈의 WORKSPACE 카드에 띄울 지난 7일의 출퇴근 기록(src/commuteweek.js)과, 카드 대신 그것을 읽어 주는 배경(background.js).
// (2026-10-27 사용자 지정: "출퇴근 위반이 발생하면 여기에 뜨고 수정할 수 있도록 해줘" · "워크스페이스는 1주일 이전까지만 보이게 해줘")
//
// 지키려는 것은 근태(test/plans.test.mjs)와 같다.
//   - 하루에 한 번만 HR 을 연다. 오늘 읽어 둔 것이 있으면 그것을 쓴다. 읽는 창은 오늘 포함 이레(오늘−6 ~ 오늘)다.
//   - 배경은 **자기가 연** HR 작업 탭만 닫는다. 홈 카드가 근태와 출퇴근 기록을 함께 부탁하면 탭은 한 번 열고 한 번 닫는다.
//
// 이 파일은 DOM 없이 돈다 — 배경은 서비스 워커라 document 가 없다.
import assert from 'node:assert/strict';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const TODAY = plus(0);

const HR = 'https://hr.krs.co.kr';
/** HR 체크리스트의 한 줄(src/commute.js 가 읽는 모양). */
const CM = { workDate: TODAY, days: '화', planTime: '0830 ~ 1730', startTime: '0842', endTime: '', workStatus: '', isPlanNotFollowed: 'O', nextDayInd: '' };
/** HR 문서함의 한 줄 — 근태 읽기(hrPlans)가 같이 돌 때 쓴다. */
const DOC = {
  docNo: 'T-1', statusCode: '5', statusName: '결재완료', formId: 'TR', formName: '출장신청서', workCodeKindName: '국내출장',
  startDate: plus(3).replace(/-/g, ''), endDate: plus(4).replace(/-/g, ''), startTime: '0700', endTime: '2000',
  wrkGubunName: '시간', reqRsn: '착수회의', pgmUrlAd: '/uhr/docappr/apprtrav100/view',
};

/**
 * 확장 API 흉내(test/plans.test.mjs 와 같다). HR 작업 탭은 열자마자 HR 첫 화면에 닿은 것으로 치고, 그 안에서 도는 함수는
 * 이름으로 가려 답한다 — 출퇴근 체크리스트 주소면 CM 을, 문서함이면 DOC 를 준다. calls 에 무엇을 했는지 적는다.
 */
function fakeChrome({ store = {}, tabs = {}, fails = false } = {}) {
  const calls = { created: [], removed: [], fetched: [], listeners: [] };
  const live = { ...tabs };
  let nextId = 7;
  globalThis.chrome = {
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
    runtime: { onMessage: { addListener: (fn) => calls.listeners.push(fn) } },
    storage: {
      local: {
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]])),
        set: async (obj) => { Object.assign(store, obj); },
        remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
      },
    },
    tabs: {
      get: async (id) => { if (!live[id]) throw new Error('No tab'); return live[id]; },
      create: async (opts) => {
        const tab = { id: nextId++, url: `${HR}/`, status: 'complete' };
        live[tab.id] = tab;
        calls.created.push(opts);
        return tab;
      },
      update: async (id) => live[id],
      remove: async (id) => { delete live[id]; calls.removed.push(id); },
    },
    scripting: {
      executeScript: async ({ func, args }) => {
        if (func.name === 'pageShell') return [{ result: { href: `${HR}/`, shell: true, login: false } }];
        if (func.name !== 'pageFetch') return [{ result: null }];
        const path = args[0];
        calls.fetched.push(path);
        if (path === '/api/user') return [{ result: { status: 200, url: '', text: JSON.stringify({ loginUserId: '12345', loginUserNm: '홍길동' }) } }];
        if (fails) return [{ result: { status: 500, url: '', text: 'boom' } }];
        const rows = path.startsWith('/wrk/wrkcommute/wrkcommute100?') ? [CM] : [DOC];
        return [{ result: { status: 200, url: '', text: JSON.stringify(rows) } }];
      },
    },
  };
  // 포털 로그인 확인(portalState). 살아 있다고 답한다.
  globalThis.fetch = async () => ({ ok: true, status: 200, type: 'basic', arrayBuffer: async () => new TextEncoder().encode('<html>home</html>').buffer });
  return { calls, store, live };
}

const { commuteWeekFresh, loadCommuteWeek } = await import('../src/commuteweek.js');
const { COMMUTE_WEEK_KEY, WEEK_DAYS } = await import('../src/commute.js');

console.log('담아 둔 출퇴근 기록을 써도 되는가');
t('오늘 읽은 것만 쓴다', () => {
  assert.ok(commuteWeekFresh({ day: '2026-10-27', at: 1, rows: [] }, '2026-10-27'));
  assert.ok(!commuteWeekFresh({ day: '2026-10-26', at: 1, rows: [] }, '2026-10-27'), '어제 읽은 것');
  assert.ok(!commuteWeekFresh({ day: '2026-10-27', at: 1, rows: null }, '2026-10-27'));
  assert.ok(!commuteWeekFresh(undefined, '2026-10-27'));
});

console.log('읽어 담기 — 하루에 한 번, 오늘 포함 이레');
{
  const commutes = (rows, seen = []) => async (range) => { seen.push(range); return rows; };
  await ta('담아 둔 것이 없으면 오늘−6 ~ 오늘을 읽어 줄 그대로 담는다', async () => {
    const { store } = fakeChrome();
    const seen = [];
    const r = await loadCommuteWeek('2026-10-27', { commutes: commutes([CM], seen) });
    assert.deepEqual(r, { rows: [CM], error: '' });
    assert.deepEqual(seen, [{ from: '2026-10-21', to: '2026-10-27' }]);
    assert.equal(WEEK_DAYS, 7);
    assert.deepEqual([store[COMMUTE_WEEK_KEY].day, store[COMMUTE_WEEK_KEY].rows], ['2026-10-27', [CM]]);
    assert.equal(typeof store[COMMUTE_WEEK_KEY].at, 'number');
  });
  await ta('달이 바뀌는 주도 이레다', async () => {
    fakeChrome();
    const seen = [];
    await loadCommuteWeek('2026-11-03', { commutes: commutes([], seen) });
    assert.deepEqual(seen, [{ from: '2026-10-28', to: '2026-11-03' }]);
  });
  await ta('오늘 읽어 둔 것이 있으면 HR 을 읽지 않는다 — 어제 것이면 읽는다', async () => {
    fakeChrome({ store: { [COMMUTE_WEEK_KEY]: { day: '2026-10-27', at: 1, rows: [{ workDate: 'OLD' }] } } });
    const seen = [];
    assert.deepEqual(await loadCommuteWeek('2026-10-27', { commutes: commutes([CM], seen) }), { rows: [{ workDate: 'OLD' }], error: '' });
    assert.equal(seen.length, 0);
    assert.deepEqual((await loadCommuteWeek('2026-10-28', { commutes: commutes([CM], seen) })).rows, [CM]);
    assert.equal(seen.length, 1);
  });
  await ta('force 면 오늘 읽어 둔 것이 있어도 다시 읽는다', async () => {
    const { store } = fakeChrome({ store: { [COMMUTE_WEEK_KEY]: { day: '2026-10-27', at: 1, rows: [{ workDate: 'OLD' }] } } });
    const r = await loadCommuteWeek('2026-10-27', { force: true, commutes: commutes([CM]) });
    assert.deepEqual(r.rows, [CM]);
    assert.deepEqual(store[COMMUTE_WEEK_KEY].rows, [CM]);
  });
  await ta('못 읽으면 던지지 않고 까닭을 준다 — 담지 않고, 오늘 읽어 둔 것이 있으면 그것이라도', async () => {
    const boom = async () => { throw new Error('HR 에 들어가지 못했습니다.'); };
    const { store } = fakeChrome({ store: { [COMMUTE_WEEK_KEY]: { day: '2026-10-26', at: 1, rows: [{ workDate: 'OLD' }] } } });
    assert.deepEqual(await loadCommuteWeek('2026-10-27', { commutes: boom }), { rows: [], error: 'HR 에 들어가지 못했습니다.' }, '어제 것을 주면 안 된다');
    assert.equal(store[COMMUTE_WEEK_KEY].day, '2026-10-26', '못 읽은 것을 담았다');
    fakeChrome({ store: { [COMMUTE_WEEK_KEY]: { day: '2026-10-27', at: 1, rows: [{ workDate: 'OLD' }] } } });
    assert.deepEqual(await loadCommuteWeek('2026-10-27', { force: true, commutes: boom }), { rows: [{ workDate: 'OLD' }], error: 'HR 에 들어가지 못했습니다.' });
  });
}

console.log('배경: 홈 카드 대신 지난 7일의 출퇴근 기록을 읽어 준다');
{
  /** 배경을 새로 올리고 그 듣는 손을 준다. */
  async function boot(env) {
    await import(`../background.js?bust=${Math.random()}`);
    return env.calls.listeners.at(-1);
  }
  /** 홈 카드가 보내는 것과 같은 부탁을 보낸다. */
  const send = (listener, msg) => new Promise((resolve) => {
    assert.equal(listener(msg, { tab: { id: 1 } }, resolve), true, '답을 나중에 주겠다고 해야 한다');
  });

  await ta('오늘 읽어 둔 것이 있으면 HR 작업 탭을 열지 않는다', async () => {
    const env = fakeChrome({ store: { [COMMUTE_WEEK_KEY]: { day: TODAY, at: 1, rows: [{ workDate: 'OLD' }] } } });
    const r = await send(await boot(env), { type: 'hrCommuteWeek' });
    assert.deepEqual(r, { ok: true, rows: [{ workDate: 'OLD' }], error: '' });
    assert.deepEqual([env.calls.created.length, env.calls.removed.length], [0, 0]);
  });
  await ta('없으면 뒷전에 작업 탭을 열어 패널과 같은 조회로 이레를 읽고, 담고, 자기가 연 탭을 닫는다', async () => {
    const env = fakeChrome();
    const r = await send(await boot(env), { type: 'hrCommuteWeek' });
    assert.deepEqual(r, { ok: true, rows: [CM], error: '' });
    assert.equal(env.calls.created.length, 1);
    assert.equal(env.calls.created[0].active, false, '작업 탭이 앞으로 튀어나오면 안 된다');
    const q = env.calls.fetched.find((p) => p.startsWith('/wrk/wrkcommute/wrkcommute100?'));
    assert.ok(q, env.calls.fetched.join(', '));
    const params = new URLSearchParams(q.split('?')[1]);
    assert.deepEqual([params.get('fromDate'), params.get('toDate')], [plus(-6), TODAY]);
    assert.deepEqual(env.calls.removed, [7]);
    assert.deepEqual(env.store[COMMUTE_WEEK_KEY].rows, [CM]);
    assert.equal(env.store.hrWorkerTab, null, '닫은 탭 번호를 남겨 두지 않는다');
  });
  await ta('force 면 오늘 읽어 둔 것이 있어도 다시 읽는다', async () => {
    const env = fakeChrome({ store: { [COMMUTE_WEEK_KEY]: { day: TODAY, at: 1, rows: [{ workDate: 'OLD' }] } } });
    const r = await send(await boot(env), { type: 'hrCommuteWeek', force: true });
    assert.deepEqual(r.rows, [CM]);
    assert.equal(env.calls.created.length, 1);
  });
  await ta('읽다가 실패해도 자기가 연 탭은 닫고, 까닭을 답한다 — 담지 않는다', async () => {
    const env = fakeChrome({ fails: true });
    const r = await send(await boot(env), { type: 'hrCommuteWeek' });
    assert.equal(r.ok, true);
    assert.match(r.error, /HR 응답 오류 \(HTTP 500\)/);
    assert.deepEqual(r.rows, []);
    assert.deepEqual(env.calls.removed, [7]);
    assert.equal(env.store[COMMUTE_WEEK_KEY], undefined);
  });
  await ta('근태와 함께 부탁하면 작업 탭은 한 번 열고, 둘 다 끝난 뒤 한 번 닫는다', async () => {
    const env = fakeChrome();
    const listener = await boot(env);
    const [plans, week] = await Promise.all([send(listener, { type: 'hrPlans' }), send(listener, { type: 'hrCommuteWeek' })]);
    assert.deepEqual([plans.ok, plans.error, plans.items.map((it) => it.docNo)], [true, '', ['T-1']]);
    assert.deepEqual([week.ok, week.error, week.rows], [true, '', [CM]]);
    assert.equal(env.calls.created.length, 1, '앞의 일이 닫은 탭을 뒤의 일이 다시 열었다');
    assert.deepEqual(env.calls.removed, [7]);
  });
  await ta('패널이 쓰던 작업 탭이 있으면 그것으로 읽고 닫지 않는다', async () => {
    const env = fakeChrome({
      store: { hrWorkerTab: { id: 3 } },
      tabs: { 3: { id: 3, url: `${HR}/`, status: 'complete' } },
    });
    const r = await send(await boot(env), { type: 'hrCommuteWeek', force: true });
    assert.deepEqual(r.rows, [CM]);
    assert.deepEqual([env.calls.created.length, env.calls.removed], [0, []]);
    assert.ok(env.live[3], '패널의 탭이 닫혔다');
  });
}

console.log(`\n통과 ${pass}건`);
