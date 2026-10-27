// 전자결재 임시보관함의 문서 지우기 — 공문 이력의 임시보관 카드(문서작성중·임시저장) 삭제와 공문 작성의 작성 취소(2026-10-27 사용자 지정:
// "삭제 기능이 없다.. 임시공문 작성 중인것도 삭제 같이"). 같은 일을 ApprovalInPrinciple 의 vendor/ea_writer/discard.py 가 브라우저 클릭으로 한다
// (2026-08-11·10-07 실제로 지움 — 그쪽 references/krs_ea_draftbox.md). 여기는 공문 이력처럼 직접 요청(포스트백)으로 보낸다.
//
// 실측(2026-10-27 CDP, 읽기 전용 — 누르지 않음):
//   임시저장 문서의 문서 화면(DocumentView)에는 삭제가 없고, 기안함 > 임시보관함(DocListTemp.aspx) 목록이 유일한 길이다. 새 공문 창을 열기만 하고 닫아도
//   문서번호가 잡혀 '문서작성중'(flowStatus 1)으로 이 함에 남는다(HER-2026-000751). 줄 <tr documentID> 안에 체크박스 <grid>$ctlNN$chkRow 가 있고,
//   툴바의 문서삭제(ctl00_ContentPlaceHolder1_ToolBar_lbtnDocumentDelete)는 체크된 줄이 있는지만 보고(ctl00_DocumentDelete) confirm("문서를 삭제하시겠습니까?") 뒤
//   __doPostBack('ctl00$ContentPlaceHolder1$ToolBar$lbtnDocumentDelete','') 이다 — 서버는 폼에 실린 체크박스로 지울 줄을 안다.
//   그래서 목록을 그 문서의 작성일로 검색해(src/gmlist.js 의 검색 포스트백) 문서번호가 **똑같은** 줄을 찾고, 그 줄의 체크박스 하나만 켠 폼으로 같은 포스트백을 보낸다.
//   제목·차례로 찾지 않는다. 보낸 뒤 목록을 처음부터 다시 읽어 사라졌는지로 판정한다(그대로면 던진다). 목록에 처음부터 없으면 이미 없는 것(absent)이다.
import { AuthError, siteFetch } from './net.js';
import { BOXES, PAGE_SIZE, LOGIN, boxUrl, looksLogin, parseDocList, postback, searchFields, spanFrom } from './gmlist.js';

/** 툴바의 문서삭제 단추(포스트백 대상). */
export const DELETE_TARGET = 'ctl00$ContentPlaceHolder1$ToolBar$lbtnDocumentDelete';
const SEARCH = 'ctl00$ContentPlaceHolder1$SearchBar$btnSearch';
const PAGER = 'ctl00$ContentPlaceHolder1$pagerDocList';
const MAX_PAGES = 30;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 목록 화면에서 그 문서번호 줄의 체크박스 이름 — 줄이 없거나 체크박스가 없으면 ''. */
export function checkName(html, docId) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tr = [...doc.querySelectorAll('tr[documentID]')].find((x) => x.getAttribute('documentID') === docId);
  return tr?.querySelector('input[type="checkbox"][name$="$chkRow"]')?.getAttribute('name') || '';
}

/**
 * 임시보관함에서 그 문서번호의 줄을 찾는다 — 작성일(from~to)로 검색하고 쪽을 넘기며. 찾으면 그 쪽의 숨은 칸·검색 칸·줄·체크박스 이름, 없으면 null.
 * @returns {Promise<{url: string, hidden: Record<string,string>, fields: Record<string,string>, row: object, chk: string}|null>}
 */
export async function findTemp(docId, { from, to, fetch = siteFetch } = {}) {
  const url = boxUrl('temp');
  const first = await fetch(url);
  if (looksLogin(first.html)) throw new AuthError(LOGIN);
  let page = parseDocList(first.html);
  if (!('__REAL_StatePersister' in page.hidden) && !('__VIEWSTATE' in page.hidden)) throw new Error(`${BOXES.temp.label} 화면의 모양이 다릅니다.`);
  const fields = searchFields({ from, to });
  let r = await postback(url, page.hidden, fields, SEARCH, '', fetch);
  for (let i = 0; ; i++) {
    if (looksLogin(r.html)) throw new AuthError(LOGIN);
    page = parseDocList(r.html);
    const row = page.rows.find((x) => x.id === docId);
    if (row) {
      const chk = checkName(r.html, docId);
      if (!chk) throw new Error(`${BOXES.temp.label}의 ${docId} 줄에 고르는 칸이 없습니다 — 화면의 모양이 다릅니다.`);
      return { url, hidden: page.hidden, fields, row: { ...row, box: 'temp' }, chk };
    }
    if (!page.rows.length || i + 1 >= Math.min(Math.ceil(page.count / PAGE_SIZE), MAX_PAGES)) return null;
    r = await postback(url, page.hidden, fields, PAGER, String(i + 1), fetch);
  }
}

/**
 * 임시보관함의 문서 한 건을 지운다(문서작성중·임시저장 — 상신·완료·반려 문서는 이 함에 없어 찾지 못한다).
 * date 는 그 문서의 작성일(공문 이력 줄의 date — 작성 취소면 오늘) — 그날로 검색한다. 모르면 today 에서 2년 앞까지.
 * @returns {Promise<{ok: true, absent: boolean, title: string}>} absent 는 처음부터 목록에 없었던 것(이미 지워짐)
 */
export async function deleteTemp(docId, { date = '', today = '', fetch = siteFetch } = {}) {
  const id = String(docId || '').trim();
  if (!id) throw new Error('지울 문서번호가 없습니다.');
  const day = DATE_RE.test(date) ? date : '';
  const end = day || (DATE_RE.test(today) ? today : new Date().toLocaleDateString('sv-SE'));
  const range = { from: day || spanFrom('y2', end), to: end };
  const hit = await findTemp(id, { ...range, fetch });
  if (!hit) return { ok: true, absent: true, title: '' };
  const r = await postback(hit.url, hit.hidden, { ...hit.fields, [hit.chk]: 'on' }, DELETE_TARGET, '', fetch);
  if (looksLogin(r.html)) throw new AuthError(LOGIN);
  // 응답만 믿지 않는다 — 처음부터 다시 읽어 그 줄이 없어야 지운 것이다.
  if (await findTemp(id, { ...range, fetch })) throw new Error(`삭제를 보냈지만 ${id} 이(가) ${BOXES.temp.label}에 그대로 있습니다. eclass 의 ${BOXES.temp.label}에서 확인해 주세요.`);
  return { ok: true, absent: false, title: hit.row.title };
}
