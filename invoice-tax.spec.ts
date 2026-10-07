// Acceptance test for the change request:
//   "Let me add sales tax on top. Work it out after the discount. The amount shown for each invoice
//    should include the tax."
//
// An invoice can already carry a percentage DISCOUNT, and its detail page (invoice-detail-page, the
// child route /invoices/<id>) shows a money breakdown (invoice-summary) of the subtotal, the discount
// taken off, and the total (see invoice-discount.spec). This change adds SALES TAX on top of that,
// worked out AFTER the discount, and surfaces it as a new figure in the same breakdown:
//   - invoice-tax — the tax in money, i.e. (subtotal MINUS the discount) × the tax percentage.
// The percentage lives on the invoice (seeded as taxPct, alongside the existing discountPct). "On
// top" and "after the discount" fix the order: tax is charged on what is left once the discount has
// been taken off, NOT on the gross subtotal. The invoice's TOTAL (invoice-total in the breakdown, and
// invoice-amount — the worked-out figure shown under the line items on the detail page) must now
// INCLUDE that tax: total = subtotal − discount + tax.
//
// The four figures are genuinely DERIVED, not echoes of one another, and the scenarios below are
// chosen so that only tax worked out AFTER the discount can be right. With a $500 subtotal, a 10%
// discount and 20% tax the discount is $50, the net is $450, and the tax is $90 (20% of $450) — NOT
// $100 (20% of the gross $500); the total is $540 — NOT $550 (if tax were charged on the gross), NOT
// $600 (gross plus 20%), and NOT $450 (the discounted net with the tax forgotten). With no discount
// the tax is charged on the whole subtotal; with no tax the tax figure is $0.00 and the total is just
// the discounted net, exactly as before this change.
//
// The request names no format, but money is shown "properly" everywhere in this app — a dollar sign
// and two decimal places, e.g. $540.00 (see money-format.spec.ts) — so each figure is asserted as
// that money value. Each assertion reads only its own anchor and requires the correctly-computed
// figure as CONTAINMENT, so a surrounding label ("Tax (20%)", "$90.00 tax") does not break it, while
// the leading "$" keeps a figure from matching as a substring of a larger number. All amounts stay
// under a thousand, so thousands grouping never arises.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email }, `projects` honours { id, name, clientId } and an
// invoice honours { id, projectId, status, discountPct, taxPct, lineItems } where each line item is
// { id, description, qty, unitPrice }. This change surfaces no audit records, so there is nothing to
// assert on the audit channel.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// A money value shown properly: a dollar sign, the whole-dollar amount, a decimal point and exactly
// two cents digits (e.g. $540.00). Matched as CONTAINMENT so a label or a leading minus sign does
// not break the assertion, while the "$" keeps the figure from matching inside a larger number
// ("$5,400.00"). Amounts below stay under a thousand, so grouping never arises.
const money = (dollars: number): RegExp => new RegExp(`\\$${dollars}\\.00`);

async function gotoInvoice(page: Page, id: number): Promise<void> {
  await page.goto(`/invoices/${id}`);
  await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
  await expect(page.getByTestId('invoice-summary')).toBeVisible();
}

// Read each breakdown figure through its own anchor, scoped to the invoice's summary so the match is
// this invoice's figure and nothing named the same elsewhere.
async function expectBreakdown(
  page: Page,
  { subtotal, discount, tax, total }: { subtotal: number; discount: number; tax: number; total: number },
): Promise<void> {
  const summary = page.getByTestId('invoice-summary');
  await expect(summary.getByTestId('invoice-subtotal')).toContainText(money(subtotal));
  await expect(summary.getByTestId('invoice-discount')).toContainText(money(discount));
  await expect(summary.getByTestId('invoice-tax')).toContainText(money(tax));
  await expect(summary.getByTestId('invoice-total')).toContainText(money(total));
}

// The invoice's worked-out amount shown under the line items, scoped to the detail page so the match
// is this invoice's figure. "The amount shown for each invoice should include the tax", so it tracks
// the breakdown's total (subtotal − discount + tax).
async function expectAmount(page: Page, total: number): Promise<void> {
  const amount = page.getByTestId('invoice-detail-page').getByTestId('invoice-amount');
  await expect(amount).toContainText(money(total));
}

