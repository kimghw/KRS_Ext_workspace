"""Query form, guard re-query and row parsing extracted from binjari; bridge adds a one-shot entrypoint."""
from __future__ import annotations
import logging
import re
import time as _time
from datetime import date as _date, time as Time
from typing import Any, Dict, List, Optional
from ..browser import Page, TimeoutError as PWTimeoutError
from ..config import KTXAConfig
from ..dom import read_page_state
from ..diagnostics import record_guard
from . import GuardBlocked, SiteLayoutChanged, QueryConditionMismatch, SearchResultUnavailable
from . import selectors as S
from .client import (KorailSPAClient, dismiss_macro_notice, dismiss_notice_modal, human_click, human_pause,
                     human_type, inspect_guard_notice, safe_goto)
LOGGER = logging.getLogger(__name__)
_TIME_RE = re.compile(r"(\d{1,2}):(\d{2})")
# Same-condition re-queries in this process (binjari's counter; the one-shot entrypoint reads it).
_REQUERY_COUNT = 0

def _input_value(page: Page, sel: str) -> str:
    try:
        return (page.locator(sel).first.input_value(timeout=1500) or "").strip()
    except Exception:
        return ""



def _select_station(page: Page, slot: str, station: str) -> None:
    """slot='origin'|'dest'. 이미 입력돼 있으면 skip."""
    input_sel = S.ORIGIN_INPUT if slot == "origin" else S.DEST_INPUT
    if _input_value(page, input_sel) == station.strip():
        LOGGER.info("역 (%s) 이미 %r — skip", slot, station)
        return

    open_sel = S.ORIGIN_BTN if slot == "origin" else S.DEST_BTN
    LOGGER.info("역 선택: slot=%s name=%s", slot, station)
    human_click(page.locator(open_sel).first)

    try:
        page.wait_for_selector(S.STATION_POPUP, timeout=8000)
    except PWTimeoutError:
        raise SiteLayoutChanged(f"역 선택 팝업 안 뜸 (slot={slot})")
    human_pause(0.4, 0.9)

    # 검색창에 입력 후 정확매칭 클릭
    try:
        inp = page.locator(S.STATION_POPUP_INPUT).first
        if inp.count() > 0:
            inp.fill(station, timeout=3000)
            human_pause(0.3, 0.7)
    except Exception as e:
        LOGGER.debug("역명 검색어 입력 skip: %s", e)

    try:
        opt = page.locator(S.STATION_POPUP_OPTION).get_by_text(station, exact=True).first
        if opt.count() == 0:
            raise SiteLayoutChanged(f"역 항목 미발견: {station}")
        human_click(opt)
        try:
            page.wait_for_selector(S.STATION_POPUP, state="hidden", timeout=4000)
        except Exception:
            pass
        human_pause(0.4, 0.9)
    except SiteLayoutChanged:
        raise
    except Exception as e:
        raise SiteLayoutChanged(f"역 항목 클릭 실패 ({station}): {e}") from e

    # 검증
    if _input_value(page, input_sel) != station.strip():
        raise SiteLayoutChanged(f"역 적용 검증 실패: expected={station!r}")



def _read_current_ym(page: Page) -> Optional[tuple[int, int]]:
    """현재 visible(slick-active) 슬라이드의 datepicker label 에서 YYYY-MM 추출.
    label 형식: "2026. 06." (점 구분) 또는 "2026년 06월" 둘 다 매칭."""
    raw = page.evaluate(
        """() => {
            const root = document.querySelector('.layerWrap.type_date-pop_wrap');
            if (!root) return null;
            const re = /(20\\d{2})\\s*[.\\uB144]\\s*(\\d{1,2})/;  // YYYY [. 또는 년] MM
            // visible slide 안의 .datepicker .date 우선
            const active = root.querySelectorAll('.slick-active');
            for (const el of active) {
                const dp = el.querySelector('.datepicker .date') || el;
                const t = (dp.textContent || '').trim();
                const m = t.match(re);
                if (m) return {y: +m[1], mo: +m[2]};
            }
            // fallback: 모든 datepicker .date
            for (const dp of root.querySelectorAll('.datepicker .date')) {
                const t = (dp.textContent || '').trim();
                const m = t.match(re);
                if (m) return {y: +m[1], mo: +m[2]};
            }
            return null;
        }"""
    )
    if not raw:
        return None
    return int(raw["y"]), int(raw["mo"])



def _click_day(page: Page, day: int, year: Optional[int] = None, month: Optional[int] = None) -> bool:
    """day 셀 클릭. slick carousel 안에 여러 월 datepicker 가 mount 돼 있어도
    year/month 가 주어지면 그 월 헤더 가진 카드 안의 day 만 클릭."""
    return bool(page.evaluate(
        """([d, y, mo]) => {
            const wrap = document.querySelector('.layerWrap.type_date-pop_wrap');
            if (!wrap) return false;
            // 후보 카드: slick-slide, datepk_wrap, 또는 wrap 전체 (단일 datepicker 케이스)
            const cards = [...wrap.querySelectorAll('.slick-slide'), ...wrap.querySelectorAll('.datepk_wrap')];
            const search = (root) => {
                if (y && mo) {
                    const headerEl = root.querySelector('.datepicker .date') || root;
                    const t = (headerEl.textContent || '').trim();
                    const m = t.match(/(20\\d{2})\\s*[.\\uB144]\\s*(\\d{1,2})/);
                    if (!m || +m[1] !== y || +m[2] !== mo) return false;
                }
                const dp = root.querySelector('.datepicker') || root;
                const tbody = dp.querySelector('tbody');
                if (!tbody) return false;
                for (const td of tbody.querySelectorAll('td')) {
                    if (td.classList.contains('disabled')) continue;
                    const a = td.querySelector('a');
                    if (!a || a.getAttribute('aria-disabled') === 'true') continue;
                    const span = a.querySelector('.day');
                    const txt = span ? span.textContent.trim() : a.textContent.trim();
                    if (txt === String(d)) { a.click(); return true; }
                }
                return false;
            };
            for (const c of cards) { if (search(c)) return true; }
            // fallback: month 헤더 검사 없이 wrap 전체에서 첫 매칭
            return search(wrap);
        }""",
        [day, year, month],
    ))



