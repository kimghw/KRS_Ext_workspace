// kr_ext_rerp `tests/staff.test.js` 자리 — rerp/staff.js(참여연구원 참여율·지급액 계산, kr_ext_rerp lib/staff.js 를 그대로 옮긴 것)의 순수 함수 검사. 출처·갱신 규칙은 rerp/README.md.
// rERP 식(월급여 절삭·계상률 올림·균등 분할 = rERP 저장 행), 사람 모양·형편(연간·월 최대 참여율), rERP 참여인력 행 → 사람(지급기간을 달마다 펼침)·다른 과제 참여율, 월급여 기준,
// 적용월부터 바꾸기, 이전 사람들 비율로 초기화(합 = 예산), 100% 알림·예산 상한, 요약 줄·탭 표, 저장 모양(staffPlans). 어디에도 보내지 않는다.
// WORKSPACE 는 이 가운데 rERP 행 → 사람·형편·알림·글만 써서 보인다(rndpanel.js 참여인력 칸) — 계산·변경은 kr_ext_rerp 의 사업비 변경 메뉴(2026-10-18 사용자 지정).
import assert from 'node:assert/strict';

import {
  STAFF_MAX, money, thousand, thousandOf, isYm, ymOf, addMonths, ymRange, spanMonths, ymText, monthLabel, monthlyOfSalary, rerpRate, amountOfRate, splitEven,
  normalizePerson, normalizeStaff, normalizePlans, planMonthly, monthlyPay, personStats, staffTotal, overBudget, rateText, statsText, monthlyText, buildStaff, initFromShares,
  sharesOfStaff, rowsOfErp, byName, peopleOfErp, othersOfErp, sharesOfErp, applyChange, setTotal, setRate, setManual, mergeOthers, checks, staffLines, staffTsv,
  planKey, yearLabel, anlOf, yearSpan, plansOfProject,
} from '../rerp/staff.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const YEAR = { n: 1, start: '2026-04-01', end: '2026-12-31' };
const Y2 = { n: 2, start: '2027-01-01', end: '2027-12-31' };
// SSCB 1차년도 r1 — rerp/reference.md §4 의 실측(월급여 5,823,000 / 8,480,000 · 저장 행 1,165,000×8 + 1,159,000 / 2,328,000×8 + 2,322,000).
const PERSONS = [
  { name: '김거화', role: '수석', salary: 101763000, pay: 20946000, rate: 27.45, months: 9 },
  { name: '문창재', role: '책임', salary: 69877000, pay: 10479000, rate: 20, months: 9 },
];
// rERP 참여인력 조회(rtask_0008_t03_01_r001)의 INFO_REC — 지급기간마다 한 행. 주민번호·사번 같은 칸은 읽지 않아야 한다.
const REC = [
  { EMP_NM: '문창재', ROLE_NM: '참여연구원', PAY_LIMT_AMT: '5823000', PAY_AMT: '1165000', PART_RT: '20.01', PLAN_YM_FROM: '202604', PLAN_YM_TO: '202611', NCNT: '8', REQ_CNT: '9', SEQ_NO: '2', PARTRATE_YN: 'N', PART_TRM_DT_DTL: '2026-04-01 ~ 2026-12-31', SSN: 'x', EMP_NO: '1' },
  { EMP_NM: '문창재', ROLE_NM: '참여연구원', PAY_LIMT_AMT: '5823000', PAY_AMT: '1159000', PART_RT: '19.91', PLAN_YM_FROM: '202612', PLAN_YM_TO: '202612', NCNT: '1', REQ_CNT: '9', SEQ_NO: '2', PARTRATE_YN: 'N' },
  { EMP_NM: '김거화', ROLE_NM: '과제책임자', PAY_LIMT_AMT: '8480000', PAY_AMT: '2328000', PART_RT: '27.46', PLAN_YM_FROM: '202604', PLAN_YM_TO: '202611', NCNT: '8', REQ_CNT: '9', SEQ_NO: '1', PARTRATE_YN: 'Y' },
  { EMP_NM: '' }, null,
];

