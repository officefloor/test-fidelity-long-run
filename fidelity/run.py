#!/usr/bin/env python3
"""The test-fidelity driver (DESIGN.md §4, §5).

    # validate the harness, the fixture and the mutation catalogue — no agent, commits nothing
    python -m fidelity.run --mode replay
    python -m fidelity.run --mode replay --from 1 --to 8        # a prefix, to try it out
    python -m fidelity.run --mode replay --checkpoint 25        # one checkpoint
    python -m fidelity.run --mode replay --no-mutations         # green phase only (half the time)

Each checkpoint: materialise the reference application, build the specification the agent is
given, obtain the tests (replay installs the erosion harness's own; agent writes them), grade
them green against that application, then apply one mutation at a time and require a new failure.

Everything is written under results/<run_id>/ as it happens, because a 60-checkpoint run takes
hours and a record that only lands at the end is unreadable exactly when something has broken.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools"))

import reference as refmod                       # noqa: E402  tools/reference.py
import suite as suitemod                         # noqa: E402  tools/suite.py
from fidelity import capture, changes, erosion, sandbox as sb, spec, turn  # noqa: E402

BAR = "=" * 78
SUB = "-" * 78


def now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def hms(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h}h{m:02d}m{s:02d}s" if h else f"{m}m{s:02d}s"


def load_config(path: str) -> dict:
    import yaml
    with open(path) as fh:
        raw = fh.read()
    cfg = yaml.safe_load(raw) or {}
    # ${erosion_harness} and ~ in the few path values that use them
    harness = os.path.expanduser(str(cfg.get("erosion_harness") or erosion.DEFAULT_HARNESS))
    cfg["erosion_harness"] = harness

    def expand(v):
        if isinstance(v, str):
            return os.path.expanduser(v.replace("${erosion_harness}", harness))
        if isinstance(v, list):
            return [expand(x) for x in v]
        if isinstance(v, dict):
            return {k: expand(x) for k, x in v.items()}
        return v
    return expand(cfg)


def wrap(text: str, indent: str = "    ", width: int = 74) -> str:
    """Re-flow for the console. Paragraphs are split on BLANK lines only — the change requests
    are hard-wrapped in checkpoints.yaml, and treating each of those source lines as a paragraph
    re-wraps them into ragged nonsense."""
    import textwrap
    out = []
    for para in text.strip().split("\n\n"):
        joined = " ".join(para.split())
        if not joined:
            continue
        out += textwrap.wrap(joined, width=width, initial_indent=indent,
                             subsequent_indent=indent)
    return "\n".join(out)


# --- the mutation catalogue ----------------------------------------------------


def report_leaks(hits: dict[str, list[str]], cfg: dict, seen: set[str]) -> None:
    """Print each distinct leak ONCE per run — they are the same at every checkpoint, and
    repeating 60 times would bury the things that do change.

    A HARD hit names a specific checkpoint or the harness; `blind.strict` refuses the run on
    one. A SOFT hit only says a checkpointed run exists, which the stack's base scaffolding has
    said in a few comments since before this harness existed."""
    strict = bool((cfg.get("blind") or {}).get("strict"))
    for kind in ("hard", "soft"):
        fresh = [h for h in hits.get(kind) or [] if h not in seen]
        for h in fresh:
            seen.add(h)
        if fresh:
            label = "LEAK" if kind == "hard" else "hint"
            print(f"    {label}   : {len(fresh)} new {kind} match(es) in the sandbox:")
            for h in fresh[:10]:
                print(f"             {h}")
    if strict and hits.get("hard"):
        raise RuntimeError(
            f"blind.strict is set and the sandbox contains {len(hits['hard'])} hard leak(s) "
            f"naming a checkpoint or the harness; refusing the turn")


def replay_suite(harness: str, n: int) -> dict[str, list[str]]:
    """{spec basename -> test ids} for the erosion harness's authored suite at checkpoint n —
    replay's baseline, computed without materialising anything."""
    if n < 1:
        return {}
    return {base: changes.parse_tests(os.path.join(harness, src))
            for base, src in sorted(suitemod.resolve(harness, n).items())}


def load_mutations(n: int) -> list[dict]:
    """mutations/cpNN/manifest.yaml, if there is one. Absent is normal: the catalogue is authored
    per checkpoint, and mutation zero needs no authoring at all."""
    import yaml
    path = os.path.join(ROOT, "mutations", f"cp{n:02d}", "manifest.yaml")
    if not os.path.isfile(path):
        return []
    with open(path) as fh:
        man = yaml.safe_load(fh) or {}
    if not man.get("calibrated", False):
        # Reported, not raised: an uncalibrated set is exactly what replay mode is for.
        for m in man.get("mutations") or []:
            m["_uncalibrated"] = True
    out = []
    for m in man.get("mutations") or []:
        if m.get("applies_from") and n < int(m["applies_from"]):
            continue
        out.append(m)
    return out


