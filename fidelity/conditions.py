"""The §4.4 research arms: what happens between the change request and the graded suite.

Each arm is one run, graded by the identical pipeline (§5–§6). Holding the grader fixed is the
whole point — the arms are comparable precisely because only the input moves — so nothing here
touches grading, and every arm returns the same thing: the suite left in the author's sandbox,
plus the record of how it got there.

The shape each arm takes:

  blind                  one author turn. The baseline, and the floor every other arm is read
                         against. Implemented by `run.py` directly; it needs nothing from here.
  prototype-first        one author turn with cpN visible. Also `run.py`: it IS `code_view`,
                         and was built before the conditions had names.
  blind-ai-review        author, then a reviewer with the SAME information and no ground truth,
                         then the author revises. Nothing new is disclosed, so whatever this
                         buys is attention rather than knowledge.
  clarify-oracle         the author asks behavioural questions first; a prompter-proxy grounded
                         in cpN answers within a budget; then the author writes with the answers.
  prompter-proxy-review  author drafts, a prompter-proxy grounded in cpN reads the draft and
                         returns English behavioural feedback, the author revises.
  write-twice            two independent authors from the same starting suite, then a
                         reconciliation turn that sees both drafts.

Two invariants hold across all of them, and the code is arranged so that breaking one is loud:

  * A PROXY IS GROUNDED IN INTENT, NEVER IN THE REFERENCE TESTS (§4.5). Structural, not
    instructed: the proxy's area is built by `sandbox.build_proxy_area`, which puts cpN there and
    never the reference specs, and the same sentinel that hides them from the author hides them
    from the proxy. `proxy_leak_scan` then reads what the proxy actually SAID, because the rule
    that matters is about its output and an instruction is not evidence of compliance.
  * EVERY EXCHANGE IS RECORDED AND IS ITSELF A RESULT (§4.5). Questions, answers, critiques and
    feedback all land in `cpNN.json`. The leak audit needs them, and the questions an author felt
    it had to ask are a direct map of where the English request is ambiguous — worth reading
    whatever the score says.
"""
from __future__ import annotations

import os
import re
import time

from fidelity import sandbox as sb, spec, turn

# What a proxy must not say (§4.5), read off what it did say. Instructed restraint is not
# evidence, and the leak this catches is the one that would quietly turn every proxy arm into
# prototype-first-by-paraphrase — inflating exactly the comparison the arms exist to make.
TEST_STRUCTURE = [
    ("testid", re.compile(r"data-testid|getByTestId|\[data-", re.I)),
    ("assertion", re.compile(r"\bexpect\s*\(|toBe\b|toEqual\b|toHaveText\b|toContain\b"
                             r"|assert\b", re.I)),
    ("code", re.compile(r"```|\bawait\s+page\b|\bpage\.\w|\btest\s*\(|\bdescribe\s*\(")),
    ("spec file", re.compile(r"[\w-]+\.spec\.ts")),
    ("seed call", re.compile(r"resetAndSeed|auditLines")),
]


# The tail of an anchor names a part of the page, and naming one is the line §4.5 draws. Kept
# explicit rather than inferred, so widening it is a deliberate edit to a reviewed list.
UI_NOUN = re.compile(r"-(table|form|row|page|button|input|error|count|empty|panel|list|dialog"
                     r"|modal|toggle|link|cell|field|label|badge|header|footer|summary|detail"
                     r"|item|menu|tab|select|option|section|banner|icon|title|nav|card|chip"
                     r"|tooltip|checkbox|dropdown|spinner|alert|heading|caption)s?\b")


def proxy_leak_scan(text: str, contract: dict) -> list[str]:
    """What in this proxy's output crossed from behaviour into test structure.

    Published anchors are not a leak — the contract already gave the author every one of them
    (§3), so a proxy naming one discloses nothing. An anchor that is NOT in the contract is a
    different matter, and is reported by name."""
    hits: list[str] = []
    for label, rx in TEST_STRUCTURE:
        for m in rx.finditer(text or ""):
            line = (text[max(0, m.start() - 60):m.start() + 60] or "").replace("\n", " ")
            hits.append(f"{label}: …{line.strip()}…")
            break
    published = set(contract.get("available_testids") or []) | set(
        contract.get("new_testids") or [])
    # the contract publishes `client-row-<id>` style placeholders; compare on the stem
    stems = {t.split("<")[0].rstrip("-") for t in published}
    # What the app's OWN anchors are built from, taken from the contract rather than guessed:
    # a hyphenated token starting in the same family as a published anchor (`client-…`,
    # `invoice-…`) is almost certainly an anchor, published or not.
    families = {t.split("-")[0] for t in published if "-" in t}
    for tok in set(re.findall(r"\b[a-z][a-z0-9]*(?:-[a-z0-9<>]+){1,}\b", text or "")):
        if tok in published or tok.split("<")[0].rstrip("-") in stems:
            continue
        # Two tests, deliberately NOT "any hyphenated word": ordinary prose hyphenates freely
        # ("newest-first", "part-paid", "read-only", "end-to-end") and an audit that cried wolf
        # at those would be ignored, which is worse than one that is narrow and read.
        if tok.split("-")[0] in families or UI_NOUN.search(tok):
            hits.append(f"unpublished anchor-shaped token: {tok}")
    return hits


