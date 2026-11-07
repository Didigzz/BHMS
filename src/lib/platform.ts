/**
 * What this build can actually do with a file once it has one.
 *
 * The answer comes from Rust (`platform_capabilities` in
 * src-tauri/src/media.rs) because it is a build fact, not something the frontend
 * can infer: Android saves through MediaStore, desktop writes into Downloads,
 * and iOS has no file writer yet. Asking before drawing the button lets an
 * unavailable action be disabled with an explanation, instead of letting the tap
 * fail after the file has already been built.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./db";

export interface PlatformCapabilities {
  /** Can a file be put somewhere the user can find it again? */
  saveToDevice: boolean;
  /** Is there a system share sheet for passing a file to another app? */
  shareSheet: boolean;
  /** Plain-language reason, when an action is unavailable. */
  unavailableReason: string | null;
}

/**
 * Without Tauri there is no Rust to ask. The browser-preview shims write into a
 * virtual filesystem, so the preview must not disable its own buttons; these
 * values describe a desktop build, which is what the preview simulates.
 */
const PREVIEW: PlatformCapabilities = {
  saveToDevice: true,
  shareSheet: false,
  unavailableReason: null,
};

/** Capabilities are fixed per build, so one answer is kept for the session. */
let cached: Promise<PlatformCapabilities> | null = null;

export function getPlatformCapabilities(): Promise<PlatformCapabilities> {
  if (!isTauri()) return Promise.resolve(PREVIEW);
  // A failed call falls back to the permissive answer: a missing command should
  // not silently disable export, which is the feature people depend on most.
  cached ??= invoke<PlatformCapabilities>("platform_capabilities").catch(() => PREVIEW);
  return cached;
}
