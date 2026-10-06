// Acceptance tests for the change request:
//   "Let me cancel an invoice I sent by mistake. It should stop counting toward what I am owed.
//    Note it."
//
// An invoice that has been SENT can be CANCELLED (voided) — it went out by mistake. Each sent
// invoice offers a control to cancel it (invoice-cancel-<id>), rendered on its project's detail page
// alongside the invoice rows (the same surface the Send control lives on). Cancelling an invoice:
//   - stops it counting toward "what I am owed": the money-owed total (dashboard-outstanding-total,
//     the sum of SENT-but-unpaid invoice amounts — see invoice-owed-sent-only.spec.ts) drops by the
//     cancelled invoice's amount, while its still-sent siblings keep counting;
//   - leaves nothing left to cancel on that invoice, so its cancel control is gone afterwards;
//   - appends exactly one audit record — INVOICE_VOIDED id=<id> amount=<amount> — so the act is
//     noted (the UI only stops counting the invoice; the audit file is how the void is checked back).
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed; the cancel is driven through the UI. Seed
// honours clients { id, name, email }, projects { id, clientId, name } and invoices
// { id, projectId, amount, status } — status places an invoice directly at the SENT stage.
//
// The owed total is MONEY, so it is asserted in the app's money format — a dollar sign and two
// decimals, "$300.00" (see money-format.spec.ts). Amounts are distinct whole numbers under 1000 (no
// thousands separator), chosen so no amount is a substring of another or of a wrong total. The audit
// amount is matched with an optional trailing ".00" so a plain or two-decimal rendering both pass.
// This SHOULD FAIL before the change: today a sent invoice has no cancel control, cancelling records
// nothing, and a cancelled invoice would still be counted as money owed.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

// Reach the dashboard through its nav link (the stable contract), re-navigating from the root so the
// owed figure is read from a fresh load rather than a possibly stale in-page cache.
async function openDashboard(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-root')).toBeVisible();
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await expect(page.getByTestId('dashboard-loading')).toHaveCount(0);
  await expect(page.getByTestId('dashboard-error')).toHaveCount(0);
}

// Open the project's detail page, where its invoice rows (and their lifecycle controls) live.
async function openProject(page: import('@playwright/test').Page, projectId: number) {
  await page.goto('/projects');
  await page.getByTestId(`project-open-${projectId}`).click();
  await expect(page.getByTestId('project-detail-page')).toBeVisible();
  await expect(page.getByTestId('project-invoices-table')).toBeVisible();
}

test.describe('cancel an invoice sent by mistake', () => {
  test('cancelling a sent invoice stops it counting toward money owed, leaves siblings owed, and notes it', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        // Both sent, so both count as money owed to begin with. Invoice 1 went out by mistake.
        { id: 1, projectId: 1, amount: 120, status: 'SENT' },
        { id: 2, projectId: 1, amount: 300, status: 'SENT' },
      ],
    });

    // Before cancelling: both sent invoices count, so owed is 120 + 300 = 420.
    await openDashboard(page);
    await expect(page.getByTestId('dashboard-outstanding-total')).toContainText('$420.00');

    await openProject(page, 1);
    const first = page.getByTestId('invoice-row-1');
    const second = page.getByTestId('invoice-row-2');
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();

    // A sent invoice offers a cancel control; both are sent, so both are cancellable.
    await expect(page.getByTestId('invoice-cancel-1')).toBeVisible();
    await expect(page.getByTestId('invoice-cancel-2')).toBeVisible();

    // reset cleared the audit file — nothing has been cancelled yet.
    expect(auditLines()).toEqual([]);

    // Cancel the invoice sent by mistake.
    await page.getByTestId('invoice-cancel-1').click();

    // Nothing left to cancel on it; its sibling is untouched and still cancellable.
    await expect(page.getByTestId('invoice-cancel-1')).toHaveCount(0);
    await expect(second).toBeVisible();
    await expect(page.getByTestId('invoice-cancel-2')).toBeVisible();

    // Exactly one record was kept for the void, naming the invoice and its amount — and only that one.
    await expect
      .poll(() => auditLines().filter((l) => /^INVOICE_VOIDED id=1 amount=120(\.0+)?$/.test(l)))
      .toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // Now it stops counting toward what I am owed: owed is just the still-sent sibling, 300.
    await openDashboard(page);
    await expect(page.getByTestId('dashboard-outstanding-total')).toContainText('$300.00');
    // Not the pre-cancel total (420), nor the cancelled invoice's amount (120).
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('420');
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('120');
  });

  test('cancelling the only sent invoice leaves nothing owed', async ({ page }) => {
    // One sent invoice. RESTART IDENTITY on reset means it keeps the seeded id 1.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [{ id: 1, projectId: 1, amount: 250, status: 'SENT' }],
    });

    // Sent, so it counts as owed: 250.
    await openDashboard(page);
    await expect(page.getByTestId('dashboard-outstanding-total')).toContainText('$250.00');

    await openProject(page, 1);
    await expect(page.getByTestId('invoice-row-1')).toBeVisible();
    await expect(page.getByTestId('invoice-cancel-1')).toBeVisible();
    expect(auditLines()).toEqual([]);

    await page.getByTestId('invoice-cancel-1').click();
    await expect(page.getByTestId('invoice-cancel-1')).toHaveCount(0);

    // The void was noted exactly once, naming the invoice and its amount — and only that one.
    await expect
      .poll(() => auditLines().filter((l) => /^INVOICE_VOIDED id=1 amount=250(\.0+)?$/.test(l)))
      .toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // With the sole sent invoice cancelled, nothing is owed any more — and the amount is not lingering.
    await openDashboard(page);
    await expect(page.getByTestId('dashboard-outstanding-total')).toContainText('$0.00');
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('250');
  });
});
