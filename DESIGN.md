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
reference/manifest.yaml    source repo NAME + ORIGIN URL, branch, commit per checkpoint,
                           patch digests
```

Provenance is recorded by repo name and origin URL, never by the local path the stack happened to
be cloned to: a path says nothing to anyone else, and nothing to this machine a year from now,
whereas the origin is how the chain a fixture came from is actually found again. The same pair
goes into every checkpoint's capture.

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

**`agent` mode.** The real measurement. The agent writes the tests in the confined area; the
`*.spec.ts` files are copied back and committed per checkpoint on the run's branch
(`runs/<run_id>/suite`, branch `agent/<run_id>`), and the run ends with one further commit
carrying the whole capture — the prompts, the streamed agent turns, the gate output and the
mutation verdicts — in the same repository as the suite, so reviewing a run is one `git log` and
the evidence cannot drift from the tests it explains.

Confinement is fail-closed and, unlike the erosion harness, has no fallback: there the mirror
hid the prior specs and Landlock was belt-and-braces, whereas here withholding the answers **is**
the confinement, so an unavailable Landlock refuses the run rather than warning.

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
code **twice** (`grading.green.repeats`, default 2). Every test must pass every time: a failure
here is a false alarm, which in the pipeline blocks a correct change — and a test that passes once
and fails once is not a passing test. The union of failures across repeats is what counts, which
also keeps the mutation baseline honest: crediting a mutation for what was really a flake would
inflate the kill rate. The suite must also hold **at least as many tests as at N-1** — new functionality should
mean new tests, and the suite must never shrink.

Equal is allowed, and deliberately so: a **mutative** checkpoint may be served by rewriting tests
rather than adding any, and a §2 no-code checkpoint may already be covered by the suite. What is
never allowed is a smaller suite — that is a test deleted to make a round go green (step 3).

A test whose result flips between identical runs is **flaky**, and is reported separately from a
hard failure so the two are distinguishable when diagnosing. In an unattended pipeline a flake is
the most expensive kind of wrong test, because it spends human attention on nothing — and a
generated suite is more prone to it than a hand-written one (a missing wait, a race on an async
render). Running once cannot tell a flake from a pass, which is why twice is the default rather
than an option.

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
mutations/cp08.yaml     the set for checkpoint 08: find/replace, the clause each breaks, and why
```

**128 mutations across all 60 checkpoints**, every one verified to apply exactly once
(`tools/mutate.py validate`). Authored once by the experimenter and reused by every run —
deterministic on purpose. Generating defects with an LLM per run would make the instrument
non-repeatable, and a measuring instrument that moves is not one.

They are exact-match **substitutions**, not patches. The `repairs/` layer started as patches and
taught the lesson: a unified diff applies against surrounding context, so it can land in the wrong
place, apply with fuzz, or silently no-op when a neighbouring line moves. A substitution either
matches once or raises, and the whole catalogue can be checked without building anything.

Where a mutation would have been unkillable by the experimenter's own spec, it was left out and
the **reference-suite hole** recorded instead (`mutations/README.md` lists all four) — a mutation
no test could catch measures the harness, not the suite.

Rules for a usable mutation: it applies cleanly; the app **still builds and serves** (a mutation
that breaks the build is killed by everything and scores the compiler, not the suite); it changes
behaviour observable through the UI or the audit file; it is minimal and single-aspect; and it is
derived from a **clause of the English request**, so kill rate reads as "how much of what the user
asked for does this suite hold".

**Calibration before use — this is replay mode (§4.3).** Run the *experimenter's* known-good
suite at the checkpoint against every mutation in its set, with `--calibrate` to write the result
back into each manifest. Each must die. One that survives is
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

### §8.1 Analysis is post-hoc, not part of the run

`fidelity/analyse.py` reads a finished run and derives suite cost, suite churn and the
degradation slope. Deliberately separate from the driver: a run's job is to produce the
irreproducible material — the prompts, the agent turns, the pass/fail maps, the mutation verdicts
— and a ten-hour run should not also be deciding how to summarise itself. Everything analysis
produces is derived, so it can be re-run, corrected and re-run again against a finished run at no
cost. That matters most for the part most likely to need changing.

The degradation slope carries one deliberate restraint. With **one** chain it reports a slope and
**no confidence interval**: checkpoints within a chain are not independent — cp30's suite is
cp29's plus one — so resampling them would report an interval far narrower than the evidence
supports. With two or more chains it resamples **chains**, which is the same reason the erosion
harness aggregates to chain level before testing anything. This is also why `chains` defaults
to 2.


The secondary question, and the one that decides whether 300–500 changes is realistic: does the
generated suite rot? A suite that doubles in runtime every 20 changes, or whose each round rewrites
swathes of earlier tests, will not survive unattended even at perfect fidelity.

`metrics.reedit_line_stats` and `metrics.hot_surface` in the erosion harness are git-only and
layer-agnostic. Pointed at the generated test directory they answer this directly: how much settled
test code each round destroys, how old it was, and whether churn concentrates in a few files. The
per-checkpoint commits from §4 are what they read. No new measurement code.

## §9 Reused from the erosion harness

