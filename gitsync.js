// 패널 머리의 git 아이콘 — 확장 폴더(git 저장소)가 GitHub 보다 뒤졌는지 몇 분마다 보고, 새 커밋이 있으면 그 수를 띄운다.
// 누르면 받는다(빨리 감기만 — 고치던 것은 줄이 부딪치지 않으면 받은 뒤 다시 얹는다). git 은 다리(native/gitsync.mjs)가 돌린다 — 다리가 없으면 아이콘은 숨는다.
// 받기가 끝나면 다시 확인하지 않고 곧바로 귀퉁이가 초록 ✓(받기 완료)가 된다 — 받은 것에 확장 파일이 있으면 브라우저에 다시 불러와야 반영되므로
// 그 ✓ 를 한 번 더 누르면 확장을 다시 불러오고(패널이 닫힌다 — 다시 열면 된다), 없으면 ✓ 는 10분(다음 확인)까지 남고 누르면 다시 확인한다.
// (2026-11-26 사용자 지정: "완료되고 나서도 진행 표시가 나온는데 완료되면 완료되었다고 표기해 줄 수 없나?" — 그 전엔 받은 뒤 ↻ 가 진행 중처럼 보였고,
//  받은 뒤 다시 확인하는 동안 깜박임이 이어지다 아이콘이 말없이 숨었다.)
// 2026-10-09 사용자 지정: "현재 프로젝트의 github 커밋된게 있는지 모니터링 할수 있는 아이콘 추가하고, 클릭하면 git pull".

import { NATIVE_HOST } from './src/llm.js';

/** 몇 분마다 볼지. 패널이 가려져 있으면(브라우저 창을 내렸다 등) 그 차례는 건너뛴다. */
export const GIT_CHECK_MS = 10 * 60_000;
/** 풍선 말에 적는 새 커밋 줄 수. */
const SHOW_COMMITS = 5;

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * 다리에 한 번 묻는다. 다리가 없으면(등록 안 됨) 브라우저가 던진다 — 그대로 던져 아이콘을 숨기게 한다.
 * 시간이 다 된 것은 다리가 있는 것이다(timeout 을 붙여 던진다).
 */
async function ask(task, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      chrome.runtime.sendNativeMessage(NATIVE_HOST, { task }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`${timeoutMs / 1000}초 안에 다리가 답하지 않았습니다`), { timeout: true })), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 확인한 것(native/gitsync.mjs 의 gitStatus)을 아이콘의 모양으로.
 * mode — off: 다리 없음(숨김) · error: 확인 실패 · same: GitHub 과 같음 · new: 새 커밋(누르면 받기) ·
 * blocked: 새 커밋이 고치고 있는 파일과 겹침 · diverged: 여기에만 있는 커밋도 있어 갈라짐 · ahead: 올리지 않은 커밋만 있음.
 * count 는 아이콘 귀퉁이의 숫자(새 커밋 수)다. new 말고는 누르면 다시 확인한다.
 * @returns {{mode: string, count: string, title: string}}
 */
