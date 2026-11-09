/**
 * The `.digal` backup format, split by concern.
 *
 * This file is the public entry point: every symbol that used to live here is
 * re-exported, so callers keep importing `$lib/backup/backup-format`.
 * See docs/specs (backup format) and README → Backups for the contract.
 */

export * from "./messages.ts";
export { sha256Bytes, sha256Hex, utf8Decode, utf8Encode } from "./sha256.ts";
export { canonicalize, canonicalTablesString, checksumOf } from "./canonical.ts";
export { fromBackupValue, toBackupRow, toBackupTable, toBackupValue } from "./values.ts";
export {
  buildBackupEnvelope,
  formatBackupFileName,
  sealBackupEnvelope,
  serializeBackup,
  type BackupMeta,
} from "./envelope.ts";
export { compareBackupToLive, type BackupReduction, type BackupSizeComparison } from "./compare.ts";
export {
  DIGAL_EXTENSION,
  canReadBackupFile,
  looksLikeSqlite,
  parseBackupBytes,
  parseBackupFile,
  refuseBackupFileName,
} from "./parse.ts";
