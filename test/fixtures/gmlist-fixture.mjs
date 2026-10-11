// 전자결재 기안함 화면의 흉내 — 2026-10-11 CDP 로 읽은 DocListFinished.aspx(ASP.NET WebForms·Telerik 그리드)와 외부강의등 신고서 본문 틀
// (Forms/Drafts/KR_Outside_Lecture_Report.aspx, 읽기 꼴)의 뼈대만 남긴 것이다. 이름·금액은 지어낸 것. test/gmlist.test.mjs 와 test/wiring.test.mjs 가 쓴다.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const G = 'ctl00_ContentPlaceHolder1_grdDocList_grdDocList';
const SB = 'ctl00$ContentPlaceHolder1$SearchBar$';
const SB_ = 'ctl00_ContentPlaceHolder1_SearchBar_';

/**
 * 문서함 목록 화면 한 쪽.
 * @param {{rows?: object[], count?: number, pages?: number[], current?: number, hidden?: Record<string,string>, dateType?: string}} o
 *   rows 는 { id, form, formName, title, name, dept, date, done, status, flow, writer } — 실제 줄의 속성·칸 id 그대로 만든다.
 *   pages 는 쪽 넘김 링크의 인자(0부터), current 는 지금 쪽(0부터). hidden 은 숨은 칸에 더 넣을 것(__REAL_StatePersister 등).
 */
