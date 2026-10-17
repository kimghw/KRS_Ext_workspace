// R&D 탭의 화면. 차년도 자르기·예산 셈·저절로 남는 변경이력·요약·가져오기·내보내기는 src/rnd.js 가 하고,
// 여기는 그것을 화면에 잇고 chrome.storage(rndBook)에 남긴다.
//
//   과제 칩(별칭) → 머리(별칭 한 줄 — 펴면 과제 정보) · 차년도 칩(오늘이 든 것에 "올해" — 예산 정보가 없는 차년도는 회색 점선)
//   → 예산(비목 줄) · 참여연구자 · 연구개발 계획 · 진행 기록 · 변경 및 이력 관리(위는 rndgen 의 YAML 고치기, 아래는 변경이력) → 요약 복사 · JSON 저장·불러오기 → R&D 설정(연구개발계획서 YAML 넣기 …)
//   예산 정보가 없는 차년도를 보고 있으면(2026-10-11 사용자 지정) 기록 칸들 대신 까닭 카드가 서고 R&D 설정이 저절로 펴진다 — 지난 차년도의 기록을 보이지 않는다.
//
// 어디에도 올리지 않는다 — 이 브라우저에만 남는다. 공문 탭의 공문 설정 과제를 가져올 수 있다(처음 열 때 과제가 없으면 저절로).
// 예산 **계획**을 고치거나 비목을 빼면, 과제의 책임자·연구기간을 고치면 변경이력에 저절로 한 줄이 남고 사유만 사람이 적는다.
// 과제는 별칭으로 다룬다 — 폼에서 별칭은 필수이고 과제끼리 겹치지 않으며, 별칭이 없는 과제는 머리에 정하는 칸이 선다.

import {
  BOOK_KEY, MAX_PROJECTS, CHANGE_KINDS, BUDGET_ITEMS, normalizeBook, normalizeProject, projectOf, aliasOwner, viewYear, yearBook, yearsOf, currentYear, yearLabel, yearState,
  periodText, dot, todayStr, isYmd, comma, shortWon, budgetTotals, hasBudget, budgetChanges, projectChanges, newestFirst, newId,
  fromGongmun, mergeProjects, restoreBook, exportJson, exportName, importJson, summaryText, parseRoster, parseSections, fileLog, noteLogs,
  budgetTsv, entryText, logLines, changeLine, changeLines, thousand, amountOfThousand, refsText, normalizeSupport, SUPPORT_MAX,
} from './src/rnd.js';
import { SET_KEY, normalizeSet, includeNames, isHidden, nameKey, projectRecs, pickYearRec, candidates, linkOf, isLive, isFresh, fetchSnapshot, applySnapshot, erpExtras, erpHead, clock as erpClock } from './src/rnderp.js';
// kr_ext_rerp 에서 옮긴 것(rerp/ — 출처·갱신 규칙은 rerp/README.md): rERP 호출(erp), 예상 비용 저장소와 입력 처리(PLAN), 과제집행비율 표(budgetTable), 원노트 동기화 배선(createPlusSync).
import ERP from './rerp/erp.js';
import PLAN from './rerp/plan.js';
import { budgetTable } from './rerp/planui.js';
import { createPlusSync, PLUS_DEFAULTS } from './rerp/plussync.js';
// 연구내용 원노트 공유(2026-10-14) — rerp 의 연구개발계획서 기록(research)과 「[연구내용] 과제명」 페이지(researchsync), MCP·OneNote 손잡이.
import RS from './rerp/research.js';
import RSY from './rerp/researchsync.js';
import KRX_MCP from './rerp/mcp.js';
import KRX_ONENOTE from './rerp/onenote.js';
import { PROJECTS_KEY as GM_PROJECTS_KEY } from './src/gongmun.js';
import { JOB_LIST_PATH, JOB_QUERY, parseJobRows, rankJobs, jobLine } from './src/jobid.js';
import { fetchIoList, fetchAcct, rankIo, ioLine, acctFresh, fiscalYearOf, EA_HOME } from './src/eacct.js';
import { siteFetch } from './src/net.js';
import { ORIGIN } from './src/config.js';
import { kindOf, applyYaml, KIND_ORDER, revOf, readSnapshot } from './src/rndyaml.js';
import { MANIFEST_PATH, checkManifest, skillGuide, bundleSkills, zipName, kb } from './src/rndskills.js';
import {
  NOTE_KEY, INFO_KEYS, normalizeNote, bookHash, syncInfo, blockHtml, findBlock, readBlock, openNote as defaultOpenNote,
  listSections, findPage, createPage, readPage, writeBlock,
} from './src/rndnote.js';

const SAVE_WAIT_MS = 400;
/** 예산 정보가 없는 차년도 칩의 풍선말·상태 줄·까닭 카드(2026-10-11 사용자 지정) — 칩은 회색 점선이고, 누르면 넘어가되 기록 칸 대신 R&D 설정이 선다. */
const NO_BUDGET = '예산 정보가 들어 있지 않습니다';
/** 지우기 버튼은 두 번 누른다 — 처음 누르면 이만큼 동안 "정말 지우기" 로 바뀌고, 그 안에 다시 누르면 지운다. */
const CONFIRM_MS = 3000;
/** 원노트 공유가 켜져 있으면 과제 정보를 고친 뒤 이만큼 기다렸다 맞춘다(그 사이 더 고치면 모아서 한 번). 탭을 열 때는 이만큼 지났을 때만. */
const NOTE_WAIT_MS = 1200;
const NOTE_OPEN_MS = 60_000;
/** 복사 아이콘(sidepanel.html 의 것과 같다) — 누르면 잠깐 체크(못 했으면 ×)로 바뀌었다 돌아온다. */
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>';
const DONE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>';
const FAIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
const copyBtn = (attr, what) => `<button type="button" class="rd-icon" ${attr} title="${what} 복사" aria-label="${what} 복사">${COPY_ICON}</button>`;

/**
 * @param {{$:Function, escapeHtml:Function, logEvent:Function, copyText?:(text:string) => Promise<boolean>,
 *   flash?:(btn:HTMLElement, text:string, ms?:number) => void, download?:(data:string|Uint8Array, filename:string, type?:string) => Promise<void>,
 *   readAsset?:(path:string, as?:'text'|'bytes') => Promise<string|Uint8Array>, today?:() => string,
 *   openNote?:() => Promise<{tool:(name:string, args:object, ms?:number) => Promise<any>}>}} deps
 *   readAsset 은 확장 안의 파일(rnd/skills.json · rnd/skills/…)을 읽는 길, today 는 검사에서 날짜를 못 박는 데 쓴다,
 *   openNote 는 OneNote MCP 서버에 붙는 길(검사에서는 흉내), erp 는 rERP 를 부르는 것(rerp/erp.js — 검사에서는 흉내), me 는 내 이름(설정),
 *   mcpFetch 는 예상 비용 원노트 동기화가 MCP 서버를 두드릴 fetch(검사에서는 흉내, 없으면 전역),
 *   jobs 는 과제 정보 카드의 Job Id 저절로 찾기가 받는 R&D PMS 과제 목록(줄 배열 — 검사에서는 흉내),
 *   acct 는 회계(e-accounting — src/eacct.js)를 부르는 것 { list(year) → 내 부서 과제(I/O) 목록, get(year, io, options) → 그 과제의 회계 예산 스냅샷 } (검사에서는 흉내)
 */
