// 공문 어댑터 — 기록(gongmun.<갈래>)을 기존 함수의 인자로 바꿔 부른다. 사이트의 순서(새 창·과제·제목·본문·문서설정·결재선·첨부)는 src/gmwrite.js 에 그대로 있다.
//
//   registerGongmun(d, { writePlan, writeGongmun })
//     'gongmun.write' (rec, { files, onStep, onTab, dry, signal })   signal — 패널의 작성 취소(2026-10-27, AbortController)
//        → writeGongmun(writePlan(entry.kind, { title, body, draft, form, setting, rank, lead, refs } = rec.input,
//                                 { me: rec.preset.me, preset: rec.preset.setup, project: rec.preset.project, today: rec.preset.today }),
//                       { files, onStep, onTab, dry })
//        기록에 kind 는 없다 — 행위 명세(entry)에서 온다. writePlan 의 ctx.preset 자리에는 rec.preset.setup(공문 설정 — 문서번호·결재선이 여기서 나온다)을 넘긴다.
//        rec.input.attach 의 파일 이름은 모두 ctx.files 에 있어야 한다(바이트는 기록 밖) — 없으면 ActionError.
//        rec.input.form(양식 ID)은 닫힌 목록이 아니다(2026-10-17 — 공문 탭의 "양식 ID 직접 적기": 목록에 없는 양식은 창만 연다). 여기서 꼴(영문·숫자·_)과,
//        레시피 폼의 only(외부강의등 신고서는 외부활동에서만)를 본다 — 틀리면 ActionError(writePlan 의 draftUrl 은 틀린 ID 를 조용히 기본 양식으로 돌려 실행 모드에 맞지 않는다).
//        ok: 단계(steps)에 ok:false 가 하나도 없을 때(§14.3 — 건너뜀 'skip'·시험 dry 는 안 된 것이 아니다). 결과(tabId·docId·steps)는 그대로 돌려준다.
//
// deps 의 키는 실제 함수 이름과 같고 기본값은 src 의 진짜 함수다(테스트는 가짜를 넣는다). 순수하다 — chrome·DOM 은 writeGongmun 안에만 있다.

import { ActionError } from '../gate.js';
import { writePlan as realWritePlan, orderFromPurchase } from '../../src/gongmun.js';
import { writeGongmun as realWriteGongmun } from '../../src/gmwrite.js';
import { readPrior as realReadPrior, priorToPurchase, priorProject } from '../../src/gmprior.js';
import { RECIPE } from '../../src/gmrecipe.js';
import { RESEARCH_FORM } from '../../src/gmlist.js';

/** 공문 작성의 성패 — 단계 가운데 안 된 것(ok:false)이 없으면 됐다. */
export const writeOk = (res) => !res.steps.some((x) => x.ok === false);

/** eclass 양식 ID 의 꼴 — src/gongmun.js draftUrl 이 받는 것과 같다. */
const FORM_ID = /^[A-Za-z0-9_]+$/;

/**
 * 양식 ID 가 이 종류에서 쓸 수 있는 것인가 — 꼴이 틀리면, 또는 레시피 폼의 only(그 갈래에서만 고르는 폼)에 이 종류가 없으면 까닭. 레시피에 없는 ID 는 된다(창만 연다).
 * @returns {string} 문제(없으면 빈 글)
 */
export function formProblem(form, kind, recipe = RECIPE) {
  if (!FORM_ID.test(String(form ?? ''))) return `양식 ID(${form})는 영문·숫자·_ 로만 된 글이어야 합니다`;
  const only = recipe?.forms?.[form]?.only;
  return Array.isArray(only) && !only.includes(kind) ? `양식 ${form} 은 ${only.join('·')} 에서만 고를 수 있습니다(${kind} 에서는 안 됩니다)` : '';
}

/**
 * @param {import('../dispatch.js').createDispatcher extends (...a: any) => infer D ? D : never} d 디스패처
 * @param {{ writePlan?: Function, writeGongmun?: Function }} [deps]
 */
export function registerGongmun(d, { writePlan = realWritePlan, writeGongmun = realWriteGongmun, readPrior = realReadPrior } = {}) {
  // 선행 품의 읽기(gongmun.prior — 조회, confirm 없음. 2026-10-17 "이것도 명세서를 만든 다음에 러너로 실행하도록"): 기록의 문서번호·양식·제목으로 eclass 에서 그 품의의 본문·첨부를 읽어
  // (src/gmprior.js readPrior) 구매 초안 꼴(priorToPurchase)로 바꾸고 구매의뢰 초안(orderFromPurchase — 선행 품의 칸에 문서번호·제목)·과제(priorProject — ctx.projects 가 패널의 과제 목록)·
  // 첨부(이름·형식·바이트 — 기록 밖)·알림을 돌려준다. 패널이 이것으로 구매의뢰 갈래의 작업을 세운다. 원화가 아니면(구독 품의의 USD) 고치라고 알린다.
  d.register('gongmun.prior', async (rec, ctx = {}) => {
    const { id, title } = rec.input;
    // 양식은 기록에 없으면 연구업무추진품의(명세의 default 는 폼 기본값이라 기록에 저절로 들지 않는다).
    const form = rec.input.form || RESEARCH_FORM;
    const { doc, files, notes } = await readPrior({ id, form, title });
    const purchase = priorToPurchase(doc, { title: title || doc.title });
    const project = priorProject(doc, Array.isArray(ctx.projects) ? ctx.projects : []);
    const draft = orderFromPurchase(purchase, { me: rec.preset.me, doc: { id, title: title || doc.title } });
    // 계정과목명은 그 품의의 구매계정(연구활동비(소프트웨어 활용비) 같은 비목) — 과제의 계정(orderAuto 의 폴백)보다 그 건에 맞다.
    if (purchase.account && !String(draft.subjectName || '').trim()) draft.subjectName = purchase.account;
    const warn = purchase.currency && purchase.currency !== 'KRW' ? [`선행 품의의 금액이 ${purchase.currency} 입니다 — 합계와 품목 금액을 원화로 고쳐 주세요`] : [];
    return {
      ok: true, draft, purchase, project, files, notes: [...warn, ...notes],
      doc: { title: doc.title, job: doc.job, items: doc.items.length, total: doc.total, currency: doc.currency, summary: doc.summary, text: doc.text },
    };
  });
  d.register('gongmun.write', async (rec, ctx = {}) => {
    const entry = d.entry(rec.action);
    const files = Array.isArray(ctx.files) ? ctx.files : [];
    const have = new Set(files.map((f) => f?.name));
    const missing = (rec.input.attach || []).map((a) => a?.name).filter((n) => !have.has(n));
    if (missing.length) throw new ActionError(rec.action, [`첨부 ${missing.join(' · ')} 의 파일이 ctx.files 에 없습니다`]);
    const badForm = formProblem(rec.input.form, entry.kind);
    if (badForm) throw new ActionError(rec.action, [badForm]);
    // lead·refs(합의자·참조자 — 문서설정의 과제 책임자·참조자 칸)는 외부활동·예전 기록에는 없다 — 그러면 writePlan 이 고른 과제의 것을 쓴다.
    const { title, body, draft, form, setting, rank, lead = null, refs = null } = rec.input;
    const plan = writePlan(entry.kind, { title, body, draft, form, setting, rank, lead, refs }, {
      me: rec.preset.me, preset: rec.preset.setup, project: rec.preset.project, today: rec.preset.today,
    });
    return writeGongmun(plan, { files, onStep: ctx.onStep, onTab: ctx.onTab, dry: ctx.dry, signal: ctx.signal || null });
  }, { ok: writeOk });
  return d;
}