This repo has its own venv and its own pinned dependencies (`./setup.sh`, `requirements.txt`) —
PyYAML for the manifests and contracts, and lizard for §8. It borrowed the erosion harness's venv
at first, which worked and was wrong: a run's meaning would shift whenever that harness's
dependencies moved, and a fresh clone had no way to know it needed someone else's venv at all.

What is still borrowed is CODE, imported by path rather than vendored so a fix lands once. Those
modules are pure stdlib, so they run cleanly under this venv — `setup.sh` checks that import
specifically, because it is the thing that actually breaks: `correctness.py` (build/serve/Playwright, test ids,
pass parsing), `agent.py` (the agent turn, cost/token capture), `landlock.py` (§7), `capture.py`
(the committed per-checkpoint record), `metrics.py` (§8 only), and `checkpoints.yaml` (the 60
requests with their `type` and `mutates`).

Genuinely new, and small: the grader, the mutation catalogue and its calibration, the contract
extractor, and a driver that can move the application *backwards* for mutation zero.

The erosion harness's location is configurable (`erosion_harness`, or `EROSION_HARNESS` for
`setup.sh`), so it does not have to sit at `~/ui-long-degradation-test`.

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

## §10.1 Defaults are the rigorous setting

A run with no arguments is the *proper* measurement; every flag trades rigour away for speed or
cost, never towards it. That principle settles several choices that would otherwise be arbitrary:

| default | why | the flag that trades it away |
| --- | --- | --- |
| `repeats: 2` | running once cannot distinguish a flake from a pass | `--repeats 1` |
| `chains: 2` | one agent run can be lucky; the agent is stochastic | `--chains 1`, `--chain N` |
| mutations on | kill rate is the depth oracle | `--no-mutations` |
| `code_view: previous` | the pipeline's own information state (§4.2) | `--code-view none/current` |
| `require_calibrated: true` | an uncalibrated set cannot grade anything | config only |
| `one_at_a_time: true` | batched mutations are indistinguishable (§5) | config only |
| `blind.strict: true` | a leak should stop the turn, not be noted in passing | `blind.known_leaks` |

`blind.strict` was briefly off, for a bad reason: the stack's base scaffolding carries a handful
of pre-existing `cpNN` comments, so strict mode refused every run. A loose default was the wrong
fix. The right one is to **acknowledge those specific hits** (`blind.known_leaks`, matched on
file + substring so they survive the line moving) and keep refusing everything else.

**Replay collapses `chains` to 1** and says so. Replay is deterministic — the same specs against
the same application — so a second chain re-measures nothing but environmental flakiness, which
`repeats` already measures per checkpoint at a fraction of the cost. `--chains` overrides it.

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

- `fidelity/sandbox.py`, `fidelity/turn.py` — **agent mode**: the confined area, the turn with its
  retry policy, copy-back, the per-checkpoint suite commit and the final capture commit.
  Confinement verified on this host (Landlock ABI 8): all six withheld paths denied, the sandbox
  reachable.

- `mutations/` + `tools/mutate.py` — **the catalogue**: 128 mutations across all 60 checkpoints,
  each tied to a clause of its request, all verified to apply exactly once. cp02 is calibrated
  against a real gate run (3/3 killed, each by exactly the test it should be).

**Not built**: nothing structural. What remains is the work the harness exists to do — a full
replay (which calibrates the catalogue and proves the fixture), the two outstanding fixture
repairs, and then agent runs. Flake detection, suite runtime and churn, and the degradation slope are
now in place — the last three in `fidelity/analyse.py` rather than in the run (§8.1).

### §11.1 What the agent's area actually contains

Assembled fresh each checkpoint, and two details are load-bearing rather than incidental.

**The application copy carries no `.git`.** The materialised reference tree has one commit per
checkpoint, messaged `cp24 reference code` — which states the checkpoint number outright. Any
agent that ran `git log` would learn exactly where it sits in a sequence it is meant to know
nothing about. So the application is copied as plain files, and the only repository in the
sandbox is the suite's.

**The suite IS a repository, rooted at `e2e/specs`.** That is what makes "see the history of all
tests" true rather than approximately true: the agent reads the log of its own work, as it would
in the pipeline. It is a clone, so nothing it does to that history reaches the run's real suite —
only the `*.spec.ts` files are copied back.

**The stack's own documentation is withheld too.** `BASE_CHECKLIST.md` explains the experiment
outright ("one full-stack English change request per checkpoint", "cp01 adds `V1__*.sql`"), and
`README.md` and `stack.yaml` name the harness and the sequence. `CLAUDE.md` and `AGENTS.md` stay:
they are the stack's conventions and carry no reference to either — checked, not assumed.

**And the sandbox is scanned, not just filtered.** The deny list and the doc exclusions are
reasoning about what *should* be absent; `sandbox.leak_scan` checks what *is* there, because a
changed stack doc or a new base file can reintroduce a hint no allowlist would catch. Hits are
split by what they actually give away: a **hard** hit names a specific checkpoint or the harness;
a **soft** hit only reveals that a checkpointed run exists. The stack's base scaffolding carries
a few of each in source comments that predate this harness (`pom.xml`: "Found via the cp01 dry
run"), so hits are reported once per run and recorded in the capture, and `blind.strict` decides
whether a hard one refuses the turn.

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
