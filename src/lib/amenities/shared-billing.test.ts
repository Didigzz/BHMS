import { describe, it, expect } from "vitest";
import { AMENITY_MESSAGES, calcSharedSplit, recalcRemaining } from "./amenity-billing";

function sumOf(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total = Math.round((total + value) * 100) / 100;
  return total;
}

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
    expect(result.errors.some((e) => e.includes("cannot be more than the total bill"))).toBe(true);
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
