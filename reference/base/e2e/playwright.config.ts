// Playwright config (BASE_CHECKLIST.md §D). Tests bind to data-testid only and assert through the
// UI only. The app is already running (bin/e2e / the harness start it), so no webServer here.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs', // the harness copies cpNN specs here (dest_subpath: e2e/specs)
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
    // Contract attribute is data-testid — Playwright's default, so no testIdAttribute override
    // needed (DESIGN.md §3). Strict awaiting on data-testid presence is the flake guard (§9).
  },
  // Serial + fresh reset+seed per spec (see support/seed.ts) keeps specs isolated. workers:1 is
  // REQUIRED: every spec drives ONE shared app + in-memory H2 through /__test__/reset+seed, so the
  // whole suite must run serially. `fullyParallel:false` alone only serialises tests WITHIN a file
  // — Playwright still runs different spec FILES on parallel workers by default, and those would
  // stomp on each other's seed data (false cross-file failures). One worker = fully serial.
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Headless Chromium in a restricted/confined environment (e.g. the harness's
        // Landlock-confined agent turn) needs its own sandbox off and shared memory in /tmp,
        // or renderer/GPU child processes crash. Harmless for the unconfined gate run too.
        launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] },
      },
    },
  ],
});
