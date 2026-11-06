"""Query-only CDP client. binjari's popup guard, pacing and guard-notice handling; no environment loading or login."""
from __future__ import annotations
import logging
import random
import re
import time
from contextlib import AbstractContextManager
from typing import Optional
from ..browser import Browser, BrowserContext, Page, Playwright, TimeoutError as PWTimeoutError, sync_playwright
from ..dom import first_visible, read_page_state
from ..diagnostics import record_guard
from . import selectors as S

LOGGER = logging.getLogger(__name__)
# Retain upstream pacing, without reading per-user environment files.
HUMANIZE = True
# Generic headings such as '안내 메시지' are also used for ordinary notices.
_GUARD_KEYWORDS = ("미허가", "개발자도구", "비정상적인 접속")
# Keep known site rejection codes intact, including the restart and network notices.
_GUARD_CODE_RE = re.compile(r"(?<!\d)(?:-800[123]|-8202)(?!\d)")
_INFO_KEYWORDS = S.MACRO_NOTICE_KEYWORDS + (
    "안내",
    "이용안내",
    "확인하시고",
    "선택하신",
    "예매",
    "본인인증",
    "약관",
)
# "계속 진행하시겠습니까?" 류 진행 확인 모달 (아니오/네) → '네' 클릭으로 통과.
_PROCEED_KEYWORDS = ("진행하시겠습니까",)


def _guard_notice_from_state(state: dict) -> Optional[dict[str, str]]:
    """Reviewed bridge override: preserve all observed guard codes, not ordinary notices."""
    for text in state["modals"] or [state["body"]]:
        code = _GUARD_CODE_RE.search(text)
        positions = [text.find(kw) for kw in _GUARD_KEYWORDS if kw in text]
        if code is not None:
            positions.append(code.start())
        if not positions:
            continue
        start = max(0, min(positions) - 100) if len(text) > 1200 else 0
        return {
            "message": text[start:start + 1200].strip(),
            "code": code.group(0) if code else "",
        }
    return None


class KorailSPAClient(AbstractContextManager):
    """Connects to the dedicated Chrome over CDP. binjari's context popup guard is attached on connect."""
    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self._pw = None
        self._browser = None
        self._main_page = None

    def __enter__(self):
        self._pw = sync_playwright().start()
        try:
            self._browser = self._pw.chromium.connect_over_cdp(self.endpoint, timeout=15000)
            attach_context_popup_guard(self.context)
            return self
        except Exception:
            self._pw.stop()
            self._pw = None
            raise

    def __exit__(self, *args):
        # Disconnect only: the result window remains available for manual booking.
        if self._pw is not None:
            self._pw.stop()
            self._pw = None

    @property
    def context(self):
        if not self._browser or not self._browser.contexts:
            raise RuntimeError("Chrome context is unavailable")
        return self._browser.contexts[0]

    def main_page(self):
        """Reuse a blank tab of the shared window; a tab with content (an earlier result, a booking) is left alone."""
        if self._main_page is None:
            page = None
            for candidate in self.context.pages:
                try:
                    url = candidate.url or ""
                except Exception:
                    continue
                if url == "" or url.startswith("about:blank"):
                    page = candidate
                    break
            if page is None:
                page = self.context.new_page()
            page.set_default_timeout(8000)
            self._main_page = page
        return self._main_page


def human_pause(min_s: float = 0.5, max_s: float = 1.2) -> None:
    if HUMANIZE:
        # 사용자 지시(2026-05-14): 0.5s 최소 + 랜덤 텀
        lo = max(min_s, 0.5)
        hi = max(max_s, lo + 0.5)
        time.sleep(random.uniform(lo, hi))



def human_click(loc) -> None:
    """Send only the actual click; retain pauses between user actions."""
    loc.click()
    if HUMANIZE:
        time.sleep(0.5 + random.uniform(0.0, 1.0))



def human_type(loc, text: str) -> None:
    """Fill once instead of issuing keyboard commands for every character."""
    loc.fill(text)
    if HUMANIZE:
        time.sleep(random.uniform(0.25, 0.5))



def _click_visible(page: Page, selector: str, timeout: int = 2000) -> bool:
    button = first_visible(page, selector)
    if not button.is_visible():
        return False
    button.click(timeout=timeout)
    return True



