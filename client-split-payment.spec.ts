// Acceptance tests for the change request:
//   "Sometimes a client pays one lump sum for several invoices. Let me split that payment across
//    them. Each invoice's balance should come out right."
//
// A client's detail page (client-detail-page, reached by opening the client from the list with
// client-open-<id> — the same per-client drill-in the client specs already use) now carries a
// record-a-payment panel (client-payment) for splitting ONE lump sum across SEVERAL of that
// client's invoices. The panel lists the client's outstanding invoices in an allocations table
// (payment-allocations), one row per invoice (payment-alloc-row-<id>). Each row shows that
// invoice's current balance — what is still due on it, net of any payments already recorded
// (payment-alloc-due) — and offers an input to allocate part of the lump sum to it
// (payment-alloc-<id>). Submitting the split with client-record-payment applies each allocation to
// its own invoice, so every invoice's balance comes out right: it drops by exactly what was
// allocated to it, and an invoice left blank is untouched.
//
// Splitting is recording payments, so it goes through the app's established payment path: each
// allocation becomes a payment against its invoice, and each is audited with the SAME record the
// app already keeps for a recorded payment — PAYMENT_RECORDED id=<invoiceId> amount=<amount> (this
// change introduces no NEW record). The balances are asserted through the feature's own surface
// (payment-alloc-due, re-read from the server after a reload so it reflects stored state, not the
// text just typed) and corroborated through the audit file; the two agree.
//
// Asserts ONLY through the two public channels: the UI (data-testid) and the audit file
// (auditLines()). Data is arranged via resetAndSeed, which honours clients { id, name, email },
// projects { id, clientId, name }, invoices { id, projectId, amount, status } and payments
// { id, invoiceId, amount, date }.
//
// payment-alloc-due is MONEY but a NEW anchor, not one of the three the money-format spec pins
// exactly; so — like the sibling invoice-due-amount / statement-invoice-due anchors — it is matched
// leniently (a leading "$" and a trailing ".00" both optional). The audit amount is matched with an
// optional trailing ".00" the way the payment specs do. Amounts, allocations and the resulting
// remainders are chosen so no value is a substring of another, of a wrong remainder a buggy
// implementation would produce (the full amount, the allocation itself, a sibling's figure, or an
// even split of the lump sum), so each per-invoice assertion pins its own value. This test SHOULD
// FAIL before the change: there is no client-payment panel to split a lump sum across invoices today.
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../support/seed';
import { auditLines } from '../support/audit';

// "$300.00", "300.00" or "300" all pass — the "$" and the ".00" cents are both optional, as the
// other NEW money anchors are asserted; exact presentation is pinned by money-format.spec.
function money(amount: number): RegExp {
  return new RegExp(`^\\$?${amount}(\\.00)?$`);
}

// Count the PAYMENT_RECORDED lines for one invoice + amount (optional ".00" on the amount).
function paymentRecords(invoiceId: number, amount: number): string[] {
  const re = new RegExp(`^PAYMENT_RECORDED id=${invoiceId} amount=${amount}(\\.0+)?$`);
  return auditLines().filter((l) => re.test(l));
}

// Open a client's detail page the way a user does: from the client list.
async function openClient(page: import('@playwright/test').Page, clientId: number) {
  await page.goto('/clients');
  await page.getByTestId(`client-open-${clientId}`).click();
  await expect(page.getByTestId('client-detail-page')).toBeVisible();
}

