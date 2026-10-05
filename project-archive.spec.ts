// Acceptance tests for the change request:
//   "Do not really delete a project. Just tuck it away so it drops off my lists. Keep it off the
//    main project list and off the list on the client's page. I do not want to lose anything.
//    Note it when I do."
//
// ARCHIVING is a soft hide, NOT a real delete (that is the separate project-delete feature, which
// still removes the row for good). Each project in the projects list offers a control to ARCHIVE it
// (project-archive-<id>). Archiving a project:
//   - drops it off the MAIN projects list (projects-page), leaving its siblings untouched;
//   - drops it off the list on the CLIENT'S page (client-projects-table) too;
//   - loses NOTHING — a projects-show-archived toggle on the projects page reveals the archived
//     projects again, still carrying their names;
//   - appends exactly one audit record — PROJECT_ARCHIVED id=<id> — so the act is noted (the UI
//     only stops showing the project in the default view; it cannot show that it was archived).
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed; the archive is driven through the UI. Seed
// honours clients: { id, name, email } and projects: { id, clientId, name, archived } — `archived`
// places a project directly in the tucked-away state so the hiding can be checked without a click.
//
// This SHOULD FAIL before the change: today a project row has no archive control, there is no
// projects-show-archived toggle, and nothing is recorded when a project is tucked away.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

test.describe('archive a project instead of deleting it', () => {
  test('archiving drops a project off the main list, keeps a record, and loses nothing', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign' },
        { id: 2, clientId: 1, name: 'Warehouse automation' },
      ],
    });

    await page.goto('/projects');
    await expect(page.getByTestId('projects-page')).toBeVisible();

    const first = page.getByTestId('project-row-1');
    const second = page.getByTestId('project-row-2');
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();

    // reset cleared the audit file — nothing has been archived yet.
    expect(auditLines()).toEqual([]);

    // Tuck the first project away.
    await page.getByTestId('project-archive-1').click();

    // It drops off the default list; its sibling is untouched.
    await expect(first).toHaveCount(0);
    await expect(second).toBeVisible();
    await expect(second.getByTestId('project-name')).toHaveText('Warehouse automation');

    // Exactly one record was kept, naming the archived project — and only that one (not DELETED).
    await expect.poll(() => auditLines()).toEqual(['PROJECT_ARCHIVED id=1']);

    // Nothing was lost: revealing archived projects brings it back, name intact.
    await page.getByTestId('projects-show-archived').click();
    await expect(first).toBeVisible();
    await expect(first.getByTestId('project-name')).toHaveText('Website redesign');
    await expect(second).toBeVisible();

    // Revealing is a read — it does not record anything new.
    await expect.poll(() => auditLines()).toEqual(['PROJECT_ARCHIVED id=1']);
  });

  test('an already-archived project is hidden by default and revealed by the toggle', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign', archived: false },
        // Already tucked away — it must not show in the default list.
        { id: 2, clientId: 1, name: 'Warehouse automation', archived: true },
      ],
    });

    await page.goto('/projects');
    await expect(page.getByTestId('projects-page')).toBeVisible();

    // Default view: only the live project; the archived one is hidden, but the list is not empty.
    await expect(page.getByTestId('project-row-1')).toBeVisible();
    await expect(page.getByTestId('project-row-2')).toHaveCount(0);
    await expect(page.getByTestId('projects-empty')).toHaveCount(0);

    // Reveal archived: the tucked-away project appears, still carrying its name.
    await page.getByTestId('projects-show-archived').click();
    await expect(page.getByTestId('project-row-2')).toBeVisible();
    await expect(page.getByTestId('project-row-2').getByTestId('project-name')).toHaveText('Warehouse automation');
    await expect(page.getByTestId('project-row-1')).toBeVisible();

    // The toggle genuinely reads the choice: turning it back off hides the archived project again.
    await page.getByTestId('projects-show-archived').click();
    await expect(page.getByTestId('project-row-2')).toHaveCount(0);
    await expect(page.getByTestId('project-row-1')).toBeVisible();
  });

  test("an archived project drops off the client's page, leaving the client's live projects", async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example' },
        { id: 2, name: 'Globex', email: 'hello@globex.example' },
      ],
      projects: [
        // Client 1's own projects: one tucked away, one still live.
        { id: 1, clientId: 1, name: 'Website redesign', archived: true },
        { id: 2, clientId: 1, name: 'Mobile app', archived: false },
        // Belongs to a different client — never on client 1's page regardless.
        { id: 3, clientId: 2, name: 'Warehouse automation', archived: false },
      ],
    });

    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-projects-table')).toBeVisible();
    await expect(page.getByTestId('client-projects-empty')).toHaveCount(0);

    // The archived project is kept off the client's list; the live one remains.
    await expect(page.getByTestId('project-row-1')).toHaveCount(0);
    await expect(page.getByTestId('project-row-2')).toBeVisible();
    await expect(page.getByTestId('project-row-2').getByTestId('project-name')).toHaveText('Mobile app');

    // The other client's project is not here either; only the one live project shows.
    await expect(page.getByTestId('project-row-3')).toHaveCount(0);
    await expect(page.getByTestId('project-name')).toHaveCount(1);
  });

  test('archiving a project via the UI drops it off the client page too, and records it', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign' },
        { id: 2, clientId: 1, name: 'Mobile app' },
      ],
    });

    // Archive project 1 from the projects list.
    await page.goto('/projects');
    await expect(page.getByTestId('project-row-1')).toBeVisible();
    await page.getByTestId('project-archive-1').click();
    await expect(page.getByTestId('project-row-1')).toHaveCount(0);

    // On the client's own page it is gone too; the client's other project stays.
    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();
    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-projects-table')).toBeVisible();
    await expect(page.getByTestId('project-row-1')).toHaveCount(0);
    await expect(page.getByTestId('project-row-2')).toBeVisible();
    await expect(page.getByTestId('project-row-2').getByTestId('project-name')).toHaveText('Mobile app');
    await expect(page.getByTestId('project-name')).toHaveCount(1);

    // The act was noted, exactly once.
    await expect.poll(() => auditLines()).toEqual(['PROJECT_ARCHIVED id=1']);
  });
});