console.log('달·돈');
t('달 — 범위·더하기·글·이름', () => {
  assert.deepEqual([isYm('2026-04'), isYm('2026-13'), isYm('2026-4'), ymOf('2026-04-01'), ymOf('202604'), ymOf('')], [true, false, false, '2026-04', '2026-04', '']);
  assert.deepEqual([addMonths('2026-12', 1), addMonths('2026-04', -4), addMonths('2026-01', 23)], ['2027-01', '2025-12', '2027-12']);
  assert.deepEqual(ymRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual([ymRange('2026-12', '2026-11'), ymRange('x', '2026-11')], [[], []]);
  assert.equal(spanMonths(YEAR).length, 9, 'start·end(날짜)');
  assert.equal(spanMonths({ from: '2026-04', to: '2026-06' }).length, 3, 'from·to(달)');
  assert.deepEqual([spanMonths({ start: '', end: '' }), spanMonths(null)], [[], []]);
  assert.deepEqual([ymText('2026-04', '2026-12'), ymText('2026-12', '2026-12'), ymText('2026-04', '2027-03'), ymText('', '')], ['4~12월', '12월', "'26.4~'27.3월", '']);
  assert.deepEqual([monthLabel('2026-04'), monthLabel('2027-01', '2026-12'), monthLabel('2026-05', '2026-04')], ['4월', "'27 1월", '5월']);
});
t('돈 — 원 읽기·천원 글', () => {
  assert.deepEqual([money('1,165,000원'), money(1165000.4), money('-1'), money(''), money('abc'), money(null)], [1165000, 1165000, null, null, null, null]);
  assert.deepEqual([thousand(10479000), thousand(1500), thousand(null), thousandOf('10,479'), thousandOf(''), thousandOf('x')], ['10,479', '2', '', 10479000, null, null]);
});

console.log('rERP 식');
t('월급여 — 급여총액 ÷ 12 천원 절삭', () => {
  assert.deepEqual([monthlyOfSalary(69877000), monthlyOfSalary(101763000), monthlyOfSalary(100000000), monthlyOfSalary(0), monthlyOfSalary(null)], [5823000, 8480000, 8333000, null, null]);
});
t('계상률 — 넷째 자리 반올림 뒤 셋째 자리 올림(reference §3 의 표 그대로)', () => {
  assert.deepEqual([rerpRate(1165000, 5823000), rerpRate(1164000, 5823000), rerpRate(1159000, 5823000), rerpRate(2328000, 8480000), rerpRate(2327000, 8480000)], [20.01, 19.99, 19.91, 27.46, 27.45]);
  assert.deepEqual([rerpRate(0, 5823000), rerpRate(1000, 0), rerpRate(-1, 5823000)], [0, null, null]);
  assert.equal(rerpRate(10479000, 5823000 * 9), 20, '합계행 기준 — 10,479 ÷ 52,407 = 19.9955 → 20.00');
  assert.equal(rerpRate(20946000, 8480000 * 9), 27.45);
});
t('참여율의 금액 — round천원(월급여 × %)', () => {
  assert.deepEqual([amountOfRate(5823000, 20), amountOfRate(8480000, 27.45), amountOfRate(5823000, 0), amountOfRate(0, 20)], [1165000, 2328000, 0, 0]);
});
t('균등 분할 — 앞달 올림·마지막 달 잔액, 합은 총액', () => {
  assert.deepEqual(splitEven(10479000, 9), [...Array(8).fill(1165000), 1159000]);
  assert.deepEqual(splitEven(20946000, 9), [...Array(8).fill(2328000), 2322000]);
  assert.deepEqual([splitEven(5000, 1), splitEven(0, 3), splitEven(1000, 3)], [[5000], [0, 0, 0], [0, 0, 1000]], '총액이 작으면 앞달을 내려 음수를 막는다');
  assert.deepEqual([splitEven(100, 0), splitEven(-1, 2)], [[], []]);
});

console.log('rERP 참여인력 행 → 사람');
t('rowsOfErp — INFO_REC 한 행 → 행(지급한도액·월 지급·계상률·지급기간·달 수·신청 번호·제외), 개인정보 칸은 읽지 않고 이름 없는 행은 뺀다', () => {
  const rows = rowsOfErp(REC);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { name: '문창재', role: '참여연구원', limit: 5823000, amt: 1165000, rate: 20.01, from: '2026-04', to: '2026-11', count: 8, req: '9', seq: '2', excluded: false, term: '2026-04-01 ~ 2026-12-31' });
  assert.ok(!('SSN' in rows[0]) && !('EMP_NO' in rows[0]));
  assert.deepEqual([rows[2].excluded, rows[2].term], [true, '']);
  assert.deepEqual([rowsOfErp(null), rowsOfErp({})], [[], []]);
});
t('byName — 사람마다 하나로: 월급여는 시작월이 늦은 행의 지급한도액, total 은 Σ 월 지급 × 달 수, 신청 번호·지급기간·행들', () => {
  const by = byName(rowsOfErp(REC));
  assert.deepEqual(Object.keys(by), ['문창재', '김거화']);
  const m = by['문창재'];
  assert.deepEqual([m.name, m.role, m.monthly, m.total, m.req, m.seq, m.from, m.to, m.ranges.length], ['문창재', '참여연구원', 5823000, 1165000 * 8 + 1159000, '9', '2', '2026-04', '2026-12', 2]);
  assert.deepEqual([by['김거화'].total, by['김거화'].role, by['김거화'].monthly], [2328000 * 8, '과제책임자', 8480000]);
  assert.ok(!('pick' in m));
  assert.deepEqual(byName(null), {});
  const two = byName([{ name: 'a', limit: 100, amt: 1, count: 1, from: '2026-01', to: '2026-01', req: '1', seq: '1' }, { name: 'a', limit: 200, amt: 1, count: 1, from: '2026-02', to: '2026-02', req: '2', seq: '1' }]);
  assert.deepEqual([two.a.monthly, two.a.req], [200, '2'], '한도가 바뀐 사람은 시작월이 늦은 행의 것');
});
t('peopleOfErp — 지급기간을 달마다 펼친 월별 지급·월급여 → 사람들(기준 rERP), 형편은 rERP 가 보이는 값과 같다', () => {
  const staff = peopleOfErp(rowsOfErp(REC), { prjNo: '2026-0063-01', now: 5 });
  assert.deepEqual([staff.basis, staff.src, staff.people.map((p) => p.name)], ['rerp', 'erp', ['문창재', '김거화']]);
  const moon = staff.people[0];
  assert.deepEqual(moon.plan, [...ymRange('2026-04', '2026-11').map((ym) => ({ ym, amt: 1165000 })), { ym: '2026-12', amt: 1159000 }], '4~11월 ×1,165,000 · 12월 ×1,159,000 → 9달');
  assert.deepEqual(moon.erp, { monthly: 5823000, prjNo: '2026-0063-01', at: 5, req: '9', seq: '2', others: [] });
  assert.deepEqual([moon.salary, moon.pay, moon.rate, moon.months, moon.manual], [null, null, null, null, null], '계획서 값은 없다');
  const s = personStats(moon, 'rerp');
  assert.deepEqual([s.total, s.months, s.from, s.to, s.rate, s.maxRate, s.maxYm, s.limit, s.src, s.planned], [10479000, 9, '2026-04', '2026-12', 20, 20.01, '2026-04', 5823000, 'rerp', true]);
  assert.equal(monthlyText(moon.plan), '4~11월 1,165 · 12월 1,159');
  assert.deepEqual([personStats(staff.people[1], 'rerp').rate, personStats(staff.people[1], 'rerp').months], [27.46, 8]);
  const only = peopleOfErp(rowsOfErp(REC), { months: ['2026-12'] });
  assert.deepEqual(only.people.map((p) => [p.name, p.plan.length]), [['문창재', 1]], 'months 를 주면 그 달들만 — 벗어난 사람은 빠진다');
  assert.deepEqual([peopleOfErp([]), peopleOfErp(null)], [null, null]);
  const dup = peopleOfErp([{ name: 'a', limit: 100, amt: 10, count: 1, from: '2026-01', to: '2026-02' }, { name: 'a', limit: 100, amt: 5, count: 1, from: '2026-02', to: '2026-02' }]);
  assert.deepEqual(dup.people[0].plan, [{ ym: '2026-01', amt: 10 }, { ym: '2026-02', amt: 15 }], '같은 달에 행이 겹치면 더한다');
});
t('othersOfErp — 다른 과제 월별 참여율 조회(rtask_0013_12_r003)의 응답 → 달·계상률·지급금액, 주민번호 칸은 버린다', () => {
  const r = othersOfErp({ STD_AMT: '5823000', REC: [{ PLAN_YM: '202604', ETC_PART_RT: '64.00', ETC_PAY_AMT: '0', SSN: '870302' }, { PLAN_YM: '202605', ETC_PART_RT: '36.81', ETC_PAY_AMT: '1444583' }, { PLAN_YM: '' }, null] });
  assert.deepEqual(r, { std: 5823000, rows: [{ ym: '2026-04', rate: 64, amt: 0 }, { ym: '2026-05', rate: 36.81, amt: 1444583 }] });
  assert.ok(!JSON.stringify(r).includes('870302'));
  assert.deepEqual(othersOfErp(null), { std: null, rows: [] });
});
t('sharesOfErp — 초기화 재료: 사람마다 지급 합·rERP 월급여', () => {
  const shares = sharesOfErp(rowsOfErp(REC), { prjNo: '2026-0063-01', now: 5 });
  assert.deepEqual(shares.map((s) => [s.name, s.role, s.total, s.erp.monthly, s.erp.prjNo, s.erp.at, s.erp.req, s.erp.seq]), [['문창재', '참여연구원', 10479000, 5823000, '2026-0063-01', 5, '9', '2'], ['김거화', '과제책임자', 18624000, 8480000, '2026-0063-01', 5, '9', '1']]);
  assert.deepEqual(sharesOfErp([]), []);
});

