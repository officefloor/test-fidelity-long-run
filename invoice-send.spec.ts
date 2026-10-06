// Acceptance test for the change request:
//   "Invoices should move through stages. First a draft. Then I send it. Keep a record when I send
//    one."
//
// An invoice moves through the stages DRAFT -> SENT. On a project's detail page each invoice shows its
// stage (invoice-status). While it is a DRAFT it offers a control to send it (invoice-send-<id>);
// sending flips the stage to SENT, persists across a fresh load, and — because the request wants a
// record kept when one is sent — appends exactly one audit record `INVOICE_SENT id=<id> amount=<amount>`
// per send. A newly created invoice starts as a DRAFT.
//
// (Whether a SENT invoice is then paid, part paid or still owing is worked out from its recorded
// payments — see invoice-paid.spec.ts; there is no by-hand "mark paid" step.)
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed (the app's /__test__ endpoint): `clients` honours
// { id, name, email }, `projects` honours { id, name, clientId } and `invoices` honours
// { id, amount, projectId, status }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

// Each stage's status cell is matched by the WORD that names the stage, case-insensitively, so the
// test binds to the MEANING and not one capitalisation ("Draft"/"DRAFT"/"draft" all count). The word
// boundaries keep the stages distinct from one another.
const DRAFT = /\bdraft\b/i;
const SENT = /\bsent\b/i;

const invoiceRows = (page: Page) => page.locator('[data-testid^="invoice-row-"]');
const statusOf = (page: Page, id: number): Locator =>
  page.getByTestId(`invoice-row-${id}`).getByTestId('invoice-status');

// The audit record. The amount may be written bare (100) or with scale (100.00), so accept an
// optional fractional part; everything else is matched exactly.
const sentRecord = (id: number, amount: number) =>
  new RegExp(`^INVOICE_SENT id=${id} amount=${amount}(\\.\\d+)?$`);

const linesMatching = (re: RegExp): string[] => auditLines().filter((line) => re.test(line));

test.describe('Invoices move through stages: draft → sent', () => {
  test('a draft offers a send control, and sending it flips the stage to sent', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 100, projectId: 1, status: 'DRAFT' }],
    });

    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    // It starts as a draft: it offers a send control.
    await expect(statusOf(page, 1)).toHaveText(DRAFT);
    const send = page.getByTestId('invoice-send-1');
    await expect(send).toBeVisible();

    // Nothing has been recorded yet — reset clears the audit file, so the record below is proof the
    // send (not the seeding) wrote it.
    expect(auditLines()).toEqual([]);

    await send.click();

    // The stage is now SENT: the send control is gone (it has already been sent).
    await expect(statusOf(page, 1)).toHaveText(SENT);
    await expect(page.getByTestId('invoice-send-1')).toHaveCount(0);

    // Exactly one record was kept for this send, carrying the invoice's id and amount.
    expect(linesMatching(sentRecord(1, 100))).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // The SENT stage is held by the server, not just the page: it survives a fresh load, still
    // offering no second send, and reloading does not record the send again.
    await page.reload();
    await expect(statusOf(page, 1)).toHaveText(SENT);
    await expect(page.getByTestId('invoice-send-1')).toHaveCount(0);
    expect(linesMatching(sentRecord(1, 100))).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);
  });

  test('sending one invoice records it and leaves the others as drafts', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 100, projectId: 1, status: 'DRAFT' },
        { id: 2, amount: 250, projectId: 1, status: 'DRAFT' },
      ],
    });

    await page.goto('/projects/1');
    await expect(invoiceRows(page)).toHaveCount(2);

    // Both start as drafts: each offers a send control.
    await expect(page.getByTestId('invoice-send-1')).toBeVisible();
    await expect(page.getByTestId('invoice-send-2')).toBeVisible();

    // Send the first invoice.
    await page.getByTestId('invoice-send-1').click();

    // Only that invoice advanced: it is SENT with no further send control; its sibling is still a
    // draft offering a send control.
    await expect(statusOf(page, 1)).toHaveText(SENT);
    await expect(page.getByTestId('invoice-send-1')).toHaveCount(0);
    await expect(statusOf(page, 2)).toHaveText(DRAFT);
    await expect(page.getByTestId('invoice-send-2')).toBeVisible();

    // Exactly one record so far, for the invoice that was sent.
    expect(linesMatching(sentRecord(1, 100))).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // Send the second invoice too — a record is kept for it as well.
    await page.getByTestId('invoice-send-2').click();
    await expect(statusOf(page, 2)).toHaveText(SENT);

    expect(linesMatching(sentRecord(1, 100))).toHaveLength(1);
    expect(linesMatching(sentRecord(2, 250))).toHaveLength(1);
    expect(auditLines()).toHaveLength(2);
  });

  test('a newly created invoice starts as a draft that can then be sent', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [],
    });

    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(invoiceRows(page)).toHaveCount(0);

    // Add a new invoice by giving it an amount.
    await page.getByTestId('invoice-form-amount').fill('300');
    await page.getByTestId('invoice-form-submit').click();

    // Its id is assigned by the server, so find the new row by the amount it carries and read its id.
    const addedRow = invoiceRows(page).filter({
      has: page.getByTestId('invoice-amount').getByText('300', { exact: false }),
    });
    await expect(addedRow).toHaveCount(1);
    const rowTestId = await addedRow.getAttribute('data-testid');
    const id = Number(rowTestId!.replace('invoice-row-', ''));

    // "First a draft": the new invoice is a draft — it offers a send control.
    await expect(addedRow.getByTestId('invoice-status')).toHaveText(DRAFT);
    await expect(page.getByTestId(`invoice-send-${id}`)).toBeVisible();

    // Merely creating a draft records nothing — the record is kept when it is SENT, not when raised.
    expect(auditLines()).toEqual([]);
  });

  test('an invoice already sent shows no further send control', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 100, projectId: 1, status: 'DRAFT' },
        { id: 2, amount: 200, projectId: 1, status: 'SENT' },
      ],
    });

    await page.goto('/projects/1');
    await expect(invoiceRows(page)).toHaveCount(2);

    // Seeded as DRAFT: it offers a send control.
    await expect(statusOf(page, 1)).toHaveText(DRAFT);
    await expect(page.getByTestId('invoice-send-1')).toBeVisible();

    // Seeded as SENT: it has already been sent, so no further send control is offered.
    await expect(statusOf(page, 2)).toHaveText(SENT);
    await expect(page.getByTestId('invoice-send-2')).toHaveCount(0);

    // Merely loading these invoices records nothing — a record is kept when a send happens.
    expect(auditLines()).toEqual([]);
  });
});
