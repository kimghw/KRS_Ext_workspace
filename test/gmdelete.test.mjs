// 임시보관 공문 삭제 — 전자결재 임시보관함 지우기의 순수 로직(src/gmdelete.js). 작성일 검색·쪽 넘김으로 문서번호가 똑같은 줄을 찾고, 그 줄의 체크박스 하나만 켠
// 문서삭제 포스트백, 다시 읽어 사라졌는지 확인. 서버 흉내(가짜 fetch)는 그린 쪽의 줄을 기억해 체크박스 이름(ctlNN)으로 지운다 — 2026-10-27 CDP 로 읽은 DocListTemp.aspx 꼴.
// 화면 쪽(카드의 삭제 두 번 누르기·작성 취소)은 test/wiring.test.mjs 의 "공문 탭 — 공문 이력" 이 본다. 네트워크는 없다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { listPage } from './fixtures/gmlist-fixture.mjs';
import { DELETE_TARGET, checkName, findTemp, deleteTemp } from '../src/gmdelete.js';
import { boxUrl } from '../src/gmlist.js';
import { AuthError } from '../src/net.js';

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');
globalThis.DOMParser = new JSDOM('').window.DOMParser;

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const SB = 'ctl00$ContentPlaceHolder1$SearchBar$';
const SEARCH = `${SB}btnSearch`;
const PAGER = 'ctl00$ContentPlaceHolder1$pagerDocList';
const row = (id, date, title = `${id} 품의`) => ({ id, form: 'KR_EA_Research_Task', formName: '연구업무품의서', title, date, status: '문서작성중', flow: '1' });

/**
 * 임시보관함 흉내 — GET 은 전체 첫 쪽, 검색은 작성일(from~to)로 거른 첫 쪽, 쪽 넘김은 그 쪽, 문서삭제는 켠 체크박스(ctlNN)가 가리키는 **마지막으로 그린 쪽**의 줄을 지운다.
 * 숨은 칸 __REAL_StatePersister 에 어느 응답인지 적어 둔다(get · search · page-N · deleted). keep 이면 삭제를 받고도 지우지 않는다.
 */
function fakeTemp(list, { keep = false, login = false } = {}) {
  const rows = [...list];
  const calls = [];
  let filtered = rows;
  let shown = [];
  const render = (all, p, tag) => {
    shown = all.slice(p * 10, p * 10 + 10);
    return { html: listPage({ rows: shown, count: all.length, current: p, dateType: '작성일', hidden: { __REAL_StatePersister: tag } }), via: 'direct' };
  };
  const fetch = async (url, init = {}) => {
    const body = init.body ? new URLSearchParams(init.body) : null;
    const target = body ? body.get('__EVENTTARGET') : null;
    calls.push({ method: init.method || 'GET', url, target, arg: body ? body.get('__EVENTARGUMENT') : null, body });
    if (login) return { html: '<html><body><input id="tbUserId" /></body></html>' };
    if (!body) { filtered = rows; return render(rows, 0, 'get'); }
    if (target === SEARCH) {
      const from = body.get(`${SB}dtpBeginningDate`);
      const to = body.get(`${SB}dtpClosingDate`);
      filtered = rows.filter((r) => r.date >= from && r.date <= to);
      return render(filtered, 0, 'search');
    }
    if (target === PAGER) return render(filtered, +body.get('__EVENTARGUMENT'), `page-${body.get('__EVENTARGUMENT')}`);
    if (target === DELETE_TARGET) {
      for (const k of [...body.keys()].filter((x) => x.endsWith('$chkRow'))) {
        const hit = shown[+k.match(/ctl(\d+)\$chkRow$/)[1] - 1];
        if (hit && !keep) rows.splice(rows.indexOf(hit), 1);
      }
      filtered = filtered.filter((r) => rows.includes(r));
      return render(filtered, 0, 'deleted');
    }
    throw new Error(`모르는 요청 ${target}`);
  };
  return { fetch, calls, rows };
}

