"""Post-hoc analysis of a run: suite cost, suite churn, and whether fidelity degrades.

Deliberately NOT part of the run. A run's job is to produce the irreproducible material —
the prompts, the agent turns, the pass/fail maps, the mutation verdicts — and a 10-hour run
should not also be deciding how to summarise itself. Everything here is derived, so it can be
re-run, corrected and re-run again against a finished run at no cost, which is exactly what you
want from the part most likely to need changing.

    .venv/bin/python -m fidelity.analyse --run-id 202610041539
    .venv/bin/python -m fidelity.analyse --run-id <id> --csv     # also write records.csv

Answers two questions the run itself does not:

  SUITE COST AND CHURN (DESIGN.md §8) — does the generated suite rot? A suite at perfect
  fidelity that doubles in runtime every twenty changes, or that rewrites swathes of its earlier
  self each round, will not survive 300-500 unattended changes. This is the metric that decides
  whether the target is realistic, so it matters more than its size suggests.

  DEGRADATION (DESIGN.md §5) — does fidelity fall as the suite grows? The slope over checkpoint
  index, with a chain-level bootstrap CI when there is more than one chain. One chain gets a
  slope and NO interval, on purpose: checkpoints within a chain are not independent (cp30's
  suite is cp29's plus one), so a residual bootstrap over them would report an interval far
  narrower than the evidence supports. That is the same reason the erosion harness aggregates to
  chain level before testing anything.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

FIELDS = [
    ("green", "green (all tests pass, twice)"),
    ("kill_rate", "mutation kill rate"),
    ("flaky_count", "flaky tests"),
    ("tests_total", "suite size (tests)"),
    ("tests_added", "tests added"),
    ("tests_revised", "tests revised"),
    ("tests_dropped", "tests dropped"),
    ("test_seconds", "suite runtime (test time, s)"),
    ("wall_seconds", "suite runtime (wall, s)"),
    ("churn_lines", "lines of earlier tests rewritten"),
    ("churn_age_mean", "age of the test lines rewritten (checkpoints)"),
]


def load(run_id: str) -> list[dict]:
    """Every checkpoint record of every chain, flattened."""
    base = os.path.join(ROOT, "results", run_id)
    rows: list[dict] = []
    paths = sorted(glob.glob(os.path.join(base, "chain*", "cp*.json")))
    if not paths:                      # a run from before the per-chain layout
        paths = sorted(glob.glob(os.path.join(base, "cp*.json")))
    for p in paths:
        if ".dryrun" in p or ".error" in p:
            continue
        d = json.load(open(p))
        chain = d.get("chain")
        if chain is None:
            m = os.path.basename(os.path.dirname(p))
            chain = int(m[5:]) if m.startswith("chain") else 1
        v, g = d["verdict"], d["gate"]
        rows.append({
            "chain": chain, "checkpoint": d["checkpoint"], "checkpoint_id": d["checkpoint_id"],
            "type": d.get("type"), "no_code_change": d.get("no_code_change"),
            "green": 1.0 if v["green"] else 0.0,
            "kill_rate": v.get("kill_rate"),
            "mutations_authored": v.get("mutations_authored"),
            "mutations_killed": v.get("mutations_killed"),
            "survived": v.get("survived") or [],
            "mutation_zero_correct": v.get("mutation_zero_correct"),
            "flaky_count": len(v.get("flaky_tests") or []),
            "flaky_tests": v.get("flaky_tests") or [],
            "tests_total": v.get("tests_total"), "tests_delta": v.get("tests_delta"),
            "tests_added": v.get("tests_added"), "tests_revised": v.get("tests_revised"),
            "tests_dropped": v.get("tests_dropped"),
            "app_code_touched": len(v.get("app_code_touched") or []),
            "test_seconds": g.get("test_seconds"), "wall_seconds": g.get("wall_seconds"),
            "failed": g.get("failed") or [],
            "suite_commit": ((d.get("agent") or {}) or {}).get("suite_commit"),
        })
    return rows


# --- §8 suite churn -----------------------------------------------------------


def churn(run_id: str, rows: list[dict]) -> None:
    """How much of its OWN earlier test code each round rewrote, from the suite repo's history.

    Borrowed wholesale from the erosion harness: `metrics.reedit_line_stats` is git-only and
    layer-agnostic, so pointing it at a directory of specs needs no new measurement code. Only
    meaningful for an agent run — replay installs a fixed suite and commits nothing, so there is
    no history to measure and these columns stay empty."""
    try:
        from harness import metrics
    except Exception:
        return
    for chain in sorted({r["chain"] for r in rows}):
        repo = os.path.join(ROOT, "runs", run_id, f"chain{chain}", "suite")
        if not os.path.isdir(os.path.join(repo, ".git")):
            continue
        import subprocess
        log = subprocess.run(["git", "-C", repo, "log", "--format=%H %s", "--reverse"],
                             capture_output=True, text=True).stdout.splitlines()
        shas = {}
        base = None
        for line in log:
            sha, _, subject = line.partition(" ")
            if subject.startswith("empty suite"):
                base = sha
            elif subject.startswith("cp"):
                shas[int(subject[2:4])] = sha
        if base is None:
            continue
        prev = base
        for r in sorted((x for x in rows if x["chain"] == chain), key=lambda x: x["checkpoint"]):
            cur = shas.get(r["checkpoint"])
            if cur is None:
                continue
            try:
                st = metrics.reedit_line_stats(repo, prev, cur, base,
                                               lambda f: f.endswith(".spec.ts"))
                r["churn_lines"] = st.get("reedit_lines")
                r["churn_age_mean"] = st.get("reedit_age_mean")
                r["churn_rate"] = st.get("reedit_lines_rate")
            except Exception as e:
                r["churn_error"] = f"{type(e).__name__}: {e}"
            prev = cur


# --- §5 degradation -----------------------------------------------------------


def slope(series: list[tuple[int, float]]) -> float | None:
    """Ordinary least squares of y on checkpoint index."""
    pts = [(x, y) for x, y in series if y is not None]
    if len(pts) < 3:
        return None
    n = len(pts)
    mx = sum(x for x, _ in pts) / n
    my = sum(y for _, y in pts) / n
    den = sum((x - mx) ** 2 for x, _ in pts)
    return None if den == 0 else sum((x - mx) * (y - my) for x, y in pts) / den


def chain_bootstrap(per_chain: dict[int, list[tuple[int, float]]], n_boot: int = 2000):
    """Resample CHAINS, not checkpoints. Returns (slope, lo, hi) or (slope, None, None) when
    there is only one chain — see the module docstring for why no interval is reported then."""
    import random
    chains = sorted(per_chain)
    pooled = [p for c in chains for p in per_chain[c]]
    point = slope(pooled)
    if len(chains) < 2 or point is None:
        return point, None, None
    rnd = random.Random(0)
    draws = []
    for _ in range(n_boot):
        pick = [rnd.choice(chains) for _ in chains]
        pts = [p for c in pick for p in per_chain[c]]
        s = slope(pts)
        if s is not None:
            draws.append(s)
    if not draws:
        return point, None, None
    draws.sort()
    return point, draws[int(0.025 * len(draws))], draws[int(0.975 * len(draws)) - 1]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--csv", action="store_true", help="also write records.csv")
    args = ap.parse_args()

    rows = load(args.run_id)
    if not rows:
        raise SystemExit(f"no checkpoint records under results/{args.run_id}/")
    churn(args.run_id, rows)
    chains = sorted({r["chain"] for r in rows})
    out = os.path.join(ROOT, "results", args.run_id, "analysis")
    os.makedirs(out, exist_ok=True)

    L = [f"# test-fidelity-long-run — analysis of `{args.run_id}`", "",
         f"- chains: {chains}",
         f"- checkpoints graded: {len(rows)}"]

    graded = [r for r in rows if r["mutations_authored"]]
    kr = [r["kill_rate"] for r in rows if r["kill_rate"] is not None]
    L += [f"- green: {sum(int(r['green']) for r in rows)}/{len(rows)}",
          f"- mean kill rate: {sum(kr)/len(kr):.3f}" if kr else "- mean kill rate: n/a",
          f"- mutations: {sum(r['mutations_killed'] or 0 for r in graded)}"
          f"/{sum(r['mutations_authored'] or 0 for r in graded)} killed",
          f"- flaky tests: {sum(r['flaky_count'] for r in rows)}",
          f"- tests dropped (not revised): {sum(r['tests_dropped'] or 0 for r in rows)}",
          f"- application code touched at: "
          f"{[r['checkpoint'] for r in rows if r['app_code_touched']] or 'nowhere'}", ""]

    # headline: a checkpoint is a fidelity PASS when it is green, did not shrink, and mutation
    # zero behaved — the three things that must all hold for the round to be trustworthy
    ok = [r for r in rows
          if r["green"] and (r["tests_delta"] or 0) >= 0
          and r["mutation_zero_correct"] is not False]
    L += [f"**Fidelity rate: {len(ok)}/{len(rows)} "
          f"({100*len(ok)/len(rows):.0f}%)** — green, not shrinking, mutation zero correct.", ""]

    L += ["## Does it degrade as the suite grows?", ""]
    if len(chains) < 2:
        L += ["One chain, so slopes are reported WITHOUT a confidence interval. Checkpoints "
              "within a chain are not independent — cp30's suite is cp29's plus one — so an "
              "interval from resampling them would be far narrower than the evidence supports.",
              ""]
    L += ["| metric | slope / checkpoint | 95% CI |", "| --- | --- | --- |"]
    for field, label in FIELDS:
        per_chain = {c: [(r["checkpoint"], r[field]) for r in rows
                         if r["chain"] == c and r.get(field) is not None]
                     for c in chains}
        per_chain = {c: v for c, v in per_chain.items() if len(v) >= 3}
        if not per_chain:
            continue
        pt, lo, hi = chain_bootstrap(per_chain)
        if pt is None:
            continue
        ci = (f"[{lo:+.4f}, {hi:+.4f}] {'excludes 0' if (lo > 0 or hi < 0) else 'includes 0'}"
              if lo is not None else "n/a (one chain)")
        L += [f"| {label} | {pt:+.4f} | {ci} |"]
    L.append("")

    surv = [(r["chain"], r["checkpoint"], m) for r in rows for m in r["survived"]]
    if surv:
        L += ["## Mutations that survived", "",
              "Each is a part of a change request that no test pins.", ""]
        L += [f"- chain {c}, cp{n:02d}: `{m}`" for c, n, m in surv] + [""]
    fl = [(r["chain"], r["checkpoint"], t) for r in rows for t in r["flaky_tests"]]
    if fl:
        L += ["## Flaky tests", ""] + [f"- chain {c}, cp{n:02d}: `{t}`" for c, n, t in fl] + [""]

    path = os.path.join(out, "summary.md")
    with open(path, "w") as fh:
        fh.write("\n".join(L) + "\n")
    print("\n".join(L))
    print(f"\nwritten: {os.path.relpath(path, ROOT)}")

    if args.csv:
        import csv
        keys = sorted({k for r in rows for k in r})
        cpath = os.path.join(out, "records.csv")
        with open(cpath, "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=keys, extrasaction="ignore")
            w.writeheader()
            for r in rows:
                w.writerow({k: (";".join(v) if isinstance(v, list) else v)
                            for k, v in r.items()})
        print(f"written: {os.path.relpath(cpath, ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
