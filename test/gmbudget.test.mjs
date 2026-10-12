// 공문(구매·교육·출장)의 비용을 R&D 과제의 예산과 견주는 순수 로직 — src/gmbudget.js(2026-10-12 사용자 지정: "구매 또는 공문 작성 시 비용을 R&D 의 연구활동비나 비용을 비교해서
// 예산이 남아 있는지 … rerp 기능이 연동이 되어 있다면"). 계정 글 → 비목, 이름 맞추기, rERP 스냅샷의 비목 잔액(재원 합·승인전·R&D 설정의 미청구·사용계획), 비목이 없으면 과제 합계,
// rERP 가 없으면 장부의 계획 − 집행, 아무것도 없으면 null, 줄 글·툴팁. 화면(예산 줄 gmBudget)은 test/wiring.test.mjs 의 "공문 탭 — … R&D 과제의 예산" 이 본다. 어디에도 보내지 않는다.
import assert from 'node:assert/strict';

import { itemOf, matchKey, budgetCheck, budgetText, budgetTitle } from '../src/gmbudget.js';
import { normalizeBook } from '../src/rnd.js';
import { clock } from '../src/rnderp.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const TODAY = '2026-10-12';
const AT = new Date(2026, 9, 12, 9, 30).getTime();
const WHEN = clock(AT);   // 10.12 09:30
const NAME = 'MW급 10kV 반도체 차단기 개발';
const PRJ = '2026-0063-01';
const item = (exp, bgt, appr, req = 0, resCd = 'R1') => ({ res: '산업부', resCd, exp, item: exp, bgt, appr, req, bal: bgt - appr - req, excluded: /인건비|연구수당|간접비/.test(exp) });
// 비목 넷 — 인건비는 제외 비목(합계에 안 듦). 연구활동비 잔액 = 43,700,000 − 19,712,839 − 148,500 = 23,838,661.
const ITEMS = [item('인건비', 50000000, 20000000), item('연구활동비', 43700000, 19712839, 148500), item('연구재료비', 10000000, 9800000), item('연구시설·장비비', 5000000, 0, 0, 'R2')];
const BUDGET = { std: '10', items: ITEMS, bgtAmt: 58700000, apprAmt: 29512839, balAmt: 29038661, reqAmt: 148500, rate: 50.27, exclNames: ['인건비'], unbilled: 300000, unbilledCount: 2, balAfter: 28738661, rateAll: 51.1 };
const ERP = { prjNo: PRJ, anl: 1, prjNm: NAME, rspr: '박기도', stDt: '2026-04-01', endDt: '2027-03-31', auto: true, linkedAt: AT, snap: { at: AT, std: '10', budget: BUDGET, cards: { from: '2026-04-01', to: TODAY, count: 2, amount: 300000 }, error: '' } };
const ROWS = [{ id: 'r1', item: '연구활동비', plan: 43700000, used: 19712839, erpKey: 'R1|연구활동비' }, { id: 'r2', item: '연구재료비', plan: 10000000, used: 9800000 }];
const bookOf = (year = { budget: ROWS, erp: ERP }, extra = {}) => normalizeBook({ projects: [{ id: 'p1', name: NAME, code: 'RS-2026-0001', lead: '박기도', start: '2026-04-01', end: '2029-12-31', years: { 1: year }, ...extra }] });
const check = (o = {}, book = bookOf()) => budgetCheck(book, 'p1', { amount: 989000, account: '연구활동비(연구실운용비)', today: TODAY, ...o });
const pick = (c, keys) => Object.fromEntries(keys.map((k) => [k, c?.[k]]));

console.log('계정 → 비목');
t('괄호 안(세목)과 줄표·쌍점 뒤를 걷는다 — 가운뎃점은 이름의 일부, 비면 연구활동비', () => {
  assert.deepEqual(['연구활동비(연구실운용비)', '연구활동비(교육훈련비)', '연구활동비(국내여비)', '연구활동비 - 국내여비', '연구활동비: 회의비', '연구시설·장비비', '연구재료비', ' 간접비（출금） ', '', null].map(itemOf),
    ['연구활동비', '연구활동비', '연구활동비', '연구활동비', '연구활동비', '연구시설·장비비', '연구재료비', '간접비', '연구활동비', '연구활동비']);
});
t('이름 키 맞추기 — 똑같은 것, 없으면 앞부분이 겹치는 것 가운데 가장 긴 것, 없으면 빈 글', () => {
  const keys = ['연구활동비', '연구재료비', '연구시설장비비', '연구활동비국내여비'];
  assert.equal(matchKey(keys, '연구활동비'), '연구활동비');
  assert.equal(matchKey(['연구재료비', '연구활동비국내여비'], '연구활동비'), '연구활동비국내여비');
  assert.equal(matchKey(['연구재료비', '연구활동비'], '연구활동비국내여비'), '연구활동비');
  assert.equal(matchKey(keys, '위탁연구개발비'), '');
  assert.equal(matchKey(keys, ''), '');
  assert.equal(matchKey(null, '연구활동비'), '');
});

