// R&D 더하기·변경사항 카드(rndgen/panel.js) — jsdom 에 host div 둘만 두고 rnd 손잡이·source·llm·yaml·store·ai·download·readAsset 을 모두 흉내 낸다.
// 날짜는 2026-10-16 으로 못 박는다. 어디에도 보내지 않는다(chrome·fetch 없음). 과제·사람 이름은 지어낸 것.
//
// 본다: wire 가 DOM 을 만들고 onView/onAdd 를 등록 · openAdd 가 setOverlay('add', fn) 를 부르고 대상 n 을 고름 · YAML 파일은 intake(source 'file') 로 바로 ·
// 문서 → readDocument → askExtract → checkExtracted → finalizeExtracted → 미리보기(별칭·예산 표·경고) · Claude 없음 · 다시 뽑기(같은 재료·다른 stage) ·
// 넣기(별칭 검사·intake source 'extract'·setAlias·closeAdd·pick) · 저장(download KR_….yaml) · 직접 적기 → addManually · 닫기 → setOverlay(null) ·
// 모든 차년도(차년도마다 차례로 묻기 · 몇 번은 대상 과제의 연구기간과 답의 연차범위 · 실패한 차년도만 다시 · 한 번의 intake · 고친 칸 · zip 저장 · 과제가 다른 차년도) ·
// 변경사항 카드 보임 조건 · 기준 줄 · YAML 고치기 흐름(bookToSnapshot 또는 store.get → askRevise → nextRev → finalizeRevised → 차이·변경이력) ·
// 반영(intake source 'revise') · 활동 로그 한 줄씩 · aria-busy 와 지난 초 · 늦게 온 답 버림 · 끌어 놓기의 전파 · 글은 textContent 로만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createRndGenPanel } from '../panel.js';
import { yearNo, yearsOf } from '../../src/rnd.js';
import { readZip } from '../../src/zip.js';

const TODAY = '2026-10-16';
const NEED_AI = 'Claude 연결(로컬 CLI 또는 API 키)이 필요합니다 — 설정 → LLM';
const ASKING_EXTRACT = 'Claude 에게 묻는 중 — 큰 문서는 몇 분 걸릴 수 있습니다(최대 10분)';
const LOSSY_BASE = '기준: 장부로 지음(손실 있음) — 원문 YAML 을 넣어 두면 정확합니다';
const P1_NAME = '시험용 직류 차단기 개발';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, what = '') => {
  for (let i = 0; i < 300 && !ok(); i++) await wait(5);
  assert.ok(ok(), `기다렸지만 되지 않았습니다${what ? `: ${what}` : ''}`);
};
const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };

/* ---------------------------------------------------------- 흉내 */

const makeBook = () => ({
  projects: [
    { id: 'p1', name: P1_NAME, alias: 'SSCB', code: 'RS-2026-00000001', lead: '홍길동', start: '2025-04-01', end: '2028-12-31', calendar: true, note: '', refs: {}, years: {} },
    { id: 'p2', name: '시험용 연료전지 과제', alias: 'PEMFC', code: 'RS-2026-00000002', lead: '이몽룡', start: '2026-01-01', end: '2027-12-31', calendar: true, note: '', refs: {}, years: {} },
  ],
  current: { project: 'p1', year: {} },
});

/** 흉내 YAML 은 JSON 이다 — 첫 키 앞의 # 줄(머리 주석)은 떼고 푼다. */
const parse = (text) => {
  try {
    return { ok: true, obj: JSON.parse(String(text).split('\n').filter((l) => !l.startsWith('#')).join('\n')), error: '' };
  } catch (e) {
    return { ok: false, obj: null, error: String(e.message).split('\n')[0] };
  }
};
const snapText = (meta, extra = {}) => JSON.stringify({ meta, 예산: { 단위: '천원', 비목별: [{ 연차: meta.차년도 || '2차년도', 직접비: { 연구재료비: 12000 } }] }, ...extra });
const kindByName = (name) => {
  const ext = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  if (ext === 'pdf') return 'pdf';
  if (['hwpx', 'docx', 'xlsx', 'pptx'].includes(ext)) return 'office';
  if (ext === 'txt' || ext === 'md') return 'text';
  if (ext === 'hwp') return 'hwp';
  return '';
};
const material = (name, extra = {}) => ({
  name, kind: 'pdf', total: 40, picked: [1, 2, 3, 12], text: '— 1쪽 —\n표지', chars: 1200,
  file: { name, type: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA' }, attach: 'slice',
  read: `${name}: 40쪽 가운데 4쪽 · 글자 1,200자 · 그 쪽들을 작은 PDF 로 붙임(0.1MB)`, warnings: ['12쪽 표가 그림입니다'], ...extra,
});
const fakeFile = (name, { type = '', text = 'x', size } = {}) => {
  const bytes = new TextEncoder().encode(text);
  return { name, type, size: size ?? bytes.length, text: async () => text, arrayBuffer: async () => bytes.buffer.slice(0) };
};

/**
 * 패널 하나와 그 흉내들. calls 는 [이름, ...인자] 를 부른 차례대로 — 차례 검사에 쓴다.
 * over: { ai, entries(store), extract(answer fn), revise(answer fn), intake(fn), check(fn), now }
 */
function setup(over = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="rnd" class="rnd"><div id="rdgAdd" class="rdg hidden"></div><div id="rdgRevise" class="rdg hidden"></div></section></body>', { url: 'https://example.org/' });
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);
  const book = over.book || makeBook();
  const calls = [];
  const rec = (name, ...args) => { calls.push([name, ...args]); };
  const named = (name) => calls.filter((c) => c[0] === name);
  const logs = [];
  let aiValue = over.ai === undefined ? { cli: true } : over.ai;
  let overlay = null;
  let overlayClose = null;
  const hooks = { view: null, add: null };
  const entries = over.entries || {};
  let storeLoaded = false;
  const storeGate = over.storeGate || null;

  const rnd = {
    book: () => book,
    current: () => ({ project: book.projects[0], n: 2 }),
    view: () => ({ overlay }),
    onView: (fn) => { rec('onView'); hooks.view = fn; },
    onAdd: (fn) => { rec('onAdd'); hooks.add = fn; },
    setOverlay: (name, onClose) => { rec('setOverlay', name, typeof onClose); overlay = name; overlayClose = onClose || null; },
    addManually: () => { rec('addManually'); overlay = null; },
    intake: async (texts, meta) => {
      rec('intake', texts, meta);
      if (over.intake) return over.intake(texts, meta, book);
      const t = texts[0];
      const obj = parse(t.text).obj;
      let p = book.projects.find((x) => x.name === obj.meta.과제명);
      const created = !p;
      if (!p) { p = { id: 'p9', name: obj.meta.과제명, alias: '', code: obj.meta.연구개발과제번호 || '', start: '', end: '', calendar: false, years: {} }; book.projects.push(p); }
      const n = yearNo(obj.meta.차년도) || 1;
      return {
        ok: true, error: '', lines: [`연구개발계획서 스냅샷: ${created ? '과제 만듦' : '과제 찾음'}`],
        results: [{ name: t.name, kind: 'snapshot', label: '연구개발계획서 스냅샷', summary: `${created ? '과제 만듦' : '과제 찾음'}: ${p.alias || p.name} · ${n}차년도`, projectId: p.id, n, rev: obj.meta.rev || 'r0', applied: true }],
      };
    },
    pick: (id, n) => rec('pick', id, n),
    setAlias: (id, alias) => { rec('setAlias', id, alias); const p = book.projects.find((x) => x.id === id); if (p) p.alias = alias; return { ok: true, error: '' }; },
    readAsset: async (path) => `자산:${path}`,
    download: async (...a) => rec('rnd.download', ...a),
  };
  const source = {
    docKind: (name) => kindByName(name),
    unsupportedDocNote: (name) => {
      const k = kindByName(name);
      if (k === 'hwp') return '옛 한글(.hwp)은 뽑지 못합니다 — 한글에서 PDF 로 저장해 넣으세요(.hwpx 는 그대로 됩니다)';
      return k ? '' : '이 파일은 넣을 수 없습니다 — 넣을 수 있는 것: YAML(.yaml/.yml) · PDF · HWPX · DOCX · XLSX · TXT/MD';
    },
    readDocument: async (file, opts) => {
      rec('readDocument', file, opts);
      if (over.readDocument) return over.readDocument(file, opts);
      return material(file.name);
    },
  };
  const llm = {
    loadSkillDocs: async (readAsset) => { rec('loadSkillDocs', readAsset); return { fields: '필드 규칙', output: '출력 규칙' }; },
    askExtract: async (mat, ctx, opts) => {
      rec('askExtract', mat, ctx, opts);
      if (over.extract) return over.extract(mat, ctx, opts);
      return {
        data: { yaml: snapText({ 과제명: '시험용 신규 과제', 연구개발과제번호: 'RS-2026-00000009', 차년도: `${ctx.stage || 2}차년도` }), alias: 'NEWP', stage: ctx.stage || 2, warnings: '협약일을 못 찾음 / 3쪽 표가 흐림' },
        via: 'cli', costUsd: 0.4213, note: '', input: '입력',
      };
    },
    askRevise: async (args, opts) => {
      rec('askRevise', args, opts);
      if (over.revise) return over.revise(args, opts);
      const base = parse(args.baseYaml).obj;
      const after = { ...base, 예산: { 단위: '천원', 비목별: [{ 연차: '2차년도', 직접비: { 연구재료비: 15000 } }] } };
      return {
        data: { yaml: JSON.stringify(after), summary: '예산.비목별[2차년도].연구재료비 12,000 → 15,000', changes: [{ path: '예산.비목별[2차년도].직접비.연구재료비', before: '12000', after: '15000' }], warnings: '근거 공문 번호 없음' },
        via: 'api', costUsd: 0.1, note: '로컬 CLI 실패 → API 키', input: '입력',
      };
    },
  };
  const yaml = {
    parseYaml: async (text) => { rec('parseYaml', text); return parse(text); },
    checkExtracted: async (text, opts) => {
      rec('checkExtracted', text, opts);
      if (over.check) return over.check(text, opts);
      const p = parse(text);
      if (!p.ok || !p.obj?.meta?.과제명) return { ok: false, obj: p.obj, snap: null, problems: ['meta.과제명 이 없습니다'], warnings: [] };
      return { ok: true, obj: p.obj, snap: { project: { name: p.obj.meta.과제명, code: p.obj.meta.연구개발과제번호 || '' }, n: yearNo(p.obj.meta.차년도) }, problems: [], warnings: ['예산.비목별 에 간접비 행이 없습니다'] };
    },
    finalizeExtracted: async (text, opts) => {
      rec('finalizeExtracted', text, opts);
      const obj = parse(text).obj;
      obj.meta.차년도 = `${opts.stage}차년도`;
      obj.meta.rev ||= opts.rev || 'r0';
      obj.meta.source ||= opts.source;
      return { text: `# [${opts.stage}차년도 최초]\n# KRS WORKSPACE 가 사업계획서에서 뽑음 ${opts.today} · 원본: ${opts.source}\n${JSON.stringify(obj, null, 1)}`, obj };
    },
    finalizeRevised: async (text, opts) => {
      rec('finalizeRevised', text, opts);
      const obj = parse(text).obj;
      obj.meta.rev = opts.rev;
      return { text: `# [재생성 ${opts.rev}] KRS WORKSPACE 변경사항 반영 ${opts.today}\n# 변경분: ${opts.summary}\n${JSON.stringify(obj, null, 1)}`, obj };
    },
    nextRev: (...revs) => {
      rec('nextRev', ...revs);
      const ns = revs.map((r) => (typeof r === 'number' ? r : Number(String(r ?? '').match(/^r(\d+)$/)?.[1] ?? -1)));
      return `r${Math.max(0, ...ns) + 1}`;
    },
    summarizeSnapshot: (obj) => {
      rec('summarizeSnapshot', obj);
      return {
        name: obj.meta.과제명, code: obj.meta.연구개발과제번호 || '', lead: '성춘향', start: '2025-04-01', end: '2028-12-31', n: yearNo(obj.meta.차년도) || 1, rev: obj.meta.rev || 'r0',
        budget: [{ item: '연구재료비', thousand: '12,000' }, { item: '인건비', thousand: '30,000' }], totalThousand: '42,000', people: 2, goals: ['차단 시간 2ms'],
      };
    },
    diffYaml: async (before, after) => {
      rec('diffYaml', before, after);
      // 진짜 diffYaml 처럼 코드가 적은 meta.rev 도 차이로 나온다 — 패널은 그것을 목록에서 뺀다.
      const rev = before?.meta?.rev !== after?.meta?.rev ? [{ path: 'meta.rev', before: before?.meta?.rev ?? null, after: after?.meta?.rev ?? null, op: 'changed' }] : [];
      return [...rev, ...(JSON.stringify(before?.예산) === JSON.stringify(after?.예산) ? [] : [{ path: '예산.비목별[2차년도].직접비.연구재료비', before: 12000, after: 15000, op: 'changed' }])];
    },
    diffLines: (diff) => diff.map((d) => `${d.path}: ${d.before.toLocaleString('ko-KR')} → ${d.after.toLocaleString('ko-KR')}`),
    previewApply: (bk, obj, opts) => {
      rec('previewApply', bk, obj, opts);
      return { ok: true, error: '', result: null, projectId: 'p1', n: 2, changes: [{ date: TODAY, kind: '예산', item: '연구재료비', before: '12,000천원', after: '15,000천원', reason: '예산 조정' }], older: '', created: false };
    },
    stageCount: (obj) => {
      rec('stageCount', obj);
      const r = obj?.meta?.연차범위;
      return Array.isArray(r) ? r.length : 0;
    },
    bookToSnapshot: async (bk, project, n, opts) => {
      rec('bookToSnapshot', bk, project, n, opts);
      const obj = { meta: { 과제명: project.name, rev: 'r0', 차년도: `${n}차년도` }, 예산: { 단위: '천원', 비목별: [{ 연차: `${n}차년도`, 직접비: { 연구재료비: 12000 } }] } };
      return { text: `# [장부에서 지음] KRS WORKSPACE\n${JSON.stringify(obj)}`, obj, lossy: true };
    },
    fileName: (project, { rev = '' } = {}) => {
      const name = String(typeof project === 'string' ? project : project?.name).replace(/\s+/g, '_');
      return `KR_${name}${rev && rev !== 'r0' ? `_${rev}` : ''}.yaml`;
    },
  };
  const store = {
    load: async () => { rec('store.load'); if (storeGate) await storeGate.p; storeLoaded = true; return {}; },
    get: (id, n) => { rec('store.get', id, n); return storeLoaded ? entries[`${id}:${n}`] || null : null; },
    history: () => [],
  };
  const engines = { tag: '검사 엔진' };
  let clock = 1_000_000;
  const panel = createRndGenPanel({
    hosts: { add: $('rdgAdd'), revise: $('rdgRevise') }, rnd, source, llm, yaml, store,
    ai: () => aiValue, readAsset: rnd.readAsset, download: async (...a) => rec('download', ...a),
    today: () => TODAY, now: () => clock,
    logEvent: (...a) => logs.push(a), escapeHtml: (v) => String(v), flash: (btn, text) => rec('flash', btn.id, text),
    engines, tickMs: over.tickMs || 1000,
  });
  const fire = (node, type) => node.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
  const click = (id) => { const b = $(id); assert.ok(b, `#${id} 가 없습니다`); b.click(); };
  const pickFiles = (id, files) => {
    const input = $(id);
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    fire(input, 'change');
  };
  const drop = (node, files, type = 'drop') => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files, dropEffect: '' } });
    node.dispatchEvent(ev);
    return ev;
  };
  const view = (v = {}) => hooks.view({ project: book.projects[0], n: 2, editing: false, overlay: null, yearEmpty: false, snapshot: { rev: 'r1', date: '2026-05-01', file: 'KR_시험용_직류_차단기_개발_r1.yaml' }, ...v });
  return {
    window, doc, $, book, panel, rnd, calls, named, logs, hooks, engines, fire, click, pickFiles, drop, view,
    setAi: (v) => { aiValue = v; }, tickClock: (ms) => { clock += ms; },
    overlay: () => overlay, closeOverlay: () => { const fn = overlayClose; overlay = null; fn?.(); },
    msg: (id = 'rdgAddMsg') => $(id).textContent,
  };
}

