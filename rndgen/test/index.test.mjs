// rndgen/index.js — 조립과 원문 저장(rndYamlText). rnd 손잡이·저장소는 흉내, 화면은 진짜 panel.js(jsdom 의 host div 둘).
// 본다: import·만들기·wire 가 chrome·fetch 를 만지지 않음 · 손잡이에 새 키가 없어도(통합 앞) 깨지지 않음 · host 가 없으면 카드 없음 ·
// onIntake 훅이 들어간 스냅샷마다 store.put(이름으로 짝짓기 · 붙여 넣기 · 오래된 판·이력 파일은 남기지 않음) · 판이 쌓이면 history ·
// onDelete → 그 과제 것 지움 · 저장 실패는 로그 한 줄 · 저장 뒤 변경사항 카드의 기준 줄이 "저장된 YAML" 로. 과제·사람 이름은 지어낸 것.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// import 만으로 chrome·fetch 를 만지면 여기서 걸린다.
const touched = [];
globalThis.fetch = async () => { touched.push('fetch'); throw new Error('fetch 를 부르면 안 됩니다'); };
const { createRndGen, pairResults } = await import('../index.js');
const { YAML_KEY } = await import('../store.js');

const NOW = Date.parse('2026-10-16T03:00:00Z');
const P1 = { id: 'p1', name: '시험용 직류 차단기 개발', alias: 'SSCB', code: 'RS-2026-00000001', lead: '홍길동', start: '2025-04-01', end: '2028-12-31', calendar: true, note: '', refs: {}, years: {} };

/** chrome.storage.local 흉내 — 받은 set 을 적는다. fail 이면 set 이 던진다. */
function fakeStorage({ fail = false } = {}) {
  const data = {};
  const sets = [];
  return {
    data, sets,
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (obj) => { if (fail) throw new Error('저장 공간이 찼습니다'); sets.push(structuredClone(obj)); Object.assign(data, structuredClone(obj)); },
  };
}

/** rndpanel.js 손잡이 흉내 — 훅을 받아 둔다. full:false 면 통합 앞의 손잡이(새 키 없음). */
function fakeRnd({ full = true } = {}) {
  const hooks = {};
  const base = { wire() {}, show() {}, hide() {}, book: () => ({ projects: [P1], current: { project: 'p1', year: {} } }) };
  if (!full) return { rnd: base, hooks };
  const view = { project: P1, n: 2, editing: false, overlay: null, yearEmpty: false, snapshot: { rev: 'r0', date: '2026-04-01', file: 'KR_시험용_직류_차단기_개발.yaml' } };
  return {
    hooks,
    rnd: {
      ...base,
      current: () => ({ project: P1, n: 2 }), view: () => view,
      onView: (fn) => { hooks.view = fn; }, onAdd: (fn) => { hooks.add = fn; },
      onIntake: (fn) => { hooks.intake = fn; }, onDelete: (fn) => { hooks.del = fn; },
      setOverlay() {}, addManually() {}, intake: async () => ({ ok: true, error: '', lines: [], results: [] }), pick() {}, setAlias: () => ({ ok: true, error: '' }),
      readAsset: async () => '', download: async () => {},
    },
  };
}

function dom(withHosts = true) {
  const { window } = new JSDOM(`<!doctype html><body><section id="rnd" class="rnd">${withHosts ? '<div id="rdgAdd" class="rdg hidden"></div><div id="rdgRevise" class="rdg hidden"></div>' : ''}</section></body>`);
  return { window, $: (id) => window.document.getElementById(id) };
}

const snap = (name, n, rev) => `# [${n}차년도 최초]\nmeta:\n  과제명: ${name}\n  차년도: ${n}차년도\n  rev: ${rev}\n`;
const result = (r) => ({ name: '', kind: 'snapshot', label: '연구개발계획서 스냅샷', summary: '', projectId: 'p1', n: 2, rev: 'r0', applied: true, ...r });

test('import·만들기·wire 는 chrome·fetch 를 만지지 않는다 — 손잡이에 새 키가 없고 host 가 없어도 깨지지 않는다', () => {
  assert.equal(typeof globalThis.chrome, 'undefined');
  const { rnd } = fakeRnd({ full: false });
  const g = createRndGen({ rnd, $: dom(false).$, escapeHtml: String, logEvent: () => {}, ai: () => ({}) });
  g.wire();
  g.wire();
  assert.deepEqual(touched, []);
  assert.equal(typeof g.store.put, 'function');
  assert.equal(g.panel.state().wired, true);
  // $ 를 주지 않아도(검사·다른 화면) 만들 수 있다.
  createRndGen({ rnd }).wire();
});

