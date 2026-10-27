/* Help Chat 줄 — 패널 맨 아래의 한 줄 입력 + 한 줄 상태(누르면 로그 펼침). 안 되는 점·고칠 점을 한 줄로 보내면 이 PC 의 Claude Code 가 이 확장 폴더에서
 * 디버깅하고 직접 고치며, 요청하면 git 커밋·푸시·포크까지 한다(2026-10-24 사용자 지정: "rerp의 help chat 위치를 똑같이 넣어주고 LLM 설정 탭에서 안보이게 할 수 있도록" ·
 * "help chat을 두고.. 잘 안되는 부분을 디버깅 하거나 개선해야할 점을 직접 수정할 수 있다. 깃 커밋/푸쉬/포크등을 할 수 있다"). kr_ext_rerp 의 popup/help.js 를 옮긴 것이고,
 * 다른 점은 서버 대신 다리(native/host.mjs → native/helpchat.mjs 가 떼어 띄운 실행기)에 묻는다는 것 하나 — 다리만 연결하면 따로 띄울 것이 없다.
 * 일부러 독립 스크립트(모듈이 아님): sidepanel.js 나 다른 모듈이 (잘못된 수정으로) 깨져 있어도 이 줄로 다시 고쳐 달라고 할 수 있게, 다리에 직접 말하고(chrome.runtime.sendNativeMessage)
 * 연결 지침 글(src/bridgeguide.js)만 누를 때 불러온다 — 그것도 못 부르면 짧은 글로 대신한다.
 * 작업은 다리 쪽에서 계속 돌므로 패널을 닫아도 되고, 마지막 요청은 storage.local.helpChat = { id, text, at, state(running|done|error|canceled), summary, error, files, checks, endedAt, applied } 에 남겨
 * 다시 열 때 이어 본다(쓰던 글은 helpDraft). "새 대화"는 다음 요청을 이전 대화와 잇지 않는다(helpChat = { fresh: true }). 끝나면 "적용" = chrome.runtime.reload()
 * (확장 파일이 바뀌었고 문법 검사가 통과했을 때만). 줄 보이기는 storage.local.helpChatShow(기본 켬) — 설정 → LLM 의 스위치 #helpChatShow 도 여기서 배선한다(숨겨도 도는 작업은 그대로).
 * 첫 칸이 도는 동안에는 그 아래에 둘째 칸(#helpLane2 — id 끝에 2, 저장은 helpChat2·helpDraft2)이 서서 따로 함께 도는 요청을 하나 더 보낸다(2026-10-27 사용자 지정:
 * "help 책으로 작업중이면 입력칸을 하나 더 추가 해서 추가 작업도 할 수 있게") — 다리의 lane '2', 대화도 따로 잇는다. 둘째 칸은 ✕(#helpClose2)로 비우고 닫는다(2026-10-27).
 * 입력칸에 붙여 넣은 그림(화면 캡처)은 '그림 N'(#helpPics)으로 서서 다음 요청의 images 로 간다(2026-10-27). */