export function listPage({ rows = [], count = rows.length, pages = [], current = 0, hidden = {}, dateType = '기안일' } = {}) {
  const h = { __EVENTTARGET: '', __EVENTARGUMENT: '', __REAL_StatePersister: 'persist-1', __REAL_VIEWSTATE: 'rv-1', __VIEWSTATE: '', [`${SB}hfSystemTypeId`]: '', [`${SB}hfFormId`]: '', [`${SB}hfFormName`]: '',
    [`${SB_}dtpBeginningDate_calendar_SD`]: '[]', [`${SB_}dtpClosingDate_calendar_SD`]: '[]', ...hidden };
  const hiddenHtml = Object.entries(h).map(([n, v]) => `<input type="hidden" name="${esc(n)}" id="${esc(n.replace(/\$/g, '_'))}" value="${esc(v)}" />`).join('\n');
  const row = (r, i) => {
    const n = String(i + 1).padStart(2, '0');
    const params = `FORMID=${r.form}&amp;DOCID=${r.id}&amp;GROUPID=0&amp;MDTID=0&amp;DID=0&amp;ISMODIFY=0&amp;OLDDOC=&amp;ATTYN=0&amp;ALERTMAIL=0&amp;DOCCNT=${count}&amp;EXEMTD=RETMTD&amp;ACTYPE=-1`;
    const cell = (suffix, text) => `<td id="${G}_ctl${n}_td${suffix}" class="GridItem_td item_text"><span id="${G}_ctl${n}_lbl_${suffix}" class="item_text">${esc(text)}</span></td>`;
    return `<tr id="${G}_ctl${n}_docRow" DocumentViewLink_ClientID="${G}_ctl${n}_lnk_DOCUMENT_NAME" deleteStatus="0" documentID="${esc(r.id)}" dupID="0" class="GridItem_tr" formWidth="900"`
      + ` taskType="1" openType="1" reUse="1" formID="${esc(r.form)}" isSelected="0" systemType="0" isModify="0" writerID="${esc(r.writer || 'kimghw')}" Params="${esc(params)}" documentCaption="${esc(r.id)}" flowStatus="${esc(r.flow ?? '7')}" groupID="0">`
      + `<td id="${G}_ctl${n}_tdCheckBox" class="GridItem_td item_text"><input id="${G}_ctl${n}_chkRow" type="checkbox" name="ctl00$ContentPlaceHolder1$grdDocList$grdDocList$ctl${n}$chkRow" /></td>`
      + cell('FORM_NAME', r.formName)
      + `<td id="${G}_ctl${n}_tdDocumentName" class="GridItem_td item_text_subject"><span id="${G}_ctl${n}_lblDocumentHeader"></span>`
      + `<a onclick="javascript:return doclist_OnClick(${i}, '${G}_ctl${n}_docRow', '${esc(r.id)}');" id="${G}_ctl${n}_lnk_DOCUMENT_NAME" class="GridItemArrive" onmouseover="return escape('문서제목 : ${esc(r.title)}<br/>문서종류 : ${esc(r.formName)}<br/>문서번호 : ${esc(r.id)}')" href="javascript:__doPostBack('ctl00$ContentPlaceHolder1$grdDocList$grdDocList$ctl${n}$lnk_DOCUMENT_NAME','')">${esc(r.title)}</a></td>`
      + `<td id="${G}_ctl${n}_tdDocumentPreview" class="GridItem_td item_text_subject"><a id="${G}_ctl${n}_lnk_DOCUMENT_Preview" class="GridItemArrive" href="javascript:__doPostBack('ctl00$ContentPlaceHolder1$grdDocList$grdDocList$ctl${n}$lnk_DOCUMENT_Preview','')">미리보기</a></td>`
      + (r.name != null ? cell('EMP_NAME', r.name) + cell('DEPT_NAME', r.dept) : '')
      + cell('REPORT_DATE', r.date)
      + (r.done != null ? cell('COMPLETE_DATE', r.done) : '')
      + cell('FLOW_STATUS_NAME', r.status)
      + cell('ISOPINION', '') + cell('ISATTACH', '') + '</tr>';
  };
  const pager = [...new Set([current, ...pages])].sort((a, b) => a - b).map((p) => (p === current ? `<span class="table_pagenum_on"> ${p + 1} </span>`
    : `<a class="table_pagenum" href="javascript:__doPostBack('ctl00$ContentPlaceHolder1$pagerDocList','${p}')"> ${p + 1} </a>`)).join('');
  return `<!DOCTYPE html><html><head><title>전자 결재</title></head><body><form name="aspnetForm" method="post" action="DocList.aspx" id="aspnetForm">
${hiddenHtml}
<div class="SearchBar"><input name="${SB}txtSystemType" type="text" readonly="readonly" id="${SB_}txtSystemType" /><input name="${SB}txtFormID" type="text" readonly="readonly" id="${SB_}txtFormID" />
<input name="${SB}rcbSearchDateType" type="text" value="${esc(dateType)}" readonly="readonly" disabled="disabled" />
<input id="${SB_}dtpBeginningDate" name="${SB}dtpBeginningDate" type="text" value="2026-07-11" /><input id="${SB_}dtpBeginningDate_dateInput" name="${SB}dtpBeginningDate$dateInput" value="2026-07-11" type="text" />
<input id="${SB_}dtpClosingDate" name="${SB}dtpClosingDate" type="text" value="2026-10-11" /><input id="${SB_}dtpClosingDate_dateInput" name="${SB}dtpClosingDate$dateInput" value="2026-10-11" type="text" />
<input id="${SB_}chkDocumentSubject" type="checkbox" name="${SB}chkDocumentSubject" checked="checked" /><input name="${SB}txtSearchKeyWord" type="text" id="${SB_}txtSearchKeyWord" />
<input type="image" name="${SB}btnSearch" id="${SB_}btnSearch" title="검색" /></div>
<span class="SearchWorkNum02">문서건수 ${count}건</span>&nbsp;<span>(클릭시 결재진행현황, 더블 클릭시 문서개봉)</span>
<table id="${G}" class="Grid"><tr class="GridHeader"><th>&nbsp;</th><th><a id="${G}_ctl00_lnkHeader_FORM_NAME">문서종류</a></th><th><a id="${G}_ctl00_lnkHeader_DOCUMENT_NAME_DP">문서제목</a></th><th>미리보기</th><th>기안자</th><th>부서</th><th><a id="${G}_ctl00_lnkHeader_REPORT_DATE">기안일</a></th><th>완료일</th><th>상태</th><th>의견</th><th>첨부</th></tr>
${rows.map(row).join('\n')}
</table>
<table class="Grid"><tr><td class="GridPager">${pager}</td></tr></table>
</form></body></html>`;
}

/**
 * 외부강의등 신고서 본문 틀(완료된 문서 — 읽기 꼴). 값은 <span id="ctl00_ContentPlaceHolder_Content_…"> 에 있다(실측 id 그대로).
 * @param {{name?, dept?, org?, representative?, contact?, subject?, place?, from?, to?, start?, end?, hours?, mins?, batch?, avgTime?, monthCount?, fee?, avgFee?, yearTotal?, expenses?, note?, title?}} v
 */
