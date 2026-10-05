// Acceptance tests for the change request:
//   "I want a home screen. Show me how many clients and projects I have. Show me how much money I
//    am still owed."
//
// A new dashboard screen, reached from the nav (nav-dashboard), surfaces three figures:
//   - how many CLIENTS there are              -> dashboard-clients-count
//   - how many PROJECTS there are             -> dashboard-projects-count
//   - how much money is STILL OWED            -> dashboard-outstanding-total
// "Still owed" is the sum of the amounts for invoices I have actually SENT but not yet been paid for.
// Invoices move through stages DRAFT -> SENT -> PAID (see invoice-send.spec.ts): a SENT invoice has
// gone out but not been paid, so it is money still owed; a PAID invoice is already in, and a DRAFT
// has not gone out yet — neither counts (see invoice-owed-sent-only.spec.ts for the draft rule).
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed. Seed honours
// clients: { id, name, email }, projects: { id, clientId, name } and invoices: { id, projectId,
// amount, status }.
//
// Counts are whole numbers asserted with toContainText so a label ("2 clients") still passes; the
// figures are chosen distinct so none is a substring of another. The outstanding total is MONEY, so
// it is asserted in the app's money format — a dollar sign and two decimals, "$475.00" — per the
// "show money properly everywhere" change (see money-format.spec.ts). Amounts are picked so the owed
// total is not a substring of any other figure on the page.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// Reach the dashboard through its nav link rather than assuming its URL — the nav entry is the
// stable contract (nav-dashboard), the concrete path is the feature's own choice.
async function openDashboard(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-root')).toBeVisible();
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
}

test.describe('dashboard home screen', () => {
  test('reaches the dashboard from the nav', async ({ page }) => {
    await resetAndSeed({ clients: [], projects: [], invoices: [] });

    await page.goto('/');
    await expect(page.getByTestId('app-root')).toBeVisible();

    await page.getByTestId('nav-dashboard').click();

    await expect(page.getByTestId('dashboard-page')).toBeVisible();
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });

  test('shows how many clients and projects there are, and how much is still owed', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example' },
        { id: 2, name: 'Globex', email: 'hello@globex.example' },
      ],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign' },
        { id: 2, clientId: 1, name: 'Mobile app' },
        { id: 3, clientId: 2, name: 'Warehouse automation' },
      ],
      invoices: [
        // Sent-but-unpaid invoices across several projects -> still owed = 120 + 300 + 55 = 475.
        { id: 1, projectId: 1, amount: 120, status: 'SENT' },
        { id: 2, projectId: 1, amount: 300, status: 'SENT' },
        { id: 3, projectId: 3, amount: 55, status: 'SENT' },
        // Already PAID -> not owed, must NOT be counted into the outstanding total.
        { id: 4, projectId: 2, amount: 999, status: 'PAID' },
        // Still a DRAFT -> not sent yet, so not owed either; must NOT be counted.
        { id: 5, projectId: 2, amount: 777, status: 'DRAFT' },
      ],
    });

    await openDashboard(page);

    // The data has loaded: neither the loading nor the error state remains.
    await expect(page.getByTestId('dashboard-loading')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-error')).toHaveCount(0);

    // Two clients, three projects.
    await expect(page.getByTestId('dashboard-clients-count')).toContainText('2');
    await expect(page.getByTestId('dashboard-projects-count')).toContainText('3');

    // Still owed is the sum of the SENT amounts only (475) — not the paid 999, and not the draft 777
    // (a draft has not been sent, so it is not owed) — shown as money, with a dollar sign and cents.
    await expect(page.getByTestId('dashboard-outstanding-total')).toContainText('$475.00');
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('999');
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('777');
  });

  test('a paid invoice is not money still owed', async ({ page }) => {
    // Every invoice is PAID, so nothing is owed even though invoices exist.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        { id: 1, projectId: 1, amount: 120, status: 'PAID' },
        { id: 2, projectId: 1, amount: 300, status: 'PAID' },
      ],
    });

    await openDashboard(page);

    await expect(page.getByTestId('dashboard-clients-count')).toContainText('1');
    await expect(page.getByTestId('dashboard-projects-count')).toContainText('1');

    // Nothing is owed: the total reflects 0 and does not include any paid amount — shown as money.
    await expect(page.getByTestId('dashboard-outstanding-total')).toContainText('$0.00');
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('120');
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('300');
    await expect(page.getByTestId('dashboard-outstanding-total')).not.toContainText('420');
  });

  test('with no data at all the figures are zero', async ({ page }) => {
    await resetAndSeed({ clients: [], projects: [], invoices: [] });

    await openDashboard(page);

    await expect(page.getByTestId('dashboard-error')).toHaveCount(0);

    await expect(page.getByTestId('dashboard-clients-count')).toContainText('0');
    await expect(page.getByTestId('dashboard-projects-count')).toContainText('0');
    await expect(page.getByTestId('dashboard-outstanding-total')).toContainText('$0.00');
  });
});
