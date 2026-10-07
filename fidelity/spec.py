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


# --- §4.4 conditions: the prompts for the turns beyond the single blind author ----------------
#
# Every one of these is assembled from the SAME contract the author gets, so a condition differs
# only in what the author is told or who tells it (§4.4). The proxy prompts carry the §4.5 rule
# verbatim rather than paraphrasing it: a proxy is grounded in intent, never in the reference
# tests, and the rule is structural first (it is never given them) and instructed second.

NO_TEST_STRUCTURE = """WHAT YOU MAY NOT SAY (this is the rule the experiment rests on)
Describe BEHAVIOUR, in the words of the business domain — "an archived client stays out of the
default list". You may NOT supply, quote or hint at:
  * a data-testid, selector, or element name
  * an assertion, matcher, or any fragment of test code
  * a literal value, count, or string the test should expect
  * an audit-record shape beyond what the contract already publishes
If you catch yourself about to name a part of the page or a value to check, say what the user
should be able to SEE OR DO instead, and stop there. Say less rather than crossing this line.
"""

REVIEW_TEMPLATE = """You are REVIEWING a draft acceptance test suite before it is handed on.

You have exactly what its author had: the change request, the interface contract, and the
application as it stands BEFORE the change. You do NOT have the implemented change and you do NOT
have anyone's reference tests. There is no ground truth here — you are a second pair of eyes, not
an oracle.

THE CHANGE REQUEST (as the user wrote it):
{request}

{contract}

THE DRAFT SUITE
e2e/specs/ holds the draft, {n_files} file(s). Its git history is available; the most recent
commit is the draft you are reviewing.

WHAT TO DO
Read the request and the draft, and say where the draft FAILS TO PIN what the request asked for.
Look for:
  * a clause of the request no test asserts at all
  * a test that asserts something weaker than the clause it is meant to cover — it would still
    pass if the behaviour were implemented wrongly
  * a test that asserts what the application ALREADY does rather than what the change adds
  * a test that cannot pass as written, or that contradicts another test

DO NOT EDIT ANY FILE. Write your critique as your final message, as a short numbered list of
concrete behavioural gaps. If the draft is sound, say so plainly and stop — do not invent gaps to
fill a list.
"""

REVISE_TEMPLATE = """You are REVISING your draft acceptance tests in light of feedback.

THE CHANGE REQUEST (as the user wrote it):
{request}

{contract}

{feedback_header}
{feedback}

WHAT TO DO
Revise the tests under e2e/specs/ to address the feedback. Same rules as when you wrote them:
TESTS ONLY, assert only through the contract's channels, and {code_expectation}

You are not obliged to agree. Where a note is wrong, leave the test as it is — a change made to
satisfy a reviewer rather than the request is how a suite drifts away from what was asked for.
"""

QUESTION_TEMPLATE = """You are about to write ACCEPTANCE TESTS for one change to this
application. FIRST you may ask the person who requested it about what it should do.

THE CHANGE REQUEST (as the user wrote it):
{request}

{contract}

{code_note}

YOUR EXISTING TESTS
{suite_note}

WHAT TO DO NOW
You may ask up to {budget} question(s) about the INTENDED BEHAVIOUR — what should happen when,
what the rules are at the edges, which cases matter. They will be answered by the person who asked
for the change: someone who knows what they want and what the application does, but who does not
write tests and will not discuss them. So ask about behaviour, not about how to test it; a question
about a selector, an assertion or an expected literal will not be answered.

Write ONE question per line, each beginning `Q:` and nothing else. Ask fewer than {budget} if
fewer would do — an unnecessary question is not free. If the request is clear enough to test as it
stands, write exactly `Q: (none)` and stop.

Do not write or edit any test yet.
"""

ORACLE_TEMPLATE = """You are the person who asked for this change. Someone is writing acceptance
tests for it, and has questions about what you meant.

THE CHANGE REQUEST (as you wrote it):
{request}

THE APPLICATION
The source in this directory ALREADY IMPLEMENTS the change you asked for. You may read and run it,
and it is the authority on what you meant — where your request was vague, the application settles
it. The person asking cannot see it.

{no_test_structure}
THE QUESTIONS
{questions}

WHAT TO DO
Answer each question in one or two sentences of plain behavioural English. Number your answers to
match: `A1:`, `A2:`, and so on. If a question asks for test structure rather than behaviour, say
so and answer the behavioural question behind it instead, if there is one. If you genuinely did not
have a view on something, say that — "I had not thought about it; either is fine" is a real and
useful answer, and pretending to a decision you never made would mislead them.
"""

PROXY_REVIEW_TEMPLATE = """You are the person who asked for this change. Someone has written
acceptance tests for it, and you are reading them before they are handed on.

THE CHANGE REQUEST (as you wrote it):
{request}

THE APPLICATION
The source in this directory ALREADY IMPLEMENTS the change you asked for. You may read and run it,
and it is the authority on what you meant. The author of these tests cannot see it.

THE DRAFT SUITE
The draft is in `draft-suite/`, {n_files} file(s). It is there for you to read. Do not edit it —
nothing you change there is kept.

{no_test_structure}
WHAT TO DO
Say what you asked for that these tests would NOT catch. Work from the request and the application:
if the change were implemented wrongly in some way that matters to you, would this suite notice?
Name each gap as the behaviour you care about, in a short numbered list. If the suite covers what
you asked for, say so and stop.
"""

