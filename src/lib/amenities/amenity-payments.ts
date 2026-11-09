/**
 * Pure amenity-payment helpers (amenity-payment-flow-spec.md §5.1).
 *
 * No DB, DOM, Svelte or Tauri imports: the actions, the sheet and the tests all
 * share these rules, and so does the Rust side (mirrored in
 * src-tauri/src/amenity.rs).
 */

export const AMENITY_PAYMENT_MESSAGES = {
  date: "Paid date must be a real date.",
  future: "Paid date cannot be in the future.",
  paymentExists: "This share is already marked paid.",
  paymentNotFound: "Payment not found.",
  paymentNotActive: "This payment has already been voided.",
  billCancelled: "Cancelled bills cannot take payments.",
  shareExcluded: "Excluded tenants have nothing to pay.",
  noCharge: "This share has no amount to collect.",
  noUnpaid: "Every share on this bill is already paid.",
  paidLocked: "This bill has recorded payments — void them before editing.",
  invalidStatus: "Invalid payment status.",
} as const;

export type AmenityPaymentSheetMode = "record" | "bulk" | "void" | "date";

/** `YYYY-MM-DD` for the device's local day (never UTC, so the phone's date wins). */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function parseIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Returns the locked message for a bad date, or null. The same rule the Rust
 * commands apply: a real calendar date, not after the caller's local today.
 */
export function validatePaidDate(value: string, today: string): string | null {
  if (!parseIsoDate(value) || !parseIsoDate(today)) return AMENITY_PAYMENT_MESSAGES.date;
  if (value > today) return AMENITY_PAYMENT_MESSAGES.future;
  return null;
}

export interface BillSharePayment {
  id: number;
  amount: number;
  is_excluded: number;
  payment_status: string;
}

export interface BillPaymentSummary {
  payableCount: number;
  paidCount: number;
  collected: number;
  payableTotal: number;
  allPaid: boolean;
}

/**
 * The bill-level summary. Only non-excluded shares above ₱0 are payable; the
 * ledger (active payments) decides what has been collected, so a stale
 * `payment_status` cannot make money appear twice.
 */
export function summarizeBillPayments(
  shares: BillSharePayment[],
  payments: { bill_tenant_id: number; amount: number; status: string }[],
): BillPaymentSummary {
  const payable = shares.filter((share) => !share.is_excluded && share.amount > 0);
  const payableIds = new Set(payable.map((share) => share.id));
  const active = payments.filter(
    (payment) => payment.status === "active" && payableIds.has(payment.bill_tenant_id),
  );
  const paidIds = new Set(active.map((payment) => payment.bill_tenant_id));

  let payableTotal = 0;
  for (const share of payable) payableTotal = round2(payableTotal + share.amount);
  let collected = 0;
  for (const payment of active) collected = round2(collected + payment.amount);

  const paidCount = payable.filter((share) => paidIds.has(share.id)).length;
  return {
    payableCount: payable.length,
    paidCount,
    collected,
    payableTotal,
    allPaid: payable.length > 0 && paidCount === payable.length,
  };
}

/** R6's three locked shapes. `formatPeso` is injected so this module stays pure. */
export function summaryLabel(
  summary: BillPaymentSummary,
  formatPeso: (amount: number) => string,
): string {
  if (summary.payableCount === 0) return "No payable shares";
  if (summary.payableCount === summary.paidCount) {
    return `All ${summary.payableCount} paid · ${formatPeso(summary.payableTotal)}`;
  }
  return `${summary.paidCount} of ${summary.payableCount} paid · ${formatPeso(
    summary.collected,
  )} of ${formatPeso(summary.payableTotal)}`;
}

/** One ledger row as the Payments tab and tenant history read it. */
export interface AmenityPaymentRow {
  id: number;
  bill_tenant_id: number;
  bill_id: number;
  tenant_id: number;
  amount: number;
  paid_date: string;
  status: "active" | "reversed";
  reversal_reason: string | null;
  reversed_at: string | null;
  amenity_name: string;
  billing_period: string | null;
  billing_date: string;
  bill_status: string;
  tenant_name_snapshot: string;
  room_number_snapshot: string;
}

export function activeOnly(rows: AmenityPaymentRow[]): AmenityPaymentRow[] {
  return rows.filter((row) => row.status === "active");
}

export function reversedOnly(rows: AmenityPaymentRow[]): AmenityPaymentRow[] {
  return rows.filter((row) => row.status === "reversed");
}

export function sumActive(rows: AmenityPaymentRow[]): number {
  let total = 0;
  for (const row of activeOnly(rows)) total = round2(total + row.amount);
  return total;
}

export function sumReversed(rows: AmenityPaymentRow[]): number {
  let total = 0;
  for (const row of reversedOnly(rows)) total = round2(total + row.amount);
  return total;
}

/** The rent groups PaymentHistoryModal already builds, narrowed to what a merged row needs. */
export interface RentHistoryGroup {
  receipt_no: string;
  paid_date: string;
  first_month: string | null;
  last_month: string | null;
  due_date: string;
  total: number;
  method: string;
  count: number;
}

export type HistoryRow =
  | { kind: "rent"; paidDate: string; group: RentHistoryGroup }
  | { kind: "amenity"; paidDate: string; payment: AmenityPaymentRow };

/**
 * One chronological list, newest first. Ties keep the incoming order (rent
 * groups already arrive newest-first), which keeps the merged view stable
 * without inventing a second sort key.
 */
export function buildHistoryRows(
  rentGroups: RentHistoryGroup[],
  amenityRows: AmenityPaymentRow[],
): HistoryRow[] {
  const rows: HistoryRow[] = [
    ...rentGroups.map((group) => ({ kind: "rent" as const, paidDate: group.paid_date, group })),
    ...amenityRows.map((payment) => ({
      kind: "amenity" as const,
      paidDate: payment.paid_date,
      payment,
    })),
  ];
  return rows.sort((a, b) =>
    a.paidDate === b.paidDate ? 0 : a.paidDate < b.paidDate ? 1 : -1,
  );
}
