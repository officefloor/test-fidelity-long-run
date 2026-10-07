// Acceptance test for the change request:
//   "On the home screen tell me how many sent invoices are overdue."
//
// The dashboard (reached from the nav, dashboard-page) gains a figure that counts the invoices that
// are OVERDUE: invoices I have actually SENT whose DUE DATE has passed and which are not yet paid.
// It lives in its own region with these anchors:
//   - dashboard-overdue        — the region that surfaces the figure
//   - dashboard-overdue-count  — how many sent invoices are overdue
//   - dashboard-overdue-loading — shown while that figure's data is being fetched
//   - dashboard-overdue-error  — shown instead of a figure when that data cannot be loaded
//
// What makes an invoice overdue:
//   - it has been SENT (a DRAFT has not gone out, so it cannot be overdue; a PAID invoice is settled,
//     so it is not overdue either), AND
//   - its due date is in the past relative to "now".
// The due dates below are chosen far in the past (overdue) or far in the future (not yet due) so the
// classification is unambiguous whatever "now" is; `asOf` pins "now" explicitly for the same reason.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email }, `projects` honours { id, name, clientId },
// `invoices` honours { id, amount, projectId, status, dueDate }, and `asOf` fixes the reference date.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// A count may be rendered bare (2) or dressed up ("2 overdue"). Assert the figure CARRIES the
// expected number as a standalone token, so the test binds to the meaning rather than to one
// presentation. The surrounding (^|\D)…(\D|$) keeps a smaller number from matching inside a larger
// one (2 must not satisfy a check for a stray digit inside, say, 12).
const asToken = (n: number) => new RegExp(`(^|\\D)${n}(\\D|$)`);
const shows = (cell: Locator, n: number) => expect(cell).toContainText(asToken(n));
const hides = (cell: Locator, n: number) => expect(cell).not.toContainText(asToken(n));

const overdueCount = (page: Page) => page.getByTestId('dashboard-overdue-count');

// "now" for the test — a fixed reference date so overdue is deterministic. Every "past" due date
// seeded below is years before it and every "future" due date years after it.
const AS_OF = '2026-06-15';
const PAST = '2020-03-10'; // comfortably before AS_OF — overdue when the invoice has been sent
const PAST2 = '2021-07-22';
const FUTURE = '2099-11-20'; // comfortably after AS_OF — not yet due

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

