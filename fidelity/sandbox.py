"""The confined area the test-writing agent works in (DESIGN.md §4.1).

Built fresh each checkpoint and holding only four things: the application as it stands BEFORE
this change request, the e2e scaffolding, the agent's own accumulated suite WITH its git history,
and the checkpoint specification.

Two details that are load-bearing rather than incidental:

* **The application copy carries no `.git`.** The materialised reference tree has one commit per
  checkpoint, messaged "cp24 reference code" — which states the checkpoint number outright. Any
  agent that runs `git log` would learn exactly where it is in a sequence it is supposed to know
  nothing about. The app is copied as plain files, so the only git repository in the sandbox is
  the suite's, and the only history the agent can read is its own tests'.

* **The suite IS a git repository, rooted at `e2e/specs`.** That is what makes "see the history of
  all tests" true rather than approximately true: the agent can read the log of its own work, as
  it would in the pipeline. It is a clone, so nothing it does to that history reaches the run's
  real suite until the copy-back step takes the files.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess

GIT_ID = ["-c", "user.name=test-fidelity-long-run", "-c", "user.email=harness@localhost"]

# Never copied into the sandbox: build output, dependency caches and runtime scratch. Excluded
# for speed and because a stale target/ would let the agent run a build it did not produce.
APP_EXCLUDE = (".git", "node_modules", "target", ".run", "dist", "evolve-results")

# The stack's own documentation DESCRIBES THE EXPERIMENT, so it cannot go in the sandbox.
# BASE_CHECKLIST.md is the worst of them — "one full-stack English change request per
# checkpoint", "cp01 adds V1__*.sql", and an explanation of what would swamp the erosion
# metrics. README.md and stack.yaml name the harness and the checkpoint sequence. An agent that
# reads any of them knows it is one step of a numbered run, which is exactly the thing being
# withheld. CLAUDE.md and AGENTS.md stay: they are the stack's conventions, and carry no
# reference to the harness or the sequence (checked, not assumed).
DOC_EXCLUDE = ("README.md", "BASE_CHECKLIST.md", "stack.yaml")

# Put into an area by the harness for a §4.4 condition, never by the agent: the second author's
# draft under write-twice, and the draft handed to a prompter-proxy to read. Neither is
# application code nor the graded suite, so app_diff must not read them as the agent having
# touched the application, and leak_scan must not flag spec filenames it already knows about.
AUX_EXCLUDE = ("second-draft", "draft-suite")

# What a leak looks like in any file that did make it in, split by how much it actually gives
# away. HARD names a specific checkpoint or the harness itself — that is a position in the
# sequence, or a path to the answers. SOFT only reveals that a checkpointed run exists, which a
# few comments in the stack's own base scaffolding have said since before this harness existed;
# worth recording, not worth refusing a run over.
LEAK_HARD = re.compile(r"cp\d{2}|ui-long-degradation-test|test-fidelity-long-run"
                       r"|acceptance/specs", re.IGNORECASE)
LEAK_SOFT = re.compile(r"checkpoint|erosion|degradation", re.IGNORECASE)
SCAN_EXT = (".md", ".yaml", ".yml", ".txt", ".json", ".ts", ".tsx", ".java", ".sql", ".xml")


def git(tree: str, *args: str, check: bool = True) -> str:
    return subprocess.run(["git", "-C", tree] + GIT_ID + list(args),
                          capture_output=True, text=True, check=check).stdout


def init_suite_repo(path: str, branch: str) -> None:
    """The run's accumulated suite: its own repository, one commit per checkpoint. This is the
    history §8 measures and the history the agent reads."""
    os.makedirs(path, exist_ok=True)
    if os.path.isdir(os.path.join(path, ".git")):
        return
    subprocess.run(["git", "-C", path, "init", "-q", "-b", branch], check=True,
                   capture_output=True, text=True)
    with open(os.path.join(path, ".gitkeep"), "w") as fh:
        fh.write("")
    git(path, "add", "-A")
    git(path, "commit", "-q", "-m", "empty suite")


def spec_files(path: str) -> list[str]:
    if not os.path.isdir(path):
        return []
    return sorted(f for f in os.listdir(path) if f.endswith(".spec.ts"))


def build_sandbox(*, sandbox: str, app_tree: str, suite_repo: str, specs_rel: str) -> None:
    """Assemble the confined area. `app_tree` is the materialised cp(N-1) reference."""
    if os.path.isdir(sandbox):
        shutil.rmtree(sandbox)
    os.makedirs(os.path.dirname(os.path.abspath(sandbox)) or ".", exist_ok=True)
    shutil.copytree(app_tree, sandbox,
                    ignore=shutil.ignore_patterns(*(APP_EXCLUDE + DOC_EXCLUDE)))

    # the suite, as a repository, where Playwright expects the specs
    dest = os.path.join(sandbox, specs_rel)
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    subprocess.run(["git", "clone", "-q", suite_repo, dest], check=True,
                   capture_output=True, text=True)
    # a clone keeps an `origin` pointing into the run directory, which is outside the
    # confinement allowlist; drop it so nothing in the sandbox references a denied path
    subprocess.run(["git", "-C", dest, "remote", "remove", "origin"], check=False,
                   capture_output=True, text=True)


def copy_back(*, sandbox: str, suite_repo: str, specs_rel: str) -> dict[str, list[str]]:
    """Take the agent's spec files into the run's suite. ONLY `*.spec.ts`, and only from the
    specs directory — the agent is not able to add a file elsewhere in the suite, and anything
    it changed outside the specs directory is a violation to report (fidelity.changes), never
    something to carry forward."""
    src = os.path.join(sandbox, specs_rel)
    before = set(spec_files(suite_repo))
    after = set(spec_files(src))
    for fn in before - after:
        os.remove(os.path.join(suite_repo, fn))
    for fn in after:
        shutil.copy2(os.path.join(src, fn), os.path.join(suite_repo, fn))
    return {"added": sorted(after - before), "removed": sorted(before - after),
            "present": sorted(after)}


def commit_suite(suite_repo: str, message: str) -> tuple[str, str]:
    """Commit the suite as it now stands. Returns (sha, diff) — the diff BEFORE committing is
    what shows the checkpoint's test changes, so it is captured here."""
    # Stage FIRST, then diff the index. `git diff HEAD` on an unstaged tree omits untracked
    # files entirely, so a checkpoint whose whole contribution is a NEW spec file captured an
    # empty diff — exactly the checkpoints where the diff matters most.
    git(suite_repo, "add", "-A")
    diff = subprocess.run(["git", "-C", suite_repo, "diff", "--cached", "HEAD"],
                          capture_output=True, text=True).stdout
    subprocess.run(["git", "-C", suite_repo] + GIT_ID + ["commit", "-q", "-m", message],
                   check=False, capture_output=True, text=True)
    sha = git(suite_repo, "rev-parse", "HEAD").strip()
    return sha, diff


