// Acceptance test for the change request:
//   "For bigger amounts put commas in. Show it like $1,234.50. Do this everywhere an amount shows,
//    including on the invoices and on the client statement."
//
// Money is already shown with a dollar sign and two cents digits (money-format.spec). THIS change
// adds thousands grouping: an amount of a thousand or more is written with commas separating each
// group of three digits — $1,234.50, $2,000,000.00 — and that grouping must appear EVERYWHERE an
// amount is surfaced, with the request calling out the invoices and the client statement by name.
//
// money-format.spec deliberately keeps every seeded figure UNDER a thousand, so grouping "never
// actually arises" there and commas are tolerated-but-not-required. This spec is the complement: it
// seeds figures of a thousand and more SO THAT grouping does arise, and then REQUIRES it. Each money
// value is asserted against its exact grouped en-US rendering (which carries the comma), so an
// implementation that drops the grouping — "$2000000.00" instead of "$2,000,000.00" — fails here.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email }, `projects` honours { id, name, clientId, budget },
// `invoices` honours { id, amount, projectId, status, lineItems } and `payments` honours
// { id, invoiceId, amount, date }. This change surfaces no audit records, so there is nothing to
// assert on the audit channel.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// How a "bigger amount" must read: a dollar sign, the whole-dollar part grouped into threes by
// commas, a decimal point and exactly two cents digits — the en-US grouped form the request
// illustrates with $1,234.50. Built from the number itself so the expectation and the value can
// never drift apart; toLocaleString rounds to two fraction digits, so binary-float noise in a sum
// (e.g. 2006250.7500001) still renders the intended "$2,006,250.75".
const grouped = (dollars: number): string =>
  '$' + dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A money string that is a thousand or more MUST contain at least one comma — this is the heart of
// the change, asserted on its own so a regression to an ungrouped figure is unmistakable.
const hasGrouping = (dollars: number): void => {
  expect(grouped(dollars)).toContain(',');
};

const amountOf = (page: Page, id: number): Locator =>
  page.getByTestId(`invoice-row-${id}`).getByTestId('invoice-amount');

const statementCell = (page: Page, id: number, name: string): Locator =>
  page.getByTestId(`statement-invoice-row-${id}`).getByTestId(name);

const lineCell = (page: Page, id: number, name: string): Locator =>
  page.getByTestId(`lineitem-row-${id}`).getByTestId(name);

// Reach each surface the way a user would, via its nav link / detail route — never by pinning a URL
// the app is free to change.
async function openAllInvoices(page: Page): Promise<void> {
  await page.goto('/');
  const nav = page.getByTestId('nav-invoices');
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(page.getByTestId('invoices-page')).toBeVisible();
  await expect(page.getByTestId('all-invoices-table')).toBeVisible();
}

async function openDashboard(page: Page): Promise<void> {
  await page.goto('/');
  const nav = page.getByTestId('nav-dashboard');
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
}

async function openStatement(page: Page, clientId: number): Promise<void> {
  await page.goto(`/clients/${clientId}`);
  await expect(page.getByTestId('client-detail-page')).toBeVisible();
  const opener = page.getByTestId('client-statement-open');
  await expect(opener).toBeVisible();
  await opener.click();
  await expect(page.getByTestId('client-statement')).toBeVisible();
  await expect(page.getByTestId('client-statement-table')).toBeVisible();
}

// One client, one project (with a budget set), three SENT invoices whose amounts straddle the
// grouping boundary — $5,000.00 (one comma), $1,250.75 (one comma, with cents that are not .00) and
// $2,000,000.00 (two commas) — and one payment of $1,500.00. The figures are chosen so every
// DERIVED total also lands at a thousand or more and so must itself be grouped:
//   project invoiced / dashboard owed = 5000 + 1250.75 + 2000000       = $2,006,250.75
//   budget remaining                  = 3000000 - 2006250.75           =   $993,749.25
//   invoice 1 left to pay (due)        = 5000 - 1500                     =   $3,500.00
//   client outstanding total           = 3500 + 1250.75 + 2000000       = $2,004,750.75
async function seedBigAmounts(): Promise<void> {
  await resetAndSeed({
    clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
    projects: [{ id: 1, name: 'Website Redesign', clientId: 1, budget: 3000000 }],
    invoices: [
      { id: 1, amount: 5000, projectId: 1, status: 'SENT' },
      { id: 2, amount: 1250.75, projectId: 1, status: 'SENT' },
      { id: 3, amount: 2000000, projectId: 1, status: 'SENT' },
    ],
    payments: [{ id: 1, invoiceId: 1, amount: 1500, date: '2023-01-01' }],
  });
}

