// 공문 작성기(src/gmwrite.js writeGongmun) 실측 — 새 공문 창(DocumentView)에 패널이 하는 그대로 넣어 본다.
//
//   node test/cdp/gmwrite.mjs --head <부서장> --project <과제명> [--new] [--kind purchase|edu|trip|outside] [--me <이름>] [--dept <부서>]
//                             [--lead <과제책임자>] [--refs <참조자,참조자>] [--code <과제번호>] [--director <소장>] [--title <제목>] [--total <합계>]
//                             [--attach <파일,파일>] [--live]
//
// 미리: 디버그 포트(기본 9333, CDP_PORT)를 연 KRS 크롬이 eclass 에 로그인돼 있어야 한다. --new 면 새 공문 창을 직접 열고(GET) 끝나면 저장 없이 닫는다.
// 없으면 열려 있는 새 공문 창(먼저 찾은 것)에 쓴다 — 하룻밤 둔 창은 결재선 화면이 비어 쓸 수 없다(2026-10-09 실측).
// 기본은 dry — 과제(Job Id)·제목·차수·본문은 창에 들어가지만(저장은 안 된 채) 문서설정·결재선은 넣어 보고 다시 읽기만 하고 **확인·저장하지 않고**,
// 첨부(--attach 의 파일 — 패널은 읽은 문서를 묶은 PDF)는 파일첨부 화면의 칸에 넣고 검사까지만 하고 **올리지 않는다**.
// --live 는 패널과 같이 문서설정 확인·결재선 저장·첨부 올리기까지 한다(임시저장·상신은 여전히 사람 몫). 사람 이름은 인자로만 받는다(저장소에 두지 않는다).
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { targets, attach, newTab, closeTab } from './cdp.mjs';
import { writeGongmun } from '../../src/gmwrite.js';
import { writePlan } from '../../src/gongmun.js';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--') && (argv[argv.indexOf(a) + 1] ?? '--').startsWith('--')));
const args = Object.fromEntries(argv.map((a, i, all) => (a.startsWith('--') && !flags.has(a) ? [a.slice(2), all[i + 1] ?? ''] : null)).filter(Boolean));
// 외부활동(외부강의등 신고서 — 2026-10-15)은 과제를 고르지 않아 --project 가 없어도 된다. 신고서 칸은 [시험] 값으로 채우고, 다 넣은 뒤 칸을 다시 읽고
// 양식의 상신 전 검사(formSubmit(1, true, 0) — 포스트백 없이 칸만 보는 함수, 알림은 받아 적는다)를 돌려 무엇이 막히는지 보인다.
if (!args.head || (!args.project && args.kind !== 'outside')) {
  console.log('쓰는 법: node test/cdp/gmwrite.mjs --head <부서장> --project <과제명> [--new] [--kind purchase|edu|trip|outside] [--me <이름>] [--dept <부서>] [--lead <과제책임자>] [--code <과제번호>] [--director <소장>] [--title <제목>] [--total <합계>] [--attach <파일,파일>] [--live]');
  process.exit(2);
}
const dry = !flags.has('--live');
// 첨부할 파일 — 이름은 파일 이름 그대로, 종류는 PDF 가 아니면 그림으로 본다(패널은 늘 PDF).
const files = (args.attach || '').split(',').map((s) => s.trim()).filter(Boolean).map((path) => ({
  name: basename(path), type: /\.pdf$/i.test(path) ? 'application/pdf' : /\.png$/i.test(path) ? 'image/png' : 'image/jpeg', base64: readFileSync(path).toString('base64'),
}));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kind = args.kind || 'purchase';
const project = args.project ? { name: args.project, code: args.code || '', lead: args.lead || '', alias: '', rnd: { year: 1 } } : null;
const preset = { dept: args.dept || '', head: args.head, director: args.director || '', refs: (args.refs || '').split(/[,\s]+/).filter(Boolean) };
const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
// 외부강의등 신고서의 시험 초안 — 칸마다 [시험] 이 보이게. 숫자만 받는 칸은 0·1.
const OUTSIDE_DRAFT = {
  org: '[시험] 기관', representative: '[시험] 대표', contact: '[시험] 부서(담당)', contactTel: '0000000000', subject: '[시험] 공문 작성기 실측 — 저장하지 말고 닫아 주세요',
  place: '[시험] 장소', from: day, to: day, start: '14:00', end: '16:30', hours: 2, mins: 30, fee: 0, expenses: null, rank: '[시험]', monthCount: 1, yearTotal: 0,
  note: `[시험] 작성기 실측${dry ? '(dry)' : ''}`,
};
const plan = writePlan(kind, {
  title: args.title || (kind === 'outside' ? '[시험] 외부강의등 신고서' : `[시험] ${args.project} 공문 작성 시험`),
  body: `1. 시험 — 이 글은 공문 작성기 실측${dry ? '(dry)' : ''}이 넣은 것입니다. 저장하지 말고 닫아 주세요.\n\n------------ 아   래 ------------\n\n가. 시험`,
  draft: kind === 'outside' ? OUTSIDE_DRAFT : { total: Number(args.total || 300000) },
  ...(kind === 'outside' ? { form: 'KR_Outside_Lecture_Report' } : {}),
}, { me: args.me || '', preset, project });
console.log('계획', JSON.stringify({ form: plan.form, known: plan.known, job: plan.values.job, setting: plan.setting, line: plan.line, attach: files.map((f) => `${f.name} (${Math.round(f.base64.length * 3 / 4 / 1024)}KB)`), dry }));

