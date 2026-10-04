import { existsSync, readFileSync } from 'node:fs';

// Read the known audit file — the second test-assertion channel alongside the UI (DESIGN.md §3,
// docs/SUT_CONTRACT.md §4). The app appends one record per line; /__test__/reset clears it per
// spec. Path comes from AUDIT_FILE (set by bin/start / bin/e2e); falls back to the app's default.
const AUDIT_FILE = process.env.AUDIT_FILE ?? '../.run/audit.log';

/** All audit records currently in the file, one per element (empty if none). */
export function auditLines(): string[] {
  return existsSync(AUDIT_FILE)
    ? readFileSync(AUDIT_FILE, 'utf8').split('\n').filter((l) => l.length > 0)
    : [];
}

// Usage in a spec (audit-category test):
//   expect(auditLines()).toContain('OWNER_CREATED id=1 name=Acme');