export function gitView(s, { at = null } = {}) {
  if (!s || s.unreachable) return { mode: 'off', count: '', title: '' };
  if (!s.ok) return { mode: 'error', count: '', title: `GitHub 확인 실패 — ${s.error}\n누르면 다시 확인합니다.` };
  const when = at ? ` · ${hhmm(at)} 확인` : '';
  const stale = s.fetchError ? `\n(받아 오기 실패: ${s.fetchError} — 마지막으로 받아 둔 것과 비교했습니다)` : '';
  if (s.behind > 0) {
    const count = s.behind > 99 ? '99+' : String(s.behind);
    const list = (s.commits || []).slice(0, SHOW_COMMITS).map((c) => `· ${c.hash} ${c.subject}`).join('\n');
    const more = s.behind > SHOW_COMMITS ? `\n… 외 ${s.behind - SHOW_COMMITS}개` : '';
    const head = `GitHub(${s.upstream})에 새 커밋 ${s.behind}개${when}`;
    if (s.ahead > 0) {
      return { mode: 'diverged', count, title: `${head}\n${list}${more}\n\n여기에만 있는 커밋도 ${s.ahead}개 있어 빨리 감기로 받을 수 없습니다 — 터미널에서 직접 pull 하세요. 누르면 다시 확인합니다.${stale}` };
    }
    if (s.overlap?.length) {
      const files = `${s.overlap.slice(0, 5).join(', ')}${s.overlap.length > 5 ? ` 외 ${s.overlap.length - 5}개` : ''}`;
      return { mode: 'blocked', count, title: `${head}\n${list}${more}\n\n고치고 있는 파일과 겹쳐 지금은 받을 수 없습니다(${files}) — 커밋하거나 치운 뒤 누르면 다시 확인합니다.${stale}` };
    }
    const carry = s.carry?.length ? ` 받을 커밋과 같은 파일(${s.carry.slice(0, 5).join(', ')}${s.carry.length > 5 ? ` 외 ${s.carry.length - 5}개` : ''})은 받은 뒤 고치던 것을 다시 얹습니다.` : '';
    return { mode: 'new', count, title: `${head} — 누르면 받습니다(git pull)\n${list}${more}${s.dirty ? `\n\n고치고 있는 파일 ${s.dirty}개는 그대로 둡니다.${carry}` : ''}${stale}` };
  }
  if (s.ahead > 0) {
    return { mode: 'ahead', count: '', title: `GitHub(${s.upstream})에 새 커밋 없음${when}\n여기에만 있는 커밋 ${s.ahead}개는 아직 올리지 않았습니다(올리기는 하지 않습니다). 누르면 다시 확인합니다.${stale}` };
  }
  return { mode: 'same', count: '', title: `GitHub(${s.upstream})과 같습니다${when} — 누르면 다시 확인합니다.${stale}` };
}

/** 받은 결과(native/gitsync.mjs 의 gitPull)를 한 줄 말로. reload 면 확장을 다시 불러와야 반영된다. */
export function pullSaid(r) {
  if (!r?.ok) return { ok: false, reload: false, text: `GitHub 에서 받지 못했습니다 — ${r?.error || '다리가 답하지 않았습니다'}` };
  if (!r.pulled) return { ok: true, reload: false, text: '이미 GitHub 과 같습니다.' };
  return {
    ok: true, reload: !!r.reload,
    text: `GitHub 에서 커밋 ${r.pulled}개를 받았습니다(${r.from} → ${r.to}, 파일 ${r.fileCount}개)`
      + (r.reload ? ' — git 아이콘을 한 번 더 누르면 확장을 다시 불러옵니다(패널이 닫힙니다).' : '.')
      + (r.deps ? ' package.json 이 바뀌었습니다 — 저장소 폴더에서 npm install 을 돌리세요.' : ''),
  };
}

/**
 * @param {{button: HTMLButtonElement, badge: HTMLElement, log?: Function, say?: Function, send?: Function, reload?: Function, now?: Function}} o
 *   log 는 활동 기록(sidepanel.js 의 logEvent), say 는 상태 줄(setStatus)이다. send·reload·now 는 테스트가 갈아 끼운다.
 */
