// Acceptance test for the change request:
//   "Different clients pay me in different currencies. Let me set each client's currency. Show
//    their money in that currency everywhere I see it, including on their statement. On the home
//    screen keep the totals separate for each currency. Show each client's figure in their own
//    currency in the top clients list too. Do not add different currencies together."
//
// A client now has a CURRENCY, chosen per client. The client's detail page gains a panel
// (client-currency-panel) that shows the current currency (client-currency), offers a chooser
// (client-currency-select) and a save control (client-currency-save). Saving a new currency:
//   * updates what the detail page shows (client-currency),
//   * is held by the SERVER (it survives a fresh load),
//   * keeps exactly one audit record `CLIENT_CURRENCY_SET id=<id> currency=<currency>`.
// Once set, the client's money is shown IN THAT CURRENCY everywhere it surfaces — the request calls
// out the client's statement by name (every amount, paid, due and the outstanding total). On the
// home screen the money still owed is kept SEPARATE PER CURRENCY (dashboard-outstanding-<currency>,
// one total per currency), and each client's figure in the top-clients list is shown in that
// client's own currency. Different currencies are never ADDED TOGETHER.
//
// HOW CURRENCY IS SHOWN. The app already shows money with its currency's symbol — "$100.00" is USD
// shown with the dollar sign (money-format.spec), produced by Intl currency formatting. Generalised
// to other currencies that is "€100.00" for EUR, "£100.00" for GBP: the same figure, the currency's
// own symbol. Each money assertion below is built with that same Intl formatter so the expectation
// and the app's rendering cannot drift, and is paired with a check that the WRONG currency's symbol
// is absent — that is what proves the money is shown in the client's own currency, not another's.
// USD is the default a client carries when no currency has been chosen (seeding no `currency`), which
// is why the rest of the suite — seeding clients without a currency — keeps its "$" figures.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed (the app's /__test__ endpoint): `clients` honours
// { id, name, email, currency }, `projects` honours { id, name, clientId }, `invoices` honours
// { id, amount, projectId, status } and `payments` honours { id, invoiceId, amount, date }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

