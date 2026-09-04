/**
 * Browser-preview shim for `@tauri-apps/plugin-sql` (only wired when
 * `RENTEASE_PREVIEW=1`, see vite.config.js).
 *
 * Runs the REAL migration files against a sql.js (WASM SQLite) database so the
 * preview behaves like the production app: same tables, triggers, and business
 * rules. Snapshots persist to IndexedDB; the backup/restore flow works through
 * the shared virtual filesystem (vfs) with `VACUUM INTO` intercepted to export
 * through the same path the plugin-fs shim reads.
 */

import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { getShim, idbDelete, idbGet, idbSet, vfs } from "./vfs";
import { migrations } from "./migrations";

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>;
type SqlJsDatabase = InstanceType<SqlJsStatic["Database"]>;

let sqlPromise: Promise<SqlJsStatic> | null = null;

function sql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => wasmUrl });
  }
  return sqlPromise;
}

function sanitize(values: unknown[] | undefined): (string | number | Uint8Array | null)[] | undefined {
  if (!values) return undefined;
  return values.map((v) => {
    if (v === undefined) return null;
    if (typeof v === "number" || typeof v === "string" || v === null || v instanceof Uint8Array) return v;
    return String(v);
  });
}

export default class Database {
  readonly db: SqlJsDatabase;
  readonly key: string;
  readonly livePath: string;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(db: SqlJsDatabase, key: string) {
    this.db = db;
    this.key = key;
    this.livePath = key;
    registerShim(this);
  }

  /** Mirrors the real API: `Database.load("sqlite:boarding-house.db")`. */
  static async load(path: string): Promise<Database> {
    const SQL = await sql();
    const key = (path || "").replace(/^sqlite:/, "") || "boarding-house.db";

    // The import flow swaps the live file through the virtual FS — it wins.
    const swapped = await vfs.get(key);
    const persisted = swapped ?? (await idbGet(key));

    let db: SqlJsDatabase;
    let fresh = false;
    if (persisted && persisted.length > 0) {
      db = new SQL.Database(persisted.slice());
    } else {
      db = new SQL.Database();
      fresh = true;
    }
    const instance = new Database(db, key);
    if (fresh) {
      for (const m of migrations) db.exec(m.sql);
      await instance.persist();
    }
    return instance;
  }

  async select<T = Record<string, unknown>[]>(query: string, values?: unknown[]): Promise<T> {
    const trimmed = query.trim();
    if (/^PRAGMA\s+integrity_check/i.test(trimmed)) {
      return [{ integrity_check: "ok" }] as T;
    }
    if (/^SELECT\s+\*\s+FROM\s+pragma_database_list/i.test(trimmed)) {
      return [{ name: "main", file: this.livePath }] as T;
    }
    const stmt = this.db.prepare(query);
    try {
      const params = sanitize(values);
      if (params && params.length > 0) stmt.bind(params as never);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows as T;
    } finally {
      stmt.free();
    }
  }

  async execute(
    query: string,
    values?: unknown[]
  ): Promise<{ rowsAffected: number; lastInsertId: number | undefined }> {
    const trimmed = query.trim();

    // WAL checkpoint is a no-op in the browser (snapshots are always clean).
    if (/^PRAGMA\s+wal_checkpoint/i.test(trimmed)) {
      return { rowsAffected: 0, lastInsertId: undefined };
    }

    // VACUUM INTO 'path' → write the exported snapshot into the virtual FS so
    // the plugin-fs shim can read it back (backup.ts export path).
    const into = /^VACUUM\s+INTO\s+'([^']+)'/i.exec(trimmed);
    if (into) {
      await vfs.set(into[1], this.db.export());
      return { rowsAffected: 0, lastInsertId: undefined };
    }

    this.db.run(query, sanitize(values) as never);
    const rowsAffected = this.db.getRowsModified();
    let lastInsertId: number | undefined;
    try {
      const res = this.db.exec("SELECT last_insert_rowid() AS id");
      const v = res[0]?.values[0]?.[0];
      if (typeof v === "number") lastInsertId = v;
    } catch {
      // Not a DML statement — no insert id.
    }
    this.schedulePersist();
    return { rowsAffected, lastInsertId };
  }

  async close(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    await this.persist();
    this.db.close();
  }

  private async persist(): Promise<void> {
    const bytes = this.db.export();
    await idbSet(this.key, bytes);
    // Keep the virtual live file (which load() prefers, and which the import
    // flow swaps in place) in sync so a reload can't resurrect stale bytes.
    if ((await vfs.get(this.livePath)) !== null) await vfs.set(this.livePath, bytes);
  }

  /** Debounced snapshot so reloads during a debugging session keep the data. */
  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persist().catch(() => {});
    }, 250);
  }
}

function registerShim(instance: Database): void {
  const shim = getShim();
  shim.query = (q: string) => instance.select(q);
  shim.exec = (q: string, values?: unknown[]) => instance.execute(q, values);
  shim.exportDb = () => instance.db.export();
  shim.dbPath = () => instance.livePath;
}

/** Test helper: wipe the preview database + virtual FS for a clean slate. */
export async function resetPreviewData(): Promise<void> {
  await idbDelete("boarding-house.db");
  await vfs.clear();
}
