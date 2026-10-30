// 국제표준 업로드 — 표준번호·표준명 읽기와 게시판 올리기(src/stdboard.js), 실행기 어댑터(actions/runners/board.js), 공문 탭의 칸(stdbox.js)
// (2026-10-30 사용자 지정: "양식 공문이력 다음에 국제표준 업로드 할 수 있도록 해주고 pdf 표준 주면 업로드 해주고 … zip 이면 풀어서 업로드 하고, pdf 여러개 주면 자동 업로드 해주고").
// 사이트는 흉내 낸다 — **실제 글은 올라가지 않는다.** 답의 꼴은 2026-10-30 Standard Documents 게시판(46V4)에 표준 13건을 올리며 본 것이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import {
  stdFromName, stdFromPdf, stdCategory, stdSubject, stdTokens, sameStandard, listRows, writeFields, postBody, stdUpload, stdPostUrl, STD_CATEGORY,
} from '../src/stdboard.js';
import { AuthError } from '../src/net.js';
import { createDispatcher } from '../actions/dispatch.js';
import { registerBoard } from '../actions/runners/board.js';
import { buildZip } from '../src/zip.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
const { createStdBox, WRITER_KEY } = await import('../stdbox.js');

/* ------------------------------------------------------------ 표준번호·표준명 */

test('파일 이름에서 표준번호 — KSSN 꼴과 게시판에 있던 꼴', () => {
  assert.equal(stdFromName('IEC60071-11_2022_EN_FR.pdf'), 'IEC 60071-11:2022');
  assert.equal(stdFromName('IECTR63179_2026_EN.pdf'), 'IEC TR 63179:2026');
  assert.equal(stdFromName('IECTS62271-313_2025_EN.pdf'), 'IEC TS 62271-313:2025');
  assert.equal(stdFromName('IEEE2800.2-2026_EN.pdf'), 'IEEE 2800.2-2026');
  assert.equal(stdFromName('IEEE2004-2025_EN.pdf'), 'IEEE 2004-2025');
  assert.equal(stdFromName('iso-20421-2-2017.pdf'), 'ISO 20421-2:2017');
  assert.equal(stdFromName('ISO_TS18683_2021_EN.pdf'), 'ISO TS 18683:2021');
  assert.equal(stdFromName('IEC_IEEE80005-2_2016_EN_FR.pdf'), 'IEC/IEEE 80005-2:2016');
  assert.equal(stdFromName('IEC60079-10-1_2020CMV_COR1_2021_EN.pdf'), 'IEC 60079-10-1:2020 CMV COR1 2021');
  assert.equal(stdFromName('견적서.pdf'), '');
  assert.equal(stdFromName('download (3).pdf'), '');
});

test('분류 — IEC(IEC/IEEE 공동 포함) · ISO · EN · KS · 그 밖은 기타(ETC)', () => {
  assert.equal(stdCategory('IEC TR 63179:2026'), 'IEC');
  assert.equal(stdCategory('IEC/IEEE 80005-2:2016'), 'IEC');
  assert.equal(stdCategory('CEI/IEC 61660-1:1997'), 'IEC');
  assert.equal(stdCategory('ISO/IEC 27001:2022'), 'ISO');
  assert.equal(stdCategory('EN 50160:2022'), 'EN');
  assert.equal(stdCategory('KS C IEC 61000-4-2'), 'KS');
  assert.equal(stdCategory('IEEE 2800.2-2026'), 'ETC');
  assert.deepEqual(STD_CATEGORY, { ISO: 108, IEC: 109, EN: 110, KS: 111, ETC: 112 });
});

