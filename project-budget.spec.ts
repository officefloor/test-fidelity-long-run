// Acceptance tests for the change request:
//   "Let me set a budget on a project. Show how much I have invoiced against it. Show what is left."
//
// A project now carries a BUDGET. Its detail page gains a budget panel (project-budget-panel) that
// shows three money values: the budget that was set (project-budget), how much has been INVOICED
// against the project (project-invoiced — the sum of that project's own invoices), and what is LEFT
// (project-remaining — budget minus invoiced).
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed, which honours
// projects: { id, clientId, name, budget } alongside clients and invoices: { id, projectId, amount }.
// The budget is SET by seeding it (the honoured `budget` field is the Arrange for "set a budget");
// there is no dedicated set-budget form — unlike every other write in the app, the change introduces
// no *-submit anchor for a budget, so the budget is a value the panel DISPLAYS, and the only write
// flow exercised here is raising an invoice through the existing invoice form, which is what
// "invoiced against it" and "what is left" must then reflect.
//
// Money values are asserted EXACTLY with toHaveText in the app's money format — a dollar sign and two
// decimals, "$900.00" — per the "show money properly everywhere" change (see money-format.spec.ts).
// A non-whole amount (99.5 -> $99.50) proves cents are padded to two places on the derived values.
// All amounts stay below 1000 so no thousands separator is involved, and no value is a substring of
// another. This SHOULD FAIL before the change: the project detail page carries no budget panel today.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('project budget', () => {
  test('shows a project budget, what has been invoiced against it, and what is left', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign', budget: 900 },
        { id: 2, clientId: 1, name: 'Warehouse automation', budget: 400 },
      ],
      invoices: [
        { id: 1, projectId: 1, amount: 120 },
        // A non-whole amount: cents must still be padded to two places in the derived totals.
        { id: 2, projectId: 1, amount: 99.5 },
        // Belongs to a DIFFERENT project — it must not count toward project 1's invoiced total.
        { id: 3, projectId: 2, amount: 999 },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const panel = page.getByTestId('project-budget-panel');
    await expect(panel).toBeVisible();

    // The budget that was set.
    await expect(panel.getByTestId('project-budget')).toHaveText('$900.00');

    // Invoiced against this project: 120 + 99.5 = 219.50 — and NOT the other project's 999.
    await expect(panel.getByTestId('project-invoiced')).toHaveText('$219.50');
    await expect(panel.getByTestId('project-invoiced')).not.toContainText('999');

    // What is left: 900 - 219.5 = 680.50.
    await expect(panel.getByTestId('project-remaining')).toHaveText('$680.50');
  });

  test('the budget shown is the one set on that project, not a fixed value', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign', budget: 500 },
        { id: 2, clientId: 1, name: 'Warehouse automation', budget: 275 },
      ],
      invoices: [],
    });

    // Project 1: budget 500, nothing invoiced yet -> left is the whole budget.
    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('project-budget')).toHaveText('$500.00');
    await expect(page.getByTestId('project-invoiced')).toHaveText('$0.00');
    await expect(page.getByTestId('project-remaining')).toHaveText('$500.00');

    // Project 2 carries a DIFFERENT budget — proving the value shown is per-project, not hardcoded.
    await page.goto('/projects');
    await page.getByTestId('project-open-2').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('project-budget')).toHaveText('$275.00');
    await expect(page.getByTestId('project-invoiced')).toHaveText('$0.00');
    await expect(page.getByTestId('project-remaining')).toHaveText('$275.00');
  });

  test('raising an invoice adds to what is invoiced and reduces what is left', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign', budget: 900 }],
      invoices: [{ id: 1, projectId: 1, amount: 120 }],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    // Starting point: 120 invoiced against a 900 budget -> 780 left.
    await expect(page.getByTestId('project-budget')).toHaveText('$900.00');
    await expect(page.getByTestId('project-invoiced')).toHaveText('$120.00');
    await expect(page.getByTestId('project-remaining')).toHaveText('$780.00');

    // Raise another invoice for 300 through the existing invoice form.
    await page.getByTestId('invoice-form-amount').fill('300');
    await page.getByTestId('invoice-form-submit').click();

    // Invoiced is now 120 + 300 = 420, and what is left falls to 900 - 420 = 480. The budget is
    // unchanged.
    await expect(page.getByTestId('project-budget')).toHaveText('$900.00');
    await expect(page.getByTestId('project-invoiced')).toHaveText('$420.00');
    await expect(page.getByTestId('project-remaining')).toHaveText('$480.00');
  });
});
