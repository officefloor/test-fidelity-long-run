# officehq-tanstack-officefloor — base repository (additive React SPA + OfficeFloor)

A **base repository** for the `ui-long-degradation-test` harness — **one technology stack**:
front-end an **additive React SPA** (TanStack Router + TanStack Query + a slot registry), backend
**OfficeFloor** (within Spring) on in-memory H2. It is the *front-end* arm of the comparison with
`~/officehq-react-officefloor`: same language, same UI library, same backend — the only variable is
whether the front-end's shared structure is edited or added to.

Every shared structure here is **generated from the file system** or **addressed by a key**, so a
feature is new files:

| what is added          | the file that is added                  | what is edited |
| ---------------------- | --------------------------------------- | -------------- |
| a page                 | `routes/<path>.tsx`                     | nothing (the route tree is generated) |
| its nav link           | `features/<f>/nav.slot.tsx`             | nothing (the shell lists no pages) |
| a drill-in / detail    | `routes/<section>.$id.tsx`              | nothing (the router decides, not a flag) |
| a panel/column/action  | `features/<f>/<thing>.slot.tsx`         | nothing (the page lists no contents) |
| a filter / sort/ tab   | `features/<f>/<control>.slot.tsx`       | nothing (its state is a URL key) |
| data for any of them   | a `useQuery` key in that file           | nothing (the cache is a keyspace) |

See `CLAUDE.md` for the five rules the agent works to, and `src/main/frontend/slots/Slot.tsx` for
the contribution mechanism. It is the
near-empty starting point (base shell + Spring/OfficeFloor + empty H2, no tables) that the harness
**evolves** into a full application over ~60 English change requests, one full-stack change per
checkpoint.

- Base repos are **home-level sibling directories**, one per stack, named
  `~/officehq-<frontend>-<backend>` so both layers are visible (`~/officehq-react-officefloor`,
  `~/officehq-<frontend>-<backend>`, …) — the **front-end and the backend may both vary** between
  stacks. The study compares stacks by running the harness against each in turn — which stack best
  resists erosion.
- The harness (`~/ui-long-degradation-test`, `config.yaml → app.repo`) reads this folder at branch
  **`base-empty`**, worktrees it onto `evolve/<run_id>/<condition>/chain<n>`, and commits each
  checkpoint there. This branch is only ever read.
- It honours the **App contract** — see `~/ui-long-degradation-test/docs/SUT_CONTRACT.md`.
- **Try another stack:** create a new sibling `~/officehq-<frontend>-<backend>` (different
  front-end, different backend, or both), satisfy the same `BASE_CHECKLIST.md`, and point
  `app.repo` at it. Each is its own run.

**Status: green.** `bin/build` produces the one jar, `bin/start` serves the shell, and the shell's
mechanisms (page self-registration, slot contributions in order, URL-as-state across sibling
components surviving a reload, and TanStack Query against the running app) were verified end to end
with a throwaway spec through `bin/e2e`. See **[BASE_CHECKLIST.md](./BASE_CHECKLIST.md)**.
