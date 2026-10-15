// 병합 검사용 xlsx·docx 바이트 만들기 — 작지만 Office 가 여는 꼴([Content_Types].xml · _rels · 본문 · 관계)을 갖춘 묶음.
// 묶음은 store(src/zip.js buildZip) 또는 deflate(zlib.deflateRawSync 로 직접 쓴 ZIP — 실제 Office 파일이 이 꼴)로 만든다.
// checkPackage 는 결과 묶음을 검사한다: 첫 항목이 [Content_Types].xml, 모든 XML 이 잘 짜였는지(jsdom DOMParser — 검사에서만),
// 관계·Override 가 없는 파트를 가리키지 않는지. 어디에도 보내지 않는다.
import zlib from 'node:zlib';
import { JSDOM } from 'jsdom';

import { buildZip, crc32, readZip } from '../../../src/zip.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export const NS = {
  main: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  pr: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  x14ac: 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac',
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  v: 'urn:schemas-microsoft-com:vml',
};
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * 검사용 ZIP — 항목마다 method(0 store · 8 deflate, 기본 opts.method), crc·usize 를 거짓으로 줄 수 있다.
 * 파일 머리에는 중앙 목록에 없는 덧붙임(6바이트)을 단다(자리를 파일 머리로 세는지 보려고).
 */
