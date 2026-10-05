// Acceptance tests for the change request:
//   "Let me keep a task list on each project. Let me tick things off as I finish them."
//
// A project now keeps a list of tasks. Opening a project (project-open-<id> from the projects list)
// reaches its detail page, which lists THAT project's own tasks (project-tasks-table) — each row
// (task-row-<id>) showing the task's title (task-title) and a status (task-status) that reflects
// whether it is done. A project with no tasks shows an empty state (project-tasks-empty). Each task
// offers a control to tick it off / un-tick it (task-toggle-<id>); toggling flips THAT task's done
// status and appends one audit record — TASK_TOGGLED id=<id> done=<done> — so the change can be
// checked back later. Toggling one task must not touch its siblings, and each toggle writes its own
// record.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed; the toggle flow is driven through the UI.
// Seed honours tasks: { id, projectId, title, done }.
//
// The status LABEL text is not hard-coded (the request does not fix any wording): instead the test
// asserts that a done task's status DIFFERS from a not-done task's, and that toggling moves a task's
// status to match the done/not-done representation it should now have. The audit boolean is matched
// case-insensitively (done=true / done=false). This test SHOULD FAIL before the change: today a
// project's detail page has no task list at all.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

test.describe('project task list', () => {
  test('opening a project lists its own tasks with their titles, and a done task reads differently from a not-done one', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign' },
        { id: 2, clientId: 1, name: 'Warehouse automation' },
      ],
      tasks: [
        { id: 1, projectId: 1, title: 'Design the homepage', done: false },
        { id: 2, projectId: 1, title: 'Write the copy', done: true },
        // Belongs to a DIFFERENT project — it must not appear on project 1's page.
        { id: 3, projectId: 2, title: 'Install the conveyor', done: false },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();

    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('project-tasks-table')).toBeVisible();
    await expect(page.getByTestId('project-tasks-empty')).toHaveCount(0);

    // Project 1's own tasks, each showing its title.
    const notDone = page.getByTestId('task-row-1');
    await expect(notDone).toBeVisible();
    await expect(notDone.getByTestId('task-title')).toHaveText('Design the homepage');

    const done = page.getByTestId('task-row-2');
    await expect(done).toBeVisible();
    await expect(done.getByTestId('task-title')).toHaveText('Write the copy');

    // The other project's task is not shown here.
    await expect(page.getByTestId('task-row-3')).toHaveCount(0);

    // Each task surfaces a status, and the done task reads differently from the not-done one.
    await expect(notDone.getByTestId('task-status')).toBeVisible();
    await expect(done.getByTestId('task-status')).toBeVisible();
    const notDoneStatus = ((await notDone.getByTestId('task-status').textContent()) ?? '').trim();
    const doneStatus = ((await done.getByTestId('task-status').textContent()) ?? '').trim();
    expect(doneStatus).not.toBe(notDoneStatus);
  });

  test('a project with no tasks shows an empty state and no task rows', async ({ page }) => {
    // The project exists so the page can only be empty of TASKS, not of everything.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      tasks: [],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();

    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('project-tasks-empty')).toBeVisible();
    await expect(page.getByTestId('task-title')).toHaveCount(0);
  });

  test('ticking a task off flips its status and keeps a record; toggling back flips it and records again', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      tasks: [
        { id: 1, projectId: 1, title: 'Ship the release', done: false },
        // A reference task seeded as DONE, so the test knows what a done status looks like without
        // hard-coding its wording.
        { id: 2, projectId: 1, title: 'Already finished', done: true },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const row = page.getByTestId('task-row-1');
    await expect(row).toBeVisible();

    const status = row.getByTestId('task-status');
    await expect(status).toBeVisible();
    const notDoneStatus = ((await status.textContent()) ?? '').trim();
    const doneStatus = ((await page.getByTestId('task-row-2').getByTestId('task-status').textContent()) ?? '').trim();
    // Done and not-done must look different, else "status" conveys nothing.
    expect(doneStatus).not.toBe(notDoneStatus);

    // reset cleared the audit file — nothing has been toggled yet.
    expect(auditLines()).toEqual([]);

    // Tick it off: its status moves to the done representation.
    await page.getByTestId('task-toggle-1').click();
    await expect(status).toHaveText(doneStatus);

    // Exactly one record was kept for the toggle, naming the task and that it is now done.
    await expect
      .poll(() => auditLines().filter((l) => /^TASK_TOGGLED id=1 done=true$/i.test(l)))
      .toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // Toggle it back: its status returns to the not-done representation, and a second record is kept.
    await page.getByTestId('task-toggle-1').click();
    await expect(status).toHaveText(notDoneStatus);

    await expect.poll(() => auditLines()).toHaveLength(2);
    const lines = auditLines();
    expect(lines.some((l) => /^TASK_TOGGLED id=1 done=true$/i.test(l))).toBe(true);
    expect(lines.some((l) => /^TASK_TOGGLED id=1 done=false$/i.test(l))).toBe(true);
  });

  test('toggling one task leaves its siblings untouched, and each toggle writes its own record', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      tasks: [
        { id: 1, projectId: 1, title: 'First task', done: false },
        { id: 2, projectId: 1, title: 'Second task', done: false },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const first = page.getByTestId('task-row-1').getByTestId('task-status');
    const second = page.getByTestId('task-row-2').getByTestId('task-status');
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();

    // Both start not done, so they read the same.
    const startStatus = ((await second.textContent()) ?? '').trim();
    await expect(first).toHaveText(startStatus);

    // Tick the first off. It changes; the second is untouched (still reads as it did).
    await page.getByTestId('task-toggle-1').click();
    await expect(first).not.toHaveText(startStatus);
    await expect(second).toHaveText(startStatus);

    // One record so far, for task 1 becoming done — and only that one.
    await expect
      .poll(() => auditLines().filter((l) => /^TASK_TOGGLED id=1 done=true$/i.test(l)))
      .toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // Now tick the second off too — a separate record is kept for it as well.
    await page.getByTestId('task-toggle-2').click();
    await expect(second).not.toHaveText(startStatus);

    await expect.poll(() => auditLines()).toHaveLength(2);
    const lines = auditLines();
    expect(lines.some((l) => /^TASK_TOGGLED id=1 done=true$/i.test(l))).toBe(true);
    expect(lines.some((l) => /^TASK_TOGGLED id=2 done=true$/i.test(l))).toBe(true);
  });
});
