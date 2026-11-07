import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import {
  BACKUP_MESSAGES,
  CURRENT_APP_VERSION,
  FORMAT,
  FORMAT_VERSION,
  REQUIRED_TABLES,
  buildBackupEnvelope,
  canReadBackupFile,
  canonicalTablesString,
  checksumOf,
  compareBackupToLive,
  formatBackupFileName,
  looksLikeSqlite,
  parseBackupBytes,
  parseBackupFile,
  refuseBackupFileName,
  sealBackupEnvelope,
  serializeBackup,
  sha256Hex,
  toBackupRow,
  toBackupTable,
  toBackupValue,
  utf8Encode,
  type BackupEnvelope,
  type BackupTablePayload,
} from "./backup-format";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const FILE_NAME = "BHMS-Backup-2026-09-14.digal";

function payload(columns: string[], rows: Record<string, unknown>[]): BackupTablePayload {
  return toBackupTable(columns, rows);
}

/** A realistic populated backup with unicode, NULL, empty string, REAL, and dates. */
function populatedTables(): Record<string, BackupTablePayload> {
  return {
    rooms: payload(["id", "room_number", "capacity", "monthly_rate", "status", "maintenance"], [
      { id: 1, room_number: "Room A", capacity: 2, monthly_rate: 2500, status: "Occupied", maintenance: 0 },
      { id: 2, room_number: "Kuwarto ñ—2", capacity: 1, monthly_rate: 1500.5, status: "Vacant", maintenance: 1 },
    ]),
    tenants: payload(
      ["id", "name", "contact", "room_id", "due_date", "deposit_amount", "beds_occupied", "backfilled"],
      [
        { id: 7, name: "Maria Peña ₱", contact: "0917-000-0000", room_id: 1, due_date: "2026-09-14", deposit_amount: null, beds_occupied: 1, backfilled: 0 },
        { id: 9, name: "🧑‍🌾 Boarder “Anon”", contact: "", room_id: 1, due_date: "2026-10-01", deposit_amount: 2500.5, beds_occupied: 2, backfilled: 1 },
      ]
    ),
    payments: payload(["id", "tenant_id", "amount", "paid_date", "due_date", "covers_month", "method", "receipt_no"], [
      { id: 3, tenant_id: 7, amount: 2500, paid_date: "2026-08-05", due_date: "2026-09-05", covers_month: "2026-08", method: "GCash", receipt_no: "RCPT-000003" },
    ]),
    reservations: payload(["id", "room_id", "name", "hold_type", "bed_count", "status"], [
      { id: 1, room_id: 2, name: "Walk-in", hold_type: "whole", bed_count: null, status: "active" },
    ]),
    settings: payload(["key", "value"], [
      { key: "house_name", value: "DIGAL Boarding House" },
      { key: "reminder_days", value: "3" },
    ]),
    notifications_log: payload(["id", "tenant_id", "kind", "due_date", "notified_at"], [
      { id: 1, tenant_id: 7, kind: "reminder", due_date: "2026-09-14", notified_at: "2026-09-11T08:00:00.000Z" },
    ]),
    amenity_bills: payload(
      ["id", "amenity_name", "billing_method", "total_amount", "billing_date", "billing_period", "notes", "division_mode", "status", "meter_start", "meter_end", "price_per_unit", "created_at", "updated_at"],
      [
        { id: 1, amenity_name: "Kuryente — Main Meter", billing_method: "shared", total_amount: 1000, billing_date: "2026-09-01", billing_period: "2026-09", notes: null, division_mode: "auto", status: "active", meter_start: null, meter_end: null, price_per_unit: null, created_at: "2026-09-01T08:00:00.000Z", updated_at: "2026-09-01T08:00:00.000Z" },
        { id: 2, amenity_name: "Tubig — Rooms 1+2", billing_method: "connected", total_amount: 8000, billing_date: "2026-09-02", billing_period: "2026-09", notes: "Joint submeter", division_mode: "manual", status: "cancelled", meter_start: 100, meter_end: 150, price_per_unit: 5, created_at: "2026-09-02T08:00:00.000Z", updated_at: "2026-09-03T08:00:00.000Z" },
      ]
    ),
    amenity_bill_tenants: payload(
      ["id", "bill_id", "tenant_id", "amount", "is_excluded", "exclusion_reason", "payment_status", "tenant_name_snapshot", "room_number_snapshot"],
      [
        { id: 1, bill_id: 1, tenant_id: 7, amount: 500, is_excluded: 0, exclusion_reason: null, payment_status: "Paid", tenant_name_snapshot: "Maria Peña ₱", room_number_snapshot: "Room A" },
        { id: 2, bill_id: 1, tenant_id: 9, amount: 0, is_excluded: 1, exclusion_reason: "Moved out mid-cycle", payment_status: "Unpaid", tenant_name_snapshot: "🧑‍🌾 Boarder “Anon”", room_number_snapshot: "Room A" },
      ]
    ),
    amenity_bill_rooms: payload(["id", "bill_id", "room_id", "room_number_snapshot"], [
      { id: 1, bill_id: 2, room_id: 2, room_number_snapshot: "Kuwarto ñ—2" },
    ]),
  };
}

