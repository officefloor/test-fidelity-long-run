// Acceptance test for the change request:
//   "I want a home screen. Show me how many clients and projects I have. Show me how much money I
//    am still owed."
//
// A new dashboard page (dashboard-page, holding the dashboard region) is reachable from the nav
// (nav-dashboard). It summarises the whole app through three figures:
//   - dashboard-clients-count     — how many clients there are
//   - dashboard-projects-count    — how many projects there are
//   - dashboard-outstanding-<currency> — how much money is STILL OWED, kept separate per currency
//                                   (one total per currency), i.e. the amount of the invoices I have
//                                   actually SENT and not yet been paid for. A DRAFT has not been
//                                   sent, so it is not money I am owed; a PAID invoice is no longer
//                                   owed. Only SENT invoices count. The clients seeded here carry no
//                                   currency, so what is owed is owed in the default, USD, and shows
//                                   under dashboard-outstanding-USD.
// While its data is loading it shows dashboard-loading, and if that data cannot be loaded it shows
// dashboard-error instead of fabricating figures.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email }, `projects` honours { id, name, clientId } and
// `invoices` honours { id, amount, projectId, status }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// A count or a money figure may be rendered bare (3, 350) or dressed up ("3 clients", "$350.00").
// Assert the figure CARRIES the expected number as a standalone token, so the test binds to the
// meaning rather than to one presentation. The surrounding (^|\D)…(\D|$) keeps a smaller number
// from matching inside a larger one (350 must not satisfy a check for 50, nor 0 match inside 350).
const asToken = (n: number) => new RegExp(`(^|\\D)${n}(\\D|$)`);

const shows = (cell: Locator, n: number) => expect(cell).toContainText(asToken(n));
const hides = (cell: Locator, n: number) => expect(cell).not.toContainText(asToken(n));

const clientsCount = (page: Page) => page.getByTestId('dashboard-clients-count');
const projectsCount = (page: Page) => page.getByTestId('dashboard-projects-count');
const outstanding = (page: Page) => page.getByTestId('dashboard-outstanding-USD');
// The per-currency outstanding totals as a family, addressed by their shared prefix — used to assert
// that nothing-owed shows no total at all.
const outstandingTotals = (page: Page) =>
  page.locator('[data-testid^="dashboard-outstanding-"]');

// Reach the dashboard the way a user would: follow its nav link from the home screen. This avoids
// pinning the dashboard's URL — the contract is the nav link and the page it lands on.
async function openDashboard(page: Page): Promise<void> {
  await page.goto('/');
  const nav = page.getByTestId('nav-dashboard');
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
}

