// Backup round-trip smoke test (backup-digal-format-spec.md §6.2).
//
// Run: npm run smoke:backup
// (Uses Node's built-in `node:sqlite`; Node >= 23.6 for native .ts stripping.)
//
// Proves the whole `.digal` cycle against the REAL migration files — the same
// single source of truth the Rust app embeds via include_str! and the same ones
// scripts/smoke-sql.mjs drift-checks:
//
//   1. migrate a populated database and hash it,
//   2. export it through src/lib/backup-format.ts (the app's own serializer),
//   3. assert the file is readable JSON with a valid checksum and literal UTF-8,
//   4. assert exporting modified nothing,
//   5. re-validate the file (the importer's gate),
//   6. rebuild: fresh schema → triggers dropped → rows loaded → triggers
//      recreated → id counters fixed → integrity + foreign-key checks,
//   7. row-compare every table against the source,
//   8. negative pass (corrupt / truncated / malformed table / newer version),
//      plus the tolerant-import pass (a backup predating the amenity tables),
//   9. empty-database pass.
//
// This is an independent implementation of the rebuild recipe the Rust
// installer performs, which is exactly what makes it a useful check.
//
// The scenario bodies live in scripts/smoke/backup/: `harness.mjs` (assertions,
// migration drift check), `fixtures.mjs` (populated fixture + snapshots),
// `rebuild.mjs` (the restore recipe), and `scenarios/*.mjs`.

import { loadMigrations, state } from "./smoke/backup/harness.mjs";
import { runExportScenario } from "./smoke/backup/scenarios/export.mjs";
import { runNegativeScenario } from "./smoke/backup/scenarios/negative.mjs";
import { runEmptyScenario } from "./smoke/backup/scenarios/empty.mjs";

console.log("Loading migrations…");
const ctx = { migrationFiles: loadMigrations() };

runExportScenario(ctx);
runNegativeScenario(ctx);
runEmptyScenario(ctx);

if (state.failures > 0) {
  console.error(`\n${state.failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll backup checks passed ✅");