def build_proxy_area(*, area: str, app_tree: str, draft_specs: str | None,
                     draft_rel: str = "draft-suite") -> int:
    """The prompter-proxy's own confined area (DESIGN.md §4.5).

    It holds cpN — the proxy is the knowledgeable owner, so it is allowed the answer the author is
    denied — and, when it is reviewing, the author's draft to read. What it must NOT hold is the
    reference tests: grounded in the implementation a proxy describes behaviour, grounded in the
    tests it would speak in the tests' vocabulary and leak assertions by reflex. They are withheld
    structurally, by never being put here and by the same sentinel the author's turn uses, not by
    asking the proxy not to look.

    `.git` goes for the reason it goes from the author's area (§11.1): the reference tree's
    commits are messaged `cp30 reference code`, and nothing needs to read the checkpoint number
    off a log. Returns the number of draft spec files placed."""
    if os.path.isdir(area):
        shutil.rmtree(area)
    os.makedirs(os.path.dirname(os.path.abspath(area)) or ".", exist_ok=True)
    shutil.copytree(app_tree, area,
                    ignore=shutil.ignore_patterns(*(APP_EXCLUDE + DOC_EXCLUDE)))
    n = 0
    if draft_specs:
        dest = os.path.join(area, draft_rel)
        os.makedirs(dest, exist_ok=True)
        for fn in spec_files(draft_specs):
            shutil.copy2(os.path.join(draft_specs, fn), os.path.join(dest, fn))
            n += 1
    return n


def place_second_draft(*, sandbox: str, draft_specs: str, rel: str = "second-draft") -> int:
    """The other author's draft, for the write-twice reconciliation turn. Outside the specs
    directory on purpose: `copy_back` takes only `specs_rel/*.spec.ts`, so a file left here
    cannot reach the graded suite by being forgotten about."""
    dest = os.path.join(sandbox, rel)
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(dest, exist_ok=True)
    n = 0
    for fn in spec_files(draft_specs):
        shutil.copy2(os.path.join(draft_specs, fn), os.path.join(dest, fn))
        n += 1
    return n


def bundle_specs(specs_dir: str) -> str:
    """Every spec in one readable text, delimited by filename.

    A §4.4 condition can produce a suite that is never committed — both of write-twice's drafts
    are overwritten or discarded by the reconciliation — and a draft that existed, was graded
    against nothing, and informed the final suite is exactly the irreproducible material a record
    exists to keep. Text rather than a copied tree, so it travels in the capture like everything
    else."""
    out = []
    for fn in spec_files(specs_dir):
        with open(os.path.join(specs_dir, fn), errors="replace") as fh:
            out.append(f"===== {fn} =====\n{fh.read().rstrip()}\n")
    return "\n".join(out) or "(no spec files)\n"


