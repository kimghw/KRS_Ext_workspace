// kr_ext_rerp `lib/rnd-api.js`(0.8.3, 880a6bc) 가운데 R&D 탭이 쓰는 부분만 그대로 옮긴 것 — call · describe · pool · fetchProjectRecs · fetchProjects · dateRange · fetchCards ·
// trunc · execRate · fetchBudget · ssoLogin. collect(카드미청구 보기 전체)·checkMembership·참여율·미승인·회의·검색은 옮기지 않았고, collect 가 과제마다 하던
// 미청구·승인전 합산(원본 831~846행)만 withPending() 으로 떼어 뒀다. 설정(KRX_SETTINGS)은 rerp 의 기본값(adv 서비스 이름·입력)을 DEFAULTS 로 들고 와 settingsOf() 로 겹친다.
// 몸통은 원본과 같고 `g.KRX_FMT`·`g.KRX_SETTINGS.parseJson` 은 아래 shim `g` 로 그대로 읽는다. 출처·갱신 규칙은 rerp/README.md.
/* R&D ERP(rnd.krs.co.kr) 서비스 호출 - 서비스워커 전용
 * 규약: POST /{service}.jct, body: _JSON_=encodeURIComponent(encodeURIComponent(JSON)), 응답 JSON(charset=euc-kr)
 * 응답 COMMON_HEAD.ERROR=true 이면 오류. CODE=GWM0001("사용자 정보가 존재하지 않습니다") = 로그인 필요 */
import FMT from './fmt.js';

/* rerp lib/settings.js DEFAULTS 가운데 여기서 읽는 것 — adv 의 서비스 이름·입력과 집행비율의 제외 비목·조회 기간 */
export const DEFAULTS = {
  budgetItemInclude: {},            // 과제집행비율 비목별 포함 여부 { [비목명]: true(포함) | false(제외) } - 설정 페이지 목록에서 선택
  budgetExcludeDefault: ['인건비', '연구수당', '간접비'],   // 명시적으로 고르지 않은 비목의 기본값: 이름에 이 단어가 들어가면 제외, 아니면 포함
  projectStatusKeyword: '진행',     // 과제 진행상태명(PROG_STS_NM)에 이 문자열이 포함된 과제만 (비우면 전체)
  monthsBack: 6,                    // 사용일자 조회 시작: N개월 전
  monthsForward: 1,                 // 사용일자 조회 종료: N개월 후
  adv: {
    usefacSeqNo: '10',
    projectsService: 'rcomm_0009_01_r001',                              // 과제 검색 팝업(과제책임자/과제명)과 동일
    projectsInput: '{"SEARCH_NM":"","SEARCH_GB":"10","GUBUN":"A","PRJ_AUTH":""}',   // SEARCH_GB 진행상태 코드(10 진행, '' 전체 — 전체는 500건에서 잘림), PRJ_AUTH 과제권한(1 본인, 2 담당, 9 전체)
    projectsFallbackService: 'rmain_0005_01_r001',                      // 종료 90일 이내 진행과제 (대체 경로)
    cardsService: 'rtask_0008_t05_01_r001',
    cardsInput: '{"SEARCH_GB":"1","CARD_DATE_GBN":"1"}',
    budgetService: 'rcomm_0041_01_r004',                      // 과제정보 > 자금현황 > 비목별 잔액 (예산기준 10:과제예산)
    budgetInput: '{"REQ_CNT":"-1","RES_CD":"","PROC_TYP_CD":"","INCLUDE_TAX":"Y"}',  // RES_CD 비우면 전체 재원
    budgetBaseService: 'rcomm_0041_01_r006',                  // 예산기준 20:본예산 과제의 비목별 잔액 (BIZSECTION_CD, BGT_YEAR 필요)
    projectDetailService: 'rcomm_0102_01_r001'                // 과제 상세 (BGT_STD_CD 예산기준, BIZSECTION_CD, TOT_DIR_AMT/TOT_STD_AMT)
  }
};
function parseJson(s, fallback) { try { return s ? JSON.parse(s) : (fallback || {}); } catch (e) { return fallback || {}; } }
/** 기본값 위에 겹친 설정 — 넘긴 것이 없으면 rerp 기본값 그대로. */
export const settingsOf = (over) => ({ ...DEFAULTS, ...(over || {}), adv: { ...DEFAULTS.adv, ...((over && over.adv) || {}) } });

