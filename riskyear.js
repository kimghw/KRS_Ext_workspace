// eclass Quality 의 위험·기회 목록(Context of KR · Risk/Opportunity Management)에서 고른 연도를 메뉴를 옮겨도
// 그대로 두는 콘텐츠 스크립트의 시동 부분(src/riskyear.js).
//
// home.js 와 같은 까닭으로 모듈을 동적으로 불러온다(콘텐츠 스크립트는 import 문을 못 쓴다). 목록은 포털 껍데기의
// iframe 안에, KR Risk/Opportunity Register 는 그 안의 iframe 에 한 번 더 열리므로 매니페스트는 모든 프레임에 붙인다.
// 연도 없이 열린 목록을 그려지기 전에 다시 열어야 해서 document_start 에 돈다. 경로가 Quality 의 Context·
// RiskManagement 폴더가 아니면 곧바로 끝낸다(목록인지는 모듈이 가린다).
(() => {
  if (!/^\/qhseaudit\/view\/qhse\/(context|riskmanagement)\//i.test(location.pathname)) return;

  import(chrome.runtime.getURL('src/riskyear.js'))
    .then(({ startRiskYear }) => startRiskYear(document))
    .catch((err) => {
      // 확장이 다시 올려져 끊긴 것(runtime.id 가 사라진다)은 새로고침하면 풀리는 일이라 오류로 올리지 않는다.
      if (chrome.runtime?.id) console.warn('[KRS WORKSPACE] Quality 목록의 연도 유지를 시작하지 못했습니다:', err);
    });
})();
