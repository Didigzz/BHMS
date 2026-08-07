import { describe, it, expect } from "vitest";
import { getPaymentStatus, paymentLabel, daysUntilDue, addMonths, STATUS_CONFIG } from "./payment-status";

// Local-time helper: noon on the given date, so `startOfDay` inside the module
// truncates to local midnight regardless of the machine's timezone. A bare
// `new Date("2026-08-05")` would parse as UTC midnight and shift day counts on
// timezones behind UTC — avoided here.
function d(y: number, mo: number, day: number): Date {
  return new Date(y, mo - 1, day, 12);
}

describe("getPaymentStatus — legacy fallback (no recorded payment)", () => {
  it("is red on the due date and within the 2-day overdue grace", () => {
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 5))).toBe("red");
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 6))).toBe("red");
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 7))).toBe("red");
  });

  it("is green within the 15-day recently-paid window after the grace", () => {
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 8))).toBe("green");
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 20))).toBe("green");
  });

  it("turns yellow past the recently-paid window, before the next due date", () => {
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 21))).toBe("yellow");
    // Before this month's due date, the previous occurrence is the anchor.
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 3))).toBe("yellow");
  });

  it("clamps a day-of-month that does not exist in the reference month (Aug 31 → Sep 30)", () => {
    expect(getPaymentStatus("2026-08-31", d(2026, 9, 30))).toBe("red");
  });

  it("returns green for an unparseable due date", () => {
    expect(getPaymentStatus("not-a-date")).toBe("green");
  });

  it("falls back to the legacy heuristic when lastPaidDate is set but unparseable", () => {
    // A non-empty garbage lastPaidDate must not break the status chain — it
    // silently falls through to the day-of-month heuristic.
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 5), "garbage")).toBe("red");
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 20), "garbage")).toBe("green");
  });
});

describe("getPaymentStatus — mark-as-paid cycle", () => {
  // Marked paid on Aug 5 → due date rolled to Sep 5. Stays green for the
  // first half of the paid span (max(RECENT_PAID_DAYS, span/2) = 16 days).
  const due = "2026-09-05";
  const lastPaid = "2026-08-05";

  it("is green on the payment date and through the halfway point", () => {
    expect(getPaymentStatus(due, d(2026, 8, 5), lastPaid)).toBe("green");
    expect(getPaymentStatus(due, d(2026, 8, 21), lastPaid)).toBe("green"); // 16 days ≤ 16
  });

  it("turns yellow past the halfway point while the due date is still ahead", () => {
    expect(getPaymentStatus(due, d(2026, 8, 22), lastPaid)).toBe("yellow");
  });

  it("is red once the rolled-forward due date arrives without a new payment", () => {
    expect(getPaymentStatus(due, d(2026, 9, 5), lastPaid)).toBe("red");
    expect(getPaymentStatus(due, d(2026, 9, 10), lastPaid)).toBe("red");
  });
});

describe("getPaymentStatus — advance payments extend the green window", () => {
  // Paid 3 months ahead: Aug 5 → due Nov 5 (92-day span) → green window is
  // max(15, 46) = 46 days from the payment.
  const due = "2026-11-05";
  const lastPaid = "2026-08-05";

  it("stays green well beyond the fixed 15-day recent-paid window", () => {
    expect(getPaymentStatus(due, d(2026, 8, 5), lastPaid)).toBe("green");
    expect(getPaymentStatus(due, d(2026, 9, 20), lastPaid)).toBe("green"); // 46 days ≤ 46
  });

  it("turns yellow only past the extended halfway point", () => {
    expect(getPaymentStatus(due, d(2026, 9, 21), lastPaid)).toBe("yellow");
  });
});

describe("paymentLabel", () => {
  it("returns a fallback for an unparseable due date", () => {
    expect(paymentLabel("red", "not-a-date")).toBe("No due date");
    expect(paymentLabel("green", "not-a-date")).toBe("No due date");
  });

  it("labels green as Paid", () => {
    expect(paymentLabel("green", "2026-08-05", d(2026, 8, 5))).toBe("Paid");
  });

  it("labels red as Due today on the due date, else overdue days", () => {
    expect(paymentLabel("red", "2026-08-05", d(2026, 8, 5))).toBe("Due today");
    expect(paymentLabel("red", "2026-08-05", d(2026, 8, 7))).toBe("Overdue 2d");
  });

  it("measures red from the exact stored due date for paid tenants", () => {
    expect(paymentLabel("red", "2026-08-05", d(2026, 8, 5), "2026-07-05")).toBe("Due today");
    expect(paymentLabel("red", "2026-08-05", d(2026, 8, 6), "2026-07-05")).toBe("Overdue 1d");
  });

  it("labels yellow as days until the next occurrence", () => {
    expect(paymentLabel("yellow", "2026-08-05", d(2026, 8, 3))).toBe("Due in 2d");
    expect(paymentLabel("yellow", "2026-09-05", d(2026, 8, 5), "2026-08-05")).toBe("Due in 31d");
  });

  it("clamps a negative yellow count to 0 (label-only safety, unreachable from getPaymentStatus)", () => {
    expect(paymentLabel("yellow", "2026-08-05", d(2026, 8, 10), "2026-07-05")).toBe("Due in 0d");
  });
});

describe("daysUntilDue", () => {
  it("always returns ≥ 1 for legacy tenants (status handles overdue)", () => {
    expect(daysUntilDue("2026-08-05", d(2026, 8, 3))).toBe(2);
    expect(daysUntilDue("2026-08-05", d(2026, 8, 5))).toBe(31); // next occurrence is next month
  });

  it("measures paid tenants from the stored (rolled-forward) due date, allowing negatives", () => {
    expect(daysUntilDue("2026-09-05", d(2026, 8, 5), "2026-08-05")).toBe(31);
    expect(daysUntilDue("2026-08-05", d(2026, 8, 10), "2026-07-05")).toBe(-5);
  });

  it("returns Infinity for an unparseable due date", () => {
    expect(daysUntilDue("bad-date")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("addMonths", () => {
  it("returns the input unchanged when unparseable", () => {
    expect(addMonths("2026/08/05", 1)).toBe("2026/08/05");
  });

  it("advances by the requested months", () => {
    expect(addMonths("2026-08-05", 1)).toBe("2026-09-05");
    expect(addMonths("2026-08-05", 0)).toBe("2026-08-05");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });

  it("clamps to the target month's length", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28"); // non-leap February
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // leap February
    expect(addMonths("2026-08-31", 1)).toBe("2026-09-30");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
  });

  it("handles multi-year and negative offsets", () => {
    expect(addMonths("2025-03-31", 12)).toBe("2026-03-31");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });
});

// Belt-and-braces: lock the tuning constants that the status rules above
// depend on, so a future adjustment is an explicit, reviewed change.
describe("status tuning constants", () => {
  it("match the documented thresholds", () => {
    expect(STATUS_CONFIG.RECENT_PAID_DAYS).toBe(15);
    expect(STATUS_CONFIG.OVERDUE_GRACE_DAYS).toBe(2);
  });
});
