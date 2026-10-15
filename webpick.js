// 웹페이지 캡처 단추 둘 — 공문 탭의 문서 넣는 곳(gongmunpanel.js)과 출장 카드의 증빙 넣는 곳(attendpanel.js — 사후정산 칸·여비증빙 송부 칸)이
// **같은 단추**를 쓴다(2026-10-08 사용자 지정: "여기도 웹페이지 카피 공문처럼 하게해줘.. 2개 동일한 기능으로"). 찍는 일은 src/pagecap.js 다.
//
//   [전체]  보고 있는 탭을 위에서 아래까지 통째로 → 찍은 장·화면 글자 → 그 곳의 읽기
//   [부분]  페이지 위에서 프레임(틀·상자)을 눌러 하나 이상 고르고 위쪽 띠의 캡처 → 고른 것만 찍은 장·글자 → 그 곳의 읽기
//
// 2026-10-08 사용자 지정: "탭이 아니라 프레임으로 선택할 수 있지 않냐? … 현재 보고 있는 탭 아이콘 하나.. 그리고 부분적으로 선택할 수 있는
// 버튼 하나" — 그 전에는 이 창의 탭 목록을 펴서 골랐다. 고르는 동안에는 부분 단추가 "고르기 취소"가 되고 탭 단추는 잠긴다.
// 단추 글자는 "전체 · 부분" 이다(같은 날 사용자 지정: "전체, 부분 이라고 써줘,, 전체는 글자가 안보이잖아" — 그 전에는 보고 있는 탭이 아이콘만이었다).
// 한 번에 한 곳에서만 고른다(key — 공문 탭은 'gongmun', 출장 카드는 신청서 번호와 칸). 누름은 data-pick 으로 가린다(그 패널의 data-act 와 겹치지 않게).
//
// 찍은 장을 무엇으로 쓰는지는 곳마다 다르다 — 공문은 장들을 그대로 읽고 문서마다 첨부 PDF 로 묶는다. 출장 증빙은 페이지(고른 부분) 하나를
// PDF 하나로 묶어 증빙 한 장으로 읽는다(pagePdfs — 예약 확인 화면이 A4 석 장이어도 증빙은 하나다).
//
// 2026-10-15 사용자 지정: "첨부파일을 열면 내용이 팝업으로 뜨는데 그 부분도 일부 또는 전체 캡쳐할 수 있나?" — 전체는 페이지 위에 뜬 큰 팝업
// (첨부 미리보기 창)이 있으면 그 안을, 방금 보던 팝업 창이 있으면 그 창을 찍는다(src/pagecap.js 의 captureWhole·frontTab). 무엇을 찍었는지는
// 진행 글과 notes 에 적는다. 한 장씩 넘기는 미리보기(PowerPoint)는 보이는 장만 찍었다고 알린다.
// 같은 날 사용자 지정: "전체 하면 메일이랑 첨부를 같이 가져오고.. 첨부는 파일 자체로 관리하지만 ocr 해서 이것도 필요한 내용으로 넣는 거지.
// 부분으로 첨부파일 클릭하면 첨부파일만 가져오고." — 단추는 그대로 둘이고, 메일 화면이면 둘 다 메일을 안다(메일 읽기는 src/mailgrab.js —
// mail 로 갈아 끼운다, 없으면 여느 웹페이지처럼 찍는다).
//   [전체]  팝업이 떠 있으면 그 팝업 안, 아니고 메일이면 본문 화면(data-krs-cap="mail")을 찍고 본문 글자와 첨부 파일(원본 그대로)을 가져온다
//   [부분]  막을 씌우기 전에 메일 읽기가 첨부 칸에 표시(data-krs-attach)를 달아 두고, 고른 것 가운데 첨부 칸은 그 파일을 가져오고 나머지는 찍는다
// 가져온 원본은 결과의 files 로 준다(부른 곳이 첨부로 쓰고 글자는 따로 읽는다 — 출장 카드·송부 칸은 아직 쓰지 않는다). 다 하면 표시를 뗀다.

