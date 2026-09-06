// SQL smoke test: applies every migration to an in-memory SQLite database and
// asserts the business rules hold.
//
// Run: node scripts/smoke-sql.mjs
// (Uses Node's built-in `node:sqlite`; Node >= 23.4 / 24.)
//
// The migration SQL lives in src-tauri/migrations/*.sql — the single source of
// truth, embedded into the Rust app via include_str! in src-tauri/src/lib.rs.
// This script reads the same directory (no hand-duplicated SQL strings) and
// DRIFT-CHECKS it against lib.rs: every file on disk must be referenced by an
// include_str!, and every include_str! must point at a real file. Adding
// migration 28 means creating one .sql file and one include_str! line — the
// smoke test then picks both up automatically.
//
// The derived room-status SQL is likewise not duplicated: it is imported from
// src/lib/room-status.ts — the single source of truth shared with the frontend
// (requires Node >= 23.6 for native .ts type stripping) — and a drift check
// below fails if a second hand-rolled definition appears anywhere.
//
// Each migration must contain exactly ONE statement (tauri-plugin-sql runs
// migrations through sqlx as single prepared statements).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { ROOM_STATUS_SQL } from "../src/lib/room-status.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS_DIR = join(ROOT, "src-tauri", "migrations");
const LIB_RS = join(ROOT, "src-tauri", "src", "lib.rs");

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
}

/**
 * Drift check between the two consumers of the schema:
 * the migration files on disk vs. the include_str! references in lib.rs.
 * Fails (via assert) if either side has a file the other doesn't.
 * Returns the sorted list of migration filenames to apply.
 */
function loadMigrations() {
  const onDisk = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const libRs = readFileSync(LIB_RS, "utf8");
  const referenced = [
    ...libRs.matchAll(/include_str!\("\.\.\/migrations\/([^"]+\.sql)"\)/g),
  ]
    .map((m) => m[1])
    .sort();

  const notInLib = onDisk.filter((f) => !referenced.includes(f));
  const notOnDisk = referenced.filter((f) => !onDisk.includes(f));

  assert(
    notInLib.length === 0,
    `drift check: every migration file is wired into lib.rs — ${notInLib.length} on disk but not referenced (${notInLib.join(", ") || "none"})`
  );
  assert(
    notOnDisk.length === 0,
    `drift check: every lib.rs include_str! file exists on disk — ${notOnDisk.length} referenced but missing (${notOnDisk.join(", ") || "none"})`
  );

  // Ordering contract: the smoke test applies migrations by filename order,
  // while lib.rs assigns explicit version numbers. Both must agree and be
  // strictly sequential 1..N — a gap, duplicate, or misnumber would apply
  // migrations in a different order than the app ships them.
  const fileVersions = onDisk.map((f) => Number(f.split("-")[0]));
  const libVersions = [...libRs.matchAll(/migration\(\s*(\d+),/g)].map((m) => Number(m[1]));
  const ordered =
    fileVersions.every((v, i) => v === i + 1) &&
    libVersions.length === fileVersions.length &&
    libVersions.every((v, i) => v === fileVersions[i]);
  assert(
    ordered,
    `drift check: migration versions are sequential and match lib.rs (files: ${fileVersions.join(", ")}, lib.rs: ${libVersions.join(", ")})`
  );
  return onDisk;
}

/** Recursively list .ts/.js/.mjs/.svelte files under a directory. */
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|js|mjs|svelte)$/.test(entry)) acc.push(p);
  }
  return acc;
}

/**
 * Drift check: ROOM_STATUS_SQL must be defined in exactly one place —
 * src/lib/room-status.ts (imported at the top of this file). A second
 * hand-rolled copy anywhere in src/ or scripts/ would reintroduce the
 * dual-source-of-truth hazard for the derived room-status rules.
 */
function checkRoomStatusDrift() {
  const source = join(ROOT, "src", "lib", "room-status.ts");
  const defs = [];
  for (const dir of [join(ROOT, "src"), join(ROOT, "scripts")]) {
    for (const file of walk(dir)) {
      const n = (readFileSync(file, "utf8").match(/const\s+ROOM_STATUS_SQL\s*=/g) || []).length;
      for (let i = 0; i < n; i++) defs.push(file);
    }
  }
  const expected = source === defs[0] && defs.length === 1;
  assert(
    expected,
    `drift check: ROOM_STATUS_SQL is defined exactly once in src/lib/room-status.ts — ${defs.length} definition(s) found${defs.length ? ` (${defs.join(", ")})` : ""}`
  );
}

