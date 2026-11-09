import { describe, it, expect } from "vitest";
import {
  BACKUP_MESSAGES,
  CURRENT_APP_VERSION,
  FORMAT,
  FORMAT_VERSION,
  REQUIRED_TABLES,
  looksLikeSqlite,
  parseBackupBytes,
  parseBackupFile,
  utf8Encode,
} from "./backup-format.ts";
import {
  FILE_NAME,
  agedFile,
  emptyTables,
  expectFailure,
  makeFile,
  mutate,
  resealed,
} from "./backup-format.fixtures.ts";

// ---------------------------------------------------------------------------
// parse + validate
// ---------------------------------------------------------------------------

describe("parseBackupFile — happy path", () => {
  it("accepts a sealed file and reports the manifest summary", () => {
    const { text } = makeFile();
    const result = parseBackupFile(text, FILE_NAME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.summary).toMatchObject({
      fileName: FILE_NAME,
      houseName: "DIGAL Boarding House",
      appVersion: CURRENT_APP_VERSION,
      formatVersion: FORMAT_VERSION,
      isEmpty: false,
      totalRows: 16,
    });
    expect(result.snapshot.summary.counts.map((c) => c.table)).toEqual([...REQUIRED_TABLES]);
    expect(result.snapshot.summary.counts[0]).toEqual({ table: "rooms", label: "rooms", count: 2 });
    expect(result.snapshot.text).toBe(text);
  });

  it("flags an empty backup so the UI can ask a second time", () => {
    const result = parseBackupFile(makeFile(emptyTables()).text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.summary.isEmpty).toBe(true);
    expect(result.snapshot.summary.totalRows).toBe(1); // the seeded settings row
  });
});

