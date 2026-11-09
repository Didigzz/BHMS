import { describe, it, expect } from "vitest";
import {
  AMENITY_MESSAGES,
  hasZeroAutoShare,
  validateBill,
  validateExclusionReason,
  validateManualAmounts,
} from "./amenity-billing";

describe("manual amount validation", () => {
  it("blocks more manual money than the bill holds", () => {
    expect(validateManualAmounts(1000, [1, 2], new Map([[1, 1100]]))).toContain(
      "cannot be more than the total bill",
    );
  });

  it("requires an all-manual bill to add up within ₱1", () => {
    expect(validateManualAmounts(1000, [1], new Map([[1, 600]]))).toContain(
      "must equal the total bill",
    );
    expect(validateManualAmounts(1000, [1], new Map([[1, 999.5]]))).toBeNull();
  });

  it("leaves partial manual amounts to the automatic remainder", () => {
    expect(validateManualAmounts(1000, [1, 2], new Map([[1, 500]]))).toBeNull();
  });

  it("flags when a manual amount leaves auto tenants on ₱0", () => {
    expect(hasZeroAutoShare([1, 2], new Map([[1, 1000]]), 1000)).toBe(true);
    expect(hasZeroAutoShare([1, 2], new Map([[1, 500]]), 1000)).toBe(false);
    expect(hasZeroAutoShare([1, 2], new Map(), 1000)).toBe(false);
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
