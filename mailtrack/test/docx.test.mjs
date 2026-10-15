// 메일 수신 탭의 워드 양식 병합(mailtrack/ooxml/docx.js) — readDocx, 쌓기(stack: 출처 문단·쪽 나눔·끝의 구역 설정 한 번·그림/링크/메모/각주/
// 책갈피/내용 컨트롤 정리·이름공간 합치기), 표 행 합치기(rows: 머리 한 번·gridSpan 출처 행·회신 행 붙이기·빈 행/양식 그대로인 행 빼기),
// 건너뛰기와 mergeOffice 의 docx 입구. 결과 XML 은 jsdom DOMParser 로 읽어 구조를 본다(검사에서만). 어디에도 보내지 않는다.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { readZip } from '../../src/zip.js';
import { unzip } from '../ooxml/zipread.js';
import { sourceText } from '../ooxml/xml.js';
import { readDocx, mergeDocx, cleanBlocks, tableHeaderRows, DOCX_MIME } from '../ooxml/docx.js';
import { mergeOffice, MIME } from '../ooxml/merge.js';
import { docxOf, xlsxOf, pack, oleBytes, checkPackage, NS } from './fixtures/office.mjs';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const W = NS.w;
const { DOMParser } = new JSDOM('').window;
const SRC1 = { org: 'foo.com', name: '홍길동', address: 'hong@foo.com', date: '2026-10-14' };
const SRC2 = { org: 'bar.co.kr', name: '이영희', address: 'lee@bar.co.kr', date: '2026-10-15' };
const label = (s) => sourceText(s);

/** 결과 묶음을 검사하고(문제 없음) 본문을 DOM 으로 — body 의 자식들과 글 도우미. */
function open(bytes) {
  const chk = checkPackage(bytes);
  assert.deepEqual(chk.problems, [], chk.problems.join('\n'));
  const xml = chk.text('word/document.xml');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const kids = [...body.children];
  const all = (local) => [...doc.getElementsByTagNameNS(W, local)];
  const textOf = (el) => [...el.getElementsByTagNameNS(W, 't')].map((x) => x.textContent).join('');
  // 본문이 쓰는 관계 id 는 모두 document.xml.rels 에 있어야 한다(끊긴 참조 없음).
  const rels = chk.text('word/_rels/document.xml.rels');
  for (const m of xml.matchAll(/\s[\w.-]+:(?:id|embed|link)="([^"]+)"/g)) assert.ok(rels.includes(`Id="${m[1]}"`), `없는 관계 ${m[1]}`);
  return { chk, xml, doc, body, kids, all, textOf };
}

/* ================================================================ readDocx */
console.log('readDocx');
await ta('본문 블록(문단·표·그 밖)과 끝의 구역 설정, 워드가 아니면 던진다', async () => {
  const d = await readDocx(docxOf({ blocks: [{ p: '가' }, { tbl: { header: [['a']], rows: [['1']] } }, { sdt: '나' }] }));
  assert.deepEqual(d.blocks.map((b) => b.kind), ['p', 'tbl', 'other']);
  assert.equal(d.blocks[2].local, 'sdt');
  assert.match(d.sectPr, /^<w:sectPr w:rsidR="00A1B2C3"><w:headerReference/);
  assert.equal(d.path, 'word/document.xml');
  assert.equal((await readDocx(docxOf({ blocks: [{ p: '가' }], sectPr: false }))).sectPr, '');
  await assert.rejects(readDocx(xlsxOf({ sheets: [{ name: 'S', rows: [['a']] }] })), /워드\(docx\) 파일이 아닙니다 — 본문\(document\.xml\)이 없습니다/);
});