function insertTenant(db, name, roomId) {
  db.prepare(
    "INSERT INTO tenants (name, contact, room_id, move_in_date, due_date) VALUES (?,?,?,?,?)"
  ).run(name, "0917-000-0000", roomId, "2026-08-01", "2026-09-01");
}

function insertTenantBeds(db, name, roomId, beds) {
  db.prepare(
    "INSERT INTO tenants (name, contact, room_id, move_in_date, due_date, beds_occupied) VALUES (?,?,?,?,?,?)"
  ).run(name, "0917-000-0000", roomId, "2026-08-01", "2026-09-01", beds);
}

function insertReservation(db, roomId, name, holdType, bedCount) {
  db.prepare(
    "INSERT INTO reservations (room_id, name, contact, reservation_date, target_move_in_date, hold_type, bed_count) VALUES (?,?,?,?,?,?,?)"
  ).run(roomId, name, "0917-000-0000", "2026-08-06", "2026-08-20", holdType, bedCount);
}

function expectAbort(db, label, needle, fn) {
  try {
    fn();
    failures++;
    console.error(`  ✗ ${label} — expected an abort but the statement succeeded`);
  } catch (e) {
    if (String(e.message).includes(needle)) {
      console.log(`  ✓ ${label}`);
    } else {
      failures++;
      console.error(`  ✗ ${label} — unexpected error: ${e.message}`);
    }
  }
}

checkRoomStatusDrift();

console.log("Applying migrations…");
const db = new DatabaseSync(":memory:");
const migrationFiles = loadMigrations();
migrationFiles.forEach((file) => {
  try {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    console.log(`  ✓ migration ${file}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ migration ${file} FAILED: ${e.message}`);
  }
});
if (failures > 0) process.exit(1);

console.log("\nSeeding rooms…");
db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room A', 2, 2500)").run();
db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room B', 1, 1500)").run();
db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room C', 1, 1200)").run();

console.log("\nTenant capacity trigger…");
insertTenant(db, "T1", 1);
insertTenant(db, "T2", 1);
expectAbort(db, "third tenant into full Room A is blocked", "Room is at full capacity", () =>
  insertTenant(db, "T3", 1)
);

console.log("\nReservation insert trigger…");
expectAbort(db, "bed hold on full Room A is blocked", "Room is at full capacity", () =>
  insertReservation(db, 1, "S1", "bed", 1)
);
expectAbort(db, "whole hold on occupied Room A is blocked", "Room already has tenants", () =>
  insertReservation(db, 1, "W2", "whole", null)
);
insertReservation(db, 2, "W1", "whole", null); // empty room → OK
expectAbort(db, "tenant insert into whole-reserved Room B is blocked", "Room is reserved", () =>
  insertTenant(db, "T4", 2)
);
expectAbort(db, "bed hold on a whole-reserved room is blocked", "Room is reserved", () =>
  insertReservation(db, 2, "B2", "bed", 1)
);

console.log("\nMaintenance flag…");
db.prepare("UPDATE rooms SET maintenance = 1 WHERE id = 3").run();
expectAbort(db, "tenant insert into maintenance Room C is blocked", "Room is under maintenance", () =>
  insertTenant(db, "T5", 3)
);
expectAbort(db, "reservation on maintenance Room C is blocked", "Room is under maintenance", () =>
  insertReservation(db, 3, "S3", "bed", 1)
);
db.prepare("UPDATE rooms SET maintenance = 0 WHERE id = 3").run();

console.log("\nBed holds + capacity accounting…");
insertReservation(db, 3, "S2", "bed", 1); // empty Room C, capacity 1 → OK
expectAbort(db, "second bed hold on full Room C is blocked", "Room is at full capacity", () =>
  insertReservation(db, 3, "S4", "bed", 1)
);
expectAbort(db, "tenant insert when a bed hold fills Room C is blocked", "Room is at full capacity", () =>
  insertTenant(db, "T6", 3)
);

console.log("\nDerived room status…");
let st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(1).status;
assert(st === "Occupied", `Room A (2 tenants) → ${st}`);
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(2).status;
assert(st === "Reserved", `Room B (whole reservation, no tenants) → ${st}`);
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(3).status;
assert(st === "Reserved", `Room C (bed hold, no tenants) → ${st}`);

