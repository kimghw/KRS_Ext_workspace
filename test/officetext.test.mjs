// 첨부 글자 뽑기(src/officetext.js) — 종류 가리기·ZIP 풀기(store·deflate·데이터 설명자·UTF-8 이름·막기)·docx·pptx·xlsx·hwpx·자르기·덩어리.
// 묶음은 여기서 만든다(아래 zipOf — 압축은 zlib.deflateRawSync). 바깥 파일에 기대지 않는다.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { crc32, buildZip } from '../src/zip.js';
import {
  TEXT_MAX, INFLATE_MAX, ENTRIES_MAX, ROWS_MAX, officeKind, unsupportedNote, unzipEntries, officeText, officeTextBlock,
} from '../src/officetext.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const enc = new TextEncoder();
const dec = new TextDecoder();
const bytesOf = (d) => (typeof d === 'string' ? enc.encode(d) : d);
const CUT = '…(너무 길어 여기서 잘랐습니다)';

/**
 * 검사용 ZIP — 항목마다 method(0 store · 8 deflate, 기본 8), descriptor(데이터 설명자 — 파일 머리의 CRC·크기는 0),
 * 그리고 깨뜨려 보는 것(crc·usize·csize·flags·zip64·raw 를 거짓으로). 파일 머리에는 중앙 목록에 없는 덧붙임(6바이트)을 단다.
 * count 는 끝 기록의 항목 수를 속인다.
 */
