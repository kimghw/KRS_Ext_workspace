// node_modules 의 pdf.js·tesseract.js·학습 데이터를 vendor/doctext/ 로 베낀다 — 브라우저(API 키 길)에서 첨부의 글자를 먼저 뽑는 꾸러미(doctext/browser.js 가 쓴다).
//
//   node tools/vendor.mjs                  베낀다(멱등 — 같은 파일은 다시 쓰지 않고, 목록에 없는 파일은 지운다). npm install 뒤(postinstall)에 돈다
//   node tools/vendor.mjs --check          있는지·버전이 node_modules 와 같은지만 본다 — 어긋나면 종료 코드 1
//   node tools/vendor.mjs --out <dir>      다른 곳에 베낀다(테스트)
//   node tools/vendor.mjs --modules <dir>  다른 node_modules 에서 베낀다(테스트 — 꾸러미가 없는 경우를 흉내 낸다)
//
// 왜 베끼는가: 확장은 번들러 없는 순수 ES 모듈이라 node_modules 를 그대로 읽지 못하고, 확장 폴더 밖의 파일은 chrome-extension:// 로 닿지 않는다.
// vendor/doctext 는 .gitignore 에 있다(14MB 쯤) — 저장소에는 버전만 적히고(package.json), 파일은 PC 마다 npm install 이 만든다.
// quickjs·nowasm 대체본과 SIMD 없는 코어는 베끼지 않는다 — 크롬은 SIMD 를 다 지원하고, 대체본은 CSP 가 막는 eval 을 쓴다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const LANGS = ['kor', 'eng'];
/** pdf.js 의 wasm 폴더에서 가져올 것 — 그림 압축(JPX·JBIG2)과 색 공간(qcms). 라이선스 글은 다 가져온다. */
const PDFJS_WASM = new Set(['openjpeg.wasm', 'jbig2.wasm', 'qcms_bg.wasm']);

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : ''; };
const OUT = path.resolve(ROOT, option('--out') || path.join('vendor', 'doctext'));
const MODULES = path.resolve(ROOT, option('--modules') || 'node_modules');
const CHECK = args.includes('--check');
const rel = (p) => path.relative(ROOT, p).replaceAll(path.sep, '/') || '.';
const mb = (n) => `${(n / 1048576).toFixed(1)}MB`;

/** node_modules 의 꾸러미 — 폴더와 버전. 없으면 null. 다섯 다 package.json 의 직접 의존이라 맨 위에 있다. */
function pkg(name) {
  const dir = path.join(MODULES, ...name.split('/'));
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) return null;
  return { dir, version: JSON.parse(fs.readFileSync(file, 'utf8')).version };
}

/** 베낄 파일의 목록 — { from, to }(둘 다 절대 경로). 폴더는 안의 파일을 다 가져온다(cmaps·standard_fonts 는 pdf.js 가 이름으로 찾는다). */
function plan(p) {
  const list = [];
  const add = (from, to) => list.push({ from, to: path.join(OUT, to) });
  const dir = (from, to, keep = () => true) => {
    for (const name of fs.readdirSync(from).sort()) if (keep(name) && fs.statSync(path.join(from, name)).isFile()) add(path.join(from, name), path.join(to, name));
  };
  // pdf.js — 주 스레드 모듈·워커·글자 표(cmaps)·표준 글꼴·wasm.
  add(path.join(p.pdfjs.dir, 'build', 'pdf.min.mjs'), 'pdfjs/pdf.min.mjs');
  add(path.join(p.pdfjs.dir, 'build', 'pdf.worker.min.mjs'), 'pdfjs/pdf.worker.min.mjs');
  add(path.join(p.pdfjs.dir, 'LICENSE'), 'pdfjs/LICENSE');
  dir(path.join(p.pdfjs.dir, 'cmaps'), 'pdfjs/cmaps');
  dir(path.join(p.pdfjs.dir, 'standard_fonts'), 'pdfjs/standard_fonts');
  dir(path.join(p.pdfjs.dir, 'wasm'), 'pdfjs/wasm', (name) => PDFJS_WASM.has(name) || name.startsWith('LICENSE'));
  // tesseract.js — ES 모듈·워커·코어(wasm 이 js 안에 base64 로 들어 있다 — corePath 로 파일을 바로 준다)·라이선스.
  add(path.join(p.tesseract.dir, 'dist', 'tesseract.esm.min.js'), 'tesseract/tesseract.esm.min.js');
  add(path.join(p.tesseract.dir, 'dist', 'worker.min.js'), 'tesseract/worker.min.js');
  add(path.join(p.tesseract.dir, 'dist', 'tesseract.min.js.LICENSE.txt'), 'tesseract/tesseract.min.js.LICENSE.txt');
  add(path.join(p.tesseract.dir, 'dist', 'worker.min.js.LICENSE.txt'), 'tesseract/worker.min.js.LICENSE.txt');
  add(path.join(p.tesseract.dir, 'LICENSE.md'), 'tesseract/LICENSE.md');
  add(path.join(p.core.dir, 'tesseract-core-simd-lstm.wasm.js'), 'tesseract/tesseract-core-simd-lstm.wasm.js');
  add(path.join(p.core.dir, 'LICENSE'), 'tesseract/tesseract-core.LICENSE');
  // 학습 데이터 — LSTM 만 쓰는 작은 것(best_int). 압축한 채로 두고 워커가 푼다(gzip:true).
  for (const lang of LANGS) add(path.join(p.data[lang].dir, '4.0.0_best_int', `${lang}.traineddata.gz`), `tessdata/${lang}.traineddata.gz`);
  return list;
}

