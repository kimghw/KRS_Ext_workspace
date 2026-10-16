// 작업(task)마다 다른 LLM 호출 한도 — 생각의 깊이(effort)·답의 한도(max_tokens)·다리가 받는 입력 글의 길이·CLI 를 기다리는 시간.
//
// 거의 모든 작업은 짧은 글을 읽어 칸 몇 개를 채운다(말로 찾기·근태 조각·증빙·공문 문서) — 그 값이 DEFAULT_TUNE 이고 지금까지 쓰던 값 그대로다.
// R&D 사업계획서에서 KR 스냅샷 YAML 을 뽑거나(rnd.extract) 변경사항으로 YAML 전문을 고치는 일(rnd.revise)은 입력이 수만 자이고 답도 YAML 전문이라
// 이 두 작업만 깊이·한도·시간을 키운다(2026-10-16 — rndgen/llm.js). 여기에 없는 작업은 바이트까지 전과 같다.
// 두 작업은 답이 몇 분 걸리므로 API 길을 스트리밍(stream: true — SSE)으로 부른다. 조용한 연결을 사내망 프록시가 끊지 않게 하려는 것이다.
// stream 이 없는(DEFAULT_TUNE) 작업은 본문에 stream 키조차 넣지 않는다(src/ai.js).
//
// 확장의 API 길(src/ai.js)과 로컬 CLI 다리(native/host.mjs)가 같이 읽는다 — import 도 chrome·Node API 도 없다.

/** 작업마다 다른 한도 — 없는 작업은 DEFAULT_TUNE(지금 값 그대로). */
export const DEFAULT_TUNE = Object.freeze({ effort: 'low', maxTokens: 16000, inputMax: 20_000, timeoutMs: 60_000, timeoutFilesMs: 120_000 });
export const TASK_TUNE = Object.freeze({
  // 사업계획서(작은 PDF 와 글자 재료 ~10만 자) → 스냅샷 YAML 전문(15~30KB). 표를 맞춰 보며 당해 차년도·KR 행만 골라야 해 한 단계 깊게 생각한다.
  'rnd.extract': Object.freeze({ effort: 'medium', maxTokens: 32000, inputMax: 150_000, timeoutMs: 600_000, timeoutFilesMs: 600_000, stream: true }),
  // 기준 YAML 전문 + 변경 글 → 고친 YAML 전문. 합계·소계를 다시 맞춘다.
  'rnd.revise': Object.freeze({ effort: 'medium', maxTokens: 32000, inputMax: 150_000, timeoutMs: 600_000, timeoutFilesMs: 600_000, stream: true }),
});

/**
 * 작업 하나의 한도 — 새 객체라 고쳐도 표는 그대로다. 'constructor' 같은 이름이 객체의 내장 속성에 걸리지 않게 hasOwn 으로 본다.
 * stream 은 TASK_TUNE 의 작업에만 있다(API 길만 본다 — CLI 다리는 쓰지 않는다).
 * @returns {{effort:string, maxTokens:number, inputMax:number, timeoutMs:number, timeoutFilesMs:number, stream?:boolean}}
 */
export function tuneOf(task) { return { ...DEFAULT_TUNE, ...(Object.hasOwn(TASK_TUNE, task) ? TASK_TUNE[task] : {}) }; }

/** 첨부 유무에 따른 CLI 시간 한도. */
export const limitOf = (tune, files = []) => (files.length ? tune.timeoutFilesMs : tune.timeoutMs);
