// Acceptance test for the change request:
//   "Let me see just the open tasks on a project. Or just the finished ones."
//
// A project's task list (on its detail page, /projects/<id>) gains a control
// (data-testid="task-filter") that narrows the list to tasks at ONE stage. A task is either OPEN
// (not yet done) or DONE (ticked off — the request calls these the "finished" ones), so choosing a
// stage leaves only the tasks at that stage: choose OPEN and only the un-ticked tasks remain; choose
// DONE and only the ticked-off ones remain. Before a stage is chosen the list is unfiltered (every
// task on the project shows). Choosing the other stage narrows to THAT stage, and returning to "all
// tasks" brings every task back — so the filter is genuinely keyed on the chosen stage and not
// hardwired to one. Because a filter outlives a click (CLAUDE.md rule 4) the chosen stage lives in
// the URL and survives a fresh load. Filtering is a pure view concern: it records nothing.
//
// The contract for the control mirrors its sibling invoice-status-filter: it is a <select> on the
// project detail page with one option per stage (its label NAMING the stage — open / done i.e.
// finished) plus a default "all tasks" option carrying an empty value (no stage => unfiltered). The
// test chooses a stage by finding the option whose label NAMES that stage (case-insensitively) and
// selecting it by the option's own value, so it binds to the stage's MEANING, not the exact value or
// capitalisation the control uses internally — the same way the sibling specs match task-status by
// the stage word.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed (the app's /__test__ endpoint): `clients`
// honours { id, name, email }, `projects` honours { id, name, clientId } and `tasks` honours
// { id, title, projectId, done }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

// A task's status cell reads "done" once ticked off and some other way ("open"/…) while not — matched
// by the WORD, case-insensitively, so the test binds to the MEANING and not one capitalisation.
const DONE = /\bdone\b/i;

// The two stages, matched by the WORD(s) that name them in the filter's option labels. "open" is the
// un-ticked stage; the finished stage may be labelled "done" or "finished" (the request's own word),
// so either names it. Word boundaries keep the stages distinct and keep the default "all tasks"
// option (which names neither) out of both.
const OPEN = /\bopen\b/i;
const FINISHED = /\b(?:done|finished|complete)/i;

const taskRows = (page: Page) => page.locator('[data-testid^="task-row-"]');
const statusOf = (page: Page, id: number): Locator =>
  page.getByTestId(`task-row-${id}`).getByTestId('task-status');

// A spread of open and finished tasks on one project, plus a task on a DIFFERENT project that must
// never appear here regardless of the filter. More than one task at each stage so narrowing to a
// stage must drop several rows — a filter that merely hid one row could not reproduce these results.
const SEED = {
  clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
  projects: [
    { id: 1, name: 'Website Redesign', clientId: 1 },
    { id: 2, name: 'Mobile App', clientId: 1 },
  ],
  tasks: [
    { id: 1, title: 'Draft the brief', projectId: 1, done: false },
    { id: 2, title: 'Build the homepage', projectId: 1, done: true },
    { id: 3, title: 'Review with client', projectId: 1, done: false },
    { id: 4, title: 'Launch announcement', projectId: 1, done: true },
    { id: 5, title: 'Gather feedback', projectId: 1, done: false },
    // A task on another project must not show here under ANY filter.
    { id: 6, title: 'Ship to the store', projectId: 2, done: false },
  ],
};

const OPEN_IDS = [1, 3, 5];
const DONE_IDS = [2, 4];
const ALL_IDS = [1, 2, 3, 4, 5];

// The ids of the currently-rendered task rows, ascending (order is not what this feature is about).
async function visibleIds(page: Page): Promise<number[]> {
  return taskRows(page).evaluateAll((els) =>
    els
      .map((el) => Number(el.getAttribute('data-testid')!.replace('task-row-', '')))
      .sort((a, b) => a - b),
  );
}

// Choose a stage in the filter. The option is found by the stage WORD in its label and selected by
// that option's own value, so the stage is pinned by meaning, not by an exact value/capitalisation.
async function chooseStage(page: Page, word: RegExp): Promise<void> {
  const filter = page.getByTestId('task-filter');
  await expect(filter).toBeVisible();
  const value = await filter
    .locator('option')
    .filter({ hasText: word })
    .first()
    .evaluate((el: HTMLOptionElement) => el.value);
  await filter.selectOption(value);
}