const manifestOf = (p) => ({ pdfjs: p.pdfjs.version, tesseract: p.tesseract.version, core: p.core.version, langs: LANGS });
const MANIFEST = path.join(OUT, 'manifest.json');
const readManifest = () => { try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return null; } };
const sameVersion = (a, b) => !!a && a.pdfjs === b.pdfjs && a.tesseract === b.tesseract && a.core === b.core && JSON.stringify(a.langs) === JSON.stringify(b.langs);

/** 두 파일이 같은가 — 크기가 같을 때만 바이트를 본다(가장 큰 것이 4MB 라 그냥 읽는다). */
function same(from, to) {
  let st;
  try { st = fs.statSync(to); } catch { return false; }
  if (st.size !== fs.statSync(from).size) return false;
  return fs.readFileSync(from).equals(fs.readFileSync(to));
}

/** 폴더 안의 파일 전부(절대 경로). */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function check(p, list) {
  const want = manifestOf(p);
  const have = readManifest();
  if (!have) { console.log(`[--] ${rel(OUT)} 가 없다 — node tools/vendor.mjs (npm install 이 돌린다)`); return 1; }
  const off = list.filter((f) => { try { return fs.statSync(f.to).size !== fs.statSync(f.from).size; } catch { return true; } });
  const label = `pdf.js ${want.pdfjs} · tesseract.js ${want.tesseract} · core ${want.core} · ${want.langs.join('·')}`;
  if (sameVersion(have, want) && !off.length) { console.log(`[OK] ${rel(OUT)} — ${label} · ${list.length}개 파일 (${have.at || '언제 베꼈는지 없음'})`); return 0; }
  if (!sameVersion(have, want)) console.log(`[--] 버전이 다르다 — 꾸러미 pdf.js ${have.pdfjs} · tesseract.js ${have.tesseract} · core ${have.core} · ${(have.langs || []).join('·')} / node_modules ${label}`);
  if (off.length) console.log(`[--] 없거나 크기가 다른 파일 ${off.length}개: ${off.slice(0, 3).map((f) => rel(f.to)).join(', ')}${off.length > 3 ? ' …' : ''}`);
  console.log('다시 베낀다: node tools/vendor.mjs');
  return 1;
}

function copy(p, list) {
  // 우리가 만든 폴더(manifest.json 이 있다)나 빈 폴더에만 쓴다 — 목록에 없는 파일을 지우므로 남의 폴더를 쓸어 버리지 않게.
  if (fs.existsSync(OUT) && !readManifest() && fs.readdirSync(OUT).length) {
    console.error(`${rel(OUT)} 은 비어 있지 않은데 manifest.json 이 없다 — 이 스크립트가 만든 폴더가 아니라 쓰지 않는다`);
    return 1;
  }
  let copied = 0;
  let kept = 0;
  let bytes = 0;
  for (const f of list) {
    bytes += fs.statSync(f.from).size;
    if (same(f.from, f.to)) { kept++; continue; }
    fs.mkdirSync(path.dirname(f.to), { recursive: true });
    fs.copyFileSync(f.from, f.to);
    copied++;
  }
  // 전에 베낀 것 가운데 이제 목록에 없는 파일(버전이 바뀌어 이름이 달라진 글꼴 등)은 지운다.
  const wanted = new Set(list.map((f) => f.to));
  const stale = walk(OUT).filter((f) => f !== MANIFEST && !wanted.has(f));
  for (const f of stale) fs.rmSync(f);
  const want = manifestOf(p);
  const have = readManifest();
  // 바뀐 것이 없으면 manifest 도 두어(at 이 그대로) 두 번 돌려도 같은 결과다.
  if (copied || stale.length || !sameVersion(have, want)) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(MANIFEST, `${JSON.stringify({ ...want, at: new Date().toISOString() }, null, 2)}\n`);
  }
  console.log(`${rel(OUT)}: 베낌 ${copied}개 · 그대로 ${kept}개${stale.length ? ` · 지움 ${stale.length}개` : ''} · 합계 ${list.length}개 ${mb(bytes)} — pdf.js ${want.pdfjs} · tesseract.js ${want.tesseract} · core ${want.core} · ${LANGS.join('·')}`);
  return 0;
}

const p = { pdfjs: pkg('pdfjs-dist'), tesseract: pkg('tesseract.js'), core: pkg('tesseract.js-core'), data: Object.fromEntries(LANGS.map((l) => [l, pkg(`@tesseract.js-data/${l}`)])) };
const missing = [['pdfjs-dist', p.pdfjs], ['tesseract.js', p.tesseract], ['tesseract.js-core', p.core], ...LANGS.map((l) => [`@tesseract.js-data/${l}`, p.data[l]])].filter(([, v]) => !v).map(([n]) => n);
if (missing.length) {
  console.error(`${rel(MODULES)} 에 ${missing.join(', ')} 이(가) 없습니다 — 저장소 폴더에서 npm install`);
  process.exit(1);
}
const list = plan(p);
process.exit(CHECK ? check(p, list) : copy(p, list));
