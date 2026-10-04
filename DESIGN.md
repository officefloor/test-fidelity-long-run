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
checkpoint at a time, plus any **fixture repairs** due at N.

### Repairs are a separate layer

`reference/` must stay a faithful, re-importable copy of what the run produced — editing its
patches would break that claim and the digests with it. So the fixes the fixture needs live in
`repairs/`, applied after every chain patch and committed as their own commit, which keeps the
fixture usable while the record stays honest about what had to be changed.

Each repair is an exact-match text substitution rather than a diff: it either matches or it
raises, so it cannot misapply against drifted context the way patch fuzz can. It carries a
checkpoint range, `until` being exclusive — the checkpoint at which upstream fixes the defect
itself. `reference.py verify-repairs` asserts every repair matches at every checkpoint in its
range *and* that upstream really has fixed it by `until`, so a range is never longer than the
defect.

The three present repairs close the seed-contract gap of §3: `projects.archived` from cp25 (two
variants, because cp34 changes the block's shape) and `clients.archived` from cp29. All three
touch only `TestSupportController`, which the erosion harness explicitly treats as evolving
test-support code, and the columns already exist at those checkpoints — only the seed path was
missing. The replacement text is lifted verbatim from the upstream checkpoint that added it.

A consequence worth keeping straight: `reference_chain.py` grades the erosion runs' **historical
capture**, which a repair cannot change. Whether a repair actually fixes the fixture is a
**replay-mode** question (§4.3), answered by running the known-good suite against the repaired
application. The history is deliberate: it is what the agent sees of the code, where its
own test commits land, and what makes test-suite churn measurable (§8).

Two paths are excluded on import because they would hand the agent the answers: `evolve-results/`
(the erosion harness's capture — it carries the reference specs' test titles and failure text) and
`e2e/specs/` (where it installed those specs).

### Two checkpoints have no code — and they are kept

cp40 (thousands separator) and cp50 (combined filter) imported as **zero-file patches**: the agent
ran, produced a zero-byte diff, and its own acceptance test passed anyway, because earlier code
already satisfied the request.

These are **graded like any other checkpoint**, and they test something the others cannot: that
the agent recognises a request the existing suite already covers, or writes tests for it that pass
without any code change. Getting that wrong is a real pipeline failure — a suite that demands a
change where none is needed blocks correct work.

What changes at a no-code checkpoint is only the *direction* of mutation zero (§5). The
application at N-1 is byte-identical to N, so a test written here MUST pass against it. Mutation
zero is therefore expected to **survive**, and a test that fails at N-1 is the error: it asserts
behaviour the application does not have. The authored mutations of §6 still apply in full — cp40's
request is about comma formatting, and formatting code exists to break, so a test that pins it can
be made to fail.

`reference.py import` flags these at import time and the contract records `no_code_change: true`,
so the grader inverts mutation zero rather than reporting a phantom failure.

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

Three channels are covered: `data-testid` anchors (static and the `client-row-<id>` dynamic
shapes), the audit-file record formats (`INVOICE_PAID id=<id> amount=<amount>`), and — the one
added last, for a reason — **the seed fields `/__test__/seed` actually honours**.

The seed channel is in the contract because leaving it out reproduces a real defect. cp25's
updated cp03 spec seeds a project as `{ id: 2, ..., archived: true }` and expects the list to
exclude it; at cp25 the projects INSERT has no `archived` column at all, so the flag is silently
dropped, the project seeds active, and the spec fails from the moment it is installed. Support
arrived at cp36 for projects and cp58 for clients — 11 and 29 checkpoints after the specs that
needed it. A seed field that is *accepted and ignored* is the worst kind of interface gap: the
test looks right, the request succeeds, and the assertion fails nowhere near the mistake. An
agent told only the testids would walk straight into it.

`contract.py check` validates the extraction against the erosion harness's own 95 spec files:
every testid, audit record and seed field they use must be in the contract by their checkpoint.
The testid and audit channels pass. The seed channel reports exactly three sites —
`cp25 projects.archived`, `cp29 clients.archived`, `cp44 clients.archived` — which is the same
set the dynamic analysis found from test results (REFERENCE_CHAIN.md §3), reached statically and
without running anything. Two independent methods agreeing on the same three defects is the
strongest evidence available that the diagnosis is right. That check reads those specs **offline, for calibration only** — they are never shown to
the agent (§7). Without it, a pattern gap would silently hand the agent a short contract and the
agent would be blamed for the harness's omission.

## §4 The loop

For each checkpoint N in order, 1..60:

1. **Build the agent's area.** A Landlock-confined directory holding only what the agent may see
   (§4.1), with its own accumulated suite from cp01..N-1 and that suite's git history.
2. **Specify.** The checkpoint specification: the plain-English request, and the interface
   contract for N (§3) — the `data-testid` anchors, the audit-record formats, and the seed fields
   `/__test__/seed` honours. The instruction is explicit that it writes **tests only**: new tests
   for new functionality, and updates to its own existing tests where the request revises
   behaviour they assert.
3. **Write.** The agent works inside the confined area.
4. **Copy back and commit.** The test code is copied out and committed on the run's branch — one
   commit per checkpoint, which is the unit §8 measures.
5. **Grade** (§5): green against checkpoint N's application, then one mutation at a time.

### §4.1 What the agent can see

Inside the confined area:

- its own suite for cp01..N-1, with git history — the view it would have in the pipeline;
- the `e2e/` scaffolding, read-only: `playwright.config.ts`, `package.json`, `node_modules`, and
  `support/seed.ts` + `support/audit.ts`, the two assertion channels;
- the checkpoint specification from step 2;
- **the application at cp(N-1)**, read-only, and runnable — see §4.2.

Unreachable, and `verify_denied` refuses to start the turn if any of it is:

- **the application at cpN** — the implementation of the change it is writing tests for;
- the erosion harness's `acceptance/specs/` — the experimenter's answer;
- `checkpoints.yaml` — future requests and sequence hints;
- `mutations/` — the depth oracle's patches;
- **`reference/`** — easy to overlook and the worst leak of all: `cp01.patch`..`cp60.patch` is
  every future checkpoint's code, including the one being tested. The area is built by
  materialising cp(N-1) *elsewhere* and copying it in; the patch chain itself never enters.

### §4.2 Should the agent see the previous checkpoint's code?

**Yes — cp(N-1), read-only, and let it run the app.** Four reasons:

1. **It is exactly the pipeline's information state.** The pipeline order is request → tests →
   implement. At test-writing time the code that exists is the pre-change code. Withholding it
   measures a situation that will never occur; showing cpN measures one that cannot.
2. **It defuses the objection to showing code at all.** The worry is tests that restate the
   implementation instead of the request. That requires the behaviour to be present — and at
   cp(N-1) the new behaviour is absent. There is nothing to copy; the expected behaviour has to
   come from the request.
3. **It separates two failures that must not score alike.** With no code, a test that fails
   because the agent could not find the nav button is indistinguishable from one that fails
   because the agent misread the request. Only the second is what this measures.
4. **It lets the agent verify the half it legitimately can**: that its prior tests still pass, and
   that its new test fails against cp(N-1). It cannot iterate the new test to green.

That last point is the asymmetry worth protecting. **The agent cannot confirm its new test
passes** — the behaviour does not exist yet. That is the hard part of test-first work and the
main source of test inaccuracy, so it is the thing being measured. Showing cpN would remove it
and turn the exercise into "write a test that passes", which is easy and tells us nothing.

Two consequences to keep in mind:

- At a §2 no-code checkpoint cp(N-1) and cpN are the same application, so there the agent *can*
  iterate to green. Unavoidable, harmless, and consistent with mutation zero inverting (§5).
- `code_view` is therefore a condition, not a constant: `previous` (the default and the
  pipeline-faithful setting), `none` (contract and prior tests only — strictly harder, and it
  conflates navigation failures with comprehension failures), and `current` (diagnostic only — a
  ceiling: if fidelity is poor even with the implementation visible, the problem is not
  information).

### §4.3 Two modes

The loop above is mode-independent. Only step 2–4 — where the tests come from — differs.

**`agent` mode.** The real measurement. The agent writes the tests; they are committed per
checkpoint on the run's branch.

**`replay` mode.** The validation run, and the way this harness is shown to work at all. Instead
of an agent turn, the erosion harness's **own authored suite at checkpoint N** is installed
(`tools/suite.py` — its own spec plus the updated prior copies it ships, later copies winning by
basename, exactly as `run_experiment._authored_specs` resolves it). Nothing is committed: replay
changes no state and can be re-run freely.

Those specs are known-good — they are what the application was built against — so replay mode
answers three questions at once, and all three have to be settled before any agent score means
anything:

| question | what replay shows |
| --- | --- |
| does this harness work? | materialise → confine → install → build → serve → grade, 60 times, on tests whose verdict is already known |
| is the reference chain a sound fixture? | step 1 must be green at every checkpoint. Where it is not, that is a fixture defect, not an agent error (§10, REFERENCE_CHAIN.md) |
| is the mutation catalogue calibrated? | every mutation must be killed by the known-good suite. One that survives is a bad mutation or a hole in the reference suite — unusable for grading either way (§6) |

Replay subsumes the separate calibration step §6 described: calibration *is* replay restricted to
step 2.

`tools/suite.py` is verified against the completed runs: the suite it resolves matches the
capture's `total_selected` exactly at every checkpoint sampled (cp01, 05, 08, 25, 30, 49, 60 →
2, 11, 14, 35, 40, 59, 72). It also confirms the grading rule of §5: the reference suite adds at
least one test at every checkpoint and never shrinks, so a non-decreasing requirement holds on
known-good tests. The leniency of allowing *equal* is headroom for the agent, not a workaround for
the fixture.

