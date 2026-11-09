/**
 * Amenity payment ledger commands.
 *
 * In the app each write is one Rust transaction; the browser preview uses the
 * shim's single connection with BEGIN/COMMIT, mirroring the same checks and
 * codes. Every error is translated through one function so the locked copy in
 * AMENITY_PAYMENT_MESSAGES is the only place the text lives.
 */
import type Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../db/db";
import {
  AMENITY_PAYMENT_MESSAGES,
  activeOnly,
  todayIso,
  validatePaidDate,
  type AmenityPaymentRow,
} from "./amenity-payments";

export type { AmenityPaymentRow } from "./amenity-payments";

const PAYMENT_ERRORS: Record<string, string> = {
  "amenity:paid-date": AMENITY_PAYMENT_MESSAGES.date,
  "amenity:paid-date-future": AMENITY_PAYMENT_MESSAGES.future,
  "amenity:payment-exists": AMENITY_PAYMENT_MESSAGES.paymentExists,
  "amenity:payment-not-found": AMENITY_PAYMENT_MESSAGES.paymentNotFound,
  "amenity:payment-not-active": AMENITY_PAYMENT_MESSAGES.paymentNotActive,
  "amenity:bill-cancelled": AMENITY_PAYMENT_MESSAGES.billCancelled,
  "amenity:share-excluded": AMENITY_PAYMENT_MESSAGES.shareExcluded,
  "amenity:no-charge": AMENITY_PAYMENT_MESSAGES.noCharge,
  "amenity:no-unpaid": AMENITY_PAYMENT_MESSAGES.noUnpaid,
  "amenity:paid-locked": AMENITY_PAYMENT_MESSAGES.paidLocked,
};

export function translatePaymentError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  for (const [code, message] of Object.entries(PAYMENT_ERRORS)) {
    if (text.includes(code)) return message;
  }
  return text;
}

export interface PaymentFilter {
  status?: "active" | "reversed";
  billId?: number;
  tenantId?: number;
  from?: string;
  to?: string;
}

interface ShareRow {
  id: number;
  bill_id: number;
  tenant_id: number;
  amount: number;
  is_excluded: number;
  status: string;
}

interface PaymentDbRow {
  id: number;
  bill_tenant_id: number;
  tenant_id: number;
  amount: number;
  status: string;
}

const PAYMENT_COLUMNS = `p.id, p.bill_tenant_id, p.bill_id, p.tenant_id, p.amount, p.paid_date,
       p.status, p.reversal_reason, p.reversed_at,
       ab.amenity_name, ab.billing_period, ab.billing_date, ab.status AS bill_status,
       abt.tenant_name_snapshot, abt.room_number_snapshot`;

const PAYMENT_JOINS = `FROM amenity_payments p
     JOIN amenity_bills ab ON ab.id = p.bill_id
     JOIN amenity_bill_tenants abt ON abt.id = p.bill_tenant_id`;

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------

export async function getPayments(
  db: Database,
  filter: PaymentFilter = {},
): Promise<AmenityPaymentRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filter.status) clauses.push(`p.status = ${bind(filter.status)}`);
  if (filter.billId != null) clauses.push(`p.bill_id = ${bind(filter.billId)}`);
  if (filter.tenantId != null) clauses.push(`p.tenant_id = ${bind(filter.tenantId)}`);
  if (filter.from) clauses.push(`p.paid_date >= ${bind(filter.from)}`);
  if (filter.to) clauses.push(`p.paid_date <= ${bind(filter.to)}`);

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.select<AmenityPaymentRow[]>(
    `SELECT ${PAYMENT_COLUMNS}
     ${PAYMENT_JOINS}
     ${where}
     ORDER BY p.paid_date DESC, p.id DESC`,
    params,
  );
}

/** Active payments for one bill, keyed by the share they settle. */
export async function getBillSharePayments(
  db: Database,
  billId: number,
): Promise<Map<number, AmenityPaymentRow>> {
  const rows = activeOnly(await getPayments(db, { billId, status: "active" }));
  const byShare = new Map<number, AmenityPaymentRow>();
  for (const row of rows) byShare.set(row.bill_tenant_id, row);
  return byShare;
}

export async function getTenantAmenityPayments(
  db: Database,
  tenantId: number,
): Promise<AmenityPaymentRow[]> {
  return getPayments(db, { tenantId });
}

