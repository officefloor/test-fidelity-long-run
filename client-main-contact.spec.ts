// Acceptance tests for the change request:
//   "Let me pick a main contact for each client. Show who it is."
//
// Each client can have ONE of its contacts marked as the main (primary) contact. The client's
// detail page both SHOWS who the main contact currently is (client-primary-contact) and lets you
// PICK one from among that client's contacts: a choices control (client-main-contact-choices)
// offers a per-contact pick action (contact-primary-<id>). Picking a contact:
//   - makes it the main contact shown for that client (client-primary-contact names it);
//   - appends exactly one audit record — CONTACT_PRIMARY_SET client=<client> contact=<contact> —
//     naming the client and the chosen contact (the UI shows the current pick, but the act of
//     setting it is audited).
// The choice is PER CLIENT: a contact can only be a choice for the client it belongs to, and one
// client's main contact never shows on another's page.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed; the pick is driven through the UI. Seed
// honours contacts: { id, clientId, name, email, role, primary } — `primary: true` places a
// contact directly in the main-contact state so the showing can be checked without a click.
//
// This SHOULD FAIL before the change: today a client's page has no main-contact region, no pick
// control, and nothing is recorded when a main contact is chosen.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

test.describe('pick a main contact for a client', () => {
  test('a seeded main contact is shown as who it is', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      contacts: [
        { id: 1, clientId: 1, name: 'Dana Wells', email: 'dana@acme.example', role: 'Billing lead' },
        // Already the main contact for this client.
        { id: 2, clientId: 1, name: 'Omar Reed', email: 'omar@acme.example', role: 'Engineering', primary: true },
      ],
    });

    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-main-contact')).toBeVisible();

    // The page shows who the main contact is — the seeded one.
    await expect(page.getByTestId('client-primary-contact')).toContainText('Omar Reed');

    // Seeding a main contact is Arrange, not an action — nothing is audited by it.
    expect(auditLines()).toEqual([]);
  });

  test('picking a contact makes it the main contact shown, and records the act', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      contacts: [
        { id: 1, clientId: 1, name: 'Dana Wells', email: 'dana@acme.example', role: 'Billing lead' },
        { id: 2, clientId: 1, name: 'Omar Reed', email: 'omar@acme.example', role: 'Engineering' },
      ],
    });

    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-main-contact')).toBeVisible();

    // The choices offer a pick for each of this client's contacts.
    const choices = page.getByTestId('client-main-contact-choices');
    await expect(choices).toBeVisible();
    await expect(page.getByTestId('contact-primary-1')).toBeVisible();
    await expect(page.getByTestId('contact-primary-2')).toBeVisible();

    // reset cleared the audit file — nothing has been picked yet.
    expect(auditLines()).toEqual([]);

    // Pick Dana as the main contact.
    await page.getByTestId('contact-primary-1').click();

    // The page now shows who the main contact is.
    await expect(page.getByTestId('client-primary-contact')).toContainText('Dana Wells');

    // Exactly one record was kept, naming the client and the chosen contact.
    await expect.poll(() => auditLines()).toEqual(['CONTACT_PRIMARY_SET client=1 contact=1']);
  });

  test('changing the main contact updates who is shown and records the new choice', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      contacts: [
        { id: 1, clientId: 1, name: 'Dana Wells', email: 'dana@acme.example', role: 'Billing lead' },
        { id: 2, clientId: 1, name: 'Omar Reed', email: 'omar@acme.example', role: 'Engineering' },
      ],
    });

    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();
    await expect(page.getByTestId('client-main-contact')).toBeVisible();

    // Pick Dana, then switch to Omar.
    await page.getByTestId('contact-primary-1').click();
    await expect(page.getByTestId('client-primary-contact')).toContainText('Dana Wells');

    await page.getByTestId('contact-primary-2').click();

    // The shown main contact follows the latest pick — and only one contact is the main one.
    const shown = page.getByTestId('client-primary-contact');
    await expect(shown).toContainText('Omar Reed');
    await expect(shown).not.toContainText('Dana Wells');

    // Each pick was recorded, in order.
    await expect.poll(() => auditLines()).toEqual([
      'CONTACT_PRIMARY_SET client=1 contact=1',
      'CONTACT_PRIMARY_SET client=1 contact=2',
    ]);
  });

  test('the main contact is per client — choices and the shown contact do not leak across clients', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example' },
        { id: 2, name: 'Globex', email: 'hello@globex.example' },
      ],
      contacts: [
        { id: 1, clientId: 1, name: 'Dana Wells', email: 'dana@acme.example', role: 'Billing lead' },
        // Belongs to client 2 and is client 2's main contact.
        { id: 2, clientId: 2, name: 'Priya Shah', email: 'priya@globex.example', role: 'Procurement', primary: true },
      ],
    });

    // Client 1's page offers only its own contact as a choice, and does not show client 2's main
    // contact as its own.
    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();
    await expect(page.getByTestId('client-main-contact')).toBeVisible();

    await expect(page.getByTestId('contact-primary-1')).toBeVisible();
    await expect(page.getByTestId('contact-primary-2')).toHaveCount(0);
    await expect(page.getByTestId('client-primary-contact')).not.toContainText('Priya Shah');

    // Client 2's page shows ITS main contact.
    await page.goto('/clients');
    await page.getByTestId('client-open-2').click();
    await expect(page.getByTestId('client-main-contact')).toBeVisible();
    await expect(page.getByTestId('client-primary-contact')).toContainText('Priya Shah');

    // Only seeded state so far — no pick has happened, so nothing is audited.
    expect(auditLines()).toEqual([]);
  });
});
