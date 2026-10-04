"""What changed in a checkpoint: did the agent touch application code, and which tests moved.

Two questions the run has to answer about every agent turn, because neither is visible in the
pass/fail numbers:

  * did it modify the application? It was told not to. A run that did is void, and silently
    grading it would credit the agent for a test that passes only because it changed the subject.
  * what did it do to the suite? A checkpoint that goes green by DELETING the test that was
    failing is the cheap way out, and is exactly what must not happen across 500 changes
    (DESIGN.md §5 step 3). "+1 file" does not distinguish that from honest work.

Test-level movement is reported two ways. Statically, by parsing titles out of the spec files —
available before anything is built, and it attributes each test to a file. Authoritatively, by
diffing the test ids Playwright actually collected against the previous checkpoint's — exact, but
only available once the gate has run.
"""
from __future__ import annotations

import os
import re
import subprocess

# `test('title', { tag: '@core' }, async ({ page }) => {` — `test.describe(` is excluded by the
# `\s*test\s*\(` shape, which will not match `test.describe(`.
# The title body must allow BACKSLASH ESCAPES: `test('lists a client\'s contacts', ...)` is real
# in these specs, and a plain `(.+?)` stops at the escaped quote and silently truncates the id.
TEST_RE = re.compile(r"""^\s*test\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1""", re.M)
_UNESCAPE = re.compile(r"\\(.)")


def git(tree: str, *args: str) -> str:
    return subprocess.run(["git", "-C", tree] + list(args),
                          capture_output=True, text=True, check=True).stdout


def parse_tests(path: str) -> list[str]:
    """`<basename>::<title>` for each test in a spec file.

    Deliberately NOT `basename::describe > title`: that is what the id shape looks like it should
    be, but Playwright's spec.titlePath for these specs does not carry the describe, so the ids
    the gate actually produces are `cp05_invoice_pay_audit.spec.ts::marking an invoice paid
    updates its status`. Matching the gate exactly is the point — these ids are compared against
    it, and a parser that invented a different shape would report every test as both added and
    removed."""
    base = os.path.basename(path)
    with open(path) as fh:
        text = fh.read()
    return [f"{base}::{_UNESCAPE.sub(r'\1', m.group(2))}" for m in TEST_RE.finditer(text)]


def suite_tests(specs_dir: str) -> dict[str, list[str]]:
    """{spec basename -> test ids} for every spec file present."""
    if not os.path.isdir(specs_dir):
        return {}
    return {fn: parse_tests(os.path.join(specs_dir, fn))
            for fn in sorted(os.listdir(specs_dir)) if fn.endswith(".spec.ts")}


def working_changes(tree: str, specs_subpath: str) -> dict[str, list[str]]:
    """Uncommitted changes in `tree`, split into the suite and everything else.

    `app` is the answer to "did it change the application" — anything outside the specs
    directory, which includes the build scripts and the support helpers it was told to leave
    alone."""
    status = git(tree, "status", "--porcelain")
    suite: list[str] = []
    app: list[str] = []
    for line in status.splitlines():
        if not line.strip():
            continue
        code, _, path = line[:2], line[2], line[3:].strip()
        path = path.split(" -> ")[-1].strip('"')
        entry = f"{code.strip() or '??'} {path}"
        (suite if path.startswith(specs_subpath.rstrip('/') + "/") else app).append(entry)
    return {"suite": suite, "app": app}


def file_delta(before: dict[str, list[str]], after: dict[str, list[str]]) -> dict[str, list[str]]:
    b, a = set(before), set(after)
    changed = sorted(f for f in (b & a) if before[f] != after[f])
    return {"added": sorted(a - b), "removed": sorted(b - a), "modified": changed}


def test_delta(before: dict[str, list[str]], after: dict[str, list[str]]) -> dict[str, list[str]]:
    """Added / removed / (file,kept) test ids across the whole suite."""
    b = {t for ts in before.values() for t in ts}
    a = {t for ts in after.values() for t in ts}
    return {"added": sorted(a - b), "removed": sorted(b - a)}


def classify_test_moves(before: dict[str, list[str]],
                        after: dict[str, list[str]]) -> dict[str, list]:
    """Separate a test that was REVISED from one that was DROPPED.

    Both show up as "an id disappeared", and conflating them is the difference between the
    maintenance discipline working and the cheap way out. A mutative checkpoint legitimately
    replaces a prior test with a retitled one asserting the new behaviour — in the same file,
    one out and one in. Deleting the failing test to make a round go green is the thing that
    must not happen across 500 changes (DESIGN.md §5 step 3), and it looks different: the id
    goes and nothing takes its place, or the whole file goes.

    Returns, per category:
      added      a genuinely new test, in a new or existing file
      revised    (file, gone, arrived) — an id replaced within a file that kept its test count
      dropped    (file, id) — the id went and nothing replaced it in that file
      file_gone  (file, id) — the whole spec file was removed
    """
    out: dict[str, list] = {"added": [], "revised": [], "dropped": [], "file_gone": []}
    for f in sorted(set(before) | set(after)):
        b, a = list(before.get(f) or []), list(after.get(f) or [])
        gone, arrived = [x for x in b if x not in a], [x for x in a if x not in b]
        if f not in after:
            out["file_gone"] += [(f, x) for x in gone]
            continue
        # pair them off positionally: within one file a retitled test keeps its place
        for i, g in enumerate(gone):
            if i < len(arrived):
                out["revised"].append((f, g, arrived[i]))
            else:
                out["dropped"].append((f, g))
        out["added"] += arrived[len(gone):]
    return out


def id_delta(before_ids: set[str], after_ids: set[str]) -> dict[str, list[str]]:
    """The authoritative version of test_delta, over ids Playwright actually collected."""
    return {"added": sorted(after_ids - before_ids), "removed": sorted(before_ids - after_ids)}


def diff_text(tree: str, paths: list[str] | None = None, staged: bool = False) -> str:
    args = ["diff", "--cached"] if staged else ["diff"]
    if paths:
        args += ["--"] + paths
    return git(tree, *args)
