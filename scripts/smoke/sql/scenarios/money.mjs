// Settings seeds, delete cascade, deposit/advance pots, whole-room convert, and
// the tenant room-move guard.
import { ROOM_STATUS_SQL } from "../../../../src/lib/rooms/room-status.ts";
import { assert, expectAbort, insertReservation, insertTenant, state } from "../harness.mjs";

export function runMoneyScenarios(db) {
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
  let st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(1).status;
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
    state.failures++;
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
}
