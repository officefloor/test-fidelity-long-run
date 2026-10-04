# test-fidelity-long-run

**Can an agent write the tests?** Sibling to `~/ui-long-degradation-test`, with the two halves
swapped. That harness fixed the tests and grew the application, and showed OfficeFloor + TanStack
absorbs 60 plain-English changes without eroding. This one **fixes the application and grows the
test suite**, to find out whether generated acceptance tests actually pin the behaviour that was
asked for — the unproven link in the English → request → **tests** → implement → review pipeline.

A wrong test is worse than no test: the pipeline goes green and proceeds. At 300–500 unattended
changes that is the failure that compounds.

## How a checkpoint runs

1. The reference application is materialised at checkpoint N — read-only to the agent.
2. The agent is given the plain-English request, the **interface contract** for N (the
   `data-testid` anchors and audit-record formats the implementation actually exposes), and the
   instruction that it writes **tests only**. From cp02 on it also has the suite it has written so
   far and that suite's git history, so it can revise earlier tests as requests change earlier
   behaviour.
3. Its suite is copied back and committed.
4. **Fidelity testing**: the whole suite must pass on checkpoint N's code and contain more tests
   than at N-1; then each authored **mutation** for N is applied in turn and the suite must go red
   every time. A mutation that survives is a part of the request no test pins.

Mutation zero is free — the application at N-1 *is* the feature removed, one patch back along the
chain — and it catches the dominant failure mode of writing tests against existing code: tests that
restate what the code already does.

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
$V tools/reference.py verify                            # 60 patches apply in order, digests match
$V tools/reference.py materialise --checkpoint 8 --out work/cp08

# the interface contract handed to the agent with each request
$V tools/contract.py build
$V tools/contract.py check --harness ~/ui-long-degradation-test   # calibrate the extractor
$V tools/contract.py show --checkpoint 8
```

## Status

**Built and verified**

- `tools/reference.py` — imports the chain as `reference/base/` + 60 per-checkpoint patches, and
  materialises any checkpoint as its own git repo with one commit per checkpoint. All 60 patches
  apply in order; digests match; cp60 comes out at 83 `.tsx` + 70 `.java`.
- `tools/contract.py` — 60 interface contracts (210 anchors and 14 audit-record formats by cp60),
  **calibrated against all 95 reference spec files**: every testid and audit record they assert
  appears in the contract by its checkpoint.
- `tools/reference_chain.py` — ranks the candidate chains and names each one's repair sites.

**Not built**: the driver, the grader, the mutation catalogue (format and one worked manifest only).

**Prerequisite**: the reference chain is not yet all-green. Until it is, a failing generated test
is ambiguous — the agent or the fixture. The best chain needs 4 repair sites, not a fresh run;
own-test failures are **zero across all 10 chains**, so the application always implements the
current request. REFERENCE_CHAIN.md has the diagnosis.

**Two checkpoints (cp40, cp50) changed no code** in the reference chain and are excluded from the
relevance and mutation oracles — their acceptance specs are satisfiable without the change they
describe.

## Terminology

`mutative` keeps its `checkpoints.yaml` meaning — *a change request that revises earlier
behaviour*. **Mutation**, **mutant** and **kill rate** are mutation testing in the usual sense:
the injected defects of DESIGN.md §6. Different things.