export function createRndPanel({ $, escapeHtml, logEvent, copyText = defaultCopy, flash = () => {}, download = defaultDownload, readAsset = defaultReadAsset, today = todayStr, openNote = defaultOpenNote, erp = ERP, me = () => '', mcpFetch = undefined, jobs = defaultJobs, acct = defaultAcct }) {
  const el = {
    root: $('rnd'), projects: $('rdProjects'), empty: $('rdEmpty'), emptyImport: $('rdEmptyImport'), emptyAdd: $('rdEmptyAdd'),
    intake: $('rdIntake'), yaml: $('rdYaml'),
    head: $('rdHead'), info: $('rdInfo'), name: $('rdName'), edit: $('rdEdit'), meta: $('rdMeta'), years: $('rdYears'), yearNote: $('rdYearNote'),
    aliasAsk: $('rdAliasAsk'), aliasIn: $('rdAliasIn'), aliasSet: $('rdAliasSet'),
    form: $('rdForm'), formTitle: $('rdFormTitle'), fName: $('rdFName'), fAlias: $('rdFAlias'), fCode: $('rdFCode'), fLead: $('rdFLead'),
    fStart: $('rdFStart'), fEnd: $('rdFEnd'), fCalendar: $('rdFCalendar'), fNote: $('rdFNote'), fNeed: $('rdFNeed'), fSave: $('rdFSave'), fCancel: $('rdFCancel'), fDel: $('rdFDel'),
    // Job Id(전자결재 과제 찾기 — 2026-10-16) — 폼의 글 칸과, 과제 정보 카드의 저절로 찾기 묶음(후보 줄 · 알림 줄 · 다시 찾기 · 이 번호로 저장).
    fJob: $('rdFJob'), jobBox: $('rdJobBox'), jobList: $('rdJobList'), jobMsg: $('rdJobMsg'), jobRetry: $('rdJobRetry'), jobSave: $('rdJobSave'),
    // 회계 I/O(e-accounting 과제 코드 — 2026-10-17) — 폼의 글 칸과, 과제 정보 카드의 저절로 찾기 묶음(Job Id 와 같은 꼴 + 로그인 링크)과, 예산 칸의 회계 예산(rERP 집행내역과 같은 접힌 한 줄 — 형편 줄 · 머리 줄 · 다시 조회 · 표 · 알림 줄, 2026-10-17 사용자 지정).
    fIo: $('rdFIo'), ioBox: $('rdIoBox'), ioList: $('rdIoList'), ioMsg: $('rdIoMsg'), ioRetry: $('rdIoRetry'), ioSave: $('rdIoSave'), ioLogin: $('rdIoLogin'),
    acctBox: $('rdAcctBox'), acctState: $('rdAcctState'), acctHead: $('rdAcctHead'), acctRefresh: $('rdAcctRefresh'), acctTable: $('rdAcctTable'), acctMsg: $('rdAcctMsg'), acctLogin: $('rdAcctLogin'),
    status: $('rdStatus'), body: $('rdBody'), yearEmpty: $('rdYearEmpty'),
    budgetState: $('rdBudgetState'), budget: $('rdBudget'), budgetSum: $('rdBudgetSum'), budgetCopy: $('rdBudgetCopy'),
    rosterState: $('rdRosterState'), roster: $('rdRoster'), rosterTools: $('rdRosterTools'), rosterSrc: $('rdRosterSrc'), rosterCopy: $('rdRosterCopy'),
    // 행정지원(과제마다 — 이름·맡은 일·공문 참조, 2026-10-16) — 참여인력 칸(2026-10-17 까지는 '참여연구자 및 행정지원') 안에 손으로 적는다.
    support: $('rdSupport'), supportAdd: $('rdSupportAdd'),
    planState: $('rdPlanState'), plan: $('rdPlan'), planTools: $('rdPlanTools'), planSrc: $('rdPlanSrc'), planCopy: $('rdPlanCopy'),
    logState: $('rdLogState'), logDate: $('rdLogDate'), logTitle: $('rdLogTitle'), logText: $('rdLogText'), logAdd: $('rdLogAdd'), logCancel: $('rdLogCancel'), logs: $('rdLogs'), logsCopy: $('rdLogsCopy'),
    changeState: $('rdChangeState'), chDate: $('rdChDate'), chKind: $('rdChKind'), chItem: $('rdChItem'), chBefore: $('rdChBefore'), chAfter: $('rdChAfter'),
    chReason: $('rdChReason'), chAdd: $('rdChAdd'), chCancel: $('rdChCancel'), chNew: $('rdChNew'), chForm: $('rdChForm'), changes: $('rdChanges'), changesCopy: $('rdChangesCopy'),
    copy: $('rdCopy'), export: $('rdExport'), import: $('rdImport'), importGm: $('rdImportGm'),
    skillBox: $('rdSkillBox'), skillState: $('rdSkillState'), skills: $('rdSkills'), skillZip: $('rdSkillZip'), skillGuide: $('rdSkillGuide'),
    noteState: $('rdNoteState'), noteOn: $('rdNoteOn'), noteSection: $('rdNoteSection'), noteSections: $('rdNoteSections'), noteSync: $('rdNoteSync'),
    noteOpen: $('rdNoteOpen'), noteMsg: $('rdNoteMsg'),
    // rERP 집행내역(예산 칸 아래, 접힌 한 줄 — erpState 가 그 줄의 형편)과 원노트 칸의 예상 비용 공유 — 2026-10-11.
    erp: $('rdErp'), erpState: $('rdErpState'), erpInfo: $('rdErpInfo'), erpRefresh: $('rdErpRefresh'), erpLink: $('rdErpLink'), erpUnlink: $('rdErpUnlink'),
    erpPick: $('rdErpPick'), erpSelect: $('rdErpSelect'), erpPickOk: $('rdErpPickOk'), erpMsg: $('rdErpMsg'), erpTable: $('rdErpTable'),
    plusOn: $('rdPlusOn'), plusRow: $('rdPlusRow'), plusSection: $('rdPlusSection'), plusNotebook: $('rdPlusNotebook'), plusFind: $('rdPlusFind'), plusMsg: $('rdPlusMsg'),
    // 원노트 칸의 연구내용 공유(2026-10-14) — 올리기 · 링크 복사 · 열기 · 알림 줄.
    resShare: $('rdResShare'), resCopy: $('rdResCopy'), resOpen: $('rdResOpen'), resMsg: $('rdResMsg'),
    // 예산 칸 맨 위 줄 — 집행에 더할 것(미청구·사용계획 — 승인전 체크는 2026-10-11 사용자 지정으로 뺐다). 2026-10-11 사용자 지정으로 R&D 설정에서 옮겼다(값은 여전히 rndSettings).
    incRow: $('rdIncRow'), incUnbilled: $('rdIncUnbilled'), incPlan: $('rdIncPlan'),
    // R&D 설정(접힌 한 줄) — rERP 집행내역 켜기/끄기 · 예산 칸에 보일 비목(items — 2026-10-11 사용자 지정). 원노트 공유·YAML 넣기·스킬 칸도 이 안에 있다.
    setBox: $('rdSetBox'), setState: $('rdSetState'), erpOn: $('rdErpOn'), itemBox: $('rdItemBox'), items: $('rdItems'),
  };
  const st = {
    loaded: false, book: normalizeBook(null),
    // editing 은 고치는 중인 과제 id('new' 는 새 과제). snap 은 그린 시점의 예산 줄 — 계획이 바뀌었는지 이것과 견준다.
    // overlay 는 머리·몸통을 덮는 카드({ name, close } — rndgen 의 과제 더하기 'add', 2026-10-16). 폼·덮개가 열려 있으면 과제 칩은 어느 것도 켜지지 않고 ＋ 칩이 켜진다.
    editing: null, overlay: null, snap: [], logEdit: null, chEdit: null,
    // Job Id 저절로 찾기(과제 정보 카드 — 2026-10-16 사용자 지정): for 는 찾은 과제 id(같은 과제는 다시 찾지 않는다 — 다시 찾기만), run 은 도는 중인 찾기(다른 과제로 가면 그 답은 버린다),
    // state 는 idle·busy·done·fail, list 는 후보(src/jobid.js rankJobs — 높은 차례), pick 은 고른 후보의 번호, msg/bad 는 알림 줄.
    // jobRows 는 이 세션에 받아 둔 R&D PMS 과제 목록 — 과제를 바꿔도 다시 받지 않는다(다시 찾기만 새로 받는다).
    job: { for: '', run: 0, state: 'idle', list: [], pick: 0, msg: '', bad: false }, jobRows: null,
    // 회계 I/O 저절로 찾기(과제 정보 카드 — 2026-10-17 사용자 지정, Job Id 와 같은 꼴 — src/eacct.js rankIo): ioOpts 는 이 세션에 받아 둔 회계의 내 부서 과제(I/O) 목록, login 은 로그인이 풀려 못 받았는가.
    // acctRun 은 회계 예산 스냅샷 받기의 형편 — for 는 받아 본 과제:I/O(한 세션에 한 번, 다시 조회만 새로), busy·msg·bad·login.
    io: { for: '', run: 0, state: 'idle', list: [], pick: 0, msg: '', bad: false, login: false }, ioOpts: null,
    acctRun: { for: '', run: 0, busy: false, msg: '', bad: false, login: false },
    // 참여인력 칸 머리 줄의 앞쪽(계획서의 참여연구자 수 — "연구자 3명") — 뒤에 행정지원 수가 붙는다(paintSupportState). 인건비·참조자 이름은 적지 않는다(2026-10-17 사용자 지정: "연구자 n명, 행정 1명 이렇면 될듯").
    rosterText: '',
    // 예산 정보가 없는 차년도를 보는 중이면 그 과제:차년도(emptyKey) — 들어올 때 R&D 설정을 저절로 폈으면(setAuto) 나갈 때 도로 접는다(2026-10-11 사용자 지정).
    emptyKey: '', setAuto: false,
    // 스킬 목록(rnd/skills.json)은 그 칸을 처음 펼 때 읽는다. 못 읽었으면 까닭을 둔다.
    manifest: null, manifestError: '',
    // 원노트 공유 — 저장해 두는 형편(rndNote), 마지막으로 맞춘 장부의 지문(고친 것이 있는지), 도는 중인 맞추기와 그 사이 들어온 요청.
    note: normalizeNote(null), noteHash: '', noteRun: null, noteAgain: false, noteBusy: false,
    // R&D 설정(chrome.storage 의 rndSettings, src/rnderp.js normalizeSet) — erp: rERP 집행내역을 보이는가 · unbilled/plan: 집행에 미청구·사용계획을 더하는가(승인전은 더하지 않는다 — 2026-10-11 사용자 지정)
    // · hide: 예산 칸에서 숨긴 비목 이름들(줄만 숨고 합계에는 든다 — 2026-10-11 사용자 지정).
    set: normalizeSet(null),
    // rERP 집행내역 — 도는 중인 조회, 이 세션에서 저절로 잇기를 해 본 차년도, 마지막으로 받은 과제 목록(고르기용), 이벤트를 달았는지.
    erpRun: null, erpTried: new Set(), erpRecs: null, erpBusy: false, plHost: null,
    // 예상 비용의 화면 상태 — rerp/plan.js(bind)와 rerp/planui.js(budgetTable)가 rerp 의 패널 state 와 같은 모양으로 읽고 쓴다.
    // data.settings.planSync 는 원노트 예상 비용 공유가 켜져 있는지, data.myNames 는 책임자 판정(과제책임자 == 내 이름)에 쓴다.
    pl: { plans: {}, planShown: new Set(), expanded: new Set(), data: { settings: { planSync: false }, myNames: [] } },
    // 연구내용 공유 — 과제(과제명 키)마다 올린 페이지(chrome.storage 의 researchShare), 도는 중인가, 알림 줄(resFor 과제의 것만 보인다).
    resShare: {}, resBusy: false, resMsg: '', resError: false, resFor: '',
  };

  // rndgen/(과제 더하기·변경사항 카드 — sidepanel.js 가 잇는다)의 훅 — 하나씩(마지막 등록이 이긴다). 없으면 ＋ 는 새 과제 폼이고 넣기·지우기 뒤에 할 일이 없다.
  //   viewHook(view())            : 그릴 때마다(paintAll·폼 열기) — 보고 있는 과제·차년도·폼/덮개
  //   addHook({ projectId, n })   : ＋ 칩 · 과제 없음 카드의 과제 더하기 · 빈 차년도 카드의 "사업계획서에서 이 차년도 뽑기"
  //   intakeHook(result, texts, meta) : YAML 이 하나라도 들어간 뒤(끌어 놓기·붙여 넣기·뽑기·고치기 모두) — 원문 저장(rndYamlText)
  //   deleteHook(projectId)       : 과제를 지운 뒤
  let viewHook = null, addHook = null, intakeHook = null, deleteHook = null;
  const cur = () => projectOf(st.book, st.book.current.project);
  const curYear = (p) => viewYear(st.book, p, today());
  /**
   * 예산 정보가 없는 차년도인가(src/rnd.js hasBudget — 비목 줄에 계획·집행이 하나도 없으면) — 오늘이 든 차년도는 예외(예산을 손으로 적는 곳).
   * 칩은 회색 점선이고, 누르면 넘어가되 지난 차년도의 기록 대신 까닭 카드와 R&D 설정(연구개발계획서 YAML 넣기)이 선다(2026-10-11 사용자 지정).
   */
  const yearEmpty = (p, n) => n !== currentYear(p, today()) && !hasBudget(p.years[n]);
  const curBook = (p) => yearBook(p, curYear(p));
  const label = (p) => p.alias || p.name;

  function setStatus(msg, kind = '') {
    el.status.className = `status ${kind}`;
    el.status.textContent = msg;
  }

  /* ---------------------------------------------------------- 저장 */

  let timer = null;
  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => chrome.storage.local.set({ [BOOK_KEY]: st.book }), SAVE_WAIT_MS);
    noteSoon();
  }

  /* ---------------------------------------------------------- 두 번 누르기 */

  const armed = new WeakMap();
  /** 처음 누르면 글이 바뀌고(CONFIRM_MS 동안), 그 안에 다시 누르면 true. */
  function confirmTwice(btn, text) {
    if (armed.has(btn)) {
      clearTimeout(armed.get(btn));
      armed.delete(btn);
      btn.classList.remove('armed');
      return true;
    }
    const was = btn.textContent;
    btn.textContent = text;
    btn.classList.add('armed');
    armed.set(btn, setTimeout(() => {
      armed.delete(btn);
      btn.textContent = was;
      btn.classList.remove('armed');
    }, CONFIRM_MS));
    return false;
  }

  /* ---------------------------------------------------------- 과제 */

  function paintProjects() {
    const p = cur();
    const full = st.book.projects.length >= MAX_PROJECTS;
    // 새 과제 폼·덮개(과제 더하기 카드)가 열려 있으면 과제 칩은 모두 꺼지고 ＋ 칩이 켜진다. 고치기 폼은 고치는 과제의 칩이 켜진 채다(2026-10-16 사용자 지정
    // "어떤 과제인지 선택이 안되잖아" — 전에는 꺼져 어느 과제를 고치는지 보이지 않았다). 켜진 칩을 눌러도 폼·덮개를 닫고 그 과제로 간다(pickProject).
    const covered = st.editing != null || !!st.overlay;
    const adding = st.editing === 'new' || st.overlay?.name === 'add';
    const onId = st.editing != null && st.editing !== 'new' ? st.editing : (covered ? null : p?.id);
    const chips = st.book.projects.map((x) => {
      const on = !!onId && x.id === onId;
      return `<button type="button" class="rd-proj${on ? ' active' : ''}" data-proj="${x.id}" aria-pressed="${on}" title="${escapeHtml(x.name)}${x.code ? ` · ${escapeHtml(x.code)}` : ''}">${escapeHtml(label(x))}</button>`;
    });
    chips.push(`<button type="button" class="rd-proj rd-proj-add${adding ? ' active' : ''}" data-add="1" aria-pressed="${adding}" aria-label="과제 더하기" title="${full ? `과제는 ${MAX_PROJECTS}개까지입니다` : '과제 더하기 — YAML 을 넣거나 사업계획서에서 뽑거나 직접 적습니다'}"${full ? ' disabled' : ''}>＋</button>`);
    el.projects.innerHTML = chips.join('');
    el.projects.classList.toggle('hidden', !st.book.projects.length);
    el.empty.classList.toggle('hidden', !!st.book.projects.length || covered);
  }

  /**
   * 과제 칩 — 그 과제로 간다. 새 과제 폼·과제 더하기 카드(덮개)가 열려 있으면 그것을 닫고 간다 — 보고 있던 과제의 칩이어도
   * (2026-10-16 사용자 지정: "sscb 버튼 누르면 그리 안감" — 전에는 같은 과제면 아무것도 하지 않아 폼이 그대로 남았다).
   */
  function pickProject(id) {
    if (!projectOf(st.book, id)) return;
    const covered = st.editing != null || !!st.overlay;
    if (st.editing != null) {
      st.editing = null;
      el.form.classList.add('hidden');
    }
    if (st.overlay) {
      // 덮개를 먼저 비우고 닫는다 — 닫는 쪽(rndgen)이 setOverlay(null) 을 다시 부르지 않게(view().overlay 가 이미 null).
      const o = st.overlay;
      st.overlay = null;
      try { o.close?.(); } catch { /* 닫는 쪽의 탈은 칩 누름을 막지 않는다 */ }
    }
    if (id === st.book.current.project) {
      if (covered) paintAll();
      return;
    }
    st.book.current.project = id;
    clearLogForm();
    clearChangeForm();
    clearErpPick();
    setStatus('');
    paintAll();
    save();
    erpAuto();
  }

  function paintHead() {
    const p = cur();
    // 폼이나 덮개(과제 더하기 카드)가 열려 있으면 머리·몸통·빈 차년도 카드를 숨긴다.
    const editing = st.editing != null || !!st.overlay;
    el.head.classList.toggle('hidden', !p || editing);
    // 예산 정보가 없는 차년도를 보고 있으면(2026-10-11 사용자 지정) 상관없는 지난 차년도의 예산·참여연구자·계획·기록 칸(rdBody) 대신 까닭 카드가 서고 R&D 설정이 펴진다.
    const empty = !!p && !editing && yearEmpty(p, curYear(p));
    el.body.classList.toggle('hidden', !p || editing || empty);
    el.yearEmpty.classList.toggle('hidden', !empty);
    openSetFor(empty ? `${p.id}:${curYear(p)}` : '');
    if (!p) return;
    el.name.textContent = label(p);
    el.name.title = p.name;
    el.aliasAsk.classList.toggle('hidden', !!p.alias);
    const ys = yearsOf(p);
    // Job Id 가 비면 저절로 찾는다(한 과제에 한 번 — 폼이 열려 있을 때는 아니다). 표의 Job Id 줄은 있으면 그대로, 비면 고른 후보나 형편.
    // 회계 I/O 도 같다 — 비면 회계의 과제 목록에서 찾고, 있으면 그 해의 계정과목별 예산을 받아 둔다(acctAuto — 스냅샷이 이 해의 것이고 10분 안이면 받지 않는다).
    if (!editing) {
      autoJob(p);
      autoIo(p);
      acctAuto(p);
    }
    // 과제 정보는 접힌 칸 안에 — 머리에는 별칭 한 줄과 차년도 칩만 늘 보인다.
    const meta = [['과제명', p.name]];
    if (p.code) meta.push(['과제번호', p.code]);
    meta.push(['Job Id', p.job || jobRowText()]);
    meta.push(['회계 I/O', p.io ? `${p.io}${p.acct?.ioName ? ` ${p.acct.ioName}` : ''}` : ioRowText()]);
    if (p.lead) meta.push(['책임자', p.lead]);
    // 공문 참조자(계획서 YAML 의 공문.참조자 — 공문 종류마다)는 보이기만 한다. 적는 곳은 YAML 이고 공문 탭이 결재선에 쓴다(2026-10-15).
    if (Object.keys(p.refs || {}).length) meta.push(['공문 참조자', refsText(p.refs)]);
    meta.push(['연구기간', p.start ? `${periodText(p)} (총 ${ys.length}차년도${p.calendar ? ' · 1월 1일 기준' : ''})` : '미정 — 과제 고치기에서 시작일·종료일을 적으세요']);
    if (p.note) meta.push(['비고', p.note]);
    el.meta.innerHTML = meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
    paintJob(p);
    paintIo(p);
    paintAcct(p);
    const now = currentYear(p, today());
    const view = curYear(p);
    el.years.innerHTML = ys.map((y) => {
      const on = y.n === view;
      // 예산 정보가 없는 차년도는 회색 점선(2026-10-11 사용자 지정 — 올해 차년도는 예외, 예산을 손으로 적는 곳). 눌러서 넘어갈 수는 있고, 보고 있어도 점선은 그대로.
      const off = yearEmpty(p, y.n);
      const period = y.start ? `${dot(y.start)} ~ ${dot(y.end)}` : '연구기간 미정';
      const title = off ? `${period} · ${NO_BUDGET}` : period;
      return `<button type="button" class="rd-year${on ? ' active' : ''}${y.n === now ? ' now' : ''}${off ? ' off' : ''}" data-year="${y.n}" aria-pressed="${on}" title="${title}">${yearLabel(y.n)}${y.n === now && y.start ? '<small>올해</small>' : ''}</button>`;
    }).join('');
    const y = ys.find((x) => x.n === view) || ys[0];
    el.yearNote.textContent = `${yearLabel(y.n)}${y.start ? ` · ${dot(y.start)} ~ ${dot(y.end)}` : ''} · ${yearState(y, today())}`;
    // 단추는 사업계획서에서 이 차년도의 스냅샷을 뽑는 더하기 카드(rndgen — 2026-10-16)를 이 과제·차년도로 연다. YAML 을 넣는 길도 그대로 둔다(둘 다 길).
    if (empty) {
      el.yearEmpty.innerHTML = `<p><strong>${yearLabel(view)}</strong> — ${NO_BUDGET}. 아래 <strong>R&amp;D 설정</strong>의 연구개발계획서 YAML 넣기에 이 차년도의 KR_&lt;과제&gt;.yaml 을 넣으면 예산·참여연구자·연구개발 계획이 서고 기록 칸이 열립니다.</p>`
        + '<div class="rd-actions"><button type="button" class="primary small" data-rdg-extract="1">사업계획서에서 이 차년도 뽑기</button></div>';
    }
  }

  /**
   * 예산 정보가 없는 차년도로 들어오면(key 는 과제:차년도) R&D 설정을 편다 — 이미 펴 두었으면 그대로. 나가면(key 가 빈 글) 저절로 편 것만 도로 접는다.
   * 같은 자리를 다시 그릴 때는 아무것도 하지 않는다 — 사람이 그 사이 접은 것을 다시 펴지 않으려고.
   */
  function openSetFor(key) {
    if (key === st.emptyKey) return;
    st.emptyKey = key;
    if (key) {
      if (!el.setBox.open) {
        el.setBox.open = true;
        st.setAuto = true;
      }
    } else if (st.setAuto) {
      st.setAuto = false;
      el.setBox.open = false;
    }
  }

  /** 별칭이 없는 과제에 머리의 칸에서 별칭을 정한다 — 다른 과제의 별칭과 겹치면 안 된다. */
  function setAlias() {
    const p = cur();
    if (!p) return;
    const alias = el.aliasIn.value.trim().slice(0, 60);
    const dup = aliasOwner(st.book, alias, p.id);
    if (!alias || dup) {
      setStatus(alias ? `같은 별칭의 과제가 있습니다 — ${dup.name}` : '별칭을 적으세요 — 예) SSCB', 'error');
      el.aliasIn.focus();
      return;
    }
    p.alias = alias;
    el.aliasIn.value = '';
    setStatus(`별칭을 정했습니다 — ${alias}`);
    logEvent('rnd', true, `R&D 과제 별칭: ${p.name} → ${alias}`);
    paintAll();
    save();
  }

  function pickYear(n) {
    const p = cur();
    if (!p || !yearsOf(p).some((y) => y.n === n) || n === curYear(p)) return;
    st.book.current.year[p.id] = n;
    clearLogForm();
    clearChangeForm();
    clearErpPick();
    // 예산 정보가 없는 차년도(2026-10-11 사용자 지정)도 넘어간다 — 기록 칸 대신 까닭 카드와 R&D 설정이 선다(paintHead). 상태 줄에는 따로 적지 않는다(카드와 같은 말이 두 번 보여서).
    setStatus('');
    paintAll();
    save();
    erpAuto();
  }

  /* ---------------------------------------------------------- 과제 폼 */

  function openForm(id) {
    const p = id === 'new' ? normalizeProject({}) : projectOf(st.book, id);
    if (!p) return;
    st.editing = id;
    el.formTitle.textContent = id === 'new' ? '새 과제' : '과제 고치기';
    el.fName.value = p.name;
    el.fAlias.value = p.alias;
    el.fCode.value = p.code;
    el.fJob.value = p.job;
    el.fIo.value = p.io;
    el.fLead.value = p.lead;
    el.fStart.value = p.start;
    el.fEnd.value = p.end;
    el.fCalendar.checked = !!p.calendar;
    el.fNote.value = p.note;
    el.fNeed.textContent = '';
    el.fDel.classList.toggle('hidden', id === 'new');
    el.form.classList.remove('hidden');
    paintProjects();
    paintHead();
    notifyView();
    el.fName.focus();
  }

  function closeForm() {
    st.editing = null;
    el.form.classList.add('hidden');
    paintAll();
  }

  /* ---------------------------------------------------------- Job Id 저절로 찾기(과제 정보 카드 — 2026-10-16 사용자 지정) */
  // "job_id 찾기를 자동으로 하고 여기 페이지에서 맞는지 확인하면 버튼은 사라지고 Jobid 저장만 하도록 … 과제 고치기에서 수정은 할지라도" — 규칙("과제 책임자로 우선 검색하고
  // 유사도가 높은 0.5 이상인 걸 … 가장 높은 걸 가져오고 선택할 수 있도록")은 src/jobid.js. Job Id 가 빈 과제를 고르면 R&D PMS 과제 목록(공문 창의 과제 찾기 팝업이 받는 것 — 읽기만)을
  // 받아 후보를 높은 차례로 보이고 가장 높은 것을 고른 채로 둔다. '이 번호로 저장'을 누르면 과제에 남고 묶음은 사라진다(표의 Job Id 줄만). 과제 고치기의 Job Id 칸은 손으로 고치는 곳 —
  // 비우고 저장하면 후보가 다시 보인다(같은 세션의 목록으로, 다시 받지 않는다).

  const jobPicked = () => st.job.list[st.job.pick] || null;

  /** 과제 정보 표의 Job Id 줄 — Job Id 가 빌 때의 글(고른 후보나 형편). */
  function jobRowText() {
    const j = st.job;
    if (j.state === 'busy') return '찾는 중 — R&D PMS 과제 목록을 읽습니다…';
    if (j.state === 'done' && j.list.length) return `${jobPicked().id} (후보 — 맞는지 보고 아래에서 저장)`;
    if (j.state === 'fail') return '없음 — 과제 목록을 받지 못했습니다(아래 다시 찾기)';
    if (j.state === 'done') return '없음 — 비슷한 과제가 없습니다(과제 고치기에서 적으세요)';
    return '없음';
  }

  /** Job Id 가 빈 과제를 보면 한 번 찾는다 — 같은 과제는 다시 찾지 않는다(fresh 는 다시 찾기 — 목록도 새로 받는다). 답이 오면 머리를 다시 그린다. */
  function autoJob(p, fresh = false) {
    if (!p || p.job || (!fresh && st.job.for === p.id)) return;
    const run = ++st.job.run;
    st.job = { for: p.id, run, state: 'busy', list: [], pick: 0, msg: '', bad: false };
    if (fresh) st.jobRows = null;
    (async () => {
      let rows;
      try {
        rows = st.jobRows || await jobs();
      } catch (err) {
        if (run !== st.job.run) return;
        st.job = { ...st.job, state: 'fail', msg: `과제 목록을 받지 못했습니다 — ${err?.message || err}`, bad: true };
        paintHead();
        return;
      }
      if (run !== st.job.run) return;
      st.jobRows = rows;
      const { by, list } = rankJobs(rows, { name: p.name, lead: p.lead });
      const top = list[0];
      const why = !top ? '' : by === 'lead' ? `책임자 ${top.lead} 같음 · ` : p.lead ? `책임자 ${p.lead} 의 과제는 비슷한 것이 없어 과제명으로만 · ` : '';
      const msg = top ? `가장 비슷한 과제를 골라 두었습니다(${why}유사도 ${top.score.toFixed(2)}) — 맞으면 이 번호로 저장, 아니면 다른 후보를 누르세요.`
        : rows?.length ? `과제명이 비슷한 과제(유사도 0.5 이상)가 없습니다 — 과제 목록 ${rows.length}개를 봤습니다. 과제 고치기에서 Job Id 를 직접 적으세요.`
          : '과제 목록이 비었습니다 — eclass 에 로그인되어 있는지 보세요.';
      st.job = { ...st.job, state: 'done', list, pick: 0, msg, bad: !top };
      paintHead();
    })();
  }

  /** 과제 정보 표 아래의 Job Id 묶음 — Job Id 가 비어 있을 때만. 후보 줄(고른 것은 파랑)과 알림 줄, 다시 찾기(못 받았거나 후보가 없을 때)·이 번호로 저장(후보가 있을 때). */
  function paintJob(p) {
    const j = st.job;
    const show = !!p && !p.job && j.for === p.id && j.state !== 'idle';
    el.jobBox.classList.toggle('hidden', !show);
    if (!show) return;
    el.jobList.innerHTML = j.list.map((r, i) => {
      const on = i === j.pick;
      const meta = [r.sameLead ? `책임자 ${r.lead} 같음` : r.lead ? `책임자 ${r.lead}` : '', r.proc, `유사도 ${r.score.toFixed(2)}`].filter(Boolean).join(' · ');
      return `<button type="button" class="rd-job-cand${on ? ' active' : ''}" data-job="${i}" aria-pressed="${on}" title="${escapeHtml(jobLine(r))}">`
        + `<b>${escapeHtml(r.id)}</b><span class="rd-job-name">${escapeHtml(r.name)}</span><small>${escapeHtml(meta)}</small></button>`;
    }).join('');
    el.jobList.classList.toggle('hidden', !j.list.length);
    el.jobMsg.textContent = j.state === 'busy' ? 'R&D PMS 과제 목록에서 찾는 중…' : j.msg;
    el.jobMsg.classList.toggle('bad', !!j.bad);
    el.jobRetry.classList.toggle('hidden', j.state === 'busy' || !!j.list.length);
    el.jobSave.classList.toggle('hidden', !j.list.length);
  }

  function pickJob(i) {
    if (!st.job.list[i] || i === st.job.pick) return;
    st.job.pick = i;
    paintHead();
  }

  /** 고른 후보를 과제의 Job Id 로 — 묶음은 사라지고 표의 Job Id 줄만 남는다. 변경이력에는 남기지 않는다(과제 고치기와 같다 — projectChanges 는 책임자·연구기간만). */
  function saveJob() {
    const p = cur();
    const r = jobPicked();
    if (!p || p.job || st.job.for !== p.id || !r) return;
    p.job = r.id;
    setStatus(`Job Id 를 저장했습니다 — ${r.id}${r.name ? ` (${r.name})` : ''}`);
    logEvent('rnd', true, `R&D 과제 Job Id: ${label(p)} → ${r.id}`);
    paintHead();
    save();
  }

  /* ---------------------------------------------------------- 회계 I/O 저절로 찾기 · 회계 예산(e-accounting — 2026-10-17 사용자 지정) */
  // "R&D 에서 과제 등록 할때 jobid 갖어 오는데 … 계정과목코드 계정과목명, 예산부서코드 또는 I/O 입력 예산금액도 같이 조회 해야 하거든 … 부서 예산요약 가보면 해당연도 부서/과제 코드랑
  // 부서/과제명. 과제코드 계정명, 과제명 이런거 e-accounting.krs.co.kr 에 조회할 수 있도록" — Job Id 와 같은 길이다(src/eacct.js). 회계 I/O 가 빈 과제를 고르면 회계(부서 예산 요약 화면이 받는
  // 내 부서 과제 목록 — 읽기만)에서 과제명 유사도 0.5 이상의 후보를 높은 차례로 보이고 가장 높은 것을 고른 채로 둔다. '이 코드로 저장'을 누르면 과제에 남고 묶음은 사라지며, 바로 그 해의
  // 계정과목(보조세목)별 예산(기초·전용·실적·가용)을 받아 과제의 회계 스냅샷(acct)으로 두고 표로 보인다 — 구매요청서(공문 탭 구매의뢰)의 예산 내역이 이것으로 채워진다(src/gongmun.js orderAuto).
  // 손으로 고치는 곳은 과제 고치기의 회계 I/O 칸 — 비우고 저장하면 후보가 다시 보인다. 로그인(e-accounting 은 eclass 와 따로)이 풀리면 까닭과 로그인 링크.

  const ioPicked = () => st.io.list[st.io.pick] || null;
  const fiscal = () => fiscalYearOf(today());

  /** 과제 정보 표의 회계 I/O 줄 — 비어 있을 때의 글(고른 후보나 형편). */
  function ioRowText() {
    const j = st.io;
    if (j.state === 'busy') return '찾는 중 — 회계의 과제 목록을 읽습니다…';
    if (j.state === 'done' && j.list.length) return `${ioPicked().code} (후보 — 맞는지 보고 아래에서 저장)`;
    if (j.state === 'fail') return j.login ? '없음 — e-accounting 로그인이 필요합니다(아래 링크)' : '없음 — 회계 과제 목록을 받지 못했습니다(아래 다시 찾기)';
    if (j.state === 'done') return '없음 — 비슷한 회계 과제가 없습니다(과제 고치기에서 적으세요)';
    return '없음';
  }

  /** 회계 I/O 가 빈 과제를 보면 한 번 찾는다 — 같은 과제는 다시 찾지 않는다(fresh 는 다시 찾기 — 목록도 새로 받는다). 답이 오면 머리를 다시 그린다. */
  function autoIo(p, fresh = false) {
    if (!p || p.io || (!fresh && st.io.for === p.id)) return;
    const run = ++st.io.run;
    st.io = { for: p.id, run, state: 'busy', list: [], pick: 0, msg: '', bad: false, login: false };
    if (fresh) st.ioOpts = null;
    (async () => {
      let opts;
      try {
        opts = st.ioOpts || await acct.list(fiscal());
      } catch (err) {
        if (run !== st.io.run) return;
        st.io = { ...st.io, state: 'fail', msg: `회계 과제 목록을 받지 못했습니다 — ${err?.message || err}`, bad: true, login: !!err?.login };
        paintHead();
        return;
      }
      if (run !== st.io.run) return;
      st.ioOpts = opts;
      const { list } = rankIo(opts, { name: p.name });
      const top = list[0];
      const msg = top ? `가장 비슷한 회계 과제를 골라 두었습니다(유사도 ${top.score.toFixed(2)}) — 맞으면 이 코드로 저장, 아니면 다른 후보를 누르세요.`
        : opts?.length ? `과제명이 비슷한 회계 과제(유사도 0.5 이상)가 없습니다 — 내 부서 과제 ${opts.length}개를 봤습니다. 과제 고치기에서 회계 I/O 를 직접 적으세요.`
          : '회계 과제 목록이 비었습니다 — e-accounting 에 로그인되어 있는지 보세요.';
      st.io = { ...st.io, state: 'done', list, pick: 0, msg, bad: !top };
      paintHead();
    })();
  }

  /** 과제 정보 표 아래의 회계 I/O 묶음 — 회계 I/O 가 비어 있을 때만(Job Id 묶음과 같은 꼴). 로그인이 풀렸으면 로그인 링크. */
  function paintIo(p) {
    const j = st.io;
    const show = !!p && !p.io && j.for === p.id && j.state !== 'idle';
    el.ioBox.classList.toggle('hidden', !show);
    if (!show) return;
    el.ioList.innerHTML = j.list.map((r, i) => {
      const on = i === j.pick;
      return `<button type="button" class="rd-job-cand${on ? ' active' : ''}" data-io="${i}" aria-pressed="${on}" title="${escapeHtml(ioLine(r))}">`
        + `<b>${escapeHtml(r.code)}</b><span class="rd-job-name">${escapeHtml(r.name)}</span><small>${escapeHtml(`유사도 ${r.score.toFixed(2)}`)}</small></button>`;
    }).join('');
    el.ioList.classList.toggle('hidden', !j.list.length);
    el.ioMsg.textContent = j.state === 'busy' ? '회계(e-accounting)의 내 부서 과제 목록에서 찾는 중…' : j.msg;
    el.ioMsg.classList.toggle('bad', !!j.bad);
    el.ioLogin.classList.toggle('hidden', !j.login);
    el.ioRetry.classList.toggle('hidden', j.state === 'busy' || !!j.list.length);
    el.ioSave.classList.toggle('hidden', !j.list.length);
  }

  function pickIo(i) {
    if (!st.io.list[i] || i === st.io.pick) return;
    st.io.pick = i;
    paintHead();
  }

  /** 고른 후보를 과제의 회계 I/O 로 — 묶음은 사라지고 표의 회계 I/O 줄만 남으며, 바로 그 해의 계정과목별 예산을 받는다. 변경이력에는 남기지 않는다(Job Id 와 같다). */
  function saveIo() {
    const p = cur();
    const r = ioPicked();
    if (!p || p.io || st.io.for !== p.id || !r) return;
    p.io = r.code;
    delete p.acct;
    setStatus(`회계 I/O 를 저장했습니다 — ${r.code}${r.name ? ` (${r.name})` : ''}`);
    logEvent('rnd', true, `R&D 과제 회계 I/O: ${label(p)} → ${r.code}`);
    st.acctRun = { ...st.acctRun, for: '', msg: '', bad: false, login: false };
    paintHead();
    save();
  }

  /**
   * 회계 I/O 가 있는 과제의 그 해 계정과목별 예산을 받아 스냅샷(p.acct)으로 둔다 — 스냅샷이 이 해의 것이고 10분 안이면, 또는 이 세션에 이미 받아 봤으면(과제:I/O) 받지 않는다.
   * fresh 는 다시 조회(↻). 답이 오면 머리를 다시 그리고 저장한다. 다른 과제로 가면 그 답은 버린다.
   */
  function acctAuto(p, fresh = false) {
    if (!p?.io) return;
    const key = `${p.id}:${p.io}`;
    if (!fresh && (st.acctRun.for === key || acctFresh(p.acct, { today: today() }))) return;
    const run = ++st.acctRun.run;
    st.acctRun = { for: key, run, busy: true, msg: '', bad: false, login: false };
    paintAcct(p);
    (async () => {
      try {
        const got = await acct.get(fiscal(), p.io, st.ioOpts);
        if (run !== st.acctRun.run) return;
        if (got) p.acct = got;
        st.acctRun = { ...st.acctRun, busy: false, msg: got ? '' : '회계가 계정 줄을 주지 않았습니다.', bad: !got };
        save();
      } catch (err) {
        if (run !== st.acctRun.run) return;
        st.acctRun = { ...st.acctRun, busy: false, msg: `회계 예산을 받지 못했습니다 — ${err?.message || err}`, bad: true, login: !!err?.login };
      }
      paintHead();
    })();
  }

  const wonOf = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : '');
  /** 회계 계정명의 끝마디 — '수탁과제(국가)_연구재료비' → '연구재료비'(표가 좁다 — 전체 이름은 툴팁과 요약 복사에). */
  const acctShort = (name) => String(name || '').split('_').pop() || String(name || '');

  /**
   * 예산 칸의 회계 예산 — 회계 I/O 가 있을 때, rERP 집행내역과 같은 접힌 한 줄(2026-10-17 사용자 지정: "계정과목코드 및 계정명등 테이블은 예산 안에 rerp 집행내역 처럼 접어서 한줄로").
   * 접힌 줄의 형편(acctState)은 해 · I/O · 조회 시각. 펴면 머리 줄(I/O 와 회계 과제명 · 해 · 조회 시각, ↻ — 부서는 툴팁)과 계정 줄(계정과목코드 · 계정명 끝마디 · 예산(기초+전용) · 실적 · 가용 — 원), 형편 줄.
   * 차년도가 아니라 과제의 것(회계연도 기준)이라 어느 차년도를 보든 같다. 회계 I/O 찾기·저장은 과제 정보 카드(paintIo)에 그대로.
   */
  function paintAcct(p) {
    const show = !!p && !!p.io;
    el.acctBox.classList.toggle('hidden', !show);
    if (!show) return;
    const a = p.acct && p.acct.io === p.io ? p.acct : null;
    const run = st.acctRun;
    const when = a?.at ? new Date(a.at) : null;
    const stamp = when && !Number.isNaN(when.getTime()) ? `조회 ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` : run.busy ? '받는 중…' : '아직 못 받음';
    const year = a ? a.year : fiscal();
    const io = a ? a.io : p.io;
    const old = a && a.year !== fiscal() ? ' · 지난 해 스냅샷' : '';
    el.acctState.textContent = `${year}년 · I/O ${io} · ${stamp}${old}`;
    el.acctHead.innerHTML = `<b>${escapeHtml(io)}</b>${a?.ioName ? ` ${escapeHtml(a.ioName)}` : ''} · ${year}년 · ${stamp}${old}`;
    el.acctHead.title = a ? `${a.io}${a.ioName ? ` ${a.ioName}` : ''}${a.deptName ? ` · 부서 ${a.deptName}${a.dept ? `(${a.dept})` : ''}` : ''} · ${a.year}년 회계연도` : '';
    el.acctBox.classList.toggle('busy', !!run.busy);
    el.acctRefresh.disabled = !!run.busy;
    const rows = a?.rows || [];
    el.acctTable.innerHTML = rows.length
      ? '<thead><tr><th>계정과목코드</th><th>계정명</th><th class="num">예산</th><th class="num">실적</th><th class="num">가용</th></tr></thead><tbody>'
        + rows.map((r) => `<tr><td>${escapeHtml(r.code)}</td><td class="rd-acct-name" title="${escapeHtml(r.name)}">${escapeHtml(acctShort(r.name))}</td><td class="num" title="기초 ${wonOf(r.base)} · 전용 ${wonOf(r.transfer)}">${wonOf(r.budget)}</td><td class="num">${wonOf(r.actual)}</td><td class="num">${wonOf(r.available)}</td></tr>`).join('')
        + '</tbody>'
      : '';
    el.acctTable.classList.toggle('hidden', !rows.length);
    const msg = run.busy ? '회계(e-accounting)에서 계정과목별 예산을 받는 중…' : run.msg || (!a ? '아직 받지 못했습니다 — 다시 조회를 누르세요.' : !rows.length ? '이 해에 계정 줄이 없습니다.' : '');
    el.acctMsg.textContent = msg;
    el.acctMsg.classList.toggle('bad', !!run.bad);
    el.acctLogin.classList.toggle('hidden', !run.login);
  }

  /* ---------------------------------------------------------- rndgen 손잡이(과제 더하기·변경사항 카드 — 2026-10-16) */

  /** 보고 있는 것 — rndgen 이 따라 그린다(계약 View). yearEmpty 는 그 차년도에 예산 정보가 없는가(폼·덮개와 상관없이). */
  function view() {
    const p = cur();
    const n = p ? curYear(p) : 0;
    const snap = p ? p.years?.[n]?.snapshot : null;
    return {
      project: p || null, n, editing: st.editing != null, overlay: st.overlay?.name || null,
      yearEmpty: !!p && yearEmpty(p, n), snapshot: snap ? { rev: snap.rev || '', date: snap.date || '', file: snap.file || '' } : null,
    };
  }

  /** 그린 뒤 rndgen 에 알린다 — 그쪽의 탈이 이 탭 그리기를 막지 않게 삼킨다. */
  function notifyView() {
    if (!viewHook) return;
    try {
      viewHook(view());
    } catch (err) {
      console.error('R&D 더하기·변경사항 카드를 그리지 못했습니다', err);
    }
  }

  /** ＋ · 과제 더하기 · 빈 차년도 카드의 단추 — rndgen 이 있으면 더하기 카드(target: {} 또는 { projectId, n }), 없으면 새 과제 폼. */
  function openAdd(target = {}) {
    if (addHook) addHook(target);
    else openForm('new');
  }

  /** 덮개 켜기(name 'add') · 끄기(null). 켜면 열린 폼은 닫는다 — 폼과 덮개는 하나만. 칩으로 닫을 때는 onClose 를 부른다(pickProject). */
  function setOverlay(name, onClose) {
    if (name) {
      if (st.editing != null) {
        st.editing = null;
        el.form.classList.add('hidden');
      }
      st.overlay = { name: String(name), close: typeof onClose === 'function' ? onClose : null };
    } else {
      st.overlay = null;
    }
    paintAll();
  }

  /** 더하기 카드의 "직접 적기" — 덮개를 (닫는 쪽을 부르지 않고) 걷고 새 과제 폼을 연다. */
  function addManually() {
    st.overlay = null;
    openForm('new');
  }

  /** 그 과제(폼·덮개가 있으면 닫고) · 그 차년도로 — 넣기·반영 뒤에 rndgen 이 부른다. */
  function pick(projectId, n) {
    pickProject(projectId);
    if (Number(n) > 0 && cur()?.id === projectId) pickYear(Number(n));
  }

  /** 별칭이 없던 과제에 별칭을 붙인다(뽑은 스냅샷을 넣은 뒤) — 비었거나 다른 과제와 겹치면 붙이지 않고 까닭을 돌려준다. */
  function setAliasOf(projectId, alias) {
    const p = projectOf(st.book, projectId);
    if (!p) return { ok: false, error: '과제를 찾지 못했습니다' };
    const a = String(alias ?? '').trim().slice(0, 60);
    if (!a) return { ok: false, error: '별칭을 적으세요 — 예) SSCB' };
    const dup = aliasOwner(st.book, a, p.id);
    if (dup) return { ok: false, error: `같은 별칭의 과제가 있습니다 — ${dup.name}` };
    p.alias = a;
    logEvent('rnd', true, `R&D 과제 별칭: ${p.name} → ${a}`);
    paintAll();
    save();
    return { ok: true, error: '' };
  }

  function saveForm() {
    const draft = normalizeProject({
      id: st.editing === 'new' ? '' : st.editing, name: el.fName.value, alias: el.fAlias.value, code: el.fCode.value, job: el.fJob.value, io: el.fIo.value, lead: el.fLead.value,
      start: el.fStart.value, end: el.fEnd.value, calendar: el.fCalendar.checked, note: el.fNote.value,
    });
    if (!draft.name) {
      el.fNeed.textContent = '과제명을 적으세요.';
      el.fName.focus();
      return;
    }
    const dup = aliasOwner(st.book, draft.alias, st.editing === 'new' ? '' : st.editing);
    if (!draft.alias || dup) {
      el.fNeed.textContent = dup ? `같은 별칭의 과제가 있습니다 — ${dup.name}` : '별칭을 적으세요 — 칩과 머리에 과제명 대신 이 이름으로 보입니다.';
      el.fAlias.focus();
      return;
    }
    if (el.fStart.value && el.fEnd.value && el.fEnd.value < el.fStart.value) {
      el.fNeed.textContent = '종료일이 시작일보다 앞섭니다.';
      el.fEnd.focus();
      return;
    }
    if (st.editing === 'new') {
      if (st.book.projects.length >= MAX_PROJECTS) {
        el.fNeed.textContent = `과제는 ${MAX_PROJECTS}개까지입니다.`;
        return;
      }
      st.book.projects.push(draft);
      st.book.current.project = draft.id;
      logEvent('rnd', true, `R&D 과제 더함: ${draft.name}`);
      setStatus(`과제를 더했습니다 — ${label(draft)}`);
    } else {
      const p = projectOf(st.book, st.editing);
      if (!p) return closeForm();
      const changes = projectChanges(p, draft, today());
      // 회계 I/O 를 고치면 전 과제의 회계 예산 스냅샷은 버린다 — 새 코드로 다시 받는다(acctAuto).
      if (draft.io !== p.io) {
        delete p.acct;
        st.acctRun = { ...st.acctRun, for: '', msg: '', bad: false, login: false };
      }
      Object.assign(p, { name: draft.name, alias: draft.alias, code: draft.code, job: draft.job, io: draft.io, lead: draft.lead, start: draft.start, end: draft.end, calendar: draft.calendar, note: draft.note });
      if (changes.length) {
        // 연구기간이 바뀌어 차년도가 달라졌을 수 있다 — 고친 뒤의 보고 있는 차년도에 남긴다.
        yearBook(p, viewYear(st.book, p, today())).changes.push(...changes);
        setStatus(`과제 정보를 고치고 변경이력에 ${changes.length}건을 남겼습니다 — 사유를 적어 두세요.`);
      } else {
        setStatus('과제 정보를 고쳤습니다.');
      }
    }
    closeForm();
    save();
  }

  function delProject() {
    const p = projectOf(st.book, st.editing);
    if (!p) return;
    if (!confirmTwice(el.fDel, '정말 지우기')) return;
    st.book.projects = st.book.projects.filter((x) => x.id !== p.id);
    delete st.book.current.year[p.id];
    st.book.current.project = st.book.projects[0]?.id || '';
    logEvent('rnd', true, `R&D 과제 지움: ${p.name}`);
    setStatus(`과제를 지웠습니다 — ${label(p)}`);
    closeForm();
    save();
    // 그 과제의 저장된 YAML 원문(rndYamlText)도 지운다(rndgen).
    try { deleteHook?.(p.id); } catch (err) { console.error('R&D YAML 원문을 지우지 못했습니다', err); }
  }

  /* ---------------------------------------------------------- 예산 */

  const left = (r) => (r.plan != null || r.used != null ? (r.plan || 0) - (r.used || 0) : null);

  /**
   * 줄 아래 막대 — 계획 대비 몫을 색으로 이어 붙인다(2026-10-11 사용자 지정 — 미청구·사용계획은 각기 다른 색): base 파랑(승인액 · 손으로 적은 집행) → plan 주황(사용계획 = 예상 비용) → unbilled 보라(미청구 — 연구활동비 줄과 합계 줄).
   * 계획을 넘는 몫부터는 빨강(over)이고 100% 에서 잘린다. 첫 몫(base)은 0 이어도 그린다 — 줄마다 .rd-bar 하나는 늘 있다(검사와 refreshRow 가 기댄다). 계획이 없으면 모두 0%.
   * @param {number|null} plan 계획(원) @param {{ k:string, v:number }[]} parts 차례대로 이어 붙일 몫(원)
   */
  function barsHtml(plan, parts) {
    const pctOf = (v) => (plan > 0 ? Math.min(100, (v / plan) * 100) : 0);
    const fix = (n) => String(Math.round(n * 100) / 100);
    let at = 0;
    return parts.map(({ k, v }, i) => {
      if (!(v > 0) && i) return '';
      const from = pctOf(at);
      at += v > 0 ? v : 0;
      const to = pctOf(at);
      return `<i class="rd-bar ${k}${plan > 0 && at > plan ? ' over' : ''}" style="left:${fix(from)}%;width:${fix(to - from)}%"></i>`;
    }).join('');
  }
  /** 한 줄의 막대 몫 — rERP 와 맞춰진 줄(집행 = 승인액 + 사용계획 + 미청구)은 사용계획(erpPlan)·미청구(erpUnbilled — 연구활동비 줄, src/rnderp.js applySnapshot)를 따로, 아니면 집행 하나. 차례는 base · plan · unbilled 로 고정(paintSum 이 [1]·[2] 로 읽는다). */
  const rowParts = (r) => {
    const on = !!r.erpKey && st.set.erp;
    const plan = on ? r.erpPlan || 0 : 0;
    const ub = on ? r.erpUnbilled || 0 : 0;
    return [{ k: 'base', v: (r.used || 0) - plan - ub }, { k: 'plan', v: plan }, { k: 'unbilled', v: ub }];
  };
  const rowBars = (r) => barsHtml(r.plan, rowParts(r));

  /** 예산 줄 — 금액은 천원(2026-10-11 사용자 지정). rERP 와 맞춰진 비목(erpKey)의 집행은 rERP 승인액이라 읽기 전용. x 는 미청구 몫(extrasOf — 툴팁의 건수). */
  function rowHtml(r, x = null) {
    const l = left(r);
    const name = escapeHtml(r.item || '비목');
    const locked = !!r.erpKey && st.set.erp;
    const ub = locked ? r.erpUnbilled || 0 : 0;
    const erpUsed = locked ? ` readonly title="rERP 승인액 ${comma((r.used || 0) - (r.erpPlan || 0) - ub)}원${r.erpPlan ? ` + 사용계획 ${comma(r.erpPlan)}원` : ''}${ub ? ` + 미청구 ${comma(ub)}원(과제카드 ${x?.count || 0}건 — 청구 전이라 이 줄에 더합니다)` : ''} — 집행내역에서 받은 값이라 손으로 못 고칩니다 (rERP 집행내역의 끊기를 누르거나 R&D 설정에서 끄면 다시 적을 수 있습니다)"` : '';
    return `<div class="rd-brow${locked ? ' erp' : ''}" role="row" data-row="${r.id}">`
      + `<input type="text" data-k="item" value="${escapeHtml(r.item)}" placeholder="비목" aria-label="비목" autocomplete="off" />`
      + `<input type="text" data-k="plan" value="${r.plan == null ? '' : thousand(r.plan)}" placeholder="0" inputmode="numeric" aria-label="${name} 계획(천원)" autocomplete="off" />`
      + `<input type="text" data-k="used" value="${r.used == null ? '' : thousand(r.used)}" placeholder="0" inputmode="numeric" aria-label="${name} 집행(천원)" autocomplete="off"${erpUsed} />`
      + `<span class="rd-left${l < 0 ? ' over' : ''}" data-left title="잔액(천원)">${l == null ? '' : thousand(l)}</span>`
      + `<button type="button" class="rd-brow-del" data-del="${r.id}" title="이 비목 빼기" aria-label="${name} 빼기">×</button>`
      + `<span class="rd-bars" aria-hidden="true">${rowBars(r)}</span>`
      + '</div>';
  }

  /** 미청구(과제카드)는 연구활동비 줄에 든다(src/rnderp.js UNBILLED_ITEM). rERP 와 맞춰진 연구활동비 줄이 없을 때만 합계 바로 위 보조 줄로 — 예산 칸 위 "집행에 더하기"에서 켰을 때. 합계 줄 막대의 보라 몫이 이것이다(범례는 보라 체크 상자). */
  function extraRowHtml(x) {
    return `<div class="rd-brow rd-brow-extra" role="row" title="이 과제 카드로 썼지만 아직 청구하지 않은 금액 — rERP 와 맞춰진 연구활동비 줄이 없어 합계에서만 뺍니다 (예산 칸 위 '집행에 더하기'의 미청구 — 합계 줄 막대의 보라 몫)">`
      + `<span class="rd-extra-name">미청구 · 과제카드 ${x.count}건</span><span></span><span class="rd-extra-used">${thousand(x.unbilled)}</span><span class="rd-left over">${thousand(-x.unbilled)}</span><span></span></div>`;
  }

  /** R&D 설정에서 숨긴 비목(rndSettings.hide)이 이 차년도에 있으면 합계 위에 한 줄로 — 줄만 숨고 합계에는 든다. */
  const hiddenNoteHtml = (hid) => (hid.length
    ? `<div class="rd-hidden-note" title="R&D 설정의 '예산 칸에 보일 비목'에서 끈 비목 — 줄만 숨고 합계·표 복사에는 듭니다">숨긴 비목 ${hid.length} · ${hid.map((r) => escapeHtml(r.item)).join('·')} — 합계에는 듭니다 (R&D 설정)</div>`
    : '');

  /** 장부에 더하는 과제 단위 몫(미청구) — 설정이 켜져 있고 스냅샷이 있을 때만. */
  const extrasOf = (b) => (st.set.erp ? erpExtras(b.erp?.snap, st.set) : { unbilled: 0, count: 0 });

  /**
   * 미청구 몫의 자리(2026-10-12 사용자 지정 — "미청구를 체크하면 연구활동비 줄에 반영"): rERP 와 맞춰진 연구활동비 줄(src/rnderp.js UNBILLED_ITEM)에 들었으면 inRow(그 줄의 used 에 이미 든 몫),
   * 그 줄이 없으면 loose(합계 위 보조 줄 — 합계에만 더한다). 둘 중 하나만 0 이 아니다. count 는 과제카드 건수.
   */
  const unbilledPlace = (b) => {
    const x = extrasOf(b);
    const inRow = b.budget.reduce((a, r) => a + rowParts(r)[2].v, 0);
    return { count: x.count, inRow, loose: inRow > 0 ? 0 : x.unbilled };
  };

  /**
   * rERP 스냅샷을 장부 줄에 — 집행 = 승인액 + (설정) 사용계획(그 비목 키의 예상 비용, rerp/plan.js) + (설정) 미청구(연구활동비 줄에). 승인전(청구했지만 결재 전)은 더하지 않는다(2026-10-11 사용자 지정 — rERP 집행비율에는 rerp 식대로 든다). 바뀐 줄 수를 돌려준다.
   * 설정에서 rERP 를 껐거나 스냅샷이 없으면 아무것도 안 한다(줄은 그대로).
   */
  function applyErp(b) {
    const e = b.erp;
    if (!st.set.erp || !e?.snap?.budget) return 0;
    const planned = st.set.plan ? (key) => PLAN.sumOf(PLAN.listOf(st.pl.plans, e.prjNo, key)) : null;
    return applySnapshot(b.budget, e.snap, { planned, unbilled: extrasOf(b).unbilled });
  }

  /** 설정(R&D 설정의 "예산 칸에 보일 비목")에서 숨긴 줄은 그리지 않는다 — 합계·표 복사·요약에는 그대로 든다(2026-10-11 사용자 지정). */
  function paintBudget() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    applyErp(b);
    const x = extrasOf(b);
    const u = unbilledPlace(b);
    const hid = b.budget.filter((r) => isHidden(st.set, r.item));
    el.budget.innerHTML = b.budget.filter((r) => !hid.includes(r)).map((r) => rowHtml(r, x)).join('') + hiddenNoteHtml(hid) + (u.loose ? extraRowHtml({ unbilled: u.loose, count: u.count }) : '');
    paintSum(b);
    st.snap = b.budget.map((r) => ({ ...r }));
  }

  /** 합계 줄 — 금액과, 그 아래 막대(승인액 파랑 → 사용계획 주황 → 미청구 보라 — 전체 계획 대비). 막대는 마지막 빈 칸 안에 두어 칸 수(다섯)는 그대로다. */
  function paintSum(b) {
    const sum = budgetTotals(b.budget);
    const u = unbilledPlace(b);
    if (u.loose) {   // 연구활동비 줄에 못 넣은 미청구만 여기서 더한다(줄에 든 몫은 budgetTotals 에 이미 들어 있다)
      sum.used += u.loose;
      sum.left -= u.loose;
      sum.rate = sum.plan > 0 ? Math.round((sum.used / sum.plan) * 100) : null;
    }
    const any = b.budget.some((r) => r.plan != null || r.used != null) || u.loose > 0;
    const planned = b.budget.reduce((a, r) => a + rowParts(r)[1].v, 0);
    const unbilled = u.inRow + u.loose;
    const bars = barsHtml(sum.plan, [{ k: 'base', v: sum.used - planned - unbilled }, { k: 'plan', v: planned }, { k: 'unbilled', v: unbilled }]);
    el.budgetSum.innerHTML = any
      ? `<span>합계</span><span>${thousand(sum.plan)}</span><span>${thousand(sum.used)}</span><span class="rd-left${sum.left < 0 ? ' over' : ''}">${thousand(sum.left)}</span><span><span class="rd-bars" aria-hidden="true">${bars}</span></span>`
      : '';
    // 칸 머리 — 장부의 계획·집행과, rERP 로 이어졌으면(설정에서 켜 둔 동안) 그 집행비율(미청구·승인전 반영)이나 못 받은 까닭.
    const head = st.set.erp ? erpHead(b.erp) : '';
    el.budgetState.textContent = `${any ? `계획 ${shortWon(sum.plan)} · 집행 ${shortWon(sum.used)}${sum.rate == null ? '' : ` (${sum.rate}%)`}` : '적은 것 없음'}${head ? ` · ${head}` : ''}`;
  }

  /** 한 줄의 금액을 다시 적는다 — 줄을 통째로 다시 그리면 Tab 으로 옮겨 가던 초점이 사라진다. */
  function refreshRow(rowEl, r) {
    for (const k of ['plan', 'used']) {
      const input = rowEl.querySelector(`[data-k="${k}"]`);
      if (input && document.activeElement !== input) input.value = r[k] == null ? '' : thousand(r[k]);
    }
    const l = left(r);
    const span = rowEl.querySelector('[data-left]');
    span.textContent = l == null ? '' : thousand(l);
    span.classList.toggle('over', l < 0);
    rowEl.querySelector('.rd-bars').innerHTML = rowBars(r);
  }

  function rowOf(e) {
    const node = e.target;
    const rowEl = node instanceof HTMLElement ? node.closest('[data-row]') : null;
    const p = cur();
    const r = rowEl && p ? curBook(p).budget.find((x) => x.id === rowEl.dataset.row) : null;
    return r ? { node, rowEl, p, r } : null;
  }

  function onBudgetInput(e) {
    const hit = rowOf(e);
    if (!hit || hit.node.dataset.k !== 'item') return;
    hit.r.item = hit.node.value.trim().slice(0, 60);
    save();
  }

  /** 금액은 다 적고(change) 읽는다 — 적는 중의 "1,5" 를 읽으면 틀린다. 칸은 천원이라 숫자만 적으면 천원, 만·억·원을 붙이면 그 단위(amountOfThousand). */
  function onBudgetChange(e) {
    const hit = rowOf(e);
    if (!hit || !['plan', 'used'].includes(hit.node.dataset.k)) return;
    const { node, rowEl, p, r } = hit;
    const k = node.dataset.k;
    if (k === 'used' && r.erpKey && st.set.erp) {
      node.value = r.used == null ? '' : thousand(r.used);
      setStatus('이 비목의 집행은 rERP 승인액입니다 — 손으로 적으려면 rERP 집행내역의 끊기를 누르거나 R&D 설정에서 rERP 집행내역을 끄세요.', 'error');
      return;
    }
    const v = amountOfThousand(node.value);
    if (node.value.trim() && v == null) {
      setStatus(`금액을 읽지 못했습니다 — "${node.value}". 천원 단위 숫자로(31,425 = 31,425,000원), 또는 150만 · 1.5억 · 500,000원 처럼 단위를 붙여 적으세요.`, 'error');
      node.value = r[k] == null ? '' : thousand(r[k]);
      return;
    }
    if (r[k] === v) return;
    r[k] = v;
    node.value = v == null ? '' : thousand(v);
    commitBudget(p, rowEl, r);
  }

  /** 예산 줄을 적은 뒤 — 계획이 바뀐 줄을 변경이력에 남긴다. rowEl 을 주면 그 줄만 다시 적고, 없으면 표를 다시 그린다. */
  function commitBudget(p, rowEl = null, r = null) {
    const b = curBook(p);
    const changes = budgetChanges(st.snap, b.budget, today());
    if (changes.length) {
      b.changes.push(...changes);
      setStatus(`예산 계획이 바뀌어 변경이력에 ${changes.length}건을 남겼습니다 — 사유를 적어 두세요.`);
      paintChanges();
    }
    if (rowEl && r) {
      refreshRow(rowEl, r);
      paintSum(b);
      st.snap = b.budget.map((x) => ({ ...x }));
    } else {
      paintBudget();
    }
    save();
  }

  // 비목 더하기 단추는 2026-10-11 사용자 지정으로 뺐다 — 비목은 연구개발계획서 YAML(src/rnd.js BUDGET_ITEMS 여섯 비목)에서 오고, 줄의 × 로만 뺀다.
  function onBudgetClick(e) {
    const btn = e.target instanceof HTMLElement ? e.target.closest('[data-del]') : null;
    const p = cur();
    if (!btn || !p) return;
    const b = curBook(p);
    const r = b.budget.find((x) => x.id === btn.dataset.del);
    if (!r) return;
    // 금액이 적힌 줄은 두 번 눌러야 뺀다. 빈 줄은 바로.
    if ((r.plan || r.used) && !confirmTwice(btn, '정말')) return;
    b.budget = b.budget.filter((x) => x !== r);
    commitBudget(p);
  }

  /* ---------------------------------------------------------- 참여연구자 · 연구개발 계획(계획서에서 온 것) */

  /** 계획서(YAML)에서 온 두 줄을 저마다의 칸에 — 참여연구자는 표, 계획은 절 제목과 목록. 없으면 넣는 곳을 짚어 준다. */
  function paintFiles() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    const src = `연구개발계획서${b.snapshot?.rev ? ` ${b.snapshot.rev}` : ''} 기준`;
    const none = (what) => `<p class="rd-hint">아직 없습니다 — 맨 아래 칸에 연구개발계획서 YAML(KR_&lt;과제&gt;.yaml)을 넣으면 이 차년도의 ${what} 섭니다.</p>`;

    const roster = fileLog(b, 'roster');
    const people = roster ? parseRoster(roster.text) : null;
    el.roster.innerHTML = roster ? (people ? rosterHtml(people) : `<p class="rd-text">${escapeHtml(roster.text)}</p>`) : none('참여연구자가');
    st.rosterText = !roster ? '계획서 없음' : people ? `연구자 ${people.length}명` : '있음';
    el.rosterSrc.textContent = roster ? src : '';
    el.rosterTools.classList.toggle('hidden', !roster);
    paintSupport();

    const plan = fileLog(b, 'plan');
    const secs = plan ? parseSections(plan.text) : null;
    const goals = secs?.find((s) => s.title === '개발목표')?.items.length || 0;
    const months = secs?.find((s) => s.title === '수행일정')?.note || '';
    el.plan.innerHTML = plan ? (secs ? sectionsHtml(secs) : `<p class="rd-text">${escapeHtml(plan.text)}</p>`) : none('연구개발 계획이');
    el.planState.textContent = !plan ? '계획서 없음' : [goals ? `목표 ${goals}개` : '', months].filter(Boolean).join(' · ') || '있음';
    el.planSrc.textContent = plan ? src : '';
    el.planTools.classList.toggle('hidden', !plan);
  }

  /* ---------------------------------------------------------- 행정지원(과제마다 — 공문 참조자) */

  /**
   * 행정지원 — 과제마다 손으로 적는 사람(이름·맡은 일·공문 참조). 참조로 고른 사람은 이 과제의 공문(구매·교육·출장)마다 결재선의 참조자다
   * (src/gongmun.js 의 projectRefs — 2026-10-16 사용자 지정: "참여연구자 및 행정 지원.. 으로 해서 행정지원 사람 넣을 수 있도록", 담당 직원은 행정 담당으로
   * 참조, 참조는 "과제 마다 다름. 구매교육출장 이런거랑 달리"). 이름을 적기 전의 빈 줄도 그린다(저장소에서 다시 읽으면 빠진다).
   */
  /** 화면이 고치는 행정지원 줄 — 저장된 그대로의 차례(같은 이름·빈 줄도 남긴다 — 줄의 data-i 가 이 차례다). 머리 줄·공문은 normalizeSupport 를 지난 것을 본다. */
  const supportRows = (p) => (Array.isArray(p?.support) ? p.support : []).slice(0, SUPPORT_MAX)
    .map((x) => ({ name: String(x?.name ?? ''), role: String(x?.role ?? ''), ref: x?.ref !== false }));

  function paintSupport() {
    const p = cur();
    if (!p) return;
    const rows = supportRows(p);
    // 참여연구자 표(rosterHtml)와 같은 꼴의 표 — 성명·맡은 일은 표 안의 칸에 바로 적고, 공문 참조는 체크, 빼기는 예산 줄과 같은 ×(2026-10-16 사용자 지정 "참여연구원들이랑 … 비슷하게 표기").
    el.support.innerHTML = !rows.length ? '' : '<table class="rd-table rd-support-table"><thead><tr><th>성명</th><th>맡은 일</th><th>공문 참조</th><th></th></tr></thead><tbody>'
      + rows.map((s, i) => `<tr class="rd-support-row" data-i="${i}">`
        + `<td class="rd-td-name"><input type="text" data-k="name" value="${escapeHtml(s.name)}" placeholder="이름" aria-label="행정지원 ${i + 1} 이름" maxlength="40" autocomplete="off" spellcheck="false" /></td>`
        + `<td class="rd-td-role"><input type="text" data-k="role" value="${escapeHtml(s.role)}" placeholder="예) 행정 담당" aria-label="행정지원 ${i + 1} 맡은 일" maxlength="40" autocomplete="off" /></td>`
        + `<td class="rd-td-ref"><label class="rd-support-ref" title="이 과제의 공문(구매·교육·출장)마다 결재선의 참조자로 넣습니다"><input type="checkbox" data-k="ref"${s.ref ? ' checked' : ''} aria-label="행정지원 ${i + 1} 공문 참조" /></label></td>`
        + `<td class="rd-td-del"><button type="button" class="rd-brow-del" data-drop="${i}" title="이 사람 빼기" aria-label="행정지원 ${i + 1} 빼기">×</button></td></tr>`).join('')
      + '</tbody></table>';
    el.supportAdd.disabled = rows.length >= SUPPORT_MAX;
    el.supportAdd.title = el.supportAdd.disabled ? `행정지원은 과제마다 ${SUPPORT_MAX}명까지입니다` : '사람 더하기 — 행정 담당 등. 공문 참조를 켜면 이 과제의 공문마다 참조자로 들어갑니다';
    paintSupportState();
  }

  /** 참여인력 칸 머리 줄("연구자 3명 · 행정 1명" — 인건비·참조자 이름은 없다, 2026-10-17 사용자 지정) — 줄을 다시 그리지 않고(적는 중인 칸을 지키게) 글만 바꾼다. 행정지원 머리의 설명문은 없다(2026-10-16 사용자 지정 — 공문 참조의 뜻은 단추·칸의 title 로). */
  function paintSupportState() {
    const p = cur();
    if (!p) return;
    const named = normalizeSupport(p.support);
    el.rosterState.textContent = [st.rosterText, named.length ? `행정 ${named.length}명` : ''].filter(Boolean).join(' · ');
  }

  /** 행정지원 줄을 고쳤을 때 — 이름·맡은 일은 적는 대로, 공문 참조는 누르는 대로 과제에 남긴다(빈 줄은 그대로 두고 저장소에서 다시 읽을 때 빠진다). */
  function onSupportInput(e) {
    const p = cur();
    const node = e.target instanceof Element ? e.target.closest('[data-k]') : null;
    const li = node?.closest('[data-i]');
    if (!p || !node || !li) return;
    const rows = supportRows(p);
    const row = rows[+li.dataset.i];
    if (!row) return;
    if (node.dataset.k === 'ref') row.ref = node.checked;
    else row[node.dataset.k] = node.value;
    p.support = rows;
    save();
    paintSupportState();
  }

  function onSupportClick(e) {
    const p = cur();
    const btn = e.target instanceof Element ? e.target.closest('[data-drop]') : null;
    if (!p || !btn) return;
    const rows = supportRows(p);
    rows.splice(+btn.dataset.drop, 1);
    p.support = rows;
    save();
    paintSupport();
  }

  function addSupport() {
    const p = cur();
    if (!p) return;
    const rows = supportRows(p);
    if (rows.length >= SUPPORT_MAX) return;
    p.support = [...rows, { name: '', role: '', ref: true }];
    save();
    paintSupport();
    el.support.querySelector('tbody tr:last-child [data-k="name"]')?.focus();
  }

  /* ---------------------------------------------------------- 진행 기록(손으로 적는 연구내역) */

  function paintLogs() {
    const p = cur();
    if (!p) return;
    const notes = noteLogs(curBook(p));
    el.logs.innerHTML = newestFirst(notes).map((l) => `<li data-log="${l.id}" class="${l.id === st.logEdit ? 'editing' : ''}">`
      + `<div class="rd-row-head"><span class="rd-date">${escapeHtml(dot(l.date) || '날짜 없음')}</span><strong class="rd-title">${escapeHtml(l.title)}</strong>`
      + `<span class="rd-row-btns">${copyBtn(`data-copy="${l.id}"`, '이 줄')}<button type="button" class="ghost small" data-edit="${l.id}">고치기</button><button type="button" class="ghost small rd-del" data-del="${l.id}">지우기</button></span></div>`
      + logBody(l)
      + '</li>').join('');
    el.logState.textContent = notes.length ? `${notes.length}건` : '적은 것 없음';
  }

  /**
   * 기록의 내용을 보기 좋게 — 참여연구자 줄들은 표로, ■ 절·번호·줄표·점은 절 제목과 목록으로, 그 밖의 글은 그대로.
   * 글은 안 바꾼다(고치기·요약 복사는 글 그대로) — 보일 때만 꼴을 입힌다.
   */
  function logBody(l) {
    if (!l.text) return '';
    const people = parseRoster(l.text);
    if (people) return rosterHtml(people);
    const secs = parseSections(l.text);
    if (secs) return sectionsHtml(secs);
    return `<p class="rd-text">${escapeHtml(l.text)}</p>`;
  }

  function rosterHtml(people) {
    const cols = [['name', '성명'], ['role', '직위'], ['rate', '계상률'], ['months', '참여'], ['pay', '계상인건비']].filter(([k]) => people.some((x) => x[k]));
    return `<table class="rd-table"><thead><tr>${cols.map(([, h]) => `<th>${h}</th>`).join('')}</tr></thead><tbody>`
      + people.map((x) => `<tr>${cols.map(([k]) => `<td class="rd-td-${k}">${escapeHtml(x[k])}</td>`).join('')}</tr>`).join('')
      + '</tbody></table>';
  }

  function sectionsHtml(secs) {
    // "항목: 값" 꼴은 항목을 굵게 — 성능목표의 "규정 공백 분석: 1 건 (자체평가)".
    const line = (s) => {
      const m = s.match(/^([^:：]{2,40})[:：] (.+)$/);
      return m ? `<b>${escapeHtml(m[1])}</b> ${escapeHtml(m[2])}` : escapeHtml(s);
    };
    const item = (it) => `<li>${line(it.text)}${it.subs.length ? `<ul>${it.subs.map((x) => `<li>${line(x)}</li>`).join('')}</ul>` : ''}</li>`;
    return `<div class="rd-secs">${secs.map((s) => {
      const tag = s.items.length && s.items.every((it) => it.n > 0) ? 'ol' : 'ul';
      const head = s.title ? `<h4>${escapeHtml(s.title)}${s.note ? `<small>${escapeHtml(s.note)}</small>` : ''}</h4>` : '';
      return `<section class="rd-sec">${head}<${tag}>${s.items.map(item).join('')}</${tag}></section>`;
    }).join('')}</div>`;
  }

  function clearLogForm() {
    st.logEdit = null;
    el.logDate.value = today();
    el.logTitle.value = '';
    el.logText.value = '';
    el.logAdd.textContent = '기록';
    el.logCancel.classList.add('hidden');
  }

  function addLog() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    const title = el.logTitle.value.trim().slice(0, 200);
    const text = el.logText.value.trim().slice(0, 4000);
    if (!title && !text) {
      setStatus('진행 기록의 제목이나 내용을 적으세요.', 'error');
      el.logTitle.focus();
      return;
    }
    const date = isYmd(el.logDate.value) ? el.logDate.value : today();
    const hit = st.logEdit ? b.logs.find((x) => x.id === st.logEdit) : null;
    if (hit) {
      Object.assign(hit, { date, title, text });
      setStatus('진행 기록을 고쳤습니다.');
    } else {
      b.logs.push({ id: newId(), date, title, text });
      setStatus('진행 기록을 적었습니다.');
    }
    clearLogForm();
    paintLogs();
    save();
  }

  function onLogsClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('button[data-copy],button[data-edit],button[data-del]') : null;
    const p = cur();
    if (!btn || !p) return;
    const b = curBook(p);
    if (btn.dataset.copy) {
      const l = b.logs.find((x) => x.id === btn.dataset.copy);
      if (l) copyWith(btn, entryText(l), `진행 기록 한 줄: ${l.title}`);
      return;
    }
    if (btn.dataset.edit) {
      const l = b.logs.find((x) => x.id === btn.dataset.edit);
      if (!l) return;
      st.logEdit = l.id;
      el.logDate.value = l.date || today();
      el.logTitle.value = l.title;
      el.logText.value = l.text;
      el.logAdd.textContent = '저장';
      el.logCancel.classList.remove('hidden');
      paintLogs();
      el.logTitle.focus();
      return;
    }
    if (!confirmTwice(btn, '정말 지우기')) return;
    b.logs = b.logs.filter((x) => x.id !== btn.dataset.del);
    if (st.logEdit === btn.dataset.del) clearLogForm();
    paintLogs();
    save();
    setStatus('진행 기록을 지웠습니다.');
  }

  /* ---------------------------------------------------------- 변경이력(변경 및 이력 관리 카드의 아래 몫) */

  function paintChanges() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    el.changes.innerHTML = newestFirst(b.changes).map((c) => {
      const diff = c.before || c.after ? `<p class="rd-diff"><s>${escapeHtml(c.before || '(없음)')}</s><span class="rd-arrow" aria-hidden="true">→</span><b>${escapeHtml(c.after || '(없음)')}</b></p>` : '';
      // 사유가 비었으면 그 자리에서 적는 칸 — 저절로 남은 줄은 왜 바꿨는지를 사람이 적어야 이력이 된다.
      const reason = c.reason
        ? `<p class="rd-reason">${escapeHtml(c.reason)}</p>`
        : `<input type="text" class="rd-reason-in" data-reason="${c.id}" placeholder="${c.auto ? '사유 — 저절로 남은 줄입니다. 왜 바꿨는지 적어 두세요' : '사유'}" aria-label="사유" autocomplete="off" />`;
      return `<li data-ch="${c.id}" class="${c.auto ? 'auto' : ''}${c.id === st.chEdit ? ' editing' : ''}">`
        + `<div class="rd-row-head"><span class="rd-date">${escapeHtml(dot(c.date) || '날짜 없음')}</span><span class="rd-kind">${escapeHtml(c.kind)}</span><strong class="rd-title">${escapeHtml(c.item)}</strong>`
        + `<span class="rd-row-btns">${copyBtn(`data-copy="${c.id}"`, '이 줄')}<button type="button" class="ghost small" data-edit="${c.id}">고치기</button><button type="button" class="ghost small rd-del" data-del="${c.id}">지우기</button></span></div>`
        + diff + reason + '</li>';
    }).join('');
    const open = b.changes.filter((c) => c.auto && !c.reason).length;
    el.changeState.textContent = b.changes.length ? `${b.changes.length}건${open ? ` · 사유 없음 ${open}` : ''}` : '적은 것 없음';
  }

  function clearChangeForm() {
    st.chEdit = null;
    el.chDate.value = today();
    el.chKind.value = CHANGE_KINDS[0];
    for (const node of [el.chItem, el.chBefore, el.chAfter, el.chReason]) node.value = '';
    el.chAdd.textContent = '기록';
    showChangeForm(false);
  }

  /** 손으로 적는 칸 — "직접 적기"·줄의 "고치기" 로 열고 기록·취소하면 닫는다(2026-10-16 — 변경 및 이력 관리 카드에 YAML 고치기 칸과 함께 서서). */
  function showChangeForm(on) {
    el.chForm.classList.toggle('hidden', !on);
    el.chNew.classList.toggle('hidden', on);
  }

  function addChange() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    const item = el.chItem.value.trim().slice(0, 100);
    const before = el.chBefore.value.trim().slice(0, 300);
    const after = el.chAfter.value.trim().slice(0, 300);
    const reason = el.chReason.value.trim().slice(0, 1000);
    if (!item && !before && !after && !reason) {
      setStatus('변경이력의 항목이나 변경 전·후를 적으세요.', 'error');
      el.chItem.focus();
      return;
    }
    const date = isYmd(el.chDate.value) ? el.chDate.value : today();
    const kind = CHANGE_KINDS.includes(el.chKind.value) ? el.chKind.value : '기타';
    const hit = st.chEdit ? b.changes.find((x) => x.id === st.chEdit) : null;
    if (hit) {
      Object.assign(hit, { date, kind, item, before, after, reason });
      setStatus('변경이력을 고쳤습니다.');
    } else {
      b.changes.push({ id: newId(), date, kind, item, before, after, reason, auto: false });
      setStatus('변경이력을 적었습니다.');
    }
    clearChangeForm();
    paintChanges();
    save();
  }

  function onChangesClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('button[data-copy],button[data-edit],button[data-del]') : null;
    const p = cur();
    if (!btn || !p) return;
    const b = curBook(p);
    if (btn.dataset.copy) {
      const c = b.changes.find((x) => x.id === btn.dataset.copy);
      if (c) copyWith(btn, changeLine(c), `변경이력 한 줄: ${c.item}`);
      return;
    }
    if (btn.dataset.edit) {
      const c = b.changes.find((x) => x.id === btn.dataset.edit);
      if (!c) return;
      st.chEdit = c.id;
      el.chDate.value = c.date || today();
      el.chKind.value = c.kind;
      el.chItem.value = c.item;
      el.chBefore.value = c.before;
      el.chAfter.value = c.after;
      el.chReason.value = c.reason;
      el.chAdd.textContent = '저장';
      showChangeForm(true);
      paintChanges();
      el.chItem.focus();
      return;
    }
    if (!confirmTwice(btn, '정말 지우기')) return;
    b.changes = b.changes.filter((x) => x.id !== btn.dataset.del);
    if (st.chEdit === btn.dataset.del) clearChangeForm();
    paintChanges();
    save();
    setStatus('변경이력을 지웠습니다.');
  }

  /** 줄 안의 사유 칸 — 다 적고 나가면(change) 그 줄에 붙는다. */
  function onReasonChange(e) {
    const node = e.target;
    if (!(node instanceof HTMLElement) || node.tagName !== 'INPUT' || !node.dataset.reason) return;
    const p = cur();
    const c = p ? curBook(p).changes.find((x) => x.id === node.dataset.reason) : null;
    if (!c) return;
    c.reason = node.value.trim().slice(0, 1000);
    if (c.reason) paintChanges();
    save();
  }

  /* ---------------------------------------------------------- 복사 */

  const iconTimers = new WeakMap();
  /** 복사 아이콘을 잠깐 체크(못 했으면 ×)로 — 글자 단추처럼 flash 로 글을 바꾸면 아이콘이 지워진다. */
  function iconFlash(btn, ok) {
    clearTimeout(iconTimers.get(btn));
    btn.classList.toggle('done', ok);
    btn.classList.toggle('fail', !ok);
    btn.innerHTML = ok ? DONE_ICON : FAIL_ICON;
    iconTimers.set(btn, setTimeout(() => {
      btn.classList.remove('done', 'fail');
      btn.innerHTML = COPY_ICON;
    }, ok ? 1500 : 3000));
  }

  /** 글을 복사하고 누른 버튼에 결과를 잠깐 보인다(아이콘 단추는 체크로). what 은 활동 기록에 적는 말. */
  async function copyWith(btn, text, what) {
    const p = cur();
    const ok = await copyText(text);
    if (btn.classList.contains('rd-icon')) iconFlash(btn, ok);
    else flash(btn, ok ? '복사됨 ✓' : '복사 못 함');
    logEvent('rnd', ok, `R&D 복사 — ${what}${p ? ` (${label(p)} ${yearLabel(curYear(p))})` : ''}`);
  }

  async function copySummary() {
    const p = cur();
    if (!p) return;
    const ok = await copyText(summaryText(p, curYear(p), today()));
    flash(el.copy, ok ? '복사했습니다 ✓' : '복사하지 못했습니다');
    logEvent('rnd', ok, `R&D 요약 복사: ${label(p)} ${yearLabel(curYear(p))}`);
  }

  /** 예산 표 복사 — 미청구를 켰으면 그 보조 줄도 한 줄로. */
  const copyBudget = () => {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    const u = unbilledPlace(b);   // 연구활동비 줄에 든 미청구는 그 줄의 집행에 이미 들어 있고, 못 넣은 것만 따로 한 줄
    copyWith(el.budgetCopy, budgetTsv(u.loose ? [...b.budget, { id: 'unbilled', item: `미청구(과제카드 ${u.count}건)`, plan: null, used: u.loose }] : b.budget), '예산 표');
  };
  const copyLogs = () => { const p = cur(); const notes = p ? noteLogs(curBook(p)) : []; if (p) copyWith(el.logsCopy, logLines(notes).join('\n'), `진행 기록 ${notes.length}건`); };
  const copyFile = (btn, key, what) => { const p = cur(); const l = p ? fileLog(curBook(p), key) : null; if (l) copyWith(btn, entryText(l), what); };
  const copyChanges = () => { const p = cur(); if (p) copyWith(el.changesCopy, changeLines(curBook(p).changes).join('\n'), `변경이력 ${curBook(p).changes.length}건`); };

  /* ---------------------------------------------------------- 파일·가져오기 */

  async function exportBook() {
    const name = exportName(today());
    try {
      await download(exportJson(st.book), name, 'application/json');
      setStatus(`저장했습니다 — ${name}`);
      logEvent('rnd', true, `R&D 과제 JSON 저장: 과제 ${st.book.projects.length}개`, { name });
    } catch (err) {
      setStatus(`저장하지 못했습니다 — ${err.message}`, 'error');
    }
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const incoming = importJson(await readText(file));
      const res = restoreBook(st.book, incoming);
      st.book = res.book;
      st.editing = null;
      el.form.classList.add('hidden');
      clearLogForm();
      clearChangeForm();
      paintAll();
      save();
      setStatus(`들여왔습니다 — 바꿈 ${res.replaced.length} · 더함 ${res.added.length} (과제 ${st.book.projects.length}개)`);
      logEvent('rnd', true, `R&D 과제 JSON 불러옴: 바꿈 ${res.replaced.length} · 더함 ${res.added.length}`, { name: file.name });
    } catch (err) {
      setStatus(`들여오지 못했습니다 — ${err.message}`, 'error');
      logEvent('rnd', false, `R&D 과제 JSON 불러오기 실패: ${err.message}`, { name: file.name });
    }
  }

  /** 공문 탭의 공문 설정 과제를 가져온다. quiet 면(처음 열 때) 없어도 말하지 않는다. */
  async function importGongmun({ quiet = false } = {}) {
    const saved = await chrome.storage.local.get(GM_PROJECTS_KEY);
    const inc = fromGongmun(saved?.[GM_PROJECTS_KEY]);
    if (!inc.length) {
      if (!quiet) setStatus('공문 탭의 공문 설정에 과제가 없습니다.', 'error');
      return 0;
    }
    const res = mergeProjects(st.book, inc);
    st.book = res.book;
    const n = res.added.length + res.filled.length;
    const parts = [res.added.length ? `더함 ${res.added.length}` : '', res.filled.length ? `빈 칸 채움 ${res.filled.length}` : '', res.skipped.length ? `${MAX_PROJECTS}개를 넘어 뺌 ${res.skipped.length}` : ''].filter(Boolean);
    setStatus(n ? `공문 탭의 과제를 가져왔습니다 — ${parts.join(' · ')}` : '공문 탭의 과제는 이미 다 있습니다.');
    if (n) {
      logEvent('rnd', true, `공문 탭의 과제 가져옴: ${parts.join(' · ')}`);
      save();
    }
    paintAll();
    return n;
  }

  function readText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      fr.readAsText(file);
    });
  }

  /* ---------------------------------------------------------- 연구개발계획서 YAML 넣기 */

  let yamlLib = null;
  /** YAML 풀이(vendor/yaml — npm yaml 2.9.1 의 브라우저 빌드)는 처음 넣을 때만 읽어 들인다. */
  const loadYaml = async () => (yamlLib ||= await import('./vendor/yaml/index.js'));
  const isYamlFile = (f) => /\.ya?ml$/i.test(f?.name || '') || /yaml/i.test(f?.type || '');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  async function intakeFiles(files) {
    const list = [...(files || [])].filter(isYamlFile);
    if (!list.length) {
      setStatus('YAML 파일(.yaml · .yml)만 넣을 수 있습니다 — RND 폴더의 KR_<과제>.yaml 이나 history/*.yaml.', 'error');
      return;
    }
    const texts = [];
    for (const f of list) {
      try {
        texts.push({ name: f.name, text: await readText(f) });
      } catch (err) {
        setStatus(`${f.name}: ${err.message}`, 'error');
        return;
      }
    }
    return intakeTexts(texts, { source: 'file' });
  }

  /**
   * YAML 글들을 장부에 넣는다 — 풀어서 종류를 가리고(스냅샷 → 개정 레지스트리 → 예산 이력 → 참여연구원 이력 차례), 하나씩 넣는다.
   * 이력 파일은 주석의 과제명으로 과제를 찾고 없으면 보고 있는 과제에 넣는다. 하나라도 들어갔으면 그린 뒤 저장한다.
   * 넣은 결과를 돌려주고(rndgen 의 넣기·반영이 읽는다), 하나라도 들어갔으면 intakeHook 을 부른다(원문 저장 — 끌어 놓기·붙여 넣기로 넣은 것도).
   * source 는 어디서 왔나('file'·'paste'·'extract'·'revise'), summary 는 고치기의 변경분 한 줄 — 훅에 그대로 넘긴다.
   * @returns {Promise<{ ok: boolean, error: string, lines: string[],
   *   results: Array<{ name: string, kind: string, label: string, summary: string, projectId: string, n: number, rev: string, applied: boolean }> }>}
   *   applied 는 스냅샷이면 그 판이 그 차년도에 들어갔는가(더 오래된 판이라 넣지 않았으면 false), 이력 파일은 늘 true.
   */
  async function intakeTexts(texts, { source = 'file', summary = '' } = {}) {
    el.intake.setAttribute('aria-busy', 'true');
    const lines = [];
    const results = [];
    let error = '';
    let resAfter = [];   // 연구내용 페이지를 다시 올릴 과제 (원노트에 올린 적이 있는 것만)
    try {
      const { parse } = await loadYaml();
      const docs = [];
      for (const { name, text } of texts) {
        const what = name || '붙여 넣은 글';
        let obj;
        try {
          obj = parse(text);
        } catch (err) {
          throw new Error(`${what}: YAML 을 읽지 못했습니다 — ${String(err.message || err).split('\n')[0]}`);
        }
        const kind = kindOf(obj);
        if (!kind) throw new Error(`${what}: 아는 모양의 YAML 이 아닙니다 — 연구개발계획서 스냅샷(meta.과제명)이나 history 의 revisions·budget·researchers 파일을 넣으세요.`);
        docs.push({ name, text, obj, kind });
      }
      // 종류 차례(스냅샷 → 레지스트리 → 예산 → 참여연구원), 같은 종류는 판 차례(r0 → r1 → r2) — 놓인 차례와 상관없이 최종본이 남는다.
      docs.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || revOf(a.obj) - revOf(b.obj));
      for (const d of docs) {
        const p = cur();
        const res = applyYaml(st.book, d.obj, { text: d.text, file: d.name, current: p, n: p ? curYear(p) : 0, today: today() });
        lines.push(`${res.label}${d.name ? `(${d.name})` : ''}: ${res.summary}`);
        logEvent('rnd', true, `R&D YAML 넣음 — ${res.label}: ${res.summary}`, { file: d.name });
        results.push(intakeResult(d, res));
      }
      // 스냅샷은 연구내용 공유에 쓸 모양(rerp/research.js 기록 — 개발목표·개발내용·연구활동비 세부사용계획 …)으로도 남기고, 이미 원노트에 올린 과제면 그 페이지를 고친다.
      const recs = docs.filter((d) => d.kind === 'snapshot').map((d) => { try { return RS.readSnapshot(d.obj, { text: d.text, file: d.name }); } catch { return null; } }).filter(Boolean);
      if (recs.length) resAfter = await storeResearch(recs);
      setStatus(lines.join(' / '));
    } catch (err) {
      error = err.message;
      setStatus(`${lines.length ? `${lines.join(' / ')} / ` : ''}${err.message}`, 'error');
      logEvent('rnd', false, `R&D YAML 넣기 실패: ${err.message}`);
    } finally {
      el.intake.removeAttribute('aria-busy');
      if (lines.length) {
        st.book = normalizeBook(st.book);
        clearLogForm();
        clearChangeForm();
        paintAll();
        save();
      }
      // 넣는 칸은 맨 아래라 알림 줄(머리 아래)이 화면 밖일 수 있다 — 결과가 보이게 끌어온다.
      el.status.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      for (const p of resAfter) shareResearch(p, { auto: true });   // 기다리지 않는다
    }
    const result = { ok: !error, error, lines, results };
    if (lines.length && intakeHook) {
      try {
        intakeHook(result, texts, { source, summary });
      } catch (err) {
        console.error('R&D YAML 원문을 남기지 못했습니다', err);
      }
    }
    return result;
  }

  /** 넣은 문서 하나의 결과 — 스냅샷은 그 판(readSnapshot 의 n·rev)이 그 차년도에 실제로 들어갔는지(applied)까지. */
  function intakeResult(d, res) {
    const projectId = res.project?.id || '';
    if (d.kind !== 'snapshot') {
      return { name: d.name || '', kind: d.kind, label: res.label, summary: res.summary, projectId, n: res.project ? curYear(res.project) : 0, rev: '', applied: true };
    }
    const snap = readSnapshot(d.obj);
    const applied = res.project?.years?.[snap.n]?.snapshot?.rev === snap.rev;
    return { name: d.name || '', kind: d.kind, label: res.label, summary: res.summary, projectId, n: snap.n, rev: snap.rev || '', applied };
  }

  function onDrag(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (e.type === 'dragleave') {
      if (!el.root.contains(e.relatedTarget)) el.intake.classList.remove('over');
      return;
    }
    el.intake.classList.add('over');
  }

  function onDrop(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    el.intake.classList.remove('over');
    intakeFiles(e.dataTransfer.files);
  }

  /** 붙여 넣기 — 파일이면 그대로, 글이면 YAML 처럼 보일 때만(칸에 적는 중이면 가로채지 않는다). */
  function onPaste(e) {
    if (el.root.classList.contains('hidden')) return;
    const files = [...(e.clipboardData?.files || [])].filter(isYamlFile);
    if (files.length) {
      e.preventDefault();
      intakeFiles(files);
      return;
    }
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]');
    const text = typing ? '' : (e.clipboardData?.getData('text/plain') || '').trim();
    if (!text || !/^(#|meta:|entity:|project:|revisions:)/m.test(text)) return;
    e.preventDefault();
    intakeTexts([{ name: '', text }], { source: 'paste' });
  }

  /* ---------------------------------------------------------- 차년도 YAML 뽑는 스킬 */

  /** 스킬 목록(rnd/skills.json)을 읽어(한 번만) 그린다 — 칸을 펼 때나 버튼을 누를 때. 못 읽었으면 null. */
  async function loadManifest() {
    if (!st.manifest && !st.manifestError) {
      try {
        st.manifest = checkManifest(JSON.parse(await readAsset(MANIFEST_PATH)));
      } catch (err) {
        st.manifestError = err.message;
      }
    }
    paintSkills();
    return st.manifest;
  }

  function paintSkills() {
    const m = st.manifest;
    el.skillZip.disabled = !!st.manifestError;
    el.skillGuide.disabled = !!st.manifestError;
    if (!m) {
      el.skills.innerHTML = st.manifestError ? `<li class="rd-skill-miss">스킬 목록을 읽지 못했습니다 — ${escapeHtml(st.manifestError)}</li>` : '';
      el.skillState.textContent = st.manifestError ? '목록 없음' : 'Claude Code 스킬 묶음';
      return;
    }
    el.skills.innerHTML = m.skills.map((s) => `<li title="${escapeHtml(s.hint ? `인자: ${s.hint}` : '')}"><strong>${escapeHtml(s.name)}</strong><small>파일 ${s.files.length}개 · ${kb(s.bytes)}</small><p>${escapeHtml(s.summary || '')}</p></li>`).join('');
    el.skillState.textContent = `스킬 ${m.skills.length}개 · ${kb(m.skills.reduce((a, s) => a + s.bytes, 0))} · 복사 ${m.syncedAt || '?'}`;
  }

  /** 스킬 다섯 개를 zip 하나로 내려받는다 — 맨 앞에 쓰는 법(README.md). 받아서 과제 작업 프로젝트의 .claude/skills/ 에 푼다. */
  async function saveSkillZip() {
    const m = await loadManifest();
    if (!m) {
      setStatus(`스킬 목록을 읽지 못했습니다 — ${st.manifestError}`, 'error');
      return;
    }
    el.skillZip.disabled = true;
    try {
      const bytes = await bundleSkills(m, (path) => readAsset(path, 'bytes'), { today: today() });
      const name = zipName(today());
      await download(bytes, name, 'application/zip');
      flash(el.skillZip, '저장됨 ✓');
      setStatus(`스킬 묶음을 저장했습니다 — ${name} (${kb(bytes.length)}). 과제 작업 프로젝트의 .claude/skills/ 에 푸세요.`);
      logEvent('rnd', true, `R&D 스킬 묶음 저장: ${name}`, { bytes: bytes.length });
    } catch (err) {
      setStatus(`스킬 묶음을 만들지 못했습니다 — ${err.message}`, 'error');
      logEvent('rnd', false, `R&D 스킬 묶음 실패: ${err.message}`);
    } finally {
      el.skillZip.disabled = !!st.manifestError;
    }
  }

  async function copySkillGuide() {
    const m = await loadManifest();
    if (!m) {
      setStatus(`스킬 목록을 읽지 못했습니다 — ${st.manifestError}`, 'error');
      return;
    }
    copyWith(el.skillGuide, skillGuide(m, { today: today() }), '스킬 쓰는 법');
  }

  /* ---------------------------------------------------------- rERP 집행내역 (kr_ext_rerp 에서 옮긴 rerp/ 로 — 2026-10-11 사용자 지정) */
  // 차년도를 rERP 과제에 이어 두면(src/rnderp.js linkOf — 과제번호로 저절로, 못 고르면 목록에서) 비목별 잔액·미청구 카드를 받아(fetchSnapshot) 장부에 스냅샷으로 두고,
  // kr_ext_rerp 의 과제집행비율 표(rerp/planui.js budgetTable — 예산·예산잔액·집행비율·예상 비용 ＋·미청구·승인전·합계)를 그대로 그린다.
  // 맞춰진 비목의 집행 칸은 rERP 승인액이 된다(applySnapshot). 살아 있는 조회는 오늘이 든 차년도만, 10분마다(ERP_TTL_MS). 로그인이 풀렸으면 eClass SSO 를 한 번 하고 다시 받는다.

  const yearOf = (p) => { const n = curYear(p); const ys = yearsOf(p); return ys.find((y) => y.n === n) || ys[0]; };
  const erpTriedKey = (p) => `${p.id}:${curYear(p)}`;
  const myName = () => String(me() || '').trim();
  const sameName = (a, b) => !!a && !!b && String(a).replace(/\s/g, '') === String(b).replace(/\s/g, '');
  const setErpMsg = (msg, error = false) => { el.erpMsg.textContent = msg; el.erpMsg.classList.toggle('error', !!error); };
  const clearErpPick = () => { el.erpPick.classList.add('hidden'); setErpMsg(''); };
  /** rERP 가 못 받은 까닭을 사람 말로 — 로그인은 src/net.js 와 같은 "로그인이 필요합니다" 말투. */
  const erpMessage = (err) => (err?.kind === 'eclass-login' ? '로그인이 필요합니다. eclass 에 로그인한 뒤 ↻ 를 누르세요.'
    : err?.kind === 'login' ? '로그인이 필요합니다. rERP 세션이 풀렸습니다 — eclass 에 로그인돼 있으면 ↻ 로 다시 받습니다.'
    : `rERP 에서 받지 못했습니다 — ${String(err?.message || err)}`);
  /** rERP 가 "로그인 필요"로 답하면 eClass SSO 를 한 번 하고 다시 한다(rerp background.js rndAutoLogin 과 같은 흐름). */
  async function withLogin(fn) {
    try { return await fn(); } catch (err) { if (err?.kind !== 'login') throw err; await erp.ssoLogin(); return fn(); }
  }

  /**
   * 장부에서 rERP 로 이어진 차년도들 — 원노트 예상 비용 동기화의 문맥(과제명·내 과제·내 이름).
   * 책임 과제(leadPrjNos)는 늘 비운다 — 여기서는 페이지를 만들지 않는다(보기만, 2026-10-11 사용자 지정). 페이지는 rerp 확장에서 책임자가 만든다.
   */
  function erpContext() {
    const names = {};
    const mine = new Set();
    for (const p of st.book.projects) {
      for (const y of Object.values(p.years)) {
        const e = y.erp;
        if (!e?.prjNo) continue;
        names[e.prjNo] = e.prjNm || p.name;
        mine.add(e.prjNo);
      }
    }
    return { names, myPrjNos: [...mine], leadPrjNos: [], who: myName() };
  }

  // 원노트 예상 비용 동기화 배선(rerp background.js 의 planSync 와 같은 것, rerp/plussync.js) — 설정은 원노트 칸의 rndNote.plus, 과제 문맥은 장부, 클립보드는 copyText.
  const plus = createPlusSync({
    settings: () => ({ ...st.note.plus, enabled: st.note.plus.on }),
    context: erpContext, copyText, fetch: mcpFetch,
    version: (globalThis.chrome?.runtime?.getManifest?.() || {}).version || '0',
  });
  // rerp/plan.js 가 백그라운드에 보내던 요청(planSync · planExport · planBind …)을 같은 창의 배선으로. 끝나면 상태 글·표를 다시 그린다.
  PLAN.send = (msg) => plus.send(msg).then((r) => { if (msg?.type !== 'planSyncQueue') afterPlanSync(r); return r; });

  /** 동기화가 끝나면 — 결과(rerp 와 같은 저장 키 planSyncState · plusPlanPages)를 화면 상태에 들이고 원노트 칸·표를 다시 그린다. */
  async function afterPlanSync(r) {
    if (!r || r.skipped === 'off') return;
    try {
      // 받은 예상 비용(plannedExpenses)도 다시 읽는다 — rerp/plan.js 는 storage.onChanged 로 받지만 검사에는 그 알림이 없다.
      const s = await chrome.storage.local.get([PLAN.SKEY, PLAN.PKEY, PLAN.KEY]);
      st.pl.planSync = s?.[PLAN.SKEY] || st.pl.planSync;
      st.pl.planPages = s?.[PLAN.PKEY] || st.pl.planPages;
      st.pl.plans = s?.[PLAN.KEY] || st.pl.plans;
    } catch { /* 저장소를 못 읽어도 결과는 r 에 있다 */ }
    if (!r.skipped) {
      const q = st.note.plus;
      q.error = r.ok ? '' : (r.error || '맞추지 못했습니다');
      // 이어진 과제 가운데 페이지가 아직 없는 것 — 여기서는 만들지 않으니 rerp 확장에서 만들어야 한다고 알린다.
      const missing = erpContext().myPrjNos.filter((no) => !r.pages?.[no]?.pageId);
      q.last = r.ok ? `맞춤 ${when(r.at)} · 과제 ${Object.keys(r.pages || {}).length}개 · 항목 ${r.count || 0}건${missing.length ? ` · 페이지 없음 ${missing.length}개(rerp 확장에서 만듭니다)` : ''}${r.sectionWarn ? ` · ${r.sectionWarn.error}` : ''}` : q.last;
      if (r.kind === 'notebook') plusNotebookPick(r.notebooks || []);
      saveNote();
      logEvent('rnd', !!r.ok, `R&D 예상 비용 원노트 맞춤(${r.reason || ''}): ${r.ok ? `과제 ${Object.keys(r.pages || {}).length}개 · 항목 ${r.count || 0}건` : q.error}`);
    }
    paintPlus();
    paintNote();
    drawErp();
  }

  function paintErp() {
    const p = cur();
    if (!p) return;
    // R&D 설정에서 꺼 두면 칸을 통째로 숨긴다(이어 둔 과제·스냅샷은 장부에 그대로).
    el.erp.classList.toggle('hidden', !st.set.erp);
    if (!st.set.erp) return;
    const b = curBook(p);
    const y = yearOf(p);
    const e = b.erp || null;
    const live = isLive(y, today());
    el.erp.classList.toggle('busy', st.erpBusy);
    el.erpLink.textContent = e ? 'rERP 잇기 바꾸기' : 'rERP 과제 잇기';
    el.erpLink.disabled = st.erpBusy;
    el.erpUnlink.classList.toggle('hidden', !e);
    el.erpRefresh.disabled = !e || st.erpBusy;
    el.erpRefresh.title = !e ? '먼저 rERP 과제를 이으세요' : live ? 'rERP 에서 지금 다시 받기 (열 때와 10분마다 저절로 받습니다)' : '지난 차년도 — 마지막 조회를 그대로 둡니다. 누르면 지금 상태로 다시 받습니다';
    if (e) {
      const at = e.snap?.at ? `조회 ${erpClock(e.snap.at)}` : '아직 못 받음';
      el.erpInfo.innerHTML = `<b>${escapeHtml(e.prjNo)}</b>${e.anl ? ` ${e.anl}연차` : ''}${e.prjNm ? ` · ${escapeHtml(e.prjNm)}` : ''} · ${at}${live ? '' : ' · 지난 차년도'}`;
      el.erpInfo.title = `${e.prjNo}${e.prjNm ? ` ${e.prjNm}` : ''}${e.rspr ? ` · 책임자 ${e.rspr}` : ''}${e.stDt ? ` · ${dot(e.stDt)} ~ ${dot(e.endDt)}` : ''} · ${e.auto ? '과제번호로 저절로 이음' : '목록에서 고름'}${e.snap?.std === '20' ? ' · 본예산 기준' : ''}`;
      // 접힌 한 줄의 형편(2026-10-11 사용자 지정) — 과제명은 빼고 과제번호·연차·조회 시각만. 집행비율은 예산 칸 머리에 이미 있다.
      el.erpState.textContent = `${e.prjNo}${e.anl ? ` ${e.anl}연차` : ''} · ${at}${live ? '' : ' · 지난 차년도'}`;
    } else {
      el.erpInfo.textContent = p.code ? `과제번호 ${p.code} 로 rERP 과제를 찾습니다` : '과제번호가 없어 rERP 진행 과제 목록에서 고릅니다';
      el.erpInfo.title = '';
      el.erpState.textContent = '잇지 않음';
    }
    // 표는 rerp 의 것 그대로 — p 는 rerp 패널의 과제(prjNo·rspr·budget·budgetError), s 는 설정(planSync·quickPicks), state 는 예상 비용 화면 상태.
    el.erpTable.innerHTML = e
      ? budgetTable({ prjNo: e.prjNo, rspr: e.rspr, budget: e.snap?.budget || null, budgetError: e.snap?.budget ? '' : (e.error?.message || ''), unbilledShared: 0 }, { planSync: st.note.plus.on, quickPicks: [] }, st.pl)
      : '';
    // 보기만(2026-10-11 사용자 지정) — 예상 비용을 적고 고치고 페이지를 만드는 것은 rerp 확장(eClass 홈)에서 한다. 여기서는 ＋·✎·×·수량 −/＋·저장·내보내기를 걷어 내고
    // 눈(펼치기)·가져오기(⬇ 동료가 보낸 페이지 링크 묶기)·열기(↗)만 둔다. 원노트 동기화로 받은 것이 표와 장부(사용계획)에 보인다.
    for (const node of el.erpTable.querySelectorAll('[data-act="plan-open"], .krext-plan-acts, [data-act="plan-qty"], [data-act="plan-persist"], [data-act="plan-export"]')) node.remove();
    namePlanRows(el.erpTable);
  }

  /**
   * 비목별 "↳ 예상 반영" 줄(rerp 원본대로 항목 줄보다 먼저, 비목 줄 바로 아래 — 2026-10-11 사용자 지정, kr_ext_rerp lib/render.js 에서 옮김)에 비목 이름을 앞에 붙인다 —
   * `연구활동비` → `↳ 연구활동비 예상 반영 1건 · 150,000원` → `↳ 회의비 …`. 이 패널만의 모양이라 rerp/planui.js 는 그대로 두고(rerp/CLAUDE.md) 그린 표만 손본다. 합계 아래의 예상 반영 줄은 rerp 와 같이 그대로.
   */
  function namePlanRows(table) {
    for (const tr of table.querySelectorAll('tbody tr.krext-bgt-proj')) {
      const head = tr.previousElementSibling;
      if (!head || /\bkrext-bgt-(plan|form|proj)\b/.test(head.className || '')) continue;
      const nm = head.querySelector('.krext-bgt-nm')?.cloneNode(true);
      for (const n of nm?.querySelectorAll('.krext-tag, button') || []) n.remove();
      const name = String(nm?.textContent || '').replace(/\s+/g, ' ').trim();
      const cell = tr.querySelector('.krext-bgt-nm');
      if (name && cell) cell.innerHTML = cell.innerHTML.replace('예상 반영', `${escapeHtml(name)} 예상 반영`);
    }
  }

  /** 탭을 열 때·과제나 차년도를 고를 때 — 이어져 있으면 신선하지 않을 때 다시 받고, 아니면 올해 차년도에 한해 이 세션에서 한 번 저절로 잇는다. */
  function erpAuto() {
    const p = cur();
    if (!p || !st.set.erp) return;
    const b = curBook(p);
    if (b.erp) {
      refreshErp({ reason: '열 때' });
      return;
    }
    if ((p.code || p.name) && !st.erpTried.has(erpTriedKey(p)) && isLive(yearOf(p), today())) linkErp({ manual: false });
  }

  /**
   * 이 차년도를 rERP 과제에 잇는다 — rERP 과제 목록(과제번호×연차 행)에서 과제번호(없으면 과제명)의 행들을 찾아 차년도에 맞는 행을 고른다(pickYearRec).
   * 못 고르면 진행 과제 드롭다운(이름이 비슷한 것 ★ 먼저)을 세운다. 이으면 바로 받는다.
   */
  async function linkErp({ manual = false } = {}) {
    const p = cur();
    if (!p || st.erpBusy) return;
    const b = curBook(p);
    const y = yearOf(p);
    st.erpTried.add(erpTriedKey(p));
    st.erpBusy = true;
    paintErp();
    setErpMsg('rERP 과제 목록을 받는 중…');
    try {
      const got = await withLogin(() => erp.fetchProjectRecs(erp.settingsOf()));
      if (!got.recs.length && got.firstErr) throw got.firstErr;
      st.erpRecs = got.recs;
      const rows = projectRecs(got.recs, { code: p.code, name: p.name });
      const rec = pickYearRec(rows, y);
      if (rec) {
        b.erp = linkOf(rec, { auto: !manual, now: Date.now() });
        clearErpPick();
        logEvent('rnd', true, `R&D rERP 잇기: ${label(p)} ${yearLabel(y.n)} → ${rec.prjNo}${rec.anl ? ` ${rec.anl}연차` : ''}`);
        save();
        st.erpBusy = false;
        paintErp();
        await refreshErp({ force: true, reason: '잇기' });
        return;
      }
      const list = candidates(got.recs, { name: p.name });
      if (!list.length) {
        setErpMsg('rERP 진행 과제 목록이 비어 있습니다.', true);
        return;
      }
      el.erpSelect.innerHTML = `<option value="">rERP 과제 고르기 — ${list.length}개</option>`
        + list.map((c) => `<option value="${escapeHtml(c.prjNo)}">${c.like ? '★ ' : ''}${escapeHtml(c.prjNo)} · ${escapeHtml(c.prjNm)}${c.rspr ? ` (${escapeHtml(c.rspr)})` : ''}</option>`).join('');
      el.erpPick.classList.remove('hidden');
      setErpMsg(rows.length
        ? `rERP 에 ${p.code || p.name} 의 연차 행이 여럿이라 ${yearLabel(y.n)}에 맞는 것을 못 골랐습니다 — 목록에서 고르세요.`
        : `rERP 진행 과제에서 ${p.code ? `과제번호 ${p.code}` : `과제명 "${p.name}"`} 을 못 찾았습니다 — 목록에서 고르세요(이름이 비슷한 것 ★ 먼저).`);
      if (manual) el.erpSelect.focus();
    } catch (err) {
      setErpMsg(erpMessage(err), true);
      logEvent('rnd', false, `R&D rERP 잇기 실패: ${String(err?.message || err)}`);
    } finally {
      st.erpBusy = false;
      paintErp();
    }
  }

  /** 드롭다운에서 고른 과제로 잇는다 — 그 과제번호의 연차 행 가운데 차년도에 맞는 것, 없으면 마지막 연차. */
  async function pickErp() {
    const p = cur();
    const prjNo = el.erpSelect.value;
    if (!p) return;
    if (!prjNo) {
      setErpMsg('rERP 과제를 고르세요.', true);
      return;
    }
    const b = curBook(p);
    const y = yearOf(p);
    const rows = projectRecs(st.erpRecs || [], { code: prjNo });
    const rec = pickYearRec(rows, y) || rows[rows.length - 1];
    if (!rec) return;
    b.erp = linkOf(rec, { auto: false, now: Date.now() });
    clearErpPick();
    logEvent('rnd', true, `R&D rERP 잇기(고름): ${label(p)} ${yearLabel(y.n)} → ${rec.prjNo}${rec.anl ? ` ${rec.anl}연차` : ''}`);
    save();
    paintErp();
    await refreshErp({ force: true, reason: '고름' });
  }

  /** 끊는다(두 번) — 스냅샷도 버리고 맞춰진 비목의 집행은 다시 손으로 적는다(값은 남긴다). */
  function unlinkErp() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    if (!b.erp || !confirmTwice(el.erpUnlink, '정말 끊기')) return;
    const was = b.erp.prjNo;
    delete b.erp;
    for (const r of b.budget) delete r.erpKey;
    clearErpPick();
    logEvent('rnd', true, `R&D rERP 끊음: ${label(p)} ${yearLabel(curYear(p))} (${was})`);
    paintBudget();
    paintErp();
    save();
    setStatus('rERP 연결을 끊었습니다 — 집행은 다시 손으로 적습니다.');
  }

  /**
   * rERP 에서 집행내역을 받아 스냅샷으로 두고 장부 줄에 넣는다. force 가 아니면 오늘이 든 차년도가 아니거나(지난 차년도는 마지막 조회 그대로) 10분 안이면 건너뛴다.
   * 한 번에 하나만 돈다. 던지지 않는다 — 까닭은 칸에 보인다.
   */
  function refreshErp({ force = false, reason = '' } = {}) {
    const p = cur();
    if (!p || !st.set.erp) return Promise.resolve(false);
    const b = curBook(p);
    const e = b.erp;
    const y = yearOf(p);
    if (!e) return Promise.resolve(false);
    if (!force && (!isLive(y, today()) || isFresh(e.snap))) return Promise.resolve(false);
    if (st.erpRun) return st.erpRun;
    st.erpRun = (async () => {
      st.erpBusy = true;
      paintErp();
      let ok = false;
      try {
        const snap = await fetchSnapshot(erp, e.prjNo, { year: y, today: today(), now: Date.now() });
        e.snap = snap;
        e.error = null;
        paintBudget();   // 스냅샷을 장부 줄에(applyErp) 넣고 다시 그린다
        setErpMsg(snap.error || '');
        logEvent('rnd', true, `R&D rERP 집행내역 받음(${reason}): ${e.prjNo} · 집행비율 ${snap.budget.rateAll}% · 미청구 ${snap.cards.count}건`);
        ok = true;
      } catch (err) {
        e.error = { kind: err?.kind || 'error', message: String(err?.message || err) };
        setErpMsg(erpMessage(err), true);
        logEvent('rnd', false, `R&D rERP 집행내역 실패(${reason}): ${String(err?.message || err)}`);
      } finally {
        st.erpBusy = false;
        st.erpRun = null;
        save();
        paintSum(b);
        paintErp();
      }
      return ok;
    })();
    return st.erpRun;
  }

  /* ---------------------------------------------------------- R&D 설정 (접힌 한 줄 — rERP 집행내역 켜기/끄기 · 그 안에 원노트 공유·YAML 넣기·스킬) + 예산 칸 위 "집행에 더하기" */

  /** 설정 줄의 머리 글 — `rERP 켬 · 원노트 꺼짐 · 비목 1 숨김` — 과 체크들. 예산 칸 위 "집행에 더하기"(2026-10-11 사용자 지정으로 설정에서 옮김)는 rERP 를 껐으면 잠그고 숨긴다. */
  function paintSet() {
    el.erpOn.checked = st.set.erp;
    el.incUnbilled.checked = st.set.unbilled;
    el.incPlan.checked = st.set.plan;
    for (const node of [el.incUnbilled, el.incPlan]) node.disabled = !st.set.erp;
    el.incRow.classList.toggle('hidden', !st.set.erp);
    paintItems();
    const n = st.note;
    const note = !n.on && !n.plus.on ? '원노트 꺼짐' : `원노트 ${[n.on ? '과제 정보' : '', n.plus.on ? '예상 비용' : ''].filter(Boolean).join('·')}`;
    // 공문 설정의 형편 줄처럼 한 줄에 들어가게 짧게(2026-10-11) — 긴 것은 CSS 가 줄임표로 자른다.
    el.setState.textContent = `rERP ${st.set.erp ? '켬' : '끔'} · ${note}${st.set.hide.length ? ` · 비목 ${st.set.hide.length} 숨김` : ''}`;
  }

  /**
   * "예산 칸에 보일 비목" 체크에 늘어설 이름들 — 계획서의 여섯 비목(src/rnd.js BUDGET_ITEMS) 차례로, 그 뒤에 장부 어느 차년도에든 있는 다른 비목, 그 뒤에 장부엔 없지만 설정에 남은 숨긴 이름(다시 켤 수 있게).
   * 같은 이름(nameKey)은 한 번만.
   */
  function itemNames() {
    const names = [];
    const seen = new Set();
    const add = (name) => { const k = nameKey(name); if (k && !seen.has(k)) { seen.add(k); names.push(name); } };
    for (const name of BUDGET_ITEMS) add(name);
    for (const p of st.book.projects) for (const y of Object.values(p.years || {})) for (const r of y?.budget || []) add(r.item);
    for (const h of st.set.hide) add(h);
    return names;
  }
  /** R&D 설정의 "예산 칸에 보일 비목"(2026-10-11 사용자 지정) — 체크가 꺼진 것이 숨긴 비목(rndSettings.hide). */
  function paintItems() {
    el.items.innerHTML = itemNames().map((name) => `<label><input type="checkbox" data-item="${escapeHtml(name)}"${isHidden(st.set, name) ? '' : ' checked'} /><span>${escapeHtml(name)}</span></label>`).join('');
  }
  /** 비목 체크를 바꾸면 — 끈 이름을 설정에 두고 예산 줄을 다시 그린다(합계는 그대로). */
  function onItemsToggle() {
    st.set.hide = [...el.items.querySelectorAll('input[data-item]')].filter((node) => !node.checked).map((node) => node.dataset.item);
    saveSet();
    logEvent('rnd', true, `R&D 설정: 예산 칸에 숨긴 비목 — ${st.set.hide.join('·') || '없음(모두 보임)'}`);
    if (cur()) paintBudget();
    paintSet();
  }

  const saveSet = () => chrome.storage.local.set({ [SET_KEY]: st.set });

  /** rERP 집행내역 켜기/끄기 — 끄면 칸이 숨고 집행 칸은 다시 손으로 적는다(이어 둔 것은 남는다). 켜면 바로 잇기·받기로 이어진다. */
  function onErpToggle() {
    st.set.erp = el.erpOn.checked;
    saveSet();
    logEvent('rnd', true, `R&D 설정: rERP 집행내역 ${st.set.erp ? '켬' : '끔'}`);
    if (cur()) {
      paintBudget();
      paintErp();
    }
    paintSet();
    if (st.set.erp) erpAuto();
  }

  /** 예산 칸 위 "집행에 더하기"(미청구·사용계획)를 바꾸면 장부 줄·합계를 다시 셈한다. */
  function onIncludeToggle() {
    st.set.unbilled = el.incUnbilled.checked;
    st.set.plan = el.incPlan.checked;
    saveSet();
    logEvent('rnd', true, `R&D 예산 집행에 더하기: ${includeNames(st.set).join('·') || '승인액만'}`);
    if (cur()) paintBudget();
    paintSet();
  }

  /** 예상 비용을 고친 뒤(rerp/plan.js 의 draw) — 사용계획을 집행에 더하는 설정이면 장부 줄도 다시 셈하고, rERP 표를 다시 그린다. */
  function drawErp() {
    const p = cur();
    if (p && st.set.plan && applyErp(curBook(p))) paintBudget();
    paintErp();
  }

  /* ---------------------------------------------------------- 원노트 공유(선택) — 과제 정보(src/rndnote.js) · 예상 비용(rerp/plussync.js) */

  const saveNote = () => chrome.storage.local.set({ [NOTE_KEY]: st.note });
  const when = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  /** 예상 비용 공유 줄 — 켜짐·섹션 이름·노트북 고르기·마지막 결과. rerp/planui.js 가 읽는 화면 상태(planSync·myNames)도 여기서 맞춘다. */
  function paintPlus() {
    const q = st.note.plus;
    el.plusOn.checked = q.on;
    el.plusRow.classList.toggle('hidden', !q.on);
    if (document.activeElement !== el.plusSection) el.plusSection.value = q.sectionName || 'RERP';
    el.plusMsg.textContent = q.on ? (q.error || q.last) : '';
    el.plusMsg.classList.toggle('error', !!(q.on && q.error));
    st.pl.data.settings.planSync = q.on;
    st.pl.data.myNames = [myName()].filter(Boolean);
  }

  /** 섹션을 둘 노트북을 고르게 한다 — RERP 섹션이 없거나 여러 노트북에 있을 때(rerp 팝업과 같은 흐름). */
  function plusNotebookPick(notebooks) {
    el.plusNotebook.innerHTML = `<option value="">(${st.note.plus.sectionName || 'RERP'} 섹션을 둘 노트북 고르기)</option>`
      + notebooks.map((n) => `<option value="${escapeHtml(n.id)}"${n.id === st.note.plus.notebookId ? ' selected' : ''}>${escapeHtml(n.name || n.id)}</option>`).join('');
    el.plusNotebook.classList.remove('hidden');
  }

  async function onPlusToggle() {
    const q = st.note.plus;
    q.on = el.plusOn.checked;
    q.error = '';
    if (!q.on) q.last = '';
    saveNote();
    paintPlus();
    paintNote();
    paintErp();
    logEvent('rnd', true, `R&D 예상 비용 원노트 공유 ${q.on ? '켬' : '끔'}`);
    if (q.on) await findPlusSection();
  }

  /** 섹션 이름(기본 RERP)으로 섹션을 찾고 없으면 고른 노트북에 만든 뒤 바로 맞춘다. 노트북을 골라야 하면 드롭다운이 선다. */
  async function findPlusSection() {
    const q = st.note.plus;
    q.sectionName = el.plusSection.value.trim() || 'RERP';
    if (el.plusNotebook.value) {
      q.notebookId = el.plusNotebook.value;
      q.notebookLabel = el.plusNotebook.selectedOptions[0]?.textContent || '';
    }
    q.error = '';
    q.last = `${q.sectionName} 섹션을 찾는 중…`;
    saveNote();
    paintPlus();
    const r = await plus.plusResolveSection();
    if (r.ok) {
      el.plusNotebook.classList.add('hidden');
      q.last = `${r.section.name} 섹션: ${r.section.notebook || r.section.label}${r.section.created ? ' (새로 만듦)' : ''} · 맞추는 중…`;
      saveNote();
      paintPlus();
      afterPlanSync(await plus.planSync('manual', {}));
      return;
    }
    if (r.kind === 'notebook') {
      plusNotebookPick(r.notebooks || []);
      q.last = `${r.error} — 고른 뒤 다시 '섹션 찾기/만들기'`;
    } else {
      q.error = r.error || '섹션을 찾지 못했습니다';
    }
    saveNote();
    paintPlus();
    paintNote();
  }

  function paintNote() {
    const n = st.note;
    const busy = st.noteBusy;
    el.noteOn.checked = n.on;
    // 다시 열면 섹션 목록은 아직 안 불러왔다 — 고른 섹션 하나는 이름으로 세워 둔다.
    if (n.sectionId && ![...el.noteSection.options].some((o) => o.value === n.sectionId)) {
      el.noteSection.add(Object.assign(document.createElement('option'), { value: n.sectionId, textContent: n.sectionLabel || n.sectionId }));
    }
    el.noteSection.value = n.sectionId;
    el.noteSection.disabled = !n.on || busy;
    el.noteSections.disabled = !n.on || busy;
    // 지금 맞추기는 과제 정보(섹션을 골랐을 때)나 예상 비용(켰을 때) 어느 쪽이든 할 일이 있으면 된다.
    el.noteSync.disabled = busy || !((n.on && n.sectionId) || n.plus.on);
    el.noteOpen.classList.toggle('hidden', !n.on || !n.webUrl);
    if (n.webUrl) el.noteOpen.href = n.webUrl;
    const info = !n.on ? '' : busy ? '맞추는 중…' : n.error ? '못 맞춤' : !n.sectionId ? '섹션을 고르세요' : n.at ? `맞춤 ${when(n.at)}` : '켜짐';
    const q = n.plus;
    const plusInfo = !q.on ? '' : `예상 비용 ${q.error ? '못 맞춤' : /^맞춤/.test(q.last) ? q.last.split(' · ')[0] : '켜짐'}`;
    el.noteState.textContent = [info, plusInfo].filter(Boolean).join(' · ') || '꺼짐';
    el.noteMsg.textContent = n.on ? n.error || n.last : '';
    el.noteMsg.classList.toggle('error', !!n.error);
    paintSet();
  }

  async function onNoteToggle() {
    st.note.on = el.noteOn.checked;
    st.note.error = '';
    saveNote();
    paintNote();
    logEvent('rnd', true, `R&D 원노트 공유 ${st.note.on ? '켬' : '끔'}`);
    if (!st.note.on) return;
    if (st.note.sectionId) await noteSync('켬');
    else await loadSections();
  }

  /** 내 노트북들의 섹션을 불러와 고르게 한다 — 다른 기기에서도 같은 섹션을 고르면 같은 페이지를 쓴다. */
  async function loadSections() {
    st.noteBusy = true;
    paintNote();
    try {
      const list = await listSections(await openNote());
      el.noteSection.innerHTML = `<option value="">섹션 고르기 — ${list.length}개</option>`
        + list.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)}</option>`).join('');
      st.note.error = '';
      st.note.last = list.length ? '과제 정보를 둘 섹션을 고르세요 — 다른 기기에서도 같은 노트북의 같은 섹션을 고릅니다.' : '섹션이 없습니다 — OneNote 에서 섹션을 하나 만들고 다시 불러오세요.';
    } catch (err) {
      st.note.error = String(err?.message || err);
    } finally {
      st.noteBusy = false;
      saveNote();
      paintNote();
    }
  }

  /** 섹션을 고르면 그 섹션의 페이지와 처음부터 맞춘다(지난 지문·묘비는 다른 페이지의 것이라 버린다). */
  async function onNoteSection() {
    const opt = el.noteSection.selectedOptions[0];
    Object.assign(st.note, { sectionId: el.noteSection.value, sectionLabel: el.noteSection.value ? opt?.textContent || '' : '', pageId: '', webUrl: '', memo: {}, del: {}, at: 0, error: '', last: '' });
    saveNote();
    paintNote();
    if (st.note.sectionId) await noteSync('섹션 고름');
  }

  /** 과제 정보를 고쳤으면(지난번에 맞춘 지문과 다르면) 잠깐 뒤 맞춘다. */
  let noteTimer = null;
  function noteSoon() {
    if (!st.note.on || !st.note.sectionId || bookHash(st.book) === st.noteHash) return;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => noteSync('고침'), NOTE_WAIT_MS);
  }

  /** 원노트에서 받은 것을 장부에 — 원노트 id 로 바꾸기 · 고침 · 더함 · 지움. 차년도 내용(예산·기록 …)은 건드리지 않는다. */
  function applyNote(res) {
    const b = st.book;
    for (const [from, to] of res.renames) {
      const p = projectOf(b, from);
      if (!p) continue;
      p.id = to;
      if (b.current.project === from) b.current.project = to;
      if (from in b.current.year) {
        b.current.year[to] = b.current.year[from];
        delete b.current.year[from];
      }
    }
    const info = new Map(res.projects.map((p) => [p.id, p]));
    for (const id of res.updated) {
      const p = projectOf(b, id);
      if (p) for (const k of INFO_KEYS) p[k] = info.get(id)[k];
    }
    for (const id of res.added) b.projects.push(normalizeProject({ ...info.get(id), years: {} }));
    b.projects = b.projects.filter((p) => !res.removed.includes(p.id));
    for (const id of res.removed) delete b.current.year[id];
    st.book = normalizeBook(b);
    if (st.editing && st.editing !== 'new' && !projectOf(st.book, st.editing)) {
      st.editing = null;
      el.form.classList.add('hidden');
    }
  }

  /**
   * 원노트의 과제 정보 페이지와 맞춘다 — 찾고(없으면 만들고) 읽어 syncInfo 로 맞춘 뒤, 장부에 받고 달라졌으면 페이지에 쓴다.
   * 한 번에 하나만 돈다(도는 중에 들어온 요청은 끝난 뒤 한 번 더). 던지지 않는다 — 까닭은 칸에 보인다.
   */
  function noteSync(reason = '') {
    if (!st.note.on || !st.note.sectionId) return Promise.resolve(false);
    clearTimeout(noteTimer);
    if (st.noteRun) {
      st.noteAgain = true;
      return st.noteRun;
    }
    st.noteRun = (async () => {
      st.noteBusy = true;
      paintNote();
      let ok = false;
      try {
        const nc = await openNote();
        const sectionId = st.note.sectionId;
        let page = st.note.pageId ? { pageId: st.note.pageId, webUrl: st.note.webUrl } : await findPage(nc, sectionId);
        let html = '';
        if (page) {
          try {
            html = await readPage(nc, page.pageId);
          } catch (err) {
            // 기억해 둔 페이지가 지워졌거나 옮겨졌을 수 있다 — 섹션에서 다시 찾는다.
            if (!st.note.pageId) throw err;
            page = await findPage(nc, sectionId);
            html = page ? await readPage(nc, page.pageId) : '';
          }
        }
        const block = html ? findBlock(html) : null;
        const remote = (block && readBlock(block.inner)) || { projects: [], del: {} };
        const res = syncInfo(st.book.projects, remote, { memo: st.note.memo, del: st.note.del, now: Date.now() });
        const local = res.renames.length + res.added.length + res.updated.length + res.removed.length;
        if (local) {
          applyNote(res);
          paintAll();
        }
        st.noteHash = bookHash(st.book);
        if (local) save();
        const out = blockHtml(res.page);
        if (!page) page = await createPage(nc, sectionId, out);
        else if (res.push || !block) await writeBlock(nc, page.pageId, out, block);
        const parts = [
          res.added.length ? `원노트에서 더함 ${res.added.length}` : '', res.updated.length ? `받아 고침 ${res.updated.length}` : '',
          res.removed.length ? `지움 ${res.removed.length}` : '', res.renames.length ? `같은 과제 묶음 ${res.renames.length}` : '',
          res.push || !block ? '원노트에 씀' : '',
        ].filter(Boolean);
        const msg = `맞췄습니다 — ${parts.join(' · ') || '달라진 것 없음'} (과제 ${res.projects.length}개)`;
        Object.assign(st.note, { pageId: page.pageId, webUrl: page.webUrl || st.note.webUrl, memo: res.memo, del: res.del, at: Date.now(), error: '', last: msg });
        logEvent('rnd', true, `R&D 원노트 맞춤(${reason}): ${parts.join(' · ') || '같음'}`);
        ok = true;
      } catch (err) {
        st.note.error = `원노트와 맞추지 못했습니다 — ${String(err?.message || err)}`;
        logEvent('rnd', false, `R&D 원노트 맞추기 실패(${reason}): ${String(err?.message || err)}`);
      } finally {
        st.noteBusy = false;
        st.noteRun = null;
        saveNote();
        paintNote();
      }
      if (st.noteAgain) {
        st.noteAgain = false;
        return noteSync('다시');
      }
      return ok;
    })();
    return st.noteRun;
  }

  /* ---------------------------------------------------------- 연구내용 원노트 공유 */

  // 2026-10-14 사용자 지정 — "workplace 에 기입한 것을 rerp 에 원노트 주소 링크만 공유하면 동기화". 연구개발계획서 YAML 을 넣을 때 rerp 와 같은 기록(rerp/research.js —
  // chrome.storage 의 researchPlans, 과제명#차년도)으로도 남기고, 원노트 칸의 "연구내용 올리기"가 보고 있는 과제의 기록들을 「[연구내용] 과제명」 페이지 한 장(rerp/researchsync.js —
  // 표 하나 + krxres1: base64 JSON)에 올린 뒤 링크(웹 링크 + 페이지 ID)를 복사한다. kr_ext_rerp 설정의 연구개발계획서 칸에 그 링크를 붙여 넣으면 받아 가고(rerp background.js researchPull),
  // 그 뒤로 여기서 계획서를 다시 넣으면 페이지를 저절로 고쳐 rerp 가 다음 받기 때 맞춘다. 섹션은 예상 비용과 같은 RERP(rerp/plussync.js plusResolveSection — 원노트 칸의 섹션 이름·노트북),
  // 그 섹션을 못 정하면(노트북을 골라야 함) 과제 정보 섹션. 올린 페이지는 chrome.storage 의 researchShare = { [과제명 키]: { pageId, webUrl, title, name, at } }.
  const RES_SHARE_KEY = 'researchShare';
  const resKey = (p) => RS.normName(p?.name);
  const codeKey = (s) => String(s || '').replace(/\s/g, '').toLowerCase();

  /** 이 과제의 연구개발계획서 기록들(차년도 차례) — 과제명이나 과제번호가 같은 것. */
  async function researchOf(p) {
    const map = await RS.load();
    const k = resKey(p), code = codeKey(p.code);
    return Object.values(map).filter((r) => r && (RS.normName(r.name) === k || (code && codeKey(r.code) === code))).sort((a, b) => a.n - b.n);
  }

  /** YAML 에서 읽은 기록들을 저장하고, 원노트에 올린 적이 있는 과제들을 돌려준다(다시 올릴 것). 더 오래된 판은 RS.put 이 건너뛴다. */
  async function storeResearch(recs) {
    const map = await RS.load();
    const touched = new Set();
    for (const rec of recs) if (RS.put(map, rec).state !== 'older') touched.add(RS.normName(rec.name));
    await RS.save(map);
    return st.book.projects.filter((p) => touched.has(resKey(p)) && st.resShare[resKey(p)]?.pageId);
  }

  /** 보고 있는 과제(또는 p)의 연구내용을 원노트에 올린다. auto 면(계획서를 다시 넣은 뒤) 링크를 복사하지 않는다. 던지지 않는다 — 까닭은 알림 줄에. */
  async function shareResearch(p, { auto = false } = {}) {
    if (!p || st.resBusy) return false;
    Object.assign(st, { resBusy: true, resError: false, resFor: resKey(p), resMsg: '원노트에 올리는 중…' });
    paintRes();
    let client = null, ok = false;
    try {
      const recs = await researchOf(p);
      if (!recs.length) throw new Error('이 과제의 연구개발계획서 기록이 없습니다 — 아래 연구개발계획서 YAML 넣기에 KR_<과제>.yaml 을 넣으세요(이 기능 전에 넣은 것은 다시 한 번)');
      const sec = await plus.plusResolveSection();
      const sectionId = sec?.ok ? sec.section.id : st.note.sectionId;
      if (!sectionId && !st.resShare[resKey(p)]?.pageId) {
        throw new Error(sec?.kind === 'notebook' ? `${sec.error} — 위 예상 비용 칸의 섹션 찾기/만들기에서 노트북을 고르거나 과제 정보 섹션을 고르세요` : (sec?.error || 'OneNote MCP 서버에 닿지 않습니다'));
      }
      client = await KRX_MCP.open(PLUS_DEFAULTS.onenoteMcpUrl, { clientName: 'krs-workspace', fetch: mcpFetch });
      const page = await RSY.publish({ client, onenote: KRX_ONENOTE, sectionId, page: st.resShare[resKey(p)] || null, name: p.name, code: p.code, recs, by: myName(), now: Date.now() });
      st.resShare[resKey(p)] = { pageId: page.pageId, webUrl: page.webUrl, title: page.title, name: p.name, at: Date.now() };
      await chrome.storage.local.set({ [RES_SHARE_KEY]: st.resShare });
      st.resMsg = `${page.created ? '만들었습니다' : '고쳤습니다'} — 「${page.title}」 · 차년도 ${recs.length}개`;
      if (!auto) st.resMsg += (await copyText(RSY.linkText(page))) ? ' · 링크를 복사했습니다 — kr_ext_rerp 확장 설정의 연구개발계획서 칸에 붙여 넣으세요' : ' · 링크 복사를 누르세요';
      logEvent('rnd', true, `R&D 연구내용 원노트 ${auto ? '다시 ' : ''}올림(${label(p)}): ${page.title} · 차년도 ${recs.length}개`);
      ok = true;
    } catch (err) {
      Object.assign(st, { resError: true, resMsg: `연구내용을 올리지 못했습니다 — ${String(err?.message || err)}` });
      logEvent('rnd', false, `R&D 연구내용 원노트 올리기 실패(${label(p)}): ${String(err?.message || err)}`);
    } finally {
      if (client) { try { await client.close(); } catch { /* 이미 닫힘 */ } }
      st.resBusy = false;
      paintRes();
    }
    return ok;
  }

  async function copyResLink() {
    const sh = cur() ? st.resShare[resKey(cur())] : null;
    if (!sh?.pageId) return;
    const ok = await copyText(RSY.linkText(sh));
    flash(el.resCopy, ok ? '복사함' : '못 복사함');
  }

  function paintRes() {
    const p = cur();
    const sh = p ? st.resShare[resKey(p)] : null;
    if (st.resFor !== resKey(p) && !st.resBusy) Object.assign(st, { resFor: resKey(p), resMsg: '', resError: false });   // 다른 과제로 가면 지난 알림은 지운다
    el.resShare.disabled = st.resBusy || !p;
    el.resShare.textContent = st.resBusy ? '올리는 중…' : sh ? '연구내용 다시 올리기' : '연구내용 올리기';
    el.resCopy.disabled = st.resBusy || !sh?.pageId;
    el.resOpen.classList.toggle('hidden', !sh?.webUrl);
    if (sh?.webUrl) el.resOpen.href = sh.webUrl;
    el.resMsg.textContent = st.resMsg || (sh ? `「${sh.title}」 · 올림 ${when(sh.at)} — 링크 복사로 rerp 에 보냅니다` : p ? '' : '과제를 고르세요');
    el.resMsg.classList.toggle('error', !!st.resError);
  }

  /* ---------------------------------------------------------- 그리기·배선 */

  function paintAll() {
    paintProjects();
    paintHead();
    paintItems();   // 장부에 새 비목이 들어왔을 수 있다(YAML·JSON 들이기) — 설정의 비목 체크도 맞춘다
    paintRes();     // 원노트 칸의 연구내용 공유는 보고 있는 과제의 것
    if (cur()) {
      paintBudget();
      paintErp();
      paintFiles();
      paintLogs();
      paintChanges();
    }
    // 과제 더하기·변경사항 카드(rndgen)는 보고 있는 과제·차년도·폼/덮개를 따라 그린다 — 과제가 없을 때도.
    notifyView();
  }

  function wire() {
    el.chKind.innerHTML = CHANGE_KINDS.map((k) => `<option value="${k}">${k}</option>`).join('');
    el.projects.addEventListener('click', (e) => {
      const b = e.target instanceof HTMLElement ? e.target.closest('[data-proj],[data-add]') : null;
      if (!b) return;
      // ＋ — 과제 더하기 카드(YAML 넣기 · 사업계획서에서 뽑기 · 직접 적기, rndgen — 2026-10-16). rndgen 이 없으면 새 과제 폼.
      if (b.dataset.add) openAdd({});
      else pickProject(b.dataset.proj);
    });
    el.emptyAdd.addEventListener('click', () => openAdd({}));
    // 빈 차년도 카드의 "사업계획서에서 이 차년도 뽑기" — 이 과제·차년도로 더하기 카드를 연다.
    el.yearEmpty.addEventListener('click', (e) => {
      const p = cur();
      if (p && e.target instanceof Element && e.target.closest('[data-rdg-extract]')) openAdd({ projectId: p.id, n: curYear(p) });
    });
    el.emptyImport.addEventListener('click', () => importGongmun());
    // 연필 아이콘은 과제 정보의 summary 안에 있다 — 누름이 접기/펴기로 번지지 않게 막는다.
    el.edit.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const p = cur(); if (p) openForm(p.id); });
    el.aliasSet.addEventListener('click', setAlias);
    el.aliasIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setAlias(); } });
    el.years.addEventListener('click', (e) => {
      const b = e.target instanceof HTMLElement ? e.target.closest('[data-year]') : null;
      if (b) pickYear(+b.dataset.year);
    });
    el.fSave.addEventListener('click', saveForm);
    el.fCancel.addEventListener('click', closeForm);
    el.fDel.addEventListener('click', delProject);
    // Job Id 저절로 찾기(과제 정보 카드) — 후보 고르기 · 이 번호로 저장 · 다시 찾기(목록도 새로 받는다).
    el.jobList.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest('[data-job]') : null;
      if (b) pickJob(+b.dataset.job);
    });
    el.jobSave.addEventListener('click', saveJob);
    el.jobRetry.addEventListener('click', () => { const p = cur(); if (p) { autoJob(p, true); paintHead(); } });
    // 회계 I/O 저절로 찾기(과제 정보 카드 — 2026-10-17) — 후보 고르기 · 이 코드로 저장 · 다시 찾기(목록도 새로 받는다) · 회계 예산 다시 조회(↻).
    el.ioList.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest('[data-io]') : null;
      if (b) pickIo(+b.dataset.io);
    });
    el.ioSave.addEventListener('click', saveIo);
    el.ioRetry.addEventListener('click', () => { const p = cur(); if (p) { autoIo(p, true); paintHead(); } });
    el.acctRefresh.addEventListener('click', () => { const p = cur(); if (p) acctAuto(p, true); });
    el.form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target instanceof HTMLElement && e.target.tagName === 'INPUT') {
        e.preventDefault();
        saveForm();
      }
      if (e.key === 'Escape') closeForm();
    });
    el.budget.addEventListener('input', onBudgetInput);
    el.budget.addEventListener('change', onBudgetChange);
    el.budget.addEventListener('click', onBudgetClick);
    el.logAdd.addEventListener('click', addLog);
    el.logCancel.addEventListener('click', () => { clearLogForm(); paintLogs(); });
    el.logTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLog(); } });
    el.logs.addEventListener('click', onLogsClick);
    el.chAdd.addEventListener('click', addChange);
    el.chCancel.addEventListener('click', () => { clearChangeForm(); paintChanges(); });
    el.chNew.addEventListener('click', () => { clearChangeForm(); showChangeForm(true); el.chItem.focus(); });
    el.changes.addEventListener('click', onChangesClick);
    el.changes.addEventListener('change', onReasonChange);
    el.copy.addEventListener('click', copySummary);
    el.budgetCopy.addEventListener('click', copyBudget);
    el.rosterCopy.addEventListener('click', () => copyFile(el.rosterCopy, 'roster', '참여연구자 표'));
    // 행정지원 — 사람 더하기, 줄의 이름·맡은 일(input)·공문 참조(change)·빼기(click).
    el.supportAdd.addEventListener('click', addSupport);
    el.support.addEventListener('input', onSupportInput);
    el.support.addEventListener('change', onSupportInput);
    el.support.addEventListener('click', onSupportClick);
    el.planCopy.addEventListener('click', () => copyFile(el.planCopy, 'plan', '연구개발 계획'));
    el.logsCopy.addEventListener('click', copyLogs);
    el.changesCopy.addEventListener('click', copyChanges);
    el.export.addEventListener('click', exportBook);
    el.import.addEventListener('change', () => {
      const file = el.import.files?.[0];
      el.import.value = '';
      importFile(file);
    });
    el.importGm.addEventListener('click', () => importGongmun());
    el.skillBox.addEventListener('toggle', () => { if (el.skillBox.open) loadManifest(); });
    // 예산 정보가 없는 차년도에서 저절로 편 R&D 설정을 사람이 접었으면 그것으로 끝 — 그 뒤 손으로 다시 편 것은 다른 차년도로 가도 접지 않는다.
    el.setBox.addEventListener('toggle', () => { if (!el.setBox.open) st.setAuto = false; });
    el.skillZip.addEventListener('click', saveSkillZip);
    el.skillGuide.addEventListener('click', copySkillGuide);
    el.yaml.addEventListener('change', () => {
      const files = [...(el.yaml.files || [])];
      el.yaml.value = '';
      intakeFiles(files);
    });
    for (const type of ['dragover', 'dragleave']) el.root.addEventListener(type, onDrag);
    el.root.addEventListener('drop', onDrop);
    // 더하기·변경사항 카드(rndgen)는 놓인 문서를 받아 전파를 멈춘다 — 그때도 YAML 넣기 칸의 "놓기" 표시는 거둔다(잡는 단계에서).
    el.root.addEventListener('drop', () => el.intake.classList.remove('over'), true);
    document.addEventListener('paste', onPaste);
    el.noteOn.addEventListener('change', onNoteToggle);
    el.noteSection.addEventListener('change', onNoteSection);
    el.noteSections.addEventListener('click', loadSections);
    // 지금 맞추기 — 과제 정보와 예상 비용 둘 다(켜진 것만).
    el.noteSync.addEventListener('click', () => {
      if (st.note.on && st.note.sectionId) noteSync('지금 맞추기');
      if (st.note.plus.on) plus.planSync('manual', {}).then(afterPlanSync);
    });
    el.plusOn.addEventListener('change', onPlusToggle);
    el.plusFind.addEventListener('click', findPlusSection);
    el.plusSection.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findPlusSection(); } });
    el.resShare.addEventListener('click', () => shareResearch(cur()));
    el.resCopy.addEventListener('click', copyResLink);
    el.erpRefresh.addEventListener('click', () => refreshErp({ force: true, reason: '↻' }));
    el.erpLink.addEventListener('click', () => linkErp({ manual: true }));
    el.erpUnlink.addEventListener('click', unlinkErp);
    el.erpPickOk.addEventListener('click', pickErp);
    el.erpSelect.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pickErp(); } });
    el.erpOn.addEventListener('change', onErpToggle);
    for (const node of [el.incUnbilled, el.incPlan]) node.addEventListener('change', onIncludeToggle);
    el.items.addEventListener('change', onItemsToggle);
  }

  async function show() {
    el.root.classList.remove('hidden');
    if (!st.loaded) {
      const saved = await chrome.storage.local.get([BOOK_KEY, GM_PROJECTS_KEY, NOTE_KEY, SET_KEY, RES_SHARE_KEY]);
      st.book = normalizeBook(saved?.[BOOK_KEY]);
      st.note = normalizeNote(saved?.[NOTE_KEY]);
      st.set = normalizeSet(saved?.[SET_KEY]);
      const share = saved?.[RES_SHARE_KEY];
      st.resShare = share && typeof share === 'object' && !Array.isArray(share) ? share : {};
      st.loaded = true;
      clearLogForm();
      clearChangeForm();
      // 처음 열었는데 과제가 없으면 공문 탭의 과제를 그대로 가져온다 — 다시 적을 까닭이 없다.
      if (!st.book.projects.length) {
        const inc = fromGongmun(saved?.[GM_PROJECTS_KEY]);
        if (inc.length) {
          st.book = mergeProjects(st.book, inc).book;
          setStatus(`공문 탭의 과제 ${st.book.projects.length}개를 가져왔습니다.`);
          logEvent('rnd', true, `공문 탭의 과제 가져옴(처음 열 때): ${st.book.projects.length}개`);
          save();
        }
      }
      // 예상 비용(rerp/plan.js 의 plannedExpenses — rerp 와 같은 저장 키)을 읽는다.
      st.pl.plans = await PLAN.load();
      st.pl.planWho = myName();
    }
    // 집행내역 표에 ＋·줄·폼·아이콘의 이벤트(rerp/plan.js bind)를 단다 — 이 패널이 표 요소를 가진 동안 한 번. 다른 패널 인스턴스(검사)가 같은 화면을 썼으면
    // 그 리스너가 남지 않게 요소를 새것으로 바꿔 끼우고 다시 단다.
    const host = $('rdErpTable');
    if (host && host !== st.plHost) {
      const fresh = host.cloneNode(false);
      host.replaceWith(fresh);
      el.erpTable = fresh;
      st.plHost = fresh;
      PLAN.bind(fresh, st.pl, drawErp);
    }
    paintPlus();
    paintAll();
    paintNote();
    // 원노트 공유가 켜져 있으면 열 때 맞춘다 — 다른 기기에서 고친 과제 정보를 받는다(막 맞췄으면 건너뛴다). 기다리지 않는다.
    if (st.note.on && st.note.sectionId && Date.now() - st.note.at > NOTE_OPEN_MS) noteSync('열 때');
    // rERP — 이어져 있으면 신선하지 않을 때 다시 받고, 아니면 올해 차년도를 이 세션에서 한 번 저절로 잇는다. 기다리지 않는다.
    erpAuto();
  }

  function hide() {
    el.root.classList.add('hidden');
  }

  return {
    wire, show, hide, book: () => st.book, skills: loadManifest, note: () => st.note, noteSync, erp: () => (cur() ? curBook(cur()).erp || null : null), plans: () => st.pl.plans, refreshErp, settings: () => st.set,
    // rndgen/(과제 더하기·변경사항 카드)의 손잡이 — 2026-10-16. 훅은 하나씩(마지막 등록이 이긴다).
    current: () => { const p = cur(); return p ? { project: p, n: curYear(p) } : null; },
    view,
    onView: (fn) => { viewHook = typeof fn === 'function' ? fn : null; },
    onAdd: (fn) => { addHook = typeof fn === 'function' ? fn : null; },
    onIntake: (fn) => { intakeHook = typeof fn === 'function' ? fn : null; },
    onDelete: (fn) => { deleteHook = typeof fn === 'function' ? fn : null; },
    setOverlay, addManually, pick, setAlias: setAliasOf,
    intake: (texts, opts) => intakeTexts(texts, opts),
    download, readAsset,
  };
}

/** 회계(e-accounting) — 내 부서 과제(I/O) 목록과 과제 하나의 계정과목별 예산 스냅샷(src/eacct.js — 확장에서 바로, host_permissions 로 쿠키가 실린다. 로그인은 e-accounting 자체 세션). */
const defaultAcct = {
  list: (year) => fetchIoList(year),
  get: (year, io, options) => fetchAcct(year, io, { options: options || null }),
};
/** 로그인하러 가는 곳 — 과제 정보 카드의 링크가 가리킨다(sidepanel.html 의 href 와 같다). */
export const EA_LOGIN_URL = EA_HOME;

/** R&D PMS 과제 목록(공문 창의 과제 찾기 팝업이 받는 것) — 확장에서 바로(쿠키가 실린다), 안 되면 eclass 탭을 거쳐(src/net.js). */
async function defaultJobs() {
  const { html } = await siteFetch(`${ORIGIN}${JOB_LIST_PATH}?${JOB_QUERY}`);
  return parseJobRows(html);
}

async function defaultCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 확장 안의 파일(rnd/skills.json · rnd/skills/…)을 읽는다 — 글로, 또는 바이트로. */
async function defaultReadAsset(path, as = 'text') {
  const res = await fetch(chrome.runtime.getURL(path));
  if (!res.ok) throw new Error(`${path} (${res.status})`);
  return as === 'bytes' ? new Uint8Array(await res.arrayBuffer()) : res.text();
}

/** 글이나 바이트를 파일로 내려받는다 — 확장의 downloads 권한으로, 없으면 링크를 눌러서. */
async function defaultDownload(data, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  try {
    if (chrome.downloads?.download) {
      await chrome.downloads.download({ url, filename, saveAs: true });
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
