// 백엔드 선택: 로컬 CLI → API 키 → 규칙 해석 순으로 내려가는지 확인한다.
import assert from 'node:assert/strict';
import { systemPrompt } from '../src/input.js';

const TODAY = '2026-09-16';
let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const CLI_FILTER = { summary: 'CLI 해석', dateFrom: '2026-09-20', dateTo: '2026-09-20', hourFrom: 8, hourTo: 12, minSeats: 10, minHours: null, region: null };
const CLI_DIAGNOSIS = { verdict: 'rejected', siteMessage: '이미 예약된 시간입니다', cause: '같은 시간에 다른 예약이 있습니다.', fix: '' };

/**
 * chrome.runtime.sendNativeMessage 와 fetch 를 상황별로 흉내낸다.
 * native 에 객체를 주면 CLI 가 그것을 답으로 돌려준다(명세와 다른 답을 흉내 낼 때 쓴다).
 */
/** setup() 의 다리·API 가 마지막으로 받은 것 — 어느 작업으로 어떤 글이 갔는지 본다. */
const seen = { native: null, api: null };
function setup({ native, api }) {
  seen.native = null;
  seen.api = null;
  globalThis.chrome = {
    runtime: {
      sendNativeMessage: async (_host, msg) => {
        seen.native = msg;
        if (native === 'absent') throw new Error('호스트를 찾을 수 없습니다');
        if (msg.task === 'ping') return { ok: true, pong: true };
        if (native === 'error') return { ok: false, error: 'CLI 오류' };
        if (native && typeof native === 'object') return { ok: true, costUsd: 0.01, data: native };
        return { ok: true, costUsd: 0.01, data: msg.task === 'diagnose' ? CLI_DIAGNOSIS : CLI_FILTER };
      },
    },
  };
  globalThis.fetch = async (_url, init) => {
    seen.api = init?.body ? JSON.parse(init.body) : null;
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
  // 작업은 행위 명세가 종류마다 만든 search.room(actions/spec/room/search.yaml 의 llm.task)이다 — input.yaml 의 parse 가 아니다.
  assert.equal(seen.native.task, 'search.room');
  assert.equal(seen.native.input, `오늘은 ${TODAY} 입니다.\n찾는 대상: 회의실\n\n요청: 9월 20일 8시~12시 10명`);
});

