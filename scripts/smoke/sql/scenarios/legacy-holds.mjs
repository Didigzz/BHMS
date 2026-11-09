// Legacy → hold-type data copy (v039-045): the main run applies all migrations
// on an EMPTY database, so the copy in v040 (scope → hold_type/bed_count) is
// never exercised with real legacy rows. Replay the rebuild against a seeded
// legacy `reservations` table to lock in the mapping.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS_DIR, assert } from "../harness.mjs";

export function runLegacyHoldScenarios() {
  console.log("\nLegacy → hold-type data copy (v039-045)…");
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
