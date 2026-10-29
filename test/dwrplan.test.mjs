// 일일 업무 짜기(src/dwrplan.js) — 아직 쓰지 않은 근무일을 목표(합 100% 로)에 맞춰 짜기(2026-10-29 사용자 지정: "여기 목표에 맞도록 일일 업무보고를 신청할 수 있도록 해줘.
// 꼭 딱 맞출 필요는 없고 목표 총 합을 100%로 변경해서 목표와 실제 값이 비슷하게 달성할 수 있도록 해줘. 다만, 근태 내역을 보고 출장/외근의 경우 과제에 맞도록 없거나
// 모모하면 나두고"). 근태 줄은 krs-web-agents 러너가 읽던 HR 근태현황의 꼴(workDate 'YYYYMMDD' · sWorkHour · workCodeKindName · workRsn)을 흉내 낸 것이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hrDate, cleanReason, workDays, historyOf, planItems, targetsOf, tripLine, forecastOf, planDays, contentOf, hourParts, matchRow, TRIP_HOURS,
} from '../src/dwrplan.js';

const A = 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발';
const B = '전기차 해상운송 중 화재예방을 위한 SOC 기준 설정 및 가이드라인 개발';
const C = '선박용 수소 엔진-연료전지 하이브리드 추진 시스템 개발 및 해상 실증';

/** 카드의 업무 줄(workShare().lines 꼴) — actual 은 분. */
const LINES = [
  { key: 'prj:a', kind: 'project', label: 'SSCB', name: A, actual: 2600 },
  { key: 'prj:b', kind: 'project', label: 'SOC', name: B, actual: 2100 },
  { key: 'prj:c', kind: 'project', label: 'H2HY', name: C, actual: 1500 },
  { key: 'item:AIP', kind: 'item', label: 'AIP', name: 'AIP', actual: 0 },
  { key: 'etc', kind: 'etc', label: '기타', name: '기타', actual: 1900 },
];
const MIN = 8100;
const SHARE = { items: [{ name: 'AIP', rate: 6 }], goals: { 'prj:a': 21, 'prj:b': 17, 'prj:c': 15 } };
const RATES = { projects: [{ id: 'a', name: A, label: 'SSCB', rates: new Map([['2026-09', 30]]) }, { id: 'b', name: B, label: 'SOC', rates: new Map([['2026-09', 20]]) }, { id: 'c', name: C, label: 'H2HY', rates: new Map([['2026-09', 20]]) }] };
/** 지난 일일 업무(rowsOf 꼴 — 날짜 내림차순). */
const ROWS = [
  { date: '2026-09-30', title: A, category: '국가 R&D 과제', content: 'MVDC 시험기준 분석', minutes: 480 },
  { date: '2026-09-29', title: A, category: '국가 R&D 과제', content: '선급규정 비교', minutes: 480 },
  { date: '2026-09-26', title: A, category: '국가 R&D 과제', content: 'MVDC  시험기준 분석', minutes: 480 },
  { date: '2026-09-25', title: B, category: '국가 R&D 과제', content: 'SOC 기준 검토', minutes: 480 },
  { date: '2026-09-24', title: '부서소통회', category: '사내 행사', content: '소통회', minutes: 120 },
];
const HR = (date, more = {}) => ({ workDate: date.replace(/-/g, ''), sWorkHour: '8', sStartTime: '0830', planWorkHour: '8', workCodeKindName: '통상근무', workRsn: '', workStatus: '', ...more });

test('HR 날짜 · 사유 글 — YYYYMMDD 를 펴고, 엔티티를 풀고 쉼표로 겹친 사유는 한 번씩', () => {
  assert.deepEqual(['20261001', '2026-10-01', '2026-10-01T00:00', '', null, '2026.10.01'].map(hrDate), ['2026-10-01', '2026-10-01', '2026-10-01', '', '', '']);
  assert.equal(cleanReason('K-Battery Show 참석 &amp; 참관,K-Battery Show 참석 &amp; 참관, 킨텍스'), 'K-Battery Show 참석 & 참관 / 킨텍스');
  assert.equal(cleanReason(null), '');
});

