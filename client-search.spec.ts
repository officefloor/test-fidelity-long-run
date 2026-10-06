// Acceptance test for the change request:
//   "My client list is getting long. Give me a box to search for a client by name."
//
// A search box (data-testid="client-search") on the clients page filters the one list down to the
// clients whose name matches what is typed. Asserts ONLY through the UI (data-testid); data is
// arranged via resetAndSeed (the app's /__test__ endpoint, honouring clients { id, name, email }).
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

const SEED = {
  clients: [
    { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
    { id: 2, name: 'Globex', email: 'contact@globex.test' },
    { id: 3, name: 'Initech', email: 'info@initech.test' },
    { id: 4, name: 'Acme Industries', email: 'ops@acme-ind.test' },
  ],
};

test.describe('Client search', () => {
  test('the clients page offers a search box', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/clients');

    await expect(page.getByTestId('clients-page')).toBeVisible();
    // The new search control is present on the list page.
    await expect(page.getByTestId('client-search')).toBeVisible();
    // Before anything is typed, every seeded client is still shown.
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(4);
  });

  test('typing a name narrows the list to the matching clients', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/clients');
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(4);

    // Searching for "acme" (a case-insensitive substring of the name) leaves only the two Acme
    // clients; the non-matching clients drop out of the list.
    await page.getByTestId('client-search').fill('acme');

    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(2);
    await expect(page.getByTestId('client-row-1')).toBeVisible();
    await expect(page.getByTestId('client-row-4')).toBeVisible();
    await expect(page.getByTestId('client-row-2')).toHaveCount(0);
    await expect(page.getByTestId('client-row-3')).toHaveCount(0);
    // The surviving rows still carry their name and email unchanged.
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText('Acme Corp');
    await expect(page.getByTestId('client-row-4').getByTestId('client-name')).toHaveText('Acme Industries');
  });

  test('a more specific query narrows to a single client', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/clients');

    await page.getByTestId('client-search').fill('Globex');

    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(1);
    await expect(page.getByTestId('client-row-2')).toBeVisible();
    await expect(page.getByTestId('client-row-2').getByTestId('client-email')).toHaveText('contact@globex.test');
  });

  test('clearing the search box restores the full list', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/clients');

    const search = page.getByTestId('client-search');
    await search.fill('Initech');
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(1);
    await expect(page.getByTestId('client-row-3')).toBeVisible();

    // Emptying the box brings every client back.
    await search.fill('');
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(4);
  });

  test('a query that matches no client leaves no rows', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/clients');

    await page.getByTestId('client-search').fill('nobody-by-this-name');

    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(0);
  });
});
