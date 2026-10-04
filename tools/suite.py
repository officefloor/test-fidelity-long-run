#!/usr/bin/env python3
"""The test suite at a checkpoint — for REPLAY mode, and for sizing the rule in agent mode.

Replay mode (DESIGN.md §4) does not run an agent: it installs the erosion harness's own authored
specs at checkpoint N and grades them with the identical pipeline. Those specs are known-good, so
replay answers three questions at once — whether this harness works, whether the reference chain
is a sound fixture, and whether the mutation catalogue is calibrated.

Resolving "the suite at N" has to match the erosion harness exactly or replay would grade a
different thing: each checkpoint contributes its OWN spec plus any updated copies of prior specs
it ships in a sibling `cpNN/` folder, and a later entry for the same BASENAME wins. Mirrors
run_experiment._authored_specs.

    tools/suite.py resolve --checkpoint 25
    tools/suite.py install --checkpoint 25 --out work/cp25/e2e/specs
    tools/suite.py sizes
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import sys

HARNESS = os.path.expanduser("~/ui-long-degradation-test")
CP_RE = re.compile(r"cp0*(\d+)")
# `test('title', { tag: '@core' }, async ...)` / `test('title', async ...)`
TEST_RE = re.compile(r"^\s*test\s*\(", re.M)


def checkpoints(harness: str) -> list[dict]:
    import yaml
    with open(os.path.join(harness, "checkpoints.yaml")) as fh:
        cps = yaml.safe_load(fh)["checkpoints"]
    for cp in cps:
        m = CP_RE.search(cp["id"])
        cp["n"] = int(m.group(1)) if m else 0
    return sorted(cps, key=lambda c: c["n"])


def spec_entries(harness: str, cp: dict) -> list[str]:
    """Repo-relative spec paths checkpoint N installs: its own, plus the updated prior copies it
    ships in `cpNN/`. An explicit `tests:` list is honoured as the erosion harness does."""
    own = cp.get("test") or (list(cp.get("tests") or [None])[0])
    entries = [own] if own else []
    base = os.path.dirname(own) if own else ""
    folder = os.path.join(base, f"cp{cp['n']:02d}")
    abs_folder = os.path.join(harness, folder)
    if os.path.isdir(abs_folder):
        entries += [os.path.join(folder, f) for f in sorted(os.listdir(abs_folder))
                    if f.endswith(".spec.ts")]
    for e in (cp.get("tests") or []):
        if e not in entries:
            entries.append(e)
    return entries


def resolve(harness: str, k: int) -> dict[str, str]:
    """{installed basename -> source path} as of checkpoint k, later (mutative) copies winning."""
    authored: dict[str, str] = {}
    for cp in checkpoints(harness):
        if cp["n"] > k:
            break
        for entry in spec_entries(harness, cp):
            authored[os.path.basename(entry)] = entry
    return authored


def count_tests(path: str) -> int:
    with open(path) as fh:
        return len(TEST_RE.findall(fh.read()))


def cmd_resolve(args) -> int:
    for basename, src in sorted(resolve(args.harness, args.checkpoint).items()):
        n = count_tests(os.path.join(args.harness, src))
        print(f"{basename:<45} {n:>2} test(s)   <- {src}")
    return 0


def cmd_install(args) -> int:
    out = os.path.expanduser(args.out)
    os.makedirs(out, exist_ok=True)
    for fn in os.listdir(out):
        if fn.endswith(".spec.ts"):
            os.remove(os.path.join(out, fn))
    installed = resolve(args.harness, args.checkpoint)
    for basename, src in sorted(installed.items()):
        shutil.copy2(os.path.join(args.harness, src), os.path.join(out, basename))
    print(f"installed {len(installed)} spec file(s) at checkpoint {args.checkpoint} -> {out}")
    return 0


def cmd_sizes(args) -> int:
    """Suite size per checkpoint. Validates the grading rule against known-good tests: if the
    reference suite ever SHRINKS, a non-decreasing requirement would be wrong (DESIGN.md §5)."""
    prev_files = prev_tests = 0
    shrinks: list[str] = []
    for cp in checkpoints(args.harness):
        k = cp["n"]
        if k < 1 or k > args.last:
            continue
        installed = resolve(args.harness, k)
        files = len(installed)
        tests = sum(count_tests(os.path.join(args.harness, s)) for s in installed.values())
        d_f, d_t = files - prev_files, tests - prev_tests
        flag = ""
        if k > 1 and d_t < 0:
            flag = "  <-- SHRINKS"
            shrinks.append(f"cp{k:02d} ({d_t:+d} tests)")
        elif k > 1 and d_t == 0:
            flag = "  (flat)"
        print(f"cp{k:02d}  {cp.get('type','additive'):<9} files {files:>3} ({d_f:+d})   "
              f"tests {tests:>3} ({d_t:+d}){flag}")
        prev_files, prev_tests = files, tests
    print()
    if shrinks:
        print(f"the reference suite SHRINKS at: {', '.join(shrinks)} — a non-decreasing rule "
              f"would fail on known-good tests, so grading must allow these or explain them")
    else:
        print("the reference suite never shrinks: a non-decreasing rule holds on known-good tests")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--harness", default=HARNESS)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("resolve", help="list the suite at a checkpoint")
    p.add_argument("--checkpoint", type=int, required=True)
    p.set_defaults(fn=cmd_resolve)
    p = sub.add_parser("install", help="copy the suite at a checkpoint into a directory")
    p.add_argument("--checkpoint", type=int, required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_install)
    p = sub.add_parser("sizes", help="suite size per checkpoint; checks the non-decreasing rule")
    p.add_argument("--last", type=int, default=60)
    p.set_defaults(fn=cmd_sizes)
    args = ap.parse_args()
    args.harness = os.path.expanduser(args.harness)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
