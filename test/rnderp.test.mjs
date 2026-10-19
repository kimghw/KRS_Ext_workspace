// R&D 탭의 예산 칸과 rERP 집행내역을 잇는 순수 로직 — src/rnderp.js. 잇기 규칙(연차 → 기간 → 하나뿐), 후보 고르기, 비목 이름 맞추기(재원 합·rERP 에만 있는 비목),
// 스냅샷을 장부 줄에(집행 = 승인액·erpKey), 살아 있는 차년도·신선도, 받기(흉내 erp — 로그인 한 번·미청구 카드 기간), 칸 머리·요약 글, 저장 모양(normalizeYear).
// 그리고 예산 칸의 천원 단위(src/rnd.js thousand · amountOfThousand). 어디에도 보내지 않는다.
import assert from 'node:assert/strict';

import {
  ERP_TTL_MS, nameKey, d8, projectRecs, pickYearRec, candidates, linkOf, normalizeErp, isLive, isFresh, fetchSnapshot, monthsBetween, matchRows, applySnapshot, erpHead, erpSummaryLines,
  normalizeSet, includeNames, isHidden, erpExtras, UNBILLED_ITEM, fetchParticipants, fetchOthers,
} from '../src/rnderp.js';
import { byName, sharesOfErp, peopleOfErp } from '../rerp/staff.js';
import { normalizeYear, thousand, amountOfThousand, summaryText, normalizeProject } from '../src/rnd.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const REC = (prjNo, anl, nm, st, end, rspr = '박기도', sts = '진행') => ({ PRJ_NO: prjNo, ANL: String(anl), PRJ_NM: nm, PRJ_RSPR_EMP_NM: rspr, RCH_ST_DT: st, RCH_END_DT: end, PROG_STS_NM: sts });
const RECS = [
  REC('2026-0063-01', 1, 'MW급 10kV 반도체 차단기 개발', '20260401', '20270331'),
  REC('2026-0063-01', 2, 'MW급 10kV 반도체 차단기 개발', '20270401', '20280331'),
  REC('2025-0011-02', 3, '선박용 수소 연료전지 추진 시스템', '20260101', '20261231', '홍길동'),
  REC('2020-0001-01', 1, '끝난 과제', '20200101', '20201231', '김아무', '완료'),
];

console.log('천원 단위');
t('원 → 천원 글, 천원 칸의 글 → 원 (숫자만이면 천원, 단위를 붙이면 그 단위)', () => {
  assert.deepEqual([thousand(31425000), thousand(1500), thousand(0), thousand(-5000000), thousand(null)], ['31,425', '2', '0', '-5,000', '']);
  assert.deepEqual([amountOfThousand('31,425'), amountOfThousand('1000'), amountOfThousand('150만'), amountOfThousand('1.5억'), amountOfThousand('3천만'), amountOfThousand('500,000원'), amountOfThousand(''), amountOfThousand('abc'), amountOfThousand(1234)],
    [31425000, 1000000, 1500000, 150000000, 30000000, 500000, null, null, 1234]);
});