test.describe('Dashboard: how many sent invoices are overdue', () => {
  test('counts the sent invoices whose due date has passed — not drafts, paid, or not-yet-due', async ({
    page,
  }) => {
    // Five invoices on one project:
    //   1 SENT,  due in the past   -> overdue
    //   2 SENT,  due in the past   -> overdue
    //   3 SENT,  due in the future -> NOT overdue (not yet due)
    //   4 DRAFT, due in the past   -> NOT overdue (never sent, so it cannot be overdue)
    //   5 PAID,  due in the past   -> NOT overdue (already settled)
    // So exactly 2 sent invoices are overdue.
    await resetAndSeed({
      asOf: AS_OF,
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 100, projectId: 1, status: 'SENT', dueDate: PAST },
        { id: 2, amount: 200, projectId: 1, status: 'SENT', dueDate: PAST2 },
        { id: 3, amount: 300, projectId: 1, status: 'SENT', dueDate: FUTURE },
        { id: 4, amount: 400, projectId: 1, status: 'DRAFT', dueDate: PAST },
        { id: 5, amount: 500, projectId: 1, status: 'PAID', dueDate: PAST },
      ],
    });

    await openDashboard(page);

    // The overdue region is present and shows the count.
    await expect(page.getByTestId('dashboard-overdue')).toBeVisible();

    // Exactly the two sent-and-past-due invoices are counted.
    await shows(overdueCount(page), 2);
    // Not the inverted rule — sent-but-not-yet-due (1) is not what "overdue" means.
    await hides(overdueCount(page), 1);
    // Not "every sent invoice" (3), which would wrongly sweep in the not-yet-due one.
    await hides(overdueCount(page), 3);
    // Not "every past-due invoice regardless of status" (4), which would wrongly count the unsent
    // draft and the already-paid invoice.
    await hides(overdueCount(page), 4);
    // Not every invoice (5), and not "none" (0).
    await hides(overdueCount(page), 5);
    await hides(overdueCount(page), 0);
  });

  test('shows zero when no sent invoice is past due', async ({ page }) => {
    // Money has been invoiced and past-due invoices exist, but none that is BOTH sent AND past due:
    // the one sent invoice is not yet due, the past-due draft was never sent, and the past-due paid
    // invoice is settled. So nothing is overdue.
    await resetAndSeed({
      asOf: AS_OF,
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 100, projectId: 1, status: 'SENT', dueDate: FUTURE },
        { id: 2, amount: 200, projectId: 1, status: 'DRAFT', dueDate: PAST },
        { id: 3, amount: 300, projectId: 1, status: 'PAID', dueDate: PAST },
      ],
    });

    await openDashboard(page);

    await expect(page.getByTestId('dashboard-overdue')).toBeVisible();
    await shows(overdueCount(page), 0);
    // It did not count the not-yet-due sent one, the unsent draft, or the paid invoice.
    await hides(overdueCount(page), 1);
    await hides(overdueCount(page), 3);
  });

  test('sending a past-due draft is what makes it overdue — the count grows by one', async ({
    page,
  }) => {
    // A single DRAFT invoice whose due date is already in the past. While it is a draft it has not
    // gone out, so it is not overdue even though its due date has passed.
    await resetAndSeed({
      asOf: AS_OF,
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 140, projectId: 1, status: 'DRAFT', dueDate: PAST }],
    });

    await openDashboard(page);
    await shows(overdueCount(page), 0);
    await hides(overdueCount(page), 1);

    // Send the invoice — the only way it becomes one I have actually sent.
    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    const send = page.getByTestId('invoice-send-1');
    await expect(send).toBeVisible();
    await send.click();
    await expect(page.getByTestId('invoice-row-1').getByTestId('invoice-status')).toHaveText(
      /\bsent\b/i,
    );

    // Now that it has been sent and its due date is in the past, it is overdue: the count is 1.
    await openDashboard(page);
    await shows(overdueCount(page), 1);
    await hides(overdueCount(page), 0);
  });

  test('while its data is loading it shows a loading indicator, then the count', async ({ page }) => {
    await resetAndSeed({
      asOf: AS_OF,
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 100, projectId: 1, status: 'SENT', dueDate: PAST }],
    });

    // The home screen itself serves no data, so reach it first, then slow the dashboard's data
    // fetches so the overdue figure's loading state is observable before it resolves.
    await page.goto('/');
    await page.route('**/api/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });

    const nav = page.getByTestId('nav-dashboard');
    await expect(nav).toBeVisible();
    await nav.click();

    await expect(page.getByTestId('dashboard-page')).toBeVisible();
    // While the figure is still being fetched, its loading indicator is shown.
    await expect(page.getByTestId('dashboard-overdue-loading')).toBeVisible();

    // Once the data arrives the loading indicator gives way to the real count.
    await shows(overdueCount(page), 1);
    await expect(page.getByTestId('dashboard-overdue-loading')).toHaveCount(0);
  });

  test('when its data cannot be loaded it shows an error instead of a made-up count', async ({
    page,
  }) => {
    await resetAndSeed({
      asOf: AS_OF,
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 100, projectId: 1, status: 'SENT', dueDate: PAST }],
    });

    // Reach the home screen (it serves no data), then make the data fetches the figure relies on
    // fail, and open the dashboard.
    await page.goto('/');
    await page.route('**/api/**', (route) => route.abort());

    const nav = page.getByTestId('nav-dashboard');
    await expect(nav).toBeVisible();
    await nav.click();

    await expect(page.getByTestId('dashboard-page')).toBeVisible();

    // The failure is surfaced as an error, and no count is shown — the figure does not invent a
    // number when it could not load the data.
    await expect(page.getByTestId('dashboard-overdue-error')).toBeVisible();
    await expect(overdueCount(page)).toHaveCount(0);
  });
});