console.log('만들기');
t('계획서 사람들 → 월별 지급(계획 기간 첫 달부터 참여개월만큼 균등)·기준은 계획서', () => {
  const s = buildStaff(PERSONS, YEAR);
  assert.deepEqual([s.basis, s.src, s.people.length], ['plan', 'yaml', 2]);
  const kim = s.people[0];
  assert.deepEqual([kim.name, kim.role, kim.salary, kim.pay, kim.rate, kim.months, kim.manual, kim.erp], ['김거화', '수석', 101763000, 20946000, 27.45, 9, null, null]);
  assert.deepEqual(kim.plan.map((x) => x.ym), ymRange('2026-04', '2026-12'));
  assert.deepEqual(kim.plan.map((x) => x.amt), [...Array(8).fill(2328000), 2322000], 'rERP 저장 행과 원 단위까지 같다');
  const st = personStats(kim, 'plan');
  assert.deepEqual([st.limit, st.src, st.total, st.months, st.from, st.to, st.rate, st.maxRate, st.maxYm], [8480000, 'plan', 20946000, 9, '2026-04', '2026-12', 27.45, 27.46, '2026-04']);
  const moon = personStats(s.people[1], 'plan');
  assert.deepEqual([moon.limit, moon.rate, moon.maxRate, moon.rates.map((r) => r.rate)], [5823000, 20, 20.01, [...Array(8).fill(20.01), 19.91]]);
});
t('참여개월이 기간보다 길거나 금액이 없으면 — 달 수만큼 · 월별 없음(계획서 값으로 형편)', () => {
  const s = buildStaff([{ name: 'A', pay: 9000000, months: 12 }, { name: 'B', salary: 60000000, rate: 10, months: 9 }], YEAR);
  assert.equal(s.people[0].plan.length, 9);
  assert.deepEqual(s.people[1].plan, []);
  const b = personStats(s.people[1], 'plan');
  assert.deepEqual([b.planned, b.total, b.months, b.rate, b.limit], [false, 0, 9, 0, 5000000]);
  assert.equal(buildStaff([], YEAR), null);
  assert.equal(buildStaff([{ name: '' }], YEAR), null);
});
t('기간이 없으면 월별은 비고 계획서 값으로만 셈한다', () => {
  const s = buildStaff(PERSONS, { n: 1, start: '', end: '' });
  const st = personStats(s.people[1], 'plan');
  assert.deepEqual([s.people[1].plan, st.planned, st.total, st.months, st.rate, st.maxRate], [[], false, 10479000, 9, 20, null]);
});
t('다시 만들기 — 같은 사람은 id·직접 적은 월급여·rERP 값을 잇고, 계획서 값이 그대로면 바꿔 둔 월별도 그대로', () => {
  const s = buildStaff(PERSONS, YEAR);
  s.people[1].manual = 6000000;
  s.people[1].erp = { monthly: 5823000, prjNo: '2026-0063-01', at: 1, req: '9', seq: '2', others: [] };
  s.people[1].plan[8].amt = 1000000;   // 손으로 바꿈
  s.basis = 'rerp';
  const again = buildStaff([PERSONS[1], { ...PERSONS[0], pay: 21000000 }, { name: '새사람', pay: 1000000, months: 3 }], YEAR, s);
  assert.deepEqual(again.people.map((p) => p.name), ['문창재', '김거화', '새사람']);
  const moon = again.people[0];
  assert.deepEqual([moon.id, moon.manual, moon.erp.monthly, moon.plan[8].amt, again.basis], [s.people[1].id, 6000000, 5823000, 1000000, 'rerp']);
  assert.deepEqual([again.people[1].id, again.people[1].plan[0].amt], [s.people[0].id, 2334000], '금액이 바뀐 사람은 월별을 다시 깐다');
  assert.equal(again.people[2].plan.length, 3);
});
t('모양 — 저장된 것을 다시 읽기·이상한 값 버리기·한도·기본은 rERP 기준', () => {
  const raw = { basis: 'rerp', src: 'init', people: [
    { id: 'a', name: ' 홍 길동 ', role: 'x', salary: '100,000,000', pay: 15000000, rate: 120, months: 0, manual: 0, erp: { monthly: '5,000,000', prjNo: 'P', at: 5, req: '9', seq: '1', others: [{ ym: '2026-04', rate: '55', amt: '0' }, { ym: 'bad' }] }, plan: [{ ym: '2026-05', amt: 2 }, { ym: '2026-04', amt: 1 }, { ym: '2026-04', amt: 3 }, { ym: 'x', amt: 1 }] },
    { name: '' }, { name: '홍길동' }, { id: 'c', name: '이몽룡' },
  ] };
  const s = normalizeStaff(raw);
  assert.deepEqual([s.basis, s.src, s.people.length], ['rerp', 'init', 2]);
  const a = s.people[0];
  assert.deepEqual([a.id, a.name, a.salary, a.rate, a.months, a.manual, a.erp.monthly, a.erp.others, a.plan], ['a', '홍 길동', 100000000, null, null, null, 5000000, [{ ym: '2026-04', rate: 55, amt: 0 }], [{ ym: '2026-04', amt: 3 }, { ym: '2026-05', amt: 2 }]]);
  assert.deepEqual([normalizeStaff(null), normalizeStaff({ people: [] })], [null, null]);
  assert.deepEqual([normalizeStaff({ basis: 'x', people: [{ name: 'a' }] }).basis, normalizeStaff({ src: 'x', people: [{ name: 'a' }] }).src], ['rerp', 'erp'], '모르는 기준·출처는 rERP');
  assert.equal(normalizeStaff({ people: Array.from({ length: 40 }, (_, i) => ({ name: `p${i}` })) }).people.length, STAFF_MAX);
  assert.equal(normalizePerson({ erp: { monthly: 0 } }).erp, null, 'rERP 월급여가 0 이면 없는 것');
});
t('normalizePlans — 저장 모양(staffPlans): 과제마다 계획 하나, 틀린 값은 걷는다', () => {
  const plans = normalizePlans({ P1: { prjNo: 'P1', prjNm: 'x', from: '2026-04', to: '2026-12', budgetPay: '30,000,000', basis: 'rerp', src: 'erp', people: [{ name: 'a', plan: [{ ym: '2026-04', amt: 1 }] }], at: 7, note: 'n' }, P2: { from: 'bad', people: [] }, P3: null, P4: 'x' });
  assert.deepEqual(Object.keys(plans), ['P1', 'P2']);
  const p1 = plans.P1;
  assert.deepEqual([p1.prjNo, p1.prjNm, p1.from, p1.to, p1.budgetPay, p1.basis, p1.src, p1.people.length, p1.at, p1.note], ['P1', 'x', '2026-04', '2026-12', 30000000, 'rerp', 'erp', 1, 7, 'n']);
  assert.deepEqual([plans.P2.from, plans.P2.people, plans.P2.basis, plans.P2.src, plans.P2.prjNo, plans.P2.year], ['', [], 'rerp', 'erp', 'P2', null], '과제번호가 빠지면 키에서(2026-10-18 연차 키 "과제번호@연차" — normalizePlanEntry(raw, key))');
  assert.deepEqual(normalizePlans(null), {});
});

