// 게시판 어댑터 — 기록(board.standard)을 src/stdboard.js 의 인자로 바꿔 부른다. 사이트의 차례(같은 표준 찾기·쓰기 화면·첨부 올리기·글 저장·다시 찾기)는 그쪽에 그대로 있다.
//
//   registerBoard(d, { stdUpload })
//     'board.standard' (rec, { bytes, onStage, dry }) → stdUpload({ designation, title, category, writer, file } = rec.input, { bytes, onStage, dry })
//        bytes 는 넣은 PDF(ZIP 이면 풀어 낸 것)의 바이트 — 기록에는 이름·형식만 있다.
//        ok: 결과의 ok(새 글을 올리고 게시판에서 확인했다) — 이미 있음(exists)·확인 못 함(unverified)은 ok false 로 돌아온다(던지지 않는다).
//
// deps 의 키는 실제 함수 이름과 같고 기본값은 src 의 진짜 함수다(테스트는 가짜를 넣는다). 순수하다 — 요청은 stdUpload 안에만 있다.

import { stdUpload as realStdUpload } from '../../src/stdboard.js';

/**
 * @param {ReturnType<import('../dispatch.js').createDispatcher>} d 디스패처
 * @param {{ stdUpload?: Function }} [deps]
 */
export function registerBoard(d, { stdUpload = realStdUpload } = {}) {
  d.register('board.standard', async (rec, ctx = {}) => {
    const { designation, title, category = 'ETC', writer = 'dept', file } = rec.input;
    return stdUpload({ designation, title, category, writer, file }, { bytes: ctx.bytes, onStage: ctx.onStage, dry: !!ctx.dry });
  }, { ok: (r) => r?.ok === true });
}
