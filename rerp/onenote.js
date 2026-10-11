// kr_ext_rerp `lib/plus-onenote.js` 를 그대로 옮긴 것 — IIFE 머리와 꼬리의 `g.KRX_ONENOTE = api` 를 export 로만 바꿨다. 출처·갱신 규칙은 rerp/README.md.
/* 확장 Plus — OneNote 페이지 접근. KR_MS365_mcp 의 onenote MCP 서버(도구 read_onenote · write_onenote · sync_onenote_db)를 lib/mcp-client.js 로 부른다.
 * 백그라운드 전용 · Node 테스트 겸용. 무엇을 페이지에 쓰는지는 모른다 — 예상 비용 블록의 내용·병합은 lib/plan-sync.js
 *
 * 섹션·페이지 목록: list_sections(Graph, 노트북 이름 포함) · list_pages(section_id 로 거른 MCP 로컬 DB 목록 — 새 페이지·동료가 만든 페이지는 sync_onenote_db 뒤에야 보임).
 *   공유 노트북의 섹션·페이지는 그 노트북을 OneNote 에서 한 번 열어 둔 사람에게만 목록에 나온다. 페이지 생성은 create_page(section_id, title, content) — 결과에 page_id·web_url 이 온다
 * 페이지 링크 → GUID(parseLink): OneNote 의 "페이지 링크 복사"는 웹 링크(…?wd=target(섹션.one|{섹션 GUID}/{제목}|{페이지 GUID}/)) 또는 onenote: 링크(…&page-id={GUID}&end)를 준다.
 *   이 페이지 GUID 는 Graph 의 page_id(1-<32자>!<n>-<섹션 GUID>)와 다르고(2026-09-27 확인) list_pages 의 web_url 에만 같은 GUID 가 있다. 지금은 과제별 페이지를 제목으로 찾으므로 링크 해석은 쓰지 않는다
 * 블록: 페이지 안의 data-id 가 붙은 요소 하나(<table>)를 통째로 바꾼다(write_onenote replace). 없으면 본문 끝에 append.
 *   replace 의 target 은 include_ids 로 읽은 그 요소의 생성 id("table:{guid}{n}")를 쓴다 — '#data-id' 를 target 으로 주면 Graph 가 table 은 500, p·ul 은 400 을 내고(2026-09-27 확인),
 *   <div> 는 아예 대상이 안 된다("The PATCH target DIV for action replace is not supported"). 그래서 블록은 표 하나이고 읽기는 늘 include_ids 다(기본 응답에는 id·data-id 둘 다 없음).
 *   블록 안에 같은 태그를 중첩하지 않는다(정규식으로 닫는 태그를 찾음) */
const api = {};
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;
const dec = (s) => { try { return decodeURIComponent(String(s || '')); } catch (e) { return String(s || ''); } };

/* 링크에서 페이지 GUID(소문자) 또는 Graph page_id 를 뽑는다 → { guid } | { pageId } | null */
api.parseLink = function (link) {
  const raw = String(link || '').trim();
  if (!raw) return null;
  if (/^1-[0-9a-f]{32}![0-9]+-[0-9a-f-]{36}$/i.test(raw)) return { pageId: raw };
  const s = dec(raw);
  let m = /page-id=\{?([0-9a-f-]{36})\}?/i.exec(s);
  if (m) return { guid: m[1].toLowerCase() };
  m = /wd=target\(([^)]*)\)/i.exec(s);
  if (m) { const ids = m[1].match(GUID); if (ids && ids.length) return { guid: ids[ids.length - 1].toLowerCase() }; }
  const ids = s.match(GUID);   // 그 밖의 형식: 마지막 GUID
  return ids && ids.length ? { guid: ids[ids.length - 1].toLowerCase() } : null;
};
const pick = (p) => ({ pageId: p.page_id || p.id || '', title: p.title || '', webUrl: p.web_url || '', notebook: p.notebook_name || '', section: p.section_name || '', sectionId: p.section_id || p.parent_section_id || '' });

