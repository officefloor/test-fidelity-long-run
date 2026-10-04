# test-fidelity-long-run — design

## §1 The question

`~/ui-long-degradation-test` held the **tests** fixed and let the agent write the **application**,
over 60 plain-English change requests. It showed OfficeFloor + TanStack absorbs them without
eroding.

This harness swaps the two. The application is fixed and correct; the agent writes the tests:

> Given a plain-English change request and an application that already implements it, can an agent
> produce an acceptance test that actually pins that behaviour — and keep a suite of them honest
> across 60 consecutive changes?

That is the unproven link in the pipeline (English change → refined request → **tests** →
implement → review). A wrong test is worse than no test: the pipeline goes green and proceeds. At
300–500 unattended changes that is the failure that compounds.

Code erosion is not measured here. Erosion of the **test suite** is (§8).

## §2 Isolation: the reference application is imported, not borrowed

The evolved chains live in the stack repos (`~/officehq-*`) and are **records of completed runs**.
This harness must never write to them, and must not depend on them at run time either — a later
run of the erosion harness would change what every score here meant.

So the application is imported **once, read-only**, into this repo, as plain text it then owns:

```
reference/base/            the application before cp01
reference/cp01.patch       what cp01 changed: its own code AND its overrides of prior files
reference/cp02.patch       ...
reference/manifest.yaml    source repo, branch, commit per checkpoint, patch digests
```

This mirrors the erosion harness's structure with the halves swapped. There, a checkpoint shipped
its own spec plus updated copies of the prior specs it broke; here a checkpoint ships its own code
plus its overrides of prior code. `tools/reference.py` does the import and materialises any
checkpoint; `verify` re-applies the whole chain and checks the digests.

Materialising checkpoint N is base + patches 1..N, **as its own git repository**, committed one
checkpoint at a time. The history is deliberate: it is what the agent sees of the code, where its
own test commits land, and what makes test-suite churn measurable (§8).

Two paths are excluded on import because they would hand the agent the answers: `evolve-results/`
(the erosion harness's capture — it carries the reference specs' test titles and failure text) and
`e2e/specs/` (where it installed those specs).

### Two checkpoints have no code

cp40 (thousands separator) and cp50 (combined filter) imported as **zero-file patches**: the agent
ran, produced a zero-byte diff, and its own acceptance test passed anyway — earlier code already
satisfied the request. They are legitimate for the erosion harness and unscoreable here: there is
no feature to remove and no behaviour to mutate. They are flagged by `reference.py import`,
recorded as `no_code_change` in the contract, and **excluded from the relevance and mutation
oracles** while still counting for soundness. Any new no-op checkpoint must be excluded the same
way rather than scored as a failure.

## §3 The interface contract

The erosion harness could leave the test/implementation interface implicit: the experimenter wrote
both the spec and the anchors, so they agreed by construction. Here the agent writes a test against
code it did not write, and a test is only as good as its anchors — `getByTestId('client-list')`
against an implementation rendering `clients-table` fails for a reason that says nothing about
whether the agent understood the request.

So the contract is **extracted from the reference code and handed to the agent** as part of the
checkpoint specification. `tools/contract.py` produces, per checkpoint:

```
contracts/cp08.yaml   new_testids / new_audit_records              introduced here
                      available_testids / available_audit_records  everything in the app by now
                      no_code_change                               the §2 exclusion flag
```

Both assertion channels the reference specs use are covered: `data-testid` anchors (static and
the `client-row-<id>` dynamic shapes) and the audit-file record formats
(`INVOICE_PAID id=<id> amount=<amount>`).

`contract.py check` validates the extraction against the erosion harness's own 95 spec files:
every testid and audit record they assert must appear in the contract by their checkpoint. It
passes. That check reads those specs **offline, for calibration only** — they are never shown to
the agent (§7). Without it, a pattern gap would silently hand the agent a short contract and the
agent would be blamed for the harness's omission.

## §4 The loop

For each checkpoint N in order:

1. **Materialise** the reference application at N (§2). Application source is **read-only** to the
   agent; a run that modifies it is void.
2. **Specify.** The agent is given the plain-English request for N, the interface contract for N
   (§3), and the instruction that it is writing **tests only**.
3. **Write.** From cp02 on it also has the full test suite **it has written so far**, and that
   suite's git history — so it can revise its earlier tests when the request changes earlier
   behaviour, with the same view it would have in the pipeline.
4. **Commit.** Its suite is copied back and committed. That commit is the unit §8 measures.
5. **Grade** (§5). Then on to N+1.

The suite accumulates, exactly as the application did in the erosion harness. The interesting
failures are late, where the agent is maintaining 100+ of its own tests it no longer remembers
writing.

## §5 Grading: fidelity testing

**Step 1 — green, and growing.** Run the whole accumulated suite against checkpoint N's code.
Every test must pass: a failure here is a false alarm, which in the pipeline blocks a correct
change. The suite must also have **more tests than at N-1** — new functionality should mean new
tests.

Two caveats the rule has to carry, or it will fire on the harness's own artefacts rather than the
agent's work: at a **mutative** checkpoint the right move may be to *rewrite* tests rather than add
any, so the requirement there is non-decreasing count plus at least one test added or changed; and
at a §2 no-code-change checkpoint there is nothing new to cover.

Run the suite **twice**. A test whose result flips between identical runs is **flaky**, and is
reported separately — in an unattended pipeline a flake is the most expensive kind of wrong test,
because it spends human attention on nothing.

**Step 2 — mutation.** For each mutation authored for checkpoint N (§6): apply it to the code, run
the suite, and require **at least one test to fail**. A mutation that the suite survives is a part
of the request that no test pins. Kill rate over the checkpoint's mutation set is the fidelity
score for that checkpoint.

