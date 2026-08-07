import { readFile, writeFile, remove, rename } from "@tauri-apps/plugin-fs";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getDb, closeDb } from "./db";
import { setSetting } from "./settings";

/**
 * Backup & restore for the live SQLite database.
 *
 * Export: flush a consistent snapshot (`VACUUM INTO` handles WAL mode),
 * then let the user pick a destination via the native save/share dialog.
 * The path returned by `dialog.save()` is automatically added to the fs
 * scope, so writing to it needs no extra capability; on Android the dialog
 * returns a content URI that the fs plugin understands.
 *
 * Import: pick a file, validate the SQLite header, then perform a
 * close → swap → reconnect cycle (see implementation-plan.md §2.4):
 *   1. close the live connection (a WAL database cannot be overwritten
 *      while a connection is open),
 *   2. move the current file aside as `<db>.bak` (rollback point),
 *   3. write the imported file in place,
 *   4. reopen and run `PRAGMA integrity_check`,
 *   5. on failure restore the `.bak`; on success delete it.
 */

const SQLITE_HEADER = "SQLite format 3\u0000"; // first 16 bytes of every SQLite file

// plugin-fs v2 has no base64 option — readFile returns bytes, so convert at the
// plugin boundary and keep the base64-string contract used across this module.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface BackupResult {
  canceled: boolean;
  path?: string;
}

export interface ChosenBackup {
  filePath: string;
  dataBase64: string;
  fileName: string;
}

/** Absolute path of the live `boarding-house.db`, reported by SQLite itself. */
async function liveDbPath(): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ name: string; file: string }[]>(
    "SELECT * FROM pragma_database_list"
  );
  const main = rows.find((r) => r.name === "main");
  if (!main?.file) throw new Error("Could not locate the database file on this device.");
  return main.file;
}

