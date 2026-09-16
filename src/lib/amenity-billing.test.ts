import { describe, it, expect } from "vitest";
import {
  calcSharedSplit,
  calcPerRoomSplit,
  calcConnectedSplit,
  calculateEqualShares,
  calculateMeterTotal,
  validateBill,
} from "./amenity-billing";

describe("calculateEqualShares", () => {
  it("splits equally with remainder on last", () => {
    expect(calculateEqualShares(1000, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(calculateEqualShares(800, 3)).toEqual([266.67, 266.67, 266.66]);
    expect(calculateEqualShares(8000, 3)).toEqual([2666.67, 2666.67, 2666.66]);
  });
});

describe("shared billing", () => {
  it("auto splits 1000 among 5", () => {
    const r = calcSharedSplit({ total: 1000, tenantIds: [1, 2, 3, 4, 5], excluded: new Map(), manualOverrides: new Map() });
    expect(r.errors.length).toBe(0);
    expect([...r.shares.values()].sort()).toEqual([200, 200, 200, 200, 200]);
  });
  it("excluded tenant pays 0 and remainder split", () => {
    const r = calcSharedSplit({ total: 1000, tenantIds: [1, 2, 3, 4, 5], excluded: new Map([[5, "Moved out"]]), manualOverrides: new Map() });
    expect(r.shares.get(5)).toBe(0);
    expect(r.shares.get(1)).toBe(250);
  });
  it("manual 15 remainder recalc", () => {
    const r = calcSharedSplit({ total: 1000, tenantIds: [1, 2, 3, 4, 5], excluded: new Map(), manualOverrides: new Map([[1, 15]]) });
    expect(r.shares.get(1)).toBe(15);
    expect(r.shares.get(2)).toBe(246.25);
    const sum = [...r.shares.values()].reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1000) < 0.01).toBe(true);
  });
  it("requires exclusion reason", () => {
    const r = calcSharedSplit({ total: 1000, tenantIds: [1, 2], excluded: new Map([[2, ""]]), manualOverrides: new Map() });
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("connected pooling", () => {
  it("pools 8000 across 3", () => {
    const r = calcConnectedSplit([1, 2, 3], 8000, new Map(), "auto");
    expect(r.shares.get(1)).toBe(2666.67);
    const sum = [...r.shares.values()].reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 8000) < 0.01).toBe(true);
  });
  it("manual in connected", () => {
    const r = calcConnectedSplit([1, 2, 3], 8000, new Map([[1, 3000]]), "manual");
    expect(r.shares.get(1)).toBe(3000);
    expect(r.shares.get(2)).toBe(2500);
  });
});

describe("per-room", () => {
  it("rejects empty room", () => {
    const r = calcPerRoomSplit([], 600, new Map(), "auto");
    expect(r.errors.length).toBeGreaterThan(0);
  });
  it("auto per room 600/2", () => {
    const r = calcPerRoomSplit([1, 2], 600, new Map(), "auto");
    expect(r.shares.get(1)).toBe(300);
  });
});

describe("meter", () => {
  it("calc meter", () => {
    const r = calculateMeterTotal(100, 150, 5);
    expect(r.units).toBe(50);
    expect(r.total).toBe(250);
  });
  it("end < start error", () => {
    expect(calculateMeterTotal(150, 100, 5).error).not.toBeNull();
  });
});

describe("validateBill", () => {
  it("rejects empty amount", () => {
    expect(validateBill({ amount: 0, tenantIds: [], roomIds: [], method: "shared", divisionMode: "auto", shares: new Map() })).not.toBeNull();
  });
  it("requires 2 rooms for connected", () => {
    expect(validateBill({ amount: 1000, tenantIds: [], roomIds: [1], method: "connected", divisionMode: "auto", shares: new Map() })).toMatch(/at least two/i);
  });
});
