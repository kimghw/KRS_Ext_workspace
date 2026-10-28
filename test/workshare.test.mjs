// 업무 비율(src/workshare.js) — 일일 업무의 업무별 실제 비율과 rERP 의 내 과제 참여율(2026-10-27 사용자 지정:
// "연구개발 참여율을 월간으로 계산했을 때 해야 되는 업무 시간을 업무별 업무량이랑 같이 보이게 해줘 시간 비율로" · "이건 목표가 0인데 준적이 없음" ·
// 2026-10-28 "참여율이 과제 참여율을 년평균으로 한거지? 4월 과제라도 12개월로 나눠야 하잖아" — 남은 몫을 참여율 비중으로 나누던 셈은 철회).
// 장부의 꼴은 R&D 탭 rndBook(rerp/staff.js 사람 모양)이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShare, likeness, myRates, workShare, LIKE_MIN } from '../src/workshare.js';

const ME = '홍길동';
/** 참여인력 한 사람 — 월급여 1000 에 달마다 지급(amt)이면 참여율은 amt / 10 %. others 는 rERP 의 다른 과제 참여율(달마다 여러 줄일 수 있다). */
const person = (name, plan, others = []) => ({ name, erp: { monthly: 1000, others }, plan: plan.map(([ym, amt]) => ({ ym, amt })) });
const BOOK = {
  projects: [
    { id: 'a', name: '반도체 차단기 개발', alias: 'SSCB', years: { 1: { erp: { staff: { people: [
      person('홍 길동', [['2026-04', 300]], [{ ym: '2026-04', rate: 20 }]),
      person('남궁 민', [['2026-04', 900]]),
    ] } } } } },
    { id: 'b', name: '고압 드라이브 시제품 개발', alias: '', years: { 1: { erp: { staff: { people: [
      person(ME, [['2026-03', 200], ['2026-04', 200]], [{ ym: '2026-03', rate: 20 }, { ym: '2026-04', rate: 10 }, { ym: '2026-04', rate: 20 }]),
    ] } } } } },
    { id: 'c', name: '항만 자율운항 연계기술', alias: '항만', years: {} },
  ],
};
const row = (date, title, category, minutes) => ({ date, title, category, minutes });
const ROWS = [
  row('2026-04-04', '연구기획>연구기획 기타', '연구기획 기타', 200),
  row('2026-04-03', 'AIP 심사 지원', '기술지원', 100),
  row('2026-04-02', '고압 드라이브 시제품 개발', '국가 R&D 과제', 200),
  row('2026-04-01', '반도체 차단기개발 (1차년도)', '국가 R&D 과제', 500),
  row('2026-03-09', '부서소통회', '사내 행사', 200),
  row('2026-03-07', '항만 자율운항 연계기술', '사내 업무', 80),
  row('2026-03-06', '자율운항 기술개발', '국가 R&D 과제', 120),
  row('2026-03-05', '고압 드라이브 시제품 개발', '국가 R&D 과제', 600),
];
const brief = (s) => s.lines.map((L) => [L.label, L.kind, Math.round(L.actual), L.target == null ? null : Math.round(L.target)]);

test('더한 업무 — 이름이 있고 겹치지 않는 것만(대소문자·띄어쓰기 무시), 목표는 0~100 소수 한 자리, 열 개까지', () => {
  assert.deepEqual(normalizeShare({ items: [{ name: ' AIP ', rate: '5.55' }, { name: 'aip', rate: 9 }, { name: '', rate: 3 }, { name: '교육', rate: 120 }, { name: '지원', rate: -5 }, { name: '검토', rate: 'x' }] }),
    { items: [{ name: 'AIP', rate: 5.6 }, { name: '교육', rate: 100 }, { name: '지원', rate: 0 }, { name: '검토', rate: 0 }], goals: {} });
  assert.equal(normalizeShare({ items: Array.from({ length: 12 }, (_, i) => ({ name: `업무${i}`, rate: 1 })) }).items.length, 10);
  assert.deepEqual(normalizeShare(null), { items: [], goals: {} });
});

test('줄마다 내 목표(2026-10-28) — 과제·참여율이 없는 과제·기타 줄만, 0~100 소수 한 자리, 빈 칸과 숫자가 아닌 것은 뺀다', () => {
  assert.deepEqual(normalizeShare({ goals: { 'prj:a': '50', etc: 12.34, 'rnd:자율운항': 0, 'prj:b': '', 'prj:c': 'x', 'prj:d': 130, 'item:AIP': 5, x: 3, 'prj:': 4 } }).goals,
    { 'prj:a': 50, etc: 12.3, 'rnd:자율운항': 0, 'prj:d': 100 });
  assert.deepEqual(normalizeShare({ goals: 'x' }).goals, {});
});

test('이름 닮음 — 일일 업무에 조금 다르게 적은 과제명도 같은 과제다(2026-10-27 실측: "통합협 PEMFC" ↔ "통합형 100kW급 PEMFC")', () => {
  assert.ok(likeness('친환경 선박용 암모니아 수소추출기 통합협 PEMFC 시스템 개발', '친환경 선박용 암모니아 수소추출기 통합형 100kW급 PEMFC 시스템 개발') >= LIKE_MIN);
  assert.equal(likeness('반도체 차단기개발 (1차년도)', '반도체 차단기 개발'), 1, '괄호와 띄어쓰기는 보지 않는다');
  assert.ok(likeness('선박용 수소 엔진-연료전지 하이브리드 추진 시스템 개발 및 해상 실증', '대용량 모듈러 멀티레벨 컨버터 기반 고압 드라이브 시제품 개발') < 0.5);
  assert.equal(likeness('', '반도체'), 0);
});

