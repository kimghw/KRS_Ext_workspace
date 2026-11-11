// 코레일 결과 탭에서 좌석 예약 — 결제 직전 화면까지(2026-11-10 사용자 지정: "좌석이 생기면 결재는 아니고 좌석 예약까지 할 수 있도록 구현해 줄래?").
// 순서와 선택자는 binjari 의 예약 흐름(ktx_watcher/korail/reserve.py attempt_reservation, 2026-05-14 실측)과 같다:
//   결과 줄의 가격 <a> 를 누르면 그 줄이 골라지고 → 화면 아래의 button.reservbtn("예매")을 누르면 → 안내 창을 지나 /ticket/reservation/detail(좌석이 잡힌 결제 직전 화면).
// 결제하기·카드 입력은 건드리지 않는다. 코레일 로그인은 되어 있다고 본다 — 로그인 화면이 나오면 부른 쪽(src/ktx.js ktxReserve)이 멈춘다.

/**
 * 탭 안에서 돈다(executeScript 로 직렬화되므로 바깥 변수·함수에 기대지 않는다).
 * step — 'pick': 결과 목록에서 그 열차(번호·출발 시각·구간) 한 줄을 찾아 일반실(없으면 특실)의 살 수 있는 가격을 누르고 예매 단추를 누른다 ·
 * 'settle': 예매 뒤의 화면을 본다 — 진행 확인("계속 진행하시겠습니까")은 네, 안내는 확인을 누르고 그 글을 돌려준다. 결제 직전 화면이면 done.
 * 'status': 사람이 예매하는 동안 화면만 읽는다. 팝업·좌석·예매·결제 단추는 누르지 않고, 같은 열차·날짜·구간의 예약 상세만 done.
 * 'ready': 예매 전 선택·조건·활성 단추와 안내창·로딩 부재를 읽는다. 클릭하지 않는다.
 * 'arm': 같은 검증 뒤 예매 단추에 짧게 유효한 고유 접근성 이름을 붙인다. 실제 누름은 네이티브 UIA가 한다.
 * 'disarm': 같은 토큰의 접근성 이름만 원래대로 복구한다. 현재 화면·선택·안내 상태와 무관하게 정리한다.
 * '*-input': 가격·예매·안내의 브라우저 입력 계획만 만든다. 클릭·대기 없이 대상과 화면 좌표를 다시 읽는다.
 * 차단 안내(-8xxx 등)는 확인을 눌러 닫고 이어 간다(2026-11-11 사용자 지정: "이거 그냥 확인 누르면 되는데") — 닫은 것은 passed 에 적고, 닫히지 않고 남은 것만 guard 로 돌려준다.
 * 'rebook': 목표 열차·객실의 선택을 다시 확인하고 예매 단추만 누른다(줄을 다시 고르지 않는다).
 * @param {'pick'|'settle'|'rebook'|'status'|'ready'|'arm'|'disarm'|'pick-input'|'book-input'|'notice-input'} step
 * @param {{no?: string, dep?: string, from?: string, to?: string, seat?: 'any'|'gen'|'spec', hold?: boolean, date?: string, adults?: number, token?: string, expiresAt?: number, expectedKey?: string}} [opts]
 * @returns {Promise<{url: string, picked?: boolean, booked?: boolean, seat?: string, price?: string, done?: boolean, login?: boolean,
 *   said: string[], guard: {code: string, message: string}|null, passed: {code: string, message: string}[], list?: boolean, why?: string, deadline?: string}>}
 */
