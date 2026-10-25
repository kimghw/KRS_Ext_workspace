// kr_ext_rerp `tests/staff.test.js` 를 ESM 으로 옮긴 것 — 머리의 require·전역 KRX_STAFF 만 import 로 바꿨다(본문은 원본 그대로). rerp/staff.js(lib/staff.js 를 그대로 옮긴 것)의 순수 함수 검사.
// WORKSPACE 는 이 가운데 rERP 행 → 사람·형편·알림·글·행정지원만 써서 보인다(rndpanel.js 참여인력 칸) — 계산·변경은 kr_ext_rerp 의 사업비 관리(2026-10-18 사용자 지정). 출처·갱신 규칙은 rerp/README.md.
/* lib/staff.js (사업비 변경 — 참여연구원 참여율·지급액 계산, 0.8.7) 테스트. 실행: node tests/staff.test.js
 * rERP 식(월급여 절삭·계상률 올림·균등 분할 = 자료생성 저장 행), 참여인력 행 → 사람(월별 지급·월급여), 다른 과제 월별 참여율, 형편(연간·월 최대), 적용일부터 바꾸기(앞 달 그대로·제외·구간·더하기, 날짜까지 — 날 수 비율 조각·기간 구간·경계),
 * 총액·참여율 통째로(구간만도)·월급여 직접, 이전 기간 비율로 초기화(합 = 예산·잔차), 100% 알림(같은 달은 rERP 값만)·예산 대비 초과금·부족금, 요약 줄·탭 표, 저장 모양. 어디에도 보내지 않는다 */
import assert from 'node:assert';
import S from '../rerp/staff.js';
let n = 0, failed = 0;
const test = (name, fn) => { try { fn(); n++; console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.stack || e.message); process.exitCode = 1; } };

const SPAN = { from: '2026-04', to: '2026-12' };
const Y2 = { from: '2027-01', to: '2027-12' };
// SSCB 1차년도 실측(kr_ext_workspace rerp/reference.md §4) — 월급여 5,823,000 / 8,480,000 · 저장 행 1,165,000×8 + 1,159,000 / 2,328,000×8 + 2,322,000
const REC = [
  { EMP_NM: '문창재', ROLE_NM: '참여연구원', PAY_LIMT_AMT: '5823000', PAY_AMT: '1165000', PART_RT: '20.01', PLAN_YM_FROM: '202604', PLAN_YM_TO: '202611', NCNT: '8', REQ_CNT: '9', SEQ_NO: '2', PARTRATE_YN: 'N', PART_TRM_DT_DTL: '2026-04-01 ~ 2026-12-31', SSN: 'secret', EMP_NO: '1' },
  { EMP_NM: '문창재', ROLE_NM: '참여연구원', PAY_LIMT_AMT: '5823000', PAY_AMT: '1159000', PART_RT: '19.91', PLAN_YM_FROM: '202612', PLAN_YM_TO: '202612', NCNT: '1', REQ_CNT: '9', SEQ_NO: '2', PARTRATE_YN: 'N' },
  { EMP_NM: '김거화', ROLE_NM: '과제책임자', PAY_LIMT_AMT: '8480000', PAY_AMT: '2328000', PART_RT: '27.46', PLAN_YM_FROM: '202604', PLAN_YM_TO: '202611', NCNT: '8', REQ_CNT: '9', SEQ_NO: '1', PARTRATE_YN: 'N' },
  { EMP_NM: '김거화', ROLE_NM: '과제책임자', PAY_LIMT_AMT: '8480000', PAY_AMT: '2322000', PART_RT: '27.39', PLAN_YM_FROM: '202612', PLAN_YM_TO: '202612', NCNT: '1', REQ_CNT: '9', SEQ_NO: '1', PARTRATE_YN: 'N' },
  { EMP_NM: '' },
];
const PERSONS = [
  { name: '김거화', role: '수석', salary: 101763000, pay: 20946000, rate: 27.45, months: 9 },
  { name: '문창재', role: '책임', salary: 69877000, pay: 10479000, rate: 20, months: 9 },
];