import { captureFront, startPick, captureTabParts, watchWindows, clearMarks, MAX_SHOTS } from './src/pagecap.js';
import { buildPdf } from './src/pdf.js';

export const TAB_LABEL = '전체';
export const PART_LABEL = '부분';
export const PART_STOP = '고르기 취소';
/** 보고 있는 탭 — 브라우저 창(위에 탭 점 둘). */
export const TAB_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01"/></svg>';
/** 부분 고르기 — 고르는 칸의 네 귀와 그 안의 상자. */
export const PART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>';
const TAB_TITLE = '전체 캡처 — 이 창에서 보고 있는 웹페이지를 위에서 아래까지 캡처하고 화면의 글자와 함께 읽습니다. '
  + '메일이면 본문과 첨부 파일을 함께 가져오고(첨부는 파일 그대로), 첨부 미리보기 같은 팝업이 페이지 위에 열려 있으면 그 팝업 안을, '
  + '방금 보던 팝업 창이 있으면 그 창을 캡처합니다. 처음 한 번 사이트 접근 권한을 묻습니다.';
const PART_TITLE = '부분 캡처 — 보고 있는 웹페이지 위에서 캡처할 부분(틀·상자 같은 프레임)을 눌러 하나 이상 고르고, 페이지 위쪽 띠의 캡처를 누르면 고른 것만 캡처해 읽습니다. '
  + '메일의 첨부 파일을 누르면 그 파일만 가져옵니다. 틀 안이 따로 내려가는 화면(eClass 본문·첨부 미리보기 등)은 틀 안을 끝까지 찍고, '
  + '방금 보던 팝업 창이 있으면 그 창에서 고릅니다.';
const PICK_HINT = '웹페이지에서 캡처할 부분(프레임)을 누르세요 — 여러 개 고를 수 있고, ↑ 는 더 큰 칸입니다. 다 고르면 페이지 위쪽 띠의 캡처를 누릅니다.';
/** 한 장씩 넘기는 미리보기(PowerPoint 읽기 보기)를 찍었을 때의 알림 — 넘기지 않고 보이는 장만 찍는다(src/pagecap.js 의 paged). */
export const PAGED_NOTE = '슬라이드처럼 한 장씩 넘기는 화면이라 보이는 장만 캡처했습니다 — 파일 전체는 미리보기를 닫고 전체(메일과 첨부)나 부분(첨부 파일 누르기)으로 가져오세요';
/** 메일 읽기(src/mailgrab.js — probeTab·grabTab·fetchTab)를 처음 쓸 때 읽는다. 없으면(테스트·아직 없음) 메일인지 보지 않는다. */
const loadMailgrab = () => import('./src/mailgrab.js');
/** 출장 증빙으로 묶는 장의 JPEG 품질 — PNG 그대로면 그림이 많은 예약 화면 한 페이지가 10MB 를 넘는다. */
const JPEG_QUALITY = 0.85;

/**
 * @param {{front?: Function, start?: Function, parts?: Function, mail?: object|Function|null, unmark?: Function, watch?: Function}} [deps]
 *   front 는 보고 있는 탭을 통째로 찍는 길(plain — 팝업이 없을 때 먼저 불러 보는 길을 받는다), start 는 페이지 위의 고르기를 여는 길
 *   ({tab, done, cancel} — before 를 받는다), parts 는 고른 부분들을 찍는 길, unmark 는 메일 읽기가 단 표시를 떼는 길, watch 는 창이 앞에
 *   서는 것을 적기 시작하는 길이다(방금 보던 팝업 창을 찍으려고 — 한 번만 돈다, chrome.windows 가 없으면 아무것도 하지 않는다)
 *   (src/pagecap.js). mail 은 메일 읽기({probeTab, grabTab, fetchTab} — src/mailgrab.js) 또는 그것을 주는 함수다(null 이면 메일을 보지 않는다).
 *   테스트가 갈아 끼운다.
 */
