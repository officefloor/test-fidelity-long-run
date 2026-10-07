// Acceptance test for the change request:
//   "Let me take a percentage off an invoice as a discount. Show the subtotal, the discount and the
//    final total."
//
// An invoice can now carry a percentage DISCOUNT, and its detail page (invoice-detail-page, the child
// route /invoices/<id>) surfaces a summary (invoice-summary) of three figures:
//   - invoice-subtotal — what the invoice's line items add up to BEFORE the discount;
//   - invoice-discount — the money taken OFF, i.e. subtotal × percentage;
//   - invoice-total    — the FINAL total the client owes, i.e. subtotal MINUS the discount.
// The percentage lives on the invoice (seeded as discountPct) — the request is about SHOWING the
// three figures, and there is no anchored control to type one, so the discount is arranged through
// the seed and the test asserts the figures it produces.
//
// The three figures are genuinely DERIVED, not echoes of one another: across the scenarios below a
// value that merely repeated the subtotal, or showed a fixed/zero discount, would be wrong in at
// least one case. With a 10% discount off a $500 subtotal the discount is $50 and the total $450;
// with a 25% discount off $800 it is $200 and $600; with no discount the discount is $0.00 and the
// total equals the subtotal. The percentage is what drives the money off, so a different percentage
// produces a different discount and a different total.
//
// The request names no format, but money is shown "properly" everywhere in this app — a dollar sign
// and two decimal places, e.g. $450.00 (see money-format.spec.ts) — so subtotal, discount and total
// are each asserted as that money value. Each assertion reads only its own anchor and requires the
// correctly-computed figure as CONTAINMENT, so a surrounding label ("10% off", "−$50.00 discount")
// does not break it, while the leading "$" keeps a figure from matching as a substring of a larger
// number. All amounts stay under a thousand, so thousands grouping never arises.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email }, `projects` honours { id, name, clientId } and an
// invoice honours { id, projectId, status, discountPct, lineItems } where each line item is
// { id, description, qty, unitPrice }. This change surfaces no audit records, so there is nothing to
// assert on the audit channel.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// A money value shown properly: a dollar sign, the whole-dollar amount, a decimal point and exactly
// two cents digits (e.g. $450.00). Matched as CONTAINMENT so a label or a leading minus sign does
// not break the assertion, while the "$" keeps the figure from matching inside a larger number
// ("$4,500.00"). Amounts below stay under a thousand, so grouping never arises.
const money = (dollars: number): RegExp => new RegExp(`\\$${dollars}\\.00`);

async function gotoInvoice(page: Page, id: number): Promise<void> {
  await page.goto(`/invoices/${id}`);
  await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
  await expect(page.getByTestId('invoice-summary')).toBeVisible();
}

// Read each summary figure through its own anchor, scoped to the invoice's detail page so the match
// is this invoice's summary and nothing named the same elsewhere.
async function expectSummary(
  page: Page,
  { subtotal, discount, total }: { subtotal: number; discount: number; total: number },
): Promise<void> {
  const summary = page.getByTestId('invoice-summary');
  await expect(summary.getByTestId('invoice-subtotal')).toContainText(money(subtotal));
  await expect(summary.getByTestId('invoice-discount')).toContainText(money(discount));
  await expect(summary.getByTestId('invoice-total')).toContainText(money(total));
}

test.describe('An invoice shows its subtotal, the discount taken off, and the final total', () => {
  test('a 10% discount off a $500 subtotal takes off $50, leaving $450', async ({ page }) => {
    // Line items add up to 300 + 200 = 500 before any discount.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          discountPct: 10,
          lineItems: [
            { id: 1, description: 'Design work', qty: 2, unitPrice: 150 },
            { id: 2, description: 'Hosting setup', qty: 2, unitPrice: 100 },
          ],
        },
      ],
    });

    await gotoInvoice(page, 1);

    // Subtotal 500; 10% off is 50; final total 500 - 50 = 450. All three distinct.
    await expectSummary(page, { subtotal: 500, discount: 50, total: 450 });
  });

  test('a different percentage takes off a different amount: 25% off $800 is $200, leaving $600', async ({
    page,
  }) => {
    // Line items add up to 4 × 200 = 800 before any discount.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          discountPct: 25,
          lineItems: [{ id: 1, description: 'Consulting', qty: 4, unitPrice: 200 }],
        },
      ],
    });

    await gotoInvoice(page, 1);

    // Subtotal 800; 25% off is 200; final total 800 - 200 = 600. The discount tracks the percentage,
    // so it is 200 here, not the 50 of the 10% case above.
    await expectSummary(page, { subtotal: 800, discount: 200, total: 600 });
  });

  test('with no discount, the discount is $0.00 and the total equals the subtotal', async ({
    page,
  }) => {
    // Line items add up to 3 × 100 + 100 = 400. A zero percentage takes nothing off.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          discountPct: 0,
          lineItems: [
            { id: 1, description: 'Build', qty: 3, unitPrice: 100 },
            { id: 2, description: 'Review', qty: 1, unitPrice: 100 },
          ],
        },
      ],
    });

    await gotoInvoice(page, 1);

    // Nothing taken off: discount is money too ($0.00, not a bare 0), and the total is the full 400.
    await expectSummary(page, { subtotal: 400, discount: 0, total: 400 });
  });

  test('each invoice shows its own subtotal, discount and total, and they survive a fresh load', async ({
    page,
  }) => {
    // Two invoices with different subtotals and different percentages, so no figure coincides across
    // them: one is 500 / 10% → 50 / 450, the other is 800 / 25% → 200 / 600.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          discountPct: 10,
          lineItems: [{ id: 1, description: 'Alpha work', qty: 5, unitPrice: 100 }],
        },
        {
          id: 2,
          projectId: 1,
          status: 'DRAFT',
          discountPct: 25,
          lineItems: [{ id: 2, description: 'Beta work', qty: 4, unitPrice: 200 }],
        },
      ],
    });

    // Invoice 1: subtotal 500, 10% off → 50, total 450.
    await gotoInvoice(page, 1);
    await expectSummary(page, { subtotal: 500, discount: 50, total: 450 });

    // Invoice 2: subtotal 800, 25% off → 200, total 600 — its own figures, not invoice 1's.
    await gotoInvoice(page, 2);
    await expectSummary(page, { subtotal: 800, discount: 200, total: 600 });

    // The figures are derived from server-held data, so they are unchanged after a fresh load.
    await page.reload();
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    await expectSummary(page, { subtotal: 800, discount: 200, total: 600 });
  });
});