def apply_mutation(tree: str, n: int, mutation: dict) -> tuple[bool, str]:
    patch = os.path.join(ROOT, "mutations", f"cp{n:02d}", mutation["patch"])
    if not os.path.isfile(patch):
        return False, f"patch missing: {patch}"
    p = subprocess.run(["git", "-C", tree, "apply", "--whitespace=nowarn", patch],
                       capture_output=True, text=True)
    return p.returncode == 0, (p.stderr or p.stdout or "").strip()


def revert_tree(tree: str) -> None:
    """Back to the committed state — the suite commit — so each mutation starts from the same
    known-good application and mutations never accumulate (DESIGN.md §5 step 2)."""
    subprocess.run(["git", "-C", tree, "checkout", "--", "."], check=True,
                   capture_output=True, text=True)
    subprocess.run(["git", "-C", tree, "clean", "-fd", "--", "src"], check=True,
                   capture_output=True, text=True)


# --- one checkpoint ------------------------------------------------------------


def run_checkpoint(*, n: int, cp: dict, cfg: dict, args, correctness, agent, landlock,
                   gate_cfg: dict, out_dir: str, prev_ids: set[str], prev_suite: dict,
                   suite_repo: str | None, seen_leaks: set[str]) -> dict:
    cp_id = cp["id"]
    cp_type = cp.get("type", "additive")
    mutates = [int(m) for m in (cp.get("mutates") or [])]
    no_code = n in set((cfg.get("reference") or {}).get("no_code_change") or [])
    work = os.path.join(ROOT, "work", args.run_id)
    specs_rel = (cfg.get("generated_suite") or {}).get("dest_subpath", "e2e/specs")

    print()
    print(BAR)
    print(f"cp{n:02d}  {cp_id}   [{cp_type}"
          + (f", mutates {mutates}" if mutates else "")
          + (", NO CODE CHANGE" if no_code else "") + f"]   mode={args.mode}")
    print(BAR, flush=True)

    # 1. the application under test
    t0 = time.time()
    gate_tree = os.path.join(work, f"cp{n:02d}")
    refmod.materialise(n, gate_tree)
    repairs = [r["id"] for r in refmod.repairs_for(n)]
    print(f"  reference: cp{n:02d} materialised"
          + (f"  (+ fixture repair: {', '.join(repairs)})" if repairs else ""), flush=True)

    # 2. the specification — built and shown in BOTH modes, so replay validates it too
    contract = spec.load_contract(os.path.join(ROOT, "contracts"), n)
    fields = (cfg.get("contracts") or {}).get("include_in_prompt") or []
    specs_dir = os.path.join(gate_tree, specs_rel)

    # The baseline the prompt describes and the deltas are measured against: the suite as of
    # cp(N-1). In replay that is deterministic, so derive it rather than relying on the run
    # having started at cp01 — otherwise `--checkpoint 8` tells the agent its suite is empty and
    # reports all 14 tests as newly added.
    if args.mode == "replay" and n > 1:
        prev_suite = replay_suite(cfg["erosion_harness"], n - 1)
    elif args.mode == "agent":
        # the agent's own accumulated suite — authoritative, and correct even when the run is
        # resumed or started part-way
        prev_suite = changes.suite_tests(suite_repo)
    prior_files = sorted(prev_suite)
    prior_count = sum(len(v) for v in prev_suite.values())
    prompt = spec.build_prompt(cp["request"], contract, fields, args.code_view,
                               prior_files, prior_count)

    print(f"{SUB}\n  REQUEST\n{wrap(cp['request'])}")
    print(f"{SUB}\n  INTERFACE CONTRACT GIVEN TO THE AGENT"
          + ("" if args.mode == "agent" else " (replay: what WOULD be given)"))
    new_ids = contract.get("new_testids") or []
    new_audit = contract.get("new_audit_records") or []
    print(f"    new data-testids ({len(new_ids)}): "
          + (", ".join(new_ids) if new_ids else "(none)"))
    print(f"    new audit records ({len(new_audit)}): "
          + (", ".join(new_audit) if new_audit else "(none)"))
    print(f"    available: {len(contract.get('available_testids') or [])} testids, "
          f"{len(contract.get('available_audit_records') or [])} audit records")
    seed = contract.get("seed_accepts") or {}
    for coll, flds in sorted(seed.items()):
        print(f"    seed {coll}: {', '.join(flds) if flds else '(scalar)'}")
    print(f"    prompt: {len(prompt)} chars -> cp{n:02d}.prompt.txt")
    capture.write_text(os.path.join(out_dir, f"cp{n:02d}.prompt.txt"), prompt)
    print(SUB, flush=True)

    # 3. obtain the tests
    agent_block = None
    if args.mode == "replay":
        installed = suitemod.resolve(cfg["erosion_harness"], n)
        os.makedirs(specs_dir, exist_ok=True)
        for fn in os.listdir(specs_dir):
            if fn.endswith(".spec.ts"):
                os.remove(os.path.join(specs_dir, fn))
        for base, src in sorted(installed.items()):
            shutil.copy2(os.path.join(cfg["erosion_harness"], src),
                         os.path.join(specs_dir, base))
        source = {"kind": "replay", "from": cfg["erosion_harness"],
                  "spec_paths": {b: s for b, s in sorted(installed.items())}}
        print(f"  tests  : replay — installed {len(installed)} spec file(s) from the "
              f"erosion harness")
    else:
        # ---- agent mode -------------------------------------------------------------
        # The application the agent may see: cp(N-1), i.e. BEFORE this change (DESIGN.md §4.2).
        # At cp01 that is the base application; at a no-code checkpoint it is identical to cpN,
        # which is unavoidable and harmless.
        view_n = {"previous": max(n - 1, 0), "current": n, "none": None}[args.code_view]
        app_pristine = os.path.join(work, f"cp{n:02d}-view")
        if view_n is not None:
            refmod.materialise(view_n, app_pristine)
        else:
            refmod.materialise(0, app_pristine)      # base: scaffolding only, no features
        sandbox_dir = os.path.join(work, f"cp{n:02d}-sandbox")

        def rebuild():
            sb.build_sandbox(sandbox=sandbox_dir, app_tree=app_pristine,
                             suite_repo=suite_repo, specs_rel=specs_rel)
            if args.code_view == "none":
                # keep the e2e scaffolding and bin/*, drop the application sources
                for rel in ("src/main/frontend", "src/main/java", "src/main/resources"):
                    shutil.rmtree(os.path.join(sandbox_dir, rel), ignore_errors=True)

        stream_file = f"cp{n:02d}.agent.jsonl"
        print(f"  agent  : view=cp{view_n:02d} " if view_n else "  agent  : view=none ",
              end="", flush=True)
        print(f"({len(sb.spec_files(suite_repo))} spec file(s) in its suite)", flush=True)

        if args.dry_run:
            # Show the confined area and what is withheld, and run NO turn. A dry run must not
            # cost an agent call — that is the whole reason to have one.
            rebuild()
            cc = turn.confine_config(cfg, sandbox_dir, landlock, out_dir)
            report_leaks(sb.leak_scan(sandbox_dir, specs_rel), cfg, seen_leaks)
            top = sorted(os.listdir(sandbox_dir))
            print(f"    sandbox: {sandbox_dir}")
            print(f"      holds   : {', '.join(top)}")
            print(f"      specs   : {len(sb.spec_files(os.path.join(sandbox_dir, specs_rel)))} "
                  f"file(s), git history "
                  + ("present" if os.path.isdir(os.path.join(sandbox_dir, specs_rel, ".git"))
                     else "MISSING"))
            print(f"      app .git: "
                  + ("PRESENT — would leak the checkpoint number"
                     if os.path.isdir(os.path.join(sandbox_dir, ".git")) else "absent (correct)"))
            if cc:
                print(f"      withheld (refused if reachable):")
                for sx in cc["sentinels"]:
                    print(f"        {sx}")
            else:
                print("      confinement: DISABLED")
            print(f"    turn   : skipped (--dry-run)")
            capture.write_json(os.path.join(out_dir, f"cp{n:02d}.dryrun.json"), {
                "checkpoint": n, "checkpoint_id": cp_id, "mode": args.mode, "dry_run": True,
                "prompt": prompt, "contract": contract, "code_view": args.code_view,
                "view_checkpoint": view_n, "sandbox_top_level": top,
                "withheld": (cc or {}).get("sentinels", []),
                "suite_in_sandbox": sb.spec_files(os.path.join(sandbox_dir, specs_rel))})
            if not args.keep_work:
                shutil.rmtree(sandbox_dir, ignore_errors=True)
                shutil.rmtree(app_pristine, ignore_errors=True)
                shutil.rmtree(gate_tree, ignore_errors=True)
            return {"record": None, "suite": prev_suite, "ids": prev_ids}
        # Fail-closed check on what IS in the sandbox, not on what should be: a changed stack
        # doc or a new base file can reintroduce a hint no deny list would catch.
        rebuild()
        leaks = sb.leak_scan(sandbox_dir, specs_rel)
        report_leaks(leaks, cfg, seen_leaks)

        t_agent = time.time()
        ar, attempts = turn.run_turn(
            agent=agent, landlock=landlock, cfg=cfg, sandbox=sandbox_dir, prompt=prompt,
            model=args.model or cfg.get("model"),
            stream_path=os.path.join(out_dir, stream_file), run_dir=out_dir, rebuild=rebuild)
        agent_block = turn.result_block(ar, attempts)
        print(f"    turn   : ok={ar.ok} turns={ar.num_turns} cost=${ar.cost_usd:.4f} "
              f"{hms(time.time() - t_agent)} attempts={len(attempts)}"
              + (f"  stop={ar.stop_reason}" if ar.stop_reason else ""))
        if ar.error:
            print(f"    error  : {ar.error[:300]}")

        # Did it touch the application? It was told not to; a run that did is void, and the
        # diff is the evidence (DESIGN.md §4.1).
        adiff = sb.app_diff(app_pristine, sandbox_dir, specs_rel)
        if adiff:
            capture.write_text(os.path.join(out_dir, f"cp{n:02d}.agent.appdiff"), adiff)

        # take ONLY the spec files, then commit them on the run's branch
        moved = sb.copy_back(sandbox=sandbox_dir, suite_repo=suite_repo, specs_rel=specs_rel)
        test_diff = sb.commit_suite(suite_repo, f"cp{n:02d} {cp_id}: agent test changes")
        suite_sha, diff_text = test_diff
        capture.write_text(os.path.join(out_dir, f"cp{n:02d}.agent.testdiff"), diff_text)
        agent_block["app_diff_file"] = f"cp{n:02d}.agent.appdiff" if adiff else None
        agent_block["test_diff_file"] = f"cp{n:02d}.agent.testdiff"
        agent_block["stream_file"] = stream_file
        agent_block["suite_commit"] = suite_sha
        agent_block["sandbox_leaks"] = leaks

        # install the agent's suite into the gate tree
        os.makedirs(specs_dir, exist_ok=True)
        for fn in os.listdir(specs_dir):
            if fn.endswith(".spec.ts"):
                os.remove(os.path.join(specs_dir, fn))
        for fn in sb.spec_files(suite_repo):
            shutil.copy2(os.path.join(suite_repo, fn), os.path.join(specs_dir, fn))
        source = {"kind": "agent", "suite_repo": suite_repo, "suite_commit": suite_sha,
                  "code_view": args.code_view, "view_checkpoint": view_n,
                  "files_added": moved["added"], "files_removed": moved["removed"]}
        print(f"  tests  : agent wrote {len(moved['present'])} spec file(s); committed "
              f"{suite_sha[:8]} on the run branch")
        if not args.keep_work:
            shutil.rmtree(sandbox_dir, ignore_errors=True)
            shutil.rmtree(app_pristine, ignore_errors=True)

    # what moved, and did anything touch the application
    suite_now = changes.suite_tests(specs_dir)
    fdelta = changes.file_delta(prev_suite, suite_now)
    tdelta = changes.test_delta(prev_suite, suite_now)
    wc = changes.working_changes(gate_tree, specs_rel)
    total_tests = sum(len(v) for v in suite_now.values())
    print(f"    files  : {len(suite_now)} total  +{len(fdelta['added'])} "
          f"~{len(fdelta['modified'])} -{len(fdelta['removed'])}")
    for f in fdelta["added"]:
        print(f"             + {f}")
    for f in fdelta["modified"]:
        print(f"             ~ {f}")
    for f in fdelta["removed"]:
        print(f"             - {f}   <-- spec file REMOVED")
    moves = changes.classify_test_moves(prev_suite, suite_now)
    print(f"    tests  : {total_tests} total  +{len(moves['added'])} new  "
          f"~{len(moves['revised'])} revised  -{len(moves['dropped'])} dropped  "
          f"-{len(moves['file_gone'])} with a removed file")
    for t in moves["added"]:
        print(f"             + {t}")
    for f, gone, arrived in moves["revised"]:
        print(f"             ~ {gone}")
        print(f"               -> {arrived}")
    for f, t in moves["dropped"]:
        print(f"             - {t}   <-- DROPPED with nothing replacing it")
    for f, t in moves["file_gone"]:
        print(f"             - {t}   <-- its spec file was REMOVED")
    if wc["app"]:
        print(f"    APP CODE TOUCHED ({len(wc['app'])}) — a run that changes the application "
              f"is void:")
        for e in wc["app"][:20]:
            print(f"             ! {e}")
    else:
        print("    app code touched: none")
    sys.stdout.flush()

    # commit the suite so mutations can be reverted to a known-good tree
    subprocess.run(["git", "-C", gate_tree] + refmod.GIT_ID + ["add", "-A"], check=True,
                   capture_output=True, text=True)
    subprocess.run(["git", "-C", gate_tree] + refmod.GIT_ID
                   + ["commit", "-q", "-m", f"suite at cp{n:02d} ({args.mode})"],
                   check=False, capture_output=True, text=True)

    if args.dry_run:
        print("  gate   : skipped (--dry-run)")
        print(f"  {hms(time.time() - t0)} for cp{n:02d}", flush=True)
        capture.write_json(os.path.join(out_dir, f"cp{n:02d}.dryrun.json"), {
            "checkpoint": n, "checkpoint_id": cp_id, "mode": args.mode, "dry_run": True,
            "prompt": prompt, "contract": contract, "source": source,
            "suite": {"files": suite_now, "total_tests": total_tests,
                      "file_delta": fdelta, "test_delta": tdelta},
            "app_code_touched": wc["app"], "repairs_applied": repairs})
        if not args.keep_work:
            shutil.rmtree(gate_tree, ignore_errors=True)
        return {"record": None, "suite": suite_now, "ids": prev_ids}

    # 4. grade green
    tg = time.time()
    outcome = correctness.run_tests(gate_tree, n, gate_cfg)
    gate = capture.gate_block(outcome)
    capture.write_text(os.path.join(out_dir, f"cp{n:02d}.build.log"),
                       outcome.console or "")
    print(f"  gate   : build_ok={gate['build_ok']} selected={gate['total_selected']} "
          f"passed={gate['passed']} failed={gate['failed_count']} "
          f"gate_invalid={gate['gate_invalid']}  ({hms(time.time() - tg)})")
    if gate["error"]:
        print(f"    error  : {gate['error'][:300]}")
    for t in gate["failed"]:
        why = next((d.get("failure") or "" for d in (gate["detail"] or [])
                    if d["test_id"] == t), "")
        print(f"    FAILED : {t}")
        if why:
            print(f"             {' '.join(why.split())[:200]}")
    sys.stdout.flush()

    baseline_failed = set(gate["failed"])
    gate_ids = set(gate["results"] or {})

    # 5. mutations, one at a time
    muts: list[dict] = []
    if args.no_mutations:
        print("  mutations: skipped (--no-mutations)")
    elif gate["gate_invalid"] or not gate["build_ok"]:
        print("  mutations: skipped — the gate produced no verdict, so a mutation run would "
              "be uninterpretable")
    else:
        print("  mutations:")
        # mutation ZERO: the same suite against the application WITHOUT this change
        if n > 1:
            zero_tree = os.path.join(work, f"cp{n:02d}-zero")
            refmod.materialise(n - 1, zero_tree)
            zero_specs = os.path.join(zero_tree, specs_rel)
            os.makedirs(zero_specs, exist_ok=True)
            for fn in os.listdir(zero_specs):
                if fn.endswith(".spec.ts"):
                    os.remove(os.path.join(zero_specs, fn))
            for fn in os.listdir(specs_dir):
                if fn.endswith(".spec.ts"):
                    shutil.copy2(os.path.join(specs_dir, fn), os.path.join(zero_specs, fn))
            z = correctness.run_tests(zero_tree, n, gate_cfg)
            # At a no-code checkpoint cp(N-1) IS cpN, so the suite must still PASS: there is no
            # feature to be missing, and a failure means the test asserts behaviour the
            # application does not have (DESIGN.md §5).
            block = capture.mutation_block(
                "zero", "zero",
                f"application at cp{n - 1:02d} — this change's feature absent", z,
                baseline_failed, expect_kill=not no_code)
            muts.append(block)
            verdict = ("KILLED" if block["killed"] else "SURVIVED")
            ok = "ok" if block["correct"] else "WRONG"
            print(f"    zero   (app at cp{n - 1:02d}){'':<18} {verdict:<9} "
                  f"expected={'kill' if block['expect_kill'] else 'survive'}  [{ok}]")
            for t in block["new_failures"][:10]:
                print(f"             failed: {t}")
            if not block["correct"]:
                print(f"             ^^ at a no-code checkpoint the suite must still pass"
                      if no_code else
                      f"             ^^ no test failed without the feature: the new tests do "
                      f"not bind to this change")
            shutil.rmtree(zero_tree, ignore_errors=True)
            sys.stdout.flush()

        for m in load_mutations(n):
            ok_apply, err = apply_mutation(gate_tree, n, m)
            if not ok_apply:
                print(f"    {m['id']:<42} DID NOT APPLY  {err[:120]}")
                muts.append({"id": m["id"], "kind": "authored", "applied": False,
                             "error": err, "killed": None, "correct": None})
                revert_tree(gate_tree)
                continue
            mo = correctness.run_tests(gate_tree, n, gate_cfg)
            block = capture.mutation_block(m["id"], "authored",
                                           (m.get("breaks") or "").strip(), mo,
                                           baseline_failed, expect_kill=True)
            block["applied"] = True
            block["clause"] = m.get("clause")
            block["uncalibrated"] = bool(m.get("_uncalibrated"))
            muts.append(block)
            print(f"    {m['id']:<42} {'KILLED' if block['killed'] else 'SURVIVED':<9}"
                  + (f" {len(block['new_failures'])} new failure(s)" if block["killed"]
                     else "  <-- no test caught it"))
            for t in block["new_failures"][:6]:
                print(f"             failed: {t}")
            revert_tree(gate_tree)
            sys.stdout.flush()

    # 6. verdict
    authored = [m for m in muts if m["kind"] == "authored" and m.get("applied")]
    killed = [m for m in authored if m.get("killed")]
    zero = next((m for m in muts if m["kind"] == "zero"), None)
    grew = total_tests - prior_count
    verdict = {
        "green": gate["failed_count"] == 0 and gate["build_ok"] and not gate["gate_invalid"],
        "suite_non_decreasing": grew >= 0,
        "tests_total": total_tests, "tests_delta": grew,
        "tests_added": len(moves["added"]), "tests_revised": len(moves["revised"]),
        # the maintenance signal: a test that went with nothing replacing it (DESIGN.md §5)
        "tests_dropped": len(moves["dropped"]) + len(moves["file_gone"]),
        "app_code_touched": wc["app"],
        "mutation_zero_correct": (zero or {}).get("correct"),
        "kill_rate": (len(killed) / len(authored)) if authored else None,
        "mutations_authored": len(authored), "mutations_killed": len(killed),
        "survived": [m["id"] for m in authored if not m.get("killed")],
    }
    print(f"  verdict: green={'yes' if verdict['green'] else 'NO'}  "
          f"tests={total_tests} ({grew:+d})  "
          f"zero={verdict['mutation_zero_correct']}  "
          f"kill_rate="
          + (f"{len(killed)}/{len(authored)}" if authored else "n/a (no catalogue)")
          + (f"  APP TOUCHED" if wc["app"] else ""))
    print(f"  {hms(time.time() - t0)} for cp{n:02d}", flush=True)

    rec = capture.checkpoint_record(
        n=n, cp_id=cp_id, cp_type=cp_type, mutates=mutates, mode=args.mode,
        code_view=args.code_view, no_code_change=no_code,
        request=cp["request"], prompt=prompt, contract=contract,
        reference={"repo": (cfg.get("reference") or {}).get("repo"),
                   "origin": (cfg.get("reference") or {}).get("origin"),
                   "branch": (cfg.get("reference") or {}).get("branch"),
                   "repairs_applied": repairs},
        suite={"files": {k: v for k, v in suite_now.items()}, "total_tests": total_tests,
               "file_delta": fdelta, "test_delta": tdelta,
               "test_moves": {"added": moves["added"], "revised": moves["revised"],
                              "dropped": moves["dropped"], "file_gone": moves["file_gone"]},
               "gate_id_delta": changes.id_delta(prev_ids, gate_ids)},
        source=source, gate=gate, mutations=muts, verdict=verdict,
        files={"prompt": f"cp{n:02d}.prompt.txt", "build_log": f"cp{n:02d}.build.log"},
        agent=agent_block)
    capture.write_json(os.path.join(out_dir, f"cp{n:02d}.json"), rec)

    if not args.keep_work:
        shutil.rmtree(gate_tree, ignore_errors=True)
    return {"record": rec, "suite": suite_now, "ids": gate_ids}