console.log('잇기');
t('이름 키 — 띄어쓰기·가운뎃점·빗금·괄호를 걷는다 · rERP 날짜 읽기', () => {
  assert.equal(nameKey('연구시설·장비비'), nameKey('연구시설장비비'));
  assert.equal(nameKey('연구시설 장비비'), nameKey('연구시설/장비비'));
  assert.equal(nameKey('간접비(출금)'), '간접비', '괄호 안은 통째로 걷는다 — 실서버 비목명(2026-10-11)');
  assert.equal(nameKey('인건비(현금)'), '인건비');
  assert.deepEqual([d8('20260401'), d8('2026-04-01'), d8('2026.4.1'), d8('')], ['2026-04-01', '2026-04-01', '', '']);
});
t('과제번호(없으면 과제명)의 연차 행들 — 연차 차례', () => {
  assert.deepEqual(projectRecs(RECS, { code: '2026-0063-01' }).map((r) => [r.anl, r.stDt, r.rspr]), [[1, '2026-04-01', '박기도'], [2, '2027-04-01', '박기도']]);
  assert.deepEqual(projectRecs(RECS, { code: 'rnd-없음', name: '선박용 수소 연료전지 추진 시스템' }).map((r) => r.prjNo), ['2025-0011-02']);
  assert.deepEqual(projectRecs(RECS, { code: '', name: '없는 과제' }), []);
});
t('차년도에 맞는 행 — ① 연차가 같은 행 ② 연구기간이 차년도를 품는 행 ③ 하나뿐이면 그것, 아니면 null', () => {
  const rows = projectRecs(RECS, { code: '2026-0063-01' });
  assert.equal(pickYearRec(rows, { n: 2, start: '2027-04-01', end: '2028-03-31' }).anl, 2);
  const noAnl = rows.map((r) => ({ ...r, anl: 0 }));
  assert.equal(pickYearRec(noAnl, { n: 2, start: '2027-04-01', end: '2028-03-31' }).stDt, '2027-04-01', '기간으로');
  assert.equal(pickYearRec(noAnl, { n: 3, start: '2028-04-01', end: '2029-03-31' }), null, '둘 다 안 맞고 행이 여럿이면 못 고른다');
  assert.equal(pickYearRec(noAnl.slice(0, 1), { n: 3, start: '2028-04-01', end: '2029-03-31' }).stDt, '2026-04-01', '하나뿐이면 그것');
  assert.equal(pickYearRec([], { n: 1 }), null);
});
t('후보 목록 — 과제마다 연차 큰 행 하나, 이름이 비슷한 것(★) 먼저, 그 다음 시작일 늦은 것', () => {
  const list = candidates(RECS, { name: 'MW급 차단기 개발' });
  assert.deepEqual(list.map((c) => [c.prjNo, c.anl, c.like]), [['2026-0063-01', 2, true], ['2025-0011-02', 3, false], ['2020-0001-01', 1, false]]);
});
t('잇기 모양과 저장 모양 — 과제번호가 없으면 이어지지 않은 것, 스냅샷은 budget 이 있어야', () => {
  const link = linkOf(projectRecs(RECS, { code: '2026-0063-01' })[0], { auto: true, now: 5 });
  assert.deepEqual(link, { prjNo: '2026-0063-01', anl: 1, prjNm: 'MW급 10kV 반도체 차단기 개발', rspr: '박기도', stDt: '2026-04-01', endDt: '2027-03-31', auto: true, linkedAt: 5, snap: null });
  assert.equal(normalizeErp(null), null);
  assert.equal(normalizeErp({ prjNm: '번호 없음' }), null);
  const n = normalizeErp({ ...link, snap: { at: 9, std: '20', budget: { bgtAmt: 1 }, cards: { count: '2', amount: 300 } }, error: { kind: 'login' } });
  assert.deepEqual(n.snap, { at: 9, std: '20', budget: { bgtAmt: 1 }, cards: { from: '', to: '', count: 2, amount: 300 }, error: '' });
  assert.equal(n.error, undefined, '못 받은 까닭은 저장하지 않는다');
  assert.equal(normalizeErp({ ...link, snap: { at: 9 } }).snap, null);
  const y = normalizeYear({ budget: [{ id: 'r1', item: '인건비', plan: 1000, used: 500, erpKey: '10|인건비' }, { id: 'r2', item: '연구활동비', plan: 1 }], erp: link });
  assert.equal(y.budget[0].erpKey, '10|인건비');
  assert.equal('erpKey' in y.budget[1], false);
  assert.equal(y.erp.prjNo, '2026-0063-01');
  assert.equal('erp' in normalizeYear({ budget: [] }), false);
});
t('살아 있는 차년도(오늘이 든 것)만 다시 받고, 10분 안이면 신선하다', () => {
  assert.equal(isLive({ start: '2026-04-01', end: '2027-03-31' }, '2026-10-11'), true);
  assert.equal(isLive({ start: '2027-04-01', end: '2028-03-31' }, '2026-10-11'), false);
  assert.equal(isLive({ start: '', end: '' }, '2026-10-11'), true, '기간 미정이면 산다');
  assert.equal(isFresh({ at: 1000, budget: {} }, 1000 + ERP_TTL_MS - 1), true);
  assert.equal(isFresh({ at: 1000, budget: {} }, 1000 + ERP_TTL_MS), false);
  assert.equal(isFresh({ at: 1000, error: 'x' }, 1001), false, '못 받았으면 다시');
  assert.equal(isFresh(null, 1), false);
  assert.equal(monthsBetween('2026-04-01', '2026-10-11'), 6);
});

