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
./setup.sh                 # creates .venv, installs deps, checks every prerequisite
V=.venv/bin/python

# which evolved chain is closest to all-green, and where each needs repair
$V tools/reference_chain.py --stacks ~

# import the chosen chain into this repo, ONCE, read-only. The stack repos are records of
# completed runs: nothing here ever writes to them.
$V tools/reference.py import --repo ~/officehq-tanstack-officefloor \
    --branch evolve/202610020135/just-solve/chain2
$V tools/reference.py verify                   # 60 patches apply in order, digests match
$V tools/reference.py verify-repairs          # each fixture repair applies across its whole range
$V tools/reference.py materialise --checkpoint 8 --out work/cp08

# the interface contract handed to the agent with each request
$V tools/contract.py build
$V tools/contract.py check             # calibrate the extractor against the reference specs
$V tools/contract.py show --checkpoint 8

# replay mode's test source: the erosion harness's authored suite at a checkpoint
$V tools/suite.py resolve --checkpoint 25
$V tools/suite.py sizes                      # suite size per checkpoint; checks the growth rule
```

### Running it

```sh
# See exactly what the agent would be given, build nothing. Seconds per checkpoint — do this
# before paying for a full run.
$V -m fidelity.run --mode replay --dry-run
$V -m fidelity.run --mode replay --checkpoint 25 --dry-run

# The real thing. Each checkpoint builds and serves the app TWICE (flake detection), so budget
# minutes per checkpoint. A plain invocation is the rigorous run; flags trade that away.
$V -m fidelity.run --mode replay                      # all 60
$V -m fidelity.run --mode replay --repeats 1          # faster, cannot see a flake
$V -m fidelity.run --mode replay --from 1 --to 8      # a prefix
$V -m fidelity.run --mode replay --checkpoint 25      # one
$V -m fidelity.run --mode replay --no-mutations       # green phase only, ~half the wall clock
$V -m fidelity.run --mode replay --keep-work          # keep each materialised tree to poke at
```

### Analysing a finished run

```sh
$V -m fidelity.analyse --run-id <id>          # fidelity rate, churn, degradation slope
$V -m fidelity.analyse --run-id <id> --csv    # also records.csv

# a run performed on another machine: fetch its branches and analyse, no restore step
git fetch origin 'refs/heads/agent/*:refs/remotes/origin/agent/*'
$V -m fidelity.analyse --run-id 202610060034
```

An agent run is wholly contained in its two suite branches, `agent/<run-id>-chain{1,2}` — one
commit per checkpoint, plus a final commit holding that chain's whole capture (the prompts, the
agent's streamed turns, the gate output, the mutation verdicts). `analyse` reads them from git
directly, so `results/` is a scratch copy of a finished run and can be deleted. It stays the
source for the two cases with no branch: a replay run commits nothing, and an unfinished run has
no capture commit yet.

Separate from the run on purpose: everything it produces is derived, so it can be re-run and
corrected for free against a finished run — whereas the run itself produces the irreproducible
material and should not also be deciding how to summarise itself.

With one chain it reports slopes without confidence intervals, because checkpoints within a chain
are not independent. Two or more chains get a chain-level bootstrap — which is why `chains`
defaults to 2 for agent runs.

### Agent mode

```sh
# A run spawns a fresh agent per checkpoint over hours, so an interactive login would expire
# part-way. The driver refuses to start without a long-lived token.
export CLAUDE_CODE_OAUTH_TOKEN=$(claude setup-token)

# Show the confined area and the exact prompt, and run NO agent turn. Costs nothing.
$V -m fidelity.run --mode agent --checkpoint 3 --dry-run

$V -m fidelity.run --mode agent                      # all 60
$V -m fidelity.run --mode agent --from 1 --to 5      # a prefix
$V -m fidelity.run --mode agent --code-view none     # harder: contract + prior tests only
$V -m fidelity.run --mode agent --model <id>         # override the configured model