# --- the run -------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=os.path.join(ROOT, "config.yaml"))
    ap.add_argument("--mode", choices=("replay", "agent"), default=None)
    ap.add_argument("--code-view", choices=("previous", "none", "current"), default=None)
    ap.add_argument("--from", dest="first", type=int, default=1)
    ap.add_argument("--to", dest="last", type=int, default=60)
    ap.add_argument("--checkpoint", type=int, help="just this one")
    ap.add_argument("--dry-run", action="store_true",
                    help="stop before building: show the specification, the installed suite and "
                         "what moved, but run no tests. Costs seconds, and is how to check the "
                         "prompt and the contract before paying for a full run.")
    ap.add_argument("--no-mutations", action="store_true",
                    help="green phase only — roughly halves the wall clock")
    ap.add_argument("--keep-work", action="store_true",
                    help="keep each checkpoint's materialised tree for inspection")
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--model", default=None, help="override the configured agent model")
    args = ap.parse_args()

    cfg = load_config(args.config)
    args.mode = args.mode or cfg.get("mode") or "replay"
    args.code_view = args.code_view or cfg.get("code_view") or "previous"
    args.run_id = args.run_id or dt.datetime.now().strftime("%Y%m%d%H%M")
    if args.checkpoint:
        args.first = args.last = args.checkpoint

    correctness, agent = erosion.load(cfg["erosion_harness"])
    gate_cfg = erosion.gate_config(cfg)
    if not os.path.isdir(os.path.join(ROOT, "reference", "base")):
        raise SystemExit("reference/ is not imported — run tools/reference.py import first")

    landlock = None
    suite_repo = None
    if args.mode == "agent":
        if agent is None:
            raise SystemExit("harness.agent could not be imported from the erosion harness")
        sys.path.insert(0, cfg["erosion_harness"])
        from harness import landlock as landlock      # noqa: E402
        # A run spawns a fresh agent per checkpoint over many hours, so an interactive login
        # would expire mid-run. Fail here rather than at cp40.
        if not args.dry_run and not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
            raise SystemExit(
                "agent mode needs a long-lived token: export "
                "CLAUDE_CODE_OAUTH_TOKEN=$(claude setup-token). A 60-checkpoint run spawns an "
                "agent per checkpoint over hours, and an interactive login expires part-way.")
        suite_repo = os.path.join(ROOT, "runs", args.run_id, "suite")
        sb.init_suite_repo(suite_repo, f"agent/{args.run_id}")

    cps = {c["n"]: c for c in suitemod.checkpoints(cfg["erosion_harness"])}
    todo = [n for n in sorted(cps) if args.first <= n <= args.last]
    out_dir = os.path.join(ROOT, "results", args.run_id)
    os.makedirs(out_dir, exist_ok=True)

    print(BAR)
    print(f"test-fidelity-long-run   mode={args.mode}  code_view={args.code_view}  "
          f"run_id={args.run_id}")
    ref = cfg.get("reference") or {}
    print(f"  reference : {ref.get('repo')} {ref.get('branch')}")
    print(f"              {ref.get('origin') or '(no origin recorded)'}")
    print(f"  checkpoints: cp{todo[0]:02d}..cp{todo[-1]:02d} ({len(todo)})")
    print(f"  results   : results/{args.run_id}/")
    if args.mode == "replay":
        print("  replay mode: tests come from the erosion harness; NOTHING is committed")
    else:
        print(f"  agent     : {args.model or cfg.get('model')}  code_view={args.code_view}")
        print(f"  suite repo: runs/{args.run_id}/suite  (branch agent/{args.run_id})")
    print(f"  started   : {now()}")
    print(BAR, flush=True)

    capture.write_json(os.path.join(out_dir, "run.json"), capture.run_manifest(
        run_id=args.run_id, mode=args.mode, code_view=args.code_view, cfg=cfg,
        reference={"repo": (cfg.get("reference") or {}).get("repo"),
                   "origin": (cfg.get("reference") or {}).get("origin"),
                   "branch": (cfg.get("reference") or {}).get("branch")},
        checkpoints=todo, started=now()))

    t_run = time.time()
    prev_suite: dict[str, list[str]] = {}
    prev_ids: set[str] = set()
    seen_leaks: set[str] = set()
    rows: list[dict] = []
    for i, n in enumerate(todo, 1):
        try:
            res = run_checkpoint(n=n, cp=cps[n], cfg=cfg, args=args, correctness=correctness,
                                 agent=agent, landlock=landlock, gate_cfg=gate_cfg,
                                 out_dir=out_dir, prev_ids=prev_ids, prev_suite=prev_suite,
                                 suite_repo=suite_repo, seen_leaks=seen_leaks)
        except Exception as e:                       # one bad checkpoint must not end the run
            print(f"  !! cp{n:02d} aborted: {type(e).__name__}: {e}", flush=True)
            capture.write_json(os.path.join(out_dir, f"cp{n:02d}.error.json"),
                               {"checkpoint": n, "error": f"{type(e).__name__}: {e}"})
            continue
        if res["record"] is not None:
            rows.append(res["record"])
        prev_suite, prev_ids = res["suite"], res["ids"]
        done = time.time() - t_run
        print(f"  [{i}/{len(todo)}] elapsed {hms(done)}  eta {hms(done / i * (len(todo) - i))}",
              flush=True)

    if args.dry_run:
        print(f"\n{BAR}\ndry run: {len(todo)} checkpoint(s) rendered, nothing built. "
              f"results/{args.run_id}/\n{BAR}", flush=True)
        return 0
    write_summary(out_dir, args, rows, time.time() - t_run)
    if args.mode == "agent" and suite_repo:
        commit_capture(suite_repo, out_dir, args.run_id)
    return 0


