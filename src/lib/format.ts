/**
 * Shared formatting helpers for dates and PHP currency amounts.
 * Previously duplicated across the route pages (tenants, reservations,
 * rooms, dashboard, settings).
 */

/** Format an ISO date string ("YYYY-MM-DD") as "M/D/YYYY"; empty → "—". */
export function formatDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

/** Format an ISO date string ("YYYY-MM-DD") as "Mon DD" (e.g. "Apr 27"); empty → "—". */
export function formatShortDay(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const phpPesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const phpPesoPreciseFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
});

/** Format a number as Philippine pesos with 0 decimal places (e.g. ₱2,500). */
export function phpPeso(amount: number): string {
  return phpPesoFormatter.format(amount);
}

/** Format a number as Philippine pesos with 2 decimal places (e.g. ₱2,500.00). */
export function phpPesoPrecise(amount: number): string {
  return phpPesoPreciseFormatter.format(amount);
}

/**
 * Render a room's display label with exactly one "Room" prefix. Room numbers
 * are free-form ("101", "Room 101", "Annex B"), so when a stored value
 * already includes the prefix (as the Room form placeholder suggests), never
 * duplicate it: "Room 101" → "Room 101", "101" → "Room 101".
 */
export function roomLabel(room_number: string): string {
  return /^room\b/i.test(room_number) ? room_number : `Room ${room_number}`;
}

/* ------------------------------------------------------------------ *
 * Month-key helpers ("YYYY-MM"). Shared by payments, receipts, and
 * the Earnings page so month math and labels agree everywhere.
 * ------------------------------------------------------------------ */

/** "YYYY-MM-DD" (or any string starting with a month key) → "YYYY-MM". */
export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Advance a "YYYY-MM" key by `n` months (n may be negative). */
export function addMonthsKey(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return key;
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** "2026-08" → "August 2026"; returns the input unchanged if not a valid key. */
export function formatMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return key;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * "2026-08".."2026-10" → "August 2026 – October 2026"; a single month or
 * missing bounds collapse to one label; null → "—".
 */
export function formatMonthRange(first: string | null, last: string | null): string {
  if (!first) return "—";
  if (!last || first === last) return formatMonthKey(first);
  return `${formatMonthKey(first)} – ${formatMonthKey(last)}`;
}

/**
 * True when a payment row uses the new due-date model (payment-due-date-spec):
 * `due_date` IS the specific covered due date, so its month equals
 * `covers_month`. Legacy rows store the running "new due" (one month past the
 * covered month) instead, so receipt/history displays can tell them apart.
 */
export function isDueDatePayment(row: { due_date: string; covers_month: string | null }): boolean {
  return !!row.covers_month && monthKeyOf(row.due_date) === row.covers_month;
}
