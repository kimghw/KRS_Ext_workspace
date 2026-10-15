// kr_ext_rerp `lib/research-sync.js` 를 그대로 옮긴 것 — IIFE 머리와 꼬리의 `g.KRX_RESEARCH_SYNC = …` 를 export 로만 바꿨다(원본이 전역 g 로 읽던 것은 아래 shim). 출처·갱신 규칙은 rerp/README.md.
/* 연구개발계획서(연구내용) 원노트 공유 (0.8.5) — 과제의 연구내용(lib/research.js 의 기록)을 원노트 페이지 하나에 올리고, 그 페이지 링크로 받아 온다.
 * 백그라운드 전용 · Node 테스트 겸용. 페이지 접근은 onenote 손잡이(lib/plus-onenote.js KRX_ONENOTE: readPage · findBlock · writeBlock · createPage · listSectionPages · syncDb · pageTitle)로.
 * 쓰는 곳: 받기 — rerp background.js researchBind · researchPull(설정 페이지에 링크를 붙여 넣으면). 올리기 — kr_ext_workspace R&D 탭(rerp/researchsync.js 로 옮겨 씀)의 "연구내용 공유".
 *   그래서 kr_ext_workspace 에서 YAML 로 넣은 연구내용을 링크 하나로 rerp 에 가져온다(같은 과제의 다른 사람도 그 노트북을 열어 두었으면 같은 링크로).
 * 페이지: 과제마다 한 장 "[연구내용] {과제명}" — 섹션은 올리는 쪽이 정한다(workspace 는 예상 비용과 같은 RERP 섹션). 받는 쪽은 링크(KRX_ONENOTE.resolveLink)로 찾으므로 섹션과 상관없다.
 * 블록 = 표 하나 <table data-id="krx-research"> (Graph replace 는 생성 id 로 표를 통째로 — lib/plus-onenote.js 머리 주석):
 *   제목 줄(과제명·과제번호·올린 시각·누가) · 차년도마다 머리 줄과 절 줄(왼쪽 칸 절 이름, 오른쪽 칸 줄들 — KRX_RESEARCH.sections) ·
 *   맨 아래 기계용 한 칸 "krxres1:" + base64 UTF-8 JSON { v:1, at, by, name, code, recs:[기록 — 받는 쪽 연결(prjNo·prjNm·linkBy·src)은 빼고] }.
 *   기준은 JSON 이고 표는 보기용이라 원노트에서 표를 손으로 고쳐도 다음에 올릴 때 덮인다. base64 라 OneNote 가 따옴표·기호를 바꿔도 안전 */
import KRX_RESEARCH from './research.js';
const g = { KRX_RESEARCH };   // [workspace] 원본은 전역 g.KRX_RESEARCH 를 읽는다
const BLOCK = 'krx-research', MAGIC = 'krxres1:', TITLE_PREFIX = '[연구내용] ';
const LOCAL = ['prjNo', 'prjNm', 'linkBy', 'src'];   // 받는 쪽에서만 뜻이 있는 칸
const api = { BLOCK, MAGIC, TITLE_PREFIX };
const pad2 = (n) => String(n).padStart(2, '0');
const clock = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fail = (msg, kind) => { const e = new Error(msg); e.kind = kind; return e; };

/* base64 ↔ UTF-8 문자열 (서비스워커·사이드패널·Node 공용: TextEncoder + btoa — lib/plan-sync.js 와 같음) */
function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64dec(b64) {
  const bin = atob(String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, ''));
  const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* 페이지 제목 ↔ 과제명 */
api.titleFor = (name) => `${TITLE_PREFIX}${String(name || '').trim()}`;
api.nameOfTitle = (title) => { const m = /^\s*\[연구내용\]\s*(.+?)\s*$/.exec(String(title || '')); return m ? m[1] : ''; };
/** 올릴 기록 — 받는 쪽 연결 칸을 뺀다 */
api.clean = (rec) => { const o = Object.assign({}, rec); for (const k of LOCAL) delete o[k]; return o; };
/** 동료에게 보낼 글 — 웹 링크 + 페이지 ID(받는 쪽 resolveLink 가 ID 를 먼저 쓴다. 노트북 목록에 아직 없어도 읽을 수 있게) */
api.linkText = (page) => [page && page.webUrl, page && page.pageId ? `[연구내용 페이지 ID] ${page.pageId}` : ''].filter(Boolean).join('\n');

/**
 * 블록 HTML — 과제 하나의 차년도 기록들. data = { name, code, recs, at?, by? }
 * 절 글은 KRX_RESEARCH.sections(기록)을 그대로 줄바꿈(<br/>)으로 — 패널·설정 미리보기의 글과 같다.
 */
