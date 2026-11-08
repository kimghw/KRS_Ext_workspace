import test from 'node:test';
import assert from 'node:assert/strict';
import { buildZip } from '../src/zip.js';
import { KTX_TIMETABLE } from '../src/ktxtimes.js';
import { operatingDays, timetableRows, readKorailTimetable } from '../src/ktxtimetable.js';

test('운행 요일은 명시된 날만 포함하며 알 수 없는 조건은 거부한다', () => {
  assert.equal(operatingDays('매일'), 127);
  assert.equal(operatingDays('금토일'), 97);
  assert.equal(operatingDays('월화수목'), 30);
  assert.throws(() => operatingDays('공휴일'), /알 수 없는 운행 요일/);
});

test('요일·방향·정차 여부·출발 시각으로 거르고 중복을 제거한다', () => {
  const train = { no: '001', train: 'KTX', days: operatingDays('금토일'), stops: [['서울', 540], ['대전', 600], ['부산', 700]] };
  const table = { trains: [train, { ...train }] };
  const query = { from: '서울', to: '부산', date: '2026-11-07', hour: 9 };
  assert.deepEqual(timetableRows(table, query), [{ train: 'KTX', no: '001', dep: '09:00', arr: '11:40', took: '2시간 40분', nextDay: false }]);
  for (const patch of [{ date: '2026-11-09' }, { hour: 10 }, { from: '부산', to: '서울' }, { to: '광명' }]) {
    assert.deepEqual(timetableRows(table, { ...query, ...patch }), []);
  }
});

test('자정 뒤 정차는 승차 날짜와 열차 출발일을 구분한다', () => {
  const table = { trains: [{ no: '002', train: 'KTX', days: operatingDays('금'), stops: [['서울', 1380], ['대전', 1450], ['부산', 1560]] }] };
  assert.equal(timetableRows(table, { from: '대전', to: '부산', date: '2026-11-07', hour: 0 })[0].dep, '00:10');
  assert.deepEqual(timetableRows(table, { from: '대전', to: '부산', date: '2026-11-06', hour: 0 }), []);
  assert.equal(timetableRows(table, { from: '서울', to: '부산', date: '2026-11-06', hour: 0 })[0].nextDay, true);
});

test('포함한 공식 시간표는 양방향·주말 열차·역 별칭을 포함한다', () => {
  assert.equal(KTX_TIMETABLE.basis, '2026-11-01');
  assert.equal(KTX_TIMETABLE.trains.length, 625);
  assert.match(KTX_TIMETABLE.sha256, /^[0-9a-f]{64}$/);
  assert.match(KTX_TIMETABLE.source, /^https:\/\/www\.korail\.com\/file\/cubedata\/COMMON\/jfile\//);
  const rows = timetableRows(KTX_TIMETABLE, { from: '부산', to: '서울', date: '2026-11-08', hour: 9 });
  assert.equal(rows.length, 51);
  assert.deepEqual(rows[0], { train: 'KTX-산천', no: '022', dep: '09:05', arr: '11:49', took: '2시간 44분', nextDay: false });
  for (const [from, to] of [['서울', '부산'], ['서울', '강릉'], ['용산', '여수EXPO'], ['울산(통도사)', '서울'], ['서울', '포항']]) {
    assert.ok(timetableRows(KTX_TIMETABLE, { from, to, date: '2026-11-08', hour: 0 }).length > 0, `${from}→${to}`);
  }
});

function workbook(note = '금토일', value = '0.375') {
  const strings = ['열차번호', '편성', '서울', '울산', '비고(정차역)', 'KTX산천', note];
  const s = (at, index) => `<c r="${at}" t="s"><v>${index}</v></c>`;
  const n = (at, value) => `<c r="${at}"><v>${value}</v></c>`;
  return buildZip([
    { name: 'xl/workbook.xml', data: '<workbook><sheets><sheet name="경부선" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', data: `<sst>${strings.map((v) => `<si><t>${v}</t></si>`).join('')}</sst>` },
    { name: 'xl/worksheets/sheet1.xml', data: `<worksheet><sheetData><row>${s('B7', 0)}${s('C7', 1)}${s('D7', 2)}${s('E7', 3)}${s('F7', 4)}</row><row>${n('B10', 1)}${s('C10', 5)}${n('D10', value)}${n('E10', 0.5)}${s('F10', 6)}</row></sheetData></worksheet>` },
  ]);
}

test('공식 XLSX 형태의 공유 문자열·요일·비고 변형·역 별칭을 읽는다', async () => {
  assert.deepEqual(await readKorailTimetable(workbook()), [{ no: '001', train: 'KTX-산천', days: 97, stops: [['서울', 540], ['울산(통도사)', 720]] }]);
  await assert.rejects(readKorailTimetable(workbook('임시 운행')), /알 수 없는 운행 요일/);
  await assert.rejects(readKorailTimetable(workbook('매일', 'not-a-time')), /알 수 없는 열차 시각/);
});