def commit_capture(suite_repo: str, out_dir: str, run_id: str) -> None:
    """The final commit: the whole run's capture, alongside the suite it produced.

    The per-checkpoint commits show WHAT the agent wrote; this shows what it was asked, what it
    did to get there, and how it was judged — the agent's streamed turns, the prompts, the gate
    output, the mutation verdicts. Kept in the same repository as the suite so reviewing a run is
    one `git log`, and so the evidence cannot drift away from the tests it explains."""
    dest = os.path.join(suite_repo, "capture")
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    shutil.copytree(out_dir, dest)
    sb.git(suite_repo, "add", "-A")
    subprocess.run(["git", "-C", suite_repo] + sb.GIT_ID
                   + ["commit", "-q", "-m",
                      f"run {run_id}: capture (prompts, agent streams, gate + mutation results)"],
                   check=False, capture_output=True, text=True)
    sha = sb.git(suite_repo, "rev-parse", "HEAD").strip()
    print(f"  suite + capture committed: {suite_repo}  ({sha[:8]})")
    print(f"  review with:  git -C {suite_repo} log --stat")


def write_summary(out_dir: str, args, rows: list[dict], elapsed: float) -> None:
    """A run-level view, and in replay mode a verdict on the fixture: every red here is a
    fixture defect, since the suite installed is known-good (DESIGN.md §4.3)."""
    green = [r for r in rows if r["verdict"]["green"]]
    not_green = [r for r in rows if not r["verdict"]["green"]]
    shrank = [r for r in rows if not r["verdict"]["suite_non_decreasing"]]
    zero_wrong = [r for r in rows if r["verdict"]["mutation_zero_correct"] is False]
    touched = [r for r in rows if r["verdict"]["app_code_touched"]]
    survived = [(r["checkpoint"], s) for r in rows for s in r["verdict"]["survived"]]

    L = [f"# test-fidelity-long-run — run `{args.run_id}` ({args.mode})", "",
         f"- checkpoints graded: {len(rows)}",
         f"- green: {len(green)}/{len(rows)}",
         f"- suite shrank at: {[r['checkpoint'] for r in shrank] or 'nowhere'}",
         f"- mutation zero wrong at: {[r['checkpoint'] for r in zero_wrong] or 'nowhere'}",
         f"- application code touched at: {[r['checkpoint'] for r in touched] or 'nowhere'}",
         f"- mutations survived: {len(survived)}",
         f"- wall clock: {hms(elapsed)}", ""]
    if not_green:
        L += ["## Not green", "",
              "In replay mode the installed suite is known-good, so each of these is a FIXTURE",
              "defect, not a test defect (REFERENCE_CHAIN.md).", ""]
        for r in not_green:
            L.append(f"- **cp{r['checkpoint']:02d}** {r['checkpoint_id']} "
                     f"({r['gate']['failed_count']}/{r['gate']['total_selected']} failed)")
            for t in r["gate"]["failed"]:
                L.append(f"    - `{t}`")
        L.append("")
    if zero_wrong:
        L += ["## Mutation zero wrong", "",
              "The suite did not react as it must to the application without the change "
              "(or reacted when it should not, at a no-code checkpoint).", ""]
        for r in zero_wrong:
            z = next(m for m in r["mutations"] if m["kind"] == "zero")
            L.append(f"- cp{r['checkpoint']:02d}: killed={z['killed']} "
                     f"expected={z['expect_kill']}")
        L.append("")
    if survived:
        L += ["## Mutations that survived", "",
              "Each is a part of a change request that no test pins.", ""]
        L += [f"- cp{n:02d}: `{mid}`" for n, mid in survived]
        L.append("")
    capture.write_text(os.path.join(out_dir, "summary.md"), "\n".join(L) + "\n")
    print()
    print(BAR)
    print(f"done  {len(green)}/{len(rows)} green   wall clock {hms(elapsed)}")
    if not_green:
        print(f"  NOT GREEN at: {[r['checkpoint'] for r in not_green]}")
    if zero_wrong:
        print(f"  mutation zero WRONG at: {[r['checkpoint'] for r in zero_wrong]}")
    if touched:
        print(f"  APP CODE TOUCHED at: {[r['checkpoint'] for r in touched]}")
    print(f"  results/{args.run_id}/summary.md")
    print(BAR, flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