def _questions(text: str, budget: int) -> list[str]:
    """The author's questions, as it wrote them. Over-budget questions are DROPPED rather than
    the turn being failed: the budget is the oracle's patience, not a rule the author broke, and
    the number asked is recorded either way (§4.5)."""
    qs = []
    for line in (text or "").splitlines():
        m = re.match(r"\s*(?:Q\d*|question)\s*[:.)-]\s*(.+)", line, re.I)
        if m:
            q = m.group(1).strip()
            if q and not re.fullmatch(r"\(?\s*none\s*\)?\.?", q, re.I):
                qs.append(q)
    return qs[:budget]


class Ctx:
    """Everything an arm needs, assembled once by `run.py` so the arms cannot reach past it."""

    def __init__(self, *, n, cp_id, request, contract, fields, args, cfg, agent, landlock,
                 out_dir, work, suite_repo, specs_rel, app_pristine, sandbox_dir, rebuild,
                 materialise, spec_files_now, total_tests, log, gate_tree):
        self.n, self.cp_id = n, cp_id
        self.request, self.contract, self.fields = request, contract, fields
        self.args, self.cfg = args, cfg
        self.agent, self.landlock = agent, landlock
        self.out_dir, self.work = out_dir, work
        self.suite_repo, self.specs_rel = suite_repo, specs_rel
        self.app_pristine, self.sandbox_dir = app_pristine, sandbox_dir
        self.rebuild = rebuild
        self.materialise = materialise
        self.spec_files_now, self.total_tests = spec_files_now, total_tests
        self.log = log
        # cpN as materialised for grading, plus every area this arm creates. Each turn asserts it
        # cannot read the ones that are not its own — see `turn.confine_config`.
        self.gate_tree = gate_tree
        self.areas: list[str] = []

    @property
    def specs_in_sandbox(self) -> str:
        return os.path.join(self.sandbox_dir, self.specs_rel)

    def tag(self, name: str) -> str:
        return f"cp{self.n:02d}.{name}"

    def withheld_from(self, area: str) -> list[str]:
        """Everything this turn must not reach: cpN's grading tree, and every OTHER area of this
        checkpoint — a proxy area holds cpN by design, and under write-twice each author's
        sandbox is the other's answer sheet."""
        return [p for p in [self.gate_tree] + self.areas
                if os.path.abspath(p) != os.path.abspath(area)]

    def turn(self, *, name: str, prompt: str, area: str, rebuild, model=None) -> dict:
        """One agent turn, captured under its own name so a condition's turns are told apart in
        the capture. Every turn of every arm goes through here: the prompt is written out beside
        the stream for the same reason the author's is (a bad score is often a bad prompt), and
        the retry policy is the author's, unchanged."""
        from fidelity import capture
        capture.write_text(os.path.join(self.out_dir, f"{self.tag(name)}.prompt.txt"), prompt)
        t0 = time.time()
        ar, attempts = turn.run_turn(
            agent=self.agent, landlock=self.landlock, cfg=self.cfg, sandbox=area,
            prompt=prompt, model=model or self.args.model or self.cfg.get("model"),
            stream_path=os.path.join(self.out_dir, f"{self.tag(name)}.jsonl"),
            run_dir=self.out_dir, rebuild=rebuild,
            extra_sentinels=self.withheld_from(area))
        block = turn.result_block(ar, attempts)
        block["turn"] = name
        block["stream_file"] = f"{self.tag(name)}.jsonl"
        block["prompt_file"] = f"{self.tag(name)}.prompt.txt"
        self.log(f"    {name:<14}: ok={ar.ok} turns={ar.num_turns} "
                 f"cost=${ar.cost_usd:.4f} {int(time.time() - t0)}s")
        if ar.error:
            self.log(f"      error: {ar.error[:200]}")
        return block


def _author(ctx: Ctx, *, name: str = "author", prompt: str | None = None,
            area: str | None = None, rebuild=None) -> dict:
    return ctx.turn(name=name,
                    prompt=prompt if prompt is not None else spec.build_prompt(
                        ctx.request, ctx.contract, ctx.fields, ctx.args.code_view,
                        ctx.spec_files_now, ctx.total_tests),
                    area=area or ctx.sandbox_dir, rebuild=rebuild or ctx.rebuild)