console.log('비목 맞추기 · 장부에');
const ITEMS = [
  { res: '산업부', resCd: '10', exp: '인건비', bgt: 31425000, appr: 12345000, bal: 19080000, req: 0 },
  { res: '산업부', resCd: '10', exp: '연구활동비', bgt: 43700000, appr: 19712839, bal: 23838661, req: 148500 },
  { res: '산업부', resCd: '10', exp: '연구시설장비비', bgt: 15000000, appr: 0, bal: 15000000, req: 0 },
  { res: '기업', resCd: '20', exp: '연구활동비', bgt: 5000000, appr: 1000000, bal: 4000000, req: 0 },
  { res: '산업부', resCd: '10', exp: '위탁연구개발비', bgt: 5000000, appr: 3000000, bal: 2000000, req: 0 },
];
const ROWS = () => [{ id: 'a', item: '인건비', plan: 31425000, used: null }, { id: 'b', item: '연구시설·장비비', plan: 15000000, used: 10 }, { id: 'c', item: '연구재료비', plan: null, used: null }, { id: 'd', item: '연구활동비', plan: 43700000, used: 1 }, { id: 'e', item: '간접비', plan: 1, used: 2, erpKey: '10|간접비' }];
t('이름 키로 맞추고, 재원이 여럿인 비목은 합한다(키는 첫 재원) · rERP 에만 있는 비목은 orphans', () => {
  const { matched, orphans } = matchRows(ROWS(), ITEMS);
  assert.deepEqual([...matched.keys()], ['a', 'b', 'd']);
  assert.deepEqual([matched.get('a').key, matched.get('a').appr], ['10|인건비', 12345000]);
  assert.deepEqual([matched.get('b').key, matched.get('b').appr, matched.get('b').bgt], ['10|연구시설장비비', 0, 15000000]);
  assert.deepEqual([matched.get('d').key, matched.get('d').keys, matched.get('d').appr, matched.get('d').bgt, matched.get('d').req], ['10|연구활동비', ['10|연구활동비', '20|연구활동비'], 20712839, 48700000, 148500]);
  assert.deepEqual(orphans.map((x) => x.exp), ['위탁연구개발비']);
});
t('스냅샷을 장부 줄에 — 맞춰진 줄은 집행 = 승인액과 erpKey, 안 맞는 줄은 erpKey 만 비운다(집행은 둠)', () => {
  const rows = ROWS();
  const n = applySnapshot(rows, { budget: { items: ITEMS } });
  assert.equal(n, 4, '인건비·장비비·연구활동비 바뀜 + 간접비 erpKey 비움');
  assert.deepEqual(rows.map((r) => [r.id, r.used, r.erpKey || '']), [['a', 12345000, '10|인건비'], ['b', 0, '10|연구시설장비비'], ['c', null, ''], ['d', 20712839, '10|연구활동비'], ['e', 2, '']]);
  assert.equal(applySnapshot(rows, { budget: { items: ITEMS } }), 0, '같은 것을 다시 넣으면 바뀐 줄 없음');
  // 설정에 따라 사용계획(planned — 비목 키마다 예상 비용 합, 재원이 여럿이면 키마다)을 더한다. 승인전(req)은 더하지 않는다(2026-10-11 사용자 지정 — 옛 옵션을 줘도 무시)
  assert.equal(applySnapshot(rows, { budget: { items: ITEMS } }, { req: true }), 0, '승인전 148,500 은 더하지 않는다');
  assert.equal(rows.find((r) => r.id === 'd').used, 20712839);
  applySnapshot(rows, { budget: { items: ITEMS } }, { planned: (k) => ({ '10|연구활동비': 150000, '20|연구활동비': 50000, '10|인건비': 7 })[k] || 0 });
  assert.deepEqual(rows.filter((r) => r.erpKey).map((r) => r.used), [12345007, 0, 20712839 + 200000]);
  // 더한 사용계획 몫은 erpPlan 에 따로(막대가 다른 색으로 그린다 — 2026-10-11 사용자 지정). 0 이면 없다.
  assert.deepEqual(rows.filter((r) => r.erpKey).map((r) => r.erpPlan), [7, undefined, 200000]);
  assert.equal(applySnapshot(rows, { budget: { items: ITEMS } }, { planned: (k) => ({ '10|연구활동비': 150000, '20|연구활동비': 50000, '10|인건비': 7 })[k] || 0 }), 0, '같은 사용계획이면 바뀐 줄 없음');
  assert.equal(applySnapshot(rows, { budget: { items: ITEMS } }), 2, '사용계획을 끄면 erpPlan 이 있던 두 줄이 바뀐다');
  assert.ok(rows.every((r) => r.erpPlan === undefined), 'erpPlan 은 지워진다');
  assert.equal(applySnapshot(rows, null), 3, '스냅샷이 없으면 맞춰진 줄의 erpKey 를 다 비운다');
});
t('미청구는 연구활동비 줄 하나에 든다(2026-10-12 사용자 지정) — erpUnbilled 에 따로, 끄면 지움, 그 줄이 없으면 어느 줄에도 안 든다', () => {
  assert.equal(UNBILLED_ITEM, '연구활동비');
  const rows = ROWS();
  applySnapshot(rows, { budget: { items: ITEMS } });
  assert.equal(applySnapshot(rows, { budget: { items: ITEMS } }, { unbilled: 523000 }), 1, '연구활동비 줄만 바뀐다');
  const d = rows.find((r) => r.id === 'd');
  assert.deepEqual([d.used, d.erpUnbilled], [20712839 + 523000, 523000]);
  assert.ok(rows.filter((r) => r.id !== 'd').every((r) => r.erpUnbilled === undefined), '다른 줄에는 없다');
  assert.equal(applySnapshot(rows, { budget: { items: ITEMS } }, { unbilled: 523000 }), 0, '같은 미청구면 바뀐 줄 없음');
  // 사용계획과 함께 — 집행 = 승인액 + 사용계획 + 미청구, 몫은 각각 erpPlan·erpUnbilled 에(막대 색이 다르다)
  applySnapshot(rows, { budget: { items: ITEMS } }, { planned: (k) => ({ '10|연구활동비': 150000, '20|연구활동비': 50000 })[k] || 0, unbilled: 523000 });
  assert.deepEqual([d.used, d.erpPlan, d.erpUnbilled], [20712839 + 200000 + 523000, 200000, 523000]);
  assert.equal(applySnapshot(rows, { budget: { items: ITEMS } }), 1, '둘 다 끄면 연구활동비 줄이 승인액으로 돌아온다');
  assert.deepEqual([d.used, d.erpPlan, d.erpUnbilled], [20712839, undefined, undefined]);
  assert.equal(applySnapshot(rows, { budget: { items: ITEMS } }, { unbilled: '523000' }), 1, '글로 와도 수로');
  assert.equal(d.erpUnbilled, 523000);
  assert.equal(applySnapshot(rows, { budget: { items: ITEMS } }, { unbilled: -5 }), 1, '음수·0 은 없는 것');
  assert.equal(d.erpUnbilled, undefined);
  // 연구활동비 줄이 없거나 rERP 와 안 맞춰졌으면 어느 줄에도 들지 않는다 — 패널이 합계 위 보조 줄로 보인다
  const noAct = ROWS().filter((r) => r.id !== 'd');
  applySnapshot(noAct, { budget: { items: ITEMS } }, { unbilled: 523000 });
  assert.ok(noAct.every((r) => r.erpUnbilled === undefined));
  const unmatched = ROWS();
  applySnapshot(unmatched, { budget: { items: ITEMS.filter((x) => x.exp !== '연구활동비') } }, { unbilled: 523000 });
  assert.ok(unmatched.every((r) => r.erpUnbilled === undefined), 'rERP 에 연구활동비가 없으면 장부 줄이 있어도 안 든다(손으로 적은 집행은 둔다)');
  assert.equal(unmatched.find((r) => r.id === 'd').used, 1);
  // 스냅샷이 없어지면 erpUnbilled 도 지운다
  applySnapshot(rows, { budget: { items: ITEMS } }, { unbilled: 523000 });
  applySnapshot(rows, null);
  assert.ok(rows.every((r) => r.erpUnbilled === undefined && r.erpKey === undefined));
});
t('R&D 설정 모양과 미청구 몫 — erp 는 기본 켬, 미청구·사용계획은 기본 끔. 승인전(req)은 없다(2026-10-11 사용자 지정 — 저장돼 있어도 읽지 않음)', () => {
  assert.deepEqual(normalizeSet(null), { erp: true, unbilled: false, plan: false, hide: [], months: false });
  assert.deepEqual(normalizeSet({ erp: false, req: true, unbilled: true, plan: 'yes', months: true }), { erp: false, unbilled: true, plan: false, hide: [], months: true });
  assert.equal(normalizeSet({ months: 'yes' }).months, false, '참여인력의 달마다 지급 줄 펼침(머리 줄의 M — 2026-10-19)은 참일 때만, 기본 접힘');
  assert.deepEqual(includeNames(normalizeSet({ unbilled: true, plan: true })), ['미청구', '사용계획']);
  assert.deepEqual(includeNames({ req: true }), []);
  // 예산 칸에서 숨긴 비목(hide — 2026-10-11 사용자 지정): 글만, 겹침·빈 것은 걷고, 이름 키로 견준다(연구시설·장비비 = 연구시설장비비, 간접비(출금) = 간접비)
  assert.deepEqual(normalizeSet({ hide: ['간접비', ' 연구재료비 ', '', 7, '간접비'] }).hide, ['간접비', '연구재료비']);
  assert.deepEqual(normalizeSet({ hide: '간접비' }).hide, []);
  const hid = normalizeSet({ hide: ['연구시설장비비', '간접비'] });
  assert.deepEqual(['연구시설·장비비', '간접비(출금)', '인건비', ''].map((n) => isHidden(hid, n)), [true, true, false, false]);
  assert.equal(isHidden(null, '간접비'), false);
  const snap = { budget: { unbilled: 523000, unbilledCount: 2 } };
  assert.deepEqual(erpExtras(snap, { unbilled: true }), { unbilled: 523000, count: 2 });
  assert.deepEqual(erpExtras(snap, { unbilled: false }), { unbilled: 0, count: 0 });
  assert.deepEqual(erpExtras(null, { unbilled: true }), { unbilled: 0, count: 0 });
});

