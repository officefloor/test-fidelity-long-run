#!/usr/bin/env python3
"""The reference application: import it into this repo, and materialise it at a checkpoint.

The erosion harness's evolved chains live in the stack repos (~/officehq-*). Those are RECORDS
of completed runs and this harness must not touch them, so the application is imported ONCE,
read-only, into this repo as plain text it then owns:

    reference/base/           the application before cp01
    reference/cp01.patch      what cp01 changed  (its own code + its overrides of prior files)
    reference/cp02.patch      ...
    reference/manifest.yaml   source repo/branch/commit per checkpoint + patch digests

Materialising checkpoint N is `base` plus patches 1..N. The patch chain also makes the previous
checkpoint free: the application WITHOUT checkpoint N's feature is just one fewer patch, which is
the whole-feature mutation (DESIGN.md §5).

Two paths are EXCLUDED on import because they would hand the test-writing agent the answers:
`evolve-results/` (the erosion harness's capture — carries the reference specs' test titles and
failure text) and `e2e/specs/` (where it installed those specs; empty on the chain commits, but
excluded so it stays that way).

    tools/reference.py import --repo ~/officehq-tanstack-officefloor \
        --branch evolve/202610020135/just-solve/chain2
    tools/reference.py materialise --checkpoint 8 --out work/cp08
    tools/reference.py verify
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REFERENCE = os.path.join(ROOT, "reference")
REPAIRS = os.path.join(ROOT, "repairs")
EXCLUDE = ("evolve-results", "e2e/specs")
LAST = 60


def sh(args: list[str], **kw) -> str:
    return subprocess.run(args, capture_output=True, text=True, check=True, **kw).stdout


def pathspec() -> list[str]:
    return ["--", "."] + [f":(exclude){p}" for p in EXCLUDE]


def checkpoint_commit(repo: str, branch: str, n: int) -> str | None:
    """The commit holding the application at checkpoint N.

    The erosion harness writes two commits per checkpoint — `cpNN agent` then `cpNN reset`, the
    reset restoring pinned scaffolding the agent may have edited. The reset is the state it
    graded, so it is the state we want; some checkpoints have only the agent commit (an empty
    reset is not committed), so fall back to it."""
    for kind in ("reset", "agent"):
        out = sh(["git", "-C", repo, "log", "--format=%H", f"--grep=^cp{n:02d} {kind}",
                  branch]).split()
        if out:
            return out[0]          # newest first; one per checkpoint per kind
    return None


def first_commit(repo: str, branch: str, n: int) -> str | None:
    """The EARLIEST commit of checkpoint N — its `agent` commit where there is one.

    Distinct from checkpoint_commit(), which wants the last (graded) state. Only the base
    needs this: anchoring on the parent of cp01's *reset* commit would make the base cp01's
    own agent commit, i.e. a base that already implements cp01."""
    for kind in ("agent", "reset"):
        out = sh(["git", "-C", repo, "log", "--format=%H", f"--grep=^cp{n:02d} {kind}",
                  branch]).split()
        if out:
            return out[-1]
    return None


def base_commit(repo: str, branch: str) -> str:
    """The application before cp01 — the parent of cp01's earliest commit."""
    first = first_commit(repo, branch, 1)
    if not first:
        sys.exit("cannot locate cp01 to anchor the base")
    return sh(["git", "-C", repo, "rev-parse", f"{first}^"]).strip()


def source_origin(repo: str) -> str | None:
    """The `origin` remote of the source repo — how the chain is found again from anywhere."""
    r = subprocess.run(["git", "-C", repo, "remote", "get-url", "origin"],
                       capture_output=True, text=True)
    return r.stdout.strip() or None if r.returncode == 0 else None


def digest(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(65536), b""):
            h.update(block)
    return h.hexdigest()[:16]


