// An independent implementation of the Rust installer's rebuild recipe
// (schema → triggers dropped → rows loaded → triggers recreated → id counters
// fixed → integrity + foreign-key checks), which is what makes it a useful
// cross-check of src-tauri/src/backup/install.rs.
import { DatabaseSync } from "node:sqlite";
import { REQUIRED_TABLES } from "../../../src/lib/backup/backup-format.ts";
import { AUTOINCREMENT_TABLES, migrate } from "./harness.mjs";

function toSqlValue(value) {
  if (value === null || typeof value === "number" || typeof value === "string") return value;
  return Buffer.from(value.__b64__, "base64");
}

export function rebuildFromBackup(tables, files) {
  const db = new DatabaseSync(":memory:");
  migrate(db, files);

  const triggers = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL")
    .all();
  for (const trigger of triggers) db.exec(`DROP TRIGGER IF EXISTS "${trigger.name}"`);
  db.exec("PRAGMA foreign_keys = OFF");

  // The migration chain seeds rows (settings defaults); the backup is the
  // authority for those tables, so clear them before loading.
  for (const table of [...REQUIRED_TABLES].reverse()) db.exec(`DELETE FROM "${table}"`);

  for (const table of REQUIRED_TABLES) {
    const payload = tables[table];
    if (!payload || payload.rows.length === 0) continue;
    const live = db
      .prepare(`SELECT name FROM pragma_table_info('${table}')`)
      .all()
      .map((r) => r.name);
    // Columns this build no longer has (a pre-075 backup's amenity_type) are
    // dropped, exactly like the Rust installer (spec §13).
    const columns = payload.columns.filter((column) => live.includes(column));
    if (columns.length === 0) continue;
    const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns
      .map(() => "?")
      .join(",")})`;
    const stmt = db.prepare(sql);
    for (const row of payload.rows) stmt.run(...columns.map((c) => toSqlValue(row[c])));
  }

  for (const trigger of triggers) db.exec(trigger.sql);

  for (const table of AUTOINCREMENT_TABLES) {
    const max = db.prepare(`SELECT COALESCE(MAX(id), 0) AS n FROM "${table}"`).get().n;
    db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(table);
    if (max > 0) db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(table, max);
  }

  const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
  if (integrity !== "ok") throw new Error(`integrity_check returned ${integrity}`);
  const fk = db.prepare("PRAGMA foreign_key_check").all();
  if (fk.length > 0) throw new Error(`foreign_key_check found ${fk.length} violation(s)`);
  return db;
}
