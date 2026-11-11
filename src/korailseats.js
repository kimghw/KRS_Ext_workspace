// 코레일 탭에서 좌석 상태 읽기(2026-11-10 사용자 지정: "사이드 패널 옆에 열린 탭중에 하나로 하면 안될까?").
// 조건은 src/korailfill.js 가 채우고, 여기는 "열차 조회"를 누르고 결과 첫 화면의 줄을 읽는다. 좌석을 고르거나 예매하지 않는다.
// 판정과 선택자는 전용 창 조회(native/ktx-python/vendor/ktx_watcher/korail/search.py)와 같다 — 차단 안내는 닫고 알리며, 같은 조건 재조회는 부른 쪽(src/ktx.js)이 센다.

/**
 * 탭 안에서 돈다(executeScript 로 직렬화되므로 바깥 변수·함수에 기대지 않는다).
 * step — 'submit': 예매 화면에서 열차 조회를 누른다 · 'read': 결과 목록이 그려지기를 기다려 줄을 읽는다(ktx 면 KTX 탭으로 거른 뒤) ·
 * 'requery': 결과 화면의 조회 단추로 같은 조건을 다시 조회한다(단추가 없으면 clicked false — 부른 쪽이 새로고침한다).
 * 차단 안내(-8xxx 등)는 확인을 눌러 닫고 guard 로 돌려준다. 공지는 창닫기만 누른다.
 * @param {'submit'|'read'|'requery'} step
 * @param {{ktx?: boolean, waitMs?: number, have?: string[]}} [opts]
 * @returns {Promise<{url: string, state: string, clicked: boolean, guard: {code: string, message: string}|null, rows: object[], cond: object}>}
 */
