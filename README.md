# test-fidelity-long-run

**Can an agent write the tests?** Sibling to `~/ui-long-degradation-test`, with the two halves
swapped. That harness fixed the tests and grew the application, and showed OfficeFloor + TanStack
absorbs 60 plain-English changes without eroding. This one **fixes the application and grows the
test suite**, to find out whether generated acceptance tests actually pin the behaviour that was
asked for — the unproven link in the English → request → **tests** → implement → review pipeline.

A wrong test is worse than no test: the pipeline goes green and proceeds. At 300–500 unattended
changes that is the failure that compounds.

## How a checkpoint runs

1. A **Landlock-confined area** is built holding only what the agent may see: its own accumulated
   suite from cp01..N-1 with that suite's git history, the `e2e/` scaffolding read-only, the
   checkpoint specification, and the application at **cp(N-1)**. The application at cpN — the
   implementation of the change being tested — is unreachable, as are the experimenter's specs,
   the mutation patches, and `reference/` (which is every future checkpoint's code).
2. The agent is given the plain-English request plus the **interface contract** for N — the
   `data-testid` anchors, the audit-record formats, and the seed fields `/__test__/seed` honours —
   and the instruction that it writes **tests only**: new tests for new functionality, updates to
   its own existing tests where the request revises behaviour they assert.
3. The test code is copied back and committed on the run's branch, capturing that checkpoint's
   test changes.
4. **Fidelity testing.** First the whole suite must be green against checkpoint N's application,
   and hold at least as many tests as at N-1 (equal is fine — a revising checkpoint may rewrite
   rather than add — but it must never shrink). Then the application is **mutated one mutation at
   a time**, and each must make a test fail: a new failure is the success signal, saying the
   agent's tests covered that aspect of the functionality.

Mutation zero is free — the application at N-1 *is* the feature removed, one patch back along the
chain — and it catches the dominant failure mode of writing tests against existing code: tests that
restate what the code already does.

## Two modes

**`agent`** — the real measurement. The agent writes the tests; they are committed per checkpoint.

**`replay`** — the validation run. Instead of an agent turn, the erosion harness's **own authored
suite at checkpoint N** is installed and graded by the identical pipeline. Nothing is committed.
Those specs are known-good, so replay settles three things at once, all of which must hold before
any agent score means anything:

- **does this harness work?** materialise → confine → install → build → serve → grade, 60 times,
  on tests whose verdict is already known;
- **is the reference chain a sound fixture?** step 1 must be green at every checkpoint — where it
  is not, that is a fixture defect, not an agent error;
- **is the mutation catalogue calibrated?** every mutation must be killed by the known-good suite.

Replay comes first, and it needs no agent.

## Does the agent see the application code?

It sees **cp(N-1)**, read-only and runnable, and never cpN. That is the pipeline's own information
state (request → tests → implement), and it defuses the usual objection to showing code at all:
the new behaviour is absent from cp(N-1), so there is nothing to copy. It also separates a test
that fails because the agent misread the request from one that fails because it could not find the
nav button — only the first is being measured.

The asymmetry this preserves is the point: **the agent cannot confirm its new test passes**,
because the behaviour does not exist yet. It can only confirm its priors still pass and its new
test correctly fails. That is the hard part of test-first work and the main source of test
inaccuracy. Showing cpN would remove it and reduce the exercise to "write a test that passes".

`code_view` is a condition rather than a constant — `previous` (default), `none` (harder, but
conflates navigation with comprehension) and `current` (diagnostic ceiling only).

See **[DESIGN.md](./DESIGN.md)** for the method, **[REFERENCE_CHAIN.md](./REFERENCE_CHAIN.md)** for
which chain is the fixture and what must be repaired first.

## Running

```sh
V=~/ui-long-degradation-test/.venv/bin/python   # PyYAML lives there; no venv of our own yet

# which evolved chain is closest to all-green, and where each needs repair
$V tools/reference_chain.py --harness ~/ui-long-degradation-test --stacks ~

# import the chosen chain into this repo, ONCE, read-only. The stack repos are records of
# completed runs: nothing here ever writes to them.
$V tools/reference.py import --repo ~/officehq-tanstack-officefloor \
    --branch evolve/202610020135/just-solve/chain2
$V tools/reference.py verify                   # 60 patches apply in order, digests match
$V tools/reference.py verify-repairs          # each fixture repair applies across its whole range
$V tools/reference.py materialise --checkpoint 8 --out work/cp08

# the interface contract handed to the agent with each request
$V tools/contract.py build
$V tools/contract.py check --harness ~/ui-long-degradation-test   # calibrate the extractor
$V tools/contract.py show --checkpoint 8

# replay mode's test source: the erosion harness's authored suite at a checkpoint
$V tools/suite.py resolve --checkpoint 25
$V tools/suite.py install --checkpoint 25 --out work/cp25/e2e/specs
$V tools/suite.py sizes                      # suite size per checkpoint; checks the growth rule
```

## Status

**Built and verified**

- `tools/reference.py` — imports the chain as `reference/base/` + 60 per-checkpoint patches, and
  materialises any checkpoint as its own git repo with one commit per checkpoint. All 60 patches
  apply in order; digests match; cp60 comes out at 83 `.tsx` + 70 `.java`.
- `repairs/` — the fixture repairs, as range-scoped exact-match substitutions with their rationale
  and provenance. All three verified across cp25..cp57, with upstream confirmed to fix each by its
  `until`.
- `tools/contract.py` — 60 interface contracts (210 anchors and 14 audit-record formats by cp60),
  **calibrated against all 95 reference spec files**: every testid and audit record they assert
  appears in the contract by its checkpoint.
- `tools/reference_chain.py` — ranks the candidate chains and names each one's repair sites.
- `tools/suite.py` — replay mode's test source. Its resolution matches the completed runs'
  `total_selected` exactly at every checkpoint sampled (cp01, 05, 08, 25, 30, 49, 60 → 2, 11, 14,
  35, 40, 59, 72), and it confirms the reference suite never shrinks, so the non-decreasing rule
  holds on known-good tests.

**Not built**: the driver (the confined area, the agent turn, copy-back and commit), the grader,
the mutation catalogue (format and one worked manifest only).

**Order of work**: replay mode first — it needs no agent and is the only way to tell a harness bug
from a fixture defect from a bad test. Then fix the reference chain until replay is green at all 60
checkpoints. Then author the mutation catalogue, then run agent mode.

**Prerequisite**: the reference chain is not yet all-green. Until it is, a failing generated test
is ambiguous — the agent or the fixture. The best chain needs **4 repair sites**, not a fresh run,
and own-test failures are **zero across all 10 chains**, so the application always implements the
current request.

Five of the six recurring defects are **failing replacement specs**: a mutative checkpoint shipped
an updated copy of a prior spec that fails the moment it is installed. The root cause for most of
them was a seed-contract gap — those specs arrange archived records by passing `archived: true` to
`/__test__/seed`, which did not write that column until cp36 (projects) and cp58 (clients).

**That gap is now repaired** (`repairs/`), closing two of the chosen chain's four sites. Repairs
are a declared layer applied on top of the imported chain, never edits to it, so `reference/`
stays a faithful copy of what the run produced. Remaining: cp49 → cp21 (tax behaviour) and
cp60 → cp41 (an undeclared mutation). REFERENCE_CHAIN.md has the full diagnosis.

**Two checkpoints (cp40, cp50) changed no code** in the reference chain — earlier code already
satisfied the request. They are **kept and graded**: they test whether the agent recognises a
request its suite already covers. Only mutation zero inverts there (N-1 is the same application,
so the round's tests must pass against it).

## Terminology

`mutative` keeps its `checkpoints.yaml` meaning — *a change request that revises earlier
behaviour*. **Mutation**, **mutant** and **kill rate** are mutation testing in the usual sense:
the injected defects of DESIGN.md §6. Different things.
