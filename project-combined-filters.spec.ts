// Acceptance test for the change request:
//   "Let me filter by two things at once. For example active projects that have a certain label."
//
// The projects list page (projects-page, /projects) already carries two independent toolbar filters:
// a STATUS filter (project-status-filter, keyed on a project's lifecycle stage — active / on hold /
// finished) and a LABEL filter (project-tag-filter, keyed on a tag carried by the project). Each on
// its own narrows the one list to a single dimension (covered by project-status-filter.spec.ts and
// project-tag-filter.spec.ts). This change is that the two COMBINE: with BOTH chosen the list shows
// only the projects that satisfy BOTH at once — the INTERSECTION, e.g. "active projects that have a
// certain label" — not the projects matching either one. The two filters stay independent: setting
// one does not clear the other, changing or clearing one re-narrows against the other still in force,
// and (CLAUDE.md rule 4) both chosen values live in the URL so the combined view survives a reload.
// Combining is a pure view concern: it records nothing.
//
// Each filter control mirrors its toolbar siblings — a <select> whose options NAME the stage / label,
// plus a default option with an empty value that clears that one key. As in the two single-dimension
// specs, the test picks an option by the WORD in its label (case-insensitively) and selects it by that
// option's OWN value, so it binds to the MEANING, not the exact value or capitalisation the control
// uses internally.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed (the app's /__test__ endpoint): `clients` honours
// { id, name, email }, `projects` honours { id, name, clientId, status }, `tags` honours { id, name }
// and `projectTags` (the join putting a label on a project) honours { projectId, tagId }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

// Each stage / label pinned by the word that names it, case-insensitively, so the test binds to the
// MEANING and not one capitalisation. Word boundaries keep them distinct; "on hold" tolerates any
// single separator. None of these words is a substring of another, nor of a default option label.
const ACTIVE = /\bactive\b/i;
const ON_HOLD = /\bon[\s_-]?hold\b/i;
const URGENT = /\burgent\b/i;
const BACKEND = /\bbackend\b/i;

const projectRows = (page: Page) => page.locator('[data-testid^="project-row-"]');
const statusOf = (page: Page, id: number): Locator =>
  page.getByTestId(`project-row-${id}`).getByTestId('project-status');

// Projects spread across BOTH dimensions so that each single filter alone keeps rows the combination
// must drop — the only way to reach the asserted sets is to apply BOTH filters at once. All projects
// are un-archived (the show-archived toggle plays no part) and named without any stage/label word so
// the two concerns stay independent.
//
//   id  status    label(s)      active?  urgent?  backend?
//   1   ACTIVE    urgent          Y        Y         .
//   2   ACTIVE    urgent          Y        Y         .
//   3   ACTIVE    backend         Y        .         Y
//   4   ACTIVE    (none)          Y        .         .
//   5   ON_HOLD   urgent          .        Y         .
//   6   ON_HOLD   backend         .        .         Y
//   7   FINISHED  urgent          .        Y         .
//   8   FINISHED  (none)          .        .         .
const SEED = {
  clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
  projects: [
    { id: 1, name: 'Website Rebuild', clientId: 1, status: 'ACTIVE' },
    { id: 2, name: 'Mobile App', clientId: 1, status: 'ACTIVE' },
    { id: 3, name: 'Billing System', clientId: 1, status: 'ACTIVE' },
    { id: 4, name: 'Internal Portal', clientId: 1, status: 'ACTIVE' },
    { id: 5, name: 'Marketing Hub', clientId: 1, status: 'ON_HOLD' },
    { id: 6, name: 'Data Warehouse', clientId: 1, status: 'ON_HOLD' },
    { id: 7, name: 'Legacy Import', clientId: 1, status: 'FINISHED' },
    { id: 8, name: 'Support Desk', clientId: 1, status: 'FINISHED' },
  ],
  tags: [
    { id: 1, name: 'urgent' },
    { id: 2, name: 'backend' },
  ],
  projectTags: [
    { projectId: 1, tagId: 1 },
    { projectId: 2, tagId: 1 },
    { projectId: 3, tagId: 2 },
    { projectId: 5, tagId: 1 },
    { projectId: 6, tagId: 2 },
    { projectId: 7, tagId: 1 },
    // projects 4 and 8 carry no label at all
  ],
};

