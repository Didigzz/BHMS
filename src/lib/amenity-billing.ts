export const AMENITY_TYPES = [
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
export type AmenityType = (typeof AMENITY_TYPES)[number];
export type BillingMethod = "shared" | "per_room" | "connected";
export type DivisionMode = "auto" | "manual";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculateEqualShares(
  total: number,
  count: number,
): number[] {
  if (count <= 0) return [];
  const per = round2(total / count);
  const shares = Array(count).fill(per) as number[];
  const sum = round2(per * count);
  const diff = round2(total - sum);
  shares[count - 1] = round2(shares[count - 1] + diff);
  return shares;
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
}

export function calcSharedSplit(input: SharedSplitInput): SplitResult {
  const errors: string[] = [];
  const included = input.tenantIds.filter((id) => !input.excluded.has(id));

  for (const [id, reason] of input.excluded) {
    if (!input.tenantIds.includes(id)) continue;
    if (!reason || reason.trim() === "") {
      errors.push(`An exclusion reason is required when excluding a tenant.`);
      break;
    }
  }

  if (included.length === 0 && input.tenantIds.length > 0) {
    return { shares: new Map(), errors };
  }

  const shares = new Map<number, number>();

  for (const id of input.tenantIds) {
    if (input.excluded.has(id)) {
      shares.set(id, 0);
    }
  }

  let manualSum = 0;
  const manualIds: number[] = [];
  for (const [id, amt] of input.manualOverrides) {
    if (!included.includes(id)) continue;
    if (amt < 0) errors.push("Manual tenant amounts must equal the total bill");
    manualSum = round2(manualSum + amt);
    manualIds.push(id);
  }

  if (manualSum > input.total + 0.005) {
    errors.push(
      `Manual tenant amounts must equal the total bill (currently ${manualSum} vs ${input.total}).`,
    );
  }

  const autoIds = included.filter((id) => !input.manualOverrides.has(id));
  const remaining = round2(input.total - manualSum);

  if (autoIds.length > 0) {
    if (remaining < -0.005) {
      errors.push(
        `Manual tenant amounts must equal the total bill (currently ${manualSum} vs ${input.total}).`,
      );
    } else {
      const autoShares = calculateEqualShares(remaining, autoIds.length);
      autoIds.forEach((id, idx) => shares.set(id, autoShares[idx]));
    }
  } else if (manualIds.length > 0) {
    if (Math.abs(manualSum - input.total) > 0.01) {
      errors.push(
        `Manual tenant amounts must equal the total bill (currently ${manualSum} vs ${input.total}).`,
      );
    }
  }

  for (const id of manualIds) {
    shares.set(id, round2(input.manualOverrides.get(id) ?? 0));
  }

  if (input.excluded.size === 0 && input.manualOverrides.size === 0 && included.length > 0) {
    const autoShares = calculateEqualShares(input.total, included.length);
    included.forEach((id, idx) => shares.set(id, autoShares[idx]));
  }

  return { shares, errors };
}

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

export function calcPerRoomSplit(
  roomTenantIds: number[],
  total: number,
  manualOverrides: Map<number, number>,
  mode: DivisionMode,
): SplitResult {
  const errors: string[] = [];
  if (roomTenantIds.length === 0) {
    errors.push("Room has no active tenants");
    return { shares: new Map(), errors };
  }
  if (mode === "auto") {
    const shares = calculateEqualShares(total, roomTenantIds.length);
    const map = new Map<number, number>();
    roomTenantIds.forEach((id, idx) => map.set(id, shares[idx]));
    return { shares: map, errors };
  }
  let manualSum = 0;
  for (const id of roomTenantIds) {
    manualSum = round2(manualSum + (manualOverrides.get(id) ?? 0));
  }
  const defined = roomTenantIds.filter((id) => manualOverrides.has(id));
  if (defined.length > 0 && Math.abs(manualSum - total) > 0.01) {
    const missing = roomTenantIds.filter((id) => !manualOverrides.has(id));
    if (missing.length === 0) {
      errors.push(
        `Manual tenant amounts must equal the total bill (currently ${manualSum} vs ${total}).`,
      );
    } else {
      const remaining = round2(total - manualSum + missing.reduce((a, id) => a + (manualOverrides.get(id) ?? 0), 0));
      // For partial manual, recalc missing
      const remainingManual = new Map<number, number>();
      let sumDefined = 0;
      for (const id of defined) {
        const v = manualOverrides.get(id) ?? 0;
        remainingManual.set(id, v);
        sumDefined = round2(sumDefined + v);
      }
      const rem = round2(total - sumDefined);
      const autoShares = calculateEqualShares(rem, missing.length);
      missing.forEach((id, idx) => remainingManual.set(id, autoShares[idx]));
      return { shares: remainingManual, errors };
    }
  }
  const map = new Map<number, number>();
  for (const id of roomTenantIds) map.set(id, round2(manualOverrides.get(id) ?? 0));
  return { shares: map, errors };
}

export function calcConnectedSplit(
  pooledTenantIds: number[],
  total: number,
  manualOverrides: Map<number, number>,
  mode: DivisionMode,
): SplitResult {
  const errors: string[] = [];
  if (pooledTenantIds.length === 0) {
    errors.push("At least one tenant or room must be selected.");
    return { shares: new Map(), errors };
  }
  if (mode === "auto") {
    const shares = calculateEqualShares(total, pooledTenantIds.length);
    const map = new Map<number, number>();
    pooledTenantIds.forEach((id, idx) => map.set(id, shares[idx]));
    return { shares: map, errors };
  }
  const defined = pooledTenantIds.filter((id) => manualOverrides.has(id));
  let definedSum = 0;
  for (const id of defined) definedSum = round2(definedSum + (manualOverrides.get(id) ?? 0));
  const missing = pooledTenantIds.filter((id) => !manualOverrides.has(id));
  if (missing.length === 0) {
    if (Math.abs(definedSum - total) > 0.01) {
      errors.push(
        `Manual tenant amounts must equal the total bill (currently ${definedSum} vs ${total}).`,
      );
    }
    const map = new Map<number, number>();
    for (const id of pooledTenantIds) map.set(id, round2(manualOverrides.get(id) ?? 0));
    return { shares: map, errors };
  }
  const remaining = round2(total - definedSum);
  if (remaining < -0.005) {
    errors.push(
      `Manual tenant amounts must equal the total bill (currently ${definedSum} vs ${total}).`,
    );
  }
  const autoShares = calculateEqualShares(Math.max(0, remaining), missing.length);
  const map = new Map<number, number>();
  for (const id of defined) map.set(id, round2(manualOverrides.get(id) ?? 0));
  missing.forEach((id, idx) => map.set(id, autoShares[idx]));
  return { shares: map, errors };
}

export function calculateMeterTotal(
  start: number | null,
  end: number | null,
  pricePerUnit: number | null,
): { units: number | null; total: number | null; error: string | null } {
  if (start == null || end == null || pricePerUnit == null) {
    return { units: null, total: null, error: null };
  }
  if (pricePerUnit < 0) return { units: null, total: null, error: "Price per unit cannot be negative." };
  if (end < start) return { units: null, total: null, error: "Meter end cannot be less than start." };
  const units = round2(end - start);
  const total = round2(units * pricePerUnit);
  return { units, total, error: null };
}

export function normalizeBillingPeriod(input: string | null): string | null {
  if (input == null) return null;
  const t = input.trim();
  if (t === "") return null;
  return t;
}

export interface ValidateBillInput {
  amount: number;
  tenantIds: number[];
  roomIds: number[];
  method: BillingMethod;
  divisionMode: DivisionMode;
  shares: Map<number, number>;
}

export function validateBill(input: ValidateBillInput): string | null {
  if (!input.amount || isNaN(input.amount) || input.amount <= 0) {
    return "Bill amount cannot be empty or negative.";
  }
  if (input.method === "shared" && input.tenantIds.length === 0) {
    return "At least one tenant or room must be selected.";
  }
  if ((input.method === "per_room" || input.method === "connected") && input.roomIds.length === 0) {
    return "At least one tenant or room must be selected.";
  }
  if (input.method === "connected" && input.roomIds.length < 2) {
    return "Connected-room groups must contain at least two rooms.";
  }
  if (input.divisionMode === "manual") {
    let sum = 0;
    for (const v of input.shares.values()) sum = round2(sum + v);
    if (Math.abs(sum - input.amount) > 0.01) {
      return `Manual tenant amounts must equal the total bill (currently ${sum} vs ${input.amount}).`;
    }
  }
  return null;
}

export function validateExclusionReason(isExcluded: boolean, reason: string | null): string | null {
  if (isExcluded && (!reason || reason.trim() === "")) {
    return "An exclusion reason is required when excluding a tenant.";
  }
  return null;
}
