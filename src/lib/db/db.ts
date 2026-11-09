import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

let dbPromise: Promise<Database> | null = null;

/**
 * Thrown instead of opening a database when this install has lost its own.
 *
 * The SQL plugin would otherwise create an empty database in its place, which is
 * indistinguishable from real data loss: the app would open looking normal and
 * empty. Throwing keeps that from ever happening silently.
 */
export class DatabaseMissingError extends Error {
  constructor(readonly latestSafetyCopy: string | null) {
    super(
      "RentEase cannot find its data file, and has not created an empty one in its place."
    );
    this.name = "DatabaseMissingError";
  }
}

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
      if (isTauri()) {
        // A missing data file on an install that has already run means something
        // went wrong. Refuse here, before the plugin can quietly create an empty
        // database that would look like the landlord's data had vanished.
        const state = await invoke<{
          databasePresent: boolean;
          hasRunBefore: boolean;
          latestSafetyCopy: string | null;
        }>("database_state");
        if (state.hasRunBefore && !state.databasePresent) {
          throw new DatabaseMissingError(state.latestSafetyCopy);
        }

        // The sql plugin refuses to open a database when an applied migration no
        // longer matches the SQL embedded in this build ("migration N was
        // previously applied but has been modified"). The Rust side rewrites the
        // recorded checksums to match before the plugin validates, so a database
        // created by an older build keeps working instead of bricking every page.
        try {
          await invoke("repair_migrations");
        } catch (err) {
          // A failed repair must not mask the real database error below, but
          // log it so a lock/permission failure is distinguishable.
          console.warn("repair_migrations failed:", err);
        }
      }
      const database = await Database.load("sqlite:boarding-house.db");
      if (isTauri()) {
        // Record that this install has a working database, so a later missing
        // file is recognised instead of looking like a first launch.
        invoke("mark_database_initialised").catch(() => {});
      }
      return database;
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