test('근무일 — 실근무시간이 있거나(칸이 비면 출근 시각) 출장·외근인 날만, 출장·외근은 8시간, 연차·주말은 뺀다', () => {
  const days = workDays([
    HR('2026-10-01'),
    HR('2026-10-02', { sWorkHour: '4', workCodeKindName: '연차', workStatus: '연차(13:00~18:00)' }),
    HR('2026-10-03', { sWorkHour: '', sStartTime: '' , workCodeKindName: '' }),
    HR('2026-10-05', { sWorkHour: '', sStartTime: '', workCodeKindName: '국내출장', workRsn: 'K-Battery Show 참석(차세대 배터리 전시 참관) - 킨텍스', workStatus: '국내출장(07:00~23:59)' }),
    HR('2026-10-06', { sWorkHour: '0', sStartTime: '', workCodeKindName: '연차' }),
    HR('2026-10-07', { sWorkHour: '', sStartTime: '0840', planWorkHour: '' }),
    HR('2026-10-08', { workCodeKindName: '외근', workRsn: '부서소통회', workStatus: '외근(12:00~14:00)' }),
    HR('2026-09-30'),
  ], { from: '2026-10-01', to: '2026-10-29' });
  assert.deepEqual(days.map((d) => [d.date, d.hours, d.trip, d.kind]), [
    ['2026-10-01', 8, false, '통상근무'],
    ['2026-10-02', 4, false, '연차'],
    ['2026-10-05', TRIP_HOURS, true, '국내출장'],
    ['2026-10-07', 8, false, '통상근무'],
    ['2026-10-08', 8, true, '외근'],
  ], '반차 날은 실근무 4시간 · 오늘처럼 실근무시간이 빈 날은 계획(없으면 8) · 9/30 은 기간 밖');
  assert.equal(days[2].reason, 'K-Battery Show 참석(차세대 배터리 전시 참관) - 킨텍스');
  assert.equal(days[0].reason, '', '출장·외근이 아니면 사유를 두지 않는다');
});

test('근무일 — 한 날에 줄이 여럿이면 하나로, 출장·외근이 이긴다', () => {
  const days = workDays([HR('2026-10-01', { sWorkHour: '3' }), HR('2026-10-01', { sWorkHour: '', workCodeKindName: '외근', workRsn: 'H2HY 실증 회의' }), HR('2026-10-02', { sWorkHour: '3' }), HR('2026-10-02', { sWorkHour: '5' })]);
  assert.deepEqual(days.map((d) => [d.date, d.hours, d.trip, d.kind, d.reason]), [['2026-10-01', 8, true, '외근', 'H2HY 실증 회의'], ['2026-10-02', 5, false, '통상근무', '']]);
  assert.deepEqual(workDays(null), []);
});

test('지난 일일 업무 — 업무마다 가장 최근 업무명과, 최근부터 겹치지 않는(빈칸 차이 무시) 내용 묶음', () => {
  const h = historyOf(ROWS, { items: SHARE.items, rates: RATES });
  assert.deepEqual(h.get('prj:a'), { title: A, pool: ['MVDC 시험기준 분석', '선급규정 비교'], last: '2026-09-30' });
  assert.deepEqual(h.get('prj:b').pool, ['SOC 기준 검토']);
  assert.equal(h.get('etc').title, '부서소통회');
});

test('계획의 개발내용 — 올해 차년도(없으면 앞 차년도) 계획의 ■ 개발내용 절에서 세부, 세부가 없는 항목은 항목', () => {
  const plan = ['■ 개발목표', '1. 목표', '■ 개발내용', '- 규정 분석', '  · IEC 61660 분석', '  · 선급 규정 비교', '- 시험 절차 수립', '■ 성능목표', '- 차단시간: 1 ms'].join('\n');
  const project = { id: 'a', start: '2026-04-01', end: '2029-12-31', years: { 1: { logs: [{ key: 'plan', text: plan }] }, 2: { logs: [] } } };
  assert.deepEqual(planItems(project, '2027-06-01'), ['IEC 61660 분석', '선급 규정 비교', '시험 절차 수립'], '2차년도에 계획이 없으면 1차년도');
  assert.deepEqual(planItems({ years: {} }, '2026-10-29'), []);
  assert.deepEqual(planItems(null, '2026-10-29'), []);
});

