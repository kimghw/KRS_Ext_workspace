// 브라우저 엔진(doctext/browser.js)과 꾸러미 베끼기(tools/vendor.mjs).
//
// 실제 wasm(pdf.js·tesseract.js)은 여기서 돌리지 않는다 — node 에는 Worker·캔버스·createImageBitmap 이 없고, 브라우저 빌드 pdf.min.mjs 는
// node 에서 불러오는 것부터 거절한다. 꾸러미 확인(ready)은 가짜 fetch 로, withText 는 가짜 엔진으로, OCR 워커의 큐·IDLE·시간 초과는 가짜
// createWorker 와 짧은 시계로 본다. vendor.mjs 는 임시 폴더에 실제로 돌려 본다(node_modules 가 있어야 한다).
// 실제 엔진이 확장 안에서 도는지는 조정자가 CDP 로 본다 — doctext/README.md 의 실측 확인 목록.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VENDOR_URL, ready, resetReady, ocrImages, withText } from '../browser.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const file = (name, bytes, type) => ({ name, type, dataUrl: `data:${type};base64,${Buffer.from(bytes).toString('base64')}` });
const PDF = file('Receipt.pdf', '%PDF-1.7 가짜', 'application/pdf');
const PNG = file('image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), 'image/png');
const RECEIPT = '호텔명 SONO CALM GOYANG\n총계 USD 131.57\n총 금액 KRW 177,101 (USD 131.57)\n결제일 September 7, 2026';
const MANIFEST = { pdfjs: '6.4.299', tesseract: '7.0.0', core: '7.0.0', langs: ['kor', 'eng'], at: '2026-10-16T00:00:00.000Z' };
const NO_VENDOR = '꾸러미 없음 — 저장소 폴더에서 npm install (vendor/doctext)';
/** 가짜 fetch — 받은 주소를 세고 정해진 답을 준다. 답이 함수면 부른다(던지게 할 때). */
const fetching = (answer) => {
  const fn = async (url) => { fn.calls.push(url); return typeof answer === 'function' ? answer(url) : answer; };
  fn.calls = [];
  return fn;
};
const okJson = (body) => ({ ok: true, json: async () => body });
/** 부르면 안 되는 엔진. */
const never = (what) => async () => assert.fail(`${what} 을(를) 부르면 안 된다`);
const engines = (over) => ({ pdf: never('pdf'), ocr: never('ocr'), render: never('render'), ...over });
const bytesOf = (n) => new Uint8Array(n).fill(7);

console.log('꾸러미 위치');
t('VENDOR_URL 은 확장 루트의 vendor/doctext/ — 끝에 / 가 있고, node 에서는 file: 이다', () => {
  assert.ok(VENDOR_URL.endsWith('/vendor/doctext/'), VENDOR_URL);
  assert.equal(VENDOR_URL, new URL('vendor/doctext/', pathToFileURL(ROOT)).href);
});

console.log('꾸러미 확인 (ready)');
await ta('manifest.json 이 오면 있음 — version 에 manifest 를 그대로 담는다', async () => {
  resetReady();
  const fetchFn = fetching(okJson(MANIFEST));
  assert.deepEqual(await ready({ fetchFn }), { ok: true, reason: '', version: MANIFEST });
  assert.deepEqual(fetchFn.calls, [`${VENDOR_URL}manifest.json`]);
});
await ta('없으면(404·fetch 가 던짐) npm install 을 가리키는 까닭 — 던지지 않는다', async () => {
  resetReady();
  assert.deepEqual(await ready({ fetchFn: fetching({ ok: false, status: 404 }) }), { ok: false, reason: NO_VENDOR });
  resetReady();
  assert.deepEqual(await ready({ fetchFn: fetching(() => { throw new Error('Failed to fetch'); }) }), { ok: false, reason: NO_VENDOR });
});
await ta('manifest 가 깨졌으면(JSON 이 아니거나 모양이 다르면) 깨졌다고 한다', async () => {
  resetReady();
  const bad = await ready({ fetchFn: fetching({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } }) });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /^꾸러미가 깨짐\(Unexpected token <\) — 저장소 폴더에서 npm install/);
  resetReady();
  const odd = await ready({ fetchFn: fetching(okJson({ hello: 1 })) });
  assert.match(odd.reason, /^꾸러미가 깨짐\(manifest\.json 의 모양이 다름\)/);
});
await ta('결과는 외워 둔다 — 두 번째부터는 fetch 를 부르지 않고, 동시에 둘이 불러도 한 번만 받는다. resetReady 로 잊는다', async () => {
  resetReady();
  const first = fetching(okJson(MANIFEST));
  const second = fetching({ ok: false });
  const [a, b] = await Promise.all([ready({ fetchFn: first }), ready({ fetchFn: second })]);
  assert.deepEqual([a.ok, b.ok, first.calls.length, second.calls.length], [true, true, 1, 0]);
  assert.equal((await ready({ fetchFn: second })).ok, true);
  assert.equal(second.calls.length, 0);
  resetReady();
  assert.equal((await ready({ fetchFn: second })).ok, false);
  assert.equal(second.calls.length, 1);
});
await ta('fetch 가 없는 환경이면 확인할 수 없다고 하고, node 의 기본 fetch 는 file: 을 못 받아 없음이 된다', async () => {
  resetReady();
  assert.match((await ready({ fetchFn: null })).reason, /fetch 없음/);
  resetReady();
  assert.equal((await ready()).ok, false);
});