def cmd_import(args) -> int:
    repo = os.path.expanduser(args.repo)
    if not os.path.isdir(os.path.join(repo, ".git")):
        sys.exit(f"not a git repo: {repo}")

    commits: dict[int, str] = {}
    for n in range(1, args.last + 1):
        c = checkpoint_commit(repo, args.branch, n)
        if c:
            commits[n] = c
    if 1 not in commits:
        sys.exit(f"no cp01 commit on {args.branch}")
    missing = [n for n in range(1, args.last + 1) if n not in commits]
    if missing:
        print(f"warning: no commit for checkpoints {missing}", file=sys.stderr)

    base = base_commit(repo, args.branch)
    if os.path.isdir(REFERENCE):
        shutil.rmtree(REFERENCE)
    os.makedirs(REFERENCE)

    # base snapshot, excluded paths dropped
    base_dir = os.path.join(REFERENCE, "base")
    os.makedirs(base_dir)
    tar = subprocess.run(["git", "-C", repo, "archive", base], capture_output=True, check=True)
    subprocess.run(["tar", "-x", "-C", base_dir], input=tar.stdout, check=True)
    for rel in EXCLUDE:
        victim = os.path.join(base_dir, rel)
        if os.path.isdir(victim):
            shutil.rmtree(victim)
        elif os.path.isfile(victim):
            os.remove(victim)

    # one patch per checkpoint, diffed against the previous checkpoint's commit
    # Provenance by REPO NAME and ORIGIN URL, not by the local path it happened to be cloned
    # to. A path like /home/<someone>/officehq-tanstack-officefloor says nothing to anyone else
    # and nothing to this machine a year from now; the origin is how the chain this fixture came
    # from is actually found again. Same reasoning as the erosion harness recording each stack's
    # `origin` alongside its chain branches.
    lines = [f"# Written by tools/reference.py import — DO NOT EDIT BY HAND.",
             f"# The application is imported read-only; the source repo is never modified.",
             f"source_repo: {os.path.basename(os.path.realpath(repo))}",
             f"source_origin: {source_origin(repo) or 'NONE'}",
             f"source_branch: {args.branch}",
             f"base_commit: {base}",
             f"excluded_paths: [{', '.join(EXCLUDE)}]",
             "checkpoints:"]
    prev = base
    for n in sorted(commits):
        patch = sh(["git", "-C", repo, "diff", prev, commits[n]] + pathspec())
        path = os.path.join(REFERENCE, f"cp{n:02d}.patch")
        with open(path, "w") as fh:
            fh.write(patch)
        files = sum(1 for ln in patch.splitlines() if ln.startswith("diff --git"))
        lines += [f"  - n: {n}",
                  f"    commit: {commits[n]}",
                  f"    patch: cp{n:02d}.patch",
                  f"    files_changed: {files}",
                  f"    sha256_16: {digest(path)}"]
        print(f"cp{n:02d}  {files:3d} files  {len(patch.splitlines()):6d} patch lines")
        prev = commits[n]
    with open(os.path.join(REFERENCE, "manifest.yaml"), "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"\nimported {len(commits)} checkpoints into {REFERENCE}")
    empty = [n for n in sorted(commits)
             if os.path.getsize(os.path.join(REFERENCE, f"cp{n:02d}.patch")) == 0]
    if empty:
        print(f"\nWARNING: no code change at checkpoint(s) {empty}. The chain does not implement "
              f"these requests, so they have no feature to remove and no behaviour to mutate — "
              f"they cannot be graded (DESIGN.md §3).")
    return 0


def load_manifest() -> dict:
    import yaml
    with open(os.path.join(REFERENCE, "manifest.yaml")) as fh:
        return yaml.safe_load(fh)


GIT_ID = ["-c", "user.name=test-fidelity-long-run", "-c", "user.email=harness@localhost"]


def load_repairs() -> dict:
    """repairs/manifest.yaml, or an empty set if there are none.

    Kept OUT of reference/: that directory is a faithful, re-importable copy of what the erosion
    run produced, and editing its patches would break both that claim and the digests. Repairs
    are a declared layer applied on top (see repairs/manifest.yaml for why each exists)."""
    path = os.path.join(REPAIRS, "manifest.yaml")
    if not os.path.isfile(path):
        return {"file": None, "repairs": []}
    import yaml
    with open(path) as fh:
        return yaml.safe_load(fh) or {"file": None, "repairs": []}


def repairs_for(n: int, manifest: dict | None = None) -> list[dict]:
    """The repairs that apply at checkpoint n. `until_checkpoint` is EXCLUSIVE — it is the
    checkpoint at which upstream fixes the defect itself."""
    man = manifest if manifest is not None else load_repairs()
    return [r for r in (man.get("repairs") or [])
            if r["from_checkpoint"] <= n < r["until_checkpoint"]]


def _repair_block(repair_id: str, which: str) -> str:
    with open(os.path.join(REPAIRS, f"{repair_id}.{which}.java")) as fh:
        return fh.read()


def apply_repairs(out: str, n: int, manifest: dict | None = None) -> list[str]:
    """Apply every in-range repair to the materialised tree. Exact-match substitution, so a
    repair either matches or raises — it cannot misapply against drifted context the way patch
    fuzz can. Returns the ids applied."""
    man = manifest if manifest is not None else load_repairs()
    due = repairs_for(n, man)
    if not due:
        return []
    target = os.path.join(out, man["file"])
    with open(target) as fh:
        src = fh.read()
    applied = []
    for r in due:
        find = _repair_block(r["id"], "find")
        replace = _repair_block(r["id"], "replace")
        if find not in src:
            raise RuntimeError(
                f"repair {r['id']} does not match at cp{n:02d}: its find block is absent from "
                f"{man['file']}. The block shape changed — narrow the repair's range and add a "
                f"variant for the new shape (see repairs/manifest.yaml, 001 vs 002).")
        if src.count(find) != 1:
            raise RuntimeError(f"repair {r['id']} matches {src.count(find)} times at cp{n:02d}; "
                               f"it must identify exactly one site")
        src = src.replace(find, replace)
        applied.append(r["id"])
    with open(target, "w") as fh:
        fh.write(src)
    return applied


def materialise(n: int, out: str) -> None:
    """base + patches 1..n (+ any in-range fixture repairs) into `out`, as its own git
    repository. n=0 gives the base.

    `out` is made a repository for two reasons. The practical one: `git apply` resolves paths
    against the enclosing repository root, and run from a subdirectory of one it silently
    ignores every path outside that subdirectory and still exits 0 — so materialising into a
    plain directory inside this repo applied nothing and reported success. Giving `out` its own
    repository makes its root the patch root.

    The useful one: the checkpoint-by-checkpoint history is what the test-writing agent sees of
    the code, and where its own test commits land (DESIGN.md §4) — the same view it would have
    in the pipeline, and what makes test-suite churn measurable (DESIGN.md §8)."""
    man = load_manifest()
    out = os.path.abspath(out)
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    shutil.copytree(os.path.join(REFERENCE, "base"), out)

    def git(*args: str) -> None:
        subprocess.run(["git", "-C", out] + GIT_ID + list(args), check=True,
                       capture_output=True, text=True)

    git("init", "-q")
    git("add", "-A")
    git("commit", "-q", "-m", "base application")
    for cp in man["checkpoints"]:
        if cp["n"] > n:
            break
        if cp["files_changed"] == 0:
            continue           # a checkpoint that changed no code — nothing to apply, and it
                               # gets no commit, so the history shows it as the no-op it was
        subprocess.run(["git", "-C", out, "apply", "--whitespace=nowarn",
                        os.path.join(REFERENCE, cp["patch"])], check=True,
                       capture_output=True, text=True)
        git("add", "-A")
        git("commit", "-q", "-m", f"cp{cp['n']:02d} reference code")

    # Repairs land AFTER every chain patch, never between them: a repaired intermediate tree
    # would conflict with the next upstream patch (cp36's own diff adds the very lines repair
    # 002 adds, against unrepaired context). One commit, so the fixture's history says plainly
    # what was changed and why.
    applied = apply_repairs(out, n)
    if applied:
        git("add", "-A")
        git("commit", "-q", "-m",
            "fixture repair: " + ", ".join(applied) + " (see repairs/manifest.yaml)")


def cmd_materialise(args) -> int:
    materialise(args.checkpoint, os.path.expanduser(args.out))
    print(f"checkpoint {args.checkpoint} materialised at {args.out}")
    return 0


def cmd_verify(args) -> int:
    """Every patch applies in order, and each patch digest matches the manifest."""
    man = load_manifest()
    bad = [cp for cp in man["checkpoints"]
           if digest(os.path.join(REFERENCE, cp["patch"])) != cp["sha256_16"]]
    if bad:
        sys.exit(f"patch digest mismatch: {[cp['patch'] for cp in bad]}")
    tmp = os.path.join(ROOT, "work", "verify")
    last = man["checkpoints"][-1]["n"]
    materialise(last, tmp)
    # Assert the result GREW. `git apply` can no-op and still exit 0 (see materialise), so a
    # clean exit is not evidence; count the commits and files it actually produced.
    commits = subprocess.run(["git", "-C", tmp, "rev-list", "--count", "HEAD"],
                             capture_output=True, text=True, check=True).stdout.strip()
    applied = sum(1 for cp in man["checkpoints"] if cp["files_changed"])
    files = sum(len(f) for _, _, f in os.walk(os.path.join(tmp, "src")))
    # base + one commit per non-empty patch, + one more if a fixture repair was due at `last`
    expect = applied + 1 + (1 if repairs_for(last) else 0)
    if int(commits) != expect:
        sys.exit(f"expected {expect} commits (base + applied patches + any repair commit), "
                 f"got {commits}")
    print(f"ok: {len(man['checkpoints'])} patches apply in order up to cp{last:02d}, "
          f"digests match, {commits} commits, {files} source files at cp{last:02d}")
    shutil.rmtree(tmp, ignore_errors=True)
    return 0


def cmd_verify_repairs(args) -> int:
    """Every repair matches at EVERY checkpoint in its range, and nowhere outside it.

    The range is the fragile part: a repair is an exact-match substitution against a block of
    code that other checkpoints also edit, so a range that outlives the block's shape would
    raise mid-run. Checking the whole union up front turns that into a one-command answer.

    Also asserts the repair is NOT needed at `until_checkpoint` — i.e. upstream really does fix
    it there — so a range is never longer than the defect."""
    man = load_repairs()
    if not man.get("repairs"):
        print("no repairs declared")
        return 0
    lo = min(r["from_checkpoint"] for r in man["repairs"])
    hi = max(r["until_checkpoint"] for r in man["repairs"])
    tmp = os.path.join(ROOT, "work", "verify-repairs")
    failures: list[str] = []
    for n in range(lo, hi + 1):
        due = repairs_for(n, man)
        try:
            materialise(n, tmp)                    # raises if an in-range repair cannot apply
        except RuntimeError as e:
            failures.append(f"cp{n:02d}: {e}")
            continue
        target = os.path.join(tmp, man["file"])
        with open(target) as fh:
            text = fh.read()
        for r in due:
            # the replacement is in place
            if _repair_block(r["id"], "replace") not in text:
                failures.append(f"cp{n:02d}: {r['id']} applied but its text is absent")
        if n == hi:
            # at `until`, upstream should already honour it: the un-repaired form must be gone
            for r in man["repairs"]:
                if r["until_checkpoint"] == n and _repair_block(r["id"], "find") in text:
                    failures.append(
                        f"cp{n:02d}: {r['id']} ends here but upstream has NOT fixed it — the "
                        f"range is too short")
        print(f"  cp{n:02d}  {len(due)} repair(s) applied" + ("" if due else "  (none due)"))
    shutil.rmtree(tmp, ignore_errors=True)
    if failures:
        print("\nFAILED:")
        for f in failures:
            print(f"  {f}")
        return 1
    print(f"\nok: {len(man['repairs'])} repair(s) apply at every checkpoint in range "
          f"(cp{lo:02d}..cp{hi - 1:02d}), and upstream has fixed each by its `until`")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("import", help="import the reference chain into reference/")
    p.add_argument("--repo", required=True)
    p.add_argument("--branch", required=True)
    p.add_argument("--last", type=int, default=LAST)
    p.set_defaults(fn=cmd_import)
    p = sub.add_parser("materialise", help="build the application at a checkpoint")
    p.add_argument("--checkpoint", type=int, required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_materialise)
    p = sub.add_parser("verify", help="patches apply in order and match their digests")
    p.set_defaults(fn=cmd_verify)
    p = sub.add_parser("verify-repairs",
                       help="every fixture repair matches at every checkpoint in its range")
    p.set_defaults(fn=cmd_verify_repairs)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
