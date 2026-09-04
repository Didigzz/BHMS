/**
 * Browser-preview shim for `@tauri-apps/plugin-dialog` (only wired when
 * `RENTEASE_PREVIEW=1`). The automated preview sets `window.__shim.dialog.open`
 * / `.save` to drive flows deterministically; without hooks it falls back to
 * the browser File System Access API when available.
 */

import { getShim } from "./vfs";

export async function open(
  opts?: { multiple?: boolean; directory?: boolean; filters?: unknown }
): Promise<string | FileSystemFileHandle | null> {
  const shim = getShim();
  if (shim.dialog.open) return (shim.dialog.open(opts) as string | FileSystemFileHandle | null) ?? null;
  try {
    if (typeof window !== "undefined" && "showOpenFilePicker" in window) {
      const handles = await (window as unknown as {
        showOpenFilePicker: (o?: unknown) => Promise<FileSystemFileHandle[]>;
      }).showOpenFilePicker({ multiple: false });
      return handles[0] ?? null;
    }
  } catch {
    // User cancelled or API unavailable.
  }
  return null;
}

export async function save(
  opts?: { defaultPath?: string; filters?: unknown }
): Promise<string | FileSystemFileHandle | null> {
  const shim = getShim();
  if (shim.dialog.save) return (shim.dialog.save(opts) as string | FileSystemFileHandle | null) ?? null;
  try {
    if (typeof window !== "undefined" && "showSaveFilePicker" in window) {
      const suggestedName = opts?.defaultPath?.split(/[\\/]/).pop();
      return (window as unknown as {
        showSaveFilePicker: (o?: unknown) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker({ suggestedName });
    }
  } catch {
    // User cancelled or API unavailable.
  }
  return null;
}
