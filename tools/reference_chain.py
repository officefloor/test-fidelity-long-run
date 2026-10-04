#!/usr/bin/env python3
"""Pick the REFERENCE CHAIN: which evolved chain is closest to all-green at every checkpoint.

The test-fidelity harness needs a FIXED application that is correct with respect to every
change request 1..N at each checkpoint N (DESIGN.md §2). The erosion harness
(~/ui-long-degradation-test) already produced several 60-checkpoint chains; this reads their
committed capture and ranks them by how much repair each needs.

A checkpoint step is DIRTY when a prior checkpoint's test fails there and that prior is not
listed in the step's `mutates` (so the breakage was not declared intentional). The first step
at which a given prior breaks is that prior's REPAIR SITE: the place to look, since the
breakage then propagates down the chain.

Own-test failures are reported separately: a step whose OWN test fails means the application
does not implement that step's change request at all, which no amount of spec repair fixes.

    tools/reference_chain.py --harness ~/ui-long-degradation-test --stacks ~
    tools/reference_chain.py --harness ~/ui-long-degradation-test --stacks ~ --json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter

CAPTURE = "evolve-results/capture/cp{n:02d}.json"
BRANCH_RE = re.compile(r"^evolve/(?P<run>\d+)/(?P<condition>[^/]+)/chain(?P<chain>\d+)$")
CP_RE = re.compile(r"cp0*(\d+)", re.IGNORECASE)


def sh(args: list[str]) -> str:
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def load_checkpoints(harness: str) -> dict[int, dict]:
    try:
        import yaml
    except ImportError:
        sys.exit("needs PyYAML — run with the erosion harness venv:\n"
                 "  ~/ui-long-degradation-test/.venv/bin/python tools/reference_chain.py ...")
    path = os.path.join(harness, "checkpoints.yaml")
    with open(path) as fh:
        cps = yaml.safe_load(fh)["checkpoints"]
    out = {}
    for cp in cps:
        m = CP_RE.search(cp["id"])
        if m:
            out[int(m.group(1))] = cp
    return out


def test_checkpoint(test_id: str) -> int | None:
    """The checkpoint a test belongs to, from cpNN in its spec basename — the same rule the
    erosion harness uses (correctness.test_checkpoint), so the numbers line up."""
    m = CP_RE.search(test_id.split("::")[0])
    return int(m.group(1)) if m else None


def discover_chains(stacks_dir: str, only_run: str | None) -> list[dict]:
    found = []
    for name in sorted(os.listdir(stacks_dir)):
        repo = os.path.join(stacks_dir, name)
        if not os.path.isdir(os.path.join(repo, ".git")):
            continue
        try:
            branches = sh(["git", "-C", repo, "for-each-ref", "--format=%(refname:short)",
                           "refs/heads/evolve"]).split()
        except subprocess.CalledProcessError:
            continue
        for br in branches:
            m = BRANCH_RE.match(br)
            if not m or (only_run and m.group("run") != only_run):
                continue
            found.append({"repo": repo, "stack": name, "branch": br,
                          "run": m.group("run"), "condition": m.group("condition"),
                          "chain": int(m.group("chain"))})
    return found


def grade_chain(chain: dict, checkpoints: dict[int, dict], last: int) -> dict:
    dirty: dict[int, set[int]] = {}
    own_fail: list[int] = []
    missing: list[int] = []
    for n in range(1, last + 1):
        cp = checkpoints.get(n)
        if cp is None:
            continue
        try:
            raw = sh(["git", "-C", chain["repo"], "show",
                      f"{chain['branch']}:{CAPTURE.format(n=n)}"])
        except subprocess.CalledProcessError:
            missing.append(n)
            continue
        tests = json.loads(raw).get("tests") or {}
        declared = {int(x) for x in (cp.get("mutates") or [])}
        broken = set()
        for row in tests.get("detail") or []:
            if row.get("passed"):
                continue
            owner = test_checkpoint(row["test_id"])
            if owner == n:
                own_fail.append(n)
            elif owner is not None and owner not in declared:
                broken.add(owner)
        if broken:
            dirty[n] = broken

    seen: set[int] = set()
    sites: list[dict] = []
    for n in sorted(dirty):
        new = sorted(dirty[n] - seen)
        if new:
            sites.append({"step": n, "breaks": new})
            seen |= set(new)
    return {**chain, "dirty_steps": sorted(dirty), "repair_sites": sites,
            "own_test_failures": sorted(set(own_fail)), "missing_capture": missing,
            "broken_priors": sorted(seen)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--harness", default=os.path.expanduser("~/ui-long-degradation-test"),
                    help="the erosion harness holding checkpoints.yaml")
    ap.add_argument("--stacks", default=os.path.expanduser("~"),
                    help="directory holding the stack repos (officehq-*)")
    ap.add_argument("--run", help="only this run id")
    ap.add_argument("--last", type=int, default=60, help="last checkpoint to grade")
    ap.add_argument("--json", action="store_true", help="emit the full grading as JSON")
    args = ap.parse_args()

    checkpoints = load_checkpoints(os.path.expanduser(args.harness))
    chains = discover_chains(os.path.expanduser(args.stacks), args.run)
    if not chains:
        sys.exit("no evolve/<run>/<condition>/chainN branches found")

    graded = [grade_chain(c, checkpoints, args.last) for c in chains]
    graded.sort(key=lambda g: (len(g["repair_sites"]), len(g["dirty_steps"])))

    if args.json:
        print(json.dumps(graded, indent=2))
        return 0

    for g in graded:
        print(f"{g['run']} {g['condition']:<10} {g['stack']:<24} chain{g['chain']}: "
              f"{len(g['repair_sites'])} repair sites, {len(g['dirty_steps'])} dirty steps")
        for s in g["repair_sites"]:
            print(f"    cp{s['step']:02d} breaks {['cp%02d' % b for b in s['breaks']]}")
        if g["own_test_failures"]:
            print(f"    !! own-test failures at {g['own_test_failures']} "
                  f"(application never implemented these requests)")
        if g["missing_capture"]:
            print(f"    .. no capture for {g['missing_capture']}")

    # A (step, prior) pair that recurs in most chains is an experimenter-side defect rather
    # than an agent slip: independent stacks under different conditions do not break the same
    # prior at the same step by chance. Counted per PRIOR, not per break-set, because the
    # break-sets differ between chains by the odd extra prior and would never match whole.
    pairs = Counter()
    for g in graded:
        for s in g["repair_sites"]:
            for prior in s["breaks"]:
                pairs[(s["step"], prior)] += 1
    n = len(graded)
    recurring = sorted(((c, step, prior) for (step, prior), c in pairs.items() if c > n // 2),
                       key=lambda t: (-t[0], t[1]))
    print(f"\n(step -> prior) breakages recurring in MOST of the {n} chains — look here first: "
          f"an under-declared `mutates`, a stale updated-prior copy, or a request every stack "
          f"implements the same wrong way:")
    for count, step, prior in recurring:
        print(f"    cp{step:02d} -> cp{prior:02d}  ({count}/{n} chains)")

    best = graded[0]
    print(f"\nreference-chain candidate: {best['stack']} {best['branch']} "
          f"({len(best['repair_sites'])} repair sites)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
