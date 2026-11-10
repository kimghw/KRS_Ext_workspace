// 코레일 결과 탭에서 좌석 예약 — 결제 직전 화면까지(2026-11-10 사용자 지정: "좌석이 생기면 결재는 아니고 좌석 예약까지 할 수 있도록 구현해 줄래?").
// 순서와 선택자는 binjari 의 예약 흐름(ktx_watcher/korail/reserve.py attempt_reservation, 2026-05-14 실측)과 같다:
//   결과 줄의 가격 <a> 를 누르면 그 줄이 골라지고 → 화면 아래의 button.reservbtn("예매")을 누르면 → 안내 창을 지나 /ticket/reservation/detail(좌석이 잡힌 결제 직전 화면).
// 결제하기·카드 입력은 건드리지 않는다. 코레일 로그인은 되어 있다고 본다 — 로그인 화면이 나오면 부른 쪽(src/ktx.js ktxReserve)이 멈춘다.

/**
 * 탭 안에서 돈다(executeScript 로 직렬화되므로 바깥 변수·함수에 기대지 않는다).
 * step — 'pick': 결과 목록에서 그 열차(번호·출발 시각·구간) 한 줄을 찾아 일반실(없으면 특실)의 살 수 있는 가격을 누르고 예매 단추를 누른다 ·
 * 'settle': 예매 뒤의 화면을 본다 — 진행 확인("계속 진행하시겠습니까")은 네, 안내는 확인을 누르고 그 글을 돌려준다. 결제 직전 화면이면 done.
 * 차단 안내(-8xxx 등)는 누르지 않고 guard 로 돌려준다.
 * @param {'pick'|'settle'} step
 * @param {{no?: string, dep?: string, from?: string, to?: string, seat?: 'any'|'gen'|'spec'}} [opts]
 * @returns {Promise<{url: string, picked?: boolean, booked?: boolean, seat?: string, price?: string, done?: boolean, login?: boolean,
 *   said: string[], guard: {code: string, message: string}|null, why?: string, deadline?: string}>}
 */
