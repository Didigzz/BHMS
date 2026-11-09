import { base64ToBytes, bytesToBase64 } from "./base64.ts";
import type { BackupRow, BackupTablePayload, BackupValue } from "./messages.ts";

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