function emptyTables(): Record<string, BackupTablePayload> {
  return {
    rooms: payload(["id", "room_number"], []),
    tenants: payload(["id", "name"], []),
    payments: payload(["id"], []),
    reservations: payload(["id"], []),
    // A fresh install still has seeded settings — an "empty" backup is never 0 rows total.
    settings: payload(["key", "value"], [{ key: "house_name", value: "DIGAL" }]),
    notifications_log: payload(["id"], []),
    amenity_bills: payload(["id", "amenity_name"], []),
    amenity_bill_tenants: payload(["id"], []),
    amenity_bill_rooms: payload(["id"], []),
  };
}

function makeFile(tables = populatedTables()): { envelope: BackupEnvelope; text: string } {
  const envelope = sealBackupEnvelope(
    buildBackupEnvelope(tables, { houseName: "DIGAL Boarding House", exportedAt: "2026-09-14T06:00:00.000Z" })
  );
  return { envelope, text: serializeBackup(envelope) };
}

/** Parse → mutate the JSON → re-stringify (for negative cases). */
function mutate(text: string, fn: (parsed: Record<string, unknown>) => void): string {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  fn(parsed);
  return JSON.stringify(parsed, null, 2);
}

function expectFailure(result: ReturnType<typeof parseBackupFile>, reason: string, message?: string) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toBe(reason);
  if (message) expect(result.message).toBe(message);
}

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

describe("sha256Hex", () => {
  it("matches the official FIPS 180-4 vectors (padding + multi-block)", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
    expect(
      sha256Hex(
        "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"
      )
    ).toBe("cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
  });

  it("agrees with the platform implementation across block boundaries", async () => {
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 127, 128, 1000]) {
      const text = "a".repeat(length);
      const digest = await webcrypto.subtle.digest("SHA-256", utf8Encode(text));
      const expected = Buffer.from(digest).toString("hex");
      expect(sha256Hex(text)).toBe(expected);
    }
  });

  it("hashes UTF-8 bytes (not UTF-16 code units)", async () => {
    const text = "₱ñ—🧑‍🌾";
    const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    expect(sha256Hex(text)).toBe(Buffer.from(digest).toString("hex"));
  });
});

// ---------------------------------------------------------------------------
// envelope, checksum, serialization
// ---------------------------------------------------------------------------