// A figure shown in a given currency, rendered exactly as the app's shared money formatter would
// (Intl currency, en-US): inCur(300, 'USD') === "$300.00", inCur(500, 'EUR') === "€500.00",
// inCur(500, 'GBP') === "£500.00". Building the string from the number keeps the expectation and the
// value in lockstep.
const inCur = (amount: number, currency: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

// The audit record for one currency change — carries the client's id and the chosen currency,
// matched exactly as the contract writes it.
const currencyRecord = (id: number, currency: string): string =>
  `CLIENT_CURRENCY_SET id=${id} currency=${currency}`;

const statementCell = (page: Page, id: number, name: string): Locator =>
  page.getByTestId(`statement-invoice-row-${id}`).getByTestId(name);

const topRow = (page: Page, clientId: number): Locator =>
  page.getByTestId(`top-client-row-${clientId}`);
const topAmount = (page: Page, clientId: number): Locator =>
  topRow(page, clientId).getByTestId('top-client-amount');

// The per-currency outstanding totals on the dashboard, addressed as a family by their shared prefix
// so "how many are there" and "there are none" can both be asserted.
const outstandingTotals = (page: Page): Locator =>
  page.locator('[data-testid^="dashboard-outstanding-"]');

// Choose a currency on the client-currency-select by the MEANING of its options, not a presentation
// detail: pick the option whose value OR visible text carries the currency code, then select it. This
// tolerates a label like "EUR — Euro" while still binding to the code the contract is keyed on.
async function selectCurrency(page: Page, code: string): Promise<void> {
  const select = page.getByTestId('client-currency-select');
  await expect(select).toBeVisible();
  const options = await select.locator('option').evaluateAll((els) =>
    els.map((el) => ({
      value: (el as HTMLOptionElement).value,
      text: (el.textContent ?? '').trim(),
    })),
  );
  const match = options.find((o) => o.value === code || o.text.includes(code));
  if (!match) {
    throw new Error(`no client-currency option for ${code}; saw ${JSON.stringify(options)}`);
  }
  await select.selectOption(match.value);
}

// Reach a client's statement the way a user would (mirrors client-statement.spec): open the detail
// page, then open the statement with its own control.
async function openStatement(page: Page, clientId: number): Promise<void> {
  await page.goto(`/clients/${clientId}`);
  await expect(page.getByTestId('client-detail-page')).toBeVisible();
  const opener = page.getByTestId('client-statement-open');
  await expect(opener).toBeVisible();
  await opener.click();
  await expect(page.getByTestId('client-statement')).toBeVisible();
  await expect(page.getByTestId('client-statement-table')).toBeVisible();
}

// Reach the dashboard the way a user would — follow its nav link from the home screen.
async function openDashboard(page: Page): Promise<void> {
  await page.goto('/');
  const nav = page.getByTestId('nav-dashboard');
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
}

test.describe("Each client has their own currency, shown in that currency everywhere", () => {
  test('setting a client\'s currency updates the display, records it once, and persists', async ({
    page,
  }) => {
    // A client with no currency set — so it carries the default, USD — plus a SENT invoice (500, 200
    // paid) so its money has somewhere to show. Setting the currency does not touch the figures, only
    // the currency they are shown in.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 500, projectId: 1, status: 'SENT' }],
      payments: [{ id: 1, invoiceId: 1, amount: 200, date: '2021-03-14' }],
    });

    await page.goto('/clients/1');
    await expect(page.getByTestId('client-detail-page')).toBeVisible();

    // The detail page surfaces the currency panel, and the current currency reads as the default USD
    // (shown as the code or its "$" symbol).
    await expect(page.getByTestId('client-currency-panel')).toBeVisible();
    await expect(page.getByTestId('client-currency')).toHaveText(/USD|\$/);

    // Nothing recorded yet — reset clears the audit file, so the record below is proof the save (not
    // the seeding) wrote it.
    expect(auditLines()).toEqual([]);

    // Choose EUR and save.
    await selectCurrency(page, 'EUR');
    await page.getByTestId('client-currency-save').click();

    // The display now reflects EUR (its code or its "€" symbol), and no longer the dollar sign.
    await expect(page.getByTestId('client-currency')).toHaveText(/EUR|€/);
    await expect(page.getByTestId('client-currency')).not.toContainText('$');

    // Exactly one record was kept for this change, carrying the client's id and the chosen currency.
    expect(auditLines().filter((l) => l === currencyRecord(1, 'EUR'))).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // Held by the server: a fresh load still shows EUR, and merely viewing the page does not record
    // the change again.
    await page.reload();
    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-currency')).toHaveText(/EUR|€/);
    expect(auditLines()).toHaveLength(1);

    // And the client's money is now shown in EUR on their statement — the invoice (500, 200 paid, 300
    // due) reads with the euro symbol, not the dollar it showed as the default.
    await openStatement(page, 1);
    await expect(statementCell(page, 1, 'statement-invoice-amount')).toContainText(inCur(500, 'EUR'));
    await expect(statementCell(page, 1, 'statement-invoice-due')).toContainText(inCur(300, 'EUR'));
    await expect(page.getByTestId('client-outstanding-total')).toContainText(inCur(300, 'EUR'));
    await expect(page.getByTestId('client-statement')).not.toContainText('$');
  });

  test("money is shown in the client's currency throughout their statement", async ({ page }) => {
    // A client whose currency is GBP, with one SENT invoice: amount 500, 200 paid -> 300 still due.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test', currency: 'GBP' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 500, projectId: 1, status: 'SENT' }],
      payments: [{ id: 1, invoiceId: 1, amount: 200, date: '2021-03-14' }],
    });

    await openStatement(page, 1);

    // Every money figure on the statement reads in the client's currency (pounds), each with the "£"
    // symbol and none with a dollar sign.
    await expect(statementCell(page, 1, 'statement-invoice-amount')).toContainText(inCur(500, 'GBP'));
    await expect(statementCell(page, 1, 'statement-invoice-paid')).toContainText(inCur(200, 'GBP'));
    await expect(statementCell(page, 1, 'statement-invoice-due')).toContainText(inCur(300, 'GBP'));
    await expect(page.getByTestId('client-outstanding-total')).toContainText(inCur(300, 'GBP'));
    await expect(page.getByTestId('client-statement')).not.toContainText('$');
  });

  test('a client with no currency set shows money in the default currency, USD', async ({ page }) => {
    // No `currency` seeded, so the client carries the default. Its money reads in USD — the panel
    // reports USD and the statement shows dollars.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 250, projectId: 1, status: 'SENT' }],
    });

    await page.goto('/clients/1');
    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-currency')).toHaveText(/USD|\$/);

    await openStatement(page, 1);
    await expect(statementCell(page, 1, 'statement-invoice-amount')).toContainText(inCur(250, 'USD'));
    await expect(page.getByTestId('client-outstanding-total')).toContainText(inCur(250, 'USD'));
  });

  test('the home screen keeps the outstanding totals separate per currency', async ({ page }) => {
    // Two clients in two currencies, each with one SENT, unpaid invoice: Acme owes 300 in USD, Globex
    // owes 500 in EUR. The home screen must show ONE total per currency — $300.00 and €500.00 — and
    // never add the two currencies together into a single 800.
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test', currency: 'USD' },
        { id: 2, name: 'Globex', email: 'contact@globex.test', currency: 'EUR' },
      ],
      projects: [
        { id: 1, name: 'Website Redesign', clientId: 1 },
        { id: 2, name: 'Mobile App', clientId: 2 },
      ],
      invoices: [
        { id: 1, amount: 300, projectId: 1, status: 'SENT' },
        { id: 2, amount: 500, projectId: 2, status: 'SENT' },
      ],
    });

    await openDashboard(page);

    // Exactly two per-currency totals — one each — not a single combined figure.
    await expect(outstandingTotals(page)).toHaveCount(2);

    const usd = page.getByTestId('dashboard-outstanding-USD');
    const eur = page.getByTestId('dashboard-outstanding-EUR');
    await expect(usd).toBeVisible();
    await expect(eur).toBeVisible();

    // Each total is its own currency's owed, in its own currency's symbol.
    await expect(usd).toContainText(inCur(300, 'USD')); // $300.00
    await expect(eur).toContainText(inCur(500, 'EUR')); // €500.00

    // The currencies are kept apart: the dollar total carries no euro sign and vice versa, and
    // neither shows the forbidden sum of the two (800).
    await expect(usd).not.toContainText('€');
    await expect(eur).not.toContainText('$');
    await expect(usd).not.toContainText('800');
    await expect(eur).not.toContainText('800');
  });

  test("the top-clients list shows each client's figure in their own currency", async ({ page }) => {
    // Two clients in different currencies, each with one SENT, unpaid invoice they still owe in full:
    // Acme owes 300 in USD, Globex owes 500 in EUR. Each row's amount is shown in that client's own
    // currency, never converted or lumped with the other.
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test', currency: 'USD' },
        { id: 2, name: 'Globex', email: 'contact@globex.test', currency: 'EUR' },
      ],
      projects: [
        { id: 1, name: 'Website Redesign', clientId: 1 },
        { id: 2, name: 'Mobile App', clientId: 2 },
      ],
      invoices: [
        { id: 1, amount: 300, projectId: 1, status: 'SENT' },
        { id: 2, amount: 500, projectId: 2, status: 'SENT' },
      ],
    });

    await openDashboard(page);
    await expect(page.getByTestId('dashboard-top-clients')).toBeVisible();

    // Both clients are listed, each owed figure in its own currency.
    await expect(topRow(page, 1)).toBeVisible();
    await expect(topRow(page, 2)).toBeVisible();
    await expect(topAmount(page, 1)).toContainText(inCur(300, 'USD')); // $300.00
    await expect(topAmount(page, 2)).toContainText(inCur(500, 'EUR')); // €500.00

    // Neither client's figure is shown in the other's currency.
    await expect(topAmount(page, 1)).not.toContainText('€');
    await expect(topAmount(page, 2)).not.toContainText('$');
  });
});