export async function korailReservePage(step, opts = {}) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const text = (node) => String(node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const modals = () => [...document.querySelectorAll('.ReactModal__Content, [role=dialog], .layerWrap')].filter(visible);
  // 코레일은 요청 중 #loadingbar 안에 .loading_spinner를 만들고 완료 시 제거한다.
  const busy = () => [...document.querySelectorAll('#loadingbar, .loading_spinner, [aria-busy="true"]')].some(visible);
  const dismiss = async (node, button) => {
    const before = text(node), url = location.href;
    const pending = () => visible(node) && visible(button) && node.contains(button) && text(node) === before;
    // 안내가 표시된 뒤 1초 쉬고, 같은 안내가 남아 있을 때만 확인한다.
    await sleep(1000);
    if (!pending()) return true;
    if (location.href !== url || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    button.click();
    // click()의 반환은 닫힘 완료가 아니다. 같은 안내를 재클릭하지 않고 사라질 때까지 기다린다.
    // React가 틀·버튼을 재사용해 문구만 바꿔도 이전 안내는 끝났으며 다음 단계에서 새 안내를 읽는다.
    for (let i = 0; i < 10 && pending(); i++) await sleep(200);
    return !pending();
  };
  const guardOf = () => {
    for (const node of modals()) {
      const words = text(node);
      const code = words.match(/(?<!\d)-8\d{3}(?!\d)/)?.[0] || '';
      if (code || /미허가|개발자도구|비정상적인 접속/.test(words)) return { node, code, message: words.slice(0, 300) };
    }
    return null;
  };
  const said = [], passed = [];
  // 차단 안내가 떠 있으면 확인을 눌러 닫는다. 닫았으면 true — 닫히지 않으면(확인이 없거나 그대로 남으면) false 이고 answer 의 guard 에 남는다.
  const passGuard = async () => {
    const found = guardOf();
    if (!found) return true;
    const ok = [...found.node.querySelectorAll('button, a')].find((b) => visible(b) && text(b) === '확인');
    if (!ok) return false;
    const before = text(found.node), url = location.href;
    await sleep(1000);
    const current = guardOf();
    if (!current) return true;
    if (location.href !== url || current.node !== found.node || text(current.node) !== before
      || !found.node.contains(ok) || !visible(ok) || ok.disabled || ok.getAttribute('aria-disabled') === 'true') return false;
    ok.click();
    for (let i = 0; i < 8 && guardOf(); i++) await sleep(250);
    if (guardOf()) return false;
    passed.push({ code: found.code, message: found.message });
    return true;
  };
  const still = () => { const g = guardOf(); return g ? { code: g.code, message: g.message } : null; };
  const answer = (extra = {}) => ({ url: location.href, said, passed, guard: still(), ...(step === 'ready' ? { ready: false } : {}), ...(step === 'arm' ? { armed: false } : {}), ...extra });
  const armAttribute = 'data-krs-reserve-arm';
  const armStateKey = Symbol.for('krs.korail.reserve.arm.v1');
  const inputEvents = ['pointerdown', 'keydown', 'input', 'change', 'click'];
  const navigationEvents = ['popstate', 'hashchange', 'pagehide'];
  const validToken = typeof opts.token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(opts.token);
  const stopArmWatch = (button, marker, saved) => {
    const state = button[armStateKey], doc = button.ownerDocument, view = doc?.defaultView;
    // 다른 실행의 객체나 페이지가 같은 이름에 둔 값을 함수로 실행하지 않는다.
    if (!state || state.owner !== button || state.marker !== marker || state.token !== saved.token
      || state.document !== doc || state.window !== view || !view?.MutationObserver || !(state.observer instanceof view.MutationObserver)
      || typeof state.onInput !== 'function' || typeof state.onHidden !== 'function') return;
    view.MutationObserver.prototype.disconnect.call(state.observer);
    for (const name of inputEvents) doc.removeEventListener(name, state.onInput, true);
    for (const name of navigationEvents) view.removeEventListener(name, state.onInput, true);
    doc.removeEventListener('visibilitychange', state.onHidden, true);
    clearTimeout(state.timer);
    if (button[armStateKey] === state) delete button[armStateKey];
  };
  const restoreArm = (button, marker, saved) => {
    const ownsMarker = button.getAttribute(armAttribute) === marker;
    stopArmWatch(button, marker, saved);
    // 페이지가 다른 이름을 새로 붙였다면 그 변경은 보존한다.
    if (button.getAttribute('aria-label') === saved.label) {
      if (saved.originalLabel === null) button.removeAttribute('aria-label');
      else button.setAttribute('aria-label', saved.originalLabel);
    }
    if (!ownsMarker) return false;
    button.removeAttribute(armAttribute);
    return true;
  };
  if (step === 'disarm') {
    if (!validToken) return answer({ disarmed: false, why: 'bad-token' });
    let disarmed = false;
    for (const button of document.querySelectorAll(`button[${armAttribute}]`)) {
      const marker = button.getAttribute(armAttribute);
      let saved;
      try { saved = JSON.parse(marker); } catch { continue; }
      if (saved?.token !== opts.token || saved.label !== `예매 KRS-${opts.token}`
        || !(saved.originalLabel === null || typeof saved.originalLabel === 'string')) continue;
      disarmed = restoreArm(button, marker, saved) || disarmed;
    }
    return answer({ disarmed });
  }
  if (step === 'arm') {
    if (!validToken) return answer({ why: 'bad-token' });
    if (!Number.isSafeInteger(opts.expiresAt)) return answer({ why: 'bad-expiry' });
    const remaining = opts.expiresAt - Date.now();
    if (remaining <= 0 || remaining > 15000) return answer({ why: 'bad-expiry' });
    if (typeof opts.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)
      || !Number.isInteger(opts.adults) || opts.adults < 1 || opts.adults > 9) return answer({ why: 'bad-target' });
  }
  // 예매 단추 — button.reservbtn, 클래스가 바뀌었으면 글이 꼭 "예매" 인 보이는 단추.
  const bookButton = () => [...document.querySelectorAll('button.reservbtn')].find((b) => visible(b) && text(b) === '예매')
    || [...document.querySelectorAll('button')].find((b) => visible(b) && text(b) === '예매') || null;
  const bookable = () => {
    const book = bookButton();
    return book && !book.disabled && book.getAttribute('aria-disabled') !== 'true' ? book : null;
  };
  const inputStep = ['pick-input', 'book-input', 'notice-input'].includes(step);
  const enabledInput = (element) => visible(element) && !element.disabled && !element.matches(':disabled') && element.getAttribute('aria-disabled') !== 'true';
  const inputPoint = (element) => {
    if (!enabledInput(element)) return { why: 'input-unavailable' };
    element.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'instant' });
    if (!enabledInput(element) || !element.isConnected) return { why: 'input-unavailable' };
    const rect = element.getBoundingClientRect(), view = document.defaultView;
    const width = view.innerWidth, height = view.innerHeight;
    if (![rect.left, rect.right, rect.top, rect.bottom, width, height].every(Number.isFinite)) return { why: 'input-unavailable' };
    const left = Math.max(0, rect.left), right = Math.min(width, rect.right);
    const top = Math.max(0, rect.top), bottom = Math.min(height, rect.bottom);
    if (right <= left || bottom <= top) return { why: 'input-unavailable' };
    const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
    const hit = document.elementFromPoint?.(point.x, point.y);
    return hit && (hit === element || element.contains(hit)) ? { point } : { why: 'input-obscured' };
  };
  const inputTarget = () => [opts.no, opts.dep, opts.from, opts.to, opts.date, opts.adults, opts.seat];
  const inputConditions = () => ["input[name='txtGoStart'], input#labelstart", "input[name='txtGoEnd'], input#labelend", 'input#startDate', 'input#labelple']
    .map((selector) => document.querySelector(selector)?.value ?? null)
    .concat(text(document.querySelector('a.data.btn_pop, .selectAreaWrap a.btn_recom')));
  const preparedInput = (element, action, extra = {}, words = '') => {
    const position = inputPoint(element);
    if (!position.point) return answer(position);
    const key = JSON.stringify([location.href, action, inputTarget(), inputConditions(), words, text(element), extra]);
    if (opts.expectedKey !== undefined && key !== opts.expectedKey) return answer({ why: 'input-changed' });
    return answer({ plan: { action, key, point: position.point, ...extra } });
  };
  if (inputStep) {
    if (location.origin !== 'https://www.korail.com') return answer({ why: 'wrong-url' });
    if (location.pathname.startsWith('/ticket/login')) return answer({ login: true });
    const allowed = step === 'notice-input' ? ['/ticket/search/list', '/ticket/reservation/detail'] : ['/ticket/search/list'];
    if (!allowed.some((path) => location.href === `https://www.korail.com${path}`)) return answer({ why: 'wrong-url' });
    if (step === 'notice-input') {
      const candidates = [], seen = new Set();
      for (const node of modals().reverse()) {
        // 예약 상세에 뜨는 설문·프로모션은 닫기만 허용한다. 참여·그만보기는 건드리지 않는다.
        const promotions = (node.matches('.layerWrap.emer_pop') ? [node] : [...node.querySelectorAll('.layerWrap.emer_pop')]).filter(visible);
        if (promotions.length) {
          if (promotions.length !== 1) continue;
          const promotion = promotions[0], copy = promotion.cloneNode(true);
          copy.querySelectorAll('button, a, input').forEach((child) => child.remove());
          const message = text(copy), images = [...promotion.querySelectorAll('img')].map((image) => [image.getAttribute('src'), image.getAttribute('alt')]);
          const noticeKey = JSON.stringify([location.href, 'promotion-close', message, images, '창닫기']);
          const choices = [...promotion.querySelectorAll('button, a, input[type=button]')]
            .filter((button) => enabledInput(button) && (text(button) || button.value) === '창닫기');
          if (choices.length !== 1) { candidates.push({ words: text(promotion), noticeKey }); continue; }
          if (seen.has(choices[0])) continue;
          seen.add(choices[0]); candidates.push({ button: choices[0], words: JSON.stringify([text(promotion), images]), noticeKey });
          continue;
        }
        const words = text(node), copy = node.cloneNode(true);
        copy.querySelectorAll('button, a, input').forEach((child) => child.remove());
        const message = text(copy);
        const proceed = /진행하시겠습니까|계속\s*진행|예매하시겠습니까/.test(message);
        if (/결제|취소|환불|반환/.test(message) && (proceed || /하시겠|할까요|진행|동의/.test(message))) continue;
        if (!proceed && !/-8\d{3}|안내|확인하시고|선택하신|예매|본인인증|약관|잔여석|매진|오류/.test(message)) continue;
        const buttons = [...node.querySelectorAll('button, a, input[type=button]')].filter(enabledInput);
        const label = (button) => text(button) || button.value;
        const yes = proceed ? buttons.filter((button) => label(button) === '네') : [];
        const choices = yes.length ? yes : buttons.filter((button) => label(button) === '확인');
        const noticeKey = JSON.stringify([location.href, 'notice', message, proceed ? '네' : '확인']);
        if (choices.length !== 1) { candidates.push({ words, noticeKey }); continue; }
        if (seen.has(choices[0])) continue;
        seen.add(choices[0]); candidates.push({ button: choices[0], words, noticeKey });
      }
      for (const { button, words, noticeKey } of candidates) {
        if (!button) return answer({ why: 'notice-unavailable', noticeKey });
        const prepared = preparedInput(button, 'notice', {}, words);
        return { ...prepared, noticeKey };
      }
      return answer({ why: 'notice-unavailable' });
    }
    if (guardOf()) return answer({ why: 'guard' });
    if (!opts.from || !opts.to || typeof opts.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)
      || !Number.isInteger(opts.adults) || opts.adults < 1 || opts.adults > 9
      || (opts.seat !== undefined && !['any', 'gen', 'spec'].includes(opts.seat))) return answer({ why: 'bad-target' });
    const conditions = inputConditions();
    if ((conditions[0] !== null && conditions[0] !== opts.from) || (conditions[1] !== null && conditions[1] !== opts.to)
      || !String(conditions[2] || '').startsWith(opts.date)
      || +String(conditions[3] || conditions[4]).match(/(\d+)\s*명/)?.[1] !== opts.adults) return answer({ why: 'condition-mismatch' });
  }

  const readStatus = (recordNotices = true) => {
    // 수동 예매 중에는 안내 확인도 사용자가 한다. 아래 판정은 DOM을 읽기만 한다.
    if (location.pathname.startsWith('/ticket/login')) return answer({ done: false, login: true });
    if (guardOf()) return answer({ done: false });
    const notices = modals().map(text).filter(Boolean);
    if (recordNotices) said.push(...notices.map((words) => words.slice(0, 200)));
    if (location.pathname.startsWith('/ticket/search/list')) {
      const value = (selector) => document.querySelector(selector)?.value ?? null;
      const from = value("input[name='txtGoStart'], input#labelstart");
      const to = value("input[name='txtGoEnd'], input#labelend");
      const date = value('input#startDate');
      const people = value('input#labelple') ?? (document.querySelector('a.data.btn_pop, .selectAreaWrap a.btn_recom')
        ? text(document.querySelector('a.data.btn_pop, .selectAreaWrap a.btn_recom')) : null);
      // React가 입력란을 아직 그리지 않았으면 대기한다. 표시된 조건이 바뀐 경우만 중단한다.
      const changed = (opts.from !== undefined && from !== null && from !== opts.from)
        || (opts.to !== undefined && to !== null && to !== opts.to)
        || (opts.date !== undefined && date !== null && !date.startsWith(opts.date))
        || (opts.adults !== undefined && people !== null && +String(people).match(/(\d+)\s*명/)?.[1] !== opts.adults);
      return answer({ done: false, list: true, ...(changed ? { why: 'condition-mismatch' } : {}) });
    }
    if (!/^\/ticket\/reservation\/detail\/?$/.test(location.pathname)) return answer({ done: false });
    const cards = [...document.querySelectorAll('.reservation_form .rsv_confirm-wrap .tck_list-wrap')].filter(visible);
    if (!cards.length) return answer({ done: false }); // 상세 URL만 선 로딩 화면은 아직 판정하지 않는다.
    const no = String(opts.no || '').replace(/^0+(?=\d)/, '');
    const validTarget = /^\d{1,4}$/.test(no) && /^\d{2}:\d{2}$/.test(String(opts.dep || ''))
      && /^\d{4}-\d{2}-\d{2}$/.test(String(opts.date || '')) && !!opts.from && !!opts.to;
    const matches = validTarget ? cards.filter((card) => {
      const number = text(card.querySelector('.tit_box .flag_wrap .num')).replace(/^0+(?=\d)/, '');
      const day = text(card.querySelector('.tit_box .flag_wrap .dt')).match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
      const date = day ? `${day[1]}-${day[2].padStart(2, '0')}-${day[3].padStart(2, '0')}` : '';
      const route = text(card.querySelector('.data_box > h3.txt_bk'))
        .match(/^(.+?)\s*→\s*(.+?)\s*\(\s*(\d{1,2}):(\d{2})\s*~\s*\d{1,2}:\d{2}\s*\)$/);
      const seatInfo = text(card.querySelector('.data_box .toggle_wrap > p.s_txt'));
      const expectedSeat = opts.seat === 'gen' ? '일반실' : opts.seat === 'spec' ? '특실' : null;
      const seatMatches = !expectedSeat || seatInfo.match(/^(일반실|특실)(?:\s|$)/)?.[1] === expectedSeat;
      const total = seatInfo.match(/\(총\s*(\d+)\s*석\)/)?.[1];
      const seatCount = total ? +total : /^(?:일반실|특실)\s+\d+호차\s+\S+(?:\s+\(역방향\))?$/.test(seatInfo) ? 1 : null;
      // 화면에 좌석 수가 명시되거나 한 좌석의 호차·번호가 분명할 때만 인원과 대조한다.
      const peopleMatch = opts.adults === undefined || seatCount === null || seatCount === opts.adults;
      return number === no && date === opts.date && !!route
        && route[1].trim() === opts.from && route[2].trim() === opts.to
        && `${route[3].padStart(2, '0')}:${route[4]}` === opts.dep && seatMatches && peopleMatch;
    }) : [];
    if (matches.length !== 1) return answer({ done: false, why: 'reservation-mismatch' });
    const payment = [...document.querySelectorAll('.reservation_form .btnWrap.btnList button.btn_lookup')]
      .some((button) => visible(button) && text(button) === '결제하기');
    if (!payment || notices.length) return answer({ done: false });
    const deadline = text(matches[0]).match(/(?:결제\s*기한|발권\s*기한|결제\s*시한)[^0-9]{0,20}([0-9.\-/년월일\s]*\d{1,2}:\d{2})/)?.[1]?.trim() || '';
    return answer({ done: true, deadline });
  };
  if (step === 'status') return readStatus();

  if (step === 'pick' || step === 'rebook' || step === 'ready' || step === 'arm' || step === 'pick-input' || step === 'book-input') {
    // 준비 확인·예매 직전에는 새 안내를 닫거나 그 뒤의 단추를 누르지 않는다.
    if (step !== 'pick' && guardOf()) return answer({ ready: false, why: 'guard' });
    if (step === 'pick' && !await passGuard()) return answer({ why: 'guard' });
    if (busy()) return answer({ ready: false, why: 'page-busy' });
    if (step !== 'pick' && modals().length) return answer({ ready: false, why: 'modal-open' });
    if (!location.pathname.startsWith('/ticket/search/list')) return answer({ why: 'not-list' });
    const no = String(opts.no || '').replace(/^0+(?=\d)/, '');
    if (!/^\d{1,4}$/.test(no) || !/^\d{2}:\d{2}$/.test(String(opts.dep || ''))) return answer({ why: 'bad-target' });
    const named = new RegExp(`(?:KTX(?:-[가-힣A-Za-z]+)?|청룡)\\s*0*${no}(?!\\d)`);
    const [h, m] = opts.dep.split(':');
    const departs = new RegExp(`\\(\\s*0?${+h}:${m}\\s*~`);
    const targetRows = () => [...document.querySelectorAll('li.tckList')].filter((li) => {
      const words = text(li);
      if (!named.test(words) || !departs.test(words)) return false;
      const [origin, dest] = [...li.querySelectorAll('.data_box h3 > span')].slice(0, 2).map(text);
      return (!opts.from || origin === opts.from) && (!opts.to || dest === opts.to);
    });
    // React가 행을 교체하므로 번호·시각·구간으로 현재 문서에서 매번 다시 찾는다.
    const target = () => {
      const rows = targetRows();
      return rows.length === 1 ? { row: rows[0] } : { why: rows.length ? 'many-rows' : 'no-row' };
    };
    const boxOf = (li, kind) => {
      const boxes = [...li.querySelectorAll('.price_box')];
      const gen = boxes.find((b) => b.classList.contains('gen')) || boxes[0] || null;
      return kind === 'gen' ? gen : boxes.find((b) => b !== gen) || null;
    };
    // 실제 코레일은 선택된 객실 칸에 active를 붙인다. 전역 예매 단추만으로 선택 성공을 판단하지 않는다.
    const selected = (box) => {
      const active = [...document.querySelectorAll('li.tckList .price_box.active')];
      return { exact: !!box && active.length === 1 && active[0] === box, other: active.some((b) => b !== box) };
    };
    if (step === 'book-input') {
      const current = target();
      if (current.why) return answer({ why: current.why });
      const kind = ['gen', 'spec'].includes(opts.seat) ? opts.seat
        : ['gen', 'spec'].find((kind) => selected(boxOf(current.row, kind)).exact);
      const box = kind ? boxOf(current.row, kind) : null;
      if (!selected(box).exact) return answer({ why: 'selection-mismatch' });
      const buttons = [...document.querySelectorAll('button.reservbtn')].filter((button) => visible(button) && text(button) === '예매');
      if (buttons.length !== 1) return answer({ why: buttons.length ? 'many-book-buttons' : 'no-book-button' });
      if (!enabledInput(buttons[0])) return answer({ why: 'book-disabled' });
      const price = text(box).match(/[\d,]+\s*원/)?.[0].replace(/\s+/g, '') || '';
      if (!price) return answer({ why: 'no-seat' });
      return preparedInput(buttons[0], 'book', { seat: kind === 'gen' ? '일반실' : '특실', price, kind }, text(current.row));
    }
    if (step === 'rebook' || step === 'ready' || step === 'arm') {
      if (!opts.from || !opts.to || !['gen', 'spec'].includes(opts.seat)) return answer({ why: 'bad-target' });
      const date = document.querySelector('input#startDate')?.value || '';
      const people = document.querySelector('input#labelple')?.value
        || text(document.querySelector('a.data.btn_pop, .selectAreaWrap a.btn_recom'));
      if ((opts.date !== undefined && !date.startsWith(opts.date))
        || (opts.adults !== undefined && +String(people).match(/(\d+)\s*명/)?.[1] !== opts.adults)) return answer({ why: 'condition-mismatch' });
      const current = target();
      if (current.why) return answer({ why: current.why });
      if (!selected(boxOf(current.row, opts.seat)).exact) return answer({ why: 'selection-mismatch' });
      const book = bookable();
      if (!book) return answer({ why: 'book-disabled' });
      if (step === 'ready') return answer({ ready: true, key: JSON.stringify([no, opts.dep, opts.from, opts.to, opts.seat, date, people, text(boxOf(current.row, opts.seat))]) });
      if (step === 'arm') {
        if (document.querySelector(`[${armAttribute}]`) || armStateKey in book) return answer({ why: 'arm-busy' });
        const label = `예매 KRS-${opts.token}`;
        if ([...document.querySelectorAll('[aria-label]')].some((node) => node.getAttribute('aria-label') === label)) return answer({ why: 'arm-label-exists' });
        const remaining = opts.expiresAt - Date.now();
        if (remaining <= 0 || remaining > 15000) return answer({ why: 'bad-expiry' });
        const saved = { token: opts.token, label, expiresAt: opts.expiresAt, originalLabel: book.getAttribute('aria-label') };
        const marker = JSON.stringify(saved);
        const armDocument = document, view = armDocument.defaultView, url = location.href;
        const originalPrice = text(boxOf(current.row, opts.seat));
        const routeValues = () => ["input[name='txtGoStart'], input#labelstart", "input[name='txtGoEnd'], input#labelend"]
          .map((selector) => armDocument.querySelector(selector)?.value ?? null);
        const originalRoute = JSON.stringify(routeValues());
        const cancelArm = () => {
          restoreArm(book, marker, saved);
          // React가 표식까지 복제한 새 버튼으로 교체해도 같은 토큰을 남기지 않는다.
          for (const candidate of armDocument.querySelectorAll('button[aria-label]')) {
            if (candidate !== book && candidate.getAttribute('aria-label') === label) restoreArm(candidate, marker, saved);
          }
        };
        const unchanged = () => {
          if (!book.isConnected || location.href !== url || book.getAttribute(armAttribute) !== marker
            || book.getAttribute('aria-label') !== label || bookable() !== book || busy() || modals().length) return false;
          const row = target();
          if (row.why || !selected(boxOf(row.row, opts.seat)).exact || text(boxOf(row.row, opts.seat)) !== originalPrice) return false;
          const currentDate = armDocument.querySelector('input#startDate')?.value || '';
          const currentPeople = armDocument.querySelector('input#labelple')?.value
            || text(armDocument.querySelector('a.data.btn_pop, .selectAreaWrap a.btn_recom'));
          return currentDate === date && currentPeople === people && JSON.stringify(routeValues()) === originalRoute
            && [...armDocument.querySelectorAll('[aria-label]')].filter((node) => node.getAttribute('aria-label') === label).length === 1;
        };
        const observer = new view.MutationObserver(() => { if (!unchanged()) cancelArm(); });
        const onInput = () => cancelArm(); // 클릭 자체를 취소하지 않아 UIA Invoke의 기본 동작은 그대로 진행한다.
        const onHidden = () => { if (armDocument.hidden) cancelArm(); };
        const state = { owner: book, document: armDocument, window: view, marker, token: opts.token, observer, onInput, onHidden, timer: null };
        Object.defineProperty(book, armStateKey, { value: state, configurable: true });
        book.setAttribute(armAttribute, marker);
        book.setAttribute('aria-label', label);
        // 초기 표식 변경 뒤에 관찰을 시작하고, 정리 때 먼저 끊어 자기 변경의 반복을 막는다.
        observer.observe(armDocument, { subtree: true, childList: true, attributes: true, characterData: true });
        for (const name of inputEvents) armDocument.addEventListener(name, onInput, true);
        for (const name of navigationEvents) view.addEventListener(name, onInput, true);
        armDocument.addEventListener('visibilitychange', onHidden, true);
        // 이전 토큰의 타이머가 늦게 실행돼도 새 토큰의 표식은 지우지 않는다.
        state.timer = setTimeout(cancelArm, remaining);
        return answer({ armed: true, label, expiresAt: opts.expiresAt });
      }
      book.click();
      return answer({ booked: true });
    }
    const first = target();
    if (first.why) return answer({ why: first.why });
    // 살 수 있는 칸 — 매진(매진임박은 산다)·예약대기·입석이 아니고 "…원" 가격 링크가 하나.
    const priceLink = (box) => {
      if (!box) return null;
      const cls = String(box.className || '');
      if (/\bsold_out(_wait)?\b/.test(cls) && !/sold_out_soon/.test(cls)) return null;
      const links = [...box.querySelectorAll('a')].filter((a) => visible(a) && /[\d,]+\s*원/.test(text(a))
        && !/매진(?!임박)|예약대기|입석/.test(text(a)));
      return links.length === 1 ? links[0] : null;
    };
    const order = opts.seat === 'spec' ? [['특실', 'spec']] : opts.seat === 'gen' ? [['일반실', 'gen']] : [['일반실', 'gen'], ['특실', 'spec']];
    const existingKind = step === 'pick-input' && (!opts.seat || opts.seat === 'any')
      ? ['gen', 'spec'].find((kind) => selected(boxOf(first.row, kind)).exact) : null;
    const choices = existingKind ? order.filter(([, kind]) => kind === existingKind) : order;
    const choice = choices.map(([label, kind]) => [label, kind, priceLink(boxOf(first.row, kind))]).find(([, , link]) => link);
    if (!choice) return answer({ why: 'no-seat' });
    const [seat, kind, link] = choice;
    const price = text(link).match(/[\d,]+\s*원/)?.[0].replace(/\s+/g, '') || '';
    const initial = selected(boxOf(first.row, kind));
    if (initial.other) return answer({ why: 'selection-mismatch' });
    if (step === 'pick-input') {
      if (!enabledInput(link)) return answer({ why: 'input-unavailable' });
      if (initial.exact) {
        const key = JSON.stringify([location.href, 'selected', inputTarget(), inputConditions(), text(first.row), seat, price, kind]);
        if (opts.expectedKey !== undefined && key !== opts.expectedKey) return answer({ why: 'input-changed' });
        return answer({ picked: true, ready: true, key, seat, price, kind });
      }
      return preparedInput(link, 'seat', { seat, price, kind }, text(first.row));
    }
    // 같은 가격을 다시 누르면 선택이 풀리므로 이미 목표 객실이 선택됐으면 그대로 둔다.
    // 일반 안내가 남아 있으면 닫힌 뒤의 반복에서 가격을 고른다.
    if (!initial.exact && !modals().length) link.click();
    // 다시 누를 때는 그 칸의 가격 링크를 새로 찾는다(안내를 닫으면 목록이 다시 그려지기도 한다). 같은 줄·같은 칸만 — 없어졌으면 누르지 않는다.
    const again = () => {
      const current = target();
      if (current.why) return current.why;
      const box = boxOf(current.row, kind), state = selected(box);
      if (state.other) return 'selection-mismatch';
      if (state.exact) return null;
      const fresh = priceLink(box);
      if (!fresh) return 'no-seat';
      fresh.click();
      return null;
    };
    // 가격을 누르면 그 열차의 이용안내("서대구정차하는 열차입니다. 도착시간을 확인하시기 바랍니다." — 2026-11-10 실측)가 먼저 뜨기도 한다.
    // 안내는 확인, 진행 확인은 네를 누르고 그 글을 돌려준다. 차단 안내도 확인으로 닫고 이어 간다(닫히지 않으면 멈춘다). 예매 단추가 보일 때까지 7초 남짓.
    // 차단 안내가 가격 누름을 삼키면 줄이 골라지지 않아 예매 단추가 서지 않는다(2026-11-11 "좌석은 골랐지만 코레일의 예매 단추를 찾지 못했습니다") —
    // 안내를 닫고 1초쯤 지나도 예매 단추가 없으면 가격을 다시 누른다(두 번까지). 안내 없이 단추가 안 서도 중간에 한 번 다시 누른다.
    let book = null, retryAt = 10, retries = 0;
    for (let i = 0; i < 24 && !book; i++) {
      await sleep(300);
      if (busy()) continue;
      const before = passed.length;
      if (!await passGuard()) return answer({ picked: true, seat, price, why: 'guard' });
      if (passed.length > before) { retryAt = i + 3; continue; }
      let dismissed = false;
      for (const node of modals()) {
        const words = text(node);
        const buttons = [...node.querySelectorAll('button, a')].filter(visible);
        const yes = /진행하시겠습니까|계속\s*진행/.test(words) && buttons.find((b) => text(b) === '네');
        const ok = yes || buttons.find((b) => text(b) === '확인');
        if (!ok) continue;
        said.push(words.slice(0, 200));
        if (!await dismiss(node, ok)) return answer({ picked: true, seat, price, why: 'modal-pending' });
        dismissed = true;
        break;
      }
      if (dismissed) continue;
      if (!busy() && !modals().length) {
        const current = target();
        const state = selected(current.row ? boxOf(current.row, kind) : null);
        if (state.other) return answer({ picked: true, seat, price, why: 'selection-mismatch' });
        book = state.exact ? bookButton() : null;
        if (!book && !state.exact && i >= retryAt && retries < 2) {
          retries++;
          retryAt = i + 6;
          const why = again();
          if (why) return answer({ picked: true, seat, price, why });
        }
      }
    }
    if (!book) {
      const current = target();
      if (current.why) return answer({ picked: true, seat, price, why: current.why });
      if (!selected(boxOf(current.row, kind)).exact) return answer({ picked: true, seat, price, why: 'selection-mismatch' });
      // 왜 못 찾았는지 가릴 수 있게 본 것을 같이 돌려준다 — 예매 단추의 수(보이지 않는 것 포함)와 떠 있는 창의 글.
      const hidden = document.querySelectorAll('button.reservbtn').length;
      const open = modals().map((node) => text(node).slice(0, 80)).filter(Boolean).slice(0, 3);
      return answer({ picked: true, seat, price, why: 'no-book-button', hint: `예매 단추 ${hidden}개(보이는 것 없음) · 가격 다시 누름 ${retries}번${open.length ? ` · 떠 있는 창: ${open.join(' / ')}` : ''}` });
    }
    if (book.disabled || book.getAttribute('aria-disabled') === 'true') return answer({ picked: true, seat, price, why: 'book-disabled' });
    // hold — 가격 선택까지만 한다. 부른 쪽이 준비 상태를 확인하고 arm → native UIA로 최종 예매를 한 번 누른다.
    if (opts.hold) return answer({ picked: true, ready: true, seat, price });
    book.click();
    return answer({ picked: true, booked: true, seat, price });
  }

  // settle — 결제 직전 화면인가, 아니면 넘어가려고 떠 있는 창이 있는가. 차단 안내는 확인으로 닫고 본다.
  if (!await passGuard()) return answer({ why: 'guard' });
  if (location.pathname.startsWith('/ticket/login')) return answer({ login: true });
  const body = text(document.body);
  // 예약내역 목록도 /ticket/reservation 아래에 있다. 상세 화면의 결제 단추가 실제로 보일 때만 완료다.
  // 로딩 중인 상세 URL이나 안내문 속 "결제하기"만으로 예약 성공이라고 알리지 않는다.
  const payment = [...document.querySelectorAll('button, a, input[type=button], input[type=submit]')]
    .some((el) => visible(el) && (text(el) || el.value) === '결제하기');
  const detail = /^\/ticket\/reservation\/detail\/?$/.test(location.pathname);
  const hasTarget = ['no', 'dep', 'from', 'to', 'date', 'adults', 'seat'].some((key) => opts[key] !== undefined);
  if (detail && hasTarget) {
    const status = readStatus(false);
    if (status.done || status.why === 'reservation-mismatch') return status;
  }
  if (detail && payment && !hasTarget) {
    // 결제 기한 — "2026.11.13 15:22 까지" 같은 글이 있으면 같이 알린다.
    const deadline = body.match(/(?:결제\s*기한|발권\s*기한|결제\s*시한)[^0-9]{0,20}([0-9.\-/년월일\s]*\d{1,2}:\d{2})/)?.[1]?.trim() || '';
    return answer({ done: true, deadline });
  }
  // 차단 안내를 닫은 호출은 여기서 끝낸다. 새 화면을 읽은 다음 별도 단계로 진행한다.
  if (passed.length || busy()) return answer({ done: false, list: location.pathname.startsWith('/ticket/search/list') });
  for (const node of modals()) {
    const words = text(node);
    if (!words) continue;
    said.push(words.slice(0, 200));
    const buttons = [...node.querySelectorAll('button, a')].filter(visible);
    // "정차역 수가 적어 … 계속 진행하시겠습니까?" 류는 네. 키워드 없이 네를 누르면 취소류를 잘못 받을 수 있어 글을 본다.
    const yes = /진행하시겠습니까|계속\s*진행|예매하시겠습니까/.test(words) && buttons.find((b) => text(b) === '네');
    const ok = buttons.find((b) => text(b) === '확인');
    const close = buttons.find((b) => text(b) === '창닫기');
    const button = yes || ok || close;
    if (!button) continue;
    const closed = await dismiss(node, button);
    return answer({ done: false, list: location.pathname.startsWith('/ticket/search/list'), ...(closed ? {} : { why: 'modal-pending' }) });
  }
  return answer({ done: false, list: location.pathname.startsWith('/ticket/search/list') });
}

