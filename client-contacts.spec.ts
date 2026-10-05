// Acceptance tests for the change request:
//   "For each client let me keep their contacts. Store a name, an email and their role. Show them
//    on the client's page."
//
// Opening a client (client-open-<id> from the clients list) reaches that client's detail page,
// which now carries a contacts region. Each contact stores a NAME, an EMAIL and a ROLE, and the
// region lists the contacts belonging TO THAT CLIENT (another client's contacts must not leak in).
// A form on the page adds a new contact with those three fields; after adding it appears in the
// list.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed; the add flow is
// driven through the form. Seed honours clients: { id, name, email } and contacts: { id, clientId,
// name, email, role }.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('client contacts', () => {
  test('opening a client shows that client\'s contacts, each with name, email and role', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example' },
        { id: 2, name: 'Globex', email: 'hello@globex.example' },
      ],
      contacts: [
        { id: 1, clientId: 1, name: 'Dana Wells', email: 'dana@acme.example', role: 'Billing lead' },
        { id: 2, clientId: 1, name: 'Omar Reed', email: 'omar@acme.example', role: 'Engineering' },
        // Belongs to a DIFFERENT client — it must not appear on client 1's page.
        { id: 3, clientId: 2, name: 'Priya Shah', email: 'priya@globex.example', role: 'Procurement' },
      ],
    });

    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-contacts')).toBeVisible();
    await expect(page.getByTestId('client-contacts-table')).toBeVisible();

    // Client 1's own contacts, each showing name, email and role.
    const first = page.getByTestId('contact-row-1');
    await expect(first).toBeVisible();
    await expect(first.getByTestId('contact-name')).toHaveText('Dana Wells');
    await expect(first.getByTestId('contact-email')).toHaveText('dana@acme.example');
    await expect(first.getByTestId('contact-role')).toHaveText('Billing lead');

    const second = page.getByTestId('contact-row-2');
    await expect(second).toBeVisible();
    await expect(second.getByTestId('contact-name')).toHaveText('Omar Reed');
    await expect(second.getByTestId('contact-email')).toHaveText('omar@acme.example');
    await expect(second.getByTestId('contact-role')).toHaveText('Engineering');

    // The other client's contact is not shown here.
    await expect(page.getByTestId('contact-row-3')).toHaveCount(0);
    await expect(page.getByTestId('contact-name')).toHaveCount(2);
  });

  test('a client with no contacts of their own shows none (another client\'s do not leak)', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example' },
        { id: 2, name: 'Globex', email: 'hello@globex.example' },
      ],
      contacts: [
        // Contact belongs to the OTHER client, so client 1's page must show no contacts.
        { id: 1, clientId: 2, name: 'Priya Shah', email: 'priya@globex.example', role: 'Procurement' },
      ],
    });

    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-contacts')).toBeVisible();
    // None of the other client's contacts leak onto this client's page.
    await expect(page.getByTestId('contact-name')).toHaveCount(0);
    await expect(page.getByTestId('contact-row-1')).toHaveCount(0);
  });

  test('adds a contact with a name, email and role through the form', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      contacts: [],
    });

    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('contact-form')).toBeVisible();
    // No contacts seeded, so no contact rows yet.
    await expect(page.getByTestId('contact-name')).toHaveCount(0);

    await page.getByTestId('contact-form-name').fill('Dana Wells');
    await page.getByTestId('contact-form-email').fill('dana@acme.example');
    await page.getByTestId('contact-form-role').fill('Billing lead');
    await page.getByTestId('contact-form-submit').click();

    // Reset RESTART IDENTITY + empty contacts seed => the first created contact has id 1.
    const row = page.getByTestId('contact-row-1');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('contact-name')).toHaveText('Dana Wells');
    await expect(row.getByTestId('contact-email')).toHaveText('dana@acme.example');
    await expect(row.getByTestId('contact-role')).toHaveText('Billing lead');
  });

  test('a freshly added contact joins the client\'s existing contacts', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      contacts: [
        { id: 1, clientId: 1, name: 'Dana Wells', email: 'dana@acme.example', role: 'Billing lead' },
      ],
    });

    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('contact-row-1').getByTestId('contact-name')).toHaveText('Dana Wells');

    await page.getByTestId('contact-form-name').fill('Omar Reed');
    await page.getByTestId('contact-form-email').fill('omar@acme.example');
    await page.getByTestId('contact-form-role').fill('Engineering');
    await page.getByTestId('contact-form-submit').click();

    // Both contacts now listed for this client.
    await expect(page.getByTestId('contact-row-1').getByTestId('contact-name')).toHaveText('Dana Wells');
    const added = page.getByTestId('contact-row-2');
    await expect(added).toBeVisible();
    await expect(added.getByTestId('contact-name')).toHaveText('Omar Reed');
    await expect(added.getByTestId('contact-email')).toHaveText('omar@acme.example');
    await expect(added.getByTestId('contact-role')).toHaveText('Engineering');

    await expect(page.getByTestId('contact-name')).toHaveCount(2);
  });
});