// 2026-10-30 실제 PDF 를 pdf.js 로 읽은 첫 쪽 글(앞부분)
const COVER_60071 = 'IEC 60071-11\nEdition 1.0 2022-11\nINTERNATIONAL\nSTANDARD\nNORME\nINTERNATIONALE\nInsulation co-ordination –\nPart 11: Definitions, principles and rules for HVDC system\nCoordination de l\'isolement –\nPartie 11: Définitions, principes et règles relatifs au réseau CCHT\nIEC 60071-11:2022-11(en-fr)';
const COVER_61660 = 'NORME\nINTERNATIONALE\nCEI\nIEC\nINTERNATIONAL\nSTANDARD\n61660-1\nPremière édition\nFirst edition\n1997-06\nCourants de court-circuit dans les installations\nauxiliaires alimentées en courant continu\ndans les centrales et les postes –\nPartie 1:\nCalcul des courants de court-circuit\nShort-circuit currents in d.c. auxiliary installations\nin power plants and substations –\nPart 1:\nCalculation of short-circuit currents\nNuméro de référence\nReference number\nCEI/IEC 61660-1: 1997';
const COVER_63282 = 'IEC TR 63282\nEdition 2.0 2024-08\nTECHNICAL\nREPORT\nLVDC systems – Assessment of standard voltages and power quality\nrequirements\nIEC TR 63282:2024-08(en)';
const COVER_ISO = 'INTERNATIONAL STANDARD\nISO 20421-2\nFirst edition\n2017-05\nCryogenic vessels — Large transportable vacuum-insulated vessels —\nPart 2:\nOperational requirements\nRécipients cryogéniques — Grands récipients transportables isolés sous vide —\nReference number\nISO 20421-2:2017(E)';

test('표지에서 영문 표준명 — 요즘 IEC(영어 먼저) · 옛 IEC(프랑스어 먼저) · ISO', () => {
  assert.deepEqual(stdFromPdf({ name: 'IEC60071-11_2022_EN_FR.pdf', text: COVER_60071 }),
    { designation: 'IEC 60071-11:2022', title: 'Insulation co-ordination - Part 11: Definitions, principles and rules for HVDC system', category: 'IEC' });
  assert.equal(stdFromPdf({ name: 'IEC61660-1_1997_EN_FR.pdf', text: COVER_61660 }).title,
    'Short-circuit currents in d.c. auxiliary installations in power plants and substations - Part 1: Calculation of short-circuit currents');
  assert.equal(stdFromPdf({ name: 'IECTR63282_2024_EN.pdf', text: COVER_63282 }).title, 'LVDC systems - Assessment of standard voltages and power quality requirements');
  assert.deepEqual(stdFromPdf({ name: 'iso-20421-2-2017.pdf', text: COVER_ISO }),
    { designation: 'ISO 20421-2:2017', title: 'Cryogenic vessels - Large transportable vacuum-insulated vessels - Part 2: Operational requirements', category: 'ISO' });
});

test('IEEE 는 메타데이터 제목에서 — 표준번호까지', () => {
  const meta = 'IEEE Std 2004™-2025, IEEE Recommended Practice for Hardware-in-the-Loop (HIL) Simulation-Based Testing of Electric Power Apparatus and Controls';
  assert.deepEqual(stdFromPdf({ name: 'IEEE2004-2025_EN.pdf', meta, text: 'IEEE Recommended Practice …' }),
    { designation: 'IEEE 2004-2025', title: 'IEEE Recommended Practice for Hardware-in-the-Loop (HIL) Simulation-Based Testing of Electric Power Apparatus and Controls', category: 'ETC' });
  // 파일 이름이 표준번호를 말하지 않아도 메타데이터에서
  assert.equal(stdFromPdf({ name: 'download.pdf', meta: 'IEEE Std 2800.2-2026 IEEE Recommended Practice for Test' }).designation, 'IEEE 2800.2-2026');
});

test('표준번호뿐이거나 표준명이 아닌 메타데이터는 버리고, 못 읽으면 빈 글', () => {
  assert.equal(stdFromPdf({ name: 'IECTS63336_2024_EN.pdf', meta: 'IEC TS 63336:2024', text: 'IEC TS 63336\nEdition 1.0 2024-07\nTECHNICAL\nSPECIFICATION\nCommissioning of VSC HVDC systems\nIEC TS 63336:2024-07(en)' }).title,
    'Commissioning of VSC HVDC systems');
  assert.equal(stdFromPdf({ name: 'x.pdf', meta: 'Microsoft Word - draft.docx' }).title, '');
  assert.deepEqual(stdFromPdf({ name: '견적서.pdf' }), { designation: '', title: '', category: 'ETC' });
  // 표지 글이 없으면(스캔본) 파일 이름의 표준번호만
  assert.deepEqual(stdFromPdf({ name: 'IECTR63179_2026_EN.pdf', text: '' }), { designation: 'IEC TR 63179:2026', title: '', category: 'IEC' });
  // 메타데이터 제목이 표준번호로 시작하면 그 번호는 뗀다
  assert.equal(stdFromPdf({ name: 'ISO_TS18683_2021_EN.pdf', meta: 'ISO/TS 18683:2021(E) - Guidelines for safety and risk assessment of LNG fuel bunkering operations' }).title,
    'Guidelines for safety and risk assessment of LNG fuel bunkering operations');
});

