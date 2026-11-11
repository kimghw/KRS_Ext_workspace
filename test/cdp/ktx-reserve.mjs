// 실제 선택된 열차의 예매 버튼 입력 방식 비교. 기본은 읽기 전용이며 --book일 때만 한 번 누른다.
// 예: node test/cdp/ktx-reserve.mjs --date 2026-11-13 --from 대전 --to 부산 --train 333 --dep 14:44 --adults 1 --seat gen
// --book은 해당 열차의 실제 좌석 예약을 사용자가 승인한 경우에만 추가한다. 결제는 하지 않는다.
import fs from 'node:fs/promises';
import { korailReservePage } from '../../src/korailreserve.js';

const args = process.argv.slice(2);
const value = (key) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
const expected = {
  date: value('--date'), from: value('--from'), to: value('--to'), no: value('--train'),
  dep: value('--dep'), adults: Number(value('--adults')), seat: value('--seat'),
};
if (!/^\d{4}-\d{2}-\d{2}$/.test(expected.date || '') || !/^\d{1,4}$/.test(expected.no || '')
  || !/^([01]\d|2[0-3]):[0-5]\d$/.test(expected.dep || '') || !expected.from || !expected.to
  || !Number.isInteger(expected.adults) || expected.adults < 1 || expected.adults > 9
  || !['gen', 'spec'].includes(expected.seat)) throw new Error('날짜·구간·열차·출발시각·어른 인원·객실을 명시해야 합니다.');

const port = Number(process.env.CDP_PORT || 9333);
const tabs = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
const candidates = tabs.filter((t) => t.type === 'page' && t.url === 'https://www.korail.com/ticket/search/list');
if (candidates.length !== 1) throw new Error('코레일 결과 탭이 하나일 때만 실행합니다.');
const socket = new WebSocket(candidates[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP 연결 시간 초과')), 5000);
  socket.onopen = () => { clearTimeout(timer); resolve(); };
  socket.onerror = () => { clearTimeout(timer); reject(new Error('CDP 연결 실패')); };
});
let seq = 0;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data), call = pending.get(message.id);
  if (!call) return;
  pending.delete(message.id);
  clearTimeout(call.timer);
  if (message.error) call.reject(new Error(message.error.message));
  else call.resolve(message.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: 시간 초과`)); }, 10000);
  pending.set(id, { resolve, reject, timer });
  socket.send(JSON.stringify({ id, method, params }));
});
// Runtime.enable은 진단에 필요하지 않다. 기존 사이트 상태와 이벤트 속성은 변경하지 않는다.
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const read = (step) => evaluate(`(${korailReservePage.toString()})(${JSON.stringify(step)},${JSON.stringify(expected)})`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { target: expected, input: 'CDP Input.dispatchMouseEvent', clicked: false, reserved: false, observations: [] };
const directory = new URL('./out/', import.meta.url);
try {
  const first = await read('ready');
  await sleep(500);
  const second = await read('ready');
  report.observations.push(first, second);
  if (!first.ready || !second.ready || first.key !== second.key) throw new Error('선택한 열차·객실·조건 또는 안내창·로딩 상태가 예약 준비 상태와 다릅니다.');
  if (args.includes('--book')) {
    const position = await evaluate(`(async () => {
      const ready = await (${korailReservePage.toString()})('ready',${JSON.stringify(expected)});
      if (!ready.ready || ready.key !== ${JSON.stringify(second.key)}) return null;
      const button = [...document.querySelectorAll('button.reservbtn')].find(b => b.getClientRects().length && b.innerText.trim() === '예매' && !b.disabled);
      if (!button) return null;
      button.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
      const r = button.getBoundingClientRect(), x = r.left+r.width/2, y = r.top+r.height/2;
      const hit = document.elementFromPoint(x,y);
      return hit && button.contains(hit) ? {x,y} : null;
    })()`);
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error('예매 버튼의 실제 클릭 위치를 확인하지 못했습니다.');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...position });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...position });
    report.clicked = true;
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      const status = await read('status');
      report.observations.push(status);
      report.reserved = status.done === true;
      if (status.done || status.guard || status.login || status.why) break;
      const { targetInfos } = await send('Target.getTargets');
      report.popups = targetInfos.filter((target) => target.openerId === candidates[0].id)
        .map((target) => ({ id: target.targetId, url: target.url.split('?')[0] }));
      if (report.popups.length) break;
      // 다음 안내는 관찰해 사용자에게 돌려준다. 비교 시험은 예매 한 번만 실행한다.
      if (status.said?.length) break;
    }
  }
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await fs.mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = new URL(`ktx-reserve-${stamp}.json`, directory);
  await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n');
  if (report.clicked && !report.reserved) {
    try {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(new URL(`ktx-reserve-${stamp}.png`, directory), Buffer.from(shot.data, 'base64'));
    } catch { /* 화면 캡처 실패가 진단 결과를 덮지 않는다. */ }
  }
  socket.close();
  console.log(JSON.stringify({ ...report, file: file.pathname }));
}
