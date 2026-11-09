import { describe, expect, it } from "vitest";
import {
  atCurrentMonth,
  atCurrentYear,
  computeSalesReport,
  monthBuckets,
  monthPeriod,
  weekBuckets,
  yearPeriod,
  type SalesReportRaw,
  type SalesTenantRow,
} from "./sales-report";

/** Empty raw feed — tests fill in only what they need. */
function raw(overrides: Partial<SalesReportRaw> = {}): SalesReportRaw {
  return { payments: [], reservations: [], tenants: [], totalCapacity: 0, ...overrides };
}

function tenant(overrides: Partial<SalesTenantRow> = {}): SalesTenantRow {
  return {
    id: 1,
    name: "Tenant",
    move_in_date: "2026-08-01",
    moved_out_date: null,
    beds_occupied: 1,
    deposit_refunded: 0,
    deposit_refunded_amount: 0,
    room_number: "101",
    monthly_rate: 2500,
    ...overrides,
  };
}

describe("weekBuckets — weekly bars in month mode", () => {
  it("splits August 2026 (starts Saturday) into 4 buckets, merging the 1-day edge slivers", () => {
    // Aug 1 2026 is a Saturday. Calendar weeks Sun–Sat:
    // [Aug 1]→merged into [Aug 2–8] ⇒ [Aug 1–8], then Aug 9–15, 16–22,
    // [Aug 23–29]+[Aug 30–31]⇒merged ⇒ [Aug 23–31].
    const b = weekBuckets("2026-08-01", "2026-08-31");
    expect(b.map((x) => [x.start, x.end])).toEqual([
      ["2026-08-01", "2026-08-08"],
      ["2026-08-09", "2026-08-15"],
      ["2026-08-16", "2026-08-22"],
      ["2026-08-23", "2026-08-31"],
    ]);
    expect(b.map((x) => x.label)).toEqual(["Aug 1", "Aug 9", "Aug 16", "Aug 23"]);
  });

  it("keeps 5 buckets for December 2026 where both edge weeks are ≥ 4 days", () => {
    // Dec 1 2026 is a Tuesday, Dec 31 a Thursday: leading [Dec 1–5] (5 days)
    // and trailing [Dec 27–31] (5 days) are substantive — not merged.
    const b = weekBuckets("2026-12-01", "2026-12-31");
    expect(b).toHaveLength(5);
    expect(b[0]).toMatchObject({ start: "2026-12-01", end: "2026-12-05" });
    expect(b[4]).toMatchObject({ start: "2026-12-27", end: "2026-12-31" });
  });

  it("returns a single bucket when the period fits in one calendar week", () => {
    const b = weekBuckets("2026-08-01", "2026-08-01");
    expect(b).toEqual([{ start: "2026-08-01", end: "2026-08-01", label: "Aug 1" }]);
  });
});

describe("monthBuckets — monthly bars in year mode", () => {
  it("produces 12 Jan–Dec buckets with correct month bounds", () => {
    const b = monthBuckets(2026);
    expect(b).toHaveLength(12);
    expect(b[0]).toMatchObject({ start: "2026-01-01", end: "2026-01-31", label: "Jan" });
    expect(b[1]).toMatchObject({ start: "2026-02-01", end: "2026-02-28", label: "Feb" });
    expect(b[11]).toMatchObject({ start: "2026-12-01", end: "2026-12-31", label: "Dec" });
  });
});

describe("period builders", () => {
  it("builds a month period with ISO bounds and label", () => {
    const p = monthPeriod("2026-08", "2026-09-04");
    expect(p).toEqual({
      mode: "month",
      start: "2026-08-01",
      end: "2026-08-31",
      label: "August 2026",
      containsToday: false,
    });
  });

  it("flags the current month as containing today", () => {
    const p = monthPeriod("2026-09", "2026-09-04");
    expect(p.containsToday).toBe(true);
  });

  it("builds a year period", () => {
    const p = yearPeriod(2026, "2026-09-04");
    expect(p).toEqual({
      mode: "year",
      start: "2026-01-01",
      end: "2026-12-31",
      label: "2026",
      containsToday: true,
    });
  });
});

