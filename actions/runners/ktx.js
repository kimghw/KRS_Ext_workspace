// KTX 어댑터 — 행위 기록의 조건으로 확장에 포함한 공식 시간표를 검색한다.
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
