// Acceptance tests for the change request:
//   "Let me change or remove those charge lines on an invoice. Update the total when I do."
//
// An invoice is already built up from the things being charged for — line items shown on the invoice
// detail page (invoice-detail-page) in the line-items table (invoice-lineitems-table), each row
// (lineitem-row-<id>) carrying a description, how many, the price each, and the worked-out line
// amount. This change lets the user take a charge line OFF an invoice: each row gains a remove
// control (lineitem-remove-<id>). The point — "update the total when I do" — is that the invoice's
// amount is still the SUM worked out from whatever lines REMAIN, never a stored figure; so removing a
// line must drop that line's amount out of the total everywhere the total is surfaced: the detail
// page's own total (invoice-amount, in the table footer) and the all-invoices list row
// (invoice-amount).
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed, which honours invoices
// with a `lineItems` array of { id, description, qty, unitPrice }. No `amount` is seeded: the total
// must be worked out from the lines, so the removal is proven by the total CHANGING to the sum of the
// survivors. This test must FAIL before the change: there is no remove control today.
//
// The detail page is reached by navigating to its own route (/invoices/<id>) — a URL, the same public
// surface the specs already use with page.goto. Line amounts are chosen so none is a substring of
// another or of either total (300 / 100 / 200, totals 600 then 500), and every per-row/per-line
// assertion is scoped to its row so a stray match cannot pass by accident. Totals are money and
// asserted exactly ("$500.00"); the lenient lineitem cells follow the existing invoice-lineitems spec.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('charge lines can be removed from an invoice, and the total follows', () => {
  test('removing one line drops only that line, keeps the rest, and re-works the total', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          // Three things being charged for. No `amount`: the total is worked out from these.
          lineItems: [
            { id: 1, description: 'Design work', qty: 2, unitPrice: 150 }, // 2 * 150 = 300
            { id: 2, description: 'Hosting setup', qty: 4, unitPrice: 25 }, // 4 * 25  = 100
            { id: 3, description: 'Copywriting', qty: 5, unitPrice: 40 }, // 5 * 40  = 200
          ],
        },
      ],
    });

    // Before removing anything: the all-invoices list shows the full worked-out total (300+100+200).
    await page.goto('/invoices');
    await expect(page.getByTestId('invoices-page')).toBeVisible();
    await expect(page.getByTestId('invoice-row-1').getByTestId('invoice-amount')).toHaveText('$600.00');

    // Open the invoice's own detail page to see its lines.
    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    await expect(page.getByTestId('invoice-lineitems-table')).toBeVisible();

    // All three lines are present, and the detail page's own total (table footer) is the full sum.
    await expect(page.getByTestId('lineitem-row-1')).toBeVisible();
    await expect(page.getByTestId('lineitem-row-2')).toBeVisible();
    await expect(page.getByTestId('lineitem-row-3')).toBeVisible();
    const detailTotal = page.getByTestId('invoice-detail-page').getByTestId('invoice-amount');
    await expect(detailTotal).toHaveText('$600.00');

    // Take the middle line ("Hosting setup", $100) off the invoice.
    await page.getByTestId('lineitem-remove-2').click();

    // That line is gone; the other two remain exactly as they were.
    await expect(page.getByTestId('lineitem-row-2')).toHaveCount(0);
    const first = page.getByTestId('lineitem-row-1');
    await expect(first).toBeVisible();
    await expect(first.getByTestId('lineitem-description')).toHaveText('Design work');
    await expect(first.getByTestId('lineitem-amount')).toHaveText(/^\$?300(\.00)?$/);
    const third = page.getByTestId('lineitem-row-3');
    await expect(third).toBeVisible();
    await expect(third.getByTestId('lineitem-description')).toHaveText('Copywriting');
    await expect(third.getByTestId('lineitem-amount')).toHaveText(/^\$?200(\.00)?$/);

    // The total is re-worked from the survivors (300 + 200), on the detail page...
    await expect(detailTotal).toHaveText('$500.00');

    // ...and on the all-invoices list, which shows the same worked-out amount.
    await page.goto('/invoices');
    await expect(page.getByTestId('invoice-row-1').getByTestId('invoice-amount')).toHaveText('$500.00');
  });

  test('removing the last line empties the invoice and the total falls to zero', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          lineItems: [{ id: 1, description: 'Consulting', qty: 3, unitPrice: 90 }], // 3 * 90 = 270
        },
      ],
    });

    await page.goto('/invoices');
    await expect(page.getByTestId('invoice-row-1').getByTestId('invoice-amount')).toHaveText('$270.00');

    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();

    const row = page.getByTestId('lineitem-row-1');
    await expect(row).toBeVisible();
    await expect(page.getByTestId('invoice-detail-page').getByTestId('invoice-amount')).toHaveText('$270.00');

    // Remove the only charge line.
    await page.getByTestId('lineitem-remove-1').click();

    // No rows remain, but the region is still there (ready for a new line) and the total is zero.
    await expect(page.getByTestId('lineitem-row-1')).toHaveCount(0);
    await expect(page.getByTestId('lineitem-description')).toHaveCount(0);
    await expect(page.getByTestId('invoice-lineitems-table')).toBeVisible();
    await expect(page.getByTestId('invoice-detail-page').getByTestId('invoice-amount')).toHaveText('$0.00');

    // The all-invoices list reflects the now-empty invoice too.
    await page.goto('/invoices');
    await expect(page.getByTestId('invoice-row-1').getByTestId('invoice-amount')).toHaveText('$0.00');
  });
});
