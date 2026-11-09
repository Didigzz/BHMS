/**
 * Database health: the pre-restore preflight, the app-folder safety copy, and
 * the state the startup guard needs.
 *
 * These are the parts of a restore that have to work when the ordinary path
 * cannot. Another program holding the database file open makes replacing it
 * impossible, so the app keeps its own copy of the pre-restore data and must
 * never present an empty database as though nothing had happened.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./db";

/** What a restore needs before it is worth starting. */
export interface RestorePreflight {
  canWriteDirectory: boolean;
  canReadDatabase: boolean;
  /** A plain-language reason, when something is wrong. */
  reason: string | null;
}

/** How the startup guard should treat the current database. */
export interface DatabaseState {
  databasePresent: boolean;
  /** Whether this install has opened its database before. */
  hasRunBefore: boolean;
  latestSafetyCopy: string | null;
}

/**
 * Should the app show the recovery screen instead of itself?
 *
 * A missing database is only alarming when the app has run before: on a first
 * launch there is nothing to have lost, and the database is simply created.
 */
export function needsRecovery(state: DatabaseState): boolean {
  return state.hasRunBefore && !state.databasePresent;
}

/** Without Tauri (browser preview) there is nothing to guard. */
export async function readDatabaseState(): Promise<DatabaseState> {
  if (!isTauri()) {
    return { databasePresent: true, hasRunBefore: true, latestSafetyCopy: null };
  }
  return invoke<DatabaseState>("database_state");
}

/**
 * Ask whether a restore can start at all, before the safety copy is written so
 * an impossible restore is refused without touching anything.
 */
export async function runRestorePreflight(): Promise<RestorePreflight> {
  if (!isTauri()) {
    return { canWriteDirectory: true, canReadDatabase: true, reason: null };
  }
  return invoke<RestorePreflight>("restore_preflight");
}

/**
 * Keep a copy of the pre-restore data inside the app's own folder.
 *
 * Best-effort on purpose: the Downloads copy is the landlord's copy, and this
 * one only exists so a recovery never depends on finding or picking a file.
 * Returns the path it wrote, or null when it could not.
 */
export async function saveSafetyCopy(text: string, fileName: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>("save_safety_copy", { content: text, fileName });
  } catch (error) {
    console.warn("safety copy could not be written to the app folder:", error);
    return null;
  }
}

/** Put the newest safety copy back (used by the recovery screen). */
export async function restoreSafetyCopy(): Promise<void> {
  await invoke("restore_safety_copy");
}