export async function korailReservePage(step, opts = {}) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const text = (node) => String(node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const modals = () => [...document.querySelectorAll('.ReactModal__Content, [role=dialog], .layerWrap')].filter(visible);
  const guardOf = () => {
    for (const node of modals()) {
      const words = text(node);
      const code = words.match(/(?<!\d)-8\d{3}(?!\d)/)?.[0] || '';
      if (code || /미허가|개발자도구|비정상적인 접속/.test(words)) return { code, message: words.slice(0, 300) };
    }
    return null;
  };
  const said = [];
  const answer = (extra = {}) => ({ url: location.href, said, guard: guardOf(), ...extra });

  if (step === 'pick') {
    const guard = guardOf();
    if (guard) return answer({ why: 'guard' });
    if (!location.pathname.startsWith('/ticket/search/list')) return answer({ why: 'not-list' });
    const no = String(opts.no || '').replace(/^0+(?=\d)/, '');
    if (!/^\d{1,4}$/.test(no) || !/^\d{2}:\d{2}$/.test(String(opts.dep || ''))) return answer({ why: 'bad-target' });
    const named = new RegExp(`(?:KTX(?:-[가-힣A-Za-z]+)?|청룡)\\s*0*${no}(?!\\d)`);
    const [h, m] = opts.dep.split(':');
    const departs = new RegExp(`\\(\\s*0?${+h}:${m}\\s*~`);
    const rows = [...document.querySelectorAll('li.tckList')].filter((li) => {
      const words = text(li);
      if (!named.test(words) || !departs.test(words)) return false;
      const [origin, dest] = [...li.querySelectorAll('.data_box h3 > span')].slice(0, 2).map(text);
      return (!opts.from || origin === opts.from) && (!opts.to || dest === opts.to);
    });
    // 줄 번호는 새로고침마다 바뀔 수 있다 — 번호·출발 시각·구간이 같은 줄이 꼭 하나일 때만 고른다. 다른 열차로 대신하지 않는다.
    if (rows.length !== 1) return answer({ why: rows.length ? 'many-rows' : 'no-row' });
    const li = rows[0];
    const boxes = [...li.querySelectorAll('.price_box')];
    const gen = boxes.find((b) => b.classList.contains('gen')) || boxes[0] || null;
    const spec = boxes.find((b) => b !== gen) || null;
    // 살 수 있는 칸 — 매진(매진임박은 산다)·예약대기·입석이 아니고 "…원" 가격 링크가 하나.
    const priceLink = (box) => {
      if (!box) return null;
      const cls = String(box.className || '');
      if (/\bsold_out(_wait)?\b/.test(cls) && !/sold_out_soon/.test(cls)) return null;
      const links = [...box.querySelectorAll('a')].filter((a) => visible(a) && /[\d,]+\s*원/.test(text(a))
        && !/매진(?!임박)|예약대기|입석/.test(text(a)));
      return links.length === 1 ? links[0] : null;
    };
    const order = opts.seat === 'spec' ? [['특실', spec]] : opts.seat === 'gen' ? [['일반실', gen]] : [['일반실', gen], ['특실', spec]];
    const choice = order.map(([label, box]) => [label, priceLink(box)]).find(([, link]) => link);
    if (!choice) return answer({ why: 'no-seat' });
    const [seat, link] = choice;
    const price = text(link).match(/[\d,]+\s*원/)?.[0].replace(/\s+/g, '') || '';
    link.click();
    // 가격을 누르면 그 열차의 이용안내("서대구정차하는 열차입니다. 도착시간을 확인하시기 바랍니다." — 2026-11-10 실측)가 먼저 뜨기도 한다.
    // 안내는 확인, 진행 확인은 네를 누르고 그 글을 돌려준다. 차단 안내면 멈춘다. 예매 단추가 보일 때까지 3초 남짓.
    let book = null;
    for (let i = 0; i < 12 && !book; i++) {
      await sleep(300);
      const blocked = guardOf();
      if (blocked) return answer({ picked: true, seat, price, why: 'guard' });
      for (const node of modals()) {
        const words = text(node);
        const buttons = [...node.querySelectorAll('button, a')].filter(visible);
        const yes = /진행하시겠습니까|계속\s*진행/.test(words) && buttons.find((b) => text(b) === '네');
        const ok = yes || buttons.find((b) => text(b) === '확인');
        if (!ok) continue;
        said.push(words.slice(0, 200));
        ok.click();
        await sleep(300);
      }
      if (!modals().some((node) => [...node.querySelectorAll('button, a')].some((b) => visible(b) && ['확인', '네'].includes(text(b))))) {
        book = [...document.querySelectorAll('button.reservbtn')].find(visible) || null;
      }
    }
    if (!book) return answer({ picked: true, seat, price, why: 'no-book-button' });
    if (book.disabled || book.getAttribute('aria-disabled') === 'true') return answer({ picked: true, seat, price, why: 'book-disabled' });
    book.click();
    return answer({ picked: true, booked: true, seat, price });
  }

  // settle — 결제 직전 화면인가, 아니면 넘어가려고 떠 있는 창이 있는가.
  const guard = guardOf();
  if (guard) return answer({ why: 'guard' });
  if (location.pathname.startsWith('/ticket/login')) return answer({ login: true });
  const body = text(document.body);
  if (location.pathname.startsWith('/ticket/reservation') || /결제하기/.test(body)) {
    // 결제 기한 — "2026.11.13 15:22 까지" 같은 글이 있으면 같이 알린다.
    const deadline = body.match(/(?:결제\s*기한|발권\s*기한|결제\s*시한)[^0-9]{0,20}([0-9.\-/년월일\s]*\d{1,2}:\d{2})/)?.[1]?.trim() || '';
    return answer({ done: true, deadline });
  }
  for (const node of modals()) {
    const words = text(node);
    if (!words) continue;
    said.push(words.slice(0, 200));
    const buttons = [...node.querySelectorAll('button, a')].filter(visible);
    // "정차역 수가 적어 … 계속 진행하시겠습니까?" 류는 네. 키워드 없이 네를 누르면 취소류를 잘못 받을 수 있어 글을 본다.
    const yes = /진행하시겠습니까|계속\s*진행|예매하시겠습니까/.test(words) && buttons.find((b) => text(b) === '네');
    const ok = buttons.find((b) => text(b) === '확인');
    const close = buttons.find((b) => text(b) === '창닫기');
    (yes || ok || close)?.click();
    if (yes || ok || close) await sleep(500);
  }
  return answer({ done: false });
}

/** 예매 뒤에 따로 뜬 안내 창(window.open)의 확인 — binjari 의 dismiss_all_popups 와 같이 안내 글이 있는 창만. 글을 돌려준다. */
export function korailPopupPage() {
  const text = (node) => String(node?.innerText ?? node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const words = text(document.body).slice(0, 300);
  if (!/안내|확인하시고|선택하신|예매|본인인증|약관/.test(words)) return { words, clicked: false };
  const ok = [...document.querySelectorAll('button, a, input[type=button]')].find((b) => (text(b) || b.value) === '확인');
  ok?.click();
  return { words, clicked: !!ok };
}
