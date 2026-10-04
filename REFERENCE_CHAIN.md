# The reference chain — finding and repair plan

The harness needs a fixed application that is **correct with respect to every request 1..N at each
checkpoint N** (DESIGN.md §2). This is what the existing erosion runs can and cannot supply.

Reproduce with:

```sh
~/ui-long-degradation-test/.venv/bin/python tools/reference_chain.py \
    --harness ~/ui-long-degradation-test --stacks ~
```

## 1. The agent never failed to implement a request

Across all 10 chains (5 runs × 2 chains, 3 stacks, both conditions), **own-test failures = 0**.
Every checkpoint's own acceptance test passed at that checkpoint, in every chain. The application
always implements the change it was asked for.

This matters for the reversed harness: it means the reference app is trustworthy *for the current
request* at every one of the 60 steps. The problem is only with **priors**.

## 2. No chain is clean, and the reported headline overstates it

`strict-pass 48/120` and `Zero-Regression Rate 0.000` in the erosion summaries are harsher than
the underlying reality: `strict_pass` requires every selected test id to pass, and at a mutative
checkpoint the updated prior specs change test *titles*, so the old ids vanish and count as
regressions. Most regressions in the best run classify as `intended`.

The honest measure for our purpose is: **at how many steps does a prior checkpoint's test fail?**
`mutates` does not excuse it — what `mutates` excuses is a prior test the checkpoint *replaced*,
and a replaced test is gone from the suite, not failing in it (§3). Ranked:

| repair sites | dirty steps | run | condition | stack | chain |
| --- | --- | --- | --- | --- | --- |
| **4** | 36 | 202610020135 | just-solve | officehq-tanstack-officefloor | **2** |
| 5 | 36 | 202610021156 | just-solve | officehq-react-officefloor | 1 |
| 5 | 36 | 202609301425 | gated | officehq-tanstack-officefloor | 1 |
| 5 | 38 | 202610020135 | just-solve | officehq-tanstack-officefloor | 1 |
| 5 | 40 | 202609291349 | gated | officehq-react-officefloor | 1 |
| 6–7 | 36–42 | (the remaining five) | | | |

The chosen chain's four sites are `cp25 -> cp03, cp07`, `cp29 -> cp01, cp06`, `cp49 -> cp21` and
`cp60 -> cp41`. "Dirty steps" is high because a single unrepaired prior stays failing for the rest
of the chain — 36 dirty steps come from 4 defects, not 36.

## 3. The breakages are experimenter-side, and they are failing REPLACEMENT SPECS

Earlier this section attributed the recurring breakages to cp26, cp30 and cp50. That was **one
checkpoint late in every case**, because scoring treated `mutates` as a blanket excuse: a prior
test failing at the mutative checkpoint that declared it was recorded as `intended`, and the same
still-failing test only became visible at the *next* checkpoint, which declared nothing. The
corrected attribution (`reference_chain.py`, and `unsatisfied_replacement` in the erosion harness):

| step | prior it breaks | chains | kind |
| --- | --- | --- | --- |
| cp25 | cp03, cp07 | 10/10 | replacement failed |
| cp29 | cp01, cp06 | 10/10 | replacement failed |
| cp49 | cp21 | 9/10 | replacement failed |
| cp44 | cp01 | 8/10 | replacement failed |
| cp48 | cp31 | 4/10 | replacement failed |
| cp60 | cp41 | 10/10 | undeclared |

"Replacement failed" means the checkpoint **shipped an updated copy of that prior spec, and the
copy failed from the moment it was installed**. Such a test is invisible to every existing
measure: never having passed it cannot be a regression, and because it carries the prior's
basename it scores in the regression category rather than against the checkpoint's own request —
so cp49 reports `func_p 1/1`, its own request solved, while the cp21 spec it shipped to define the
effect on invoices fails.

### Root cause: a seed-contract gap, confirmed two ways

`tools/contract.py check` now compares every seed field the reference specs pass against the
fields `/__test__/seed` actually honours at that checkpoint, statically and without running
anything. It reports exactly three sites:

```
cp25: seed field NOT HONOURED by /__test__/seed -> ['projects.archived']
cp29: seed field NOT HONOURED by /__test__/seed -> ['clients.archived']
cp44: seed field NOT HONOURED by /__test__/seed -> ['clients.archived']
```

That is the same set the dynamic analysis found from test results, reached by an independent
method. The mechanism:

cp25's updated `cp03_projects.spec.ts` arranges its fixture like this:

```ts
projects: [
  { id: 1, name: 'Website Rebuild', clientId: 1 },
  { id: 2, name: 'Old Site', clientId: 1, archived: true },
],
...
await expect(page.getByTestId(/^project-row-/)).toHaveCount(1);
```

