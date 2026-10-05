// Acceptance tests for the change request:
//   "Invoices should move through stages. First a draft. Then I send it. Then it gets paid. Keep a
//    record when I send one. Only let me take payment once it has been sent."
//
// An invoice now moves through three stages: DRAFT -> SENT -> PAID. A freshly created invoice is a
// DRAFT. A draft offers a control to SEND it (invoice-send-<id>); sending flips THAT invoice's
// status to SENT and appends one audit record — INVOICE_SENT id=<id> amount=<amount> — so the send
// can be checked back later (the UI only shows the status). Payment is GATED on sending: the mark-
// paid control (invoice-pay-<id>) is only offered once the invoice has been sent — a draft cannot
// be paid. Once sent, paying it works as before (status -> PAID, INVOICE_PAID record).
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed; the send/pay flows are driven through the UI.
// Seed honours invoices: { id, projectId, amount, status } — status is seeded to place an invoice at
// a chosen stage ('DRAFT' / 'SENT' / 'PAID').
//
// Status labels are asserted case-insensitively (/^draft$/i, /^sent$/i, /^paid$/i) so the test
// tolerates whichever casing the feature renders. The audit amount is matched with an optional
// trailing ".00" so a plain or two-decimal rendering both pass. Amounts are distinct whole numbers so
// no value is a substring of another. This test SHOULD FAIL before the change: today a draft has no
// send control and can be paid directly.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

test.describe('invoice stages: draft -> sent -> paid', () => {
  test('a newly created invoice is a draft: it can be sent but not yet paid', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    // Create a new invoice through the form. RESTART IDENTITY + empty invoices => it gets id 1.
    await page.getByTestId('invoice-form-amount').fill('250');
    await page.getByTestId('invoice-form-submit').click();

    const row = page.getByTestId('invoice-row-1');
    await expect(row).toBeVisible();

    // First a draft: the new invoice starts in the DRAFT stage.
    await expect(row.getByTestId('invoice-status')).toHaveText(/^draft$/i);

    // A draft can be sent, but cannot yet be paid — payment is only offered once it has been sent.
    await expect(page.getByTestId('invoice-send-1')).toBeVisible();
    await expect(page.getByTestId('invoice-pay-1')).toHaveCount(0);
  });

  test('sending a draft moves it to sent, keeps a record, and only then allows payment', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [{ id: 1, projectId: 1, amount: 120, status: 'DRAFT' }],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const row = page.getByTestId('invoice-row-1');
    await expect(row).toBeVisible();

    // Starts as a draft: a send control is offered, and it cannot be paid yet.
    await expect(row.getByTestId('invoice-status')).toHaveText(/^draft$/i);
    await expect(page.getByTestId('invoice-send-1')).toBeVisible();
    await expect(page.getByTestId('invoice-pay-1')).toHaveCount(0);

    // reset cleared the audit file — nothing has been sent yet.
    expect(auditLines()).toEqual([]);

    await page.getByTestId('invoice-send-1').click();

    // Now sent: the status reflects the SENT stage.
    await expect(row.getByTestId('invoice-status')).toHaveText(/^sent$/i);

    // Exactly one record was kept for the send, naming the invoice and its amount — and only that one.
    await expect
      .poll(() => auditLines().filter((l) => /^INVOICE_SENT id=1 amount=120(\.0+)?$/.test(l)))
      .toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // Only now that it has been sent is payment offered; there is nothing left to send.
    await expect(page.getByTestId('invoice-pay-1')).toBeVisible();
    await expect(page.getByTestId('invoice-send-1')).toHaveCount(0);

    // And paying it still works: status -> PAID, with its own INVOICE_PAID record alongside the send.
    await page.getByTestId('invoice-pay-1').click();
    await expect(row.getByTestId('invoice-status')).toHaveText(/^paid$/i);

    await expect.poll(() => auditLines()).toHaveLength(2);
    const lines = auditLines();
    expect(lines.some((l) => /^INVOICE_SENT id=1 amount=120(\.0+)?$/.test(l))).toBe(true);
    expect(lines.some((l) => /^INVOICE_PAID id=1 amount=120(\.0+)?$/.test(l))).toBe(true);
  });

  test('a draft cannot be paid but an already-sent invoice can', async ({ page }) => {
    // Two invoices side by side: one still a DRAFT, one already SENT.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        { id: 1, projectId: 1, amount: 120, status: 'DRAFT' },
        { id: 2, projectId: 1, amount: 340, status: 'SENT' },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const draft = page.getByTestId('invoice-row-1');
    const sent = page.getByTestId('invoice-row-2');

    // The draft: sendable, not payable.
    await expect(draft.getByTestId('invoice-status')).toHaveText(/^draft$/i);
    await expect(page.getByTestId('invoice-send-1')).toBeVisible();
    await expect(page.getByTestId('invoice-pay-1')).toHaveCount(0);

    // The already-sent invoice: payable, with nothing left to send.
    await expect(sent.getByTestId('invoice-status')).toHaveText(/^sent$/i);
    await expect(page.getByTestId('invoice-pay-2')).toBeVisible();
    await expect(page.getByTestId('invoice-send-2')).toHaveCount(0);

    // Seeded straight into their stages — no send happened, so the audit file is empty.
    expect(auditLines()).toEqual([]);
  });

  test('sending one draft records its own line and leaves its siblings untouched', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        { id: 1, projectId: 1, amount: 120, status: 'DRAFT' },
        { id: 2, projectId: 1, amount: 340, status: 'DRAFT' },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const first = page.getByTestId('invoice-row-1');
    const second = page.getByTestId('invoice-row-2');

    // Send the first draft. It moves to SENT; the second is still a draft (untouched).
    await page.getByTestId('invoice-send-1').click();
    await expect(first.getByTestId('invoice-status')).toHaveText(/^sent$/i);
    await expect(second.getByTestId('invoice-status')).toHaveText(/^draft$/i);
    await expect(page.getByTestId('invoice-send-2')).toBeVisible();
    await expect(page.getByTestId('invoice-pay-2')).toHaveCount(0);

    // One record so far, for invoice 1 and its amount — and only that one.
    await expect
      .poll(() => auditLines().filter((l) => /^INVOICE_SENT id=1 amount=120(\.0+)?$/.test(l)))
      .toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // Now send the second draft too — a separate record is kept for it as well.
    await page.getByTestId('invoice-send-2').click();
    await expect(second.getByTestId('invoice-status')).toHaveText(/^sent$/i);

    await expect.poll(() => auditLines()).toHaveLength(2);
    const lines = auditLines();
    expect(lines.some((l) => /^INVOICE_SENT id=1 amount=120(\.0+)?$/.test(l))).toBe(true);
    expect(lines.some((l) => /^INVOICE_SENT id=2 amount=340(\.0+)?$/.test(l))).toBe(true);
  });
});