const g = { KRX_FMT: FMT, KRX_SETTINGS: { DEFAULTS, parseJson } };
const F = g.KRX_FMT;
const BASE = 'https://rnd.krs.co.kr';

function err(kind, message, extra) { return Object.assign(new Error(message || kind), { kind }, extra || {}); }

async function call(service, input) {
  const body = '_JSON_=' + encodeURIComponent(encodeURIComponent(JSON.stringify(input || {})));
  let res;
  try {
    res = await fetch(`${BASE}/${service}.jct`, {
      method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'follow',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'charset': 'utf-8' },
      body
    });
  } catch (e) { throw err('network', '네트워크 오류: ' + (e && e.message || e)); }
  const ct = res.headers.get('content-type') || '';
  const buf = await res.arrayBuffer();
  const m = /charset=([^;]+)/i.exec(ct);
  const charset = m ? m[1].trim().toLowerCase() : 'euc-kr';
  let text;
  try { text = new TextDecoder(charset).decode(buf); } catch (e) { text = new TextDecoder('euc-kr').decode(buf); }
  if (!/json/i.test(ct)) {
    if (/html/i.test(ct) || /<html/i.test(text)) throw err('login', '로그인 페이지가 반환되었습니다.', { status: res.status });
    throw err('badresponse', `예상치 못한 응답(${res.status} ${ct})`, { sample: text.slice(0, 200) });
  }
  let data;
  try { data = JSON.parse(text); } catch (e) { throw err('badresponse', 'JSON 파싱 실패', { sample: text.slice(0, 200) }); }
  const head = data.COMMON_HEAD || {};
  if (head.ERROR) {
    const code = String(head.CODE || '');
    const msg = String(head.MESSAGE || '');
    const kind = (code === 'GWM0001' || /세션|로그인|사용자 정보/.test(msg)) ? 'login' : 'service';
    throw err(kind, `${service}: ${msg || code}`, { code, service });
  }
  return data;
}

function describe(e) { return { kind: (e && e.kind) || 'unknown', message: String((e && e.message) || e) }; }

async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

/* 과제 목록 원본 행 (과제 검색 팝업 rcomm_0009_01_r001 과 동일). 입력: SEARCH_GB = 진행상태 코드(콤보 RD0008: 10 진행, 30 완료 …, '' 전체), PRJ_AUTH = 과제권한(1 본인과제, 2 담당과제, 9/'' 전체)
 * 서버는 최대 500건만 돌려준다(2026-09-24 실측: 전체 조회가 정확히 500건이라 진행 중인 과제가 빠짐). 그래서 기본 입력은 진행(10)만 조회하고,
 * 전체('')로 받아 500건이 되면 진행(10)만 한 번 더 받아 합친다 — 진행 과제는 500건보다 훨씬 적어 잘리지 않는다.
 * 돌려주는 값: { recs, calls: [{ input, count, error }], capped(절단이 있었는지), firstErr } */
const PROJECT_LIST_CAP = 500;
async function fetchProjectRecs(settings) {
  const adv = settings.adv || {};
  const primary = adv.projectsService || 'rcomm_0009_01_r001';
  const base = Object.assign({ SEARCH_NM: '', SEARCH_GB: '10', GUBUN: 'A', PRJ_AUTH: '' }, g.KRX_SETTINGS.parseJson(adv.projectsInput));
  const out = { recs: [], calls: [], capped: false, firstErr: null };
  const one = async (input) => {
    const c = { input, count: 0, error: null };
    out.calls.push(c);
    try { const data = await call(primary, input); const recs = Array.isArray(data.REC) ? data.REC : []; c.count = recs.length; return recs; }
    catch (e) { if (e.kind === 'login') throw e; c.error = describe(e).message; if (!out.firstErr) out.firstErr = e; return []; }
  };
  const recs = await one(base);
  if (recs.length >= PROJECT_LIST_CAP) {
    out.capped = true;
    if (String(base.SEARCH_GB || '') !== '10') {   // 전체(또는 다른 상태) 조회가 잘렸으면 진행 과제만 한 번 더 받아 합친다
      const more = await one(Object.assign({}, base, { SEARCH_GB: '10' }));
      const seen = new Set(recs.map((r) => [r.PRJ_NO, r.ANL].join('#')));
      for (const r of more) { const k = [r.PRJ_NO, r.ANL].join('#'); if (!seen.has(k)) { seen.add(k); recs.push(r); } }
    }
  }
  out.recs = recs;
  return out;
}
/* 과제 목록
 * 1순위: rcomm_0009_01_r001 (과제 검색 팝업과 동일, fetchProjectRecs — 500건 절단 대응)
 * 2순위: rmain_0005_01_r001 (종료 90일 이내 진행과제) - 1순위가 실패하거나 0건일 때 */
