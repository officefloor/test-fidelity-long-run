// Acceptance tests for the change request:
//   "On the charge lines let me say how many and the unit. Show the amount for each line."
//
// A charge line (line item) on an invoice already names the thing being charged for (description),
// HOW MANY (lineitem-qty), the price of each (lineitem-unitprice) and the worked-out line amount
// (lineitem-amount = qty * unit price). This change lets the user also say WHAT UNIT the "how many"
// is counted in — hours, licenses, days — surfaced per row as lineitem-unit, and entered when adding
// a line through a new form field (lineitem-form-unit) beside the existing qty field. The amount for
// each line is still shown (lineitem-amount), unchanged by the unit, which is a label on the count
// and does not enter the arithmetic.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed, which honours invoices
// with a `lineItems` array whose elements carry { id, description, qty, unitPrice, unit }. No `amount`
// is seeded: the line amount is worked out from qty * unitPrice (the unit does not affect it). This
// test must FAIL before the change — line items carry no unit today, so there is no lineitem-unit cell
// and the form has no lineitem-form-unit field.
//
// The detail page is reached at its own route (/invoices/<id>), the public surface the line-item specs
// already use. Units are distinct words ("hours" / "licenses") so neither is a substring of the other;
// qty, unit price and amount are chosen so no value is a substring of another (2 / 5, 150 / 20,
// 300 / 100), and every cell is scoped to its row so a stray match cannot pass by accident. Amounts
// follow the existing lineitem specs' lenient money matching ($ and trailing .00 optional).
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('charge lines carry a unit for the quantity, and still show each line amount', () => {
  test('seeded lines show how many, in what unit, and the worked-out amount for each', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          // Each charge line says how many, in what unit. No `amount`: it is worked out from the line.
          lineItems: [
            { id: 1, description: 'Design work', qty: 2, unit: 'hours', unitPrice: 150 }, // 2 * 150 = 300
            { id: 2, description: 'Software', qty: 5, unit: 'licenses', unitPrice: 20 }, //  5 * 20  = 100
          ],
        },
      ],
    });

    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    await expect(page.getByTestId('invoice-lineitems-table')).toBeVisible();

    // First line: 2 HOURS of design work at $150 each, worked out to $300.
    const first = page.getByTestId('lineitem-row-1');
    await expect(first).toBeVisible();
    await expect(first.getByTestId('lineitem-description')).toHaveText('Design work');
    await expect(first.getByTestId('lineitem-qty')).toHaveText(/^2(\.0+)?$/);
    await expect(first.getByTestId('lineitem-unit')).toHaveText('hours');
    await expect(first.getByTestId('lineitem-amount')).toHaveText(/^\$?300(\.00)?$/);

    // Second line: 5 LICENSES of software at $20 each, worked out to $100.
    const second = page.getByTestId('lineitem-row-2');
    await expect(second).toBeVisible();
    await expect(second.getByTestId('lineitem-description')).toHaveText('Software');
    await expect(second.getByTestId('lineitem-qty')).toHaveText(/^5(\.0+)?$/);
    await expect(second.getByTestId('lineitem-unit')).toHaveText('licenses');
    await expect(second.getByTestId('lineitem-amount')).toHaveText(/^\$?100(\.00)?$/);
  });

  test('adding a line captures its unit; the row shows the unit and the worked-out amount', async ({ page }) => {
    // Empty invoice: RESTART IDENTITY on reset + empty lineItems means the first line added is id 1.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [{ id: 1, projectId: 1, status: 'DRAFT', lineItems: [] }],
    });

    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    await expect(page.getByTestId('lineitem-form')).toBeVisible();
    await expect(page.getByTestId('lineitem-unit')).toHaveCount(0);

    // Charge for 3 DAYS of consulting at $90 each.
    await page.getByTestId('lineitem-form-description').fill('Consulting');
    await page.getByTestId('lineitem-form-qty').fill('3');
    await page.getByTestId('lineitem-form-unit').fill('days');
    await page.getByTestId('lineitem-form-unitprice').fill('90');
    await page.getByTestId('lineitem-form-submit').click();

    // The line appears with its unit alongside the count, and the amount worked out for the user.
    const row = page.getByTestId('lineitem-row-1');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('lineitem-description')).toHaveText('Consulting');
    await expect(row.getByTestId('lineitem-qty')).toHaveText(/^3(\.0+)?$/);
    await expect(row.getByTestId('lineitem-unit')).toHaveText('days');
    await expect(row.getByTestId('lineitem-amount')).toHaveText(/^\$?270(\.00)?$/);
    await expect(page.getByTestId('lineitem-form-error')).toHaveCount(0);
  });
});
