// Shared per-spec data setup (DESIGN.md §9, BASE_CHECKLIST.md §D). Each spec's beforeEach RESETS
// then SEEDS via the app's /__test__ endpoint — this is Arrange, not Assert. Specs still ASSERT
// only through the UI (data-testid).
//
// FAIL LOUD: /__test__/reset and /__test__/seed are the Arrange for EVERY spec, so they are a hard
// precondition — if either does not return 2xx the data is not in the state the test assumes, and a
// silent failure would surface later as confusing, misattributed assertion failures on unrelated
// specs (e.g. leftover rows because reset could not clear an FK-referenced table). We throw here so
// the break is attributed to the seed contract, and so an implementer running its own spec sees the
// broken endpoint immediately instead of shipping it. This helper is fixed test infrastructure — the
// evolving surface is the server-side /__test__ endpoint, not this client.
import { request, type APIResponse } from '@playwright/test';

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

async function must(res: Promise<APIResponse>, what: string): Promise<void> {
  const r = await res;
  if (!r.ok()) {
    const body = (await r.text().catch(() => '')).slice(0, 500);
    throw new Error(`seed contract broken: ${what} returned HTTP ${r.status()} — ${body}`);
  }
}

export async function resetAndSeed(fixture: unknown): Promise<void> {
  const api = await request.newContext({ baseURL: BASE });
  try {
    await must(api.post('/__test__/reset'), 'POST /__test__/reset');
    await must(api.post('/__test__/seed', { data: fixture }), 'POST /__test__/seed');
  } finally {
    await api.dispose();
  }
}

// Usage in a spec:
//   test.beforeEach(async () => { await resetAndSeed({ /* rows this spec needs */ }); });