/** 따로 뜬 안내 창 — observeOnly는 읽기, prepareInput은 브라우저 입력 계획만 반환한다. 기존 호출은 네/확인을 누른다. */
export function korailPopupPage({ observeOnly = false, prepareInput = false, expectedWords, expectedUrl, expectedKey } = {}) {
  const text = (node) => String(node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // 호출부가 같은 안내를 다시 누르지 않도록 긴 안내의 변경 부분도 비교에 포함한다.
  const words = text(document.body).slice(0, 2000);
  const notice = document.body.cloneNode(true);
  notice.querySelectorAll('button, a, input').forEach((node) => node.remove());
  const message = text(notice);
  const proceed = /진행하시겠습니까|계속\s*진행/.test(message) || (prepareInput && /예매하시겠습니까/.test(message));
  // 예매 이용안내의 진행만 받는다. 결제·취소·반환 여부를 묻는 창은 사람이 결정한다.
  if (proceed && /결제|취소|환불|반환/.test(message)) return { words, clicked: false, actionable: false };
  if (!proceed && !/안내|확인하시고|선택하신|예매|본인인증|약관/.test(words)
    && !(prepareInput && /-8\d{3}/.test(words))) return { words, clicked: false, actionable: false };
  const buttons = [...document.querySelectorAll('button, a, input[type=button]')]
    .filter((b) => b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden'
      && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
  const label = (b) => text(b) || b.value;
  const yes = proceed && buttons.find((b) => label(b) === '네');
  const button = yes || buttons.find((b) => label(b) === '확인');
  if (prepareInput) {
    const result = (extra = {}) => ({ words, clicked: false, actionable: !!button, ...extra });
    if (location.origin !== 'https://www.korail.com') return result({ actionable: false, why: 'wrong-url' });
    if ((expectedWords !== undefined && words !== expectedWords) || (expectedUrl !== undefined && location.href !== expectedUrl)) return result({ why: 'input-changed' });
    if (!button) return result({ why: 'notice-unavailable' });
    if (/결제|취소|환불|반환/.test(message) && /하시겠|할까요|진행|동의/.test(message)) return result({ actionable: false, why: 'notice-unavailable' });
    const equivalent = buttons.filter((candidate) => label(candidate) === label(button));
    if (equivalent.length !== 1) return result({ why: 'notice-unavailable' });
    button.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = button.getBoundingClientRect(), view = document.defaultView;
    const left = Math.max(0, rect.left), right = Math.min(view.innerWidth, rect.right);
    const top = Math.max(0, rect.top), bottom = Math.min(view.innerHeight, rect.bottom);
    if (!button.isConnected || ![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top
      || !button.getClientRects().length || getComputedStyle(button).visibility === 'hidden'
      || button.disabled || button.matches(':disabled') || button.getAttribute('aria-disabled') === 'true') return result({ why: 'input-unavailable' });
    const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
    const hit = document.elementFromPoint?.(point.x, point.y);
    if (!hit || !(hit === button || button.contains(hit))) return result({ why: 'input-obscured' });
    const key = JSON.stringify([location.href, 'notice', text(document.body), label(button)]);
    if (expectedKey !== undefined && key !== expectedKey) return result({ why: 'input-changed' });
    return result({ plan: { action: 'notice', key, point } });
  }
  if (observeOnly) return { words, clicked: false, actionable: !!button };
  // 호출부에서 1초 기다리는 동안 창이나 안내가 바뀌면 다음 읽기에서 다시 기다린다.
  if ((expectedWords !== undefined && words !== expectedWords)
    || (expectedUrl !== undefined && location.href !== expectedUrl)) return { words, clicked: false, actionable: !!button };
  button?.click();
  return { words, clicked: !!button, actionable: !!button };
}
