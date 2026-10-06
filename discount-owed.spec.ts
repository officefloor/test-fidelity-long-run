// Acceptance tests for the change request:
//   "Make sure that discount shows up everywhere I check what is owed. That means the invoice, the
//    statement and the home screen."
//
// An invoice can already carry a PERCENTAGE discount (seed field `discountPct`, Flyway V27). Its own
// detail page already breaks the money into subtotal / discount / final total (invoice-discount.spec
// .ts, invoice-summary). But the three places that answer "how much is OWED" have been ignoring the
// discount and billing the full, undiscounted amount:
//   - the INVOICE's own amount-still-to-pay       -> invoice-due-amount
//     (how much is left on this invoice after its payments — invoice-due-amount.spec.ts)
//   - the client's STATEMENT                       -> statement-invoice-due (per row) and
//     client-outstanding-total (client-statement.spec.ts)
//   - the HOME SCREEN                              -> dashboard-outstanding-total
//     (the dashboard is the home screen — dashboard.spec.ts; the money still owed across everything)
//
// After this change, every one of those owed figures must be worked out from the DISCOUNTED total
// (the subtotal with the percentage taken off), not the full amount. "Owed" keeps its established
// meaning everywhere else: an invoice's due is its (now discounted) total minus what has been paid on
// it; the statement's total is the sum of its rows' dues; the home screen's total counts only invoices
// actually SENT (DRAFT/PAID excluded — invoice-owed-sent-only.spec.ts). This change only puts the
// discount into the money math; it does not change which invoices count.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed, which honours
// invoices { id, projectId, amount, status, discountPct } and payments { id, invoiceId, amount, date }
// (alongside clients / projects). An explicit `amount` is the invoice's subtotal (TestSupportController
// takes it as the undiscounted figure); `discountPct` is the percentage taken off it. This change adds
// NO new audit record, so nothing is asserted through the audit channel.
//
// Money values are matched the way their sibling specs match these same anchors: invoice-due-amount
// and the statement figures leniently (a leading "$" and a trailing ".00" both optional), the
// dashboard total in the app's exact money format. Amounts, percentages and payments are chosen so the
// correct (discounted) owed figure is never a substring of the WRONG (undiscounted) one a pre-change
// implementation produces, nor of any other figure on the page. This test SHOULD FAIL before the
// change: today all three owed figures ignore the discount and show the full amount.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// "$500.00", "500.00" or "500" all pass — the "$" and the ".00" cents are both optional, exactly as
// the invoice-due-amount / statement specs match these NEW money anchors.
function money(amount: number): RegExp {
  return new RegExp(`^\\$?${amount}(\\.00)?$`);
}

// The invoice's "still left to pay" (invoice-due-amount) is a cell on the invoice ROW, which renders
// in the project's invoice list (see money-format.spec.ts / invoice-cancel.spec.ts). Reach it the way
// those specs do: open the project, then read the row's own cell.
async function openProject(page: import('@playwright/test').Page, projectId: number) {
  await page.goto('/projects');
  await page.getByTestId(`project-open-${projectId}`).click();
  await expect(page.getByTestId('project-detail-page')).toBeVisible();
  await expect(page.getByTestId('project-invoices-table')).toBeVisible();
}

async function openStatement(page: import('@playwright/test').Page, clientId: number) {
  await page.goto('/clients');
  await page.getByTestId(`client-open-${clientId}`).click();
  await expect(page.getByTestId('client-detail-page')).toBeVisible();
  await page.getByTestId('client-statement-open').click();
  await expect(page.getByTestId('client-statement')).toBeVisible();
}

async function openDashboard(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-root')).toBeVisible();
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await expect(page.getByTestId('dashboard-loading')).toHaveCount(0);
  await expect(page.getByTestId('dashboard-error')).toHaveCount(0);
}

