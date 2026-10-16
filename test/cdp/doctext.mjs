// 브라우저 길의 글자 먼저 뽑기 실측 — 디버그 포트를 연 크롬의 KRS WORKSPACE 확장 페이지에서 pdf.js·Tesseract(wasm)가 실제로 도는지 본다.
//
//   node test/cdp/doctext.mjs            # 페이지 길(사이드패널 페이지에서 doctext/browser.js) + 서비스 워커 길(offscreen 문서) + 설정 LLM 갈래 화면
//   node test/cdp/doctext.mjs --page     # 페이지 길만
//   node test/cdp/doctext.mjs --sw       # 서비스 워커 길만(background 에 붙어 doctext/index.js 의 docText 를 부른다 → offscreen 문서가 뽑는다)
//   node test/cdp/doctext.mjs --shot     # 설정 → LLM 갈래(다리가 하는 일 표)만 찍는다
//
// API 는 부르지 않는다 — 글자 뽑기까지만이다. 견본은 node 에서 만든다(test/doctext.test.mjs 와 같은 것: 글자가 든 PDF·그린 그림·그림만 든 PDF).
// 화면은 test/cdp/out/ 에 PNG 로 남긴다(.gitignore).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts } from '../../vendor/pdf-lib.esm.min.js';
import { targets, newTab, closeTab, attach } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const NAME = 'KRS WORKSPACE';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const only = (flag) => args.includes(flag);
const all = !only('--page') && !only('--sw') && !only('--shot');

/* ------------------------------------------------------------------ 견본 */
const file = (name, bytes, type) => ({ name, type, dataUrl: `data:${type};base64,${Buffer.from(bytes).toString('base64')}` });

async function textPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([400, 300]);
  p1.drawText('Hotel SONO CALM GOYANG', { x: 30, y: 250, size: 14, font });
  p1.drawText('Check-in 2026-09-09  Check-out 2026-09-10', { x: 30, y: 220, size: 12, font });
  p1.drawText('Total USD 131.57', { x: 30, y: 190, size: 12, font });
  doc.addPage([400, 300]).drawText('Cancellation policy', { x: 30, y: 250, size: 12, font });
  return doc.save();
}
function drawn(lines, { width = 520, size = 26 } = {}) {
  const canvas = createCanvas(width, 40 + lines.length * (size + 18));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = `${size}px Arial`;
  lines.forEach((line, i) => ctx.fillText(line, 24, 44 + i * (size + 18)));
  return canvas.toBuffer('image/png');
}
async function scanPdf(png) {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  doc.addPage([595, 842]).drawImage(img, { x: 40, y: 500, width: 500, height: (500 * img.height) / img.width });
  return doc.save();
}
const SLIP = ['RECEIPT 2026-09-16', 'Supply 53,636', 'VAT 5,364', 'TOTAL 59,000'];

async function samples() {
  const png = drawn(SLIP);
  return [
    file('Receipt.pdf', await textPdf(), 'application/pdf'),
    file('slip.png', png, 'image/png'),
    file('scan.pdf', await scanPdf(png), 'application/pdf'),
  ];
}