export async function countActivePayments(db: Database, billId: number): Promise<number> {
  const rows = await db.select<{ total: number }[]>(
    "SELECT COUNT(*) AS total FROM amenity_payments WHERE bill_id=$1 AND status='active'",
    [billId],
  );
  return rows[0]?.total ?? 0;
}

// ---------------------------------------------------------------------------
// writes — app
// ---------------------------------------------------------------------------

export async function recordAmenityPayment(
  db: Database,
  billTenantId: number,
  paidDate: string,
): Promise<{ error: string | null; paymentId: number | null }> {
  const invalid = validatePaidDate(paidDate, todayIso());
  if (invalid) return { error: invalid, paymentId: null };

  if (isTauri()) {
    try {
      const paymentId = await invoke<number>("record_amenity_payment", {
        billTenantId,
        paidDate,
        today: todayIso(),
      });
      return { error: null, paymentId };
    } catch (error) {
      return { error: translatePaymentError(error), paymentId: null };
    }
  }
  return recordPaymentLocally(db, billTenantId, paidDate);
}

export async function recordBillPayments(
  db: Database,
  billId: number,
  paidDate: string,
): Promise<{ error: string | null; count: number }> {
  const invalid = validatePaidDate(paidDate, todayIso());
  if (invalid) return { error: invalid, count: 0 };

  if (isTauri()) {
    try {
      const count = await invoke<number>("record_amenity_bill_payments", {
        billId,
        paidDate,
        today: todayIso(),
      });
      return { error: null, count };
    } catch (error) {
      return { error: translatePaymentError(error), count: 0 };
    }
  }
  return recordBillLocally(db, billId, paidDate);
}

export async function voidAmenityPayment(
  db: Database,
  paymentId: number,
  reason?: string,
): Promise<{ error: string | null }> {
  if (isTauri()) {
    try {
      await invoke("void_amenity_payment", { paymentId, reason: reason?.trim() || null });
      return { error: null };
    } catch (error) {
      return { error: translatePaymentError(error) };
    }
  }
  return voidPaymentLocally(db, paymentId, reason);
}

export async function updateAmenityPaymentDate(
  db: Database,
  paymentId: number,
  paidDate: string,
): Promise<{ error: string | null }> {
  const invalid = validatePaidDate(paidDate, todayIso());
  if (invalid) return { error: invalid };

  if (isTauri()) {
    try {
      await invoke("update_amenity_payment_date", {
        paymentId,
        paidDate,
        today: todayIso(),
      });
      return { error: null };
    } catch (error) {
      return { error: translatePaymentError(error) };
    }
  }
  return updateDateLocally(db, paymentId, paidDate);
}

// ---------------------------------------------------------------------------
// writes — browser preview (the shim owns one connection, so this is atomic)
// ---------------------------------------------------------------------------

const BALANCE_SUBTRACT = `UPDATE tenants
   SET amenity_balance = CASE
     WHEN ROUND(amenity_balance - $1, 2) = 0 THEN 0
     ELSE ROUND(amenity_balance - $1, 2)
   END
   WHERE id = $2`;

const BALANCE_ADD = `UPDATE tenants
   SET amenity_balance = CASE
     WHEN ROUND(amenity_balance + $1, 2) = 0 THEN 0
     ELSE ROUND(amenity_balance + $1, 2)
   END
   WHERE id = $2`;

async function rollback(db: Database) {
  try {
    await db.execute("ROLLBACK");
  } catch {
    // No open transaction — nothing to undo.
  }
}