console.log('rERP 집행내역이 이어진 차년도 — 그 비목의 잔액');
t('연구활동비 잔액(예산 − 승인 − 승인전)에서 이번 합계를 빼 남는 것 — 집행률은 전·후', () => {
  const c = check();
  assert.deepEqual(pick(c, ['state', 'source', 'item', 'name', 'matched', 'year', 'prjNo', 'at', 'plan', 'used', 'left', 'amount', 'after', 'rate', 'rateAfter', 'parts']), {
    state: 'ok', source: 'rerp', item: '연구활동비', name: '연구활동비', matched: true, year: 1, prjNo: PRJ, at: AT,
    plan: 43700000, used: 19861339, left: 23838661, amount: 989000, after: 22849661, rate: 45, rateAfter: 48, parts: { appr: 19712839, req: 148500, planned: 0, unbilled: 0 },
  });
  assert.equal(budgetText(c), `R&D 예산 · 연구활동비 잔액 23,838,661원 → 이번 989,000원 쓰면 22,849,661원 남음 (집행 45% → 48%) · rERP ${WHEN}`);
  assert.match(budgetTitle(c), /^연구활동비 · 1차년도 · rERP 2026-0063-01 조회 10\.12 09:30\n잔액 23,838,661원 = 예산 43,700,000원 − 승인 19,712,839원 − 승인전 148,500원\n모자라도 작성은 막지 않습니다/);
});
t('잔액을 넘으면 short — 모자란 만큼을 적는다', () => {
  const c = check({ amount: 30000000 });
  assert.deepEqual(pick(c, ['state', 'left', 'after', 'rate', 'rateAfter']), { state: 'short', left: 23838661, after: -6161339, rate: 45, rateAfter: 114 });
  assert.equal(budgetText(c), `R&D 예산 부족 — 연구활동비 잔액 23,838,661원 < 이번 30,000,000원 · 6,161,339원 모자람 (집행 45% → 114%) · rERP ${WHEN}`);
  assert.equal(check({ amount: 23838661 }).state, 'ok', '딱 맞으면 남는 것 0원 — 모자라지 않다');
});
t('금액을 모르면(null·음수·NaN) 잔액만 — noamount', () => {
  for (const amount of [null, undefined, -1, Number.NaN, '989000']) {
    const c = check({ amount });
    assert.deepEqual(pick(c, ['state', 'amount', 'after', 'rateAfter']), { state: 'noamount', amount: null, after: null, rateAfter: null }, String(amount));
    assert.equal(budgetText(c), `R&D 예산 · 연구활동비 잔액 23,838,661원 (집행 45%) · rERP ${WHEN} — 금액을 적으면 견줍니다`);
  }
});
t('R&D 설정의 "집행에 더하기"대로 미청구(연구활동비 줄에만)와 사용계획(그 비목 키의 예상 비용)을 잔액에서 뺀다 — R&D 탭 예산 칸과 같은 셈', () => {
  const set = { erp: true, unbilled: true, plan: true };
  const plans = { [PRJ]: { 'R1|연구활동비': [{ id: 'a', name: '모니터', qty: 1, unit: 0, amt: 500000, ts: 1 }, { id: 'b', name: '구독', qty: 1, unit: 0, amt: 120000, ts: 2 }], 'R1|연구재료비': [{ id: 'c', name: '케이블', qty: 1, unit: 0, amt: 70000, ts: 3 }] } };
  const c = check({ set, plans });
  assert.deepEqual(pick(c, ['state', 'left', 'used', 'after', 'parts']), { state: 'ok', left: 22918661, used: 20781339, after: 21929661, parts: { appr: 19712839, req: 148500, planned: 620000, unbilled: 300000 } });
  assert.match(budgetTitle(c), /− 미청구 300,000원 − 사용계획 620,000원\n\(미청구·사용계획은 R&D 설정의 "집행에 더하기"대로\)/);
  // 연구재료비에는 미청구가 들지 않고 사용계획만 — 잔액 200,000 − 70,000 = 130,000 < 989,000.
  const m = check({ set, plans, account: '연구재료비' });
  assert.deepEqual(pick(m, ['state', 'name', 'left', 'after', 'parts']), { state: 'short', name: '연구재료비', left: 130000, after: -859000, parts: { appr: 9800000, req: 0, planned: 70000, unbilled: 0 } });
  // 설정을 끄면(기본) 둘 다 들지 않는다.
  assert.equal(check({ set: { erp: true }, plans }).left, 23838661);
});
t('비목 이름은 띄어쓰기·가운뎃점·괄호를 무시하고 맞추고, 앞부분이 겹치면 그 비목 — 재원이 여럿이면 합', () => {
  assert.deepEqual(pick(check({ account: '연구시설장비비(운영)' }), ['name', 'plan', 'left']), { name: '연구시설·장비비', plan: 5000000, left: 5000000 });
  assert.deepEqual(pick(check({ account: '연구활동비국내여비' }), ['item', 'name', 'left']), { item: '연구활동비국내여비', name: '연구활동비', left: 23838661 });
  const two = bookOf({ budget: ROWS, erp: { ...ERP, snap: { ...ERP.snap, budget: { ...BUDGET, items: [...ITEMS, item('연구활동비', 10000000, 1000000, 0, 'R2')] } } } });
  assert.deepEqual(pick(check({}, two), ['plan', 'left', 'parts']), { plan: 53700000, left: 32838661, parts: { appr: 20712839, req: 148500, planned: 0, unbilled: 0 } });
});
t('그 비목이 rERP 에 없으면 과제 합계(제외 비목 뺀 것)로 견주고 "비목 없음"이라고 적는다 — 미청구·사용계획은 과제 몫으로', () => {
  const c = check({ account: '위탁연구개발비' });
  assert.deepEqual(pick(c, ['state', 'matched', 'item', 'name', 'plan', 'used', 'left', 'after', 'rate', 'rateAfter', 'parts']), {
    state: 'ok', matched: false, item: '위탁연구개발비', name: '', plan: 58700000, used: 29661339, left: 29038661, after: 28049661, rate: 51, rateAfter: 52, parts: { appr: 29512839, req: 148500, planned: 0, unbilled: 0 },
  });
  assert.equal(budgetText(c), `R&D 예산 · 과제 합계 잔액 29,038,661원 → 이번 989,000원 쓰면 28,049,661원 남음 (집행 51% → 52%) (위탁연구개발비 비목 없음) · rERP ${WHEN}`);
  assert.match(budgetTitle(c), /^과제 합계\(위탁연구개발비 비목이 rERP 집행내역에 없음\) · 1차년도/);
  const plans = { [PRJ]: { 'R1|연구재료비': [{ id: 'c', name: '케이블', qty: 1, unit: 0, amt: 70000, ts: 3 }], 'R1|인건비': [{ id: 'd', name: '제외 비목', qty: 1, unit: 0, amt: 9999999, ts: 4 }] } };
  assert.deepEqual(pick(check({ account: '위탁연구개발비', set: { unbilled: true, plan: true }, plans }), ['left', 'parts']), { left: 28668661, parts: { appr: 29512839, req: 148500, planned: 70000, unbilled: 300000 } });
});

