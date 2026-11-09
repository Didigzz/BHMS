import { describe, it, expect } from "vitest";
import {
  AMENITY_MESSAGES,
  calcConnectedSplit,
  calcPerRoomSplit,
  calcSharedSplit,
  splitWithManual,
} from "./amenity-billing";

describe("manual per-tenant amounts", () => {
  it("pins one tenant at 500 and leaves 1250 each for the other two", () => {
    const result = calcSharedSplit({
      total: 3000,
      tenantIds: [1, 2, 3],
      excluded: new Map(),
      manualOverrides: new Map([[1, 500]]),
    });
    expect(result.errors).toEqual([]);
    expect(result.shares.get(1)).toBe(500);
    expect(result.shares.get(2)).toBe(1250);
    expect(result.shares.get(3)).toBe(1250);
    expect(result.absorbed).toBe(0);
  });

  it("applies the override in per-room billing even in auto mode", () => {
    const result = calcPerRoomSplit([1, 2, 3], 900, new Map([[1, 400]]), "auto");
    expect(result.errors).toEqual([]);
    expect(result.shares.get(1)).toBe(400);
    expect(result.shares.get(2)).toBe(250);
    expect(result.shares.get(3)).toBe(250);
  });

  it("applies the override in connected billing even in auto mode", () => {
    const result = calcConnectedSplit([1, 2, 3], 8000, new Map([[1, 3000]]), "auto");
    expect(result.errors).toEqual([]);
    expect(result.shares.get(1)).toBe(3000);
    expect(result.shares.get(2)).toBe(2500);
    expect(result.shares.get(3)).toBe(2500);
  });

  it("floors the remainder to centavos and absorbs the difference", () => {
    const result = splitWithManual([1, 2, 3, 4], 1000, new Map([[1, 500]]));
    expect(result.shares.get(2)).toBe(166.66);
    expect(result.shares.get(3)).toBe(166.66);
    expect(result.shares.get(4)).toBe(166.66);
    expect(result.absorbed).toBe(0.02);
  });

  it("accepts ₱0 as a manual amount", () => {
    const result = splitWithManual([1, 2, 3], 1000, new Map([[1, 0]]));
    expect(result.errors).toEqual([]);
    expect(result.shares.get(1)).toBe(0);
    expect(result.shares.get(2)).toBe(500);
    expect(result.shares.get(3)).toBe(500);
  });

  it("requires every manual amount to add up when nothing is automatic", () => {
    const short = splitWithManual(
      [1, 2, 3],
      1000,
      new Map([
        [1, 300],
        [2, 300],
        [3, 300],
      ]),
    );
    expect(short.errors.some((e) => e.includes("must equal the total bill"))).toBe(true);

    const absorbed = splitWithManual(
      [1, 2, 3],
      3000,
      new Map([
        [1, 1000],
        [2, 1000],
        [3, 999.5],
      ]),
    );
    expect(absorbed.errors).toEqual([]);
    expect(absorbed.absorbed).toBe(0.5);
  });

  it("leaves the excluded tenant out and splits the rest", () => {
    const result = calcSharedSplit({
      total: 1000,
      tenantIds: [1, 2, 3],
      excluded: new Map([[2, "Left early"]]),
      manualOverrides: new Map([[1, 500]]),
    });
    expect(result.errors).toEqual([]);
    expect(result.shares.has(2)).toBe(false);
    expect(result.shares.get(3)).toBe(500);
  });

  it("handles negative manual amounts as an error", () => {
    const result = splitWithManual([1, 2], 1000, new Map([[1, -5]]));
    expect(result.errors).toContain(AMENITY_MESSAGES.negativeAmount);
  });
});
