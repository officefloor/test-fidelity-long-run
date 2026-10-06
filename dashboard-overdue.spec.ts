// Acceptance tests for the change request:
//   "On the home screen tell me how many sent invoices are overdue."
//
// The dashboard home screen gains a figure: HOW MANY SENT INVOICES ARE OVERDUE, surfaced in its own
// tile (dashboard-overdue) with the count under dashboard-overdue-count, and its own loading/error
// states (dashboard-overdue-loading / dashboard-overdue-error) — it queries for itself.
//
// An invoice is OVERDUE when it has gone out but not come in and its due date has passed:
//   - it is SENT (DRAFT -> SENT -> PAID; see invoice-send.spec.ts). A DRAFT has never gone out, a
//     PAID invoice is already settled — neither is a "sent invoice that is overdue".
//   - its DUE date is in the PAST relative to "today". Today is pinned by the honoured `asOf` seed
//     field so the test does not depend on the wall clock; a SENT invoice not yet due is NOT overdue.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed. Seed honours
// `asOf` (the scalar "today"), invoices: { id, projectId, amount, status, dueDate }, plus clients and
// projects for the rows invoices hang off.
//
// The count is a whole number asserted with toContainText so a label ("2 overdue") still passes. The
// fixture is built so the overdue count is a DISTINCTIVE number that the plausible wrong answers all
// miss: counting every SENT invoice, every past-due invoice regardless of status, or every invoice
// each gives a different figure. The count is checked to CONTAIN its own value and NOT contain any of
// those wrong figures, so passing requires counting sent-AND-overdue specifically.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// Reach the dashboard through its nav link — the nav entry is the stable contract (nav-dashboard),
// the concrete path is the feature's own choice.
async function openDashboard(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-root')).toBeVisible();
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
}

test.describe('dashboard: how many sent invoices are overdue', () => {
  test('counts the SENT invoices whose due date has passed', async ({ page }) => {
    await resetAndSeed({
      // "Today" is pinned so "due date has passed" is deterministic.
      asOf: '2025-06-15',
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        // SENT and due in the past -> overdue. (2 of these.)
        { id: 1, projectId: 1, amount: 120, status: 'SENT', dueDate: '2025-01-10' },
        { id: 2, projectId: 1, amount: 300, status: 'SENT', dueDate: '2025-03-20' },
        // SENT but not yet due (due in the future) -> NOT overdue. Makes "all sent" = 3 != 2.
        { id: 3, projectId: 1, amount: 200, status: 'SENT', dueDate: '2025-12-01' },
        // PAID and past its due date -> already settled, NOT a sent invoice that is overdue.
        { id: 4, projectId: 1, amount: 999, status: 'PAID', dueDate: '2025-02-01' },
        // DRAFT and past its due date -> never went out, NOT overdue. Makes "all past-due" = 4 and
        // "all invoices" = 5, both distinct from the correct 2.
        { id: 5, projectId: 1, amount: 777, status: 'DRAFT', dueDate: '2025-01-05' },
      ],
    });

    await openDashboard(page);

    // The overdue tile is present and its own data has loaded.
    await expect(page.getByTestId('dashboard-overdue')).toBeVisible();
    await expect(page.getByTestId('dashboard-overdue-loading')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-overdue-error')).toHaveCount(0);

    const count = page.getByTestId('dashboard-overdue-count');
    // Exactly two invoices are both SENT and past due.
    await expect(count).toContainText('2');
    // Not "all sent" (3), not "all past-due regardless of status" (4), not "all invoices" (5).
    await expect(count).not.toContainText('3');
    await expect(count).not.toContainText('4');
    await expect(count).not.toContainText('5');
  });

  test('neither a not-yet-due sent invoice, a paid invoice nor a draft is overdue', async ({ page }) => {
    await resetAndSeed({
      asOf: '2025-06-15',
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        // SENT but due in the future -> not overdue.
        { id: 1, projectId: 1, amount: 120, status: 'SENT', dueDate: '2025-12-01' },
        { id: 2, projectId: 1, amount: 300, status: 'SENT', dueDate: '2025-09-10' },
        // Past their due dates, but PAID / DRAFT -> still not overdue.
        { id: 3, projectId: 1, amount: 999, status: 'PAID', dueDate: '2025-01-01' },
        { id: 4, projectId: 1, amount: 777, status: 'DRAFT', dueDate: '2025-02-01' },
      ],
    });

    await openDashboard(page);

    await expect(page.getByTestId('dashboard-overdue')).toBeVisible();
    await expect(page.getByTestId('dashboard-overdue-loading')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-overdue-error')).toHaveCount(0);

    const count = page.getByTestId('dashboard-overdue-count');
    // Nothing is overdue.
    await expect(count).toContainText('0');
    // Not the two sent-but-not-due (2), not the two past-due-but-not-sent (2), not all four.
    await expect(count).not.toContainText('2');
    await expect(count).not.toContainText('4');
  });
});
