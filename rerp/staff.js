// kr_ext_rerp `lib/staff.js` 를 그대로 옮긴 것 — IIFE 머리와 꼬리의 `g.KRX_STAFF = …` 를 export 로만 바꿨다(load/save 의 chrome.storage 는 그대로 — 여기서는 쓰지 않는다). 출처·갱신 규칙은 rerp/README.md.
/* 참여연구원 참여율·지급액 계산 (사업비 › 사업비 변경 메뉴의 머리 — 0.8.7, 2026-10-18). eClass 콘텐츠스크립트 / 팝업 / 테스트 공용, 순수 함수(DOM·chrome 없음 — load/save 만 storage).
 * 계획은 **과제마다 연차별로** 하나(2026-10-18 사용자 지정 "우선 각 과제별로 년차별로 수정할 수 있게") — 키 "과제번호@연차", 연차의 달 범위는 R&D ERP 가 주는 현재 연차 기간에서 셈한다(yearSpan).
 * KRS WORKSPACE(kr_ext_workspace)의 R&D 탭 참여인력 칸에서 하던 계산을 이쪽으로 옮긴 것이다(2026-10-18 사용자 지정: "참여연구원 계산하는거 관련해서는 kr_ext_rerp 로 넘기고 …
 * 참여연구원 참여율 및 지급액 월별 나누고 최대/전체 산정하는 기능들을 이관"). WORKSPACE 는 이 파일을 rerp/staff.js 로 그대로 옮겨(IIFE → export) rERP 에 등록된 값을 보이기만 한다.
 *
 * 규칙(rERP 인건비지급계획 팝업 실측 — kr_ext_workspace rerp/reference.md):
 *  - 관리 대상은 **월별 지급금액**(plan — 달마다 원)이다. 참여율은 100% 가 찼는지 보는 확인값: 연간 = Σ월별 ÷ (월급여 × 참여개월), 월 = 그 달 지급 ÷ 월급여.
 *    둘 다 rERP 가 보이는 올림(퍼센트 넷째 자리 반올림 뒤 셋째 자리 올림 — rtask_0013_12.js PAY_LIMT_AMT_change)으로 적는다. 월 최대 참여율은 연간과 같아도 늘 보인다.
 *  - 월급여 = rERP 참여인력의 지급한도액(PAY_LIMT_AMT). 직접 적은 값(manual)이 있으면 그것이 앞선다. 계획서 급여총액(salary)이 있으면 ÷12 천원 절삭이 대신이다(WORKSPACE 가 넣는 값).
 *  - 변경은 **적용일부터**(종료일까지 — 날짜까지, 2026-10-19 사용자 "참여인력을 날일까지 계산해서 수정할 수 있게") — 그 앞의 지급은 그대로. 0%(제외)·참여율·월 지급금액 가운데 하나로. 사람 더하기도 같은 길.
 *    달 중간의 날이면 그 달은 **날 수 비율**(일할)로 나눈 조각 둘이 된다: 조각 금액 = round천원(월 금액 × 참여일 ÷ 그 달 일수). 참여개월도 날 수 비율의 합(8.53 처럼 소수)으로 센다.
 *  - 사람마다 **기간 구간**(runs)을 보인다(2026-10-19 사용자 "참여 기간별로 표기 … 2줄로"): 적용일·종료일 경계(cuts)와 제외(0원) 전환·달이 끊기는 곳에서 구간이 갈리고, 구간마다 기간·계상인건비·참여율(= Σ지급 ÷ (월급여 × 개월)).
 *    rERP 에서 받을 때(peopleOfErp)는 지급기간 행의 경계가 구간 경계인데, 자료생성의 마지막 달 잔액 행(한 달짜리 마지막 행이 앞 행과 (앞 행 달 수 + 1)천원 미만 차이)은 같은 구간으로 본다. 양쪽이 같은 금액의 온달인 경계는 지운다(pruneCuts).
 *  - 같은 사람의 과제 참여율 합이 100% 를 넘으면 **알림만**(막지 않는다). rERP 의 다른 과제 월별 합(rtask_0013_12_r003 ETC_PART_RT)을 쓴다.
 *  - 참여자가 없는 기간은 **이전 기간 참여연구원의 지급 비율**로 인건비 예산을 나눠 초기화한다(합이 정확히 예산). 합과 예산의 차는 **초과금·부족금**으로 보인다(budgetDiff — 2026-10-19 사용자 "참여율 변경하면 초과금, 부족금 이게 표시가 되어야지"; 0.8.7 의 "넘는 편집은 막는다"는 뺌).
 *  - 균등 분할은 앞달 ceil천원(총 ÷ N)·마지막 달 잔액 — rERP 자료생성이 저장하는 행(1,165,000×8 + 1,159,000)과 같다. 일부 달 조각은 그 날 수 비율(splitByFrac).
 *  - **나머지의 %**(applyShare — 2026-10-19 사용자 "1명 삭감하고 1명, 2명, 3명 추가될 때 … 100% … 50% … 숫자를 넣어서 지급금액을 자동계산", 처음 이름은 부족금의 %): 인건비 예산에서 다른 사람들·이 사람의 기간 밖 지급을 뺀 나머지(shareLeft)의 n% 를 적용일~종료일에 나눈다(setTotal 의 나눔).
 *  - **예산에 맞추기**(fitBudget — 같은 날 "n월 개 선택한 후 .. 초과금에 맞춰서 줄이거나, 부족금 만큼 늘리거나"): 적용일~종료일의 지급을 초과금만큼 줄이거나 부족금만큼 늘려(달마다 고르게 — 달 사이의 차이는 그대로) 합을 예산과 같게.
 *  - **기준 금액에서 증감**(scaleRange — 같은 날 "기준 금액에서 증액, 감소를 10% 간격으로 … 드래그로 선택"): 적용일~종료일의 지급을 조각마다 ±n%(round천원 — 달 사이의 비율은 그대로).
 *  - **MAX**(maxRate — 2026-10-20 사용자 "참여율은 MAX/ 최대 들어 갈 수 있는 것으로 넣어줘. 표기도 해주고. 이거 이상 못넘어 가게 하고 … 우측에 균등 왼쪽에 MAX"): 적용일~종료일에 넣을 수 있는 최대 참여율 — 예산 나머지를 넘지 않는 가장 큰 0.01% 와 100% 규칙(100 − 다른 과제 합) 가운데 작은 것. 증감 줄 [MAX] 칸과 자료 요청 응답 반영(응답 참여율이 넘으면 이 값으로)이 쓴다.
 *  - **균등**(evenRange — 2026-10-20 사용자 "예산 맞추기 옆에 매월 동일 금액/남은 기간동안 설정하는거 넣어줘 … '균등'"): 적용일~종료일의 지급을 **달마다 같은 금액**(합 ÷ 개월, 천원 반올림 — 일부 달은 날 수 비율)으로 — 합은 천원 단위로 달라질 수 있다(앞달 올림·마지막 잔액이 아님: 같은 날 "균등이 안되는데" — 마지막 달만 다른 값이 남았음).
 *  - **이전 차년도에서 가져오기**(carryOver — 2026-10-20 사용자 "연구원, 월급, 참여율 정도 가져오면 되겠지? 기간은 전체"): 앞 연차 사람들의 성명·역할·월급여와 마지막 구간의 참여율을 이 연차 기간 전체에(달마다 floor천원(월급여 × %)).
 *
 * 저장(storage.local.staffPlans) = { ["과제번호@연차"]: plan }  plan = { prjNo, year(연차 1~), prjNm, from, to('YYYY-MM' — 계획 기간), budgetPay(인건비 예산 원 | null), basis('rerp'|'plan'), src('erp'|'init'|'manual'),
 *   (연차를 두기 전(0.8.7 처음) 저장분은 키가 과제번호뿐이고 year 가 없다 — lib/staff-ui.js adopt 가 그 과제의 현재 연차 계획으로 옮긴다)
 *   people[{ id, name, role, salary, pay, rate, months, manual, allowance(원 — 자료 요청 응답으로 받은 올해 잔여 연구수당, 참고 값), erp: { monthly, prjNo, at, req, seq, others[{ ym, rate, amt }] } | null,
 *     plan[{ ym, amt, from?, to? }](지급 조각 — 달 하나 안, from·to 'YYYY-MM-DD' 는 그 달의 일부만 참여할 때의 첫날·마지막 날; 없으면 달 전체. 한 달에 조각이 여럿일 수 있다),
 *     cuts['YYYY-MM-DD' …](기간 구간의 경계 — 이 날부터 새 구간) }], at(마지막 수정 시각), by(누가), note,
 *   paid({ from, through('YYYY-MM' — rERP 에서 지급이 끝난 첫 달·마지막 달), amt(그 달까지의 등록 지급 합 원), appr(rERP 자금현황 인건비 비목 승인액 원), left(승인액 − 합), at(조회 시각), src:'erp' } — 있을 때만) }
 *   지급 완료(paid — 2026-10-19 사용자 "몇월까지 지급한게 나오는구나? 그럼 지급된 월은 수정 못하게 해줘. 월 우측에 지급 이라고 하던지 … sharepoint 에도 제공해줘. workspace도 알아야지"): rERP 는 인건비를 매달 올리지 않고 행정이 몇 달치를
 *   결의서로 올리면 자금현황 인건비 비목의 **승인액**이 그만큼 오른다(2026-10-19 실측 2026-0063-01: 승인 17,465,000 = 4~8월 두 사람 등록 지급 합, 지출현황 "참여연구원 인건비(4월~8월)" 결의서 한 줄; 지급계획 행의 처리구분은 지급 뒤에도 미지급 그대로라 쓰지 않음).
 *   그래서 승인액을 등록 지급계획(peopleOfErp)의 달 합으로 첫 달부터 메워 몇 월까지 지급됐는지 셈하고(paidThroughOf — 현재 연차 계획에만), 그 달까지는 **잠근다**: applyChange(✎·＋·제외·부족금)는 적용일이 그 안이면 거부, setTotal·setRate(칸 편집)는 그 뒤 달만 바꾼다(lock = paid.through).
 *   paid 는 연차 계획과 함께 공유 파일(<n>차년도.json staff.plans[].paid)에 실려 KRS WORKSPACE 도 읽는다(병합은 lib/staff-sync.js — paid.at 큰 쪽)
 *   지운 연차 계획은 staffPlansDeleted 묘비(remove). 공유 (Plus) 가 켜져 있으면 백그라운드(background.js shareSync)가 과제 폴더의 연차 파일(<n>차년도.json 의 staff·budget 칸, SharePoint 폴더)과 연차별로 맞춘다(lib/staff-sync.js merge — at 이 큰 쪽이 이김)
 * 단위: 저장은 원, 화면·글은 천원. 달은 'YYYY-MM'. 렌더러(lib/staff-ui.js)가 이 API 로 표와 폼을 그린다 */
const KEY = 'staffPlans';
const DKEY = 'staffPlansDeleted';   // 지운 연차 계획의 묘비 { ["과제번호@연차"]: 지운 시각 } — 공유 (Plus) 의 병합(lib/staff-sync.js merge)이 삭제를 전파하는 데 씀. 90일 지나면 버림
const TOMB_TTL = 90 * 24 * 3600 * 1000;
const STAFF_MAX = 30;
const BASES = Object.freeze(['plan', 'rerp']);
const BASIS_LABEL = Object.freeze({ plan: '계획서 연봉', rerp: 'rERP 연봉' });
const SOURCES = Object.freeze(['erp', 'init', 'manual', 'yaml', 'roster']);
const MODES = Object.freeze(['rate', 'amt', 'exclude']);
const PLAN_MAX = 240;
const CUTS_MAX = 120;   // 사람 하나의 기간 구간 경계 수 상한
const YEAR_MAX = 60;   // 연차 번호 상한
const BUDGET_ITEMS = Object.freeze(['인건비', '연구시설·장비비', '연구재료비', '연구활동비', '연구수당', '간접비']);   // 예산 칸의 기본 비목 (연구개발계획서의 여섯 비목 — kr_ext_workspace src/rnd.js BUDGET_ITEMS 와 같음)
const BUDGET_MAX = 30;