/** 더하기 카드를 열고 문서 하나를 넣어 미리보기까지. */
async function extracted(s, { target = {}, file = fakeFile('사업계획서.pdf', { type: 'application/pdf' }) } = {}) {
  s.panel.wire();
  s.hooks.add(target);
  s.pickFiles('rdgFile', [file]);
  await until(() => s.named('finalizeExtracted').length > 0 && !s.panel.state().add.busy, '뽑기 끝');
}

/* ---------------------------------------------------------- 만들기·배선 */

test('import·생성은 DOM·chrome 을 만지지 않고, wire 가 두 host 안에만 카드를 만들고 onView·onAdd 를 등록한다', () => {
  assert.equal(typeof globalThis.chrome, 'undefined');
  const s = setup();
  assert.equal(s.$('rdgAdd').innerHTML, '', '만들기만으로는 그리지 않는다');
  assert.equal(s.calls.length, 0);
  s.panel.wire();
  s.panel.wire();   // 두 번 불러도 한 번
  for (const id of ['rdgTarget', 'rdgAddClose', 'rdgFile', 'rdgStage', 'rdgManual', 'rdgAddMsg', 'rdgPreview', 'rdgAlias', 'rdgYaml', 'rdgApply', 'rdgSave', 'rdgRetry', 'rdgCancel']) {
    assert.ok(s.$('rdgAdd').querySelector(`#${id}`), `더하기 카드에 #${id}`);
  }
  for (const id of ['rdgBase', 'rdgChange', 'rdgChangeFile', 'rdgChangeFiles', 'rdgReviseGo', 'rdgReviseMsg', 'rdgRevPreview', 'rdgDiff', 'rdgChangelog', 'rdgRevYaml', 'rdgRevApply', 'rdgRevSave', 'rdgRevCancel']) {
    assert.ok(s.$('rdgRevise').querySelector(`#${id}`), `변경사항 카드에 #${id}`);
  }
  assert.deepEqual(s.named('onView').length, 1);
  assert.deepEqual(s.named('onAdd').length, 1);
  assert.equal(s.calls.filter((c) => !['onView', 'onAdd'].includes(c[0])).length, 0, 'wire 는 LLM·저장소를 부르지 않는다');
  // 단추는 모두 type=button, 알림 줄은 role=status, 파일 고르기의 받는 갈래
  for (const b of s.doc.querySelectorAll('#rdgAdd button, #rdgRevise button')) assert.equal(b.getAttribute('type'), 'button', b.id);
  assert.equal(s.$('rdgAddMsg').getAttribute('role'), 'status');
  assert.equal(s.$('rdgReviseMsg').getAttribute('role'), 'status');
  assert.equal(s.$('rdgFile').getAttribute('accept'), '.yaml,.yml,.pdf,.hwpx,.docx,.xlsx,.pptx,.txt,.md');
  assert.ok(s.$('rdgFile').multiple);
  assert.equal(s.$('rdgChangeFile').getAttribute('accept'), '.pdf,.hwpx,.docx,.xlsx,.txt,.md');
  assert.equal(s.doc.querySelector('label.rdg-drop').getAttribute('for'), 'rdgFile');
  assert.equal(s.$('rdgAddClose').getAttribute('aria-label'), '닫기');
  assert.match(s.doc.querySelector('.rdg-drop-note').textContent, /옛 한글\(\.hwp\)은 뽑지 못합니다/);
  // 단추는 접힌 칸 밖 — <details> 안에는 YAML 원문 칸뿐
  for (const d of s.doc.querySelectorAll('#rdgAdd details, #rdgRevise details')) {
    assert.equal(d.querySelectorAll('button').length, 0, '접힌 칸 안에 단추가 없다');
    assert.equal(d.querySelectorAll('textarea').length, 1);
  }
  // host 밖은 그대로
  assert.deepEqual([...s.doc.querySelector('#rnd').children].map((x) => x.id), ['rdgAdd', 'rdgRevise']);
  assert.ok(s.$('rdgAdd').classList.contains('hidden'));
  assert.ok(s.$('rdgRevise').classList.contains('hidden'));
});