def _click_hour(page: Page, hour: int) -> bool:
    """시각 선택. timeSelect 는 slick 캐러셀 (한 번에 5개만 노출) —
    비노출 anchor 는 aria-disabled=true 라 클릭이 무효 (2026-08-19 CDP 실측).
    목표 시각이 화면 밖이면 화살표로 스크롤한 뒤 클릭한다.
    """
    texts = [f"{hour}시", f"{hour:02d}시"]
    probe_js = """(texts) => {
        const root = document.querySelector('.layerWrap.type_date-pop_wrap .timeSelect');
        if (!root) return 'absent';
        const slides = [...root.querySelectorAll('.slick-slide')];
        let target = null, targetIdx = -1, firstActive = -1;
        slides.forEach((s, i) => {
            const a = s.querySelector('a');
            if (s.classList.contains('slick-active') && firstActive < 0) firstActive = i;
            if (!target && a && texts.includes((a.textContent || '').trim())) {
                target = a; targetIdx = i;
            }
        });
        // 캐러셀이 아닌 (구형) 평면 목록 fallback
        if (!slides.length) {
            for (const a of root.querySelectorAll('a')) {
                if (texts.includes((a.textContent || '').trim())) {
                    if (a.getAttribute('aria-disabled') === 'true') return 'absent';
                    a.click(); return 'clicked';
                }
            }
            return 'absent';
        }
        if (!target) return 'absent';
        if (target.getAttribute('aria-disabled') !== 'true') { target.click(); return 'clicked'; }
        return targetIdx < firstActive ? 'prev' : 'next';
    }"""
    arrow_js = """(dir) => {
        const btn = document.querySelector(
            '.layerWrap.type_date-pop_wrap .timeSelect .slick-' + dir);
        if (!btn || btn.classList.contains('slick-disabled')) return false;
        btn.click(); return true;
    }"""
    for _ in range(24):
        state = page.evaluate(probe_js, texts)
        if state == "clicked":
            return True
        if state == "absent":
            return False
        if not page.evaluate(arrow_js, state):
            return False  # 화살표 끝까지 갔는데 목표 시각 미노출
        # slick 애니메이션(~0.5s) 중 클릭은 무시됨 — humanize 여부와 무관하게 대기
        page.wait_for_timeout(650)
    return False



def _set_date(page: Page, target: _date, hour: int) -> None:
    # picker 클릭이 공지 모달 (ReactModalPortal) 에 가로채일 수 있어 매번 dismiss 시도
    dismiss_notice_modal(page)
    # 이미 같은 값이면 picker 안 열음 (반복 자동화 시그널 회피).
    cur = _input_value(page, S.DATE_INPUT)
    want_prefix = target.isoformat()
    want_hour = f"{hour:02d}:00"
    if cur.startswith(want_prefix) and want_hour in cur:
        LOGGER.info("출발일 이미 일치 — picker skip (%s)", cur)
        return

    LOGGER.info("출발일 설정: %s %02d시 (현재=%s)", target.isoformat(), hour, cur)
    human_click(page.locator(S.DATE_PICKER_BTN).first)
    try:
        page.wait_for_selector(S.DATE_POPUP, timeout=8000)
    except PWTimeoutError:
        raise SiteLayoutChanged("date picker 팝업 안 뜸")
    human_pause(0.5, 0.9)

    # 월 정렬
    target_ym = (target.year, target.month)
    aligned = False
    for _ in range(12):
        cur = _read_current_ym(page)
        if cur is None:
            break  # 헤더 추출 실패 → 일 매칭으로 폴백
        if cur == target_ym:
            aligned = True
            break
        try:
            if cur < target_ym:
                page.locator(S.DATE_POPUP_NEXT).first.click(timeout=2000)
            else:
                page.locator(S.DATE_POPUP_PREV).first.click(timeout=2000)
            human_pause(0.3, 0.6)
        except Exception:
            break

    if not _click_day(page, target.day, target.year, target.month):
        # 진단: picker DOM 일부 dump
        try:
            dump = page.evaluate(
                """() => {
                    const w = document.querySelector('.layerWrap.type_date-pop_wrap');
                    if (!w) return 'WRAP_NULL';
                    const dps = [...w.querySelectorAll('.datepicker')];
                    const summary = dps.map(dp => {
                        const dateLabel = (dp.querySelector('.date')?.textContent || '').trim();
                        const tds = [...dp.querySelectorAll('tbody td')];
                        const td_cls_sample = tds.slice(0, 8).map(t => t.className || '');
                        const a_sample = tds.slice(0, 8).map(t => {
                            const a = t.querySelector('a');
                            if (!a) return 'NOA';
                            return JSON.stringify({txt: (a.textContent||'').trim(), ariaDis: a.getAttribute('aria-disabled'), cls: a.className || ''});
                        });
                        // find day=1 td across this dp
                        let day1_info = 'NONE';
                        for (const td of tds) {
                            const a = td.querySelector('a');
                            const txt = (a?.textContent || td.textContent || '').trim();
                            if (txt === '1') {
                                day1_info = JSON.stringify({
                                    td_cls: td.className || '',
                                    a_present: !!a,
                                    a_aria: a ? a.getAttribute('aria-disabled') : null,
                                    a_cls: a ? (a.className || '') : null,
                                });
                                break;
                            }
                        }
                        return { label: dateLabel, td_count: tds.length, td_cls_sample, a_sample, day1_info };
                    });
                    return JSON.stringify(summary, null, 0).slice(0, 4000);
                }"""
            )
        except Exception as e:
            dump = f"DUMP_ERR:{e}"
        LOGGER.warning("date picker %d일 미발견 — DOM dump: %s", target.day, dump)
        try:
            page.locator(S.DATE_POPUP_CANCEL).first.click(timeout=1500)
        except Exception:
            pass
        raise SiteLayoutChanged(f"date picker {target.day}일 셀 미발견")
    human_pause(0.3, 0.6)

    if not _click_hour(page, hour):
        raise QueryConditionMismatch(f"Requested hour {hour:02d}:00 could not be selected")
    human_pause(0.3, 0.6)

    # 안내 모달(ReactModal)이 뒤늦게 떠서 적용 버튼 클릭을 가로챌 수 있음
    dismiss_notice_modal(page)
    try:
        page.locator(S.DATE_POPUP_APPLY).first.click(timeout=4000)
    except Exception as e:
        raise SiteLayoutChanged(f"date picker 적용 실패: {e}") from e
    human_pause(0.5, 1.0)

    # 검증
    cur = _input_value(page, S.DATE_INPUT)
    if not cur.startswith(target.isoformat()):
        raise SiteLayoutChanged(f"date input 검증 실패: 현재={cur!r}")
    LOGGER.info("출발일 적용 OK: %s", cur)



