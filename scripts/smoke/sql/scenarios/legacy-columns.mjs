// Replays the v31-v38 column backfills against already-seeded rows, since the
// migration chain itself ran on an empty database.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_DIR, assert } from "../harness.mjs";

export function runLegacyColumnScenarios(db) {
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
}
