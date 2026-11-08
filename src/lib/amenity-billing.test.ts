import { describe, it, expect } from "vitest";
import {
  AMENITY_MESSAGES,
  MAX_ABSORBED,
  calcSharedSplit,
  calcPerRoomSplit,
  calcConnectedSplit,
  calculateEqualShares,
  calculateMeterTotal,
  isValidBillingPeriod,
  normalizeBillingPeriod,
  parseOptionalNumber,
  recalcRemaining,
  validateBill,
  validateBillingPeriod,
  validateExclusionReason,
} from "./amenity-billing";

function sumOf(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total = Math.round((total + value) * 100) / 100;
  return total;
}

describe("calculateEqualShares", () => {
  it("splits evenly when the total divides cleanly", () => {
    expect(calculateEqualShares(1000, 5)).toEqual([200, 200, 200, 200, 200]);
  });

  it("floors every share so the sum never exceeds the bill total", () => {
    const shares = calculateEqualShares(800, 3);
    expect(shares).toEqual([266.66, 266.66, 266.66]);
    expect(sumOf(shares)).toBe(799.98);
    expect(sumOf(shares)).toBeLessThanOrEqual(800);
  });

  it("keeps the absorbed fraction under ₱1 for realistic tenant counts", () => {
    for (const count of [2, 3, 5, 7, 11]) {
      const shares = calculateEqualShares(1000, count);
      const absorbed = Math.round((1000 - sumOf(shares)) * 100) / 100;
      expect(absorbed).toBeGreaterThanOrEqual(0);
      expect(absorbed).toBeLessThan(MAX_ABSORBED);
    }
  });

  it("returns nothing for a non-positive count", () => {
    expect(calculateEqualShares(100, 0)).toEqual([]);
  });
});

describe("shared billing", () => {
  const reason = "Moved out mid-cycle";

  it("auto splits 1000 among 5 with nothing absorbed", () => {
    const result = calcSharedSplit({
      total: 1000,
      tenantIds: [1, 2, 3, 4, 5],
      excluded: new Map(),
      manualOverrides: new Map(),
    });
    expect(result.errors).toEqual([]);
    expect([...result.shares.values()].sort()).toEqual([200, 200, 200, 200, 200]);
    expect(result.absorbed).toBe(0);
  });

  it("excludes a tenant from the shares entirely (one row, not a ₱0 share)", () => {
    const result = calcSharedSplit({
      total: 1000,
      tenantIds: [1, 2, 3, 4, 5],
      excluded: new Map([[5, reason]]),
      manualOverrides: new Map(),
    });
    expect(result.errors).toEqual([]);
    expect(result.shares.has(5)).toBe(false);
    expect(result.shares.size).toBe(4);
    expect(result.shares.get(1)).toBe(250);
    expect(result.absorbed).toBe(0);
  });

  it("requires an exclusion reason", () => {
    const result = calcSharedSplit({
      total: 1000,
      tenantIds: [1, 2],
      excluded: new Map([[2, ""]]),
      manualOverrides: new Map(),
    });
    expect(result.errors).toContain(AMENITY_MESSAGES.exclusionReason);
  });

  it("rejects a bill where every tenant is excluded", () => {
    const result = calcSharedSplit({
      total: 1000,
      tenantIds: [1, 2],
      excluded: new Map([
        [1, reason],
        [2, reason],
      ]),
      manualOverrides: new Map(),
    });
    expect(result.shares.size).toBe(0);
    expect(result.errors).toContain(AMENITY_MESSAGES.selection);
  });

  it("manual 15 leaves the remaining 985 to the other four", () => {
    const result = calcSharedSplit({
      total: 1000,
      tenantIds: [1, 2, 3, 4, 5],
      excluded: new Map(),
      manualOverrides: new Map([[1, 15]]),
    });
    expect(result.errors).toEqual([]);
    expect(result.shares.get(1)).toBe(15);
    expect(result.shares.get(2)).toBe(246.25);
    expect(sumOf(result.shares.values())).toBe(1000);
  });

  it("blocks a manual sum above the total", () => {
    const result = calcSharedSplit({
      total: 1000,
      tenantIds: [1, 2],
      excluded: new Map(),
      manualOverrides: new Map([
        [1, 700],
        [2, 400],
      ]),
    });
    expect(result.errors.some((e) => e.includes("must equal the total bill"))).toBe(true);
  });

  it("allows manual amounts within the ₱1 absorption window", () => {
    const result = calcSharedSplit({
      total: 1000,
      tenantIds: [1, 2],
      excluded: new Map(),
      manualOverrides: new Map([
        [1, 600],
        [2, 399.5],
      ]),
    });
    expect(result.errors).toEqual([]);
    expect(result.absorbed).toBe(0.5);
  });

  it("recalcRemaining re-splits the untouched tenants", () => {
    const shares = recalcRemaining(1000, new Map([[1, 15]]), [1, 2, 3, 4, 5]);
    expect(shares.get(1)).toBe(15);
    expect(shares.get(3)).toBe(246.25);
  });
});