// Return the filter to "all tasks": the default option carries no stage, so it has an empty value
// (an empty value clears the URL key, leaving the list unfiltered) — same mechanism as the sibling
// invoice-status-filter.
async function chooseAllTasks(page: Page): Promise<void> {
  await page.getByTestId('task-filter').selectOption('');
}

test.describe('See just the open tasks on a project, or just the finished ones', () => {
  test('the project page offers a task filter and lists every task before one is chosen', async ({
    page,
  }) => {
    await resetAndSeed(SEED);

    await page.goto('/projects/1');
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    // The new filter control is present on the page.
    await expect(page.getByTestId('task-filter')).toBeVisible();

    // Before any stage is chosen the list is unfiltered: every task on THIS project is shown, and
    // the other project's task is not.
    await expect(page.getByTestId('project-tasks-table')).toBeVisible();
    await expect(taskRows(page)).toHaveCount(ALL_IDS.length);
    expect(await visibleIds(page)).toEqual(ALL_IDS);
    await expect(page.getByTestId('task-row-6')).toHaveCount(0);
  });

  test('choosing "open" narrows the list to only the open tasks', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/projects/1');
    // Precondition: everything is listed, so the narrowing below is a real effect of the filter.
    await expect(taskRows(page)).toHaveCount(ALL_IDS.length);

    await chooseStage(page, OPEN);

    // Only the open tasks remain; every finished task has dropped out of the list.
    await expect(taskRows(page)).toHaveCount(OPEN_IDS.length);
    expect(await visibleIds(page)).toEqual(OPEN_IDS);
    for (const id of OPEN_IDS) {
      await expect(page.getByTestId(`task-row-${id}`)).toBeVisible();
      await expect(statusOf(page, id)).not.toHaveText(DONE);
    }
    for (const id of DONE_IDS) {
      await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);
    }

    // The surviving rows still carry their real data — narrowing filters the list, it does not blank it.
    await expect(page.getByTestId('task-row-1').getByTestId('task-title')).toHaveText('Draft the brief');
    await expect(page.getByTestId('task-row-3').getByTestId('task-title')).toHaveText('Review with client');
  });

  test('the filter is keyed on the chosen stage: each stage narrows to its own tasks', async ({
    page,
  }) => {
    await resetAndSeed(SEED);

    await page.goto('/projects/1');

    // Finished tasks only — the request's "just the finished ones".
    await chooseStage(page, FINISHED);
    await expect(taskRows(page)).toHaveCount(DONE_IDS.length);
    expect(await visibleIds(page)).toEqual(DONE_IDS);
    for (const id of DONE_IDS) {
      await expect(statusOf(page, id)).toHaveText(DONE);
    }

    // Switching to open narrows to a DIFFERENT set — proof the filter follows the chosen stage and
    // is not hardwired to one (the finished tasks are gone, the open ones are now shown).
    await chooseStage(page, OPEN);
    await expect(taskRows(page)).toHaveCount(OPEN_IDS.length);
    expect(await visibleIds(page)).toEqual(OPEN_IDS);
    for (const id of OPEN_IDS) {
      await expect(statusOf(page, id)).not.toHaveText(DONE);
    }

    // Returning to "all tasks" brings every task back.
    await chooseAllTasks(page);
    await expect(taskRows(page)).toHaveCount(ALL_IDS.length);
    expect(await visibleIds(page)).toEqual(ALL_IDS);
  });

  test('the chosen stage survives a fresh load, and filtering records nothing', async ({ page }) => {
    await resetAndSeed(SEED);

    await page.goto('/projects/1');
    await chooseStage(page, FINISHED);
    await expect(taskRows(page)).toHaveCount(DONE_IDS.length);
    expect(await visibleIds(page)).toEqual(DONE_IDS);

    // Reloading re-reads the page; the chosen stage is still in effect and the same rows come back
    // (the filter lives in the URL, not in throwaway component state).
    await page.reload();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(taskRows(page)).toHaveCount(DONE_IDS.length);
    expect(await visibleIds(page)).toEqual(DONE_IDS);

    // Filtering is a pure view concern: narrowing the list (and reloading) is not a change to any
    // task, so nothing is appended to the audit file.
    expect(auditLines()).toEqual([]);
  });
});