describe("computeSalesReport — sales math (cash basis)", () => {
  const aug = monthPeriod("2026-08", "2026-09-04");

  it("counts payments by paid_date, not covers_month", () => {
    const r = raw({
      payments: [
        { amount: 2500, paid_date: "2026-08-05" },
        { amount: 2500, paid_date: "2026-07-31" }, // outside → ignored
        { amount: 2500, paid_date: "2026-09-01" }, // outside → ignored
      ],
    });
    expect(computeSalesReport(r, aug, "2026-09-04").total).toBe(2500);
  });

  it("adds non-cancelled reservation deposits on reservation_date", () => {
    const r = raw({
      reservations: [
        { deposit: 1000, reservation_date: "2026-08-06", status: "active" },
        { deposit: 500, reservation_date: "2026-08-10", status: "converted" },
        { deposit: 2000, reservation_date: "2026-08-20", status: "cancelled" }, // excluded entirely
        { deposit: 300, reservation_date: "2026-07-15", status: "active" }, // outside → ignored
      ],
    });
    expect(computeSalesReport(r, aug, "2026-09-04").total).toBe(1500);
  });

  it("subtracts the exact deposit_refunded_amount in the move-out period", () => {
    const r = raw({
      tenants: [
        tenant({
          deposit_refunded: 1,
          deposit_refunded_amount: 1200, // exact cash returned (migration 063+)
          moved_out_date: "2026-08-15",
        }),
      ],
    });
    const rep = computeSalesReport(r, aug, "2026-09-04");
    // 0 payments + 0 deposits − 1200 exact refund → net −1200 (not −2000).
    expect(rep.total).toBe(-1200);
  });

  it("nets refunds against payments, allowing a negative total", () => {
    const r = raw({
      payments: [{ amount: 2500, paid_date: "2026-08-05" }],
      tenants: [
        tenant({ deposit_refunded: 1, deposit_refunded_amount: 4000, moved_out_date: "2026-08-20" }),
      ],
    });
    expect(computeSalesReport(r, aug, "2026-09-04").total).toBe(-1500);
  });

  it("ignores refunds for tenants who moved out outside the period", () => {
    const r = raw({
      tenants: [
        tenant({ deposit_refunded: 1, deposit_refunded_amount: 2000, moved_out_date: "2026-07-20" }),
        tenant({ deposit_refunded: 1, deposit_refunded_amount: 1000, moved_out_date: "2026-09-01" }),
      ],
    });
    expect(computeSalesReport(r, aug, "2026-09-04").total).toBe(0);
  });
});

