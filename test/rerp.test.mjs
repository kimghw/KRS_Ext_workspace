// rerp/ 폴더(kr_ext_rerp 에서 옮긴 코드)가 원본과 같게 도는지 — kr_ext_rerp tests/plan-sync.test.js 를 ESM 으로 옮긴 검사(plansync 의 병합 규칙 — flatten/unflatten · merge(ts · 묘비 · 원격 없음 · 같음) · gcTomb · delSlice/putBack)에
// R&D 탭이 쓰는 plan.js(월간 구독·금액)와 erp.js(흉내 fetch — _JSON_ 이중 인코딩·EUC-KR·GWM0001 로그인 판정·비목별 잔액·본예산 대체·미청구 합산·SSO)를 보탰다.
// 원노트·MCP(onenote.js · mcp.js · plussync.js) 검사는 2026-10-18 원본이 걷어 내어(사용자 "mcp 없이 … 브라우저 토큰으로") 같이 지웠다 — 그 자리의 SharePoint 폴더 저장소·문서·차례·배선 검사는 test/rerp-share.test.mjs.
// 어디에도 보내지 않는다. 복사본이 원본과 어긋났는지는 `node tools/rerp.mjs check` 가 본다.
import assert from 'node:assert/strict';

import S from '../rerp/plansync.js';
import KRX_PLAN from '../rerp/plan.js';
import ERP, { settingsOf, withPending, execRate, trunc } from '../rerp/erp.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

