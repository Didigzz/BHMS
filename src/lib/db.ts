import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

let dbPromise: Promise<Database> | null = null;

/** True inside the Tauri WebView; false in the browser-preview shims. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Shared singleton connection to the app database. All pages use this instead
 * of creating their own connection so settings, reminders, and backup features
 * can share one handle.
 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      // The sql plugin refuses to open a database when an applied migration no
      // longer matches the SQL embedded in this build ("migration N was
      // previously applied but has been modified"). The Rust side rewrites the
      // recorded checksums to match before the plugin validates, so a database
      // created by an older build keeps working instead of bricking every page.
      if (isTauri()) {
        try {
          await invoke("repair_migrations");
        } catch (err) {
          // A failed repair must not mask the real database error below, but
          // log it so a lock/permission failure is distinguishable.
          console.warn("repair_migrations failed:", err);
        }
      }
      return Database.load("sqlite:boarding-house.db");
    })();
  }
  return dbPromise;
}

/**
 * Close the current connection (if any) and return a fresh one. Used after a
 * backup import replaces the underlying database file.
 */
export async function reconnectDb(): Promise<Database> {
  await closeDb();
  return getDb();
}

/**
 * Close and drop the shared connection without reopening it. The backup import
 * flow needs to release the live SQLite handle *before* it replaces the file
 * on disk (you cannot overwrite a WAL database while a connection is open).
 * Call `getDb()` afterwards to start a fresh connection.
 */
export async function closeDb(): Promise<void> {
  if (dbPromise) {
    try {
      await (await dbPromise).close();
    } catch {
      // Connection may already be gone — ignore and reopen below.
    }
    dbPromise = null;
  }
}
