// Acceptance tests for the change request:
//   "On the home screen show me my top five clients. Rank them by how much they owe."
//
// The home screen is the dashboard (dashboard.spec.ts: it is reached from the nav via nav-dashboard
// and renders dashboard-page). This change adds a TOP-CLIENTS panel to it (dashboard-top-clients,
// with its own dashboard-top-clients-loading / dashboard-top-clients-error states — it queries for
// itself, like the overdue tile in dashboard-overdue.spec.ts). The panel lists AT MOST FIVE clients,
// the ones who owe the most, ranked by HOW MUCH THEY OWE, most first. Each row
// (top-client-row-<clientId>) shows that client's NAME (top-client-name) and the amount they owe
// (top-client-amount).
//
// "How much a client owes" carries the app's established owed meaning (client-statement.spec.ts's
// client-outstanding-total, invoice-owed-sent-only.spec.ts, discount-owed.spec.ts): the sum, across
// ALL of that client's invoices, of each SENT-but-unpaid invoice's REMAINING balance — the invoice's
// (discounted) total minus what has been paid on it. A DRAFT has not gone out, so it is not yet owed;
// a PAID invoice is already in, so it adds nothing. So a client's owed figure is NOT their total
// billed and NOT their total ignoring payments or stage — the fixtures below make those wrong
// readings produce a visibly different ranking.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed, which honours
// clients { id, name, email }, projects { id, clientId, name }, invoices { id, projectId, amount,
// status } and payments { id, invoiceId, amount, date }. This change introduces NO new audit record,
// so nothing is asserted through the audit channel.
//
// top-client-amount is a NEW money anchor (not one of the three money-format.spec.ts pins exactly),
// so it is matched leniently the way the sibling new money anchors are — a leading "$" and a trailing
// ".00" both optional. All owed figures are kept under a thousand so the thousands separator
// (money-thousands-separator.spec.ts) is not in play. Amounts and names are chosen so that every
// plausible WRONG ranking (by total billed, ignoring payments, or counting drafts / paid invoices)
// pulls a different set of clients into the top five and/or a different order, so each assertion
// pins the sent-and-net-of-payments reading specifically. This SHOULD FAIL before the change: there
// is no top-clients panel on the dashboard today.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// "$500.00", "500.00" or "500" all pass — the "$" and the ".00" cents are both optional, exactly as
// the other NEW money anchors (statement / invoice-due) are matched; exact presentation is pinned
// elsewhere by money-format.spec.ts.
function money(amount: number): RegExp {
  return new RegExp(`^\\$?${amount}(\\.00)?$`);
}

// Reach the home screen (the dashboard) through its nav link — the nav entry is the stable contract
// (nav-dashboard), the concrete path is the feature's own choice — and wait for the top-clients
// panel's OWN data to settle (it queries for itself).
async function openTopClients(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-root')).toBeVisible();
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();

  await expect(page.getByTestId('dashboard-top-clients')).toBeVisible();
  await expect(page.getByTestId('dashboard-top-clients-loading')).toHaveCount(0);
  await expect(page.getByTestId('dashboard-top-clients-error')).toHaveCount(0);
  return page.getByTestId('dashboard-top-clients');
}

