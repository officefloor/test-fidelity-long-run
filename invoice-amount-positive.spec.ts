// Acceptance test for the change request:
//   "Do not let me add an invoice for nothing. The amount has to be more than zero."
//
// Adding an invoice is only allowed when the amount is strictly greater than zero. An amount of
// zero, a negative amount, or a blank amount must be rejected: the form surfaces
// `invoice-form-amount-error` and no invoice is created (the list and the total are untouched, and
// nothing is persisted across a fresh load). A positive amount still saves — covered by
// project-invoices.spec.ts and reconfirmed here once a rejected attempt is corrected.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed: `clients` honours
// { id, name, email }, `projects` honours { id, name, clientId } and `invoices` honours
// { id, amount, projectId, status }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

const invoiceRows = (page: Page) => page.locator('[data-testid^="invoice-row-"]');

// A money value may be rendered with a currency symbol, grouping or decimals ($100.00) or bare
// (100). Assert the amount it carries is PRESENT, so the test binds to the value rather than to one
// presentation.
async function expectAmount(cell: Locator, n: number): Promise<void> {
  await expect(cell).toContainText(String(n));
}

test.describe('An invoice cannot be added for zero or less', () => {
  test('submitting an amount of zero is rejected and adds nothing', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 100, projectId: 1 }],
    });

    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(invoiceRows(page)).toHaveCount(1);
    await expectAmount(page.getByTestId('project-invoices-total'), 100);

    // Zero is not "more than zero": the attempt must be rejected.
    await page.getByTestId('invoice-form-amount').fill('0');
    await page.getByTestId('invoice-form-submit').click();

    // The amount error is surfaced...
    await expect(page.getByTestId('invoice-form-amount-error')).toBeVisible();

    // ...and nothing was added: the list and total are unchanged, even after a fresh load.
    await expect(invoiceRows(page)).toHaveCount(1);
    await expectAmount(page.getByTestId('project-invoices-total'), 100);

    await page.reload();
    await expect(invoiceRows(page)).toHaveCount(1);
    await expectAmount(page.getByTestId('project-invoices-total'), 100);
  });

  test('submitting a negative amount is rejected and adds nothing', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [],
    });

    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(invoiceRows(page)).toHaveCount(0);
    await expectAmount(page.getByTestId('project-invoices-total'), 0);

    await page.getByTestId('invoice-form-amount').fill('-50');
    await page.getByTestId('invoice-form-submit').click();

    await expect(page.getByTestId('invoice-form-amount-error')).toBeVisible();

    // Still empty — the project has no invoices and the total stays at zero.
    await expect(invoiceRows(page)).toHaveCount(0);
    await expectAmount(page.getByTestId('project-invoices-total'), 0);

    await page.reload();
    await expect(invoiceRows(page)).toHaveCount(0);
    await expectAmount(page.getByTestId('project-invoices-total'), 0);
  });

  test('submitting a blank amount is rejected and adds nothing', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [],
    });

    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    // No amount typed at all is still "an invoice for nothing".
    await page.getByTestId('invoice-form-amount').fill('');
    await page.getByTestId('invoice-form-submit').click();

    await expect(page.getByTestId('invoice-form-amount-error')).toBeVisible();

    await expect(invoiceRows(page)).toHaveCount(0);
    await expectAmount(page.getByTestId('project-invoices-total'), 0);

    await page.reload();
    await expect(invoiceRows(page)).toHaveCount(0);
    await expectAmount(page.getByTestId('project-invoices-total'), 0);
  });

  test('a rejected attempt does not disturb the invoices already listed', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 100, projectId: 1 },
        { id: 2, amount: 250, projectId: 1 },
      ],
    });

    await page.goto('/projects/1');
    await expect(invoiceRows(page)).toHaveCount(2);
    await expectAmount(page.getByTestId('project-invoices-total'), 350);

    await page.getByTestId('invoice-form-amount').fill('0');
    await page.getByTestId('invoice-form-submit').click();

    await expect(page.getByTestId('invoice-form-amount-error')).toBeVisible();

    // The existing invoices are untouched and the total is unchanged.
    await expect(invoiceRows(page)).toHaveCount(2);
    await expectAmount(page.getByTestId('invoice-row-1').getByTestId('invoice-amount'), 100);
    await expectAmount(page.getByTestId('invoice-row-2').getByTestId('invoice-amount'), 250);
    await expectAmount(page.getByTestId('project-invoices-total'), 350);
  });

  test('correcting the amount to more than zero then adds the invoice', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [],
    });

    await page.goto('/projects/1');
    await expect(invoiceRows(page)).toHaveCount(0);
    await expectAmount(page.getByTestId('project-invoices-total'), 0);

    // First a rejected attempt for nothing.
    await page.getByTestId('invoice-form-amount').fill('0');
    await page.getByTestId('invoice-form-submit').click();
    await expect(page.getByTestId('invoice-form-amount-error')).toBeVisible();
    await expect(invoiceRows(page)).toHaveCount(0);

    // Correct the amount to a positive value and submit again.
    await page.getByTestId('invoice-form-amount').fill('300');
    await page.getByTestId('invoice-form-submit').click();

    // Now it saves: the invoice appears, the total reflects it, and the error is gone.
    const addedRow = invoiceRows(page).filter({
      has: page.getByTestId('invoice-amount').getByText('300', { exact: false }),
    });
    await expect(addedRow).toHaveCount(1);
    await expect(invoiceRows(page)).toHaveCount(1);
    await expectAmount(page.getByTestId('project-invoices-total'), 300);
    await expect(page.getByTestId('invoice-form-amount-error')).toHaveCount(0);

    // And it survives a fresh load from the server.
    await page.reload();
    await expect(invoiceRows(page)).toHaveCount(1);
    await expectAmount(page.getByTestId('project-invoices-total'), 300);
  });
});