console.log('받기(흉내 erp)');
function fakeErp({ loginFirst = false, cardsFail = false, eclassDown = false } = {}) {
  const calls = [];
  let loggedIn = !loginFirst;
  const loginErr = () => Object.assign(new Error('rcomm_0041_01_r004: 사용자 정보가 존재하지 않습니다'), { kind: 'login' });
  return {
    calls,
    settingsOf: (o) => ({ ...o }),
    async fetchBudget(prjNo, s) { calls.push(['budget', prjNo, s.monthsBack]); if (!loggedIn) throw loginErr(); return { std: '10', items: ITEMS.slice(0, 3), bgtAmt: 58700000, apprAmt: 19712839, balAmt: 38838661, reqAmt: 148500, rate: 33.58, resCount: 1 }; },
    async fetchCards(prjNo, s) { calls.push(['cards', prjNo, s.monthsBack, s.monthsForward]); if (cardsFail) throw new Error('카드 조회 실패'); return [{ amount: 500000 }, { amount: 23000 }]; },
    withPending(b, unbilled, count) { b.unbilled = unbilled; b.unbilledCount = count; b.pending = unbilled + b.reqAmt; b.execAmt = b.apprAmt + b.pending; b.balAfter = b.balAmt - unbilled; b.rateAll = 34.72; return b; },
    async ssoLogin() { calls.push(['sso']); if (eclassDown) throw Object.assign(new Error('eClass 로그인이 풀려'), { kind: 'eclass-login' }); loggedIn = true; return { ok: true }; },
  };
}
await ta('비목별 잔액과 미청구 카드(차년도 시작일부터 오늘 + 한 달)를 받아 스냅샷으로', async () => {
  const erp = fakeErp();
  const s = await fetchSnapshot(erp, 'P1', { year: { n: 1, start: '2026-04-01', end: '2027-03-31' }, today: '2026-10-11', now: 77 });
  assert.deepEqual(erp.calls, [['budget', 'P1', 7], ['cards', 'P1', 7, 1]]);
  assert.deepEqual([s.at, s.std, s.budget.unbilled, s.budget.unbilledCount, s.budget.balAfter, s.cards, s.error], [77, '10', 523000, 2, 38315661, { from: '2026-04-01', to: '2026-10-11', count: 2, amount: 523000 }, '']);
});
await ta('로그인이 풀렸으면 SSO 를 한 번 하고 다시 받는다 · eClass 도 풀렸으면 eclass-login 으로 던진다 · 카드만 실패하면 까닭을 남기고 잔액은 받는다', async () => {
  const erp = fakeErp({ loginFirst: true });
  const s = await fetchSnapshot(erp, 'P1', { year: { n: 1, start: '2026-04-01', end: '2027-03-31' }, today: '2026-10-11' });
  assert.deepEqual(erp.calls.map((c) => c[0]), ['budget', 'sso', 'budget', 'cards']);
  assert.equal(s.budget.unbilledCount, 2);
  await assert.rejects(() => fetchSnapshot(fakeErp({ loginFirst: true, eclassDown: true }), 'P1', { year: { n: 1 }, today: '2026-10-11' }), (e) => e.kind === 'eclass-login');
  const partial = await fetchSnapshot(fakeErp({ cardsFail: true }), 'P1', { year: { n: 1, start: '', end: '' }, today: '2026-10-11' });
  assert.equal(partial.budget.unbilled, 0);
  assert.match(partial.error, /미청구 카드는 못 받음 — 카드 조회 실패/);
});