test('같은 표준 — 글자·숫자 묶음으로 견준다(띄어쓰기·구분자·분류 머리와 무관, 판이 다르면 다른 표준)', () => {
  assert.deepEqual(stdTokens('IEC TR 63179:2026'), ['IECTR', '63179', '2026']);
  assert.deepEqual(stdTokens('IECTR63179_2026'), ['IECTR', '63179', '2026']);
  assert.ok(sameStandard('IEC 61660-2:1997 - Short-circuit currents', 'IEC 61660-2:1997'));
  assert.ok(sameStandard('IEC 60079-10-1 2020 Explosive atmospheres', 'IEC 60079-10-1:2020'));
  assert.ok(sameStandard('IEC IEEE80005-2 2016 Utility connections in port', 'IEC/IEEE 80005-2:2016'));
  assert.ok(!sameStandard('IEC 61660-1:1997 - Short-circuit', 'IEC 61660-2:1997'));
  assert.ok(!sameStandard('IEC 61660-1:2020 - Short-circuit', 'IEC 61660-1:1997'));
  assert.ok(!sameStandard('ISO 20412:2017 - x', 'ISO 2041-2:2017'));
  assert.equal(stdSubject('IEC TR 63179:2026', 'Planning of HVDC systems'), 'IEC TR 63179:2026 - Planning of HVDC systems');
});

/* ------------------------------------------------------------ 게시판 화면 */

const ROW = (id, no, subject, cat = 'IEC', file = 'SUVDNjE2NjAtMl8xOTk3X0VOX0ZSLnBkZg__') => `<tr style="background-color: bgc-h-yellow-l4" class="d-style">
  <td class='text-center'>${no}</td>
  <td><a href='/eClassVer4/BoardNew/Content?bid=46V4&amp;id=${id}&amp;sWriter=False&amp;sTitle=True&amp;groupid=${no}' class='text-grey-d1'>
     <span class="badge badge-sm" style="background-color: #f1c232; color: white;">NEW</span>
     ${cat ? `[${cat}]` : ''}${subject.replace('61660', "<span class='highlight'>61660</span>")}
  </a></td>
  <td class='text-grey'>&#xC218;&#xC18C;&#xC804;&#xAE30;&#xCD94;&#xC9C4;&#xC5F0;&#xAD6C;&#xD300;</td>
  <td><a href='/eClassVer4/BoardNew/FileDown/46V4|${id}|7061|${file}|pdf|1343361|0'><img src='/eClassVer4/images/fileicon/etc.png'></a></td>
  <td>2026-10-30</td><td>0</td></tr>`;
const LIST = (rows) => `<table><tr><th>NO</th><th>SUBJECT</th></tr>${rows.join('')}</table>`;

test('목록 줄 — 글 번호(보기 링크의 id) · NEW 와 분류 머리를 뗀 제목 · 분류 · 첨부 이름과 크기', () => {
  const rows = listRows(LIST([ROW(7008, 7007, 'IEC 61660-2:1997 - Short-circuit currents in d.c. auxiliary installations - Part 2: Calculation of effects')]));
  assert.deepEqual(rows, [{
    id: '7008', subject: 'IEC 61660-2:1997 - Short-circuit currents in d.c. auxiliary installations - Part 2: Calculation of effects', category: 'IEC',
    file: { name: 'IEC61660-2_1997_EN_FR.pdf', size: 1343361 },
  }]);
});

