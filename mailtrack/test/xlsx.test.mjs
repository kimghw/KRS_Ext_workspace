// 메일 수신 탭의 엑셀 양식 병합(mailtrack/ooxml) — ZIP 읽기(store·deflate·CRC·한도), XML 손질 도구, readXlsx·headerRowsOf,
// mergeXlsx(회신 행 쌓기·공유 문자열 → inlineStr·수식은 값만·서식 번호·출처 열·병합 칸·calcChain·표 빼기·시트 맞추기·건너뛰기),
// merge.js 입구(mergeKind·mergedName·mergeOffice). 검사용 파일은 fixtures/office.mjs 가 만든다. 어디에도 보내지 않는다.
// 결과 XML 이 잘 짜였는지는 jsdom 의 DOMParser 로 본다(검사에서만 — 라이브러리는 DOM 에 기대지 않는다).
import assert from 'node:assert/strict';

import { buildZip, readZip } from '../../src/zip.js';
import { unzip, replyProblem, isOle, UNZIP_MAX_BYTES, UNZIP_MAX_ENTRIES } from '../ooxml/zipread.js';
import {
  esc, unesc, attr, attrAny, setAttr, dropAttr, relIdOf, children, findAll, findFirst, transform, textOf,
  colLetter, colIndex, parseRef, parseRange, rangeText, sourceText, dateText,
} from '../ooxml/xml.js';
import { readXlsx, headerRowsOf, mergeXlsx, XLSX_MIME } from '../ooxml/xlsx.js';
import { mergeKind, mergedName, mergeOffice, MIME } from '../ooxml/merge.js';
import { xlsxOf, zipOf, pack, oleBytes, checkPackage, xmlProblem } from './fixtures/office.mjs';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const enc = new TextEncoder();
const dec = new TextDecoder();

/** 결과 시트를 { 행 번호: { 열 글자: 글 } } 로 — 공유 문자열·inlineStr 을 푼 글. */
async function gridOf(bytes, sheet = 0) {
  const book = await readXlsx(bytes);
  const s = book.sheets[sheet];
  const out = {};
  for (const row of s.rows) {
    out[row.r] = {};
    for (const c of row.cells) out[row.r][colLetter(c.col)] = c.text;
  }
  return { book, sheet: s, grid: out };
}
const noProblems = (bytes) => {
  const chk = checkPackage(bytes);
  assert.deepEqual(chk.problems, [], chk.problems.join('\n'));
  return chk;
};

const SRC1 = { org: 'foo.com', name: '홍길동', address: 'hong@foo.com', date: '2026-10-14' };
const SRC2 = { org: 'bar.co.kr', name: '이영희', address: 'lee@bar.co.kr', date: '2026-10-15' };
const SRC3 = { org: 'baz.org', name: '박', address: 'park@baz.org', date: '2026-10-15' };
const label = (s) => sourceText(s);

/* ================================================================ zipread */
console.log('zipread — 중앙 목록을 따라 풀기');
const FILES = [['[Content_Types].xml', '<Types/>'], ['a/한글.xml', '<a>가나다</a>'], ['b.bin', new Uint8Array([0, 1, 2, 255])], ['dir/', '']];

