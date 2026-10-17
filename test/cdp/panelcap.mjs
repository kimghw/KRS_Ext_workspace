// 패널 캡처(src/panelcap.js) 실측 — 디버그 포트(9333)를 연 크롬에서 확장 페이지(sidepanel.html)를 임시 탭에 띄워
//   1) renderPng 로 머리·탭 줄·보고 있는 탭의 첫 카드를 한 장(PNG)으로 그려 test/cdp/out/panelcap-render.png 에 두고(jsdom 에는 캔버스·그림이 없어 여기서만 본다),
//   2) 머리의 캡처 단추를 눌러 고르기 막을 씌우고 새로고침 단추·탭 줄을 마우스로 골라 그 화면을 panelcap-pick.png 로 찍고,
//   3) 띠의 코드 복사를 눌러 클립보드에 들어갔는지(띠의 말) 본다 — 탭을 앞에 둬야 클립보드가 열린다.
//   4) 탭 줄 위에서 첫 카드 아래까지 마우스를 누른 채 끌어 네모·"놓으면 N개"·점선 미리 보기를 보고(끄는 중 화면은 panelcap-drag.png) 놓으면 더해지는지 본다.
// 이미지 복사는 누르지 않는다 — 클립보드가 막히면 PNG 파일을 내려 두는데, 실측이 내려받기 폴더에 파일을 남기면 안 된다.
//
//   node test/cdp/panelcap.mjs
//
// 사이드패널(또는 다른 확장 페이지)이 열려 있어야 확장 ID 를 잡는다. 끝에 임시 탭을 닫는다. 사이트에는 닿지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { targets, newTab, closeTab, attach } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const NAME = 'KRS WORKSPACE';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extId(list) {
  const t = list.find((x) => /^chrome-extension:\/\//.test(x.url || '') && !/nmmhkkeg|nkeimhog/.test(x.url) && (x.title === NAME || /\/sidepanel\.html$/.test(x.url)));
  return t ? t.url.split('/')[2] : null;
}