export function createWebPick({ front = captureFront, start = startPick, parts = captureTabParts, mail = loadMailgrab, unmark = clearMarks, watch = watchWindows } = {}) {
  try {
    watch();
  } catch {
    // 창을 못 지켜보면 팝업 창은 못 찍을 뿐 — 패널의 앞 탭은 그대로 찍는다.
  }
  /** 메일 읽기 — 없거나 읽지 못하면 null(메일인지 보지 않고 여느 웹페이지처럼 찍는다). */
  async function mailer() {
    try {
      const m = typeof mail === 'function' ? await mail() : mail;
      return m && typeof m.probeTab === 'function' ? m : null;
    } catch {
      return null;
    }
  }
  const unmarkTab = (tab) => Promise.resolve().then(() => unmark(tab)).catch(() => {});
  const short = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  /**
   * 전체 — 팝업이 없는 탭이 메일이면(probeTab) 본문 화면을 찍고(parts — 메일 읽기가 data-krs-cap="mail" 을 단 본문, 없으면 건너뛴다) 본문
   * 글자와 첨부 파일(원본)을 가져온다(grabTab). 메일이 아니면 null — 여느 때처럼 통째로 찍는다. 다 하면 표시를 뗀다.
   */
  async function mailWhole(tab, { today, onStatus, onProgress, setWhere }) {
    const m = await mailer();
    if (!m || typeof m.grabTab !== 'function') return null;
    const info = await Promise.resolve().then(() => m.probeTab(tab)).catch(() => null);
    if (!info) return null;
    try {
      setWhere(`메일${info.subject ? `「${short(info.subject)}」` : ''}`);
      let pages = [];
      const failed = [];
      try {
        // 메일 칸 — 메일 읽기가 표시한 그대로 넘긴다(eClass 포털은 쪽지가 틀 안이라 frame 이 있다). 미리보기만 열려 본문이 없으면 건너뛴다.
        const part = info.part ? { ...info.part, title: info.part.title || info.subject || '메일 본문' } : null;
        const body = part ? await parts(tab, [part], { today, onProgress }) : null;
        pages = body?.pages || [];
        failed.push(...(body?.failed || []));
      } catch (err) {
        // 본문 표시가 없으면(메일 읽기가 본문을 못 찾았다) 본문 화면은 건너뛴다 — 본문 글자와 첨부는 아래에서 가져온다.
        if (!/찾지 못했습니다/.test(err?.message || '')) failed.push({ title: '메일 본문', why: err?.message || String(err) });
      }
      const n = Array.isArray(info.attachments) ? info.attachments.length : 0;
      onStatus(n ? `메일 본문과 첨부 파일 ${n}개를 가져오는 중입니다…` : '메일 본문을 가져오는 중입니다…');
      let grab = {};
      const lost = [];
      try {
        grab = (await m.grabTab(tab, { today, onStatus })) || {};
      } catch (err) {
        if (!pages.length) throw err;
        lost.push({ title: '메일 본문·첨부', why: err?.message || String(err), file: true });
      }
      lost.push(...(grab.failed || []).map((f) => ({ title: f.name || '첨부 파일', why: f.why || '', file: true })));
      return {
        pages, failed, lost, files: Array.isArray(grab.files) ? grab.files : [], text: grab.text || '',
        extra: Array.isArray(grab.notes) ? grab.notes : [], also: grab.what || '', mail: grab.mail || info,
      };
    } finally {
      await unmarkTab(tab);
    }
  }
  // 고르는 중이면 그 곳(key)과 페이지의 고르기(handle), 패널에서 그만두는 길(quit).
  const st = { key: null, handle: null, quit: null };
  /** 그 곳에서(key 를 주지 않으면 어디서든) 고르는 중인가. */
  const picking = (key) => !!st.handle && (key == null || st.key === key);

  /** 고르기를 그만둔다 — 페이지의 막을 걷고, 기다리던 shoot 를 풀어 준다(why: 'stop' 이면 그만뒀다고 알리고, 'switch' 면 조용히). */
  function stop(why = 'stop') {
    if (!st.handle) return;
    const { handle, quit } = st;
    Object.assign(st, { key: null, handle: null, quit: null });
    handle.cancel();
    quit(why);
  }

  /** 단추를 눌렀을 때 — {act: 'tab'|'part'}. 이 단추가 아니면 null. 찍는 것은 부른 곳이 shoot 로 한다. */
  function click(e) {
    const btn = e.target instanceof Element ? e.target.closest('button[data-pick]') : null;
    return btn && !btn.disabled ? { act: btn.dataset.pick } : null;
  }

  /**
   * 찍는다. tab 은 보고 있는 탭을 통째로, part 는 페이지 위에서 고르게 한 뒤 고른 부분들을 찍는다 — 그 곳에서 고르는 중에 part 를 다시
   * 누르면 고르기를 그만두고 null 이다. 페이지에서 취소해도 null 이다. 진행은 onStatus 로 알리고(고르기를 시작·마칠 때도 — 부른 곳이
   * 단추를 다시 그린다), 정말 찍기 시작할 때 onStart 를 부른다(부른 곳이 잠근다). 빈 것은 빼고, 너무 길어 앞부분만 찍은 것과 못 찍은 것은
   * notes 로, 기록에 남길 한 줄은 what 으로 준다. 하나도 못 찍었으면 던진다.
   * 2026-10-15: 페이지 위의 팝업(첨부 미리보기 창)이나 방금 보던 팝업 창을 찍으면 진행 글과 notes 에 그곳(where — 팝업 창「제목」)을 적고,
   * 한 장씩 넘기는 미리보기는 보이는 장만 찍었다고(PAGED_NOTE) 적는다. 메일이면(mail 의 probeTab) 전체는 본문 화면과 함께 본문 글자(text)·
   * 첨부 파일(files — 원본 그대로)을, 부분은 고른 첨부 칸의 파일(files)을 가져온다 — 화면이 없어도 files 나 text 가 있으면 던지지 않는다.
   * 가져오지 못한 첨부는 failed(file: true)와 notes 에 남는다.
   * @returns {Promise<{pages: object[], failed: object[], notes: string[], what: string, files?: File[], text?: string, mail?: object}|null>}
   *   pages 는 src/pagecap.js 의 captureWhole·capturePart 결과
   */
  async function shoot(act, { key = '', today = '', onStatus = () => {}, onStart = () => {} } = {}) {
    if (st.handle) {
      const again = act === 'part' && st.key === key;
      stop(again ? 'stop' : 'switch');
      if (again) return null;
    }
    let got;
    if (act === 'tab') {
      onStart();
      let where = '';   // 팝업(창)·메일을 찍으면 그곳 — 진행 글에 적는다
      const say = (tail = '') => onStatus(`${where ? `${where} — 캡처하는 중입니다…` : '보고 있는 탭을 캡처하는 중입니다…'}${tail}`);
      const setWhere = (w) => {
        if (!w) return;
        where = w;
        say();
      };
      const onProgress = (done, total) => say(` ${done}/${total}`);
      say();
      got = await front({
        today,
        onTarget: (x) => setWhere(x?.where),
        onProgress,
        plain: (tab) => mailWhole(tab, { today, onStatus, onProgress, setWhere }),
      });
    } else if (act === 'part') {
      // 막을 씌우기 전에 메일 읽기가 첨부 칸에 표시를 단다(probeTab — 실패하면 여느 웹페이지).
      const m = await mailer();
      let probe = null;
      const handle = await start(m ? { before: async (tab) => (probe = await m.probeTab(tab)) } : undefined);
      probe = probe || handle.probe || null;
      const stopped = new Promise((resolve) => { st.quit = (why) => resolve({ why }); });
      Object.assign(st, { key, handle });
      const hint = handle.tab?.popup && handle.tab.where ? PICK_HINT.replace(/^웹페이지에서/, () => `${handle.tab.where}에서`) : PICK_HINT;
      onStatus(probe?.attachments?.length ? `${hint} 첨부 파일을 누르면 그 파일만 가져옵니다.` : hint);
      let chosen;
      try {
        chosen = await Promise.race([handle.done, stopped]);
      } finally {
        if (st.handle === handle) Object.assign(st, { key: null, handle: null, quit: null });
      }
      if (!Array.isArray(chosen) || !chosen.length) {
        if (probe) await unmarkTab(handle.tab);
        if (chosen?.why !== 'switch') onStatus('부분 고르기를 그만뒀습니다.');
        return null;
      }
      onStart();
      const atts = chosen.filter((c) => c && c.attach != null);
      const rest = chosen.filter((c) => !(c && c.attach != null));
      try {
        got = { pages: [], failed: [] };
        if (rest.length) {
          onStatus(`고른 ${rest.length}개를 캡처하는 중입니다…`);
          try {
            got = await parts(handle.tab, rest, {
              today,
              onProgress: (done, total, nth, of) => onStatus(`고른 부분을 캡처하는 중입니다…${of > 1 ? ` ${nth}/${of}번째` : ''} ${done}/${total}`),
            });
          } catch (err) {
            if (!atts.length) throw err;
            got = { pages: [], failed: [{ title: '고른 부분', why: err?.message || String(err) }] };
          }
        }
        if (atts.length) {
          onStatus(`고른 첨부 파일 ${atts.length}개를 가져오는 중입니다…`);
          const miss = (why) => ({ files: [], failed: atts.map((a) => ({ name: a.title || String(a.attach), why })) });
          const res = m && typeof m.fetchTab === 'function'
            ? await Promise.resolve().then(() => m.fetchTab(handle.tab, atts.map((a) => a.attach), { onStatus })).catch((err) => miss(err?.message || String(err)))
            : miss('첨부 파일을 가져오는 길(메일 읽기)이 없습니다');
          got = { ...got, files: Array.isArray(res?.files) ? res.files : [], lost: (res?.failed || []).map((f) => ({ title: f.name || '첨부 파일', why: f.why || '', file: true })) };
        }
      } finally {
        if (probe) await unmarkTab(handle.tab);
      }
    } else {
      return null;
    }
    const files = got.files || [];
    const lost = got.lost || [];
    const shots = got.pages.map((p) => `${p.part ? `부분 ${p.part} ` : ''}${p.fromPopup ? '팝업 창 ' : ''}${p.popup ? `${p.popup} ` : ''}`
      + `${p.host} 화면 ${p.shots}개 → ${p.tiles}장${p.cut ? '(너무 길어 앞부분만)' : ''}`).join(', ');
    const what = [shots, got.also || (files.length ? `첨부 파일 ${files.length}개` : '')].filter(Boolean).join(' · ')
      + (got.failed.length ? ` · 못 찍음 ${got.failed.length}개` : '') + (lost.length ? ` · 못 가져옴 ${lost.length}개` : '');
    const pages = got.pages.filter((p) => p.files.length || p.text);
    if (!pages.length && !files.length && !got.text) {
      throw new Error(lost.length ? `첨부 파일을 가져오지 못했습니다 — ${lost.map((f) => `${f.title}: ${f.why}`).join(' / ')}` : '캡처한 화면이 비어 있습니다.');
    }
    const many = pages.length > 1;
    // 어디를 찍었는지 — 페이지 위의 팝업이면 그 팝업만 찍었다고(뒤의 페이지는 아니다), 팝업 창이면 그 창이라고. 같은 말은 한 번.
    const places = [...new Set(pages.filter((p) => p.where).map((p) => (p.popup
      ? `열린 ${p.where}만 캡처했습니다 — 뒤의 페이지를 찍으려면 그 창을 닫고 다시 누르세요`
      : `${p.where}에서 캡처했습니다`)))];
    const notes = [
      ...pages.filter((p) => p.cut).map((p) => `${many ? `${p.title || p.host} — ` : ''}${p.part ? '고른 부분이' : '페이지가'} 너무 길어 앞부분(화면 ${MAX_SHOTS}개)만 캡처했습니다`),
      ...places,
      ...pages.filter((p) => p.paged).map((p) => `${many ? `${p.title || p.host} — ` : ''}${PAGED_NOTE}`),
      ...(got.extra || []),
      ...got.failed.map((f) => `찍지 못한 ${act === 'part' ? '부분' : '페이지'} — ${f.title}: ${f.why}`),
      ...lost.map((f) => `가져오지 못한 첨부 파일 — ${f.title}: ${f.why}`),
    ];
    return {
      pages, failed: [...got.failed, ...lost], notes, what,
      ...(got.files ? { files } : {}), ...(got.text ? { text: got.text } : {}), ...(got.mail ? { mail: got.mail } : {}),
    };
  }

  return { picking, stop, click, shoot, state: st };
}