async function fetchProjects(settings) {
  const adv = settings.adv || {};
  const primary = adv.projectsService || 'rcomm_0009_01_r001';
  const pr = await fetchProjectRecs(settings);
  let recs = pr.recs;
  const firstErr = pr.firstErr;
  if (!recs.length) {
    const fb = adv.projectsFallbackService || 'rmain_0005_01_r001';
    if (fb && fb !== primary) {
      try { const data = await call(fb, { SEARCH_GB: 'D', STD_DT: F.ymd(new Date()) }); recs = Array.isArray(data.REC) ? data.REC : []; }
      catch (e) { if (e.kind === 'login') throw e; if (firstErr) throw firstErr; }
    } else if (firstErr) { throw firstErr; }
  }
  const kw = String(settings.projectStatusKeyword == null ? '진행' : settings.projectStatusKeyword).trim();
  if (kw) {
    const f = recs.filter((r) => String(r.PROG_STS_NM || '').includes(kw));
    if (f.length) recs = f;
  }
  const byNo = new Map();
  for (const r of recs) {
    const no = String(r.PRJ_NO || '').trim();
    if (!no) continue;
    const prev = byNo.get(no);
    if (!prev || F.num(r.ANL) >= F.num(prev.ANL)) byNo.set(no, r);
  }
  const out = Array.from(byNo.values()).map((r) => ({
    prjNo: String(r.PRJ_NO).trim(),
    prjNm: String(r.PRJ_NM || '').trim(),
    rspr: String(r.PRJ_RSPR_EMP_NM || '').trim(),
    chrg: String(r.PRJ_CHRG_GRP_NM || '').trim(),
    anl: String(r.ANL || ''),
    status: String(r.PROG_STS_NM || '').trim(),
    stDt: String(r.RCH_ST_DT || ''),
    endDt: String(r.RCH_END_DT || ''),
    termCnt: r.TERM_CNT == null ? null : F.num(r.TERM_CNT),
    cards: [], count: 0, amount: 0, error: null
  }));
  out.sort((a, b) => (b.stDt || '').localeCompare(a.stDt || ''));
  Object.assign(out, { capped: pr.capped, calls: pr.calls });   // collect · 진단용 (500건 절단 여부, 호출 내역)
  return out;
}

function dateRange(settings) {
  const today = new Date();
  return {
    START_DATE: F.ymd(F.addMonths(today, -Math.abs(F.num(settings.monthsBack) || 6))),
    END_DATE: F.ymd(F.addMonths(today, Math.abs(F.num(settings.monthsForward) || 1)))
  };
}

/* 과제정보 > 카드 탭 > 카드사용내역 (SEARCH_GB 1=미청구) */
async function fetchCards(prjNo, settings) {
  const adv = settings.adv || {};
  const input = Object.assign({ USEFAC_SEQ_NO: adv.usefacSeqNo || '10', PRJ_NO: prjNo, SEARCH_GB: '1', CARD_DATE_GBN: '1', CARD_NO: '' },
    dateRange(settings), g.KRX_SETTINGS.parseJson(adv.cardsInput), { PRJ_NO: prjNo });
  const data = await call(adv.cardsService || 'rtask_0008_t05_01_r001', input);
  const recs = Array.isArray(data.REC) ? data.REC : [];
  const cards = recs.map((r) => ({
    cardNo: String(r.CARD_NO || ''),
    tail: F.cardTail(r.CARD_NO, 8),
    user: String(r.USER_NM || '').trim(),
    usedDate: String(r.USED_DATE || ''),
    usedTime: String(r.USED_TIME || ''),
    shop: String(r.SHOP_NAME || '').trim(),
    amount: F.num(r.USED_COST),
    apprNo: String(r.APPRNO || ''),
    cardDiv: String(r.PRJ_CARD_DIV_NM || ''),
    apprPlan: String(r.APPR_PLAN_DATE || ''),
    abroad: String(r.AB_LO_CLSS || ''),
    prjNo: String(r.PRJ_NO || '').trim()
  }));
  cards.sort((a, b) => (b.usedDate + b.usedTime).localeCompare(a.usedDate + a.usedTime));
  return cards;
}