const WRITE = `<html><script>var authResult = 1;</script><form id="myForm" method="post" action="/BoardNew/TempWrite">
  <input type="hidden" name="bid" value="46V4" /><input type="hidden" name="id" value="0" /><input type="hidden" name="groupid" value="0" />
  <input type="hidden" name="grouporder" value="0" /><input type="hidden" name="replylevel" value="0" /><input type="hidden" name="reply" value="0" />
  <input type="hidden" name="replyexist" value="0" /><input type="hidden" name="writershow" id="writershow" value="P" />
  <input type="hidden" name="userid" value="hong" /><input type="hidden" name="empid" value="11115" /><input type="hidden" name="deptcode" value="HER" />
  <input type="hidden" name="email" value="hong@krs.co.kr" /><input type="hidden" name="hasfiles" value="0" /><input type="hidden" name="passwd" value="0" />
  <input type="hidden" name="url" value="0" /><input type="hidden" name="type" value="W" /><input type="hidden" name="catecode" id="catecode" />
  <input type="hidden" name="temp" id="temp" value="0" /><input type="hidden" name="menuID" /><input type="hidden" id="fileStr" name="fileStr" value="" />
  <input type="hidden" id="hdn_upload_info" name="hdn_upload_info" /><input type="hidden" id="hdn_delete_info" name="hdn_delete_info" value="" />
  <input type="hidden" name="pinpost" id="pinpost" value="0" /><input type="checkbox" id="departmentCheckbox" />
  <input name="sdate" type="date" /><input name="edate" type="date" /><input type="date" name="pinpostDate" class="pinpostDate" />
  <input type="radio" id="A_Lan" name="lan" value="A"><input type="radio" id="K_Lan" name="lan" value="K">
  <input type="text" name="subject_e" value="" /><input type="hidden" id="msgbody_e" name="msgbody_e" value="" />
  <input type="text" name="subject" value="" /><input type="hidden" id="msgbody" name="msgbody" value="" />
  <input type="button" id="btn-add-files" value="Add File" /></form></html>`;

test('쓰기 화면의 칸 위에 이 글의 값을 얹어 화면이 보내는 차례대로 — 부서 표시 · 분류 · 첨부 정보 · 제목과 본문', () => {
  const fields = writeFields(WRITE);
  assert.equal(fields.userid, 'hong');
  assert.ok(!('lan' in fields), '고르는 칸은 빼고 보낼 때 넣는다');
  const info = 'IECTR63282_2024_EN.pdf|IECTR63282_2024_EN(1).pdf|7180554|pdf:';
  const body = postBody(fields, { subject: 'IEC TR 63282:2024 - LVDC systems & <x>', category: 'IEC', writer: 'dept', fileInfo: info });
  assert.deepEqual([...body.keys()], ['bid', 'id', 'groupid', 'grouporder', 'replylevel', 'reply', 'replyexist', 'writershow', 'userid', 'empid', 'deptcode', 'email',
    'hasfiles', 'passwd', 'url', 'type', 'catecode', 'temp', 'menuID', 'fileStr', 'hdn_upload_info', 'hdn_delete_info', 'pinpost', 'sdate', 'edate',
    'pinpostDate', 'lan', 'subject_e', 'msgbody_e', 'subject', 'msgbody']);
  const v = Object.fromEntries(body);
  assert.equal(v.writershow, 'D');
  assert.equal(v.catecode, '109');
  assert.equal(v.fileStr, info);
  assert.equal(v.hdn_upload_info, info);
  assert.equal(v.lan, 'K');
  assert.equal(v.msgbody, '<p>IEC TR 63282:2024 - LVDC systems &amp; &lt;x&gt;</p>');
  assert.equal(Object.fromEntries(postBody(fields, { subject: 's', category: 'ETC', writer: 'me', fileInfo: info })).writershow, 'P');
  assert.equal(Object.fromEntries(postBody(fields, { subject: 's', category: 'ETC', writer: 'me', fileInfo: info })).catecode, '112');
});

/* ------------------------------------------------------------ 올리기 */

const text = (body, type = 'text/html; charset=utf-8') => new Response(body, { status: 200, headers: { 'content-type': type } });
const CONFIG = 'win.dextuploadx5Configuration = {\n  //authkey: "TEST-KEY",\n   authkey: "LIVE-KEY",\n};';
const PDF = new Uint8Array([37, 80, 68, 70, 45, 49]);
const POST = { designation: 'IEC TR 63282:2024', title: 'LVDC systems - Assessment of standard voltages and power quality requirements', category: 'IEC', writer: 'dept', file: { name: 'IECTR63282_2024_EN.pdf', type: 'application/pdf' } };

