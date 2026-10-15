// 가짜 Outlook MCP 서버 — rerp/mcp.js 가 부르는 fetch 자리에 끼우는 Streamable HTTP 흉내(test/rerp.test.mjs 의 가짜와 같은 방식).
// 진짜 서버(KR_MS365_mcp :5001)처럼: POST 마다 SSE(event: message / data: JSON-RPC)로 답하고, initialize 에 mcp-session-id 를 주고,
// 세션 없는 요청은 400, 알림(notifications/initialized)은 202, DELETE 로 세션을 닫는다. tools/call 은 graph.mjs 의 원본으로 답한다.
// 실패 판정도 서버처럼 한다(mcp_common/errors.py is_failure — status error·failed·auth_required 또는 success:false 면 isError, 본문은 그 JSON).
//
//   const fake = createMcpFake();                         // 켜져 있고 인증된 서버
//   createMcpFake({ up: false })                          // 꺼진 서버 — fetch 가 TypeError (rerp/mcp.js 가 kind offline 으로)
//   createMcpFake({ authRequired: true })                 // 로그인이 풀린 서버 — 모든 도구가 auth_required(isError)
//   createMcpFake({ tools: [...] })                       // 노출 도구 바꾸기 (없는 도구를 부르면 unknown_tool, isError)
//   createMcpFake({ responses: { test_handler: (args) => ({ ... }) } })   // 도구 답 바꾸기
//   fake.calls → [{ name, arguments }] · fake.sessions(연 세션 수) · fake.deletes · fake.requests(모든 HTTP 요청) · fake.state(up·authRequired·tools 를 도중에 바꿈)
import * as G from './graph.mjs';

const PROTOCOL = '2025-06-18';

/** 서버의 is_failure 와 같은 판정 */
export function isFailure(p) {
  if (!p || typeof p !== 'object') return false;
  return ['error', 'failed', 'auth_required'].includes(p.status) || p.success === false || p.isError === true;
}

/* 도구 이름 → 기본 답 (graph.mjs 원본) */
const DEFAULTS = {
  mail_query_url: () => G.sentListResponse(),
  mail_query_if_emaidID: (a) => G.detailsResponse(a.message_ids || []),
  mail_attachment_meta: (a) => G.metaResponse(a.message_ids || []),
  mail_attachment_download: (a) => {
    const list = a.message_attachment_ids || [];
    if (list.every((x) => typeof x === 'string')) return G.downloadResponse(list);
    return G.saveResponse(list, a.save_directory || 'downloads');
  },
  test_handler: (a) => G.inboxResponse({
    select: a.select_params || null,
    exclude: (a.client_filter && a.client_filter.exclude_from_address) || [],
    isDraft: a.filter_params ? a.filter_params.is_draft : null,
    since: (a.filter_params && a.filter_params.received_date_from) || '',
    limit: a.top || 50,
  }),
  // mail_fetch_filter 는 top 을 노출하지 않아 서비스 기본 50 건, select 없음(전체 필드), 발신자 제외는 exclude_params($filter)
  mail_fetch_filter: (a) => G.inboxResponse({
    exclude: (a.exclude_params && a.exclude_params.exclude_from_address) || [],
    isDraft: a.filter_params ? a.filter_params.is_draft : null,
    since: (a.filter_params && a.filter_params.received_date_from) || '',
    limit: 50,
  }),
};

const headersOf = (h) => ({ get: (name) => h[String(name).toLowerCase()] ?? null });
const empty = (status) => ({ ok: status < 400, status, headers: headersOf({}), text: async () => '' });

export function createMcpFake({ up = true, authRequired = false, tools = G.TOOL_NAMES, responses = {}, strictErrors = true, serverInfo = { name: 'outlook', version: '1.0.0' } } = {}) {
  const state = { up, authRequired, tools: [...tools] };
  const calls = [];
  const requests = [];
  const live = new Set();
  let sessions = 0;
  let deletes = 0;

  const sse = (id, body, session) => ({
    ok: true, status: 200,
    headers: headersOf({ 'content-type': 'text/event-stream', 'mcp-session-id': session }),
    text: async () => `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, ...body })}\n\n`,
  });
  const toolResult = (payload, isError) => ({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError });

  function answer(name, args) {
    if (!state.tools.includes(name)) return toolResult({ status: 'error', error: 'unknown_tool', tool: name, available: [...state.tools].sort() }, true);
    if (state.authRequired) return toolResult(G.AUTH_REQUIRED, true);
    const h = Object.prototype.hasOwnProperty.call(responses, name) ? responses[name] : DEFAULTS[name];
    let payload;
    try { payload = typeof h === 'function' ? h(args) : h; } catch (e) { payload = { status: 'error', error: e.name, message: e.message, tool: name }; }
    if (!payload) payload = { status: 'error', error: 'no_fixture', tool: name };
    return toolResult(payload, strictErrors ? isFailure(payload) : false);
  }

  async function fetch(url, init = {}) {
    if (!state.up) throw new TypeError('fetch failed');
    const method = init.method || 'GET';
    const h = init.headers || {};
    const session = h['Mcp-Session-Id'] || h['mcp-session-id'] || '';
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, method, session, body });
    if (method === 'DELETE') { deletes++; live.delete(session); return empty(200); }
    if (body.method === 'initialize') {
      const sid = `mt-sess-${++sessions}`;
      live.add(sid);
      return sse(body.id, { result: { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo } }, sid);
    }
    if (!live.has(session)) return { ok: false, status: 400, headers: headersOf({}), text: async () => 'Bad Request: No valid session ID provided' };
    if (!('id' in body)) return empty(202);
    if (body.method === 'tools/list') return sse(body.id, { result: { tools: state.tools.map((name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } })) } }, session);
    if (body.method === 'tools/call') {
      const { name, arguments: args = {} } = body.params || {};
      calls.push({ name, arguments: args });
      return sse(body.id, { result: answer(name, args) }, session);
    }
    return sse(body.id, { error: { code: -32601, message: `Method not found: ${body.method}` } }, session);
  }

  return {
    fetch, calls, requests, state,
    get sessions() { return sessions; },
    get deletes() { return deletes; },
    get open() { return live.size; },
    /** 도구 이름만 차례로 */
    names: () => calls.map((c) => c.name),
    reset() { calls.length = 0; requests.length = 0; sessions = 0; deletes = 0; live.clear(); },
  };
}
