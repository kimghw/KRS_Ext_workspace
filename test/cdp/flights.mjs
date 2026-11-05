// 항공 조회(src/flights.js) 실측 — 디버그 포트(9333)를 연 크롬에 항공사 예약 화면을 새 탭으로 열고 pageRead 가 조건·항공편 줄을 읽는지 본다.
//
//   node test/cdp/flights.mjs KE [YYYY-MM-DD] [--submit]     대한항공 — --submit 이면 검색 화면의 '항공편 검색'을 눌러 결과 화면까지(조회일 뿐 예약이 아니다)
//   node test/cdp/flights.mjs BX [YYYY-MM-DD]                에어부산 — 화면이 스스로 조회한다(누르는 것 없음). 도시 목록이 403 이면 한 번 새로고침해 본다
//
// 김해(PUS)→김포(GMP) 성인 1명 편도. 날짜가 없으면 내일. 끝에 탭을 닫는다. 좌석을 고르거나 다음 단계로 가지 않는다.
// 대한항공 쿠키 안내창이 떠 있으면(본문 inert) blocked 로 끝난다 — 그 프로필에서 사람이 한 번 고른 뒤 다시.
import { newTab, attach, closeTab } from './cdp.mjs';
import { injected, flightBookingUrl, koreaToday } from '../../src/flights.js';

const airline = (process.argv[2] || 'KE').toUpperCase();
const date = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date(new Date(koreaToday()).getTime() + 86400000).toISOString().slice(0, 10);
let submit = process.argv.includes('--submit');
const input = { airline, from: 'PUS', to: 'GMP', date, hour: 0, adults: 1 };
const url = flightBookingUrl(airline, input);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (c, options = {}) => c.evaluate(`(() => { const d = (${injected.pageRead.toString()})(${JSON.stringify({ airline, input, ...options })}); return { ...d, href: location.href, title: document.title, head: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400) }; })()`, 15000);

console.log('열기', url);
const tab = await newTab(url);
const c = await attach(tab);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`  ${cond ? 'ok ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); if (!cond) failed++; };
try {
  let last = null;
  let reloaded = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    await sleep(1000);
    last = await read(c).catch((e) => ({ error: e.message }));
    if (last.error) break;
    if (last.rows?.length || last.empty) break;
    if (last.matched && submit && Date.now() - t0 > 3000) {
      const pressed = await read(c, { submit: true }).catch(() => null);
      if (pressed?.blocked) { last = { ...last, blocked: true }; break; }
      if (pressed?.submitted) { console.log('  검색 단추를 눌렀다 →', pressed.href); submit = false; }
    }
    // 에어부산 첫 방문의 도시 목록 403 — 조건이 안 실린 채 8초면 한 번 새로고침(실행기와 같은 규칙).
    if (airline === 'BX' && !last.matched && !reloaded && Date.now() - t0 > 8000) { reloaded = true; await c.goto(url); console.log('  새로고침'); }
  }
  ok('공식 화면', !last.error, last.error);
  if (last.error || last.matched !== true) console.log(`    화면: ${last.title} — ${last.head}`);
  ok('조건이 화면에 실렸다', last.matched === true, last.href);
  ok('안내창(쿠키 등)에 막히지 않았다', !last.blocked);
  ok('항공편 줄', last.rows?.length > 0 || last.empty === true, last.empty ? '그 날은 항공편 없음' : `${last.rows?.length || 0}줄`);
  for (const row of last.rows || []) console.log(`    ${row.dep}→${row.arr} ${row.no} ${row.availability}${row.seats != null ? ` 잔여 ${row.seats}석` : ''} ${row.price}${row.fareName ? ` (${row.fareName})` : ''}`);
  ok('대화상자 없음', c.dialogs.length === 0, JSON.stringify(c.dialogs));
} finally {
  c.close();
  await closeTab(tab.id);
}
console.log(failed ? `실패 ${failed}` : '모두 통과');
process.exitCode = failed ? 1 : 0;
