// 설정 → LLM 갈래의 "다리가 하는 일" 표(src/bridgeuse.js): 다섯 줄의 차례와, 다리·API 키·브라우저 꾸러미의 있고 없음에 따른 상태 조합.
import assert from 'node:assert/strict';
import { bridgeUses } from '../src/bridgeuse.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const ids = (rows) => rows.map((r) => r.id);
const states = (rows) => rows.map((r) => r.state);
const via = (rows, id) => rows.find((r) => r.id === id).via;

console.log('모양');
t('다섯 줄이 claude · doctext · git · logs · help 차례로', () =>
  assert.deepEqual(ids(bridgeUses()), ['claude', 'doctext', 'git', 'logs', 'help']));
t('줄마다 id · label · via · state 네 칸이 다 있고 state 는 on/alt/off 중 하나', () => {
  for (const r of bridgeUses({ cli: true })) {
    assert.deepEqual(Object.keys(r).sort(), ['id', 'label', 'state', 'via'], r.id);
    assert.ok(r.label && r.via, r.id);
    assert.ok(['on', 'alt', 'off'].includes(r.state), r.id);
  }
});
t('하는 일의 이름은 상태와 무관하게 같다', () => {
  const on = bridgeUses({ cli: true }), off = bridgeUses();
  for (let i = 0; i < 5; i++) assert.equal(on[i].label, off[i].label, on[i].id);
});
t('label 에 패널의 말(말로 찾기 · 증빙 · 공문 읽기 · OCR · GitHub · native\\logs)이 들어 있다', () => {
  const rows = bridgeUses();
  assert.match(via(rows, 'claude') && rows[0].label, /말로 찾기.*증빙.*공문 읽기/);
  assert.match(rows[1].label, /PDF 글자 층·OCR/);
  assert.match(rows[2].label, /GitHub/);
  assert.match(rows[3].label, /native\\logs/);
  assert.match(rows[4].label, /Help Chat.*커밋·푸시·포크/);
});
t('부를 때마다 새 배열·새 줄(앞 결과를 고쳐도 다음 결과에 안 남는다)', () => {
  const a = bridgeUses({ cli: true });
  a[0].via = '고침';
  assert.equal(bridgeUses({ cli: true })[0].via, '다리(로컬 CLI)');
});

console.log('다리가 닿을 때 — 다섯 줄 모두 다리가 맡는다');
t('API 키·꾸러미가 있어도 전부 on', () => {
  const rows = bridgeUses({ cli: true, apiKey: 'sk-ant-x', docText: { ok: true, reason: '' } });
  assert.deepEqual(states(rows), ['on', 'on', 'on', 'on', 'on']);
});
t('via 문구 — 로컬 CLI · node 의 pdf.js·Tesseract · 다리 · 다리', () => {
  const rows = bridgeUses({ cli: true });
  assert.equal(via(rows, 'claude'), '다리(로컬 CLI)');
  assert.equal(via(rows, 'doctext'), '다리(node 의 pdf.js·Tesseract)');
  assert.equal(via(rows, 'git'), '다리');
  assert.equal(via(rows, 'logs'), '다리');
  assert.equal(via(rows, 'help'), '다리(떼어 띄운 Claude Code)');
});

console.log('다리가 없을 때');
t('아무것도 없으면 다섯 줄 모두 off', () => {
  const rows = bridgeUses();
  assert.deepEqual(states(rows), ['off', 'off', 'off', 'off', 'off']);
  assert.equal(via(rows, 'claude'), '없음 — 규칙 해석만');
  assert.equal(via(rows, 'doctext'), '파일째 보냄 — 꾸러미 없음');
  assert.equal(via(rows, 'git'), '없음 — 아이콘 숨김');
  assert.equal(via(rows, 'logs'), '없음');
  assert.equal(via(rows, 'help'), '없음 — 머리의 B 로 연결');
});
t('인자를 통째로 빼도, 빈 객체를 줘도 같다', () =>
  assert.deepEqual(bridgeUses(), bridgeUses({})));
t('API 키가 있으면 Claude 호출만 alt(API 키), 나머지는 그대로 off', () => {
  const rows = bridgeUses({ cli: false, apiKey: 'sk-ant-x' });
  assert.deepEqual(states(rows), ['alt', 'off', 'off', 'off', 'off']);
  assert.equal(via(rows, 'claude'), 'API 키');
});
t('공백만 넣은 키는 없는 것', () => assert.equal(bridgeUses({ apiKey: '   ' })[0].state, 'off'));
t('브라우저 꾸러미가 있으면 첨부 글자 뽑기만 alt(브라우저)', () => {
  const rows = bridgeUses({ docText: { ok: true, reason: '' } });
  assert.deepEqual(states(rows), ['off', 'alt', 'off', 'off', 'off']);
  assert.equal(via(rows, 'doctext'), '브라우저(확장 안의 pdf.js·Tesseract)');
});
t('API 키 + 꾸러미 — Claude 호출 alt · 글자 뽑기 alt · GitHub·기록·Help Chat 은 off', () => {
  const rows = bridgeUses({ apiKey: 'sk-ant-x', docText: { ok: true, reason: '' } });
  assert.deepEqual(states(rows), ['alt', 'alt', 'off', 'off', 'off']);
});
t('꾸러미가 없으면 그 까닭이 via 에 붙는다', () => {
  const rows = bridgeUses({ docText: { ok: false, reason: '꾸러미 없음 — 저장소 폴더에서 npm install (vendor/doctext)' } });
  assert.equal(rows[1].state, 'off');
  assert.equal(via(rows, 'doctext'), '파일째 보냄 — 꾸러미 없음 — 저장소 폴더에서 npm install (vendor/doctext)');
});
t('까닭이 비었으면 "꾸러미 없음"', () => {
  assert.equal(via(bridgeUses({ docText: { ok: false, reason: '' } }), 'doctext'), '파일째 보냄 — 꾸러미 없음');
  assert.equal(via(bridgeUses({ docText: { ok: false } }), 'doctext'), '파일째 보냄 — 꾸러미 없음');
});
t('확인 전(패널이 막 떴을 때)의 까닭도 그대로 보인다', () =>
  assert.equal(via(bridgeUses({ docText: { ok: false, reason: '확인 전' } }), 'doctext'), '파일째 보냄 — 확인 전'));
t('docText 가 null·undefined 여도 넘어지지 않는다', () => {
  assert.equal(bridgeUses({ docText: null })[1].via, '파일째 보냄 — 꾸러미 없음');
  assert.equal(bridgeUses({ docText: undefined })[1].via, '파일째 보냄 — 꾸러미 없음');
});

console.log(`통과 ${pass}건`);