describe("buildBackupEnvelope / sealBackupEnvelope", () => {
  it("stamps the marker, format version, app version, timestamp, and house name", () => {
    const envelope = buildBackupEnvelope(populatedTables(), {
      houseName: "DIGAL Boarding House",
      exportedAt: "2026-09-14T06:00:00.000Z",
    });
    expect(envelope.format).toBe(FORMAT);
    expect(envelope.format_version).toBe(FORMAT_VERSION);
    expect(envelope.app_version).toBe(CURRENT_APP_VERSION);
    expect(envelope.exported_at).toBe("2026-09-14T06:00:00.000Z");
    expect(envelope.house_name).toBe("DIGAL Boarding House");
    expect(envelope.checksum).toEqual({ algorithm: "SHA-256", value: "" });
  });

  it("always carries every required table, in insert order", () => {
    const envelope = buildBackupEnvelope({ rooms: payload(["id"], [{ id: 1 }]) }, { houseName: "H" });
    expect(Object.keys(envelope.tables)).toEqual([...REQUIRED_TABLES]);
    expect(envelope.tables.tenants).toEqual({ columns: [], row_count: 0, rows: [] });
  });

  it("sealing fills in a SHA-256 over the tables payload", () => {
    const tables = populatedTables();
    const sealed = sealBackupEnvelope(buildBackupEnvelope(tables, { houseName: "H" }));
    expect(sealed.checksum.value).toBe(checksumOf(tables));
    expect(sealed.checksum.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of object key insertion order (Rust's sorted maps agree)", () => {
    const a = { rooms: payload(["id", "room_number"], [{ id: 1, room_number: "A" }]) };
    // Same data, keys written in the opposite order.
    const b = { rooms: { columns: ["id", "room_number"], row_count: 1, rows: [{ room_number: "A", id: 1 }] } };
    expect(checksumOf(a)).toBe(checksumOf(b));
    expect(canonicalTablesString(a)).toBe(canonicalTablesString(b));
  });

  it("refuses to serialize an unsealed envelope", () => {
    const envelope = buildBackupEnvelope(populatedTables(), { houseName: "H" });
    expect(() => serializeBackup(envelope)).toThrow(/unsealed/i);
  });
});

describe("serializeBackup", () => {
  it("writes pretty-printed JSON with 2-space indent and a trailing newline", () => {
    const { text } = makeFile();
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "format": "bhms-backup",');
    expect(text).toContain('\n    "rooms": {');
  });

  it("keeps non-ASCII characters literal (never \\u escapes)", () => {
    const { text } = makeFile();
    expect(text).toContain("Maria Peña ₱");
    expect(text).toContain("Kuwarto ñ—2");
    expect(text).toContain("🧑‍🌾 Boarder “Anon”");
    expect(text).not.toContain("\\u");
  });

  it("round-trips through JSON.parse and re-serializes byte-for-byte", () => {
    const { envelope, text } = makeFile();
    expect(JSON.parse(text)).toEqual(envelope);
    expect(serializeBackup(JSON.parse(text) as BackupEnvelope)).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// value mapping
// ---------------------------------------------------------------------------

describe("value mapping", () => {
  it("keeps NULL, empty string, and 0 distinct", () => {
    expect(toBackupValue(null)).toBe(null);
    expect(toBackupValue("")).toBe("");
    expect(toBackupValue(0)).toBe(0);
    expect(toBackupValue(0)).not.toBe(null);
  });

  it("preserves REAL precision and turns non-finite numbers into NULL", () => {
    expect(toBackupValue(2500.5)).toBe(2500.5);
    expect(toBackupValue(Number.NaN)).toBe(null);
    expect(toBackupValue(Number.POSITIVE_INFINITY)).toBe(null);
  });

  it("encodes a BLOB with the __b64__ marker and round-trips its bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const value = toBackupValue(bytes);
    expect(value).toEqual({ __b64__: "AAEC+v8=" });
  });

  it("refuses a value the format cannot express", () => {
    expect(toBackupValue({ nested: true })).toBeUndefined();
    expect(() => toBackupRow({ weird: { a: 1 } as unknown })).toThrow(/Unsupported value/);
  });

  it("counts rows and keeps the PRAGMA column order", () => {
    const table = payload(["id", "name"], [{ id: 1, name: "A" }, { id: 2, name: "B" }]);
    expect(table.columns).toEqual(["id", "name"]);
    expect(table.row_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// file names
// ---------------------------------------------------------------------------

describe("formatBackupFileName", () => {
  it("writes the dated BHMS-Backup name with zero padding", () => {
    expect(formatBackupFileName(new Date(2026, 8, 14, 12), "backup")).toBe("BHMS-Backup-2026-09-14.digal");
    expect(formatBackupFileName(new Date(2026, 0, 3, 12), "backup")).toBe("BHMS-Backup-2026-01-03.digal");
  });

  it("suffixes the pre-restore safety copy", () => {
    expect(formatBackupFileName(new Date(2026, 8, 14, 12), "before-restore")).toBe(
      "BHMS-Backup-2026-09-14-before-restore.digal"
    );
  });
});

// ---------------------------------------------------------------------------
// file-name admission — only a lowercase .digal name is readable
// ---------------------------------------------------------------------------

describe("backup file admission", () => {
  it("admits any name ending in lowercase .digal — the stem is irrelevant", () => {
    for (const name of [
      "BHMS-Backup-2026-09-14.digal",
      "mybackup.digal",
      "copy of BHMS.digal",
      "a.b.digal",
    ]) {
      expect(canReadBackupFile(name)).toBe(true);
      expect(refuseBackupFileName(name)).toBeNull();
    }
  });

  it("refuses a .json file by name", () => {
    const refused = refuseBackupFileName("BHMS-Backup-2026-09-14.digal.json");
    expect(refused?.reason).toBe("wrong-extension");
    expect(refused?.message).toBe(BACKUP_MESSAGES.wrongFileType(".json"));
  });

  it("refuses a .txt or extension-less file", () => {
    expect(refuseBackupFileName("backup.txt")?.message).toBe(BACKUP_MESSAGES.wrongFileType(".txt"));
    expect(refuseBackupFileName("backup")?.message).toBe(BACKUP_MESSAGES.wrongFileType(""));
    expect(refuseBackupFileName("backup.digal.txt")?.message).toBe(
      BACKUP_MESSAGES.wrongFileType(".txt")
    );
  });

  it("refuses an uppercase extension, naming the case as the problem", () => {
    for (const [name, found] of [
      ["X.DIGAL", ".DIGAL"],
      ["X.Digal", ".Digal"],
    ]) {
      expect(canReadBackupFile(name)).toBe(false);
      const refused = refuseBackupFileName(name);
      expect(refused?.reason).toBe("wrong-extension");
      expect(refused?.message).toBe(BACKUP_MESSAGES.wrongCase(found));
    }
  });

  it("keeps the dedicated old-format message for a raw database file", () => {
    for (const name of ["rentease-backup-2026-08-06.db", "boarding-house.sqlite", "BACKUP.DB"]) {
      expect(refuseBackupFileName(name)).toMatchObject({
        reason: "old-format",
        message: BACKUP_MESSAGES.oldFormat,
      });
    }
  });

  it("refuses valid backup contents behind a .json name — the name is the gate", () => {
    const { text } = makeFile();
    const result = parseBackupBytes(utf8Encode(text), "BHMS-Backup-2026-09-14.digal.json");
    expectFailure(result, "wrong-extension", BACKUP_MESSAGES.wrongFileType(".json"));
  });

  it("admits those same bytes behind a .digal name", () => {
    const { text } = makeFile();
    const result = parseBackupBytes(utf8Encode(text), "BHMS-Backup-2026-09-14.digal");
    expect(result.ok).toBe(true);
  });

  it("reports the name before the contents when both are wrong", () => {
    // An old raw database renamed to .json is refused for its NAME, not for its
    // SQLite header — the name gate is the first check that runs.
    const bytes = utf8Encode("SQLite format 3\u0000rest of the database");
    expectFailure(
      parseBackupBytes(bytes, "old-backup.json"),
      "wrong-extension",
      BACKUP_MESSAGES.wrongFileType(".json")
    );
  });
});

// ---------------------------------------------------------------------------
// comparing a backup against what the device holds
// ---------------------------------------------------------------------------

describe("compareBackupToLive", () => {
  const counts = (values: [string, number][]) =>
    values.map(([table, count]) => ({ table, label: table, count }));

  it("flags a file that carries less than the device already holds", () => {
    const result = compareBackupToLive(counts([["tenants", 12], ["rooms", 5]]), {
      tenants: 34,
      rooms: 12,
    });
    expect(result.isSmaller).toBe(true);
    expect(result.backupTotal).toBe(17);
    expect(result.liveTotal).toBe(46);
    expect(result.reductions).toEqual([
      { table: "tenants", label: "tenants", backup: 12, live: 34 },
      { table: "rooms", label: "rooms", backup: 5, live: 12 },
    ]);
  });

  it("lists the biggest loss first", () => {
    const result = compareBackupToLive(counts([["rooms", 5], ["tenants", 12]]), {
      tenants: 34,
      rooms: 12,
    });
    expect(result.reductions.map((r) => r.table)).toEqual(["tenants", "rooms"]);
  });

  it("stays quiet when the file carries more data", () => {
    const result = compareBackupToLive(counts([["tenants", 34]]), { tenants: 12 });
    expect(result.isSmaller).toBe(false);
    expect(result.reductions).toEqual([]);
  });

  it("stays quiet when the two match exactly", () => {
    const result = compareBackupToLive(counts([["tenants", 12]]), { tenants: 12 });
    expect(result.isSmaller).toBe(false);
    expect(result.reductions).toEqual([]);
  });

  it("treats a table the live database lacks as zero", () => {
    const result = compareBackupToLive(counts([["tenants", 0]]), {});
    expect(result.isSmaller).toBe(false);
    expect(result.reductions).toEqual([]);
  });

  it("flags an empty backup against a populated device", () => {
    const result = compareBackupToLive(
      counts([["tenants", 0], ["rooms", 0], ["settings", 5]]),
      { tenants: 34, rooms: 12, settings: 5 }
    );
    expect(result.isSmaller).toBe(true);
    expect(result.backupTotal).toBe(5);
    expect(result.liveTotal).toBe(51);
  });

  it("still reports the reductions when the totals come out level", () => {
    // Tenants dropped by 5 while rooms gained 5, so the totals match — but the
    // warning is advisory and the landlord's confirmation decides.
    const result = compareBackupToLive(counts([["tenants", 5], ["rooms", 15]]), {
      tenants: 10,
      rooms: 10,
    });
    expect(result.isSmaller).toBe(false);
    expect(result.reductions).toEqual([
      { table: "tenants", label: "tenants", backup: 5, live: 10 },
    ]);
  });
});

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
      totalRows: 14,
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

/** A file written before the amenity tables existed — re-sealed so only the absent payload is under test. */
function agedFile(): string {
  const { text } = makeFile();
  const parsed = JSON.parse(text) as Record<string, any>;
  delete parsed.tables.amenity_bills;
  delete parsed.tables.amenity_bill_tenants;
  delete parsed.tables.amenity_bill_rooms;
  return serializeBackup(sealBackupEnvelope(parsed as unknown as BackupEnvelope));
}

function resealed(mutate: (parsed: Record<string, any>) => void): string {
  const { text } = makeFile();
  const parsed = JSON.parse(text) as Record<string, any>;
  mutate(parsed);
  return serializeBackup(sealBackupEnvelope(parsed as unknown as BackupEnvelope));
}

describe("tolerant import", () => {
  it("accepts a backup that predates the amenity tables and reports them empty", () => {
    const result = parseBackupFile(agedFile(), "BHMS-Backup-2026-09-01.digal");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const counts = result.snapshot.summary.counts;
    expect(counts.filter((c) => c.table.startsWith("amenity_bill")).map((c) => c.count)).toEqual([0, 0, 0]);
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

// ---------------------------------------------------------------------------
// version sync
// ---------------------------------------------------------------------------

describe("app version", () => {
  it("stays in sync with package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(CURRENT_APP_VERSION).toBe(pkg.version);
  });

  it("locks the format version and table order", () => {
    expect(FORMAT_VERSION).toBe(1);
    expect([...REQUIRED_TABLES]).toEqual([
      "rooms",
      "tenants",
      "payments",
      "reservations",
      "settings",
      "notifications_log",
      "amenity_bills",
      "amenity_bill_tenants",
      "amenity_bill_rooms",
    ]);
  });
});
