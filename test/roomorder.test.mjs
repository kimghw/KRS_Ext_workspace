// 실제 회의실 페이지로 화면 차례와 접기를 확인한다.
// 사이트 드롭다운 차례와 화면 차례가 다르다는 것이 이 기능의 전부이므로,
// 가짜 이름이 아니라 진짜 목록으로 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

import { parseRooms } from '../src/parse.js';
import { sortRooms, isFoldedRoom, FOLD_LABEL, setRoomOrder, setRoomFold, movedOrder } from '../src/roomorder.js';
import { buildGrid } from '../src/parse.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const html = fs.readFileSync(new URL('./fixtures/list-2026-09-16.html', import.meta.url), 'utf8');
const doc = new JSDOM(html).window.document;

const { rooms: raw } = parseRooms(doc);
const rooms = sortRooms(raw);
const names = rooms.map((r) => r.name);

console.log('화면 차례 (부산)');
t('방 수는 그대로 (빠뜨리지 않는다)', () => assert.equal(rooms.length, raw.length));
t('제1~제5회의실이 맨 위', () =>
  assert.deepEqual(names.slice(0, 5).map((n) => n.slice(0, 5)),
    ['제1회의실', '제2회의실', '제3회의실', '제4회의실', '제5회의실']));
t('그 다음이 미팅룸1, 2', () =>
  assert.deepEqual(names.slice(5, 7).map((n) => n.slice(0, 4)), ['미팅룸1', '미팅룸2']));
t('타부서 회의실(접는 방)은 맨 아래로 모인다', () =>
  assert.deepEqual(names.slice(-7),
    ['부산지부 제1회의실', '부산지부 제2회의실', 'KR ISC 화상회의실(13층)-12석', '스마트홀(18층)', '회의실(9층)', '오션홀(3층)', '세미나실(3층)']));
t('접힌 것 말고는 접히지 않는다', () =>
  assert.deepEqual(rooms.filter(isFoldedRoom).map((r) => r.name), names.slice(-7)));
t('부산지부 제1회의실은 제1회의실이 아니다', () =>
  assert.equal(names[0], '제1회의실(11층)-56석'));
t('접힌 무리 이름', () => assert.equal(FOLD_LABEL, '타부서 회의실'));
t('원본 목록은 건드리지 않는다', () =>
  assert.equal(raw[0].name, '부산지부 제1회의실'));

console.log('격자 줄 번호');
const grid = buildGrid(rooms, [], { start: 8, end: 20 });
t('격자 줄 차례 = 화면 차례', () =>
  assert.deepEqual(grid.map((g) => g.room.name), names));
t('두 번 세워도 같은 차례 (줄 번호가 흔들리지 않는다)', () =>
  assert.deepEqual(sortRooms(sortRooms(raw)).map((r) => r.name), names));

console.log('2026-10-28 사이트 목록 (새 방 일곱 곳)');
// 사이트 드롭다운 차례 그대로. 새 방은 맨 앞에 붙어 내려왔다.
const OCT = ['소회의실(12층)-10석', '대회의실(12층)-18석', '소회의실(7층)-6석', '대회의실(7층)-24석',
  '3회의실(2층)-10석', '2회의실(2층)-10석', '1회의실(2층)-12석', '부산지부 제1회의실-30석', '부산지부 제2회의실-7석',
  '미팅룸1(1층)-8석', '미팅룸2(1층)-4석', 'KR ISC 화상회의실(13층)-12석', '스마트홀(18층)', '회의실(9층)', '오션홀(3층)',
  '세미나실(3층)', '제5회의실(11층)-12석', '제4회의실(11층)-12석', '제3회의실(11층)-16석', '제2회의실(11층)-40석',
  '제1회의실(11층)-56석'].map((name) => ({ name }));
const oct = sortRooms(OCT).map((r) => r.name);
const OCT_FOLD = ['소회의실(12층)-10석', '대회의실(12층)-18석', '소회의실(7층)-6석', '대회의실(7층)-24석',
  '부산지부 제1회의실-30석', '부산지부 제2회의실-7석', 'KR ISC 화상회의실(13층)-12석', '스마트홀(18층)', '회의실(9층)',
  '오션홀(3층)', '세미나실(3층)'];