def _proxy_area(ctx: Ctx, *, suffix: str, draft: str | None) -> tuple[str, int, object]:
    """cpN materialised into the proxy's own area, with the draft when it is reviewing one.

    Rebuilt from scratch on a retry exactly as the author's sandbox is, so a proxy that failed
    half way through cannot leave its area in a state the next attempt inherits."""
    app = os.path.join(ctx.work, f"cp{ctx.n:02d}-{suffix}-app")
    area = os.path.join(ctx.work, f"cp{ctx.n:02d}-{suffix}")
    ctx.materialise(ctx.n, app)
    ctx.areas += [app, area]
    n_files = [0]

    def rebuild():
        n_files[0] = sb.build_proxy_area(area=area, app_tree=app, draft_specs=draft)
    rebuild()
    return area, n_files[0], rebuild


def _record_proxy(ctx: Ctx, block: dict, text: str, kind: str) -> dict:
    hits = proxy_leak_scan(text, ctx.contract)
    block["said"] = text
    block["leak_hits"] = hits
    if hits:
        ctx.log(f"      [LEAK] the {kind} crossed into test structure — "
                f"{len(hits)} hit(s), recorded in the capture and in `exchanges`:")
        for h in hits[:4]:
            ctx.log(f"        {h[:150]}")
    return block


# --- the arms -----------------------------------------------------------------------------


def blind_ai_review(ctx: Ctx) -> dict:
    """Author, blind critique, revise. No ground truth enters at any point (§4.4).

    The reviewer runs in the author's own area, because its defining property is having exactly
    the author's information — a separate area would have to be built from the same cp(N-1) tree
    and the same draft, which is what this already is. It is told not to edit; `restore_specs`
    makes that true rather than requested, and reports it if it tried.
    """
    turns = [_author(ctx)]
    specs = ctx.specs_in_sandbox
    snap = sb.snapshot_specs(specs)
    review = ctx.turn(name="review",
                      prompt=spec.build_review_prompt(ctx.request, ctx.contract, ctx.fields,
                                                      len(snap)),
                      area=ctx.sandbox_dir, rebuild=lambda: None)
    edited = sb.restore_specs(specs, snap)
    review["said"] = review.get("result_text") or ""
    review["edited_despite_brief"] = edited
    if edited:
        ctx.log(f"      [note] the reviewer edited {len(edited)} spec file(s) despite being told "
                f"not to; reverted, and recorded in `exchanges`")
    turns.append(review)
    turns.append(_author(ctx, name="revise", rebuild=lambda: None,
                         prompt=spec.build_revise_prompt(
                             ctx.request, ctx.contract, ctx.fields, ctx.args.code_view,
                             review["said"], "reviewer")))
    return {"turns": turns, "exchanges": {"critique": review["said"],
                                          "reviewer_edited": edited}}


def clarify_oracle(ctx: Ctx) -> dict:
    """Ask first, then write. The questions are the diagnostic (§4.5).

    An author that asks nothing is a result, not a failure: it says the request read as clear.
    The oracle turn is skipped in that case so the arm costs what it actually used, and the
    budget spent is recorded either way.
    """
    budget = int(((ctx.cfg.get("conditions") or {}).get("clarify_oracle") or {})
                 .get("question_budget", 5))
    ctx.rebuild()
    snap = sb.snapshot_specs(ctx.specs_in_sandbox)
    ask = ctx.turn(name="questions",
                   prompt=spec.build_question_prompt(
                       ctx.request, ctx.contract, ctx.fields, ctx.args.code_view,
                       ctx.spec_files_now, ctx.total_tests, budget),
                   area=ctx.sandbox_dir, rebuild=lambda: None)
    # It was told to ask, not to write. Enforced rather than requested: left alone, a question
    # turn that drafted would hand this arm two authoring turns and quietly stop being the thing
    # being measured.
    edited = sb.restore_specs(ctx.specs_in_sandbox, snap)
    if edited:
        ctx.log(f"      [note] the question turn edited {len(edited)} spec file(s) before "
                f"asking; reverted, and recorded in `exchanges`")
    questions = _questions(ask.get("result_text") or "", budget)
    ask["questions"] = questions
    ask["edited_despite_brief"] = edited
    turns = [ask]
    answers = ""
    if questions:
        area, _, rebuild = _proxy_area(ctx, suffix="oracle", draft=None)
        oracle = ctx.turn(name="oracle", prompt=spec.build_oracle_prompt(ctx.request, questions),
                          area=area, rebuild=rebuild)
        answers = oracle.get("result_text") or ""
        turns.append(_record_proxy(ctx, oracle, answers, "oracle's answer"))
    else:
        ctx.log("    oracle        : skipped — the author asked nothing")
    ctx.log(f"    budget        : {len(questions)}/{budget} question(s) asked")

    base = spec.build_prompt(ctx.request, ctx.contract, ctx.fields, ctx.args.code_view,
                             ctx.spec_files_now, ctx.total_tests)
    if questions:
        base += "\n\n" + spec.answered_qa(questions, answers) + "\n"
    turns.append(_author(ctx, prompt=base, rebuild=lambda: None))
    return {"turns": turns,
            "exchanges": {"questions": questions, "answers": answers,
                          "budget": budget, "budget_spent": len(questions),
                          "asker_edited": edited,
                          "leak_hits": turns[1].get("leak_hits", []) if questions else []}}


