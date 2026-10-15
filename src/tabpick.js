// 패널 머리의 탭(근태·공문·R&D·메일·회의실·차량·현황)을 골라 쓰는 설정의 순수 로직.
//
// 쓰지 않는 탭은 머리의 탭 줄에서 사라지고, 남은 탭이 그 폭을 나눠 가진다. 어떤 탭을 숨길지는
// 패널의 "설정 및 연결 → 보이는 탭" 체크박스가 정하고, storage(`tabsOff`)에 **숨긴 탭의 모드 이름**만 담는다 —
// 값이 없거나 빈 배열이면 전부 보인다(설정을 한 번도 건드리지 않은 사람과 같다). 모드 이름은 sidepanel.js 의
// state.mode 와 같은 것(room·car·mine·attend·gongmun·rnd·mail)이다.
//
// 규칙 둘:
//  - 적어도 하나는 남긴다. 마지막 하나를 끄려 하면 거절한다(`toggleTab` 이 null).
//  - 숨긴 탭도 열어 둘 수는 있다. 홈 카드의 한 건을 눌러 그 탭으로 가거나, 보고 있던 탭을 그 자리에서 껐을 때다.
//    그때는 보고 있는 동안만 탭 줄에 남고(`visibleTabs`), 다른 탭으로 옮기면 사라진다.

/** storage 키. 숨긴 탭의 모드 이름 배열. */
export const TABS_KEY = 'tabsOff';

/** 탭 줄의 차례 그대로. sidepanel.html 의 nav.tabs 와 같다. */
export const TAB_MODES = ['attend', 'gongmun', 'rnd', 'mail', 'room', 'car', 'mine'];

/** 탭 이름 — 체크박스 라벨·활동 기록에 쓴다. */
export const TAB_LABELS = {
  attend: '근태', gongmun: '공문', rnd: 'R&D', mail: '메일', room: '회의실', car: '차량', mine: '현황',
};

/** 저장된 값을 숨긴 탭 목록으로 — 모르는 이름·중복은 버리고 탭 줄 차례로 세운다. */
export function hiddenTabs(value) {
  if (!Array.isArray(value)) return [];
  return TAB_MODES.filter((m) => value.includes(m));
}

/** 그 탭을 보이는지. 값이 없으면 보인다. */
export const tabShown = (value, mode) => !hiddenTabs(value).includes(mode);

/** 보이는 탭 가운데 탭 줄에서 맨 앞의 것. 전부 숨겼다는 값이 들어와도 회의실로 돌린다. */
export function firstShown(value) {
  return TAB_MODES.find((m) => tabShown(value, m)) || 'room';
}

/**
 * 한 탭을 켜거나 끈 뒤의 저장 값. 마지막 하나를 끄려는 것이면 null — 부르는 쪽이 체크박스를 되돌린다.
 * 모르는 모드 이름이면 그대로 돌려준다.
 */
export function toggleTab(value, mode, on) {
  const off = hiddenTabs(value);
  if (!TAB_MODES.includes(mode)) return off;
  if (on) return off.filter((m) => m !== mode);
  if (off.includes(mode)) return off;
  if (off.length >= TAB_MODES.length - 1) return null;
  return TAB_MODES.filter((m) => m === mode || off.includes(m));
}

/**
 * 탭 줄에 실제로 보일 탭. 숨긴 탭이라도 지금 보고 있는 것(active)이면 남긴다 —
 * 홈 카드에서 그 건을 눌러 왔거나 보던 탭을 방금 껐을 때 탭 줄에 표시 없는 화면이 되지 않게.
 */
export function visibleTabs(value, active) {
  return TAB_MODES.filter((m) => tabShown(value, m) || m === active);
}

/** 시작할 때 열 탭 — 저장된 모드가 숨겨져 있으면 보이는 첫 탭. 모르는 모드면 회의실. */
export function startMode(value, savedMode) {
  const want = TAB_MODES.includes(savedMode) ? savedMode : 'room';
  return tabShown(value, want) ? want : firstShown(value);
}
