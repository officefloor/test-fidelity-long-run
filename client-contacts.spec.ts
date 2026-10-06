// Acceptance test for the change request:
//   "For each client let me keep their contacts. Store a name, an email and their role. Show them
//    on the client's page."
//
// A contact belongs to a client. Opening a client lands on its detail page (client-detail-page, at
// /clients/<id>), which surfaces a contacts region (client-contacts) listing THAT client's contacts
// — only that client's — each shown with its name, email and role. A new contact is added from that
// page by giving a name, an email and a role; once added it joins the same contacts list and
// survives a fresh load.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email } and `contacts` honours { id, name, email, role,
// clientId }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

const contactRows = (page: Page) => page.locator('[data-testid^="contact-row-"]');

// Locate the one contact row carrying the given name, regardless of its server-assigned id.
const contactRowNamed = (page: Page, name: string): Locator =>
  contactRows(page).filter({
    has: page.getByTestId('contact-name').getByText(name, { exact: true }),
  });

test.describe('Client contacts', () => {
  test("a client's detail page surfaces its contacts, each with name, email and role", async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      contacts: [
        { id: 1, name: 'Alice Stone', email: 'alice@acme.test', role: 'Owner', clientId: 1 },
        { id: 2, name: 'Bob Reed', email: 'bob@acme.test', role: 'Billing', clientId: 1 },
        // A contact for a DIFFERENT client must not show on this client's page.
        { id: 3, name: 'Carol Vane', email: 'carol@globex.test', role: 'Manager', clientId: 2 },
      ],
    });

    await page.goto('/clients/1');

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-contacts')).toBeVisible();
    await expect(page.getByTestId('client-contacts-table')).toBeVisible();

    // Only this client's two contacts are shown, each carrying its own name, email and role.
    await expect(contactRows(page)).toHaveCount(2);

    const alice = page.getByTestId('contact-row-1');
    await expect(alice).toBeVisible();
    await expect(alice.getByTestId('contact-name')).toHaveText('Alice Stone');
    await expect(alice.getByTestId('contact-email')).toHaveText('alice@acme.test');
    await expect(alice.getByTestId('contact-role')).toHaveText('Owner');

    const bob = page.getByTestId('contact-row-2');
    await expect(bob.getByTestId('contact-name')).toHaveText('Bob Reed');
    await expect(bob.getByTestId('contact-email')).toHaveText('bob@acme.test');
    await expect(bob.getByTestId('contact-role')).toHaveText('Billing');

    // The other client's contact is nowhere on this page.
    await expect(page.getByTestId('contact-row-3')).toHaveCount(0);
    await expect(page.getByTestId('client-contacts')).not.toContainText('Carol Vane');
    await expect(page.getByTestId('client-contacts')).not.toContainText('carol@globex.test');
  });

  test("opening a different client shows that client's own contacts", async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      contacts: [
        { id: 1, name: 'Alice Stone', email: 'alice@acme.test', role: 'Owner', clientId: 1 },
        { id: 2, name: 'Bob Reed', email: 'bob@acme.test', role: 'Billing', clientId: 1 },
        { id: 3, name: 'Carol Vane', email: 'carol@globex.test', role: 'Manager', clientId: 2 },
      ],
    });

    await page.goto('/clients/2');

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-contacts')).toBeVisible();

    // Globex has exactly one contact; Acme's contacts do not appear here.
    await expect(contactRows(page)).toHaveCount(1);
    const carol = contactRowNamed(page, 'Carol Vane');
    await expect(carol).toHaveCount(1);
    await expect(carol.getByTestId('contact-email')).toHaveText('carol@globex.test');
    await expect(carol.getByTestId('contact-role')).toHaveText('Manager');

    await expect(page.getByTestId('client-contacts')).not.toContainText('Alice Stone');
    await expect(page.getByTestId('client-contacts')).not.toContainText('Bob Reed');
  });

  test('a client with no contacts lists none', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      // Only the other client has a contact; client 1 has none.
      contacts: [
        { id: 1, name: 'Carol Vane', email: 'carol@globex.test', role: 'Manager', clientId: 2 },
      ],
    });

    await page.goto('/clients/1');

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-contacts')).toBeVisible();
    // Nothing is listed, and no stray contact leaks in from the other client.
    await expect(contactRows(page)).toHaveCount(0);
    await expect(page.getByTestId('client-contacts')).not.toContainText('Carol Vane');
  });

  test('adding a contact with a name, email and role shows it on the client page', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      contacts: [],
    });

    await page.goto('/clients/1');
    await expect(page.getByTestId('client-contacts')).toBeVisible();
    await expect(contactRows(page)).toHaveCount(0);

    // Fill the add-contact form: a name, an email and a role.
    await expect(page.getByTestId('contact-form')).toBeVisible();
    await page.getByTestId('contact-form-name').fill('Dana Fox');
    await page.getByTestId('contact-form-email').fill('dana@acme.test');
    await page.getByTestId('contact-form-role').fill('Procurement');
    await page.getByTestId('contact-form-submit').click();

    // The newly added contact appears, carrying its name, email and role. Its id is assigned by the
    // server, so locate the row by its content rather than a known id.
    const newRow = contactRowNamed(page, 'Dana Fox');
    await expect(newRow).toHaveCount(1);
    await expect(newRow.getByTestId('contact-name')).toHaveText('Dana Fox');
    await expect(newRow.getByTestId('contact-email')).toHaveText('dana@acme.test');
    await expect(newRow.getByTestId('contact-role')).toHaveText('Procurement');

    await expect(contactRows(page)).toHaveCount(1);
    await expect(page.getByTestId('client-contacts-table')).toBeVisible();

    // And it survives a fresh load from the server.
    await page.reload();
    const reloaded = contactRowNamed(page, 'Dana Fox');
    await expect(reloaded).toHaveCount(1);
    await expect(reloaded.getByTestId('contact-email')).toHaveText('dana@acme.test');
    await expect(reloaded.getByTestId('contact-role')).toHaveText('Procurement');
  });

  test('a contact added on top of seeded contacts joins the same single list', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      contacts: [
        { id: 1, name: 'Alice Stone', email: 'alice@acme.test', role: 'Owner', clientId: 1 },
      ],
    });

    await page.goto('/clients/1');
    await expect(contactRows(page)).toHaveCount(1);

    await page.getByTestId('contact-form-name').fill('Bob Reed');
    await page.getByTestId('contact-form-email').fill('bob@acme.test');
    await page.getByTestId('contact-form-role').fill('Billing');
    await page.getByTestId('contact-form-submit').click();

    // Both the pre-existing and the newly added contact are shown together in the one list.
    await expect(contactRows(page)).toHaveCount(2);
    await expect(page.getByTestId('contact-row-1').getByTestId('contact-name')).toHaveText(
      'Alice Stone',
    );

    const bobRow = contactRowNamed(page, 'Bob Reed');
    await expect(bobRow).toHaveCount(1);
    await expect(bobRow.getByTestId('contact-email')).toHaveText('bob@acme.test');
    await expect(bobRow.getByTestId('contact-role')).toHaveText('Billing');
  });

  test('a contact added for one client does not appear on another client', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      contacts: [],
    });

    // Add a contact while viewing client 1.
    await page.goto('/clients/1');
    await page.getByTestId('contact-form-name').fill('Dana Fox');
    await page.getByTestId('contact-form-email').fill('dana@acme.test');
    await page.getByTestId('contact-form-role').fill('Procurement');
    await page.getByTestId('contact-form-submit').click();
    await expect(contactRowNamed(page, 'Dana Fox')).toHaveCount(1);

    // The other client's page does not show that contact.
    await page.goto('/clients/2');
    await expect(page.getByTestId('client-contacts')).toBeVisible();
    await expect(contactRows(page)).toHaveCount(0);
    await expect(page.getByTestId('client-contacts')).not.toContainText('Dana Fox');
  });
});
