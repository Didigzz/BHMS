import { describe, it, expect } from "vitest";
import { getPaymentStatus, paymentLabel, dueDateRowLabel, daysUntilDue, addMonths, STATUS_CONFIG } from "./payment-status";

// Local-time helper: noon on the given date, so `startOfDay` inside the module
// truncates to local midnight regardless of the machine's timezone. A bare
// `new Date("2026-08-05")` would parse as UTC midnight and shift day counts on
// timezones behind UTC — avoided here.
function d(y: number, mo: number, day: number): Date {
  return new Date(y, mo - 1, day, 12);
}

describe("getPaymentStatus — legacy fallback (no recorded payment)", () => {
  it("is green only while the due date is still ahead — strict from the due day itself", () => {
    // Strict comparison (due-date-status-fix-spec.md §3.1): the due day and
    // any day after it are red, with no grace window. A brand-new tenant
    // (due = move-in day, first-payment-month-spec) is red "Due today" the
    // moment they're created — accepted consequence.
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 3))).toBe("green"); // before
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 5))).toBe("red"); // the due day
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 7))).toBe("red"); // 2 days past — was green under grace
  });

  it("is red once the due date has passed, with no grace window", () => {
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 6))).toBe("red");
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 8))).toBe("red");
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 20))).toBe("red");
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 21))).toBe("red");
    // Overdue does not reset at the next month's day-of-month anchor.
    expect(getPaymentStatus("2026-08-05", d(2026, 9, 6))).toBe("red");
  });

  it("clamps a day-of-month that does not exist in the reference month (Aug 31 → Sep 30)", () => {
    expect(getPaymentStatus("2026-08-31", d(2026, 9, 30))).toBe("red");
  });

  it("returns green for an unparseable due date", () => {
    expect(getPaymentStatus("not-a-date")).toBe("green");
  });

  it("falls back to the legacy heuristic when lastPaidDate is set but unparseable", () => {
    // A non-empty garbage lastPaidDate must not break the status chain — it
    // silently falls through to the strict due-date comparison.
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 5), "garbage")).toBe("red");
    expect(getPaymentStatus("2026-08-05", d(2026, 8, 20), "garbage")).toBe("red");
  });
});

describe("getPaymentStatus — record-payment cycle", () => {
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

  it("labels green as Paid for tenants with a payment, Current for unpaid tenants", () => {
    expect(paymentLabel("green", "2026-08-05", d(2026, 8, 5))).toBe("Current");
    expect(paymentLabel("green", "2026-08-05", d(2026, 8, 5), "2026-07-05")).toBe("Paid");
  });

  it("labels red as Due today on the due date, else overdue days", () => {
    expect(paymentLabel("red", "2026-08-05", d(2026, 8, 5))).toBe("Due today");
    expect(paymentLabel("red", "2026-08-05", d(2026, 8, 7))).toBe("Overdue 2d");
  });

  it("measures unpaid overdue from the stored due date (does not reset each month)", () => {
    // Overdue since Aug 5: on Sep 6 the count is 32 days, not 1.
    expect(paymentLabel("red", "2026-08-05", d(2026, 9, 6))).toBe("Overdue 32d");
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

describe("dueDateRowLabel", () => {
  it("labels red tenants Overdue (1+ days past) or Due today (the due day itself)", () => {
    expect(dueDateRowLabel("2026-09-01", d(2026, 9, 10))).toBe("Overdue");
    expect(dueDateRowLabel("2026-09-10", d(2026, 9, 10))).toBe("Due today");
  });

  it("labels green, paid, and future-due tenants plain Due — never 'Next due'", () => {
    expect(dueDateRowLabel("2026-09-11", d(2026, 9, 10))).toBe("Due"); // future
    expect(dueDateRowLabel("2026-08-05", d(2026, 8, 3))).toBe("Due"); // not yet due
    // Paid tenant still green (recorded payment cycle): Due.
    expect(dueDateRowLabel("2026-09-05", d(2026, 8, 21), "2026-08-05")).toBe("Due");
  });

  it("labels yellow (due-soon) tenants 'Due soon'", () => {
    // Paid Aug 5 → due Sep 5: yellow from Aug 22 (past the halfway point).
    expect(dueDateRowLabel("2026-09-05", d(2026, 8, 22), "2026-08-05")).toBe("Due soon");
  });

  it("labels paid tenants Overdue once the rolled-forward due date arrives", () => {
    expect(dueDateRowLabel("2026-09-05", d(2026, 9, 10), "2026-08-05")).toBe("Overdue");
  });

  it("handles cross-month and cross-year due dates with exact-date comparison", () => {
    expect(dueDateRowLabel("2026-08-05", d(2026, 9, 6))).toBe("Overdue"); // cross-month
    expect(dueDateRowLabel("2026-12-31", d(2027, 1, 1))).toBe("Overdue"); // cross-year
    expect(dueDateRowLabel("2027-01-05", d(2027, 1, 1))).toBe("Due"); // cross-year, not yet due
  });
});

// Belt-and-braces: lock the tuning constants that the status rules above
// depend on, so a future adjustment is an explicit, reviewed change.
describe("status tuning constants", () => {
  it("match the documented thresholds", () => {
    expect(STATUS_CONFIG.RECENT_PAID_DAYS).toBe(15);
    // The 2-day grace window was removed by due-date-status-fix (strict
    // comparison) — its constant must not come back silently.
    expect("OVERDUE_GRACE_DAYS" in STATUS_CONFIG).toBe(false);
  });
});