/* ------------------------------------------------------------------ 확장 찾기 */
function extId(list) {
  const t = list.find((x) => /^chrome-extension:\/\//.test(x.url || '') && !/nmmhkkeg|nkeimhog/.test(x.url) && (x.title === NAME || /\/sidepanel\.html$/.test(x.url)));
  return t ? t.url.split('/')[2] : null;
}

/** 확장 페이지 하나를 임시 탭에 띄워 붙는다. */
async function openPage(id, page = 'sidepanel.html') {
  const tab = await newTab(`chrome-extension://${id}/${page}`);
  await sleep(1200);
  const c = await attach(tab);
  await c.send('Page.enable').catch(() => {});
  await c.send('Runtime.enable').catch(() => {});
  // 확장 맥락이 설 때까지 — 막 연 탭에서 chrome.runtime 이 아직 없던 적이 있다(2026-10-16, 한 번).
  for (let i = 0; i < 20; i++) {
    if (await c.evaluate(`typeof chrome?.runtime?.id === 'string'`, 5000).catch(() => false)) break;
    await sleep(250);
  }
  return { tab, c };
}

/** 페이지 안에서 withText 를 돌리는 식 — 견본은 JSON 으로 박는다. */
const pageExpr = (files) => `(async () => {
  const t0 = performance.now();
  const m = await import(chrome.runtime.getURL('doctext/browser.js'));
  const ready = await m.ready();
  if (!ready.ok) return { ready, ms: Math.round(performance.now() - t0) };
  const out = await m.withText('실측', ${JSON.stringify(files)});
  return { ready, read: out.read, lean: out.lean, files: out.files.map((f) => f.name), inputLen: out.input.length,
    head: out.input.slice(0, 600), ms: Math.round(performance.now() - t0) };
})()`;

/** 서비스 워커에게 글자 뽑기를 부탁하는 식 — background.js 의 doctextProbe 가 doctext/index.js 의 docText 를 부른다(서비스 워커에는 Worker 가 없어 offscreen 문서가 뽑는다). */
const swExpr = (files) => `new Promise((resolve) => {
  const t0 = Date.now();
  chrome.runtime.sendMessage({ type: 'doctextProbe', input: '실측(서비스 워커)', files: ${JSON.stringify(files)} }, (r) => {
    if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message, ms: Date.now() - t0 });
    else resolve({ ...(r || { error: '응답 없음' }), ms: Date.now() - t0 });
  });
})`;

/* ------------------------------------------------------------------ 갈래 */
async function pagePath(id, files) {
  console.log('\n[페이지 길] sidepanel.html 에서 doctext/browser.js');
  const { tab, c } = await openPage(id);
  try {
    const r = await c.evaluate(pageExpr(files), 180000);
    console.log(JSON.stringify(r, null, 2));
    return r;
  } finally {
    c.close();
    await closeTab(tab.id);
  }
}

async function swPath(id, files) {
  console.log('\n[서비스 워커 길] sidepanel.html → runtime.sendMessage(doctextProbe) → background.js 의 docText → offscreen 문서');
  // 메시지를 보내면 잠든 서비스 워커도 뜬다. 답은 서비스 워커가 offscreen 문서를 띄워 뽑은 뒤에 온다.
  const { tab, c } = await openPage(id);
  try {
    const r = await c.evaluate(swExpr(files), 180000);
    console.log(JSON.stringify(r, null, 2));
    const off = (await targets()).filter((x) => (x.url || '') === `chrome-extension://${id}/offscreen.html`);
    console.log(`  offscreen 문서 타깃: ${off.length ? '있음(유휴 뒤 닫힌다)' : '없음(이미 닫혔거나 못 만듦)'}`);
    return r;
  } finally {
    c.close();
    await closeTab(tab.id);
  }
}

async function shot(id) {
  console.log('\n[화면] 설정 → LLM 갈래');
  fs.mkdirSync(OUT, { recursive: true });
  const { tab, c } = await openPage(id);
  try {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 1100, deviceScaleFactor: 1, mobile: false }).catch(() => {});
    await c.evaluate(`(async () => { document.getElementById('settingsShortcut')?.click(); await new Promise((r) => setTimeout(r, 300)); document.getElementById('setTabLlm')?.click(); await new Promise((r) => setTimeout(r, 2500)); return document.getElementById('bridgeUses')?.innerText || '(bridgeUses 없음)'; })()`, 15000)
      .then((t) => console.log('  다리가 하는 일 표:\n' + String(t).split('\n').map((l) => '    ' + l).join('\n')));
    const shotR = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, 20000);
    const f = path.join(OUT, 'settings-llm.png');
    fs.writeFileSync(f, Buffer.from(shotR.data, 'base64'));
    console.log(`  저장: ${f}`);
    return f;
  } finally {
    c.close();
    await closeTab(tab.id);
  }
}

/* ------------------------------------------------------------------ 진입 */
const list = await targets();
const id = args.find((a) => /^[a-p]{32}$/.test(a)) || extId(list);
if (!id) { console.error('확장을 찾지 못했다 — 사이드패널을 열어 두거나 확장 ID 를 인자로 주세요.'); process.exit(1); }
console.log(`확장 ${id}`);
const files = await samples();
if (all || only('--page')) await pagePath(id, files);
if (all || only('--sw')) await swPath(id, files);
if (all || only('--shot')) await shot(id);