console.log('줄 찾기');
t('체크박스 이름 — 문서번호가 똑같은 줄 안의 <grid>$ctlNN$chkRow, 없으면 빈 글', () => {
  const html = listPage({ rows: [row('HER-2026-000750', '2026-10-27'), row('HER-2026-000751', '2026-10-27')] });
  assert.equal(checkName(html, 'HER-2026-000751'), 'ctl00$ContentPlaceHolder1$grdDocList$grdDocList$ctl02$chkRow');
  assert.equal(checkName(html, 'HER-2026-00075'), '', '앞부분만 같은 번호는 아니다');
  assert.equal(checkName(html.replace(/<input id="[^"]*_chkRow"[^>]*>/g, ''), 'HER-2026-000751'), '');
});
await ta('작성일로 검색해 첫 쪽에 없으면 쪽을 넘겨 찾는다 — 그 쪽의 숨은 칸·검색 칸·체크박스를 돌려준다', async () => {
  const many = Array.from({ length: 12 }, (_, i) => row(`HER-2026-0007${String(i).padStart(2, '0')}`, '2026-10-27'));
  const box = fakeTemp(many);
  const hit = await findTemp('HER-2026-000711', { from: '2026-10-27', to: '2026-10-27', fetch: box.fetch });
  assert.deepEqual(box.calls.map((c) => [c.method, c.target, c.arg]), [['GET', null, null], ['POST', SEARCH, ''], ['POST', PAGER, '1']]);
  assert.equal(hit.url, boxUrl('temp'));
  assert.equal(hit.hidden.__REAL_StatePersister, 'page-1');
  assert.equal(hit.chk, 'ctl00$ContentPlaceHolder1$grdDocList$grdDocList$ctl02$chkRow');
  assert.deepEqual([hit.row.id, hit.row.box, hit.fields[`${SB}dtpBeginningDate`]], ['HER-2026-000711', 'temp', '2026-10-27']);
  assert.equal(await findTemp('HER-2026-000799', { from: '2026-10-27', to: '2026-10-27', fetch: fakeTemp(many).fetch }), null, '마지막 쪽까지 없으면 null');
});

console.log('지우기');
await ta('그 줄의 체크박스 하나만 켠 문서삭제 포스트백 — 검색 응답의 숨은 칸·검색 칸과 함께, 다시 읽어 사라졌으면 됐다', async () => {
  const box = fakeTemp([row('HER-2026-000750', '2026-10-27'), row('HER-2026-000751', '2026-10-27', 'SSCB 온라인교육 품의'), row('HER-2026-000600', '2026-09-01')]);
  const got = await deleteTemp('HER-2026-000751', { date: '2026-10-27', fetch: box.fetch });
  assert.deepEqual(got, { ok: true, absent: false, title: 'SSCB 온라인교육 품의' });
  assert.deepEqual(box.rows.map((r) => r.id), ['HER-2026-000750', 'HER-2026-000600'], '그 줄만 지웠다');
  assert.deepEqual(box.calls.map((c) => [c.method, c.target]), [['GET', null], ['POST', SEARCH], ['POST', DELETE_TARGET], ['GET', null], ['POST', SEARCH]], '보낸 뒤 처음부터 다시 읽는다');
  const del = box.calls[2].body;
  assert.equal(DELETE_TARGET, 'ctl00$ContentPlaceHolder1$ToolBar$lbtnDocumentDelete');
  assert.deepEqual([...del.keys()].filter((k) => k.endsWith('$chkRow')), ['ctl00$ContentPlaceHolder1$grdDocList$grdDocList$ctl02$chkRow'], '켠 칸은 하나 — 머리의 전체 고르기(ctl00)는 아니다');
  assert.equal(del.get('ctl00$ContentPlaceHolder1$grdDocList$grdDocList$ctl02$chkRow'), 'on');
  assert.equal(del.get('__REAL_StatePersister'), 'search', '검색 응답(그 줄을 그린 쪽)의 숨은 칸으로');
  assert.deepEqual([del.get(`${SB}dtpBeginningDate`), del.get(`${SB}dtpClosingDate`), del.get('__EVENTARGUMENT')], ['2026-10-27', '2026-10-27', '']);
});
await ta('목록에 처음부터 없으면 보내지 않고 absent(이미 없음)', async () => {
  const box = fakeTemp([row('HER-2026-000750', '2026-10-27')]);
  assert.deepEqual(await deleteTemp('HER-2026-000751', { date: '2026-10-27', fetch: box.fetch }), { ok: true, absent: true, title: '' });
  assert.ok(!box.calls.some((c) => c.target === DELETE_TARGET));
});
await ta('보냈는데도 목록에 그대로면 던진다', async () => {
  const box = fakeTemp([row('HER-2026-000751', '2026-10-27')], { keep: true });
  await assert.rejects(deleteTemp('HER-2026-000751', { date: '2026-10-27', fetch: box.fetch }), /삭제를 보냈지만 HER-2026-000751 이\(가\) 임시보관함에 그대로 있습니다/);
});
await ta('작성일을 모르면 오늘에서 2년 앞(1월 1일)부터 오늘까지 검색한다', async () => {
  const box = fakeTemp([row('HER-2026-000100', '2024-03-02')]);
  const got = await deleteTemp('HER-2026-000100', { today: '2026-10-27', fetch: box.fetch });
  assert.equal(got.absent, false);
  assert.deepEqual([box.calls[1].body.get(`${SB}dtpBeginningDate`), box.calls[1].body.get(`${SB}dtpClosingDate`)], ['2024-01-01', '2026-10-27']);
});
await ta('로그인이 풀렸으면 AuthError, 문서번호가 없으면 던진다, 줄에 고르는 칸이 없으면 모양이 다르다고', async () => {
  await assert.rejects(deleteTemp('HER-2026-000751', { date: '2026-10-27', fetch: fakeTemp([], { login: true }).fetch }), AuthError);
  await assert.rejects(deleteTemp(' ', { date: '2026-10-27', fetch: fakeTemp([]).fetch }), /지울 문서번호가 없습니다/);
  const box = fakeTemp([row('HER-2026-000751', '2026-10-27')]);
  const bare = async (url, init) => { const r = await box.fetch(url, init); return { ...r, html: r.html.replace(/<input id="[^"]*_chkRow"[^>]*>/g, '') }; };
  await assert.rejects(deleteTemp('HER-2026-000751', { date: '2026-10-27', fetch: bare }), /고르는 칸이 없습니다/);
  assert.ok(!box.calls.some((c) => c.target === DELETE_TARGET), '고를 수 없으면 보내지 않는다');
});

console.log(`\n통과 ${pass}건`);