test.describe('Dashboard home screen', () => {
  test('a link in the nav opens the dashboard', async ({ page }) => {
    await resetAndSeed({ clients: [], projects: [], invoices: [] });

    await page.goto('/');
    // The shell is present.
    await expect(page.getByTestId('app-root')).toBeVisible();
    await expect(page.getByTestId('app-nav')).toBeVisible();

    // The dashboard is reachable from the nav; following it lands on the dashboard page.
    const nav = page.getByTestId('nav-dashboard');
    await expect(nav).toBeVisible();
    await nav.click();

    await expect(page.getByTestId('dashboard-page')).toBeVisible();
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });

  test('shows how many clients and projects there are, and how much is still owed', async ({
    page,
  }) => {
    // 3 clients, 2 projects. Money owed counts only the invoices I have actually SENT: two are sent
    // (120 + 230 = 350 still owed). A DRAFT (170) has not been sent yet, and a PAID invoice (400) is
    // already settled, so neither is money I am owed. The total ever invoiced is 920 — the dashboard
    // must show the 350 that is OWED, not the 920 invoiced, not the 400 already paid, and not the
    // 170 sitting in an unsent draft.
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
        { id: 3, name: 'Initech', email: 'info@initech.test' },
      ],
      projects: [
        { id: 1, name: 'Website Redesign', clientId: 1 },
        { id: 2, name: 'Mobile App', clientId: 2 },
      ],
      invoices: [
        { id: 1, amount: 120, projectId: 1, status: 'SENT' },
        { id: 2, amount: 230, projectId: 1, status: 'SENT' },
        { id: 3, amount: 400, projectId: 2, status: 'PAID' },
        { id: 4, amount: 170, projectId: 1, status: 'DRAFT' },
      ],
    });

    await openDashboard(page);

    // How many clients and projects I have.
    await shows(clientsCount(page), 3);
    await shows(projectsCount(page), 2);

    // How much money I am still owed: the SENT invoices add up to 350.
    await shows(outstanding(page), 350);
    // It is the amount OWED — not the total ever invoiced (920), not the amount already paid (400),
    // and not the unsent draft (170), which is not money I am owed. Nor is it drafts-and-sent lumped
    // together (520): only what has actually been sent counts.
    await hides(outstanding(page), 920);
    await hides(outstanding(page), 400);
    await hides(outstanding(page), 170);
    await hides(outstanding(page), 520);
  });

  test('with nothing seeded it shows no clients, no projects and nothing owed', async ({ page }) => {
    await resetAndSeed({ clients: [], projects: [], invoices: [] });

    await openDashboard(page);

    await shows(clientsCount(page), 0);
    await shows(projectsCount(page), 0);
    // Nothing is owed in any currency, so there is no per-currency outstanding total to show.
    await expect(outstandingTotals(page)).toHaveCount(0);
  });

  test('money still owed counts only sent invoices — paid work and unsent drafts owe nothing', async ({
    page,
  }) => {
    // There are clients and projects with invoices, but none has been SENT-and-not-yet-paid: two are
    // already PAID and one is still a DRAFT that has not been sent. So nothing is still owed even
    // though money has been invoiced.
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      projects: [
        { id: 1, name: 'Website Redesign', clientId: 1 },
        { id: 2, name: 'Mobile App', clientId: 2 },
      ],
      invoices: [
        { id: 1, amount: 400, projectId: 1, status: 'PAID' },
        { id: 2, amount: 350, projectId: 2, status: 'PAID' },
        { id: 3, amount: 500, projectId: 1, status: 'DRAFT' },
      ],
    });

    await openDashboard(page);

    await shows(clientsCount(page), 2);
    await shows(projectsCount(page), 2);

    // Nothing is still owed: the paid invoices and the unsent draft are not money owed. With no owed
    // money in any currency, no per-currency outstanding total is shown at all — so none of the
    // invoiced figures (the paid pair, the draft, or their sums) can appear as an owed total.
    await expect(outstandingTotals(page)).toHaveCount(0);
  });

  test('while its data is loading it shows a loading indicator, then the figures', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
        { id: 3, name: 'Initech', email: 'info@initech.test' },
      ],
      projects: [
        { id: 1, name: 'Website Redesign', clientId: 1 },
        { id: 2, name: 'Mobile App', clientId: 2 },
      ],
      invoices: [{ id: 1, amount: 350, projectId: 1, status: 'SENT' }],
    });

    // The home screen itself serves no data, so reach it first, then slow the dashboard's own data
    // fetches so its loading state is observable before they resolve against the real server.
    await page.goto('/');
    await page.route('**/api/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });

    const nav = page.getByTestId('nav-dashboard');
    await expect(nav).toBeVisible();
    await nav.click();

    await expect(page.getByTestId('dashboard-page')).toBeVisible();
    // While the figures are still being fetched, the loading indicator is shown.
    await expect(page.getByTestId('dashboard-loading')).toBeVisible();

    // Once the data arrives the loading indicator gives way to the real figures.
    await shows(clientsCount(page), 3);
    await shows(projectsCount(page), 2);
    await shows(outstanding(page), 350);
    await expect(page.getByTestId('dashboard-loading')).toHaveCount(0);
  });

  test('when its data cannot be loaded it shows an error instead of made-up figures', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 350, projectId: 1, status: 'SENT' }],
    });

    // Reach the home screen (it serves no data), then make every data fetch the dashboard relies on
    // fail, and open the dashboard.
    await page.goto('/');
    await page.route('**/api/**', (route) => route.abort());

    const nav = page.getByTestId('nav-dashboard');
    await expect(nav).toBeVisible();
    await nav.click();

    await expect(page.getByTestId('dashboard-page')).toBeVisible();

    // The failure is surfaced as an error, and no figures are shown — the dashboard does not invent
    // numbers when it could not load the data.
    await expect(page.getByTestId('dashboard-error')).toBeVisible();
    await expect(clientsCount(page)).toHaveCount(0);
    await expect(projectsCount(page)).toHaveCount(0);
    await expect(outstandingTotals(page)).toHaveCount(0);
  });
});
