// 탭 골라 쓰기(src/tabpick.js): 저장 값 읽기, 켜고 끄기(마지막 하나는 못 끔), 보고 있는 탭은 숨겨도 남음, 시작 탭.
import assert from 'node:assert/strict';
import {
  TABS_KEY, TAB_MODES, TAB_LABELS, hiddenTabs, tabShown, firstShown, toggleTab, visibleTabs, startMode,
} from '../src/tabpick.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

console.log('저장 값');
t('키는 tabsOff', () => assert.equal(TABS_KEY, 'tabsOff'));
t('탭 일곱 개가 탭 줄 차례대로', () => assert.deepEqual(TAB_MODES, ['attend', 'gongmun', 'rnd', 'mail', 'room', 'car', 'mine']));
t('탭마다 이름이 있다', () => { for (const m of TAB_MODES) assert.ok(TAB_LABELS[m], m); });
t('값이 없으면 아무것도 숨기지 않는다', () => {
  assert.deepEqual(hiddenTabs(undefined), []);
  assert.deepEqual(hiddenTabs(null), []);
  assert.deepEqual(hiddenTabs('mail'), []);
  assert.deepEqual(hiddenTabs({ mail: true }), []);
});
t('모르는 이름·중복은 버리고 탭 줄 차례로 세운다', () =>
  assert.deepEqual(hiddenTabs(['mine', 'x', 'mail', 'mail', 'attend']), ['attend', 'mail', 'mine']));
t('tabShown — 값이 없으면 전부 보인다', () => { for (const m of TAB_MODES) assert.equal(tabShown(undefined, m), true); });
t('tabShown — 숨긴 것만 안 보인다', () => {
  assert.equal(tabShown(['rnd'], 'rnd'), false);
  assert.equal(tabShown(['rnd'], 'room'), true);
});

console.log('켜고 끄기');
t('끄면 목록에 든다 — 탭 줄 차례로', () => assert.deepEqual(toggleTab(['mine'], 'attend', false), ['attend', 'mine']));
t('이미 꺼진 것을 또 꺼도 그대로', () => assert.deepEqual(toggleTab(['mine'], 'mine', false), ['mine']));
t('켜면 목록에서 빠진다', () => assert.deepEqual(toggleTab(['attend', 'mine'], 'mine', true), ['attend']));
t('안 꺼진 것을 켜도 그대로', () => assert.deepEqual(toggleTab(['mine'], 'room', true), ['mine']));
t('마지막 하나는 끌 수 없다 — null', () => {
  const sixOff = TAB_MODES.filter((m) => m !== 'room');
  assert.equal(toggleTab(sixOff, 'room', null), null);
  assert.equal(toggleTab(sixOff, 'room', false), null);
});
t('여섯 개까지는 끌 수 있다', () => {
  const fiveOff = TAB_MODES.filter((m) => m !== 'room' && m !== 'car');
  assert.deepEqual(toggleTab(fiveOff, 'car', false), TAB_MODES.filter((m) => m !== 'room'));
});
t('모르는 모드는 그대로', () => assert.deepEqual(toggleTab(['mine'], 'bogus', false), ['mine']));
t('전부 꺼진 값이 들어와도 하나는 켤 수 있다', () => assert.deepEqual(toggleTab(TAB_MODES, 'mail', true), TAB_MODES.filter((m) => m !== 'mail')));

console.log('보이는 탭·시작 탭');
t('firstShown — 값이 없으면 근태(맨 앞)', () => assert.equal(firstShown(undefined), 'attend'));
t('firstShown — 앞의 것을 숨기면 그다음', () => assert.equal(firstShown(['attend', 'gongmun', 'rnd', 'mail']), 'room'));
t('firstShown — 전부 숨긴 값이 들어와도 회의실', () => assert.equal(firstShown(TAB_MODES), 'room'));
t('visibleTabs — 보고 있는 탭은 숨겨도 남는다', () =>
  assert.deepEqual(visibleTabs(['mail', 'mine'], 'mail'), ['attend', 'gongmun', 'rnd', 'mail', 'room', 'car']));
t('visibleTabs — 보고 있는 탭이 숨긴 것이 아니면 그냥 보이는 탭', () =>
  assert.deepEqual(visibleTabs(['mail', 'mine'], 'room'), ['attend', 'gongmun', 'rnd', 'room', 'car']));
t('startMode — 저장된 모드가 보이면 그대로', () => assert.equal(startMode(['mine'], 'mail'), 'mail'));
t('startMode — 저장된 모드가 숨겨졌으면 보이는 첫 탭', () => assert.equal(startMode(['attend', 'mail'], 'mail'), 'gongmun'));
t('startMode — 저장된 모드가 없으면 회의실', () => {
  assert.equal(startMode(undefined, undefined), 'room');
  assert.equal(startMode(['mail'], 'bogus'), 'room');
});
t('startMode — 회의실이 숨겨졌고 저장된 모드가 없으면 보이는 첫 탭', () => assert.equal(startMode(['room'], undefined), 'attend'));

console.log(`통과 ${pass}건`);
