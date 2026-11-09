import { checksumOf } from "./canonical.ts";
import {
  BACKUP_MESSAGES,
  FORMAT,
  FORMAT_VERSION,
  REQUIRED_TABLES,
  TABLE_LABELS,
  type BackupEnvelope,
  type BackupFailure,
  type BackupFailureReason,
  type BackupParseResult,
  type BackupRow,
  type BackupSnapshot,
  type BackupValue,
} from "./messages.ts";
import { utf8Decode } from "./sha256.ts";

// ---------------------------------------------------------------------------
// Parse + validate
// ---------------------------------------------------------------------------

/** SQLite's 16-byte magic — an old-format backup is detected before parsing. */
const SQLITE_MAGIC = "SQLite format 3\u0000";

export function looksLikeSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

function failure(reason: BackupFailureReason, message: string, table?: string): BackupFailure {
  return { ok: false, reason, message, ...(table ? { table } : {}) };
}

// ---------------------------------------------------------------------------
// File-name admission
//
// Only a `.digal` file may be read, whatever it contains: a `.json` or `.txt`
// file is refused even when the backup inside it is perfectly valid, because the
// extension is how the landlord identifies the format they are handling. The
// check runs on the NAME, before a single byte is inspected.
//
// One predicate serves every entry point — the file picker, the byte parser,
// and the export verifier — so the part that writes a backup and the part that
// reads one can never disagree about what a backup is called.
// ---------------------------------------------------------------------------

/** The only extension a readable backup may carry. */
export const DIGAL_EXTENSION = ".digal";

/**
 * Extensions that get their own message rather than the generic refusal: a
 * landlord who kept a raw database file should be told what that file is, not
 * merely that its name is wrong.
 */
const LEGACY_DATABASE_EXTENSIONS = [".db", ".sqlite"];

/** Does this name end in a readable `.digal` extension? Case-sensitive. */
export function canReadBackupFile(fileName: string): boolean {
  return fileName.endsWith(DIGAL_EXTENSION);
}

/** Everything from the last dot, e.g. `.json`. Empty when the name carries none. */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot) : "";
}

