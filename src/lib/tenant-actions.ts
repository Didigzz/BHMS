/**
 * Shared tenant money/status mutations (payment, move-out, deposit refund).
 *
 * The tenants page and the room boarder sheet both need these, so the rules
 * live here once instead of being duplicated. Billing rules follow
 * billing-features-spec.md §3 (full payment only) and payment-due-date-spec.md
 * §6 (one payment row per payment, covering one specific due date the
 * landlord picks; the tenant's stored due date is landlord-managed).
 */

import type Database from "@tauri-apps/plugin-sql";
import { addMonths } from "./payment-status";
import { addMonthsKey, monthKeyOf } from "./format";
import { splitConsumption, validateApply } from "./held-balance";

/** One payment row as written to the payments table (also the receipt row shape). */
export interface PaymentRow {
  id: number;
  amount: number;
  paid_date: string;
  /** The specific due date this payment covers (new model). */
  due_date: string;
  covers_month: string | null;
  method: string;
  receipt_no: string | null;
}

/** The tenant fields payment / move-out mutations act on. */
export interface TenantActionTarget {
  id: number;
  room_id: number;
  monthly_rate: number | null;
  due_date: string;
}

/** Today's date as an ISO "YYYY-MM-DD" string. */
function todayIso(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

/** Next receipt number, from the current max payment id (RCPT-######). */
export async function nextReceiptNo(db: Database): Promise<string> {
  const row = await db.select<{ n: number }[]>("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM payments");
  return `RCPT-${String(row[0].n).padStart(6, "0")}`;
}

/**
 * Record a payment covering one specific due date (payment-due-date-spec.md
 * §6.1). One payment = one row = one receipt. `paidDate` is the actual date
 * money was received (landlord-entered, not necessarily today);
 * `coveredDueDate` is the specific due date this payment settles;
 * `nextDueDate` becomes the tenant's stored due date (landlord-managed).
 * Returns the receipt row, or an error message — partial payments are
 * rejected (§3).
 */
export async function recordPayment(
  db: Database,
  tenant: TenantActionTarget,
  roomRate: number,
  amount: number,
  method: string,
  paidDate: string,
  coveredDueDate: string,
  nextDueDate: string
): Promise<{ error: string | null; rows: PaymentRow[] }> {
  // Full payment only: the amount must be exactly one month's rate. The UI
  // locks it, but keep the guard so a future caller can't silently record a
  // partial.
  const rate = tenant.monthly_rate ?? roomRate;
  if (amount !== rate) {
    return { error: "Amount must equal the full monthly rate.", rows: [] };
  }

  const receiptNo = await nextReceiptNo(db);
  await db.execute(
    "INSERT INTO payments (tenant_id, amount, paid_date, due_date, covers_month, method, receipt_no) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [tenant.id, rate, paidDate, coveredDueDate, monthKeyOf(coveredDueDate), method, receiptNo]
  );
  await db.execute("UPDATE tenants SET last_paid_date=$1, due_date=$2 WHERE id=$3", [
    paidDate,
    nextDueDate,
    tenant.id,
  ]);

  const rows = await db.select<PaymentRow[]>(
    "SELECT id, amount, paid_date, due_date, covers_month, method, receipt_no FROM payments WHERE tenant_id=$1 AND receipt_no=$2 ORDER BY id",
    [tenant.id, receiptNo]
  );
  return { error: null, rows };
}

/**
 * Edit options for a payment transaction. New single-due-date receipts (one
 * row) use `coveredDueDate`; legacy multi-row receipts keep `months`.
 */
export interface PaymentEditOptions {
  method: string;
  /** ISO "YYYY-MM-DD" — freely editable (no future/move-in constraints). */
  paidDate: string;
  /** Covered month count — legacy multi-row receipts only. */
  months?: number;
  /** Covered due date — new single-due-date receipts only. */
  coveredDueDate?: string;
}

/**
 * Build the replacement row for an edited NEW-STYLE single-due-date payment
 * (payment-due-date-spec.md §6.4). The one row is rewritten with the new paid
 * date, covered due date (recomputes `covers_month`), and method; the amount
 * stays locked to one month's rate and the receipt number is kept.
 */
export function buildSinglePaymentEditRows(
  current: PaymentRow[],
  rate: number,
  receiptNo: string,
  opts: { paidDate: string; coveredDueDate: string; method: string }
): { error: string | null; rows: PaymentRow[] } {
  if (current.length === 0) return { error: "Payment not found.", rows: [] };
  if (current.length > 1) return { error: "This receipt covers multiple months — edit it as a legacy transaction.", rows: [] };
  return {
    error: null,
    rows: [
      {
        // id is a placeholder; updatePayment re-selects the inserted rows.
        id: 0,
        amount: rate,
        paid_date: opts.paidDate,
        due_date: opts.coveredDueDate,
        covers_month: monthKeyOf(opts.coveredDueDate),
        method: opts.method,
        receipt_no: receiptNo,
      },
    ],
  };
}

/**
 * Build the replacement rows for an edited LEGACY multi-month receipt (pure —
 * the DB wrapper `updatePayment` applies them). Rules per payment-edit-spec.md
 * (kept for backward compatibility, payment-due-date-spec.md §6.4):
 * - Same receipt number is kept.
 * - `covers_month` extends/shrinks from the transaction's original anchor
 *   month (a payment can cover more/fewer months, but never moves months).
 * - Due dates shift the transaction's original last due date by the
 *   month-count delta (later payments are NOT re-chained).
 * - Amount is one month's rate (full payment only — no partials).
 */
export function buildPaymentEditRows(
  current: PaymentRow[],
  rate: number,
  receiptNo: string,
  opts: { months: number; method: string; paidDate: string }
): { error: string | null; rows: PaymentRow[] } {
  if (current.length === 0) return { error: "Payment not found.", rows: [] };
  if (opts.months < 1) return { error: "At least one month must be covered.", rows: [] };

  const oldMonths = current.length;
  const anchorMonth = current[0].covers_month ?? monthKeyOf(current[0].paid_date);
  const originalLastDue = current[current.length - 1].due_date;
  const newLastDue = addMonths(originalLastDue, opts.months - oldMonths);

  const rows: PaymentRow[] = [];
  for (let i = 0; i < opts.months; i++) {
    rows.push({
      // id is a placeholder; updatePayment re-selects the inserted rows.
      id: 0,
      amount: rate,
      paid_date: opts.paidDate,
      due_date: addMonths(newLastDue, i - (opts.months - 1)),
      covers_month: addMonthsKey(anchorMonth, i),
      method: opts.method,
      receipt_no: receiptNo,
    });
  }
  return { error: null, rows };
}

/** A tenant's fields the held-balance apply action needs. */
export interface HeldApplyTarget {
  id: number;
  due_date: string;
  monthly_rate: number | null;
  advance_held: number;
  deposit_held: number;
}

/** Options for applying held balance to one due date. */
export interface HeldApplyOptions {
  /** "YYYY-MM-DD" — the specific due date this application settles. */
  coveredDueDate: string;
  /**
   * Explicit next due date for the tenant; when omitted, the tenant's due
   * date advances to `coveredDueDate + 1 month` only when the coverage is at
   * or past the current due date (payment-due-date-spec.md §6.3).
   */
  nextDueDate?: string;
}

/**
 * Apply held balance to cover one specific due date (held-balance-spec.md
 * §5.3, payment-due-date-spec.md §6.3). Whole month only (rate × 1, full
 * amount must fit). The advance pot is consumed first, then the deposit.
 * Creates one payment row with method 'Held balance' and a fresh receipt
 * number. Returns the receipt rows, or an error message.
 */
export async function applyHeldBalance(
  db: Database,
  tenant: HeldApplyTarget,
  roomRate: number,
  opts: HeldApplyOptions
): Promise<{ error: string | null; rows: PaymentRow[] }> {
  const rate = tenant.monthly_rate ?? roomRate;
  const check = validateApply({
    rate,
    coveredDueDate: opts.coveredDueDate,
    dueDate: tenant.due_date,
    advanceHeld: tenant.advance_held ?? 0,
    depositHeld: tenant.deposit_held ?? 0,
  });
  if (check.error) return { error: check.error, rows: [] };

  const receiptNo = await nextReceiptNo(db);
  const { advanceUsed, depositUsed } = splitConsumption(
    tenant.advance_held ?? 0,
    tenant.deposit_held ?? 0,
    check.amount
  );
  await db.execute(
    "UPDATE tenants SET advance_held = advance_held - $1, deposit_held = deposit_held - $2, last_paid_date = $3 WHERE id = $4",
    [advanceUsed, depositUsed, todayIso(), tenant.id]
  );

  await db.execute(
    "INSERT INTO payments (tenant_id, amount, paid_date, due_date, covers_month, method, receipt_no) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [tenant.id, rate, todayIso(), opts.coveredDueDate, monthKeyOf(opts.coveredDueDate), "Held balance", receiptNo]
  );

  // Only coverage at/past the current due month moves the due date.
  if (check.newDue) {
    await db.execute("UPDATE tenants SET due_date = $1 WHERE id = $2", [opts.nextDueDate ?? check.newDue, tenant.id]);
  }

  const rows = await db.select<PaymentRow[]>(
    "SELECT id, amount, paid_date, due_date, covers_month, method, receipt_no FROM payments WHERE tenant_id=$1 AND receipt_no=$2 ORDER BY id",
    [tenant.id, receiptNo]
  );
  return { error: null, rows };
}

/**
 * Edit a recorded payment transaction (all rows sharing one receipt number).
 * New single-due-date receipts (one row) are edited directly; legacy
 * multi-row receipts keep the anchor-month behavior. The tenant's `last_paid_date`
 * is recomputed as the latest paid date across their payments; `due_date` is
 * left alone — it is landlord-managed now (set at pay time), so editing a
 * payment must not clobber a manual due-date reset. Returns the fresh receipt
 * rows, or an error message.
 */
export async function updatePayment(
  db: Database,
  tenant: TenantActionTarget,
  roomRate: number,
  receiptNo: string,
  opts: PaymentEditOptions
): Promise<{ error: string | null; rows: PaymentRow[] }> {
  const current = await db.select<PaymentRow[]>(
    "SELECT id, amount, paid_date, due_date, covers_month, method, receipt_no FROM payments WHERE tenant_id=$1 AND receipt_no=$2 ORDER BY id",
    [tenant.id, receiptNo]
  );

  // Amount validates against the tenant's CURRENT rate (per interview).
  const rate = tenant.monthly_rate ?? roomRate;
  const built =
    current.length === 1
      ? (opts.coveredDueDate
          ? buildSinglePaymentEditRows(current, rate, receiptNo, {
              paidDate: opts.paidDate,
              coveredDueDate: opts.coveredDueDate,
              method: opts.method,
            })
          : { error: "Covered due date is required.", rows: [] })
      : buildPaymentEditRows(current, rate, receiptNo, {
          months: opts.months ?? current.length,
          method: opts.method,
          paidDate: opts.paidDate,
        });
  if (built.error) return built;

  // Rewrite the transaction in place (same receipt number).
  await db.execute("DELETE FROM payments WHERE tenant_id=$1 AND receipt_no=$2", [tenant.id, receiptNo]);
  for (const row of built.rows) {
    await db.execute(
      "INSERT INTO payments (tenant_id, amount, paid_date, due_date, covers_month, method, receipt_no) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [tenant.id, row.amount, row.paid_date, row.due_date, row.covers_month, row.method, row.receipt_no]
    );
  }

  // last paid = latest paid date (a freely-editable paid date can set either
  // direction); the due date is NOT auto-clobbered (landlord-managed).
  await db.execute(
    `UPDATE tenants SET
       last_paid_date = COALESCE((SELECT MAX(paid_date) FROM payments WHERE tenant_id=$1), last_paid_date)
     WHERE id=$2`,
    [tenant.id, tenant.id]
  );

  const rows = await db.select<PaymentRow[]>(
    "SELECT id, amount, paid_date, due_date, covers_month, method, receipt_no FROM payments WHERE tenant_id=$1 AND receipt_no=$2 ORDER BY id",
    [tenant.id, receiptNo]
  );
  return { error: null, rows };
}

/** Mark a tenant as moved out today. Their record stays in the Archived view. */
export async function markMovedOut(db: Database, tenantId: number): Promise<void> {
  await db.execute("UPDATE tenants SET moved_out_date=$1 WHERE id=$2", [todayIso(), tenantId]);
}

/**
 * Mark a tenant's deposit as refunded: the deposit pot is returned to the
 * tenant (deposit_held → 0). Advance money is never refundable, so
 * `advance_held` is left untouched.
 */
export async function refundDeposit(db: Database, tenantId: number): Promise<void> {
  await db.execute("UPDATE tenants SET deposit_refunded=1, deposit_held=0 WHERE id=$1", [tenantId]);
}