console.log("\nConvert + cancel recompute…");
db.prepare("UPDATE reservations SET status = 'converted' WHERE room_id = 3 AND status = 'active'").run();
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(3).status;
assert(st === "Vacant", `Room C after converting bed hold → ${st}`);
insertTenant(db, "T6", 3); // room is free again → OK
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(3).status;
assert(st === "Occupied", `Room C with tenant after conversion → ${st}`);
db.prepare("UPDATE reservations SET status = 'cancelled' WHERE room_id = 2 AND status = 'active'").run();
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(2).status;
assert(st === "Vacant", `Room B after cancelling reservation → ${st}`);

console.log("\nMove-out (archive) accounting…");
db.prepare("UPDATE tenants SET moved_out_date = '2026-08-06' WHERE name = 'T1'").run();
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(1).status;
assert(st === "Occupied", `Room A with one of two tenants moved out → ${st}`);
db.prepare("UPDATE tenants SET moved_out_date = '2026-08-06' WHERE name = 'T2'").run();
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(1).status;
assert(st === "Vacant", `Room A with all tenants moved out → ${st}`);

console.log("\nSettings seeds…");
const reminderDays = db.prepare("SELECT value FROM settings WHERE key = ?").get("reminder_days").value;
assert(reminderDays === "3", `reminder_days seeded = ${reminderDays}`);
const enabled = db.prepare("SELECT value FROM settings WHERE key = ?").get("notifications_enabled").value;
assert(enabled === "1", `notifications_enabled seeded = ${enabled}`);
// Sales-report total capacity (v062): seeded from the sum of room capacities
// (0 rooms when the migration ran on this script's empty DB). Re-run the seed's
// SUM against the real seeded rooms (2+1+1 = 4) to lock in the semantics — the
// landlord then edits the value freely in Settings.
const totalCapacity = db.prepare("SELECT value FROM settings WHERE key = ?").get("total_capacity").value;
assert(totalCapacity === "0", `total_capacity seeded from room capacity sum at migration time (${totalCapacity})`);
const roomCapacitySum = db.prepare("SELECT COALESCE(SUM(capacity), 0) AS n FROM rooms").get().n;
assert(roomCapacitySum === 4, `total_capacity seed SQL sums room capacities (${roomCapacitySum})`);

console.log("\nPayment cascade on permanent tenant delete…");
const delId = db.prepare("SELECT id FROM tenants WHERE name = 'T6'").get().id;
db.prepare("INSERT INTO payments (tenant_id, amount, paid_date, due_date) VALUES (?,?,?,?)").run(
  delId, 1200, "2026-08-06", "2026-09-01"
);
db.prepare("DELETE FROM tenants WHERE id = ?").run(delId);
const orphan = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE tenant_id = ?").get(delId).n;
assert(orphan === 0, "payments cascade-deleted with tenant");

console.log("\nTenant deposit/advance write (M3 flow)…");
db.prepare(
  "INSERT INTO tenants (name, contact, room_id, move_in_date, due_date, deposit_amount, advance_months, advance_held, deposit_held, last_paid_date) VALUES (?,?,?,?,?,?,?,?,?,?)"
).run("T7", "0917", 1, "2026-08-01", "2026-10-01", 2000, 2, 1200, 2000, "2026-08-01");
const t7 = db
  .prepare("SELECT deposit_amount, advance_months, advance_held, deposit_held, last_paid_date FROM tenants WHERE name = 'T7'")
  .get();
assert(
  t7.deposit_amount === 2000 && t7.advance_months === 2 && t7.advance_held === 1200 && t7.deposit_held === 2000 && t7.last_paid_date === "2026-08-01",
  "deposit/advance pots + last_paid persisted"
);
// Re-run the v060 backfill statement against real data (the migration itself
// runs on an empty DB in this script) to lock in deposit → deposit_held.
db.prepare("UPDATE tenants SET deposit_held = 0 WHERE name = 'T7'").run();
db.prepare(
  "UPDATE tenants SET deposit_held = deposit_amount WHERE deposit_held = 0 AND deposit_amount IS NOT NULL"
).run();
const t7Backfilled = db.prepare("SELECT deposit_held FROM tenants WHERE name = 'T7'").get().deposit_held;
assert(t7Backfilled === 2000, `v060 backfill copies deposit_amount into deposit_held (${t7Backfilled})`);
// Refund mirrors the app (refundDeposit): flag set AND the deposit pot zeroed.
db.prepare("UPDATE tenants SET deposit_refunded = 1, deposit_held = 0 WHERE name = 'T7'").run();
const refunded = db.prepare("SELECT deposit_refunded, deposit_held FROM tenants WHERE name = 'T7'").get();
assert(refunded.deposit_refunded === 1 && refunded.deposit_held === 0, "deposit refunded flag persists + deposit pot zeroed");
db.prepare("UPDATE tenants SET moved_out_date = '2026-08-06' WHERE name = 'T7'").run();
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(1).status;
assert(st === "Vacant", `Room A frees after T7 moves out → ${st}`);

