// Negative pass: corrupt, truncated, malformed, newer-version, old-format, and
// the file-name gate — plus the tolerant import of a pre-amenity backup.
import {
  parseBackupBytes,
  parseBackupFile,
  sealBackupEnvelope,
  serializeBackup,
  utf8Encode,
} from "../../../../src/lib/backup/backup-format.ts";
import { assert, section } from "../harness.mjs";
import { rebuildFromBackup } from "../rebuild.mjs";

export function runNegativeScenario(ctx) {
  const { text, fileName, migrationFiles } = ctx;

  section("Negative pass");
  const truncated = text.slice(0, Math.floor(text.length / 2));
  const truncatedResult = parseBackupFile(truncated);
  assert(!truncatedResult.ok && truncatedResult.reason === "not-json", "truncated file is rejected (not JSON)");

  const altered = JSON.parse(text);
  altered.tables.tenants.rows[0].name = "Someone Else";
  const alteredResult = parseBackupFile(JSON.stringify(altered));
  assert(
    !alteredResult.ok && alteredResult.reason === "checksum-mismatch",
    "a modified payload fails the checksum"
  );

  // A backup written before the amenity tables existed carries no payload for
  // them: it must still restore, with those tables empty
  // (amenity-billing-spec.md §13, decision #30). The file is re-sealed first so
  // the checksum stays valid and only the absent payload is under test.
  const older = JSON.parse(text);
  delete older.tables.amenity_bills;
  delete older.tables.amenity_bill_tenants;
  delete older.tables.amenity_bill_rooms;
  delete older.tables.amenity_payments;
  const olderResult = parseBackupFile(serializeBackup(sealBackupEnvelope(older)));
  assert(olderResult.ok, "a backup without the amenity tables is accepted (tolerant import)");
  if (olderResult.ok) {
    const amenityCounts = olderResult.snapshot.summary.counts.filter((c) =>
      c.table.startsWith("amenity_bill")
    );
    assert(
      amenityCounts.length === 3 && amenityCounts.every((c) => c.count === 0),
      "the absent tables are reported as empty"
    );
    assert(
      olderResult.snapshot.summary.counts.find((c) => c.table === "amenity_payments")?.count === 0,
      "the absent amenity payments table is reported empty"
    );
    const olderRestored = rebuildFromBackup(olderResult.snapshot.envelope.tables, migrationFiles);
    assert(
      olderRestored.prepare("SELECT COUNT(*) AS n FROM amenity_bills").get().n === 0,
      "an absent amenity table restores as empty"
    );
    assert(
      olderRestored.prepare("SELECT COUNT(*) AS n FROM amenity_payments").get().n === 0,
      "an absent amenity payments table restores as empty"
    );
    assert(
      olderRestored.prepare("SELECT COUNT(*) AS n FROM tenants").get().n ===
        older.tables.tenants.rows.length,
      "the tables the backup does carry still restore"
    );
  }

  // Present but malformed is still a hard failure.
  const malformed = JSON.parse(text);
  malformed.tables.payments = "not a table payload";
  const malformedResult = parseBackupFile(serializeBackup(sealBackupEnvelope(malformed)));
  assert(
    !malformedResult.ok && malformedResult.reason === "missing-table",
    "a malformed table payload is still rejected"
  );

  const newer = JSON.parse(text);
  newer.format_version = 2;
  const newerResult = parseBackupFile(JSON.stringify(newer));
  assert(!newerResult.ok && newerResult.reason === "newer-format", "a newer format version is rejected");

  const legacyBytes = utf8Encode("SQLite format 3\u0000legacy database bytes");
  const legacyResult = parseBackupBytes(legacyBytes, "rentease-backup-2026-08-06.db");
  assert(
    !legacyResult.ok && legacyResult.reason === "old-format",
    "an old .db backup is rejected with the old-format message"
  );

  // The name gate: only a lowercase .digal name is read, whatever it contains.
  const textBytes = utf8Encode(text);
  assert(
    parseBackupBytes(textBytes, fileName).ok,
    "a valid backup under its .digal name is admitted"
  );
  const renamedJson = parseBackupBytes(textBytes, "BHMS-Backup-2026-09-14.digal.json");
  assert(
    !renamedJson.ok && renamedJson.reason === "wrong-extension",
    "the same valid bytes behind a .json name are refused by the name gate"
  );
  const renamedTxt = parseBackupBytes(textBytes, "backup.txt");
  assert(
    !renamedTxt.ok && renamedTxt.reason === "wrong-extension",
    "a .txt file is refused by the name gate"
  );
  const uppercase = parseBackupBytes(textBytes, "BHMS-Backup-2026-09-14.DIGAL");
  assert(
    !uppercase.ok && uppercase.reason === "wrong-extension",
    "an uppercase .DIGAL extension is refused"
  );
}