/**
 * 단추 둘 — 전체(보고 있는 탭 통째로)와 부분(골라 캡처). 그 곳에서 고르는 중(picking)이면 부분 단추가 "고르기 취소"가 되고(누르면 그만둔다)
 * 탭 단추는 잠긴다. disabled 는 둘 다 잠그되, 고르는 중의 취소는 남긴다. 메일 화면이어도 단추는 둘이다(2026-10-15 — 메일인지는 shoot 가 본다).
 */
export const pickButton = ({ picking = false, disabled = false } = {}) => '<span class="wp-btns">'
  + `<button type="button" class="ghost small wp-open wp-front" data-pick="tab" title="${TAB_TITLE}"${disabled || picking ? ' disabled' : ''}>${TAB_ICON}${TAB_LABEL}</button>`
  + `<button type="button" class="ghost small wp-open wp-part${picking ? ' on' : ''}" data-pick="part" aria-pressed="${picking}" `
  + `title="${picking ? '페이지 위의 고르기를 그만둡니다' : PART_TITLE}"${disabled && !picking ? ' disabled' : ''}>${PART_ICON}${picking ? PART_STOP : PART_LABEL}</button></span>`;

/** 페이지 PDF 의 이름 — 화면캡처_agoda.com_2026-10-08.pdf, 같은 사이트의 둘째부터 _2 를 붙인다. */
export const pageName = (host, today, n = 1) => `화면캡처_${String(host).replace(/[\\/:*?"<>|\s]+/g, '')}${today ? `_${today}` : ''}${n > 1 ? `_${n}` : ''}.pdf`;

