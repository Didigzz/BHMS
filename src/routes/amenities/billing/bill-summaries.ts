import { round2 } from "$lib/amenities/amenity-billing";
import {
  summarizeBillPayments,
  type BillPaymentSummary,
} from "$lib/amenities/amenity-payments";
import type { AmenityBillRow, AmenityBillTenantRow } from "$lib/amenities/amenity-actions";

/** The payment sheet's target: one share, or every unpaid share on a bill. */
export type BillSheetState =
  | { mode: "record" | "void" | "date"; bill: AmenityBillRow; row: AmenityBillTenantRow }
  | { mode: "bulk"; bill: AmenityBillRow };

export function methodLabel(bill: AmenityBillRow): string {
  if (bill.billing_method === "shared") return "Shared Billing";
  if (bill.billing_method === "per_room") return "Per-Room Billing — Room-Specific Amenity";
  return "Connected Rooms — Joint Room Billing";
}

/**
 * Pure row aggregation for the amenity-bill list. The page keeps the cache and
 * the mutations; these functions only read bill details.
 */

export interface BillDetailsLike {
  tenants: AmenityBillTenantRow[];
  rooms: { room_number_snapshot: string }[];
}

export function summaryFor(details: BillDetailsLike | undefined): BillPaymentSummary {
  if (!details) return summarizeBillPayments([], []);
  const payments = details.tenants
    .filter((t) => t.payment_id != null)
    .map((t) => ({ bill_tenant_id: t.id, amount: t.amount, status: "active" }));
  return summarizeBillPayments(details.tenants, payments);
}

export function unpaidOn(details: BillDetailsLike | undefined): AmenityBillTenantRow[] {
  return (details?.tenants ?? []).filter(
    (t) => !t.is_excluded && t.amount > 0 && t.payment_id == null,
  );
}

export function unpaidTotal(details: BillDetailsLike | undefined): number {
  let total = 0;
  for (const share of unpaidOn(details)) total = round2(total + share.amount);
  return total;
}

export function editLocked(details: BillDetailsLike | undefined): boolean {
  return (details?.tenants ?? []).some((t) => t.payment_id != null);
}
