// Acceptance test for the change request:
//   "Show money properly everywhere. Use a dollar sign and cents, like $100.00."
//
// Every value the app surfaces as MONEY must be shown "properly": a leading dollar sign and the
// amount written to two decimal places of cents, exactly as the request illustrates with $100.00.
// The app surfaces money in three places, each behind a stable anchor:
//   - invoice-amount              — an invoice's amount, on a project's detail page
//   - project-invoices-total      — what a project's invoices add up to
//   - dashboard-outstanding-total — how much money is still owed, on the dashboard
// A bare number (100.00) or one missing its cents (100) is NOT "money shown properly", so each
// assertion below requires the dollar sign AND the two cents digits.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email }, `projects` honours { id, name, clientId } and
// `invoices` honours { id, amount, projectId, status }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// "Money shown properly": a dollar sign, the whole-dollar amount, a decimal point and exactly two
// cents digits — e.g. $100.00. Thousands grouping ($1,200.00) is allowed but not required, so the
// matcher does not pin one grouping style; what it does require — and what this change is about — is
// the leading "$" and the trailing ".00". The amounts seeded below all stay under a thousand, so
// grouping never actually arises. The match is anchored (^…$) so the cell carries the money value
// and nothing else.
const money = (dollars: number): RegExp => {
  const whole = Math.trunc(dollars).toLocaleString('en-US').replace(/,/g, ',?');
  return new RegExp(`^\\$${whole}\\.00$`);
};

const amountOf = (page: Page, id: number): Locator =>
  page.getByTestId(`invoice-row-${id}`).getByTestId('invoice-amount');

// Reach the dashboard the way a user would — follow its nav link from the home screen — rather than
// pinning the dashboard's URL.
async function openDashboard(page: Page): Promise<void> {
  await page.goto('/');
  const nav = page.getByTestId('nav-dashboard');
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
}

test.describe('Money is shown properly — dollar sign and cents', () => {
  test('each invoice amount on a project is shown as $amount.cc', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 100, projectId: 1, status: 'UNPAID' },
        { id: 2, amount: 250, projectId: 1, status: 'UNPAID' },
        // A paid invoice still carries an amount, and it too must be shown properly.
        { id: 3, amount: 50, projectId: 1, status: 'PAID' },
      ],
    });

    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    await expect(amountOf(page, 1)).toHaveText(money(100));
    await expect(amountOf(page, 2)).toHaveText(money(250));
    await expect(amountOf(page, 3)).toHaveText(money(50));
  });

  test("a project's invoices total is shown as $amount.cc", async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 100, projectId: 1, status: 'UNPAID' },
        { id: 2, amount: 250, projectId: 1, status: 'UNPAID' },
        { id: 3, amount: 50, projectId: 1, status: 'UNPAID' },
      ],
    });

    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    // 100 + 250 + 50 = 400, shown properly.
    await expect(page.getByTestId('project-invoices-total')).toHaveText(money(400));
  });

  test('a project with no invoices still shows its total as money: $0.00', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [],
    });

    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    // Nothing invoiced, but zero is money too — it is shown as $0.00, not a bare 0.
    await expect(page.getByTestId('project-invoices-total')).toHaveText(money(0));
  });

  test('the dashboard outstanding total is shown as $amount.cc', async ({ page }) => {
    // Two unpaid invoices (120 + 230 = 350 still owed) and one paid (400, no longer owed).
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 120, projectId: 1, status: 'UNPAID' },
        { id: 2, amount: 230, projectId: 1, status: 'UNPAID' },
        { id: 3, amount: 400, projectId: 1, status: 'PAID' },
      ],
    });

    await openDashboard(page);
    await expect(page.getByTestId('dashboard-outstanding-total')).toHaveText(money(350));
  });

  test('the dashboard shows nothing-owed as money: $0.00', async ({ page }) => {
    await resetAndSeed({ clients: [], projects: [], invoices: [] });

    await openDashboard(page);
    await expect(page.getByTestId('dashboard-outstanding-total')).toHaveText(money(0));
  });
});
