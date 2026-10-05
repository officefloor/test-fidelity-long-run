// Acceptance tests for the change request:
//   "Give me one place that lists all my invoices from every project. Show which project each one
//    is for. Show what stage it is at."
//
// A new page (invoices-page, reachable from nav-invoices) lists EVERY invoice across ALL projects in
// one place — not scoped to a single project the way the project detail page is. Each row names which
// project the invoice is for (invoice-project) and shows what stage it is at (invoice-status:
// DRAFT / SENT / PAID). When there are no invoices at all, an empty state (all-invoices-empty) is
// shown instead of the table.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed. Seed honours
// clients: { id, name, email }, projects: { id, clientId, name } and invoices: { id, projectId,
// amount, status }.
//
// Status labels are asserted case-insensitively (/^draft$/i etc.) so the test tolerates whichever
// casing the feature renders — matching how the existing invoice-stage tests assert status. The two
// project names are distinct and neither is a substring of the other, so an invoice-project
// assertion cannot pass by accident. This test SHOULD FAIL before the change: there is no
// all-invoices page today.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('all invoices in one place', () => {
  test('lists every invoice from every project, each with its project and stage', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example' },
        { id: 2, name: 'Globex', email: 'hello@globex.example' },
      ],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign' },
        { id: 2, clientId: 2, name: 'Warehouse automation' },
      ],
      // Invoices spread across TWO different projects, seeded straight into distinct stages. A page
      // that only showed one project's invoices would be missing invoice 3 (the other project's).
      invoices: [
        { id: 1, projectId: 1, amount: 120, status: 'DRAFT' },
        { id: 2, projectId: 1, amount: 300, status: 'SENT' },
        { id: 3, projectId: 2, amount: 999, status: 'PAID' },
      ],
    });

    await page.goto('/invoices');

    await expect(page.getByTestId('invoices-page')).toBeVisible();
    await expect(page.getByTestId('all-invoices-table')).toBeVisible();
    await expect(page.getByTestId('all-invoices-empty')).toHaveCount(0);

    // Invoice 1 — project "Website redesign", stage DRAFT.
    const first = page.getByTestId('invoice-row-1');
    await expect(first).toBeVisible();
    await expect(first.getByTestId('invoice-project')).toHaveText('Website redesign');
    await expect(first.getByTestId('invoice-status')).toHaveText(/^draft$/i);

    // Invoice 2 — same project, but stage SENT.
    const second = page.getByTestId('invoice-row-2');
    await expect(second).toBeVisible();
    await expect(second.getByTestId('invoice-project')).toHaveText('Website redesign');
    await expect(second.getByTestId('invoice-status')).toHaveText(/^sent$/i);

    // Invoice 3 — a DIFFERENT project "Warehouse automation", stage PAID. Its presence here is what
    // makes this "every project" rather than one project's invoices.
    const third = page.getByTestId('invoice-row-3');
    await expect(third).toBeVisible();
    await expect(third.getByTestId('invoice-project')).toHaveText('Warehouse automation');
    await expect(third.getByTestId('invoice-status')).toHaveText(/^paid$/i);
  });

  test('shows an empty state when there are no invoices at all', async ({ page }) => {
    // Projects exist, so the page can only be empty of INVOICES, not of everything.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [],
    });

    await page.goto('/invoices');

    await expect(page.getByTestId('invoices-page')).toBeVisible();
    await expect(page.getByTestId('all-invoices-empty')).toBeVisible();
    // No invoice rows when there are no invoices.
    await expect(page.getByTestId('invoice-project')).toHaveCount(0);
  });

  test('reaches the all-invoices page from the nav', async ({ page }) => {
    await resetAndSeed({ clients: [], projects: [], invoices: [] });

    await page.goto('/');
    await expect(page.getByTestId('app-root')).toBeVisible();

    await page.getByTestId('nav-invoices').click();

    await expect(page.getByTestId('invoices-page')).toBeVisible();
  });
});
