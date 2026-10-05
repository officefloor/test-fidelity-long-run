// Acceptance tests for the change request:
//   "Let me filter my projects by label."
//
// The projects page (projects-page, at /projects) lists every (live) project. Projects already carry
// LABELS (tags, from the project-tags feature). This change adds a control (project-tag-filter) on the
// projects page that narrows that list to ONE label: pick a label and only the projects carrying that
// label remain — every other project, labelled differently or not at all, is hidden. With nothing
// picked (the default) every project is still shown, exactly as before, so this is a pure narrowing on
// top of the existing list.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed; the filter is driven
// through the project-tag-filter control. Seed honours clients: { id, name, email },
// projects: { id, clientId, name }, tags: { id, name } and the join projectTags: { projectId, tagId }.
//
// The filter is a single control (one testid), so it is a <select> of the labels — mirroring the
// sibling invoice-status-filter / task-filter. We do not assume whether an option carries the label's
// name or its id as the value, nor the casing: for a wanted label we locate the option whose visible
// text OR value matches the label case-insensitively and select it by its own value, and to clear we
// select the "all" option (value === '' or an "all" label). So a correct implementation passes however
// it renders and values its label options.
//
// The fixture puts "Frontend" (id 1) on TWO projects (1, 2) and "Backend" (id 2) on a THIRD (3), with a
// FOURTH project (4) carrying no label at all. So narrowing to "Frontend" must keep a SET of projects
// (1 and 2, not a single hard-coded row) and drop the Backend one and the unlabelled one; narrowing to
// "Backend" keeps a DISJOINT set (just 3), proving the control reads the chosen label rather than
// always filtering to one. The unlabelled project (4) is hidden whenever any label is picked and
// returns when the filter is cleared. This SHOULD FAIL before the change: there is no
// project-tag-filter on the projects page today.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// Four projects. "Frontend" groups 1 and 2; "Backend" is only on 3; 4 has no label. The two label
// sets are disjoint, so neither narrow can be faked by always keeping a fixed row.
const FIXTURE = {
  clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
  projects: [
    { id: 1, clientId: 1, name: 'Website redesign' },
    { id: 2, clientId: 1, name: 'Mobile app' },
    { id: 3, clientId: 1, name: 'Warehouse automation' },
    { id: 4, clientId: 1, name: 'Billing cleanup' },
  ],
  tags: [
    { id: 1, name: 'Frontend' },
    { id: 2, name: 'Backend' },
  ],
  projectTags: [
    { projectId: 1, tagId: 1 }, // Frontend -> project 1
    { projectId: 2, tagId: 1 }, // Frontend -> project 2 (shared)
    { projectId: 3, tagId: 2 }, // Backend  -> project 3
    // project 4 carries no label
  ],
};

// The <option> value whose visible text OR value matches `label` (case-insensitive). Selecting by the
// option's own value keeps us agnostic to whether the feature values options by the label's name or id.
async function optionValueFor(page: Page, label: RegExp): Promise<string> {
  const value = await page
    .getByTestId('project-tag-filter')
    .locator('option')
    .evaluateAll((opts, src) => {
      const re = new RegExp(src as string, 'i');
      const match = (opts as HTMLOptionElement[]).find(
        (o) => re.test((o.textContent ?? '').trim()) || re.test(o.value),
      );
      return match ? match.value : null;
    }, label.source);
  if (value === null) {
    throw new Error(`project-tag-filter has no option matching ${label}`);
  }
  return value;
}

// Narrow the list to a single label through the control.
async function narrowTo(page: Page, label: RegExp): Promise<void> {
  await page.getByTestId('project-tag-filter').selectOption(await optionValueFor(page, label));
}

// The "show every project" option: an empty value by convention, or an option labelled "all".
async function showAll(page: Page): Promise<void> {
  const value = await page
    .getByTestId('project-tag-filter')
    .locator('option')
    .evaluateAll((opts) => {
      const match = (opts as HTMLOptionElement[]).find(
        (o) => o.value === '' || /all/i.test((o.textContent ?? '').trim()),
      );
      return match ? match.value : null;
    });
  if (value === null) {
    throw new Error('project-tag-filter has no "all" option');
  }
  await page.getByTestId('project-tag-filter').selectOption(value);
}

