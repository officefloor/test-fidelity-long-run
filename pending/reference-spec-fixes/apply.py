#!/usr/bin/env python3
"""Apply the four reference-spec fixes, and add the mutations they unlock.

    .venv/bin/python pending/reference-spec-fixes/apply.py --check   # show what it would do
    .venv/bin/python pending/reference-spec-fixes/apply.py

HELD, not forgotten. These edits change specs that a replay INSTALLS at every checkpoint from
their own onward, and they add mutations that the running driver reads per checkpoint. Applying
either mid-run would shift the test-id set partway through and mark the affected sets
uncalibrated — so this refuses to run while a replay is in flight.

WHAT IT FIXES (mutations/README.md records these as reference-suite holes): four mutations were
left out of the catalogue because the experimenter's own spec had nothing that would catch them.
Each is a gap in the fixture, not a bad mutation. The spec changes close the gap; the mutations
then become usable.

    cp03  no project row count was asserted      -> a truncating list would survive
    cp21  a line's own qty/price/amount unasserted -> a line amount ignoring quantity would survive
    cp26  the audit channel was never read        -> dropping PROJECT_TAGGED/UNTAGGED would survive
    cp55  only three owing clients were seeded    -> the "top five" cap was untestable
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools"))
import reference as refmod                      # noqa: E402
from fidelity import mutations as mut           # noqa: E402

HARNESS = os.path.expanduser("~/ui-long-degradation-test")

# Each unlocked mutation: (checkpoint, id, clause, file, anchor, substitution, why)
UNLOCKED = [
    (3, "004-list-shows-only-the-first-project", "Show each project",
     "src/main/frontend/features/projects/ProjectList.tsx",
     "{projects.map((project) => (", ("projects.map", "projects.slice(0, 1).map"),
     "Only the first project renders. Unlocked by cp03 now asserting a row count — without it a\n"
     "truncating list is indistinguishable from a correct one on a single-row fixture."),
    (21, "003-line-amount-ignores-the-quantity", "how many, and the price each",
     "src/main/frontend/features/invoices/LineItemList.tsx",
     "{formatMoney(Number(line.qty) * Number(line.unitPrice))}",
     ("Number(line.qty) * Number(line.unitPrice)", "Number(line.unitPrice)"),
     "A line's amount is its unit price, ignoring how many. Correct whenever the quantity is 1,\n"
     "which is why cp21 had to start asserting a line's own figures for this to be catchable."),
    (26, "003-tagging-is-not-recorded", "put labels on projects",
     "src/main/java/net/officefloor/hq/app/ProjectTagsAddLogic.java",
     'audit.record("PROJECT_TAGGED', None,
     "The label is applied and nothing is written to the audit file. Invisible through the UI —\n"
     "unlocked by cp26 now reading the audit channel at all."),
    (26, "004-untagging-is-not-recorded", "so I can group them",
     "src/main/java/net/officefloor/hq/app/ProjectTagsRemoveLogic.java",
     'audit.record("PROJECT_UNTAGGED', None,
     "The label is removed and the removal is not recorded. The other half of the same channel."),
    (55, "002-top-clients-is-not-capped-at-five", "my top five clients",
     "src/main/java/net/officefloor/hq/app/DashboardTopClientsGetLogic.java",
     ".limit(TOP_N)", (".limit(TOP_N)", ".limit(Long.MAX_VALUE)"),
     "The list is not capped, so every owing client appears. Unlocked by cp55 now seeding six\n"
     "owing clients — with three, a cap of five is unobservable."),
]


def running() -> bool:
    r = subprocess.run(["pgrep", "-f", "fidelity.run"], capture_output=True, text=True)
    return r.returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="show what would change, change nothing")
    ap.add_argument("--force", action="store_true", help="apply even while a run is in flight")
    args = ap.parse_args()

    # --check changes nothing, so it is always safe — including mid-run, which is when you most
    # want to see what is queued up.
    if running() and not args.force and not args.check:
        print("A fidelity run is IN FLIGHT. Applying now would change specs it installs at every\n"
              "remaining checkpoint and mutations it reads per checkpoint, making the run\n"
              "internally inconsistent. Wait for it to finish, or pass --force if you intend to\n"
              "discard that run.", file=sys.stderr)
        return 2

    specs = sorted(os.listdir(os.path.join(HERE, "specs")))
    print(f"specs -> {HARNESS}/acceptance/specs/")
    for fn in specs:
        print(f"  {fn}")
    print(f"mutations -> {ROOT}/mutations/")
    for n, mid, *_ in UNLOCKED:
        print(f"  cp{n:02d}  {mid}")
    if args.check:
        print("\n--check: nothing changed")
        return 0

    for fn in specs:
        shutil.copy2(os.path.join(HERE, "specs", fn),
                     os.path.join(HARNESS, "acceptance", "specs", fn))
    print(f"\ncopied {len(specs)} spec file(s)")

    # Append each mutation, with its find/replace resolved against the REAL source at that
    # checkpoint — never transcribed, so an anchor that has moved fails loudly here rather than
    # silently matching nothing later.
    import json
    work = os.path.join(ROOT, "work", "unlock")
    added = 0
    for n, mid, clause, rel, anchor, sub, why in UNLOCKED:
        refmod.materialise(n, work)
        full = os.path.join(work, rel)
        lines = open(full).read().splitlines()
        hits = [l for l in lines if anchor in l]
        if len(hits) != 1:
            print(f"  cp{n:02d} {mid}: anchor matches {len(hits)} line(s) — SKIPPED", file=sys.stderr)
            continue
        find = hits[0]
        replace = (find.replace(*sub) if sub
                   else " " * (len(find) - len(find.lstrip())) + "// mutation: no audit record is written")
        path = mut.manifest_path(n)
        text = open(path).read().rstrip("\n")
        if mid in text:
            print(f"  cp{n:02d} {mid}: already present")
            continue
        block = (f"\n  - id: \"{mid}\"\n"
                 f"    clause: {json.dumps(clause)}\n"
                 f"    file: {rel}\n"
                 f"    breaks: |\n"
                 + "\n".join("      " + l for l in why.splitlines()) + "\n"
                 f"    find: {json.dumps(find)}\n"
                 f"    replace: {json.dumps(replace)}\n")
        # the set changes, so it is no longer calibrated
        text = text.replace("calibrated: true", "calibrated: false", 1)
        open(path, "w").write(text + "\n" + block)
        added += 1
        print(f"  cp{n:02d} {mid}: added")
    shutil.rmtree(work, ignore_errors=True)
    print(f"\nadded {added} mutation(s)")

    print("\nNext:")
    print("  .venv/bin/python tools/mutate.py validate")
    print("  .venv/bin/python tools/contract.py build && .venv/bin/python tools/contract.py check")
    print("  then a replay with --calibrate, since the changed sets are no longer calibrated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