let opened = null;
let t = null;
if (flags.has('--new')) {
  opened = await newTab(plan.url);
  await sleep(1500);
  t = (await targets()).find((x) => x.id === opened.id);
} else {
  t = (await targets()).find((x) => x.type === 'page' && /DocumentView\.aspx/.test(x.url));
}
if (!t) {
  console.log('새 공문 창(DocumentView.aspx)이 없습니다 — 패널의 "eclass 에 공문 작성" 으로 하나 열어 두거나 --new 로 돌리세요.');
  process.exit(1);
}
console.log('창', t.url.slice(0, 100));
const p = await attach(t);
// 패널의 frameId 대신 프레임 이름으로 — 새 공문 창은 툴바·본문 틀·첨부 틀 세 프레임이다. 작성기가 툴바·본문 틀이 뜰 때까지 스스로 기다린다.
const FRAMES = { 0: 'frameToolBar', 3: 'frameDocument', 5: 'frameDocOther' };
const inFrame = (frame, func, fnArgs) => p.evaluate(
  `(() => { const w = window.frames['${frame}']; if (!w) throw new Error('no frame'); return w.eval(${JSON.stringify(`(${func.toString()})`)}).apply(null, ${JSON.stringify(fnArgs)}); })()`, 60000,
);
const api = {
  tabs: { create: async () => { throw new Error('새 창을 열지 않는다 — 열려 있는 창에 쓴다'); } },
  scripting: {
    executeScript: async ({ target, func, args: fnArgs = [] }) => {
      if (target.allFrames) return Promise.all(Object.entries(FRAMES).map(async ([id, nm]) => ({ frameId: +id, result: await inFrame(nm, func, fnArgs).catch(() => null) })));
      return [{ result: await inFrame(FRAMES[target.frameIds[0]], func, fnArgs) }];
    },
  },
};
try {
  const t0 = Date.now();
  const res = await writeGongmun(plan, { api, dry, files, tabId: 1, onStep: (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`.padStart(6), s.key.padEnd(8), s.ok, s.detail) });
  console.log('문서', res.docId);
  if (Object.keys(plan.values.draft).length) {
    // 칸이 정해진 폼 — 넣은 칸을 다시 읽고(글 칸 value, 피커는 control 의 값·선택한 날짜) 양식의 상신 전 검사를 돌린다(포스트백 없음, 알림은 받아 적음).
    const back = await inFrame('frameDocument', (fields) => fields.map((f) => {
      const el = f.control ? document.getElementById(f.control) : document.querySelector(f.selector);
      const c = f.control && window.$find ? window.$find(f.control) : null;
      const d = c && c.get_selectedDate ? c.get_selectedDate() : null;
      return [f.key, el ? el.value : '(칸 없음)', d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : ''];
    }), [Object.entries(plan.fields).filter(([, f]) => f.source === 'draft').map(([key, f]) => ({ key, selector: f.selector, control: f.control }))]);
    console.log('다시 읽은 신고서 칸', JSON.stringify(back));
    const check = await inFrame('frameDocument', () => {
      const said = [];
      const alert0 = window.alert;
      window.alert = (m) => { said.push(String(m)); };
      let pass = null;
      let regex = null;
      try { pass = typeof window.formSubmit === 'function' ? window.formSubmit(1, true, 0) : '없음'; } catch (e) { pass = `예외 ${e.message}`; }
      try { regex = (window.Page_Validators || []).filter((v) => { window.ValidatorValidate(v); return !v.isvalid; }).map((v) => v.controltovalidate); } catch (e) { regex = `예외 ${e.message}`; }
      window.alert = alert0;
      return { pass, said, regex };
    }, []);
    console.log('양식의 상신 전 검사', JSON.stringify(check), '— 첨부가 없으면 "증빙자료를 첨부해 주세요" 에서 멈추는 것이 맞다');
  }
  console.log('남은 숨은 틀', JSON.stringify(await inFrame('frameToolBar', () => [...document.querySelectorAll('iframe[data-krsws]')].map((f) => f.getAttribute('data-krsws')), [])));
  console.log('받아 적은 알림', JSON.stringify(await inFrame('frameToolBar', () => (window.__krsws || {}).said || [], [])));
  console.log('창의 알림', JSON.stringify(p.dialogs), '오류', JSON.stringify(p.errors.slice(0, 5)));
  console.log(res.steps.every((s) => s.ok) ? `모든 단계 ✓ (${dry ? 'dry — 확인·저장·올리기 안 함' : '문서설정 확인·결재선 저장·첨부 올림'}). 창은 저장하지 말고 닫으세요.` : `안 된 단계: ${res.steps.filter((s) => !s.ok).map((s) => `${s.label}${s.ok === 'skip' ? '(건너뜀)' : ''}`).join(', ')}`);
} finally {
  if (opened) { await closeTab(opened.id); console.log('새로 연 창은 저장 없이 닫았습니다.'); }
}
process.exit(0);
