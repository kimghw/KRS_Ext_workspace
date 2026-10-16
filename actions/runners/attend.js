// 근태 실행기 어댑터 — 기록(attend.<종류>·attend.doc·attend.cancel)을 src/attend.js 의 일감으로 바꿔 src/hr.js 로 돌린다.
//
//   registerAttend(d, deps)   디스패처에 attend.apply · attend.doc · attend.cancel 을 등록한다. deps 의 키는 실제 함수 이름과 같고 기본값은
//                             src 모듈의 진짜 함수다(테스트는 가짜를 넣는다)
//
//   attend.apply  (rec, { files, onStage })  → hrRunJob(buildJob(formOf(rec), { action: rec.input.op, doc: rec.input.doc }), { onStage })
//                 formOf: settle({ ...blankForm(종류, preset.today), ...input }) — 기록의 null 은 빈 폼의 값(when 으로 빠진 칸도), half 의 full 은
//                 UI 의 빈 값('')이다. file 칸은 참조뿐이라(§14.1) 바이트를 ctx.files 에서 이름으로 찾아 잇는다 — 없으면 ActionError
//   attend.doc    (rec, { item, onStage })   → delete 면 hrDeleteDoc(item) 을 { ok: true, deleted: n } 로, 아니면 hrRunJob(buildDocJob(item, action))
//   attend.cancel (rec, { item, onStage })   → hrRunJob(buildCancelJob(item, reason))
//                 item 은 신청 내역의 줄(사이트에서 읽은 것 — ctx). 기록의 docNo 와 다르면 ActionError(§14.2)
//
// 사이트 특유의 차례(HR 입력 차례·확인)는 src/attend.js·src/hr.js 에 그대로 있다 — 여기는 기록을 인자로 바꾸기만 한다.
// 성공 판정(§14.3): hrRunJob 의 결과는 ok === true, 삭제는 던지지 않으면 성공. 결재요청의 최종 성공(목록에서 확인)은 패널이 ctx.outcome 으로 정한다.

import { buildJob, buildDocJob, buildCancelJob, blankForm, settle } from '../../src/attend.js';
import { hrRunJob, hrDeleteDoc } from '../../src/hr.js';
import { ActionError } from '../gate.js';

const defaults = { buildJob, buildDocJob, buildCancelJob, hrRunJob, hrDeleteDoc, blankForm, settle };

/** 행위 ID 의 종류 — attend.trip → trip. */
const kindOf = (rec) => String(rec?.action || '').split('.')[1] || '';
const okHr = (r) => r?.ok === true;

/** 기록의 파일 참조({ name, type })에 ctx.files([{ name, type, dataUrl }])의 바이트를 잇는다. 그 이름이 없으면 ActionError. */
export function fileOf(rec, ref, files) {
  const hit = (files || []).find((f) => f && f.name === ref?.name);
  if (!hit || typeof hit.dataUrl !== 'string') throw new ActionError(rec.action, [`첨부 ${ref?.name ?? '?'} 의 바이트가 ctx.files 에 없습니다`]);
  return { name: hit.name, type: hit.type || ref.type || '', dataUrl: hit.dataUrl };
}

/**
 * 기록 → 근태 폼. 빈 폼(blankForm — 종류의 기본값) 위에 기록의 칸을 얹고 settle 로 파생 칸(종료일·종료 시각)을 맞춘다 — 패널이 buildJob 에 주던 폼과 같다.
 *   null(비운 칸·when 으로 빠진 칸) → 빈 폼의 값  ·  half 'full' → ''(UI 의 전일)  ·  file 참조 → ctx.files 의 바이트  ·  op·doc 은 폼이 아니다
 */
export function formOf(rec, { blankForm: blank = blankForm, settle: fix = settle } = {}, files = []) {
  const base = blank(kindOf(rec), rec.preset?.today || '');
  const form = { ...base };
  for (const [key, v] of Object.entries(rec.input || {})) {
    if (key === 'op' || key === 'doc') continue;
    if (v == null) { form[key] = base[key]; continue; }
    form[key] = key === 'half' && v === 'full' ? '' : key === 'file' ? fileOf(rec, v, files) : v;
  }
  return fix(form);
}

/** ctx.item 이 기록의 문서인지 본다(§14.2 — 대상 식별자는 기록에, 산 줄은 ctx 에). */
function sameItem(rec, ctx) {
  const item = ctx?.item;
  if (!item || String(item.docNo) !== String(rec.input.docNo)) {
    throw new ActionError(rec.action, [`ctx.item 의 문서번호(${item?.docNo ?? '없음'})가 기록의 ${rec.input.docNo} 와 다릅니다`]);
  }
  return item;
}

/**
 * @param {ReturnType<import('../dispatch.js').createDispatcher>} d
 * @param {Partial<typeof defaults>} [deps]
 */
export function registerAttend(d, deps = defaults) {
  const f = { ...defaults, ...deps };
  d.register('attend.apply', (rec, ctx = {}) => {
    const form = formOf(rec, f, ctx.files);
    const job = f.buildJob(form, { action: rec.input.op, doc: rec.input.doc || null });
    return f.hrRunJob(job, { onStage: ctx.onStage });
  }, { ok: okHr });
  d.register('attend.doc', async (rec, ctx = {}) => {
    const item = sameItem(rec, ctx);
    if (rec.input.action === 'delete') return { ok: true, deleted: await f.hrDeleteDoc(item, { onStage: ctx.onStage }) };
    return f.hrRunJob(f.buildDocJob(item, rec.input.action), { onStage: ctx.onStage });
  }, { ok: okHr });
  d.register('attend.cancel', (rec, ctx = {}) => f.hrRunJob(f.buildCancelJob(sameItem(rec, ctx), rec.input.reason), { onStage: ctx.onStage }), { ok: okHr });
  return d;
}
