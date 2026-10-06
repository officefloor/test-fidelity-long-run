// Acceptance test for the change request:
//   "Let me tuck away clients I no longer work with. They should drop off my list and my search.
//    I do not want to lose them. Note it when I do."
//
// Archiving a client is a NON-destructive "tuck away". Each client row on the clients list offers a
// control to archive it (client-archive-<id>). Archiving:
//   * drops the client from the clients list (clients-table / client-row-<id>),
//   * drops it from the name search too (it never comes back as a search result),
//   * is held by the SERVER (it survives a fresh load),
//   * keeps a record — exactly one audit record `CLIENT_ARCHIVED id=<id>` per archive,
//   * LOSES NOTHING: the client still exists — its detail page is still reachable at /clients/<id>
//     with its data intact (the request is "drop off my list and my search", not "delete").
// Archiving one client must not touch the others, and merely viewing or searching the list records
// nothing — only the archive action itself does.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed (the app's /__test__ endpoint): `clients`
// honours { id, name, email, archived } and `projects` honours { id, name, clientId }.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

const clientRows = (page: Page) => page.locator('[data-testid^="client-row-"]');

// The audit record for one archive — carries the client's id and nothing else; matched exactly.
const archivedRecord = (id: number) => `CLIENT_ARCHIVED id=${id}`;

const archivedRecordsFor = (id: number): string[] =>
  auditLines().filter((line) => line === archivedRecord(id));

