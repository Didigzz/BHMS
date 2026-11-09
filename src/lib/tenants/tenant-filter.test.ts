import { describe, it, expect } from "vitest";
import {
  BUCKETS,
  DUE_SOON_WINDOW_DAYS,
  bucketOf,
  matchesBucket,
  parseBucket,
  type TenantBucket,
} from "./tenant-filter";

// Local-noon reference date, so the startOfDay() math inside payment-status.ts
// can't shift day counts on machines behind UTC.
function d(y: number, mo: number, day: number): Date {
  return new Date(y, mo - 1, day, 12);
}

/** Reference "today" for the whole suite — Sep 14 2026 (matches the spec tables). */
const TODAY = d(2026, 9, 14);

function tenant(due: string, lastPaid: string | null = null) {
  return { due_date: due, last_paid_date: lastPaid };
}

describe("bucketOf — red tenants collapse into one 'due' bucket", () => {
  it("sends overdue tenants to 'due'", () => {
    expect(bucketOf(tenant("2026-09-01"), TODAY)).toBe("due");
  });

  it("sends due-today tenants to 'due' too (Round 1: not split out)", () => {
    expect(bucketOf(tenant("2026-09-14"), TODAY)).toBe("due");
  });

  it("sends a paid tenant whose rolled-forward due date arrived to 'due' (red beats paid)", () => {
    expect(bucketOf(tenant("2026-09-05", "2026-08-05"), TODAY)).toBe("due");
  });
});

describe("bucketOf — never-paid tenants and the 14-day window", () => {
  it("sends a never-paid tenant due soon to 'due-soon' even though the badge reads 'Current'", () => {
    // Green (due date still ahead) + no recorded payment → rule 4 (Round 4).
    expect(bucketOf(tenant("2026-09-20"), TODAY)).toBe("due-soon"); // 6 days
  });

  it("includes the 14-day boundary (inclusive) and excludes day 15", () => {
    expect(bucketOf(tenant("2026-09-28"), TODAY)).toBe("due-soon"); // exactly 14
    expect(bucketOf(tenant("2026-09-29"), TODAY)).toBe(null); // 15 — outside
  });

  it("keeps never-paid tenants due further out out of every bucket ('Current' = All only)", () => {
    expect(bucketOf(tenant("2026-10-05"), TODAY)).toBe(null); // 21 days
  });
});

describe("bucketOf — recorded-payment tenants (status first, Round 6)", () => {
  it("keeps a green paid tenant in 'paid' even when the due date is inside the window", () => {
    // Paid Sep 5 → due Sep 20: still green, so rule 3 wins over the date window.
    expect(bucketOf(tenant("2026-09-20", "2026-09-05"), TODAY)).toBe("paid");
  });

  it("keeps advance payers in 'paid'", () => {
    expect(bucketOf(tenant("2026-11-05", "2026-08-05"), TODAY)).toBe("paid"); // 3 months ahead
  });

  it("moves a paid tenant to 'due-soon' once their status turns yellow", () => {
    // Paid Aug 5 → due Sep 5: yellow from Aug 22 through Sep 4.
    expect(bucketOf(tenant("2026-09-05", "2026-08-05"), d(2026, 8, 25))).toBe("due-soon");
  });
});

describe("bucketOf — unparseable/blank due dates match no bucket", () => {
  it("returns null for blank, malformed, and non-ISO due dates", () => {
    expect(bucketOf(tenant(""), TODAY)).toBe(null);
    expect(bucketOf(tenant("not-a-date"), TODAY)).toBe(null);
    expect(bucketOf(tenant("2026/09/20"), TODAY)).toBe(null);
  });

  it("still returns null when a payment exists — a data-problem row is never bucketed (R3)", () => {
    // The badge on such a row reads "Paid", so this is the one documented case
    // where bucket and badge disagree.
    expect(bucketOf(tenant("not-a-date", "2026-08-05"), TODAY)).toBe(null);
  });
});

describe("matchesBucket", () => {
  it("matches every tenant when no bucket is selected", () => {
    expect(matchesBucket(tenant("2026-09-01"), null, TODAY)).toBe(true);
    expect(matchesBucket(tenant("2026-12-01"), null, TODAY)).toBe(true);
  });

  it("matches only the selected bucket", () => {
    const overdue = tenant("2026-09-01");
    const dueSoon = tenant("2026-09-20");
    const paid = tenant("2026-09-20", "2026-09-05");

    expect(matchesBucket(overdue, "due", TODAY)).toBe(true);
    expect(matchesBucket(overdue, "paid", TODAY)).toBe(false);
    expect(matchesBucket(dueSoon, "due-soon", TODAY)).toBe(true);
    expect(matchesBucket(dueSoon, "due", TODAY)).toBe(false);
    expect(matchesBucket(paid, "paid", TODAY)).toBe(true);
    expect(matchesBucket(paid, "due-soon", TODAY)).toBe(false);
  });
});

describe("parseBucket — URL ?status= values", () => {
  it("round-trips the three known keys", () => {
    const keys: TenantBucket[] = ["paid", "due-soon", "due"];
    for (const key of keys) expect(parseBucket(key)).toBe(key);
  });

  it("degrades unknown/blank/miscased values to null (no filter)", () => {
    expect(parseBucket(null)).toBe(null);
    expect(parseBucket(undefined)).toBe(null);
    expect(parseBucket("")).toBe(null);
    expect(parseBucket("PAID")).toBe(null);
    expect(parseBucket("all")).toBe(null);
    expect(parseBucket("overdue")).toBe(null);
    expect(parseBucket("banana")).toBe(null);
  });
});

describe("filter constants", () => {
  it("locks the 14-day due-soon window", () => {
    expect(DUE_SOON_WINDOW_DAYS).toBe(14);
  });

  it("exposes exactly the three locked chips, in order, with their locked labels", () => {
    expect(BUCKETS.map((b) => b.key)).toEqual(["paid", "due-soon", "due"]);
    expect(BUCKETS.map((b) => b.label)).toEqual(["Paid", "Due soon", "Due today / Overdue"]);
    for (const b of BUCKETS) expect(b.empty.length).toBeGreaterThan(0);
  });
});