test.describe('An invoice adds sales tax on top of the discount, and the amount includes it', () => {
  test('tax is worked out after the discount: 20% of the $450 net is $90, for a $540 total', async ({
    page,
  }) => {
    // Line items add up to 300 + 200 = 500 before any discount. 10% off is $50, leaving a $450 net;
    // 20% tax on that net is $90; the total is 450 + 90 = 540.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          discountPct: 10,
          taxPct: 20,
          lineItems: [
            { id: 1, description: 'Design work', qty: 2, unitPrice: 150 },
            { id: 2, description: 'Hosting setup', qty: 2, unitPrice: 100 },
          ],
        },
      ],
    });

    await gotoInvoice(page, 1);

    // Subtotal 500, discount 50, tax 90 (on the 450 net), total 540. All four distinct.
    await expectBreakdown(page, { subtotal: 500, discount: 50, tax: 90, total: 540 });

    // The tax is charged AFTER the discount: $90 (20% of the 450 net), NOT $100 (20% of the gross 500).
    const tax = page.getByTestId('invoice-summary').getByTestId('invoice-tax');
    await expect(tax).not.toContainText(money(100));

    // The total includes the tax and is built on the discounted net: 540, NOT 550 (if tax were charged
    // on the gross: 500 − 50 + 100), NOT 600 (gross plus 20%), NOT 450 (the net with the tax forgotten),
    // NOT 500 (the bare subtotal).
    const total = page.getByTestId('invoice-summary').getByTestId('invoice-total');
    await expect(total).not.toContainText(money(550));
    await expect(total).not.toContainText(money(600));
    await expect(total).not.toContainText(money(450));
    await expect(total).not.toContainText(money(500));

    // The amount shown under the line items includes the tax too: the 540 total, not the 450 net.
    await expectAmount(page, 540);
    await expect(
      page.getByTestId('invoice-detail-page').getByTestId('invoice-amount'),
    ).not.toContainText(money(450));
  });

  test('with no discount, the tax is charged on the whole subtotal', async ({ page }) => {
    // Line items add up to 4 × 200 = 800. No discount, so the net is the full 800; 10% tax on it is
    // $80; the total is 800 + 80 = 880.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          discountPct: 0,
          taxPct: 10,
          lineItems: [{ id: 1, description: 'Consulting', qty: 4, unitPrice: 200 }],
        },
      ],
    });

    await gotoInvoice(page, 1);

    // Subtotal 800, discount $0.00, tax 80 (10% of the full 800), total 880.
    await expectBreakdown(page, { subtotal: 800, discount: 0, tax: 80, total: 880 });
    await expectAmount(page, 880);
  });

  test('with no tax, the tax figure is $0.00 and the total is just the discounted net', async ({
    page,
  }) => {
    // Line items add up to 4 × 100 = 400. 25% off is $100, leaving a $300 net; a zero tax adds nothing,
    // so the total is the net 300 — exactly as before this change.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          discountPct: 25,
          taxPct: 0,
          lineItems: [{ id: 1, description: 'Build', qty: 4, unitPrice: 100 }],
        },
      ],
    });

    await gotoInvoice(page, 1);

    // Nothing added on top: the tax is money too ($0.00, not a bare 0), and the total is the 300 net.
    await expectBreakdown(page, { subtotal: 400, discount: 100, tax: 0, total: 300 });
    await expectAmount(page, 300);
  });

  test('each invoice shows its own tax and total, and they survive a fresh load', async ({ page }) => {
    // Two invoices with different subtotals, discounts and tax rates, so no figure coincides across
    // them:
    //   invoice 1: $500 subtotal, 10% off → $50 / $450 net, 20% tax → $90, total $540.
    //   invoice 2: $800 subtotal, 25% off → $200 / $600 net, 10% tax → $60, total $660.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          discountPct: 10,
          taxPct: 20,
          lineItems: [{ id: 1, description: 'Alpha work', qty: 5, unitPrice: 100 }],
        },
        {
          id: 2,
          projectId: 1,
          status: 'DRAFT',
          discountPct: 25,
          taxPct: 10,
          lineItems: [{ id: 2, description: 'Beta work', qty: 4, unitPrice: 200 }],
        },
      ],
    });

    // Invoice 1: subtotal 500, discount 50, tax 90 (on the 450 net), total 540.
    await gotoInvoice(page, 1);
    await expectBreakdown(page, { subtotal: 500, discount: 50, tax: 90, total: 540 });
    await expectAmount(page, 540);

    // Invoice 2: subtotal 800, discount 200, tax 60 (on the 600 net), total 660 — its own figures,
    // not invoice 1's.
    await gotoInvoice(page, 2);
    await expectBreakdown(page, { subtotal: 800, discount: 200, tax: 60, total: 660 });
    await expectAmount(page, 660);

    // The figures are derived from server-held data, so they are unchanged after a fresh load.
    await page.reload();
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    await expectBreakdown(page, { subtotal: 800, discount: 200, tax: 60, total: 660 });
    await expectAmount(page, 660);
  });
});
