"""Extract the reviewed, query-only subset from an explicit binjari checkout.

Usage: python tools/update_vendor.py E:/dev/binjari
No configuration files, credentials, watcher, reservation or payment code is read.
Review changes and the generated provenance whenever updating this snapshot.
"""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "vendor" / "ktx_watcher"

SEARCH_FUNCTIONS = (
    "_input_value", "_select_station", "_read_current_ym", "_click_day", "_click_hour",
    "_set_date", "_read_passenger_counts", "_click_passenger_step", "_set_passengers",
    "_parse_depart_time", "_parse_result_rows", "_set_srt_option", "_search_start_hour",
    "_query_state", "_condition_errors", "validate_query", "fill_search_form",
    "_read_rows", "_empty_marker_visible", "_route_matches",
)
CLIENT_FUNCTIONS = (
    "human_pause", "human_click", "human_type", "safe_goto", "_click_visible",
    "inspect_guard_notice",
)

def extract(source, names):
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    found = {n.name: "".join(lines[n.lineno - 1:n.end_lineno]) for n in tree.body
             if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
    return "\n\n\n".join(found[name] for name in names) + "\n"

def main():
    source_root = Path(sys.argv[1]).resolve(strict=True)
    source_files = {}
    def read(name):
        raw = (source_root / "ktx_watcher" / name).read_bytes()
        source_files[name] = hashlib.sha256(raw).hexdigest()
        return raw.decode("utf-8-sig")
    def write(name, text):
        path = DEST / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
    write("__init__.py", '"""Reviewed binjari query subset; see ../../PROVENANCE.json."""\n')
    for name in ("browser.py", "dom.py", "diagnostics.py"):
        write(name, read(name))
    search = extract(read("korail/search.py"), SEARCH_FUNCTIONS)
    search_header = '''"""Query form and row parsing extracted from binjari; bridge adds one-shot entrypoints."""
from __future__ import annotations
import logging
import re
from datetime import date as _date, time as Time
from typing import Any, Dict, List, Optional
from ..browser import Page, TimeoutError as PWTimeoutError
from ..config import KTXAConfig
from ..dom import read_page_state
from ..diagnostics import record_guard
from . import GuardBlocked, SiteLayoutChanged, QueryConditionMismatch, SearchResultUnavailable
from . import selectors as S
from .client import KorailSPAClient, inspect_guard_notice, dismiss_notice_modal, human_click, human_pause, human_type, safe_goto
LOGGER = logging.getLogger(__name__)
_TIME_RE = re.compile(r"(\\d{1,2}):(\\d{2})")

'''
    # The safe entrypoints live in a reviewed companion, not upstream retry flows.
    safe_search = (ROOT / "overrides" / "search_tail.py.txt").read_text(encoding="utf-8")
    write("korail/search.py", search_header + search + "\n" + safe_search)
    client = extract(read("korail/client.py"), CLIENT_FUNCTIONS)
    safe_client = (ROOT / "overrides" / "client_head.py.txt").read_text(encoding="utf-8")
    write("korail/client.py", safe_client + "\n\n" + client)
    selector_source = read("korail/selectors.py")
    used = {n.attr for n in ast.walk(ast.parse(search_header + search + safe_search + safe_client + client))
            if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id == "S"}
    lines = selector_source.splitlines(keepends=True)
    selected = []
    for node in ast.parse(selector_source).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in used for t in node.targets):
            selected.append("".join(lines[node.lineno - 1:node.end_lineno]))
    write("korail/selectors.py", '"""Only selectors referenced by the query-only subset."""\n' + "\n".join(selected))
    revision = subprocess.check_output(["git", "-C", str(source_root), "rev-parse", "HEAD"], text=True).strip()
    provenance = {"source": "https://github.com/kimghw/binjari", "revision": revision,
                  "source_sha256": source_files,
                  "vendor_sha256": {str(p.relative_to(DEST)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest()
                                    for p in sorted(DEST.rglob("*.py"))},
                  "changes": ["Extract only search form and result-reading helpers.",
                              "Replace dotenv/watcher config with explicit query dataclass.",
                              "No popup auto-confirmation, guard dismissal, reload, pagination or retry.",
                              "Fresh dedicated Chrome profile per query; explicit session handoff only.",
                              "Upstream browser library configuration is unchanged."]}
    (ROOT / "PROVENANCE.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