test('목표 — 목표 % 를 넣은 줄만, 합이 100 이 되게(비율 그대로). 기타·목표 없는 줄은 빠진다', () => {
  const t = targetsOf(LINES, SHARE);
  assert.deepEqual(t.map((x) => [x.label, x.goal, Math.round(x.norm * 10) / 10]), [['SSCB', 21, 35.6], ['SOC', 17, 28.8], ['H2HY', 15, 25.4], ['AIP', 6, 10.2]]);
  assert.equal(Math.round(t.reduce((s, x) => s + x.norm, 0)), 100);
  assert.deepEqual(targetsOf(LINES, { items: [], goals: {} }), []);
  assert.deepEqual(targetsOf(LINES, { items: [], goals: { etc: 20, 'prj:a': 20 } }).map((x) => [x.label, x.norm]), [['SSCB', 50], ['기타', 50]], '기타에 목표를 넣으면 합에 든다(기타로 짜지는 않는다)');
});

test('출장·외근 사유 → 업무 — 별칭이 들었거나 그 과제명에만 있는 낱말이 둘 넘게 들면 그 업무, 없거나 둘 이상이면 둔다', () => {
  const lines = LINES.filter((L) => L.kind !== 'etc');
  assert.equal(tripLine('SOC 가이드라인 자문회의', lines).key, 'prj:b', '별칭');
  assert.equal(tripLine('수소연료전지 하이브리드 실증 회의(울산)', lines).key, 'prj:c', '붙여 쓴 낱말도 — 수소·연료전지·하이브리드·실증');
  assert.equal(tripLine('AIP 착수회의', lines).key, 'item:AIP', '더한 업무는 이름');
  assert.deepEqual(tripLine('K-Battery Show 참석(차세대 배터리 전시 참관)', lines), { key: null, why: '사유에 맞는 업무가 없습니다' });
  assert.deepEqual(tripLine('부서소통회', lines).key, null);
  assert.match(tripLine('SSCB · SOC 합동 회의', lines).why, /SSCB · SOC 에 다 맞습니다/, '별칭이 둘이면 모호');
  assert.equal(tripLine('SOC 회의 — 해상운송 화재예방', lines).key, 'prj:b');
  assert.equal(tripLine('', lines).key, null);
  assert.equal(tripLine('개발 기술 시스템 회의', lines).key, null, '어디에나 드는 말은 근거가 아니다');
});

