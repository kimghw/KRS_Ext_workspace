from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "vendor"))

from ktx_watcher.korail.client import _guard_notice_from_state
from ktx_watcher.korail import search


class GuardDiagnosticTests(unittest.TestCase):
    def test_observed_site_codes_survive_without_keyword_text(self):
        for code in ("-8001", "-8002", "-8003", "-8202"):
            for in_modal in (False, True):
                message = f"안내 메시지\nCODE : {code}"
                state = {"modals": [message] if in_modal else [],
                         "body": "" if in_modal else message}
                with self.subTest(code=code, in_modal=in_modal):
                    self.assertEqual(_guard_notice_from_state(state),
                                     {"code": code, "message": message})

    def test_normal_notice_and_longer_numeric_codes_are_not_guards(self):
        for message in ("안내 메시지 CODE : -4001", "이용안내", "CODE : -80021",
                        "CODE : -82020", "CODE : -80010", "CODE : -80031"):
            with self.subTest(message=message):
                self.assertIsNone(_guard_notice_from_state({"modals": [message], "body": ""}))

    def test_restart_and_network_messages_keep_their_codes(self):
        for code, message in (
            ("-8001", "매크로, 개발자도구 등 미허가 도구 사용 시 이용이 제한될 수 있습니다.\n"
                       "완전히 종료한 후 다시 실행해 주시기 바랍니다.\nCODE : -8001"),
            ("-8202", "VPN 또는 데이터센터를 통해서는 서비스를 이용할 수 없습니다.\nCODE : -8202"),
        ):
            with self.subTest(code=code):
                notice = _guard_notice_from_state({"modals": [message], "body": ""})
                self.assertEqual(notice["code"], code)
                self.assertEqual(notice["message"], message)

    def test_code_less_explicit_guard_is_still_detected(self):
        message = "비정상적인 접속입니다"
        self.assertEqual(_guard_notice_from_state({"modals": [], "body": message}),
                         {"code": "", "message": message})

    def test_diagnostic_message_remains_bounded_and_uses_visible_dialogs(self):
        message = "x" * 1500 + " CODE : -8001 " + "y" * 1500
        notice = _guard_notice_from_state({"modals": [message], "body": "CODE : -8002"})
        self.assertEqual(notice["code"], "-8001")
        self.assertLessEqual(len(notice["message"]), 1200)
        self.assertIn("-8001", notice["message"])
        self.assertIsNone(_guard_notice_from_state({"modals": ["일반 안내"], "body": "CODE : -8002"}))

    def test_guard_check_records_restart_code_before_dismissal(self):
        page = Mock()
        page.context._pending_guard_notices = []
        notice = _guard_notice_from_state({"modals": ["다시 실행해 주세요. CODE : -8001"], "body": ""})
        events = []
        with patch.object(search, "inspect_guard_notice", return_value=notice), \
             patch.object(search, "record_guard", side_effect=lambda *args: events.append(("record", args[1]))), \
             patch.object(search, "dismiss_macro_notice", side_effect=lambda *args, **kwargs: events.append(("dismiss", kwargs["notice"])) or True):
            self.assertTrue(search._check_guard(page, "submit/retry-1"))
        self.assertEqual(events, [("record", notice), ("dismiss", notice)])
        self.assertEqual(events[0][1]["code"], "-8001")


if __name__ == "__main__":
    unittest.main()