/* ================================================================ stack */
console.log('mergeDocx stack — 회신 본문 쌓기');
const tpl = docxOf({ blocks: [{ p: '양식 안내 — 아래를 채워 주세요' }, { tbl: { header: [['항목', '내용']], rows: [['', '']] } }] });
const rich = docxOf({ blocks: [
  { p: '회신 1 본문' }, { img: true }, { link: '누리집 주소' }, { tbl: { header: [['항목', '내용']], rows: [['예산', '100']] } },
  { sdt: '컨트롤 안 글' }, { note: '메모 달린 글' }, { sect: '구역 글' }, { shape: true },
] });

await ta('출처 문단(굵게·keepNext) + 회신 본문, 회신 사이 쪽 나눔 하나, 양식의 sectPr 은 끝에 한 번, 양식 본문은 빠진다', async () => {
  const r2 = docxOf({ blocks: [{ p: '회신 2 본문' }], method: 'deflate' });
  const { bytes, report } = await mergeDocx(tpl, [{ bytes: rich, source: SRC1 }, { bytes: r2, source: SRC2 }]);
  assert.equal(report.merged, 2);
  assert.equal(report.mode, 'stack');
  assert.equal(report.rows, undefined);
  assert.deepEqual(report.skipped, []);
  const { kids, all, textOf, xml } = open(bytes);
  const srcParas = kids.filter((k) => k.localName === 'p' && textOf(k).startsWith('출처: '));
  assert.deepEqual(srcParas.map(textOf), [`출처: ${label(SRC1)}`, `출처: ${label(SRC2)}`]);
  assert.equal(kids[0], srcParas[0]);
  assert.equal(srcParas[0].getElementsByTagNameNS(W, 'keepNext').length, 1);
  assert.equal(srcParas[0].getElementsByTagNameNS(W, 'b').length, 1);
  const breaks = all('br').filter((b) => b.getAttributeNS(W, 'type') === 'page');
  assert.equal(breaks.length, 1);
  // 쪽 나눔 문단은 둘째 출처 문단 바로 앞
  assert.equal(kids[kids.indexOf(srcParas[1]) - 1], breaks[0].parentNode.parentNode);
  assert.equal(all('sectPr').length, 1);
  assert.equal(kids.at(-1).localName, 'sectPr');
  assert.equal(kids.at(-2).localName, 'p');
  assert.doesNotMatch(xml, /양식 안내/);
  const text = kids.map(textOf).join('|');
  for (const s of ['회신 1 본문', '누리집 주소', '예산', '컨트롤 안 글', '메모 달린 글', '구역 글', '도형 뒤', '회신 2 본문']) assert.ok(text.includes(s), s);
  assert.ok(text.indexOf('회신 1 본문') < text.indexOf('회신 2 본문'));
});
await ta('정리 — 그림·도형은 [그림 생략], 하이퍼링크는 글만, 메모·각주 참조·책갈피·내용 컨트롤·문단 안 sectPr·paraId 는 지운다(경고)', async () => {
  const { bytes, report } = await mergeDocx(tpl, [{ bytes: rich, source: SRC1 }]);
  const { doc, all, textOf, xml, kids } = open(bytes);
  assert.equal([...xml.matchAll(/\[그림 생략\]/g)].length, 2);
  for (const local of ['drawing', 'pict', 'object', 'hyperlink', 'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'commentReference', 'footnoteReference', 'sdt', 'sdtPr', 'sdtContent']) {
    assert.equal(all(local).length, 0, local);
  }
  assert.equal(doc.getElementsByTagNameNS(NS.mc, 'AlternateContent').length, 0);
  assert.doesNotMatch(xml, /paraId|textId/);
  assert.doesNotMatch(xml, /rId20|rId21/);   // 그림·링크 관계는 회신 것이라 남지 않는다
  // 그림은 원래 런 안에 있었다 — 런 안의 w:t 로 바뀌어 문단 구조가 맞다.
  const pic = all('t').find((x) => x.textContent === '[그림 생략]');
  assert.equal(pic.parentNode.localName, 'r');
  assert.equal(pic.parentNode.parentNode.localName, 'p');
  const linkP = kids.find((k) => textOf(k) === '누리집 주소');
  assert.equal(linkP.getElementsByTagNameNS(W, 'rStyle')[0].getAttributeNS(W, 'val'), 'Hyperlink');
  assert.deepEqual(report.warnings, [
    `${label(SRC1)}: 그림·개체 2개는 '[그림 생략]' 로 바꿨습니다.`,
    `${label(SRC1)}: 각주·미주 1개는 뺐습니다.`,
    `${label(SRC1)}: 메모 1개는 뺐습니다.`,
  ]);
});
t('cleanBlocks — 자리에 맞는 그림 대체(런 안·문단 안·블록 자리)', () => {
  const stat = { pictures: 0, notes: 0, comments: 0 };
  assert.equal(cleanBlocks('<w:p><w:r><w:pict/></w:r></w:p>', 'w:', 'body', stat), '<w:p><w:r><w:t xml:space="preserve">[그림 생략]</w:t></w:r></w:p>');
  assert.equal(cleanBlocks('<w:p><mc:AlternateContent><mc:Choice><w:r><w:drawing/></w:r></mc:Choice></mc:AlternateContent></w:p>', 'w:', 'body', stat), '<w:p><w:r><w:t xml:space="preserve">[그림 생략]</w:t></w:r></w:p>');
  assert.equal(cleanBlocks('<w:object/>', 'w:', 'body', stat), '<w:p><w:r><w:t xml:space="preserve">[그림 생략]</w:t></w:r></w:p>');
  assert.equal(stat.pictures, 3);
  // 그림이 없는 AlternateContent(글자 효과 등)는 그대로
  assert.equal(cleanBlocks('<w:r><mc:AlternateContent><mc:Choice Requires="w14"><w:t>a</w:t></mc:Choice></mc:AlternateContent></w:r>', 'w:'), '<w:r><mc:AlternateContent><mc:Choice Requires="w14"><w:t>a</w:t></mc:Choice></mc:AlternateContent></w:r>');
  assert.equal(cleanBlocks('<w:p w14:paraId="1" w:rsidR="2"/>', 'w:'), '<w:p w:rsidR="2"/>');
});
await ta('글상자 — 그림 대신 그 안의 글을 "[글상자] 글" 로 한 번만(Choice·Fallback 두 벌을 겹치지 않게), 경고는 따로', async () => {
  const r = docxOf({ blocks: [{ p: '앞' }, { box: '글상자에 쓴 답 & <값>' }] });
  const { bytes, report } = await mergeDocx(tpl, [{ bytes: r, source: SRC1 }]);
  const { all, xml } = open(bytes);
  const ts = all('t').map((x) => x.textContent).filter((x) => x.startsWith('[글상자]'));
  assert.deepEqual(ts, ['[글상자] 글상자에 쓴 답 & <값> / 둘째 줄']);
  assert.equal(ts.length, 1);
  assert.equal(all('txbxContent').length, 0);
  assert.doesNotMatch(xml, /\[그림 생략\]/);
  assert.deepEqual(report.warnings, [`${label(SRC1)}: 글상자 1개는 글만 '[글상자] …' 로 남겼습니다.`]);
});
await ta('이름공간 — 회신 뿌리에만 있는 xmlns(w15)와 mc:Ignorable 을 결과 뿌리에 더한다', async () => {
  const r = docxOf({ blocks: [{ w15: '새 기능 글' }], w15: true });
  const { bytes } = await mergeDocx(tpl, [{ bytes: r, source: SRC1 }]);
  const { xml, textOf, kids } = open(bytes);
  assert.match(xml, /<w:document [^>]*mc:Ignorable="w14 w15"[^>]* xmlns:w15="http:\/\/schemas\.microsoft\.com\/office\/word\/2012\/wordml">/);
  assert.ok(kids.some((k) => textOf(k) === '새 기능 글'));
});
await ta('회신 본문이 표로 끝나면 끝에 빈 문단, 본문이 빈 회신은 경고', async () => {
  const r = docxOf({ blocks: [{ tbl: { header: [['a', 'b']], rows: [['1', '2']] } }] });
  const empty = docxOf({ blocks: [] });
  const { bytes, report } = await mergeDocx(tpl, [{ bytes: empty, source: SRC2 }, { bytes: r, source: SRC1 }]);
  const { kids } = open(bytes);
  assert.deepEqual(kids.slice(-3).map((k) => k.localName), ['tbl', 'p', 'sectPr']);
  assert.ok(report.warnings.includes(`${label(SRC2)}: 본문이 비어 있습니다.`));
});
await ta('손대지 않은 파트는 바이트 그대로, 첫 항목은 [Content_Types].xml, 양식의 머리글 관계는 끝의 sectPr 이 그대로 가리킨다', async () => {
  const dTpl = docxOf({ blocks: [{ p: '양식' }], method: 'deflate' });
  const { bytes } = await mergeDocx(dTpl, [{ bytes: rich, source: SRC1 }]);
  const entries = readZip(bytes);
  const orig = await unzip(dTpl);
  assert.deepEqual(entries.map((e) => e.name), [...orig.keys()]);
  assert.equal(entries[0].name, '[Content_Types].xml');
  for (const e of entries) if (e.name !== 'word/document.xml') assert.deepEqual(e.data, orig.get(e.name), e.name);
  assert.match(open(bytes).xml, /<w:sectPr w:rsidR="00A1B2C3"><w:headerReference w:type="default" r:id="rId22"\/>/);
});
await ta('기본 이름공간만 쓰는 양식 — 새 요소는 xmlns:w 를 새로 묶어 쓴다', async () => {
  const doc = `<?xml version="1.0" encoding="UTF-8"?><document xmlns="${W}"><body><p><r><t>양식</t></r></p><sectPr/></body></document>`;
  const t2 = pack([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="${'http://schemas.openxmlformats.org/package/2006/relationships'}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/word/document.xml"/></Relationships>`],
    ['word/document.xml', doc],
  ]);
  const { bytes } = await mergeDocx(t2, [{ bytes: docxOf({ blocks: [{ p: '회신' }] }), source: SRC1 }]);
  const chk = checkPackage(bytes);
  assert.deepEqual(chk.problems, []);
  const x = chk.text('word/document.xml');
  assert.match(x, /^<\?xml version="1.0" encoding="UTF-8"\?><document xmlns="[^"]+" xmlns:w="[^"]+"/);
  const d = new DOMParser().parseFromString(x, 'application/xml');
  const ps = [...d.getElementsByTagNameNS(W, 'p')];
  assert.equal(ps[0].getElementsByTagNameNS(W, 't')[0].textContent, `출처: ${label(SRC1)}`);
  assert.equal(d.getElementsByTagNameNS(W, 'sectPr').length, 1);
});

/* ================================================================ rows */
console.log('mergeDocx rows — 표 행 합치기');
const HDR = [['이름', '부서', '비고']];
const tplRows = docxOf({ blocks: [
  { p: '아래 표를 채워 주세요' },
  { tbl: { header: HDR, rows: [['예) 홍길동', '기술', ''], ['', '', '']] } },
  { p: '두 번째 표' },
  { tbl: { header: [['장비']], rows: [['']], mark: false } },
] });
const rowsR1 = docxOf({ blocks: [
  { p: '회신자가 고친 안내' },
  { tbl: { header: HDR, rows: [['예) 홍길동', '기술', ''], ['김철수', '영업', '메모'], ['', '', ''], ['박', '품질', ''], ['', ' ', '']] } },
  { p: '두 번째 표' },
  { tbl: { header: [['장비']], rows: [['현미경'], ['저울']], mark: false } },
] });
const rowsR2 = docxOf({ blocks: [{ tbl: { header: HDR, rows: [['이영희', '연구', '']] } }], method: 'deflate' });

await ta('머리 행은 한 번, 회신마다 gridSpan 출처 행 + 채운 행(빈 행·양식 그대로인 예시 행은 뺀다), 표 밖 문단은 양식 것', async () => {
  const { bytes, report } = await mergeDocx(tplRows, [{ bytes: rowsR1, source: SRC1 }, { bytes: rowsR2, source: SRC2 }], { mode: 'rows' });
  assert.equal(report.mode, 'rows');
  assert.equal(report.merged, 2);
  assert.equal(report.rows, 5);
  assert.deepEqual(report.warnings, [`${label(SRC2)}: 2번째 표가 없습니다.`]);
  const { kids, textOf } = open(bytes);
  assert.deepEqual(kids.map((k) => k.localName), ['p', 'tbl', 'p', 'tbl', 'sectPr']);
  assert.equal(textOf(kids[0]), '아래 표를 채워 주세요');
  const rowsOf = (tbl) => [...tbl.children].filter((c) => c.localName === 'tr');
  const cellsText = (tr) => [...tr.children].filter((c) => c.localName === 'tc').map(textOf);
  const t1 = rowsOf(kids[1]);
  assert.deepEqual(t1.map(cellsText), [
    ['이름', '부서', '비고'],
    [`출처: ${label(SRC1)}`],
    ['김철수', '영업', '메모'],
    ['박', '품질', ''],
    [`출처: ${label(SRC2)}`],
    ['이영희', '연구', ''],
  ]);
  assert.equal(t1[0].getElementsByTagNameNS(W, 'tblHeader').length, 1);
  const span = t1[1].getElementsByTagNameNS(W, 'gridSpan')[0];
  assert.equal(span.getAttributeNS(W, 'val'), '3');
  assert.equal(t1[1].getElementsByTagNameNS(W, 'b').length, 1);
  assert.equal(kids[1].getElementsByTagNameNS(W, 'tblGrid').length, 1);
  const t2 = rowsOf(kids[3]);
  assert.deepEqual(t2.map(cellsText), [['장비'], [`출처: ${label(SRC1)}`], ['현미경'], ['저울']]);
  assert.equal(t2[1].getElementsByTagNameNS(W, 'gridSpan').length, 0);   // 한 칸짜리 표는 gridSpan 없이
});
await ta('머리 행 수 — tblHeader 가 이어진 행 수(없으면 1), 숫자를 주면 그대로', async () => {
  const d = await readDocx(docxOf({ blocks: [{ tbl: { header: [['a'], ['b']], rows: [['1']] } }, { tbl: { header: [['x']], rows: [['1']], mark: false } }] }));
  const { children: kidsOf, rootOf } = await import('../ooxml/xml.js');
  const rows = (raw) => kidsOf(raw, rootOf(raw).openEnd).filter((k) => k.local === 'tr');
  assert.equal(tableHeaderRows(rows(d.blocks[0].raw)), 2);
  assert.equal(tableHeaderRows(rows(d.blocks[1].raw)), 1);
  assert.equal(tableHeaderRows(rows(d.blocks[1].raw), 5), 2);
  // 숫자 2 로 합치면 예시 행까지 머리, 회신의 3번째 행부터 붙인다.
  const { bytes, report } = await mergeDocx(tplRows, [{ bytes: rowsR1, source: SRC1 }], { mode: 'rows', headerRows: 2 });
  const { kids, textOf } = open(bytes);
  const t1 = [...kids[1].children].filter((c) => c.localName === 'tr').map(textOf);
  assert.deepEqual(t1, ['이름부서비고', '예) 홍길동기술', `출처: ${label(SRC1)}`, '김철수영업메모', '박품질']);
  // 숫자는 모든 표에 같이 — 둘째 표도 머리 2행(장비 · 빈 행)이라 회신의 '현미경'(2행)은 머리 자리, '저울'만 붙는다.
  assert.equal(report.rows, 3);
  assert.deepEqual([...kids[3].children].filter((c) => c.localName === 'tr').map(textOf), ['장비', '', `출처: ${label(SRC1)}`, '저울']);
});
await ta('양식에 표가 없으면 쌓기로 합치고 경고, 채운 행이 없는 회신 표는 출처 행도 넣지 않는다', async () => {
  const noTable = docxOf({ blocks: [{ p: '표 없음' }] });
  const a = await mergeDocx(noTable, [{ bytes: rowsR2, source: SRC1 }], { mode: 'rows' });
  assert.equal(a.report.mode, 'stack');
  assert.ok(a.report.warnings.includes('양식에 표가 없어 쌓기(stack)로 합쳤습니다.'));
  open(a.bytes);
  // 양식 그대로인 행은 같은 자리일 때만 뺀다(자리를 옮긴 예시 행은 채운 행으로 본다).
  const blank = docxOf({ blocks: [{ tbl: { header: HDR, rows: [['예) 홍길동', '기술', ''], ['', '', '']] } }] });
  const b = await mergeDocx(tplRows, [{ bytes: blank, source: SRC2 }], { mode: 'rows' });
  assert.equal(b.report.rows, 0);
  assert.deepEqual(b.report.warnings, [`${label(SRC2)}: 1번째 표에 채운 행이 없습니다.`, `${label(SRC2)}: 2번째 표가 없습니다.`]);
  const { kids, textOf } = open(b.bytes);
  assert.deepEqual([...kids[1].children].filter((c) => c.localName === 'tr').map(textOf), ['이름부서비고']);
});

/* ================================================================ 건너뛰기 · 입구 */
console.log('건너뛰기 · mergeOffice');
await ta('옛 .doc(OLE)·이름이 .doc·엑셀 파일은 report.skipped 에 까닭, 회신이 하나도 없으면 양식 그대로', async () => {
  const { bytes, report } = await mergeDocx(tpl, [
    { bytes: oleBytes(), source: SRC1 },
    { bytes: rich, source: SRC2, name: '회신.doc' },
    { bytes: xlsxOf({ sheets: [{ name: 'S', rows: [['a']] }] }), source: SRC2 },
  ]);
  assert.equal(report.merged, 0);
  assert.deepEqual(report.skipped.map((s) => s.source), [SRC1, SRC2, SRC2]);
  assert.match(report.skipped[0].reason, /옛 형식\(\.xls·\.doc\)이거나 암호·보안\(DRM\)이 걸린 파일이라 병합하지 못합니다 — 워드\(docx\) 로/);
  assert.match(report.skipped[1].reason, /^doc\(워드 옛 형식\) 파일은 병합하지 못합니다/);
  assert.equal(report.skipped[2].reason, '워드(docx) 파일이 아닙니다 — 본문(document.xml)이 없습니다.');
  assert.deepEqual(report.warnings, ['합칠 회신이 없어 양식을 그대로 돌려줍니다.']);
  const orig = await unzip(tpl);
  for (const e of readZip(bytes)) assert.deepEqual(e.data, orig.get(e.name), e.name);
  await assert.rejects(mergeDocx(oleBytes(), []), /양식 파일\(docx\)을 읽지 못했습니다/);
});
await ta('mergeOffice — docx MIME, options.mode·sourceLabel 이 전해지고, kind 가 없으면 속을 보고 가린다', async () => {
  assert.equal(MIME.docx, DOCX_MIME);
  assert.equal(DOCX_MIME, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const a = await mergeOffice({ kind: 'docx', template: tplRows, replies: [{ bytes: rowsR2, source: SRC1 }], options: { mode: 'rows', sourceLabel: '보낸 곳' } });
  assert.equal(a.mime, DOCX_MIME);
  assert.equal(a.report.mode, 'rows');
  assert.equal(a.report.rows, 1);
  assert.match(open(a.bytes).xml, /보낸 곳: foo\.com/);
  const b = await mergeOffice({ template: tpl, replies: [{ bytes: rich, source: SRC1 }] });
  assert.equal(b.mime, DOCX_MIME);
  assert.equal(b.report.mode, 'stack');
});

console.log(`\n${pass} passed`);