describe("connected pooling", () => {
  it("pools 8000 across 3 tenants, not per room", () => {
    const result = calcConnectedSplit([1, 2, 3], 8000, new Map(), "auto");
    expect(result.shares.get(1)).toBe(2666.66);
    expect(result.shares.size).toBe(3);
    expect(sumOf(result.shares.values())).toBe(7999.98);
    expect(result.absorbed).toBe(0.02);
  });

  it("keeps a manual override and splits the remainder", () => {
    const result = calcConnectedSplit([1, 2, 3], 8000, new Map([[1, 3000]]), "manual");
    expect(result.errors).toEqual([]);
    expect(result.shares.get(1)).toBe(3000);
    expect(result.shares.get(2)).toBe(2500);
  });

  it("requires at least one pooled tenant", () => {
    expect(calcConnectedSplit([], 8000, new Map(), "auto").errors).toContain(
      AMENITY_MESSAGES.selection,
    );
  });
});

describe("per-room", () => {
  it("rejects an empty room", () => {
    const result = calcPerRoomSplit([], 600, new Map(), "auto");
    expect(result.errors).toContain(AMENITY_MESSAGES.roomEmpty);
  });

  it("auto splits 600 across two occupants", () => {
    const result = calcPerRoomSplit([1, 2], 600, new Map(), "auto");
    expect(result.errors).toEqual([]);
    expect(result.shares.get(1)).toBe(300);
    expect(result.absorbed).toBe(0);
  });

  it("splits 900 three ways at 300 each", () => {
    const result = calcPerRoomSplit([1, 2, 3], 900, new Map(), "auto");
    expect([...result.shares.values()]).toEqual([300, 300, 300]);
  });

  it("manual override 400 leaves 250 each for the other two", () => {
    const result = calcPerRoomSplit([1, 2, 3], 900, new Map([[1, 400]]), "manual");
    expect(result.errors).toEqual([]);
    expect(result.shares.get(1)).toBe(400);
    expect(result.shares.get(2)).toBe(250);
    expect(result.absorbed).toBe(0);
  });
});

describe("meter", () => {
  it("computes units and total", () => {
    const result = calculateMeterTotal(100, 150, 5);
    expect(result.units).toBe(50);
    expect(result.total).toBe(250);
    expect(result.error).toBeNull();
  });

  it("is idle until all three fields are filled", () => {
    expect(calculateMeterTotal(100, null, 5)).toEqual({ units: null, total: null, error: null });
  });

  it("rejects end < start and negative prices", () => {
    expect(calculateMeterTotal(150, 100, 5).error).toBe(AMENITY_MESSAGES.meterEnd);
    expect(calculateMeterTotal(100, 150, -5).error).toBe(AMENITY_MESSAGES.meterPrice);
  });
});

