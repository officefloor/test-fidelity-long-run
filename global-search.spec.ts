// Acceptance test for the change request:
//   "Give me one search box. Have it look across both clients and projects."
//
// A SINGLE global search box (data-testid="global-search") on the home page searches across BOTH
// clients and projects at once. What is typed is matched against client names and project names
// independently, and the hits are surfaced in two groupings: matching clients under
// data-testid="search-clients" and matching projects under data-testid="search-projects". This is
// additive and separate from the existing per-page client-search box on /clients.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email } and `projects` honours { id, name, clientId }.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// Three clients and two projects. The seed is arranged so each query below lands in a different
// place: "acme" matches a client AND a project; "globex" matches only a client (Globex has no
// project); "orbital" matches only a project (no client is named that). Project names never repeat
// a client name, so a grouping can be asserted by the names it does — and does not — surface.
const SEED = {
  clients: [
    { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
    { id: 2, name: 'Globex Trading', email: 'contact@globex.test' },
    { id: 3, name: 'Umbrella Group', email: 'info@umbrella.test' },
  ],
  projects: [
    { id: 10, name: 'Acme Website', clientId: 1 },
    { id: 11, name: 'Orbital Migration', clientId: 3 },
  ],
};

const clientHits = (page: Page) => page.getByTestId('search-clients');
const projectHits = (page: Page) => page.getByTestId('search-projects');

test.describe('Global search across clients and projects', () => {
  test('the home page offers one global search box', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/');

    // The shell is present and there is exactly ONE global search box.
    await expect(page.getByTestId('app-root')).toBeVisible();
    const box = page.getByTestId('global-search');
    await expect(box).toBeVisible();
    await expect(box).toHaveCount(1);
  });

  test('a term matching a client and a project surfaces both', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/');
    await page.getByTestId('global-search').fill('acme');

    // Both groupings are shown, one for each side of the search.
    await expect(clientHits(page)).toBeVisible();
    await expect(projectHits(page)).toBeVisible();

    // The matching client is listed under clients; the other clients are not.
    await expect(clientHits(page).getByText('Acme Corp', { exact: true })).toBeVisible();
    await expect(clientHits(page).getByText('Globex Trading', { exact: true })).toHaveCount(0);
    await expect(clientHits(page).getByText('Umbrella Group', { exact: true })).toHaveCount(0);

    // The matching project is listed under projects; the non-matching project is not.
    await expect(projectHits(page).getByText('Acme Website', { exact: true })).toBeVisible();
    await expect(projectHits(page).getByText('Orbital Migration', { exact: true })).toHaveCount(0);
  });

  test('a term matching only a client shows it under clients and nothing under projects', async ({
    page,
  }) => {
    await resetAndSeed(SEED);

    await page.goto('/');
    await page.getByTestId('global-search').fill('globex');

    // The client is surfaced; the other clients are not.
    await expect(clientHits(page).getByText('Globex Trading', { exact: true })).toBeVisible();
    await expect(clientHits(page).getByText('Acme Corp', { exact: true })).toHaveCount(0);
    await expect(clientHits(page).getByText('Umbrella Group', { exact: true })).toHaveCount(0);

    // No project name matches "globex", so neither seeded project is surfaced.
    await expect(projectHits(page).getByText('Acme Website', { exact: true })).toHaveCount(0);
    await expect(projectHits(page).getByText('Orbital Migration', { exact: true })).toHaveCount(0);
  });

  test('a term matching only a project shows it under projects and nothing under clients', async ({
    page,
  }) => {
    await resetAndSeed(SEED);

    await page.goto('/');
    await page.getByTestId('global-search').fill('orbital');

    // The project is surfaced; the other project is not.
    await expect(projectHits(page).getByText('Orbital Migration', { exact: true })).toBeVisible();
    await expect(projectHits(page).getByText('Acme Website', { exact: true })).toHaveCount(0);

    // No client name matches "orbital", so no client is surfaced.
    await expect(clientHits(page).getByText('Acme Corp', { exact: true })).toHaveCount(0);
    await expect(clientHits(page).getByText('Globex Trading', { exact: true })).toHaveCount(0);
    await expect(clientHits(page).getByText('Umbrella Group', { exact: true })).toHaveCount(0);
  });

  test('a term matching nothing surfaces no clients and no projects', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/');
    await page.getByTestId('global-search').fill('zzz-no-such-thing');

    await expect(clientHits(page).getByText('Acme Corp', { exact: true })).toHaveCount(0);
    await expect(clientHits(page).getByText('Globex Trading', { exact: true })).toHaveCount(0);
    await expect(clientHits(page).getByText('Umbrella Group', { exact: true })).toHaveCount(0);
    await expect(projectHits(page).getByText('Acme Website', { exact: true })).toHaveCount(0);
    await expect(projectHits(page).getByText('Orbital Migration', { exact: true })).toHaveCount(0);
  });
});
