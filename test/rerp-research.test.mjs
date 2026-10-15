// kr_ext_rerp `tests/research.test.js` 를 ESM 으로 옮긴 것 — rerp/research.js · rerp/researchsync.js · rerp/onenote.js 를 읽고, help-server/classify.js 검사는 뺐다(이 저장소에 없음). 출처·갱신 규칙은 rerp/README.md.
// 실행: node test/rerp-research.test.mjs (npm test 에 듦)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import R from '../rerp/research.js';
import RSY from '../rerp/researchsync.js';
import O from '../rerp/onenote.js';
import * as YAML from '../vendor/yaml/index.js';
let n = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); n++; console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.stack || e.message); process.exitCode = 1; } };

// 2026-10-14 패널 캐시의 내 참여 과제 (storage.local.projectList)
const PROJECTS = [
  { prjNo: '2026-0063-01', prjNm: 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발', anl: '1' },
  { prjNo: '2026-0064-01', prjNm: '선박용 수소 엔진-연료전지 하이브리드 추진 시스템 개발 및 해상 실증', anl: '1' },
  { prjNo: '0040-8970-01', prjNm: '전기차 해상운송 중 화재예방을 위한 SOC 기준 설정 및 가이드라인 개발', anl: '3' },
  { prjNo: '0043-0630-01', prjNm: '대용량 모듈러 멀티레벨 컨버터 기반 고압 드라이브 시제품 개발', anl: '3' },
  { prjNo: '0045-7370-01', prjNm: '친환경 선박용 암모니아 수소추출기 통합형 100kW급 PEMFC 시스템 개발', anl: '3' },
];

// 실제 1차년도 스냅샷(MW급 KR_…_r2.yaml)의 모양을 줄인 것
const SNAP = `# [재생성 r2]
# 변경분: 연구활동비 조정

meta:
  과제명: MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발
  차년도: 1차년도                      # 주석
  협약일: "2026-05-22"
  기간: "2026-04 ~ 2029-12"
  연구개발과제번호: RS-2026-25547199
  rev: r2
  표지:
    중앙행정기관: 산업통상부
    사업명: {세부: 조선해양산업기술개발사업, 내역: 친환경선박전주기핵심기술개발}
    주관연구개발기관: {기관명: 인텍전기전자, 기관유형: 중소기업}
    KR:
      역할: 공동
      책임자: 김거화

연구개발내용:
  목표:
    - 연차: 1차년도
      개발목표:
        - 선급규정·국제표준 간 규정 공백 분석 및 평가 기준 도출
        - 규정·표준 도메인 분석 및 용어 분류 체계 설계
      개발내용:
        - 항목: 선급규정·국제표준 간 규정 공백 분석 및 평가 기준 도출
          세부:
            - 선급규정 및 국제표준 비교·분석을 통한 규정 공백 도출
        - 항목: 규정·표준 도메인 분석 및 용어 분류 체계 설계
          세부: [SSCB 관련 표준·규정의 도메인 분석]
    - 연차: 2차년도
      개발목표: [다른 해 목표]
  성능목표:
    - 평가항목: SSCB 규정 공백 분석
      단위: 건
      목표치: {1차년도: 1, 2차년도: "–"}
      평가방법: 자체평가
    - 평가항목: 다른 해만
      목표치: {1차년도: "–", 3차년도: 2}
  수행일정:
    - 연차: 1차년도
      기간개월: 9
      항목:
        - {개발내용: 선급규정·국제표준 간 규정 공백 분석 및 평가 기준 도출, 기간주: 32, 착수월: null, 종료월: null}
  주요결과물:
    - 연차: 1차년도
      결과물:
        - 선급규정·국제표준 간 규정 공백 분석 및 평가 기준 도출
        - 규정·표준 도메인 분석 및 용어 분류 체계 설계

예산:
  단위: 천원
  비목별:
    - 연차: 1차년도
      직접비:
        인건비: 31425
        연구시설장비비: 0
        연구활동비: 58700
        소계: 90125
      간접비: 23629
      총액: 120000
  참여연구자인건비:
    - 연차: 1차년도
      참여자:
        - {성명: 김거화, 직위: 수석, 계상률: 20, 참여기간_개월: 9}
  세부사용계획:
    - {연차: 1차년도, 명칭: 회의비, 방식: null, 수량: 10, 금액: 3000, 사용기간: "26.4~12"}
    - {연차: 1차년도, 명칭: "AI구독, PDF구독, LLM API(소프트웨어 활용비)", 방식: 임대, 수량: 5, 금액: 18000}
    - {연차: 2차년도, 명칭: 다른 해, 금액: 1}
`;

(async () => {
  const read = (text, file) => R.readSnapshot(YAML.parse(text), { text, file, now: 1 });

  await test('스냅샷: 그 차년도 몫만 읽고 금액은 천원 → 원', () => {
    const rec = read(SNAP, 'KR_x_r2.yaml');
    assert.equal(rec.name, 'MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발');
    assert.equal(rec.n, 1);
    assert.equal(rec.rev, 'r2');
    assert.equal(rec.tag, '재생성 r2');
    assert.equal(rec.code, 'RS-2026-25547199');
    assert.equal(rec.role, '공동');
    assert.equal(rec.lead, '김거화');
    assert.equal(rec.note, '산업통상부 · 조선해양산업기술개발사업 · 주관 인텍전기전자');
    assert.deepEqual(rec.goals, ['선급규정·국제표준 간 규정 공백 분석 및 평가 기준 도출', '규정·표준 도메인 분석 및 용어 분류 체계 설계']);
    assert.equal(rec.contents.length, 2);
    assert.deepEqual(rec.contents[1].details, ['SSCB 관련 표준·규정의 도메인 분석']);
    assert.deepEqual(rec.perf, [{ name: 'SSCB 규정 공백 분석', target: '1', unit: '건', method: '자체평가' }]);
    assert.deepEqual(rec.schedule, { months: 9, items: [{ name: '선급규정·국제표준 간 규정 공백 분석 및 평가 기준 도출', weeks: 32, from: 0, to: 0 }] });
    assert.deepEqual(rec.spend.map((s) => [s.name, s.method, s.qty, s.amount]), [['회의비', '', 10, 3000000], ['AI구독, PDF구독, LLM API(소프트웨어 활용비)', '임대', 5, 18000000]]);
    assert.deepEqual(rec.budget, [{ item: '인건비', plan: 31425000 }, { item: '연구활동비', plan: 58700000 }, { item: '간접비', plan: 23629000 }]);
    assert.deepEqual(rec.roster, [{ name: '김거화', pos: '수석', rate: 20, months: 9 }]);
    assert.equal(R.spendTotal(rec), 21000000);
  });

  await test('글: 결과물이 개발내용과 같으면 빼고, 세부사용계획 계를 붙인다', () => {
    const t = R.textOf(read(SNAP));
    assert.ok(t.includes('■ 개발목표\n1. 선급규정'));
    assert.ok(!t.includes('■ 주요결과물'));
    assert.ok(t.includes('- 회의비 × 10 · 3,000,000원 · 26.4~12'));
    assert.ok(t.includes('계 21,000,000원'));
    assert.equal(R.summary(read(SNAP)), '1차년도 r2 · 목표 2 · 연구활동비 계획 2건');
  });

  await test('종류: 스냅샷 · history · 모르는 것, 스냅샷이 아니면 읽기에서 throw', () => {
    assert.equal(R.kindOf(YAML.parse(SNAP)), 'snapshot');
    assert.equal(R.kindOf(YAML.parse('project: SSCB\nrevisions: []')), 'history');
    assert.equal(R.kindOf(YAML.parse('entity: budget\nitems: []')), 'history');
    assert.equal(R.kindOf(YAML.parse('a: 1')), '');
    assert.throws(() => R.readSnapshot({ meta: {} }), /meta\.과제명/);
  });

  await test('잇기: 이름이 같으면 그 과제, 조금 달라도(100kW급) 가장 비슷한 과제 하나', () => {
    assert.equal(R.match('MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발', PROJECTS).prjNo, '2026-0063-01');
    assert.equal(R.match('선박용 수소 엔진-연료전지 하이브리드 추진 시스템 개발 및 해상 실증', PROJECTS).prjNo, '2026-0064-01');
    const pemfc = R.match('친환경 선박용 암모니아 수소추출기 통합형 PEMFC 시스템 개발', PROJECTS);
    assert.equal(pemfc.prjNo, '0045-7370-01');
    assert.ok(pemfc.score < 1);
    assert.equal(R.match('전혀 다른 과제 이름', PROJECTS), null);
    // projectList 와 패널 캐시를 합쳐 같은 과제가 둘 와도 하나로 본다
    assert.equal(R.match('친환경 선박용 암모니아 수소추출기 통합형 PEMFC 시스템 개발', PROJECTS.concat(PROJECTS)).prjNo, '0045-7370-01');
  });

  await test('넣기: 더 오래된 판은 넣지 않고, 손으로 고른 연결은 다시 넣어도 남는다', () => {
    const map = {};
    const r2 = read(SNAP);
    assert.equal(R.put(map, r2).state, 'added');
    assert.equal(R.link(map, PROJECTS), 1);
    assert.equal(map[r2.id].prjNo, '2026-0063-01');
    assert.equal(map[r2.id].linkBy, 'auto');
    const r0 = read(SNAP.replace('rev: r2', 'rev: r0'));
    assert.equal(R.put(map, r0).state, 'older');
    assert.equal(map[r2.id].rev, 'r2');
    Object.assign(map[r2.id], { prjNo: '0040-8970-01', prjNm: 'x', linkBy: 'user' });
    assert.equal(R.put(map, read(SNAP)).state, 'updated');
    assert.equal(R.link(map, PROJECTS), 0);
    assert.equal(map[r2.id].prjNo, '0040-8970-01');
  });

  await test('연차 고르기: ERP 연차와 같은 차년도 → 앞선 차년도 → 가장 늦은 것', () => {
    const map = {};
    const y1 = read(SNAP), y2 = read(SNAP.replace('차년도: 1차년도', '차년도: 2차년도'));
    R.put(map, y1); R.put(map, y2); R.link(map, PROJECTS);
    assert.notStrictEqual(y1.id, y2.id);
    assert.equal(R.forProject(map, '2026-0063-01', '1').n, 1);
    assert.equal(R.forProject(map, '2026-0063-01', '2').n, 2);
    assert.equal(R.forProject(map, '2026-0063-01', '5').n, 2);
    assert.equal(R.forProject(map, '2026-0063-01', '').n, 2);
    assert.equal(R.forProject(map, '0043-0630-01', '3'), null);
    assert.equal(R.countFor(map, '2026-0063-01'), 2);
  });

  await test('자동 분류 근거: 목표·개발내용 항목·세부사용계획만', () => {
    const ref = R.refOf(read(SNAP));
    assert.equal(ref.year, '1차년도');
    assert.equal(ref.goals.length, 2);
    assert.deepEqual(ref.contents, ['선급규정·국제표준 간 규정 공백 분석 및 평가 기준 도출', '규정·표준 도메인 분석 및 용어 분류 체계 설계']);
    assert.deepEqual(ref.spend[1], { name: 'AI구독, PDF구독, LLM API(소프트웨어 활용비)', kind: '', method: '임대', amount: 18000000 });
    assert.equal(R.refOf(null), null);
  });

  /* ---------- 원노트 공유 (lib/research-sync.js) ---------- */
  // tests/plan-sync.test.js 의 fakeOneNote 와 같은 모양 — 메모리 페이지 저장소, findBlock·pageTitle 은 진짜(lib/plus-onenote.js)
  function fakeOneNote() {
    const pages = {};
    let seq = 0;
    const calls = [];
    return {
      calls, pages,
      listSectionPages: async (c, sectionId) => { calls.push('list'); return Object.entries(pages).filter(([, p]) => p.sectionId === sectionId).map(([pageId, p]) => ({ pageId, title: p.title, webUrl: `web:${pageId}`, sectionId })); },
      syncDb: async () => { calls.push('syncDb'); },
      createPage: async (c, sectionId, title, html) => { calls.push('create:' + title); const pageId = `pg${++seq}`; pages[pageId] = { title, sectionId, html: `<html><head><title>${title}</title></head><body>${html.replace('<table ', `<table id="table:{x}{${seq}}" `)}</body></html>` }; return { pageId, title, webUrl: `web:${pageId}` }; },
      readPage: async (c, pageId) => { calls.push('read:' + pageId); if (!pages[pageId]) throw Object.assign(new Error('없는 페이지'), { kind: 'tool' }); return pages[pageId].html; },
      pageTitle: O.pageTitle, findBlock: O.findBlock,
      writeBlock: async (c, pageId, dataId, html, block) => { calls.push((block ? 'replace:' : 'append:') + pageId); const p = pages[pageId]; const withId = html.replace('<table ', `<table id="table:{x}{${++seq}}" `); p.html = block ? p.html.replace(block.html, withId) : p.html.replace('</body>', withId + '</body>'); },
    };
  }
  const linked = () => { const m = {}; R.put(m, read(SNAP)); R.put(m, read(SNAP.replace('차년도: 1차년도', '차년도: 2차년도'))); R.link(m, PROJECTS); return Object.values(m); };

  await test('원노트 표: 차년도마다 절 줄 · 받는 쪽 칸은 빼고 · base64 로 되읽힘', () => {
    const recs = linked();
    assert.ok(recs.every((r) => r.prjNo));
    const html = RSY.serialize({ name: recs[0].name, code: recs[0].code, recs, at: 5, by: '김거화' });
    assert.ok(html.startsWith('<table data-id="krx-research"'));
    assert.ok(!/<div/.test(html), 'div 없음 (Graph replace 제약)');
    assert.ok(html.includes('<td><b>1차년도 r2</b></td>') && html.includes('<td><b>2차년도 r2</b></td>'));
    assert.ok(html.includes('<td>연구활동비 세부사용계획</td><td>- 회의비 × 10 · 3,000,000원 · 26.4~12<br/>'));
    assert.ok(html.includes('&nbsp;&nbsp;· SSCB 관련'), '세부 들여쓰기');
    // OneNote 가 줄을 나누고 span 으로 감싸도 읽힌다
    const inner = O.findBlock(html.replace(/(krxres1:[A-Za-z0-9+/=]{40})/, '$1<span>\n</span>'), RSY.BLOCK).inner;
    const back = RSY.parse(inner);
    assert.equal(back.at, 5);
    assert.equal(back.by, '김거화');
    assert.equal(back.recs.length, 2);
    assert.deepEqual(back.recs[0].spend, recs.find((r) => r.n === 1).spend);
    assert.ok(back.recs.every((r) => !('prjNo' in r) && !('linkBy' in r)));
    assert.equal(RSY.parse('<td>그냥 표</td>'), null);
    assert.equal(RSY.nameOfTitle(RSY.titleFor('  MW급 과제 ')), 'MW급 과제');
    assert.equal(RSY.linkText({ webUrl: 'https://x', pageId: '1-ab' }), 'https://x\n[연구내용 페이지 ID] 1-ab');
  });

  await test('올리기: 없으면 만들고, 다음엔 그 표를 바꾸고, 지워졌으면 섹션에서 제목으로 다시 찾는다', async () => {
    const fake = fakeOneNote();
    const recs = linked();
    const a = await RSY.publish({ client: {}, onenote: fake, sectionId: 'S', page: null, name: recs[0].name, code: recs[0].code, recs: recs.slice(0, 1), now: 1 });
    assert.equal(a.created, true);
    assert.equal(a.title, '[연구내용] MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발');
    assert.ok(fake.calls.includes('syncDb'), '만들기 전에 목록을 새로 받음');
    const b = await RSY.publish({ client: {}, onenote: fake, sectionId: 'S', page: a, name: recs[0].name, recs, now: 2 });
    assert.equal(b.created, false);
    assert.equal(b.pageId, a.pageId);
    assert.ok(fake.calls.includes('replace:' + a.pageId));
    assert.equal(Object.keys(fake.pages).length, 1);
    const c = await RSY.publish({ client: {}, onenote: fake, sectionId: 'S', page: { pageId: 'gone' }, name: recs[0].name, recs, now: 3 });
    assert.equal(c.pageId, a.pageId, '기억한 페이지가 없으면 제목으로 찾음');
    await assert.rejects(RSY.publish({ client: {}, onenote: fake, sectionId: 'S', name: 'x', recs: [] }), (e) => e.kind === 'empty');
    await assert.rejects(RSY.publish({ client: {}, onenote: fake, sectionId: '', name: '새 과제', recs }), (e) => e.kind === 'nosection');
    await assert.rejects(RSY.publish({ client: {}, onenote: Object.assign({}, fake, { readPage: async () => { throw Object.assign(new Error('꺼짐'), { kind: 'offline' }); } }), sectionId: 'S', page: a, name: recs[0].name, recs }), (e) => e.kind === 'offline');

    // 받기 — 받는 쪽은 put 으로 넣고 자기 과제에 잇는다(src = 페이지)
    const got = await RSY.pull({ client: {}, onenote: fake, pageId: a.pageId });
    assert.equal(got.title, a.title);
    assert.equal(got.data.recs.length, 2);
    const mine = {};
    for (const rec of got.data.recs) R.put(mine, Object.assign(rec, { src: a.pageId }));
    R.link(mine, PROJECTS);
    assert.equal(R.forProject(mine, '2026-0063-01', '1').src, a.pageId);
    fake.pages.empty = { title: '빈 페이지', sectionId: 'S', html: '<html><body><p>글</p></body></html>' };
    await assert.rejects(RSY.pull({ client: {}, onenote: fake, pageId: 'empty' }), (e) => e.kind === 'noblock');
  });

  // 실제 RND 폴더 — 있으면 모든 KR_*.yaml 스냅샷을 읽어 과제에 잇는다 (없는 PC 에서는 건너뜀)
  const dir = process.env.RND_DIR || 'E:\\dev\\RND\\RND_PROJECT';
  const files = [];
  const walk = (d, depth) => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory() && depth < 3 && e.name !== 'history') walk(p, depth + 1); else if (/^KR_.+\.ya?ml$/i.test(e.name)) files.push(p); } } catch (e) {} };
  walk(dir, 0);
  if (files.length) {
    await test(`실제 스냅샷 ${files.length}개: 모두 읽히고 내 참여 과제에 이어진다`, () => {
      const map = {};
      for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        const o = YAML.parse(text);
        assert.equal(R.kindOf(o), 'snapshot', f);
        const rec = R.readSnapshot(o, { text, file: path.basename(f) });
        assert.ok(rec.goals.length > 0, `${f}: 개발목표 없음`);
        assert.ok(rec.contents.length > 0, `${f}: 개발내용 없음`);
        R.put(map, rec);
      }
      R.link(map, PROJECTS);
      const unlinked = Object.values(map).filter((r) => !r.prjNo).map((r) => r.name);
      assert.deepEqual(unlinked, []);
      for (const p of PROJECTS) assert.ok(R.forProject(map, p.prjNo, p.anl), `${p.prjNm}: 계획서 없음`);
    });
  } else console.log('skip  실제 스냅샷 — RND 폴더 없음 (' + dir + ')');

  console.log(`\n${n} passed${failed ? `, ${failed} failed` : ''}`);
})();
