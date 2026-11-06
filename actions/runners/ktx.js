// KTX 어댑터 — 행위 기록의 조건을 기존 브릿지의 Python 조회 모듈에 전달한다.
// 예약·결제와 코레일 화면 조작은 이 어댑터에 없다.
import { ktxSearch as realKtxSearch } from '../../src/ktx.js';

/**
 * @param {ReturnType<import('../dispatch.js').createDispatcher>} d
 * @param {{ ktxSearch?: Function }} [deps]
 */
export function registerKtx(d, { ktxSearch = realKtxSearch } = {}) {
  d.register('ktx.search', async (rec, ctx = {}) =>
    ktxSearch(rec.input, { onStage: ctx.onStage }),
  { ok: (r) => r?.ok === true });
}
