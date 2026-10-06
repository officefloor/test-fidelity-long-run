// Acceptance test for the change request:
//   "Give me a statement for a client. Put all their invoices in one place. Show the total they
//    still owe me."
//
// A client now has a STATEMENT, surfaced on that client's own detail page (client-detail-page, the
// child route /clients/<id>). A control opens it (client-statement-open), revealing the statement
// region (client-statement). The statement puts ALL of that client's invoices IN ONE PLACE — every
// invoice across every project the client owns — in one table (client-statement-table). Each invoice
// is its own row (statement-invoice-row-<id>) carrying:
//   - statement-invoice-id      — which invoice it is
//   - statement-invoice-amount  — the invoice's amount
//   - statement-invoice-paid    — how much has been paid against it (the sum of its payments)
//   - statement-invoice-due     — how much is STILL LEFT TO PAY on it (amount minus what is paid)
//   - statement-invoice-status  — its worked-out state: owing / part paid / paid
// And the statement shows the TOTAL the client still owes (client-outstanding-total): the sum, across
// all the client's invoices, of what is still left to pay on each.
//
// WHY THESE VALUES. The app already works out, per invoice, how much is still left to pay after
// payments (invoice-due-amount.spec: amount minus the sum of payments) and a status from those
// payments (invoice-paid.spec: still owing -> part paid -> paid). The statement is the per-client
// roll-up of exactly that: each row is one invoice's amount/paid/due/status, and the total owed is
// the sum of the per-invoice dues. A fully-paid invoice is still LISTED (it is one of their invoices)
// but owes nothing, so it adds 0 to the total. All invoices below are SENT, so "what is owed" is
// unambiguous — the question of unsent drafts does not arise here.
//
// The seeded figures are chosen so the right total can only come from summing the per-invoice dues:
// amount 500 with 200 paid (due 300), amount 400 fully paid (due 0), amount 150 with nothing paid
// (due 150) => owed 300 + 0 + 150 = 450. That 450 is none of the plausible wrong readings — not the
// gross of every amount (1050), not the gross of the not-fully-paid ones (650), and not anything that
// includes the OTHER client's invoice.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email }, `projects` honours { id, name, clientId },
// `invoices` honours { id, amount, projectId, status } and `payments` honours
// { id, invoiceId, amount, date }. This change surfaces no audit records, so there is nothing to
// assert on the audit channel.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

const statementRows = (page: Page) =>
  page.locator('[data-testid^="statement-invoice-row-"]');

const cell = (page: Page, id: number, name: string): Locator =>
  page.getByTestId(`statement-invoice-row-${id}`).getByTestId(name);

const paymentRows = (page: Page) => page.locator('[data-testid^="payment-row-"]');
const rowByAmount = (page: Page, amount: number): Locator =>
  paymentRows(page).filter({ has: page.getByTestId('payment-amount').getByText(String(amount)) });

// Money is shown "properly" everywhere in this app — a dollar sign and two cents digits, e.g.
// $265.00 (money-format.spec). So each money figure (amount, paid, due, outstanding total) is
// asserted as CONTAINMENT of that value: the leading "$" keeps a figure from matching inside a larger
// number ($300.00 cannot match within $1300.00) and tolerates a surrounding label, while still
// pinning the value. Every figure below stays under a thousand, so thousands grouping never arises.
const money = (dollars: number): RegExp => new RegExp(`\\$${dollars}\\.00`);

// An invoice's id, matched as a standalone number token so a decoration like "#1" or "Invoice 1" is
// tolerated while the digits are still pinned. The id cell carries only the id, so this is read on
// that cell alone.
const idToken = (id: number): RegExp => new RegExp(`(^|\\D)${id}(\\D|$)`);

// The worked-out status words, matched case-insensitively so the test binds to MEANING not phrasing
// ("Owing"/"Still owing", "Part paid"/"Partly paid", "Paid"/"Paid in full"). "paid" is a substring of
// "part paid", so FULLY paid is "paid" WITHOUT "part"; a word boundary keeps it off "unpaid" too.
// Mirrors invoice-paid.spec, whose status this statement rolls up.
const OWING = /owing/i;
const PART = /part/i;
const PAID = /\bpaid\b/i;

type Status = 'owing' | 'part' | 'paid';

async function expectRowStatus(page: Page, id: number, status: Status): Promise<void> {
  const status_cell = cell(page, id, 'statement-invoice-status');
  await expect(status_cell).toBeVisible();
  if (status === 'owing') {
    await expect(status_cell).toHaveText(OWING);
    await expect(status_cell).not.toHaveText(PAID); // nothing paid: not paid, not part paid
  } else if (status === 'part') {
    await expect(status_cell).toHaveText(PART);
    await expect(status_cell).not.toHaveText(OWING); // some paid: no longer merely owing
  } else {
    await expect(status_cell).toHaveText(PAID);
    await expect(status_cell).not.toHaveText(PART); // fully paid, not part paid
    await expect(status_cell).not.toHaveText(OWING);
  }
}