## §5 Grading: fidelity testing

**Step 1 — green, and not shrinking.** Run the whole accumulated suite against checkpoint N's
code. Every test must pass: a failure here is a false alarm, which in the pipeline blocks a correct
change. The suite must also hold **at least as many tests as at N-1** — new functionality should
mean new tests, and the suite must never shrink.

Equal is allowed, and deliberately so: a **mutative** checkpoint may be served by rewriting tests
rather than adding any, and a §2 no-code checkpoint may already be covered by the suite. What is
never allowed is a smaller suite — that is a test deleted to make a round go green (step 3).

Run the suite **twice**. A test whose result flips between identical runs is **flaky**, and is
reported separately — in an unattended pipeline a flake is the most expensive kind of wrong test,
because it spends human attention on nothing.

**Step 2 — mutation, one at a time.** For each mutation authored for checkpoint N (§6): apply
that mutation alone to the checkpoint's application, run the suite, and require **at least one
test to fail**. Then revert it and move to the next. A new test failure is the success signal — it
says the agent's tests covered that aspect of the functionality.

One at a time is not an optimisation detail. Mutations applied together are indistinguishable: a
single failing test would mark the whole batch killed, and a suite that pins one clause of the
request would score the same as one that pins them all. Isolation is what makes kill rate mean
"how much of the request is held". Each mutation is also reverted rather than accumulated, so
every run starts from the same known-good application.