const text = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v) => { if (v === '' || v == null) return null; const n = Number(typeof v === 'string' ? v.replace(/[,\s%]/g, '') : v); return Number.isFinite(n) ? n : null; };
/* 원 — 0 이상의 정수. 글이면 쉼표·원을 걷는다. 못 읽으면 null */
const money = (v) => { if (typeof v === 'string') v = v.replace(/[,\s원₩]/g, ''); if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };
const int = (v, lo, hi) => { const n = num(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const pad2 = (n) => String(n).padStart(2, '0');
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nameKeyOf = (s) => String(s == null ? '' : s).replace(/\s/g, '');
const sameName = (a, b) => !!nameKeyOf(a) && nameKeyOf(a) === nameKeyOf(b);
const comma = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : '');
/* 원 → 천원 글 "10,479" */
const thousand = (n) => (Number.isFinite(n) ? comma(Math.round(n / 1000)) : '');
/* 천원 칸의 글 → 원(숫자만 적으면 천원). 못 읽으면 null */
const thousandOf = (v) => { const n = money(v); return n == null ? null : n * 1000; };

/* ---------- 달 ---------- */
const isYm = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
/* 'YYYY-MM-DD' / yyyyMMdd / yyyyMM → 'YYYY-MM'. 아니면 '' */
const ymOf = (s) => { const d = String(s == null ? '' : s).replace(/\D/g, ''); return d.length >= 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}` : ''; };
function addMonths(ym, k) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`;
}
/* from 부터 to 까지의 달(둘 다 포함). 거꾸로면 빈 목록. 240달 한도 */
function ymRange(from, to) {
  if (!isYm(from) || !isYm(to) || to < from) return [];
  const out = [];
  for (let ym = from; ym <= to && out.length < PLAN_MAX; ym = addMonths(ym, 1)) out.push(ym);
  return out;
}
/* 기간({ start|from, end|to } — 날짜나 달)의 달들. 없으면 빈 목록 */
const spanMonths = (span) => ymRange(ymOf(span && (span.from || span.start)), ymOf(span && (span.to || span.end)));
/* '2026-04'~'2026-12' → "4~12월", 해가 다르면 "'26.4~'27.3월", 한 달이면 "12월" */
function ymText(from, to) {
  if (!isYm(from)) return '';
  const m = (ym) => String(Number(ym.slice(5)));
  const yy = (ym) => `'${ym.slice(2, 4)}.`;
  if (!isYm(to) || to === from) return `${m(from)}월`;
  return from.slice(0, 4) === to.slice(0, 4) ? `${m(from)}~${m(to)}월` : `${yy(from)}${m(from)}~${yy(to)}${m(to)}월`;
}
/* 달 이름 — "4월". 앞 달과 해가 다르면 "'27 1월" */
const monthLabel = (ym, prev = '') => `${prev && prev.slice(0, 4) !== ym.slice(0, 4) ? `'${ym.slice(2, 4)} ` : ''}${Number(ym.slice(5))}월`;

/* ---------- 날 (일 단위 — 참여기간을 날짜까지, 2026-10-19) ---------- */
/* 그 달의 일수 */
const dim = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const isYmd = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) && Number(s.slice(8)) <= dim(s.slice(0, 7));
const monthStart = (ym) => `${ym}-01`;
const monthEnd = (ym) => `${ym}-${pad2(dim(ym))}`;
const utcOf = (ymd) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
const addDays = (ymd, k) => { const d = new Date(utcOf(ymd) + k * 86400000); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
/* a~b 의 날 수(둘 다 포함) */
const dayCount = (a, b) => Math.round((utcOf(b) - utcOf(a)) / 86400000) + 1;
/* 적용일·종료일 입력 → 'YYYY-MM-DD'. 달만 주면('YYYY-MM' · yyyyMM) edge 가 'end' 면 그 달 마지막 날, 아니면 1일. yyyyMMdd 도 받는다. 못 읽으면 '' */
function dateOf(v, edge = 'start') {
  const s = String(v == null ? '' : v).trim();
  if (isYmd(s)) return s;
  const d = s.replace(/\D/g, '');
  if (d.length >= 8) { const t = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`; return isYmd(t) ? t : ''; }
  const ym = ymOf(s);
  return isYm(ym) ? (edge === 'end' ? monthEnd(ym) : monthStart(ym)) : '';
}
/* 지급 조각 { ym, amt, from?, to? } 의 첫날·마지막 날·날 수·달 대비 비율(온달이면 1)·온달인지 */
const segStart = (x) => x.from || monthStart(x.ym);
const segEnd = (x) => x.to || monthEnd(x.ym);
const segDays = (x) => dayCount(segStart(x), segEnd(x));
const segFrac = (x) => (x.from || x.to ? segDays(x) / dim(x.ym) : 1);
const isFull = (x) => !x.from && !x.to;
const round1000 = (n) => Math.round(n / 1000) * 1000;
/* 조각 만들기 — s~e 가 달 전체면 { ym, amt: full }, 일부면 월 금액(full)을 날 수 비율로 나눈 round천원과 from·to */
function makeSeg(ym, full, s, e) {
  if (s <= monthStart(ym) && e >= monthEnd(ym)) return { ym, amt: full };
  const out = { ym, amt: round1000((full * dayCount(s, e)) / dim(ym)) };
  if (s > monthStart(ym)) out.from = s;
  if (e < monthEnd(ym)) out.to = e;
  return out;
}
/* 조각을 s~e 로 자른다 — 금액은 날 수 비율(round천원) */
function clipSeg(x, s, e) {
  const out = { ym: x.ym, amt: round1000((x.amt * dayCount(s, e)) / segDays(x)) };
  if (s > monthStart(x.ym)) out.from = s;
  if (e < monthEnd(x.ym)) out.to = e;
  return out;
}
/* 날짜 기간 글 — 달 전체면 ymText("4~12월" · "12월"), 일부가 있으면 "4.15~12.31"(해가 다르면 "'26.4.15~'27.3.31"). 달('YYYY-MM')을 주면 ymText */
function spanText(from, to) {
  if (!isYmd(from)) return isYm(from) ? ymText(from, to) : '';
  const t = isYmd(to) && to >= from ? to : from;
  const fy = from.slice(0, 7), ty = t.slice(0, 7);
  if (from === monthStart(fy) && t === monthEnd(ty)) return ymText(fy, ty);
  const diffYear = fy.slice(0, 4) !== ty.slice(0, 4);
  const md = (d) => `${diffYear ? `'${d.slice(2, 4)}.` : ''}${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
  return `${md(from)}~${md(t)}`;
}
/* 참여개월 글 — 온달이면 "9", 날 수 비율이 섞이면 "8.53"(둘째 자리) */
const monthsText = (m) => (Number.isFinite(m) ? String(Math.round(m * 100) / 100) : '');

/* ---------- 예산 칸 (연차마다 비목별 계획 — 0.8.7 사업비 변경 화면, kr_ext_workspace R&D 탭의 예산 칸과 같은 꼴) ---------- */
/* 비목 이름 맞추기 — 띄어쓰기·가운뎃점·마침표 무시 */
const itemKeyOf = (s) => String(s == null ? '' : s).replace(/[\s·.]/g, '').toLowerCase();
const isPayItem = (s) => /인건비/.test(String(s || '')) && !/수당/.test(String(s || ''));
/* 저장된 예산 줄 [{ name(비목), plan(계획 원 | null) }] — 배열이 아니면 null(= 아직 안 적음, 기본값을 쓴다). 이름도 금액도 없는 줄은 뺀다 */
function normalizeBudget(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const r of raw) {
    if (out.length >= BUDGET_MAX) break;
    const name = text(r && r.name, 40), plan = money(r && r.plan);
    if (!name && plan == null) continue;
    out.push({ name, plan });
  }
  return out;
}
/* 예산 줄들의 인건비(수당 아님) 계획 합 — 없으면 null */
const budgetPayOf = (budget) => { const hit = (Array.isArray(budget) ? budget : []).filter((r) => isPayItem(r.name) && r.plan != null); return hit.length ? hit.reduce((s, r) => s + r.plan, 0) : null; };
/* 예산 줄 요약 글(천원) — "인건비 35,900 · 연구활동비 66,300 · 합 136,000" */
function budgetText(budget) {
  const rows = (Array.isArray(budget) ? budget : []).filter((r) => r.plan != null);
  if (!rows.length) return '';
  return rows.map((r) => `${r.name || '비목'} ${thousand(r.plan)}`).concat([`합 ${thousand(rows.reduce((s, r) => s + r.plan, 0))}`]).join(' · ');
}

/* ---------- 행정지원 (과제마다 — 연차가 아니라, 2026-10-19 사용자 "행정지원은 서로 변경 가능하고": rerp 와 KRS WORKSPACE 양쪽이 고치고 연차 파일 project.support · supportAt 로 맞춤) ---------- */
const SUPPORT_MAX = 10;   // kr_ext_workspace src/rnd.js SUPPORT_MAX 와 같음
/* 행정지원 [{ name, role, ref }] — 이름(공문 결재선에서 조직도로 찾는 이름) · 맡은 일(행정 담당 …) · 공문 참조자로 넣는가(기본 참). 이름 없는 줄은 버리고 같은 이름은 한 번만(공백 무시) — WORKSPACE normalizeSupport 와 같은 규칙 */
function normalizeSupport(raw) {
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    if (out.length >= SUPPORT_MAX) break;
    const name = text(s && s.name, 40);
    const k = nameKeyOf(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ name, role: text(s && s.role, 40), ref: !(s && s.ref === false) });
  }
  return out;
}
/* 역할 짧은 이름 — 표의 역할 칸(2026-10-19 사용자 "역할은 책임, 참여, 행정 으로 해두면 될듯"): 과제책임자 → 책임, 참여연구원 → 참여, 행정지원 → 행정. 그 밖의 rERP 역할명은 '책임'·'행정' 이 들면 그것, 아니면 그대로. 저장값·TSV 는 그대로 긴 이름 */
const ROLE_SHORT = { 과제책임자: '책임', 참여연구원: '참여', 행정지원: '행정' };
function roleShort(role) {
  const s = String(role || '').trim();
  if (!s) return '';
  if (ROLE_SHORT[s]) return ROLE_SHORT[s];
  return /책임/.test(s) ? '책임' : /행정/.test(s) ? '행정' : s;
}
/* 행정지원 한 줄 — "홍길동(행정 담당·참조), 이몽룡(연구지원)". 없으면 '' */
const supportText = (support) => normalizeSupport(support).map((s) => `${s.name}${s.role || s.ref ? `(${[s.role, s.ref ? '참조' : ''].filter(Boolean).join('·')})` : ''}`).join(', ');

/* ---------- 연차 (과제마다 연차별 계획) ---------- */
/* 계획 키 — "과제번호@연차". 연차가 없으면(연차를 두기 전 저장분) 과제번호만 */
const planKey = (prjNo, year) => { const y = int(year, 1, YEAR_MAX); return y ? `${prjNo}@${y}` : String(prjNo == null ? '' : prjNo); };
const yearLabel = (n) => `${n}차년도`;
/* 과제의 현재 연차 번호(R&D ERP 과제 목록의 ANL) — 모르면 1 */
const anlOf = (p) => int(p && p.anl, 1, YEAR_MAX) || 1;
/* n차년도의 달 범위 — R&D ERP 가 주는 현재 연차 기간(RCH_ST_DT~RCH_END_DT)에서 셈한다: 현재 연차는 그대로, 다음 연차는 현재 연차 종료 다음 달부터 12달씩,
 * 앞 연차는 현재 연차 시작 전 달까지 12달씩(첫 연차가 짧았으면 기간 칸에서 고친다). 기간을 모르면 { from: '', to: '' } */
