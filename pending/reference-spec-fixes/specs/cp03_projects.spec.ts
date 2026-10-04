import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// Second entity + a cross-entity join in the UI: a project belongs to a client, and the projects
// list shows the client's NAME (not id). project-form-client is a select whose option values are client ids.
test.describe('projects', () => {
  test('lists projects with their client name', { tag: '@core' }, async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Ltd', email: 'ops@acme.example' }],
      projects: [
        { id: 1, name: 'Website Rebuild', clientId: 1 },
        { id: 2, name: 'Mobile App', clientId: 1 },
      ],
    });
    await page.goto('/');
    await page.getByTestId('nav-projects').click();

    await expect(page.getByTestId('projects-table')).toBeVisible();
    // ALL the projects, not just the first — a list that silently truncates looks identical on a
    // single-row fixture.
    await expect(page.getByTestId(/^project-row-/)).toHaveCount(2);
    await expect(page.getByTestId('project-row-1').getByTestId('project-name')).toHaveText('Website Rebuild');
    await expect(page.getByTestId('project-row-1').getByTestId('project-client')).toHaveText('Acme Ltd');
    await expect(page.getByTestId('project-row-2').getByTestId('project-name')).toHaveText('Mobile App');
  });

  test('creates a project for a client', { tag: '@core' }, async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Ltd', email: 'ops@acme.example' }],
      projects: [],
    });
    await page.goto('/');
    await page.getByTestId('nav-projects').click();

    await page.getByTestId('project-form-name').fill('Mobile App');
    await page.getByTestId('project-form-client').selectOption('1'); // option value = client id
    await page.getByTestId('project-form-submit').click();

    await expect(page.getByTestId(/^project-row-/)).toHaveCount(1);
    const row = page.getByTestId(/^project-row-/).first();
    await expect(row.getByTestId('project-name')).toHaveText('Mobile App');
    await expect(row.getByTestId('project-client')).toHaveText('Acme Ltd');
  });
});
