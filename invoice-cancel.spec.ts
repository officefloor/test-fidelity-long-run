// Acceptance test for the change request:
//   "Let me cancel an invoice I sent by mistake. It should stop counting toward what I am owed.
//    Note it."
//
// An invoice that has been SENT can be cancelled — it was sent by mistake. On a project's detail
// page each invoice row offers a cancel control (invoice-cancel-<id>) while it is a candidate for
// cancelling (i.e. it has been sent); cancelling it:
//   - marks the invoice cancelled (its invoice-status cell no longer reads "sent"), which is held by
//     the server (survives a fresh load) and withdraws the cancel control (you cannot cancel twice);
//   - STOPS it counting toward what I am owed — the dashboard's money-owed figure
//     (dashboard-outstanding-<currency>, per currency; USD for the no-currency client seeded here),
//     which is the sum of the invoices I have SENT and not yet been paid for, drops by exactly that
//     invoice's amount; and
//   - KEEPS a record ("Note it"): exactly one audit record `INVOICE_VOIDED id=<id> amount=<amount>`
//     is appended per cancel.
// A DRAFT has not been sent, so it is not something I cancel-by-mistake: it offers no cancel control
// (only its send control). This pins the control to the SENT stage rather than hardwiring it on.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed (the app's /__test__ endpoint): `clients` honours
// { id, name, email }, `projects` honours { id, name, clientId } and `invoices` honours
// { id, amount, projectId, status }. Invoices are seeded with NO payments so each SENT invoice's
// worked-out status is plainly "SENT" (see invoice-paid.spec) and the stage being cancelled is
// unambiguous.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

// Each stage's status cell is matched by the WORD that names it, case-insensitively, so the test
// binds to the MEANING and not one capitalisation. "cancel|void" catches whichever word the app
// settles on for a cancelled invoice ("Cancelled"/"Canceled"/"Voided") — neither substring occurs in
// any of the live stages (draft / sent / paid / partial), so it discriminates cleanly.
const DRAFT = /\bdraft\b/i;
const SENT = /\bsent\b/i;
const CANCELLED = /cancel|void/i;

const invoiceRows = (page: Page) => page.locator('[data-testid^="invoice-row-"]');
const statusOf = (page: Page, id: number): Locator =>
  page.getByTestId(`invoice-row-${id}`).getByTestId('invoice-status');

// The kept record. The amount may be written bare (200) or with scale (200.00), so accept an optional
// fractional part; everything else is matched exactly.
const voidedRecord = (id: number, amount: number) =>
  new RegExp(`^INVOICE_VOIDED id=${id} amount=${amount}(\\.\\d+)?$`);
const linesMatching = (re: RegExp): string[] => auditLines().filter((line) => re.test(line));

// A money figure may be rendered bare (500) or dressed up ("$500.00"). Assert the figure CARRIES the
// expected number as a standalone token, so the test binds to the meaning rather than one
// presentation. The surrounding (^|\D)…(\D|$) keeps a smaller number from matching inside a larger
// one (500 must not satisfy a check for 50, nor 300 match inside 3000).
const asToken = (n: number) => new RegExp(`(^|\\D)${n}(\\D|$)`);
const shows = (cell: Locator, n: number) => expect(cell).toContainText(asToken(n));
const hides = (cell: Locator, n: number) => expect(cell).not.toContainText(asToken(n));

// The client carries no currency, so what is owed is owed in the default, USD, under
// dashboard-outstanding-USD.
const outstanding = (page: Page) => page.getByTestId('dashboard-outstanding-USD');

async function openProject(page: Page, id: number): Promise<void> {
  await page.goto(`/projects/${id}`);
  await expect(page.getByTestId('project-detail-page')).toBeVisible();
}

// Reach the dashboard the way a user would — follow its nav link from the home screen — rather than
// pinning the dashboard's URL.
async function openDashboard(page: Page): Promise<void> {
  await page.goto('/');
  const nav = page.getByTestId('nav-dashboard');
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
}

