"""The per-checkpoint record, and the run manifest.

Modelled on the erosion harness's capture (harness/capture.py): one self-describing JSON per
checkpoint holding the RAW material, so every derived number can be recomputed later without
re-running anything. The things that cannot be reproduced — the prompt actually sent, the agent's
stream, the Playwright failure text, which mutation survived — are the whole point of keeping it.

Written incrementally, not at the end: a 60-checkpoint run takes hours, and a record that only
lands on completion is unreadable exactly when something has gone wrong mid-run.
"""
from __future__ import annotations

import json
import os


def write_json(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as fh:
        json.dump(obj, fh, indent=2, default=str)


def write_text(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)


def gate_block(outcome, repeat_outcomes=(), wall_s=None) -> dict:
    """The raw gate result. `results` is the atom — every pass/fail count here is re-derivable
    from it, so later analysis never has to trust these aggregates.

    The gate runs more than once by default (DESIGN.md §5), so this also records what the repeats
    disagreed about. A test that flips between identical runs is FLAKY, and in an unattended
    pipeline a flake is the most expensive kind of wrong test: it is the one that spends human
    attention on nothing. A generated suite is more prone to it than a hand-written one — a
    missing wait, a race on an async render — so it is measured rather than assumed absent.

    `failed` is the union across repeats: a test is only passing if it passed EVERY time. That
    also keeps the mutation baseline honest — crediting a mutation for a failure that was really
    a flake would inflate the kill rate."""
    runs = [outcome, *repeat_outcomes]
    per_run = [dict(o.results or {}) for o in runs]
    every = sorted({t for r in per_run for t in r})
    failed = sorted(t for t in every if not all(r.get(t, False) for r in per_run))
    flaky = sorted(t for t in every
                   if len({r.get(t) for r in per_run if t in r}) > 1
                   or any(t not in r for r in per_run))
    durations = [sum((d.get("duration_ms") or 0) for d in (o.detail or [])) / 1000.0
                 for o in runs]
    return {
        "build_ok": all(o.build_ok for o in runs),
        "total_selected": outcome.total_selected,
        "passed": len(every) - len(failed),
        "failed_count": len(failed),
        "failed": failed,
        "repeats": len(runs),
        "flaky": flaky,                      # flipped between identical runs, or appeared in
                                             #   only some of them
        "flaky_count": len(flaky),
        "results": outcome.results,          # the first run's raw map — the atom
        "results_repeats": per_run[1:],      # the others, so a flip is re-derivable
        "detail": outcome.detail,            # per-test duration + full failure text
        "error": outcome.error or next((o.error for o in runs if o.error), ""),
        "gate_invalid": any(o.gate_invalid for o in runs),
        "gate_attempts": getattr(outcome, "gate_attempts", None),
        "test_seconds": round(sum(durations) / len(durations), 2),   # mean per repeat
        "wall_seconds": wall_s,              # build + serve + run, what a round actually costs
    }


def mutation_block(mid: str, kind: str, description: str, outcome, baseline_failed: set[str],
                   expect_kill: bool, spec: dict | None = None) -> dict:
    """One mutation run. `new_failures` is the verdict: a mutation is KILLED when it makes a
    test fail that was passing on the correct application — not merely when the suite is red,
    which it might already have been."""
    failed = set(t for t, ok in (outcome.results or {}).items() if not ok)
    new_failures = sorted(failed - baseline_failed)
    killed = bool(new_failures)
    return {
        "id": mid,
        "kind": kind,                        # "zero" | "authored"
        "description": description,
        "expect_kill": expect_kill,
        "killed": killed,
        "correct": killed == expect_kill,
        "new_failures": new_failures,
        "build_ok": outcome.build_ok,
        "gate_invalid": outcome.gate_invalid,
        "total_selected": outcome.total_selected,
        "failed_count": len(failed),
        "error": outcome.error,
        # WHAT was broken, not merely which mutation ran. Without it the record names a verdict
        # whose subject lives only in `mutations/` at whichever commit the run used, and "why did
        # this one survive?" cannot be asked of the record at all.
        "spec": ({"file": spec.get("file"), "clause": spec.get("clause"),
                  "breaks": spec.get("breaks"), "find": spec.get("find"),
                  "replace": spec.get("replace"),
                  "calibrated": spec.get("_calibrated")} if spec else None),
    }


def checkpoint_record(*, n: int, cp_id: str, cp_type: str, mutates: list, mode: str,
                      code_view: str, no_code_change: bool, request: str, prompt: str,
                      condition: str = "blind",
                      contract: dict, reference: dict, suite: dict, source: dict,
                      gate: dict, mutations: list[dict], verdict: dict,
                      files: dict, agent: dict | None) -> dict:
    return {
        "checkpoint": n,
        "checkpoint_id": cp_id,
        "type": cp_type,
        "mutates": mutates or [],
        "mode": mode,
        "code_view": code_view,
        # which §4.4 arm produced this suite. At the top level rather than only inside `agent`,
        # because it is what a cross-run comparison keys on and replay has no `agent` block.
        "condition": condition,
        "no_code_change": no_code_change,
        # self-describing: the record does not depend on this repo being at the same commit
        "request": request,
        "prompt": prompt,
        "contract": contract,
        # which application this was graded against, and which repairs were in it
        "reference": reference,
        # the suite as graded: files, per-file test ids, and what moved since the last checkpoint
        "suite": suite,
        # where the tests came from (replay: the erosion harness paths; agent: the turn)
        "source": source,
        "gate": gate,
        "mutations": mutations,
        "verdict": verdict,
        # side files written alongside this record
        "files": files,
        "agent": agent,
    }


def _out(args: list[str], cwd: str | None = None) -> str | None:
    import subprocess
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=20)
        return ((r.stdout or "") + (r.stderr or "")).strip().splitlines()[0][:200] or None
    except Exception:
        return None