describe("parseOptionalNumber", () => {
  it("treats blank, null and unparsable values as not set", () => {
    for (const raw of [null, undefined, "", "   ", "abc", NaN, Infinity, -Infinity]) {
      expect(parseOptionalNumber(raw)).toBeNull();
    }
  });

  it("keeps a real 0 and trims numeric text", () => {
    expect(parseOptionalNumber("0")).toBe(0);
    expect(parseOptionalNumber(0)).toBe(0);
    expect(parseOptionalNumber(" 12 ")).toBe(12);
  });

  it("parses decimal and negative readings", () => {
    expect(parseOptionalNumber("150.5")).toBe(150.5);
    expect(parseOptionalNumber(-3)).toBe(-3);
  });
});

describe("billing period", () => {
  it("accepts a month key", () => {
    expect(isValidBillingPeriod("2026-09")).toBe(true);
    expect(normalizeBillingPeriod(" 2026-09 ")).toBe("2026-09");
    expect(validateBillingPeriod("2026-09")).toBeNull();
  });

  it("rejects free text, unpadded months and impossible months", () => {
    for (const bad of ["Sep 1-30, 2026", "2026-9", "2026-13", "2026-00", "26-09", "2026-09-01"]) {
      expect(isValidBillingPeriod(bad)).toBe(false);
      expect(validateBillingPeriod(bad)).toBe(AMENITY_MESSAGES.period);
    }
  });

  it("treats empty as no period at all", () => {
    expect(normalizeBillingPeriod("   ")).toBeNull();
    expect(normalizeBillingPeriod(null)).toBeNull();
    expect(validateBillingPeriod("")).toBeNull();
  });
});

describe("validateBill", () => {
  const base = {
    amenityName: "Electricity",
    amount: 1000,
    tenantIds: [1, 2],
    roomIds: [] as number[],
    method: "shared" as const,
    divisionMode: "auto" as const,
    shares: new Map<number, number>(),
    billingPeriod: null,
  };

  it("rejects an empty or negative amount", () => {
    expect(validateBill({ ...base, amount: 0 })).toBe(AMENITY_MESSAGES.amount);
    expect(validateBill({ ...base, amount: -5 })).toBe(AMENITY_MESSAGES.amount);
  });

  it("rejects a missing name", () => {
    expect(validateBill({ ...base, amenityName: "  " })).toBe(AMENITY_MESSAGES.name);
  });

  it("requires a tenant for shared billing", () => {
    expect(validateBill({ ...base, tenantIds: [] })).toBe(AMENITY_MESSAGES.selection);
  });

  it("requires two rooms for connected billing", () => {
    expect(validateBill({ ...base, method: "connected", roomIds: [1], tenantIds: [] })).toBe(
      AMENITY_MESSAGES.connectedRooms,
    );
  });

  it("requires a room for per-room billing", () => {
    expect(validateBill({ ...base, method: "per_room", roomIds: [], tenantIds: [] })).toBe(
      AMENITY_MESSAGES.selection,
    );
  });

  it("rejects a malformed billing period", () => {
    expect(validateBill({ ...base, billingPeriod: "Sep 2026" })).toBe(AMENITY_MESSAGES.period);
    expect(validateBill({ ...base, billingPeriod: "2026-09" })).toBeNull();
  });

  it("accepts manual sums within ₱1 of the total and rejects the boundaries", () => {
    const manual = { ...base, divisionMode: "manual" as const };
    const oneCentShort = new Map([[1, 500], [2, 499.99]]);
    const exactlyOneShort = new Map([[1, 500], [2, 499]]);
    const tooShort = new Map([[1, 500], [2, 498.99]]);
    const tooMuch = new Map([[1, 500], [2, 500.01]]);

    expect(validateBill({ ...manual, shares: oneCentShort })).toBeNull();
    expect(validateBill({ ...manual, shares: exactlyOneShort })).toBeNull();
    expect(validateBill({ ...manual, shares: tooShort })).toContain("must equal the total bill");
    expect(validateBill({ ...manual, shares: tooMuch })).toContain("must equal the total bill");
  });
});

describe("validateExclusionReason", () => {
  it("requires a reason only when excluded", () => {
    expect(validateExclusionReason(false, null)).toBeNull();
    expect(validateExclusionReason(true, "  ")).toBe(AMENITY_MESSAGES.exclusionReason);
    expect(validateExclusionReason(true, "Left early")).toBeNull();
  });
});
