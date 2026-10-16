// 공문 어댑터 — 기록(gongmun.<갈래>)을 기존 함수의 인자로 바꿔 부른다. 사이트의 순서(새 창·과제·제목·본문·문서설정·결재선·첨부)는 src/gmwrite.js 에 그대로 있다.
//
//   registerGongmun(d, { writePlan, writeGongmun, mergeSetup })
//     'gongmun.write' (rec, { files, onStep, onTab, dry })
//        → writeGongmun(writePlan(entry.kind, { title, body, draft, form, setting, rank } = rec.input,
//                                 { me: rec.preset.me, preset: rec.preset.setup, project: rec.preset.project, today: rec.preset.today }),
//                       { files, onStep, onTab, dry })
//        기록에 kind 는 없다 — 행위 명세(entry)에서 온다. writePlan 의 ctx.preset 자리에는 rec.preset.setup(공문 설정 — 문서번호·결재선이 여기서 나온다)을 넘긴다.
//        rec.input.attach 의 파일 이름은 모두 ctx.files 에 있어야 한다(바이트는 기록 밖) — 없으면 ActionError.
//        ok: 단계(steps)에 ok:false 가 하나도 없을 때(§14.3 — 건너뜀 'skip'·시험 dry 는 안 된 것이 아니다). 결과(tabId·docId·steps)는 그대로 돌려준다.
//     'gongmun.setup' (rec, { rows, current }) → mergeSetup(rows, rec.preset.setup, rec.input.patch, { current })
//        명세가 planned 인 동안은 등록하지 않는다(live 가 되면 그때 등록된다).
//
// deps 의 키는 실제 함수 이름과 같고 기본값은 src 의 진짜 함수다(테스트는 가짜를 넣는다). 순수하다 — chrome·DOM 은 writeGongmun 안에만 있다.

import { ActionError } from '../gate.js';
import { writePlan as realWritePlan, mergeSetup as realMergeSetup } from '../../src/gongmun.js';
import { writeGongmun as realWriteGongmun } from '../../src/gmwrite.js';

/** 공문 작성의 성패 — 단계 가운데 안 된 것(ok:false)이 없으면 됐다. */
export const writeOk = (res) => !res.steps.some((x) => x.ok === false);

/**
 * @param {import('../dispatch.js').createDispatcher extends (...a: any) => infer D ? D : never} d 디스패처
 * @param {{ writePlan?: Function, writeGongmun?: Function, mergeSetup?: Function }} [deps]
 */
export function registerGongmun(d, { writePlan = realWritePlan, writeGongmun = realWriteGongmun, mergeSetup = realMergeSetup } = {}) {
  d.register('gongmun.write', async (rec, ctx = {}) => {
    const entry = d.entry(rec.action);
    const files = Array.isArray(ctx.files) ? ctx.files : [];
    const have = new Set(files.map((f) => f?.name));
    const missing = (rec.input.attach || []).map((a) => a?.name).filter((n) => !have.has(n));
    if (missing.length) throw new ActionError(rec.action, [`첨부 ${missing.join(' · ')} 의 파일이 ctx.files 에 없습니다`]);
    const { title, body, draft, form, setting, rank } = rec.input;
    const plan = writePlan(entry.kind, { title, body, draft, form, setting, rank }, {
      me: rec.preset.me, preset: rec.preset.setup, project: rec.preset.project, today: rec.preset.today,
    });
    return writeGongmun(plan, { files, onStep: ctx.onStep, onTab: ctx.onTab, dry: ctx.dry });
  }, { ok: writeOk });

  // 공문 설정 채우기 — 명세가 live 일 때만(1단계는 planned — 부르는 곳이 없다).
  if (d.has('gongmun.setup') && (d.entry('gongmun.setup').status || 'live') === 'live') {
    d.register('gongmun.setup', async (rec, ctx = {}) => mergeSetup(ctx.rows, rec.preset.setup, rec.input.patch, { current: ctx.current }), { ok: () => true });
  }
  return d;
}
