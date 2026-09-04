export type PaymentStatus = "green" | "yellow" | "red";

export const STATUS_CONFIG = {
  // Days after the due date during which the tenant is still considered
  // "recently paid" (green) — assumes payment happens at the due date.
  RECENT_PAID_DAYS: 15,
  // Days past the due date that an unpaid tenant stays green — a short grace
  // window before the payment "has passed" and counts as overdue.
  OVERDUE_GRACE_DAYS: 2,
} as const;

/**
 * Compute payment status for a tenant based on their monthly due date and
 * the last date they had a payment recorded.
 *
 * The stored `dueDate` is the NEXT upcoming due date (a monthly anchor,
 * e.g. "2026-08-05" = rent due on the 5th of every month). When the
 * landlord records a payment, `dueDate` advances by one month and
 * `lastPaidDate` records that payment, which resets the cycle to GREEN.
 *
 * Status rules:
 * - GREEN  → within the first half of the paid period (from the last payment
 *            to the next due date). Advance payments push the due date
 *            forward several months, so the green window extends to the
 *            halfway point before that next due date.
 *            Falls back to a due-date comparison for tenants that have never
 *            had a payment recorded: green until the stored due date passes
 *            (plus the grace window), then red.
 * - RED    → the due date has passed without a recorded payment
 * - YELLOW → approaching the next due date (past the halfway point)
 *
 * @param dueDate ISO date string "YYYY-MM-DD" of the tenant's next due date
 * @param today reference date (defaults to now)
 * @param lastPaidDate ISO date string "YYYY-MM-DD" of the last recorded payment
 */
export function getPaymentStatus(dueDate: string, today: Date = new Date(), lastPaidDate?: string | null): PaymentStatus {
  const due = parseIsoDate(dueDate);
  if (!due) return "green";

  const now = startOfDay(today);

  // Explicit payment recorded → status derives from the payment, not the
  // recurring day-of-month anchor, so it turns green immediately.
  if (lastPaidDate) {
    const paid = parseIsoDate(lastPaidDate);
    if (paid) {
      const paidStart = startOfDay(paid);
      const daysSincePaid = Math.round((now.getTime() - paidStart.getTime()) / 86_400_000);
      const nextDue = startOfDay(due);
      const daysUntilDue = Math.round((nextDue.getTime() - now.getTime()) / 86_400_000);

      // Next due date has arrived without a new payment → overdue (red).
      if (daysUntilDue <= 0) return "red";

      // Advance-payment aware. The tenant stays green through the first half
      // of the paid period — measured from the last payment to the next due
      // date (which has been rolled forward when the payment was recorded), the
      // halfway point before the next rent. Paying several months ahead keeps
      // them green longer than the fixed recent-paid window would.
      const paidSpanDays = Math.max(0, Math.round((nextDue.getTime() - paidStart.getTime()) / 86_400_000));
      const greenDays = Math.max(STATUS_CONFIG.RECENT_PAID_DAYS, Math.round(paidSpanDays / 2));

      if (daysSincePaid <= greenDays) return "green";
      // Past the halfway point, next due still ahead → yellow.
      return "yellow";
    }
  }

  // Legacy fallback: no recorded payment. A tenant is only overdue once their
  // stored due date has passed (plus the grace window) — before that they're
  // current. The old day-of-month anchor made every tenant "due" on that day
  // each month, so a brand-new tenant (due = their move-in day, per
  // first-payment-month-spec) showed red "Due today" the moment they were
  // created. For these tenants the stored due date is a specific date, not a
  // recurring day-of-month.
  const daysSinceDue = Math.round((now.getTime() - due.getTime()) / 86_400_000);
  if (daysSinceDue <= STATUS_CONFIG.OVERDUE_GRACE_DAYS) return "green";
  return "red";
}

/** Human-readable label for a payment status given a due date. */
export function paymentLabel(
  status: PaymentStatus,
  dueDate: string,
  today: Date = new Date(),
  lastPaidDate?: string | null,
): string {
  const due = parseIsoDate(dueDate);
  if (!due) return "No due date";

  const now = startOfDay(today);
  const dayOfMonth = due.getDate();
  // For tenants with a recorded payment, the stored due date IS the next due
  // date (it was rolled forward on payment) — measure from it directly.
  const actualDaysUntilDue = Math.round((startOfDay(due).getTime() - now.getTime()) / 86_400_000);
  const daysUntilDue = Math.round((nextOccurrenceOfDay(dayOfMonth, now).getTime() - now.getTime()) / 86_400_000);

  switch (status) {
    case "red":
      // Tenants with a recorded payment are red only because the next due
      // date arrived — measure overdue from that exact date.
      if (lastPaidDate) {
        return actualDaysUntilDue === 0 ? "Due today" : `Overdue ${-actualDaysUntilDue}d`;
      }
      // Unpaid tenants: overdue counts from the stored due date (not the
      // recurring day-of-month), so it doesn't reset each month.
      const overdueDays = Math.max(0, Math.round((now.getTime() - startOfDay(due).getTime()) / 86_400_000));
      return overdueDays === 0 ? "Due today" : `Overdue ${overdueDays}d`;
    case "yellow":
      if (lastPaidDate) return `Due in ${Math.max(actualDaysUntilDue, 0)}d`;
      return `Due in ${daysUntilDue}d`;
    case "green":
    default:
      // Unpaid tenants that simply aren't due yet read "Current"; tenants
      // with a recorded payment read "Paid".
      return lastPaidDate ? "Paid" : "Current";
  }
}

/**
 * Days until the tenant's next due date. Positive = upcoming; <= 0 means the
 * due date has arrived (pair with getPaymentStatus for the full status).
 * Tenants with a recorded payment use their stored due date directly (it was
 * rolled forward on each payment); legacy tenants use the monthly day-of-month
 * anchor, so the result is always >= 1 and status handles the overdue state.
 */
export function daysUntilDue(dueDate: string, today: Date = new Date(), lastPaidDate?: string | null): number {
  const due = parseIsoDate(dueDate);
  if (!due) return Number.POSITIVE_INFINITY;
  const now = startOfDay(today);
  if (lastPaidDate) {
    return Math.round((startOfDay(due).getTime() - now.getTime()) / 86_400_000);
  }
  return Math.round((nextOccurrenceOfDay(due.getDate(), now).getTime() - now.getTime()) / 86_400_000);
}

/**
 * Advance an ISO date by a number of months, clamping the day to the target
 * month's length (e.g. Jan 31 → Feb 28). Used to roll the due date forward
 * by one month when a payment is recorded.
 */
export function addMonths(isoDate: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const [, y, mo, d] = m;
  const target = new Date(Number(y), Number(mo) - 1 + months, 1);
  const clampedDay = Math.min(Number(d), daysInMonth(target.getFullYear(), target.getMonth()));
  const targetDate = new Date(target.getFullYear(), target.getMonth(), clampedDay);
  return formatIsoDate(targetDate);
}

function formatIsoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Next date strictly after `ref` that falls on `dayOfMonth` (clamped to month length). */
function nextOccurrenceOfDay(dayOfMonth: number, ref: Date): Date {
  const clamped = Math.min(dayOfMonth, daysInMonth(ref.getFullYear(), ref.getMonth()));
  const candidate = new Date(ref.getFullYear(), ref.getMonth(), clamped);
  if (candidate.getTime() > ref.getTime()) return candidate;
  const next = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
  return new Date(next.getFullYear(), next.getMonth(), Math.min(dayOfMonth, daysInMonth(next.getFullYear(), next.getMonth())));
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}