// R&D 탭의 화면. 차년도 자르기·예산 셈·저절로 남는 변경이력·요약·가져오기·내보내기는 src/rnd.js 가 하고,
// 여기는 그것을 화면에 잇고 chrome.storage(rndBook)에 남긴다.
//
//   과제 칩(별칭) → 머리(별칭 한 줄 — 펴면 과제 정보) · 차년도 칩(오늘이 든 것에 "올해" — 예산 정보가 없는 차년도는 회색 점선)
//   → 예산(비목 줄) · 참여연구자 · 연구개발 계획 · 진행 기록 · 변경 및 이력 관리(위는 rndgen 의 YAML 고치기, 아래는 변경이력) → 요약 복사 · JSON 저장·불러오기 → R&D 설정(연구개발계획서 YAML 넣기 …)
//   예산 정보가 없는 차년도를 보고 있으면(2026-10-11 사용자 지정) 기록 칸들 대신 까닭 카드가 서고 R&D 설정이 저절로 펴진다 — 지난 차년도의 기록을 보이지 않는다.
//
// 공유 (SharePoint — R&D 설정 안의 카드)를 켜지 않으면 어디에도 올리지 않는다 — 이 브라우저에만 남는다. 켜면 과제마다 OneDrive 공유 폴더의 연차 파일과 맞춘다(2026-10-18 사용자 지정, 아래 "공유" 절).
// 공문 탭의 공문 설정 과제를 가져올 수 있다(처음 열 때 과제가 없으면 저절로).
// 예산 **계획**을 고치거나 비목을 빼면, 과제의 책임자·연구기간을 고치면 변경이력에 저절로 한 줄이 남고 사유만 사람이 적는다.
// 과제는 별칭으로 다룬다 — 폼에서 별칭은 필수이고 과제끼리 겹치지 않으며, 별칭이 없는 과제는 머리에 정하는 칸이 선다.

import {
  BOOK_KEY, MAX_PROJECTS, CHANGE_KINDS, BUDGET_ITEMS, normalizeBook, normalizeProject, projectOf, aliasOwner, viewYear, yearBook, yearsOf, currentYear, yearLabel, yearState,
  periodText, dot, todayStr, isYmd, comma, shortWon, budgetTotals, hasBudget, budgetChanges, projectChanges, newestFirst, newId,
  fromGongmun, mergeProjects, restoreBook, exportJson, exportName, importJson, summaryText, parseRoster, parseSections, fileLog, noteLogs,
  budgetTsv, entryText, logLines, changeLine, changeLines, thousand, amountOfThousand, refsText, normalizeSupport, SUPPORT_MAX,
} from './src/rnd.js';
import { SET_KEY, normalizeSet, includeNames, isHidden, nameKey, projectRecs, pickYearRec, candidates, linkOf, isLive, isFresh, fetchSnapshot, applySnapshot, erpExtras, erpHead, clock as erpClock } from './src/rnderp.js';
// kr_ext_rerp 에서 옮긴 것(rerp/ — 출처·갱신 규칙은 rerp/README.md): rERP 호출(erp), 예상 비용 저장소와 입력 처리(PLAN), 과제집행비율 표(budgetTable),
// 공유 (SharePoint) 배선(createShareSync — kr_ext_rerp background.js 의 shareSync; 2026-10-18 원노트·MCP 대신 브라우저 로그인 쿠키로 OneDrive 공유 폴더의 과제별 연차 파일), 예상 비용 묘비 되돌리기(KRX_PLAN_SYNC.putBack).
import ERP from './rerp/erp.js';
import PLAN from './rerp/plan.js';
import { budgetTable } from './rerp/planui.js';
import { createShareSync, SHARE_DEFAULTS } from './rerp/sharesync.js';
import KRX_PLAN_SYNC from './rerp/plansync.js';
// rERP 에 이은 뒤 공유 열쇠가 바뀐 과제의 폴더를 이어 쓰기(shareRekey — 옛 폴더의 파일 project.prjNo 를 새 열쇠로): 저장소(KRX_SP — 검사에서는 가짜 store)와 문서 모양(KRX_PRJDOC).
import KRX_SP from './rerp/spstore.js';
import KRX_PRJDOC from './rerp/prjdoc.js';
// 연구내용 기록(2026-10-14) — rerp 의 연구개발계획서 기록(research). 2026-10-18 부터 원노트 페이지가 아니라 연차 파일의 research 칸으로 간다.
import RS from './rerp/research.js';
// 장부 ↔ 연차 파일 변환(2026-10-18): 공유 설정(rndShare)·연차 파일 project 칸·받은 것을 장부에 들이기·차년도 변환·과제 맞추기.
import {
  SHARE_KEY, normalizeShare, shareKeyOf, projectOf as shareProjectOf, localProjectOf, localPlanOf, yearOf as shareYearOf, researchOf as shareResearchOf, planOfResearch, budgetHash as shareBudgetHashOf,
  applyProject as shareApplyProject, applyYear as shareApplyYear, matchProject as shareMatchProject, PEOPLE_KEY, normalizePeople, permRows,
  normalizePlus, plusOf, plusSet, plusWant,   // 공유 (Plus) 설정 — rERP 확장을 따르고 여기서 바꾼 칸만 이긴다(2026-10-25)
} from './src/rndshare.js';
import { PROJECTS_KEY as GM_PROJECTS_KEY } from './src/gongmun.js';
import { JOB_LIST_PATH, JOB_QUERY, parseJobRows, rankJobs, jobLine } from './src/jobid.js';
import { fetchIoList, fetchAcct, rankIo, ioLine, acctFresh, fiscalYearOf, EA_HOME } from './src/eacct.js';
import { siteFetch } from './src/net.js';
import { ORIGIN } from './src/config.js';
import { kindOf, applyYaml, KIND_ORDER, revOf, readSnapshot } from './src/rndyaml.js';
// 참여인력 칸(2026-10-18 사용자 지정 — 참여연구원 계산은 kr_ext_rerp 의 사업비 변경 메뉴로 넘기고 여기서는 rERP 에 등록된 값을 보이기만): 이어진 rERP 과제의 참여인력·다른 과제 참여율 조회는 src/rnderp.js,
// 사람 모양·형편(연간/월 최대 참여율)·100% 초과 알림·탭 표는 kr_ext_rerp 에서 옮긴 rerp/staff.js.
import { ERP_TTL_MS, fetchParticipants, fetchOthers } from './src/rnderp.js';
import { monthLabel, ymText, spanText, rateText, personStats, checks, mergeOthers, peopleOfErp, staffTsv } from './rerp/staff.js';   // spanText: personStats 의 from·to 는 0.8.7 부터 날짜('YYYY-MM-DD') — 달 글은 spanText 로(2026-10-19 다시 옮김)
import { MANIFEST_PATH, checkManifest, skillGuide, bundleSkills, zipName, kb } from './src/rndskills.js';

const SAVE_WAIT_MS = 400;
/** 예산 정보가 없는 차년도 칩의 풍선말·상태 줄·까닭 카드(2026-10-11 사용자 지정) — 칩은 회색 점선이고, 누르면 넘어가되 기록 칸 대신 R&D 설정이 선다. */
const NO_BUDGET = '예산 정보가 들어 있지 않습니다';
/** 지우기 버튼은 두 번 누른다 — 처음 누르면 이만큼 동안 "정말 지우기" 로 바뀌고, 그 안에 다시 누르면 지운다. */
const CONFIRM_MS = 3000;
/** 공유 (SharePoint)가 켜져 있으면 장부를 고친 뒤 이만큼 기다렸다 맞춘다(그 사이 더 고치면 모아서 한 번). 탭을 열 때는 sharesync 의 load 규칙(1분 안 재실행 안 함)을 따른다. */
const NOTE_WAIT_MS = 1200;
/** 복사 아이콘(sidepanel.html 의 것과 같다) — 누르면 잠깐 체크(못 했으면 ×)로 바뀌었다 돌아온다. */
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>';
const DONE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>';
const FAIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
const copyBtn = (attr, what) => `<button type="button" class="rd-icon" ${attr} title="${what} 복사" aria-label="${what} 복사">${COPY_ICON}</button>`;

/**
 * @param {{$:Function, escapeHtml:Function, logEvent:Function, copyText?:(text:string) => Promise<boolean>,
 *   flash?:(btn:HTMLElement, text:string, ms?:number) => void, download?:(data:string|Uint8Array, filename:string, type?:string) => Promise<void>,
 *   readAsset?:(path:string, as?:'text'|'bytes') => Promise<string|Uint8Array>, today?:() => string,
 *   spFetch?:typeof fetch, store?:object}} deps
 *   readAsset 은 확장 안의 파일(rnd/skills.json · rnd/skills/…)을 읽는 길, today 는 검사에서 날짜를 못 박는 데 쓴다,
 *   erp 는 rERP 를 부르는 것(rerp/erp.js — 검사에서는 흉내), me 는 내 이름(설정 — 책임자 판정·변경이력의 by·공유 파일의 updatedBy),
 *   spFetch 는 공유 (SharePoint)가 OneDrive 를 읽을 fetch(브라우저 로그인 쿠키 — 검사에서는 흉내, 없으면 전역), store 는 SharePoint 저장소 흉내(검사에서만 — 실 SharePoint 에 쓰지 않게; 없으면 rerp/sharesync.js 가 rerp/spstore.js 로),
 *   jobs 는 과제 정보 카드의 Job Id 저절로 찾기가 받는 R&D PMS 과제 목록(줄 배열 — 검사에서는 흉내),
 *   acct 는 회계(e-accounting — src/eacct.js)를 부르는 것 { list(year) → 내 부서 과제(I/O) 목록, get(year, io, options) → 그 과제의 회계 예산 스냅샷 } (검사에서는 흉내),
 *   openPlus 는 설정 › Plus(공유 카드 — 2026-10-25 R&D 설정에서 옮김)를 여는 것(sidepanel.js — 없으면 아무것도 안 함)
 */