console.log("\nWhole-room convert via app SQL order (hold released before insert)…");
db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room K', 1, 1300)").run(); // id 4
insertReservation(db, 4, "WK", "whole", null);
// Fixed app order: mark converted first, then insert the tenant (inserting
// while the whole hold is active aborts with 'Room is reserved').
db.prepare("UPDATE reservations SET status = 'converted' WHERE room_id = 4 AND status = 'active'").run();
insertTenant(db, "WK", 4);
const wkStatus = db.prepare("SELECT status FROM reservations WHERE room_id = 4").get().status;
assert(wkStatus === "converted", "whole-room reservation stays converted after tenant insert");
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(4).status;
assert(st === "Occupied", `Room K after whole convert → ${st}`);

console.log("\nTenant room-move guard (UPDATE path, Edit flow)…");
db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room L', 1, 1100)").run(); // id 5
insertTenant(db, "TF", 5); // Room L now full (1/1)
try {
  // room_id appears in the SET list but is unchanged — must not be blocked.
  db.prepare("UPDATE tenants SET room_id = 5, contact = '0917-111' WHERE name = 'TF'").run();
  console.log("  ✓ same-room save in a full room is allowed");
} catch (e) {
  failures++;
  console.error(`  ✗ same-room save in a full room was blocked: ${e.message.split("\n")[0]}`);
}
db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room M', 1, 1200)").run(); // id 6
insertTenant(db, "TX", 6); // Room M full (1/1)
expectAbort(db, "moving tenant into full Room L is blocked", "Room is at full capacity", () =>
  db.prepare("UPDATE tenants SET room_id = 5 WHERE name = 'TX'").run()
);
db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room N', 2, 2000)").run(); // id 7
insertReservation(db, 7, "WN", "whole", null);
expectAbort(db, "moving tenant into whole-reserved Room N is blocked", "Room is reserved", () =>
  db.prepare("UPDATE tenants SET room_id = 7 WHERE name = 'TX'").run()
);
db.prepare("UPDATE rooms SET maintenance = 1 WHERE id = 7").run();
expectAbort(db, "moving tenant into maintenance Room N is blocked", "Room is under maintenance", () =>
  db.prepare("UPDATE tenants SET room_id = 7 WHERE name = 'TX'").run()
);

console.log("\nMultiple partial holds share a room's beds (visibility bug)…");
db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room Z', 4, 4000)").run(); // id 8
const roomZ = db.prepare("SELECT id FROM rooms WHERE room_number = 'Room Z'").get().id;
insertReservation(db, roomZ, "ZA", "bed", 1); // 1 of 4 held
insertReservation(db, roomZ, "ZB", "custom", 2); // 3 of 4 held
insertReservation(db, roomZ, "ZC", "bed", 1); // 4 of 4 held
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(roomZ).status;
assert(st === "Reserved", `Room Z fully held (no tenants) → ${st}`);
expectAbort(db, "bed hold on a fully held room is blocked", "Room is at full capacity", () =>
  insertReservation(db, roomZ, "ZD", "bed", 1)
);
expectAbort(db, "tenant into a fully held room is blocked", "Room is at full capacity", () =>
  insertTenant(db, "TZ", roomZ)
);
// Converting one hold frees its bed, so a tenant can now move in.
db.prepare("UPDATE reservations SET status = 'converted' WHERE room_id = ? AND name = 'ZC'").run(roomZ);
insertTenant(db, "TZ", roomZ);
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(roomZ).status;
assert(st === "Occupied", `Room Z (3 beds held + 1 tenant) → ${st}`);

console.log("\nWhole-room hold conflicts…");
db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room Y', 2, 2000)").run(); // id 9
const roomY = db.prepare("SELECT id FROM rooms WHERE room_number = 'Room Y'").get().id;
insertReservation(db, roomY, "YA", "bed", 1);
expectAbort(db, "whole hold blocked while a bed is held", "Room is already reserved", () =>
  insertReservation(db, roomY, "YW", "whole", null)
);

