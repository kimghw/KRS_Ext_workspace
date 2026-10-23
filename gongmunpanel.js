// 공문 탭의 화면. 무엇을 어떤 틀에 넣을지·결재선·한도는 src/gongmun.js 가, 문서 읽기는 src/llm.js 의 gongmunSmart 가 한다.
// 여기는 그 둘을 화면에 잇기만 한다.
//
// '공문 작성' 은 새 공문 창을 열어 과제(Job Id)·제목·차수·본문·문서설정·결재선(위임전결)·첨부(읽은 문서를 문서마다 PDF 로 묶어 파일첨부에)를 넣는다
// (src/gmwrite.js — 2026-10-08 사용자 지정: "공문에서 열기가 아니라 공문을 작성해야지" · 2026-10-12: "공문에 첨부파일이 들어가 있지 않음"). 임시저장·상신은
// 창에서 사람이 한다 — 오른쪽의 '공문 보기' 가 그 창을 앞으로 가져오고 단추 아래 상태 줄이 쓰는 중·다 씀을 말한다(같은 날 사용자 지정: "작성 중인지 완료인지
// 알 수가 없음 … 우측에 공문 완료 시 공문 보기 버튼"). 제목·본문 복사 단추는 뺐다(10-08 — 창에 바로 넣는다).
//
//   갈래(구매·교육·출장) → 과제 고르기(갈래 아래의 별칭 칩) → 문서 넣기(캡처 붙여넣기·끌어다 놓기·고르기·보고 있는 탭 통째로 캡처·웹페이지의 부분 골라 캡처) → 읽은 칸 고치기 → 문서설정·위임전결 → 공문 작성(첨부까지) → 공문 보기로 창을 열어 임시저장·상신
//
// 외부활동은 외부강의등 신고서(칸이 정해진 폼)다(2026-10-15 사용자 지정) — 과제를 고르지 않고, 직급·당월 누적·당해 연도 누적·총 시간과 요청인의 대표자·담당자는
// 공문 이력의 지난 신고서와 다른 칸으로 셈해 채우며(outsideAuto), 공문 탭의 본문은 넣을 칸의 미리보기다(고쳐도 신고서에 들어가지 않는다).
//
// 구매의뢰는 구매요청서(KR_Purchase_Order — 총무팀 수신, 칸이 정해진 폼)다(2026-10-17 사용자 지정: "구매 시 총무팀에 구매의뢰 하는 공문기능 … 그 의뢰서는 구매공문과 연동되어야
// 하고, 우측 하단에 구매의뢰하기 버튼을 넣던지, 구매할때 같이 작성할 수 있던지") — 구매 품의에서 두 길로 든다: 공문 작성 줄의 '구매의뢰 작성'(지금 구매 초안으로 — orderFromHere)과
// 공문 이력의 구매 품의 카드 우측 하단의 '구매의뢰'(그 줄을 선행 품의로 — orderFromRow). 둘 다 src/gongmun.js 의 orderFromPurchase 로 초안을 만들고, 수요시기·특기사항·계정과목명·
// 첨부자료 안내문구는 orderAuto 가 셈해 채운다(autoFill).
//
// 양식(eclass 양식·제목 틀·본문 틀)과 공문 설정(부서·부서장·소장·본부장·문서번호 부서·과제 — R&D 탭에 과제가 있으면 그 과제들)은 이 탭 아래의 접힌 칸에서 고친다.
// 공문 설정에는 참조자 칸이 없다(2026-10-15 사용자 지정: "참조자는 공문마다·과제마다 들어가는 사람이 다르므로 전역 설정에 둘 수 없다") — 과제의 계획서
// YAML(공문.참조자)에 공문 종류별로 적거나, R&D 탭의 '참여인력'에서 행정 담당 등을 참조로 고른다(그 과제의 공문마다 — 2026-10-16 사용자 지정
// "과제 별로 동일한 사람이 들어 갈 수 있도록", "참여연구자 및 행정 지원.. 으로 해서 행정지원 사람 넣을 수 있도록"). 결재선에 고른 과제·고른 갈래의 것이
// 선다(src/gongmun.js 의 projectRefs). 어디에도 없으면 비운다. 문서설정의 결재선 줄은 그것을 보이기만 한다(paintLineSet).
// 갈래·틀·칸·위임전결·문서설정의 원본은 레시피(recipes/gongmun)다.

import {
  KINDS, KIND_ORDER, FORMS, MAX_PROJECTS, VARS, VAR_MARKS, FIELDS,
  KIND_KEY, PRESET_KEY, PROJECTS_KEY, TEMPLATES_KEY, DRAFT_KEY, RND_EXTRA_KEY,
  templateOf, templateEdited, templatePatch, normalizePreset, normalizeProjects, normalizeRndExtra, sameProject, fromRecord, blankDraft, summaryOf,
  overLimit, approvalLine, lineText, compose, needs, attachName, whoOf, DOC_NAMES, won, moneyOf, docNoCandidates, ROLE_LABEL,
  mergeDraft, applyReason, REASON_KEYS, EMPTY_ROW, eduModeOf, spreadParts, attachWithCut, rndProjects, projectRefs, moreLead,
  docSettingOf, settingText, settingPatch, delegationOf, RANKS, RANK_WHY, SETTING_OPTIONS, dotDate, formsFor, fieldForm, hasRows, outsideAuto, orderAuto, orderFromPurchase,
} from './src/gongmun.js';
import {
  HIST_KEY, SPANS, SPAN_LABEL, spanFrom, OUTSIDE_FORM, RESEARCH_FORM, BOXES, normalizeHist, listMine, listBoxes, readOutsideReport, kindOf, stateOf, outsideSummary, outsideHistory, viewUrl,
} from './src/gmlist.js';
import { SEARCH_KEY, AGENT_KIND, DIRS, DIR_LABEL, DIR_BOXES, DIR_TITLE, CUSTOM, parseQuery, periodOf, filterRows, sameRead, normalizeSearch } from './src/gmsearch.js';
import { showTab } from './src/gmwrite.js';
import { RECIPE } from './src/gmrecipe.js';
import { createDispatcher } from './actions/dispatch.js';
import { jumpsOf, paintJumps, flashFocus } from './src/jump.js';
import { resolvePreset } from './actions/preset.js';
import { ActionError } from './actions/gate.js';
import { registerGongmun } from './actions/runners/gongmun.js';
import { BOOK_KEY, normalizeBook, refsText, supportText, MAX_PROJECTS as RND_MAX } from './src/rnd.js';
import { SET_KEY as RND_SET_KEY } from './src/rnderp.js';
import { budgetCheck, budgetText, budgetTitle, itemOf } from './src/gmbudget.js';
import PLAN from './rerp/plan.js';
import { gongmunSmart, gongmunReasonSmart } from './src/llm.js';
import { readSlots } from './src/pagecap.js';
import { dropReady, parseDrop, grabDropped } from './src/mailgrab.js';
import { cutBoxes, cutDrop, cutName, cutQuote, CUT_PAD, PAD_STEP, MAX_PAD } from './src/quotecut.js';
import { createWebPick, pickButton } from './webpick.js';

const FILE_LIMIT = 10 * 1024 * 1024;
/**
 * 원본 첨부의 한도 — 메일 첨부처럼 파일 자체로 두었다가 공문 창의 파일첨부에 그대로 올리는 파일(2026-10-15 사용자 지정: "첨부는 파일 자체로
 * 관리하지만 ocr 해서 이것도 필요한 내용으로 넣는 거지"). Outlook 첨부는 25MB 까지 온다. 읽기에 보내는 그림·PDF 는 FILE_LIMIT 그대로다.
 */
const ORIGINAL_LIMIT = 25 * 1024 * 1024;
/** 공문 창의 파일첨부 칸 수(src/gmwrite.js — RadUpload 다섯 칸). 묶은 PDF 가 먼저 들고 원본 첨부가 뒤에 든다. */
const ATTACH_SLOTS = 5;
/** 원본 첨부에서 뽑은 글자의 몫 — 읽기 입력은 18000자에서 잘린다(src/llm.js 의 gongmunInput). 파일 하나가 가져가는 몫의 아래·위. */
const TEXT_ROOM = 18000;
const OFFICE_MIN = 1500;
const OFFICE_MAX = 8000;
/** 한 번에 읽는 장 수. 로컬 CLI 다리는 여섯 장까지 받는다(native/host.mjs). 웹페이지 캡처의 그 밖의 장은 첨부에만 넣는다. */
const MAX_FILES = 5;
const SAVE_WAIT_MS = 400;
/** 화면의 접힘·선택 탭은 초안 및 eclass 작성 결과 탭 ID와 별도로 저장한다. */
const VIEW_KEY = 'gongmunView';
/** 오린 견적서(저장소에 두지 않는 것)를 비교작성 탭에 건네는 세션 저장소 키 — 창을 다 닫으면 사라진다. */
const CUT_KEY = 'gongmunCut';
/** 이 창의 표 — 저장한 초안에 적어 두어(by) 저장소 변화가 내가 쓴 것인지 가린다(사이드패널과 비교작성 탭이 같은 초안을 본다). */
const INSTANCE = Math.random().toString(36).slice(2, 10);
/** 비교작성 탭에 초안이 없을 때의 안내. */
const NO_DRAFT_TAB = '사이드패널의 공문 탭에서 문서를 넣거나 문서 없이 쓰기를 누르면 여기에 보입니다.';
const VIA_LABEL = { cli: '로컬 CLI', api: 'API 키', local: '규칙 해석' };
/** 견적서를 오리는 갈래 — 구매(쇼핑몰 화면)와 교육(온라인 강의 페이지의 수강료 칸 — 2026-10-08 사용자 지정). 레시피 purpose.yaml 의 quote_crop. */
const CUT_KINDS = new Set(KIND_ORDER.filter((k) => KINDS[k].cut));
/** 채팅 칸에 남겨 두는 말 수(내 말·답 합쳐서). */
const CHAT_KEEP = 6;
/**
 * 과제를 갈래 아래의 별칭 칩(gmProjBar)에서 먼저 고르는 갈래(2026-10-08 사용자 지정: "구매, 교육, 출장일때 어떤 과제인지 별칭으로 상단에서 우선 선택") — 과제를 고르는 갈래 모두
 * (레시피 purpose.yaml 의 project 가 false 가 아닌 것, KINDS.project). 과제를 고르지 않는 갈래(외부활동 — 외부강의등 신고서, 2026-10-15)는 고르는 곳이 없다.
 * 2026-10-17 까지는 ['purchase', 'edu', 'trip'] 을 손으로 적어 레시피에 목적을 더하면 빠뜨리기 쉬웠다(Codex 검토). 작성 내용 탭 안의 과제 목록(paintProjList)은 그 밖의 갈래 몫으로 남겨 둔다.
 */
const PICK_FIRST = KIND_ORDER.filter((k) => KINDS[k].project);

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** 100만원처럼 만 단위로 끊어 말한다. */
const manwon = (n) => (n % 10000 === 0 ? `${(n / 10000).toLocaleString('ko-KR')}만원` : won(n));
const formLabel = (id) => FORMS.find((f) => f.id === id)?.label || id;

/**
 * @param {{$:Function, escapeHtml:Function, logEvent:Function, ai:() => {apiKey:string, cli:boolean}, me?:() => string,
 *   flash?:(btn:HTMLElement, text:string, ms?:number) => void,
 *   webcap?:{front?:Function, start?:Function, parts?:Function}}} deps
 *   webcap 은 웹페이지를 찍는 길(src/pagecap.js — 보고 있는 탭 통째로·페이지 위의 부분 고르기·고른 부분 찍기) — 캡처 단추(webpick.js)에 넘긴다
 *   compareTab 은 비교작성 탭일 때의 갈래(sidepanel.html?compare=갈래 — sidepanel.js) — 그 갈래의 초안을 작성 내용(공문)·읽은 내용 두 칸으로 넓게 보인다
 *   actions 는 행위 디스패처(actions/dispatch.js — sidepanel 이 만들어 근태·공문 패널이 같이 쓴다). 없으면(단독 테스트) 여기서 만든다
 */
