// 코레일 승차권 예매 화면(/ticket/search/general)에 조건을 채워 둔다(2026-11-09 사용자 지정: "조건만 채워두기 해봐").
// 사람이 쓰는 팝업(역·날짜·인원)을 그대로 눌러 고른다 — 입력 칸이 읽기 전용이고 React 상태라 값만 넣으면 조회에 쓰이지 않는다.
// 선택자는 native/ktx-python/vendor/ktx_watcher/korail/selectors.py 와 같고, 2026-11-09 실제 화면에서 확인했다.

/**
 * 탭 안에서 돈다(executeScript 로 직렬화되므로 바깥 변수·함수에 기대지 않는다).
 * "열차 조회"(button.btn_lookup)는 찾지도 누르지도 않는다 — 조회 제출은 사람이 한다.
 * 코레일의 차단 안내가 떠 있으면 건드리지 않고 멈춰 그 글을 돌려준다.
 * @param {{from: string, to: string, date: string, hour: number, adults: number}} q
 * @returns {Promise<{form: boolean, guard?: string, missing: string[], shown: {date: string, people: string}}>}
 */
export async function korailFillPage(q) {
  const STATION = '.layerWrap.type_tranin-station-pop_wrap';
  const DATE = '.layerWrap.type_date-pop_wrap';
  const PEOPLE = '.layerWrap.personnel_pop_wrap';
  const GUARD = /-8\d{3}|미허가|개발자도구|비정상적인 접속/;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const $ = (selector, root = document) => root.querySelector(selector);
  const until = async (read, ms = 5000) => {
    const end = Date.now() + ms;
    for (;;) {
      const value = read();
      if (value) return value;
      if (Date.now() >= end) return null;
      await sleep(100);
    }
  };
  const text = (node) => (node?.textContent || '').trim();
  const guardText = () => {
    const words = (document.querySelector('.ReactModalPortal')?.innerText || '').replace(/\s+/g, ' ').trim();
    return GUARD.test(words) ? words.slice(0, 200) : '';
  };
  // 공지·설문 팝업. 창닫기만 누른다("그만보기"는 사람의 설정이라 건드리지 않는다).
  const closeNotices = () => {
    for (const b of document.querySelectorAll('.ReactModalPortal button, .ReactModalPortal a')) if (text(b) === '창닫기') b.click();
  };
  const dateValue = () => $('input#startDate')?.value || '';
  const peopleLabel = () => text($('a.data.btn_pop, .selectAreaWrap a.btn_recom'));

  async function setStation(slot, name) {
    const input = () => $(slot === 'from' ? "input[name='txtGoStart'], input#labelstart" : "input[name='txtGoEnd'], input#labelend");
    const done = () => input()?.value.trim() === name;
    if (done()) return true;
    $(`.selectAreaWrap .${slot === 'from' ? 'start' : 'end'} a.btn_pop-open`)?.click();
    const pop = await until(() => $(STATION));
    if (!pop) return false;
    const pick = () => [...pop.querySelectorAll('a')].find((a) => text(a) === name);
    if (!pick()) {
      // 주요역에 없는 역(서대구·논산 …)은 검색한다 — 후보는 주요역 칸(span.ch_tag)이 아니라 검색창 아래의 따로 된 링크로 뜬다.
      // React 가 값 바뀜을 보도록 원래 설정자로 넣는다.
      const box = $("input[name='searchTxt']", pop);
      if (box) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, name);
        box.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    const option = await until(pick, 2500);
    if (!option) {
      $('.btn_close', pop)?.click();
      await until(() => !$(STATION), 1500);
      return false;
    }
    option.click();
    await until(() => !$(STATION) && done(), 3000);
    return done();
  }

  async function setDate(date, hour) {
    const hourText = `${String(hour).padStart(2, '0')}:00`;
    if (dateValue().startsWith(date) && dateValue().includes(hourText)) return true;
    $('a.btn_pop.btn_d-day')?.click();
    const pop = await until(() => $(DATE));
    if (!pop) return false;
    const [y, m, d] = date.split('-').map(Number);
    const monthOf = (slide) => {
      const found = text($('.datepicker .date', slide)).match(/(20\d{2})\s*[.년]\s*(\d{1,2})/);
      return found ? +found[1] * 12 + +found[2] : 0;
    };
    const want = y * 12 + m;
    // 달력은 넘겨서 보이는 달만 누를 수 있다. 넘김 애니메이션 중의 클릭은 무시되므로 기다린다.
    // 달력이 뜨자마자 넘기면 화면만 넘어가고 코레일 쪽 달이 그대로라 칸이 잠긴 채 남는다(2026-11-09 실측) — 첫 넘김 전에 자리 잡기를 기다린다.
    if (monthOf($('.datepk_wrap .slick-active', pop) || pop) !== want) await sleep(1000);
    for (let i = 0; i < 13; i++) {
      const shown = monthOf($('.datepk_wrap .slick-active', pop) || pop);
      if (!shown || shown === want) break;
      // 달력이 막 뜬 때는 화살표가 잠겨 있다가 풀린다. 끝까지 잠겨 있으면 고를 수 없는 달이다.
      const arrow = await until(() => {
        const a = $(`.datepk_wrap .slick-${shown < want ? 'next' : 'prev'}`, pop);
        return a && !a.classList.contains('slick-disabled') ? a : null;
      }, 1200);
      if (!arrow) break;
      arrow.click();
      await sleep(650);
    }
    // 넘긴 달의 칸은 애니메이션이 끝나야 풀린다. 끝까지 잠겨 있으면 예매 범위 밖의 날이다.
    const link = await until(() => {
      const slide = [...pop.querySelectorAll('.datepk_wrap .slick-active')].find((s) => monthOf(s) === want);
      const day = slide && [...slide.querySelectorAll('tbody td')].find((td) => !td.classList.contains('disabled') && text($('.day', td)) === String(d));
      const a = day && $('a', day);
      return a && a.getAttribute('aria-disabled') !== 'true' ? a : null;
    }, 1500);
    if (!link) {
      $('.btn_wrap button.btn_pop-close', pop)?.click();
      await until(() => !$(DATE), 1500);
      return false;
    }
    link.click();
    await sleep(300);
    // 시각은 한 번에 몇 개만 보이는 캐러셀이다. 안 보이는 칸은 누를 수 없어 화살표로 옮긴다.
    // 오늘의 지난 시각은 없거나 잠겨 있다 — 그때는 코레일이 고른 시각으로 두고 적용한다(패널이 알린다).
    const names = [`${hour}시`, `${String(hour).padStart(2, '0')}시`];
    for (let i = 0; i < 24; i++) {
      const slides = [...pop.querySelectorAll('.timeSelect .slick-slide')];
      const at = slides.findIndex((s) => names.includes(text($('a', s))));
      if (at < 0) break;
      const target = $('a', slides[at]);
      if (target.getAttribute('aria-disabled') !== 'true') { target.click(); break; }
      const first = slides.findIndex((s) => s.classList.contains('slick-active'));
      const arrow = $(`.timeSelect .slick-${at < first ? 'prev' : 'next'}`, pop);
      if (!arrow || arrow.classList.contains('slick-disabled')) break;
      arrow.click();
      await sleep(650);
    }
    await sleep(200);
    $('.btn_wrap button.btn_bn-blue', pop)?.click();
    await until(() => !$(DATE), 3000);
    return dateValue().startsWith(date);
  }

  async function setPeople(adults) {
    $('a.data.btn_pop, .selectAreaWrap a.btn_recom')?.click();
    const pop = await until(() => $(PEOPLE));
    if (!pop) return false;
    const want = (label) => (label.startsWith('어른') ? adults : 0);
    const rows = () => [...pop.querySelectorAll('.ticketInfo_bottom li')].map((li) => ({
      li, label: text($(':scope > p', li)), count: parseInt(text($('.flo_right span', li)), 10) || 0,
    })).filter((r) => r.label);
    if (!rows().length || !rows().some((r) => r.label.startsWith('어른'))) {
      $('.btnWrap button.btn_pop-close', pop)?.click();
      return false;
    }
    if (rows().every((r) => r.count === want(r.label))) {
      $('.btnWrap button.btn_pop-close', pop)?.click();
      await until(() => !$(PEOPLE), 1500);
      return true;
    }
    // 늘리기를 먼저 — 총원이 0명이 되면 줄이기 단추가 잠긴다.
    for (const up of [true, false]) {
      for (const { label } of rows()) {
        for (let i = 0; i < 12; i++) {
          const row = rows().find((r) => r.label === label);
          const gap = want(label) - row.count;
          if (!gap || (gap > 0) !== up) break;
          const step = $(`.flo_right button.${up ? 'up_num' : 'down_num'}`, row.li);
          if (!step || step.disabled) break;
          step.click();
          await sleep(120);
        }
      }
    }
    const right = rows().every((r) => r.count === want(r.label));
    if (!right) {
      $('.btnWrap button.btn_pop-close', pop)?.click();
      await until(() => !$(PEOPLE), 1500);
      return false;
    }
    $('.btnWrap button.btn_bn-blue', pop)?.click();
    // 구성에 따라 "선택하신 인원이 확실한가요?" 를 한 번 더 묻는다.
    const yes = await until(() => $('.layerWrap:has(.confirm_message) button.btn_bn-blue') || !$(PEOPLE), 1500);
    if (yes instanceof Element) yes.click();
    await until(() => !$(PEOPLE), 3000);
    return new RegExp(`(^|\\D)${adults}\\s*명`).test(peopleLabel());
  }

  const answer = (extra) => ({ form: true, missing: [], shown: { date: dateValue(), people: peopleLabel() }, ...extra });
  if (!await until(() => $("input[name='txtGoStart'], input#labelstart") && $('a.btn_pop.btn_d-day'), 12000)) {
    return { form: false, guard: guardText(), missing: [], shown: { date: '', people: '' } };
  }
  await sleep(300); // 공지 팝업은 폼보다 조금 늦게 뜬다.
  const missing = [];
  const steps = [
    ['출발역', () => setStation('from', q.from)],
    ['도착역', () => setStation('to', q.to)],
    ['출발일', () => setDate(q.date, q.hour)],
    ['인원', () => setPeople(q.adults)],
  ];
  for (const [label, step] of steps) {
    const guard = guardText();
    if (guard) return answer({ guard, missing: [...missing, label] });
    closeNotices();
    if (!await step()) missing.push(label);
  }
  // 역을 고르면 코레일이 맞은편 역을 바꾸기도 해서(같은 역을 못 두게) 끝난 뒤에 두 역을 다시 본다.
  if (!missing.includes('출발역') && !await setStation('from', q.from)) missing.push('출발역');
  if (!missing.includes('도착역') && !await setStation('to', q.to)) missing.push('도착역');
  closeNotices();
  const guard = guardText();
  return answer(guard ? { guard, missing } : { missing });
}
