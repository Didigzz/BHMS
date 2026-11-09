// Shared-bed holds, whole-vs-bed conflicts, multi-bed occupancy (v50+), and the
// already-boarding backfill flags (v65-67).
import { ROOM_STATUS_SQL } from "../../../../src/lib/rooms/room-status.ts";
import {
  assert,
  expectAbort,
  insertBackfilledTenant,
  insertReservation,
  insertTenant,
  insertTenantBeds,
} from "../harness.mjs";

export function runCapacityScenarios(db) {
  console.log("\nMultiple partial holds share a room's beds (visibility bug)…");
  db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room Z', 4, 4000)").run(); // id 8
  const roomZ = db.prepare("SELECT id FROM rooms WHERE room_number = 'Room Z'").get().id;
  insertReservation(db, roomZ, "ZA", "bed", 1); // 1 of 4 held
  insertReservation(db, roomZ, "ZB", "custom", 2); // 3 of 4 held
  insertReservation(db, roomZ, "ZC", "bed", 1); // 4 of 4 held
  let st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(roomZ).status;
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

  console.log("\nAlready-boarding backfill (v65-67)…");
  // The recreated capacity trigger must skip ALL room checks for backfilled=1
  // inserts (the tenant is already physically in the room) while keeping every
  // guard for normal inserts. New rooms start at id 12.
  db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room BF1', 1, 1000)").run();
  const bf1 = db.prepare("SELECT id FROM rooms WHERE room_number = 'Room BF1'").get().id;
  insertTenant(db, "BF1-T1", bf1); // 1/1 → full
  st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(bf1).status;
  assert(st === "Occupied", `Room BF1 with one tenant → ${st}`);
  expectAbort(db, "normal second tenant into full Room BF1 is blocked", "Room is at full capacity", () =>
    insertTenant(db, "BF1-T2", bf1)
  );
  insertBackfilledTenant(db, "BF1-Existing", bf1); // backfilled=1 → allowed
  st = db.prepare(`SELECT ${ROOM_STATUS_SQL} AS status FROM rooms r WHERE r.id = ?`).get(bf1).status;
  assert(st === "Occupied", `Room BF1 after backfilled insert → ${st}`);

  // Maintenance room: normal insert blocked, backfilled insert allowed.
  db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room BF2', 1, 1000)").run();
  const bf2 = db.prepare("SELECT id FROM rooms WHERE room_number = 'Room BF2'").get().id;
  db.prepare("UPDATE rooms SET maintenance = 1 WHERE id = ?").run(bf2);
  expectAbort(db, "normal tenant into maintenance Room BF2 is blocked", "Room is under maintenance", () =>
    insertTenant(db, "BF2-T", bf2)
  );
  insertBackfilledTenant(db, "BF2-Existing", bf2); // backfilled=1 → allowed
  db.prepare("UPDATE rooms SET maintenance = 0 WHERE id = ?").run(bf2);

  // Whole-reserved room: normal insert blocked, backfilled insert allowed.
  db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room BF3', 1, 1000)").run();
  const bf3 = db.prepare("SELECT id FROM rooms WHERE room_number = 'Room BF3'").get().id;
  insertReservation(db, bf3, "BF3-Hold", "whole", null);
  expectAbort(db, "normal tenant into whole-reserved Room BF3 is blocked", "Room is reserved", () =>
    insertTenant(db, "BF3-T", bf3)
  );
  insertBackfilledTenant(db, "BF3-Existing", bf3); // backfilled=1 → allowed

  // Multi-bed backfill: beds beyond the free space are accepted too (the tenant
  // occupies them in reality); the backfilled flag is persisted.
  insertBackfilledTenant(db, "BF1-Multi", bf1, 3); // 1-bed room now holds a 3-bed tenant
  const bf1Flag = db.prepare("SELECT backfilled FROM tenants WHERE name = 'BF1-Multi'").get().backfilled;
  assert(bf1Flag === 1, `backfilled flag persisted (BF1-Multi = ${bf1Flag})`);
  const bf1NormalFlag = db.prepare("SELECT backfilled FROM tenants WHERE name = 'BF1-T1'").get().backfilled;
  assert(bf1NormalFlag === 0, `normal inserts default backfilled to 0 (BF1-T1 = ${bf1NormalFlag})`);

  // Editing (room change) is NOT relaxed: moving the backfilled tenant to
  // another full room must still be blocked by the v056 room-change trigger.
  db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room BF4', 1, 1000)").run();
  const bf4 = db.prepare("SELECT id FROM rooms WHERE room_number = 'Room BF4'").get().id;
  insertTenant(db, "BF4-T1", bf4); // 1/1 → full
  const bf1MultiId = db.prepare("SELECT id FROM tenants WHERE name = 'BF1-Multi'").get().id;
  expectAbort(db, "moving a backfilled tenant into full Room BF4 is blocked", "Room is at full capacity", () =>
    db.prepare("UPDATE tenants SET room_id = ? WHERE id = ?").run(bf4, bf1MultiId)
  );
}
