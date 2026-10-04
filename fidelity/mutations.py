"""The mutation catalogue: load, apply, validate (DESIGN.md §6).

A mutation is an exact-match text substitution in one file of the reference application, breaking
exactly one aspect of one change request's behaviour.

**Why substitutions rather than patches.** The `repairs/` layer started as patches and the
lesson carried: a unified diff applies against surrounding CONTEXT, so it can land in the wrong
place, apply with fuzz, or silently no-op when a neighbouring line moves. A substitution either
matches exactly once or it raises — and `validate` can check all of that without building
anything. For a catalogue of a couple of hundred edits across 60 versions of one codebase, that
difference is the whole maintainability of the thing.

Each mutation names its `clause` — the fragment of the plain-English request it breaks — so the
kill rate reads as "how much of what the user asked for does this suite hold" rather than "how
much of this codebase does it touch".
"""
from __future__ import annotations

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOGUE = os.path.join(ROOT, "mutations")


def manifest_path(n: int) -> str:
    return os.path.join(CATALOGUE, f"cp{n:02d}.yaml")


def load(n: int) -> dict:
    """The mutation set for checkpoint n, or an empty set. Absent is normal: a checkpoint with no
    set is reported as having none rather than scoring zero, and mutation zero needs no set."""
    import yaml
    path = manifest_path(n)
    if not os.path.isfile(path):
        return {"checkpoint": n, "calibrated": False, "mutations": []}
    with open(path) as fh:
        man = yaml.safe_load(fh) or {}
    man.setdefault("checkpoint", n)
    man.setdefault("mutations", [])
    for m in man["mutations"]:
        m["_calibrated"] = bool(man.get("calibrated"))
    return man


def applicable(n: int) -> list[dict]:
    """The mutations that apply AT checkpoint n. `from_checkpoint` lets a mutation describe
    behaviour that only becomes observable later than the checkpoint that introduced it."""
    man = load(n)
    return [m for m in man["mutations"]
            if n >= int(m.get("from_checkpoint") or n)]


def apply(tree: str, mutation: dict) -> None:
    """Apply one mutation to a materialised tree. Raises unless it matches EXACTLY once —
    zero means the code moved and the mutation is stale, more than one means it is not
    identifying a single site and the kill it earns would be ambiguous."""
    target = os.path.join(tree, mutation["file"])
    if not os.path.isfile(target):
        raise RuntimeError(f"{mutation['id']}: {mutation['file']} does not exist in this "
                           f"checkpoint's application")
    with open(target) as fh:
        src = fh.read()
    find, replace = mutation["find"], mutation["replace"]
    hits = src.count(find)
    if hits != 1:
        raise RuntimeError(
            f"{mutation['id']}: its `find` matches {hits} times in {mutation['file']} "
            f"(must be exactly 1). "
            + ("The code changed — re-author it against this checkpoint."
               if hits == 0 else "Extend `find` with more surrounding lines to pin one site."))
    with open(target, "w") as fh:
        fh.write(src.replace(find, replace))


def validate(n: int, tree: str) -> list[str]:
    """Apply each of checkpoint n's mutations to a throwaway copy of `tree`, one at a time.
    Returns the problems found; empty means every mutation in the set is applicable.

    This is the cheap half of making a catalogue trustworthy — no build, no browser. The other
    half is behavioural and belongs to replay mode: a mutation that applies but that the
    experimenter's own known-good suite cannot kill is a bad mutation or a hole in that suite
    (DESIGN.md §6)."""
    import shutil
    import tempfile
    problems: list[str] = []
    for m in applicable(n):
        tmp = tempfile.mkdtemp(prefix="mutval-")
        try:
            work = os.path.join(tmp, "t")
            shutil.copytree(tree, work, symlinks=True)
            try:
                apply(work, m)
            except RuntimeError as e:
                problems.append(str(e))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    return problems


def mark_calibrated(n: int, killed_all: bool) -> bool:
    """Record whether checkpoint n's set is calibrated, i.e. whether the KNOWN-GOOD suite killed
    every mutation in it (DESIGN.md §6).

    Written back by a replay run with --calibrate rather than edited by hand: `calibrated` gates
    grading, and with 60 manifests the alternative is an unmaintainable ritual that would quietly
    be skipped. Only replay may set it — in agent mode the suite is the thing under test, so what
    it kills says nothing about whether the mutation is any good."""
    path = manifest_path(n)
    if not os.path.isfile(path):
        return False
    with open(path) as fh:
        text = fh.read()
    want = f"calibrated: {'true' if killed_all else 'false'}"
    for old in ("calibrated: false", "calibrated: true"):
        if old in text:
            if old == want:
                return False
            with open(path, "w") as fh:
                fh.write(text.replace(old, want, 1))
            return True
    return False
