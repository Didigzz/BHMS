/**
 * Receipt-grouped rent payments (billing-features-spec.md §5).
 *
 * An advance payment for several months is one row per covered month in the DB
 * but one receipt transaction in the UI. Grouping lives here so the tenant
 * Payment History modal and the room detail sheet share one query — a schema
 * change to `payments` used to need two identical edits.
 */

import type { PaymentRecord } from "$lib/tenants/types";

/** One receipt transaction, as both history views render it. */
export interface PaymentGroup {
  receipt_no: string;
  paid_date: string;
  first_month: string | null;
  last_month: string | null;
  /** Newest due date across the receipt's rows (the covered due date for new-style single payments). */
  due_date: string;
  total: number;
  method: string;
  count: number;
}

/** The slice of the tauri-plugin-sql handle these helpers need. */
export interface PaymentDb {
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}

/** Every receipt for a tenant, newest first. */
export async function groupReceipts(db: PaymentDb, tenantId: number): Promise<PaymentGroup[]> {
  return db.select<PaymentGroup[]>(
    `SELECT receipt_no,
            MIN(paid_date) AS paid_date,
            MIN(covers_month) AS first_month,
            MAX(covers_month) AS last_month,
            MAX(due_date) AS due_date,
            SUM(amount) AS total,
            MAX(method) AS method,
            COUNT(*) AS count
     FROM payments WHERE tenant_id=$1
     GROUP BY receipt_no
     ORDER BY MAX(id) DESC`,
    [tenantId]
  );
}

/** One receipt's underlying month rows (edit / receipt / apply flows). */
export async function loadReceiptRows(
  db: PaymentDb,
  tenantId: number,
  receiptNo: string
): Promise<PaymentRecord[]> {
  return db.select<PaymentRecord[]>(
    "SELECT id, amount, paid_date, due_date, covers_month, method, receipt_no FROM payments WHERE tenant_id=$1 AND receipt_no=$2 ORDER BY id",
    [tenantId, receiptNo]
  );
}
