// 패널 머리의 git 아이콘(gitsync.js)과 다리 쪽 git(native/gitsync.mjs).
//
// 앞부분은 임시 폴더에 진짜 저장소를 만든다 — GitHub 대신 맨 저장소(origin) 하나와 그것을 받은 둘(here = 확장 폴더, there = 다른 PC).
// there 에서 올린 커밋을 here 가 알아보는지, 빨리 감기로만 받는지(겹침·갈라짐은 거절), 받은 뒤 다시 불러와야 하는지를 본다.
// 뒷부분은 아이콘이 확인 결과에 따라 어떤 모양이 되고, 누르면 받기·다시 불러오기로 가는지 본다(다리는 흉내).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

process.env.KRS_HOST_NO_MAIN = '1';
const { runGit, gitStatus, gitPull, gitError } = await import('../native/gitsync.mjs');
const { handle } = await import('../native/host.mjs');
const { gitView, pullSaid, createGitSync, GIT_CHECK_MS } = await import('../gitsync.js');

const require = createRequire(process.env.JSDOM_BASE || import.meta.url);
const { JSDOM } = require('jsdom');

let pass = 0;
const ta = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'krs-gitsync-'));
const sh = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text);
const commit = (dir, file, text, subject) => { write(dir, file, text); sh(dir, 'add', file); sh(dir, 'commit', '-q', '-m', subject); };
const who = (dir) => { sh(dir, 'config', 'user.name', '시험'); sh(dir, 'config', 'user.email', 'test@example.org'); sh(dir, 'config', 'core.autocrlf', 'false'); };

