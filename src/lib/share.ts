/**
 * Receipt image export (billing-features-spec.md §6).
 *
 * Browser preview: downloads the PNG via an <a download> link.
 * Tauri: invokes the `save_receipt_to_gallery` Rust command with the PNG bytes
 * (base64) and file name. On Android the command routes through the Kotlin
 * `GallerySaver` plugin (MediaStore) so the receipt lands in the Photos/Gallery
 * app; on desktop it writes the PNG into the Downloads folder.
 *
 * History: the first attempt wrote the PNG into the app data dir and opened it
 * with the opener plugin's `openPath`. On Android that fails — `/data/user/0/…`
 * is app-private internal storage, so the system viewer refuses the path
 * ("Not allowed to open path …"). MediaStore is the correct Android path: the
 * gallery indexes the file and it is visible to every app.
 *
 * Files are named once per receipt number (receipt-RCPT-######.png), so they
 * double as an archive and never collide with each other.
 */

import { isTauri } from "./db";

/** Browser-preview fallback: plain download of the data URL. */
function downloadInBrowser(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export type ShareResult = "downloaded" | "saved";

/** Persist a receipt PNG; throws with a friendly message on failure. */
export async function shareReceiptImage(dataUrl: string, filename: string): Promise<ShareResult> {
  if (!isTauri()) {
    downloadInBrowser(dataUrl, filename);
    return "downloaded";
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const result = await invoke<string>("save_receipt_to_gallery", {
      base64,
      fileName: filename,
    });
    // Android → "saved-to-gallery"; desktop → "downloaded".
    return result === "downloaded" ? "downloaded" : "saved";
  } catch (e) {
    throw new Error(`Could not export the receipt image: ${String(e)}`);
  }
}
