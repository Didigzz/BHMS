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
    "Export failed — the saved file could not be re-opened. Nothing was changed in your data.",
  safetyCopyFailed:
    "Restore cancelled — BHMS could not save a safety copy of your current data. Nothing was changed.",
  restoreFailed: (reason: string) => `Restore failed — your current data was not changed. ${reason}`,
  restored: (fileName: string) => `Backup restored — all data replaced (${fileName})`,
} as const;

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4)
//
// Implemented here rather than via crypto.subtle: a WebView without a secure
// context has no subtle crypto, and the format must be computable everywhere,
// synchronously, so validation can stay a plain function.
// ---------------------------------------------------------------------------

const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Raw SHA-256 digest of a byte array. */
export function sha256Bytes(message: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLen = message.length * 8;
  const paddedLen = (((message.length + 8) >> 6) + 1) << 6; // room for 0x80 + 8-byte length
  const padded = new Uint8Array(paddedLen);
  padded.set(message);
  padded[message.length] = 0x80;
  // Length is a 64-bit big-endian bit count; JS numbers cover up to 2^53 bits.
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x1_0000_0000), false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) out.setUint32(i * 4, h[i], false);
  return digest;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** SHA-256 hex digest of a UTF-8 string or raw bytes. */
export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? utf8Encode(input) : input;
  return bytesToHex(sha256Bytes(bytes));
}

/** UTF-8 encoder that works without TextEncoder (older WebViews). */
export function utf8Encode(text: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
  }
  return new Uint8Array(out);
}

/** UTF-8 decoder that works without TextDecoder (older WebViews). */
export function utf8Decode(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b < 0xf0)
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
      );
    else {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// base64 (BLOB values only — this schema has none today)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Canonicalization + checksum
// ---------------------------------------------------------------------------

/** Deep key-sorted copy — the canonical form both TS and Rust can produce. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = canonicalize(source[key]);
    return out;
  }
  return value;
}

/** The exact bytes the checksum covers (spec §3.3). */
export function canonicalTablesString(tables: unknown): string {
  return JSON.stringify(canonicalize(tables));
}

/** SHA-256 hex of the canonical `tables` payload. */
export function checksumOf(tables: unknown): string {
  return sha256Hex(canonicalTablesString(tables));
}

// ---------------------------------------------------------------------------
// Value mapping
// ---------------------------------------------------------------------------

/**
 * Convert one database value into its backup representation.
 * Returns `undefined` for a value the format cannot express (the caller
 * refuses to export rather than silently dropping data).
 */
export function toBackupValue(value: unknown): BackupValue | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0; // defensively: SQLite has no booleans
  if (value instanceof Uint8Array) return { __b64__: bytesToBase64(value) };
  if (value instanceof ArrayBuffer) return { __b64__: bytesToBase64(new Uint8Array(value)) };
  return undefined;
}

/** Backup representation → JS value (used by the browser-preview installer). */
export function fromBackupValue(value: BackupValue): null | number | string | Uint8Array {
  if (value === null || typeof value === "number" || typeof value === "string") return value;
  return base64ToBytes(value.__b64__);
}

/** Convert a selected row, refusing anything the format cannot express. */
export function toBackupRow(row: Record<string, unknown>): BackupRow {
  const out: BackupRow = {};
  for (const [key, raw] of Object.entries(row)) {
    const value = toBackupValue(raw);
    if (value === undefined) {
      throw new Error(`Unsupported value in column "${key}" (${typeof raw}).`);
    }
    out[key] = value;
  }
  return out;
}

/** `{ rows, columns, row_count }` for one table (columns come from PRAGMA table_info). */
export function toBackupTable(columns: string[], rows: Record<string, unknown>[]): BackupTablePayload {
  const mapped = rows.map(toBackupRow);
  return { columns: [...columns], row_count: mapped.length, rows: mapped };
}

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