test.describe('Cancel an invoice sent by mistake', () => {
  test('a sent invoice offers a cancel control; cancelling it marks it cancelled and keeps a record', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 200, projectId: 1, status: 'SENT' }],
    });

    await openProject(page, 1);

    // It has been sent, so it offers a cancel control — and no send control (it is not a draft).
    await expect(statusOf(page, 1)).toHaveText(SENT);
    const cancel = page.getByTestId('invoice-cancel-1');
    await expect(cancel).toBeVisible();
    await expect(page.getByTestId('invoice-send-1')).toHaveCount(0);

    // Nothing has been recorded yet — reset clears the audit file, so the record below is proof the
    // cancel (not the seeding) wrote it.
    expect(auditLines()).toEqual([]);

    await cancel.click();

    // The invoice is now cancelled: its status no longer reads "sent", and the cancel control is gone
    // (you cannot cancel it a second time).
    await expect(statusOf(page, 1)).toHaveText(CANCELLED);
    await expect(statusOf(page, 1)).not.toHaveText(SENT);
    await expect(page.getByTestId('invoice-cancel-1')).toHaveCount(0);

    // Exactly one record was kept for this cancel, carrying the invoice's id and amount ("Note it").
    expect(linesMatching(voidedRecord(1, 200))).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // The cancelled state is held by the server, not just the page: it survives a fresh load, still
    // offering no cancel control, and reloading does not record the cancel again.
    await page.reload();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(statusOf(page, 1)).toHaveText(CANCELLED);
    await expect(statusOf(page, 1)).not.toHaveText(SENT);
    await expect(page.getByTestId('invoice-cancel-1')).toHaveCount(0);
    expect(linesMatching(voidedRecord(1, 200))).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);
  });

  test('a cancelled invoice stops counting toward what I am owed', async ({ page }) => {
    // Two SENT invoices awaiting payment: 200 + 300 = 500 owed. (A PAID one is already settled and a
    // DRAFT is not yet sent, so neither counts — included so the owed figure is a real subtotal.)
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 200, projectId: 1, status: 'SENT' },
        { id: 2, amount: 300, projectId: 1, status: 'SENT' },
        { id: 3, amount: 400, projectId: 1, status: 'PAID' },
        { id: 4, amount: 70, projectId: 1, status: 'DRAFT' },
      ],
    });

    // Before the cancel, the two sent invoices add up to the owed total: 500.
    await openDashboard(page);
    await shows(outstanding(page), 500);

    // Cancel the first sent invoice (200) — it was sent by mistake.
    await openProject(page, 1);
    const cancel = page.getByTestId('invoice-cancel-1');
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(statusOf(page, 1)).toHaveText(CANCELLED);

    // Back on the dashboard the owed figure has dropped by exactly that invoice's amount: now 300,
    // the one remaining sent invoice. It no longer counts the cancelled 200, nor the old 500.
    await openDashboard(page);
    await shows(outstanding(page), 300);
    await hides(outstanding(page), 500);
    await hides(outstanding(page), 200);

    // Exactly one record was kept, for the cancelled invoice.
    expect(linesMatching(voidedRecord(1, 200))).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);
  });

  test('only a sent invoice can be cancelled — a draft offers no cancel control', async ({ page }) => {
    // A DRAFT (not yet sent) alongside a SENT invoice. The draft is not something cancelled
    // by-mistake — it offers its send control and no cancel control; the sent invoice offers the
    // cancel control and no send control. This pins the cancel control to the SENT stage.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 100, projectId: 1, status: 'DRAFT' },
        { id: 2, amount: 250, projectId: 1, status: 'SENT' },
      ],
    });

    await openProject(page, 1);
    await expect(invoiceRows(page)).toHaveCount(2);

    // The draft: a send control, no cancel control.
    await expect(statusOf(page, 1)).toHaveText(DRAFT);
    await expect(page.getByTestId('invoice-send-1')).toBeVisible();
    await expect(page.getByTestId('invoice-cancel-1')).toHaveCount(0);

    // The sent invoice: a cancel control, no send control.
    await expect(statusOf(page, 2)).toHaveText(SENT);
    await expect(page.getByTestId('invoice-cancel-2')).toBeVisible();
    await expect(page.getByTestId('invoice-send-2')).toHaveCount(0);

    // Merely loading these invoices records nothing — a record is kept when a cancel happens.
    expect(auditLines()).toEqual([]);

    // Cancel the sent invoice: only it is affected, and exactly one record is kept for it.
    await page.getByTestId('invoice-cancel-2').click();
    await expect(statusOf(page, 2)).toHaveText(CANCELLED);
    await expect(statusOf(page, 1)).toHaveText(DRAFT);
    expect(linesMatching(voidedRecord(2, 250))).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);
  });
});
