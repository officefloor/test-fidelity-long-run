// Acceptance tests for the change request:
//   "[...] On the home screen keep the totals separate for each currency. Show each client's figure
//    in their own currency in the top clients list too. Do not add different currencies together."
//
// The home screen is the dashboard (dashboard.spec.ts: reached via nav-dashboard, renders
// dashboard-page). Now that each client has a currency (client-currency.spec.ts), the outstanding
// money I am still owed is kept SEPARATE per currency: there is one total PER currency, each under
// its own anchor dashboard-outstanding-<currency> — e.g. dashboard-outstanding-USD for the dollars,
// dashboard-outstanding-EUR for the euros — and each shows ONLY that currency's owed sum, rendered
// in that currency. Different currencies are NEVER added into one figure: no element on the
// dashboard shows a mixed-currency grand total.
//
// The same holds for the top-clients panel (dashboard-top-clients.spec.ts): each listed client's
// owed figure (top-client-amount) is shown in THAT client's own currency.
//
// "Owed" carries the app's established meaning (dashboard.spec.ts / client-statement.spec.ts): the
// sum of each SENT-but-unpaid invoice's remaining balance. Here every owing invoice is SENT with
// nothing paid, so owed = the invoice amount — this spec is about keeping currencies apart, not
// re-deriving owed (covered elsewhere).
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed, which honours a
// client's `currency`. The app formats money with Intl.NumberFormat (ui/money.ts), so each
// currency's money reads with its own symbol (€, £) in place of the dollar sign; money is therefore
// asserted robustly — amount digits present, the right currency's marker (symbol OR ISO code)
// present, no other currency's marker leaking in. Per-currency sums and every cross-currency sum are
// chosen distinct so a figure that wrongly added currencies together is a value that must NOT appear.
// This SHOULD FAIL before the change: there are no per-currency totals today, and every figure reads
// in dollars.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

const CURRENCIES: Record<string, { marker: RegExp; symbol: string }> = {
  USD: { marker: /\$|USD/, symbol: '$' },
  EUR: { marker: /€|EUR/, symbol: '€' },
  GBP: { marker: /£|GBP/, symbol: '£' },
};

async function expectMoney(locator: Locator, amount: number, code: keyof typeof CURRENCIES) {
  await expect(locator).toContainText(amount.toFixed(2));
  await expect(locator).toContainText(CURRENCIES[code].marker);
  for (const [other, m] of Object.entries(CURRENCIES)) {
    if (other === code) continue;
    await expect(locator).not.toContainText(m.symbol);
    await expect(locator).not.toContainText(other);
  }
}

async function openDashboard(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-root')).toBeVisible();
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await expect(page.getByTestId('dashboard-loading')).toHaveCount(0);
  await expect(page.getByTestId('dashboard-error')).toHaveCount(0);
}

test.describe('home screen keeps outstanding totals separate for each currency', () => {
  test('shows one total per currency, each in its own currency, never added together', async ({ page }) => {
    await resetAndSeed({
      clients: [
        // Two dollar clients -> USD owed = 120 + 300 = 420.
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example', currency: 'USD' },
        { id: 2, name: 'Beta Ltd', email: 'hi@beta.example', currency: 'USD' },
        // Two euro clients -> EUR owed = 250 + 200 = 450.
        { id: 3, name: 'Gamma GmbH', email: 'hallo@gamma.example', currency: 'EUR' },
        { id: 4, name: 'Delta SA', email: 'bonjour@delta.example', currency: 'EUR' },
        // One pound client -> GBP owed = 600.
        { id: 5, name: 'Epsilon plc', email: 'hello@epsilon.example', currency: 'GBP' },
      ],
      projects: [
        { id: 1, clientId: 1, name: 'Acme site' },
        { id: 2, clientId: 2, name: 'Beta site' },
        { id: 3, clientId: 3, name: 'Gamma site' },
        { id: 4, clientId: 4, name: 'Delta site' },
        { id: 5, clientId: 5, name: 'Epsilon site' },
      ],
      invoices: [
        { id: 1, projectId: 1, amount: 120, status: 'SENT' },
        { id: 2, projectId: 2, amount: 300, status: 'SENT' },
        { id: 3, projectId: 3, amount: 250, status: 'SENT' },
        { id: 4, projectId: 4, amount: 200, status: 'SENT' },
        { id: 5, projectId: 5, amount: 600, status: 'SENT' },
      ],
    });

    await openDashboard(page);

    // One total per currency, each the sum of ONLY that currency's owed invoices, in that currency.
    await expectMoney(page.getByTestId('dashboard-outstanding-USD'), 420, 'USD');
    await expectMoney(page.getByTestId('dashboard-outstanding-EUR'), 450, 'EUR');
    await expectMoney(page.getByTestId('dashboard-outstanding-GBP'), 600, 'GBP');

    // Different currencies are NEVER added together: no cross-currency sum appears anywhere on the
    // dashboard — not any pair, and not the grand total of all three.
    const dashboard = page.getByTestId('dashboard');
    for (const bad of [
      '870', // 420 + 450
      '1020', '1,020', // 420 + 600
      '1050', '1,050', // 450 + 600
      '1470', '1,470', // 420 + 450 + 600
    ]) {
      await expect(dashboard).not.toContainText(bad);
    }
  });

  test("the top-clients panel shows each client's owed figure in their own currency", async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example', currency: 'USD' },
        { id: 2, name: 'Gamma GmbH', email: 'hallo@gamma.example', currency: 'EUR' },
        { id: 3, name: 'Epsilon plc', email: 'hello@epsilon.example', currency: 'GBP' },
      ],
      projects: [
        { id: 1, clientId: 1, name: 'Acme site' },
        { id: 2, clientId: 2, name: 'Gamma site' },
        { id: 3, clientId: 3, name: 'Epsilon site' },
      ],
      invoices: [
        { id: 1, projectId: 1, amount: 500, status: 'SENT' }, // Acme owes 500, in dollars
        { id: 2, projectId: 2, amount: 400, status: 'SENT' }, // Gamma owes 400, in euros
        { id: 3, projectId: 3, amount: 300, status: 'SENT' }, // Epsilon owes 300, in pounds
      ],
    });

    await openDashboard(page);

    const panel = page.getByTestId('dashboard-top-clients');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('dashboard-top-clients-loading')).toHaveCount(0);
    await expect(panel.getByTestId('dashboard-top-clients-error')).toHaveCount(0);

    // Each client's figure is shown in that client's own currency (located by client id, so the
    // cross-currency ranking order is not what is under test here).
    await expectMoney(page.getByTestId('top-client-row-1').getByTestId('top-client-amount'), 500, 'USD');
    await expectMoney(page.getByTestId('top-client-row-2').getByTestId('top-client-amount'), 400, 'EUR');
    await expectMoney(page.getByTestId('top-client-row-3').getByTestId('top-client-amount'), 300, 'GBP');
  });
});