console.log('plansync — kr_ext_rerp tests/plan-sync.test.js 그대로');
t('flatten/unflatten 왕복 · 과제 하나만', () => {
  const plans = { P1: { '10|연구활동비': [{ id: 'a', name: 'x', qty: 2, unit: 10, amt: 20, ts: 5 }], '10|장비비': [{ id: 'b', name: 'y', qty: 1, unit: 3, amt: 3, ts: 6, sub: { date: '2026-09-02' }, by: '홍' }] }, P2: { K: [{ id: 'c', name: 'z', qty: 1, unit: 1, amt: 1, ts: 1 }] } };
  const items = S.flatten(plans);
  assert.strictEqual(items.length, 3);
  assert.deepStrictEqual(S.unflatten(items), plans);
  assert.deepStrictEqual(S.flatten(plans, 'P2').map((e) => e.id), ['c']);
  assert.deepStrictEqual(S.unflatten([{ id: 'x' }, null, { id: 'y', prj: 'P', key: '' }]), {}, 'prj·key 없는 항목은 버림');
});
t('merge: ts 큰 쪽이 이김, 같으면 로컬', () => {
  const L = { items: [{ id: 'a', prj: 'P', key: 'K', name: 'local', qty: 1, unit: 1, amt: 1, ts: 10 }, { id: 'b', prj: 'P', key: 'K', name: 'same-local', qty: 1, unit: 1, amt: 1, ts: 5 }], del: {} };
  const R = { items: [{ id: 'a', prj: 'P', key: 'K', name: 'remote', qty: 1, unit: 1, amt: 1, ts: 20 }, { id: 'b', prj: 'P', key: 'K', name: 'same-remote', qty: 1, unit: 1, amt: 1, ts: 5 }], del: {} };
  const m = S.merge(L, R, 1000);
  const by = Object.fromEntries(m.items.map((e) => [e.id, e.name]));
  assert.strictEqual(by.a, 'remote');
  assert.strictEqual(by.b, 'same-local');
  assert.strictEqual(m.localChanged, true);
  assert.strictEqual(m.remoteChanged, true);
});
t('merge: 묘비(숫자·객체)가 항목보다 새로우면 삭제, 항목이 더 새로우면 묘비 폐기', () => {
  const L = { items: [{ id: 'a', prj: 'P', key: 'K', name: 'a', qty: 1, unit: 1, amt: 1, ts: 10 }, { id: 'b', prj: 'P', key: 'K', name: 'b', qty: 1, unit: 1, amt: 1, ts: 50 }], del: { c: { ts: 30, prj: 'P' } } };
  const R = { items: [{ id: 'c', prj: 'P', key: 'K', name: 'c', qty: 1, unit: 1, amt: 1, ts: 20 }], del: { a: 20, b: 40 } };
  const m = S.merge(L, R, 1000);
  assert.deepStrictEqual(m.items.map((e) => e.id).sort(), ['b']);
  assert.deepStrictEqual(m.del, { a: 20, c: 30 });
});
t('merge: 원격 없음(파일 없음) → remoteChanged, 로컬 그대로 · 같으면 아무것도 안 바뀜 · 구독·작성자 보존', () => {
  const items = [{ id: 'a', prj: 'P', key: 'K', name: 'a', qty: 1, unit: 1, amt: 1, ts: 10, sub: { date: '2026-09-02' }, by: '김거화' }];
  const m = S.merge({ items, del: { z: 999 } }, null, 1000);
  assert.strictEqual(m.localChanged, false); assert.strictEqual(m.remoteChanged, true); assert.strictEqual(m.items.length, 1);
  assert.deepStrictEqual(m.items[0].sub, { date: '2026-09-02' }); assert.strictEqual(m.items[0].by, '김거화');
  const m2 = S.merge({ items, del: {} }, { items: items.map((e) => Object.assign({}, e)), del: {} }, 1000);
  assert.strictEqual(m2.localChanged, false); assert.strictEqual(m2.remoteChanged, false);
  const m3 = S.merge({ items: [], del: {} }, { items: [], del: {} }, 1000);
  assert.deepStrictEqual([m3.items, m3.del, m3.localChanged, m3.remoteChanged], [[], {}, false, false], '둘 다 비어도 같음');
});
t('gcTomb: 90일 지난 묘비 버림 (객체 값도)', () => {
  const now = 100 * 24 * 3600 * 1000;
  assert.deepStrictEqual(S.gcTomb({ old: 1, fresh: now - 1000, obj: { ts: now - 5, prj: 'P' } }, now), { fresh: now - 1000, obj: now - 5 });
});
t('delSlice: 그 과제 묘비(prj 없는 옛 숫자 포함)만 숫자 맵으로 · putBack: 그 과제 몫만 바꾸고 다른 과제는 그대로', () => {
  const del = { a: { ts: 10, prj: 'P1' }, b: { ts: 20, prj: 'P2' }, c: 30 };
  assert.deepStrictEqual(S.delSlice(del, 'P1'), { a: 10, c: 30 });
  assert.deepStrictEqual(S.delSlice(del, 'P2'), { b: 20, c: 30 });
  const local = { plans: { P1: { K: [{ id: 'a', name: 'old', qty: 1, unit: 1, amt: 1, ts: 1 }] }, P2: { K: [{ id: 'p2', name: 'p2', qty: 1, unit: 1, amt: 1, ts: 1 }] } }, del };
  const back = S.putBack(local, 'P1', [{ id: 'n', prj: 'P1', key: 'K2', name: 'new', qty: 2, unit: 5, amt: 10, ts: 100 }], { a: 10, z: 50 });
  assert.deepStrictEqual(Object.keys(back.plans).sort(), ['P1', 'P2']);
  assert.deepStrictEqual(back.plans.P1, { K2: [{ id: 'n', name: 'new', qty: 2, unit: 5, amt: 10, ts: 100 }] });
  assert.deepStrictEqual(back.plans.P2, local.plans.P2, '다른 과제는 그대로');
  assert.deepStrictEqual(back.del, { a: { ts: 10, prj: 'P1' }, b: { ts: 20, prj: 'P2' }, z: { ts: 50, prj: 'P1' } }, 'P1 몫(prj 없는 c 포함)은 새 묘비로 바뀌고 P2 는 그대로');
  const gone = S.putBack(local, 'P1', [], {});
  assert.ok(!('P1' in gone.plans), '항목이 모두 없어지면 과제 키도 사라짐');
});

