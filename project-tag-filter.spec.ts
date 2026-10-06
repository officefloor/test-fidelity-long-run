// Acceptance test for the change request:
//   "Let me filter my projects by label."
//
// The projects list page (projects-page, /projects), which lists every project, gains a control
// (data-testid="project-tag-filter") that narrows the one list down to the projects carrying a
// SINGLE chosen label. Labels are DATA — the tags seeded onto projects (the same labels the project
// detail page shows as chips, grouped via projectTags) — so the filter's options are those labels,
// not a fixed set of stages. Choosing a label leaves only the projects that carry it; a project that
// does not carry the chosen label (including one carrying no labels at all) drops out. Before a label
// is chosen the list is unfiltered (every project shows). Choosing a DIFFERENT label narrows to THAT
// label's projects, and returning to "all labels" brings every project back — so the filter is
// genuinely keyed on the chosen label and not hardwired to one. Because a filter outlives a click
// (CLAUDE.md rule 4) the chosen label lives in the URL and survives a fresh load. Filtering is a pure
// view concern: it records nothing.
//
// The contract for the control mirrors its toolbar siblings (invoice-status-filter / task-filter): it
// is a <select> in the projects toolbar with one option per label (its label text NAMING the label)
// plus a default "all labels" option carrying an empty value (no label => unfiltered). The test
// chooses a label by finding the option whose text NAMES that label (case-insensitively) and
// selecting it by the option's OWN value, so it binds to the label's MEANING — not the exact value
// (tag id or tag name) the control uses internally.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed (the app's /__test__ endpoint): `clients`
// honours { id, name, email }, `projects` honours { id, name, clientId, archived }, `tags` honours
// { id, name } and `projectTags` (the join putting a label on a project) honours { projectId, tagId }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

// Each label matched by the WORD that names it, case-insensitively, so the test binds to the MEANING
// and not one capitalisation. Word boundaries keep the labels distinct; none of these words is a
// substring of another, nor of the default "all labels" option text.
const URGENT = /\burgent\b/i;
const BACKEND = /\bbackend\b/i;
const RESEARCH = /\bresearch\b/i;

const projectRows = (page: Page) => page.locator('[data-testid^="project-row-"]');

// Projects spread across three labels, several projects per label so narrowing to one label must drop
// several rows — a filter that merely hid a single row, or one hardwired to one label, could not
// reproduce these results. One project carries NO label at all, so it must disappear under every label
// and reappear only under "all labels". All projects are left un-archived so the sibling show-archived
// toggle plays no part here. Project names are chosen so none contains a label word (keeping the two
// concerns independent).
const SEED = {
  clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
  projects: [
    { id: 1, name: 'Website Rebuild', clientId: 1 },
    { id: 2, name: 'Mobile App', clientId: 1 },
    { id: 3, name: 'Billing System', clientId: 1 },
    { id: 4, name: 'Internal Portal', clientId: 1 },
    { id: 5, name: 'Marketing Hub', clientId: 1 },
  ],
  tags: [
    { id: 1, name: 'urgent' },
    { id: 2, name: 'backend' },
    { id: 3, name: 'research' },
  ],
  projectTags: [
    // urgent → projects 1 and 2
    { projectId: 1, tagId: 1 },
    { projectId: 2, tagId: 1 },
    // backend → projects 3 and 4
    { projectId: 3, tagId: 2 },
    { projectId: 4, tagId: 2 },
    // research → project 1 (project 1 carries two labels)
    { projectId: 1, tagId: 3 },
    // project 5 carries no label at all
  ],
};

const URGENT_IDS = [1, 2];
const BACKEND_IDS = [3, 4];
const RESEARCH_IDS = [1];
const ALL_IDS = [1, 2, 3, 4, 5];

// The ids of the currently-rendered project rows, ascending (order is not what this feature is about).
async function visibleIds(page: Page): Promise<number[]> {
  return projectRows(page).evaluateAll((els) =>
    els
      .map((el) => Number(el.getAttribute('data-testid')!.replace('project-row-', '')))
      .sort((a, b) => a - b),
  );
}

// Choose a label in the filter. The option is found by the label WORD in its text and selected by that
// option's own value, so the label is pinned by meaning, not by an exact value/capitalisation.
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

// Return the filter to "all labels": the default option carries no label, so it has an empty value (an
// empty value clears the URL key, leaving the list unfiltered).
async function chooseAllLabels(page: Page): Promise<void> {
  await page.getByTestId('project-tag-filter').selectOption('');
}

