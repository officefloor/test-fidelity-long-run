// Acceptance tests for the change request:
//   "On a client's page show me how many projects and contacts they have."
//
// Opening a client (client-open-<id> from the clients list) reaches that client's detail page,
// which now carries a counts region (client-counts) surfacing two numbers: how many projects the
// client has (client-projects-count) and how many contacts they have (client-contacts-count).
// The counts reflect ONLY that client's own projects and contacts — another client's rows must not
// inflate them — and a client with none of their own shows zero.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed. Seed honours
// clients: { id, name, email }, projects: { id, clientId, name } and contacts:
// { id, clientId, name, email, role }. The count text is matched with a word-boundary regex so the
// assertion pins the NUMBER without over-constraining the surrounding wording.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

test.describe('client counts', () => {
  test("a client's page shows how many projects and contacts they have", async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example' },
        { id: 2, name: 'Globex', email: 'hello@globex.example' },
      ],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign' },
        { id: 2, clientId: 1, name: 'Mobile app' },
        // Belongs to a DIFFERENT client — must not be counted on client 1's page.
        { id: 3, clientId: 2, name: 'Warehouse automation' },
      ],
      contacts: [
        { id: 1, clientId: 1, name: 'Dana Wells', email: 'dana@acme.example', role: 'Billing lead' },
        { id: 2, clientId: 1, name: 'Omar Reed', email: 'omar@acme.example', role: 'Engineering' },
        { id: 3, clientId: 1, name: 'Mia Fox', email: 'mia@acme.example', role: 'Design' },
        // Belongs to a DIFFERENT client — must not be counted on client 1's page.
        { id: 4, clientId: 2, name: 'Priya Shah', email: 'priya@globex.example', role: 'Procurement' },
      ],
    });

    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-counts')).toBeVisible();

    // Client 1 has 2 projects of their own (client 2's project does not count).
    await expect(page.getByTestId('client-projects-count')).toContainText(/\b2\b/);
    // Client 1 has 3 contacts of their own (client 2's contact does not count).
    await expect(page.getByTestId('client-contacts-count')).toContainText(/\b3\b/);
  });

  test("a client with no projects or contacts of their own shows zero for each", async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example' },
        { id: 2, name: 'Globex', email: 'hello@globex.example' },
      ],
      projects: [
        // Belongs to the OTHER client — client 1 still has zero.
        { id: 1, clientId: 2, name: 'Warehouse automation' },
      ],
      contacts: [
        // Belongs to the OTHER client — client 1 still has zero.
        { id: 1, clientId: 2, name: 'Priya Shah', email: 'priya@globex.example', role: 'Procurement' },
      ],
    });

    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();

    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-counts')).toBeVisible();

    await expect(page.getByTestId('client-projects-count')).toContainText(/\b0\b/);
    await expect(page.getByTestId('client-contacts-count')).toContainText(/\b0\b/);
  });

  test("each client's page shows its own counts", async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example' },
        { id: 2, name: 'Globex', email: 'hello@globex.example' },
      ],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign' },
        { id: 2, clientId: 2, name: 'Warehouse automation' },
        { id: 3, clientId: 2, name: 'Logistics portal' },
      ],
      contacts: [
        { id: 1, clientId: 1, name: 'Dana Wells', email: 'dana@acme.example', role: 'Billing lead' },
        { id: 2, clientId: 1, name: 'Omar Reed', email: 'omar@acme.example', role: 'Engineering' },
        { id: 3, clientId: 2, name: 'Priya Shah', email: 'priya@globex.example', role: 'Procurement' },
      ],
    });

    // Client 1: 1 project, 2 contacts.
    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();
    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-projects-count')).toContainText(/\b1\b/);
    await expect(page.getByTestId('client-contacts-count')).toContainText(/\b2\b/);

    // Client 2: 2 projects, 1 contact.
    await page.goto('/clients');
    await page.getByTestId('client-open-2').click();
    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-projects-count')).toContainText(/\b2\b/);
    await expect(page.getByTestId('client-contacts-count')).toContainText(/\b1\b/);
  });
});
