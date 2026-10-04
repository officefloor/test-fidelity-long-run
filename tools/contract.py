#!/usr/bin/env python3
"""The INTERFACE CONTRACT per checkpoint: the data-testids and audit records the reference
application exposes, so a generated test binds to the implementation instead of guessing.

The erosion harness could leave this implicit — the experimenter wrote both the spec and the
anchors, so they agreed by construction. Here the agent writes the test against code it did not
write, and a test is only as good as its anchors: `getByTestId('client-list')` against an
implementation that renders `clients-table` fails for a reason that says nothing about whether the
agent understood the change request. So the contract is extracted from the reference code and
handed to the agent as part of the checkpoint specification (DESIGN.md §4).

Extracted per checkpoint, from the git history that `reference.py materialise` builds:

    contracts/cp08.yaml     new:       anchors this checkpoint introduces
                            available: every anchor in the application at this point
                            audit:     audit record formats, same split

`--check` validates extraction against the erosion harness's own specs: every testid those specs
use must appear in the contract at or before their checkpoint. A miss means the extractor's
patterns are incomplete, which would silently hand the agent a short contract. It reads those
specs offline, for calibration only — they are never shown to the agent (DESIGN.md §7).

    tools/contract.py build
    tools/contract.py check --harness ~/ui-long-degradation-test
    tools/contract.py show --checkpoint 8
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import reference  # noqa: E402

ROOT = reference.ROOT
CONTRACTS = os.path.join(ROOT, "contracts")

# data-testid="foo"  |  data-testid={`foo-${x.id}`}
STATIC = re.compile(r'data-testid="([^"]+)"')
DYNAMIC = re.compile(r'data-testid=\{`([^`]+)`\}')
# audit.record("INVOICE_PAID id=" + id + " amount=" + amount) — the whole argument expression,
# which must start with a string literal naming the record type.
AUDIT = re.compile(r'record\(\s*("[A-Z][A-Z_]+[^;]*?)\)\s*;', re.S)
LITERAL = re.compile(r'"([^"]*)"')
INTERP = re.compile(r"\$\{([^}]+)\}")
SPEC_TESTID = re.compile(r"""getByTestId\(\s*['"]([^'"]+)['"]""")
SPEC_TESTID_RE = re.compile(r"getByTestId\(\s*/\^?([a-z0-9-]+)")
# An audit assertion in a spec: toContain('INVOICE_PAID id=1 amount=100.00'). At least one
# `field=value` is required, because a bare upper-case literal is a STATUS asserted in UI text
# (`toHaveText('UNPAID')`) — matching those reported dozens of phantom missing records.
SPEC_AUDIT = re.compile(r"""['"]([A-Z][A-Z_]{2,}(?: [A-Za-z0-9_]+=[^'"\s]*)+)['"]""")


def placeholder(expr: str) -> str:
    """`${client.id}` -> `<id>`, `${row.currency}` -> `<currency>` — the anchor's SHAPE, which is
    what a test needs; the concrete value comes from the data the test seeds."""
    name = expr.strip().split(".")[-1].strip()
    name = re.sub(r"[^A-Za-z0-9_]", "", name) or "value"
    return f"<{name}>"


def normalise_testid(raw: str) -> str:
    return INTERP.sub(lambda m: placeholder(m.group(1)), raw)


def normalise_audit(args: str) -> str:
    """`"INVOICE_PAID id=" + saved.getId() + " amount=" + amount` -> `INVOICE_PAID id=<id>
    amount=<amount>`.

    The record is a Java string concatenation: quoted literals carry the record type and the
    field names, and the expressions between them are the values. So walk the literals in order
    and, wherever a non-empty expression follows one, emit a placeholder named from that
    literal's trailing `field=` — which is where the field name always sits."""
    pieces: list[str] = []
    cursor = 0
    for m in LITERAL.finditer(args):
        gap = args[cursor:m.start()].strip(" +\t\n")
        if gap and pieces:
            pieces.append(field_placeholder(pieces[-1]))
        pieces.append(m.group(1))
        cursor = m.end()
    if args[cursor:].strip(" +\t\n") and pieces:
        pieces.append(field_placeholder(pieces[-1]))
    return " ".join("".join(pieces).split())


def field_placeholder(preceding_literal: str) -> str:
    """`" amount="` -> `<amount>`; a literal with no `field=` -> `<value>`."""
    tail = preceding_literal.rstrip()
    if not tail.endswith("="):
        return "<value>"
    token = tail[:-1].split()[-1] if tail[:-1].split() else "value"
    return f"<{re.sub(r'[^A-Za-z0-9_]', '', token) or 'value'}>"


def grep(repo: str, rev: str, pattern: str, glob: str) -> list[str]:
    r = subprocess.run(["git", "-C", repo, "grep", "-I", "-h", "-o", "-E", pattern, rev,
                        "--", glob], capture_output=True, text=True)
    return r.stdout.splitlines() if r.returncode in (0, 1) else []


def extract(repo: str, rev: str) -> tuple[set[str], set[str]]:
    testids: set[str] = set()
    for line in grep(repo, rev, r'data-testid="[^"]+"', "*.tsx"):
        m = STATIC.search(line)
        if m:
            testids.add(normalise_testid(m.group(1)))
    for line in grep(repo, rev, r'data-testid=\{`[^`]+`\}', "*.tsx"):
        m = DYNAMIC.search(line)
        if m:
            testids.add(normalise_testid(m.group(1)))

    audits: set[str] = set()
    for line in grep(repo, rev, r'record\("[A-Z][A-Z_]+[^;]*\);', "*.java"):
        m = AUDIT.search(line)
        if m:
            audits.add(normalise_audit(m.group(1)))
    return testids, audits


def revisions(repo: str) -> dict[int, str]:
    out = subprocess.run(["git", "-C", repo, "log", "--format=%H %s", "--reverse"],
                         capture_output=True, text=True, check=True).stdout.splitlines()
    revs: dict[int, str] = {}
    for line in out:
        sha, _, subject = line.partition(" ")
        m = re.match(r"cp(\d+) reference code", subject)
        if m:
            revs[int(m.group(1))] = sha
    return revs


def cmd_build(args) -> int:
    man = reference.load_manifest()
    last = man["checkpoints"][-1]["n"]
    work = os.path.join(ROOT, "work", "contract")
    reference.materialise(last, work)
    revs = revisions(work)

    os.makedirs(CONTRACTS, exist_ok=True)
    seen_t: set[str] = set()
    seen_a: set[str] = set()
    for cp in man["checkpoints"]:
        n = cp["n"]
        if n not in revs:
            # a checkpoint that changed no code has no commit: the contract is the prior one
            new_t, new_a = set(), set()
            cur_t, cur_a = set(seen_t), set(seen_a)
        else:
            cur_t, cur_a = extract(work, revs[n])
            new_t, new_a = cur_t - seen_t, cur_a - seen_a
        lines = [f"# Interface contract at checkpoint {n}. Generated by tools/contract.py.",
                 f"# Handed to the test-writing agent with the change request so its anchors",
                 f"# match the implementation (DESIGN.md §4). Do not edit by hand.",
                 f"checkpoint: {n}",
                 f"no_code_change: {str(n not in revs).lower()}",
                 "new_testids:"] + [f"  - {t}" for t in sorted(new_t)]
        lines += ["new_audit_records:"] + [f"  - {a!r}" for a in sorted(new_a)]
        lines += ["available_testids:"] + [f"  - {t}" for t in sorted(cur_t)]
        lines += ["available_audit_records:"] + [f"  - {a!r}" for a in sorted(cur_a)]
        with open(os.path.join(CONTRACTS, f"cp{n:02d}.yaml"), "w") as fh:
            fh.write("\n".join(lines) + "\n")
        flag = "  (no code change)" if n not in revs else ""
        print(f"cp{n:02d}  +{len(new_t):2d} testids  +{len(new_a)} audit  "
              f"({len(cur_t)} available){flag}")
        seen_t, seen_a = cur_t | seen_t, cur_a | seen_a
    shutil.rmtree(work, ignore_errors=True)
    print(f"\nwrote {len(man['checkpoints'])} contracts to {CONTRACTS}")
    return 0


def load_contract(n: int) -> dict:
    import yaml
    with open(os.path.join(CONTRACTS, f"cp{n:02d}.yaml")) as fh:
        return yaml.safe_load(fh)


def cmd_check(args) -> int:
    """Every testid the erosion harness's specs use must be in the contract by then."""
    harness = os.path.expanduser(args.harness)
    specs_dir = os.path.join(harness, "acceptance", "specs")
    if not os.path.isdir(specs_dir):
        sys.exit(f"no specs at {specs_dir}")

    missing: dict[int, set[str]] = {}
    audit_missing: dict[int, set[str]] = {}
    checked = 0
    for dirpath, _, files in os.walk(specs_dir):
        for fn in sorted(files):
            if not fn.endswith(".spec.ts"):
                continue
            m = re.search(r"cp0*(\d+)", fn)
            if not m:
                continue
            n = int(m.group(1))
            # an updated prior copy lives in cpNN/ and runs from that checkpoint onward
            parent = os.path.basename(dirpath)
            pm = re.match(r"cp0*(\d+)$", parent)
            at = int(pm.group(1)) if pm else n
            text = open(os.path.join(dirpath, fn)).read()
            uses_audit = "auditLines" in text          # the audit channel's only entry point
            used = set(SPEC_TESTID.findall(text)) | set(SPEC_TESTID_RE.findall(text))
            if not used:
                continue
            checked += 1
            contract = load_contract(at)
            available = set(contract.get("available_testids") or [])
            # a dynamic anchor is used as `client-row-1`; the contract holds `client-row-<id>`
            shapes = {re.sub(r"<[^>]+>", "", a) for a in available}
            for u in used:
                if u in available:
                    continue
                if any(u.startswith(s) and s for s in shapes):
                    continue
                missing.setdefault(at, set()).add(u)

            # the audit channel, same question: every record a spec asserts must be a record
            # the contract declares, with the placeholders standing in for the values
            records = set(contract.get("available_audit_records") or [])
            patterns = [re.compile("^" + re.sub(r"<[^>]+>", r"\\S+", re.escape(r)
                                                .replace(r"\<", "<").replace(r"\>", ">"))
                                   + "$") for r in records]
            for asserted in (set(SPEC_AUDIT.findall(text)) if uses_audit else set()):
                if not any(p.match(asserted) for p in patterns):
                    audit_missing.setdefault(at, set()).add(asserted)

    print(f"checked {checked} spec files against the extracted contracts")
    if not missing and not audit_missing:
        print("ok: every testid and audit record the reference specs use appears in the "
              "contract by its checkpoint")
        return 0
    for n in sorted(missing):
        print(f"  cp{n:02d}: testid not in contract -> {sorted(missing[n])}")
    for n in sorted(audit_missing):
        print(f"  cp{n:02d}: audit record not in contract -> {sorted(audit_missing[n])}")
    print("\nA miss is one of: an extractor pattern gap (fix tools/contract.py), an anchor or "
          "record the reference spec expects but the implementation never emitted (a real hole "
          "in the chain), or a spec running at a checkpoint before its anchor exists.")
    return 1


def cmd_show(args) -> int:
    print(open(os.path.join(CONTRACTS, f"cp{args.checkpoint:02d}.yaml")).read(), end="")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("build", help="extract contracts/cpNN.yaml for every checkpoint")
    p.set_defaults(fn=cmd_build)
    p = sub.add_parser("check", help="validate extraction against the reference specs")
    p.add_argument("--harness", default=os.path.expanduser("~/ui-long-degradation-test"))
    p.set_defaults(fn=cmd_check)
    p = sub.add_parser("show", help="print one checkpoint's contract")
    p.add_argument("--checkpoint", type=int, required=True)
    p.set_defaults(fn=cmd_show)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
