// Quality 위험·기회 목록의 연도 유지: 어느 화면인지, 연도 적는 법, 다시 열 주소(포스트백은 건드리지 않음),
// 콤보에서 고른 연도 기억, 콤보 옆 표시와 잊기, 매니페스트 배선.
// 가장 중요한 건 **포스트백 결과를 다시 열지 않는 것**과 **사이트가 쓰는 방식대로 연도를 적는 것**이다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  pageOf, isYear, encodeYear, yearUrl, wasRedirected, pickedYear, mountNote, unmountNote, startRiskYear,
  YEAR_KEY, ENABLE_KEY, riskYearEnabled, NOTE_CLASS,
} from '../src/riskyear.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const ORIGIN = 'https://eclass.krs.co.kr';
const CTX = `${ORIGIN}/QHSEAudit/View/QHSE/Context/`;
const RM = `${ORIGIN}/QHSEAudit/View/QHSE/RiskManagement/`;
const SHELL = `${ORIGIN}/eClassVer4/Common/Sub_Default?title=Quality&menu=%2FQHSEAudit%2FView%2FQHSE%2FRiskManagement%2FRiskAssessment_ListAll.aspx&menuID=MQA00002&submenuID=PQA000050001&newWindow=False`;

/**
 * 2026-10-15 RiskAssessment_ListAll·KR_RiskAssessment_List 캡처의 연도 줄 뼈대. Location 목록은 콤보를
 * RadAjaxPanel 이 싸고(panel), KR 목록은 콤보만 있다. 펼친 목록은 콤보 안의 rcbSlide 에 있다.
 */
function yearRow({ panel = true, year = '2026', items = ['2027', '2026', '2025'] } = {}) {
  const combo = `<div id="ctl00_MainPlaceHolder_rddlYear" class="RadComboBox RadComboBox_Default" style="width:100px;white-space:normal;">
    <table summary="combobox"><tr class="rcbReadOnly">
      <td class="rcbInputCell rcbInputCellLeft"><input name="ctl00$MainPlaceHolder$rddlYear" type="text" class="rcbInput radPreventDecorate" id="ctl00_MainPlaceHolder_rddlYear_Input" value="${year}" readonly="readonly" /></td>
      <td class="rcbArrowCell rcbArrowCellRight"><a id="ctl00_MainPlaceHolder_rddlYear_Arrow">select</a></td>
    </tr></table>
    <div class="rcbSlide" style="z-index:6000;"><div id="ctl00_MainPlaceHolder_rddlYear_DropDown" class="RadComboBoxDropDown RadComboBoxDropDown_Default " style="display:none;">
      <div class="rcbScroll rcbWidth"><ul class="rcbList">${items.map((y) => `<li class="rcbItem">${y}</li>`).join('')}</ul></div>
    </div></div>
    <input id="ctl00_MainPlaceHolder_rddlYear_ClientState" name="ctl00_MainPlaceHolder_rddlYear_ClientState" type="hidden" />
  </div>`;
  return `<form name="aspnetForm" method="post" action="./RiskAssessment_ListAll.aspx" id="aspnetForm">
    <table><tr><td>
      <span style="padding: 0 10px 0 0;">YEAR in which the relevant "Risk Treatment" shall be implemented:</span>
      ${panel ? `<div class="RadAjaxPanel" id="ctl00_MainPlaceHolder_ctl00_MainPlaceHolder_rddlYearPanel">${combo}</div>` : combo}
    </td><td style="text-align: right;"><label class="btn btn-save">Total</label></td></tr></table>
  </form>`;
}

function pageDoc({ url = `${RM}RiskAssessment_ListAll.aspx`, referrer = SHELL, body = yearRow() } = {}) {
  const dom = new JSDOM(`<html><head></head><body>${body}</body></html>`, { url, referrer });
  return dom.window.document;
}