def _read_passenger_counts(page: Page) -> Optional[Dict[str, int]]:
    """열린 인원선택 팝업의 {li 라벨: 현재 인원}. 팝업 미발견 시 None."""
    return page.evaluate(
        """() => {
            const root = document.querySelector('.layerWrap.personnel_pop_wrap');
            if (!root) return null;
            const out = {};
            for (const li of root.querySelectorAll('.ticketInfo_bottom li')) {
                const label = (li.querySelector('p')?.textContent || '').trim();
                const span = li.querySelector('.flo_right span');
                if (label && span) out[label] = parseInt(span.textContent.trim(), 10) || 0;
            }
            return out;
        }"""
    )



def _click_passenger_step(page: Page, label: str, up: bool) -> bool:
    """라벨(prefix 매칭) li 의 증가/감소 버튼 1회 클릭. disabled/미발견이면 False."""
    return bool(page.evaluate(
        """([label, up]) => {
            const root = document.querySelector('.layerWrap.personnel_pop_wrap');
            if (!root) return false;
            for (const li of root.querySelectorAll('.ticketInfo_bottom li')) {
                const t = (li.querySelector('p')?.textContent || '').trim();
                if (!t.startsWith(label)) continue;
                const btn = li.querySelector('.flo_right button.' + (up ? 'up_num' : 'down_num'));
                if (!btn || btn.disabled) return false;
                btn.click();
                return true;
            }
            return false;
        }""",
        [label, up],
    ))



def _set_passengers(page: Page, config: KTXAConfig) -> None:
    """인원선택 팝업에서 유형별 인원을 config 값에 맞춘다 (예: 경로 1명).

    폼의 '총 N명' 라벨은 합계만 보여서 구성(어른/경로 등)은 팝업을 열어야만
    확인 가능 → 폼 진입 시 1회 열어 검증, 이미 일치하면 취소로 닫는다.
    """
    desired_by_type = config.passenger_counts()

    def want(label: str) -> int:
        for t, n in desired_by_type.items():
            if label.startswith(S.PASSENGER_TYPE_PREFIX[t]):
                return n
        return 0

    dismiss_notice_modal(page)
    LOGGER.info("인원 확인: %s", desired_by_type)
    human_click(page.locator(S.PEOPLE_BTN).first)
    try:
        page.wait_for_selector(S.PEOPLE_POPUP, timeout=8000)
    except PWTimeoutError:
        raise SiteLayoutChanged("인원선택 팝업 안 뜸")
    human_pause(0.4, 0.8)

    cur = _read_passenger_counts(page)
    if not cur:
        raise SiteLayoutChanged("인원선택 팝업 카운트 파싱 실패")

    if all(cnt == want(label) for label, cnt in cur.items()):
        LOGGER.info("인원 이미 일치 — 팝업 취소로 닫음")
        try:
            page.locator(S.PEOPLE_POPUP_CANCEL).first.click(timeout=3000)
        except Exception:
            pass
        human_pause(0.3, 0.6)
        return

    LOGGER.info("인원 조정: 현재=%s → 목표=%s", cur, desired_by_type)
    # 증가 먼저 → 감소: 총원이 0명이 되는 순간(감소 버튼 disabled)을 피한다.
    for up in (True, False):
        for label, cnt in (_read_passenger_counts(page) or {}).items():
            delta = want(label) - cnt
            if (delta > 0) is not up or delta == 0:
                continue
            for _ in range(abs(delta)):
                if not _click_passenger_step(page, label, up):
                    raise SiteLayoutChanged(
                        f"인원 {'증가' if up else '감소'} 버튼 클릭 실패: {label}"
                    )
                human_pause(0.15, 0.4)

    cur = _read_passenger_counts(page) or {}
    bad = {l: c for l, c in cur.items() if c != want(l)}
    if bad:
        raise SiteLayoutChanged(f"인원 적용 전 검증 실패: {bad}")
    human_pause(0.3, 0.6)

    try:
        page.locator(S.PEOPLE_POPUP_APPLY).first.click(timeout=4000)
    except Exception as e:
        raise SiteLayoutChanged(f"인원 팝업 적용 실패: {e}") from e
    # 비어른 구성이면 "선택하신 인원이 확실한가요?" 확인 모달이 한 번 더 뜬다 → 예
    try:
        yes = page.locator(S.PEOPLE_CONFIRM_YES).first
        yes.wait_for(state="visible", timeout=3000)
        human_pause(0.3, 0.7)
        yes.click(timeout=3000)
        LOGGER.info("인원 확인 모달 '예' 클릭")
    except Exception:
        pass  # 어른 구성 등 모달이 없으면 그대로 진행
    try:
        page.wait_for_selector(S.PEOPLE_POPUP, state="hidden", timeout=4000)
    except Exception:
        pass
    human_pause(0.3, 0.7)

    total = sum(desired_by_type.values())
    try:
        label_txt = (page.locator(S.PEOPLE_BTN).first.inner_text(timeout=1500) or "").strip()
    except Exception:
        label_txt = ""
    if label_txt and str(total) not in label_txt:
        # 유아는 '총 N명' 합계에서 빠질 수 있어 경고만.
        LOGGER.warning("인원 라벨 불일치(계속 진행): 기대 총 %d명, 라벨=%r", total, label_txt)
    LOGGER.info("인원 적용 OK: %s (라벨: %s)", desired_by_type, label_txt or "?")