export async function korailSeatsPage(step, opts = {}) {
  const ROWS = 'li.tckList';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (read, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      const value = read();
      if (value) return value;
      if (Date.now() >= end) return null;
      await sleep(250);
    }
  };
  const text = (node) => String(node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const modals = () => [...document.querySelectorAll('.ReactModal__Content, [role=dialog]')].filter(visible);
  const guardOf = () => {
    for (const node of modals()) {
      const words = text(node);
      const code = words.match(/(?<!\d)-8\d{3}(?!\d)/)?.[0] || '';
      if (code || /미허가|개발자도구|비정상적인 접속/.test(words)) return { node, code, message: words.slice(0, 300) };
    }
    return null;
  };
  let seen = null;
  // 차단 안내를 적어 두고 확인으로 닫는다. 닫히지 않아도 적은 것은 돌려준다.
  const settleGuard = async () => {
    const found = guardOf();
    if (!found) return false;
    seen = { code: found.code, message: found.message };
    if (opts.observeOnly) return true;
    const button = [...found.node.querySelectorAll('button, a')].find((b) => visible(b) && text(b) === '확인');
    if (!button) return true;
    const before = text(found.node), url = location.href;
    await sleep(1000);
    const current = guardOf();
    if (!current || location.href !== url || current.node !== found.node || text(current.node) !== before
      || !found.node.contains(button) || !visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return true;
    button.click();
    await until(() => !guardOf(), 2000);
    return true;
  };
  const closeNotices = () => {
    if (opts.observeOnly) return;
    for (const b of document.querySelectorAll('.ReactModalPortal button, .ReactModalPortal a')) if (text(b) === '창닫기') b.click();
  };
  const value = (selector) => document.querySelector(selector)?.value ?? null;
  const answer = (extra = {}) => ({
    url: location.href, state: 'none', clicked: false, guard: seen, rows: [],
    cond: {
      from: value("input[name='txtGoStart'], input#labelstart"), to: value("input[name='txtGoEnd'], input#labelend"),
      date: value('input#startDate'), people: value('input#labelple') ?? text(document.querySelector('a.data.btn_pop, .selectAreaWrap a.btn_recom')),
    },
    ...extra,
    ...(opts.observeOnly && (location.pathname.startsWith('/ticket/login')
      || [...document.querySelectorAll('a')].some((el) => visible(el) && text(el) === '로그인')
        && ![...document.querySelectorAll('a')].some((el) => visible(el) && text(el) === '로그아웃')) ? { login: true } : {}),
  });

  if (step === 'submit') {
    if (opts.observeOnly) return answer();
    if (await settleGuard()) return answer({ state: 'guard' });
    closeNotices();
    const button = [...document.querySelectorAll('button.btn_lookup')].find(visible);
    if (!button) return answer();
    button.click();
    return answer({ clicked: true });
  }

  if (step === 'requery') {
    if (opts.observeOnly) return answer();
    await settleGuard();
    closeNotices();
    const button = [...document.querySelectorAll('.selectAreaWrap button.btn_bn-blue')].find(visible);
    if (!button) return answer();
    const before = document.querySelector(ROWS);
    button.click();
    // 앞 조회의 줄을 새 답으로 읽지 않도록 목록이 갈릴 때까지 잠깐 기다린다.
    await until(() => document.querySelector(ROWS) !== before || guardOf(), 3000);
    return answer({ clicked: true });
  }

  // read — 줄 · '열차 없음' · 차단 안내 가운데 먼저 뜨는 것. 공지는 닫고 계속 기다린다.
  const ready = () => {
    if (guardOf()) return 'guard';
    if (document.querySelector(ROWS)) return 'rows';
    if ([...document.querySelectorAll('.tck_confirm_no-data')].some(visible)) return 'empty';
    if (modals().length) closeNotices();
    return null;
  };
  let state = await until(ready, opts.waitMs ?? 10_000) || (modals().length ? 'modal' : 'none');
  if (state === 'rows') {
    await sleep(400); // 줄이 선 뒤에 뒤늦게 뜨는 차단 안내를 본다.
    if (guardOf()) state = 'guard';
  }
  // 빈자리 대기는 지켜보는 열차(have)가 이미 첫 화면에 다 있으면 KTX 탭을 누르지 않는다 — 5초마다 도는 조회에 요청을 더하지 않는다.
  const named = (no) => new RegExp(`(?:KTX(?:-[가-힣A-Za-z]+)?|청룡)\\s*0*${no}(?!\\d)`);
  const haveAll = Array.isArray(opts.have) && opts.have.length > 0 && opts.have.every((no) => /^\d{1,4}$/.test(no)
    && [...document.querySelectorAll(ROWS)].some((li) => named(no).test(text(li))));
  if (state === 'rows' && opts.ktx && !haveAll && !opts.observeOnly) {
    const tab = document.querySelector('ul.tab_bar button:has(div.korail_logo_tab)');
    const active = tab && (/active|current/i.test(tab.className) || tab.getAttribute('aria-selected') === 'true' || tab.getAttribute('aria-pressed') === 'true');
    if (tab && !active) {
      tab.click();
      await sleep(1000);
      state = await until(ready, 8000) || 'none';
    }
  }
  if (state === 'guard') {
    await settleGuard();
    return answer({ state });
  }
  const box = (node) => (node ? { cls: String(node.className || '').slice(0, 200), text: text(node).slice(0, 200) } : null);
  const rows = state !== 'rows' ? [] : [...document.querySelectorAll(ROWS)].slice(0, 100).map((li) => {
    // 왼쪽(첫째) 칸이 일반실, 다음이 특실. 'gen' 클래스는 예약할 수 있는 줄에만 붙는다.
    const boxes = [...li.querySelectorAll('.price_box')];
    const gen = boxes.find((b) => b.classList.contains('gen')) || boxes[0] || null;
    return {
      text: text(li).slice(0, 600),
      origin: text(li.querySelector('.data_box h3 > span:nth-child(1)')), dest: text(li.querySelector('.data_box h3 > span:nth-child(2)')),
      gen: box(gen), spec: box(boxes.find((b) => b !== gen) || null),
    };
  });
  return answer({ state, rows });
}

/**
 * 일반실·특실 칸 하나 → 패널의 좌석 꼴. 값도 매진도 아니면 코레일이 적은 말이 상태다("입석 + 좌석 예약대기").
 * wait 는 코레일 예약대기를 걸 수 있는 칸이다(클래스 yms_wait·sold_out_wait 또는 "예약대기" 글) — 그런 열차는 빈자리 대기를 두지 않는다.
 */
function shapeSeat(box) {
  if (!box || typeof box !== 'object') return null;
  const words = String(box.text || ''), cls = String(box.cls || '');
  const price = words.match(/[\d,]+\s*원/)?.[0].replace(/\s+/g, '') || '';
  const soon = /sold_out_soon/.test(cls) || words.includes('매진임박');
  const soldOut = (/\bsold_out(_wait)?\b/.test(cls) && !/sold_out_soon/.test(cls)) || words.replace(/매진임박/g, '').includes('매진');
  const wait = /_wait\b/.test(cls) || words.includes('예약대기');
  return { price, soldOut, soon, note: price || soldOut ? '' : words.slice(0, 40), ...(wait ? { wait: true } : {}) };
}

/** 탭에서 읽은 줄 → 패널의 줄. 요청한 구간의 KTX 이고 출발 시 이후인 것만 남긴다(옆 역·다른 열차종류는 버린다). */
export function shapeSeatRows(raw, query) {
  const rows = [];
  for (const row of Array.isArray(raw) ? raw : []) {
    if (!row || row.origin !== query.from || row.dest !== query.to) continue;
    const words = String(row.text || '');
    const train = words.match(/KTX(?:-[가-힣A-Za-z]+)?|청룡/)?.[0] || '';
    const times = words.match(/\((\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})\)/);
    if (!train || !times) continue;
    const [dep, arr] = [times[1], times[2]].map((time) => time.padStart(5, '0'));
    if (dep < `${String(query.hour).padStart(2, '0')}:00`) continue;
    rows.push({
      train, no: words.match(/(?:KTX(?:-[가-힣A-Za-z]+)?|청룡)\s*(\d{1,4})(?!\d)/)?.[1] || '', dep, arr,
      took: (words.match(/소요시간\s*:?\s*((?:\d+\s*시간\s*)?(?:\d+\s*분)?)/)?.[1] || '').trim(),
      gen: shapeSeat(row.gen), spec: shapeSeat(row.spec),
    });
  }
  return rows;
}
