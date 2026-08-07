/**
 * Browser-preview only: loads the REAL migration files from src-tauri/migrations
 * (the same single source of truth the Rust app embeds via include_str!) so the
 * preview database has the exact production schema.
 */

const files = import.meta.glob("../../../src-tauri/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

export interface Migration {
  file: string;
  sql: string;
}

export const migrations: Migration[] = Object.keys(files)
  .sort()
  .map((p) => ({ file: p.split("/").pop() ?? p, sql: String(files[p]) }));
