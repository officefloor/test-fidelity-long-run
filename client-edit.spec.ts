// Acceptance test for the change request:
//   "Let me fix a client's name or email from the list."
//
// Each client row on the clients list offers an "edit" control (client-edit-<id>). Opening it
// reveals an inline edit form (client-edit-form) whose name/email fields (client-edit-form-name /
// client-edit-form-email) start out carrying the client's CURRENT values. Submitting
// (client-edit-form-submit) a proper name/email:
//   * updates that client's row on the list (client-name / client-email now show the new values),
//   * is held by the SERVER (it survives a fresh load),
//   * keeps a record — exactly one audit record `CLIENT_UPDATED id=<id>` per successful edit.
// Cancelling (client-edit-cancel-<id>) closes the form and changes nothing. A blank or malformed
// email, or an email already used by ANOTHER client, is rejected: client-edit-form-email-error is
// surfaced and nothing is saved. Keeping a client's own email while renaming it is NOT a clash.
// Editing one client must not touch the others.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed (the app's /__test__ endpoint); `clients`
// honours { id, name, email, archived }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

const clientRows = (page: Page): Locator => page.locator('[data-testid^="client-row-"]');

// The audit record for one edit — carries the client's id and nothing else; matched exactly.
const updatedRecord = (id: number) => `CLIENT_UPDATED id=${id}`;

const updatedRecordsFor = (id: number): string[] =>
  auditLines().filter((line) => line === updatedRecord(id));

