// Acceptance tests for the change request:
//   "Do not let me add an invoice for nothing. The amount has to be more than zero."
//
// The raise-an-invoice form on a project's detail page refuses to add an invoice unless the amount
// is strictly greater than zero. Submitting zero (or a non-positive amount) is rejected: the form
// surfaces `invoice-form-amount-error` and NO invoice is created (the list stays empty and the total
// does not change). A positive amount still adds the invoice and clears the error.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed; the add flow is
// driven through the form. Seed honours projects: { id, clientId, name }, invoices: { id, projectId,
// amount } and clients: { id, name, email }.
//
// Amounts are MONEY, asserted in the app's money format ("$250.00") per the money-format change.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('invoice amount must be more than zero', () => {
  test('does not show the amount error before the user tries to add', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();

    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('invoice-form')).toBeVisible();
    await expect(page.getByTestId('invoice-form-amount-error')).toHaveCount(0);
  });

  test('refuses to add an invoice for zero, surfacing the error and creating nothing', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();

    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('invoice-form')).toBeVisible();
    // No invoices seeded, so no invoice rows yet.
    await expect(page.getByTestId('invoice-amount')).toHaveCount(0);

    await page.getByTestId('invoice-form-amount').fill('0');
    await page.getByTestId('invoice-form-submit').click();

    // The feature surfaces the amount error and refuses to add.
    await expect(page.getByTestId('invoice-form-amount-error')).toBeVisible();

    // Nothing was created: reset RESTART IDENTITY + empty seed => the first invoice would be id 1.
    await expect(page.getByTestId('invoice-row-1')).toHaveCount(0);
    await expect(page.getByTestId('invoice-amount')).toHaveCount(0);
    // Still no invoices, so what they add up to is unchanged (nothing).
    await expect(page.getByTestId('project-invoices-total')).toContainText('$0.00');
  });

  test('adds the invoice once a positive amount is provided, clearing the error', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();

    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('invoice-form')).toBeVisible();

    // First attempt with zero is rejected.
    await page.getByTestId('invoice-form-amount').fill('0');
    await page.getByTestId('invoice-form-submit').click();

    await expect(page.getByTestId('invoice-form-amount-error')).toBeVisible();
    await expect(page.getByTestId('invoice-row-1')).toHaveCount(0);

    // Correcting to a positive amount lets it add, and the error goes away.
    await page.getByTestId('invoice-form-amount').fill('250');
    await page.getByTestId('invoice-form-submit').click();

    const row = page.getByTestId('invoice-row-1');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('invoice-amount')).toContainText('$250.00');
    await expect(page.getByTestId('project-invoices-total')).toContainText('$250.00');

    await expect(page.getByTestId('invoice-form-amount-error')).toHaveCount(0);
  });
});
