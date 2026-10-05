// Acceptance tests for the change request:
//   "Let me sort a project's invoices by their due date."
//
// A project's detail page gains a control (invoice-sort-due) that reorders the invoice rows by their
// DUE date, earliest-due first. Activating it does not add or drop any invoice — it only changes the
// order the existing rows appear in.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed; the sort is driven
// through the control. Seed honours invoices: { id, projectId, amount, issuedDate, dueDate, status }.
//
// Order is asserted format-tolerantly and position-tolerantly: we read the invoice-row-<id> elements
// in DOM order and compare the sequence of row ids. The seed is constructed so the due-date ascending
// order is a DISTINCTIVE permutation — one that id order, reverse-id order, amount order and
// issued-date order all FAIL to produce — so passing requires sorting by due date specifically, and
// not leaving the rows as seeded, reversing them, or sorting by some other column.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// The row ids, in the order the invoice rows currently appear on the page.
async function invoiceRowOrder(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="invoice-row-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''));
}

test.describe('sort invoices by due date', () => {
  test('activating the control orders the invoices earliest-due first', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      // Due-date ascending order is 2 (Jan) -> 1 (Mar) -> 3 (Dec) == [2, 1, 3], which is NOT the id
      // order [1,2,3], NOT reverse [3,2,1], NOT amount order (100,200,300 -> [2,3,1]) and NOT issued
      // order (Feb,Jul,Nov -> [3,2,1]). Only a genuine due-date sort yields [2,1,3].
      invoices: [
        { id: 1, projectId: 1, amount: 300, issuedDate: '2025-11-01', dueDate: '2025-03-10' },
        { id: 2, projectId: 1, amount: 100, issuedDate: '2025-07-01', dueDate: '2025-01-05' },
        { id: 3, projectId: 1, amount: 200, issuedDate: '2025-02-01', dueDate: '2025-12-20' },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();

    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('invoice-row-1')).toBeVisible();
    await expect(page.getByTestId('invoice-row-2')).toBeVisible();
    await expect(page.getByTestId('invoice-row-3')).toBeVisible();

    // Sort by due date.
    await expect(page.getByTestId('invoice-sort-due')).toBeVisible();
    await page.getByTestId('invoice-sort-due').click();

    // The same three invoices, now earliest-due first.
    await expect(page.getByTestId('invoice-row-1')).toBeVisible();
    await expect(page.getByTestId('invoice-row-2')).toBeVisible();
    await expect(page.getByTestId('invoice-row-3')).toBeVisible();
    expect(await invoiceRowOrder(page)).toEqual([
      'invoice-row-2',
      'invoice-row-1',
      'invoice-row-3',
    ]);
  });

  test('the control sorts by due date whatever the seeded order', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      // A different fixture: due-date ascending order here is 3 (Feb) -> 2 (May) -> 1 (Aug) ==
      // [3, 2, 1]. Together with the first test's [2,1,3] this rules out any fixed/hardcoded order —
      // only reading each invoice's own due date can satisfy both.
      invoices: [
        { id: 1, projectId: 1, amount: 400, issuedDate: '2025-01-01', dueDate: '2025-08-15' },
        { id: 2, projectId: 1, amount: 500, issuedDate: '2025-01-02', dueDate: '2025-05-02' },
        { id: 3, projectId: 1, amount: 600, issuedDate: '2025-01-03', dueDate: '2025-02-20' },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();

    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('invoice-row-3')).toBeVisible();

    await expect(page.getByTestId('invoice-sort-due')).toBeVisible();
    await page.getByTestId('invoice-sort-due').click();

    expect(await invoiceRowOrder(page)).toEqual([
      'invoice-row-3',
      'invoice-row-2',
      'invoice-row-1',
    ]);
  });
});
