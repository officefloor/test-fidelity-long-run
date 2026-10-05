// Acceptance tests for the change request:
//   "Every client needs an email. Do not let me save one without a proper email address."
//
// A client must not be saved unless a PROPER email address is supplied. Saving with a missing or
// malformed email is rejected: the form surfaces `client-form-email-error` and no client is created.
// A valid email still saves (see clients.spec.ts "adds a client ...", which remains correct).
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed; the add flow is
// driven through the form. Seed honours clients: { id, name, email }.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('client email is required and must be valid', () => {
  test('does not show the email error before the user tries to save', async ({ page }) => {
    await resetAndSeed({ clients: [] });

    await page.goto('/clients');

    await expect(page.getByTestId('client-form')).toBeVisible();
    await expect(page.getByTestId('client-form-email-error')).toHaveCount(0);
  });

  test('refuses to save a client with no email', async ({ page }) => {
    await resetAndSeed({ clients: [] });

    await page.goto('/clients');
    await expect(page.getByTestId('clients-empty')).toBeVisible();

    await page.getByTestId('client-form-name').fill('Initech');
    // Leave email blank.
    await page.getByTestId('client-form-submit').click();

    // The feature surfaces the email error and refuses to save.
    await expect(page.getByTestId('client-form-email-error')).toBeVisible();

    // Nothing was created: the list is still empty and no client row exists.
    await expect(page.getByTestId('clients-empty')).toBeVisible();
    await expect(page.getByTestId('client-row-1')).toHaveCount(0);
    await expect(page.getByTestId('client-name')).toHaveCount(0);
  });

  test('refuses to save a client with a malformed email', async ({ page }) => {
    await resetAndSeed({ clients: [] });

    await page.goto('/clients');
    await expect(page.getByTestId('clients-empty')).toBeVisible();

    await page.getByTestId('client-form-name').fill('Globex');
    await page.getByTestId('client-form-email').fill('not-an-email');
    await page.getByTestId('client-form-submit').click();

    await expect(page.getByTestId('client-form-email-error')).toBeVisible();

    await expect(page.getByTestId('clients-empty')).toBeVisible();
    await expect(page.getByTestId('client-row-1')).toHaveCount(0);
    await expect(page.getByTestId('client-name')).toHaveCount(0);
  });

  test('saves the client once a proper email is provided, clearing the error', async ({ page }) => {
    await resetAndSeed({ clients: [] });

    await page.goto('/clients');
    await expect(page.getByTestId('clients-empty')).toBeVisible();

    // First attempt with a bad email is rejected.
    await page.getByTestId('client-form-name').fill('Acme Corp');
    await page.getByTestId('client-form-email').fill('acme');
    await page.getByTestId('client-form-submit').click();

    await expect(page.getByTestId('client-form-email-error')).toBeVisible();
    await expect(page.getByTestId('client-row-1')).toHaveCount(0);

    // Correcting to a proper email lets it save, and the error goes away.
    await page.getByTestId('client-form-email').fill('ops@acme.example');
    await page.getByTestId('client-form-submit').click();

    // Reset RESTART IDENTITY + empty seed => the first created client has id 1.
    const row = page.getByTestId('client-row-1');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('client-name')).toHaveText('Acme Corp');
    await expect(row.getByTestId('client-email')).toHaveText('ops@acme.example');

    await expect(page.getByTestId('client-form-email-error')).toHaveCount(0);
    await expect(page.getByTestId('clients-empty')).toHaveCount(0);
  });
});