export function createRndPanel({ $, escapeHtml, logEvent, copyText = defaultCopy, flash = () => {}, download = defaultDownload, readAsset = defaultReadAsset, today = todayStr, erp = ERP, me = () => '', spFetch = defaultSpFetch, store = undefined, jobs = defaultJobs, acct = defaultAcct, openPlus = () => {} }) {
  const el = {
    root: $('rnd'), projects: $('rdProjects'), empty: $('rdEmpty'), emptyImport: $('rdEmptyImport'), emptyAdd: $('rdEmptyAdd'),
    intake: $('rdIntake'), yaml: $('rdYaml'),
    head: $('rdHead'), info: $('rdInfo'), name: $('rdName'), edit: $('rdEdit'), headYear: $('rdHeadYear'), headLink: $('rdHeadLink'), headSet: $('rdHeadSet'), meta: $('rdMeta'), years: $('rdYears'), yearNote: $('rdYearNote'),
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
    // 참여인력(rERP 근거 표시 — 2026-10-18): 머리 줄의 ↻(이어진 rERP 과제의 참여인력 다시 받기), 표 아래 받는 중·실패 줄.
    staffRefresh: $('rdStaffRefresh'), staffMonths: $('rdStaffMonths'), staffMsg: $('rdStaffMsg'),
    // 공유 권한(2026-10-19 "체크하면 반영"): 머리 줄의 공유 아이콘(staffShare — 누르면 펴고 접음), 표 위의 칸(perm — 폴더 이름 · ↻ · 사람마다 읽기/편집 체크 · 알림 줄).
    staffShare: $('rdStaffShare'), perm: $('rdStaffPerm'), permFolder: $('rdStaffPermFolder'), permRefresh: $('rdStaffPermRefresh'), permBody: $('rdStaffPermBody'), permMsg: $('rdStaffPermMsg'),
    planState: $('rdPlanState'), plan: $('rdPlan'), planTools: $('rdPlanTools'), planSrc: $('rdPlanSrc'), planCopy: $('rdPlanCopy'),
    logState: $('rdLogState'), logDate: $('rdLogDate'), logTitle: $('rdLogTitle'), logText: $('rdLogText'), logAdd: $('rdLogAdd'), logCancel: $('rdLogCancel'), logs: $('rdLogs'), logsCopy: $('rdLogsCopy'),
    changeState: $('rdChangeState'), chDate: $('rdChDate'), chKind: $('rdChKind'), chItem: $('rdChItem'), chBefore: $('rdChBefore'), chAfter: $('rdChAfter'),
    chReason: $('rdChReason'), chAdd: $('rdChAdd'), chCancel: $('rdChCancel'), chNew: $('rdChNew'), chForm: $('rdChForm'), changes: $('rdChanges'), changesCopy: $('rdChangesCopy'),
    copy: $('rdCopy'), export: $('rdExport'), import: $('rdImport'), importGm: $('rdImportGm'),
    skillBox: $('rdSkillBox'), skillState: $('rdSkillState'), skills: $('rdSkills'), skillZip: $('rdSkillZip'), skillGuide: $('rdSkillGuide'),
    // 공유 (SharePoint, 2026-10-18) — 2026-10-25 부터 설정 › Plus 갈래(sidepanel.html #setPlus — kr_ext_rerp 의 공유 (Plus) 탭과 같은 짜임): 공유 사용 · 공유 폴더 칸(비우면 rERP 확장의 설정) · 연결 확인 · 폴더 열기 · 주소 복사 · 조직 내 링크 ·
    // 자동 공유 · 자동 찾기 · 과제별 공유(켜기 · 공유할 과제 · 항목) · 동기화 현황(상태 · 알림 줄 · 과제 줄 · 지금 동기화). R&D 설정에는 그리로 가는 한 줄(shareGo)만.
    shareState: $('rdShareState'), shareOn: $('rdShareOn'), shareFolder: $('rdShareFolder'), shareWith: $('rdShareWith'), shareSync: $('rdShareSync'), shareOpen: $('rdShareOpen'), shareLink: $('rdShareLink'), shareMsg: $('rdShareMsg'),
    shareGo: $('rdShareGo'), shareGoState: $('rdShareGoState'),
    plusFollow: $('plusFollow'), plusFollowReset: $('plusFollowReset'), plusFolderNow: $('plusFolderNow'), plusProbe: $('plusProbe'), plusProbeState: $('plusProbeState'), plusCopy: $('plusCopy'),
    plusDiscover: $('plusDiscover'), plusProjectSync: $('plusProjectSync'), plusSummary: $('plusSummary'), plusScopeAll: $('plusScopeAll'), plusScopePick: $('plusScopePick'), plusPick: $('plusPrjPick'), plusPages: $('plusPages'),
    plusItems: { planSync: $('plusPlanSync'), researchSync: $('plusResearchSync'), staffSync: $('plusStaffSync'), changesSync: $('plusChangesSync') },
    // rERP 집행내역(예산 칸 아래, 접힌 한 줄 — erpState 가 그 줄의 형편) — 2026-10-11. 예상 비용은 공유가 켜져 있으면 과제 폴더의 예상비용.json 에서 받아 표에 보인다(보기만).
    erp: $('rdErp'), erpState: $('rdErpState'), erpInfo: $('rdErpInfo'), erpRefresh: $('rdErpRefresh'), erpLink: $('rdErpLink'), erpUnlink: $('rdErpUnlink'),
    erpPick: $('rdErpPick'), erpSelect: $('rdErpSelect'), erpPickOk: $('rdErpPickOk'), erpMsg: $('rdErpMsg'), erpTable: $('rdErpTable'),
    // 예산 칸 맨 위 줄 — 집행에 더할 것(미청구·사용계획 — 승인전 체크는 2026-10-11 사용자 지정으로 뺐다). 2026-10-11 사용자 지정으로 R&D 설정에서 옮겼다(값은 여전히 rndSettings).
    incRow: $('rdIncRow'), incUnbilled: $('rdIncUnbilled'), incPlan: $('rdIncPlan'),
    // R&D 설정(접힌 한 줄) — rERP 집행내역 켜기/끄기 · 예산 칸에 보일 비목(items — 2026-10-11 사용자 지정). 설정 › Plus 로 가는 줄·YAML 넣기·스킬 칸도 이 안에 있다.
    setBox: $('rdSetBox'), setState: $('rdSetState'), erpOn: $('rdErpOn'), itemBox: $('rdItemBox'), items: $('rdItems'),
  };
  const st = {
    loaded: false, book: normalizeBook(null), research: {},
    // editing 은 고치는 중인 과제 id('new' 는 새 과제). snap 은 그린 시점의 예산 줄 — 계획이 바뀌었는지 이것과 견준다.
    // overlay 는 머리·몸통을 덮는 카드({ name, close } — rndgen 의 과제 더하기 'add', 2026-10-16). 폼·덮개가 열려 있으면 과제 칩은 어느 것도 켜지지 않는다(＋ 칩은 2026-10-19 에 없앴다 — 대상은 그 카드의 배지에서).
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
    // 참여인력(rERP 근거 표시 — 2026-10-18): staffRun·staffBusy 는 도는 중인 rERP 참여인력 조회, staffTried 는 이 세션에서 저절로 받아 본 과제:차년도(한 번만 — ↻ 는 언제든), staffMsgFor 는 알림 줄이 어느 과제:차년도의 것인가.
    staffTried: new Set(), staffRun: null, staffBusy: false, staffMsgFor: '',
    // 공유 권한(2026-10-19): open 은 펴 둔 과제:차년도(staffKey — 다른 데로 가면 접힘), busy 는 권한 읽기·사람 찾기 중, cfg·folder·owner 는 그 과제 폴더(shareIndex 의 항목 — owner 면 남의 폴더), perms 는 읽은 권한(rerp/spstore.js permissions),
    // lookup 은 이 세션의 사람 찾기 결과(이름 → { ambiguous } | { notFound } | { error }), row 는 반영 중인 사람 이름, run 은 도는 중인 반영. permPeople 은 이름 → 이메일 캐시(rndSharePeople — src/rndshare.js normalizePeople).
    perm: { open: '', busy: false, cfg: null, folder: '', owner: '', perms: null, lookup: {}, row: '', run: null }, permPeople: normalizePeople(null),
    // 예산 정보가 없는 차년도를 보는 중이면 그 과제:차년도(emptyKey) — 들어올 때 R&D 설정을 저절로 폈으면(setAuto) 나갈 때 도로 접는다(2026-10-11 사용자 지정).
    emptyKey: '', setAuto: false,
    // 스킬 목록(rnd/skills.json)은 그 칸을 처음 펼 때 읽는다. 못 읽었으면 까닭을 둔다.
    manifest: null, manifestError: '',
    // 공유 (SharePoint) — 저장해 두는 형편(rndShare: on·folder·at·memo(과제·차년도마다 마지막으로 맞춘 시각·지문 — 병합 기준)·last·error), 마지막으로 맞춘 장부의 지문(shareHash — 고친 것이 있는지),
    // 연구내용 기록처럼 지문 밖에서 바뀐 것(shareDirty), 도는 중인가(shareBusy), 받은 것을 장부에 들이는 중인가(shareApplying — 그동안 되돌이 동기화를 막는다), 마지막 결과(shareState = planSyncState — 과제별 폴더·주소),
    // 마지막 실패의 종류(shareKind — 'auth' 면 로그인 안내), 링크 복사 같은 잠깐의 알림(shareNote).
    share: normalizeShare(null), shareHash: '', shareDirty: false, shareBusy: false, shareApplying: false, shareState: null, shareKind: '', shareNote: null,
    // 처음 받는 과제에서 빈 값으로 덮지 않고 둔 WORKSPACE 몫 칸이 있으면(shareRepush) 맞춘 뒤 한 번 더 돌아 그 값을 파일에 올린다 · 장부에 없는 열쇠로 project 칸보다 먼저 온 별칭(shareAliasWait — project 칸이 오면 함께 넣는다).
    shareRepush: false, shareAliasWait: {},
    // 공유 폴더에서 장부로 더하는 과제(2026-10-19 "sharepoint 의 변경사항을 반영하지 않네?"): 이번 맞춤의 대상에 더한 열쇠(shareAdopting — shareContextForSync), 이번에 만든 수(shareAdopted), 못 더한 까닭(shareAdoptNote — 결과 줄),
    // 더할 과제의 rERP 과제명·책임자(shareAdoptInfo), 그 파일에서 받아 둔 칸(shareAdoptWait — project 칸이 오면(deletedAt 이면 버림) 또는 맞춤이 끝날 때 장부에 만들며 넣는다, shareAdoptCreate · shareAdoptFlush).
    shareAdopting: [], shareAdopted: 0, shareAdoptNote: '', shareAdoptInfo: {}, shareAdoptWait: {},
    // R&D 설정(chrome.storage 의 rndSettings, src/rnderp.js normalizeSet) — erp: rERP 집행내역을 보이는가 · unbilled/plan: 집행에 미청구·사용계획을 더하는가(승인전은 더하지 않는다 — 2026-10-11 사용자 지정)
    // · hide: 예산 칸에서 숨긴 비목 이름들(줄만 숨고 합계에는 든다 — 2026-10-11 사용자 지정).
    set: normalizeSet(null),
    // rERP 집행내역 — 도는 중인 조회, 이 세션에서 저절로 잇기를 해 본 차년도, 마지막으로 받은 과제 목록(고르기용), 이벤트를 달았는지.
    erpRun: null, erpTried: new Set(), erpRecs: null, erpRecsAt: 0, erpRecsErrAt: 0, erpBusy: false, plHost: null,   // erpRecsAt·erpRecsErrAt: 과제 목록을 받은(못 받은) 시각 — 공유 폴더의 과제 더하기가 10분(ERP_TTL_MS) 캐시로 쓴다
    // 예상 비용의 화면 상태 — rerp/plan.js(bind)와 rerp/planui.js(budgetTable)가 rerp 의 패널 state 와 같은 모양으로 읽고 쓴다.
    // data.settings.planSync 는 공유 (SharePoint)가 켜져 있고 예상 비용을 받는지(예상비용.json), sharePick 은 고른 과제만 공유할 때 그 열쇠들(rerp/plan.js plusOn — 고르지 않은 과제는 꺼진 것으로),
    // data.myNames 는 책임자 판정(과제책임자 == 내 이름)에 쓴다.
    pl: { plans: {}, planShown: new Set(), expanded: new Set(), data: { settings: { planSync: false }, myNames: [] } },
  };

  // rndgen/(과제 더하기·변경사항 카드 — sidepanel.js 가 잇는다)의 훅 — 하나씩(마지막 등록이 이긴다). 없으면 과제 더하기는 새 과제 폼이고 넣기·지우기 뒤에 할 일이 없다.
  //   viewHook(view())            : 그릴 때마다(paintAll·폼 열기) — 보고 있는 과제·차년도·폼/덮개
  //   addHook({ projectId, n })   : 머리 줄의 차년도 아이콘 · 과제 없음 카드의 과제 더하기 · 빈 차년도 카드의 "사업계획서에서 이 차년도 뽑기"(칩 줄의 ＋ 는 2026-10-19 사용자 지정 "sscb 옆에 더하기 취소하고" 로 없앰)
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
  /** 변경이력 줄에 적은 시각·적은 사람(공유 — 연차 파일의 changes 칸과 같은 칸, 2026-10-18)을 찍는다. */
  const stampChanges = (list) => list.map((c) => ({ ...c, at: Date.now(), by: String(me() || '').trim() }));

  function setStatus(msg, kind = '') {
    el.status.className = `status ${kind}`;
    el.status.textContent = msg;
  }

  /* ---------------------------------------------------------- 저장 */

  let timer = null;
  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => chrome.storage.local.set({ [BOOK_KEY]: st.book }), SAVE_WAIT_MS);
    shareSoon();
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
    // 새 과제 폼·덮개(과제 더하기 카드)가 열려 있으면 과제 칩은 모두 꺼진다. 고치기 폼은 고치는 과제의 칩이 켜진 채다(2026-10-16 사용자 지정
    // "어떤 과제인지 선택이 안되잖아" — 전에는 꺼져 어느 과제를 고치는지 보이지 않았다). 켜진 칩을 눌러도 폼·덮개를 닫고 그 과제로 간다(pickProject).
    // 칩 줄 끝의 ＋ 칩은 2026-10-19 사용자 지정("sscb 옆에 더하기 취소하고, 과제 더하기 옆에 과제 뱃지를 선택할 수 있게")으로 없앴다 — 더하기 카드는 머리 줄의 차년도 아이콘으로 열고 대상은 그 카드의 배지에서.
    const covered = st.editing != null || !!st.overlay;
    const onId = st.editing != null && st.editing !== 'new' ? st.editing : (covered ? null : p?.id);
    const chips = st.book.projects.map((x) => {
      const on = !!onId && x.id === onId;
      return `<button type="button" class="rd-proj${on ? ' active' : ''}" data-proj="${x.id}" aria-pressed="${on}" title="${escapeHtml(x.name)}${x.code ? ` · ${escapeHtml(x.code)}` : ''}">${escapeHtml(label(x))}</button>`;
    });
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
    p.aliasAt = Date.now();   // 공유의 병합 기준 — 늦게 바꾼 쪽이 이긴다(2026-10-18)
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

  /** 과제 없음 카드의 과제 더하기 · 빈 차년도 카드의 단추 · 머리 줄의 차년도 아이콘(＋ 칩은 2026-10-19 에 없앰) — rndgen 이 있으면 더하기 카드(target: {} · { projectId, n } · { projectId } — 차년도·대상 과제는 카드 안에서), 없으면 새 과제 폼. */
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
    p.aliasAt = Date.now();
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
      draft.aliasAt = Date.now();
      st.book.projects.push(draft);
      st.book.current.project = draft.id;
      logEvent('rnd', true, `R&D 과제 더함: ${draft.name}`);
      setStatus(`과제를 더했습니다 — ${label(draft)}`);
    } else {
      const p = projectOf(st.book, st.editing);
      if (!p) return closeForm();
      const changes = stampChanges(projectChanges(p, draft, today()));
      // 회계 I/O 를 고치면 전 과제의 회계 예산 스냅샷은 버린다 — 새 코드로 다시 받는다(acctAuto).
      if (draft.io !== p.io) {
        delete p.acct;
        st.acctRun = { ...st.acctRun, for: '', msg: '', bad: false, login: false };
      }
      // 별칭이 바뀌었으면 그 시각도 — 공유의 병합 기준(2026-10-18).
      if (draft.alias !== p.alias) p.aliasAt = Date.now();
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
    shareTomb(p);   // 공유 — 묘비를 남겨 다른 기기도 지우게(파일 project.deletedAt)
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
    const changes = stampChanges(budgetChanges(st.snap, b.budget, today()));
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

  /**
   * 보고 있는 차년도의 연구개발 계획 — 장부의 계획서 글(key 'plan')이 먼저, 없으면 연구내용 기록(researchPlans — 공유 폴더 연차 파일의 research 칸에서 받은 것 포함)의
   * 이 과제(과제명·과제번호)·이 차년도 것을 같은 ■ 절 글로(2026-10-27 — 공유 폴더에만 계획서가 있는 과제가 "아직 없습니다"로 보였다). shared 는 쓴 기록(없으면 null).
   */
  function planNow(p) {
    const own = fileLog(curBook(p), 'plan');
    if (own) return { log: own, shared: null };
    const recs = Object.values(shareResearchOf(st.research, p, '', curYear(p))).sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
    for (const rec of recs) { const log = planOfResearch(rec); if (log) return { log, shared: rec }; }
    return { log: null, shared: null };
  }

  /** 계획서(YAML)에서 온 두 줄을 저마다의 칸에 — 참여연구자는 표, 계획은 절 제목과 목록. 없으면 넣는 곳을 짚어 준다. */
  function paintFiles() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    const src = `연구개발계획서${b.snapshot?.rev ? ` ${b.snapshot.rev}` : ''} 기준`;
    const none = (what) => `<p class="rd-hint">아직 없습니다 — 맨 아래 칸에 연구개발계획서 YAML(KR_&lt;과제&gt;.yaml)을 넣으면 이 차년도의 ${what} 섭니다.</p>`;

    // 참여연구자 — rERP 에 이어진 차년도면 rERP 참여인력(지급계획)의 표, 아니면 계획서 글의 표(paintStaff — 보이기만, 2026-10-18).
    paintStaff();
    paintSupport();

    const { log: plan, shared } = planNow(p);
    const secs = plan ? parseSections(plan.text) : null;
    const goals = secs?.find((s) => s.title === '개발목표')?.items.length || 0;
    const months = secs?.find((s) => s.title === '수행일정')?.note || '';
    el.plan.innerHTML = plan ? (secs ? sectionsHtml(secs) : `<p class="rd-text">${escapeHtml(plan.text)}</p>`) : none('연구개발 계획이');
    el.planState.textContent = !plan ? '계획서 없음' : [goals ? `목표 ${goals}개` : '', months].filter(Boolean).join(' · ') || '있음';
    el.planSrc.textContent = !plan ? '' : shared ? `공유 폴더 연구내용${shared.rev ? ` ${shared.rev}` : ''} 기준` : src;
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
    p.supportAt = Date.now();   // 공유의 병합 기준 — 연차 파일의 supportAt 과 늦은 쪽(2026-10-19)
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
    p.supportAt = Date.now();
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

  /* ---------------------------------------------------------- 참여연구자(rERP 근거 표시 — 2026-10-18 사용자 지정) */

  // 참여연구원의 참여율·지급액 계산(월별 나누기·적용월부터 변경·초기화·예산 상한)은 kr_ext_rerp 의 **사업비 변경** 메뉴로 넘겼다(2026-10-18 사용자 지정: "참여연구원 계산하는거 관련해서는 kr_ext_rerp 로 넘기고,
  // 거기는 참여연구원 참여율/지급액 관리만 rerp 근거로 표시"). 여기서는 이 차년도에 이어진 rERP 과제(예산 칸의 rERP 집행내역)의 참여인력(지급계획)을 받아 **보이기만** 한다 —
  // 표(성명·역할·월급여·참여·지급 합·참여율)·사람 아래 달마다의 지급(머리 줄의 M 으로 펴고 접음 — 기본 접힘, 2026-10-19)·연간/월 최대 참여율·100% 초과 알림. 받은 것은 잇기의 staff(src/rnderp.js normalizeErp — rerp/staff.js 의 사람 모양)에 남고,
  // 집행내역처럼 오늘이 든 차년도만 10분(ERP_TTL_MS)이 지나면 이 세션에서 한 번 저절로 다시 받는다(↻ 는 바로). 이어지지 않은 차년도는 계획서의 참여연구자 표(parseRoster)를 그대로 보인다.
  const MENU_HINT = 'KR eClass + R&D ERP 현황 확장(kr_ext_rerp)의 <b>사업비 변경</b> 메뉴에서 합니다';
  const staffKey = (p) => `${p.id}:${curYear(p)}`;
  const staffOf = (p) => curBook(p).erp?.staff || null;
  const staffFresh = (staff, now = Date.now()) => !!(staff?.at && now - staff.at < ERP_TTL_MS);
  /** 알림 줄(받는 중·실패) — 보고 있는 과제:차년도의 것(staffMsgFor). 다른 과제·차년도로 가면 paintStaff 가 지운다. */
  const setStaffMsg = (msg, error = false) => { st.staffMsgFor = cur() ? staffKey(cur()) : ''; el.staffMsg.textContent = msg; el.staffMsg.classList.toggle('error', !!error); el.staffMsg.classList.toggle('hidden', !msg); };

  function paintStaff() {
    const p = cur();
    if (!p) return;
    const b = curBook(p);
    const e = b.erp || null;
    const staff = e?.staff || null;
    const roster = fileLog(b, 'roster');
    const people = roster ? parseRoster(roster.text) : null;
    const src = `연구개발계획서${b.snapshot?.rev ? ` ${b.snapshot.rev}` : ''} 기준`;
    const rosterBody = roster ? (people ? rosterHtml(people) : `<p class="rd-text">${escapeHtml(roster.text)}</p>`)
      : '<p class="rd-hint">아직 없습니다 — 맨 아래 칸에 연구개발계획서 YAML(KR_&lt;과제&gt;.yaml)을 넣으면 이 차년도의 참여연구자가 섭니다.</p>';
    if (st.staffMsgFor !== staffKey(p)) setStaffMsg('');
    el.rosterSrc.textContent = staff ? `rERP ${e.prjNo} · ${erpClock(staff.at)} 조회` : roster ? src : '';
    el.staffRefresh.classList.toggle('hidden', !e || !st.set.erp);
    el.staffRefresh.disabled = st.staffBusy;
    el.staffRefresh.classList.toggle('busy', st.staffBusy);
    el.rosterCopy.classList.toggle('hidden', !staff && !roster);
    el.rosterTools.classList.toggle('hidden', !staff && !roster && !(e && st.set.erp));
    // 공유 권한 칸 — 다른 과제·차년도로 가면 펴 둔 것을 접는다(폴더·사람이 다르다). 아이콘은 늘(꺼져 있으면 누르면 공유 카드로).
    if (st.perm.open && st.perm.open !== staffKey(p)) closePerm();
    paintPerm();
    let warns = [];
    if (staff) {
      // 100% 초과만 — 같은 사람의 어느 달 참여율 합(이 과제 + rERP 가 아는 다른 과제)이 100 을 넘으면 알림(막지 않는다). 월급여·예산 알림은 rerp 의 사업비 변경 메뉴 몫이라 적지 않는다.
      warns = checks(staff, 'rerp', { others: mergeOthers({}, staff) }).filter((w) => w.kind === 'over');
      el.roster.innerHTML = staffHtml(staff, warns);
    } else if (e) {
      el.roster.innerHTML = rosterBody + `<p class="rd-hint">${st.staffBusy ? `rERP ${escapeHtml(e.prjNo)} 참여인력을 받는 중…` : `rERP ${escapeHtml(e.prjNo)} 참여인력에 지급계획이 없습니다 — 참여율·지급액의 계획과 변경은 ${MENU_HINT}.`}</p>`;
    } else {
      el.roster.innerHTML = rosterBody + `<p class="rd-hint">rERP 에 이어지지 않은 차년도라 계획서의 참여연구자를 보이기만 합니다(예산 칸의 rERP 집행내역에서 이으면 rERP 참여인력의 지급계획이 보입니다). 참여율·지급액의 계획과 변경은 ${MENU_HINT}.</p>`;
    }
    // M — 달마다의 지급 줄이 있는 표(rERP 참여인력)에서만 서고, 접힘·펼침은 설정(months)을 따른다.
    el.staffMonths.classList.toggle('hidden', !el.roster.querySelector('.rd-staff-months'));
    paintMonths();
    st.rosterText = staff ? `연구자 ${staff.people.length}명${warns.length ? ` · 100% 초과 ${warns.length}` : ''}` : !roster ? '계획서 없음' : people ? `연구자 ${people.length}명` : '있음';
    paintSupportState();
    if (e) staffAuto(p);
  }

  /** 달마다의 지급 줄 펴기/접기 — 머리 줄의 M(2026-10-19 사용자 지정 "상단에 M 을 누르면 월별로 보였다가 접어졌다가"). 줄은 표에 그대로 두고 #rdRoster 의 rd-months 로 보이고 숨긴다(복사·검사는 그대로). 기본 접힘, 누른 상태는 rndSettings.months 에 남는다. */
  function paintMonths() {
    const on = !!st.set.months;
    el.roster.classList.toggle('rd-months', on);
    el.staffMonths.classList.toggle('on', on);
    el.staffMonths.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.staffMonths.setAttribute('aria-label', on ? '달마다의 지급 접기' : '달마다의 지급 보이기');
  }
  function onMonthsToggle() {
    st.set.months = !st.set.months;
    saveSet();
    paintMonths();
  }

  /** 표(읽기만) — 성명 · 역할 · 월급여(천원) · 참여(달·개월) · 지급 합(천원) · 참여율(연간, 아래에 월 최대 — 같아도 늘) ; 사람 아래 달마다의 지급 줄(0원 달은 —, M 으로 펴고 접음) ; 표 아래 100% 초과 알림. */
  function staffHtml(staff, warns) {
    const rows = staff.people.map((q) => {
      const s = personStats(q, 'rerp');
      let prev = '';
      const strip = s.planned ? `<tr class="rd-staff-months"><td colspan="6">${s.rates.map((r) => {
        const lab = monthLabel(r.ym, prev);
        prev = r.ym;
        const cls = r.amt > 0 ? (s.maxRate != null && s.maxRate !== s.rate && r.ym === s.maxYm ? ' max' : '') : ' off';
        const tip = r.amt > 0 ? `${r.ym} · ${thousand(r.amt)}천원${r.rate != null ? ` · ${rateText(r.rate)}` : ''}` : `${r.ym} · 지급 없음`;
        return `<span class="rd-mo${cls}" title="${escapeHtml(tip)}">${escapeHtml(lab)} <b>${r.amt > 0 ? thousand(r.amt) : '—'}</b></span>`;
      }).join('')}</td></tr>` : '';
      return `<tr class="rd-staff-row">`
        + `<td class="rd-td-name">${escapeHtml(q.name)}</td><td class="rd-td-role">${escapeHtml(q.role)}</td>`
        + `<td class="rd-td-limit" title="rERP 참여인력의 지급한도액(월급여 · 천원)">${s.limit ? thousand(s.limit) : '—'}</td>`
        + `<td class="rd-td-months">${s.from ? `${escapeHtml(spanText(s.from, s.to))} (${s.months}개월)` : '—'}</td>`
        + `<td class="rd-td-total" title="월별 지급의 합(천원)">${thousand(s.total)}</td>`
        // 연간(평균) = 지급 합 ÷ (월급여 × 참여개월), 그 아래 월 최대 — 같아도 늘 보인다(2026-10-18 "같아도 해줘"). 둘 다 rERP 가 보이는 올림(rerp/reference.md §3).
        + `<td class="rd-td-rate" title="연간 참여율 = 지급 합 ÷ (월급여 × 참여개월), rERP 올림">${rateText(s.rate) || '—'}${s.maxRate != null ? `<span class="rd-td-max" title="월 최대 참여율 — ${escapeHtml(s.maxYm)}의 지급 ÷ 월급여. 100% 검사는 달마다 이 값으로">월 최대 ${rateText(s.maxRate)}</span>` : ''}</td></tr>`
        + strip;
    }).join('');
    const warnHtml = warns.length ? `<ul class="rd-staff-warn">${warns.map((w) => `<li class="${w.level}">${escapeHtml(w.text)}</li>`).join('')}</ul>` : '';
    return `<table class="rd-table rd-staff-table"><thead><tr><th>성명</th><th>역할</th><th title="천원">월급여</th><th>참여</th><th title="천원">지급 합</th><th>참여율</th></tr></thead><tbody>${rows}</tbody></table>${warnHtml}`;
  }

  /** 표를 그릴 때 — rERP 가 켜져 있고 오늘이 든 차년도면, 받은 것이 없거나 10분이 지났을 때 이 세션에서 한 번 저절로 받는다(↻ 는 언제든). */
  function staffAuto(p) {
    if (!st.set.erp || st.staffBusy || st.staffTried.has(staffKey(p))) return;
    if (!isLive(yearOf(p), today()) || staffFresh(staffOf(p))) return;
    refreshStaff({ reason: '열 때' });
  }

  /**
   * 이어진 rERP 과제의 참여인력(지급계획)을 받아 잇기의 staff 로 둔다 — 참여인력 행(fetchParticipants)을 사람마다 하나로(rerp/staff.js peopleOfErp — 지급기간을 달마다 펼친 월별 지급·월급여 = 지급한도액),
   * 사람마다 다른 과제 월별 참여율(fetchOthers — 지급계획 팝업의 한도 검사 자료)도 받아 100% 초과 알림의 재료로 둔다. 행이 없으면 staff 를 지운다.
   * force 가 아니면 오늘이 든 차년도가 아니거나 10분 안이면 건너뛴다. 한 번에 하나만 돈다. 던지지 않는다 — 까닭은 칸에 보인다.
   */
  function refreshStaff({ force = false, reason = '' } = {}) {
    const p = cur();
    if (!p || !st.set.erp) return Promise.resolve(false);
    const e = curBook(p).erp;
    if (!e) return Promise.resolve(false);
    if (!force && (!isLive(yearOf(p), today()) || staffFresh(e.staff))) return Promise.resolve(false);
    if (st.staffRun) return st.staffRun;
    const n = curYear(p);
    st.staffTried.add(staffKey(p));
    // 도는 중인 조회는 run 으로 들고 끝나면 비운다 — 안에서 비우면 await 없이 바로 끝난 경우 바깥 대입이 끝난 약속을 도로 남겨 다음 조회가 막힌다.
    const run = (async () => {
      st.staffBusy = true;
      paintStaff();
      setStaffMsg(`rERP ${e.prjNo} 참여인력을 받는 중…`);
      let ok = false;
      try {
        const now = Date.now();
        const rows = await withLogin(() => fetchParticipants(erp, e.prjNo));
        const staff = peopleOfErp(rows, { prjNo: e.prjNo, now });
        let othersN = 0;
        for (const q of staff?.people || []) {
          if (!q.erp?.req || !q.erp.seq) continue;
          try {
            q.erp.others = (await withLogin(() => fetchOthers(erp, q.erp))).rows;
            othersN++;
          } catch (err) {
            logEvent('rnd', false, `R&D 참여인력 — ${q.name} 다른 과제 참여율 실패: ${String(err?.message || err)}`);
          }
        }
        if (staff) e.staff = { at: now, ...staff }; else delete e.staff;
        ok = true;
        if (cur() === p && curYear(p) === n) setStaffMsg('');
        logEvent('rnd', true, `R&D 참여인력 받음(${reason}): ${e.prjNo} · ${staff ? staff.people.length : 0}명 · 다른 과제 참여율 ${othersN}명`);
      } catch (err) {
        if (cur() === p && curYear(p) === n) setStaffMsg(erpMessage(err), true);
        logEvent('rnd', false, `R&D 참여인력 실패(${reason}): ${String(err?.message || err)}`);
      } finally {
        st.staffBusy = false;
        save();
        if (cur() === p && curYear(p) === n) paintStaff();
      }
      return ok;
    })();
    st.staffRun = run;
    run.finally(() => { if (st.staffRun === run) st.staffRun = null; });
    return run;
  }

  /** 참여연구자 표 복사 — rERP 참여인력이 있으면 월급여·참여기간·지급 합·참여율·월별 지급까지 든 표(rerp/staff.js staffTsv), 아니면 계획서 글의 표. */
  function copyRoster() {
    const p = cur();
    const staff = p ? staffOf(p) : null;
    if (staff) copyWith(el.rosterCopy, staffTsv(staff, 'rerp'), '참여연구자 표');
    else copyFile(el.rosterCopy, 'roster', '참여연구자 표');
  }

  /* ---------------------------------------------------------- 공유 권한(2026-10-19 사용자 지정: "여기에 저 sharepoint 링크 읽기, 쓰기 권한 설정 … 아이콘에 공유아이콘 추가 … 그거 누르고.. 체크하면 반영") */

  // 참여인력 머리 줄의 공유 아이콘을 누르면 표 위에 이 과제의 SharePoint 과제 폴더(공유 카드가 맞춘 shareIndex 의 폴더)에 대한 **사람마다의 읽기·편집 체크**가 펴진다. 권한은 rerp/spstore.js permissions(확장 출처 GET)로 읽고,
  // 사람은 **이메일**로 맞춘다 — 사이트 사용자 정보의 표시 이름은 영문("MOON Changjae", 실측 2026-10-19)이라 한글 이름으로는 못 맞춘다. 참여인력의 한글 이름은 findPeople(사이트 search REST, GET)이 이메일로 풀어 rndSharePeople 에 기억한다(한 번 찾으면 다시 묻지 않는다 — ↻ 는 못 찾은 이름을 다시).
  // 체크하면 바로 반영(applyPerm): 지금 역할이 있으면 writer.unshare(그 사람의 역할 전부) → 줄 것이 있으면 writer.sharePeople([이메일], { role }) — 둘 중 하나만 켜진다(바꾸면 거둔 뒤 다시 줌, 빼면 거둠). 한 번에 한 사람, 끝나면 권한을 다시 읽어 실제 상태를 보인다.
  // 공유가 꺼져 있으면 공유 카드로 안내, 과제 폴더가 아직 없으면 지금 동기화 안내. 남의 폴더(책임자의 것 — shareIndex 의 owner)는 읽기만. 대상 이름은 이 차년도의 참여연구자(rERP 참여인력, 없으면 계획서)와 과제의 행정지원(나는 뺀다 — src/rndshare.js permRows).
  const PERM_ROLE_TEXT = { edit: '편집', read: '읽기', owner: '소유자', other: '그 밖', '': '없음' };
  const savePeople = () => chrome.storage.local.set({ [PEOPLE_KEY]: st.permPeople });
  const permErrText = (err) => { const d = SPX.describe(err); return d.kind === 'auth' ? 'OneDrive 에 로그인하세요 — 설정 › Plus 의 폴더 열기로 로그인한 뒤 ↻' : d.message; };
  const setPermMsg = (msg, error = false) => { el.permMsg.textContent = msg; el.permMsg.classList.toggle('error', !!error); el.permMsg.classList.toggle('hidden', !msg); };
  /** 권한 표에 올릴 이름 — 이 차년도의 참여연구자(rERP 참여인력, 없으면 계획서의 참여연구자)와 과제의 행정지원. 나는 permRows 가 뺀다. */
  function permNames(p) {
    const out = [];
    const add = (v) => { const s = String(v || '').trim(); if (s && !out.includes(s)) out.push(s); };
    const staff = staffOf(p);
    if (staff) for (const q of staff.people || []) add(q?.name);
    else for (const x of parseRoster(fileLog(curBook(p), 'roster')?.text) || []) add(x?.name);
    for (const s of p.support || []) add(s?.name);
    return out;
  }
  /** 이름 → 사람 — 저장해 둔 캐시(permPeople) 위에 이 세션의 찾기 결과(lookup — 겹침·못 찾음)를 덮는다. */
  function permPeopleNow() {
    const people = { ...st.permPeople };
    for (const [n, v] of Object.entries(st.perm.lookup)) if (!people[n]) people[n] = v;
    return people;
  }
  const permRowsNow = (p) => permRows(permNames(p), st.perm.perms, permPeopleNow(), { me: myName() });
  function closePerm() {
    Object.assign(st.perm, { open: '', busy: false, cfg: null, folder: '', owner: '', perms: null, row: '' });
    setPermMsg('');
    paintPerm();
  }
  /** 공유 아이콘 — 펴 있으면 접고, 아니면 이 과제:차년도로 펴서 권한을 읽는다. 공유가 꺼져 있으면 안내하고 공유 카드로. */
  function togglePerm() {
    const p = cur();
    if (!p) return Promise.resolve(false);
    if (st.perm.open === staffKey(p)) { closePerm(); return Promise.resolve(false); }
    Object.assign(st.perm, { open: staffKey(p), cfg: null, folder: '', owner: '', perms: null, row: '' });
    setPermMsg('');
    if (!st.share.on) { paintPerm(); setPermMsg('공유 (SharePoint)가 꺼져 있습니다 — 설정 › Plus 에서 켜고 맞춘 뒤 다시 누르세요.', true); goSettings({ share: true }); return Promise.resolve(false); }
    return loadPerm();
  }
  /** 과제 폴더(shareIndex)를 찾아 권한을 읽고, 아직 이메일을 모르는 이름은 찾는다(findPeople — 찾은 것은 rndSharePeople 에 남긴다). 한 번에 하나만. 던지지 않는다 — 까닭은 알림 줄에. */
  async function loadPerm() {
    const p = cur();
    if (!p || st.perm.busy) return false;
    const key = staffKey(p);
    st.perm.busy = true;
    paintPerm();
    let ok = false;
    try {
      const prjNo = keyOfProject(p);
      const index = shareObj((await chrome.storage.local.get('shareIndex'))?.shareIndex);
      const ent = shareObj(index[prjNo]);
      if (!ent.folder) { Object.assign(st.perm, { cfg: null, perms: null, folder: '', owner: '' }); setPermMsg('과제 폴더가 아직 없습니다 — 설정 › Plus 의 지금 동기화로 폴더를 만든 뒤 ↻ 를 누르세요.', true); return false; }
      const now = shareCfgNow();
      const cfg = await share.shareProjectCfg(prjNo, { folder: now.folder, driveHost: now.driveHost }, index);
      if (!cfg) { Object.assign(st.perm, { cfg: null, perms: null, folder: '', owner: '' }); setPermMsg('과제 폴더를 찾지 못했습니다 — 설정 › Plus 의 지금 동기화 뒤 ↻ 를 누르세요.', true); return false; }
      Object.assign(st.perm, { cfg, folder: String(ent.folder), owner: String(ent.owner || '') });
      st.perm.perms = await SPX.permissions(cfg, spIo());
      // 이메일을 모르는 이름만 찾는다 — 캐시에 있거나 이 세션에서 못 찾은(겹침·없음) 이름은 다시 묻지 않는다(↻ 는 다시).
      const need = permNames(p).filter((n) => !sameName(n, myName()) && !st.permPeople[n] && !st.perm.lookup[n]);
      if (need.length) {
        const r = await SPX.findPeople(cfg, need, spIo());
        const at = Date.now();
        for (const f of r.found) st.permPeople[f.name] = { email: String(f.email).toLowerCase(), title: f.title, login: f.login, at };
        for (const a of r.ambiguous) st.perm.lookup[a.name] = { ambiguous: a.candidates };
        for (const n of r.notFound) st.perm.lookup[n] = { notFound: true };
        if (r.found.length) { st.permPeople = normalizePeople(st.permPeople); savePeople(); }
      }
      ok = true;
    } catch (err) {
      setPermMsg(permErrText(err), true);
      logEvent('rnd', false, `R&D 공유 권한 읽기 실패: ${String(err?.message || err)}`);
    } finally {
      st.perm.busy = false;
      if (st.perm.open === key) paintPerm();
    }
    return ok;
  }
  /** ↻ — 이 과제 이름들의 찾기 결과(겹침·못 찾음·실패)를 지우고 권한·사람을 다시 읽는다. */
  function refreshPerm() {
    const p = cur();
    if (!p) return Promise.resolve(false);
    for (const n of permNames(p)) delete st.perm.lookup[n];
    for (const v of Object.values(st.perm.lookup)) if (v && typeof v === 'object') delete v.error;
    setPermMsg('');
    return loadPerm();
  }
  /** 칸 그리기 — 펴 둔 과제:차년도가 보고 있는 것일 때만 보인다. 머리 줄은 폴더 이름(남의 폴더·조직 내 링크·읽는 중), 몸통은 사람마다의 줄(permHtml). */
  function paintPerm() {
    const p = cur();
    const open = !!p && st.perm.open === staffKey(p);
    el.perm.classList.toggle('hidden', !open);
    el.staffShare.classList.toggle('on', open);
    el.staffShare.setAttribute('aria-pressed', open ? 'true' : 'false');
    if (!open) { el.permBody.innerHTML = ''; el.permFolder.textContent = ''; return; }
    const q = st.perm;
    el.perm.classList.toggle('busy', q.busy || !!q.row);
    el.permRefresh.disabled = q.busy || !!q.row || !st.share.on;
    const links = q.perms?.links || [];
    el.permFolder.textContent = q.folder
      ? `${q.folder} 폴더${q.owner ? ` · 책임자(${q.owner})의 폴더 — 권한은 책임자가` : ''}${links.length ? ` · 조직 내 링크 ${links.map((l) => PERM_ROLE_TEXT[l.role] || l.role).join('·')}` : ''}${q.busy ? ' · 읽는 중…' : ''}`
      : q.busy ? '권한을 읽는 중…' : '';
    if (!q.perms) { el.permBody.innerHTML = ''; return; }
    const rows = permRowsNow(p);
    el.permBody.innerHTML = rows.length ? permHtml(rows) : '<p class="rd-hint">권한을 줄 사람이 없습니다 — 참여인력·행정지원에 나 말고는 없습니다.</p>';
  }
  /** 사람마다 한 줄 — 성명(아래에 표시 이름 <이메일>) · 읽기 ☐ · 편집 ☐ · 상태. 이메일을 모르거나(찾는 중·겹침·없음) 소유자·다른 권한·남의 폴더·반영 중이면 체크를 잠근다. 폴더에만 있는 사람은 extra(거둘 수 있게). */
  function permHtml(rows) {
    const lock = st.perm.busy || !!st.perm.row || !!st.perm.owner;
    const tr = rows.map((r) => {
      const busy = st.perm.row === r.name;
      const can = !lock && !!r.email && r.role !== 'owner' && r.role !== 'other';
      const lk = st.perm.lookup[r.name] || {};
      const state = busy ? '반영 중…' : lk.error ? lk.error : r.state === 'ambiguous' ? `이름 겹침 — ${r.candidates.join(' · ')}` : r.state === 'notFound' ? '사람을 찾지 못했습니다 — OneDrive 에서 직접 공유하세요' : r.state === 'lookup' ? '찾는 중…' : r.role === 'owner' ? '소유자' : r.role === 'other' ? '다른 권한 — OneDrive 에서' : '';
      const sub = r.email ? `${r.title && !sameName(r.title, r.name) ? `${r.title} ` : ''}<${r.email}>` : '';
      return `<tr class="rd-perm-row${r.extra ? ' extra' : ''}" data-perm="${escapeHtml(r.name)}">`
        + `<td class="rd-td-name">${escapeHtml(r.name)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</td>`
        + `<td><input type="checkbox" data-role="read"${r.role === 'read' ? ' checked' : ''}${can ? '' : ' disabled'} aria-label="${escapeHtml(r.name)} 읽기"></td>`
        + `<td><input type="checkbox" data-role="edit"${r.role === 'edit' ? ' checked' : ''}${can ? '' : ' disabled'} aria-label="${escapeHtml(r.name)} 편집"></td>`
        + `<td class="rd-td-state${lk.error && !busy ? ' error' : ''}">${escapeHtml(state)}</td></tr>`;
    }).join('');
    return `<table class="rd-table rd-perm-table"><thead><tr><th>성명</th><th>읽기</th><th>편집</th><th>상태</th></tr></thead><tbody>${tr}</tbody></table>`;
  }
  /** 체크 — 읽기를 켜면 'read', 편집을 켜면 'edit', 끄면 'none'. */
  function onPermChange(e) {
    const box = e.target;
    if (!box || box.tagName !== 'INPUT' || box.type !== 'checkbox') return;
    const tr = box.closest('tr[data-perm]');
    if (!tr) return;
    const role = box.dataset.role === 'edit' ? 'edit' : 'read';
    applyPerm(tr.dataset.perm, box.checked ? role : 'none');
  }
  /**
   * 한 사람의 권한을 target('read' | 'edit' | 'none')으로 — 지금 역할이 있으면 거두고(writer.unshare — 그 사람의 역할 전부), target 이 있으면 준다(writer.sharePeople 에 이메일, 피커가 이메일로 찾음).
   * 끝나면 권한을 다시 읽어 실제 상태를 보인다. 한 번에 한 사람(반영 중엔 체크가 잠긴다). 던지지 않는다 — 실패는 그 줄의 상태와 활동 로그에.
   */
  function applyPerm(name, target) {
    const p = cur();
    const q = st.perm;
    if (!p || q.busy || q.row || !q.cfg || !q.perms || q.owner) return Promise.resolve(false);
    const row = permRowsNow(p).find((r) => r.name === name);
    if (!row || !row.email || row.role === 'owner' || row.role === 'other') { paintPerm(); return Promise.resolve(false); }
    const was = row.role === 'edit' || row.role === 'read' ? row.role : '';
    const want = target === 'edit' || target === 'read' ? target : '';
    if (want === was) { paintPerm(); return Promise.resolve(false); }
    const key = staffKey(p), folder = q.folder, cfg = q.cfg;
    q.row = name;
    if (q.lookup[name]) delete q.lookup[name].error;
    paintPerm();
    const run = (async () => {
      let w = null, ok = false;
      try {
        w = await SPX.openWriter(cfg, spIo());
        if (was && row.id) await w.unshare(cfg.folderPath, [row.id]);
        if (want) {
          const r = await w.sharePeople(cfg.folderPath, [row.email], { role: want });
          if (!r.shared.length) throw new Error(r.error || (r.notFound.length ? `${row.email} 을 SharePoint 에서 찾지 못했습니다` : r.ambiguous.length ? `${row.email} 과 다른 사람이 찾혔습니다` : '공유하지 못했습니다'));
        }
        ok = true;
        logEvent('rnd', true, `R&D 공유 권한: ${folder} · ${name} → ${PERM_ROLE_TEXT[want]}`);
      } catch (err) {
        q.lookup[name] = { ...(q.lookup[name] || {}), error: permErrText(err) };
        logEvent('rnd', false, `R&D 공유 권한 실패: ${folder} · ${name} → ${PERM_ROLE_TEXT[want]}: ${String(err?.message || err)}`);
      } finally {
        try { await w?.close(); } catch { /* 이미 닫힘 */ }
      }
      try { q.perms = await SPX.permissions(cfg, spIo()); } catch (err) { setPermMsg(permErrText(err), true); }
      q.row = '';
      if (q.open === key) paintPerm();
      return ok;
    })();
    q.run = run;
    run.finally(() => { if (q.run === run) q.run = null; });
    return run;
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
    // 펴 둔 사유는 다시 그려도 펴진 채로 — 다른 줄을 고치거나 사유를 적어도 보던 것이 접히지 않게.
    const opened = new Set([...el.changes.querySelectorAll('li > details.rd-reason[open]')].map((d) => d.parentElement.dataset.ch));
    el.changes.innerHTML = newestFirst(b.changes).map((c) => {
      const diff = c.before || c.after ? `<p class="rd-diff"><s>${escapeHtml(c.before || '(없음)')}</s><span class="rd-arrow" aria-hidden="true">→</span><b>${escapeHtml(c.after || '(없음)')}</b></p>` : '';
      // 주요 변경(날짜·구분·항목·전 → 후)만 펴 두고 사유는 접힌 한 줄 — 접히면 "사유" 뒤에 한 줄로 잘라 보이고 눌러 편다(2026-10-19 사용자 지정 "주요 변경사항만 보이게 하고 세부적인 것은 접어줘").
      // 사유가 비었으면 그 자리에서 적는 칸 — 저절로 남은 줄은 왜 바꿨는지를 사람이 적어야 이력이 된다. 적는 칸은 접지 않는다(접힌 칸 뒤에 행위를 두지 않는다).
      const reason = c.reason
        ? `<details class="rd-reason"${opened.has(c.id) ? ' open' : ''}><summary><span class="rd-reason-lab">사유</span><span class="rd-reason-peek">${escapeHtml(c.reason)}</span></summary><p class="rd-reason-text">${escapeHtml(c.reason)}</p></details>`
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
      b.changes.push(stampChanges([{ id: newId(), date, kind, item, before, after, reason, auto: false }])[0]);
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
  const copyFile = (btn, key, what) => { const p = cur(); const l = !p ? null : key === 'plan' ? planNow(p).log : fileLog(curBook(p), key); if (l) copyWith(btn, entryText(l), what); };
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
      // 스냅샷은 연구내용 공유에 쓸 모양(rerp/research.js 기록 — 개발목표·개발내용·연구활동비 세부사용계획 …)으로도 남긴다 — 공유가 켜져 있으면 잠깐 뒤 과제 폴더의 연차 파일(research 칸)로 간다(2026-10-18).
      const recs = docs.filter((d) => d.kind === 'snapshot').map((d) => { try { return RS.readSnapshot(d.obj, { text: d.text, file: d.name }); } catch { return null; } }).filter(Boolean);
      if (recs.length) await storeResearch(recs);
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

  /* ---------------------------------------------------------- 공유 (SharePoint) 배선 — rerp/sharesync.js(createShareSync — kr_ext_rerp background.js 의 shareSync 를 옮긴 것) */
  // 2026-10-18 사용자 지정(kr_ext_rerp 에서 먼저 바뀌고 "거기도 이렇게 진행하도록 해줘" · "workspace 에도 경로주면 알아서 동기화"): 원노트·MCP·Graph 를 걷어 내고 **브라우저 로그인 쿠키만으로 SharePoint(OneDrive) 공유 폴더**를 쓴다 —
  // "원노트 공유는 mcp 없어도 되긴하지? … 글치 mcp 없이 할 수 있게 해줘" · "아니 mcp 없이 grph api 하지 않고 브라우저 토큰으로 하라고" · "onedrive 에 업무/shared 안에 과제별로 .. 약칭으로 없으면 jobid 없으면 임시번호 … 년차별로 1개 파일이고 1개 파일에서 변경사항이랑 다 관리 … 과제 정보랑 등등" ·
  // "참여연구원들에게 공유할 수 있게 설정까지" · "예상지출도 … 별도 파일에서 해도 되긴하는데". 밑폴더(base)는 공유 칸의 주소(비면 내 OneDrive 문서/업무/shared — sharesync 가 푼다), 과제 폴더는 약칭(→ Job Id → rERP 과제번호), 그 안에 <n>차년도.json 과 예상비용.json.
  // 여기 몫(want): 예상 비용은 **받기만**(보기만 — 2026-10-11 사용자 지정, 파일은 rerp 가 쓴다) · 연구내용·예산 **계획**(파일 budget 줄 — 집행은 rERP/로컬)·변경이력(id 합집합)·별칭(aliasAt 늦은 쪽)은 양방향 · 참여연구원 계획(staff)은 안 한다(rERP 에서 읽는다 — 2026-10-18 저녁).
  // 과제 정보의 다른 기기 맞춤도 이제 연차 파일의 project 칸이 맡는다(별도 페이지 없음). 설정·과제 문맥·장부 읽기/쓰기(src/rndshare.js 변환)·참여연구원 이름·클립보드는 deps 로 넘기고,
  // 메시지(planSync · planSyncQueue · shareProbe · shareFolderCopy · shareOrgLink · shareFolderPeople · shareRename)는 send(msg) 로 — rerp/plan.js 의 api.send 에도 끼운다.
  // 이 패널의 동기화 몫은 설정 › Plus 의 항목에서(src/rndshare.js plusWant — plan 은 받기만(pullOnly), staff 는 늘 안 함, 예산 계획은 사업비를 따름, 별칭·행정지원(support — 2026-10-19)은 늘).
  // sharesync 가 rerp 식으로 settings 에서 want 를 셈하면(budget·staff 를 staffSync 로 함께) 어긋나므로 want 를 따로 준다(settings 에도 같이 실어 둔다).
  const SHARE_PULL_ONLY = Object.freeze({ plan: true });
  /** 내 OneDrive 를 찾는 호스트(설정 folder 가 비었을 때) — rerp 의 기본값과 같다. 로그인이 필요할 때 "폴더 열기"가 여기로 간다. */
  const SHARE_DRIVE_HOST = String(SHARE_DEFAULTS?.driveHost || 'https://krclass-my.sharepoint.com').replace(/\/+$/, '');
  // rERP 확장(kr_ext_rerp)의 공유 폴더 설정을 따른다(2026-10-19 사용자 지정: "SharePoint workspace 경로 연결 — 이 링크 공통으로 맞춰봐" — 두 확장이 한 설정). 압축해제 확장은 ID 가 PC 마다 달라
  //   chrome.management.getAll() 에서 **이름**으로 찾고(켜진 것 먼저, 여럿이면 먼저 답하는 것) { type: 'shareFolder' } 를 물으면 rerp background.js 의 onMessageExternal 이
  //   { ok, enabled, folder(설정 칸 원문 — 비면 ''), driveHost, url?, path?, mine?, at?, version } 로 답한다(읽기만 — 네트워크 없음, 다른 type 은 무응답). 공유 폴더 칸이 비어 있을 때만 그 folder·driveHost 를 쓰고,
  //   칸에 값이 있으면 그것이 이긴다(다르면 카드 결과 줄에 알림). rERP 확장이 없거나 답이 없으면(PEER_WAIT_MS) 지금처럼 기본값(내 OneDrive 문서/업무/shared). 검사에서는 chrome.management 가 없어 늘 기본값.
  const RERP_NAME = 'KR eClass + R&D ERP 현황';   // kr_ext_rerp manifest.json 의 name
  const PEER_WAIT_MS = 1500;
  let peerId = '';   // 찾아 둔 rERP 확장의 ID(이 세션) — 답이 없으면 다시 찾는다
  async function askPeer() {
    const c = globalThis.chrome;
    if (typeof c?.management?.getAll !== 'function' || typeof c?.runtime?.sendMessage !== 'function') return null;
    const within = (p) => new Promise((res) => { const t = setTimeout(() => res(undefined), PEER_WAIT_MS); Promise.resolve(p).then((v) => { clearTimeout(t); res(v); }, () => { clearTimeout(t); res(undefined); }); });
    const ask = async (id) => { try { const r = await within(c.runtime.sendMessage(id, { type: 'shareFolder' })); return r && typeof r === 'object' && r.ok === true ? { ...r, id } : null; } catch { return null; } };
    if (peerId) { const r = await ask(peerId); if (r) return r; peerId = ''; }
    let list;
    try { list = await within(c.management.getAll()); } catch { list = null; }
    const cands = (Array.isArray(list) ? list : []).filter((x) => x && x.type === 'extension' && x.name === RERP_NAME && x.id && x.id !== c.runtime.id)
      .sort((a, b) => Number(!!b.enabled) - Number(!!a.enabled));
    for (const x of cands) { const r = await ask(x.id); if (r) { peerId = x.id; return r; } }
    return null;
  }
  /** 지금 쓸 밑폴더(네트워크 없음 — 마지막으로 물어 둔 rERP 확장의 답 st.share.peer 로): 칸의 값이 있으면 그것(driveHost 는 기본), 비면 rERP 확장의 설정(peer.at 이 있을 때 — following), 그것도 없으면 기본. */
  function shareCfgNow() {
    const own = String(st.share.folder || '');
    const peer = shareObj(st.share.peer);
    const following = !own && Number(peer.at) > 0;
    const folder = own || (following ? String(peer.folder || '') : '');
    const driveHost = following && peer.driveHost ? String(peer.driveHost) : SHARE_DRIVE_HOST;
    return { folder, driveHost, following, peer };
  }
  /** 밑폴더의 열쇠(rndShare.effective) — 기본(비움·기본 호스트)은 '' 라 이 칸이 생기기 전의 저장값('')과 같다(처음 맞춤에 캐시를 괜히 버리지 않게). */
  const shareEffKey = (folder, driveHost) => (folder || driveHost !== SHARE_DRIVE_HOST ? `${folder}\n${driveHost}` : '');
  /**
   * 맞추기 전에 rERP 확장에 공유 폴더 설정을 묻고(askPeer) 지금 쓸 밑폴더를 정한다. 쓸 자리가 지난번(rndShare.effective)과 다르면 — 다른 자리의 다른 파일이라 — 공유 폴더 칸을 바꿨을 때처럼
   * 과제 → 폴더 캐시(shareIndex)·밑폴더 캐시(shareFolder)·지문(memo)을 버린다(shareReset). rERP 확장이 안 닿으면 기억(peer)을 지워 기본값으로(화면의 "따름" 문구도 거둠).
   */
  async function shareEffective() {
    const r = await askPeer();
    // plus: rERP 확장의 공유 (Plus) 설정(2026-10-25 — 칸마다 따른다, src/rndshare.js plusOf). 답의 enabled 에 더해 plus 칸(rerp 가 답에 실어 주면 — 공유할 과제·항목·자동 공유/찾기)을 아는 것만.
    st.share.peer = r
      ? { id: String(r.id || ''), folder: String(r.folder || '').trim().slice(0, 2000), driveHost: String(r.driveHost || '').trim().replace(/\/+$/, '') || SHARE_DRIVE_HOST, enabled: r.enabled === true, path: String(r.path || '').slice(0, 2000), url: String(r.url || '').slice(0, 2000), version: String(r.version || '').slice(0, 20), at: Date.now(),
        plus: normalizePlus({ ...shareObj(r.plus), enabled: r.enabled }) }
      : {};
    if (applyPlus()) shareOnChanged('rERP 확장의 설정을 따름');
    const now = shareCfgNow();
    const key = shareEffKey(now.folder, now.driveHost);
    if (key !== String(st.share.effective || '')) {
      st.share.effective = key;
      await shareReset();
      if (now.following) logEvent('rnd', true, `R&D 공유 폴더(rERP 확장의 설정을 따름): ${now.folder || '(비움 — 내 OneDrive 문서/업무/shared)'}`);
    }
    saveShare();
    return now;
  }
  /**
   * 밑폴더가 바뀌었다 — 지난 지문(memo)은 다른 파일의 것이라 버리고, 과제 → 폴더 캐시(shareIndex)와 밑폴더 캐시(shareFolder)도 지운다. 마지막 결과(shareState — 과제별 폴더 주소)도 옛 자리 것이라 화면에서 비운다(저장소의 것은 다음 맞춤이 갈아 쓴다).
   * shareIndex 를 두면 prjdocsync 가 옛 밑폴더의 과제 폴더를 "색인에 있는 동료 폴더(base 밖)" 로 믿어 이미 맞춘 과제는 계속 옛 자리에 쓰고 새 주소는 새 과제에만 쓰였다(2026-10-19 검토 — 사용자 "workspace 에도 경로주면 알아서 동기화").
   */
  async function shareReset() {
    Object.assign(st.share, { error: '', at: 0, memo: {} });
    st.shareKind = '';
    st.shareNote = null;
    st.shareState = null;
    try { await chrome.storage.local.remove(['shareIndex', 'shareFolder']); } catch { /* 캐시가 없거나 못 지웠다 — 다음 맞춤이 다시 훑는다 */ }
  }
  const share = createShareSync({
    settings: async () => {
      const now = await shareEffective();   // 칸이 비면 rERP 확장의 설정(2026-10-19), 칸마다 rERP 확장의 공유 (Plus) 설정을 따름(2026-10-25)
      const p = plusNow();
      return { ...p, enabled: !!st.share.on, folder: now.folder, driveHost: now.driveHost, sitesSync: false, want: plusWant(p), pullOnly: { ...SHARE_PULL_ONLY } };   // 가맹점(common)은 이 확장에 없다
    },
    want: () => plusWant(plusNow()), pullOnly: { ...SHARE_PULL_ONLY },
    context: () => shareContextForSync(), loadLocal: () => shareLoadLocal(), saveLocal: (part, prj, data) => shareSaveLocal(part, prj, data), participants: (prjNo) => shareParticipants(prjNo),
    copyText, chrome: globalThis.chrome, fetch: spFetch, store,
  });
  /** 저장소 손잡이(shareRekey 용 — rERP 에 이은 뒤 옛 폴더의 파일 project.prjNo 를 새 열쇠로) — sharesync 와 같은 꼴: KRX_SP 에 검사의 가짜 store 를 덧씌움. 쓰기는 공유가 켜져 있고 옛 폴더를 알 때만. */
  const SPX = Object.assign(Object.create(null), KRX_SP, store || {});
  const spIo = () => ({ fetch: spFetch, chrome: globalThis.chrome });
  // rerp/plan.js 가 백그라운드에 보내던 요청(planSync · planSyncQueue · shareFolderCopy …)을 같은 창의 배선으로. 동기화 결과(planSync)면 상태 줄·표를 다시 그린다.
  // PLAN 은 모듈 하나(싱글턴)라 패널 인스턴스가 둘이면(검사 — 같은 화면을 빌린 다른 인스턴스) 마지막 것이 이긴다 — show() 가 보이는 인스턴스로 다시 끼운다.
  const planSend = (msg) => share.send(msg).then((r) => { if (msg?.type === 'planSync') afterShareSync(r, msg.reason === 'load' ? '열 때' : String(msg.reason || 'manual')); return r; });
  PLAN.send = planSend;

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
      ? budgetTable({ prjNo: e.prjNo, rspr: e.rspr, budget: e.snap?.budget || null, budgetError: e.snap?.budget ? '' : (e.error?.message || ''), unbilledShared: 0 }, { planSync: st.pl.data.settings.planSync, sharePick: st.pl.data.settings.sharePick, quickPicks: [] }, st.pl)
      : '';
    // 보기만(2026-10-11 사용자 지정) — 예상 비용을 적고 고치고 파일을 만드는 것은 rerp 확장(eClass 홈)에서 한다. 여기서는 ＋·✎·×·수량 −/＋·저장·주소 복사(⬆)를 걷어 내고
    // 눈(펼치기)·열기(↗ 예상비용.json)만 둔다. 공유 (SharePoint)로 받은 것이 표와 장부(사용계획)에 보인다.
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
      st.erpRecsAt = Date.now();
      st.erpRecsErrAt = 0;
      const rows = projectRecs(got.recs, { code: p.code, name: p.name });
      const rec = pickYearRec(rows, y);
      if (rec) {
        const oldKey = keyOfProject(p);   // 공유 열쇠 — 이으면 rERP 과제번호로 바뀐다(shareRekey 가 폴더를 이어 쓴다)
        b.erp = linkOf(rec, { auto: !manual, now: Date.now() });
        clearErpPick();
        logEvent('rnd', true, `R&D rERP 잇기: ${label(p)} ${yearLabel(y.n)} → ${rec.prjNo}${rec.anl ? ` ${rec.anl}연차` : ''}`);
        await shareRekey(p, oldKey);
        save();
        st.erpBusy = false;
        paintErp();
        paintStaff();   // 이어졌으니 참여인력도(저절로 받는다)
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
    const oldKey = keyOfProject(p);   // 공유 열쇠 — 이으면 rERP 과제번호로 바뀐다(shareRekey 가 폴더를 이어 쓴다)
    b.erp = linkOf(rec, { auto: false, now: Date.now() });
    clearErpPick();
    logEvent('rnd', true, `R&D rERP 잇기(고름): ${label(p)} ${yearLabel(y.n)} → ${rec.prjNo}${rec.anl ? ` ${rec.anl}연차` : ''}`);
    await shareRekey(p, oldKey);
    save();
    paintErp();
    paintStaff();
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
    paintStaff();   // 받아 둔 참여인력도 잇기와 함께 사라진다 — 계획서의 표로
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

  /* ---------------------------------------------------------- R&D 설정 (접힌 한 줄 — rERP 집행내역 켜기/끄기 · 그 안에 공유 (SharePoint)·YAML 넣기·스킬) + 예산 칸 위 "집행에 더하기" */

  /** 설정 줄의 머리 글 — `rERP 켬 · 공유 꺼짐 · 비목 1 숨김` — 과 체크들. 예산 칸 위 "집행에 더하기"(2026-10-11 사용자 지정으로 설정에서 옮김)는 rERP 를 껐으면 잠그고 숨긴다. */
  function paintSet() {
    el.erpOn.checked = st.set.erp;
    el.incUnbilled.checked = st.set.unbilled;
    el.incPlan.checked = st.set.plan;
    for (const node of [el.incUnbilled, el.incPlan]) node.disabled = !st.set.erp;
    el.incRow.classList.toggle('hidden', !st.set.erp);
    paintItems();
    // 공문 설정의 형편 줄처럼 한 줄에 들어가게 짧게(2026-10-11) — 긴 것은 CSS 가 줄임표로 자른다.
    el.setState.textContent = `rERP ${st.set.erp ? '켬' : '끔'} · 공유 ${st.share.on ? '켬' : '꺼짐'}${st.set.hide.length ? ` · 비목 ${st.set.hide.length} 숨김` : ''}`;
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
      paintStaff();   // 참여인력의 ↻·저절로 받기도 이 설정을 따른다
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

  /* ---------------------------------------------------------- 공유 (SharePoint) — 과제 정보·예산 계획·변경이력·연구내용 ↔ 과제 폴더의 연차 파일, 예상 비용 ← 예상비용.json (rerp/sharesync.js · src/rndshare.js) */
  // 2026-10-18 사용자 지정 — 원노트 공유(과제 정보 페이지 · 예상 비용 페이지 · 연구내용 페이지)를 모두 걷어 내고 SharePoint(OneDrive) 공유 폴더의 과제별 연차 파일 하나로:
  // "onedrive 에 업무/shared 안에 과제별로 .. 약칭으로 없으면 jobid 없으면 임시번호 … 년차별로 1개 파일이고 1개 파일에서 변경사항이랑 다 관리 … 과제 정보랑 등등" · "workspace 에도 경로주면 알아서 동기화".
  // 켜면: 열 때(1분 안 재실행 안 함 — sharesync 의 load 규칙) · 지금 동기화 · 장부를 고친 뒤 NOTE_WAIT_MS 모아서(고친 것이 있을 때만 — shareHashOf) · 탭이 보이는 동안 SHARE_PERIOD_MS 마다(주기 — rerp 의 자동 갱신 알람에 해당, 2026-10-19 "sharepoint 의 변경사항을 반영하지 않네?") 돈다.
  //   과제 열쇠(prjdoc-sync 의 과제번호 자리)는 src/rndshare.js shareKeyOf(rERP 과제번호 → Job Id → 장부 id). 대상은 장부의 과제(+묘비)에 더해 **공유 폴더에 있는데 장부에 없는 내 rERP 참여 과제**(shareContextForSync — 그 과제는 받으면서 장부에 만든다).
  // 병합 기준(localAt — st.share.memo): 과제 정보는 memo[열쇠] = { id, at, hash } — 마지막으로 맞춘 뒤 WORKSPACE 몫 칸을 고쳤으면(지문이 다르면) 지금(로컬이 이김), 아니면 받아 둔 시각(그 뒤 고친 파일이 이김), 처음은 0(파일 쪽이 이김 — 다른 기기의 장부가 들어온다;
  //   다만 파일에 **비어 있는** 칸은 장부 값을 두고 다음 맞춤에 올린다 — rerp 가 먼저 만든 파일, shareSaveLocal 머리 주석).
  //   예산 계획은 memo[열쇠@n] = { h, at } — 처음은 계획서 스냅샷 날짜, 고쳤으면 지금, 받으면 파일 줄의 at(그래야 같은 내용을 매번 다시 쓰지 않는다). 지운 과제는 st.share.del[열쇠] 묘비 → 파일 project.deletedAt 로 퍼져 다른 기기가 지운다(90일) —
  //   그 열쇠로 되돌아오는 칸은 받지 않는다. rERP 에 이어 열쇠가 바뀐 과제는 shareRekey 가 옛 폴더를 이어 쓴다(파일의 prjNo 를 고치고 색인·memo 를 옮김).
  // 참여연구원 자동 공유는 폴더를 새로 만들 때 sharesync 가 한다(deps.participants — 이어진 rERP 참여인력, 없으면 계획서의 참여연구자). 받는 쪽은 "나와 공유"에서 저절로 찾거나(discover) 공유 폴더 칸에 주소를 넣는다.

  const saveShare = () => chrome.storage.local.set({ [SHARE_KEY]: st.share });
  const when = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const shareObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  /** 지운 과제의 묘비는 이만큼 둔다 — 다른 기기가 받아 지울 때까지(rerp 의 묘비 90일과 같다). */
  const SHARE_TOMB_MS = 90 * 24 * 60 * 60 * 1000;

  /** 과제의 공유 열쇠(보고 있는 차년도의 rERP 로) — src/rndshare.js shareKeyOf. */
  const keyOfProject = (p) => shareKeyOf(p, curYear(p));
  /** 과제에 이어 둔 rERP(보고 있는 차년도, 없으면 이어 둔 가장 낮은 차년도) — 과제명·책임자는 R&D ERP 값이 이긴다(정본 ERP_FIELDS). */
  function erpOfProject(p) {
    const ys = p.years || {};
    const n = curYear(p);
    if (ys[n]?.erp?.prjNo) return ys[n].erp;
    for (const k of Object.keys(ys).map(Number).sort((a, b) => a - b)) if (ys[k]?.erp?.prjNo) return ys[k].erp;
    return null;
  }
  const shareProjectByKey = (key) => st.book.projects.find((p) => keyOfProject(p) === key) || null;
  /** 연차 파일의 project 칸 — src/rndshare.js projectOf(wsId·code·calendar 를 모르는 칸으로 싣는다). */
  const shareFileProject = (p) => shareProjectOf(p, curYear(p));
  /** WORKSPACE 몫 칸(jobId·io·start·end·note·code·calendar …)의 지문 — ERP 칸·별칭은 뺀다. 마지막으로 맞춘 뒤 고쳤는지 보는 데 쓴다(병합의 localAt). */
  function shareInfoHash(p) {
    const o = { ...shareFileProject(p) };
    for (const k of ['prjNo', 'prjNm', 'rspr', 'alias', 'aliasAt', 'support', 'supportAt']) delete o[k];   // 별칭·행정지원은 제 시각(aliasAt·supportAt)으로 맞춘다
    return JSON.stringify(o);
  }
  /** 그 차년도 예산 **계획** 줄(계획이 적힌 줄만 — 집행은 아니다)의 지문(src/rndshare.js budgetHash) — 마지막으로 맞춘 뒤 고쳤는지 본다. */
  const shareBudgetHash = (p, n) => shareBudgetHashOf(p.years?.[n]);
  /** 장부에서 공유로 가는 것의 지문 — 이것이 바뀌었을 때만 잠깐 뒤 맞춘다(shareSoon). */
  const shareHashOf = (book) => JSON.stringify(book.projects.map((p) => [
    keyOfProject(p), p.alias, shareInfoHash(p),
    Object.entries(p.years || {}).map(([n, y]) => [n, shareBudgetHash(p, Number(n)), (y?.changes || []).map((c) => c.id)]),
  ]));

  /**
   * 과제 문맥(sharesync deps.context) — 과제명·책임자·내 과제(장부의 모든 과제 + 묘비)·폴더를 만들 수 있는 과제(leadPrjNos)·별칭·내 이름.
   * 폴더는 정본 규칙대로 책임자(책임자 == 내 이름)거나 로컬 자료(별칭·예산 계획·변경이력·연구내용)가 있을 때 만드는데, rERP 에 이어지지 않은 과제는 이 장부만의 과제라(동료가 만들어 줄 폴더가 없다) 여기서 만들 수 있게 leadPrjNos 에 넣는다.
   * 이어진 과제는 책임자가 아니고 자료도 없으면 책임자의 폴더가 "나와 공유"로 올 때까지 기다린다(noFolder — 오류 아님).
   */
  function shareContext() {
    const names = {}, rsprs = {}, aliases = {}, myPrjNos = [], leadPrjNos = [];
    for (const p of st.book.projects) {
      const key = keyOfProject(p), info = shareFileProject(p), e = erpOfProject(p);
      names[key] = e?.prjNm || info.prjNm || p.name;
      rsprs[key] = e?.rspr || info.rspr || p.lead || '';
      // 폴더 이름(정본 folderNameFor: 별칭 → Job Id → 과제번호)에만 쓰는 별칭 — 별칭이 없으면 과제명으로(열쇠가 장부 id 인 과제의 폴더가 뜻 모를 글자가 되지 않게). 파일의 project.alias 는 loadLocal 의 aliases(진짜 별칭)로 간다.
      aliases[key] = p.alias || p.name;
      myPrjNos.push(key);
      if (!e || sameName(rsprs[key], myName())) leadPrjNos.push(key);
    }
    for (const [key, t] of Object.entries(shareTombs())) if (!shareProjectByKey(key)) { myPrjNos.push(key); names[key] = String(t.project?.prjNm || t.name || key); }
    return { names, rsprs, myPrjNos, leadPrjNos, aliases, who: myName() };
  }
  /**
   * 동기화에 주는 과제 문맥(sharesync deps.context) — shareContext 에 **공유 폴더에 있는데 장부에 없는 내 참여 과제**를 대상으로 더한다(2026-10-19 사용자 "이 시스템에서 sharepoint 의 변경사항을 반영하지 않네?" —
   * rerp 가 적은 과제 폴더는 장부에 없어 맞춤 대상이 아니었고, 그래서 rerp 가 정한 별칭이 파일에는 갔어도 여기 보이지 않았다). 더할 열쇠는 shareAdoptable 이 고르고(st.shareAdopting), 그 과제의 연차 파일에서 받은 칸을 모아(shareAdoptWait) 장부에 만들며 넣는다(shareAdoptCreate — project 칸이 올 때, 안 오면 맞춤이 끝날 때 shareAdoptFlush).
   */
  async function shareContextForSync() {
    const c = shareContext();
    const a = await shareAdoptable();
    st.shareAdopting = a.keys.map((x) => x.key);
    st.shareAdoptInfo = Object.fromEntries(a.keys.map((x) => [x.key, { prjNm: x.prjNm, rspr: x.rspr }]));
    st.shareAdoptNote = a.note;
    for (const x of a.keys) { c.myPrjNos.push(x.key); c.names[x.key] = x.prjNm || x.key; c.rsprs[x.key] = x.rspr; }
    return c;
  }
  /**
   * 장부에 더할 과제 — 과제 → 폴더 캐시(shareIndex — 지난 맞춤이 밑폴더를 훑어 알아본 것)의 **내 밑폴더 과제**(owner 없음 — 동료 폴더는 prjdocsync 가 이미 내 과제만 고른다) 가운데 장부에도 묘비에도 없고,
   * 장부의 과제와 과제번호·과제명으로 맞지 않으며(matchProject — 아직 잇지 않은 같은 과제면 잇기에 맡긴다: 이으면 shareRekey 가 그 폴더를 이어 쓴다), **내 rERP 진행 과제 목록**(rcomm_0009_01_r001 원본 행 — rerp 의 projectList 와 같은 뜻)에 있는 것.
   * 목록을 못 받으면(rERP 집행내역 꺼짐 · 로그인 안 됨) 더하지 않고 까닭을 note 로(결과 줄 끝에 붙는다). 처음 맞출 때는 캐시가 비어 있어 못 고르고, 맞춘 뒤 afterShareSync 가 새 캐시로 다시 골라 한 번 더 돈다.
   * @returns {Promise<{ keys: Array<{ key: string, prjNm: string, rspr: string }>, note: string }>}
   */
  async function shareAdoptable() {
    let index = {};
    try { index = shareObj((await chrome.storage.local.get('shareIndex'))?.shareIndex); } catch { index = {}; }
    const tombs = shareTombs();
    const cand = Object.entries(index).filter(([key, e]) => e && e.folder && !e.owner && !shareProjectByKey(key) && !tombs[key]).map(([key]) => key);
    if (!cand.length) return { keys: [], note: '' };
    if (!st.set.erp) return { keys: [], note: `장부에 없는 과제 폴더 ${cand.length}개 — rERP 집행내역을 켜면 내 참여 과제를 장부에 더합니다` };
    const recs = await erpRecsCached();
    if (!recs) return { keys: [], note: `장부에 없는 과제 폴더 ${cand.length}개 — rERP 에 로그인하면 내 참여 과제를 장부에 더합니다` };
    const byNo = new Map();
    for (const r of recs) { const no = String(r?.PRJ_NO || '').trim(); if (no && !byNo.has(no)) byNo.set(no, { prjNm: String(r?.PRJ_NM || '').trim(), rspr: String(r?.PRJ_RSPR_EMP_NM || '').trim().slice(0, 40) }); }
    const keys = [];
    for (const key of cand) {
      const r = byNo.get(key);
      if (!r) continue;
      let same = null;
      try { same = shareMatchProject(st.book, { project: { prjNo: key, prjNm: r.prjNm } }); } catch { same = null; }
      if (same) continue;   // 장부에 같은 과제가 있다(아직 잇지 않음) — 더하지 않는다
      keys.push({ key, prjNm: r.prjNm, rspr: r.rspr });
    }
    return { keys, note: '' };
  }
  /** 내 rERP 진행 과제 목록(rcomm_0009_01_r001 원본 행 — linkErp 와 같은 조회)을 10분(ERP_TTL_MS) 캐시로. 못 받으면 null — 같은 10분 동안은 다시 묻지 않는다(로그인이 풀렸을 때 주기마다 SSO 를 두드리지 않게). */
  async function erpRecsCached() {
    if (typeof erp?.fetchProjectRecs !== 'function') return null;
    const now = Date.now();
    if (Array.isArray(st.erpRecs) && now - st.erpRecsAt < ERP_TTL_MS) return st.erpRecs;
    if (st.erpRecsErrAt && now - st.erpRecsErrAt < ERP_TTL_MS) return null;
    try {
      const got = await withLogin(() => erp.fetchProjectRecs(erp.settingsOf()));
      if (!got.recs.length && got.firstErr) throw got.firstErr;
      st.erpRecs = got.recs;
      st.erpRecsAt = now;
      st.erpRecsErrAt = 0;
      return st.erpRecs;
    } catch (err) {
      st.erpRecsErrAt = now;
      logEvent('rnd', false, `R&D 공유 — rERP 과제 목록을 못 받아 공유 폴더의 과제를 더하지 못함: ${String(err?.message || err)}`);
      return null;
    }
  }
  /** 살아 있는 묘비(90일 안) — { [열쇠]: { at, project } }. */
  function shareTombs() {
    const out = {}, cut = Date.now() - SHARE_TOMB_MS;
    for (const [key, t] of Object.entries(shareObj(st.share.del))) if (t && Number(t.at) > cut) out[key] = t;
    return out;
  }
  /** 과제를 지웼다 — 공유가 켜져 있고 그 과제의 폴더를 알 때만(마지막 결과 pages 에 폴더가 있을 때) 묘비를 남겨 다음 맞춤에 파일 project.deletedAt 로 퍼뜨린다(다른 기기의 applyProject 가 받아 지운다). 맞춘 적 없는 과제는 남길 것이 없다. */
  function shareTomb(p) {
    const key = keyOfProject(p);
    const pg = st.shareState?.pages?.[key];
    if (!st.share.on || !pg || pg.noFolder || !pg.folder) return;
    st.share.del = shareObj(st.share.del);
    st.share.del[key] = { at: Date.now(), name: p.name, project: shareFileProject(p) };
    st.shareDirty = true;
    saveShare();
  }

  /**
   * prjdoc-sync 의 loadLocal — 장부·예상 비용 저장소·연구내용 기록을 kr_ext_rerp 의 로컬 모양으로(변환은 src/rndshare.js):
   *   plan { plans, del }(rerp/plan.js 저장 키 그대로) · research(researchPlans 맵 — 기록마다 어느 과제 것인지 prjNo 를 열쇠로 채워 준다, 저장분은 그대로) · staff { plans, del }(참여연구원 계획은 안 하지만
   *   **예산 계획 줄은 최소 계획 항목(localPlanOf)의 budget 으로 간다** — rerp prjdoc.fromLocalYear 가 거기서 읽는다) · aliases/aliasesAt · changes('열쇠@차년도' → 파일 모양 줄들) ·
   *   projects { [열쇠]: localProjectOf(project 칸 + anl·stDt·endDt + at(병합 기준 — 머리 주석)) }, 지운 과제는 묘비(deletedAt).
   */
  async function shareLoadLocal() {
    const s = await chrome.storage.local.get([PLAN.KEY, PLAN.DKEY]);
    st.share.memo = shareObj(st.share.memo);
    const memo = st.share.memo, now = Date.now(), who = myName();
    const projects = {}, aliases = {}, aliasesAt = {}, support = {}, changes = {}, plans = {};
    for (const p of st.book.projects) {
      const key = keyOfProject(p), hash = shareInfoHash(p);
      const sup = normalizeSupport(p.support);
      if (sup.length || Number(p.supportAt) > 0) support[key] = { people: sup, at: Number(p.supportAt) || 0 };   // 행정지원 — 정본 fromLocalYear 가 project.support·supportAt 로 (다 지운 뒤에도 시각이 남아 지움이 파일로 간다)
      const m = shareObj(memo[key]);
      if (!memo[key]) memo[key] = { id: p.id, at: 0, hash };                       // 처음 — 파일 쪽이 기준(다른 기기의 장부가 들어온다)
      else if (m.hash !== hash) Object.assign(memo[key], { hash, at: now });      // 마지막으로 맞춘 뒤 이 기기에서 고침 — 로컬이 이긴다
      projects[key] = localProjectOf(p, curYear(p), { at: Number(memo[key].at) || 0, today: today() });
      if (p.alias) { aliases[key] = p.alias; if (p.aliasAt) aliasesAt[key] = p.aliasAt; }
      for (const [k, y] of Object.entries(p.years || {})) {
        const n = Number(k);
        if (!(n >= 1) || !y) continue;
        const yk = `${key}@${n}`;
        const part = shareYearOf(p, n, { key, by: who });
        if (part.changes.length) changes[yk] = part.changes;
        if (!part.budget.length) continue;
        const h = shareBudgetHash(p, n), bm = shareObj(memo[yk]);
        if (!memo[yk]) memo[yk] = { h, at: Date.parse(y.snapshot?.date || '') || 0 };   // 처음 — 계획서 스냅샷 날짜가 이 계획의 시각
        else if (bm.h !== h) Object.assign(memo[yk], { h, at: now });                  // 이 기기에서 고침
        const plan = localPlanOf(p, n, key, { at: Number(memo[yk].at) || 0, by: who });
        if (plan) plans[yk] = plan;
      }
    }
    for (const [key, t] of Object.entries(shareTombs())) {   // 지운 과제 — 파일 project 칸에 deletedAt 을 퍼뜨린다(모르는 칸이라 로컬 것이 실린다)
      if (shareProjectByKey(key)) continue;
      const tp = shareObj(t.project);
      projects[key] = Object.assign({}, tp, { prjNo: key, deletedAt: Number(t.at) || now, anl: 0, stDt: '', endDt: '', at: Number(t.at) || now });
      // 지웠을 때의 별칭도 그대로 — 파일의 별칭과 같아야 '별칭이 바뀌었다' 고 되돌아오지 않는다(되돌아오면 지운 과제의 열쇠로 별칭만 든 payload 가 saveLocal 에 온다, 2026-10-19 검토)
      if (tp.alias) { aliases[key] = String(tp.alias); if (Number(tp.aliasAt) > 0) aliasesAt[key] = Number(tp.aliasAt); }
    }
    const research = Object.assign({}, shareObj(await RS.load()));
    for (const p of st.book.projects) Object.assign(research, shareResearchOf(research, p, keyOfProject(p)));
    return { plan: { plans: shareObj(s?.[PLAN.KEY]), del: shareObj(s?.[PLAN.DKEY]) }, research, staff: { plans, del: {} }, aliases, aliasesAt, support, changes, projects };
  }

  /**
   * prjdoc-sync 의 saveLocal(part, prj, data) — 받은 칸을 장부(변환은 src/rndshare.js applyYear·applyProject)·저장소에. 모양은 rerp background.js 처럼 느슨하게 받는다.
   *   plan → rerp/plan.js 저장(그 과제 몫만) · research → researchPlans(그 과제 몫 갈아 넣기, 다른 과제에 이어 둔 기록은 글만) · staff → 안 한다 ·
   *   budget → 그 차년도 장부 줄의 **계획**만(applyYear — 이름으로 맞추고, 없는 비목은 줄을 더하며, 파일에 없는 줄의 계획은 비운다: 줄 전체가 한 덩이) · changes → 그 차년도 변경이력(이미 합집합) ·
   *   alias → 별칭(applyProject — 다른 과제와 겹치면 '-2' 로 비켜 가고 그 시각을 지금으로 해 파일에도 가게) · project → applyProject(WORKSPACE 몫 칸 — jobId·io·start·end·note·…, deletedAt 이면 지움, wsId 로 장부 id 맞춤).
   * 장부를 고치면 다시 그리고 저장한다 — 그동안 shareSoon 은 막는다(되돌이 방지).
   * 2026-10-19 검토로 더한 규칙:
   *   · 지운 과제의 열쇠(묘비 — shareTombs)로 온 것은 어느 칸이든 받지 않는다 — 묘비는 deletedAt 을 퍼뜨리러 대상에 들 뿐, 별칭·예산·변경이력이 되돌아와 빈 과제를 되살리면 안 된다.
   *   · 장부에 없는 열쇠의 alias 는 받아 두고(shareAliasWait) project 칸이 오면 함께 넣는다(applyProject 는 별칭만으로 과제를 만들지 않는다) — 동료 폴더에서 처음 받는 과제의 이름이 별칭이 되게.
   *   · 처음 받는 과제(memo[열쇠].at 이 0)의 project 칸에서 파일 값이 '' 인데 장부에 값이 있는 WORKSPACE 몫 칸(Job Id·I/O·연구기간·비고·과제번호)은 지우지 않고 둔다 — rerp(책임자)가 먼저 만든 파일은 그 칸이 다 비어 있어
   *     "파일 쪽이 기준" 규칙대로면 장부 값을 지웠다. 둔 칸은 그 시각을 지금으로 적어 맞춘 뒤 한 번 더 돌 때(shareRepush) 파일로 올라간다. 같은 사람의 다른 WORKSPACE 기기가 적은 값(비어 있지 않은 것)은 그대로 받는다.
   *   · 묘비로 과제를 지웠으면 그 열쇠에 이어 둔 연구내용 기록의 연결(prjNo …)을 끊는다 — 남아 있으면 그 열쇠가 매번 대상이 되어 만들고 지우기를 되풀이했다.
   */
  const SHARE_WS_FIELDS = Object.freeze({ jobId: 'job', io: 'io', start: 'start', end: 'end', note: 'note', code: 'code' });   // 파일 project 칸 → 장부 칸(WORKSPACE 몫)
  /** 받은 예산 계획·변경이력 한 칸을 그 과제의 차년도에(src/rndshare.js applyYear) — 장부의 그 과제를 바꿔 끼우고 예산이면 받은 줄의 at 를 memo 에(다음 맞춤에 같은 내용을 다시 쓰지 않게). 바뀌었으면 true. */
  function shareApplyYearPart(p, prj, n, part, data) {
    if (!p) return false;
    const r = shareApplyYear(p, n, part, data);
    if (r.changed) st.book.projects[st.book.projects.indexOf(p)] = r.project;
    if (part === 'budget') st.share.memo[`${prj}@${n}`] = { h: shareBudgetHash(r.project, n), at: Number(data?.at) || Date.now() };
    return r.changed;
  }
  /** 받은 alias · support · project 칸 → applyProject 에 줄 칸들(모양이 아니면 null). support 는 정본 toLocalYear 의 { people, at, all } 또는 사람 목록만(2026-10-19). */
  function shareFieldsOf(part, data) {
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    if (part === 'alias') return isObj(data) ? { alias: String(data.alias ?? ''), aliasAt: Number(data.aliasAt) || 0 } : { alias: String(data ?? ''), aliasAt: Date.now() };
    if (part === 'support') return isObj(data) ? { support: Array.isArray(data.people) ? data.people : Array.isArray(data.support) ? data.support : [], supportAt: Number(data.at ?? data.supportAt) || 0 } : { support: Array.isArray(data) ? data : [], supportAt: Date.now() };
    return isObj(data) ? { ...data } : null;
  }
  /**
   * 공유 폴더에서 더하는 과제(shareAdopting)를 장부에 만든다(2026-10-19) — 과제명·책임자는 rERP 진행 과제 목록의 것(shareAdoptInfo), 받아 둔 칸(w.parts — 그 파일에서 project 칸보다 먼저 온 예산 계획·변경이력·별칭·행정지원)을 넣고,
   * 그 연차(받아 둔 예산 계획·변경이력의 가장 낮은 연차, 없으면 1차년도 — erpOf 는 이어 둔 가장 낮은 연차로 되돌아가 열쇠는 과제번호)를 rERP 에 잇는다. 이 장부의 몫(wsId 등)이 파일로 가게 맞춘 뒤 한 번 더 돈다(shareRepush). 열 개 한도에 걸리면 null.
   */
  function shareAdoptCreate(prj, w) {
    const info = shareObj(st.shareAdoptInfo[prj]);
    const parts = Array.isArray(w?.parts) ? w.parts : [];
    const yearOf = (d) => Number(String(d?.year ?? '').split('@').pop()) || 0;
    const n = parts.filter((x) => x.part === 'budget' || x.part === 'changes').map((x) => yearOf(x.data)).filter((k) => k >= 1).sort((a, b) => a - b)[0] || 1;
    const r = shareApplyProject(st.book, prj, { prjNo: prj, prjNm: String(info.prjNm || prj), rspr: String(info.rspr || '') }, st.share.memo, { now: Date.now(), n });
    if (!r?.created || !r.id) return null;
    st.book = r.book;
    st.share.memo = shareObj(r.memo);
    for (const x of parts) {
      const p = projectOf(st.book, r.id);
      if (!p) break;
      if (x.part === 'budget' || x.part === 'changes') { const k = yearOf(x.data); if (k >= 1) shareApplyYearPart(p, prj, k, x.part, x.data); continue; }
      const f = shareFieldsOf(x.part, x.data);
      if (!f) continue;
      const r2 = shareApplyProject(st.book, prj, f, st.share.memo, { now: Date.now() });
      if (r2?.book) { st.book = r2.book; st.share.memo = shareObj(r2.memo); }
    }
    const q = projectOf(st.book, r.id);
    if (!q) return null;
    st.share.memo[prj] = Object.assign({}, shareObj(st.share.memo[prj]), { hash: shareInfoHash(q) });
    st.shareAdopted++;
    st.shareRepush = true;
    logEvent('rnd', true, `R&D 과제 더함(공유 폴더에서 받음 — rERP 참여 과제): ${label(q)} (${prj})`);
    return q;
  }
  /** 맞춤이 끝났는데 아직 장부에 없는 더할 과제(shareAdoptWait — WORKSPACE 몫 칸이 다 비어 project 칸이 오지 않은 rerp 파일)를 만든다. 만든 수를 돌려준다. 받은 것을 들이는 동안(shareApplying) 되돌이 동기화는 막는다. */
  function shareAdoptFlush() {
    let made = 0;
    st.shareApplying = true;
    try {
      for (const [prj, w] of Object.entries(shareObj(st.shareAdoptWait))) if (!shareProjectByKey(prj) && shareAdoptCreate(prj, w)) made++;
      st.shareAdoptWait = {};
      if (made) {
        st.book = normalizeBook(st.book);
        paintAll();
        save();
      }
    } finally {
      st.shareApplying = false;
    }
    return made;
  }
  async function shareSaveLocal(part, prj, data) {
    prj = String(prj || '');
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    if (shareTombs()[prj] && !shareProjectByKey(prj)) return;   // 지운 과제의 열쇠 — 받을 것이 없다(묘비만 퍼뜨린다)
    if (part === 'plan') {
      const d = shareObj(data);
      let plans = shareObj(d.plans);
      if (!Object.keys(plans).length && Array.isArray(d.items)) plans = KRX_PLAN_SYNC.unflatten(d.items.map((it) => Object.assign({ prj }, it)));
      if (Object.values(plans).some(Array.isArray)) plans = { [prj]: plans };   // 이 과제 몫({ key: [항목] })이 왔다
      let del = shareObj(d.del);
      if (!Object.values(del).some(isObj)) {   // 이 과제 몫 숫자 맵 → 전체 묘비 맵에 되돌려 넣기(다른 과제의 묘비는 그대로)
        const cur = shareObj((await chrome.storage.local.get(PLAN.DKEY))?.[PLAN.DKEY]);
        del = KRX_PLAN_SYNC.putBack({ plans: {}, del: cur }, prj, [], del).del;
      }
      await PLAN.save(plans, del, prj);
      st.pl.plans = await PLAN.load();
      return;
    }
    if (part === 'research') {
      const map = await RS.load();
      const names = shareContext().names;
      let recs = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.recs) ? data.recs : null;
      if (!recs && isObj(data)) recs = Object.values(data).filter((r) => r && r.prjNo === prj);
      for (const [id, rec] of Object.entries(map)) if (rec && rec.prjNo === prj) delete map[id];
      for (const rec of recs || []) if (rec && rec.id) map[rec.id] = Object.assign({}, rec, rec.prjNo ? {} : { prjNo: prj, prjNm: rec.prjNm || names[prj] || '', linkBy: rec.linkBy || 'auto' });
      for (const [id, rec] of Object.entries(shareObj(isObj(data) ? data.others : null))) {
        const cur = map[id];
        if (!rec?.id || !cur?.prjNo || cur.prjNo === prj) continue;
        const keep = {};
        for (const k of ['prjNo', 'prjNm', 'linkBy', 'src']) if (cur[k] !== undefined) keep[k] = cur[k];
        map[id] = Object.assign({}, rec, keep);
      }
      await RS.save(map);
      return;
    }
    if (part === 'staff') return;   // 참여연구원 계획은 rERP 에서 읽는다(2026-10-18 저녁) — 받지도 올리지도 않는다
    st.shareApplying = true;
    try {
      st.share.memo = shareObj(st.share.memo);
      // 열쇠로 못 찾으면(이은 뒤 열쇠가 바뀐 과제 등) 받은 project 칸으로 맞춘다 — src/rndshare.js matchProject(wsId → prjNo → code → name).
      let p = shareProjectByKey(prj);
      if (!p && isObj(data)) { try { p = shareMatchProject(st.book, { project: Object.assign({ prjNo: prj }, data) }) || null; } catch { p = null; } }
      let touched = false;
      // 공유 폴더에서 더하는 과제(shareAdopting — 2026-10-19): project 칸보다 먼저 오는 칸(budget · changes · alias · support)은 받아 두고(shareAdoptWait), project 칸이 오면 만든다 — 파일에 deletedAt 이 있으면(다른 기기가 지운 과제 — 묘비가 지난 뒤 폴더만 남은 것) 만들지 않고 버린다.
      //   project 칸은 WORKSPACE 몫 칸이 파일과 다를 때만 오므로(rerp 가 만든 파일은 다 비어 있어 안 온다) 안 오면 맞춤이 끝날 때 만든다(shareAdoptFlush).
      if (!p && st.shareAdopting.includes(prj)) {
        const w = st.shareAdoptWait[prj] = shareObj(st.shareAdoptWait[prj]);
        if (part !== 'project') { (w.parts = Array.isArray(w.parts) ? w.parts : []).push({ part, data }); return; }
        delete st.shareAdoptWait[prj];
        if (isObj(data) && Number(data.deletedAt) > 0) return;
        p = shareAdoptCreate(prj, w);
        if (!p) return;
        touched = true;
      }
      if (part === 'budget' || part === 'changes') {
        if (!p || !isObj(data) && !Array.isArray(data)) return;
        const n = Number(String((isObj(data) ? data.year : '') ?? '').split('@').pop()) || 0;
        if (!(n >= 1)) return;
        touched = shareApplyYearPart(p, prj, n, part, data) || touched;
      } else if (part === 'alias' || part === 'project' || part === 'support') {
        // support(행정지원 — 정본 toLocalYear 의 { people, at, all } 또는 사람 목록만): 별칭과 같은 길 — applyProject 가 support·supportAt 을 들인다(2026-10-19)
        let fields = shareFieldsOf(part, data);
        if (!fields) return;
        if (!p && part !== 'project') { st.shareAliasWait[prj] = { ...shareObj(st.shareAliasWait[prj]), ...fields }; return; }   // 어느 과제인지 아직 모른다 — project 칸이 오면 함께(applyProject 는 별칭·행정지원만으로 만들지 않는다)
        if (!p && st.shareAliasWait[prj]) { fields = { ...st.shareAliasWait[prj], ...fields }; delete st.shareAliasWait[prj]; }
        // 처음 받는 과제 — 파일에 비어 있는 WORKSPACE 몫 칸은 장부 값을 두고(rerp 가 먼저 만든 파일), 그 값이 다음 맞춤에 올라가게 시각을 지금으로
        let kept = 0;
        if (p && part === 'project' && st.share.memo[prj] && Number(st.share.memo[prj].at) === 0) {
          for (const [k, f] of Object.entries(SHARE_WS_FIELDS)) if (fields[k] === '' && p[f]) { delete fields[k]; kept++; }
        }
        const r = shareApplyProject(st.book, prj, fields, st.share.memo, { now: Date.now() });
        if (r && r.book) {
          st.book = r.book;
          st.share.memo = shareObj(r.memo);
          touched = touched || r.created || r.removed || !!r.renamed || r.changed.length > 0;
          if (r.aliasFixed) logEvent('rnd', true, `R&D 과제 별칭(공유에서 받음 — 겹쳐 비켜 감): ${r.alias}`);
          if (r.removed) {
            logEvent('rnd', true, `R&D 과제 지움(공유에서 받음 — 다른 기기가 지웠다): ${prj}`);
            await shareUnlinkResearch(prj);   // 이 열쇠에 이어 둔 기록을 끊는다 — 남아 있으면 다음 맞춤마다 이 열쇠가 대상이 된다
          }
          const q = r.id ? projectOf(st.book, r.id) : null;
          if (q) st.share.memo[prj] = Object.assign({}, shareObj(st.share.memo[prj]), { hash: shareInfoHash(q) });   // 받은 뒤의 지문 — 이것과 다르면 이 기기에서 고친 것
          if (q && kept) {
            st.share.memo[prj].at = Date.now();   // 둔 칸은 이 기기가 주인 — 파일(updatedAt 이 이보다 앞)을 이긴다
            st.shareRepush = true;                // 이번 쓰기는 병합 결과(빈 값)로 나갔으니 한 번 더 돌아 올린다(afterShareSync)
            logEvent('rnd', true, `R&D 공유 처음 받기(${prj}): 파일에 비어 있는 칸 ${kept}개는 장부 값을 두고 다음 맞춤에 올린다`);
          }
        }
      } else {
        throw new Error(`모르는 저장 칸: ${part}`);
      }
      if (!touched) return;
      st.book = normalizeBook(st.book);
      if (st.editing && st.editing !== 'new' && !projectOf(st.book, st.editing)) { st.editing = null; el.form.classList.add('hidden'); }
      paintAll();
      save();   // shareSoon 은 shareApplying 동안 막힌다 — 맞춘 뒤의 지문은 afterShareSync 가 적는다
    } finally {
      st.shareApplying = false;
    }
  }

  /**
   * rERP 에 이어 공유 열쇠가 바뀐 과제(장부 id·Job Id → rERP 과제번호)의 폴더를 이어 쓴다(2026-10-19 검토) — 공유가 켜져 있고 옛 열쇠로 맞춘 폴더(shareIndex)를 알면 그 폴더의 연차 파일(·예상비용.json)의
   * project.prjNo 를 새 열쇠로 고쳐 쓰고, 폴더 색인·맞춘 기억(memo — 열쇠·열쇠@n)·마지막 결과(pages)를 새 열쇠로 옮긴다. 안 하면 prjdocsync 가 파일 안의 prjNo(옛 열쇠)로 폴더를 옛 과제 것으로 보아
   * 새 열쇠에 '<약칭>-<과제번호>' 폴더를 따로 만들었다(옛 폴더는 버려지고 동료 rerp 가 보는 폴더와도 어긋남). 새 열쇠에 이미 폴더가 있으면(책임자·동료가 먼저 만든 rERP 과제 폴더) 옛 폴더는 건드리지 않는다 — 그 폴더를 쓰고 로컬 자료는 거기로 올라간다.
   * 다른 WORKSPACE 기기에 같은 과제가 이어지지 않은 채 있으면 그 기기는 그 과제도 rERP 에 이어야 같은 폴더를 쓴다(그때까지는 제 열쇠로 폴더를 하나 더 만든다 — 이어지지 않은 과제는 이 장부만의 것이라 그렇다).
   * 도는 중인 맞춤이 있으면 끝날 때까지(최대 20초) 기다리고, 그동안·고쳐 쓰는 동안 shareSoon 은 막는다(shareApplying).
   */
  async function shareRekey(p, oldKey) {
    const newKey = keyOfProject(p);
    if (!p || !oldKey || oldKey === newKey || !st.share.on) return false;
    for (let i = 0; i < 100 && st.shareBusy; i++) await new Promise((r) => setTimeout(r, 200));
    const was = st.shareApplying;
    st.shareApplying = true;
    try {
      const index = shareObj((await chrome.storage.local.get('shareIndex'))?.shareIndex);
      const e = index[oldKey];
      if (!e || !e.folder) return false;   // 옛 열쇠로 맞춘 폴더가 없다 — 다음 맞춤이 새 열쇠로 만든다
      if (index[newKey]?.folder) { logEvent('rnd', true, `R&D 공유: ${label(p)} 의 rERP 과제 ${newKey} 폴더(${index[newKey].folder})가 이미 있어 옛 폴더 ${e.folder} 는 두고 그것을 씁니다`); return false; }
      const now = shareCfgNow();   // 칸의 값, 비면 rERP 확장의 설정(마지막으로 물어 둔 것)
      const cfg = await share.shareProjectCfg(oldKey, { folder: now.folder, driveHost: now.driveHost }, index);
      if (!cfg) return false;
      const names = ((await SPX.listFiles(cfg, spIo())) || []).map((f) => String(f?.name || '')).filter((nm) => KRX_PRJDOC.isYearName(nm) || KRX_PRJDOC.isPlanName(nm));
      const erp = erpOfProject(p);
      const w = await SPX.openWriter(cfg, spIo());
      let n = 0;
      try {
        for (const name of names) {
          const r = await w.modify(name, (cur) => {
            const parsed = cur == null ? null : KRX_PRJDOC.parse(cur, { year: KRX_PRJDOC.isYearName(name) });
            if (!parsed) return { changed: false };
            const prjNo = String(parsed.doc.project.prjNo || '');
            if (prjNo && prjNo !== oldKey) return { changed: false };   // 남의 과제 파일 — 건드리지 않는다
            parsed.doc.project.prjNo = newKey;
            if (parsed.kind === 'year' && erp) { if (erp.prjNm) parsed.doc.project.prjNm = erp.prjNm; if (erp.rspr) parsed.doc.project.rspr = erp.rspr; }
            return { changed: true, text: KRX_PRJDOC.serialize(parsed.doc) };
          }, { comment: `KRS WORKSPACE rERP 잇기 ${myName() ? `· ${myName()} ` : ''}${new Date().toISOString()}` });
          if (r?.changed) n++;
        }
      } finally { try { await w.close(); } catch { /* 이미 닫힘 */ } }
      index[newKey] = Object.assign({}, e, { at: Date.now() });
      delete index[oldKey];
      await chrome.storage.local.set({ shareIndex: index });
      const memo = st.share.memo = shareObj(st.share.memo);
      for (const k of Object.keys(memo)) {
        if (k !== oldKey && !k.startsWith(`${oldKey}@`)) continue;
        const nk = newKey + k.slice(oldKey.length);
        if (!memo[nk]) memo[nk] = memo[k];
        delete memo[k];
      }
      const pages = st.shareState?.pages;
      if (pages && pages[oldKey]) { pages[newKey] = Object.assign({}, pages[oldKey], { prjNo: newKey }); delete pages[oldKey]; }
      saveShare();
      logEvent('rnd', true, `R&D 공유 폴더 이어 쓰기: ${e.folder} (${oldKey} → ${newKey}, 파일 ${n}개)`);
      return true;
    } catch (err) {
      logEvent('rnd', false, `R&D 공유 폴더 이어 쓰기 실패(${oldKey} → ${newKey}): ${String(err?.message || err)}`);
      return false;
    } finally {
      st.shareApplying = was;
    }
  }

  /** 그 열쇠에 이어 둔 연구내용 기록(researchPlans)의 연결 칸(prjNo·prjNm·linkBy·src)을 끊는다 — 과제를 지운 뒤(묘비를 받았거나 여기서 지웠거나). 기록은 남는다(같은 이름의 과제가 다시 생기면 researchOf 가 이름으로 다시 잇는다). */
  async function shareUnlinkResearch(prj) {
    let map;
    try { map = await RS.load(); } catch { return 0; }
    let n = 0;
    for (const [id, rec] of Object.entries(shareObj(map))) {
      if (!rec || rec.prjNo !== prj) continue;
      const o = { ...rec };
      for (const k of ['prjNo', 'prjNm', 'linkBy', 'src']) delete o[k];
      map[id] = o;
      n++;
    }
    if (n) await RS.save(map);
    return n;
  }

  /** 폴더를 새로 만들 때 공유할 참여연구원 이름(내 이름은 sharesync 가 뺀다) — 이어진 rERP 참여인력(받아 둔 것, 없으면 지금 조회), 없으면 계획서의 참여연구자. */
  async function shareParticipants(prjNo) {
    const p = shareProjectByKey(String(prjNo || ''));
    if (!p) return [];
    const out = new Set();
    const add = (name) => { const s = String(name || '').trim(); if (s) out.add(s); };
    for (const y of Object.values(p.years || {})) for (const x of y?.erp?.staff?.people || []) add(x?.name);
    const e = shareFileProject(p);
    if (!out.size && e.prjNo && st.set.erp) {
      try { for (const r of await fetchParticipants(erp, e.prjNo)) add(r?.name || r?.EMP_NM); } catch { /* 로그인이 풀렸으면 계획서의 참여연구자로 */ }
    }
    if (!out.size) for (const y of Object.values(p.years || {})) for (const x of parseRoster(fileLog(y, 'roster')?.text) || []) add(x.name);
    return [...out];
  }

  /* ---------- 공유 (Plus) 설정 — 2026-10-25 사용자 지정("rerp 에서 plus 기능을 워크스페이스에서 동일하게 … 둘은 같이 내용을 공유하는 거야" · "rerp 설정을 따름") ---------- */

  /** 지금 쓰는 공유 (Plus) 설정 — 여기서 바꾼 칸(rndShare.own) > rERP 확장의 것(peer.plus — 마지막으로 물어 둔 답) > 기본(src/rndshare.js plusOf). */
  const plusNow = () => plusOf(st.share.own, shareObj(st.share.peer).plus);
  /** plusNow 를 읽는 곳이 많은 두 칸(on · shareWith)에 적어 둔다. 켜짐이 바뀌었으면 true. */
  function applyPlus() {
    const p = plusNow(), was = !!st.share.on;
    st.share.on = p.enabled;
    st.share.shareWith = p.shareWith;
    return was !== p.enabled;
  }
  /** 켜짐이 바뀌었다(여기서 바꿈 · rERP 확장을 따라) — 형편을 비우고 꺼졌으면 맞춤을 멈춘다. 켜졌을 때 맞추는 것은 부른 쪽. */
  function shareOnChanged(why = '') {
    st.share.error = '';
    st.shareKind = '';
    st.shareNote = null;
    if (!st.share.on) { st.share.last = ''; clearTimeout(shareTimer); shareAutoStop(); }
    saveShare();
    paintShare();
    paintSet();
    paintErp();
    logEvent('rnd', true, `R&D 공유 (SharePoint) ${st.share.on ? '켬' : '끔'}${why ? ` — ${why}` : ''}`);
  }
  /** 칸 이름 — 활동 로그 글(참여연구원 자동 공유는 2026-10-19 카드의 글 그대로). */
  const PLUS_LABEL = Object.freeze({ shareWith: '참여연구원 자동 공유', discover: '공유받은 과제 자동 찾기', projectSync: '과제별 공유', scope: '공유할 과제', projects: '고른 과제', planSync: '예상 비용', researchSync: '연구내용', staffSync: '사업비', changesSync: '변경이력' });
  /**
   * 설정 › Plus 의 칸 하나를 여기서 바꾼다(plusSet — rERP 확장의 값과 같아지면 다시 따른다). 켜짐이 바뀌면 켜고 끄고,
   * 그 밖의 칸은 켜져 있으면 잠깐 뒤 맞춘다(체크를 여럿 누르면 모아서 한 번 — 자동 공유는 새 폴더에만 쓰여 맞추지 않는다).
   */
  async function onPlusSet(key, value) {
    st.share.own = plusSet(st.share.own, key, value, shareObj(st.share.peer).plus);
    if (applyPlus() || key === 'enabled') {
      shareOnChanged();
      if (st.share.on) { shareAutoStart(); await runShare('켬'); }
      return;
    }
    saveShare();
    paintShare();
    paintErp();
    const text = typeof value === 'boolean' ? (value ? '켬' : '끔') : key === 'scope' ? (value === 'pick' ? '고른 과제만' : '참여 과제 전체') : Array.isArray(value) ? `${value.length}개` : String(value);
    logEvent('rnd', true, key === 'shareWith' ? `R&D 공유 — ${PLUS_LABEL.shareWith} ${value === 'none' ? '끔' : '켬'}` : `R&D 공유 — ${PLUS_LABEL[key] || key}: ${text}`);
    if (st.share.on && key !== 'shareWith') { clearTimeout(shareTimer); shareTimer = setTimeout(() => runShare('설정'), NOTE_WAIT_MS); }
  }
  /** [rERP 설정 따르기] — 여기서 바꾼 칸과 공유 폴더 칸을 비워 rERP 확장의 설정을 다시 따른다. */
  async function onPlusFollow() {
    st.share.own = {};
    el.shareFolder.value = '';
    await saveShareFolder();
    if (applyPlus()) shareOnChanged('rERP 확장의 설정을 따름');
    saveShare();
    paintShare();
    logEvent('rnd', true, 'R&D 공유 (Plus) — rERP 확장의 설정을 따름');
    if (st.share.on) { shareAutoStart(); runShare('설정'); }
  }
  /** [연결 확인] — 칸의 주소를 먼저 저장하고(바뀌었을 때만) 밑폴더를 풀어 과제 폴더 목록·나와 공유를 받아 본다(sharesync shareProbe). */
  async function onPlusProbe() {
    el.plusProbe.disabled = true;
    setPlusMsg('연결 확인 중…');
    const moved = await saveShareFolder();
    let r;
    try { r = await share.send({ type: 'shareProbe' }); } catch (err) { r = { ok: false, message: String(err?.message || err) }; }
    el.plusProbe.disabled = false;
    const text = r?.ok ? `${r.message}${r.folder?.path ? ` · ${r.folder.path}` : ''}`
      : r?.kind === 'auth' ? 'OneDrive 에 로그인하세요 — 폴더 열기에서 Microsoft 에 로그인한 뒤 다시 누르세요' : `연결하지 못했습니다 — ${r?.message || r?.error || '응답 없음'}`;
    setPlusMsg(text, !r?.ok);
    logEvent('rnd', !!r?.ok, `R&D 공유 연결 확인: ${text}`);
    if (moved && st.share.on) runShare('폴더');
  }
  /** [주소 복사] — 지금 쓰는 밑폴더를 여는 주소(sharesync shareFolderCopy — 꺼져 있어도 된다). 못 쓰면 주소를 줄에 보인다. */
  async function onPlusCopy() {
    let r;
    try { r = await share.send({ type: 'shareFolderCopy' }); } catch (err) { r = { ok: false, message: String(err?.message || err) }; }
    if (r?.ok) setPlusMsg(r.copied ? `주소를 복사했습니다 — ${r.url}` : `복사하지 못했습니다 — 직접 복사하세요: ${r.url}`, !r.copied);
    else setPlusMsg(`주소를 얻지 못했습니다 — ${r?.message || r?.error || '응답 없음'}`, true);
  }
  function setPlusMsg(text, bad = false) {
    el.plusProbeState.textContent = text;
    el.plusProbeState.classList.toggle('error', !!bad);
  }
  /** 고를 수 있는 과제 — 장부의 과제(열쇠 · 별칭) 차례로, 그 뒤에 고른 것 가운데 장부에 없는 열쇠(rERP 확장에서 고른 과제 — 마지막 결과의 제목으로). */
  function plusPickItems(P) {
    const items = st.book.projects.map((p) => ({ key: keyOfProject(p), label: p.alias || p.name, title: `${p.name} · ${keyOfProject(p)}` }));
    const known = new Set(items.map((x) => x.key));
    for (const key of P.projects) if (!known.has(key)) items.push({ key, label: String(st.shareState?.pages?.[key]?.title || key), title: `${key} — 이 장부에 없는 과제` });
    return items;
  }
  /** 설정 › Plus 의 나머지 — 따르기 줄 · 공유 방식 · 과제별 공유(켜기 · 공유할 과제 · 항목) · 지금 밑폴더 · 과제 줄. 설정 칸은 꺼져 있어도 고른다(rerp 옵션처럼). */
  function paintPlus(P) {
    const peer = shareObj(st.share.peer), peerPlus = shareObj(peer.plus);
    const own = Object.keys(normalizePlus(st.share.own)).length + (st.share.folder ? 1 : 0);
    const partial = Number(peer.at) > 0 && Object.keys(peerPlus).every((k) => k === 'enabled');   // 켜기·폴더만 답하는 rERP 확장(공유할 과제·항목을 아직 안 실어 줌)
    el.plusFollow.textContent = !(Number(peer.at) > 0) ? 'rERP 확장 없음 — 이 확장의 설정' : `rERP 확장의 설정을 따름${partial ? '(켜기·폴더)' : ''}${own ? ` · 여기서 바꾼 칸 ${own}개` : ''}`;
    el.plusFollow.classList.toggle('on', Number(peer.at) > 0 && !own);
    el.plusFollowReset.hidden = !(Number(peer.at) > 0 && own);
    el.plusDiscover.checked = P.discover;
    el.plusProjectSync.checked = P.projectSync;
    el.plusScopeAll.checked = P.scope !== 'pick';
    el.plusScopePick.checked = P.scope === 'pick';
    for (const [k, node] of Object.entries(el.plusItems)) node.checked = P[k];
    el.plusSummary.textContent = !P.projectSync ? '꺼짐' : P.scope === 'pick' ? `고른 과제 ${P.projects.length}개` : '참여 과제 전체';
    el.plusPick.hidden = P.scope !== 'pick';
    const items = plusPickItems(P);
    const sig = JSON.stringify([items, P.projects]);
    if (el.plusPick.dataset.sig !== sig) {   // 다시 그리면 누르던 체크의 초점이 날아가니 바뀔 때만
      el.plusPick.dataset.sig = sig;
      const on = new Set(P.projects);
      el.plusPick.innerHTML = items.length
        ? items.map((x) => `<label class="tab-pick" title="${escapeHtml(x.title)}"><input type="checkbox" data-key="${escapeHtml(x.key)}"${on.has(x.key) ? ' checked' : ''} />${escapeHtml(x.label)}</label>`).join('')
        : '<span class="hint">R&amp;D 탭에 과제가 없습니다</span>';
    }
    const s = st.shareState, now = shareCfgNow();
    el.plusFolderNow.textContent = String(s?.base?.path || now.folder || '내 OneDrive 문서/업무/shared');
    el.plusCopy.disabled = st.shareBusy;
    const pages = Object.entries(shareObj(s?.pages)).map(([key, pg]) => ({ key, ...shareObj(pg) }));
    const name = (pg) => { const p = shareProjectByKey(pg.key); return p ? (p.alias || p.name) : String(pg.title || pg.key); };
    pages.sort((a, b) => name(a).localeCompare(name(b), 'ko'));
    el.plusPages.innerHTML = plusPagesHtml(pages, name);
  }
  /** 동기화 현황의 과제 줄 — 이름(과제 폴더 링크) · 연차 · 결과 · 주인(남의 폴더). */
  function plusPagesHtml(pages, name) {
    return pages.map((pg) => {
      const result = pg.error ? `실패 — ${pg.error}` : pg.noFolder ? '폴더 없음 — 책임자가 만들어 공유할 때까지'
        : [pg.folderCreated && '폴더 만듦', pg.pulled && '받음', pg.pushed && '씀', pg.renameError && '이름 못 바꿈'].filter(Boolean).join(' · ') || '맞음';
      const years = Array.isArray(pg.years) && pg.years.length ? `${pg.years.join('·')}차년도` : '';
      const meta = [pg.folder && pg.folder !== name(pg) ? `폴더 ${pg.folder}` : '', years, result, pg.owner ? `주인 ${pg.owner}` : ''].filter(Boolean).join(' · ');
      const head = pg.folderUrl ? `<a href="${escapeHtml(pg.folderUrl)}" target="_blank" rel="noopener">${escapeHtml(name(pg))}</a>` : `<strong>${escapeHtml(name(pg))}</strong>`;
      return `<li class="plus-page${pg.error ? ' bad' : ''}">${head}<span>${escapeHtml(meta)}</span></li>`;
    }).join('');
  }

  /** 공유 카드(설정 › Plus) — 켜짐 · 공유 폴더 칸 · 상태("꺼짐" / "맞춤 MM.DD HH:MM · 과제 n개" / 오류 — 로그인 필요면 "OneDrive 에 로그인하세요" + 폴더 열기) · 알림 줄 · 단추 · 설정 칸(paintPlus),
   *  R&D 설정의 한 줄(shareGo). rerp/planui.js 가 읽는 화면 상태(planSync·sharePick·myNames)도 여기서 맞춘다. */
  function paintShare() {
    const q = st.share, s = st.shareState, P = plusNow();
    el.shareOn.checked = !!q.on;
    if (document.activeElement !== el.shareFolder) el.shareFolder.value = q.folder || '';
    el.shareFolder.disabled = st.shareBusy;
    if (el.shareWith) el.shareWith.checked = q.shareWith !== 'none';
    el.shareSync.disabled = st.shareBusy || !q.on;
    el.shareLink.disabled = st.shareBusy || !q.on;
    const auth = !!q.error && st.shareKind === 'auth';
    const count = s && Number.isFinite(Number(s.count)) ? Number(s.count) : null;
    el.shareState.textContent = !q.on ? '꺼짐' : st.shareBusy ? '맞추는 중…' : q.error ? (auth ? 'OneDrive 에 로그인하세요' : '못 맞춤') : q.at ? `맞춤 ${when(q.at)}${count != null ? ` · 과제 ${count}개` : ''}` : '켜짐';
    if (el.shareGoState) el.shareGoState.textContent = el.shareState.textContent;
    const note = st.shareNote;
    // rERP 확장의 설정을 따르는 중이면 칸의 빈 자리에 그 값을 보인다(2026-10-19). 결과 줄 끝에 맞춘 밑폴더 경로(rerp 옵션의 "지금 쓰는 밑폴더" 와 견주게)와, 칸에 값이 있는데 rERP 확장의 것과 다르면 알림.
    const now = shareCfgNow();
    el.shareFolder.placeholder = now.following ? `rERP 확장의 설정을 따름 — ${now.folder || '내 OneDrive 의 문서/업무/shared'}` : '비우면 내 OneDrive 의 문서/업무/shared';
    const basePath = String(s?.base?.path || '');
    const peerPath = String(now.peer.path || '');
    const norm = (v) => String(v).replace(/\/+$/, '').toLowerCase();
    const differs = !!q.folder && Number(now.peer.at) > 0 && (peerPath && basePath ? norm(peerPath) !== norm(basePath) : String(now.peer.folder || '') !== String(q.folder));
    const tail = `${basePath ? ` · 밑폴더 ${basePath}` : ''}${differs ? ` · rERP 확장의 공유 폴더(${now.peer.folder || '내 OneDrive 문서/업무/shared'})와 다릅니다 — 같은 폴더를 쓰려면 칸을 비우세요` : ''}`;
    el.shareMsg.textContent = q.on ? String(note?.text || q.error || (q.last ? `${q.last}${tail}` : '')) : '';
    el.shareMsg.classList.toggle('error', !!(q.on && (note ? note.error : q.error)));
    // 폴더 열기(단추 — 누르면 새 탭) — 보고 있는 과제의 폴더(알면), 아니면 밑폴더(viewUrl), 아니면 OneDrive(로그인하러)
    const p = cur();
    const pg = p && s?.pages ? s.pages[keyOfProject(p)] : null;
    el.shareOpen.dataset.url = pg?.folderUrl || s?.base?.viewUrl || `${SHARE_DRIVE_HOST}/`;
    el.shareOpen.textContent = auth ? 'OneDrive 열기' : pg?.folderUrl ? `폴더 열기 — ${pg.folder || label(p)}` : '공유 폴더 열기';
    el.shareOpen.disabled = !q.on && !auth;
    // 머리 줄의 링크 아이콘(2026-10-19) — 공유 카드의 [조직 내 편집 링크]와 같은 길. 꺼져 있으면 누를 때 설정 › Plus 로 간다.
    el.headLink.disabled = st.shareBusy;
    el.headLink.title = !q.on ? 'SharePoint 링크 복사 — 공유 (SharePoint)가 꺼져 있습니다. 누르면 설정 › Plus 로'
      : `SharePoint 링크 복사 — ${pg?.folder && !pg.owner ? `과제 폴더 ${pg.folder}` : '공유 폴더'}의 조직 내 편집 링크`;
    st.pl.data.settings.planSync = !!q.on && P.projectSync && P.planSync;
    st.pl.data.settings.sharePick = P.scope === 'pick' ? P.projects : null;
    st.pl.data.myNames = [myName()].filter(Boolean);
    paintPlus(P);
  }

  /** [폴더 열기] — 새 탭으로(사이드패널은 chrome.tabs, 검사에서는 window.open). */
  function openShareFolder() {
    const url = el.shareOpen.dataset.url;
    if (!url) return;
    try { if (globalThis.chrome?.tabs?.create) { chrome.tabs.create({ url }); return; } } catch { /* 아래로 */ }
    window.open(url, '_blank', 'noopener');
  }

  /**
   * 공유 폴더 칸을 고치면 — 쓸 자리가 달라졌으면(shareEffective: 칸의 값, 비면 rERP 확장의 설정) 지난 지문(memo)·과제 → 폴더 캐시(shareIndex)·밑폴더 캐시(shareFolder)를 버린 뒤(shareReset) 켜져 있으면 바로 맞춘다.
   * 같은 자리면(rERP 확장이 따르던 값을 그대로 적은 때 등) 캐시를 둔다.
   */
  async function onShareFolder() {
    if (await saveShareFolder() && st.share.on) await runShare('폴더');
  }
  /** 칸의 주소를 저장한다(바뀌었을 때만 — 쓸 자리를 다시 정한다). 바뀌었으면 true. */
  async function saveShareFolder() {
    const v = el.shareFolder.value.trim().slice(0, 2000);
    if (v === String(st.share.folder || '')) return false;
    st.share.folder = v;
    st.shareNote = null;
    logEvent('rnd', true, `R&D 공유 폴더: ${v || '(비움 — rERP 확장의 설정, 없으면 내 OneDrive 문서/업무/shared)'}`);
    await shareEffective();
    paintShare();
    return true;
  }

  /** 장부를 고쳤으면(지난번에 맞춘 지문과 다르면) 잠깐 뒤 맞춘다 — 받은 것을 들이는 중(shareApplying)에는 아니다. */
  let shareTimer = null;
  function shareSoon() {
    if (!st.share.on || st.shareApplying) return;
    if (!st.shareDirty && shareHashOf(st.book) === st.shareHash) return;
    clearTimeout(shareTimer);
    shareTimer = setTimeout(() => runShare('고침'), NOTE_WAIT_MS);
  }

  /**
   * 주기 맞춤(2026-10-19 사용자 "이 시스템에서 sharepoint 의 변경사항을 반영하지 않네?") — R&D 탭이 보이고 공유가 켜져 있는 동안 SHARE_PERIOD_MS 마다 돈다(rerp 의 자동 갱신 알람에 해당 — 사이드패널에는 알람이 없고 탭이 닫히면 뜻도 없다).
   * sharesync 의 alarm 규칙대로 마지막 성공 1분 안이면 건너뛰고, 도는 중이면 그 결과를 같이 받는다. 탭을 숨기거나(hide) 공유를 끄면 멈춘다. 검사는 shareTick 을 바로 부른다.
   */
  const SHARE_PERIOD_MS = 5 * 60 * 1000;
  let shareEvery = null;
  function shareAutoStart() {
    shareAutoStop();
    if (!st.share.on) return;
    shareEvery = setInterval(() => { shareTick(); }, SHARE_PERIOD_MS);
    if (shareEvery && typeof shareEvery.unref === 'function') shareEvery.unref();   // node(검사)에서 프로세스를 붙들지 않게 — 브라우저는 숫자라 해당 없음
  }
  function shareAutoStop() {
    if (shareEvery) clearInterval(shareEvery);
    shareEvery = null;
  }
  function shareTick() {
    if (!st.share.on || st.shareBusy || el.root.classList.contains('hidden')) return Promise.resolve(false);
    return runShare('주기');
  }

  /** 까닭 → sharesync 의 reason: 열 때는 load(1분 안 재실행 안 함), 주기는 alarm(같은 규칙), 고침은 edit(도는 중이면 끝난 뒤 한 번 더), 그 밖은 manual. */
  const SHARE_REASON = Object.freeze({ '열 때': 'load', '주기': 'alarm', '고침': 'edit' });
  /** 공유 폴더와 맞춘다(한 번에 하나 — sharesync 가 모은다). 던지지 않는다 — 까닭은 칸에 보인다. */
  function runShare(reason = '지금 동기화') {
    if (!st.share.on) return Promise.resolve(false);
    clearTimeout(shareTimer);
    st.shareBusy = true;
    st.shareNote = null;
    paintShare();
    return share.send({ type: 'planSync', reason: SHARE_REASON[reason] || 'manual' })
      .catch((err) => ({ ok: false, error: String(err?.message || err), kind: 'error', at: Date.now() }))
      .then((r) => afterShareSync(r, reason));
  }

  /** 동기화가 끝나면 — 결과(rerp 와 같은 저장 키 planSyncState · plannedExpenses)를 화면 상태에 들이고 지문·묘비를 정리한다. */
  async function afterShareSync(r, reason = '') {
    st.shareBusy = false;
    // 꺼져 있을 때 들어온 요청(rerp/plan.js 의 load·view · 맞추는 사이 rERP 확장을 따라 꺼짐) · 고르지 않은 과제 하나(skipped 'project') — 맞추는 중 표시만 거둔다.
    // 켜져 있는데 맞출 것이 없으면(과제별 공유 꺼짐 · 고른 과제 없음) 그 까닭을 알림 줄에.
    if (!r || r.skipped === 'off' || r.skipped === 'project') {
      if (r?.skipped === 'off' && st.share.on && Array.isArray(r.missing) && r.missing.length) st.shareNote = { text: `맞출 것이 없습니다 — ${r.missing.join(' · ')}`, error: false };
      paintShare();
      return false;
    }
    try {
      const s = await chrome.storage.local.get([PLAN.KEY, PLAN.SKEY]);
      st.pl.plans = shareObj(s?.[PLAN.KEY]);
      st.pl.planSync = s?.[PLAN.SKEY] || st.pl.planSync;
    } catch { /* 저장소를 못 읽어도 결과는 r 에 있다 */ }
    if (r.pages || 'ok' in r) st.shareState = r;
    // 공유 폴더에서 더할 과제 가운데 project 칸이 오지 않아 아직 못 만든 것(2026-10-19) — 맞춤이 잘 끝났으면 지금 만든다(실패한 맞춤의 받아 둔 칸은 버린다)
    if (r.ok && r.skipped !== 'recent') shareAdoptFlush(); else st.shareAdoptWait = {};
    if (r.skipped !== 'recent') {
      const q = st.share, now = Date.now();
      const pages = shareObj(r.pages);
      if (r.ok) {
        q.at = Number(r.at) || now;
        q.error = '';
        st.shareKind = '';
        const list = Object.values(pages);
        const waiting = list.filter((pg) => pg?.noFolder).length, failed = list.filter((pg) => pg?.error).length;
        q.last = `맞췄습니다 — 과제 ${Number.isFinite(Number(r.count)) ? Number(r.count) : list.length}개${r.files ? ` · 파일 ${r.files}개` : ''}${r.written ? ` · 씀 ${r.written}` : ''}${r.pulled ? ` · 받음 ${r.pulled}` : ''}${st.shareAdopted ? ` · 더함 ${st.shareAdopted}` : ''}${waiting ? ` · 폴더 없음 ${waiting}(책임자가 만들어 공유할 때까지)` : ''}${failed ? ` · 실패 ${failed}` : ''}${st.shareAdoptNote ? ` · ${st.shareAdoptNote}` : ''}`;
      } else {
        st.shareKind = String(r.kind || 'error');
        q.error = st.shareKind === 'auth'
          ? `OneDrive 에 로그인하세요 — 이 브라우저에서 SharePoint(OneDrive)에 로그인한 뒤 지금 동기화를 누르세요${r.error ? ` (${r.error})` : ''}`
          : `공유 폴더와 맞추지 못했습니다 — ${r.error || r.message || '알 수 없는 오류'}`;
      }
      // 묘비 — 파일에 퍼졌고(쓴 과제) 90일이 지난 것은 버린다. 지문은 맞춘 뒤의 장부로.
      q.del = shareObj(q.del);
      for (const [key, t] of Object.entries(q.del)) if (!t || Number(t.at) < now - SHARE_TOMB_MS) delete q.del[key];
      st.shareHash = shareHashOf(st.book);
      st.shareDirty = false;
      saveShare();
      // 주기 맞춤은 쓰거나 받은 것이 있을 때만 활동 로그에(5분마다 한 줄씩 쌓이지 않게) — 실패는 늘
      if (reason !== '주기' || !r.ok || r.written || r.pulled || st.shareAdopted) logEvent('rnd', !!r.ok, `R&D 공유 맞춤(${reason || r.reason || ''}): ${r.ok ? `과제 ${Number(r.count) || 0}개 · 씀 ${r.written || 0} · 받음 ${r.pulled || 0}${st.shareAdopted ? ` · 더함 ${st.shareAdopted}` : ''}` : q.error}`);
    }
    st.shareAliasWait = {};
    const adopted = st.shareAdopted, adopting = st.shareAdopting;
    st.shareAdopted = 0;
    paintShare();
    drawErp();
    // 처음 받는 과제에서 빈 값으로 덮지 않고 둔 칸이 있으면 — 이번 쓰기는 병합 결과(빈 값)로 나갔으니 잠깐 뒤 한 번 더 돌아 장부 값을 올린다(memo 의 시각이 파일보다 늦어 이긴다). 공유 폴더에서 더한 과제도(wsId 등 이 장부의 몫을 파일로)
    if (st.shareRepush) { st.shareRepush = false; if (r.ok) { st.shareDirty = true; shareSoon(); } }
    // 이번 맞춤이 밑폴더를 훑어 **장부에 없는 내 참여 과제**를 새로 알아냈으면(캐시 shareIndex 가 이제야 그 폴더를 안다 — 처음 켤 때·rerp 가 새 폴더를 만든 뒤) 바로 한 번 더 돌아 더한다. 이번에 이미 대상이었던 열쇠는 다시 돌지 않는다(한도에 걸려 못 만든 것 등).
    if (r.ok && r.skipped !== 'recent' && !adopted) {
      const next = await shareAdoptable();
      if (next.keys.some((x) => !adopting.includes(x.key))) return runShare('더하기');
    }
    return !!r.ok;
  }

  /**
   * [링크 복사] — 보고 있는 과제의 폴더(알고 내 것이면), 아니면 밑폴더의 조직 내 편집 링크를 만들어 복사한다(sharesync shareOrgLink). 동료는 그 주소를 공유 폴더 칸(rerp 는 설정 › 공유 (Plus))에 붙여 넣는다.
   * 머리 줄의 링크 아이콘(from = el.headLink — 2026-10-19 사용자 지정 "shared point 링크 복사할 수 있게")도 같은 길이다 — 글 대신 잠깐 체크/× 로 알리고, 공유가 꺼져 있으면 R&D 설정의 공유 카드로 간다.
   */
  async function copyShareLink(from = el.shareLink) {
    const icon = from === el.headLink;
    if (!st.share.on) { if (icon) { headMark(from, false); goSettings({ share: true }); } return; }
    if (st.shareBusy) return;
    const tell = (ok, text) => (icon ? headMark(from, ok) : flash(from, text));
    const p = cur();
    const key = p ? keyOfProject(p) : '';
    const pg = key && st.shareState?.pages ? st.shareState.pages[key] : null;
    const prjNo = pg?.folder && !pg.owner ? key : '';
    el.shareLink.disabled = true;
    el.headLink.disabled = true;
    try {
      const r = await share.send({ type: 'shareOrgLink', prjNo });
      if (r?.ok && r.url) {
        const ok = !!r.copied || await copyText(r.url);
        tell(ok, ok ? '복사함' : '못 복사함');
        st.shareNote = { text: `${prjNo ? `과제 폴더 ${pg.folder}` : '공유 폴더'}의 조직 내 편집 링크를 ${ok ? '복사했습니다' : '만들었습니다(복사는 다시 눌러)'} — 동료는 공유 폴더 칸(rerp 는 설정 › 공유 (Plus))에 붙여 넣습니다`, error: false };
        logEvent('rnd', true, `R&D 공유 링크 복사: ${prjNo ? pg.folder : '밑폴더'}`);
      } else {
        tell(false, '못 만듦');
        st.shareNote = { text: `링크를 만들지 못했습니다 — ${r?.error || r?.message || '응답 없음'}`, error: true };
        logEvent('rnd', false, `R&D 공유 링크 실패: ${r?.error || r?.message || '응답 없음'}`);
      }
    } catch (err) {
      tell(false, '못 만듦');
      st.shareNote = { text: `링크를 만들지 못했습니다 — ${String(err?.message || err)}`, error: true };
    } finally {
      el.shareLink.disabled = !st.share.on;
      paintShare();
    }
  }

  const headTimers = new WeakMap();
  /** 머리 줄 아이콘을 잠깐 체크(못 했으면 ×)로 바꿨다가 제 그림으로 되돌린다 — 복사 아이콘(iconFlash)과 같은 꼴. */
  function headMark(btn, ok) {
    if (!btn.dataset.icon) btn.dataset.icon = btn.innerHTML;
    clearTimeout(headTimers.get(btn));
    btn.classList.toggle('done', ok);
    btn.classList.toggle('fail', !ok);
    btn.innerHTML = ok ? DONE_ICON : FAIL_ICON;
    headTimers.set(btn, setTimeout(() => {
      btn.classList.remove('done', 'fail');
      btn.innerHTML = btn.dataset.icon;
    }, ok ? 1500 : 3000));
  }

  /**
   * 머리 줄의 톱니 아이콘(2026-10-19 사용자 지정 "설정 아이콘 추가 해서 R&D 설정 으로 바로 가게") — 탭 맨 아래 R&D 설정 카드를 펴고 거기로 내린다.
   * 손으로 편 것으로 쳐서(setAuto 아님) 다른 차년도·과제로 가도 접지 않는다. share 면 공유 카드가 있는 설정 › Plus 로(2026-10-25 — R&D 설정에서 옮김).
   */
  function goSettings({ share: toShare = false } = {}) {
    if (toShare) { openPlus(); return; }
    el.setBox.open = true;
    st.setAuto = false;
    el.setBox.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }

  /* ---------------------------------------------------------- 연구내용 기록(rerp/research.js) — YAML 을 넣을 때 rerp 와 같은 기록(researchPlans — 과제명#차년도)으로도 남긴다 */
  // 2026-10-14 사용자 지정("workplace 에 기입한 것을 rerp 에 … 공유하면 동기화")의 받는 길이 2026-10-18 에 원노트 페이지에서 **연차 파일의 research 칸**으로 바뀌었다 — 올리는 단추·링크 복사는 없고,
  // 공유가 켜져 있으면 기록이 바뀐 뒤 잠깐 뒤 저절로 과제 폴더의 <n>차년도.json 으로 간다(shareLoadLocal 이 과제명·과제번호로 과제를 찾아 열쇠를 붙인다 — src/rndshare.js researchOf). rerp 는 같은 파일을 읽어 맞춘다.

  /** YAML 에서 읽은 기록들을 저장한다 — 더 오래된 판은 RS.put 이 건너뛴다. 새로 남은 것이 있으면 공유를 잠깐 뒤 맞춘다. 돌려주는 것은 새로 남은 기록 수. */
  async function storeResearch(recs) {
    const map = await RS.load();
    let touched = 0;
    for (const rec of recs) if (RS.put(map, rec).state !== 'older') touched++;
    await RS.save(map);
    if (touched) {
      st.shareDirty = true;
      shareSoon();
    }
    return touched;
  }

  /* ---------------------------------------------------------- 그리기·배선 */

  function paintAll() {
    paintProjects();
    paintHead();
    paintItems();   // 장부에 새 비목이 들어왔을 수 있다(YAML·JSON 들이기) — 설정의 비목 체크도 맞춘다
    paintShare();   // 공유 카드의 폴더 열기는 보고 있는 과제의 폴더
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
    // 연구내용 기록이 바뀌면(YAML 넣기 · 공유 폴더에서 받음) 연구개발 계획 칸이 그것을 보므로 다시 그린다(2026-10-27).
    chrome.storage.onChanged?.addListener?.((ch, area) => {
      if (area !== 'local' || !ch[RS.KEY]) return;
      st.research = shareObj(ch[RS.KEY].newValue);
      if (st.loaded && cur()) paintFiles();
    });
    el.chKind.innerHTML =CHANGE_KINDS.map((k) => `<option value="${k}">${k}</option>`).join('');
    el.projects.addEventListener('click', (e) => {
      const b = e.target instanceof HTMLElement ? e.target.closest('[data-proj]') : null;
      if (b) pickProject(b.dataset.proj);
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
    // 차년도 아이콘(2026-10-19 사용자 지정 "다른 차년도 추가하거나 수정 그리고 차년도 선택하는거") — 이 과제만 대상으로 더하기 카드를 연다(차년도는 그 카드의 단추 줄에서 고른다).
    el.headYear.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const p = cur(); if (p) openAdd({ projectId: p.id }); });
    // 머리 줄의 링크·톱니 아이콘(2026-10-19) — summary 안의 단추라 접기/펴기로 번지지 않게 막는다.
    el.headLink.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); copyShareLink(el.headLink); });
    el.headSet.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); goSettings(); });
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
    el.rosterCopy.addEventListener('click', copyRoster);
    // 참여인력 — ↻ 는 이어진 rERP 과제의 참여인력(지급계획)을 바로 다시 받는다(보이기만 — 2026-10-18).
    el.staffRefresh.addEventListener('click', () => refreshStaff({ force: true, reason: '↻' }));
    // 공유 권한(2026-10-19) — 공유 아이콘은 펴고 접기, ↻ 는 권한·사람 다시 읽기, 체크하면 바로 반영.
    el.staffShare.addEventListener('click', () => { togglePerm(); });
    el.permRefresh.addEventListener('click', () => { refreshPerm(); });
    el.permBody.addEventListener('change', onPermChange);
    el.staffMonths.addEventListener('click', onMonthsToggle);   // M — 달마다의 지급 줄 펴기/접기(2026-10-19)
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
    // 공유 (SharePoint) — 켜기 · 공유 폴더 칸(바꾸면 바로 맞춘다) · 지금 동기화 · 링크 복사(폴더 열기는 링크).
    // 설정 › Plus(2026-10-25) — 칸마다 여기서 바꾼 값(rndShare.own)으로. 공유할 과제 체크는 그 칸 안의 체크 상자에서 모아 한 번에.
    el.shareOn.addEventListener('change', () => onPlusSet('enabled', el.shareOn.checked));
    el.shareWith.addEventListener('change', () => onPlusSet('shareWith', el.shareWith.checked ? 'participants' : 'none'));   // 폴더를 새로 만들 때 참여연구원에게 자동 공유
    el.plusDiscover.addEventListener('change', () => onPlusSet('discover', el.plusDiscover.checked));
    el.plusProjectSync.addEventListener('change', () => onPlusSet('projectSync', el.plusProjectSync.checked));
    for (const node of [el.plusScopeAll, el.plusScopePick]) node.addEventListener('change', () => { if (node.checked) onPlusSet('scope', node.value); });
    el.plusPick.addEventListener('change', () => onPlusSet('projects', [...el.plusPick.querySelectorAll('input[data-key]:checked')].map((x) => x.dataset.key)));
    for (const [k, node] of Object.entries(el.plusItems)) node.addEventListener('change', () => onPlusSet(k, node.checked));
    el.plusFollowReset.addEventListener('click', onPlusFollow);
    el.plusProbe.addEventListener('click', onPlusProbe);
    el.plusCopy.addEventListener('click', onPlusCopy);
    el.shareGo.addEventListener('click', () => goSettings({ share: true }));
    el.shareFolder.addEventListener('change', onShareFolder);
    el.shareFolder.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onShareFolder(); } });
    el.shareSync.addEventListener('click', () => runShare('지금 동기화'));
    el.shareOpen.addEventListener('click', openShareFolder);
    el.shareLink.addEventListener('click', () => copyShareLink());
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
    await load();
    // 집행내역 표에 ＋·줄·폼·아이콘의 이벤트(rerp/plan.js bind)를 단다 — 이 패널이 표 요소를 가진 동안 한 번. 다른 패널 인스턴스(검사)가 같은 화면을 썼으면
    // 그 리스너가 남지 않게 요소를 새것으로 바꿔 끼우고 다시 단다.
    PLAN.send = planSend;   // 보이는 인스턴스가 rerp/plan.js 의 요청(planSync · shareFolderCopy …)을 받는다
    const host = $('rdErpTable');
    if (host && host !== st.plHost) {
      const fresh = host.cloneNode(false);
      host.replaceWith(fresh);
      el.erpTable = fresh;
      st.plHost = fresh;
      PLAN.bind(fresh, st.pl, drawErp);
    }
    paintAll();
    paintSet();
    // 공유 (SharePoint)가 켜져 있으면 열 때 맞추고(다른 기기·동료가 고친 것을 받는다 — 1분 안에 맞췼으면 sharesync 가 건너뛴다), 탭이 보이는 동안 주기마다 다시 맞춘다(2026-10-19).
    // 그 전에 rERP 확장에 설정을 물어 따른다(2026-10-25 — 거기서 켰으면 여기서도 켜짐). 기다리지 않는다.
    if (st.share.on) runShare('열 때');   // 맞출 때 sharesync 의 settings 가 rERP 확장에 다시 묻는다
    else shareEffective().then(() => { if (st.share.on && !el.root.classList.contains('hidden')) { shareAutoStart(); runShare('켬'); } }).catch(() => {});
    shareAutoStart();
    // rERP — 이어져 있으면 신선하지 않을 때 다시 받고, 아니면 올해 차년도를 이 세션에서 한 번 저절로 잇는다. 기다리지 않는다.
    erpAuto();
  }

  /** 설정 › Plus 를 열 때(sidepanel.js choosePane) — R&D 탭을 아직 안 열었어도 저장해 둔 형편을 읽고 rERP 확장에 다시 물어(따르기) 그린다. 거기서 켜져 이제 켜졌으면 맞춘다. */
  async function showPlus() {
    await load();
    paintShare();
    const was = !!st.share.on;
    await shareEffective().catch(() => {});
    paintShare();
    if (!was && st.share.on) runShare('켬');
  }

  /** 저장해 둔 장부·공유 형편·설정을 한 번 읽는다(R&D 탭이나 설정 › Plus 를 처음 열 때 — 둘이 겹쳐 불려도 한 번). */
  let loading = null;
  function load() {
    loading ||= loadOnce().catch((err) => { loading = null; throw err; });
    return loading;
  }
  async function loadOnce() {
    if (!st.loaded) {
      const saved = await chrome.storage.local.get([BOOK_KEY, GM_PROJECTS_KEY, SHARE_KEY, SET_KEY, PLAN.SKEY, PEOPLE_KEY]);
      st.book = normalizeBook(saved?.[BOOK_KEY]);
      st.share = normalizeShare(saved?.[SHARE_KEY]);
      st.permPeople = normalizePeople(saved?.[PEOPLE_KEY]);   // 공유 권한의 이름 → 이메일 캐시(2026-10-19)
      // 밑폴더 열쇠(effective)가 생기기 전의 저장값 — 그때 쓰던 자리(칸의 값·기본 호스트)로 채워 처음 맞춤에 캐시를 괜히 버리지 않게(2026-10-19)
      if (saved?.[SHARE_KEY] && typeof saved[SHARE_KEY] === 'object' && !('effective' in saved[SHARE_KEY])) st.share.effective = shareEffKey(st.share.folder, SHARE_DRIVE_HOST);
      st.set = normalizeSet(saved?.[SET_KEY]);
      // 마지막 공유 결과(sharesync 가 rerp 와 같은 planSyncState 에 남긴 것) — 과제별 폴더 주소·과제 수, 실패면 종류('auth' 는 로그인 안내).
      const last = saved?.[PLAN.SKEY];
      st.shareState = last && typeof last === 'object' && !Array.isArray(last) ? last : null;
      st.shareKind = st.shareState && st.shareState.ok === false ? String(st.shareState.kind || 'error') : '';
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
      // 연구내용 기록 — 계획서 글이 없는 차년도의 연구개발 계획 칸(planNow). 바뀌면 storage.onChanged 로 다시 받는다.
      st.research = shareObj(await RS.load());
      // 지금 장부의 지문 — 이 뒤로 고친 것이 있을 때만 잠깐 뒤 맞춘다(shareSoon).
      st.shareHash = shareHashOf(st.book);
      applyPlus();   // on · shareWith 를 지금 설정(여기서 바꾼 칸 > 지난번 rERP 확장의 답 > 기본)으로
    }
  }

  function hide() {
    el.root.classList.add('hidden');
    shareAutoStop();   // 주기 맞춤은 탭이 보이는 동안만
  }

  return {
    wire, show, hide, showPlus, book: () => st.book, skills: loadManifest, share: () => st.share, shareSync: (reason) => runShare(reason || '지금 동기화'), erp: () => (cur() ? curBook(cur()).erp || null : null), plans: () => st.pl.plans, refreshErp, settings: () => st.set,
    shareTick, shareAuto: () => !!shareEvery,   // 주기 맞춤(2026-10-19) — 검사가 한 번 돌리고(shareTick) 타이머가 도는지(shareAuto) 본다
    staff: () => (cur() ? curBook(cur()).erp?.staff || null : null), refreshStaff, staffRun: () => st.staffRun,
    // 공유 권한(2026-10-19) — 검사가 형편·반영 약속을 본다.
    perm: () => st.perm, permPeople: () => st.permPeople, togglePerm, applyPerm,
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

/** 공유 (SharePoint)가 OneDrive 를 읽을 fetch — 전역 fetch 그대로(브라우저 로그인 쿠키는 저장소 쪽이 credentials:'include' 로 붙인다, manifest host_permissions *.sharepoint.com). */
const defaultSpFetch = (url, init) => globalThis.fetch(url, init);
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
