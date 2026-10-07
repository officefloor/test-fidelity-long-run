// Acceptance test for the change request:
//   "The money I am owed should only count invoices I have actually sent. Do not count drafts."
//
// The dashboard's "money owed" figure (dashboard-outstanding-<currency>, kept separate per currency)
// is the sum of the invoices I have actually SENT and not yet been paid for. An invoice moves through
// DRAFT -> SENT -> PAID
// (see invoice-send.spec). A DRAFT has not been sent, so it is NOT money I am owed and must not be
// counted; a PAID invoice has been settled, so it is not owed either. Only SENT invoices count.
//
// This is a change to how the owed total is computed: before it, an unsent draft would have been
// swept into the figure. The assertions below pin the new rule — drafts are excluded — and then
// demonstrate it dynamically: SENDING a draft (the only way its money becomes owed) grows the owed
// total by exactly that invoice's amount.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email }, `projects` honours { id, name, clientId } and
// `invoices` honours { id, amount, projectId, status }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// A money figure may be rendered bare (550) or dressed up ("$550.00"). Assert the figure CARRIES
// the expected number as a standalone token, so the test binds to the meaning rather than to one
// presentation. The surrounding (^|\D)…(\D|$) keeps a smaller number from matching inside a larger
// one (550 must not satisfy a check for 50, nor 55 match inside 550).
const asToken = (n: number) => new RegExp(`(^|\\D)${n}(\\D|$)`);
const shows = (cell: Locator, n: number) => expect(cell).toContainText(asToken(n));
const hides = (cell: Locator, n: number) => expect(cell).not.toContainText(asToken(n));

const SENT = /\bsent\b/i;

// The clients seeded here carry no currency, so what is owed is owed in the default, USD, and shows
// under dashboard-outstanding-USD. outstandingTotals is the per-currency family, used to assert that
// nothing-owed shows no total at all.
const outstanding = (page: Page) => page.getByTestId('dashboard-outstanding-USD');
const outstandingTotals = (page: Page) =>
  page.locator('[data-testid^="dashboard-outstanding-"]');

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

test.describe('Money owed counts only invoices I have sent, not drafts', () => {
  test('a draft is not money owed: only the sent invoices add up to the owed total', async ({
    page,
  }) => {
    // Across the stages: one DRAFT (70) not yet sent, two SENT and awaiting payment (200 + 55 = 255)
    // and one PAID (400). Money owed is only the SENT pair — 255. The draft is not owed because it
    // has not been sent, and the paid invoice is no longer owed.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [
        { id: 1, name: 'Website Redesign', clientId: 1 },
        { id: 2, name: 'Mobile App', clientId: 1 },
      ],
      invoices: [
        { id: 1, amount: 70, projectId: 1, status: 'DRAFT' },
        { id: 2, amount: 200, projectId: 1, status: 'SENT' },
        { id: 3, amount: 55, projectId: 2, status: 'SENT' },
        { id: 4, amount: 400, projectId: 2, status: 'PAID' },
      ],
    });

    await openDashboard(page);

    // Owed is the two SENT invoices: 200 + 55 = 255.
    await shows(outstanding(page), 255);
    // The unsent draft (70) is NOT counted — this is the heart of the change.
    await hides(outstanding(page), 70);
    // Nor is the paid invoice (400), nor everything ever invoiced (725).
    await hides(outstanding(page), 400);
    await hides(outstanding(page), 725);
    // And it is not "everything not yet paid" (draft + sent = 325): a draft is excluded even though
    // it is unpaid. Nor "everything not a draft" (sent + paid = 655).
    await hides(outstanding(page), 325);
    await hides(outstanding(page), 655);
  });

  test('with only drafts seeded, nothing is owed — no invoice has been sent', async ({ page }) => {
    // Money has been invoiced, but every invoice is still a DRAFT: none has been sent, so nothing is
    // owed. (Previously an unpaid draft would have been counted; now it is not.)
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [
        { id: 1, amount: 300, projectId: 1, status: 'DRAFT' },
        { id: 2, amount: 450, projectId: 1, status: 'DRAFT' },
      ],
    });

    await openDashboard(page);

    // Nothing has been sent, so nothing is owed — in any currency, no per-currency outstanding total
    // is shown, so none of the invoiced drafts (300, 450 or their sum) can appear as an owed total.
    await expect(outstandingTotals(page)).toHaveCount(0);
  });

  test('sending a draft is what makes its money owed — the owed total grows by that amount', async ({
    page,
  }) => {
    // A single DRAFT invoice for 140, not yet sent.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
      invoices: [{ id: 1, amount: 140, projectId: 1, status: 'DRAFT' }],
    });

    // While it is a draft, it is not money owed — nothing is owed in any currency, so no per-currency
    // outstanding total is shown.
    await openDashboard(page);
    await expect(outstandingTotals(page)).toHaveCount(0);

    // Send the invoice — the only way a draft becomes money I am owed.
    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    const send = page.getByTestId('invoice-send-1');
    await expect(send).toBeVisible();
    await send.click();
    await expect(
      page.getByTestId('invoice-row-1').getByTestId('invoice-status'),
    ).toHaveText(SENT);

    // Back on the dashboard the figure now counts it: the owed total is 140.
    await openDashboard(page);
    await shows(outstanding(page), 140);
  });
});
