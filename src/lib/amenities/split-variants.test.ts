import { describe, it, expect } from "vitest";
import { AMENITY_MESSAGES, calcConnectedSplit, calcPerRoomSplit } from "./amenity-billing";

function sumOf(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total = Math.round((total + value) * 100) / 100;
  return total;
}

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