function yearSpan(p, n) {
  const cur = { from: ymOf(p && p.stDt), to: ymOf(p && p.endDt) };
  if (!isYm(cur.from) || !isYm(cur.to) || cur.to < cur.from) return { from: '', to: '' };
  const a = anlOf(p), k = int(n, 1, YEAR_MAX) || a;
  if (k === a) return cur;
  if (k > a) { const from = addMonths(cur.to, 1 + 12 * (k - a - 1)); return { from, to: addMonths(from, 11) }; }
  const to = addMonths(cur.from, -1 - 12 * (a - k - 1));
  return { from: addMonths(to, -11), to };
}
/* 한 과제의 연차별 계획 — { [연차]: plan }. 연차 없는 옛 계획(키가 과제번호만)은 뺀다 */
function plansOfProject(plans, prjNo) {
  const out = {};
  for (const e of Object.values(plans && typeof plans === 'object' ? plans : {})) if (e && e.prjNo === prjNo && e.year >= 1) out[e.year] = e;
  return out;
}

/* ---------- rERP 식 ---------- */
/* 월급여 — 급여총액(원) ÷ 12 를 천원 자리에서 절삭 */
const monthlyOfSalary = (salary) => (Number.isFinite(salary) && salary > 0 ? Math.floor(salary / 12000) * 1000 : null);
/* rERP 가 보이는 계상률 — 지급금액 ÷ 한도(%)를 넷째 자리에서 반올림한 뒤 셋째 자리에서 올림. 한도가 없으면 null */
function rerpRate(amt, limit) {
  if (!(limit > 0) || !(amt >= 0)) return null;
  return Math.ceil(Number(((amt / limit) * 10000).toFixed(1))) / 100;
}
/* 월평균 참여율도 rerpRate(올림) — 2026-10-19 에는 셋째 자리 내림(floorRate)이었으나 2026-10-20 사용자 "참여율은 보수적으로 … 올림 … 동일하게": 높게 보이는 쪽이 100% 규칙에 안전 */
const MIN_RATE = 10;   // 월평균 참여율(올림)은 이 값을 넘어야 한다(같은 날 사용자 "이게 10%를 초과해야함") — 알림만(checks 'low'), 막지 않는다
/* 그 참여율의 월 지급금액 — floor천원(월급여 × %). rERP 는 금액에서 계상률을 올림(rerpRate)으로 셈하므로 반올림하면 rERP 가 적은 % 보다 0.01 높게 보일 수 있다(26.21% × 8,480,000 = 2,222,608 → 2,223,000 → 26.22%).
 * 내림하면 결과 계상률이 적은 % 와 같거나(천원 단위로 닿으면) 바로 아래이고 절대 넘지 않는다 — 2026-10-20 사용자 "반올림 문제도 rerp 랑 확장이 동일하게 … 금액은 틀리면 안되고 참여율은 보수적으로" */
const amountOfRate = (monthly, rate) => (monthly > 0 && rate >= 0 ? Math.floor((monthly * rate) / 100 / 1000) * 1000 : 0);
/* 총액을 개월에 — 앞달은 ceil천원(총 ÷ N), 마지막 달은 잔액. 합은 총액과 정확히 같다 */
function splitEven(total, n) {
  if (!(n >= 1) || !(total >= 0)) return [];
  if (n === 1) return [Math.round(total)];
  let head = Math.ceil(total / n / 1000) * 1000;
  if (head * (n - 1) > total) head = Math.floor(total / n / 1000) * 1000;
  return [...Array(n - 1).fill(head), Math.round(total - head * (n - 1))];
}

/* ---------- 모양 ---------- */
/* 지급 조각들 — 달·첫날 차례, 같은 달·같은 첫날은 뒤 것이 이김, 겹치는 조각은 앞 것만. 달 전체를 덮는 from·to 는 지운다 */
function normalizePlan(raw) {
  const map = new Map();
  for (const x of Array.isArray(raw) ? raw : []) {
    const ym = text(x && x.ym, 7);
    const amt = money(x && x.amt);
    if (!isYm(ym) || amt == null) continue;
    const seg = { ym, amt };
    const from = text(x.from, 10), to = text(x.to, 10);
    if (isYmd(from) && from.slice(0, 7) === ym && from > monthStart(ym)) seg.from = from;
    if (isYmd(to) && to.slice(0, 7) === ym && to < monthEnd(ym)) seg.to = to;
    if (seg.from && seg.to && seg.to < seg.from) continue;
    map.set(`${ym}|${segStart(seg)}`, seg);
  }
  const out = [];
  for (const s of [...map.values()].sort((a, b) => segStart(a).localeCompare(segStart(b)))) {
    const last = out[out.length - 1];
    if (last && segEnd(last) >= segStart(s)) continue;
    out.push(s);
  }
  return out.slice(0, PLAN_MAX);
}
/* 기간 구간의 경계 — 'YYYY-MM-DD' 차례, 중복 없이 */
function normalizeCuts(raw) {
  const set = new Set();
  for (const c of Array.isArray(raw) ? raw : []) { const d = text(c, 10); if (isYmd(d)) set.add(d); }
  return [...set].sort().slice(0, CUTS_MAX);
}
/* 경계 다듬기 — 조각이 양쪽에 붙어 있지 않은 경계, 양쪽이 같은 금액의 온달인 경계는 지운다 */
function pruneCuts(plan, cuts) {
  return cuts.filter((c) => {
    const before = plan.find((x) => segEnd(x) === addDays(c, -1)), after = plan.find((x) => segStart(x) === c);
    return !!before && !!after && !(isFull(before) && isFull(after) && before.amt === after.amt);
  });
}
function normalizeErp(raw) {
  const monthly = money(raw && raw.monthly);
  if (!raw || typeof raw !== 'object' || !(monthly > 0)) return null;
  const others = (Array.isArray(raw.others) ? raw.others : []).map((o) => ({ ym: text(o && o.ym, 7), rate: num(o && o.rate) ?? 0, amt: money(o && o.amt) ?? 0 })).filter((o) => isYm(o.ym)).slice(0, PLAN_MAX);
  return { monthly, prjNo: text(raw.prjNo, 40), at: num(raw.at) ?? 0, req: text(raw.req, 10), seq: text(raw.seq, 10), others };
}
/* 지급 완료 { from, through('YYYY-MM'), amt, appr, left(원), at(ms), src:'erp' } — through 가 달이 아니면 null(없는 것) */
function normalizePaid(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const through = text(raw.through, 7);
  if (!isYm(through)) return null;
  const from = text(raw.from, 7);
  const amt = money(raw.amt), appr = money(raw.appr);
  return { from: isYm(from) && from <= through ? from : through, through, amt: amt == null ? 0 : amt, appr: appr == null ? 0 : appr, left: Math.round(num(raw.left) || 0), at: num(raw.at) || 0, src: 'erp' };
}
/* 잠근 달 — 지급이 끝난 마지막 달('YYYY-MM'), 없으면 '' */
const lockOf = (paid) => (paid && isYm(paid.through) ? paid.through : '');
/* 참여연구원 한 사람 — name·role, 계획서 값(salary 급여총액·pay 계상인건비·rate 계상률·months 참여개월 — 참고), manual(직접 적은 월급여, 기준보다 앞선다),
 * erp(rERP 에서 받은 월급여·신청 번호·다른 과제 월별 참여율), plan(지급 조각 — 관리 대상), cuts(기간 구간의 경계). 모두 원 */