def _click_train_type_tab(page: Page, train_type: str) -> bool:
    if not train_type or train_type in ("전체", "ALL"):
        return False
    sel = S.TRAIN_TYPE_TAB.get(train_type)
    if not sel:
        LOGGER.warning("열차종류 '%s' 미지원", train_type)
        return False
    try:
        state = read_page_state(page, tab=sel, include_text=False)["tab"]
    except Exception as e:
        LOGGER.debug("Train tab state unavailable: %s", e)
        return False
    if state is None or state["active"]:
        return False
    loc = page.locator(sel).first
    # 클릭 전 modal dismiss (delayed -8002 우회)
    for attempt in range(3):
        if _check_guard(page, "train type tab"):
            raise GuardBlocked("열차 종류 변경 중 명시적 차단 안내", explicit=True)
        try:
            loc.click(timeout=4000)
            LOGGER.info("열차종류 탭 '%s' 클릭 (attempt=%d)", train_type, attempt + 1)
            human_pause(0.8, 1.4)
            _wait_result_list(page, where="train type tab")
            return True
        except Exception as e:
            LOGGER.warning("열차종류 탭 클릭 attempt=%d 실패: %s", attempt + 1, e)
            _time.sleep(0.8)
    return False



def _parse_depart_time(text: str) -> Optional[Time]:
    m = _TIME_RE.search(text)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if 0 <= h < 24 and 0 <= mi < 60:
        return Time(hour=h, minute=mi)
    return None



def _parse_result_rows(page: Page) -> List[Dict[str, Any]]:
    """결과 row 를 JS-side scan 으로 추출.

    DOM 구조 (CDP probe 2026-05-14):
      <li class="tckList ...">
        <div class="price_box gen [sold_out_soon|sold_out]">  ← 일반실
        <div class="price_box [sold_out_soon|sold_out]">      ← 특실
      </li>
    매진된 등급은 "특실" 라벨이 dom 에서 빠지므로 text-split 으로는 분리 불가.
    → class 로 직접 판별. sold_out (sold_out_soon 제외) = 매진. sold_out_soon = 매진임박(예약 가능).
    """
    raw = page.evaluate(
        """() => {
            const out = [];
            const containers = document.querySelectorAll('li.tckList');
            containers.forEach((el, i) => {
                const t = (el.textContent || '').trim();
                if (!/\\d{1,2}:\\d{2}/.test(t)) return;
                if (!/KTX|새마을|무궁화|ITX|누리로|청룡|SRT/i.test(t)) return;

                const parseBox = (box) => {
                    if (!box) return null;
                    const cls = box.className || '';
                    const txt = (box.textContent || '').trim();
                    const soldOutSoon = /sold_out_soon/.test(cls);
                    // soldOut: class 에 'sold_out' 있고 'sold_out_soon' 아님 (sold_out_wait 는 텍스트 기반으로 판정)
                    const soldOut = /\\bsold_out\\b/.test(cls) && !soldOutSoon;
                    const hasPrice = /\\d+,\\d+원/.test(txt);
                    return {
                        cls: cls,
                        text: txt,
                        sold_out: soldOut,
                        imminent: soldOutSoon,
                        has_price: hasPrice,
                    };
                };
                // priceBox 위치 기반: 좌측(첫 번째) = 일반실, 우측(두 번째) = 특실.
                // class 'gen' 은 예약 가능 row 에만 붙고 매진/wait/sold_out_wait row 에는 빠짐.
                const allBoxes = Array.from(el.querySelectorAll('.price_box'));
                let genBox = allBoxes.find(b => b.classList.contains('gen')) || allBoxes[0] || null;
                let specBox = null;
                for (const b of allBoxes) {
                    if (b !== genBox) { specBox = b; break; }
                }
                out.push({
                    index: i,
                    text: t,
                    origin: el.querySelector('.data_box h3 > span:nth-child(1)')?.textContent.trim(),
                    dest: el.querySelector('.data_box h3 > span:nth-child(2)')?.textContent.trim(),
                    gen: parseBox(genBox),
                    spec: parseBox(specBox),
                });
            });
            return out;
        }"""
    )

    rows: List[Dict[str, Any]] = []
    for i, item in enumerate(raw or []):
        text = item.get("text", "")
        t = _parse_depart_time(text)
        if not t:
            continue
        name_m = re.search(r"(KTX[-\w]*|SRT|새마을[\w]*|무궁화[\w]*|ITX[-\w]*|누리로|청룡)", text)
        train_name = name_m.group(1) if name_m else ""

        rows.append({
            "_row_index": item["index"],
            "depart_raw": text,
            "depart": t.strftime("%H:%M"),
            "depart_time": t,
            "train_name": train_name,
            "origin": item.get("origin"),
            "dest": item.get("dest"),
            "gen": item.get("gen"),    # {cls, text, sold_out, imminent, has_price} or None
            "spec": item.get("spec"),  # same or None
            # 호환: 구 filter 코드가 사용하는 string status (status_window 검사용)
            "general_status": (item.get("gen") or {}).get("text", ""),
            "first_status": (item.get("spec") or {}).get("text", ""),
        })
    return rows



