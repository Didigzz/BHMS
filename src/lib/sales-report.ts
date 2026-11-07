/**
 * Sales Report math (sales-report-spec.md).
 *
 * Pure functions + types over plain data — no database access in the compute
 * path — so the numbers are unit-testable in isolation and the report page
 * just feeds in query results (mirrors `earnings.ts` / `bed-boxes.ts`).
 *
 * Rules (per the spec interview, review 2):
 * - Sales = cash-basis payments (`paid_date`, NOT `covers_month`) + holding
 *   deposits of non-cancelled reservations (`reservation_date`) − exact
 *   deposit refunds (`deposit_refunded_amount`, `moved_out_date`).
 * - An advance payment lands entirely in the month the cash actually came in.
 * - All tenants count for move-ins/move-outs (archived included via their
 *   true historical `moved_out_date`); cancelled reservations never appear.
 * - Occupancy = beds of tenants whose tenancy overlaps the end of the period
 *   (or today when the period contains today) ÷ the manual `total_capacity`
 *   setting; reservation holds are NOT counted.
 */

import type Database from "@tauri-apps/plugin-sql";
import { monthBounds } from "./earnings";
import { addMonthsKey, formatMonthKey, formatShortDay } from "./format";

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type ReportMode = "month" | "year";

/** A selectable report period, always ISO "YYYY-MM-DD" bounds. */
export interface SalesReportPeriod {
  mode: ReportMode;
  /** Inclusive first day ("YYYY-MM-DD"). */
  start: string;
  /** Inclusive last day ("YYYY-MM-DD"). */
  end: string;
  /** Display label: "August 2026" (month) / "2026" (year). */
  label: string;
  /** True when the period contains today — data is not final ("as of today"). */
  containsToday: boolean;
}

/** One payment row as read for the report (only the fields the math needs). */
export interface SalesPaymentRow {
  amount: number;
  paid_date: string;
}

/** One reservation row as read for the report. */
export interface SalesReservationRow {
  deposit: number | null;
  reservation_date: string;
  status: string;
}

/** One tenant row (rooms joined) as read for the report. */
export interface SalesTenantRow {
  id: number;
  name: string;
  move_in_date: string;
  moved_out_date: string | null;
  beds_occupied: number;
  deposit_refunded: number | null;
  deposit_refunded_amount: number | null;
  room_number: string;
  /** Tenant's monthly-rate snapshot, room rate as fallback (already resolved). */
  monthly_rate: number | null;
}

/** Raw rows + the manual capacity setting, as returned by `salesReportQuery`. */
export interface SalesReportRaw {
  payments: SalesPaymentRow[];
  reservations: SalesReservationRow[];
  tenants: SalesTenantRow[];
  /** The manual `total_capacity` setting (beds); 0 when unset/invalid. */
  totalCapacity: number;
}

/** A move-in / move-out line: `{name} — {Mon DD} · {Room} · {₱rate}/mo`. */
export interface SalesEvent {
  name: string;
  /** "YYYY-MM-DD" of the move-in or move-out. */
  date: string;
  /** Room number as stored (page renders it through roomLabel()). */
  room: string;
  /** Tenant's monthly-rate snapshot at reporting time. */
  rate: number;
}

/** One bar of the chart: a week (month mode) or a month (year mode). */
export interface SalesBucketDef {
  /** Inclusive ISO start ("YYYY-MM-DD"). */
  start: string;
  /** Inclusive ISO end ("YYYY-MM-DD"). */
  end: string;
  /** Short label: week start "Aug 1" or month short name "Aug". */
  label: string;
}

/** A bucket with its net sales total filled in. */
export interface SalesBucketTotal extends SalesBucketDef {
  amount: number;
}

export interface Occupancy {
  occupied: number;
  total: number;
  /** 0–100, rounded; 0 when total capacity is unset/zero. */
  pct: number;
}

export interface SalesReport {
  period: SalesReportPeriod;
  /** Net sales for the whole period (can be negative when refunds exceed cash in). */
  total: number;
  /** One bar per bucket, in chronological order. */
  buckets: SalesBucketTotal[];
  moveIns: SalesEvent[];
  moveOuts: SalesEvent[];
  /** Beds occupied at the end of the period ÷ the manual total capacity. */
  occupancy: Occupancy;
  /** False when `total_capacity` is 0/unset — the page renders the hint text. */
  hasCapacity: boolean;
  /** True only when sales = 0 AND no move-ins AND no move-outs. */
  isEmpty: boolean;
}

/* ------------------------------------------------------------------ *
 * Date helpers (all local-time, ISO "YYYY-MM-DD" strings)
 * ------------------------------------------------------------------ */

function isoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysIso(iso: string, n: number): string {
  const d = isoDate(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

/** Inclusive range length: start == end → 1. */
function spanDays(startIso: string, endIso: string): number {
  const ms = isoDate(endIso).getTime() - isoDate(startIso).getTime();
  return Math.round(ms / 86400000) + 1;
}

/** The Saturday ending the calendar week (Sun→Sat) containing `iso`. */
function saturdayOfWeek(iso: string): string {
  return addDaysIso(iso, (6 - isoDate(iso).getDay() + 7) % 7);
}

/** Local-time "YYYY-MM-DD" for today. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ *
 * Period builders
 * ------------------------------------------------------------------ */

/** Build the period for one month key ("YYYY-MM"); free back-nav, no lower bound. */
export function monthPeriod(key: string, today: string): SalesReportPeriod {
  const { first, last } = monthBounds(key);
  return {
    mode: "month",
    start: first,
    end: last,
    label: formatMonthKey(key),
    containsToday: today >= first && today <= last,
  };
}

/** Build the period for one 4-digit year; free back-nav, no lower bound. */
export function yearPeriod(year: number, today: string): SalesReportPeriod {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  return {
    mode: "year",
    start,
    end,
    label: String(year),
    containsToday: today >= start && today <= end,
  };
}

/* ------------------------------------------------------------------ *
 * DB query (thin async glue — the math below is pure)
 * ------------------------------------------------------------------ */

/**
 * Fetch the raw rows the report needs for `period`: cash-based payments,
 * reservation deposits, all tenants (join rooms for the number + rate), and
 * the manual `total_capacity` setting. `computeSalesReport` turns these into
 * the displayed report.
 */
export async function salesReportQuery(
  db: Database,
  period: SalesReportPeriod
): Promise<SalesReportRaw> {
  const payments = await db.select<SalesPaymentRow[]>(
    "SELECT amount, paid_date FROM payments WHERE paid_date >= $1 AND paid_date <= $2",
    [period.start, period.end]
  );
  const reservations = await db.select<SalesReservationRow[]>(
    "SELECT deposit, reservation_date, status FROM reservations WHERE reservation_date >= $1 AND reservation_date <= $2",
    [period.start, period.end]
  );
  const tenants = await db.select<SalesTenantRow[]>(
    `SELECT t.id, t.name, t.move_in_date, t.moved_out_date, t.beds_occupied,
            t.deposit_refunded, t.deposit_refunded_amount,
            r.room_number, COALESCE(t.monthly_rate, r.monthly_rate) AS monthly_rate
     FROM tenants t JOIN rooms r ON r.id = t.room_id`
  );
  const capacityRows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = 'total_capacity'"
  );
  return {
    payments,
    reservations,
    tenants,
    totalCapacity: Number(capacityRows[0]?.value) || 0,
  };
}

/* ------------------------------------------------------------------ *
 * Bucket helpers
 * ------------------------------------------------------------------ */

const MONTH_SHORT_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Split a month into weekly buckets (month mode: 4–5 bars). Weeks run
 * Sunday → Saturday (calendar day-of-week); the month is intersected with
 * each calendar week, and a leading/trailing sliver shorter than half a week
 * (≤ 3 days) is merged into its neighbor so partial weeks are merged at the
 * edges instead of rendering as 1-day stubs.
 */
export function weekBuckets(startISO: string, endISO: string): SalesBucketDef[] {
  const parts: { start: string; end: string }[] = [];
  let cursor = startISO;
  while (cursor <= endISO) {
    let weekEnd = saturdayOfWeek(cursor);
    if (weekEnd > endISO) weekEnd = endISO;
    parts.push({ start: cursor, end: weekEnd });
    if (weekEnd >= endISO) break;
    cursor = addDaysIso(weekEnd, 1);
  }
  if (parts.length > 1 && spanDays(parts[0].start, parts[0].end) <= 3) {
    // Merge the short leading sliver into the next full week.
    parts[0].end = parts[1].end;
    parts.splice(1, 1);
  }
  if (parts.length > 1 && spanDays(parts[parts.length - 1].start, parts[parts.length - 1].end) <= 3) {
    // Merge the short trailing sliver into the previous week.
    parts[parts.length - 2].end = parts[parts.length - 1].end;
    parts.pop();
  }
  return parts.map((p) => ({ ...p, label: formatShortDay(p.start) }));
}

/** Split a year into 12 monthly buckets (year mode: Jan–Dec bars). */
export function monthBuckets(year: number): SalesBucketDef[] {
  const buckets: SalesBucketDef[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, "0")}`;
    const { first, last } = monthBounds(key);
    buckets.push({ start: first, end: last, label: MONTH_SHORT_NAMES[m - 1] });
  }
  return buckets;
}

/* ------------------------------------------------------------------ *
 * The compute
 * ------------------------------------------------------------------ */

/** Round to 2 decimals to absorb REAL-arithmetic drift (same as earnings.ts). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const inRange = (date: string, start: string, end: string): boolean => date >= start && date <= end;

/**
 * True when a tenant name carries no real identity: blank/whitespace-only or
 * numeric-only (e.g. a stray "1"). Junk-name rows are skipped in the
 * move-ins/move-outs display lists so placeholder/test records don't show up
 * in the report — see sales-report-name-1-spec.md §7.2. Never applied to the
 * money math or occupancy (those don't read names; §3.4).
 */
function isJunkName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === "" || /^\d+$/.test(trimmed);
}

/** Net sales contributed by everything whose date lands in `[start, end]`. */
function bucketAmount(raw: SalesReportRaw, start: string, end: string): number {
  let amount = 0;
  for (const p of raw.payments) if (inRange(p.paid_date, start, end)) amount += p.amount;
  for (const r of raw.reservations) {
    if (r.status !== "cancelled" && r.deposit != null && inRange(r.reservation_date, start, end)) {
      amount += r.deposit;
    }
  }
  for (const t of raw.tenants) {
    if (t.deposit_refunded === 1 && t.moved_out_date != null && inRange(t.moved_out_date, start, end)) {
      amount -= t.deposit_refunded_amount ?? 0;
    }
  }
  return round2(amount);
}

/**
 * Turn the raw query rows into the displayed report for `period`.
 * `today` is the "as of" date (local ISO) used for the occupancy cutoff and
 * the containsToday decisions the page already made via monthPeriod/yearPeriod.
 */
export function computeSalesReport(raw: SalesReportRaw, period: SalesReportPeriod, today: string): SalesReport {
  const { start, end } = period;

  const total = bucketAmount(raw, start, end);

  const bucketDefs =
    period.mode === "year" ? monthBuckets(Number(start.slice(0, 4))) : weekBuckets(start, end);
  const buckets: SalesBucketTotal[] = bucketDefs.map((b) => ({ ...b, amount: bucketAmount(raw, b.start, b.end) }));

  const moveIns = raw.tenants
    .filter((t) => inRange(t.move_in_date, start, end) && !isJunkName(t.name))
    .map<SalesEvent>((t) => ({ name: t.name, date: t.move_in_date, room: t.room_number, rate: t.monthly_rate ?? 0 }))
    .sort(sortByDateThenName);

  const moveOuts = raw.tenants
    .filter((t) => t.moved_out_date != null && inRange(t.moved_out_date, start, end) && !isJunkName(t.name))
    .map<SalesEvent>((t) => ({ name: t.name, date: t.moved_out_date as string, room: t.room_number, rate: t.monthly_rate ?? 0 }))
    .sort(sortByDateThenName);

  // Occupancy: "heads in beds" at the END of the period — the last day for a
  // past period, TODAY for a period that contains today (data isn't final,
  // consistent with the "as of today" label). Holds are not counted.
  const asOf = period.containsToday ? today : end;
  const occupied = raw.tenants.reduce((acc, t) => {
    return t.move_in_date <= asOf && (t.moved_out_date == null || t.moved_out_date > asOf)
      ? acc + (t.beds_occupied ?? 1)
      : acc;
  }, 0);
  const totalCapacity = raw.totalCapacity;
  const hasCapacity = totalCapacity > 0;
  const pct = hasCapacity ? Math.min(100, Math.round((occupied / totalCapacity) * 100)) : 0;

  return {
    period,
    total,
    buckets,
    moveIns,
    moveOuts,
    occupancy: { occupied, total: hasCapacity ? totalCapacity : 0, pct },
    hasCapacity,
    isEmpty: total === 0 && moveIns.length === 0 && moveOuts.length === 0,
  };
}

function sortByDateThenName(a: SalesEvent, b: SalesEvent): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/* ------------------------------------------------------------------ *
 * Navigation helpers for the pickers (§3.4)
 * ------------------------------------------------------------------ */

/** True when the month picker's ▶ must be disabled: the month is at/after the current one. */
export function atCurrentMonth(key: string, currentKey: string): boolean {
  return key >= currentKey;
}

/** True when the year picker's ▶ must be disabled: the year is at/after the current one. */
export function atCurrentYear(year: number, currentYear: number): boolean {
  return year >= currentYear;
}

/** Step the month picker back one month (no lower bound). */
export function stepMonthBack(key: string): string {
  return addMonthsKey(key, -1);
}

/** Step the year picker back one year (no lower bound). */
export function stepYearBack(year: number): number {
  return year - 1;
}