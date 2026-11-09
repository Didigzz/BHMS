/**
 * Backup & restore (backup-digal-format-spec.md).
 *
 * Export: read every app table, build the `.digal` JSON document
 * (src/lib/backup-format.ts), save it to the device's Downloads folder through
 * the platform writer, then verify the bytes that actually landed there before
 * claiming success. Export is strictly read-only for business data — the only
 * write is the `last_backup_date` bookkeeping setting, and even that happens
 * only after the file is saved and verified.
 *
 * Restore: validate the chosen file completely (nothing else is a gate), write a
 * pre-restore safety copy of the CURRENT data to Downloads, then hand the exact
 * file text to Rust (`install_backup_file`), which re-validates it, builds a
 * fresh database from this build's migration chain, loads the rows, verifies
 * integrity, and only then swaps the file in. A failure before that final swap
 * leaves the live database untouched.
 *
 * Historically this module copied the raw SQLite file through
 * `dialog.save()` + `fs.writeFile`. That produced files the landlord could not
 * open (see src/lib/share.ts for the same Android finding — app-private storage
 * is not readable by other apps) and carried no self-description at all. The
 * `VACUUM INTO` / checkpoint / `.bak` machinery is intentionally gone.
 */

import { invoke } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { closeDb, getDb, isTauri } from "../db/db";
import { getSetting, setSetting } from "../db/settings";
import {
  BACKUP_MESSAGES,
  REQUIRED_TABLES,
  buildBackupEnvelope,
  canReadBackupFile,
  compareBackupToLive,
  formatBackupFileName,
  parseBackupBytes,
  parseBackupFile,
  refuseBackupFileName,
  sealBackupEnvelope,
  serializeBackup,
  sha256Hex,
  toBackupTable,
  utf8Encode,
  type BackupSizeComparison,
  type BackupSnapshot,
  type BackupTablePayload,
} from "./backup-format.ts";
import { runRestorePreflight, saveSafetyCopy } from "../db/db-health";

export type BackupKind = "backup" | "before-restore";

export interface BackupResult {
  fileName: string;
  /** Display location, e.g. `Downloads/RentEase/BHMS-Backup-2026-09-14.digal`. */
  location: string;
  /** Device URI of the saved file; empty on desktop/preview (no share sheet). */
  uri: string;
  /** The exact file text, so a second copy can be kept without rebuilding it. */
  text: string;
}

export interface ChosenBackup {
  filePath: string;
  fileName: string;
  snapshot: BackupSnapshot;
  /** How the file compares with what this device holds now. */
  comparison: BackupSizeComparison;
}

/** What the Rust/platform writer reports back about the file it just wrote. */
interface SaveReport {
  location: string;
  uri: string;
  bytes: number;
  sha256: string;
}

/** Preview shim hook (src/lib/browser/plugin-sql.ts), present only under RENTEASE_PREVIEW. */
interface PreviewBackupShim {
  vfs?: { set: (path: string, bytes: Uint8Array) => Promise<void> };
  installBackup?: (text: string) => Promise<void>;
}

