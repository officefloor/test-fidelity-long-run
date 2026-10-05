// Acceptance tests for the change request:
//   "I do not want to type one figure for an invoice. Let me list the things I am charging for.
//    For each one give a description, how many, and the price each. Work out the total for me."
//
// An invoice is now built up from the THINGS being charged for — line items. Opening an invoice
// (invoice-open-<id> from the all-invoices list, the same list-page drill-in convention as
// project-open / client-open) reaches that invoice's own detail page (invoice-detail-page). The
// detail page lists the line items in a table (invoice-lineitems-table); each row
// (lineitem-row-<id>) names the thing being charged for (lineitem-description), HOW MANY
// (lineitem-qty), the PRICE EACH (lineitem-unitprice) and the worked-out line amount
// (lineitem-amount = qty * unitprice). A form (lineitem-form) adds a new line item from those three
// fields (lineitem-form-description / -qty / -unitprice, submitted with lineitem-form-submit),
// rejecting an incomplete one with lineitem-form-error. The whole point — "work out the total for
// me" — is that the invoice's amount is the SUM of its line amounts, never a figure the user types;
// it is surfaced through the existing invoice-amount anchor on the all-invoices list.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed, which honours
// invoices with a `lineItems` array whose elements carry { id, description, qty, unitPrice }.
// No `amount` is seeded on a line-item invoice: the total must be WORKED OUT from the lines, so
// seeding it would let a stored figure pass the test without the feature. (That is also why these
// tests must FAIL before the change: the pre-change seed has no line-item support and there is no
// invoice detail page.)
//
// Line amounts and unit prices are money; the three money-format anchors from money-format.spec are
// invoice-amount / project-invoices-total / dashboard-outstanding-total, so the invoice total is
// asserted exactly ("$400.00"), while the NEW lineitem-amount / lineitem-unitprice cells are matched
// leniently ($ and trailing .00 optional) since their exact presentation is not what this change
// pins. Quantities are whole counts. Values are chosen so no line amount is a substring of the total
// or of another line (300 / 100 / 400), and each cell is scoped to its row so a stray match cannot
// pass by accident.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('an invoice is a list of things being charged for, with the total worked out', () => {
  test('opening an invoice lists each thing — description, how many, price each — with the total worked out', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          // The things being charged for. No `amount` on the invoice: it is worked out from these.
          lineItems: [
            { id: 1, description: 'Design work', qty: 2, unitPrice: 150 }, // 2 * 150 = 300
            { id: 2, description: 'Hosting setup', qty: 4, unitPrice: 25 }, // 4 * 25  = 100
          ],
        },
      ],
    });

    // The invoice's amount, surfaced on the all-invoices list, is the SUM of its lines (300 + 100),
    // worked out for the user — not a single figure they typed.
    await page.goto('/invoices');
    await expect(page.getByTestId('invoices-page')).toBeVisible();
    const listRow = page.getByTestId('invoice-row-1');
    await expect(listRow).toBeVisible();
    await expect(listRow.getByTestId('invoice-amount')).toHaveText('$400.00');

    // Drill into the invoice to see what it is made of — a child route, reached via its open control.
    await listRow.getByTestId('invoice-open-1').click();

    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    await expect(page.getByTestId('invoice-lineitems-table')).toBeVisible();

    // First thing: "Design work", 2 @ $150.00 each, worked out to $300.00.
    const first = page.getByTestId('lineitem-row-1');
    await expect(first).toBeVisible();
    await expect(first.getByTestId('lineitem-description')).toHaveText('Design work');
    await expect(first.getByTestId('lineitem-qty')).toHaveText(/^2(\.0+)?$/);
    await expect(first.getByTestId('lineitem-unitprice')).toHaveText(/^\$?150(\.00)?$/);
    await expect(first.getByTestId('lineitem-amount')).toHaveText(/^\$?300(\.00)?$/);

    // Second thing: "Hosting setup", 4 @ $25.00 each, worked out to $100.00.
    const second = page.getByTestId('lineitem-row-2');
    await expect(second).toBeVisible();
    await expect(second.getByTestId('lineitem-description')).toHaveText('Hosting setup');
    await expect(second.getByTestId('lineitem-qty')).toHaveText(/^4(\.0+)?$/);
    await expect(second.getByTestId('lineitem-unitprice')).toHaveText(/^\$?25(\.00)?$/);
    await expect(second.getByTestId('lineitem-amount')).toHaveText(/^\$?100(\.00)?$/);
  });

  test('adds a thing through the form; it appears with its worked-out amount and lifts the total', async ({ page }) => {
    // An invoice with nothing on it yet. RESTART IDENTITY on reset + an empty lineItems array means
    // the first line item added through the UI is id 1.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [{ id: 1, projectId: 1, status: 'DRAFT', lineItems: [] }],
    });

    // Nothing charged for yet, so the worked-out total is zero.
    await page.goto('/invoices');
    await expect(page.getByTestId('invoice-row-1').getByTestId('invoice-amount')).toHaveText('$0.00');

    await page.getByTestId('invoice-row-1').getByTestId('invoice-open-1').click();
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    await expect(page.getByTestId('lineitem-form')).toBeVisible();
    // No line items seeded, so no rows yet.
    await expect(page.getByTestId('lineitem-description')).toHaveCount(0);

    // List one thing being charged for: 3 @ $90.00 each.
    await page.getByTestId('lineitem-form-description').fill('Consulting');
    await page.getByTestId('lineitem-form-qty').fill('3');
    await page.getByTestId('lineitem-form-unitprice').fill('90');
    await page.getByTestId('lineitem-form-submit').click();

    // It appears as a row, its amount worked out for the user (3 * 90 = 270).
    const row = page.getByTestId('lineitem-row-1');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('lineitem-description')).toHaveText('Consulting');
    await expect(row.getByTestId('lineitem-qty')).toHaveText(/^3(\.0+)?$/);
    await expect(row.getByTestId('lineitem-unitprice')).toHaveText(/^\$?90(\.00)?$/);
    await expect(row.getByTestId('lineitem-amount')).toHaveText(/^\$?270(\.00)?$/);
    // A valid add is not an error.
    await expect(page.getByTestId('lineitem-form-error')).toHaveCount(0);

    // Back on the list, the invoice total now reflects the thing just added — worked out, not typed.
    await page.goto('/invoices');
    await expect(page.getByTestId('invoice-row-1').getByTestId('invoice-amount')).toHaveText('$270.00');
  });

  test('refuses an incomplete line item, surfacing an error and adding nothing', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [{ id: 1, projectId: 1, status: 'DRAFT', lineItems: [] }],
    });

    await page.goto('/invoices');
    await page.getByTestId('invoice-row-1').getByTestId('invoice-open-1').click();

    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    await expect(page.getByTestId('lineitem-form')).toBeVisible();
    // No error before the user tries anything.
    await expect(page.getByTestId('lineitem-form-error')).toHaveCount(0);

    // Submitting an empty form (no description, no quantity, no price) cannot describe a thing to
    // charge for: it is rejected and nothing is created.
    await page.getByTestId('lineitem-form-submit').click();

    await expect(page.getByTestId('lineitem-form-error')).toBeVisible();
    await expect(page.getByTestId('lineitem-row-1')).toHaveCount(0);
    await expect(page.getByTestId('lineitem-amount')).toHaveCount(0);

    // A complete line item is then accepted, clearing the error and appearing as the first row (id 1).
    await page.getByTestId('lineitem-form-description').fill('Consulting');
    await page.getByTestId('lineitem-form-qty').fill('3');
    await page.getByTestId('lineitem-form-unitprice').fill('90');
    await page.getByTestId('lineitem-form-submit').click();

    const row = page.getByTestId('lineitem-row-1');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('lineitem-amount')).toHaveText(/^\$?270(\.00)?$/);
    await expect(page.getByTestId('lineitem-form-error')).toHaveCount(0);
  });
});
