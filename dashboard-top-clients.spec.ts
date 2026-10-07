// Acceptance test for the change request:
//   "On the home screen show me my top five clients. Rank them by how much they owe."
//
// The home screen is the dashboard (reached from the nav, dashboard-page — the same place the owed
// total and the overdue count live; see dashboard.spec and dashboard-overdue.spec). It gains a new
// region that lists the user's TOP FIVE CLIENTS, ranked by HOW MUCH EACH CLIENT OWES, most first.
// Its anchors:
//   - dashboard-top-clients          — the region that surfaces the list
//   - dashboard-top-clients-loading  — shown while the list's data is being fetched
//   - dashboard-top-clients-error    — shown instead of the list when that data cannot be loaded
//   - top-client-row-<clientId>      — one row per listed client, keyed by the client's id
//   - top-client-name                — that client's name, in the row
//   - top-client-amount              — how much that client owes, in the row
//
// WHAT "OWES" MEANS. "How much they owe" is the client's outstanding balance — exactly the figure the
// app already works out per client (client-statement.spec's client-outstanding-total, and client-sort
// .spec's "by how much they owe" ordering): the sum, across the client's invoices, of each invoice's
// net total minus what has been paid against it. The seeds below keep this unambiguous the same way
// client-sort.spec does — every invoice is SENT, so whether the roll-up counts drafts never arises —
// and the net-of-payments test uses payments (which reduce what is owed on every surface) to prove the
// ranking is on what is STILL owed, not on the gross amount invoiced.
//
// "TOP FIVE" means: of all the clients, the FIVE who owe the most are listed (a sixth, who owes less,
// is dropped), and they are shown most-owed FIRST. The seeded owed amounts are all distinct so the
// ranking — both which five are chosen and the order they appear in — is unambiguous.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email }, `projects` honours { id, name, clientId },
// `invoices` honours { id, amount, projectId, status } and `payments` honours
// { id, invoiceId, amount, date }. This change surfaces no audit records, so there is nothing to
// assert on the audit channel.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// A client's owed amount may be rendered bare (300) or dressed up as money ("$300.00"). Assert the
// cell CARRIES the expected number as a standalone token, so the test binds to the meaning rather
// than to one presentation. The surrounding (^|\D)…(\D|$) keeps a smaller number from matching inside
// a larger one (100 must not satisfy a check inside 1000, nor 50 inside 500). Every figure below stays
// under a thousand, so thousands grouping never arises.
const asToken = (n: number) => new RegExp(`(^|\\D)${n}(\\D|$)`);

const topRows = (page: Page): Locator => page.locator('[data-testid^="top-client-row-"]');
const topRow = (page: Page, clientId: number): Locator =>
  page.getByTestId(`top-client-row-${clientId}`);
const nameCell = (page: Page, clientId: number): Locator =>
  topRow(page, clientId).getByTestId('top-client-name');
const amountCell = (page: Page, clientId: number): Locator =>
  topRow(page, clientId).getByTestId('top-client-amount');

// The client ids of the top-client rows in the order the DOM renders them (top to bottom).
async function rowOrder(page: Page): Promise<number[]> {
  return topRows(page).evaluateAll((els) =>
    els.map((el) => Number(el.getAttribute('data-testid')!.replace('top-client-row-', ''))),
  );
}

// Wait until the rows settle into the expected ranking (the region reads its data asynchronously),
// then report the order that matched for a clear failure message.
async function expectRowOrder(page: Page, expected: number[]): Promise<void> {
  await expect(async () => {
    expect(await rowOrder(page)).toEqual(expected);
  }).toPass();
}

// Reach the dashboard the way a user would — follow its nav link from the home screen — rather than
// pinning the dashboard's URL.
async function openDashboard(page: Page): Promise<void> {
  await page.goto('/');
  const nav = page.getByTestId('nav-dashboard');
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toBeVisible();
}