/* ---------------------------------------------------------- 더하기 카드 */

test('openAdd — 대상(빈 차년도 카드)이면 setOverlay(add, fn) · 대상 n 을 고르고 별칭은 그 과제 것(readonly)', () => {
  const s = setup();
  s.panel.wire();
  s.hooks.add({ projectId: 'p1', n: 3 });
  assert.deepEqual(s.named('setOverlay')[0], ['setOverlay', 'add', 'function']);
  assert.equal(s.overlay(), 'add');
  assert.ok(!s.$('rdgAdd').classList.contains('hidden'));
  assert.equal(s.$('rdgTarget').textContent, 'SSCB · 3차년도');
  assert.ok(!s.$('rdgTarget').classList.contains('hidden'));
  const opts = [...s.$('rdgStage').options].map((o) => [o.value, o.textContent]);
  assert.equal(opts.length, 2 + yearsOf(s.book.projects[0]).length);
  assert.deepEqual(opts[0], ['', '자동(오늘이 든 차년도)']);
  assert.deepEqual(opts[1], ['all', '모든 차년도']);
  assert.deepEqual(opts[5], ['4', '4차년도']);
  assert.equal(s.$('rdgStage').value, '3');
  assert.equal(s.$('rdgAlias').value, 'SSCB');
  assert.ok(s.$('rdgAlias').readOnly);
  assert.deepEqual(s.panel.state().add.target, { projectId: 'p1', n: 3 });
});

test('openAdd — 대상이 없으면 보고 있는 과제가 있어도 대상이 아니다(차년도 자동 · 10칸 · 별칭 비고 고칠 수 있음)', () => {
  const s = setup();
  s.panel.wire();
  s.hooks.add({});
  assert.equal(s.panel.state().add.target, null);
  assert.ok(s.$('rdgTarget').classList.contains('hidden'));
  assert.equal(s.$('rdgStage').value, '');
  assert.equal(s.$('rdgStage').options.length, 12, '자동 · 모든 차년도 · 1~10차년도');
  assert.equal(s.$('rdgAlias').value, '');
  assert.ok(!s.$('rdgAlias').readOnly);
  assert.ok(s.$('rdgPreview').classList.contains('hidden'));
});

test('닫기 · 취소 → setOverlay(null) 과 카드 숨김, rndpanel 이 덮개를 닫으면(칩) 카드만 숨는다', () => {
  const s = setup();
  s.panel.wire();
  s.hooks.add({});
  s.click('rdgAddClose');
  assert.deepEqual(s.named('setOverlay').map((c) => c[1]), ['add', null]);
  assert.ok(s.$('rdgAdd').classList.contains('hidden'));
  assert.equal(s.panel.state().add.open, false);
  s.hooks.add({});
  s.closeOverlay();   // rndpanel 의 pickProject: overlay 를 먼저 null 로 하고 close() 를 부른다
  assert.ok(s.$('rdgAdd').classList.contains('hidden'));
  assert.deepEqual(s.named('setOverlay').map((c) => c[1]), ['add', null, 'add'], '이미 풀린 덮개를 다시 풀지 않는다');
});

test('직접 적기 → rnd.addManually(덮개는 rndpanel 이 푼다) — 패널은 자기 상태만 비우고 숨는다', () => {
  const s = setup();
  s.panel.wire();
  s.hooks.add({});
  s.click('rdgManual');
  assert.equal(s.named('addManually').length, 1);
  assert.deepEqual(s.named('setOverlay').map((c) => c[1]), ['add'], '패널은 setOverlay(null) 을 부르지 않는다');
  assert.ok(s.$('rdgAdd').classList.contains('hidden'));
  assert.equal(s.panel.state().add.open, false);
});

test('YAML 파일은 rnd.intake(source file) 로 바로 — 들어가면 닫고 그 과제·차년도로', async () => {
  const s = setup({
    intake: async (texts) => ({ ok: true, error: '', lines: ['연구개발계획서 스냅샷(KR_A.yaml): 과제 찾음: SSCB · 2차년도'], results: [{ name: texts[0].name, kind: 'snapshot', label: '스냅샷', summary: '', projectId: 'p1', n: 2, rev: 'r0', applied: true }] }),
  });
  s.panel.wire();
  s.hooks.add({});
  s.pickFiles('rdgFile', [fakeFile('KR_A.yaml', { text: 'meta: {}' })]);
  await until(() => s.named('pick').length === 1, 'pick');
  const [, texts, meta] = s.named('intake')[0];
  assert.deepEqual(texts, [{ name: 'KR_A.yaml', text: 'meta: {}' }]);
  assert.deepEqual(meta, { source: 'file' });
  assert.deepEqual(s.named('pick')[0], ['pick', 'p1', 2]);
  assert.deepEqual(s.named('setOverlay').map((c) => c[1]), ['add', null]);
  assert.equal(s.named('readDocument').length, 0);
  assert.ok(s.$('rdgAdd').classList.contains('hidden'));
});

test('YAML 넣기가 실패하면 카드는 열린 채 까닭을 적는다 · .hwp 는 안내만', async () => {
  const s = setup({ intake: async () => ({ ok: false, error: 'a.yaml: 아는 모양의 YAML 이 아닙니다', lines: [], results: [] }) });
  s.panel.wire();
  s.hooks.add({});
  s.pickFiles('rdgFile', [fakeFile('a.yaml')]);
  await until(() => s.msg().includes('아는 모양'), '실패 알림');
  assert.ok(s.$('rdgAddMsg').classList.contains('error'));
  assert.ok(!s.$('rdgAdd').classList.contains('hidden'));
  assert.equal(s.named('pick').length, 0);
  s.pickFiles('rdgFile', [fakeFile('계획서.hwp')]);
  await until(() => s.msg().includes('옛 한글'), 'hwp 안내');
  assert.match(s.msg(), /^계획서\.hwp: 옛 한글\(\.hwp\)은 뽑지 못합니다/);
  assert.equal(s.named('readDocument').length, 0);
});

test('문서 → readDocument → loadSkillDocs → askExtract → checkExtracted → finalizeExtracted → 미리보기(별칭·예산 표·경고) · 로그 한 줄', async () => {
  const s = setup();
  await extracted(s);
  const order = s.calls.map((c) => c[0]).filter((n) => ['readDocument', 'loadSkillDocs', 'askExtract', 'checkExtracted', 'finalizeExtracted', 'summarizeSnapshot'].includes(n));
  assert.deepEqual(order, ['readDocument', 'loadSkillDocs', 'askExtract', 'checkExtracted', 'finalizeExtracted', 'summarizeSnapshot']);
  const [, file, ropts] = s.named('readDocument')[0];
  assert.equal(file.name, '사업계획서.pdf');
  assert.equal(file.type, 'application/pdf');
  assert.ok(file.bytes instanceof Uint8Array);
  assert.equal(ropts.engines, s.engines, '주입한 엔진을 넘긴다');
  assert.equal(s.named('loadSkillDocs')[0][1], s.rnd.readAsset);
  const [, mat, ctx, aopts] = s.named('askExtract')[0];
  assert.equal(mat.name, '사업계획서.pdf');
  assert.deepEqual(ctx, { today: TODAY, stage: null, project: null, currentStage: null, docs: { fields: '필드 규칙', output: '출력 규칙' } });
  assert.deepEqual(aopts, { ai: { cli: true } });
  assert.deepEqual(s.named('checkExtracted')[0][2], { stage: 2 }, '고른 n 이 없으면 답의 stage 로 검사한다');
  assert.deepEqual(s.named('finalizeExtracted')[0][2], { stage: 2, today: TODAY, source: '사업계획서.pdf' }, '고른 n 이 없으면 답의 stage');
  // 미리보기
  assert.ok(!s.$('rdgPreview').classList.contains('hidden'));
  assert.match(s.doc.querySelector('.rdg-read').textContent, /40쪽 가운데 4쪽/);
  const meta = Object.fromEntries([...s.doc.querySelectorAll('.rdg-meta > div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd')]));
  assert.equal(meta['과제명'].textContent, '시험용 신규 과제');
  assert.equal(meta['차년도'].textContent, '2차년도 · r0');
  assert.equal(meta['과제번호'].textContent, 'RS-2026-00000009');
  assert.equal(meta['참여연구자'].textContent, '2명');
  assert.equal(meta['넣을 곳'].textContent, '새 과제');
  const rows = [...meta['비목별 예산(천원)'].querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent));
  assert.deepEqual(rows, [['연구재료비', '12,000'], ['인건비', '30,000'], ['합계', '42,000']]);
  const warns = [...meta['경고'].querySelectorAll('li')].map((li) => li.textContent);
  assert.deepEqual(warns, ['예산.비목별 에 간접비 행이 없습니다', '협약일을 못 찾음', '3쪽 표가 흐림', '12쪽 표가 그림입니다']);
  // 별칭 — 장부에 없는 과제라 LLM 제안을 채우고 고칠 수 있다
  assert.equal(s.$('rdgAlias').value, 'NEWP');
  assert.ok(!s.$('rdgAlias').readOnly);
  assert.match(s.$('rdgYaml').value, /^# \[2차년도 최초\]/);
  assert.ok(!s.$('rdgApply').disabled && !s.$('rdgSave').disabled && !s.$('rdgRetry').disabled);
  assert.match(s.msg(), /^뽑았습니다 — 시험용 신규 과제 2차년도 · 로컬 CLI · \$0\.4213/);
  assert.equal(s.logs.length, 1);
  const [kind, ok, text, data] = s.logs[0];
  assert.equal(kind, 'rnd');
  assert.equal(ok, true);
  assert.equal(text, 'R&D 사업계획서에서 스냅샷 뽑음 — 시험용 신규 과제 2차년도 (로컬 CLI · $0.4213)');
  assert.deepEqual(data, { file: '사업계획서.pdf', via: 'cli', costUsd: 0.4213 });
  assert.equal(s.$('rdgAdd').getAttribute('aria-busy'), null);
});

