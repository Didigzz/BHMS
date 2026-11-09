// Fixtures and snapshot helpers for the backup smoke test: a populated
// database (unicode, NULL vs empty string, REAL, holds) and the row-level
// snapshot/hash used to prove an export changed nothing.
import { REQUIRED_TABLES, canonicalize, sha256Hex, toBackupTable } from "../../../src/lib/backup/backup-format.ts";

/** Populated fixture: unicode, NULL vs empty string, REAL, unicode ids, holds. */
export function seedPopulated(db) {
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

  // Amenity ledger: one bill with a paid share and an excluded share, plus an
  // active and a reversed payment on the same share (the unique index allows a
  // reversed row while an active one exists).
  const billId = db
    .prepare(
      `INSERT INTO amenity_bills
         (amenity_name, billing_method, total_amount, billing_date, billing_period, notes,
          division_mode, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      "Kuryente ñ", "shared", 1000, "2026-09-01", "2026-09", null, "auto", "active",
      "2026-09-01T08:00:00.000Z", "2026-09-01T08:00:00.000Z"
    ).lastInsertRowid;
  const share = db.prepare(
    `INSERT INTO amenity_bill_tenants
       (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status,
        tenant_name_snapshot, room_number_snapshot)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  share.run(Number(billId), 1, 500, 0, null, "Paid", "Maria Peña ₱", "Room A");
  share.run(
    Number(billId), 2, 0, 1, "Moved out mid-cycle", "Unpaid",
    "🧑‍🌾 Boarder “Anon”", "Room A"
  );
  const paidShareId = db
    .prepare("SELECT id FROM amenity_bill_tenants WHERE bill_id = ? AND tenant_id = 1")
    .get(Number(billId)).id;
  const amenityPayment = db.prepare(
    `INSERT INTO amenity_payments
       (bill_tenant_id, bill_id, tenant_id, amount, paid_date, status, reversal_reason,
        reversed_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  amenityPayment.run(
    paidShareId, Number(billId), 1, 500, "2026-09-05", "active", null, null,
    "2026-09-05T00:00:00.000Z", "2026-09-05T00:00:00.000Z"
  );
  amenityPayment.run(
    paidShareId, Number(billId), 1, 500, "2026-09-04", "reversed", "Wrong tenant",
    "2026-09-06T00:00:00.000Z", "2026-09-04T00:00:00.000Z",
    "2026-09-06T00:00:00.000Z"
  );
}

const ORDER_BY = { settings: "key" };

export function snapshot(db) {
  const out = {};
  for (const table of REQUIRED_TABLES) {
    const order = ORDER_BY[table] ?? "id";
    out[table] = db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
  }
  return out;
}

export function hashOf(value) {
  return sha256Hex(JSON.stringify(canonicalize(value)));
}

export function tablePayloads(db) {
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
