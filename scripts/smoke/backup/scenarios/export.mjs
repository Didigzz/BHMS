// Export → validate → restore → row-compare, plus the post-restore guards and
// id counters. Leaves the exported file on `ctx` for the negative scenario.
import { DatabaseSync } from "node:sqlite";
import {
  REQUIRED_TABLES,
  buildBackupEnvelope,
  canonicalize,
  checksumOf,
  formatBackupFileName,
  parseBackupFile,
  sealBackupEnvelope,
  serializeBackup,
} from "../../../../src/lib/backup/backup-format.ts";
import { assert, migrate, section } from "../harness.mjs";
import { hashOf, seedPopulated, snapshot, tablePayloads } from "../fixtures.mjs";
import { rebuildFromBackup } from "../rebuild.mjs";

export function runExportScenario(ctx) {
  const migrationFiles = ctx.migrationFiles;

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
    // 3 rooms + 3 tenants + 2 payments + 2 reservations + 1 notification + 5 seeded settings
    // + 1 amenity bill + 2 shares + 2 amenity payments.
    assert(parsed.snapshot.summary.totalRows === 21, `total rows = ${parsed.snapshot.summary.totalRows} (expected 21)`);
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

  ctx.text = text;
  ctx.tables = tables;
  ctx.source = source;
  ctx.fileName = fileName;
}
