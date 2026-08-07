/**
 * Monthly earnings math (billing-features-spec.md §7).
 *
 * Pure functions over plain data — no database access — so the numbers can be
 * unit-tested in isolation and the dashboard just feeds in query results.
 *
 * Rules (per the spec interview):
 * - A tenant counts for a full month whenever their tenancy overlapped it,
 *   regardless of mid-month move-in/out.
 * - Expected = sum of the monthly rate of every active tenant.
 * - Collected = payments whose covers_month is the month (advance payments are
 *   split into one row per covered month, so this is exact).
 * - Pending = expected − collected (per-tenant max(0, rate − collected), which
 *   stays correct even if a partial payment ever slips in).
 */

export interface EarningsTenant {
  id: number;
  name: string;
  room_number: string;
  /** Monthly rate charged to this tenant (snapshot). */
  rate: number;
  move_in_date: string; // "YYYY-MM-DD"
  moved_out_date: string | null;
}

export interface EarningsPayment {
  tenant_id: number;
  amount: number;
  covers_month: string | null; // "YYYY-MM"
}

export interface EarningsRow {
  tenant: EarningsTenant;
  /** Sum of payments covering this month for the tenant. */
  collected: number;
  paid: boolean;
}

export interface MonthSummary {
  month: string; // "YYYY-MM"
  expected: number;
  collected: number;
  pending: number;
  paidCount: number;
  unpaidCount: number;
  rows: EarningsRow[];
}

/** Local-time "YYYY-MM" for today. */
export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** First and last day ("YYYY-MM-DD") of a month key. */
export function monthBounds(key: string): { first: string; last: string } {
  const [y, m] = key.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate(); // day 0 of the next month
  return {
    first: `${y}-${String(m).padStart(2, "0")}-01`,
    last: `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * Full-month counting: active when the tenancy overlaps the month at all
 * (move-in on or before the month's last day, and not moved out before the
 * month's first day). ISO strings compare lexicographically, which is correct
 * for YYYY-MM-DD.
 */
export function isActiveInMonth(
  tenant: Pick<EarningsTenant, "move_in_date" | "moved_out_date">,
  key: string,
): boolean {
  const { first, last } = monthBounds(key);
  if (tenant.move_in_date > last) return false;
  if (tenant.moved_out_date != null && tenant.moved_out_date < first) return false;
  return true;
}

/** Round to 2 decimals to absorb REAL-arithmetic drift (e.g. 0.1 + 0.2). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the summary for one month from all tenants (active + archived) and
 * all payments. Rows are sorted by tenant name.
 */
export function computeMonthSummary(
  tenants: EarningsTenant[],
  payments: EarningsPayment[],
  month: string,
): MonthSummary {
  const active = tenants.filter((t) => isActiveInMonth(t, month));
  const activeIds = new Set(active.map((t) => t.id));

  // Only payments belonging to active tenants count toward the month (a
  // stray payment for an excluded tenant must not inflate collected).
  const collectedByTenant = new Map<number, number>();
  for (const payment of payments) {
    if (payment.covers_month !== month || !activeIds.has(payment.tenant_id)) continue;
    collectedByTenant.set(
      payment.tenant_id,
      round2((collectedByTenant.get(payment.tenant_id) ?? 0) + payment.amount),
    );
  }

  const rows: EarningsRow[] = active
    .map((tenant) => {
      const collected = collectedByTenant.get(tenant.id) ?? 0;
      // Small epsilon keeps float drift from flipping the paid flag; a real
      // underpayment still counts as unpaid.
      return { tenant, collected, paid: collected >= tenant.rate - 0.005 };
    })
    .sort((a, b) => a.tenant.name.localeCompare(b.tenant.name));

  const expected = round2(rows.reduce((acc, r) => acc + r.tenant.rate, 0));
  const collected = round2(rows.reduce((acc, r) => acc + r.collected, 0));
  const pending = round2(rows.reduce((acc, r) => acc + Math.max(0, r.tenant.rate - r.collected), 0));
  const paidCount = rows.filter((r) => r.paid).length;

  return {
    month,
    expected,
    collected,
    pending,
    paidCount,
    unpaidCount: rows.length - paidCount,
    rows,
  };
}