console.log('글');
t('칸 머리와 요약 줄', () => {
  const erp = { prjNo: 'P1', prjNm: '차단기', anl: 1, snap: { at: Date.UTC(2026, 9, 11, 5, 5), std: '10', budget: { bgtAmt: 58700000, apprAmt: 19712839, reqAmt: 148500, unbilled: 523000, unbilledCount: 2, balAmt: 38838661, balAfter: 38315661, rate: 33.58, rateAll: 34.72, exclNames: ['인건비', '간접비'] }, cards: {}, error: '' } };
  assert.equal(erpHead(null), '');
  assert.equal(erpHead({ prjNo: 'P1', snap: null }), 'rERP 이음');
  assert.equal(erpHead({ prjNo: 'P1', snap: null, error: { kind: 'login' } }), 'rERP 로그인 필요');
  assert.equal(erpHead({ prjNo: 'P1', snap: null, error: { kind: 'network' } }), 'rERP 못 받음');
  assert.equal(erpHead(erp), 'rERP 집행비율 34.7%');
  assert.equal(erpHead({ ...erp, error: { kind: 'login' } }), 'rERP 집행비율 34.7% · 로그인 필요', '지난 스냅샷은 보이면서 까닭도');
  const lines = erpSummaryLines(erp);
  assert.match(lines[0], /^- rERP P1 차단기 \(1연차\) · 조회 \d\d\.\d\d \d\d:\d\d$/);
  assert.equal(lines[1], '- rERP 집행비율 34.7% = (승인액 19,712,839원 + 미청구 523,000원 + 승인전 148,500원) ÷ 예산액 58,700,000원 (인건비·간접비 제외)');
  assert.equal(lines[2], '- 미청구 과제카드 2건 523,000원 · 승인전 148,500원 · 잔액(미청구 반영) 38,315,661원');
  assert.deepEqual(erpSummaryLines({ prjNo: 'P1', snap: null }), []);
  // 요약 글에도 들어간다
  const p = normalizeProject({ id: 'p', name: '차단기 과제', start: '2026-04-01', end: '2027-03-31', years: { 1: { budget: [{ id: 'a', item: '인건비', plan: 1000, used: 500 }], erp } } });
  assert.match(summaryText(p, 1, '2026-10-11'), /- 합계: 계획 1,000원[^\n]*\n- rERP P1 차단기/);
});

