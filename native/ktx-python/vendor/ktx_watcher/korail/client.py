"""Query-only CDP client. No environment loading, login, popup confirmation or tab reuse."""
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
from . import GuardBlocked
from . import selectors as S

LOGGER = logging.getLogger(__name__)
# Retain upstream pacing, without reading per-user environment files.
HUMANIZE = True

class KorailSPAClient(AbstractContextManager):
    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self._pw = None
        self._browser = None
        self._main_page = None

    def __enter__(self):
        self._pw = sync_playwright().start()
        try:
            self._browser = self._pw.chromium.connect_over_cdp(self.endpoint, timeout=15000)
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
        if self._main_page is None:
            self._main_page = self.context.new_page()
            self._main_page.set_default_timeout(8000)
        return self._main_page

def _guard_notice_from_state(state):
    # Explicit codes cover macro, network and other site rejections. Never infer a
    # block merely because no rows were returned.
    for text in state.get("modals") or [state.get("body", "")]:
        code = re.search(r"(?:CODE\s*:\s*)(-\d+)", text, re.I)
        known = re.search(r"-800[23](?!\d)", text)
        keywords = ("미허가", "개발자도구", "비정상적인 접속", "데이터센터", "VPN")
        if code or known or any(word in text for word in keywords):
            return {"message": text[:1200].strip(), "code": (code.group(1) if code else known.group(0) if known else "")}
    return None

def dismiss_notice_modal(page):
    # Close only ordinary notices. Guard notices remain visible for the user.
    notice = inspect_guard_notice(page)
    if notice:
        record_guard(page, notice, "notice")
        raise GuardBlocked(notice["message"], code=notice["code"] or "GUARD_BLOCKED")
    state = read_page_state(page)
    if not any(word in state["body"] for word in S.NOTICE_MODAL_KEYWORDS):
        return False
    try:
        return _click_visible(page, S.NOTICE_MODAL_DISMISS_BUTTON)
    except Exception:
        return False


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



def safe_goto(page: Page, url: str, timeout_ms: int = 30_000) -> None:
    try:
        page.goto(url, wait_until="load", timeout=timeout_ms)
    except PWTimeoutError as e:
        from . import SiteLayoutChanged
        raise SiteLayoutChanged(f"goto timeout: {url}") from e



def _click_visible(page: Page, selector: str, timeout: int = 2000) -> bool:
    button = first_visible(page, selector)
    if not button.is_visible():
        return False
    button.click(timeout=timeout)
    return True



def inspect_guard_notice(page: Page) -> Optional[dict[str, str]]:
    """Read current guard evidence without clicking or hiding read failures.

    Prefer visible dialogs; a standalone popup may contain the notice in body.
    The bounded message is suitable for a diagnostic artifact, not a full DOM dump.
    """
    return _guard_notice_from_state(read_page_state(page))

