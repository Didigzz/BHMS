import { checkDuplicateAmenity, createAmenityBill, findConnectedRoomOverlap, updateAmenityBill } from "$lib/amenities/amenity-actions";
import { validateBill, validateExclusionReason } from "$lib/amenities/amenity-billing";
import type { BillingMethod, DivisionMode } from "./bill-form-types";

export type SaveOutcome =
  | { status: "saved" }
  | { status: "error"; message: string }
  /** Duplicate needs a second confirmation: the landlord may proceed anyway. */
  | { status: "duplicate"; message: string }
  /** Connected-room overlap also needs the landlord's explicit go-ahead. */
  | { status: "overlap"; messages: string[] };

export interface BillSaveInput {
  amenityName: string;
  method: BillingMethod;
  total: number;
  billingDate: string;
  billingPeriod: string;
  notes: string;
  divisionMode: DivisionMode;
  shares: Map<number, number>;
  /** Only the shares pinned to a manual amount (spec §3.2). */
  manualIds: number[];
  excluded: Map<number, string>;
  roomIds: number[];
  meterStart: number | null;
  meterEnd: number | null;
  pricePerUnit: number | null;
  editingId: number | null;
  /** The landlord already answered "create another anyway?". */
  allowDuplicate: boolean;
  /** The landlord already answered "add it anyway?" for overlapping rooms. */
  allowOverlap: boolean;
  /** Runs right before the write, so the sheet can lock its buttons only then. */
  onWrite?: () => void;
}

/**
 * Validate, de-duplicate and write an amenity bill. Split out of the sheet so
 * the ordering (reasons → required fields → duplicate → overlap → write) can be
 * tested without rendering the form.
 */
export async function saveAmenityBill(
  db: Parameters<typeof checkDuplicateAmenity>[0],
  input: BillSaveInput,
): Promise<SaveOutcome> {
  for (const [, reason] of input.excluded) {
    const reasonError = validateExclusionReason(true, reason);
    if (reasonError) return { status: "error", message: reasonError };
  }

  const manualShares = new Map<number, number>();
  for (const id of input.manualIds) {
    const amount = input.shares.get(id);
    if (amount != null) manualShares.set(id, amount);
  }

  const invalid = validateBill({
    amenityName: input.amenityName,
    amount: input.total,
    tenantIds: [...input.shares.keys()],
    roomIds: input.roomIds,
    method: input.method,
    divisionMode: input.divisionMode,
    shares: input.shares,
    manualShares,
    billingPeriod: input.billingPeriod || null,
  });
  if (invalid) return { status: "error", message: invalid };

  const period = input.billingPeriod || null;

  if (!input.allowDuplicate) {
    const dup = await checkDuplicateAmenity(db, input.amenityName, period, input.editingId ?? undefined);
    if (dup) {
      return {
        status: "duplicate",
        message: `A ${input.amenityName} bill for ${period} already exists — create another anyway?`,
      };
    }
  }

  if (input.method === "connected" && !input.allowOverlap) {
    const overlaps = await findConnectedRoomOverlap(db, input.amenityName, period, input.roomIds, input.editingId ?? undefined);
    if (overlaps.length > 0) {
      return {
        status: "overlap",
        messages: overlaps.map((room) => `${room.room_number} is already on "${room.amenity_name}" for this period`),
      };
    }
  }

  input.onWrite?.();
  const result = input.editingId
    ? await updateAmenityBill(db, input.editingId, {
        amenity_name: input.amenityName,
        billing_method: input.method,
        total_amount: input.total,
        billing_date: input.billingDate,
        billing_period: period,
        notes: input.notes || null,
        division_mode: input.divisionMode,
        tenantShares: input.shares,
        manualIds: input.manualIds,
        excluded: input.excluded,
        roomIds: input.roomIds,
        meter_start: input.meterStart ?? undefined,
        meter_end: input.meterEnd ?? undefined,
        price_per_unit: input.pricePerUnit ?? undefined,
      })
    : await createAmenityBill(db, {
        amenity_name: input.amenityName,
        billing_method: input.method,
        total_amount: input.total,
        billing_date: input.billingDate,
        billing_period: period,
        notes: input.notes || null,
        division_mode: input.divisionMode,
        tenantShares: input.shares,
        manualIds: input.manualIds,
        excluded: input.excluded,
        roomIds: input.roomIds,
        meter_start: input.meterStart ?? undefined,
        meter_end: input.meterEnd ?? undefined,
        price_per_unit: input.pricePerUnit ?? undefined,
      });

  if (result.error) return { status: "error", message: result.error };
  return { status: "saved" };
}
