import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';

// The home screen shows the top FIVE clients ranked by how much they owe. Six clients owe
// something, so the cap is load-bearing: a panel that listed them all would be indistinguishable
// on a fixture with three.
test.describe('dashboard top clients', () => {
  test('ranks clients by outstanding and caps the list at five', { tag: '@functionality' }, async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Smallest Co', email: 'a@ex.example' },
        { id: 2, name: 'Globex', email: 'b@ex.example' },
        { id: 3, name: 'Initech', email: 'c@ex.example' },
        { id: 4, name: 'Biggest Co', email: 'd@ex.example' },
        { id: 5, name: 'Second Co', email: 'e@ex.example' },
        { id: 6, name: 'Third Co', email: 'f@ex.example' },
      ],
      projects: [
        { id: 1, name: 'A', clientId: 1 },
        { id: 2, name: 'B', clientId: 2 },
        { id: 3, name: 'C', clientId: 3 },
        { id: 4, name: 'D', clientId: 4 },
        { id: 5, name: 'E', clientId: 5 },
        { id: 6, name: 'F', clientId: 6 },
      ],
      invoices: [
        { id: 1, projectId: 1, status: 'SENT', lineItems: [{ id: 1, description: 'x', qty: 1, unitPrice: 100 }] },
        { id: 2, projectId: 2, status: 'SENT', lineItems: [{ id: 2, description: 'y', qty: 1, unitPrice: 300 }] },
        { id: 3, projectId: 3, status: 'SENT', lineItems: [{ id: 3, description: 'z', qty: 1, unitPrice: 200 }] },
        { id: 4, projectId: 4, status: 'SENT', lineItems: [{ id: 4, description: 'p', qty: 1, unitPrice: 600 }] },
        { id: 5, projectId: 5, status: 'SENT', lineItems: [{ id: 5, description: 'q', qty: 1, unitPrice: 500 }] },
        { id: 6, projectId: 6, status: 'SENT', lineItems: [{ id: 6, description: 'r', qty: 1, unitPrice: 400 }] },
      ],
    });
    await page.goto('/');
    await page.getByTestId('nav-dashboard').click();

    const rows = page.getByTestId('dashboard-top-clients').getByTestId(/^top-client-row-/);
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0).getByTestId('top-client-name')).toHaveText('Biggest Co');
    await expect(rows.nth(0).getByTestId('top-client-amount')).toHaveText('$600.00');
    await expect(rows.nth(1).getByTestId('top-client-name')).toHaveText('Second Co');
    await expect(rows.nth(4).getByTestId('top-client-name')).toHaveText('Initech');
    // the smallest debtor falls outside the top five
    await expect(page.getByTestId('top-client-row-1')).toHaveCount(0);
  });
});
