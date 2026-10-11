// kr_ext_rerp `background.js` 의 확장 Plus 배선(0.8.3, 880a6bc — 562~708행 planSync · queuePlanSync · plusProbe · plusNotebooks · planExport · planBind · plusResolveSection 과
// onMessage 의 plan*·plus* 갈래)을 그대로 옮긴 것. 서비스워커가 아니라 사이드패널 안에서 돌므로 바깥과 닿는 곳만 deps 로 받는다(rerp/README.md "옮기며 바꾼 것"):
//   · KRX_SETTINGS.load().plus → deps.settings()  (WORKSPACE 는 R&D 탭 원노트 칸의 rndNote.plus)
//   · 과제명·내 참여 과제·책임 과제·내 이름(패널 캐시·projectList·rndUser·참여인력) → deps.context()  (WORKSPACE 는 장부의 rERP 로 이어진 차년도와 과제책임자 == 내 이름)
//   · 오프스크린 문서 clipboardWrite → deps.copyText  (사이드패널은 navigator.clipboard)
//   · chrome.storage.local 의 plusSection · plusPlanPages · planSyncState · plannedExpenses · plannedDeleted 는 키 이름까지 rerp 그대로
//   · chrome.runtime.onMessage 의 switch 는 send(msg) 함수로 — rerp/plan.js 의 api.send 에 끼운다
import KRX_MCP from './mcp.js';
import KRX_ONENOTE from './onenote.js';
import KRX_PLAN_SYNC from './plansync.js';
import KRX_PLAN from './plan.js';

/* rerp lib/settings.js DEFAULTS.plus — 확장 Plus 기본값 */
export const PLUS_DEFAULTS = Object.freeze({
  enabled: false,
  onenoteMcpUrl: 'http://localhost:5005/mcp',   // KR_MS365_mcp onenote 서버(Streamable HTTP). 도구 read_onenote(get_content include_ids · list_pages web_url) · write_onenote(replace target) 가 있어야 함 (2026-09-27 추가분)
  sectionName: 'RERP',            // 예상 비용 페이지를 둘 원노트 섹션 이름. 동기화 때 이 이름의 섹션을 찾고(대소문자 무시) 없으면 notebookId 노트북에 만든다 (lib/plus-onenote.js ensureSection).
  notebookId: '',                 // 섹션을 둘 노트북(Graph 노트북 id). 비우면 그 이름의 섹션이 있는 노트북을 자동으로 쓰고, 없거나 여럿이면 팝업·설정에서 고르라고 한다. 찾은 섹션은 storage.local.plusSection 에 캐시
  notebookLabel: '',              // 표시용 노트북 이름
  planSync: true                  // 섹션이 있으면 예상 비용 동기화
});

/* ----- 확장 Plus: 예상 비용(lib/plan.js) ↔ 원노트 페이지 동기화. 순수 로직은 lib/plan-sync.js, 페이지 접근은 lib/plus-onenote.js, MCP 호출은 lib/mcp-client.js — 여기는 배선만 -----
 * planSync(reason, { prjNo?, createAll? }): 한 번에 하나만(진행 중이면 그 결과를 같이 받음). load/alarm 은 마지막 성공 뒤 PLAN_SYNC_MIN_MS 안이면 건너뜀. prjNo 를 주면 그 과제만(구름 아이콘), createAll 이면 내가 책임자인 과제 전부 페이지를 만든다(설정 버튼)
 *   페이지 생성은 과제 책임자만: leadPrjNos = 참여인력 역할에 "책임"이 있거나 과제책임자 이름이 본인(참여인력 행 이름·설정/자동 감지 이름·R&D ERP 로그인 이름)인 과제 (render.js isLead 와 같은 규칙). 책임자가 아니면 페이지가 생길 때까지 기다림
 *   결과는 storage.local.planSyncState 에 남겨 패널 구름 아이콘 툴팁(과제별)·설정 페이지가 읽고, 과제별 페이지는 storage.local.plusPlanPages 에 캐시(섹션이 바뀌면 무시)
 * 섹션: 설정 plus.sectionName(기본 RERP)의 섹션을 찾고 없으면 plus.notebookId 노트북에 만든다(ensurePlusSection → storage.local.plusSection 캐시). 노트북을 골라야 하면 kind 'notebook' 상태(notebooks 목록)로 팝업·설정이 고르게 한다
 * planSyncQueue: 항목 편집 뒤 4초 모아서 한 번. plusProbe/plusNotebooks/plusResolveSection: 설정 페이지·팝업의 연결 확인·노트북 목록·섹션 찾기/만들기
 * MCP 주소는 http(s)://localhost | 127.0.0.1 만 (manifest host_permissions) — 다른 호스트는 CORS 로 막힌다 */
