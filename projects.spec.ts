// Acceptance test for the change request:
//   "I want to track the projects I do for clients. Let me add a project and pick which client it
//    is for. Show each project with the client's name."
//
// A project belongs to a client. The projects page lists every project, and each project is shown
// together with the NAME of the client it is for (not an id). A new project is added by giving it a
// name and PICKING which client it is for; once added it joins the same single list, carrying that
// client's name.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed (the app's /__test__
// endpoint): `clients` honours { id, name, email } and `projects` honours { id, name, clientId }.
import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

const projectRows = (page: Page) => page.locator('[data-testid^="project-row-"]');

// Locate the one project row carrying the given name, regardless of its server-assigned id.
const projectRowNamed = (page: Page, name: string) =>
  projectRows(page).filter({
    has: page.getByTestId('project-name').getByText(name, { exact: true }),
  });

test.describe('Projects', () => {
  test('a link in the nav opens the projects page', async ({ page }) => {
    await resetAndSeed({ clients: [], projects: [] });

    await page.goto('/');
    // The shell and the unchanged Home empty state are still present.
    await expect(page.getByTestId('app-root')).toBeVisible();
    await expect(page.getByTestId('app-nav')).toBeVisible();
    await expect(page.getByTestId('home-empty')).toBeVisible();

    // Projects is reachable from the nav; following it lands on the projects page.
    const navProjects = page.getByTestId('nav-projects');
    await expect(navProjects).toBeVisible();
    await navProjects.click();

    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByTestId('projects-page')).toBeVisible();
  });

  test('with no projects the list shows an empty state', async ({ page }) => {
    // Clients may exist (they are pickable) but there are no projects yet.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      projects: [],
    });

    await page.goto('/projects');

    await expect(page.getByTestId('projects-page')).toBeVisible();
    await expect(page.getByTestId('projects-empty')).toBeVisible();
    // Nothing is listed yet.
    await expect(projectRows(page)).toHaveCount(0);
  });

  test('every seeded project is shown with its name and the name of the client it is for', async ({
    page,
  }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      projects: [
        { id: 1, name: 'Website Redesign', clientId: 1 },
        { id: 2, name: 'Mobile App', clientId: 2 },
        { id: 3, name: 'Billing System', clientId: 1 },
      ],
    });

    await page.goto('/projects');

    await expect(page.getByTestId('projects-page')).toBeVisible();
    await expect(page.getByTestId('projects-table')).toBeVisible();
    await expect(page.getByTestId('projects-empty')).toHaveCount(0);

    // Every seeded project appears as its own row, carrying its name and its client's NAME.
    await expect(projectRows(page)).toHaveCount(3);

    const website = page.getByTestId('project-row-1');
    await expect(website).toBeVisible();
    await expect(website.getByTestId('project-name')).toHaveText('Website Redesign');
    await expect(website.getByTestId('project-client')).toHaveText('Acme Corp');

    const mobile = page.getByTestId('project-row-2');
    await expect(mobile.getByTestId('project-name')).toHaveText('Mobile App');
    await expect(mobile.getByTestId('project-client')).toHaveText('Globex');

    // Two projects for the same client both show that client's name.
    const billing = page.getByTestId('project-row-3');
    await expect(billing.getByTestId('project-name')).toHaveText('Billing System');
    await expect(billing.getByTestId('project-client')).toHaveText('Acme Corp');
  });

  test('adding a project and picking its client shows it with that client name', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      projects: [],
    });

    await page.goto('/projects');
    await expect(page.getByTestId('projects-empty')).toBeVisible();

    // Fill the add-project form: give it a name and PICK which client it is for.
    await expect(page.getByTestId('project-form')).toBeVisible();
    await page.getByTestId('project-form-name').fill('Website Redesign');
    await page.getByTestId('project-form-client').selectOption({ label: 'Globex' });
    await page.getByTestId('project-form-submit').click();

    // The newly added project appears, carrying its name and the picked client's name. Its id is
    // assigned by the server, so locate the row by its content rather than a known id.
    const newRow = projectRowNamed(page, 'Website Redesign');
    await expect(newRow).toHaveCount(1);
    await expect(newRow.getByTestId('project-name')).toHaveText('Website Redesign');
    await expect(newRow.getByTestId('project-client')).toHaveText('Globex');

    // The empty state is gone now that a project exists.
    await expect(page.getByTestId('projects-empty')).toHaveCount(0);
    await expect(page.getByTestId('projects-table')).toBeVisible();

    // And it survives a fresh load from the server.
    await page.reload();
    const reloaded = projectRowNamed(page, 'Website Redesign');
    await expect(reloaded).toHaveCount(1);
    await expect(reloaded.getByTestId('project-client')).toHaveText('Globex');
  });

  test('a project added on top of seeded projects joins the same single list', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'hello@acme.test' },
        { id: 2, name: 'Globex', email: 'contact@globex.test' },
      ],
      projects: [{ id: 1, name: 'Website Redesign', clientId: 1 }],
    });

    await page.goto('/projects');
    await expect(projectRows(page)).toHaveCount(1);

    await page.getByTestId('project-form-name').fill('Mobile App');
    await page.getByTestId('project-form-client').selectOption({ label: 'Globex' });
    await page.getByTestId('project-form-submit').click();

    // Both the pre-existing and the newly added project are shown together in the one list, each
    // with its own client's name.
    await expect(projectRows(page)).toHaveCount(2);
    await expect(page.getByTestId('project-row-1').getByTestId('project-name')).toHaveText(
      'Website Redesign',
    );
    await expect(page.getByTestId('project-row-1').getByTestId('project-client')).toHaveText(
      'Acme Corp',
    );

    const mobileRow = projectRowNamed(page, 'Mobile App');
    await expect(mobileRow).toHaveCount(1);
    await expect(mobileRow.getByTestId('project-client')).toHaveText('Globex');
  });
});