/* 소수점 n자리 절사 (R&D ERP rderp.common.trunc 과 동일하게 반올림하지 않음) */
function trunc(v, n) { const m = Math.pow(10, n || 0); return Math.trunc((Number(v) || 0) * m) / m; }
/* 집행비율(%) = 승인액 / 예산액. R&D ERP 자금현황과 같이 둘 다 양수일 때만 계산, 소수 2자리 절사 */
function execRate(appr, bgt) { return (bgt > 0 && appr > 0) ? trunc(appr / bgt * 100, 2) : 0; }

/* 과제정보 > 자금현황 > 비목별 잔액
 * 예산기준 10(과제예산): rcomm_0041_01_r004 → REC[].RES_NM, MARK_EXP_NM, BGT_AMT(예산액 A), APPR_AMT(승인액 B), BAL_AMT(예산잔액 A-B), DIR_COST_YN, PSNL_COST_YN
 * 예산기준 20(본예산):   rcomm_0041_01_r006 → REC[].BGT_ITEM_NM, ATIT_NM, BGT_AMT, APPR_AMT, BAL_AMT (0건이면 과제 상세로 예산기준을 확인해 대체 호출)
 * 집행비율은 화면 스크립트(rderp_bgtAmtInfo.js)처럼 클라이언트에서 계산.
 * REQ_AMT(신청금액 B)는 신청·요구승인 등 승인 전 결의서 금액(ERP 자금현황 요약의 미승인액과 같음)이고, BAL_AMT 는 BGT_AMT − APPR_AMT − REQ_AMT
 * (2026-09-27 실서버 확인: 연구활동비 43,700,000 − 승인 19,712,839 − 신청 148,500 = 잔액 23,838,661). 승인 전 금액은 승인액 ÷ 예산액인 집행비율에는 없으므로 확장이 더한다 */