/** Spec filename convention: `digal-boarding-house-backup-2026-08-06.db`. */
function backupFileName(): string {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return `digal-boarding-house-backup-${iso}.db`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function escapeSql(s: string): string {
  return s.replace(/'/g, "''");
}

/** Best-effort display name from a filesystem path or Android content URI. */
function displayName(path: string): string {
  const segments = path.split(/[\\/]/);
  const last = segments[segments.length - 1];
  return last || path;
}

function isSqliteFile(dataBase64: string): boolean {
  try {
    // 16 bytes → 24 base64 chars; decode just enough to check the header.
    const head = atob(dataBase64.slice(0, 24));
    return head.startsWith(SQLITE_HEADER);
  } catch {
    return false;
  }
}

/**
 * Cheap schema sniff: SQLite stores the sqlite_master schema text verbatim in
 * the file, so the CREATE TABLE statements from our migrations appear as
 * plaintext. This rejects a valid-but-unrelated SQLite database before the
 * close→swap→reconnect cycle — importing one would otherwise replace the live
 * data and leave no rollback (the .bak is deleted on "success").
 */
function isBoardingHouseDb(dataBase64: string): boolean {
  try {
    // The schema (sqlite_master) for this small database lives in the first
    // pages, so decoding a leading slice is enough — and cheaper than the
    // whole file. Tolerate the `IF NOT EXISTS` variant for robustness.
    const bytes = base64ToBytes(dataBase64);
    const head = new TextDecoder().decode(bytes.subarray(0, 64 * 1024));
    return /CREATE TABLE (?:IF NOT EXISTS )?(?:rooms|tenants)/.test(head);
  } catch {
    return false;
  }
}

/** Flush pending WAL frames into the main database file. Returns false when the
 * pragma is unsupported or fails — the caller should refuse to export rather
 * than hand the landlord a partial copy. */
async function checkpointWal(): Promise<boolean> {
  try {
    const db = await getDb();
    await db.execute("PRAGMA wal_checkpoint(TRUNCATE)");
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a complete, consistent snapshot of the database as base64 bytes.
 * Returns the data plus a temp snapshot path to clean up (null when the
 * fallback copied the live file directly).
 */
async function readSnapshot(): Promise<{ data: string; tempPath: string | null }> {
  const db = await getDb();
  const dbPath = await liveDbPath();
  const tempPath = dbPath + ".export.tmp";
  try {
    // VACUUM INTO produces a fully checkpointed copy — no WAL edge cases.
    // Remove a stale temp file first: VACUUM INTO errors if the target exists.
    await removeQuiet(tempPath);
    await db.execute(`VACUUM INTO '${escapeSql(tempPath)}'`);
    const data = bytesToBase64(await readFile(tempPath));
    return { data, tempPath };
  } catch (e) {
    // Fallback: flush WAL then copy the live file directly. If the checkpoint
    // failed, refuse to export rather than produce a partial backup.
    if (!(await checkpointWal())) {
      throw new Error(`Could not produce a consistent backup snapshot: ${String(e)}`);
    }
    const data = bytesToBase64(await readFile(dbPath));
    return { data, tempPath: null };
  }
}

/** Export the database through the native save/share dialog. */
export async function exportBackup(): Promise<BackupResult> {
  const { data, tempPath } = await readSnapshot();
  const dest = await save({
    title: "Save backup",
    defaultPath: backupFileName(),
    filters: [{ name: "SQLite database", extensions: ["db", "sqlite"] }],
  });
  if (!dest) {
    if (tempPath) await remove(tempPath).catch(() => {});
    return { canceled: true };
  }
  try {
    await writeFile(dest, base64ToBytes(data));
    await setSetting("last_backup_date", todayIso());
    return { canceled: false, path: dest };
  } finally {
    if (tempPath) await remove(tempPath).catch(() => {});
  }
}

/**
 * Open the file picker and read + validate the selected backup file.
 * Returns null when the user cancels; throws when the file is not a
 * SQLite database.
 */
export async function chooseBackupFile(): Promise<ChosenBackup | null> {
  const src = await open({
    title: "Choose a backup file",
    multiple: false,
    directory: false,
    filters: [{ name: "SQLite database", extensions: ["db", "sqlite"] }],
  });
  if (!src || Array.isArray(src)) return null;
  const data = bytesToBase64(await readFile(src));
  if (!isSqliteFile(data)) {
    throw new Error("That file is not a SQLite database backup.");
  }
  if (!isBoardingHouseDb(data)) {
    throw new Error("That file is not a Digal Boarding House backup.");
  }
  return { filePath: src, dataBase64: data, fileName: displayName(src) };
}

async function removeQuiet(p: string): Promise<void> {
  await remove(p).catch(() => {});
}

/** Roll the swap back: restore the pre-import `.bak` file and reopen. */
async function restoreFromBackup(dbPath: string, bakPath: string): Promise<void> {
  await closeDb();
  await removeQuiet(dbPath);
  await removeQuiet(dbPath + "-wal");
  await removeQuiet(dbPath + "-shm");
  await rename(bakPath, dbPath);
  await getDb();
}

/**
 * Replace the live database with the chosen backup. Assumes the caller has
 * already shown the destructive-action confirmation.
 *
 * Throws on failure — the original database is restored in that case.
 */
export async function importBackup(chosen: ChosenBackup): Promise<void> {
  const dbPath = await liveDbPath();
  const bakPath = dbPath + ".bak";

  // 1. Release the live connection so the file can be replaced.
  await closeDb();

  // 2. Move the current database aside as a rollback point.
  await removeQuiet(bakPath);
  await removeQuiet(dbPath + "-wal");
  await removeQuiet(dbPath + "-shm");
  try {
    await rename(dbPath, bakPath);
  } catch (e) {
    await getDb(); // reopen the untouched database
    throw new Error(`Could not prepare the database for import: ${String(e)}`);
  }

  // 3. Write the imported file in place.
  try {
    await writeFile(dbPath, base64ToBytes(chosen.dataBase64));
  } catch (e) {
    await restoreFromBackup(dbPath, bakPath);
    throw new Error(`Could not write the backup file: ${String(e)}`);
  }

  // 4. Reopen and verify the imported database is healthy.
  try {
    const db = await getDb();
    const check = await db.select<{ integrity_check: string }[]>("PRAGMA integrity_check");
    if (check.length === 0 || check[0].integrity_check !== "ok") {
      throw new Error("The imported file failed SQLite's integrity check.");
    }
  } catch (e) {
    await restoreFromBackup(dbPath, bakPath);
    throw new Error(`Import failed — previous data was restored. ${String(e)}`);
  }

  // 5. Success: drop the rollback file.
  await removeQuiet(bakPath);
}
