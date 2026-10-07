// Acceptance test for the change request:
//   "Let me sort my clients by name. Or by how much they owe me."
//
// The clients list page (clients-page, /clients) gains ONE control (data-testid="client-sort")
// offering the two orderings the request names: by NAME, and by how much the client OWES. Choosing
// an ordering re-arranges the one client list (the client-row-<id> rows) into that order — it does
// not add, drop or duplicate clients, it only re-orders them.
//
// WHAT "OWES" MEANS. "How much they owe me" is the client's outstanding balance — exactly the figure
// the app already works out per client (client-statement.spec's client-outstanding-total): the sum,
// across all the client's invoices, of amount minus what has been paid, counting the invoices the
// user has actually sent (dashboard-owed-sent.spec: only SENT invoices are money owed). The seed
// below keeps this unambiguous: every invoice is SENT with no payments, so each client owes exactly
// its one invoice's amount — 100, 200 and 300 — regardless of how the roll-up handles drafts or
// part-payments.
//
// WHY THESE FIGURES. The three orderings are deliberately three DIFFERENT permutations of the rows,
// so the observed row order tells us unambiguously which key the list was sorted by and rules out the
// list having merely stayed in its default order:
//   - server/default order, by id   : [1, 2, 3]
//   - by name (alphabetical)         : [2, 1, 3]   (Acme, Beacon, Cobalt)
//   - by amount owed                 : [2, 3, 1]   (100, 200, 300)
// Because the request names no DIRECTION, a list is "sorted by name" when its rows run monotonically
// by name (A->Z or Z->A) and "sorted by owed" when they run monotonically by the owed amount
// (least-first or most-first); each test accepts either direction but pins the KEY — and since the
// name orderings, the owed orderings and the id order are all distinct, matching one proves the sort
// is keyed on that field and nothing else.
//
// THE CONTROL. One testid naming a two-way choice (by name / by owed) is a single native <select>
// with an option per ordering; the control owns a URL key so the chosen ordering outlives the click
// and a reload (CLAUDE.md rule 4, mirroring invoice-sort-due.spec). Options are matched by the
// MEANING of their text (/name/i, /owe|owing|outstanding|balance/i), not exact wording or position,
// so the test binds to the contract rather than to phrasing.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email }, `projects` honours { id, name, clientId } and
// `invoices` honours { id, amount, projectId, status }. This change surfaces no audit records, so
// there is nothing to assert on the audit channel.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// Three clients whose id order, name order and owed order are three different permutations (see the
// header). Each client has one project carrying one SENT, unpaid invoice, so the client owes exactly
// that invoice's amount.
const SEED = {
  clients: [
    { id: 1, name: 'Beacon Labs', email: 'hello@beacon.test' },
    { id: 2, name: 'Acme Corp', email: 'hello@acme.test' },
    { id: 3, name: 'Cobalt Studio', email: 'hello@cobalt.test' },
  ],
  projects: [
    { id: 1, name: 'Beacon Project', clientId: 1 },
    { id: 2, name: 'Acme Project', clientId: 2 },
    { id: 3, name: 'Cobalt Project', clientId: 3 },
  ],
  invoices: [
    { id: 1, amount: 300, projectId: 1, status: 'SENT' }, // Beacon (id 1) owes 300
    { id: 2, amount: 100, projectId: 2, status: 'SENT' }, // Acme   (id 2) owes 100
    { id: 3, amount: 200, projectId: 3, status: 'SENT' }, // Cobalt (id 3) owes 200
  ],
};

const ID_ORDER = [1, 2, 3];
const NAME_ASC = [2, 1, 3]; // Acme, Beacon, Cobalt
const NAME_DESC = [3, 1, 2];
const OWED_ASC = [2, 3, 1]; // 100, 200, 300
const OWED_DESC = [1, 3, 2];

const BY_NAME = /name/i;
const BY_OWED = /owe|owing|outstanding|balance/i;