console.log('월급여 기준');
t('기준에 따라 — 직접 > rERP(기준이 rERP 일 때) > 계획서, 금액은 그대로', () => {
  const s = buildStaff(PERSONS, YEAR);
  const moon = s.people[1];
  assert.deepEqual(monthlyPay(moon, 'plan'), { amt: 5823000, src: 'plan', fallback: false });
  assert.deepEqual(monthlyPay(moon, 'rerp'), { amt: 5823000, src: 'plan', fallback: true }, 'rERP 값이 없으면 계획서 값으로 대신(표시)');
  moon.erp = { monthly: 6000000, prjNo: 'P', at: 1, req: '', seq: '', others: [] };
  assert.deepEqual(monthlyPay(moon, 'rerp'), { amt: 6000000, src: 'rerp', fallback: false });
  assert.equal(monthlyPay(moon, 'plan').amt, 5823000);
  const before = personStats(moon, 'plan');
  const after = personStats(moon, 'rerp');
  assert.deepEqual([before.total, after.total, before.rate, after.rate, after.maxRate], [10479000, 10479000, 20, 19.41, 19.42], '금액은 같고 참여율만 바뀐다');
  moon.manual = 5500000;
  assert.deepEqual([monthlyPay(moon, 'rerp').src, monthlyPay(moon, 'plan').src, personStats(moon, 'rerp').rate], ['manual', 'manual', 21.17]);
  assert.deepEqual(monthlyPay(normalizePerson({ name: 'x' }), 'plan'), { amt: null, src: 'none', fallback: false });
  assert.deepEqual(monthlyPay(normalizePerson({ name: 'x', erp: { monthly: 5000000 } }), 'plan'), { amt: 5000000, src: 'rerp', fallback: false }, '계획서 값이 없으면 기준이 계획서여도 rERP 값');
  assert.equal(planMonthly(normalizePerson({ name: 'x', pay: 20946000, months: 9, rate: 27.45 })), 8478000, '급여총액이 없으면 계상인건비 ÷ 개월 ÷ 계상률로 되짚는다');
});
t('월급여 직접 적기 — 기준값과 같거나 비우면 지운다', () => {
  const s = buildStaff(PERSONS, YEAR);
  const moon = s.people[1];
  assert.equal(setManual(moon, 'plan', '5,900').manual, 5900000);
  assert.equal(setManual(moon, 'plan', '5,823').manual, null, '기준값과 같으면 손으로 적은 것이 아니다');
  assert.equal(setManual({ ...moon, manual: 5900000 }, 'plan', '').manual, null);
  assert.throws(() => setManual(moon, 'plan', 'abc'), /천원 단위의 수/);
});

