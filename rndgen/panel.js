// R&D 탭의 과제 더하기 카드(＋ — YAML 넣기 또는 사업계획서에서 이 차년도 KR 스냅샷 뽑기)와 변경 및 이력 관리 카드의 위쪽 몫(글·문서 → 기준 YAML 고치기)의 화면.
// 문서 읽기(source)·LLM(llm)·YAML 검사와 마무리(yaml)·저장된 원문(store)·장부(rnd — rndpanel.js 의 손잡이)는 모두 주입받고 여기는 그것을 잇기만 한다.
//
//   ＋ 칩 · 과제 더하기 · 빈 차년도 카드의 단추 → rnd.onAdd → openAdd(대상) — 덮개(rnd.setOverlay('add'))라 머리·몸통은 숨고 ＋ 칩이 켜진다
//     → YAML 파일은 rnd.intake 로 바로 넣고, 문서는 source.readDocument → llm.askExtract → yaml.checkExtracted → finalizeExtracted
//     → 미리보기(과제·차년도·비목별 예산·참여연구자·경고 · 별칭 · YAML 원문) → 넣기(rnd.intake · setAlias · pick) / YAML 파일로 저장 / 다시 뽑기
//     차년도 고르기의 "모든 차년도"(2026-10-16 사용자 지정)는 같은 재료로 1차년도부터 차년도마다 한 번씩 차례로 묻고(몇 차년도까지는 대상 과제의 연구기간,
//     그리고 처음 읽힌 답의 meta.연차범위 — yaml.stageCount) 차년도별 줄(합계·참여연구자·경고 · YAML · 다시 뽑기)로 보인 뒤 한 번에 넣는다 / 차년도 폴더 zip 으로 저장
//   과제를 보고 있고 그 차년도에 예산 정보가 있으면 변경 및 이력 관리 카드의 위쪽(YAML 고치기) — 글·문서 → llm.askRevise → nextRev · finalizeRevised
//     → 구조 차이(diffYaml)·새로 남을 변경이력(previewApply) 미리보기 → 반영(rnd.intake) / YAML 파일로 저장
//
// 저장(chrome.storage 의 rndYamlText)은 하지 않는다 — rnd.intake 를 지나면 rndgen/index.js 의 onIntake 훅이 남긴다. 여기서는 store.get 만 읽는다.
// import·생성·wire() 때 chrome·fetch 를 만지지 않고 DOM 은 두 host 안에만 만든다(test/wiring.test.mjs 가 sidepanel.js 를 jsdom 에서 통째로 import 한다).
// 사람이 적은 글·파일 이름·LLM 답은 textContent 로만 넣는다. 단추는 접힌 칸 뒤에 숨기지 않는다(접힌 칸은 "기능이 없다" 로 읽힌다 — 2026-10-15 사용자)
// — 접는 것은 YAML 원문 칸뿐이다(그건 내용이지 행위가 아니다).
// LLM 호출은 길면 10분이다 — 그동안 host 에 aria-busy, 단추는 잠그고(닫기·취소·직접 적기는 둔다) 알림 줄에 지난 초를 센다. 실패해도 적어 둔 변경 글은 지우지 않는다.

import { yearsOf, currentYear, yearLabel, aliasOwner } from '../src/rnd.js';
import { kindOf, findProject } from '../src/rndyaml.js';
import { buildZip } from '../src/zip.js';

const NEED_AI = 'Claude 연결(로컬 CLI 또는 API 키)이 필요합니다 — 설정 → LLM';
const ASKING_EXTRACT = 'Claude 에게 묻는 중 — 큰 문서는 몇 분 걸릴 수 있습니다(최대 10분)';
const ASKING_ALL = 'Claude 에게 차년도마다 차례로 묻는 중 — 차년도마다 몇 분 걸릴 수 있습니다';
/** 차년도 고르기의 "모든 차년도" 값. */
const ALL = 'all';
const ASKING_REVISE = 'Claude 에게 묻는 중 — 기준 YAML 을 고치고 있습니다. 몇 분 걸릴 수 있습니다(최대 10분)';
const LOSSY_BASE = '기준: 장부로 지음(손실 있음) — 원문 YAML 을 넣어 두면 정확합니다';
/** 과제를 모를 때 차년도 고르기에 둘 칸 수. */
const STAGE_UNKNOWN = 10;
/** 변경사항 카드에 붙일 문서 수(actions/spec/rnd/revise.yaml 의 files max 와 같다). */
const MAX_CHANGE_FILES = 6;
/** 뽑기·붙이기 재료가 되는 문서 갈래(source.docKind). yaml 은 그대로 넣는 파일, hwp·'' 는 못 받는다. */
const DOC_KINDS = new Set(['pdf', 'office', 'text']);
const VIA_LABEL = { cli: '로컬 CLI', api: 'API 키' };
/** 바쁠 때 알림 줄의 지난 초를 다시 쓰는 간격. */
const TICK_MS = 1000;

const UPLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0-4 4m4-4 4 4"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
const CLIP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.4 3.4 0 0 1 4.8 4.8l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"/></svg>';

/** 더하기 카드 — 글은 고정 문구뿐이다(사람·LLM 의 글은 그린 뒤 textContent 로). id 는 검사·CSS·wiring 이 본다. */
const ADD_HTML = `
<div class="rdg-add card">
  <div class="rdg-head">
    <strong>과제 더하기</strong>
    <span id="rdgTarget" class="rdg-target hidden"></span>
    <button type="button" id="rdgAddClose" class="rdg-close" aria-label="닫기" title="닫기">${CLOSE_ICON}</button>
  </div>
  <label class="rdg-drop" for="rdgFile">
    <input type="file" id="rdgFile" accept=".yaml,.yml,.pdf,.hwpx,.docx,.xlsx,.pptx,.txt,.md" multiple />
    <span class="rdg-drop-lead">${UPLOAD_ICON}<span>YAML 또는 사업계획서 넣기</span></span>
    <span class="rdg-drop-how">KR_&lt;과제&gt;.yaml · history/*.yaml 은 그대로 들어가고, 사업계획서·연구계획서(PDF · HWPX · DOCX · XLSX · TXT)는 아래에서 고른 차년도(모든 차년도도 됩니다)의 KR 스냅샷 YAML 을 뽑습니다 — 끌어다 놓기 · 눌러서 고르기</span>
    <span class="rdg-drop-note">옛 한글(.hwp)은 뽑지 못합니다 — 한글에서 PDF 로 저장해 넣으세요(.hwpx 는 그대로 됩니다)</span>
  </label>
  <div class="rdg-row">
    <label class="rdg-field"><span>차년도</span><select id="rdgStage"></select></label>
    <button type="button" id="rdgManual" class="ghost small" title="사업계획서·YAML 없이 과제명·별칭·연구기간을 손으로 적습니다">직접 적기</button>
  </div>
  <p id="rdgAddMsg" class="rdg-msg" role="status" aria-live="polite"></p>
  <div id="rdgPreview" class="rdg-preview hidden">
    <p class="rdg-read"></p>
    <dl class="rdg-meta"></dl>
    <label class="rdg-alias"><span>별칭 <span class="req">필수</span></span><input type="text" id="rdgAlias" autocomplete="off" spellcheck="false" placeholder="별칭 — 예) SSCB" /></label>
    <details class="rdg-yaml"><summary>YAML 원문 보기/고치기<span class="rdg-yaml-year"></span></summary><textarea id="rdgYaml" rows="14" spellcheck="false" aria-label="뽑은 스냅샷 YAML"></textarea></details>
    <div class="rdg-actions">
      <button type="button" id="rdgApply" class="primary small">넣기</button>
      <button type="button" id="rdgSave" class="ghost small">YAML 파일로 저장</button>
      <button type="button" id="rdgRetry" class="ghost small" title="같은 문서로 위 차년도를 다시 뽑습니다">다시 뽑기</button>
      <button type="button" id="rdgCancel" class="ghost small">취소</button>
    </div>
  </div>
</div>`;

/**
 * 변경 및 이력 관리 카드(sidepanel.html 의 #rdChangeBox — 2026-10-16 사용자 지정으로 변경이력 칸을 대체)의 위쪽 몫.
 * 카드 틀·이름·아래의 변경이력 목록은 그 카드(rndpanel.js) 것이라 여기는 기준 줄부터 그린다.
 */
const REVISE_HTML = `
<div class="rdg-revise">
  <p id="rdgBase" class="rdg-base"></p>
  <textarea id="rdgChange" class="rdg-change" rows="3" aria-label="바뀐 내용" placeholder="바뀐 내용을 아무 꼴로 — 메일·공문·메모·표를 붙여 넣으세요"></textarea>
  <div class="rdg-row">
    <label class="rdg-attach" title="PDF · HWPX · DOCX · XLSX · TXT — 글자를 읽어 변경 글과 함께 보냅니다">${CLIP_ICON}<span>문서 붙이기</span><input type="file" id="rdgChangeFile" multiple accept=".pdf,.hwpx,.docx,.xlsx,.txt,.md" /></label>
    <span id="rdgChangeFiles" class="rdg-files"></span>
    <button type="button" id="rdgReviseGo" class="primary small rdg-go">YAML 고치기</button>
  </div>
  <p id="rdgReviseMsg" class="rdg-msg" role="status" aria-live="polite"></p>
  <div id="rdgRevPreview" class="rdg-preview hidden">
    <p class="rdg-summary"></p>
    <p class="rdg-sub">구조 차이 — 기준 YAML 과 고친 YAML</p>
    <ul id="rdgDiff" class="rdg-diff"></ul>
    <p class="rdg-sub">변경이력에 새로 남을 줄</p>
    <ul id="rdgChangelog" class="rdg-changelog"></ul>
    <p class="rdg-warn"></p>
    <details class="rdg-yaml"><summary>YAML 원문 보기/고치기</summary><textarea id="rdgRevYaml" rows="14" spellcheck="false" aria-label="고친 YAML"></textarea></details>
    <div class="rdg-actions">
      <button type="button" id="rdgRevApply" class="primary small">반영</button>
      <button type="button" id="rdgRevSave" class="ghost small">YAML 파일로 저장</button>
      <button type="button" id="rdgRevCancel" class="ghost small" title="미리보기만 지웁니다 — 적어 둔 변경 글과 붙인 문서는 둡니다">취소</button>
    </div>
  </div>
</div>`;

