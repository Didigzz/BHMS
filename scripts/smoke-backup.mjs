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

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  REQUIRED_TABLES,
  buildBackupEnvelope,
  canonicalize,
  checksumOf,
  formatBackupFileName,
  parseBackupBytes,
  parseBackupFile,
  sealBackupEnvelope,
  serializeBackup,
  sha256Hex,
  toBackupTable,
  utf8Encode,
} from "../src/lib/backup-format.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS_DIR = join(ROOT, "src-tauri", "migrations");
const MIGRATIONS_RS = join(ROOT, "src-tauri", "src", "migrations.rs");

const AUTOINCREMENT_TABLES = ["rooms", "tenants", "payments", "reservations", "notifications_log"];

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// migrations (drift-checked against migrations.rs, like smoke-sql.mjs)
// ---------------------------------------------------------------------------

function loadMigrations() {
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

function migrate(db, files) {
  for (const file of files) {
    try {
      db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (e) {
      failures++;
      console.error(`  ✗ migration ${file} failed: ${e.message}`);
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

/** Populated fixture: unicode, NULL vs empty string, REAL, unicode ids, holds. */
function seedPopulated(db) {
  const room = db.prepare(
    "INSERT INTO rooms (room_number, capacity, monthly_rate, status, maintenance) VALUES (?,?,?,?,?)"
  );
  room.run("Room A", 2, 2500, "Occupied", 0);
  room.run("Kuwarto ñ—2", 1, 1500.5, "Occupied", 1); // maintenance room WITH a tenant
  room.run("Room C", 2, 1800, "Reserved", 0);

  const tenant = db.prepare(
    `INSERT INTO tenants (name, contact, room_id, move_in_date, due_date, monthly_rate,
                          deposit_amount, deposit_held, advance_held, beds_occupied, backfilled, last_paid_date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  tenant.run("Maria Peña ₱", "", 1, "2026-01-05", "2026-09-14", 2500, null, 0, 0, 1, 0, "2026-08-05");
  tenant.run("🧑‍🌾 Boarder “Anon”", "0917-000-0000", 1, "2026-02-01", "2026-10-01", null, 2500.5, 2500.5, 0, 1, 0, null);
  // Backfilled into the maintenance room: a state the insert trigger only allows
  // for backfilled rows, so a step-by-step restore WOULD be rejected.
  tenant.run("Existing Kuwarto", "0918", 2, "2025-06-01", "2026-09-20", 1500.5, 1000, 1000, 0, 1, 1, null);

  const payment = db.prepare(
    "INSERT INTO payments (tenant_id, amount, paid_date, due_date, covers_month, method, receipt_no) VALUES (?,?,?,?,?,?,?)"
  );
  payment.run(1, 2500, "2026-08-05", "2026-09-05", "2026-08", "GCash", "RCPT-000001");
  payment.run(1, 1250.5, "2026-08-20", "2026-09-05", "2026-09", "cash", "RCPT-000002");

  const reservation = db.prepare(
    `INSERT INTO reservations (room_id, name, contact, reservation_date, target_move_in_date, hold_type, bed_count, status, deposit)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  reservation.run(3, "Walk-in", "0919", "2026-09-01", "2026-09-15", "bed", 1, "active", 500);
  // A cancelled hold carries the same shape a live one does (bed_count NULL for
  // 'whole'). Kept as a 'bed' hold: a whole hold is rejected while a bed is held.
  reservation.run(3, "Cancelled Hold", "0920", "2026-08-01", "2026-08-15", "bed", 1, "cancelled", null);

  db.prepare("INSERT INTO notifications_log (tenant_id, kind, due_date, notified_at) VALUES (?,?,?,?)").run(
    1,
    "reminder",
    "2026-09-14",
    "2026-09-11T08:00:00.000Z"
  );
  db.prepare("UPDATE settings SET value = ? WHERE key = 'house_name'").run("DIGAL Boarding House ñ");
}

// ---------------------------------------------------------------------------
// snapshot / compare
// ---------------------------------------------------------------------------

const ORDER_BY = { settings: "key" };

function snapshot(db) {
  const out = {};
  for (const table of REQUIRED_TABLES) {
    const order = ORDER_BY[table] ?? "id";
    out[table] = db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
  }
  return out;
}

function hashOf(value) {
  return sha256Hex(JSON.stringify(canonicalize(value)));
}

function tablePayloads(db) {
  const tables = {};
  for (const table of REQUIRED_TABLES) {
    const columns = db
      .prepare(`SELECT name FROM pragma_table_info('${table}')`)
      .all()
      .map((r) => r.name);
    const rows = snapshot(db)[table];
    tables[table] = toBackupTable(columns, rows);
  }
  return tables;
}

// ---------------------------------------------------------------------------
// rebuild (independent implementation of the Rust installer recipe)
// ---------------------------------------------------------------------------

function toSqlValue(value) {
  if (value === null || typeof value === "number" || typeof value === "string") return value;
  return Buffer.from(value.__b64__, "base64");
}

function rebuildFromBackup(tables, files) {
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

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

console.log("Loading migrations…");
const migrationFiles = loadMigrations();

section("Export (populated database)");
const source = new DatabaseSync(":memory:");
migrate(source, migrationFiles);
seedPopulated(source);

const beforeHash = hashOf(snapshot(source));
const tables = tablePayloads(source);
const fileName = formatBackupFileName(new Date(2026, 8, 14, 12), "backup");
const text = serializeBackup(
  sealBackupEnvelope(buildBackupEnvelope(tables, { houseName: "DIGAL Boarding House ñ" }))
);

assert(fileName === "BHMS-Backup-2026-09-14.digal", `file name is ${fileName}`);
assert(JSON.parse(text).checksum.value === checksumOf(tables), "checksum matches the payload");
assert(text.includes("Maria Peña ₱") && text.includes("🧑‍🌾"), "non-ASCII text is stored literally");
assert(!text.includes("\\u"), "no \\u escapes in the file");
assert(text.includes('"deposit_amount": null'), "NULL is written as null");
assert(text.includes('"contact": ""'), "empty string is distinct from null");
assert(text.includes("1500.5"), "REAL precision is preserved");
assert(hashOf(snapshot(source)) === beforeHash, "export modified nothing in the source database");

section("Validation");
const parsed = parseBackupFile(text, fileName);
assert(parsed.ok, "the exported file validates");
if (parsed.ok) {
  assert(parsed.snapshot.summary.isEmpty === false, "summary reports a populated backup");
  assert(parsed.snapshot.summary.counts.every((c) => typeof c.count === "number"), "row counts reported per table");
  // 3 rooms + 3 tenants + 2 payments + 2 reservations + 1 notification + 5 seeded settings.
  assert(parsed.snapshot.summary.totalRows === 16, `total rows = ${parsed.snapshot.summary.totalRows} (expected 16)`);
}

section("Rebuild + row compare");
const restored = rebuildFromBackup(tables, migrationFiles);
const sourceSnapshot = snapshot(source);
const restoredSnapshot = snapshot(restored);
for (const table of REQUIRED_TABLES) {
  const same =
    JSON.stringify(canonicalize(sourceSnapshot[table])) ===
    JSON.stringify(canonicalize(restoredSnapshot[table]));
  assert(same, `${table}: ${sourceSnapshot[table].length} row(s) match after restore`);
}
assert(
  JSON.stringify(canonicalize(sourceSnapshot.tenants[0])) ===
    JSON.stringify(canonicalize(restoredSnapshot.tenants[0])),
  "ids, unicode names, NULL/empty-string and REAL values survive exactly"
);

section("Guards + id counters after restore");
const guardDb = restored;
let blocked = false;
try {
  // The capacity trigger must be back: a third tenant into the 2-bed Room A.
  guardDb
    .prepare(
      "INSERT INTO tenants (name, contact, room_id, move_in_date, due_date, beds_occupied, backfilled) VALUES (?,?,?,?,?,?,?)"
    )
    .run("Too Many", "09", 1, "2026-09-14", "2026-10-01", 1, 0);
} catch (e) {
  blocked = String(e.message).includes("full capacity");
}
assert(blocked, "the room-capacity trigger works after restore");
guardDb.prepare("DELETE FROM tenants WHERE name = 'Too Many'").run();

const newRoomId = guardDb
  .prepare("INSERT INTO rooms (room_number, capacity, monthly_rate, status, maintenance) VALUES (?,?,?,?,?)")
  .run("Room D", 1, 900, "Vacant", 0).lastInsertRowid;
guardDb
  .prepare(
    "INSERT INTO tenants (name, contact, room_id, move_in_date, due_date, beds_occupied, backfilled) VALUES (?,?,?,?,?,?,?)"
  )
  .run("New Boarder", "0921", Number(newRoomId), "2026-09-14", "2026-10-14", 1, 0);
const newTenantId = guardDb.prepare("SELECT MAX(id) AS id FROM tenants").get().id;
assert(Number(newRoomId) === 4, `ids continue after restore (new room id = ${newRoomId})`);
assert(Number(newTenantId) === 4, `new tenant id continues past the restored max (= ${newTenantId})`);

section("Negative pass");
const truncated = text.slice(0, Math.floor(text.length / 2));
const truncatedResult = parseBackupFile(truncated);
assert(!truncatedResult.ok && truncatedResult.reason === "not-json", "truncated file is rejected (not JSON)");

const altered = JSON.parse(text);
altered.tables.tenants.rows[0].name = "Someone Else";
const alteredResult = parseBackupFile(JSON.stringify(altered));
assert(
  !alteredResult.ok && alteredResult.reason === "checksum-mismatch",
  "a modified payload fails the checksum"
);

// A backup written before the amenity tables existed carries no payload for
// them: it must still restore, with those tables empty
// (amenity-billing-spec.md §13, decision #30). The file is re-sealed first so
// the checksum stays valid and only the absent payload is under test.
const older = JSON.parse(text);
delete older.tables.amenity_bills;
delete older.tables.amenity_bill_tenants;
delete older.tables.amenity_bill_rooms;
const olderResult = parseBackupFile(serializeBackup(sealBackupEnvelope(older)));
assert(olderResult.ok, "a backup without the amenity tables is accepted (tolerant import)");
if (olderResult.ok) {
  const amenityCounts = olderResult.snapshot.summary.counts.filter((c) =>
    c.table.startsWith("amenity_bill")
  );
  assert(
    amenityCounts.length === 3 && amenityCounts.every((c) => c.count === 0),
    "the absent tables are reported as empty"
  );
  const olderRestored = rebuildFromBackup(olderResult.snapshot.envelope.tables, migrationFiles);
  assert(
    olderRestored.prepare("SELECT COUNT(*) AS n FROM amenity_bills").get().n === 0,
    "an absent amenity table restores as empty"
  );
  assert(
    olderRestored.prepare("SELECT COUNT(*) AS n FROM tenants").get().n ===
      older.tables.tenants.rows.length,
    "the tables the backup does carry still restore"
  );
}

// Present but malformed is still a hard failure.
const malformed = JSON.parse(text);
malformed.tables.payments = "not a table payload";
const malformedResult = parseBackupFile(serializeBackup(sealBackupEnvelope(malformed)));
assert(
  !malformedResult.ok && malformedResult.reason === "missing-table",
  "a malformed table payload is still rejected"
);

const newer = JSON.parse(text);
newer.format_version = 2;
const newerResult = parseBackupFile(JSON.stringify(newer));
assert(!newerResult.ok && newerResult.reason === "newer-format", "a newer format version is rejected");

const legacyBytes = utf8Encode("SQLite format 3\u0000legacy database bytes");
const legacyResult = parseBackupBytes(legacyBytes, "rentease-backup-2026-08-06.db");
assert(
  !legacyResult.ok && legacyResult.reason === "old-format",
  "an old .db backup is rejected with the old-format message"
);

// The name gate: only a lowercase .digal name is read, whatever it contains.
const textBytes = utf8Encode(text);
assert(
  parseBackupBytes(textBytes, fileName).ok,
  "a valid backup under its .digal name is admitted"
);
const renamedJson = parseBackupBytes(textBytes, "BHMS-Backup-2026-09-14.digal.json");
assert(
  !renamedJson.ok && renamedJson.reason === "wrong-extension",
  "the same valid bytes behind a .json name are refused by the name gate"
);
const renamedTxt = parseBackupBytes(textBytes, "backup.txt");
assert(
  !renamedTxt.ok && renamedTxt.reason === "wrong-extension",
  "a .txt file is refused by the name gate"
);
const uppercase = parseBackupBytes(textBytes, "BHMS-Backup-2026-09-14.DIGAL");
assert(
  !uppercase.ok && uppercase.reason === "wrong-extension",
  "an uppercase .DIGAL extension is refused"
);

section("Empty database pass");
const empty = new DatabaseSync(":memory:");
migrate(empty, migrationFiles);
const emptyTables = tablePayloads(empty);
const emptyText = serializeBackup(
  sealBackupEnvelope(buildBackupEnvelope(emptyTables, { houseName: "RentEase" }))
);
const emptyParsed = parseBackupFile(emptyText);
assert(emptyParsed.ok, "an empty database still exports a valid backup");
if (emptyParsed.ok) {
  assert(emptyParsed.snapshot.summary.isEmpty === true, "the empty backup is flagged for the second confirmation");
  const emptyRestored = rebuildFromBackup(emptyTables, migrationFiles);
  const settingsRows = snapshot(emptyRestored).settings.length;
  assert(
    settingsRows === emptyTables.settings.row_count,
    `empty restore keeps the ${settingsRows} seeded setting(s) and nothing else`
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll backup checks passed ✅");