await ta('CLI 가 실패하면 API 키로 내려간다', async () => {
  setup({ native: 'error', api: 'ok' });
  const { parseSmart } = await load();
  const r = await parseSmart('아무거나', { apiKey: 'sk-x', today: TODAY, useNative: true });
  assert.equal(r.via, 'api');
  assert.ok(r.note.includes('로컬 CLI 실패'), r.note);
  assert.equal(seen.api.system, systemPrompt('search.room'), 'API 길의 지시문도 같은 작업의 것');
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
  assert.equal(seen.native.task, 'search.car');
  assert.match(seen.native.input, /찾는 대상: 차량/);
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
    // 알림의 칸 이름은 행위 명세가 만든 attend 작업의 label 이다(src/input.js nameOf) — 종류마다 이름이 다른 칸은 생성기가 "출발일·날짜·시작일" 로 잇는다
    // (tools/gen-actions.mjs merged 모드: trip 출발일 · out/leaveout/health 날짜 · leave 시작일). sub 는 모든 종류에서 "종류".
    assert.ok(r.note.includes('종류 값(XX)은 받을 수 없어 뺐습니다'), r.note);
    assert.ok(r.note.includes('출발일·날짜·시작일 값(2026-02-30)은 받을 수 없어 뺐습니다'), r.note);
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

console.log('행위 명세의 LLM 어댑터 — fillAction(행위 ID): 행위가 작업 이름과 입력 글의 꼴을 정하고, 길은 askClaude 의 사다리다');
{
  const sent = [];
  const ATTEND = { kind: 'out', dateFrom: '2026-09-17', start: '14:00', end: '16:00', place: '부산시청', purpose: null, reply: '외근으로 채웠습니다.' };
  const API_FILTER = { summary: 'API 해석', dateFrom: '2026-09-21', dateTo: '2026-09-21', hourFrom: 9, hourTo: 18, minSeats: null, minHours: null, region: null };
  /** 다리는 작업마다 정해 둔 답(또는 answer)을 주고, API 는 조회 조건 하나를 준다. 둘 다 받은 것을 sent 에 적는다. */
  const setupAction = ({ native = 'ok', api = 'ok', answer } = {}) => {
    globalThis.chrome = { runtime: { sendNativeMessage: async (_host, msg) => {
      sent.push(msg);
      if (native === 'error') return { ok: false, error: 'CLI 오류' };
      return { ok: true, costUsd: 0.003, data: answer ?? (msg.task === 'attend' ? ATTEND : CLI_FILTER) };
    } } };
    globalThis.fetch = async (_url, init) => {
      sent.push(JSON.parse(init.body));
      if (api === 'error') return { ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) };
      return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(API_FILTER) }] }) };
    };
  };
  const form = { kind: 'out', dateFrom: TODAY, place: '', purpose: '' };
  const history = [{ who: 'me', text: '외근 올릴게' }];

  await ta('attend.<종류> → 작업 attend(merged — 어느 종류 ID 든 하나), 입력 글은 attendInput 과 같다. reply 는 떼고 조각은 관문(초안·partial)을 지난다', async () => {
    setupAction();
    const { fillAction, attendInput } = await load();
    const r = await fillAction('attend.out', '내일 2시부터 4시까지 부산시청 외근', { today: TODAY, form, history }, { apiKey: 'sk-x', useNative: true });
    assert.equal(sent.at(-1).task, 'attend');
    assert.equal(sent.at(-1).input, attendInput('내일 2시부터 4시까지 부산시청 외근', { form, today: TODAY, history }));
    assert.deepEqual(r, { input: { kind: 'out', dateFrom: '2026-09-17', start: '14:00', end: '16:00', place: '부산시청' }, reply: '외근으로 채웠습니다.', via: 'cli', costUsd: 0.003, note: '', fails: [] });
    for (const id of ['attend.trip', 'attend.leave', 'attend.health']) {
      await fillAction(id, '내일 휴가', { today: TODAY, form }, { useNative: true });
      assert.equal(sent.at(-1).task, 'attend', id);
    }
  });
  await ta('attend 의 답은 fillAttendSmart 처럼 상대 날짜를 달력으로 다시 셈한다', async () => {
    setupAction({ answer: { kind: 'out', dateFrom: '2026-09-18', reply: '외근으로 채웠습니다.' } });
    const { fillAction } = await load();
    const r = await fillAction('attend.out', '내일 외근', { today: TODAY, form }, { useNative: true });
    assert.deepEqual([r.input.dateFrom, r.note], ['2026-09-17', '날짜는 달력으로 다시 셈했습니다']);
  });
  await ta('room.search → 작업 search.room, 입력 글은 parseSmart 가 보내는 것과 같다(searchInput). reply 가 없는 작업은 빈 글', async () => {
    setupAction();
    const { fillAction, parseSmart, searchInput } = await load();
    const r = await fillAction('room.search', '9월 20일 8시~12시 10명', { today: TODAY }, { apiKey: 'sk-x', useNative: true });
    const msg = sent.at(-1);
    assert.equal(msg.task, 'search.room');
    assert.equal(msg.input, `오늘은 ${TODAY} 입니다.\n찾는 대상: 회의실\n\n요청: 9월 20일 8시~12시 10명`);
    assert.equal(msg.input, searchInput('9월 20일 8시~12시 10명', { today: TODAY, kind: 'room' }));
    assert.deepEqual(r, { input: CLI_FILTER, reply: '', via: 'cli', costUsd: 0.003, note: '', fails: [] });
    const smart = await parseSmart('9월 20일 8시~12시 10명', { today: TODAY, useNative: true });
    assert.deepEqual([sent.at(-1).task, sent.at(-1).input, smart.filter], [msg.task, msg.input, r.input]);
  });
  await ta('car.search → 작업 search.car — 좌석 수·지역은 비우고 두 알림이 note 에 남는다(variants.car.clear). 종류는 행위의 갈래라 opts.kind 로 바꿀 수 없다', async () => {
    setupAction({ answer: { ...CLI_FILTER, region: '부산' } });
    const { fillAction } = await load();
    const r = await fillAction('car.search', '부산 10명 차량', { today: TODAY }, { useNative: true, kind: 'room' });
    assert.equal(sent.at(-1).task, 'search.car');
    assert.match(sent.at(-1).input, /찾는 대상: 차량/);
    assert.deepEqual([r.input.minSeats, r.input.region, r.input.summary, r.reply], [null, null, 'CLI 해석', '']);
    assert.equal(r.note, '차량은 좌석 수를 알 수 없어 인원 조건은 뺐습니다, 차량은 지역을 가리지 않아 지역 조건은 뺐습니다');
  });
  await ta('CLI 의 답이 명세와 다르면 API 로 내려간다 — fails 에 까닭이 남고 note 에도 같이 적힌다. API 길의 지시문은 그 작업의 것', async () => {
    setupAction({ answer: ATTEND });
    const { fillAction } = await load();
    const r = await fillAction('room.search', '아무거나', { today: TODAY }, { apiKey: 'sk-x', useNative: true });
    assert.deepEqual([r.via, r.input.summary, r.fails.length], ['api', 'API 해석', 1]);
    assert.match(r.fails[0], /^로컬 CLI 실패\(답이 입력 명세와 다릅니다/);
    assert.equal(r.note, r.fails[0]);
    assert.equal(sent.at(-1).system, systemPrompt('search.room'));
  });
  await ta('로컬 CLI 도 API 도 안 되면 던지지 않고 input: null 과 fails 를 돌려준다 — 규칙 해석은 부르는 쪽(parseSmart·fillAttendSmart)의 몫', async () => {
    setupAction({ native: 'error', api: 'error' });
    const { fillAction } = await load();
    const r = await fillAction('room.search', '내일 오후', { today: TODAY }, { apiKey: 'sk-x', useNative: true });
    assert.deepEqual(r, { input: null, fails: ['로컬 CLI 실패(CLI 오류)', 'API 실패(Claude 호출 실패 (HTTP 401) bad key)'] });
  });
  await ta('말로 채우지 않는 행위는 부르기 전에 던진다 — 공문(recipe 갈래)·예약·취소(llm: false)·출장(갈래에 LLM 작업 없음)·모르는 행위·오늘 없음', async () => {
    setupAction();
    const { fillAction } = await load();
    const n = sent.length;
    for (const id of ['gongmun.purchase', 'room.reserve', 'attend.cancel', 'trip.create']) {
      await assert.rejects(fillAction(id, '글', { today: TODAY }, { useNative: true }), /이 행위는 말로 채우지 않습니다 — /, id);
    }
    await assert.rejects(fillAction('nope.search', '글', { today: TODAY }), /모르는 행위 nope\.search/);
    await assert.rejects(fillAction('room.search', '글', {}), /ctx\.today/);
    assert.equal(sent.length, n, '다리도 API 도 부르지 않는다');
  });
  await ta('askClaude 를 내보낸다 — 작업 이름으로 바로 묻는 길(사다리·관문 그대로)', async () => {
    setupAction({ answer: { ...CLI_FILTER, region: '부산' } });
    const { askClaude } = await load();
    const got = await askClaude('search.car', '글', { useNative: true, kind: 'car' });
    assert.deepEqual([got.via, got.data.minSeats, got.data.region, got.notes.length, got.fails], ['cli', null, null, 2, []]);
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

  await ta('글 작업(search.room)과 첨부 없는 gongmun.* 은 docText 를 부르지 않는다 — textFirst 는 다리의 TEXT_FIRST 와 같은 규칙', async () => {
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
    assert.deepEqual(['search.room', 'search.car', 'attend', 'diagnose', 'gongmunSetup', 'gongmunReason.purchase', 'gongmunReason.edu'].filter(textFirst), []);
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

/**
 * Messages API 스트리밍 답(SSE) 한 벌 — message_start · 생각 블록(빈 글 · 서명) · ping · text 블록(text 를 pieces 조각으로 나눠 text_delta) · message_delta(stop) · message_stop.
 * eol 로 줄 끝을 바꾸고, tail:false 면 message_delta·message_stop 없이 끝난다(연결이 끊긴 꼴).
 */
function sseOf(text, { stop = 'end_turn', pieces = 3, eol = '\n', tail = true, extra = [] } = {}) {
  const ev = (type, data) => `event: ${type}${eol}data: ${JSON.stringify({ type, ...data })}${eol}${eol}`;
  const size = Math.max(1, Math.ceil(text.length / pieces));
  const parts = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return [
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], stop_reason: null } }),
    ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '' } }),
    ev('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'sig' } }),
    ev('content_block_stop', { index: 0 }),
    ev('ping', {}),
    `: 주석 줄은 버린다${eol}${eol}`,
    ev('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }),
    ...parts.map((t) => ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: t } })),
    ev('content_block_stop', { index: 1 }),
    ...extra,
    ...(tail ? [ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 12 } }), ev('message_stop', {})] : []),
  ].join('');
}
/** 바이트를 n 바이트씩 잘라 내주는 진짜 Response — 덩어리 경계가 한글 글자(3바이트)·사건 가운데에 걸리게. */
const chunked = (sse, n = 7) => {
  const bytes = new TextEncoder().encode(sse);
  return new Response(new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += n) c.enqueue(bytes.slice(i, i + n));
      c.close();
    },
  }), { status: 200 });
};

