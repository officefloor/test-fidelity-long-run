// Acceptance tests for the change request:
//   "Invoices should move through stages. First a draft. Then I send it. Then it gets paid. Keep a
//    record when I send one. Only let me take payment once it has been sent."
//
// An invoice starts as a DRAFT. A draft offers a control to SEND it (invoice-send-<id>); sending
// flips THAT invoice's status to SENT and appends one audit record — INVOICE_SENT id=<id>
// amount=<amount> — so the send can be checked back later (the UI only shows the status). Once an
// invoice is SENT there is nothing left to send, so the send control is gone.
//
// NOTE: the final "then it gets paid" stage is no longer reached by a by-hand control. A later change
// ("Work out whether an invoice is paid, part paid or still owing. ... I do not want to flip it to
// paid by hand anymore.") removed the mark-paid button and now WORKS the paid status OUT from the
// payments recorded against the invoice — so this spec no longer drives or asserts a mark-paid flow.
// Being worked out as paid / part paid / still owing from payments is covered by
// invoice-status-panel.spec.ts.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed; the send flow is driven through the UI.
// Seed honours invoices: { id, projectId, amount, status } — status is seeded to place an invoice at
// a chosen stage ('DRAFT' / 'SENT' / 'PAID').
//
// Status labels are asserted case-insensitively (/^draft$/i, /^sent$/i) so the test tolerates
// whichever casing the feature renders. The audit amount is matched with an optional trailing ".00"
// so a plain or two-decimal rendering both pass. Amounts are distinct whole numbers so no value is a
// substring of another. This test SHOULD FAIL before the change: today a freshly created invoice has
// no send control.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

test.describe('invoice stages: draft -> sent -> paid', () => {
  test('a newly created invoice is a draft that can be sent', async ({ page }) => {
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

    // A draft can be sent.
    await expect(page.getByTestId('invoice-send-1')).toBeVisible();
  });

  test('sending a draft moves it to sent and keeps a record', async ({ page }) => {
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

    // Starts as a draft: a send control is offered.
    await expect(row.getByTestId('invoice-status')).toHaveText(/^draft$/i);
    await expect(page.getByTestId('invoice-send-1')).toBeVisible();

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

    // Now that it has been sent, there is nothing left to send.
    await expect(page.getByTestId('invoice-send-1')).toHaveCount(0);
  });

  test('a draft offers a send control; an already-sent invoice has nothing left to send', async ({ page }) => {
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

    // The draft: sendable.
    await expect(draft.getByTestId('invoice-status')).toHaveText(/^draft$/i);
    await expect(page.getByTestId('invoice-send-1')).toBeVisible();

    // The already-sent invoice: nothing left to send.
    await expect(sent.getByTestId('invoice-status')).toHaveText(/^sent$/i);
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
