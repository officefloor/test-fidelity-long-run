// Acceptance tests for the change request:
//   "Work out for me whether an invoice is paid, part paid or still owing. Base it on the payments
//    I have recorded. I do not want to flip it to paid by hand anymore."
//
// This REVISES the earlier "mark an invoice paid by hand" behaviour. An invoice no longer offers a
// control to flip it to paid (there is no invoice-pay-<id> button on the project's detail page where
// it used to live): being paid is now WORKED OUT from the payments recorded against the invoice. An
// invoice reaches "paid" purely by recording payments that cover its amount — never by a hand action
// — and that status is worked out per invoice, so fully paying one leaves a sibling still owing.
//
// (The three worked-out states and the PAYMENT_RECORDED audit are covered in detail by
// invoice-status-panel.spec.ts; this spec pins the two things this change REMOVES/REPLACES — the
// by-hand control, and reaching paid through payments alone — plus per-invoice isolation.)
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed; the record-a-payment flow is driven through the
// existing payment-form. Seed honours invoices: { id, projectId, amount, status } and
// payments: { id, invoiceId, amount, date } (alongside clients / projects).
//
// State words are matched vocabulary-/casing-tolerantly: "still owing" as /owing|owed|outstanding|
// unpaid/i and a full "paid" as containing /paid/i while NOT carrying /part/i (so it is told apart
// from a "part paid"). The audit amount is matched with an optional trailing ".00". This SHOULD FAIL
// before the change: today a sent invoice still offers invoice-pay-<id>, and there is no
// invoice-status-panel to show the worked-out status.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

const OWING = /owing|owed|outstanding|unpaid/i;
const PART = /part/i;
const PAID = /paid/i;

test.describe('an invoice is worked out as paid from its payments, not flipped by hand', () => {
  test('there is no by-hand control; paid is reached by recording payments', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [{ id: 1, projectId: 1, amount: 300, status: 'SENT' }],
      payments: [],
    });

    // On the project's detail page — where the by-hand "mark paid" control used to live — a sent
    // invoice shows its status but offers NO control to flip it to paid: that is gone.
    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    const row = page.getByTestId('invoice-row-1');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('invoice-status')).toBeVisible();
    await expect(page.getByTestId('invoice-pay-1')).toHaveCount(0);

    // On the invoice's own page, with nothing paid yet, it is worked out as still owing.
    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    const panel = page.getByTestId('invoice-status-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(OWING);
    await expect(panel).not.toContainText(PART);
    expect(auditLines()).toEqual([]);

    // Record payments covering the whole 300 (100 + 200). No hand action — just the payments.
    await page.getByTestId('payment-form-amount').fill('100');
    await page.getByTestId('payment-form-date').fill('2025-04-01');
    await page.getByTestId('payment-form-submit').click();
    await expect(page.getByTestId('payment-form-error')).toHaveCount(0);
    // Half-covered after the first -> part paid, not yet paid.
    await expect(panel).toContainText(PART);

    await page.getByTestId('payment-form-amount').fill('200');
    await page.getByTestId('payment-form-date').fill('2025-04-20');
    await page.getByTestId('payment-form-submit').click();
    await expect(page.getByTestId('payment-form-error')).toHaveCount(0);

    // Now the payments cover the amount: worked out as paid, with no by-hand step involved.
    await expect(panel).toContainText(PAID);
    await expect(panel).not.toContainText(PART);

    // Each recorded payment kept its own PAYMENT_RECORDED record (ids 1 and 2).
    await expect
      .poll(() => auditLines().filter((l) => /^PAYMENT_RECORDED id=1 amount=100(\.0+)?$/.test(l)))
      .toHaveLength(1);
    await expect
      .poll(() => auditLines().filter((l) => /^PAYMENT_RECORDED id=2 amount=200(\.0+)?$/.test(l)))
      .toHaveLength(1);
  });

  test('paying one invoice off leaves a sibling still owing', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        { id: 1, projectId: 1, amount: 300, status: 'SENT' },
        { id: 2, projectId: 1, amount: 500, status: 'SENT' },
      ],
      payments: [],
    });

    // Fully pay invoice 1 by recording a payment that covers it (300 of 300).
    await page.goto('/invoices/1');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    const panel1 = page.getByTestId('invoice-status-panel');
    await expect(panel1).toContainText(OWING);

    await page.getByTestId('payment-form-amount').fill('300');
    await page.getByTestId('payment-form-date').fill('2025-05-05');
    await page.getByTestId('payment-form-submit').click();
    await expect(page.getByTestId('payment-form-error')).toHaveCount(0);

    // Invoice 1 is worked out as paid.
    await expect(panel1).toContainText(PAID);
    await expect(panel1).not.toContainText(PART);
    await expect
      .poll(() => auditLines().filter((l) => /^PAYMENT_RECORDED id=1 amount=300(\.0+)?$/.test(l)))
      .toHaveLength(1);

    // Invoice 2 had nothing recorded against it — it is untouched, still owing.
    await page.goto('/invoices/2');
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    const panel2 = page.getByTestId('invoice-status-panel');
    await expect(panel2).toContainText(OWING);
    await expect(panel2).not.toContainText(PART);
  });
});