Mutation **zero is free**: the application at N-1 *is* the whole-feature mutation. Removing one
patch from the chain gives a build with the feature absent, and the tests added this round must
fail against it. It needs no authoring, and it catches the dominant failure mode of writing tests
against existing code — tests that restate what the code already does, or that hold both before
and after the change. The authored mutations in §6 then test depth: mutation zero proves the test
notices the feature is gone, and `expect(total).toBeGreaterThan(0)` passes that while pinning
nothing.

**Step 3 — maintenance.** Prior tests must be *updated*, not deleted. A prior test the agent
removed rather than revised is tracked separately from one it correctly rewrote: deleting the
failing test is the cheap way out, and it is exactly what must not happen across 500 changes.

### Recorded per checkpoint

| metric | step | meaning |
| --- | --- | --- |
| `green` | 1 | the whole suite passes on correct code |
| `tests_total`, `tests_added`, `tests_changed` | 1 | the suite grew, and how |
| `flaky_tests` | 1 ×2 | results that flipped between identical runs |
| `kill_rate` | 2 | mutations killed / mutations authored |
| `survived` | 2 | which mutations no test caught — the actionable list |
| `feature_absent_killed` | 2 (zero) | this round's tests fail at N-1 |
| `priors_deleted` | 3 | prior tests removed rather than updated |
| `suite_runtime_s`, `test_churn_lines` | 1, §8 | cost and churn as the suite grows |

The headline is the share of checkpoints that are green ∧ growing ∧ feature-absent-killed, with
mean kill rate beside it. The run-level question is whether fidelity **degrades with suite size** —
the same slope-with-CI treatment the erosion harness applies over checkpoint index.

## §6 The mutation catalogue

A **mutation** is a stored unified diff against the reference application that breaks exactly one
aspect of one request's behaviour.

> Not to be confused with a **mutative checkpoint**, which `checkpoints.yaml` already defines as a
> change request that revises earlier behaviour. Different thing, unrelated. "Mutation", "mutant"
> and "kill rate" here carry their usual mutation-testing meaning.

```
mutations/cp08/manifest.yaml      the set for checkpoint 08
mutations/cp08/001-<slug>.patch   minimal diff vs the reference app at cp08
```

Authored once by the experimenter and reused by every run — deterministic on purpose. Generating
defects with an LLM per run would make the instrument non-repeatable, and a measuring instrument
that moves is not one.

Rules for a usable mutation: it applies cleanly; the app **still builds and serves** (a mutation
that breaks the build is killed by everything and scores the compiler, not the suite); it changes
behaviour observable through the UI or the audit file; it is minimal and single-aspect; and it is
derived from a **clause of the English request**, so kill rate reads as "how much of what the user
asked for does this suite hold".

**Calibration before use.** Run the *experimenter's* reference spec for the checkpoint against
every mutation in its set. Each must die. One that survives is either a bad mutation or a real hole
in the reference suite — both worth knowing, and neither usable for grading an agent until
resolved. Grading refuses an uncalibrated set.

## §7 Blindness

The agent must not see the experimenter's reference specs (it would copy them), the mutation
catalogue (it would target the patches, not the behaviour), future requests, or `checkpoints.yaml`.
The erosion harness's Landlock confinement enforces exactly this shape and fails closed if any
listed path is reachable; reuse it unchanged.

The inversion vs the erosion harness: application source is **readable** here. It is the input, not
a leak. What is withheld is every statement of what the application *should* do.

## §8 Test-suite erosion

The secondary question, and the one that decides whether 300–500 changes is realistic: does the
generated suite rot? A suite that doubles in runtime every 20 changes, or whose each round rewrites
swathes of earlier tests, will not survive unattended even at perfect fidelity.

`metrics.reedit_line_stats` and `metrics.hot_surface` in the erosion harness are git-only and
layer-agnostic. Pointed at the generated test directory they answer this directly: how much settled
test code each round destroys, how old it was, and whether churn concentrates in a few files. The
per-checkpoint commits from §4 are what they read. No new measurement code.

## §9 Reused from the erosion harness

Imported, not forked, so a fix lands once: `correctness.py` (build/serve/Playwright, test ids,
pass parsing), `agent.py` (the agent turn, cost/token capture), `landlock.py` (§7), `capture.py`
(the committed per-checkpoint record), `metrics.py` (§8 only), and `checkpoints.yaml` (the 60
requests with their `type` and `mutates`).

Genuinely new, and small: the grader, the mutation catalogue and its calibration, the contract
extractor, and a driver that can move the application *backwards* for mutation zero.

## §10 A caveat inherited from the source data

`checkpoints.yaml`'s `mutates` declarations are incomplete, and the erosion harness forgives more
than it should: a failure of a mutative checkpoint's **own shipped replacement spec** is classified
`intended` and never counted. cp49 is the clearest case — it ships an updated cp21 spec asserting
tax in the invoice amount, that spec fails at cp49 ($1,000 against an expected $1,200), and the
failure is recorded as intended. See REFERENCE_CHAIN.md.

This matters here because §5 step 3 leans on `type`/`mutates` to know which priors *should* have
been revised. Those declarations have to be repaired before the maintenance metric means anything.

## §11 Status

**Built and verified**: the import and materialise chain (`tools/reference.py` — 60 patches apply
in order, digests match), the contract extractor (`tools/contract.py` — 60 contracts, calibrated
against all 95 reference spec files), reference-chain selection (`tools/reference_chain.py`), and
the design.

**Not built**: the driver (§4), the grader (§5), the mutation catalogue (§6 — format and one worked
manifest only).

**Prerequisite**: the reference chain still needs its repair sites resolved (REFERENCE_CHAIN.md)
before a score distinguishes a bad test from a bad fixture.
