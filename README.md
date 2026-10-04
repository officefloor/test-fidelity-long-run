# test-fidelity-long-run

**Can an agent write the tests?** Sibling to `~/ui-long-degradation-test`, with the two halves
swapped: that harness fixed the tests and grew the application, and showed OfficeFloor + TanStack
absorbs 60 plain-English changes without eroding. This one **fixes the application and grows the
test suite**, to find out whether generated acceptance tests actually pin the behaviour that was
asked for — the unproven link in the English → request → **tests** → implement → review pipeline.

A wrong test is worse than no test: the pipeline goes green and proceeds. At 300–500 unattended
changes that is the failure that compounds.

- The application is a **reference chain** — an evolved chain from the erosion harness, checked
  out per checkpoint, correct for every request up to that point, never modified by a run.
- The agent sees the request, the app, and **its own** accumulated suite. Never the experimenter's
  specs, never the sabotage catalogue (Landlock-enforced, fails closed).
- Each round is graded by four mechanical oracles: the suite **passes** on the correct app; this
  round's tests **fail** on the app *without* the feature; the suite **kills** the authored
  sabotages for that request; and priors are **maintained** rather than deleted.

The second oracle is the cheap, sharp one — it needs no authored fixtures (the previous
checkpoint's commit *is* the fixture) and it catches tests that merely restate what the code does.

See **[DESIGN.md](./DESIGN.md)** for the method and **[REFERENCE_CHAIN.md](./REFERENCE_CHAIN.md)**
for which chain to use and what must be repaired first.

## Running

```sh
# which evolved chain is closest to all-green, and where each needs repair
~/ui-long-degradation-test/.venv/bin/python tools/reference_chain.py \
    --harness ~/ui-long-degradation-test --stacks ~
~/ui-long-degradation-test/.venv/bin/python tools/reference_chain.py \
    --harness ~/ui-long-degradation-test --stacks ~ --run 202610020135 --json
```

Nothing else runs yet — see Status.

## Status

**Built**: the design; `tools/reference_chain.py`; the reference-chain finding and repair plan;
the sabotage catalogue format.

**Not built**: the driver, the scorer, the sabotage catalogue, `config.yaml` (skeleton only).

**Blocked first on the reference chain.** No existing chain is all-green, and until one is, a
failing generated test is ambiguous — the agent or the app. The good news from
`reference_chain.py`: own-test failures are **zero across all 10 chains** (the app always
implements the current request), and the breakage is six (step → prior) pairs recurring in 9–10 of
10 chains across three stacks and both conditions — i.e. experimenter-side, not agent-side. The
best chain needs 4 repair sites, not a fresh 60-checkpoint run.

## Terminology

`mutative` keeps its `checkpoints.yaml` meaning — *a change request that revises earlier
behaviour*. The injected-defect step is called **sabotage** (mutation testing, renamed) so the two
never read as the same thing.