function previewShim(): PreviewBackupShim | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { __shim?: PreviewBackupShim }).__shim;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Best-effort display name from a filesystem path or Android content URI. */
function displayName(path: string): string {
  const segments = path.split(/[\\/]/);
  const last = segments[segments.length - 1];
  return last || path;
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

/**
 * Read all six tables. Columns come from `PRAGMA table_info` (so the dump
 * survives future column additions without a format bump) and rows are ordered
 * by the table's own identity column for stable, diff-friendly output.
 */
async function collectTables(): Promise<Record<string, BackupTablePayload>> {
  const db = await getDb();
  const tables: Record<string, BackupTablePayload> = {};
  for (const table of REQUIRED_TABLES) {
    const info = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
    const columns = info.map((c) => c.name);
    if (columns.length === 0) {
      throw new Error(`The ${table} table is missing from this database.`);
    }
    const orderBy = table === "settings" ? "key" : "id";
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM ${table} ORDER BY ${orderBy}`
    );
    tables[table] = toBackupTable(columns, rows);
  }
  return tables;
}

/**
 * Row counts in the live database, for the "this backup holds less" warning.
 * The settings table counts too — its seeded rows are records like any other.
 */
async function liveRowCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  const counts: Record<string, number> = {};
  for (const table of REQUIRED_TABLES) {
    const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`);
    counts[table] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

/** Write the file to Downloads (Rust on device, the preview VFS in the browser). */
async function saveBackupFile(text: string, fileName: string): Promise<SaveReport> {
  const bytes = utf8Encode(text);
  if (!isTauri()) {
    const shim = previewShim();
    const path = `Downloads/${fileName}`;
    if (!shim?.vfs) {
      throw new Error("Backup files can only be saved in the app.");
    }
    await shim.vfs.set(path, bytes);
    return { location: path, uri: "", bytes: bytes.length, sha256: sha256Hex(bytes) };
  }
  return invoke<SaveReport>("save_backup_to_downloads", { content: text, fileName });
}

/**
 * Export the database as a `.digal` backup.
 *
 * `kind: "before-restore"` writes the safety copy that a restore makes of the
 * data it is about to replace; it deliberately does NOT update
 * `last_backup_date` (that line means "when you last exported a backup").
 */
export async function exportBackup(kind: BackupKind = "backup"): Promise<BackupResult> {
  const tables = await collectTables();
  const houseName = await getSetting("house_name", "RentEase");
  const text = serializeBackup(sealBackupEnvelope(buildBackupEnvelope(tables, { houseName })));
  const fileName = formatBackupFileName(new Date(), kind);

  let report: SaveReport;
  try {
    report = await saveBackupFile(text, fileName);
  } catch (e) {
    throw new Error(BACKUP_MESSAGES.exportFailed(String(e)));
  }

  // Verify what actually landed on the device — a truncated, empty, or
  // wrongly-named file must never be reported as a successful backup
  // (spec §4.1 step 5). The name is part of that proof: the app must never
  // claim a backup it would itself refuse to import.
  const expectedBytes = utf8Encode(text);
  const storedFileName = displayName(report.location) || fileName;
  const intact =
    report.bytes === expectedBytes.length &&
    report.sha256.toLowerCase() === sha256Hex(expectedBytes) &&
    parseBackupFile(text, fileName).ok &&
    canReadBackupFile(storedFileName);
  if (!intact) {
    throw new Error(BACKUP_MESSAGES.exportVerifyFailed);
  }

  if (kind === "backup") await setSetting("last_backup_date", todayIso());
  // Report the name the device really stored, never the one we asked for.
  return { fileName: storedFileName, location: report.location, uri: report.uri, text };
}

/** Post-export share sheet (Android only; a no-op elsewhere). */
export async function shareBackup(fileName: string, uri: string): Promise<void> {
  if (!isTauri() || !uri) return;
  await invoke("share_backup_file", { uri, fileName });
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

/**
 * Open the file picker and validate the chosen file.
 *
 * Returns null when the user cancels and throws with the locked message when
 * the file is not a usable backup. Only a name ending in lowercase `.digal` is
 * admitted: the picker's `*.digal` filter is a convenience, not the gate, since
 * Android SAF maps extension filters to MIME types that a custom extension does
 * not map to reliably. The name is checked before the file is read, and the
 * contents are checked after — a `.json` file is refused even when the backup
 * inside it is valid.
 */
export async function chooseBackupFile(): Promise<ChosenBackup | null> {
  const src = await open({
    title: "Choose a backup file",
    multiple: false,
    directory: false,
    filters: [{ name: "BHMS backup", extensions: ["digal"] }],
  });
  if (!src || Array.isArray(src)) return null;

  const fileName = displayName(String(src));

  // Refuse a wrongly-named file before reading it: the name decides whether
  // this is a candidate backup at all, whatever the contents turn out to be.
  const refused = refuseBackupFileName(fileName);
  if (refused) throw new Error(refused.message);

  const bytes = await readFile(src);
  const result = parseBackupBytes(bytes, fileName);
  if (!result.ok) throw new Error(result.message);

  // Replacing is the whole point of an import, so the case worth warning about
  // is a file carrying less than this device already has.
  const comparison = compareBackupToLive(result.snapshot.summary.counts, await liveRowCounts());
  return { filePath: String(src), fileName, snapshot: result.snapshot, comparison };
}

/** Reopen the live database (used on every failure path so the app stays usable). */
async function reopenQuiet(): Promise<void> {
  try {
    await getDb();
  } catch {
    // The caller already has the real error to report.
  }
}

/**
 * Replace the live database with the chosen backup. Assumes the caller already
 * showed the destructive-action confirmation. Throws with a specific reason on
 * failure; the live data is only ever replaced after every check has passed.
 */
export async function importBackup(chosen: ChosenBackup): Promise<void> {
  // 0. Refuse a restore that cannot possibly work, before anything is touched.
  const preflight = await runRestorePreflight();
  if (!preflight.canWriteDirectory || !preflight.canReadDatabase) {
    throw new Error(preflight.reason ?? "RentEase cannot restore your data right now.");
  }

  // 1. Mandatory safety copy of the data we are about to replace (spec §4.3.5).
  let safety: BackupResult;
  try {
    safety = await exportBackup("before-restore");
  } catch {
    throw new Error(BACKUP_MESSAGES.safetyCopyFailed);
  }
  // A second copy inside the app's own folder, so a recovery never depends on
  // the landlord finding the one in Downloads. Best-effort by design.
  await saveSafetyCopy(safety.text, safety.fileName);

  // 2. Rust re-validates the exact file text, rebuilds a fresh database from the
  //    migration chain, loads the rows, verifies integrity, then swaps the file
  //    in. Nothing before that final swap touches the live database.
  await closeDb();
  try {
    if (isTauri()) {
      await invoke("install_backup_file", { payload: chosen.snapshot.text });
    } else {
      const install = previewShim()?.installBackup;
      if (!install) throw new Error("Restoring is only available in the app.");
      await install(chosen.snapshot.text);
    }
  } catch (e) {
    await reopenQuiet();
    throw new Error(BACKUP_MESSAGES.restoreFailed(String(e)));
  }

  // 3. Reopen and confirm the restored database is healthy.
  try {
    const db = await getDb();
    const check = await db.select<{ integrity_check: string }[]>("PRAGMA integrity_check");
    if (check.length === 0 || check[0].integrity_check !== "ok") {
      throw new Error("The restored database failed SQLite's integrity check.");
    }
  } catch (e) {
    await reopenQuiet();
    throw new Error(
      BACKUP_MESSAGES.restoreFailed(
        `${String(e)} Your previous data is still saved at ${safety.location}.`
      )
    );
  }
}
