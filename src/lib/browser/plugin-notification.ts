/**
 * Browser-preview shim for `@tauri-apps/plugin-notification` (only wired when
 * `DIGAL_PREVIEW=1`). Maps to the Web Notification API and records deliveries
 * on `window.__shim.lastNotification` for test assertions.
 */

import { getShim } from "./vfs";

export async function isPermissionGranted(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  return Notification.permission === "granted";
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  return Notification.requestPermission();
}

export async function sendNotification(opts: { title: string; body?: string }): Promise<void> {
  const shim = getShim();
  shim.lastNotification = { title: opts.title, body: opts.body };
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(opts.title, { body: opts.body });
  } catch {
    // Best-effort, same as the real plugin call sites.
  }
}
