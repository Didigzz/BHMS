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
