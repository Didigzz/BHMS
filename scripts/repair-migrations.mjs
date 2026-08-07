// Migration-checksum repair for live app databases.
//
// tauri-plugin-sql (sqlx) records a SHA-384 checksum of every migration's SQL
// in the `_sqlx_migrations` table. On startup the app refuses to open the
// database if an already-applied migration no longer matches the SQL embedded
// in the binary:
//
//     migration 1 was previously applied but has been modified
//
// That happens when a migration file is edited after it was applied — every
// page then fails because the DB connection can't be established. This script
// rewrites the recorded checksums to match the CURRENT migration files (the
// single source of truth, same bytes the app embeds via include_str!), so the
// app starts again. It is safe to re-run: matching checksums are left alone.
//
// Usage:
//   node scripts/repair-migrations.mjs [path-to-db]
//
// Defaults to the live installed app database at
// %APPDATA%\com.digal.boardinghouse\boarding-house.db

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS_DIR = join(ROOT, "src-tauri", "migrations");

const dbPath =
  process.argv[2] ??
  join(homedir(), "AppData", "Roaming", "com.digal.boardinghouse", "boarding-house.db");

if (!existsSync(dbPath)) {
  console.log(`No database at ${dbPath} — nothing to repair.`);
  process.exit(0);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const db = new DatabaseSync(dbPath);

const hasTable = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'")
  .get();
if (!hasTable) {
  console.log(`No _sqlx_migrations table in ${dbPath} — nothing to repair.`);
  db.close();
  process.exit(0);
}

const applied = db.prepare("SELECT version, checksum FROM _sqlx_migrations WHERE success = 1").all();

let matched = 0;
let repaired = 0;
for (const file of files) {
  const version = Number(file.split("-")[0]);
  if (!Number.isInteger(version)) continue;

  const sql = readFileSync(join(MIGRATIONS_DIR, file));
  const digest = createHash("sha384").update(sql).digest();

  const row = applied.find((r) => r.version === version);
  if (!row) {
    // Not applied yet — the app will apply it on next start. Nothing to do.
    continue;
  }

  const stored = Buffer.from(row.checksum);
  if (stored.equals(digest)) {
    matched++;
  } else {
    db.prepare("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?").run(digest, version);
    repaired++;
    console.log(`  ~ version ${version} (${file}): checksum updated to match current SQL`);
  }
}

db.close();
console.log(`\n${dbPath}`);
console.log(`${matched} applied migration(s) already in sync, ${repaired} repaired.`);
if (repaired > 0) {
  console.log("Re-run the app — the database will open and migrations continue normally.");
}
