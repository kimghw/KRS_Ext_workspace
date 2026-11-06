"""One JSON request -> one JSON response for the native KTX bridge.

The only operations are search and open. Search submits once in a new dedicated
Chrome profile; open foregrounds its exact result page for manual booking.
"""
from __future__ import annotations

import contextlib
import ctypes
from datetime import date, datetime
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import urlparse
from urllib.request import build_opener, ProxyHandler
import uuid
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "vendor"))  # Also works with isolated Python (-I).
sys.path.insert(0, str(ROOT))
from lifecycle import ParentWatch, RequestLock
VERSION = "0.1.0"
SESSION_RE = re.compile(r"^[0-9a-f]{32}$")
STATIONS = frozenset([
    "서울", "용산", "영등포", "행신", "광명", "수원", "천안아산", "오송",
    "대전", "서대전", "김천구미", "서대구", "동대구", "경산", "밀양", "구포",
    "부산", "경주", "울산(통도사)", "포항", "마산", "창원중앙", "논산", "익산",
    "정읍", "광주송정", "목포", "전주", "순천", "여수EXPO", "강릉", "정동진",
])

class WorkerError(RuntimeError):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code

def validate_input(value, today=None):
    if not isinstance(value, dict) or set(value) != {"from", "to", "date", "hour", "adults"}:
        raise WorkerError("조회 조건 형식이 올바르지 않습니다.", "INVALID_INPUT")
    if not isinstance(value["from"], str) or not isinstance(value["to"], str) or value["from"] not in STATIONS or value["to"] not in STATIONS:
        raise WorkerError("지원하는 역을 선택해 주세요.", "INVALID_INPUT")
    if value["from"] == value["to"]:
        raise WorkerError("출발역과 도착역이 같습니다.", "INVALID_INPUT")
    if not isinstance(value["date"], str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value["date"]):
        raise WorkerError("출발일 형식이 올바르지 않습니다.", "INVALID_INPUT")
    try:
        day = date.fromisoformat(value["date"])
    except ValueError as exc:
        raise WorkerError("출발일이 올바르지 않습니다.", "INVALID_INPUT") from exc
    today = today or datetime.now(ZoneInfo("Asia/Seoul")).date()
    if day < today or (day - today).days > 365:
        raise WorkerError("출발일은 오늘부터 1년 이내로 선택해 주세요.", "INVALID_INPUT")
    if type(value["hour"]) is not int or not 0 <= value["hour"] <= 23:
        raise WorkerError("출발 시각은 0~23시입니다.", "INVALID_INPUT")
    if type(value["adults"]) is not int or not 1 <= value["adults"] <= 9:
        raise WorkerError("어른 인원은 1~9명입니다.", "INVALID_INPUT")
    return dict(value)

def query_config(value):
    from ktx_watcher.config import KTXAConfig
    return KTXAConfig(value["from"], value["to"], date.fromisoformat(value["date"]), value["hour"], value["adults"])

def shape_seat(value):
    if not isinstance(value, dict):
        return None
    text = str(value.get("text", ""))
    price = re.search(r"[\d,]+\s*원", text)
    soon = bool(value.get("imminent")) or "매진임박" in text
    sold = bool(value.get("sold_out")) or "매진" in text.replace("매진임박", "")
    return {"price": re.sub(r"\s+", "", price.group(0)) if price else "",
            "soldOut": sold, "soon": soon}

def shape_rows(raw, config):
    from ktx_watcher.korail.search import _route_matches
    rows = []
    for row in raw:
        if not _route_matches(row, config):
            continue
        train = str(row.get("train_name", ""))
        if not (train.startswith("KTX") or "청룡" in train):
            continue
        text = str(row.get("depart_raw", ""))
        times = re.search(r"\((\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})\)", text)
        number = re.search(r"(?:KTX[-\w]*|청룡)\s*(\d{1,4})(?!\d)", text)
        took = re.search(r"소요시간\s*:?\s*((?:\d+\s*시간\s*)?(?:\d+\s*분)?)", text)
        if not times:
            continue
        dep, arr = (t.zfill(5) for t in times.groups())
        if dep < f"{config.hour:02d}:00":
            continue
        rows.append({"train": train, "no": number.group(1) if number else "", "dep": dep, "arr": arr,
                     "took": took.group(1).strip() if took else "", "gen": shape_seat(row.get("gen")),
                     "spec": shape_seat(row.get("spec"))})
    return rows

def state_path(value):
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise WorkerError("실행부의 저장 경로를 확인하지 못했습니다.", "INVALID_STATE")
    root = Path(value).resolve()
    root.mkdir(parents=True, exist_ok=True)
    (root / "sessions").mkdir(exist_ok=True)
    (root / "profiles").mkdir(exist_ok=True)
    return root