api.serialize = function (data) {
  const RS = g.KRX_RESEARCH;
  const recs = (data.recs || []).map(api.clean).sort((a, b) => a.n - b.n);
  const at = data.at || Date.now();
  const payload = { v: 1, at, by: String(data.by || ''), name: String(data.name || ''), code: String(data.code || ''), recs };
  const cell = (lines) => lines.map((l) => esc(l).replace(/^( +)/, (s) => '&nbsp;'.repeat(s.length))).join('<br/>');
  let rows = '';
  for (const rec of recs) {
    const head = [RS.infoOf(rec), rec.note].filter(Boolean).join(' · ');
    rows += `<tr><td><b>${esc(`${rec.n}차년도${rec.rev ? ` ${rec.rev}` : ''}`)}</b></td><td>${esc(head)}</td></tr>`;
    for (const s of RS.sections(rec)) rows += `<tr><td>${esc(s.title)}</td><td>${cell(s.lines)}</td></tr>`;
  }
  return `<table data-id="${BLOCK}" border="1">`
    + `<tr><td><b>연구내용</b></td><td><b>${esc(payload.name)}</b>${payload.code ? ` (${esc(payload.code)})` : ''} · 연구개발계획서 ${recs.length}개 차년도 · ${esc(clock(at))}${payload.by ? ` ${esc(payload.by)}` : ''} — 확장이 이 표를 통째로 갱신하므로 손으로 고친 내용은 남지 않습니다. 이 페이지 링크를 KR eClass 확장(rerp) 설정의 연구개발계획서 칸에 붙여 넣으면 받아 갑니다</td></tr>`
    + rows
    + `<tr><td style="font-size:6pt;color:#c0c4cc">${MAGIC}${b64enc(JSON.stringify(payload))}</td><td></td></tr>`
    + '</table>';
};
/** 블록 안쪽 HTML → { at, by, name, code, recs } | null. 태그를 걷어낸 글에서 krxres1: 뒤의 base64 를 읽는다 (OneNote 가 줄을 나누거나 span 으로 감싸도 됨) */
api.parse = function (inner) {
  const text = String(inner || '').replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, '');
  const m = new RegExp(`${MAGIC}([A-Za-z0-9+/=]+)`).exec(text);
  if (!m) return null;
  try {
    const p = JSON.parse(b64dec(m[1]));
    if (!p || !Array.isArray(p.recs)) return null;
    const recs = p.recs.filter((r) => r && typeof r === 'object' && r.name && r.id && Number(r.n) > 0).map(api.clean);
    return { at: Number(p.at) || 0, by: String(p.by || ''), name: String(p.name || ''), code: String(p.code || ''), recs };
  } catch (e) { return null; }
};

/**
 * 올리기 — page(지난번에 올린 { pageId, webUrl })가 있으면 그 페이지의 블록을 바꾸고, 없거나 못 읽으면 섹션에서 제목으로 찾고(없으면 sync_onenote_db 뒤 한 번 더), 그래도 없으면 만든다.
 * @param {{ client, onenote, sectionId?: string, page?: {pageId:string, webUrl?:string}|null, name: string, code?: string, recs: object[], by?: string, now?: number }} o
 * @returns {Promise<{ pageId: string, title: string, webUrl: string, created: boolean }>}
 */
api.publish = async function (o) {
  const O = o.onenote, client = o.client;
  if (!o.name) throw fail('과제명이 없습니다', 'parse');
  if (!(o.recs || []).length) throw fail('올릴 연구개발계획서가 없습니다 — 연구개발계획서 YAML(KR_<과제>.yaml)을 먼저 넣으세요', 'empty');
  const title = api.titleFor(o.name);
  const html = api.serialize({ name: o.name, code: o.code, recs: o.recs, at: o.now || Date.now(), by: o.by });
  let pg = o.page && o.page.pageId ? { pageId: o.page.pageId, title: o.page.title || title, webUrl: o.page.webUrl || '' } : null;
  let cur = '';
  if (pg) { try { cur = await O.readPage(client, pg.pageId); } catch (e) { if (e && /^(offline|timeout)$/.test(e.kind)) throw e; pg = null; } }   // 지워졌거나 옮겨진 페이지 — 섹션에서 다시 찾는다 (서버가 안 닿는 것은 그대로 던짐)
  if (!pg && o.sectionId) {
    const find = async () => (await O.listSectionPages(client, o.sectionId)).find((p) => String(p.title || '').trim() === title) || null;
    pg = await find();
    if (!pg) { await O.syncDb(client); pg = await find(); }
    if (pg) cur = await O.readPage(client, pg.pageId);
  }
  if (!pg) {
    if (!o.sectionId) throw fail('연구내용 페이지를 둘 원노트 섹션이 없습니다', 'nosection');
    const made = await O.createPage(client, o.sectionId, title, html);
    return { pageId: made.pageId, title: made.title || title, webUrl: made.webUrl || '', created: true };
  }
  await O.writeBlock(client, pg.pageId, BLOCK, html, O.findBlock(cur, BLOCK));
  return { pageId: pg.pageId, title: O.pageTitle(cur) || pg.title || title, webUrl: pg.webUrl || '', created: false };
};

/**
 * 받기 — 페이지를 읽어 블록의 기록들을 돌려준다. 블록이 없으면 kind 'noblock'.
 * @returns {Promise<{ title: string, data: { at, by, name, code, recs } }>}
 */
api.pull = async function (o) {
  const html = await o.onenote.readPage(o.client, o.pageId);
  const block = o.onenote.findBlock(html, BLOCK);
  const data = block ? api.parse(block.inner) : null;
  if (!data) throw fail('이 페이지에는 연구내용 표가 없습니다 — KRS WORKSPACE R&D 탭의 "연구내용 공유"가 만든 페이지 링크인지 보세요', 'noblock');
  return { title: o.onenote.pageTitle(html), data };
};

api._b64enc = b64enc; api._b64dec = b64dec;
export default api;