Kill rate over the checkpoint's mutation set is that checkpoint's fidelity score, and `survived`
names the mutations nothing caught — the actionable output.

Mutation **zero is free**: the application at N-1 *is* the whole-feature mutation. Removing one
patch from the chain gives a build with the feature absent, and the tests added this round must
fail against it. It needs no authoring, and it catches the dominant failure mode of writing tests
against existing code — tests that restate what the code already does, or that hold both before
and after the change. The authored mutations in §6 then test depth: mutation zero proves the test
notices the feature is gone, and `expect(total).toBeGreaterThan(0)` passes that while pinning
nothing.

At a §2 no-code checkpoint mutation zero inverts: N-1 is the same application, so this round's
tests must **pass** against it, and failing is the defect.

**Step 3 — maintenance.** Prior tests must be *updated*, not deleted. A prior test the agent
removed rather than revised is tracked separately from one it correctly rewrote: deleting the
failing test is the cheap way out, and it is exactly what must not happen across 500 changes.

### Recorded per checkpoint

| metric | step | meaning |
| --- | --- | --- |
| `green` | 1 | the whole suite passes on correct code |
| `tests_total`, `tests_added`, `tests_changed` | 1 | the suite did not shrink, and how it moved |
| `flaky_tests` | 1 ×2 | results that flipped between identical runs |
| `kill_rate` | 2 | mutations killed / mutations authored |
| `survived` | 2 | which mutations no test caught — the actionable list |
| `feature_absent_killed` | 2 (zero) | this round's tests fail at N-1 (inverted where `no_code_change`) |
| `priors_deleted` | 3 | prior tests removed rather than updated |
| `suite_runtime_s`, `test_churn_lines` | 1, §8 | cost and churn as the suite grows |

