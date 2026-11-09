import { checksumOf } from "./canonical.ts";
import {
  CURRENT_APP_VERSION,
  FORMAT,
  FORMAT_VERSION,
  REQUIRED_TABLES,
  type BackupEnvelope,
  type BackupTablePayload,
} from "./messages.ts";

// ---------------------------------------------------------------------------
// Build / serialize
// ---------------------------------------------------------------------------

export interface BackupMeta {
  houseName: string;
  appVersion?: string;
  exportedAt?: string;
}

/**
 * Assemble the envelope WITHOUT its checksum; pass the result to
 * `sealBackupEnvelope` before serializing (kept separate so the envelope can be
 * inspected/tested and so the checksum step is impossible to forget —
 * `serializeBackup` refuses an unsealed file).
 */
export function buildBackupEnvelope(
  tables: Record<string, BackupTablePayload>,
  meta: BackupMeta
): BackupEnvelope {
  const ordered: Record<string, BackupTablePayload> = {};
  for (const table of REQUIRED_TABLES) {
    ordered[table] = tables[table] ?? { columns: [], row_count: 0, rows: [] };
  }
  return {
    format: FORMAT,
    format_version: FORMAT_VERSION,
    app_version: meta.appVersion ?? CURRENT_APP_VERSION,
    exported_at: meta.exportedAt ?? new Date().toISOString(),
    house_name: meta.houseName,
    tables: ordered,
    checksum: { algorithm: "SHA-256", value: "" },
  };
}

/** Fill in the SHA-256 over the (canonical) tables payload. */
export function sealBackupEnvelope(envelope: BackupEnvelope): BackupEnvelope {
  return {
    ...envelope,
    checksum: { algorithm: "SHA-256", value: checksumOf(envelope.tables) },
  };
}

/**
 * The file's exact bytes as text: pretty-printed, 2-space indent, literal
 * UTF-8 characters (no `\u` escapes), trailing newline.
 */
export function serializeBackup(envelope: BackupEnvelope): string {
  if (envelope.checksum.value === "") {
    throw new Error("Refusing to serialize an unsealed backup (checksum missing).");
  }
  return JSON.stringify(envelope, null, 2) + "\n";
}

/** `BHMS-Backup-YYYY-MM-DD.digal` / `BHMS-Backup-YYYY-MM-DD-before-restore.digal`. */
export function formatBackupFileName(
  date: Date = new Date(),
  kind: "backup" | "before-restore" = "backup"
): string {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
  const suffix = kind === "before-restore" ? "-before-restore" : "";
  return `BHMS-Backup-${iso}${suffix}.digal`;
}