const nameOf = (page: Page, id: number): Locator =>
  page.getByTestId(`project-row-${id}`).getByTestId('project-name');

test.describe('Filter projects by label', () => {
  test('the projects page offers a label filter and lists every project before one is chosen', async ({
    page,
  }) => {
    await resetAndSeed(SEED);

    await page.goto('/projects');
    await expect(page.getByTestId('projects-page')).toBeVisible();

    // The new filter control is present on the page.
    await expect(page.getByTestId('project-tag-filter')).toBeVisible();

    // Before any label is chosen the list is unfiltered: every seeded project is shown, including the
    // one that carries no label.
    await expect(page.getByTestId('projects-table')).toBeVisible();
    await expect(projectRows(page)).toHaveCount(ALL_IDS.length);
    expect(await visibleIds(page)).toEqual(ALL_IDS);

    // Reading the list records nothing.
    expect(auditLines()).toEqual([]);
  });

  test('choosing a label narrows the list to only the projects carrying it', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/projects');
    // Precondition: everything is listed, so the narrowing below is a real effect of the filter.
    await expect(projectRows(page)).toHaveCount(ALL_IDS.length);

    await chooseLabel(page, URGENT);

    // Only the two projects carrying "urgent" remain; every other project — including the unlabelled
    // one — has dropped out of the list.
    await expect(projectRows(page)).toHaveCount(URGENT_IDS.length);
    expect(await visibleIds(page)).toEqual(URGENT_IDS);
    for (const id of URGENT_IDS) {
      await expect(page.getByTestId(`project-row-${id}`)).toBeVisible();
    }
    for (const id of [...BACKEND_IDS, 5]) {
      await expect(page.getByTestId(`project-row-${id}`)).toHaveCount(0);
    }

    // The surviving rows still carry their real data — narrowing filters the list, it does not blank it.
    await expect(nameOf(page, 1)).toHaveText('Website Rebuild');
    await expect(page.getByTestId('project-row-1').getByTestId('project-client')).toHaveText(
      'Acme Corp',
    );
    await expect(nameOf(page, 2)).toHaveText('Mobile App');
  });

  test('the filter is keyed on the chosen label: each label narrows to its own projects', async ({
    page,
  }) => {
    await resetAndSeed(SEED);

    await page.goto('/projects');

    // Backend projects only.
    await chooseLabel(page, BACKEND);
    await expect(projectRows(page)).toHaveCount(BACKEND_IDS.length);
    expect(await visibleIds(page)).toEqual(BACKEND_IDS);

    // Switching to "urgent" narrows to a DIFFERENT set — proof the filter follows the chosen label and
    // is not hardwired to one (the backend projects are gone, the urgent ones are now shown).
    await chooseLabel(page, URGENT);
    await expect(projectRows(page)).toHaveCount(URGENT_IDS.length);
    expect(await visibleIds(page)).toEqual(URGENT_IDS);

    // A label carried by just one project narrows to exactly that project — and project 1, which
    // carries both "urgent" and "research", is matched by EACH of its labels (the filter keys on the
    // chosen label, not on some single label per project).
    await chooseLabel(page, RESEARCH);
    await expect(projectRows(page)).toHaveCount(RESEARCH_IDS.length);
    expect(await visibleIds(page)).toEqual(RESEARCH_IDS);
    await expect(nameOf(page, 1)).toHaveText('Website Rebuild');

    // Returning to "all labels" brings every project back.
    await chooseAllLabels(page);
    await expect(projectRows(page)).toHaveCount(ALL_IDS.length);
    expect(await visibleIds(page)).toEqual(ALL_IDS);
  });

  test('the chosen label survives a fresh load, and filtering records nothing', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/projects');
    await chooseLabel(page, BACKEND);
    await expect(projectRows(page)).toHaveCount(BACKEND_IDS.length);
    expect(await visibleIds(page)).toEqual(BACKEND_IDS);

    // Reloading re-reads the page; the chosen label is still in effect and the same rows come back
    // (the filter lives in the URL, not in throwaway component state).
    await page.reload();
    await expect(page.getByTestId('projects-page')).toBeVisible();
    await expect(projectRows(page)).toHaveCount(BACKEND_IDS.length);
    expect(await visibleIds(page)).toEqual(BACKEND_IDS);

    // Filtering is a pure view concern: narrowing the list (and reloading) is not a change to any
    // project, so nothing is appended to the audit file.
    expect(auditLines()).toEqual([]);
  });
});
