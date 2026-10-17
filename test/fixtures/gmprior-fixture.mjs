// 선행 품의 화면의 흉내 — 2026-10-17 CDP 로 읽은 완료 품의(HER-2026-000097)의 본문 틀(Forms/Drafts/KR_EA_Research_Task.aspx 읽기 꼴 — 본문은 td#…tdEditorControl 안의 <p>)과
// 첨부 목록 화면(Main/CommentAttachmentInfo.aspx — a[href*="AttachFileDown.aspx"] View=1 이름 링크·View=0 내려받기)의 뼈대만 남긴 것. test/gmprior.test.mjs 와 test/wiring.test.mjs 가 쓴다.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const P = 'ctl00_ContentPlaceHolder_Content_';

/** 이 확장의 구매 품의 틀로 쓴 본문 줄(2026-10-16 이후 — 가. 과제 개요 · 나. 구매 내역 · 다. 구매금액 …). */
export const PURCHASE_LINES = [
  '1. 연구본부 수소전기추진연구팀은 「MW급 10kV 반도체 차단기 개발」 과제를 수행하고 있습니다.',
  '2. 이와 관련하여 34인치 모니터 외 1건을 구매하고자 아래와 같이 품의하오니 재가하여 주시기 바랍니다.',
  '------------ 아   래 ------------',
  '가. 과제 개요',
  '    (1) 과 제 명 : MW급 10kV 반도체 차단기 개발',
  '    (2) 과제번호 : RND-20-2026',
  '    (3) 연구기간 : 2026.04.01 ~ 2029.12.31',
  '    (4) 과제책임자 : 박기도',
  '나. 구매 내역',
  '    (1) 구매품 : LG 34WR50QK 34인치 모니터',
  '        - 사양 : 34인치 WQHD · 커브드',
  '        - 수량 : 1대',
  '        - 금액 : 489,000원',
  '    (2) 구매품 : 모니터암',
  '        - 수량 : 1개',
  '        - 금액 : 99,000원',
  '다. 구매금액 : 588,000원 (VAT 포함)',
  '라. 구매처 : 쿠팡',
  '마. 구매계정 : 연구활동비(연구실운용비)',
  '바. 용도 : 연구 자료 검토용',
  '사. 구매사유 : 과제 회의에서 회로도·시험 데이터를 함께 검토할 대화면이 필요함',
  '※ 첨 부',
  '    1. 견적서 1부.  끝.',
];

/** 원본(krs-web-agents) 구매 틀 — 품목 안에 용도·구매금액·구매계정·구매사유가 든다(과제 개요 없음). */
export const ORIGIN_PURCHASE_LINES = [
  '1. 연구본부 수소전기추진연구팀은 친환경 선박 경쟁력 확보를 위하여 MVDC 기반 선내 전력망 기술 개발을 수행하고 있습니다.',
  '2. 이와 관련하여 시험용 전류 프로브를 아래와 같이 품의하오니 재가하여 주시기 바랍니다.',
  '------------ 아   래 ------------',
  '가. 구매 내역',
  '    (1) 구매품 : 전류 프로브 CP-30 (Tektronix)',
  '        - 사양 : 30A · 100MHz · BNC',
  '        - 용도 : MVDC 차단기 단락 시험 전류 계측',
  '        - 구매금액 : 1,870,000원 (VAT 포함)',
  '        - 구매계정 : 연구재료비',
  '        - 구매사유 : 차단기 단락 시험에서 수백 A 급 전류 파형을 계측할 프로브가 필요함',
  '※ 첨 부',
  '    1. 견적서 1부.  끝.',
];

/** 원본 구독 틀 — 2026-10-17 실측 HER-2026-000097 그대로(번호 줄이 품목이 아니라 칸이다). */
export const SUBSCRIPTION_LINES = [
  '1. 연구본부 수소전기추진연구팀은 친환경 선박 경쟁력 확보를 위하여 MVDC(중전압 직류) 기반 선내 전력망 기술 개발을 수행하고 있습니다.',
  '2. 이와 관련하여 AI(LLM) 기반 평가지원 도구 개발에 활용할 Claude 맥스 플랜(Anthropic) 구독(2026.07~2026.12, 6개월 일시 결제)을 아래와 같이 품의하오니 재가하여 주시기 바랍니다.',
  '------------ 아   래 ------------',
  '가. 구독 서비스',
  '    (1) 구독서비스 : Claude 맥스 플랜 (Anthropic Claude Max, Pro 대비 20배 사용량)',
  '    (2) 구독사유 : LLM기반 평가지원 도구 개발(규정·표준 도메인 온톨로지 설계)에 필요한 지식베이스 구축에 많은 토큰 사용이 필요',
  '        # 비고 :  API 이용시 하루 USD200 이상 비용 사용이 예상됨',
  '    (3) 구독기간 : 2026.07 ~ 2026.12 (6개월)',
  '    (4) 구독금액 : 월 USD 220 (VAT 포함) × 6개월 = USD 1,320 (일시 결제)',
  '    (5) 구매계정 : 연구활동비(소프트웨어 활용비)',
  '    (6) 사용자 : 김거화 수석',
  '※ 첨 부',
  '    1. claude_견적서 1부.  끝.',
];