const FRONTEND = /^frontend$/;
const BACKEND = /^backend$/;

test.describe('filter projects by label', () => {
  test.beforeEach(async () => {
    await resetAndSeed(FIXTURE);
  });

  test('with nothing picked, the filter is present and every project is shown', async ({ page }) => {
    await page.goto('/projects');

    await expect(page.getByTestId('projects-page')).toBeVisible();
    await expect(page.getByTestId('project-tag-filter')).toBeVisible();

    // Default view: all four projects, labelled and unlabelled alike.
    await expect(page.getByTestId('project-row-1')).toBeVisible();
    await expect(page.getByTestId('project-row-2')).toBeVisible();
    await expect(page.getByTestId('project-row-3')).toBeVisible();
    await expect(page.getByTestId('project-row-4')).toBeVisible();
    await expect(page.locator('[data-testid^="project-row-"]')).toHaveCount(4);
  });

  test('narrowing to a label keeps only the projects carrying it', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByTestId('project-row-1')).toBeVisible();

    // "Filter my projects by label" — pick Frontend.
    await narrowTo(page, FRONTEND);

    // The two Frontend projects (1, 2) remain; the Backend one (3) and the unlabelled one (4) are gone.
    await expect(page.getByTestId('project-row-1')).toBeVisible();
    await expect(page.getByTestId('project-row-2')).toBeVisible();
    await expect(page.getByTestId('project-row-3')).toHaveCount(0);
    await expect(page.getByTestId('project-row-4')).toHaveCount(0);
    await expect(page.locator('[data-testid^="project-row-"]')).toHaveCount(2);

    // Names intact on the surviving rows.
    await expect(page.getByTestId('project-row-1').getByTestId('project-name')).toHaveText('Website redesign');
    await expect(page.getByTestId('project-row-2').getByTestId('project-name')).toHaveText('Mobile app');
  });

  test('switching labels follows the chosen label to a disjoint set', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByTestId('project-row-1')).toBeVisible();

    // Frontend first: projects 1 and 2.
    await narrowTo(page, FRONTEND);
    await expect(page.getByTestId('project-row-1')).toBeVisible();
    await expect(page.getByTestId('project-row-2')).toBeVisible();
    await expect(page.getByTestId('project-row-3')).toHaveCount(0);
    await expect(page.getByTestId('project-row-4')).toHaveCount(0);
    await expect(page.locator('[data-testid^="project-row-"]')).toHaveCount(2);

    // Switch to Backend: the set flips to just project 3 — proving the control reads the choice, not a
    // fixed label.
    await narrowTo(page, BACKEND);
    await expect(page.getByTestId('project-row-3')).toBeVisible();
    await expect(page.getByTestId('project-row-3').getByTestId('project-name')).toHaveText('Warehouse automation');
    await expect(page.getByTestId('project-row-1')).toHaveCount(0);
    await expect(page.getByTestId('project-row-2')).toHaveCount(0);
    await expect(page.getByTestId('project-row-4')).toHaveCount(0);
    await expect(page.locator('[data-testid^="project-row-"]')).toHaveCount(1);
  });

  test('clearing the filter brings every project back, including the unlabelled one', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByTestId('project-row-1')).toBeVisible();

    await narrowTo(page, FRONTEND);
    await expect(page.locator('[data-testid^="project-row-"]')).toHaveCount(2);

    // Back to all: the Backend project and the unlabelled project return alongside the Frontend ones.
    await showAll(page);
    await expect(page.getByTestId('project-row-1')).toBeVisible();
    await expect(page.getByTestId('project-row-2')).toBeVisible();
    await expect(page.getByTestId('project-row-3')).toBeVisible();
    await expect(page.getByTestId('project-row-4')).toBeVisible();
    await expect(page.locator('[data-testid^="project-row-"]')).toHaveCount(4);
  });
});