console.log('작업마다의 한도(src/tasktune.js) — API 길도 R&D 스냅샷 뽑기·YAML 고치기만 medium·32000, 나머지는 low·16000');
{
  const sent = [];
  const answers = {
    'rnd.extract': { yaml: 'meta:\n  과제명: 시험용 직류 차단기 개발', alias: 'SSCB', stage: 2, warnings: null },
    'rnd.revise': { yaml: 'meta:\n  과제명: 시험용 직류 차단기 개발', summary: '연구재료비 12,000 → 15,000', changes: [], warnings: null },
  };
  /** 다리는 없고 API 만 있다 — 받은 본문을 적고 그 작업(지시문으로 가린다)의 답을 준다. stream: true 로 오면 SSE(진짜 Response 의 본문 스트림)로. */
  const setupTuned = () => {
    globalThis.chrome = { runtime: { sendNativeMessage: async () => { throw new Error('호스트를 찾을 수 없습니다'); } } };
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      sent.push(body);
      const answer = body.system.includes('이번 일: 변경사항으로') ? answers['rnd.revise'] : answers['rnd.extract'];
      if (body.stream) return new Response(sseOf(JSON.stringify(answer)), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] }) };
    };
  };
  const pdf = { name: '사업계획서_발췌.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,PDFPDF' };

  await ta('rnd.extract·rnd.revise 는 effort medium·max_tokens 32000 — 같은 모델이고 attend 는 그대로 low·16000', async () => {
    setupTuned();
    const { askClaude } = await load();
    for (const task of ['rnd.extract', 'rnd.revise']) {
      const r = await askClaude(task, '입력 글', { apiKey: 'sk-x', useNative: false });
      assert.equal(r.via, 'api', task);
      assert.deepEqual(r.data, answers[task], task);
      const body = sent.at(-1);
      assert.deepEqual([body.model, body.output_config.effort, body.max_tokens], ['claude-opus-5-5', 'medium', 32000], task);
      assert.equal(body.system, systemPrompt(task));
      assert.deepEqual(body.output_config.format.schema.required, Object.keys(answers[task]));
      assert.equal(body.stream, true, `${task} 는 스트리밍(SSE)으로 받는다`);
    }
    // 다른 작업은 바이트까지 전과 같다 — 답이 그 작업의 꼴이 아니어도 보낸 본문은 남는다. stream 키는 아예 없고 키 차례도 전과 같다.
    for (const task of ['attend', 'search.room', 'diagnose']) {
      await askClaude(task, '입력 글', { apiKey: 'sk-x', useNative: false });
      assert.deepEqual([sent.at(-1).model, sent.at(-1).output_config.effort, sent.at(-1).max_tokens], ['claude-opus-5-5', 'low', 16000], task);
      assert.deepEqual(Object.keys(sent.at(-1)), ['model', 'max_tokens', 'system', 'output_config', 'messages'], task);
    }
    const { EFFORT, DEFAULT_MODEL } = await import('../src/ai.js');
    assert.deepEqual([DEFAULT_MODEL, EFFORT], ['claude-opus-5-5', 'low'], 'export 는 남는다(기본 깊이)');
  });
  await ta('rnd.extract 의 첨부(작은 PDF)는 글자를 먼저 뽑지 않고 document 블록 그대로 간다 — textFirst 가 아니다', async () => {
    setupTuned();
    const { askClaude, textFirst } = await load();
    const calls = [];
    const r = await askClaude('rnd.extract', '사업계획서 글자', { apiKey: 'sk-x', useNative: false, files: [pdf], docText: async () => { calls.push(1); return null; } });
    assert.equal(r.via, 'api');
    assert.deepEqual(calls, []);
    assert.deepEqual(sent.at(-1).messages[0].content, [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'PDFPDF' } }, { type: 'text', text: '사업계획서 글자' }]);
    assert.deepEqual(['rnd.extract', 'rnd.revise'].filter(textFirst), []);
  });

  // 스트리밍 — 몇 분 걸리는 답에서 사내망 프록시가 조용한 연결을 끊지 않게(src/ai.js readStream).
  const { callClaude, readStream } = await import('../src/ai.js');
  const answer = { yaml: 'meta:\n  과제명: 시험용 직류 차단기 개발\n  차년도: 2차년도', alias: 'SSCB', stage: 2, warnings: '간접비 표를 찾지 못함 / 「>>>」 그대로' };
  const once = (res) => { globalThis.fetch = async (_url, init) => { sent.push(JSON.parse(init.body)); return res; }; };

  await ta('스트리밍 답은 text_delta 를 모아 JSON 하나로 — 덩어리가 한글 글자·사건 가운데서 갈리고 CRLF 여도, 생각 블록·ping·주석 줄은 버린다', async () => {
    for (const [eol, n] of [['\n', 7], ['\r\n', 5], ['\n', 1]]) {
      once(chunked(sseOf(JSON.stringify(answer), { pieces: 9, eol }), n));
      assert.deepEqual(await callClaude('rnd.extract', '사업계획서 글자', { apiKey: 'sk-x' }), answer, `${JSON.stringify(eol)} ${n}바이트`);
      assert.equal(sent.at(-1).stream, true);
    }
    // 본문 스트림이 없는 가짜(res.text 만)도 한 번에 나눠 읽는다.
    once({ ok: true, text: async () => sseOf(JSON.stringify(answer)) });
    assert.deepEqual(await callClaude('rnd.revise', '변경 글', { apiKey: 'sk-x' }), answer);
  });

  await ta('스트리밍의 stop_reason(message_delta) — refusal·max_tokens 는 스트리밍이 아닐 때와 같은 오류', async () => {
    once(chunked(sseOf('{"yaml":"meta', { stop: 'refusal' })));
    await assert.rejects(callClaude('rnd.extract', '글', { apiKey: 'sk-x' }), { message: '요청이 거부되었습니다. 다르게 적어보세요.' });
    once(chunked(sseOf('{"yaml":"meta:\\n  과제', { stop: 'max_tokens' })));
    await assert.rejects(callClaude('rnd.extract', '글', { apiKey: 'sk-x' }), { message: '응답이 중간에 끊겼습니다.' });
    once(chunked(sseOf('{"yaml": 이건 JSON 이 아니다')));
    await assert.rejects(callClaude('rnd.extract', '글', { apiKey: 'sk-x' }), { message: '응답을 해석하지 못했습니다.' });
  });

  await ta('스트리밍 도중의 error 사건은 그 까닭으로 던지고, 끝 사건 없이 본문이 끊기면 연결이 끊긴 것으로 던진다 — HTTP 오류는 전과 같다', async () => {
    const overload = 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
    once(chunked(sseOf('{"yaml":"meta"}', { tail: false, extra: [overload] })));
    await assert.rejects(callClaude('rnd.extract', '글', { apiKey: 'sk-x' }), { message: 'Claude 호출 실패 (스트림 overloaded_error) Overloaded' });
    once(chunked(sseOf('{"yaml":"meta"}', { tail: false })));
    await assert.rejects(callClaude('rnd.extract', '글', { apiKey: 'sk-x' }), { message: '응답을 다 받기 전에 연결이 끊겼습니다.' });
    once({ ok: false, status: 529, json: async () => ({ error: { message: 'Overloaded' } }) });
    await assert.rejects(callClaude('rnd.revise', '글', { apiKey: 'sk-x' }), { message: 'Claude 호출 실패 (HTTP 529) Overloaded' });
    // readStream 은 스트리밍이 아닐 때의 본문 꼴을 돌려준다 — text 블록만 글을 갖는다.
    const body = await readStream(chunked(sseOf('{"a":1}')));
    assert.deepEqual(body, { stop_reason: 'end_turn', content: [{ type: 'thinking', text: '' }, { type: 'text', text: '{"a":1}' }] });
  });

  await ta('askClaude 의 API 길에서도 스트리밍 답이 관문(structure)을 지나 data 로 온다 — 다른 작업은 스트리밍이 아니다', async () => {
    setupTuned();
    const { askClaude } = await load();
    const r = await askClaude('rnd.extract', '사업계획서 글자', { apiKey: 'sk-x', useNative: false, files: [pdf] });
    assert.deepEqual([r.via, r.data, sent.at(-1).stream], ['api', answers['rnd.extract'], true]);
    await askClaude('attend', '내일 연차', { apiKey: 'sk-x', useNative: false });
    assert.equal('stream' in sent.at(-1), false);
  });
}

console.log(`\n통과 ${pass}건`);