// Reach a client's statement the way a user would: open the client's detail page, then open the
// statement with its own control. The statement is a reveal on the detail page (a show/hide the
// control owns), not a separate URL, so the contract is "the open control makes the statement appear".
async function openStatement(page: Page, clientId: number): Promise<void> {
  await page.goto(`/clients/${clientId}`);
  await expect(page.getByTestId('client-detail-page')).toBeVisible();
  const opener = page.getByTestId('client-statement-open');
  await expect(opener).toBeVisible();
  await opener.click();
  await expect(page.getByTestId('client-statement')).toBeVisible();
  await expect(page.getByTestId('client-statement-table')).toBeVisible();
}

// A client (Acme) with TWO projects and invoices spread across BOTH, plus a SECOND client (Globex)
// whose invoice must never leak into Acme's statement. Acme's three invoices carry distinct
// amount/paid/due triples so each row pins its own figures and the owed total can only be their sum.
async function seedTwoClients(): Promise<void> {
  await resetAndSeed({
    clients: [
      { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
      { id: 2, name: 'Globex', email: 'contact@globex.test' },
    ],
    projects: [
      { id: 1, name: 'Website Redesign', clientId: 1 },
      { id: 2, name: 'Mobile App', clientId: 1 },
      // Globex's own project — its invoice belongs to Globex, not Acme.
      { id: 3, name: 'Billing System', clientId: 2 },
    ],
    invoices: [
      { id: 1, amount: 500, projectId: 1, status: 'SENT' }, // 200 paid -> due 300, part paid
      { id: 2, amount: 400, projectId: 2, status: 'SENT' }, // 400 paid -> due 0,   paid
      { id: 3, amount: 150, projectId: 1, status: 'SENT' }, // nothing  -> due 150, owing
      { id: 4, amount: 999, projectId: 3, status: 'SENT' }, // Globex's — must not appear on Acme's
    ],
    payments: [
      { id: 1, invoiceId: 1, amount: 200, date: '2021-03-14' },
      { id: 2, invoiceId: 2, amount: 400, date: '2022-08-19' },
      // Globex's invoice has a payment too, to prove it is excluded figure and all.
      { id: 3, invoiceId: 4, amount: 50, date: '2023-05-27' },
    ],
  });
}

test.describe('A client statement puts all their invoices in one place', () => {
  test('the statement is revealed by its open control', async ({ page }) => {
    await seedTwoClients();

    await page.goto('/clients/1');
    await expect(page.getByTestId('client-detail-page')).toBeVisible();

    // Before it is opened, the statement is not shown — the open control is what reveals it.
    await expect(page.getByTestId('client-statement')).toHaveCount(0);

    const opener = page.getByTestId('client-statement-open');
    await expect(opener).toBeVisible();
    await opener.click();

    await expect(page.getByTestId('client-statement')).toBeVisible();
    await expect(page.getByTestId('client-statement-table')).toBeVisible();
  });

  test("lists every invoice of the client, from every project, each with its figures", async ({
    page,
  }) => {
    await seedTwoClients();
    await openStatement(page, 1);

    // Exactly Acme's three invoices — drawn from BOTH its projects — are in the one table.
    await expect(statementRows(page)).toHaveCount(3);
    await expect(page.getByTestId('statement-invoice-row-1')).toBeVisible();
    await expect(page.getByTestId('statement-invoice-row-2')).toBeVisible();
    await expect(page.getByTestId('statement-invoice-row-3')).toBeVisible();

    // Each row names which invoice it is.
    await expect(cell(page, 1, 'statement-invoice-id')).toHaveText(idToken(1));
    await expect(cell(page, 2, 'statement-invoice-id')).toHaveText(idToken(2));
    await expect(cell(page, 3, 'statement-invoice-id')).toHaveText(idToken(3));

    // invoice 1: amount 500, 200 paid, 300 still due.
    await expect(cell(page, 1, 'statement-invoice-amount')).toContainText(money(500));
    await expect(cell(page, 1, 'statement-invoice-paid')).toContainText(money(200));
    await expect(cell(page, 1, 'statement-invoice-due')).toContainText(money(300));

    // invoice 2: amount 400, fully paid, nothing due.
    await expect(cell(page, 2, 'statement-invoice-amount')).toContainText(money(400));
    await expect(cell(page, 2, 'statement-invoice-paid')).toContainText(money(400));
    await expect(cell(page, 2, 'statement-invoice-due')).toContainText(money(0));

    // invoice 3: amount 150, nothing paid, all of it still due.
    await expect(cell(page, 3, 'statement-invoice-amount')).toContainText(money(150));
    await expect(cell(page, 3, 'statement-invoice-paid')).toContainText(money(0));
    await expect(cell(page, 3, 'statement-invoice-due')).toContainText(money(150));
  });

  test("another client's invoice is not on this client's statement", async ({ page }) => {
    await seedTwoClients();
    await openStatement(page, 1);

    // Globex's invoice (id 4, amount 999) is nowhere on Acme's statement.
    await expect(page.getByTestId('statement-invoice-row-4')).toHaveCount(0);
    await expect(page.getByTestId('client-statement')).not.toContainText('999');
  });

  test('each invoice shows its worked-out status: owing, part paid, or paid', async ({ page }) => {
    await seedTwoClients();
    await openStatement(page, 1);

    await expectRowStatus(page, 1, 'part'); // 200 of 500
    await expectRowStatus(page, 2, 'paid'); // 400 of 400
    await expectRowStatus(page, 3, 'owing'); // 0 of 150
  });

  test('the statement shows the total the client still owes', async ({ page }) => {
    await seedTwoClients();
    await openStatement(page, 1);

    const total = page.getByTestId('client-outstanding-total');
    await expect(total).toBeVisible();

    // What they still owe is the sum of the per-invoice dues: 300 + 0 + 150 = 450.
    await expect(total).toContainText(money(450));

    // Not the gross of every amount (1050), nor the gross of the not-fully-paid invoices (650): the
    // partial payment on invoice 1 and the full payment on invoice 2 must both have been netted off.
    await expect(total).not.toContainText(money(1050));
    await expect(total).not.toContainText(money(650));
    // And Globex's invoice (999, or its 949 unpaid remainder) is no part of Acme's owed figure.
    await expect(total).not.toContainText(money(999));
    await expect(total).not.toContainText(money(949));
  });

  test("a different client's statement shows only that client's own invoices and owed total", async ({
    page,
  }) => {
    await seedTwoClients();
    await openStatement(page, 2);

    // Globex has exactly one invoice (id 4) — Acme's three are not here.
    await expect(statementRows(page)).toHaveCount(1);
    await expect(page.getByTestId('statement-invoice-row-4')).toBeVisible();
    await expect(page.getByTestId('statement-invoice-row-1')).toHaveCount(0);

    // Its figures: amount 999, 50 paid, 949 still due, part paid.
    await expect(cell(page, 4, 'statement-invoice-amount')).toContainText(money(999));
    await expect(cell(page, 4, 'statement-invoice-paid')).toContainText(money(50));
    await expect(cell(page, 4, 'statement-invoice-due')).toContainText(money(949));
    await expectRowStatus(page, 4, 'part');

    // Globex is owed only its own remainder: 949. Acme's 450 is nowhere on Globex's statement.
    const total = page.getByTestId('client-outstanding-total');
    await expect(total).toContainText(money(949));
    await expect(total).not.toContainText(money(450));
  });

  test('a client with no invoices has an empty statement that owes nothing', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [],
      payments: [],
    });

    await openStatement(page, 1);

    // Nothing invoiced, so no rows — and zero is money too: owed is shown as $0.00, not a bare 0.
    await expect(statementRows(page)).toHaveCount(0);
    await expect(page.getByTestId('client-outstanding-total')).toContainText(money(0));
  });

  test('recording a payment lowers what the client owes', async ({ page }) => {
    // Acme with two SENT invoices: 500 (200 already paid, due 300) and 150 (nothing paid, due 150).
    // Owed starts at 300 + 150 = 450.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 500, projectId: 1, status: 'SENT' },
        { id: 2, amount: 150, projectId: 1, status: 'SENT' },
      ],
      payments: [{ id: 1, invoiceId: 1, amount: 200, date: '2021-03-14' }],
    });

    await openStatement(page, 1);
    await expect(cell(page, 1, 'statement-invoice-due')).toContainText(money(300));
    await expect(page.getByTestId('client-outstanding-total')).toContainText(money(450));

    // Record another 100 against invoice 1, on the invoice's own detail page.
    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    await page.getByTestId('payment-form-amount').fill('100');
    await page.getByTestId('payment-form-date').fill('2023-05-27');
    await page.getByTestId('payment-form-submit').click();
    await expect(rowByAmount(page, 100)).toHaveCount(1);

    // Back on the statement, invoice 1 now owes 200 (500 - 300 paid) and the client's owed total has
    // fallen by the 100 just paid: 450 -> 350. The statement is derived from server-held data, so it
    // reflects the new payment on a fresh open.
    await openStatement(page, 1);
    await expect(cell(page, 1, 'statement-invoice-paid')).toContainText(money(300));
    await expect(cell(page, 1, 'statement-invoice-due')).toContainText(money(200));
    await expect(cell(page, 2, 'statement-invoice-due')).toContainText(money(150)); // untouched
    await expect(page.getByTestId('client-outstanding-total')).toContainText(money(350));
    await expect(page.getByTestId('client-outstanding-total')).not.toContainText(money(450));
  });
});
