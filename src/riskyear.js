// eclass Quality 의 위험·기회 목록(Context of KR · Risk/Opportunity Management)에서 고른 연도를 메뉴를 옮겨도 그대로 둔다.
//
// 이 메뉴는 누를 때마다 포털 껍데기(/eClassVer4/Common/Sub_Default)가 통째로 다시 열리고, 목록은 그 안의 iframe 에
// 연도 없이 열린다 — 그러면 사이트는 늘 올해를 보여 준다. 차년도 계획을 쓰는 중이면 탭을 옮길 때마다 연도 콤보를
// 다시 골라야 했다.
//
// 그래서 연도 콤보(Telerik RadComboBox `rddlYear`)에서 고른 연도를 기억해 두었다가(storage 의 qualityYear), 목록이
// 연도 없이 열리면(KR 목록 둘은 서버가 302 로 올해를 붙인다) 그 연도를 주소에 붙여 다시 연다(location.replace —
// 뒤로 가기에 연도 없는 쪽이 남지 않는다).
// 여덟 목록 모두 `?Year=` 를 받아 콤보·부서 링크·새로 쓰기가 넘기는 연도까지 그 연도로 그린다(2026-10-15 실제 화면).
// 사이트의 버튼이나 포스트백은 누르지 않는다.
//
// 주소에 연도를 적는 법은 폴더마다 다르다. 사이트는 받은 값을 폼 action·숨은 칸(hdnYear)에 그대로 되찍으므로 사이트가
// 쓰는 방식대로 줘야 한다 — Context 는 숫자(Year=2027), RiskManagement 는 base64 의 = 를 _ 로 바꾼 것(Year=MjAyNw__).
// RiskManagement 에 숫자를 주면 KR Risk Assessment 의 New 가 hdnYear=2027 을 그대로 넘긴다.
//
// 쓸지 말지는 패널의 "설정 → 일반" 체크박스(storage 의 qualityYearKeep)를 따른다. 끄면 다시 열지도, 고른 연도를
// 기억하지도, 표시를 붙이지도 않는다 — 열려 있는 목록에서도 곧바로. 기억해 둔 연도는 지우지 않아 다시 켜면 이어진다.

/** 연도 유지를 쓸지. 패널의 "설정 → 일반" 체크박스가 이 값을 쓴다. 값이 없으면 켠 것으로 본다. */
export const ENABLE_KEY = 'qualityYearKeep';
export const riskYearEnabled = (value) => value !== false;
/** 기억한 연도. 값이 없으면 사이트가 정한 연도(올해)로 연다. */
export const YEAR_KEY = 'qualityYear';
/** 콤보 옆에 붙이는 "연도 유지" 표시의 표식. */
export const NOTE_CLASS = 'krs-year-keep';

/**
 * 연도를 이어 줄 목록과 그 폴더가 주소에 연도를 적는 법. 파일 이름은 소문자다(경로 대소문자가 들쭉날쭉하다).
 * KR Risk/Opportunity Register 는 껍데기(KR_RiskRegister_List_Main.aspx)가 목록을 iframe 으로 한 번 더 싸므로
 * 콤보가 있는 안쪽 목록을 적는다. 부서별 화면(…_List.aspx?Year=…&Dept_Code=…)은 링크가 연도를 들고 가므로 두지 않는다.
 */
const PAGES = {
  context: {
    enc: 'digits',
    files: [
      'qhse_location_issues_listall.aspx',  // Location Internal / External Issues (Kind=I·E)
      'qhse_location_parties_listall.aspx', // Location Interested Parties
      'qhse_kr_issues_list.aspx',           // KR Internal / External Issues
      'qhse_kr_parties_list.aspx',          // KR Interested Parties
    ],
  },
  riskmanagement: {
    enc: 'base64',
    files: [
      'riskassessment_listall.aspx',        // Location Risk Assessment
      'riskregister_listall.aspx',          // Location Risk/Opportunity Register
      'kr_riskassessment_list.aspx',        // KR Risk Assessment
      'kr_riskregister_list.aspx',          // KR Risk/Opportunity Register (안쪽 iframe)
    ],
  },
};
const PATH_RE = /^\/qhseaudit\/view\/qhse\/(context|riskmanagement)\/([^/]+)$/i;

/**
 * 연도를 이어 줄 목록인가. 맞으면 그 폴더가 연도를 적는 법을, 아니면 null 을 돌려준다.
 * @returns {{enc: 'digits'|'base64'}|null}
 */
export function pageOf(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  const m = url.pathname.match(PATH_RE);
  if (!m) return null;
  const dir = PAGES[m[1].toLowerCase()];
  return dir.files.includes(m[2].toLowerCase()) ? { enc: dir.enc } : null;
}

export const isYear = (v) => typeof v === 'string' && /^\d{4}$/.test(v);

