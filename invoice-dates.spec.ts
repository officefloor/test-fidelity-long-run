// Acceptance tests for the change request:
//   "Put two dates on each invoice. One for when it went out. One for when it is due. Show them
//    both."
//
// Each invoice now carries TWO dates: the date it was ISSUED (when it went out) and the date it is
// DUE. On a project's detail page every invoice row surfaces both, under `invoice-issued` and
// `invoice-due`, and they are shown together (both visible at once). The right date lands in the
// right slot — the issued date is not shown as the due date and vice versa — and each invoice row
// shows its OWN pair, not a sibling's.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed; the two dates are
// seeded via the honoured invoice fields issuedDate and dueDate (alongside id, projectId, amount).
//
// Dates are asserted format-tolerantly: a date rendering — whether "2025-06-15", "Jun 15, 2025" or
// "15 June 2025" — contains the day-of-month number. The seed dates are chosen so each date's
// day-of-month (15 / 28 / 11 / 23) is a distinctive two-digit number that is NOT a substring of the
// year, of any month, of the amounts, or of any other date's day in the same comparison. So each
// cell is checked to CONTAIN its own date's day and to NOT contain the day of the date it must be
// kept distinct from — which pins the issued/due mapping and the per-row scoping without pinning the
// exact display format.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('invoice issued and due dates', () => {
  test('an invoice shows both its issued date and its due date, each in its own slot', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        { id: 1, projectId: 1, amount: 120, issuedDate: '2025-06-15', dueDate: '2025-07-28' },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();

    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const row = page.getByTestId('invoice-row-1');
    await expect(row).toBeVisible();

    // Both dates are surfaced for the invoice, and shown together.
    const issued = row.getByTestId('invoice-issued');
    const due = row.getByTestId('invoice-due');
    await expect(issued).toBeVisible();
    await expect(due).toBeVisible();

    // The right date is in the right slot: issued carries 2025-06-15 (day 15), due carries
    // 2025-07-28 (day 28). Each slot contains its own day and not the other's — so a rendering that
    // swapped the two would fail.
    await expect(issued).toContainText('15');
    await expect(issued).not.toContainText('28');
    await expect(due).toContainText('28');
    await expect(due).not.toContainText('15');
  });

  test('each invoice shows its own pair of dates, not a sibling invoice\'s', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        { id: 1, projectId: 1, amount: 120, issuedDate: '2025-06-15', dueDate: '2025-07-28' },
        { id: 2, projectId: 1, amount: 300, issuedDate: '2025-09-11', dueDate: '2025-10-23' },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();

    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const first = page.getByTestId('invoice-row-1');
    const second = page.getByTestId('invoice-row-2');
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();

    const firstIssued = first.getByTestId('invoice-issued');
    const firstDue = first.getByTestId('invoice-due');
    const secondIssued = second.getByTestId('invoice-issued');
    const secondDue = second.getByTestId('invoice-due');

    await expect(firstIssued).toBeVisible();
    await expect(firstDue).toBeVisible();
    await expect(secondIssued).toBeVisible();
    await expect(secondDue).toBeVisible();

    // Invoice 1's pair: issued day 15, due day 28 — and none of invoice 2's days (11, 23) leak in.
    await expect(firstIssued).toContainText('15');
    await expect(firstIssued).not.toContainText('11');
    await expect(firstDue).toContainText('28');
    await expect(firstDue).not.toContainText('23');

    // Invoice 2's pair: issued day 11, due day 23 — and none of invoice 1's days (15, 28) leak in.
    await expect(secondIssued).toContainText('11');
    await expect(secondIssued).not.toContainText('15');
    await expect(secondDue).toContainText('23');
    await expect(secondDue).not.toContainText('28');
  });
});