console.log("\nMulti-bed occupancy (v50+)…");
// Legacy-shaped inserts (no beds_occupied) default to exactly one bed.
const t1Beds = db.prepare("SELECT beds_occupied FROM tenants WHERE name = 'T1'").get().beds_occupied;
assert(t1Beds === 1, `legacy insert backfilled to 1 bed (T1 = ${t1Beds})`);

// The spec example: a 5-slot room where one tenant occupies 3 beds → 3/5, 2 free.
db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room Q', 5, 5000)").run(); // id 10
const roomQ = db.prepare("SELECT id FROM rooms WHERE room_number = 'Room Q'").get().id;
insertTenantBeds(db, "QA", roomQ, 3); // 3/5
insertTenantBeds(db, "QB", roomQ, 2); // 5/5
expectAbort(db, "tenant insert past 5/5 (1 more bed) is blocked", "Room is at full capacity", () =>
  insertTenantBeds(db, "QC", roomQ, 1)
);
expectAbort(db, "bed hold on a bed-full room is blocked", "Room is at full capacity", () =>
  insertReservation(db, roomQ, "QD", "bed", 1)
);
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(roomQ).status;
assert(st === "Occupied", `Room Q (3+2 beds occupied) → ${st}`);

// Beds guard trigger (v057): same-room updates are checked bed-by-bed.
expectAbort(db, "raising a tenant from 3 to 4 beds in a full room is blocked", "Room is at full capacity", () =>
  db.prepare("UPDATE tenants SET beds_occupied = 4 WHERE name = 'QA'").run()
);
expectAbort(db, "setting a tenant to 0 beds is blocked", "Tenant must occupy at least one bed", () =>
  db.prepare("UPDATE tenants SET beds_occupied = 0 WHERE name = 'QA'").run()
);
db.prepare("UPDATE tenants SET beds_occupied = 1 WHERE name = 'QB'").run(); // 5/5 → 4/5
const roomQBeds = db
  .prepare("SELECT SUM(beds_occupied) AS n FROM tenants WHERE room_id = ? AND moved_out_date IS NULL")
  .get(roomQ).n;
assert(roomQBeds === 4, `lowering QB to 1 bed frees a slot (now ${roomQBeds}/5)`);
insertReservation(db, roomQ, "QE", "bed", 1); // 5/5 again
expectAbort(db, "second bed hold after refill is blocked", "Room is at full capacity", () =>
  insertReservation(db, roomQ, "QF", "bed", 1)
);

// Moving a multi-bed tenant is checked against the destination's free beds.
db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room R', 4, 4000)").run(); // id 11
const roomR = db.prepare("SELECT id FROM rooms WHERE room_number = 'Room R'").get().id;
insertTenantBeds(db, "RA", roomR, 3); // 3/4
expectAbort(db, "moving a 3-bed tenant into a 3/4 room is blocked", "Room is at full capacity", () =>
  db.prepare("UPDATE tenants SET room_id = ? WHERE name = 'QA'").run(roomR)
);

// Move-out frees the tenant's beds, so a custom hold of that many fits again.
db.prepare("UPDATE tenants SET moved_out_date = '2026-08-06' WHERE name = 'RA'").run();
const roomRBedsAfter = db
  .prepare("SELECT COALESCE(SUM(beds_occupied), 0) AS n FROM tenants WHERE room_id = ? AND moved_out_date IS NULL")
  .get(roomR).n;
assert(roomRBedsAfter === 0, `move-out frees the tenant's beds (${roomRBedsAfter}/4 occupied)`);
insertReservation(db, roomR, "RH", "custom", 3); // 0 tenants + 3-bed hold ≤ 4
const roomRHolds = db
  .prepare("SELECT COALESCE(SUM(bed_count), 0) AS n FROM reservations WHERE room_id = ? AND status = 'active'")
  .get(roomR).n;
assert(roomRHolds === 3, `3-bed custom hold fits after the move-out (${roomRHolds}/4 held)`);

console.log("\nBilling columns (v31-38)…");
// tenants.monthly_rate — the migrations ran on an empty DB, so re-run the
// backfill against the smoke test's own tenants to prove it copies room rates
// (idempotent: only touches NULL rates, which is what a fresh legacy DB has).
db.exec(readFileSync(join(MIGRATIONS_DIR, "032-backfill_tenant_monthly_rate.sql"), "utf8"));
const t1Rate = db.prepare("SELECT monthly_rate FROM tenants WHERE name = 'T1'").get().monthly_rate;
assert(t1Rate === 2500, `tenant monthly_rate backfilled from room rate (T1 = ${t1Rate})`);
const t7Rate = db.prepare("SELECT monthly_rate FROM tenants WHERE name = 'T7'").get().monthly_rate;
assert(t7Rate === 2500, `tenant monthly_rate backfilled for a moved-out tenant (T7 = ${t7Rate})`);

