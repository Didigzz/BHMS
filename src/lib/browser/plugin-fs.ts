/**
 * Browser-preview shim for `@tauri-apps/plugin-fs` (only wired when
 * `DIGAL_PREVIEW=1`). Paths resolve inside the shared virtual filesystem;
 * FileSystemFileHandle values (from the File System Access API fallback in the
 * dialog shim) are honored for real downloads.
 */

import { vfs } from "./vfs";

type FsPath = string | FileSystemFileHandle;

async function readFile(path: FsPath): Promise<Uint8Array> {
  if (typeof path !== "string") {
    const file = await path.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }
  const bytes = await vfs.get(path);
  if (!bytes) throw new Error(`No such file: ${path}`);
  return bytes;
}

async function writeFile(path: FsPath, data: Uint8Array): Promise<void> {
  if (typeof path !== "string") {
    const writable = await path.createWritable();
    await writable.write(data);
    await writable.close();
    return;
  }
  await vfs.set(path, data);
}

async function remove(path: FsPath): Promise<void> {
  if (typeof path === "string") await vfs.delete(path);
}

async function rename(from: FsPath, to: FsPath): Promise<void> {
  if (typeof from === "string" && typeof to === "string") await vfs.rename(from, to);
}

export { readFile, writeFile, remove, rename };
