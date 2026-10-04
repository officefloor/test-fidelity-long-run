"""Borrow the erosion harness's machinery instead of forking it (DESIGN.md §9).

`correctness.py` already builds the app, serves it, runs Playwright and parses the report; the
grading differs here but the runner does not, so it is imported rather than reimplemented. That
keeps one definition of "the suite passed" across both harnesses — which matters, because replay
mode's whole claim is that it grades the same thing the erosion run graded.
"""
from __future__ import annotations

import os
import sys

DEFAULT_HARNESS = os.path.expanduser("~/ui-long-degradation-test")


def load(harness: str = DEFAULT_HARNESS):
    """Import harness.correctness / harness.agent from the erosion repo."""
    harness = os.path.expanduser(harness)
    if not os.path.isdir(os.path.join(harness, "harness")):
        raise SystemExit(f"erosion harness not found at {harness} (needed for the gate runner)")
    if harness not in sys.path:
        sys.path.insert(0, harness)
    from harness import correctness            # noqa: E402
    try:
        from harness import agent              # noqa: E402
    except Exception:                          # agent mode only; replay does not need it
        agent = None
    return correctness, agent


def gate_config(cfg: dict) -> dict:
    """The subset of the erosion harness's config shape that `correctness.run_tests` reads:
    the bin/* scripts, the port and health URL, build timeouts, and where specs are installed.

    Port is left to be chosen free rather than pinned: a 60-checkpoint run builds and serves the
    app a hundred-plus times, and a JVM left behind by one killed run would otherwise hold 3000
    and let the next checkpoint gate against a stale app that still reports healthy.
    """
    app = (cfg.get("reference") or {}).get("app") or {}
    suite = cfg.get("generated_suite") or {}
    return {
        "app": {
            "build_cmd": app.get("build_cmd", "bin/build"),
            "start_cmd": app.get("start_cmd", "bin/start"),
            "stop_cmd": app.get("stop_cmd", "bin/stop"),
            "port": app.get("port") or 0,           # 0 -> correctness picks a free one
            "health_url": app.get("health_url"),
        },
        "build": cfg.get("build") or {},
        "acceptance": {"dest_subpath": suite.get("dest_subpath", "e2e/specs")},
    }
