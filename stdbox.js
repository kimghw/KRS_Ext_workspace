// 공문 탭의 국제표준 업로드 칸 — 공문 이력 다음(공문 설정 위)(2026-10-30 사용자 지정: "양식 공문이력 다음에 국제표준 업로드 할 수 있도록 해주고 pdf 표준 주면 업로드 해주고 …
// zip 이면 풀어서 업로드 하고, pdf 여러개 주면 자동 업로드 해주고. 파일 드래그 하거나 파일 익스플로러에서 선택해서 넣을 수 있게").
//
// 칸(접혀 있어도 그 위)에 끌어 놓거나 넣는 곳을 눌러 고른 PDF·ZIP(풀어서 안의 PDF)을 하나씩 e-Class 「Standard Documents」 게시판에 글 하나로 올린다.
// 파일마다 표지를 읽어(doctext pdfCover — pdf.js) 표준번호·표준명·분류를 정하고(src/stdboard.js stdFromPdf), board.standard 기록 하나를 지어 디스패처로 차례로 돌린다
// (actions/spec/board/standard.yaml — 넣은 누름이 확인이다). 같은 표준이 이미 있으면 실행기가 올리지 않고 그 글을 가리킨다. 표준명을 못 읽은 파일은 그 줄에 적는 칸이 서고
// 적고 올리기를 누를 때 돈다. 줄마다 표준번호 · 표준명 · 분류 · 형편(읽는 중 · 기다림 · 올리는 중 · 올림 #번호 · 이미 있음 · 실패 — 실패는 다시).
// 작성자는 로그인한 사람으로 사이트가 정한다 — 이름을 부서로 보일지(기본, 게시판 관례)·내 이름으로 보일지만 머리 줄에서 고른다(WRITER_KEY, 2026-10-30 사용자 지정:
// "writer 를 내가 선택할 수 있을진 모르겠다. 자동 선택이구나"). 줄은 패널을 연 동안만 있다(올린 기록은 활동 로그에).
// 끌어 놓기는 여기서 받고 공문 탭 전체의 끌어 놓기(참고 문서 — gongmunpanel.js)로 번지지 않게 막는다. 비교작성 탭에서는 서지 않는다.

import { stdFromPdf, stdSubject, stdCategory, STD_CATEGORY_LABEL, STD_LIST_URL } from './src/stdboard.js';
import { unzipEntries } from './src/officetext.js';

/** 작성자 표시 — 'dept' 부서 · 'me' 내 이름. */
export const WRITER_KEY = 'stdWriter';
/** ZIP 을 풀어 낼 바이트의 합 — 표준 묶음은 크다(2026-10-30 KSSN 묶음 열세 개가 47MB). */
const UNZIP_MAX = 600 * 1024 * 1024;

const isZip = (f) => /\.zip$/i.test(f.name || '') || /zip/i.test(f.type || '');
const isPdf = (f) => /\.pdf$/i.test(f.name || '') || f.type === 'application/pdf';
const baseName = (p) => String(p).replace(/^.*[\\/]/, '');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const messageOf = (err) => (Array.isArray(err?.problems) && err.problems.length ? err.problems.join(', ') : String(err?.message || err));

/** 형편 → 줄에 보일 글·꼴. */
const STATE = {
  read: ['읽는 중', 'st-going'],
  need: ['표준명 필요', 'st-back'],
  wait: ['기다림', ''],
  run: ['올리는 중', 'st-going'],
  posted: ['올림', 'st-done'],
  exists: ['이미 있음', 'st-done'],
  unverified: ['확인 못 함', 'st-back'],
  fail: ['실패', 'st-back'],
  skip: ['건너뜀', ''],
};

/**
 * @param {{ doc?: Document, storage?: object, actions?: object|null, me?: () => string, openTab?: (url: string) => unknown,
 *   readCover?: (bytes: Uint8Array) => Promise<{meta: string, text: string}>, compareTab?: string }} [deps]
 *   readCover 는 PDF 의 메타데이터 제목·첫 쪽 글(기본 doctext/browser.js pdfCover — 꾸러미가 없으면 던지고, 그러면 파일 이름으로만 읽는다)
 */