async function fetchBudget(prjNo, settings) {
  const adv = settings.adv || {};
  const usefac = adv.usefacSeqNo || '10';
  const base = { USEFAC_SEQ_NO: usefac, PRJ_NO: prjNo, REQ_CNT: '-1', RES_CD: '', PROC_TYP_CD: '', INCLUDE_TAX: 'Y' };
  const input = Object.assign(base, g.KRX_SETTINGS.parseJson(adv.budgetInput), { USEFAC_SEQ_NO: usefac, PRJ_NO: prjNo });
  // 비목 포함/제외: 설정 페이지에서 고른 비목(budgetItemInclude)은 그대로, 고르지 않은 비목은 기본 키워드(인건비·연구수당·간접비)가
  // 비목명/예산항목명에 들어가면 제외. 제외 비목은 합계·비율은 물론 패널 표에서도 빠짐 (공백/대소문자 무시)
  const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const chosen = settings.budgetItemInclude || {};
  const defKeys = (settings.budgetExcludeDefault || []).map(norm).filter(Boolean);
  const isExcluded = (exp, item) => {
    const key = String(exp || item || '').trim();
    if (key && Object.prototype.hasOwnProperty.call(chosen, key)) return chosen[key] === false;
    return defKeys.some((k) => norm(exp).includes(k) || (item && norm(item).includes(k)));
  };
  const row = (r, exp, item) => {
    const bgt = F.num(r.BGT_AMT), appr = F.num(r.APPR_AMT);
    const e = String(exp || '').trim(), it = String(item || '').trim();
    return {
      res: String(r.RES_NM || '').trim(), resCd: String(r.RES_CD || '').trim(), expCd: String(r.EXP_CD || r.BGT_ITEM_CD || '').trim(),
      exp: e, item: it,
      cary: F.num(r.CARY_AMT), inter: F.num(r.INTER_AMT), calcBgt: F.num(r.CALC_BGT_AMT),
      bgt, purch: F.num(r.PURCH_REQ_AMT), req: F.num(r.REQ_AMT), appr, adj: F.num(r.ADJ_AMT),
      bal: r.BAL_AMT == null || r.BAL_AMT === '' ? bgt - appr : F.num(r.BAL_AMT),
      rate: execRate(appr, bgt),
      dir: String(r.DIR_COST_YN || '').trim() === 'Y', psnl: String(r.PSNL_COST_YN || '').trim() === 'Y',
      excluded: isExcluded(e, it)
    };
  };
  let std = '10';
  let items = [];
  const data = await call(adv.budgetService || 'rcomm_0041_01_r004', input);
  items = (Array.isArray(data.REC) ? data.REC : []).map((r) => row(r, r.MARK_EXP_NM || r.EXP_NM || r.BGT_ITEM_NM, r.BGT_ITEM_NM));
  let detail = null;
  if (!items.length && adv.projectDetailService !== '') {
    // 본예산(20) 과제는 다른 서비스가 비목을 돌려준다. 과제 상세에서 예산기준을 확인해 대체 호출
    try { detail = await call(adv.projectDetailService || 'rcomm_0102_01_r001', { USEFAC_SEQ_NO: usefac, PRJ_NO: prjNo }); }
    catch (e) { if (e.kind === 'login') throw e; }
    if (detail && String(detail.BGT_STD_CD || '').trim() === '20') {
      std = '20';
      const yr = String(new Date().getFullYear());
      const d2 = await call(adv.budgetBaseService || 'rcomm_0041_01_r006',
        { USEFAC_SEQ_NO: usefac, PRJ_NO: prjNo, REQ_CNT: input.REQ_CNT || '-1', BIZSECTION_CD: String(detail.BIZSECTION_CD || ''), BGT_YEAR: yr });
      items = (Array.isArray(d2.REC) ? d2.REC : []).map((r) => row(r, r.BGT_ITEM_NM || r.MARK_EXP_NM, r.ATIT_NM));
    }
  }
  const sum = (k, pred) => items.reduce((s, x) => s + ((!pred || pred(x)) ? x[k] : 0), 0);
  // 합계·비율은 제외 비목을 뺀 값. 제외분은 별도 집계해 화면에 표시
  const inc = (x) => !x.excluded;
  const bgtAmt = sum('bgt', inc), apprAmt = sum('appr', inc), balAmt = sum('bal', inc), reqAmt = sum('req', inc);   // reqAmt: 승인 전(신청) 금액
  const exclItems = items.filter((x) => x.excluded);
  // R&D ERP 자금현황 상단 "직접비 집행비율(인건비 포함)": 직접비 또는 인건비 비목만 합산 (양쪽 모두인 비목은 한 번만). ERP 값 그대로라 제외 설정과 무관
  const dBgt = sum('bgt', (x) => x.dir || x.psnl), dAppr = sum('appr', (x) => x.dir || x.psnl);
  return {
    std, items, bgtAmt, apprAmt, balAmt, reqAmt,
    rate: execRate(apprAmt, bgtAmt),
    dirRate: dBgt > 0 ? trunc(dAppr / dBgt * 100, 3) : null, dirBgt: dBgt, dirAppr: dAppr,
    exclCount: exclItems.length, exclBgt: sum('bgt', (x) => x.excluded), exclAppr: sum('appr', (x) => x.excluded),
    exclNames: Array.from(new Set(exclItems.map((x) => x.exp || x.item))).filter(Boolean),
    resCount: new Set(items.map((x) => x.resCd || x.res)).size
  };
}

/* [옮기며 뺀 것] rnd-api.js collect() 가 과제마다 하던 미청구·승인전 합산(원본 831~846행) — 과제집행비율 보기: 이 과제 카드의 미청구액(공용 거래 제외)과 자금현황의 승인 전 신청금액(reqAmt)을
 * 아직 승인되지 않은 집행으로 보고 비율에 반영. 신청금액은 ERP 예산잔액(BAL_AMT)에 이미 빠져 있으므로 잔액에서는 미청구액만 더 뺀다. b 는 fetchBudget 결과(그 자리에서 채운다) */
function withPending(b, unbilled, unbilledCount) {
  b.unbilled = unbilled;
  b.unbilledCount = unbilledCount;
  b.pending = b.unbilled + (b.reqAmt || 0);               // 미청구액 + 승인 전 신청금액
  b.execAmt = b.apprAmt + b.pending;                      // 승인액 + 미청구액 + 승인 전
  b.balAfter = b.balAmt - b.unbilled;                     // 예산잔액(신청금액은 이미 차감됨) - 미청구액
  b.rateAll = execRate(b.execAmt, b.bgtAmt);              // (승인액 + 미청구액 + 승인 전) / 예산액
  b.pendingRate = b.bgtAmt > 0 && b.pending > 0 ? trunc(b.pending / b.bgtAmt * 100, 2) : 0;
  b.unbilledRate = b.bgtAmt > 0 && b.unbilled > 0 ? trunc(b.unbilled / b.bgtAmt * 100, 2) : 0;
  return b;
}