export function reportPage(v = {}) {
  const C = 'ctl00_ContentPlaceHolder_Content_';
  const span = (id, text) => `<span id="${C}${id}">${esc(text ?? '')}</span>`;
  const won = (id, label, text) => `${span(`lbl${label}`, '')}${span(id, text)} <span id="${C}Won_${id}">원</span>`;
  return `<!DOCTYPE html><html><head><title>외부강의등 신고서</title></head><body><form id="aspnetForm">
<input type="hidden" id="ctl00_ApplineInfoInReportKRTA1_txtDocTitle" value="${esc(v.title ?? '외부강의등 신고서')}" /><span id="ctl00_ApplineInfoInReportKRTA1_lblDocTitle">${esc(v.title ?? '외부강의등 신고서')}</span>
<table class="ViewTable">
<tr><td class="ViewTableTitleForm">${span('Name', '성명')}</td><td class="ViewTableItemForm">${span('lblName', v.name ?? '김거화')}</td><td class="ViewTableTitleForm">${span('DeptName', '소속')}</td><td>${span('lblDeptName', v.dept ?? '수소전기추진연구팀')}</td></tr>
<tr><td class="ViewTableTitleForm">${span('InstituteName', '기관명')}</td><td class="ViewTableItemForm">${span('lblInstituteName', v.org)}</td><td>${span('Representative', '대표자')}</td><td>${span('lblRepresentative', v.representative)}</td></tr>
<tr><td>${span('Department', '담당부서(담당자)')}</td><td>${span('lblDepartment', v.contact)}</td><td>${span('DepartmentTel', '연락처')}</td><td>${span('lblDepartmentTel', '')}</td></tr>
<tr><td class="ViewTableTitleForm">${span('LectureTopic', '외부강의등 주제')}</td><td class="ViewTableItemForm" colspan="5">${span('lblLectureTopic', v.subject)}</td></tr>
<tr><td class="ViewTableTitleForm">${span('Place', '장소')}</td><td class="ViewTableItemForm" colspan="5">${span('lblPlace', v.place)}</td></tr>
<tr><td class="ViewTableTitleForm" rowspan="3">${span('lblDateTime', '일시')}</td><td class="ViewTableItemForm calendarDiv" colspan="2">${span('lblStartDate', v.from)} &nbsp;~&nbsp; ${span('lblEndDate', v.to)}</td>
<td class="ViewTableTitleForm">${span('lblAverageCount', '일괄신고 횟수')} :<br/>${span('AverageCountlbl', v.batch ?? 0)} ${span('AverageCountUnit1', '회')}<br/>${span('lblAverageTime', '1회 평균 시간')} :<br/>${span('AverageTimelbl', v.avgTime ?? 0)} ${span('AverageCountUnit2', '시간')}</td>
<td>${span('lblCumulativeCount', '당월 누적 : ')}<br/>${span('CumulativeCountlbl', v.monthCount ?? 0)} ${span('CumulativeCountUnit', '')}<br/><span disabled="disabled"><input id="${C}chkPriorNoti" type="checkbox" disabled="disabled" /><label for="${C}chkPriorNoti">3회 초과시 사전 신고 완료</label></span></td></tr>
<tr><td class="ViewTableItemForm calendarDiv">${span('lblStartTime', v.start)} &nbsp;~&nbsp; ${span('lblEndTime', v.end)}</td></tr>
<tr><td>${span('lblLectureTime', '총 시간')} &nbsp; ${span('lblLectureTextHour', v.hours ?? '')} ${span('Label2', '시간')} ${span('lblLectureTextMin', v.mins ?? '')} ${span('Label3', '분')}</td></tr>
<tr><td class="ViewTableTitleForm">${span('lblTotalHonorariumLabel', '사례금')}</td><td class="ViewTableItemForm" colspan="5">${span('TotalAmount', '총액')} &nbsp;:&nbsp; ${v.fee === undefined ? '' : span('lblTotalHonorarium', v.fee)} <span id="${C}Won1">원</span>
( ${span('lblAverageHonorarium', '※ 1회 평균 대가')} &nbsp; ${span('AverageHonorariumlbl', v.avgFee ?? 0)} <span id="${C}Won2">원</span> )<br/>
${span('lblCumulativeAmount', '당해 연도 사례금 누적 합계 : ')} ${span('CumulativeAmountlbl', v.yearTotal ?? '')} <span id="${C}Won5">원</span><br/>
[ ${span('lblEtc', '교통비, 숙박비, 식비(실비)')} ${span('Etclbl', v.expenses ?? 0)} <span id="${C}Won3">원</span> ${span('lblSeparately', '별도')} ]</td></tr>
<tr><td class="ViewTableTitleForm">${span('Label7', '비고')}</td><td class="ViewTableItemForm" colspan="5">${span('lblNote', v.note)}</td></tr>
</table></form></body></html>`;
}