console.log('rERP 가 없는 차년도 — 장부의 계획 − 집행');
t('R&D 설정에서 rERP 를 껐으면 장부 줄(손으로 적은 계획·집행)로 — 글 끝이 R&D 장부', () => {
  const c = check({ set: { erp: false } });
  assert.deepEqual(pick(c, ['state', 'source', 'name', 'matched', 'plan', 'used', 'left', 'after', 'rate', 'rateAfter', 'parts', 'at', 'prjNo']), {
    state: 'ok', source: 'book', name: '연구활동비', matched: true, plan: 43700000, used: 19712839, left: 23987161, after: 22998161, rate: 45, rateAfter: 47, parts: null, at: 0, prjNo: '',
  });
  assert.equal(budgetText(c), 'R&D 예산 · 연구활동비 잔액 23,987,161원 → 이번 989,000원 쓰면 22,998,161원 남음 (집행 45% → 47%) · R&D 장부');
  assert.equal(budgetTitle(c), '연구활동비 · 1차년도 · R&D 탭 예산 칸(손으로 적은 계획·집행 — rERP 를 이으면 그 잔액으로 견줍니다)\n잔액 23,987,161원 = 계획 43,700,000원 − 집행 19,712,839원');
});
t('잇지 않은 차년도도 장부 줄로 — 그 비목 줄에 계획이 없으면 차년도 합계, 합계 계획도 없으면 null', () => {
  assert.equal(check({}, bookOf({ budget: ROWS })).left, 23987161);
  const noPlan = bookOf({ budget: [{ id: 'r1', item: '연구활동비', plan: null, used: 100000 }, { id: 'r2', item: '연구재료비', plan: 1000000, used: 200000 }] });
  const c = check({ amount: 500000 }, noPlan);
  assert.deepEqual(pick(c, ['state', 'source', 'matched', 'plan', 'used', 'left', 'after']), { state: 'ok', source: 'book', matched: false, plan: 1000000, used: 300000, left: 700000, after: 200000 });
  assert.equal(budgetText(c), 'R&D 예산 · 과제 합계 잔액 700,000원 → 이번 500,000원 쓰면 200,000원 남음 (집행 30% → 80%) (연구활동비 비목 없음) · R&D 장부');
  assert.equal(check({}, bookOf({ budget: [{ id: 'r1', item: '연구활동비', plan: null, used: 100000 }] })), null, '집행만 있고 계획이 없다');
  assert.equal(check({}, bookOf({ budget: [] })), null, '기본 여섯 줄만(빈 계획·집행) — 견줄 것이 없다');
});
t('과제가 없거나 올해 차년도가 장부에 없으면 null — 글도 빈 글', () => {
  assert.equal(budgetCheck(bookOf(), 'p9', { amount: 1, today: TODAY }), null);
  assert.equal(budgetCheck(null, 'p1', { amount: 1 }), null);
  assert.equal(check({ today: '2027-06-01' }), null, '2차년도는 장부에 없다');
  assert.equal(budgetText(null), '');
  assert.equal(budgetTitle(null), '');
});

console.log(`\n통과 ${pass}건`);
