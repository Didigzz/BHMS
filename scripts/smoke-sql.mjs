// SQL smoke test: applies every migration to an in-memory SQLite database and
// asserts the business rules hold.
//
// Run: node scripts/smoke-sql.mjs
// (Uses Node's built-in `node:sqlite`; Node >= 23.4 / 24.)
//
// The migration SQL lives in src-tauri/migrations/*.sql — the single source of
// truth, embedded into the Rust app via include_str! in
// src-tauri/src/migrations.rs.
// This script reads the same directory (no hand-duplicated SQL strings) and
// DRIFT-CHECKS it against that ledger: every file on disk must be referenced by
// an include_str!, and every include_str! must point at a real file. Adding
// migration 28 means creating one .sql file and one include_str! line — the
// smoke test then picks both up automatically.
//
// The derived room-status SQL is likewise not duplicated: it is imported from
// src/lib/rooms/room-status.ts — the single source of truth shared with the frontend
// (requires Node >= 23.6 for native .ts type stripping) — and a drift check
// fails if a second hand-rolled definition appears anywhere.
//
// Each migration must contain exactly ONE statement (tauri-plugin-sql runs
// migrations through sqlx as single prepared statements).
//
// Scenario bodies live in scripts/smoke/sql/scenarios/ and all run against the
// ONE database built here, in order — later scenarios assert on fixtures the
// earlier ones created (e.g. the money pass reads tenant T1, the capacity pass
// relies on rooms 4-7 existing). Keep that order when adding a scenario.

import { DatabaseSync } from "node:sqlite";

import { applyMigrations, checkRoomStatusDrift, loadMigrations, state } from "./smoke/sql/harness.mjs";
import { runSchemaGuardScenarios } from "./smoke/sql/scenarios/schema-guards.mjs";
import { runMoneyScenarios } from "./smoke/sql/scenarios/money.mjs";
import { runCapacityScenarios } from "./smoke/sql/scenarios/capacity.mjs";
import { runLegacyColumnScenarios } from "./smoke/sql/scenarios/legacy-columns.mjs";
import { runAmenityLedgerScenarios } from "./smoke/sql/scenarios/amenity-ledger.mjs";
import { runAppQueryScenarios } from "./smoke/sql/scenarios/app-queries.mjs";
import { runLegacyHoldScenarios } from "./smoke/sql/scenarios/legacy-holds.mjs";

checkRoomStatusDrift();

console.log("Applying migrations…");
const db = new DatabaseSync(":memory:");
const migrationFiles = loadMigrations();
try {
  applyMigrations(db, migrationFiles);
} catch {
  process.exit(1);
}
if (state.failures > 0) process.exit(1);

runSchemaGuardScenarios(db);
runMoneyScenarios(db);
runCapacityScenarios(db);
runLegacyColumnScenarios(db);
runAmenityLedgerScenarios(db);
runAppQueryScenarios(db);
runLegacyHoldScenarios();

if (state.failures > 0) {
  console.error(`\n${state.failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll smoke checks passed ✅");
