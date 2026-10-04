"""The checkpoint specification: everything the agent is given, and nothing else.

Rendered identically in both modes. In `replay` mode no agent runs, but the specification is
still built and printed — otherwise replay would not be validating the thing agent mode does,
and a defect in the prompt or the contract would only surface once an agent run had paid for it.
"""
from __future__ import annotations

import os

PROMPT_TEMPLATE = """You are writing ACCEPTANCE TESTS for one change to this application.

You write TESTS ONLY. Do not modify application source, build scripts, or the test support
helpers (e2e/support/*). A run that changes application code is void.

THE CHANGE REQUEST (as the user wrote it):
{request}

WHAT TO DO
Write Playwright acceptance test(s) under e2e/specs/ that verify this change request has been
implemented. Where the request revises behaviour that your EXISTING tests already assert, update
those tests too — the suite must describe the application as it is meant to be after this change,
not as it was before.

Assert only through the two public channels below. Never reach into the database, the REST API, or
application internals.

{contract}

HOW DATA IS ARRANGED
Call `resetAndSeed({{...}})` from `../support/seed` to put the application into the state your test
needs (it clears all data and the audit file first). Only the seed fields listed above are
honoured — a field that is not listed is accepted and SILENTLY IGNORED, so seeding it will look
like it worked and your assertion will fail for an unrelated-looking reason.

{code_note}

YOUR EXISTING TESTS
{suite_note}
"""

CODE_NOTE_PREVIOUS = """THE APPLICATION
The source in this directory is the application as it stands BEFORE this change request has been
implemented. You can read it and run it. Your new test SHOULD FAIL against it — the behaviour
being requested is not there yet. That is expected, and is not a reason to weaken the test. Your
existing tests should still pass.
"""

CODE_NOTE_NONE = """THE APPLICATION
You cannot see or run the application. Write the test from the change request and the interface
contract above.
"""

CODE_NOTE_CURRENT = """THE APPLICATION
The source in this directory already implements this change request. You can read and run it.
"""


def render_contract(contract: dict, fields: list[str]) -> str:
    """The interface contract as the agent sees it (DESIGN.md §3). Order matters: what this
    checkpoint INTRODUCES comes first, because that is what the new test must bind to, and the
    cumulative list is long enough to bury it."""
    out: list[str] = []
    new_ids = contract.get("new_testids") or []
    new_audit = contract.get("new_audit_records") or []
    all_ids = contract.get("available_testids") or []
    all_audit = contract.get("available_audit_records") or []
    seed = contract.get("seed_accepts") or {}

    out.append("CHANNEL 1 — the UI, via data-testid")
    if "new_testids" in fields:
        out.append(f"  Introduced by THIS change ({len(new_ids)}):")
        out += [f"    {t}" for t in new_ids] or ["    (none — this change adds no new anchors)"]
    if "available_testids" in fields:
        out.append(f"  Every anchor available to you ({len(all_ids)}):")
        out += [f"    {t}" for t in all_ids]
    out.append("  `<id>` / `<currency>` are placeholders: the concrete value comes from the data")
    out.append("  your test seeds, e.g. client-row-1. Anchors are a stable contract — use them")
    out.append("  exactly as written.")

    out.append("")
    out.append("CHANNEL 2 — the audit file, via auditLines() from ../support/audit")
    if "new_audit_records" in fields:
        out.append(f"  Introduced by THIS change ({len(new_audit)}):")
        out += [f"    {a}" for a in new_audit] or ["    (none)"]
    if "available_audit_records" in fields:
        out.append(f"  Every record format available to you ({len(all_audit)}):")
        out += [f"    {a}" for a in all_audit] or ["    (none yet)"]

    if "seed_accepts" in fields:
        out.append("")
        out.append("SEED FIELDS HONOURED by /__test__/seed (anything else is ignored):")
        for coll, flds in sorted(seed.items()):
            out.append(f"    {coll}: {', '.join(flds) if flds else '(scalar)'}")
    return "\n".join(out)


def suite_note(spec_files: list[str], total_tests: int) -> str:
    if not spec_files:
        return ("  e2e/specs/ is empty: this is the first change request, so there is nothing to\n"
                "  update yet.")
    listed = "\n".join(f"    {f}" for f in sorted(spec_files))
    return (f"  e2e/specs/ holds the {len(spec_files)} spec file(s) you have written so far "
            f"({total_tests} tests).\n"
            f"  Their git history is available. Update them where this change request revises\n"
            f"  behaviour they assert; otherwise leave them alone.\n{listed}")


def build_prompt(request: str, contract: dict, fields: list[str], code_view: str,
                 spec_files: list[str], total_tests: int) -> str:
    note = {"previous": CODE_NOTE_PREVIOUS, "none": CODE_NOTE_NONE,
            "current": CODE_NOTE_CURRENT}[code_view]
    return PROMPT_TEMPLATE.format(
        request=request.strip(),
        contract=render_contract(contract, fields),
        code_note=note.strip(),
        suite_note=suite_note(spec_files, total_tests),
    )


def load_contract(contracts_dir: str, n: int) -> dict:
    import yaml
    path = os.path.join(contracts_dir, f"cp{n:02d}.yaml")
    with open(path) as fh:
        return yaml.safe_load(fh) or {}
