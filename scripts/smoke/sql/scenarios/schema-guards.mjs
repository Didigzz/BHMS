// Rooms, capacity, holds, maintenance, derived status, conversion, move-out.
import { ROOM_STATUS_SQL } from "../../../../src/lib/rooms/room-status.ts";
import { assert, expectAbort, insertReservation, insertTenant } from "../harness.mjs";

export function runSchemaGuardScenarios(db) {
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
}
