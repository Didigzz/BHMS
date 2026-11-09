import { getDb } from "./db";

/**
 * Tiny key/value settings store backed by the `settings` table (migration v23).
 * Keys and values are plain strings; number/boolean conversion is the caller's
 * responsibility. Seeded defaults: `reminder_days = '3'`,
 * `notifications_enabled = '1'`.
 */

export async function getSetting(key: string, fallback: string): Promise<string> {
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = $1",
      [key]
    );
    return rows.length > 0 ? rows[0].value : fallback;
  } catch {
    // The settings table may not exist yet on an un-migrated database;
    // fall back to the default instead of breaking the page.
    return fallback;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value]
  );
}
