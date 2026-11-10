// KTX 어댑터 — 행위 기록의 조건으로 공식 시간표를 검색하고, 좌석 상태를 읽고, 코레일 화면으로 넘어간다.
// 좌석 선택·예약·결제는 이 어댑터에 없다. tabId·session(좌석을 읽은 코레일 결과 탭·전용 창의 손잡이)은 산 손잡이라 기록이 아니라 ctx 로 받는다.
import { ktxSearch as realKtxSearch, ktxSeats as realKtxSeats, ktxOpen as realKtxOpen } from '../../src/ktx.js';

/**
 * @param {ReturnType<import('../dispatch.js').createDispatcher>} d
 * @param {{ ktxSearch?: Function, ktxSeats?: Function, ktxOpen?: Function }} [deps]
 */
export function registerKtx(d, { ktxSearch = realKtxSearch, ktxSeats = realKtxSeats, ktxOpen = realKtxOpen } = {}) {
  d.register('ktx.search', async (rec, ctx = {}) =>
    ktxSearch(rec.input, { onStage: ctx.onStage }),
  { ok: (r) => r?.ok === true });
  d.register('ktx.seats', async (rec, ctx = {}) =>
    ktxSeats(rec.input, { onStage: ctx.onStage }),
  { ok: (r) => r?.ok === true });
  d.register('ktx.open', async (rec, ctx = {}) =>
    ktxOpen(rec.input, { onStage: ctx.onStage, session: ctx.session, tabId: ctx.tabId }),
  { ok: (r) => r?.ok === true });
}