test('달·돈', () => {
  assert.deepStrictEqual([S.isYm('2026-04'), S.isYm('2026-13'), S.ymOf('2026-04-01'), S.ymOf('202604'), S.ymOf('')], [true, false, '2026-04', '2026-04', '']);
  assert.deepStrictEqual([S.addMonths('2026-12', 1), S.addMonths('2026-04', -4)], ['2027-01', '2025-12']);
  assert.deepStrictEqual(S.ymRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepStrictEqual([S.ymRange('2026-12', '2026-11'), S.spanMonths(SPAN).length, S.spanMonths({ start: '20260401', end: '20261231' }).length, S.spanMonths({})], [[], 9, 9, []]);
  assert.deepStrictEqual([S.ymText('2026-04', '2026-12'), S.ymText('2026-12', '2026-12'), S.ymText('2026-04', '2027-03'), S.monthLabel('2027-01', '2026-12'), S.monthLabel('2026-05', '2026-04')], ['4~12월', '12월', "'26.4~'27.3월", "'27 1월", '5월']);
  assert.deepStrictEqual([S.money('1,165,000원'), S.money('-1'), S.money(''), S.thousand(10479000), S.thousandOf('10,479'), S.thousandOf('x')], [1165000, null, null, '10,479', 10479000, null]);
});
test('rERP 식 — 월급여 절삭 · 계상률 올림(실측 표) · 참여율의 금액 · 균등 분할 = 저장 행', () => {
  assert.deepStrictEqual([S.monthlyOfSalary(69877000), S.monthlyOfSalary(101763000), S.monthlyOfSalary(0)], [5823000, 8480000, null]);
  assert.deepStrictEqual([S.rerpRate(1165000, 5823000), S.rerpRate(1164000, 5823000), S.rerpRate(1159000, 5823000), S.rerpRate(2328000, 8480000), S.rerpRate(2327000, 8480000)], [20.01, 19.99, 19.91, 27.46, 27.45]);
  assert.deepStrictEqual([S.rerpRate(10479000, 5823000 * 9), S.rerpRate(20946000, 8480000 * 9), S.rerpRate(0, 1), S.rerpRate(1, 0)], [20, 27.45, 0, null]);
  assert.deepStrictEqual([S.amountOfRate(5823000, 20), S.amountOfRate(8480000, 27.45), S.amountOfRate(8480000, 26.21), S.rerpRate(S.amountOfRate(8480000, 26.21), 8480000), S.rerpRate(S.amountOfRate(8480000, 27.45), 8480000)], [1164000, 2327000, 2222000, 26.21, 27.45], '참여율의 금액은 천원 내림 — rERP 계상률이 적은 % 를 넘지 않는다(반올림이면 2,223,000 → 26.22%; 2026-10-20)');
  assert.deepStrictEqual(S.splitEven(10479000, 9), [1165000, 1165000, 1165000, 1165000, 1165000, 1165000, 1165000, 1165000, 1159000]);
  assert.deepStrictEqual([S.splitEven(5000, 1), S.splitEven(1000, 3), S.splitEven(-1, 2)], [[5000], [0, 0, 1000], []]);
});
test('참여인력 행 → 사람 — 주민번호는 버리고, 지급기간을 달마다 펼쳐 월별 지급·월급여·신청 번호', () => {
  const rows = S.rowsOfErp(REC);
  assert.strictEqual(rows.length, 4);
  assert.deepStrictEqual(rows[0], { name: '문창재', role: '참여연구원', limit: 5823000, amt: 1165000, rate: 20.01, from: '2026-04', to: '2026-11', count: 8, req: '9', seq: '2', excluded: false, term: '2026-04-01 ~ 2026-12-31' });
  assert.ok(!JSON.stringify(rows).includes('secret') && !('EMP_NO' in rows[0]));
  const by = S.byName(rows);
  assert.deepStrictEqual([by['문창재'].monthly, by['문창재'].total, by['문창재'].req, by['문창재'].seq, by['문창재'].from, by['문창재'].to, by['김거화'].total], [5823000, 10479000, '9', '2', '2026-04', '2026-12', 20946000]);
  const staff = S.peopleOfErp(rows, { prjNo: 'P', now: 5 });
  assert.deepStrictEqual([staff.basis, staff.src, staff.people.map((p) => p.name)], ['rerp', 'erp', ['문창재', '김거화']]);
  const moon = staff.people[0];
  assert.deepStrictEqual([moon.erp.monthly, moon.erp.prjNo, moon.erp.at, moon.erp.req, moon.erp.seq, moon.plan.length, moon.plan[8]], [5823000, 'P', 5, '9', '2', 9, { ym: '2026-12', amt: 1159000 }]);
  const s = S.personStats(moon, 'rerp');
  assert.deepStrictEqual([s.total, s.months, s.from, s.to, s.rate, s.maxRate, s.maxYm, s.limit, s.src], [10479000, 9, '2026-04-01', '2026-12-31', 20, 20.01, '2026-04', 5823000, 'rerp']);
  assert.deepStrictEqual([moon.cuts, s.runs.length, s.runs[0].rate], [[], 1, 20], '자료생성의 마지막 달 잔액 행(1,159)은 같은 구간 — 경계 없음');
  assert.strictEqual(S.monthlyText(moon.plan), '4~11월 1,165 · 12월 1,159');
  const part = S.peopleOfErp(rows, { prjNo: 'P', months: S.ymRange('2026-10', '2026-12') });
  assert.deepStrictEqual(part.people[0].plan.map((x) => x.amt), [1165000, 1165000, 1159000], '달을 주면 그 달들만');
  assert.strictEqual(S.peopleOfErp(rows, { months: S.ymRange('2027-01', '2027-12') }), null, '그 달에 지급이 없으면 null');
  assert.strictEqual(S.peopleOfErp([]), null);
  const o = S.othersOfErp({ STD_AMT: '5823000', REC: [{ PLAN_YM: '202604', ETC_PART_RT: '64.00', ETC_PAY_AMT: '0', SSN: 'secret' }, { PLAN_YM: '' }] });
  assert.deepStrictEqual(o, { std: 5823000, rows: [{ ym: '2026-04', rate: 64, amt: 0 }] });
  assert.deepStrictEqual(S.sharesOfErp(rows, { prjNo: 'P' }).map((x) => [x.name, x.total, x.erp.monthly]), [['문창재', 10479000, 5823000], ['김거화', 20946000, 8480000]]);
});
test('계획서 사람들로 — 첫 달부터 참여개월만큼 균등, 다시 만들면 id·직접 값·rERP 값을 잇는다', () => {
  const s = S.buildStaff(PERSONS, SPAN);
  assert.deepStrictEqual([s.basis, s.src, s.people[0].plan.map((x) => x.amt)], ['plan', 'yaml', [2328000, 2328000, 2328000, 2328000, 2328000, 2328000, 2328000, 2328000, 2322000]]);
  assert.deepStrictEqual([S.personStats(s.people[0], 'plan').rate, S.personStats(s.people[1], 'plan').maxRate], [27.45, 20.01]);
  s.people[1].manual = 6000000;
  s.people[1].plan[8].amt = 1000000;
  const again = S.buildStaff([PERSONS[1], Object.assign({}, PERSONS[0], { pay: 21000000 })], SPAN, s);
  assert.deepStrictEqual([again.people[0].id, again.people[0].manual, again.people[0].plan[8].amt, again.people[1].plan[0].amt], [s.people[1].id, 6000000, 1000000, 2334000]);
  assert.strictEqual(S.buildStaff([], SPAN), null);
});
test('월급여 기준 — 직접 > rERP > 계획서 > (계획서 없으면) rERP, 금액은 그대로', () => {
  const s = S.buildStaff(PERSONS, SPAN);
  const moon = s.people[1];
  assert.deepStrictEqual(S.monthlyPay(moon, 'rerp'), { amt: 5823000, src: 'plan', fallback: true });
  moon.erp = { monthly: 6000000, prjNo: 'P', at: 1, req: '', seq: '', others: [] };
  assert.deepStrictEqual([S.monthlyPay(moon, 'rerp').src, S.monthlyPay(moon, 'plan').src, S.personStats(moon, 'rerp').rate, S.personStats(moon, 'rerp').total], ['rerp', 'plan', 19.41, 10479000]);
  assert.deepStrictEqual(S.monthlyPay(S.normalizePerson({ name: 'x', erp: { monthly: 5000000 } }), 'plan'), { amt: 5000000, src: 'rerp', fallback: false });
  assert.deepStrictEqual([S.setManual(moon, 'plan', '5,900').manual, S.setManual(moon, 'plan', '5,823').manual, S.setManual(Object.assign({}, moon, { manual: 5900000 }), 'plan', '').manual], [5900000, null, null]);
  assert.throws(() => S.setManual(moon, 'plan', 'abc'), /천원 단위의 수/);
});
test('적용월부터 — 앞 달 그대로, 제외, 구간, 더하기, 틀린 값', () => {
  const s = S.buildStaff(PERSONS, SPAN);
  const months = S.spanMonths(SPAN);
  const a = S.applyChange(s.people[1], 'plan', { from: '2026-12', mode: 'rate', value: '10' }, months);
  assert.deepStrictEqual([a.plan[8].amt, S.personStats(a, 'plan').rate, S.personStats(a, 'plan').maxRate, s.people[1].plan[8].amt], [582000, 18.9, 20.01, 1159000]);
  const ex = S.applyChange(s.people[1], 'plan', { from: '2026-12', mode: 'exclude' }, months);
  assert.deepStrictEqual([S.personStats(ex, 'plan').months, S.personStats(ex, 'plan').rate, S.monthlyText(ex.plan)], [8, 20.01, '4~11월 1,165 · 12월 제외']);
  const r = S.applyChange(s.people[0], 'plan', { from: '2026-10', to: '2026-11', mode: 'amt', value: 1000000 }, months);
  assert.strictEqual(S.monthlyText(r.plan), '4~9월 2,328 · 10~11월 1,000 · 12월 2,322');
  const q = S.applyChange(S.normalizePerson({ name: '새사람', manual: 5000000 }), 'plan', { from: '2026-05', mode: 'rate', value: 15 }, months);
  assert.deepStrictEqual([q.plan.length, q.plan[0], S.personStats(q, 'plan').rate], [8, { ym: '2026-05', amt: 750000 }, 15]);
  assert.throws(() => S.applyChange(s.people[1], 'plan', { from: '', mode: 'rate', value: 10 }, months), /적용일을 고르세요/);
  assert.throws(() => S.applyChange(s.people[1], 'plan', { from: '2027-01', mode: 'rate', value: 10 }, months), /기간 밖/);
  assert.throws(() => S.applyChange(s.people[1], 'plan', { from: '2026-12', mode: 'rate', value: 101 }, months), /0~100/);
  assert.throws(() => S.applyChange(S.normalizePerson({ name: 'n' }), 'plan', { from: '2026-12', mode: 'rate', value: 10 }, months), /월급여가 없어/);
  assert.throws(() => S.applyChange(S.normalizePerson({ name: 'n', manual: 1 }), 'plan', { from: '2026-12', mode: 'rate', value: 10 }, []), /기간이 없어/);
  const t = S.setTotal(s.people[1], 9000000);
  assert.deepStrictEqual(t.plan.map((x) => x.amt), Array(9).fill(1000000));
  assert.deepStrictEqual([S.setRate(s.people[1], 'plan', '15', months).plan[0].amt, S.personStats(S.setRate(s.people[1], 'plan', '15', months), 'plan').rate], [873000, 15]);
});
test('나머지의 %(처음 이름 부족금의 %) — applyShare: 예산에서 다른 사람들·이 사람의 기간 밖 지급을 뺀 나머지의 n% 를 적용일~종료일에 나눈다(한 사람 100 · 둘이 50씩 · 둘째를 더한 뒤의 100 = 첫째의 50), 기존 사람은 그 기간의 자기 지급을 비우고 셈, 일부 달은 날 수 비율, 예산 없음·나머지 없음·틀린 % 는 오류; resolveRange', () => {
  const s = S.buildStaff(PERSONS, SPAN), months = S.spanMonths(SPAN);
  const others = S.staffTotal(s, 'plan'), budget = others + 1890000;   // 부족금 1,890천원
  const n1 = S.applyShare(S.normalizePerson({ name: '새사람', manual: 5000000 }), 'plan', { from: '2026-10', to: '2026-12', pct: 100 }, months, { budgetPay: budget, others });
  assert.deepStrictEqual([n1.left, n1.total, n1.pct, n1.person.plan.map((x) => x.amt), S.personStats(n1.person, 'plan').total], [1890000, 1890000, 100, [630000, 630000, 630000], 1890000]);
  const h = S.applyShare(S.normalizePerson({ name: '둘째', manual: 5000000 }), 'plan', { from: '2026-10', to: '2026-12', pct: '50' }, months, { budgetPay: budget, others });
  assert.deepStrictEqual([h.total, h.person.plan.map((x) => x.amt)], [945000, [315000, 315000, 315000]]);
  assert.strictEqual(S.applyShare(S.normalizePerson({ name: '셋째', manual: 5000000 }), 'plan', { from: '2026-10', to: '2026-12', pct: 100 }, months, { budgetPay: budget, others: others + h.total }).total, 945000, '둘째를 더한 뒤 남는 부족금의 100 = 첫째의 50');
  const me = s.people[1], othersMe = S.staffTotal({ people: s.people.filter((p) => p !== me) }, 'plan');
  const r = S.applyShare(me, 'plan', { from: '2026-12', pct: 100 }, months, { budgetPay: budget, others: othersMe });
  assert.deepStrictEqual([r.left, r.person.plan[8].amt, S.staffTotal({ people: s.people.map((p) => (p === me ? r.person : p)) }, 'plan')], [1890000 + 1159000, 1890000 + 1159000, budget], '기존 사람 12월: 자기 12월(1,159천원)을 비운 부족금 전부 → 합은 정확히 예산');
  const part = S.applyShare(S.normalizePerson({ name: 'p', manual: 5000000 }), 'plan', { from: '2026-10-15', to: '2026-12-31', pct: 100 }, months, { budgetPay: budget, others });
  assert.deepStrictEqual([part.person.plan[0].from, part.person.plan.length, part.person.plan.reduce((a, x) => a + x.amt, 0)], [undefined, 3, 1890000], '10월 15일부터 — 달 단위라 10월 전체(조각 없음), 합은 정확히 배분액');
  assert.throws(() => S.applyShare(me, 'plan', { from: '2026-12', pct: 100 }, months, { budgetPay: null, others: 0 }), /예산이 없어/);
  assert.throws(() => S.applyShare(me, 'plan', { from: '2026-12', pct: 100 }, months, { budgetPay: others - 1159000, others: othersMe }), /나머지가 없습니다 — 다른 지급의 합이 예산과 같습니다/);
  assert.throws(() => S.applyShare(me, 'plan', { from: '2026-12', pct: 100 }, months, { budgetPay: others - 2159000, others: othersMe }), /예산을 1,000천원 넘습니다/);
  assert.throws(() => S.applyShare(me, 'plan', { from: '2026-12', pct: 0 }, months, { budgetPay: budget, others: othersMe }), /0 보다 크고 100 이하/);
  assert.throws(() => S.applyShare(me, 'plan', { from: '2026-12', pct: 101 }, months, { budgetPay: budget, others: othersMe }), /0 보다 크고 100 이하/);
  assert.throws(() => S.applyShare(me, 'plan', { from: '', pct: 10 }, months, { budgetPay: budget, others: othersMe }), /적용일을 고르세요/);
  assert.deepStrictEqual(S.resolveRange(me, { from: '2026-10', to: '' }, months), { fromD: '2026-10-01', endD: '2026-12-31', range: ['2026-10', '2026-11', '2026-12'] });
  assert.deepStrictEqual(S.resolveRange(me, { from: '2026-10-15', to: '2026-11-20' }, months), { fromD: '2026-10-01', endD: '2026-11-30', range: ['2026-10', '2026-11'] });
});
test('균등(evenRange) — 적용일~종료일을 달마다 같은 금액(합 ÷ 개월 천원 반올림 — 2026-10-20 "매월 동일 금액 … 균등" · "균등이 안되는데": 마지막 달 잔액 꼴이 아님, 합은 천원 단위로 달라질 수 있음), 달 중간은 날 수 비율, 지급 없음·잠긴 달은 오류', () => {
  const months = S.ymRange('2026-04', '2026-12');
  const a = S.normalizePerson({ name: 'A', manual: 5823000, plan: months.map((ym) => ({ ym, amt: 1165000 })) });
  const a2 = S.applyChange(a, 'plan', { from: '2026-12', mode: 'amt', value: 500000 }, months);
  const r = S.evenRange(a2, 'plan', { from: '2026-11-01', to: '2026-12-31' }, months);
  assert.deepStrictEqual([r.before, r.after, r.per, S.monthlyText(r.person.plan)], [1665000, 1666000, 833000, '4~10월 1,165 · 11~12월 833'], '1,665 ÷ 2 = 832.5 → 833 씩 — 합은 1천원 늘어남');
  assert.strictEqual(S.personStats(r.person, 'plan').total, S.personStats(a2, 'plan').total + 1000);
  // 실측(2026-10-20 2차년도 김거화 17,929천원 · 12달): 앞달 올림 꼴은 1~11월 1,495 · 12월 1,484 가 돼 "균등이 안되는데" — 같은 금액 1,494 씩(합 17,928)
  const y2 = S.ymRange('2027-01', '2027-12');
  const kim = S.normalizePerson({ name: 'K', manual: 8480000, plan: y2.map((ym, i) => ({ ym, amt: i < 11 ? 1494000 : 1495000 })) });
  const kr = S.evenRange(kim, 'plan', { from: '2027-01-01', to: '2027-12-31' }, y2);
  assert.deepStrictEqual([kr.per, kr.after, S.monthlyText(kr.person.plan)], [1494000, 17928000, '1~12월 1,494']);
  const part = S.evenRange(a2, 'plan', { from: '2026-11-16', to: '2026-12-31' }, months);
  assert.deepStrictEqual([part.before, part.after, part.per, S.monthlyText(part.person.plan)], [1665000, 1666000, 833000, '4~10월 1,165 · 11~12월 833'], '11.16~ 도 11월 전체 — rERP 처럼 달 단위(2026-10-20)');
  const gap = S.normalizePerson({ name: 'G', manual: 5000000, plan: S.ymRange('2026-04', '2026-10').map((ym) => ({ ym, amt: 1000000 })) });
  assert.strictEqual(S.monthlyText(S.evenRange(gap, 'plan', { from: '2026-10-01', to: '2026-12-31' }, months).person.plan), '4~9월 1,000 · 10~12월 333', '지급이 없던 달도 그 기간이면 받는다 — 1,000 ÷ 3 → 333 씩(합 999)');
  assert.throws(() => S.evenRange(S.applyChange(a, 'plan', { from: '2026-12', mode: 'exclude' }, months), 'plan', { from: '2026-12-01', to: '2026-12-31' }, months), /지급이 없어/);
  assert.throws(() => S.evenRange(a, 'plan', { from: '2026-05-01', to: '2026-12-31' }, months, { lock: '2026-08' }), /지급이 끝난 달/);
});
test('MAX(maxRate) — 적용일~종료일에 넣을 수 있는 최대 참여율(0.01% 내림): 예산 나머지를 실제 넣어 본 합이 넘지 않는 가장 큰 값과 100% 규칙(100 − 다른 과제 합의 최대) 가운데 작은 것; 예산이 없으면 100% 규칙만; 나머지가 없으면 0; 월급여 없음 · 잠긴 달은 오류', () => {
  const months = S.ymRange('2026-04', '2026-12');
  const a = S.normalizePerson({ name: 'A', manual: 8480000, plan: months.map((ym) => ({ ym, amt: 2328000 })) });
  const others = 10479000, total = S.personStats(a, 'plan').total;
  const budgetPay = others + total - 2 * 2328000 + 3225000;   // 11~12월을 비우면 나머지 3,225천원
  const range = { from: '2026-11-01', to: '2026-12-31' };
  const m = S.maxRate(a, 'plan', range, months, { budgetPay, others });
  assert.deepStrictEqual([m.rate, m.byBudget, m.by100, m.left, m.limit], [19.01, 19.01, 100, 3225000, 8480000], '3,225,000 ÷ (8,480,000 × 2) = 19.015…% → 19.01% (19.02% 는 1,613천원 × 2 로 넘침)');
  const put = S.applyChange(a, 'plan', Object.assign({ mode: 'rate', value: m.rate }, range), months);
  assert.deepStrictEqual(put.plan.filter((x) => x.ym >= '2026-11').map((x) => x.amt), [1612000, 1612000], 'MAX 로 넣으면 round천원(월급여 × 19.01%) 씩 — 합 3,224천원 ≤ 나머지');
  assert.ok(S.personStats(S.applyChange(a, 'plan', Object.assign({ mode: 'rate', value: m.rate + 0.02 }, range), months), 'plan').total + others > budgetPay, '0.02% 더 올리면(1,613천원 × 2) 예산을 넘는다 — 0.01 은 천원 내림으로 같은 금액');
  assert.deepStrictEqual(S.maxRate(a, 'plan', range, months, { budgetPay, others, others100: [{ ym: '2026-12', rate: 85 }, { ym: '2026-11', rate: 50 }] }).rate, 15, '100% 규칙 — 다른 과제 합이 가장 큰 달(12월 85%) 기준 15% 가 예산 기준 19.01% 보다 작으면 그것');
  assert.deepStrictEqual([S.maxRate(a, 'plan', range, months, { others100: [{ ym: '2026-11', rate: 70.5 }] }).rate, S.maxRate(a, 'plan', range, months).byBudget], [29.5, null], '예산이 없으면 100% 규칙만(byBudget null)');
  assert.deepStrictEqual([S.maxRate(a, 'plan', range, months, { budgetPay: others + total - 2 * 2328000, others }).rate, S.maxRate(a, 'plan', range, months, { budgetPay: 0, others }).byBudget], [0, 0], '나머지가 0 이하면 0');
  const half = S.maxRate(a, 'plan', { from: '2026-11-16', to: '2026-12-31' }, months, { budgetPay, others });   // 달 중간 적용일 — 달 단위라 11~12월 전체와 같다
  const inside = (r) => S.personStats(S.applyChange(a, 'plan', { from: '2026-11-16', to: '2026-12-31', mode: 'rate', value: r }, months), 'plan').total;
  assert.ok(half.rate === m.rate && inside(half.rate) + others <= budgetPay && inside(half.rate + 0.02) + others > budgetPay, `달 중간(11/16~)도 11월 전체 — ${half.rate}%`);
  assert.throws(() => S.maxRate(S.normalizePerson({ name: 'B' }), 'plan', range, months, { budgetPay, others }), /월급여가 없어/);
  assert.throws(() => S.maxRate(a, 'plan', range, months, { budgetPay, others, lock: '2026-11' }), /지급이 끝난 달/);
  assert.strictEqual(S.normalizePerson({ name: 'C', allowance: '20000000' }).allowance, 20000000, '잔여 연구수당(응답의 참고 값)은 사람에 그대로');
});
test('나머지 · 예산에 맞추기 — shareLeft(그 기간의 나머지 · 개월), fitBudget: 고른 달의 지급을 초과금만큼 줄이거나 부족금만큼 늘려 합 = 예산(달마다 고르게 — 달 사이 차이는 그대로, 0 아래는 0 에서 멈춤, 달 중간은 날 수 비율), 이미 같음·0 으로도 넘음·예산 없음은 오류', () => {
  const months = S.ymRange('2026-04', '2026-12');
  const a = S.normalizePerson({ name: 'A', manual: 5823000, plan: months.map((ym) => ({ ym, amt: 1165000 })) });
  const b = S.normalizePerson({ name: 'B', manual: 8480000, plan: months.map((ym) => ({ ym, amt: 2328000 })) });
  const others = S.personStats(b, 'plan').total, total = others + S.personStats(a, 'plan').total;
  const sumWith = (p) => others + S.personStats(p, 'plan').total;
  const sl = S.shareLeft(S.normalizePerson({ name: 'n' }), 'plan', { from: '2026-11-16', to: '2026-12-31' }, months, { budgetPay: total + 2000000, others: total });
  assert.deepStrictEqual([sl.left, sl.fromD, sl.endD, sl.range, sl.span], [2000000, '2026-11-01', '2026-12-31', ['2026-11', '2026-12'], 2], '새 사람의 나머지 = 예산 − 모두의 합, 11.16~12.31 은 달 단위라 2개월');
  // 초과금 266천원 → 11~12월에서 133천원씩 줄임
  const over = S.fitBudget(a, 'plan', { from: '2026-11-01', to: '2026-12-31' }, months, { budgetPay: total - 266000, others });
  assert.deepStrictEqual([over.diff, over.before, over.after, S.monthlyText(over.person.plan), sumWith(over.person)], [266000, 2330000, 2064000, '4~10월 1,165 · 11~12월 1,032', total - 266000]);
  // 부족금 — 달 사이 차이(11월 1,165 · 12월 500)는 그대로 두고 고르게 더함
  const a2 = S.applyChange(a, 'plan', { from: '2026-12', mode: 'amt', value: 500000 }, months);
  const short = S.fitBudget(a2, 'plan', { from: '2026-11-01', to: '2026-12-31' }, months, { budgetPay: total + 626000, others });
  assert.deepStrictEqual([short.diff, S.monthlyText(short.person.plan), sumWith(short.person)], [-1291000, '4~10월 1,165 · 11월 1,811 · 12월 1,145', total + 626000], '1,291천원을 645.5천원씩(앞달 올림)');
  assert.ok(short.person.cuts.includes('2026-11-01'), '적용일이 기간 구간의 경계');
  // 줄일 때 0 아래로 가는 달은 0 에서 멈추고 남은 차는 다른 달이
  const clamp = S.fitBudget(a2, 'plan', { from: '2026-11-01', to: '2026-12-31' }, months, { budgetPay: total - 665000 - 1100000, others });
  assert.strictEqual(S.monthlyText(clamp.person.plan), '4~10월 1,165 · 11월 565 · 12월 제외');
  // 달 중간부터 — 달 단위라 11월 전체부터(11~12월에서 150천원씩), 합은 정확히 예산
  const part = S.fitBudget(a, 'plan', { from: '2026-11-15', to: '2026-12-31' }, months, { budgetPay: total - 300000, others });
  assert.deepStrictEqual([S.monthlyText(part.person.plan), sumWith(part.person)], ['4~10월 1,165 · 11~12월 1,015', total - 300000]);
  // 지급이 없던 달도 그 기간이면 늘릴 때 받는다
  const gap = S.normalizePerson({ name: 'G', manual: 5000000, plan: S.ymRange('2026-04', '2026-10').map((ym) => ({ ym, amt: 1000000 })) });
  const filled = S.fitBudget(gap, 'plan', { from: '2026-11-01', to: '2026-12-31' }, months, { budgetPay: others + 7000000 + 2000000, others });
  assert.strictEqual(S.monthlyText(filled.person.plan), '4~12월 1,000');
  assert.throws(() => S.fitBudget(a, 'plan', { from: '2026-11', to: '2026-12' }, months, { budgetPay: total, others }), /이미 예산과 같습니다/);
  assert.throws(() => S.fitBudget(a, 'plan', { from: '2026-11', to: '2026-12' }, months, { budgetPay: 1000000, others }), /11~12월의 지급을 모두 0 으로 해도 초과금 [\d,]+천원이 남습니다/);
  assert.throws(() => S.fitBudget(a, 'plan', { from: '2026-11', to: '2026-12' }, months, { budgetPay: null, others }), /예산이 없어/);
  assert.throws(() => S.fitBudget(a, 'plan', { from: '2026-08', to: '2026-12' }, months, { budgetPay: total + 1000, others, lock: '2026-08' }), /지급이 끝난 달/);
  assert.deepStrictEqual(S.spreadDelta([1000, 0, 3000], [1, 1, 1], -3000), [0, 0, 1000], '줄일 몫을 못 받는 달은 0 에서 멈춤');
});
test('기준 금액에서 증감 — scaleRange: 그 기간의 조각마다 ±n%(round천원 — 달 사이 비율 그대로), 걸치는 조각은 안쪽만, 지급 없던 달은 그대로, 구간 경계; 지급 없음·0%·잠긴 달은 오류', () => {
  const months = S.ymRange('2026-04', '2026-12');
  const a = S.applyChange(S.normalizePerson({ name: 'A', manual: 5823000, plan: S.ymRange('2026-04', '2026-11').map((ym) => ({ ym, amt: 1165000 })) }), 'plan', { from: '2026-11', to: '2026-11', mode: 'amt', value: 2000000 }, months);
  const up = S.scaleRange(a, 'plan', { from: '2026-10-01', to: '2026-12-31' }, months, 20);
  assert.deepStrictEqual([up.pct, up.before, up.after, S.monthlyText(up.person.plan)], [20, 3165000, 3798000, '4~9월 1,165 · 10월 1,398 · 11월 2,400'], '10월 1,165 × 1.2 · 11월 2,000 × 1.2, 12월(지급 없음)은 그대로 없음');
  assert.ok(up.person.cuts.includes('2026-10-01'), '적용일이 구간 경계');
  const dn = S.scaleRange(a, 'plan', { from: '2026-11-16', to: '2026-11-30' }, months, -50);
  assert.deepStrictEqual([dn.before, dn.after, S.monthlyText(dn.person.plan)], [2000000, 1000000, '4~10월 1,165 · 11월 1,000'], '달 중간부터도 11월 전체 — 절반');
  assert.strictEqual(S.monthlyText(S.scaleRange(a, 'plan', { from: '2026-04', to: '2026-12' }, months, -100).person.plan), '4~11월 제외', '−100% 는 0원');
  assert.throws(() => S.scaleRange(a, 'plan', { from: '2026-12', to: '2026-12' }, months, 10), /12월에 지급이 없어 늘리거나 줄일 기준이 없습니다/);
  assert.throws(() => S.scaleRange(a, 'plan', { from: '2026-10', to: '' }, months, 0), /0 아님/);
  assert.throws(() => S.scaleRange(a, 'plan', { from: '2026-10', to: '' }, months, -120), /−100 ~ \+1000/);
  assert.throws(() => S.scaleRange(a, 'plan', { from: '2026-08', to: '' }, months, 10, { lock: '2026-08' }), /지급이 끝난 달/);
});
test('월평균 참여율 — rerpRate(올림; 2026-10-19 의 셋째 자리 내림 floorRate 는 2026-10-20 "참여율은 보수적으로 … 올림" 으로 없앰), personStats.avgRate(지급이 없으면 null), 10% 이하면 알림 low(막지 않음)', () => {
  assert.deepStrictEqual([S.rerpRate(10479000, 5823000 * 9), S.rerpRate(500000, 5000000), S.rerpRate(1, 0), S.MIN_RATE, S.floorRate], [20, 10, null, 10, undefined]);
  const months = S.ymRange('2026-04', '2026-12');
  const mk = (amt) => S.normalizePerson({ name: '가', manual: 5000000, plan: months.map((ym) => ({ ym, amt })) });
  assert.deepStrictEqual([S.personStats(mk(500000), 'plan').avgRate, S.personStats(mk(0), 'plan').avgRate], [10, null]);
  const warns = (amt) => S.checks({ basis: 'plan', people: [mk(amt)] }, 'plan').filter((w) => w.kind === 'low');
  assert.deepStrictEqual(warns(500000).map((w) => [w.level, w.name, w.text]), [['warn', '가', '가 — 월평균 참여율 10.00% — 10% 를 넘어야 합니다.']], '10.00% 는 넘지 않음');
  assert.deepStrictEqual([warns(501000).length, warns(0).length], [0, 0], '10.02% 는 통과 · 제외만 있는 사람은 셈하지 않음');
});
test('이전 기간 비율로 초기화 — 합은 정확히 예산, 모든 달 균등, 직접 값·rERP 값을 잇는다', () => {
  const sources = S.sharesOfErp(S.rowsOfErp(REC), { prjNo: 'P', now: 1 });
  const s = S.initFromShares(sources, { budgetPay: 35900000, span: Y2 });
  assert.deepStrictEqual([s.basis, s.src, s.people.map((p) => p.name)], ['rerp', 'init', ['문창재', '김거화']]);
  const pays = s.people.map((p) => S.personStats(p, 'rerp').total);
  assert.deepStrictEqual([pays, pays[0] + pays[1], s.people[0].plan.length, s.people[0].erp.monthly], [[11971000, 23929000], 35900000, 12, 5823000]);
  assert.deepStrictEqual([S.personStats(s.people[0], 'rerp').rate, S.personStats(s.people[1], 'rerp').rate], [17.14, 23.52]);
  const odd = S.initFromShares([{ name: 'a', total: 1 }, { name: 'b', total: 1 }, { name: 'c', total: 1 }], { budgetPay: 1000000, span: Y2 });
  assert.deepStrictEqual(odd.people.map((p) => p.pay), [334000, 333000, 333000]);
  assert.deepStrictEqual([S.initFromShares(sources, { budgetPay: null, span: Y2 }), S.initFromShares([], { budgetPay: 1, span: Y2 })], [null, null]);
  const prev = S.buildStaff(PERSONS, SPAN); prev.people[0].manual = 8500000;
  assert.strictEqual(S.initFromShares(S.sharesOfStaff(prev), { budgetPay: 1000000, span: Y2 }).people[0].manual, 8500000);
});
test('이전 차년도에서 가져오기(carryOver, 2026-10-20 "연구원, 월급, 참여율 정도 … 기간은 전체") — 성명·역할·월급여와 마지막 구간의 참여율을 기간 전체에 floor천원(월급여 × %), 마지막이 제외면 뺌, 직접 적은 월급여 유지, 월급여를 모르면 마지막 구간 월 평균', () => {
  const prev = S.peopleOfErp(S.rowsOfErp(REC), { prjNo: 'P', now: 1 });   // 문창재 4~11월 1,165 · 12월 1,159 (20.00%) · 김거화 2,328 · 2,322 (27.45%)
  const Y2M = S.spanMonths(Y2), M1 = S.spanMonths(SPAN);
  const c = S.carryOver(prev, Y2M);
  assert.deepStrictEqual([c.basis, c.src, c.skipped, c.people.map((p) => [p.name, p.role, p.erp.monthly, p.plan.length, p.plan[0].ym, p.plan[11].ym])],
    ['rerp', 'init', [], [['문창재', '참여연구원', 5823000, 12, '2027-01', '2027-12'], ['김거화', '과제책임자', 8480000, 12, '2027-01', '2027-12']]]);
  assert.deepStrictEqual(c.people.map((p) => [...new Set(p.plan.map((x) => x.amt))]), [[1164000], [2327000]], '달마다 floor천원(월급여 × 20.00% · 27.45%) — 1차년도 마지막 달 잔액(1,159 · 2,322)은 잇지 않음');
  assert.deepStrictEqual(c.people.map((p) => S.personStats(p, 'rerp').total), [13968000, 27924000]);
  assert.ok(c.people.every((p, i) => p.id !== prev.people[i].id && !p.cuts.length), '새 사람(id) · 구간 경계 없음');
  const kim = S.applyChange(prev.people[1], 'rerp', { from: '2026-12-01', mode: 'rate', value: 20 }, M1);   // 4~11월 27.46% · 12월 20.00% — 마지막 구간
  const moon = S.applyChange(prev.people[0], 'rerp', { from: '2026-12-01', mode: 'exclude' }, M1);   // 12월부터 제외 — 빠진 사람
  const lee = S.normalizePerson({ name: '이수연', role: '참여연구원', manual: 4000000, plan: M1.map((ym) => ({ ym, amt: 1200000 })) });   // 직접 적은 월급여 4,000 · 30%
  const noPay = S.normalizePerson({ name: '박무급', plan: [{ ym: '2026-10', amt: 1000000 }, { ym: '2026-11', amt: 1500000 }, { ym: '2026-12', amt: 1499000 }] });   // 월급여를 모름 — 마지막 구간(11~12월, 12월은 잔액) 월 평균 1,499.5 → 1,500
  const c2 = S.carryOver({ basis: 'rerp', people: [moon, kim, lee, noPay] }, Y2M);
  assert.deepStrictEqual([c2.skipped, c2.people.map((p) => [p.name, p.plan[0].amt, p.plan[11].amt, p.manual])], [['문창재'], [['김거화', 1696000, 1696000, null], ['이수연', 1200000, 1200000, 4000000], ['박무급', 1500000, 1500000, null]]]);
  assert.deepStrictEqual([S.carryOver(null, Y2M), S.carryOver(prev, []), S.carryOver({ basis: 'rerp', people: [moon] }, Y2M)], [null, null, null], '재료·기간이 없거나 모두 빠지면 null');
});
test('100% 알림 — 같은 달에 rERP 값이 있으면 그것만, 정확히 100 은 아니고, 예산 초과·남음·월급여 없음', () => {
  const s = S.buildStaff(PERSONS, SPAN);
  s.people[1].erp = { monthly: 5823000, prjNo: 'P', at: 1, req: '9', seq: '2', others: [{ ym: '2026-04', rate: 64, amt: 0 }, { ym: '2026-05', rate: 85, amt: 0 }, { ym: '2026-06', rate: 0, amt: 0 }] };
  const others = S.mergeOthers({ 문창재: [{ ym: '2026-04', rate: 30, label: 'x' }, { ym: '2026-06', rate: 90, label: 'x' }], 김거화: [{ ym: '2026-04', rate: 72.55, label: '차단기 과제' }] }, s);
  assert.deepStrictEqual(others['문창재'].map((o) => [o.ym, o.rate]), [['2026-04', 64], ['2026-05', 85]]);
  const w = S.checks(s, 'plan', { others });
  assert.deepStrictEqual(w.map((x) => [x.kind, x.name]), [['over', '김거화'], ['over', '문창재']]);
  assert.strictEqual(w[0].text, '김거화 — 4월 참여율 합 100.01% (이 과제 27.46% · 차단기 과제 72.55%)');
  assert.strictEqual(w[1].text, '문창재 — 5월 참여율 합 105.01% (이 과제 20.01% · rERP 다른 과제 85.00%)');
  assert.strictEqual(S.checks(s, 'plan', { others: { 김거화: [{ ym: '2026-04', rate: 72.54, label: 'x' }] } }).length, 0);
  assert.deepStrictEqual(S.overBudget(s, 'plan', 31425000), { total: 31425000, budget: 31425000, over: false, left: 0 });
  assert.deepStrictEqual(S.checks(s, 'plan', { budgetPay: 31000000 }).map((x) => x.kind), ['budget']);
  assert.ok(/부족금 575천원/.test(S.checks(s, 'plan', { budgetPay: 32000000 })[0].text));
  assert.ok(/초과금 425천원/.test(S.checks(s, 'plan', { budgetPay: 31000000 })[0].text) && /예산과 같습니다/.test(S.checks(s, 'plan', { budgetPay: 31425000 })[0].text));
  assert.deepStrictEqual([S.budgetDiff({ total: 30799000, budget: 31425000 }), S.budgetDiff({ total: 31691000, budget: 31425000 }), S.budgetDiff({ total: 1, budget: null }).kind, S.budgetDiff(null).text], [{ diff: -626000, kind: 'short', text: '부족금 626천원' }, { diff: 266000, kind: 'over', text: '초과금 266천원' }, '', '']);
  assert.deepStrictEqual(S.checks(S.normalizeStaff({ people: [{ name: '새사람', plan: [{ ym: '2026-04', amt: 1000 }] }] }), 'plan', {}).map((x) => x.kind), ['salary']);
});
test('글·표·저장 모양', () => {
  const s = S.buildStaff(PERSONS, SPAN);
  const lines = S.staffLines(s, 'plan', { budgetPay: 31425000 });
  assert.strictEqual(lines[0], '■ 참여연구자 (2명) — 월급여 기준: 계획서 연봉 · 인건비 합 31,425천원 (예산 31,425천원)');
  assert.strictEqual(lines[2], '- 문창재 — 책임 · 월급여 5,823천원(계획서) · 4~12월 (9개월) · 계상인건비 10,479천원 · 참여율 20.00% (월 최대 20.01%) · 월별 4~11월 1,165 · 12월 1,159');
  assert.strictEqual(S.staffTsv(s, 'plan').split('\n')[1], ['김거화', '수석', '8,480', '4~12월', '9', '20,946', '27.45%', '27.46%', '4~11월 2,328 · 12월 2,322'].join('\t'));
  assert.deepStrictEqual([S.rateText(20), S.rateText(null), S.statsText(S.personStats(s.people[1], 'plan')), S.statsText(null)], ['20.00%', '', '20.00% · 10,479천원 · 4~12월', '(없음)']);
  const plans = S.normalizePlans({ P1: { prjNo: 'P1', prjNm: 'x', from: '2027-01', to: '2027-12', budgetPay: '35,900,000', people: [{ name: '홍길동', plan: [{ ym: '2027-01', amt: 1 }] }], note: 'n' }, bad: null, P2: { from: 'x', people: [] } });
  assert.deepStrictEqual(Object.keys(plans), ['P1', 'P2']);
  assert.deepStrictEqual([plans.P1.budgetPay, plans.P1.people.length, plans.P1.basis, plans.P2.from, plans.P2.people], [35900000, 1, 'rerp', '', []]);
  const raw = S.normalizeStaff({ basis: 'rerp', src: 'init', people: [{ id: 'a', name: ' 홍 길동 ', rate: 120, months: 0, manual: 0, erp: { monthly: '5,000,000', others: [{ ym: '2026-04', rate: '55' }, { ym: 'bad' }] }, plan: [{ ym: '2026-05', amt: 2 }, { ym: '2026-04', amt: 1 }, { ym: 'x', amt: 1 }] }, { name: '' }, { name: '홍길동' }] });
  assert.deepStrictEqual([raw.people.length, raw.people[0].rate, raw.people[0].months, raw.people[0].manual, raw.people[0].erp.others, raw.people[0].plan.map((x) => x.ym)], [1, null, null, null, [{ ym: '2026-04', rate: 55, amt: 0 }], ['2026-04', '2026-05']]);
  assert.strictEqual(S.normalizeStaff({ people: [] }), null);
});

test('날짜까지 — 적용일·종료일은 달 단위(2026-10-20 "rERP 처럼 온달로": 달 중간 날짜는 그 달 전체, 조각은 옛 저장분만 읽음), 기간 구간(runs)은 경계·제외·끊김에서 갈리고 같은 금액의 온달 경계는 지워진다', () => {
  assert.deepStrictEqual([S.dim('2026-02'), S.dim('2028-02'), S.isYmd('2026-02-29'), S.isYmd('2028-02-29'), S.monthEnd('2026-04'), S.addDays('2026-12-31', 1), S.dayCount('2026-04-15', '2026-04-30')], [28, 29, false, true, '2026-04-30', '2027-01-01', 16]);
  assert.deepStrictEqual([S.dateOf('2026-10-15'), S.dateOf('20261015'), S.dateOf('2026-10'), S.dateOf('2026-10', 'end'), S.dateOf('x'), S.dateOf('2026-02-30')], ['2026-10-15', '2026-10-15', '2026-10-01', '2026-10-31', '', '']);
  assert.deepStrictEqual([S.spanText('2026-04-01', '2026-12-31'), S.spanText('2026-12-01', '2026-12-31'), S.spanText('2026-04-15', '2026-12-31'), S.spanText('2026-12-15', '2026-12-31'), S.spanText('2026-04-15', '2027-03-31'), S.spanText('2026-04', '2026-12'), S.monthsText(8.5333), S.monthsText(9)], ['4~12월', '12월', '4.15~12.31', '12.15~12.31', "'26.4.15~'27.3.31", '4~12월', '8.53', '9']);
  const months = S.spanMonths(SPAN);
  const kim = S.peopleOfErp(S.rowsOfErp(REC), { prjNo: 'P', now: 1 }).people[1];
  // 12월부터 20% — 구간 둘 (사용자 화면: 4~11월 27.46% · 12월 20.00%), 연간 26.63% · 20,320천원 (2026-10-19 스크린샷과 같음)
  const dec = S.applyChange(kim, 'rerp', { from: '2026-12', mode: 'rate', value: 20 }, months);
  const sd = S.personStats(dec, 'rerp');
  assert.deepStrictEqual([dec.cuts, sd.total, sd.rate, sd.runs.map((r) => [S.spanText(r.from, r.to), r.amt, r.rate, r.months, r.off])], [['2026-12-01'], 20320000, 26.63, [['4~11월', 18624000, 27.46, 8, false], ['12월', 1696000, 20, 1, false]]]);
  assert.strictEqual(S.statsText(sd), '26.63% · 20,320천원 · 4~12월 (4~11월 27.46% · 12월 20.00%)');
  // 12월 15일부터 20% — 달 단위라 12월 전체(dec 와 같음), 경계도 12월 1일
  const mid = S.applyChange(kim, 'rerp', { from: '2026-12-15', mode: 'rate', value: 20 }, months);
  assert.deepStrictEqual([mid.plan, mid.cuts], [dec.plan, dec.cuts], '달 중간 날짜를 적어도 그 달 전체 — 조각 없음');
  const sm = S.personStats(mid, 'rerp');
  assert.deepStrictEqual([sm.total, sm.runs.map((r) => [S.spanText(r.from, r.to), r.amt, r.rate, S.monthsText(r.months)]), S.monthlyText(mid.plan)], [20320000, [['4~11월', 18624000, 27.46, '8'], ['12월', 1696000, 20, '1']], '4~11월 2,328 · 12월 1,696']);
  assert.deepStrictEqual([S.monthSums(mid.plan).slice(-1), S.sameMonthly(kim.plan, dec.plan), S.sameMonthly(kim.plan, S.applyChange(kim, 'rerp', { from: '2026-12', mode: 'amt', value: 2322000 }, months).plan)], [[['2026-12', 1696000]], false, true], '달 합으로 견준다');
  // 가운데를 날짜로 제외 — 7월 10일~8월 20일을 적어도 7~8월 전체, 구간 넷
  const gap = S.applyChange(mid, 'rerp', { from: '2026-07-10', to: '2026-08-20', mode: 'exclude' }, months);
  assert.deepStrictEqual([gap.cuts, S.personStats(gap, 'rerp').runs.map((r) => `${S.spanText(r.from, r.to)} ${r.off ? '제외' : r.amt}`)], [['2026-07-01', '2026-09-01', '2026-12-01'], ['4~6월 6984000', '7~8월 제외', '9~11월 6984000', '12월 1696000']]);
  // 새 사람을 4월 15일부터 20% — 4월 전체(1,164 = 20% 천원 내림 → rERP 19.99%), 9개월
  const nu = S.applyChange(S.normalizePerson({ name: '새', manual: 5823000 }), 'rerp', { from: '2026-04-15', mode: 'rate', value: 20 }, months);
  const sn = S.personStats(nu, 'rerp');
  assert.deepStrictEqual([nu.plan[0], nu.plan.length, sn.total, sn.rate, S.monthsText(sn.months), nu.cuts, sn.runs.length, S.spanText(sn.from, sn.to)], [{ ym: '2026-04', amt: 1164000 }, 9, 10476000, 19.99, '9', [], 1, '4~12월']);
  assert.deepStrictEqual([S.splitByFrac(9941000, nu.plan.map(S.segFrac)), S.splitByFrac(9941000, [16 / 30].concat(Array(8).fill(1)))], [S.splitEven(9941000, 9), [621000, 1165000, 1165000, 1165000, 1165000, 1165000, 1165000, 1165000, 1165000]], '옛 저장분의 일부 달 조각은 날 수 비율로 나눈다');
  assert.deepStrictEqual([S.splitByFrac(10479000, Array(9).fill(1)), S.splitByFrac(1000, [1, 1, 1]), S.splitByFrac(5000, [0.5])], [S.splitEven(10479000, 9), [0, 0, 1000], [5000]]);
  // 구간만 바꾸기 — 그 구간의 조각에만, 12월을 27.46% 로 되돌리면 2,328 = 11월과 같은 금액이라 경계가 지워져 구간 하나
  const t = S.setTotal(dec, 18000000, months, { from: '2026-04-01', to: '2026-11-30' });
  assert.deepStrictEqual([S.personStats(t, 'rerp').runs.map((r) => r.amt), t.plan[8].amt], [[18000000, 1696000], 1696000]);
  const back = S.setRate(dec, 'rerp', 27.46, months, { from: '2026-12-01', to: '2026-12-31' });   // 27.46% → 2,328(천원 내림) = 11월과 같은 금액; 27.45% 는 2,327 이라 구간이 갈린다
  assert.deepStrictEqual([back.cuts, S.personStats(back, 'rerp').runs.length, S.monthlyText(back.plan)], [[], 1, '4~12월 2,328']);
  assert.deepStrictEqual(S.setRate(mid, 'rerp', 20, months).cuts, [], '통째로 바꾸면 경계도 사라진다');
  // rERP 행의 경계 — 지급기간이 정말 바뀐 행(4~9월 2,328 · 10~12월 1,696)은 구간 둘, 모양·경계 다듬기
  const two = S.peopleOfErp(S.rowsOfErp([
    { EMP_NM: '김거화', ROLE_NM: '과제책임자', PAY_LIMT_AMT: '8480000', PAY_AMT: '2328000', PLAN_YM_FROM: '202604', PLAN_YM_TO: '202609', NCNT: '6', REQ_CNT: '9', SEQ_NO: '1' },
    { EMP_NM: '김거화', ROLE_NM: '과제책임자', PAY_LIMT_AMT: '8480000', PAY_AMT: '1696000', PLAN_YM_FROM: '202610', PLAN_YM_TO: '202612', NCNT: '3', REQ_CNT: '9', SEQ_NO: '1' }]), { prjNo: 'P' }).people[0];
  assert.deepStrictEqual([two.cuts, S.personStats(two, 'rerp').runs.map((r) => [S.spanText(r.from, r.to), r.rate])], [['2026-10-01'], [['4~9월', 27.46], ['10~12월', 20]]]);
  // 경계 없는 옛 저장분(0.8.7 — 12월만 바꾼 뒤 저장된 4~11월 2,328 · 12월 1,696)도 온달 금액이 바뀌는 곳에서 두 구간, 균등 분할의 마지막 달 잔액(1,165×8 + 1,159 · 2,328×8 + 2,322)은 한 구간
  const legacy = S.normalizePerson({ name: '김거화', manual: 8480000, plan: months.map((ym) => ({ ym, amt: ym === '2026-12' ? 1696000 : 2328000 })) });
  assert.deepStrictEqual([legacy.cuts, S.personStats(legacy, 'rerp').runs.map((r) => [S.spanText(r.from, r.to), r.amt])], [[], [['4~11월', 18624000], ['12월', 1696000]]]);
  assert.deepStrictEqual(S.personStats(S.setTotal(legacy, 10479000, months), 'rerp').runs.map((r) => r.amt), [10479000], '균등 분할의 잔액 달은 같은 구간');
  assert.deepStrictEqual(S.personStats(S.normalizePerson({ name: 'x', manual: 8480000, plan: months.map((ym, i) => ({ ym, amt: i < 2 ? 2328000 : 2322000 })) }), 'rerp').runs.map((r) => r.amt), [4656000, 16254000], '마지막 달 하나가 아니면 잔액이 아니다');
  const np = S.normalizePlan([{ ym: '2026-12', amt: 1, from: '2026-12-01', to: '2026-12-31' }, { ym: '2026-12', amt: 2, from: '2026-12-15' }, { ym: '2026-11', amt: 3, to: '2026-11-10' }, { ym: '2026-11', amt: 4, from: '2026-11-05', to: '2026-11-20' }, { ym: '2026-11', amt: 5, from: '2026-11-20', to: '2026-11-15' }, { ym: '2026-10', amt: 6, from: '2026-11-01' }]);
  assert.deepStrictEqual(np, [{ ym: '2026-10', amt: 6 }, { ym: '2026-11', amt: 3, to: '2026-11-10' }, { ym: '2026-12', amt: 1 }], '달 전체 from·to 는 지우고, 겹치는 조각은 앞 것만, 거꾸로·다른 달의 날짜는 버린다');
  assert.deepStrictEqual([S.normalizeCuts(['2026-12-15', 'x', '2026-12-01', '2026-12-15']), S.pruneCuts([{ ym: '2026-11', amt: 1 }, { ym: '2026-12', amt: 1 }], ['2026-12-01', '2026-11-01', '2027-01-01']), S.pruneCuts([{ ym: '2026-11', amt: 1 }, { ym: '2026-12', amt: 2 }], ['2026-12-01'])], [['2026-12-01', '2026-12-15'], [], ['2026-12-01']]);
  assert.strictEqual(S.normalizeStaff({ people: [S.normalizePerson({ name: 'o', plan: [{ ym: '2026-12', amt: 1, to: '2026-12-14' }, { ym: '2026-12', amt: 2, from: '2026-12-15' }] })] }).people[0].plan.length, 2, '옛 저장분의 조각은 저장 모양을 거쳐도 남는다(읽기만)');
  const tsv = S.staffTsv({ basis: 'rerp', src: 'erp', people: [dec] }, 'rerp').split('\n');
  assert.deepStrictEqual([tsv.length, tsv[1].split('\t').slice(3, 8), tsv[2].split('\t').slice(3, 8)], [3, ['4~11월', '8', '18,624', '27.46%', '27.46%'], ['12월', '1', '1,696', '20.00%', '']], '구간마다 한 줄');
  assert.ok(/구간 4~11월 18,624천원 27.46% · 12월 1,696천원 20.00%/.test(S.staffLines({ basis: 'rerp', src: 'erp', people: [dec] }, 'rerp')[1]));
});

test('연차 — 계획 키 과제번호@연차, 현재 연차 번호, 연차의 달 범위(현재 그대로 · 다음은 종료 다음 달부터 12달 · 앞은 시작 전 달까지 12달), 과제의 연차별 계획', () => {
  const P = { prjNo: 'P', anl: '2', stDt: '20270101', endDt: '20271231' };
  assert.deepStrictEqual([S.planKey('P', 1), S.planKey('P', '3'), S.planKey('P', null), S.planKey('P', 0), S.planKey('P', 999)], ['P@1', 'P@3', 'P', 'P', 'P']);
  assert.deepStrictEqual([S.yearLabel(2), S.anlOf(P), S.anlOf({ anl: '' }), S.anlOf(null), S.anlOf({ anl: '0' })], ['2차년도', 2, 1, 1, 1]);
  assert.deepStrictEqual([S.yearSpan(P, 2), S.yearSpan(P, 3), S.yearSpan(P, 4), S.yearSpan(P, 1), S.yearSpan(P, undefined)], [{ from: '2027-01', to: '2027-12' }, { from: '2028-01', to: '2028-12' }, { from: '2029-01', to: '2029-12' }, { from: '2026-01', to: '2026-12' }, { from: '2027-01', to: '2027-12' }]);
  assert.deepStrictEqual(S.yearSpan({ prjNo: 'Q', anl: '1', stDt: '20260401', endDt: '20261231' }, 2), { from: '2027-01', to: '2027-12' }, '첫 연차가 9달이어도 다음 연차는 종료 다음 달부터 12달');
  assert.deepStrictEqual([S.yearSpan({ anl: '1' }, 2), S.yearSpan({ anl: '1', stDt: '20261231', endDt: '20260101' }, 1)], [{ from: '', to: '' }, { from: '', to: '' }]);
  const plans = { 'P@1': { prjNo: 'P', year: 1 }, 'P@2': { prjNo: 'P', year: 2 }, P: { prjNo: 'P' }, 'Q@1': { prjNo: 'Q', year: 1 } };
  assert.deepStrictEqual(Object.keys(S.plansOfProject(plans, 'P')), ['1', '2']);
  assert.deepStrictEqual(S.plansOfProject(null, 'P'), {});
  const norm = S.normalizePlans({ 'P@2': { prjNm: 'x', people: [{ name: '홍길동', plan: [{ ym: '2027-01', amt: 1 }] }] }, 'P@1': { prjNo: 'P', year: '1' }, P: { prjNo: 'P' }, 'R@9': { prjNo: 'R', year: 3 } });
  assert.deepStrictEqual(Object.keys(norm).sort(), ['P', 'P@1', 'P@2', 'R@3'], '과제번호·연차가 빠지면 키에서, 있으면 값이 앞선다');
  assert.deepStrictEqual([norm['P@2'].prjNo, norm['P@2'].year, norm['P@2'].people.length, norm['P@1'].year, norm.P.year], ['P', 2, 1, 1, null]);
});

test('역할 짧은 이름(roleShort) — 과제책임자 → 책임 · 참여연구원 → 참여 · 행정지원 → 행정, 책임·행정이 든 다른 역할명도 그것, 그 밖은 그대로, 빈 값은 빈 글', () => {
  assert.deepStrictEqual(['과제책임자', '참여연구원', '행정지원', ' 참여연구원 ', '실무책임자', '행정 담당', '연구보조원', '', null].map(S.roleShort), ['책임', '참여', '행정', '참여', '책임', '행정', '연구보조원', '', '']);
});

test('지급 완료(2026-10-19 "지급된 월은 수정 못하게") — paidThroughOf: 자금현황 인건비 승인액을 등록 지급계획의 달 합으로 메움 · normalizePaid·lockOf·paidText · 저장 모양에는 있을 때만 · 잠금: applyChange 거부, setTotal/setRate 는 그 뒤 달만, applyShare 거부 · 알림(안내·rERP 등록과 다름)', () => {
  const rows = S.rowsOfErp(REC);
  const months = S.ymRange('2026-04', '2026-12');
  const paid = S.paidThroughOf(rows, 17465000, { prjNo: 'P', months, now: 7 });
  assert.deepStrictEqual(paid, { from: '2026-04', through: '2026-08', amt: 17465000, appr: 17465000, left: 0, at: 7, src: 'erp' }, '17,465,000 = (1,165 + 2,328)천원 × 5 → 4~8월 (2026-10-19 실측)');
  assert.deepStrictEqual([S.paidThroughOf(rows, 0, { prjNo: 'P', months }), S.paidThroughOf([], 1, { prjNo: 'P', months }), S.paidThroughOf(rows, 3000000, { prjNo: 'P', months })], [null, null, null], '승인액이 없거나 한 달도 못 메우면 없음');
  const part = S.paidThroughOf(rows, 18000000, { prjNo: 'P', months, now: 8 });
  assert.deepStrictEqual([part.through, part.amt, part.left], ['2026-08', 17465000, 535000], '달 경계와 안 맞는 몫은 left');
  assert.strictEqual(S.paidThroughOf(rows, 31425000, { prjNo: 'P', months }).through, '2026-12', '전부');
  assert.strictEqual(S.paidThroughOf(rows, 17465000, { prjNo: 'P', months: S.ymRange('2027-01', '2027-12') }), null, '그 달들에 등록이 없으면 없음');
  assert.deepStrictEqual([S.lockOf(paid), S.lockOf(null), S.lockOf({ through: 'x' })], ['2026-08', '', '']);
  assert.deepStrictEqual([S.normalizePaid({ through: '2026-08' }), S.normalizePaid({ through: '2026-13' }), S.normalizePaid('x')], [{ from: '2026-08', through: '2026-08', amt: 0, appr: 0, left: 0, at: 0, src: 'erp' }, null, null]);
  assert.ok(S.paidText(paid).startsWith('4~8월 지급 완료 · rERP 인건비 승인액 17,465천원') && S.paidText(part).includes('(등록 합 17,465천원 + 535천원)') && S.paidText(null) === '');
  const e = S.normalizePlanEntry({ prjNo: 'P', year: 1, people: [], paid });
  assert.deepStrictEqual(e.paid, paid, '저장 모양에 실린다');
  assert.ok(!('paid' in S.normalizePlanEntry({ prjNo: 'P', year: 1, people: [] })) && !('paid' in S.normalizePlanEntry({ prjNo: 'P', year: 1, paid: { through: '' } })), '없으면 칸 자체가 없다(옛 모양과 같게)');
  // 잠금 — 8월까지
  const staff = S.peopleOfErp(rows, { prjNo: 'P', now: 1, months });
  const kim = staff.people.find((p) => p.name === '김거화');   // 4~11월 2,328 · 12월 2,322
  const lock = '2026-08';
  const amts = (p) => S.monthSums(p.plan).map(([, a]) => a);
  assert.throws(() => S.applyChange(kim, 'rerp', { from: '2026-08-15', mode: 'rate', value: 20 }, months, { lock }), /8월까지는 rERP 에서 지급이 끝난 달이라 바꿀 수 없습니다 — 적용일을 2026-09-01 이후로/);
  assert.throws(() => S.applyChange(kim, 'rerp', { from: '2026-04', to: '2026-06', mode: 'exclude' }, months, { lock }), /바꿀 수 없습니다/);
  assert.deepStrictEqual(amts(S.applyChange(kim, 'rerp', { from: '2026-09-01', mode: 'rate', value: 20 }, months, { lock })), [2328000, 2328000, 2328000, 2328000, 2328000, 1696000, 1696000, 1696000, 1696000], '9월부터는 된다');
  assert.deepStrictEqual(amts(S.applyChange(kim, 'rerp', { from: '2026-09-01', mode: 'rate', value: 20 }, months)), [2328000, 2328000, 2328000, 2328000, 2328000, 1696000, 1696000, 1696000, 1696000], '잠금이 없으면 전과 같다');
  assert.deepStrictEqual(amts(S.setTotal(kim, 2328000 * 5 + 4000000, months, null, { lock })), [2328000, 2328000, 2328000, 2328000, 2328000, 1000000, 1000000, 1000000, 1000000], '총액 — 지급이 끝난 달은 그대로, 나머지를 그 뒤 달에');
  assert.throws(() => S.setTotal(kim, 2328000 * 5 - 1000, months, null, { lock }), /지급이 끝난 4~8월의 합 11,640천원보다 적게 잡을 수 없습니다/);
  assert.deepStrictEqual(amts(S.setTotal(kim, 11640000 + 3 * 2000000, months, { from: '2026-04-01', to: '2026-11-30' }, { lock })), [2328000, 2328000, 2328000, 2328000, 2328000, 2000000, 2000000, 2000000, 2322000], '구간만 — 9~11월에 나눔, 12월 그대로');
  assert.throws(() => S.setTotal(kim, 1, months, { from: '2026-04-01', to: '2026-06-30' }, { lock }), /바꿀 수 있는 달이 없습니다/);
  assert.deepStrictEqual(amts(S.setRate(kim, 'rerp', 10, months, null, { lock })), [2328000, 2328000, 2328000, 2328000, 2328000, 848000, 848000, 848000, 848000], '참여율 통째로 — 그 다음 달부터');
  assert.throws(() => S.setRate(kim, 'rerp', 10, months, { from: '2026-04-01', to: '2026-08-31' }, { lock }), /바꿀 수 있는 달이 없습니다/);
  assert.throws(() => S.applyShare(kim, 'rerp', { from: '2026-07-01', pct: 100 }, months, { budgetPay: 31425000, others: 0, lock }), /바꿀 수 없습니다/);
  // 알림
  const warns = S.checks(staff, 'rerp', { paid, erp: staff });
  assert.deepStrictEqual(warns.filter((w) => w.kind === 'paid').map((w) => w.text), ['4~8월 지급 완료 · rERP 인건비 승인액 17,465천원 — 8월까지의 계획은 바꿀 수 없습니다.']);
  assert.ok(!warns.some((w) => w.kind === 'paidDiff') && !S.checks(staff, 'rerp', { erp: staff }).some((w) => w.kind === 'paid'));
  const changed = { basis: 'rerp', people: staff.people.map((p) => (p.name === '김거화' ? Object.assign({}, p, { plan: p.plan.map((x) => (x.ym === '2026-05' ? { ym: x.ym, amt: 2000000 } : x)) }) : p)) };
  assert.deepStrictEqual(S.checks(changed, 'rerp', { paid, erp: staff }).filter((w) => w.kind === 'paidDiff').map((w) => w.text), ['김거화 — 지급이 끝난 5월 계획 2,000천원이 rERP 등록 2,328천원과 다릅니다 — rERP 현재로 로 맞추세요.']);
  assert.deepStrictEqual(S.paidMismatch(changed, staff, '2026-04'), [], '잠긴 달 앞의 차이만');
});

// [workspace] 원본 검사에 없는 것 — 행정지원(2026-10-19, 연차 파일 project.support·supportAt, 양쪽이 고침). src/rnd.js 가 같은 한도를 쓴다
test('normalizeSupport — 이름 없는 줄 버림 · 같은 이름(공백 무시) 한 번 · 열 명 · 참조 기본 참 · supportText 한 줄', () => {
  assert.strictEqual(S.SUPPORT_MAX, 10, 'src/rnd.js SUPPORT_MAX 와 같음');
  assert.deepStrictEqual(S.normalizeSupport([{ name: ' 조주희 ', role: '행정 담당' }, { name: '', role: 'x' }, { name: '조 주희', ref: false }, { name: '이몽룡', role: '', ref: false }]),
    [{ name: '조주희', role: '행정 담당', ref: true }, { name: '이몽룡', role: '', ref: false }]);
  assert.strictEqual(S.normalizeSupport(Array.from({ length: 12 }, (_, i) => ({ name: `n${i}` }))).length, S.SUPPORT_MAX);
  assert.deepStrictEqual([S.normalizeSupport(null), S.normalizeSupport('x')], [[], []]);
  assert.strictEqual(S.supportText([{ name: '조주희', role: '행정 담당', ref: true }, { name: '이몽룡', ref: false }]), '조주희(행정 담당·참조), 이몽룡');
  assert.strictEqual(S.supportText([]), '');
});

console.log(`\n${n} passed${failed ? `, ${failed} failed` : ''}`);
