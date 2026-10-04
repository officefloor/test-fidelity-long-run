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
regressions. 56 of 62 regressions in the best run are classified `intended`.

The honest measure for our purpose is: **at how many steps does a prior test fail without that
prior being declared in the step's `mutates`?** Ranked:

| repair sites | dirty steps | run | condition | stack | chain |
| --- | --- | --- | --- | --- | --- |
| **4** | 35 | 202610020135 | just-solve | officehq-tanstack-officefloor | **2** |
| 5 | 35 | 202609301425 | gated | officehq-tanstack-officefloor | 1 |
| 5 | 35 | 202610021156 | just-solve | officehq-react-officefloor | 1 |
| 5 | 37 | 202610020135 | just-solve | officehq-tanstack-officefloor | 1 |
| 5 | 40 | 202609291349 | gated | officehq-react-officefloor | 1 |
| 6–7 | 35–42 | (the remaining five) | | | |

## 3. Six breakages are experimenter-side, not agent-side

These (step → prior) pairs recur in 9 or 10 of the 10 chains — across three stacks, two
conditions and five runs:

| step | breaks | chains | the step's request |
| --- | --- | --- | --- |
| cp26 | cp03, cp07 | 10/10 | "put labels on projects so I can group them" |
| cp30 | cp01, cp06 | 10/10 | "record what a client has paid on an invoice" |
| cp50 | cp21 | 9/10 | "filter by two things at once" |
| cp60 | cp41 | 10/10 | "different clients pay me in different currencies" |

Independent stacks under different conditions do not break the same prior at the same step by
chance. Each is one of: an under-declared `mutates`, a stale updated-prior spec copy that did not
carry forward an earlier mutation, or a request every stack implements the same wrong way.

**cp60 → cp41 is clear-cut and is a metadata defect.** cp60 asks to "keep the totals separate for
each currency"; cp41's spec asserts `dashboard-outstanding-total` has text `$100.00`, and the
element is gone — correctly, because cp60 replaced it with per-currency totals. cp60 declares
`mutates: [8, 17, 33, 40, 48, 55]` and owes cp41 the same treatment: declare it and ship an
updated `cp41_invoice_cancel_audit.spec.ts` in `acceptance/specs/cp60/`.

The other three show as off-by-one row counts (`Expected 1, Received 2` on
`project-row-`/`client-row-` locators, in specs titled "excluding archived"), i.e. the archive
filter stops being applied on a list. That reads as a real behaviour loss rather than stale
expectations — but it is reproducible in every stack, which points at the *request* at cp26/cp30
leading every implementation down the same path. Needs one look at the running app to settle;
the diagnosis changes the fix, not the plan.

## 4. A non-blind run will not fix this

Re-running non-blind (agent sees all prior specs) cannot produce a clean chain while cp60
under-declares its mutations: the agent would be shown cp41's stale spec and either fail it, or
satisfy it by keeping a single-currency total — contradicting cp60's own request. The spec
metadata has to be repaired first, whatever else is done.

## 5. Plan

1. **Repair the metadata**: cp60 declares `mutates: [41]` + ships the updated cp41 spec copy.
   Cheap, and correct independent of this harness — the erosion harness is miscounting a true
   regression today.
2. **Diagnose cp26 / cp30 / cp50** against the running reference app. If behaviour loss, repair
   the app at those three steps on the chosen chain (the `cpNN reset` commit) and re-run the
   erosion gate from that step to confirm the chain goes green and stays green.
3. **Adopt** `officehq-tanstack-officefloor evolve/202610020135/just-solve/chain2` — the fewest
   repair sites, and the TanStack + OfficeFloor combination this work is standardising on. Pin it
   in `config.yaml`; the harness refuses to run until `reference_chain.py` grades it 0 sites.

Step 1 is minutes. Step 2 is the real work, and it is bounded: three steps, one app, and the
erosion harness already rebuilds and re-gates a single checkpoint on demand. Far cheaper than a
fresh 60-checkpoint non-blind run, which would not have settled it anyway.