function endsWithIgnoringCase(fileName: string, extensions: string[]): boolean {
  const lower = fileName.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

/**
 * Refuse a picked file by its name, or return `null` when it may be read.
 *
 * The name — not the contents — decides whether a file is a candidate backup at
 * all. An old raw database keeps its dedicated message; a `.DIGAL` name is
 * refused but told precisely why, since Windows and macOS match the picker's
 * `*.digal` filter case-insensitively and therefore offer it for selection.
 */
export function refuseBackupFileName(fileName: string): BackupFailure | null {
  if (canReadBackupFile(fileName)) return null;

  if (endsWithIgnoringCase(fileName, LEGACY_DATABASE_EXTENSIONS)) {
    return failure("old-format", BACKUP_MESSAGES.oldFormat);
  }

  if (endsWithIgnoringCase(fileName, [DIGAL_EXTENSION])) {
    return failure("wrong-extension", BACKUP_MESSAGES.wrongCase(extensionOf(fileName)));
  }

  return failure("wrong-extension", BACKUP_MESSAGES.wrongFileType(extensionOf(fileName)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBackupValue(value: unknown): value is BackupValue {
  if (value === null || typeof value === "number" || typeof value === "string") return true;
  return isPlainObject(value) && typeof value.__b64__ === "string";
}

/**
 * Validate the raw bytes of a chosen file and produce a snapshot the restore
 * flow can trust. Every check runs before anything is written, and each
 * failure carries its own reason + locked message (spec §4.4/§4.7).
 */
export function parseBackupBytes(bytes: Uint8Array, fileName: string): BackupParseResult {
  // The name gate comes first: contents are only worth inspecting once the file
  // is a candidate backup at all.
  const refused = refuseBackupFileName(fileName);
  if (refused) return refused;
  if (looksLikeSqlite(bytes)) {
    return failure("old-format", BACKUP_MESSAGES.oldFormat);
  }
  return parseBackupFile(utf8Decode(bytes), fileName);
}

/** Validate a `.digal` file's text (see `parseBackupBytes` for the byte entry point). */
export function parseBackupFile(text: string, fileName = "backup.digal"): BackupParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failure("not-json", BACKUP_MESSAGES.notJson);
  }
  if (!isPlainObject(parsed)) return failure("wrong-marker", BACKUP_MESSAGES.notBackup);

  if (parsed.format !== FORMAT) return failure("wrong-marker", BACKUP_MESSAGES.notBackup);

  const version = parsed.format_version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return failure("wrong-marker", BACKUP_MESSAGES.notBackup);
  }
  if (version > FORMAT_VERSION) {
    return failure("newer-format", BACKUP_MESSAGES.newerFormat(version));
  }

  const tables = parsed.tables;
  if (!isPlainObject(tables)) return failure("missing-tables", BACKUP_MESSAGES.incomplete);

  const validated: Record<string, { columns: string[]; row_count: number; rows: BackupRow[] }> = {};
  for (const name of REQUIRED_TABLES) {
    const table = tables[name];
    // A backup written before a table existed simply has no payload for it:
    // restore it as empty rather than refusing the whole file
    // (amenity-billing-spec.md §13, decision #30). A present-but-malformed
    // table is still a hard failure below.
    if (table === undefined || table === null) {
      validated[name] = { columns: [], row_count: 0, rows: [] };
      continue;
    }
    if (!isPlainObject(table)) return failure("missing-table", BACKUP_MESSAGES.missingTable(name), name);

    const rawColumns = table.columns;
    if (!Array.isArray(rawColumns) || !rawColumns.every((c) => typeof c === "string")) {
      return failure("missing-table", BACKUP_MESSAGES.missingTable(name), name);
    }
    const columns = rawColumns as string[];

    const rawRows = table.rows;
    if (!Array.isArray(rawRows)) {
      return failure("row-count", BACKUP_MESSAGES.missingTable(name), name);
    }
    if (table.row_count !== rawRows.length) {
      return failure("row-count", BACKUP_MESSAGES.missingTable(name), name);
    }

    for (const row of rawRows) {
      if (!isPlainObject(row)) {
        return failure("bad-value", BACKUP_MESSAGES.missingTable(name), name);
      }
      for (const [key, value] of Object.entries(row)) {
        if (!columns.includes(key)) {
          return failure("unknown-column", BACKUP_MESSAGES.missingTable(name), name);
        }
        if (!isBackupValue(value)) {
          return failure("bad-value", BACKUP_MESSAGES.missingTable(name), name);
        }
      }
    }
    validated[name] = { columns, row_count: rawRows.length, rows: rawRows as BackupRow[] };
  }

  const checksum = parsed.checksum;
  if (!isPlainObject(checksum) || checksum.algorithm !== "SHA-256" || typeof checksum.value !== "string") {
    return failure("no-checksum", BACKUP_MESSAGES.damaged);
  }
  const expected = checksumOf(tables);
  if (checksum.value.toLowerCase() !== expected) {
    return failure("checksum-mismatch", BACKUP_MESSAGES.checksumMismatch);
  }

  const envelope = parsed as unknown as BackupEnvelope;
  const counts = REQUIRED_TABLES.map((table) => ({
    table,
    label: TABLE_LABELS[table],
    count: validated[table].row_count,
  }));

  return {
    ok: true,
    snapshot: {
      envelope,
      summary: {
        fileName,
        exportedAt: typeof parsed.exported_at === "string" ? parsed.exported_at : "",
        houseName: typeof parsed.house_name === "string" ? parsed.house_name : "",
        appVersion: typeof parsed.app_version === "string" ? parsed.app_version : "",
        formatVersion: version,
        counts,
        totalRows: counts.reduce((sum, c) => sum + c.count, 0),
        // An empty backup restores nothing but erases everything — §4.7 asks twice.
        isEmpty: validated.tenants.row_count === 0 && validated.rooms.row_count === 0,
      },
      text,
    },
  };
}
