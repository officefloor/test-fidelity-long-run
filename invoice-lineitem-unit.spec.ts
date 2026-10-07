// Acceptance test for the change request:
//   "On the charge lines let me say how many and the unit. Show the amount for each line."
//
// A charge line (a line item on an invoice — invoice-lineitems-table, one lineitem-row-<id> each) now
// says not just HOW MANY (lineitem-qty) but in what UNIT (lineitem-unit) — "2 hours", "5 pages",
// "3 licences" — so the quantity reads as a real charge. The unit is captured on the add-a-line form
// by a new field (lineitem-form-unit) beside how-many and price-each, and it shows on the line's own
// row (lineitem-unit). Each line also shows its own AMOUNT (lineitem-amount) — how many × price each —
// so every line's charge is visible on the line itself.
//
// Rows are located by the DESCRIPTION they carry (chosen distinct per test, none a substring of
// another) and each value is read from its own cell WITHIN that row, so the test binds to the line
// being checked and not to a server-assigned id — exactly as invoice-lineitems.spec.ts does. Units in
// each test are chosen distinct, none a substring of another, so a unit assertion binds to one line.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email }, `projects` honours { id, name, clientId } and an
// invoice honours { id, projectId, status, lineItems } where each line item honours
// { id, description, qty, unit, unitPrice }. This change surfaces no audit records, so there is
// nothing to assert on the audit channel.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

const lineItemRows = (page: Page) => page.locator('[data-testid^="lineitem-row-"]');

const rowByDescription = (page: Page, description: string): Locator =>
  lineItemRows(page).filter({
    has: page.getByTestId('lineitem-description').getByText(description, { exact: true }),
  });

const invoiceTotal = (page: Page): Locator =>
  page.getByTestId('invoice-detail-page').getByTestId('invoice-amount');

// A figure may be rendered as money ($300.00) or bare (300); assert the value is PRESENT so the test
// binds to the value, not one presentation. Figures per test are chosen so none is a substring of
// another.
async function expectValue(cell: Locator, n: number): Promise<void> {
  await expect(cell).toContainText(String(n));
}

async function gotoInvoice(page: Page, id: number): Promise<void> {
  await page.goto(`/invoices/${id}`);
  await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
}

test.describe('A charge line says how many, in what unit, and shows its amount', () => {
  test('each seeded line shows how many, its unit, the price each, and its own amount', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          lineItems: [
            { id: 1, description: 'Design work', qty: 2, unit: 'hours', unitPrice: 150 }, // 300
            { id: 2, description: 'Hosting plan', qty: 5, unit: 'months', unitPrice: 80 }, // 400
          ],
        },
      ],
    });

    await gotoInvoice(page, 1);
    await expect(page.getByTestId('invoice-lineitems-table')).toBeVisible();
    await expect(lineItemRows(page)).toHaveCount(2);

    // Each line says how many, in what unit, the price each, and its own worked-out amount.
    const design = rowByDescription(page, 'Design work');
    await expect(design).toHaveCount(1);
    await expectValue(design.getByTestId('lineitem-qty'), 2);
    await expect(design.getByTestId('lineitem-unit')).toContainText('hours');
    await expectValue(design.getByTestId('lineitem-unitprice'), 150);
    await expectValue(design.getByTestId('lineitem-amount'), 300); // 2 × 150

    const hosting = rowByDescription(page, 'Hosting plan');
    await expect(hosting).toHaveCount(1);
    await expectValue(hosting.getByTestId('lineitem-qty'), 5);
    await expect(hosting.getByTestId('lineitem-unit')).toContainText('months');
    await expectValue(hosting.getByTestId('lineitem-unitprice'), 80);
    await expectValue(hosting.getByTestId('lineitem-amount'), 400); // 5 × 80

    // The total is still worked out over the line amounts: 300 + 400 = 700.
    await expectValue(invoiceTotal(page), 700);
  });

  test('each line carries its OWN unit, not a shared one', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          lineItems: [
            { id: 1, description: 'Consulting', qty: 3, unit: 'days', unitPrice: 200 },
            { id: 2, description: 'Software', qty: 4, unit: 'licences', unitPrice: 50 },
          ],
        },
      ],
    });

    await gotoInvoice(page, 1);
    await expect(lineItemRows(page)).toHaveCount(2);

    // The unit shown on a line is that line's unit — each row keeps its own.
    await expect(rowByDescription(page, 'Consulting').getByTestId('lineitem-unit')).toContainText(
      'days',
    );
    await expect(rowByDescription(page, 'Consulting').getByTestId('lineitem-unit')).not.toContainText(
      'licences',
    );
    await expect(rowByDescription(page, 'Software').getByTestId('lineitem-unit')).toContainText(
      'licences',
    );
    await expect(rowByDescription(page, 'Software').getByTestId('lineitem-unit')).not.toContainText(
      'days',
    );
  });

  test('the add form takes a unit; the new line shows it with its amount and survives a reload', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          lineItems: [
            { id: 1, description: 'Initial build', qty: 2, unit: 'days', unitPrice: 100 }, // 200
          ],
        },
      ],
    });

    await gotoInvoice(page, 1);
    await expect(lineItemRows(page)).toHaveCount(1);
    await expectValue(invoiceTotal(page), 200);

    // Say how many, in what unit, and the price each.
    await expect(page.getByTestId('lineitem-form')).toBeVisible();
    await page.getByTestId('lineitem-form-description').fill('Support retainer');
    await page.getByTestId('lineitem-form-qty').fill('6');
    await page.getByTestId('lineitem-form-unit').fill('weeks');
    await page.getByTestId('lineitem-form-unitprice').fill('90');
    await page.getByTestId('lineitem-form-submit').click();

    // The new line joins the list carrying its unit, and shows its own amount: 6 × 90 = 540.
    const added = rowByDescription(page, 'Support retainer');
    await expect(added).toHaveCount(1);
    await expectValue(added.getByTestId('lineitem-qty'), 6);
    await expect(added.getByTestId('lineitem-unit')).toContainText('weeks');
    await expectValue(added.getByTestId('lineitem-unitprice'), 90);
    await expectValue(added.getByTestId('lineitem-amount'), 540);

    await expect(lineItemRows(page)).toHaveCount(2);
    await expectValue(invoiceTotal(page), 740); // 200 + 540

    // The unit is held on the server, so it is still there after a fresh load.
    await page.reload();
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    await expect(lineItemRows(page)).toHaveCount(2);
    const reloaded = rowByDescription(page, 'Support retainer');
    await expect(reloaded).toHaveCount(1);
    await expect(reloaded.getByTestId('lineitem-unit')).toContainText('weeks');
    await expectValue(reloaded.getByTestId('lineitem-amount'), 540);
    await expect(rowByDescription(page, 'Initial build').getByTestId('lineitem-unit')).toContainText(
      'days',
    );
  });
});