test('대상(빈 차년도 카드)에서 뽑으면 장부의 과제·오늘이 든 차년도를 입력에 주고, 같은 과제면 그 별칭(readonly)', async () => {
  const s = setup({
    extract: async (mat, ctx) => ({ data: { yaml: snapText({ 과제명: P1_NAME, 연구개발과제번호: 'RS-2026-00000001', 차년도: '3차년도' }), alias: 'OTHER', stage: 3, warnings: null }, via: 'api', note: '' }),
  });
  await extracted(s, { target: { projectId: 'p1', n: 3 } });
  const ctx = s.named('askExtract')[0][2];
  assert.equal(ctx.stage, 3);
  assert.equal(ctx.currentStage, 2, '장부 기준 오늘(2026-10-16)이 든 차년도');
  assert.deepEqual(ctx.project, { name: P1_NAME, code: 'RS-2026-00000001', alias: 'SSCB', start: '2025-04-01', end: '2028-12-31', calendar: true });
  assert.deepEqual(s.named('checkExtracted')[0][2], { stage: 3 });
  assert.equal(s.named('finalizeExtracted')[0][2].stage, 3);
  assert.equal(s.$('rdgAlias').value, 'SSCB');
  assert.ok(s.$('rdgAlias').readOnly);
  const where = [...s.doc.querySelectorAll('.rdg-meta > div')].find((d) => d.querySelector('dt').textContent === '넣을 곳');
  assert.match(where.querySelector('dd').textContent, /^SSCB — 장부에 있는 과제/);
  assert.match(s.logs[0][2], /\(API 키\)$/);
});

test('고른 차년도도 답의 stage 도 없으면 checkExtracted 에 null — 차년도는 YAML 의 meta.차년도 로', async () => {
  const s = setup({ extract: async () => ({ data: { yaml: snapText({ 과제명: '시험용 신규 과제', 차년도: '3차년도' }), alias: 'NEWP', stage: null, warnings: null }, via: 'cli', note: '' }) });
  await extracted(s);
  assert.deepEqual(s.named('checkExtracted')[0][2], { stage: null });
  assert.equal(s.named('finalizeExtracted')[0][2].stage, 3);
});

test('Claude 연결이 없으면 문서를 읽지 않고 알린다', async () => {
  const s = setup({ ai: {} });
  s.panel.wire();
  s.hooks.add({});
  s.pickFiles('rdgFile', [fakeFile('계획서.pdf')]);
  await until(() => s.msg() !== '', '알림');
  assert.equal(s.msg(), NEED_AI);
  assert.ok(s.$('rdgAddMsg').classList.contains('error'));
  assert.equal(s.named('readDocument').length, 0);
  assert.equal(s.named('askExtract').length, 0);
});

test('재료가 비면(글자도 붙일 PDF 도 없음 — 8MB 넘는 스캔본) Claude 를 부르지 않고 까닭(material.warnings)을 알린다 · 다시 뽑기는 잠긴다', async () => {
  const why = '글자 층이 없는 PDF(스캔본)입니다 — 원본이 커서(9.5MB) 붙이지도 못했습니다(8MB 까지)';
  const s = setup({ readDocument: async (file) => material(file.name, { picked: [], text: '', chars: 0, file: null, attach: 'none', read: `${file.name}: 120쪽 · 글자 층 없음(스캔본) · 원본이 커서(9.5MB) 붙이지 못함`, warnings: [why] }) });
  s.panel.wire();
  s.hooks.add({});
  s.pickFiles('rdgFile', [fakeFile('스캔본.pdf', { type: 'application/pdf' })]);
  await until(() => s.msg() !== '' && !s.panel.state().add.busy && s.named('readDocument').length === 1, '알림');
  await until(() => s.msg().includes('뽑지 않았습니다'), '멈춤 알림');
  assert.equal(s.msg(), `스캔본.pdf: Claude 에게 줄 글자도 붙일 PDF 도 없어 뽑지 않았습니다 — ${why}`);
  assert.ok(s.$('rdgAddMsg').classList.contains('error'));
  assert.equal(s.named('loadSkillDocs').length + s.named('askExtract').length, 0, 'Claude 를 부르지 않는다');
  assert.match(s.doc.querySelector('.rdg-read').textContent, /원본이 커서\(9\.5MB\) 붙이지 못함/, '무엇을 읽었는지는 보인다');
  assert.ok(s.$('rdgRetry').disabled, '같은 재료로 다시 뽑을 수 없다');
  assert.ok(s.$('rdgApply').disabled);
  assert.deepEqual(s.logs.map((l) => [l[0], l[1]]), [['rnd', false]]);
  assert.match(s.logs[0][2], /^R&D 스냅샷 뽑기 실패: 스캔본\.pdf: Claude 에게 줄 글자도/);
  assert.equal(s.$('rdgAdd').getAttribute('aria-busy'), null);
});

test('다시 뽑기 — 메모리의 같은 재료로, 차년도 고르기의 지금 값으로 · 문서를 다시 읽지 않는다', async () => {
  const s = setup();
  await extracted(s);
  const first = s.named('askExtract')[0][1];
  s.$('rdgStage').value = '3';
  s.click('rdgRetry');
  await until(() => s.named('finalizeExtracted').length === 2 && !s.panel.state().add.busy, '다시 뽑기');
  assert.equal(s.named('readDocument').length, 1);
  const [, mat, ctx] = s.named('askExtract')[1];
  assert.equal(mat, first, '같은 재료');
  assert.equal(ctx.stage, 3);
  assert.equal(s.named('finalizeExtracted')[1][2].stage, 3);
  assert.equal(s.logs.length, 2);
});

test('넣기 — 별칭 검사(비었음·겹침) → intake(source extract) → setAlias → closeAdd → pick 차례', async () => {
  const s = setup();
  await extracted(s);
  s.$('rdgAlias').value = '';
  s.click('rdgApply');
  await until(() => s.msg().startsWith('별칭을 적으세요'), '별칭 없음');
  assert.equal(s.msg(), '별칭을 적으세요 — 예) SSCB');
  s.$('rdgAlias').value = 'pemfc';
  s.click('rdgApply');
  await until(() => s.msg().startsWith('같은 별칭'), '별칭 겹침');
  assert.equal(s.msg(), '같은 별칭의 과제가 있습니다 — 시험용 연료전지 과제');
  assert.equal(s.named('intake').length, 0);
  // 사람이 YAML 을 고쳤을 수 있다 — 칸의 글을 다시 풀어 넣는다
  s.$('rdgAlias').value = 'NEWP';
  s.$('rdgYaml').value = s.$('rdgYaml').value.replace('"연구재료비": 12000', '"연구재료비": 13000');
  const before = s.calls.length;
  s.click('rdgApply');
  await until(() => s.named('pick').length === 1, '넣기');
  const [, texts, meta] = s.named('intake')[0];
  assert.equal(texts.length, 1);
  assert.equal(texts[0].name, 'KR_시험용_신규_과제.yaml');
  assert.match(texts[0].text, /13000/);
  assert.deepEqual(meta, { source: 'extract' });
  const tail = s.calls.slice(before).map((c) => c[0]).filter((n) => ['intake', 'setAlias', 'setOverlay', 'pick'].includes(n));
  assert.deepEqual(tail, ['intake', 'setAlias', 'setOverlay', 'pick']);
  assert.deepEqual(s.named('setAlias')[0], ['setAlias', 'p9', 'NEWP']);
  assert.equal(s.named('setOverlay').at(-1)[1], null);
  assert.deepEqual(s.named('pick')[0], ['pick', 'p9', 2]);
  assert.ok(s.$('rdgAdd').classList.contains('hidden'));
  assert.equal(s.panel.state().add.material, null, '닫으면 재료를 버린다');
});

test('넣기 — 별칭이 있는 장부의 과제면 setAlias 를 부르지 않는다 · 들어가지 않은 판이면 카드에 까닭', async () => {
  const s = setup({
    extract: async () => ({ data: { yaml: snapText({ 과제명: P1_NAME, 연구개발과제번호: 'RS-2026-00000001', 차년도: '2차년도' }), alias: null, stage: 2, warnings: null }, via: 'cli', note: '' }),
  });
  await extracted(s);
  s.click('rdgApply');
  await until(() => s.named('pick').length === 1, '넣기');
  assert.equal(s.named('setAlias').length, 0);
  assert.equal(s.named('intake')[0][1][0].name, `KR_${P1_NAME.replace(/\s+/g, '_')}.yaml`);

  const t = setup({
    intake: async (texts) => ({ ok: true, error: '', lines: [], results: [{ name: texts[0].name, kind: 'snapshot', label: '연구개발계획서 스냅샷', summary: 'SSCB 2차년도에는 이미 r2 가 들어 있어 더 오래된 r0 는 넣지 않았습니다', projectId: 'p1', n: 2, rev: 'r0', applied: false }] }),
  });
  await extracted(t);
  t.click('rdgApply');
  await until(() => t.msg().includes('넣지 않았습니다'), '오래된 판');
  assert.ok(t.$('rdgAddMsg').classList.contains('error'));
  assert.equal(t.named('pick').length, 0);
  assert.ok(!t.$('rdgAdd').classList.contains('hidden'));
});

