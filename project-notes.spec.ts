// Acceptance tests for the change request:
//   "Let me write notes on a project. Show the newest one first."
//
// A project now keeps free-text NOTES. Opening a project (project-open-<id> from the projects list)
// reaches its detail page, which shows a notes region (project-notes) holding THAT project's notes in
// a list (project-notes-list) — one row per note (note-row-<id>) showing the note's text (note-text).
// Notes are ordered NEWEST FIRST: the most recently written note appears at the top of the list,
// regardless of the order the rows were created or seeded. A project with no notes shows an empty
// state (project-notes-empty). A form (note-form) writes a new note: type the text into note-form-text
// and submit it with note-form-submit — the note then appears in the list, and because it is the
// newest it appears first.
//
// Asserts ONLY through the two public channels: here just the UI (data-testid) — this change records
// nothing to the audit file. Data is arranged via resetAndSeed, which honours
// notes: { id, targetId, targetType, text, at }. Notes are polymorphic (targetType/targetId); a note
// that belongs to a project is targetType 'PROJECT' with targetId = the project's id, following the
// codebase's UPPERCASE string-enum convention (DRAFT/SENT/PAID/UNPAID). `at` is the time the note was
// written, as an ISO-8601 timestamp; it is what "newest first" sorts on. The project detail page is
// reached the same way the project-tasks / project-tags specs reach it: /projects then
// project-open-<id>.
//
// This SHOULD FAIL before the change: today a project's detail page has no notes region and no way to
// write a note.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('write notes on a project, newest first', () => {
  test("a project shows its own notes newest-first, and other projects' notes do not leak in", async ({
    page,
  }) => {
    // Three notes on project 1, deliberately seeded OUT of newest-first order and with ids that do NOT
    // match the time order — so the test can only pass if the list sorts by `at`, not by id or by seed
    // order. Note 4 belongs to project 2 and must not appear on project 1's page.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign' },
        { id: 2, clientId: 1, name: 'Mobile app' },
      ],
      notes: [
        { id: 1, targetType: 'PROJECT', targetId: 1, at: '2024-03-10T09:00:00Z', text: 'Kickoff meeting notes' }, // middle
        { id: 2, targetType: 'PROJECT', targetId: 1, at: '2024-05-20T09:00:00Z', text: 'Final review' }, // newest
        { id: 3, targetType: 'PROJECT', targetId: 1, at: '2024-01-05T09:00:00Z', text: 'Initial brief' }, // oldest
        { id: 4, targetType: 'PROJECT', targetId: 2, at: '2024-06-01T09:00:00Z', text: 'Other project note' },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const notes = page.getByTestId('project-notes');
    await expect(notes).toBeVisible();
    const list = page.getByTestId('project-notes-list');
    await expect(list).toBeVisible();
    // There are notes, so this project is not in the empty state.
    await expect(page.getByTestId('project-notes-empty')).toHaveCount(0);

    // Each of project 1's notes is a row keyed by the note's id, carrying that note's text.
    await expect(page.getByTestId('note-row-1').getByTestId('note-text')).toHaveText('Kickoff meeting notes');
    await expect(page.getByTestId('note-row-2').getByTestId('note-text')).toHaveText('Final review');
    await expect(page.getByTestId('note-row-3').getByTestId('note-text')).toHaveText('Initial brief');

    // Project 2's note does not leak into project 1's list.
    await expect(page.getByTestId('note-row-4')).toHaveCount(0);
    await expect(list).not.toContainText('Other project note');

    // Newest first: Final review (2024-05-20) then Kickoff (2024-03-10) then Initial brief (2024-01-05).
    // toHaveText with an array pins both the exact set and its DOM order.
    await expect(list.getByTestId('note-text')).toHaveText([
      'Final review',
      'Kickoff meeting notes',
      'Initial brief',
    ]);
  });

  test('a project with no notes shows an empty state and no note rows', async ({ page }) => {
    // The project exists, so the page can only be empty of NOTES, not of everything.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      notes: [],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    await expect(page.getByTestId('project-notes')).toBeVisible();
    await expect(page.getByTestId('project-notes-empty')).toBeVisible();
    await expect(page.getByTestId('note-text')).toHaveCount(0);
  });

  test('writing a note adds it to the project and shows the newest one first', async ({ page }) => {
    // One existing note written long ago, so anything written now is unambiguously newer than it
    // (years apart — no dependence on sub-second ordering) and must sort above it.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      notes: [
        { id: 1, targetType: 'PROJECT', targetId: 1, at: '2020-01-01T00:00:00Z', text: 'Old existing note' },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const list = page.getByTestId('project-notes-list');
    // The existing note is shown to begin with.
    await expect(list.getByTestId('note-text')).toHaveText(['Old existing note']);

    // Write a new note through the form.
    await expect(page.getByTestId('note-form')).toBeVisible();
    await page.getByTestId('note-form-text').fill('A fresh thought');
    await page.getByTestId('note-form-submit').click();

    // It appears in the list, and because it is the newest it sits above the old one.
    await expect(list.getByTestId('note-text')).toHaveText(['A fresh thought', 'Old existing note']);
  });
});
