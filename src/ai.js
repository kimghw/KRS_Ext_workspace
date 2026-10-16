// Anthropic Messages API 를 직접 호출해, 말을 입력 명세(input.yaml)의 구조로 바꿔 받는다.
//
// 이 확장은 번들러가 없는 순수 ES 모듈이고 MV3 는 원격 스크립트 로딩을 막으므로
// 공식 SDK 대신 raw HTTP 로 부른다.
//
// 지시문과 스키마는 여기서 짓지 않는다. 작업 이름만 받아 src/input.js 가 명세에서 만든 것을 보낸다
// — 로컬 CLI 다리(native/host.mjs)와 같은 지시문이다.
//
// 답이 몇 분 걸리는 작업(src/tasktune.js 의 stream — R&D 사업계획서 뽑기·YAML 고치기)은 스트리밍(SSE)으로 받아 text 조각을 모은다.
// 조용한 연결을 사내망 프록시가 끊지 않게 하려는 것이다(2026-10-16). 받은 뒤의 검사(거부·끊김·JSON 풀기)는 스트리밍이 아닐 때와 같다.

import { systemPrompt, jsonSchema } from './input.js';
import { tuneOf, DEFAULT_TUNE } from './tasktune.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
// 로컬 CLI 다리(native/host.mjs 의 MODEL)와 같은 모델이다(2026-10-05 사용자 지정: "모두 opus 5.5로 변경해줘" — 그 전에는
// 빨리 답하는 claude-haiku-4-5 였다).
export const DEFAULT_MODEL = 'claude-opus-5-5';
// 생각의 깊이. Opus 5.5 는 생각이 늘 켜져 있고(끄거나 토큰 상한을 주면 400) 깊이는 이것으로만 정한다 — 값을 읽어 칸을 채우는 일이라
// 가장 낮은 단계다(다리의 EFFORT 와 같다. 2026-10-05 다리로 잰 것: 영수증 그림 한 장 7~8초).
// 답의 한도(max_tokens — 생각에 쓴 토큰도 여기에 든다. 답이 중간에 끊기지 않게 넉넉히 16000)와 함께 작업마다의 값은 src/tasktune.js 에 있다 —
// R&D 스냅샷 뽑기·YAML 고치기(rnd.extract·rnd.revise)만 medium·32000 이고 나머지 작업은 이 값 그대로다.
export const EFFORT = DEFAULT_TUNE.effort;

/** 첨부 파일 하나를 API 의 내용 블록으로 — 이미지는 image, PDF 는 document. dataUrl 의 base64 부분만 보낸다. */
export function fileBlock({ type, dataUrl }) {
  const data = String(dataUrl || '').split(',')[1] || '';
  const media = type === 'application/pdf' ? 'application/pdf' : (type || 'image/png');
  return { type: media === 'application/pdf' ? 'document' : 'image', source: { type: 'base64', media_type: media, data } };
}

/**
 * 명세의 작업 하나를 Claude 에게 맡긴다. 구조화 출력으로 스키마를 강제해 파싱 실패를 없앤다.
 * 돌려주는 것은 **아직 검증하지 않은** 답이다 — 부르는 쪽(llm.js)이 관문(structure)에 통과시킨다.
 *
 * @param {string} task input.yaml 의 작업 이름 (parse·attend·diagnose)
 * @param {string} input 사용자 쪽 글. 오늘 날짜 같은 맥락은 부르는 쪽이 붙여서 준다
 * @param {{apiKey: string, model?: string, files?: {name:string,type:string,dataUrl:string}[]}} opts files 는 글 앞에 붙는 첨부(출장 증빙)
 * @returns {Promise<object>}
 */