t('1→3회의실은 미팅룸 아래에 펼친 채', () =>
  assert.deepEqual(oct.slice(7, 10), ['1회의실(2층)-12석', '2회의실(2층)-10석', '3회의실(2층)-10석']));
t('그 위는 그대로 제1~5회의실·미팅룸', () =>
  assert.deepEqual(oct.slice(0, 7).map((n) => n.slice(0, 4)), ['제1회의', '제2회의', '제3회의', '제4회의', '제5회의', '미팅룸1', '미팅룸2']));
t('그림의 일곱 곳은 부산지부·스마트홀·오션홀과 함께 타부서 회의실로 접힌다 (사이트 차례)', () => {
  assert.deepEqual(oct.slice(10), OCT_FOLD);
  assert.ok(OCT.filter(isFoldedRoom).length === OCT_FOLD.length);
});

console.log('끌어서 타부서 회의실에 넣고 뺀다 (2026-10-28)');
{
  setRoomFold({ '1회의실(2층)-12석': true, '세미나실(3층)': false });
  const s = sortRooms(OCT).map((r) => r.name);
  t('넣은 방은 접히고, 뺀 방은 펼쳐진다', () => {
    assert.ok(isFoldedRoom({ name: '1회의실(2층)-12석' }));
    assert.ok(!isFoldedRoom({ name: '세미나실(3층)' }));
  });
  t('뺀 방은 바깥 무리 끝으로, 넣은 방은 접힌 무리 안으로', () => {
    assert.equal(s.indexOf('세미나실(3층)'), 9);
    assert.ok(s.indexOf('1회의실(2층)-12석') >= 10);
  });
  t('넣고 빼지 않은 방은 규칙대로', () => assert.ok(isFoldedRoom({ name: '스마트홀(18층)' }) && !isFoldedRoom({ name: '미팅룸1(1층)-8석' })));
  setRoomFold({});
}

console.log('끌어서 정한 차례 (2026-10-28)');
{
  // 미팅룸2 를 맨 위로 끌어 올렸다. 서울 방(제1회의실) 하나는 저장된 차례에 이미 있었다.
  setRoomOrder(['제1회의실']);
  const before = sortRooms(OCT).map((r) => r.name);
  const order = movedOrder(before, before.indexOf('미팅룸2(1층)-4석'), 0);
  t('옮긴 줄이 그 자리로, 지금 목록에 없는 방(다른 지역)은 뒤에 남는다', () => {
    assert.equal(order[0], '미팅룸2(1층)-4석');
    assert.equal(order.at(-1), '제1회의실');
    assert.equal(order.length, before.length + 1);
  });
  setRoomOrder(order);
  const after = sortRooms(OCT).map((r) => r.name);
  t('저장된 차례대로 선다', () => assert.deepEqual(after, order.slice(0, -1)));
  t('처음 보는 방(새로 생긴 방)은 끌어서 정한 방 아래, 접는 방 위', () => {
    const fresh = sortRooms([...OCT, { name: '4회의실(2층)-8석' }]).map((r) => r.name);
    assert.equal(fresh.indexOf('4회의실(2층)-8석'), after.length - OCT_FOLD.length);
  });
  t('접는 방은 저장된 차례가 앞이어도 맨 아래, 그 안에서는 저장된 차례', () => {
    setRoomOrder(['스마트홀(18층)', ...order]);
    const s = sortRooms(OCT).map((r) => r.name);
    assert.equal(s[s.length - OCT_FOLD.length], '스마트홀(18층)');
    assert.ok(s.slice(-OCT_FOLD.length).every((n) => isFoldedRoom({ name: n })));
  });
  setRoomOrder([]);
  t('차례를 비우면 규칙대로', () => assert.deepEqual(sortRooms(OCT).map((r) => r.name), oct));
}

console.log('차량 이름은 건드리지 않는다');
const cars = [{ name: '쏘나타DN2 (203도7306)' }, { name: '아반테CN74 (181허4310)' }];
t('차량은 접히지 않는다', () => assert.ok(!cars.some(isFoldedRoom)));
t('차량 차례는 그대로', () =>
  assert.deepEqual(sortRooms(cars).map((c) => c.name), cars.map((c) => c.name)));

console.log(`\n통과 ${pass}건`);
