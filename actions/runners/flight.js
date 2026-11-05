import { flightSearch as realFlightSearch } from '../../src/flights.js';

/** 기록에는 조회 조건만 담고 브라우저 탭과 결과는 실행 때 다룬다. */
export function registerFlight(dispatcher, { flightSearch = realFlightSearch } = {}) {
  dispatcher.register('flight.search', (rec, ctx = {}) => {
    const { airline, from, to, date, hour, adults } = rec.input;
    return flightSearch({ airline, from, to, date, hour, adults }, { today: rec.preset?.today, onStage: ctx.onStage });
  }, { ok: (result) => result?.ok === true });
}
