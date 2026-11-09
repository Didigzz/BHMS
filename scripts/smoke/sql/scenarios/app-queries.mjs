// App query schema check (regression guard): runs the app's REAL page SQL
// against the migrated schema so a query referencing a column that doesn't
// exist (e.g. the 2026-08 dashboard bug: `t.room_number` — tenants stores
// room_id, rooms owns room_number) fails the smoke test instead of crashing at
// runtime on the phone.
//
// Keep these queries in sync with their app sources:
//   src/routes/+page.svelte                      (dashboard earnings)
//   src/routes/tenants/+page.svelte              (tenant list)
//   src/lib/reservations/reminders.ts            (notification sweep)
//   src/routes/tenants/PaymentHistoryModal.svelte (history + receipt rows)
import { assert, state } from "../harness.mjs";

export function runAppQueryScenarios(db) {
  console.log("\nApp query schema check (regression guard)…");
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
    state.failures++;
    console.error(`  ✗ app query schema check FAILED: ${e.message}`);
  }
}
