// 디스패처 — 행위 ID → 실행기 이름 → 등록된 함수. 기록을 짓고(build), 확인을 보고 돌리며(run), 활동 로그에 한 줄 남긴다.
//
//   createDispatcher({ spec, log, now })
//     .register(name, fn, { ok })                    실행기 등록 — fn(record, ctx) → result. 같은 이름을 두 번 등록하면 throw
//     .build(id, { input, preset, by, via, mode })   → { record, notes }   관문(check) → makeRecord. 틀리면 ActionError
//     .run(record, ctx)                              → result   아래 차례
//     .has(id) .ids() .entry(id)
//
// run 의 차례
//   1 명세를 찾는다 — status 가 live 가 아니면 ActionError
//   2 실행 직전에 **다시** 관문(실행 모드)을 지나고 지문을 다시 센다 — record.hash 와 다르면 ActionError(지은 뒤에 바뀐 기록)
//     초안 모드로 지은 기록도, build 를 거치지 않은 객체도 여기서 실행 모드 검사를 받는다(필수가 비면 막힌다)
//   3 confirm 행위면 ctx.confirmed 가 그 지문이어야 한다 — 패널이 사람이 누른 핸들러 안에서 record.hash 를 넣는다. LLM 의 답에서 받지 않는다
//   4 실행기가 없으면 ActionError
//   5 result = await runner(다시 정규화해 깊게 얼린 기록, ctx) — 던지면 { ok: false, error } 로 기록하고 다시 던진다
//   6 ctx.outcome 이 있으면 await — 돌려준 ok·text·data 로 로그를 쓴다(던지면 ok: false 로 기록하고 다시 던진다)
//   7 log({ kind, ok, text, data: { record: clipRecord, ...data, result: clipResult } }) — run 마다 이 한 줄뿐
//
// 하지 않는 것: 재시도·되돌리기·뒤따르는 행위(then)의 자동 실행. 한 번의 run 은 실행기 한 번이다.
// 순수하다 — 시계는 now, 로그는 log 로 받는다(패널이 (e) => logEvent(e.kind, e.ok, e.text, e.data) 를 준다).

import { ACTIONS } from './spec.js';
import { ActionError, specOf, check } from './gate.js';
import { hashOf, makeRecord, clipRecord, clipResult, describe, freezeDeep } from './record.js';

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const messageOf = (err) => (err && typeof err === 'object' && typeof err.message === 'string' ? err.message : String(err));

/**
 * @param {{ spec?: object, log?: (e: {kind: string, ok: boolean, text: string, data: object}) => unknown, now?: () => number }} [deps]
 */
export function createDispatcher({ spec = ACTIONS, log = () => {}, now = () => Date.now() } = {}) {
  const runners = new Map();

  // 로그는 한 일을 막지 않는다 — 던지거나 거부돼도 삼킨다.
  const emit = (e) => {
    try {
      const p = log(e);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // 로그 실패는 한 일을 되돌리지 않는다
    }
  };

  const d = {
    /** 실행기 등록. ok 는 결과로 성패를 가르는 함수(기본: r.ok === true). */
    register(name, fn, { ok = (r) => r?.ok === true } = {}) {
      if (typeof name !== 'string' || !name) throw new Error('실행기 이름이 없습니다');
      if (runners.has(name)) throw new Error(`실행기 ${name} 는 이미 등록돼 있습니다`);
      if (typeof fn !== 'function') throw new Error(`실행기 ${name}: 함수가 아닙니다`);
      runners.set(name, { fn, ok });
      return d;
    },

    /** 관문을 지나 기록을 짓는다. 틀리면 ActionError(problems). */
    build(id, { input = {}, preset = {}, by = 'ui', via = null, mode = 'execute' } = {}) {
      const out = check(id, { input, preset }, { mode, spec });
      const record = makeRecord(id, { input: out.input, preset: out.preset, by, via, at: now() });
      return { record, notes: out.notes };
    },

    /** 기록을 돌린다. */
    async run(record, ctx = {}) {
      if (!isPlain(record) || typeof record.action !== 'string') throw new ActionError(String(record?.action ?? '?'), ['기록이 아닙니다']);
      const entry = specOf(record.action, spec);
      if ((entry.status || 'live') !== 'live') throw new ActionError(entry.id, [`${entry.status} 상태의 행위라 실행하지 않습니다`]);

      const { input, preset } = check(record.action, { input: record.input ?? {}, preset: record.preset ?? {} }, { mode: 'execute', spec });
      const hash = hashOf({ action: record.action, preset, input });
      if (record.hash !== hash) throw new ActionError(entry.id, ['기록이 지은 뒤에 바뀌었습니다 — 다시 지어 확인하세요']);
      if (entry.confirm !== false && ctx.confirmed !== hash) throw new ActionError(entry.id, ['확인 없이 실행할 수 없습니다']);
      const runner = runners.get(entry.runner);
      if (!runner) throw new ActionError(entry.id, [`등록되지 않은 실행기 ${entry.runner}`]);

      const rec = freezeDeep({ ...record, preset, input, hash });
      const kind = entry.log || spec.domains?.[entry.domain]?.log || entry.domain;
      let text = ctx.text ?? describe(rec, entry);
      let extra = isPlain(ctx.data) ? ctx.data : {};
      const line = (ok, result) => ({ kind, ok, text, data: { record: clipRecord(rec, entry), ...extra, result } });

      let result;
      try {
        result = await runner.fn(rec, ctx);
      } catch (err) {
        emit(line(false, { ok: false, error: messageOf(err) }));
        throw err;
      }
      let ok;
      try { ok = !!runner.ok(result); } catch { ok = false; }
      if (typeof ctx.outcome === 'function') {
        try {
          const o = await ctx.outcome(result);
          if (isPlain(o)) {
            if (typeof o.ok === 'boolean') ok = o.ok;
            if (typeof o.text === 'string') text = o.text;
            if (isPlain(o.data)) extra = o.data;
          }
        } catch (err) {
          emit(line(false, { ...clipResult(result), ok: false, error: messageOf(err) }));
          throw err;
        }
      }
      emit(line(ok, clipResult(result)));
      return result;
    },

    has: (id) => typeof id === 'string' && Object.hasOwn(spec.actions || {}, id),
    ids: () => Object.keys(spec.actions || {}),
    entry: (id) => specOf(id, spec),
  };
  return d;
}
