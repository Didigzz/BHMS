// Empty-database pass: a freshly migrated database still exports a valid,
// flagged-empty backup, and restoring it keeps only the seeded settings.
import { DatabaseSync } from "node:sqlite";
import {
  buildBackupEnvelope,
  parseBackupFile,
  sealBackupEnvelope,
  serializeBackup,
} from "../../../../src/lib/backup/backup-format.ts";
import { assert, migrate, section } from "../harness.mjs";
import { snapshot, tablePayloads } from "../fixtures.mjs";
import { rebuildFromBackup } from "../rebuild.mjs";

export function runEmptyScenario(ctx) {
  const migrationFiles = ctx.migrationFiles;

  section("Empty database pass");
  const empty = new DatabaseSync(":memory:");
  migrate(empty, migrationFiles);
  const emptyTables = tablePayloads(empty);
  const emptyText = serializeBackup(
    sealBackupEnvelope(buildBackupEnvelope(emptyTables, { houseName: "RentEase" }))
  );
  const emptyParsed = parseBackupFile(emptyText);
  assert(emptyParsed.ok, "an empty database still exports a valid backup");
  if (emptyParsed.ok) {
    assert(emptyParsed.snapshot.summary.isEmpty === true, "the empty backup is flagged for the second confirmation");
    const emptyRestored = rebuildFromBackup(emptyTables, migrationFiles);
    const settingsRows = snapshot(emptyRestored).settings.length;
    assert(
      settingsRows === emptyTables.settings.row_count,
      `empty restore keeps the ${settingsRows} seeded setting(s) and nothing else`
    );
  }
}