(() => {
  const HOST = 'com.krs.meetingroom', SHOW = 'helpChatShow';
  const ASK_MS = 20000, JOB_MS = 12000;
  const $ = (id) => document.getElementById(id);
  const bar = $('helpbar'), toggle = $('helpChatShow'), btnCap = $('helpCap'), btnPics = $('helpPics');
  if (!bar || !$('helpForm')) return;
  let capture = null;   // 패널 캡처로 고른 것 { count, code } — 다음 요청의 context.capture 로 실려 간다(sidepanel.js 의 'help-capture', 2026-10-26). 먼저 보내는 칸이 가져간다
  /* 입력칸에 붙여 넣은 그림 [{ type, dataUrl }] — 다음 요청의 images 로 실려 가고, 다리가 파일로 두어 Claude 가 본다(native/helpchat.mjs 의 keepShots,
   * 2026-10-27 사용자 지정: "캡쳐한걸 붙여 넣기가 안되는데 기능을 추가 해줘"). 캡처처럼 먼저 보내는 칸이 가져간다 */
  let pics = [];
  const PIC_MAX = 4, PIC_BYTES = 5 * 1024 * 1024;
  const SHUT = 'helpShut2';   // 둘째 칸을 ✕ 로 닫은 때 돌던 첫 칸 작업의 id — 그 작업이 도는 동안은 다시 세우지 않는다
  let shut = '';
  /** 붙여 넣은 그림을 읽어 pics 에 더한다. 못 넣은 까닭은 say 로. */
  async function addPics(files, say) {
    const skip = [];
    for (const f of files) {
      if (pics.length >= PIC_MAX) { skip.push(`그림은 ${PIC_MAX}장까지입니다`); break; }
      if (f.size > PIC_BYTES) { skip.push(`그림이 너무 큽니다(${Math.round(f.size / 1048576)}MB — 5MB 까지)`); continue; }
      try {
        const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(f); });
        pics.push({ type: f.type || 'image/png', dataUrl });
      } catch (e) { skip.push(`그림을 읽지 못했습니다(${(e && e.message) || e})`); }
    }
    paintLanes();
    if (skip.length) say(skip.join(' · '));
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const hms = (t) => { const d = new Date(t); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':'); };
  // 받은 뒤 확장을 다시 불러오지 않아도 되는 파일 — 브라우저가 싣지 않는 것(설명·요구·설계·검사·도구·다리·스킬). native/gitsync.mjs 의 NO_RELOAD 에 spec·docs·*.md 를 더한 것.
  const NO_RELOAD = /^(README\.md$|test\/|tools\/|native\/|gmail\/|\.claude\/|spec\/|docs\/)|\.md$/i;
  const needsReload = (files) => (files || []).some((f) => !NO_RELOAD.test(f));
  /* 창 맨 아래에 붙은 띠라 본문 끝이 그 밑에 가리지 않게 — 띠의 높이(숨으면 0, 상태 줄·로그를 펼치면 커짐)를 --helpbar-h 로 (sidepanel.css 의 body padding-bottom).
   * 높이를 바꾸는 것은 거의 다 render·paintShow 를 거치므로 거기서 바로 잰다 */
  const pad = () => { try { document.documentElement.style.setProperty('--helpbar-h', `${bar.offsetHeight}px`); } catch (e) {} };

  /** 다리에 한 번 묻는다. 닿지 않으면 offline, 다리가 Help Chat 을 모르면(다른 폴더의 옛 다리가 등록됨) old. */
  async function call(msg, ms) {
    let timerId;
    try {
      const r = await Promise.race([
        chrome.runtime.sendNativeMessage(HOST, msg),
        new Promise((_, reject) => { timerId = setTimeout(() => reject(Object.assign(new Error(`${ms / 1000}초 안에 다리가 답하지 않았습니다`), { slow: true })), ms); }),
      ]);
      if (r && r.ok === false && /알 수 없는 작업/.test(String(r.error || ''))) return { ok: false, kind: 'old', error: '등록된 다리가 Help Chat 을 모릅니다 — 다른 폴더(옛 사본)의 다리가 등록돼 있습니다. 설정 프롬프트를 복사해 다시 연결하세요' };
      return r && typeof r === 'object' ? r : { ok: false, kind: 'parse', error: '다리의 답을 읽지 못했습니다' };
    } catch (e) {
      if (e && e.slow) return { ok: false, kind: 'slow', error: e.message };
      return { ok: false, kind: 'offline', error: `다리에 닿지 않습니다 (${String((e && e.message) || e).slice(0, 120)}) — 설정 프롬프트를 복사해 Claude Code 에 붙여 넣으면 연결합니다` };
    } finally { clearTimeout(timerId); }
  }

  /* 요청에 붙이는 화면 상태: 무엇을 보고 있었는지와 상태 줄만 (예약·근태 같은 내용은 보내지 않음) */
  function context() {
    const out = { from: '사이드 패널 Help Chat' };
    try { out.version = chrome.runtime.getManifest().version; } catch (e) {}
    const tab = document.querySelector('.tabs [role="tab"][aria-selected="true"]');
    if (tab) out.tab = tab.textContent.trim();
    const title = $('appTitle');
    if (title) out.title = title.textContent.trim();
    const settings = document.querySelector('.settings:not([hidden]) .set-tab[aria-selected="true"]');
    if (settings) out.settings = settings.textContent.trim();
    const status = $('status');
    if (status && status.textContent.trim()) out.status = status.textContent.trim().slice(0, 200);
    if (capture) out.capture = capture.code;   // 맨 끝 — 다리가 상태를 4000자로 자를 때 잘리는 것은 이것만
    return out;
  }

  /** 입력 한 칸과 그 상태 줄·로그 — 첫 칸('')과 둘째 칸('2'). 칸마다 제 작업·저장 키, 다리에는 lane 으로 따로 돌고 대화도 따로 잇는다. */
  function lane(sfx) {
    const KEY = `helpChat${sfx}`, DRAFT = `helpDraft${sfx}`;
    const g = (id) => $(`${id}${sfx}`);
    const form = g('helpForm'), input = g('helpText'), btnSend = g('helpSend'), row = g('helpRow'), statusEl = g('helpStatus'), linesEl = g('helpLines'),
      btnApply = g('helpApply'), btnStop = g('helpStop'), btnNew = g('helpNew'), btnSetup = g('helpSetup'), btnClose = g('helpClose');   // 닫기 ✕ 는 둘째 칸에만
    let cur = null, lines = [], next = 0, detail = '', timer = 0, tick = 0, note = null /* { text, err, setup } 다리 연결 안내 등 일시 문구 */, open = false;
    const save = () => { try { return chrome.storage.local.set({ [KEY]: cur }); } catch (e) { return Promise.resolve(); } };
    const placeholder = input.placeholder;

    function render() {
      const running = !!(cur && cur.state === 'running');
      const has = !!(cur && cur.id);
      row.hidden = !has && !note;
      let text = '', cls = '';
      if (note) { text = note.text; cls = note.err ? 'err' : ''; }
      else if (running) {   // 한 줄 상태에는 마지막 진행 줄 (도구가 한 번 거절·실패한 줄은 곧 다른 방법으로 넘어가므로 펼친 로그에만)
        const last = lines.filter((l) => l.k !== 'warn').pop();
        text = `⏳ ${mmss(Date.now() - cur.at)} · ${(last && last.s) || '요청을 보냈습니다'}`; cls = 'run';
      } else if (has && cur.state === 'done') {
        const bad = (cur.checks || [])[0], n = (cur.files || []).length;
        text = `${cur.applied ? '✔ 적용됨' : '✔ 완료'} — ${cur.summary || ''}${n ? ` · 수정 ${n}개` : ''}${bad ? ` · ⚠ 문법 오류 ${bad.file}${needsReload([bad.file]) ? ' (적용 보류 — 고쳐 달라고 다시 요청하세요)' : ''}` : ''}`;
        cls = bad ? 'err' : 'ok';
      } else if (has) { text = `${cur.state === 'canceled' ? '■ 중지됨' : '✖ 실패'} — ${cur.error || ''}`; cls = 'err'; }
      statusEl.textContent = text; statusEl.className = `help-status ${cls}`;
      statusEl.title = has ? `요청: ${cur.text || ''}\n(누르면 로그 펼치기/접기)` : '';
      btnStop.hidden = !running || !!note;
      btnApply.hidden = !(has && cur.state === 'done' && !cur.applied && needsReload(cur.files) && !needsReload((cur.checks || []).map((c) => c.file)));
      btnNew.hidden = running || !has;
      btnSetup.hidden = !(note && note.setup);   // 다리에 닿지 못했을 때만 (note.setup = 그때 본 까닭 한 줄)
      if (btnClose) btnClose.hidden = running;   // 도는 작업은 중지한 뒤에 닫는다
      btnSend.disabled = running; input.disabled = running;
      input.placeholder = running ? '처리 중… (패널을 닫아도 계속됩니다)' : placeholder;   // 커밋·푸시·포크는 줄의 풍선 말에
      linesEl.hidden = !open || !has;
      if (!linesEl.hidden) {
        const stick = linesEl.scrollTop + linesEl.clientHeight >= linesEl.scrollHeight - 8;
        linesEl.innerHTML = lines.map((l) => `<div class="help-line ${esc(l.k)}"><span class="t">${hms(l.t)}</span> ${esc(l.s)}</div>`).join('')
          + (!running && detail && detail.includes('\n') ? `<div class="help-detail">${esc(detail)}</div>` : '')
          + (!running && (cur.files || []).length ? `<div class="help-line info">바뀐 파일: ${esc(cur.files.join(', '))}</div>` : '');
        if (stick) linesEl.scrollTop = linesEl.scrollHeight;
      }
      paintLanes();
    }

    function stopTimers() { clearTimeout(timer); clearInterval(tick); timer = 0; tick = 0; }
    async function poll() {
      if (!cur || !cur.id) return;
      const id = cur.id;
      const r = await call({ task: 'helpJob', id, since: next }, JOB_MS);
      if (!cur || cur.id !== id) return;   // 그 사이 새 대화·새 요청
      if (r.ok) {
        note = null;
        lines = lines.concat(r.lines || []); next = r.next || lines.length;
        const j = r.job || {};
        detail = j.detail || '';
        if (j.state !== 'running' || cur.state !== 'running' || !cur.text) {
          const was = cur.state;
          cur = Object.assign({}, cur, { text: cur.text || j.text || '', at: j.startedAt || cur.at, state: j.state, summary: j.summary || '', error: j.error || '', files: j.files || [], checks: j.checks || [], endedAt: j.endedAt || 0 });
          if (was !== cur.state) await save();
        }
      } else if (r.kind === 'nojob') { cur = Object.assign({}, cur, { state: 'error', error: '다리에 이 요청의 기록이 없습니다 (기록이 지워졌거나 다른 폴더의 다리)' }); await save(); }
      else if (cur.state === 'running') note = { text: `${r.error} · 다시 연결하는 중…`, err: true, setup: r.kind === 'offline' || r.kind === 'old' ? r.error : '' };
      render();
      if (cur && cur.state === 'running') timer = setTimeout(poll, r.ok ? 1500 : 5000); else stopTimers();
    }
    function watch() {
      stopTimers();
      if (cur && cur.state === 'running') tick = setInterval(render, 1000);
      poll();
    }

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const sent = pics;
      const text = input.value.trim() || (sent.length ? '붙인 그림을 봐 주세요' : '');
      if (!text || (cur && cur.state === 'running')) return;
      btnSend.disabled = true;
      note = { text: '요청을 보내는 중…' }; render();
      const fresh = !!(cur && cur.fresh);
      const r = await call({ task: 'helpAsk', text, context: context(), fresh, lane: sfx, ...(sent.length ? { images: sent } : {}) }, ASK_MS);
      if (r.ok || (r.kind === 'busy' && r.id)) {   // busy: 앞선 요청(다른 창에서 보냈거나 저장이 안 된 것)을 이어서 본다 — 쓴 글은 그대로 둠
        cur = { id: r.id, text: r.ok ? text : '', at: Date.now(), state: 'running' };
        lines = []; next = 0; detail = ''; note = null;
        if (r.ok) { input.value = ''; capture = null; if (pics === sent) pics = []; try { chrome.storage.local.remove(DRAFT); } catch (e) {} }
        await save();
        watch();
      } else { note = { text: r.error || '요청을 보내지 못했습니다', err: true, setup: r.kind === 'offline' || r.kind === 'old' ? r.error : '' }; render(); btnSend.disabled = false; }
    });
    // 그림 붙여 넣기 — 클립보드에 그림이 있으면 받고, 공문·근태 탭이 document 에서 받는 붙여넣기(문서 넣기)로 가지 않게 여기서 멈춘다. 글이면 여느 붙여넣기.
    input.addEventListener('paste', (ev) => {
      const files = [...((ev.clipboardData && ev.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type));
      if (!files.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      addPics(files, (s) => { note = { text: s, err: true }; render(); });
    });
    input.addEventListener('input', () => { try { chrome.storage.local.set({ [DRAFT]: input.value }); } catch (e) {} if (note && (note.err || note.setup)) { note = null; render(); } });   // 글을 고치면 오류·설정 프롬프트 안내는 치움
    statusEl.addEventListener('click', () => { if (cur && cur.id) { open = !open; render(); if (open) linesEl.scrollTop = linesEl.scrollHeight; } });
    btnStop.addEventListener('click', async () => { btnStop.disabled = true; await call({ task: 'helpCancel', lane: sfx }, JOB_MS); btnStop.disabled = false; clearTimeout(timer); poll(); });
    btnApply.addEventListener('click', async () => {   // 확장을 다시 불러와 바뀐 코드를 적용 (패널은 닫힌다 — 다시 열면 된다)
      cur = Object.assign({}, cur, { applied: true }); await save();
      try { chrome.runtime.reload(); } catch (e) { note = { text: '다시 불러오지 못했습니다 — chrome://extensions 에서 새로고침하세요', err: true }; render(); }
    });
    btnNew.addEventListener('click', async () => { stopTimers(); cur = { fresh: true }; lines = []; next = 0; detail = ''; note = null; open = false; await save(); render(); input.focus(); });
    btnSetup.addEventListener('click', async () => {
      const reason = (note && note.setup) || '';
      let ok = false;
      try { await navigator.clipboard.writeText(await setupText(reason)); ok = true; } catch (e) { note = { text: `복사하지 못했습니다: ${e.message}`, err: true, setup: reason }; }
      if (ok) note = { text: '설정 프롬프트를 복사했습니다 — 이 PC 의 Claude Code(VS Code)·다른 LLM 에 붙여 넣으면 다리를 연결합니다', setup: reason };
      render();
    });

    return {
      form, input, wrap: g('helpLane'), keys: [KEY, DRAFT], render, btnClose,
      id: () => (cur && cur.id) || '',
      /** 이 칸을 비운다 — 결과·로그·쓰던 글(저장소의 것까지). 도는 중이면 하지 않는다. */
      clear() {
        if (cur && cur.state === 'running') return false;
        stopTimers(); cur = null; lines = []; next = 0; detail = ''; note = null; open = false; input.value = '';
        try { chrome.storage.local.remove([KEY, DRAFT]); } catch (e) {}
        render();
        return true;
      },
      running: () => !!(cur && cur.state === 'running'),
      busy: () => !!((cur && cur.id) || note),   // 제 작업(도는 것·끝난 결과)이나 안내가 떠 있다
      load(l) {   // 저장소에서 읽은 것으로 시작 — 진행 중이면 이어서 보고, 끝난 것도 로그를 다시 받아 둔다
        cur = l[KEY] || null;
        if (l[DRAFT] && !input.value) input.value = String(l[DRAFT]);
        render();
        if (cur && cur.id) watch();
      },
    };
  }

  const lanes = [lane('')];
  if ($('helpLane2')) lanes.push(lane('2'));
  /** 둘째 칸은 첫 칸이 도는 동안(그 뒤에도 제 작업·쓰던 글이 있으면) 선다. '캡처 N' 은 보낼 수 있는 칸 — 첫 칸이 돌면 둘째 — 의 입력칸 옆으로. */
  function paintLanes() {
    const [one, two] = lanes;
    // ✕ 로 닫았으면 그때 돌던 첫 칸의 작업이 끝날 때까지(다음 요청이 돌 때 다시) 세우지 않는다.
    if (two) two.wrap.hidden = !((one.running() && one.id() !== shut) || two.busy() || two.input.value.trim());
    const at = two && one.running() && !two.wrap.hidden ? two : one;
    if (btnCap) {
      if (btnCap.nextElementSibling !== at.input) at.form.insertBefore(btnCap, at.input);
      btnCap.hidden = !capture;
      btnCap.textContent = capture ? `캡처 ${capture.count}` : '';
      btnCap.title = capture ? `보낼 때 함께 가는 캡처(누르면 빼기)\n\n${capture.code.slice(0, 1500)}` : '';
    }
    if (btnPics) {   // '그림 N' 은 '캡처 N' 앞
      const before = btnCap || at.input;
      if (btnPics.nextElementSibling !== before) at.form.insertBefore(btnPics, before);
      btnPics.hidden = !pics.length;
      btnPics.textContent = pics.length ? `그림 ${pics.length}` : '';
      btnPics.title = pics.length ? '보낼 때 함께 가는 붙여 넣은 그림(누르면 빼기)' : '';
    }
    pad();
  }
  document.addEventListener('help-capture', (e) => { const d = e.detail || {}; capture = d.count ? { count: d.count, code: String(d.code || '') } : null; paintLanes(); });
  if (btnCap) btnCap.addEventListener('click', () => { const at = lanes.find((x) => x.form.contains(btnCap)); capture = null; paintLanes(); if (at) at.input.focus(); });
  // 패널 캡처를 끝내면 고른 곳의 그림이 온다(sidepanel.js 의 shootPicked, 2026-10-27 "캡쳐하면 그낭 자동으로 복사하고 묻지 말고 붙여 넣어줘") — 앞의 캡처 그림은 바꾼다.
  document.addEventListener('help-picture', (e) => {
    const d = e.detail || {};
    if (!/^data:image\//.test(String(d.dataUrl || ''))) return;
    pics = pics.filter((p) => !p.cap).concat({ type: d.type || 'image/png', dataUrl: String(d.dataUrl), cap: true }).slice(-PIC_MAX);
    paintLanes();
  });
  if (btnPics) btnPics.addEventListener('click', () => { const at = lanes.find((x) => x.form.contains(btnPics)); pics = []; paintLanes(); if (at) at.input.focus(); });
  const second = lanes[1];
  if (second && second.btnClose) second.btnClose.addEventListener('click', () => {
    if (!second.clear()) return;
    shut = lanes[0].running() ? lanes[0].id() : '';
    try { chrome.storage.local.set({ [SHUT]: shut }); } catch (e) {}
    paintLanes();
    lanes[0].input.focus();
  });

  /* [설정 프롬프트 복사]: 다리를 아직 못 붙인 PC 에서 Claude Code·다른 LLM 에 붙여 넣을 글 — 머리의 B 와 같은 글(src/bridgeguide.js — 같은 PC 의 rERP 확장도 함께 연결).
   * 그 모듈을 못 부르면 짧은 글로 (이 스크립트의 독립성 유지) */
  async function setupText(reason) {
    let id = '', version = '';
    try { id = chrome.runtime.id || ''; version = chrome.runtime.getManifest().version; } catch (e) {}
    try {
      const g = await import('./src/bridgeguide.js');
      return g.bridgeGuide({ id, ...(await g.bridgeRoot(id)), error: reason || '', version, userAgent: navigator.userAgent, peer: await g.findPeer() });
    } catch (e) {
      return `KRS WORKSPACE 브라우저 확장(확장 ID ${id || '알 수 없음'})에 이 PC 의 Claude Code CLI 를 연결해 주세요.\n증상: ${reason || '다리에 닿지 않습니다'}\n확장 폴더에서 .claude\\skills\\bridge\\bridge_ops.ps1 check → install <확장 ID> → restart 순서로 돌리고, 자세한 것은 README.md 의 "로컬 CLI 연결"을 따릅니다. 확장 코드는 고치지 마세요.`;
    }
  }

  try { new ResizeObserver(() => pad()).observe(bar); } catch (e) {}   // 창 폭이 바뀌어 글이 줄을 바꿀 때 (render 가 아닌 데서 높이가 바뀌는 경우)

  /* 줄 보이기 — 설정 → LLM 의 스위치. 다른 창에서 바꿔도 따라간다 */
  const paintShow = (on) => { bar.hidden = !on; if (toggle) toggle.checked = on; pad(); };
  if (toggle) toggle.addEventListener('change', () => { paintShow(toggle.checked); try { chrome.storage.local.set({ [SHOW]: toggle.checked }); } catch (e) {} });
  try { chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[SHOW]) paintShow(changes[SHOW].newValue !== false); }); } catch (e) {}

  (async () => {
    let l = {};
    try {
      l = await chrome.storage.local.get([SHOW, SHUT, ...lanes.flatMap((x) => x.keys)]);
      shut = String(l[SHUT] || '');
      paintShow(l[SHOW] !== false);
    } catch (e) {}
    for (const x of lanes) x.load(l);
  })();
})();
