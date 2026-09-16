/**
 * Browser-preview infrastructure — ONLY bundled when `RENTEASE_PREVIEW=1`
 * (see vite.config.js). The real Tauri app never imports these files; they
 * back the `@tauri-apps/*` shims so every page and workflow can run inside a
 * plain-browser dev server for debugging.
 *
 * This module owns:
 *  - a virtual filesystem (Map + IndexedDB) standing in for tauri-plugin-fs,
 *  - IndexedDB persistence for the sql.js database snapshots,
 *  - `window.__shim`, the test hook the automated preview checks use to drive
 *    dialogs, run SQL, and inspect state.
 */

const IDB_NAME = "rentease-preview";
const IDB_STORE = "kv";

let idbPromise: Promise<IDBDatabase> | null = null;

function openIdb(): Promise<IDBDatabase> {
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return idbPromise;
}

function idbRequest<T>(fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openIdb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        const req = fn(tx.objectStore(IDB_STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export async function idbGet(key: string): Promise<Uint8Array | null> {
  const value = await idbRequest((s) => s.get(key));
  return value instanceof Uint8Array ? value : null;
}

export async function idbSet(key: string, bytes: Uint8Array): Promise<void> {
  await idbRequest((s) => s.put(bytes, key));
}

export async function idbDelete(key: string): Promise<void> {
  await idbRequest((s) => s.delete(key));
}

/** In-memory mirror of the persisted virtual filesystem. */
const files = new Map<string, Uint8Array>();
let vfsLoaded: Promise<void> | null = null;

async function ensureVfsLoaded(): Promise<void> {
  if (!vfsLoaded) {
    vfsLoaded = (async () => {
      const db = await openIdb();
      const keys = await new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).getAllKeys();
        req.onsuccess = () => resolve(req.result as string[]);
        req.onerror = () => reject(req.error);
      });
      for (const key of keys) {
        if (key.startsWith("vfs:")) {
          const bytes = await idbGet(key);
          if (bytes) files.set(key.slice(4), bytes);
        }
      }
    })();
  }
  return vfsLoaded;
}

/** Browser stand-in for tauri-plugin-fs (paths only; no real disk access). */
export const vfs = {
  async set(path: string, bytes: Uint8Array): Promise<void> {
    await ensureVfsLoaded();
    files.set(path, bytes);
    await idbSet("vfs:" + path, bytes);
  },
  async get(path: string): Promise<Uint8Array | null> {
    await ensureVfsLoaded();
    return files.get(path) ?? null;
  },
  async delete(path: string): Promise<void> {
    await ensureVfsLoaded();
    files.delete(path);
    await idbDelete("vfs:" + path);
  },
  async rename(from: string, to: string): Promise<void> {
    await ensureVfsLoaded();
    const bytes = files.get(from) ?? new Uint8Array();
    files.delete(from);
    files.set(to, bytes);
    await idbDelete("vfs:" + from);
    await idbSet("vfs:" + to, bytes);
  },
  async keys(): Promise<string[]> {
    await ensureVfsLoaded();
    return [...files.keys()];
  },
  async clear(): Promise<void> {
    await ensureVfsLoaded();
    for (const key of [...files.keys()]) {
      await this.delete(key);
    }
  },
};

/** Shape of the preview test hook exposed on `window.__shim`. */
export interface PreviewShim {
  vfs: typeof vfs;
  dialog: {
    open?: (opts?: unknown) => unknown;
    save?: (opts?: unknown) => unknown;
  };
  query?: (sql: string) => Promise<unknown>;
  exec?: (sql: string, values?: unknown[]) => Promise<unknown>;
  exportDb?: () => Uint8Array;
  dbPath?: () => string;
  /** Restore a `.digal` payload into the preview database (see plugin-sql.ts). */
  installBackup?: (text: string) => Promise<void>;
  lastNotification?: { title: string; body?: string } | null;
}

export function getShim(): PreviewShim {
  const w = window as unknown as { __shim?: PreviewShim };
  return (w.__shim ??= { vfs, dialog: {} });
}
