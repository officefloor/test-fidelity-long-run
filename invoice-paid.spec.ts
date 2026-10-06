// Acceptance test for the change request:
//   "Work out for me whether an invoice is paid, part paid or still owing. Base it on the payments
//    I have recorded. I do not want to flip it to paid by hand anymore."
//
// Whether an invoice is PAID, PART PAID or STILL OWING is now WORKED OUT from the payments recorded
// against it — never set by hand. On the invoice's own detail page (invoice-detail-page, the child
// route /invoices/<id>, which is also where its payments are listed and recorded) a new panel
// (invoice-status-panel) reports that worked-out status:
//   - nothing paid yet            -> still owing
//   - some paid, but not the whole amount -> part paid
//   - payments cover the amount   -> paid
// The status is derived from the invoice's amount and the sum of its payments, so recording a
// payment can move it owing -> part paid -> paid with no manual step, and it is held by the server
// (survives a fresh load). Because the request wants a record kept for the payments it is based on,
// recording a payment appends exactly one audit record `PAYMENT_RECORDED id=<id> amount=<amount>`.
// The old by-hand "mark paid" control is gone: an invoice is no longer flipped to paid by hand.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed (the app's /__test__ endpoint): `clients` honours
// { id, name, email }, `projects` honours { id, name, clientId }, `invoices` honours
// { id, amount, projectId, status } and `payments` honours { id, invoiceId, amount, date }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

// Each worked-out status is matched by the WORD that names it, case-insensitively, so the test binds
// to the MEANING and not one capitalisation or exact phrasing ("Owing"/"Still owing",
// "Part paid"/"Partly paid"/"Partially paid", "Paid"/"Paid in full"). The three words cannot
// legitimately co-occur in the one concise status a panel shows, so they discriminate the states:
//   - only the owing status carries "owing";
//   - only the part-paid status carries "part";
//   - "paid" appears in both "paid" and "part paid", so FULLY paid is "paid" WITHOUT "part".
// PAID uses a word boundary so it binds to the word "paid" on its own and not a substring of
// "unpaid", keeping the owing assertion below robust to that wording too.
const OWING = /owing/i;
const PART = /part/i;
const PAID = /\bpaid\b/i;

const paymentRows = (page: Page) => page.locator('[data-testid^="payment-row-"]');
const rowByAmount = (page: Page, amount: number): Locator =>
  paymentRows(page).filter({ has: page.getByTestId('payment-amount').getByText(String(amount)) });

// The audit record kept for one recorded payment. The id is server-assigned, so it is matched as any
// number; the amount (the figure the status is based on) is pinned, allowing an optional scale part
// (150 or 150.00). Payment amounts in each test are chosen distinct so a record is found by amount.
const paymentRecord = (amount: number) =>
  new RegExp(`^PAYMENT_RECORDED id=\\d+ amount=${amount}(\\.\\d+)?$`);
const paymentRecordsFor = (amount: number): string[] =>
  auditLines().filter((line) => paymentRecord(amount).test(line));

async function gotoInvoice(page: Page, id: number): Promise<void> {
  await page.goto(`/invoices/${id}`);
  await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
}

const statusPanel = (page: Page): Locator => page.getByTestId('invoice-status-panel');

type Status = 'owing' | 'part' | 'paid';

// Assert the panel reports exactly one of the three worked-out statuses. Each case pins the status by
// its own word AND rules out the neighbours it must be distinguished from, so a panel hardwired to a
// single status could not pass all three scenarios below.
async function expectStatus(page: Page, status: Status): Promise<void> {
  const panel = statusPanel(page);
  await expect(panel).toBeVisible();
  if (status === 'owing') {
    await expect(panel).toHaveText(OWING);
    await expect(panel).not.toHaveText(PAID); // nothing paid: not "paid", not "part paid"
  } else if (status === 'part') {
    await expect(panel).toHaveText(PART);
    await expect(panel).not.toHaveText(OWING); // some paid: no longer merely owing
  } else {
    await expect(panel).toHaveText(PAID);
    await expect(panel).not.toHaveText(PART); // fully paid, not part paid
    await expect(panel).not.toHaveText(OWING);
  }
}

