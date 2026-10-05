// Acceptance tests for the change request:
//   "Show money properly everywhere. Use a dollar sign and cents, like $100.00."
//
// Every money VALUE the app surfaces must be rendered as a dollar sign followed by the amount with
// exactly two decimal places — "$100.00". This applies everywhere money is shown. There are three
// money anchors in the app, and each one must use this format:
//   - an invoice's amount on the project detail page   -> invoice-amount
//   - what a project's invoices add up to              -> project-invoices-total
//   - the outstanding (still owed) total on the home   -> dashboard-outstanding-total
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed. Seed honours
// clients: { id, name, email }, projects: { id, clientId, name } and invoices: { id, projectId,
// amount, status }.
//
// These anchors each render just the money value, so the format is asserted EXACTLY with toHaveText
// — "$120.00", not "120.00", not "$120", not "120". A decimal amount (99.5) is included to prove the
// cents are always shown to two places ("$99.50"). Amounts stay below 1000 so no thousands separator
// is involved. Against the app BEFORE this change (bare "120.00" with no dollar sign) every exact
// assertion here fails, which is expected.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('money is shown with a dollar sign and cents', () => {
  test('an invoice amount is shown like $120.00', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        { id: 1, projectId: 1, amount: 120, status: 'UNPAID' },
        // A non-whole amount: cents must still be padded to two places -> $99.50.
        { id: 2, projectId: 1, amount: 99.5, status: 'UNPAID' },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    await expect(page.getByTestId('invoice-row-1').getByTestId('invoice-amount')).toHaveText('$120.00');
    await expect(page.getByTestId('invoice-row-2').getByTestId('invoice-amount')).toHaveText('$99.50');
  });

  test('the project invoices total is shown like $219.50', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        { id: 1, projectId: 1, amount: 120, status: 'UNPAID' },
        { id: 2, projectId: 1, amount: 99.5, status: 'UNPAID' },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    // 120 + 99.5 = 219.50, shown with a dollar sign and two decimals.
    await expect(page.getByTestId('project-invoices-total')).toHaveText('$219.50');
  });

  test('the dashboard outstanding total is shown like $475.00', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        { id: 1, projectId: 1, amount: 120, status: 'UNPAID' },
        { id: 2, projectId: 1, amount: 300, status: 'UNPAID' },
        { id: 3, projectId: 1, amount: 55, status: 'UNPAID' },
        // PAID -> not owed, not counted.
        { id: 4, projectId: 1, amount: 999, status: 'PAID' },
      ],
    });

    await page.goto('/');
    await expect(page.getByTestId('app-root')).toBeVisible();
    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect(page.getByTestId('dashboard-loading')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-error')).toHaveCount(0);

    // Owed = 120 + 300 + 55 = 475, shown as money.
    await expect(page.getByTestId('dashboard-outstanding-total')).toHaveText('$475.00');
  });

  test('a zero money total is shown like $0.00', async ({ page }) => {
    await resetAndSeed({ clients: [], projects: [], invoices: [] });

    await page.goto('/');
    await expect(page.getByTestId('app-root')).toBeVisible();
    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect(page.getByTestId('dashboard-error')).toHaveCount(0);

    // Nothing owed is still money: a dollar sign and two-decimal zero.
    await expect(page.getByTestId('dashboard-outstanding-total')).toHaveText('$0.00');
  });
});
