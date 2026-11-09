import {
  AMENITY_MESSAGES,
  manualExceedsMessage,
  manualMismatchMessage,
  round2,
  validateBill,
  validateExclusionReason,
  type BillingMethod,
  type DivisionMode,
} from "./amenity-billing";
import type { AmenityBillPayload, CreateAmenityBillInput } from "./types";

export const ERROR_MESSAGES: Record<string, string> = {
  "amenity:name": AMENITY_MESSAGES.name,
  "amenity:amount": AMENITY_MESSAGES.amount,
  "amenity:selection": AMENITY_MESSAGES.selection,
  "amenity:exclusion-reason": AMENITY_MESSAGES.exclusionReason,
  "amenity:connected-rooms": AMENITY_MESSAGES.connectedRooms,
  "amenity:negative-amount": AMENITY_MESSAGES.negativeAmount,
  "amenity:manual-exceeds": AMENITY_MESSAGES.manualExceeds,
  "amenity:not-found": "Bill not found.",
  "amenity:cancelled": "Cancelled bills cannot be edited.",
  "amenity:already-cancelled": "Already cancelled.",
  "amenity:paid-locked": "This bill has recorded payments — void them before editing.",
};

export function translateError(error: unknown, input?: CreateAmenityBillInput): string {
  const text = error instanceof Error ? error.message : String(error);
  // The money message needs the offending numbers, so it is built here from
  // the same locked builder the validators use (spec §12, todo T10).
  if (text.includes("amenity:manual-exceeds") && input) {
    let sum = 0;
    const ids = input.manualIds ?? [];
    for (const id of ids) sum = round2(sum + (input.tenantShares.get(id) ?? 0));
    return manualExceedsMessage(sum, input.total_amount);
  }
  if (text.includes("amenity:manual-sum") && input) {
    let sum = 0;
    for (const value of input.tenantShares.values()) sum = round2(sum + value);
    return manualMismatchMessage(sum, input.total_amount);
  }
  for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
    if (text.includes(code)) return message;
  }
  return text;
}

/** The single validation gate both the Tauri and browser paths go through. */
export function validateInput(input: CreateAmenityBillInput): string | null {
  for (const [, reason] of input.excluded) {
    const reasonError = validateExclusionReason(true, reason);
    if (reasonError) return reasonError;
  }
  const manualShares = new Map<number, number>();
  for (const id of input.manualIds ?? []) {
    const amount = input.tenantShares.get(id);
    if (amount != null) manualShares.set(id, amount);
  }
  return validateBill({
    amenityName: input.amenity_name,
    amount: input.total_amount,
    tenantIds: [...input.tenantShares.keys()],
    roomIds: input.roomIds,
    method: input.billing_method as BillingMethod,
    divisionMode: input.division_mode as DivisionMode,
    shares: input.tenantShares,
    manualShares,
    billingPeriod: input.billing_period ?? null,
  });
}

export function toPayload(input: CreateAmenityBillInput, billId: number | null): AmenityBillPayload {
  return {
    bill_id: billId,
    amenity_name: input.amenity_name.trim(),
    billing_method: input.billing_method,
    total_amount: input.total_amount,
    billing_date: input.billing_date,
    billing_period: input.billing_period ?? null,
    notes: input.notes ?? null,
    division_mode: input.division_mode,
    meter_start: input.meter_start ?? null,
    meter_end: input.meter_end ?? null,
    price_per_unit: input.price_per_unit ?? null,
    tenants: [...input.tenantShares.entries()].map(([tenant_id, amount]) => ({
      tenant_id,
      amount,
      is_manual: (input.manualIds ?? []).includes(tenant_id),
    })),
    excluded: [...input.excluded.entries()].map(([tenant_id, reason]) => ({
      tenant_id,
      reason,
    })),
    room_ids: input.roomIds,
  };
}
