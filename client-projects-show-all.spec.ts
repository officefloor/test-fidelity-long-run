// Acceptance tests for the change request:
//   "On a client's page show me just their active projects by default. Give me a way to also see
//    the finished and hidden ones."
//
// The client detail page already lists the projects being done FOR THAT CLIENT in client-projects-table
// (the client-projects feature). This change NARROWS that default list: by default it shows only the
// client's ACTIVE projects. A project that is FINISHED (status), or HIDDEN (archived — tucked away by
// the project-archive feature), drops off the default view. A new control (client-projects-show-all)
// is the "way to also see" them: switching it on reveals the finished and hidden projects alongside
// the active ones, in the same table. Switching it back off returns to active-only — so the control
// genuinely reads the choice, mirroring the sibling projects-show-archived toggle.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed, which clears all data
// first. Seed honours clients: { id, name, email } and projects: { id, clientId, name, status, archived }
// — `status` seeds a project directly into a lifecycle state (ACTIVE / FINISHED, the canonical codes
// from Flyway V21 and the project form's option values) and `archived: true` seeds it tucked away, so
// the default narrowing can be checked without a click.
//
// ON_HOLD is deliberately left out of these fixtures: the request enumerates exactly three buckets for
// the client page — active (default) and the finished + hidden the control reveals — so the tests pin
// only those buckets and do not over-constrain where an on-hold project would land.
//
// This SHOULD FAIL before the change: today client-projects-table shows every non-archived project of
// the client regardless of status, there is no client-projects-show-all control, and archived/finished
// projects are not revealable from the client's page.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// Client 1 owns a mix of buckets; client 2's project is here only to prove it never leaks onto
// client 1's page in either view.
//   1, 2 — ACTIVE, live            → shown by default (two of them: "active" is a SET, not one row)
//   3    — FINISHED, live          → the "finished" bucket, hidden by default
//   4    — ACTIVE, archived        → the "hidden" bucket, hidden by default
//   5    — client 2, ACTIVE        → a different client, never on client 1's page
const FIXTURE = {
  clients: [
    { id: 1, name: 'Acme Corp', email: 'ops@acme.example' },
    { id: 2, name: 'Globex', email: 'hello@globex.example' },
  ],
  projects: [
    { id: 1, clientId: 1, name: 'Website redesign', status: 'ACTIVE' },
    { id: 2, clientId: 1, name: 'Mobile app', status: 'ACTIVE' },
    { id: 3, clientId: 1, name: 'Legacy migration', status: 'FINISHED' },
    { id: 4, clientId: 1, name: 'Warehouse automation', status: 'ACTIVE', archived: true },
    { id: 5, clientId: 2, name: 'Billing portal', status: 'ACTIVE' },
  ],
};

// Open client 1's detail page from the clients list and wait for the projects table to render.
async function openClient1(page: Page): Promise<void> {
  await page.goto('/clients');
  await page.getByTestId('client-open-1').click();
  await expect(page.getByTestId('client-detail-page')).toBeVisible();
  await expect(page.getByTestId('client-projects-table')).toBeVisible();
}

// Flip the show-all control. It owns the reveal, parallel to projects-show-archived — a single
// toggle, so a click switches it; a second click switches it back.
async function toggleShowAll(page: Page): Promise<void> {
  await page.getByTestId('client-projects-show-all').click();
}