test.describe('Dashboard: my top five clients, ranked by how much they owe', () => {
  test('the dashboard surfaces a top-clients region', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Beacon Labs', email: 'hello@beacon.test' },
      ],
      projects: [
        { id: 1, name: 'Acme Project', clientId: 1 },
        { id: 2, name: 'Beacon Project', clientId: 2 },
      ],
      invoices: [
        { id: 1, amount: 300, projectId: 1, status: 'SENT' },
        { id: 2, amount: 200, projectId: 2, status: 'SENT' },
      ],
    });

    await openDashboard(page);

    // The region is present on the home screen and lists the clients that owe.
    await expect(page.getByTestId('dashboard-top-clients')).toBeVisible();
    await expect(topRow(page, 1)).toBeVisible();
    await expect(topRow(page, 2)).toBeVisible();
  });

  test('lists the five highest owers, most first, dropping the client who owes least', async ({
    page,
  }) => {
    // Six clients, each with one project and one SENT, unpaid invoice, so each owes exactly its
    // invoice's amount. The amounts are all distinct, so the ranking is unambiguous:
    //   Cobalt (3) 900, Delta (4) 700, Acme (1) 500, Evergreen (5) 300, Beacon (2) 100, Flint (6) 50.
    // The top five are everyone except Flint (the least owed); they appear most-owed first.
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Beacon Labs', email: 'hello@beacon.test' },
        { id: 3, name: 'Cobalt Studio', email: 'hello@cobalt.test' },
        { id: 4, name: 'Delta Works', email: 'hello@delta.test' },
        { id: 5, name: 'Evergreen Co', email: 'hello@evergreen.test' },
        { id: 6, name: 'Flint Partners', email: 'hello@flint.test' },
      ],
      projects: [
        { id: 1, name: 'Acme Project', clientId: 1 },
        { id: 2, name: 'Beacon Project', clientId: 2 },
        { id: 3, name: 'Cobalt Project', clientId: 3 },
        { id: 4, name: 'Delta Project', clientId: 4 },
        { id: 5, name: 'Evergreen Project', clientId: 5 },
        { id: 6, name: 'Flint Project', clientId: 6 },
      ],
      invoices: [
        { id: 1, amount: 500, projectId: 1, status: 'SENT' },
        { id: 2, amount: 100, projectId: 2, status: 'SENT' },
        { id: 3, amount: 900, projectId: 3, status: 'SENT' },
        { id: 4, amount: 700, projectId: 4, status: 'SENT' },
        { id: 5, amount: 300, projectId: 5, status: 'SENT' },
        { id: 6, amount: 50, projectId: 6, status: 'SENT' },
      ],
    });

    await openDashboard(page);
    await expect(page.getByTestId('dashboard-top-clients')).toBeVisible();

    // Exactly five clients are listed — the top five owers — and in most-owed-first order.
    await expect(topRows(page)).toHaveCount(5);
    await expectRowOrder(page, [3, 4, 1, 5, 2]);

    // Each listed row names its client and shows what that client owes.
    await expect(nameCell(page, 3)).toContainText('Cobalt Studio');
    await expect(amountCell(page, 3)).toContainText(asToken(900));
    await expect(nameCell(page, 4)).toContainText('Delta Works');
    await expect(amountCell(page, 4)).toContainText(asToken(700));
    await expect(nameCell(page, 1)).toContainText('Acme Corp');
    await expect(amountCell(page, 1)).toContainText(asToken(500));
    await expect(nameCell(page, 5)).toContainText('Evergreen Co');
    await expect(amountCell(page, 5)).toContainText(asToken(300));
    await expect(nameCell(page, 2)).toContainText('Beacon Labs');
    await expect(amountCell(page, 2)).toContainText(asToken(100));

    // The sixth client — who owes the least — is dropped: no row, name or amount for it anywhere in
    // the region.
    await expect(topRow(page, 6)).toHaveCount(0);
    await expect(page.getByTestId('dashboard-top-clients')).not.toContainText('Flint Partners');
    await expect(page.getByTestId('dashboard-top-clients')).not.toContainText(asToken(50));
  });

  test('ranks by what is still owed — net of payments, not the gross amount invoiced', async ({
    page,
  }) => {
    // Three clients whose GROSS invoiced order and NET owed order are different permutations, so the
    // observed ranking tells us which the list is keyed on:
    //   Grandview (1): 900 invoiced, 800 paid -> owes 100   (most invoiced, least still owed)
    //   Harbor    (2): 500 invoiced, 100 paid -> owes 400   (most still owed)
    //   Ironside  (3): 300 invoiced, nothing  -> owes 300
    // Ranked by what is STILL owed, most first: Harbor 400, Ironside 300, Grandview 100 -> [2, 3, 1].
    // Ranked by the GROSS invoiced it would be [1, 2, 3] — a different order, which this must NOT be.
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Grandview Group', email: 'hello@grandview.test' },
        { id: 2, name: 'Harbor Ltd', email: 'hello@harbor.test' },
        { id: 3, name: 'Ironside Inc', email: 'hello@ironside.test' },
      ],
      projects: [
        { id: 1, name: 'Grandview Project', clientId: 1 },
        { id: 2, name: 'Harbor Project', clientId: 2 },
        { id: 3, name: 'Ironside Project', clientId: 3 },
      ],
      invoices: [
        { id: 1, amount: 900, projectId: 1, status: 'SENT' },
        { id: 2, amount: 500, projectId: 2, status: 'SENT' },
        { id: 3, amount: 300, projectId: 3, status: 'SENT' },
      ],
      payments: [
        { id: 1, invoiceId: 1, amount: 800, date: '2021-03-14' },
        { id: 2, invoiceId: 2, amount: 100, date: '2021-06-20' },
      ],
    });

    await openDashboard(page);
    await expect(page.getByTestId('dashboard-top-clients')).toBeVisible();

    // The ranking follows what is STILL owed (net of payments), not the gross amount invoiced.
    await expect(topRows(page)).toHaveCount(3);
    await expectRowOrder(page, [2, 3, 1]);

    // And each amount is the net owed, not the gross invoiced.
    await expect(amountCell(page, 2)).toContainText(asToken(400));
    await expect(amountCell(page, 3)).toContainText(asToken(300));
    await expect(amountCell(page, 1)).toContainText(asToken(100));
    // Grandview's figure is its remaining 100, NOT the 900 it was invoiced.
    await expect(amountCell(page, 1)).not.toContainText(asToken(900));
  });

  test('with fewer than five clients it lists them all, still ranked by what they owe', async ({
    page,
  }) => {
    // Only three clients exist, so all three are listed — "top five" never truncates below what is
    // there — and still ordered most-owed first: Vertex 300, Willow 200, Umbra 100 -> [2, 3, 1].
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Umbra Co', email: 'hello@umbra.test' },
        { id: 2, name: 'Vertex Inc', email: 'hello@vertex.test' },
        { id: 3, name: 'Willow Ltd', email: 'hello@willow.test' },
      ],
      projects: [
        { id: 1, name: 'Umbra Project', clientId: 1 },
        { id: 2, name: 'Vertex Project', clientId: 2 },
        { id: 3, name: 'Willow Project', clientId: 3 },
      ],
      invoices: [
        { id: 1, amount: 100, projectId: 1, status: 'SENT' },
        { id: 2, amount: 300, projectId: 2, status: 'SENT' },
        { id: 3, amount: 200, projectId: 3, status: 'SENT' },
      ],
    });

    await openDashboard(page);
    await expect(page.getByTestId('dashboard-top-clients')).toBeVisible();

    await expect(topRows(page)).toHaveCount(3);
    await expectRowOrder(page, [2, 3, 1]);
    await expect(amountCell(page, 2)).toContainText(asToken(300));
    await expect(amountCell(page, 3)).toContainText(asToken(200));
    await expect(amountCell(page, 1)).toContainText(asToken(100));
  });

  test('while its data is loading it shows a loading indicator, then the clients', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Beacon Labs', email: 'hello@beacon.test' },
      ],
      projects: [
        { id: 1, name: 'Acme Project', clientId: 1 },
        { id: 2, name: 'Beacon Project', clientId: 2 },
      ],
      invoices: [
        { id: 1, amount: 300, projectId: 1, status: 'SENT' },
        { id: 2, amount: 200, projectId: 2, status: 'SENT' },
      ],
    });

    // The home screen itself serves no data, so reach it first, then slow the dashboard's data
    // fetches so the top-clients region's loading state is observable before it resolves.
    await page.goto('/');
    await page.route('**/api/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });

    const nav = page.getByTestId('nav-dashboard');
    await expect(nav).toBeVisible();
    await nav.click();

    await expect(page.getByTestId('dashboard-page')).toBeVisible();
    // While the list is still being fetched, its loading indicator is shown.
    await expect(page.getByTestId('dashboard-top-clients-loading')).toBeVisible();

    // Once the data arrives the loading indicator gives way to the real rows.
    await expect(topRow(page, 1)).toBeVisible();
    await expect(page.getByTestId('dashboard-top-clients-loading')).toHaveCount(0);
  });

  test('when its data cannot be loaded it shows an error instead of a made-up list', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Acme Project', clientId: 1 }],
      invoices: [{ id: 1, amount: 300, projectId: 1, status: 'SENT' }],
    });

    // Reach the home screen (it serves no data), then make the data fetches the list relies on fail,
    // and open the dashboard.
    await page.goto('/');
    await page.route('**/api/**', (route) => route.abort());

    const nav = page.getByTestId('nav-dashboard');
    await expect(nav).toBeVisible();
    await nav.click();

    await expect(page.getByTestId('dashboard-page')).toBeVisible();

    // The failure is surfaced as an error, and no clients are listed — the region does not invent a
    // list when it could not load the data.
    await expect(page.getByTestId('dashboard-top-clients-error')).toBeVisible();
    await expect(topRows(page)).toHaveCount(0);
  });
});