def navigate_to_search(client: KorailSPAClient) -> Page:
    page = client.main_page()
    safe_goto(page, S.SEARCH_URL, timeout_ms=30_000)
    try:
        page.wait_for_load_state("networkidle", timeout=12_000)
    except PWTimeoutError:
        LOGGER.debug("networkidle timeout — 계속")
    try:
        page.wait_for_selector(S.SEARCH_FORM_DETECT, timeout=10_000)
    except PWTimeoutError:
        raise SiteLayoutChanged("검색 폼 selector 미감지")
    # 진입 직후 매크로 안내 모달 있으면 dismiss
    _check_guard(page, "search form")
    # 운영기간성 공지 모달은 React 비동기 mount — 최대 4초 polling.
    for _ in range(8):
        if dismiss_notice_modal(page):
            break
        try:
            page.wait_for_timeout(500)
        except Exception:
            break
    return page



def _set_srt_option(page: Page, config: KTXAConfig) -> None:
    """검색 폼의 '서울·용산 - 수서 함께 보기' 라디오를 config 에 맞춰 Y/N 으로 둔다.

    2026-11-03: 사이트에서 SRT 가 KTX 탭에 통합되며 'SRT 함께 보기' 는 사라졌고,
    수서 발착(SRT) 열차는 이 옵션으로 포함된다. SPA 가 폼 값을 세션 내 유지하므로
    include_srt=false 일 때도 N 을 명시해야 이전 조회의 Y 가 남지 않는다.
    라디오가 든 옵션 영역(.selectAreaWrap.inline)이 display:none 이라
    Playwright click 이 불가 → JS click (hidden 이어도 change 이벤트 발생, React 반영 확인됨).
    """
    want = bool(config.ktxa_include_srt)
    sel = S.SRT_RADIO_Y if want else S.SRT_RADIO_N
    try:
        state = page.evaluate(
            """(sel) => {
                const r = document.querySelector(sel);
                if (!r) return 'missing';
                if (r.checked) return 'already';
                r.click();
                return r.checked ? 'set' : 'FAIL';
            }""",
            sel,
        )
    except Exception as e:
        LOGGER.warning("수서(SRT) 함께 보기 설정 실패 (계속 진행): %s", e)
        return
    if state in ("missing", "FAIL"):
        LOGGER.warning("수서(SRT) 함께 보기 라디오 적용 실패: %s — site layout 변경 가능", state)
    else:
        LOGGER.info("수서(SRT) 함께 보기 %s (%s)", "ON" if want else "OFF", state)



def _ensure_srt_on_result(page: Page, config: KTXAConfig) -> bool:
    """결과 페이지(search/list)의 '수서 함께 보기' 체크박스를 config 에 맞춘다 (클릭 시 자동 재조회)."""
    want = bool(config.ktxa_include_srt)
    try:
        cb = page.locator(S.SRT_RESULT_CHECKBOX).first
        if cb.count() == 0:
            raise SiteLayoutChanged("결과 페이지 수서(SRT) 선택 요소 미발견")
        if cb.is_checked() == want:
            return False
        try:
            page.locator(S.SRT_RESULT_CHECKBOX_LABEL).first.click(timeout=3000)
        except Exception:
            page.evaluate("(sel) => document.querySelector(sel)?.click()", S.SRT_RESULT_CHECKBOX)
        human_pause(1.5, 2.5)
        if cb.is_checked() != want:
            raise QueryConditionMismatch("결과 페이지 수서(SRT) 옵션 적용 검증 실패")
        LOGGER.info("결과 페이지 수서(SRT) 함께 보기 %s", "재활성화" if want else "해제")
        return True
    except Exception as e:
        raise SiteLayoutChanged(f"결과 페이지 수서(SRT) 체크 확인 실패: {e}") from e



def _search_start_hour(config: KTXAConfig) -> int:
    if config.ktxa_time_window:
        return config.ktxa_time_window[0].hour
    if not config.ktxa_times:
        return 0
    first = min(t.hour * 60 + t.minute for t in config.ktxa_times)
    return max(0, first - max(config.ktxa_tolerance_min, 0)) // 60



