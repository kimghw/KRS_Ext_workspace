import test from 'node:test';
import assert from 'node:assert/strict';
import { blankForm } from '../src/attend.js';
import { explicitAttendFields } from '../src/quickinput.js';
import { parseKtxLocal, simpleKtxRequest } from '../src/ktxnlq.js';
import { parseLocal, simpleQuery } from '../src/nlq.js';
import { parseSmart, ktxSmart, fillAttendSmart } from '../src/llm.js';

const TODAY = '2026-11-07';
const options = { today: TODAY, useNative: true, apiKey: 'test-key' };
function backend(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected API call'); });
  const original = globalThis.chrome;
  globalThis.chrome = { runtime: { sendNativeMessage: async (_host, message) => {
    calls.push(message);
    const data = message.task === 'search.ktx' ? { to: '대전', hour: 18 }
      : message.task === 'attend' ? { purpose: '복잡한 요청 해석', reply: '채웠습니다.' }
        : { summary: '복잡한 요청 해석', dateFrom: TODAY, dateTo: TODAY, hourFrom: 14, hourTo: 18, minSeats: null, minHours: null, region: null };
    return { ok: true, data };
  } } };
  t.after(() => { globalThis.chrome = original; });
  return calls;
}

test('항목과 값을 지정한 출장지·장소·목적은 모델 호출 없이 검증해 채운다', async (t) => {
  const calls = backend(t);
  const r = await fillAttendSmart('출장지: 대전\n장소: 한국기계연구원\n목적: 연구과제 협의', { ...options, form: blankForm('trip', TODAY) });
  assert.deepEqual(r.patch, { place: '대전', venue: '한국기계연구원', purpose: '연구과제 협의' });
  assert.equal(r.via, 'local');
  assert.match(r.reply, /3칸/);
  assert.equal(calls.length, 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('명확한 입력만 처리하고 중복·지원하지 않는 칸·모호한 변경은 넘긴다', () => {
  const form = blankForm('trip', TODAY);
  assert.deepEqual(explicitAttendFields('행선지 서울', form), { place: '서울' });
  assert.deepEqual(explicitAttendFields('출장지는: "서울 종로구"; 목적: \'자료를 바꿔줘\'', form), { place: '서울 종로구', purpose: '자료를 바꿔줘' });
  for (const text of ['출장지: 서울\n출장지: 부산', '출장지 서울로 바꿔줘', '출장지: 서울\n다음 주로 바꿔', '출장지: 서울 말고 부산', '출장지: ', '근무지: 부산']) {
    assert.equal(explicitAttendFields(text, form), null, text);
  }
  assert.equal(explicitAttendFields('출장지: 서울', blankForm('out', TODAY)), null);
});

test('KTX의 흔한 역·날짜·시각·인원 요청은 모델 호출 없이 조회 조건으로 바뀐다', async (t) => {
  const calls = backend(t);
  const r = await ktxSmart('모레 아침 9시 부산에서 서울 2명', options);
  assert.deepEqual(r.patch, { from: '부산', to: '서울', date: '2026-11-09', hour: 9, adults: 2 });
  assert.equal(r.via, 'local');
  assert.equal(calls.length, 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('회의실·차량의 명확한 조회도 바로 해석하며 차량의 인원 조건은 기존 관문이 제거한다', async (t) => {
  const calls = backend(t);
  const room = await parseSmart('내일 오전 부산 회의실 8명', options);
  assert.equal(room.via, 'local');
  assert.equal(room.filter.dateFrom, '2026-11-08');
  assert.equal(room.filter.minSeats, 8);
  const car = await parseSmart('내일 오후 차량 8명', { ...options, kind: 'car' });
  assert.equal(car.via, 'local');
  assert.equal(car.filter.minSeats, null);
  assert.match(car.note, /차량/);
  assert.equal(calls.length, 0);
});

test('일부만 읽은 문장이나 충돌하는 조건은 빠른 해석으로 조용히 생략하지 않는다', async (t) => {
  const calls = backend(t);
  for (const text of ['서울 말고 대전', '부산 대전 서울', '내일 서울 25시', '내일 모레 서울', '서울 2시간 뒤']) {
    assert.equal(simpleKtxRequest(text, parseKtxLocal(text, TODAY)), false, text);
  }
  for (const text of ['내일 오후 회의 끝나고', '내일 서울 부산 오전', '다음 주 수요일 오전', '내일 오후 2시부터 3시간', '내일 2시~4시']) {
    assert.equal(simpleQuery(text, parseLocal(text, TODAY)), false, text);
  }
  assert.equal((await ktxSmart('서울 말고 대전', options)).via, 'cli');
  assert.equal((await parseSmart('내일 오후 회의 끝나고', options)).via, 'cli');
  assert.equal((await fillAttendSmart('출장지 서울로 바꿔줘', { ...options, form: blankForm('trip', TODAY) })).via, 'cli');
  assert.equal(calls.length, 3);
});
