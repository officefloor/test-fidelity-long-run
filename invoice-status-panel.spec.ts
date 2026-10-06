// Acceptance tests for the change request:
//   "Work out for me whether an invoice is paid, part paid or still owing. Base it on the payments
//    I have recorded. I do not want to flip it to paid by hand anymore."
//
// An invoice's payment status is now WORKED OUT from the payments recorded against it, not set by
// hand. On the invoice's own detail page (invoice-detail-page, at /invoices/<id> — the same public
// URL surface the invoice specs already use, and the one place that shows that invoice's payments)
// a status panel (invoice-status-panel) states which of the three it is:
//   - nothing paid yet                     -> still owing
//   - some paid, but less than the amount  -> part paid
//   - payments cover the whole amount      -> paid
// Because it is derived "from the payments I have recorded", it is scoped to the ONE invoice: each
// invoice's status is worked out from its OWN payments, never a sibling's. Recording a payment keeps
// one audit record — PAYMENT_RECORDED id=<id> amount=<amount> — so what the status was worked out
// from can be checked back later.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed, which honours invoices: { id, projectId, amount,
// status } and payments: { id, invoiceId, amount, date } (alongside clients / projects); the record-
// a-payment flow is driven through the existing payment-form.
//
// The three states are the change request's own words ("paid", "part paid", "still owing"), asserted
// VOCABULARY- and CASING-tolerantly so whichever wording/casing the feature renders passes:
//   - "still owing" is matched as /owing|owed|outstanding|unpaid/i,
//   - "part paid"   as /part/i (the only state that carries the word "part"),
//   - "paid"        as containing /paid/i while NOT carrying /part/i (so a full "paid" is told apart
//     from a "part paid").
// Each assertion uses only the token that distinguishes its state — never the absence of a money word
// that a panel might legitimately show (e.g. a "$0.00 paid" sub-figure) — so a correct panel passes
// however richly it is laid out, while a mis-derived status (a leaked sibling payment, a wrong sum)
// fails. The audit amount is matched with an optional trailing ".00" so a plain or two-decimal
// rendering both pass. This SHOULD FAIL before the change: there is no invoice-status-panel today, and
// recording a payment keeps no PAYMENT_RECORDED record.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

// The distinguishing token for each worked-out state. Kept deliberately loose on wording but exact on
// which state each denotes (see the header note on why "paid" needs the /part/ guard).
const OWING = /owing|owed|outstanding|unpaid/i;
const PART = /part/i;
const PAID = /paid/i;

test.describe('an invoice is worked out as paid / part paid / still owing from its payments', () => {
  test('works out each invoice from the payments recorded against it', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        // Nothing paid against it -> still owing.
        { id: 1, projectId: 1, amount: 500, status: 'SENT' },
        // 200 of 500 paid -> part paid (worked out, not fully paid).
        { id: 2, projectId: 1, amount: 500, status: 'SENT' },
        // 100 + 200 = 300 covers the whole 300 -> paid.
        { id: 3, projectId: 1, amount: 300, status: 'SENT' },
      ],
      payments: [
        { id: 1, invoiceId: 2, amount: 200, date: '2025-06-15' },
        { id: 2, invoiceId: 3, amount: 100, date: '2025-07-11' },
        { id: 3, invoiceId: 3, amount: 200, date: '2025-08-20' },
      ],
    });

    // Invoice 1: nothing recorded against it -> still owing. Not part paid: no sibling's payment
    // leaked in (if invoice 2's 200 had, it would read as part paid instead).
    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    const panel1 = page.getByTestId('invoice-status-panel');
    await expect(panel1).toBeVisible();
    await expect(panel1).toContainText(OWING);
    await expect(panel1).not.toContainText(PART);

    // Invoice 2: 200 of 500 recorded against IT -> part paid. Neither still owing nor fully paid.
    await page.goto('/invoices/2');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    const panel2 = page.getByTestId('invoice-status-panel');
    await expect(panel2).toBeVisible();
    await expect(panel2).toContainText(PART);

    // Invoice 3: 100 + 200 = 300 covers its full 300 -> paid, and not merely part paid.
    await page.goto('/invoices/3');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    const panel3 = page.getByTestId('invoice-status-panel');
    await expect(panel3).toBeVisible();
    await expect(panel3).toContainText(PAID);
    await expect(panel3).not.toContainText(PART);
  });

  test('recording a payment works out the new status and keeps a record of it', async ({ page }) => {
    // A sent invoice with nothing paid on it yet. RESTART IDENTITY on reset + no payments seeded means
    // the first payment recorded through the UI is id 1, the next id 2.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [{ id: 1, projectId: 1, amount: 400, status: 'SENT' }],
      payments: [],
    });

    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    const panel = page.getByTestId('invoice-status-panel');

    // Nothing recorded yet -> still owing. reset cleared the audit file, so nothing is recorded.
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(OWING);
    await expect(panel).not.toContainText(PART);
    expect(auditLines()).toEqual([]);

    // Record a partial payment: 150 of 400.
    await page.getByTestId('payment-form-amount').fill('150');
    await page.getByTestId('payment-form-date').fill('2025-05-10');
    await page.getByTestId('payment-form-submit').click();
    await expect(page.getByTestId('payment-form-error')).toHaveCount(0);

    // The status is worked out again from the payments: 150 < 400, so part paid.
    await expect(panel).toContainText(PART);

    // Exactly one record was kept for recording that payment, naming it and its amount — and only
    // that one (a partial payment does not pay the invoice off).
    await expect
      .poll(() => auditLines().filter((l) => /^PAYMENT_RECORDED id=1 amount=150(\.0+)?$/.test(l)))
      .toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // Record enough to cover the rest: 250 more (150 + 250 = 400) -> now fully paid.
    await page.getByTestId('payment-form-amount').fill('250');
    await page.getByTestId('payment-form-date').fill('2025-06-12');
    await page.getByTestId('payment-form-submit').click();
    await expect(page.getByTestId('payment-form-error')).toHaveCount(0);

    // Worked out from the two payments together: paid, and no longer merely part paid.
    await expect(panel).toContainText(PAID);
    await expect(panel).not.toContainText(PART);

    // A separate record was kept for this payment too (id 2) — one per payment recorded — and the
    // first payment's record is still there alongside it.
    await expect
      .poll(() => auditLines().filter((l) => /^PAYMENT_RECORDED id=2 amount=250(\.0+)?$/.test(l)))
      .toHaveLength(1);
    expect(auditLines().some((l) => /^PAYMENT_RECORDED id=1 amount=150(\.0+)?$/.test(l))).toBe(true);
  });
});