const ALL_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
const ACTIVE_IDS = [1, 2, 3, 4];
const URGENT_IDS = [1, 2, 5, 7];
const BACKEND_IDS = [3, 6];
// The intersections the combined filter must produce.
const ACTIVE_AND_URGENT = [1, 2]; // proper subset of BOTH ACTIVE_IDS and URGENT_IDS
const ACTIVE_AND_BACKEND = [3]; // changing just the label re-narrows against status
const ON_HOLD_AND_URGENT = [5]; // changing just the status re-narrows against label

// The ids of the currently-rendered project rows, ascending (order is not what this feature is about).
async function visibleIds(page: Page): Promise<number[]> {
  return projectRows(page).evaluateAll((els) =>
    els
      .map((el) => Number(el.getAttribute('data-testid')!.replace('project-row-', '')))
      .sort((a, b) => a - b),
  );
}

// Choose a stage in the status filter by the stage WORD in its option label, selecting that option's
// own value — pinned by meaning, not by the control's internal value/capitalisation.
async function chooseStatus(page: Page, word: RegExp): Promise<void> {
  const filter = page.getByTestId('project-status-filter');
  await expect(filter).toBeVisible();
  const value = await filter
    .locator('option')
    .filter({ hasText: word })
    .first()
    .evaluate((el: HTMLOptionElement) => el.value);
  await filter.selectOption(value);
}

// Choose a label in the tag filter by the label WORD in its option text, selecting that option's own
// value — same meaning-based binding as the status helper.
async function chooseLabel(page: Page, word: RegExp): Promise<void> {
  const filter = page.getByTestId('project-tag-filter');
  await expect(filter).toBeVisible();
  const value = await filter
    .locator('option')
    .filter({ hasText: word })
    .first()
    .evaluate((el: HTMLOptionElement) => el.value);
  await filter.selectOption(value);
}

// Clearing one key leaves the other untouched: the default option carries an empty value.
const clearStatus = (page: Page) => page.getByTestId('project-status-filter').selectOption('');
const clearLabel = (page: Page) => page.getByTestId('project-tag-filter').selectOption('');

