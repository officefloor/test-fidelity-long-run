# Mutation catalogue

A **mutation** is an exact-match text substitution in one file of the reference application,
breaking exactly one aspect of one change request's behaviour (DESIGN.md §6). It is the depth
oracle: a generated suite is credited for each mutation it turns red.

> A **mutative checkpoint** is a different thing — `checkpoints.yaml`'s term for a change request
> that revises earlier behaviour. "Mutation", "mutant" and "kill rate" here are mutation testing
> in the usual sense.

**133 mutations across all 60 checkpoints.** `tools/mutate.py coverage` shows the spread;
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

The first full replay (`202610041729`) was green at all 60 checkpoints and killed 120 of the 133.
The 13 that survived are diagnosed below: nine were reference-suite holes, three were equivalent
mutants of my own making, and one was a reference spec whose assertion could not fail. All are
fixed; what follows is the record, because the same mistakes are the ones to look for next time.

## Reference-suite holes — found, then closed

Four checkpoints asserted less than their request promised, so a mutation I wanted had to be left
out: the spec that should have killed it would not have. Each was a hole in the fixture rather
than a bad mutation.

They are now **closed** — the specs assert the missing thing, and the mutation that exposed the
gap is in the catalogue, which is how they stay closed. A spec that stops asserting one of these
shows up as a mutation that survives.

| checkpoint | the hole | the mutation it now supports |
| --- | --- | --- |
| cp03 | no project row count asserted | `004-list-shows-only-the-first-project` |
| cp21 | a line's own qty / unit price / amount never asserted | `003-line-amount-ignores-the-quantity` |
| cp26 | the audit channel never read | `003-tagging-is-not-recorded`, `004-untagging-is-not-recorded` |
| cp55 | only three owing clients, so the "top five" cap was unobservable | `002-top-clients-is-not-capped-at-five` |

The cp21 case is the sharpest illustration of why this mattered: a line amount computed *without*
the quantity is correct whenever the quantity is 1, and the spec only ever asserted the
description and the invoice total. The defect was unobservable through the suite that existed.

The spec changes are additions to existing tests, not new tests, so the test ids are unchanged
and runs stay comparable across the change (erosion harness commit `3a8b947`).

### Round two — the nine the first full replay found

Nine more, all the same shape: the spec asserted the visible half of a clause and not the half the
request was actually about. Closed the same way, and each manifest header now says so.

| checkpoint | the mutation that survived | the hole |
| --- | --- | --- |
| cp13 | `003-payment-is-allowed-before-sending` | the spec **did** assert the pay control was absent — before the invoice list had rendered |
| cp16 | `001-contacts-are-not-scoped-to-the-client` | one client in the fixture, so a scoped list and an unscoped one look identical |
| cp19 | `001-project-count-counts-every-project`, `002-contact-count-counts-every-contact` | the same, on both badge counts |
| cp33 | `001-statement-lists-every-invoice` | the same, on "all their invoices" |
| cp20 | `003-toggle-is-not-recorded` | the audit channel never read |
| cp56 | `002-each-share-is-recorded-against-the-wrong-invoice` | the audit channel never read |
| cp58 | `002-restoring-is-not-recorded` | the audit channel never read |
| cp21 | `001-adding-a-line-leaves-the-invoice-total-stale` | the total was asserted on the invoice page, which derives it from the rows it is showing rather than reading what the server stored |
| cp22 | `001-removing-a-line-leaves-the-total-stale` | the same |

cp13 is the one worth remembering: a test that looks like it pins the rule, passes, and pins
nothing. `toHaveCount(0)` is satisfied the instant the page has not rendered yet, so an absence
assertion with nothing anchoring it in front can never fail. It was the only unanchored one in the
suite — the other seventeen are each preceded by a positive assertion that forces the render.

## Equivalent mutants — three found, three replaced

Rule 3 above is easy to state and easy to violate wherever the application enforces something
twice. These three survived the first full replay looking exactly like coverage holes. None was.

| checkpoint | the mutation | why nothing could kill it |
| --- | --- | --- |
| cp44 | `001-duplicate-emails-are-allowed` | deleting the server's `existsByEmail` check leaves Flyway V25's UNIQUE constraint, which refuses the insert anyway — same error, same row count |
| cp56 | `001-the-split-need-not-add-up-to-the-payment` | the form checks the sum before posting, so breaking the server's check changes nothing a UI test can see — cp02's lesson, missed |
| cp59 | `001-grand-total-is-recomputed-in-the-browser` | the server builds each subtotal from the same invoice dues it sums into the total, so a browser re-sum agrees by construction |

Each was replaced by the break that **is** reachable for the same clause: the email normalisation
the DB constraint cannot see, the form's own check, and reading the invoiced figure instead of the
owed one. A surviving mutation is a hypothesis about the suite — check it is not a statement about
the application before closing a hole that was never there.

## Checkpoints with no code of their own

cp40 and cp50 changed nothing in the reference chain, and both still have mutation sets — the
behaviour their requests describe exists, it was just built earlier. cp40 switches off `Intl`
thousands grouping; cp50 drops one of the two chained filters so each works alone and the
combination does not. They are the clearest demonstration of why such checkpoints are graded
rather than skipped (DESIGN.md §2).
