// 입력으로 받은 제한된 화면 증거만 해석한다. 브라우저·CLI·파일을 열지 않는다.
import { repairFlightRead } from '../src/flightrepair.js';

export function repair(snapshot, input) {
  return repairFlightRead(snapshot, input);
}