test('wire — 두 host 안에 카드를 만들고 rnd 의 onView·onAdd·onIntake·onDelete 에 훅을 단다', () => {
  const { rnd, hooks } = fakeRnd();
  const { $ } = dom();
  const g = createRndGen({ rnd, $, escapeHtml: String, logEvent: () => {}, ai: () => ({}), storage: fakeStorage() });
  g.wire();
  assert.ok($('rdgFile') && $('rdgChange'), '두 카드');
  assert.deepEqual(Object.keys(hooks).sort(), ['add', 'del', 'intake', 'view']);
  assert.deepEqual(touched, []);
});

test('pairResults — 정렬된 결과와 넣은 글을 이름으로 짝짓는다(같은 이름은 차례로) · 붙여 넣기는 이름이 빈 글 · 짝이 없으면 글이 하나일 때만', () => {
  const texts = [{ name: 'b_r1.yaml', text: 'B1' }, { name: 'a.yaml', text: 'A' }, { name: 'b_r1.yaml', text: 'B2' }];
  const got = pairResults([{ name: 'a.yaml' }, { name: 'b_r1.yaml' }, { name: 'b_r1.yaml' }, { name: 'c.yaml' }], texts);
  assert.deepEqual(got.map((x) => [x.r.name, x.text]), [['a.yaml', 'A'], ['b_r1.yaml', 'B1'], ['b_r1.yaml', 'B2']]);
  assert.deepEqual(pairResults([{ name: '' }], [{ name: '', text: 'P' }]).map((x) => x.text), ['P']);
  assert.deepEqual(pairResults([{ name: 'KR_A.yaml' }], [{ name: '', text: 'P' }]).map((x) => x.text), ['P'], '하나뿐이면 그것');
  assert.deepEqual(pairResults([{ name: 'x' }], [{ name: 'a', text: '1' }, { name: 'b', text: '2' }]), []);
});

test('onIntake — 들어간 스냅샷마다 rndYamlText 에 남긴다(오래된 판·이력 파일은 남기지 않는다) · 판이 바뀌면 지난 판으로 민다', async () => {
  const { rnd, hooks } = fakeRnd();
  const storage = fakeStorage();
  const logs = [];
  const g = createRndGen({ rnd, $: dom().$, escapeHtml: String, logEvent: (...a) => logs.push(a), ai: () => ({}), storage, now: () => NOW });
  g.wire();
  const r0 = snap(P1.name, 2, 'r0');
  const old = snap(P1.name, 1, 'r0');
  // rndpanel 은 종류·판 차례로 정렬해 돌려준다 — 넣은 차례와 다르다.
  hooks.intake({
    ok: true, error: '', lines: [],
    results: [
      result({ name: 'KR_A.yaml', rev: 'r0' }),
      result({ name: 'KR_A_old.yaml', n: 1, applied: false, summary: '이미 r2 가 들어 있어 넣지 않았습니다' }),
      result({ name: 'budget_history.yaml', kind: 'budget', label: '예산 이력', rev: '' }),
    ],
  }, [{ name: 'budget_history.yaml', text: 'entity: x' }, { name: 'KR_A_old.yaml', text: old }, { name: 'KR_A.yaml', text: r0 }], { source: 'file', summary: '' });
  await g.saved();
  const saved = storage.data[YAML_KEY];
  assert.deepEqual(Object.keys(saved.projects), ['p1']);
  assert.deepEqual(Object.keys(saved.projects.p1), ['2'], '넣지 않은 1차년도(오래된 판)는 남기지 않는다');
  assert.deepEqual(saved.projects.p1['2'], { current: { text: r0, rev: 'r0', at: '2026-10-16T03:00:00.000Z', file: 'KR_A.yaml', source: 'file', summary: '' }, history: [] });
  assert.equal(storage.sets.length, 1);
  // 고치기(source revise)로 r1 이 들어오면 r0 은 지난 판으로
  const r1 = snap(P1.name, 2, 'r1');
  hooks.intake({ ok: true, error: '', lines: [], results: [result({ name: 'KR_A_r1.yaml', rev: 'r1' })] }, [{ name: 'KR_A_r1.yaml', text: r1 }], { source: 'revise', summary: '연구재료비 12,000 → 15,000' });
  await g.saved();
  const slot = storage.data[YAML_KEY].projects.p1['2'];
  assert.deepEqual([slot.current.rev, slot.current.source, slot.current.summary, slot.history.map((h) => h.rev)], ['r1', 'revise', '연구재료비 12,000 → 15,000', ['r0']]);
  // 붙여 넣기(이름 없음)
  const r2 = snap(P1.name, 2, 'r2');
  hooks.intake({ ok: true, error: '', lines: [], results: [result({ name: '', rev: 'r2' })] }, [{ name: '', text: r2 }], { source: 'paste' });
  await g.saved();
  assert.deepEqual(storage.data[YAML_KEY].projects.p1['2'].history.map((h) => h.rev), ['r1', 'r0']);
  assert.equal(storage.data[YAML_KEY].projects.p1['2'].current.source, 'paste');
  // 들어간 스냅샷이 없으면 쓰지 않는다
  const before = storage.sets.length;
  hooks.intake({ ok: false, error: '못 읽음', lines: [], results: [] }, [{ name: 'x.yaml', text: 'x' }], { source: 'file' });
  await g.saved();
  assert.equal(storage.sets.length, before);
  assert.deepEqual(logs, []);
});

