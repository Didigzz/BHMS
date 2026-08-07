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

function insertReservation(db, roomId, name, scope) {
  db.prepare(
    "INSERT INTO reservations (room_id, name, contact, reservation_date, target_move_in_date, scope) VALUES (?,?,?,?,?,?)"
  ).run(roomId, name, "0917-000-0000", "2026-08-06", "2026-08-20", scope);
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
expectAbort(db, "slot reservation on full Room A is blocked", "Room is at full capacity", () =>
  insertReservation(db, 1, "S1", "slot")
);
expectAbort(db, "whole reservation on occupied Room A is blocked", "Room already has tenants", () =>
  insertReservation(db, 1, "W2", "whole")
);
insertReservation(db, 2, "W1", "whole"); // empty room → OK
expectAbort(db, "tenant insert into whole-reserved Room B is blocked", "Room is reserved", () =>
  insertTenant(db, "T4", 2)
);

console.log("\nMaintenance flag…");
db.prepare("UPDATE rooms SET maintenance = 1 WHERE id = 3").run();
expectAbort(db, "tenant insert into maintenance Room C is blocked", "Room is under maintenance", () =>
  insertTenant(db, "T5", 3)
);
expectAbort(db, "reservation on maintenance Room C is blocked", "Room is under maintenance", () =>
  insertReservation(db, 3, "S3", "slot")
);
db.prepare("UPDATE rooms SET maintenance = 0 WHERE id = 3").run();

console.log("\nReservation uniqueness + slot accounting…");
insertReservation(db, 3, "S2", "slot"); // empty Room C, capacity 1 → OK
try {
  insertReservation(db, 3, "S4", "slot");
  failures++;
  console.error("  ✗ second active reservation on Room C should be blocked");
} catch (e) {
  console.log(`  ✓ second active reservation on same room is blocked (${e.message.split("\n")[0]})`);
}
expectAbort(db, "tenant insert when slot reservation fills Room C is blocked", "Room is at full capacity", () =>
  insertTenant(db, "T6", 3)
);

console.log("\nDerived room status…");
let st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(1).status;
assert(st === "Occupied", `Room A (2 tenants) → ${st}`);
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(2).status;
assert(st === "Reserved", `Room B (whole reservation, no tenants) → ${st}`);
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(3).status;
assert(st === "Reserved", `Room C (slot reservation, no tenants) → ${st}`);

console.log("\nConvert + cancel recompute…");
db.prepare("UPDATE reservations SET status = 'converted' WHERE room_id = 3 AND status = 'active'").run();
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(3).status;
assert(st === "Vacant", `Room C after converting slot reservation → ${st}`);
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
  "INSERT INTO tenants (name, contact, room_id, move_in_date, due_date, deposit_amount, advance_months, last_paid_date) VALUES (?,?,?,?,?,?,?,?)"
).run("T7", "0917", 1, "2026-08-01", "2026-10-01", 2000, 2, "2026-08-01");
const t7 = db
  .prepare("SELECT deposit_amount, advance_months, last_paid_date FROM tenants WHERE name = 'T7'")
  .get();
assert(
  t7.deposit_amount === 2000 && t7.advance_months === 2 && t7.last_paid_date === "2026-08-01",
  "deposit/advance/last_paid persisted"
);
db.prepare("UPDATE tenants SET deposit_refunded = 1 WHERE name = 'T7'").run();
const refunded = db.prepare("SELECT deposit_refunded FROM tenants WHERE name = 'T7'").get().deposit_refunded;
assert(refunded === 1, "deposit_refunded flag persists");
db.prepare("UPDATE tenants SET moved_out_date = '2026-08-06' WHERE name = 'T7'").run();
st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(1).status;
assert(st === "Vacant", `Room A frees after T7 moves out → ${st}`);

console.log("\nWhole-room convert via app SQL order (hold released before insert)…");
db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room K', 1, 1300)").run(); // id 4
insertReservation(db, 4, "WK", "whole");
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
insertReservation(db, 7, "WN", "whole");
expectAbort(db, "moving tenant into whole-reserved Room N is blocked", "Room is reserved", () =>
  db.prepare("UPDATE tenants SET room_id = 7 WHERE name = 'TX'").run()
);
db.prepare("UPDATE rooms SET maintenance = 1 WHERE id = 7").run();
expectAbort(db, "moving tenant into maintenance Room N is blocked", "Room is under maintenance", () =>
  db.prepare("UPDATE tenants SET room_id = 7 WHERE name = 'TX'").run()
);

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
assert(house === "Digal Boarding House", `house_name seeded = ${house}`);

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
} catch (e) {
  failures++;
  console.error(`  ✗ app query schema check FAILED: ${e.message}`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll smoke checks passed ✅");
