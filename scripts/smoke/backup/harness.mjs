// Shared harness for the backup smoke scenarios: assertion counter, section
// headers, and migration loading (drift-checked against migrations.rs, exactly
// like scripts/smoke-sql.mjs).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(dirname(dirname(HERE)));
export const MIGRATIONS_DIR = join(ROOT, "src-tauri", "migrations");
const MIGRATIONS_RS = join(ROOT, "src-tauri", "src", "migrations.rs");

export const AUTOINCREMENT_TABLES = ["rooms", "tenants", "payments", "reservations", "notifications_log"];

/** Shared failure counter — the entry script exits non-zero when it is non-zero. */
export const state = { failures: 0 };

export function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    state.failures++;
    console.error(`  ✗ ${label}`);
  }
}

export function section(title) {
  console.log(`\n${title}`);
}

export function loadMigrations() {
  const onDisk = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const ledgerRs = readFileSync(MIGRATIONS_RS, "utf8");
  const referenced = [...ledgerRs.matchAll(/include_str!\("\.\.\/migrations\/([^"]+\.sql)"\)/g)]
    .map((m) => m[1])
    .sort();
  assert(
    onDisk.every((f) => referenced.includes(f)) && referenced.every((f) => onDisk.includes(f)),
    `drift check: ${onDisk.length} migration files match migrations.rs include_str! references`
  );
  return onDisk;
}

export function migrate(db, files) {
  for (const file of files) {
    try {
      db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (e) {
      state.failures++;
      console.error(`  ✗ migration ${file} failed: ${e.message}`);
      throw e;
    }
  }
}
