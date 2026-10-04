# Mutation catalogue

A **mutation** is an exact-match text substitution in one file of the reference application,
breaking exactly one aspect of one change request's behaviour (DESIGN.md §6). It is the depth
oracle: a generated suite is credited for each mutation it turns red.

> A **mutative checkpoint** is a different thing — `checkpoints.yaml`'s term for a change request
> that revises earlier behaviour. "Mutation", "mutant" and "kill rate" here are mutation testing
> in the usual sense.

**128 mutations across all 60 checkpoints.** `tools/mutate.py coverage` shows the spread;
`tools/mutate.py list` shows each one and the clause it breaks.

## Why substitutions, not patches

The format started as `.patch` files and changed after the `repairs/` layer taught the lesson: a
unified diff applies against surrounding **context**, so it can land in the wrong place, apply
with fuzz, or silently no-op when a neighbouring line moves. A substitution either matches
exactly once or it raises — and `tools/mutate.py validate` checks all 128 without building
anything.

```yaml
- id: "001-outstanding-includes-paid-invoices"
  clause: "how much money I am still owed"      # the fragment of the request this breaks
  file: src/main/java/.../DashboardGetLogic.java
  breaks: |
    why this is hard to catch, and what kind of test catches it
  find: "                .filter(i -> \"UNPAID\".equals(i.getStatus()))"
  replace: "                // mutation: paid invoices count as outstanding too"
```

`find` and `replace` are **double-quoted scalars**, never `|` literal blocks: YAML strips a
block's common leading indentation, so a `|` block silently loses the source's indentation and
then matches nothing. They were generated from the real source rather than typed, which is why
all 128 match first time.

## What makes a mutation usable

1. **Applies exactly once** at its checkpoint. Zero means the code moved; more than one means the
   kill it earns is ambiguous.
2. **Still builds and serves.** One that breaks the build is killed by every test and scores the
   compiler, not the suite.
3. **Changes behaviour observable through the UI or the audit file** — the two channels the
   contract declares. A defect no test could possibly reach measures the harness, not the suite.
   This is why, for example, cp02 mutates the form's validation and not the server's 400: through
   the UI the form blocks first, so breaking only the server changes nothing a test can see.
4. **Minimal and single-aspect.** "Breaks everything" gives a kill a test can earn by accident.
   cp02 demonstrates the discipline working: mutation 001 is killed only by the blank-email test
   and 002 only by the malformed-email test.
5. **Derived from a clause of the English request** — recorded in `clause`, so kill rate reads as
   "how much of what the user asked for does this suite hold".

## Calibration

`calibrated: true` means the **experimenter's known-good suite killed every mutation in the set**.
Until then the set cannot grade an agent, and `grading.mutation.require_calibrated` refuses it.

Calibration is replay mode's mutation phase — there is no separate tool:

```sh
.venv/bin/python -m fidelity.run --mode replay --calibrate
```

That writes `calibrated` back into each manifest from the run's own kill results. Only replay may
do it: in agent mode the suite is the thing under test, so what it kills says nothing about
whether a mutation is any good.

cp02 is marked calibrated from a real run (3/3 killed). The rest await the full replay.

## Reference-suite holes found while authoring

Several checkpoints could have had another mutation, except the reference spec has nothing that
would catch it. Those are **holes in the erosion harness's specs**, not bad mutations, and they
are left out so each set stays calibratable. Each is recorded in the relevant manifest's header:

| checkpoint | the mutation that would survive |
| --- | --- |
| cp03 | the project list showing only the first project — no row count is asserted |
| cp21 | a line's amount ignoring its quantity — qty, unit price and line amount are never asserted (cp46 does assert them, so the mutation lives there) |
| cp26 | dropping the `PROJECT_TAGGED` / `PROJECT_UNTAGGED` audit records — the spec never reads the audit channel |
| cp55 | removing the "top five" cap — the fixture has only three owing clients |

## Checkpoints with no code of their own

cp40 and cp50 changed nothing in the reference chain, and both still have mutation sets — the
behaviour their requests describe exists, it was just built earlier. cp40 switches off `Intl`
thousands grouping; cp50 drops one of the two chained filters so each works alone and the
combination does not. They are the clearest demonstration of why such checkpoints are graded
rather than skipped (DESIGN.md §2).