test.describe('Edit a client from the list', () => {
  test('editing a client\'s name and email updates its row, persists, and records it once', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
    });

    await page.goto('/clients');
    await expect(page.getByTestId('clients-page')).toBeVisible();
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText('Acme Corp');
    await expect(page.getByTestId('client-row-1').getByTestId('client-email')).toHaveText(
      'hello@acme.test',
    );

    // Nothing recorded yet — reset clears the audit file, so the record below is proof the edit
    // (not the seeding) wrote it.
    expect(auditLines()).toEqual([]);

    // The row offers a control to edit it. Opening it reveals the edit form, prefilled with the
    // client's current name and email.
    const edit = page.getByTestId('client-edit-1');
    await expect(edit).toBeVisible();
    await edit.click();

    await expect(page.getByTestId('client-edit-form')).toBeVisible();
    await expect(page.getByTestId('client-edit-form-name')).toHaveValue('Acme Corp');
    await expect(page.getByTestId('client-edit-form-email')).toHaveValue('hello@acme.test');

    // Fix both the name and the email, then submit.
    await page.getByTestId('client-edit-form-name').fill('Acme Industries');
    await page.getByTestId('client-edit-form-email').fill('ops@acme-ind.test');
    await page.getByTestId('client-edit-form-submit').click();

    // The form closes and the row now shows the corrected name and email.
    await expect(page.getByTestId('client-edit-form')).toHaveCount(0);
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText(
      'Acme Industries',
    );
    await expect(page.getByTestId('client-row-1').getByTestId('client-email')).toHaveText(
      'ops@acme-ind.test',
    );

    // Exactly one record was kept for this edit, carrying the client's id.
    expect(updatedRecordsFor(1)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // The change is held by the server, not just the page: it survives a fresh load, and merely
    // viewing the list does not record the edit a second time.
    await page.reload();
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText(
      'Acme Industries',
    );
    await expect(page.getByTestId('client-row-1').getByTestId('client-email')).toHaveText(
      'ops@acme-ind.test',
    );
    expect(updatedRecordsFor(1)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);
  });

  test('renaming a client while keeping its own email is allowed (not a duplicate of itself)', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
    });

    await page.goto('/clients');
    await page.getByTestId('client-edit-1').click();

    // Change only the name; leave the email at its current (own) value.
    await expect(page.getByTestId('client-edit-form-email')).toHaveValue('hello@acme.test');
    await page.getByTestId('client-edit-form-name').fill('Acme Holdings');
    await page.getByTestId('client-edit-form-submit').click();

    // Submitting with the client's own unchanged email is accepted — no duplicate-email rejection.
    await expect(page.getByTestId('client-edit-form-email-error')).toHaveCount(0);
    await expect(page.getByTestId('client-edit-form')).toHaveCount(0);
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText(
      'Acme Holdings',
    );
    await expect(page.getByTestId('client-row-1').getByTestId('client-email')).toHaveText(
      'hello@acme.test',
    );

    expect(updatedRecordsFor(1)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    await page.reload();
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText(
      'Acme Holdings',
    );
    await expect(page.getByTestId('client-row-1').getByTestId('client-email')).toHaveText(
      'hello@acme.test',
    );
  });

  test('cancelling an edit closes the form, keeps the original values, and records nothing', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
    });

    await page.goto('/clients');
    await page.getByTestId('client-edit-1').click();
    await expect(page.getByTestId('client-edit-form')).toBeVisible();

    // Type new values but then back out via cancel.
    await page.getByTestId('client-edit-form-name').fill('Wrong Name');
    await page.getByTestId('client-edit-form-email').fill('wrong@nope.test');
    await page.getByTestId('client-edit-cancel-1').click();

    // The form closes and the row still shows the ORIGINAL name and email.
    await expect(page.getByTestId('client-edit-form')).toHaveCount(0);
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText('Acme Corp');
    await expect(page.getByTestId('client-row-1').getByTestId('client-email')).toHaveText(
      'hello@acme.test',
    );

    // Cancelling is not an edit — nothing is recorded, and nothing persisted.
    expect(auditLines()).toEqual([]);

    await page.reload();
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText('Acme Corp');
    await expect(page.getByTestId('client-row-1').getByTestId('client-email')).toHaveText(
      'hello@acme.test',
    );
    expect(auditLines()).toEqual([]);
  });

  test('an edit with a blank or malformed email is rejected and changes nothing', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
    });

    await page.goto('/clients');
    await page.getByTestId('client-edit-1').click();

    // A blank email is not a proper address: the error is surfaced and nothing is saved.
    await page.getByTestId('client-edit-form-name').fill('Acme Industries');
    await page.getByTestId('client-edit-form-email').fill('');
    await page.getByTestId('client-edit-form-submit').click();
    await expect(page.getByTestId('client-edit-form-email-error')).toBeVisible();

    // A plainly malformed address (no domain) is likewise rejected.
    await page.getByTestId('client-edit-form-email').fill('not-an-email');
    await page.getByTestId('client-edit-form-submit').click();
    await expect(page.getByTestId('client-edit-form-email-error')).toBeVisible();

    // Nothing was recorded and nothing persisted — a fresh load still shows the original client.
    expect(auditLines()).toEqual([]);
    await page.reload();
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText('Acme Corp');
    await expect(page.getByTestId('client-row-1').getByTestId('client-email')).toHaveText(
      'hello@acme.test',
    );
    expect(auditLines()).toEqual([]);
  });

  test('editing a client to an email already used by another client is rejected', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
    });

    await page.goto('/clients');
    await expect(clientRows(page)).toHaveCount(2);

    // Try to change Acme's email to the one Globex already uses.
    await page.getByTestId('client-edit-1').click();
    await page.getByTestId('client-edit-form-email').fill('contact@globex.test');
    await page.getByTestId('client-edit-form-submit').click();

    // The clash is rejected: the error is surfaced and nothing is saved.
    await expect(page.getByTestId('client-edit-form-email-error')).toBeVisible();
    expect(auditLines()).toEqual([]);

    // Both clients keep their original emails, even after a fresh load from the server.
    await page.reload();
    await expect(page.getByTestId('client-row-1').getByTestId('client-email')).toHaveText(
      'hello@acme.test',
    );
    await expect(page.getByTestId('client-row-2').getByTestId('client-email')).toHaveText(
      'contact@globex.test',
    );
    expect(auditLines()).toEqual([]);
  });

  test('editing one client leaves the others on the list untouched', async ({ page }) => {
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

    // Edit the middle client's name and email.
    await page.getByTestId('client-edit-2').click();
    await page.getByTestId('client-edit-form-name').fill('Globex Industries');
    await page.getByTestId('client-edit-form-email').fill('ops@globex.test');
    await page.getByTestId('client-edit-form-submit').click();
    await expect(page.getByTestId('client-edit-form')).toHaveCount(0);

    // Only that client changed; its siblings still carry their original name and email.
    await expect(page.getByTestId('client-row-2').getByTestId('client-name')).toHaveText(
      'Globex Industries',
    );
    await expect(page.getByTestId('client-row-2').getByTestId('client-email')).toHaveText(
      'ops@globex.test',
    );
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText('Acme Corp');
    await expect(page.getByTestId('client-row-1').getByTestId('client-email')).toHaveText(
      'hello@acme.test',
    );
    await expect(page.getByTestId('client-row-3').getByTestId('client-name')).toHaveText('Initech');
    await expect(page.getByTestId('client-row-3').getByTestId('client-email')).toHaveText(
      'info@initech.test',
    );

    // Exactly one record, for the client that was edited.
    expect(updatedRecordsFor(2)).toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    await page.reload();
    await expect(clientRows(page)).toHaveCount(3);
    await expect(page.getByTestId('client-row-2').getByTestId('client-name')).toHaveText(
      'Globex Industries',
    );
    await expect(page.getByTestId('client-row-1').getByTestId('client-name')).toHaveText('Acme Corp');
    await expect(page.getByTestId('client-row-3').getByTestId('client-name')).toHaveText('Initech');
    expect(auditLines()).toHaveLength(1);
  });
});
