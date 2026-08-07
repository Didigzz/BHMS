import { describe, expect, it } from "vitest";
import { addMonthsKey, formatMonthKey, formatMonthRange, monthKeyOf } from "./format";

describe("monthKeyOf", () => {
  it("extracts the YYYY-MM key from an ISO date", () => {
    expect(monthKeyOf("2026-08-05")).toBe("2026-08");
    expect(monthKeyOf("2026-12-31")).toBe("2026-12");
  });
});

describe("addMonthsKey", () => {
  it("advances within a year", () => {
    expect(addMonthsKey("2026-08", 1)).toBe("2026-09");
    expect(addMonthsKey("2026-08", 3)).toBe("2026-11");
  });

  it("rolls across year boundaries", () => {
    expect(addMonthsKey("2026-12", 1)).toBe("2027-01");
    expect(addMonthsKey("2026-01", -1)).toBe("2025-12");
  });

  it("returns the input unchanged when invalid", () => {
    expect(addMonthsKey("nope", 1)).toBe("nope");
  });
});

describe("formatMonthKey", () => {
  it("formats as 'Month YYYY'", () => {
    expect(formatMonthKey("2026-08")).toBe("August 2026");
  });

  it("returns the input unchanged when invalid", () => {
    expect(formatMonthKey("garbage")).toBe("garbage");
  });
});

describe("formatMonthRange", () => {
  it("renders a range", () => {
    expect(formatMonthRange("2026-08", "2026-10")).toBe("August 2026 – October 2026");
  });

  it("collapses a single month", () => {
    expect(formatMonthRange("2026-08", "2026-08")).toBe("August 2026");
    expect(formatMonthRange("2026-08", null)).toBe("August 2026");
  });

  it("falls back to an em dash with no months", () => {
    expect(formatMonthRange(null, null)).toBe("—");
  });
});
