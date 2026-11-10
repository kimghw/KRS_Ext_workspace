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
from ktx_watcher.korail import GuardBlocked, SearchResultUnavailable, SiteLayoutChanged
from ktx_watcher.korail import search
from ktx_watcher.korail.client import _guard_notice_from_state

INPUT = {"from": "부산", "to": "서울", "date": "2026-11-12", "hour": 5, "adults": 2}

def reload_page_mock():
    """Result page whose compact header hides the query button, so a re-query is a reload."""
    page = Mock()
    page.url = "https://www.korail.com/ticket/search/list"
    page.locator.return_value.filter.return_value.first.is_visible.return_value = False
    return page

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
        self.assertEqual(config.ktxa_train_type, "KTX")
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
                                 "gen": {"price": "59,800원", "soldOut": False, "soon": True, "note": ""},
                                 "spec": {"price": "83,700원", "soldOut": True, "soon": False, "note": ""}}])
        self.assertIsNone(worker.shape_seat(None))

    def test_shape_seat_keeps_the_page_words_when_there_is_no_price(self):
        self.assertEqual(worker.shape_seat({"text": " 입석 + 좌석\n 예약대기 "}),
                         {"price": "", "soldOut": False, "soon": False, "note": "입석 + 좌석 예약대기"})
        self.assertEqual(worker.shape_seat({"text": "매진", "sold_out": True})["note"], "")

    def test_guard_notice_detection_matches_binjari(self):
        self.assertIsNone(_guard_notice_from_state({"modals": [], "body": "운행하는 열차가 없습니다"}))
        self.assertIsNone(_guard_notice_from_state({"modals": ["안내 메시지 CODE : -4001"], "body": ""}))
        for code in ("-8002", "-8003"):
            result = _guard_notice_from_state({"modals": [f"매크로, 개발자도구 등 미허가 도구 CODE : {code}"], "body": ""})
            self.assertEqual(result["code"], code)
        self.assertEqual(_guard_notice_from_state({"modals": [], "body": "비정상적인 접속입니다"})["code"], "")

    def test_guard_notice_is_recorded_dismissed_and_requeried_with_same_conditions(self):
        page, rows, config = reload_page_mock(), [{"raw": "one"}], worker.query_config(INPUT)
        page.context._pending_guard_notices = []
        notice = {"code": "-8002", "message": "매크로 안내 CODE : -8002"}
        with patch.object(search, "inspect_guard_notice", return_value=notice), patch.object(search, "record_guard") as record, \
             patch.object(search, "dismiss_macro_notice", return_value=True) as dismiss:
            self.assertTrue(search._check_guard(page, "submit"))
        record.assert_called_once_with(page, notice, "submit")
        dismiss.assert_called_once()
        with patch.object(search, "_check_guard", return_value=False), patch.object(search, "validate_query") as validate, \
             patch.object(search, "human_pause"), patch.object(search, "_await_result", return_value=("rows", False)), \
             patch.object(search, "_read_rows", return_value=rows):
            self.assertEqual(search._requery_after_guard(page, config=config, where="submit"), rows)
        page.reload.assert_called_once()
        page.goto.assert_not_called()
        self.assertEqual([call.args[2] for call in validate.call_args_list], ["before guard retry", "after guard retry"])

    def test_persistent_guard_stops_after_two_requeries(self):
        page, config = reload_page_mock(), worker.query_config(INPUT)
        with patch.object(search, "_check_guard", return_value=True), patch.object(search, "validate_query"), \
             patch.object(search, "human_pause"):
            with self.assertRaises(GuardBlocked) as caught:
                search._requery_after_guard(page, config=config, where="submit")
        self.assertTrue(caught.exception.explicit)
        self.assertEqual(page.reload.call_count, 2)
        page.goto.assert_not_called()

    def test_submit_requeries_only_when_a_guard_notice_was_found(self):
        page, rows, config = Mock(), [{"raw": "one"}], worker.query_config(INPUT)
        with patch.object(search, "_check_guard", return_value=False), patch.object(search, "validate_query"), \
             patch.object(search, "human_pause"), patch.object(search, "human_click") as click, \
             patch.object(search, "_await_result", return_value=("rows", False)), patch.object(search, "_read_rows", return_value=rows):
            self.assertEqual(search.submit_search(page, config), rows)
        click.assert_called_once()
        page.reload.assert_not_called()
        with patch.object(search, "_check_guard", return_value=True), patch.object(search, "validate_query"), \
             patch.object(search, "human_pause"), patch.object(search, "human_click"), \
             patch.object(search, "_requery_after_guard", return_value=rows) as requery:
            self.assertEqual(search.submit_search(page, config), rows)
        self.assertEqual(requery.call_args.kwargs["where"], "submit")

    def test_query_flow_has_binjari_guard_handling_but_no_watcher_loop_or_pagination(self):
        for name in ("perform_query", "_requery_after_guard", "_requery_when_empty", "_settle_rows", "_click_train_type_tab"):
            self.assertTrue(callable(getattr(search, name)), name)
        for name in ("perform_search", "_expand_more_until", "_is_candidate_time"):
            self.assertFalse(hasattr(search, name), name)
        from ktx_watcher.korail import client
        self.assertTrue(callable(client.attach_context_popup_guard))
        self.assertFalse(hasattr(client, "login"))

    def test_perform_query_returns_empty_only_with_no_train_marker(self):
        client, page, config = Mock(), Mock(), worker.query_config(INPUT)
        flow = dict(navigate_to_search=Mock(return_value=page), fill_search_form=Mock(), _set_srt_option=Mock(),
                    submit_search=Mock(return_value=[]), _ensure_srt_on_result=Mock(return_value=False),
                    _check_guard=Mock(return_value=False), _settle_rows=Mock(return_value=[]), validate_query=Mock(),
                    _click_train_type_tab=Mock())
        with patch.multiple(search, **flow), patch.object(search, "_empty_marker_visible", return_value=True):
            self.assertEqual(search.perform_query(client, config), [])
            flow["_click_train_type_tab"].assert_not_called()
        with patch.multiple(search, **flow), patch.object(search, "_empty_marker_visible", return_value=False):
            with self.assertRaises(SearchResultUnavailable):
                search.perform_query(client, config)

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
        with tempfile.TemporaryDirectory() as folder, patch.object(worker, "build_opener") as opener:
            with self.assertRaises(OSError):  # An adopted browser without a pid still needs the profile's own port file.
                worker.verify_browser({"pid": None, "exe": "C:/Chrome/chrome.exe"}, Path(folder))
            opener.assert_not_called()

    def test_live_dedicated_browser_is_reused_without_launch(self):
        desc = {"pid": 7, "exe": "C:/Chrome/chrome.exe", "port": 45000, "browserPath": "/devtools/browser/abc", "portMode": "explicit"}
        with tempfile.TemporaryDirectory() as folder:
            root = worker.state_path(folder)
            worker.save_browser(root, desc)
            with patch.object(worker, "verify_browser", return_value="ws://127.0.0.1:45000/devtools/browser/abc") as verify, \
                 patch.object(subprocess, "Popen") as popen:
                self.assertEqual(worker.start_browser(root), (desc, "ws://127.0.0.1:45000/devtools/browser/abc", False))
            verify.assert_called_once_with(desc, root / "profile")
            popen.assert_not_called()
            self.assertFalse((root / "profiles").exists())

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
        self.assertTrue(names.isdisjoint({"reserve", "payment", "transfer", "main", "web_server", "chrome_launcher"}))
        for path in (ROOT / "vendor").rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("load_dotenv", text)
            self.assertNotIn(".env.ktx", text)

if __name__ == "__main__":
    unittest.main()