/** 가짜 게시판. 찾기는 처음엔 before, 저장한 뒤엔 after 의 줄을 준다. */
function fakeBoard({ before = [], after = null, on = {} } = {}) {
  const calls = [];
  let saved = false;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace('https://eclass.krs.co.kr', '');
    const name = path.split('?')[0].split('/').pop();
    calls.push({ path, method: init.method || 'GET', body: init.body });
    if (on[name]) return on[name](init, calls);
    if (path.startsWith('/eClassVer4/BoardNew/List/46V4')) return text(LIST(saved && after ? after : before));
    if (path.startsWith('/eClassVer4/BoardNew/Write/')) return text(WRITE);
    if (name === 'dextuploadx5-configuration.js') return text(CONFIG, 'application/javascript');
    if (name === 'DraftFileUp') return text('SEND:IECTR63282_2024_EN.pdf|IECTR63282_2024_EN.pdf|6|pdf:');
    if (name === 'TempWrite') { saved = true; return text('<script>location.href="/eClassVer4/BoardNew/List/46V4"</script>'); }
    throw new Error('모르는 주소 ' + path);
  };
  return calls;
}

test('올리기 — 찾기 → 쓰기 화면 → 첨부 올리기 → 저장 → 다시 찾아 새 글 번호', async () => {
  const old = ROW(6990, 6989, 'IEC TR 63282:2020 - LVDC systems (old edition)', 'IEC');
  const neu = ROW(7017, 7016, `${POST.designation} - ${POST.title}`, 'IEC');
  const calls = fakeBoard({ before: [old], after: [neu, old] });
  const stages = [];
  const r = await stdUpload(POST, { bytes: PDF, onStage: (s) => stages.push(s) });
  assert.deepEqual(r, { ok: true, status: 'posted', id: '7017', url: stdPostUrl('7017'), subject: `${POST.designation} - ${POST.title}` });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path.split('?')[0].split('/').slice(-2).join('/')}`),
    ['GET List/46V4', 'GET mode%3Dnew/46V4', 'GET DEXT_X5_V4_3/dextuploadx5-configuration.js', 'POST BoardNew/DraftFileUp', 'POST BoardNew/TempWrite', 'GET List/46V4']);
  assert.match(calls[0].path, /sTitle=true&sText=63282&pagesize=50/);
  assert.match(calls[1].path, /sMainCate=107&sSubCate=109$/);
  assert.match(calls[3].path, /DraftFileUp\?pType=SEND&bid=46V4&use=dext$/);
  const up = calls[3].body;
  assert.equal(up.get('DEXTUploadX5_AuthKey'), 'LIVE-KEY');
  assert.equal(up.get('DEXTUploadX5_ControlId'), 'dext5');
  assert.equal(up.get('DEXTUploadX5_FileData').name, 'IECTR63282_2024_EN.pdf');
  const saved = Object.fromEntries(new URLSearchParams(calls[4].body));
  assert.equal(saved.subject, `${POST.designation} - ${POST.title}`);
  assert.equal(saved.fileStr, 'IECTR63282_2024_EN.pdf|IECTR63282_2024_EN.pdf|6|pdf:');
  assert.equal(saved.catecode, '109');
  assert.equal(stages.length, 5);
});

test('같은 표준이 이미 있으면 올리지 않고 그 글을 가리킨다', async () => {
  const calls = fakeBoard({ before: [ROW(7017, 7016, 'IEC TR 63282:2024 - LVDC systems', 'IEC')] });
  const r = await stdUpload(POST, { bytes: PDF });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'exists');
  assert.equal(r.id, '7017');
  assert.equal(calls.length, 1, '찾기 한 번뿐');
});

test('파일을 받지 않으면 글을 쓰지 않고, 저장했는데 못 찾으면 unverified, dry 는 파일까지만', async () => {
  let calls = fakeBoard({ on: { DraftFileUp: () => text('ERROR: size') } });
  await assert.rejects(stdUpload(POST, { bytes: PDF }), /파일을 받지 않았습니다/);
  assert.ok(!calls.some((c) => c.path.includes('TempWrite')));

  fakeBoard({ after: [] });
  const r = await stdUpload(POST, { bytes: PDF });
  assert.equal(r.status, 'unverified');
  assert.equal(r.ok, false);

  calls = fakeBoard();
  const dry = await stdUpload(POST, { bytes: PDF, dry: true });
  assert.equal(dry.status, 'dry');
  assert.ok(!calls.some((c) => c.path.includes('TempWrite')));
});

test('로그인이 풀렸거나 권한이 없으면 멈춘다', async () => {
  fakeBoard({ on: { '46V4': (init, calls) => (calls.at(-1).path.includes('/Write/') ? text('<script>var authResult = 0;</script>') : text(LIST([]))) } });
  await assert.rejects(stdUpload(POST, { bytes: PDF }), /권한이 없습니다/);
  fakeBoard({ on: { DraftFileUp: () => text('<input id="tbUserId">') } });
  await assert.rejects(stdUpload(POST, { bytes: PDF }), /로그인/);
  await assert.rejects(stdUpload({ ...POST, title: '' }, { bytes: PDF }), /표준명/);
  await assert.rejects(stdUpload(POST, { bytes: new Uint8Array() }), /내용이 없습니다/);
  assert.ok(AuthError);
});

/* ------------------------------------------------------------ 행위·실행기 */

test('board.standard — 기록을 지어 확인과 함께 돌리면 실행기가 바이트와 함께 stdUpload 를 부른다', async () => {
  const d = createDispatcher();
  const seen = [];
  registerBoard(d, { stdUpload: async (post, ctx) => { seen.push({ post, ctx }); return { ok: true, status: 'posted', id: '7017' }; } });
  const { record } = d.build('board.standard', { input: { ...POST, file: { name: POST.file.name, type: 'application/pdf' } }, preset: { me: null } });
  await assert.rejects(d.run(record, { bytes: PDF }), /확인 없이/);
  const r = await d.run(record, { confirmed: record.hash, bytes: PDF });
  assert.equal(r.id, '7017');
  assert.equal(seen[0].ctx.bytes, PDF);
  assert.deepEqual(seen[0].post, { ...POST, file: { name: POST.file.name, type: 'application/pdf' } });
  assert.throws(() => d.build('board.standard', { input: { ...POST, category: 'IEEE' }, preset: { me: null } }), /category|분류/);
});

/* ------------------------------------------------------------ 공문 탭의 칸 */

const COVERS = {
  'IECTR63282_2024_EN.pdf': { meta: '', text: COVER_63282 },
  'IEC61660-1_1997_EN_FR.pdf': { meta: '', text: COVER_61660 },
  'scan.pdf': { meta: '', text: '' },
};

function boxWith({ saved = {}, upload } = {}) {
  const doc = new JSDOM(html).window.document;
  const store = { ...saved };
  const tabs = [];
  const runs = [];
  const d = createDispatcher();
  registerBoard(d, { stdUpload: upload || (async (post, ctx) => { runs.push({ post, bytes: ctx.bytes }); return { ok: true, status: 'posted', id: String(7000 + runs.length), url: stdPostUrl(String(7000 + runs.length)), subject: post.title }; }) });
  const box = createStdBox({
    doc, actions: d, openTab: (url) => tabs.push(url), me: () => '홍길동',
    storage: { get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])), set: async (o) => Object.assign(store, o) },
    readCover: async (bytes) => COVERS[new TextDecoder().decode(bytes)] || { meta: '', text: '' },
  });
  return { doc, box, store, tabs, runs };
}
/** 바이트에 이름을 적어 둔 가짜 PDF — readCover 가 그 이름으로 표지를 고른다. */
const pdfFile = (name) => new File([name], name, { type: 'application/pdf' });

test('칸은 공문 이력 다음, 공문 설정 위에 선다', () => {
  const doc = new JSDOM(html).window.document;
  const ids = [...doc.querySelectorAll('#gongmun > details')].map((x) => x.id);
  assert.deepEqual(ids.slice(ids.indexOf('gmHistBox'), ids.indexOf('gmHistBox') + 3), ['gmHistBox', 'gmStdBox', 'gmPresetBox']);
});

test('PDF 여러 개와 ZIP(풀어서)을 넣으면 표지를 읽어 하나씩 저절로 올린다 — 작성자 표시는 고른 대로', async () => {
  const { doc, box, runs, store, tabs } = boxWith({ saved: { [WRITER_KEY]: 'me' } });
  await new Promise((r) => setTimeout(r, 0));
  const zip = new File([buildZip([{ name: 'KD/IEC61660-1_1997_EN_FR.pdf', data: 'IEC61660-1_1997_EN_FR.pdf' }, { name: 'KD/readme.txt', data: 'x' }])], 'KD26101567.zip', { type: 'application/zip' });
  await box.take([pdfFile('IECTR63282_2024_EN.pdf'), zip]);
  await box.idle();
  assert.deepEqual(runs.map((r) => [r.post.designation, r.post.category, r.post.writer, r.post.file.name]), [
    ['IEC TR 63282:2024', 'IEC', 'me', 'IECTR63282_2024_EN.pdf'],
    ['IEC 61660-1:1997', 'IEC', 'me', 'IEC61660-1_1997_EN_FR.pdf'],
  ]);
  assert.equal(new TextDecoder().decode(runs[1].bytes), 'IEC61660-1_1997_EN_FR.pdf');
  assert.ok(doc.getElementById('gmStdBox').open);
  assert.equal(doc.getElementById('gmStdState').textContent, '올림 2');
  const items = [...doc.querySelectorAll('#gmStdList .gm-std-item')];
  assert.equal(items.length, 2);
  assert.match(items[1].textContent, /IEC 61660-1:1997 - Short-circuit currents.*KD26101567\.zip/s);
  assert.ok(box.rows().every((r) => !r.hasBytes), '끝난 파일은 놓는다');
  items[0].querySelector('[data-open]').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  assert.equal(tabs[0], stdPostUrl('7001'));
  // 작성자 표시를 부서로 바꾸면 저장소에
  doc.querySelector('#gmStdWriter [data-writer="dept"]').click();
  assert.equal(store[WRITER_KEY], 'dept');
  // 같은 파일을 다시 넣으면 줄을 더하지 않는다
  await box.take([pdfFile('IECTR63282_2024_EN.pdf')]);
  await box.idle();
  assert.equal(runs.length, 2);
});

test('표준명을 못 읽은 파일은 적는 칸이 서고, 적고 올리기를 누르면 돈다. PDF·ZIP 이 아니면 건너뛴다', async () => {
  const { doc, box, runs } = boxWith();
  await box.take([pdfFile('scan.pdf'), new File(['x'], 'memo.docx')]);
  await box.idle();
  assert.equal(runs.length, 0);
  assert.equal(doc.getElementById('gmStdState').textContent, '확인 1');
  const li = doc.querySelector('#gmStdList .gm-std-item.st-back');
  li.querySelector('[data-fix="designation"]').value = 'IEEE 2892-2024';
  li.querySelector('[data-fix="title"]').value = 'IEEE Recommended Practice for Medium Voltage DC Transformers';
  li.querySelector('[data-go]').click();
  await box.idle();
  assert.deepEqual([runs[0].post.designation, runs[0].post.category], ['IEEE 2892-2024', 'ETC']);
  assert.match(doc.getElementById('gmStdList').textContent, /PDF·ZIP 만 올립니다/);
});

test('이미 있음·실패는 줄에 적고 실패는 다시 — 끌어 놓기는 공문 탭 전체(참고 문서)로 번지지 않는다', async () => {
  let n = 0;
  const { doc, box } = boxWith({ upload: async () => { n++; if (n === 1) return { ok: false, status: 'exists', id: '7017', url: stdPostUrl('7017'), subject: 'IEC TR 63282:2024 - LVDC systems', note: '이미 있음' }; throw new Error('사이트가 파일을 받지 않았습니다.'); } });
  let reached = 0;
  doc.getElementById('gongmun').addEventListener('drop', () => reached++);
  const ev = new doc.defaultView.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [pdfFile('IECTR63282_2024_EN.pdf'), pdfFile('IEC61660-1_1997_EN_FR.pdf')] } });
  doc.getElementById('gmStdList').dispatchEvent(ev);
  assert.equal(reached, 0);
  await new Promise((r) => setTimeout(r, 20));
  await box.idle();
  assert.deepEqual(box.rows().map((r) => r.state), ['exists', 'fail']);
  assert.match(doc.getElementById('gmStdList').textContent, /이미 있음.*#7017.*실패.*받지 않았습니다/s);
  const again = doc.querySelector('#gmStdList [data-go]');
  assert.equal(again.textContent, '다시');
  again.click();
  await box.idle();
  assert.equal(n, 3);
});
