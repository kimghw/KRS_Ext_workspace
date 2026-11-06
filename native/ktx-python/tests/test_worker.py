import contextlib
from datetime import date
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import worker
from ktx_watcher.korail import GuardBlocked, SiteLayoutChanged
from ktx_watcher.korail import search
from ktx_watcher.korail.client import _guard_notice_from_state

INPUT = {"from": "부산", "to": "서울", "date": "2026-11-12", "hour": 5, "adults": 2}

class WorkerTests(unittest.TestCase):
    def test_input_validation_before_any_browser_action(self):
        self.assertEqual(worker.validate_input(INPUT, date(2026, 11, 6)), INPUT)
        bad = [None, {}, {**INPUT, "from": []}, {**INPUT, "to": "부산"}, {**INPUT, "date": "2026-02-30"},
               {**INPUT, "hour": True}, {**INPUT, "hour": 24}, {**INPUT, "adults": 0},
               {**INPUT, "cdp_url": "http://example.com"}]
        with patch.object(worker, "start_browser") as start:
            for value in bad:
                with self.subTest(value=value), self.assertRaises(worker.WorkerError):
                    worker.validate_input(value, date(2026, 11, 6))
            start.assert_not_called()

    def test_bad_operation_and_session_never_touch_filesystem(self):
        with patch.object(worker, "state_path") as state:
            for request in [{"op": "reserve"}, {"op": "payment"}, {"op": "open", "session": "../profile"}, {"op": "search", "input": {}}]:
                with self.subTest(request=request), self.assertRaises(worker.WorkerError):
                    worker.handle(request)
            state.assert_not_called()

    def test_configuration_has_no_credentials_or_environment_loading(self):
        config = worker.query_config(INPUT)
        self.assertEqual(config.passenger_counts(), {"어른": 2})
        self.assertEqual(config.ktxa_time_window[0].hour, 5)
        self.assertFalse(config.ktxa_include_srt)
        self.assertFalse(hasattr(config, "ktxa_user"))
        self.assertFalse(hasattr(config, "ktxa_payment_mode"))

    def test_shape_rows_filters_route_type_and_time_but_retains_sold_out(self):
        config = worker.query_config(INPUT)
        row = {"train_name": "KTX-산천", "depart_raw": "KTX-산천 211 부산 → 서울(5:40 ~ 8:20)소요시간: 2시간 40분",
               "origin": "부산", "dest": "서울", "gen": {"text": "일반실(매진임박)59,800원", "imminent": True},
               "spec": {"text": "83,700원 매진", "sold_out": True}}
        rows = worker.shape_rows([row, {**row, "origin": "구포"}, {**row, "train_name": "SRT"},
                                  {**row, "depart_raw": "KTX 101(04:00 ~ 07:00)"}], config)
        self.assertEqual(rows, [{"train": "KTX-산천", "no": "211", "dep": "05:40", "arr": "08:20", "took": "2시간 40분",
                                 "gen": {"price": "59,800원", "soldOut": False, "soon": True},
                                 "spec": {"price": "83,700원", "soldOut": True, "soon": False}}])
        self.assertIsNone(worker.shape_seat(None))

    def test_explicit_guard_codes_not_empty_page_are_blocked(self):
        self.assertIsNone(_guard_notice_from_state({"modals": [], "body": "운행하는 열차가 없습니다"}))
        for code in ("-4001", "-8002", "-8003", "-8202"):
            result = _guard_notice_from_state({"modals": [f"안내 메시지 CODE : {code}"], "body": ""})
            self.assertEqual(result["code"], code)

    def test_guard_in_popup_is_preserved_and_stops_before_submit(self):
        page, popup = Mock(), Mock()
        page.context.pages = [page, popup]
        page.is_closed.return_value = popup.is_closed.return_value = False
        notice = {"code": "-8002", "message": "매크로 안내 CODE : -8002"}
        with patch.object(search, "inspect_guard_notice", side_effect=[None, notice]), patch.object(search, "record_guard") as record:
            with self.assertRaises(GuardBlocked) as caught:
                search.submit_search(page, worker.query_config(INPUT))
            self.assertEqual(caught.exception.code, "-8002")
            record.assert_called_once_with(popup, notice, "before submit")
            page.locator.assert_not_called()
            popup.locator.assert_not_called()

    def test_submission_has_one_click_and_never_retries_after_block(self):
        page = Mock()
        page.url = "https://www.korail.com/ticket/search/general"
        page.wait_for_url.side_effect = search.PWTimeoutError("not moved")
        with patch.object(search, "_check_guard", side_effect=[False, GuardBlocked("blocked", code="-8003")]), \
             patch.object(search, "validate_query"), patch.object(search, "human_pause"), patch.object(search, "human_click") as click:
            with self.assertRaises(GuardBlocked):
                search.submit_search(page, worker.query_config(INPUT))
            self.assertEqual(click.call_count, 1)
            page.reload.assert_not_called()
        self.assertFalse(hasattr(search, "_requery_after_guard"))
        self.assertFalse(hasattr(search, "_expand_more_until"))
        self.assertFalse(hasattr(search, "perform_search"))

    def test_success_submission_returns_first_page_without_pagination(self):
        page, rows = Mock(), [{"raw": "one"}]
        with patch.object(search, "_check_guard", return_value=False), patch.object(search, "validate_query"), \
             patch.object(search, "human_pause"), patch.object(search, "human_click") as click, patch.object(search, "_read_rows", return_value=rows):
            self.assertEqual(search.submit_search(page, worker.query_config(INPUT)), rows)
            click.assert_called_once()
            page.reload.assert_not_called()

    def test_devtools_endpoint_is_read_only_from_dedicated_profile(self):
        with tempfile.TemporaryDirectory() as folder:
            profile = Path(folder)
            port = profile / "DevToolsActivePort"
            port.write_text("45000\n/devtools/browser/abc-123\n", encoding="utf-8")
            self.assertEqual(worker.endpoint_from_profile(profile), (45000, "/devtools/browser/abc-123"))
            for bad in ("0\n/devtools/browser/a", "65536\n/devtools/browser/a", "80\nhttps://example.com", "80\n/../../x"):
                port.write_text(bad, encoding="utf-8")
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    worker.endpoint_from_profile(profile)

    def test_ownership_rejection_happens_before_network(self):
        with patch.object(worker, "process_executable", return_value=None), patch.object(worker, "build_opener") as opener:
            with self.assertRaises(worker.WorkerError):
                worker.verify_browser({"pid": 44, "exe": "C:/Chrome/chrome.exe"}, Path("C:/profile"))
            opener.assert_not_called()

    def test_open_foregrounds_only_the_recorded_page(self):
        token = "a" * 32
        client, first, target, cdp = Mock(), Mock(), Mock(), Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.context.pages = [first, target]
        client.context.new_cdp_session.return_value = cdp
        cdp.send.return_value = {"windowId": 42}
        with tempfile.TemporaryDirectory() as folder:
            root = worker.state_path(folder)
            worker.save_session(root, token, {"target": "exact"})
            with patch("ktx_watcher.korail.client.KorailSPAClient", return_value=client), \
                 patch.object(worker, "verify_browser", return_value="ws://127.0.0.1:1234/devtools/browser/a"), \
                 patch.object(worker, "target_id", side_effect=["other", "exact"]):
                self.assertEqual(worker.run_open(root, token), {"ok": True})
        first.bring_to_front.assert_not_called()
        target.bring_to_front.assert_called_once()
        target.goto.assert_not_called()
        target.locator.assert_not_called()
        target.reload.assert_not_called()
        cdp.send.assert_any_call("Browser.setWindowBounds", {"windowId": 42, "bounds": {"windowState": "normal"}})

    def test_cli_check_and_invalid_json_are_single_json_without_browser(self):
        checked = subprocess.run([sys.executable, "-I", str(ROOT / "worker.py"), "--check"], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(checked.returncode, 0, checked.stderr)
        self.assertTrue(json.loads(checked.stdout)["ok"])
        self.assertEqual(len(checked.stdout.splitlines()), 1)
        bad = subprocess.run([sys.executable, "-I", str(ROOT / "worker.py")], input="{broken", capture_output=True, text=True, encoding="utf-8")
        self.assertFalse(json.loads(bad.stdout)["ok"])
        self.assertEqual(len(bad.stdout.splitlines()), 1)

    def test_vendor_provenance_matches_and_has_no_booking_or_environment_modules(self):
        provenance = json.loads((ROOT / "PROVENANCE.json").read_text(encoding="utf-8"))
        for relative, digest in provenance["vendor_sha256"].items():
            actual = hashlib.sha256((ROOT / "vendor/ktx_watcher" / relative).read_bytes()).hexdigest()
            self.assertEqual(actual, digest, relative)
        names = {p.stem for p in (ROOT / "vendor").rglob("*.py")}
        self.assertTrue(names.isdisjoint({"reserve", "payment", "transfer", "main", "web_server"}))
        for path in (ROOT / "vendor").rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("load_dotenv", text)
            self.assertNotIn(".env.ktx", text)

if __name__ == "__main__":
    unittest.main()
