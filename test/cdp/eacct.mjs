// 회계(e-accounting) 조회 실측 — 디버그 포트를 연 크롬의 KRS WORKSPACE 확장 페이지에서 src/eacct.js 가 정말 읽는지 본다(읽기만 — 아무것도 저장하지 않는다).
//
//   node test/cdp/eacct.mjs                 # 내 부서 · 과제(I/O) 목록 · 첫 과제의 계정과목별 예산 · 후보 고르기
//   node test/cdp/eacct.mjs --io 2145NR0124 # 그 과제의 계정 줄
//   node test/cdp/eacct.mjs --name "대용량 모듈러 멀티레벨 컨버터"   # 이 이름으로 후보 고르기
//
// 확장 페이지(chrome-extension://<id>/sidepanel.html)에서 import 해 도는 것이라 host_permissions 로 e-accounting 쿠키가 실린다. 로그인이 풀려 있으면 LOGIN 안내가 찍힌다.
import { targets, newTab, closeTab, attach } from './cdp.mjs';

const args = process.argv.slice(2);
const opt = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] || '' : ''; };
const wantIo = opt('--io');
const wantName = opt('--name');

const all = await targets();
const ext = all.find((t) => t.type === 'page' && /^chrome-extension:\/\/[a-z]+\/sidepanel\.html/.test(t.url));
if (!ext) {
  console.error('KRS WORKSPACE 확장 페이지(sidepanel.html)가 열려 있지 않습니다 — 확장을 올리고 사이드패널을 한 번 여세요.');
  process.exit(1);
}
// node 의 URL 은 chrome-extension: 의 origin 을 'null' 로 준다 — 글에서 자른다.
const origin = ext.url.match(/^chrome-extension:\/\/[a-z]+/)[0];
const tab = await newTab(`${origin}/sidepanel.html?cdp=eacct`);
const c = await attach(tab);
try {
  const out = await c.evaluate(`(async () => {
    const m = await import('${origin}/src/eacct.js');
    const out = { year: m.fiscalYearOf(new Date().toISOString().slice(0, 10)) };
    try {
      out.dept = await m.fetchMyDept();
      const list = await m.fetchIoList(out.year);
      out.list = list.map((o) => [o.code, o.name]);
      const want = ${JSON.stringify(wantName)} || (list[0] && list[0].name) || '';
      out.rank = m.rankIo(list, { name: want });
      const io = ${JSON.stringify(wantIo)} || (out.rank.list[0] && out.rank.list[0].code) || (list[0] && list[0].code) || '';
      out.io = io;
      if (io) {
        const acct = await m.fetchAcct(out.year, io, { options: list });
        out.acct = acct && { ioName: acct.ioName, dept: acct.dept, deptName: acct.deptName, at: acct.at, rows: acct.rows.map((r) => [r.code, r.name, r.budget, r.actual, r.available]) };
        out.order = m.orderBudgetOf({ io, acct, account: '연구재료비' });
      }
    } catch (e) {
      out.error = e.message;
      out.login = !!e.login;
    }
    return out;
  })()`, 60000);
  console.log(JSON.stringify(out, null, 1));
  if (out.error) {
    console.error(out.login ? '로그인이 풀려 있습니다 — e-accounting 에 로그인한 뒤 다시.' : `실패: ${out.error}`);
    process.exitCode = 1;
  } else if (!out.list?.length) {
    console.error('과제(I/O) 목록이 비었습니다.');
    process.exitCode = 1;
  } else {
    console.log(`ok — 부서 ${out.dept} · 과제 ${out.list.length}개 · ${out.io} 계정 줄 ${out.acct?.rows?.length ?? 0}개`);
  }
  if (c.errors.length) console.log('페이지 오류:', c.errors);
} finally {
  c.close();
  await closeTab(tab.id);
}
