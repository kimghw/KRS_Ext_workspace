// 백엔드 선택: 로컬 CLI → API 키 → 규칙 해석 순으로 내려가는지 확인한다.
import assert from 'node:assert/strict';

const TODAY = '2026-09-16';
let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const CLI_FILTER = { summary: 'CLI 해석', dateFrom: '2026-09-20', dateTo: '2026-09-20', hourFrom: 8, hourTo: 12, minSeats: 10, minHours: null, region: null };
const CLI_DIAGNOSIS = { verdict: 'rejected', siteMessage: '이미 예약된 시간입니다', cause: '같은 시간에 다른 예약이 있습니다.', fix: '' };

/**
 * chrome.runtime.sendNativeMessage 와 fetch 를 상황별로 흉내낸다.
 * native 에 객체를 주면 CLI 가 그것을 답으로 돌려준다(명세와 다른 답을 흉내 낼 때 쓴다).
 */
function setup({ native, api }) {
  globalThis.chrome = {
    runtime: {
      sendNativeMessage: async (_host, msg) => {
        if (native === 'absent') throw new Error('호스트를 찾을 수 없습니다');
        if (msg.task === 'ping') return { ok: true, pong: true };
        if (native === 'error') return { ok: false, error: 'CLI 오류' };
        if (native && typeof native === 'object') return { ok: true, costUsd: 0.01, data: native };
        return { ok: true, costUsd: 0.01, data: msg.task === 'diagnose' ? CLI_DIAGNOSIS : CLI_FILTER };
      },
    },
  };
  globalThis.fetch = async () => {
    if (api === 'error') return { ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) };
    return {
      ok: true,
      json: async () => ({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ summary: 'API 해석', dateFrom: '2026-09-21', dateTo: '2026-09-21', hourFrom: 9, hourTo: 18, minSeats: null, minHours: null, region: null }) }],
      }),
    };
  };
}

const load = async () => import(`../src/llm.js?b=${Math.random()}`);

console.log('해석 백엔드 선택');