export function createGitSync({ button, badge, log = () => {}, say = () => {}, send = ask, reload = () => chrome.runtime.reload(), now = () => new Date() }) {
  // last 는 마지막으로 확인한 것, at 은 그때. reload 는 받은 것을 반영하려면 다시 불러와야 한다는 표시(그 말은 reloadTitle).
  // done 은 받기 완료({ at, text }) — 귀퉁이 ✓. 사용자가 누른 확인·새 커밋·GIT_CHECK_MS 가 지운다.
  const st = { last: null, at: null, busy: false, reload: false, reloadTitle: '', done: null };

  function paint() {
    const doneAt = st.done ? ` (${hhmm(st.done.at)})` : '';
    const v = st.reload ? { mode: 'reload', count: '✓', title: `받기 완료${doneAt} — ${st.reloadTitle}` }
      : st.done ? { mode: 'done', count: '✓', title: `받기 완료${doneAt} — ${st.done.text}\n누르면 다시 확인합니다.` }
      : gitView(st.last, { at: st.at });
    // 받을 것이 있을 때만 보인다 — 귀퉁이 수(새 커밋 수·받기 완료 ✓)가 서는 모양(new·blocked·diverged·reload·done). 같음·ahead·확인 실패·다리 없음은 숨김
    // (2026-11-05 사용자 지정: "깃허브 업데이트 할게 아니면 아 이이콘 안보여줘도 될듯" — 10-26 의 "늘 보이게"를 뒤집음).
    button.hidden = !v.count;
    button.dataset.mode = v.mode;
    button.title = v.title;
    button.setAttribute('aria-label', v.title.split('\n')[0] || 'GitHub 새 커밋 확인');
    badge.textContent = v.count;
    badge.hidden = !v.count;
  }

  /** show 가 거짓이면 깜박이지 않는다(받기가 끝난 뒤의 확인 — 끝났는데 진행 중처럼 보이지 않게). */
  const busy = (on, show = true) => {
    st.busy = on;
    button.classList.toggle('busy', on && show);
  };

  /** quiet 는 몇 분마다 도는 확인이다 — 패널이 가려져 있으면 건너뛰고, 받기 완료(✓)는 10분이 될 때까지 남긴다. */
  async function check({ quiet = true, show = true } = {}) {
    if (st.busy || st.reload || (quiet && document.hidden)) return;
    busy(true, show);
    try {
      st.last = await send('gitStatus', 45_000);
    } catch (err) {
      st.last = { ok: false, error: String(err?.message || err), unreachable: !err?.timeout };
    } finally {
      busy(false);
    }
    st.at = now();
    if (st.done && (!quiet || !(st.last?.ok && !st.last.behind) || now() - st.done.at >= GIT_CHECK_MS)) st.done = null;
    paint();
  }

  async function pull() {
    busy(true);
    st.done = null;
    button.title = 'GitHub 에서 받는 중…';
    let r;
    try {
      r = await send('gitPull', 90_000);
    } catch (err) {
      r = { ok: false, error: String(err?.message || err) };
    } finally {
      busy(false);
    }
    const said = pullSaid(r);
    log('git', said.ok, said.text, r?.ok ? { from: r.from, to: r.to, pulled: r.pulled, files: r.files } : undefined);
    say(said.text, said.ok ? '' : 'error');
    if (said.reload) {
      st.reload = true;
      st.reloadTitle = said.text;
      st.done = { at: now(), text: said.text };
      paint();
      return;
    }
    if (said.ok) {
      // 빨리 감기로 받았으니 올라간 곳과 같다 — 다시 확인하지 않고 곧바로 받기 완료(✓)
      const was = st.last?.ok ? st.last : {};
      st.last = { ...was, ok: true, behind: 0, ahead: r.pulled ? 0 : was.ahead || 0, commits: [], overlap: [], carry: [], fetchError: '' };
      st.at = now();
      st.done = { at: now(), text: said.text };
      paint();
      return;
    }
    await check({ quiet: false, show: false });
    // 못 받았으면 그 까닭을 풍선 말 맨 위에 둔다(다른 탭에서는 상태 줄이 보이지 않는다).
    if (!said.ok) button.title = `${said.text}\n\n${button.title}`;
  }

  async function click() {
    if (st.busy) return;
    if (st.reload) {
      log('git', true, '받은 것을 반영하려고 확장을 다시 불러옴');
      reload();
      return;
    }
    if (gitView(st.last).mode === 'new') return pull();
    return check({ quiet: false });
  }

  return {
    /** 패널을 열 때 한 번 보고, 그 뒤로는 GIT_CHECK_MS 마다 본다. */
    start() {
      button.addEventListener('click', click);
      check({ quiet: false });
      setInterval(() => check(), GIT_CHECK_MS);
    },
    check, click, state: st,
  };
}