test.describe('split one lump-sum payment across several of a client\'s invoices', () => {
  test('each invoice\'s balance drops by exactly what was allocated to it; a blank invoice is untouched', async ({ page }) => {
    await resetAndSeed({
      clients: [
        { id: 1, name: 'Acme Corp', email: 'ops@acme.example' },
        // A different client, to prove their invoice never appears in client 1's allocations.
        { id: 2, name: 'Globex', email: 'hello@globex.example' },
      ],
      projects: [
        // Two projects for client 1 — the panel must gather invoices across BOTH, in one place.
        { id: 1, clientId: 1, name: 'Website redesign' },
        { id: 2, clientId: 1, name: 'Mobile app' },
        { id: 3, clientId: 2, name: 'Warehouse automation' },
      ],
      invoices: [
        // Client 1. All SENT with nothing paid yet, so each row's balance starts at its amount.
        { id: 1, projectId: 1, amount: 500, status: 'SENT' }, // allocate 200 -> 300 left
        { id: 2, projectId: 2, amount: 400, status: 'SENT' }, // allocate 150 -> 250 left (other project)
        { id: 3, projectId: 1, amount: 90, status: 'SENT' },  // left blank -> stays 90
        // Client 2's invoice — must NOT appear in client 1's allocation table.
        { id: 4, projectId: 3, amount: 777, status: 'SENT' },
      ],
      payments: [],
    });

    await openClient(page, 1);

    // The client carries a panel to record (split) a payment, with an allocations table.
    const panel = page.getByTestId('client-payment');
    await expect(panel).toBeVisible();
    const allocations = page.getByTestId('payment-allocations');
    await expect(allocations).toBeVisible();

    // One row per outstanding invoice of THIS client — across both projects — and not client 2's.
    const row1 = page.getByTestId('payment-alloc-row-1');
    const row2 = page.getByTestId('payment-alloc-row-2');
    const row3 = page.getByTestId('payment-alloc-row-3');
    await expect(row1).toBeVisible();
    await expect(row2).toBeVisible();
    await expect(row3).toBeVisible();
    await expect(page.getByTestId('payment-alloc-row-4')).toHaveCount(0);
    // Exactly the client's own three invoices are listed (client 2's 777 did not leak in).
    await expect(allocations.getByTestId('payment-alloc-due')).toHaveCount(3);

    // Each row shows that invoice's current balance (nothing paid yet, so it equals the amount).
    await expect(row1.getByTestId('payment-alloc-due')).toHaveText(money(500));
    await expect(row2.getByTestId('payment-alloc-due')).toHaveText(money(400));
    await expect(row3.getByTestId('payment-alloc-due')).toHaveText(money(90));

    // Split one lump sum (200 + 150 = 350) across invoices 1 and 2; leave invoice 3 unpaid.
    await page.getByTestId('payment-alloc-1').fill('200');
    await page.getByTestId('payment-alloc-2').fill('150');
    await page.getByTestId('client-record-payment').click();

    // Each allocation was applied to its OWN invoice, audited as a recorded payment. Invoice 1 got
    // 200 and invoice 2 got 150 — not swapped, not an even 175/175 split of the lump sum.
    await expect.poll(() => paymentRecords(1, 200)).toHaveLength(1);
    await expect.poll(() => paymentRecords(2, 150)).toHaveLength(1);
    // Invoice 3 was left blank: no payment was recorded against it...
    expect(paymentRecords(3, 0)).toHaveLength(0);
    expect(auditLines().filter((l) => /^PAYMENT_RECORDED id=3 /.test(l))).toHaveLength(0);
    // ...and client 2's invoice 4 was never touched either. Exactly the two allocations were kept.
    expect(auditLines().filter((l) => /^PAYMENT_RECORDED id=4 /.test(l))).toHaveLength(0);
    expect(auditLines().filter((l) => /^PAYMENT_RECORDED /.test(l))).toHaveLength(2);

    // Re-read the panel from the server: every balance came out right. 500-200=300, 400-150=250,
    // and the untouched invoice 3 still shows its full 90.
    await openClient(page, 1);
    await expect(page.getByTestId('payment-alloc-row-1').getByTestId('payment-alloc-due')).toHaveText(money(300));
    await expect(page.getByTestId('payment-alloc-row-2').getByTestId('payment-alloc-due')).toHaveText(money(250));
    await expect(page.getByTestId('payment-alloc-row-3').getByTestId('payment-alloc-due')).toHaveText(money(90));
  });

  test('the split builds on payments already recorded — each balance is amount minus ALL its payments', async ({ page }) => {
    await resetAndSeed({
      clients: [{ id: 1, name: 'Acme Corp', email: 'ops@acme.example' }],
      projects: [{ id: 1, clientId: 1, name: 'Website redesign' }],
      invoices: [
        { id: 1, projectId: 1, amount: 500, status: 'SENT' }, // already 100 paid -> 400 due
        { id: 2, projectId: 1, amount: 300, status: 'SENT' }, // already 50 paid  -> 250 due
      ],
      payments: [
        // Prior payments, seeded straight into the data (so they keep NO audit record) — the
        // starting balances are already below the invoice amounts.
        { id: 1, invoiceId: 1, amount: 100, date: '2025-02-01' },
        { id: 2, invoiceId: 2, amount: 50, date: '2025-02-02' },
      ],
    });

    await openClient(page, 1);
    await expect(page.getByTestId('client-payment')).toBeVisible();

    // The balance shown is net of the payments already recorded, not the raw invoice amount.
    const row1 = page.getByTestId('payment-alloc-row-1');
    const row2 = page.getByTestId('payment-alloc-row-2');
    await expect(row1.getByTestId('payment-alloc-due')).toHaveText(money(400)); // not 500
    await expect(row2.getByTestId('payment-alloc-due')).toHaveText(money(250)); // not 300

    // Split a further lump sum (250 + 90 = 340) across the two, on top of what was already paid.
    await page.getByTestId('payment-alloc-1').fill('250');
    await page.getByTestId('payment-alloc-2').fill('90');
    await page.getByTestId('client-record-payment').click();

    // Each allocation recorded against its own invoice.
    await expect.poll(() => paymentRecords(1, 250)).toHaveLength(1);
    await expect.poll(() => paymentRecords(2, 90)).toHaveLength(1);
    expect(auditLines().filter((l) => /^PAYMENT_RECORDED /.test(l))).toHaveLength(2);

    // Balances come out right against ALL the invoice's payments: 500-(100+250)=150, 300-(50+90)=160.
    await openClient(page, 1);
    await expect(page.getByTestId('payment-alloc-row-1').getByTestId('payment-alloc-due')).toHaveText(money(150));
    await expect(page.getByTestId('payment-alloc-row-2').getByTestId('payment-alloc-due')).toHaveText(money(160));
  });
});
