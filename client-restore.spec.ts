// Acceptance test for the change request:
//   "Let me bring back a client I tucked away earlier. I might start working with them again."
//
// Restoring is the inverse of archiving — bringing a tucked-away client back into use. Archived
// clients are hidden by default, but the clients page carries a Show-archived toggle
// (clients-show-archived) that reveals them. Each revealed archived client row offers a control to
// restore it (client-restore-<id>). Restoring:
//   * brings the client back onto the ordinary clients list (visible with no toggle on),
//   * brings it back into the name search,
//   * is held by the SERVER (it survives a fresh load from a clean URL),
//   * keeps a record — exactly one audit record `CLIENT_RESTORED id=<id>` per restore.
// Restoring one client must not touch the others, and merely viewing or revealing the archived
// clients records nothing — only the restore action itself does.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed (the app's /__test__ endpoint): `clients`
// honours { id, name, email, archived }.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

const clientRows = (page: Page) => page.locator('[data-testid^="client-row-"]');

// The audit record for one restore — carries the client's id and nothing else; matched exactly.
const restoredRecord = (id: number) => `CLIENT_RESTORED id=${id}`;

const restoredRecordsFor = (id: number): string[] =>
  auditLines().filter((line) => line === restoredRecord(id));

test.describe('Restore a client', () => {
  test('restoring an archived client brings it back to the list and search, persists, and records it once', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        // Tucked away earlier — hidden by default, to be brought back.
        { id: 2, name: 'Globex', email: 'contact@globex.test', archived: true },
      ],
    });

    await page.goto('/clients');
    await expect(page.getByTestId('clients-page')).toBeVisible();

    // By default only the active client shows; the archived one is off the list, and the page offers
    // the Show-archived toggle.
    await expect(clientRows(page)).toHaveCount(1);
    await expect(page.getByTestId('client-row-1')).toBeVisible();
    await expect(page.getByTestId('client-row-2')).toHaveCount(0);
    const showArchived = page.getByTestId('clients-show-archived');
    await expect(showArchived).toBeVisible();

    // Nothing recorded yet — reset clears the audit file, so the record below is proof the restore
    // (not the seeding) wrote it.
    expect(auditLines()).toEqual([]);

    // Revealing the archived clients brings the tucked-away one into view alongside the active one,
    // and offers a control to restore it. Revealing is a view — it records nothing.
    await showArchived.click();
    await expect(clientRows(page)).toHaveCount(2);
    await expect(page.getByTestId('client-row-2')).toBeVisible();
    await expect(page.getByTestId('client-row-2').getByTestId('client-name')).toHaveText('Globex');
    const restore = page.getByTestId('client-restore-2');
    await expect(restore).toBeVisible();
    expect(auditLines()).toEqual([]);

    await restore.click();

    // Exactly one record was kept for this restore, carrying the client's id.
    await expect(page.getByTestId('client-row-2')).toBeVisible();
    expect(restoredRecordsFor(2)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // The restore is held by the server, not just the page: loading the ordinary list from a clean
    // URL (no Show-archived toggle on) now shows the brought-back client as an active client, and
    // merely viewing the list records nothing more.
    await page.goto('/clients');
    await expect(clientRows(page)).toHaveCount(2);
    await expect(page.getByTestId('client-row-1')).toBeVisible();
    await expect(page.getByTestId('client-row-2')).toBeVisible();
    await expect(page.getByTestId('client-row-2').getByTestId('client-name')).toHaveText('Globex');
    expect(restoredRecordsFor(2)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // And it is back in the name search: searching for its name now finds it again.
    await page.getByTestId('client-search').fill('Globex');
    await expect(clientRows(page)).toHaveCount(1);
    await expect(page.getByTestId('client-row-2')).toBeVisible();
    await expect(page.getByTestId('client-row-1')).toHaveCount(0);
    expect(auditLines()).toHaveLength(1);
  });

  test('restoring one archived client leaves the others tucked away, and each restore keeps its own record', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test', archived: true },
        { id: 3, name: 'Initech', email: 'info@initech.test', archived: true },
      ],
    });

    await page.goto('/clients');
    // Only the active client by default.
    await expect(clientRows(page)).toHaveCount(1);
    await expect(page.getByTestId('client-row-1')).toBeVisible();
    expect(auditLines()).toEqual([]);

    // Reveal the archived clients — both tucked-away clients appear, each with a restore control.
    await page.getByTestId('clients-show-archived').click();
    await expect(clientRows(page)).toHaveCount(3);
    await expect(page.getByTestId('client-restore-2')).toBeVisible();
    await expect(page.getByTestId('client-restore-3')).toBeVisible();

    // Restore just one of them.
    await page.getByTestId('client-restore-2').click();
    await expect(restoredRecordsFor(2)).toHaveLength(1);
    expect(restoredRecordsFor(3)).toHaveLength(0);
    expect(auditLines()).toHaveLength(1);

    // On the ordinary list (clean URL, toggle off) the restored client is now active alongside the
    // one that was never archived; the still-archived client stays tucked away.
    await page.goto('/clients');
    await expect(clientRows(page)).toHaveCount(2);
    await expect(page.getByTestId('client-row-1')).toBeVisible();
    await expect(page.getByTestId('client-row-2')).toBeVisible();
    await expect(page.getByTestId('client-row-3')).toHaveCount(0);

    // Reveal again and restore the other one — a second record is kept, independent of the first.
    await page.getByTestId('clients-show-archived').click();
    await expect(page.getByTestId('client-row-3')).toBeVisible();
    await expect(page.getByTestId('client-restore-3')).toBeVisible();
    expect(auditLines()).toHaveLength(1);

    await page.getByTestId('client-restore-3').click();
    await expect(restoredRecordsFor(2)).toHaveLength(1);
    await expect(restoredRecordsFor(3)).toHaveLength(1);
    expect(auditLines()).toHaveLength(2);

    // Both are now active: the ordinary list shows all three.
    await page.goto('/clients');
    await expect(clientRows(page)).toHaveCount(3);
    await expect(page.getByTestId('client-row-1')).toBeVisible();
    await expect(page.getByTestId('client-row-2')).toBeVisible();
    await expect(page.getByTestId('client-row-3')).toBeVisible();
    expect(auditLines()).toHaveLength(2);
  });

  test('revealing archived clients is a view — a client only offers restore while archived, and viewing records nothing', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test', archived: true },
      ],
    });

    await page.goto('/clients');
    await expect(page.getByTestId('clients-page')).toBeVisible();
    await expect(clientRows(page)).toHaveCount(1);

    // Reveal the archived clients.
    await page.getByTestId('clients-show-archived').click();
    await expect(clientRows(page)).toHaveCount(2);

    // The archived client offers restore; the active client does not — it offers archive instead.
    await expect(page.getByTestId('client-restore-2')).toBeVisible();
    await expect(page.getByTestId('client-restore-1')).toHaveCount(0);
    await expect(page.getByTestId('client-archive-1')).toBeVisible();

    // Revealing and looking is a view — nothing is recorded, and the archived client is not restored.
    expect(auditLines()).toEqual([]);

    // Proof it was not restored: on the ordinary list (clean URL) it is still tucked away.
    await page.goto('/clients');
    await expect(clientRows(page)).toHaveCount(1);
    await expect(page.getByTestId('client-row-1')).toBeVisible();
    await expect(page.getByTestId('client-row-2')).toHaveCount(0);
    expect(auditLines()).toEqual([]);
  });
});
