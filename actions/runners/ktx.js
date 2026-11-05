// KTX 어댑터 — 기록(ktx.search)을 src/ktx.js ktxSearch 의 인자로 바꿔 부른다. 코레일 탭을 여는 차례·결과 화면 새로고침·줄 읽기는 그쪽에 그대로 있다.
//
//   registerKtx(d, { ktxSearch })
//     'ktx.search' (rec, { onStage }) → ktxSearch({ from, to, date, hour, adults } = rec.input, { today: rec.preset.today, onStage })
//        ok: 결과의 ok(열차 줄을 읽었다 — 열차가 없어 빈 목록이어도 ok). 막힘(-8002·-8202 …)·시간 넘김은 ok false 로 돌아온다(던지지 않는다).
//
// deps 의 키는 실제 함수 이름과 같고 기본값은 src 의 진짜 함수다(테스트는 가짜를 넣는다). 순수하다 — 탭·스크립트는 ktxSearch 안에만 있다.

import { ktxSearch as realKtxSearch } from '../../src/ktx.js';

/**
 * @param {ReturnType<import('../dispatch.js').createDispatcher>} d 디스패처
 * @param {{ ktxSearch?: Function }} [deps]
 */
export function registerKtx(d, { ktxSearch = realKtxSearch } = {}) {
  d.register('ktx.search', async (rec, ctx = {}) => {
    const { from, to, date, hour, adults } = rec.input;
    return ktxSearch({ from, to, date, hour, adults }, { today: rec.preset?.today || date, onStage: ctx.onStage });
  }, { ok: (r) => r?.ok === true });
}