def _query_signature(config: KTXAConfig) -> tuple:
    return (config.ktxa_origin, config.ktxa_dest, config.ktxa_date,
            _search_start_hour(config), tuple(sorted(config.passenger_counts().items())),
            config.ktxa_include_srt, config.ktxa_train_type)



def _query_state(page: Page) -> dict:
    state = read_page_state(page, inputs={
        "origin": S.ORIGIN_INPUT, "dest": S.DEST_INPUT, "date": S.DATE_INPUT,
        "result_passengers": S.RESULT_PEOPLE_INPUT,
    }, texts={"passengers": S.PEOPLE_BTN}, include_text=False)
    return {**state["inputs"], **state["texts"],
            "passengers": state["inputs"].get("result_passengers") or state["texts"]["passengers"]}



def _condition_errors(state: dict, config: KTXAConfig) -> list[str]:
    errors = []
    for key, expected in (("origin", config.ktxa_origin), ("dest", config.ktxa_dest)):
        if (state.get(key) or "").strip() != expected.strip():
            errors.append(f"{key}: 화면={state.get(key)!r}, 요청={expected!r}")
    value = state.get("date") or ""
    if not value.startswith(config.ktxa_date.isoformat()):
        errors.append(f"date: 화면={value!r}, 요청={config.ktxa_date.isoformat()}")
    parsed = _parse_depart_time(value)
    if parsed != Time(_search_start_hour(config), 0):
        errors.append(f"hour: 화면={value!r}, 요청={_search_start_hour(config):02d}:00")
    count = re.search(r"(\d+)\s*명", state.get("passengers") or "")
    expected_count = sum(config.passenger_counts().values())
    if count is None or int(count[1]) != expected_count:
        errors.append(f"passengers: 화면={state.get('passengers')!r}, 요청={expected_count}명")
    return errors



def validate_query(page: Page, config: KTXAConfig, stage: str) -> None:
    state = _query_state(page)
    errors = _condition_errors(state, config)
    if errors:
        raise QueryConditionMismatch(f"{stage}: " + "; ".join(errors))
    LOGGER.info("조회 조건 검증 OK (%s): %s", stage, state)



def fill_search_form(page: Page, config: KTXAConfig) -> None:
    hour = _search_start_hour(config)
    for slot, station in (("origin", config.ktxa_origin), ("dest", config.ktxa_dest)):
        _select_station(page, slot, station)
        human_pause(1.0, 2.0)
    _set_date(page, config.ktxa_date, hour=hour)
    human_pause(1.0, 2.0)
    _set_passengers(page, config)
    human_pause(0.8, 1.4)



def _check_guard(page: Page, stage: str) -> bool:
    """Detect evidence independently of whether clicking confirm succeeds."""
    pending = getattr(page.context, "_pending_guard_notices", [])
    page.context._pending_guard_notices = []
    notice = inspect_guard_notice(page)
    if notice is not None:
        record_guard(page, notice, stage)
        if not dismiss_macro_notice(page, notice=notice):
            raise GuardBlocked(
                f"{stage}: {notice['code']} {notice['message']} (dismiss failed)",
                explicit=True,
            )
    return bool(notice or pending)



def _read_rows(page: Page) -> List[Dict[str, Any]]:
    try:
        return _parse_result_rows(page)
    except Exception as exc:
        raise SiteLayoutChanged(f"Result DOM parse failed: {exc}") from exc



def _await_result(
    page: Page, *, stage: str, timeout_ms: int = 10_000,
) -> tuple[Optional[str], bool]:
    """렌더 대기 뒤 행이 아니면 가드 분류까지. (state, guard_found).

    대기 중 뒤늦게 뜬 차단 안내는 여기서 기록·닫기까지 한다 — 안 그러면 0행만 보고
    '안내 없는 빈 목록' 으로 잘못 보고한다 (Codex 교차 검토 2026-11-06 지적).
    """
    state = _wait_result_list(page, where=stage, timeout_ms=timeout_ms)
    if state == "rows":
        return state, False
    return state, _check_guard(page, stage)



def _reload_result_page(page: Page, *, where: str) -> None:
    """Wait for the new document and result UI, without relying on load events."""
    try:
        page.reload(wait_until="commit", timeout=20_000)
    except PWTimeoutError as exc:
        # A navigation that never commits can leave the old rows in the DOM.
        # Do not read them as the response to this re-query.
        raise SearchResultUnavailable(
            "코레일 결과 화면의 새로고침 응답이 늦어 조회를 완료하지 못했습니다. 잠시 후 다시 조회해 주세요."
        ) from exc
    # Commit precedes React rendering. Wait before checking guards/conditions;
    # callers still classify late guards and empty lists within their retry budget.
    _wait_result_list(page, where=f"{where}/reload")