/* 섹션 목록 → [{ id, name, notebook, notebookId, label("노트북 › 섹션") }] (Graph 조회, 내가 연 모든 노트북) */
api.listSections = async function (client) {
  const r = await client.call('read_onenote', { action: 'list_sections', top: 500 });
  return ((r.json && r.json.sections) || []).map((s) => ({ id: s.id, name: s.display_name || '', notebook: s.parent_notebook_name || '', notebookId: s.parent_notebook_id || '', label: `${s.parent_notebook_name || '?'} › ${s.display_name || ''}` }));
};
/* 노트북 목록 → [{ id, name }] (MCP 에 노트북 도구가 없어 섹션 목록에서 추림 — 섹션이 하나도 없는 노트북은 빠짐) */
api.listNotebooks = async function (client, sections) {
  const secs = sections || await api.listSections(client);
  const m = new Map();
  for (const s of secs) if (s.notebookId && !m.has(s.notebookId)) m.set(s.notebookId, { id: s.notebookId, name: s.notebook || '' });
  return Array.from(m.values());
};
/* 섹션 생성 → { id, name } */
api.createSection = async function (client, notebookId, name) {
  const r = await client.call('write_onenote', { action: 'create_section', notebook_id: notebookId, title: name });
  const s = (r.json && r.json.section) || {};
  if (!s.id) { const e = new Error('섹션을 만들었지만 id 를 받지 못했습니다'); e.kind = 'parse'; throw e; }
  return { id: s.id, name: s.display_name || name };
};
/* 이름(기본 RERP)으로 섹션을 찾고 없으면 만든다. opts = { name, notebookId? } → { id, label("노트북 › 섹션"), name, notebookId, notebook, created }
 * 이름이 같은 섹션이 여러 노트북에 있거나(notebookId 없이) 하나도 없는데 만들 노트북을 모르면 kind 'notebook' 오류 (e.notebooks = 고를 노트북 목록) */
api.ensureSection = async function (client, opts) {
  const name = String((opts && opts.name) || 'RERP').trim() || 'RERP';
  const notebookId = String((opts && opts.notebookId) || '');
  const secs = await api.listSections(client);
  const same = (s) => String(s.name || '').trim().toLowerCase() === name.toLowerCase();
  const hits = secs.filter((s) => same(s) && (!notebookId || s.notebookId === notebookId));
  const pick = (s, created) => ({ id: s.id, label: `${s.notebook || '?'} › ${s.name}`, name, notebookId: s.notebookId, notebook: s.notebook || '', created: !!created });
  if (hits.length === 1 || (hits.length > 1 && notebookId)) return pick(hits[0], false);
  const notebooks = await api.listNotebooks(client, secs);
  if (hits.length > 1) { const e = new Error(`"${name}" 섹션이 여러 노트북에 있습니다. 어느 노트북 것을 쓸지 고르세요`); e.kind = 'notebook'; e.notebooks = notebooks.filter((n) => hits.some((s) => s.notebookId === n.id)); throw e; }
  if (!notebookId) { const e = new Error(`"${name}" 섹션이 없습니다. 만들 노트북을 고르세요`); e.kind = 'notebook'; e.notebooks = notebooks; throw e; }
  const nb = notebooks.find((n) => n.id === notebookId);
  const made = await api.createSection(client, notebookId, name);
  return pick({ id: made.id, name: made.name, notebookId, notebook: nb ? nb.name : '' }, true);
};
/* 동료가 보낸 글(페이지 링크 · "ID: 1-…" 줄 · Graph page_id) → { pageId, title, webUrl, sectionId }. 내보내기가 복사해 준 ID 가 있으면 바로 쓰고,
 * 링크뿐이면 페이지 GUID 로 내 페이지 목록(web_url)에서 찾는다 — 없으면 sync_onenote_db 뒤 한 번 더 (공유 노트북은 OneNote 에서 한 번 열어 둬야 목록에 나옴) */
