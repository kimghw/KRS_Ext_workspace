"""OS-owned cancellation and serialization for the one-shot native worker."""
from __future__ import annotations

import ctypes
import os
from pathlib import Path
import sys
import threading


class LifecycleError(RuntimeError):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


class RequestLock:
    """Nonblocking byte lock; Windows releases it even if the worker is killed."""
    def __init__(self, root):
        self.path = Path(root) / "request.lock"
        self.file = None

    def __enter__(self):
        self.file = self.path.open("a+b")
        self.file.seek(0)
        try:
            if sys.platform == "win32":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:  # Allows unit tests on non-Windows hosts; browser execution is Windows-only.
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self.file.close()
            self.file = None
            raise LifecycleError("다른 KTX 요청을 처리하고 있습니다. 완료 후 다시 눌러 주세요.", "BUSY") from exc
        try:
            # Windows permits locking beyond EOF. Initialize only after acquiring
            # ownership so two first-ever requests cannot race on the empty file.
            self.file.seek(0, os.SEEK_END)
            if self.file.tell() == 0:
                self.file.write(b"\0")
                self.file.flush()
        except OSError:
            self.file.close()  # Closing also releases the acquired OS lock.
            self.file = None
            raise
        return self

    def __exit__(self, *args):
        if self.file is None:
            return
        try:
            self.file.seek(0)
            if sys.platform == "win32":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_UN)
        finally:
            self.file.close()
            self.file = None


class WindowsOwner:
    """Stable parent HANDLE + job containing this worker and its new descendants.

    No process enumeration or PID-based termination. An existing browser connected
    during open is not a descendant, so it cannot be killed by this job.
    The host must launch the managed base interpreter directly, with CPython's
    __PYVENV_LAUNCHER__ pointing at our venv. Running the venv redirector itself
    adds an outer kill-on-close job; this inner job would prevent its silent
    breakaway, so clearing our own flag could not preserve a new browser.
    """
    WAIT_OBJECT_0 = 0
    WAIT_TIMEOUT = 258
    LIMIT_KILL_ON_JOB_CLOSE = 0x2000

    def __init__(self, parent_pid):
        from ctypes import wintypes

        class BasicLimits(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                        ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

        class IoCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                                                               "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", BasicLimits), ("IoInfo", IoCounters),
                        ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

        self.limits_type = ExtendedLimits
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        k = self.kernel
        k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        k.OpenProcess.restype = wintypes.HANDLE
        k.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        k.WaitForSingleObject.restype = wintypes.DWORD
        k.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        k.CreateJobObjectW.restype = wintypes.HANDLE
        k.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        k.SetInformationJobObject.restype = wintypes.BOOL
        k.GetCurrentProcess.restype = wintypes.HANDLE
        k.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        k.AssignProcessToJobObject.restype = wintypes.BOOL
        k.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        k.TerminateJobObject.restype = wintypes.BOOL
        k.CloseHandle.argtypes = [wintypes.HANDLE]
        self.parent = k.OpenProcess(0x100000, False, parent_pid)  # SYNCHRONIZE only.
        self.job = None
        if not self.parent or k.WaitForSingleObject(self.parent, 0) != self.WAIT_TIMEOUT:
            self.close()
            raise LifecycleError("브릿지 연결이 종료되어 KTX 요청을 취소했습니다.", "PARENT_EXITED")
        try:
            self.job = k.CreateJobObjectW(None, None)
            if not self.job or not self._limits(self.LIMIT_KILL_ON_JOB_CLOSE):
                raise OSError("Cannot configure worker job")
            if not k.AssignProcessToJobObject(self.job, k.GetCurrentProcess()):
                raise OSError("Cannot contain worker process")
        except Exception as exc:
            # Assignment failed before any children were launched. Closing an empty
            # job is safe; if assigned successfully, the normal lifecycle owns it.
            self.close()
            raise LifecycleError("KTX 실행부의 종료 감시를 준비하지 못했습니다.", "PARENT_WATCH_FAILED") from exc

    def _limits(self, flags):
        limits = self.limits_type()
        limits.BasicLimitInformation.LimitFlags = flags
        return bool(self.kernel.SetInformationJobObject(self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits)))

    def wait(self, milliseconds):
        return self.kernel.WaitForSingleObject(self.parent, milliseconds)

    def terminate(self):
        # Includes self, the library driver, and newly launched Chrome descendants.
        self.kernel.TerminateJobObject(self.job, 1)
        os._exit(1)  # Also closes the kill-on-close handle if the call did not return success.

    def preserve_children(self):
        if not self._limits(0):
            # Keep the job handle until process exit; never report a successful handoff.
            raise LifecycleError("조회 창의 종료 감시를 해제하지 못했습니다.", "PARENT_WATCH_FAILED")

    def close(self):
        if self.parent:
            self.kernel.CloseHandle(self.parent)
            self.parent = None
        if self.job:
            self.kernel.CloseHandle(self.job)
            self.job = None


class ParentWatch:
    def __init__(self, parent_pid, owner_factory=None):
        if type(parent_pid) is not int or not 1 <= parent_pid <= 0xFFFFFFFF or parent_pid == os.getpid():
            raise LifecycleError("브릿지 프로세스 정보가 올바르지 않습니다.", "INVALID_PARENT")
        if sys.platform != "win32" and owner_factory is None:
            raise LifecycleError("현재 KTX 실행부는 Windows용입니다.", "WINDOWS_REQUIRED")
        self.owner = (owner_factory or WindowsOwner)(parent_pid)
        self.stop = threading.Event()
        self.mutex = threading.Lock()
        self.thread = threading.Thread(target=self._watch, name="ktx-parent-watch", daemon=True)

    def _watch(self):
        while not self.stop.is_set():
            status = self.owner.wait(500)
            if status == WindowsOwner.WAIT_TIMEOUT:
                continue
            with self.mutex:
                if not self.stop.is_set():
                    self.owner.terminate()
            return

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        with self.mutex:
            self.stop.set()
        self.thread.join(timeout=1)
        if self.owner.wait(0) != WindowsOwner.WAIT_TIMEOUT:
            self.owner.terminate()
        # Even on a handled site rejection preserve the diagnostic window when the
        # native bridge is still alive. An abrupt parent exit takes the kill path.
        self.owner.preserve_children()
        self.owner.close()