def _requery_after_guard(
    page: Page, *, config: KTXAConfig | None, where: str, attempts: int = 2,
) -> List[Dict[str, Any]]:
    """Bounded retry with unchanged query conditions; never assume a one-time guard."""
    global _REQUERY_COUNT
    for attempt in range(1, attempts + 1):
        if config is not None:
            validate_query(page, config, "before guard retry")
        LOGGER.warning("Guard retry (%s) %d/%d", where, attempt, attempts)
        human_pause(1.0, 2.0)
        button = page.locator(S.RESULT_SEARCH_SUBMIT).filter(visible=True).first
        if button.is_visible():
            human_click(button)
            try:
                page.wait_for_load_state("networkidle", timeout=12_000)
            except PWTimeoutError:
                pass
        else:
            # The compact result header hides its query button. Reload preserves
            # the selected day; never click the separate next-day query control.
            _reload_result_page(page, where=f"{where}/retry-{attempt}")
        _REQUERY_COUNT += 1
        human_pause(1.5, 2.5)
        if _check_guard(page, f"{where}/retry-{attempt}"):
            if attempt == attempts:
                raise GuardBlocked(f"Repeated explicit guard ({where}, {attempt} retries)",
                                   explicit=True)
            continue
        if config is not None:
            validate_query(page, config, "after guard retry")
        _state, late_guard = _await_result(page, stage=f"{where}/retry-{attempt}")
        if late_guard:
            # 대기 중 뜬 차단 안내 — 위의 즉시 감지와 같은 규칙으로 센다
            if attempt == attempts:
                raise GuardBlocked(f"Repeated explicit guard ({where}, {attempt} retries, late)",
                                   explicit=True)
            continue
        rows = _read_rows(page)
        if rows:
            LOGGER.info("Retry returned %d rows with the same conditions", len(rows))
            return rows
        if attempt < attempts:
            # 안내도 마커도 없는 0행 — 렌더 지연일 수 있어 같은 조건으로 한 번 더 (refresh)
            LOGGER.warning("Guard retry (%s) %d/%d: 목록 0행(새 안내 없음) — 재조회 1회 더",
                           where, attempt, attempts)
            continue
        raise SearchResultUnavailable(
            "Guard dismissed, but result list is empty without a new explicit notice")
    raise GuardBlocked(f"Explicit guard persists ({where})", explicit=True)



def submit_search(page: Page, config: KTXAConfig | None = None) -> List[Dict[str, Any]]:
    """Submit once; preserve guard evidence and validate the requested conditions."""
    if config is not None:
        validate_query(page, config, "before submit")
    human_pause(3.0, 6.0)
    human_click(page.locator(S.SEARCH_SUBMIT).first)
    try:
        page.wait_for_url(S.RESULT_URL_PATTERN, timeout=15_000)
    except PWTimeoutError:
        if _check_guard(page, "submit/navigation"):
            return _requery_after_guard(page, config=config, where="submit/navigation")
        raise SiteLayoutChanged(f"Search did not reach results: {page.url}")
    try:
        page.wait_for_load_state("networkidle", timeout=15_000)
    except PWTimeoutError:
        pass
    human_pause(1.5, 2.5)
    if _check_guard(page, "submit"):
        return _requery_after_guard(page, config=config, where="submit")
    if config is not None:
        validate_query(page, config, "after submit")
    _state, late_guard = _await_result(page, stage="submit/wait")
    if late_guard:
        return _requery_after_guard(page, config=config, where="submit/wait")
    return _read_rows(page)



def _empty_marker_visible(page: Page) -> bool:
    """'해당 스케줄에 운행하는 열차가 없습니다' 마커가 실제로 떠 있는지."""
    try:
        return page.locator(S.RESULT_EMPTY_MARKER).first.is_visible(timeout=1500)
    except Exception:
        pass
    try:
        return S.RESULT_EMPTY_TEXT in page.locator("body").inner_text(timeout=2000)
    except Exception:
        return False



def _requery_when_empty(
    page: Page, config: KTXAConfig, *, where: str,
) -> List[Dict[str, Any]]:
    """목록이 비었는데 차단 안내도 '열차 없음' 마커도 없을 때 — 같은 조건으로 새로고침 1회.

    -8002 뒤의 _requery_after_guard 와 같은 원리(초기 응답이 비면 refresh 로 정상 목록).
    조건은 바꾸지 않는다. 새로고침 후 차단 안내가 뜨면 가드 재조회 경로로 넘긴다.
    """
    global _REQUERY_COUNT
    validate_query(page, config, f"before empty retry ({where})")
    LOGGER.warning("결과 목록 0행 (%s) — 차단 안내·열차 없음 마커 없음, 새로고침 1회 재조회", where)
    human_pause(1.0, 2.0)
    _reload_result_page(page, where=f"{where}/empty-retry")
    _REQUERY_COUNT += 1
    human_pause(1.5, 2.5)
    if _check_guard(page, f"{where}/empty-retry"):
        return _requery_after_guard(page, config=config, where=f"{where}/empty-retry")
    validate_query(page, config, f"after empty retry ({where})")
    _state, late_guard = _await_result(page, stage=f"{where}/empty-retry")
    if late_guard:
        return _requery_after_guard(page, config=config, where=f"{where}/empty-retry")
    rows = _read_rows(page)
    if rows:
        LOGGER.info("새로고침 재조회로 %d행 수신 (%s)", len(rows), where)
    return rows