test('YAML 파일로 저장 — download(글, KR_….yaml, text/yaml) 과 flash', async () => {
  const s = setup();
  await extracted(s);
  s.click('rdgSave');
  await until(() => s.named('flash').length === 1, 'flash');
  const [, data, name, type] = s.named('download')[0];
  assert.equal(data, s.$('rdgYaml').value);
  assert.equal(name, 'KR_시험용_신규_과제.yaml');
  assert.equal(type, 'text/yaml');
  assert.deepEqual(s.named('flash')[0], ['flash', 'rdgSave', '저장됨 ✓']);
});

test('뽑은 것이 스냅샷 꼴이 아니면 오류 · 원문은 YAML 칸에 펴 두어 고쳐 넣을 수 있다 · 실패 로그', async () => {
  const s = setup({ extract: async () => ({ data: { yaml: '{"표지": {"과제명": "?"}}', alias: null, stage: null, warnings: null }, via: 'cli', note: '' }) });
  s.panel.wire();
  s.hooks.add({});
  s.pickFiles('rdgFile', [fakeFile('계획서.pdf')]);
  await until(() => s.msg().startsWith('뽑은 YAML'), '오류');
  assert.match(s.msg(), /^뽑은 YAML 이 스냅샷 꼴이 아닙니다 — meta\.과제명 이 없습니다/);
  assert.ok(s.$('rdgAddMsg').classList.contains('error'));
  assert.deepEqual(s.named('checkExtracted')[0][2], { stage: null }, '고른 것도 답의 stage 도 없으면 null');
  assert.equal(s.named('finalizeExtracted').length, 0);
  assert.equal(s.$('rdgYaml').value, '{"표지": {"과제명": "?"}}');
  assert.ok(s.doc.querySelector('#rdgAdd details.rdg-yaml').open);
  assert.ok(!s.$('rdgApply').disabled);
  assert.equal(s.logs.at(-1)[1], false);
  assert.match(s.logs.at(-1)[2], /^R&D 스냅샷 뽑기 실패: 뽑은 YAML 이 스냅샷 꼴이 아닙니다/);
  // 넣기를 눌러도 스냅샷이 아니면 들이지 않는다
  s.click('rdgApply');
  await until(() => s.msg().startsWith('스냅샷 YAML 이 아닙니다'), '넣기 거절');
  assert.equal(s.named('intake').length, 0);
});

test('LLM 이 던지면 오류 · 실패 로그 · 다시 뽑기는 남는다', async () => {
  const s = setup({ extract: async () => { throw new Error('답을 받지 못했습니다 — 시간 초과'); } });
  s.panel.wire();
  s.hooks.add({});
  s.pickFiles('rdgFile', [fakeFile('계획서.docx')]);
  await until(() => s.msg().startsWith('스냅샷을 뽑지 못했습니다'), '오류');
  assert.equal(s.msg(), '스냅샷을 뽑지 못했습니다 — 답을 받지 못했습니다 — 시간 초과');
  assert.deepEqual(s.logs.at(-1).slice(0, 3), ['rnd', false, 'R&D 스냅샷 뽑기 실패: 답을 받지 못했습니다 — 시간 초과']);
  assert.ok(!s.$('rdgPreview').classList.contains('hidden'));
  assert.ok(!s.$('rdgRetry').disabled, '재료가 남아 다시 뽑을 수 있다');
  assert.ok(s.$('rdgApply').disabled);
});

test('바쁠 때 — host aria-busy · 단추 잠금(닫기·취소·직접 적기는 둔다) · 지난 초 · 닫으면 늦게 온 답은 버린다', async () => {
  const g = gate();
  const s = setup({ tickMs: 10, extract: async () => { await g.p; return { data: { yaml: snapText({ 과제명: '늦은 과제', 차년도: '2차년도' }), alias: 'LATE', stage: 2 }, via: 'cli', note: '' }; } });
  s.panel.wire();
  s.hooks.add({});
  s.pickFiles('rdgFile', [fakeFile('계획서.pdf')]);
  await until(() => s.named('askExtract').length === 1, '묻는 중');
  assert.equal(s.$('rdgAdd').getAttribute('aria-busy'), 'true');
  for (const id of ['rdgFile', 'rdgStage', 'rdgApply', 'rdgSave', 'rdgRetry']) assert.ok(s.$(id).disabled, `${id} 잠김`);
  for (const id of ['rdgAddClose', 'rdgCancel', 'rdgManual']) assert.ok(!s.$(id).disabled, `${id} 열림`);
  assert.ok(s.msg().startsWith(ASKING_EXTRACT), s.msg());
  s.tickClock(65_000);
  await until(() => s.msg().endsWith('1분 5초'), '지난 초');
  // 바쁜 동안 또 넣으면 받지 않는다(알림은 그 자리에서 — 다음 초 세기가 덮는다)
  s.drop(s.doc.querySelector('.rdg-drop'), [fakeFile('또.pdf')]);
  assert.ok(s.msg().startsWith('지금 하던 일'), s.msg());
  assert.equal(s.named('readDocument').length, 1);
  s.click('rdgCancel');
  assert.equal(s.$('rdgAdd').getAttribute('aria-busy'), null);
  g.open();
  await wait(30);
  assert.equal(s.named('checkExtracted').length, 0, '닫은 뒤 온 답은 버린다');
  assert.equal(s.logs.length, 0);
  assert.ok(s.$('rdgAdd').classList.contains('hidden'));
});

test('끌어 놓기 — 더하기 카드는 놓은 것을 받고 rndpanel 의 탭 전체 받기로 보내지 않는다', async () => {
  const s = setup();
  s.panel.wire();
  s.hooks.add({});
  let bubbled = 0;
  s.doc.getElementById('rnd').addEventListener('drop', () => { bubbled++; });
  s.doc.getElementById('rnd').addEventListener('dragover', () => { bubbled++; });
  const zone = s.doc.querySelector('.rdg-drop');
  const over = s.drop(zone, [], 'dragover');
  assert.ok(over.defaultPrevented);
  assert.ok(zone.classList.contains('over'));
  const ev = s.drop(zone, [fakeFile('계획서.pdf')]);
  assert.ok(ev.defaultPrevented);
  assert.ok(!zone.classList.contains('over'));
  await until(() => s.named('finalizeExtracted').length === 1, '뽑기');
  assert.equal(bubbled, 0);
  assert.equal(s.named('readDocument')[0][1].name, '계획서.pdf');
});

test('문서 둘을 넣으면 첫 것만 뽑고 알린다 · YAML 과 문서를 함께 넣으면 YAML 을 넣고 카드는 열어 둔 채 뽑는다', async () => {
  const s = setup();
  s.panel.wire();
  s.hooks.add({});
  s.pickFiles('rdgFile', [fakeFile('KR_x.yaml', { text: snapText({ 과제명: P1_NAME, 차년도: '2차년도' }) }), fakeFile('a.pdf'), fakeFile('b.hwpx')]);
  await until(() => s.named('finalizeExtracted').length === 1 && !s.panel.state().add.busy, '뽑기');
  assert.equal(s.named('intake')[0][2].source, 'file');
  assert.equal(s.named('readDocument').length, 1);
  assert.equal(s.named('readDocument')[0][1].name, 'a.pdf');
  assert.equal(s.named('pick').length, 0, '문서가 있으면 닫지 않는다');
  const warns = [...s.doc.querySelectorAll('.rdg-warns li')].map((li) => li.textContent);
  assert.ok(warns.includes('문서는 한 번에 하나씩 뽑습니다 — a.pdf 만 씁니다'), warns.join(' | '));
});

/* ---------------------------------------------------------- 모든 차년도 */

const NEW_NAME = '시험용 신규 과제';
/** 모든 차년도 흉내 답 — 물은 차년도의 스냅샷, 연차범위는 range 개(0 이면 없음). fail(stage) 가 참이면 던진다. */
const allAnswer = ({ range = 3, name = () => NEW_NAME, fail = () => false } = {}) => async (mat, ctx) => {
  if (fail(ctx.stage)) throw new Error(`답을 받지 못했습니다 — ${ctx.stage}차년도 시간 초과`);
  const meta = { 과제명: name(ctx.stage), 연구개발과제번호: name(ctx.stage) === NEW_NAME ? 'RS-2026-00000009' : '', 차년도: `${ctx.stage}차년도` };
  if (range) meta.연차범위 = Array.from({ length: range }, (_, i) => `${i + 1}차년도`);
  return { data: { yaml: snapText(meta), alias: 'NEWP', stage: ctx.stage, warnings: ctx.stage === 2 ? '협약일을 못 찾음' : null }, via: 'cli', costUsd: 0.4213, note: '' };
};
/** 여러 스냅샷을 한 번에 넣는 intake 흉내 — 새 과제는 연구기간 2025-04-01 ~ 2027-12-31(1월 1일 끊기)라 2026-10-16 은 2차년도. */
const intakeMany = (texts, meta, book) => ({
  ok: true, error: '', lines: texts.map((t) => `연구개발계획서 스냅샷(${t.name})`),
  results: texts.map((t) => {
    const obj = parse(t.text).obj;
    let p = book.projects.find((x) => x.name === obj.meta.과제명);
    if (!p) { p = { id: 'p9', name: obj.meta.과제명, alias: '', code: obj.meta.연구개발과제번호 || '', start: '2025-04-01', end: '2027-12-31', calendar: true, years: {} }; book.projects.push(p); }
    return { name: t.name, kind: 'snapshot', label: '연구개발계획서 스냅샷', summary: `${p.name} · ${obj.meta.차년도}`, projectId: p.id, n: yearNo(obj.meta.차년도), rev: 'r0', applied: true };
  }),
});
const yearRows = (s) => [...s.doc.querySelectorAll('.rdg-years > li')].map((li) => [li.querySelector('strong').textContent, li.querySelector('.rdg-year-what').textContent, [...li.querySelectorAll('button')].map((b) => b.textContent)]);

