// Acceptance tests for the change request:
//   "Let me put labels on projects so I can group them."
//
// A project now carries LABELS (tags). Opening a project (project-open-<id> from the projects list)
// reaches its detail page, which shows a tags region (project-tags) holding that project's labels in
// a list (project-tags-list) — one chip per label (project-tag-<id>, keyed by the TAG's id) showing
// the label's name. Labels are shared, first-class things ("so I can GROUP them"): the SAME label can
// sit on more than one project, and it shows on each project it is attached to — while a label that is
// not on this project does not appear here.
//
// A form adds a label to the project: type the label name into project-tag-add and submit it with
// project-tag-add-submit — the label then appears as a chip in the list. Each chip offers a control to
// take the label back off the project (project-tag-remove-<id>). Attaching a label appends exactly one
// audit record — PROJECT_TAGGED project=<project> tag=<tag> — and detaching one appends exactly one
// PROJECT_UNTAGGED project=<project> tag=<tag>, so the grouping change can be checked back later (the
// UI only shows the current labels; it cannot show that one was just attached or removed).
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed, which honours tags: { id, name }, the join
// projectTags: { projectId, tagId }, and projects: { id, clientId, name }. The project detail page is
// reached the same way the project-tasks / project-archive specs reach it: /projects then
// project-open-<id>.
//
// The audit identifies the project and the label by `project=<project>` / `tag=<tag>`; the change
// request does not fix whether that is the row's id or its name, so each is matched against EITHER its
// seeded id OR its seeded name (ids and names are chosen so neither is a substring of the other). The
// record is still pinned exactly otherwise — the verb, the two field names, and that exactly one line
// is appended per action — so this stays a strong assertion, not a loose one.
//
// This SHOULD FAIL before the change: today a project's detail page has no tags region, no add form,
// and nothing is recorded when a project is labelled or unlabelled.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

test.describe('label projects to group them', () => {
  test('a project shows its own labels, and labels of other projects do not leak in', async ({ page }) => {
    // "Urgent" (id 2) sits on BOTH projects — that is how grouping works: a shared label. "Frontend"
    // is only on project 1; "Backend" is only on project 2.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign' },
        { id: 2, clientId: 1, name: 'Mobile app' },
      ],
      tags: [
        { id: 1, name: 'Frontend' },
        { id: 2, name: 'Urgent' },
        { id: 3, name: 'Backend' },
      ],
      projectTags: [
        { projectId: 1, tagId: 1 }, // Frontend -> project 1
        { projectId: 1, tagId: 2 }, // Urgent   -> project 1
        { projectId: 2, tagId: 2 }, // Urgent   -> project 2 (shared)
        { projectId: 2, tagId: 3 }, // Backend  -> project 2
      ],
    });

    // Project 1: its two labels show in the tags list; the other project's exclusive label does not.
    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const tags1 = page.getByTestId('project-tags');
    await expect(tags1).toBeVisible();
    await expect(page.getByTestId('project-tags-list')).toBeVisible();

    await expect(page.getByTestId('project-tag-1')).toBeVisible();
    await expect(page.getByTestId('project-tag-1')).toContainText('Frontend');
    await expect(page.getByTestId('project-tag-2')).toBeVisible();
    await expect(page.getByTestId('project-tag-2')).toContainText('Urgent');
    // "Backend" belongs to project 2 only — it is not one of project 1's labels.
    await expect(page.getByTestId('project-tag-3')).toHaveCount(0);

    // Project 2: carries the SHARED "Urgent" label plus its own "Backend"; project 1's "Frontend" is
    // not here. This proves one label groups several projects, each scoped to its own.
    await page.goto('/projects');
    await page.getByTestId('project-open-2').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    await expect(page.getByTestId('project-tag-2')).toBeVisible();
    await expect(page.getByTestId('project-tag-2')).toContainText('Urgent');
    await expect(page.getByTestId('project-tag-3')).toBeVisible();
    await expect(page.getByTestId('project-tag-3')).toContainText('Backend');
    await expect(page.getByTestId('project-tag-1')).toHaveCount(0);
  });

  test('adding a label through the form shows it on the project and keeps a record', async ({ page }) => {
    // No labels yet. RESTART IDENTITY on reset + no seeded tags means the first label created through
    // the UI is tag id 1 (same convention the invoice-lineitems add test relies on).
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      tags: [],
      projectTags: [],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    await expect(page.getByTestId('project-tags')).toBeVisible();
    // Nothing labelled yet: no chip, and the audit is empty after reset.
    await expect(page.getByTestId('project-tag-1')).toHaveCount(0);
    expect(auditLines()).toEqual([]);

    // Put a label on the project.
    await page.getByTestId('project-tag-add').fill('Urgent');
    await page.getByTestId('project-tag-add-submit').click();

    // It appears as a chip in the list, carrying its name.
    const chip = page.getByTestId('project-tag-1');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Urgent');
    await expect(page.getByTestId('project-tags-list')).toContainText('Urgent');

    // Exactly one record was kept for the attach, naming the project and the label — and only that one.
    await expect
      .poll(() =>
        auditLines().filter((l) =>
          /^PROJECT_TAGGED project=(1|Website redesign) tag=(1|Urgent)$/.test(l),
        ),
      )
      .toHaveLength(1);
    expect(auditLines()).toHaveLength(1);
  });

  test('removing a label takes it off this project only, and keeps a record', async ({ page }) => {
    // "Urgent" (id 1) is attached to BOTH projects, so removing it from one must not strip it from the
    // other — the label is shared, not owned by a single project.
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [
        { id: 1, clientId: 1, name: 'Website redesign' },
        { id: 2, clientId: 1, name: 'Mobile app' },
      ],
      tags: [{ id: 1, name: 'Urgent' }],
      projectTags: [
        { projectId: 1, tagId: 1 },
        { projectId: 2, tagId: 1 },
      ],
    });

    await page.goto('/projects');
    await page.getByTestId('project-open-1').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();

    const chip = page.getByTestId('project-tag-1');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Urgent');
    // reset cleared the audit file — nothing has been removed yet.
    expect(auditLines()).toEqual([]);

    // Take the label off project 1.
    await page.getByTestId('project-tag-remove-1').click();
    await expect(page.getByTestId('project-tag-1')).toHaveCount(0);

    // Exactly one record was kept for the detach, naming the project and the label — and only that one.
    await expect
      .poll(() =>
        auditLines().filter((l) =>
          /^PROJECT_UNTAGGED project=(1|Website redesign) tag=(1|Urgent)$/.test(l),
        ),
      )
      .toHaveLength(1);
    expect(auditLines()).toHaveLength(1);

    // The shared label is still on project 2 — removing it from project 1 did not delete it outright.
    await page.goto('/projects');
    await page.getByTestId('project-open-2').click();
    await expect(page.getByTestId('project-detail-page')).toBeVisible();
    await expect(page.getByTestId('project-tag-1')).toBeVisible();
    await expect(page.getByTestId('project-tag-1')).toContainText('Urgent');
  });
});
