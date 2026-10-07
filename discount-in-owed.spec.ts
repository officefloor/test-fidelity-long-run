// Acceptance test for the change request:
//   "Make sure that discount shows up everywhere I check what is owed. That means the invoice, the
//    statement and the home screen."
//
// An invoice can already carry a percentage DISCOUNT, and its detail page shows the subtotal, the
// discount and the final total (see invoice-discount.spec). What this change adds is that the
// discount must now flow through into "WHAT IS OWED" — the money still to be paid — in the three
// places the app answers that question:
//
//   1. THE INVOICE — how much is still left to pay on an invoice (invoice-due-amount, shown on each
//      invoice's row in its project's invoice list). Before this change it was the invoice's GROSS
//      amount minus payments; after it, it is the DISCOUNTED total (amount minus the discount) minus
//      payments.
//   2. THE STATEMENT — each invoice row's due (statement-invoice-due) and the client's outstanding
//      total (client-outstanding-total) on the client statement. These net off the discount as well
//      as payments.
//   3. THE HOME SCREEN — the dashboard's money owed (dashboard-outstanding-total), which sums the
//      DISCOUNTED totals of the sent invoices, not their gross amounts.
//
// WHY THESE VALUES. The discount in money is subtotal × percentage, and the discounted total is the
// subtotal (the invoice's amount) minus that. "What is owed" is then that discounted total minus any
// payments. The figures below are chosen so that only a figure that has genuinely had the discount
// taken off can be right — a value that still showed the gross amount (the pre-change behaviour), or
// that took the discount off only some of the invoices, is wrong in at least one assertion:
//   - a $500 invoice at 10% is a $450 total; with $100 paid, $350 is still owed (not $400, which is
//     the gross $500 less the $100 paid; not $450, which forgets the payment; not $500, the gross);
//   - an $800 invoice at 25% is a $600 total; unpaid, $600 is owed (not the gross $800);
//   - a $400 invoice at 25% is a $300 total; unpaid, $300 is owed.
//
// Money is shown "properly" everywhere in this app — a dollar sign and two decimal places, e.g.
// $350.00 (see money-format.spec) — so the invoice and statement figures are asserted as that money
// value, matched as CONTAINMENT so a surrounding label does not break the assertion while the
// leading "$" keeps a figure from matching inside a larger number. The dashboard figure may be shown
// bare or dressed up, so it is asserted as a standalone number token (as dashboard.spec does). Every
// figure stays under a thousand, so thousands grouping never arises.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email }, `projects` honours { id, name, clientId } and an
// invoice honours { id, amount, projectId, status, discountPct }, `payments` honours
// { id, invoiceId, amount, date }. This change surfaces no audit records, so there is nothing to
// assert on the audit channel.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// A money value shown properly: a dollar sign, the whole-dollar amount, a decimal point and exactly
// two cents digits (e.g. $350.00). Matched as CONTAINMENT so a label does not break the assertion,
// while the "$" keeps the figure from matching inside a larger number ("$3,500.00"). All amounts
// below stay under a thousand, so grouping never arises.
const money = (dollars: number): RegExp => new RegExp(`\\$${dollars}\\.00`);

// A dashboard figure may be rendered bare (480) or dressed up ("$480.00"). Assert it CARRIES the
// number as a standalone token; the surrounding (^|\D)…(\D|$) keeps a smaller number from matching
// inside a larger one.
const asToken = (n: number): RegExp => new RegExp(`(^|\\D)${n}(\\D|$)`);

// --- The invoice: how much is still left to pay, shown on the invoice's row in its project list. ---

const invoiceDue = (page: Page, invoiceId: number): Locator =>
  page.getByTestId(`invoice-row-${invoiceId}`).getByTestId('invoice-due-amount');

test.describe('The discount is taken off what is still owed on an invoice', () => {
  test('the amount still to pay is the discounted total minus payments, not the gross amount', async ({
    page,
  }) => {
    // Two sent invoices on one project, each with a discount:
    //   invoice 1: $500 at 10% -> $450 total; $100 paid -> $350 still to pay.
    //   invoice 2: $800 at 25% -> $600 total; nothing paid -> $600 still to pay.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 500, projectId: 1, status: 'SENT', discountPct: 10 },
        { id: 2, amount: 800, projectId: 1, status: 'SENT', discountPct: 25 },
      ],
      payments: [{ id: 1, invoiceId: 1, amount: 100, date: '2021-03-14' }],
    });

    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    // Invoice 1: owed is the discounted total less the payment, 450 - 100 = 350.
    await expect(invoiceDue(page, 1)).toContainText(money(350));
    // NOT the gross-less-payment (500 - 100 = 400, the pre-change reading): the discount is now off.
    await expect(invoiceDue(page, 1)).not.toContainText(money(400));
    // NOT the discounted total with the payment forgotten (450), nor the gross amount (500).
    await expect(invoiceDue(page, 1)).not.toContainText(money(450));
    await expect(invoiceDue(page, 1)).not.toContainText(money(500));

    // Invoice 2: unpaid, so owed is its whole discounted total, 600 — not the gross 800.
    await expect(invoiceDue(page, 2)).toContainText(money(600));
    await expect(invoiceDue(page, 2)).not.toContainText(money(800));
  });
});

