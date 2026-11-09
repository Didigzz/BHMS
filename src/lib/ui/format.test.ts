import { describe, expect, it } from "vitest";
import { addMonthsKey, formatMonthKey, formatMonthRange, isDueDatePayment, monthKeyOf, roomLabel } from "./format";

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

describe("roomLabel", () => {
  it("adds the prefix when the stored value has none", () => {
    expect(roomLabel("101")).toBe("Room 101");
    expect(roomLabel("Annex B")).toBe("Room Annex B");
  });

  it("never duplicates an existing 'Room' prefix", () => {
    expect(roomLabel("Room 101")).toBe("Room 101");
    expect(roomLabel("room 101")).toBe("room 101");
    expect(roomLabel("ROOM 101")).toBe("ROOM 101");
  });

  it("handles a bare 'Room' value", () => {
    expect(roomLabel("Room")).toBe("Room");
  });
});

describe("isDueDatePayment — new due-date model vs legacy rows", () => {
  it("recognizes a new-style row whose due_date is the covered due date", () => {
    expect(isDueDatePayment({ due_date: "2026-09-15", covers_month: "2026-09" })).toBe(true);
  });

  it("rejects a legacy row whose due_date points a month past the covered month", () => {
    // Old model: due_date = running "new due" (Sep 5), covers August.
    expect(isDueDatePayment({ due_date: "2026-09-05", covers_month: "2026-08" })).toBe(false);
  });

  it("rejects rows without a covers_month", () => {
    expect(isDueDatePayment({ due_date: "2026-09-05", covers_month: null })).toBe(false);
  });
});