function normalizePerson(raw) {
  raw = raw || {};
  const manual = money(raw.manual), allowance = money(raw.allowance);
  const rate = num(raw.rate);
  return {
    id: text(raw.id, 40) || newId(), name: text(raw.name, 40), role: text(raw.role, 40),
    salary: money(raw.salary), pay: money(raw.pay), rate: rate != null && rate >= 0 && rate <= 100 ? rate : null, months: int(raw.months, 1, PLAN_MAX),
    manual: manual > 0 ? manual : null, allowance: allowance > 0 ? allowance : null, erp: normalizeErp(raw.erp), plan: normalizePlan(raw.plan), cuts: normalizeCuts(raw.cuts),
  };
}
/* 사람들 묶음 — { basis, src, people }. 이름 없는 사람은 버린다. 없거나 비었으면 null */
function normalizeStaff(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const seen = new Set();
  const people = [];
  for (const p of Array.isArray(raw.people) ? raw.people : []) {
    if (people.length >= STAFF_MAX) break;
    const q = normalizePerson(p);
    const k = nameKeyOf(q.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    people.push(q);
  }
  if (!people.length) return null;
  return { basis: BASES.includes(raw.basis) ? raw.basis : 'rerp', src: SOURCES.includes(raw.src) ? raw.src : 'erp', people };
}

/* ---------- 월급여·형편 ---------- */
/* 계획서 기준 월급여 — 급여총액이 있으면 ÷12 절삭, 없으면 계상인건비 ÷ 개월 ÷ 계상률로 되짚은 값(천원 반올림). 없으면 null */
function planMonthly(person) {
  const m = monthlyOfSalary(person.salary);
  if (m) return m;
  if (person.pay > 0 && person.months > 0 && person.rate > 0) return Math.round(person.pay / person.months / (person.rate / 100) / 1000) * 1000;
  return null;
}
/* 이 사람의 월급여와 어디서 왔는지 — manual > (기준이 rerp 면) rERP > 계획서 > (계획서 값이 없으면) rERP. { amt, src: 'manual'|'rerp'|'plan'|'none', fallback } */
function monthlyPay(person, basis) {
  if (person.manual > 0) return { amt: person.manual, src: 'manual', fallback: false };
  if (basis === 'rerp' && person.erp && person.erp.monthly > 0) return { amt: person.erp.monthly, src: 'rerp', fallback: false };
  const plan = planMonthly(person);
  if (plan) return { amt: plan, src: 'plan', fallback: basis === 'rerp' };
  if (person.erp && person.erp.monthly > 0) return { amt: person.erp.monthly, src: 'rerp', fallback: false };
  return { amt: null, src: 'none', fallback: false };
}
/* 기간 구간 — 조각들을 날이 이어지고(앞 조각 마지막 날 + 1 = 첫날) 경계(cuts)가 없고 제외(0원) 여부가 같고 온달 금액이 그대로인 한 묶는다.
 * 온달 금액이 바뀌는 곳도 구간이 갈린다(경계를 두기 전 0.8.7 저장분처럼 cuts 가 없어도 "4~11월 2,328 · 12월 1,696" 은 두 구간) — 다만 자료생성·균등 분할의 **마지막 달 잔액**(계획의 마지막 온달 하나가 앞 온달과
 * (앞 조각 수 + 1)천원 미만 차이 — 1,165×8 + 1,159)은 같은 구간. 일부 달 조각은 금액으로 가르지 않는다(경계로만).
 * [{ from, to('YYYY-MM-DD'), amt(Σ지급), months(날 수 비율 합), rate(Σ지급 ÷ (월급여 × months) 올림 | null), off(제외 구간), segs }] */
function runsOf(person, limit) {
  const runs = [];
  const cuts = person.cuts || [];
  const plan = person.plan;
  plan.forEach((s, i) => {
    const a = segStart(s), b = segEnd(s), f = segFrac(s), full = isFull(s);
    const last = runs[runs.length - 1];
    let joined = !!last && addDays(last.to, 1) === a && (last.amt > 0) === (s.amt > 0) && !cuts.some((c) => c > last.from && c <= a);
    if (joined && full && last.lastFull != null && last.lastFull !== s.amt && !(i === plan.length - 1 && Math.abs(s.amt - last.lastFull) < (last.segs.length + 1) * 1000)) joined = false;
    if (joined) { last.to = b; last.amt += s.amt; last.months += f; last.segs.push(s); if (full) last.lastFull = s.amt; }
    else runs.push({ from: a, to: b, amt: s.amt, months: f, segs: [s], lastFull: full ? s.amt : null });
  });
  for (const r of runs) { delete r.lastFull; r.off = !(r.amt > 0); r.rate = limit > 0 && r.amt > 0 ? rerpRate(r.amt, limit * r.months) : null; }
  return runs;
}
/* 한 사람의 형편 — total(Σ조각, 조각이 없으면 계획서 계상인건비) · months(지급이 있는 조각의 날 수 비율 합 — 온달은 1) · from·to('YYYY-MM-DD') · rate(연간 — rERP 올림) · avgRate(월평균 — 같은 몫, 같은 올림; 지급이 없으면 null) · maxRate·maxYm(조각 최대)
 * · limit(월급여)·src · rates(조각마다 — ym·from·to·full·amt·rate(조각 금액 ÷ (월급여 × 비율))) · runs(기간 구간) · planned */
function personStats(person, basis) {
  const limit = monthlyPay(person, basis);
  const planned = person.plan.length > 0;
  const active = person.plan.filter((x) => x.amt > 0);
  const total = planned ? person.plan.reduce((s, x) => s + x.amt, 0) : (person.pay == null ? 0 : person.pay);
  const months = planned ? active.reduce((s, x) => s + segFrac(x), 0) : (person.months == null ? 0 : person.months);
  const cap = limit.amt > 0 && months > 0 ? limit.amt * months : 0;
  const rates = planned ? person.plan.map((x) => ({ ym: x.ym, from: segStart(x), to: segEnd(x), full: isFull(x), amt: x.amt, rate: limit.amt > 0 ? rerpRate(x.amt, limit.amt * segFrac(x)) : null })) : [];
  let maxRate = null, maxYm = '';
  for (const r of rates) if (r.amt > 0 && r.rate != null && (maxRate == null || r.rate > maxRate)) { maxRate = r.rate; maxYm = r.ym; }
  const last = active[active.length - 1];
  return { total, months, from: active[0] ? segStart(active[0]) : '', to: last ? segEnd(last) : '', rate: cap > 0 ? rerpRate(total, cap) : null, avgRate: cap > 0 && total > 0 ? rerpRate(total, cap) : null, maxRate, maxYm, limit: limit.amt, src: limit.src, fallback: limit.fallback, rates,
    runs: planned ? runsOf(person, limit.amt) : [], planned };
}
const staffTotal = (staff, basis) => ((staff && staff.people) || []).reduce((s, p) => s + personStats(p, basis).total, 0);
/* 인건비 예산(원)과 견준다 — 예산을 모르면 over 는 false */
function overBudget(staff, basis, budgetPay) {
  const total = staffTotal(staff, basis);
  return { total, budget: budgetPay == null ? null : budgetPay, over: budgetPay != null && total > budgetPay, left: budgetPay != null ? budgetPay - total : null };
}
/* 예산 대비(overBudget 결과나 { total, budget }) — { diff(합 − 예산 | null), kind: 'over' | 'short' | 'even' | '', text: "초과금 266천원" | "부족금 626천원" | "예산과 같음" | '' } */
function budgetDiff(ob) {
  if (!ob || ob.budget == null || !Number.isFinite(ob.total)) return { diff: null, kind: '', text: '' };
  const diff = ob.total - ob.budget;
  if (diff > 0) return { diff, kind: 'over', text: `초과금 ${thousand(diff)}천원` };
  if (diff < 0) return { diff, kind: 'short', text: `부족금 ${thousand(-diff)}천원` };
  return { diff: 0, kind: 'even', text: '예산과 같음' };
}
const rateText = (r) => (r == null ? '' : `${r.toFixed(2)}%`);
/* 형편 한 줄(변경이력의 전·후): "20.00% · 10,479천원 · 4~12월". 구간이 둘 이상이면 뒤에 "(4~11월 27.46% · 12월 20.00%)". 없으면 "(없음)" */
function statsText(s) {
  if (!s || (!s.total && !s.months)) return '(없음)';
  const runs = s.runs && s.runs.length > 1 ? ` (${s.runs.map((r) => `${spanText(r.from, r.to)} ${r.off ? '제외' : rateText(r.rate) || `${thousand(r.amt)}천원`}`).join(' · ')})` : '';
  return [rateText(s.rate) || '참여율 —', `${thousand(s.total)}천원`, s.from ? spanText(s.from, s.to) : s.months ? `${monthsText(s.months)}개월` : ''].filter(Boolean).join(' · ') + runs;
}
/* 조각별 지급을 짧게 — 같은 금액이 이어지는 온달을 묶어 "4~11월 1,165 · 12월 1,159"(천원), 일부 달 조각은 따로 "12.15~12.31 930". 0원은 "제외" */
function monthlyText(plan) {
  const runs = [];
  for (const x of plan) {
    const last = runs[runs.length - 1];
    if (last && last.full && isFull(x) && last.amt === x.amt && addMonths(last.to.slice(0, 7), 1) === x.ym) last.to = monthEnd(x.ym);
    else runs.push({ from: segStart(x), to: segEnd(x), amt: x.amt, full: isFull(x) });
  }
  return runs.map((r) => `${spanText(r.from, r.to)} ${r.amt > 0 ? thousand(r.amt) : '제외'}`).join(' · ');
}
/* 달마다의 지급 합 [[ym, amt] …] — 조각을 달로 합친다. rERP 등록(달 단위)과 견줄 때 */
const monthSums = (plan) => { const m = new Map(); for (const x of plan || []) m.set(x.ym, (m.get(x.ym) || 0) + x.amt); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])); };
const sameMonthly = (a, b) => JSON.stringify(monthSums(a)) === JSON.stringify(monthSums(b));

/* ---------- rERP 참여인력 행 → 사람 ---------- */
/* 참여인력 조회(rtask_0008_t03_01_r001)의 INFO_REC 한 행 → { name, role, limit(지급한도액 원), amt(월 지급), rate(계상률 표시값), from, to('YYYY-MM' 지급기간), count(달 수), req, seq, excluded, term }.
 * 주민번호·계좌·연락처 같은 칸은 읽지 않는다. 이름 없는 행은 뺀다 */
function rowsOfErp(rec) {
  const yn = (v) => /^(y|1|true|예|제외)/i.test(String(v == null ? '' : v).trim());
  return (Array.isArray(rec) ? rec : []).map((r) => (r && typeof r === 'object' ? {
    name: text(r.EMP_NM, 40), role: text(r.ROLE_NM, 40), limit: num(r.PAY_LIMT_AMT), amt: num(r.PAY_AMT), rate: num(r.PART_RT),
    from: ymOf(r.PLAN_YM_FROM), to: ymOf(r.PLAN_YM_TO), count: num(r.NCNT), req: text(r.REQ_CNT, 10), seq: text(r.SEQ_NO, 10),
    excluded: yn(r.PARTRATE_YN), term: text(r.PART_TRM_DT_DTL || r.PART_TRM_DT, 40),
  } : null)).filter((r) => r && r.name);
}
/* 행들을 사람마다 하나로 — 월급여(monthly)는 지급한도액이 있는 행 가운데 시작월이 늦은 것, total 은 Σ 월 지급 × 달 수, 신청 번호(req·seq)는 그 행의 것, ranges 는 지급기간들 */
function byName(rows) {
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = nameKeyOf(r.name);
    if (!k) continue;
    const hit = (out[k] = out[k] || { name: r.name, role: r.role || '', monthly: null, total: 0, req: '', seq: '', from: '', to: '', pick: '', ranges: [] });
    hit.ranges.push(r);
    hit.total += (r.amt || 0) * (r.count || 0);
    if (!hit.role && r.role) hit.role = r.role;
    if (!hit.from || (r.from && r.from < hit.from)) hit.from = r.from;
    if (r.to > hit.to) hit.to = r.to;
    if (r.limit > 0 && (!hit.monthly || r.from >= hit.pick)) { hit.monthly = r.limit; hit.pick = r.from; hit.req = r.req; hit.seq = r.seq; }
  }
  for (const h of Object.values(out)) delete h.pick;
  return out;
}
/* rERP 행들 → 사람들(지급기간을 달마다 펼친 월별 지급·월급여) — { basis: 'rerp', src: 'erp', people }. months 를 주면 그 달들만(계획 기간). 행이 없으면 null.
 * 기간 구간 경계(cuts)는 이어지는 지급기간 행의 시작월 — 다만 자료생성의 마지막 달 잔액 행(마지막 한 달짜리 행이 앞 행과 (앞 행 달 수 + 1)천원 미만 차이)은 같은 구간 */
function peopleOfErp(rows, { prjNo = '', now = Date.now(), months = null } = {}) {
  const people = [];
  for (const h of Object.values(byName(rows))) {
    const map = new Map();
    for (const r of h.ranges) {
      for (const ym of ymRange(r.from, r.to || r.from)) if (!months || months.includes(ym)) map.set(ym, (map.get(ym) || 0) + (r.amt || 0));
    }
    const plan = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ym, amt]) => ({ ym, amt }));
    if (months && !plan.length) continue;
    const ranges = h.ranges.filter((r) => r.from).sort((a, b) => a.from.localeCompare(b.from));
    const cuts = [];
    for (let i = 1; i < ranges.length; i++) {
      const p = ranges[i - 1], r = ranges[i];
      if (addMonths(p.to || p.from, 1) !== r.from) continue;
      const tail = i === ranges.length - 1 && (r.count || 1) === 1 && Math.abs((r.amt || 0) - (p.amt || 0)) < ((p.count || 1) + 1) * 1000;
      if (!tail) cuts.push(monthStart(r.from));
    }
    people.push(normalizePerson({ name: h.name, role: h.role, erp: h.monthly > 0 ? { monthly: h.monthly, prjNo, at: now, req: h.req, seq: h.seq, others: [] } : null, plan, cuts: pruneCuts(normalizePlan(plan), cuts) }));
  }
  return people.length ? { basis: 'rerp', src: 'erp', people } : null;
}
/* 다른 과제 월별 참여율 조회(rtask_0013_12_r003)의 응답 → { std, rows[{ ym, rate, amt }] }. 주민번호 칸은 버린다 */
function othersOfErp(data) {
  const rows = (Array.isArray(data && data.REC) ? data.REC : []).map((r) => ({ ym: ymOf(r && r.PLAN_YM), rate: num(r && r.ETC_PART_RT) || 0, amt: num(r && r.ETC_PAY_AMT) || 0 })).filter((r) => r.ym);
  return { std: num(data && data.STD_AMT) || null, rows };
}
/* 초기화 재료 — rERP 행들에서 사람마다 지급 합·월급여(months 를 주면 그 달들의 지급만) */
function sharesOfErp(rows, { prjNo = '', now = Date.now(), months = null } = {}) {
  const staff = peopleOfErp(rows, { prjNo, now, months });
  return staff ? sharesOfStaff(staff) : [];
}
/* rERP 에서 몇 월까지 지급됐나 — 자금현황 인건비 비목 승인액(appr, 원 — rcomm_0041_01_r004 의 APPR_AMT, PSNL_COST_YN 'Y' 줄)을 등록 지급계획(rows → peopleOfErp, 모든 사람)의 달 합으로 첫 달부터 메운다.
 * months 를 주면 그 달들(연차 기간)만. 2026-10-19 실측(2026-0063-01): 승인 17,465,000 = (1,165,000 + 2,328,000) × 5 → 4~8월.
 * → { from(지급이 있는 첫 달), through(마지막으로 다 메운 달), amt(그 달까지 합), appr, left(appr − amt — 달 경계와 맞지 않는 몫, 보통 0), at, src:'erp' } | null(승인액이 없거나 한 달도 못 메움) */