function zipOf(entries, { count } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = bytesOf(e.data ?? '');
    const method = e.method ?? 8;
    const body = e.raw ?? (method === 8 ? zlib.deflateRawSync(data) : data);
    const crc = e.crc ?? crc32(data);
    const csize = e.csize ?? body.length;
    const usize = e.usize ?? data.length;
    const flags = 0x0800 | (e.descriptor ? 0x0008 : 0) | (e.flags || 0);
    const extra = Buffer.from([0xfe, 0xca, 0x02, 0x00, 0x01, 0x02]);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(e.descriptor ? 0 : crc, 14);
    local.writeUInt32LE(e.descriptor ? 0 : csize, 18);
    local.writeUInt32LE(e.descriptor ? 0 : usize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    parts.push(local, name, extra, body);
    let size = 30 + name.length + extra.length + body.length;
    if (e.descriptor) {
      const dd = Buffer.alloc(16);
      dd.writeUInt32LE(0x08074b50, 0);
      dd.writeUInt32LE(crc, 4);
      dd.writeUInt32LE(csize, 8);
      dd.writeUInt32LE(usize, 12);
      parts.push(dd);
      size += 16;
    }
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(flags, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(0x21, 14);   // 1980-01-01
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(e.zip64 ? 0xffffffff : csize, 20);
    c.writeUInt32LE(e.zip64 ? 0xffffffff : usize, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += size;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count ?? entries.length, 8);
  end.writeUInt16LE(count ?? entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relsXml = (list) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
  list.map(([id, type, target, mode]) => `<Relationship Id="${id}" Type="${RNS}/${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ''}/>`).join('')
}</Relationships>`;
const TYPES = { name: '[Content_Types].xml', data: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`, method: 0 };

/* ------------------------------------------------------------ 만들기: docx */

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'
  + ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:v="urn:schemas-microsoft-com:vml"';
const wp = (s) => `<w:p><w:r><w:t xml:space="preserve">${s}</w:t></w:r></w:p>`;
const wtc = (...ps) => `<w:tc><w:tcPr/>${ps.length ? ps.map(wp).join('') : '<w:p/>'}</w:tc>`;

function docxOf(body, { main = 'word/document.xml', extra = [], docRels = null } = {}) {
  return zipOf([
    TYPES,
    { name: '_rels/.rels', data: relsXml([['rId1', 'officeDocument', main]]), method: 0 },
    { name: main, data: `${HEAD}<w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:body></w:document>`, descriptor: true },
    ...(docRels ? [{ name: main.replace(/([^/]+)$/, '_rels/$1.rels'), data: relsXml(docRels) }] : []),
    ...extra,
  ]);
}

const DOCX_BODY = [
  '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>연구 과제</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve"> 보고서 &amp; 계획 &lt;초안&gt; &quot;A&quot; &apos;B&apos; &#44032;&#xAC00; &amp;lt;</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>항목</w:t><w:tab/><w:t>값</w:t><w:br/><w:t>둘째 줄</w:t></w:r></w:p>',
  '<w:p/>',
  '<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>',
  '<w:p><w:r><w:t>삭제 전</w:t></w:r><w:del w:id="1" w:author="김"><w:r><w:delText>지운 글</w:delText></w:r></w:del>'
    + '<w:ins w:id="2" w:author="김"><w:r><w:t xml:space="preserve"> 넣은 글</w:t></w:r></w:ins></w:p>',
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="1"/></w:tblGrid>',
  `<w:tr>${wtc('이름')}${wtc('금액')}</w:tr>`,
  `<w:tr>${wtc('출장비', '(서울)')}${wtc('120,000')}</w:tr>`,
  `<w:tr>${wtc()}${wtc()}</w:tr>`,
  '</w:tbl>',
  '<w:p><w:r><w:t>글상자 앞</w:t></w:r><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent>'
    + wp('글상자 안') + '</w:txbxContent></wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox><w:txbxContent>'
    + wp('글상자 안') + '</w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r>'
    + '<w:r><w:t xml:space="preserve"> 글상자 뒤</w:t></w:r></w:p>',
  wp('　전각　빈칸   여러  개 '),
  '<!-- 주석 <w:p><w:r><w:t>안 읽음</w:t></w:r></w:p> -->',
  '<w:p w:rsidR="00A>B1"><w:r><w:t>속성 안의 꺾쇠</w:t></w:r></w:p>',
].join('\n');

const DOCX_HF = [
  { name: 'word/header1.xml', data: `${HEAD}<w:hdr ${W}>${wp('한국선급 대외비')}</w:hdr>` },
  {
    name: 'word/footer1.xml',
    data: `${HEAD}<w:ftr ${W}><w:p><w:r><w:t xml:space="preserve">- </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>`
      + '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r>'
      + `<w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> -</w:t></w:r></w:p>${wp('한국선급 대외비')}${wp('작성: 연구팀')}</w:ftr>`,
  },
];
const DOCX_RELS = [['rId9', 'footer', 'footer1.xml'], ['rId1', 'styles', 'styles.xml'], ['rId8', 'header', 'header1.xml'], ['rId5', 'hyperlink', 'https://krs.co.kr/', 'External']];

const DOCX_TEXT = [
  '연구 과제 보고서 & 계획 <초안> "A" \'B\' 가가 &lt;',
  '항목\t값',
  '둘째 줄',
  '',
  '삭제 전 넣은 글',
  '이름 | 금액',
  '출장비 (서울) | 120,000',
  '글상자 앞',
  '글상자 안',
  '글상자 뒤',
  '전각 빈칸 여러 개',
  '속성 안의 꺾쇠',
].join('\n');

/* ------------------------------------------------------------ 만들기: pptx */

const P = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${RNS}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const run = (s) => `<a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>${s}</a:t></a:r>`;
const shape = (paras, ph = '') => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:spPr/>`
  + `<p:txBody><a:bodyPr/><a:lstStyle/>${paras.map((p) => `<a:p>${p}<a:endParaRPr lang="ko-KR"/></a:p>`).join('')}</p:txBody></p:sp>`;
const slideXml = (inner, root = 'p:sld') => `${HEAD}<${root} ${P}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${inner}</p:spTree></p:cSld></${root}>`;
const SLIDENUM = '<a:fld id="{0A1B}" type="slidenum"><a:rPr lang="ko-KR"/><a:t>1</a:t></a:fld>';
const ptc = (s) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run(s)}</a:p></a:txBody><a:tcPr/></a:tc>`;

const SLIDES = {
  'ppt/slides/slide1.xml': slideXml(shape([run('첫 장 제목')], 'title')
    + shape([`${run('줄 하나')}<a:br><a:rPr lang="ko-KR"/></a:br>${run('줄 둘')}`, `<a:pPr><a:tabLst><a:tab pos="914400" algn="l"/></a:tabLst></a:pPr>${run('탭 정의는 무시')}`], 'body')
    + shape([SLIDENUM], 'sldNum')),
  'ppt/slides/slide2.xml': slideXml('<p:graphicFrame><p:nvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
    + `<a:tbl><a:tblGrid><a:gridCol w="1"/><a:gridCol w="1"/></a:tblGrid><a:tr h="1">${ptc('구분')}${ptc('내용 &amp; 비고')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`),
  'ppt/slides/slide10.xml': slideXml(shape([run('열째 파일')])),
};
const NOTES = {
  name: 'ppt/notesSlides/notesSlide7.xml',   // 번호가 슬라이드와 다르다 — 관계를 따라 찾는다
  data: slideXml(shape([], 'sldImg') + shape([run('발표 메모입니다')], 'body') + shape([SLIDENUM], 'sldNum'), 'p:notes'),
};
const SLIDE1_RELS = { name: 'ppt/slides/_rels/slide1.xml.rels', data: relsXml([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'notesSlide', '../notesSlides/notesSlide7.xml']]) };

function pptxOf({ order = null, slides = SLIDES } = {}) {
  const entries = [TYPES, ...Object.entries(slides).map(([name, data]) => ({ name, data })), SLIDE1_RELS, NOTES];
  if (order) {
    entries.push(
      { name: '_rels/.rels', data: relsXml([['rId1', 'officeDocument', 'ppt/presentation.xml']]) },
      { name: 'ppt/presentation.xml', data: `${HEAD}<p:presentation ${P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${order.map((n, i) => `<p:sldId id="${256 + i}" r:id="rId${100 + n}"/>`).join('')}</p:sldIdLst></p:presentation>` },
      { name: 'ppt/_rels/presentation.xml.rels', data: relsXml([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ...Object.keys(slides).map((k) => { const n = /slide(\d+)/.exec(k)[1]; return [`rId${100 + Number(n)}`, 'slide', `slides/slide${n}.xml`]; })]) },
    );
  }
  return zipOf(entries);
}

/* ------------------------------------------------------------ 만들기: xlsx */

const SS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const SERIAL = (Date.UTC(2026, 9, 15) - Date.UTC(1899, 11, 30)) / 86400000;   // 2026-10-15
const inl = (ref, s) => `<c r="${ref}" t="inlineStr"><is><t>${s}</t></is></c>`;
const sheetXml = (rows) => `${HEAD}<worksheet ${SS} xmlns:r="${RNS}"><dimension ref="A1:C9"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="3" width="9"/></cols><sheetData>${rows.join('')}</sheetData></worksheet>`;

const XLSX = [
  TYPES,
  { name: '_rels/.rels', data: relsXml([['rId1', 'officeDocument', 'xl/workbook.xml']]) },
  {
    name: 'xl/workbook.xml',
    data: `${HEAD}<workbook ${SS} xmlns:r="${RNS}"><workbookPr defaultThemeVersion="164011"/><sheets>`
      + '<sheet name="예산 &amp; 집행" sheetId="1" r:id="rId2"/><sheet name="일정" sheetId="2" r:id="rId1"/><sheet name="숨김" sheetId="3" state="hidden" r:id="rId3"/>'
      + '</sheets><calcPr calcId="191029"/></workbook>',
  },
  { name: 'xl/_rels/workbook.xml.rels', data: relsXml([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'worksheet', '/xl/worksheets/sheet2.xml'], ['rId3', 'worksheet', 'worksheets/sheet3.xml'], ['rId4', 'sharedStrings', 'sharedStrings.xml'], ['rId5', 'styles', 'styles.xml']]) },
  {
    name: 'xl/sharedStrings.xml',
    data: `${HEAD}<sst ${SS} count="6" uniqueCount="6"><si><t>항목</t></si><si><t>금액</t></si>`
      + '<si><r><t>출장</t></r><r><rPr><b/></rPr><t xml:space="preserve"> 여비</t></r></si>'
      + '<si><t>漢字</t><rPh sb="0" eb="2"><t>かんじ</t></rPh><phoneticPr fontId="1"/></si>'
      + '<si><t>A&amp;B</t></si><si><t>줄\n바꿈\t탭</t></si></sst>',
  },
  {
    name: 'xl/styles.xml',
    data: `${HEAD}<styleSheet ${SS}><numFmts count="3"><numFmt numFmtId="176" formatCode="yyyy&quot;년&quot; m&quot;월&quot; d&quot;일&quot;"/>`
      + '<numFmt numFmtId="177" formatCode="[&gt;=100]#,##0;[Red]0"/><numFmt numFmtId="178" formatCode=\'[>=1000]#,##0"원"\'/></numFmts>'
      + '<cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs>'
      + '<cellXfs count="7"><xf numFmtId="0" fontId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="176" applyNumberFormat="1"/>'
      + '<xf numFmtId="20" applyNumberFormat="1"/><xf numFmtId="177"/><xf numFmtId="178"><alignment horizontal="center"/></xf><xf numFmtId="22"/></cellXfs></styleSheet>',
  },
  {
    name: 'xl/worksheets/sheet2.xml',   // 예산 & 집행 — 관계 rId2 가 이 파일이다(이름 차례와 파일 번호가 다르다)
    data: sheetXml([
      '<row r="1" spans="1:2"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="4"><v>120000</v></c></row>',
      '<row r="3"/>',
      '<row r="4"><c r="A4" s="1"/><c r="B4" t="s"/></row>',
      `<row r="5">${inl('A5', '현장 &lt;메모&gt;')}<c r="C5" s="5"><v>0.30000000000000004</v></c></row>`,
      '<row r="6"><c r="A6" t="s"><v>3</v></c><c r="B6" t="b"><v>1</v></c><c r="C6" t="str"><f>A1&amp;B1</f><v>항목금액</v></c></row>',
      '<row r="7"><c r="A7" t="s"><v>4</v></c><c r="B7" t="s"><v>5</v></c><c r="C7" t="e"><v>#DIV/0!</v></c></row>',
    ]),
  },
  {
    name: 'xl/worksheets/sheet1.xml',   // 일정 — B 열부터 쓴 시트
    data: sheetXml([
      `<row r="2">${inl('B2', '날짜')}${inl('C2', '내용')}</row>`,
      `<row r="3"><c r="B3" s="1"><v>${SERIAL}</v></c>${inl('C3', '착수 보고')}</row>`,
      `<row r="4"><c r="B4" s="2"><v>${SERIAL + 30}</v></c><c r="C4" t="inlineStr"><is><r><t>중간</t></r><r><t xml:space="preserve"> 보고</t></r></is></c></row>`,
      `<row r="5"><c r="B5" s="3"><v>0.5625</v></c><c r="C5" s="6"><v>${SERIAL}.375</v></c></row>`,
      `<row r="6">${inl('C6', '비고만')}</row>`,
    ]),
  },
  { name: 'xl/worksheets/sheet3.xml', data: sheetXml([`<row r="1">${inl('A1', '숨은 값')}</row>`]) },
];