async function recordPaymentLocally(
  db: Database,
  billTenantId: number,
  paidDate: string,
): Promise<{ error: string | null; paymentId: number | null }> {
  try {
    await db.execute("BEGIN");
    const shares = await db.select<ShareRow[]>(
      `SELECT abt.id, abt.bill_id, abt.tenant_id, abt.amount, abt.is_excluded, ab.status
       FROM amenity_bill_tenants abt
       JOIN amenity_bills ab ON ab.id = abt.bill_id
       WHERE abt.id = $1`,
      [billTenantId],
    );
    const share = shares[0];
    if (!share) throw new Error("amenity:payment-not-found");
    if (share.is_excluded) throw new Error("amenity:share-excluded");
    if (share.amount <= 0) throw new Error("amenity:no-charge");
    if (share.status !== "active") throw new Error("amenity:bill-cancelled");

    const existing = await db.select<{ total: number }[]>(
      "SELECT COUNT(*) AS total FROM amenity_payments WHERE bill_tenant_id = $1 AND status = 'active'",
      [billTenantId],
    );
    if ((existing[0]?.total ?? 0) > 0) throw new Error("amenity:payment-exists");

    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO amenity_payments
         (bill_tenant_id, bill_id, tenant_id, amount, paid_date, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'active',$6,$6)`,
      [billTenantId, share.bill_id, share.tenant_id, share.amount, paidDate, now],
    );
    const inserted = await db.select<{ id: number }[]>("SELECT last_insert_rowid() AS id");
    await db.execute("UPDATE amenity_bill_tenants SET payment_status='Paid' WHERE id=$1", [
      billTenantId,
    ]);
    await db.execute(BALANCE_SUBTRACT, [share.amount, share.tenant_id]);
    await db.execute("COMMIT");
    return { error: null, paymentId: inserted[0]?.id ?? null };
  } catch (error) {
    await rollback(db);
    return { error: translatePaymentError(error), paymentId: null };
  }
}

async function recordBillLocally(
  db: Database,
  billId: number,
  paidDate: string,
): Promise<{ error: string | null; count: number }> {
  try {
    await db.execute("BEGIN");
    const bills = await db.select<{ status: string }[]>(
      "SELECT status FROM amenity_bills WHERE id = $1",
      [billId],
    );
    if (bills.length === 0) throw new Error("amenity:not-found");
    if (bills[0].status !== "active") throw new Error("amenity:bill-cancelled");

    const shares = await db.select<{ id: number; tenant_id: number; amount: number }[]>(
      `SELECT id, tenant_id, amount FROM amenity_bill_tenants
       WHERE bill_id = $1 AND is_excluded = 0 AND amount > 0 AND payment_status = 'Unpaid'
       ORDER BY id`,
      [billId],
    );
    if (shares.length === 0) throw new Error("amenity:no-unpaid");

    const now = new Date().toISOString();
    for (const share of shares) {
      await db.execute(
        `INSERT INTO amenity_payments
           (bill_tenant_id, bill_id, tenant_id, amount, paid_date, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'active',$6,$6)`,
        [share.id, billId, share.tenant_id, share.amount, paidDate, now],
      );
      await db.execute("UPDATE amenity_bill_tenants SET payment_status='Paid' WHERE id=$1", [
        share.id,
      ]);
      await db.execute(BALANCE_SUBTRACT, [share.amount, share.tenant_id]);
    }
    await db.execute("COMMIT");
    return { error: null, count: shares.length };
  } catch (error) {
    await rollback(db);
    return { error: translatePaymentError(error), count: 0 };
  }
}

async function voidPaymentLocally(
  db: Database,
  paymentId: number,
  reason?: string,
): Promise<{ error: string | null }> {
  try {
    await db.execute("BEGIN");
    const rows = await db.select<PaymentDbRow[]>(
      "SELECT id, bill_tenant_id, tenant_id, amount, status FROM amenity_payments WHERE id = $1",
      [paymentId],
    );
    const payment = rows[0];
    if (!payment) throw new Error("amenity:payment-not-found");
    if (payment.status !== "active") throw new Error("amenity:payment-not-active");

    const note = reason?.trim().slice(0, 200) || null;
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE amenity_payments
       SET status='reversed', reversal_reason=$1, reversed_at=$2, updated_at=$2
       WHERE id=$3 AND status='active'`,
      [note, now, paymentId],
    );
    await db.execute("UPDATE amenity_bill_tenants SET payment_status='Unpaid' WHERE id=$1", [
      payment.bill_tenant_id,
    ]);
    await db.execute(BALANCE_ADD, [payment.amount, payment.tenant_id]);
    await db.execute("COMMIT");
    return { error: null };
  } catch (error) {
    await rollback(db);
    return { error: translatePaymentError(error) };
  }
}

async function updateDateLocally(
  db: Database,
  paymentId: number,
  paidDate: string,
): Promise<{ error: string | null }> {
  try {
    await db.execute("BEGIN");
    const rows = await db.select<{ status: string }[]>(
      "SELECT status FROM amenity_payments WHERE id = $1",
      [paymentId],
    );
    if (rows.length === 0) throw new Error("amenity:payment-not-found");
    if (rows[0].status !== "active") throw new Error("amenity:payment-not-active");

    await db.execute(
      "UPDATE amenity_payments SET paid_date=$1, updated_at=$2 WHERE id=$3",
      [paidDate, new Date().toISOString(), paymentId],
    );
    await db.execute("COMMIT");
    return { error: null };
  } catch (error) {
    await rollback(db);
    return { error: translatePaymentError(error) };
  }
}
