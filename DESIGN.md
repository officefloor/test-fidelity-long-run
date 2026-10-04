# test-fidelity-long-run — design

## §1 The question

`~/ui-long-degradation-test` answered **can the architecture absorb 60 changes without eroding**.
It held the *tests* fixed (experimenter-authored Playwright specs) and let the agent write the
*application*. The answer was yes for OfficeFloor + TanStack.

This harness **reverses the two**. It holds the *application* fixed and correct, and lets the
agent write the *tests*:

> Given a plain-English change request and an application that already implements it correctly,
> can an agent produce an acceptance test that actually pins that behaviour — and keep a suite of
> them honest across 60 consecutive changes?

That is the one unproven link in the AI-augmented pipeline (English change → refined request →
**tests** → implementation → review). If the generated test is wrong, every downstream stage is
verifying the wrong thing, and 300–500 unattended changes will drift without ever going red.

Erosion of the application is **not** measured here. Erosion of the *test suite* is (§8).

## §2 The fixed application: the reference chain

The subject under test is one of the evolved chains from the erosion harness, checked out at the
commit for each checkpoint. It must be correct with respect to **every** request 1..N at each
checkpoint N — otherwise a generated test that fails has told us nothing about the agent.

No existing chain is fully clean. The repair needed is small, systematic, and documented in
**[REFERENCE_CHAIN.md](./REFERENCE_CHAIN.md)**; `tools/reference_chain.py` ranks the candidates
and names the repair sites. The chain in use is pinned in `config.yaml` by repo + branch, and the
harness refuses to run until that chain grades clean.

Two commits exist per checkpoint (`cpNN agent`, then `cpNN reset` restoring pinned scaffolding).
The **reset** commit is the application state for checkpoint N: it is what the erosion harness
graded.

The reference chain is a **fixture**, not a subject. It is never modified by a run.

## §3 The loop

For each checkpoint N in order (1..60):

1. **Materialise** the reference application at the `cpNN reset` commit into a worktree. The agent
   may read and run it. It may **not** edit application source — a run that touches it is void.
2. **Agent turn.** The agent sees: the plain-English request for N, the application, and the test
   suite *it has itself written* for 1..N-1. It writes the test(s) for N, and updates its own
   prior tests when the request revises earlier behaviour. It can run its tests as it works.
3. **Score** against the four oracles (§4). Record, commit, move on.

The suite **accumulates**, exactly as the erosion harness's application did. The interesting
failures are late, where the agent is maintaining 100+ of its own tests it no longer remembers
writing.

## §4 The four oracles

The problem with grading generated tests is that there is no second source of truth to compare
against — and comparing against the experimenter's reference spec only measures imitation. These
four oracles are all mechanical, and three of them are free.

**O1 — Soundness: the suite must pass on the correct application.**
Every test the agent has written, run against the reference app at cpN. A failure here is a false
alarm: in the pipeline it would block a correct change. Run twice; any test that flips is **flaky**
and counted separately — flakes are the most expensive failure mode in an unattended pipeline.

**O2 — Relevance: this round's tests must FAIL on the application at cp(N-1).**
Check out the *previous* checkpoint — the app without this feature — and run only the tests added
or updated this round. They must fail. If they pass, the agent wrote a test that does not test the
change it was asked to test.

This is the cheapest and sharpest oracle in the design. It costs one extra checkout, needs no
authored fixtures, and it catches the dominant failure mode of test generation from a codebase:
tests that restate what the code already does, or that assert something true both before and after.

**O3 — Depth: the suite must kill the authored sabotage set for cpN.**
O2 proves the test notices a feature's total absence. It does not prove the test pins the
behaviour's *details* — `expect(total).toBeGreaterThan(0)` passes O2 and is nearly worthless. So
each checkpoint carries a small set of **sabotages** (§6): minimal patches against the reference
app that each break one specific aspect of the requested behaviour. Kill rate on that set is the
depth score.

**O4 — Maintenance: priors must survive, and revisions must be carried through.**
At an additive checkpoint, every prior test must still pass (O1 covers it). At a **mutative**
checkpoint — one whose request deliberately revises earlier behaviour — the prior tests asserting
the now-obsolete behaviour *must* have been updated by the agent, and the updated versions must
pass. An un-updated prior that now fails is a maintenance miss; one the agent *deleted* rather
than updated is a worse one, tracked separately (deleting the failing test is the cheap way out,
and is exactly what must not happen across 500 changes).

`checkpoints.yaml` already declares `type` and `mutates` per checkpoint, so O4 needs no new
authoring — but note those declarations are themselves incomplete (REFERENCE_CHAIN.md), and O4 is
only as good as they are. Repairing them is part of §2.

### Diagnostic, not a gate

**Reference overlap.** The experimenter's spec for cpN already exists in the erosion harness. It is
never shown to the agent, but comparing the two — which `data-testid` anchors each binds, which
sabotages each kills — says whether the agent found the *same* behaviour a human thought was the
point. Reported as context for a low score, never as a pass/fail: a generated test that pins the
behaviour differently but just as tightly is a success, not a deviation.