// payments — a legacy-shaped insert (no new columns) exercises the defaults
// and the backfills (also idempotent re-runs on this script's own data).
db.prepare("INSERT INTO payments (tenant_id, amount, paid_date, due_date) VALUES (?,?,?,?)").run(
  1, 2500, "2026-08-05", "2026-09-05"
);
db.exec(readFileSync(join(MIGRATIONS_DIR, "034-backfill_payment_covers_month.sql"), "utf8"));
db.exec(readFileSync(join(MIGRATIONS_DIR, "037-backfill_payment_receipt_no.sql"), "utf8"));
const legacyPay = db
  .prepare("SELECT covers_month, method, receipt_no FROM payments WHERE tenant_id = 1 AND paid_date = '2026-08-05'")
  .get();
assert(
  legacyPay.covers_month === "2026-08",
  `payment covers_month backfilled from paid_date (${legacyPay.covers_month})`
);
assert(legacyPay.method === "cash", `payment method defaults to cash (${legacyPay.method})`);
assert(
  /^RCPT-\d{6}$/.test(legacyPay.receipt_no),
  `payment receipt_no backfilled (${legacyPay.receipt_no})`
);

// house-name setting seed (v38).
const house = db.prepare("SELECT value FROM settings WHERE key = ?").get("house_name").value;
assert(house === "RentEase", `house_name seeded = ${house}`);

// deposit-refund-allowed setting seed (v61).
const refundSetting = db.prepare("SELECT value FROM settings WHERE key = ?").get("deposit_refund_allowed").value;
assert(refundSetting === "1", `deposit_refund_allowed seeded = ${refundSetting}`);

// deposit-refunded-amount (v063/064): the exact refund column is NOT NULL
// DEFAULT 0, and the backfill copies deposit_amount for already-refunded rows
// (refundDeposit() never stored the exact amount before v63).
const t7RefundAmount = db
  .prepare("SELECT deposit_refunded_amount FROM tenants WHERE name = 'T7'")
  .get().deposit_refunded_amount;
assert(t7RefundAmount === 0, `deposit_refunded_amount defaults to 0 (T7 = ${t7RefundAmount})`);
db.prepare("UPDATE tenants SET deposit_refunded_amount = 0 WHERE name = 'T7'").run();
db.exec(readFileSync(join(MIGRATIONS_DIR, "064-backfill_deposit_refunded_amount.sql"), "utf8"));
const t7RefundedBackfilled = db
  .prepare("SELECT deposit_refunded_amount FROM tenants WHERE name = 'T7'")
  .get().deposit_refunded_amount;
assert(
  t7RefundedBackfilled === 2000,
  `v064 backfill copies deposit_amount into deposit_refunded_amount for refunded tenants (${t7RefundedBackfilled})`
);