def safe_goto(page: Page, url: str, timeout_ms: int = 30_000) -> None:
    try:
        page.goto(url, wait_until="load", timeout=timeout_ms)
    except PWTimeoutError as e:
        from . import SiteLayoutChanged
        raise SiteLayoutChanged(f"goto timeout: {url}") from e



def inspect_guard_notice(page: Page) -> Optional[dict[str, str]]:
    """Read current guard evidence without clicking or hiding read failures.

    Prefer visible dialogs; a standalone popup may contain the notice in body.
    The bounded message is suitable for a diagnostic artifact, not a full DOM dump.
    """
    return _guard_notice_from_state(read_page_state(page))



def dismiss_macro_notice(page: Page, *, notice: Optional[dict[str, str]] = None) -> bool:
    """Return click success only; callers use inspect_guard_notice for detection."""
    try:
        if notice is None and inspect_guard_notice(page) is None:
            return False
        clicked = _click_visible(page, S.MODAL_CONFIRM_BUTTON)
        if clicked:
            human_pause(0.8, 1.4)
        return clicked
    except Exception:
        return False



def dismiss_notice_modal(page: Page) -> bool:
    try:
        state = read_page_state(page)
        if not any(kw in state["body"] for kw in S.NOTICE_MODAL_KEYWORDS):
            return False
    except Exception:
        return False
    # Hiding a notice for the day is optional; a failed checkbox must not
    # prevent closing the overlay and leave the search form obstructed.
    try:
        _click_visible(page, S.NOTICE_MODAL_HIDE_TODAY_CHECKBOX, timeout=1500)
    except Exception:
        LOGGER.debug("Notice hide-today checkbox unavailable; closing the notice")
    try:
        clicked = _click_visible(page, S.NOTICE_MODAL_DISMISS_BUTTON)
        if clicked:
            human_pause(0.6, 1.0)
        return clicked
    except Exception:
        return False



def _click_proceed_if_asked(pg: Page, txt: str) -> bool:
    """모달 텍스트가 진행 확인형이면 '네' 클릭. 성공 시 True."""
    if not any(kw in txt for kw in _PROCEED_KEYWORDS):
        return False
    try:
        if _click_visible(pg, S.MODAL_PROCEED_BUTTON):
            human_pause(0.5, 0.9)
            return True
    except Exception as e:
        LOGGER.debug("Proceed confirmation failed: %s", e)
    return False



def attach_context_popup_guard(context) -> None:
    """context.on('page') 로 모든 새 page (popup 포함) 자동 dismiss.

    page-level on('popup') 보다 광범위. 어디서 popup 이 생기든 잡음.
    """
    if getattr(context, "_popup_guard_attached", False):
        return

    def _on_page(new_page: Page) -> None:
        # A tab created by the client is not an advertising popup.
        if new_page.opener() is None:
            return
        try:
            new_page.wait_for_load_state("domcontentloaded", timeout=3000)
        except Exception:
            pass
        try:
            state = read_page_state(new_page)
            body = state["body"]
        except Exception:
            state = {"body": "", "modals": []}
            body = ""
        notice = _guard_notice_from_state(state)
        if notice is not None:
            # Keep detection independent of subsequent confirm click success.
            pending = getattr(context, "_pending_guard_notices", [])
            context._pending_guard_notices = (pending + [notice])[-20:]
            event = record_guard(new_page, notice, "popup")
            events = getattr(context, "_guard_events", [])
            context._guard_events = (events + [event])[-20:]
        if not any(kw in body for kw in _INFO_KEYWORDS):
            # 광고/외부 popup — close
            try:
                if "korail" not in (new_page.url or "") and not new_page.is_closed():
                    LOGGER.info("외부/광고 popup close: %s", new_page.url)
                    new_page.close()
            except Exception:
                pass
            return

        # 안내성 popup → 진행 확인형이면 '네', 아니면 '확인' 클릭
        LOGGER.info("새 popup 감지 (안내성) → 확인 클릭: %s body=%r", new_page.url, body[:60])
        if _click_proceed_if_asked(new_page, body):
            return
        try:
            time.sleep(random.uniform(0.5, 1.0))
            _click_visible(new_page, S.MODAL_CONFIRM_BUTTON, timeout=3000)
        except Exception as e:
            LOGGER.debug("popup 확인 클릭 실패: %s", e)

    context.on("page", _on_page)
    context._popup_guard_attached = True  # type: ignore[attr-defined]
    LOGGER.info("context popup guard 부착 (context.on('page'))")

