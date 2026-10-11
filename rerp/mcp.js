// kr_ext_rerp `lib/mcp-client.js` 를 그대로 옮긴 것 — IIFE 의 `g`(self) 를 globalThis 로, 꼬리의 `g.KRX_MCP = api` 를 export 로만 바꿨다. 출처·갱신 규칙은 rerp/README.md.
/* 확장 Plus — MCP(Model Context Protocol) Streamable HTTP 클라이언트. 로컬 MCP 서버(KR_MS365_mcp 의 onenote 등)를 확장이 직접 부를 때 쓴다.
 * 백그라운드 전용(localhost 호스트 권한으로 CORS 없이 fetch) · Node 테스트 겸용(전역 fetch). 도메인 지식은 없고 규약만 안다 — OneNote 는 lib/plus-onenote.js, 예상 비용 동기화는 lib/plan-sync.js
 * 규약(2025-03-26 이후 Streamable HTTP): 단일 엔드포인트에 JSON-RPC 2.0 POST, Accept 에 application/json 과 text/event-stream 둘 다.
 *   서버가 SSE 로 답하면(KR_MS365_mcp 는 json_response=False) data: 줄의 JSON 중 요청 id 가 같은 것을 고른다.
 *   initialize 응답 헤더 mcp-session-id 를 이후 요청에 실어 보내고(stateful 서버), notifications/initialized 를 보낸 뒤 tools/list · tools/call. 끝나면 DELETE 로 세션을 닫는다(안 닫으면 서버에 세션이 쌓임)
 * 오류는 Error 에 kind 를 붙인다: offline(연결 불가 — 서버가 안 떠 있음) · http(상태 코드, status) · rpc(JSON-RPC error, code) · tool(도구가 isError 로 답함, payload) · parse(응답 해석 실패) · timeout */
const g = globalThis;
const PROTOCOL = '2025-06-18';
const api = {};
function err(kind, message, extra) { const e = new Error(message); e.kind = kind; Object.assign(e, extra || {}); return e; }
const fetchFn = (opts) => (opts && opts.fetch) || g.fetch.bind(g);

/* SSE 본문 → 이벤트의 data 를 JSON 으로 푼 목록 (한 이벤트의 data: 줄 여럿은 \n 으로 이어짐. 풀리지 않는 data 는 버림) */
function parseSse(text) {
  const out = [];
  for (const block of String(text || '').split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    try { out.push(JSON.parse(data)); } catch (e) {}
  }
  return out;
}
/* 응답 본문(JSON 또는 SSE)에서 id 가 같은 JSON-RPC 응답을 찾는다 */
function pickResponse(text, contentType, id) {
  const ct = String(contentType || '');
  let msgs;
  if (/text\/event-stream/i.test(ct)) msgs = parseSse(text);
  else { try { const j = JSON.parse(text); msgs = Array.isArray(j) ? j : [j]; } catch (e) { msgs = parseSse(text); } }
  const found = msgs.find((m) => m && m.id === id);
  if (found) return found;
  if (msgs.length === 1 && msgs[0] && (msgs[0].result !== undefined || msgs[0].error)) return msgs[0];   // id 가 문자열/숫자로 바뀐 경우
  throw err('parse', `MCP 응답에서 결과를 찾지 못했습니다 (${ct || '형식 없음'}, ${String(text || '').slice(0, 80)})`);
}

async function post(url, session, body, opts, timeoutMs) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (session) { headers['Mcp-Session-Id'] = session; headers['MCP-Protocol-Version'] = PROTOCOL; }
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs || 60000) : 0;
  let res;
  try { res = await fetchFn(opts)(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined }); }
  catch (e) {
    if (e && e.name === 'AbortError') throw err('timeout', `MCP 서버 응답이 ${Math.round((timeoutMs || 60000) / 1000)}초 안에 오지 않았습니다`);
    throw err('offline', `MCP 서버에 연결할 수 없습니다 (${url}): ${String((e && e.message) || e)}`);
  } finally { clearTimeout(timer); }
  const text = await res.text();
  if (!res.ok) {
    if (session && (res.status === 404 || res.status === 400)) throw err('session', `MCP 세션이 끊겼습니다 (${res.status})`, { status: res.status });
    throw err('http', `MCP 서버 오류 ${res.status}: ${text.slice(0, 200)}`, { status: res.status });
  }
  return { text, contentType: res.headers.get('content-type'), session: res.headers.get('mcp-session-id') || session };
}

/* 세션을 열고(initialize + initialized) 클라이언트를 돌려준다.
 * client.call(도구, 인자) → { result(CallToolResult), text(첫 text 블록), json(그 text 가 JSON 이면 파싱값) }. isError 면 kind 'tool' 오류(payload 에 파싱한 본문)
 * client.list() → tools 배열 · client.server → serverInfo · client.close() → DELETE */
api.open = async function (url, opts) {
  opts = opts || {};
  let seq = 0, session = null;
  const rpc = async (method, params, timeoutMs) => {
    const id = ++seq;
    const r = await post(url, session, { jsonrpc: '2.0', id, method, params: params || {} }, opts, timeoutMs);
    session = r.session;
    const msg = pickResponse(r.text, r.contentType, id);
    if (msg.error) throw err('rpc', `MCP ${method} 오류: ${(msg.error && msg.error.message) || JSON.stringify(msg.error)}`, { code: msg.error && msg.error.code, data: msg.error && msg.error.data });
    return msg.result;
  };
  const init = await rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: opts.clientName || 'kr-ext-rerp', version: opts.clientVersion || '0' } }, opts.initTimeoutMs || 15000);
  await post(url, session, { jsonrpc: '2.0', method: 'notifications/initialized' }, opts, 15000);   // 202, 본문 없음
  const client = {
    url, server: (init && init.serverInfo) || null, protocol: (init && init.protocolVersion) || null,
    get session() { return session; },
    async list() { const r = await rpc('tools/list', {}, 15000); return (r && r.tools) || []; },
    async call(name, args) {
      const result = await rpc('tools/call', { name, arguments: args || {} }, opts.callTimeoutMs || 90000);
      const blocks = (result && result.content) || [];
      const text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
      let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) {}
      if (result && result.isError) {
        const p = json || {};
        const m = p.message || p.error || p.detail || text || '도구 실행 실패';
        throw err('tool', `${name}: ${typeof m === 'string' ? m : JSON.stringify(m)}`, { payload: json || text, tool: name });
      }
      return { result, text, json };
    },
    async close() {
      if (!session) return;
      try { await fetchFn(opts)(url, { method: 'DELETE', headers: { 'Mcp-Session-Id': session, 'MCP-Protocol-Version': PROTOCOL } }); } catch (e) {}
      session = null;
    }
  };
  return client;
};

/* 서버 확인: 열고 도구 목록을 받아 닫는다 → { server, protocol, tools:[{name, inputSchema}] } */
api.probe = async function (url, opts) {
  const c = await api.open(url, opts);
  try { return { server: c.server, protocol: c.protocol, tools: await c.list() }; }
  finally { await c.close(); }
};
/* 오류 → 사용자용 설명 { kind, message } */
api.describe = (e) => ({ kind: (e && e.kind) || 'error', message: String((e && e.message) || e) });

api._parseSse = parseSse;
export default api;