// The ids of the client rows in the order the DOM renders them (top to bottom).
async function rowOrder(page: Page): Promise<number[]> {
  return page
    .locator('[data-testid^="client-row-"]')
    .evaluateAll((els) =>
      els.map((el) => Number(el.getAttribute('data-testid')!.replace('client-row-', ''))),
    );
}

// Choose an ordering on the client-sort control by the MEANING of its option text. The option's
// value is read from the live control (not assumed), so the test does not depend on the exact label
// wording or the order of the options.
async function sortBy(page: Page, meaning: RegExp): Promise<void> {
  const control = page.getByTestId('client-sort');
  await expect(control).toBeVisible();
  const options = await control
    .locator('option')
    .evaluateAll((opts) =>
      (opts as HTMLOptionElement[]).map((o) => ({ value: o.value, text: o.textContent ?? '' })),
    );
  const match = options.find((o) => meaning.test(o.text));
  if (!match) {
    throw new Error(`no client-sort option whose text matches ${meaning}; saw ${JSON.stringify(options)}`);
  }
  await control.selectOption(match.value);
}

// Wait until the rows settle into one of the accepted orderings (the control writes to the URL and
// the list re-reads asynchronously), then return the order that matched for a clear failure message.
async function expectOrderOneOf(page: Page, accepted: number[][]): Promise<void> {
  const wanted = accepted.map((a) => a.join(','));
  await expect(async () => {
    const order = (await rowOrder(page)).join(',');
    expect(wanted).toContain(order);
  }).toPass();
}

test.describe('Sort clients by name or by how much they owe', () => {
  test('the clients page offers a sort control over the one list', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/clients');
    await expect(page.getByTestId('clients-page')).toBeVisible();

    // The new control is present, and all three clients are listed as their own rows.
    await expect(page.getByTestId('client-sort')).toBeVisible();
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(3);
  });

  test('sorting by name arranges the clients alphabetically by name', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/clients');
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(3);

    await sortBy(page, BY_NAME);

    // Rows now run monotonically by name. Either direction counts, but the order must be a NAME
    // ordering — which is neither the id order nor an owed ordering, so this pins the key to name.
    await expectOrderOneOf(page, [NAME_ASC, NAME_DESC]);

    // Sorting re-orders; it does not add, drop or duplicate clients.
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(3);
  });

  test('sorting by how much they owe arranges the clients by their outstanding balance', async ({
    page,
  }) => {
    await resetAndSeed(SEED);

    await page.goto('/clients');
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(3);

    await sortBy(page, BY_OWED);

    // Rows now run monotonically by the amount owed (100 / 200 / 300). Either direction counts, but
    // the order must be an OWED ordering — distinct from the id order and from either name ordering,
    // so a name sort or the default could not produce it: the sort is keyed on what the client owes.
    await expectOrderOneOf(page, [OWED_ASC, OWED_DESC]);

    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(3);
  });

  test('switching between the two sorts re-arranges the same list each way', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/clients');
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(3);

    // By name, then by owed: the one list follows the chosen key each time. Because a name ordering
    // and an owed ordering are different permutations, seeing each in turn proves the control truly
    // responds to the choice rather than leaving the rows in whatever order they already had.
    await sortBy(page, BY_NAME);
    await expectOrderOneOf(page, [NAME_ASC, NAME_DESC]);

    await sortBy(page, BY_OWED);
    await expectOrderOneOf(page, [OWED_ASC, OWED_DESC]);

    // And back to name again.
    await sortBy(page, BY_NAME);
    await expectOrderOneOf(page, [NAME_ASC, NAME_DESC]);
  });

  test('the chosen sort survives a fresh load', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/clients');
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(3);

    await sortBy(page, BY_OWED);
    await expectOrderOneOf(page, [OWED_ASC, OWED_DESC]);
    const sorted = await rowOrder(page);

    // Reloading re-reads the page; the ordering the user chose is still in effect and the rows come
    // back the same way (the sort lives in the URL, not in throwaway component state).
    await page.reload();
    await expect(page.getByTestId('clients-page')).toBeVisible();
    await expect(page.locator('[data-testid^="client-row-"]')).toHaveCount(3);
    expect(await rowOrder(page)).toEqual(sorted);
  });
});