await ta('CLI 가 되면 CLI 를 쓴다', async () => {
  setup({ native: 'ok', api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('9월 20일 8시~12시 10명', { apiKey: 'sk-x', today: TODAY, useNative: true });
  assert.equal(r.via, 'cli');
  assert.equal(r.filter.summary, 'CLI 해석');
});

await ta('CLI 가 실패하면 API 키로 내려간다', async () => {
  setup({ native: 'error', api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('아무거나', { apiKey: 'sk-x', today: TODAY, useNative: true });
  assert.equal(r.via, 'api');
  assert.ok(r.note.includes('로컬 CLI 실패'), r.note);
});

await ta('둘 다 실패하면 규칙으로 내려간다', async () => {
  setup({ native: 'error', api: 'error' });
  const { parseSmart } = await load();
  const r = await parseSmart('내일 오후 10명', { apiKey: 'sk-x', today: TODAY, useNative: true });
  assert.equal(r.via, 'local');
  assert.equal(r.filter.dateFrom, '2026-09-17');
  assert.equal(r.filter.minSeats, 10);
});

await ta('설정이 아무것도 없으면 바로 규칙을 쓴다', async () => {
  setup({ native: 'absent', api: 'error' });
  const { parseSmart } = await load();
  const r = await parseSmart('9/22 오전 부산', { apiKey: '', today: TODAY, useNative: false });
  assert.equal(r.via, 'local');
  assert.equal(r.filter.region, '부산');
});

await ta('CLI 를 끄면 API 를 쓴다', async () => {
  setup({ native: 'ok', api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('아무거나', { apiKey: 'sk-x', today: TODAY, useNative: false });
  assert.equal(r.via, 'api');
});

console.log('CLI 연결 확인');
await ta('호스트가 있으면 ok', async () => {
  setup({ native: 'ok', api: 'ok' });
  const { nativeProbe } = await load();
  assert.deepEqual(await nativeProbe(), { ok: true, error: '' });
});
await ta('호스트가 없으면 ok 가 아니고, 브라우저가 댄 까닭을 같이 준다 (예외를 밖으로 던지지 않는다)', async () => {
  setup({ native: 'absent', api: 'ok' });
  const { nativeProbe } = await load();
  assert.deepEqual(await nativeProbe(), { ok: false, error: '호스트를 찾을 수 없습니다' });
});

console.log('실패 원인 분석 백엔드');
await ta('CLI 로 분석한다', async () => {
  setup({ native: 'ok', api: 'ok' });
  const { diagnoseSmart } = await load();
  const r = await diagnoseSmart({ 보낸값: {} }, { apiKey: 'sk-x', useNative: true });
  assert.equal(r.via, 'cli');
});
await ta('둘 다 안 되면 null 을 주고 조용히 넘어간다', async () => {
  setup({ native: 'absent', api: 'error' });
  const { diagnoseSmart } = await load();
  assert.equal(await diagnoseSmart({}, { apiKey: '', useNative: false }), null);
});
await ta('설명의 모양이 명세와 다르면 보여 주지 않는다 (조회 조건 모양의 답은 진단이 아니다)', async () => {
  setup({ native: CLI_FILTER, api: 'error' });
  const { diagnoseSmart } = await load();
  assert.equal(await diagnoseSmart({ 보낸값: {} }, { apiKey: 'sk-x', useNative: true }), null);
});
await ta('빈 문구는 null 로 온다', async () => {
  setup({ native: 'ok', api: 'ok' });
  const { diagnoseSmart } = await load();
  const r = await diagnoseSmart({ 보낸값: {} }, { apiKey: '', useNative: true });
  assert.deepEqual(r.result, { verdict: 'rejected', siteMessage: '이미 예약된 시간입니다', cause: '같은 시간에 다른 예약이 있습니다.', fix: null });
});

console.log('입력 명세의 관문 — 구조가 틀린 답은 실행자에 가지 않는다');
await ta('CLI 의 답이 명세와 다르면 그 길은 실패로 치고 API 로 내려간다', async () => {
  setup({ native: { ...CLI_FILTER, dateFrom: '9월 20일' }, api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('아무거나', { apiKey: 'sk-x', today: TODAY, useNative: true });
  assert.equal(r.via, 'api');
  assert.equal(r.note, '로컬 CLI 실패(답이 입력 명세와 다릅니다 — dateFrom 값(9월 20일)이 틀렸습니다)');
});
await ta('끝이 시작보다 앞선 조건도 받지 않는다 — 규칙 해석까지 내려간다', async () => {
  setup({ native: { ...CLI_FILTER, hourFrom: 14, hourTo: 14 }, api: 'error' });
  const { parseSmart } = await load();
  const r = await parseSmart('내일 오후', { apiKey: 'sk-x', today: TODAY, useNative: true });
  assert.equal(r.via, 'local');
  assert.deepEqual([r.filter.hourFrom, r.filter.hourTo], [12, 18]);
  assert.match(r.note, /종료 시가 시작 시보다 늦어야 합니다/);
});
await ta('명세에 없는 키는 버리고, 문자로 온 수는 수로 바꾼다', async () => {
  setup({ native: { ...CLI_FILTER, hourFrom: '8', run: 'reserve', url: 'https://example.org' }, api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('아무거나', { apiKey: '', today: TODAY, useNative: true });
  assert.equal(r.via, 'cli');
  assert.deepEqual(Object.keys(r.filter).sort(), ['dateFrom', 'dateTo', 'hourFrom', 'hourTo', 'minHours', 'minSeats', 'region', 'summary']);
  assert.equal(r.filter.hourFrom, 8);
});
await ta('필수가 아닌 칸이 틀리면 그 칸만 비우고 무엇을 뺐는지 알린다', async () => {
  setup({ native: { ...CLI_FILTER, region: '대전' }, api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('대전 회의실', { apiKey: '', today: TODAY, useNative: true });
  assert.equal(r.via, 'cli');
  assert.equal(r.filter.region, null);
  assert.equal(r.note, '지역 값(대전)은 받을 수 없어 뺐습니다');
});
await ta('차량은 좌석 수·지역 조건을 받지 않는다 — 비우고 알린다 (종류는 화면이 정한다)', async () => {
  setup({ native: { ...CLI_FILTER, region: '부산' }, api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('부산 10명 차량', { apiKey: '', today: TODAY, useNative: true, kind: 'car' });
  assert.deepEqual([r.filter.minSeats, r.filter.region], [null, null]);
  assert.match(r.note, /차량은 좌석 수를 알 수 없어 인원 조건은 뺐습니다/);
  assert.match(r.note, /차량은 지역을 가리지 않아 지역 조건은 뺐습니다/);
});
await ta('규칙 해석도 같은 관문을 지난다 — 기본값으로 돌았는지는 따로 알려 준다', async () => {
  setup({ native: 'absent', api: 'error' });
  const { parseSmart } = await load();
  const r = await parseSmart('회의실 좀', { apiKey: '', today: TODAY, useNative: false });
  assert.equal(r.via, 'local');
  assert.equal(r.guessed, true);
  assert.equal('guessed' in r.filter, false);
});

console.log('근태 폼 말로 채우기');
{
  const sent = [];
  /** 근태 채우기는 attend 작업으로 간다. 다리와 API 가 무엇을 받았는지 적어 둔다. */
  const setupAttend = ({ native, api }) => {
    globalThis.chrome = {
      runtime: {
        sendNativeMessage: async (_host, msg) => {
          sent.push(msg);
          if (native === 'error') return { ok: false, error: 'CLI 오류' };
          return { ok: true, costUsd: 0.002, data: { kind: 'out', dateFrom: '2026-09-17', start: '14:00', end: '16:00', place: '부산시청', purpose: null, reply: '외근으로 채웠습니다. 목적이 비어 있습니다.' } };
        },
      },
    };
    globalThis.fetch = async (_url, init) => {
      sent.push(JSON.parse(init.body));
      if (api === 'error') return { ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) };
      return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ kind: 'trip', dateFrom: '2026-09-21', reply: 'API 가 채움' }) }] }) };
    };
  };
  const form = { kind: 'out', dateFrom: TODAY, place: '', purpose: '', file: { name: 'a.pdf', dataUrl: 'data:application/pdf;base64,SECRET' } };

  await ta('CLI 가 되면 attend 작업으로 보내고, 답을 그대로 돌려준다', async () => {
    setupAttend({ native: 'ok', api: 'ok' });
    const { fillAttendSmart } = await load();
    const r = await fillAttendSmart('내일 2시부터 4시까지 부산시청 외근', { apiKey: 'sk-x', today: TODAY, useNative: true, form, history: [{ who: 'me', text: '외근 올릴게' }] });
    assert.equal(r.via, 'cli');
    assert.equal(r.patch.place, '부산시청');
    assert.match(r.reply, /목적이 비어/);
    const msg = sent.at(-1);
    assert.equal(msg.task, 'attend');
    assert.match(msg.input, /오늘은 2026-09-16 \(수요일\)/);
    assert.match(msg.input, /지금 폼: \{"kind":"out"/);
    assert.match(msg.input, /사용자: 외근 올릴게/);
    assert.match(msg.input, /새 요청: 내일 2시부터 4시까지 부산시청 외근/);
  });
  await ta('첨부파일 내용은 Claude 에게 보내지 않는다', async () => {
    assert.ok(!sent.at(-1).input.includes('SECRET'));
    assert.match(sent.at(-1).input, /"file":"\(첨부 있음\)"/);
  });
  await ta('CLI 가 실패하면 API 키로 내려가고, 구조화 출력으로 묻는다', async () => {
    setupAttend({ native: 'error', api: 'ok' });
    const { fillAttendSmart } = await load();
    const r = await fillAttendSmart('출장', { apiKey: 'sk-x', today: TODAY, useNative: true, form });
    assert.equal(r.via, 'api');
    assert.equal(r.patch.kind, 'trip');
    assert.ok(r.note.includes('로컬 CLI 실패'), r.note);
    const body = sent.at(-1);
    assert.equal(body.output_config.format.type, 'json_schema');
    assert.ok(body.output_config.format.schema.required.includes('reply'));
    // 2026-10-05 사용자 지정: "모두 opus 5.5로 변경해줘" — 다리와 같은 모델·같은 깊이다. Opus 5.5 가 400 으로 받지 않는 칸
    // (temperature·thinking 끄기/토큰 상한·억지 tool_choice·미리 적은 assistant 글)은 보내지 않고, 생각까지 드는 답의 한도는 넉넉히 준다.
    assert.deepEqual([body.model, body.output_config.effort, body.max_tokens], ['claude-opus-5-5', 'low', 16000]);
    assert.deepEqual(['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice'].filter((k) => k in body), []);
    assert.deepEqual(body.messages.map((m) => m.role), ['user']);
  });
  await ta('틀린 값은 폼에 얹지 않고 무엇을 뺐는지 알린다 — 달력에 없는 날, 없는 갈래', async () => {
    globalThis.chrome = { runtime: { sendNativeMessage: async () => ({ ok: true, data: { kind: 'leave', sub: 'XX', dateFrom: '2026-02-30', start: '9:00', reply: '휴가로 채웠습니다.', fn: 'apprRequest' } }) } };
    const { fillAttendSmart } = await load();
    const r = await fillAttendSmart('2월 30일 휴가', { apiKey: '', today: TODAY, useNative: true, form });
    assert.deepEqual(r.patch, { kind: 'leave', start: '09:00' });
    assert.equal(r.reply, '휴가로 채웠습니다.');
    assert.ok(r.note.includes('종류 안의 갈래 값(XX)은 받을 수 없어 뺐습니다'), r.note);
    assert.ok(r.note.includes('날짜 값(2026-02-30)은 받을 수 없어 뺐습니다'), r.note);
  });
  await ta('말하지 않은 칸(null)은 조각에 들어가지 않는다 — null 은 지우기가 아니다', async () => {
    globalThis.chrome = { runtime: { sendNativeMessage: async () => ({ ok: true, data: { kind: null, sub: null, start: null, end: '17:00', place: null, purpose: null, reply: '종료 시각을 채웠습니다.' } }) } };
    const { fillAttendSmart } = await load();
    const r = await fillAttendSmart('5시까지로', { apiKey: '', today: TODAY, useNative: true, form });
    assert.deepEqual(r.patch, { end: '17:00' });
  });
  await ta('둘 다 안 되면 규칙으로 종류·날짜·시각만 읽는다', async () => {
    setupAttend({ native: 'error', api: 'error' });
    const { fillAttendSmart } = await load();
    const r = await fillAttendSmart('내일 2시부터 4시까지 부산시청 외근', { apiKey: 'sk-x', today: TODAY, useNative: true, form });
    assert.equal(r.via, 'local');
    assert.deepEqual(r.patch, { kind: 'out', sub: 'OD', dateFrom: '2026-09-17', start: '14:00', end: '16:00' });
    assert.match(r.note, /로컬 CLI 실패.*API 실패/);
  });
}

console.log('출장 증빙 읽기 — 파일을 같이 보낸다(규칙 해석은 없다)');
await ta('API 로 보낼 때 이미지는 image, PDF 는 document 블록으로 글 앞에 붙고, 명세(receipt)를 지난 기록이 돌아온다', async () => {
  setup({ native: 'absent', api: 'ok' });
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
      docType: 'lodging_receipt', vendor: '부산호텔', bizNo: '123-45-67890', payDate: '2026-09-10', checkIn: '2026-09-09', checkOut: '2026-09-10', nights: 1,
      total: 143000, supply: 130000, vat: 13000, currency: 'KRW', corporateCard: null, airline: null, flightNo: null, flightDate: null, depPlace: null, arrPlace: null,
      depTime: null, arrTime: null, seatClass: null, mileage: null, passenger: '김거화', extra: '조식 포함', summary: '부산호텔 1박 영수증',
    }) }] }) };
  };
  const { receiptSmart } = await load();
  const png = { name: 'r.png', type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' };
  const r = await receiptSmart(png, { trip: { from: '2026-09-09', to: '2026-09-10', location: '고양' }, me: '김거화' }, { apiKey: 'sk-x', useNative: false });
  assert.equal(r.via, 'api');
  assert.deepEqual([r.record.docType, r.record.vendor, r.record.total, r.record.nights, r.record.extra], ['lodging_receipt', '부산호텔', 143000, 1, '조식 포함']);
  const content = sent[0].messages[0].content;
  assert.deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
  assert.match(content[1].text, /출장 정보: 2026-09-09 ~ 2026-09-10 · 출장지 고양 · 출장자 김거화/);
  assert.match(content[1].text, /파일 이름: r\.png/);
  await receiptSmart({ name: 'r.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,BBBB' }, { trip: {} }, { apiKey: 'sk-x' });
  assert.deepEqual(sent[1].messages[0].content[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' } });
});
await ta('로컬 CLI 로 보낼 때는 파일이 files 로 같이 간다. 둘 다 안 되면 던진다', async () => {
  const got = [];
  globalThis.chrome = { runtime: { sendNativeMessage: async (_h, msg) => { got.push(msg); return { ok: true, costUsd: 0.01, data: { docType: 'flight_ticket', airline: '대한항공', summary: '항공권' } }; } } };
  const { receiptSmart } = await load();
  const file = { name: 't.png', type: 'image/png', dataUrl: 'data:image/png;base64,CCCC' };
  const r = await receiptSmart(file, { trip: {} }, { useNative: true });
  assert.equal(r.via, 'cli');
  assert.deepEqual([r.record.docType, r.record.airline, r.record.total], ['flight_ticket', '대한항공', null]);
  assert.deepEqual(got[0].files, [file]);
  setup({ native: 'absent', api: 'error' });
  const { receiptSmart: again } = await load();
  await assert.rejects(again(file, { trip: {} }, { apiKey: 'sk-x', useNative: true }), /증빙을 읽지 못했습니다/);
});

console.log('API 길의 글자 먼저 뽑기 — 첨부가 있는 receipt·gongmun.* 은 docText(doctext/index.js)를 지나고, 그 결과가 본문에 실린다');
{
  const sent = [];
  const RECEIPT = {
    docType: 'lodging_receipt', vendor: '부산호텔', bizNo: null, payDate: '2026-09-10', checkIn: '2026-09-09', checkOut: '2026-09-10', nights: 1,
    total: 143000, supply: null, vat: null, currency: 'KRW', corporateCard: null, airline: null, flightNo: null, flightDate: null, depPlace: null, arrPlace: null,
    depTime: null, arrTime: null, seatClass: null, mileage: null, passenger: null, extra: null, summary: '부산호텔 1박 영수증',
  };
  const PURCHASE = { docType: 'quote', gist: '모니터', vendor: 'OO상사', total: 1000, summary: 'OO상사 모니터 견적서' };
  const pdf = { name: 'q.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,PDFPDF' };
  const png = { name: 'r.png', type: 'image/png', dataUrl: 'data:image/png;base64,PNGPNG' };
  /** 다리는 없고 API 만 있다. fetch 는 받은 본문을 적어 두고 정해 둔 답을 준다. */
  const setupApi = (answer) => {
    globalThis.chrome = { runtime: { sendNativeMessage: async () => { throw new Error('호스트를 찾을 수 없습니다'); } } };
    globalThis.fetch = async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] }) };
    };
  };
  /** 마지막 요청의 사용자 내용 블록들 — 첨부가 없으면 글 하나(string)로 가므로(src/ai.js) 같은 모양으로 맞춘다. */
  const blocks = () => { const c = sent.at(-1).messages[0].content; return Array.isArray(c) ? c : [{ type: 'text', text: c }]; };
  /** 가짜 docText(doctext/index.js 의 모양 { input, files, read, lean }) — 무엇을 받았는지 calls 에 적는다. */
  const fakeDocText = (calls, out) => async (input, files) => { calls.push({ input, files }); return typeof out === 'function' ? out(input, files) : out; };

  await ta('receipt: docText 가 입력 글과 첨부를 받고, 글자만 돌려주면(lean) 본문에 image·document 블록 없이 뽑은 글이 간다 — read 가 돌아온다', async () => {
    setupApi(RECEIPT);
    const calls = [];
    const docText = fakeDocText(calls, (input) => ({ input: `${input}\n\n[첨부 글자]\n부산호텔 1박 143,000원`, files: [], read: ['q.pdf: PDF 글자 층 1쪽 — 파일은 보내지 않음'], lean: true }));
    const { receiptSmart } = await load();
    const r = await receiptSmart(pdf, { trip: { from: '2026-09-09', to: '2026-09-10' }, me: '김거화' }, { apiKey: 'sk-x', useNative: false, docText });
    assert.equal(r.via, 'api');
    assert.equal(r.record.vendor, '부산호텔');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].files, [pdf]);
    assert.match(calls[0].input, /출장 정보: 2026-09-09 ~ 2026-09-10 · 출장자 김거화/);   // receiptInput 의 글이 그대로 docText 에 간다
    assert.match(calls[0].input, /파일 이름: q\.pdf/);
    const got = blocks();
    assert.deepEqual(got.map((b) => b.type), ['text']);
    assert.match(got[0].text, /파일 이름: q\.pdf/);
    assert.match(got[0].text, /\[첨부 글자\]\n부산호텔 1박 143,000원/);
    assert.ok(!JSON.stringify(sent.at(-1)).includes('PDFPDF'), 'PDF 바이트는 가지 않는다');
    assert.deepEqual(r.read, ['q.pdf: PDF 글자 층 1쪽 — 파일은 보내지 않음']);
  });

  await ta('gongmun.*: 여러 장도 docText 를 지나고, 돌려준 files 만 붙는다(PDF 는 글자로, 그림은 OCR 글자와 함께 그림째) — read 는 첨부마다 한 줄', async () => {
    setupApi(PURCHASE);
    const calls = [];
    const docText = fakeDocText(calls, (input, files) => ({
      input: `${input}\n\n[q.pdf 글자]\n모니터 1,000원\n[r.png OCR]\n견적`,
      files: files.filter((f) => f.type !== 'application/pdf'),
      read: ['q.pdf: PDF 글자 층 1쪽 — 파일은 보내지 않음', 'r.png: OCR 신뢰도 80 — 그림도 같이 보냄'],
      lean: false,
    }));
    const { gongmunSmart } = await load();
    const r = await gongmunSmart({ files: [pdf, png], text: '' }, { kind: 'purchase', today: TODAY }, { apiKey: 'sk-x', useNative: false, docText });
    assert.equal(r.via, 'api');
    assert.equal(r.record.vendor, 'OO상사');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].files, [pdf, png]);
    assert.match(calls[0].input, /파일 이름: q\.pdf, r\.png/);   // gongmunInput 의 글이 그대로 docText 에 간다
    const got = blocks();
    assert.deepEqual(got.map((b) => b.type), ['image', 'text']);
    assert.equal(got[0].source.data, 'PNGPNG');
    assert.match(got[1].text, /\[q\.pdf 글자\]\n모니터 1,000원/);
    assert.ok(!JSON.stringify(sent.at(-1)).includes('PDFPDF'), 'docText 가 뺀 PDF 는 가지 않는다');
    assert.deepEqual(r.read, ['q.pdf: PDF 글자 층 1쪽 — 파일은 보내지 않음', 'r.png: OCR 신뢰도 80 — 그림도 같이 보냄']);
  });

  await ta('글 작업(parse)과 첨부 없는 gongmun.* 은 docText 를 부르지 않는다 — textFirst 는 다리의 TEXT_FIRST 와 같은 규칙', async () => {
    const calls = [];
    const docText = fakeDocText(calls, { input: '엉뚱한 글', files: [], read: ['X'], lean: true });
    setup({ native: 'absent', api: 'ok' });
    const { parseSmart, gongmunSmart, textFirst } = await load();
    const p = await parseSmart('내일 오전', { apiKey: 'sk-x', today: TODAY, useNative: false, docText });
    assert.equal(p.via, 'api');
    assert.equal(calls.length, 0);
    setupApi(PURCHASE);
    const g = await gongmunSmart({ files: [], text: '모니터 1대 1,000원' }, { kind: 'purchase' }, { apiKey: 'sk-x', useNative: false, docText });
    assert.equal(g.via, 'api');
    assert.equal(calls.length, 0);
    assert.deepEqual(blocks().map((b) => b.type), ['text']);
    assert.match(blocks()[0].text, /모니터 1대 1,000원/);
    assert.deepEqual(g.read, []);
    // 다리와 같은 규칙 — 명세의 모든 작업 이름에서 둘이 같은 것을 고른다.
    process.env.KRS_HOST_NO_MAIN = '1';
    const [{ TEXT_FIRST }, { TASKS }] = await Promise.all([import('../native/host.mjs'), import('../src/input.js')]);
    assert.deepEqual(Object.keys(TASKS).filter(textFirst).sort(), [...TEXT_FIRST].sort());
    assert.deepEqual(['receipt', 'gongmun.purchase', 'gongmun.edu', 'gongmun.trip', 'gongmun.outside'].filter(textFirst).length, 5);
    assert.deepEqual(['parse', 'attend', 'diagnose', 'gongmunSetup', 'gongmunReason.purchase', 'gongmunReason.edu'].filter(textFirst), []);
  });

  await ta('docText 가 던져도 API 를 건너뛰지 않는다 — 파일째 보내고 까닭이 read 에 남는다(다리의 extractText 와 같은 문구). note 에는 섞이지 않는다', async () => {
    setupApi(RECEIPT);
    const docText = async () => { throw new Error('pdf.js 를 못 불러옴'); };
    const { receiptSmart } = await load();
    const r = await receiptSmart(png, { trip: {} }, { apiKey: 'sk-x', useNative: false, docText });
    assert.equal(r.via, 'api');
    assert.equal(r.record.vendor, '부산호텔');
    assert.deepEqual(r.read, ['글자 뽑기를 건너뜀(pdf.js 를 못 불러옴) — 파일째 보냄']);
    assert.ok(!String(r.note || '').includes('글자 뽑기'), r.note);
    const got = blocks();
    assert.deepEqual(got[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'PNGPNG' } });
    assert.match(got[1].text, /파일 이름: r\.png/);
  });

  await ta('docText 를 넣지 않으면 doctext/index.js 의 docText 가 돈다 — node 에는 Worker 도 offscreen 도 없어 파일째 가고 까닭이 read 에 남는다. CLI 길의 read 는 빈 배열', async () => {
    setupApi(RECEIPT);
    const { receiptSmart } = await load();
    const r = await receiptSmart(pdf, { trip: {} }, { apiKey: 'sk-x', useNative: false });
    assert.equal(r.via, 'api');
    assert.equal(r.read.length, 1);
    assert.ok(r.read[0].startsWith('글자 뽑기를 건너뜀('), r.read[0]);
    assert.ok(r.read[0].endsWith(' — 파일째 보냄'), r.read[0]);
    assert.deepEqual(blocks()[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'PDFPDF' } });
    globalThis.chrome = { runtime: { sendNativeMessage: async () => ({ ok: true, costUsd: 0.01, data: RECEIPT }) } };
    const { receiptSmart: viaCli } = await load();
    const c = await viaCli(pdf, { trip: {} }, { useNative: true });
    assert.equal(c.via, 'cli');
    assert.deepEqual(c.read, []);
  });
}

console.log(`\n통과 ${pass}건`);