export function zipOf(entries, { method: defMethod = 8 } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const method = e.method ?? defMethod;
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = e.crc ?? crc32(data);
    const usize = e.usize ?? data.length;
    const extra = Buffer.from([0xfe, 0xca, 0x02, 0x00, 0x01, 0x02]);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(usize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    parts.push(local, name, extra, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(usize, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + extra.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

/** 항목들을 묶는다 — 'store' 는 src/zip.js buildZip, 'deflate' 는 zipOf. */
export function pack(entries, method = 'store') {
  const list = entries.map(([name, data]) => ({ name, data }));
  return method === 'deflate' ? zipOf(list) : buildZip(list, { date: new Date(2026, 9, 15, 9, 0, 0) });
}

/** 옛 .xls·.doc 처럼 OLE 껍데기로 시작하는 바이트. */
export function oleBytes() {
  const b = new Uint8Array(1024);
  b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return b;
}

const colL = (n) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

/**
 * 검사용 xlsx.
 * @param {{ sheets: Array<{ name: string, rows: Array<Array<any>|null>, merges?: string[], hidden?: boolean, table?: boolean, cols?: boolean }>,
 *           strings?: 'shared'|'inline', calcChain?: boolean, table?: boolean, styles?: number, prefix?: string, method?: 'store'|'deflate' }} spec
 *   styles 는 cellXfs 수(서식 맞춤 검사용), prefix 는 본 이름공간 접두어('x' 면 <x:worksheet>), table 은 첫 시트에 표(시트마다 table 도 된다).
 *   칸 값: 글 · 숫자 · 참거짓 · { f, v, t? }(수식과 캐시 값) · { v, s }(서식 번호) · { s }(서식만 있는 빈 칸) · null(칸 없음). 행이 null 이면 그 행 없음.
 */
export function xlsxOf({ sheets: sheetsIn, strings = 'shared', calcChain = false, table = false, styles = 2, prefix = '', method = 'store' } = {}) {
  // 묶음 단위 table: true 는 첫 시트에 표를 단다(시트마다 table 을 줘도 된다).
  const sheets = sheetsIn.map((s, i) => (table && i === 0 ? { ...s, table: true } : s));
  const P = prefix ? `${prefix}:` : '';
  const xmlnsMain = prefix ? `xmlns:${prefix}="${NS.main}"` : `xmlns="${NS.main}"`;
  const sst = [];
  const sstIndex = new Map();
  const sIdx = (s) => {
    if (!sstIndex.has(s)) {
      sstIndex.set(s, sst.length);
      sst.push(s);
    }
    return sstIndex.get(s);
  };
  const cellOf = (val, ref) => {
    if (val == null) return '';
    const o = typeof val === 'object' ? val : { v: val };
    const sA = o.s != null ? ` s="${o.s}"` : '';
    if (o.f != null) {
      const t = o.t === 'str' || typeof o.v === 'string' ? ' t="str"' : '';
      return `<${P}c r="${ref}"${sA}${t}><${P}f>${esc(o.f)}</${P}f>${o.v != null ? `<${P}v>${esc(o.v)}</${P}v>` : ''}</${P}c>`;
    }
    if (o.v == null) return `<${P}c r="${ref}"${sA}/>`;
    if (typeof o.v === 'number') return `<${P}c r="${ref}"${sA}><${P}v>${o.v}</${P}v></${P}c>`;
    if (typeof o.v === 'boolean') return `<${P}c r="${ref}"${sA} t="b"><${P}v>${o.v ? 1 : 0}</${P}v></${P}c>`;
    if (strings === 'inline') return `<${P}c r="${ref}"${sA} t="inlineStr"><${P}is><${P}t>${esc(o.v)}</${P}t></${P}is></${P}c>`;
    return `<${P}c r="${ref}"${sA} t="s"><${P}v>${sIdx(String(o.v))}</${P}v></${P}c>`;
  };
  const entries = [];
  const wbRels = [];
  const overrides = [];
  const calc = [];
  let tableNo = 0;
  sheets.forEach((sh, i) => {
    const n = i + 1;
    let maxC = 1;
    const rowsXml = sh.rows.map((row, ri) => {
      if (!row) return '';
      const r = ri + 1;
      maxC = Math.max(maxC, row.length);
      const cells = row.map((v, ci) => {
        if (v && typeof v === 'object' && v.f != null) calc.push(`<c r="${colL(ci + 1)}${r}" i="${n}"/>`);
        return cellOf(v, `${colL(ci + 1)}${r}`);
      }).join('');
      return `<${P}row r="${r}" spans="1:${Math.max(1, row.length)}" x14ac:dyDescent="0.3">${cells}</${P}row>`;
    }).join('');
    const lastR = Math.max(1, sh.rows.length);
    const merges = sh.merges?.length ? `<${P}mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<${P}mergeCell ref="${m}"/>`).join('')}</${P}mergeCells>` : '';
    let tableParts = '';
    if (sh.table) {
      tableNo++;
      const ref = `A1:${colL(maxC)}${lastR}`;
      const head = sh.rows[0] || [];
      entries.push([`xl/tables/table${tableNo}.xml`, `${DECL}<table xmlns="${NS.main}" id="${tableNo}" name="표${tableNo}" displayName="표${tableNo}" ref="${ref}"><autoFilter ref="${ref}"/>`
        + `<tableColumns count="${maxC}">${Array.from({ length: maxC }, (_, k) => `<tableColumn id="${k + 1}" name="${esc(typeof head[k] === 'string' ? head[k] : `열${k + 1}`)}"/>`).join('')}</tableColumns>`
        + '<tableStyleInfo name="TableStyleMedium2" showRowStripes="1"/></table>']);
      entries.push([`xl/worksheets/_rels/sheet${n}.xml.rels`, `${DECL}<Relationships xmlns="${NS.pr}"><Relationship Id="rId1" Type="${REL}/table" Target="../tables/table${tableNo}.xml"/></Relationships>`]);
      overrides.push([`/xl/tables/table${tableNo}.xml`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml']);
      tableParts = `<${P}tableParts count="1"><${P}tablePart r:id="rId1"/></${P}tableParts>`;
    }
    const cols = sh.cols ? `<${P}cols><${P}col min="1" max="2" width="14" customWidth="1"/></${P}cols>` : '';
    entries.push([`xl/worksheets/sheet${n}.xml`, `${DECL}<${P}worksheet ${xmlnsMain} xmlns:r="${NS.r}" xmlns:mc="${NS.mc}" mc:Ignorable="x14ac" xmlns:x14ac="${NS.x14ac}">`
      + `<${P}dimension ref="A1:${colL(maxC)}${lastR}"/><${P}sheetViews><${P}sheetView workbookViewId="0"/></${P}sheetViews><${P}sheetFormatPr defaultRowHeight="16.5" x14ac:dyDescent="0.3"/>`
      + `${cols}<${P}sheetData>${rowsXml}</${P}sheetData>${merges}<${P}pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>${tableParts}</${P}worksheet>`]);
    wbRels.push(`<Relationship Id="rId${n}" Type="${REL}/worksheet" Target="worksheets/sheet${n}.xml"/>`);
    overrides.push([`/xl/worksheets/sheet${n}.xml`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml']);
  });
  const k = sheets.length;
  wbRels.push(`<Relationship Id="rId${k + 1}" Type="${REL}/styles" Target="styles.xml"/>`);
  overrides.push(['/xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml']);
  const xfs = Array.from({ length: styles }, (_, i) => `<${P}xf numFmtId="${i === 1 ? 14 : 0}" fontId="0" fillId="0" borderId="0" xfId="0"${i ? ' applyNumberFormat="1"' : ''}/>`).join('');
  entries.push(['xl/styles.xml', `${DECL}<${P}styleSheet ${xmlnsMain}><${P}fonts count="1"><${P}font><${P}sz val="11"/><${P}name val="맑은 고딕"/></${P}font></${P}fonts>`
    + `<${P}fills count="2"><${P}fill><${P}patternFill patternType="none"/></${P}fill><${P}fill><${P}patternFill patternType="gray125"/></${P}fill></${P}fills>`
    + `<${P}borders count="1"><${P}border><${P}left/><${P}right/><${P}top/><${P}bottom/><${P}diagonal/></${P}border></${P}borders>`
    + `<${P}cellStyleXfs count="1"><${P}xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></${P}cellStyleXfs><${P}cellXfs count="${styles}">${xfs}</${P}cellXfs></${P}styleSheet>`]);
  if (strings === 'shared') {
    // 공유 문자열은 시트를 다 만든 뒤에 쓴다(번호가 그때 정해진다) — 자리만 잡아 둔다.
    wbRels.push(`<Relationship Id="rId${k + 2}" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`);
    overrides.push(['/xl/sharedStrings.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml']);
  }
  if (calcChain) {
    wbRels.push(`<Relationship Id="rId${k + 3}" Type="${REL}/calcChain" Target="calcChain.xml"/>`);
    overrides.push(['/xl/calcChain.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml']);
    entries.push(['xl/calcChain.xml', `${DECL}<calcChain xmlns="${NS.main}">${calc.join('') || '<c r="A1" i="1"/>'}</calcChain>`]);
  }
  if (strings === 'shared') {
    entries.push(['xl/sharedStrings.xml', `${DECL}<${P}sst ${xmlnsMain} count="${sst.length}" uniqueCount="${sst.length}">${sst.map((s) => `<${P}si><${P}t xml:space="preserve">${esc(s)}</${P}t></${P}si>`).join('')}</${P}sst>`]);
  }
  const sheetTags = sheets.map((sh, i) => `<${P}sheet name="${esc(sh.name)}" sheetId="${i + 1}"${sh.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('');
  const head = [
    ['[Content_Types].xml', `${DECL}<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('') + '</Types>'],
    ['_rels/.rels', `${DECL}<Relationships xmlns="${NS.pr}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${DECL}<${P}workbook ${xmlnsMain} xmlns:r="${NS.r}"><${P}bookViews><${P}workbookView/></${P}bookViews><${P}sheets>${sheetTags}</${P}sheets><${P}calcPr calcId="191029"/></${P}workbook>`],
    ['xl/_rels/workbook.xml.rels', `${DECL}<Relationships xmlns="${NS.pr}">${wbRels.join('')}</Relationships>`],
  ];
  return pack([...head, ...entries], method);
}

/* ------------------------------------------------------------ docx */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const run = (t) => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const para = (t, id = '1A2B3C4D') => `<w:p w14:paraId="${id}" w14:textId="77777777" w:rsidR="00A1B2C3"><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${run(t)}</w:p>`;
const cell = (t, w = 3000) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr><w:p>${t === '' ? '' : run(t)}</w:p></w:tc>`;
const drawing = '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="그림 1"/>'
  + `<a:graphic xmlns:a="${NS.a}"><a:graphicData uri="${NS.pic}"><pic:pic xmlns:pic="${NS.pic}"><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>`
  + '<pic:blipFill><a:blip r:embed="rId20"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
const shape = '<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'
  + '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'
  + '<wp:extent cx="100" cy="100"/><wp:wrapNone/><wp:docPr id="2" name="도형 2"/><a:graphic xmlns:a="' + NS.a + '"><a:graphicData uri="' + NS.wps + '"><wps:wsp><wps:spPr/><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>'
  + '<mc:Fallback><w:pict><v:rect style="width:10pt;height:10pt"/></w:pict></mc:Fallback></mc:AlternateContent>';

/** 글상자(도형 + VML 대체) — 같은 글이 Choice 와 Fallback 에 두 번 들어 있다(Word 가 실제로 이렇게 쓴다). */
const textBox = (text) => '<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="100" cy="100"/><wp:docPr id="3" name="글상자 3"/>'
  + `<a:graphic xmlns:a="${NS.a}"><a:graphicData uri="${NS.wps}"><wps:wsp><wps:spPr/><wps:txbx><w:txbxContent><w:p>${run(text)}</w:p><w:p>${run('둘째 줄')}</w:p></w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice>`
  + `<mc:Fallback><w:pict><v:rect style="width:10pt;height:10pt"><v:textbox><w:txbxContent><w:p>${run(text)}</w:p><w:p>${run('둘째 줄')}</w:p></w:txbxContent></v:textbox></v:rect></w:pict></mc:Fallback></mc:AlternateContent>`;

/** 표 — header 행들(tblHeader 표시는 mark), rows 행들. 칸 수는 가장 긴 행. */
function table({ header = [], rows = [], mark = true }) {
  const n = Math.max(1, ...[...header, ...rows].map((r) => r.length));
  const grid = `<w:tblGrid>${'<w:gridCol w:w="3000"/>'.repeat(n)}</w:tblGrid>`;
  const tr = (r, h, i) => `<w:tr w14:paraId="00${String(i).padStart(6, '0')}" w14:textId="77777777">${h && mark ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${r.map((t) => cell(String(t ?? ''))).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0"/></w:tblPr>${grid}`
    + header.map((r, i) => tr(r, true, i)).join('') + rows.map((r, i) => tr(r, false, 100 + i)).join('') + '</w:tbl>';
}

/**
 * 검사용 docx.
 * @param {{ blocks: Array<{ p: string } | { tbl: { header, rows, mark? } } | { img: true } | { shape: true } | { box: string } | { link: string } | { sdt: string } | { note: string } | { sect: string } | { w15: string }>,
 *           sectPr?: boolean, w15?: boolean, method?: 'store'|'deflate' }} spec
 *   img 는 그림(관계 rId20 → media/image1.png), shape 는 mc:AlternateContent 도형, box 는 글상자(글 + '둘째 줄'), link 는 하이퍼링크(밖 관계 rId21),
 *   sdt 는 블록 내용 컨트롤, note 는 책갈피·메모 범위·각주 참조가 붙은 문단, sect 는 문단 안 구역 설정(머리글 관계 rId22). w15 면 뿌리에 xmlns:w15 를 더하고 본문에 w15 속성을 쓴다.
 */
export function docxOf({ blocks = [], sectPr = true, w15 = false, method = 'store' } = {}) {
  let k = 0;
  const body = blocks.map((b) => {
    k++;
    if (b.p != null) return para(b.p, `1A2B${String(k).padStart(4, '0')}`);
    if (b.tbl) return table(b.tbl);
    if (b.img) return `<w:p><w:r><w:t xml:space="preserve">그림: </w:t></w:r><w:r>${drawing}</w:r></w:p>`;
    if (b.shape) return `<w:p><w:r>${shape}</w:r><w:r><w:t>도형 뒤</w:t></w:r></w:p>`;
    if (b.box != null) return `<w:p><w:r>${textBox(b.box)}</w:r></w:p>`;
    if (b.link != null) return `<w:p><w:hyperlink r:id="rId21" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>${esc(b.link)}</w:t></w:r></w:hyperlink></w:p>`;
    if (b.sdt != null) return `<w:sdt><w:sdtPr><w:id w:val="12345"/><w:showingPlcHdr/></w:sdtPr><w:sdtEndPr/><w:sdtContent>${para(b.sdt, '5D5D0001')}</w:sdtContent></w:sdt>`;
    if (b.note != null) {
      return `<w:p><w:bookmarkStart w:id="0" w:name="_GoBack"/><w:commentRangeStart w:id="0"/>${run(b.note)}<w:commentRangeEnd w:id="0"/>`
        + '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r>'
        + '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r><w:bookmarkEnd w:id="0"/></w:p>';
    }
    if (b.sect != null) return `<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId22"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr>${run(b.sect)}</w:p>`;
    if (b.w15 != null) return `<w:p><w:pPr><w15:collapsed w:val="0"/></w:pPr>${run(b.w15)}</w:p>`;
    throw new Error(`모르는 블록: ${JSON.stringify(b)}`);
  }).join('');
  const sect = sectPr ? '<w:sectPr w:rsidR="00A1B2C3"><w:headerReference w:type="default" r:id="rId22"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/><w:cols w:space="425"/></w:sectPr>' : '';
  const doc = `${DECL}<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="${NS.mc}" xmlns:r="${NS.r}" xmlns:w="${NS.w}" xmlns:w14="${NS.w14}"`
    + `${w15 ? ` xmlns:w15="${NS.w15}"` : ''} xmlns:wp="${NS.wp}" xmlns:wps="${NS.wps}" xmlns:v="${NS.v}" mc:Ignorable="w14${w15 ? ' w15' : ''}"><w:body>${body}${sect}</w:body></w:document>`;
  const entries = [
    ['[Content_Types].xml', `${DECL}<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>`
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'],
    ['_rels/.rels', `${DECL}<Relationships xmlns="${NS.pr}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/document.xml', doc],
    ['word/_rels/document.xml.rels', `${DECL}<Relationships xmlns="${NS.pr}"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>`
      + `<Relationship Id="rId20" Type="${REL}/image" Target="media/image1.png"/><Relationship Id="rId21" Type="${REL}/hyperlink" Target="https://example.com/a?b=1&amp;c=2" TargetMode="External"/>`
      + `<Relationship Id="rId22" Type="${REL}/header" Target="header1.xml"/></Relationships>`],
    ['word/styles.xml', `${DECL}<w:styles xmlns:w="${NS.w}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`],
    ['word/header1.xml', `${DECL}<w:hdr xmlns:w="${NS.w}"><w:p><w:r><w:t>머리글</w:t></w:r></w:p></w:hdr>`],
    ['word/media/image1.png', PNG],
  ];
  return pack(entries, method);
}

/* ------------------------------------------------------------ 검사 */

let parser = null;
/** jsdom 의 DOMParser 로 XML 이 잘 짜였는지(이름공간 접두어 선언까지) — 깨졌으면 까닭 글, 아니면 ''. */
export function xmlProblem(xml) {
  parser ??= new (new JSDOM('').window.DOMParser)();
  const d = parser.parseFromString(xml, 'application/xml');
  const err = d.getElementsByTagName('parsererror')[0];
  return err ? err.textContent.slice(0, 300) : '';
}

/**
 * 결과 묶음 검사 — src/zip.js readZip 으로 읽히는지(store), 첫 항목이 [Content_Types].xml 인지, XML 이 모두 잘 짜였는지,
 * 관계가 없는 파트를 가리키지 않는지, Override 가 없는 파트를 가리키지 않는지, 파트마다 내용 형식이 있는지. 문제 목록을 돌려준다.
 * @returns {{ names: string[], text: (name: string) => string|null, problems: string[] }}
 */
export function checkPackage(bytes) {
  const entries = readZip(bytes);
  const names = entries.map((e) => e.name);
  const map = new Map(entries.map((e) => [e.name, e.data]));
  const text = (n) => (map.has(n) ? dec.decode(map.get(n)) : null);
  const problems = [];
  if (names[0] !== '[Content_Types].xml') problems.push(`첫 항목이 ${names[0]}`);
  const lower = new Set(names.map((n) => n.toLowerCase()));
  for (const n of names) {
    if (!/\.(xml|rels)$/i.test(n)) continue;
    const p = xmlProblem(text(n));
    if (p) problems.push(`${n}: ${p}`);
  }
  const ct = text('[Content_Types].xml') || '';
  const defaults = new Set([...ct.matchAll(/<Default\b[^>]*Extension="([^"]+)"/g)].map((m) => m[1].toLowerCase()));
  const overrides = [...ct.matchAll(/<Override\b[^>]*PartName="([^"]+)"/g)].map((m) => m[1].replace(/^\//, ''));
  for (const o of overrides) if (!lower.has(o.toLowerCase())) problems.push(`Override 가 없는 파트를 가리킴: ${o}`);
  const ovSet = new Set(overrides.map((o) => o.toLowerCase()));
  for (const n of names) {
    if (n === '[Content_Types].xml') continue;
    const ext = (/\.([^./]+)$/.exec(n) || [])[1]?.toLowerCase();
    if (!ovSet.has(n.toLowerCase()) && !defaults.has(ext)) problems.push(`내용 형식 없음: ${n}`);
  }
  for (const n of names) {
    const m = /^(.*?)_rels\/([^/]*)\.rels$/.exec(n);
    if (!m) continue;
    const dir = m[1];
    for (const r of text(n).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const a = r[1];
      if (/TargetMode="External"/i.test(a)) continue;
      const target = /Target="([^"]+)"/.exec(a)[1];
      const parts = [];
      for (const p of (target.startsWith('/') ? target : dir + target).split('/')) {
        if (p === '..') parts.pop();
        else if (p && p !== '.') parts.push(p);
      }
      const full = parts.join('/');
      if (!lower.has(full.toLowerCase())) problems.push(`${n}: 없는 파트를 가리킴 ${full}`);
    }
  }
  return { names, text, problems };
}
