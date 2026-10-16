// R&D 탭의 과제 더하기(＋ — YAML 넣기 또는 사업계획서에서 이 차년도 KR 스냅샷 뽑기)·변경 및 이력 관리 카드의 YAML 고치기(글·문서 → YAML)의 조립 — sidepanel.js 가 import 하는 rndgen/ 의 유일한 입구.
// 화면(panel.js)에 문서 → 재료(source.js) · LLM 입력과 묻기(llm.js) · YAML 검사·마무리·차이(yaml.js) · 원문 저장소(store.js) 를 꽂고, rndpanel.js 의 손잡이(rnd)에 잇는다.
// 화면은 이 모듈들을 import 하지 않으므로 무엇을 쓸지는 여기서만 정한다(mailtrack/index.js 꼴).
//
// 2026-10-16 사용자 지정: "sscb 버튼 누르면 그리 안감, + 누르면 Yaml 파일을 넣던지 아니면 사업계획서를 넣으면 과제의 YAML을 추출하도록 해줘. 그 스킬은 '차년도 YAML 뽑는 스킬' 거기 있지.
// 그리고 변경사항의 내용을 임의 형식으로 제공 하면 yaml 로 수정해서 업데이트 하도록 해줘."
//
// 원문 저장(chrome.storage.local 의 rndYamlText — 과제·차년도마다 지금 판 + 지난 판 다섯)은 **여기 한 곳**에서만 한다: rnd.onIntake 훅.
// 끌어 놓기·붙여 넣기(rndpanel 의 YAML 넣기 칸)·뽑기·고치기가 모두 rnd.intake 를 지나므로 어느 길로 들어온 스냅샷이든 남는다. 과제를 지우면(rnd.onDelete) 그 과제 것을 지운다.
//
// 만들기·wire() 만으로는 chrome·fetch 를 만지지 않는다 — 저장소는 처음 읽을 때 chrome.storage 를, LLM 은 사람이 누를 때 askClaude 를 본다.
// test/wiring.test.mjs 가 jsdom 에서 sidepanel.js 를 통째로 import 하므로. rnd 손잡이에 새 키(onView·onAdd·onIntake·onDelete …)가 없어도 조용히 건너뛴다.
//
//   import { createRndGen } from './rndgen/index.js';
//   const rndgen = createRndGen({ rnd, $, escapeHtml, logEvent, flash, ai: () => ({ apiKey, cli }), today: todayStr });
//   rndgen.wire();   // rnd.wire() 뒤

import { createRndGenPanel } from './panel.js';
import * as source from './source.js';
import * as llm from './llm.js';
import * as yaml from './yaml.js';
import { createYamlStore } from './store.js';
import { todayStr } from '../src/rnd.js';

/**
 * intake 결과(rndpanel 이 종류·판 차례로 정렬한 것)마다 넣은 글을 짝짓는다 — 이름이 같은 글(같은 이름이 여럿이면 차례로), 이름이 빈 것(붙여 넣기)은 이름이 빈 글.
 * 짝이 없으면 글이 하나뿐일 때만 그것.
 * @returns {Array<{ r: object, text: string }>}
 */
export function pairResults(results = [], texts = []) {
  const used = new Set();
  const out = [];
  for (const r of results) {
    let j = texts.findIndex((t, i) => !used.has(i) && String(t?.name || '') === String(r?.name || ''));
    if (j < 0 && texts.length === 1 && !used.has(0)) j = 0;
    if (j < 0) continue;
    used.add(j);
    out.push({ r, text: String(texts[j]?.text ?? '') });
  }
  return out;
}

/**
 * @param {{ rnd: object, $: (id: string) => HTMLElement|null, escapeHtml: Function, logEvent: Function, flash?: Function,
 *           ai: () => ({ apiKey?: string, cli?: boolean }), today?: () => string, now?: () => number,
 *           readAsset?: Function, download?: Function, storage?: object|Function, engines?: object }} deps
 *   rnd 는 rndpanel.js createRndPanel 의 손잡이. readAsset·download 이 없으면 rnd 의 것을(부를 때), storage 가 없으면 chrome.storage.local 을(처음 쓸 때) 쓴다.
 *   engines 는 source.readDocument 의 엔진(검사용 — 없으면 진짜 pdf.js·pdf-lib·officetext 를 쓸 때 import).
 * @returns {{ wire(): void, panel: ReturnType<typeof createRndGenPanel>, store: ReturnType<typeof createYamlStore>, saved(): Promise<void> }}
 *   saved 는 마지막 저장(onIntake·onDelete 의 store.put·remove)이 끝나기를 기다린다(검사·통합용).
 */
export function createRndGen(deps = {}) {
  const { rnd, $ = () => null, escapeHtml, logEvent = () => {}, flash, ai = () => ({}), today = todayStr, now = () => Date.now(), readAsset, download, storage, engines } = deps;
  const store = createYamlStore({ ...(storage ? { storage } : {}), now });
  const panel = createRndGenPanel({
    hosts: { add: $('rdgAdd'), revise: $('rdgRevise') },
    rnd, source, llm, yaml, store, ai, today, now, logEvent, escapeHtml, flash,
    ...(readAsset ? { readAsset } : {}), ...(download ? { download } : {}), ...(engines ? { engines } : {}),
  });
  let last = Promise.resolve();
  let wired = false;

  /** 저장·지우기 하나 — 실패해도 장부 넣기는 이미 됐으니 로그 한 줄만 남긴다. 끝나면 YAML 고치기의 기준 줄을 다시 그린다. */
  function track(job, failText) {
    const run = job.then(() => {
      if (typeof rnd?.view === 'function') panel.onView(rnd.view());
    }, (err) => {
      logEvent('rnd', false, `${failText}: ${err?.message || err}`);
    });
    last = last.then(() => run);
    return run;
  }

  /** 들어간 스냅샷마다 원문을 rndYamlText 에 — 더 오래된 판이라 장부에 넣지 않은 것(applied false)·이력 파일은 남기지 않는다. */
  function onIntake(result, texts = [], meta = {}) {
    const at = new Date(now()).toISOString();
    const jobs = pairResults(result?.results || [], texts)
      .filter(({ r, text }) => r?.kind === 'snapshot' && r.applied && r.projectId && r.n && text.trim())
      .map(({ r, text }) => store.put(r.projectId, r.n, {
        text, rev: r.rev || '', at, file: r.name || '', source: meta?.source || 'file', summary: meta?.summary || '',
      }));
    if (!jobs.length) return last;
    return track(Promise.all(jobs), 'R&D YAML 원문 저장 실패');
  }

  function onDelete(projectId) {
    if (!projectId) return last;
    return track(store.remove(projectId), 'R&D YAML 원문 지우기 실패');
  }

  function wire() {
    if (wired) return;
    wired = true;
    panel.wire();
    if (typeof rnd?.onIntake === 'function') rnd.onIntake(onIntake);
    if (typeof rnd?.onDelete === 'function') rnd.onDelete(onDelete);
  }

  return { wire, panel, store, saved: () => last };
}
