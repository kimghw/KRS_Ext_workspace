"""Reload regressions: load events, result readiness, stale DOM and guard budgets."""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import worker
from ktx_watcher.korail import GuardBlocked, QueryConditionMismatch, SearchResultUnavailable
from ktx_watcher.korail import search

INPUT = {"from": "부산", "to": "서울", "date": "2026-11-12", "hour": 9, "adults": 1}


def result_page():
    page = Mock()
    page.locator.return_value.filter.return_value.first.is_visible.return_value = False
    # The original implementation fails here even when a list has rendered.
    def reload(*, wait_until, timeout):
        if wait_until != "commit":
            raise search.PWTimeoutError("Page.reload: Timeout 20000ms exceeded")
    page.reload.side_effect = reload
    return page


class ReloadTests(unittest.TestCase):
    def test_reload_waits_for_rendered_state_after_commit(self):
        for state in ("rows", "empty", "modal", None):
            with self.subTest(state=state):
                page = result_page()
                with patch.object(search, "_wait_result_list", return_value=state) as ready:
                    search._reload_result_page(page, where="test")
                page.reload.assert_called_once_with(wait_until="commit", timeout=20_000)
                ready.assert_called_once_with(page, where="test/reload")
                page.wait_for_load_state.assert_not_called()

    def test_navigation_timeout_cannot_return_stale_rows(self):
        for retry in ("guard", "empty"):
            with self.subTest(retry=retry):
                page, config = result_page(), worker.query_config(INPUT)
                page.reload.side_effect = search.PWTimeoutError("Page.reload: Timeout 20000ms exceeded")
                with patch.object(search, "validate_query"), patch.object(search, "human_pause"), \
                     patch.object(search, "_read_rows", return_value=[{"stale": True}]) as read, \
                     patch.object(search, "_wait_result_list") as ready:
                    with self.assertRaisesRegex(SearchResultUnavailable, "새로고침 응답이 늦어"):
                        if retry == "guard":
                            search._requery_after_guard(page, config=config, where="test")
                        else:
                            search._requery_when_empty(page, config, where="test")
                read.assert_not_called()
                ready.assert_not_called()
                self.assertEqual(page.reload.call_count, 1)

    def test_closed_page_error_is_not_reported_as_slow_navigation(self):
        page = result_page()
        page.reload.side_effect = RuntimeError("Target closed")
        with self.assertRaisesRegex(RuntimeError, "Target closed"):
            search._reload_result_page(page, where="test")

    def test_both_retry_paths_read_rows_after_ready_and_validate_conditions(self):
        for retry in ("guard", "empty"):
            with self.subTest(retry=retry):
                page, config, rows, events = result_page(), worker.query_config(INPUT), [{"new": True}], []
                with patch.object(search, "_wait_result_list", side_effect=lambda *a, **kw: events.append("ready") or "rows"), \
                     patch.object(search, "validate_query", side_effect=lambda *a: events.append("validate")), \
                     patch.object(search, "human_pause"), patch.object(search, "_check_guard", return_value=False), \
                     patch.object(search, "_await_result", return_value=("rows", False)), \
                     patch.object(search, "_read_rows", side_effect=lambda *a: events.append("read") or rows):
                    if retry == "guard":
                        result = search._requery_after_guard(page, config=config, where="test")
                    else:
                        result = search._requery_when_empty(page, config, where="test")
                self.assertEqual(result, rows)
                self.assertEqual(events, ["validate", "ready", "validate", "read"])
                page.goto.assert_not_called()

    def test_late_guard_after_reload_remains_bounded(self):
        page, config = result_page(), worker.query_config(INPUT)
        with patch.object(search, "_wait_result_list", return_value="modal"), \
             patch.object(search, "validate_query"), patch.object(search, "human_pause"), \
             patch.object(search, "_check_guard", return_value=True), patch.object(search, "_read_rows") as read:
            with self.assertRaises(GuardBlocked):
                search._requery_after_guard(page, config=config, where="test")
        self.assertEqual(page.reload.call_count, 2)
        read.assert_not_called()

    def test_changed_conditions_after_reload_are_rejected(self):
        page, config = result_page(), worker.query_config(INPUT)
        with patch.object(search, "_wait_result_list", return_value="rows"), \
             patch.object(search, "validate_query", side_effect=[None, QueryConditionMismatch("date changed")]), \
             patch.object(search, "human_pause"), patch.object(search, "_check_guard", return_value=False), \
             patch.object(search, "_read_rows") as read:
            with self.assertRaises(QueryConditionMismatch):
                search._requery_when_empty(page, config, where="test")
        read.assert_not_called()

    def test_vendor_updates_keep_reviewed_retry_functions(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("update_vendor", ROOT / "tools/update_vendor.py")
        updater = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(updater)
        override = (ROOT / "overrides/search_retry.py.txt").read_text(encoding="utf-8")
        source = (ROOT / "vendor/ktx_watcher/korail/search.py").read_text(encoding="utf-8")
        names = ("_reload_result_page", "_requery_after_guard", "_requery_when_empty")
        # Even an upstream regression must not overwrite the reviewed functions.
        upstream = "def _requery_after_guard():\n    raise RuntimeError('old reload')\n"
        self.assertEqual(updater.extract(upstream, names, override), updater.extract(source, names))


if __name__ == "__main__":
    unittest.main()
