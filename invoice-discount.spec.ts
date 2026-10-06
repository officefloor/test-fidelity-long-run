// Acceptance tests for the change request:
//   "Let me take a percentage off an invoice as a discount. Show the subtotal, the discount and the
//    final total."
//
// An invoice can now have a PERCENTAGE taken off it as a discount. On the invoice's own detail page
// (invoice-detail-page, reached at /invoices/<id> — the public URL surface the other invoice specs
// already use), a summary panel (invoice-summary) breaks the money down into three figures that add
// up:
//   - invoice-subtotal — the sum of the line items, BEFORE anything is taken off;
//   - invoice-discount — how much the percentage takes OFF (subtotal * discountPct / 100);
//   - invoice-total    — the FINAL total, the subtotal MINUS the discount.
// The percentage lives on the invoice (seed field `discountPct`); the three money figures are
// DERIVED, never typed, so the breakdown always adds up.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed, which honours
// invoices with a `discountPct` and a `lineItems` array whose elements carry
// { id, description, qty, unitPrice } (alongside clients / projects). The subtotal is worked out
// from the lines (not seeded), so a stored figure cannot pass the test without the feature. This
// change introduces NO new audit record, so nothing is asserted through the audit channel.
//
// The three money anchors here are NEW — not the three the money-format spec pins exactly — so they
// are matched leniently (a leading "$" and a trailing ".00" both optional) and each is scoped to its
// own cell inside invoice-summary. Values are chosen so no figure is a substring of another
// (subtotal / discount / total are 400 / 60 / 340, then 800 / 200 / 600), so a buggy implementation
// that showed the subtotal in place of the total, or forgot to take the discount off, would fail.
// This test SHOULD FAIL before the change: there is no invoice-summary / -subtotal / -discount /
// -total today, and the invoice carries no discount.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('a percentage discount off an invoice, shown as subtotal / discount / final total', () => {
  test('takes the percentage off: subtotal of the lines, the amount discounted, and the final total', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          // 15% off the whole invoice.
          discountPct: 15,
          lineItems: [
            { id: 1, description: 'Design work', qty: 2, unitPrice: 150 }, // 2 * 150 = 300
            { id: 2, description: 'Hosting setup', qty: 2, unitPrice: 50 }, // 2 * 50  = 100
          ],
        },
      ],
    });

    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();

    const summary = page.getByTestId('invoice-summary');
    await expect(summary).toBeVisible();

    // Subtotal = sum of the lines, before anything is taken off: 300 + 100 = 400.
    await expect(summary.getByTestId('invoice-subtotal')).toContainText(/\$?400(\.00)?/);
    // The discount takes 15% of 400 = 60 off. (The cell may also show the "15%"; what is pinned is
    // the money taken off, so the subtotal / discount / total breakdown adds up.)
    await expect(summary.getByTestId('invoice-discount')).toContainText(/\$?60(\.00)?/);
    // Final total = subtotal minus the discount: 400 - 60 = 340. Not the undiscounted 400.
    await expect(summary.getByTestId('invoice-total')).toContainText(/\$?340(\.00)?/);
  });

  test('a different percentage takes a correspondingly different amount off', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          // 25% off this time — the amount discounted must track the percentage, not be a fixed figure.
          discountPct: 25,
          lineItems: [
            { id: 1, description: 'Build', qty: 2, unitPrice: 400 }, // 2 * 400 = 800
          ],
        },
      ],
    });

    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();

    const summary = page.getByTestId('invoice-summary');
    await expect(summary).toBeVisible();

    // Subtotal 800; 25% of 800 = 200 off; final total 800 - 200 = 600.
    await expect(summary.getByTestId('invoice-subtotal')).toContainText(/\$?800(\.00)?/);
    await expect(summary.getByTestId('invoice-discount')).toContainText(/\$?200(\.00)?/);
    await expect(summary.getByTestId('invoice-total')).toContainText(/\$?600(\.00)?/);
  });

  test('with no discount, nothing is taken off and the final total equals the subtotal', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          // No discountPct seeded => 0% off, the state every pre-existing invoice is in.
          lineItems: [
            { id: 1, description: 'Consulting', qty: 5, unitPrice: 55 }, // 5 * 55 = 275
          ],
        },
      ],
    });

    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();

    const summary = page.getByTestId('invoice-summary');
    await expect(summary).toBeVisible();

    // Subtotal is the sum of the lines: 5 * 55 = 275.
    await expect(summary.getByTestId('invoice-subtotal')).toContainText(/\$?275(\.00)?/);
    // Nothing taken off.
    await expect(summary.getByTestId('invoice-discount')).toContainText(/\$?0(\.00)?|0%/);
    // With no discount the final total is the whole subtotal: 275.
    await expect(summary.getByTestId('invoice-total')).toContainText(/\$?275(\.00)?/);
  });
});
