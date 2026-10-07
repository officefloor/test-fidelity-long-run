// Acceptance test for the change request:
//   "Let me add notes to invoices too. Not just jobs."
//
// Notes — already written against a project (a "job") — can now also be written against an INVOICE.
// On an invoice's own detail page (invoice-detail-page, the child route /invoices/<id>) the notes
// live in their own region (invoice-notes): an invoice with at least one note shows the list
// (invoice-notes-list) and each note is its own row (note-row-<id>, keyed by the note's id) carrying
// its text (note-text); an invoice with no notes shows an empty state (invoice-notes-empty) instead
// of the list. The region offers a form (note-form) to write a new note: its text field is
// note-form-text and it is submitted with note-form-submit.
//
// The notes are shown NEWEST FIRST — ordered by when each was written (the note's `at`), most recent
// at the top, independent of the order the rows were created or their ids. A freshly written note is
// the most recent, so it appears at the top of the list.
//
// A note belongs to ITS target: an invoice's notes are the notes whose target is THIS invoice — a
// note on a different invoice, or a note on a project (a job), or a note on something else entirely,
// is not shown here. This mirrors exactly how project notes are scoped (see project-notes.spec.ts);
// an invoice note's target is targetType 'invoice', targetId the invoice's id — the SAME lowercase
// target-type string the shipped notes feature queries and writes with (features/projects/notes.ts
// uses 'project'); the seed stores the string verbatim and the list is read back by an exact match,
// so the case must agree.
//
// Writing / viewing notes is NOT audited (this change introduces no audit record), so the audit file
// stays empty throughout.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed (the app's /__test__ endpoint): `clients` honours
// { id, name, email }, `projects` honours { id, name, clientId }, `invoices` honours
// { id, amount, projectId, status } and `notes` honours { id, targetType, targetId, text, at } —
// `targetType`/`targetId` say what the note is ON and `at` is when it was written, used to order
// newest first.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

const noteRows = (page: Page): Locator => page.locator('[data-testid^="note-row-"]');

// Each row's text, resolved in DOM order — so `toHaveText([...])` on this asserts both the exact set
// of notes shown AND the order they are shown in (newest first).
const noteTexts = (page: Page): Locator => noteRows(page).getByTestId('note-text');

// The row carrying a given note text, regardless of its server-assigned id. Texts in each test are
// chosen distinct (none a substring of another) so this is unambiguous.
const rowByText = (page: Page, text: string): Locator => noteRows(page).filter({ hasText: text });

async function gotoInvoice(page: Page, id: number): Promise<void> {
  await page.goto(`/invoices/${id}`);
  await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
  await expect(page.getByTestId('invoice-notes')).toBeVisible();
}