/** 사이트가 쓰는 대로 적은 연도. base64 는 `2026` → `MjAyNg__` (사이트의 링크와 같다). */
export const encodeYear = (year, enc) => (enc === 'base64' ? btoa(year).replace(/=/g, '_') : year);

/**
 * 기억한 연도로 다시 열 주소. 그대로 둘 때는 null.
 *
 * - 주소에 연도가 이미 있으면 그대로 둔다 — 부서 링크·뒤로 가기처럼 연도를 들고 온 것이다. 비어 있는 `Year=`
 *   (부서 화면의 목록 단추가 그렇게 연다)는 없는 것으로 본다.
 * - 단, **서버가 리다이렉트로 붙인 연도는 고른 것이 아니다.** KR Risk Assessment·KR Risk/Opportunity Register 목록은
 *   연도 없이 열면 302 로 `?Year=<올해>` 를 붙여 보낸다(2026-10-15 실제 화면 — 다른 여섯 목록은 그냥 200). 그래서
 *   리다이렉트를 거쳐 열렸으면(redirected) 주소의 연도를 기억한 연도로 바꾼다.
 * - **같은 화면에서 왔으면 그대로 둔다.** 포스트백(POST)의 결과는 폼 action 주소로 열리는데 목록에 따라 연도가 없다.
 *   그걸 다시 열면 포스트백이 날아간다. 주소만으로는 POST 인지 모르므로 앞 화면(referrer)으로 가린다.
 *   앞 화면을 모르면(주소창에 직접 친 것 등) 역시 그대로 둔다 — 잘못 다시 여는 것보다 안 여는 편이 낫다.
 *   다시 연 화면은 앞 화면이 자기 자신이라 여기서 멈춘다 — 서버가 또 리다이렉트해도 되풀이하지 않는다.
 */
export function yearUrl({ href, referrer, year, redirected = false }) {
  const page = pageOf(href);
  if (!page || !isYear(year)) return null;
  const url = new URL(href);
  const want = encodeYear(year, page.enc);
  const keys = [...new Set(url.searchParams.keys())].filter((k) => k.toLowerCase() === 'year');
  const given = keys.flatMap((k) => url.searchParams.getAll(k)).filter(Boolean);
  if (given.length && (!redirected || given.every((v) => v === want))) return null;
  if (!fromElsewhere(url, referrer)) return null;
  for (const k of keys) url.searchParams.delete(k);
  url.searchParams.set('Year', want);
  return url.href;
}

/** 이 문서가 서버 리다이렉트를 거쳐 열렸는가(같은 출처라 navigation timing 의 redirectCount 가 보인다). */
export function wasRedirected(doc) {
  try {
    return (doc.defaultView?.performance?.getEntriesByType?.('navigation')?.[0]?.redirectCount || 0) > 0;
  } catch {
    return false;
  }
}

function fromElsewhere(url, referrer) {
  let ref;
  try { ref = new URL(referrer); } catch { return false; }
  return ref.origin !== url.origin || ref.pathname.toLowerCase() !== url.pathname.toLowerCase();
}

/**
 * 연도 콤보의 펼친 목록에서 누른 연도. 아니면 null.
 * 항목의 클래스는 마우스가 올라가면 rcbItem 에서 rcbHovered 로 바뀌므로 클래스가 아니라 목록 안의 li 로 찾는다.
 * 펼친 목록은 Telerik 이 열 때 문서 끝으로 옮기기도 해서 콤보 안이 아니라 id(…_rddlYear_DropDown)로 찾는다.
 */
export function pickedYear(target) {
  const year = target?.closest?.('[id$="_rddlYear_DropDown"] li')?.textContent.trim();
  return isYear(year) ? year : null;
}

/* ------------------------------------------------------------ 연도 유지 표시 */

// 콤보 오른쪽의 작은 회색 글자. 사이트의 기본 연도를 확장이 바꾸고 있다는 것을 알리고, × 로 잊게 한다.
const NOTE_STYLE = 'display:inline-block; margin-left:8px; font-size:11px; color:#777; vertical-align:middle; white-space:nowrap;';
const FORGET_STYLE = 'margin-left:2px; padding:0 3px; border:0; background:none; color:#999; font-size:13px; line-height:1; cursor:pointer;';

/**
 * 콤보 옆에 "<연도> 유지 ×" 를 붙인다(이미 있으면 연도만 고친다). 콤보가 없으면 null.
 * Location 목록은 콤보를 RadAjaxPanel 이 싸고 있어 연도를 고르면 그 안이 새로 그려진다 — 그래서 패널 바깥에 붙인다.
 */
