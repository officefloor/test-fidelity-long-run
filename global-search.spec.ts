// Acceptance tests for the change request:
//   "Give me one search box. Have it look across both clients and projects."
//
// ONE search box (global-search) searches ACROSS both domains at once. What is typed is matched,
// case-insensitively, against client names AND project names, and the hits are shown in two result
// regions: matching clients under `search-clients`, matching projects under `search-projects`.
// This is a single consolidated search, distinct from the per-page client-search filter on the
// clients list — one box, two kinds of result.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed; the search is driven
// by typing into global-search. Each result region reuses the established row anchors for its kind:
// matching clients are `client-row-<id>` (with `client-name`) inside `search-clients`, matching
// projects are `project-row-<id>` (with `project-name`) inside `search-projects`. Seed honours
// clients: { id, name, email } and projects: { id, clientId, name }.
//
// The fixture gives each domain a hit and a miss for a shared token, and keeps the names mutually
// distinct so a term can be aimed at both domains, at one, or at neither:
//   - "north"      -> client North Industries (1) AND project Northwind Portal (2)   [across both]
//   - "industries" -> only client North Industries (1)                                [clients only]
//   - "apollo"     -> only project Apollo Launch (1)                                   [projects only]
//   - "zzz"        -> nothing in either domain                                         [no matches]
// This SHOULD FAIL before the change: there is no global-search box today.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

const FIXTURE = {
  clients: [
    { id: 1, name: 'North Industries', email: 'ops@north.example' },
    { id: 2, name: 'Globex Trading', email: 'hello@globex.example' },
  ],
  projects: [
    { id: 1, clientId: 2, name: 'Apollo Launch' },
    { id: 2, clientId: 1, name: 'Northwind Portal' },
  ],
};

test.describe('global search across clients and projects', () => {
  test.beforeEach(async () => {
    await resetAndSeed(FIXTURE);
  });

  test('one box surfaces matching clients and matching projects together', async ({ page }) => {
    await page.goto('/');

    // There is a single, global search box.
    await expect(page.getByTestId('global-search')).toBeVisible();

    // "north" is a substring of a CLIENT name (North Industries) and of a PROJECT name
    // (Northwind Portal) — the one box reaches into both domains.
    await page.getByTestId('global-search').fill('north');

    const clientsRegion = page.getByTestId('search-clients');
    const projectsRegion = page.getByTestId('search-projects');
    await expect(clientsRegion).toBeVisible();
    await expect(projectsRegion).toBeVisible();

    // The matching client shows up under the clients results; the non-matching client does not.
    await expect(clientsRegion.getByTestId('client-row-1')).toBeVisible();
    await expect(clientsRegion.getByTestId('client-row-1').getByTestId('client-name')).toHaveText(
      'North Industries',
    );
    await expect(clientsRegion.getByTestId('client-row-2')).toHaveCount(0);

    // The matching project shows up under the projects results; the non-matching project does not.
    await expect(projectsRegion.getByTestId('project-row-2')).toBeVisible();
    await expect(projectsRegion.getByTestId('project-row-2').getByTestId('project-name')).toHaveText(
      'Northwind Portal',
    );
    await expect(projectsRegion.getByTestId('project-row-1')).toHaveCount(0);
  });

  test('a term matching only a client lists the client and no project', async ({ page }) => {
    await page.goto('/');

    // "industries" is in a client name only.
    await page.getByTestId('global-search').fill('industries');

    const clientsRegion = page.getByTestId('search-clients');
    const projectsRegion = page.getByTestId('search-projects');

    await expect(clientsRegion.getByTestId('client-row-1')).toBeVisible();
    await expect(clientsRegion.getByTestId('client-row-1').getByTestId('client-name')).toHaveText(
      'North Industries',
    );
    await expect(clientsRegion.getByTestId('client-row-2')).toHaveCount(0);

    // No project matches, so the projects results hold no project rows.
    await expect(projectsRegion.locator('[data-testid^="project-row-"]')).toHaveCount(0);
  });

  test('a term matching only a project lists the project and no client', async ({ page }) => {
    await page.goto('/');

    // "apollo" is in a project name only.
    await page.getByTestId('global-search').fill('apollo');

    const clientsRegion = page.getByTestId('search-clients');
    const projectsRegion = page.getByTestId('search-projects');

    await expect(projectsRegion.getByTestId('project-row-1')).toBeVisible();
    await expect(projectsRegion.getByTestId('project-row-1').getByTestId('project-name')).toHaveText(
      'Apollo Launch',
    );
    await expect(projectsRegion.getByTestId('project-row-2')).toHaveCount(0);

    // No client matches, so the clients results hold no client rows.
    await expect(clientsRegion.locator('[data-testid^="client-row-"]')).toHaveCount(0);
  });

  test('a term matching neither leaves both result regions empty of hits', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('global-search').fill('zzz');

    await expect(
      page.getByTestId('search-clients').locator('[data-testid^="client-row-"]'),
    ).toHaveCount(0);
    await expect(
      page.getByTestId('search-projects').locator('[data-testid^="project-row-"]'),
    ).toHaveCount(0);
  });

  test('changing the term moves the results to the new matches', async ({ page }) => {
    await page.goto('/');

    // First an across-both term: both regions carry their hit.
    await page.getByTestId('global-search').fill('north');
    await expect(page.getByTestId('search-clients').getByTestId('client-row-1')).toBeVisible();
    await expect(page.getByTestId('search-projects').getByTestId('project-row-2')).toBeVisible();

    // Retyping narrows the live results to the new term — the old client hit drops out and the
    // project-only match remains, proving the box drives both regions reactively.
    await page.getByTestId('global-search').fill('apollo');
    await expect(page.getByTestId('search-projects').getByTestId('project-row-1')).toBeVisible();
    await expect(page.getByTestId('search-projects').getByTestId('project-row-2')).toHaveCount(0);
    await expect(
      page.getByTestId('search-clients').locator('[data-testid^="client-row-"]'),
    ).toHaveCount(0);
  });
});