/* eClass SSO 로 R&D ERP 세션 만들기 — 세션이 풀렸을 때 background.js rndAutoLogin 이 부른다 (2026-09-26 CDP 로 실제 브라우저 흐름을 추적해 확인).
 * eClass 홈의 R&D ERP 아이콘(mainCommon.rERP)은 rERP 쪽 페이지 /jsp/rderp/main/sso_login_krs_view.jsp?SSO_PAGE_GB=A 를 SSO_RESULT 창으로 열고, 그 페이지가
 *  ① eClass 의 loginCheck_json.aspx 를 JSONP 로 불러 { UID(30자 암호화 ID), SID(36자 세션 GUID) } 를 받는다 (eClass 쿠키 필요 · 둘 중 하나라도 비면 eClass 로그인 페이지로 보냄)
 *  ② /jsp/rderp/main/sso_login_krs.jct 에 _JSON_={UID,SID,SSO_PAGE_GB:'A'} 로 POST → JSON { URL, COMMON_HEAD } 와 함께 새 JSESSIONID 발급 (.act 로 보내면 JSON 이 아니라 view 페이지 HTML 이 온다)
 *  ③ 그 URL(rderp_layoutMain.act)에 SYS_LOGIN=Y&SSO_PAGE_GB=A 를 폼 POST 하면 세션이 로그인 상태가 된다 (응답은 레이아웃 HTML, 읽지 않음)
 * 확장 출처에서도 같은 요청이 통하며 rERP 는 Referer·Origin 을 보지 않는다. 비밀번호는 오가지 않고 UID·SID 는 저장하지 않는다.
 * 반환 { ok:true, url }. 실패는 kind 'eclass-login'(eClass 세션 없음 → 사용자가 eClass 에 로그인해야 함) | 'network' | 'sso'(응답 이상) | call 의 'service'/'login'(COMMON_HEAD 오류·HTML) 로 throw */
const SSO = {
  loginCheck: 'https://eclass.krs.co.kr/intra/intranet/Main_N/json/loginCheck_json.aspx',
  dir: 'jsp/rderp/main',   // sso_login_krs_view.jsp · sso_login_krs.jct 가 있는 경로
  pageGb: 'A'
};
async function ssoLogin() {
  let res, text = '';
  try { res = await fetch(`${SSO.loginCheck}?callback=cb&_=${Date.now()}`, { credentials: 'include', cache: 'no-store', redirect: 'follow' }); text = await res.text(); }
  catch (e) { throw err('network', 'eClass loginCheck 를 받지 못했습니다: ' + String((e && e.message) || e)); }
  const uid = (text.match(/"UID"\s*:\s*"([^"]*)"/) || [])[1] || '', sid = (text.match(/"SID"\s*:\s*"([^"]*)"/) || [])[1] || '';
  if (!uid || !sid) throw err('eclass-login', `eClass 로그인이 풀려 R&D ERP 자동 로그인(SSO)을 못 했습니다 (loginCheck HTTP ${res.status}${res.redirected ? ' → ' + res.url : ''})`);
  const dat = await call(`${SSO.dir}/sso_login_krs`, { UID: uid, SID: sid, SSO_PAGE_GB: SSO.pageGb });   // 새 JSESSIONID 는 브라우저 쿠키 저장소에 들어간다
  const next = String(dat.URL || '').trim();
  if (!next) throw err('sso', 'sso_login_krs 응답에 URL 이 없습니다', { sample: JSON.stringify(dat).slice(0, 200) });
  const url = new URL(next, `${BASE}/${SSO.dir}/`).href;
  let r2;
  try {
    r2 = await fetch(url, { method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'follow',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `SYS_LOGIN=Y&SSO_PAGE_GB=${SSO.pageGb}` });
    await r2.arrayBuffer();   // 레이아웃 HTML — 읽지 않고 버림
  } catch (e) { throw err('network', 'SSO 마무리 요청(SYS_LOGIN) 실패: ' + String((e && e.message) || e)); }
  if (!r2.ok) throw err('sso', `SSO 마무리 요청(SYS_LOGIN) HTTP ${r2.status}`, { url });
  return { ok: true, url };
}

export { BASE, call, describe, pool, fetchProjectRecs, fetchProjects, dateRange, fetchCards, trunc, execRate, fetchBudget, withPending, ssoLogin };
export default { BASE, DEFAULTS, settingsOf, call, describe, pool, fetchProjectRecs, fetchProjects, dateRange, fetchCards, trunc, execRate, fetchBudget, withPending, ssoLogin };