It gets 2. The application's archiving works — cp25's own acceptance test passed in every chain —
but **`/__test__/seed` never honoured an `archived` field**, so the record seeds unarchived and the
list correctly shows both. Nothing ever asked an implementation to support it: the request says
"tuck it away" (a UI action), the agent sees only its own spec, and that spec archives through the
UI. The updated prior specs then arrange the same state through a seed field that does not exist.

cp29 → cp01/cp06 and cp44 → cp01 are the same shape for archived *clients*. cp49 → cp21 is
different and genuinely behavioural: the updated cp21 spec expects tax in the invoice amount
(`$1,200.00`) and gets `$1,000.00`.

**The gap closes on its own, far too late.** Seed support for `archived` arrives at **cp36** for
projects and **cp58** for clients — 11 and 29 checkpoints after the specs that needed it, added
by whichever later checkpoint happened to require it. So these specs fail on arrival, stay failing
for a long stretch, and then silently start passing.

**The repair is small and surgical: backport the seed support.** Add the `archived` column to the
projects insert in cp25's `TestSupportController` and to the clients insert in cp29's — about four
lines each, lifted verbatim from the cp36 and cp58 versions. `TestSupportController` is
profile-guarded test-support code that the harness explicitly treats as evolving app code, so
changing it alters no product behaviour and keeps the fixture faithful. The alternative — rewriting
the updated prior specs to arrange archived state through the UI — also works but changes what
those specs test.

Either way: no product-code change, and no re-run.

## 4. Two checkpoints were never implemented

cp40 (thousands separator) and cp50 (combined filter) both produced a **zero-byte diff** — the
agent ran, changed nothing, and its own acceptance test passed, because earlier code already
satisfied the request. Their specs therefore do not test what they claim to: each is satisfiable
without the change it describes.

For this harness they are **kept and graded** (DESIGN.md §2): they test whether the agent
recognises a request its suite already covers. Only mutation zero inverts there.

## 5. cp60 → cp41 is the one metadata defect

cp60 asks to "keep the totals separate for each currency"; cp41's spec asserts
`dashboard-outstanding-total` has text `$100.00`, and the element is gone — correctly, because
cp60 replaced it with per-currency totals. cp60 declares `mutates: [8, 17, 33, 40, 48, 55]` and
owes cp41 the same: declare it and ship an updated `cp41_invoice_cancel_audit.spec.ts` in
`acceptance/specs/cp60/`.

## 6. A non-blind run will not fix any of this

Re-running non-blind cannot produce a clean chain. The dominant defect is a spec arranging state
through a seed field the contract does not define — an agent shown that spec would have to invent
the seed behaviour — and cp60 → cp41 would still force a choice between failing cp41's stale spec
and contradicting cp60's own request. The fixtures have to be repaired first, whatever else is done.

## 7. Plan

1. ~~**Backport the seed support**~~ — **done**, as `repairs/` (DESIGN.md §2): `projects.archived`
   from cp25 (two variants, since cp34 reshapes the block) and `clients.archived` from cp29, each
   lifted verbatim from the upstream checkpoint that added it. `reference.py verify-repairs`
   confirms all three apply at every checkpoint in range (cp25..cp57) and that upstream has fixed
   each by its `until`; `contract.py check` now reports no seed misses on any of the 95 specs.

   This addresses **two of the chosen chain's four sites** (cp25 → cp03/cp07 and cp29 →
   cp01/cp06), and cp44 → cp01 in the other chains. Note that `reference_chain.py` still reports
   four: it grades the erosion runs' historical capture, which no repair can change. Whether the
   repair works is a replay-mode question.
2. **Declare cp60's mutation of cp41** and ship the updated copy.
3. **Diagnose cp49 → cp21** (tax in the invoice amount) — the one genuinely behavioural site.
4. **Adopt** `officehq-tanstack-officefloor evolve/202610020135/just-solve/chain2`: the fewest
   repair sites, and the TanStack + OfficeFloor combination this work is standardising on. Pin it
   in `config.yaml`; the harness refuses to run until `reference_chain.py` grades it 0 sites.

Remaining after step 1: **cp49 → cp21** (the tax behaviour) and **cp60 → cp41** (the undeclared
mutation). Step 2 is a spec edit. Step 3 is the only
one that may touch product code, and the erosion harness can rebuild and re-gate a single
checkpoint on demand — far cheaper than a fresh 60-checkpoint run, which would not have settled it
anyway.

**Replay mode is how this gets verified** (DESIGN.md §4.3): run it across all 60 checkpoints and
every remaining red is a fixture defect, since the suite it installs is known-good. Repair until
replay is green.
