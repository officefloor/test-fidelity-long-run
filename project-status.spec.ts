// Acceptance test for the change request:
//   "Let me mark a project as active, on hold or finished. Show which it is."
//
// A project carries a STATUS — one of three stages: active, on hold, or finished. Every project is
// SHOWN with which stage it is at (project-status), and the add-a-project form gains a control to
// PICK the stage a new project starts at (project-form-status). The picked stage is held by the
// server, so it survives a fresh load, and the picker genuinely drives the value — two projects
// added with different stages each show their own. A project added without touching the picker
// starts ACTIVE (the natural default), which is also why the existing add flow still works.
//
// Each stage is matched by the WORD that names it, case-insensitively, so the test binds to the
// stage's MEANING and not to one capitalisation or spelling the app happens to use internally — the
// same way the invoice-status specs match the stage word. "on hold" allows an optional separator
// (space / hyphen / underscore) so "On hold", "on-hold" and "ON_HOLD" all count.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email } and `projects` honours { id, name, clientId,
// status }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// The three stages, each pinned by the word that names it (case-insensitive). Word boundaries keep
// them distinct; "on hold" tolerates any single separator between the two words.
const ACTIVE = /\bactive\b/i;
const ON_HOLD = /\bon[\s_-]?hold\b/i;
const FINISHED = /\bfinished\b/i;

const projectRows = (page: Page) => page.locator('[data-testid^="project-row-"]');

// Locate the one project row carrying the given name, regardless of its server-assigned id.
const projectRowNamed = (page: Page, name: string) =>
  projectRows(page).filter({
    has: page.getByTestId('project-name').getByText(name, { exact: true }),
  });

const statusOf = (page: Page, id: number): Locator =>
  page.getByTestId(`project-row-${id}`).getByTestId('project-status');

// Pick a stage in the add-project form. The option is found by the stage WORD in its label and
// selected by that option's OWN value, so the stage is pinned by meaning, not by the exact value or
// capitalisation the control uses internally.
async function chooseStatus(page: Page, word: RegExp): Promise<void> {
  const select = page.getByTestId('project-form-status');
  await expect(select).toBeVisible();
  const value = await select
    .locator('option')
    .filter({ hasText: word })
    .first()
    .evaluate((el: HTMLOptionElement) => el.value);
  await select.selectOption(value);
}

const CLIENTS = [
  { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
  { id: 2, name: 'Globex', email: 'contact@globex.test' },
];

test.describe('Mark a project with a status', () => {
  test('every seeded project is shown with which stage it is at', async ({ page }) => {
    await resetAndSeed({
      clients: CLIENTS,
      projects: [
        { id: 1, name: 'Website Redesign', clientId: 1, status: 'ACTIVE' },
        { id: 2, name: 'Mobile App', clientId: 2, status: 'ON_HOLD' },
        { id: 3, name: 'Billing System', clientId: 1, status: 'FINISHED' },
      ],
    });

    await page.goto('/projects');
    await expect(page.getByTestId('projects-page')).toBeVisible();
    await expect(page.getByTestId('projects-table')).toBeVisible();
    await expect(projectRows(page)).toHaveCount(3);

    // Each project shows WHICH stage it is at — the three rows carry three different stages, so the
    // status is genuinely per-project and not a fixed label.
    await expect(statusOf(page, 1)).toHaveText(ACTIVE);
    await expect(statusOf(page, 2)).toHaveText(ON_HOLD);
    await expect(statusOf(page, 3)).toHaveText(FINISHED);

    // ...and each row shows ITS OWN stage, not another's — the active project does not read as
    // finished, nor the finished one as active.
    await expect(statusOf(page, 1)).not.toHaveText(FINISHED);
    await expect(statusOf(page, 3)).not.toHaveText(ACTIVE);
  });

  test('adding a project lets me pick its stage, which is shown and held by the server', async ({
    page,
  }) => {
    await resetAndSeed({ clients: CLIENTS, projects: [] });

    await page.goto('/projects');
    await expect(page.getByTestId('projects-empty')).toBeVisible();

    // Fill the add-project form: name, client, and PICK the stage it starts at.
    await expect(page.getByTestId('project-form')).toBeVisible();
    await page.getByTestId('project-form-name').fill('Mobile App');
    await page.getByTestId('project-form-client').selectOption({ label: 'Globex' });
    await chooseStatus(page, ON_HOLD);
    await page.getByTestId('project-form-submit').click();

    // The new project appears carrying the stage that was picked for it.
    const row = projectRowNamed(page, 'Mobile App');
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('project-status')).toHaveText(ON_HOLD);

    // The stage is held by the server, not just the page: it survives a fresh load.
    await page.reload();
    const reloaded = projectRowNamed(page, 'Mobile App');
    await expect(reloaded).toHaveCount(1);
    await expect(reloaded.getByTestId('project-status')).toHaveText(ON_HOLD);
  });

  test('the picker drives the stage — two projects added with different stages each show their own', async ({
    page,
  }) => {
    await resetAndSeed({ clients: CLIENTS, projects: [] });

    await page.goto('/projects');

    // First project: finished.
    await page.getByTestId('project-form-name').fill('Old Site');
    await page.getByTestId('project-form-client').selectOption({ label: 'Acme Corp' });
    await chooseStatus(page, FINISHED);
    await page.getByTestId('project-form-submit').click();
    await expect(projectRowNamed(page, 'Old Site')).toHaveCount(1);

    // Second project: on hold. Had the stage been hardwired, this would read the same as the first.
    await page.getByTestId('project-form-name').fill('New Site');
    await page.getByTestId('project-form-client').selectOption({ label: 'Acme Corp' });
    await chooseStatus(page, ON_HOLD);
    await page.getByTestId('project-form-submit').click();
    await expect(projectRowNamed(page, 'New Site')).toHaveCount(1);

    // Each carries the stage it was given — the picker, not a fixed value, decided each one.
    await expect(projectRowNamed(page, 'Old Site').getByTestId('project-status')).toHaveText(
      FINISHED,
    );
    await expect(projectRowNamed(page, 'New Site').getByTestId('project-status')).toHaveText(
      ON_HOLD,
    );
  });

  test('a project added without touching the picker starts active', async ({ page }) => {
    await resetAndSeed({ clients: CLIENTS, projects: [] });

    await page.goto('/projects');

    // Add a project the plain way — give it a name and a client, submit, leave the stage picker
    // alone. A new project starts ACTIVE.
    await page.getByTestId('project-form-name').fill('Fresh Project');
    await page.getByTestId('project-form-client').selectOption({ label: 'Globex' });
    await page.getByTestId('project-form-submit').click();

    const row = projectRowNamed(page, 'Fresh Project');
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('project-status')).toHaveText(ACTIVE);
  });
});