# review a finished run: per-checkpoint test commits, then the capture commit
git -C runs/<run_id>/suite log --stat
```

The agent's suite lives in `runs/<run_id>/suite` — its own git repository on branch
`agent/<run_id>`, one commit per checkpoint. That history is both what §8 measures and what the
agent itself reads inside the sandbox. The run ends with one further commit carrying the whole
capture (prompts, streamed agent turns, gate output, mutation verdicts) alongside the suite it
explains.

Per checkpoint the capture also keeps `cpNN.agent.jsonl` (the streamed turn), `cpNN.agent.testdiff`
(what it did to the suite) and, if it happened, `cpNN.agent.appdiff` — the evidence that it
modified application code, which voids a checkpoint.

Replay commits nothing. Everything lands under `results/<run_id>/` as it happens — a
60-checkpoint run takes hours, and a record that only appears at the end is unreadable exactly
when something has broken:

| file | holds |
| --- | --- |
| `run.json` | mode, code_view, the reference chain, the resolved config |
| `cpNN.json` | the request, **the exact prompt sent**, the contract, the suite and what moved in it, the full gate result with per-test failure text, every mutation run, and the verdict |
| `cpNN.prompt.txt` | the prompt again as plain text, for reading |
| `cpNN.build.log` | the whole build + serve + Playwright console |
| `summary.md` | run-level: what was not green, where mutation zero was wrong, which mutations survived |

Per checkpoint the console shows the request, the full interface contract being handed over, which
spec files and individual tests were added / revised / dropped, whether application code was
touched, the gate result with each failing test and its failure text, and then each mutation with
whether it was killed and which test caught it.

## Setup

```sh
./setup.sh      # creates .venv, installs pinned deps, then checks every prerequisite
```

Its own venv with pinned dependencies — PyYAML and lizard, and deliberately not numpy/matplotlib
(this harness emits JSON and markdown, not graphs). What `setup.sh` cannot install, it checks:
the erosion harness (whose `correctness`/`agent`/`landlock` modules are the gate runner and the
confinement, imported by path so a fix lands once), the JDK/Maven/Node toolchain the application
builds with, Landlock, the imported fixture, and the agent token. Set `EROSION_HARNESS` if that
harness does not live at `~/ui-long-degradation-test`.

## Status

**Built and verified**

- `tools/reference.py` — imports the chain as `reference/base/` + 60 per-checkpoint patches, and
  materialises any checkpoint as its own git repo with one commit per checkpoint. All 60 patches
  apply in order; digests match; cp60 comes out at 83 `.tsx` + 70 `.java`.
- `repairs/` — the fixture repairs, as range-scoped exact-match substitutions with their rationale
  and provenance. **Five**, covering all six sites, each verified across its whole range with
  upstream confirmed to fix it by its `until`.
- `tools/contract.py` — 60 interface contracts (210 anchors and 14 audit-record formats by cp60),
  **calibrated against all 95 reference spec files**: every testid and audit record they assert
  appears in the contract by its checkpoint.
- `tools/reference_chain.py` — ranks the candidate chains and names each one's repair sites.
- `tools/suite.py` — replay mode's test source. Its resolution matches the completed runs'
  `total_selected` exactly at every checkpoint sampled (cp01, 05, 08, 25, 30, 49, 60 → 2, 11, 14,
  35, 40, 59, 72), and it confirms the reference suite never shrinks, so the non-decreasing rule
  holds on known-good tests.

- `fidelity/` — **the driver and grader**. Replay mode runs end to end: materialise → install →
  build → serve → Playwright → grade → mutate one at a time → capture. **Run over all 60
  checkpoints** (`202610041729`, 4h53m): green 60/60, two gate repeats each, zero flaky tests,
  the suite never shrank, mutation zero correct everywhere and correctly inverted at cp40/cp50.

- `mutations/` — **133 mutations across all 60 checkpoints**, every one applying exactly once.
  The first full replay killed 120 of them; the 13 survivors were diagnosed and fixed (nine
  reference-suite holes, three equivalent mutants, one reference assertion that could not fail).
  `mutations/README.md` carries the diagnosis.

- `fidelity/sandbox.py`, `fidelity/turn.py` — **agent mode**: the confined area, the turn and its
  retry policy, copy-back, the per-checkpoint suite commit and a final capture commit.
  Confinement verified here (Landlock ABI 8): all six withheld paths denied, sandbox reachable.

**Not built**: nothing in the replay path. What remains before agent mode is the re-run that
marks the last 11 mutation sets calibrated — `grading.mutation.require_calibrated` refuses to
grade an agent at a checkpoint whose set is not.

**Order of work**: replay mode first — it needs no agent and is the only way to tell a harness bug
from a fixture defect from a bad test. Done. Then fix the reference chain until replay is green at
all 60 checkpoints. Done. Then author the mutation catalogue and calibrate it: authored, one
replay in, fixes applied, awaiting the confirming run. Then agent mode.

**Prerequisite**: the reference chain is all-green — replay `202610041729` was green at every one
of the 60 checkpoints, so a failing generated test is now unambiguously the agent's. Own-test
failures were **zero across all 10 chains** before any repair, so the application always
implements the current request.

Five of the six recurring defects are **failing replacement specs**: a mutative checkpoint shipped
an updated copy of a prior spec that fails the moment it is installed. The root cause for most of
them was a seed-contract gap — those specs arrange archived records by passing `archived: true` to
`/__test__/seed`, which did not write that column until cp36 (projects) and cp58 (clients).

**That gap is repaired** (`repairs/`), as are the rest: all six sites are green, and a fifth
defect turned up while fixing them. Repairs are a declared layer applied on top of the imported
chain, never edits to it, so `reference/` stays a faithful copy of what the run produced.
REFERENCE_CHAIN.md has the full diagnosis.

**Two checkpoints (cp40, cp50) changed no code** in the reference chain — earlier code already
satisfied the request. They are **kept and graded**: they test whether the agent recognises a
request its suite already covers. Only mutation zero inverts there (N-1 is the same application,
so the round's tests must pass against it).

## Terminology

`mutative` keeps its `checkpoints.yaml` meaning — *a change request that revises earlier
behaviour*. **Mutation**, **mutant** and **kill rate** are mutation testing in the usual sense:
the injected defects of DESIGN.md §6. Different things.
