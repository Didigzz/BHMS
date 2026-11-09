// Shared harness for the SQL smoke scenarios: assertion counter, the two drift
// checks (migration files ↔ migrations.rs, and ROOM_STATUS_SQL defined once),
// migration application, and the fixture insert helpers.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(dirname(dirname(HERE)));
export const MIGRATIONS_DIR = join(ROOT, "src-tauri", "migrations");
const MIGRATIONS_RS = join(ROOT, "src-tauri", "src", "migrations.rs");

/** Shared failure counter — the entry script exits non-zero when it is non-zero. */
export const state = { failures: 0 };

export function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    state.failures++;
    console.error(`  ✗ ${label}`);
  }
}

/**
 * Drift check between the two consumers of the schema:
 * the migration files on disk vs. the include_str! references in migrations.rs.
 * Fails (via assert) if either side has a file the other doesn't.
 * Returns the sorted list of migration filenames to apply.
 */
export function loadMigrations() {
  const onDisk = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const ledgerRs = readFileSync(MIGRATIONS_RS, "utf8");
  const referenced = [
    ...ledgerRs.matchAll(/include_str!\("\.\.\/migrations\/([^"]+\.sql)"\)/g),
  ]
    .map((m) => m[1])
    .sort();

  const notInLib = onDisk.filter((f) => !referenced.includes(f));
  const notOnDisk = referenced.filter((f) => !onDisk.includes(f));

  assert(
    notInLib.length === 0,
    `drift check: every migration file is wired into migrations.rs — ${notInLib.length} on disk but not referenced (${notInLib.join(", ") || "none"})`
  );
  assert(
    notOnDisk.length === 0,
    `drift check: every migrations.rs include_str! file exists on disk — ${notOnDisk.length} referenced but missing (${notOnDisk.join(", ") || "none"})`
  );

  // Ordering contract: the smoke test applies migrations by filename order,
  // while migrations.rs assigns explicit version numbers. Both must agree and be
  // strictly sequential 1..N — a gap, duplicate, or misnumber would apply
  // migrations in a different order than the app ships them.
  const fileVersions = onDisk.map((f) => Number(f.split("-")[0]));
  const libVersions = [...ledgerRs.matchAll(/migration\(\s*(\d+),/g)].map((m) => Number(m[1]));
  const ordered =
    fileVersions.every((v, i) => v === i + 1) &&
    libVersions.length === fileVersions.length &&
    libVersions.every((v, i) => v === fileVersions[i]);
  assert(
    ordered,
    `drift check: migration versions are sequential and match migrations.rs (files: ${fileVersions.join(", ")}, migrations.rs: ${libVersions.join(", ")})`
  );
  return onDisk;
}

/** Recursively list .ts/.js/.mjs/.svelte files under a directory. */
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|js|mjs|svelte)$/.test(entry)) acc.push(p);
  }
  return acc;
}

/**
 * Drift check: ROOM_STATUS_SQL must be defined in exactly one place —
 * src/lib/rooms/room-status.ts (imported by the scenario modules). A second
 * hand-rolled copy anywhere in src/ or scripts/ would reintroduce the
 * dual-source-of-truth hazard for the derived room-status rules.
 */
export function checkRoomStatusDrift() {
  const source = join(ROOT, "src", "lib", "rooms", "room-status.ts");
  const defs = [];
  for (const dir of [join(ROOT, "src"), join(ROOT, "scripts")]) {
    for (const file of walk(dir)) {
      const n = (readFileSync(file, "utf8").match(/const\s+ROOM_STATUS_SQL\s*=/g) || []).length;
      for (let i = 0; i < n; i++) defs.push(file);
    }
  }
  const expected = source === defs[0] && defs.length === 1;
  assert(
    expected,
    `drift check: ROOM_STATUS_SQL is defined exactly once in src/lib/rooms/room-status.ts — ${defs.length} definition(s) found${defs.length ? ` (${defs.join(", ")})` : ""}`
  );
}

/** Apply migration files in order, logging each one; throws on the first failure. */
export function applyMigrations(db, files) {
  for (const file of files) {
    try {
      db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
      console.log(`  ✓ migration ${file}`);
    } catch (e) {
      state.failures++;
      console.error(`  ✗ migration ${file} FAILED: ${e.message}`);
      throw e;
    }
  }
}

export function insertTenant(db, name, roomId) {
  db.prepare(
    "INSERT INTO tenants (name, contact, room_id, move_in_date, due_date) VALUES (?,?,?,?,?)"
  ).run(name, "0917-000-0000", roomId, "2026-08-01", "2026-09-01");
}

export function insertTenantBeds(db, name, roomId, beds) {
  db.prepare(
    "INSERT INTO tenants (name, contact, room_id, move_in_date, due_date, beds_occupied) VALUES (?,?,?,?,?,?)"
  ).run(name, "0917-000-0000", roomId, "2026-08-01", "2026-09-01", beds);
}

// Already-boarding backfill (v065+): mirrors the app's Add-modal "Already
// boarding?" save — beds_occupied plus the invisible backfilled flag that
// lets the recreated capacity trigger (v067) skip ALL room checks.
export function insertBackfilledTenant(db, name, roomId, beds = 1) {
  db.prepare(
    "INSERT INTO tenants (name, contact, room_id, move_in_date, due_date, beds_occupied, backfilled) VALUES (?,?,?,?,?,?,?)"
  ).run(name, "0917-000-0000", roomId, "2026-08-01", "2026-09-01", beds, 1);
}

export function insertReservation(db, roomId, name, holdType, bedCount) {
  db.prepare(
    "INSERT INTO reservations (room_id, name, contact, reservation_date, target_move_in_date, hold_type, bed_count) VALUES (?,?,?,?,?,?,?)"
  ).run(roomId, name, "0917-000-0000", "2026-08-06", "2026-08-20", holdType, bedCount);
}

export function expectAbort(db, label, needle, fn) {
  try {
    fn();
    state.failures++;
    console.error(`  ✗ ${label} — expected an abort but the statement succeeded`);
  } catch (e) {
    if (String(e.message).includes(needle)) {
      console.log(`  ✓ ${label}`);
    } else {
      state.failures++;
      console.error(`  ✗ ${label} — unexpected error: ${e.message}`);
    }
  }
}