test.describe('client page shows active projects by default, with a way to see the rest', () => {
  test.beforeEach(async () => {
    await resetAndSeed(FIXTURE);
  });

  test('by default only the active projects show; finished and hidden stay off', async ({ page }) => {
    await openClient1(page);

    // The way to see the rest is offered even before it is used.
    await expect(page.getByTestId('client-projects-show-all')).toBeVisible();

    // Default view: both ACTIVE projects (1, 2) — the active SET, not a single hard-coded row.
    await expect(page.getByTestId('project-row-1')).toBeVisible();
    await expect(page.getByTestId('project-row-1').getByTestId('project-name')).toHaveText('Website redesign');
    await expect(page.getByTestId('project-row-2')).toBeVisible();
    await expect(page.getByTestId('project-row-2').getByTestId('project-name')).toHaveText('Mobile app');

    // The FINISHED project (3) and the HIDDEN/archived project (4) are both off the default view.
    await expect(page.getByTestId('project-row-3')).toHaveCount(0);
    await expect(page.getByTestId('project-row-4')).toHaveCount(0);
    // The other client's project (5) is never here regardless.
    await expect(page.getByTestId('project-row-5')).toHaveCount(0);

    // Exactly the two active rows — nothing else leaked in.
    await expect(page.getByTestId('project-name')).toHaveCount(2);
    await expect(page.getByTestId('client-projects-empty')).toHaveCount(0);
  });

  test('switching show-all on reveals the finished and hidden projects alongside the active ones', async ({ page }) => {
    await openClient1(page);
    await expect(page.getByTestId('project-name')).toHaveCount(2);

    // "Give me a way to also see the finished and hidden ones."
    await toggleShowAll(page);

    // The two active projects remain...
    await expect(page.getByTestId('project-row-1')).toBeVisible();
    await expect(page.getByTestId('project-row-2')).toBeVisible();
    // ...and now the FINISHED one and the HIDDEN/archived one appear too, names intact.
    await expect(page.getByTestId('project-row-3')).toBeVisible();
    await expect(page.getByTestId('project-row-3').getByTestId('project-name')).toHaveText('Legacy migration');
    await expect(page.getByTestId('project-row-4')).toBeVisible();
    await expect(page.getByTestId('project-row-4').getByTestId('project-name')).toHaveText('Warehouse automation');

    // The other client's project is STILL not shown — show-all widens the status/hidden filter, it
    // does not drop the owner filter.
    await expect(page.getByTestId('project-row-5')).toHaveCount(0);
    await expect(page.getByTestId('project-name')).toHaveCount(3 + 1);

    // The control genuinely reads the choice: switching it back off returns to active-only.
    await toggleShowAll(page);
    await expect(page.getByTestId('project-row-1')).toBeVisible();
    await expect(page.getByTestId('project-row-2')).toBeVisible();
    await expect(page.getByTestId('project-row-3')).toHaveCount(0);
    await expect(page.getByTestId('project-row-4')).toHaveCount(0);
    await expect(page.getByTestId('project-name')).toHaveCount(2);
  });

  test('a client whose projects are all finished or hidden shows empty by default, revealed by show-all', async ({ page }) => {
    // Client 1 has NO active projects of their own: one finished, one archived. "Just active by
    // default" therefore means an empty list — and the way to see the rest must still be offered.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [
        { id: 1, clientId: 1, name: 'Legacy migration', status: 'FINISHED' },
        { id: 2, clientId: 1, name: 'Warehouse automation', status: 'ACTIVE', archived: true },
      ],
    });

    await page.goto('/clients');
    await page.getByTestId('client-open-1').click();
    await expect(page.getByTestId('client-detail-page')).toBeVisible();

    // Default view: no active projects, so the empty state shows and no rows are listed.
    await expect(page.getByTestId('client-projects-empty')).toBeVisible();
    await expect(page.getByTestId('project-name')).toHaveCount(0);
    await expect(page.getByTestId('project-row-1')).toHaveCount(0);
    await expect(page.getByTestId('project-row-2')).toHaveCount(0);

    // The way to see the finished and hidden ones is still available even with nothing active.
    await expect(page.getByTestId('client-projects-show-all')).toBeVisible();
    await toggleShowAll(page);

    // Both the finished and the hidden project now appear, names intact; the empty state is gone.
    await expect(page.getByTestId('client-projects-empty')).toHaveCount(0);
    await expect(page.getByTestId('project-row-1')).toBeVisible();
    await expect(page.getByTestId('project-row-1').getByTestId('project-name')).toHaveText('Legacy migration');
    await expect(page.getByTestId('project-row-2')).toBeVisible();
    await expect(page.getByTestId('project-row-2').getByTestId('project-name')).toHaveText('Warehouse automation');
    await expect(page.getByTestId('project-name')).toHaveCount(2);
  });
});