test.describe('Bigger amounts are shown with thousands separators (commas)', () => {
  test('each invoice amount on the invoices page is grouped', async ({ page }) => {
    await seedBigAmounts();
    await openAllInvoices(page);

    // The amounts the request names first — the invoices — each read with their commas.
    hasGrouping(5000);
    hasGrouping(1250.75);
    hasGrouping(2000000);
    await expect(amountOf(page, 1)).toHaveText(grouped(5000)); // $5,000.00
    await expect(amountOf(page, 2)).toHaveText(grouped(1250.75)); // $1,250.75
    await expect(amountOf(page, 3)).toHaveText(grouped(2000000)); // $2,000,000.00
  });

  test("each invoice amount and the project's invoices total are grouped on the project page", async ({
    page,
  }) => {
    await seedBigAmounts();
    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    await expect(amountOf(page, 1)).toHaveText(grouped(5000));
    await expect(amountOf(page, 2)).toHaveText(grouped(1250.75));
    await expect(amountOf(page, 3)).toHaveText(grouped(2000000));

    // The worked-out total of all three is itself a bigger amount, so it too is grouped.
    hasGrouping(2006250.75);
    await expect(page.getByTestId('project-invoices-total')).toHaveText(grouped(2006250.75));
  });

  test("the project's budget standing figures are grouped", async ({ page }) => {
    await seedBigAmounts();
    await page.goto('/projects/1');
    await expect(page.getByTestId('project-budget-panel')).toBeVisible();

    hasGrouping(3000000);
    hasGrouping(993749.25);
    await expect(page.getByTestId('project-budget')).toHaveText(grouped(3000000)); // $3,000,000.00
    await expect(page.getByTestId('project-invoiced')).toHaveText(grouped(2006250.75));
    await expect(page.getByTestId('project-remaining')).toHaveText(grouped(993749.25)); // $993,749.25
  });

  test('the dashboard per-currency outstanding total is grouped', async ({ page }) => {
    await seedBigAmounts();
    await openDashboard(page);

    // The client carries no currency, so what is owed is shown in the default, USD, under
    // dashboard-outstanding-USD — and that bigger figure is grouped with commas. (A per-currency
    // total may carry a currency label, so this is a containment check.)
    hasGrouping(2006250.75);
    await expect(page.getByTestId('dashboard-outstanding-USD')).toContainText(grouped(2006250.75));
  });

  test('a recorded payment is grouped on the invoice', async ({ page }) => {
    await seedBigAmounts();
    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();

    hasGrouping(1500);
    await expect(
      page.getByTestId('payment-row-1').getByTestId('payment-amount'),
    ).toHaveText(grouped(1500)); // $1,500.00
  });

  test('the client statement groups every amount, paid, due and the outstanding total', async ({
    page,
  }) => {
    await seedBigAmounts();
    await openStatement(page, 1);

    // The second surface the request names — the statement — one row per invoice, each figure grouped.
    await expect(statementCell(page, 1, 'statement-invoice-amount')).toHaveText(grouped(5000));
    await expect(statementCell(page, 2, 'statement-invoice-amount')).toHaveText(grouped(1250.75));
    await expect(statementCell(page, 3, 'statement-invoice-amount')).toHaveText(grouped(2000000));

    // Paid and still-due on the part-paid invoice are both bigger amounts, so both are grouped.
    hasGrouping(3500);
    await expect(statementCell(page, 1, 'statement-invoice-paid')).toHaveText(grouped(1500));
    await expect(statementCell(page, 1, 'statement-invoice-due')).toHaveText(grouped(3500));
    await expect(statementCell(page, 2, 'statement-invoice-due')).toHaveText(grouped(1250.75));
    await expect(statementCell(page, 3, 'statement-invoice-due')).toHaveText(grouped(2000000));

    // And the total the client still owes, summed across the rows, is grouped.
    hasGrouping(2004750.75);
    await expect(page.getByTestId('client-outstanding-total')).toHaveText(grouped(2004750.75));
  });

  test('invoice line items and their worked-out total are grouped', async ({ page }) => {
    // An invoice built from line items: a big unit price ($1,234.50) taken 1000 times is a
    // $1,234,500.00 line, plus a $10,000.50 line, totalling $1,244,500.50 — every figure a bigger
    // amount, so every one must be grouped (unit price, line amount and the invoice total alike).
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        {
          id: 1,
          projectId: 1,
          status: 'DRAFT',
          lineItems: [
            { id: 1, description: 'Design', qty: 1000, unitPrice: 1234.5 },
            { id: 2, description: 'Hosting', qty: 2, unitPrice: 5000.25 },
          ],
        },
      ],
    });

    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    await expect(page.getByTestId('invoice-lineitems-table')).toBeVisible();

    hasGrouping(1234.5);
    hasGrouping(1234500);
    hasGrouping(10000.5);
    hasGrouping(1244500.5);

    await expect(lineCell(page, 1, 'lineitem-unitprice')).toHaveText(grouped(1234.5)); // $1,234.50
    await expect(lineCell(page, 1, 'lineitem-amount')).toHaveText(grouped(1234500)); // $1,234,500.00
    await expect(lineCell(page, 2, 'lineitem-unitprice')).toHaveText(grouped(5000.25)); // $5,000.25
    await expect(lineCell(page, 2, 'lineitem-amount')).toHaveText(grouped(10000.5)); // $10,000.50

    // The invoice amount is the worked-out sum of its lines, itself a bigger amount — grouped.
    await expect(page.getByTestId('invoice-amount')).toHaveText(grouped(1244500.5)); // $1,244,500.50
  });
});
