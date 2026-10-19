// kr_ext_rerp `lib/research-sync.js` 를 그대로 옮긴 것 — IIFE 머리와 꼬리의 `g.KRX_RESEARCH_SYNC = …` 를 export 로만 바꿨다(원본이 전역 g 로 읽던 것은 아래 shim). 출처·갱신 규칙은 rerp/README.md.
/* 공유 (Plus) — 연구개발계획서(연구내용, lib/research.js 의 기록 researchPlans)의 병합 규칙. 과제 폴더의 연차 파일(<n>차년도.json 의 research 칸 — 그 차년도 기록, lib/prjdoc.js v2)과 로컬을 맞출 때 lib/prjdoc.js mergeYear 가 부른다.
 * 백그라운드 전용 · Node 테스트 겸용. 0.8.5~0.8.7 (2026-10-18) 까지는 원노트 「[연구내용] 과제명」 페이지의 표(serialize/parse)·올리기(publish)·받기(pull)·섹션 단위 맞추기(run)가 여기 있었으나,
 *   저장소가 SharePoint 폴더의 JSON 으로 바뀌어(사용자 결정 "mcp 없이 … 브라우저 토큰으로" · "과제 사업계획서 … 다 포함") 병합과 그 보조만 남겼다 — 파일 읽기·쓰기는 lib/sp-store.js, 문서 모양은 lib/prjdoc.js, 과제별 차례는 lib/prjdoc-sync.js.
 * 기록 모양은 lib/research.js readSnapshot 의 rec. 받는 쪽에서만 뜻이 있는 칸(prjNo · prjNm · linkBy · src)은 파일에 쓸 때 clean 으로 뺀다(파일이 과제별이라 과제번호는 문서 머리에 있다) */
import KRX_RESEARCH from './research.js';
const g = { KRX_RESEARCH };   // [workspace] 원본은 전역 g.KRX_RESEARCH 를 읽는다
const LOCAL = ['prjNo', 'prjNm', 'linkBy', 'src'];   // 받는 쪽에서만 뜻이 있는 칸
const api = { LOCAL };
/** 파일에 쓸 기록 — 받는 쪽 연결 칸을 뺀다 */
api.clean = (rec) => { const o = Object.assign({}, rec); for (const k of LOCAL) delete o[k]; return o; };

/**
 * 병합 — 기록 id(과제명 키#차년도)마다 판(rev)이 높은 쪽, 같으면 at(넣은 시각)이 큰 쪽, 그래도 같으면 로컬.
 * local·remote 는 기록 목록(remote 는 null = 파일에 아직 없음) → { recs(이긴 기록 — 로컬 것은 연결 칸 그대로), fromRemote{ id: true }, localChanged, remoteChanged }
 */
api.merge = function (local, remote) {
  const RS = g.KRX_RESEARCH;
  const key = (r) => [RS.revNo(r.rev), Number(r.at) || 0];
  const newer = (a, b) => { const ka = key(a), kb = key(b); return ka[0] !== kb[0] ? ka[0] > kb[0] : ka[1] > kb[1]; };
  const L = new Map((local || []).filter((r) => r && r.id).map((r) => [r.id, r]));
  const R = new Map((remote || []).filter((r) => r && r.id).map((r) => [r.id, r]));
  const recs = [], fromRemote = {};
  let localChanged = false, remoteChanged = !remote;
  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(id), r = R.get(id);
    if (l && r) {
      if (newer(r, l)) { recs.push(r); fromRemote[id] = true; localChanged = true; }
      else { recs.push(l); if (newer(l, r)) remoteChanged = true; }
    } else if (l) { recs.push(l); remoteChanged = true; }
    else { recs.push(r); fromRemote[id] = true; localChanged = true; }
  }
  return { recs: recs.sort((a, b) => a.n - b.n), fromRemote, localChanged, remoteChanged };
};

export default api;
