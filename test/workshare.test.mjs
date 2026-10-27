// 업무 비율(src/workshare.js) — 일일 업무의 업무별 실제 비율과, 연구과제 참여율로 달마다 셈한 목표 비율(2026-10-27 사용자 지정:
// "연구개발 참여율을 월간으로 계산했을 때 해야 되는 업무 시간을 업무별 업무량이랑 같이 보이게 해줘 시간 비율로" · "전체 비중은 100, 이중 5% 는 AIP
// 일부 기타 있겠고, 이 나머지를 연구 참여율 비중으로 나누는 거야. 월간으로 계산해서 반영해야해" · "기타는 변경되면 안되서" · "이건 목표가 0인데 준적이 없음").
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
    { items: [{ name: 'AIP', rate: 5.6 }, { name: '교육', rate: 100 }, { name: '지원', rate: 0 }, { name: '검토', rate: 0 }] });
  assert.equal(normalizeShare({ items: Array.from({ length: 12 }, (_, i) => ({ name: `업무${i}`, rate: 1 })) }).items.length, 10);
  assert.deepEqual(normalizeShare(null), { items: [] });
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

test('달마다 — 100 가운데 더한 업무는 정한 %, 기타는 적은 만큼, 남은 몫을 그 달 참여율 비중으로. 내 참여율이 없는 과제는 목표 0(2026-10-27 "준적이 없음")', () => {
  const s = workShare(ROWS, { from: '2026-03-01', to: '2026-04-30', items: [{ name: 'AIP', rate: 10 }], rates: myRates(BOOK, ME) });
  assert.equal(s.minutes, 2000);
  // 3월(1000분): AIP 100 · 기타 200 → 남은 700 은 참여율이 있는 고압(20%) 하나에. rERP 합(40%)에서 남는 20% 를 R&D 탭에 없는 과제에 나누지 않는다.
  // 4월(1000분): AIP 100 · 기타 200 → 남은 700 을 SSCB 30 : 고압 20 → 420 · 280.
  assert.deepEqual(brief(s), [
    ['고압 드라이브 시제품 개발', 'project', 800, 980],
    ['SSCB', 'project', 500, 420],
    ['자율운항 기술개발', 'rnd', 120, 0],
    ['항만', 'rnd', 80, 0],
    ['AIP', 'item', 100, 200],
    ['기타', 'etc', 400, null],
  ]);
  const b = s.lines[0];
  assert.deepEqual(b.months, [{ ym: '2026-03', actual: 600, target: 700, total: 1000 }, { ym: '2026-04', actual: 200, target: 280, total: 1000 }]);
  assert.equal(s.lines[1].name, '반도체 차단기 개발', '풀네임은 name, 줄 이름은 별칭');
  assert.equal(s.lines[3].name, '항만 자율운항 연계기술', 'R&D 탭에 있지만 내 참여율이 없는 과제도 그 과제의 별칭으로 — 업무분류가 R&D 가 아니어도');
  assert.deepEqual(s.lines[5].titles, [['연구기획>연구기획 기타', 200], ['부서소통회', 200]]);
  assert.deepEqual(s.unknown, []);
});

test('더한 업무를 더하거나 올리면 과제들의 목표가 참여율 비중대로 줄고, 내리면 같은 비중대로 는다 — 기타와 다른 더한 업무는 그대로(2026-10-27 사용자 지정)', () => {
  const rows = [
    row('2026-04-04', '연구기획>연구기획 기타', '연구기획 기타', 200), row('2026-04-05', '부서소통회', '사내 행사', 100),
    row('2026-04-02', '고압 드라이브 시제품 개발', '국가 R&D 과제', 200), row('2026-04-01', '반도체 차단기 개발', '국가 R&D 과제', 500),
  ];
  const at = (items) => Object.fromEntries(workShare(rows, { from: '2026-04-01', to: '2026-04-30', items, rates: myRates(BOOK, ME) }).lines
    .map((L) => [L.label, L.target == null ? `기타 ${L.actual}` : Math.round(L.target * 10) / 10]));
  // 4월 1000분 가운데 기타 300(적은 만큼) → 남은 700 을 SSCB 30 : 고압 20.
  assert.deepEqual(at([]), { SSCB: 420, '고압 드라이브 시제품 개발': 280, 기타: '기타 300' });
  assert.deepEqual(at([{ name: 'AIP', rate: 5 }]), { SSCB: 390, '고압 드라이브 시제품 개발': 260, AIP: 50, 기타: '기타 300' }, 'AIP 5% 를 더하면 과제들이 3 : 2 그대로 줄어든다');
  assert.deepEqual(at([{ name: 'AIP', rate: 5 }, { name: '교육', rate: 3 }]), { SSCB: 372, '고압 드라이브 시제품 개발': 248, AIP: 50, 교육: 30, 기타: '기타 300' }, '하나 더 더해도 AIP 는 그대로');
  assert.deepEqual(at([{ name: 'AIP', rate: 2 }, { name: '교육', rate: 3 }]), { SSCB: 390, '고압 드라이브 시제품 개발': 260, AIP: 20, 교육: 30, 기타: '기타 300' }, 'AIP 를 내리면 과제들이 같은 비중으로 는다');
});

test('참여율을 하나도 모르는 달은 연구과제 목표를 적은 대로 두고 그 달을 알린다 — 더한 업무는 기간에 적은 게 없어도 줄이 선다', () => {
  const rows = [row('2026-02-10', '고압 드라이브 시제품 개발', '국가 R&D 과제', 300), row('2026-02-11', '자율운항 기술개발', '국가 R&D 과제', 100), row('2026-02-12', '부서소통회', '사내 행사', 100)];
  const s = workShare(rows, { from: '2026-02-01', to: '2026-02-28', rates: myRates(BOOK, ME) });
  assert.deepEqual(brief(s), [['고압 드라이브 시제품 개발', 'project', 300, 300], ['자율운항 기술개발', 'rnd', 100, 100], ['기타', 'etc', 100, null]]);
  assert.deepEqual(s.unknown, ['2026-02']);
  const none = workShare(rows, { from: '2026-10-01', to: '2026-10-27', items: [{ name: 'AIP', rate: 5 }] });
  assert.deepEqual([none.minutes, brief(none)], [0, [['AIP', 'item', 0, 0]]]);
});