def prompter_proxy_review(ctx: Ctx) -> dict:
    """Author drafts, the prompter reads it, the author revises (§4.4, §4.5).

    The proxy reads the draft in its own area with cpN present — it is the owner, and the
    implementation is the authority on what it meant. The draft is copied there rather than the
    proxy being let into the author's sandbox, so the two areas never share a filesystem and the
    proxy cannot write into the suite that is about to be graded.
    """
    turns = [_author(ctx)]
    specs = ctx.specs_in_sandbox
    area, n_files, rebuild = _proxy_area(ctx, suffix="prompter", draft=specs)
    proxy = ctx.turn(name="prompter",
                     prompt=spec.build_proxy_review_prompt(ctx.request, n_files),
                     area=area, rebuild=rebuild)
    feedback = proxy.get("result_text") or ""
    turns.append(_record_proxy(ctx, proxy, feedback, "prompter's feedback"))
    turns.append(_author(ctx, name="revise", rebuild=lambda: None,
                         prompt=spec.build_revise_prompt(
                             ctx.request, ctx.contract, ctx.fields, ctx.args.code_view,
                             feedback, "prompter")))
    return {"turns": turns, "exchanges": {"feedback": feedback,
                                          "leak_hits": proxy.get("leak_hits", [])}}


def write_twice(ctx: Ctx) -> dict:
    """Two independent authors, then reconciliation (§4.4).

    Independence is structural: each author gets its own area built from the same suite
    repository at the same commit, so neither can see the other's draft and both start from
    exactly the accumulated suite. The reconciler then works in author A's area with B's draft
    placed outside the specs directory, where `copy_back` cannot pick it up by accident.

    §4.4 gates this arm on variance — low spread means the author's misses are systematic, a
    second author repeats them, and reconciliation buys nothing. The gate is the chain-level
    bootstrap of §8.1, which is a property of finished runs, so it is reported here and left to
    the operator rather than enforced against numbers this run does not have.
    """
    a_dir = os.path.join(ctx.work, f"cp{ctx.n:02d}-sandbox-a")
    b_dir = os.path.join(ctx.work, f"cp{ctx.n:02d}-sandbox-b")

    def mk(area):
        def rebuild():
            sb.build_sandbox(sandbox=area, app_tree=ctx.app_pristine,
                             suite_repo=ctx.suite_repo, specs_rel=ctx.specs_rel)
        return rebuild
    ra, rb = mk(a_dir), mk(b_dir)
    ra(); rb()
    ctx.areas += [a_dir, b_dir]
    turns = [_author(ctx, name="author-a", area=a_dir, rebuild=ra),
             _author(ctx, name="author-b", area=b_dir, rebuild=rb)]

    a_specs = os.path.join(a_dir, ctx.specs_rel)
    b_specs = os.path.join(b_dir, ctx.specs_rel)
    draft_a, draft_b = sb.spec_files(a_specs), sb.spec_files(b_specs)
    n_b = sb.place_second_draft(sandbox=a_dir, draft_specs=b_specs)
    turns.append(ctx.turn(name="reconcile",
                          prompt=spec.build_reconcile_prompt(
                              ctx.request, ctx.contract, ctx.fields, ctx.args.code_view,
                              len(draft_a), n_b),
                          area=a_dir, rebuild=lambda: None))
    # the reconciled suite is what gets graded, so it has to be where run.py will look for it
    ctx.sandbox_dir = a_dir
    return {"turns": turns,
            "exchanges": {"draft_a": draft_a, "draft_b": draft_b,
                          "variance_gate": "§4.4 gates write-twice on high chain-level spread; "
                                           "not checked here — see analyse (§8.1)"},
            "sandbox": a_dir}


ARMS = {
    "blind-ai-review": blind_ai_review,
    "clarify-oracle": clarify_oracle,
    "prompter-proxy-review": prompter_proxy_review,
    "write-twice": write_twice,
}