const origin = path.join(tmp, 'origin.git');
const here = path.join(tmp, 'here');
const there = path.join(tmp, 'there');
sh(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
sh(tmp, 'clone', '-q', '-c', 'core.autocrlf=false', origin, there);
who(there);
sh(there, 'symbolic-ref', 'HEAD', 'refs/heads/main');
commit(there, 'sidepanel.js', 'v1\n', '처음');
commit(there, 'README.md', '# 설명\n', '설명 추가');
sh(there, 'push', '-q', '-u', 'origin', 'main');
sh(tmp, 'clone', '-q', '-c', 'core.autocrlf=false', origin, here);
who(here);
// 테스트는 here 를 확장 폴더로 본다.
const git = (args, o) => runGit(args, { ...o, cwd: here });

console.log('다리 쪽 — 진짜 저장소로');
{
  await ta('받은 그대로면 같다(뒤진 것도 앞선 것도 없다)', async () => {
    const s = await gitStatus({ git });
    assert.deepEqual([s.ok, s.branch, s.upstream, s.ahead, s.behind, s.commits, s.dirty, s.overlap, 'fetchError' in s], [true, 'main', 'origin/main', 0, 0, [], 0, [], false]);
  });

  commit(there, 'sidepanel.js', 'v2\n', '패널 고침');
  commit(there, 'README.md', '# 설명 둘\n', '설명 고침');
  sh(there, 'push', '-q');

  await ta('다른 곳에서 올린 커밋을 받아 와서 센다 — 한글 제목도 그대로', async () => {
    const s = await gitStatus({ git });
    assert.equal(s.behind, 2);
    assert.equal(s.ahead, 0);
    assert.deepEqual(s.commits.map((c) => c.subject), ['설명 고침', '패널 고침']);
    assert.match(s.commits[0].hash, /^[0-9a-f]{7,}$/);
    assert.equal(s.commits[0].author, '시험');
  });

  write(here, 'sidepanel.js', 'v1 고치는 중\n');
  await ta('고치고 있는 파일과 받을 커밋이 겹치면 알린다', async () => {
    const s = await gitStatus({ git });
    assert.deepEqual([s.dirty, s.overlap], [1, ['sidepanel.js']]);
  });
  await ta('겹치면 받기를 거절하고 고치던 것은 그대로 둔다', async () => {
    const r = await gitPull({ git });
    assert.equal(r.ok, false);
    assert.match(r.error, /고치고 있는 파일과 겹쳐 받지 않았습니다\(sidepanel\.js\)/);
    assert.equal(fs.readFileSync(path.join(here, 'sidepanel.js'), 'utf8'), 'v1 고치는 중\n');
  });
  sh(here, 'checkout', '--', 'sidepanel.js');
  assert.equal(sh(here, 'stash', 'list'), '', '확인·거절이 stash 목록을 남겼다');

  write(here, 'other.txt', '');
  sh(here, 'add', 'other.txt');
  await ta('겹치지 않는 고친 파일은 둔 채로 받는다 — 확장 파일이 바뀌었으면 다시 불러오라고 한다', async () => {
    const r = await gitPull({ git });
    assert.deepEqual([r.ok, r.pulled, r.fileCount, r.reload, r.deps], [true, 2, 2, true, false]);
    assert.deepEqual(r.files.sort(), ['README.md', 'sidepanel.js']);
    assert.equal(fs.readFileSync(path.join(here, 'sidepanel.js'), 'utf8'), 'v2\n');
    assert.ok(fs.existsSync(path.join(here, 'other.txt')), '고치던 것이 사라졌다');
    const s = await gitStatus({ git });
    assert.deepEqual([s.behind, s.ahead, s.dirty], [0, 0, 1]);
  });
  sh(here, 'rm', '-q', '--cached', 'other.txt');
  fs.rmSync(path.join(here, 'other.txt'));

  await ta('받을 것이 없으면 0개 — 실패가 아니다', async () => {
    const r = await gitPull({ git });
    assert.deepEqual([r.ok, r.pulled, r.reload], [true, 0, false]);
  });

  commit(there, 'README.md', '# 설명 셋\n', '설명만');
  commit(there, 'package.json', '{}\n', '꾸러미');
  sh(there, 'push', '-q');
  await ta('package.json 이 바뀌면 npm install 하라고 한다(확장 폴더의 파일이라 다시 불러오기에도 든다)', async () => {
    const r = await gitPull({ git });
    assert.deepEqual([r.ok, r.pulled, r.reload, r.deps], [true, 2, true, true]);
  });
  commit(there, 'README.md', '# 설명 넷\n', '설명만 또');
  sh(there, 'push', '-q');
  await ta('설명(README)만 바뀌면 다시 불러오지 않는다', async () => {
    const r = await gitPull({ git });
    assert.deepEqual([r.ok, r.pulled, r.reload, r.deps], [true, 1, false, false]);
  });

  // 같은 파일이어도 줄이 부딪치지 않으면 받는다(2026-11-25 — README.md 를 고치던 중 단추가 받지 않던 일).
  commit(there, 'notes.md', '하나\n둘\n셋\n넷\n다섯\n', '노트');
  sh(there, 'push', '-q');
  await gitPull({ git });
  commit(there, 'notes.md', '하나 고침\n둘\n셋\n넷\n다섯\n', '노트 앞');
  sh(there, 'push', '-q');
  write(here, 'notes.md', '하나\n둘\n셋\n넷\n다섯 여기서\n');
  await ta('같은 파일을 고치고 있어도 줄이 부딪치지 않으면 받을 수 있다고 본다', async () => {
    const s = await gitStatus({ git });
    assert.deepEqual([s.behind, s.overlap, s.carry], [1, [], ['notes.md']]);
    assert.equal(gitView(s).mode, 'new');
    assert.match(gitView(s).title, /같은 파일\(notes\.md\)은 받은 뒤 고치던 것을 다시 얹습니다/);
  });
  await ta('받은 뒤 고치던 줄을 다시 얹는다 — stash 는 남기지 않는다', async () => {
    const r = await gitPull({ git });
    assert.deepEqual([r.ok, r.pulled], [true, 1]);
    assert.equal(fs.readFileSync(path.join(here, 'notes.md'), 'utf8'), '하나 고침\n둘\n셋\n넷\n다섯 여기서\n');
    assert.equal(sh(here, 'stash', 'list'), '');
  });
  commit(there, 'notes.md', '하나 고침\n둘\n셋\n넷\n다섯 저기서\n', '노트 끝');
  sh(there, 'push', '-q');
  await ta('줄이 부딪치면 그 파일만 겹침으로 알리고, 받지 않고 아무것도 건드리지 않는다', async () => {
    const s = await gitStatus({ git });
    assert.deepEqual([s.overlap, s.carry], [['notes.md'], []]);
    const head = sh(here, 'rev-parse', 'HEAD');
    const r = await gitPull({ git });
    assert.equal(r.ok, false);
    assert.match(r.error, /고치고 있는 파일과 겹쳐 받지 않았습니다\(notes\.md\)/);
    assert.equal(sh(here, 'rev-parse', 'HEAD'), head);
    assert.equal(fs.readFileSync(path.join(here, 'notes.md'), 'utf8'), '하나 고침\n둘\n셋\n넷\n다섯 여기서\n');
    assert.equal(sh(here, 'stash', 'list'), '');
  });
  sh(here, 'checkout', '--', 'notes.md');
  await gitPull({ git });

  // 갈라짐 — 여기에만 있는 커밋과 GitHub 에만 있는 커밋. 사용자가 pull.rebase 를 켜 두었어도 다시 쌓지 않는다.
  sh(here, 'config', 'pull.rebase', 'true');
  commit(here, 'mine.txt', 'mine\n', '여기서만');
  commit(there, 'theirs.txt', 'theirs\n', '저기서만');
  sh(there, 'push', '-q');
  const headBefore = sh(here, 'rev-parse', 'HEAD');
  await ta('갈라졌으면 앞선 수와 뒤진 수를 둘 다 센다', async () => {
    const s = await gitStatus({ git });
    assert.deepEqual([s.ahead, s.behind, s.overlap], [1, 1, []]);
  });
  await ta('갈라졌으면 받지 않는다(병합 커밋도, 다시 쌓기도 없다) — 고치던 것도 그대로', async () => {
    write(here, 'sidepanel.js', '갈라진 채 고치는 중\n');
    const r = await gitPull({ git });
    assert.equal(r.ok, false);
    assert.match(r.error, /빨리 감기로 받을 수 없습니다/);
    assert.equal(sh(here, 'rev-parse', 'HEAD'), headBefore);
    assert.equal(fs.readFileSync(path.join(here, 'sidepanel.js'), 'utf8'), '갈라진 채 고치는 중\n');
    assert.equal(sh(here, 'stash', 'list'), '');
    sh(here, 'checkout', '--', 'sidepanel.js');
  });

  sh(here, 'remote', 'set-url', 'origin', path.join(tmp, 'gone.git'));
  await ta('받아 오기가 안 되면(GitHub 에 못 닿음) 마지막으로 받아 둔 것과 비교하고 까닭을 단다', async () => {
    const s = await gitStatus({ git });
    assert.equal(s.ok, true);
    assert.deepEqual([s.ahead, s.behind], [1, 1]);
    assert.ok(s.fetchError, '까닭이 없다');
  });

  sh(here, 'checkout', '-q', '-b', 'solo');
  await ta('올라간 곳이 없는 가지면 실패로 알린다', async () => {
    const s = await gitStatus({ git });
    assert.equal(s.ok, false);
    assert.match(s.error, /solo 가지에 올라간 곳\(upstream\)이 없습니다/);
  });

  await ta('저장소가 아니면 실패로 알린다', async () => {
    const plain = fs.mkdtempSync(path.join(tmp, 'plain-'));
    const s = await gitStatus({ git: (args, o) => runGit(args, { ...o, cwd: plain }) });
    assert.equal(s.ok, false);
  });

  await ta('git 이 거절한 말을 할 일로 바꾼다', async () => {
    assert.match(gitError('fatal: Authentication failed for https://github.com/x'), /인증이 필요합니다/);
    assert.match(gitError('fatal: unable to access ...: Could not resolve host: github.com'), /닿지 못했습니다/);
    assert.match(gitError("fatal: Unable to create '.git/index.lock': File exists."), /다른 git 작업/);
    assert.equal(gitError('something odd'), 'something odd');
  });
}

console.log('다리(host.mjs) — gitStatus 는 남기지 않고 gitPull 은 남긴다');
{
  const logged = [];
  const log = (e) => logged.push(e);
  const fake = { status: async () => ({ ok: true, behind: 3 }), pull: async () => ({ ok: true, pulled: 3, from: 'a', to: 'b' }) };
  await ta('gitStatus', async () => {
    assert.deepEqual(await handle({ task: 'gitStatus' }, { log, git: fake }), { ok: true, behind: 3 });
    assert.equal(logged.length, 0);
  });
  await ta('gitPull', async () => {
    assert.deepEqual(await handle({ task: 'gitPull' }, { log, git: fake }), { ok: true, pulled: 3, from: 'a', to: 'b' });
    assert.equal(logged.length, 1);
    assert.deepEqual([logged[0].task, logged[0].ok, logged[0].pulled, typeof logged[0].ms], ['gitPull', true, 3, 'number']);
  });
  await ta('확장이 실어 보낸 값은 git 에 가지 않는다', async () => {
    const seen = [];
    await handle({ task: 'gitPull', input: '--force', args: ['reset', '--hard'] }, { log, git: { pull: async (...a) => { seen.push(a); return { ok: true, pulled: 0 }; } } });
    assert.deepEqual(seen, [[]]);
  });
}

console.log('아이콘의 모양');
{
  const base = { ok: true, branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, commits: [], dirty: 0, overlap: [] };
  const at = new Date(2026, 9, 9, 14, 5);
  await ta('다리가 없으면 숨는다', async () => {
    assert.equal(gitView(null).mode, 'off');
    assert.equal(gitView({ ok: false, error: 'not found', unreachable: true }).mode, 'off');
  });
  await ta('같으면 확인한 때를 적고 수는 없다', async () => {
    const v = gitView(base, { at });
    assert.deepEqual([v.mode, v.count], ['same', '']);
    assert.match(v.title, /origin\/main\)과 같습니다 · 14:05 확인/);
  });
  await ta('새 커밋이면 수와 제목 다섯 줄, 고치는 파일은 그대로 둔다는 말', async () => {
    const commits = Array.from({ length: 7 }, (_, i) => ({ hash: `h${i}`, subject: `제목${i}` }));
    const v = gitView({ ...base, behind: 7, commits, dirty: 3 });
    assert.deepEqual([v.mode, v.count], ['new', '7']);
    assert.match(v.title, /새 커밋 7개 — 누르면 받습니다\(git pull\)/);
    assert.match(v.title, /· h4 제목4\n… 외 2개/);
    assert.doesNotMatch(v.title, /h5/);
    assert.match(v.title, /고치고 있는 파일 3개는 그대로 둡니다/);
  });
  await ta('겹치거나 갈라졌으면 받지 않는 모양', async () => {
    assert.equal(gitView({ ...base, behind: 1, overlap: ['a.js'] }).mode, 'blocked');
    assert.match(gitView({ ...base, behind: 1, overlap: ['a.js'] }).title, /겹쳐 지금은 받을 수 없습니다\(a\.js\)/);
    assert.equal(gitView({ ...base, behind: 1, ahead: 2 }).mode, 'diverged');
    assert.equal(gitView({ ...base, ahead: 2 }).mode, 'ahead');
  });
  await ta('확인 실패·받아 오기 실패', async () => {
    assert.equal(gitView({ ok: false, error: 'x' }).mode, 'error');
    assert.match(gitView({ ...base, fetchError: '네트워크' }).title, /받아 오기 실패: 네트워크/);
    assert.equal(gitView({ ...base, behind: 150 }).count, '99+');
  });
  await ta('받은 결과의 말', async () => {
    assert.match(pullSaid({ ok: true, pulled: 2, from: 'a', to: 'b', fileCount: 3, reload: true, deps: true }).text,
      /커밋 2개를 받았습니다\(a → b, 파일 3개\) — git 아이콘을 한 번 더 누르면 확장을 다시 불러옵니다.*npm install/);
    assert.deepEqual(pullSaid({ ok: true, pulled: 0 }), { ok: true, reload: false, text: '이미 GitHub 과 같습니다.' });
    assert.equal(pullSaid({ ok: false, error: '겹침' }).ok, false);
    assert.equal(pullSaid(undefined).ok, false);
  });
}