/** 장 하나를 JPEG 로 — 그릴 길이 없거나(테스트) 줄지 않으면 그대로 둔다. */
async function toJpeg(file) {
  if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') return file;
  try {
    const bm = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bm.width, bm.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, bm.width, bm.height);
    ctx.drawImage(bm, 0, 0);
    bm.close?.();
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    return out.size && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

/**
 * 찍은 페이지마다 그 장들을 PDF 하나로 묶는다 — 출장 증빙은 페이지 하나가 증빙 하나다(예약 확인 화면이 A4 석 장이어도). 장은 JPEG 로
 * 줄여 묶는다(증빙은 보관함에 남고 송부 PDF 에도 들어간다). 화면 글자(text)는 그 PDF 를 읽을 때 같이 준다.
 * taken 은 이미 쓰는 이름(보관함의 증빙) — 보관함의 열쇠가 이름이라, 같은 날 같은 사이트를 또 찍으면 _2 … 로 비켜 앞의 것을 덮지 않는다.
 * @returns {Promise<{file: File, text: string, host: string, pages: number}[]>}
 */
export async function pagePdfs(pages, { today = '', taken = [], build = buildPdf, shrink = toJpeg } = {}) {
  const used = new Set(taken);
  const out = [];
  for (const p of pages) {
    if (!p.files.length) continue;
    const parts = [];
    for (const f of p.files) {
      const small = await shrink(f);
      parts.push({ name: f.name, bytes: new Uint8Array(await small.arrayBuffer()) });
    }
    const pdf = await build(parts, { title: p.title || p.host });
    let n = 1;
    while (used.has(pageName(p.host, today, n))) n++;
    used.add(pageName(p.host, today, n));
    const file = new File([pdf.bytes], pageName(p.host, today, n), { type: 'application/pdf' });
    out.push({ file, text: p.text || '', host: p.host, pages: pdf.pages });
  }
  return out;
}