RECONCILE_TEMPLATE = """Two people were given the same change request and each wrote acceptance
tests for it, independently and without seeing the other's work. You are producing the suite that
is actually handed on.

THE CHANGE REQUEST (as the user wrote it):
{request}

{contract}

THE TWO DRAFTS
  e2e/specs/        — draft A, {n_a} file(s). This is the working copy: what you leave here is
                      what is handed on.
  second-draft/     — draft B, {n_b} file(s). Read-only reference. Nothing you leave here is kept.

Both started from the same accumulated suite, so where they agree they will look alike; the
interesting part is where they differ.

{code_note}

WHAT TO DO
Produce in e2e/specs/ the suite that best pins what the request asked for. Where the drafts differ,
decide on the merits rather than splitting the difference:
  * behaviour one draft pins and the other misses — keep it
  * the same behaviour asserted two ways — keep the assertion that would fail if the behaviour
    were implemented wrongly, and drop the weaker one rather than keeping both
  * drafts that contradict each other — one of them has misread the request. Settle it from the
    request, and do not keep a test you believe is wrong because the other author wrote it

The suite must never shrink below what the two drafts started from: a behaviour that was already
covered before this change must still be covered after it. TESTS ONLY, and {code_expectation}
"""

CODE_EXPECTATION = {
    "previous": ("your new tests should still FAIL against the application in this directory — "
                 "the requested behaviour is not built yet, which is expected and is not a "
                 "reason to weaken them."),
    "none": "you cannot see or run the application.",
    "current": ("the application in this directory already implements the request, so your "
                "tests should pass against it."),
}


def build_review_prompt(request: str, contract: dict, fields: list[str], n_files: int) -> str:
    return REVIEW_TEMPLATE.format(request=request.strip(),
                                  contract=render_contract(contract, fields), n_files=n_files)


def build_revise_prompt(request: str, contract: dict, fields: list[str], code_view: str,
                        feedback: str, source: str) -> str:
    header = {"reviewer": "A REVIEWER'S CRITIQUE OF YOUR DRAFT",
              "prompter": "WHAT THE PERSON WHO ASKED FOR THIS SAID ABOUT YOUR DRAFT"}[source]
    return REVISE_TEMPLATE.format(request=request.strip(),
                                  contract=render_contract(contract, fields),
                                  feedback_header=header, feedback=feedback.strip(),
                                  code_expectation=CODE_EXPECTATION[code_view])


def build_question_prompt(request: str, contract: dict, fields: list[str], code_view: str,
                          spec_files: list[str], total_tests: int, budget: int) -> str:
    note = {"previous": CODE_NOTE_PREVIOUS, "none": CODE_NOTE_NONE,
            "current": CODE_NOTE_CURRENT}[code_view]
    return QUESTION_TEMPLATE.format(request=request.strip(),
                                    contract=render_contract(contract, fields),
                                    code_note=note.strip(),
                                    suite_note=suite_note(spec_files, total_tests),
                                    budget=budget)


def build_oracle_prompt(request: str, questions: list[str]) -> str:
    qs = "\n".join(f"  Q{i}: {q}" for i, q in enumerate(questions, 1)) or "  (none asked)"
    return ORACLE_TEMPLATE.format(request=request.strip(), questions=qs,
                                  no_test_structure=NO_TEST_STRUCTURE)


def build_proxy_review_prompt(request: str, n_files: int) -> str:
    return PROXY_REVIEW_TEMPLATE.format(request=request.strip(), n_files=n_files,
                                        no_test_structure=NO_TEST_STRUCTURE)


def build_reconcile_prompt(request: str, contract: dict, fields: list[str], code_view: str,
                           n_a: int, n_b: int) -> str:
    note = {"previous": CODE_NOTE_PREVIOUS, "none": CODE_NOTE_NONE,
            "current": CODE_NOTE_CURRENT}[code_view]
    return RECONCILE_TEMPLATE.format(request=request.strip(),
                                     contract=render_contract(contract, fields),
                                     code_note=note.strip(), n_a=n_a, n_b=n_b,
                                     code_expectation=CODE_EXPECTATION[code_view])


def answered_qa(questions: list[str], answer_text: str) -> str:
    """The Q&A as the author is given it back. The oracle's text is passed through verbatim —
    parsing it into pairs is for the audit (§4.5), never for deciding what the author sees, so a
    numbering the oracle did not follow cannot silently drop an answer."""
    qs = "\n".join(f"  Q{i}: {q}" for i, q in enumerate(questions, 1))
    return f"YOU ASKED\n{qs}\n\nTHE ANSWERS YOU WERE GIVEN\n{answer_text.strip()}"
