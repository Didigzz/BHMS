import { describe, it, expect } from "vitest";
import {
  AMENITY_MESSAGES,
  calculateMeterTotal,
  isValidBillingPeriod,
  normalizeBillingPeriod,
  parseOptionalNumber,
  validateBillingPeriod,
} from "./amenity-billing";

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