test('내 참여율 — 장부의 rERP 참여인력에서 내 이름(띄어쓰기 무시)의 달마다 지급 ÷ 월급여', () => {
  const r = myRates(BOOK, ME);
  assert.deepEqual(r.projects.map((p) => [p.id, p.label, [...p.rates]]), [['a', 'SSCB', [['2026-04', 30]]], ['b', '고압 드라이브 시제품 개발', [['2026-03', 20], ['2026-04', 20]]], ['c', '항만', []]]);
  assert.deepEqual(myRates(BOOK, '').projects.map((p) => p.rates.size), [0, 0, 0], '내 이름을 모르면 참여율도 모른다');
  assert.deepEqual(myRates(undefined, ME), { projects: [] });
});

test('참여율 칸은 rERP 참여율 그대로 — 걸친 달들의 평균, 달마다의 목표는 적은 분 × 참여율(더한 업무는 × 정한 %). 내 참여율이 없는 과제는 0(2026-10-27 "준적이 없음")', () => {
  const s = workShare(ROWS, { from: '2026-03-01', to: '2026-04-30', items: [{ name: 'AIP', rate: 10 }], rates: myRates(BOOK, ME) });
  assert.equal(s.minutes, 2000);
  // 고압 20%·20% → 20, SSCB 0%·30% → 15. 3월 1000분 × 20% = 200, 4월 1000분 × 20% = 200 · × 30% = 300.
  assert.deepEqual(brief(s), [
    ['고압 드라이브 시제품 개발', 'project', 800, 400],
    ['SSCB', 'project', 500, 300],
    ['자율운항 기술개발', 'rnd', 120, 0],
    ['항만', 'rnd', 80, 0],
    ['AIP', 'item', 100, 200],
    ['기타', 'etc', 400, null],
  ]);
  assert.deepEqual(s.lines.map((L) => L.rate), [20, 15, 0, 0, null, null]);
  assert.deepEqual(s.lines[0].months, [{ ym: '2026-03', actual: 600, target: 200, total: 1000 }, { ym: '2026-04', actual: 200, target: 200, total: 1000 }]);
  assert.equal(s.lines[1].name, '반도체 차단기 개발', '풀네임은 name, 줄 이름은 별칭');
  assert.equal(s.lines[3].name, '항만 자율운항 연계기술', 'R&D 탭에 있지만 내 참여율이 없는 과제도 그 과제의 별칭으로 — 업무분류가 R&D 가 아니어도');
  assert.deepEqual(s.lines[5].titles, [['연구기획>연구기획 기타', 200], ['부서소통회', 200]]);
});

test('올해는 열두 달 평균 — 4월에 시작한 과제도 12로 나누고, 적은 것이 없어도 참여율이 있으면 줄이 선다(2026-10-28 사용자 지정: "4월 과제라도 12개월로 나눠야")', () => {
  const book = { projects: [{ id: 's', name: '반도체 차단기 개발', alias: 'SSCB', years: { 1: { erp: { staff: { people: [
    person(ME, Array.from({ length: 9 }, (_, i) => [`2026-${String(i + 4).padStart(2, '0')}`, 274.5])),
  ] } } } } }] };
  const rows = [row('2026-02-10', '부서소통회', '사내 행사', 100)];
  const s = workShare(rows, { from: '2026-01-01', to: '2026-12-31', rates: myRates(book, ME) });
  assert.deepEqual(s.lines.map((L) => [L.label, L.kind, L.rate && Math.round(L.rate * 100) / 100, L.actual]), [['SSCB', 'project', 20.59, 0], ['기타', 'etc', null, 100]], '27.45% × 9 / 12');
  const rateIn = (from, to) => Math.round(workShare(rows, { from, to, rates: myRates(book, ME) }).lines[0].rate * 1000) / 1000;
  assert.equal(rateIn('2026-10-21', '2026-10-28'), 27.45, '7일은 그 달의 참여율');
  assert.equal(rateIn('2026-03-28', '2026-04-28'), 13.725, '걸친 두 달의 평균');
  assert.equal(rateIn('2026-12-20', '2027-01-10'), 13.725, '해를 넘겨 걸친 달도 센다');
});

test('더한 업무와 기타는 과제 참여율을 바꾸지 않는다(2026-10-28 — 남은 몫을 나누던 셈의 철회). 더한 업무는 기간에 적은 게 없어도 줄이 선다', () => {
  const rows = [
    row('2026-04-04', '연구기획>연구기획 기타', '연구기획 기타', 200), row('2026-04-05', '부서소통회', '사내 행사', 100),
    row('2026-04-02', '고압 드라이브 시제품 개발', '국가 R&D 과제', 200), row('2026-04-01', '반도체 차단기 개발', '국가 R&D 과제', 500),
  ];
  const at = (items) => Object.fromEntries(workShare(rows, { from: '2026-04-01', to: '2026-04-30', items, rates: myRates(BOOK, ME) }).lines.map((L) => [L.label, L.rate]));
  assert.deepEqual(at([]), { SSCB: 30, '고압 드라이브 시제품 개발': 20, 기타: null });
  assert.deepEqual(at([{ name: 'AIP', rate: 5 }]), { SSCB: 30, '고압 드라이브 시제품 개발': 20, AIP: null, 기타: null });
  const none = workShare(rows, { from: '2026-10-01', to: '2026-10-27', items: [{ name: 'AIP', rate: 5 }] });
  assert.deepEqual([none.minutes, brief(none)], [0, [['AIP', 'item', 0, 0]]]);
});
