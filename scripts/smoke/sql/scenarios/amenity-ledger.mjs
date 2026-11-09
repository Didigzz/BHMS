// Replays the v081/v082 amenity-ledger backfills against seeded bills/shares
// (the chain itself applied them to an empty database).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_DIR, assert, expectAbort, insertTenant } from "../harness.mjs";

export function runAmenityLedgerScenarios(db) {
  console.log("\nAmenity payments ledger (v76-82)…");
  // The chain applies 081/082 to an EMPTY database above, so the backfill is
  // replayed here against seeded rows: a paid share on an active bill, an unpaid
  // share, and a paid share on a cancelled bill (which must stay payment-free).
  db.prepare("INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('Room AP', 3, 1000)").run();
  const roomAP = db.prepare("SELECT id FROM rooms WHERE room_number = 'Room AP'").get().id;
  insertTenant(db, "AP-Paid", roomAP);
  insertTenant(db, "AP-Unpaid", roomAP);
  insertTenant(db, "AP-Cancelled", roomAP);
  const apId = (name) =>
    db.prepare("SELECT id FROM tenants WHERE name = ? AND room_id = ?").get(name, roomAP).id;

  const addBill = (name, status) => {
    db.prepare(
      `INSERT INTO amenity_bills
         (amenity_name, billing_method, total_amount, billing_date, billing_period, notes,
          division_mode, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      name, "shared", 1000, "2026-09-01", "2026-09", null, "auto", status,
      "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"
    );
    return db.prepare("SELECT id FROM amenity_bills WHERE amenity_name = ?").get(name).id;
  };

  const addShare = (billId, tenantName, amount, paid) => {
    db.prepare(
      `INSERT INTO amenity_bill_tenants
         (bill_id, tenant_id, amount, is_excluded, exclusion_reason, payment_status,
          tenant_name_snapshot, room_number_snapshot)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      billId, apId(tenantName), amount, 0, null, paid ? "Paid" : "Unpaid",
      tenantName, "Room AP"
    );
  };

  const activeBill = addBill("Kuryente AP", "active");
  const cancelledBill = addBill("Tubig AP", "cancelled");
  addShare(activeBill, "AP-Paid", 500, true);
  addShare(activeBill, "AP-Unpaid", 500, false);
  addShare(cancelledBill, "AP-Cancelled", 500, true);

  // A wrong balance on purpose: 082 derives it from source rows, not a delta.
  db.prepare("UPDATE tenants SET amenity_balance = 999 WHERE room_id = ?").run(roomAP);

  db.exec(readFileSync(join(MIGRATIONS_DIR, "081-backfill_amenity_payments.sql"), "utf8"));
  db.exec(readFileSync(join(MIGRATIONS_DIR, "082-recompute_amenity_balances.sql"), "utf8"));

  const paidRows = db
    .prepare("SELECT amount, paid_date, status FROM amenity_payments WHERE tenant_id = ?")
    .all(apId("AP-Paid"));
  assert(
    paidRows.length === 1 && paidRows[0].amount === 500 && paidRows[0].status === "active",
    `paid active-bill share becomes one ₱500 active payment (${paidRows.length} row(s))`
  );
  assert(
    paidRows[0]?.paid_date === "2026-09-01",
    `backfill dates it with the bill's billing_date (${paidRows[0]?.paid_date})`
  );
  const cancelledPaid = db
    .prepare("SELECT COUNT(*) AS n FROM amenity_payments WHERE tenant_id = ?")
    .get(apId("AP-Cancelled")).n;
  assert(cancelledPaid === 0, `a cancelled bill's Paid flag produces no payment row (${cancelledPaid})`);

  const balanceOf = (name) =>
    db.prepare("SELECT amenity_balance FROM tenants WHERE name = ?").get(name).amenity_balance;
  assert(balanceOf("AP-Paid") === 0, `paid share → balance 0 (${balanceOf("AP-Paid")})`);
  assert(balanceOf("AP-Unpaid") === 500, `unpaid share → balance 500 (${balanceOf("AP-Unpaid")})`);
  assert(
    balanceOf("AP-Cancelled") === 0,
    `cancelled bill excluded from the balance (${balanceOf("AP-Cancelled")})`
  );

  // Both backfills must be replay-safe.
  const before = db.prepare("SELECT COUNT(*) AS n FROM amenity_payments").get().n;
  db.exec(readFileSync(join(MIGRATIONS_DIR, "081-backfill_amenity_payments.sql"), "utf8"));
  db.exec(readFileSync(join(MIGRATIONS_DIR, "082-recompute_amenity_balances.sql"), "utf8"));
  const after = db.prepare("SELECT COUNT(*) AS n FROM amenity_payments").get().n;
  assert(after === before, `081 replay inserts nothing (${before} → ${after})`);
  assert(balanceOf("AP-Unpaid") === 500, "082 replay leaves the recomputed balance unchanged");

  // One ACTIVE payment per share; a reversed row does not block a new payment.
  expectAbort(
    db,
    "a second active payment for the same share is rejected",
    "UNIQUE constraint failed",
    () =>
      db
        .prepare(
          `INSERT INTO amenity_payments
             (bill_tenant_id, bill_id, tenant_id, amount, paid_date, status, created_at, updated_at)
           SELECT abt.id, abt.bill_id, abt.tenant_id, abt.amount, '2026-09-02', 'active',
                  '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z'
           FROM amenity_bill_tenants abt WHERE abt.bill_id = ? AND abt.tenant_id = ?`
        )
        .run(activeBill, apId("AP-Paid"))
  );

  const paidShareId = db
    .prepare("SELECT id FROM amenity_bill_tenants WHERE bill_id = ? AND tenant_id = ?")
    .get(activeBill, apId("AP-Paid")).id;
  db.prepare("UPDATE amenity_payments SET status = 'reversed' WHERE bill_tenant_id = ?").run(
    paidShareId
  );
  db.prepare(
    `INSERT INTO amenity_payments
       (bill_tenant_id, bill_id, tenant_id, amount, paid_date, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    paidShareId, activeBill, apId("AP-Paid"), 500, "2026-09-02", "active",
    "2026-09-02T00:00:00.000Z", "2026-09-02T00:00:00.000Z"
  );
  const rePaid = db
    .prepare("SELECT status FROM amenity_payments WHERE bill_tenant_id = ? ORDER BY id")
    .all(paidShareId);
  assert(
    rePaid.length === 2 && rePaid[0].status === "reversed" && rePaid[1].status === "active",
    `a voided share can be paid again while history keeps the reversed row (${rePaid.length} rows)`
  );
}