console.log('아이콘 — 확인·받기·다시 불러오기');
{
  const dom = new JSDOM('<button id="b" hidden><span id="c" hidden></span></button>');
  globalThis.document = dom.window.document;
  const button = dom.window.document.getElementById('b');
  const badge = dom.window.document.getElementById('c');
  const sent = [];
  const logs = [];
  const said = [];
  let reloaded = 0;
  let answers = {};
  const send = async (task) => {
    sent.push(task);
    const a = answers[task];
    if (a instanceof Error) throw a;
    return typeof a === 'function' ? a() : a;
  };
  const sync = createGitSync({
    button, badge, send, log: (...a) => logs.push(a), say: (...a) => said.push(a), reload: () => { reloaded++; },
    now: () => new Date(2026, 9, 9, 9, 30),
  });
  const base = { ok: true, branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, commits: [], dirty: 0, overlap: [] };

  await ta('다리가 없으면 숨은 채로', async () => {
    answers = { gitStatus: new Error('Specified native messaging host not found.') };
    await sync.check({ quiet: false });
    assert.equal(button.hidden, true);
  });
  // 받을 것이 있을 때만 보인다(2026-11-05 사용자 지정: "깃허브 업데이트 할게 아니면 아 이이콘 안보여줘도 될듯").
  await ta('다리가 늦어 확인을 못 하면 숨는다', async () => {
    answers = { gitStatus: Object.assign(new Error('45초 안에 다리가 답하지 않았습니다'), { timeout: true }) };
    await sync.check({ quiet: false });
    assert.deepEqual([button.hidden, button.dataset.mode], [true, 'error']);
  });
  await ta('올리지 않은 커밋만 있으면 숨는다', async () => {
    answers = { gitStatus: { ...base, ahead: 3 } };
    await sync.check({ quiet: false });
    assert.deepEqual([button.hidden, button.dataset.mode], [true, 'ahead']);
  });
  await ta('같으면 숨는다 — 누르면(숨기 전에 눌렸다면) 다시 확인만 한다', async () => {
    answers = { gitStatus: base };
    await sync.check({ quiet: false });
    assert.deepEqual([button.hidden, button.dataset.mode, badge.hidden], [true, 'same', true]);
    sent.length = 0;
    await sync.click();
    assert.deepEqual(sent, ['gitStatus']);
  });
  await ta('패널이 가려져 있으면 몇 분마다 도는 확인은 건너뛴다', async () => {
    Object.defineProperty(dom.window.document, 'hidden', { configurable: true, get: () => true });
    sent.length = 0;
    await sync.check();
    assert.deepEqual(sent, []);
    delete dom.window.document.hidden;
  });
  await ta('새 커밋이면 수를 띄우고, 누르면 받는다 — 확장 파일이면 다시 불러오기가 된다', async () => {
    answers = { gitStatus: { ...base, behind: 2, commits: [{ hash: 'abc1234', subject: '고침' }] } };
    await sync.check({ quiet: false });
    assert.deepEqual([button.hidden, button.dataset.mode, badge.textContent, badge.hidden], [false, 'new', '2', false]);
    answers.gitPull = { ok: true, from: 'aaa', to: 'bbb', pulled: 2, files: ['sidepanel.js'], fileCount: 1, reload: true, deps: false };
    sent.length = 0;
    await sync.click();
    assert.deepEqual(sent, ['gitPull']);
    assert.deepEqual([button.hidden, button.dataset.mode, badge.textContent], [false, 'reload', '✓']);
    assert.match(button.title, /^받기 완료 \(09:30\) — GitHub 에서 커밋 2개를 받았습니다/);
    assert.match(button.title, /한 번 더 누르면 확장을 다시 불러옵니다/);
    assert.equal(button.classList.contains('busy'), false, '받기가 끝나면 깜박임이 멈춘다');
    assert.deepEqual([logs.at(-1)[0], logs.at(-1)[1], logs.at(-1)[3].pulled], ['git', true, 2]);
    assert.equal(said.at(-1)[1], '');
  });
  await ta('다시 불러오기를 누르면 확장을 다시 불러온다 — 그 뒤로는 확인하지 않는다', async () => {
    sent.length = 0;
    await sync.click();
    assert.equal(reloaded, 1);
    await sync.check({ quiet: false });
    assert.deepEqual(sent, []);
  });
}
{
  // 받기 완료(✓) — 확장 파일이 없으면(문서·다리만) 다시 확인하지 않고 곧바로 ✓, 몇 분마다 도는 확인은 남기고 누른 확인·새 커밋·10분이 지운다
  // (2026-11-26 사용자 지정: "완료되고 나서도 진행 표시가 나온는데 완료되면 완료되었다고 표기해 줄 수 없나?")
  const dom = new JSDOM('<button id="b" hidden><span id="c" hidden></span></button>');
  globalThis.document = dom.window.document;
  const button = dom.window.document.getElementById('b');
  const badge = dom.window.document.getElementById('c');
  const base = { ok: true, branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, commits: [], dirty: 1, overlap: [] };
  let t = new Date(2026, 10, 26, 14, 5).getTime();
  let status = { ...base, behind: 1, commits: [{ hash: 'abc1234', subject: '설명' }], fetchError: '네트워크' };
  const sent = [];
  const busyDuring = [];
  const send = async (task) => {
    sent.push(task);
    busyDuring.push(button.classList.contains('busy'));
    return task === 'gitStatus' ? status : { ok: true, from: 'aaa', to: 'bbb', pulled: 1, files: ['README.md'], fileCount: 1, reload: false, deps: false };
  };
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, get: () => false });   // jsdom 은 기본이 가려짐 — 몇 분마다 도는 확인이 돌게
  const sync = createGitSync({ button, badge, send, now: () => new Date(t) });
  await ta('받으면 다시 확인하지 않고 곧바로 초록 ✓(받기 완료) — 깜박임은 받는 동안만', async () => {
    await sync.check({ quiet: false });
    sent.length = 0; busyDuring.length = 0;
    await sync.click();
    assert.deepEqual(sent, ['gitPull']);
    assert.deepEqual(busyDuring, [true]);
    assert.deepEqual([button.hidden, button.dataset.mode, badge.textContent, badge.hidden, button.classList.contains('busy')], [false, 'done', '✓', false, false]);
    assert.match(button.title, /^받기 완료 \(14:05\) — GitHub 에서 커밋 1개를 받았습니다\(aaa → bbb, 파일 1개\)\.\n누르면 다시 확인합니다\.$/);
    assert.deepEqual([sync.state.last.behind, sync.state.last.commits, sync.state.last.fetchError, sync.state.last.dirty], [0, [], '', 1]);
  });
  await ta('몇 분마다 도는 확인은 ✓ 를 남기고, 10분이 지나면 지운다(같음이면 숨음)', async () => {
    status = base;
    t += 5 * 60_000;
    await sync.check();
    assert.deepEqual([button.hidden, button.dataset.mode], [false, 'done']);
    t += 6 * 60_000;
    await sync.check();
    assert.deepEqual([button.hidden, button.dataset.mode], [true, 'same']);
  });
  await ta('그 사이 새 커밋이 생기면 ✓ 대신 새 커밋 수', async () => {
    status = { ...base, behind: 1 };
    await sync.click();   // 같음 → 다시 확인(숨은 단추지만 누름을 흉내)
    await sync.click();   // 받기 → ✓
    assert.equal(button.dataset.mode, 'done');
    status = { ...base, behind: 3 };
    await sync.check();
    assert.deepEqual([button.dataset.mode, badge.textContent], ['new', '3']);
  });
  await ta('✓ 를 누르면 다시 확인하고 ✓ 는 지운다', async () => {
    status = { ...base, behind: 1 };
    await sync.check({ quiet: false });
    await sync.click();
    assert.equal(button.dataset.mode, 'done');
    status = base;
    sent.length = 0;
    await sync.click();
    assert.deepEqual(sent, ['gitStatus']);
    assert.deepEqual([button.hidden, button.dataset.mode], [true, 'same']);
  });
}
{
  const dom = new JSDOM('<button id="b"><span id="c"></span></button>');
  globalThis.document = dom.window.document;
  const button = dom.window.document.getElementById('b');
  const badge = dom.window.document.getElementById('c');
  const base = { ok: true, branch: 'main', upstream: 'origin/main', ahead: 0, behind: 1, commits: [], dirty: 0, overlap: [] };
  let status = base;
  const said = [];
  const busyAt = [];
  const send = async (task) => { busyAt.push([task, button.classList.contains('busy')]); return task === 'gitStatus' ? status : { ok: false, error: '고치고 있는 파일과 겹쳐 받지 않았습니다(a.js) — 커밋하거나 치운 뒤 다시 누르세요.' }; };
  const sync = createGitSync({ button, badge, send, say: (...a) => said.push(a) });
  await ta('받지 못하면 그 까닭이 풍선 말 맨 위에 오고, 상태 줄에도 오류로 — 받은 뒤의 다시 확인은 깜박이지 않는다', async () => {
    await sync.check({ quiet: false });
    status = { ...base, overlap: ['a.js'] };
    busyAt.length = 0;
    await sync.click();
    assert.deepEqual(busyAt, [['gitPull', true], ['gitStatus', false]]);
    assert.match(button.title, /^GitHub 에서 받지 못했습니다 — 고치고 있는 파일과 겹쳐/);
    assert.deepEqual([button.dataset.mode, button.hidden], ['blocked', false], '새 커밋이 있으니 받을 수 없어도 보인다');
    assert.equal(said.at(-1)[1], 'error');
  });
  await ta('받을 수 없는 모양에서 누르면 받지 않고 다시 확인만 한다', async () => {
    const seen = [];
    const s2 = createGitSync({ button, badge, send: async (t) => { seen.push(t); return status; } });
    await s2.check({ quiet: false });
    await s2.click();
    assert.deepEqual(seen, ['gitStatus', 'gitStatus']);
  });
  await ta('패널을 열면 곧바로 한 번 보고, 십 분마다 본다', async () => {
    const intervals = [];
    const real = globalThis.setInterval;
    globalThis.setInterval = (fn, ms) => { intervals.push(ms); return 0; };
    const seen = [];
    try {
      createGitSync({ button, badge, send: async (t) => { seen.push(t); return status; } }).start();
    } finally {
      globalThis.setInterval = real;
    }
    assert.deepEqual([intervals, GIT_CHECK_MS, seen], [[600_000], 600_000, ['gitStatus']]);
  });
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n통과 ${pass}건`);