def diff_specs(left: dict[str, bytes], right_dir: str, lname="before",
               rname="after") -> str:
    """Unified diff from a snapshot to what is on disk now. Used two ways: what one draft holds
    that the other does not, and what a turn briefed NOT to write tried to write anyway."""
    import difflib
    out: list[str] = []
    for fn in sorted(set(left) | set(spec_files(right_dir))):
        a = (left.get(fn) or b"").decode(errors="replace").splitlines(keepends=True)
        path = os.path.join(right_dir, fn)
        b = (open(path, errors="replace").read().splitlines(keepends=True)
             if os.path.exists(path) else [])
        if a == b:
            continue
        out += list(difflib.unified_diff(a, b, f"{lname}/{fn}", f"{rname}/{fn}"))
    return "".join(out)


def snapshot_specs(specs_dir: str) -> dict[str, bytes]:
    """The draft as it stands, so a turn that is only meant to CRITIQUE cannot change it."""
    return {fn: open(os.path.join(specs_dir, fn), "rb").read()
            for fn in spec_files(specs_dir)}


def restore_specs(specs_dir: str, snap: dict[str, bytes]) -> list[str]:
    """Put the draft back, and report what the turn had altered. A reviewer that edits is not a
    disaster — it is a reviewer that did not follow its brief — but it must not be able to do so
    silently, or a critique turn would quietly become a second authoring turn."""
    changed = []
    for fn in sorted(set(snap) | set(spec_files(specs_dir))):
        path = os.path.join(specs_dir, fn)
        want = snap.get(fn)
        have = open(path, "rb").read() if os.path.exists(path) else None
        if want == have:
            continue
        changed.append(fn)
        if want is None:
            os.remove(path)
        else:
            with open(path, "wb") as fh:
                fh.write(want)
    return changed


def app_diff(pristine: str, sandbox: str, specs_rel: str) -> str:
    """What the agent changed in the application. It was told to write tests only, so this must
    be empty; a run where it is not is void (DESIGN.md §4.1), and the diff is the evidence.

    Compared against the pristine materialised tree rather than via git, because the sandbox
    deliberately has no repository for the application."""
    # DOC_EXCLUDE must be skipped too: those files are in the pristine tree and deliberately
    # absent from the sandbox, so without this every checkpoint reports "Only in pristine:
    # README.md" and is flagged as having touched the application.
    excl = []
    for pat in APP_EXCLUDE + DOC_EXCLUDE + AUX_EXCLUDE + (os.path.basename(specs_rel),):
        excl += ["--exclude", pat]
    r = subprocess.run(["diff", "-ru"] + excl + [pristine, sandbox],
                       capture_output=True, text=True)
    return r.stdout


def leak_scan(sandbox: str, specs_rel: str, max_hits: int = 60) -> dict[str, list[str]]:
    """Anything in the sandbox that names the harness, the sequence, or a checkpoint.

    Fail-closed, in the spirit of the erosion harness's spec neutralisation: the deny list and
    the doc exclusions above are reasoning about what SHOULD be absent, and this checks what IS.
    A new checkpoint, a changed stack doc or an agent-authored file can reintroduce a leak that
    no allowlist would catch.

    The agent's own suite is skipped: it wrote those files, their names carry cpNN by
    construction, and it already knows what it wrote."""
    hits: dict[str, list[str]] = {"hard": [], "soft": []}
    specs_abs = os.path.join(sandbox, specs_rel)
    for root, dirs, files in os.walk(sandbox):
        dirs[:] = [d for d in dirs if d not in APP_EXCLUDE + AUX_EXCLUDE]
        if os.path.abspath(root).startswith(os.path.abspath(specs_abs)):
            continue
        for fn in files:
            if not fn.endswith(SCAN_EXT):
                continue
            path = os.path.join(root, fn)
            try:
                with open(path, errors="replace") as fh:
                    for i, line in enumerate(fh, 1):
                        kind = ("hard" if LEAK_HARD.search(line)
                                else "soft" if LEAK_SOFT.search(line) else None)
                        if kind:
                            rel = os.path.relpath(path, sandbox)
                            hits[kind].append(f"{rel}:{i}: {line.strip()[:120]}")
                            if len(hits["hard"]) + len(hits["soft"]) >= max_hits:
                                return hits
                            break          # one hit per file is enough to flag it
            except OSError:
                continue
    return hits
