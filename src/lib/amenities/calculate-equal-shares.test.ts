import { describe, it, expect } from "vitest";
import { MAX_ABSORBED, calculateEqualShares } from "./amenity-billing";

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