/**
 * 본문 틀(읽기 꼴) 한 장 — 제목·Job Id·차수·수신·참조와 본문 줄(줄마다 <p>, 들여쓰기는 &nbsp;).
 * @param {{title?: string, job?: string, degree?: string, receive?: string, reference?: string, lines?: string[]}} o
 */
export function researchPage({ title = '', job = '', degree = '1', receive = '', reference = '', lines = PURCHASE_LINES } = {}) {
  const ps = lines.map((l) => {
    const lead = l.match(/^ */)[0].length;
    const center = /아\s+래/.test(l) ? ' text-align: center;' : '';
    return `<p style="font-family: Arial; font-size: 12pt;${center}">&nbsp; &nbsp; ${'&nbsp;'.repeat(lead)}${esc(l.trim())}</p>`;
  }).join('');
  return `<!DOCTYPE html><html><head><title>연구업무품의서</title><script>var theForm = document.forms['aspnetForm'];</script></head><body><form name="aspnetForm" method="post" id="aspnetForm">
<table><tr><td><span id="ctl00_ApplineInfoInReportKRTA1_lblDocTitle">${esc(title)}</span></td></tr></table>
<span id="${P}lblReceiveTitle">수신</span><span id="${P}lblReceive">${esc(receive)}</span><span id="${P}lblReferenceTitle">참조</span><span id="${P}lblReference">${esc(reference)}</span>
<span id="${P}Label2">Job Id.</span><span id="${P}lblJobID">${esc(job)}</span><input type="hidden" id="${P}hidJobID" value="${esc(job)}" />
<span id="${P}lblDegreeTitle">차수</span><span id="${P}lblDegree">${esc(degree)}</span>
<table><tr><td id="${P}tdEditorControl">${ps}</td></tr></table>
<input type="hidden" id="${P}hfDocBodyValue" value="" />
</form></body></html>`;
}

/**
 * 첨부 목록 화면 한 장 — 파일마다 이름 링크(View=1)와 내려받기 링크(View=0). files 는 [{ id, name, size }].
 */
export function attachPage(files = []) {
  const rows = files.map((f, i) => {
    const q = `AttID=${esc(f.id)}&amp;FileName=${encodeURIComponent(f.name)}`;
    return `<tr><td><span id="ctl00_ContentPlaceHolder1_rptAttachFileList_ctl0${i}_lblAttinList">첨부${i + 1} : </span>`
      + `<span id="ctl00_ContentPlaceHolder1_rptAttachFileList_ctl0${i}_lblFileItemLink"><a href="https://eclass.krs.co.kr/RealEANET/Manager/AttachFileDown.aspx?${q}&amp;View=1">${esc(f.name)}</a> (${esc(f.size || '60.68 KB')}) </span>`
      + `<span id="ctl00_ContentPlaceHolder1_rptAttachFileList_ctl0${i}_lblDownModeLink"><a href="https://eclass.krs.co.kr/RealEANET/Manager/AttachFileDown.aspx?${q}&amp;View=0"><img alt="" /></a></span></td></tr>`;
  }).join('');
  return `<!DOCTYPE html><html><body><form id="aspnetForm"><a href="#tbl_ctl00_ContentPlaceHolder1_panAttachFile">첨부파일(${files.length})</a>
<div id="ctl00_ContentPlaceHolder1_panAttachFile"><table id="tbl_ctl00_ContentPlaceHolder1_panAttachFile">${rows}</table></div></form></body></html>`;
}

/** 로그인 화면 — 전자결재 세션이 풀렸을 때. */
export const LOGIN_PAGE = '<html><body><script>alert("You must sign in.");</script></body></html>';