function paidThroughOf(rows, appr, { prjNo = '', months = null, now = Date.now() } = {}) {
  const a = money(appr);
  const staff = peopleOfErp(rows, { prjNo, now, months });
  if (!staff || !(a > 0)) return null;
  const sums = new Map();
  for (const p of staff.people) for (const x of p.plan) sums.set(x.ym, (sums.get(x.ym) || 0) + x.amt);
  let acc = 0, from = '', through = '', amt = 0;
  for (const ym of [...sums.keys()].sort()) {
    const s = sums.get(ym);
    if (acc + s > a) break;
    acc += s;
    if (s > 0) { if (!from) from = ym; through = ym; amt = acc; }
  }
  return through ? normalizePaid({ from, through, amt, appr: a, left: a - amt, at: now, src: 'erp' }) : null;
}

/* ---------- 만들기 ---------- */
function initialPlan(q, months) {
  const n = q.months > 0 && q.months <= months.length ? q.months : months.length;
  if (!n || q.pay == null || !(q.pay >= 0)) return [];
  const amts = splitEven(q.pay, n);
  return months.slice(0, n).map((ym, i) => ({ ym, amt: amts[i] }));
}
/* 계획서의 참여연구자(name·role·salary·pay·rate·months, 원)로 — 첫 달부터 참여개월만큼 균등. prev 가 있으면 같은 이름의 id·manual·erp 를 잇고 계획서 값이 그대로면 월별도 그대로 */
function buildStaff(persons, span, prev = null, src = 'yaml') {
  const months = spanMonths(span);
  const seen = new Set();
  const people = [];
  for (const q of Array.isArray(persons) ? persons : []) {
    const name = text(q && q.name, 40);
    const k = nameKeyOf(name);
    if (!k || seen.has(k) || people.length >= STAFF_MAX) continue;
    seen.add(k);
    const old = prev ? prev.people.find((x) => sameName(x.name, name)) || null : null;
    const salary = money(q.salary), pay = money(q.pay), monthsN = int(q.months, 1, PLAN_MAX), rate = num(q.rate);
    const same = !!old && old.salary === salary && old.pay === pay && old.months === monthsN && old.plan.length > 0;
    people.push(normalizePerson({
      id: old ? old.id : undefined, name, role: text(q.role, 40), salary, pay, rate: rate != null && rate >= 0 && rate <= 100 ? rate : null, months: monthsN,
      manual: old ? old.manual : null, erp: old ? old.erp : null, plan: same ? old.plan : initialPlan({ pay, months: monthsN }, months),
    }));
  }
  if (!people.length) return null;
  return { basis: prev ? prev.basis : 'plan', src: SOURCES.includes(src) ? src : 'yaml', people };
}
/* 사람들이 없는 기간을 **이전 사람들의 지급 비율**로 — 인건비 예산(budgetPay, 원)을 total 비율대로(천원 반올림, 잔차는 지급이 가장 큰 사람에게) 나눠 모든 달에 균등.
 * sources: [{ name, role, total, salary?, manual?, erp? }]. rERP 값이 있는 사람이 하나라도 있으면 기준은 rerp. 예산이나 사람이 없으면 null */
function initFromShares(sources, { budgetPay, span }) {
  const months = spanMonths(span);
  const list = [];
  const seen = new Set();
  for (const s of Array.isArray(sources) ? sources : []) {
    const name = text(s && s.name, 40);
    const k = nameKeyOf(name);
    if (!k || seen.has(k) || !(s.total > 0) || list.length >= STAFF_MAX) continue;
    seen.add(k);
    list.push(Object.assign({}, s, { name }));
  }
  const sum = list.reduce((a, s) => a + s.total, 0);
  if (!list.length || !(sum > 0) || !(budgetPay > 0)) return null;
  const pays = list.map((s) => Math.round((budgetPay * s.total) / sum / 1000) * 1000);
  const diff = budgetPay - pays.reduce((a, b) => a + b, 0);
  if (diff) pays[list.reduce((best, s, i) => (s.total > list[best].total ? i : best), 0)] += diff;
  const people = list.map((s, i) => {
    const amts = splitEven(pays[i], months.length);
    return normalizePerson({ name: s.name, role: s.role, salary: s.salary == null ? null : s.salary, pay: pays[i], rate: null, months: months.length || null, manual: s.manual == null ? null : s.manual, erp: s.erp || null,
      plan: months.map((ym, j) => ({ ym, amt: amts[j] })) });
  });
  return { basis: people.some((p) => p.erp) ? 'rerp' : 'plan', src: 'init', people };
}
const sharesOfStaff = (staff) => ((staff && staff.people) || []).map((p) => ({ name: p.name, role: p.role, total: personStats(p, staff.basis).total, salary: p.salary, manual: p.manual, erp: p.erp }));
/* 이전 차년도에서 가져오기 — 앞 연차 사람들(prev: 그 연차 계획, 없으면 그 기간의 rERP 등록 지급계획)의 성명·역할·월급여(직접 적은 값 · rERP · 계획서 급여총액)와 **마지막 기간 구간의 참여율**을
 * 이 연차 기간 전체(months)의 달마다 floor천원(월급여 × %) — 참여율 칸을 고칠 때(setRate)와 같은 셈. 2026-10-20 사용자 "2차년도에는 일단 이전 차년도 정보 가져오기 넣어주고, 연구원, 월급, 참여율 정도 가져오면 되겠지? 기간은 전체".
 * 마지막 구간이 제외(0원)이거나 지급이 없는 사람은 그 연차에서 빠진 것으로 보고 넘긴다(skipped). 월급여를 몰라 참여율이 없으면 마지막 구간의 월 평균 지급(천원 반올림)을 그대로.
 * → { basis, src: 'init', people, skipped[이름] } | null(가져올 사람이 없거나 기간이 없음) */
function carryOver(prev, months) {
  if (!prev || !Array.isArray(months) || !months.length) return null;
  const basis = BASES.includes(prev.basis) ? prev.basis : 'rerp';
  const people = [], skipped = [];
  for (const p of prev.people || []) {
    if (people.length >= STAFF_MAX) break;
    const last = personStats(p, basis).runs.slice(-1)[0];
    if (!last || last.off) { skipped.push(p.name); continue; }
    const q = normalizePerson({ name: p.name, role: p.role, salary: p.salary, manual: p.manual, erp: p.erp });
    const limit = monthlyPay(q, basis).amt;
    const amt = last.rate != null && limit > 0 ? amountOfRate(limit, last.rate) : round1000(last.amt / last.months);
    q.plan = normalizePlan(months.map((ym) => ({ ym, amt })));
    people.push(q);
  }
  return people.length ? { basis, src: 'init', people, skipped } : null;
}

/* ---------- 바꾸기 (원본은 안 건드리고 새 사람을 돌려준다) ---------- */
/* 적용일부터(종료일까지, 비우면 끝까지 — 날짜 'YYYY-MM-DD' 또는 달 'YYYY-MM') — rate: floor천원(월급여 × %) · amt: value(원, 한 달 치) · exclude: 0원.
 * 범위 밖 조각은 그대로, 걸치는 조각은 날 수 비율로 잘라 남기고, 범위 안은 달마다 조각 하나(달 중간이면 날 수 비율의 금액). 범위에 없던 달은 새로 생긴다.
 * 적용일·종료일 다음 날이 기간 구간의 경계(cuts)가 된다(양쪽이 같은 금액의 온달이면 지움). months 는 계획 기간의 달들(없으면 그 사람의 달들) */
/* 적용일·종료일을 날짜로 — fromD(첫날) · endD(마지막 날: 종료일이 없거나 적용일보다 앞이면 기간 끝) · range(그 사이의 달들). months 가 없으면 사람의 조각이 있는 달 */
function resolveRange(person, { from, to = '' }, months = []) {
  const fromD = dateOf(from, 'start');
  if (!fromD) throw new Error('적용일을 고르세요.');
  const all = months.length ? months : [...new Set(person.plan.map((x) => x.ym))];
  if (!all.length) throw new Error('계획 기간이 없어 달을 정할 수 없습니다 — 기간을 먼저 정하세요.');
  const toD = dateOf(to, 'end');
  // 2026-10-20 사용자 "rERP 처럼 온달로": rERP 는 달 단위 행뿐이라 일할 계산이 없다 — 적용일은 그 달 1일, 종료일은 그 달 마지막 날로 올려 잡아 일부 달 조각을 만들지 않는다(옛 저장분의 조각은 읽기만)
  const fromM = monthStart(fromD.slice(0, 7));
  const endD = monthEnd((toD && toD >= fromM ? toD : monthEnd(all[all.length - 1])).slice(0, 7));
  const range = all.filter((ym) => ym >= fromM.slice(0, 7) && ym <= endD.slice(0, 7));
  if (!range.length) throw new Error('적용일이 계획 기간 밖입니다.');
  return { fromD: fromM, endD, range };
}
/* 잠금(opts.lock = 지급이 끝난 마지막 달 'YYYY-MM' — paid.through): 그 달까지의 조각은 바꾸지 않는다 */
const lockText = (lock) => `${ymText(lock)}까지는 rERP 에서 지급이 끝난 달이라 바꿀 수 없습니다 — 적용일을 ${addMonths(lock, 1)}-01 이후로 하세요.`;
const NO_MONTHS = '바꿀 수 있는 달이 없습니다 — 모두 rERP 지급이 끝난 달입니다.';
function applyChange(person, basis, { from, to = '', mode, value }, months = [], { lock = '' } = {}) {
  const { fromD, endD, range } = resolveRange(person, { from, to }, months);
  if (isYm(lock) && fromD <= monthEnd(lock)) throw new Error(lockText(lock));
  let full;
  if (mode === 'exclude') full = 0;
  else if (mode === 'rate') {
    const r = num(value);
    if (r == null || r < 0 || r > 100) throw new Error('참여율은 0~100 사이의 수입니다.');
    const limit = monthlyPay(person, basis);
    if (!(limit.amt > 0)) throw new Error('월급여가 없어 참여율로 금액을 셈할 수 없습니다 — 월급여를 적으세요.');
    full = amountOfRate(limit.amt, r);
  } else if (mode === 'amt') {
    full = money(value);
    if (full == null) throw new Error('월 지급금액은 0 이상의 금액입니다.');
  } else throw new Error('모르는 변경 구분입니다.');
  const keep = [];
  for (const x of person.plan) {
    const s = segStart(x), e = segEnd(x);
    if (e < fromD || s > endD) { keep.push(x); continue; }
    if (s < fromD) keep.push(clipSeg(x, s, addDays(fromD, -1)));
    if (e > endD) keep.push(clipSeg(x, addDays(endD, 1), e));
  }
  for (const ym of range) keep.push(makeSeg(ym, full, fromD > monthStart(ym) ? fromD : monthStart(ym), endD < monthEnd(ym) ? endD : monthEnd(ym)));
  const plan = normalizePlan(keep);
  return Object.assign({}, person, { plan, cuts: pruneCuts(plan, normalizeCuts((person.cuts || []).concat([fromD, addDays(endD, 1)]))) });
}
/* 총액을 조각들에 — 온달은 ceil천원(총 ÷ 개월), 일부 달 조각은 그 날 수 비율(round천원), 마지막 조각은 잔액. 모두 온달이면 splitEven 과 같다 */
function splitByFrac(total, fracs) {
  const n = fracs.length;
  if (!n || !(total >= 0)) return [];
  if (n === 1) return [Math.round(total)];
  const sum = fracs.reduce((a, b) => a + b, 0);
  const headOf = (unit) => fracs.slice(0, -1).map((f) => round1000(unit * f));
  let head = headOf(Math.ceil(total / sum / 1000) * 1000);
  if (head.reduce((a, b) => a + b, 0) > total) head = headOf(Math.floor(total / sum / 1000) * 1000);
  return head.concat([Math.round(total - head.reduce((a, b) => a + b, 0))]);
}
/* 계상인건비 총액 — 지급이 있는 조각(없으면 모든 조각, 그것도 없으면 months 의 달)에 나눈다. range({ from, to } 날짜)를 주면 그 구간의 조각에만 */
function setTotal(person, total, months = [], range = null, { lock = '' } = {}) {
  const t = money(total);
  if (t == null) throw new Error('계상인건비는 0 이상의 금액입니다.');
  const inRange = (x) => !range || (segStart(x) >= range.from && segEnd(x) <= range.to);
  const after = (list) => (isYm(lock) ? list.filter((x) => x.ym > lock) : list);   // 지급이 끝난 달은 빼고
  let segs = after(person.plan.filter((x) => x.amt > 0 && inRange(x)));
  if (!segs.length) segs = after(person.plan.filter(inRange));
  if (!segs.length && !range) segs = after(months.map((ym) => ({ ym, amt: 0 })));
  if (!segs.length) throw new Error(isYm(lock) ? NO_MONTHS : '계획 기간이 없어 달을 정할 수 없습니다 — 기간을 먼저 정하세요.');
  // 지급이 끝난 달의 조각은 그대로 두고, 총액에서 그 합을 뺀 나머지를 그 뒤 달에 나눈다
  const done = isYm(lock) ? person.plan.filter((x) => x.ym <= lock && inRange(x)) : [];
  const fixed = done.reduce((s, x) => s + x.amt, 0);
  if (t < fixed) throw new Error(`지급이 끝난 ${ymText(done[0].ym, done[done.length - 1].ym)}의 합 ${thousand(fixed)}천원보다 적게 잡을 수 없습니다.`);
  const amts = splitByFrac(t - fixed, segs.map(segFrac));
  const key = (x) => `${x.ym}|${segStart(x)}`;
  const map = new Map(person.plan.map((x) => [key(x), x]));
  segs.forEach((x, i) => map.set(key(x), Object.assign({}, x, { amt: amts[i] })));
  return Object.assign({}, person, { plan: normalizePlan([...map.values()]) });
}
/* 나머지 — 인건비 예산(budgetPay)에서 다른 사람들의 지급(others)과 이 사람의 적용일~종료일 **밖** 지급을 뺀 금액(원): 그 기간에 이 사람에게 줄 수 있는 몫. 폼의 안내·빠른 단추(lib/staff-ui.js)와 applyShare·fitBudget 이 쓴다.
 * → { left(원 — 0 이하일 수 있음), fromD, endD, range, span(그 기간의 개월 — 일부 달은 날 수 비율), zeroed(그 기간을 비운 사람) }. 예산이 없거나 적용일이 지급이 끝난 달이면 오류 */