const str = (v) => (v == null ? '' : String(v)).trim();
const pad = (n) => String(n).padStart(2, '0');
const dot = (s) => (s ? String(s).replace(/-/g, '.') : '');
const hasAi = (a) => !!(a && (a.apiKey || a.cli));
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
/** ISO 시각 → "10.12"(이 PC 의 날짜). */
const mmdd = (at) => {
  const d = new Date(at);
  return at && !Number.isNaN(d.getTime()) ? `${pad(d.getMonth() + 1)}.${pad(d.getDate())}` : '';
};
const elapsedText = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`;
};
/** LLM 답의 warnings(" / " 로 이은 글 — 목록으로 와도 받는다) → 줄들. */
const splitWarn = (w) => (Array.isArray(w) ? w : String(w ?? '').split(/\s+\/\s+|\n+/)).map(str).filter(Boolean);
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
/** "로컬 CLI · $0.0421" — 활동 로그·알림 줄. */
const viaText = (out) => [VIA_LABEL[out?.via] || out?.via || '', Number.isFinite(out?.costUsd) ? `$${Number(out.costUsd).toFixed(4)}` : ''].filter(Boolean).join(' · ');
const withName = (name, msg) => (String(msg).includes(name) ? String(msg) : `${name}: ${msg}`);
const defaultToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** Claude 에게 줄 것이 있는 재료인가 — 글자도 붙일 PDF 도 없으면(글자 층 없는 스캔본이 8MB 를 넘음 등) 묻지 않는다(rndgen/source.js). */
const usable = (m) => !!(m && (m.chars || m.file));
const projectIn = (book, id) => (id ? (book?.projects || []).find((p) => p.id === id) || null : null);

/* 모든 차년도 — 차년도마다 한 줄(Year). state: wait(차례를 기다림) · asking(묻는 중) · ok(스냅샷) · fail(못 뽑음 — 꼴이 아닌 답이면 원문은 text 에). */
const blankYear = (n) => ({ n, state: 'wait', text: '', sum: null, warnings: [], error: '', alias: '', edited: false });
/** 넣을 차년도 — 뽑은 것, 그리고 못 뽑았어도 사람이 원문을 고친 것. */
const readyYears = (all) => (all?.years || []).filter((y) => y.text.trim() && (y.state === 'ok' || y.edited));
const yearsText = (ys) => ys.map((y) => yearLabel(y.n)).join('·');
const projectKey = (s) => str(s).replace(/\s/g, '').toLowerCase();
/** 같은 과제로 들어가는가 — src/rndyaml.js findProject 와 같은 잣대(둘 다 과제번호가 있으면 과제번호, 아니면 과제명). */
const sameProject = (a, b) => (a.code && b.code ? projectKey(a.code) === projectKey(b.code) : projectKey(a.name) === projectKey(b.name));
/** 여러 번 물은 것의 "로컬 CLI · $1.2345" — 길은 겹치지 않게, 값은 더한다. */
function viaOfAll(outs) {
  const costs = outs.filter((o) => Number.isFinite(o?.costUsd)).map((o) => Number(o.costUsd));
  return {
    text: [uniq(outs.map((o) => VIA_LABEL[o?.via] || o?.via || '')).join('·'), costs.length ? `$${costs.reduce((a, c) => a + c, 0).toFixed(4)}` : ''].filter(Boolean).join(' · '),
    via: uniq(outs.map((o) => o?.via || '')).join(','),
    ...(costs.length ? { costUsd: costs.reduce((a, c) => a + c, 0) } : {}),
  };
}

/**
 * 더하기 카드(hosts.add 안)와 변경 및 이력 관리 카드의 YAML 고치기 몫(hosts.revise 안 — 카드 틀은 바깥 #rdChangeBox)을 그린다. 모든 의존은 주입(계약 §4.4).
 * @param {{
 *   hosts: { add: HTMLElement, revise: HTMLElement },
 *   rnd: object,                       // rndpanel.js 손잡이 — book · view · onView · onAdd · setOverlay · addManually · intake · pick · setAlias (· readAsset · download)
 *   source: { readDocument: Function, docKind: Function, unsupportedDocNote: Function },
 *   llm: { askExtract: Function, askRevise: Function, loadSkillDocs: Function },
 *   yaml: { checkExtracted, finalizeExtracted, finalizeRevised, nextRev, summarizeSnapshot, diffYaml, diffLines, previewApply, bookToSnapshot, fileName, parseYaml },
 *   store: { get: Function, history?: Function, load: Function },
 *   ai: () => ({ apiKey?: string, cli?: boolean }),
 *   readAsset?: (path: string, as?: 'text'|'bytes') => Promise<string|Uint8Array>,
 *   download?: (data: string|Uint8Array, filename: string, type?: string) => Promise<void>,
 *   today: () => string, now?: () => number,
 *   logEvent: (kind: 'rnd', ok: boolean, text: string, data?: object) => void,
 *   escapeHtml?: (v: any) => string, flash?: (btn: HTMLElement, text: string, ms?: number) => void,
 *   engines?: object, tickMs?: number
 * }} deps   readAsset·download 이 없으면 rnd 의 것을 쓴다. engines 는 source.readDocument 에 넘긴다(검사용). tickMs 는 지난 초를 다시 쓰는 간격.
 * @returns {{ wire(): void, openAdd(target?: { projectId?: string, n?: number }): void, closeAdd(): void, onView(view: object): void, state(): object }}
 */
export function createRndGenPanel({
  hosts = {}, rnd, source, llm, yaml, store, ai = () => ({}), readAsset, download, today = defaultToday, now = () => Date.now(),
  // deps.escapeHtml 은 계약의 꼴대로 넘어오지만 쓰지 않는다 — 바뀌는 글은 모두 textContent 로 넣는다.
  logEvent = () => {}, flash = () => {}, engines = undefined, tickMs = TICK_MS,
} = {}) {
  const readAssetFn = readAsset || ((path, as) => rnd.readAsset(path, as));
  const downloadFn = download || ((data, name, type) => rnd.download(data, name, type));
  const st = {
    built: false, wired: false,
    // 마지막으로 받은 장부 화면(View — 계약 §2.4). 저장된 YAML 원문은 처음 과제를 볼 때 한 번 읽는다(loading) — 다 읽기 전에는 기준 줄이 "찾는 중".
    view: null, loading: null, loaded: false,
    // 더하기 카드 — run 은 지금 도는 일의 번호(닫거나 새 일을 시작하면 올라가 늦게 온 답을 버린다).
    // all 은 "모든 차년도" 로 뽑았을 때만 — { total(몇 차년도까지 · 모르면 0), counted(답에서 읽었나), at(YAML 칸에 연 차년도), years: Year[] }. 그때 text·sum·file 은 비고 warnings 는 공통 경고.
    add: { open: false, target: null, material: null, text: '', sum: null, known: null, file: '', warnings: [], all: null, busy: false, run: 0 },
    // 변경사항 카드 — key 는 보고 있는 "과제:차년도"(바뀌면 입력·미리보기를 비운다), files 는 붙인 문서(File), result 는 미리보기.
    rev: { key: '', files: [], result: null, busy: false, run: 0 },
  };
  const ticks = { add: null, rev: null };
  let A = null;   // 더하기 카드의 요소들
  let R = null;   // 변경사항 카드의 요소들

  /* ---------------------------------------------------------- 그리기 바탕 */

  /** 두 host 안에 카드를 한 번 만든다(리스너는 wire 가 단다). host 가 없으면 그 카드는 없다. */
  function build() {
    if (st.built) return;
    st.built = true;
    if (hosts.add) {
      const h = hosts.add;
      h.innerHTML = ADD_HTML;
      const q = (sel) => h.querySelector(sel);
      A = {
        host: h, card: q('.rdg-add'), target: q('#rdgTarget'), close: q('#rdgAddClose'), drop: q('.rdg-drop'), file: q('#rdgFile'), stage: q('#rdgStage'),
        manual: q('#rdgManual'), msg: q('#rdgAddMsg'), preview: q('#rdgPreview'), read: q('.rdg-read'), meta: q('.rdg-meta'),
        aliasRow: q('.rdg-alias'), alias: q('#rdgAlias'), yamlBox: q('.rdg-yaml'), yamlYear: q('.rdg-yaml-year'), yaml: q('#rdgYaml'),
        apply: q('#rdgApply'), save: q('#rdgSave'), retry: q('#rdgRetry'), cancel: q('#rdgCancel'),
      };
      paintStage(null, 0);
    }
    if (hosts.revise) {
      const h = hosts.revise;
      h.innerHTML = REVISE_HTML;
      const q = (sel) => h.querySelector(sel);
      R = {
        host: h, card: q('.rdg-revise'), base: q('#rdgBase'), change: q('#rdgChange'), fileIn: q('#rdgChangeFile'), files: q('#rdgChangeFiles'), go: q('#rdgReviseGo'),
        msg: q('#rdgReviseMsg'), preview: q('#rdgRevPreview'), summary: q('.rdg-summary'), diff: q('#rdgDiff'), changelog: q('#rdgChangelog'), warn: q('.rdg-warn'),
        yamlBox: q('.rdg-yaml'), yaml: q('#rdgRevYaml'), apply: q('#rdgRevApply'), save: q('#rdgRevSave'), cancel: q('#rdgRevCancel'),
      };
    }
  }

  /** 두 host 에 리스너를 하나씩(이벤트 위임) 달고 rnd 의 훅을 등록한다. chrome·fetch·LLM 은 사람이 누를 때까지 부르지 않는다. */
  function wire() {
    if (st.wired) return;
    st.wired = true;
    build();
    if (A) {
      A.host.addEventListener('click', onAddClick);
      A.host.addEventListener('change', onAddChange);
      A.host.addEventListener('input', onAddInput);
      for (const type of ['dragover', 'dragleave', 'drop']) A.host.addEventListener(type, onAddDrag);
    }
    if (R) {
      R.host.addEventListener('click', onRevClick);
      R.host.addEventListener('change', onRevChange);
      for (const type of ['dragover', 'dragleave', 'drop']) R.host.addEventListener(type, onRevDrag);
    }
    rnd?.onView?.((view) => onView(view));
    rnd?.onAdd?.((target) => openAdd(target));
  }

  function say(which, text, kind = '') {
    const m = which === 'add' ? A?.msg : R?.msg;
    if (!m) return;
    m.textContent = text || '';
    m.className = `rdg-msg${kind ? ` ${kind}` : ''}`;
  }

  function stopTick(which) {
    clearInterval(ticks[which]);
    ticks[which] = null;
  }

  /** 오래 걸리는 일의 알림 — 문구 뒤에 지난 초를 붙여 tickMs 마다 다시 쓴다. */
  function startTick(which, base) {
    stopTick(which);
    const t0 = now();
    const paint = () => say(which, `${base} · ${elapsedText(now() - t0)}`);
    paint();
    ticks[which] = setInterval(paint, tickMs);
  }

  /** 바쁨 — host 의 aria-busy 와 단추 잠금. 끄면 지난 초 세기도 멈춘다. */
  function setBusy(which, on) {
    const s = which === 'add' ? st.add : st.rev;
    const host = which === 'add' ? A?.host : R?.host;
    s.busy = !!on;
    if (host) {
      if (on) host.setAttribute('aria-busy', 'true');
      else host.removeAttribute('aria-busy');
    }
    if (!on) stopTick(which);
    if (which === 'add') paintAddButtons();
    else paintRevButtons();
  }

  /* ---------------------------------------------------------- 과제 더하기 카드 */

  /** 차년도 고르기 — 자동(오늘이 든 차년도) · 모든 차년도 + 1차년도…(과제가 있으면 그 차년도 수, 없으면 10). */
  function paintStage(project, n) {
    if (!A) return;
    const doc = A.host.ownerDocument;
    const count = Math.max(project ? yearsOf(project).length : STAGE_UNKNOWN, n || 0);
    const opt = (value, text) => { const o = doc.createElement('option'); o.value = value; o.textContent = text; return o; };
    A.stage.replaceChildren(opt('', '자동(오늘이 든 차년도)'), opt(ALL, '모든 차년도'), ...Array.from({ length: count }, (_, i) => opt(String(i + 1), yearLabel(i + 1))));
    A.stage.value = n ? String(n) : '';
  }

  function paintAddButtons() {
    if (!A) return;
    const { busy, text, material, all } = st.add;
    const has = all ? readyYears(all).length > 0 : !!text;
    A.file.disabled = busy;
    A.stage.disabled = busy;
    A.apply.disabled = busy || !has;
    A.save.disabled = busy || !has;
    A.save.textContent = all ? 'YAML 묶음 저장(zip)' : 'YAML 파일로 저장';
    A.retry.disabled = busy || !usable(material);
    A.retry.title = all ? '같은 문서로 모든 차년도를 처음부터 다시 뽑습니다 — 한 차년도만은 그 줄의 다시 뽑기' : '같은 문서로 위 차년도를 다시 뽑습니다';
    for (const b of A.meta.querySelectorAll('button')) b.disabled = busy;
  }

  /** 미리보기 — 무엇을 읽었는가 · 뽑은 것의 요약 · 별칭 · YAML 원문. YAML 칸의 글은 여기서 덮지 않는다(사람이 고쳤을 수 있다). */
  function paintAddPreview({ openYaml = false } = {}) {
    if (!A) return;
    const s = st.add;
    const all = s.all;
    A.preview.classList.toggle('hidden', !(s.material || s.text || all));
    A.read.textContent = s.material?.read || '';
    A.read.classList.toggle('hidden', !s.material?.read);
    paintMeta();
    A.aliasRow.classList.toggle('hidden', all ? !all.years.some((y) => y.state === 'ok') : !s.text);
    A.yamlBox.classList.toggle('hidden', all ? !all.years.some((y) => y.text) : !s.text);
    A.yamlYear.textContent = all?.at ? ` — ${yearLabel(all.at)}` : '';
    if (openYaml) A.yamlBox.open = true;
    paintAddButtons();
  }

  function paintMeta() {
    const doc = A.host.ownerDocument;
    const s = st.add;
    const rows = s.all ? allRows(doc) : [];
    if (!s.all && s.sum) {
      const m = s.sum;
      rows.push(['과제명', m.name || '—']);
      rows.push(['차년도', [m.n ? yearLabel(m.n) : '', m.rev].filter(Boolean).join(' · ') || '—']);
      rows.push(['과제번호', m.code || '—'], ['책임자', m.lead || '—']);
      if (m.start || m.end) rows.push(['연구기간', `${dot(m.start)} ~ ${dot(m.end)}`]);
      rows.push(['비목별 예산(천원)', budgetTable(doc, m)]);
      rows.push(['참여연구자', `${Number(m.people) || 0}명`]);
      if (m.goals?.length) rows.push(['개발목표', `${m.goals.length}개`]);
      rows.push(['넣을 곳', s.known ? `${s.known.alias || s.known.name} — 장부에 있는 과제` : '새 과제']);
    }
    // 모든 차년도면 공통 경고(재료·대상) 뒤에 차년도마다의 경고를 "N차년도: " 를 앞에 붙여.
    const warns = s.all ? [...s.warnings, ...s.all.years.flatMap((y) => y.warnings.map((w) => `${yearLabel(y.n)}: ${w}`))] : s.warnings;
    if (warns.length) {
      const ul = doc.createElement('ul');
      ul.className = 'rdg-warns';
      for (const w of warns) { const li = doc.createElement('li'); li.textContent = w; ul.append(li); }
      rows.push(['경고', ul]);
    }
    A.meta.replaceChildren(...rows.map(([k, v]) => {
      const div = doc.createElement('div');
      const dt = doc.createElement('dt');
      const dd = doc.createElement('dd');
      dt.textContent = k;
      if (typeof v === 'string') dd.textContent = v;
      else dd.append(v);
      div.append(dt, dd);
      return div;
    }));
    A.meta.classList.toggle('hidden', !rows.length);
  }

  function budgetTable(doc, m) {
    const items = Array.isArray(m.budget) ? m.budget : [];
    if (!items.length) return '비목 없음';
    const table = doc.createElement('table');
    table.className = 'rdg-budget';
    const row = (a, b, cls = '') => {
      const tr = doc.createElement('tr');
      if (cls) tr.className = cls;
      for (const v of [a, b]) { const td = doc.createElement('td'); td.textContent = v; tr.append(td); }
      return tr;
    };
    const body = doc.createElement('tbody');
    for (const b of items) body.append(row(str(b.item), str(b.thousand)));
    if (m.totalThousand) body.append(row('합계', str(m.totalThousand), 'sum'));
    table.append(body);
    return table;
  }

  /** 모든 차년도의 미리보기 줄 — 공통(과제명·과제번호·책임자·연구기간 — 처음 뽑힌 차년도의 것) · 차년도별 · 넣을 곳. */
  function allRows(doc) {
    const s = st.add;
    const first = s.all.years.find((y) => y.state === 'ok');
    const rows = [];
    if (first) {
      const m = first.sum;
      rows.push(['과제명', m.name || '—'], ['과제번호', m.code || '—'], ['책임자', m.lead || '—']);
      if (m.start || m.end) rows.push(['연구기간', `${dot(m.start)} ~ ${dot(m.end)}`]);
    }
    rows.push(['차년도별', yearList(doc)]);
    if (first) rows.push(['넣을 곳', s.known ? `${s.known.alias || s.known.name} — 장부에 있는 과제` : '새 과제']);
    return rows;
  }

  /** 차년도마다 한 줄 — 이름 · 형편(합계·참여연구자·경고 / 까닭) · YAML(아래 칸에 연다) · 다시 뽑기(그 차년도만). YAML 칸에 연 차년도는 .at. */
  function yearList(doc) {
    const all = st.add.all;
    const ul = doc.createElement('ul');
    ul.className = 'rdg-years';
    const button = (text, key, n, title) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'ghost small';
      b.dataset[key] = String(n);
      b.textContent = text;
      b.title = title;
      return b;
    };
    for (const y of all.years) {
      const li = doc.createElement('li');
      li.className = `rdg-year ${y.state}${all.at === y.n ? ' at' : ''}`;
      const name = doc.createElement('strong');
      name.textContent = yearLabel(y.n);
      const what = doc.createElement('span');
      what.className = 'rdg-year-what';
      what.textContent = y.state === 'wait' ? '기다림'
        : y.state === 'asking' ? '뽑는 중…'
          : y.state === 'fail' ? `뽑지 못함 — ${y.error}${y.edited ? ' · 원문을 고침(넣기에 듦)' : ''}`
            : [y.sum.totalThousand ? `합계 ${y.sum.totalThousand}천원` : '예산 없음', `참여연구자 ${Number(y.sum.people) || 0}명`,
              y.edited ? '원문을 고침' : '', y.warnings.length ? `경고 ${y.warnings.length}` : ''].filter(Boolean).join(' · ');
      li.append(name, what);
      if (y.text) li.append(button('YAML', 'rdgYearShow', y.n, `${yearLabel(y.n)} YAML 원문을 아래 칸에 엽니다`));
      if (y.state === 'ok' || y.state === 'fail') li.append(button('다시 뽑기', 'rdgYearRedo', y.n, `같은 문서로 ${yearLabel(y.n)}만 다시 뽑습니다`));
      ul.append(li);
    }
    return ul;
  }

  /** 그 차년도의 YAML 을 아래 칸에 연다(고친 글은 칸에 적을 때마다 그 차년도에 남아 있다 — onAddInput). */
  function showYear(n) {
    const all = st.add.all;
    const y = all?.years.find((x) => x.n === n);
    if (!y?.text) return;
    all.at = n;
    A.yaml.value = y.text;
    paintAddPreview({ openYaml: true });
  }

  /** 모든 차년도에서 YAML 칸을 고치면 그 차년도의 글로 — 못 뽑은 차년도도 고친 원문이면 넣기에 든다. */
  function onAddInput(e) {
    const all = st.add.all;
    if (e.target?.id !== 'rdgYaml' || !all) return;
    const y = all.years.find((x) => x.n === all.at);
    if (!y) return;
    y.text = A.yaml.value;
    if (!y.edited) {
      y.edited = true;
      paintAddPreview();
    }
  }

  /** 카드의 일을 비운다(열린 채로) — 재료·뽑은 것·알림. 도는 일은 run 을 올려 늦게 온 답을 버린다. */
  function resetAdd() {
    st.add.run++;
    Object.assign(st.add, { material: null, text: '', sum: null, known: null, file: '', warnings: [], all: null });
    if (!A) return;
    setBusy('add', false);
    say('add', '');
    A.yaml.value = '';
    A.yamlBox.open = false;
    A.alias.value = '';
    A.alias.readOnly = false;
    A.drop.classList.remove('over');
    paintAddPreview();
  }

  /** 카드를 숨기고 상태를 비운다 — 덮개는 건드리지 않는다(직접 적기·rndpanel 이 이미 푼 때). */
  function hideAdd() {
    resetAdd();
    st.add.open = false;
    st.add.target = null;
    if (!A) return;
    A.host.classList.add('hidden');
    A.target.textContent = '';
    A.target.classList.add('hidden');
  }

  /** rndpanel 이 덮개를 닫을 때(다른 과제 칩을 누름) — 덮개는 이미 풀렸다(계약 §4.5). 혹시 아직이면 푼다. */
  function onOverlayClose() {
    hideAdd();
    if (rnd?.view?.()?.overlay === 'add') rnd.setOverlay(null);
  }

  /**
   * 더하기 카드를 연다. 대상(빈 차년도 카드의 단추 — { projectId, n })이 있으면 그 과제·차년도로 맞추고 별칭은 그 과제 것(readonly).
   * 대상이 없으면 보고 있는 과제가 있어도 대상으로 삼지 않는다(＋ 는 새 과제가 보통) — 뽑은 뒤 장부의 과제와 같으면 그 별칭을 쓴다.
   */
  function openAdd(target = {}) {
    build();
    if (!A) { rnd?.addManually?.(); return; }
    const p = projectIn(rnd.book(), target?.projectId);
    const t = p ? { projectId: p.id, n: Number(target.n) || 0 } : null;
    // 이미 같은 대상으로 열려 있으면(＋ 를 한 번 더 누름) 하던 일을 버리지 않는다.
    if (st.add.open && (st.add.target?.projectId || '') === (t?.projectId || '') && (st.add.target?.n || 0) === (t?.n || 0)) {
      A.host.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    resetAdd();
    st.add.open = true;
    st.add.target = t;
    A.target.textContent = p ? [p.alias || p.name, t.n ? yearLabel(t.n) : ''].filter(Boolean).join(' · ') : '';
    A.target.title = p ? p.name : '';
    A.target.classList.toggle('hidden', !p);
    paintStage(p, t?.n || 0);
    A.alias.value = p?.alias || '';
    A.alias.readOnly = !!p?.alias;
    A.host.classList.remove('hidden');
    rnd.setOverlay('add', onOverlayClose);
    A.host.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  /** 닫기 — 메모리의 재료를 버리고 카드를 숨기고 덮개를 푼다. */
  function closeAdd() {
    hideAdd();
    rnd?.setOverlay?.(null);
  }

  function onAddClick(e) {
    const b = e.target?.closest?.('button');
    if (!b || !A.host.contains(b) || b.disabled) return;
    if (b.dataset.rdgYearShow) showYear(Number(b.dataset.rdgYearShow));
    else if (b.dataset.rdgYearRedo) extractYears([Number(b.dataset.rdgYearRedo)]);
    else if (b.id === 'rdgAddClose' || b.id === 'rdgCancel') closeAdd();
    else if (b.id === 'rdgManual') { hideAdd(); rnd.addManually(); }   // 덮개는 rndpanel 이 (close 없이) 풀고 새 과제 폼을 연다
    else if (b.id === 'rdgRetry') extract();
    else if (b.id === 'rdgApply') applyAdd();
    else if (b.id === 'rdgSave') saveAdd(b);
  }

  function onAddChange(e) {
    if (e.target?.id !== 'rdgFile') return;
    const files = [...(e.target.files || [])];
    try { e.target.value = ''; } catch { /* 같은 파일을 다시 고를 수 있게 비우는 것뿐 */ }
    if (files.length) takeFiles(files);
  }

  /** 카드에 놓은 파일 — rndpanel.js 의 탭 전체 받기(YAML 만 받는 #rdIntake)로 가지 않게 여기서 멈춘다. */
  function onAddDrag(e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragover') {
      if (e.dataTransfer) e.dataTransfer.dropEffect = st.add.busy ? 'none' : 'copy';
      A.drop.classList.add('over');
      return;
    }
    if (e.type === 'dragleave') {
      if (!A.host.contains(e.relatedTarget || null)) A.drop.classList.remove('over');
      return;
    }
    A.drop.classList.remove('over');
    takeFiles([...(e.dataTransfer?.files || [])]);
  }

  const kindOfFile = (f) => source.docKind(f.name, f.type || '');
  const noteOf = (f) => withName(f.name, source.unsupportedDocNote(f.name, f.type || '') || '넣을 수 없는 파일입니다');

  /**
   * 고르거나 놓은 파일들 — YAML 은 rnd.intake 로 바로 넣고(들어갔고 문서가 없으면 카드를 닫고 그 과제로 간다),
   * 문서는 한 개만(둘 이상이면 첫 것만 쓰고 알린다) 읽어 뽑는다. 못 받는 파일(.hwp 등)은 까닭을 알린다.
   */
  async function takeFiles(files) {
    if (st.add.busy) { say('add', '지금 하던 일이 끝난 뒤에 넣으세요 — 그만두려면 취소', 'error'); return; }
    const kinds = files.map(kindOfFile);
    const yamls = files.filter((_, i) => kinds[i] === 'yaml');
    const docs = files.filter((_, i) => DOC_KINDS.has(kinds[i]));
    const notes = files.filter((_, i) => kinds[i] !== 'yaml' && !DOC_KINDS.has(kinds[i])).map(noteOf);
    if (docs.length > 1) notes.push(`문서는 한 번에 하나씩 뽑습니다 — ${docs[0].name} 만 씁니다`);
    if (!yamls.length && !docs.length) { say('add', notes.join(' / ') || '넣을 파일이 없습니다', 'error'); return; }
    if (yamls.length) {
      const run = ++st.add.run;
      setBusy('add', true);
      say('add', `YAML ${yamls.length}개 넣는 중…`);
      let res;
      try {
        const texts = [];
        for (const f of yamls) texts.push({ name: f.name, text: await f.text() });
        res = await rnd.intake(texts, { source: 'file' });
      } catch (err) {
        res = { ok: false, error: err?.message || String(err), lines: [], results: [] };
      }
      if (run !== st.add.run) return;
      setBusy('add', false);
      const lines = (res?.lines || []).join(' / ');
      if (!res?.ok) say('add', [lines, res?.error || '넣지 못했습니다', ...notes].filter(Boolean).join(' / '), 'error');
      else say('add', [lines || 'YAML 을 넣었습니다', ...notes].join(' / '));
      const hit = res?.ok ? (res.results || []).find((r) => r.applied && r.projectId) : null;
      if (hit && !docs.length) {
        closeAdd();
        rnd.pick(hit.projectId, hit.n);
        return;
      }
      if (!docs.length) return;
    }
    await readAndExtract(docs[0], notes);
  }

  /** 문서 한 개 → 재료(source.readDocument — 카드가 닫힐 때까지 메모리에 둔다) → 뽑기. */
  async function readAndExtract(f, notes = []) {
    if (!hasAi(ai())) {
      say('add', [NEED_AI, ...notes].join(' / '), 'error');
      return;
    }
    const run = ++st.add.run;
    Object.assign(st.add, { material: null, text: '', sum: null, known: null, file: '', warnings: [], all: null });
    A.yaml.value = '';
    paintAddPreview();
    setBusy('add', true);
    say('add', `${f.name} 읽는 중 — 사업계획서에서 KR 블록이 든 쪽을 고릅니다`);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const material = await source.readDocument({ name: f.name, type: f.type || '', bytes }, { engines });
      if (run !== st.add.run) return;
      st.add.material = notes.length ? { ...material, warnings: [...(material.warnings || []), ...notes] } : material;
    } catch (err) {
      if (run !== st.add.run) return;
      setBusy('add', false);
      const why = withName(f.name, err?.message || String(err));
      say('add', why, 'error');
      logEvent('rnd', false, `R&D 스냅샷 뽑기 실패: ${why}`, { file: f.name });
      paintAddPreview();
      return;
    }
    setBusy('add', false);
    paintAddPreview();
    await extract();
  }

  /** 뽑기 앞 — 재료가 있고 실을 것이 있고 Claude 가 이어져 있는가. 아니면 알리고 null, 맞으면 ai() 의 값. */
  function readyToAsk() {
    const material = st.add.material;
    if (!material) { say('add', '먼저 사업계획서를 넣으세요', 'error'); return null; }
    if (!usable(material)) {
      // 읽기는 됐으나 실을 것이 없다 — 몇 분을 기다려 빈 답을 받지 않게 묻지 않고, 까닭(material.warnings)을 알린다.
      const why = `${material.name}: Claude 에게 줄 글자도 붙일 PDF 도 없어 뽑지 않았습니다 — ${(material.warnings || []).join(' / ') || '글자를 읽지 못했습니다'}`;
      say('add', why, 'error');
      logEvent('rnd', false, `R&D 스냅샷 뽑기 실패: ${why}`, { file: material.name });
      return null;
    }
    const a = ai();
    if (!hasAi(a)) { say('add', NEED_AI, 'error'); return null; }
    return a;
  }

  /**
   * 한 차년도 묻기 — askExtract → checkExtracted → (스냅샷 꼴이면) finalizeExtracted · summarizeSnapshot. 그사이 닫히거나 새 일이 시작되면(live() 가 거짓) null.
   * stage 가 null(자동)이면 답의 stage 로 검사한다. 꼴이 아닌 답은 ok:false 로 돌려주고, 던지는 것은 묻기·마무리의 실패뿐이다.
   */
  async function askOne(material, { stage, t, target, docs, a, live }) {
    const project = target ? { name: target.name, code: target.code, alias: target.alias, start: target.start, end: target.end, calendar: !!target.calendar } : null;
    const out = await llm.askExtract(material, { today: t, stage, project, currentStage: target ? currentYear(target, t) : null, docs }, { ai: a });
    if (!live()) return null;
    const data = out?.data || {};
    const raw = str(data.yaml);
    // 차년도 — 고른 것, 없으면 LLM 이 적은 stage. 둘 다 없고 meta.차년도 도 없으면 checkExtracted 가 문제로 친다.
    const want = stage || (Number.isInteger(Number(data.stage)) && Number(data.stage) >= 1 ? Number(data.stage) : null);
    const chk = await yaml.checkExtracted(raw, { stage: want });
    if (!live()) return null;
    const warnings = uniq([...(chk.warnings || []), ...splitWarn(data.warnings)]);
    if (!chk.ok) return { ok: false, out, data, raw, chk, warnings };
    const n = want || chk.snap?.n || 1;
    const fin = await yaml.finalizeExtracted(raw, { stage: n, today: t, source: material.name });
    if (!live()) return null;
    return { ok: true, out, data, raw, chk, warnings, n, fin, sum: yaml.summarizeSnapshot(fin.obj) };
  }

  /** 메모리의 재료로 뽑는다(다시 뽑기도 이것 — 차년도 고르기의 지금 값으로). "모든 차년도" 면 extractYears. */
  async function extract() {
    const material = st.add.material;
    if (!A || st.add.busy) return;
    const a = readyToAsk();
    if (!a) return;
    if (A.stage.value === ALL) { await extractYears(null); return; }
    const run = ++st.add.run;
    const live = () => run === st.add.run;
    const stage = Number(A.stage.value) || null;
    const t = today();
    const target = projectIn(rnd.book(), st.add.target?.projectId);
    Object.assign(st.add, { text: '', sum: null, known: null, file: '', warnings: [], all: null });
    A.yaml.value = '';
    paintAddPreview();
    setBusy('add', true);
    startTick('add', ASKING_EXTRACT);
    try {
      const docs = await llm.loadSkillDocs(readAssetFn);
      if (!live()) return;
      const r = await askOne(material, { stage, t, target, docs, a, live });
      if (!r) return;
      const { out, data, raw, chk } = r;
      const warnings = uniq([...r.warnings, ...(material.warnings || [])]);
      if (!r.ok) {
        // 원문은 YAML 칸에 펴 둔다 — 사람이 고쳐 넣기를 누를 수 있게.
        const guess = chk.snap?.project?.name || material.name.replace(/\.[^.]+$/, '');
        Object.assign(st.add, { text: raw, file: raw ? yaml.fileName({ name: guess }, { rev: 'r0' }) : '', warnings });
        A.yaml.value = raw;
        setBusy('add', false);
        paintAddPreview({ openYaml: !!raw });
        const why = `뽑은 YAML 이 스냅샷 꼴이 아닙니다 — ${(chk.problems || []).join(' / ') || '까닭 모름'}`;
        say('add', raw ? `${why} · 아래 YAML 원문을 고쳐 넣기를 누를 수 있습니다` : why, 'error');
        logEvent('rnd', false, `R&D 스냅샷 뽑기 실패: ${why}`, { file: material.name, via: out?.via, costUsd: out?.costUsd });
        return;
      }
      const { n, fin, sum } = r;
      const book = rnd.book();
      const known = findProject(book, { code: sum.code, name: sum.name });
      if (target && known?.id !== target.id) warnings.push(`고른 과제(${target.alias || target.name})와 과제명·과제번호가 달라 ${known ? `${known.alias || known.name} 과제` : '새 과제'}로 들어갑니다`);
      Object.assign(st.add, { text: fin.text, sum, known, file: yaml.fileName({ name: sum.name }, { rev: sum.rev }), warnings });
      A.yaml.value = fin.text;
      A.alias.value = known ? known.alias || str(data.alias) : str(data.alias);
      A.alias.readOnly = !!known?.alias;
      setBusy('add', false);
      paintAddPreview();
      const label = `${sum.name} ${yearLabel(sum.n || n)}`;
      say('add', `뽑았습니다 — ${label} · ${viaText(out)}. 확인하고 넣기를 누르세요${out?.note ? ` (${out.note})` : ''}`);
      logEvent('rnd', true, `R&D 사업계획서에서 스냅샷 뽑음 — ${label} (${viaText(out)})`, { file: material.name, via: out?.via, costUsd: out?.costUsd });
    } catch (err) {
      if (run !== st.add.run) return;
      setBusy('add', false);
      paintAddPreview();
      const why = err?.message || String(err);
      say('add', `스냅샷을 뽑지 못했습니다 — ${why}`, 'error');
      logEvent('rnd', false, `R&D 스냅샷 뽑기 실패: ${why}`, { file: material.name });
    } finally {
      if (run === st.add.run && st.add.busy) setBusy('add', false);
    }
  }

  /** 모든 차년도의 줄 — 있으면 그것, 없으면 기다림으로 만들어 차례 자리에. */
  function yearOf(all, n) {
    let y = all.years.find((x) => x.n === n);
    if (!y) {
      y = blankYear(n);
      all.years.push(y);
      all.years.sort((p, q) => p.n - q.n);
    }
    return y;
  }

  /**
   * 모든 차년도(stages 가 null) 또는 그 차년도들만 다시(stages: [n] — 줄의 다시 뽑기) — 같은 재료로 차년도마다 한 번씩 **차례로** 묻는다
   * (로컬 CLI 를 여럿 띄우거나 API 한도에 걸리지 않게 한 번에 하나). 몇 차년도까지: 대상 과제(빈 차년도 카드)의 연구기간이 있으면 그것으로 시작하고,
   * 처음 읽힌 답의 meta.연차범위 · 연차별기간 · 기간(yaml.stageCount)이 있으면 그것을 따른다(문서가 이긴다). 둘 다 모르면 1차년도만 뽑고 알린다.
   * 한 차년도가 실패해도 다음 차년도로 간다. 끝나면 알림 한 줄·활동 로그 한 줄.
   */
  async function extractYears(stages = null) {
    const material = st.add.material;
    if (!A || st.add.busy) return;
    const fresh = !stages;
    if (!fresh && !st.add.all) return;
    const a = readyToAsk();
    if (!a) return;
    const run = ++st.add.run;
    const live = () => run === st.add.run;
    const t = today();
    const target = projectIn(rnd.book(), st.add.target?.projectId);
    if (fresh) {
      const total = target?.start ? yearsOf(target).length : 0;
      Object.assign(st.add, { text: '', sum: null, known: null, file: '', warnings: [], all: { total, counted: false, at: 0, years: [] } });
      for (let k = 1; k <= total; k++) yearOf(st.add.all, k);
      A.yaml.value = '';
      A.yamlBox.open = false;
    }
    const all = st.add.all;
    const outs = [];
    const asked = [];
    setBusy('add', true);
    paintAddPreview();
    try {
      const docs = await llm.loadSkillDocs(readAssetFn);
      if (!live()) return;
      for (let i = 0; fresh ? i < Math.max(all.total, 1) : i < stages.length; i++) {
        const k = fresh ? i + 1 : stages[i];
        const y = yearOf(all, k);
        Object.assign(y, { state: 'asking', error: '' });
        paintAddPreview();
        startTick('add', `${ASKING_ALL} · ${yearLabel(k)}${fresh ? ` (${k}/${all.total || '?'})` : ''}`);
        let r = null;
        try {
          r = await askOne(material, { stage: k, t, target, docs, a, live });
          if (!r) return;
        } catch (err) {
          if (!live()) return;
          Object.assign(y, { state: 'fail', text: '', sum: null, warnings: [], error: err?.message || String(err), alias: '', edited: false });
        }
        if (r) {
          outs.push(r.out);
          if (r.ok) Object.assign(y, { state: 'ok', text: r.fin.text, sum: r.sum, warnings: r.warnings, error: '', alias: str(r.data.alias), edited: false });
          else Object.assign(y, { state: 'fail', text: r.raw, sum: null, warnings: r.warnings, error: `스냅샷 꼴이 아닙니다 — ${(r.chk.problems || []).join(' / ') || '까닭 모름'}`, alias: '', edited: false });
          // 몇 차년도까지 — 처음 읽힌 답의 것. 줄어들면 아직 묻지 않은 뒤쪽 줄을 거두고, 늘면 기다림 줄을 더한다.
          const c = fresh && !all.counted ? yaml.stageCount(r.ok ? r.fin.obj : r.chk?.obj) : 0;
          if (c) {
            all.counted = true;
            all.total = c;
            all.years = all.years.filter((x) => x.n <= c || x.state !== 'wait');
            for (let j = 1; j <= c; j++) yearOf(all, j);
          }
        }
        asked.push(y);
        // YAML 칸 — 아직 연 차년도가 없으면 처음 글이 온 차년도를, 열어 둔 차년도를 다시 뽑았으면 새 글을.
        if (y.text && (!all.at || all.at === k)) {
          all.at = k;
          A.yaml.value = y.text;
        }
        paintAddPreview();
      }
    } catch (err) {
      if (!live()) return;
      setBusy('add', false);
      for (const y of all.years) if (y.state === 'asking') y.state = 'wait';
      paintAddPreview();
      const why = err?.message || String(err);
      say('add', `스냅샷을 뽑지 못했습니다 — ${why}`, 'error');
      logEvent('rnd', false, `R&D 스냅샷 뽑기 실패: ${why}`, { file: material.name });
      return;
    } finally {
      if (live() && st.add.busy) setBusy('add', false);
    }
    if (!live()) return;
    finishYears({ fresh, asked, outs, target, material });
  }

  /** 모든 차년도 묻기가 끝남 — 넣을 곳(장부의 과제)·별칭·공통 경고, 알림 한 줄, 활동 로그 한 줄. */
  function finishYears({ fresh, asked, outs, target, material }) {
    const all = st.add.all;
    const first = all.years.find((y) => y.state === 'ok');
    const known = first ? findProject(rnd.book(), { code: first.sum.code, name: first.sum.name }) : null;
    const common = [...(material.warnings || [])];
    if (target && first && known?.id !== target.id) common.push(`고른 과제(${target.alias || target.name})와 과제명·과제번호가 달라 ${known ? `${known.alias || known.name} 과제` : '새 과제'}로 들어갑니다`);
    if (fresh && !all.counted && !target?.start) common.push('몇 차년도까지인지 읽지 못해 1차년도만 뽑았습니다 — 표지의 연차별 연구개발기간을 확인하거나, 차년도를 골라 하나씩 뽑으세요');
    const others = all.years.filter((y) => y.state === 'ok' && !sameProject(y.sum, first.sum));
    if (others.length) common.push(`${yearsText(others)}의 과제명·과제번호가 ${yearLabel(first.n)}와 달라 넣지 않습니다 — YAML 원문의 meta.과제명·연구개발과제번호를 맞추거나 그 차년도를 다시 뽑으세요`);
    Object.assign(st.add, { known, warnings: uniq(common) });
    if (first && (fresh || !A.alias.value.trim())) {
      A.alias.value = known ? known.alias || first.alias : first.alias;
      A.alias.readOnly = !!known?.alias;
    }
    paintAddPreview();
    const got = asked.filter((y) => y.state === 'ok');
    const failed = asked.filter((y) => y.state !== 'ok');
    const via = viaOfAll(outs);
    const notes = uniq(outs.map((o) => str(o?.note)));
    const name = first?.sum.name || material.name;
    const data = { file: material.name, via: via.via, ...(via.costUsd != null ? { costUsd: via.costUsd } : {}) };
    if (!got.length) {
      const why = failed.map((y) => `${yearLabel(y.n)}: ${y.error}`).join(' / ') || '까닭 모름';
      say('add', `스냅샷을 뽑지 못했습니다 — ${why}${failed.some((y) => y.text) ? ' · 그 줄의 YAML 로 원문을 열어 고치면 넣을 수 있습니다' : ''}`, 'error');
      logEvent('rnd', false, `R&D 스냅샷 뽑기 실패: ${fresh ? '모든 차년도' : yearsText(failed)} — ${why}`, data);
      return;
    }
    say('add', `뽑았습니다 — ${name} ${yearsText(got)}${via.text ? ` · ${via.text}` : ''}${failed.length ? ` · ${yearsText(failed)}는 뽑지 못했습니다(그 줄의 다시 뽑기)` : ''}. 확인하고 넣기를 누르세요${notes.length ? ` (${notes.join(', ')})` : ''}`);
    logEvent('rnd', true, `R&D 사업계획서에서 ${fresh ? '모든 차년도 ' : ''}스냅샷 뽑음 — ${name} ${yearsText(got)}${failed.length ? ` · 못 뽑음 ${yearsText(failed)}` : ''}${via.text ? ` (${via.text})` : ''}`, { ...data, stages: got.map((y) => y.n) });
  }

  /**
   * 모든 차년도 넣기 — 넣을 차년도(readyYears)마다 칸의 글을 다시 풀어 스냅샷인지·같은 과제인지 보고, 별칭을 검사하고, 한 번의 rnd.intake 로 넣는다
   * (이름은 "N차년도/KR_<과제>.yaml" — rndgen/index.js 가 원문을 차년도마다 짝지어 남긴다). 하나라도 들어갔으면 닫고 그 과제의 오늘이 든 차년도(없으면 처음 넣은 차년도)로.
   */
  async function applyAll() {
    const ys = readyYears(st.add.all);
    if (!ys.length) { say('add', '넣을 차년도가 없습니다 — 먼저 사업계획서에서 뽑으세요', 'error'); return; }
    const run = ++st.add.run;
    setBusy('add', true);
    say('add', `${yearsText(ys)} 넣는 중…`);
    try {
      const texts = [];
      let head = null;
      for (const y of ys) {
        const parsed = await yaml.parseYaml(y.text);
        if (!parsed?.ok) throw new Error(`${yearLabel(y.n)}: YAML 을 읽지 못했습니다 — ${parsed?.error || ''}`);
        if (kindOf(parsed.obj) !== 'snapshot') throw new Error(`${yearLabel(y.n)}: 스냅샷 YAML 이 아닙니다 — meta.과제명 이 있어야 합니다`);
        const sum = yaml.summarizeSnapshot(parsed.obj);
        head ||= { ...sum, n: sum.n || y.n };
        if (!sameProject(sum, head)) throw new Error(`${yearLabel(y.n)}: 과제명·과제번호가 ${yearLabel(head.n)}와 다릅니다 — YAML 원문의 meta.과제명·연구개발과제번호를 맞추세요`);
        texts.push({ name: `${yearLabel(sum.n || y.n)}/${yaml.fileName({ name: sum.name }, { rev: sum.rev })}`, text: y.text.trim() });
      }
      const book = rnd.book();
      const known = findProject(book, { code: head.code, name: head.name });
      const alias = known?.alias || A.alias.value.trim();
      if (!known?.alias) {
        if (!alias) { A.alias.focus?.(); throw new Error('별칭을 적으세요 — 예) SSCB'); }
        const owner = aliasOwner(book, alias, known?.id || '');
        if (owner) { A.alias.focus?.(); throw new Error(`같은 별칭의 과제가 있습니다 — ${owner.name}`); }
      }
      const res = await rnd.intake(texts, { source: 'extract' });
      if (run !== st.add.run) return;
      const results = res?.results || [];
      const applied = results.filter((r) => r.applied && r.projectId);
      if (!applied.length) throw new Error(res?.error || results.map((r) => `${r.label}: ${r.summary}`).join(' / ') || '넣지 못했습니다');
      const pid = applied[0].projectId;
      const p = projectIn(rnd.book(), pid);
      if (p && !p.alias && alias) {
        const set = rnd.setAlias(pid, alias);
        if (!set?.ok) logEvent('rnd', false, `R&D 별칭 붙이기 실패: ${set?.error || alias}`);
      }
      const cur = p ? currentYear(p, today()) : 0;
      closeAdd();
      rnd.pick(pid, applied.some((r) => r.n === cur) ? cur : applied[0].n);
    } catch (err) {
      if (run !== st.add.run) return;
      setBusy('add', false);
      say('add', err?.message || String(err), 'error');
    } finally {
      if (run === st.add.run && st.add.busy) setBusy('add', false);
    }
  }

  /** 모든 차년도 저장 — 넣을 차년도를 스킬의 연차 폴더 꼴(N차년도/KR_<과제>.yaml)로 담은 zip 하나. */
  async function saveAll(btn) {
    const ys = readyYears(st.add.all);
    if (!ys.length) { say('add', 'YAML 이 비었습니다', 'error'); return; }
    const head = st.add.all.years.find((y) => y.state === 'ok')?.sum;
    const base = yaml.fileName({ name: head?.name || str(st.add.material?.name).replace(/\.[^.]+$/, '') });
    try {
      const bytes = buildZip(ys.map((y) => ({ name: `${yearLabel(y.n)}/${base}`, data: y.text })));
      await downloadFn(bytes, base.replace(/\.yaml$/, '_모든차년도.zip'), 'application/zip');
      flash(btn, '저장됨 ✓');
    } catch (err) {
      say('add', `저장하지 못했습니다 — ${err?.message || err}`, 'error');
    }
  }

  /** 넣기 — YAML 칸의 글(사람이 고쳤을 수 있다)을 다시 풀어 스냅샷인지·별칭을 보고 rnd.intake → 별칭 → 닫고 그 과제·차년도로. */
  async function applyAdd() {
    if (st.add.busy) return;
    if (st.add.all) { await applyAll(); return; }
    const text = A.yaml.value.trim();
    if (!text) { say('add', 'YAML 이 비었습니다 — 먼저 사업계획서에서 뽑으세요', 'error'); return; }
    const run = ++st.add.run;
    setBusy('add', true);
    say('add', '넣는 중…');
    try {
      const parsed = await yaml.parseYaml(text);
      if (!parsed?.ok) throw new Error(`YAML 을 읽지 못했습니다 — ${parsed?.error || ''}`);
      if (kindOf(parsed.obj) !== 'snapshot') throw new Error('스냅샷 YAML 이 아닙니다 — meta.과제명 이 있어야 합니다');
      const sum = yaml.summarizeSnapshot(parsed.obj);
      const book = rnd.book();
      const known = findProject(book, { code: sum.code, name: sum.name });
      const alias = known?.alias || A.alias.value.trim();
      if (!known?.alias) {
        if (!alias) { A.alias.focus?.(); throw new Error('별칭을 적으세요 — 예) SSCB'); }
        const owner = aliasOwner(book, alias, known?.id || '');
        if (owner) { A.alias.focus?.(); throw new Error(`같은 별칭의 과제가 있습니다 — ${owner.name}`); }
      }
      const res = await rnd.intake([{ name: yaml.fileName({ name: sum.name }, { rev: sum.rev }), text }], { source: 'extract' });
      if (run !== st.add.run) return;
      const r = res?.results?.[0];
      if (!res?.ok || !r) throw new Error(res?.error || '넣지 못했습니다');
      if (!r.applied) throw new Error(`${r.label}: ${r.summary}`);
      const p = projectIn(rnd.book(), r.projectId);
      if (p && !p.alias && alias) {
        const set = rnd.setAlias(r.projectId, alias);
        if (!set?.ok) logEvent('rnd', false, `R&D 별칭 붙이기 실패: ${set?.error || alias}`);
      }
      closeAdd();
      rnd.pick(r.projectId, r.n);
    } catch (err) {
      if (run !== st.add.run) return;
      setBusy('add', false);
      say('add', err?.message || String(err), 'error');
    } finally {
      if (run === st.add.run && st.add.busy) setBusy('add', false);
    }
  }

  async function saveAdd(btn) {
    if (st.add.all) { await saveAll(btn); return; }
    const text = A.yaml.value;
    if (!text.trim()) { say('add', 'YAML 이 비었습니다', 'error'); return; }
    try {
      await downloadFn(text, st.add.file || 'KR_스냅샷.yaml', 'text/yaml');
      flash(btn, '저장됨 ✓');
    } catch (err) {
      say('add', `저장하지 못했습니다 — ${err?.message || err}`, 'error');
    }
  }

  /* ---------------------------------------------------------- 변경 및 이력 관리 카드의 YAML 고치기 */

  /** 저장된 YAML 원문(rndYamlText)을 한 번 읽는다 — 기다리지 않고, 끝나면 기준 줄을 다시 그린다. */
  function loadStore() {
    st.loading ||= (async () => {
      try {
        await store.load();
      } catch {
        // 못 읽으면 저장된 원문이 없는 것으로 — 기준은 장부로 짓는다
      }
      st.loaded = true;
      paintRevise();
    })();
    return st.loading;
  }

  function savedEntry(project, n) {
    if (!st.loaded || !project) return null;
    try {
      const e = store.get(project.id, n);
      return e && typeof e.text === 'string' && e.text.trim() ? e : null;
    } catch {
      return null;
    }
  }

  /** 장부 화면이 바뀔 때마다(rndpanel paintAll 끝) — 보일 조건과 기준 줄. 과제·차년도가 바뀌면 입력·미리보기를 비운다. */
  function onView(view) {
    build();
    st.view = view || null;
    const p = view?.project || null;
    if (p && !st.loading) loadStore();
    // 폼·덮개 동안 과제가 비어 오면(과제 없음에서 새 과제) 하던 글을 둔다.
    const key = p ? `${p.id}:${view.n}` : view?.editing || view?.overlay ? st.rev.key : '';
    if (key !== st.rev.key) {
      resetRev();
      st.rev.key = key;
    }
    paintRevise();
  }

  function paintRevise() {
    if (!R) return;
    const v = st.view;
    const show = !!(v?.project && !v.editing && !v.overlay && !v.yearEmpty);
    R.host.classList.toggle('hidden', !show);
    if (!v?.project) return;
    const saved = savedEntry(v.project, v.n);
    R.base.textContent = !st.loaded ? '기준: 저장된 YAML 을 찾는 중…'
      : saved ? `기준: 저장된 YAML ${saved.rev || '(판 없음)'}${mmdd(saved.at) ? ` · ${mmdd(saved.at)}` : ''}` : LOSSY_BASE;
    R.base.title = saved?.file || '';
    R.base.classList.toggle('lossy', st.loaded && !saved);
    paintRevButtons();
  }

  function paintRevButtons() {
    if (!R) return;
    const { busy, result } = st.rev;
    R.fileIn.disabled = busy;
    R.go.disabled = busy;
    R.apply.disabled = busy || !result;
    R.save.disabled = busy || !result;
    for (const b of R.files.querySelectorAll('button')) b.disabled = busy;
  }

  function paintFiles() {
    if (!R) return;
    const doc = R.host.ownerDocument;
    R.files.replaceChildren(...st.rev.files.map((f, i) => {
      const chip = doc.createElement('span');
      chip.className = 'rdg-file';
      const name = doc.createElement('span');
      name.textContent = f.name;
      name.title = f.name;
      const x = doc.createElement('button');
      x.type = 'button';
      x.dataset.rdgUnfile = String(i);
      x.setAttribute('aria-label', `${f.name} 빼기`);
      x.title = '빼기';
      x.textContent = '×';
      chip.append(name, x);
      return chip;
    }));
    paintRevButtons();
  }

  function clearRevPreview() {
    st.rev.result = null;
    if (!R) return;
    R.preview.classList.add('hidden');
    R.summary.textContent = '';
    R.diff.replaceChildren();
    R.changelog.replaceChildren();
    R.warn.textContent = '';
    R.yaml.value = '';
    R.yamlBox.open = false;
    paintRevButtons();
  }

  /** 과제·차년도가 바뀜 — 입력(변경 글·붙인 문서)·미리보기·알림을 비우고, 도는 일의 답은 버린다. */
  function resetRev() {
    st.rev.run++;
    st.rev.files = [];
    if (!R) { st.rev.result = null; return; }
    setBusy('rev', false);
    R.change.value = '';
    R.card.classList.remove('over');
    say('rev', '');
    clearRevPreview();
    paintFiles();
  }

  function paintRevPreview() {
    const doc = R.host.ownerDocument;
    const r = st.rev.result;
    const li = (text) => { const x = doc.createElement('li'); x.textContent = text; return x; };
    R.summary.textContent = `${r.summary} · 다음 판 ${r.rev}`;
    R.diff.replaceChildren(...(r.diff.length ? r.diff.map(li) : [li('바뀐 값이 없습니다')]));
    R.changelog.replaceChildren(...(r.changes.length
      ? r.changes.map((c) => li([dot(c.date) || '날짜 없음', c.kind, c.item, `${str(c.before) || '(없음)'} → ${str(c.after) || '(없음)'}`, str(c.reason)].filter(Boolean).join(' · ')))
      : [li('새로 남을 변경이력이 없습니다')]));
    R.warn.textContent = r.warnings.join('\n');
    R.preview.classList.remove('hidden');
    paintRevButtons();
  }

  function onRevClick(e) {
    const b = e.target?.closest?.('button');
    if (!b || !R.host.contains(b) || b.disabled) return;
    if (b.dataset.rdgUnfile != null) {
      st.rev.files.splice(Number(b.dataset.rdgUnfile), 1);
      paintFiles();
      return;
    }
    if (b.id === 'rdgReviseGo') revise();
    else if (b.id === 'rdgRevApply') applyRev();
    else if (b.id === 'rdgRevSave') saveRev(b);
    else if (b.id === 'rdgRevCancel') { clearRevPreview(); say('rev', ''); }
  }

  function onRevChange(e) {
    if (e.target?.id !== 'rdgChangeFile') return;
    const files = [...(e.target.files || [])];
    try { e.target.value = ''; } catch { /* 같은 파일을 다시 고를 수 있게 */ }
    if (files.length) attach(files);
  }

  /** 카드에 놓은 문서는 붙인다. YAML 만 놓았으면 막지 않는다 — rndpanel.js 의 YAML 넣기(탭 어디에 놓아도 그리로)가 받는다. */
  function onRevDrag(e) {
    if (!hasFiles(e)) return;
    if (e.type === 'drop') {
      const files = [...(e.dataTransfer?.files || [])];
      R.card.classList.remove('over');
      if (files.length && files.every((f) => kindOfFile(f) === 'yaml')) return;
      e.preventDefault();
      e.stopPropagation();
      if (st.rev.busy) say('rev', '지금 하던 일이 끝난 뒤에 붙이세요', 'error');
      else attach(files);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragleave') {
      if (!R.host.contains(e.relatedTarget || null)) R.card.classList.remove('over');
      return;
    }
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    R.card.classList.add('over');
  }

  function attach(files) {
    const notes = [];
    let added = 0;
    for (const f of files) {
      const kind = kindOfFile(f);
      if (kind === 'yaml') { notes.push(`${f.name}: YAML 은 붙일 문서가 아닙니다 — ＋(과제 더하기)나 아래 연구개발계획서 YAML 넣기 칸에 넣으세요`); continue; }
      if (!DOC_KINDS.has(kind)) { notes.push(noteOf(f)); continue; }
      if (st.rev.files.some((x) => x.name === f.name && x.size === f.size)) continue;
      if (st.rev.files.length >= MAX_CHANGE_FILES) { notes.push(`문서는 ${MAX_CHANGE_FILES}개까지 붙입니다 — ${f.name} 은 뺐습니다`); continue; }
      st.rev.files.push(f);
      added++;
    }
    paintFiles();
    if (notes.length) say('rev', notes.join(' / '), 'error');
    else if (added) say('rev', `붙인 문서 ${st.rev.files.length}개 — YAML 고치기를 누르면 글자를 읽어 변경 글과 함께 보냅니다`);
  }

  /**
   * YAML 고치기 — 기준(저장된 원문, 없으면 장부로 지은 것) + 변경 글 + 붙인 문서의 글자 → llm.askRevise → 다음 판 · 머리 주석 마무리
   * → 구조 차이와 새로 남을 변경이력 미리보기. 실패해도 변경 글·붙인 문서는 둔다.
   */
  async function revise() {
    const v = st.view;
    if (!R || !v?.project || st.rev.busy) return;
    const text = R.change.value.trim();
    const files = [...st.rev.files];
    if (!text && !files.length) { say('rev', '바뀐 내용을 적거나 문서를 붙이세요', 'error'); R.change.focus?.(); return; }
    const a = ai();
    if (!hasAi(a)) { say('rev', NEED_AI, 'error'); return; }
    const run = ++st.rev.run;
    const key = st.rev.key;
    const { project, n } = v;
    const t = today();
    clearRevPreview();
    setBusy('rev', true);
    startTick('rev', ASKING_REVISE);
    try {
      await loadStore();
      const saved = savedEntry(project, n);
      let baseText = saved?.text || '';
      const lossy = !baseText;
      if (lossy) baseText = (await yaml.bookToSnapshot(rnd.book(), project, n, { today: t })).text;
      const base = await yaml.parseYaml(baseText);
      if (!base?.ok) throw new Error(`기준 YAML 을 읽지 못했습니다 — ${base?.error || ''}`);
      const baseRev = str(base.obj?.meta?.rev) || str(v.snapshot?.rev);
      const materials = [];
      for (const f of files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const m = await source.readDocument({ name: f.name, type: f.type || '', bytes }, { engines });
        materials.push({ ...m, file: null });   // 글자만 — 붙인 문서는 PDF 로 보내지 않는다
      }
      if (run !== st.rev.run) return;
      const out = await llm.askRevise({
        baseYaml: baseText, text, materials, today: t, project: { name: project.name, code: project.code, alias: project.alias }, n, rev: baseRev,
      }, { ai: a });
      if (run !== st.rev.run) return;
      const data = out?.data || {};
      const raw = str(data.yaml);
      const got = await yaml.parseYaml(raw);
      if (!got?.ok) throw new Error(`고친 YAML 을 읽지 못했습니다 — ${got?.error || ''}`);
      const rev = yaml.nextRev(saved?.rev, v.snapshot?.rev, baseRev, got.obj?.meta?.rev);
      const summary = str(data.summary) || '변경사항 반영';
      const fin = await yaml.finalizeRevised(raw, { rev, today: t, summary });
      // meta.rev 는 코드가 적는 판 번호라 늘 바뀐다 — 차이 목록에서는 빼고 요약 줄의 "다음 판" 으로 보인다.
      const diff = (await yaml.diffYaml(base.obj, fin.obj)).filter((d) => d.path !== 'meta.rev');
      const file = yaml.fileName(project, { rev });
      const pre = await yaml.previewApply(rnd.book(), fin.obj, { text: fin.text, file, today: t, current: project, n });
      if (run !== st.rev.run || key !== st.rev.key) return;
      const warnings = uniq([
        lossy ? '기준이 장부로 지은 YAML 이라 장부에 없던 블록(성과지표·외주용역 …)은 빠져 있습니다 — 원문 YAML 을 넣어 두면 정확합니다' : '',
        ...splitWarn(data.warnings),
        ...materials.flatMap((m) => m.warnings || []),
        !diff.length && Array.isArray(data.changes) && data.changes.length ? 'Claude 가 바꿨다고 한 곳이 YAML 에서 보이지 않습니다 — 원문을 확인하세요' : '',
        pre && !pre.ok ? `미리 넣어 보지 못했습니다 — ${pre.error}` : '',
        pre?.older ? `이 차년도에는 이미 ${pre.older} 가 들어 있어 반영해도 넣지 않습니다` : '',
      ]);
      st.rev.result = { text: fin.text, rev, summary, file, diff: yaml.diffLines(diff), changes: pre?.changes || [], warnings };
      R.yaml.value = fin.text;
      setBusy('rev', false);
      paintRevPreview();
      say('rev', `고쳤습니다 — ${summary} (다음 판 ${rev}) · ${viaText(out)}. 미리보기를 보고 반영을 누르세요${out?.note ? ` (${out.note})` : ''}`);
      logEvent('rnd', true, `R&D YAML 고침 — ${project.alias || project.name} ${yearLabel(n)} ${rev}: ${summary} (${viaText(out)})`, { file, via: out?.via, costUsd: out?.costUsd, rev });
    } catch (err) {
      if (run !== st.rev.run) return;
      setBusy('rev', false);
      const why = err?.message || String(err);
      say('rev', `YAML 을 고치지 못했습니다 — ${why}`, 'error');
      logEvent('rnd', false, `R&D YAML 고치기 실패: ${why}`);
    } finally {
      if (run === st.rev.run && st.rev.busy) setBusy('rev', false);
    }
  }

  /** 반영 — YAML 칸의 글로 rnd.intake(source 'revise'). 들어가면 미리보기·입력을 비운다(저장은 index.js 의 훅). */
  async function applyRev() {
    const r = st.rev.result;
    if (!r || st.rev.busy) return;
    const text = R.yaml.value.trim();
    if (!text) { say('rev', 'YAML 이 비었습니다', 'error'); return; }
    const run = ++st.rev.run;
    setBusy('rev', true);
    say('rev', '반영하는 중…');
    try {
      const res = await rnd.intake([{ name: r.file, text }], { source: 'revise', summary: r.summary });
      if (run !== st.rev.run) return;
      const hit = res?.results?.[0];
      if (!res?.ok || !hit) throw new Error(res?.error || '반영하지 못했습니다');
      if (!hit.applied) throw new Error(`${hit.label}: ${hit.summary}`);
      R.change.value = '';
      st.rev.files = [];
      clearRevPreview();
      setBusy('rev', false);
      paintFiles();
      say('rev', `반영했습니다 — ${hit.summary || r.summary}`);
      paintRevise();
    } catch (err) {
      if (run !== st.rev.run) return;
      setBusy('rev', false);
      say('rev', err?.message || String(err), 'error');
    } finally {
      if (run === st.rev.run && st.rev.busy) setBusy('rev', false);
    }
  }

  async function saveRev(btn) {
    const r = st.rev.result;
    const text = R.yaml.value;
    if (!r || !text.trim()) return;
    try {
      await downloadFn(text, r.file, 'text/yaml');
      flash(btn, '저장됨 ✓');
    } catch (err) {
      say('rev', `저장하지 못했습니다 — ${err?.message || err}`, 'error');
    }
  }

  /** 검사·통합용 — 지금 상태의 사본(재료·파일은 이름만). */
  function state() {
    const s = st.add;
    const r = st.rev;
    return {
      wired: st.wired, loaded: st.loaded,
      add: {
        open: s.open, busy: s.busy, target: s.target ? { ...s.target } : null, material: s.material ? { name: s.material.name, kind: s.material.kind, read: s.material.read } : null,
        text: s.text, file: s.file, warnings: [...s.warnings], known: s.known ? s.known.id : '', alias: A?.alias.value || '',
        all: s.all ? {
          total: s.all.total, counted: s.all.counted, at: s.all.at,
          years: s.all.years.map((y) => ({ n: y.n, state: y.state, error: y.error, edited: y.edited, text: y.text, warnings: [...y.warnings] })),
        } : null,
      },
      revise: {
        key: r.key, busy: r.busy, visible: !!R && !R.host.classList.contains('hidden'), files: r.files.map((f) => f.name),
        result: r.result ? { rev: r.result.rev, summary: r.result.summary, file: r.result.file, text: r.result.text, diff: [...r.result.diff], changes: r.result.changes.length, warnings: [...r.result.warnings] } : null,
      },
    };
  }

  return { wire, openAdd, closeAdd, onView, state };
}