// --- The statement: each invoice's due and the client's outstanding total. ---

const statementDue = (page: Page, invoiceId: number): Locator =>
  page.getByTestId(`statement-invoice-row-${invoiceId}`).getByTestId('statement-invoice-due');

async function openStatement(page: Page, clientId: number): Promise<void> {
  await page.goto(`/clients/${clientId}`);
  await expect(page.getByTestId('client-detail-page')).toBeVisible();
  const opener = page.getByTestId('client-statement-open');
  await expect(opener).toBeVisible();
  await opener.click();
  await expect(page.getByTestId('client-statement')).toBeVisible();
  await expect(page.getByTestId('client-statement-table')).toBeVisible();
}

test.describe('The discount is taken off what a client owes on their statement', () => {
  test('each invoice row and the outstanding total net off the discount', async ({ page }) => {
    // Acme with two sent invoices across two projects, each discounted:
    //   invoice 1: $500 at 10% -> $450 total; $100 paid -> $350 due.
    //   invoice 2: $400 at 25% -> $300 total; nothing paid -> $300 due.
    // Outstanding = 350 + 300 = 650.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [
        { id: 1, name: 'Website Redesign', clientId: 1 },
        { id: 2, name: 'Mobile App', clientId: 1 },
      ],
      invoices: [
        { id: 1, amount: 500, projectId: 1, status: 'SENT', discountPct: 10 },
        { id: 2, amount: 400, projectId: 2, status: 'SENT', discountPct: 25 },
      ],
      payments: [{ id: 1, invoiceId: 1, amount: 100, date: '2021-03-14' }],
    });

    await openStatement(page, 1);

    // Per-invoice due nets off the discount: 350 (not the pre-change 400, nor the pre-payment 450).
    await expect(statementDue(page, 1)).toContainText(money(350));
    await expect(statementDue(page, 1)).not.toContainText(money(400));
    await expect(statementDue(page, 1)).not.toContainText(money(450));
    // Invoice 2 unpaid: its discounted total 300 is due, not the gross 400.
    await expect(statementDue(page, 2)).toContainText(money(300));
    await expect(statementDue(page, 2)).not.toContainText(money(400));

    const total = page.getByTestId('client-outstanding-total');
    await expect(total).toBeVisible();
    // Owed is the sum of the discounted dues: 350 + 300 = 650.
    await expect(total).toContainText(money(650));
    // Not the pre-change total with no discount netted off (400 + 400 = 800), nor the gross of both
    // amounts (500 + 400 = 900).
    await expect(total).not.toContainText(money(800));
    await expect(total).not.toContainText(money(900));
    // Nor a total where the discount was taken off only ONE invoice (350 + 400 = 750, or
    // 400 + 300 = 700): both invoices must have had it taken off.
    await expect(total).not.toContainText(money(750));
    await expect(total).not.toContainText(money(700));
  });
});

// --- The home screen (dashboard): the money still owed across all sent invoices. ---

async function openDashboard(page: Page): Promise<void> {
  await page.goto('/');
  const nav = page.getByTestId('nav-dashboard');
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
}

test.describe('The discount is taken off the money owed on the home screen', () => {
  test('the dashboard owed total sums the discounted totals of the sent invoices', async ({
    page,
  }) => {
    // Two sent invoices, each discounted, plus a draft (which is not money owed — see
    // dashboard-owed-sent.spec):
    //   invoice 1: $200 at 10% -> $180 total.
    //   invoice 2: $400 at 25% -> $300 total.
    //   invoice 3: $300 at 50% -> DRAFT, not owed at all.
    // Owed = 180 + 300 = 480.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 200, projectId: 1, status: 'SENT', discountPct: 10 },
        { id: 2, amount: 400, projectId: 1, status: 'SENT', discountPct: 25 },
        { id: 3, amount: 300, projectId: 1, status: 'DRAFT', discountPct: 50 },
      ],
    });

    await openDashboard(page);

    const owed = page.getByTestId('dashboard-outstanding-total');
    await expect(owed).toBeVisible();
    // The discounted totals of the two sent invoices: 180 + 300 = 480.
    await expect(owed).toContainText(asToken(480));
    // Not the pre-change gross sum of the sent invoices (200 + 400 = 600).
    await expect(owed).not.toContainText(asToken(600));
    // Not a sum where the discount was taken off only ONE of them (180 + 400 = 580, or
    // 200 + 300 = 500): both must be discounted.
    await expect(owed).not.toContainText(asToken(580));
    await expect(owed).not.toContainText(asToken(500));
    // And the draft is still not owed — neither its discounted total (480 + 150 = 630) nor its gross
    // (480 + 300 = 780) is swept in.
    await expect(owed).not.toContainText(asToken(630));
    await expect(owed).not.toContainText(asToken(780));
  });
});