function shareLeft(person, basis, { from, to = '' }, months = [], { budgetPay = null, others = 0, lock = '' } = {}) {
  if (budgetPay == null || !(Number(budgetPay) >= 0)) throw new Error('인건비 예산이 없어 나머지를 셈할 수 없습니다 — 예산 칸의 인건비 줄을 적으세요.');   // null >= 0 은 참이라 따로 본다
  const { fromD, endD, range } = resolveRange(person, { from, to }, months);
  const zeroed = applyChange(person, basis, { from: fromD, to: endD, mode: 'amt', value: 0 }, months, { lock });
  const span = range.reduce((s, ym) => s + dayCount(fromD > monthStart(ym) ? fromD : monthStart(ym), endD < monthEnd(ym) ? endD : monthEnd(ym)) / dim(ym), 0);
  return { left: budgetPay - (Number(others) || 0) - personStats(zeroed, basis).total, fromD, endD, range, span, zeroed };
}
/* 나머지의 n% 를 적용일~종료일에 — shareLeft 의 나머지의 pct% 를 그 기간의 조각에 나눈다(setTotal 의 나눔 — 온달 균등 · 일부 달은 날 수 비율 · 마지막 조각 잔액).
 * 2026-10-19 사용자 "1명 삭감하고 1명, 2명, 3명 추가될 때 … 100% 금액을 자동 반영할지, 50% 반영할지 … 숫자를 넣어서 지급금액을 자동계산": 한 사람이면 100, 둘이면 50·50(둘째를 더한 뒤 남는 나머지의 100 이어도 같다).
 * 같은 날 "나머지를 추가해서 현재 남은 금액을 모두 평균해서 반영하는 버튼 … 25%, 50%, 75%, 100%" — 폼의 빠른 단추가 이것을 부른다(처음 이름 "부족금의 %" 를 "나머지의 %" 로).
 * 돌려주는 것 { person, left(나머지 원), total(배분한 원), pct }. 예산이 없거나 나머지가 0 이하이면 오류 */
function applyShare(person, basis, { from, to = '', pct }, months = [], opts = {}) {
  const r = num(pct);
  if (r == null || !(r > 0) || r > 100) throw new Error('나머지의 몇 % 인지 0 보다 크고 100 이하인 수로 적으세요.');
  const { left, fromD, endD, zeroed } = shareLeft(person, basis, { from, to }, months, opts);
  if (!(left > 0)) throw new Error(`나머지가 없습니다 — 다른 지급의 합이 예산${left === 0 ? '과 같습니다' : `을 ${thousand(-left)}천원 넘습니다`}.`);
  const total = round1000((left * r) / 100);
  return { person: setTotal(zeroed, total, months, { from: fromD, to: endD }, { lock: opts.lock || '' }), left, total, pct: r };
}
/* 금액들(amts)에 차(delta 원 — 음수면 줄임)를 비율(fracs — 날 수 비율)대로 고르게 — splitByFrac 의 나눔(천원 올림 · 마지막 잔액).
 * 줄일 때 0 아래로 가는 것은 0 에서 멈추고 남은 차를 나머지가 나눈다. 합은 Σamts + delta(Σamts + delta ≥ 0 일 때) */
function spreadDelta(amts, fracs, delta) {
  const out = amts.slice();
  let idx = amts.map((_, i) => i), rest = Math.round(delta);
  while (rest && idx.length) {
    const parts = splitByFrac(Math.abs(rest), idx.map((i) => fracs[i]));
    const next = idx.map((i, k) => out[i] + Math.sign(rest) * parts[k]);
    const neg = idx.filter((_, k) => next[k] < 0);
    if (!neg.length) { idx.forEach((i, k) => { out[i] = next[k]; }); return out; }
    for (const i of neg) { rest += out[i]; out[i] = 0; }
    idx = idx.filter((i) => !neg.includes(i));
  }
  return out;
}
/* 예산에 맞추기 — 적용일~종료일의 이 사람 지급을 **초과금만큼 줄이거나 부족금만큼 늘려** 인건비 합(others + 이 사람)을 예산(budgetPay)과 같게 한다(2026-10-19 사용자 "n월 개 선택한 후 .. 초과금에 맞춰서 줄이거나, 부족금 만큼 늘리거나 하는 버튼").
 * 차는 그 기간의 조각에 날 수 비율로 고르게 더하거나 빼므로(spreadDelta) 달마다의 차이는 그대로 남는다 — 나머지의 100%(applyShare)는 그 기간을 균등하게 다시 나누는 것과 다름. 그 기간의 달 가운데 조각이 없던 달은 0원에서 시작(늘릴 때 받음),
 * 걸치는 조각은 날 수 비율로 잘라 안쪽만 바꾼다. 적용일·종료일 다음 날이 기간 구간의 경계(applyChange 와 같음).
 * → { person, diff(바꾸기 전 합 − 예산, 원 — 양수면 초과금), before(그 기간 합), after(바꾼 뒤 그 기간 합 = 나머지) }. 예산이 없거나 이미 같거나 그 기간을 모두 0 으로 해도 넘으면 오류 */
function fitBudget(person, basis, { from, to = '' }, months = [], opts = {}) {
  const { left, fromD, endD, range } = shareLeft(person, basis, { from, to }, months, opts);
  const { keep, inside } = carveRange(person, fromD, endD, range, true);
  const before = inside.reduce((s, x) => s + x.amt, 0);
  const diff = before - left;
  if (!diff) throw new Error('인건비 합이 이미 예산과 같습니다.');
  if (left < 0) throw new Error(`${spanText(fromD, endD)}의 지급을 모두 0 으로 해도 초과금 ${thousand(-left)}천원이 남습니다 — 다른 사람이나 기간을 고르세요.`);
  const amts = spreadDelta(inside.map((x) => x.amt), inside.map(segFrac), -diff);
  return { person: withRange(person, keep, inside.map((x, i) => Object.assign({}, x, { amt: amts[i] })), fromD, endD), diff, before, after: left };
}
/* 적용일~종료일로 사람의 조각을 가른다 — keep(그 기간 밖 — 걸치는 조각은 날 수 비율로 잘라 바깥 몫), inside(그 기간 안 — 안쪽 몫, 날짜 차례). fill 이면 그 기간에 조각이 하나도 없는 달은 0원 조각으로 채운다 */
function carveRange(person, fromD, endD, range, fill) {
  const keep = [], inside = [];
  for (const x of person.plan) {
    const s = segStart(x), e = segEnd(x);
    if (e < fromD || s > endD) { keep.push(x); continue; }
    if (s < fromD) keep.push(clipSeg(x, s, addDays(fromD, -1)));
    if (e > endD) keep.push(clipSeg(x, addDays(endD, 1), e));
    inside.push(s >= fromD && e <= endD ? x : clipSeg(x, s > fromD ? s : fromD, e < endD ? e : endD));
  }
  if (fill) for (const ym of range) if (!inside.some((x) => x.ym === ym)) inside.push(makeSeg(ym, 0, fromD > monthStart(ym) ? fromD : monthStart(ym), endD < monthEnd(ym) ? endD : monthEnd(ym)));
  inside.sort((a, b) => segStart(a).localeCompare(segStart(b)));
  return { keep, inside };
}
/* 가른 조각을 다시 모은 사람 — 적용일·종료일 다음 날이 기간 구간의 경계(applyChange 와 같음) */
function withRange(person, keep, inside, fromD, endD) {
  const plan = normalizePlan(keep.concat(inside));
  return Object.assign({}, person, { plan, cuts: pruneCuts(plan, normalizeCuts((person.cuts || []).concat([fromD, addDays(endD, 1)]))) });
}
/* 기준 금액에서 증감 — 적용일~종료일의 이 사람 지급을 조각마다 pct% 늘리거나 줄인다(round천원(조각 × (100 + pct) ÷ 100) — 달 사이의 비율은 그대로).
 * 2026-10-19 사용자(회의실 현황 스크린샷) "이거 기준 금액에서 증액, 감소를 10% 간격으로 증가감소 드래그로 선택할 수 게 해줘" — 폼 아래 증감 칸(lib/staff-ui.js quickRow)이 부른다.
 * 걸치는 조각은 날 수 비율로 잘라 안쪽만, 지급이 없던 달은 그대로(0 은 늘지 않음). → { person, pct, before(그 기간 합), after }. 그 기간에 지급이 없거나 pct 가 0 · −100 미만이거나 지급이 끝난 달이면 오류 */
