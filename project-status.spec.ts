// Acceptance tests for the change request:
//   "Let me mark a project as active, on hold or finished. Show which it is."
//
// A project now carries a STATUS — one of active, on hold or finished. The projects list shows,
// alongside each project's name and client, WHICH status it is (project-status, a cell in the
// project row, like the invoice list shows invoice-status). The add-a-project form lets the owner
// PICK that status when creating the project (project-form-status), and the project then shows the
// status that was picked — not a fixed default.
//
// Asserts ONLY through the UI (data-testid). Data is arranged via resetAndSeed, which honours
// projects: { id, clientId, name, status } (alongside clients) — `status` seeds a project directly
// into one of the three states so the display can be checked without a click; the pick-a-status flow
// is driven through the existing project form. This change records nothing, so no audit channel is
// used.
//
// The three states are the change request's own words ("active", "on hold", "finished"), asserted
// VOCABULARY- and CASING-tolerantly so whichever wording/casing the feature renders passes (the
// invoice-status specs do the same). Each state is matched by the one token that distinguishes it,
// and every status cell is also asserted NOT to read as either of the other two — so a project that
// shows the WRONG status (a leaked default, a mislabelled cell) fails rather than passing on a loose
// match. This SHOULD FAIL before the change: a project row carries no project-status cell today, and
// the add form has no project-form-status control.
import { test, expect, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// The distinguishing token for each state. Mutually exclusive: "active" carries only ACTIVE,
// "on hold" only HOLD, "finished" only FINISHED — so each can be told apart from the other two.
const ACTIVE = /active/i;
const HOLD = /hold/i;
const FINISHED = /finish|complete|done/i;

// Pick the option in the status dropdown whose visible text matches `re`, selecting it by its value
// (so the exact label casing/wording the feature chose does not have to be known up front).
async function pickStatus(select: Locator, re: RegExp): Promise<void> {
  const options = select.locator('option');
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const option = options.nth(i);
    const text = (await option.textContent())?.trim() ?? '';
    if (re.test(text)) {
      const value = await option.getAttribute('value');
      await select.selectOption(value !== null ? value : { label: text });
      return;
    }
  }
  throw new Error(`no status option matching ${re} in project-form-status`);
}

test.describe('mark a project as active, on hold or finished', () => {
  test('lists each project showing which status it is', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign', status: 'active' },
        { id: 2, clientId: 1, name: 'Warehouse automation', status: 'on hold' },
        { id: 3, clientId: 1, name: 'Mobile app', status: 'finished' },
      ],
    });

    await page.goto('/projects');
    await expect(page.getByTestId('projects-page')).toBeVisible();
    await expect(page.getByTestId('projects-table')).toBeVisible();

    // Project 1 is active — and reads as active, not as on hold or finished.
    const active = page.getByTestId('project-row-1');
    await expect(active).toBeVisible();
    await expect(active.getByTestId('project-name')).toHaveText('Website redesign');
    await expect(active.getByTestId('project-status')).toContainText(ACTIVE);
    await expect(active.getByTestId('project-status')).not.toContainText(HOLD);
    await expect(active.getByTestId('project-status')).not.toContainText(FINISHED);

    // Project 2 is on hold — and reads as on hold, not active or finished.
    const onHold = page.getByTestId('project-row-2');
    await expect(onHold).toBeVisible();
    await expect(onHold.getByTestId('project-name')).toHaveText('Warehouse automation');
    await expect(onHold.getByTestId('project-status')).toContainText(HOLD);
    await expect(onHold.getByTestId('project-status')).not.toContainText(ACTIVE);
    await expect(onHold.getByTestId('project-status')).not.toContainText(FINISHED);

    // Project 3 is finished — and reads as finished, not active or on hold.
    const finished = page.getByTestId('project-row-3');
    await expect(finished).toBeVisible();
    await expect(finished.getByTestId('project-name')).toHaveText('Mobile app');
    await expect(finished.getByTestId('project-status')).toContainText(FINISHED);
    await expect(finished.getByTestId('project-status')).not.toContainText(ACTIVE);
    await expect(finished.getByTestId('project-status')).not.toContainText(HOLD);
  });

  test('adds a project, picks its status, and shows the status that was picked', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [],
    });

    await page.goto('/projects');
    await expect(page.getByTestId('projects-empty')).toBeVisible();

    const form = page.getByTestId('project-form');
    await expect(form).toBeVisible();
    await form.getByTestId('project-form-name').fill('Billing portal');
    await page.getByTestId('project-form-client').selectOption({ label: 'Acme Corp' });

    // Pick a status that is NOT the likely default ("active"), so showing it proves the pick was
    // honoured rather than a fixed initial value being displayed.
    const status = page.getByTestId('project-form-status');
    await expect(status).toBeVisible();
    await pickStatus(status, HOLD);

    await page.getByTestId('project-form-submit').click();

    // RESTART IDENTITY on reset + no projects seeded => the created project is id 1.
    const row = page.getByTestId('project-row-1');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('project-name')).toHaveText('Billing portal');
    await expect(row.getByTestId('project-client')).toHaveText('Acme Corp');

    // It shows the on-hold status that was chosen — not active, not finished.
    await expect(row.getByTestId('project-status')).toContainText(HOLD);
    await expect(row.getByTestId('project-status')).not.toContainText(ACTIVE);
    await expect(row.getByTestId('project-status')).not.toContainText(FINISHED);

    await expect(page.getByTestId('projects-empty')).toHaveCount(0);
  });

  test('a project added as finished shows finished, proving the choice is not hardcoded', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [],
    });

    await page.goto('/projects');
    await expect(page.getByTestId('project-form')).toBeVisible();

    await page.getByTestId('project-form').getByTestId('project-form-name').fill('Archive import');
    await page.getByTestId('project-form-client').selectOption({ label: 'Acme Corp' });
    await pickStatus(page.getByTestId('project-form-status'), FINISHED);
    await page.getByTestId('project-form-submit').click();

    const row = page.getByTestId('project-row-1');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('project-name')).toHaveText('Archive import');
    await expect(row.getByTestId('project-status')).toContainText(FINISHED);
    await expect(row.getByTestId('project-status')).not.toContainText(ACTIVE);
    await expect(row.getByTestId('project-status')).not.toContainText(HOLD);
  });
});
