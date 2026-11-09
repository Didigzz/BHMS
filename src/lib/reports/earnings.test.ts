import { describe, expect, it } from "vitest";
import {
  computeMonthSummary,
  currentMonthKey,
  isActiveInMonth,
  monthBounds,
  type EarningsPayment,
  type EarningsTenant,
} from "./earnings";

function tenant(
  id: number,
  name: string,
  moveIn: string,
  movedOut: string | null = null,
  rate = 2500,
): EarningsTenant {
  return { id, name, room_number: "Room 1", rate, move_in_date: moveIn, moved_out_date: movedOut };
}

function payment(tenantId: number, amount: number, coversMonth: string): EarningsPayment {
  return { tenant_id: tenantId, amount, covers_month: coversMonth };
}

describe("monthBounds", () => {
  it("returns the first and last day of a month", () => {
    expect(monthBounds("2026-08")).toEqual({ first: "2026-08-01", last: "2026-08-31" });
  });

  it("handles February, including leap years", () => {
    expect(monthBounds("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
    expect(monthBounds("2028-02")).toEqual({ first: "2028-02-01", last: "2028-02-29" });
  });
});

describe("isActiveInMonth — full-month counting", () => {
  it("counts an active tenant with no move-out", () => {
    expect(isActiveInMonth(tenant(1, "A", "2026-01-10"), "2026-08")).toBe(true);
  });

  it("counts a mid-month move-in as a full month", () => {
    expect(isActiveInMonth(tenant(1, "A", "2026-08-20"), "2026-08")).toBe(true);
  });

  it("counts a mid-month move-out as a full month", () => {
    expect(isActiveInMonth(tenant(1, "A", "2026-01-01", "2026-08-15"), "2026-08")).toBe(true);
  });

  it("counts tenants active exactly on the month boundaries", () => {
    // Move-in on the month's first day, moved out on its last day — both in.
    expect(isActiveInMonth(tenant(1, "A", "2026-08-01", "2026-08-31"), "2026-08")).toBe(true);
    expect(isActiveInMonth(tenant(1, "A", "2026-08-01", "2026-07-31"), "2026-08")).toBe(false);
    expect(isActiveInMonth(tenant(1, "A", "2026-09-01", "2026-08-31"), "2026-08")).toBe(false);
  });

  it("excludes a tenant who moved in after the month", () => {
    expect(isActiveInMonth(tenant(1, "A", "2026-09-01"), "2026-08")).toBe(false);
  });

  it("excludes a tenant who moved out before the month", () => {
    expect(isActiveInMonth(tenant(1, "A", "2026-01-01", "2026-07-31"), "2026-08")).toBe(false);
  });
});

describe("computeMonthSummary", () => {
  it("counts a single paid tenant as expected = collected, zero pending", () => {
    const tenants = [tenant(1, "Juan", "2026-01-01")];
    const payments = [payment(1, 2500, "2026-08")];
    const s = computeMonthSummary(tenants, payments, "2026-08");
    expect(s.expected).toBe(2500);
    expect(s.collected).toBe(2500);
    expect(s.pending).toBe(0);
    expect(s.paidCount).toBe(1);
    expect(s.unpaidCount).toBe(0);
  });

  it("shows an unpaid tenant as pending", () => {
    const tenants = [tenant(1, "Juan", "2026-01-01")];
    const s = computeMonthSummary(tenants, [], "2026-08");
    expect(s.collected).toBe(0);
    expect(s.pending).toBe(2500);
    expect(s.paidCount).toBe(0);
    expect(s.unpaidCount).toBe(1);
  });

  it("tracks paid vs unpaid counts across tenants", () => {
    const tenants = [tenant(1, "Ana", "2026-01-01"), tenant(2, "Ben", "2026-01-01")];
    const payments = [payment(1, 2500, "2026-08")];
    const s = computeMonthSummary(tenants, payments, "2026-08");
    expect(s.expected).toBe(5000);
    expect(s.collected).toBe(2500);
    expect(s.pending).toBe(2500);
    expect(s.paidCount).toBe(1);
    expect(s.unpaidCount).toBe(1);
  });

  it("counts an advance payment split across covered months", () => {
    const tenants = [tenant(1, "Juan", "2026-01-01")];
    // One 3-month advance payment → one row per covered month.
    const payments = [
      payment(1, 2500, "2026-08"),
      payment(1, 2500, "2026-09"),
      payment(1, 2500, "2026-10"),
    ];
    expect(computeMonthSummary(tenants, payments, "2026-08").collected).toBe(2500);
    expect(computeMonthSummary(tenants, payments, "2026-09").collected).toBe(2500);
    expect(computeMonthSummary(tenants, payments, "2026-10").collected).toBe(2500);
    // The following month has no coverage → unpaid.
    const nov = computeMonthSummary(tenants, payments, "2026-11");
    expect(nov.collected).toBe(0);
    expect(nov.pending).toBe(2500);
  });

  it("keeps a partial payment unpaid with the shortfall as pending", () => {
    const tenants = [tenant(1, "Juan", "2026-01-01")];
    const payments = [payment(1, 500, "2026-08")];
    const s = computeMonthSummary(tenants, payments, "2026-08");
    expect(s.rows[0].paid).toBe(false);
    expect(s.rows[0].collected).toBe(500);
    expect(s.pending).toBe(2000);
  });

  it("excludes archived tenants from months after they moved out", () => {
    const tenants = [tenant(1, "Old", "2026-01-01", "2026-07-31")];
    expect(computeMonthSummary(tenants, [], "2026-08").expected).toBe(0);
    expect(computeMonthSummary(tenants, [], "2026-07").expected).toBe(2500);
  });

  it("ignores payments from tenants not active in the month", () => {
    const tenants = [tenant(1, "Juan", "2026-08-01")];
    const stray = [payment(99, 2500, "2026-08")]; // no matching tenant
    const s = computeMonthSummary(tenants, stray, "2026-08");
    expect(s.collected).toBe(0);
    expect(s.pending).toBe(2500);
  });

  it("projects future months from currently-active tenants", () => {
    const tenants = [tenant(1, "Juan", "2026-01-01")];
    const payments = [payment(1, 2500, "2026-09")]; // pre-paid for next month
    const s = computeMonthSummary(tenants, payments, "2026-09");
    expect(s.expected).toBe(2500);
    expect(s.collected).toBe(2500);
    expect(s.pending).toBe(0);
  });

  it("exposes the covered due date of a due-date-model payment", () => {
    const tenants = [tenant(1, "Juan", "2026-01-01")];
    // New-style payment: covers September, due Sep 15 (paid early in August).
    const payments: EarningsPayment[] = [
      { tenant_id: 1, amount: 2500, covers_month: "2026-09", due_date: "2026-09-15" },
    ];
    const s = computeMonthSummary(tenants, payments, "2026-09");
    expect(s.rows[0].paid).toBe(true);
    expect(s.rows[0].paidDueDate).toBe("2026-09-15");
    // The due-date-less helper rows leave paidDueDate null.
    expect(computeMonthSummary(tenants, [payment(1, 2500, "2026-09")], "2026-09").rows[0].paidDueDate).toBeNull();
  });

  it("returns zeroes for an empty month", () => {
    const s = computeMonthSummary([], [], "2026-08");
    expect(s).toMatchObject({ expected: 0, collected: 0, pending: 0, paidCount: 0, unpaidCount: 0 });
    expect(s.rows).toEqual([]);
  });
});

describe("currentMonthKey", () => {
  it("returns a valid YYYY-MM key for the local month", () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    expect(currentMonthKey()).toBe(expected);
  });
});