export function createGongmunPanel({ $, escapeHtml, logEvent, ai, me = () => '', flash = () => {}, webcap = {}, compareTab = '', actions: given = null, openSetting = null }) {
  const el = {
    root: $('gongmun'), kinds: $('gmKinds'), projBar: $('gmProjBar'), pick: $('gmPick'), projLabel: $('gmProjLabel'),
    intake: $('gmIntake'), evidenceCount: $('gmEvidenceCount'), evidenceToggle: $('gmEvidenceToggle'), evidenceBody: $('gmEvidenceBody'), file: $('gmFile'), dropLead: $('gmDropLead'), capture: $('gmCapture'),
    manual: $('gmManual'), status: $('gmStatus'),
    // 읽은 내용 탭(readView) — 읽은 칸(moreFields — 펼쳐 두는 칸이 아닌 것)·품목·오린 견적서. 비교작성이면 고른 탭 오른쪽에 나란히 선다.
    draft: $('gmDraft'), readView: $('gmReadView'), moreFields: $('gmMoreFields'), compare: $('gmCompare'),
    agent: $('gmAgent'), agentInput: $('gmAgentInput'), agentGo: $('gmAgentGo'), agentLog: $('gmAgentLog'),
    source: $('gmSource'), cut: $('gmCut'), items: $('gmItems'), limit: $('gmLimit'), projects: $('gmProjects'), projInfo: $('gmProjInfo'), budget: $('gmBudget'),
    fields: $('gmFields'), line: $('gmLine'), need: $('gmNeed'), reset: $('gmReset'),
    workspace: $('gmWorkspace'), workspaceBody: $('gmWorkspaceBody'), workspaceToggle: $('gmWorkspaceToggle'), workspaceFoldLabel: $('gmWorkspaceFoldLabel'),
    viewTabs: $('gmViewTabs'), viewDraft: $('gmViewDraft'), viewDoc: $('gmViewDoc'), viewRead: $('gmViewRead'),
    doc: $('gmDoc'), formName: $('gmFormName'), title: $('gmTitle'), body: $('gmBody'), edited: $('gmEdited'), regen: $('gmRegen'),
    // 공문 작성·공문 보기 단추 한 줄과 그 아래 상태 줄(쓰는 중·다 씀) — 2026-10-12 사용자 지정("작성 중인지 완료인지 알 수가 없음").
    write: $('gmWrite'), showDoc: $('gmShowDoc'), writeState: $('gmWriteState'), writeLog: $('gmWriteLog'), savePdf: $('gmSavePdf'), steps: $('gmSteps'),
    // 구매의뢰 작성 — 같은 줄의 세 번째 단추(구매 갈래에서만 — 2026-10-17 사용자 지정: "우측 하단에 구매의뢰하기 버튼 … 구매할때 같이 작성").
    order: $('gmOrder'),
    setBox: $('gmSetBox'), setState: $('gmSetState'), rank: $('gmRank'), rankWhy: $('gmRankWhy'), retention: $('gmRetention'), docNoOne: $('gmDocNoOne'),
    receiver: $('gmReceiver'), scope: $('gmScope'), emergency: $('gmEmergency'), approvingOpen: $('gmApprovingOpen'), drm: $('gmDrm'), tag: $('gmTag'), setReset: $('gmSetReset'),
    // 문서설정의 결재선 줄 — 과제 책임자(합의자)·참조자를 보이기만 한다(적는 곳은 R&D 탭 — 과제 정보의 책임자, 참여인력 — 2026-10-16).
    lineSet: $('gmLineSet'), lead: $('gmLineLead'), refs: $('gmLineRefs'), lineWhy: $('gmLineWhy'), lineGo: $('gmLineGo'),
    tplBox: $('gmTplBox'), tplState: $('gmTplState'), tplForm: $('gmTplForm'), tplFormId: $('gmTplFormId'),
    tplTitle: $('gmTplTitle'), tplBody: $('gmTplBody'), tplReset: $('gmTplReset'), vars: $('gmVars'),
    presetBox: $('gmPresetBox'), presetState: $('gmPresetState'), dept: $('gmDept'), head: $('gmHead'),
    director: $('gmDirector'), chief: $('gmChief'), docNo: $('gmDocNo'), docNoHint: $('gmDocNoHint'),
    projList: $('gmProjList'), projAdd: $('gmProjAdd'), projCount: $('gmProjCount'),
    // 공문 이력 — 작업 카드 아래의 접힌 칸(eclass 기안함에서 읽은 내 공문, src/gmlist.js)과 작성 내용 탭의 사례비 누계 줄(외부활동).
    feeSum: $('gmFeeSum'), acctRow: $('gmAcctRow'), histBox: $('gmHistBox'), histState: $('gmHistState'), histRange: $('gmHistRange'), histSpan: $('gmHistSpan'), histAll: $('gmHistAll'),
    histRefresh: $('gmHistRefresh'), histNote: $('gmHistNote'), histList: $('gmHistList'),
    // 에이전트(공문 검색, src/gmsearch.js) — 갈래 줄의 에이전트 단추가 켜는 카드: 말 칸·찾기, 받은·보낸, 기간, 상태 줄, 찾은 공문 카드.
    search: $('gmSearch'), searchText: $('gmSearchText'), searchGo: $('gmSearchGo'), searchDir: $('gmSearchDir'), searchSpan: $('gmSearchSpan'),
    searchState: $('gmSearchState'), searchNote: $('gmSearchNote'), searchList: $('gmSearchList'),
  };
  // 웹페이지 캡처 단추 둘(보고 있는 탭 · 부분 골라 캡처) — 출장 카드의 증빙 넣는 곳과 같은 것이다(webpick.js, 2026-10-08 사용자 지정).
  const pick = createWebPick(webcap);
  const PICK_KEY = 'gongmun';
  const st = {
    // writing 은 뒤 탭에 쓰는 중, lastTab 은 연 공문 창의 탭, writeDone 은 끝난 작성의 결과({ ok, docId, bad(안 된 단계 이름) } — 쓰기 전·쓰는 중은 null).
    kind: KIND_ORDER[0], loaded: false, busy: false, capturing: false, ready: true, reasonBusy: false, writing: false, lastTab: null, writeDone: null,
    preset: normalizePreset(null),
    // projects 는 저장된(이름이 있는) 과제, rows 는 공문 설정 칸에 펼쳐 둔 줄(아직 이름을 적지 않은 줄도 있다).
    projects: [], rows: [],
    // 초안에서 고르는 과제는 R&D 탭의 과제다(rndBook — src/gongmun.js 의 rndProjects, 2026-10-08 사용자 지정). book 은 탭을 열 때마다 다시 읽는다.
    // R&D 탭에 과제가 없으면 공문 설정의 과제를 고른다. extra 는 R&D 과제마다 공문 설정에서 적은 개요·계정이다(normalizeRndExtra).
    book: null, rnd: [], extra: {},
    // R&D 설정(rndSettings 원본 — rERP 를 켰는지, 집행에 미청구·사용계획을 더하는지)과 예상 비용(plannedExpenses) — 예산 줄(src/gmbudget.js)이 R&D 탭과 같은 잔액을 내게. 장부와 함께 읽는다(loadBook).
    rndSet: null, plans: {},
    // 갈래마다 고친 양식만 담는다(src/gongmun.js 의 templatePatch).
    templates: {},
    // 갈래마다 쓰고 있는 것 — { draft, source, notes, project(과제명), title·body(직접 고쳤으면 그 글, 아니면 null), files(읽은 파일 — 저장하지 않는다),
    //   parts(읽기가 가린 파일마다의 종류), cut(구매·교육 — 가격과 그 둘레를 오린 견적서, src/quotecut.js — 저장하지 않는다) }
    work: {},
    // tab 은 작성 내용(draft)·공문(doc)·읽은 내용(read). 비교작성 탭(compareTab)이면 읽은 내용은 늘 오른쪽에 있어 tab 은 draft·doc 뿐이고 저장하지 않는다.
    view: { tab: 'draft', evidenceOpen: true, workspaceOpen: true },
    // 비교작성 탭이면 그 갈래(sidepanel.html?compare=갈래). 사이드패널이면 ''.
    compareTab: KINDS[compareTab] ? compareTab : '',
    // 갈래마다 한도에 걸려 있는지 — 새로 걸릴 때 한 번만 읽은 내용 탭으로 간다(칸을 고칠 때마다 가지 않게).
    blocked: {},
    // 고친 초안을 아직 저장소에 쓰지 않았다(saveWork 의 미룸) — 그 사이 다른 창이 쓴 같은 갈래는 받지 않는다(곧 나갈 내 저장이 이긴다).
    dirty: false,
    // 갈래마다 세션 저장소에 건넨 오린 견적서 — 같은 것이면 다시 건네지 않는다.
    stashed: {},
    lastProject: '',
    // 공문 이력(src/gmlist.js) — 저장소에 읽어 둔 것(at·from·to·span·rows·reports·notes)에 화면 형편(busy·step·error·all·open·tried)을 얹는다.
    hist: { ...normalizeHist(null), busy: false, step: '', error: '', all: false, open: '', tried: false },
    // 에이전트(공문 검색, src/gmsearch.js) — 저장소에 둔 것(on·dir·span·from·to·label·text·keyword·terms·at·read·rows·notes)에 화면 형편(busy·step·error·open)을 얹는다.
    // on 이면 공문 탭이 에이전트 갈래로 열린다(갈래 줄과 검색 카드만). 비교작성 탭에는 없다.
    search: { ...normalizeSearch(null), busy: false, step: '', error: '', open: '' },
  };

  const cur = () => st.work[st.kind] || null;
  /** 초안에서 고르는 과제 — R&D 탭의 과제, 없으면 공문 설정의 과제. */
  const choices = () => (st.rnd.length ? st.rnd : st.projects);
  /** 갈래가 과제를 고르는가 — 외부활동(외부강의등 신고서)은 고르지 않는다(KINDS.project). */
  const usesProject = (kind = st.kind) => KINDS[kind]?.project !== false;
  const projectOf = (w, kind = st.kind) => (usesProject(kind) && choices().find((p) => p.name === w?.project)) || null;
  const ctxOf = (w) => ({ me: me(), preset: st.preset, project: projectOf(w), today: today() });
  /** 결재선의 맥락 — 갈래·초안(금액·출장 구분)·이 공문에서 고른 전결권자까지(위임전결). */
  const lineCtx = (w) => ({ ...ctxOf(w), kind: st.kind, draft: w?.draft || {}, rank: w?.rank || '' });
  const tplOf = () => templateOf(st.kind, st.templates);
  // 행위 디스패처(actions/dispatch.js) — sidepanel 이 만들어 근태·공문 패널이 같이 쓰는 것을 받고, 없으면(단독 테스트) 여기서 만든다.
  // 공문 실행기(gongmun.write — actions/runners/gongmun.js)는 여기서 등록한다. 활동 로그는 디스패처가 run 마다 한 줄 남긴다.
  const actions = given || createDispatcher({ log: (e) => logEvent(e.kind, e.ok, e.text, e.data) });
  /**
   * 관문이 막은 빈 곳으로 가는 단추의 표(src/jump.js) — 공문의 칸(제목·본문·전결권자·문서설정)은 공문 보기에, 초안 칸(draft.…)과 과제·첨부는
   * 작성 내용에 있다. 내 이름은 설정 → 일반, 공문 설정(부서·부서장·소장·본부장·문서번호 부서)은 아래 공문 설정 칸이다.
   */
  const JUMPS = {
    input: {
      title: () => { selectView('doc'); flashFocus(el.title); },
      body: () => { selectView('doc'); flashFocus(el.body); },
      rank: () => { selectView('doc'); flashFocus(el.rank); },
      setting: () => { selectView('doc'); flashFocus(el.setBox); },
      attach: () => { selectView('draft'); flashFocus(el.intake); },
    },
    preset: {
      me: openSetting ? { label: '내 이름', go: () => openSetting('general', 'myName') } : null,
      setup: { label: '공문 설정', go: () => flashFocus(el.dept) },
      project: { label: '과제', go: () => { selectView('draft'); flashFocus(el.projects); } },
    },
    field: (root, key) => {
      if (root !== 'draft') return null;
      const sub = String(key).split('.')[1];
      const node = sub ? el.root.querySelector(`[data-key="${sub}"]`) : null;
      return node ? () => { selectView('draft'); flashFocus(node); } : null;
    },
  };
  registerGongmun(actions);
  /**
   * 사전설정이 읽는 저장소 — 공문 설정(gongmunPreset)은 이 패널이 쓰는 키라 들고 있는 것(st.preset — 저장소에서 읽어 고칠 때마다 400ms 뒤에 쓴다)이 최신이다.
   * 고치자마자 공문 작성을 눌러도 화면에 보이는 설정으로 기록을 짓게 저장소 값 위에 얹는다. 나머지 키는 저장소 그대로.
   */
  const storageOf = async (keys) => {
    const got = (await chrome.storage.local.get(keys)) || {};
    return keys.includes(PRESET_KEY) ? { ...got, [PRESET_KEY]: st.preset } : got;
  };
  /** 행위의 사전설정 — 내 이름·오늘·저장소(공문 설정)·패널의 ctx(고른 과제)를 명세의 from 대로 채운다(actions/preset.js). 값이 없어도 키는 있다. */
  const presetFor = (id, ctx = {}) => resolvePreset(actions.entry(id).preset, { storage: storageOf, me: me(), today: today(), recipe: RECIPE, ctx });

  function setStatus(msg, kind = '') {
    el.status.className = `status ${kind}`;
    el.status.textContent = msg;
  }

  /* ---------------------------------------------------------- 저장 */

  const timers = {};
  const later = (key, fn) => { clearTimeout(timers[key]); timers[key] = setTimeout(fn, SAVE_WAIT_MS); };

  /**
   * 쓰고 있는 초안을 남긴다 — 패널을 닫았다 열어도 이어 쓴다. 읽은 파일(그림)과 오린 견적서는 크니 남기지 않는다.
   * 사이드패널과 비교작성 탭이 같은 것을 보며 쓰니 이 창의 표(by)를 적어 둔다 — 저장소 변화가 돌아오면 내 것은 건너뛴다(onStorageChanged).
   */
  function saveWork() {
    st.dirty = true;
    later('work', () => {
      const out = { lastProject: st.lastProject, by: INSTANCE };
      for (const k of KIND_ORDER) {
        if (!st.work[k]) continue;
        const { files, cut, ...rest } = st.work[k];
        out[k] = rest;
      }
      Promise.resolve(chrome.storage.local.set({ [DRAFT_KEY]: out })).catch(() => {}).then(() => { st.dirty = false; });
    });
  }
  const savePreset = () => later('preset', () => chrome.storage.local.set({
    [PRESET_KEY]: st.preset, [PROJECTS_KEY]: normalizeProjects(st.rows), [RND_EXTRA_KEY]: normalizeRndExtra(st.extra),
  }));
  const saveTemplates = () => later('tpl', () => chrome.storage.local.set({ [TEMPLATES_KEY]: st.templates }));
  /** 비교작성 탭은 늘 두 칸이라 화면 상태를 남기지 않는다 — 사이드패널의 탭·접힘을 건드리지 않게. */
  const saveView = () => { if (!st.compareTab) later('view', () => chrome.storage.local.set({ [VIEW_KEY]: { ...st.view } })); };
  /** 읽은 공문 이력을 남긴다 — 사이드패널과 비교작성 탭이 같이 보니 이 창의 표(by)를 적는다(onStorageChanged 가 내 것은 건너뛴다). */
  const histKept = () => ({ at: st.hist.at, from: st.hist.from, to: st.hist.to, span: st.hist.span, rows: st.hist.rows, reports: st.hist.reports, notes: st.hist.notes });
  const saveHist = () => later('hist', () => Promise.resolve(chrome.storage.local.set({ [HIST_KEY]: { ...histKept(), by: INSTANCE } })).catch(() => {}));

  /** 저장소의 초안 한 벌을 이 창의 것으로 — 읽은 파일·오린 견적서는 저장소에 없으니 keep(이 창이 들고 있던 것)에서 잇는다. */
  function restoreWork(k, w, keep = null) {
    const out = { ...w, notes: Array.isArray(w.notes) ? w.notes : [], source: w.source || {}, files: keep?.files || [], cut: keep?.cut || null };
    // 교육 구분 칸이 생기기 전에 쓰던 초안 — 교육장소로 정해 칸에 보인다.
    if (k === 'edu' && !w.draft.mode) out.draft = { ...w.draft, mode: eduModeOf(w.draft) };
    return out;
  }

  /**
   * 다른 창이 쓴 초안을 따라간다 — 사이드패널과 비교작성 탭은 같은 초안(DRAFT_KEY)을 보며 쓴다(2026-10-09 사용자 지정: "비교작성은 사이드패널이
   * 아니라 크롬 탭에"). 내가 쓴 것(by)은 건너뛰고, 이 창이 고치는 중인 갈래(dirty — 아직 저장 전)는 두어 곧 나갈 내 저장이 이긴다. 쓰고 있는 칸이
   * 있으면 칸을 다시 그리지 않고 값만 맞춘다(syncField). 오린 견적서는 사이드패널이 세션 저장소(CUT_KEY)로 건네고, 바뀌면 그것도 따라간다.
   */
  function onStorageChanged(changes, area) {
    if (area === 'session') {
      if (changes[CUT_KEY]) applyCut(changes[CUT_KEY].newValue);
      return;
    }
    // 공문 이력 — 다른 창이 읽어 둔 것을 따라간다. 내가 쓴 것(by)은 건너뛴다.
    if (area === 'local' && changes[HIST_KEY] && st.loaded && changes[HIST_KEY].newValue?.by !== INSTANCE) {
      Object.assign(st.hist, normalizeHist(changes[HIST_KEY].newValue));
      paintHist();
      paintFeeSum();
    }
    if (area !== 'local' || !changes[DRAFT_KEY] || !st.loaded) return;
    const kept = changes[DRAFT_KEY].newValue;
    if (!kept || typeof kept !== 'object' || kept.by === INSTANCE) return;
    let repaint = false;
    for (const k of KIND_ORDER) {
      if (st.dirty && k === st.kind) continue;
      const w = kept[k];
      if (!w?.draft || typeof w.draft !== 'object') {
        if (st.work[k]) {
          delete st.work[k];
          delete st.blocked[k];
          repaint = repaint || k === st.kind;
        }
        continue;
      }
      st.work[k] = restoreWork(k, w, st.work[k]);
      repaint = repaint || k === st.kind;
    }
    if (typeof kept.lastProject === 'string') st.lastProject = kept.lastProject;
    if (!repaint) return;
    const active = document.activeElement;
    const typing = !!active && el.workspace.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
    if (typing && cur()) for (const f of FIELDS[st.kind] || []) syncField(f.key);
    else renderFields();
    paintDraft();
    paintIntake();
  }

  /**
   * 오린 견적서를 비교작성 탭에 건넨다 — 저장소에 두지 않는 것이라 세션 저장소(CUT_KEY — 창을 다 닫으면 사라짐)로. 사이드패널만 건네고,
   * 갈래마다 같은 것이면 다시 쓰지 않는다(그림이 커서). force 는 비교작성 탭을 열 때 — 그 탭이 받을 것을 먼저 둔다.
   */
  function stashCut(force = false) {
    const session = chrome.storage.session;
    if (!session?.set || st.compareTab) return Promise.resolve();
    const out = {};
    let changed = force;
    for (const k of KIND_ORDER) {
      const c = st.work[k]?.cut || null;
      if (c) out[k] = c;
      if (st.stashed[k] !== c) changed = true;
      st.stashed[k] = c;
    }
    if (!changed) return Promise.resolve();
    return Promise.resolve(session.set({ [CUT_KEY]: out })).catch(() => {});
  }

  /** 비교작성 탭 — 사이드패널이 건넨 오린 견적서를 초안에 붙인다(세션 저장소를 읽거나 그 변화를 받아서). */
  function applyCut(all) {
    if (!st.compareTab) return;
    for (const k of KIND_ORDER) if (st.work[k]) st.work[k].cut = all?.[k] || null;
    paintCut();
  }

  async function pullCut() {
    const session = chrome.storage.session;
    if (!session?.get || !st.compareTab) return;
    const got = await Promise.resolve(session.get([CUT_KEY])).catch(() => null);
    applyCut(got?.[CUT_KEY]);
  }

  /**
   * 비교작성 — 사이드패널은 좁으니 확장 페이지(sidepanel.html?compare=갈래)를 크롬 탭으로 열어 고른 탭(작성 내용·공문)을 왼쪽에, 읽은 내용을
   * 오른쪽에 나란히 두고 쓴다(2026-10-09 사용자 지정: "비교작성 버튼을 추가 해서 … 비교하면서 작성", "사이드패널이 아니라 크롬 탭에"). 이미 열려
   * 있으면 그 탭을 앞에 둔다(갈래가 다르면 바꾼다). 두 창은 같은 초안(저장소)을 보며 쓴다 — 한쪽에서 고치면 다른 쪽이 따라간다(onStorageChanged).
   */
  async function openCompare() {
    if (!cur() || st.compareTab) return;
    const kind = st.kind;
    await stashCut(true);
    const page = chrome.runtime.getURL('sidepanel.html');
    const url = `${page}?compare=${kind}`;
    const tabs = await Promise.resolve(chrome.tabs.query({})).catch(() => []);
    const open = (tabs || []).find((t) => String(t.url || '').startsWith(page) && /[?&]compare=/.test(t.url));
    if (open) {
      await chrome.tabs.update(open.id, open.url === url ? { active: true } : { active: true, url });
      if (open.windowId != null) await Promise.resolve(chrome.windows?.update?.(open.windowId, { focused: true })).catch(() => {});
    } else {
      await chrome.tabs.create({ url });
    }
    logEvent('gongmun', true, `${KINDS[kind].title} 비교작성 탭 ${open ? '앞에' : '열기'}`);
  }

  /* ---------------------------------------------------------- 접기·화면 탭 */

  const TAB_LABEL = { draft: '작성 내용', doc: '공문', read: '읽은 내용' };

  /**
   * 탭 전환·접기는 입력 노드를 유지하고 가시성만 바꾼다. .hidden 클래스는 초안 없음·한도 차단에만 쓴다.
   * 비교작성 탭(st.compareTab)이면 고른 탭(작성 내용·공문)과 읽은 내용을 함께 보이고 몸통을 두 칸으로 나눈다(sidepanel.css 의 .compare) —
   * 읽은 내용 탭은 늘 오른쪽에 있으니 고를 수 없고, 비교작성 단추(탭을 여는 것)는 숨는다.
   */
  function paintView() {
    const show = !!cur();
    const canDoc = show && !el.doc.classList.contains('hidden');
    if (!canDoc && st.view.tab === 'doc') {
      st.view.tab = 'draft';
      saveView();
    }
    const compare = show && !!st.compareTab;
    if (compare && st.view.tab === 'read') st.view.tab = 'draft';
    el.workspace.classList.toggle('hidden', !show);
    el.workspace.classList.toggle('folded', !st.view.workspaceOpen);
    el.workspaceBody.hidden = !st.view.workspaceOpen;
    el.workspaceBody.classList.toggle('compare', compare);
    el.workspaceToggle.setAttribute('aria-expanded', String(st.view.workspaceOpen));
    el.workspaceFoldLabel.textContent = st.view.workspaceOpen ? '접기' : '펼치기';
    const label = `${compare ? `${TAB_LABEL[st.view.tab]}·읽은 내용` : TAB_LABEL[st.view.tab]} ${st.view.workspaceOpen ? '접기' : '펼치기'}`;
    el.workspaceToggle.setAttribute('aria-label', label);
    el.workspaceToggle.title = label;
    el.viewDoc.disabled = !canDoc;
    el.viewDoc.title = show && !canDoc ? '참고 문서에서 합계 금액을 확인하세요' : '공문 제목·본문·문서설정';
    el.viewRead.disabled = compare;
    if (compare) el.viewRead.title = '비교작성 — 읽은 내용은 오른쪽에 있습니다';
    el.compare.hidden = !!st.compareTab;
    for (const [tab, panel, name] of [[el.viewDraft, el.draft, 'draft'], [el.viewDoc, el.doc, 'doc'], [el.viewRead, el.readView, 'read']]) {
      const active = st.view.tab === name;
      const beside = compare && name === 'read';
      tab.classList.toggle('active', active);
      tab.classList.toggle('beside', beside);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panel.hidden = !show || !(active || beside);
    }
    el.evidenceBody.hidden = !st.view.evidenceOpen;
    el.evidenceToggle.setAttribute('aria-expanded', String(st.view.evidenceOpen));
    el.evidenceToggle.title = `참고 문서 ${st.view.evidenceOpen ? '접기' : '펼치기'}`;
  }

  function revealEvidence() {
    if (st.view.evidenceOpen) return;
    st.view.evidenceOpen = true;
    saveView();
  }

  /** 읽은 내용 탭을 연다 — 읽은 칸에 채울 것이 남았거나 한도에 걸렸을 때. 비교작성 탭이면 이미 오른쪽에 보이니 탭은 두고 접힌 몸통만 편다. */
  function showRead() {
    if (!st.compareTab) st.view.tab = 'read';
    st.view.workspaceOpen = true;
    saveView();
  }

  function selectView(tab) {
    if (!TAB_LABEL[tab]) return;
    if ((tab === 'doc' && el.viewDoc.disabled) || (tab === 'read' && st.compareTab)) return;
    st.view.tab = tab;
    st.view.workspaceOpen = true;
    paintView();
    saveView();
  }

  function onViewClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-gm-view]') : null;
    if (btn && !btn.disabled) selectView(btn.dataset.gmView);
  }

  function onViewKey(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-gm-view]') : null;
    if (!btn || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    // 탭 차례는 공문 · 작성 내용 · 읽은 내용(2026-10-12 사용자 지정: "공문/작성내용/읽은 내용 순으로").
    const tabs = [el.viewDoc, el.viewDraft, el.viewRead].filter((t) => !t.disabled);
    const i = tabs.indexOf(btn);
    const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1)
      : tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    selectView(next.dataset.gmView);
    next.focus();
  }

  /* ---------------------------------------------------------- 갈래 */

  /** 갈래 단추 — 레시피의 갈래(구매·교육·출장·외부활동)와 맨 끝의 에이전트(공문 검색 — 비교작성 탭에는 없다). 단추 글자는 검색(2026-10-21 부터 두 글자 — "지금 4글자인걸 2글자로 줄이면 될듯". 2026-10-16 ~ 10-20 은 공문검색: "일단 공문 안에 있는 건
   *  공문검색 넣어줘" — 10-12 부터 HELP 였다. 사용법 도움말은 따로 만든다). 에이전트가 켜져 있으면 갈래에는 불이 없다. */
  function paintKinds() {
    const agent = st.compareTab ? '' : `<button type="button" class="gm-kind gm-kind-agent${agentOn() ? ' active' : ''}" data-kind="${AGENT_KIND}" aria-pressed="${agentOn()}"`
      + ' title="공문 검색 — 받은 공문(결재함)·보낸 공문(기안함)을 말로 찾습니다"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></svg>검색</button>';
    el.kinds.innerHTML = `<div class="gm-kind-row">${KIND_ORDER.map((k) => {
      const on = k === st.kind && !agentOn();
      return `<button type="button" class="gm-kind${on ? ' active' : ''}" data-kind="${k}" aria-pressed="${on}" title="${escapeHtml(KINDS[k].title)}">${escapeHtml(KINDS[k].label)}</button>`;
    }).join('')}${agent}</div>`;
    paintOrderBtn();
  }

  /**
   * 구매의뢰 작성 단추(gmOrder — 공문 작성·공문 보기 줄의 세 번째) — 구매 갈래에서만 보인다(2026-10-17 사용자 지정: "우측 하단에 구매의뢰하기 버튼을 넣던지, 구매할때
   * 같이 작성할 수 있던지"). 레시피에 구매의뢰 갈래(KINDS.order)가 없으면 늘 숨는다. 이미 구매의뢰 초안이 있으면 덮는다고(되돌릴 수 없음) title 에 적는다. 갈래 줄과 함께 그린다.
   */
  function paintOrderBtn() {
    const on = st.kind === 'purchase' && !!KINDS.order;
    el.order.hidden = !on;
    if (!on) return;
    el.order.title = st.work.order
      ? '이 구매 품의로 구매요청서(총무팀 수신) 초안을 만들어 구매의뢰 갈래로 갑니다 — 이미 있는 구매의뢰 초안을 덮습니다(되돌릴 수 없음)'
      : '이 구매 품의로 구매요청서(총무팀 수신) 초안을 만들어 구매의뢰 갈래로 갑니다';
  }

  /** 갈래 줄 — 에이전트는 검색 카드를 켜고, 갈래는 에이전트를 끄고 그 갈래로 간다(같은 갈래라도 에이전트만 끈다). */
  function onKindClick(e) {
    const b = e.target instanceof Element ? e.target.closest('[data-kind]') : null;
    if (!b) return;
    if (b.dataset.kind === AGENT_KIND) {
      enterAgent();
      return;
    }
    leaveAgent();
    setKind(b.dataset.kind);
  }

  function setKind(kind) {
    if (!KINDS[kind] || kind === st.kind) return;
    st.kind = kind;
    // 비교작성 탭에서 갈래를 바꿔도 사이드패널이 다음에 열릴 갈래는 건드리지 않는다.
    if (!st.compareTab) chrome.storage.local.set({ [KIND_KEY]: kind });
    setStatus('');
    paintKinds();
    paintIntake();
    renderFields();
    paintDraft({ fold: true });
    paintTpl();
    paintHist();
  }

  /* ---------------------------------------------------------- 문서 넣기 */

  /**
   * 문서 넣는 곳 — 세 갈래가 같은 곳을 쓴다(2026-10-08 사용자 지정: "구매, 교육, 출장 모두 동일한 캡처/파일 넣기 기능"). 상자 안의 말은 머리말과
   * 안내 한 줄("드래그 · 붙여넣기 · 캡처 가능")뿐이다 — 넣은 장 수·한도 안내 두 줄은 뺐다(같은 날 사용자 지정: "중간에 3줄이나 있는 건 모두 삭제").
   * 이미 읽은 초안이 있으면 낮은 추가 행으로 줄이고 머리말이 더 넣는 말(KINDS.more — 꼭 드는 첨부가 빠졌으면 그것, moreLead)이 된다 — 넣으면 앞서 넣은 것과 함께 다시 읽고
   * 같이 첨부한다. 한도(MAX_FILES)는 넘길 때 상태 줄이 말한다.
   */
  function paintIntake() {
    const k = KINDS[st.kind];
    el.intake.classList.toggle('off', !st.ready);
    el.intake.setAttribute('aria-busy', String(st.busy || st.capturing));
    const w = cur();
    el.intake.classList.toggle('compact', !!w);
    const docs = (w?.draft.attach || []).filter((a) => a.files?.length);
    el.evidenceCount.textContent = !w ? '' : docs.length ? `첨부 ${docs.length}종` : w.source?.label === '직접 입력' ? '직접 입력' : '문서 읽음';
    el.dropLead.textContent = st.capturing ? '캡처하는 중…' : st.busy ? '읽는 중…' : w ? moreLead(st.kind, w.draft.attach) : k.ask;
    el.dropLead.title = el.dropLead.textContent;   // 한 줄로 잘렸을 때 다 보이게(sidepanel.css)
    el.file.disabled = st.busy || st.capturing;
    el.capture.innerHTML = pickButton({ picking: pick.picking(PICK_KEY), disabled: st.busy || st.capturing });
    el.manual.disabled = st.busy;
    el.manual.hidden = !!w;
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      fr.readAsDataURL(file);
    });
  }

  /** 캡처한 화면은 이름 없이("image.png") 온다. 무엇인지 보이게 문서 이름과 날짜를 붙인다. */
  /**
   * 캡처한 화면은 이름 없이("image.png") 온다. 무엇인지 보이게 문서 이름과 날짜를 붙인다. 이름은 초안 안에서 겹치지 않게 한다 —
   * 읽기가 파일 이름으로 문서 종류(견적서·교육 내용)를 짚어 돌려준다(input.yaml gongmun 의 parts).
   */
  function namedPaste(file, taken = []) {
    const base = /^image\.[a-z0-9]+$/i.test(file.name || '') ? `캡처_${today()}.${file.name.split('.').pop().toLowerCase()}` : file.name;
    let name = base;
    for (let i = 2; taken.includes(name); i++) name = base.replace(/(\.[^.]+)?$/, (ext) => `_${i}${ext}`);
    if (name === file.name) return file;
    // file.constructor 는 그 파일이 온 창의 File 이다 — 다른 창(검사 환경)의 File 로 싸면 FileReader 가 읽지 못한다.
    return new file.constructor([file], name, { type: file.type });
  }

  /** 읽을 곳을 정한다 — 쓰던 과제가 아직 있으면 그것, 아니면 마지막에 고른 과제, 과제가 하나뿐이면 그것. */
  function defaultProject(prev) {
    const list = choices();
    const has = (name) => !!name && list.some((p) => p.name === name);
    if (has(prev?.project)) return prev.project;
    if (has(st.lastProject)) return st.lastProject;
    return list.length === 1 ? list[0].name : '';
  }

  /** 읽기에 보내는 파일인가 — 웹페이지 캡처의 뒷장(자리가 모자라 첨부에만 넣는 장)은 보내지 않는다. */
  const readable = (f) => !f.attachOnly;
  /** 읽기가 파일째 보는 꼴인가 — 그림·PDF. 그 밖(한글·워드·파워포인트·엑셀 …)은 원본 첨부로 받고 글자를 뽑아 준다. */
  const viewable = (f) => /^image\//.test(f.type || '') || f.type === 'application/pdf';
  /** 원본 첨부의 첨부 목록 이름 — 파일 이름에서 확장자를 뗀 것(본문 첨부 줄의 "1. 발표자료 양식 1부."). */
  const originalLabel = (name) => String(name || '').replace(/\.[^.]+$/, '').trim() || String(name || '첨부');

  /**
   * 초안의 첨부 목록 — 읽기가 가린 종류대로 묶고(attachWithCut), 원본 첨부 가운데 읽기가 가리지 못한 것(글자만 준 파워포인트·한글 등)은
   * 파일 이름 그대로 한 줄씩 붙인다 — 갈래의 기본 문서(견적서 등)로 묶이지 않게. 원본 첨부는 묶은 PDF 에 들지 않고 그대로 올라간다(attachFiles).
   */
  function attachOf(kind, files, parts, cut) {
    const known = new Set((parts || []).map((p) => p?.file));
    const loose = (files || []).filter((f) => f.original && !known.has(f.name));
    const list = attachWithCut(kind, parts, (files || []).filter((f) => !loose.includes(f)).map((f) => f.name), cut);
    return [...list, ...loose.map((f) => ({ label: originalLabel(f.name), files: [f.name], original: true }))];
  }

  /**
   * 원본 첨부(워드·파워포인트·엑셀·한글 문서 hwpx)의 글자를 뽑는다(src/officetext.js) — 파일은 그대로 두고 글자만 읽기에 붙여 넣은 글처럼 준다.
   * 옛 형식(hwp·doc·ppt·xls)이나 깨진 파일은 글자 없이 첨부로만 두고 notes 에 까닭을 적는다.
   * @returns {Promise<string>} 붙일 글(없으면 '')
   */
  async function officeTextOf(file, name, max, notes) {
    let mod;
    try {
      mod = await import('./src/officetext.js');
    } catch {
      return '';
    }
    if (!mod.officeKind(name, file.type)) {
      const note = mod.unsupportedNote?.(name);
      if (note) notes.push(note);
      return '';
    }
    try {
      const got = await mod.officeText(new Uint8Array(await file.arrayBuffer()), name, { max });
      if (!got?.text?.trim()) return '';
      if (got.cut) notes.push(`${name} 의 글자가 길어 앞부분만 읽었습니다 — 파일은 그대로 첨부합니다`);
      return mod.officeTextBlock(name, got);
    } catch (err) {
      notes.push(`${name} 의 글자를 뽑지 못했습니다 — 첨부로만 넣습니다(${err.message})`);
      return '';
    }
  }

  /** 넣은 파일을 한 줄로 — 웹페이지 캡처의 장들은 묶어 "화면캡처_inflearn.com_2026-10-08 7장" 으로 적는다. */
  function filesLine(files) {
    const out = [];
    const seen = new Set();
    for (const f of files) {
      if (!f.group) {
        out.push(f.name);
        continue;
      }
      if (seen.has(f.group)) continue;
      seen.add(f.group);
      const n = files.filter((x) => x.group === f.group).length;
      out.push(n > 1 ? `${f.name.replace(/_\d+(\.[^.]+)?$/, '')} ${n}장` : f.name);
    }
    return out.join(', ');
  }

  /**
   * 문서를 읽어 초안을 만든다. 파일(그림·PDF)은 다섯 장까지 같은 건의 문서들로 보고 한 번에 읽는다.
   * 이미 읽은 초안에 더 넣으면 앞서 넣은 것과 **함께 다시 읽는다** — 교육 견적서 뒤에 교육 내용 캡처를 넣는 것이다(2026-10-07 사용자 지정).
   * 넣은 파일은 모두 첨부가 된다(문서 종류마다 한 줄 — src/gongmun.js 의 attachList). 다시 읽어도 사용자가 고친 칸은 그대로 둔다.
   * 읽는 사이에 갈래를 바꿨어도 읽기를 시작한 갈래에 담는다.
   *
   * capture 는 웹페이지를 통째로 캡처한 장들을 넣을 때다(captureTab) — 장 수가 정해져 오지 않으니 읽기에는 남은 자리만큼만 보내고
   * 나머지 장은 첨부(PDF)에만 넣는다(attachOnly). 탭을 여럿 찍었으면 탭마다 첫 장부터 돌아가며 자리를 나눈다(readSlots).
   * 한 탭의 장들은 한 묶음(group)이라 읽기가 가린 종류를 뒷장도 이어 받는다(spreadParts). 화면 글자(text)는 붙여 넣은 글과 같은 자리로 간다.
   *
   * originals 는 원본 첨부다(2026-10-15 사용자 지정: "전체 하면 메일이랑 첨부를 같이 가져오고.. 첨부는 파일 자체로 관리하지만 ocr 해서 이것도
   * 필요한 내용으로 넣는 거지") — 메일 첨부(webpick.js 의 shoot 이 files 로 준다)와, 끌어 넣은 그림·PDF 아닌 파일(한글·워드·파워포인트·엑셀)이다.
   * 파일은 그대로 두었다가(original) 공문 작성 때 묶은 PDF 뒤에 그대로 올린다(writeDoc). 그림·PDF 면 남은 자리만큼 읽기에도 보내고, 문서 파일이면
   * 글자를 뽑아 붙여 넣은 글과 같이 준다(officeTextOf) — 묶은 PDF 에는 들지 않는다(attachFiles).
   * @param {{files?: File[], text?: string, capture?: {groups: string[], counts: number[], notes?: string[]}|null, originals?: File[], notes?: string[]}} input
   *   capture.groups 는 장마다 묶음, counts 는 탭마다 장 수(찍은 차례), notes 는 읽은 내용에 덧붙일 말(너무 길어 잘린 페이지·못 찍은 탭·못 가져온 첨부)
   */
  async function intake({ files = [], text = '', capture = null, originals = [], notes: told = [] }) {
    const kind = st.kind;
    const k = KINDS[kind];
    if (st.busy) return;
    if (!capture) {
      originals = [...files.filter((f) => !viewable(f)), ...originals];
      files = files.filter(viewable);
    }
    const prev = st.work[kind] || null;
    const kept = prev?.files || [];
    const room = Math.max(MAX_FILES - kept.filter(readable).length, 0);
    if (files.length && room <= 0 && !capture && !originals.length) return setStatus(`파일은 ${MAX_FILES}장까지 넣습니다 — 새로 시작하려면 읽은 내용의 비우기를 누르세요.`, 'error');
    const slots = capture ? readSlots(capture.counts, room) : [];
    const picked = [];
    for (const [i, f] of (capture ? files : files.slice(0, room)).entries()) {
      if (!viewable(f)) return setStatus(`그림·PDF 만 읽습니다 — ${f.name}`, 'error');
      if (f.size > FILE_LIMIT) return setStatus(`파일이 너무 큽니다(${Math.round(f.size / 1048576)}MB) — 10MB 이하로 넣어 주세요.`, 'error');
      try {
        const named = namedPaste(f, [...kept, ...picked].map((x) => x.name));
        picked.push({
          name: named.name, type: f.type, size: f.size, dataUrl: await readFile(named),
          ...(capture ? { group: capture.groups[i], attachOnly: !slots[i] } : {}),
        });
      } catch (err) {
        return setStatus(err.message, 'error');
      }
    }
    // 원본 첨부 — 그림·PDF 는 남은 자리만큼 읽기에도 보내고, 문서 파일은 글자를 뽑는다. 글자의 몫은 붙여 넣은 글이 쓰고 남은 만큼을 나눈다.
    const fileNotes = [...(capture?.notes || []), ...told];
    const offices = [];
    let left = Math.max(room - picked.filter(readable).length, 0);
    const docs = originals.filter((f) => !viewable(f)).length;
    const share = docs ? Math.min(OFFICE_MAX, Math.max(OFFICE_MIN, Math.floor((TEXT_ROOM - (prev?.text || '').length - text.length) / docs))) : 0;
    for (const f of originals) {
      if (f.size > ORIGINAL_LIMIT) {
        fileNotes.push(`${f.name} 은(는) 너무 커서(${Math.round(f.size / 1048576)}MB) 넣지 않았습니다 — 첨부는 25MB 까지입니다`);
        continue;
      }
      try {
        const named = namedPaste(f, [...kept, ...picked].map((x) => x.name));
        const see = viewable(f) && f.size <= FILE_LIMIT && left > 0;
        if (see) left--;
        picked.push({ name: named.name, type: f.type || 'application/octet-stream', size: f.size, dataUrl: await readFile(named), original: true, ...(see ? {} : { attachOnly: true }) });
        if (!viewable(f)) offices.push(await officeTextOf(f, named.name, share, fileNotes));
        else if (!see) fileNotes.push(`${named.name} 은(는) 읽기 자리(${MAX_FILES}장)가 모자라 첨부로만 넣습니다`);
      } catch (err) {
        fileNotes.push(`${f.name} 을(를) 넣지 못했습니다 — ${err.message}`);
      }
    }
    text = [text, ...offices].filter((s) => s && s.trim()).join('\n\n');
    if (!picked.length && !text.trim()) {
      if (fileNotes.length) setStatus(fileNotes.join(' · '), 'error');
      return undefined;
    }
    const all = [...kept, ...picked];
    const toRead = all.filter(readable);
    const allText = [prev?.text || '', text].filter((s) => s.trim()).join('\n\n');
    // 읽을 것이 없는 원본 첨부만 더 넣었으면(글자를 못 뽑는 hwp 등) 다시 읽지 않고 첨부 목록에만 붙인다. 쓰던 초안이 없으면 읽을 것이 없다고 말한다.
    if (!toRead.length && !allText.trim()) {
      if (!prev) return setStatus(`읽을 내용이 없습니다 — ${picked.map((f) => f.name).join(', ')} 은(는) 글자를 읽지 못하는 파일입니다. 요청 메일이나 문서를 함께 넣어 주세요.`, 'error');
      Object.assign(prev, { files: all, source: { ...prev.source, from: filesLine(all) }, notes: [...(prev.notes || []), ...fileNotes] });
      prev.draft.attach = attachOf(kind, all, prev.parts, prev.cut);
      saveWork();
      if (kind === st.kind) paintDraft();
      paintIntake();
      return setStatus(`첨부로 넣었습니다 — ${picked.map((f) => f.name).join(', ')}`);
    }
    const held = picked.filter((f) => f.attachOnly && !f.original).length;
    const shots = picked.filter((f) => !f.original).length;
    const added = picked.filter((f) => f.original).length;
    // 탭을 여럿 찍었으면 읽는 장은 탭마다 앞쪽에서 고른다(readSlots) — "앞 n장" 이 아니다.
    const front = capture?.counts?.length > 1 ? '페이지마다 앞쪽부터 ' : '앞 ';
    const extra = (capture && shots
      ? (held ? ` · 캡처 ${shots}장 가운데 ${front}${shots - held}장과 화면 글자를 읽고, 나머지는 첨부에만 넣습니다` : ' · 화면 글자도 함께 읽습니다')
      : files.length > room ? ` · ${MAX_FILES}장까지만 넣습니다` : '')
      + (added ? ` · 첨부 파일 ${added}개는 파일 그대로 첨부합니다` : '');
    st.busy = true;
    revealEvidence();
    paintView();
    paintIntake();
    setStatus(`${kept.length || prev?.text ? '앞서 넣은 것과 함께 다시 ' : ''}읽는 중입니다${toRead.length > 1 ? `(${toRead.length}장)` : ''}…${extra}`);
    const { apiKey, cli } = ai();
    let done = false;
    try {
      const got = await gongmunSmart({ files: toRead, text: allText }, { kind, today: today() }, { apiKey, useNative: cli });
      const rec = { ...got.record, parts: spreadParts(got.record.parts, all) };
      if (rec.docType === 'unknown') throw new Error(`품의에 넣을 문서로 보이지 않습니다 — ${rec.summary}`);
      // 구매 — 쇼핑몰 화면이면 읽기가 짚은 가격과 그 둘레(quoteArea)를 오려 견적서 한 장으로 첨부한다(src/quotecut.js, 2026-10-08 사용자 지정).
      // 교육도 온라인 강의 페이지면 수강료 칸을 오려 교육 견적서로 첨부하고, 강의 소개·커리큘럼 장은 교육 내용으로 남긴다(같은 날 사용자 지정).
      // 앞서 원래 장으로 되돌려 두었으면 더 넣어 다시 읽어도 그대로 둔다.
      const cutNotes = [];
      const cut = CUT_KINDS.has(kind)
        ? await makeCut(all, cutBoxes(rec.quoteArea, all, rec.parts), { kind, parts: rec.parts, on: prev?.cut?.on ?? true, notes: cutNotes }) : null;
      const { draft: fresh, notes } = fromRecord(kind, rec, { me: me(), files: all.map((f) => f.name), cut });
      // 원본 첨부 가운데 읽기가 가리지 못한 것은 파일 이름으로 한 줄씩(attachOf).
      if (all.some((f) => f.original)) fresh.attach = attachOf(kind, all, rec.parts, cut);
      notes.push(...cutNotes);
      if (kind === 'purchase' && rec.docType === 'course') notes.push('교육 안내문으로 보입니다 — 교육 품의라면 교육 갈래에 다시 넣어 주세요');
      notes.push(...fileNotes);
      if (held) notes.push(`캡처 ${shots}장 가운데 ${front}${shots - held}장만 읽었습니다 — 나머지 ${held}장은 첨부 PDF 에만 들어갑니다`);
      if (got.note) notes.push(got.note);
      // 읽은 문서의 머리 — 문서 종류(레시피 reading.yaml 의 docType names) · 누구의 것(attach_rules.yaml 의 who — 구매처·교육기관·출장지·요청 기관) · 견적일.
      const what = [DOC_NAMES[rec.docType] || '문서', whoOf(kind, fresh), fresh.quoteDate].filter(Boolean).join(' · ');
      const touched = prev?.touched || [];
      st.work[kind] = {
        draft: prev ? mergeDraft(prev.draft, fresh, touched) : fresh, notes, touched, project: defaultProject(prev),
        title: prev?.title ?? null, body: prev?.body ?? null, files: all, text: allText, parts: rec.parts, cut,
        source: { label: what, from: all.length ? filesLine(all) : '붙여 넣은 글', via: got.via, summary: rec.summary },
      };
      saveWork();
      done = true;
      // read 는 API 키 길이 첨부에서 글자를 먼저 뽑으며 남긴 한 줄들(src/llm.js — 다리 길은 다리 기록에 있어 비어 있다).
      logEvent('gongmun', true, `${k.title} 문서 읽음 · ${rec.summary} · ${all.length}장 · ${VIA_LABEL[got.via] || got.via}${got.read?.length ? ` · ${got.read.join(' / ')}` : ''}`);
      setStatus(`읽었습니다(${VIA_LABEL[got.via] || got.via}) — ${rec.summary}`);
    } catch (err) {
      setStatus(err.message, 'error');
      logEvent('gongmun', false, `${k.title} 문서 읽기 실패 · ${err.message}`);
    } finally {
      st.busy = false;
      if (kind === st.kind) {
        renderFields();
        paintDraft({ fold: done, reveal: done });
      }
      paintIntake();
    }
    // 과제를 이미 골랐고 사유가 비어 있으면 과제 내용으로 사유를 쓴다.
    if (done) writeReason(kind, { auto: true });
    return undefined;
  }

  /**
   * 견적서를 오린다(구매·교육 — src/quotecut.js) — 칸(cutBoxes 가 고른 것)이 없으면 null. 못 오리면 notes 에 까닭을 적고 null 이다(넣은 장 그대로 첨부).
   * name 은 첨부 목록에 쓰는 오린 그림의 이름, drop 은 첨부에서 빠지는 장(오려 낸 화면과 같은 묶음), on 은 오린 것을 첨부하는가(원래 장으로면 false).
   * @returns {Promise<{name: string, file: object, boxes: object[], drop: string[], pad: number, on: boolean}|null>}
   */
  async function makeCut(files, boxes, { kind = 'purchase', parts = [], pad = CUT_PAD, on = true, notes = [] } = {}) {
    if (!boxes.length) return null;
    try {
      const blob = await cutQuote(files, boxes, { pad });
      const name = cutName(today(), files.map((f) => f.name));
      return { name, file: { name, type: 'image/png', size: blob.size, dataUrl: await readFile(blob) }, boxes, drop: cutDrop(boxes, files, parts, kind), pad, on };
    } catch (err) {
      notes.push(`견적서 부분을 오리지 못했습니다 — 넣은 장 그대로 첨부합니다(${err.message})`);
      return null;
    }
  }

  /** 캡처 단추를 눌렀을 때(webpick.js) — 보고 있는 탭이면 통째로, 부분이면 페이지 위에서 고르게 한다(고르는 중에 다시 누르면 그만둔다). */
  function onCaptureClick(e) {
    const r = pick.click(e);
    if (r) captureTab(r.act);
  }

  /**
   * 웹페이지를 캡처해 읽는다(2026-10-08 사용자 지정) — 교육 안내 페이지를 조각조각 캡처해 붙여 넣지 않아도 된다. act 는 단추다:
   * 'tab' 은 보고 있는 탭을 통째로, 'part' 는 페이지 위에서 프레임(틀·상자)을 하나 이상 골라 그것만("탭이 아니라 프레임으로 선택").
   * 찍는 일은 src/pagecap.js 가 한다(사이트 접근 권한 묻기 → 한 화면씩 찍기 → A4 장으로 자르기 → 화면 글자). 여기서는 그 장들과 글자를
   * 문서 넣기와 같은 길(intake)로 읽힌다 — 페이지(고른 부분)마다 한 묶음이고, 읽은 뒤 첨부 PDF 저장을 누르면 그 장들이 문서(교육 내용 등)마다
   * PDF 하나가 된다. 고르는 동안은 잠그지 않는다 — 찍기 시작할 때(onStart) 잠근다.
   */
  async function captureTab(act) {
    if (st.busy || st.capturing) return;
    let got = null;
    try {
      got = await pick.shoot(act, {
        key: PICK_KEY, today: today(),
        onStatus: (text) => { setStatus(text); paintIntake(); },
        onStart: () => { st.capturing = true; paintIntake(); },
      });
      if (got) logEvent('gongmun', true, `웹페이지 캡처 · ${got.what}`);
    } catch (err) {
      setStatus(err.message, 'error');
      logEvent('gongmun', false, `웹페이지 캡처 실패 · ${err.message}`);
    } finally {
      st.capturing = false;
      paintIntake();
    }
    if (!got) return;
    // 메일이면(webpick.js → src/mailgrab.js) 본문을 찍은 장과 함께 첨부 파일(files — 원본)과 메일 글(text — 제목·보낸 사람·본문)이 온다
    // (2026-10-15 사용자 지정: "전체 하면 메일이랑 첨부를 같이 가져오고 … 부분으로 첨부파일 클릭하면 첨부파일만 가져오고"). 메일 글이 오면
    // 본문 장의 화면 글자는 그것과 겹치니 메일 글을 쓴다. 첨부는 원본 첨부로 넣는다(intake 의 originals).
    const { pages = [], notes = [], files: originals = [], text: told = '' } = got;
    const id = `cap${Date.now()}`;
    const shots = pages.filter((p) => p.files.length);
    return intake({
      files: shots.flatMap((p) => p.files),
      text: told || pages.map((p) => p.text).filter(Boolean).join('\n\n'),
      capture: shots.length ? { groups: shots.flatMap((p, i) => p.files.map(() => `${id}_${i}`)), counts: shots.map((p) => p.files.length), notes } : null,
      originals,
      notes: shots.length ? [] : notes,
    });
  }

  /**
   * 과제의 연구 내용(R&D 탭의 연구개발 계획·진행 기록 — src/gongmun.js 의 rndProjects. 공문 설정의 과제면 거기 적은 과제 내용)으로
   * 사유(구매사유·교육사유)와 용도(교육목적)를 쓴다(2026-10-07 사용자 지정, 2026-10-08 R&D 탭의 과제로). auto 는 저절로 부른 것이다 — 과제를
   * 골랐고 사유가 비어 있고 Claude 에 닿을 때만 쓴다. 단추로 부르면 있던 사유를 고쳐 쓴다. ask 는 에이전트 칸에 적은 말이다 — 그 말대로 고쳐 쓰고
   * 답 한 줄(reply)을 돌려준다.
   * @returns {Promise<{reply: string, error?: string}|null>} 쓰지 않았으면(바쁨·초안 없음·auto 의 조건·그 사이 초안이 바뀜) null
   */
  async function writeReason(kind = st.kind, { auto = false, ask = '' } = {}) {
    const w = st.work[kind];
    if (!w || !REASON_KEYS[kind] || st.reasonBusy) return null;
    const project = projectOf(w);
    if (auto && (!project || String(w.draft[REASON_KEYS[kind].reason] || '').trim() || !st.ready)) return null;
    const { apiKey, cli } = ai();
    const basis = project?.rnd ? '연구 내용' : '과제 내용';
    st.reasonBusy = true;
    paintReasonBtn();
    paintAgent();
    setStatus(ask ? '에이전트가 용도·사유를 고쳐 쓰는 중입니다…' : `${project ? `「${project.name}」 ${basis}으로 ` : ''}사유를 쓰는 중입니다…`);
    try {
      const got = await gongmunReasonSmart(kind, w.draft, project, { apiKey, useNative: cli }, { ask });
      if (st.work[kind] !== w) return null;
      w.draft = applyReason(kind, w.draft, got.data, { touched: w.touched || [], asked: !!ask });
      saveWork();
      if (st.kind === kind) {
        for (const key of Object.values(REASON_KEYS[kind])) syncField(key);
        paintLive();
      }
      const hint = project?.content ? ''
        : project?.rnd ? ' R&D 탭에 연구개발 계획(계획서 YAML)이나 진행 기록을 넣어 두면 과제에 더 맞게 씁니다.' : ' 공문 설정에서 과제 내용을 넣어 두면 과제에 더 맞게 씁니다.';
      setStatus(`${ask ? '고쳐 썼습니다' : '사유를 썼습니다'}(${VIA_LABEL[got.via] || got.via}) — 칸에서 고칠 수 있습니다.${hint}`);
      logEvent('gongmun', true, `${KINDS[kind].title} 사유 ${ask ? '고쳐 쓰기' : '작성'} · ${project?.name || '과제 없음'} · ${VIA_LABEL[got.via] || got.via}`);
      return { reply: String(got.data.reply || '').trim() };
    } catch (err) {
      if (!auto || st.ready) setStatus(err.message, 'error');
      logEvent('gongmun', false, `${KINDS[kind].title} 사유 작성 실패 · ${err.message}`);
      return { reply: '', error: err.message };
    } finally {
      st.reasonBusy = false;
      paintReasonBtn();
      paintAgent();
    }
  }

  /** 칸 하나를 초안 값으로 — 쓰고 있는 칸은 건드리지 않는다. 펼친 칸이든 접힌 칸이든. */
  function syncField(key) {
    const node = el.root.querySelector(`[data-key="${key}"]`);
    const w = cur();
    const f = (FIELDS[st.kind] || []).find((x) => x.key === key);
    if (node && w && document.activeElement !== node) node.value = f ? fieldText(f, w.draft[key]) : w.draft[key] ?? '';
  }

  function paintReasonBtn() {
    const btn = el.fields.querySelector('[data-act="reason"]');
    if (!btn) return;
    const p = projectOf(cur());
    btn.disabled = st.reasonBusy || !p;
    btn.textContent = st.reasonBusy ? '쓰는 중…' : p?.rnd ? '연구 내용으로 쓰기' : '과제 내용으로 쓰기';
    btn.title = !p ? '과제를 먼저 고르세요'
      : p.rnd ? '고른 과제의 연구 내용(R&D 탭의 연구개발 계획·진행 기록)을 근거로 사유를 다시 씁니다' : '고른 과제의 내용(공문 설정)을 근거로 사유를 다시 씁니다';
  }

  /* ---------------------------------------------------------- 에이전트 칸 */

  /** 에이전트 칸 — 초안마다의 주고받은 말(w.agent)과 보내기 단추. */
  function paintAgent() {
    const w = cur();
    el.agent.classList.toggle('hidden', !w || !REASON_KEYS[st.kind]);
    el.agentGo.disabled = st.reasonBusy;
    el.agentLog.innerHTML = (w?.agent || []).map((m) => `<li class="gm-say ${m.who}${m.error ? ' error' : ''}">${escapeHtml(m.text)}</li>`).join('');
  }

  function growAgent() {
    el.agentInput.style.height = 'auto';
    el.agentInput.style.height = `${Math.min(el.agentInput.scrollHeight + 2, 160)}px`;
  }

  /**
   * 에이전트 칸에 적은 말대로 고른 과제의 연구 내용(R&D 탭)을 보고 용도·사유를 고쳐 쓴다(2026-10-08 사용자 지정: "에이전트 기능을 이용해서
   * 대상 rnd 의 연구 내용을 보고 자동으로 입력 … 채팅 기능을 사용할 수 있게"). 쓰는 길은 writeReason(gongmunReasonSmart — 로컬 CLI·API 키)과 같고,
   * 답 한 줄을 칸 아래에 남긴다(초안마다 CHAT_KEEP 개).
   */
  async function runAgent() {
    const kind = st.kind;
    const w = cur();
    const text = el.agentInput.value.trim();
    if (!text || !w || !REASON_KEYS[kind] || st.reasonBusy) return;
    const answer = { who: 'ai', text: '고쳐 쓰는 중...' };
    w.agent = [...(w.agent || []), { who: 'me', text: text.length > 160 ? `${text.slice(0, 160)}…` : text }, answer];
    el.agentInput.value = '';
    growAgent();
    paintAgent();
    const got = await writeReason(kind, { ask: text });
    if (!got) answer.text = '그 사이 초안이 바뀌어 넣지 않았습니다.';
    else if (got.error) Object.assign(answer, { text: got.error, error: true });
    else answer.text = got.reply || '용도·사유를 고쳐 썼습니다.';
    w.agent = w.agent.slice(-CHAT_KEEP);
    saveWork();
    if (st.kind === kind) paintAgent();
  }

  function onAgentKey(e) {
    // 한글은 조합 중에 Enter 가 한 번 더 온다 — 조합이 끝난 Enter 만 받는다. Shift+Enter 는 줄바꿈이다.
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    runAgent();
  }

  /** 문서 없이 쓴다 — Claude 가 없거나 문서가 없을 때. 읽은 칸(품목·합계…)이 비어 있으니 읽은 내용 탭이 열린다(비교작성이면 그대로 오른쪽에). */
  function startManual() {
    if (cur()) return;
    st.view = { ...st.view, tab: 'draft', evidenceOpen: true, workspaceOpen: true };
    saveView();
    st.work[st.kind] = {
      draft: blankDraft(st.kind, { me: me() }), notes: [], touched: [], project: defaultProject(null), title: null, body: null, files: [],
      text: '', source: { label: '직접 입력', from: '', via: '', summary: '' },
    };
    saveWork();
    renderFields();
    paintDraft({ fold: true });
    paintIntake();
    (!el.readView.hidden && foldedNeeds(cur()) ? el.moreFields : el.fields).querySelector('input, textarea')?.focus();
  }

  function resetWork() {
    delete st.work[st.kind];
    delete st.blocked[st.kind];
    st.view = { ...st.view, tab: 'draft', evidenceOpen: true, workspaceOpen: true };
    saveView();
    saveWork();
    setStatus('');
    renderFields();
    paintDraft();
    paintIntake();
  }

  const hasFiles = (e) => !!e.dataTransfer?.types?.includes('Files');

  /**
   * 파일을 탭 위로 끌고 왔을 때. 근태 패널이 창에 걸어 둔 가드(엉뚱한 곳에 놓으면 막는다)까지 가지 않게 여기서 멈춘다 —
   * 이 탭은 어디에 놓아도 문서 넣는 곳으로 받는다.
   */
  function onDrag(e) {
    if (!hasFiles(e) && !dropReady(e.dataTransfer?.types)) return;
    e.preventDefault();
    e.stopPropagation();
    // 비교작성 탭은 문서를 읽지 않는다(읽은 파일은 사이드패널에만 있다) — 놓아도 받지 않는다. 에이전트(공문 검색)에서도 넣을 곳이 없다.
    const can = !st.busy && !st.compareTab && !agentOn();
    e.dataTransfer.dropEffect = can ? 'copy' : 'none';
    if (e.type === 'dragleave') {
      if (!el.root.contains(e.relatedTarget)) el.intake.classList.remove('over');
      return;
    }
    el.intake.classList.toggle('over', can);
  }

  function onDrop(e) {
    const mail = !hasFiles(e) && dropReady(e.dataTransfer?.types);
    if (!hasFiles(e) && !mail) return;
    e.preventDefault();
    e.stopPropagation();
    el.intake.classList.remove('over');
    if (st.compareTab || agentOn()) return;
    // 끌어 놓은 것은 이 처리기 안에서만 읽힌다 — await 앞에서 읽어 둔다(parseDrop).
    if (mail) return void dropMail(parseDrop(e.dataTransfer));
    intake({ files: [...e.dataTransfer.files] });
  }

  /**
   * 메일 첨부를 끌어 놓았을 때(2026-10-15 사용자 지정: "메일에서 첨부 파일 목록을 인식하고 드래그 해서 갖어올 수도 있나") — Outlook 첨부
   * 카드면 그 메일 탭에서 그 파일을, 내려받기 링크면 그 주소의 파일을 가져와(src/mailgrab.js 의 grabDropped) 원본 첨부로 넣는다(intake 의
   * originals — 파일 그대로 첨부하고, 그림·PDF 는 읽고 문서 파일은 글자를 뽑는다). Outlook 카드가 다른 출처(메일 탭 → 패널)로 건너올 때
   * 첨부 정보가 실리는지는 아직 실제로 끌어 보지 못했다 — 실리지 않으면 알아보지 못했다고 말하고 캡처 단추를 권한다.
   */
  async function dropMail(drop) {
    if (st.busy || st.capturing) return undefined;
    if (!drop) return setStatus('끌어 놓은 것에서 첨부를 알아보지 못했습니다 — 메일을 연 탭에서 캡처의 전체(메일과 첨부)나 부분(첨부 파일 누르기)으로 가져오세요.', 'error');
    st.capturing = true;
    paintIntake();
    setStatus(drop.kind === 'outlook' ? `끌어 온 첨부 파일 ${drop.items.length}개를 메일에서 가져오는 중입니다…` : '끌어 온 링크의 파일을 가져오는 중입니다…');
    let got = null;
    try {
      got = await grabDropped(drop, { onStatus: (text) => { if (text) setStatus(text); } });
      logEvent('gongmun', !!got.files.length, `첨부 끌어 넣기 · ${got.files.map((f) => f.name).join(', ') || '없음'}${got.failed.length ? ` · 못 가져옴 ${got.failed.length}개` : ''}`);
    } catch (err) {
      setStatus(err.message, 'error');
      logEvent('gongmun', false, `첨부 끌어 넣기 실패 · ${err.message}`);
    } finally {
      st.capturing = false;
      paintIntake();
    }
    if (!got) return undefined;
    const notes = got.failed.map((f) => `가져오지 못한 첨부 파일 — ${f.name}: ${f.why}`);
    if (!got.files.length) return setStatus(notes.join(' · ') || '가져온 첨부 파일이 없습니다.', 'error');
    return intake({ originals: got.files, notes });
  }

  /**
   * 붙여넣기(Ctrl+V). 탭이 보일 때 클립보드에 파일(캡처한 화면·복사한 파일)이 있으면 읽는다. 글은 글 칸 밖에서 붙여 넣었을 때만
   * 문서로 읽는다(쇼핑몰 화면의 글을 복사해 온 것) — 칸 안의 붙여넣기는 그대로 간다.
   */
  function onPaste(e) {
    if (el.root.classList.contains('hidden') || st.compareTab || agentOn()) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      intake({ files });
      return;
    }
    const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]');
    const text = typing ? '' : (e.clipboardData?.getData('text/plain') || '').trim();
    if (!text) return;
    e.preventDefault();
    intake({ text });
  }

  /* ---------------------------------------------------------- 초안 */

  /**
   * 작업 카드의 읽은 내용 탭(출처·오린 견적서·품목·읽은 칸)과 작성 내용 탭(과제·용도·사유·에이전트·결재선)을 함께 그린다.
   * fold 는 새 초안을 그릴 때다 — 읽은 칸에 채울 것이 남았거나(문서 없이 쓰기·합계를 못 읽음) 한도에 걸렸으면 읽은 내용 탭을 열고
   * (비교작성이면 이미 오른쪽에 있다), 아니면 작성 내용 탭으로 간다. 오린 견적서의 단추처럼 탭 안에서 다시 그릴 때는 그대로 둔다.
   * reveal 은 문서를 읽은 뒤다 — 읽은 내용 탭을 열었으면 접힌 몸통을 편다.
   */
  function paintDraft({ fold = false, reveal = false } = {}) {
    const w = cur();
    const show = !!w;
    el.draft.classList.toggle('hidden', !show);
    el.readView.classList.toggle('hidden', !show);
    el.reset.hidden = !show;
    // 비교작성 탭에 초안이 없으면(아직 안 읽었거나 사이드패널에서 비움) 어디서 넣는지 말한다.
    if (st.compareTab && (!show || el.status.textContent === NO_DRAFT_TAB)) setStatus(show ? '' : NO_DRAFT_TAB);
    if (!show) {
      el.doc.classList.add('hidden');
      paintView();
      paintCut();
      paintAgent();
      paintProjects();
      paintFeeSum();
      return;
    }
    paintSource();
    // 품목 표 — 레시피 reads 에 items 가 있는 갈래(구매)의 초안에만 있다. 갈래 이름이 아니라 칸으로 본다(새 목적이 품목 표를 두면 그대로 보인다).
    const items = Array.isArray(w.draft.items) ? w.draft.items : [];
    el.items.innerHTML = items.map((it) => {
      const meta = [it.spec, it.qty != null ? `${it.qty.toLocaleString('ko-KR')}${it.unit || ''}` : '', won(it.amount)].filter(Boolean).join(' · ');
      return `<li><span class="gm-item-name">${escapeHtml(it.name)}</span>${meta ? `<span class="gm-item-meta">${escapeHtml(meta)}</span>` : ''}</li>`;
    }).join('');
    if (fold) {
      st.blocked[st.kind] = false;   // 새 초안 — 한도에 걸려 있으면 paintLive 가 다시 읽은 내용 탭으로 간다
      if (foldedNeeds(w)) showRead();
      else if (st.view.tab === 'read') st.view.tab = 'draft';
      saveView();
    }
    if (reveal && st.view.tab === 'read') st.view.workspaceOpen = true;
    paintProjects();
    paintAgent();
    paintLive();
  }

  /** 읽은 문서의 줄 — 무엇을 읽었는지·첨부가 될 문서·알림, 접힌 머리의 한 줄, 오린 견적서. 첨부가 바뀌면(오린 견적서의 단추) 이것만 다시 그린다. */
  function paintSource() {
    const w = cur();
    if (!w) return;
    const src = w.source || {};
    const head = [src.label, src.from && src.from !== src.label ? src.from : '', VIA_LABEL[src.via] ? `${VIA_LABEL[src.via]}로 읽음` : '']
      .filter(Boolean).map(escapeHtml).join(' · ');
    // 첨부가 될 문서 — 문서 종류마다 한 줄(교육이면 교육 견적서·교육 내용, 오린 견적서면 견적서·강의 내용).
    const attach = (w.draft.attach || []).filter((a) => a.files?.length)
      .map((a) => `${a.label}${a.files.length > 1 ? ` ${a.files.length}장` : ''}`).join(' · ');
    el.source.innerHTML = `<span>${head}</span>${attach ? `<span class="gm-attach">첨부 · ${escapeHtml(attach)}</span>` : ''}`
      + (w.notes || []).map((n) => `<span class="gm-note">${escapeHtml(n)}</span>`).join('');
    el.viewRead.title = [src.label, attach ? `첨부 ${attach}` : ''].filter(Boolean).join(' · ') || '읽은 문서의 칸·품목·첨부';
    paintCut();
  }

  /**
   * 읽은 칸(접힌 칸)에 채울 것이 남았는가 — 한도에 걸렸거나 품목·합계(교육이면 교육명·교육기간·교육비)가 비었다. 접힌 칸의 이름은 needs(src/gongmun.js)가
   * 부르는 이름 — 레시피 purpose.yaml 의 need 다. 그것이 남았으면 읽은 문서 칸을 펴 둔다.
   */
  function foldedNeeds(w) {
    const lim = overLimit(st.kind, w.draft);
    const folded = new Set((FIELDS[st.kind] || []).filter((f) => !f.open).map((f) => f.need).filter(Boolean));
    return lim.over || lim.unknown || needs(st.kind, w.draft, { preset: st.preset, project: projectOf(w), projects: choices(), rank: w.rank || '', setting: w.setting || {} }).some((n) => folded.has(n));
  }

  /**
   * 오린 견적서(구매·교육) — 오린 그림과 어디서 오렸는지. 가격·상품명이 잘렸으면 더 넓게(둘레를 더 넣어 다시 오린다), 마땅치 않으면 원래 장으로
   * (넣은 장 그대로 첨부 — 그러면 가격 부분만으로 돌아가는 단추가 선다).
   */
  function paintCut() {
    const c = CUT_KINDS.has(st.kind) ? cur()?.cut : null;
    el.cut.classList.toggle('hidden', !c);
    stashCut();
    if (!c) {
      el.cut.innerHTML = '';
      return;
    }
    const from = [...new Set(c.boxes.map((b) => b.file))].join(', ');
    const doc = escapeHtml(KINDS[st.kind].doc);
    el.cut.innerHTML = c.on
      ? `<div class="gm-cut-head"><strong>${doc}</strong><span>가격과 그 둘레를 오렸습니다 — ${escapeHtml(from)}</span></div>`
        + `<img src="${escapeHtml(c.file.dataUrl)}" alt="오린 견적서 — 가격과 그 둘레" />`
        + '<div class="gm-cut-acts">'
        + `<button type="button" class="ghost small" data-cut="wide" title="가격이나 상품명이 잘렸으면 둘레를 더 넣어 다시 오립니다"${c.pad >= MAX_PAD ? ' disabled' : ''}>더 넓게</button>`
        + '<button type="button" class="ghost small" data-cut="off" title="오리지 않고 넣은 장 그대로 첨부합니다">원래 장으로</button></div>'
      : `<div class="gm-cut-head"><strong>${doc}</strong><span>넣은 장 그대로 첨부합니다</span></div>`
        + `<div class="gm-cut-acts"><button type="button" class="ghost small" data-cut="on" title="가격과 그 둘레만 오린 그림을 ${doc}로 첨부합니다">가격 부분만 첨부</button></div>`;
  }

  /** 오린 견적서의 단추 — 더 넓게·원래 장으로·가격 부분만 첨부. 첨부 목록(본문 ※ 첨부·PDF)이 따라 바뀐다. */
  async function onCutClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-cut]') : null;
    const kind = st.kind;
    const w = cur();
    // 비교작성 탭은 읽은 장(w.files)이 없어 다시 오리지 못한다 — 단추는 숨겨 두었다(sidepanel.css).
    if (!btn || btn.disabled || !w?.cut || st.compareTab) return;
    if (btn.dataset.cut === 'wide') {
      btn.disabled = true;
      const notes = [];
      const next = await makeCut(w.files || [], w.cut.boxes, { kind, parts: w.parts, pad: Math.min(w.cut.pad + PAD_STEP, MAX_PAD), notes });
      if (st.work[kind] !== w) return;   // 그 사이 비웠거나 다시 읽었다
      if (!next) {
        btn.disabled = false;
        setStatus(notes[0], 'error');
        return;
      }
      w.cut = next;
    } else {
      w.cut.on = btn.dataset.cut === 'on';
    }
    w.draft.attach = attachOf(kind, w.files || [], w.parts, w.cut);
    saveWork();
    if (st.kind === kind) {
      paintSource();
      paintLive();
      paintIntake();   // 교육 견적서가 빠지면 넣는 곳의 말이 그것을 넣으라고 한다(moreLead)
    }
  }

  const NO_PROJECT = '<p class="gm-noproj">과제가 없습니다. <button type="button" class="ghost small" data-act="rnd">R&amp;D 탭에서 과제 더하기</button></p>';

  /**
   * 과제 칩 — R&D 탭의 과제(없으면 공문 설정의 과제). 구매·교육·출장은 갈래 아래의 과제 줄(PICK_FIRST — 별칭 칩)에서, 그 밖의 과제를 고르는 갈래는 작성 내용 탭
   * 안의 목록(과제명과 별칭·책임자)에서 고른다. 초안이 없을 때도 그린다 — 과제 줄은 문서를 넣기 전에 고른다.
   */
  function paintProjects() {
    const first = PICK_FIRST.includes(st.kind);
    // 과제를 고르지 않는 갈래(외부활동 — 외부강의등 신고서에는 과제 칸이 없다, 2026-10-15)는 과제 줄도 목록도 없다.
    const inCard = !first && usesProject();
    el.projBar.classList.toggle('hidden', !first);
    el.projLabel.classList.toggle('hidden', !inCard);
    el.projects.classList.toggle('hidden', !inCard);
    paintProjInfo();
    if (first) paintPick();
    else if (inCard) paintProjList();
    else el.projects.innerHTML = '';
  }

  /**
   * 갈래 아래의 과제 줄 — 칩은 R&D 탭처럼 별칭(없으면 과제명)이고 과제명·과제번호·책임자는 툴팁이다. 초안이 있으면 그 초안의 과제, 없으면 넣을 문서가
   * 시작할 과제(defaultProject — 마지막에 고른 과제, 과제가 하나뿐이면 그것)가 켜진다. 아무것도 켜지지 않았으면 머리말이 고르라고 한다.
   */
  function paintPick() {
    const w = cur();
    const list = choices();
    const picked = w ? w.project : defaultProject(null);
    const on = list.some((p) => p.name === picked);
    el.projBar.classList.toggle('need', !!list.length && !on);
    el.projBar.querySelector('.gm-projbar-label').textContent = list.length && !on ? '과제 선택' : '연결 과제';
    el.pick.innerHTML = list.length ? list.map((p, i) => {
      const active = p.name === picked;
      const tip = [p.name, p.code, p.lead ? `책임자 ${p.lead}` : ''].filter(Boolean).join(' · ');
      return `<button type="button" class="gm-pick${active ? ' active' : ''}" role="radio" aria-checked="${active}" data-proj="${i}" title="${escapeHtml(tip)}">`
        + `${escapeHtml(p.alias || p.name)}</button>`;
    }).join('') : NO_PROJECT;
  }

  /** 작성 내용 탭 안의 과제 목록(갈래 아래의 과제 줄이 없는 갈래 — 2026-10-15 까지는 외부활동) — 과제명과 별명·책임자. */
  function paintProjList() {
    const w = cur();
    const list = choices();
    if (!list.length) {
      el.projects.innerHTML = NO_PROJECT;
      return;
    }
    el.projects.innerHTML = list.map((p, i) => {
      const on = w?.project === p.name;
      const tip = [p.name, p.alias ? `별명 ${p.alias}` : '', p.code, p.lead ? `책임자 ${p.lead}` : ''].filter(Boolean).join(' · ');
      const meta = [p.alias ? `별명 ${p.alias}` : '', p.lead ? `책임 ${p.lead}` : ''].filter(Boolean).join(' · ');
      return `<button type="button" class="gm-proj${on ? ' active' : ''}" role="radio" aria-checked="${on}" data-proj="${i}" title="${escapeHtml(tip)}">`
        + `<span class="gm-proj-name">${escapeHtml(p.name)}</span>${meta ? `<span class="gm-proj-lead">${escapeHtml(meta)}</span>` : ''}</button>`;
    }).join('');
  }

  /**
   * 고른 과제의 기본 내용 — 별명(제목)·과제번호·연구기간(과제 개요)·책임자(합의자)·내용(사유의 근거)이 들어 있는지 한 줄로 보인다(2026-10-07 사용자 지정
   * "과제 기본 내용을 넣을 수 있는 칸"). 빈 것은 흐리게 적는다. R&D 탭의 과제면 내용은 연구 내용(연구개발 계획 n차년도·진행 기록 n건)이고
   * 단추는 R&D 탭으로 간다. 공문 설정의 과제면 고치기는 공문 설정의 그 과제 줄로 간다.
   */
  function paintProjInfo() {
    const p = projectOf(cur());
    el.projInfo.classList.toggle('hidden', !p);
    if (!p) {
      el.projInfo.innerHTML = '';
      return;
    }
    const bit = (label, value, empty) => (value ? `<span>${label} <b>${escapeHtml(value)}</b></span>` : `<span class="gm-miss">${empty}</span>`);
    const research = p.rnd
      ? bit('연구 내용', [p.rnd.plan ? `연구개발 계획 ${p.rnd.plan}차년도` : '', p.rnd.logs ? `진행 기록 ${p.rnd.logs}건` : ''].filter(Boolean).join(' · ') || (p.content ? `${p.content.length.toLocaleString('ko-KR')}자` : ''),
        '연구 내용 없음 — R&D 탭에 계획서 YAML·진행 기록을 넣으면 사유가 과제에 맞게 써집니다')
      : bit('내용', p.content ? `${p.content.length.toLocaleString('ko-KR')}자` : '', '과제 내용 없음 — 사유가 일반적으로 써집니다');
    // 참조자는 이 과제의 이 갈래의 사람(R&D 탭 행정지원에서 참조로 고른 사람 + 과제 YAML 의 공문.참조자) — 있을 때만 보인다. 없으면 참조 없이 쓴다.
    const refs = projectRefs(p, st.kind);
    el.projInfo.innerHTML = '<strong>과제 기본 내용</strong>'
      + [bit('별명', p.alias, '별명 없음 — 제목에 과제명이 들어갑니다'), bit('번호', p.code, '번호 없음'),
        bit('Job Id', p.job, 'Job Id 없음 — 작성 때 책임자·과제명으로 찾습니다'), bit('기간', p.period, '연구기간 없음'),
        bit('책임자', p.lead, '책임자 없음 — 합의자가 빕니다'), ...(refs.length ? [bit('참조자', refs.join(', '), '')] : []), research].join('')
      + (p.rnd ? '<button type="button" class="ghost small" data-act="rnd">R&amp;D 탭</button>'
        : `<button type="button" class="ghost small" data-act="preset" data-name="${escapeHtml(p.name)}">고치기</button>`);
  }

  function onProjectClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-proj], [data-act="preset"], [data-act="rnd"]') : null;
    if (!btn) return;
    if (btn.dataset.act === 'preset') {
      openPreset(btn.dataset.name || '');
      return;
    }
    // R&D 탭으로 — 과제를 더하거나 연구 내용(계획서 YAML·진행 기록)을 넣는다. 돌아오면 다시 읽는다(show).
    if (btn.dataset.act === 'rnd') {
      $('tabRnd')?.click();
      return;
    }
    const w = cur();
    const p = choices()[+btn.dataset.proj];
    if (!p) return;
    const first = PICK_FIRST.includes(st.kind);
    // 문서를 넣기 전에 과제 줄에서 고른다 — 다음에 넣는 문서(문서 없이 쓰기도)가 이 과제로 시작한다(defaultProject).
    if (!w) {
      if (!first) return;
      st.lastProject = p.name;
      saveWork();
      paintProjects();
      return;
    }
    // 과제 줄은 하나를 고르는 곳이라 켜진 칩을 다시 눌러도 그대로다. 카드 안의 목록은 다시 누르면 고른 것을 푼다.
    const next = first || w.project !== p.name ? p.name : '';
    if (next === w.project) return;
    w.project = next;
    if (w.project) st.lastProject = w.project;
    saveWork();
    paintProjects();
    paintLive();
    paintReasonBtn();
    // 사유가 비어 있으면 고른 과제의 연구 내용으로 쓴다.
    if (w.project) writeReason(st.kind, { auto: true });
  }

  /** 칸에 보이는 글 — 금액은 쉼표, 수는 그대로, 빈 값은 빈 글. */
  const fieldText = (f, raw) => (f.type === 'money' ? (moneyOf(raw) != null ? moneyOf(raw).toLocaleString('ko-KR') : '')
    : f.type === 'number' ? (moneyOf(raw) != null ? String(moneyOf(raw)) : '') : (raw ?? ''));

  /** 칸 하나. 사유 칸에는 연구 내용(과제 내용)으로 쓰는 단추를 붙인다(2026-10-07 사용자 지정). */
  function fieldHtml(f, w) {
    const id = `gmF_${f.key}`;
    const raw = w.draft[f.key];
    const value = fieldText(f, raw);
    const ph = f.placeholder || '';
    // time 은 24시간 HH:MM(외부강의등 신고서의 시작·종료 시간), number 는 쉼표 없는 수(총 시간·당월 누적).
    const type = f.type === 'date' || f.type === 'time' ? f.type : 'text';
    const input = f.type === 'choice'
      ? `<select id="${id}" data-key="${f.key}">${f.options.map((o) => `<option${o === value ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`
      : f.area
        ? `<textarea id="${id}" data-key="${f.key}" rows="2" placeholder="${escapeHtml(ph)}">${escapeHtml(value)}</textarea>`
        : `<input id="${id}" data-key="${f.key}" type="${type}"${f.type === 'money' || f.type === 'number' ? ' inputmode="numeric"' : ''}`
          + ` value="${escapeHtml(value)}" placeholder="${escapeHtml(ph)}" autocomplete="off" />`;
    const act = REASON_KEYS[st.kind]?.reason === f.key ? '<button type="button" class="ghost small gm-reason" data-act="reason">과제 내용으로 쓰기</button>' : '';
    return `<div class="gm-field${f.wide ? ' wide' : ''}" data-field="${f.key}"><div class="gm-field-head"><label for="${id}">${escapeHtml(f.label)}</label>${act}</div>${input}</div>`;
  }

  /** 초안의 칸 — 펼쳐 두는 칸(open: 용도·사유)은 위에, 나머지 읽은 칸은 접힌 읽은 문서 안에 그린다. */
  function renderFields() {
    const w = cur();
    const list = FIELDS[st.kind] || [];
    el.fields.innerHTML = w ? list.filter((f) => f.open).map((f) => fieldHtml(f, w)).join('') : '';
    el.moreFields.innerHTML = w ? list.filter((f) => !f.open).map((f) => fieldHtml(f, w)).join('') : '';
    paintReasonBtn();
  }

  function onFieldInput(e) {
    const node = e.target instanceof Element ? e.target.closest('[data-key]') : null;
    const w = cur();
    const f = node && (FIELDS[st.kind] || []).find((x) => x.key === node.dataset.key);
    if (!w || !f) return;
    if (f.key === 'gist' && w.draft.summary === summaryOf(w.draft.gist)) {
      // 요약을 손대지 않았으면 품목 요지를 따라간다.
      w.draft.summary = summaryOf(node.value);
      const s = el.moreFields.querySelector('[data-key="summary"]');
      if (s) s.value = w.draft.summary;
    }
    w.draft[f.key] = f.type === 'money' || f.type === 'number' ? moneyOf(node.value) : node.value;
    if (e.type === 'change' && f.type === 'money' && moneyOf(node.value) != null) node.value = moneyOf(node.value).toLocaleString('ko-KR');
    // 교육 구분을 손대지 않았으면 교육장소·교육기관을 따라간다("온라인" 이라 적으면 제목이 온라인교육 품의가 된다).
    if ((f.key === 'place' || f.key === 'provider') && 'mode' in w.draft && !(w.touched || []).includes('mode')) {
      w.draft.mode = eduModeOf({ ...w.draft, mode: '' });
      syncField('mode');
    }
    // 사용자가 고친 칸 — 문서를 더 넣어 다시 읽어도 그대로 둔다(src/gongmun.js 의 mergeDraft).
    w.touched = [...new Set([...(w.touched || []), f.key])];
    saveWork();
    paintLive();
  }

  /**
   * 구매의뢰(구매요청서)의 회계 계정 줄(2026-10-17 사용자 지정: "계정과목코드 계정과목명, 예산부서코드 또는 I/O 입력 예산금액도 같이 조회") — 고른 과제의 회계 예산 스냅샷(R&D 탭 과제 정보 카드의
   * 회계 예산 — e-accounting 부서 예산 요약, src/eacct.js)의 계정과목 칩. 지금 초안의 계정과목코드와 같은 칩이 켜진다. 누르면(onAcctRowClick) 예산 내역 다섯 칸이 그 줄로 채워진다 — 처음 값은
   * orderAuto 가 과제의 계정에 맞는 줄로 채우고, 다른 계정(연구재료비 → 연구시설·장비비)으로 살 때 여기서 바꾼다. 과제에 회계 I/O 가 없으면 숨고, 스냅샷이 없으면 R&D 탭에서 조회하라고 적는다.
   */
  function paintAcctRow(w) {
    const p = st.kind === 'order' && w ? projectOf(w) : null;
    const show = !!p && !!p.io;
    el.acctRow.classList.toggle('hidden', !show);
    if (!show) {
      el.acctRow.innerHTML = '';
      return;
    }
    const a = p.acct && p.acct.io === p.io ? p.acct : null;
    const rows = a?.rows || [];
    const head = `<strong>회계 계정 줄 — I/O ${escapeHtml(p.io)}${a ? ` · ${escapeHtml(a.year)}년` : ''}</strong>`;
    if (!rows.length) {
      el.acctRow.innerHTML = `${head}<span class="gm-miss">회계 예산을 아직 받지 못했습니다 — R&D 탭의 과제 정보 카드에서 조회하세요</span>`;
      return;
    }
    const cur = String(w.draft.subjectCode || '').trim();
    el.acctRow.innerHTML = head + rows.map((r) => {
      const on = !!cur && r.code === cur;
      const short = String(r.name || '').split('_').pop() || r.code;
      return `<button type="button" class="gm-acct-chip${on ? ' active' : ''}" data-acct="${escapeHtml(r.code)}" aria-pressed="${on}" title="${escapeHtml(`${r.code} ${r.name} · 예산 ${won(r.budget)} · 실적 ${won(r.actual)} · 가용 ${won(r.available)}`)}">${escapeHtml(short)} <b>${escapeHtml(won(r.budget))}</b></button>`;
    }).join('');
  }

  /** 회계 계정 칩 — 예산 내역 다섯 칸(계정과목코드·계정과목명·I/O 코드·I/O 명·예산금액)을 그 줄로. 사람이 고른 것이라 touched 에 든다(문서를 다시 읽어도 둔다). */
  function onAcctRowClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-acct]') : null;
    const w = cur();
    const p = w ? projectOf(w) : null;
    const a = p?.acct && p.acct.io === p.io ? p.acct : null;
    const r = btn && a ? (a.rows || []).find((x) => x.code === btn.dataset.acct) : null;
    if (!w || !r) return;
    const put = { subjectCode: r.code, subjectName: r.name, ioCode: a.io, ioName: a.ioName || '', budgetAmount: r.budget };
    Object.assign(w.draft, put);
    w.touched = [...new Set([...(w.touched || []), ...Object.keys(put)])];
    for (const key of Object.keys(put)) syncField(key);
    saveWork();
    paintLive();
  }

  /** 사유 칸 옆의 "과제 내용으로 쓰기". */
  function onFieldClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-act="reason"]') : null;
    if (btn && !btn.disabled) writeReason(st.kind);
  }

  /**
   * 셈하는 칸(레시피 purpose.yaml 의 from: auto — 사용자가 고친 칸은 둔다). 바뀐 칸만 화면에 맞추고 남긴다. 칸을 고칠 때마다·과제를 바꿀 때마다 다시 센다(paintLive).
   *   외부활동(외부강의등 신고서) — 총 시간은 시작·종료 시간으로, 당해 연도 누적·당월 누적·직급·요청인의 대표자·담당자는 공문 이력의 지난 신고서로
   *   (src/gongmun.js 의 outsideAuto · src/gmlist.js 의 outsideHistory). 이력을 아직 읽지 않았으면 총 시간만 센다.
   *   구매의뢰(구매요청서) — 수요시기는 오늘+14일, 특기사항은 선행 품의 승인에 따른 구매 요청(없으면 해당 없음), 계정과목명은 고른 과제의 계정, 첨부자료 안내문구는 첨부 목록으로
   *   (src/gongmun.js 의 orderAuto — 2026-10-17).
   */
  function autoFill(w) {
    if (!w) return;
    let got;
    if (st.kind === 'order') {
      got = orderAuto(w.draft, { project: projectOf(w), today: today(), touched: w.touched || [] });
    } else if (isOutside()) {
      const hist = st.hist.at ? outsideHistory(reportsOf(), { org: w.draft.org, from: w.draft.from, fee: moneyOf(w.draft.fee), today: today() }) : null;
      got = outsideAuto(w.draft, { touched: w.touched || [], hist });
    } else {
      return;
    }
    if (!got.changed.length) return;
    w.draft = got.draft;
    for (const key of got.changed) syncField(key);
    saveWork();
  }

  /** 칸을 고칠 때마다 바뀌는 것 — 셈하는 칸(외부활동), 한도, 결재선, 남은 것, 공문. */
  function paintLive() {
    const w = cur();
    if (!w) return;
    autoFill(w);
    paintAcctRow(w);
    const lim = overLimit(st.kind, w.draft);
    const blocked = lim.over || lim.unknown;
    el.limit.classList.toggle('hidden', !blocked);
    el.limit.classList.toggle('warn', !lim.over);
    // 합계 칸은 읽은 내용 탭에 있다 — 새로 한도에 걸리면 그 탭을 열고(비교작성이면 오른쪽에 있다) 한도 알림이 있는 참고 문서도 편다.
    if (blocked && !st.blocked[st.kind]) {
      showRead();
      revealEvidence();
    }
    st.blocked[st.kind] = blocked;
    if (lim.over) {
      el.limit.innerHTML = `합계 <strong>${won(lim.amount)}</strong> — 부서 ${escapeHtml(KINDS[st.kind].title)}는 <strong>${manwon(lim.limit)} 이하</strong>만 작성합니다. `
        + '합계를 잘못 읽었으면 읽은 문서의 합계 칸을 고쳐 주세요.';
    } else if (lim.unknown) {
      el.limit.textContent = `합계(원)를 몰라 ${manwon(lim.limit)} 이하인지 가리지 못했습니다 — 읽은 문서의 합계 칸에 부가세 포함 금액(원)을 적어 주세요.`;
    }
    const account = el.moreFields.querySelector('[data-key="account"]');
    if (account) account.placeholder = projectOf(w)?.account || KINDS[st.kind].account;
    const p = projectOf(w);
    el.line.innerHTML = lineHtml(approvalLine(lineCtx(w)), { needLead: !!p && !String(p.lead || '').trim() });
    const left = needs(st.kind, w.draft, { preset: st.preset, project: projectOf(w), projects: choices(), rank: w.rank || '', setting: w.setting || {} });
    el.need.textContent = left.length ? `남은 것: ${left.join(' · ')}` : '';
    paintBudget(w, p, lim);
    paintFeeSum();
    paintDoc(blocked);
  }

  /**
   * 과제 기본 내용 아래의 예산 줄(2026-10-12 사용자 지정: "구매 또는 공문 작성 시 비용을 R&D 의 연구활동비나 비용을 비교해서 예산이 남아 있는지 … rerp 기능이 연동이 되어 있다면") —
   * 이번 비용(한도와 같은 합계 칸 — 구매 합계·교육 수강료·출장 예상경비, 원화일 때)을 고른 R&D 과제의 올해 차년도 예산과 견준다(src/gmbudget.js budgetCheck — rERP 집행내역의 그 비목
   * 잔액, 없으면 장부의 계획 − 집행). 비목은 계정 칸(초안 → 과제의 계정 → 갈래 기본값)에서 고른다. 금액이 드는 갈래(계정이 있는 구매·교육·출장)에서 R&D 탭의 과제를 골랐을 때만 보이고,
   * 모자라면 붉게(short) — 작성은 막지 않는다. 견줄 예산이 없으면(rERP 를 잇지 않았고 계획도 없음) 흐리게(hint) 어디서 넣는지 말한다. 금액마다 다시 그린다(paintLive).
   */
  function paintBudget(w, p, lim) {
    const rid = p?.rnd?.id;
    const on = !!KINDS[st.kind].account && !!rid && !!st.book;
    el.budget.classList.toggle('hidden', !on);
    if (!on) {
      el.budget.innerHTML = '';
      el.budget.title = '';
      el.budget.classList.remove('short', 'hint');
      return;
    }
    const amount = w.draft?.currency && w.draft.currency !== 'KRW' ? null : lim.amount;
    const account = String(w.draft?.account || '').trim() || p.account || KINDS[st.kind].account;
    const c = budgetCheck(st.book, rid, { amount, account, today: today(), set: st.rndSet, plans: st.plans });
    el.budget.classList.toggle('short', c?.state === 'short');
    el.budget.classList.toggle('hint', !c);
    if (!c) {
      el.budget.textContent = `R&D 예산 정보 없음 — R&D 탭에서 rERP 집행내역을 잇거나 예산 칸에 계획을 적으면 ${itemOf(account)} 잔액과 견줍니다`;
      el.budget.title = '';
      return;
    }
    el.budget.innerHTML = escapeHtml(budgetText(c)).replace(/(\d[\d,]*원)/g, '<b>$1</b>');
    el.budget.title = budgetTitle(c);
  }

  /**
   * 결재선 한 줄. 과제책임자가 기안자 본인이 아니면 합의자다(src/gongmun.js 의 approvalLine) — 과제를 골랐는데 책임자가 비면(needLead)
   * 합의 자리를 빈 칸으로 붉게 세워 둔다(2026-10-08 사용자 지정: "과제 책임자가 본인이 아니면 과제 책임자 합의로 들어가야 함").
   */
  function lineHtml(line, { needLead = false } = {}) {
    const role = (r) => ROLE_LABEL[r] || r;
    const last = line.missing?.length ? -1 : line.steps.findLastIndex((s) => s.role === '결재');
    const steps = line.steps.map((s, i) => `<span class="gm-step"><em>${role(s.role)}</em>${escapeHtml(s.name)}${s.why ? `<small>${s.why}${i === last && line.delegation ? ' · 전결' : ''}</small>` : ''}</span>`);
    if (needLead) steps.splice(1, 0, `<span class="gm-step miss"><em>${role('합의')}</em>과제책임자를 정하세요</span>`);
    // 위임전결로 결재선에 설 직책 가운데 공문 설정에 이름이 없는 것(부서장·소장·본부장).
    for (const r of line.missing || []) steps.push(`<span class="gm-step miss"><em>${role('결재')}</em>${RANK_WHY[r] || r}을 정하세요</span>`);
    // 한 줄에 — 결재 차례 → 참조자, 덧붙임 말(합의를 뺀 까닭 등)은 줄 끝의 ⓘ 툴팁으로(2026-10-15 사용자 지정: "이건 한줄로 넣어줘").
    const notes = line.notes.join(' · ');
    return `<span class="gm-steps">${steps.join('<span class="gm-arrow" aria-hidden="true">→</span>')}</span>`
      + (line.refs.length ? `<span class="gm-refs"><em>${role('참조')}</em>${escapeHtml(line.refs.join(', '))}</span>` : '')
      + (notes ? `<span class="gm-line-note" tabindex="0" role="note" title="${escapeHtml(notes)}" aria-label="${escapeHtml(notes)}">ⓘ</span>` : '');
  }

  /* ---------------------------------------------------------- 공문 이력 */

  /** 읽어 둔 이력을 다시 읽지 않고 쓰는 시간 — 그 안에 다시 열면 저장소의 것을 보인다(새로고침 단추는 늘 다시 읽는다). */
  const HIST_FRESH_MS = 10 * 60 * 1000;
  /** 한 번에 본문까지 읽는 외부강의등 신고서 수(새 것부터) — 이미 읽은 것은 저장소에 있어 다시 읽지 않는다. */
  const REPORT_MAX = 20;
  const STATE_LABEL = { done: '완료', going: '결재 중', back: '반려', kept: '임시보관' };
  /**
   * 기간 단추 — 3개월(기본)·올해·1y·2y(src/gmlist.js 의 SPANS, 2026-10-12 사용자 지정: "기본 과거 3개월부터 예정인 것까지만 기본적으로 보여주고, 올해·1y·2y
   * 이 정도 과거 히스토리"). 기안일 기준이라 진행 중·예정인 것도 기안했으면 든다.
   */
  const spanTitle = (span, ymd) => ({ '3m': '석 달 전부터 오늘까지 — 진행 중·예정인 것 포함', y0: '올해 1월 1일부터 오늘까지' }[span] || `${spanFrom(span, ymd).slice(0, 4)}년 1월 1일부터 오늘까지`);
  /** 보는 기간의 첫날. */
  const rangeFrom = () => spanFrom(st.hist.span, today());
  const rangeText = () => ({ '3m': '최근 3개월', y0: '올해' }[st.hist.span] || `${rangeFrom().slice(0, 4)}년부터`);
  /** 읽어 오는 첫날 — 고른 기간과 올해 1월 1일 가운데 이른 날. 외부활동 사례비 누계는 올해 외부강의등 신고서가 꼭 있어야 해서 올해는 늘 읽어 둔다. */
  const fetchFrom = () => { const a = rangeFrom(); const b = spanFrom('y0', today()); return a < b ? a : b; };

  const isOutside = () => st.kind === 'outside';
  /** 보는 기간 안의 줄 — 읽어 둔 것이 더 넓어도 고른 기간만 보인다(날짜 없는 줄은 둔다). */
  const inRange = () => { const from = rangeFrom(); return st.hist.rows.filter((r) => !r.date || r.date >= from); };
  /** 이력 칸에 보일 줄 — 보는 기간 안에서 고른 갈래의 것만(src/gmlist.js 의 kindOf), '전체'면 다. */
  const histRows = () => (st.hist.all ? inRange() : inRange().filter((r) => kindOf(r) === st.kind));
  /**
   * 읽어 둔 외부강의등 신고서(목록 줄 + 본문 칸) — 사례비 누계 줄과 새 신고서의 셈하는 칸(autoFill)이 쓴다. 임시보관·반려한 것은 올라가지 않은 신고서라 뺀다.
   */
  const reportsOf = () => st.hist.rows.filter((r) => r.form === OUTSIDE_FORM && st.hist.reports[r.id] && !['kept', 'back'].includes(stateOf(r)))
    .map((r) => ({ ...st.hist.reports[r.id], id: r.id, date: r.date }));
  /**
   * 본문을 (다시) 읽을 외부강의등 신고서 — 아직 안 읽은 것과, 직급·담당 연락처(rank·contactTel — 2026-10-15)를 읽기 전에 저장한 것(새 것부터 REPORT_MAX 건).
   * 새 신고서의 직급·요청인을 거기서 채운다.
   */
  const staleReports = () => st.hist.rows.filter((r) => r.form === OUTSIDE_FORM && !('rank' in (st.hist.reports[r.id] || {}))).slice(0, REPORT_MAX);

  /**
   * eclass 기안함(완료함·상신함·반려함·임시보관함)을 읽어 내가 기안한 공문을 모은다(src/gmlist.js 의 listMine — 2026-10-11 사용자 지정: "출장·근태 이력처럼
   * 공문 이력 … 시스템이 공문을 검색해서 읽어 와야지"). 외부강의등 신고서는 본문도 읽어 사례금·당해 연도 누적 합계를 꺼낸다(새 것부터 REPORT_MAX 건).
   * 읽는 기간은 고른 기간(st.hist.span — 3개월·올해·1y·2y)의 첫날(올해 1월 1일보다 늦으면 올해 1월 1일 — fetchFrom)부터 오늘까지. force 가 아니면 HIST_FRESH_MS 안에
   * 읽은 것이 그 기간을 덮으면 목록은 그대로 쓴다(좁히는 것은 걸러 보일 뿐 다시 읽지 않는다 — 넓힐 때만 다시 읽는다). 그때도 본문을 다시 읽을 신고서(staleReports)가
   * 있으면 그 본문만 읽는다.
   */
  async function loadHist({ force = false } = {}) {
    if (st.hist.busy) return;
    const now = today();
    const from = fetchFrom();
    const fresh = !force && st.hist.at && Date.now() - st.hist.at < HIST_FRESH_MS && st.hist.from && from >= st.hist.from;
    if (fresh && !staleReports().length) return;
    st.hist.busy = true;
    st.hist.tried = true;
    st.hist.error = '';
    st.hist.step = '';
    paintHist();
    paintFeeSum();
    try {
      const got = fresh ? { rows: st.hist.rows, notes: [] }
        : await listMine({ from, to: now, onBox: (box) => { st.hist.step = `${BOXES[box].label} 읽는 중…`; paintHistState(); } });
      // 전자결재 세션이 사용자를 잃으면(포털 로그인은 살아 있어 로그인 화면이 아님) 기안함이 문서 0건으로 뜬다(2026-10-15 실측 — 미결함은 "페이지를 로드중
      // 오류"). 같은 기간에 읽어 둔 문서가 있는데 하나도 안 오면 그것이라 보고 읽어 둔 것을 둔다 — 지우면 사례비 누계와 새 신고서의 당해 연도 누적이 틀린다.
      const lost = !fresh && !got.rows.length && st.hist.rows.some((r) => !r.date || (r.date >= from && r.date <= now));
      if (lost) {
        st.hist.notes = ['전자결재가 문서를 하나도 돌려주지 않았습니다 — 전자결재 세션이 풀렸을 수 있습니다. eclass 에서 전자결재를 한 번 연 뒤 새로고침하세요(읽어 둔 것을 그대로 보입니다).'];
      } else {
        st.hist.rows = got.rows;
        if (!fresh) {
          st.hist.notes = got.notes;
          st.hist.from = from;
          st.hist.to = now;
        }
      }
      const todo = staleReports();
      for (const [i, r] of todo.entries()) {
        st.hist.step = `외부강의등 신고서 읽는 중… ${i + 1}/${todo.length}`;
        paintHistState();
        try {
          st.hist.reports = { ...st.hist.reports, [r.id]: await readOutsideReport(r) };
        } catch (err) {
          st.hist.notes.push(`${r.id} 본문을 읽지 못했습니다 — ${err.message}`);
        }
      }
      // 세션이 풀린 것으로 보이면 읽은 때를 새로 적지 않는다 — 다음에 펴면 다시 읽는다.
      if (!fresh && !lost) st.hist.at = Date.now();
      saveHist();
      logEvent('gongmun', !lost, lost ? `공문 이력 — 전자결재가 0건을 돌려줘 읽어 둔 ${st.hist.rows.length}건을 둠(세션이 풀렸을 수 있음) · ${from}부터`
        : fresh ? `외부강의등 신고서 본문 ${todo.length}건 다시 읽음(직급·담당 연락처)`
          : `공문 이력 읽음 · ${st.hist.rows.length}건 · ${from}부터${got.notes.length ? ` · ${got.notes.join(' / ')}` : ''}`);
    } catch (err) {
      st.hist.error = err.message;
      logEvent('gongmun', false, `공문 이력 읽기 실패 · ${err.message}`);
    } finally {
      st.hist.busy = false;
      st.hist.step = '';
      paintHist();
      // 외부활동 초안이면 읽은 신고서로 셈하는 칸(당해 연도 누적·당월 누적·직급…)을 채우고 남은 것까지 다시 그린다(paintLive 가 사례비 누계도 그린다).
      if (isOutside() && cur()) paintLive();
      else paintFeeSum();
    }
  }

  /** 접힌 줄의 형편 — 읽는 중이면 어느 함을 읽는지, 읽었으면 갈래의 건수와 기간. */
  function paintHistState() {
    const h = st.hist;
    el.histState.textContent = h.busy ? (h.step || '읽는 중…') : h.error ? '읽지 못했습니다' : !h.at ? '펴면 eclass 에서 읽습니다'
      : `${h.all ? '전체' : KINDS[st.kind].label} ${histRows().length}건 · ${rangeText()}`;
  }

  /**
   * 공문 이력 칸 — 근태의 신청 내역처럼 한 건이 카드 하나다(상태 딱지 · 제목 · 양식·기안일, 외부강의등 신고서면 사례금·당해 연도 누적). 누르면 펴져서
   * 본문의 칸(기관·주제·장소·일시·사례금·누적)과 "eclass 에서 열기"가 나온다. 고른 갈래의 것만 보이고 '전체'로 모두 본다.
   */
  function paintHist() {
    const h = st.hist;
    paintHistState();
    const at = h.at ? new Date(h.at) : null;
    el.histRange.textContent = h.at
      ? `기안일 기준 · ${rangeText()} ${inRange().length}건 · ${pad(at.getHours())}:${pad(at.getMinutes())} 읽음`
      : '기안일 기준 · 완료함·상신함·반려함·임시보관함';
    const now = today();
    el.histSpan.innerHTML = SPANS.map((s) => `<button type="button" class="gm-hist-spanbtn${s === h.span ? ' active' : ''}" data-span="${s}" role="radio" aria-checked="${s === h.span}"`
      + ` title="${escapeHtml(spanTitle(s, now))}"${h.busy ? ' disabled' : ''}>${SPAN_LABEL[s]}</button>`).join('');
    el.histAll.setAttribute('aria-pressed', String(h.all));
    el.histAll.classList.toggle('active', h.all);
    el.histRefresh.disabled = h.busy;
    el.histNote.textContent = h.error || h.notes.join(' · ');
    el.histNote.classList.toggle('bad', !!h.error);
    const rows = histRows();
    el.histList.innerHTML = !h.at ? (h.busy ? '<li class="gm-hist-empty">읽는 중…</li>' : '')
      : !rows.length ? `<li class="gm-hist-empty">${h.all ? '이 기간에 기안한 공문이 없습니다.' : `이 기간에 ${KINDS[st.kind].label} 공문이 없습니다 — 전체를 누르면 모든 공문이 보입니다.`}</li>`
        : rows.map(cardHtml).join('');
  }

  function cardHtml(r) {
    const open = st.hist.open === r.id;
    const state = stateOf(r);
    const rep = r.form === OUTSIDE_FORM ? st.hist.reports[r.id] : null;
    const sub = [r.formName, dotDate(r.date) || r.date, rep?.fee != null ? `사례금 ${won(rep.fee)}` : '', rep?.yearTotal != null ? `당해 연도 누적 ${won(rep.yearTotal)}` : ''].filter(Boolean).join(' · ');
    const head = `<button type="button" class="gm-hist-head" aria-expanded="${open}"><span class="gm-hist-row">`
      + `<span class="gm-hist-st" title="${escapeHtml(r.status || '')}">${escapeHtml(r.status || STATE_LABEL[state] || '상태 모름')}</span>`
      + `<span class="gm-hist-sum">${escapeHtml(r.title || '(제목 없음)')}</span></span><span class="gm-hist-sub">${escapeHtml(sub)}</span></button>`;
    if (!open) return `<li class="gm-hist-item st-${state}" data-id="${escapeHtml(r.id)}">${head}</li>`;
    const line = (k, v) => (v ? `<span><em>${k}</em>${escapeHtml(v)}</span>` : '');
    const when = rep ? [rep.from ? dotDate(rep.from) : '', rep.to && rep.to !== rep.from ? `~ ${dotDate(rep.to)}` : '', rep.start ? `${rep.start} ~ ${rep.end}` : '', rep.hours != null ? `${rep.hours}시간` : ''].filter(Boolean).join(' ') : '';
    const more = rep
      ? [line('기관', rep.org), line('주제', rep.subject), line('장소', rep.place), line('일시', when), line('사례금', rep.fee != null ? won(rep.fee) : ''),
        line('당해 연도 누적', rep.yearTotal != null ? won(rep.yearTotal) : ''), line('당월 누적', rep.monthCount != null ? `${rep.monthCount}회` : ''),
        line('교통·숙박·식비', rep.expenses ? won(rep.expenses) : ''), line('비고', rep.note)].filter(Boolean).join('')
      : [line('문서번호', r.id), line('부서', r.dept), line('완료일', r.done ? dotDate(r.done) : '')].filter(Boolean).join('');
    // 구매 품의(연구업무품의서) 줄이면 우측 하단에 '구매의뢰' — 이 줄을 선행 품의로 구매요청서 초안을 만든다(orderFromRow — 2026-10-17 사용자 지정: "우측 하단에 구매의뢰하기 버튼").
    const order = KINDS.order && kindOf(r) === 'purchase'
      ? '<button type="button" class="ghost small" data-act="order" title="이 품의를 eclass 에서 읽어(품목·금액·구매처·사유·견적서 첨부) 구매요청서(총무팀 수신) 초안을 만듭니다 — 선행 품의 읽기 행위(gongmun.prior)">구매의뢰</button>'
      : '';
    return `<li class="gm-hist-item open st-${state}" data-id="${escapeHtml(r.id)}">${head}<div class="gm-hist-more">${more}`
      + `<div class="gm-actions"><button type="button" class="ghost small" data-act="open" title="전자결재 문서 보기 창을 새 탭에 엽니다">eclass 에서 열기</button>${order}</div></div></li>`;
  }

  /** 카드를 누르면 펴고, 'eclass 에서 열기'는 문서 보기 창을 새 탭에 연다. '구매의뢰'(구매 품의 줄)는 그 줄을 선행 품의로 구매의뢰 초안을 만든다. */
  function onHistClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-act="open"], [data-act="order"], .gm-hist-head') : null;
    const li = btn?.closest('[data-id]');
    const row = li && st.hist.rows.find((r) => r.id === li.dataset.id);
    if (!row) return;
    if (btn.dataset.act === 'open') {
      chrome.tabs.create({ url: viewUrl(row) });
      logEvent('gongmun', true, `공문 열기 · ${row.id} · ${row.title}`);
      return;
    }
    if (btn.dataset.act === 'order') {
      orderFromRow(row);
      return;
    }
    st.hist.open = st.hist.open === row.id ? '' : row.id;
    paintHist();
  }

  /** 접힌 칸을 펴면 읽는다(읽어 둔 것이 묵었으면 다시). */
  function onHistToggle() {
    if (el.histBox.open) loadHist();
  }

  /** 기간 단추(3개월·올해·1y·2y) — 고른 기간을 남기고, 읽어 둔 것이 그 기간을 덮지 못하면 다시 읽는다(좁히면 걸러 보이기만). */
  function onHistSpanClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-span]') : null;
    if (!btn || btn.disabled) return;
    const span = btn.dataset.span;
    if (!SPANS.includes(span) || span === st.hist.span) return;
    st.hist.span = span;
    saveHist();
    paintHist();
    loadHist();
  }

  function toggleHistAll() {
    st.hist.all = !st.hist.all;
    paintHist();
  }

  /* ---------------------------------------------------------- 구매의뢰(구매요청서) — 구매 품의와 연동 */

  /**
   * 구매의뢰(구매요청서 — 총무팀 수신) 초안을 구매 품의에서 만든다(src/gongmun.js 의 orderFromPurchase — 2026-10-17 사용자 지정: "그 의뢰서는 구매공문과 연동되어야
   * 하고, 우측 하단에 구매의뢰하기 버튼을 넣던지, 구매할때 같이 작성할 수 있던지"). 구매 초안의 품목·합계·구매처·사유가 옮겨 가고, 읽은 문서(files·parts·cut·source)와
   * 과제도 함께 가 같은 견적서가 첨부된다. 이미 있던 구매의뢰 초안은 덮는다. touched 는 빈 목록 — 셈하는 칸(수요시기·특기사항·계정과목명·첨부자료 안내문구)을 orderAuto 가 새로 채우게.
   * @param {object|null} from 구매 갈래의 작업(st.work.purchase 꼴). 없으면 빈 구매 초안으로(문서번호·제목만 선행 품의 칸에 — 읽은 문서 없음).
   * @param {{doc?: object|null, project?: string}} [opts] doc 은 공문 이력의 구매 품의 줄(문서번호·제목 → 선행 품의 칸), project 는 from 이 없을 때 고를 과제
   */
  function seedOrder(from, { doc = null, project = '' } = {}) {
    const base = from || { draft: blankDraft('purchase', { me: me() }), project };
    st.work.order = {
      draft: orderFromPurchase(base.draft, { me: me(), doc }), notes: [], touched: [], project: base.project || '', title: null, body: null,
      files: base.files || [], text: base.text || '', parts: base.parts || [], cut: base.cut || null,
      source: from ? { ...(base.source || {}) } : { label: '직접 입력', from: '', via: '', summary: '' },
    };
    delete st.blocked.order;
    saveWork();
  }

  /** 구매의뢰 갈래로 간다 — 이미 그 갈래면(공문 이력 '전체'에서 누름) 새 초안으로 다시 그린다. 상태줄에 무엇으로 만들었는지 적는다. */
  function showOrder(msg) {
    if (st.kind === 'order') {
      renderFields();
      paintDraft({ fold: true });
      paintIntake();
      paintHist();
    } else {
      setKind('order');
    }
    setStatus(msg);
  }

  /** 공문 작성 줄의 '구매의뢰 작성'(연동 1 — 구매할 때 같이 작성) — 지금 구매 초안으로. */
  function orderFromHere() {
    const w = cur();
    if (st.kind !== 'purchase' || !w || !KINDS.order) return;
    seedOrder(w, { doc: null });
    logEvent('gongmun', true, `구매의뢰 초안 · 구매 품의 초안에서 · ${w.draft.gist || '(품목 없음)'}`);
    showOrder('구매의뢰서 초안을 구매 품의에서 만들었습니다 — 계정과목·I/O 코드·납품장소를 적고 공문 작성을 누르세요');
  }

  /**
   * 공문 이력 카드의 '구매의뢰'(연동 2 — 우측 하단) — 그 줄(연구업무품의서 구매·구독 품의)을 선행 품의로 구매의뢰 초안을 만든다. 행위 gongmun.prior(actions/spec/gongmun/prior.yaml —
   * 조회라 확인 없음)의 기록으로 가고, 실행기(actions/runners/gongmun.js → src/gmprior.js readPrior)가 eclass 에서 그 품의의 본문(품목·사양·수량·금액·구매처·구매계정·용도·사유)과
   * 첨부(견적서 PDF)를 읽어 구매의뢰 초안·첨부·과제(Job Id·과제명·별명으로 고름)를 돌려준다(2026-10-17 사용자 지정: 문서번호·제목만 옮기던 것을 보고 "다른 것들이 들어가 있지를 않네?" →
   * "이것도 명세서를 만든 다음에 러너로 실행하도록"). 첨부는 원본 첨부(파일 그대로 올림 — 읽기에는 보내지 않음)로 둔다. 못 읽으면(로그인·모양이 다름·네트워크) 문서번호·제목만
   * 선행 품의 칸에 넣고 왜 못 읽었는지 적는다. 활동 로그 한 줄은 디스패처가 남긴다(outcome 이 품목·첨부·과제 수를 적는다).
   */
  async function orderFromRow(row) {
    if (!KINDS.order || st.busy) return;
    const id = 'gongmun.prior';
    let record;
    try {
      ({ record } = actions.build(id, { input: { id: row.id, form: row.form || RESEARCH_FORM, title: row.title || '' }, preset: await presetFor(id) }));
    } catch (err) {
      setStatus(`선행 품의를 읽을 수 없습니다 — ${err instanceof ActionError ? err.problems.join(' · ') : err.message}`, 'error');
      paintJumps(el.status, jumpsOf(err, err instanceof ActionError && actions.has(err.action) ? actions.entry(err.action) : null, JUMPS));
      return;
    }
    st.busy = true;
    setStatus(`선행 품의 ${row.id} 를 eclass 에서 읽는 중…`);
    const head = `선행 품의 읽기 · ${row.id} · ${row.title}`;
    let res = null;
    let why = '';
    try {
      res = await actions.run(record, {
        projects: choices().map((p) => ({ name: p.name, job: p.job || '', alias: p.alias || '', code: p.code || '' })),
        text: head,
        outcome: async (r) => ({ text: `${head} · 품목 ${r.doc?.items ?? 0}건${r.files?.length ? ` · 첨부 ${r.files.length}개` : ''}${r.project ? ` · 과제 ${r.project}` : ''}${r.notes?.length ? ` · ${r.notes.join(' / ')}` : ''}` }),
      });
    } catch (err) {
      why = err.message;
    } finally {
      st.busy = false;
    }
    if (!res) {
      seedOrder(null, { doc: row, project: st.work.purchase?.project || '' });
      showOrder(`선행 품의 ${row.id} 를 읽지 못해(${why}) 문서번호·제목만 넣었습니다 — 견적서를 넣고 품목·합계·계정과목·I/O 코드·납품장소를 적으세요`);
      return;
    }
    // 첨부는 받은 파일 그대로(원본 첨부 — 묶은 PDF 에 들지 않고 파일째 올라간다, 읽기에는 보내지 않는다). 첨부 목록은 견적서로 시작하는 이름은 '견적서', 그 밖은 파일 이름으로.
    const files = (res.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size, dataUrl: `data:${f.type};base64,${toBase64(f.bytes)}`, original: true, attachOnly: true }));
    const attach = [];
    for (const f of files) {
      const label = /^견적/i.test(f.name) ? '견적서' : originalLabel(f.name);
      const g = attach.find((a) => a.label === label);
      if (g) g.files.push(f.name);
      else attach.push({ label, files: [f.name], original: true });
    }
    st.work.order = {
      draft: { ...res.draft, attach: attach.length ? attach : res.draft.attach }, notes: [...(res.notes || [])], touched: [], project: res.project || st.work.purchase?.project || '',
      title: null, body: null, files, text: res.doc?.text || '', parts: [], cut: null,
      source: { label: '선행 품의', from: `${row.id} · ${row.title}${files.length ? ` · ${files.map((f) => f.name).join(', ')}` : ''}`, via: 'eclass', summary: res.doc?.summary || '' },
    };
    delete st.blocked.order;
    saveWork();
    showOrder(`구매의뢰서 초안을 선행 품의 ${row.id}(${row.title})의 본문${files.length ? '과 첨부' : ''}으로 만들었습니다 — 계정과목·I/O 코드·납품장소를 확인하고 공문 작성을 누르세요`);
  }

  /* ---------------------------------------------------------- 에이전트(공문 검색) */

  /** 찾은 것을 다시 읽지 않고 쓰는 시간 — 같은 조건(방향·기간·서버에 보낸 말)이면 그 안에는 저장소의 것을 보인다. 찾기 단추는 늘 다시 읽는다. */
  const SEARCH_FRESH_MS = 10 * 60 * 1000;
  /** 에이전트 갈래가 켜져 있는가 — 비교작성 탭에는 없다. */
  const agentOn = () => st.search.on && !st.compareTab;
  /** 보일 줄 — 읽어 둔 줄 가운데 모든 찾을 말이 제목에 드는 것(src/gmsearch.js 의 filterRows). */
  const searchRows = () => filterRows(st.search.rows, st.search.terms);
  const searchPeriod = () => periodOf(st.search, today());

  function saveSearch() {
    const { on, dir, span, from, to, label, text, keyword, terms, at, read, rows, notes } = st.search;
    later('search', () => chrome.storage.local.set({ [SEARCH_KEY]: { on, dir, span, from, to, label, text, keyword, terms, at, read, rows, notes } }));
  }

  /** 갈래 줄과 검색 카드만 남긴다(sidepanel.css 의 .gongmun.agent) — 작성 쪽의 칸은 그대로 두고 가리기만 한다. */
  function paintMode() {
    const on = agentOn();
    el.root.classList.toggle('agent', on);
    el.search.hidden = !on;
  }

  /** 에이전트 갈래로(2026-10-12 사용자 지정) — 처음이거나 읽어 둔 것이 묵었으면 찾는다(같은 조건을 SEARCH_FRESH_MS 안에 읽었으면 그대로). */
  function enterAgent() {
    if (st.compareTab) return;
    if (!st.search.on) {
      st.search.on = true;
      saveSearch();
    }
    setStatus('');
    paintKinds();
    paintMode();
    paintSearch();
    runSearch();
  }

  function leaveAgent() {
    if (!st.search.on) return;
    st.search.on = false;
    saveSearch();
    paintKinds();
    paintMode();
  }

  /**
   * 공문을 찾는다(2026-10-12 사용자 지정: "에이전트 … 공문검색 … 받은공문, 보낸 공문"). 말(text)이 있으면 방향·기간·찾을 말로 풀어(src/gmsearch.js 의 parseQuery)
   * 고른 것에 얹고, 받은 공문이면 결재함 다섯 함, 보낸 공문이면 기안함 네 함을 제목 검색 포스트백으로 읽는다(src/gmlist.js 의 listBoxes — 서버에는 가장 긴 말
   * 하나, 모든 말은 제목에서 거른다). force 가 아니면 같은 조건을 SEARCH_FRESH_MS 안에 읽었으면 다시 읽지 않는다.
   */
  async function runSearch({ force = false, text = null } = {}) {
    const s = st.search;
    if (s.busy) return;
    const now = today();
    if (text != null) {
      const q = parseQuery(text, { today: now, dir: s.dir, span: s.span, from: s.from, to: s.to, label: s.label });
      Object.assign(s, { text, dir: q.dir, span: q.span, from: q.from, to: q.to, label: q.label, keyword: q.keyword, terms: q.terms, open: '' });
      saveSearch();
    }
    const p = searchPeriod();
    const want = { dir: s.dir, from: p.from, to: p.to, keyword: s.keyword };
    if (!force && s.at && Date.now() - s.at < SEARCH_FRESH_MS && sameRead(s.read, want)) {
      paintSearch();
      return;
    }
    s.busy = true;
    s.error = '';
    s.step = '';
    paintSearch();
    try {
      const got = await listBoxes({ boxes: DIR_BOXES[s.dir], from: p.from, to: p.to, keyword: s.keyword, onBox: (box) => { s.step = `${BOXES[box].label} 읽는 중…`; paintSearchState(); } });
      s.rows = got.rows;
      s.notes = got.notes;
      s.read = want;
      s.at = Date.now();
      saveSearch();
      logEvent('gongmun', true, `공문 검색 · ${DIR_LABEL[s.dir]} · ${p.label}${s.terms.length ? ` · ${s.terms.join(' ')}` : ''} · ${searchRows().length}건${got.notes.length ? ` · ${got.notes.join(' / ')}` : ''}`);
    } catch (err) {
      s.error = err.message;
      logEvent('gongmun', false, `공문 검색 실패 · ${err.message}`);
    } finally {
      s.busy = false;
      s.step = '';
      paintSearch();
    }
  }

  /** 상태 줄 — 읽는 중이면 어느 함을 읽는지, 읽었으면 방향·기간·찾을 말·건수·읽은 시각. */
  function paintSearchState() {
    const s = st.search;
    const p = searchPeriod();
    const words = s.terms.length ? ` · ${s.terms.map((t) => `'${t}'`).join(' ')}` : '';
    const at = s.at ? new Date(s.at) : null;
    el.searchState.textContent = s.busy ? (s.step || '읽는 중…') : !s.at ? `${DIR_LABEL[s.dir]} · ${p.label}${words}`
      : `${DIR_LABEL[s.dir]} · ${p.label}${words} · ${searchRows().length}건 · ${pad(at.getHours())}:${pad(at.getMinutes())} 읽음`;
  }

  /** 검색 카드 — 받은·보낸, 기간(말로 적은 기간이면 그 말이 단추 자리에 선다), 상태 줄, 못 읽은 함, 찾은 공문 카드(공문 이력과 같은 꼴). */
  function paintSearch() {
    const s = st.search;
    const now = today();
    el.searchDir.innerHTML = DIRS.map((d) => `<button type="button" class="gm-hist-spanbtn${d === s.dir ? ' active' : ''}" data-dir="${d}" role="radio" aria-checked="${d === s.dir}"`
      + ` title="${escapeHtml(DIR_TITLE[d])}"${s.busy ? ' disabled' : ''}>${DIR_LABEL[d]}</button>`).join('');
    el.searchSpan.innerHTML = SPANS.map((sp) => `<button type="button" class="gm-hist-spanbtn${sp === s.span ? ' active' : ''}" data-span="${sp}" role="radio" aria-checked="${sp === s.span}"`
      + ` title="${escapeHtml(spanTitle(sp, now))}"${s.busy ? ' disabled' : ''}>${SPAN_LABEL[sp]}</button>`).join('')
      + (s.span === CUSTOM ? `<span class="gm-hist-spanbtn active" role="radio" aria-checked="true" title="말로 적은 기간 — ${escapeHtml(`${s.from} ~ ${s.to}`)}">${escapeHtml(searchPeriod().label)}</span>` : '');
    el.searchGo.disabled = s.busy;
    paintSearchState();
    el.searchNote.textContent = s.error || s.notes.join(' · ');
    el.searchNote.classList.toggle('bad', !!s.error);
    const rows = searchRows();
    const p = searchPeriod();
    el.searchList.innerHTML = !s.at ? (s.busy ? '<li class="gm-hist-empty">읽는 중…</li>' : '')
      : !rows.length ? `<li class="gm-hist-empty">${escapeHtml(p.label)}에 ${s.terms.length ? `'${escapeHtml(s.terms.join(' '))}' 이 든 ` : ''}${DIR_LABEL[s.dir]}이 없습니다.</li>`
        : rows.map(searchCardHtml).join('');
  }

  /** 찾은 공문 한 건 — 상태 딱지 · 제목, 아래에 함·양식·기안자(받은 공문)·기안일. 누르면 문서번호·기안자·부서·기안일·완료일과 'eclass 에서 열기'. */
  function searchCardHtml(r) {
    const open = st.search.open === r.id;
    const state = stateOf(r);
    const sub = [BOXES[r.box]?.label, r.formName, st.search.dir === 'in' ? r.name : '', dotDate(r.date) || r.date].filter(Boolean).join(' · ');
    const head = `<button type="button" class="gm-hist-head" aria-expanded="${open}"><span class="gm-hist-row">`
      + `<span class="gm-hist-st" title="${escapeHtml(r.status || '')}">${escapeHtml(r.status || STATE_LABEL[state] || '상태 모름')}</span>`
      + `<span class="gm-hist-sum">${escapeHtml(r.title || '(제목 없음)')}</span></span><span class="gm-hist-sub">${escapeHtml(sub)}</span></button>`;
    if (!open) return `<li class="gm-hist-item st-${state}" data-id="${escapeHtml(r.id)}">${head}</li>`;
    const line = (k, v) => (v ? `<span><em>${k}</em>${escapeHtml(v)}</span>` : '');
    const more = [line('문서번호', r.id), line('기안자', r.name), line('부서', r.dept), line('기안일', r.date ? dotDate(r.date) : ''), line('완료일', r.done ? dotDate(r.done) : '')].filter(Boolean).join('');
    return `<li class="gm-hist-item open st-${state}" data-id="${escapeHtml(r.id)}">${head}<div class="gm-hist-more">${more}`
      + '<div class="gm-actions"><button type="button" class="ghost small" data-act="open" title="전자결재 문서 보기 창을 새 탭에 엽니다">eclass 에서 열기</button></div></div></li>';
  }

  function onSearchGo() {
    runSearch({ force: true, text: el.searchText.value.trim() });
  }

  /** 말 칸의 Enter — 한글을 조합하는 중(isComposing)이면 아니다. */
  function onSearchKey(e) {
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
    e.preventDefault();
    onSearchGo();
  }

  function onSearchDirClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-dir]') : null;
    if (!btn || btn.disabled) return;
    const dir = btn.dataset.dir;
    if (!DIRS.includes(dir) || dir === st.search.dir) return;
    Object.assign(st.search, { dir, open: '' });
    saveSearch();
    runSearch();
  }

  /** 기간 단추 — 말로 적은 기간(custom)은 버리고 그 단추의 기간으로. */
  function onSearchSpanClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-span]') : null;
    if (!btn || btn.disabled) return;
    const span = btn.dataset.span;
    if (!SPANS.includes(span) || span === st.search.span) return;
    Object.assign(st.search, { span, from: '', to: '', label: '', open: '' });
    saveSearch();
    runSearch();
  }

  /** 카드를 누르면 펴고, 'eclass 에서 열기'는 문서 보기 창을 새 탭에 연다(공문 이력과 같다). */
  function onSearchListClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-act="open"], .gm-hist-head') : null;
    const li = btn?.closest('[data-id]');
    const row = li && st.search.rows.find((r) => r.id === li.dataset.id);
    if (!row) return;
    if (btn.dataset.act === 'open') {
      chrome.tabs.create({ url: viewUrl(row) });
      logEvent('gongmun', true, `공문 열기 · ${row.id} · ${row.title}`);
      return;
    }
    st.search.open = st.search.open === row.id ? '' : row.id;
    paintSearch();
  }

  /**
   * 작성 내용 탭의 사례비 누계 줄(외부활동) — 지금까지 받은 금액은 eclass 에서 읽은 올해 외부강의등 신고서 가운데 가장 늦은 것의 "당해 연도 사례금 누적 합계"
   * (src/gmlist.js 의 outsideSummary, 2026-10-11 사용자 지정: "마지막 신청일 때 지금까지 받은 금액이 있고 추가로 받는 금액 … 합계를 여기서"). 거기에 이번 사례비
   * (읽은 칸)를 더한 것이 합계다. 이력을 아직 읽지 않았으면 여기서 한 번 읽는다(tried).
   */
  function paintFeeSum() {
    const w = cur();
    const show = !!w && isOutside();
    el.feeSum.classList.toggle('hidden', !show);
    if (!show) {
      el.feeSum.innerHTML = '';
      return;
    }
    const h = st.hist;
    // 이력을 아직 안 읽었거나, 읽어 둔 신고서가 직급·담당 연락처를 읽기 전 것이면 한 번 읽는다(새 신고서의 셈하는 칸이 거기서 온다).
    if (!h.busy && !h.tried && (!h.at || staleReports().length)) loadHist();
    const s = outsideSummary(reportsOf(), { fee: moneyOf(w.draft.fee), today: today() });
    const bit = (label, value, note = '', title = '') => `<span${title ? ` title="${escapeHtml(title)}"` : ''}>${label} <b>${escapeHtml(value)}</b>${note ? `<small>${escapeHtml(note)}</small>` : ''}</span>`;
    // 기호(+·=)는 칩 안에 둔다 — 좁은 패널에서 줄이 바뀌어도 기호만 줄 끝에 남지 않게.
    const op = (sign) => `<em class="gm-fee-op" aria-hidden="true">${sign}</em> `;
    const mine = (sign) => (s.fee != null ? bit(`${sign}이번`, won(s.fee), '', '읽은 칸의 사례비') : `<span class="gm-miss">${sign}이번 사례비 없음</span>`);
    const parts = ['<strong>사례비 누계</strong>'];
    if (!h.at) {
      parts.push(`<span class="gm-miss">${h.busy ? `공문 이력을 읽는 중입니다${h.step ? ` — ${escapeHtml(h.step)}` : '…'}` : h.error ? `공문 이력을 읽지 못했습니다 — ${escapeHtml(h.error)}` : '공문 이력을 아직 읽지 않았습니다'}</span>`, mine(''));
    } else {
      const note = s.basis ? `${dotDate(s.basis.date)} 외부강의등 신고서의 당해 연도 누적` : `${s.year}년 외부강의등 신고서 없음`;
      parts.push(bit('지금까지', won(s.sofar), note, '올해 올린 외부강의등 신고서 가운데 가장 늦은 것의 "당해 연도 사례금 누적 합계"'), mine(op('+')),
        bit(`${op('=')}합계`, won(s.total), '', '다음 신고서의 당해 연도 사례금 누적 합계에 적을 값'));
    }
    parts.push(`<button type="button" class="ghost small" data-act="ledger" title="공문 이력 — eclass 기안함에서 읽은 내 공문">${h.busy ? '읽는 중…' : '이력'}</button>`);
    // 신고서의 '3회 초과시 사전 신고 완료' 칸은 작성기가 고르지 않는다 — 넘었으면 사람이 고르라고 적는다.
    const nth = moneyOf(w.draft.monthCount);
    if (nth > 3) parts.push(`<span class="gm-note">당월 ${nth}회째 — 3회를 넘으면 사전 신고를 마치고 창에서 '3회 초과시 사전 신고 완료' 를 고르세요</span>`);
    el.feeSum.innerHTML = parts.join('');
  }

  /** 사례비 누계 줄의 '이력' — 공문 이력 칸을 펴고 거기로 간다(펴면 읽는다). */
  function onFeeSumClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-act="ledger"]') : null;
    if (!btn) return;
    el.histBox.open = true;
    loadHist();
    el.histBox.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------------------------------------------------- 공문 */

  function paintDoc(blocked = false) {
    const w = cur();
    const show = !!w && !blocked;
    el.doc.classList.toggle('hidden', !show);
    paintView();
    if (!show) return;
    const tpl = tplOf();
    const c = compose(st.kind, w.draft, ctxOf(w), tpl);
    el.formName.textContent = formLabel(tpl.form);
    // 칸이 정해진 폼(외부강의등 신고서)은 본문이 없고 칸마다 넣는다 — 본문 칸은 넣을 칸의 미리보기라 고칠 수 없다(고치면 양식에 들어가지 않으니). 말은 폼의 이름으로(신고서만이 아니다).
    const preview = fieldForm(tpl.form);
    el.body.readOnly = preview;
    const bodyLabel = el.doc.querySelector('label[for="gmBody"]');
    if (bodyLabel) {
      bodyLabel.textContent = preview ? `${formLabel(tpl.form)}에 넣을 칸 (미리보기)` : '본문';
      bodyLabel.title = preview ? '칸마다 양식에 넣습니다 — 고치려면 작성 내용·읽은 내용 탭의 칸에서' : '';
    }
    if (document.activeElement !== el.title) el.title.value = w.title ?? c.title;
    if (document.activeElement !== el.body) el.body.value = preview ? c.body : w.body ?? c.body;
    el.edited.classList.toggle('hidden', w.title == null && (preview || w.body == null));
    const groups = pdfGroups(w);
    el.savePdf.classList.toggle('hidden', !groups.length);
    el.savePdf.textContent = groups.length > 1 ? `첨부 PDF ${groups.length}개 저장 (${groups.map((g) => g.label).join(' · ')})`
      : `${groups[0]?.label || KINDS[st.kind].doc} PDF 저장 (첨부용)`;
    el.steps.innerHTML = stepsHtml(w, tpl);
    paintSet(w);
  }

  /* ---------------------------------------------------------- 문서설정·위임전결 */

  const opt = (value, label, on) => `<option value="${escapeHtml(value)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  /** 문서설정·위임전결 칸 — 레시피의 기본값(검색 키워드는 고른 과제의 별명, 출장·외부활동은 갈래 이름)에 이 공문에서 바꾼 것(w.setting·w.rank)을 얹어 보인다. */
  function paintSet(w) {
    const s = docSettingOf(st.kind, st.preset, w.setting, { project: projectOf(w) });
    const d = delegationOf(st.kind, w.draft, { rank: w.rank || '' });
    el.rank.innerHTML = opt('', `규정대로 — ${d?.auto || RANKS[0]} 전결`, !w.rank) + RANKS.map((r) => opt(r, `${r} 전결`, w.rank === r)).join('');
    el.rankWhy.textContent = d ? `${d.label} · ${d.basis || '금액 무관'} → ${d.auto} 전결${d.unknown ? '(금액을 몰라 맨 아래 구간)' : ''} — ${d.source}` : '';
    el.retention.innerHTML = Object.entries(SETTING_OPTIONS.retention).map(([v, t]) => opt(v, t, v === s.retention)).join('');
    el.receiver.innerHTML = SETTING_OPTIONS.receiver.map((r) => opt(r, r, r === s.receiver)).join('');
    el.scope.innerHTML = Object.keys(SETTING_OPTIONS.scope).map((k) => opt(k, k, k === s.scope)).join('');
    if (document.activeElement !== el.docNoOne) el.docNoOne.value = s.docNo;
    el.docNoOne.placeholder = '공문 설정의 문서번호 부서 코드';
    el.docNoOne.title = s.docNoFrom ? `${s.docNoFrom}에서` : '';
    el.emergency.checked = s.emergency;
    el.approvingOpen.checked = s.approvingOpen;
    el.drm.checked = s.drm;
    if (document.activeElement !== el.tag) el.tag.value = s.tag;
    el.setState.textContent = `전결 ${d?.rank || RANKS[0]} · ${settingText(s)}`;
    el.setReset.disabled = !Object.keys(w.setting || {}).length && !w.rank;
    paintLineSet(w);
  }

  /**
   * 문서설정의 결재선 줄 — 이 공문에 설 과제 책임자(합의자)·참조자를 보이기만 한다. 적는 곳은 R&D 탭이다 — 책임자는 과제 정보, 참조자는 '참여인력'(2026-10-17 까지는
   * '참여연구자 및 행정지원')에서 참조로 고른 사람(그 과제의 공문마다 같은 사람 — 2026-10-16 사용자 지정: "참여연구자 및 행정 지원.. 으로 해서 행정지원 사람 넣을 수
   * 있도록", 참조는 "과제 마다 다름. 구매교육출장 이런거랑 달리")과 계획서 YAML 의 공문.참조자. 줄 끝 단추가 R&D 탭으로 간다.
   * 과제 책임자가 기안자 본인이면 합의는 넣지 않는다(approvalLine — 같은 날 "같으면 입력은 하지 않도록"). 과제를 고르지 않는 갈래(외부활동)에서는 숨는다.
   */
  function paintLineSet(w) {
    const on = usesProject();
    el.lineSet.classList.toggle('hidden', !on);
    if (!on) return;
    const p = projectOf(w);
    const lead = String(p?.lead || '').trim();
    const refs = p ? projectRefs(p, st.kind) : [];
    const self = !!lead && lead.replace(/\s/g, '') === String(me() || '').replace(/\s/g, '');
    const out = (node, value, empty) => {
      node.textContent = value || empty;
      node.classList.toggle('empty', !value);
    };
    out(el.lead, lead && (self ? `${lead} (본인 — 합의 없음)` : lead), p ? '없음 — 합의자가 빕니다' : '과제를 고르세요');
    out(el.refs, refs.join(', '), p ? '없음' : '과제를 고르세요');
    el.lineGo.hidden = !p?.rnd;
    el.lineWhy.textContent = !p ? '' : p.rnd ? `${p.alias || p.name} 과제의 공문마다 같은 사람이 들어갑니다 — 책임자는 과제 정보, 참조자는 참여인력에서 고칩니다.`
      : '공문 설정의 과제입니다 — 책임자는 공문 설정의 과제 줄에서 고치고, 참조자는 R&D 탭에 과제를 두어야 적을 수 있습니다.';
  }

  /** 문서설정·위임전결을 고쳤을 때 — 레시피 기본값과 다른 것만 이 공문에 남긴다. */
  function onSetInput() {
    const w = cur();
    if (!w) return;
    const base = docSettingOf(st.kind, st.preset, {}, { project: projectOf(w) });
    const now = settingPatch({
      retention: el.retention.value, docNo: el.docNoOne.value, receiver: el.receiver.value, scope: el.scope.value,
      emergency: el.emergency.checked, approvingOpen: el.approvingOpen.checked, drm: el.drm.checked, tag: el.tag.value,
    });
    w.setting = Object.fromEntries(Object.entries(now).filter(([k, v]) => v !== base[k]));
    w.rank = RANKS.includes(el.rank.value) ? el.rank.value : '';
    saveWork();
    paintLive();
  }

  function resetSet() {
    const w = cur();
    if (!w) return;
    w.setting = {};
    w.rank = '';
    saveWork();
    paintLive();
  }

  /** '공문 작성' 이 넣는 것(첨부까지)과, 그 뒤 창에서 사람이 할 일(임시저장·상신). */
  function stepsHtml(w, tpl) {
    const p = projectOf(w);
    const k = KINDS[st.kind];
    const known = FORMS.some((f) => f.id === tpl.form);
    // 첨부는 본문의 ※ 첨부와 같은 문서들이다(교육 안내문·교육 내용 …) — 읽은 것이 없으면 갈래의 기본 문서.
    const groups = pdfGroups(w);
    const docs = groups.length ? groups.map((g) => g.label).join(' · ') : [...new Set((w.draft.attach || []).map((a) => a.label).filter(Boolean))].join(' · ') || k.doc;
    // 칸이 정해진 폼(외부강의등 신고서)은 본문 대신 그 폼의 칸(요청인·주제·장소·일시·사례금·누적 …)을 넣는다 — 말은 폼의 이름으로.
    const what = fieldForm(tpl.form) ? `${formLabel(tpl.form)} 칸${hasRows(tpl.form) ? '·표' : ''}` : '본문';
    const list = [
      known ? `<b>공문 작성</b> ${escapeHtml(formLabel(tpl.form))} — ${p ? `과제 ${escapeHtml(p.alias || p.name)} · ` : ''}제목 · ${what} · 문서설정 · 결재선${groups.length ? ' · 첨부를' : '을'} 창에 넣습니다`
        : `<b>새 공문 열기</b> ${escapeHtml(formLabel(tpl.form))} — 칸 지도가 없는 양식이라 창만 엽니다`,
      `<b>결재선</b> ${escapeHtml(lineText(approvalLine(lineCtx(w))))}`,
      ...(docs ? [`<b>첨부</b> ${escapeHtml(docs)}${groups.length ? ' — 읽은 문서를 문서마다 PDF 로 묶어 창의 파일첨부에 올립니다' : ' — 넣은 문서가 없어 창의 파일첨부로 넣습니다'}`] : []),
      '<b>임시저장</b> 공문 보기로 창을 열어 확인한 뒤 상신',
    ];
    return list.map((x) => `<li>${x}</li>`).join('');
  }

  function onDocInput(e) {
    const w = cur();
    if (!w) return;
    if (e.target === el.title) w.title = el.title.value;
    else w.body = el.body.value;
    saveWork();
    el.edited.classList.remove('hidden');
  }

  /** 직접 고친 제목·본문을 버리고 양식으로 다시 만든다. */
  function regen() {
    const w = cur();
    if (!w) return;
    w.title = null;
    w.body = null;
    saveWork();
    paintLive();
  }

  /** 작성 기록 한 줄 — 됐다 · 안 됐다 · 건너뜀(첨부할 파일이 없음) · 하는 중. */
  const stepLi = (x) => `<li class="${x.ok === true ? 'ok' : x.ok === false ? 'bad' : x.ok === 'skip' ? 'skip' : 'busy'}"><b>${escapeHtml(x.label)}</b>${x.detail ? ` ${escapeHtml(x.detail)}` : ''}</li>`;

  /**
   * 첨부할 PDF — 첨부 목록의 문서마다 하나(src/pdf.js 의 buildPdf). 공문 작성이 창의 파일첨부에 올리고, 첨부 PDF 저장이 내려받는다.
   * kind·title 은 부른 쪽이 그때 본 것(공문 작성은 누른 순간의 갈래·제목 — 묶는 동안 갈래를 바꿔도 따라가지 않는다). 안 주면 지금 화면의 것.
   */
  async function attachPdfs(w, { kind = st.kind, title = el.title.value } = {}) {
    const groups = pdfGroups(w);
    if (!groups.length) return [];
    const { buildPdf } = await import('./src/pdf.js');
    const out = [];
    for (const g of groups) {
      const { bytes } = await buildPdf(g.files, { title: `${title} — ${g.label}` });
      out.push({ label: g.label, name: attachName(kind, w.draft, today(), g.label), bytes });
    }
    return out;
  }

  /** 바이트를 base64 로 — 페이지 함수에 넘기는 인자는 JSON 이라 글로 보낸다(32K 씩 — 인자 펼치기 한도). */
  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  /**
   * 공문 작성·공문 보기 단추와 그 아래 상태 줄 — 쓰기 전 · 쓰는 중(지금 단계) · 다 씀(안 된 단계가 있으면 그것) · 못 씀 · 창이 닫힘.
   * 공문 보기는 창이 열리면 눌 수 있고, 다 쓰면 으뜸 단추가 된다(다음 할 일이 창에서 임시저장·상신이라서).
   */
  function paintWrite(now = '') {
    const busy = st.writing;
    const has = st.lastTab != null;
    const done = busy ? null : st.writeDone;
    const next = !!(done && has && !done.closed && !done.before);   // 쓰기 전에 막힌 것(before)은 고치고 다시 누르는 것이 다음 일 — 공문 작성이 으뜸 단추로 남는다.
    el.write.disabled = busy;
    el.write.textContent = busy ? '공문 작성 중…' : '공문 작성';
    el.write.classList.toggle('primary', !next);
    el.write.classList.toggle('ghost', next);
    el.showDoc.disabled = !has;
    el.showDoc.classList.toggle('primary', next);
    el.showDoc.classList.toggle('ghost', !next);
    el.showDoc.title = has ? '작성한 공문 창을 앞으로 가져옵니다' : '공문 작성이 창을 열면 누를 수 있습니다';
    let text = '';
    let cls = '';
    if (busy) [text, cls] = [`작성 중 — ${now || '뒤 탭에서 쓰고 있습니다'}`, 'busy'];
    else if (!done) [text, cls] = ['', ''];
    else if (done.closed) [text, cls] = ['공문 창이 닫혔습니다 — 다시 작성하세요', 'bad'];
    // 쓰기 전에 막힌 것(before — writeFail)은 접두 없이 까닭 그대로, 쓰다가 실패한 것은 "작성 실패 — 까닭".
    else if (done.why) [text, cls] = [done.before ? done.why : `작성 실패 — ${done.why}`, 'bad'];
    else if (done.ok) [text, cls] = [`작성 완료${done.docId ? ` — 문서 ${done.docId}` : ''} · 공문 보기로 창을 열어 임시저장 뒤 상신하세요`, 'ok'];
    else [text, cls] = [`작성 끝 — 안 된 것: ${done.bad.join(' · ')} · 공문 보기로 창을 열어 확인하세요`, 'bad'];
    el.writeState.className = `gm-write-state${cls ? ` ${cls}` : ''}${text ? '' : ' hidden'}`;
    // 글이 같으면 다시 쓰지 않는다 — writeFail 이 글 뒤에 세운 빈 곳으로 가는 단추(.jumps)가 같은 상태의 다시 그리기에 걷히지 않게. 글이 바뀌면 단추도 같이 사라진다.
    if (el.writeState.firstChild?.nodeValue !== text) el.writeState.textContent = text;
  }

  /**
   * 쓰기 전에 막힌 까닭(빈 제목 · 사이드패널에만 있는 첨부 · 관문이 막은 빈 곳) — 탭 위 상태줄(gmStatus)에만 적으면 공문 작성 단추 근처를 보는 사람은 막힌 줄 모른다.
   * 단추 아래 상태 줄(gmWriteState)에도 같은 까닭을 붉게 적고, 빈 곳으로 가는 단추(src/jump.js)가 있으면 둘 다의 끝에 세운다(2026-10-23).
   * @returns {undefined} writeDoc 이 그대로 돌려주기 좋게
   */
  function writeFail(why, jumps = []) {
    st.writing = false;
    st.writeDone = { ok: false, docId: '', bad: [], why, before: true };
    el.writeLog.classList.add('hidden');
    paintWrite();
    setStatus(why, 'error');
    paintJumps(el.status, jumps);
    paintJumps(el.writeState, jumps);
    return undefined;
  }

  /**
   * 새 공문 창을 뒤 탭으로 열고 과제·제목·차수·본문·문서설정·결재선·첨부를 넣는다(src/gmwrite.js — 2026-10-08 사용자 지정 "공문작성은 백그라운드에서").
   * 패널은 그대로 두고 작성 기록과 상태 줄만 바뀌며, 창이 열리면 오른쪽 '공문 보기'로 그 탭을 앞으로 가져온다. 임시저장·상신은 창에서 사람이 한다.
   * 첨부는 읽은 문서를 첨부 목록의 문서마다 PDF 로 묶어(첨부 PDF 저장과 같은 파일) 창의 파일첨부에 올린다.
   * 쓰기는 행위 gongmun.<갈래>(actions/spec/gongmun)의 기록으로 간다 — 제목·본문·초안·양식·전결권자·문서설정·첨부 이름이 관문을 지나 기록이 되고(바이트는 ctx.files),
   * 사전설정(내 이름·오늘·공문 설정·고른 과제)은 명세의 from 대로 채운다. 이 단추가 확인(confirmed: record.hash)이다. 실행기(actions/runners/gongmun.js)가
   * writePlan → writeGongmun 을 부르고, 활동 로그 한 줄은 디스패처가 남긴다(outcome 이 최종 문구를 정한다).
   */
  async function writeDoc() {
    const w = cur();
    if (!w || st.writing) return undefined;
    // 누른 순간의 것을 잡아 둔다 — 첨부 PDF 를 묶는 동안(await) 갈래·과제·양식을 바꿔도 기록은 누를 때 보던 공문이다(2026-10-17 Codex 검토: 전에는 st.kind·el.title 을
    // 나중에 읽어 구매 초안에 교육 행위 ID·양식이 섞일 수 있었다). 초안(w)은 그 갈래의 것이라 그대로다.
    const kind = st.kind;
    const title = String(el.title.value ?? '');
    const body = String(el.body.value ?? '');
    const form = tplOf().form;
    const p = projectOf(w);
    if (!title.trim()) return writeFail('제목이 비어 있습니다 — 공문 칸의 제목을 적어 주세요.');
    // 비교작성 탭은 읽은 파일의 바이트를 들고 있지 않다(저장소에는 이름만 — 사이드패널이 든다). 읽은 문서가 있는 초안을 여기서 쓰면 첨부가 조용히 빠지므로 사이드패널로 보낸다.
    if (st.compareTab) {
      const have = new Set([...attachFiles(w).map((f) => f.name), ...originalFiles(w).map((f) => f.name)]);
      const missing = (w.draft.attach || []).flatMap((a) => a.files || []).filter((n) => !have.has(n));
      if (missing.length) return writeFail(`첨부할 문서 ${missing.length}개는 사이드패널에만 있습니다 — 사이드패널의 공문 작성을 누르면 첨부까지 넣습니다.`);
    }
    st.writing = true;
    st.lastTab = null;
    st.writeDone = null;
    paintWrite('첨부 PDF 를 만드는 중…');
    el.writeLog.classList.remove('hidden');
    el.writeLog.innerHTML = '';
    const shown = new Map();
    const paintStep = (x) => {
      shown.set(x.key, x);
      el.writeLog.innerHTML = [...shown.values()].map(stepLi).join('');
      if (x.ok === null) paintWrite(`${x.label}${x.detail ? ` · ${x.detail}` : ''}`);
    };
    setStatus('뒤 탭에서 공문을 쓰는 중입니다 — 다른 일을 하셔도 됩니다.');
    // 첨부 — 못 묶으면(그림이 깨짐 등) 첨부 없이 쓰고 그렇다고 말한다. 기록에는 파일 이름과 무엇의 문서인지(묶은 PDF 는 첨부 목록의 문서 이름)만 적는다.
    let files = [];
    let attach = [];
    // 못 묶은 첨부는 끝까지 기억해 최종 상태 줄·활동 로그에도 적는다 — 본문의 ※ 첨부는 "견적서 1부" 인데 실제로는 안 올라간 것을 정상 완료처럼 보이지 않게(2026-10-17 Codex 검토).
    let pdfFail = '';
    try {
      const pdfs = await attachPdfs(w, { kind, title });
      files = pdfs.map((p) => ({ name: p.name, type: 'application/pdf', base64: toBase64(p.bytes) }));
      attach = pdfs.map((p) => ({ name: p.name, kind: String(p.label || '').slice(0, 40) }));
    } catch (err) {
      pdfFail = err.message;
      setStatus(`첨부 PDF 를 만들지 못해 첨부 없이 씁니다 — ${err.message}`, 'error');
    }
    // 원본 첨부(메일 첨부 등)는 묶은 PDF 뒤에 파일 그대로(기록에는 original) — 창의 파일첨부는 다섯 칸이라 넘치는 것은 빼고 그렇다고 말한다.
    const originals = originalFiles(w);
    const over = Math.max(files.length + originals.length - ATTACH_SLOTS, 0);
    files = [...files, ...originals].slice(0, ATTACH_SLOTS);
    attach = [...attach, ...originals.map((f) => ({ name: f.name, kind: 'original' }))].slice(0, ATTACH_SLOTS);
    const left = (over ? ` · 첨부 칸(${ATTACH_SLOTS}개)이 모자라 ${over}개는 넣지 못했습니다 — 창의 파일첨부에서 바꿔 넣으세요` : '')
      + (pdfFail ? ` · 첨부 PDF 를 만들지 못해 읽은 문서는 넣지 않았습니다(${pdfFail}) — 창의 파일첨부로 넣으세요` : '');
    // 기록 — 행위 gongmun.<갈래> 의 관문(실행 모드)을 지나 짓는다. 어긋나면(제목이 99자를 넘음·초안 칸이 틀림·공문 설정이 없음 …) 상태줄에 적고 멈춘다.
    const id = `gongmun.${kind}`;
    // 합의자(과제 책임자)·참조자 — 문서설정의 두 칸이 보인 그대로(고른 과제에 과제마다 적은 것을 얹은 것). 과제를 고르지 않는 갈래(외부활동)에는 없는 칸이다.
    const line = usesProject(kind) ? { lead: String(p?.lead || '').trim() || null, refs: p ? projectRefs(p, kind) : [] } : {};
    let record;
    try {
      ({ record } = actions.build(id, {
        input: { title, body, draft: w.draft, form, rank: w.rank || null, setting: w.setting || {}, ...line, attach },
        preset: await presetFor(id, { project: p }),
      }));
    } catch (err) {
      // 어디가 비었는지 아는 것(관문의 missing)은 그 자리로 가는 단추를 두 상태 줄(탭 위 · 단추 아래)의 끝에 세운다 — 내 이름·공문 설정·초안의 칸.
      return writeFail(`공문을 쓸 수 없습니다 — ${err instanceof ActionError ? err.problems.join(' · ') : err.message}`,
        jumpsOf(err, err instanceof ActionError && actions.has(err.action) ? actions.entry(err.action) : null, JUMPS));
    }
    const head = `공문 작성 · ${KINDS[kind].title} · ${record.input.title}`;
    try {
      const res = await actions.run(record, {
        confirmed: record.hash, files, onStep: paintStep, onTab: (tabId) => { st.lastTab = tabId; paintWrite('새 공문 창을 여는 중…'); },
        text: head,
        // 활동 로그의 최종 문구 — 문서 ID·첨부 수·못 묶은 첨부·안 된 단계까지(디스패처가 이 한 줄을 남긴다).
        outcome: async (r) => {
          const bad = r.steps.filter((x) => x.ok === false);
          return { text: `${head}${r.docId ? ` · ${r.docId}` : ''}${files.length ? ` · 첨부 ${files.length}개` : ''}${pdfFail ? ' · 첨부 PDF 못 만듦' : ''}${bad.length ? ` · 안 된 것: ${bad.map((x) => x.label).join('·')}` : ''}` };
        },
      });
      const bad = res.steps.filter((x) => x.ok === false);
      st.lastTab = res.tabId;
      st.writeDone = { ok: !bad.length, docId: res.docId || '', bad: bad.map((x) => x.label) };
      setStatus((bad.length ? `뒤 탭에 공문을 썼습니다 — ${bad.map((x) => x.label).join('·')}은(는) 공문 보기로 열어 확인하세요.`
        : `뒤 탭에 공문을 썼습니다${files.length ? '(첨부까지)' : ''} — 공문 보기로 열어 확인하고 임시저장 뒤 상신하세요.`) + left, bad.length || over || pdfFail ? 'error' : '');
      // 쓴 공문은 창에서 임시저장·상신해야 기안함에 선다 — 읽어 둔 이력을 묵은 것으로 두어 다음에 펴면 다시 읽는다.
      if (st.hist.at) st.hist.at = 1;
    } catch (err) {
      st.writeDone = { ok: false, docId: '', bad: [], why: err.message };
      setStatus(`공문을 쓰지 못했습니다 — ${err.message}`, 'error');
    } finally {
      st.writing = false;
      paintWrite();
    }
    return undefined;
  }

  /** '공문 보기' — 작성한 공문 창을 앞으로. 닫았으면 그렇다고 말하고 단추를 잠근다. */
  async function onShowDoc() {
    if (st.lastTab == null) return;
    if (await showTab(st.lastTab)) return;
    st.lastTab = null;
    st.writeDone = { ...(st.writeDone || { ok: false, docId: '', bad: [] }), closed: true };
    setStatus('공문 창이 닫혔습니다 — 다시 작성하세요.', 'error');
    paintWrite();
  }

  /** 읽은 문서를 PDF 하나로 묶어 내려받는다 — 전자결재 첨부로 쓴다(원본 ea_approval 도 견적서를 PDF 로 바꿔 붙인다). */
  /** 첨부할 파일 — 견적서를 오렸으면(cut) 오린 그림이 앞에 오고, 오려 낸 화면의 장(cut.drop)은 빠진다. */
  function attachFiles(w) {
    // 원본 첨부(메일 첨부·문서 파일)는 묶지 않고 파일 그대로 올린다(writeDoc 의 originalFiles).
    const files = (w?.files || []).filter((f) => !f.original);
    const c = w?.cut;
    return c?.on ? [c.file, ...files.filter((f) => !c.drop.includes(f.name))] : files;
  }

  /**
   * 파일 그대로 올릴 원본 첨부 — 메일 첨부·끌어 넣은 문서 파일(intake 의 originals). 이름은 넣을 때 정한 그대로(같은 이름이면 _2),
   * 바이트는 넣을 때 읽어 둔 dataUrl 이다. 공문 창의 파일첨부가 금지 확장자·크기를 다시 본다(src/gmwrite.js 의 formCheck).
   * @returns {{name: string, type: string, base64: string}[]}
   */
  function originalFiles(w) {
    return (w?.files || []).filter((f) => f.original && f.dataUrl)
      .map((f) => ({ name: f.name, type: f.type || 'application/octet-stream', base64: String(f.dataUrl).slice(String(f.dataUrl).indexOf(',') + 1) }));
  }

  /** 첨부 목록의 문서마다 묶을 파일. 어느 묶음에도 없는 파일은 갈래의 기본 문서로 묶는다. */
  function pdfGroups(w) {
    const files = attachFiles(w);
    if (!files.length) return [];
    const groups = (w.draft.attach || []).map((a) => ({ label: a.label, files: files.filter((f) => a.files?.includes(f.name)) })).filter((g) => g.files.length);
    const rest = files.filter((f) => !groups.some((g) => g.files.includes(f)));
    if (rest.length) groups.push({ label: KINDS[st.kind].doc || '첨부', files: rest });
    return groups;
  }

  /** 첨부할 문서를 문서마다 PDF 하나로 묶어 내려받는다 — 교육 견적서·교육 내용이 따로 한 파일씩이다(전자결재 첨부 칸은 다섯 개). */
  async function savePdf() {
    const w = cur();
    if (!pdfGroups(w).length) return;
    el.savePdf.disabled = true;
    try {
      const pdfs = await attachPdfs(w);
      for (const p of pdfs) {
        const url = URL.createObjectURL(new Blob([p.bytes], { type: 'application/pdf' }));
        try {
          await chrome.downloads.download({ url, filename: p.name, saveAs: false });
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        }
      }
      flash(el.savePdf, pdfs.length > 1 ? `${pdfs.length}개 저장됨 ✓` : '저장됨 ✓');
    } catch (err) {
      setStatus(err.message, 'error');
    } finally {
      el.savePdf.disabled = false;
    }
  }

  /* ---------------------------------------------------------- 양식 */

  function paintTpl() {
    const tpl = tplOf();
    // 고를 수 있는 양식 — 외부강의등 신고서는 외부활동에서만(칸이 외부활동 초안의 칸이다, formsFor).
    const forms = formsFor(st.kind);
    const known = forms.some((f) => f.id === tpl.form);
    el.tplForm.innerHTML = forms.map((f) => `<option value="${f.id}">${escapeHtml(f.label)}</option>`).join('') + '<option value="">양식 ID 직접 적기</option>';
    el.tplForm.value = known ? tpl.form : '';
    el.tplFormId.hidden = known;
    if (document.activeElement !== el.tplFormId) el.tplFormId.value = known ? '' : tpl.form;
    if (document.activeElement !== el.tplTitle) el.tplTitle.value = tpl.title;
    if (document.activeElement !== el.tplBody) el.tplBody.value = tpl.body;
    el.vars.innerHTML = [...VARS[st.kind], ...VAR_MARKS].map(([t, d]) => `<dt>${escapeHtml(t)}</dt><dd>${escapeHtml(d)}</dd>`).join('');
    paintTplState();
  }

  function paintTplState() {
    const edited = templateEdited(st.kind, st.templates);
    el.tplState.textContent = `${KINDS[st.kind].label} · ${edited ? '고친 양식' : '기본 양식'}`;
    el.tplReset.disabled = !edited;
  }

  function onTplInput() {
    el.tplFormId.hidden = !!el.tplForm.value;
    const form = el.tplForm.value || el.tplFormId.value.trim();
    st.templates = { ...st.templates, [st.kind]: templatePatch(st.kind, { form, title: el.tplTitle.value, body: el.tplBody.value }) };
    saveTemplates();
    paintTplState();
    if (cur()) paintLive();
  }

  function resetTpl() {
    const { [st.kind]: _, ...rest } = st.templates;
    st.templates = rest;
    saveTemplates();
    paintTpl();
    if (cur()) paintLive();
    logEvent('gongmun', true, `${KINDS[st.kind].title} 양식을 기본으로 되돌림`);
  }

  /* ---------------------------------------------------------- 공문 설정 */

  function paintPreset() {
    el.dept.value = st.preset.dept;
    el.head.value = st.preset.head;
    el.director.value = st.preset.director;
    el.chief.value = st.preset.chief;
    el.docNo.value = st.preset.docNo;
    paintDocNoHint();
    paintRows();
  }

  function paintPresetState() {
    // 접힌 줄에는 결재선에 설 사람(부서장·소장·본부장)만 보인다(2026-10-09 사용자 지정: "부서장,소장,본부장까지만 표기"). 과제 수는 펴면 보인다.
    const p = st.preset;
    el.presetState.textContent = `부서장 ${p.head || '없음'}${p.director ? ` · 소장 ${p.director}` : ''}${p.chief ? ` · 본부장 ${p.chief}` : ''}`;
    // R&D 탭과 이어져 있으면 그 과제 수, 아니면 여기 적은 과제 수. 한도(열 개)는 정해 둔 몫이 아니라 적지 않는다 — 다 차면 더하기 단추가 잠기며 말한다
    // (2026-10-10 사용자 지정: "꼭 5개일 필요는 없어. 가끔 연장되거나 겹치는 경우 몇개 더 있더라").
    el.projCount.textContent = String(linked() ? st.rnd.length : st.projects.length);
  }

  /**
   * 공문 설정의 과제가 R&D 탭의 과제인가(2026-10-10 사용자 지정: "rnd 에 과제 들어가 있는거 추가하면되잖아. 그거랑 연동되어야") — R&D 탭에 과제가
   * 있으면 그 과제들이 여기 그대로 서고(과제명·별칭·번호·책임자·연구기간·연구 내용은 R&D 탭이 원본), 공문에만 쓰는 개요·계정만 여기서 적는다.
   * R&D 탭이 비어 있으면 예전처럼 여기에 과제를 적는다(R&D 탭을 처음 열 때 그 과제들을 가져간다).
   */
  const linked = () => st.rnd.length > 0;

  // [칸, 안내, 한 줄을 다 쓰는가, 여러 줄인가]. 과제 내용은 구매사유·교육사유를 쓰는 근거다(2026-10-07 사용자 지정).
  // 별명은 교육·출장 품의 제목("[과제 별명] 수행을 위한 … 품의"), 과제번호·연구기간은 본문 '가. 과제 개요'에 들어간다.
  const ROW_KEYS = [
    ['name', '과제명 — 전자결재 과제 찾기에 이 이름 그대로 씁니다', true],
    ['alias', '과제 별명 — 교육·출장 품의 제목에 씁니다 (예: 차단기 과제)'], ['code', '과제번호 (예: RND-20-2026)'],
    ['job', 'Job Id — 전자결재 과제 찾기 (예: RND00202026, 비우면 책임자·과제명으로 찾습니다)'],
    ['lead', '합의자 — 과제책임자 이름'], ['period', '연구기간 (예: 2026.04.01 ~ 2029.12.31)'],
    ['content', '과제 내용 — 연구목표·연구내용 (구매사유·교육사유를 이 내용으로 씁니다)', true, true],
    ['about', '과제 개요 — 본문 첫 줄 (비우면 「과제명」 과제를 수행하고 있습니다)', true], ['account', '계정 — 비우면 갈래 기본값', true],
  ];

  function rowField([k, ph, wide, area], p) {
    const label = escapeHtml(ph.split(' —')[0].split(' (')[0]);
    return area
      ? `<textarea data-k="${k}" class="wide" rows="3" placeholder="${escapeHtml(ph)}" aria-label="${label}">${escapeHtml(p[k] || '')}</textarea>`
      : `<input type="text" data-k="${k}"${wide ? ' class="wide"' : ''} value="${escapeHtml(p[k] || '')}" placeholder="${escapeHtml(ph)}" aria-label="${label}" autocomplete="off" />`;
  }

  /** 여기 적는 과제 한 줄(R&D 탭이 비었을 때, 또는 R&D 탭에 없는 과제). i 는 st.rows 의 차례다. */
  const rowHtml = (p, i, n = i + 1) => `<li class="gm-proj-row" data-i="${i}">`
    + `<div class="gm-row-head"><span>과제 ${n}</span><button type="button" class="ghost small" data-act="drop" data-i="${i}" aria-label="과제 ${n} 빼기">빼기</button></div>`
    + `<div class="gm-row-fields">${ROW_KEYS.map((key) => rowField(key, p)).join('')}</div></li>`;

  // R&D 과제 줄에서 적는 것 — 공문에만 쓰는 개요·계정(ROW_KEYS 의 그 둘과 같은 안내).
  const EXTRA_KEYS = ROW_KEYS.filter(([k]) => k === 'about' || k === 'account');

  /**
   * R&D 탭의 과제 한 줄 — 별칭(없으면 과제명)과 R&D 탭에 적힌 과제명·번호·책임자·연구기간·연구 내용을 보이고(고치는 곳은 R&D 탭),
   * 공문에만 쓰는 개요·계정 칸을 둔다. p 는 rndProjects 의 것(빈 칸은 공문 설정의 같은 과제 줄에서 채운 값이다).
   */
  function linkedHtml(p) {
    // 공문 참조자(과제 YAML 의 공문.참조자 — 공문 종류마다)·행정지원(R&D 탭 — 참조로 고른 사람)은 여기 보이기만 한다. 적는 곳은 YAML 과 R&D 탭이다.
    const meta = [p.code, p.job ? `Job Id ${p.job}` : '', p.lead ? `책임자 ${p.lead}` : '', Object.keys(p.refs || {}).length ? `참조자 ${refsText(p.refs)}` : '',
      (p.support || []).length ? `행정지원 ${supportText(p.support)}` : '', p.period,
      p.rnd.plan ? `연구개발 계획 ${p.rnd.plan}차년도` : '', p.rnd.logs ? `진행 기록 ${p.rnd.logs}건` : ''].filter(Boolean).join(' · ');
    const field = ([k, ph]) => `<input type="text" data-x="${k}" class="wide" value="${escapeHtml(p[k] || '')}" placeholder="${escapeHtml(ph)}" `
      + `aria-label="${escapeHtml(ph.split(' —')[0])}" autocomplete="off" />`;
    return `<li class="gm-proj-row gm-proj-linked" data-rnd="${escapeHtml(p.rnd.id)}">`
      + `<div class="gm-row-head"><span class="gm-linked-name" title="${escapeHtml(p.name)}">${escapeHtml(p.alias || p.name)}</span>`
      + '<button type="button" class="ghost small" data-act="rnd" title="과제명·별칭·번호·책임자·연구기간·연구 내용은 R&amp;D 탭에서 고칩니다">R&amp;D 탭</button></div>'
      + `<p class="gm-linked-meta">${p.alias ? `${escapeHtml(p.name)}${meta ? ' · ' : ''}` : ''}${escapeHtml(meta)}</p>`
      + `<div class="gm-row-fields">${EXTRA_KEYS.map(field).join('')}</div></li>`;
  }

  function paintRows() {
    if (linked()) {
      // R&D 탭의 과제들 — 그 아래에, 여기 적어 두었지만 R&D 탭에 없는 과제(초안에서 고르지 않는다)를 고치거나 빼게 남긴다.
      const book = st.book?.projects || [];
      const orphans = st.rows.map((r, i) => [r, i]).filter(([r]) => String(r.name ?? '').trim() && !book.some((p) => sameProject(p, r)));
      el.projList.innerHTML = st.rnd.map(linkedHtml).join('')
        + (orphans.length ? '<li class="gm-proj-orphan">R&amp;D 탭에 없는 과제 — 초안에서 고르지 않습니다. R&amp;D 탭의 "공문 탭의 과제 가져오기"로 옮기거나 빼세요.</li>'
          + orphans.map(([r, i], n) => rowHtml(r, i, n + 1)).join('') : '');
      el.projAdd.textContent = 'R&D 탭에서 과제 더하기';
      el.projAdd.disabled = st.rnd.length >= RND_MAX;
    } else {
      el.projList.innerHTML = st.rows.map((p, i) => rowHtml(p, i)).join('');
      el.projAdd.textContent = '과제 더하기';
      el.projAdd.disabled = st.rows.length >= MAX_PROJECTS;
    }
    el.projAdd.title = el.projAdd.disabled ? `과제는 ${linked() ? RND_MAX : MAX_PROJECTS}개까지입니다` : '';
    paintPresetState();
  }

  /** 부서·부서장·소장·본부장·문서번호 부서를 고쳤을 때. 결재선이 바로 바뀐다. */
  function onPresetInput() {
    st.preset = normalizePreset({
      dept: el.dept.value, head: el.head.value, director: el.director.value, chief: el.chief.value, docNo: el.docNo.value,
    });
    savePreset();
    paintPresetState();
    paintDocNoHint();
    if (cur()) paintLive();
  }

  function projectsChanged() {
    st.projects = normalizeProjects(st.rows);
    // R&D 탭의 과제도 공문 설정에서 개요·계정(비면 책임자·별칭)을 받는다.
    if (st.book) st.rnd = rndProjects(st.book, st.projects, today(), st.extra);
    savePreset();
    paintPresetState();
    paintProjects();
    if (cur()) paintLive();
  }

  function onRowInput(e) {
    // R&D 과제 줄의 개요·계정 — 그 줄의 두 칸을 함께 담는다(한쪽만 고쳐도 다른 쪽이 공문 설정 줄에서 온 값을 잃지 않게).
    const own = e.target instanceof Element ? e.target.closest('[data-rnd]') : null;
    if (own) {
      const val = (k) => own.querySelector(`[data-x="${k}"]`)?.value || '';
      st.extra = { ...st.extra, [own.dataset.rnd]: { about: val('about'), account: val('account') } };
      projectsChanged();
      return;
    }
    const node = e.target instanceof Element ? e.target.closest('[data-k]') : null;
    const li = node?.closest('[data-i]');
    if (!node || !li || !st.rows[+li.dataset.i]) return;
    st.rows[+li.dataset.i][node.dataset.k] = node.value;
    projectsChanged();
  }

  function onRowClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-act="drop"], [data-act="rnd"]') : null;
    if (!btn) return;
    if (btn.dataset.act === 'rnd') {
      $('tabRnd')?.click();
      return;
    }
    st.rows.splice(+btn.dataset.i, 1);
    paintRows();
    projectsChanged();
  }

  function addRow() {
    // R&D 탭과 이어져 있으면 과제는 R&D 탭에서 더한다 — 돌아오면 여기에 선다(show 가 장부를 다시 읽는다).
    if (linked()) {
      $('tabRnd')?.click();
      return;
    }
    if (st.rows.length >= MAX_PROJECTS) return;
    st.rows.push({ ...EMPTY_ROW });
    paintRows();
    el.projList.querySelector('.gm-proj-row:last-child [data-k="name"]')?.focus();
  }

  /**
   * 초안의 "과제 등록하기"·과제 기본 내용의 "고치기" — 공문 설정을 펴고, 과제 이름이 오면 그 과제 줄의 빈 칸(별명·번호·기간·내용 차례)에,
   * 아니면 빈 줄을 하나 내 준다.
   */
  function openPreset(name = '') {
    el.presetBox.open = true;
    if (!st.rows.length && !linked()) addRow();
    const i = name ? st.rows.findIndex((r) => String(r.name).trim() === name) : -1;
    const row = i >= 0 ? el.projList.querySelector(`.gm-proj-row[data-i="${i}"]`) : null;
    (row || el.presetBox).scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    if (!row) return;
    const keys = ['alias', 'code', 'period', 'content'];
    const empty = keys.find((k) => !String(st.rows[i][k] ?? '').trim());
    row.querySelector(`[data-k="${empty || 'alias'}"]`)?.focus();
  }

  /* ---------------------------------------------------------- 문서번호 코드 */

  /**
   * 부서로 문서번호 코드(문서설정 Doc No.)를 찾아 보여 준다(2026-10-09 사용자 지정: "부서는 내 부서를 입력하면 되고 2개면 선택하라고"). 코드가 적혀 있으면
   * 그 코드의 팀 이름을, 비어 있으면 부서로 찾은 것을 적는다 — 하나면 그것을 쓰고(docSettingOf 가 같은 표로 찾는다), 둘 이상이거나 없으면 문서설정 창의
   * 목록(레시피 settings.yaml 의 doc_no_options)에서 고르는 칸을 낸다. 완료한 문서의 문서설정 화면에는 Doc No. 가 보이지 않아(2026-10-09 읽기 전용 실측)
   * 보낸 공문에서 읽어 오지는 않는다.
   */
  function paintDocNoHint() {
    const c = docNoCandidates(st.preset.dept, st.preset.docNo);
    el.docNoHint.classList.toggle('bad', c.state === 'unknown');
    const option = (o) => `<option value="${escapeHtml(o.code)}">(${escapeHtml(o.code)}) ${escapeHtml(o.team ? `${o.team} — ${o.name}` : o.name)}</option>`;
    const pick = (list, lead) => `${escapeHtml(lead)}<select aria-label="문서번호 코드 고르기"><option value="">고르세요</option>${list.map(option).join('')}</select>`;
    el.docNoHint.innerHTML = c.state === 'set' ? `(${escapeHtml(c.code)}) ${escapeHtml(c.name)}`
      : c.state === 'unknown' ? `코드 ${escapeHtml(c.code)} 은(는) 문서설정 창의 목록에 없습니다 — 다시 확인하세요`
        : c.state === 'one' ? `부서로 찾음: (${escapeHtml(c.code)}) ${escapeHtml(c.name)} — 비워 두면 이 코드를 씁니다`
          : c.state === 'many' ? pick(c.matches, `부서에 맞는 코드가 ${c.matches.length}개입니다 — 고르세요`)
            : c.state === 'none' ? pick(c.all, '부서에 맞는 코드를 찾지 못했습니다 — 문서설정 창의 목록에서 고르세요')
              : '';
  }

  /** 안내 칸의 목록에서 고르면 문서번호 코드 칸에 들어간다. */
  function onDocNoPick(e) {
    const sel = e.target instanceof Element && e.target.tagName === 'SELECT' ? e.target : null;
    if (!sel || !sel.value) return;
    el.docNo.value = sel.value;
    onPresetInput();
  }

  /* ---------------------------------------------------------- 탭 */

  function wire() {
    el.evidenceToggle.addEventListener('click', () => {
      st.view.evidenceOpen = !st.view.evidenceOpen;
      paintView();
      saveView();
    });
    el.workspaceToggle.addEventListener('click', () => {
      st.view.workspaceOpen = !st.view.workspaceOpen;
      paintView();
      saveView();
    });
    el.viewTabs.addEventListener('click', onViewClick);
    el.viewTabs.addEventListener('keydown', onViewKey);
    el.compare.addEventListener('click', openCompare);
    // 사이드패널과 비교작성 탭이 같은 초안을 본다 — 다른 창이 쓴 것을 따라간다.
    chrome.storage.onChanged?.addListener(onStorageChanged);
    el.kinds.addEventListener('click', onKindClick);
    // 에이전트(공문 검색) — 말 칸의 찾기·Enter, 받은·보낸, 기간, 카드 펴기·eclass 에서 열기.
    el.searchGo.addEventListener('click', onSearchGo);
    el.searchText.addEventListener('keydown', onSearchKey);
    el.searchDir.addEventListener('click', onSearchDirClick);
    el.searchSpan.addEventListener('click', onSearchSpanClick);
    el.searchList.addEventListener('click', onSearchListClick);
    el.file.addEventListener('change', () => {
      const files = [...el.file.files];
      el.file.value = '';
      intake({ files });
    });
    el.agentGo.addEventListener('click', runAgent);
    el.agentInput.addEventListener('keydown', onAgentKey);
    el.agentInput.addEventListener('input', growAgent);
    el.capture.addEventListener('click', onCaptureClick);
    el.manual.addEventListener('click', startManual);
    el.reset.addEventListener('click', resetWork);
    el.cut.addEventListener('click', onCutClick);
    el.pick.addEventListener('click', onProjectClick);
    el.projects.addEventListener('click', onProjectClick);
    el.projInfo.addEventListener('click', onProjectClick);
    el.fields.addEventListener('input', onFieldInput);
    el.fields.addEventListener('change', onFieldInput);
    el.moreFields.addEventListener('input', onFieldInput);
    el.moreFields.addEventListener('change', onFieldInput);
    el.fields.addEventListener('click', onFieldClick);
    el.title.addEventListener('input', onDocInput);
    el.body.addEventListener('input', onDocInput);
    el.regen.addEventListener('click', regen);
    el.write.addEventListener('click', writeDoc);
    el.showDoc.addEventListener('click', onShowDoc);
    // 구매의뢰 작성 — 구매 갈래에서 지금 구매 초안으로 구매요청서 초안을 만들어 구매의뢰 갈래로(2026-10-17).
    el.order.addEventListener('click', orderFromHere);
    for (const node of [el.rank, el.retention, el.docNoOne, el.receiver, el.scope, el.emergency, el.approvingOpen, el.drm, el.tag]) {
      node.addEventListener(node.tagName === 'SELECT' || node.type === 'checkbox' ? 'change' : 'input', onSetInput);
    }
    el.setReset.addEventListener('click', resetSet);
    // 결재선 줄 끝의 R&D 탭 — 과제 책임자·행정지원(참조자)을 고치러 간다.
    el.lineGo.addEventListener('click', () => $('tabRnd')?.click());
    el.savePdf.addEventListener('click', savePdf);
    for (const node of [el.tplForm, el.tplFormId, el.tplTitle, el.tplBody]) {
      node.addEventListener('input', onTplInput);
      node.addEventListener('change', onTplInput);
    }
    el.tplReset.addEventListener('click', resetTpl);
    for (const node of [el.dept, el.head, el.director, el.chief, el.docNo]) node.addEventListener('input', onPresetInput);
    el.docNoHint.addEventListener('change', onDocNoPick);
    el.projList.addEventListener('input', onRowInput);
    el.projList.addEventListener('click', onRowClick);
    el.projAdd.addEventListener('click', addRow);
    // 공문 이력 — 누계 줄의 '이력', 접힌 칸 펴기(읽기), 기간(3개월·올해·1y·2y)·전체·새로고침, 카드 펴기·eclass 에서 열기.
    el.feeSum.addEventListener('click', onFeeSumClick);
    el.acctRow.addEventListener('click', onAcctRowClick);
    el.histBox.addEventListener('toggle', onHistToggle);
    el.histSpan.addEventListener('click', onHistSpanClick);
    el.histAll.addEventListener('click', toggleHistAll);
    el.histRefresh.addEventListener('click', () => loadHist({ force: true }));
    el.histList.addEventListener('click', onHistClick);
    for (const type of ['dragover', 'dragleave']) el.root.addEventListener(type, onDrag);
    el.root.addEventListener('drop', onDrop);
    document.addEventListener('paste', onPaste);
  }

  /** 탭이 보일 때. 처음 한 번 저장해 둔 갈래·공문 설정·과제·양식·초안을 읽는다. */
  async function show() {
    el.root.classList.remove('hidden');
    if (!st.loaded) {
      const saved = await chrome.storage.local.get([KIND_KEY, PRESET_KEY, PROJECTS_KEY, RND_EXTRA_KEY, TEMPLATES_KEY, DRAFT_KEY, VIEW_KEY, HIST_KEY, SEARCH_KEY]);
      Object.assign(st.hist, normalizeHist(saved?.[HIST_KEY]));
      // 에이전트(공문 검색) — 켜 두었으면 그 갈래로 열리고, 찾아 둔 것·적은 말이 그대로 보인다.
      Object.assign(st.search, normalizeSearch(saved?.[SEARCH_KEY]));
      el.searchText.value = st.search.text;
      const view = saved?.[VIEW_KEY];
      // 비교작성 탭은 늘 두 칸(작성 내용·읽은 내용)으로 시작하고 연 갈래를 본다.
      if (!st.compareTab) st.view = { tab: TAB_LABEL[view?.tab] ? view.tab : 'draft', evidenceOpen: view?.evidenceOpen !== false, workspaceOpen: view?.workspaceOpen !== false };
      st.kind = st.compareTab || (KINDS[saved?.[KIND_KEY]] ? saved[KIND_KEY] : KIND_ORDER[0]);
      st.preset = normalizePreset(saved?.[PRESET_KEY]);
      st.projects = normalizeProjects(saved?.[PROJECTS_KEY]);
      st.rows = st.projects.map((p) => ({ ...p }));
      st.extra = normalizeRndExtra(saved?.[RND_EXTRA_KEY]);
      st.templates = saved?.[TEMPLATES_KEY] && typeof saved[TEMPLATES_KEY] === 'object' ? saved[TEMPLATES_KEY] : {};
      const kept = saved?.[DRAFT_KEY] && typeof saved[DRAFT_KEY] === 'object' ? saved[DRAFT_KEY] : {};
      st.lastProject = typeof kept.lastProject === 'string' ? kept.lastProject : '';
      for (const k of KIND_ORDER) {
        const w = kept[k];
        if (w?.draft && typeof w.draft === 'object' && !st.work[k]) st.work[k] = restoreWork(k, w);
      }
      st.loaded = true;
      await pullCut();   // 비교작성 탭 — 사이드패널이 건넨 오린 견적서
    }
    await loadBook();
    paintKinds();
    paintIntake();
    renderFields();
    paintDraft({ fold: true });
    paintTpl();
    paintPreset();
    paintHist();
    paintMode();
    paintSearch();
    if (agentOn()) runSearch();
  }

  /** R&D 탭의 장부(rndBook)를 읽어 초안에서 고를 과제로 — 탭을 열 때마다(R&D 탭에서 과제·연구 내용을 고치고 돌아온다). */
  async function loadBook() {
    const saved = await chrome.storage.local.get([BOOK_KEY, RND_SET_KEY, PLAN.KEY]);
    st.book = normalizeBook(saved?.[BOOK_KEY]);
    st.rnd = rndProjects(st.book, st.projects, today(), st.extra);
    st.rndSet = saved?.[RND_SET_KEY] && typeof saved[RND_SET_KEY] === 'object' ? saved[RND_SET_KEY] : null;
    st.plans = saved?.[PLAN.KEY] && typeof saved[PLAN.KEY] === 'object' ? saved[PLAN.KEY] : {};
  }

  function hide() {
    el.root.classList.add('hidden');
  }

  /** 새로고침(↻). 사이트에서 읽어 올 것이 없다 — 화면만 다시 그린다. */
  async function reload() {
    return show();
  }

  /** Claude 에 닿는지. 닿지 않으면 문서 넣는 곳과 에이전트 칸을 회색으로 내린다(문서 없이 쓰기·규칙으로 읽기는 된다). */
  function paintReady(ready) {
    st.ready = ready;
    el.agent.classList.toggle('off', !ready);
    paintIntake();
  }

  return { wire, show, hide, reload, paintReady, state: st, compareTab: st.compareTab };
}
