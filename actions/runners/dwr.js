// 일일 업무 어댑터 — 기록(dwr.write)을 작성기(src/dwrwrite.js)의 인자로 바꿔 부른다. 사이트의 순서(날짜 옮기기·이미 쓴 날 거르기·채우기·저장·다시 읽기·제출)는 작성기에 그대로 있다.
//
//   registerDwr(d, { createDwrWriter })
//     'dwr.write' (rec, { writer, onStage, dry }) → writer.writeDay({ date, title, work?, hours, content, trip, op } = rec.input, { onStage, dry })
//        writer 는 카드가 한 번 연 작성기(뒤 탭 하나 — 짠 날을 차례로 쓰고 카드가 닫는다). 없으면 여기서 열고 이 한 날 뒤에 닫는다.
//        ok: 결과의 ok(저장했거나 제출했다) — 이미 적은 날(exists)·제출을 보지 못함(unverified)은 ok false 로 돌아온다(던지지 않는다).
//
// deps 의 키는 실제 함수 이름과 같고 기본값은 src 의 진짜 함수다(테스트는 가짜를 넣는다). 순수하다 — chrome 은 작성기 안에만 있다.

import { createDwrWriter as realCreateDwrWriter } from '../../src/dwrwrite.js';

/**
 * @param {ReturnType<import('../dispatch.js').createDispatcher>} d 디스패처
 * @param {{ createDwrWriter?: Function }} [deps]
 */
export function registerDwr(d, { createDwrWriter = realCreateDwrWriter } = {}) {
  d.register('dwr.write', async (rec, ctx = {}) => {
    const { date, title, work, hours, content, trip = false, op = 'save' } = rec.input;
    const own = !ctx.writer;
    const writer = ctx.writer || createDwrWriter();
    try {
      return await writer.writeDay({ date, title, ...(work ? { work } : {}), hours, content, trip, op }, { onStage: ctx.onStage, dry: !!ctx.dry });
    } finally {
      if (own) await writer.close();
    }
  }, { ok: (r) => r?.ok === true });
}
