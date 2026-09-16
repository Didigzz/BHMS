import { daysUntilDue, getPaymentStatus } from "./payment-status";

/**
 * Tenant payment-status filter buckets (tenant-payment-filter-spec.md).
 *
 * The chips under the tenants-page search box are driven entirely by this
 * module, so the bucket a card falls into can never disagree with the badge
 * that card renders (see `bucketOf` for the one documented exception: rows
 * with an unparseable due date).
 */
export type TenantBucket = "paid" | "due-soon" | "due";

/**
 * Days before the due date at which a never-paid tenant counts as "Due soon"
 * (Round 4 — deliberately wider than the dashboard's 7-day "due this week"
 * count, so the landlord gets follow-up lead time).
 */
export const DUE_SOON_WINDOW_DAYS = 14;

/** Chip definitions — single source of truth for keys, labels, and empty-state copy. */
export const BUCKETS: { key: TenantBucket; label: string; empty: string }[] = [
  { key: "paid", label: "Paid", empty: "No tenants have a recorded payment." },
  { key: "due-soon", label: "Due soon", empty: "No tenants are due soon." },
  { key: "due", label: "Due today / Overdue", empty: "No tenants are due today or overdue." },
];

/** The minimal tenant shape the filter needs (`Tenant` satisfies it). */
export interface FilterableTenant {
  due_date: string;
  last_paid_date: string | null;
}

/**
 * Bucket for one tenant, or `null` when it belongs to no bucket — such rows
 * are visible only while the filter is cleared.
 *
 * Rules (status first, then the date window — Round 6 precedence):
 * 0. blank/unparseable due date            → `null` (a data-problem row is never bucketed)
 * 1. status red (due today or overdue)     → `"due"` (one combined bucket, Round 1)
 * 2. status yellow (paid branch halfway)   → `"due-soon"`
 * 3. green WITH a recorded payment         → `"paid"` (beats the date window, Round 6)
 * 4. green, never paid, due in 0 < d ≤ 14  → `"due-soon"` (Round 4 — the window spans
 *                                            tenants whose badge still reads "Current")
 * 5. otherwise                             → `null` ("Current" tenants due further out)
 *
 * Rule 3 tests `last_paid_date` for truthiness rather than parseability, which
 * mirrors `paymentLabel`'s own `lastPaidDate ? "Paid" : "Current"` test — so
 * bucket and badge agree even for a garbage `last_paid_date` (badge "Paid").
 *
 * @param tenant tenant row (or anything with a due date + last paid date)
 * @param today reference date (defaults to now)
 */
export function bucketOf(tenant: FilterableTenant, today: Date = new Date()): TenantBucket | null {
  // 0. Unparseable/blank due date: the status helper would treat this as green,
  // which would put a broken row inside "Paid" — keep it unbucketed instead.
  if (!isParsableIsoDate(tenant.due_date)) return null;

  const status = getPaymentStatus(tenant.due_date, today, tenant.last_paid_date);
  if (status === "red") return "due";
  if (status === "yellow") return "due-soon";
  if (tenant.last_paid_date) return "paid";

  // Only green, never-paid tenants reach here, so their stored due date is
  // still ahead and `daysUntilDue` returns a positive day count (the legacy
  // day-of-month branch and the stored date agree in that state).
  const days = daysUntilDue(tenant.due_date, today, tenant.last_paid_date);
  return days > 0 && days <= DUE_SOON_WINDOW_DAYS ? "due-soon" : null;
}

/** `true` when no bucket is selected (`null`) or the tenant belongs to that bucket. */
export function matchesBucket(
  tenant: FilterableTenant,
  bucket: TenantBucket | null,
  today: Date = new Date(),
): boolean {
  return bucket === null || bucketOf(tenant, today) === bucket;
}

/**
 * Parse a `?status=` value. Unknown/blank/case-mismatched values degrade to
 * `null` (no filter, show everyone) — mirroring the `?room=` handling in the
 * tenants page, which silently ignores an unknown room id.
 */
export function parseBucket(raw: string | null | undefined): TenantBucket | null {
  return raw === "paid" || raw === "due-soon" || raw === "due" ? raw : null;
}

/** Mirrors `parseIsoDate` in payment-status.ts (`"YYYY-MM-DD"` that yields a real Date). */
function isParsableIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return false;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return !Number.isNaN(date.getTime());
}