test.describe('An invoice’s status is worked out from its payments', () => {
  test('with nothing paid yet, the invoice is still owing', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 500, projectId: 1, status: 'SENT' }],
      payments: [],
    });

    await gotoInvoice(page, 1);

    // No payments recorded, so the whole amount is outstanding: still owing.
    await expectStatus(page, 'owing');
  });

  test('with some but not all of the amount paid, the invoice is part paid', async ({ page }) => {
    // Amount 500 with 60 + 175 = 235 paid against it: paid something, but not the whole amount.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 500, projectId: 1, status: 'SENT' }],
      payments: [
        { id: 1, invoiceId: 1, amount: 60, date: '2021-03-14' },
        { id: 2, invoiceId: 1, amount: 175, date: '2022-08-19' },
      ],
    });

    await gotoInvoice(page, 1);

    await expectStatus(page, 'part');
  });

  test('once payments cover the amount, the invoice is paid', async ({ page }) => {
    // Invoice 1: amount 300, 120 + 180 = 300 paid (covers it exactly) -> paid.
    // Invoice 2: amount 200, 250 paid (more than the amount) -> still paid: cover is cover.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 300, projectId: 1, status: 'SENT' },
        { id: 2, amount: 200, projectId: 1, status: 'SENT' },
      ],
      payments: [
        { id: 1, invoiceId: 1, amount: 120, date: '2021-03-14' },
        { id: 2, invoiceId: 1, amount: 180, date: '2022-08-19' },
        { id: 3, invoiceId: 2, amount: 250, date: '2023-05-27' },
      ],
    });

    await gotoInvoice(page, 1);
    await expectStatus(page, 'paid');

    await gotoInvoice(page, 2);
    await expectStatus(page, 'paid');
  });

  test('the status is worked out per invoice from its own payments', async ({ page }) => {
    // Two invoices in the one project, each with its own amount and its own payments. The status is
    // computed per invoice, and each detail page reports only its own invoice's status: invoice 1 is
    // part paid (200 of 500), invoice 2 is still owing (nothing of 800).
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 500, projectId: 1, status: 'SENT' },
        { id: 2, amount: 800, projectId: 1, status: 'SENT' },
      ],
      payments: [{ id: 1, invoiceId: 1, amount: 200, date: '2021-03-14' }],
    });

    await gotoInvoice(page, 1);
    await expectStatus(page, 'part');

    await gotoInvoice(page, 2);
    await expectStatus(page, 'owing');
  });

  test('recording payments moves the status owing -> part paid -> paid, keeping a record for each', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 400, projectId: 1, status: 'SENT' }],
      payments: [],
    });

    await gotoInvoice(page, 1);

    // Nothing recorded yet — reset clears the audit file and seeding does not record payments, so the
    // records below are proof the recording (not the seeding or a page load) wrote them.
    expect(auditLines()).toEqual([]);

    // Starts still owing: no payments.
    await expectStatus(page, 'owing');

    // Record 150 of the 400 — now part paid, and one record is kept for the payment.
    await page.getByTestId('payment-form-amount').fill('150');
    await page.getByTestId('payment-form-date').fill('2023-05-27');
    await page.getByTestId('payment-form-submit').click();
    await expect(rowByAmount(page, 150)).toHaveCount(1);
    await expectStatus(page, 'part');
    expect(paymentRecordsFor(150)).toHaveLength(1);

    // Record the remaining 250 — payments now cover the 400, so the status is worked out as paid with
    // no by-hand step, and a second payment record is kept.
    await page.getByTestId('payment-form-amount').fill('250');
    await page.getByTestId('payment-form-date').fill('2023-06-02');
    await page.getByTestId('payment-form-submit').click();
    await expect(rowByAmount(page, 250)).toHaveCount(1);
    await expectStatus(page, 'paid');
    expect(paymentRecordsFor(250)).toHaveLength(1);
    expect(paymentRecordsFor(150)).toHaveLength(1);

    // The status is derived from server-held payments, so it is still paid after a fresh load — and
    // reloading records nothing more.
    await page.reload();
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    await expectStatus(page, 'paid');
    expect(paymentRecordsFor(150)).toHaveLength(1);
    expect(paymentRecordsFor(250)).toHaveLength(1);
  });

  test('an invoice is no longer flipped to paid by hand', async ({ page }) => {
    // A sent invoice with nothing paid used to offer a by-hand "mark paid" control on the project's
    // invoice list. The request retires that: status is worked out from payments, so the control is
    // gone and no row offers a way to flip an invoice to paid by hand.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 500, projectId: 1, status: 'SENT' }],
      payments: [],
    });

    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('invoice-row-1')).toBeVisible();

    // No by-hand "mark paid" control is offered for the invoice.
    await expect(page.getByTestId('invoice-pay-1')).toHaveCount(0);

    // And its worked-out status (nothing paid) is still owing, on its detail page.
    await gotoInvoice(page, 1);
    await expectStatus(page, 'owing');
  });
});