console.log('plan — 월간 구독·금액 · 백그라운드로 보내는 길(api.send)');
t('월간 구독: 오늘(2026-10-11)부터 올해 12월까지 남은 결제 횟수 — 짧은 달은 말일, 내년 시작은 0회', () => {
  const was = KRX_PLAN._now;
  KRX_PLAN._now = () => new Date(2026, 9, 11);
  try {
    // 결제일이 2일이면 10월 2일은 이미 지나 11·12월 두 번, 11일이면 오늘 포함 세 번, 10일이면 두 번
    assert.deepEqual([KRX_PLAN.subRemaining('2026-09-02').qty, KRX_PLAN.subRemaining('2026-10-11').qty, KRX_PLAN.subRemaining('2026-10-10').qty, KRX_PLAN.subRemaining('2027-01-05').qty, KRX_PLAN.subRemaining('2025-01-31').qty], [2, 3, 2, 0, 3]);
    assert.equal(KRX_PLAN.subRemaining('2025-01-31').dates.map((d) => d.getDate()).join(','), '31,30,31');
    const e = { id: 'x', name: 'azure', qty: 9, unit: 100, amt: 900, sub: { date: '2026-09-02' } };
    assert.equal(KRX_PLAN.qtyOf(e), 2, '저장값이 아니라 다시 센다');
    assert.equal(KRX_PLAN.amtOf(e), 200);
    assert.deepEqual(KRX_PLAN.projectTotal({ P: { K: [e, { id: 'y', qty: 2, unit: 5, amt: 10 }] } }, 'P'), { sum: 210, count: 2 });
    assert.equal(KRX_PLAN.itemKey({ resCd: '10', exp: '연구활동비' }), '10|연구활동비');
    assert.equal(KRX_PLAN.keyName('10|연구활동비'), '연구활동비');
  } finally { KRX_PLAN._now = was; }
});
t('api.send 는 기본이 chrome.runtime.sendMessage 이고 WORKSPACE 가 끼울 수 있다 · 저장 키는 rerp 그대로(plusPlanPages 는 없어짐) · pageOf 는 planSyncState 의 planUrl → folderUrl', () => {
  assert.equal(typeof KRX_PLAN.send, 'function');
  assert.deepEqual([KRX_PLAN.KEY, KRX_PLAN.DKEY, KRX_PLAN.SKEY, 'PKEY' in KRX_PLAN], ['plannedExpenses', 'plannedDeleted', 'planSyncState', false]);
  const st = { planSync: { pages: { P1: { title: '차단기', folder: 'SSCB', folderUrl: 'https://x/folder', planUrl: 'https://x/folder/예상비용.json' }, P2: { title: '수소', folderUrl: 'https://x/f2' } } } };
  assert.deepEqual(KRX_PLAN.pageOf(st, 'P1'), { webUrl: 'https://x/folder/예상비용.json', title: '차단기', folder: 'SSCB', isFile: true });
  assert.deepEqual([KRX_PLAN.pageOf(st, 'P2').isFile, KRX_PLAN.linkOf(st, 'P2'), KRX_PLAN.pageOf(st, 'P9')], [false, 'https://x/f2', null]);
});

