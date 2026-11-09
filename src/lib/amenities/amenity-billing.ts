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
  manualExceeds: "Manual amounts cannot be more than the total bill.",
  manualTakesAll: "The other tenants will have ₱0 shares.",
} as const;

/** Shares may run this far under the bill total; the landlord absorbs it (§8.1). */
export const MAX_ABSORBED = 1;

export function manualMismatchMessage(sum: number, total: number): string {
  return `Manual tenant amounts must equal the total bill (currently ${round2(sum)} vs ${round2(total)}).`;
}

export function manualExceedsMessage(sum: number, total: number): string {
  return `Manual amounts cannot be more than the total bill (${round2(sum)} of ${round2(total)}).`;
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

/**
 * The one split every billing method shares: tenants with a manual amount keep
 * it, and the remainder is re-split equally across the tenants without one
 * (amenity-manual-split-spec.md §3.2). With every tenant manual the amounts
 * must add up to the total within the ₱1 absorption window.
 */
export function splitWithManual(
  ids: number[],
  total: number,
  overrides: Map<number, number>,
): SplitResult {
  const errors: string[] = [];
  const shares = new Map<number, number>();
  if (ids.length === 0) return { shares, errors, absorbed: 0 };

  const manualIds = ids.filter((id) => overrides.has(id));
  const autoIds = ids.filter((id) => !overrides.has(id));

  let manualSum = 0;
  for (const id of manualIds) {
    const amount = round2(overrides.get(id) ?? 0);
    if (!Number.isFinite(amount) || amount < 0) {
      errors.push(AMENITY_MESSAGES.negativeAmount);
      continue;
    }
    shares.set(id, amount);
    manualSum = round2(manualSum + amount);
  }

  const remaining = round2(total - manualSum);
  if (remaining < -0.005) {
    errors.push(manualExceedsMessage(manualSum, total));
    return finish(shares, total, errors);
  }

  if (autoIds.length === 0) {
    if (remaining > MAX_ABSORBED + 0.005) {
      errors.push(manualMismatchMessage(manualSum, total));
    }
    return finish(shares, total, errors);
  }

  const parts = calculateEqualShares(remaining, autoIds.length);
  autoIds.forEach((id, index) => shares.set(id, parts[index]));
  return finish(shares, total, errors);
}

/** Total of the manual amounts among `ids`, rounded to 2dp. */
export function manualSumOf(ids: number[], overrides: Map<number, number>): number {
  let sum = 0;
  for (const id of ids) if (overrides.has(id)) sum = round2(sum + (overrides.get(id) ?? 0));
  return sum;
}

/** True when a manual amount leaves at least one automatic tenant on ₱0. */
export function hasZeroAutoShare(
  ids: number[],
  overrides: Map<number, number>,
  total: number,
): boolean {
  if (overrides.size === 0) return false;
  const autoIds = ids.filter((id) => !overrides.has(id));
  if (autoIds.length === 0) return false;
  const remaining = round2(total - manualSumOf(ids, overrides));
  if (remaining <= 0) return true;
  return floor2(remaining / autoIds.length) === 0;
}

/** The manual-amount rules shared by the form and the save path (spec §3.3). */
export function validateManualAmounts(
  total: number,
  tenantIds: number[],
  manualShares: Map<number, number>,
): string | null {
  if (manualShares.size === 0) return null;

  // Only amounts on tenants that are still on the bill count — a stale entry
  // from a previous room or selection must not block the save.
  const relevant = tenantIds.filter((id) => manualShares.has(id));
  if (relevant.length === 0) return null;

  let sum = 0;
  for (const id of relevant) {
    const value = manualShares.get(id) ?? 0;
    if (!Number.isFinite(value) || value < 0) return AMENITY_MESSAGES.negativeAmount;
    sum = round2(sum + value);
  }

  if (sum > round2(total) + 0.005) return manualExceedsMessage(sum, total);

  const covered = relevant.length;
  if (tenantIds.length > 0 && covered === tenantIds.length) {
    const shortfall = round2(total - sum);
    if (shortfall > MAX_ABSORBED + 0.005) return manualMismatchMessage(sum, total);
  }

  return null;
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

  const split = splitWithManual(included, input.total, input.manualOverrides);
  return { ...split, errors: [...errors, ...split.errors] };
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
  _mode: DivisionMode,
): SplitResult {
  if (roomTenantIds.length === 0) {
    return { shares: new Map(), errors: [AMENITY_MESSAGES.roomEmpty], absorbed: 0 };
  }
  return splitWithManual(roomTenantIds, total, manualOverrides);
}

/**
 * Connected Rooms / Joint Room Billing: the total divides across EVERY tenant
 * of all joined rooms — never per room first (amenity-billing-spec.md §7.4).
 */
export function calcConnectedSplit(
  pooledTenantIds: number[],
  total: number,
  manualOverrides: Map<number, number>,
  _mode: DivisionMode,
): SplitResult {
  if (pooledTenantIds.length === 0) {
    return { shares: new Map(), errors: [AMENITY_MESSAGES.selection], absorbed: 0 };
  }
  return splitWithManual(pooledTenantIds, total, manualOverrides);
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

/**
 * `bind:value` on `<input type="number">` writes `null` when the field is
 * emptied and a number as soon as anything is typed, so a form field that
 * starts life as a string can arrive here as either. Blank and unparsable
 * both mean "not set"; a real 0 survives.
 */
export function parseOptionalNumber(raw: string | number | null | undefined): number | null {
  const text = typeof raw === "string" ? raw.trim() : raw;
  if (text == null || text === "") return null;
  const value = typeof text === "number" ? text : Number(text);
  return Number.isFinite(value) ? value : null;
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
  /** Only the shares the landlord pinned by hand (spec §5.1 R7). */
  manualShares?: Map<number, number>;
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
  if (input.manualShares && input.manualShares.size > 0) {
    const manualError = validateManualAmounts(
      input.amount,
      input.tenantIds,
      input.manualShares,
    );
    if (manualError) return manualError;
  }
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