const XLSX_TEXT = [
  '[시트 예산 & 집행]',
  '항목\t금액',
  '출장 여비\t120000',
  '현장 <메모>\t\t0.3',
  '漢字\tTRUE\t항목금액',
  'A&B\t줄 바꿈 탭\t#DIV/0!',
  '',
  '[시트 일정]',
  '날짜\t내용',
  '2026-10-15\t착수 보고',
  '2026-11-14\t중간 보고',
  '13:30\t2026-10-15 09:00',
  '\t비고만',
].join('\n');

/* ------------------------------------------------------------ 만들기: hwpx */

const H = 'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"';
const hp = (s) => `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>${s}</hp:t></hp:run></hp:p>`;
const htc = (...ps) => `<hp:tc name="" header="0"><hp:subList id="" textDirection="HORIZONTAL">${ps.map(hp).join('')}</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/></hp:tc>`;
const sec = (inner) => `${HEAD}<hs:sec ${H}>${inner}</hs:sec>`;
const HWPX = [
  { name: 'mimetype', data: 'application/hwp+zip', method: 0 },
  { name: 'version.xml', data: `${HEAD}<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" major="5"/>` },
  { name: 'Contents/header.xml', data: `${HEAD}<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"><hh:refList/></hh:head>` },
  {
    name: 'Contents/section0.xml',
    data: sec([
      '<hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr id="" textDirection="HORIZONTAL"><hp:grid lineGrid="0"/></hp:secPr>'
        + '<hp:ctrl><hp:colPr id="" type="NEWSPAPER"/></hp:ctrl></hp:run><hp:run charPrIDRef="1"><hp:t>공문 제목: 연구 &amp; 개발</hp:t></hp:run>'
        + '<hp:linesegarray><hp:lineseg textpos="0"/></hp:linesegarray></hp:p>',
      '<hp:p><hp:run><hp:t>가<hp:tab width="4000" leader="0" type="1"/>나<hp:lineBreak/>다</hp:t></hp:run></hp:p>',
      `<hp:p><hp:run><hp:t>표 앞</hp:t><hp:tbl rowCnt="2" colCnt="2"><hp:tr>${htc('구분')}${htc('내용')}</hp:tr><hp:tr>${htc('예산')}${htc('3,000천원', '(부가세 포함)')}</hp:tr></hp:tbl></hp:run>`
        + '<hp:run><hp:t>표 뒤</hp:t></hp:run></hp:p>',
      '<hp:p><hp:run><hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar"><hp:t>새 글</hp:t></hp:case>'
        + '<hp:default><hp:t>새 글</hp:t></hp:default></hp:switch></hp:run></hp:p>',
    ].join('')),
  },
  { name: 'Contents/section10.xml', data: sec(hp('열한째 구역')) },
  { name: 'Contents/section2.xml', data: sec(hp('셋째 구역')) },
  { name: 'Contents/section1.xml', data: sec(hp('둘째 구역')), descriptor: true },
];
const HWPX_TEXT = ['공문 제목: 연구 & 개발', '가\t나', '다', '표 앞', '구분 | 내용', '예산 | 3,000천원 (부가세 포함)', '표 뒤', '새 글', '', '둘째 구역', '', '셋째 구역', '', '열한째 구역'].join('\n');

