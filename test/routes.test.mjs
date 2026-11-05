// 출장지마다 지난번에 쓴 교통편을 기억했다가 다음에 먼저 쓴다(src/routes.js, 2026-10-04 사용자 지정 · 2026-11-03 가는 편·오는 편마다).
// 무엇을 기억하고(패널이 만든 사전정산 · 사이트에서 읽은 교통편 줄) 무엇을 되살리는지(아이콘 · KTX 길)를 본다. DOM·저장소 없이 돈다.
import assert from 'node:assert/strict';
import { ROUTES_KEY, ROUTES_MAX, routeKey, routeOfPlan, routeOfRows, keepRoute, recallRoute, withRoute } from '../src/routes.js';
import { settlePlan, describePlan } from '../src/travel.js';
import { blankForm, settle } from '../src/attend.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const trip = (over) => settle({ ...blankForm('trip', '2026-10-02'), dateFrom: '2026-10-20', purpose: '착수회의 참석', settle: true, place: '대전', workplace: '부산 본사', ...over });
const row = (date, dep, arr, over = {}) => ({ seq: '1', trseq: '', revno: '', date, dep, arr, transport: 'Train', grade: '일반석', total: 54400, currency: 'KRW', shr: 0, ehr: 0, ...over });
const TRIP = { from: '2026-09-09', to: '2026-09-10', location: '경기도 고양시 킨텍스' };
const T = { t: 'train', g: 'standard' };
const F = { t: 'train', g: 'first' };
const P = { t: 'plane', g: 'standard' };
const both = (leg) => ({ go: { ...leg }, back: { ...leg } });

console.log('무엇을 기억하는가');
t('패널이 사전정산을 만들면 폼에서 고른 가는 편·오는 편과 KTX 가 지난 역의 차례를 기억한다 — 갈아탔으면 갈아탄 역까지', () => {
  assert.deepEqual(routeOfPlan(settlePlan(trip({ place: '경기도 용인시' }))), { go: T, back: T, path: ['부산', '동탄'], date: '2026-10-20' });
  assert.deepEqual(routeOfPlan(settlePlan(trip({ place: '목포', ...both(F) }))), { go: F, back: F, path: ['부산', '오송', '목포'], date: '2026-10-20' });
  assert.deepEqual(routeOfPlan(settlePlan(trip({ place: '제주', ...both(P) }))), { go: P, back: P, path: null, date: '2026-10-20' },
    'KTX 줄이 들어가지 않았으면 길은 없고 교통편만 기억한다');
  assert.deepEqual(routeOfPlan(settlePlan(trip({ place: '서울', days: 2, go: P, back: T }))), { go: P, back: T, path: ['부산', '서울'], date: '2026-10-20' },
    '오는 편만 KTX 여도 길은 근무지 쪽에서의 차례다');
  assert.equal(routeOfPlan(null), null);
});
t('사전정산 화면의 교통편 줄을 읽으면 그것을 기억한다 — 사이트에서 손으로 고친 것까지 따라간다. 줄이 없는 편은 모르고, 줄이 하나도 없으면 기억하지 않는다', () => {
  assert.deepEqual(routeOfRows([row('2026-09-09', '부산', '서울'), row('2026-09-10', '서울', '부산')], TRIP),
    { go: T, back: T, path: ['부산', '서울'], date: '2026-09-09' });
  assert.deepEqual(routeOfRows([row('2026-09-09', '부산역', '광명역', { grade: '특실' }), row('2026-09-10', '광명', '부산')], TRIP),
    { go: F, back: T, path: ['부산', '광명'], date: '2026-09-09' }, '줄에 적힌 곳에서 역을 찾는다 · 등급은 편마다');
  const via = [row('2026-09-09', '부산', '오송'), row('2026-09-09', '오송', '목포'), row('2026-09-10', '목포', '오송'), row('2026-09-10', '오송', '부산')];
  assert.deepEqual(routeOfRows(via, TRIP).path, ['부산', '오송', '목포'], '갈아타는 편은 여러 줄이 한 편이다');
  const mixed = routeOfRows([row('2026-09-09', '김해', '김포', { transport: 'Airplane', grade: '특실' }), row('2026-09-10', '서울', '부산')], TRIP);
  assert.deepEqual(mixed, { go: P, back: T, path: ['부산', '서울'], date: '2026-09-09' }, '가는 편이 비행기면 오는 편 KTX 를 뒤집은 길이다 · 비행기의 등급은 기억하지 않는다');
  assert.deepEqual(routeOfRows([row('2026-09-09', '김해', '김포', { transport: 'Airplane' })], TRIP), { go: P, back: null, path: null, date: '2026-09-09' });
  assert.deepEqual(routeOfRows([row('2026-09-10', '서울', '부산')], TRIP), { go: null, back: T, path: ['부산', '서울'], date: '2026-09-09' },
    '오는 편의 줄만 있다(가는 편이 비행기라 줄이 없는 사전정산)');
  assert.equal(routeOfRows([row('2026-09-09', '부산', '강릉'), row('2026-09-10', '강릉', '부산')], TRIP).path, null, '운임표로 이어지지 않는 길은 기억하지 않는다(교통편만)');
  assert.deepEqual([routeOfRows([], TRIP), routeOfRows([row('2026-09-09', '부산', '서울', { transport: 'Subway' })], TRIP)], [null, null]);
});

