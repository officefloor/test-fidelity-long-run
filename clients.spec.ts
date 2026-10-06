// Acceptance test for the change request:
//   "I want to keep track of my clients. Let me add a client with their name and email.
//    Show me all my clients in one list."
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's
// /__test__ endpoint). The one seedable domain is `clients`, honouring { id, name, email }.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('Clients', () => {
  test('a link in the nav opens the clients list', async ({ page }) => {
    await resetAndSeed({ clients: [] });

    await page.goto('/');
    // The shell is present and Home still shows its empty state (unchanged behaviour).
    await expect(page.getByTestId('app-root')).toBeVisible();
    await expect(page.getByTestId('app-nav')).toBeVisible();
    await expect(page.getByTestId('home-empty')).toBeVisible();

    // Clients is reachable from the nav; following it lands on the clients page.
    const navClients = page.getByTestId('nav-clients');
    await expect(navClients).toBeVisible();
    await navClients.click();

    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByTestId('clients-page')).toBeVisible();
  });

  test('with no clients the list shows an empty state', async ({ page }) => {
    await resetAndSeed({ clients: [] });

    await page.goto('/clients');

    await expect(page.getByTestId('clients-page')).toBeVisible();
    await expect(page.getByTestId('clients-empty')).toBeVisible();
    // Nothing is listed yet.
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(0);
  });

  test('all seeded clients are shown in one list, each with name and email', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
        { id: 3, name: 'Initech', email: 'info@initech.test' },
      ],
    });

    await page.goto('/clients');

    await expect(page.getByTestId('clients-page')).toBeVisible();
    await expect(page.getByTestId('clients-table')).toBeVisible();
    await expect(page.getByTestId('clients-empty')).toHaveCount(0);

    // Every seeded client appears as its own row, carrying its name and email.
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(3);

    const acme = page.getByTestId('client-row-1');
    await expect(acme).toBeVisible();
    await expect(acme.getByTestId('client-name')).toHaveText('Acme Corp');
    await expect(acme.getByTestId('client-email')).toHaveText('hello@acme.test');

    const globex = page.getByTestId('client-row-2');
    await expect(globex.getByTestId('client-name')).toHaveText('Globex');
    await expect(globex.getByTestId('client-email')).toHaveText('contact@globex.test');

    const initech = page.getByTestId('client-row-3');
    await expect(initech.getByTestId('client-name')).toHaveText('Initech');
    await expect(initech.getByTestId('client-email')).toHaveText('info@initech.test');
  });

  test('adding a client with a name and email shows it in the list', async ({ page }) => {
    await resetAndSeed({ clients: [] });

    await page.goto('/clients');
    await expect(page.getByTestId('clients-empty')).toBeVisible();

    // Fill the add-client form and submit.
    await expect(page.getByTestId('client-form')).toBeVisible();
    await page.getByTestId('client-form-name').fill('Wayne Enterprises');
    await page.getByTestId('client-form-email').fill('bruce@wayne.test');
    await page.getByTestId('client-form-submit').click();

    // The newly added client now appears in the list with its name and email. Its id is assigned
    // by the server, so locate the row by its content rather than a known id.
    const newRow = page
      .locator('[data-testid^="client-row-"]')
      .filter({ has: page.getByTestId('client-name').getByText('Wayne Enterprises', { exact: true }) });

    await expect(newRow).toHaveCount(1);
    await expect(newRow.getByTestId('client-name')).toHaveText('Wayne Enterprises');
    await expect(newRow.getByTestId('client-email')).toHaveText('bruce@wayne.test');

    // And the empty state is gone now that a client exists.
    await expect(page.getByTestId('clients-empty')).toHaveCount(0);
    await expect(page.getByTestId('clients-table')).toBeVisible();
  });

  test('a client added on top of seeded clients joins the same single list', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
    });

    await page.goto('/clients');
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(1);

    await page.getByTestId('client-form-name').fill('Globex');
    await page.getByTestId('client-form-email').fill('contact@globex.test');
    await page.getByTestId('client-form-submit').click();

    // Both the pre-existing and the newly added client are shown together in the one list.
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(2);
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText('Acme Corp');

    const globexRow = page
      .locator('[data-testid^="client-row-"]')
      .filter({ has: page.getByTestId('client-name').getByText('Globex', { exact: true }) });
    await expect(globexRow.getByTestId('client-email')).toHaveText('contact@globex.test');
  });
});