/* ------------------------------------------------------------ 검사 */

console.log('종류 가리기');
t('확장자로 가린다 — 대소문자 무시, 매크로·서식 파일도 같은 속', () => {
  assert.equal(officeKind('보고서.DOCX'), 'docx');
  assert.equal(officeKind('발표.Pptx'), 'pptx');
  assert.equal(officeKind('예산.xlsm'), 'xlsx');
  assert.equal(officeKind('양식.dotx'), 'docx');
  assert.equal(officeKind('공문.hwpx'), 'hwpx');
  assert.equal(officeKind('쇼.ppsx'), 'pptx');
});
t('확장자로 못 가리면 MIME 을 본다', () => {
  assert.equal(officeKind('첨부', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'docx');
  assert.equal(officeKind('', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; charset=binary'), 'xlsx');
  assert.equal(officeKind('2026.10.15 보고', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'), 'pptx', '점 뒤가 확장자 꼴이 아니다');
  assert.equal(officeKind('x', 'application/vnd.ms-excel.sheet.macroEnabled.12'), 'xlsx');
  assert.equal(officeKind('', 'application/hwp+zip'), 'hwpx');
});
t('옛 형식·이진 형식·모르는 것은 null — 옛 확장자는 MIME 이 무엇이든', () => {
  for (const n of ['a.doc', 'a.xls', 'a.ppt', 'a.hwp', 'a.xlsb', 'a.pdf', 'a.zip', 'a.txt', 'noext', '']) assert.equal(officeKind(n), null, n);
  assert.equal(officeKind('a.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), null);
  assert.equal(officeKind('x', 'application/vnd.ms-excel.sheet.binary.macroEnabled.12'), null, 'xlsb');
  assert.equal(officeKind('x', 'application/msword'), null);
});
t('못 뽑는 파일의 말 — 옛 형식은 무엇인지 말하고, 뽑을 수 있는 것과 PDF·그림은 빈 말', () => {
  assert.equal(unsupportedNote('공문.hwp'), 'hwp(한글 옛 형식) 파일은 글자를 뽑지 못해 첨부로만 넣습니다');
  assert.equal(unsupportedNote('a.DOC'), 'doc(워드 옛 형식) 파일은 글자를 뽑지 못해 첨부로만 넣습니다');
  assert.equal(unsupportedNote('a.xls'), 'xls(엑셀 옛 형식) 파일은 글자를 뽑지 못해 첨부로만 넣습니다');
  assert.equal(unsupportedNote('a.ppt'), 'ppt(파워포인트 옛 형식) 파일은 글자를 뽑지 못해 첨부로만 넣습니다');
  assert.equal(unsupportedNote('a.zip'), 'zip 파일은 글자를 뽑지 못해 첨부로만 넣습니다');
  assert.equal(unsupportedNote('무제'), '이 파일은 글자를 뽑지 못해 첨부로만 넣습니다');
  for (const n of ['a.docx', 'a.hwpx', 'a.pdf', 'a.JPG', 'a.png']) assert.equal(unsupportedNote(n), '', n);
  assert.equal(unsupportedNote('스캔', 'image/jpeg'), '');
});

console.log('ZIP 풀기');
await ta('store·deflate·데이터 설명자를 섞어도 중앙 목록의 크기로 읽는다 — 이름은 UTF-8, 폴더 항목은 뺀다', async () => {
  const long = '가나다라마바사 '.repeat(500);
  const zip = zipOf([
    { name: 'a.txt', data: '그대로 담은 글', method: 0 },
    { name: '자료/', data: '', method: 0 },
    { name: '자료/한글 이름.xml', data: '<x>값</x>', descriptor: true },
    { name: 'b.txt', data: long, method: 8 },
    { name: 'c.txt', data: '', method: 8 },
  ]);
  const got = await unzipEntries(zip);
  assert.deepEqual([...got.keys()], ['a.txt', '자료/한글 이름.xml', 'b.txt', 'c.txt']);
  assert.equal(dec.decode(got.get('a.txt')), '그대로 담은 글');
  assert.equal(dec.decode(got.get('자료/한글 이름.xml')), '<x>값</x>');
  assert.equal(dec.decode(got.get('b.txt')), long);
  assert.equal(got.get('c.txt').length, 0);
});
await ta('want 는 함수·정규식(g 붙어도)·이름 목록(대소문자 무시)·이름 하나', async () => {
  const zip = zipOf([{ name: 'word/document.xml', data: 'D' }, { name: 'word/header1.xml', data: 'H' }, { name: 'docProps/app.xml', data: 'A' }]);
  assert.deepEqual([...(await unzipEntries(zip, { want: (n) => n.startsWith('word/') })).keys()], ['word/document.xml', 'word/header1.xml']);
  assert.deepEqual([...(await unzipEntries(zip, { want: /^word\/h/g })).keys()], ['word/header1.xml']);
  assert.deepEqual([...(await unzipEntries(zip, { want: ['WORD/DOCUMENT.XML', 'docprops/app.xml'] })).keys()], ['word/document.xml', 'docProps/app.xml']);
  assert.deepEqual([...(await unzipEntries(zip.buffer, { want: 'docProps/app.xml' })).keys()], ['docProps/app.xml'], 'ArrayBuffer 도 받는다');
});
await ta('src/zip.js 의 buildZip 이 만든 묶음도 읽는다', async () => {
  const got = await unzipEntries(buildZip([{ name: 'x/안녕.txt', data: '안녕하세요' }]));
  assert.equal(dec.decode(got.get('x/안녕.txt')), '안녕하세요');
});
await ta('ZIP 이 아니거나 끝이 잘린 것은 까닭을 말한다', async () => {
  await assert.rejects(unzipEntries(enc.encode('PK 가 아닌 그냥 글')), /ZIP 형식이 아닙니다 — 깨졌거나 보안\(DRM\)·암호가 걸린 파일일 수 있습니다/);
  await assert.rejects(unzipEntries(new Uint8Array(0)), /ZIP 형식이 아닙니다/);
  const zip = zipOf([{ name: 'a.txt', data: '가'.repeat(100) }]);
  await assert.rejects(unzipEntries(zip.subarray(0, zip.length - 10)), /ZIP 형식이 아닙니다/);
});
await ta('암호·ZIP64·모르는 압축 방식·CRC·깨진 deflate 는 항목 이름과 함께 던진다', async () => {
  await assert.rejects(unzipEntries(zipOf([{ name: '비밀.xml', data: 'x', flags: 1 }])), /비밀\.xml: 암호가 걸린 항목이라 풀지 못합니다/);
  await assert.rejects(unzipEntries(zipOf([{ name: 'a.xml', data: 'x', method: 99, raw: new Uint8Array(4) }])), /a\.xml: 암호가 걸린 항목/);
  await assert.rejects(unzipEntries(zipOf([{ name: 'big.xml', data: 'x', zip64: true }])), /big\.xml: ZIP64 항목/);
  await assert.rejects(unzipEntries(zipOf([{ name: 'a.xml', data: 'x' }], { count: 0xffff })), /ZIP64 형식/);
  await assert.rejects(unzipEntries(zipOf([{ name: 'b.xml', data: 'x', method: 12, raw: new Uint8Array(4) }])), /b\.xml: 이 압축 방식\(12\)은 풀지 못합니다/);
  await assert.rejects(unzipEntries(zipOf([{ name: 'c.xml', data: '글자', crc: 1234 }])), /c\.xml: CRC 가 맞지 않습니다/);
  await assert.rejects(unzipEntries(zipOf([{ name: 'd.xml', data: '0123456789', raw: new Uint8Array([0xff, 0xff, 0xff]) }])), /d\.xml: 압축을 풀지 못했습니다/);
  const short = zlib.deflateRawSync(Buffer.from('가나다라'.repeat(300))).subarray(0, 40);
  await assert.rejects(unzipEntries(zipOf([{ name: 'e.xml', data: '가나다라'.repeat(300), raw: short }])), /e\.xml: (압축을 풀지 못했습니다|풀린 크기가 목록과 다릅니다)/);
});
await ta(`항목이 너무 많으면 풀지 않는다(기본 ${ENTRIES_MAX}개)`, async () => {
  const three = zipOf([{ name: '1', data: 'a' }, { name: '2', data: 'b' }, { name: '3', data: 'c' }]);
  await assert.rejects(unzipEntries(three, { maxEntries: 2 }), /항목이 너무 많습니다\(2개 넘음\)/);
  await assert.rejects(unzipEntries(zipOf([{ name: '1', data: 'a' }], { count: ENTRIES_MAX + 1 })), new RegExp(`${ENTRIES_MAX}개 넘음`));
});
await ta(`압축 폭탄 막기 — 푼 크기의 합이 한도(기본 ${INFLATE_MAX / 1048576}MB)를 넘거나, 목록의 크기보다 많이 풀리면 멈춘다`, async () => {
  await assert.rejects(unzipEntries(zipOf([{ name: 'a', data: 'x'.repeat(5000) }]), { maxBytes: 1000 }), /압축을 푼 크기가 너무 큽니다\(1KB 넘음\) — 압축 폭탄일 수 있어/);
  const two = zipOf([{ name: 'a', data: 'x'.repeat(600) }, { name: 'b', data: 'y'.repeat(600) }]);
  assert.equal((await unzipEntries(two, { maxBytes: 1000, want: ['b'] })).get('b').length, 600, '하나는 한도 안');
  await assert.rejects(unzipEntries(two, { maxBytes: 1000 }), /너무 큽니다/, '둘의 합이 넘는다');
  await assert.rejects(unzipEntries(zipOf([{ name: 'bomb', data: 'x', usize: INFLATE_MAX + 1 }])), /너무 큽니다\(40MB 넘음\)/, '적힌 크기만 보고 풀지 않는다');
  await assert.rejects(unzipEntries(zipOf([{ name: 'liar', data: 'z'.repeat(100_000), usize: 10 }])), /liar: 풀린 크기가 목록에 적힌 것보다 큽니다/);
});

console.log('docx');
await ta('문단은 한 줄, 탭·줄바꿈, 개체 풀기, 표는 " | ", 지운 글·탭 위치·갈음 글상자·주석은 뺀다, 머리말·꼬리말은 끝에', async () => {
  const got = await officeText(docxOf(DOCX_BODY, { docRels: DOCX_RELS, extra: DOCX_HF }), '연구 보고서.docx');
  assert.deepEqual({ kind: got.kind, parts: got.parts, cut: got.cut }, { kind: 'docx', parts: 1, cut: false });
  assert.equal(got.text, `${DOCX_TEXT}\n\n(머리말·꼬리말)\n한국선급 대외비\n작성: 연구팀`);
});
await ta('headers: false 면 본문만, 본 문서가 word/document.xml 이 아니어도 _rels/.rels 를 따른다', async () => {
  const got = await officeText(docxOf(DOCX_BODY, { docRels: DOCX_RELS, extra: DOCX_HF }), 'a.docx', { headers: false });
  assert.equal(got.text, DOCX_TEXT);
  const moved = await officeText(docxOf(wp('다른 자리의 본문'), { main: 'word/main.xml' }), 'b.docx');
  assert.equal(moved.text, '다른 자리의 본문');
});
await ta('글자가 없는 문서는 빈 글이고, 덩어리도 빈 말이다', async () => {
  const got = await officeText(docxOf('<w:p/><w:p><w:r><w:drawing/></w:r></w:p>'), '그림만.docx');
  assert.deepEqual(got, { kind: 'docx', text: '', parts: 1, cut: false });
  assert.equal(officeTextBlock('그림만.docx', got), '');
});

console.log('pptx');
await ta('presentation.xml 이 없으면 slideN 의 번호 차례(slide10 은 slide2 뒤) — 표·줄바꿈, 메모는 관계를 따라, 슬라이드 번호 칸은 뺀다', async () => {
  const got = await officeText(pptxOf(), '발표.pptx');
  assert.deepEqual({ kind: got.kind, parts: got.parts, cut: got.cut }, { kind: 'pptx', parts: 3, cut: false });
  assert.equal(got.text, [
    '[슬라이드 1]', '첫 장 제목', '줄 하나', '줄 둘', '탭 정의는 무시', '(메모)', '발표 메모입니다', '',
    '[슬라이드 2]', '구분 | 내용 & 비고', '',
    '[슬라이드 3]', '열째 파일',
  ].join('\n'));
});
await ta('presentation.xml 의 목록이 있으면 그 차례다, notes: false 면 메모를 뺀다', async () => {
  const got = await officeText(pptxOf({ order: [10, 1, 2] }), '발표.pptx', { notes: false });
  assert.equal(got.text, ['[슬라이드 1]', '열째 파일', '', '[슬라이드 2]', '첫 장 제목', '줄 하나', '줄 둘', '탭 정의는 무시', '', '[슬라이드 3]', '구분 | 내용 & 비고'].join('\n'));
});

console.log('xlsx');
await ta('시트 차례·이름은 workbook, 파일은 관계로 — 공유 글·바로 쓴 글·참거짓·수식 글·오류, 빈 행은 건너뛰고 열 자리는 지킨다, 숨긴 시트는 뺀다', async () => {
  const got = await officeText(zipOf(XLSX), '예산.xlsx');
  assert.deepEqual({ kind: got.kind, parts: got.parts, cut: got.cut }, { kind: 'xlsx', parts: 2, cut: false });
  assert.equal(got.text, XLSX_TEXT);
  assert.doesNotMatch(got.text, /숨은 값|かんじ/);
});
await ta(`행 한도(기본 ${ROWS_MAX})를 넘으면 앞의 행만 넣고 cut — 관계 파일이 없으면 기본 자리에서 찾는다`, async () => {
  const rows = Array.from({ length: 10 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i + 1}</v></c><c r="B${i + 1}" t="s"><v>0</v></c></row>`);
  const zip = zipOf([
    { name: 'xl/workbook.xml', data: `${HEAD}<workbook ${SS}><sheets><sheet name="목록" sheetId="1"/></sheets></workbook>` },
    { name: 'xl/sharedStrings.xml', data: `${HEAD}<sst ${SS}><si><t>값</t></si></sst>` },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(rows) },
  ]);
  const got = await officeText(zip, '목록.xlsx', { rows: 3 });
  assert.equal(got.text, '[시트 목록]\n1\t값\n2\t값\n3\t값\n…(행이 많아 앞의 3행만 넣었습니다)');
  assert.equal(got.cut, true);
  assert.equal((await officeText(zip, '목록.xlsx')).cut, false, '10행은 기본 한도 안');
});

console.log('hwpx');
await ta('구역은 번호 차례(section10 은 section2 뒤), 문단마다 한 줄 — 글 안의 탭·줄바꿈, 문단 속 표, hp:switch 의 갈음은 한 번만', async () => {
  const got = await officeText(zipOf(HWPX), '공문.hwpx');
  assert.deepEqual({ kind: got.kind, parts: got.parts, cut: got.cut }, { kind: 'hwpx', parts: 4, cut: false });
  assert.equal(got.text, HWPX_TEXT);
});

console.log('자르기·못 읽는 것');
await ta('max 를 넘으면 잘라 표시를 달고 cut — 기본 한도는 TEXT_MAX', async () => {
  const body = Array.from({ length: 300 }, (_, i) => wp(`가나다라마바사아자차 ${i + 1}`)).join('');
  const got = await officeText(docxOf(body), '긴 문서.docx', { max: 200 });
  assert.equal(got.cut, true);
  assert.ok(got.text.startsWith('가나다라마바사아자차 1\n가나다라마바사아자차 2\n'));
  assert.ok(got.text.endsWith(`\n${CUT}`));
  assert.ok(got.text.length <= 200 + CUT.length + 1);
  const big = await officeText(docxOf(Array.from({ length: 3000 }, (_, i) => wp(`문단 ${i + 1} 의 글자입니다`)).join('')), '더 긴 문서.docx');
  assert.equal(big.cut, true);
  assert.ok(big.text.length <= TEXT_MAX + CUT.length + 1 && big.text.length > TEXT_MAX - 100);
  assert.equal((await officeText(docxOf(wp('짧은 글')), '짧은.docx')).cut, false);
});
await ta('슬라이드가 많아 한도를 넘으면 뒤 슬라이드는 풀지 않는다 — parts 는 모든 슬라이드 수', async () => {
  const slides = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`ppt/slides/slide${i + 1}.xml`, slideXml(shape([run(`${i + 1}번 슬라이드의 내용 `.repeat(5))]))]));
  const got = await officeText(pptxOf({ slides }), '긴 발표.pptx', { max: 500 });
  assert.deepEqual([got.parts, got.cut], [30, true]);
  assert.match(got.text, /^\[슬라이드 1\]\n1번 슬라이드/);
  assert.doesNotMatch(got.text, /\[슬라이드 30\]/);
  assert.ok(got.text.endsWith(CUT));
});
await ta('못 읽는 파일은 "이름: 까닭" 으로 던진다', async () => {
  await assert.rejects(officeText(enc.encode('그냥 글'), '보고서.docx'), /보고서\.docx: ZIP 형식이 아닙니다/);
  const cfb = new Uint8Array(512);
  cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  await assert.rejects(officeText(cfb, '암호.xlsx'), /암호\.xlsx: 암호가 걸렸거나 옛 형식\(doc·xls·ppt\)을 이름만 바꾼 파일/);
  await assert.rejects(officeText(cfb, '옛 공문.hwpx'), /옛 형식\(hwp\)이거나 암호가 걸린 한글 파일/);
  await assert.rejects(officeText(zipOf([{ name: 'readme.txt', data: 'x' }]), 'c.docx'), /c\.docx: word\/document\.xml 이 없어 Word 문서로 읽지 못했습니다/);
  await assert.rejects(officeText(zipOf([{ name: 'readme.txt', data: 'x' }]), 'c.pptx'), /슬라이드가 없어/);
  await assert.rejects(officeText(zipOf([{ name: 'readme.txt', data: 'x' }]), 'c.xlsx'), /xl\/workbook\.xml 이 없어/);
  await assert.rejects(officeText(zipOf([{ name: 'readme.txt', data: 'x' }]), 'c.hwpx'), /Contents\/section0\.xml 이 없어/);
  await assert.rejects(officeText(new Uint8Array(4), '스캔.pdf'), /스캔\.pdf: 글자를 뽑을 수 있는 형식\(docx·pptx·xlsx·hwpx\)이 아닙니다/);
  await assert.rejects(officeText(new Uint8Array(4), '옛 공문.hwp'), /옛 공문\.hwp: hwp\(한글 옛 형식\) 파일은 글자를 뽑지 못해 첨부로만 넣습니다/);
});
await ta('압축 폭탄 docx(풀면 41MB) 는 풀지 않고 던진다', async () => {
  const bomb = zipOf([
    { name: '_rels/.rels', data: relsXml([['rId1', 'officeDocument', 'word/document.xml']]) },
    { name: 'word/document.xml', data: Buffer.alloc(41 * 1024 * 1024, 0x20) },
  ]);
  assert.ok(bomb.length < 200_000, `묶음은 작다(${bomb.length})`);
  await assert.rejects(officeText(bomb, '폭탄.docx'), /폭탄\.docx: 압축을 푼 크기가 너무 큽니다\(40MB 넘음\)/);
});

console.log('덩어리');
t('머리말 [첨부 파일 글자 — 이름] 다음 줄부터 글, 글이 없으면 빈 말', () => {
  assert.equal(officeTextBlock('연구 보고서.docx', { kind: 'docx', text: '본문\n둘째 줄', parts: 1, cut: false }), '[첨부 파일 글자 — 연구 보고서.docx]\n본문\n둘째 줄');
  assert.equal(officeTextBlock(' 예산.xlsx ', '  [시트 1]\n1  '), '[첨부 파일 글자 — 예산.xlsx]\n[시트 1]\n1');
  assert.equal(officeTextBlock('빈.docx', { text: '  \n ' }), '');
  assert.equal(officeTextBlock('', { text: '글' }), '[첨부 파일 글자 — 첨부 파일]\n글');
});

console.log(`\n${pass} passed`);
