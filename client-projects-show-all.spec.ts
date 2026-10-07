// Acceptance test for the change request:
//   "On a client's page show me just their active projects by default. Give me a way to also see
//    the finished and hidden ones."
//
// A client's detail page (client-detail-page, /clients/<id>) lists the projects done for THAT client
// (client-projects-table, rows project-row-<id> carrying project-name — the same anchors the
// existing client-projects list already uses). This change narrows what that list shows BY DEFAULT
// and adds a way to widen it again:
//   * BY DEFAULT only the client's ACTIVE projects are listed. A FINISHED project is off the list,
//     and a HIDDEN (archived) project is off the list — exactly as before for archived, now also for
//     finished.
//   * The page gains ONE new control (client-projects-show-all). Turning it on reveals the rest:
//     the finished projects AND the hidden (archived) ones join the list alongside the active ones.
//     Turning it back off returns to just the active projects — so the control genuinely drives the
//     view in both directions and is not a one-way reveal.
//   * The narrowing/widening is a pure VIEW over this client's own projects: it never pulls in
//     another client's projects, whichever way the control is set.
//
// A project's lifecycle stage comes from its STATUS (active / on hold / finished — the same three
// stages project-status.spec establishes); "hidden" is the archived flag (project-archive.spec).
// This test seeds only ACTIVE, FINISHED and archived projects — the two categories the request
// names ("finished and hidden") plus the default ("active") — so the expected rows are identical
// whether "active projects" is read as "status ACTIVE" or as "not finished and not hidden". Each
// project is pinned by its seeded id/name; the client table shows a name per row, so rows are matched
// by id and name (status itself is not asserted here — project-status.spec owns that).
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email } and `projects` honours { id, name, clientId,
// status, archived }. A seeded project with no status defaults to ACTIVE (Flyway V21), so every
// stage used here is set explicitly.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

const projectRows = (page: Page) => page.locator('[data-testid^="project-row-"]');

// The ids of the currently-rendered project rows, ascending (row order is not what this is about).
async function visibleIds(page: Page): Promise<number[]> {
  return projectRows(page).evaluateAll((els) =>
    els
      .map((el) => Number(el.getAttribute('data-testid')!.replace('project-row-', '')))
      .sort((a, b) => a - b),
  );
}

const nameOf = (page: Page, id: number) =>
  page.getByTestId(`project-row-${id}`).getByTestId('project-name');

// Turn the show-all control on/off. It is the single new anchor this change introduces; a click
// toggles it, mirroring the sibling projects-show-archived toggle.
async function toggleShowAll(page: Page): Promise<void> {
  const control = page.getByTestId('client-projects-show-all');
  await expect(control).toBeVisible();
  await control.click();
}

// Acme (client 1) has one project at each relevant category, plus a second active one so "active" is
// never a single-row coincidence. Globex (client 2) owns a project that must never leak onto Acme's
// page. Names are neutral (no stage word) since rows are matched by id/name, not by status text.
const SEED = {
  clients: [
    { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
    { id: 2, name: 'Globex', email: 'contact@globex.test' },
  ],
  projects: [
    { id: 1, name: 'Website Redesign', clientId: 1, status: 'ACTIVE' },
    { id: 2, name: 'Internal Portal', clientId: 1, status: 'ACTIVE' },
    { id: 3, name: 'Billing System', clientId: 1, status: 'FINISHED' },
    // Hidden (archived) — off the list by default, revealed by show-all. Its status is irrelevant
    // to being hidden, so leave it ACTIVE: being archived alone must keep it off the default list.
    { id: 4, name: 'Legacy Migration', clientId: 1, status: 'ACTIVE', archived: true },
    // Different client's project — never on Acme's page, whichever way the control is set.
    { id: 5, name: 'Mobile App', clientId: 2, status: 'ACTIVE' },
  ],
};

const ACTIVE_IDS = [1, 2]; // shown by default
const ALL_ACME_IDS = [1, 2, 3, 4]; // shown once everything is revealed

test.describe('A client page shows active projects by default, with a way to see the rest', () => {
  test("by default a client's page lists only their active projects", async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/clients/1');
    await expect(page.getByTestId('client-detail-page')).toBeVisible();
    await expect(page.getByTestId('client-projects-table')).toBeVisible();

    // The new control is on the page from the start — it is how the hidden/finished ones are reached.
    await expect(page.getByTestId('client-projects-show-all')).toBeVisible();

    // Only the two active projects are listed; the finished one and the hidden one are off the list.
    await expect(projectRows(page)).toHaveCount(ACTIVE_IDS.length);
    expect(await visibleIds(page)).toEqual(ACTIVE_IDS);
    await expect(nameOf(page, 1)).toHaveText('Website Redesign');
    await expect(nameOf(page, 2)).toHaveText('Internal Portal');

    await expect(page.getByTestId('project-row-3')).toHaveCount(0);
    await expect(page.getByTestId('project-row-4')).toHaveCount(0);
    await expect(page.getByTestId('client-detail-page')).not.toContainText('Billing System');
    await expect(page.getByTestId('client-detail-page')).not.toContainText('Legacy Migration');

    // The other client's project never appears on this page.
    await expect(page.getByTestId('project-row-5')).toHaveCount(0);
    await expect(page.getByTestId('client-detail-page')).not.toContainText('Mobile App');
  });

  test('turning on show-all reveals the finished and hidden projects alongside the active ones', async ({
    page,
  }) => {
    await resetAndSeed(SEED);

    await page.goto('/clients/1');
    await expect(page.getByTestId('client-detail-page')).toBeVisible();

    // Precondition: only the active projects show, so the extra rows below are a real effect of the
    // control and not already present.
    await expect(projectRows(page)).toHaveCount(ACTIVE_IDS.length);
    expect(await visibleIds(page)).toEqual(ACTIVE_IDS);

    await toggleShowAll(page);

    // All four of this client's projects are now listed: the two active, the finished, and the hidden.
    await expect(projectRows(page)).toHaveCount(ALL_ACME_IDS.length);
    expect(await visibleIds(page)).toEqual(ALL_ACME_IDS);
    await expect(nameOf(page, 1)).toHaveText('Website Redesign');
    await expect(nameOf(page, 2)).toHaveText('Internal Portal');
    await expect(nameOf(page, 3)).toHaveText('Billing System');
    await expect(nameOf(page, 4)).toHaveText('Legacy Migration');

    // Widening the view is still scoped to this client — the other client's project does not leak in.
    await expect(page.getByTestId('project-row-5')).toHaveCount(0);
    await expect(page.getByTestId('client-detail-page')).not.toContainText('Mobile App');
  });

  test('turning show-all off again returns to just the active projects', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/clients/1');
    await expect(page.getByTestId('client-detail-page')).toBeVisible();

    // On: everything for this client is revealed.
    await toggleShowAll(page);
    await expect(projectRows(page)).toHaveCount(ALL_ACME_IDS.length);
    expect(await visibleIds(page)).toEqual(ALL_ACME_IDS);

    // Off: back to just the active projects — the finished and hidden ones drop away again, proving
    // the control drives the view in both directions rather than being a one-way reveal.
    await toggleShowAll(page);
    await expect(projectRows(page)).toHaveCount(ACTIVE_IDS.length);
    expect(await visibleIds(page)).toEqual(ACTIVE_IDS);
    await expect(page.getByTestId('project-row-3')).toHaveCount(0);
    await expect(page.getByTestId('project-row-4')).toHaveCount(0);
    await expect(page.getByTestId('client-detail-page')).not.toContainText('Billing System');
    await expect(page.getByTestId('client-detail-page')).not.toContainText('Legacy Migration');
  });

  test('a client whose projects are all finished or hidden shows empty by default, revealed by show-all', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      projects: [
        // No active projects for Acme: one finished, one hidden.
        { id: 1, name: 'Billing System', clientId: 1, status: 'FINISHED' },
        { id: 2, name: 'Legacy Migration', clientId: 1, status: 'ACTIVE', archived: true },
        // Another client's active project — must not stand in for Acme's missing active list.
        { id: 3, name: 'Mobile App', clientId: 2, status: 'ACTIVE' },
      ],
    });

    await page.goto('/clients/1');
    await expect(page.getByTestId('client-detail-page')).toBeVisible();

    // With no active projects, the default list is empty — and the control is still offered so the
    // finished/hidden ones remain reachable.
    await expect(page.getByTestId('client-projects-empty')).toBeVisible();
    await expect(projectRows(page)).toHaveCount(0);
    await expect(page.getByTestId('client-projects-show-all')).toBeVisible();
    await expect(page.getByTestId('client-detail-page')).not.toContainText('Billing System');
    await expect(page.getByTestId('client-detail-page')).not.toContainText('Legacy Migration');

    // Turning on show-all reveals exactly this client's two projects; the empty state is gone and the
    // other client's project stays out.
    await toggleShowAll(page);
    await expect(page.getByTestId('client-projects-empty')).toHaveCount(0);
    await expect(projectRows(page)).toHaveCount(2);
    expect(await visibleIds(page)).toEqual([1, 2]);
    await expect(nameOf(page, 1)).toHaveText('Billing System');
    await expect(nameOf(page, 2)).toHaveText('Legacy Migration');
    await expect(page.getByTestId('project-row-3')).toHaveCount(0);
    await expect(page.getByTestId('client-detail-page')).not.toContainText('Mobile App');
  });
});
