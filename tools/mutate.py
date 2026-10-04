#!/usr/bin/env python3
"""The mutation catalogue: validate it, and see what it covers.

    .venv/bin/python tools/mutate.py validate              # every mutation applies, everywhere
    .venv/bin/python tools/mutate.py validate --checkpoint 8
    .venv/bin/python tools/mutate.py list
    .venv/bin/python tools/mutate.py coverage              # per checkpoint: how many, which clauses

`validate` is the cheap half of trusting a catalogue: it materialises each checkpoint and checks
that every mutation matches exactly once. The behavioural half — that each mutation is actually
KILLED by the experimenter's known-good suite — is replay mode's mutation phase (DESIGN.md §6),
so run that before grading any agent.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools"))

import reference as refmod                 # noqa: E402
from fidelity import mutations as mut      # noqa: E402


def cmd_validate(args) -> int:
    man = refmod.load_manifest()
    todo = ([args.checkpoint] if args.checkpoint
            else [cp["n"] for cp in man["checkpoints"]])
    work = os.path.join(ROOT, "work", "mutate-validate")
    problems: dict[int, list[str]] = {}
    total = 0
    for n in todo:
        ms = mut.applicable(n)
        if not ms:
            print(f"cp{n:02d}  (no mutation set)")
            continue
        refmod.materialise(n, work)
        bad = mut.validate(n, work)
        total += len(ms)
        if bad:
            problems[n] = bad
            print(f"cp{n:02d}  {len(ms)} mutation(s)  {len(bad)} PROBLEM(S)")
            for b in bad:
                print(f"        {b}")
        else:
            print(f"cp{n:02d}  {len(ms)} mutation(s)  ok")
    shutil.rmtree(work, ignore_errors=True)
    covered = [n for n in todo if mut.applicable(n)]
    empty = [n for n in todo if not mut.applicable(n)]
    print(f"\n{total} mutation(s) across {len(covered)} checkpoint(s)")
    if problems:
        print(f"PROBLEMS at {sorted(problems)}")
        return 1
    if not covered:
        # An empty set passes every check trivially. Saying "all apply" here once hid five
        # checkpoints whose manifests had never been written.
        print(f"NO MUTATIONS to validate for {empty} — nothing was checked.")
        return 1
    if empty:
        print(f"note: no mutation set at {empty}")
    print("all apply exactly once. Behavioural calibration is replay mode's mutation phase.")
    return 0


def cmd_list(args) -> int:
    man = refmod.load_manifest()
    for cp in man["checkpoints"]:
        n = cp["n"]
        ms = mut.applicable(n)
        if not ms:
            continue
        cal = mut.load(n).get("calibrated")
        print(f"cp{n:02d}  {len(ms)} mutation(s)  calibrated={bool(cal)}")
        for m in ms:
            print(f"    {m['id']:<44} {m['file']}")
            print(f"        clause: {m.get('clause', '?')}")
    return 0


def cmd_coverage(args) -> int:
    man = refmod.load_manifest()
    covered = missing = 0
    rows = []
    for cp in man["checkpoints"]:
        n = cp["n"]
        ms = mut.applicable(n)
        rows.append((n, len(ms)))
        if ms:
            covered += 1
        else:
            missing += 1
    for n, k in rows:
        bar = "#" * k if k else "-- none --"
        print(f"cp{n:02d}  {k:>2}  {bar}")
    print(f"\n{covered}/{covered + missing} checkpoints have a mutation set; "
          f"{sum(k for _, k in rows)} mutations in total")
    if missing:
        print(f"no set at: {[n for n, k in rows if not k]}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("validate", help="every mutation matches exactly once at its checkpoint")
    p.add_argument("--checkpoint", type=int)
    p.set_defaults(fn=cmd_validate)
    p = sub.add_parser("list", help="the catalogue, with each mutation's clause")
    p.set_defaults(fn=cmd_list)
    p = sub.add_parser("coverage", help="mutations per checkpoint")
    p.set_defaults(fn=cmd_coverage)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
