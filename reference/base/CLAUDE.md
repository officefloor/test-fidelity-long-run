# Working in this app

You are making ONE change to this application in response to the change request you were given.
Implement it as a **full-stack change**: whatever the request needs across the database schema, the
server (OfficeFloor REST on a Spring Boot host), and the front-end — as a small, additive,
local change.

## Rules

- **`data-testid` is immutable public API.** Expose a stable `data-testid` on every element and
  value the feature surfaces. **Never rename or remove a `data-testid` that already exists** — it
  is how the app is tested. Match exactly the `data-testid` values your task's test expects.
- **Schema changes are Flyway migrations.** Add a new versioned migration under
  `src/main/resources/db/migration/`; never edit an applied migration.
- **Data is seeded through the app's own API in tests**, not committed as fixtures. If your feature
  needs new seed capability, extend the `/__test__` seed support. Seed with a `JdbcTemplate` using
  the **explicit ids from the fixture** (JPA `save()` with an IDENTITY id ignores a supplied id and
  generates its own — the spec asserts rows by the fixture's ids, so they must match). `reset`
  should `TRUNCATE ... RESTART IDENTITY` the tables it clears.
- **Audit / side-effect records go through the `Audit` service** (inject `Audit`, call
  `record(...)`). It appends one record per line to the known audit file that tests read — that is
  how audited behaviour is verified (the UI can't show it). Use the exact record text the task's
  test expects; don't invent separate logging for audited behaviour.
- **Do not edit** the build/run scripts (`bin/build`, `bin/start`, `bin/stop`, `bin/e2e`) or this
  file. Use `bin/e2e` to run your test as you work.

## The front-end is additive: your change is NEW FILES

The front-end is built so that a feature is added without editing what is already there. Every
shared structure is either **generated from the file system** or **addressed by a key** — never a
list someone edits. Follow these five rules; they are what keeps the app maintainable.

1. **A page is one new file under `routes/`.**
   `routes/clients.index.tsx` → `export const Route = createFileRoute('/clients')({ component })`.
   The route table (`routeTree.gen.ts`) is GENERATED from this directory — never edit it, never
   commit it, never write a router. A section that will have detail views gets a one-line layout
   route (`routes/clients.tsx` rendering `<Outlet />`) beside its `clients.index.tsx` list.
   Its nav link is its own file: `features/clients/nav.slot.tsx` filling `AppNav`, with
   `data-testid="nav-clients"`.

2. **Drilling in is a CHILD ROUTE, never a flag.** "Open this client" is
   `routes/clients.$clientId.tsx` — a new file. Never a `useState` holding which row is open, and
   never a callback passed to a child so it can hide its siblings. The router decides what renders;
   the parent layout was written once and is not touched again.

3. **Adding UI to a region that already exists is one new `*.slot.tsx` file.**
   A panel, a table column, a row action, a toolbar control, a dashboard tile, a form field:
   `features/clients/statement.slot.tsx` →
   `export const contribution = ClientDetail.fill({ order: 30, Component: ClientStatement })`.
   **Never edit a page to add something to it.** If the region does not exist yet, add it — one new
   file under `slots/defs/` — and render it with `<ClientDetail.Slot clientId={id} />`.
   See `src/main/frontend/slots/Slot.tsx` for the three steps and `features/home/nav.slot.tsx`
   for a worked example.

4. **State that outlives a click lives in the URL**, via `url/useSearchParam`. A filter, a sort, a
   tab, a show/hide toggle: the control that owns the key is a self-contained file, and anything
   that needs the value reads the same key. `useState` is ONLY for what the user is currently
   typing into an uncommitted field. Search params are an open namespace — a new key needs no
   schema change anywhere.

5. **Server data is `useQuery` under a key; changes are `useMutation` + `invalidateQueries`.**
   (`@tanstack/react-query`, with `api/http.ts` for the fetch.) Never copy server data into
   `useState`, never hand-maintain a list after a write, and never have a parent load data for its
   children — each panel queries for itself. Two features stay in step by sharing a KEY:
   `invalidateQueries({ queryKey: ['clients'] })` refreshes everything showing clients, with no
   import between them.

**Features never import each other, and never pass a callback that changes a sibling's rendering.**
They share exactly three things: a query key, a URL search param, and a slot id.

**Do not edit these** (they are the mechanism, complete as-is): `main.tsx`, `routes/__root.tsx`,
`slots/Slot.tsx`, `slots/registry.ts`, `slots/discover.ts`, `api/http.ts`, `query/queryClient.ts`,
`vite.config.ts`, `tsconfig.json`. ADDING files under `routes/`, `slots/defs/`, `features/` and
`ui/` is exactly how you work.

`cd src/main/frontend && npm run typecheck` checks your front-end change (types come from the
generated route tree, so it builds first).

## Layout

- `src/main/frontend/**` — the front-end (React + TanStack Router + TanStack Query, TypeScript).
  - `routes/**` — one file per URL; the route tree is generated from it.
  - `features/<name>/**` — a feature's own components, queries and `*.slot.tsx` contributions.
  - `slots/defs/**` — one file per UI region (add files; don't edit them).
  - `ui/**` — shared presentational primitives, *composed*, never branched with per-feature `if`s.
  - `url/`, `api/`, `query/` — the URL-state, fetch and cache helpers. Use them; don't edit them.
- `src/main/resources/officefloor/rest/api/<path>.<METHOD>.yml` — a REST endpoint = a **new YAML
  file** (`service: { class: net.officefloor.hq.app.<Logic> }`) + a **new logic class** whose
  `service(...)` method takes injected Spring beans/data + `ObjectResponse<T>` (and, for a body,
  a param with `@RequestBody`). Additive: one file per endpoint, never a central router. **Put
  domain routes under `rest/api/`** so their paths start with `/api/` — `SpaConfig` only lets
  `/api/*` bypass the SPA deep-link fallback; a non-`/api/` route is swallowed and returns the
  SPA HTML instead of your endpoint.
- `src/main/java/**` — logic classes and Spring `@Service`/`@Repository` beans (business logic +
  data access). `Application`, `SpaConfig`, `TestSupportController` are base infrastructure.
- `src/main/resources/db/migration/**` — Flyway migrations (new `V<n>__*.sql` per schema change).
- `bin/e2e` — build, start the app, run your test, stop. Run it to check your work.