export function mountNote(doc, year, onForget) {
  const combo = doc.querySelector('div.RadComboBox[id$="_rddlYear"]');
  if (!combo) return null;
  let note = doc.querySelector(`.${NOTE_CLASS}`);
  if (!note) {
    note = doc.createElement('span');
    note.className = NOTE_CLASS;
    note.style.cssText = NOTE_STYLE;
    note.title = 'KRS WORKSPACE: 메뉴를 옮겨도 이 연도로 엽니다. ×를 누르면 잊고 사이트가 정한 연도로 엽니다.';
    const label = doc.createElement('span');
    // 폼(aspnetForm) 안이라 type 을 안 주면 눌렀을 때 폼이 제출된다.
    const forget = doc.createElement('button');
    forget.type = 'button';
    forget.textContent = '×';
    forget.setAttribute('aria-label', '기억한 연도 잊기');
    forget.style.cssText = FORGET_STYLE;
    forget.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onForget?.();
    });
    note.append(label, forget);
    (combo.closest('.RadAjaxPanel') || combo).after(note);
  }
  note.firstChild.textContent = `${year} 유지`;
  return note;
}

export function unmountNote(doc) {
  doc.querySelector(`.${NOTE_CLASS}`)?.remove();
}

/* ------------------------------------------------------------ 시동 */

// 확장이 다시 올려져 이 스크립트가 끊기면 storage 호출이 곧바로 던진다. 새로고침하면 풀리는 일이라 삼킨다.
const quietly = (fn) => {
  try { Promise.resolve(fn()).catch(() => {}); } catch { /* 끊긴 콘텐츠 스크립트 */ }
};

/** storage 변화를 듣는다. 돌려주는 함수로 그만 듣는다. */
function defaultOnChanged(fn) {
  const ev = chrome.storage.onChanged;
  if (!ev) return () => {};
  ev.addListener(fn);
  return () => ev.removeListener(fn);
}

/**
 * 콘텐츠 스크립트가 부른다(document_start, 모든 프레임). 목록이 아니면 아무것도 안 한다.
 * 켜져 있고 기억한 연도가 있고 목록이 연도 없이 열렸으면 그 연도로 다시 열고 끝낸다. 아니면 연도 콤보에서 고르는
 * 것을 듣고, 기억한 연도가 있으면 콤보 옆에 표시를 붙인다. 설정(ENABLE_KEY)이 바뀌면 열린 목록도 곧바로 따른다.
 *
 * 바깥 것은 주입받는다(storage·onChanged·replace·redirected) — 테스트가 가짜로 돌리기 위해서다.
 * @returns {Promise<{redirected: boolean, on?: boolean, year?: string|null, stop?: Function}>}
 */
export async function startRiskYear(doc, deps = {}) {
  const href = doc.location.href;
  if (!pageOf(href)) return { redirected: false };
  const storage = deps.storage || chrome.storage.local;
  const onChanged = deps.onChanged || defaultOnChanged;
  const replace = deps.replace || ((next) => doc.location.replace(next));

  const saved = await storage.get([ENABLE_KEY, YEAR_KEY]);
  let on = riskYearEnabled(saved?.[ENABLE_KEY]);
  let year = isYear(saved?.[YEAR_KEY]) ? saved[YEAR_KEY] : null;

  const redirected = deps.redirected ?? wasRedirected(doc);
  const next = on && yearUrl({ href, referrer: doc.referrer, year, redirected });
  if (next) {
    replace(next);
    return { redirected: true };
  }

  let ready = doc.readyState !== 'loading';
  const show = () => {
    if (!ready) return;
    if (on && year) mountNote(doc, year, forget);
    else unmountNote(doc);
  };
  const forget = () => {
    year = null;
    quietly(() => storage.remove(YEAR_KEY));
    show();
  };

  // 캡처 단계에서 듣는다 — 콤보가 클릭을 받아 목록을 닫거나 전파를 막아도 먼저 본다.
  const onClick = (e) => {
    if (!on) return;
    const picked = pickedYear(e.target);
    if (!picked) return;
    year = picked;
    quietly(() => storage.set({ [YEAR_KEY]: picked }));
    show();
  };
  doc.addEventListener('click', onClick, true);

  // 끄고 켜기, 그리고 다른 프레임·탭에서 고르거나 잊은 연도를 따라간다.
  const off = onChanged((changes, area) => {
    if (area && area !== 'local') return;
    if (ENABLE_KEY in changes) on = riskYearEnabled(changes[ENABLE_KEY].newValue);
    if (YEAR_KEY in changes) year = isYear(changes[YEAR_KEY].newValue) ? changes[YEAR_KEY].newValue : null;
    if (ENABLE_KEY in changes || YEAR_KEY in changes) show();
  });

  if (ready) show();
  else doc.addEventListener('DOMContentLoaded', () => { ready = true; show(); }, { once: true });

  return {
    redirected: false,
    get on() { return on; },
    get year() { return year; },
    stop() {
      off?.();
      doc.removeEventListener('click', onClick, true);
      unmountNote(doc);
    },
  };
}