console.log('erp — R&D ERP 호출(흉내 fetch)');
/** rERP 서버 흉내 — 서비스 이름마다 답을 정한다. 답은 EUC-KR 이 아니라 UTF-8 로 주되 charset 은 실서버처럼 적는다. */
function fakeErp(routes) {
  const calls = [];
  const enc = new TextEncoder();
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const m = /rnd\.krs\.co\.kr\/(.+)\.jct$/.exec(u);
    if (m) {
      const input = JSON.parse(decodeURIComponent(decodeURIComponent(String(init.body).replace(/^_JSON_=/, ''))));
      calls.push({ service: m[1], input });
      const r = routes[m[1]];
      const out = typeof r === 'function' ? r(input) : r;
      if (out && out.html) return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'text/html; charset=utf-8' : null) }, arrayBuffer: async () => enc.encode('<html>login</html>').buffer };
      return { ok: true, status: 200, headers: { get: (h) => (h === 'content-type' ? 'application/json; charset=utf-8' : null) }, arrayBuffer: async () => enc.encode(JSON.stringify(out || { COMMON_HEAD: { ERROR: true, CODE: 'X', MESSAGE: `no route ${m[1]}` } })).buffer };
    }
    calls.push({ service: u, input: init || {} });
    const r = routes[u];
    const out = typeof r === 'function' ? r(init) : r;
    return { ok: true, status: 200, redirected: false, url: u, headers: { get: () => null }, text: async () => String(out ?? ''), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return calls;
}
const BUDGET_REC = [
  { RES_NM: '산업부', RES_CD: '10', MARK_EXP_NM: '인건비', BGT_AMT: '31425000', APPR_AMT: '12345000', REQ_AMT: '0', BAL_AMT: '19080000', DIR_COST_YN: 'N', PSNL_COST_YN: 'Y' },
  { RES_NM: '산업부', RES_CD: '10', MARK_EXP_NM: '연구활동비', BGT_AMT: '43700000', APPR_AMT: '19712839', REQ_AMT: '148500', BAL_AMT: '23838661', DIR_COST_YN: 'Y', PSNL_COST_YN: 'N' },
  { RES_NM: '산업부', RES_CD: '10', MARK_EXP_NM: '연구시설·장비비', BGT_AMT: '15000000', APPR_AMT: '0', REQ_AMT: '0', BAL_AMT: '15000000', DIR_COST_YN: 'Y', PSNL_COST_YN: 'N' },
  { RES_NM: '산업부', RES_CD: '10', MARK_EXP_NM: '간접비', BGT_AMT: '23629000', APPR_AMT: '5000000', REQ_AMT: '0', BAL_AMT: '18629000', DIR_COST_YN: 'N', PSNL_COST_YN: 'N' },
];
await ta('call: _JSON_ 이중 인코딩으로 보내고 COMMON_HEAD 오류는 kind 로 — GWM0001·HTML 은 login', async () => {
  const calls = fakeErp({ ok_svc: { COMMON_HEAD: { ERROR: false }, REC: [{ A: 1 }] }, bad_svc: { COMMON_HEAD: { ERROR: true, CODE: 'GWM0001', MESSAGE: '사용자 정보가 존재하지 않습니다' } }, html_svc: { html: true }, svc_err: { COMMON_HEAD: { ERROR: true, CODE: 'E1', MESSAGE: '잘못된 요청' } } });
  assert.deepEqual((await ERP.call('ok_svc', { PRJ_NO: 'P1', NM: '한글' })).REC, [{ A: 1 }]);
  assert.deepEqual(calls[0].input, { PRJ_NO: 'P1', NM: '한글' });
  await assert.rejects(() => ERP.call('bad_svc', {}), (e) => e.kind === 'login' && e.code === 'GWM0001');
  await assert.rejects(() => ERP.call('html_svc', {}), (e) => e.kind === 'login');
  await assert.rejects(() => ERP.call('svc_err', {}), (e) => e.kind === 'service' && /잘못된 요청/.test(e.message));
});
await ta('fetchBudget: 비목별 잔액 — 제외 비목(인건비·연구수당·간접비)은 합계에서 빠지고, 집행비율은 둘 다 양수일 때 소수 2자리 절사 · withPending 으로 미청구·승인전 반영', async () => {
  fakeErp({ rcomm_0041_01_r004: (input) => (input.PRJ_NO === 'P1' && input.REQ_CNT === '-1' && input.INCLUDE_TAX === 'Y' ? { COMMON_HEAD: {}, REC: BUDGET_REC } : { COMMON_HEAD: {}, REC: [] }) });
  const b = await ERP.fetchBudget('P1', settingsOf());
  assert.equal(b.std, '10');
  assert.deepEqual(b.items.map((x) => [x.exp, x.excluded, x.rate]), [['인건비', true, 39.28], ['연구활동비', false, 45.1], ['연구시설·장비비', false, 0], ['간접비', true, 21.16]]);
  assert.deepEqual([b.bgtAmt, b.apprAmt, b.balAmt, b.reqAmt, b.rate, b.resCount, b.exclNames], [58700000, 19712839, 38838661, 148500, 33.58, 1, ['인건비', '간접비']]);
  withPending(b, 523000, 2);
  assert.deepEqual([b.pending, b.execAmt, b.balAfter, b.rateAll, b.pendingRate], [671500, 20384339, 38315661, 34.72, 1.14]);
  assert.equal(execRate(19712839, 43700000), 45.1);
  assert.equal(trunc(45.109, 2), 45.1);
  const b2 = await ERP.fetchBudget('P1', settingsOf({ budgetItemInclude: { 인건비: true } }));
  assert.equal(b2.bgtAmt, 58700000 + 31425000, '설정에서 고른 비목은 들어간다');
});
await ta('fetchBudget: 과제예산(r004)이 0건이면 과제 상세의 예산기준이 본예산(20)일 때 r006 으로 대체', async () => {
  const calls = fakeErp({
    rcomm_0041_01_r004: { COMMON_HEAD: {}, REC: [] },
    rcomm_0102_01_r001: { COMMON_HEAD: {}, BGT_STD_CD: '20', BIZSECTION_CD: 'B1' },
    rcomm_0041_01_r006: (input) => ({ COMMON_HEAD: {}, REC: input.BIZSECTION_CD === 'B1' ? [{ BGT_ITEM_NM: '연구활동비', ATIT_NM: '회의비', BGT_AMT: '1000', APPR_AMT: '100', BAL_AMT: '900' }] : [] }),
  });
  const b = await ERP.fetchBudget('P2', settingsOf());
  assert.equal(b.std, '20');
  assert.deepEqual(b.items.map((x) => [x.exp, x.item, x.bal]), [['연구활동비', '회의비', 900]]);
  assert.deepEqual(calls.map((c) => c.service), ['rcomm_0041_01_r004', 'rcomm_0102_01_r001', 'rcomm_0041_01_r006']);
});
await ta('fetchProjectRecs / fetchProjects: 과제번호×연차 행 → 과제마다 연차 큰 행 하나, 진행 과제만', async () => {
  const recs = [
    { PRJ_NO: 'P1', ANL: '1', PRJ_NM: 'MW급 차단기', PRJ_RSPR_EMP_NM: '박기도', PROG_STS_NM: '진행', RCH_ST_DT: '20260401', RCH_END_DT: '20270331' },
    { PRJ_NO: 'P1', ANL: '2', PRJ_NM: 'MW급 차단기', PRJ_RSPR_EMP_NM: '박기도', PROG_STS_NM: '진행', RCH_ST_DT: '20270401', RCH_END_DT: '20280331' },
    { PRJ_NO: 'P9', ANL: '1', PRJ_NM: '끝난 과제', PRJ_RSPR_EMP_NM: '홍길동', PROG_STS_NM: '완료', RCH_ST_DT: '20200101', RCH_END_DT: '20201231' },
  ];
  const calls = fakeErp({ rcomm_0009_01_r001: { COMMON_HEAD: {}, REC: recs } });
  const pr = await ERP.fetchProjectRecs(settingsOf());
  assert.equal(pr.recs.length, 3);
  assert.deepEqual(calls[0].input, { SEARCH_NM: '', SEARCH_GB: '10', GUBUN: 'A', PRJ_AUTH: '' });
  const list = await ERP.fetchProjects(settingsOf());
  assert.deepEqual(list.map((p) => [p.prjNo, p.anl, p.rspr, p.stDt]), [['P1', '2', '박기도', '20270401']]);
});
await ta('fetchCards: 미청구 카드 사용내역 — 조회 기간은 설정의 N개월, 과제번호 고정', async () => {
  const calls = fakeErp({ rtask_0008_t05_01_r001: { COMMON_HEAD: {}, REC: [{ CARD_NO: '1234567890123456', USER_NM: '김거화', USED_DATE: '20261001', USED_TIME: '120000', SHOP_NAME: '커피', USED_COST: '5000', APPRNO: 'A1', PRJ_NO: 'P1' }] } });
  const cards = await ERP.fetchCards('P1', settingsOf({ monthsBack: 1, monthsForward: 1 }));
  assert.deepEqual(cards.map((c) => [c.tail, c.amount, c.shop]), [['9012-3456', 5000, '커피']]);
  assert.equal(calls[0].input.SEARCH_GB, '1');
  assert.match(calls[0].input.START_DATE, /^\d{8}$/);
});
await ta('ssoLogin: eClass loginCheck 의 UID·SID → sso_login_krs.jct → SYS_LOGIN POST. eClass 세션이 없으면 eclass-login', async () => {
  const calls = fakeErp({
    'https://eclass.krs.co.kr/intra/intranet/Main_N/json/loginCheck_json.aspx?callback=cb&_=1': 'cb({"UID":"u123","SID":"s456"})',
    'jsp/rderp/main/sso_login_krs': (input) => ({ COMMON_HEAD: {}, URL: input.UID === 'u123' && input.SID === 's456' ? 'rderp_layoutMain.act' : '' }),
    'https://rnd.krs.co.kr/jsp/rderp/main/rderp_layoutMain.act': '<html>layout</html>',
  });
  const realNow = Date.now; Date.now = () => 1;
  try {
    const r = await ERP.ssoLogin();
    assert.equal(r.ok, true);
    assert.equal(calls.at(-1).input.body, 'SYS_LOGIN=Y&SSO_PAGE_GB=A');
  } finally { Date.now = realNow; }
  fakeErp({ 'https://eclass.krs.co.kr/intra/intranet/Main_N/json/loginCheck_json.aspx?callback=cb&_=1': 'cb({"UID":"","SID":""})' });
  Date.now = () => 1;
  try { await assert.rejects(() => ERP.ssoLogin(), (e) => e.kind === 'eclass-login'); } finally { Date.now = realNow; }
});

console.log(`\n${pass} passed`);
