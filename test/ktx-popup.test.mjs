import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { korailPopupPage } from '../src/korailreserve.js';
const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
const POPUP_URL = 'https://www.korail.com/popup/notice';

function popup(body, opts) {
  const dom = new JSDOM(`<body>${body}</body>`, { url: POPUP_URL, pretendToBeVisual: true });
  dom.window.Element.prototype.getClientRects = function () {
    return this.isConnected && !this.hidden ? [{}] : [];
  };
  const clicks = [];
  dom.window.document.addEventListener('click', (event) => {
    clicks.push(event.target.textContent.trim() || event.target.value);
  });
  const saved = { document: globalThis.document, location: globalThis.location, getComputedStyle: globalThis.getComputedStyle };
  Object.assign(globalThis, {
    document: dom.window.document,
    location: dom.window.location,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  });
  try { return { result: korailPopupPage(opts), clicks }; }
  finally { Object.assign(globalThis, saved); dom.window.close(); }
}

test('별도 팝업 — 안내라는 말이 없는 정차역 진행 확인도 네를 누른다', () => {
  const { result, clicks } = popup('<p>정차역 수가 적어 가격이 최대 0.6% 높습니다. 계속 진행하시겠습니까?</p>'
    + '<button>아니오</button><button>네</button><button>확인</button><button>결제하기</button>');
  assert.equal(result.clicked, true);
  assert.match(result.words, /정차역 수/);
  assert.deepEqual(clicks, ['네']);
});

test('별도 팝업 — 계속 진행 안내의 input 버튼과 기존 확인 버튼을 지원한다', () => {
  const cases = [
    ['<p>계속 진행하려면 네를 선택하세요.</p><input type="button" value="네">', ['네']],
    ['<p>선택하신 열차 이용안내</p><a>확인</a>', ['확인']],
    ['<p>이용안내</p><input type="button" value="확인">', ['확인']],
  ];
  for (const [body, expected] of cases) {
    const { result, clicks } = popup(body);
    assert.equal(result.clicked, true);
    assert.deepEqual(clicks, expected);
  }
});

test('별도 팝업 — 무관한 확인·네 및 결제·취소 진행은 누르지 않는다', () => {
  const cases = [
    '<p>광고</p><button>확인</button>',
    '<p>이용안내</p><button>네</button>',
    '<p>예매 안내</p><button>결제하기</button>',
    '<p>결제를 계속 진행하시겠습니까?</p><button>네</button><button>확인</button>',
    '<p>예매 취소를 계속 진행하시겠습니까?</p><button>네</button>',
    '<p>환불을 진행하시겠습니까?</p><button>네</button>',
  ];
  for (const body of cases) {
    const { result, clicks } = popup(body);
    assert.equal(result.clicked, false, body);
    assert.deepEqual(clicks, [], body);
  }
});

test('별도 팝업 — 숨겨진 단추와 비활성 단추는 누르지 않는다', () => {
  const { result, clicks } = popup('<p>계속 진행하시겠습니까?</p>'
    + '<button hidden>네</button><button style="visibility:hidden">네</button>'
    + '<button disabled>네</button><a aria-disabled="true">네</a>');
  assert.equal(result.clicked, false);
  assert.deepEqual(clicks, []);
  assert.deepEqual(popup('<p>이용안내</p><button hidden>확인</button><button>확인</button>').clicks, ['확인']);
});

test('별도 팝업 — observeOnly는 처리할 안내 여부만 읽고 어떤 단추도 누르지 않는다', () => {
  const cases = [
    ['<p>계속 진행하시겠습니까?</p><button>네</button>', true],
    ['<p>이용안내</p><button>확인</button>', true],
    ['<p>광고</p><button>확인</button>', false],
    ['<p>이용안내</p><button hidden>확인</button>', false],
    ['<p>결제를 진행하시겠습니까?</p><button>네</button>', false],
    ['', false],
  ];
  for (const [body, actionable] of cases) {
    const { result, clicks } = popup(body, { observeOnly: true });
    assert.equal(result.actionable, actionable, body);
    assert.equal(result.clicked, false, body);
    assert.deepEqual(clicks, [], body);
  }
});

test('별도 팝업 — 300자 뒤에서 바뀌는 긴 안내도 읽기 결과에서 구분한다', () => {
  const shared = '이용안내 '.repeat(80);
  const first = popup(`<p>${shared}첫 번째 정차역 안내</p><button>확인</button>`, { observeOnly: true });
  const next = popup(`<p>${shared}다음 정차역 안내</p><button>확인</button>`, { observeOnly: true });
  assert.equal(first.result.words.slice(0, 300), next.result.words.slice(0, 300));
  assert.notEqual(first.result.words, next.result.words);
  assert.equal(first.result.actionable, true);
  assert.equal(next.result.actionable, true);
  assert.deepEqual(first.clicks, []);
  assert.deepEqual(next.clicks, []);
});

test('별도 팝업 — 기다리기 전에 읽은 안내와 주소가 같을 때만 확인을 누른다', () => {
  const body = '<p>선택하신 열차 이용안내</p><button>확인</button>';
  const seen = popup(body, { observeOnly: true }).result;
  const matched = popup(body, { expectedWords: seen.words, expectedUrl: POPUP_URL });
  assert.equal(matched.result.clicked, true);
  assert.deepEqual(matched.clicks, ['확인']);
  for (const changed of [
    { expectedWords: '이전 열차 이용안내 확인', expectedUrl: POPUP_URL },
    { expectedWords: seen.words, expectedUrl: 'https://www.korail.com/popup/another' },
  ]) {
    const skipped = popup(body, changed);
    assert.equal(skipped.result.clicked, false);
    assert.deepEqual(skipped.clicks, [], '1초 동안 안내나 주소가 바뀌면 새 안내를 즉시 누르지 않는다');
  }
});
