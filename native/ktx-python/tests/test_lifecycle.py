import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from lifecycle import LifecycleError, ParentWatch, RequestLock, WindowsOwner
import worker

HIDDEN = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}

def script(code):
    return [sys.executable, "-I", "-u", "-c", "import sys; sys.path.insert(0, " + repr(str(ROOT)) + "); " + code]

class LifecycleTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "win32", "Windows byte locks")
    def test_empty_lock_file_conflict_returns_busy_without_writing(self):
        import msvcrt
        with tempfile.TemporaryDirectory() as root:
            lock_path = Path(root) / "request.lock"
            # Another worker has acquired the initial byte but has not written it
            # yet. A contender must fail BUSY without attempting that write.
            with lock_path.open("w+b") as held:
                msvcrt.locking(held.fileno(), msvcrt.LK_NBLCK, 1)
                code = ("from lifecycle import RequestLock, LifecycleError\n"
                        "try:\n with RequestLock(" + repr(root) + "):\n  print('unexpected acquisition')\n"
                        "except LifecycleError as exc:\n print(exc.code)")
                result = subprocess.run(script(code), capture_output=True, text=True, timeout=10, **HIDDEN)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), "BUSY")
                self.assertEqual(lock_path.stat().st_size, 0)
                msvcrt.locking(held.fileno(), msvcrt.LK_UNLCK, 1)
            with RequestLock(root):
                self.assertEqual(lock_path.stat().st_size, 1)

    def test_cross_process_lock_rejects_second_request_and_releases_after_death(self):
        with tempfile.TemporaryDirectory() as root:
            code = "from lifecycle import RequestLock; import time\nwith RequestLock(" + repr(root) + "):\n print('locked', flush=True)\n time.sleep(30)"
            child = subprocess.Popen(script(code), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **HIDDEN)
            try:
                self.assertEqual(child.stdout.readline().strip(), "locked")
                with self.assertRaises(LifecycleError) as caught:
                    with RequestLock(root):
                        self.fail("second request acquired the held lock")
                self.assertEqual(caught.exception.code, "BUSY")
            finally:
                child.terminate()
                child.communicate(timeout=10)
            # The file remains, but the operating system released its lock.
            with RequestLock(root):
                self.assertTrue((Path(root) / "request.lock").exists())

    def test_parent_pid_validation_does_not_open_handles(self):
        for bad in (None, True, 0, -1, 2**32, os.getpid(), "123"):
            with self.subTest(bad=bad), self.assertRaises(LifecycleError) as caught:
                ParentWatch(bad, owner_factory=lambda _: self.fail("opened for invalid pid"))
            self.assertEqual(caught.exception.code, "INVALID_PARENT")

    def test_normal_completion_stops_watch_and_preserves_owned_children(self):
        class Owner:
            preserved = False
            closed = False
            def wait(self, ms):
                time.sleep(min(ms / 1000, 0.01))
                return WindowsOwner.WAIT_TIMEOUT
            def terminate(self):
                raise AssertionError("normal completion must not terminate")
            def preserve_children(self):
                self.preserved = True
            def close(self):
                self.closed = True
        owner = Owner()
        with ParentWatch(123, owner_factory=lambda _: owner) as watch:
            self.assertTrue(watch.thread.is_alive())
        self.assertFalse(watch.thread.is_alive())
        self.assertTrue(owner.preserved and owner.closed)

    def test_signaled_stable_handle_terminates_owned_job(self):
        stopped = threading.Event()
        class Owner:
            def wait(self, ms):
                return WindowsOwner.WAIT_OBJECT_0
            def terminate(self):
                stopped.set()
            def preserve_children(self):
                pass
            def close(self):
                pass
        watch = ParentWatch(123, owner_factory=lambda _: Owner())
        watch.__enter__()
        self.assertTrue(stopped.wait(2))
        watch.thread.join(timeout=2)
        self.assertFalse(watch.thread.is_alive())
        watch.stop.set()

    @unittest.skipUnless(sys.platform == "win32", "Windows handles and Job Objects")
    def test_dead_parent_rejects_before_operation(self):
        parent = subprocess.Popen([sys.executable, "-I", "-c", "pass"], **HIDDEN)
        parent.wait(timeout=10)
        result = subprocess.run(script("from lifecycle import ParentWatch\nwith ParentWatch(" + str(parent.pid) + "):\n print('unexpected operation')"),
                                capture_output=True, text=True, **HIDDEN)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("unexpected operation", result.stdout)

    @unittest.skipUnless(sys.platform == "win32", "Windows handles and Job Objects")
    def test_parent_death_kills_worker_and_its_driver_but_not_unrelated_process(self):
        parent = subprocess.Popen([sys.executable, "-I", "-c", "import time;time.sleep(30)"], **HIDDEN)
        unrelated = subprocess.Popen([sys.executable, "-I", "-c", "import time;time.sleep(30)"], **HIDDEN)
        code = ("from lifecycle import ParentWatch; import subprocess,time\nwith ParentWatch(" + str(parent.pid) + "):\n"
                " child = subprocess.Popen([sys.executable, '-I', '-c', 'import time;time.sleep(30)'], creationflags=subprocess.CREATE_NO_WINDOW)\n"
                " print(child.pid, flush=True)\n time.sleep(30)")
        watched = subprocess.Popen(script(code), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **HIDDEN)
        try:
            child_line = watched.stdout.readline().strip()
            self.assertTrue(child_line.isdigit(), watched.stderr.read() if not child_line else child_line)
            child_pid = int(child_line)
            self.assertIsNotNone(worker.process_executable(child_pid))
            parent.terminate()
            parent.wait(timeout=10)
            watched.communicate(timeout=5)
            deadline = time.monotonic() + 3
            while worker.process_executable(child_pid) is not None and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertIsNone(worker.process_executable(child_pid))
            self.assertIsNone(unrelated.poll(), "preexisting unrelated process must survive")
        finally:
            for process in (parent, watched, unrelated):
                if process.poll() is None:
                    process.terminate()
                process.communicate(timeout=10)

if __name__ == "__main__":
    unittest.main()