test('짜기 — 출장·외근은 사유의 업무, 나머지는 날마다 목표(합 100%)에 가장 못 미친 업무. 업무명은 최근 적은 것, 내용은 지난 내용을 차례로', () => {
  const days = workDays([
    HR('2026-10-01'), HR('2026-10-02'),
    HR('2026-10-05', { sWorkHour: '', workCodeKindName: '국내출장', workRsn: '수소연료전지 하이브리드 실증 회의' }),
    HR('2026-10-06', { workCodeKindName: '외근', workRsn: '부서소통회' }),
    HR('2026-10-07', { sWorkHour: '4' }), HR('2026-10-08'), HR('2026-10-09'),
  ]);
  const history = historyOf(ROWS, { items: SHARE.items, rates: RATES });
  const p = planDays({ lines: LINES, minutes: MIN, share: SHARE, days, history });
  assert.deepEqual(p.lines.map((L) => [L.key, L.title]), [['prj:a', A], ['prj:b', B], ['prj:c', C], ['item:AIP', 'AIP']], '기타는 고를 수 없다 · 적은 적이 없으면 과제명·업무 이름');
  assert.deepEqual(p.days.map((d) => [d.date, d.label, d.hours, d.why]), [
    ['2026-10-01', 'AIP', 8, ''],
    ['2026-10-02', 'SSCB', 8, ''],
    ['2026-10-05', 'H2HY', 8, ''],
    ['2026-10-06', '', 8, '사유에 맞는 업무가 없습니다'],
    ['2026-10-07', 'SOC', 4, ''],
    ['2026-10-08', 'H2HY', 8, ''],
    ['2026-10-09', 'SOC', 8, ''],
  ], '날마다 (목표 × 쓴 뒤의 합 − 실제)가 가장 큰 업무 — 10/1 AIP 922분 · 10/2 SSCB 796 · 10/7 SOC 717 · 10/8 H2HY 626 · 10/9 SOC 753');
  const by = Object.fromEntries(p.days.map((d) => [d.date, d]));
  assert.equal(by['2026-10-02'].title, A);
  assert.equal(by['2026-10-02'].content, 'MVDC 시험기준 분석', '가장 최근 내용부터');
  assert.deepEqual([by['2026-10-07'].content, by['2026-10-09'].content], ['SOC 기준 검토', 'SOC 기준 검토'], '내용이 하나뿐이면 그것을 다시');
  assert.equal(by['2026-10-05'].content, '수소연료전지 하이브리드 실증 회의', '출장은 사유');
  assert.equal(by['2026-10-01'].content, '', 'AIP 는 적은 적도 계획도 없다 — 지어내지 않는다');
  assert.equal(by['2026-10-08'].content, '');
  assert.equal(by['2026-10-06'].content, '');
  // 쓴 뒤의 실제가 목표(합 100%)에 다가간다 — 가장 못 미친 업무를 골랐다(기타 19% 가 그대로라 딱 맞지는 않는다).
  const before = forecastOf(p.targets, MIN, []);
  const after = forecastOf(p.targets, MIN, p.days);
  const gap = (fs) => fs.reduce((s, f) => s + Math.abs(f.after - f.norm), 0);
  assert.ok(gap(after) < gap(before), `${gap(after)} < ${gap(before)}`);
  // 쓴 뒤 = (실제 + 짠 시간) / (8100 + 2640)분 — SSCB 3080 · SOC 2820 · H2HY 2460 · AIP 480.
  assert.deepEqual(after.map((f) => [f.label, Math.round(f.norm), Math.round(f.now), Math.round(f.after)]), [['SSCB', 36, 32, 29], ['SOC', 29, 26, 26], ['H2HY', 25, 19, 23], ['AIP', 10, 0, 4]]);
});

test('짜기 — 정해 둔 날(사람이 고른·두기·고친 날, 저장해 둔 날)은 그대로 두고 그 업무를 먼저 센 뒤 나머지를 짠다', () => {
  const days = workDays([HR('2026-10-01'), HR('2026-10-02'), HR('2026-10-05')]);
  const history = historyOf(ROWS, { items: SHARE.items, rates: RATES });
  const pinned = days.map((d) => (d.date === '2026-10-01' ? { ...d, fixed: true, key: 'prj:a', content: '내가 적은 내용' } : d.date === '2026-10-02' ? { ...d, fixed: true, key: null } : d));
  const p = planDays({ lines: LINES, minutes: MIN, share: SHARE, days: pinned, history });
  assert.deepEqual(p.days.map((d) => [d.date, d.fixed, d.label, d.content, d.why]), [
    ['2026-10-01', true, 'SSCB', '내가 적은 내용', ''],
    ['2026-10-02', true, '', '', '두기'],
    ['2026-10-05', false, 'AIP', '', ''],
  ]);
  // 내용을 정해 둔 날도 차례는 센다 — SSCB 의 다음 날은 둘째 내용.
  const two = planDays({ lines: LINES, minutes: MIN, share: { items: [], goals: { 'prj:a': 50 } }, days: [{ ...days[0], fixed: true, key: 'prj:a', content: '내가 적은 내용' }, days[1]], history });
  assert.equal(two.days[1].content, '선급규정 비교');
  // 카드에 없는 업무로 저장해 둔 날 — 이름은 기록의 것.
  const gone = planDays({ lines: LINES, minutes: MIN, share: SHARE, days: [{ ...days[0], fixed: true, key: 'prj:z', label: 'OLD', title: '옛 과제', content: '옛 내용' }], history });
  assert.deepEqual([gone.days[0].label, gone.days[0].title, gone.days[0].content], ['OLD', '옛 과제', '옛 내용']);
});