The headline is the share of checkpoints that are green ∧ not-shrinking ∧ mutation-zero-correct, with
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

**Calibration before use — this is replay mode (§4.3).** Run the *experimenter's* known-good
suite at the checkpoint against every mutation in its set. Each must die. One that survives is
either a bad mutation or a real hole in the reference suite — both worth knowing, and neither
usable for grading an agent until resolved. Grading refuses an uncalibrated set.

There is no separate calibration tool: calibration is replay mode restricted to step 2.

## §7 Blindness

§4.1 lists the area's contents and what must be unreachable. The erosion harness's Landlock
confinement enforces exactly this shape and fails closed if any denied path is reachable; reuse it
unchanged.

The inversion vs the erosion harness: application source is **readable** here — the previous
checkpoint's, which is the input, not a leak (§4.2). What is withheld is every statement of what
the application *should* do, and the implementation that answers it.

The deny list's least obvious entry is `reference/`: the patch chain is every future checkpoint's
code. Build the area by materialising cp(N-1) somewhere else and copying it in — never by giving
the confined area access to the patches.

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

`checkpoints.yaml`'s `mutates` declarations are incomplete, and the erosion harness could not see
the dominant defect in its own fixtures: a mutative checkpoint's **own shipped replacement spec**
can fail from the moment it is installed. Never having passed, it cannot be a regression; and
because it carries the prior checkpoint's basename it scores in the regression category rather
than against the checkpoint's request, so the checkpoint still reports its own test solved.

That is now measured there as `unsatisfied_replacement`, and it accounts for nearly every repair
site: cp25's updated cp03 and cp07 specs and cp29's updated cp01 and cp06 specs fail on arrival in
**10 of 10 chains**. The cause is a seed-contract gap — those specs arrange archived records by
passing `archived: true` to `/__test__/seed`, which no implementation was ever asked to honour.
See REFERENCE_CHAIN.md.

This matters here because §5 step 3 leans on `type`/`mutates` to know which priors *should* have
been revised. Those declarations have to be repaired before the maintenance metric means anything.

## §11 Status

**Built and verified**

- `tools/reference.py` — import and materialise; 60 patches apply in order, digests match.
- `tools/contract.py` — 60 contracts over three channels; testids and audit records calibrate
  clean against all 95 reference spec files, and the seed channel reports exactly the three known
  fixture defects.
- `tools/suite.py` — replay mode's test source; resolution matches the completed runs'
  `total_selected` exactly at every checkpoint sampled, and confirms the non-decreasing rule holds
  on known-good tests.
- `tools/reference_chain.py` — chain ranking and repair-site attribution by kind.

- `fidelity/` — the driver and grader. **Replay mode runs end to end**: materialise → install →
  build → serve → Playwright → grade → mutate one at a time → capture, with the specification
  printed in full and everything written under `results/<run_id>/` as it happens.

**Not built**: the agent turn (§4 — the confined area, copy-back and commit; `--mode agent` exits
with a message), and the mutation catalogue (§6 — format and one worked manifest only; mutation
zero needs no authoring and already runs).

### What a run records, and why those things

Grading leaves numbers; diagnosis needs the irreproducible material behind them. Each checkpoint's
`cpNN.json` keeps **the exact prompt sent** (a bad score is often a bad prompt, and the prompt is
assembled from the contract so it cannot be reconstructed later), the contract as handed over, the
raw `{test_id: passed}` map plus Playwright's full failure text, the suite's file- and test-level
movement, every mutation run with the tests that caught it, and whether application code was
touched. Every aggregate in the verdict is re-derivable from that, so a later question never
requires re-running anything.

Two of those deserve naming. **Application code touched** answers a question the pass/fail numbers
cannot: the agent was told to write tests only, and a run that changed the subject has to be void
rather than silently credited. And test movement is classified as **revised** versus **dropped** —
both look like "an id disappeared", and conflating them is the difference between the maintenance
discipline working and the cheap way out of deleting the failing test.

**Order of work.** Replay mode comes first and needs no agent: it exercises materialise → confine
→ install → build → serve → grade on tests whose verdict is already known, and it is the only way
to tell a harness bug from a fixture defect from a bad test. The reference chain's repair sites
(REFERENCE_CHAIN.md) are then fixed until replay is green at all 60 checkpoints. Authoring the
mutation catalogue and running agent mode come after that.