api.resolveLink = async function (client, text) {
  const raw = String(text || '');
  const idm = /(1-[0-9a-f]{32}![0-9]+-[0-9a-f-]{36})/i.exec(raw);
  const k = idm ? { pageId: idm[1] } : api.parseLink(raw.split(/\s+/).find((w) => /wd=target|page-id=|^onenote:|^https?:/i.test(w)) || raw);
  if (!k) { const e = new Error('원노트 페이지 링크가 아닙니다 (동료가 내보내기로 복사한 글을 그대로 붙여 넣으세요)'); e.kind = 'badlink'; throw e; }
  const list = async () => { const r = await client.call('read_onenote', { action: 'list_pages', top: 5000 }); return ((r.json && r.json.pages) || []).map(pick); };
  const match = (pages) => k.pageId ? pages.find((p) => p.pageId === k.pageId) : pages.find((p) => p.webUrl && dec(p.webUrl).toLowerCase().includes(k.guid));
  let hit = match(await list());
  if (!hit) { await api.syncDb(client); hit = match(await list()); }
  if (!hit && k.pageId) return { pageId: k.pageId, title: '', webUrl: '', sectionId: '' };   // ID 는 있으니 읽기는 시도할 수 있다
  if (!hit) { const e = new Error('링크의 페이지를 내 OneNote 목록에서 찾지 못했습니다. 공유 노트북이면 OneNote 에서 그 노트북을 한 번 열어 둔 뒤 다시 하세요'); e.kind = 'notfound'; throw e; }
  return hit;
};
/* 섹션 안의 페이지 목록(MCP 로컬 DB) → [{ pageId, title, webUrl, sectionId }] */
api.listSectionPages = async function (client, sectionId) {
  const r = await client.call('read_onenote', { action: 'list_pages', section_id: sectionId, top: 5000 });
  return ((r.json && r.json.pages) || []).map(pick).filter((p) => p.pageId);
};
/* Graph 전체 페이지 목록으로 MCP 로컬 DB 갱신 (동료가 만든 페이지·방금 만든 페이지를 목록에 올림) */
api.syncDb = async function (client) { await client.call('sync_onenote_db', {}); };
/* 페이지 생성 → { pageId, title, webUrl } */
api.createPage = async function (client, sectionId, title, html) {
  const r = await client.call('write_onenote', { action: 'create_page', section_id: sectionId, title, content: html });
  const p = (r.json && r.json.page) || {};
  if (!p.id) { const e = new Error('페이지를 만들었지만 id 를 받지 못했습니다'); e.kind = 'parse'; throw e; }
  return { pageId: p.id, title: p.title || title, webUrl: p.web_url || '' };
};

/* 페이지 HTML (id·data-id 포함) */
api.readPage = async function (client, pageId) {
  const r = await client.call('read_onenote', { action: 'get_content', page_id: pageId, include_ids: true });
  const html = r.json && typeof r.json.content === 'string' ? r.json.content : (typeof r.text === 'string' && /<html/i.test(r.text) ? r.text : '');
  if (!html) { const e = new Error('페이지 내용을 받지 못했습니다'); e.kind = 'parse'; throw e; }
  return html;
};
api.pageTitle = (html) => { const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || ''); return m ? m[1].trim() : ''; };
/* data-id 가 dataId 인 블록(<table>·<p>·<div>) → { html(블록 전체), inner, tag, id(생성 id, replace target) } | null. Graph 는 속성 순서를 바꿔 돌려주므로 여는 태그 안 어디든 찾는다 */
api.findBlock = function (html, dataId) {
  const re = new RegExp(`<(table|p|div)\\b[^>]*\\bdata-id="${dataId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
  const m = re.exec(html || '');
  if (!m) return null;
  const open = /^<[^>]*>/.exec(m[0])[0];
  const idm = /\sid="([^"]+)"/i.exec(open);
  return { html: m[0], inner: m[2], tag: m[1].toLowerCase(), id: idm ? idm[1] : '' };
};
/* 블록 쓰기: block(findBlock 결과)이 있으면 그 생성 id 를 target 으로 replace, 없으면 body 끝에 append. 생성 id 가 없으면(include_ids 없이 읽은 경우) '#data-id' 로 시도 */
api.writeBlock = async function (client, pageId, dataId, html, block) {
  if (block) return client.call('write_onenote', { action: 'replace', page_id: pageId, target: block.id || `#${dataId}`, content: html });
  return client.call('write_onenote', { action: 'append', page_id: pageId, content: html });
};
/* 서버 점검: 도구 목록에서 write_onenote 의 replace 지원 여부 */
api.checkTools = function (tools) {
  const w = (tools || []).find((t) => t.name === 'write_onenote');
  const r = (tools || []).find((t) => t.name === 'read_onenote');
  const actions = (((w || {}).inputSchema || {}).properties || {}).action || {};
  const props = ((r || {}).inputSchema || {}).properties || {};
  return { hasWrite: !!w, hasRead: !!r, replace: Array.isArray(actions.enum) && actions.enum.includes('replace'), includeIds: !!props.include_ids };
};

export default api;