function scaleRange(person, basis, { from, to = '' }, months = [], pct, { lock = '' } = {}) {
  const r = num(pct);
  if (r == null || !r || r < -100 || r > 1000) throw new Error('증감은 −100 ~ +1000 % 사이(0 아님)로 고르세요.');
  const { fromD, endD, range } = resolveRange(person, { from, to }, months);
  if (isYm(lock) && fromD <= monthEnd(lock)) throw new Error(lockText(lock));
  const { keep, inside } = carveRange(person, fromD, endD, range, false);
  const before = inside.reduce((s, x) => s + x.amt, 0);
  if (!(before > 0)) throw new Error(`${spanText(fromD, endD)}에 지급이 없어 늘리거나 줄일 기준이 없습니다 — 참여율·월 지급금액·나머지의 % 로 적으세요.`);
  const scaled = inside.map((x) => Object.assign({}, x, { amt: round1000((x.amt * (100 + r)) / 100) }));
  return { person: withRange(person, keep, scaled, fromD, endD), pct: r, before, after: scaled.reduce((s, x) => s + x.amt, 0) };
}
/* 균등 — 적용일~종료일의 이 사람 지급을 **달마다 같은 금액**으로: 월 금액 = 그 기간 합 ÷ 개월(일부 달은 날 수 비율)을 천원 반올림, 조각은 round천원(월 금액 × 날 수 비율). 합은 천원 단위로 달라질 수 있다(예 17,929 ÷ 12 → 월 1,494 → 합 17,928).
 * 앞달 올림·마지막 잔액(splitByFrac — rERP 자료생성 행)이 아니다: 2026-10-20 사용자 "예산 맞추기 옆에 매월 동일 금액/남은 기간동안 설정하는거 넣어줘 … '균등'", 그 꼴로 만들자 "균등이 안되는데"(마지막 달만 다른 값). 지급이 없던 달도 그 기간이면 받는다.
 * 폼 아래 증감 줄의 [균등] 칸(lib/staff-ui.js quickRow)이 부른다. → { person, before(그 기간 합), after(바꾼 뒤 합), per(월 금액) }. 그 기간에 지급이 없거나 적용일이 지급이 끝난 달이면 오류 */
function evenRange(person, basis, { from, to = '' }, months = [], { lock = '' } = {}) {
  const { fromD, endD, range } = resolveRange(person, { from, to }, months);
  if (isYm(lock) && fromD <= monthEnd(lock)) throw new Error(lockText(lock));
  const { keep, inside } = carveRange(person, fromD, endD, range, true);
  const before = inside.reduce((s, x) => s + x.amt, 0);
  if (!(before > 0)) throw new Error(`${spanText(fromD, endD)}에 지급이 없어 고르게 나눌 금액이 없습니다 — 참여율·월 지급금액·나머지의 % 로 적으세요.`);
  const fracs = inside.map(segFrac);
  const per = round1000(before / fracs.reduce((a, b) => a + b, 0));
  if (!(per > 0)) throw new Error(`${spanText(fromD, endD)}의 지급 ${thousand(before)}천원은 달마다 같게 나누기에 너무 적습니다.`);
  const amts = fracs.map((f) => round1000(per * f));
  return { person: withRange(person, keep, inside.map((x, i) => Object.assign({}, x, { amt: amts[i] })), fromD, endD), before, after: amts.reduce((s, v) => s + v, 0), per };
}
/* MAX — 적용일~종료일에 넣을 수 있는 **최대 참여율**(%, 소수 둘째 자리 내림 — rERP 계상률 자릿수): (1) 예산 — 나머지(shareLeft 의 left: 예산 − 다른 사람들 − 이 사람의 그 기간 밖 지급)를 넘지 않는 가장 큰 참여율(applyChange 'rate' 로 실제 넣어 본 합으로 — round천원·일부 달 날 수 비율 그대로),
 * (2) 100% 규칙 — 100 − 그 기간 달들의 다른 과제 참여율 합(opts.others100 [{ ym, rate }] — mergeOthers 의 그 사람 줄) 가운데 가장 큰 달. 둘 가운데 작은 것(예산이 없으면 (2)만).
 * 2026-10-20 사용자 "참여율은 MAX/ 최대 들어 갈 수 있는 것으로 넣어줘. 표기도 해주고. 이거 이상 못넘어 가게 하고 … 우측에 균등 왼쪽에 MAX" — 폼 아래 증감 줄의 [MAX] 칸과 자료 요청 응답 반영(lib/staff-ui.js)이 쓴다.
 * → { rate, byBudget(null = 예산 없음), by100, left(원 | null), limit(월급여 원) }. 월급여가 없거나 적용일이 지급이 끝난 달이면 오류 */
function maxRate(person, basis, { from, to = '' }, months = [], { budgetPay = null, others = 0, lock = '', others100 = [] } = {}) {
  const limit = monthlyPay(person, basis);
  if (!(limit.amt > 0)) throw new Error('월급여가 없어 최대 참여율을 셈할 수 없습니다 — 월급여를 적으세요.');
  const { fromD, endD, range } = resolveRange(person, { from, to }, months);
  if (isYm(lock) && fromD <= monthEnd(lock)) throw new Error(lockText(lock));
  const floor2 = (x) => Math.floor(Number((x * 100).toFixed(6))) / 100;
  let byBudget = null, left = null;
  if (budgetPay != null && Number(budgetPay) >= 0) {
    const info = shareLeft(person, basis, { from: fromD, to: endD }, months, { budgetPay, others, lock });
    left = info.left;
    const outside = personStats(info.zeroed, basis).total;   // 그 기간 밖 지급
    const fits = (r) => personStats(applyChange(person, basis, { from: fromD, to: endD, mode: 'rate', value: r }, months, { lock }), basis).total - outside <= left;
    let r = left > 0 && info.span > 0 ? Math.min(100, floor2((left / (limit.amt * info.span)) * 100)) : 0;
    while (r > 0 && !fits(r)) r = Math.max(0, Math.round((r - 0.01) * 100) / 100);   // round천원 때문에 넘치면 0.01 씩 내림(보통 0~1번)
    byBudget = r;
  }
  const theirs = range.map((ym) => (others100 || []).filter((o) => o && o.ym === ym).reduce((s, o) => s + (Number(o.rate) || 0), 0));
  const by100 = Math.max(0, Math.round((100 - Math.max(0, ...theirs)) * 100) / 100);
  return { rate: Math.min(byBudget == null ? 100 : byBudget, by100), byBudget, by100, left, limit: limit.amt };
}
/* 참여율 통째로 — 지급이 있는 조각의 첫날부터 마지막 날까지(없으면 기간 전체)에 floor천원(월급여 × %). range 를 주면 그 구간만 */
function setRate(person, basis, rate, months = [], range = null, opts = {}) {
  const minFrom = isYm(opts.lock) ? monthStart(addMonths(opts.lock, 1)) : '';
  const go = (from, to) => {   // 지급이 끝난 달은 건너뛰고 그 다음 달부터
    if (minFrom && from < minFrom) from = minFrom;
    if (minFrom && to && from > to) throw new Error(NO_MONTHS);
    return applyChange(person, basis, { from, to, mode: 'rate', value: rate }, months, opts);
  };
  if (range) return go(range.from, range.to);
  const active = person.plan.filter((x) => x.amt > 0);
  const first = active[0] || person.plan[0], last = active[active.length - 1] || person.plan[person.plan.length - 1];
  const from = first ? segStart(first) : months[0] || '';
  const to = last ? segEnd(last) : months.length ? monthEnd(months[months.length - 1]) : '';
  return go(from, to);
}
/* 월급여를 손으로 — 비우거나 기준값과 같으면 손으로 적은 것을 지운다 */
function setManual(person, basis, value) {
  const v = value == null || value === '' ? null : thousandOf(value);
  if (value != null && value !== '' && v == null) throw new Error('월급여는 천원 단위의 수입니다.');
  const base = monthlyPay(Object.assign({}, person, { manual: null }), basis);
  return Object.assign({}, person, { manual: v && v !== base.amt ? v : null });
}

/* ---------- 검사 ---------- */
/* 다른 과제의 월별 참여율 — 밖에서 준 것(book: 이름 키 → [{ ym, rate, label }])과 사람마다의 erp.others 를 합친다. 같은 달에 rERP 값이 있으면 그 달은 rERP 값만 */
function mergeOthers(book, staff) {
  const out = {};
  for (const [k, list] of Object.entries(book || {})) out[k] = list.slice();
  for (const p of (staff && staff.people) || []) {
    const rows = (p.erp && p.erp.others) || [];
    if (!rows.length) continue;
    const k = nameKeyOf(p.name);
    const erpYms = new Set(rows.map((o) => o.ym));
    out[k] = (out[k] || []).filter((o) => !erpYms.has(o.ym)).concat(rows.filter((o) => o.rate > 0).map((o) => ({ ym: o.ym, rate: o.rate, label: 'rERP 다른 과제' })));
  }
  return out;
}
/* 알림 — over(어느 달의 참여율 합 > 100, 막지 않는다) · low(월평균 참여율 ≤ MIN_RATE 10%, 막지 않는다) · salary(월급여 없음) · fallback(기준은 rERP 인데 없어 계획서 값) · budget(예산 초과) · left(남음). [{ kind, level, text, name? }] */
/* 지급이 끝난 달의 계획이 rERP 등록(erp — peopleOfErp 결과)과 다른 사람·달 — [{ name, ym, plan, erp }] 사람마다 첫 달 하나. through 가 없으면 [] */
function paidMismatch(staff, erp, through) {
  const out = [];
  if (!staff || !erp || !isYm(through)) return out;
  for (const p of staff.people) {
    const e = erp.people.find((x) => sameName(x.name, p.name));
    const mine = new Map(monthSums(p.plan).filter(([ym]) => ym <= through));
    const theirs = new Map(e ? monthSums(e.plan).filter(([ym]) => ym <= through) : []);
    const yms = [...new Set([...mine.keys(), ...theirs.keys()])].sort();
    const ym = yms.find((m) => (mine.get(m) || 0) !== (theirs.get(m) || 0));
    if (ym) out.push({ name: p.name, ym, plan: mine.get(ym) || 0, erp: theirs.get(ym) || 0 });
  }
  return out;
}
/* 지급 완료 한 마디 — "4~8월 지급 완료 · rERP 인건비 승인액 17,465천원" (left 가 있으면 "(등록 합 + 535천원)") */
const paidText = (paid) => (paid && isYm(paid.through) ? `${ymText(paid.from, paid.through)} 지급 완료 · rERP 인건비 승인액 ${thousand(paid.appr)}천원${paid.left ? ` (등록 합 ${thousand(paid.amt)}천원 + ${thousand(paid.left)}천원)` : ''}` : '');
function checks(staff, basis, { others = {}, budgetPay = null, paid = null, erp = null } = {}) {
  const out = [];
  if (!staff) return out;
  const lock = lockOf(paid);
  if (lock) {   // 지급이 끝난 달 — 안내 + 그 달의 계획이 rERP 등록과 다르면 경고(rERP 현재로 로 맞춤)
    out.push({ kind: 'paid', level: 'info', text: `${paidText(paid)} — ${ymText(lock)}까지의 계획은 바꿀 수 없습니다.` });
    for (const m of paidMismatch(staff, erp, lock)) out.push({ kind: 'paidDiff', level: 'warn', name: m.name, text: `${m.name} — 지급이 끝난 ${monthLabel(m.ym)} 계획 ${thousand(m.plan)}천원이 rERP 등록 ${thousand(m.erp)}천원과 다릅니다 — rERP 현재로 로 맞추세요.` });
  }
  for (const p of staff.people) {
    const s = personStats(p, basis);
    const mine = others[nameKeyOf(p.name)] || [];
    const hits = [];
    for (const r of s.rates) {
      if (!(r.amt > 0) || r.rate == null || hits.some((h) => h.ym === r.ym)) continue;   // 조각 참여율(일부 달은 날 수 비율로 되짚은 값) + 다른 과제 — 같은 달은 한 번만
      const theirs = mine.filter((o) => o.ym === r.ym);
      const sum = Math.round((r.rate + theirs.reduce((a, o) => a + o.rate, 0)) * 100) / 100;
      if (sum > 100) hits.push({ ym: r.ym, sum, mine: r.rate, theirs });
    }
    if (hits.length) {
      const h = hits[0];
      const parts = [`이 과제 ${rateText(h.mine)}`].concat(h.theirs.map((o) => `${o.label} ${rateText(o.rate)}`)).join(' · ');
      out.push({ kind: 'over', level: 'warn', name: p.name, text: `${p.name} — ${monthLabel(h.ym)} 참여율 합 ${rateText(h.sum)} (${parts})${hits.length > 1 ? ` 외 ${hits.length - 1}달` : ''}` });
    }
    if (s.avgRate != null && s.avgRate <= MIN_RATE) out.push({ kind: 'low', level: 'warn', name: p.name, text: `${p.name} — 월평균 참여율 ${rateText(s.avgRate)} — ${MIN_RATE}% 를 넘어야 합니다.` });   // 지급이 있는 사람만(제외만 있는 사람은 avgRate 가 null)
  }
  const noLimit = staff.people.filter((p) => !(monthlyPay(p, basis).amt > 0)).map((p) => p.name);
  if (noLimit.length) out.push({ kind: 'salary', level: 'warn', text: `월급여 없음: ${noLimit.join(', ')} — 참여율을 셈할 수 없습니다. 월급여를 적으세요.` });
  const fb = staff.people.filter((p) => monthlyPay(p, basis).fallback).map((p) => p.name);
  if (fb.length) out.push({ kind: 'fallback', level: 'info', text: `rERP 월급여 없음: ${fb.join(', ')} — 계획서 값으로 셈합니다.` });
  const ob = overBudget(staff, basis, budgetPay), bd = budgetDiff(ob);
  if (bd.kind === 'over') out.push({ kind: 'budget', level: 'error', text: `인건비 합 ${thousand(ob.total)}천원이 예산 ${thousand(ob.budget)}천원을 넘습니다 — ${bd.text}.` });
  else if (bd.kind === 'short') out.push({ kind: 'left', level: 'info', text: `인건비 합 ${thousand(ob.total)}천원 · 예산 ${thousand(ob.budget)}천원 — ${bd.text} (예산보다 적게 잡음).` });
  else if (bd.kind === 'even') out.push({ kind: 'even', level: 'info', text: `인건비 합 ${thousand(ob.total)}천원 — 예산과 같습니다.` });
  return out;
}