def _settle_rows(
    page: Page, config: KTXAConfig, raw: List[Dict[str, Any]], *, where: str,
    budget: Optional[Dict[str, int]] = None, timeout_ms: int = 10_000,
) -> List[Dict[str, Any]]:
    """0행이면 렌더 완료를 기다려 다시 읽고, 그래도 비면(마커 없음) 새로고침으로 재조회.

    budget={"refresh": n} 은 perform_search 한 번당 새로고침 재조회 예산 (호출당이 아님).
    """
    if raw:
        return raw
    state, guard = _await_result(page, stage=where, timeout_ms=timeout_ms)
    if guard:
        return _requery_after_guard(page, config=config, where=where)
    if state == "modal":
        # 차단 안내가 아닌 공지 모달 — 닫고 한 번 더 기다린다 (그 사이 가드가 뜨면 분류)
        dismiss_notice_modal(page)
        _state2, guard2 = _await_result(page, stage=f"{where}/after modal", timeout_ms=timeout_ms)
        if guard2:
            return _requery_after_guard(page, config=config, where=f"{where}/after modal")
    raw = _read_rows(page)
    if raw or _empty_marker_visible(page):
        return raw
    if budget is not None:
        if budget.get("refresh", 0) <= 0:
            LOGGER.warning("결과 목록 0행 (%s) — 이번 조회의 새로고침 예산 소진, 재조회 생략", where)
            return raw
        budget["refresh"] -= 1
    return _requery_when_empty(page, config, where=where)



def _route_matches(row: dict, config: KTXAConfig) -> bool:
    """Adjacent stations are not interchangeable with the requested journey."""
    for key, requested in (("origin", config.ktxa_origin), ("dest", config.ktxa_dest)):
        actual = row.get(key)
        if actual == requested:
            continue
        if config.ktxa_include_srt and requested in ("서울", "용산") and actual == "수서":
            continue
        return False
    return True


# ── 결과 목록 렌더 대기 — binjari _wait_result_list 와 같은 판정, 폴링만 간격식 ──────────
# 사용자가 조회 창을 가리거나 최소화하면 requestAnimationFrame 이 멈출 수 있다. Playwright 의 기본
# polling='raf' 대신 간격 폴링으로 행·'열차 없음' 마커·보이는 모달 중 먼저 뜨는 것을 본다.
_RESULT_READY_JS = """({rows, empty, modal}) => {
    const visible = el => el.getClientRects().length > 0 &&
        getComputedStyle(el).visibility !== 'hidden';
    if ([...document.querySelectorAll(modal)].some(visible)) return 'modal';
    if (document.querySelectorAll(rows).length > 0) return 'rows';
    if ([...document.querySelectorAll(empty)].some(visible)) return 'empty';
    return null;
}"""
_RESULT_READY_STATES = ("rows", "empty", "modal")


def _wait_result_list(page: Page, *, where: str, timeout_ms: int = 10_000) -> Optional[str]:
    """결과 목록이 실제로 렌더될 때까지 대기. 'rows' | 'empty' | 'modal' | None(시간 초과)."""
    try:
        state = page.wait_for_function(
            _RESULT_READY_JS,
            arg={"rows": "li.tckList", "empty": S.RESULT_EMPTY_MARKER,
                 "modal": ".ReactModal__Content, [role=dialog]"},
            timeout=timeout_ms, polling=250,
        ).json_value()
    except PWTimeoutError:
        state = None
    except Exception as e:
        LOGGER.warning("결과 목록 대기 실패 (%s): %s: %s", where, type(e).__name__, e)
        raise
    if state not in _RESULT_READY_STATES:
        state = None
    if state != "rows":
        LOGGER.warning("결과 목록 대기 (%s): %s", where,
                       state or f"{timeout_ms // 1000}s 내 행 미렌더")
    return state


def perform_query(client: KorailSPAClient, config: KTXAConfig) -> List[Dict[str, Any]]:
    """binjari perform_search 의 한 번 조회 부분 — 폼 입력 → 제출(차단 안내는 기록·닫기 뒤 같은 조건으로
    재조회, 최대 2회) → 수서 함께 보기 옵션 → 목록 렌더 대기 → 열차종류 탭.

    워처용인 검증된 결과 페이지 재사용·'더보기'·후보 시각 거르기는 하지 않는다. 첫 결과 페이지의 행을
    그대로 돌려주고 거르기는 실행부(worker.shape_rows)가 한다. '열차 없음' 마커가 보이면 빈 목록이다.
    """
    page = navigate_to_search(client)
    fill_search_form(page, config)
    _set_srt_option(page, config)
    raw = submit_search(page, config)
    srt_changed = _ensure_srt_on_result(page, config)
    if _check_guard(page, "result options"):
        raw = _requery_after_guard(page, config=config, where="result options")
    elif srt_changed:
        raw = _read_rows(page)
    budget = {"refresh": 1}   # 이번 조회 전체에서 빈 목록 새로고침은 1회
    raw = _settle_rows(page, config, raw, where="result list", budget=budget)
    # 열차종류 탭. 탭 뒤 재조회가 끼면 탭이 '전체' 로 돌아가므로 재조회가 있었을 때만 다시 적용(최대 3회).
    for _ in range(3):
        if not raw or not _click_train_type_tab(page, config.ktxa_train_type):
            break
        requeries_before = _REQUERY_COUNT
        if _check_guard(page, "after train type tab"):
            raw = _requery_after_guard(page, config=config, where="after train type tab")
        else:
            raw = _settle_rows(page, config, _read_rows(page), where="after train type tab",
                               budget=budget, timeout_ms=4_000)
        if _REQUERY_COUNT == requeries_before:
            break
        if _ensure_srt_on_result(page, config):
            raw = _settle_rows(page, config, _read_rows(page), where="srt after requery",
                               budget=budget, timeout_ms=4_000)
    else:
        LOGGER.warning("열차종류 탭 재적용 한도(3회) 소진 — 행의 열차종류로 거른다")
    validate_query(page, config, "result conditions")
    if not raw and not _empty_marker_visible(page):
        raise SearchResultUnavailable("조회 결과를 확인하지 못했습니다. 코레일 화면을 확인해 주세요.")
    return raw