def _lines(args: list[str], cwd: str | None = None) -> list[str]:
    """Full output, lines kept intact. `_out` is for one-line version strings — it strips and
    takes the first line, which silently mangles anything columnar."""
    import subprocess
    try:
        r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=20)
        return (r.stdout or "").splitlines()
    except Exception:
        return []


def provenance(cfg: dict, root: str) -> dict:
    """Which code, which fixture and which toolchain produced this run.

    A record that cannot say what produced it is not self-describing, however complete its
    numbers are. Three of these have bitten this project already in kind: the harness commit
    (every claim about a run is a claim about the code that ran it), the fixture's own commits and
    patch digests (the reference chain is the experiment's control and it has been repaired twice
    — "which repairs were in?" must be answerable from the record), and the Playwright version,
    because flakiness is a MEASURED quantity here and a browser-runner upgrade moves it.

    Everything is best-effort: a missing tool records null rather than failing a run that is
    otherwise fine.
    """
    import platform
    harness_sha = _out(["git", "-C", root, "rev-parse", "HEAD"])
    dirty = _lines(["git", "-C", root, "status", "--porcelain"])
    erosion = os.path.expanduser(str(cfg.get("erosion_harness") or ""))
    pw = None
    try:
        import json as _json
        with open(os.path.join(root, "reference", "base", "e2e", "package.json")) as fh:
            pkg = _json.load(fh)
        pw = ((pkg.get("devDependencies") or {}) | (pkg.get("dependencies") or {})
              ).get("@playwright/test")
    except Exception:
        pass
    ref_manifest = {}
    try:
        import yaml as _yaml
        with open(os.path.join(root, "reference", "manifest.yaml")) as fh:
            m = _yaml.safe_load(fh) or {}
        ref_manifest = {k: m.get(k) for k in
                        ("source_repo", "source_origin", "source_branch", "base_commit")}
        ref_manifest["checkpoints"] = {
            int(c["n"]): {"commit": c.get("commit"), "sha256_16": c.get("sha256_16"),
                          "files_changed": c.get("files_changed")}
            for c in (m.get("checkpoints") or [])}
    except Exception:
        pass
    return {
        # the code that ran it. `dirty` is the honest caveat: a run from an edited tree is not
        # reproducible from its sha alone, and that has to be visible rather than inferred.
        "harness": {"repo": "test-fidelity-long-run", "commit": harness_sha,
                    "dirty": bool(dirty),
                    # porcelain is `XY <path>`: two status columns and a space
                    "dirty_files": [l[3:] for l in dirty][:60]},
        # the fixture: the checkpoint requests, and the patch chain that is the control
        "erosion_harness": {"path": erosion, "commit": _out(
            ["git", "-C", erosion, "rev-parse", "HEAD"]) if erosion else None},
        "reference_manifest": ref_manifest,
        "toolchain": {"python": platform.python_version(), "platform": platform.platform(),
                      "node": _out(["node", "--version"]), "java": _out(["java", "-version"]),
                      "playwright": pw},
    }


def run_manifest(*, run_id: str, mode: str, code_view: str, cfg: dict, reference: dict,
 checkpoints: list[int], started: str, condition: str = "blind",
                 provenance: dict | None = None) -> dict:
    return {
        "run_id": run_id,
        "mode": mode,
        "code_view": code_view,
        "condition": condition,            # which §4.4 arm; also names the suite branch
        "started": started,
        "reference": reference,
        "checkpoints": checkpoints,
        "config": cfg,
        # what produced the run, so the record does not depend on this repo still being here
        "provenance": provenance or {},
    }
