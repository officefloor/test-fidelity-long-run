// Acceptance test for the change request:
//   "Contacts need a good email too. Do not let me save one with a bad email."
//
// Adding a contact is only allowed when a PROPER email address is supplied. A malformed address
// must be rejected: the contact form surfaces `contact-form-email-error` and no contact is created.
// A valid email still saves (covered by client-contacts.spec.ts and reconfirmed here once a rejected
// attempt is corrected).
//
// Contacts are added from a client's detail page (/clients/<id>). Asserts ONLY through the UI
// (data-testid). Data is arranged via resetAndSeed: `clients` honours { id, name, email } and
// `contacts` honours { id, name, email, role, clientId }.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

const contactRows = (page: Page) => page.locator('[data-testid^="contact-row-"]');

// Locate the one contact row carrying the given name, regardless of its server-assigned id.
const contactRowNamed = (page: Page, name: string): Locator =>
  contactRows(page).filter({
    has: page.getByTestId('contact-name').getByText(name, { exact: true }),
  });

test.describe('A contact cannot be saved with a bad email', () => {
  test('submitting with a malformed email is rejected and saves nothing', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      contacts: [],
    });

    await page.goto('/clients/1');
    await expect(page.getByTestId('client-contacts')).toBeVisible();
    await expect(contactRows(page)).toHaveCount(0);

    // A name and role are given, but the email is plainly invalid (no domain, no @).
    await page.getByTestId('contact-form-name').fill('Dana Fox');
    await page.getByTestId('contact-form-email').fill('not-an-email');
    await page.getByTestId('contact-form-role').fill('Procurement');
    await page.getByTestId('contact-form-submit').click();

    // The email error is surfaced...
    await expect(page.getByTestId('contact-form-email-error')).toBeVisible();

    // ...and nothing was saved: the list stays empty, even after a fresh load from the server.
    await expect(contactRows(page)).toHaveCount(0);
    await expect(page.getByTestId('client-contacts')).not.toContainText('Dana Fox');

    await page.reload();
    await expect(page.getByTestId('client-contacts')).toBeVisible();
    await expect(contactRows(page)).toHaveCount(0);
    await expect(page.getByTestId('client-contacts')).not.toContainText('Dana Fox');
  });

  test('an address with no domain after the @ is rejected and saves nothing', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      contacts: [],
    });

    await page.goto('/clients/1');
    await expect(page.getByTestId('client-contacts')).toBeVisible();

    await page.getByTestId('contact-form-name').fill('Evan Hill');
    await page.getByTestId('contact-form-email').fill('evan@');
    await page.getByTestId('contact-form-role').fill('Support');
    await page.getByTestId('contact-form-submit').click();

    await expect(page.getByTestId('contact-form-email-error')).toBeVisible();
    await expect(contactRows(page)).toHaveCount(0);

    await page.reload();
    await expect(contactRows(page)).toHaveCount(0);
    await expect(page.getByTestId('client-contacts')).not.toContainText('Evan Hill');
  });

  test('a rejected submit does not disturb the contacts already listed', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      contacts: [
        { id: 1, name: 'Alice Stone', email: 'alice@acme.test', role: 'Owner', clientId: 1 },
      ],
    });

    await page.goto('/clients/1');
    await expect(contactRows(page)).toHaveCount(1);

    // Attempt to add a contact with a bad email.
    await page.getByTestId('contact-form-name').fill('Bob Reed');
    await page.getByTestId('contact-form-email').fill('bob-at-acme');
    await page.getByTestId('contact-form-role').fill('Billing');
    await page.getByTestId('contact-form-submit').click();

    await expect(page.getByTestId('contact-form-email-error')).toBeVisible();

    // The existing contact is untouched and no new row appeared.
    await expect(contactRows(page)).toHaveCount(1);
    await expect(page.getByTestId('contact-row-1').getByTestId('contact-name')).toHaveText(
      'Alice Stone',
    );
    await expect(page.getByTestId('client-contacts')).not.toContainText('Bob Reed');

    await page.reload();
    await expect(contactRows(page)).toHaveCount(1);
    await expect(page.getByTestId('contact-row-1').getByTestId('contact-email')).toHaveText(
      'alice@acme.test',
    );
    await expect(page.getByTestId('client-contacts')).not.toContainText('Bob Reed');
  });

  test('correcting the email to a proper address then saves the contact', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'hello@acme.test' }],
      contacts: [],
    });

    await page.goto('/clients/1');
    await expect(page.getByTestId('client-contacts')).toBeVisible();

    // First a rejected attempt with a bad email.
    await page.getByTestId('contact-form-name').fill('Dana Fox');
    await page.getByTestId('contact-form-email').fill('dana');
    await page.getByTestId('contact-form-role').fill('Procurement');
    await page.getByTestId('contact-form-submit').click();
    await expect(page.getByTestId('contact-form-email-error')).toBeVisible();
    await expect(contactRows(page)).toHaveCount(0);

    // Correct the email to a proper address and submit again.
    await page.getByTestId('contact-form-email').fill('dana@acme.test');
    await page.getByTestId('contact-form-submit').click();

    // Now it saves: the contact appears carrying its details, and the email error is gone.
    const newRow = contactRowNamed(page, 'Dana Fox');
    await expect(newRow).toHaveCount(1);
    await expect(newRow.getByTestId('contact-email')).toHaveText('dana@acme.test');
    await expect(newRow.getByTestId('contact-role')).toHaveText('Procurement');
    await expect(page.getByTestId('contact-form-email-error')).toHaveCount(0);

    // And it survives a fresh load from the server.
    await page.reload();
    const reloaded = contactRowNamed(page, 'Dana Fox');
    await expect(reloaded).toHaveCount(1);
    await expect(reloaded.getByTestId('contact-email')).toHaveText('dana@acme.test');
  });
});
