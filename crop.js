// PDF 부분 캡처 창(crop.html) — 패널이 찍어 둔 PDF 화면(chrome.storage.session 의 krsCrop_shot_<id>)을 띄우고, 사람이 끌어서 고른 사각형을
// 원래 해상도로 잘라 PNG 로 돌려준다(krsCrop_done_<id>). 그만두면 { cancel: true }. 창은 스스로 닫는다. 받는 쪽은 src/pagecap.js cropFrontPdf.
// 2026-11-20 사용자 지정: "웹에서 pdf 를 볼때 그거 부분 캡쳐할때.. 부분캡쳐할 수 있게 해줘".

const KEY = 'krsCrop_';
const id = new URLSearchParams(location.search).get('id') || '';
const $ = (s) => document.getElementById(s);
const img = $('shot');
const stage = $('stage');
const sel = $('sel');
const shade = $('shade');
const go = $('go');
let box = null;     // 고른 사각형 — 화면에 보이는 크기의 좌표 {x, y, w, h}
let from = null;    // 끄는 중이면 시작점

async function done(out) {
  try {
    await chrome.storage.session.set({ [`${KEY}done_${id}`]: out });
  } finally {
    window.close();
  }
}

function paint() {
  const on = !!box && box.w > 4 && box.h > 4;
  sel.style.display = on ? 'block' : 'none';
  shade.style.display = on ? 'none' : 'block';
  go.disabled = !on;
  if (on) Object.assign(sel.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
}

function at(e) {
  const r = img.getBoundingClientRect();
  return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) };
}

stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  from = at(e);
  box = { ...from, w: 0, h: 0 };
  stage.setPointerCapture(e.pointerId);
  paint();
});
stage.addEventListener('pointermove', (e) => {
  if (!from) return;
  const p = at(e);
  box = { x: Math.min(from.x, p.x), y: Math.min(from.y, p.y), w: Math.abs(p.x - from.x), h: Math.abs(p.y - from.y) };
  paint();
});
stage.addEventListener('pointerup', () => { from = null; });

/** 고른 사각형을 찍은 그림의 원래 해상도로 잘라 PNG dataUrl 로. */
function cropped() {
  const k = img.naturalWidth / img.getBoundingClientRect().width;
  const [sx, sy, sw, sh] = [box.x, box.y, box.w, box.h].map((v) => Math.round(v * k));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/png');
}

go.addEventListener('click', () => { if (!go.disabled) done({ dataUrl: cropped() }); });
$('no').addEventListener('click', () => done({ cancel: true }));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') done({ cancel: true });
  if (e.key === 'Enter' && !go.disabled) done({ dataUrl: cropped() });
});

(async () => {
  const got = (await chrome.storage.session.get(`${KEY}shot_${id}`))?.[`${KEY}shot_${id}`];
  if (!got?.dataUrl) {
    stage.outerHTML = '<p class="empty">찍은 PDF 화면을 찾지 못했습니다 — 창을 닫고 패널에서 다시 눌러 주세요.</p>';
    return;
  }
  if (got.title) document.title = `PDF 부분 캡처 — ${got.title}`;
  img.src = got.dataUrl;
  paint();
})();