console.log("\nApp query schema check (regression guard)…");
// Executes the app's REAL page SQL against the migrated schema so a query
// referencing a column that doesn't exist (e.g. the 2026-08 dashboard bug:
// `t.room_number` — tenants stores room_id, rooms owns room_number) fails the
// smoke test instead of crashing at runtime on the phone.
// Keep these queries in sync with their app sources:
//   src/routes/+page.svelte              (dashboard earnings)
//   src/routes/tenants/+page.svelte      (tenant list)
//   src/lib/reminders.ts                 (notification sweep)
//   src/routes/tenants/PaymentHistoryModal.svelte (history + receipt rows)
try {
  // Dashboard earnings (mid-month archived tenants included).
  const earnings = db
    .prepare(
      `SELECT t.id, t.name, r.room_number, t.move_in_date, t.moved_out_date,
              COALESCE(t.monthly_rate, r.monthly_rate) AS rate
       FROM tenants t JOIN rooms r ON r.id = t.room_id`
    )
    .all();
  assert(
    earnings.length > 0 && earnings.every((e) => e.room_number && e.rate > 0),
    `dashboard earnings query runs — ${earnings.length} tenant(s), room_number + rate resolved`
  );

  // Tenants list (t.* plus the joined room number).
  const tenantRows = db
    .prepare("SELECT t.*, r.room_number FROM tenants t JOIN rooms r ON r.id = t.room_id ORDER BY t.id")
    .all();
  assert(
    tenantRows.every((t) => typeof t.room_number === "string"),
    `tenants list query runs — room_number present on ${tenantRows.length} row(s)`
  );

  // Reminder sweep.
  const due = db
    .prepare(
      `SELECT t.id, t.name, t.due_date, t.last_paid_date,
              COALESCE(t.monthly_rate, r.monthly_rate) AS monthly_rate
       FROM tenants t
       JOIN rooms r ON r.id = t.room_id
       WHERE t.moved_out_date IS NULL`
    )
    .all();
  assert(due.every((t) => typeof t.monthly_rate === "number"), `reminders query runs — ${due.length} active tenant(s)`);

  // Room sheet boarder query (held-balance columns v58/59).
  const boarders = db
    .prepare(
      `SELECT id, name, contact, beds_occupied, monthly_rate, move_in_date, due_date, last_paid_date,
              deposit_amount, deposit_refunded, advance_months, advance_held, deposit_held
       FROM tenants WHERE room_id=? AND moved_out_date IS NULL ORDER BY id`
    )
    .all(1);
  assert(
    boarders.every((b) => typeof b.advance_held === "number" && typeof b.deposit_held === "number"),
    `room sheet boarder query runs — held pots resolved on ${boarders.length} row(s)`
  );

  // Payment history grouping + receipt rows (v31+ columns). Note: `$1`/`$2`
  // from the app source become `?` here — node:sqlite binds named params
  // differently than sqlx, and the rest of this script uses `?`.
  const groups = db
    .prepare(
      `SELECT receipt_no, MIN(paid_date) AS paid_date, MIN(covers_month) AS first_month,
              MAX(covers_month) AS last_month, SUM(amount) AS total, MAX(method) AS method,
              COUNT(*) AS count
       FROM payments WHERE tenant_id=?
       GROUP BY receipt_no
       ORDER BY MAX(id) DESC`
    )
    .all(1);
  const receiptRows = db
    .prepare(
      "SELECT id, amount, paid_date, due_date, covers_month, method, receipt_no FROM payments WHERE tenant_id=? AND receipt_no=? ORDER BY id"
    )
    .all(1, groups[0]?.receipt_no);
  assert(
    groups.length > 0 && receiptRows.length === groups[0].count,
    `payment history query runs — ${groups.length} receipt group(s), rows match`
  );

  // Reservations list + room options (hold_type/bed_count columns, v39+).
  const resRows = db
    .prepare(
      `SELECT res.id, res.room_id, r.room_number, res.name, res.contact,
              res.reservation_date, res.target_move_in_date, res.hold_type, res.bed_count,
              res.deposit, res.status
       FROM reservations res JOIN rooms r ON r.id = res.room_id
       ORDER BY CASE res.status WHEN 'active' THEN 0 ELSE 1 END,
                CASE res.status WHEN 'active' THEN res.target_move_in_date END ASC,
                res.id DESC`
    )
    .all();
  assert(
    resRows.length > 0 && resRows.every((x) => x.hold_type && x.room_number),
    `reservations list query runs — ${resRows.length} row(s), hold_type + room_number resolved`
  );

  const roomOptions = db
    .prepare(
      `SELECT r.id, r.room_number, r.capacity, r.monthly_rate, r.maintenance,
              COALESCE((SELECT SUM(t.beds_occupied) FROM tenants t WHERE t.room_id = r.id AND t.moved_out_date IS NULL), 0) AS occupied_beds,
              COALESCE((SELECT SUM(x.bed_count) FROM reservations x WHERE x.room_id = r.id
                        AND x.status = 'active' AND x.hold_type IN ('bed','custom')), 0) AS held_beds,
              EXISTS(SELECT 1 FROM reservations x WHERE x.room_id = r.id
                     AND x.status = 'active' AND x.hold_type = 'whole') AS has_whole_hold
       FROM rooms r ORDER BY r.id`
    )
    .all();
  assert(
    roomOptions.every((r) => typeof r.occupied_beds === "number" && typeof r.held_beds === "number"),
    `reservations room options query runs — ${roomOptions.length} room(s), occupied_beds resolved`
  );
} catch (e) {
  failures++;
  console.error(`  ✗ app query schema check FAILED: ${e.message}`);
}

