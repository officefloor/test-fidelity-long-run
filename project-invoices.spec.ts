// Acceptance tests for the change request:
//   "When I open a project I want to see its invoices. Show me what they add up to. Let me add a
//    new invoice for an amount."
//
// Opening a project (project-open-<id> from the projects list) reaches that project's detail page.
// The detail page lists the project's OWN invoices (each with its amount), shows what they ADD UP
// TO, and offers a form to add a new invoice for an amount. After adding, the new invoice appears
// and the total reflects it.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed; the add flow is
// driven through the form. Seed honours clients: { id, name, email }, projects: { id, clientId,
// name } and invoices: { id, projectId, amount }.
//
// Amounts are MONEY, so they are asserted in the app's money format — a dollar sign and two decimals,
// "$120.00" — per the "show money properly everywhere" change (see money-format.spec.ts). The amounts
// are picked so no value is a substring of another or of the total, and all stay below 1000 so no
// thousands separator is involved.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('project invoices', () => {
  test('opening a project shows its invoices and what they add up to', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign' },
        { id: 2, clientId: 1, name: 'Warehouse automation' },
      ],
      invoices: [
        { id: 1, projectId: 1, amount: 120 },
        { id: 2, projectId: 1, amount: 300 },
        // Belongs to a DIFFERENT project — it must not appear or count toward project 1's total.
        { id: 3, projectId: 2, amount: 999 },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();

    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('project-invoices-table')).toBeVisible();

    // Project 1's own invoices, each showing its amount.
    const first = page.getByTestId('invoice-row-1');
    await expect(first).toBeVisible();
    await expect(first.getByTestId('invoice-amount')).toContainText('$120.00');

    const second = page.getByTestId('invoice-row-2');
    await expect(second).toBeVisible();
    await expect(second.getByTestId('invoice-amount')).toContainText('$300.00');

    // The other project's invoice is not shown here.
    await expect(page.getByTestId('invoice-row-3')).toHaveCount(0);

    // What they add up to: 120 + 300 = 420 (and NOT including the other project's 999).
    await expect(page.getByTestId('project-invoices-total')).toContainText('$420.00');
    await expect(page.getByTestId('project-invoices-total')).not.toContainText('999');
  });

  test('adds a new invoice for an amount, which then appears and is added into the total', async ({ page }) => {
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

    await page.getByTestId('invoice-form-amount').fill('250');
    await page.getByTestId('invoice-form-submit').click();

    // Reset RESTART IDENTITY + empty invoices seed => the first created invoice has id 1.
    const row = page.getByTestId('invoice-row-1');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('invoice-amount')).toContainText('$250.00');

    // The newly added amount is what the invoices add up to.
    await expect(page.getByTestId('project-invoices-total')).toContainText('$250.00');
  });

  test('a freshly added invoice adds onto the existing total', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [{ id: 1, projectId: 1, amount: 120 }],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();

    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('invoice-row-1').getByTestId('invoice-amount')).toContainText('$120.00');
    await expect(page.getByTestId('project-invoices-total')).toContainText('$120.00');

    await page.getByTestId('invoice-form-amount').fill('300');
    await page.getByTestId('invoice-form-submit').click();

    // Both invoices now listed, and the total is 120 + 300 = 420.
    await expect(page.getByTestId('invoice-row-1').getByTestId('invoice-amount')).toContainText('$120.00');
    await expect(page.getByTestId('invoice-row-2').getByTestId('invoice-amount')).toContainText('$300.00');
    await expect(page.getByTestId('project-invoices-total')).toContainText('$420.00');
  });
});
