import { sha256Hex, utf8Encode } from "./sha256.ts";

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