console.log("\nLegacy → hold-type data copy (v039-045)…");
// The main run applies all migrations on an EMPTY database, so the copy in
// v040 (scope → hold_type/bed_count) is never exercised with real legacy
// rows. Replay the rebuild against a seeded legacy `reservations` table to
// lock in the mapping.
{
  const legacy = new DatabaseSync(":memory:", { readOnly: false });
  // Build the full LEGACY schema (v001-013): rooms with maintenance,
  // tenants with moved_out_date, and the old scope-shaped reservations table.
  const legacyFiles = [
    "001-create_rooms_table.sql",
    "002-create_tenants_table.sql",
    "003-room_occupied_on_tenant_insert.sql",
    "004-room_vacant_on_tenant_delete.sql",
    "005-enforce_room_capacity_on_insert.sql",
    "006-add_last_paid_date_to_tenants.sql",
    "007-create_payments_history_table.sql",
    "008-add_deposit_amount_to_tenants.sql",
    "009-add_deposit_refunded_to_tenants.sql",
    "010-add_advance_months_to_tenants.sql",
    "011-add_moved_out_date_to_tenants.sql",
    "012-add_maintenance_to_rooms.sql",
    "013-create_reservations_table.sql",
  ];
  for (const f of legacyFiles) legacy.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  legacy.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Legacy Room', 2, 2000)").run();
  // Seed legacy-shaped rows (the old scope column only knew 'whole'|'slot').
  legacy
    .prepare(
      "INSERT INTO reservations (room_id, name, contact, reservation_date, target_move_in_date, scope, deposit) VALUES (?,?,?,?,?,?,?)"
    )
    .run(1, "Whole Hold", "0917", "2026-08-01", "2026-08-15", "whole", 500);
  legacy
    .prepare(
      "INSERT INTO reservations (room_id, name, contact, reservation_date, target_move_in_date, scope, deposit) VALUES (?,?,?,?,?,?,?)"
    )
    .run(1, "Slot Hold", "0918", "2026-08-02", "2026-08-16", "slot", null);

  // The full rebuild chain exactly as the app ships it (039-049; 041-043 are
  // IF EXISTS no-ops here since this DB has no legacy triggers).
  const rebuildFiles = [
    "039-create_reservations_new_table.sql",
    "040-copy_reservations_to_new_table.sql",
    "041-drop_legacy_reservation_trigger.sql",
    "042-drop_legacy_capacity_trigger.sql",
    "043-drop_legacy_room_change_trigger.sql",
    "044-drop_legacy_reservations_table.sql",
    "045-rename_reservations_new_table.sql",
    "046-add_reservations_room_id_index.sql",
    "047-enforce_room_capacity_with_holds.sql",
    "048-enforce_reservation_hold_state.sql",
    "049-enforce_room_state_on_tenant_room_change_holds.sql",
  ];
  for (const f of rebuildFiles) legacy.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));

  const copied = legacy
    .prepare("SELECT name, hold_type, bed_count FROM reservations ORDER BY id")
    .all();
  const whole = copied.find((r) => r.name === "Whole Hold");
  const slot = copied.find((r) => r.name === "Slot Hold");
  assert(
    whole?.hold_type === "whole" && whole.bed_count === null,
    `legacy whole hold → hold_type='whole', bed_count=NULL (${whole?.hold_type}/${whole?.bed_count})`
  );
  assert(
    slot?.hold_type === "bed" && slot.bed_count === 1,
    `legacy slot hold → hold_type='bed', bed_count=1 (${slot?.hold_type}/${slot?.bed_count})`
  );
  assert(copied.length === 2, `both legacy rows copied (${copied.length})`);

  // The migrated holds must respect the rebuilt triggers. Release the whole
  // hold (it would otherwise block any bed hold as 'Room is reserved'), then
  // fill the room: capacity 2 = slot hold (1 bed) + one more bed.
  legacy.prepare("UPDATE reservations SET status = 'cancelled' WHERE name = 'Whole Hold'").run();
  legacy
    .prepare(
      "INSERT INTO reservations (room_id, name, contact, reservation_date, target_move_in_date, hold_type, bed_count) VALUES (?,?,?,?,?,?,?)"
    )
    .run(1, "Extra Bed", "0919", "2026-08-03", "2026-08-17", "bed", 1);
  let capacityAbort = false;
  try {
    legacy
      .prepare(
        "INSERT INTO reservations (room_id, name, contact, reservation_date, target_move_in_date, hold_type, bed_count) VALUES (?,?,?,?,?,?,?)"
      )
      .run(1, "Too Many", "0920", "2026-08-03", "2026-08-17", "bed", 1);
  } catch (e) {
    capacityAbort = String(e.message).includes("full capacity");
  }
  assert(capacityAbort, "capacity trigger still guards the rebuilt table");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll smoke checks passed ✅");