def find_chrome():
    candidates = [Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Google/Chrome/Application/chrome.exe",
                  Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
                  Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "Google/Chrome/Application/chrome.exe"]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise WorkerError("Google Chrome 설치를 확인해 주세요.", "CHROME_MISSING")

def process_executable(pid):
    """Verify the owning Chrome process without shell commands or process enumeration."""
    if sys.platform != "win32":
        return None
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return None
    try:
        size = wintypes.DWORD(32768)
        buffer = ctypes.create_unicode_buffer(size.value)
        if kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            return Path(buffer.value).resolve()
        return None
    finally:
        kernel.CloseHandle(handle)

def endpoint_from_profile(profile):
    lines = (profile / "DevToolsActivePort").read_text(encoding="utf-8").splitlines()
    if len(lines) != 2 or not re.fullmatch(r"\d{1,5}", lines[0]) or not re.fullmatch(r"/devtools/browser/[A-Za-z0-9-]+", lines[1]):
        raise ValueError("Invalid dedicated Chrome endpoint")
    port = int(lines[0])
    if not 1 <= port <= 65535:
        raise ValueError("Invalid dedicated Chrome port")
    return port, lines[1]

def verify_browser(desc, profile):
    # Bind the session to this profile's browser identifier and its owning process.
    if type(desc.get("pid")) is not int or process_executable(desc["pid"]) != Path(desc.get("exe", "")).resolve():
        raise WorkerError("조회 창이 닫혔습니다. 다시 조회해 주세요.", "SESSION_CLOSED")
    port, browser_path = endpoint_from_profile(profile)
    if port != desc.get("port") or browser_path != desc.get("browserPath"):
        raise WorkerError("조회 창 정보가 바뀌었습니다. 다시 조회해 주세요.", "SESSION_CLOSED")
    direct = build_opener(ProxyHandler({}))
    with direct.open(f"http://127.0.0.1:{port}/json/version", timeout=3) as response:
        info = json.loads(response.read(65536))
    remote = urlparse(info.get("webSocketDebuggerUrl", ""))
    if remote.scheme != "ws" or remote.hostname not in ("127.0.0.1", "localhost") or remote.port != port or remote.path != browser_path:
        raise WorkerError("전용 조회 창에 연결하지 못했습니다.", "SESSION_CLOSED")
    return f"ws://127.0.0.1:{port}{browser_path}"