console.log('바꾸기');
t('적용월부터 — 앞 달은 그대로, 12월부터 참여율 10%', () => {
  const s = buildStaff(PERSONS, YEAR);
  const months = spanMonths(YEAR);
  const moon = applyChange(s.people[1], 'plan', { from: '2026-12', mode: 'rate', value: '10' }, months);
  assert.deepEqual(moon.plan.map((x) => x.amt), [...Array(8).fill(1165000), 582000]);
  const st = personStats(moon, 'plan');
  assert.deepEqual([st.total, st.months, st.rate, st.maxRate, st.maxYm], [9902000, 9, 18.9, 20.01, '2026-04'], '연간은 평균(합 기준), 월 최대는 따로');
  assert.deepEqual(s.people[1].plan[8].amt, 1159000, '원본은 안 건드린다');
});
t('제외(0%) — 12월부터 빼면 참여개월이 줄고 참여율은 남은 달 기준', () => {
  const s = buildStaff(PERSONS, YEAR);
  const moon = applyChange(s.people[1], 'plan', { from: '2026-12', mode: 'exclude' }, spanMonths(YEAR));
  const st = personStats(moon, 'plan');
  assert.deepEqual([st.total, st.months, st.from, st.to, st.rate, st.maxRate], [9320000, 8, '2026-04', '2026-11', 20.01, 20.01]);
  assert.equal(moon.plan[8].amt, 0, '0원 달은 남아 있다');
  assert.equal(monthlyText(moon.plan), '4~11월 1,165 · 12월 제외');
});
t('구간 — 적용월부터 종료월까지만, 월 지급금액으로', () => {
  const s = buildStaff(PERSONS, YEAR);
  const kim = applyChange(s.people[0], 'plan', { from: '2026-10', to: '2026-11', mode: 'amt', value: 1000000 }, spanMonths(YEAR));
  assert.deepEqual(kim.plan.map((x) => x.amt), [2328000, 2328000, 2328000, 2328000, 2328000, 2328000, 1000000, 1000000, 2322000]);
  assert.equal(monthlyText(kim.plan), '4~9월 2,328 · 10~11월 1,000 · 12월 2,322');
});
t('더하기 — 달이 없던 사람은 범위의 달만 생긴다(5월부터 15%)', () => {
  const q = applyChange(normalizePerson({ name: '새사람', manual: 5000000 }), 'plan', { from: '2026-05', mode: 'rate', value: 15 }, spanMonths(YEAR));
  assert.deepEqual(q.plan.map((x) => [x.ym, x.amt])[0], ['2026-05', 750000]);
  assert.equal(q.plan.length, 8);
  const st = personStats(q, 'plan');
  assert.deepEqual([st.total, st.months, st.from, st.rate], [6000000, 8, '2026-05', 15]);
});
t('틀린 값·달은 사람 말로 막는다', () => {
  const s = buildStaff(PERSONS, YEAR);
  const months = spanMonths(YEAR);
  assert.throws(() => applyChange(s.people[1], 'plan', { from: '', mode: 'rate', value: 10 }, months), /적용월을 고르세요/);
  assert.throws(() => applyChange(s.people[1], 'plan', { from: '2027-01', mode: 'rate', value: 10 }, months), /계획 기간 밖/);
  assert.throws(() => applyChange(s.people[1], 'plan', { from: '2026-12', mode: 'rate', value: 101 }, months), /0~100/);
  assert.throws(() => applyChange(s.people[1], 'plan', { from: '2026-12', mode: 'amt', value: null }, months), /0 이상의 금액/);
  assert.throws(() => applyChange(s.people[1], 'plan', { from: '2026-12', mode: 'x', value: 1 }, months), /모르는 변경 구분/);
  assert.throws(() => applyChange(normalizePerson({ name: 'n' }), 'plan', { from: '2026-12', mode: 'rate', value: 10 }, months), /월급여가 없어/);
  assert.throws(() => applyChange(normalizePerson({ name: 'n', manual: 1 }), 'plan', { from: '2026-12', mode: 'rate', value: 10 }, []), /계획 기간이 없어/);
});
t('총액·참여율 통째로 — 지급이 있는 달에 균등 / round천원(월급여 × %)', () => {
  const s = buildStaff(PERSONS, YEAR);
  const moon = setTotal(s.people[1], 9000000);
  assert.deepEqual(moon.plan.map((x) => x.amt), [...Array(8).fill(1000000), 1000000]);
  const ex = setTotal(applyChange(s.people[1], 'plan', { from: '2026-12', mode: 'exclude' }, spanMonths(YEAR)), 8000000);
  assert.deepEqual([ex.plan[7].amt, ex.plan[8].amt, personStats(ex, 'plan').months], [1000000, 0, 8], '제외한 달은 그대로 0');
  const r = setRate(s.people[1], 'plan', '15', spanMonths(YEAR));
  assert.deepEqual([r.plan[0].amt, r.plan[8].amt, personStats(r, 'plan').rate], [873000, 873000, 15]);
  assert.throws(() => setTotal(s.people[1], null), /0 이상의 금액/);
  assert.throws(() => setTotal(normalizePerson({ name: 'n' }), 1000, []), /계획 기간이 없어/);
});

