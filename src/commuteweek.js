// 홈의 WORKSPACE 카드에 띄울 지난 7일(오늘 포함)의 출퇴근 기록을 HR 에서 읽어 담아 둔다(2026-10-27 사용자 지정:
// "출퇴근 위반이 발생하면 여기에 뜨고 수정할 수 있도록 해줘" · "워크스페이스는 1주일 이전까지만 보이게 해줘").
//
// 근태(src/plans.js)와 같은 길이다 — HR 은 eclass 와 다른 출처라 카드(콘텐츠 스크립트)가 직접 못 읽고, 배경이 이것으로 읽어
// 저장소(COMMUTE_WEEK_KEY)에 담으면 카드가 그것을 본다. 하루에 한 번만 읽고, 카드의 새로고침(force)이나 누가 담아 둔 것을
// 지웠을 때 다시 읽는다. 담는 것은 체크리스트의 줄 그대로다 — 위반 판정(src/commute.js 의 recentBreaches)은 보여주는 쪽이 한다.
//
// HR 과 말하는 길(src/hr.js 의 hrCommutes)은 주입받는다. 카드는 담아 둔 것이 오늘 것인지(commuteWeekFresh)만 여기서 보므로
// 이 파일은 HR 쪽을 끌어오지 않는다.

import { COMMUTE_WEEK_KEY, WEEK_DAYS, daysBefore } from './commute.js';

/** 담아 둔 것을 그대로 써도 되는가 — 오늘 읽은 것이다. */
export function commuteWeekFresh(saved, today) {
  return !!saved && saved.day === today && Array.isArray(saved.rows);
}

/**
 * 지난 7일(오늘 포함)의 체크리스트 줄을 읽는다. 던지지 않는다 — 못 읽으면 까닭을 준다(오늘 읽어 둔 것이 있으면 그것이라도).
 * @param {string} today YYYY-MM-DD
 * @param {{force?: boolean, commutes: (range: {from: string, to: string}) => Promise<object[]>}} opts commutes 는 src/hr.js 의 hrCommutes
 * @returns {Promise<{rows: object[], error: string}>}
 */
export async function loadCommuteWeek(today, { force = false, commutes } = {}) {
  const saved = (await chrome.storage.local.get(COMMUTE_WEEK_KEY))?.[COMMUTE_WEEK_KEY];
  if (!force && commuteWeekFresh(saved, today)) return { rows: saved.rows, error: '' };
  try {
    const got = await commutes({ from: daysBefore(today, WEEK_DAYS - 1), to: today });
    const rows = Array.isArray(got) ? got : [];
    await chrome.storage.local.set({ [COMMUTE_WEEK_KEY]: { day: today, at: Date.now(), rows } });
    return { rows, error: '' };
  } catch (err) {
    return { rows: commuteWeekFresh(saved, today) ? saved.rows : [], error: err?.message || String(err) };
  }
}