test.describe('Archive a client', () => {
  test('archiving a client drops it from the list, persists, keeps the client, and records it once', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      // A project for this client — kept so we can prove the client itself is NOT lost afterwards.
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
    });

    await page.goto('/clients');
    await expect(page.getByTestId('clients-page')).toBeVisible();

    // The client is listed and offers a control to archive it.
    await expect(clientRows(page)).toHaveCount(1);
    await expect(page.getByTestId('client-row-1')).toBeVisible();
    const archive = page.getByTestId('client-archive-1');
    await expect(archive).toBeVisible();

    // Nothing has been recorded yet — reset clears the audit file, so the record below is proof the
    // archiving (not the seeding) wrote it.
    expect(auditLines()).toEqual([]);

    await archive.click();

    // The client drops off the list — tucked away, it is the only client so the list is now empty.
    await expect(page.getByTestId('client-row-1')).toHaveCount(0);
    await expect(clientRows(page)).toHaveCount(0);
    await expect(page.getByTestId('clients-empty')).toBeVisible();

    // Exactly one record was kept for this archive, carrying the client's id.
    expect(archivedRecordsFor(1)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // The tuck-away is held by the server, not just the page: it survives a fresh load, and merely
    // viewing the list does not record the archive a second time.
    await page.reload();
    await expect(page.getByTestId('client-row-1')).toHaveCount(0);
    await expect(page.getByTestId('clients-empty')).toBeVisible();
    expect(archivedRecordsFor(1)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // Nothing was lost: the client was tucked away, not deleted. Its detail page is still reachable
    // at /clients/<id> and still carries its data (the project done for it). Opening it is a view —
    // it records nothing.
    await page.goto('/clients/1');
    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('project-row-1').getByTestId('project-name')).toHaveText(
      'Website Redesign',
    );
    expect(archivedRecordsFor(1)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);
  });

  test('archiving one client leaves the others on the list, and each archive keeps its own record', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
        { id: 3, name: 'Initech', email: 'info@initech.test' },
      ],
    });

    await page.goto('/clients');
    await expect(clientRows(page)).toHaveCount(3);
    expect(auditLines()).toEqual([]);

    // Archive the middle client.
    await page.getByTestId('client-archive-2').click();

    // Only that client is tucked away; its siblings remain, each still carrying its name and email.
    await expect(page.getByTestId('client-row-2')).toHaveCount(0);
    await expect(clientRows(page)).toHaveCount(2);
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText('Acme Corp');
    await expect(page.getByTestId('client-row-1').getByTestId('client-email')).toHaveText(
      'hello@acme.test',
    );
    await expect(page.getByTestId('client-row-3').getByTestId('client-name')).toHaveText('Initech');

    // Exactly one record so far, for the client that was archived.
    expect(archivedRecordsFor(2)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // Archive another client — a second record is kept, independent of the first.
    await page.getByTestId('client-archive-1').click();
    await expect(page.getByTestId('client-row-1')).toHaveCount(0);
    await expect(clientRows(page)).toHaveCount(1);
    await expect(page.getByTestId('client-row-3')).toBeVisible();

    expect(archivedRecordsFor(2)).toHaveLength(1);
    expect(archivedRecordsFor(1)).toHaveLength(1);
    expect(auditLines()).toHaveLength(2);

    // The tuck-aways survive a fresh load: only the un-archived client remains on the list, and
    // reloading records nothing more.
    await page.reload();
    await expect(clientRows(page)).toHaveCount(1);
    await expect(page.getByTestId('client-row-3')).toBeVisible();
    await expect(page.getByTestId('client-row-1')).toHaveCount(0);
    await expect(page.getByTestId('client-row-2')).toHaveCount(0);
    expect(auditLines()).toHaveLength(2);
  });

  test('archiving a client also drops it from the name search', async ({ page }) => {
    await resetAndSeed({
      clients: [
        // Two clients share the "Acme" name so a search for it would match both.
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Acme Industries', email: 'ops@acme-ind.test' },
        { id: 3, name: 'Globex', email: 'contact@globex.test' },
      ],
    });

    await page.goto('/clients');
    await expect(clientRows(page)).toHaveCount(3);

    // Both Acme clients match the search before anything is archived.
    const search = page.getByTestId('client-search');
    await search.fill('acme');
    await expect(clientRows(page)).toHaveCount(2);
    await expect(page.getByTestId('client-row-1')).toBeVisible();
    await expect(page.getByTestId('client-row-2')).toBeVisible();

    // Clear the box, archive one of the Acme clients, then search again.
    await search.fill('');
    await page.getByTestId('client-archive-1').click();
    await expect(page.getByTestId('client-row-1')).toHaveCount(0);

    // The search now only returns the remaining Acme client — the archived one never comes back,
    // even as a search result.
    await search.fill('acme');
    await expect(clientRows(page)).toHaveCount(1);
    await expect(page.getByTestId('client-row-2')).toBeVisible();
    await expect(page.getByTestId('client-row-1')).toHaveCount(0);

    // Searching precisely for the archived client's name yields nothing.
    await search.fill('Acme Corp');
    await expect(clientRows(page)).toHaveCount(0);
    await expect(page.getByTestId('client-row-1')).toHaveCount(0);

    // Exactly one archive happened.
    expect(archivedRecordsFor(1)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);
  });

  test('a client seeded archived starts off both the list and the search, and seeding records nothing', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        // Already tucked away: it must not show on the list or in the search.
        { id: 2, name: 'Globex', email: 'contact@globex.test', archived: true },
      ],
    });

    await page.goto('/clients');
    await expect(page.getByTestId('clients-page')).toBeVisible();

    // Only the un-archived client is listed; the archived one is off the list entirely.
    await expect(clientRows(page)).toHaveCount(1);
    await expect(page.getByTestId('client-row-1')).toBeVisible();
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText('Acme Corp');
    await expect(page.getByTestId('client-row-2')).toHaveCount(0);
    await expect(page.getByTestId('clients-page')).not.toContainText('Globex');

    // Seeding an archived client is not an archive action — nothing is recorded.
    expect(auditLines()).toEqual([]);

    // And it is absent from the search as well: searching for its name returns no rows.
    await page.getByTestId('client-search').fill('Globex');
    await expect(clientRows(page)).toHaveCount(0);
    await expect(page.getByTestId('client-row-2')).toHaveCount(0);

    // Searching for the active client still finds it, proving the search itself works.
    await page.getByTestId('client-search').fill('Acme');
    await expect(clientRows(page)).toHaveCount(1);
    await expect(page.getByTestId('client-row-1')).toBeVisible();

    // Still nothing recorded — searching is a view.
    expect(auditLines()).toEqual([]);
  });
});