export async function callClaude(task, input, opts) {
  const { apiKey, model = DEFAULT_MODEL, files = [] } = opts;
  if (!apiKey) throw new Error('Anthropic API 키가 설정되어 있지 않습니다.');
  const content = files.length ? [...files.map(fileBlock), { type: 'text', text: input }] : input;
  const tune = tuneOf(task);
  const stream = tune.stream === true;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // 확장 페이지에서 직접 부르려면 필요하다
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: tune.maxTokens,
      system: systemPrompt(task),
      output_config: { effort: tune.effort, format: { type: 'json_schema', schema: jsonSchema(task) } },
      messages: [{ role: 'user', content }],
      // 몇 분 걸리는 작업(src/tasktune.js stream — R&D 뽑기·고치기)만. 다른 작업의 본문은 이 키가 없어 전과 바이트까지 같다.
      ...(stream ? { stream: true } : {}),
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message || '';
    } catch { /* 본문이 JSON 이 아닐 수 있다 */ }
    throw new Error(`Claude 호출 실패 (HTTP ${res.status}) ${detail}`.trim());
  }

  const body = stream ? await readStream(res) : await res.json();
  if (body.stop_reason === 'refusal') throw new Error('요청이 거부되었습니다. 다르게 적어보세요.');
  if (body.stop_reason === 'max_tokens') throw new Error('응답이 중간에 끊겼습니다.');

  const block = (body.content || []).find((b) => b.type === 'text');
  if (!block) throw new Error('응답에서 값을 읽지 못했습니다.');
  try {
    return JSON.parse(block.text);
  } catch {
    throw new Error('응답을 해석하지 못했습니다.');
  }
}

/* ------------------------------------------------------------ 스트리밍(SSE) */

/** SSE 사건 하나(빈 줄로 나뉜 줄 묶음)의 data 글 — data: 줄들을 줄 바꿈으로 잇는다. event:·주석(:) 줄은 버린다. */
function dataOf(chunk) {
  const lines = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, ''));
  return lines.length ? lines.join('\n') : '';
}

/**
 * 답 본문의 SSE 사건마다 data 글을 내준다. 본문 스트림(res.body.getReader)이 있으면 오는 대로 읽고(덩어리 경계에서 글자·사건이 갈려도 이어 붙인다),
 * 없으면(검사의 가짜 fetch) res.text() 를 한 번에 나눈다. 다 읽기 전에 그만두면(오류 사건) 스트림을 닫는다.
 */
async function* sseData(res) {
  let buf = '';
  function* cut(final) {
    buf = buf.replace(/\r\n/g, '\n');
    for (let at = buf.indexOf('\n\n'); at >= 0; at = buf.indexOf('\n\n')) {
      const data = dataOf(buf.slice(0, at));
      buf = buf.slice(at + 2);
      if (data) yield data;
    }
    if (final && buf.trim()) {
      const data = dataOf(buf);
      buf = '';
      if (data) yield data;
    }
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    if (typeof res.text !== 'function') throw new Error('응답에서 값을 읽지 못했습니다.');
    buf = await res.text();
    yield* cut(true);
    return;
  }
  const dec = new TextDecoder('utf-8');
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      yield* cut(false);
    }
    buf += dec.decode();
    finished = true;
    yield* cut(true);
  } finally {
    if (!finished) reader.cancel().catch(() => {});
  }
}

/**
 * 스트리밍 답(stream: true — SSE)을 모아 스트리밍이 아닐 때의 본문 꼴 `{ stop_reason, content }` 로 돌려준다 — 그 뒤의 검사(거부·끊김·JSON 풀기)는 같은 길이다.
 * text 블록은 content_block_start 의 text 에 content_block_delta 의 text_delta 를 이어 붙이고, stop_reason 은 message_delta 에서 읽는다
 * (thinking·signature 조각과 message_start·content_block_stop·ping 은 버린다). error 사건은 그 글로 던지고,
 * message_stop 도 stop_reason 도 오기 전에 본문이 끝나면 연결이 끊긴 것으로 던진다.
 * @param {Response} res
 * @returns {Promise<{stop_reason: string|null, content: {type: string, text: string}[]}>}
 */
export async function readStream(res) {
  const blocks = [];
  let stop = null;
  let done = false;
  for await (const data of sseData(res)) {
    let ev;
    try {
      ev = JSON.parse(data);
    } catch {
      continue;   // 풀리지 않는 사건은 건너뛴다(빈 data 등)
    }
    if (ev?.type === 'content_block_start') {
      const b = ev.content_block || {};
      blocks[ev.index] = { type: String(b.type || ''), text: b.type === 'text' ? String(b.text || '') : '' };
    } else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
      (blocks[ev.index] ||= { type: 'text', text: '' }).text += String(ev.delta.text || '');
    } else if (ev?.type === 'message_delta') {
      if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
    } else if (ev?.type === 'message_stop') {
      done = true;
    } else if (ev?.type === 'error') {
      throw new Error(`Claude 호출 실패 (스트림 ${ev.error?.type || 'error'}) ${ev.error?.message || ''}`.trim());
    }
  }
  if (!done && !stop) throw new Error('응답을 다 받기 전에 연결이 끊겼습니다.');
  return { stop_reason: stop, content: blocks.filter(Boolean) };
}
