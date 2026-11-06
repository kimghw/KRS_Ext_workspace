import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import worker
from ktx_watcher.korail import GuardBlocked


class BrowserTests(unittest.TestCase):
    def descriptor(self, profile):
        return {"pid": 123, "exe": str(Path("chrome.exe").resolve()), "port": 45000,
                "browserPath": "/devtools/browser/abc", "portMode": "explicit", "profile": str(profile.resolve())}

    @unittest.skipUnless(sys.platform == "win32", "Windows TCP ownership")
    def test_real_loopback_listener_owner_and_available_port(self):
        port = worker.choose_debug_port()
        self.assertGreater(port, 0)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", port))
            listener.listen()
            self.assertEqual(worker.debug_port_owner(port), os.getpid())
        self.assertIsNone(worker.debug_port_owner(port))

    def test_wrong_socket_owner_rejected_before_any_http_connection(self):
        desc = self.descriptor(Path("profile"))
        with patch.object(worker, "process_executable", return_value=Path(desc["exe"])), \
             patch.object(worker, "debug_port_owner", return_value=999), patch.object(worker, "build_opener") as opener:
            with self.assertRaises(worker.WorkerError):
                worker.browser_endpoint(desc)
        opener.assert_not_called()

    def test_explicit_port_uses_socket_owner_and_browser_guid_without_port_file(self):
        with tempfile.TemporaryDirectory() as folder:
            profile = Path(folder)
            desc = self.descriptor(profile)
            endpoint = "ws://127.0.0.1:45000/devtools/browser/abc"
            response = Mock()
            response.read.return_value = json.dumps({"webSocketDebuggerUrl": endpoint}).encode()
            opener = Mock()
            opener.open.return_value.__enter__ = Mock(return_value=response)
            opener.open.return_value.__exit__ = Mock(return_value=False)
            with patch.object(worker, "process_executable", return_value=Path(desc["exe"])), \
                 patch.object(worker, "debug_port_owner", return_value=123), \
                 patch.object(worker, "build_opener", return_value=opener):
                self.assertEqual(worker.verify_browser(desc, profile), endpoint)
                for changed in ({**desc, "browserPath": "/devtools/browser/other"},
                                {**desc, "profile": str(profile / "other")}):
                    with self.assertRaises(worker.WorkerError):
                        worker.verify_browser(changed, profile)
            self.assertFalse((profile / "DevToolsActivePort").exists())

    def test_pending_launch_record_reconnects_only_after_ownership_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = worker.state_path(folder)
            desc = self.descriptor(root / "profile")
            desc.pop("browserPath")
            worker.save_browser(root, desc)
            endpoint = "ws://127.0.0.1:45000/devtools/browser/abc"
            with patch.object(worker, "browser_endpoint", return_value=endpoint):
                recovered, actual = worker.running_browser(root)
            self.assertEqual(actual, endpoint)
            self.assertEqual(recovered["browserPath"], "/devtools/browser/abc")
            self.assertEqual(json.loads((root / "browser.json").read_text(encoding="utf-8")), recovered)
            worker.save_browser(root, desc)
            with patch.object(worker, "browser_endpoint", side_effect=worker.WorkerError("gone", "SESSION_CLOSED")):
                self.assertEqual(worker.running_browser(root), (None, None))

    def test_launch_passes_concrete_port_and_records_its_own_process(self):
        with tempfile.TemporaryDirectory() as folder:
            root = worker.state_path(folder)
            executable = Path("chrome.exe").resolve()
            process = Mock(pid=123)
            process.poll.return_value = None
            with patch.object(worker, "running_browser", return_value=(None, None)), \
                 patch.object(worker, "find_chrome", return_value=executable), \
                 patch.object(worker, "choose_debug_port", return_value=45000), \
                 patch.object(worker.subprocess, "Popen", return_value=process) as launch, \
                 patch.object(worker, "browser_endpoint", return_value="ws://127.0.0.1:45000/devtools/browser/abc"):
                desc, _, launched = worker.start_browser(root)
            self.assertTrue(launched)
            self.assertIn("--remote-debugging-port=45000", launch.call_args.args[0])
            self.assertNotIn("--remote-debugging-port=0", launch.call_args.args[0])
            self.assertEqual(desc["pid"], process.pid)
            self.assertEqual(desc["profile"], str((root / "profile").resolve()))
            self.assertEqual(desc["portMode"], "explicit")

    def test_unresponsive_live_browser_does_not_get_relaunched_or_lose_its_record(self):
        with tempfile.TemporaryDirectory() as folder:
            root = worker.state_path(folder)
            desc = self.descriptor(root / "profile")
            worker.save_browser(root, desc)
            with patch.object(worker, "verify_browser", side_effect=TimeoutError("busy")), \
                 patch.object(worker, "process_executable", return_value=Path(desc["exe"])), \
                 patch.object(worker.subprocess, "Popen") as launch:
                with self.assertRaises(worker.WorkerError) as caught:
                    worker.start_browser(root)
            self.assertEqual(caught.exception.code, "CHROME_NOT_READY")
            launch.assert_not_called()
            self.assertEqual(json.loads((root / "browser.json").read_text(encoding="utf-8")), desc)

    def test_live_legacy_browser_requires_user_restart_without_closing_it(self):
        with patch.object(worker, "running_browser", return_value=({"pid": 123}, "ws://legacy")), \
             patch.object(worker.subprocess, "Popen") as launch:
            with self.assertRaises(worker.WorkerError) as caught:
                worker.start_browser(Path("profile"))
        self.assertEqual(caught.exception.code, "CHROME_RESTART_REQUIRED")
        launch.assert_not_called()

    def test_final_guard_failure_preserves_site_code_and_message(self):
        page, client = Mock(), Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.main_page.return_value = page
        page._guard_events = [{"code": "-8001", "message": "완전히 종료한 후 다시 실행"}]
        with patch("ktx_watcher.korail.client.KorailSPAClient", return_value=client), \
             patch.object(worker, "start_browser", return_value=({}, "ws://test", True)), \
             patch.object(worker, "target_id", return_value="tab"), patch.object(worker, "save_session"), \
             patch.object(worker, "capture_failure"), \
             patch("ktx_watcher.korail.search.perform_query", side_effect=GuardBlocked("Repeated explicit guard")):
            result = worker.run_search(Path("profile"), {"from": "부산", "to": "서울", "date": "2026-11-08", "hour": 9, "adults": 1})
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "GUARD_BLOCKED")
        self.assertIn("-8001", result["error"])
        self.assertIn("완전히 종료", result["error"])


if __name__ == "__main__":
    unittest.main()