test('짜기 — 목표를 넣은 업무가 없으면 출장·외근 말고는 짜지 않는다. 내용이 없으면 계획의 개발내용', () => {
  const days = workDays([HR('2026-10-01'), HR('2026-10-02', { workCodeKindName: '외근', workRsn: 'SOC 자문' })]);
  const p = planDays({ lines: LINES, minutes: MIN, share: { items: [], goals: {} }, days, history: new Map() });
  assert.deepEqual(p.days.map((d) => [d.key, d.why]), [[null, '목표 % 를 넣은 업무가 없습니다'], ['prj:b', '']]);
  assert.equal(p.days[1].title, B, '적은 적이 없으면 과제명');
  const q = planDays({ lines: LINES, minutes: MIN, share: { items: [], goals: { 'prj:c': 10 } }, days: [days[0]], history: new Map(), planOf: (k) => (k === 'prj:c' ? ['연료전지 시험'] : []) });
  assert.equal(q.days[0].content, '연료전지 시험');
  assert.equal(contentOf({ key: 'x', trip: false }, new Map(), () => []), '');
});

test('더한 업무에 정해 둔 e-Class 업무명이 먼저 — 지난번에 적은 업무명·이름보다(2026-10-29 "AIP 업무는 이걸로 하게 해줘")', () => {
  const AIP = '시험/인증업무>AIP 기술검토 및 관리';
  const days = workDays([HR('2026-10-01')]);
  const share = { items: [{ name: 'AIP', rate: 50, title: AIP }], goals: {} };
  const history = historyOf([{ date: '2026-09-30', title: 'AIP 회의', category: '', content: '개념승인 검토', minutes: 60 }], { items: share.items });
  const p = planDays({ lines: LINES, minutes: MIN, share, days, history });
  assert.deepEqual(p.lines.find((L) => L.key === 'item:AIP'), { key: 'item:AIP', label: 'AIP', title: AIP });
  assert.deepEqual([p.days[0].label, p.days[0].title, p.days[0].content], ['AIP', AIP, '개념승인 검토'], '내용은 그 업무로 적은 것');
});

test('투입시간 → 시·분 칸', () => {
  assert.deepEqual([8, 4, 8.5, 7.75, 0, 30, 'x'].map(hourParts), [{ h: 8, m: 0 }, { h: 4, m: 0 }, { h: 8, m: 30 }, { h: 7, m: 45 }, { h: 0, m: 0 }, { h: 24, m: 0 }, { h: 0, m: 0 }]);
});

test('업무 목록 줄 찾기 — 같은 이름(여럿이면 첫 줄 — 원본 러너), 아니면 한쪽이 품는 줄이 하나뿐일 때. 없거나 둘 이상이면 까닭', () => {
  const rows = [{ row: '1', name: 'GEARS 시스템 관리' }, { row: '4', name: '부서소통회' }, { row: '8', name: A }, { row: '9', name: A }, { row: '20', name: 'AIP 개념승인 업무' }, { row: '10', name: '국가 R&D 과제' }, { row: '18', name: '국가 R&D 과제 관리' }];
  assert.equal(matchRow(rows, A).row.row, '8', '동명 2행은 첫 줄(2026-10-01 사용자 확정 "8번(기존)")');
  assert.equal(matchRow(rows, ` ${A.replace(/ /g, '  ')} `).row.row, '8', '빈칸은 보지 않는다');
  assert.equal(matchRow(rows, 'AIP').row.row, '20', '더한 업무의 이름이 든 줄');
  assert.equal(matchRow(rows, '국가 R&D 과제').row.row, '10', '같은 이름이 먼저');
  assert.match(matchRow(rows, 'R&D').why, /2개/);
  assert.match(matchRow(rows, 'MMC 드라이브').why, /없습니다 — 작성 화면의 업무추가로/);
  assert.match(matchRow(rows, '').why, /업무명이 없습니다/);
  // 작성 화면이 긴 업무명을 줄여 보이면(2026-10-29 사용자 화면 "시험/인증업무>AIP 기술검토 및 ...") 앞부분으로 맞춘다.
  const cut = [...rows, { row: '6', name: '시험/인증업무>AIP 기술검토 및 ...' }, { row: '16', name: '스마트항만 자율운항선박 연계기술' }];
  assert.equal(matchRow(cut, '시험/인증업무>AIP 기술검토 및 관리').row.row, '6');
  assert.equal(matchRow([{ row: '1', name: '짧은…' }], '짧은 이름의 업무').row, null, '줄인 앞부분이 여덟 자는 넘어야');
});