const PLAN_SYNC_MIN_MS = 60 * 1000;

/**
 * @param {{ settings: () => Promise<object>|object, context: () => Promise<{names:object, myPrjNos:string[], leadPrjNos:string[], who:string}>,
 *   copyText?: (text:string) => Promise<boolean>, version?: string, clientName?: string }} deps
 */
export function createPlusSync(deps) {
  const clientName = deps.clientName || 'krs-workspace';
  const loadPlus = async () => Object.assign({}, PLUS_DEFAULTS, (await deps.settings()) || {});
  let planSyncInflight = null, planSyncTimer = 0;
  async function plusAllowed(url) {
    let u = null; try { u = new URL(url); } catch (e) {}
    if (!u || !/^https?:$/.test(u.protocol)) return { ok: false, kind: 'badurl', error: `MCP 주소가 올바르지 않습니다: ${url}` };
    if (!/^(localhost|127\.0\.0\.1)$/i.test(u.hostname)) return { ok: false, kind: 'badurl', error: `MCP 주소는 이 PC(localhost · 127.0.0.1)만 됩니다: ${u.hostname}` };
    return { ok: true };
  }
  const plusUrl = (s) => String((s && s.onenoteMcpUrl) || '').trim() || PLUS_DEFAULTS.onenoteMcpUrl;
  /* 설정의 섹션 이름(RERP)으로 섹션을 찾고 없으면 노트북에 만든다. 캐시(storage.local.plusSection)가 같은 이름·노트북이면 그대로 씀. force 면 다시 찾음 */
  async function ensurePlusSection(client, p, force) {
    const name = String(p.sectionName || '').trim() || PLUS_DEFAULTS.sectionName;
    const notebookId = String(p.notebookId || '').trim();
    const cached = (await chrome.storage.local.get('plusSection')).plusSection || null;
    if (!force && cached && cached.id && cached.name === name && (!notebookId || cached.notebookId === notebookId)) return cached;
    const sec = Object.assign({ at: Date.now() }, await KRX_ONENOTE.ensureSection(client, { name, notebookId }));
    await chrome.storage.local.set({ plusSection: sec });
    return sec;
  }
  async function planSync(reason, opts) {
    opts = opts || {};
    if (planSyncInflight) return planSyncInflight;
    planSyncInflight = (async () => {
      const p = await loadPlus();
      if (!p.enabled || p.planSync === false) {
        const missing = [!p.enabled && '원노트 공유 칸의 "예상 비용" 체크', p.planSync === false && '예상 비용 동기화 설정'].filter(Boolean);
        return { ok: false, skipped: 'off', missing };
      }
      const prev = (await chrome.storage.local.get('planSyncState')).planSyncState;
      if ((reason === 'load' || reason === 'alarm') && prev && prev.ok && Date.now() - prev.at < PLAN_SYNC_MIN_MS) return Object.assign({ skipped: 'recent' }, prev);
      const url = plusUrl(p);
      const t0 = Date.now();
      const allowed = await plusAllowed(url);
      let state, pages = null, sectionId = '';
      if (!allowed.ok) state = Object.assign({ at: t0, ok: false, reason }, allowed);
      else {
        let client = null;
        try {
          const l = await chrome.storage.local.get(['plusPlanPages']);
          client = await KRX_MCP.open(url, { clientName, clientVersion: deps.version || '0', fetch: deps.fetch });   // [workspace] deps.fetch 는 검사의 흉내 서버 (없으면 전역 fetch)
          let sec = null, sectionWarn = null;   // RERP 섹션이 없고 노트북도 안 골랐으면(kind 'notebook') 섹션 없이 진행 — 링크로 연결한 페이지는 동기화되고, 페이지 만들기만 못 한다
          try { sec = await ensurePlusSection(client, p, false); } catch (e) { if (!(e && e.kind === 'notebook')) throw e; sectionWarn = { error: e.message, notebooks: e.notebooks || [] }; }
          sectionId = sec ? sec.id : '';
          const ctx = (await deps.context()) || {};   // [workspace] 과제명·내 참여 과제·책임 과제·내 이름은 장부에서 (rerp 는 패널 캐시·projectList·rndUser·참여인력)
          const names = ctx.names || {};
          const myPrjNos = (ctx.myPrjNos || []).map(String).filter(Boolean);
          const who = String(ctx.who || '');
          const lead = new Set((ctx.leadPrjNos || []).map(String).filter(Boolean));
          const r = await KRX_PLAN_SYNC.run({
            client, onenote: KRX_ONENOTE, sectionId, pages: l.plusPlanPages || {}, names, myPrjNos, leadPrjNos: Array.from(lead), only: opts.prjNo || '', createAll: !!opts.createAll, calc: KRX_PLAN, who,
            loadLocal: async () => { const s = await chrome.storage.local.get([KRX_PLAN.KEY, KRX_PLAN.DKEY]); return { plans: s[KRX_PLAN.KEY] || {}, del: s[KRX_PLAN.DKEY] || {} }; },
            saveLocal: (plans, del, prj) => KRX_PLAN.save(plans, del, prj)   // 그 과제 몫만 저장 (다른 창이 같은 키를 쓰므로 통째로 덮지 않음)
          });
          state = Object.assign({ reason, ms: Date.now() - t0, sectionId, section: sec, sectionWarn }, r.state); pages = r.pages;
        } catch (e) {
          const d = KRX_MCP.describe(e);
          state = { at: t0, ok: false, reason, error: d.message, kind: d.kind, ms: Date.now() - t0, sectionId, pages: (prev && sectionId && prev.sectionId === sectionId && prev.pages) || {} };
          if (d.kind === 'notebook') state.notebooks = e.notebooks || [];   // 팝업·설정이 노트북을 고르게
        } finally { if (client) { try { await client.close(); } catch (e) {} } }
      }
      // 과제 하나만 돌린 경우 다른 과제의 지난 결과는 남긴다 (툴팁이 과제별로 읽음)
      if (opts.prjNo && prev && prev.sectionId === state.sectionId && prev.pages) state.pages = Object.assign({}, prev.pages, state.pages || {});
      const patch = { planSyncState: state }; if (pages) patch.plusPlanPages = pages;
      await chrome.storage.local.set(patch);
      return state;
    })().finally(() => { planSyncInflight = null; });
    return planSyncInflight;
  }
  function queuePlanSync(reason) { clearTimeout(planSyncTimer); planSyncTimer = setTimeout(() => { planSync(reason || 'edit').catch(() => {}); }, 4000); }
  async function plusProbe(url) {
    const u = String(url || '').trim() || PLUS_DEFAULTS.onenoteMcpUrl;
    const allowed = await plusAllowed(u); if (!allowed.ok) return allowed;
    try { const r = await KRX_MCP.probe(u, { clientName, fetch: deps.fetch }); return { ok: true, server: r.server, protocol: r.protocol, tools: r.tools.map((t) => t.name), check: KRX_ONENOTE.checkTools(r.tools) }; }
    catch (e) { return Object.assign({ ok: false }, KRX_MCP.describe(e)); }
  }
  async function plusNotebooks(url) {   // 설정 페이지·팝업 "노트북 불러오기": 내가 연 모든 노트북 (섹션 목록에서 추림)
    const u = String(url || '').trim() || PLUS_DEFAULTS.onenoteMcpUrl;
    const allowed = await plusAllowed(u); if (!allowed.ok) return allowed;
    let client = null;
    try { client = await KRX_MCP.open(u, { clientName, fetch: deps.fetch }); return { ok: true, notebooks: await KRX_ONENOTE.listNotebooks(client) }; }
    catch (e) { return Object.assign({ ok: false }, KRX_MCP.describe(e)); }
    finally { if (client) { try { await client.close(); } catch (e) {} } }
  }
  /* 클립보드 쓰기: rerp 는 서비스워커라 오프스크린 문서를 띄웠고, 사이드패널은 deps.copyText(navigator.clipboard) — 긴 작업 뒤라 못 쓰면 패널이 "다시 누르면 링크 복사" 로 안내한다 */
  async function clipboardWrite(text) {
    try { return !!(deps.copyText && await deps.copyText(text)); } catch (e) { return false; }
  }
  /* 패널 "원노트로 내보내기"(페이지를 아직 모를 때): 그 과제만 동기화해 페이지를 만들고(책임자) 링크+ID 를 클립보드에 복사 → { ...state, copied, page } */
  async function planExport(prjNo) {
    const st = await planSync('manual', { prjNo, createAll: true });
    const pg = st && st.pages ? st.pages[prjNo] : null;
    let copied = false;
    if (st && st.ok && pg && pg.webUrl && pg.pageId) copied = await clipboardWrite(`${pg.webUrl}\n[예상 비용 페이지 ID] ${pg.pageId}`);
    return Object.assign({}, st, { copied });
  }
  /* 패널 "원노트에서 가져오기": 동료가 보낸 페이지 링크(내보내기가 복사한 글)를 이 과제에 연결(plusPlanPages[prjNo].bound)하고 그 과제만 바로 동기화 */
  async function planBind(prjNo, text) {
    const p = await loadPlus();
    if (!p.enabled || p.planSync === false) return { ok: false, skipped: 'off', missing: [!p.enabled && '원노트 공유 칸의 "예상 비용" 체크', p.planSync === false && '예상 비용 동기화 설정'].filter(Boolean) };
    if (!prjNo) return { ok: false, kind: 'badlink', error: '과제번호가 없습니다' };
    const url = plusUrl(p);
    const allowed = await plusAllowed(url); if (!allowed.ok) return allowed;
    let client = null;
    try {
      client = await KRX_MCP.open(url, { clientName, fetch: deps.fetch });
      const page = await KRX_ONENOTE.resolveLink(client, text);
      const pages = (await chrome.storage.local.get('plusPlanPages')).plusPlanPages || {};
      pages[prjNo] = Object.assign({}, page, { bound: true, at: Date.now() });
      await chrome.storage.local.set({ plusPlanPages: pages });
    } catch (e) { return Object.assign({ ok: false }, KRX_MCP.describe(e)); }
    finally { if (client) { try { await client.close(); } catch (e) {} } }
    const st = await planSync('manual', { prjNo });
    return Object.assign({}, st, { ok: !!st.ok, bound: true });
  }
  async function plusResolveSection() {   // 팝업·설정: 저장된 설정으로 섹션을 다시 찾고(없으면 만들고) 결과를 돌려줌. 노트북을 골라야 하면 { ok:false, kind:'notebook', notebooks }
    const p = await loadPlus();
    const u = plusUrl(p);
    const allowed = await plusAllowed(u); if (!allowed.ok) return allowed;
    let client = null;
    try { client = await KRX_MCP.open(u, { clientName, fetch: deps.fetch }); const sec = await ensurePlusSection(client, p, true); return { ok: true, section: sec }; }
    catch (e) { const r = Object.assign({ ok: false }, KRX_MCP.describe(e)); if (r.kind === 'notebook') r.notebooks = e.notebooks || []; return r; }
    finally { if (client) { try { await client.close(); } catch (e) {} } }
  }

  // rerp background.js 의 chrome.runtime.onMessage switch 가운데 plan*·plus* 갈래 — rerp/plan.js 의 api.send 에 끼운다
  async function send(msg) {
    switch (msg && msg.type) {
      case 'planSync': return await planSync(String(msg.reason || 'manual'), { prjNo: msg.prjNo ? String(msg.prjNo) : '', createAll: !!msg.createAll });   // 확장 Plus: 예상 비용 ↔ 과제별 원노트 페이지 (구름 아이콘 manual+prjNo · 패널 열 때 load · 설정 페이지 지금 동기화/모두 만들기)
      case 'planSyncQueue': queuePlanSync(String(msg.reason || 'edit')); return { ok: true };   // 항목 편집 뒤 4초 모아서
      case 'planBind': return await planBind(String(msg.prjNo || ''), String(msg.text || ''));   // 패널 "원노트에서 가져오기": 페이지 링크 적용
      case 'planExport': return await planExport(String(msg.prjNo || ''));                        // 패널 "원노트로 내보내기": 페이지 만들고(책임자) 링크 복사
      case 'plusProbe': return await plusProbe(msg.url);                                    // 설정 페이지 "연결 확인"
      case 'plusNotebooks': return await plusNotebooks(msg.url);                            // 설정 페이지·팝업 "노트북 불러오기"
      case 'plusResolveSection': return await plusResolveSection();                          // 팝업·설정: 섹션(RERP) 찾기/만들기
      default: return { ok: false, error: `모르는 요청 ${msg && msg.type}` };
    }
  }

  return { planSync, queuePlanSync, plusProbe, plusNotebooks, planExport, planBind, plusResolveSection, send, PLAN_SYNC_MIN_MS };
}