/** chrome.storage.local 흉내(get·set·remove). 바꾼 것은 onChanged 로 알린다. */
function fakeStorage(init = {}) {
  const data = structuredClone(init);
  const listeners = [];
  const fire = (changes) => { for (const fn of [...listeners]) fn(changes, 'local'); };
  let reads = 0;
  return {
    data,
    get reads() { return reads; },
    get: async (keys) => {
      reads++;
      const out = {};
      for (const k of [].concat(keys)) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    set: async (obj) => {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
        data[k] = structuredClone(v);
      }
      fire(changes);
    },
    remove: async (keys) => {
      const changes = {};
      for (const k of [].concat(keys)) {
        changes[k] = { oldValue: data[k] };
        delete data[k];
      }
      fire(changes);
    },
    onChanged: (fn) => {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    listenerCount: () => listeners.length,
  };
}

/** 가짜 storage 로 시동한다. replace 를 안 주면 다시 여는 순간 실패한다. */
const start = (doc, storage, replace = (u) => assert.fail(`다시 열면 안 되는데 열었다: ${u}`)) =>
  startRiskYear(doc, { storage, onChanged: storage.onChanged, replace });

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
const itemOf = (doc, year) => [...doc.querySelectorAll('#ctl00_MainPlaceHolder_rddlYear_DropDown li')].find((li) => li.textContent === year);
const noteOf = (doc) => doc.querySelector(`.${NOTE_CLASS}`);

console.log('연도를 이어 줄 목록');
{
  const ctx = ['QHSE_Location_Issues_ListAll.aspx?Kind=I', 'QHSE_Location_Issues_ListAll.aspx?Kind=E', 'QHSE_Location_Parties_ListAll.aspx', 'QHSE_KR_Issues_List.aspx?Kind=I', 'QHSE_KR_Issues_List.aspx?Kind=E', 'QHSE_KR_Parties_List.aspx'];
  const rm = ['RiskAssessment_ListAll.aspx', 'RiskRegister_ListAll.aspx', 'KR_RiskAssessment_List.aspx', 'KR_RiskRegister_List.aspx'];
  t('Context of KR 의 여섯 메뉴는 숫자로 적는다', () => { for (const p of ctx) assert.deepEqual(pageOf(CTX + p), { enc: 'digits' }, p); });
  t('Risk/Opportunity Management 의 네 목록은 base64 로 적는다', () => { for (const p of rm) assert.deepEqual(pageOf(RM + p), { enc: 'base64' }, p); });
  t('경로 대소문자는 가리지 않는다', () => assert.deepEqual(pageOf(`${ORIGIN}/qhseaudit/view/qhse/riskmanagement/riskassessment_listall.aspx`), { enc: 'base64' }));
  t('KR Register 껍데기(콤보가 없다)·부서별 화면·쓰기 화면은 아니다', () => {
    for (const p of ['KR_RiskRegister_List_Main.aspx', 'RiskAssessment_List.aspx?Year=MjAyNw__&Dept_Code=QUJU', 'RiskRegister_List_Main.aspx?Year=MjAyNw__&Dept_Code=QUlU', 'KR_RiskAssessment_Write.aspx?Year=MjAyNw__']) {
      assert.equal(pageOf(RM + p), null, p);
    }
    assert.equal(pageOf(`${CTX}QHSE_Location_Issues_List.aspx?Year=2026&Dept_Code=ABT&Kind=E`), null);
  });
  t('다른 폴더(Management·Review)와 껍데기는 아니다', () => {
    assert.equal(pageOf(`${ORIGIN}/QHSEAudit/View/QHSE/Review/QHSE_Location_Management_Review_ListAll.aspx`), null);
    assert.equal(pageOf(SHELL), null);
    assert.equal(pageOf('not a url'), null);
  });
}

console.log('연도 적는 법 — 사이트의 링크와 같게');
{
  t('base64 는 = 를 _ 로 바꾼다 (사이트 링크의 MjAyNg__ = 2026)', () => {
    assert.equal(encodeYear('2026', 'base64'), 'MjAyNg__');
    assert.equal(encodeYear('2027', 'base64'), 'MjAyNw__');
  });
  t('숫자는 그대로', () => assert.equal(encodeYear('2027', 'digits'), '2027'));
  t('연도는 네 자리 숫자 글자만', () => {
    assert.ok(isYear('2027'));
    for (const v of [2027, '27', '2027 ', 'MjAyNw__', null, undefined, '']) assert.ok(!isYear(v), String(v));
  });
}

console.log('다시 열 주소');
{
  t('껍데기에서 연도 없이 열린 RiskManagement 목록 → Year=<base64>', () =>
    assert.equal(yearUrl({ href: `${RM}RiskAssessment_ListAll.aspx`, referrer: SHELL, year: '2027' }), `${RM}RiskAssessment_ListAll.aspx?Year=MjAyNw__`));
  t('Context 목록은 숫자로, Kind 는 그대로 둔다', () =>
    assert.equal(yearUrl({ href: `${CTX}QHSE_Location_Issues_ListAll.aspx?Kind=E`, referrer: SHELL, year: '2027' }), `${CTX}QHSE_Location_Issues_ListAll.aspx?Kind=E&Year=2027`));
  t('KR Register 의 안쪽 목록은 껍데기 화면에서 온다', () =>
    assert.equal(yearUrl({ href: `${RM}KR_RiskRegister_List.aspx`, referrer: `${RM}KR_RiskRegister_List_Main.aspx`, year: '2027' }), `${RM}KR_RiskRegister_List.aspx?Year=MjAyNw__`));
  t('비어 있는 Year= (부서 화면의 목록 단추) 는 채운다 — 같은 이름을 둘 두지 않는다', () => {
    const next = yearUrl({ href: `${RM}RiskRegister_ListAll.aspx?Year=`, referrer: `${RM}RiskRegister_List_Main.aspx?Year=MjAyNg__&Dept_Code=QUlU`, year: '2027' });
    assert.equal(next, `${RM}RiskRegister_ListAll.aspx?Year=MjAyNw__`);
    assert.equal(new URL(next).searchParams.getAll('Year').length, 1);
  });
  t('주소에 연도가 있으면 그대로 둔다 (부서 링크·뒤로 가기)', () => {
    assert.equal(yearUrl({ href: `${RM}KR_RiskAssessment_List.aspx?Year=MjAyNg__`, referrer: SHELL, year: '2027' }), null);
    assert.equal(yearUrl({ href: `${CTX}QHSE_KR_Parties_List.aspx?year=2025`, referrer: SHELL, year: '2027' }), null, '이름 대소문자');
  });
  t('서버가 리다이렉트로 붙인 연도(KR 목록의 302 → ?Year=<올해>)는 기억한 연도로 바꾼다', () => {
    assert.equal(yearUrl({ href: `${RM}KR_RiskAssessment_List.aspx?Year=MjAyNg__`, referrer: SHELL, year: '2027', redirected: true }), `${RM}KR_RiskAssessment_List.aspx?Year=MjAyNw__`);
    assert.equal(yearUrl({ href: `${RM}KR_RiskRegister_List.aspx?Year=MjAyNg__`, referrer: `${RM}KR_RiskRegister_List_Main.aspx`, year: '2027', redirected: true }), `${RM}KR_RiskRegister_List.aspx?Year=MjAyNw__`);
  });
  t('리다이렉트로 붙인 연도가 이미 기억한 연도면 그대로 둔다', () =>
    assert.equal(yearUrl({ href: `${RM}KR_RiskAssessment_List.aspx?Year=MjAyNw__`, referrer: SHELL, year: '2027', redirected: true }), null));
  t('다시 연 화면이 또 리다이렉트돼도 되풀이하지 않는다 (앞 화면이 자기 자신)', () =>
    assert.equal(yearUrl({ href: `${RM}KR_RiskAssessment_List.aspx?Year=MjAyNg__`, referrer: `${RM}KR_RiskAssessment_List.aspx?Year=MjAyNw__`, year: '2027', redirected: true }), null));
  t('같은 화면에서 왔으면(포스트백 결과) 그대로 둔다', () => {
    assert.equal(yearUrl({ href: `${CTX}QHSE_KR_Parties_List.aspx`, referrer: `${CTX}QHSE_KR_Parties_List.aspx`, year: '2027' }), null);
    assert.equal(yearUrl({ href: `${CTX}QHSE_KR_Issues_List.aspx?Kind=E`, referrer: `${CTX}QHSE_KR_Issues_List.aspx?Kind=E&Year=2027`, year: '2027' }), null, '앞 주소에 연도가 있었어도');
    assert.equal(yearUrl({ href: `${RM}riskassessment_listall.aspx`, referrer: `${RM}RiskAssessment_ListAll.aspx`, year: '2027' }), null, '대소문자만 다른 같은 화면');
  });
  t('앞 화면을 모르면 그대로 둔다', () => {
    assert.equal(yearUrl({ href: `${RM}RiskAssessment_ListAll.aspx`, referrer: '', year: '2027' }), null);
    assert.equal(yearUrl({ href: `${RM}RiskAssessment_ListAll.aspx`, referrer: undefined, year: '2027' }), null);
  });
  t('기억한 연도가 없거나 이상하면 그대로 둔다', () => {
    for (const year of [null, undefined, '', 'MjAyNw__', 2027]) {
      assert.equal(yearUrl({ href: `${RM}RiskAssessment_ListAll.aspx`, referrer: SHELL, year }), null, String(year));
    }
  });
  t('목록이 아니면 그대로 둔다', () =>
    assert.equal(yearUrl({ href: `${RM}KR_RiskRegister_List_Main.aspx`, referrer: SHELL, year: '2027' }), null));
}

console.log('콤보에서 고른 연도');
{
  const doc = pageDoc();
  t('펼친 목록의 연도 항목', () => assert.equal(pickedYear(itemOf(doc, '2027')), '2027'));
  t('마우스가 올라가 클래스가 rcbHovered 로 바뀐 항목도', () => {
    const li = itemOf(doc, '2025');
    li.className = 'rcbHovered';
    assert.equal(pickedYear(li), '2025');
  });
  t('펼친 목록이 문서 끝으로 옮겨져 있어도', () => {
    doc.body.append(doc.querySelector('.rcbSlide'));
    assert.equal(pickedYear(itemOf(doc, '2026')), '2026');
  });
  t('다른 콤보의 항목·연도가 아닌 글자·콤보 바깥은 아니다', () => {
    const d = pageDoc({ body: `${yearRow()}<div id="ctl00_MainPlaceHolder_rddlKind_DropDown"><ul><li class="rcbItem">2027</li></ul></div>` });
    assert.equal(pickedYear(d.querySelector('#ctl00_MainPlaceHolder_rddlKind_DropDown li')), null);
    const li = itemOf(d, '2027');
    li.textContent = 'All';
    assert.equal(pickedYear(li), null);
    assert.equal(pickedYear(d.querySelector('label.btn')), null);
    assert.equal(pickedYear(null), null);
  });
}

console.log('연도 유지 표시');
{
  t('Location 목록은 RadAjaxPanel 바깥, 바로 뒤에 붙는다 (연도를 고르면 패널 안이 새로 그려진다)', () => {
    const doc = pageDoc();
    const note = mountNote(doc, '2027', () => {});
    const panel = doc.querySelector('.RadAjaxPanel');
    assert.equal(panel.nextElementSibling, note);
    assert.ok(!panel.contains(note));
    assert.match(note.textContent, /^2027 유지×$/);
    panel.innerHTML = '<div id="ctl00_MainPlaceHolder_rddlYear" class="RadComboBox"></div>';
    assert.ok(noteOf(doc), '패널을 다시 그려도 남는다');
  });
  t('KR 목록은 콤보 바로 뒤에', () => {
    const doc = pageDoc({ url: `${RM}KR_RiskAssessment_List.aspx?Year=MjAyNw__`, body: yearRow({ panel: false }) });
    const note = mountNote(doc, '2027', () => {});
    assert.equal(doc.getElementById('ctl00_MainPlaceHolder_rddlYear').nextElementSibling, note);
  });
  t('다시 붙이면 하나만 두고 연도만 고친다', () => {
    const doc = pageDoc();
    mountNote(doc, '2027', () => {});
    mountNote(doc, '2025', () => {});
    assert.equal(doc.querySelectorAll(`.${NOTE_CLASS}`).length, 1);
    assert.match(noteOf(doc).textContent, /^2025 유지/);
  });
  t('× 는 폼을 제출하지 않는 단추다', () => {
    const doc = pageDoc();
    let forgot = 0;
    let submitted = 0;
    doc.getElementById('aspnetForm').addEventListener('submit', (e) => { submitted++; e.preventDefault(); });
    const btn = mountNote(doc, '2027', () => forgot++).querySelector('button');
    assert.equal(btn.type, 'button');
    click(btn);
    assert.equal(forgot, 1);
    assert.equal(submitted, 0);
  });
  t('콤보가 없는 화면에는 붙이지 않는다', () => assert.equal(mountNote(pageDoc({ body: '<form></form>' }), '2027'), null));
  t('뗀다', () => {
    const doc = pageDoc();
    mountNote(doc, '2027');
    unmountNote(doc);
    assert.equal(noteOf(doc), null);
  });
}

console.log('시동');
{
  await ta('기억한 연도가 있고 껍데기에서 연도 없이 열렸으면 그 연도로 다시 연다 — 표시도 클릭도 손대지 않는다', async () => {
    const doc = pageDoc();
    const storage = fakeStorage({ [YEAR_KEY]: '2027' });
    const went = [];
    const h = await start(doc, storage, (u) => went.push(u));
    assert.equal(h.redirected, true);
    assert.deepEqual(went, [`${RM}RiskAssessment_ListAll.aspx?Year=MjAyNw__`]);
    assert.equal(noteOf(doc), null);
    assert.equal(storage.listenerCount(), 0, '다시 여는 화면은 설정도 듣지 않는다');
    click(itemOf(doc, '2025'));
    assert.equal(storage.data[YEAR_KEY], '2027', '다시 여는 화면에서는 고르는 것을 듣지 않는다');
  });
  await ta('KR 목록이 서버 리다이렉트로 올해를 붙여 열렸으면 기억한 연도로 다시 연다', async () => {
    const doc = pageDoc({ url: `${RM}KR_RiskAssessment_List.aspx?Year=MjAyNg__`, body: yearRow({ panel: false }) });
    const went = [];
    const storage = fakeStorage({ [YEAR_KEY]: '2027' });
    const h = await startRiskYear(doc, { storage, onChanged: storage.onChanged, replace: (u) => went.push(u), redirected: true });
    assert.equal(h.redirected, true);
    assert.deepEqual(went, [`${RM}KR_RiskAssessment_List.aspx?Year=MjAyNw__`]);
  });
  t('리다이렉트 여부는 navigation timing 에서 읽고, 못 읽으면 아닌 것으로 본다', () => {
    const fake = (entries) => ({ defaultView: { performance: { getEntriesByType: () => entries } } });
    assert.equal(wasRedirected(fake([{ redirectCount: 1 }])), true);
    assert.equal(wasRedirected(fake([{ redirectCount: 0 }])), false);
    assert.equal(wasRedirected(fake([])), false);
    assert.equal(wasRedirected({ defaultView: { performance: { getEntriesByType: () => { throw new Error('x'); } } } }), false);
    assert.equal(wasRedirected(pageDoc()), false, 'jsdom');
  });
  await ta('처음에는 사이트 연도 그대로 — 연도를 고르면 기억하고 표시가 붙는다', async () => {
    const doc = pageDoc();
    const storage = fakeStorage();
    const h = await start(doc, storage);
    assert.equal(h.redirected, false);
    assert.equal(h.on, true, '설정이 없으면 켠 것');
    assert.equal(noteOf(doc), null, '고르기 전에는 표시가 없다');
    click(itemOf(doc, '2027'));
    await Promise.resolve();
    assert.equal(storage.data[YEAR_KEY], '2027');
    assert.equal(h.year, '2027');
    assert.match(noteOf(doc).textContent, /^2027 유지/);
  });
  await ta('다른 연도를 고르면 바꿔 기억한다', async () => {
    const doc = pageDoc({ url: `${RM}RiskAssessment_ListAll.aspx?Year=MjAyNw__` });
    const storage = fakeStorage({ [YEAR_KEY]: '2027' });
    await start(doc, storage);
    assert.match(noteOf(doc).textContent, /^2027 유지/);
    click(itemOf(doc, '2026'));
    await Promise.resolve();
    assert.equal(storage.data[YEAR_KEY], '2026');
    assert.match(noteOf(doc).textContent, /^2026 유지/);
  });
  await ta('포스트백 결과(같은 화면에서 옴)는 기억한 연도가 있어도 다시 열지 않는다', async () => {
    const doc = pageDoc({ url: `${CTX}QHSE_KR_Parties_List.aspx`, referrer: `${CTX}QHSE_KR_Parties_List.aspx?Year=2027`, body: yearRow({ panel: false, year: '2027' }) });
    const h = await start(doc, fakeStorage({ [YEAR_KEY]: '2027' }));
    assert.equal(h.redirected, false);
    assert.ok(noteOf(doc));
  });
  await ta('× 로 잊으면 지우고 표시를 뗀다 — 지금 화면은 그대로', async () => {
    const doc = pageDoc({ url: `${RM}RiskAssessment_ListAll.aspx?Year=MjAyNw__`, body: yearRow({ year: '2027' }) });
    const storage = fakeStorage({ [YEAR_KEY]: '2027' });
    const h = await start(doc, storage);
    click(noteOf(doc).querySelector('button'));
    await Promise.resolve();
    assert.ok(!(YEAR_KEY in storage.data));
    assert.equal(h.year, null);
    assert.equal(noteOf(doc), null);
    assert.equal(doc.getElementById('ctl00_MainPlaceHolder_rddlYear_Input').value, '2027');
  });
  await ta('다른 프레임·탭에서 고르거나 잊은 연도를 따라간다', async () => {
    const doc = pageDoc({ url: `${RM}RiskAssessment_ListAll.aspx?Year=MjAyNw__` });
    const storage = fakeStorage({ [YEAR_KEY]: '2027' });
    const h = await start(doc, storage);
    await storage.set({ [YEAR_KEY]: '2025' });
    assert.equal(h.year, '2025');
    assert.match(noteOf(doc).textContent, /^2025 유지/);
    await storage.remove(YEAR_KEY);
    assert.equal(h.year, null);
    assert.equal(noteOf(doc), null);
  });
  await ta('기억한 값이 연도가 아니면 없는 것으로 본다', async () => {
    const doc = pageDoc();
    const h = await start(doc, fakeStorage({ [YEAR_KEY]: 'MjAyNw__' }));
    assert.equal(h.redirected, false);
    assert.equal(noteOf(doc), null);
  });
  await ta('목록이 아닌 화면은 storage 도 안 읽는다', async () => {
    const storage = fakeStorage({ [YEAR_KEY]: '2027' });
    const h = await start(pageDoc({ url: `${RM}KR_RiskRegister_List_Main.aspx` }), storage);
    assert.equal(h.redirected, false);
    assert.equal(storage.reads, 0);
    assert.equal(storage.listenerCount(), 0);
  });
  await ta('끊긴 콘텐츠 스크립트(storage 가 던짐)에서도 고르기가 화면을 깨지 않는다', async () => {
    const doc = pageDoc();
    const storage = {
      get: async () => ({}),
      set: () => { throw new Error('Extension context invalidated.'); },
      remove: () => { throw new Error('x'); },
      onChanged: () => () => {},
    };
    const h = await start(doc, storage);
    click(itemOf(doc, '2027'));
    assert.equal(h.year, '2027');
    click(noteOf(doc).querySelector('button'));
    assert.equal(h.year, null);
  });
  await ta('document_start 에 불리면 DOM 이 다 온 뒤에 표시를 붙인다', async () => {
    const dom = new JSDOM('', { url: `${RM}RiskAssessment_ListAll.aspx?Year=MjAyNw__`, referrer: SHELL });
    const doc = dom.window.document;
    Object.defineProperty(doc, 'readyState', { value: 'loading', configurable: true });
    const storage = fakeStorage({ [YEAR_KEY]: '2027' });
    await start(doc, storage);
    await storage.set({ [ENABLE_KEY]: true });
    assert.equal(noteOf(doc), null, 'DOM 이 오기 전에는 붙이지 않는다');
    doc.body.innerHTML = yearRow();
    doc.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    assert.ok(noteOf(doc));
  });
}

console.log('설정 — 끄고 켜기 (storage 의 qualityYearKeep)');
{
  t('값이 없으면 켠 것, false 일 때만 끈 것', () => {
    assert.equal(ENABLE_KEY, 'qualityYearKeep');
    assert.equal(riskYearEnabled(undefined), true);
    assert.equal(riskYearEnabled(true), true);
    assert.equal(riskYearEnabled(false), false);
  });
  await ta('꺼 두면 기억한 연도가 있어도 다시 열지 않고 표시도 붙이지 않는다', async () => {
    const doc = pageDoc();
    const h = await start(doc, fakeStorage({ [ENABLE_KEY]: false, [YEAR_KEY]: '2027' }));
    assert.equal(h.redirected, false);
    assert.equal(h.on, false);
    assert.equal(noteOf(doc), null);
  });
  await ta('꺼 두면 연도를 골라도 기억하지 않는다', async () => {
    const doc = pageDoc();
    const storage = fakeStorage({ [ENABLE_KEY]: false });
    await start(doc, storage);
    click(itemOf(doc, '2027'));
    await Promise.resolve();
    assert.ok(!(YEAR_KEY in storage.data));
    assert.equal(noteOf(doc), null);
  });
  await ta('열려 있는 목록에서 끄면 곧바로 표시가 사라지고, 기억한 연도는 남는다', async () => {
    const doc = pageDoc({ url: `${RM}RiskAssessment_ListAll.aspx?Year=MjAyNw__` });
    const storage = fakeStorage({ [YEAR_KEY]: '2027' });
    const h = await start(doc, storage);
    assert.ok(noteOf(doc));
    await storage.set({ [ENABLE_KEY]: false });
    assert.equal(h.on, false);
    assert.equal(noteOf(doc), null);
    assert.equal(storage.data[YEAR_KEY], '2027', '다시 켜면 이어지도록 지우지 않는다');
    click(itemOf(doc, '2025'));
    await Promise.resolve();
    assert.equal(storage.data[YEAR_KEY], '2027', '끈 동안 고른 것은 기억하지 않는다');
  });
  await ta('다시 켜면 새로고침 없이 표시가 돌아오고 고르는 것을 다시 듣는다', async () => {
    const doc = pageDoc({ url: `${RM}RiskAssessment_ListAll.aspx?Year=MjAyNw__` });
    const storage = fakeStorage({ [ENABLE_KEY]: false, [YEAR_KEY]: '2027' });
    const h = await start(doc, storage);
    await storage.set({ [ENABLE_KEY]: true });
    assert.equal(h.on, true);
    assert.match(noteOf(doc).textContent, /^2027 유지/);
    click(itemOf(doc, '2026'));
    await Promise.resolve();
    assert.equal(storage.data[YEAR_KEY], '2026');
  });
  await ta('그만두면 설정도 클릭도 더 듣지 않고 표시를 뗀다', async () => {
    const doc = pageDoc({ url: `${RM}RiskAssessment_ListAll.aspx?Year=MjAyNw__` });
    const storage = fakeStorage({ [YEAR_KEY]: '2027' });
    const h = await start(doc, storage);
    assert.equal(storage.listenerCount(), 1);
    h.stop();
    assert.equal(storage.listenerCount(), 0);
    assert.equal(noteOf(doc), null);
    click(itemOf(doc, '2025'));
    await Promise.resolve();
    assert.equal(storage.data[YEAR_KEY], '2027');
  });
  await ta('다른 영역(sync)의 변화는 듣지 않는다', async () => {
    const doc = pageDoc({ url: `${RM}RiskAssessment_ListAll.aspx?Year=MjAyNw__` });
    let listener = null;
    const storage = { ...fakeStorage({ [YEAR_KEY]: '2027' }), onChanged: (fn) => { listener = fn; return () => {}; } };
    const h = await start(doc, storage);
    listener({ [ENABLE_KEY]: { newValue: false } }, 'sync');
    assert.equal(h.on, true);
    assert.ok(noteOf(doc));
  });
}

console.log('패널의 체크박스');
{
  const root = new URL('../', import.meta.url);
  const html = fs.readFileSync(new URL('sidepanel.html', root), 'utf8');
  const panel = fs.readFileSync(new URL('sidepanel.js', root), 'utf8');
  t('설정 및 연결에 기본으로 켜진 체크박스가 있다', () =>
    assert.match(html, /<input type="checkbox" id="qualityYearKeep" checked \/>/));
  t('패널은 같은 열쇠(src/riskyear.js 의 ENABLE_KEY)로 저장한다', () => {
    assert.match(panel, /import \{ ENABLE_KEY as QYEAR_ENABLE_KEY, riskYearEnabled \} from '\.\/src\/riskyear\.js';/);
    assert.match(panel, /chrome\.storage\.local\.set\(\{ \[QYEAR_ENABLE_KEY\]: on \}\)/);
  });
}

console.log('확장 배선');
{
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
  const boot = fs.readFileSync(new URL('riskyear.js', root), 'utf8');
  t('eclass 의 모든 프레임에 document_start 로 붙는다 (목록이 iframe 안에, 그려지기 전에 다시 연다)', () => {
    const cs = (manifest.content_scripts || []).find((c) => c.js.includes('riskyear.js'));
    assert.ok(cs, 'content_scripts 에 riskyear.js 가 없다');
    assert.ok(cs.matches.includes('https://eclass.krs.co.kr/*'));
    assert.equal(cs.run_at, 'document_start');
    assert.equal(cs.all_frames, true);
  });
  t('시동 스크립트는 src/riskyear.js 를 동적으로 불러와 startRiskYear 를 부른다', () => {
    assert.match(boot, /getURL\('src\/riskyear\.js'\)/);
    assert.match(boot, /startRiskYear\(document\)/);
  });
  t('시동 스크립트는 Quality 의 Context·RiskManagement 폴더가 아니면 곧바로 끝낸다', () => {
    const re = new RegExp(boot.match(/if \(!\/(.+?)\/i\.test\(location\.pathname\)\) return;/)[1].replace(/\\\//g, '/'), 'i');
    assert.ok(re.test('/QHSEAudit/View/QHSE/RiskManagement/RiskAssessment_ListAll.aspx'));
    assert.ok(re.test('/qhseaudit/view/qhse/context/QHSE_KR_Parties_List.aspx'));
    assert.ok(!re.test('/eClassVer4/Common/Sub_Default'));
    assert.ok(!re.test('/BusinessTrip/AfterTrip'));
  });
  t('src/ 는 eclass 에 열려 있다 (동적 import)', () =>
    assert.ok((manifest.web_accessible_resources || []).some((w) => w.resources.includes('src/*.js') && w.matches.includes('https://eclass.krs.co.kr/*'))));
}

console.log(`\n통과 ${pass}건`);