console.log('초기화 — 이전 사람들의 비율');
t('이전 기간 지급 비율로 인건비 예산을 나눈다 — 합은 정확히 예산, 모든 달 균등', () => {
  const prev = buildStaff(PERSONS, YEAR);
  prev.people[1].erp = { monthly: 5823000, prjNo: '2026-0063-01', at: 1, req: '9', seq: '2', others: [] };
  prev.people[0].manual = 8500000;
  const s = initFromShares(sharesOfStaff(prev), { budgetPay: 35900000, span: Y2 });
  assert.equal(s.people[0].manual, 8500000, '직접 적은 월급여도 잇는다');
  s.people[0].manual = null;
  assert.deepEqual([s.basis, s.src, s.people.map((p) => p.name)], ['rerp', 'init', ['김거화', '문창재']]);
  const pays = s.people.map((p) => personStats(p, s.basis).total);
  assert.equal(pays[0] + pays[1], 35900000);
  assert.deepEqual(pays, [23929000, 11971000], '20,946 : 10,479 의 비율(천원 반올림, 잔차는 큰 사람에게)');
  assert.deepEqual([s.people[0].plan.length, s.people[0].months, s.people[1].erp.monthly, s.people[0].salary], [12, 12, 5823000, 101763000]);
  assert.deepEqual([personStats(s.people[1], 'rerp').rate, personStats(s.people[0], 'rerp').rate], [17.14, 23.52], '문창재는 rERP 월급여, 김거화는 계획서 급여총액(rERP 값 없음)');
  const odd = initFromShares([{ name: 'a', total: 1 }, { name: 'b', total: 1 }, { name: 'c', total: 1 }], { budgetPay: 1000000, span: Y2 });
  assert.deepEqual(odd.people.map((p) => p.pay), [334000, 333000, 333000], '잔차는 첫(가장 큰) 사람에게 — 합은 정확히 예산');
  assert.ok(personStats(s.people[0], 'rerp').fallback);
});
t('rERP 행에서도(sharesOfErp) · 예산이나 사람이 없으면 null · 기간이 없으면 달 없이', () => {
  const s = initFromShares(sharesOfErp(rowsOfErp(REC), { prjNo: 'P' }), { budgetPay: 30000000, span: Y2 });
  assert.deepEqual([s.basis, s.people.map((p) => [p.name, p.pay])], ['rerp', [['문창재', 10802000], ['김거화', 19198000]]], '10,479 : 18,624 로 30,000 을(천원 반올림)');
  const sources = [{ name: '홍길동', role: '수석', total: 15000000 }, { name: '성춘향', role: '책임', total: 5000000 }];
  const plain = initFromShares(sources, { budgetPay: 30000000, span: Y2 });
  assert.deepEqual([plain.basis, plain.people.map((p) => p.pay)], ['plan', [22500000, 7500000]]);
  assert.equal(initFromShares(sources, { budgetPay: null, span: Y2 }), null);
  assert.equal(initFromShares([], { budgetPay: 1000, span: Y2 }), null);
  assert.equal(initFromShares([{ name: 'a', total: 0 }], { budgetPay: 1000, span: Y2 }), null);
  const bare = initFromShares(sources, { budgetPay: 30000000, span: { n: 2, start: '', end: '' } });
  assert.deepEqual([bare.people[0].plan, bare.people[0].months, personStats(bare.people[0], 'plan').total], [[], null, 22500000]);
});

