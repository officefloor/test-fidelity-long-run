// Acceptance test for the change request:
//   "On a client's page show me how many projects and contacts they have."
//
// A client's detail page (client-detail-page, at /clients/<id>) surfaces a counts region
// (client-counts) stating how many projects (client-projects-count) and how many contacts
// (client-contacts-count) THAT client has. The counts are scoped to the client being viewed —
// another client's projects and contacts are not counted — and they track the data: a client with
// none shows zero, and adding a contact bumps the contacts count.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email }, `projects` honours { id, name, clientId } and
// `contacts` honours { id, name, email, role, clientId }.
//
// The count elements may carry a label (e.g. "2 projects") or a bare number, so each count is
// matched with a word-boundary regex on its number: this verifies the right value while tolerating
// surrounding label text, and — because the two seeded counts differ — proves each testid shows its
// own figure rather than the other.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

const contactRows = (page: Page) => page.locator('[data-testid^="contact-row-"]');

test.describe('Client project and contact counts', () => {
  test("a client's detail page shows how many projects and contacts it has", async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      projects: [
        { id: 1, name: 'Website Redesign', clientId: 1 },
        { id: 2, name: 'Billing System', clientId: 1 },
        // A project for a DIFFERENT client must not be counted here.
        { id: 3, name: 'Mobile App', clientId: 2 },
      ],
      contacts: [
        { id: 1, name: 'Alice Stone', email: 'alice@acme.test', role: 'Owner', clientId: 1 },
        { id: 2, name: 'Bob Reed', email: 'bob@acme.test', role: 'Billing', clientId: 1 },
        { id: 3, name: 'Eve Park', email: 'eve@acme.test', role: 'Legal', clientId: 1 },
        // A contact for a DIFFERENT client must not be counted here.
        { id: 4, name: 'Carol Vane', email: 'carol@globex.test', role: 'Manager', clientId: 2 },
      ],
    });

    await page.goto('/clients/1');

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-counts')).toBeVisible();

    // Acme has exactly 2 projects and 3 contacts — the other client's are not counted.
    await expect(page.getByTestId('client-projects-count')).toHaveText(/\b2\b/);
    await expect(page.getByTestId('client-contacts-count')).toHaveText(/\b3\b/);
  });

  test("a different client's page shows that client's own counts", async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      projects: [
        { id: 1, name: 'Website Redesign', clientId: 1 },
        { id: 2, name: 'Billing System', clientId: 1 },
        { id: 3, name: 'Mobile App', clientId: 2 },
      ],
      contacts: [
        { id: 1, name: 'Alice Stone', email: 'alice@acme.test', role: 'Owner', clientId: 1 },
        { id: 2, name: 'Bob Reed', email: 'bob@acme.test', role: 'Billing', clientId: 1 },
        { id: 3, name: 'Eve Park', email: 'eve@acme.test', role: 'Legal', clientId: 1 },
        { id: 4, name: 'Carol Vane', email: 'carol@globex.test', role: 'Manager', clientId: 2 },
      ],
    });

    await page.goto('/clients/2');

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-counts')).toBeVisible();

    // Globex has exactly 1 project and 1 contact.
    await expect(page.getByTestId('client-projects-count')).toHaveText(/\b1\b/);
    await expect(page.getByTestId('client-contacts-count')).toHaveText(/\b1\b/);
  });

  test('a client with no projects and no contacts shows zero for each', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      // Every project and contact belongs to the OTHER client; client 1 has none of either.
      projects: [{ id: 1, name: 'Mobile App', clientId: 2 }],
      contacts: [
        { id: 1, name: 'Carol Vane', email: 'carol@globex.test', role: 'Manager', clientId: 2 },
      ],
    });

    await page.goto('/clients/1');

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-counts')).toBeVisible();

    await expect(page.getByTestId('client-projects-count')).toHaveText(/\b0\b/);
    await expect(page.getByTestId('client-contacts-count')).toHaveText(/\b0\b/);
  });

  test('adding a contact increases the contacts count on the page', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      // Start with no contacts so the count is driven purely by what the page's own form adds.
      contacts: [],
    });

    await page.goto('/clients/1');
    await expect(page.getByTestId('client-counts')).toBeVisible();

    // One project and no contacts to begin with.
    await expect(page.getByTestId('client-projects-count')).toHaveText(/\b1\b/);
    await expect(page.getByTestId('client-contacts-count')).toHaveText(/\b0\b/);
    await expect(contactRows(page)).toHaveCount(0);

    // Add a contact through the page's own form.
    await page.getByTestId('contact-form-name').fill('Bob Reed');
    await page.getByTestId('contact-form-email').fill('bob@acme.test');
    await page.getByTestId('contact-form-role').fill('Billing');
    await page.getByTestId('contact-form-submit').click();

    // It joins the list and the contacts count rises to 1; the projects count is unchanged.
    await expect(contactRows(page)).toHaveCount(1);
    await expect(page.getByTestId('client-contacts-count')).toHaveText(/\b1\b/);
    await expect(page.getByTestId('client-projects-count')).toHaveText(/\b1\b/);

    // The new count survives a fresh load from the server.
    await page.reload();
    await expect(page.getByTestId('client-contacts-count')).toHaveText(/\b1\b/);
    await expect(page.getByTestId('client-projects-count')).toHaveText(/\b1\b/);
  });
});
