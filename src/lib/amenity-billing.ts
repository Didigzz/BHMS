/**
 * Quick-pick amenity names shown above the form's name field. These are
 * suggestions, not a schema enum: a bill is a free-text `amenity_name` plus
 * optional notes, so "Cable TV" or "Generator share" is just as valid
 * (amenity-billing-spec.md §7.1, decision #20).
 */
export const AMENITY_PRESETS = [
  "Electricity",
  "Water",
  "Internet",
  "Gas",
  "Air-conditioning",
  "Parking",
  "Maintenance",
  "Cleaning",
  "Other",
] as const;

export type BillingMethod = "shared" | "per_room" | "connected";
export type DivisionMode = "auto" | "manual";

/**
 * Locked, user-facing validation messages (amenity-billing-spec.md §12).
 * Single source of truth: the actions and every form surface read them here
 * rather than re-typing the strings (spec todo T10).
 */
export const AMENITY_MESSAGES = {
  name: "Amenity name is required.",
  amount: "Bill amount cannot be empty or negative.",
  selection: "At least one tenant or room must be selected.",
  exclusionReason: "An exclusion reason is required when excluding a tenant.",
  connectedRooms: "Connected-room groups must contain at least two rooms.",
  period: "Billing period must be a month like 2026-09.",
  roomEmpty: "Room has no active tenants",
  meterEnd: "Meter end cannot be less than start.",
  meterPrice: "Price per unit cannot be negative.",
  negativeAmount: "Manual tenant amounts cannot be negative.",
} as const;

/** Shares may run this far under the bill total; the landlord absorbs it (§8.1). */
export const MAX_ABSORBED = 1;

export function manualMismatchMessage(sum: number, total: number): string {
  return `Manual tenant amounts must equal the total bill (currently ${round2(sum)} vs ${round2(total)}).`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Round down to centavos. Automatic splits floor every share so the shares can
 * never exceed the bill total — the leftover fraction (always < ₱1) is the
 * landlord's cost (amenity-billing-spec.md §8.1, decision #25).
 */
export function floor2(n: number): number {
  return Math.floor(n * 100 + 1e-6) / 100;
}

/** Each share floored to 2dp; the caller absorbs `total − sum(shares)`. */
export function calculateEqualShares(total: number, count: number): number[] {
  if (count <= 0) return [];
  const per = floor2(total / count);
  return Array(count).fill(per) as number[];
}

export interface SharedSplitInput {
  total: number;
  tenantIds: number[];
  excluded: Map<number, string>;
  manualOverrides: Map<number, number>;
}

export interface SplitResult {
  shares: Map<number, number>;
  errors: string[];
  /** Bill total − sum of shares; always ≥ 0 and < ₱1. */
  absorbed: number;
}

function finish(shares: Map<number, number>, total: number, errors: string[]): SplitResult {
  let sum = 0;
  for (const value of shares.values()) sum = round2(sum + value);
  return { shares, errors, absorbed: round2(Math.max(0, round2(total - sum))) };
}

/** Equal split across `ids` (all of them), floored to centavos. */
function splitEqually(ids: number[], total: number): SplitResult {
  const shares = new Map<number, number>();
  const parts = calculateEqualShares(total, ids.length);
  ids.forEach((id, index) => shares.set(id, parts[index]));
  return finish(shares, total, []);
}

/**
 * Manual split: tenants with an override keep their amount, and the remainder
 * is re-split equally across the rest. With every tenant overridden the sum
 * must equal the total within the ₱1 absorption window.
 */
function splitManual(
  ids: number[],
  total: number,
  overrides: Map<number, number>,
  errors: string[],
): SplitResult {
  const shares = new Map<number, number>();
  const defined = ids.filter((id) => overrides.has(id));
  const missing = ids.filter((id) => !overrides.has(id));

  let definedSum = 0;
  for (const id of defined) {
    const amount = round2(overrides.get(id) ?? 0);
    if (amount < 0) errors.push(AMENITY_MESSAGES.negativeAmount);
    shares.set(id, amount);
    definedSum = round2(definedSum + amount);
  }

  if (missing.length > 0) {
    const remaining = round2(total - definedSum);
    if (remaining < -0.005) {
      errors.push(manualMismatchMessage(definedSum, total));
    } else {
      const parts = calculateEqualShares(remaining, missing.length);
      missing.forEach((id, index) => shares.set(id, parts[index]));
    }
  } else {
    const shortfall = round2(total - definedSum);
    if (shortfall < -0.005 || shortfall > MAX_ABSORBED + 0.005) {
      errors.push(manualMismatchMessage(definedSum, total));
    }
  }

  return finish(shares, total, errors);
}

/**
 * Shared Billing split. Excluded tenants are NOT part of `shares` — they are
 * carried separately as `is_excluded` rows with a reason and a ₱0 charge
 * (amenity-billing-spec.md §7.2, delta D5).
 */
export function calcSharedSplit(input: SharedSplitInput): SplitResult {
  const errors: string[] = [];
  const included = input.tenantIds.filter((id) => !input.excluded.has(id));

  for (const [id, reason] of input.excluded) {
    if (!input.tenantIds.includes(id)) continue;
    if (!reason || reason.trim() === "") {
      errors.push(AMENITY_MESSAGES.exclusionReason);
      break;
    }
  }

  if (included.length === 0) {
    if (input.tenantIds.length > 0) errors.push(AMENITY_MESSAGES.selection);
    return { shares: new Map(), errors, absorbed: 0 };
  }

  const manualIds = included.filter((id) => input.manualOverrides.has(id));
  const autoIds = included.filter((id) => !input.manualOverrides.has(id));

  if (autoIds.length === 0 && manualIds.length > 0) {
    return splitManual(included, input.total, input.manualOverrides, errors);
  }

  const shares = new Map<number, number>();
  let manualSum = 0;
  for (const id of manualIds) {
    const amount = round2(input.manualOverrides.get(id) ?? 0);
    if (amount < 0) errors.push(AMENITY_MESSAGES.negativeAmount);
    shares.set(id, amount);
    manualSum = round2(manualSum + amount);
  }

  const remaining = round2(input.total - manualSum);
  if (remaining < -0.005) {
    errors.push(manualMismatchMessage(manualSum, input.total));
  } else {
    const parts = calculateEqualShares(remaining, autoIds.length);
    autoIds.forEach((id, index) => shares.set(id, parts[index]));
  }

  return finish(shares, input.total, errors);
}

/** Remainder preview while the landlord edits one amount at a time. */
export function recalcRemaining(
  total: number,
  overrides: Map<number, number>,
  includedIds: number[],
): Map<number, number> {
  return calcSharedSplit({
    total,
    tenantIds: includedIds,
    excluded: new Map(),
    manualOverrides: overrides,
  }).shares;
}

/**
 * Per-Room Billing split (Room-Specific Amenity). `roomTenantIds` are the
 * tenants currently occupying the selected room/pad.
 */
export function calcPerRoomSplit(
  roomTenantIds: number[],
  total: number,
  manualOverrides: Map<number, number>,
  mode: DivisionMode,
): SplitResult {
  if (roomTenantIds.length === 0) {
    return { shares: new Map(), errors: [AMENITY_MESSAGES.roomEmpty], absorbed: 0 };
  }
  if (mode === "auto") return splitEqually(roomTenantIds, total);
  return splitManual(roomTenantIds, total, manualOverrides, []);
}

/**
 * Connected Rooms / Joint Room Billing: the total divides across EVERY tenant
 * of all joined rooms — never per room first (amenity-billing-spec.md §7.4).
 */
export function calcConnectedSplit(
  pooledTenantIds: number[],
  total: number,
  manualOverrides: Map<number, number>,
  mode: DivisionMode,
): SplitResult {
  if (pooledTenantIds.length === 0) {
    return { shares: new Map(), errors: [AMENITY_MESSAGES.selection], absorbed: 0 };
  }
  if (mode === "auto") return splitEqually(pooledTenantIds, total);
  return splitManual(pooledTenantIds, total, manualOverrides, []);
}

export function calculateMeterTotal(
  start: number | null,
  end: number | null,
  pricePerUnit: number | null,
): { units: number | null; total: number | null; error: string | null } {
  if (start == null || end == null || pricePerUnit == null) {
    return { units: null, total: null, error: null };
  }
  if (pricePerUnit < 0) {
    return { units: null, total: null, error: AMENITY_MESSAGES.meterPrice };
  }
  if (end < start) {
    return { units: null, total: null, error: AMENITY_MESSAGES.meterEnd };
  }
  const units = round2(end - start);
  const total = round2(units * pricePerUnit);
  return { units, total, error: null };
}

/** Billing periods are month keys — `2026-09` — or empty for a date-only bill. */
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidBillingPeriod(input: string): boolean {
  return PERIOD_PATTERN.test(input.trim());
}

/** Trimmed period, or null when the landlord left it empty. */
export function normalizeBillingPeriod(input: string | null): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  return trimmed;
}