describe("parseBackupFile — refusals", () => {
  it("rejects an old .db backup by its SQLite header (before parsing)", () => {
    const bytes = utf8Encode("SQLite format 3\u0000rest of the database");
    expect(looksLikeSqlite(bytes)).toBe(true);
    const result = parseBackupBytes(bytes, "rentease-backup-2026-08-06.db");
    expectFailure(result, "old-format", BACKUP_MESSAGES.oldFormat);
  });

  it("rejects a file that is not JSON", () => {
    expectFailure(parseBackupFile("this is not json"), "not-json", BACKUP_MESSAGES.notJson);
  });

  it("rejects JSON that isn't a BHMS backup", () => {
    expectFailure(parseBackupFile(JSON.stringify({ hello: "world" })), "wrong-marker", BACKUP_MESSAGES.notBackup);
    expectFailure(
      parseBackupFile(JSON.stringify({ format: "other-app", format_version: 1 })),
      "wrong-marker",
      BACKUP_MESSAGES.notBackup
    );
    expectFailure(
      parseBackupFile(JSON.stringify({ format: FORMAT, format_version: "one" })),
      "wrong-marker",
      BACKUP_MESSAGES.notBackup
    );
    expectFailure(parseBackupFile("[1,2,3]"), "wrong-marker", BACKUP_MESSAGES.notBackup);
  });

  it("rejects a backup written by a newer app version", () => {
    const { text } = makeFile();
    const bumped = mutate(text, (parsed) => {
      parsed.format_version = FORMAT_VERSION + 1;
    });
    const result = parseBackupFile(bumped);
    expectFailure(result, "newer-format", BACKUP_MESSAGES.newerFormat(FORMAT_VERSION + 1));
  });

  it("rejects a file with no tables object", () => {
    const { text } = makeFile();
    const stripped = mutate(text, (parsed) => {
      delete parsed.tables;
    });
    expectFailure(parseBackupFile(stripped), "missing-tables", BACKUP_MESSAGES.incomplete);
  });

  it("tolerates an absent table, so a stripped file is caught by the checksum", () => {
    const { text } = makeFile();
    const stripped = mutate(text, (parsed) => {
      delete (parsed.tables as Record<string, unknown>).payments;
    });
    // An absent payload imports as empty (§13); without re-sealing, the edit is
    // what the checksum catches.
    expectFailure(parseBackupFile(stripped), "checksum-mismatch", BACKUP_MESSAGES.checksumMismatch);
  });

  it("rejects a row_count that disagrees with the rows array (truncated file)", () => {
    const { text } = makeFile();
    const truncated = mutate(text, (parsed) => {
      (parsed.tables as Record<string, { rows: unknown[] }>).tenants.rows.pop();
    });
    expectFailure(parseBackupFile(truncated), "row-count", BACKUP_MESSAGES.missingTable("tenants"));
  });

  it("rejects a row carrying a column the table doesn't declare", () => {
    const { text } = makeFile();
    const padded = mutate(text, (parsed) => {
      const tenants = (parsed.tables as Record<string, { rows: Record<string, unknown>[] }>).tenants;
      tenants.rows[0].sneaky = "value";
    });
    expectFailure(parseBackupFile(padded), "unknown-column", BACKUP_MESSAGES.missingTable("tenants"));
  });

  it("rejects a value the format cannot express", () => {
    const { text } = makeFile();
    const broken = mutate(text, (parsed) => {
      const rooms = (parsed.tables as Record<string, { rows: Record<string, unknown>[] }>).rooms;
      rooms.rows[0].room_number = { nested: "object" };
    });
    expectFailure(parseBackupFile(broken), "bad-value", BACKUP_MESSAGES.missingTable("rooms"));
  });

  it("rejects a file with no checksum", () => {
    const { text } = makeFile();
    const stripped = mutate(text, (parsed) => {
      delete parsed.checksum;
    });
    expectFailure(parseBackupFile(stripped), "no-checksum", BACKUP_MESSAGES.damaged);
  });

  it("rejects a file whose payload was altered after sealing", () => {
    const { text } = makeFile();
    const altered = mutate(text, (parsed) => {
      const tenants = (parsed.tables as Record<string, { rows: Record<string, unknown>[] }>).tenants;
      tenants.rows[0].name = "Someone Else";
    });
    expectFailure(parseBackupFile(altered), "checksum-mismatch", BACKUP_MESSAGES.checksumMismatch);
  });

  it("rejects a truncated file (bytes cut mid-JSON)", () => {
    const { text } = makeFile();
    expectFailure(parseBackupFile(text.slice(0, Math.floor(text.length / 2))), "not-json");
  });

  it("rejects a checksum written with a different algorithm", () => {
    const { text } = makeFile();
    const altered = mutate(text, (parsed) => {
      (parsed.checksum as { algorithm: string }).algorithm = "MD5";
    });
    expectFailure(parseBackupFile(altered), "no-checksum", BACKUP_MESSAGES.damaged);
  });
});

// ---------------------------------------------------------------------------
// tolerant import (amenity-billing-spec.md §13, decision #30)
// ---------------------------------------------------------------------------

describe("tolerant import", () => {
  it("accepts a backup that predates the amenity tables and reports them empty", () => {
    const result = parseBackupFile(agedFile(), "BHMS-Backup-2026-09-01.digal");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const counts = result.snapshot.summary.counts;
    expect(counts.filter((c) => c.table.startsWith("amenity_bill")).map((c) => c.count)).toEqual([0, 0, 0]);
    expect(counts.find((c) => c.table === "amenity_payments")?.count).toBe(0);
    expect(counts.find((c) => c.table === "rooms")?.count).toBe(2);
    expect(result.snapshot.summary.totalRows).toBe(9);
  });

  it("accepts a pre-075 file whose amenity_bills still carries amenity_type", () => {
    const text = resealed((parsed) => {
      parsed.tables.amenity_bills.columns.push("amenity_type");
      for (const row of parsed.tables.amenity_bills.rows) row.amenity_type = "Electricity";
    });
    const result = parseBackupFile(text);
    // The column is carried through by the parser and dropped by the installer
    // (its loader keeps only columns the rebuilt schema has).
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.envelope.tables.amenity_bills.columns).toContain("amenity_type");
  });

  it("still rejects a table payload that is not an object", () => {
    const result = parseBackupFile(resealed((parsed) => { parsed.tables.payments = "nope"; }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-table");
  });
});