## §5 Scoring

Per checkpoint:

| metric | from | meaning |
| --- | --- | --- |
| `sound` | O1 | all of the agent's tests pass on the correct app |
| `flaky_tests` | O1 ×2 | tests whose result flipped between identical runs |
| `relevant` | O2 | every test added/updated this round fails without the feature |
| `kill_rate` | O3 | sabotages killed / sabotages authored for this checkpoint |
| `maintained` | O4 | required prior revisions made, and passing |
| `priors_deleted` | O4 | prior tests removed rather than updated |
| `tests_added`, `suite_runtime_s` | suite | cost of the suite as it grows |
| `test_churn_lines` | git | lines of its own earlier tests this round rewrote (§8) |

The headline is a **fidelity rate**: the share of checkpoints that are sound ∧ relevant ∧
maintained, with mean kill rate reported beside it. A checkpoint failing any of the three is a
point where the pipeline would have proceeded on a test that did not hold.

The run-level question is whether fidelity *degrades with suite size* — the same slope-with-CI
treatment the erosion harness applies, over checkpoint index.

## §6 The sabotage catalogue

A **sabotage** is a stored unified diff against the reference app at a given checkpoint, breaking
exactly one aspect of one request's behaviour. Authored once by the experimenter, reused by every
run and every agent. Deterministic — an LLM-generated defect per run would make the instrument
non-repeatable, which is the whole point of having one.

```
sabotage/cp08/manifest.yaml     # ids, what each breaks, which request aspect it targets
sabotage/cp08/001-*.patch       # minimal diff vs the reference app at cp08
```

Each sabotage must: apply cleanly, leave the app **building and serving** (a sabotage that fails
to compile is killed by everything and measures nothing), and change observable behaviour.

**Calibration before use.** Run the *experimenter's* reference suite against every sabotage. A
sabotage the reference suite cannot kill is either a bad sabotage or a genuine hole in the
reference suite — both worth knowing, and neither usable for scoring an agent until resolved. The
catalogue is only an oracle once calibrated; `--calibrate` does this and refuses uncalibrated
sabotages at scoring time.

Sabotages are pinned to the reference chain's source, so they are **stack-specific**. That is
acceptable: the reference chain is the fixture. A second stack needs its own catalogue, which is
the main cost of adding one.

## §7 Blindness

The agent must not see:

- the experimenter's reference specs (it would copy them, measuring nothing),
- the sabotage catalogue (it would target the patches instead of the behaviour),
- future change requests,
- `checkpoints.yaml` (sequence hints).

The erosion harness's Landlock confinement (`harness/landlock.py`) already enforces exactly this
shape of guarantee and fails closed if any of those paths is reachable. Reuse it unchanged. Note
the inversion: here the agent *may* read application source — that is the input, not a leak.

## §8 Test-suite erosion

The secondary question, and the one that decides whether 300–500 changes is realistic: does the
*generated suite* rot? A suite that doubles in runtime every 20 changes, or whose each round
rewrites swathes of earlier tests, will not survive unattended even at perfect fidelity.

`metrics.reedit_line_stats` and `metrics.hot_surface` in the erosion harness are git-only and
layer-agnostic — point them at the generated test directory and they answer this directly: how
much settled test code each round destroys, how old it was, and whether churn concentrates in a
few files. Reuse them as-is; no new measurement code.

## §9 Terminology

`mutative` is already taken: in `checkpoints.yaml` it means *a change request that revises prior
behaviour*. This harness keeps that meaning, and calls the injected-defect step **sabotage** — the
literature's "mutation testing", renamed so the two never read as the same thing. "Kill rate"
keeps its usual sense.

## §10 Reused from the erosion harness

Not forked — imported, so a fix lands once:

| module | used for |
| --- | --- |
| `correctness.py` | build/serve/Playwright, test ids, pass parsing. The scoring differs; the runner does not. |
| `agent.py` | the agent turn, cost/token capture |
| `landlock.py` | §7 blindness |
| `capture.py` | per-checkpoint committed record |
| `metrics.py` | §8, test-suite churn only |
| `checkpoints.yaml` | the 60 requests, `type`, `mutates` |

What is genuinely new is small: the three-oracle scorer, the sabotage catalogue and its
calibration, and a driver that moves the app backwards (O2) as well as forwards.

## §11 Status

Built: this design, `tools/reference_chain.py` (reference-chain selection + repair sites),
REFERENCE_CHAIN.md (the finding), the sabotage format.

Not built: the driver, the scorer, the sabotage catalogue, `config.yaml` is a skeleton.

Blocked on §2 — the reference chain needs its 4 repair sites resolved before any score means
anything. That is the next piece of work, and REFERENCE_CHAIN.md says exactly where to look.