console.log('withText');
await ta('꾸러미가 없으면 던지지 않고 파일째 — 다리(host.mjs extractText)와 같은 건너뜀 문구, 엔진은 부르지 않는다', async () => {
  resetReady();
  await ready({ fetchFn: fetching({ ok: false }) });
  const out = await withText('출장 정보', [PDF, PNG], engines());
  assert.deepEqual(out, { input: '출장 정보', files: [PDF, PNG], read: [`글자 뽑기를 건너뜀(${NO_VENDOR}) — 파일째 보냄`], lean: false });
});
await ta('꾸러미가 있으면 core 로 간다 — 글자 층이 있는 PDF 는 글자만 보내고, 그림은 OCR 글자와 같이 보낸다', async () => {
  resetReady();
  await ready({ fetchFn: fetching(okJson(MANIFEST)) });
  const seen = [];
  const out = await withText('출장 정보', [PDF, PNG], engines({
    pdf: async () => ({ pages: [RECEIPT], total: 1 }),
    ocr: async (images) => { seen.push(images); return [{ text: RECEIPT, confidence: 84 }]; },
  }));
  assert.deepEqual([out.files, out.lean], [[PNG], false]);
  assert.ok(out.input.includes('문서(파일 이름: Receipt.pdf)는 첨부하지 않았습니다'));
  assert.ok(out.input.includes('아래는 첨부한 문서(파일 이름: image.png)의 그림에서 OCR 로 먼저 읽은 글자입니다'));
  assert.match(out.read[0], /^Receipt\.pdf: 글자 층 \d+자\(1쪽\) — 글자만 보냄$/);
  assert.match(out.read[1], /^image\.png: OCR \d+자\(믿음 84\) — OCR 글자와 그림을 같이 보냄$/);
  assert.deepEqual([...seen[0][0]], [0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
});
await ta('엔진을 일부만 끼워도 나머지는 브라우저 엔진으로 채운다 — core 가 던지지 않는다', async () => {
  const out = await withText('출장 정보', [], { pdf: never('pdf') });
  assert.deepEqual(out, { input: '출장 정보', files: [], read: [], lean: false });
});

console.log('OCR 워커 (가짜 createWorker)');
/** 가짜 tesseract — 띄움·읽힘·내림을 차례로 적는다. recognize 를 주면 그것으로 답한다. */
function fakeTesseract({ recognize, startMs = 0 } = {}) {
  const log = [];
  const workers = [];
  const createWorker = async (langs, oem, opts) => {
    log.push('create');
    if (startMs) await sleep(startMs);
    const w = {
      langs, oem, opts,
      recognize: async (png) => { log.push(`recognize:${png.length}`); return recognize ? recognize(png) : { data: { text: `\n\n글자 ${png.length}\n\n\n끝      칸\n`, confidence: 84.6 } }; },
      terminate: async () => { log.push('terminate'); },
    };
    workers.push(w);
    return w;
  };
  return { createWorker, log, workers };
}
const asIs = async (bytes) => bytes;
/** 짧은 시계 — IDLE 뒤 내리는 것까지 기다려 다음 검사에 워커가 남지 않게 한다. */
const quick = { prep: asIs, idleMs: 30, limitMs: 500 };
const settle = () => sleep(80);

await ta('tesseract.js 의 CDN 기본값을 전부 덮는다 — 확장 안의 워커·코어 파일·학습 데이터, blob 워커 없이, 캐시 없이, 빈 errorHandler', async () => {
  const fake = fakeTesseract();
  await ocrImages([bytesOf(3)], { ...quick, createWorker: fake.createWorker });
  const [w] = fake.workers;
  assert.deepEqual([w.langs, w.oem], [['kor', 'eng'], 1]);
  assert.equal(w.opts.workerPath, `${VENDOR_URL}tesseract/worker.min.js`);
  assert.equal(w.opts.corePath, `${VENDOR_URL}tesseract/tesseract-core-simd-lstm.wasm.js`);
  assert.equal(w.opts.langPath, `${VENDOR_URL}tessdata`);
  assert.deepEqual([w.opts.workerBlobURL, w.opts.gzip, w.opts.cacheMethod, typeof w.opts.errorHandler], [false, true, 'none', 'function']);
  assert.ok(!JSON.stringify(w.opts).includes('jsdelivr'));
  await settle();
});
await ta('글자는 다듬고(tidy) 믿음은 반올림한다 — 그림마다 하나씩, 차례대로', async () => {
  const fake = fakeTesseract();
  const out = await ocrImages([bytesOf(3), bytesOf(5)], { ...quick, createWorker: fake.createWorker });
  assert.deepEqual(out, [{ text: '글자 3\n끝   칸', confidence: 85 }, { text: '글자 5\n끝   칸', confidence: 85 }]);
  assert.deepEqual(fake.log, ['create', 'recognize:3', 'recognize:5']);
  await settle();
});
await ta('그림은 먼저 전부 다듬는다 — 못 푸는 그림이면 엔진을 띄우기 전에 던진다', async () => {
  const fake = fakeTesseract();
  const prepped = [];
  const prep = async (bytes) => { if (bytes.length === 5) throw new Error('풀 수 없는 그림(decode)'); prepped.push(bytes.length); return bytes; };
  await assert.rejects(ocrImages([bytesOf(3), bytesOf(5), bytesOf(7)], { ...quick, prep, createWorker: fake.createWorker }), /풀 수 없는 그림/);
  assert.deepEqual([prepped, fake.log], [[3], []]);
});
await ta('워커는 페이지에 하나 — 동시에 두 번 불러도 한 번 띄우고, 약속 사슬로 차례로 읽힌다', async () => {
  const fake = fakeTesseract({ recognize: async (png) => { await sleep(5); return { data: { text: `t${png.length}`, confidence: 90 } }; } });
  const deps = { ...quick, createWorker: fake.createWorker };
  const [a, b] = await Promise.all([ocrImages([bytesOf(1), bytesOf(2)], deps), ocrImages([bytesOf(3)], deps)]);
  assert.deepEqual([a.map((r) => r.text), b.map((r) => r.text)], [['t1', 't2'], ['t3']]);
  assert.deepEqual(fake.log, ['create', 'recognize:1', 'recognize:2', 'recognize:3']);
  await settle();
});
await ta('IDLE 동안 일이 없으면 내린다 — 다음 부름은 새로 띄운다', async () => {
  const fake = fakeTesseract();
  const deps = { ...quick, createWorker: fake.createWorker };
  await ocrImages([bytesOf(1)], deps);
  assert.deepEqual(fake.log, ['create', 'recognize:1']);
  await sleep(10);
  await ocrImages([bytesOf(2)], deps);
  assert.deepEqual(fake.log, ['create', 'recognize:1', 'recognize:2'], '잇달아 부르면 그대로 쓴다');
  await settle();
  assert.deepEqual(fake.log.at(-1), 'terminate');
  await ocrImages([bytesOf(3)], deps);
  assert.deepEqual(fake.log.slice(-2), ['create', 'recognize:3']);
  assert.equal(fake.workers.length, 2);
  await settle();
});
await ta('한 번 부름이 OCR_LIMIT_MS 를 넘기면 거절하고 워커를 내린다 — 다음 부름은 새로 띄워 돈다', async () => {
  let hang = true;
  const fake = fakeTesseract({ recognize: (png) => (hang ? new Promise(() => {}) : Promise.resolve({ data: { text: `t${png.length}`, confidence: 70 } })) });
  const deps = { ...quick, limitMs: 30, createWorker: fake.createWorker };
  await assert.rejects(ocrImages([bytesOf(1), bytesOf(2)], deps), /^Error: OCR 이 0\.03초 안에 끝나지 않았습니다$/);
  await sleep(5);
  assert.deepEqual(fake.log, ['create', 'recognize:1', 'terminate']);
  hang = false;
  assert.deepEqual(await ocrImages([bytesOf(3)], deps), [{ text: 't3', confidence: 70 }]);
  assert.deepEqual(fake.log.slice(-2), ['create', 'recognize:3']);
  await settle();
});
await ta('엔진이 아직 뜨는 중에 시간이 다 되면, 뜬 뒤에 내린다', async () => {
  const fake = fakeTesseract({ startMs: 60 });
  await assert.rejects(ocrImages([bytesOf(1)], { ...quick, limitMs: 20, createWorker: fake.createWorker }), /끝나지 않았습니다/);
  assert.deepEqual(fake.log, ['create']);
  await sleep(80);
  assert.deepEqual(fake.log, ['create', 'terminate']);
});
await ta('띄우지 못하면(코어·학습 데이터가 없다) 그 까닭으로 거절하고 잊는다 — 다음 부름이 다시 띄워 본다', async () => {
  let fail = true;
  const fake = fakeTesseract();
  const createWorker = async (...a) => { if (fail) { fake.log.push('create-fail'); throw new Error('Network error while fetching kor.traineddata.gz'); } return fake.createWorker(...a); };
  const deps = { ...quick, createWorker };
  await assert.rejects(ocrImages([bytesOf(1)], deps), /kor\.traineddata\.gz/);
  fail = false;
  assert.deepEqual(await ocrImages([bytesOf(2)], deps), [{ text: '글자 2\n끝   칸', confidence: 85 }]);
  assert.deepEqual(fake.log, ['create-fail', 'create', 'recognize:2']);
  await settle();
});
await ta('앞 부름이 거절돼도 뒤에 줄 선 부름은 돈다', async () => {
  const fake = fakeTesseract({ recognize: (png) => (png.length === 1 ? Promise.reject(new Error('엔진 오류')) : Promise.resolve({ data: { text: 'ok', confidence: 60 } })) });
  const deps = { ...quick, createWorker: fake.createWorker };
  const [a, b] = await Promise.allSettled([ocrImages([bytesOf(1)], deps), ocrImages([bytesOf(2)], deps)]);
  assert.equal(a.status, 'rejected');
  assert.deepEqual(b, { status: 'fulfilled', value: [{ text: 'ok', confidence: 60 }] });
  // 실패한 워커는 내리고 다음 부름이 새로 띄운다.
  assert.deepEqual(fake.log, ['create', 'recognize:1', 'terminate', 'create', 'recognize:2']);
  await settle();
});

console.log('tools/vendor.mjs');
const SCRIPT = path.join(ROOT, 'tools', 'vendor.mjs');
const vendor = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'krs-vendor-'));
const out = path.join(tmp, 'doctext');
const version = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')).version;
const count = (dir) => fs.readdirSync(dir).length;
try {
  await ta('--out 으로 임시 폴더에 베끼면 manifest.json 이 생긴다 — 버전은 node_modules 의 package.json 에서', async () => {
    const r = vendor('--out', out);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /베낌 \d+개 · 그대로 0개 · 합계 \d+개 \d+\.\dMB/);
    const m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(m, { pdfjs: version('pdfjs-dist'), tesseract: version('tesseract.js'), core: version('tesseract.js-core'), langs: ['kor', 'eng'], at: m.at });
    assert.match(m.at, /^\d{4}-\d{2}-\d{2}T/);
  });
  await ta('계약의 목록 그대로 — pdf.js(모듈·워커·cmaps·표준 글꼴·wasm 셋), tesseract(모듈·워커·SIMD LSTM 코어), 학습 데이터 둘. 대체본은 없다', async () => {
    for (const f of ['pdfjs/pdf.min.mjs', 'pdfjs/pdf.worker.min.mjs', 'pdfjs/LICENSE', 'pdfjs/wasm/openjpeg.wasm', 'pdfjs/wasm/jbig2.wasm', 'pdfjs/wasm/qcms_bg.wasm',
      'tesseract/tesseract.esm.min.js', 'tesseract/worker.min.js', 'tesseract/tesseract-core-simd-lstm.wasm.js', 'tesseract/LICENSE.md', 'tesseract/tesseract-core.LICENSE',
      'tessdata/kor.traineddata.gz', 'tessdata/eng.traineddata.gz']) assert.ok(fs.existsSync(path.join(out, f)), f);
    assert.equal(count(path.join(out, 'pdfjs', 'cmaps')), count(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'cmaps')));
    assert.equal(count(path.join(out, 'pdfjs', 'standard_fonts')), count(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts')));
    assert.ok(!fs.readdirSync(path.join(out, 'pdfjs', 'wasm')).some((n) => /quickjs|nowasm/.test(n)));
    assert.deepEqual(fs.readdirSync(path.join(out, 'tesseract')).filter((n) => n.includes('core') && !n.includes('LICENSE')), ['tesseract-core-simd-lstm.wasm.js']);
    assert.equal(fs.statSync(path.join(out, 'tessdata', 'kor.traineddata.gz')).size, fs.statSync(path.join(ROOT, 'node_modules', '@tesseract.js-data', 'kor', '4.0.0_best_int', 'kor.traineddata.gz')).size);
  });
  await ta('멱등 — 다시 돌리면 베끼는 것이 없고 manifest 의 at 도 그대로. --check 는 0', async () => {
    const before = fs.readFileSync(path.join(out, 'manifest.json'), 'utf8');
    const r = vendor('--out', out);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /베낌 0개 · 그대로 \d+개/);
    assert.equal(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'), before);
    const c = vendor('--check', '--out', out);
    assert.equal(c.status, 0, c.stdout);
    assert.match(c.stdout, /^\[OK\] /);
  });
  await ta('파일이 빠지면 --check 가 1 로 짚고, 다시 돌리면 그 하나만 베낀다. 목록에 없는 파일은 지운다', async () => {
    fs.rmSync(path.join(out, 'tessdata', 'kor.traineddata.gz'));
    fs.writeFileSync(path.join(out, 'pdfjs', 'stale.txt'), '옛 것');
    const c = vendor('--check', '--out', out);
    assert.equal(c.status, 1);
    assert.match(c.stdout, /없거나 크기가 다른 파일 1개: tessdata\/kor\.traineddata\.gz|kor\.traineddata\.gz/);
    const r = vendor('--out', out);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /베낌 1개 · 그대로 \d+개 · 지움 1개/);
    assert.ok(!fs.existsSync(path.join(out, 'pdfjs', 'stale.txt')));
    assert.equal(vendor('--check', '--out', out).status, 0);
  });
  await ta('버전이 다르면 --check 가 1', async () => {
    const file = path.join(out, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...m, pdfjs: '0.0.1' }));
    const c = vendor('--check', '--out', out);
    assert.equal(c.status, 1);
    assert.match(c.stdout, /버전이 다르다 — 꾸러미 pdf\.js 0\.0\.1/);
    assert.equal(vendor('--out', out).status, 0, '다시 돌리면 manifest 를 고친다');
    assert.equal(vendor('--check', '--out', out).status, 0);
  });
  await ta('node_modules 가 없으면 한 줄 까닭과 종료 코드 1', async () => {
    const empty = path.join(tmp, 'nomods');
    fs.mkdirSync(empty);
    const r = vendor('--out', path.join(tmp, 'x'), '--modules', empty);
    assert.equal(r.status, 1);
    assert.equal(r.stderr.trim().split('\n').length, 1);
    assert.match(r.stderr, /pdfjs-dist.*npm install/);
    assert.ok(!fs.existsSync(path.join(tmp, 'x')));
  });
  await ta('꾸러미가 아직 없으면 --check 가 1 이고, 이 스크립트가 만들지 않은 폴더에는 쓰지 않는다', async () => {
    assert.equal(vendor('--check', '--out', path.join(tmp, 'none')).status, 1);
    const mine = path.join(tmp, 'mine');
    fs.mkdirSync(mine);
    fs.writeFileSync(path.join(mine, 'keep.txt'), '내 것');
    const r = vendor('--out', mine);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /manifest\.json 이 없다/);
    assert.ok(fs.existsSync(path.join(mine, 'keep.txt')));
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n통과 ${pass}건`);
