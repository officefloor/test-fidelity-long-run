// Acceptance tests for the change request:
//   "Different clients pay me in different currencies. Let me set each client's currency. Show
//    their money in that currency everywhere I see it, including on their statement. [...]
//    Do not add different currencies together."
//
// A client now has a CURRENCY. Its detail page (client-detail-page, at /clients/<id>) carries a
// currency panel (client-currency-panel) that SHOWS the client's current currency (client-currency)
// and lets you CHANGE it: pick one from a select (client-currency-select) and commit with a save
// control (client-currency-save). Setting a currency:
//   - makes it the currency shown for that client (client-currency names it), and that sticks;
//   - appends exactly one audit record — CLIENT_CURRENCY_SET id=<id> currency=<currency> — naming
//     the client and the chosen currency (the act of setting it is audited).
// Once a client has a currency, THEIR money is shown in that currency wherever it appears, the
// request calling out the client's STATEMENT by name: every money cell on the statement (the
// invoice amount / paid / due and the outstanding total) reads in the client's own currency rather
// than the dollars the app shows by default. The currency is PER CLIENT — one client's currency
// never shows on another's page or statement.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed, which now honours a client's `currency`; the
// set is driven through the UI. A client seeded without a currency keeps the app's established
// default (US dollars, money-format.spec.ts) — that is why the many existing specs that seed no
// currency keep reading in "$" unchanged.
//
// The app formats money with Intl.NumberFormat (ui/money.ts), so a non-USD client's money reads with
// that currency's own symbol (€, £) in place of the dollar sign. Each money assertion is therefore
// made robustly: the amount digits are present, a marker for the RIGHT currency (its symbol OR its
// ISO code) is present, and no marker for any OTHER currency leaks in. That pins "shown in this
// client's currency" whether the feature renders "€400.00" or "EUR 400.00", while still failing the
// app BEFORE this change — which renders every client's money in "$" and so carries no €/£/EUR/GBP
// marker. This SHOULD FAIL today: a client has no currency, no currency panel, and nothing is
// recorded when one is set.
import { test, expect, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

// A marker that must be present for each currency (its symbol or its ISO code), and the symbol used
// to prove no OTHER currency's money leaks into an element.
const CURRENCIES: Record<string, { marker: RegExp; symbol: string }> = {
  USD: { marker: /\$|USD/, symbol: '$' },
  EUR: { marker: /€|EUR/, symbol: '€' },
  GBP: { marker: /£|GBP/, symbol: '£' },
};

// Assert a money cell shows `amount` rendered in currency `code`: the amount digits are present, the
// right currency's marker is present, and neither the symbol nor the ISO code of any other currency
// appears. Amounts are kept whole and below a thousand so the rendered digits are "<n>.00" with no
// thousands separator in play (money-thousands-separator.spec.ts covers grouping).
async function expectMoney(locator: Locator, amount: number, code: keyof typeof CURRENCIES) {
  await expect(locator).toContainText(amount.toFixed(2));
  await expect(locator).toContainText(CURRENCIES[code].marker);
  for (const [other, m] of Object.entries(CURRENCIES)) {
    if (other === code) continue;
    await expect(locator).not.toContainText(m.symbol);
    await expect(locator).not.toContainText(other);
  }
}

async function openClient(page: import('@playwright/test').Page, clientId: number) {
  await page.goto('/clients');
  await page.getByTestId(`client-open-${clientId}`).click();
  await expect(page.getByTestId('client-detail-page')).toBeVisible();
}

async function openStatement(page: import('@playwright/test').Page, clientId: number) {
  await openClient(page, clientId);
  await page.getByTestId('client-statement-open').click();
  await expect(page.getByTestId('client-statement')).toBeVisible();
}

test.describe("set a client's currency and show their money in it", () => {
  test('a seeded currency is shown on the client, and seeding it is not an audited act', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example', currency: 'EUR' }],
    });

    await openClient(page, 1);

    const panel = page.getByTestId('client-currency-panel');
    await expect(panel).toBeVisible();
    // The client's current currency is shown — the seeded one (euros), not the dollar default.
    await expect(page.getByTestId('client-currency')).toContainText(/€|EUR/);
    await expect(page.getByTestId('client-currency')).not.toContainText('$');

    // Seeding a currency is Arrange, not an action — nothing is audited by it.
    expect(auditLines()).toEqual([]);
  });

  test('picking a currency and saving shows it, sticks, and records the act', async ({ page }) => {
    // Seeded without a currency -> the client starts on the app's dollar default.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
    });

    await openClient(page, 1);
    await expect(page.getByTestId('client-currency-panel')).toBeVisible();

    // Not euros yet, and reset cleared the audit file — nothing has been set.
    await expect(page.getByTestId('client-currency')).not.toContainText(/€|EUR/);
    expect(auditLines()).toEqual([]);

    // Pick euros and save.
    await page.getByTestId('client-currency-select').selectOption('EUR');
    await page.getByTestId('client-currency-save').click();

    // The client now shows its chosen currency.
    await expect(page.getByTestId('client-currency')).toContainText(/€|EUR/);

    // Exactly one record was kept, naming the client and the chosen currency.
    await expect.poll(() => auditLines()).toEqual(['CLIENT_CURRENCY_SET id=1 currency=EUR']);

    // The choice sticks: leaving and reopening the client still shows euros (it is not lost with the
    // click, and setting it again is not implied).
    await openClient(page, 1);
    await expect(page.getByTestId('client-currency')).toContainText(/€|EUR/);
    await expect.poll(() => auditLines()).toEqual(['CLIENT_CURRENCY_SET id=1 currency=EUR']);
  });

  test("a client's statement shows every money figure in that client's currency", async ({ page }) => {
    // One pound (GBP) client with a part-paid sent invoice: 500 billed, 200 paid -> 300 still due.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example', currency: 'GBP' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [{ id: 1, projectId: 1, amount: 500, status: 'SENT' }],
      payments: [{ id: 1, invoiceId: 1, amount: 200, date: '2025-06-15' }],
    });

    await openStatement(page, 1);
    await expect(page.getByTestId('client-statement-table')).toBeVisible();

    const row = page.getByTestId('statement-invoice-row-1');
    // Amount, paid and due all read in the client's pounds, not dollars.
    await expectMoney(row.getByTestId('statement-invoice-amount'), 500, 'GBP');
    await expectMoney(row.getByTestId('statement-invoice-paid'), 200, 'GBP');
    await expectMoney(row.getByTestId('statement-invoice-due'), 300, 'GBP');

    // The outstanding total they still owe is in pounds too.
    await expectMoney(page.getByTestId('client-outstanding-total'), 300, 'GBP');
  });

  test('currency is per client — one client\'s currency never shows on another\'s statement', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example', currency: 'EUR' },
        { id: 2, name: 'Globex', email: 'hello@globex.example', currency: 'GBP' },
      ],
      projects: [
        { id: 1, clientId: 1, name: 'Acme site' },
        { id: 2, clientId: 2, name: 'Globex site' },
      ],
      invoices: [
        { id: 1, projectId: 1, amount: 400, status: 'SENT' }, // Acme owes 400, in euros
        { id: 2, projectId: 2, amount: 600, status: 'SENT' }, // Globex owes 600, in pounds
      ],
    });

    // Client 1 (euros): panel and statement both read in euros, never pounds or dollars.
    await openClient(page, 1);
    await expect(page.getByTestId('client-currency')).toContainText(/€|EUR/);
    await page.getByTestId('client-statement-open').click();
    await expect(page.getByTestId('client-statement')).toBeVisible();
    await expectMoney(page.getByTestId('client-outstanding-total'), 400, 'EUR');

    // Client 2 (pounds): its own currency, with the euro client's never leaking across.
    await openClient(page, 2);
    await expect(page.getByTestId('client-currency')).toContainText(/£|GBP/);
    await page.getByTestId('client-statement-open').click();
    await expect(page.getByTestId('client-statement')).toBeVisible();
    await expectMoney(page.getByTestId('client-outstanding-total'), 600, 'GBP');
  });
});