/** 모든 차년도를 고르고 문서 하나를 넣어 끝까지. */
async function extractedAll(s, { target = {}, asks } = {}) {
  s.panel.wire();
  s.hooks.add(target);
  s.$('rdgStage').value = 'all';
  s.pickFiles('rdgFile', [fakeFile('사업계획서.pdf', { type: 'application/pdf' })]);
  await until(() => s.named('askExtract').length >= asks && !s.panel.state().add.busy && s.logs.length > 0, '모든 차년도 뽑기 끝');
}

test('모든 차년도 — 새 과제: 1차년도 답의 연차범위로 몇 번 물을지 정해 차례로 묻는다 · 차년도별 줄 · 공통·차년도 경고 · 로그 한 줄', async () => {
  const s = setup({ extract: allAnswer({ range: 3 }) });
  await extractedAll(s, { asks: 3 });
  assert.equal(s.named('readDocument').length, 1, '문서는 한 번 읽는다');
  assert.equal(s.named('loadSkillDocs').length, 1);
  assert.deepEqual(s.named('askExtract').map((c) => c[2].stage), [1, 2, 3], '1차년도부터 차례로');
  assert.ok(s.named('askExtract').every((c) => c[1] === s.named('askExtract')[0][1]), '같은 재료');
  assert.deepEqual(s.named('checkExtracted').map((c) => c[2]), [{ stage: 1 }, { stage: 2 }, { stage: 3 }]);
  assert.deepEqual(s.named('finalizeExtracted').map((c) => c[2].stage), [1, 2, 3]);
  const all = s.panel.state().add.all;
  assert.equal(all.total, 3);
  assert.ok(all.counted);
  assert.deepEqual(all.years.map((y) => [y.n, y.state]), [[1, 'ok'], [2, 'ok'], [3, 'ok']]);
  assert.deepEqual(yearRows(s), [
    ['1차년도', '합계 42,000천원 · 참여연구자 2명 · 경고 1', ['YAML', '다시 뽑기']],
    ['2차년도', '합계 42,000천원 · 참여연구자 2명 · 경고 2', ['YAML', '다시 뽑기']],
    ['3차년도', '합계 42,000천원 · 참여연구자 2명 · 경고 1', ['YAML', '다시 뽑기']],
  ]);
  const meta = Object.fromEntries([...s.doc.querySelectorAll('.rdg-meta > div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd')]));
  assert.deepEqual(Object.keys(meta), ['과제명', '과제번호', '책임자', '연구기간', '차년도별', '넣을 곳', '경고']);
  assert.equal(meta['과제명'].textContent, NEW_NAME);
  assert.equal(meta['넣을 곳'].textContent, '새 과제');
  assert.deepEqual([...meta['경고'].querySelectorAll('li')].map((li) => li.textContent), [
    '12쪽 표가 그림입니다',
    '1차년도: 예산.비목별 에 간접비 행이 없습니다',
    '2차년도: 예산.비목별 에 간접비 행이 없습니다', '2차년도: 협약일을 못 찾음',
    '3차년도: 예산.비목별 에 간접비 행이 없습니다',
  ]);
  // YAML 칸은 처음 온 1차년도 · 별칭은 답의 제안 · 단추
  assert.match(s.$('rdgYaml').value, /^# \[1차년도 최초\]/);
  assert.equal(s.doc.querySelector('.rdg-yaml-year').textContent, ' — 1차년도');
  assert.ok(s.doc.querySelector('.rdg-years > li').classList.contains('at'));
  assert.equal(s.$('rdgAlias').value, 'NEWP');
  assert.ok(!s.$('rdgApply').disabled && !s.$('rdgSave').disabled && !s.$('rdgRetry').disabled);
  assert.equal(s.$('rdgSave').textContent, 'YAML 묶음 저장(zip)');
  assert.equal(s.msg(), `뽑았습니다 — ${NEW_NAME} 1차년도·2차년도·3차년도 · 로컬 CLI · $1.2639. 확인하고 넣기를 누르세요`);
  assert.equal(s.logs.length, 1);
  assert.deepEqual(s.logs[0], ['rnd', true, `R&D 사업계획서에서 모든 차년도 스냅샷 뽑음 — ${NEW_NAME} 1차년도·2차년도·3차년도 (로컬 CLI · $1.2639)`,
    { file: '사업계획서.pdf', via: 'cli', costUsd: 0.4213 + 0.4213 + 0.4213, stages: [1, 2, 3] }]);
  // 다른 차년도의 YAML 을 연다
  s.doc.querySelector('[data-rdg-year-show="3"]').click();
  assert.match(s.$('rdgYaml').value, /^# \[3차년도 최초\]/);
  assert.ok(s.doc.querySelector('#rdgAdd details.rdg-yaml').open);
  assert.equal(s.doc.querySelector('.rdg-yaml-year').textContent, ' — 3차년도');
  assert.ok(s.doc.querySelectorAll('.rdg-years > li')[2].classList.contains('at'));
});

test('모든 차년도 — 대상 과제의 연구기간으로 시작하고 답의 연차범위가 이긴다 · 한 차년도가 실패해도 다음으로 · 그 줄의 다시 뽑기는 그 차년도만', async () => {
  let failTwo = true;
  const g = gate();
  const answer = allAnswer({ range: 3, name: () => P1_NAME, fail: (n) => n === 2 && failTwo });
  const s = setup({ extract: async (mat, ctx) => { await g.p; return answer(mat, ctx); } });
  s.panel.wire();
  s.hooks.add({ projectId: 'p1', n: 3 });
  s.$('rdgStage').value = 'all';
  s.pickFiles('rdgFile', [fakeFile('사업계획서.pdf', { type: 'application/pdf' })]);
  await until(() => s.named('askExtract').length === 1, '첫 묻기');
  // 대상 과제(2025-04-01 ~ 2028-12-31, 1월 1일 끊기)는 4개 차년도 — 처음엔 1차년도를 묻고 나머지 셋이 기다린다
  assert.deepEqual(s.panel.state().add.all.years.map((y) => [y.n, y.state]), [[1, 'asking'], [2, 'wait'], [3, 'wait'], [4, 'wait']]);
  assert.ok(s.msg().includes('· 1차년도 (1/4)'), s.msg());
  g.open();
  await until(() => !s.panel.state().add.busy && s.logs.length === 1, '끝');
  assert.deepEqual(s.named('askExtract').map((c) => c[2].stage), [1, 2, 3], '문서의 연차범위(3)가 이긴다');
  assert.equal(s.named('askExtract')[0][2].project.alias, 'SSCB');
  const all = s.panel.state().add.all;
  assert.deepEqual(all.years.map((y) => [y.n, y.state]), [[1, 'ok'], [2, 'fail'], [3, 'ok']], '묻지 않은 4차년도 줄은 거둔다');
  assert.equal(yearRows(s)[1][1], '뽑지 못함 — 답을 받지 못했습니다 — 2차년도 시간 초과');
  assert.deepEqual(yearRows(s)[1][2], ['다시 뽑기'], '글이 없으면 YAML 단추는 없다');
  assert.ok(s.doc.querySelectorAll('.rdg-years > li')[1].classList.contains('fail'));
  assert.equal(s.$('rdgAlias').value, 'SSCB');
  assert.ok(s.$('rdgAlias').readOnly);
  assert.match(s.msg(), /^뽑았습니다 — 시험용 직류 차단기 개발 1차년도·3차년도 · 로컬 CLI · \$0\.8426 · 2차년도는 뽑지 못했습니다\(그 줄의 다시 뽑기\)/);
  assert.match(s.logs[0][2], /^R&D 사업계획서에서 모든 차년도 스냅샷 뽑음 — 시험용 직류 차단기 개발 1차년도·3차년도 · 못 뽑음 2차년도 \(/);
  // 2차년도만 다시
  failTwo = false;
  s.doc.querySelector('[data-rdg-year-redo="2"]').click();
  await until(() => s.logs.length === 2 && !s.panel.state().add.busy, '다시 뽑기');
  assert.deepEqual(s.named('askExtract').slice(3).map((c) => c[2].stage), [2]);
  assert.equal(s.named('readDocument').length, 1, '문서를 다시 읽지 않는다');
  assert.deepEqual(s.panel.state().add.all.years.map((y) => y.state), ['ok', 'ok', 'ok']);
  assert.equal(s.logs[1][2], 'R&D 사업계획서에서 스냅샷 뽑음 — 시험용 직류 차단기 개발 2차년도 (로컬 CLI · $0.4213)');
  assert.equal(s.$('rdgAlias').value, 'SSCB');
});

test('모든 차년도 넣기 — 고친 YAML 칸은 그 차년도의 글로 · zip 저장(N차년도/KR_….yaml) · 한 번의 intake → setAlias → 닫고 오늘이 든 차년도로', async () => {
  const s = setup({ extract: allAnswer({ range: 3 }), intake: intakeMany });
  await extractedAll(s, { asks: 3 });
  // 2차년도를 열어 고친다
  s.doc.querySelector('[data-rdg-year-show="2"]').click();
  const edited = s.$('rdgYaml').value.replace('"연구재료비": 12000', '"연구재료비": 13000');
  assert.notEqual(edited, s.$('rdgYaml').value);
  s.$('rdgYaml').value = edited;
  s.fire(s.$('rdgYaml'), 'input');
  assert.ok(s.panel.state().add.all.years[1].edited);
  assert.match(yearRows(s)[1][1], / · 원문을 고침 · /);
  // zip 저장
  s.click('rdgSave');
  await until(() => s.named('flash').length === 1, 'flash');
  const [, bytes, name, type] = s.named('download')[0];
  assert.equal(name, 'KR_시험용_신규_과제_모든차년도.zip');
  assert.equal(type, 'application/zip');
  const files = readZip(bytes).map((e) => [e.name, new TextDecoder().decode(e.data)]);
  assert.deepEqual(files.map((f) => f[0]), ['1차년도/KR_시험용_신규_과제.yaml', '2차년도/KR_시험용_신규_과제.yaml', '3차년도/KR_시험용_신규_과제.yaml']);
  assert.equal(files[1][1], edited);
  // 넣기
  s.click('rdgApply');
  await until(() => s.named('pick').length === 1, '넣기');
  const intakes = s.named('intake');
  assert.equal(intakes.length, 1, '한 번에 넣는다');
  const [, texts, meta] = intakes[0];
  assert.deepEqual(meta, { source: 'extract' });
  assert.deepEqual(texts.map((t) => t.name), ['1차년도/KR_시험용_신규_과제.yaml', '2차년도/KR_시험용_신규_과제.yaml', '3차년도/KR_시험용_신규_과제.yaml']);
  assert.equal(texts[1].text, edited.trim());
  const order = s.calls.map((c) => c[0]).filter((n) => ['intake', 'setAlias', 'setOverlay', 'pick'].includes(n));
  assert.deepEqual(order.slice(-4), ['intake', 'setAlias', 'setOverlay', 'pick']);
  assert.deepEqual(s.named('setAlias')[0], ['setAlias', 'p9', 'NEWP']);
  assert.deepEqual(s.named('pick')[0], ['pick', 'p9', 2], '2026-10-16 은 2차년도');
  assert.ok(s.$('rdgAdd').classList.contains('hidden'));
  assert.equal(s.panel.state().add.all, null);
});

test('모든 차년도 — 차년도 수를 모르면 1차년도만 뽑고 알린다 · 과제명이 다른 차년도는 넣지 않는다', async () => {
  const s1 = setup({ extract: allAnswer({ range: 0 }) });
  await extractedAll(s1, { asks: 1 });
  await wait(20);
  assert.equal(s1.named('askExtract').length, 1);
  assert.ok(s1.panel.state().add.warnings.some((w) => w.startsWith('몇 차년도까지인지 읽지 못해 1차년도만 뽑았습니다')), s1.panel.state().add.warnings.join(' | '));

  const s2 = setup({ extract: allAnswer({ range: 2, name: (n) => (n === 2 ? '다른 이름의 과제' : NEW_NAME) }), intake: intakeMany });
  await extractedAll(s2, { asks: 2 });
  assert.ok(s2.panel.state().add.warnings.some((w) => w.startsWith('2차년도의 과제명·과제번호가 1차년도와 달라 넣지 않습니다')), s2.panel.state().add.warnings.join(' | '));
  s2.click('rdgApply');
  await until(() => s2.msg().startsWith('2차년도: 과제명·과제번호가 1차년도와 다릅니다'), '넣기 거절');
  assert.ok(s2.$('rdgAddMsg').classList.contains('error'));
  assert.equal(s2.named('intake').length, 0);
});

test('모든 차년도 — 묻는 동안 닫으면 남은 차년도를 묻지 않고 늦게 온 답은 버린다', async () => {
  const g = gate();
  const answer = allAnswer({ range: 3 });
  const s = setup({ extract: async (mat, ctx) => { await g.p; return answer(mat, ctx); } });
  s.panel.wire();
  s.hooks.add({});
  s.$('rdgStage').value = 'all';
  s.pickFiles('rdgFile', [fakeFile('사업계획서.pdf')]);
  await until(() => s.named('askExtract').length === 1, '묻는 중');
  assert.ok(s.msg().startsWith('Claude 에게 차년도마다 차례로 묻는 중 — 차년도마다 몇 분 걸릴 수 있습니다 · 1차년도 (1/?)'), s.msg());
  assert.deepEqual(yearRows(s), [['1차년도', '뽑는 중…', []]]);
  s.click('rdgCancel');
  g.open();
  await wait(30);
  assert.equal(s.named('askExtract').length, 1);
  assert.equal(s.named('checkExtracted').length, 0);
  assert.equal(s.logs.length, 0);
  assert.ok(s.$('rdgAdd').classList.contains('hidden'));
});

/* ---------------------------------------------------------- 변경사항 카드 */

test('변경사항 카드 — 과제를 보고 있고 폼·덮개·빈 차년도가 아닐 때만 · 기준 줄(찾는 중 → 저장된 판 / 장부로 지음)', async () => {
  const sg = gate();
  const s = setup({
    storeGate: sg,
    entries: { 'p1:2': { text: snapText({ 과제명: P1_NAME, rev: 'r2', 차년도: '2차년도' }), rev: 'r2', at: '2026-10-12T03:00:00.000Z', file: 'KR_x_r2.yaml', source: 'revise', summary: '' } },
  });
  s.panel.wire();
  s.view();
  assert.ok(!s.$('rdgRevise').classList.contains('hidden'));
  assert.equal(s.$('rdgBase').textContent, '기준: 저장된 YAML 을 찾는 중…');
  assert.equal(s.named('store.load').length, 1);
  sg.open();
  await until(() => s.$('rdgBase').textContent !== '기준: 저장된 YAML 을 찾는 중…', '읽음');
  assert.equal(s.$('rdgBase').textContent, '기준: 저장된 YAML r2 · 10.12');
  s.view({ n: 3 });
  assert.equal(s.$('rdgBase').textContent, LOSSY_BASE);
  for (const v of [{ editing: true }, { overlay: 'add' }, { yearEmpty: true }, { project: null, n: 0 }]) {
    s.view(v);
    assert.ok(s.$('rdgRevise').classList.contains('hidden'), JSON.stringify(v));
  }
  s.view();
  assert.ok(!s.$('rdgRevise').classList.contains('hidden'));
  assert.equal(s.named('store.load').length, 1, '저장소는 한 번만 읽는다');
});

test('YAML 고치기 — 저장된 원문이 없으면 bookToSnapshot → askRevise → nextRev → finalizeRevised → 차이·변경이력 미리보기 · 로그', async () => {
  const s = setup();
  s.panel.wire();
  s.view();
  await until(() => s.panel.state().loaded, '저장소');
  s.click('rdgReviseGo');
  await until(() => s.msg('rdgReviseMsg') !== '', '빈 입력');
  assert.equal(s.msg('rdgReviseMsg'), '바뀐 내용을 적거나 문서를 붙이세요');
  assert.equal(s.named('askRevise').length, 0);

  s.$('rdgChange').value = '연구재료비를 15,000천원으로 늘림 (공문 2026-123)';
  s.click('rdgReviseGo');
  await until(() => s.panel.state().revise.result, '미리보기');
  const [, bk, project, n, opts] = s.named('bookToSnapshot')[0];
  assert.equal(bk, s.book);
  assert.equal(project, s.book.projects[0]);
  assert.equal(n, 2);
  assert.deepEqual(opts, { today: TODAY });
  const [, args, aopts] = s.named('askRevise')[0];
  assert.match(args.baseYaml, /^# \[장부에서 지음\]/);
  assert.equal(args.text, '연구재료비를 15,000천원으로 늘림 (공문 2026-123)');
  assert.deepEqual(args.materials, []);
  assert.equal(args.today, TODAY);
  assert.deepEqual(args.project, { name: P1_NAME, code: 'RS-2026-00000001', alias: 'SSCB' });
  assert.equal(args.n, 2);
  assert.equal(args.rev, 'r0', '기준의 meta.rev');
  assert.deepEqual(aopts, { ai: { cli: true } });
  assert.deepEqual(s.named('nextRev')[0].slice(1), [undefined, 'r1', 'r0', 'r0']);
  const [, , fopts] = s.named('finalizeRevised')[0];
  assert.deepEqual(fopts, { rev: 'r2', today: TODAY, summary: '예산.비목별[2차년도].연구재료비 12,000 → 15,000' });
  const [, , , popts] = s.named('previewApply')[0];
  assert.equal(popts.file, 'KR_시험용_직류_차단기_개발_r2.yaml');
  assert.equal(popts.current, s.book.projects[0]);
  assert.equal(popts.n, 2);
  assert.equal(popts.today, TODAY);
  assert.match(popts.text, /^# \[재생성 r2\]/);
  // 미리보기
  assert.ok(!s.$('rdgRevPreview').classList.contains('hidden'));
  assert.equal(s.doc.querySelector('.rdg-summary').textContent, '예산.비목별[2차년도].연구재료비 12,000 → 15,000 · 다음 판 r2');
  assert.deepEqual([...s.$('rdgDiff').children].map((li) => li.textContent), ['예산.비목별[2차년도].직접비.연구재료비: 12,000 → 15,000']);
  assert.deepEqual([...s.$('rdgChangelog').children].map((li) => li.textContent), ['2026.10.16 · 예산 · 연구재료비 · 12,000천원 → 15,000천원 · 예산 조정']);
  const warn = s.doc.querySelector('#rdgRevise .rdg-warn').textContent;
  assert.match(warn, /기준이 장부로 지은 YAML 이라/);
  assert.match(warn, /근거 공문 번호 없음/);
  assert.match(s.$('rdgRevYaml').value, /^# \[재생성 r2\] KRS WORKSPACE 변경사항 반영 2026-10-16\n# 변경분: /);
  assert.ok(!s.$('rdgRevApply').disabled && !s.$('rdgRevSave').disabled);
  assert.match(s.msg('rdgReviseMsg'), /^고쳤습니다 — .* \(다음 판 r2\) · API 키 · \$0\.1000\. 미리보기를 보고 반영을 누르세요 \(로컬 CLI 실패 → API 키\)$/);
  assert.equal(s.logs.length, 1);
  assert.deepEqual(s.logs[0].slice(0, 2), ['rnd', true]);
  assert.equal(s.logs[0][2], 'R&D YAML 고침 — SSCB 2차년도 r2: 예산.비목별[2차년도].연구재료비 12,000 → 15,000 (API 키 · $0.1000)');
  assert.equal(s.logs[0][3].rev, 'r2');
});

test('YAML 고치기 — 저장된 원문(store.get)이 기준 · 다음 판은 저장된 판·장부 판·답의 판 가운데 큰 것 + 1 · 붙인 문서는 글자만', async () => {
  const s = setup({
    entries: { 'p1:2': { text: `# [재생성 r2]\n${snapText({ 과제명: P1_NAME, rev: 'r2', 차년도: '2차년도' })}`, rev: 'r2', at: '2026-10-12T03:00:00.000Z', file: 'KR_x_r2.yaml', source: 'revise', summary: '' } },
  });
  s.panel.wire();
  s.view();
  await until(() => s.panel.state().loaded, '저장소');
  s.pickFiles('rdgChangeFile', [fakeFile('변경공문.pdf'), fakeFile('메모.txt'), fakeFile('KR_y.yaml'), fakeFile('옛.hwp')]);
  assert.deepEqual(s.panel.state().revise.files, ['변경공문.pdf', '메모.txt']);
  assert.deepEqual([...s.$('rdgChangeFiles').querySelectorAll('.rdg-file > span')].map((x) => x.textContent), ['변경공문.pdf', '메모.txt']);
  assert.match(s.msg('rdgReviseMsg'), /KR_y\.yaml: YAML 은 붙일 문서가 아닙니다/);
  assert.match(s.msg('rdgReviseMsg'), /옛\.hwp: 옛 한글/);
  // × 로 빼기
  s.$('rdgChangeFiles').querySelector('button[data-rdg-unfile="1"]').click();
  assert.deepEqual(s.panel.state().revise.files, ['변경공문.pdf']);
  s.click('rdgReviseGo');
  await until(() => s.panel.state().revise.result, '미리보기');
  assert.equal(s.named('bookToSnapshot').length, 0);
  const [, args] = s.named('askRevise')[0];
  assert.match(args.baseYaml, /^# \[재생성 r2\]/);
  assert.equal(args.rev, 'r2');
  assert.equal(args.text, '', '글 없이 문서만으로도 된다');
  assert.equal(args.materials.length, 1);
  assert.equal(args.materials[0].name, '변경공문.pdf');
  assert.equal(args.materials[0].file, null, '붙인 문서는 PDF 로 보내지 않는다');
  assert.equal(s.named('readDocument')[0][2].engines, s.engines);
  assert.deepEqual(s.named('nextRev')[0].slice(1), ['r2', 'r1', 'r2', 'r2']);
  assert.equal(s.panel.state().revise.result.rev, 'r3');
  assert.equal(s.panel.state().revise.result.file, 'KR_시험용_직류_차단기_개발_r3.yaml');
  assert.ok(!/장부로 지은/.test(s.doc.querySelector('#rdgRevise .rdg-warn').textContent));
});

test('반영 — intake(source revise · summary) → 미리보기·입력을 비움 · 취소는 미리보기만 · 저장은 download', async () => {
  const s = setup();
  s.panel.wire();
  s.view();
  await until(() => s.panel.state().loaded, '저장소');
  s.$('rdgChange').value = '연구재료비 증액';
  s.click('rdgReviseGo');
  await until(() => s.panel.state().revise.result, '미리보기');
  // 취소 — 미리보기만, 글은 둔다
  s.click('rdgRevCancel');
  assert.ok(s.$('rdgRevPreview').classList.contains('hidden'));
  assert.equal(s.$('rdgChange').value, '연구재료비 증액');
  s.click('rdgReviseGo');
  await until(() => s.panel.state().revise.result, '다시 미리보기');
  s.click('rdgRevSave');
  await until(() => s.named('download').length === 1, '저장');
  assert.deepEqual(s.named('download')[0].slice(2), ['KR_시험용_직류_차단기_개발_r2.yaml', 'text/yaml']);
  assert.deepEqual(s.named('flash')[0], ['flash', 'rdgRevSave', '저장됨 ✓']);
  s.click('rdgRevApply');
  await until(() => s.msg('rdgReviseMsg').startsWith('반영했습니다'), '반영');
  const [, texts, meta] = s.named('intake')[0];
  assert.equal(texts[0].name, 'KR_시험용_직류_차단기_개발_r2.yaml');
  assert.match(texts[0].text, /^# \[재생성 r2\]/);
  assert.deepEqual(meta, { source: 'revise', summary: '예산.비목별[2차년도].연구재료비 12,000 → 15,000' });
  assert.ok(s.$('rdgRevPreview').classList.contains('hidden'));
  assert.equal(s.$('rdgChange').value, '');
  assert.equal(s.panel.state().revise.result, null);
  assert.equal(s.logs.length, 2, '고치기 두 번의 로그 — 반영은 rnd.intake 가 남긴다');
});

test('YAML 고치기 실패 — 오류·실패 로그, 적어 둔 변경 글과 붙인 문서는 그대로 · Claude 없음', async () => {
  const s = setup({ revise: async () => { throw new Error('답을 받지 못했습니다 — 시간 초과'); } });
  s.panel.wire();
  s.view();
  s.$('rdgChange').value = '참여연구자 성춘향 추가';
  s.pickFiles('rdgChangeFile', [fakeFile('공문.pdf')]);
  s.click('rdgReviseGo');
  await until(() => s.msg('rdgReviseMsg').startsWith('YAML 을 고치지 못했습니다'), '오류');
  assert.equal(s.msg('rdgReviseMsg'), 'YAML 을 고치지 못했습니다 — 답을 받지 못했습니다 — 시간 초과');
  assert.ok(s.$('rdgReviseMsg').classList.contains('error'));
  assert.equal(s.$('rdgChange').value, '참여연구자 성춘향 추가');
  assert.deepEqual(s.panel.state().revise.files, ['공문.pdf']);
  assert.deepEqual(s.logs.at(-1).slice(0, 3), ['rnd', false, 'R&D YAML 고치기 실패: 답을 받지 못했습니다 — 시간 초과']);
  assert.equal(s.$('rdgRevise').getAttribute('aria-busy'), null);
  assert.ok(!s.$('rdgReviseGo').disabled);
  s.setAi({ apiKey: '' });
  s.click('rdgReviseGo');
  assert.equal(s.msg('rdgReviseMsg'), NEED_AI);
  assert.equal(s.named('askRevise').length, 1);
});

test('YAML 고치기 — 바쁠 때 aria-busy·잠금, 과제가 바뀌면 입력을 비우고 늦게 온 답은 버린다', async () => {
  const g = gate();
  const s = setup({ revise: async (args) => { await g.p; return { data: { yaml: args.baseYaml, summary: '늦음' }, via: 'cli', note: '' }; } });
  s.panel.wire();
  s.view();
  s.$('rdgChange').value = '바뀐 것';
  s.click('rdgReviseGo');
  await until(() => s.named('askRevise').length === 1, '묻는 중');
  assert.equal(s.$('rdgRevise').getAttribute('aria-busy'), 'true');
  assert.ok(s.$('rdgReviseGo').disabled && s.$('rdgChangeFile').disabled);
  assert.match(s.msg('rdgReviseMsg'), /^Claude 에게 묻는 중 — 기준 YAML 을 고치고 있습니다/);
  // 같은 과제·차년도의 다시 그리기(rndpanel paintAll)는 입력을 지우지 않는다
  s.view();
  assert.equal(s.$('rdgChange').value, '바뀐 것');
  s.view({ project: s.book.projects[1], n: 1 });
  assert.equal(s.$('rdgChange').value, '', '다른 과제로 가면 비운다');
  assert.equal(s.$('rdgRevise').getAttribute('aria-busy'), null);
  g.open();
  await wait(30);
  assert.equal(s.named('finalizeRevised').length, 0);
  assert.equal(s.panel.state().revise.result, null);
  assert.equal(s.logs.length, 0);
});

test('변경사항 카드에 놓기 — 문서는 붙이고 멈추며, YAML 만이면 막지 않는다(rndpanel 의 YAML 넣기로)', () => {
  const s = setup();
  s.panel.wire();
  s.view();
  let bubbled = 0;
  s.doc.getElementById('rnd').addEventListener('drop', () => { bubbled++; });
  const card = s.doc.querySelector('.rdg-revise');
  s.drop(s.$('rdgChange'), [], 'dragover');
  assert.ok(card.classList.contains('over'));
  const a = s.drop(s.$('rdgChange'), [fakeFile('공문.pdf')]);
  assert.ok(a.defaultPrevented);
  assert.equal(bubbled, 0);
  assert.deepEqual(s.panel.state().revise.files, ['공문.pdf']);
  assert.ok(!card.classList.contains('over'));
  const b = s.drop(s.$('rdgChange'), [fakeFile('KR_x.yaml')]);
  assert.ok(!b.defaultPrevented);
  assert.equal(bubbled, 1);
  assert.deepEqual(s.panel.state().revise.files, ['공문.pdf']);
});

test('LLM·사람의 글은 글자로만 — 태그가 DOM 이 되지 않는다', async () => {
  const evil = '<img src=x onerror="globalThis.__pwned=1">';
  const s = setup({
    extract: async () => ({ data: { yaml: snapText({ 과제명: evil, 차년도: '2차년도' }), alias: evil, stage: 2, warnings: evil }, via: 'cli', note: evil }),
    revise: async (args) => ({ data: { yaml: JSON.stringify({ ...parse(args.baseYaml).obj, 예산: { x: 1 } }), summary: evil, warnings: evil }, via: 'cli', note: '' }),
  });
  await extracted(s, { file: fakeFile(`${evil}.pdf`) });
  assert.equal(s.doc.querySelectorAll('#rdgAdd img').length, 0);
  assert.ok(s.doc.querySelector('.rdg-meta').textContent.includes(evil));
  assert.ok(s.msg().includes(evil));
  s.panel.closeAdd();
  s.view();
  s.$('rdgChange').value = evil;
  s.pickFiles('rdgChangeFile', [fakeFile(`${evil}.txt`)]);
  s.click('rdgReviseGo');
  await until(() => s.panel.state().revise.result, '미리보기');
  assert.equal(s.doc.querySelectorAll('#rdgRevise img').length, 0);
  assert.ok(s.doc.querySelector('.rdg-summary').textContent.startsWith(evil));
  assert.ok(s.$('rdgChangeFiles').textContent.includes(evil));
  assert.equal(globalThis.__pwned, undefined);
  assert.equal(s.window.__pwned, undefined);
});
