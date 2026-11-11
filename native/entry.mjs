// 공용 native host의 경량 입구. 작업에 필요한 모듈만 불러온다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_INPUT = 64 * 1024 * 1024; // 기존 첨부 요청도 유지한다.

export function createRouter({ loadKtx = () => import('./ktx.mjs'), loadPress = () => import('./ktxpress.mjs'),
  loadFlightRead = () => import('./flightread.mjs'), loadLegacy = () => import('./host.mjs') } = {}) {
  let ktx, press, flightRead, legacy;
  return async message => {
    if (message?.task === 'flightReadRepair') {
      const reader = await (flightRead ||= loadFlightRead());
      return reader.repair(message.snapshot, message.input);
    }
    if (message?.task === 'ktxReservePress') {
      const action = await (press ||= loadPress());
      return action.press(message.input);
    }
    if (message?.task === 'ktxSearch' || message?.task === 'ktxOpen') {
      const train = await (ktx ||= loadKtx());
      return message.task === 'ktxSearch' ? train.search(message.input) : train.open(message.session);
    }
    const host = await (legacy ||= Promise.resolve().then(loadLegacy).then(module => {
      module.pruneLogs?.();
      module.pruneTempDebug?.();
      return module;
    }));
    return host.handle(message);
  };
}

export const route = createRouter();

export function frame(result) {
  const body = Buffer.from(JSON.stringify(result), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

export function run({ input = process.stdin, output = process.stdout, error = process.stderr, handle = route,
  terminate = () => process.exit(1) } = {}) {
  const write = output.write.bind(output);
  output.write = error.write.bind(error); // 라이브러리의 stdout 잡음은 stderr로 보낸다.
  let acc = Buffer.alloc(0), pending = Promise.resolve(), invalid = false;
  const send = result => write(frame(result));
  const enqueue = message => {
    pending = pending.then(async () => {
      try { send(await handle(message)); }
      catch (err) {
        if (err?.terminateHost) { terminate(); return; }
        send({ ok: false, code: 'HOST_FAILED', error: '브릿지 작업을 처리하지 못했습니다.' });
      }
    });
  };
  const badFrame = () => {
    invalid = true;
    pending = pending.then(() => send({ ok: false, code: 'FRAME_PROTOCOL', error: '브릿지 요청을 읽지 못했습니다.' }));
    input.destroy();
  };
  input.on('data', chunk => {
    if (invalid) return;
    acc = Buffer.concat([acc, chunk]);
    for (;;) {
      if (acc.length < 4) return;
      const size = acc.readUInt32LE(0);
      if (!size || size > MAX_INPUT) { badFrame(); return; }
      if (acc.length < size + 4) return;
      const body = acc.subarray(4, size + 4);
      acc = acc.subarray(size + 4);
      let message;
      try { message = JSON.parse(body.toString('utf8')); }
      catch {
        pending = pending.then(() => send({ ok: false, code: 'INPUT_INVALID', error: '브릿지 요청을 읽지 못했습니다.' }));
        continue;
      }
      enqueue(message);
    }
  });
  input.on('end', () => { if (!invalid && acc.length) badFrame(); });
  output.on('error', () => terminate());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