console.log('담기와 꺼내기');
t('출장지에 적은 글이 열쇠다 — 더 나중의 출장이 앞의 것을 덮어쓰고, 예전 출장을 읽어도 요즘 것을 덮어쓰지 않는다', () => {
  assert.deepEqual([routeKey('  경기도   고양시 킨텍스 '), ROUTES_KEY], ['경기도 고양시 킨텍스', 'tripRoutes']);
  // 여비계산서에서 읽은 출장지는 "출장지(장소)"다 — 폼의 출장지와 같은 열쇠가 되도록 끝의 괄호(장소)를 뗀다.
  assert.deepEqual([routeKey('대전(한국기계연구원)'), routeKey('대전 (KAIST) '), routeKey('(대전)')], ['대전', '대전', '(대전)']);
  const a = { go: T, back: T, path: ['부산', '서울'], date: '2026-09-09' };
  const one = keepRoute({}, ' 경기도 고양시  킨텍스', a);
  assert.deepEqual(one, { '경기도 고양시 킨텍스': a });
  assert.deepEqual(recallRoute(one, '경기도 고양시 킨텍스 '), a);
  assert.equal(recallRoute(one, '고양'), null, '다른 글은 다른 출장지다');
  assert.equal(keepRoute(one, '경기도 고양시 킨텍스', a), one, '바뀐 것이 없으면 받은 것을 그대로 돌려준다(저장하지 않는다)');
  const older = { ...a, path: ['부산', '광명'], date: '2026-07-01' };
  assert.equal(keepRoute(one, '경기도 고양시 킨텍스', older), one, '예전 출장');
  const newer = { ...a, go: F, path: ['부산', '행신'], date: '2026-10-20' };
  assert.deepEqual(recallRoute(keepRoute(one, '경기도 고양시 킨텍스', newer), '경기도 고양시 킨텍스'), newer);
  const sameDay = { ...a, path: ['부산', '광명'] };
  assert.deepEqual(recallRoute(keepRoute(one, '경기도 고양시 킨텍스', sameDay), '경기도 고양시 킨텍스').path, ['부산', '광명'], '같은 출장을 다시 읽으면 고친 것이 남는다');
});
t('같은 출장을 사이트에서 다시 읽을 때 줄이 없어 모르는 편은 앞의 기억대로 둔다 — 만들 때 고른 비행기 편이 지워지지 않는다', () => {
  const made = routeOfPlan(settlePlan(trip({ place: '서울', dateFrom: '2026-09-09', days: 2, go: P, back: T })));
  const store = keepRoute({}, '서울', made);
  const read = routeOfRows([row('2026-09-10', '서울', '부산')], { from: '2026-09-09', to: '2026-09-10', location: '서울' });
  assert.equal(read.go, null);
  assert.equal(keepRoute(store, '서울', read), store, '모르는 편을 채우면 앞의 기억과 같다 — 저장할 것이 없다');
  const later = keepRoute(store, '서울', { ...read, date: '2026-10-01' });
  assert.deepEqual(recallRoute(later, '서울'), { go: null, back: T, path: ['부산', '서울'], date: '2026-10-01' }, '다른 출장이면 모르는 채로 담는다');
  assert.deepEqual(withRoute(recallRoute(later, '서울')), both(T), '모르는 편은 아는 편을 따른다');
});
t('쓸 수 없는 기억은 담지도 꺼내지도 않는다 — 두 편 모두 모르거나 날짜가 틀린 것, 빈 출장지. 모르는 교통편·등급은 걸러 낸다. 예전 꼴(교통편 목록)도 읽는다', () => {
  const ok = { go: T, back: T, path: null, date: '2026-09-09' };
  assert.deepEqual([keepRoute({}, '', ok), keepRoute({}, '대전', null), keepRoute({}, '대전', { ...ok, go: null, back: { t: 'ship' } }), keepRoute({}, '대전', { ...ok, date: '9/9' }), keepRoute(null, '대전', null)],
    [{}, {}, {}, {}, {}]);
  assert.deepEqual(recallRoute({ 대전: { go: { t: 'bus', g: 'first' }, back: { t: 'train', g: 'x' }, path: ['부산'], date: '2026-09-09' } }, '대전'),
    { go: { t: 'bus', g: 'standard' }, back: T, path: null, date: '2026-09-09' });
  // 2026-11-03 전에 담은 기억 — 편을 가리지 않았으므로 목록의 첫 교통편(선택지 차례)이 두 편이다.
  assert.deepEqual(recallRoute({ 대전: { transport: ['ship', 'bus', 'train'], trainGrade: 'first', path: ['부산', '대전'], date: '2026-09-09' } }, '대전'),
    { go: F, back: F, path: ['부산', '대전'], date: '2026-09-09' });
  assert.deepEqual(recallRoute({ 대전: { transport: ['plane'], trainGrade: 'standard', path: null, date: '2026-09-09' } }, '대전').go, P);
  assert.deepEqual([recallRoute({ 대전: { transport: [], date: '2026-09-09' } }, '대전'), recallRoute({ 대전: 'x' }, '대전'), recallRoute(null, '대전'), recallRoute({}, '')], [null, null, null, null]);
});
t(`기억은 ${ROUTES_MAX}곳까지다 — 넘치면 오래된 출장부터 버린다`, () => {
  let store = {};
  for (let i = 0; i < ROUTES_MAX + 5; i++) {
    store = keepRoute(store, `출장지 ${i}`, { go: T, back: T, path: null, date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}` });
  }
  assert.equal(Object.keys(store).length, ROUTES_MAX);
  assert.deepEqual([recallRoute(store, '출장지 0'), !!recallRoute(store, '출장지 5'), !!recallRoute(store, `출장지 ${ROUTES_MAX + 4}`)], [null, true, true]);
});

console.log('다음 출장에서 되살리기');
t('같은 출장지를 다시 적으면 가는 편·오는 편 아이콘은 지난번대로, 기억이 없으면 기본(기차 일반석)이다', () => {
  assert.deepEqual(withRoute({ go: P, back: F, path: null, date: '2026-09-09' }), { go: P, back: F });
  assert.deepEqual(withRoute(null), both(T));
});
t('사전정산의 KTX 줄은 기억한 길로 짓는다 — 지난번에 사이트에서 광명으로 고쳤으면 다음 고양 출장도 광명이다. 요금은 지금 운임표의 정가다', () => {
  const store = keepRoute({}, TRIP.location, routeOfRows([row('2026-09-09', '부산', '광명', { total: 50000 }), row('2026-09-10', '광명', '부산', { total: 50000 })], TRIP));
  const form = trip({ place: TRIP.location });
  assert.equal(describePlan(settlePlan(form)), '당일출장(주재국) · 경기도 고양시 킨텍스 · KTX 부산↔서울 일반석 54,400원 × 2', '기억이 없을 때');
  assert.equal(describePlan(settlePlan(form, recallRoute(store, form.place))), '당일출장(주재국) · 경기도 고양시 킨텍스 · KTX 부산↔광명 일반석 52,200원 × 2 · 지난번에 쓴 길');
});

console.log(`\n통과 ${pass}건`);