const id = extId(await targets());
if (!id) {
  console.error('확장을 찾지 못했다 — 사이드패널을 열어 두세요.');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const tab = await newTab(`chrome-extension://${id}/sidepanel.html`);
await sleep(1200);
const c = await attach(tab);
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`  ${cond ? 'ok ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); if (!cond) failed++; };
try {
  await c.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 20; i++) {
    if (await c.evaluate(`typeof chrome?.runtime?.id === 'string' && !!document.getElementById('panelCap')`, 5000).catch(() => false)) break;
    await sleep(250);
  }
  await sleep(800);   // init() 이 설정을 읽고 머리를 그릴 틈

  console.log('renderPng — 머리·탭 줄·조회 카드');
  const r = await c.evaluate(`(async () => {
    const t0 = performance.now();
    const m = await import(chrome.runtime.getURL('src/panelcap.js'));
    // 머리·탭 줄과, 보고 있는 탭의 첫 카드(어느 탭이 열리는지는 저장된 mode 를 따른다) — 보이는 것만.
    const section = [...document.querySelectorAll('main > section')].find((s) => s.offsetParent !== null);
    const shown = (e) => e && e.getBoundingClientRect().height > 0;
    const els = [document.querySelector('.app-header'), document.querySelector('nav.tabs'), [...(section?.querySelectorAll('.card') || [])].find(shown)].filter(shown);
    const blob = await m.renderPng(els);
    const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
    const bmp = await createImageBitmap(blob);
    return { n: els.length, size: blob.size, w: bmp.width, h: bmp.height, b64, ms: Math.round(performance.now() - t0), iframes: document.querySelectorAll('iframe').length };
  })()`, 30000);
  const f1 = path.join(OUT, 'panelcap-render.png');
  fs.writeFileSync(f1, Buffer.from(r.b64, 'base64'));
  ok('세 곳을 PNG 한 장으로', r.n === 3 && r.size > 2000, `${r.w}×${r.h}px · ${r.size.toLocaleString()}바이트 · ${r.ms}ms → ${f1}`);
  ok('숨은 틀 문서는 닫혔다', r.iframes === 0);

  console.log('고르기 막 — 머리의 단추로 씌우고 마우스로 고른다');
  await c.send('Page.bringToFront').catch(() => {});
  await c.evaluate(`document.getElementById('panelCap').click()`);
  const rects = await c.evaluate(`(() => {
    const at = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
    return { refresh: at('#refresh'), tabs: at('nav.tabs'), pressed: document.getElementById('panelCap').getAttribute('aria-pressed'), host: !!document.querySelector('.pcap') };
  })()`);
  ok('막이 씌워지고 단추는 눌린 모양', rects.host && rects.pressed === 'true');
  const mouse = async (type, x, y, button = 'none') => c.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const clickAt = async ({ x, y }) => {
    await mouse('mouseMoved', x, y);
    await sleep(80);
    await mouse('mousePressed', x, y, 'left');
    await mouse('mouseReleased', x, y, 'left');
    await sleep(120);
  };
  await mouse('mouseMoved', rects.refresh.x, rects.refresh.y);
  await sleep(100);
  const hover = await c.evaluate(`document.querySelector('.pcap-tag')?.textContent || ''`);
  ok('새로고침 단추 위를 가리키면 그 이름표', /button#refresh/.test(hover), hover);
  await clickAt(rects.refresh);
  await clickAt(rects.tabs);
  const picked = await c.evaluate(`(() => ({
    n: document.querySelectorAll('.pcap-marks .pcap-box').length,
    bar: document.querySelector('.pcap-n b')?.textContent,
    code: document.querySelector('.pcap-code')?.disabled,
  }))()`);
  ok('둘을 골랐다 — 번호 둘, 띠에 2개, 코드 복사 열림', picked.n === 2 && picked.bar === '2개 골랐습니다' && picked.code === false, JSON.stringify(picked));
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  const f2 = path.join(OUT, 'panelcap-pick.png');
  fs.writeFileSync(f2, Buffer.from(shot.data, 'base64'));
  console.log(`  화면 → ${f2}`);

  console.log('코드 복사 — 띠의 단추');
  await c.evaluate(`document.querySelector('.pcap-code').click()`);
  await sleep(400);
  const said = await c.evaluate(`document.querySelector('.pcap-n b')?.textContent || ''`);
  ok('복사했다는 말(탭이 앞에 있어야 클립보드가 열린다)', /코드 복사됨 · 2곳/.test(said), said);

  console.log('끌어서 여러 개 — 탭 줄 위에서 첫 카드 아래까지 긋는다');
  const span = await c.evaluate(`(() => {
    const t = document.querySelector('nav.tabs').getBoundingClientRect();
    const section = [...document.querySelectorAll('main > section')].find((s) => s.offsetParent !== null);
    const card = [...(section?.querySelectorAll('.card') || [])].find((e) => e.getBoundingClientRect().height > 0);
    const b = card.getBoundingClientRect();
    return { x0: Math.round(Math.min(t.left, b.left)) - 4, y0: Math.round(t.top) - 4, x1: Math.round(Math.max(t.right, b.right)) + 4, y1: Math.round(b.bottom) + 4, n: document.querySelectorAll('.pcap-marks .pcap-box').length };
  })()`);
  await mouse('mouseMoved', span.x0, span.y0);
  await sleep(60);
  await mouse('mousePressed', span.x0, span.y0, 'left');
  await mouse('mouseMoved', span.x0 + 20, span.y0 + 20, 'left');
  const t0 = Date.now();
  await mouse('mouseMoved', span.x1, span.y1, 'left');
  const dragMs = Date.now() - t0;
  await sleep(120);
  const mid = await c.evaluate(`(() => ({
    tag: document.querySelector('.pcap-drag .pcap-tag')?.textContent || '', shown: !document.querySelector('.pcap-drag')?.hidden,
    pre: document.querySelectorAll('.pcap-pre .pcap-box').length, hover: document.querySelector('.pcap-hover')?.hidden,
  }))()`);
  ok('끄는 동안 네모와 "놓으면 N개" · 들 것들의 점선 · 가리키는 칸은 숨음', mid.shown && /^놓으면 \d+개 고르기$/.test(mid.tag) && mid.pre > 0 && mid.hover === true, `${JSON.stringify(mid)} · 움직임 ${dragMs}ms`);
  const shot3 = await c.send('Page.captureScreenshot', { format: 'png' });
  const f3 = path.join(OUT, 'panelcap-drag.png');
  fs.writeFileSync(f3, Buffer.from(shot3.data, 'base64'));
  console.log(`  끄는 중 화면 → ${f3}`);
  await mouse('mouseReleased', span.x1, span.y1, 'left');
  await sleep(120);
  const dropped = await c.evaluate(`(() => ({
    n: document.querySelectorAll('.pcap-marks .pcap-box').length, bar: document.querySelector('.pcap-n b')?.textContent,
    drag: document.querySelector('.pcap-drag')?.hidden, pre: document.querySelectorAll('.pcap-pre .pcap-box').length,
  }))()`);
  ok('놓으면 든 것들이 더해지고(먼저 고른 둘은 그대로) 네모는 걷힌다', dropped.n > span.n && dropped.bar === `${dropped.n}개 골랐습니다` && dropped.drag === true && dropped.pre === 0, JSON.stringify(dropped));
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(150);
  const after = await c.evaluate(`({ host: !!document.querySelector('.pcap'), pressed: document.getElementById('panelCap').getAttribute('aria-pressed') })`);
  ok('Esc 로 막이 걷히고 단추도 돌아온다', !after.host && after.pressed === 'false');

  ok('페이지 오류 없음', c.errors.length === 0, c.errors.map((e) => e.text).join(' | '));
  if (c.logs.length) console.log('  콘솔:', c.logs.map((l) => `${l.type}: ${l.text}`).join(' | '));
} finally {
  c.close();
  await closeTab(tab.id);
}
console.log(failed ? `\n${failed}건 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