export function validateBillingPeriod(input: string | null): string | null {
  const period = normalizeBillingPeriod(input);
  if (period == null) return null;
  return isValidBillingPeriod(period) ? null : AMENITY_MESSAGES.period;
}

export interface ValidateBillInput {
  amenityName?: string;
  amount: number;
  tenantIds: number[];
  roomIds: number[];
  method: BillingMethod;
  divisionMode: DivisionMode;
  shares: Map<number, number>;
  billingPeriod?: string | null;
}

/** The one place every amenity-bill validation is decided (spec §12). */
export function validateBill(input: ValidateBillInput): string | null {
  if (input.amenityName != null && input.amenityName.trim() === "") {
    return AMENITY_MESSAGES.name;
  }
  if (!input.amount || isNaN(input.amount) || input.amount <= 0) {
    return AMENITY_MESSAGES.amount;
  }
  if (input.method === "shared" && input.tenantIds.length === 0) {
    return AMENITY_MESSAGES.selection;
  }
  if (
    (input.method === "per_room" || input.method === "connected") &&
    input.roomIds.length === 0
  ) {
    return AMENITY_MESSAGES.selection;
  }
  if (input.method === "connected" && input.roomIds.length < 2) {
    return AMENITY_MESSAGES.connectedRooms;
  }
  const periodError = validateBillingPeriod(input.billingPeriod ?? null);
  if (periodError) return periodError;
  if (input.divisionMode === "manual") {
    let sum = 0;
    for (const value of input.shares.values()) sum = round2(sum + value);
    const shortfall = round2(input.amount - sum);
    if (shortfall < -0.005 || shortfall > MAX_ABSORBED + 0.005) {
      return manualMismatchMessage(sum, input.amount);
    }
  }
  return null;
}

export function validateExclusionReason(isExcluded: boolean, reason: string | null): string | null {
  if (isExcluded && (!reason || reason.trim() === "")) {
    return AMENITY_MESSAGES.exclusionReason;
  }
  return null;
}