describe("computeSalesReport — move-ins / move-outs", () => {
  const aug = monthPeriod("2026-08", "2026-09-04");

  it("lists move-ins and move-outs sorted by date then name", () => {
    const r = raw({
      tenants: [
        tenant({ id: 3, name: "Zara", move_in_date: "2026-08-20", monthly_rate: 1500 }),
        tenant({ id: 1, name: "Ana", move_in_date: "2026-08-20", monthly_rate: 2500 }),
        tenant({ id: 2, name: "Ben", move_in_date: "2026-08-02", moved_out_date: "2026-08-10", monthly_rate: 2000 }),
      ],
    });
    const rep = computeSalesReport(r, aug, "2026-09-04");
    expect(rep.moveIns.map((e) => e.name)).toEqual(["Ben", "Ana", "Zara"]);
    // Ben moved in AND out within the period → appears in both lists.
    expect(rep.moveOuts.map((e) => e.name)).toEqual(["Ben"]);
    expect(rep.moveIns[0]).toMatchObject({ name: "Ben", date: "2026-08-02", room: "101", rate: 2000 });
  });

  it("includes archived tenants in move-outs via their historical date", () => {
    const r = raw({
      tenants: [tenant({ moved_out_date: "2026-08-09" })],
    });
    expect(computeSalesReport(r, aug, "2026-09-04").moveOuts).toHaveLength(1);
  });

  it("returns empty lists with per-section none text support", () => {
    const rep = computeSalesReport(raw(), aug, "2026-09-04");
    expect(rep.moveIns).toEqual([]);
    expect(rep.moveOuts).toEqual([]);
  });

  it("skips junk-name tenants (numeric-only or blank) in both lists", () => {
    const r = raw({
      tenants: [
        // The reported bug: name literally "1", moved in AND out in the period.
        tenant({ id: 1, name: "1", move_in_date: "2026-08-04", moved_out_date: "2026-08-20", monthly_rate: 600 }),
        tenant({ id: 2, name: "   ", move_in_date: "2026-08-05", moved_out_date: "2026-08-21", monthly_rate: 600 }),
        tenant({ id: 3, name: "12345", move_in_date: "2026-08-06" }),
        // Real names are untouched.
        tenant({ id: 4, name: "Ana", move_in_date: "2026-08-07", moved_out_date: "2026-08-22", monthly_rate: 800 }),
      ],
    });
    const rep = computeSalesReport(r, aug, "2026-09-04");
    expect(rep.moveIns.map((e) => e.name)).toEqual(["Ana"]);
    expect(rep.moveOuts.map((e) => e.name)).toEqual(["Ana"]);
  });

  it("keeps names that merely contain digits (rooms, mixed text)", () => {
    const r = raw({
      tenants: [tenant({ id: 1, name: "Room 101", move_in_date: "2026-08-04" })],
    });
    expect(computeSalesReport(r, aug, "2026-09-04").moveIns.map((e) => e.name)).toEqual(["Room 101"]);
  });

  it("does not let the junk-name filter touch occupancy or sales math", () => {
    const r = raw({
      totalCapacity: 2,
      payments: [{ amount: 2500, paid_date: "2026-08-05" }],
      tenants: [
        // Occupies a bed and paid, but has a junk name.
        tenant({ id: 1, name: "1", beds_occupied: 2, move_in_date: "2026-01-01", monthly_rate: 2500 }),
      ],
    });
    const rep = computeSalesReport(r, aug, "2026-09-04");
    expect(rep.total).toBe(2500);
    expect(rep.occupancy).toEqual({ occupied: 2, total: 2, pct: 100 });
    expect(rep.moveIns).toEqual([]);
    expect(rep.moveOuts).toEqual([]);
  });
});

describe("computeSalesReport — occupancy", () => {
  const aug = monthPeriod("2026-08", "2026-09-04");

  it("counts beds of tenants active at the end of a past period", () => {
    const r = raw({
      totalCapacity: 4,
      tenants: [
        tenant({ id: 1, name: "A", beds_occupied: 2, move_in_date: "2026-01-01" }),
        // Moved out ON the period's last day → not occupied at end of period.
        tenant({ id: 2, name: "B", beds_occupied: 1, move_in_date: "2026-01-01", moved_out_date: "2026-08-31" }),
        // Moved out BEFORE the end → not occupied.
        tenant({ id: 3, name: "C", beds_occupied: 1, move_in_date: "2026-01-01", moved_out_date: "2026-08-30" }),
        // Moves in after the period → not occupied.
        tenant({ id: 4, name: "D", beds_occupied: 1, move_in_date: "2026-09-01" }),
      ],
    });
    const rep = computeSalesReport(r, aug, "2026-09-04");
    expect(rep.occupancy).toEqual({ occupied: 2, total: 4, pct: 50 });
  });

  it("uses today as the cutoff when the period contains today", () => {
    const sep = monthPeriod("2026-09", "2026-09-04");
    const r = raw({
      totalCapacity: 10,
      tenants: [
        // Moved in tomorrow → NOT occupied as of today, even though move_in ≤ month end.
        tenant({ id: 1, name: "Future", move_in_date: "2026-09-05" }),
        // Still in as of today; scheduled (future) move-out keeps them counted.
        tenant({ id: 2, name: "Present", move_in_date: "2026-01-01", moved_out_date: "2026-09-10" }),
      ],
    });
    const rep = computeSalesReport(r, sep, "2026-09-04");
    expect(rep.occupancy.occupied).toBe(1);
  });

  it("reports hasCapacity false when total_capacity is 0/unset", () => {
    const rep = computeSalesReport(raw({ tenants: [tenant()] }), aug, "2026-09-04");

    expect(rep.hasCapacity).toBe(false);
    expect(rep.occupancy).toEqual({ occupied: 1, total: 0, pct: 0 });
  });
});

