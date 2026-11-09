import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { getDb } from "../db/db";
import { getSetting } from "../db/settings";
import { daysUntilDue, getPaymentStatus } from "../tenants/payment-status";
import { formatDate, phpPeso } from "../ui/format";

/**
 * Check-on-open notification engine (implementation-plan.md §2.3).
 *
 * Runs on app start (and is safe to call after data mutations): it compares
 * every active tenant's due date against today and pings the landlord for
 * anything that needs attention, using `notifications_log` to guarantee a
 * tenant is never pinged twice for the same due date:
 *
 *   - `reminder`    → fires when 0 < days-until-due <= reminder_days (default 3)
 *   - `overdue`     → fires when the stored due date has passed unpaid (from
 *                     the day after the due date; the due day shows red in-app
 *                     but does not ping — due-date-status-fix-spec.md §3.7)
 *   - `overdue-7`   → fires instead of `overdue` once a tenant is 7+ days past
 *                     due (missed pings catch up to the most severe level, so
 *                     reopening the app late sends one ping, not three)
 *
 * Advancing the due date via Record Payment changes the `due_date` used in
 * the de-dupe key, which naturally re-arms the reminder for the next cycle.
 *
 * The dashboard's in-app summary always shows due/overdue tenants regardless
 * of OS permission — this function only *adds* OS notifications on top.
 */

const OVERDUE_FOLLOWUP_DAYS = 7;

interface DueTenant {
  id: number;
  name: string;
  due_date: string;
  last_paid_date: string | null;
  monthly_rate: number;
}

/** Whole-day distance from `today` to the *stored* due date (can be negative). */
function rawDaysUntil(dueDate: string, today: Date): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!m) return Number.POSITIVE_INFINITY;
  const [, y, mo, d] = m;
  const due = new Date(Number(y), Number(mo) - 1, Number(d));
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** ISO date `days` days after `today` — the actual upcoming due date implied by
 * `daysUntilDue()` (correct for paid tenants *and* legacy day-of-month anchors). */
function isoAfterDays(today: Date, days: number): string {
  const d = new Date(today);
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Reserve a ping in the de-dupe log. Returns true only if this (tenant,
 * kind, due_date) combination was NOT already logged — callers send the
 * notification only in that case.
 */
async function claimPing(tenantId: number, kind: string, dueDate: string): Promise<boolean> {
  try {
    const db = await getDb();
    const result = await db.execute(
      "INSERT OR IGNORE INTO notifications_log (tenant_id, kind, due_date, notified_at) VALUES ($1, $2, $3, $4)",
      [tenantId, kind, dueDate, new Date().toISOString()]
    );
    return result.rowsAffected > 0;
  } catch {
    // Logging is best-effort — never let a notification sweep break app start.
    return false;
  }
}

async function send(title: string, body: string): Promise<void> {
  try {
    await sendNotification({ title, body });
  } catch {
    // Notification delivery is best-effort; the in-app summary still covers it.
  }
}

/** Evaluate a single tenant and fire whatever pings are due for them. */
async function checkTenant(t: DueTenant, reminderDays: number, today: Date): Promise<void> {
  const days = daysUntilDue(t.due_date, today, t.last_paid_date);
  const status = getPaymentStatus(t.due_date, today, t.last_paid_date);

  // Reminder — a few days before the next due date (legacy tenants without a
  // recorded payment use their monthly day-of-month anchor via daysUntilDue).
  // The `status !== "red"` gate prevents a reminder + overdue ping pair for a
  // legacy tenant whose next anchor is inside the window while already overdue.
  if (reminderDays > 0 && days > 0 && days <= reminderDays && status !== "red") {
    if (await claimPing(t.id, "reminder", t.due_date)) {
      await send(
        "Rent due soon",
        `${t.name} — ${phpPeso(t.monthly_rate)} due ${formatDate(isoAfterDays(today, days))} (in ${days}d).`
      );
    }
  }

  // Overdue — the stored due date passed unpaid (the status gate keeps legacy
  // tenants honest: they only go red after their monthly anchor passes).
  // The UI turns red on the due day itself, but the OS ping waits until the
  // day after (due-date-status-fix-spec.md §3.7) — no same-day "overdue".
  if (status === "red") {
    const overdueDays = -rawDaysUntil(t.due_date, today);
    if (overdueDays >= OVERDUE_FOLLOWUP_DAYS) {
      if (await claimPing(t.id, "overdue-7", t.due_date)) {
        await send(
          "Rent still overdue",
          `${t.name} — ${phpPeso(t.monthly_rate)} was due ${formatDate(t.due_date)}.`
        );
      }
    } else if (overdueDays >= 1) {
      if (await claimPing(t.id, "overdue", t.due_date)) {
        await send(
          "Rent overdue",
          `${t.name} — rent was due ${formatDate(t.due_date)}.`
        );
      }
    }
  }
}

/**
 * Check every active tenant and fire any due notifications. Safe to call from
 * anywhere (layout mount, after mutations); swallows all errors so the app
 * flow is never interrupted.
 */
export async function checkAndNotify(): Promise<void> {
  try {
    // 1. User opted out in Settings?
    if ((await getSetting("notifications_enabled", "1")) !== "1") return;

    // 2. OS permission? Silently skip if missing — Settings shows the request
    //    button, and the dashboard summary is the in-app fallback.
    let granted = false;
    try {
      granted = await isPermissionGranted();
    } catch {
      granted = false;
    }
    if (!granted) return;

    const reminderDays = Math.max(0, Math.min(30, Number(await getSetting("reminder_days", "3")) || 3));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const db = await getDb();
    const tenants = await db.select<DueTenant[]>(
      `SELECT t.id, t.name, t.due_date, t.last_paid_date,
              COALESCE(t.monthly_rate, r.monthly_rate) AS monthly_rate
       FROM tenants t
       JOIN rooms r ON r.id = t.room_id
       WHERE t.moved_out_date IS NULL`
    );

    for (const t of tenants) {
      await checkTenant(t, reminderDays, today);
    }
  } catch {
    // Never let a notification sweep break app startup.
  }
}