test.describe('home screen: top five clients ranked by how much they owe', () => {
  test('shows the five biggest debtors, most owed first, and no one else', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example' },
        { id: 2, name: 'Globex', email: 'hello@globex.example' },
        { id: 3, name: 'Initech', email: 'info@initech.example' },
        { id: 4, name: 'Umbrella', email: 'contact@umbrella.example' },
        { id: 5, name: 'Stark Industries', email: 'hi@stark.example' },
        { id: 6, name: 'Wayne Enterprises', email: 'ops@wayne.example' },
        { id: 7, name: 'Hooli', email: 'hello@hooli.example' },
      ],
      projects: [
        { id: 1, clientId: 1, name: 'Acme site' },
        { id: 2, clientId: 2, name: 'Globex site' },
        { id: 3, clientId: 3, name: 'Initech site' },
        { id: 4, clientId: 4, name: 'Umbrella site' },
        { id: 5, clientId: 5, name: 'Stark site' },
        { id: 6, clientId: 6, name: 'Wayne site' },
        { id: 7, clientId: 7, name: 'Hooli site' },
      ],
      invoices: [
        // Acme owes 500 (sent, nothing paid) — the most. #1.
        { id: 1, projectId: 1, amount: 500, status: 'SENT' },
        // Globex owes 450. #2.
        { id: 2, projectId: 2, amount: 450, status: 'SENT' },
        // Initech: billed the MOST of anyone sent (800) but 400 has been paid, so it owes only 400.
        // A ranking by total billed, or one that forgets to subtract payments, would put Initech at
        // the top; by what is actually still owed it is #3.
        { id: 3, projectId: 3, amount: 800, status: 'SENT' },
        // Umbrella owes 350. #4.
        { id: 4, projectId: 4, amount: 350, status: 'SENT' },
        // Stark owes 300. #5 — the last one that makes the cut.
        { id: 5, projectId: 5, amount: 300, status: 'SENT' },
        // Wayne: a big PAID invoice (900) is already in, so it is NOT owed; only its small SENT
        // invoice (120) is. Owed = 120 -> below the top five. If paid invoices (or total billed,
        // 1020 — the largest of all) counted, Wayne would wrongly lead the list.
        { id: 6, projectId: 6, amount: 900, status: 'PAID' },
        { id: 7, projectId: 6, amount: 120, status: 'SENT' },
        // Hooli: a big DRAFT (700) has not gone out, so it is NOT owed; only its SENT invoice (90)
        // is. Owed = 90 -> below the top five. If drafts counted, Hooli (790) would crowd in.
        { id: 8, projectId: 7, amount: 700, status: 'DRAFT' },
        { id: 9, projectId: 7, amount: 90, status: 'SENT' },
      ],
      payments: [
        // Pays down Initech's invoice: 800 billed - 400 paid = 400 still owed.
        { id: 1, invoiceId: 3, amount: 400, date: '2025-06-15' },
      ],
    });

    const panel = await openTopClients(page);

    // Exactly five clients are listed — the top five, no more.
    await expect(panel.getByTestId('top-client-name')).toHaveCount(5);

    // They appear ranked by how much they owe, most first: Acme 500, Globex 450, Initech 400,
    // Umbrella 350, Stark 300. This is NOT client-id order (seeded 1..7) by coincidence here, so the
    // per-row amount checks below are what pin the ranking; this pins the order of the names shown.
    const names = (await panel.getByTestId('top-client-name').allTextContents()).map((s) => s.trim());
    expect(names).toEqual(['Acme Corp', 'Globex', 'Initech', 'Umbrella', 'Stark Industries']);

    // Each listed row shows that client's own owed figure — net of payments, drafts/paid excluded.
    await expect(page.getByTestId('top-client-row-1').getByTestId('top-client-name')).toHaveText('Acme Corp');
    await expect(page.getByTestId('top-client-row-1').getByTestId('top-client-amount')).toHaveText(money(500));
    await expect(page.getByTestId('top-client-row-2').getByTestId('top-client-amount')).toHaveText(money(450));
    // Initech owes 400 (800 billed minus the 400 paid), NOT the 800 it was billed.
    await expect(page.getByTestId('top-client-row-3').getByTestId('top-client-name')).toHaveText('Initech');
    await expect(page.getByTestId('top-client-row-3').getByTestId('top-client-amount')).toHaveText(money(400));
    await expect(page.getByTestId('top-client-row-4').getByTestId('top-client-amount')).toHaveText(money(350));
    await expect(page.getByTestId('top-client-row-5').getByTestId('top-client-amount')).toHaveText(money(300));

    // The two who owe the least (Wayne 120, Hooli 90) fall outside the top five and are absent — even
    // though Wayne was billed the most (1020) and Hooli has a bigger draft (700) than most owe.
    await expect(page.getByTestId('top-client-row-6')).toHaveCount(0);
    await expect(page.getByTestId('top-client-row-7')).toHaveCount(0);
    await expect(panel).not.toContainText('Wayne Enterprises');
    await expect(panel).not.toContainText('Hooli');
    // And their undiscounted-but-excluded amounts never leak in as an owed figure.
    await expect(panel).not.toContainText('900');
    await expect(panel).not.toContainText('800');
    await expect(panel).not.toContainText('700');
  });

  test('with fewer than five owing clients, lists them all, still ranked by amount owed', async ({ page }) => {
    // Only three clients owe anything — the panel shows all three, ordered by how much they owe (not
    // by client id: Globex, seeded second, owes the most and must appear first).
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example' },
        { id: 2, name: 'Globex', email: 'hello@globex.example' },
        { id: 3, name: 'Initech', email: 'info@initech.example' },
      ],
      projects: [
        { id: 1, clientId: 1, name: 'Acme site' },
        { id: 2, clientId: 2, name: 'Globex site' },
        { id: 3, clientId: 3, name: 'Initech site' },
      ],
      invoices: [
        { id: 1, projectId: 1, amount: 300, status: 'SENT' }, // Acme owes 300 -> #2
        { id: 2, projectId: 2, amount: 500, status: 'SENT' }, // Globex owes 500 -> #1
        { id: 3, projectId: 3, amount: 100, status: 'SENT' }, // Initech owes 100 -> #3
      ],
    });

    const panel = await openTopClients(page);

    // All three are shown — fewer than five means no cut-off and no empty padding rows.
    await expect(panel.getByTestId('top-client-name')).toHaveCount(3);

    // Ranked by amount owed, most first: Globex 500, Acme 300, Initech 100.
    const names = (await panel.getByTestId('top-client-name').allTextContents()).map((s) => s.trim());
    expect(names).toEqual(['Globex', 'Acme Corp', 'Initech']);

    await expect(page.getByTestId('top-client-row-2').getByTestId('top-client-amount')).toHaveText(money(500));
    await expect(page.getByTestId('top-client-row-1').getByTestId('top-client-amount')).toHaveText(money(300));
    await expect(page.getByTestId('top-client-row-3').getByTestId('top-client-amount')).toHaveText(money(100));
  });

  test('with no clients at all the panel is present and empty, not an error', async ({ page }) => {
    await resetAndSeed({ clients: [], projects: [], invoices: [] });

    const panel = await openTopClients(page);

    // No clients -> no rows, but the panel still loaded cleanly (no error state).
    await expect(panel.getByTestId('top-client-name')).toHaveCount(0);
    await expect(panel.getByTestId('top-client-amount')).toHaveCount(0);
  });
});