describe("computeSalesReport — buckets & empty state", () => {
  const aug = monthPeriod("2026-08", "2026-09-04");

  it("distributes payments into weekly buckets (month mode)", () => {
    const r = raw({
      payments: [
        { amount: 100, paid_date: "2026-08-01" },
        { amount: 50, paid_date: "2026-08-08" },
        { amount: 700, paid_date: "2026-08-10" },
        { amount: 200, paid_date: "2026-08-31" },
        { amount: 999, paid_date: "2026-07-01" }, // outside → no bucket
      ],
    });
    const rep = computeSalesReport(r, aug, "2026-09-04");
    expect(rep.buckets.map((b) => b.amount)).toEqual([150, 700, 0, 200]);
    expect(rep.buckets.map((b) => b.start)).toEqual([
      "2026-08-01",
      "2026-08-09",
      "2026-08-16",
      "2026-08-23",
    ]);
    expect(rep.total).toBe(1050);
  });

  it("distributes sales into monthly buckets (year mode)", () => {
    const y = yearPeriod(2026, "2026-09-04");
    const r = raw({
      payments: [
        { amount: 100, paid_date: "2026-01-05" },
        { amount: 2500, paid_date: "2026-01-20" },
        { amount: 500, paid_date: "2026-03-10" },
      ],
      reservations: [{ deposit: 250, reservation_date: "2026-03-15", status: "active" }],
    });
    const rep = computeSalesReport(r, y, "2026-09-04");
    expect(rep.buckets).toHaveLength(12);
    expect(rep.buckets[0].amount).toBe(2600);
    expect(rep.buckets[1].amount).toBe(0);
    expect(rep.buckets[2].amount).toBe(750);
  });

  it("marks the report empty only when sales, move-ins, and move-outs are all zero", () => {
    expect(computeSalesReport(raw(), aug, "2026-09-04").isEmpty).toBe(true);
    // A tenant who moved in before the period occupies beds but is not
    // "activity" per the interview decision.
    expect(computeSalesReport(raw({ tenants: [tenant({ move_in_date: "2026-01-01" })] }), aug, "2026-09-04").isEmpty).toBe(true);
    const withPayment = raw({ payments: [{ amount: 1, paid_date: "2026-08-05" }] });
    expect(computeSalesReport(withPayment, aug, "2026-09-04").isEmpty).toBe(false);
    const withMoveIn = raw({ tenants: [tenant({ move_in_date: "2026-08-05" })] });
    expect(computeSalesReport(withMoveIn, aug, "2026-09-04").isEmpty).toBe(false);
  });
});

describe("navigation guards", () => {
  it("caps forward navigation at the current period", () => {
    expect(atCurrentMonth("2026-09", "2026-09")).toBe(true);
    expect(atCurrentMonth("2026-08", "2026-09")).toBe(false);
    expect(atCurrentYear(2026, 2026)).toBe(true);
    expect(atCurrentYear(2025, 2026)).toBe(false);
  });
});