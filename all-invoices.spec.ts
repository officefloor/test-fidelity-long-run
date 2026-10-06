// Acceptance test for the change request:
//   "Give me one place that lists all my invoices from every project. Show which project each one
//    is for. Show what stage it is at."
//
// A NEW page (invoices-page), reachable from the nav (nav-invoices), lists EVERY invoice in the
// app in ONE place — invoices from every project, not scoped to a single project the way the
// project detail page is. Each invoice is shown with WHICH PROJECT it is for (invoice-project,
// carrying the project's NAME, not an id) and WHAT STAGE it is at (invoice-status, the draft →
// sent → paid stage). When there are no invoices at all it shows an empty state
// (all-invoices-empty) instead of the table (all-invoices-table).
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's
// /__test__ endpoint): `clients` honours { id, name, email }, `projects` honours
// { id, name, clientId } and `invoices` honours { id, amount, projectId, status }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

const invoiceRows = (page: Page) => page.locator('[data-testid^="invoice-row-"]');

// Each stage's status cell is matched by the WORD that names the stage, case-insensitively, so the
// test binds to the MEANING and not one capitalisation ("Draft"/"DRAFT"/"draft" all count). The
// word boundaries keep the three stages distinct from one another.
const DRAFT = /\bdraft\b/i;
const SENT = /\bsent\b/i;
const PAID = /\bpaid\b/i;

const projectOf = (page: Page, id: number): Locator =>
  page.getByTestId(`invoice-row-${id}`).getByTestId('invoice-project');
const statusOf = (page: Page, id: number): Locator =>
  page.getByTestId(`invoice-row-${id}`).getByTestId('invoice-status');

// Reach the invoices page the way a user would: follow its nav link from the home screen. This
// avoids pinning the page's own URL — the contract is the nav link and the page it lands on.
async function openAllInvoices(page: Page): Promise<void> {
  await page.goto('/');
  const nav = page.getByTestId('nav-invoices');
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(page.getByTestId('invoices-page')).toBeVisible();
}

test.describe('All invoices in one place', () => {
  test('a link in the nav opens the invoices page', async ({ page }) => {
    await resetAndSeed({ clients: [], projects: [], invoices: [] });

    await page.goto('/');
    // The shell is present.
    await expect(page.getByTestId('app-root')).toBeVisible();
    await expect(page.getByTestId('app-nav')).toBeVisible();

    // The invoices page is reachable from the nav; following it lands on that page.
    const nav = page.getByTestId('nav-invoices');
    await expect(nav).toBeVisible();
    await nav.click();

    await expect(page.getByTestId('invoices-page')).toBeVisible();
  });

  test('lists every invoice from every project, each with its project and its stage', async ({
    page,
  }) => {
    // Two clients, three projects, and invoices spread across ALL THREE projects. The project names
    // are chosen so none is a substring of another, so "which project" is pinned unambiguously.
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
      invoices: [
        { id: 1, amount: 100, projectId: 1, status: 'DRAFT' },
        { id: 2, amount: 250, projectId: 2, status: 'SENT' },
        { id: 3, amount: 500, projectId: 3, status: 'PAID' },
        // A second invoice on project 2 — two invoices for one project both show that project.
        { id: 4, amount: 750, projectId: 2, status: 'DRAFT' },
      ],
    });

    await openAllInvoices(page);

    // One place holding the table of all invoices.
    await expect(page.getByTestId('all-invoices-table')).toBeVisible();
    await expect(page.getByTestId('all-invoices-empty')).toHaveCount(0);

    // Every seeded invoice — drawn from every project — appears in this one list.
    await expect(invoiceRows(page)).toHaveCount(4);

    // Each invoice shows WHICH PROJECT it is for (the project's name) and WHAT STAGE it is at.
    await expect(projectOf(page, 1)).toHaveText('Website Redesign');
    await expect(statusOf(page, 1)).toHaveText(DRAFT);

    await expect(projectOf(page, 2)).toHaveText('Mobile App');
    await expect(statusOf(page, 2)).toHaveText(SENT);

    await expect(projectOf(page, 3)).toHaveText('Billing System');
    await expect(statusOf(page, 3)).toHaveText(PAID);

    // The two invoices that belong to the same project both name that project.
    await expect(projectOf(page, 4)).toHaveText('Mobile App');
    await expect(statusOf(page, 4)).toHaveText(DRAFT);
  });

  test('with no invoices anywhere it shows an empty state and no table', async ({ page }) => {
    // There are clients and projects, but not a single invoice on any of them.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [],
    });

    await openAllInvoices(page);

    // No invoices exist, so the empty state is shown and nothing is listed.
    await expect(page.getByTestId('all-invoices-empty')).toBeVisible();
    await expect(invoiceRows(page)).toHaveCount(0);
  });
});
