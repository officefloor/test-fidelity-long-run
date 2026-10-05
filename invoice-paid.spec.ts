// Acceptance tests for the change request:
//   "Let me mark an invoice as paid. Keep a record every time I do so I can check back later."
//
// On a project's detail page each invoice shows its status (invoice-status) and offers a control to
// mark it paid (invoice-pay-<id>). Marking an invoice paid flips THAT invoice's status to paid and
// appends one audit record — INVOICE_PAID id=<id> amount=<amount> — so the action can be checked
// back later. Marking one invoice must not touch its siblings, and each marking writes its own
// record ("every time I do").
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed; the pay flow is driven through the UI.
// Seed honours invoices: { id, projectId, amount, status }.
//
// The paid label is asserted case-insensitively (/^paid$/i) so the test tolerates whichever casing
// the feature renders (Paid / PAID / paid). The audit amount is matched with an optional trailing
// ".00" so a plain or two-decimal rendering both pass. Amounts are chosen as distinct whole numbers
// so no value is a substring of another.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

test.describe('mark invoice paid', () => {
  test('marking an unpaid invoice paid flips its status and records it', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [{ id: 1, projectId: 1, amount: 120, status: 'UNPAID' }],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();

    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const row = page.getByTestId('invoice-row-1');
    await expect(row).toBeVisible();
    // The invoice surfaces a status, and a control to mark it paid.
    await expect(row.getByTestId('invoice-status')).toBeVisible();
    await expect(page.getByTestId('invoice-pay-1')).toBeVisible();

    // reset cleared the audit file — nothing has been marked paid yet.
    expect(auditLines()).toEqual([]);

    await page.getByTestId('invoice-pay-1').click();

    // The invoice's status reflects that it is now paid.
    await expect(row.getByTestId('invoice-status')).toHaveText(/^paid$/i);

    // And exactly one record was kept for the action, naming the invoice and its amount.
    await expect
      .poll(() => auditLines().filter((l) => /^INVOICE_PAID id=1 amount=120(\.0+)?$/.test(l)))
      .toHaveLength(1);
    expect(auditLines()).toHaveLength(1);
  });

  test('keeps a separate record each time, and marking one leaves the others untouched', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        { id: 1, projectId: 1, amount: 120, status: 'UNPAID' },
        { id: 2, projectId: 1, amount: 80, status: 'UNPAID' },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const first = page.getByTestId('invoice-row-1');
    const second = page.getByTestId('invoice-row-2');

    // Mark the first invoice paid. Its status flips; the second is still payable (untouched).
    await page.getByTestId('invoice-pay-1').click();
    await expect(first.getByTestId('invoice-status')).toHaveText(/^paid$/i);
    await expect(second.getByTestId('invoice-status')).not.toHaveText(/^paid$/i);
    await expect(page.getByTestId('invoice-pay-2')).toBeVisible();

    // One record so far, for invoice 1 and its amount — and only that one.
    await expect
      .poll(() => auditLines().filter((l) => /^INVOICE_PAID id=1 amount=120(\.0+)?$/.test(l)))
      .toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // Now mark the second invoice paid too — a separate record is kept for it as well.
    await page.getByTestId('invoice-pay-2').click();
    await expect(second.getByTestId('invoice-status')).toHaveText(/^paid$/i);

    await expect.poll(() => auditLines()).toHaveLength(2);
    const lines = auditLines();
    expect(lines.some((l) => /^INVOICE_PAID id=1 amount=120(\.0+)?$/.test(l))).toBe(true);
    expect(lines.some((l) => /^INVOICE_PAID id=2 amount=80(\.0+)?$/.test(l))).toBe(true);
  });
});
