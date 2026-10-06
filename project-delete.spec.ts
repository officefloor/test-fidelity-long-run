// Acceptance test for the change request:
//   "Let me delete a project I no longer need. Keep a record that I did."
//
// The projects list offers, per project, a control to delete it (project-delete-<id>). Deleting a
// project removes it from the list, the removal is held by the SERVER (it survives a fresh load),
// and — because the request wants a record kept — each deletion appends exactly one audit record
// `PROJECT_DELETED id=<id>`. Deleting one project must not touch its siblings, and merely viewing
// the list records nothing.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed (the app's /__test__ endpoint): `clients`
// honours { id, name, email } and `projects` honours { id, name, clientId }.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

const projectRows = (page: Page) => page.locator('[data-testid^="project-row-"]');

// The audit record for one deletion — carries the project's id and nothing else; matched exactly.
const deletedRecord = (id: number) => `PROJECT_DELETED id=${id}`;

const deletedRecordsFor = (id: number): string[] =>
  auditLines().filter((line) => line === deletedRecord(id));

test.describe('Delete a project', () => {
  test('deleting a project removes it from the list, persists, and records it once', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
    });

    await page.goto('/projects');
    await expect(page.getByTestId('projects-page')).toBeVisible();

    // The project is listed and offers a control to delete it.
    await expect(projectRows(page)).toHaveCount(1);
    await expect(page.getByTestId('project-row-1')).toBeVisible();
    const del = page.getByTestId('project-delete-1');
    await expect(del).toBeVisible();

    // Nothing has been recorded yet — reset clears the audit file, so the record below is proof the
    // deletion (not the seeding) wrote it.
    expect(auditLines()).toEqual([]);

    await del.click();

    // The project is gone from the list.
    await expect(page.getByTestId('project-row-1')).toHaveCount(0);
    await expect(projectRows(page)).toHaveCount(0);
    await expect(page.getByTestId('projects-empty')).toBeVisible();

    // And exactly one record was kept for this deletion, carrying the project's id.
    expect(deletedRecordsFor(1)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // The removal is held by the server, not just the page: it survives a fresh load, and reloading
    // does not record the deletion a second time.
    await page.reload();
    await expect(page.getByTestId('project-row-1')).toHaveCount(0);
    await expect(page.getByTestId('projects-empty')).toBeVisible();
    expect(deletedRecordsFor(1)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);
  });

  test('deleting one project leaves the others untouched, and each deletion keeps its own record', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      projects: [
        { id: 1, name: 'Website Redesign', clientId: 1 },
        { id: 2, name: 'Mobile App', clientId: 2 },
        { id: 3, name: 'Billing System', clientId: 1 },
      ],
    });

    await page.goto('/projects');
    await expect(projectRows(page)).toHaveCount(3);
    expect(auditLines()).toEqual([]);

    // Delete the middle project.
    await page.getByTestId('project-delete-2').click();

    // Only that project is gone; its siblings remain, each still carrying its own name and client.
    await expect(page.getByTestId('project-row-2')).toHaveCount(0);
    await expect(projectRows(page)).toHaveCount(2);
    await expect(page.getByTestId('project-row-1').getByTestId('project-name')).toHaveText(
      'Website Redesign',
    );
    await expect(page.getByTestId('project-row-1').getByTestId('project-client')).toHaveText(
      'Acme Corp',
    );
    await expect(page.getByTestId('project-row-3').getByTestId('project-name')).toHaveText(
      'Billing System',
    );

    // Exactly one record so far, for the project that was deleted.
    expect(deletedRecordsFor(2)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // Delete another project — a second record is kept, independent of the first.
    await page.getByTestId('project-delete-1').click();
    await expect(page.getByTestId('project-row-1')).toHaveCount(0);
    await expect(projectRows(page)).toHaveCount(1);
    await expect(page.getByTestId('project-row-3')).toBeVisible();

    expect(deletedRecordsFor(2)).toHaveLength(1);
    expect(deletedRecordsFor(1)).toHaveLength(1);
    expect(auditLines()).toHaveLength(2);

    // The removals survive a fresh load: only the undeleted project remains.
    await page.reload();
    await expect(projectRows(page)).toHaveCount(1);
    await expect(page.getByTestId('project-row-3')).toBeVisible();
    await expect(page.getByTestId('project-row-1')).toHaveCount(0);
    await expect(page.getByTestId('project-row-2')).toHaveCount(0);
    expect(auditLines()).toHaveLength(2);
  });

  test('merely viewing the projects list records nothing', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
    });

    await page.goto('/projects');
    await expect(page.getByTestId('project-row-1')).toBeVisible();

    // The record is kept when a deletion happens, not on every view.
    expect(auditLines()).toEqual([]);
  });
});