await ta('store 묶음(buildZip): 이름·바이트·차례 그대로, 폴더 항목은 뺀다', async () => {
  const z = buildZip(FILES.map(([name, data]) => ({ name, data })));
  const m = await unzip(z);
  assert.deepEqual([...m.keys()], ['[Content_Types].xml', 'a/한글.xml', 'b.bin']);
  assert.equal(dec.decode(m.get('a/한글.xml')), '<a>가나다</a>');
  assert.deepEqual([...m.get('b.bin')], [0, 1, 2, 255]);
});
await ta('deflate 묶음(zlib — 실제 Office 꼴)과 store·deflate 섞인 묶음도 같은 바이트', async () => {
  const z = zipOf([{ name: 'x.xml', data: '<x>' + 'abc'.repeat(500) + '</x>' }, { name: 'y.txt', data: '그대로', method: 0 }]);
  const m = await unzip(z);
  assert.equal(dec.decode(m.get('x.xml')), '<x>' + 'abc'.repeat(500) + '</x>');
  assert.equal(dec.decode(m.get('y.txt')), '그대로');
  const ab = await unzip(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength));   // ArrayBuffer 도 받는다
  assert.equal(ab.size, 2);
});
await ta('want — 이름 하나·목록(대소문자 무시)·정규식·함수', async () => {
  const z = zipOf([{ name: 'xl/workbook.xml', data: '<w/>' }, { name: 'xl/styles.xml', data: '<s/>' }, { name: 'docProps/app.xml', data: '<p/>' }]);
  assert.deepEqual([...(await unzip(z, { want: 'XL/Workbook.xml' })).keys()], ['xl/workbook.xml']);
  assert.deepEqual([...(await unzip(z, { want: ['xl/styles.xml', 'docprops/app.xml'] })).keys()], ['xl/styles.xml', 'docProps/app.xml']);
  assert.deepEqual([...(await unzip(z, { want: /^xl\//g })).keys()], ['xl/workbook.xml', 'xl/styles.xml']);
  assert.deepEqual([...(await unzip(z, { want: (n) => n.endsWith('app.xml') })).keys()], ['docProps/app.xml']);
});
await ta('CRC 가 틀리면 한국어로 던진다(deflate·store 모두)', async () => {
  await assert.rejects(unzip(zipOf([{ name: 'a.xml', data: '<a/>', crc: 1234 }])), /a\.xml: CRC 가 맞지 않습니다/);
  await assert.rejects(unzip(zipOf([{ name: 'b.xml', data: '<b/>', crc: 99, method: 0 }])), /b\.xml: CRC 가 맞지 않습니다/);
});
await ta('한도 — 항목 수(maxEntries)·푼 크기의 합(maxBytes, store 도 센다)·목록보다 크게 풀리면 멈춤', async () => {
  assert.equal(UNZIP_MAX_BYTES, 40 * 1024 * 1024);
  assert.equal(UNZIP_MAX_ENTRIES, 5000);
  const many = zipOf(Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.xml`, data: '<x/>' })));
  await assert.rejects(unzip(many, { maxEntries: 5 }), /항목이 너무 많습니다\(5개 넘음\)/);
  assert.equal((await unzip(many, { maxEntries: 6 })).size, 6);
  const big = zipOf([{ name: 'big.xml', data: 'x'.repeat(5000) }]);
  await assert.rejects(unzip(big, { maxBytes: 4096 }), /압축을 푼 크기가 너무 큽니다\(4KB 넘음\)/);
  const stored = zipOf([{ name: 'a', data: 'x'.repeat(3000), method: 0 }, { name: 'b', data: 'y'.repeat(3000), method: 0 }]);
  await assert.rejects(unzip(stored, { maxBytes: 4096 }), /너무 큽니다/);
  const lie = zipOf([{ name: 'lie.xml', data: 'z'.repeat(4000), usize: 100 }]);
  await assert.rejects(unzip(lie), /lie\.xml: 풀린 크기가 목록에 적힌 것보다 큽니다/);
});
await ta('ZIP 이 아니면 — 빈 것·글·OLE(옛 xls) 모두 같은 까닭', async () => {
  await assert.rejects(unzip(new Uint8Array(0)), /ZIP 형식이 아닙니다/);
  await assert.rejects(unzip(enc.encode('그냥 글입니다. '.repeat(10))), /ZIP 형식이 아닙니다/);
  await assert.rejects(unzip(oleBytes()), /옛 형식\(\.xls·\.doc\)/);
  await assert.rejects(unzip(undefined), /파일 바이트가 없습니다/);
});
t('replyProblem — 옛 확장자·OLE 껍데기·ZIP 아님·바이트 없음, 멀쩡하면 빈 말', () => {
  const ok = xlsxOf({ sheets: [{ name: 'A', rows: [['a']] }] });
  assert.equal(replyProblem({ bytes: ok, name: '회신.xlsx' }, 'xlsx'), '');
  assert.match(replyProblem({ bytes: ok, name: '회신.XLS' }, 'xlsx'), /^xls\(엑셀 옛 형식\) 파일은 병합하지 못합니다 — 엑셀\(xlsx\) 로 저장한/);
  assert.match(replyProblem({ bytes: oleBytes() }, 'xlsx'), /옛 형식\(\.xls·\.doc\)이거나 암호·보안\(DRM\)/);
  assert.equal(replyProblem({ bytes: enc.encode('hello world') }, 'docx'), '워드(docx) 파일이 아닙니다.');
  assert.match(replyProblem({}, 'xlsx'), /파일 바이트가 없습니다/);
  assert.equal(isOle(oleBytes()), true);
  assert.equal(isOle(ok), false);
});

/* ================================================================ xml */
console.log('xml — 접두어에 기대지 않는 스캐너와 도구');
t('esc·unesc — 다섯 글자와 숫자 개체, 못 쓰는 제어 문자는 지운다', () => {
  assert.equal(esc(`a<b>&"c'\u0001\u0007d`), 'a&lt;b&gt;&amp;&quot;c&apos;d');
  assert.equal(unesc('&lt;&#44032;&#xAC00;&amp;lt;&quot;'), '<가가&lt;"');
  assert.equal(esc(null), '');
  assert.equal(unesc(esc('줄\t바꿈\n과 탭 "따옴표" & <꺾쇠>')), '줄\t바꿈\n과 탭 "따옴표" & <꺾쇠>');
});
t('colLetter·colIndex·parseRef·parseRange·rangeText', () => {
  assert.deepEqual([1, 26, 27, 52, 53, 702, 703, 16384].map(colLetter), ['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA', 'XFD']);
  assert.deepEqual(['A', 'z', 'AA', 'AB', 'XFD', '$C', '1'].map(colIndex), [1, 26, 27, 28, 16384, 3, 0]);
  assert.deepEqual(parseRef('$B$12'), { col: 2, row: 12 });
  assert.equal(parseRef('B'), null);
  assert.deepEqual(parseRange('C3:A1'), { c1: 1, r1: 1, c2: 3, r2: 3 });
  assert.deepEqual(parseRange('D4'), { c1: 4, r1: 4, c2: 4, r2: 4 });
  assert.equal(rangeText({ c1: 1, r1: 1, c2: 3, r2: 2 }), 'A1:C2');
  assert.equal(rangeText({ c1: 2, r1: 5, c2: 2, r2: 5 }), 'B5');
});
t('attr·attrAny·relIdOf·setAttr·dropAttr', () => {
  const a = ' r="A1" s=\'3\' x14ac:dyDescent="0.3" w:val="a&amp;b" ns9:id="rId7"';
  assert.equal(attr(a, 'r'), 'A1');
  assert.equal(attr(a, 's'), '3');
  assert.equal(attr(a, 'val'), '');
  assert.equal(attrAny(a, 'val'), 'a&b');
  assert.equal(attr(a, 'dyDescent'), '');
  assert.equal(relIdOf(a), 'rId7');
  assert.equal(relIdOf(' sheetId="1" id="x"'), '');
  assert.equal(setAttr(' r="1" spans="1:3"', 'r', '9'), ' r="9" spans="1:3"');
  assert.equal(setAttr(' r="1"', 'ref', 'A1:B<2'), ' r="1" ref="A1:B&lt;2"');
  assert.equal(dropAttr(' r="1" spans="1:3" x="2"', 'spans'), ' r="1" x="2"');
  assert.equal(dropAttr(' w14:paraId="1" a="2" paraId="3"', 'paraId', true), ' a="2"');
});
t('findAll·findFirst·children — 접두어는 무엇이든, 같은 이름이 겹치면 바깥 것, 속성 안의 > 와 주석도 견딘다', () => {
  const x = '<?xml version="1.0"?><x:root xmlns:x="u"><!-- <x:tbl> --><x:tbl a="1"><x:tr><x:tc><tbl q="a>b"><x:tr/></tbl></x:tc></x:tr></x:tbl><w:tbl/><p>t</p></x:root>';
  const tbls = findAll(x, 'tbl');
  assert.deepEqual(tbls.map((e) => e.name), ['x:tbl', 'w:tbl']);
  assert.equal(tbls[0].attrs, ' a="1"');
  assert.match(tbls[0].inner, /^<x:tr><x:tc><tbl q="a>b"><x:tr\/><\/tbl><\/x:tc><\/x:tr>$/);
  assert.equal(tbls[1].self, true);
  assert.equal(findAll(x, 'tr').length, 1);   // 안쪽 tr 은 바깥 tr 안에 있다
  assert.equal(findFirst(x, 'p').inner, 't');
  assert.equal(findFirst(x, 'nothing'), null);
  const root = findFirst(x, 'root');
  assert.deepEqual(children(x, root.innerStart, root.innerEnd).map((e) => e.local), ['tbl', 'tbl', 'p']);
  assert.equal(textOf('<si><r><t>가</t></r><r><t xml:space="preserve"> 나</t></r><rPh sb="0" eb="1"><t>カ</t></rPh><t/></si>'), '가 나');
});
t('transform — drop·unwrap·replace·tag 와 자리(context)', () => {
  const x = '<w:p><w:hyperlink r:id="r1"><w:r><w:drawing><a/></w:drawing><w:t>글</w:t></w:r></w:hyperlink><w:bookmarkStart w:id="0"/><w:sdt><w:sdtPr><w:id/></w:sdtPr><w:sdtContent><w:r><w:t>안</w:t></w:r></w:sdtContent></w:sdt></w:p>';
  const seen = [];
  const out = transform(x, (e) => {
    if (e.local === 'drawing') {
      seen.push(e.context);
      return { replace: '<w:t>[그림]</w:t>' };
    }
    if (e.local === 'hyperlink' || e.local === 'sdt' || e.local === 'sdtContent') return 'unwrap';
    if (e.local === 'bookmarkStart' || e.local === 'sdtPr') return 'drop';
    if (e.local === 'p') return { tag: '<w:p x="1">' };
    return null;
  }, { context: 'body' });
  assert.equal(out, '<w:p x="1"><w:r><w:t>[그림]</w:t><w:t>글</w:t></w:r><w:r><w:t>안</w:t></w:r></w:p>');
  assert.deepEqual(seen, ['r']);
});
t('sourceText — "org · name <address> · date", 빈 것은 빼고, org 가 주소면 한 번만', () => {
  assert.equal(sourceText(SRC1), 'foo.com · 홍길동 <hong@foo.com> · 2026-10-14');
  assert.equal(sourceText({ org: 'kim@krs.co.kr', name: '김', address: 'kim@krs.co.kr' }), '김 <kim@krs.co.kr>');
  assert.equal(sourceText({ org: 'foo.com', address: 'a@foo.com' }), 'foo.com · <a@foo.com>');
  assert.equal(sourceText({ name: '  홍  길동 ' }), '홍 길동');
  assert.equal(sourceText(null), '');
  const d = new Date(2026, 9, 15, 9, 5);
  assert.equal(dateText(d), '2026-10-15 09:05');
  assert.equal(dateText(d.toISOString()), '2026-10-15 09:05');   // ISO 는 그 PC 시각으로
  assert.equal(dateText(d.getTime()), '2026-10-15 09:05');
  assert.equal(dateText('어제'), '어제');
});

/* ================================================================ readXlsx · headerRowsOf */
console.log('readXlsx · headerRowsOf');
await ta('readXlsx — 공유 문자열·inlineStr 은 같은 글, 숫자·수식·참거짓, 숨김·병합·dimension·서식 수', async () => {
  const rows = [['이름', '수량'], ['가 & 나', 3], ['<꺾쇠>', { f: 'B2*2', v: 6 }], [true, null]];
  for (const strings of ['shared', 'inline']) {
    const b = await readXlsx(xlsxOf({ sheets: [{ name: '시트1', rows, merges: ['A1:B1'] }, { name: '숨김', rows: [['x']], hidden: true }], strings, styles: 4 }));
    assert.equal(b.cellXfsCount, 4);
    assert.deepEqual(b.sheets.map((s) => [s.name, s.hidden, s.worksheet, s.path]), [['시트1', false, true, 'xl/worksheets/sheet1.xml'], ['숨김', true, true, 'xl/worksheets/sheet2.xml']]);
    const s = b.sheets[0];
    assert.deepEqual(s.rows.map((r) => r.cells.map((c) => c.text)), [['이름', '수량'], ['가 & 나', '3'], ['<꺾쇠>', '6'], ['1']]);
    assert.equal(s.rows[2].cells[1].f, 'B2*2');
    assert.equal(s.rows[3].cells[0].t, 'b');
    assert.deepEqual(s.mergeCells, ['A1:B1']);
    assert.equal(s.dimension, 'A1:B4');
    assert.deepEqual(b.sharedStrings, strings === 'shared' ? ['이름', '수량', '가 & 나', '<꺾쇠>', 'x'] : []);
  }
  await assert.rejects(readXlsx(pack([['[Content_Types].xml', '<Types/>'], ['word/document.xml', '<w:document/>']])), /엑셀\(xlsx\) 파일이 아닙니다/);
});
await ta('headerRowsOf — 1행부터 이어진 비지 않은 행, 앞의 빈 행은 머리에, 수식만 있는 행은 빈 행, 최소 1', async () => {
  const H = async (rows) => headerRowsOf((await readXlsx(xlsxOf({ sheets: [{ name: 'S', rows }] }))).sheets[0]);
  assert.equal(await H([['제목'], ['이름', '부서']]), 2);
  assert.equal(await H([['이름', '부서'], null, null, ['※ 안내']]), 1);
  assert.equal(await H([['제목'], null, ['이름', '부서']]), 1);   // 양식만 보면 1 — mergeXlsx 의 자동이 회신을 보고 3 까지 늘린다
  assert.equal(await H([null, ['이름', '부서'], ['구분', '값']]), 3);
  assert.equal(await H([['이름', '금액'], [null, { f: 'A2*2', v: 0 }], [null, { f: 'A3*2', v: 0 }]]), 1);
  assert.equal(await H([]), 1);
  assert.equal(headerRowsOf({ rows: [] }), 1);
  assert.equal(headerRowsOf(null), 1);
});

/* ================================================================ mergeXlsx */
console.log('mergeXlsx — 회신 행 쌓기');
const TPL_ROWS = [['2026 수요 조사'], null, ['이름', '부서', '수량', '단가', '금액']];
const tpl = xlsxOf({ sheets: [{ name: '조사', rows: TPL_ROWS, merges: ['A1:E1'] }], calcChain: true });
const reply = (rows, extra = {}) => xlsxOf({ sheets: [{ name: '조사', rows: [...TPL_ROWS, ...rows], merges: ['A1:E1'], ...extra.sheet }], ...extra.book });

await ta('두 회신이 차례대로 머리 아래에 — 행 번호 4·5·6, 공유 문자열 → inlineStr 같은 글, 숫자 그대로, 수식은 캐시 값만', async () => {
  const r1 = reply([['홍길동', '기술', 2, 1000, { f: 'C4*D4', v: 2000 }], ['김철수', '영업', 1, 500, { f: 'C5*D5', v: 500 }]]);
  const r2 = reply([['이영희', '품질', 3, 10, { f: 'C4*D4', v: 30 }]], { book: { strings: 'inline', method: 'deflate' } });
  const { bytes, report } = await mergeXlsx(tpl, [{ bytes: r1, source: SRC1 }, { bytes: r2, source: SRC2 }]);
  assert.equal(report.merged, 2);
  assert.equal(report.rows, 3);
  assert.deepEqual(report.skipped, []);
  assert.deepEqual(report.sheets, [{ name: '조사', headerRows: 3, rows: 3, sourceCol: 'F' }]);
  const { grid, sheet } = await gridOf(bytes);
  assert.deepEqual(Object.keys(grid).map(Number), [1, 3, 4, 5, 6]);
  assert.deepEqual(grid[3], { A: '이름', B: '부서', C: '수량', D: '단가', E: '금액', F: '출처' });
  assert.deepEqual(grid[4], { A: '홍길동', B: '기술', C: '2', D: '1000', E: '2000', F: label(SRC1) });
  assert.deepEqual(grid[5], { A: '김철수', B: '영업', C: '1', D: '500', E: '500', F: label(SRC1) });
  assert.deepEqual(grid[6], { A: '이영희', B: '품질', C: '3', D: '10', E: '30', F: label(SRC2) });
  // 회신 칸은 inlineStr(공유 문자열 번호는 회신 것이라 쓰지 않는다), 숫자는 <v>, 수식은 없다.
  const cells = sheet.rows.find((r) => r.r === 4).cells;
  assert.deepEqual(cells.map((c) => c.t), ['inlineStr', 'inlineStr', '', '', '', 'inlineStr']);
  assert.ok(cells.every((c) => c.f === null));
  assert.doesNotMatch(sheet.xml, /<f>/);
  assert.match(sheet.xml, /<dimension ref="A1:F6"\/>/);
  // 양식의 머리 행은 공유 문자열 그대로(양식의 sharedStrings.xml 은 바이트 그대로 남는다).
  assert.match(sheet.xml, /<row r="3" x14ac:dyDescent="0.3"><c r="A3" t="s">/);
  const chk = noProblems(bytes);
  const tParts = await unzip(tpl);
  assert.deepEqual(chk.text('xl/sharedStrings.xml'), dec.decode(tParts.get('xl/sharedStrings.xml')));
  assert.deepEqual(chk.text('xl/styles.xml'), dec.decode(tParts.get('xl/styles.xml')));
});
await ta('출처 열 — 머리의 최대 열 + 1(데이터가 더 오른쪽이면 그 뒤), 머리 칸 서식은 왼쪽 칸 것, 너비 <col> 를 더한다', async () => {
  const t2 = xlsxOf({ sheets: [{ name: '조사', rows: [['이름', { v: '부서', s: 1 }]], cols: true }] });
  const r = xlsxOf({ sheets: [{ name: '조사', rows: [['이름', { v: '부서', s: 1 }], ['홍', '기술', null, '비고칸']], cols: true }] });
  const { bytes, report } = await mergeXlsx(t2, [{ bytes: r, source: SRC1 }]);
  assert.equal(report.sheets[0].sourceCol, 'E');
  const { grid, sheet } = await gridOf(bytes);
  assert.deepEqual(grid[1], { A: '이름', B: '부서', E: '출처' });
  assert.deepEqual(grid[2], { A: '홍', B: '기술', D: '비고칸', E: label(SRC1) });
  assert.match(sheet.xml, /<cols><col min="1" max="2" width="14" customWidth="1"\/><col min="5" max="5" width="40" customWidth="1"\/><\/cols>/);
  // 머리 행 H 의 출처 칸: 서식이 있는 왼쪽 칸이 D 가 아니라(빈 자리) 서식 없음 — B 의 서식은 옆 칸이 아니다.
  assert.match(sheet.xml, /<c r="E1" t="inlineStr"><is><t xml:space="preserve">출처<\/t><\/is><\/c>/);
  const t3 = xlsxOf({ sheets: [{ name: '조사', rows: [['이름', { v: '부서', s: 1 }]] }] });
  const r3 = xlsxOf({ sheets: [{ name: '조사', rows: [['이름', { v: '부서', s: 1 }], ['홍', { v: '기술', s: 1 }]] }] });
  const m3 = await mergeXlsx(t3, [{ bytes: r3, source: SRC1 }], { sourceHeader: '보낸 곳' });
  const x3 = (await gridOf(m3.bytes)).sheet.xml;
  assert.match(x3, /<cols><col min="3" max="3" width="40" customWidth="1"\/><\/cols><sheetData>/);
  assert.match(x3, /<c r="C1" s="1" t="inlineStr"><is><t xml:space="preserve">보낸 곳<\/t>/);
  assert.match(x3, /<c r="C2" s="1" t="inlineStr">/);   // 서식이 맞으니 데이터 행의 출처 칸도 왼쪽 칸 서식
  noProblems(m3.bytes);
});
await ta('서식 번호 — 회신의 cellXfs 수가 양식과 같으면 남기고, 다르면 빼고 경고(행 서식도)', async () => {
  const rowsOf = (n) => [['날짜', '값'], [{ v: 46310, s: 1 }, { v: 5, s: 1 }]];
  const same = xlsxOf({ sheets: [{ name: 'S', rows: rowsOf() }], styles: 2 });
  const diff = xlsxOf({ sheets: [{ name: 'S', rows: rowsOf() }], styles: 5 });
  const t2 = xlsxOf({ sheets: [{ name: 'S', rows: [['날짜', '값']] }], styles: 2 });
  const { bytes, report } = await mergeXlsx(t2, [{ bytes: same, source: SRC1 }, { bytes: diff, source: SRC2 }]);
  const x = (await gridOf(bytes)).sheet.xml;
  assert.match(x, /<c r="A2" s="1"><v>46310<\/v><\/c>/);
  assert.match(x, /<c r="A3"><v>46310<\/v><\/c>/);
  assert.deepEqual(report.warnings, [`${label(SRC2)}: 서식 목록이 양식과 달라 칸 서식을 뺐습니다(날짜가 숫자로 보일 수 있습니다).`]);
});
await ta('병합 칸 — 머리 안에 든 것만 남기고(머리를 넘는 것·양식 데이터 자리 것은 뺀다), 이어서 쌓인 회신의 병합은 새 번호로 옮긴다', async () => {
  const t2 = xlsxOf({ sheets: [{ name: 'S', rows: [['제목'], ['이름', '내용', '']], merges: ['A1:C1', 'A2:A3', 'B5:C5'] }] });
  const r1 = xlsxOf({ sheets: [{ name: 'S', rows: [['제목'], ['이름', '내용', ''], ['가', '긴 글'], ['나', '둘'], ['', '셋']], merges: ['A1:C1', 'B3:C3', 'A4:A5'] }] });
  const r2 = xlsxOf({ sheets: [{ name: 'S', rows: [['제목'], ['이름', '내용', ''], ['다', '넷'], null, ['라', '다섯']], merges: ['A3:A5'] }] });
  const { bytes } = await mergeXlsx(t2, [{ bytes: r1, source: SRC1 }, { bytes: r2, source: SRC2 }]);
  const { sheet, grid } = await gridOf(bytes);
  // 회신 1: 3·4·5 행 → 3·4·5, 회신 2: 3·5 행 → 6·7(4행이 비어 이어지지 않으니 A3:A5 는 옮기지 않는다)
  assert.deepEqual(Object.keys(grid).map(Number), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(sheet.mergeCells, ['A1:C1', 'B3:C3', 'A4:A5']);
  assert.match(sheet.xml, /<mergeCells count="3">/);
  assert.equal(grid[2].D, '출처');   // 병합 B3:C3 이 C 열까지라 출처는 D
  noProblems(bytes);
  // 머리 밖 병합만 있던 양식 → 남는 병합이 없으면 요소째 뺀다.
  const t3 = xlsxOf({ sheets: [{ name: 'S', rows: [['이름', '값']], merges: ['A3:B3'] }] });
  const r3 = xlsxOf({ sheets: [{ name: 'S', rows: [['이름', '값'], ['가', 1]] }] });
  const x3 = (await gridOf((await mergeXlsx(t3, [{ bytes: r3, source: SRC1 }])).bytes)).sheet.xml;
  assert.doesNotMatch(x3, /mergeCell/);
  // 양식에 mergeCells 가 없어도 회신의 병합은 pageMargins 앞에 새로 넣는다.
  const t4 = xlsxOf({ sheets: [{ name: 'S', rows: [['이름', '값', '']] }] });
  const r4 = xlsxOf({ sheets: [{ name: 'S', rows: [['이름', '값', ''], ['가', '길게']], merges: ['B2:C2'] }] });
  const m4 = await mergeXlsx(t4, [{ bytes: r4, source: SRC1 }]);
  assert.match((await gridOf(m4.bytes)).sheet.xml, /<\/sheetData><mergeCells count="1"><mergeCell ref="B2:C2"\/><\/mergeCells><pageMargins /);
  noProblems(m4.bytes);
});
await ta('calcChain 과 표(tableParts·xl/tables/*) — 파트·관계·Override 를 함께 빼서 끊긴 참조가 없다', async () => {
  const t2 = xlsxOf({ sheets: [{ name: '목록', rows: [['이름', '값'], ['예시', { f: '1+1', v: 2 }]] }], table: true, calcChain: true });
  const r = xlsxOf({ sheets: [{ name: '목록', rows: [['이름', '값'], ['가', 1], ['나', 2]], table: true }], calcChain: true });
  const before = checkPackage(t2);
  assert.ok(before.names.includes('xl/calcChain.xml') && before.names.includes('xl/tables/table1.xml'));
  const { bytes, report } = await mergeXlsx(t2, [{ bytes: r, source: SRC1 }], { headerRows: 1 });
  const chk = noProblems(bytes);
  assert.ok(!chk.names.some((n) => /calcChain|tables\//.test(n)), chk.names.join(','));
  assert.doesNotMatch(chk.text('[Content_Types].xml'), /calcChain|table1/);
  assert.doesNotMatch(chk.text('xl/_rels/workbook.xml.rels'), /calcChain/);
  assert.doesNotMatch(chk.text('xl/worksheets/sheet1.xml'), /tablePart/);
  assert.doesNotMatch(chk.text('xl/worksheets/_rels/sheet1.xml.rels'), /Relationship /);
  assert.ok(report.warnings.includes("'목록' 시트: 엑셀 표(표 서식) 1개를 뺐습니다 — 칸 값과 서식은 그대로입니다."));
  assert.ok(report.warnings.includes("'목록' 시트: 양식의 머리 아래 1개 행(예시·안내·합계 등)은 결과에 넣지 않았습니다."));
  assert.deepEqual((await gridOf(bytes)).grid[3], { A: '나', B: '2', C: label(SRC1) });
});
await ta('시트 맞추기 — 같은 이름(차례가 달라도), 없으면 같은 차례(경고), 숨긴 시트는 양식 바이트 그대로', async () => {
  const t2 = xlsxOf({ sheets: [{ name: '인력', rows: [['이름']] }, { name: '장비', rows: [['장비']] }, { name: '코드', rows: [['A'], ['B']], hidden: true }] });
  const r1 = xlsxOf({ sheets: [{ name: '장비', rows: [['장비'], ['현미경']] }, { name: '인력', rows: [['이름'], ['홍']] }, { name: '코드', rows: [['A'], ['B'], ['C']], hidden: true }] });
  const r2 = xlsxOf({ sheets: [{ name: 'Sheet1', rows: [['이름'], ['김']] }, { name: 'Sheet2', rows: [['장비'], ['저울']] }] });
  const { bytes, report } = await mergeXlsx(t2, [{ bytes: r1, source: SRC1 }, { bytes: r2, source: SRC2 }]);
  assert.deepEqual((await gridOf(bytes, 0)).grid, { 1: { A: '이름', B: '출처' }, 2: { A: '홍', B: label(SRC1) }, 3: { A: '김', B: label(SRC2) } });
  assert.deepEqual((await gridOf(bytes, 1)).grid, { 1: { A: '장비', B: '출처' }, 2: { A: '현미경', B: label(SRC1) }, 3: { A: '저울', B: label(SRC2) } });
  assert.ok(report.warnings.includes(`${label(SRC2)}: '인력' 시트가 없어 1번째 시트 'Sheet1' 를 합쳤습니다.`));
  assert.ok(report.warnings.includes(`${label(SRC2)}: '장비' 시트가 없어 2번째 시트 'Sheet2' 를 합쳤습니다.`));
  assert.ok(report.warnings.includes(`${label(SRC2)}: '코드' 시트에 맞는 시트가 없습니다.`) === false);   // 숨긴 시트는 맞춰 보지도 않는다
  const tParts = await unzip(t2);
  const out = await unzip(bytes);
  assert.deepEqual(out.get('xl/worksheets/sheet3.xml'), tParts.get('xl/worksheets/sheet3.xml'));
  noProblems(bytes);
});
await ta('빈 시트 회신 — 합친 수에는 들고 경고, 다른 회신의 행은 그대로', async () => {
  const empty = reply([]);
  const r2 = reply([['이영희', '품질', 1, 1, 1]]);
  const { bytes, report } = await mergeXlsx(tpl, [{ bytes: empty, source: SRC1 }, { bytes: r2, source: SRC2 }]);
  assert.equal(report.merged, 2);
  assert.equal(report.rows, 1);
  assert.ok(report.warnings.includes(`${label(SRC1)}: '조사' 시트에 채운 행이 없습니다.`));
  assert.equal((await gridOf(bytes)).grid[4].A, '이영희');
});
await ta('건너뛰기 — 옛 .xls(OLE)·이름이 .xls·ZIP 아님·xlsx 아닌 ZIP 은 report.skipped 에 까닭, 나머지는 합친다', async () => {
  const ok = reply([['홍', '기술', 1, 1, 1]]);
  const notXlsx = pack([['[Content_Types].xml', '<Types/>'], ['word/document.xml', '<w:document/>']]);
  const { report } = await mergeXlsx(tpl, [
    { bytes: oleBytes(), source: SRC1 },
    { bytes: ok, source: SRC2, name: '옛날.xls' },
    { bytes: enc.encode('not a zip at all, sorry'), source: SRC3 },
    { bytes: notXlsx, source: SRC3 },
    { bytes: ok, source: SRC3, name: '회신.xlsx' },
  ]);
  assert.equal(report.merged, 1);
  assert.equal(report.rows, 1);
  assert.deepEqual(report.skipped.map((s) => s.source), [SRC1, SRC2, SRC3, SRC3]);
  assert.deepEqual(report.skipped.map((s) => s.label), [label(SRC1), label(SRC2), label(SRC3), label(SRC3)]);
  assert.match(report.skipped[0].reason, /옛 형식\(\.xls·\.doc\)이거나 암호·보안\(DRM\)/);
  assert.match(report.skipped[1].reason, /^xls\(엑셀 옛 형식\) 파일은 병합하지 못합니다/);
  assert.equal(report.skipped[2].reason, '엑셀(xlsx) 파일이 아닙니다.');
  assert.match(report.skipped[3].reason, /통합 문서\(workbook\.xml\)가 없습니다/);
  await assert.rejects(mergeXlsx(oleBytes(), []), /양식 파일\(xlsx\)을 읽지 못했습니다 — ZIP 형식이 아닙니다/);
});
await ta('결과는 src/zip.js readZip 으로 읽히는 store ZIP, 첫 항목이 [Content_Types].xml, 손대지 않은 파트는 바이트 그대로', async () => {
  const dTpl = xlsxOf({ sheets: [{ name: '조사', rows: TPL_ROWS }], method: 'deflate' });
  const { bytes } = await mergeXlsx(dTpl, [{ bytes: reply([['홍', '기술', 1, 2, 2]]), source: SRC1 }]);
  const entries = readZip(bytes);
  assert.equal(entries[0].name, '[Content_Types].xml');
  const orig = await unzip(dTpl);
  assert.deepEqual(entries.map((e) => e.name), [...orig.keys()]);
  for (const e of entries) if (e.name !== 'xl/worksheets/sheet1.xml') assert.deepEqual(e.data, orig.get(e.name), e.name);
  noProblems(bytes);
});
await ta('자동 머리 — 손대지 않은 안내·예시·합계 행과 수식만 있는 행은 쌓지 않고, 머리 안을 고친 회신은 경고', async () => {
  const T = [['이름', '금액'], ['예) 홍길동', 1000], [null, { f: 'B2', v: 0 }], [null, { f: 'B3', v: 0 }], null, ['합계', { f: 'SUM(B2:B4)', v: 1000 }]];
  const t2 = xlsxOf({ sheets: [{ name: 'S', rows: T }] });
  // 머리 = 1~2행(이어진 행) — 예시 행까지. 회신은 3·4행에 채우고, 합계 행은 캐시 값만 달라졌다.
  const R = [['이름', '금액'], ['예) 홍길동', 1000], ['김', { f: 'B2', v: 5 }], [null, { f: 'B3', v: 0 }], null, ['합계', { f: 'SUM(B2:B4)', v: 1005 }]];
  const R2 = [['이름(필수)', '금액'], ['예) 홍길동', 1000], ['이', 7]];
  const { bytes, report } = await mergeXlsx(t2, [{ bytes: xlsxOf({ sheets: [{ name: 'S', rows: R }] }), source: SRC1 }, { bytes: xlsxOf({ sheets: [{ name: 'S', rows: R2 }] }), source: SRC2 }]);
  assert.deepEqual(report.sheets, [{ name: 'S', headerRows: 2, rows: 2, sourceCol: 'C' }]);
  const { grid } = await gridOf(bytes);
  assert.deepEqual(grid[3], { A: '김', B: '5', C: label(SRC1) });
  assert.deepEqual(grid[4], { A: '이', B: '7', C: label(SRC2) });
  assert.equal(grid[5], undefined);
  assert.ok(report.warnings.some((w) => w.startsWith("'S' 시트: 머리(1~2행) 안을 고친 회신이 있어") && w.includes(label(SRC2))), report.warnings.join('\n'));
  assert.ok(report.warnings.includes("'S' 시트: 양식의 머리 아래 1개 행(예시·안내·합계 등)은 결과에 넣지 않았습니다."));
  // 숫자로 정하면 그대로 — 머리 1행, 예시 행은 양식과 같으니 여전히 빼고, 고친 머리 행은 회신의 데이터가 아니라 머리다.
  const m1 = await mergeXlsx(t2, [{ bytes: xlsxOf({ sheets: [{ name: 'S', rows: R }] }), source: SRC1 }], { headerRows: 1 });
  assert.deepEqual(m1.report.sheets[0].headerRows, 1);
  assert.deepEqual((await gridOf(m1.bytes)).grid, { 1: { A: '이름', B: '금액', C: '출처' }, 2: { A: '김', B: '5', C: label(SRC1) } });
});
await ta('접두어가 붙은 시트(x:worksheet)·양식만 빈 시트·회신 없음', async () => {
  const t2 = xlsxOf({ sheets: [{ name: 'S', rows: [['이름', '값']] }, { name: '빈', rows: [] }], prefix: 'x' });
  const r = xlsxOf({ sheets: [{ name: 'S', rows: [['이름', '값'], ['가 <1>', 1]] }, { name: '빈', rows: [['자유 글']] }], prefix: 'x', strings: 'inline' });
  const { bytes, report } = await mergeXlsx(t2, [{ bytes: r, source: SRC1 }]);
  const chk = noProblems(bytes);
  const x = chk.text('xl/worksheets/sheet1.xml');
  assert.match(x, /<x:row r="2"><x:c r="A2" t="inlineStr"><x:is><x:t xml:space="preserve">가 &lt;1&gt;<\/x:t><\/x:is><\/x:c><x:c r="B2"><x:v>1<\/x:v><\/x:c><x:c r="C2" t="inlineStr">/);
  assert.match(x, /<x:cols><x:col min="3"/);
  assert.ok(report.warnings.includes("'빈' 시트: 양식이 비어 있어 합치지 않았습니다(양식 그대로 둡니다)."));
  const none = await mergeXlsx(t2, []);
  assert.deepEqual(none.report, { merged: 0, rows: 0, skipped: [], warnings: [], sheets: [{ name: 'S', headerRows: 1, rows: 0, sourceCol: '' }] });
  assert.deepEqual(readZip(none.bytes).map((e) => e.name), [...(await unzip(t2)).keys()]);
});
await ta('글 지키기 — 앞뒤 공백·줄바꿈·꺾쇠·& 와 _x000D_ 꼴은 그대로, 참거짓·오류 값은 형식 유지', async () => {
  const t2 = xlsxOf({ sheets: [{ name: 'S', rows: [['글', '참', '오류']] }] });
  const rx = xlsxOf({ sheets: [{ name: 'S', rows: [['글', '참', '오류'], ['  앞뒤 \n줄 & <a> _x000D_', true, { f: '1/0', v: '#DIV/0!', t: 'str' }]] }] });
  const { bytes } = await mergeXlsx(t2, [{ bytes: rx, source: SRC1 }]);
  const { grid, sheet } = await gridOf(bytes);
  assert.equal(grid[2].A, '  앞뒤 \n줄 & <a> _x000D_');
  assert.equal(grid[2].B, '1');
  assert.match(sheet.xml, /<c r="B2" t="b"><v>1<\/v><\/c>/);
  assert.match(sheet.xml, /<c r="C2" t="inlineStr"><is><t xml:space="preserve">#DIV\/0!<\/t>/);
  noProblems(bytes);
});
await ta('큰 시트(3 회신 × 2000행 × 8열)도 금방', async () => {
  const head = [['번호', 'a', 'b', 'c', 'd', 'e', 'f', 'g']];
  const t2 = xlsxOf({ sheets: [{ name: 'S', rows: head }] });
  const body = Array.from({ length: 2000 }, (_, i) => [i + 1, `가${i}`, i * 2, `나${i % 7}`, i / 3, 'x', 'y', 'z']);
  const r = xlsxOf({ sheets: [{ name: 'S', rows: [...head, ...body] }], method: 'deflate' });
  const t0 = Date.now();
  const { report } = await mergeXlsx(t2, [1, 2, 3].map(() => ({ bytes: r, source: SRC1 })));
  assert.equal(report.rows, 6000);
  assert.ok(Date.now() - t0 < 8000, `${Date.now() - t0}ms`);
});

/* ================================================================ merge.js */
console.log('merge.js — 종류·이름·입구');
t('mergeKind — .xlsx·.docx 만(대소문자 무시), 옛 형식·매크로·서식 파일은 null', () => {
  assert.deepEqual(['양식.xlsx', 'A.DOCX', ' b.xlsx ', '옛.xls', 'c.doc', 'd.xlsm', 'e.dotx', 'f.pdf', '', null].map(mergeKind), ['xlsx', 'docx', 'xlsx', null, null, null, null, null, null, null]);
});
t('mergedName — "제목_병합_YYYYMMDD.확장자", 파일 이름에 못 쓰는 글자는 빼고 길면 자른다', () => {
  const d = new Date(2026, 9, 15, 23, 59);
  assert.equal(mergedName('2026 수요 조사', 'xlsx', d), '2026 수요 조사_병합_20261015.xlsx');
  assert.equal(mergedName('[요청] 자료 제출: 1/2 "긴급"?', 'docx', d), '[요청] 자료 제출 1 2 긴급_병합_20261015.docx');
  assert.equal(mergedName('  끝에 점...  ', 'xlsx', d), '끝에 점_병합_20261015.xlsx');
  assert.equal(mergedName('', 'xlsx', d), '병합_20261015.xlsx');
  assert.equal(mergedName(null, 'docx', d), '병합_20261015.docx');
  assert.equal(mergedName('가'.repeat(200), 'xlsx', d), `${'가'.repeat(80)}_병합_20261015.xlsx`);
  assert.equal(mergedName('CON', 'xlsx', d), '_CON_병합_20261015.xlsx');
  assert.match(mergedName('x', 'xlsx'), /^x_병합_\d{8}\.xlsx$/);
});
await ta('mergeOffice — xlsx 는 MIME 과 report, kind 가 없으면 속을 보고 가린다, 양식이 아니면 던진다', async () => {
  assert.equal(MIME.xlsx, XLSX_MIME);
  assert.equal(XLSX_MIME, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const r = reply([['홍', '기술', 1, 2, 2]]);
  const a = await mergeOffice({ kind: 'xlsx', template: tpl, replies: [{ bytes: r, source: SRC1 }], options: { headerRows: 3 } });
  assert.equal(a.mime, XLSX_MIME);
  assert.equal(a.report.rows, 1);
  assert.equal(a.report.sheets[0].headerRows, 3);
  const b = await mergeOffice({ template: tpl.buffer.slice(tpl.byteOffset, tpl.byteOffset + tpl.byteLength), replies: [{ bytes: r, source: SRC1 }] });
  assert.equal(b.mime, XLSX_MIME);
  assert.equal(b.report.merged, 1);
  await assert.rejects(mergeOffice({ template: enc.encode('x'), replies: [] }), /병합할 수 있는 양식이 아닙니다/);
  await assert.rejects(mergeOffice({ kind: 'xlsx', replies: [] }), /양식 파일이 없습니다/);
  assert.equal(xmlProblem(checkPackage(a.bytes).text('xl/worksheets/sheet1.xml')), '');
});

console.log(`\n${pass} passed`);