test('onDelete — 그 과제의 원문을 지운다 · 저장이 실패하면 로그 한 줄(장부 넣기는 이미 됐다)', async () => {
  const { rnd, hooks } = fakeRnd();
  const storage = fakeStorage();
  const g = createRndGen({ rnd, $: dom().$, escapeHtml: String, logEvent: () => {}, ai: () => ({}), storage, now: () => NOW });
  g.wire();
  hooks.intake({ ok: true, error: '', lines: [], results: [result({ name: 'a.yaml' }), result({ name: 'b.yaml', projectId: 'p2', n: 1 })] }, [{ name: 'a.yaml', text: 'A: 1' }, { name: 'b.yaml', text: 'B: 1' }], { source: 'extract' });
  await g.saved();
  assert.deepEqual(Object.keys(storage.data[YAML_KEY].projects).sort(), ['p1', 'p2']);
  hooks.del('p1');
  await g.saved();
  assert.deepEqual(Object.keys(storage.data[YAML_KEY].projects), ['p2']);
  hooks.del('없는 과제');
  await g.saved();

  const logs = [];
  const bad = fakeRnd();
  const g2 = createRndGen({ rnd: bad.rnd, $: dom().$, escapeHtml: String, logEvent: (...a) => logs.push(a), ai: () => ({}), storage: fakeStorage({ fail: true }), now: () => NOW });
  g2.wire();
  bad.hooks.intake({ ok: true, error: '', lines: [], results: [result({ name: 'a.yaml' })] }, [{ name: 'a.yaml', text: 'A: 1' }], { source: 'file' });
  await g2.saved();
  assert.deepEqual(logs, [['rnd', false, 'R&D YAML 원문 저장 실패: 저장 공간이 찼습니다']]);
});

test('저장이 끝나면 변경사항 카드의 기준 줄이 "저장된 YAML rN · 날짜" 로 바뀐다(장부로 지음 → 원문)', async () => {
  const { rnd, hooks } = fakeRnd();
  const { $ } = dom();
  const storage = fakeStorage();
  const g = createRndGen({ rnd, $, escapeHtml: String, logEvent: () => {}, ai: () => ({}), storage, now: () => Date.parse('2026-10-16T12:00:00Z') });
  g.wire();
  hooks.view(rnd.view());
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!$('rdgRevise').classList.contains('hidden'));
  assert.match($('rdgBase').textContent, /장부로 지음/);
  hooks.intake({ ok: true, error: '', lines: [], results: [result({ name: 'KR_A_r2.yaml', rev: 'r2' })] }, [{ name: 'KR_A_r2.yaml', text: snap(P1.name, 2, 'r2') }], { source: 'revise', summary: '참여연구자 이몽룡 추가' });
  await g.saved();
  assert.equal($('rdgBase').textContent, '기준: 저장된 YAML r2 · 10.16');
  assert.deepEqual(touched, []);
});