console.log('참여인력 — rERP 지급계획·다른 과제 참여율(참여인력 칸이 보이기만 한다 — 행·사람 모양은 rerp/staff.js)');
await ta('참여인력 행(rowsOfErp 모양) → 사람마다 월급여(시작월이 늦은 행의 지급한도액)·지급 합·신청 번호 — 개인정보 칸은 읽지 않는다', async () => {
  const calls = [];
  const erp = { async call(svc, input) { calls.push([svc, input]); return { INFO_REC: [
    { EMP_NM: '문창재', ROLE_NM: '참여연구원', PAY_LIMT_AMT: '5823000', PAY_AMT: '1165000', PART_RT: '20.01', PLAN_YM_FROM: '202604', PLAN_YM_TO: '202611', NCNT: '8', REQ_CNT: '9', SEQ_NO: '2', PARTRATE_YN: 'N', PART_TRM_DT_DTL: '2026-04-01 ~ 2026-12-31', SSN: 'x', EMP_NO: '1' },
    { EMP_NM: '문창재', ROLE_NM: '참여연구원', PAY_LIMT_AMT: '5823000', PAY_AMT: '1159000', PART_RT: '19.91', PLAN_YM_FROM: '202612', PLAN_YM_TO: '202612', NCNT: '1', REQ_CNT: '9', SEQ_NO: '2', PARTRATE_YN: 'N' },
    { EMP_NM: '김거화', ROLE_NM: '과제책임자', PAY_LIMT_AMT: '8480000', PAY_AMT: '2328000', PART_RT: '27.46', PLAN_YM_FROM: '202604', PLAN_YM_TO: '202611', NCNT: '8', REQ_CNT: '9', SEQ_NO: '1', PARTRATE_YN: 'Y' },
    { EMP_NM: '' },
  ], HM_PER_REC: [{ EMP_NM: '문창재' }] }; } };
  const rows = await fetchParticipants(erp, '2026-0063-01');
  assert.deepEqual(calls, [['rtask_0008_t03_01_r001', { SEARCH_NM: '', SEARCH_GB: '1', PRJ_NO: '2026-0063-01' }]]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { name: '문창재', role: '참여연구원', limit: 5823000, amt: 1165000, rate: 20.01, from: '2026-04', to: '2026-11', count: 8, req: '9', seq: '2', excluded: false, term: '2026-04-01 ~ 2026-12-31' });
  assert.ok(!('SSN' in rows[0]) && !('empNo' in rows[0]) && !('EMP_NO' in rows[0]));
  assert.equal(rows[2].excluded, true);
  const by = byName(rows);
  assert.deepEqual(Object.keys(by), ['문창재', '김거화']);
  assert.deepEqual([by['문창재'].monthly, by['문창재'].total, by['문창재'].req, by['문창재'].seq, by['문창재'].from, by['문창재'].to, by['문창재'].ranges.length], [5823000, 1165000 * 8 + 1159000, '9', '2', '2026-04', '2026-12', 2]);
  assert.deepEqual([by['김거화'].total, by['김거화'].role], [2328000 * 8, '과제책임자']);
  const shares = sharesOfErp(rows, { prjNo: '2026-0063-01', now: 5 });
  assert.deepEqual(shares.map((s) => [s.name, s.total, s.erp.monthly, s.erp.prjNo, s.erp.at, s.erp.req, s.erp.seq]), [['문창재', 10479000, 5823000, '2026-0063-01', 5, '9', '2'], ['김거화', 18624000, 8480000, '2026-0063-01', 5, '9', '1']]);
  // 잇기(erp.staff)에 남는 사람 모양 — 지급기간을 달마다 펼친 월별 지급. normalizeErp 가 조회 시각과 함께 지키고, 사람이 없으면 없는 것.
  const staff = peopleOfErp(rows, { prjNo: '2026-0063-01', now: 5 });
  const kept = normalizeErp({ prjNo: '2026-0063-01', anl: 1, staff: { at: 7, ...staff } });
  assert.deepEqual([kept.staff.at, kept.staff.basis, kept.staff.src, kept.staff.people.map((q) => [q.name, q.plan.length, q.erp.monthly])], [7, 'rerp', 'erp', [['문창재', 9, 5823000], ['김거화', 8, 8480000]]]);
  assert.ok(!('staff' in normalizeErp({ prjNo: 'P', staff: { at: 7, people: [] } })));
});
await ta('다른 과제 월별 참여율(rtask_0013_12_r003 — 지급계획 팝업의 한도 검사 자료) — 달·계상률·지급금액만, 주민번호는 버린다', async () => {
  const calls = [];
  const erp = { async call(svc, input) { calls.push([svc, input]); return { STD_AMT: '5823000', REC: [{ PLAN_YM: '202604', ETC_PART_RT: '64.00', ETC_PAY_AMT: '0', SSN: '870302' }, { PLAN_YM: '202605', ETC_PART_RT: '36.81', ETC_PAY_AMT: '1444583' }, { PLAN_YM: '' }] }; } };
  const r = await fetchOthers(erp, { prjNo: '2026-0063-01', req: '9', seq: '2' });
  assert.deepEqual(calls, [['rtask_0013_12_r003', { PRJ_NO: '2026-0063-01', REQ_CNT: '9', SEQ_NO: '2' }]]);
  assert.deepEqual(r, { std: 5823000, rows: [{ ym: '2026-04', rate: 64, amt: 0 }, { ym: '2026-05', rate: 36.81, amt: 1444583 }] });
  assert.ok(!JSON.stringify(r).includes('870302'));
});

console.log(`\n${pass} passed`);