test.describe('the discount is taken off everywhere the amount owed is shown', () => {
  test('the INVOICE shows what is still owed on its DISCOUNTED total, not the full amount', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        // Subtotal 1000, 20% off => discounted total 800. 300 has been paid.
        // Owed after the discount: 800 - 300 = 500 (NOT the undiscounted 1000 - 300 = 700).
        { id: 1, projectId: 1, amount: 1000, discountPct: 20, status: 'SENT' },
      ],
      payments: [{ id: 1, invoiceId: 1, amount: 300, date: '2025-06-15' }],
    });

    await openProject(page, 1);

    // The invoice's "still left to pay" cell on its row is the DISCOUNTED total minus the payment:
    // 800 - 300 = 500.
    const due = page.getByTestId('invoice-row-1').getByTestId('invoice-due-amount');
    await expect(due).toBeVisible();
    await expect(due).toHaveText(money(500));
    // An exact-text match already excludes the undiscounted 700 and the full 1000; this spells out the
    // specific pre-change value (full amount minus paid, discount ignored) the change must move off.
    await expect(due).not.toHaveText(money(700));
  });

  test('the STATEMENT owes the DISCOUNTED total on each invoice and in the grand total', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        // Subtotal 1000, 20% off => 800 discounted; 300 paid => still owed 500.
        { id: 1, projectId: 1, amount: 1000, discountPct: 20, status: 'SENT' },
        // Subtotal 400, 25% off => 300 discounted; nothing paid => still owed 300.
        { id: 2, projectId: 1, amount: 400, discountPct: 25, status: 'SENT' },
      ],
      payments: [{ id: 1, invoiceId: 1, amount: 300, date: '2025-06-15' }],
    });

    await openStatement(page, 1);
    await expect(page.getByTestId('client-statement-table')).toBeVisible();

    // Each row's "still due" is worked out from the discounted total, net of that invoice's payments.
    // Invoice 1: 800 - 300 = 500 (not the undiscounted 700).
    await expect(page.getByTestId('statement-invoice-row-1').getByTestId('statement-invoice-due'))
      .toHaveText(money(500));
    // Invoice 2: 300 - 0 = 300 (not the undiscounted 400).
    await expect(page.getByTestId('statement-invoice-row-2').getByTestId('statement-invoice-due'))
      .toHaveText(money(300));

    // The total still owed is the sum of the discounted dues: 500 + 300 = 800.
    const total = page.getByTestId('client-outstanding-total');
    await expect(total).toBeVisible();
    await expect(total).toContainText('800');
    // Not 1100 (700 + 400, both undiscounted) — the pre-change total.
    await expect(total).not.toContainText('1100');
    // Not 1000 (the undiscounted amount of invoice 1 alone), nor 700 (its undiscounted remainder).
    await expect(total).not.toContainText('1000');
    await expect(total).not.toContainText('700');
  });

  test('the HOME SCREEN owes the sum of the DISCOUNTED totals of the sent invoices', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        // Sent-but-unpaid, discounted: 1000 -20% => 800, and 400 -25% => 300. Owed = 800 + 300 = 1100.
        { id: 1, projectId: 1, amount: 1000, discountPct: 20, status: 'SENT' },
        { id: 2, projectId: 1, amount: 400, discountPct: 25, status: 'SENT' },
        // PAID -> already in, excluded from owed regardless of its discount.
        { id: 3, projectId: 1, amount: 900, discountPct: 10, status: 'PAID' },
        // DRAFT -> not sent yet, excluded from owed regardless of its discount.
        { id: 4, projectId: 1, amount: 500, discountPct: 50, status: 'DRAFT' },
      ],
    });

    await openDashboard(page);

    // Owed = the discounted totals of the SENT invoices only: 800 + 300 = 1100, in money format.
    const total = page.getByTestId('dashboard-outstanding-total');
    await expect(total).toContainText('$1,100.00');
    // Not 1400 (1000 + 400, the undiscounted sent amounts) — the pre-change total.
    await expect(total).not.toContainText('1400');
    // The excluded invoices never leak in, discounted or not.
    await expect(total).not.toContainText('900');
    await expect(total).not.toContainText('500');
  });
});