test.describe('Filter projects by two things at once (status + label)', () => {
  test('both filters are present together and, before either is chosen, every project shows', async ({
    page,
  }) => {
    await resetAndSeed(SEED);

    await page.goto('/projects');
    await expect(page.getByTestId('projects-page')).toBeVisible();

    // The two independent controls sit side by side in the toolbar.
    await expect(page.getByTestId('project-status-filter')).toBeVisible();
    await expect(page.getByTestId('project-tag-filter')).toBeVisible();

    // Nothing chosen yet => unfiltered: every seeded project, including the two unlabelled ones.
    await expect(page.getByTestId('projects-table')).toBeVisible();
    await expect(projectRows(page)).toHaveCount(ALL_IDS.length);
    expect(await visibleIds(page)).toEqual(ALL_IDS);

    // Reading the list records nothing.
    expect(auditLines()).toEqual([]);
  });

  test('choosing a status AND a label narrows to the INTERSECTION, not to either alone', async ({
    page,
  }) => {
    await resetAndSeed(SEED);

    await page.goto('/projects');
    await expect(projectRows(page)).toHaveCount(ALL_IDS.length);

    // Apply the status filter alone: a strict superset of the combined result (this is the single-
    // dimension behaviour the sibling spec already owns — asserted here only as the baseline that the
    // second filter then narrows further).
    await chooseStatus(page, ACTIVE);
    expect(await visibleIds(page)).toEqual(ACTIVE_IDS);

    // Now add the label filter on top. The list drops to only the projects that are BOTH active AND
    // urgent — a proper subset of the active list.
    await chooseLabel(page, URGENT);
    await expect(projectRows(page)).toHaveCount(ACTIVE_AND_URGENT.length);
    expect(await visibleIds(page)).toEqual(ACTIVE_AND_URGENT);

    // Rows that satisfy only ONE of the two filters are gone — the proof that BOTH apply at once:
    //  - 3 and 4 are active but NOT urgent  => the LABEL filter is in force
    //  - 5 and 7 are urgent but NOT active  => the STATUS filter is in force
    for (const id of [3, 4, 5, 7]) {
      await expect(page.getByTestId(`project-row-${id}`)).toHaveCount(0);
    }

    // The survivors are real rows, and each is genuinely active.
    for (const id of ACTIVE_AND_URGENT) {
      await expect(page.getByTestId(`project-row-${id}`)).toBeVisible();
      await expect(statusOf(page, id)).toHaveText(ACTIVE);
    }
    await expect(page.getByTestId('project-row-1').getByTestId('project-name')).toHaveText(
      'Website Rebuild',
    );
    await expect(page.getByTestId('project-row-2').getByTestId('project-name')).toHaveText(
      'Mobile App',
    );

    // Combining is a pure view concern: it records nothing.
    expect(auditLines()).toEqual([]);
  });

  test('the two filters stay independent: changing or clearing one re-narrows against the other', async ({
    page,
  }) => {
    await resetAndSeed(SEED);

    await page.goto('/projects');

    // Start combined: active + urgent.
    await chooseStatus(page, ACTIVE);
    await chooseLabel(page, URGENT);
    expect(await visibleIds(page)).toEqual(ACTIVE_AND_URGENT);

    // Change ONLY the label (status stays active): the list re-narrows to active + backend, proving the
    // status filter was not cleared when the label changed.
    await chooseLabel(page, BACKEND);
    expect(await visibleIds(page)).toEqual(ACTIVE_AND_BACKEND);

    // Clear ONLY the label: the status filter is still in force, so the whole active list returns
    // (more than the combined result, but still only active projects — the status filter survived).
    await clearLabel(page);
    expect(await visibleIds(page)).toEqual(ACTIVE_IDS);

    // Change ONLY the status (now with the label re-applied): on-hold + urgent is a different
    // intersection again, confirming each dimension is keyed on its own chosen value.
    await chooseLabel(page, URGENT);
    await chooseStatus(page, ON_HOLD);
    expect(await visibleIds(page)).toEqual(ON_HOLD_AND_URGENT);

    // Clear ONLY the status: the urgent label filter is still in force on its own.
    await clearStatus(page);
    expect(await visibleIds(page)).toEqual(URGENT_IDS);

    // Clear the label too: back to the full, unfiltered list.
    await clearLabel(page);
    expect(await visibleIds(page)).toEqual(ALL_IDS);

    expect(auditLines()).toEqual([]);
  });

  test('applying the two filters in either order reaches the same combined view', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/projects');

    // label first, then status.
    await chooseLabel(page, BACKEND);
    expect(await visibleIds(page)).toEqual(BACKEND_IDS);
    await chooseStatus(page, ACTIVE);
    expect(await visibleIds(page)).toEqual(ACTIVE_AND_BACKEND);

    // Reset both and apply in the opposite order; the combined result is identical.
    await clearStatus(page);
    await clearLabel(page);
    expect(await visibleIds(page)).toEqual(ALL_IDS);

    await chooseStatus(page, ACTIVE);
    await chooseLabel(page, BACKEND);
    expect(await visibleIds(page)).toEqual(ACTIVE_AND_BACKEND);
  });

  test('both chosen values survive a fresh load, and combining records nothing', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/projects');
    await chooseStatus(page, ACTIVE);
    await chooseLabel(page, URGENT);
    expect(await visibleIds(page)).toEqual(ACTIVE_AND_URGENT);

    // Reloading re-reads the page; BOTH chosen values are still in effect and the same intersection
    // comes back (the combined filter lives in the URL, not in throwaway component state).
    await page.reload();
    await expect(page.getByTestId('projects-page')).toBeVisible();
    await expect(projectRows(page)).toHaveCount(ACTIVE_AND_URGENT.length);
    expect(await visibleIds(page)).toEqual(ACTIVE_AND_URGENT);

    // Filtering (and reloading) changes no project, so nothing is appended to the audit file.
    expect(auditLines()).toEqual([]);
  });
});