/* ---------- 글 ---------- */
const srcLabel = { manual: '직접', rerp: 'rERP', plan: '계획서', none: '' };
/* 요약 줄들 — 머리 줄(기준·합·예산)과 사람마다 한 줄. 월 최대는 연간과 같아도 적는다 */
function staffLines(staff, basis, { budgetPay = null } = {}) {
  if (!staff) return [];
  const b = basis || staff.basis;
  const ob = overBudget(staff, b, budgetPay);
  const head = [`월급여 기준: ${BASIS_LABEL[b]}`, `인건비 합 ${thousand(ob.total)}천원${ob.budget != null ? ` (예산 ${thousand(ob.budget)}천원${ob.over ? ' 초과' : ''})` : ''}`].join(' · ');
  const lines = [`■ 참여연구자 (${staff.people.length}명) — ${head}`];
  for (const p of staff.people) {
    const s = personStats(p, b);
    const bits = [p.role, s.limit ? `월급여 ${thousand(s.limit)}천원(${srcLabel[s.src]})` : '월급여 없음',
      s.from ? `${spanText(s.from, s.to)} (${monthsText(s.months)}개월)` : s.months ? `${monthsText(s.months)}개월` : '', `계상인건비 ${thousand(s.total)}천원`,
      s.rate != null ? `참여율 ${rateText(s.rate)}${s.maxRate != null ? ` (월 최대 ${rateText(s.maxRate)})` : ''}` : '',
      s.runs.length > 1 ? `구간 ${s.runs.map((r) => `${spanText(r.from, r.to)} ${r.off ? '제외' : `${thousand(r.amt)}천원 ${rateText(r.rate)}`}`).join(' · ')}` : '',
      s.planned ? `월별 ${monthlyText(p.plan)}` : ''].filter(Boolean);
    lines.push(`- ${p.name} — ${bits.join(' · ')}`);
  }
  return lines;
}
/* 탭으로 나눈 표(천원) — 엑셀·한글에 붙인다. 기간 구간마다 한 줄(rERP 참여인력 목록처럼), 월 최대·월별 지급은 사람의 첫 줄에만 */
function staffTsv(staff, basis) {
  if (!staff) return '';
  const b = basis || staff.basis;
  const rows = [['성명', '직위', '월급여(천원)', '참여기간', '개월', '계상인건비(천원)', '참여율', '월 최대', '월별 지급(천원)']];
  for (const p of staff.people) {
    const s = personStats(p, b);
    const runs = s.runs.length ? s.runs : [null];
    runs.forEach((r, i) => rows.push([p.name, p.role, thousand(s.limit),
      r ? spanText(r.from, r.to) : s.from ? spanText(s.from, s.to) : '', r ? monthsText(r.months) : (s.months ? monthsText(s.months) : ''), thousand(r ? r.amt : s.total), r ? (r.off ? '제외' : rateText(r.rate)) : rateText(s.rate),
      i ? '' : rateText(s.maxRate), i || !s.planned ? '' : monthlyText(p.plan)]));
  }
  return rows.map((r) => r.join('\t')).join('\n');
}

/* ---------- 저장 (storage.local.staffPlans — 과제 연차마다 계획 하나, 키 "과제번호@연차") ---------- */
/* key 를 주면 과제번호·연차가 빠진 항목은 키("과제번호@연차")에서 읽는다 */
function normalizePlanEntry(raw, key = '') {
  if (!raw || typeof raw !== 'object') return null;
  const staff = normalizeStaff(raw);
  const from = text(raw.from, 7), to = text(raw.to, 7);
  const k = String(key || '').split('@');
  const out = {
    prjNo: text(raw.prjNo, 40) || text(k[0] || '', 40), year: int(raw.year, 1, YEAR_MAX) || int(k[1] || '', 1, YEAR_MAX),
    prjNm: text(raw.prjNm, 200), from: isYm(from) ? from : '', to: isYm(to) ? to : '', budgetPay: money(raw.budgetPay), budget: normalizeBudget(raw.budget),
    basis: staff ? staff.basis : (BASES.includes(raw.basis) ? raw.basis : 'rerp'), src: staff ? staff.src : 'erp', people: staff ? staff.people : [],
    at: num(raw.at) || 0, by: text(raw.by, 40), note: text(raw.note, 300),
  };
  const paid = normalizePaid(raw.paid);   // 지급 완료 — 있을 때만 싣는다(옛 저장분·WORKSPACE 의 옛 모양과 같게)
  if (paid) out.paid = paid;
  return out;
}
function normalizePlans(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) { const e = normalizePlanEntry(v, k); if (e && e.prjNo) out[planKey(e.prjNo, e.year)] = e; }
  return out;
}
/* 묘비 — 90일 지난 것은 버린다 */
function gcTomb(del, now) {
  const out = {}; const t0 = (now || Date.now()) - TOMB_TTL;
  for (const [k, v] of Object.entries(del && typeof del === 'object' ? del : {})) { const ts = num(v); if (ts > t0) out[k] = ts; }
  return out;
}
async function load() { try { const r = await chrome.storage.local.get(KEY); return normalizePlans(r[KEY]); } catch (e) { return {}; } }
async function loadDeleted() { try { const r = await chrome.storage.local.get(DKEY); return gcTomb(r[DKEY]); } catch (e) { return {}; } }
async function save(plans) { await chrome.storage.local.set({ [KEY]: plans }); }
/* 연차 계획 하나를 지우고 묘비를 남긴다(공유 (Plus) 가 다른 사람의 사본도 지우도록). plans 는 호출한 쪽의 목록(거기서도 뺀다) */
async function remove(plans, key, now) {
  if (plans && typeof plans === 'object') delete plans[key];
  const del = await loadDeleted();
  del[key] = now || Date.now();
  await chrome.storage.local.set({ [KEY]: plans || {}, [DKEY]: del });
  return del;
}

const api = {
  KEY, DKEY, STAFF_MAX, BASES, BASIS_LABEL, MODES, YEAR_MAX, BUDGET_ITEMS, gcTomb, loadDeleted, remove,
  money, thousand, thousandOf, nameKeyOf, sameName, comma,
  isYm, ymOf, addMonths, ymRange, spanMonths, ymText, monthLabel,
  dim, isYmd, monthStart, monthEnd, addDays, dayCount, dateOf, segStart, segEnd, segDays, segFrac, isFull, spanText, monthsText,
  itemKeyOf, isPayItem, normalizeBudget, budgetPayOf, budgetText,
  SUPPORT_MAX, normalizeSupport, supportText, roleShort,
  planKey, yearLabel, anlOf, yearSpan, plansOfProject,
  monthlyOfSalary, rerpRate, MIN_RATE, amountOfRate, splitEven, splitByFrac,
  normalizePlan, normalizeCuts, pruneCuts, normalizePerson, normalizeStaff, normalizePlanEntry, normalizePlans, planMonthly, monthlyPay, runsOf, personStats, staffTotal, overBudget, budgetDiff, rateText, statsText, monthlyText, monthSums, sameMonthly,
  rowsOfErp, byName, peopleOfErp, othersOfErp, sharesOfErp, buildStaff, initFromShares, sharesOfStaff, carryOver,
  normalizePaid, paidThroughOf, lockOf, paidText, paidMismatch,
  resolveRange, applyChange, shareLeft, applyShare, spreadDelta, fitBudget, scaleRange, evenRange, maxRate, setTotal, setRate, setManual, mergeOthers, checks, staffLines, staffTsv, load, save,
};
export default api;
export {
  KEY, DKEY, STAFF_MAX, BASES, BASIS_LABEL, MODES, YEAR_MAX, BUDGET_ITEMS, gcTomb, loadDeleted, remove,
  money, thousand, thousandOf, nameKeyOf, sameName, comma,
  isYm, ymOf, addMonths, ymRange, spanMonths, ymText, monthLabel,
  dim, isYmd, monthStart, monthEnd, addDays, dayCount, dateOf, segStart, segEnd, segDays, segFrac, isFull, spanText, monthsText,
  itemKeyOf, isPayItem, normalizeBudget, budgetPayOf, budgetText,
  SUPPORT_MAX, normalizeSupport, supportText, roleShort,
  planKey, yearLabel, anlOf, yearSpan, plansOfProject,
  monthlyOfSalary, rerpRate, MIN_RATE, amountOfRate, splitEven, splitByFrac,
  normalizePlan, normalizeCuts, pruneCuts, normalizePerson, normalizeStaff, normalizePlanEntry, normalizePlans, planMonthly, monthlyPay, runsOf, personStats, staffTotal, overBudget, budgetDiff, rateText, statsText, monthlyText, monthSums, sameMonthly,
  rowsOfErp, byName, peopleOfErp, othersOfErp, sharesOfErp, buildStaff, initFromShares, sharesOfStaff, carryOver,
  normalizePaid, paidThroughOf, lockOf, paidText, paidMismatch,
  resolveRange, applyChange, shareLeft, applyShare, spreadDelta, fitBudget, scaleRange, evenRange, maxRate, setTotal, setRate, setManual, mergeOthers, checks, staffLines, staffTsv, load, save,
};