console.log('알림·상한');
t('100% — 밖에서 준 다른 과제와 rERP 가 아는 다른 과제를 합쳐 넘는 달이 있으면 사람마다 한 줄(막지 않는다)', () => {
  const s = buildStaff(PERSONS, YEAR);
  s.people[1].erp = { monthly: 5823000, prjNo: 'P', at: 1, req: '9', seq: '2', others: [{ ym: '2026-04', rate: 64, amt: 0 }, { ym: '2026-05', rate: 85, amt: 0 }, { ym: '2026-06', rate: 0, amt: 0 }] };
  const book = { 문창재: [{ ym: '2026-04', rate: 30, label: '차단기 과제' }, { ym: '2026-06', rate: 90, label: '차단기 과제' }], 김거화: [{ ym: '2026-04', rate: 72.55, label: '차단기 과제' }] };
  const others = mergeOthers(book, s);
  assert.deepEqual(others['문창재'].map((o) => [o.ym, o.rate, o.label]), [['2026-04', 64, 'rERP 다른 과제'], ['2026-05', 85, 'rERP 다른 과제']], 'rERP 행이 있는 달은 밖의 값을 버린다(두 번 세지 않게 — 6월의 0% 행은 다른 과제가 없다는 뜻), 0% 행은 넣지 않는다');
  assert.deepEqual(others['김거화'].map((o) => o.rate), [72.55], 'rERP 값이 없는 사람은 밖의 값 그대로');
  const w = checks(s, 'plan', { others });
  assert.deepEqual(w.map((x) => [x.kind, x.level, x.name]), [['over', 'warn', '김거화'], ['over', 'warn', '문창재']]);
  assert.equal(w[0].text, '김거화 — 4월 참여율 합 100.01% (이 과제 27.46% · 차단기 과제 72.55%)');
  assert.equal(w[1].text, '문창재 — 5월 참여율 합 105.01% (이 과제 20.01% · rERP 다른 과제 85.00%)');
  const two = checks(s, 'plan', { others: { 문창재: [{ ym: '2026-04', rate: 80, label: 'x' }, { ym: '2026-05', rate: 80, label: 'x' }] } });
  assert.match(two[0].text, / 외 1달$/, '넘는 달이 여럿이면 첫 달과 나머지 수');
  assert.equal(checks(buildStaff(PERSONS, YEAR), 'plan', {}).length, 0, '다른 과제가 없으면 조용하다');
  assert.deepEqual(mergeOthers({}, peopleOfErp(rowsOfErp(REC))), {}, 'rERP 에서 받은 사람들에 다른 과제 행이 아직 없으면 빈 것');
});
t('100% 는 넘어야 알림 — 정확히 100 은 아니다', () => {
  const s = buildStaff(PERSONS, YEAR);
  const w = checks(s, 'plan', { others: { 김거화: [{ ym: '2026-04', rate: 72.54, label: 'x' }] } });
  assert.equal(w.length, 0);
  assert.equal(checks(s, 'plan', { others: { 김거화: [{ ym: '2026-04', rate: 72.55, label: 'x' }] } })[0].kind, 'over');
});
t('예산 — 넘으면 error, 남으면 info, 같으면 조용 · 월급여 없음·rERP 없음 알림', () => {
  const s = buildStaff(PERSONS, YEAR);
  assert.deepEqual(overBudget(s, 'plan', 31425000), { total: 31425000, budget: 31425000, over: false, left: 0 });
  assert.equal(checks(s, 'plan', { budgetPay: 31425000 }).length, 0);
  assert.deepEqual(checks(s, 'plan', { budgetPay: 31000000 }).map((w) => [w.kind, w.level]), [['budget', 'error']]);
  assert.match(checks(s, 'plan', { budgetPay: 31000000 })[0].text, /인건비 합 31,425천원이 예산 31,000천원을 넘습니다 \(\+425천원\)/);
  assert.match(checks(s, 'plan', { budgetPay: 32000000 })[0].text, /남음 575천원/);
  assert.deepEqual(overBudget(s, 'plan', null), { total: 31425000, budget: null, over: false, left: null });
  const w = checks(s, 'rerp', {});
  assert.deepEqual(w.map((x) => x.kind), ['fallback']);
  assert.match(w[0].text, /rERP 월급여 없음: 김거화, 문창재 — 계획서 값으로/);
  const none = normalizeStaff({ people: [{ name: '새사람', plan: [{ ym: '2026-04', amt: 1000 }] }] });
  assert.deepEqual(checks(none, 'plan', {}).map((x) => [x.kind, x.level]), [['salary', 'warn']]);
});

