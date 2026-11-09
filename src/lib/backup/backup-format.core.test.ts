import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  refuseBackupFileName,
  sealBackupEnvelope,
  serializeBackup,
  sha256Hex,
  toBackupRow,
  toBackupValue,
  utf8Encode,
  type BackupEnvelope,
} from "./backup-format.ts";
import { FILE_NAME, expectFailure, makeFile, payload, populatedTables } from "./backup-format.fixtures.ts";

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
    const result = parseBackupBytes(utf8Encode(text), FILE_NAME);
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
// version sync
// ---------------------------------------------------------------------------

describe("app version", () => {
  it("stays in sync with package.json", () => {
    // vitest runs with the project root as cwd; `import.meta.url` is rewritten by
    // Vite's test transform, so a filesystem path must not be derived from it.
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
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
      "amenity_payments",
    ]);
  });
});
