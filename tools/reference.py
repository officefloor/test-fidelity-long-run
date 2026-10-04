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
    lines = [f"# Written by tools/reference.py import — DO NOT EDIT BY HAND.",
             f"# The application is imported read-only; the source repo is never modified.",
             f"source_repo: {args.repo}",
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


def materialise(n: int, out: str) -> None:
    """base + patches 1..n into `out`, as its own git repository. n=0 gives the base.

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
    if int(commits) != applied + 1:
        sys.exit(f"expected {applied + 1} commits (base + applied patches), got {commits}")
    print(f"ok: {len(man['checkpoints'])} patches apply in order up to cp{last:02d}, "
          f"digests match, {commits} commits, {files} source files at cp{last:02d}")
    shutil.rmtree(tmp, ignore_errors=True)
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
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