test.describe('Notes on an invoice, newest first', () => {
  test('an invoice with no notes shows an empty state, not the list', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 500, projectId: 1, status: 'SENT' },
        { id: 2, amount: 800, projectId: 1, status: 'SENT' },
      ],
      // A note on a DIFFERENT invoice — invoice 1 still has none of its own.
      notes: [
        {
          id: 1,
          targetType: 'invoice',
          targetId: 2,
          text: 'Belongs to the other invoice',
          at: '2026-03-01T09:00:00Z',
        },
      ],
    });

    await gotoInvoice(page, 1);

    // No notes on this invoice: the empty state shows, the list and rows do not.
    await expect(page.getByTestId('invoice-notes-empty')).toBeVisible();
    await expect(noteRows(page)).toHaveCount(0);
    await expect(page.getByTestId('invoice-notes-list')).toHaveCount(0);
    // The other invoice's note is nowhere on this page.
    await expect(page.getByTestId('invoice-notes')).not.toContainText('Belongs to the other invoice');

    // Notes are not audited — nothing has been recorded.
    expect(auditLines()).toEqual([]);
  });

  test("an invoice shows its own notes newest first, and not notes on something else", async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 500, projectId: 1, status: 'SENT' },
        { id: 2, amount: 800, projectId: 1, status: 'SENT' },
      ],
      // Three notes on invoice 1 whose `at` order (newest → oldest = 2, 3, 1) deliberately differs
      // from both their id order and the order they are listed in the fixture, so the assertion binds
      // to "newest first by `at`" and not to insertion or id order.
      notes: [
        {
          id: 1,
          targetType: 'invoice',
          targetId: 1,
          text: 'Oldest: emailed the client',
          at: '2026-01-10T09:00:00Z',
        },
        {
          id: 2,
          targetType: 'invoice',
          targetId: 1,
          text: 'Newest: client promised payment Friday',
          at: '2026-09-20T09:00:00Z',
        },
        {
          id: 3,
          targetType: 'invoice',
          targetId: 1,
          text: 'Middle: phoned about the overdue balance',
          at: '2026-05-15T09:00:00Z',
        },
        // A note on a DIFFERENT invoice (even though its `at` is the most recent of all) must not
        // appear on invoice 1's list, nor be pulled to the top by its recency.
        {
          id: 4,
          targetType: 'invoice',
          targetId: 2,
          text: 'On the other invoice',
          at: '2026-12-31T09:00:00Z',
        },
        // A note on a PROJECT (a "job") — same id-space, different target type — is not an invoice
        // note, including one whose targetId collides with this invoice's id (1). It must not show.
        {
          id: 5,
          targetType: 'project',
          targetId: 1,
          text: 'On the job, not the invoice',
          at: '2026-11-01T09:00:00Z',
        },
      ],
    });

    await gotoInvoice(page, 1);
    await expect(page.getByTestId('invoice-notes-list')).toBeVisible();
    await expect(page.getByTestId('invoice-notes-empty')).toHaveCount(0);

    // Only this invoice's three notes are shown, each keyed by its id and carrying its text.
    await expect(noteRows(page)).toHaveCount(3);
    await expect(page.getByTestId('note-row-1').getByTestId('note-text')).toHaveText(
      'Oldest: emailed the client',
    );
    await expect(page.getByTestId('note-row-2').getByTestId('note-text')).toHaveText(
      'Newest: client promised payment Friday',
    );
    await expect(page.getByTestId('note-row-3').getByTestId('note-text')).toHaveText(
      'Middle: phoned about the overdue balance',
    );

    // Shown NEWEST FIRST: by `at`, that is note 2, then note 3, then note 1.
    await expect(noteTexts(page)).toHaveText([
      'Newest: client promised payment Friday',
      'Middle: phoned about the overdue balance',
      'Oldest: emailed the client',
    ]);

    // Notes on other targets are nowhere on this page.
    await expect(page.getByTestId('note-row-4')).toHaveCount(0);
    await expect(page.getByTestId('note-row-5')).toHaveCount(0);
    await expect(page.getByTestId('invoice-notes')).not.toContainText('On the other invoice');
    await expect(page.getByTestId('invoice-notes')).not.toContainText('On the job, not the invoice');

    // Merely viewing notes records nothing.
    expect(auditLines()).toEqual([]);
  });

  test('writing a note adds it to the top (newest first) and it persists', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 500, projectId: 1, status: 'SENT' }],
      // Two existing notes, both written in the past (older than a note written now).
      notes: [
        {
          id: 1,
          targetType: 'invoice',
          targetId: 1,
          text: 'Issued the invoice',
          at: '2026-02-01T09:00:00Z',
        },
        {
          id: 2,
          targetType: 'invoice',
          targetId: 1,
          text: 'Sent the first reminder',
          at: '2026-07-01T09:00:00Z',
        },
      ],
    });

    await gotoInvoice(page, 1);

    // Starts with the two seeded notes, newest first (the reminder, then the issuing).
    await expect(noteTexts(page)).toHaveText(['Sent the first reminder', 'Issued the invoice']);

    // Nothing has been recorded — reset clears the audit file; writing a note must not add to it.
    expect(auditLines()).toEqual([]);

    // Write a new note.
    await expect(page.getByTestId('note-form')).toBeVisible();
    await page.getByTestId('note-form-text').fill('Client paid in full');
    await page.getByTestId('note-form-submit').click();

    // It joins the list as its own row (its id is server-assigned, so locate it by its text) and,
    // being the most recently written, sits at the TOP of the newest-first list.
    const newRow = rowByText(page, 'Client paid in full');
    await expect(newRow).toHaveCount(1);
    await expect(newRow.getByTestId('note-text')).toHaveText('Client paid in full');
    await expect(noteRows(page)).toHaveCount(3);
    await expect(noteTexts(page)).toHaveText([
      'Client paid in full',
      'Sent the first reminder',
      'Issued the invoice',
    ]);

    // Still not audited.
    expect(auditLines()).toEqual([]);

    // The note is held by the server, not just the page: it survives a fresh load, keeping its place
    // at the top of the newest-first list.
    await page.reload();
    await expect(page.getByTestId('invoice-notes')).toBeVisible();
    await expect(noteRows(page)).toHaveCount(3);
    await expect(noteTexts(page)).toHaveText([
      'Client paid in full',
      'Sent the first reminder',
      'Issued the invoice',
    ]);
    expect(auditLines()).toEqual([]);
  });

  test('a note written onto an empty invoice replaces the empty state with the list', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 500, projectId: 1, status: 'SENT' }],
      notes: [],
    });

    await gotoInvoice(page, 1);

    // Nothing yet: the empty state is shown, not the list.
    await expect(page.getByTestId('invoice-notes-empty')).toBeVisible();
    await expect(noteRows(page)).toHaveCount(0);

    // Write the invoice's first note.
    await page.getByTestId('note-form-text').fill('First note on this invoice');
    await page.getByTestId('note-form-submit').click();

    // The list now shows the one note, and the empty state is gone.
    await expect(page.getByTestId('invoice-notes-list')).toBeVisible();
    await expect(page.getByTestId('invoice-notes-empty')).toHaveCount(0);
    await expect(noteRows(page)).toHaveCount(1);
    await expect(noteTexts(page)).toHaveText(['First note on this invoice']);

    // It persists across a fresh load, and nothing was audited.
    await page.reload();
    await expect(page.getByTestId('invoice-notes-list')).toBeVisible();
    await expect(noteTexts(page)).toHaveText(['First note on this invoice']);
    expect(auditLines()).toEqual([]);
  });
});