def start_browser(root, token):
    if sys.platform != "win32":
        raise WorkerError("현재 KTX 실행부는 Windows용입니다.", "WINDOWS_REQUIRED")
    executable = find_chrome()
    profile = root / "profiles" / token
    profile.mkdir(exist_ok=False)
    args = [str(executable), "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
            f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check", "--start-minimized", "about:blank"]
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 7  # SW_SHOWMINNOACTIVE; open() explicitly restores the result window.
    process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               startupinfo=startup, creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
    end = time.monotonic() + 15
    while time.monotonic() < end:
        if process.poll() is not None:
            raise WorkerError("전용 Chrome 창을 시작하지 못했습니다.", "CHROME_START_FAILED")
        try:
            port, browser_path = endpoint_from_profile(profile)
            desc = {"pid": process.pid, "exe": str(executable), "port": port, "browserPath": browser_path}
            return desc, verify_browser(desc, profile)
        except (OSError, ValueError, WorkerError):
            time.sleep(0.2)
    # No browser was handed to a user yet; terminate only this newly spawned process.
    process.terminate()
    raise WorkerError("전용 Chrome 창이 준비되지 않았습니다.", "CHROME_START_FAILED")

def save_session(root, token, desc):
    path = root / "sessions" / f"{token}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(desc, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)

def target_id(client, page):
    cdp = client.context.new_cdp_session(page)
    try:
        return cdp.send("Target.getTargetInfo")["targetInfo"]["targetId"]
    finally:
        cdp.detach()

def capture_failure(page, root, token):
    try:
        folder = root / "diagnostics"
        folder.mkdir(exist_ok=True)
        page.screenshot(path=str(folder / f"{token}.png"), full_page=True, timeout=5000)
    except Exception:
        logging.exception("Could not capture query failure")

def run_search(root, value):
    from ktx_watcher.korail.client import KorailSPAClient
    from ktx_watcher.korail import search
    config = query_config(value)
    token = uuid.uuid4().hex
    desc, endpoint = start_browser(root, token)
    desc.update({"created": datetime.now(ZoneInfo("Asia/Seoul")).isoformat(), "input": value})
    with KorailSPAClient(endpoint) as client:
        page = client.main_page()
        desc["target"] = target_id(client, page)
        save_session(root, token, desc)
        try:
            cdp = client.context.new_cdp_session(page)
            try:
                window = cdp.send("Browser.getWindowForTarget")
                cdp.send("Browser.setWindowBounds", {"windowId": window["windowId"], "bounds": {"windowState": "minimized"}})
            finally:
                cdp.detach()
            search.navigate_to_search(client)
            search.fill_search_form(page, config)
            search._check_guard(page, "after form")
            search._set_srt_option(page, config)
            raw = search.submit_search(page, config)
            return {"ok": True, "rows": shape_rows(raw, config), "session": token}
        except Exception as exc:
            capture_failure(page, root, token)
            return failure(exc, session=token)

def run_open(root, token):
    from ktx_watcher.korail.client import KorailSPAClient
    if not isinstance(token, str) or not SESSION_RE.fullmatch(token):
        raise WorkerError("조회 창 정보가 올바르지 않습니다.", "INVALID_SESSION")
    path = root / "sessions" / f"{token}.json"
    try:
        desc = json.loads(path.read_text(encoding="utf-8"))
        endpoint = verify_browser(desc, root / "profiles" / token)
    except (OSError, ValueError, TypeError) as exc:
        raise WorkerError("조회 창이 닫혔습니다. 다시 조회해 주세요.", "SESSION_CLOSED") from exc
    with KorailSPAClient(endpoint) as client:
        for page in client.context.pages:
            if target_id(client, page) != desc.get("target"):
                continue
            # User may already be booking/paying in this page: only restore and focus.
            cdp = client.context.new_cdp_session(page)
            try:
                window = cdp.send("Browser.getWindowForTarget")
                cdp.send("Browser.setWindowBounds", {"windowId": window["windowId"], "bounds": {"windowState": "normal"}})
                page.bring_to_front()
            finally:
                cdp.detach()
            return {"ok": True}
    raise WorkerError("조회 탭이 닫혔습니다. 다시 조회해 주세요.", "SESSION_CLOSED")

def failure(exc, **extra):
    return {"ok": False, "error": str(exc)[:1800] or type(exc).__name__,
            "code": getattr(exc, "code", type(exc).__name__), **extra}

def handle(request):
    if not isinstance(request, dict):
        raise WorkerError("요청 형식이 올바르지 않습니다.", "INVALID_INPUT")
    op = request.get("op")
    if op not in ("search", "open"):
        raise WorkerError("지원하지 않는 KTX 작업입니다.", "INVALID_OPERATION")
    # Validate before any browser process or filesystem action.
    value = validate_input(request.get("input")) if op == "search" else request.get("session")
    if op == "open" and (not isinstance(value, str) or not SESSION_RE.fullmatch(value)):
        raise WorkerError("조회 창 정보가 올바르지 않습니다.", "INVALID_SESSION")
    root = state_path(request.get("stateDir"))
    before = Path.cwd()
    try:
        os.chdir(root)  # Vendor diagnostic paths are isolated from all user projects.
        with RequestLock(root):
            return run_search(root, value) if op == "search" else run_open(root, value)
    finally:
        os.chdir(before)

def check_runtime():
    from ktx_watcher.korail import search
    from ktx_watcher.browser import sync_playwright
    assert callable(search.submit_search) and callable(sync_playwright)
    assert not hasattr(search, "perform_search") and not hasattr(search, "_requery_after_guard")
    ZoneInfo("Asia/Seoul")
    return {"ok": True, "version": VERSION, "python": sys.version.split()[0],
            "browserLibrary": importlib.metadata.version("rebrowser-playwright")}

def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(levelname)s %(message)s")
    checking = sys.argv[1:] == ["--check"]
    try:
        with contextlib.redirect_stdout(sys.stderr):
            if checking:
                result = check_runtime()
            elif sys.argv[1:]:
                raise WorkerError("지원하지 않는 실행 인자입니다.", "INVALID_OPERATION")
            else:
                raw = sys.stdin.buffer.read(65537)
                if len(raw) > 65536:
                    raise WorkerError("요청이 너무 큽니다.", "INVALID_INPUT")
                request = json.loads(raw.decode("utf-8"))
                if not isinstance(request, dict) or "parentPid" not in request:
                    raise WorkerError("브릿지 프로세스 정보가 없습니다.", "INVALID_PARENT")
                with ParentWatch(request["parentPid"]):
                    result = handle(request)
    except Exception as exc:
        result = failure(exc)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0 if not checking or result.get("ok") else 1

if __name__ == "__main__":
    raise SystemExit(main())
