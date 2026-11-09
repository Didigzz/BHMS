/**
 * The `.digal` backup format (backup-digal-format-spec.md §3).
 *
 * A backup file is ONE pretty-printed JSON document: a manifest (what this file
 * is, who it belongs to, when it was made) plus a logical dump of every app
 * table, plus a SHA-256 checksum over the dump.
 *
 * This module is deliberately pure — no Tauri plugins, no database, no IO — so
 * the format can be unit-tested, and so the node round-trip script
 * (scripts/smoke-backup.mjs) and the Rust installer can agree on the same
 * contract:
 *
 *   checksum.value = SHA-256 hex of the UTF-8 bytes of `canonicalize(tables)`
 *
 * `canonicalize` sorts object keys at every depth. Rust's `serde_json::Value`
 * uses a BTreeMap for objects, so `serde_json::to_string(&tables)` produces
 * exactly the same bytes for the same parsed payload — which is what lets the
 * Rust side re-validate the checksum (defence in depth) without a bespoke
 * canonicalizer on either side.
 */

export const FORMAT = "bhms-backup";
export const FORMAT_VERSION = 1;
/** Kept in sync with package.json by backup-format.test.ts. */
export const CURRENT_APP_VERSION = "0.1.0";

/**
 * Every table a backup carries, in insert order (parents before children).
 * `_sqlx_migrations` is deliberately absent: a restore rebuilds the schema by
 * running this build's own migration chain, so its bookkeeping is correct by
 * construction rather than inherited from the file.
 */
export const REQUIRED_TABLES = [
  "rooms",
  "tenants",
  "payments",
  "reservations",
  "settings",
  "notifications_log",
  "amenity_bills",
  "amenity_bill_tenants",
  "amenity_bill_rooms",
  "amenity_payments",
] as const;

export type BackupTableName = (typeof REQUIRED_TABLES)[number];

/** Human labels for the restore-confirmation summary. */
export const TABLE_LABELS: Record<BackupTableName, string> = {
  rooms: "rooms",
  tenants: "tenants",
  payments: "payments",
  reservations: "reservations",
  settings: "settings",
  notifications_log: "notifications",
  amenity_bills: "amenity bills",
  amenity_bill_tenants: "amenity bill tenants",
  amenity_bill_rooms: "amenity bill rooms",
  amenity_payments: "amenity payments",
};

/** A BLOB is the only value JSON cannot express natively. */
export interface BackupBlob {
  __b64__: string;
}
export type BackupValue = null | number | string | BackupBlob;
export type BackupRow = Record<string, BackupValue>;

export interface BackupTablePayload {
  columns: string[];
  row_count: number;
  rows: BackupRow[];
}

export interface BackupEnvelope {
  format: string;
  format_version: number;
  app_version: string;
  exported_at: string;
  house_name: string;
  tables: Record<string, BackupTablePayload>;
  checksum: { algorithm: string; value: string };
}

export interface BackupSummary {
  fileName: string;
  exportedAt: string;
  houseName: string;
  appVersion: string;
  formatVersion: number;
  /** Per-table counts, in REQUIRED_TABLES order, for the confirm dialog. */
  counts: { table: string; label: string; count: number }[];
  totalRows: number;
  /** "No tenants and no rooms" — restore needs the extra confirmation (§4.7). */
  isEmpty: boolean;
}

export interface BackupSnapshot {
  envelope: BackupEnvelope;
  summary: BackupSummary;
  /** The exact text that was parsed — what the Rust installer re-validates. */
  text: string;
}

export type BackupFailureReason =
  | "old-format"
  | "wrong-extension"
  | "not-json"
  | "wrong-marker"
  | "newer-format"
  | "missing-tables"
  | "missing-table"
  | "row-count"
  | "unknown-column"
  | "bad-value"
  | "no-checksum"
  | "checksum-mismatch";

export interface BackupFailure {
  ok: false;
  reason: BackupFailureReason;
  message: string;
  table?: string;
}

export type BackupParseResult = { ok: true; snapshot: BackupSnapshot } | BackupFailure;

/**
 * The locked user-facing copy (spec §4.7). Errors always name the reason — a
 * restore never fails with a generic "import failed".
 */
export const BACKUP_MESSAGES = {
  oldFormat: "That's an old-format backup (.db). Only .digal backups can be restored.",
  wrongFileType: (found: string) =>
    found
      ? `That file can't be restored — it's a ${found} file, not a .digal backup.`
      : "That file can't be restored — its name has no extension. Only .digal backups can be restored.",
  wrongCase: (found: string) =>
    `That file can't be restored — its name ends in ${found}. The extension must be lowercase .digal.`,
  smallerBackup: (backupTotal: number, liveTotal: number) =>
    `This backup holds less data than this device (${backupTotal} records in the file, ${liveTotal} on this device). Importing it replaces everything, so the extra records will be removed.`,
  noSafetyCopy: "There is no safety copy on this device to restore.",
  notJson: "That file is not a BHMS backup — it isn't valid JSON.",
  notBackup: "That file isn't a BHMS backup.",
  incomplete: "This backup is incomplete — its data tables are missing or damaged.",
  damaged: "This backup is damaged — it has no checksum.",
  damagedRows: "This backup is damaged — its data tables are missing or damaged.",
  checksumMismatch: "This backup file is damaged or incomplete (checksum mismatch). Try another copy.",
  missingTable: (table: string) => `This backup is incomplete — ${table} is missing or damaged.`,
  newerFormat: (version: number) =>
    `This backup was made by a newer version of BHMS (format v${version}). Update the app, then restore it.`,
  exportFailed: (reason: string) => `Export failed — the backup could not be saved. ${reason}`,
  exportVerifyFailed:
    "Export failed — the saved file could not be verified on this device. Nothing was changed in your data.",
  safetyCopyFailed:
    "Restore cancelled — BHMS could not save a safety copy of your current data. Nothing was changed.",
  restoreFailed: (reason: string) => `Restore failed — your current data was not changed. ${reason}`,
  restored: (fileName: string) => `Backup restored — all data replaced (${fileName})`,
} as const;