console.log('글·표');
t('요약 줄과 탭으로 나눈 표', () => {
  const s = buildStaff(PERSONS, YEAR);
  const lines = staffLines(s, 'plan', { budgetPay: 31425000 });
  assert.equal(lines[0], '■ 참여연구자 (2명) — 월급여 기준: 계획서 연봉 · 인건비 합 31,425천원 (예산 31,425천원)');
  assert.equal(lines[2], '- 문창재 — 책임 · 월급여 5,823천원(계획서) · 4~12월 (9개월) · 계상인건비 10,479천원 · 참여율 20.00% (월 최대 20.01%) · 월별 4~11월 1,165 · 12월 1,159');
  assert.match(staffLines(s, 'plan', { budgetPay: 31000000 })[0], /예산 31,000천원 초과\)/);
  const even = initFromShares(sharesOfStaff(s), { budgetPay: 36000000, span: Y2 });
  assert.match(staffLines(even, 'plan')[1], /참여율 \d+\.\d\d% \(월 최대 \d+\.\d\d%\)/, '월 최대는 연간과 같아도 적는다');
  const tsv = staffTsv(s, 'plan').split('\n');
  assert.equal(tsv[0], ['성명', '직위', '월급여(천원)', '참여기간', '개월', '계상인건비(천원)', '참여율', '월 최대', '월별 지급(천원)'].join('\t'));
  assert.equal(tsv[1], ['김거화', '수석', '8,480', '4~12월', '9', '20,946', '27.45%', '27.46%', '4~11월 2,328 · 12월 2,322'].join('\t'));
  assert.deepEqual([rateText(20), rateText(null), statsText(personStats(s.people[1], 'plan')), statsText(null)], ['20.00%', '', '20.00% · 10,479천원 · 4~12월', '(없음)']);
  assert.equal(staffTotal(s, 'plan'), 31425000);
  // rERP 에서 받은 사람들(WORKSPACE 참여인력 칸이 보이는 것) — 기준은 rERP, 예산은 모른다
  const erp = peopleOfErp(rowsOfErp(REC), { prjNo: 'P', now: 1 });
  assert.equal(staffLines(erp, 'rerp')[1], '- 문창재 — 참여연구원 · 월급여 5,823천원(rERP) · 4~12월 (9개월) · 계상인건비 10,479천원 · 참여율 20.00% (월 최대 20.01%) · 월별 4~11월 1,165 · 12월 1,159');
  assert.equal(staffTsv(erp, 'rerp').split('\n')[2], ['김거화', '과제책임자', '8,480', '4~11월', '8', '18,624', '27.46%', '27.46%', '4~11월 2,328'].join('\t'));
  assert.deepEqual([staffLines(null, 'rerp'), staffTsv(null, 'rerp')], [[], '']);
});


t('연차 — 계획 키 과제번호@연차, 현재 연차 번호, 연차의 달 범위(현재 그대로 · 다음은 종료 다음 달부터 12달 · 앞은 시작 전 달까지 12달), 과제의 연차별 계획', () => {
  const P = { prjNo: 'P', anl: '2', stDt: '20270101', endDt: '20271231' };
  assert.deepEqual([planKey('P', 1), planKey('P', '3'), planKey('P', null), planKey('P', 0), planKey('P', 999)], ['P@1', 'P@3', 'P', 'P', 'P']);
  assert.deepEqual([yearLabel(2), anlOf(P), anlOf({ anl: '' }), anlOf(null), anlOf({ anl: '0' })], ['2차년도', 2, 1, 1, 1]);
  assert.deepEqual([yearSpan(P, 2), yearSpan(P, 3), yearSpan(P, 4), yearSpan(P, 1), yearSpan(P, undefined)], [{ from: '2027-01', to: '2027-12' }, { from: '2028-01', to: '2028-12' }, { from: '2029-01', to: '2029-12' }, { from: '2026-01', to: '2026-12' }, { from: '2027-01', to: '2027-12' }]);
  assert.deepEqual(yearSpan({ prjNo: 'Q', anl: '1', stDt: '20260401', endDt: '20261231' }, 2), { from: '2027-01', to: '2027-12' }, '첫 연차가 9달이어도 다음 연차는 종료 다음 달부터 12달');
  assert.deepEqual([yearSpan({ anl: '1' }, 2), yearSpan({ anl: '1', stDt: '20261231', endDt: '20260101' }, 1)], [{ from: '', to: '' }, { from: '', to: '' }]);
  const plans = { 'P@1': { prjNo: 'P', year: 1 }, 'P@2': { prjNo: 'P', year: 2 }, P: { prjNo: 'P' }, 'Q@1': { prjNo: 'Q', year: 1 } };
  assert.deepEqual(Object.keys(plansOfProject(plans, 'P')), ['1', '2']);
  assert.deepEqual(plansOfProject(null, 'P'), {});
  const norm = normalizePlans({ 'P@2': { prjNm: 'x', people: [{ name: '홍길동', plan: [{ ym: '2027-01', amt: 1 }] }] }, 'P@1': { prjNo: 'P', year: '1' }, P: { prjNo: 'P' }, 'R@9': { prjNo: 'R', year: 3 } });
  assert.deepEqual(Object.keys(norm).sort(), ['P', 'P@1', 'P@2', 'R@3'], '과제번호·연차가 빠지면 키에서, 있으면 값이 앞선다');
  assert.deepEqual([norm['P@2'].prjNo, norm['P@2'].year, norm['P@2'].people.length, norm['P@1'].year, norm.P.year], ['P', 2, 1, 1, null]);
});

console.log(`\n${pass} passed`);
