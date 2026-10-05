// Acceptance tests for the change request:
//   "The money I am owed should only count invoices I have actually sent. Do not count drafts."
//
// "The money I am owed" is the dashboard's outstanding total (dashboard-outstanding-total) — the
// money still to come in. Invoices move through DRAFT -> SENT -> PAID (see invoice-send.spec.ts). A
// DRAFT has not gone out yet, so it is NOT money owed; only an invoice I have actually SENT (and not
// since been paid) counts as owed. A PAID invoice is already in, so it does not count either (see
// dashboard.spec.ts). So: owed = the sum of SENT amounts only — DRAFT and PAID are both excluded.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed; the send flow is
// driven through the UI. Seed honours clients { id, name, email }, projects { id, clientId, name }
// and invoices { id, projectId, amount, status } — status places an invoice at a chosen stage
// ('DRAFT' / 'SENT' / 'PAID').
//
// The owed total is MONEY, so it is asserted in the app's money format — a dollar sign and two
// decimals, "$420.00" — per the "show money properly everywhere" change (see money-format.spec.ts).
// Amounts are distinct whole numbers under 1000 (so no thousands separator is involved), chosen so
// that neither a draft's amount nor any wrong total (a draft wrongly counted) is a substring of the
// correct owed total. This SHOULD FAIL before the change: today a sent-but-unpaid invoice is not
// counted as owed at all.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// Reach the dashboard through its nav link (the stable contract), re-navigating from the root so the
// dashboard figures are read from a fresh load rather than a possibly stale in-page cache.
async function openDashboard(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-root')).toBeVisible();
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await expect(page.getByTestId('dashboard-loading')).toHaveCount(0);
  await expect(page.getByTestId('dashboard-error')).toHaveCount(0);
}

test.describe('money owed counts only sent invoices, not drafts', () => {
  test('a draft is not counted as money owed; only sent invoices are', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        // Sent-but-unpaid -> money owed.
        { id: 1, projectId: 1, amount: 120, status: 'SENT' },
        { id: 2, projectId: 1, amount: 300, status: 'SENT' },
        // Still a DRAFT -> not sent yet, so NOT money owed.
        { id: 3, projectId: 1, amount: 55, status: 'DRAFT' },
        // Already PAID -> already in, so NOT money owed.
        { id: 4, projectId: 1, amount: 999, status: 'PAID' },
      ],
    });

    await openDashboard(page);

    // Owed is the SENT amounts only: 120 + 300 = 420. The draft (55) and the paid (999) are excluded.
    await expect(page.getByTestId('dashboard-outstanding-total')).toContainText('$420.00');
    // Not the total you would get if the draft were (wrongly) counted in: 420 + 55 = 475.
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('475');
    // Nor the paid amount.
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('999');
  });

  test('a draft alone is not money owed, but sending it makes it owed', async ({ page }) => {
    // One invoice, still a DRAFT. Nothing has been sent, so nothing is owed yet.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [{ id: 1, projectId: 1, amount: 250, status: 'DRAFT' }],
    });

    // Before sending: the draft is not money owed — the owed total is zero.
    await openDashboard(page);
    await expect(page.getByTestId('dashboard-outstanding-total')).toContainText('$0.00');
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('250');

    // Actually send the invoice, through the UI, on its project's detail page.
    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await page.getByTestId('invoice-send-1').click();
    await expect(page.getByTestId('invoice-row-1').getByTestId('invoice-status')).toHaveText(/^sent$/i);

    // Now that it has actually been sent, it is money owed: the owed total reflects its amount.
    await openDashboard(page);
    await expect(page.getByTestId('dashboard-outstanding-total')).toContainText('$250.00');
  });

  test('with every invoice still a draft, nothing is owed', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        { id: 1, projectId: 1, amount: 120, status: 'DRAFT' },
        { id: 2, projectId: 1, amount: 300, status: 'DRAFT' },
      ],
    });

    await openDashboard(page);

    // Drafts are not owed: the total is zero and includes neither draft amount nor their sum (420).
    await expect(page.getByTestId('dashboard-outstanding-total')).toContainText('$0.00');
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('120');
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('300');
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('420');
  });
});