export function createStdBox({
  doc = document, storage = chrome.storage.local, actions = null, me = () => '', openTab = (url) => chrome.tabs.create({ url }),
  readCover = async (bytes) => (await import('./doctext/browser.js')).pdfCover(bytes), compareTab = '',
} = {}) {
  const $ = (id) => doc.getElementById(id);
  const box = $('gmStdBox');
  const el = { state: $('gmStdState'), file: $('gmStdFile'), intake: $('gmStdIntake'), writer: $('gmStdWriter'), list: $('gmStdList'), open: $('gmStdOpen'), clear: $('gmStdClear') };
  // rows: 넣은 파일마다 { key, name, size, from, bytes, designation, title, category, state, stage, note, id, url } · writer: 'dept'|'me' · running: 올리는 중인가
  const st = { rows: [], writer: 'dept', running: false, seq: 0 };

  function paintState() {
    const n = (s) => st.rows.filter((r) => r.state === s).length;
    const left = n('read') + n('wait') + n('run');
    const parts = [n('posted') && `올림 ${n('posted')}`, n('exists') && `있음 ${n('exists')}`, left && `남음 ${left}`, (n('fail') + n('need') + n('unverified')) && `확인 ${n('fail') + n('need') + n('unverified')}`].filter(Boolean);
    el.state.textContent = parts.join(' · ');
    el.clear.hidden = !st.rows.some((r) => !['read', 'wait', 'run'].includes(r.state));
    el.intake.setAttribute('aria-busy', String(left > 0));
  }

  function paintWriter() {
    for (const b of el.writer.querySelectorAll('[data-writer]')) {
      const on = b.dataset.writer === st.writer;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
  }

  function rowHtml(r) {
    const [label, cls] = STATE[r.state] || ['', ''];
    const head = r.designation ? `${r.designation}${r.title ? ` - ${r.title}` : ''}` : r.name;
    const cat = r.designation ? `<span class="gm-std-cat">${esc(STD_CATEGORY_LABEL[r.category] || '기타')}</span>` : '';
    const link = r.url && r.id ? ` <a href="${esc(r.url)}" data-open="${esc(r.url)}">#${esc(r.id)}</a>` : '';
    const stage = r.state === 'run' && r.stage ? ` — ${esc(r.stage)}` : '';
    const note = r.note ? `<span class="gm-std-note">${esc(r.note)}</span>` : '';
    const sub = `${esc(r.name)} · ${sizeText(r.size)}${r.from ? ` · ${esc(r.from)}` : ''}`;
    let more = '';
    if (r.state === 'need') {
      more = `<div class="gm-std-fix">${r.designation ? '' : `<input type="text" data-fix="designation" placeholder="표준번호 (예: IEC TS 63336:2024)" value="${esc(r.designation)}" />`}`
        + `<input type="text" data-fix="title" placeholder="표준명 (영문)" value="${esc(r.title)}" /><button type="button" class="primary small" data-go="${r.key}">올리기</button></div>`;
    } else if (r.state === 'fail' && r.bytes) {
      more = `<div class="gm-std-fix"><button type="button" class="ghost small" data-go="${r.key}">다시</button></div>`;
    }
    return `<li class="gm-std-item ${cls}" data-key="${r.key}"><div class="gm-std-row"><span class="gm-hist-st">${label}</span>${cat}`
      + `<span class="gm-std-sum" title="${esc(head)}">${esc(head)}</span></div>`
      + `<span class="gm-std-sub">${sub}${link}${stage}</span>${note}${more}</li>`;
  }

  function paint() {
    // 적던 칸(표준명 필요)의 글과 커서는 다시 그려도 남긴다.
    const typing = doc.activeElement?.closest?.('#gmStdList [data-fix]') ? { key: doc.activeElement.closest('[data-key]')?.dataset.key, fix: doc.activeElement.dataset.fix, pos: doc.activeElement.selectionStart } : null;
    for (const input of el.list.querySelectorAll('[data-fix]')) {
      const row = st.rows.find((r) => String(r.key) === input.closest('[data-key]')?.dataset.key);
      if (row && row.state === 'need') row[input.dataset.fix] = input.value;
    }
    el.list.innerHTML = st.rows.map(rowHtml).join('');
    if (typing) {
      const back = el.list.querySelector(`[data-key="${typing.key}"] [data-fix="${typing.fix}"]`);
      if (back) { back.focus(); try { back.setSelectionRange(typing.pos, typing.pos); } catch { /* 커서 없이 */ } }
    }
    paintState();
  }

  /** 넣은 파일을 줄로 — ZIP 은 풀어 안의 PDF 마다. 같은 이름·크기의 줄이 이미 있으면(다시 넣음) 더하지 않는다. */
  async function expand(files) {
    const out = [];
    const add = (name, bytes, from = '') => {
      if (st.rows.some((r) => r.name === name && r.size === bytes.length && r.state !== 'fail') || out.some((r) => r.name === name && r.size === bytes.length)) return;
      out.push({ key: ++st.seq, name, size: bytes.length, from, bytes, designation: '', title: '', category: 'ETC', state: 'read', stage: '', note: '' });
    };
    for (const f of files) {
      try {
        if (isZip(f)) {
          const map = await unzipEntries(new Uint8Array(await f.arrayBuffer()), { want: (n) => /\.pdf$/i.test(n) && !/(^|\/)__MACOSX\//.test(n), maxBytes: UNZIP_MAX });
          if (!map.size) out.push({ key: ++st.seq, name: f.name, size: f.size, state: 'skip', note: 'ZIP 안에 PDF 가 없습니다' });
          for (const [path, bytes] of map) add(baseName(path), bytes, f.name);
        } else if (isPdf(f)) {
          add(f.name, new Uint8Array(await f.arrayBuffer()));
        } else {
          out.push({ key: ++st.seq, name: f.name, size: f.size, state: 'skip', note: 'PDF·ZIP 만 올립니다' });
        }
      } catch (err) {
        out.push({ key: ++st.seq, name: f.name, size: f.size || 0, state: 'skip', note: `열지 못했습니다 — ${messageOf(err)}` });
      }
    }
    return out;
  }

  /** 표지를 읽어 표준번호·표준명을 정한다. 꾸러미가 없거나 읽지 못하면 파일 이름으로만 — 표준명이 없으면 적어 달라고 선다. */
  async function readRow(r) {
    let cover = { meta: '', text: '' };
    try {
      cover = await readCover(r.bytes);
    } catch (err) {
      r.note = `PDF 를 읽지 못해 파일 이름으로만 — ${messageOf(err)}`;
    }
    Object.assign(r, stdFromPdf({ name: r.name, ...cover }));
    r.state = r.designation && r.title ? 'wait' : 'need';
  }

  /** 기다리는 줄을 하나씩 올린다(앞의 것이 끝나야 다음). */
  async function pump() {
    if (st.running) return;
    st.running = true;
    try {
      for (let r = st.rows.find((x) => x.state === 'wait'); r; r = st.rows.find((x) => x.state === 'wait')) await upload(r);
    } finally {
      st.running = false;
      paint();
    }
  }

  async function upload(r) {
    r.state = 'run';
    r.stage = '';
    r.note = '';
    paint();
    try {
      const input = { designation: r.designation, title: r.title, category: r.category, writer: st.writer, file: { name: r.name, type: 'application/pdf' } };
      const { record } = actions.build('board.standard', { input, preset: { me: me() || null } });
      const res = await actions.run(record, {
        confirmed: record.hash, bytes: r.bytes, text: `국제표준 ${stdSubject(r.designation, '')} 올리기`,
        onStage: (text) => { r.stage = text; paint(); },
      });
      r.state = res?.status === 'posted' || res?.status === 'exists' ? res.status : 'unverified';
      // 이미 있는 글은 제목이 다를 때만(옛 꼴로 올린 글) 그 제목을 적는다.
      const other = res?.subject && res.subject !== stdSubject(r.designation, r.title) ? `있는 글: ${res.subject}` : '';
      Object.assign(r, { id: res?.id || '', url: res?.url || '', note: res?.status === 'exists' ? other : (res?.note || '') });
      if (r.state !== 'unverified') r.bytes = null;           // 끝난 파일은 놓는다
    } catch (err) {
      r.state = 'fail';
      r.note = messageOf(err);
    }
    r.stage = '';
    paint();
  }

  async function take(files) {
    if (!files.length || !actions) return;
    box.open = true;
    const rows = await expand(files);
    st.rows.push(...rows);
    paint();
    for (const r of rows.filter((x) => x.state === 'read')) {
      await readRow(r);
      paint();
      pump();
    }
  }

  function onDrag(e) {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();                                     // 공문 탭 전체(참고 문서)로 번지지 않게
    e.dataTransfer.dropEffect = 'copy';
    if (e.type === 'dragleave') {
      if (!box.contains(e.relatedTarget)) el.intake.classList.remove('over');
      return;
    }
    box.open = true;
    el.intake.classList.add('over');
  }

  function onDrop(e) {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    e.stopPropagation();
    el.intake.classList.remove('over');
    take([...e.dataTransfer.files]);
  }

  function onListClick(e) {
    const t = typeof e.target?.closest === 'function' ? e.target : null;
    const open = t?.closest('[data-open]');
    if (open) {
      e.preventDefault();
      openTab(open.dataset.open);
      return;
    }
    const go = t?.closest('[data-go]');
    if (!go) return;
    const r = st.rows.find((x) => String(x.key) === go.dataset.go);
    if (!r) return;
    if (r.state === 'need') {
      const li = go.closest('[data-key]');
      const val = (k) => (li.querySelector(`[data-fix="${k}"]`)?.value ?? r[k] ?? '').trim();
      r.designation = val('designation') || r.designation;
      r.title = val('title');
      if (!r.designation || !r.title) {
        r.note = '표준번호와 표준명을 적어야 올립니다';
        paint();
        return;
      }
      r.category = stdCategory(r.designation);
      r.note = '';
    }
    r.state = 'wait';
    paint();
    pump();
  }

  function wire() {
    if (!box || !actions || compareTab) {
      if (box) box.hidden = true;
      return;
    }
    el.file.addEventListener('change', () => {
      const files = [...(el.file.files || [])];
      el.file.value = '';
      take(files);
    });
    for (const type of ['dragenter', 'dragover', 'dragleave']) box.addEventListener(type, onDrag);
    box.addEventListener('drop', onDrop);
    el.list.addEventListener('click', onListClick);
    el.writer.addEventListener('click', (e) => {
      const b = typeof e.target?.closest === 'function' ? e.target.closest('[data-writer]') : null;
      if (!b) return;
      st.writer = b.dataset.writer === 'me' ? 'me' : 'dept';
      paintWriter();
      storage.set({ [WRITER_KEY]: st.writer });
    });
    el.open.addEventListener('click', () => openTab(STD_LIST_URL));
    el.clear.addEventListener('click', () => {
      st.rows = st.rows.filter((r) => ['read', 'wait', 'run'].includes(r.state));
      paint();
    });
    Promise.resolve(storage.get([WRITER_KEY])).then((saved) => {
      st.writer = saved?.[WRITER_KEY] === 'me' ? 'me' : 'dept';
      paintWriter();
    }).catch(() => paintWriter());
    paint();
  }

  wire();
  return { take, rows: () => st.rows.map(({ bytes, ...r }) => ({ ...r, hasBytes: !!bytes })), idle: async () => { while (st.running || st.rows.some((r) => ['read', 'wait', 'run'].includes(r.state))) await new Promise((res) => setTimeout(res, 10)); } };
}
